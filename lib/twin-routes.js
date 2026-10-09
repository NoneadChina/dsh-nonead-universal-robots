/**
 * dsh-nonead-universal-robots — host HTTP routes for the UR digital twin.
 *
 * © 2026 拓德科技 / Suzhou Nonead Robot Technology Co., Ltd. — https://www.nonead.com
 *
 * Three read-only endpoints consumed by the right-dock 3D twin:
 *   GET <TWIN_STATE_PATH>[?ip=<ip>][&detail=1] → live joint angles + TCP + robot model
 *                                      (`ip` optional — Ruling 35: omitted means
 *                                      "the single connected robot"; `detail=1`
 *                                      adds the slower dashboard/status fields)
 *   GET <TWIN_ASSET_PATH>?model=<urXX> → assets/models/<urXX>.glb (Ruling 7:
 *                                        `/plugins/<id>/` only serves client.js/.map)
 *   GET <TWIN_MODELS_PATH>            → which GLBs are actually present locally
 *
 * Design: all handlers are **pure logic** — they never touch `req`/`res`, the
 * socket or the filesystem layout beyond an injected `assetsDir`. `lib/index.js`
 * does the HTTP plumbing (trust fence, method check, query parsing, status
 * write). This split keeps the security-relevant decisions unit-testable
 * without a live server.
 *
 * Failure policy: the twin is a best-effort *visualisation* channel. A missing
 * robot, a dead worker or a not-yet-downloaded mesh asset must never turn into
 * a 5xx that the client would surface as a hard error — they degrade to
 * `connected:false` / an empty 404 instead. Every failure additionally carries a
 * machine-readable `code` so the UI can say *why* it is not connected instead of
 * rendering one generic "not connected" line.
 */

import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { pendingMotion } from './pending-motion.js';

/**
 * Route paths (Ruling 22): the single source of truth is the **zero-import**
 * `lib/twin-paths.js`, shared verbatim with the browser half so the two can
 * never drift. Re-exported here to keep this module's public surface — this
 * file must NOT be imported by the client: it pulls in `node:fs` for the GLB
 * route, which cannot be bundled for the browser.
 */
export { TWIN_STATE_PATH, TWIN_ASSET_PATH, TWIN_MODELS_PATH, TWIN_STREAM_PATH } from './twin-paths.js';

/**
 * Model-id whitelist. Deliberately strict: `[a-z0-9]+` cannot express any path
 * separator, `.` or `..`, so a whitelisted id can never climb out of
 * `assetsDir` (the explicit containment check below is defence in depth).
 */
const MODEL_ID_RE = /^[a-z0-9]+$/;

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
/** Status payloads are live telemetry: never let a proxy or the HTTP cache reuse one. */
const NO_STORE = 'no-store, no-cache, must-revalidate';
const STATE_HEADERS = { ...JSON_HEADERS, 'cache-control': NO_STORE };

/** Trim a query value; anything that is not a string becomes ''. */
function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Machine-readable failure reasons returned with `connected:false`.
 * The client maps these to human text, so the *cause* survives the wire.
 */
export const TWIN_CODES = {
  NO_ROBOT: 'no_robot',
  NOT_CONNECTED: 'robot_not_connected',
  AMBIGUOUS: 'ambiguous_robot',
  WORKER_UNAVAILABLE: 'worker_unavailable',
  ROBOT_ERROR: 'robot_error',
  BAD_REQUEST: 'bad_request',
};

/** Standard disconnected envelope: never a 5xx, always says why. */
function disconnected(code, reason, extra = {}) {
  return { status: 200, headers: STATE_HEADERS, body: { connected: false, code, reason, ...extra } };
}

/**
 * worker 侧的"**暂时**拿不到答案"类错误码（见 `lib/worker.js` 的 `WORKER_ERROR_CODES`）。
 *
 * 为什么必须把这一类与"机器人真的没连上"分开：`UrWorker` 是单线程 stdin 队列，机器人执行
 * 运动指令期间孪生的读会排队并超时（这是**常态**，不是故障）。以前这种情况被映射成
 * `connected:false`，客户端于是把整个 3D 视图和 HUD 都藏起来、写上「未连接机器人」——
 * 用户看到的就是"孪生同步了两个动作之后就不动了（其实是变成未连接）"。
 * 现在这一类降级成"陈旧帧"：照旧 `connected:true`、带上 **原来的 ts**（龄期继续增长）与
 * `stale:true`，客户端保留读数并在界面上写「数据已停止更新 Ns」。
 */
export const TWIN_TRANSIENT_WORKER_CODES = new Set([
  'WORKER_BUSY',
  'WORKER_TIMEOUT',
  'WORKER_ABORTED',
  'WORKER_KILLED',
  'WORKER_EXITED',
  'WORKER_STDIN',
  'WORKER_DISPOSED',
  'WORKER_SPAWN',
]);

/**
 * 陈旧帧最多回放多久（毫秒）。
 *
 * 再久就不再假装知道机器人现在在哪 —— 一帧十分钟前的姿态比"不知道"更危险。
 */
export const TWIN_STALE_MAX_MS = 30000;

/**
 * Build the `/twin/state` handler.
 *
 * `ip` is **optional** (Ruling 35): the host owns the connection registry, so
 * the browser half must not have to know — or guess — the robot's address.
 *   - `ip` given             → that robot (unchanged behaviour);
 *   - omitted, 0 connected   → `connected:false` / "no robot connected";
 *   - omitted, exactly 1     → that robot (the common single-robot case);
 *   - omitted, 2+ connected  → 400 (ambiguous: the caller must disambiguate).
 *
 * `detail` (0.5.0) adds the dashboard-backed fields already computed by the
 * worker's `status` op. They are much more expensive than a pose read, so the
 * client polls them on a slow channel rather than at pose rate.
 *
 * @param {object} deps
 * @param {{call: Function}|null} deps.worker live UR worker (may be null when
 *   the Python worker failed to initialise).
 * @param {() => Set<string>} deps.connectedIps registry of IPs the `connect`
 *   tool has successfully reached. Advisory only — correctness rests on the
 *   catch below.
 * @param {(ip: string) => (string|null)} [deps.modelFor] memoised robot model
 *   per IP (the model never changes while a connection lives, so re-asking the
 *   Dashboard 10×/s is pure waste). Optional — without it the model is read on
 *   every call.
 * @param {number} [deps.staleMaxMs=TWIN_STALE_MAX_MS] 陈旧帧最多回放多久
 * @param {() => number} [deps.now=Date.now] 时钟（注入点）
 * @returns {(query?: {ip?: string, detail?: string}) => Promise<{status: number, headers: object, body: object}>}
 */
export function createTwinStateHandler({ worker, connectedIps, modelFor, staleMaxMs, now } = {}) {
  const registry = typeof connectedIps === 'function' ? connectedIps : () => new Set();
  const memo = typeof modelFor === 'function' ? modelFor : () => null;
  const clock = typeof now === 'function' ? now : Date.now;
  const staleWindowMs = Number.isFinite(staleMaxMs) && staleMaxMs >= 0 ? staleMaxMs : TWIN_STALE_MAX_MS;
  /**
   * 每台机器人**最后一笔成功读数**（ip → {body, at}）。
   *
   * 只用于"暂时读不到"时降级成陈旧帧；条目很小（qs/tcp 各 6 个数），键的个数就是已连接
   * 机器人的台数。超过 `staleWindowMs` 的条目会被删除，绝不无限回放。
   */
  const lastGood = new Map();

  /** Read the registry defensively — a throwing source degrades to "unknown". */
  function knownIps() {
    try {
      const value = registry();
      return value instanceof Set ? [...value] : [];
    } catch {
      return [];
    }
  }

  const truthy = (value) => value === true || value === '1' || value === 'true';

  return async function handleTwinState(query = {}) {
    const requested = textOf(query?.ip);
    const wantsDetail = truthy(query?.detail ?? query?.full);
    let ip = requested;

    if (ip === '') {
      const ips = knownIps();
      if (ips.length === 0) {
        return disconnected(TWIN_CODES.NO_ROBOT, 'no robot connected');
      }
      if (ips.length > 1) {
        return {
          status: 400,
          headers: STATE_HEADERS,
          body: {
            connected: false,
            code: TWIN_CODES.AMBIGUOUS,
            error: 'multiple robots connected; pass ?ip=<ip>',
            reason: `当前有 ${ips.length} 台机器人已连接，请指定 ?ip=`,
            ips: ips.slice().sort(),
          },
        };
      }
      ip = ips[0];
    } else if (!knownIps().includes(ip)) {
      return disconnected(TWIN_CODES.NOT_CONNECTED, `robot ${ip} is not connected`, { ip });
    }

    if (worker === null || worker === undefined || typeof worker.call !== 'function') {
      return disconnected(TWIN_CODES.WORKER_UNAVAILABLE, 'UR worker unavailable', { ip });
    }

    try {
      const [jp, tp] = await Promise.all([
        worker.call('get_joint_pose', { ip }),
        worker.call('get_tcp_pose', { ip }),
      ]);
      // 注意信封层级：协议响应是 `{"id":n,"ok":true,"data":<op 的返回值>}`，而每个 op 自己
      // 返回的是 `{"message":…,"data":{…}}`（见 python/ur_worker.py 的 ok()：它**原样**返回
      // 传进来的 dict）。`UrWorker.call()` resolve 的是响应里的 `data`，所以这里拿到的是
      // `{message, data:{…}}` —— 真正载荷在**再下一层** `.data`。
      // 曾经按单层读（`jp.joint_positions`），于是 model/q/tcp 恒为空、孪生面板连上机器人也
      // 只显示黑屏；而 test/twin-routes.test.mjs 的假 worker 恰好造了扁平的返回值，所以门禁
      // 一直是绿的。改这里时请同步那张假 worker 的形状。
      const q = Array.isArray(jp?.data?.joint_positions) ? jp.data.joint_positions : [];
      const tcp = Array.isArray(tp?.data?.tcp_pose) ? tp.data.tcp_pose : [];

      // Memoise the robot model: it is a Dashboard round trip that cannot change
      // while the connection lives, yet the twin polls this route ~10×/s.
      let model = memo(ip);
      if (!model) {
        const md = await worker.call('get_robot_model', { ip });
        model = String(md?.data?.robot_model ?? '').trim();
      }

      /** `q` empty but `connected:true` would freeze the arm with no explanation. */
      const degraded = q.length < 6
        ? { code: 'incomplete_pose', reason: '机器人没有返回完整的关节角（q 不足 6 维）' }
        : undefined;

      const body = {
        connected: true,
        // Echoed so the client can show *which* robot it resolved to when it did
        // not pass ?ip= itself.
        ip,
        model,
        q,
        tcp,
        ts: clock(),
        ...(degraded ? { degraded: true, ...degraded } : {}),
      };

      // 待审批的运动目标（清单第 8 条：先看后动）：审批弹窗说"要动了"，孪生面板同步把
      // 目标画出来 —— 比弹窗里一串数字强得多。
      //
      // 没有待审批时**整个字段缺席**（而不是给 null），client 一眼就能区分"当前没有审批"
      // 与"有审批但解析不出目标"。
      const pending = pendingMotion.read();
      if (pending !== null) body.pending_motion = pending;

      if (wantsDetail) {
        try {
          const st = await worker.call('status', { ip });
          const d = st?.data;
          if (d && typeof d === 'object') {
            body.detail = {
              safety_mode: d.safety_mode,
              robot_mode: d.robot_mode,
              program_state: d.program_state,
              loaded_program: d.loaded_program,
              running: d.running,
              remote_control: d.remote_control,
              software_version: d.software_version,
              serial_number: d.serial_number,
              up_time_seconds: d.up_time_seconds,
              speed_scaling: d.speed_scaling,
              robot_voltage: d.robot_voltage,
              robot_current: d.robot_current,
              joint_temperatures: d.joint_temperatures,
              joint_currents: d.joint_currents,
              // 清单第 9 条（工程辅助可视化）：`status` 本来就带这两个 RTDE 量
              // （python 侧 `op_status` 的 `tcp_force` / `tcp_speed`），透传出去给
              // TCP 受力箭头与 HUD 用，**不需要任何新增的 worker 调用**。
              tcp_force: d.tcp_force,
              tcp_speed: d.tcp_speed,
            };
          }
        } catch (e) {
          // Detail is a bonus: a failure must not take down the pose channel.
          body.detail = { error: e instanceof Error ? e.message : String(e) };
        }

        // 目标姿态（数字孪生的"幽灵臂"）：`target_*` 来自 RTDE 数据流，**不在** dashboard 的
        // status 里，所以要单独问一次 worker。detail 是慢通道（1 Hz 级），这次多出来的往返
        // 可以接受；而"控制器打算去哪"正是孪生相对 3D 预览的差异点。
        try {
          const targets = await worker.call('get_target_values', { ip });
          const targetQ = targets?.data?.target_q;
          if (Array.isArray(targetQ) && targetQ.length === 6 && targetQ.every(Number.isFinite)) {
            body.detail = { ...(body.detail ?? {}), target_q: targetQ };
          }
        } catch {
          // 目标姿态是加分项：拿不到就不给这一层，绝不能让整块 detail 变成错误。
        }
      }

      // 这一帧真的读到了：记成"最后一笔已知读数"，供暂时读不到时降级回放。
      lastGood.set(ip, { body, at: clock() });

      return { status: 200, headers: STATE_HEADERS, body };
    } catch (e) {
      /*
       * Never 500 on a robot/worker error.
       *
       * 但**也不能**把"暂时读不到"报成"机器人没连上"：
       * `UrWorker` 是单线程 stdin 队列，机器人执行运动指令期间孪生的读会排队并超时
       * （这是常态）。把它当成未连接，客户端就会藏掉整个 3D 视图与 HUD —— 用户看到的正是
       * "孪生同步了两个动作之后就不动了"。所以这一类降级成**陈旧帧**：仍然是 connected，
       * 但 `ts` 保持原值（龄期继续增长）、并显式带上 `stale:true` 与原因，让客户端一边
       * 保留读数一边如实显示"数据已停止更新"。
       */
      const errorCode = e !== null && typeof e === 'object' ? e.code : undefined;
      const cached = lastGood.get(ip);
      if (cached !== undefined) {
        const age = clock() - cached.at;
        if (TWIN_TRANSIENT_WORKER_CODES.has(errorCode) && age <= staleWindowMs) {
          return {
            status: 200,
            headers: STATE_HEADERS,
            body: {
              // 原样回放最后一笔已知读数（含**原来的** ts）。
              ...cached.body,
              stale: true,
              stale_reason: errorCode,
              stale_ms: age,
            },
          };
        }
        // 过了回放窗口（或不是"暂时"类错误）：不再假装知道机器人在哪。
        if (age > staleWindowMs) lastGood.delete(ip);
      }
      return disconnected(TWIN_CODES.ROBOT_ERROR, e instanceof Error ? e.message : String(e), { ip });
    }
  };
}

/** SSE 推送间隔（毫秒）。比 10 Hz 轮询更快，但没必要更快 —— 采样率是宿主侧的事。 */
export const TWIN_STREAM_INTERVAL_MS = 100;

/** SSE 心跳间隔（毫秒）：有些代理在 30–60 s 无数据时会切断连接。 */
export const TWIN_STREAM_HEARTBEAT_MS = 15000;

/**
 * 流里的 `detail` 慢节拍（毫秒）。
 *
 * ⚠️ **必须做**：`createTwinStateHandler` 只在 query 带 `detail=1` 时才去问 dashboard。
 * 流如果一帧都不带 detail，安全模式 / 温度 / 倍率 / 母线就**永远是空的** —— 而这几项
 * 恰恰是清单第 1 条刚补进来的现场排障信息。也不能每帧都带：dashboard 往返明显贵于
 * 一次位姿读，10 Hz 地问会把机器人打满。
 */
export const TWIN_STREAM_DETAIL_MS = 2000;

/**
 * 一帧读**还没回来**时的"数据停滞"提示节拍（毫秒）。
 *
 * ⚠️ **必须有**：Python worker 是单线程 `for line in sys.stdin`，而运动类工具会一直占着它
 * （`_movej_confirm` / `_wait_robot_idle` 的确认循环要等机器人真的停下来）。孪生的读因此会
 * **排队**，而 `pumping` 背压又明确"上一帧没回来就不发下一帧" —— 两者叠加的结果是：机器人
 * 一运动，流就**一个事件都不发**。客户端看到的是一条"开着的、安静的流"，画面停在最后一帧
 * 且没有任何提示，用户看到的正是"同步两个动作后就不动了"。
 *
 * 所以读还没回来时改为周期性发一个 `stale` 事件（客户端据此显示"数据已停止更新"），
 * 而不是静默。实测：`scripts/probe-twin-pump-stall.mjs` 修前 6 s 零事件。
 */
export const TWIN_STREAM_STALE_NOTIFY_MS = 1000;

/**
 * 单帧读的安全网（毫秒）：超过这个时长仍未 settle 就**放弃这一帧**。
 *
 * 这是一条兜底：正常路径由 worker 自己的超时结束（`lib/index.js` 的孪生读另有更短的
 * 专用预算），这里只防"读的 promise 永远不 settle"（例如 worker 管理器卡在 spawn 上）。
 * 刻意取得比 worker 预算大得多，避免与它抢着结束同一帧 —— 抢跑会导致实际请求在 worker
 * 队列里继续叠加（`maxInFlight` 只有 8，堆满会让**每一帧**都立刻失败）。
 */
export const TWIN_STREAM_FRAME_TIMEOUT_MS = 15000;

/**
 * 非 `state` 事件的类型名。
 *
 * ⚠️ **绝不能叫 `error`。** 浏览器把 `EventSource.onerror` 实现成
 * `addEventListener('error', …)`（规范：onerror 就是 error 事件的事件处理器属性），
 * 而服务端事件是按 `event:` 字段派发的 ⇒ 一个名叫 `error` 的服务端事件会**直接命中
 * 客户端的 onerror**，被当成"连接断了"，于是宿主文档里那句"单帧失败只发一个 error 事件，
 * 绝不拆掉整条流"在真实浏览器里恰好**反过来**。实测（`scripts/probe-twin-stream-error-event.mjs`）：
 * 一个 error 帧 ⇒ 客户端拆流重连；连来 8 次 ⇒ 客户端进入终态 gaveup，孪生永久冻结。
 */
export const TWIN_STREAM_FRAME_ERROR_EVENT = 'frame-error';

/** 数据停滞提示的事件名（客户端保留上一帧，只把"停了多久"显示出来）。 */
export const TWIN_STREAM_STALE_EVENT = 'stale';

/** 从请求 URL 里取查询串（SSE handler 拿不到已解析的 query）。 */
function queryOf(url) {
  const at = typeof url === 'string' ? url.indexOf('?') : -1;
  if (at === -1) return {};
  const out = {};
  for (const [key, value] of new URLSearchParams(url.slice(at + 1))) out[key] = value;
  return out;
}

/**
 * Build the `/twin/stream` Server-Sent Events handler（清单第 20 条：实时跟随）。
 *
 * DSH 的 `webServer` 路由契约是 `handler(req, res) => void`，类型定义里明确写了
 * "owns the full response lifecycle (may hold the response open, e.g. SSE)" ——
 * 所以这条路由**不需要任何上游改动**，也不需要返回 `{status, headers, body}`。
 *
 * 与 `/twin/state` 的关系：**互斥使用**。客户端要么轮询、要么订阅流；两套并存会让同一
 * 帧被推两次、画面抖动。handler 内部直接复用 `createTwinStateHandler`，所以两条路
 * 经的纯逻辑完全一致。
 *
 * ## 事件（0.6.6 起）
 * - `state`：**完整**状态快照（直接复用状态路由的 body），逐帧替换。
 * - `stale`：这一帧的读还没回来（worker 被运动指令占住是常态）。客户端保留上一帧，
 *   把"数据停了多久"显示出来。
 * - `frame-error`：这一帧彻底失败了（读抛错，或超过 `frameTimeoutMs` 被放弃）。
 *   **刻意不叫 `error`** —— 那个名字会被浏览器的 `EventSource.onerror` 接走，
 *   于是一次单帧失败就把整条流拆掉（见 `TWIN_STREAM_FRAME_ERROR_EVENT` 的注释）。
 *
 * ## 不变量
 * - 同一时刻**只有一帧读在飞**（不向单线程 worker 叠加请求；`maxInFlight` 只有 8，
 *   叠满会让每一帧都立刻失败）。
 * - 任何情况下都**不静默**：它要么发 `state`，要么发 `stale`，要么发 `frame-error`。
 * - 单帧的失败/超时**绝不**关闭连接，也绝不结束响应。
 *
 * @param {object} deps 与 `createTwinStateHandler` 相同，另加 `intervalMs` / `heartbeatMs` /
 *   `detailMs` / `staleNotifyMs` / `frameTimeoutMs` / `now`
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createTwinStreamHandler(deps = {}) {
  const readState = createTwinStateHandler(deps);
  const intervalMs = Number.isFinite(deps.intervalMs) && deps.intervalMs > 0
    ? deps.intervalMs
    : TWIN_STREAM_INTERVAL_MS;
  const heartbeatMs = Number.isFinite(deps.heartbeatMs) && deps.heartbeatMs > 0
    ? deps.heartbeatMs
    : TWIN_STREAM_HEARTBEAT_MS;
  const detailMs = Number.isFinite(deps.detailMs) && deps.detailMs >= 0
    ? deps.detailMs
    : TWIN_STREAM_DETAIL_MS;
  const staleNotifyMs = Number.isFinite(deps.staleNotifyMs) && deps.staleNotifyMs > 0
    ? deps.staleNotifyMs
    : TWIN_STREAM_STALE_NOTIFY_MS;
  const frameTimeoutMs = Number.isFinite(deps.frameTimeoutMs) && deps.frameTimeoutMs > 0
    ? deps.frameTimeoutMs
    : TWIN_STREAM_FRAME_TIMEOUT_MS;
  const now = typeof deps.now === 'function' ? deps.now : Date.now;

  return function handleTwinStream(req, res) {
    if (req?.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('allow', 'GET');
      res.end();
      return;
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': NO_STORE,
      connection: 'keep-alive',
      // 反向代理常见的缓冲会把 SSE 攒成一坨再吐，显式关掉。
      'x-accel-buffering': 'no',
    });

    let closed = false;
    /**
     * 当前在飞的那一帧读（`null` = 空闲）。
     *
     * ⚠️ 语义是"**这一帧的读已经发出去了**"，而不是"泵正在跑"：前者才是背压的正确粒度。
     * 以前这里是布尔 `pumping`，同样不做叠加 —— 但读慢了（worker 被运动指令占住是常态）
     * 就**什么都不发**，客户端无法区分"数据停了"与"一切正常"。现在读在飞时：
     *   ① 周期性发 `stale`（把停滞如实说出来）；
     *   ② 超过 `frameTimeoutMs` 就放弃这一帧（安全网，防 promise 永不 settle）。
     */
    let inFlight = null;
    let readSeq = 0;
    let frameErrors = 0;
    let lastStaleAt = Number.NEGATIVE_INFINITY;
    // detail 慢节拍：只有走到点上才向 dashboard 要一次状态细节（见 TWIN_STREAM_DETAIL_MS）。
    let lastDetailAt = Number.NEGATIVE_INFINITY;

    const send = (event, data) => {
      if (closed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        // 写失败即视为断开；cleanup 由 close 事件兜底。
      }
    };

    /** 读还没回来：至少让客户端知道"数据停在哪儿了"（静默停帧是不可接受的）。 */
    const notifyStalled = (entry) => {
      if (closed) return;
      const at = now();
      if (at - lastStaleAt < staleNotifyMs) return;
      lastStaleAt = at;
      send(TWIN_STREAM_STALE_EVENT, {
        pendingMs: Math.max(0, at - entry.startedAt),
        timeoutMs: frameTimeoutMs,
      });
    };

    /** 安全网：放弃这一帧（不发 state、不拆流），让下一个节拍重新读数。 */
    const abandonInFlight = (entry) => {
      entry.abandoned = true;
      frameErrors += 1;
      if (inFlight === entry) inFlight = null;
      send(TWIN_STREAM_FRAME_ERROR_EVENT, {
        reason: 'read_timeout',
        message: `这一帧的状态读取超过 ${frameTimeoutMs}ms 仍未返回，已放弃该帧（流保持连接）`,
        frameErrors,
      });
    };

    const pump = async () => {
      if (closed) return;
      if (inFlight !== null) {
        notifyStalled(inFlight);
        if (now() - inFlight.startedAt > frameTimeoutMs) abandonInFlight(inFlight);
        return;
      }
      const entry = { startedAt: now(), seq: (readSeq += 1), abandoned: false };
      inFlight = entry;
      try {
        const query = queryOf(req?.url);
        // 慢节拍带 detail（见 TWIN_STREAM_DETAIL_MS）：客户端那边 `detail` 会沿用上一帧，
        // 所以偶尔带一次就够，中间帧不会把安全模式/温度抹成空白。
        if (detailMs > 0 && now() - lastDetailAt >= detailMs) {
          lastDetailAt = now();
          query.detail = '1';
        }
        const result = await readState(query);
        if (closed || entry.abandoned) return;
        send('state', result?.body ?? {});
      } catch (e) {
        // 单帧失败**绝不断流**：发一条 frame-error 事件，客户端保留上一帧继续显示。
        if (closed || entry.abandoned) return;
        frameErrors += 1;
        send(TWIN_STREAM_FRAME_ERROR_EVENT, {
          reason: 'read_failed',
          message: e instanceof Error ? e.message : String(e),
          frameErrors,
        });
      } finally {
        // 只清"自己那一帧"：安全网可能已经把 inFlight 换掉了。
        if (inFlight === entry) inFlight = null;
      }
    };

    // 立刻推第一帧：订阅者不该先干等一个 interval。
    void pump();
    const timer = setInterval(() => { void pump(); }, intervalMs);
    const beat = setInterval(() => {
      if (closed) return;
      try {
        res.write(': ping\n\n');
      } catch { /* 已断开 */ }
    }, heartbeatMs);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      clearInterval(beat);
      try {
        res.end();
      } catch { /* 已断开 */ }
    };
    req?.on?.('close', cleanup);
    req?.on?.('error', cleanup);
    res?.on?.('close', cleanup);
    res?.on?.('error', cleanup);
  };
}

/**
 * Build the `/twin/asset` handler.
 *
 * Sends a strong `ETag` (and honours `If-None-Match` with a 304) plus an
 * immutable cache directive: mesh files are content-addressed by model name and
 * never change in place, and the client releases its model handle whenever the
 * panel closes — without validators every reopen re-downloads 1.5-3.5 MB.
 *
 * @param {object} deps
 * @param {string} deps.assetsDir absolute path of `assets/models`. The
 *   directory may legitimately not exist yet (meshes are still being
 *   produced), in which case every lookup is a clean 404.
 * @returns {(query?: {model?: string}, headers?: object) => Promise<{status: number, headers: object, body: Buffer|object}>}
 */
export function createTwinAssetHandler({ assetsDir } = {}) {
  const root = typeof assetsDir === 'string' && assetsDir.trim() !== '' ? resolve(assetsDir) : '';
  const rootPrefix = root === '' ? '' : root + sep;

  return async function handleTwinAsset(query = {}, reqHeaders = {}) {
    const model = textOf(query?.model);
    if (model === '') {
      return { status: 400, headers: JSON_HEADERS, body: { error: 'model is required' } };
    }
    if (!MODEL_ID_RE.test(model)) {
      // Covers `../../package.json`, `..\..\package.json`, `a/b`, `UR3`, …
      return { status: 400, headers: JSON_HEADERS, body: { error: 'invalid model id' } };
    }
    if (root === '') {
      return { status: 404, headers: JSON_HEADERS, body: { error: 'asset not found' } };
    }

    const file = join(root, `${model}.glb`);
    if (!file.startsWith(rootPrefix)) {
      // Unreachable while MODEL_ID_RE holds; kept so a future relaxation of the
      // whitelist cannot silently become a traversal primitive.
      return { status: 400, headers: JSON_HEADERS, body: { error: 'invalid model id' } };
    }

    try {
      const body = await readFile(file);
      // Strong validator over the bytes: correct even if a mesh is ever
      // regenerated in place (the name would stay, the content would not).
      const etag = `"${createHash('sha1').update(body).digest('hex')}"`;
      const cacheHeaders = {
        'content-type': 'model/gltf-binary',
        'content-length': String(body.length),
        etag,
        'cache-control': 'public, max-age=31536000, immutable',
      };
      const inm = reqHeaders?.['if-none-match'];
      if (typeof inm === 'string' && inm.split(',').some((tag) => tag.trim() === etag)) {
        return { status: 304, headers: cacheHeaders, body: '' };
      }
      return { status: 200, headers: cacheHeaders, body };
    } catch {
      // ENOENT (assets/models/ still absent) and EISDIR both land here.
      return { status: 404, headers: JSON_HEADERS, body: { error: 'asset not found' } };
    }
  };
}

/**
 * Build the `/twin/models` handler: which model ids are actually present.
 *
 * Needed because the client knows only the kinematics keys baked into its
 * bundle — when the robot reports a model with no local mesh, that mismatch
 * used to surface as a silent fallback to approximate geometry.
 *
 * @param {object} deps
 * @param {string} deps.assetsDir absolute path of `assets/models` (may not exist).
 * @returns {() => Promise<{status: number, headers: object, body: object}>}
 */
export function createTwinModelsHandler({ assetsDir } = {}) {
  const root = typeof assetsDir === 'string' && assetsDir.trim() !== '' ? resolve(assetsDir) : '';

  return async function handleTwinModels() {
    if (root === '') {
      return { status: 200, headers: STATE_HEADERS, body: { models: [] } };
    }
    try {
      const entries = await readdir(root);
      const models = entries
        .filter((name) => name.endsWith('.glb'))
        .map((name) => name.slice(0, -4))
        .filter((id) => MODEL_ID_RE.test(id))
        .sort();
      return { status: 200, headers: STATE_HEADERS, body: { models } };
    } catch {
      // Directory not produced yet (or unreadable): an empty list, never a 5xx.
      return { status: 200, headers: STATE_HEADERS, body: { models: [] } };
    }
  };
}

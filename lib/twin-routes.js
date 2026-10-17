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
  /**
   * SSE 并发连接已满（0.7.5 / C8）。
   *
   * `/twin/stream` 没有连接数上限时，每多一条连接就多一份 10 Hz 的读 —— 而它们共用同一个
   * 单线程 Python worker，`maxInFlight` 只有 8，堆满后**运动指令会被 `WORKER_BUSY` 拒绝**。
   * 所以超限连接必须在路由层就被拒掉，并给客户端一个稳定的 code 以便提示"关掉其它窗口"。
   */
  TOO_MANY_STREAMS: 'too_many_streams',
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
 * 主动推送的**新鲜窗口**（毫秒）：缓存比这更旧就回退到显式读。
 *
 * Python 侧以 20 Hz（50 ms）推送，这里留约 6 倍余量吸收抖动。之所以必须有它：推送线程
 * 一旦停摆（worker 重启、RTDE 掉线），缓存会永远停在最后一笔 —— 拿陈旧姿态冒充实时读数
 * 比"回退去读一次（并按既有规则报 stale）"危险得多。
 */
export const TWIN_PUSH_FRESH_MS = 300;

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
 * @param {(ip: string) => ({at: number, ts: number, q: number[], tcp: number[]}|undefined)} [deps.telemetry]
 *   worker 主动推送的最新遥测（`lib/worker.js` 的 `latestTelemetry`）。提供它时，读数
 *   优先走这条**零往返**通道 —— 机器人运动期间 stdin 队列被占住，只有它还出得了数。
 *   缺省为空实现，行为与改动前一致。
 * @param {number} [deps.pushFreshMs=TWIN_PUSH_FRESH_MS] 推送缓存的新鲜窗口，超过就回退显式读
 * @returns {(query?: {ip?: string, detail?: string}) => Promise<{status: number, headers: object, body: object}>}
 */
export function createTwinStateHandler({
  worker,
  connectedIps,
  modelFor,
  staleMaxMs,
  now,
  telemetry,
  pushFreshMs,
} = {}) {
  const registry = typeof connectedIps === 'function' ? connectedIps : () => new Set();
  const memo = typeof modelFor === 'function' ? modelFor : () => null;
  const clock = typeof now === 'function' ? now : Date.now;
  const staleWindowMs = Number.isFinite(staleMaxMs) && staleMaxMs >= 0 ? staleMaxMs : TWIN_STALE_MAX_MS;
  /**
   * 读主动推送的缓存。**任何异常都降级成"没有推送"**：遥测推送是加分项，它出问题只能
   * 让这一帧回退到显式读，绝不能让整个状态查询失败。
   */
  const readPushed = (ip) => {
    if (typeof telemetry !== 'function') return undefined;
    try {
      const value = telemetry(ip);
      return value !== null && typeof value === 'object' ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const pushFreshWindowMs = Number.isFinite(pushFreshMs) && pushFreshMs >= 0 ? pushFreshMs : TWIN_PUSH_FRESH_MS;
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
      /*
       * ① 新鲜推送优先：这条路上**没有任何 worker 往返**，所以机器人正在执行运动命令
       * （stdin 队列被运动确认循环占住）时它照样出帧 —— 这就是"数字孪生完整跟随机器人
       * 动作"的实现。② 推送缺失或过期时才回退到显式读：静止时的常规路径，也是推送线程
       * 万一停摆时的安全网。
       */
      let q = [];
      let tcp = [];
      let frameTs = clock();
      const pushed = readPushed(ip);
      if (pushed !== undefined && clock() - pushed.at <= pushFreshWindowMs) {
        q = Array.isArray(pushed.q) ? pushed.q : [];
        tcp = Array.isArray(pushed.tcp) ? pushed.tcp : [];
        // 采样时刻由 worker 提供（与宿主同一台机器），客户端据此算"数据停了多久"。
        if (Number.isFinite(pushed.ts)) frameTs = pushed.ts;
      } else {
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
        q = Array.isArray(jp?.data?.joint_positions) ? jp.data.joint_positions : [];
        tcp = Array.isArray(tp?.data?.tcp_pose) ? tp.data.tcp_pose : [];
      }

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
        // 读数时间：推送路径用 worker 的采样时刻，读路径用本次读取时刻。客户端据此算
        // "数据停了多久"，所以它必须来自采样，而不是推送/响应的到达时间。
        ts: frameTs,
        ...(degraded ? { degraded: true, ...degraded } : {}),
      };

      // 待审批的运动目标（清单第 8 条：先看后动）：审批弹窗说"要动了"，孪生面板同步把
      // 目标画出来 —— 比弹窗里一串数字强得多。
      //
      // 没有待审批时**整个字段缺席**（而不是给 null），client 一眼就能区分"当前没有审批"
      // 与"有审批但解析不出目标"。
      const pending = pendingMotion.read(ip);
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
          /*
           * ⚠️ `pending_motion` **不跟着回放**。
           *
           * 审批状态在**宿主侧**（`pendingMotion` 存储），与 worker 忙不忙无关，随时可读；
           * 而原样回放整块 `cached.body` 会把一份**最多 30 s 前**的审批目标继续画在面板上 ——
           * 那个审批可能早就结束了。客户端据此以为还有待批动作，正是"先看后动"最不该出现的
           * 假象。所以这一项现场重读：没有就**删掉字段**（客户端用它区分"当前没有审批"与
           * "有审批但解析不出目标"）。
           */
          const replay = { ...cached.body };
          delete replay.pending_motion;
          const livePending = pendingMotion.read(ip);
          if (livePending !== null) replay.pending_motion = livePending;
          return {
            status: 200,
            headers: STATE_HEADERS,
            body: {
              // 其余字段原样回放（含**原来的** ts）。
              ...replay,
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
 * 同时允许的 SSE 连接数上限（0.7.5 / 契约 C8）。
 *
 * 为什么必须有：孪生的每一帧都会向**同一个单线程** Python worker 发读请求（推送缓存新鲜时
 * 为零，推送停摆时每帧 2 次）。`lib/worker.js` 的 `maxInFlight` 是 8，一旦被孪生的读堆满，
 * 模型下发的**运动指令会被 `WORKER_BUSY` 直接拒绝** —— 可视化通道把控制通道挤死了。
 * 一台工作站同时开 4 个窗口看孪生已经足够；第 5 条连接返回 429（不影响已建立的连接）。
 */
export const MAX_TWIN_STREAMS = 4;

/**
 * 空闲超时（毫秒）：连续这么久**一个数据事件都没能发出去**就关闭连接（0.7.5 / C8）。
 *
 * 典型场景：客户端进程被挂起 / 网络半开，`res.write()` 返回 false 之后永远等不到 `drain`。
 * 此时既不能继续往写缓冲里堆 JSON（内存无界增长），也不能让这条连接永久占着并发名额，
 * 所以由心跳定时器兼任看门狗，到点 `res.end()` 并把名额还给后面的连接。
 */
export const TWIN_STREAM_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

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
 * ## 不变量（0.7.5 / 契约 C8 加固）
 * 1. **并发上限**：同时最多 `MAX_TWIN_STREAMS` 条连接；第 N+1 条直接 429（JSON + code），
 *    不进状态机、不占定时器。连接关闭（任何原因）立刻把名额还回去。
 * 2. **共享帧泵（全局单帧合并）**：按**机器人 ip** 分组，每组只有一个 `setInterval` 与
 *    **最多一个在飞读**，帧读完直接**广播**给该组所有连接。以前每个连接各自起一条 10 Hz
 *    读链 —— 4 条连接就是 4 倍 worker 调用，会把单线程 worker 的 8 个在飞名额堆满，让
 *    运动指令被 `WORKER_BUSY` 拒绝；现在 4 条连接等于 1 条（1×）。新连接若赶上在飞帧，
 *    直接复用同一个 Promise。
 *    ⚠️ **合并不跨 ip**：把机器人 B 的位姿推给 A 是比"多读几次"严重得多的问题。
 * 3. **背压**：`res.write()` 返回 false 就停止写（连心跳也不写），并等 `drain`；这期间
 *    **不发起新的读**（既省 worker，也不让写缓冲无界增长）。`drain` 到来立即补一帧。
 *    一个组里所有连接都在背压时，整组暂停读取（读了也发不出去）。
 * 4. **空闲看门狗**：连续 `idleTimeoutMs` 没有任何数据事件发出去 ⇒ 关闭连接、释放名额。
 * 5. **清理**：`close`/`error`（请求或响应）都走同一个幂等 `cleanup()`：从组里摘除、
 *    组空则清掉共享定时器与可能永不 settle 的在飞帧、摘掉 `drain` 监听、`res.end()` 一次。
 * 6. 单帧的失败/超时**绝不**关闭连接，也绝不结束响应。
 *
 * @param {object} deps 与 `createTwinStateHandler` 相同，另加 `intervalMs` / `heartbeatMs` /
 *   `detailMs` / `staleNotifyMs` / `frameTimeoutMs` / `idleTimeoutMs` / `maxStreams` / `now`
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
  const idleTimeoutMs = Number.isFinite(deps.idleTimeoutMs) && deps.idleTimeoutMs > 0
    ? deps.idleTimeoutMs
    : TWIN_STREAM_IDLE_TIMEOUT_MS;
  const maxStreams = Number.isFinite(deps.maxStreams) && deps.maxStreams > 0
    ? Math.floor(deps.maxStreams)
    : MAX_TWIN_STREAMS;
  const now = typeof deps.now === 'function' ? deps.now : Date.now;

  /** 已建立的 SSE 连接数（429 与被拒的请求不计）。 */
  let activeStreams = 0;
  /**
   * 共享帧泵分组：`ip 键 → { key, subscribers, inFlight, lastDetailAt, timer }`。
   *
   * 键是规范化后的 `?ip=`（空串 = "由宿主解析到唯一那台"）。同一台机器人的所有连接共享
   * 一个定时器与一次读 —— 这就是"4 条连接 = 1 份 worker 调用"的实现。
   */
  const groups = new Map();

  /** 组内**可接收**的订阅者（未关闭且不在背压中）；没有就这一拍不读。 */
  const firstWritable = (group) => {
    for (const subscriber of group.subscribers) {
      if (subscriber.closed !== true && subscriber.writable === true) return subscriber;
    }
    return null;
  };

  /** 帧泵：每组每拍最多一次真实读，读完广播（**并发去重与限流的唯一入口**）。 */
  const pumpGroup = (group) => {
    if (group.subscribers.size === 0) return;

    const inFlight = group.inFlight;
    if (inFlight !== null) {
      // 读还没回来：每连接按自己的节流发 stale（保持"绝不静默"），共享超时只判一次。
      for (const subscriber of group.subscribers) subscriber.notifyStalled(inFlight);
      if (now() - inFlight.startedAt > frameTimeoutMs) {
        /*
         * 安全网：共享帧可能永不 settle。不放弃的话**所有**连接会永远复用这个僵尸 Promise
         * （以前每连接各有一个 inFlight，放弃即释放，没这个问题）。放弃是组级的：
         * 标记 abandoned（它之后真回来了也不广播），清槽，然后广播 frame-error。
         */
        inFlight.abandoned = true;
        if (group.inFlight === inFlight) group.inFlight = null;
        for (const subscriber of group.subscribers) subscriber.onFrameTimeout();
      }
      return;
    }

    const representative = firstWritable(group);
    if (representative === null) return; // 整组都在背压/已关闭：这一拍不读

    const query = { ...representative.query };
    // 键就是 ip（空串 = 省略，让宿主解析）；显式回填，避免代表者的 URL 拼写差异。
    if (group.key !== '') query.ip = group.key;
    const wantsDetail = detailMs > 0 && now() - group.lastDetailAt >= detailMs;
    if (wantsDetail) {
      group.lastDetailAt = now();
      query.detail = '1';
    }

    const entry = { startedAt: now(), wantsDetail, settled: false, abandoned: false, promise: null };
    entry.promise = (async () => {
      try {
        return { ok: true, result: await readState(query) };
      } catch (error) {
        return { ok: false, error };
      } finally {
        entry.settled = true;
        if (group.inFlight === entry) group.inFlight = null;
      }
    })();
    group.inFlight = entry;

    entry.promise.then((outcome) => {
      // 已被超时安全网放弃 / 组已解散：这帧不广播（否则会重复上报同一帧）。
      if (entry.abandoned === true || group.subscribers.size === 0) return;
      if (outcome.ok !== true) {
        for (const subscriber of group.subscribers) subscriber.onFrameError(outcome.error);
        return;
      }
      const body = outcome.result?.body ?? {};
      for (const subscriber of group.subscribers) subscriber.onFrame(body);
    }).catch(() => {
      /* 单帧回调自身的异常不得打死连接（订阅者的 writeEvent 已自带 try/catch，这里是兜底） */
    });
  };

  /** 加入组（必要时建组 + 起共享定时器）；返回组，便于连接侧立刻要一帧。 */
  const joinGroup = (key, subscriber) => {
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        key,
        subscribers: new Set(),
        inFlight: null,
        lastDetailAt: Number.NEGATIVE_INFINITY,
        timer: null,
      };
      groups.set(key, group);
    }
    group.subscribers.add(subscriber);
    if (group.timer === null) {
      group.timer = setInterval(() => pumpGroup(group), intervalMs);
    }
    return group;
  };

  /** 订阅者离开；组空了就彻底回收（定时器、在飞帧、Map 条目）。 */
  const releaseGroup = (group) => {
    if (group.subscribers.size > 0) return;
    if (group.timer !== null) clearInterval(group.timer);
    group.timer = null;
    // 没有订阅者了：丢掉可能永不 settle 的共享帧，别让下一个连接复用一个僵尸 Promise。
    group.inFlight = null;
    if (groups.get(group.key) === group) groups.delete(group.key);
  };

  return function handleTwinStream(req, res) {
    if (req?.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('allow', 'GET');
      res.end();
      return;
    }

    /*
     * 并发上限（C8）：先拒后建。429 用 JSON 而不是 SSE —— 浏览器 EventSource 会把非 200
     * 当错误并按自己的退避重连，不会把 429 的正文当事件派发，所以这里只需要 code 可读。
     */
    if (activeStreams >= maxStreams) {
      res.writeHead(429, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': NO_STORE,
        'retry-after': '1',
      });
      res.end(JSON.stringify({
        error: 'too many twin streams',
        code: TWIN_CODES.TOO_MANY_STREAMS,
        message: `数字孪生实时流最多同时 ${maxStreams} 条连接，请先关闭其它窗口`,
        max: maxStreams,
      }));
      return;
    }
    activeStreams += 1;

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': NO_STORE,
      connection: 'keep-alive',
      // 反向代理常见的缓冲会把 SSE 攒成一坨再吐，显式关掉。
      'x-accel-buffering': 'no',
    });

    const query = queryOf(req?.url);
    const key = textOf(query.ip);

    /**
     * 这一条连接的全部状态。共享泵通过下面挂上去的方法驱动它。
     */
    const conn = {
      query,
      closed: false,
      /** 写缓冲是否已满（`res.write() === false` 之后置 false，`drain` 后恢复）。 */
      writable: true,
      /** 是否挂过 `drain` 监听（清理时要摘掉）。 */
      drainBound: false,
      frameErrors: 0,
      lastStaleAt: Number.NEGATIVE_INFINITY,
      /** 最后一次**成功写出去的数据事件**时刻（空闲看门狗的判据；心跳不算）。 */
      lastFrameAt: now(),
      notifyStalled: () => {},
      onFrame: () => {},
      onFrameError: () => {},
      onFrameTimeout: () => {},
    };

    let group = null;
    let beat = null;

    /** 尽力移除监听：宿主/测试的假对象可能没有 `removeListener`。 */
    const off = (target, event, listener) => {
      try {
        target?.removeListener?.(event, listener);
      } catch {
        /* 忽略 */
      }
    };

    /** `drain`：写缓冲排空 ⇒ 恢复写入；若组里没有在飞帧，立刻补一帧。 */
    const onDrain = () => {
      conn.drainBound = false;
      conn.writable = true;
      if (conn.closed) return;
      if (group !== null && group.inFlight === null) void pumpGroup(group);
    };

    /**
     * 写一个 SSE 事件。
     *
     * 返回 false 表示"这一帧没写出去"（关闭中 / 背压中 / 写失败）。`res.write() === false`
     * 时挂一次 `drain` 并把 `writable` 置 false —— 在此之前**不再写任何东西**（含心跳），
     * 因为继续写在 Node 里只会堆进写缓冲。
     */
    const writeEvent = (event, data) => {
      if (conn.closed || !conn.writable) return false;
      try {
        const ok = res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        if (ok === false) {
          conn.writable = false;
          if (typeof res.once === 'function') res.once('drain', onDrain);
          else if (typeof res.on === 'function') res.on('drain', onDrain);
          conn.drainBound = true;
        } else {
          conn.lastFrameAt = now();
        }
        return ok !== false;
      } catch {
        // 写失败即视为断开；cleanup 由 close 事件兜底。
        return false;
      }
    };

    /** 读还没回来：至少让客户端知道"数据停在哪儿了"（静默停帧是不可接受的）。 */
    conn.notifyStalled = (frame) => {
      if (conn.closed) return;
      const at = now();
      if (at - conn.lastStaleAt < staleNotifyMs) return;
      conn.lastStaleAt = at;
      writeEvent(TWIN_STREAM_STALE_EVENT, {
        pendingMs: Math.max(0, at - frame.startedAt),
        timeoutMs: frameTimeoutMs,
      });
    };

    /** 共享帧读成功：写一帧 state。 */
    conn.onFrame = (body) => {
      writeEvent('state', body);
    };

    /** 单帧读抛错：发 frame-error（**绝不**拆流），客户端保留上一帧。 */
    conn.onFrameError = (error) => {
      if (conn.closed) return;
      conn.frameErrors += 1;
      writeEvent(TWIN_STREAM_FRAME_ERROR_EVENT, {
        reason: 'read_failed',
        message: error instanceof Error ? error.message : String(error),
        frameErrors: conn.frameErrors,
      });
    };

    /** 共享帧超过 `frameTimeoutMs` 未 settle：发 frame-error（reason 与旧实现保持一致）。 */
    conn.onFrameTimeout = () => {
      if (conn.closed) return;
      conn.frameErrors += 1;
      writeEvent(TWIN_STREAM_FRAME_ERROR_EVENT, {
        reason: 'read_timeout',
        message: `这一帧的状态读取超过 ${frameTimeoutMs}ms 仍未返回，已放弃该帧（流保持连接）`,
        frameErrors: conn.frameErrors,
      });
    };

    /** 幂等清理：心跳定时器、组内条目、drain/close 监听、并发名额。 */
    function cleanup() {
      if (conn.closed) return;
      conn.closed = true;
      activeStreams = Math.max(0, activeStreams - 1);
      if (beat !== null) clearInterval(beat);
      beat = null;
      if (group !== null) {
        group.subscribers.delete(conn);
        releaseGroup(group);
      }
      if (conn.drainBound) {
        off(res, 'drain', onDrain);
        try {
          res.off?.('drain', onDrain);
        } catch {
          /* 忽略 */
        }
        conn.drainBound = false;
      }
      off(req, 'close', cleanup);
      off(req, 'error', cleanup);
      off(res, 'close', cleanup);
      off(res, 'error', cleanup);
      try {
        res.end();
      } catch {
        /* 已断开 */
      }
    }

    group = joinGroup(key, conn);
    // 立刻推第一帧：订阅者不该先干等一个 interval。若组里已有在飞帧，它结算时就会广播给
    // 本连接（新连接复用同一个 Promise）。
    if (group.inFlight === null) void pumpGroup(group);

    beat = setInterval(() => {
      if (conn.closed) return;
      // 空闲看门狗（C8）：这么久一个数据事件都没出去 ⇒ 客户端已经不可用，回收名额。
      if (now() - conn.lastFrameAt > idleTimeoutMs) {
        cleanup();
        return;
      }
      // 背压中连心跳都不写：否则 Node 的写缓冲会无界增长（客户端永远不 drain 的话）。
      if (!conn.writable) return;
      try {
        res.write(': ping\n\n');
      } catch {
        /* 已断开 */
      }
    }, heartbeatMs);

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

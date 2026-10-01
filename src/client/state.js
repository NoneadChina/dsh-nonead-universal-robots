// src/client/state.js — 客户端唯一数据源：HTTP 轮询 host 的只读状态路由，分发给订阅者。
//
// **Ruling 20/22（必须遵守）**：客户端半**不得** import host 半的路由模块
// `lib/twin-routes.js`（它要 `node:fs`，被打进浏览器 bundle 会解析失败/带入 Node 内置模块）。
// 路径常量的唯一真源是**零 import** 的 `lib/twin-paths.js`：host 与 client 都 import 它，
// 由 esbuild 在构建期把两个字符串内联进 bundle ⇒ 不可能漂移。
//
// 本文件除下面这两条 import 之外不得有其它 import（尤其不得出现 `node:`）。
// 第二条是本包**自己的**浏览器侧模块（零 `node:`），不违反上面那条 Ruling。
import { TWIN_STATE_PATH, TWIN_STREAM_PATH } from '../../lib/twin-paths.js'
import { createTwinStream, streamUrlFor } from './robot/twin-stream.js'

export { TWIN_STATE_PATH, TWIN_STREAM_PATH }

/**
 * 下一轮轮询间隔（纯函数，可单测）。
 *
 * @param {number} current 当前间隔（ms）
 * @param {boolean} ok 本轮是否成功（**只有 `body.connected === true` 才算成功**，Ruling 21）
 * @param {number} baseMs 基础间隔
 * @param {number} maxMs 退避上限
 * @returns {number}
 */
export function nextInterval(current, ok, baseMs, maxMs) {
  if (ok) return baseMs
  return Math.min(maxMs, Math.max(baseMs, current * 2))
}

/**
 * 给状态路由 URL 追加 `detail=1`（已有查询串时用 `&`）。纯函数，便于单测。
 *
 * @param {string} url 状态路由 URL（可能带 `?ip=…`）
 * @returns {string} 追加了 `detail=1` 的 URL
 */
export function withDetailQuery(url) {
  return `${url}${url.includes('?') ? '&' : '?'}detail=1`
}

/**
 * 创建轮询状态源。
 *
 * @param {object} options
 * @param {typeof fetch} [options.fetchImpl] 取数实现（注入点，测试用假 fetch）
 * @param {string} [options.ip] 机器人 IP。**可省略**（Ruling 35）：省略/空白时不拼 `?ip=`，
 *   由 host 依据其连接注册表解析到"当前已连接的那一个机器人"——浏览器半不该猜机器人地址。
 * @param {number} [options.baseMs=100] 基础间隔
 * @param {number} [options.maxMs=2000] 退避上限 / 后台标签降频间隔
 * @param {number} [options.detailMs=2000] 附带 `detail=1` 的节拍（毫秒）；位姿频率不受影响
 * @param {() => number} [options.now=() => Date.now()] 时钟（注入点，测试用假时钟）
 */
export function createTwinState({
  fetchImpl = globalThis.fetch,
  ip,
  baseMs = 100,
  maxMs = 2000,
  detailMs = 2000,
  now = () => Date.now(),
  /**
   * 用 **SSE 实时流**替代 10 Hz 轮询（清单第 20 条）。
   *
   * ⚠️ **两者互斥**：并存会让同一帧被推两次、画面在两套时间轴之间抖动。所以这是
   * "整体切过去"，不是"再叠一层"。
   */
  stream = false,
  /** SSE 实现注入点（测试用假 EventSource；缺省走 `createTwinStream`）。 */
  streamFactory,
} = {}) {
  // 只有显式给了非空 IP 才拼查询串；否则交给 host 解析（Ruling 35）。
  // `let` 而不是 `const`：清单第 19 条要支持在面板上**切换**目标机器人。
  let currentIp = typeof ip === 'string' && ip.trim() !== '' ? ip.trim() : ''
  const targetFor = (value) => (value === '' ? TWIN_STATE_PATH : `${TWIN_STATE_PATH}?ip=${encodeURIComponent(value)}`)
  let target = targetFor(currentIp)
  /**
   * 上一次带上 `detail=1` 的时刻（毫秒）。
   *
   * **detail 走"慢节拍"而不是第二条轮询链**：host 的 detail 是 dashboard 往返（明显贵于一次
   * 位姿读），但另起一条链会与位姿链并发、把"同一时刻只有一次取数在飞行中"这条既有约束打破。
   * 所以这里在既有的那一条链上按 `detailMs` 节流地追加 `detail=1`，位姿频率不变、并发度不变。
   */
  let lastDetailAt = -Infinity
  let snapshot = {
    connected: false,
    model: '',
    q: [],
    tcp: [],
    ts: 0,
    error: null,
    // host 的机器可读失败原因：`code` 让 UI 能区分"没连机器人 / worker 挂了 /
    // 多台机器人有歧义"，`ips` 是歧义时的候选，`ip` 是本次实际解析到的机器人。
    code: null,
    ips: [],
    ip: null,
    degraded: false,
    /**
     * dashboard 侧状态（`safety_mode` / `robot_mode` / `program_state` / `speed_scaling` /
     * `joint_temperatures` / `joint_currents` / `robot_voltage` / `robot_current` / `up_time_seconds` …），
     * 只在带 `detail=1` 的那一轮刷新；其余轮次**保留上一次的值**，免得面板随位姿频率闪烁。
     */
    detail: null,
    /**
     * 待审批的运动目标（清单第 8 条）。与 `detail` **不同**：它不沿用上一轮的值 ——
     * 审批一结束 host 就不再返回这个字段，沿用会让画面永远挂着一个已经结束的目标。
     */
    pendingMotion: null,
  }
  const listeners = new Set()
  let timer = null
  let interval = baseMs
  let stopped = true
  // 轮询链代次：`stop()` / 重启都会自增，让仍在飞行中的旧 tick 回来后自行退出。
  // 这样 `stop()` 后紧跟 `start()`（旧请求尚未返回）也不会并存两条链。
  let generation = 0
  // 取消在飞的取数：`stop()` 之后不得再有任何网络活动（以前 stop 只清定时器，
  // 一个已经发出的请求仍会跑完，最长可拖 60 s）。
  let inflight = null
  /** SSE 流句柄（`stream=false` 时恒为 `null`，一切走轮询）。 */
  let streamHandle = null
  let unsubscribeStream = null

  /** 拆掉当前的流订阅（幂等）。 */
  function teardownStream() {
    if (unsubscribeStream !== null) {
      unsubscribeStream()
      unsubscribeStream = null
    }
    streamHandle?.stop?.()
    streamHandle = null
  }

  /**
   * 建起流订阅（换目标 IP 时也要重建 —— 旧流还在推上一台的数据）。
   *
   * 收到帧后走**同一个** `applyBody`，所以流与轮询的语义不可能漂移。
   */
  function setupStream() {
    teardownStream()
    const factory = typeof streamFactory === 'function' ? streamFactory : createTwinStream
    streamHandle = factory({ url: streamUrlFor(TWIN_STREAM_PATH, currentIp) })
    unsubscribeStream = streamHandle.subscribe((frame) => {
      // `null` 表示"还没有第一帧"（例如刚 start 或刚重连），此时保留上一帧不动，
      // 免得画面闪成空白。
      if (stopped || frame === null || frame === undefined) return
      applyBody(frame)
      emit()
    })
    if (!stopped) streamHandle.start()
  }

  const emit = () => {
    for (const listener of listeners) {
      // 单个订阅者抛错不得影响其它订阅者，也不得中断轮询（Ruling：逐个 try/catch）。
      try { listener(snapshot) } catch { /* 订阅者自身的问题，吞掉 */ }
    }
  }

  /**
   * 把一帧状态 body 应用成快照。**轮询与 SSE 流共用这一个函数**。
   *
   * 抽出来是刻意的：两条数据源如果各写一份赋值逻辑，迟早会在某个字段上漂移
   * （比如某天只给轮询那条加了新字段），而那种 bug 在只有一条路被测试时看不出来。
   *
   * @param {object} body host 状态路由的响应体
   * @returns {boolean} 是否"确实连上了机器人"
   */
  function applyBody(body) {
    // **Ruling 21**：只有"确实连上机器人"才算成功。
    const ok = body?.connected === true
    snapshot = ok
      ? {
          connected: true,
          model: body.model,
          q: body.q,
          tcp: body.tcp,
          ts: body.ts,
          error: null,
          code: null,
          ips: [],
          ip: body.ip ?? null,
          degraded: body.degraded === true,
          // 不带 detail 的那一轮沿用上一次的值（`?? snapshot.detail`），
          // 这样面板上的安全模式/温度不会被位姿帧抹成空白。
          detail: body.detail ?? snapshot.detail ?? null,
          // 刻意**不**沿用上一轮：审批结束时 host 不再返回它，这里必须跟着清掉。
          pendingMotion: body.pending_motion ?? null,
        }
      // 失败/未连接时保留上一次的 model/q/tcp，只置 connected=false 并写原因，
      // 这样 UI 不会闪成空白。同时保留上一帧的 ips（多机候选要能一直显示，
      // 否则用户永远点不到那个选择器）。
      : {
          ...snapshot,
          connected: false,
          error: body?.reason ?? body?.error ?? 'not connected',
          code: body?.code ?? null,
          ips: Array.isArray(body?.ips) ? body.ips : [],
          ip: body?.ip ?? snapshot.ip ?? null,
          degraded: false,
          // 未连接就没有"待审批"可言。
          pendingMotion: null,
        }
    return ok
  }

  async function tick(gen) {
    let ok = false
    // 只有"上一轮确实连上了"才去要 detail：未连接时一次都不问，既省 dashboard 往返，
    // 也保证第一条请求永远是纯位姿 URL（测试与线上抓包都依赖这一点）。
    const wantDetail = snapshot.connected === true && now() - lastDetailAt >= Math.max(0, detailMs)
    if (wantDetail) lastDetailAt = now()
    try {
      // `cache: 'no-store'`：状态是实时遥测，命中 HTTP 缓存比拿不到更糟。
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      inflight = controller
      const res = await fetchImpl(
        wantDetail ? withDetailQuery(target) : target,
        controller ? { cache: 'no-store', signal: controller.signal } : undefined,
      )
      const body = await res.json()
      // **Ruling 21**：只有"确实连上机器人"才算成功。未连接时也要退避到 maxMs，
      // 否则会对着一条离线机器人以 10 Hz 空转，白白打满 host 路由与 worker 调用。
      // 重连检测延迟最多 maxMs（2 s），可接受。
      ok = applyBody(body)
    } catch (e) {
      // AbortError 是我们自己取消的（stop/重启），不是故障：不覆盖快照、不报错。
      if (e instanceof Error && e.name === 'AbortError') return
      snapshot = { ...snapshot, connected: false, error: e instanceof Error ? e.message : String(e), code: null, degraded: false }
      ok = false
    } finally {
      inflight = null
    }

    // 已被 stop() 或重启取代：不再通知、不再续链（stop 之后不得再有新的取数）。
    if (stopped || gen !== generation) return

    emit()
    interval = nextInterval(interval, ok, baseMs, maxMs)
    // 浏览器后台标签降频；Node（单测）环境没有 document，必须容错。
    const hidden = typeof document !== 'undefined' && document.hidden === true
    timer = setTimeout(() => tick(gen), hidden ? maxMs : interval)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    /**
     * 切换目标机器人（清单第 19 条：多机选择）。
     *
     * ⚠️ 切换时必须**清掉上一台的读数**：否则会把 A 的位姿当成 B 显示出来 —— 那比空白
     * 危险得多（操作员会以为 B 就在那个位置）。所以 `connected` 置 false、q/tcp 清空，
     * 让面板诚实地退回"未连接"。
     */
    setIp(nextIp) {
      const normalized = typeof nextIp === 'string' ? nextIp.trim() : ''
      if (normalized === currentIp) return
      currentIp = normalized
      target = targetFor(normalized)
      snapshot = {
        ...snapshot,
        connected: false,
        model: '',
        q: [],
        tcp: [],
        ts: 0,
        error: null,
        code: null,
        ips: [],
        ip: normalized === '' ? null : normalized,
        degraded: false,
        detail: null,
        pendingMotion: null,
      }
      // 立刻通知一次：面板要马上显示"换了目标、还没连上"，而不是留上一台的画面。
      emit()
      if (stream) {
        // 流模式：换目标等于换一条流，必须整体重建（旧流还在推上一台的数据）。
        if (!stopped) setupStream()
        return
      }
      // 取消在飞的旧请求，再立刻取一次 —— 不干等下一个 tick。
      // 旧 tick 回来后会被尾部的 `gen !== generation` 检查丢弃。
      try { inflight?.abort?.() } catch { /* 忽略 */ }
      inflight = null
      if (!stopped) tick(++generation)
    },
    /** 当前目标 IP（空串表示"交给宿主解析"）。 */
    getIp: () => currentIp,
    start() {
      // 重复 start 不得并行出两条轮询链（流模式同理：不得并存两条流）。
      if (!stopped) return
      stopped = false
      if (stream) {
        setupStream()
        return
      }
      tick(++generation)
    },
    stop() {
      stopped = true
      generation++
      if (stream) {
        teardownStream()
        return
      }
      if (timer) { clearTimeout(timer); timer = null }
      // 取消在飞的请求，并让它的 catch 分支安静退出（不写错误快照）。
      try { inflight?.abort?.() } catch { /* 忽略 */ }
      inflight = null
    },
  }
}

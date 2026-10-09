/**
 * 实时状态流订阅（清单第 20 条：SSE 实时跟随）。
 *
 * ## 与 10 Hz 轮询的关系：**互斥**
 *
 * `state.js` 的轮询链有代次（`generation`）与在飞取消（`inflight`）两套机制，再加上
 * "后台标签降频"。如果流与轮询**并存**，同一帧会被推两次，画面在两套时间轴之间抖动。
 * 所以本模块是**独立**的：要用流就整体切过去（`createTwinState({ stream: true })`），
 * 不要两者同开。
 *
 * ## 三条"永不自断"的硬约束（0.6.6，都是真机上踩出来的）
 *
 * 1. **服务端发来的 `error` 事件不是连接故障。** 浏览器把 `EventSource.onerror` 实现成
 *    `addEventListener('error', …)`，而服务端事件按 `event:` 字段派发 ⇒ 宿主那条"单帧读失败
 *    只发一个 error 事件、绝不拆流"的策略，在真实浏览器里会**恰好反过来**：每来一个 error
 *    帧就拆一次流。实测见 `scripts/probe-twin-stream-error-event.mjs`。所以这里按
 *    "事件带不带 `data`"区分：带 `data` 的是服务端消息（单帧失败，保留上一帧继续），
 *    不带的是传输层错误（才重连）。
 * 2. **永不永久放弃。** 以前"连续 8 次重连失败 ⇒ gaveup"是个终态：此后不再有任何定时器、
 *    不再建连，画面永远停在最后一帧。可真实世界里的断流（宿主重启、窗口最小化时被浏览器
 *    掐掉连接、笔记本休眠/唤醒）恰恰是"连续失败十几次、之后又能连上"的形状。
 *    ⇒ 现在改成**无限重连 + 指数退避封顶**（1 s → 2 s → … → 30 s），并且收到**真帧**才
 *    把退避清零（不是收到 `open` 就清零：一个"能连上但一帧都不发"的端点不该重置预算）。
 * 3. **`poke()` 是自愈入口。** 面板在"窗口重新可见"和"数据停滞过久"时会调用它立刻重试，
 *    不必等到下一个退避节拍（也可能是浏览器把定时器节流了，等不到）。
 *
 * ## 可测性
 *
 * `EventSource` 通过 `EventSourceImpl` 注入，`setTimeout`/`clearTimeout` 也可注入，
 * 因此可以在 Node 里确定性地测"连上 → 收帧 → 断线 → 自动重连 → 长时间断线 → 恢复 → 停止"
 * 整条生命周期，不需要真浏览器，也不必真的等 30 s。
 */

/** 断线后自动重连的基础间隔（毫秒）。 */
export const TWIN_STREAM_RETRY_MS = 1000

/** 指数退避的上限（毫秒）。到顶之后就按这个节拍一直试下去，永不放弃。 */
export const TWIN_STREAM_MAX_RETRY_MS = 30000

/**
 * 服务端的**单帧失败**事件名（与宿主 `lib/twin-routes.js` 的
 * `TWIN_STREAM_FRAME_ERROR_EVENT` 保持一致）。
 *
 * 这里**不据名字判断**（只据"带不带 data"判断）—— 名字是文档，判据是机制：
 * 只要宿主的任意事件名不是 `error`，就不会再被 `onerror` 接走。
 */
export const TWIN_STREAM_FRAME_ERROR_EVENT = 'frame-error'

/** 服务端的"数据停滞"事件名（读还没回来；客户端保留上一帧）。 */
export const TWIN_STREAM_STALE_EVENT = 'stale'

/**
 * 第 `attempt` 次（1 基）重连应等待的毫秒数：`retryMs × 2^(attempt-1)`，封顶 `maxRetryMs`。
 *
 * 纯函数：退避策略可单测，不必真的等。
 *
 * @param {number} attempt 1 基的重连次数
 * @param {number} [baseMs=TWIN_STREAM_RETRY_MS]
 * @param {number} [maxMs=TWIN_STREAM_MAX_RETRY_MS]
 * @returns {number}
 */
export function retryDelayMs(attempt, baseMs = TWIN_STREAM_RETRY_MS, maxMs = TWIN_STREAM_MAX_RETRY_MS) {
  const base = Number.isFinite(baseMs) && baseMs >= 0 ? baseMs : TWIN_STREAM_RETRY_MS
  const cap = Number.isFinite(maxMs) && maxMs > 0 ? maxMs : TWIN_STREAM_MAX_RETRY_MS
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 1
  // `2 ** (n - 1)` 在 n 很大时会溢出成 Infinity，`Math.min` 会把它收回来；仍然显式钳一遍。
  const grown = base * 2 ** Math.min(n - 1, 40)
  return Math.min(cap, Math.max(base, Number.isFinite(grown) ? grown : cap))
}

/**
 * 创建一个状态流订阅器。
 *
 * @param {object} options
 * @param {string} options.url 流路由地址（`?ip=…` 由调用方拼好）
 * @param {new (url: string) => object} [options.EventSourceImpl=globalThis.EventSource] 注入点
 * @param {number} [options.retryMs=TWIN_STREAM_RETRY_MS] 首次重连间隔
 * @param {number} [options.maxRetryMs=TWIN_STREAM_MAX_RETRY_MS] 退避上限（**不是**放弃阈值）
 * @param {(fn: () => void) => unknown} [options.setTimeoutImpl] 注入点（测试用假定时器）
 * @param {(handle: unknown) => void} [options.clearTimeoutImpl] 注入点
 * @returns {{subscribe: (listener: (snapshot: object|null, meta?: object) => void) => () => void,
 *            start: () => void, stop: () => void, poke: (force?: boolean) => boolean,
 *            getSnapshot: () => object|null, getStatus: () => 'idle'|'connecting'|'open'|'retrying'|'unsupported',
 *            getFrames: () => number, getFrameErrors: () => number, getStaleCount: () => number}}
 */
export function createTwinStream(options = {}) {
  const EventSourceImpl = options.EventSourceImpl ?? globalThis.EventSource
  const retryMs = Number.isFinite(options.retryMs) && options.retryMs >= 0 ? options.retryMs : TWIN_STREAM_RETRY_MS
  const maxRetryMs = Number.isFinite(options.maxRetryMs) && options.maxRetryMs > 0
    ? options.maxRetryMs
    : TWIN_STREAM_MAX_RETRY_MS
  const schedule = typeof options.setTimeoutImpl === 'function' ? options.setTimeoutImpl : globalThis.setTimeout
  const cancel = typeof options.clearTimeoutImpl === 'function' ? options.clearTimeoutImpl : globalThis.clearTimeout

  const listeners = new Set()
  let source = null
  let timer = null
  /** 连续失败次数（收到**真帧**才清零，见文件头第 2 条）。 */
  let retries = 0
  let status = 'idle'
  let snapshot = null
  let stopped = true
  /** 诊断计数：面板据此说"收了 N 帧 / 失败了 M 帧"，而不只是"未连接"。 */
  let frames = 0
  let frameErrors = 0
  let staleCount = 0

  const emit = (meta = { kind: 'status' }) => {
    for (const listener of listeners) {
      // 单个订阅者抛错不得影响其它订阅者，也不得中断流。
      try { listener(snapshot, meta) } catch { /* 订阅者自身的问题，吞掉 */ }
    }
  }

  const teardown = () => {
    if (timer !== null) { cancel(timer); timer = null }
    const current = source
    source = null
    try { current?.close?.() } catch { /* 已关闭 */ }
  }

  const connect = () => {
    if (stopped) return
    if (typeof EventSourceImpl !== 'function') {
      // 没有 EventSource（老环境 / Node 单测没注入）：这是**真的**没法重试，明确说出
      // 来而不是静默什么都不做。注意这是本模块唯一允许停留在"放弃"语义的状态。
      status = 'unsupported'
      emit({ kind: 'status' })
      return
    }
    status = retries === 0 ? 'connecting' : 'retrying'
    let es
    try {
      es = new EventSourceImpl(options.url)
    } catch {
      scheduleRetry()
      return
    }
    source = es

    es.addEventListener?.('open', () => {
      // ⚠️ **不**在这里清退避：能连上但一帧都不发的端点不该被当作"恢复"。
      status = 'open'
      emit({ kind: 'status' })
    })

    es.addEventListener?.('state', (event) => {
      // 流里的每一帧都是**完整快照**（host 直接复用状态路由的 body），
      // 所以直接替换即可，不需要增量合并。
      let parsed
      try {
        parsed = JSON.parse(event?.data ?? 'null')
      } catch {
        return // 坏帧直接丢，保留上一帧
      }
      snapshot = parsed
      frames += 1
      retries = 0
      status = 'open'
      emit({ kind: 'state' })
    })

    // 服务端的"数据停滞"：读还没回来（worker 被运动指令占住是常态）。**保留上一帧**，
    // 只是把"停了多久"交给上层显示 —— 静默停帧才是真问题。
    es.addEventListener?.(TWIN_STREAM_STALE_EVENT, (event) => {
      staleCount += 1
      emit({ kind: 'stale', ...parseEventData(event) })
    })

    // 服务端的"单帧失败"：保留上一帧继续显示。**它不是连接故障**（见文件头第 1 条）。
    es.addEventListener?.(TWIN_STREAM_FRAME_ERROR_EVENT, (event) => {
      frameErrors += 1
      emit({ kind: 'frame-error', ...parseEventData(event) })
    })

    es.onerror = (event) => {
      if (stopped) return
      /*
       * ⚠️ **判据是"带不带 data"，不是事件名。**
       * 服务端发来的事件是 MessageEvent（有 `data` 字符串），而传输层错误是普通 Event。
       * 浏览器会因为**任何** `event:` 字段为 `error` 的服务端消息调用 `onerror` —— 直接
       * 把它当断线就是"同步两下就停住"的成因之一。这里只认真正的传输层错误。
       */
      if (typeof event?.data === 'string') {
        frameErrors += 1
        emit({ kind: 'frame-error', ...parseEventData(event) })
        return
      }
      teardown()
      scheduleRetry()
    }
  }

  const scheduleRetry = () => {
    if (stopped) return
    retries += 1
    const delay = retryDelayMs(retries, retryMs, maxRetryMs)
    status = 'retrying'
    emit({ kind: 'status' })
    if (timer !== null) { cancel(timer); timer = null }
    timer = schedule(() => {
      timer = null
      connect()
    }, delay)
  }

  /** 解析服务端事件的 `data`（坏 JSON 退化成空对象，绝不抛错）。 */
  function parseEventData(event) {
    try {
      const parsed = JSON.parse(event?.data ?? 'null')
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start() {
      if (!stopped) return
      stopped = false
      retries = 0
      connect()
    },
    stop() {
      stopped = true
      teardown()
      status = 'idle'
    },
    /**
     * 立刻重试（自愈入口）。窗口重新可见、或数据停滞过久时由面板调用。
     *
     * @param {boolean} [force] 连接**看起来**还在、但已经很久没有帧时传 `true`：
     *   拆掉当前连接重建。默认只在"正在重连"时提前触发，不动健康连接。
     * @returns {boolean} 是否真的发起了重连
     */
    poke(force = false) {
      if (stopped) return false
      if (source !== null && force !== true) return false
      if (timer !== null) { cancel(timer); timer = null }
      teardown()
      connect()
      return true
    },
    /** 最近一帧快照；还没收到过时为 `null`。 */
    getSnapshot: () => snapshot,
    getStatus: () => status,
    /** 累计收到的完整帧数（诊断用）。 */
    getFrames: () => frames,
    /** 累计的单帧失败数（服务端 frame-error + 解析失败）。 */
    getFrameErrors: () => frameErrors,
    /** 累计的"数据停滞"提示数（服务端 stale 事件）。 */
    getStaleCount: () => staleCount,
  }
}

/**
 * 把流地址拼出来（与 `state.js` 的轮询地址同构：有 IP 才带 `?ip=`）。
 *
 * @param {string} streamPath `TWIN_STREAM_PATH`
 * @param {string} [ip]
 * @returns {string}
 */
export function streamUrlFor(streamPath, ip) {
  const base = typeof streamPath === 'string' && streamPath !== '' ? streamPath : '/dsh-nonead-ur/twin/stream'
  const value = typeof ip === 'string' ? ip.trim() : ''
  return value === '' ? base : `${base}?ip=${encodeURIComponent(value)}`
}

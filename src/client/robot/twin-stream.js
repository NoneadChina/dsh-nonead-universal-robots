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
 * ## 可测性
 *
 * `EventSource` 通过 `EventSourceImpl` 注入，因此可以在 Node 里完整测"连上 → 收帧 →
 * 断线 → 自动重连 → 停止"这条生命周期，不需要真浏览器。
 */

/** 断线后自动重连的间隔（毫秒）。 */
export const TWIN_STREAM_RETRY_MS = 1000

/** 连续这么多次重连都没成功，就放弃并通知订阅者（避免无限空转）。 */
export const TWIN_STREAM_MAX_RETRIES = 8

/**
 * 创建一个状态流订阅器。
 *
 * @param {object} options
 * @param {string} options.url 流路由地址（`?ip=…` 由调用方拼好）
 * @param {new (url: string) => object} [options.EventSourceImpl=globalThis.EventSource] 注入点
 * @param {number} [options.retryMs=TWIN_STREAM_RETRY_MS]
 * @param {number} [options.maxRetries=TWIN_STREAM_MAX_RETRIES]
 * @param {(fn: () => void) => unknown} [options.setTimeoutImpl] 注入点（测试用假定时器）
 * @returns {{subscribe: (listener: (snapshot: object) => void) => () => void,
 *            start: () => void, stop: () => void,
 *            getSnapshot: () => object|null, getStatus: () => 'idle'|'connecting'|'open'|'retrying'|'gaveup'}}
 */
export function createTwinStream(options = {}) {
  const EventSourceImpl = options.EventSourceImpl ?? globalThis.EventSource
  const retryMs = Number.isFinite(options.retryMs) && options.retryMs >= 0 ? options.retryMs : TWIN_STREAM_RETRY_MS
  const maxRetries = Number.isFinite(options.maxRetries) && options.maxRetries > 0
    ? options.maxRetries
    : TWIN_STREAM_MAX_RETRIES
  const schedule = typeof options.setTimeoutImpl === 'function' ? options.setTimeoutImpl : globalThis.setTimeout
  const cancel = typeof options.clearTimeoutImpl === 'function' ? options.clearTimeoutImpl : globalThis.clearTimeout

  const listeners = new Set()
  let source = null
  let timer = null
  let retries = 0
  let status = 'idle'
  let snapshot = null
  let stopped = true

  const emit = () => {
    for (const listener of listeners) {
      // 单个订阅者抛错不得影响其它订阅者，也不得中断流。
      try { listener(snapshot) } catch { /* 订阅者自身的问题，吞掉 */ }
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
      // 没有 EventSource（老环境 / Node 单测没注入）：明确放弃，而不是静默什么都不做。
      status = 'gaveup'
      emit()
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
      retries = 0
      status = 'open'
      emit()
    })

    es.addEventListener?.('state', (event) => {
      // 流里的每一帧都是**完整快照**（host 直接复用状态路由的 body），
      // 所以直接替换即可，不需要增量合并。
      try {
        snapshot = JSON.parse(event?.data ?? 'null')
      } catch {
        return // 坏帧直接丢，保留上一帧
      }
      retries = 0
      status = 'open'
      emit()
    })

    // host 的 `error` 事件是"这一帧读失败了"，**不是**连接断开 —— 保留上一帧继续显示。
    es.addEventListener?.('error', () => { /* 交给 onerror/重连处理 */ })

    es.onerror = () => {
      if (stopped) return
      teardown()
      scheduleRetry()
    }
  }

  const scheduleRetry = () => {
    if (stopped) return
    retries += 1
    if (retries > maxRetries) {
      status = 'gaveup'
      emit()
      return
    }
    status = 'retrying'
    emit()
    timer = schedule(() => {
      timer = null
      connect()
    }, retryMs)
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
    /** 最近一帧快照；还没收到过时为 `null`。 */
    getSnapshot: () => snapshot,
    getStatus: () => status,
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

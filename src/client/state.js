// src/client/state.js — 客户端唯一数据源：HTTP 轮询 host 的只读状态路由，分发给订阅者。
//
// **Ruling 20/22（必须遵守）**：客户端半**不得** import host 半的路由模块
// `lib/twin-routes.js`（它要 `node:fs`，被打进浏览器 bundle 会解析失败/带入 Node 内置模块）。
// 路径常量的唯一真源是**零 import** 的 `lib/twin-paths.js`：host 与 client 都 import 它，
// 由 esbuild 在构建期把两个字符串内联进 bundle ⇒ 不可能漂移。
//
// 本文件除下面这一条 import 之外不得有其它 import（尤其不得出现 `node:`）。
import { TWIN_STATE_PATH } from '../../lib/twin-paths.js'

export { TWIN_STATE_PATH }

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
 * 创建轮询状态源。
 *
 * @param {object} options
 * @param {typeof fetch} [options.fetchImpl] 取数实现（注入点，测试用假 fetch）
 * @param {string} [options.ip] 机器人 IP。**可省略**（Ruling 35）：省略/空白时不拼 `?ip=`，
 *   由 host 依据其连接注册表解析到"当前已连接的那一个机器人"——浏览器半不该猜机器人地址。
 * @param {number} [options.baseMs=100] 基础间隔
 * @param {number} [options.maxMs=2000] 退避上限 / 后台标签降频间隔
 */
export function createTwinState({ fetchImpl = globalThis.fetch, ip, baseMs = 100, maxMs = 2000 }) {
  // 只有显式给了非空 IP 才拼查询串；否则交给 host 解析（Ruling 35）。
  const target = typeof ip === 'string' && ip.trim() !== ''
    ? `${TWIN_STATE_PATH}?ip=${encodeURIComponent(ip.trim())}`
    : TWIN_STATE_PATH
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

  const emit = () => {
    for (const listener of listeners) {
      // 单个订阅者抛错不得影响其它订阅者，也不得中断轮询（Ruling：逐个 try/catch）。
      try { listener(snapshot) } catch { /* 订阅者自身的问题，吞掉 */ }
    }
  }

  async function tick(gen) {
    let ok = false
    try {
      // `cache: 'no-store'`：状态是实时遥测，命中 HTTP 缓存比拿不到更糟。
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      inflight = controller
      const res = await fetchImpl(target, controller ? { cache: 'no-store', signal: controller.signal } : undefined)
      const body = await res.json()
      // **Ruling 21**：只有"确实连上机器人"才算成功。未连接时也要退避到 maxMs，
      // 否则会对着一条离线机器人以 10 Hz 空转，白白打满 host 路由与 worker 调用。
      // 重连检测延迟最多 maxMs（2 s），可接受。
      ok = body.connected === true
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
          }
        // 失败/未连接时保留上一次的 model/q/tcp，只置 connected=false 并写原因，
        // 这样 UI 不会闪成空白。
        : {
            ...snapshot,
            connected: false,
            error: body.reason ?? body.error ?? 'not connected',
            code: body.code ?? null,
            ips: Array.isArray(body.ips) ? body.ips : [],
            ip: body.ip ?? snapshot.ip ?? null,
            degraded: false,
          }
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
    start() {
      // 重复 start 不得并行出两条轮询链。
      if (!stopped) return
      stopped = false
      tick(++generation)
    },
    stop() {
      stopped = true
      generation++
      if (timer) { clearTimeout(timer); timer = null }
      // 取消在飞的请求，并让它的 catch 分支安静退出（不写错误快照）。
      try { inflight?.abort?.() } catch { /* 忽略 */ }
      inflight = null
    },
  }
}

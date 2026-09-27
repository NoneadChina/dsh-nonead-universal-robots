/**
 * src/client/mutation-hub.js — 全局单例 MutationObserver「变更 hub」。
 *
 * React 重渲染会把插件注入的 DOM 当作"多余子节点"抹掉，所以每处挂载点都需要一个变更驱动的
 * 自愈循环。**同一份模块的多份副本必须共享同一个 observer**（否则后到者会抢走
 * `globalThis[MUTATION_HUB_KEY]`，先到者的自愈就静默失效），因此 hub 登记在全局键上，
 * 由本模块统一提供。变更**批量到下一帧**（rAF 去抖）后统一交给订阅者；最后一个订阅者退订时
 * `disconnect()`。**不要**每个挂载点各起一个 observer。
 *
 * 本模块从 `sidebar-entry.js` 原样迁出（后者随「只在右栏呈现」的改版一并删除），行为未变；
 * 全局单例、自愈重插、退订即断开这三点由 `test/right-dock-entry.test.mjs` 覆盖。
 */

/** 全局单例 MutationObserver 的登记键。 */
export const MUTATION_HUB_KEY = '__DSH_UR_TWIN_MUTATION_HUB__'

/** 取值安全的 globalThis（Node 与浏览器都有，但保持防御）。 */
function registry() {
  return typeof globalThis === 'undefined' ? undefined : globalThis
}

/* ------------------------------------------------------------------ *
 * 全局单例 MutationObserver hub
 * ------------------------------------------------------------------ */

function resolveObserverImpl(doc, provided) {
  if (typeof provided === 'function') return provided
  const fromDoc = doc?.defaultView?.MutationObserver
  if (typeof fromDoc === 'function') return fromDoc
  const fromGlobal = registry()?.MutationObserver
  return typeof fromGlobal === 'function' ? fromGlobal : undefined
}

function resolveRaf(doc, provided) {
  if (typeof provided === 'function') return provided
  const view = doc?.defaultView
  if (view && typeof view.requestAnimationFrame === 'function') return (cb) => view.requestAnimationFrame(cb)
  const fromGlobal = registry()?.requestAnimationFrame
  return typeof fromGlobal === 'function' ? (cb) => fromGlobal(cb) : undefined
}

function resolveCaf(doc, provided) {
  if (typeof provided === 'function') return provided
  const view = doc?.defaultView
  if (view && typeof view.cancelAnimationFrame === 'function') return (id) => view.cancelAnimationFrame(id)
  const fromGlobal = registry()?.cancelAnimationFrame
  return typeof fromGlobal === 'function' ? (id) => fromGlobal(id) : undefined
}

/** 无 globalThis（极端环境）时的本地兜底槽位，保证 hub 语义不依赖全局对象。 */
let localHub

function readHub() {
  const reg = registry()
  return reg ? reg[MUTATION_HUB_KEY] : localHub
}

function writeHub(hub) {
  const reg = registry()
  if (reg) reg[MUTATION_HUB_KEY] = hub
  else localHub = hub
}

function clearHub(hub) {
  const reg = registry()
  if (reg) {
    if (reg[MUTATION_HUB_KEY] === hub) delete reg[MUTATION_HUB_KEY]
  } else if (localHub === hub) {
    localHub = undefined
  }
}

function createHub({ doc, options }) {
  const Observer = resolveObserverImpl(doc, options.MutationObserver)
  const raf = resolveRaf(doc, options.raf)
  const caf = resolveCaf(doc, options.caf)

  const subscribers = new Set()
  const hub = { subscribers, pending: [], scheduled: false, frame: undefined, observer: undefined, raf, caf }

  /** 把这一帧攒下的变更一次性交给所有订阅者；单个订阅者抛错不得影响其它订阅者。 */
  const flush = () => {
    hub.frame = undefined
    hub.scheduled = false
    const batch = hub.pending
    hub.pending = []
    for (const listener of [...subscribers]) {
      if (!subscribers.has(listener)) continue
      try {
        listener(batch)
      } catch {
        /* 订阅者自身的问题，吞掉 */
      }
    }
  }

  /** rAF 去抖：一帧只处理一次。无 rAF（Node / 极简环境）时退化为同步 flush。 */
  const schedule = () => {
    if (hub.scheduled) return
    hub.scheduled = true
    if (typeof raf === 'function') {
      try {
        hub.frame = raf(flush)
        return
      } catch {
        /* 调度器自身出错 → 退化到同步 flush */
      }
    }
    flush()
  }

  const target = doc ? (doc.body ?? doc.documentElement) : undefined
  if (typeof Observer === 'function' && target) {
    try {
      hub.observer = new Observer((records) => {
        for (const record of records) hub.pending.push(record)
        schedule()
      })
      hub.observer.observe(target, { childList: true, subtree: true })
    } catch {
      hub.observer = undefined
    }
  }

  return hub
}

/**
 * 订阅 body 级变更；返回退订函数（最后一个退订者负责 disconnect）。
 *
 * 供本模块与 `right-dock-entry.js` 共用**同一个**全局单例 hub —— 两处挂载点各起
 * 一个 observer 会互相抢 `globalThis[MUTATION_HUB_KEY]`，必须先到者被后到者覆盖。
 *
 * @param {Document} doc 目标文档
 * @param {{MutationObserver?: Function, raf?: Function, caf?: Function}} options 注入点
 * @param {(records: MutationRecord[]) => void} listener 每帧批量回调
 * @returns {() => void} 退订函数
 */
export function subscribeMutations(doc, options, listener) {
  let hub = readHub()
  if (hub === undefined) {
    hub = createHub({ doc, options })
    // 没有 observer 的 hub 不进全局槽位：否则会挡住后续挂载点拿到可用的单例。
    if (hub.observer) writeHub(hub)
  }
  hub.subscribers.add(listener)
  let subscribed = true
  return () => {
    if (!subscribed) return
    subscribed = false
    hub.subscribers.delete(listener)
    if (hub.subscribers.size > 0) return
    // 最后一个订阅者退订：断开 observer、取消待处理帧、清空 hub（下一个订阅者会重建）。
    try {
      hub.observer?.disconnect?.()
    } catch {
      /* 忽略 */
    }
    if (hub.frame !== undefined && typeof hub.caf === 'function') {
      try {
        hub.caf(hub.frame)
      } catch {
        /* 忽略 */
      }
    }
    hub.frame = undefined
    hub.scheduled = false
    hub.pending = []
    clearHub(hub)
  }
}

/**
 * 仅测试用：丢弃全局单例 hub（断开 observer 并清空订阅者表）。
 * 生产代码不要调用 —— 它会让仍在挂载中的入口失去自愈。
 */
export function resetMutationHub() {
  const hub = readHub()
  if (!hub) return
  try {
    hub.observer?.disconnect?.()
  } catch {
    /* 忽略 */
  }
  hub.subscribers.clear()
  hub.pending = []
  hub.frame = undefined
  hub.scheduled = false
  clearHub(hub)
}

/**
 * SSE 实时订阅（清单第 20 条）专项测试。
 *
 * 全部用**假 EventSource + 假定时器**，因此能确定性地覆盖"连上 → 收帧 → 断线 →
 * 自动重连 → 长时间断线 → 恢复 → 停止"整条生命周期，不依赖真浏览器或真实等待。
 *
 * ## 0.6.6：本文件里最重要的一条约定
 * 假 EventSource **按 HTML 规范派发**服务端事件：`event: error` 的服务端消息会被派发成
 * 一个 `error` 类型的事件，而 `onerror` 就是该类型的事件处理器 ⇒ 它**必须**同时命中
 * `onerror`。真浏览器与 undici 都是这个行为（undici: `onerror` 实现为
 * `addEventListener('error', …)`，服务端事件按 `event.type` 派发）。
 * 以前那张假 EventSource 只 fire 注册过的监听器、不碰 `onerror`，于是"一个 error 帧
 * 就把整条流拆掉"这个缺陷**长期全绿**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createTwinStream,
  retryDelayMs,
  streamUrlFor,
  TWIN_STREAM_MAX_RETRY_MS,
  TWIN_STREAM_RETRY_MS,
} from '../src/client/robot/twin-stream.js'

/**
 * 可控的假 EventSource：记录实例并允许手工触发事件。
 *
 * `fire(type, data)` 模拟**服务端发送**一个 `event: <type>` 的消息：带 `data` 的
 * MessageEvent 会被派发给该类型的所有监听器，**并且在 type === 'error' 时同样命中
 * `onerror`**（规范行为，见文件头）。
 */
function makeEventSourceFactory() {
  const instances = []
  class FakeEventSource {
    constructor(url) {
      this.url = url
      this.closed = false
      this.handlers = new Map()
      instances.push(this)
    }

    addEventListener(type, handler) {
      if (!this.handlers.has(type)) this.handlers.set(type, new Set())
      this.handlers.get(type).add(handler)
    }

    close() {
      this.closed = true
    }

    /** 服务端发来一条 `event: <type>` 消息（带 data）。 */
    fire(type, data = {}) {
      const event = { type, data: JSON.stringify(data) }
      for (const handler of this.handlers.get(type) ?? []) handler(event)
      // ★ 规范：`error` 类型的事件同时命中 onerror（onerror 就是 error 的事件处理器）。
      if (type === 'error') this.onerror?.(event)
    }

    /** 传输层错误（普通 Event，**没有** data）：这才是"连接断了"。 */
    fail() {
      this.onerror?.({ type: 'error' })
    }
  }
  return { instances, FakeEventSource, latest: () => instances.at(-1) }
}

/** 可控的假定时器。 */
function makeTimers() {
  const pending = []
  return {
    pending,
    setTimeoutImpl: (fn, ms) => {
      const entry = { fn, ms, cancelled: false }
      pending.push(entry)
      return entry
    },
    clearTimeoutImpl: (entry) => {
      if (entry) entry.cancelled = true
    },
    /** 触发所有未取消的定时器。 */
    flush() {
      for (const entry of pending.splice(0)) if (!entry.cancelled) entry.fn()
    },
    /** 最近一个未触发、未取消的定时器延迟。 */
    nextDelay() {
      const entry = pending.filter((e) => !e.cancelled).at(-1)
      return entry?.ms
    },
  }
}

const FRAME = { connected: true, model: 'UR5E', q: [0, 0, 0, 0, 0, 0], tcp: [0, 0, 0], ts: 1 }

test('streamUrlFor：有 IP 才带 ?ip=，并且会编码', () => {
  assert.equal(streamUrlFor('/dsh-nonead-ur/twin/stream', ''), '/dsh-nonead-ur/twin/stream')
  assert.equal(streamUrlFor('/dsh-nonead-ur/twin/stream', '10.0.0.1'), '/dsh-nonead-ur/twin/stream?ip=10.0.0.1')
  assert.equal(streamUrlFor('/x', '  '), '/x')
  // 没给路径时用缺省路径，而不是拼出 "undefined?ip=…"
  assert.equal(streamUrlFor('', '10.0.0.1'), '/dsh-nonead-ur/twin/stream?ip=10.0.0.1')
  assert.equal(streamUrlFor(null, ''), '/dsh-nonead-ur/twin/stream')
})

test('retryDelayMs：指数退避且封顶，永不无限增长', () => {
  assert.equal(retryDelayMs(1), TWIN_STREAM_RETRY_MS)
  assert.equal(retryDelayMs(2), TWIN_STREAM_RETRY_MS * 2)
  assert.equal(retryDelayMs(3), TWIN_STREAM_RETRY_MS * 4)
  assert.equal(retryDelayMs(99), TWIN_STREAM_MAX_RETRY_MS, '必须封顶')
  assert.equal(retryDelayMs(0), TWIN_STREAM_RETRY_MS, '非法入参退回基础间隔')
  assert.equal(retryDelayMs(5, 100, 1000), 1000, '自定义上限同样生效')
})

test('生命周期：start 建连、收帧通知订阅者、getSnapshot 拿到最新帧', () => {
  const factory = makeEventSourceFactory()
  const stream = createTwinStream({ url: '/x', EventSourceImpl: factory.FakeEventSource })

  const seen = []
  stream.subscribe((snapshot) => seen.push(snapshot))
  assert.equal(stream.getStatus(), 'idle', 'start 之前不该有任何连接')

  stream.start()
  assert.equal(stream.getStatus(), 'connecting')
  const es = factory.latest()
  assert.equal(es.url, '/x')

  es.fire('open')
  assert.equal(stream.getStatus(), 'open')

  es.fire('state', FRAME)
  assert.deepEqual(stream.getSnapshot(), FRAME)
  assert.ok(seen.includes(FRAME) || seen.some((s) => s?.model === 'UR5E'), '订阅者必须收到帧')
  assert.equal(stream.getFrames(), 1, '帧计数要能被面板读到')

  stream.stop()
  assert.equal(stream.getStatus(), 'idle')
  assert.equal(es.closed, true, 'stop 必须关掉 EventSource')
})

test('坏帧被丢弃但保留上一帧（不能因为一帧 JSON 坏了就清空画面）', () => {
  const factory = makeEventSourceFactory()
  const stream = createTwinStream({ url: '/x', EventSourceImpl: factory.FakeEventSource })
  stream.start()
  const es = factory.latest()
  es.fire('state', FRAME)
  es.handlers.get('state').values().next().value({ data: '{ 这不是 JSON' })
  assert.deepEqual(stream.getSnapshot(), FRAME, '坏帧必须被丢掉、保留上一帧')
  stream.stop()
})

// ── 0.6.6 核心回归：一个服务端 `error` 事件绝不能拆掉整条流 ────────────────
//
// 宿主 `lib/twin-routes.js` 的文档策略是"单帧读失败只发一个 error 事件、绝不拆流"。
// 但浏览器会把服务端 `event: error` 派发给 `EventSource.onerror` —— 于是那条策略在真机上
// 恰好反过来：每来一个坏帧就拆一次流，连来 8 次就进入终态、孪生永久冻结。
// 实测脚本：scripts/probe-twin-stream-error-event.mjs（修前：一次坏帧 ⇒ 连接数 2）。

test('服务端 error 事件（带 data）只是"这一帧失败了"：绝不拆流，也不重连', () => {
  const factory = makeEventSourceFactory()
  const timers = makeTimers()
  const stream = createTwinStream({
    url: '/x',
    EventSourceImpl: factory.FakeEventSource,
    retryMs: 10,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  })
  const metas = []
  stream.subscribe((snapshot, meta) => metas.push(meta?.kind))
  stream.start()
  const es = factory.latest()
  es.fire('state', FRAME)

  // 宿主按自己的策略发一个 error 帧（模拟"这一帧读失败了"）。
  es.fire('error', { message: '读失败' })
  es.fire('error', { message: '读失败' })

  assert.equal(factory.instances.length, 1, '★ 不得因为服务端 error 事件重建连接')
  assert.equal(timers.pending.length, 0, '★ 也不得排重连定时器')
  assert.equal(stream.getStatus(), 'open', '流必须仍然开着')
  assert.deepEqual(stream.getSnapshot(), FRAME, '必须保留上一帧好数据')
  assert.equal(stream.getFrameErrors(), 2, '失败帧要计入诊断计数，供界面说明')
  assert.ok(metas.includes('frame-error'), '订阅者要能被告知"这一帧失败了"')
  stream.stop()
})

test('服务端 stale 事件：保留上一帧，只把"停了多久"交给订阅者', () => {
  const factory = makeEventSourceFactory()
  const stream = createTwinStream({ url: '/x', EventSourceImpl: factory.FakeEventSource })
  let staleMeta = null
  stream.subscribe((snapshot, meta) => {
    if (meta?.kind === 'stale') staleMeta = meta
  })
  stream.start()
  const es = factory.latest()
  es.fire('state', FRAME)
  es.fire('stale', { pendingMs: 1234 })

  assert.deepEqual(stream.getSnapshot(), FRAME, '停滞不得清掉上一帧')
  assert.equal(staleMeta?.pendingMs, 1234, '停滞时长必须透传给上层')
  assert.equal(stream.getStaleCount(), 1)
  stream.stop()
})

// ── 0.6.6 核心回归：断线无限重连、退避封顶、收到真帧才清零 ────────────────

test('传输层错误才重连；连续失败**永不放弃**，退避封顶后一直试', () => {
  const factory = makeEventSourceFactory()
  const timers = makeTimers()
  const stream = createTwinStream({
    url: '/x',
    EventSourceImpl: factory.FakeEventSource,
    retryMs: 10,
    maxRetryMs: 40,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  })
  stream.start()
  assert.equal(factory.instances.length, 1)

  // 连续失败 20 次（远超旧的 maxRetries=8）：每一次都必须还排着重连，绝不进入终态。
  for (let i = 0; i < 20; i++) {
    factory.latest().fail()
    assert.equal(stream.getStatus(), 'retrying', `第 ${i + 1} 次失败后必须仍在重连`)
    const delay = timers.nextDelay()
    assert.ok(delay !== undefined, `第 ${i + 1} 次失败后必须有重连定时器（不得放弃）`)
    assert.ok(delay <= 40, `退避必须封顶（实测 ${delay}ms）`)
    timers.flush()
  }
  assert.equal(factory.instances.length, 21, '每次失败后都要真的重连')

  // 服务端恢复：一个真帧必须让通道回到 open，并把退避清零。
  const es = factory.latest()
  es.fire('state', FRAME)
  assert.equal(stream.getStatus(), 'open')
  es.fail()
  assert.equal(timers.nextDelay(), 10, '收到真帧后退避必须清零（从基础间隔重新开始）')
  stream.stop()
})

test('只 open 不收帧**不**清零退避（"连得上但一帧都不发"的端点不该被当作恢复）', () => {
  const factory = makeEventSourceFactory()
  const timers = makeTimers()
  const stream = createTwinStream({
    url: '/x',
    EventSourceImpl: factory.FakeEventSource,
    retryMs: 10,
    maxRetryMs: 1000,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  })
  stream.start()
  factory.latest().fail()
  timers.flush()                                 // 第 2 次连接
  factory.latest().fail()
  assert.equal(timers.nextDelay(), 20, '第二次失败后应为 2×基础间隔')
  timers.flush()                                 // 第 3 次连接
  factory.latest().fire('open')                  // 只 open，不给帧
  factory.latest().fail()
  assert.equal(timers.nextDelay(), 40, '★ open 不得清零退避（只有真帧才算恢复）')
  stream.stop()
})

test('stop 之后不得再有任何连接或定时器（避免泄漏）', () => {
  const factory = makeEventSourceFactory()
  const timers = makeTimers()
  const stream = createTwinStream({
    url: '/x',
    EventSourceImpl: factory.FakeEventSource,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  })
  stream.start()
  factory.latest().fail()
  assert.equal(timers.pending.length, 1, '应排了一个重连定时器')

  stream.stop()
  const before = factory.instances.length
  timers.flush()
  assert.equal(factory.instances.length, before, 'stop 后即使定时器被触发也不该建连')

  // 已关闭的连接上再触发 error 也不该复活
  factory.latest().fail()
  assert.equal(stream.getStatus(), 'idle')
})

// ── 0.6.6 新增：poke() 自愈入口 ────────────────────────────────────────────

test('poke()：正在重连时立刻重试，不等退避节拍', () => {
  const factory = makeEventSourceFactory()
  const timers = makeTimers()
  const stream = createTwinStream({
    url: '/x',
    EventSourceImpl: factory.FakeEventSource,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  })
  stream.start()
  factory.latest().fail()
  assert.equal(factory.instances.length, 1)
  assert.equal(stream.poke(), true, '正在重连时必须真的马上重试')
  assert.equal(factory.instances.length, 2, '★ 不必等定时器')
  assert.equal(timers.pending.filter((e) => !e.cancelled).length, 0, '旧定时器必须被取消')
  stream.stop()
})

test('poke() 不动健康连接；force 才拆掉重来', () => {
  const factory = makeEventSourceFactory()
  const stream = createTwinStream({ url: '/x', EventSourceImpl: factory.FakeEventSource })
  stream.start()
  factory.latest().fire('state', FRAME)
  assert.equal(stream.poke(), false, '流好好的就不该拆')
  assert.equal(factory.instances.length, 1)
  assert.equal(stream.poke(true), true, 'force 必须重建（"连着但一直没帧"的恢复手段）')
  assert.equal(factory.instances.length, 2)
  assert.equal(factory.instances[0].closed, true, '旧连接必须被关掉')
  stream.stop()
})

test('没有 EventSource 时明确"不支持"（这是唯一允许的终态）', () => {
  const stream = createTwinStream({ url: '/x', EventSourceImpl: undefined })
  let notified = 0
  stream.subscribe(() => { notified += 1 })
  stream.start()
  assert.equal(stream.getStatus(), 'unsupported', '环境不支持时必须让调用方知道')
  assert.ok(notified > 0, '状态变化要通知订阅者')
  assert.equal(stream.getSnapshot(), null)
})

test('重复 start 不产生第二条连接', () => {
  const factory = makeEventSourceFactory()
  const stream = createTwinStream({ url: '/x', EventSourceImpl: factory.FakeEventSource })
  stream.start()
  stream.start()
  stream.start()
  assert.equal(factory.instances.length, 1)
  stream.stop()
})

test('订阅者可退订，且单个订阅者抛错不影响其它订阅者', () => {
  const factory = makeEventSourceFactory()
  const stream = createTwinStream({ url: '/x', EventSourceImpl: factory.FakeEventSource })
  let good = 0
  stream.subscribe(() => { throw new Error('bad subscriber') })
  const off = stream.subscribe(() => { good += 1 })

  stream.start()
  factory.latest().fire('state', FRAME)
  assert.equal(good, 1, '坏订阅者不该影响好订阅者')

  off()
  factory.latest().fire('state', FRAME)
  assert.equal(good, 1, '退订后不该再收到')
  stream.stop()
})

/**
 * SSE 实时订阅（清单第 20 条）专项测试。
 *
 * 全部用**假 EventSource + 假定时器**，因此能确定性地覆盖"连上 → 收帧 → 断线 →
 * 自动重连 → 放弃 → 停止"整条生命周期，不依赖真浏览器或真实等待。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createTwinStream,
  streamUrlFor,
  TWIN_STREAM_MAX_RETRIES,
} from '../src/client/robot/twin-stream.js'

/** 可控的假 EventSource：记录实例并允许手工触发事件。 */
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

    /** 测试用：触发一个事件。 */
    fire(type, event) {
      for (const handler of this.handlers.get(type) ?? []) handler(event)
    }

    /** 测试用：触发 onerror（断线）。 */
    fail() {
      this.onerror?.(new Error('disconnected'))
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

  es.fire('state', { data: JSON.stringify(FRAME) })
  assert.deepEqual(stream.getSnapshot(), FRAME)
  assert.ok(seen.includes(FRAME) || seen.some((s) => s?.model === 'UR5E'), '订阅者必须收到帧')

  stream.stop()
  assert.equal(stream.getStatus(), 'idle')
  assert.equal(es.closed, true, 'stop 必须关掉 EventSource')
})

test('坏帧被丢弃但保留上一帧（不能因为一帧 JSON 坏了就清空画面）', () => {
  const factory = makeEventSourceFactory()
  const stream = createTwinStream({ url: '/x', EventSourceImpl: factory.FakeEventSource })
  stream.start()
  const es = factory.latest()
  es.fire('state', { data: JSON.stringify(FRAME) })
  es.fire('state', { data: '{ 这不是 JSON' })
  assert.deepEqual(stream.getSnapshot(), FRAME, '坏帧必须被丢掉、保留上一帧')
  stream.stop()
})

test('断线自动重连，并重新建连；连续失败到上限后放弃', () => {
  const factory = makeEventSourceFactory()
  const timers = makeTimers()
  const stream = createTwinStream({
    url: '/x',
    EventSourceImpl: factory.FakeEventSource,
    retryMs: 10,
    maxRetries: 2,
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  })

  stream.start()
  assert.equal(factory.instances.length, 1)

  // 第一次断线 → 进入重试
  factory.latest().fail()
  assert.equal(stream.getStatus(), 'retrying')
  timers.flush()
  assert.equal(factory.instances.length, 2, '必须重新建连')

  // 第二次断线 → 再重试
  factory.latest().fail()
  timers.flush()
  assert.equal(factory.instances.length, 3)

  // 第三次断线 → 超过 maxRetries(2) 后放弃，且**不再**建连
  factory.latest().fail()
  assert.equal(stream.getStatus(), 'gaveup')
  timers.flush()
  assert.equal(factory.instances.length, 3, '放弃之后不得再建连')
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

test('没有 EventSource 时明确"放弃"，而不是静默什么都不做', () => {
  const stream = createTwinStream({ url: '/x', EventSourceImpl: undefined })
  let notified = 0
  stream.subscribe(() => { notified += 1 })
  stream.start()
  assert.equal(stream.getStatus(), 'gaveup', '环境不支持时必须让调用方知道')
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
  factory.latest().fire('state', { data: JSON.stringify(FRAME) })
  assert.equal(good, 1, '坏订阅者不该影响好订阅者')

  off()
  factory.latest().fire('state', { data: JSON.stringify(FRAME) })
  assert.equal(good, 1, '退订后不该再收到')
  stream.stop()
})

test('上限常量为正数（防止被改成 0 导致"永不重连"）', () => {
  assert.ok(TWIN_STREAM_MAX_RETRIES > 0)
})

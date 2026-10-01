/**
 * SSE 流接入 `state.js`（清单第 20 条：面板默认启用）专项测试。
 *
 * 核心判据是**互斥**：开了流就**一次轮询都不能有**。两套数据源并存会让同一帧被推两次，
 * 画面在两套时间轴之间抖动 —— 那种 bug 在单测里不钉住，只会在真机上表现为"看着有点抖"。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createTwinState } from '../src/client/state.js'

/** 可控的假流：记录 url，允许手工推帧。 */
function makeStreamFactory() {
  const created = []
  const factory = ({ url }) => {
    const listeners = new Set()
    const handle = {
      url,
      started: 0,
      stopped: 0,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      start() { handle.started += 1 },
      stop() { handle.stopped += 1 },
      /** 测试用：推一帧。 */
      push(frame) { for (const listener of listeners) listener(frame) },
      get listenerCount() { return listeners.size },
    }
    created.push(handle)
    return handle
  }
  return { factory, created, latest: () => created.at(-1) }
}

/** 一个会**计数**的 fetch：流模式下它必须一直是 0。 */
function countingFetch() {
  const fn = () => {
    fn.calls += 1
    return new Promise(() => {})
  }
  fn.calls = 0
  return fn
}

const FRAME = {
  connected: true,
  model: 'UR5E',
  q: [0, 0, 0, 0, 0, 0],
  tcp: [0.1, 0.2, 0.3, 0, 0, 0],
  ts: 1000,
  ip: '10.0.0.1',
  detail: { safety_mode: 'NORMAL' },
  pending_motion: { summary: 'movej' },
}

test('stream:true —— 用流替代轮询，一次 fetch 都不发', () => {
  const streams = makeStreamFactory()
  const fetchImpl = countingFetch()
  const state = createTwinState({ fetchImpl, ip: '10.0.0.1', stream: true, streamFactory: streams.factory })

  state.start()
  assert.equal(streams.created.length, 1, '必须建起一条流')
  assert.equal(streams.latest().started, 1, 'start 必须真正启动流')
  assert.equal(fetchImpl.calls, 0, '★ 开了流就不得再轮询（互斥）')

  // 流 URL 要带上目标 IP（与轮询地址同构）
  assert.match(streams.latest().url, /\/twin\/stream\?ip=10\.0\.0\.1$/u)

  streams.latest().push(FRAME)
  const snapshot = state.getSnapshot()
  assert.equal(snapshot.connected, true)
  assert.equal(snapshot.model, 'UR5E')
  assert.equal(snapshot.ip, '10.0.0.1')
  assert.deepEqual(snapshot.q, [0, 0, 0, 0, 0, 0])
  assert.deepEqual(snapshot.detail, { safety_mode: 'NORMAL' }, 'detail 必须从流里透传（host 有慢节拍）')
  assert.deepEqual(snapshot.pendingMotion, { summary: 'movej' }, 'pending_motion 必须被映射成 pendingMotion')

  assert.equal(fetchImpl.calls, 0, '收帧之后依然不得轮询')
  state.stop()
})

test('stream:true —— 收到帧会通知订阅者；未连接的帧也要如实反映', () => {
  const streams = makeStreamFactory()
  const state = createTwinState({
    fetchImpl: countingFetch(), ip: '', stream: true, streamFactory: streams.factory,
  })
  const seen = []
  state.subscribe((snapshot) => seen.push(snapshot.connected))
  state.start()

  streams.latest().push(FRAME)
  assert.deepEqual(seen, [true])

  streams.latest().push({ connected: false, code: 'no_robot', reason: '还没连过', ips: ['a', 'b'] })
  assert.equal(seen.at(-1), false)
  const snapshot = state.getSnapshot()
  assert.equal(snapshot.code, 'no_robot')
  assert.deepEqual(snapshot.ips, ['a', 'b'], '未连接帧也要保留多机候选，否则选择器点不到')
  assert.equal(snapshot.model, 'UR5E', '未连接时保留上一帧的型号，免得 UI 闪成空白')
  state.stop()
})

test('stream:true —— null 帧（还没收到第一帧）不清空已有读数', () => {
  const streams = makeStreamFactory()
  const state = createTwinState({
    fetchImpl: countingFetch(), ip: '', stream: true, streamFactory: streams.factory,
  })
  state.start()
  streams.latest().push(FRAME)
  const before = state.getSnapshot()
  streams.latest().push(null)
  assert.equal(state.getSnapshot(), before, 'null 表示"还没有帧"，不得覆盖成空白')
  state.stop()
})

test('stream:true —— stop 拆掉流且不再重建；重复 start 不并存两条流', () => {
  const streams = makeStreamFactory()
  const state = createTwinState({
    fetchImpl: countingFetch(), ip: '', stream: true, streamFactory: streams.factory,
  })
  state.start()
  state.start()
  assert.equal(streams.created.length, 1, '★ 重复 start 不得并存两条流')

  state.stop()
  assert.equal(streams.latest().stopped, 1, 'stop 必须拆掉流')
  state.start()
  assert.equal(streams.created.length, 2, 'stop 之后 start 应重建一条新的')
  state.stop()
})

test('stream:true —— setIp 必须重建流（旧流还在推上一台的数据）', () => {
  const streams = makeStreamFactory()
  const state = createTwinState({
    fetchImpl: countingFetch(), ip: '10.0.0.1', stream: true, streamFactory: streams.factory,
  })
  state.start()
  assert.match(streams.latest().url, /ip=10\.0\.0\.1$/u)

  state.setIp('10.0.0.2')
  assert.equal(streams.created.length, 2, '★ 换目标必须重建流')
  assert.match(streams.latest().url, /ip=10\.0\.0\.2$/u, '新流必须指向新目标')
  assert.equal(streams.created[0].stopped >= 1, true, '旧流必须被拆掉')
  assert.equal(state.getSnapshot().connected, false, '切换时必须清掉上一台的读数')
  state.stop()
})

test('stream:false（缺省）—— 行为与从前完全一致：仍然轮询、不建流', () => {
  const streams = makeStreamFactory()
  const fetchImpl = countingFetch()
  const state = createTwinState({ fetchImpl, ip: '', streamFactory: streams.factory })
  state.start()
  assert.equal(streams.created.length, 0, '缺省不得建流')
  assert.equal(fetchImpl.calls, 1, '缺省必须照旧发第一次轮询')
  state.stop()
})

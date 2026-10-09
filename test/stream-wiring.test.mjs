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
      /** `poke()` 收到过的 force 参数（自愈入口的契约）。 */
      pokes: [],
      frames: 0,
      frameErrors: 0,
      stale: 0,
      status: 'idle',
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      start() { handle.started += 1; handle.status = 'open' },
      stop() { handle.stopped += 1; handle.status = 'idle' },
      poke(force = false) { handle.pokes.push(force === true); return true },
      getStatus() { return handle.status },
      getFrames() { return handle.frames },
      getFrameErrors() { return handle.frameErrors },
      getStaleCount() { return handle.stale },
      /** 测试用：推一帧（省略 `meta` = 一帧普通状态快照）。 */
      push(frame, meta) {
        if (meta === undefined || meta.kind === 'state') handle.frames += 1
        if (meta?.kind === 'stale') { handle.stale += 1; handle.status = 'open' }
        if (meta?.kind === 'frame-error') handle.frameErrors += 1
        for (const listener of listeners) listener(frame, meta)
      },
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

// ── 0.6.6：数据通道可观测 + 自愈（画面"停住"必须能被说清、能被推一把）────────────
//
// 现场问题：机器人运动时 Python worker 被运动指令占住，孪生读排队 ⇒ 画面停在最后一帧
// 且界面上**没有任何提示**，用户分不清"机器人停了"和"数据停了"。宿主那边现在会发
// `stale` / `frame-error`，客户端必须把它变成可显示、可自愈的状态。

test('stream —— 服务端 stale/frame-error：保留上一帧读数，只标记"数据停滞"', () => {
  const streams = makeStreamFactory()
  const state = createTwinState({ fetchImpl: countingFetch(), stream: true, streamFactory: streams.factory })
  state.start()
  streams.latest().push(FRAME)
  assert.equal(state.getSnapshot().feedStale, false, '有真帧时不得标成停滞')

  streams.latest().push(null, { kind: 'stale', pendingMs: 4200 })
  const stale = state.getSnapshot()
  assert.equal(stale.feedStale, true, '★ 停滞必须被标出来')
  assert.equal(stale.feedPendingMs, 4200, '停滞时长要能显示')
  assert.equal(stale.connected, true, '★ 停滞不是断连：绝不能清 connected')
  assert.deepEqual(stale.q, FRAME.q, '★ 停滞必须保留上一帧读数（画面不清空）')

  // 下一帧真数据到达 ⇒ 停滞标记清掉
  streams.latest().push({ ...FRAME, ts: 1100 })
  assert.equal(state.getSnapshot().feedStale, false, '收到真帧后必须清掉停滞标记')
  assert.equal(state.getSnapshot().feedPendingMs, null)
  state.stop()
})

test('stream —— frame-error 同样保留读数（单帧失败不等于断连）', () => {
  const streams = makeStreamFactory()
  const state = createTwinState({ fetchImpl: countingFetch(), stream: true, streamFactory: streams.factory })
  state.start()
  streams.latest().push(FRAME)
  streams.latest().push(null, { kind: 'frame-error', reason: 'read_timeout' })
  const snap = state.getSnapshot()
  assert.equal(snap.connected, true, '单帧失败不得把机器人报成未连接')
  assert.equal(snap.feedStale, true)
  assert.deepEqual(snap.q, FRAME.q)
  state.stop()
})

test('getStreamHealth：把"通道现在怎么样"如实说出来（以前客户端一个字都没有）', () => {
  const streams = makeStreamFactory()
  const state = createTwinState({ fetchImpl: countingFetch(), stream: true, streamFactory: streams.factory })
  // 未 start 时是 idle（不是假装 open）
  assert.equal(state.getStreamHealth().mode, 'stream')
  assert.equal(state.getStreamHealth().status, 'idle')

  state.start()
  streams.latest().push(FRAME)
  streams.latest().push(null, { kind: 'frame-error' })
  streams.latest().push(null, { kind: 'stale', pendingMs: 10 })
  const health = state.getStreamHealth()
  assert.equal(health.status, 'open')
  assert.equal(health.frames, 1)
  assert.equal(health.frameErrors, 1)
  assert.equal(health.stale, 1)
  assert.equal(health.connected, true)

  // 重连中要能被界面看到
  streams.latest().status = 'retrying'
  assert.equal(state.getStreamHealth().status, 'retrying')
  state.stop()

  // 轮询模式下也必须给出一个诚实的 mode
  const polled = createTwinState({ fetchImpl: countingFetch(), streamFactory: streams.factory })
  assert.deepEqual(
    { mode: polled.getStreamHealth().mode, status: polled.getStreamHealth().status },
    { mode: 'poll', status: 'polling' },
  )
})

test('retryNow()：流模式转发给 poke（含 force），轮询模式立刻重取一次', () => {
  const streams = makeStreamFactory()
  const state = createTwinState({ fetchImpl: countingFetch(), stream: true, streamFactory: streams.factory })
  state.start()
  assert.equal(state.retryNow(), true, '正在重连时 poke 必须真的动手')
  assert.equal(state.retryNow(true), true, 'force 也要透传')
  assert.deepEqual(streams.latest().pokes, [false, true], '★ 必须把 force 原样交给流')
  state.stop()
  assert.equal(state.retryNow(), false, 'stop 之后不得再动手')

  // 轮询模式：不建流，但也要能立刻重取（面板的"停滞过久"自愈走这里）
  const fetchImpl = countingFetch()
  const polled = createTwinState({ fetchImpl, streamFactory: streams.factory })
  polled.start()
  assert.equal(fetchImpl.calls, 1)
  assert.equal(polled.retryNow(), true)
  assert.equal(fetchImpl.calls, 2, '★ 轮询模式下 retryNow 必须立刻再取一次')
  polled.stop()
})


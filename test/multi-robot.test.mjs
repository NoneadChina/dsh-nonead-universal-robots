/**
 * 多机器人选择（清单第 19 条）专项测试。
 *
 * 最要紧的一条不是"能不能切"，而是**切换时必须清掉上一台的读数** —— 否则会把 A 的位姿
 * 当成 B 显示出来，那比空白危险得多（操作员会以为 B 就在那个位置）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createTwinState } from '../src/client/state.js'

/** 一个永不解析的 fetch：本文件只测同步状态，不需要真的完成一次请求。 */
const idleFetch = () => new Promise(() => {})

test('setIp：切换目标后立刻清掉上一台的读数，并更新 getIp', () => {
  const state = createTwinState({ fetchImpl: idleFetch, ip: '10.0.0.1' })
  assert.equal(state.getIp(), '10.0.0.1')

  state.setIp('10.0.0.2')
  assert.equal(state.getIp(), '10.0.0.2')

  const snapshot = state.getSnapshot()
  assert.equal(snapshot.connected, false, '切换目标必须断开，否则会拿上一台的位姿冒充新的')
  assert.deepEqual(snapshot.q, [], '关节角必须清空')
  assert.deepEqual(snapshot.tcp, [], 'TCP 必须清空')
  assert.equal(snapshot.ip, '10.0.0.2', '身份行要立刻显示新目标')
  assert.deepEqual(snapshot.ips, [], '旧候选必须清掉（新目标还没回报候选）')
})

test('setIp：同一个 IP 是 no-op（不重建快照、不打断轮询）', () => {
  const state = createTwinState({ fetchImpl: idleFetch, ip: '10.0.0.1' })
  const before = state.getSnapshot()
  state.setIp('10.0.0.1')
  assert.equal(state.getSnapshot(), before, '同一 IP 不该产生新快照对象')
  // 前后空白要被规整掉，视作同一个 IP。
  state.setIp('  10.0.0.1  ')
  assert.equal(state.getSnapshot(), before)
})

test('setIp：清空目标 IP 表示"交回宿主解析"（Ruling 35 的省略语义）', () => {
  const state = createTwinState({ fetchImpl: idleFetch, ip: '10.0.0.1' })
  state.setIp('')
  assert.equal(state.getIp(), '')
  assert.equal(state.getSnapshot().ip, null, '没有目标时不该谎称有一台')
  // 非法输入按"清空"处理，而不是把非字符串塞进 URL。
  state.setIp(123)
  assert.equal(state.getIp(), '')
  state.setIp(null)
  assert.equal(state.getIp(), '')
})

test('setIp：切换会通知订阅者（面板要立刻反应，而不是等下一个 tick）', () => {
  const state = createTwinState({ fetchImpl: idleFetch, ip: '10.0.0.1' })
  let notified = 0
  state.subscribe(() => { notified += 1 })
  state.setIp('10.0.0.2')
  assert.equal(notified, 1, '切换必须同步通知一次')
  // no-op 不该再通知。
  state.setIp('10.0.0.2')
  assert.equal(notified, 1)
})

test('未 start() 时 setIp 不得发起请求（stopped 语义不能被绕过）', () => {
  let calls = 0
  const state = createTwinState({
    fetchImpl: () => {
      calls += 1
      return new Promise(() => {})
    },
    ip: '10.0.0.1',
  })
  state.setIp('10.0.0.2')
  assert.equal(calls, 0, '没 start 就不该有任何网络活动')
})

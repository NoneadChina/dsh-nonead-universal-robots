// Task 4 — 轨迹缓冲纯函数测试
// 计划起点用例 + 自行补充的边界用例
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushSample, trajectoryPoints } from '../src/client/robot/trajectory.js'

const pose = (x, ts) => ({ tcp: [x, 0, 0, 0, 0, 0], ts })

test('超出 maxAgeMs 的样本被淘汰', () => {
  let buf = []
  buf = pushSample(buf, { tcp: [0, 0, 0, 0, 0, 0], ts: 1000 }, 5000)
  buf = pushSample(buf, { tcp: [1, 0, 0, 0, 0, 0], ts: 7000 }, 5000)
  assert.equal(buf.length, 1)
  assert.equal(trajectoryPoints(buf)[0][0], 1)
})

test('乱序时间戳不破坏缓冲', () => {
  let buf = []
  buf = pushSample(buf, { tcp: [0, 0, 0, 0, 0, 0], ts: 2000 }, 5000)
  buf = pushSample(buf, { tcp: [1, 0, 0, 0, 0, 0], ts: 1000 }, 5000)
  assert.equal(buf.length, 2)
})

test('空缓冲推入首个样本', () => {
  const s = pose(1.5, 1000)
  const next = pushSample([], s, 5000)
  assert.equal(next.length, 1)
  assert.deepEqual(next[0], s)
})

test('maxAgeMs = 0 时只保留时间戳不早于新样本的样本', () => {
  let buf = pushSample([], pose(0, 1000), 0)
  assert.equal(buf.length, 1)

  buf = pushSample(buf, pose(1, 1000), 0)   // 差值 0 <= 0 → 保留
  assert.equal(buf.length, 2)

  buf = pushSample(buf, pose(2, 1001), 0)   // 旧样本差值 1 > 0 → 淘汰
  assert.equal(buf.length, 1)
  assert.equal(buf[0].tcp[0], 2)
})

test('maxAgeMs = 0 且时间戳倒退时保留全部（差值 <= 0）', () => {
  let buf = pushSample([], pose(0, 2000), 0)
  buf = pushSample(buf, pose(1, 1000), 0)
  assert.equal(buf.length, 2)
  assert.equal(trajectoryPoints(buf)[1][0], 1)
})

test('pushSample 不修改传入数组（纯函数）', () => {
  const original = [pose(0, 1000), pose(1, 2000)]
  const snapshot = JSON.parse(JSON.stringify(original))
  const next = pushSample(original, pose(2, 2100), 5000)
  assert.notEqual(next, original)          // 返回新数组
  assert.equal(original.length, 2)         // 入参长度不变
  assert.deepEqual(original, snapshot)     // 入参内容不变
  assert.equal(next.length, 3)
})

test('pushSample 在冻结输入数组上不抛错', () => {
  const frozen = Object.freeze([pose(0, 1000)])
  const next = pushSample(frozen, pose(1, 1100), 5000)
  assert.equal(next.length, 2)
  assert.equal(frozen.length, 1)
})

test('trajectoryPoints 空缓冲返回空数组', () => {
  const pts = trajectoryPoints([])
  assert.ok(Array.isArray(pts))
  assert.deepEqual(pts, [])
})

test('trajectoryPoints 仅取 xyz、保序且不与入参共享引用', () => {
  const buf = [
    { tcp: [1, 2, 3, 0.1, 0.2, 0.3], ts: 1000 },
    { tcp: [4, 5, 6, 0.4, 0.5, 0.6], ts: 1100 },
  ]
  const snapshot = JSON.parse(JSON.stringify(buf))
  const pts = trajectoryPoints(buf)
  assert.deepEqual(pts, [[1, 2, 3], [4, 5, 6]])
  assert.notEqual(pts[0], buf[0].tcp)
  assert.deepEqual(buf, snapshot)          // 只读，不改入参
})

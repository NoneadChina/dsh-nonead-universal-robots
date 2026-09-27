// Task 4 — 插值纯函数测试
// 计划起点用例 + 自行补充的边界用例
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerpJoints, interpolateAt } from '../src/client/robot/interpolate.js'

test('lerpJoints 端点一致', () => {
  const a = [0, 0, 0, 0, 0, 0], b = [1, 2, 3, 4, 5, 6]
  assert.deepEqual(lerpJoints(a, b, 0), a)
  assert.deepEqual(lerpJoints(a, b, 1), b)
})

test('lerpJoints 逐元素语义且长度为 6', () => {
  const a = [0, 1, 2, 3, 4, 5]
  const b = [2, 3, 4, 5, 6, 7]
  const mid = lerpJoints(a, b, 0.5)
  assert.equal(mid.length, 6)
  assert.deepEqual(mid, [1, 2, 3, 4, 5, 6])
  assert.deepEqual(lerpJoints(a, b, 0.25), [0.5, 1.5, 2.5, 3.5, 4.5, 5.5])
  // 纯函数：返回新数组，不与入参共享引用
  assert.notEqual(lerpJoints(a, b, 0), a)
  assert.notEqual(lerpJoints(a, b, 1), b)
})

test('interpolateAt 按时间插值并钳制', () => {
  const a = { q: [0, 0, 0, 0, 0, 0], ts: 1000 }
  const b = { q: [2, 0, 0, 0, 0, 0], ts: 2000 }
  assert.equal(interpolateAt(a, b, 1500)[0], 1)
  assert.equal(interpolateAt(a, b, 0)[0], 0)      // 早于 a → 钳到 a
  assert.equal(interpolateAt(a, b, 9999)[0], 2)   // 晚于 b → 钳到 b
})

test('interpolateAt 全部 6 个关节参与插值', () => {
  const a = { q: [0, 0, 0, 0, 0, 0], ts: 0 }
  const b = { q: [2, 4, 6, 8, 10, 12], ts: 100 }
  assert.deepEqual(interpolateAt(a, b, 50), [1, 2, 3, 4, 5, 6])
  assert.deepEqual(interpolateAt(a, b, 0), a.q)     // 下端点精确命中
  assert.deepEqual(interpolateAt(a, b, 100), b.q)   // 上端点精确命中
})

test('interpolateAt 时间跨度为 0 时不得产生 NaN', () => {
  const a = { q: [1, 1, 1, 1, 1, 1], ts: 500 }
  const b = { q: [2, 2, 2, 2, 2, 2], ts: 500 }
  const out = interpolateAt(a, b, 500)
  assert.equal(out.length, 6)
  assert.ok(out.every(Number.isFinite), 'span=0 结果必须全部有限（非 NaN/Infinity）')
  assert.deepEqual(out, b.q)
  assert.notEqual(out, b.q) // 不得别名返回 b.q
})

test('interpolateAt 时间跨度为负时不得产生 NaN', () => {
  const a = { q: [0, 0, 0, 0, 0, 0], ts: 2000 }
  const b = { q: [3, 3, 3, 3, 3, 3], ts: 1000 }
  for (const nowMs of [0, 1000, 1500, 2000, 5000]) {
    const out = interpolateAt(a, b, nowMs)
    assert.equal(out.length, 6)
    assert.ok(out.every(Number.isFinite), `span<0 且 nowMs=${nowMs} 时结果必须有限`)
    assert.deepEqual(out, b.q)
    assert.notEqual(out, b.q)
  }
})

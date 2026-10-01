/**
 * 轨迹能力（清单第 18 条）的新增纯函数测试：时间渐变颜色、CSV 导出、尾部截取。
 *
 * 这三样都是"画/导错了肉眼未必立刻发现"的东西（渐变方向反了、CSV 少一列），
 * 所以值得逐条钉住。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  pushSample,
  TRAJECTORY_CSV_HEADER,
  TRAJECTORY_NEW_COLOR,
  TRAJECTORY_OLD_COLOR,
  trajectoryColors,
  trajectoryCsv,
  trajectoryPoints,
  trajectoryTail,
} from '../src/client/robot/trajectory.js'

/** 造一段等间隔的假轨迹。 */
function makeBuffer(count, stepMs = 100) {
  const buf = []
  for (let i = 0; i < count; i++) {
    buf.push({ tcp: [i * 0.01, 0, 0], q: [i, i, i, i, i, i], ts: 1000 + i * stepMs })
  }
  return buf
}

test('trajectoryColors：从最旧到最新线性渐变，端点等于导出的常量色', () => {
  const buf = makeBuffer(5)
  const colors = trajectoryColors(buf)
  assert.equal(colors.length, 5)
  assert.deepEqual(colors[0], [...TRAJECTORY_OLD_COLOR], '最旧一个必须是起始色')
  assert.deepEqual(colors[4], [...TRAJECTORY_NEW_COLOR], '最新一个必须是终止色')

  // 单调递增：颜色只能从暗到亮，中间不会回退。
  for (let i = 1; i < colors.length; i++) {
    assert.ok(colors[i][2] >= colors[i - 1][2], `第 ${i} 个蓝分量不该比前一个低`)
  }
})

test('trajectoryColors：时间戳全不可用时退化成按序号渐变，而不是全同色或抛错', () => {
  const noTs = [{ tcp: [0, 0, 0], ts: Number.NaN }, { tcp: [0, 0, 0], ts: Number.NaN }]
  const colors = trajectoryColors(noTs)
  assert.equal(colors.length, 2)
  assert.notDeepEqual(colors[0], colors[1], '没有时间信息时也要能看出顺序')

  // 单点：用最新色（它既是起点也是终点）。
  assert.deepEqual(trajectoryColors([{ tcp: [0, 0, 0], ts: 5 }])[0], [...TRAJECTORY_NEW_COLOR])

  // 空 / 非法输入
  assert.deepEqual(trajectoryColors([]), [])
  assert.deepEqual(trajectoryColors(null), [])
  assert.deepEqual(trajectoryColors(undefined), [])

  // 自定义端点色
  const custom = trajectoryColors(makeBuffer(2), { oldColor: [0, 0, 0], newColor: [1, 1, 1] })
  assert.deepEqual(custom[0], [0, 0, 0])
  assert.deepEqual(custom[1], [1, 1, 1])
})

test('trajectoryCsv：带表头、逐行含位置与关节角、缺值留空而不是写 NaN', () => {
  const csv = trajectoryCsv(makeBuffer(3))
  const rows = csv.split('\n')
  assert.equal(rows[0], TRAJECTORY_CSV_HEADER)
  assert.equal(rows.length, 4, '表头 + 3 行')
  assert.equal(rows[1].split(',').length, 10, '每行 10 列（ts + tcp3 + q6）')
  assert.match(rows[1], /^1000\.000000,0\.000000,0\.000000,0\.000000,/)

  // 缺 q 的样本：位置照出，关节角列留空（表格软件里是空单元格，不是 "NaN"）。
  const partial = trajectoryCsv([{ tcp: [1, 2, 3], ts: 7 }])
  const partialRow = partial.split('\n')[1]
  assert.ok(!partialRow.includes('NaN'), `不得出现 NaN：${partialRow}`)
  assert.ok(!partialRow.includes('undefined'), `不得出现 undefined：${partialRow}`)
  assert.ok(partialRow.startsWith('7.000000,1.000000,2.000000,3.000000,'))

  // 非法输入只给表头，不抛错
  assert.equal(trajectoryCsv(null), TRAJECTORY_CSV_HEADER)
  assert.equal(trajectoryCsv([]), TRAJECTORY_CSV_HEADER)
  assert.doesNotThrow(() => trajectoryCsv([null, undefined, 'x']))
})

test('trajectoryTail：取尾部 N 个；非法 count 返回空而不是整段', () => {
  const buf = makeBuffer(10)
  assert.equal(trajectoryTail(buf, 3).length, 3)
  assert.deepEqual(trajectoryTail(buf, 3).at(-1), buf.at(-1), '必须是**最后** 3 个')
  assert.equal(trajectoryTail(buf, 999).length, 10, '超过长度就全给')
  assert.equal(trajectoryTail(buf, 0).length, 0)
  assert.equal(trajectoryTail(buf, -1).length, 0)
  assert.equal(trajectoryTail(buf, Number.NaN).length, 0)
  assert.deepEqual(trajectoryTail(null, 3), [])
})

test('回归：既有的 pushSample / trajectoryPoints 行为不变', () => {
  let buf = []
  buf = pushSample(buf, { tcp: [0, 0, 0], ts: 1000 }, 500)
  buf = pushSample(buf, { tcp: [1, 1, 1], ts: 1200 }, 500)
  // 新样本 ts=1700 时，ts=1000 的那笔相对它超龄（700 > 500）⇒ 被淘汰
  buf = pushSample(buf, { tcp: [2, 2, 2], ts: 1700 }, 500)
  assert.equal(buf.length, 2)
  assert.deepEqual(trajectoryPoints(buf), [[1, 1, 1], [2, 2, 2]])
  // 纯函数：不修改入参
  assert.equal(buf[0].ts, 1200)
})

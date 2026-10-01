/**
 * 待审批运动预览（清单第 8 条：先看后动）专项测试。
 *
 * 这个模块是纯逻辑（无 IO），所以能把"三类目标 + 各种畸形输入"都覆盖到。
 * 最要紧的一条是**永不抛错**：审批弹窗的职责是批准/拒绝，预览解析失败绝不能把它弄崩。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createPendingMotionStore,
  describePendingMotion,
  PENDING_MOTION_TTL_MS,
} from '../lib/pending-motion.js'

const Q = [0, -1.57, 1.57, -1.57, -1.57, 0]
const POSE = [0.1, 0.2, 0.3, 0, 0, 0]

test('关节目标 → joints（可直接画整条幽灵臂）', () => {
  const preview = describePendingMotion('ur_movej', { ip: '192.168.1.1', q: Q })
  assert.equal(preview.kind, 'joints')
  assert.deepEqual(preview.q, Q)
  assert.equal(preview.tool, 'ur_movej')
  assert.match(preview.summary, /关节运动/)
  assert.match(preview.summary, /J2 -90\.0°/)
})

test('ur_move_optimized 按 goal_type 分流成 joints / pose', () => {
  const joints = describePendingMotion('ur_move_optimized', { goal_type: 'joints', goal: [0, 1, 0, 0, 0, 0] })
  assert.equal(joints.kind, 'joints')
  assert.deepEqual(joints.q, [0, 1, 0, 0, 0, 0])

  const pose = describePendingMotion('ur_move_optimized', { goal_type: 'pose', goal: POSE })
  assert.equal(pose.kind, 'pose')
  assert.deepEqual(pose.pose, POSE)

  // goal_type 缺失或未知 → 退化
  assert.equal(describePendingMotion('ur_move_optimized', { goal: POSE }).kind, 'opaque')
})

test('位姿目标 → pose（本插件没有 IK，画不出对应姿态的臂，只给目标标记）', () => {
  const line = describePendingMotion('ur_movel', { pose: POSE })
  assert.equal(line.kind, 'pose')
  assert.deepEqual(line.pose, POSE)
  assert.match(line.summary, /直线运动/)
  assert.match(line.summary, /0\.100/)

  // movec 取**终点**，不是途经点
  const arc = describePendingMotion('ur_movec', { pose_via: [9, 9, 9, 0, 0, 0], pose_to: POSE })
  assert.equal(arc.kind, 'pose')
  assert.deepEqual(arc.pose, POSE)
  assert.match(arc.summary, /圆弧运动终点/)
})

test('相对位移 → relative（要结合当前 TCP 才能算绝对目标，只给文字）', () => {
  const plus = describePendingMotion('ur_move_x', { distance: 0.05 })
  assert.equal(plus.kind, 'relative')
  assert.equal(plus.axis, 'X')
  assert.equal(plus.frame, '基座')
  assert.equal(plus.distance, 0.05)
  assert.match(plus.summary, /沿基座 X 轴正向移动 0\.0500 m/)

  const minus = describePendingMotion('ur_move_tool_z', { distance: -0.02 })
  assert.equal(minus.frame, '工具')
  assert.match(minus.summary, /沿工具 Z 轴负向移动 0\.0200 m/)
})

test('其它受门禁的动作与一切畸形输入 → opaque，且**永不抛错**', () => {
  const cases = [
    ['ur_draw_circle', { center: POSE, r: 0.1 }],
    ['ur_run_program', { program_name: 'job.urp' }],
    ['ur_force_mode', {}],
    ['ur_speedl', { xd: [0, 0, 0, 0, 0, 0] }],
    ['ur_set_payload', { mass: 2 }],
    // 畸形：这些问题都该被"吞掉"而不是抛给审批弹窗
    [null, null],
    [undefined, undefined],
    ['ur_movej', { q: 'nope' }],
    ['ur_movej', { q: [1, 2, 3] }],
    ['ur_movej', { q: [1, 2, 3, 4, 5, Number.NaN] }],
    ['ur_movel', { pose: null }],
    ['ur_move_x', { distance: 'far' }],
    ['ur_move_x', {}],
    ['ur_move_optimized', { goal_type: 'joints', goal: 'x' }],
  ]

  for (const [tool, args] of cases) {
    let preview
    assert.doesNotThrow(() => {
      preview = describePendingMotion(tool, args)
    }, `${String(tool)} 不该抛错`)
    assert.equal(preview.kind, 'opaque', `${String(tool)} 应退化成 opaque`)
    assert.ok(preview.summary.length > 0, 'opaque 也必须给出可读的说明')
  }
})

test('summary 有长度上限（畸形长参数不会原样塞进界面）', () => {
  const preview = describePendingMotion('ur_run_program', { program_name: 'x'.repeat(5000) })
  assert.ok(preview.summary.length <= 200, `实测 ${preview.summary.length}`)
})

test('store：begin/end 配对，超过 TTL 即视为结束（异常中断不留悬挂预览）', () => {
  let t = 1000
  const store = createPendingMotionStore({ now: () => t })
  assert.equal(store.read(), null, '初始没有待审批')

  const token = store.begin('ur_movej', { q: Q })
  assert.equal(store.read().kind, 'joints')

  // TTL 内仍有效
  t += PENDING_MOTION_TTL_MS - 1
  assert.ok(store.read(), 'TTL 内必须仍可读')

  // 超时 → null，且是真的清掉了（再读仍为 null，而不是每次重新判定）
  t += 2
  assert.equal(store.read(), null)
  assert.equal(store.read(), null)

  const token2 = store.begin('ur_movel', { pose: POSE })
  store.end(token2)
  assert.equal(store.read(), null)
  // 已结束的 token 再 end 一次不能抛错（幂等）
  assert.doesNotThrow(() => store.end(token2))
  assert.doesNotThrow(() => store.end(token))
})

test('store：重叠审批时先结束的那次不得抹掉后一次的预览（token 机制）', () => {
  const store = createPendingMotionStore()
  const first = store.begin('ur_movej', { q: Q })
  const second = store.begin('ur_movel', { pose: POSE })
  assert.equal(store.read().kind, 'pose')

  // 第一次已被第二次覆盖：它结束不该动到第二次的预览。
  store.end(first)
  assert.equal(store.read().kind, 'pose')
  assert.equal(store.read().tool, 'ur_movel')

  store.end(second)
  assert.equal(store.read(), null)

  // clear 无条件清空
  store.begin('ur_movej', { q: Q })
  store.clear()
  assert.equal(store.read(), null)

  // 坏 token 不抛错
  assert.doesNotThrow(() => store.end(null))
  assert.doesNotThrow(() => store.end(undefined))
  assert.doesNotThrow(() => store.end({}))
})

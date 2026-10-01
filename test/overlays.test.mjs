/**
 * 工程辅助图层（清单第 9 条）的纯函数测试。
 *
 * 几何/材质的构建只在真正渲染时才需要 WebGL，但**尺寸与矢量的算法**可以在这里全部覆盖 ——
 * 那正是容易写错、且画错了肉眼未必立刻发现的部分（例如力箭头在死区里疯狂抖动）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createCogMarker,
  createForceArrow,
  createReachSphere,
  disposeOverlay,
  forceArrowFor,
  formatForce,
  FORCE_ARROW_DEADZONE_N,
  FORCE_ARROW_MAX_LENGTH,
  FORCE_ARROW_METERS_PER_NEWTON,
  reachRadiusFromKinematics,
  updateForceArrow,
} from '../src/client/robot/overlays.js'

/** 造一个"沿基座 x 轴逐段前进"的假变换表。 */
function straightLinks(step) {
  return Array.from({ length: 7 }, (_, i) => [
    1, 0, 0, step * i,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ])
}

test('reachRadiusFromKinematics：6 段之和，数据不足返回 null', () => {
  // 每段 0.1 m、共 6 段（第 7 项是末端近似，**不计入**）
  const radius = reachRadiusFromKinematics(straightLinks(0.1))
  assert.ok(radius !== null)
  assert.ok(Math.abs(radius - 0.6) < 1e-9, `实测 ${radius}`)

  assert.equal(reachRadiusFromKinematics(null), null)
  assert.equal(reachRadiusFromKinematics([]), null)
  assert.equal(reachRadiusFromKinematics([[1]]), null)
  // 所有段长为 0（畸形）→ null，而不是画一个半径 0 的球
  assert.equal(reachRadiusFromKinematics(straightLinks(0)), null)
})

test('forceArrowFor：死区内不画、按比例缩放、超长被钳住', () => {
  // 死区：噪声级别的小力不画（否则箭头会一直抖）
  assert.equal(forceArrowFor([0, 0, 0]), null)
  assert.equal(forceArrowFor([FORCE_ARROW_DEADZONE_N, 0, 0]), null, '恰好等于死区不画')
  assert.equal(forceArrowFor([0.5, 0.5, 0]), null)

  // 正常量：方向是单位向量，长度 = 力 × 比例
  const spec = forceArrowFor([10, 0, 0])
  assert.ok(spec)
  assert.deepEqual(spec.direction, [1, 0, 0])
  assert.ok(Math.abs(spec.length - 10 * FORCE_ARROW_METERS_PER_NEWTON) < 1e-12)

  // 方向归一化：模长不影响方向
  const diagonal = forceArrowFor([3, 4, 0])
  assert.ok(Math.abs(diagonal.direction[0] - 0.6) < 1e-12)
  assert.ok(Math.abs(diagonal.direction[1] - 0.8) < 1e-12)

  // 超大：钳到上限，绝不画出一根穿过整个画面的长矛
  const huge = forceArrowFor([100000, 0, 0])
  assert.equal(huge.length, FORCE_ARROW_MAX_LENGTH)

  // 畸形输入：一律 null，绝不抛错
  for (const bad of [null, undefined, [], [1, 2], [1, Number.NaN, 0], 'x', [1, 2, Infinity]]) {
    assert.doesNotThrow(() => forceArrowFor(bad))
    assert.equal(forceArrowFor(bad), null, `${String(bad)} 应返回 null`)
  }

  // 自定义阈值
  assert.equal(forceArrowFor([5, 0, 0], { deadzoneN: 10 }), null)
  assert.ok(forceArrowFor([5, 0, 0], { deadzoneN: 1 }))
})

test('formatForce：力与力矩的模长，缺值返回空串', () => {
  assert.equal(formatForce([3, 4, 0, 0, 0, 0]), '力 5.0 N  力矩 0.00 N·m')
  assert.equal(formatForce([0, 0, 0, 3, 4, 0]), '力 0.0 N  力矩 5.00 N·m')

  for (const bad of [null, undefined, [], [1, 2, 3], [1, 2, 3, 4, 5, Number.NaN], 'x']) {
    assert.equal(formatForce(bad), '', `${String(bad)} 应返回空串`)
  }
})

test('createReachSphere / createCogMarker / createForceArrow：默认全部隐藏', () => {
  // 一次全画出来会看不清真臂，所以图层必须默认关。
  const sphere = createReachSphere(1)
  assert.equal(sphere.visible, false)
  assert.equal(sphere.name, 'ur-twin-reach-sphere')
  assert.ok(sphere.children.length >= 2, '壳 + 线框')

  const marker = createCogMarker()
  assert.equal(marker.visible, false)
  assert.equal(marker.name, 'ur-twin-cog-marker')

  const arrow = createForceArrow(null)
  assert.equal(arrow.visible, false, '没有力的时候不显示箭头')
  assert.equal(arrow.name, 'ur-twin-force-arrow')

  // 非法半径要退化成可用的球，而不是半径 NaN（那会让整个球消失）
  const degenerate = createReachSphere(Number.NaN)
  assert.equal(degenerate.visible, false)
  assert.ok(degenerate.children.length >= 2)

  for (const object of [sphere, marker, arrow, degenerate]) disposeOverlay(object)
})

test('updateForceArrow：有力时显形、无力或死区时隐藏，且不重建对象', () => {
  const arrow = createForceArrow(null)
  const geometry = arrow.children[0]?.geometry ?? arrow.line?.geometry

  updateForceArrow(arrow, [20, 0, 0])
  assert.equal(arrow.visible, true, '有力必须显形')

  updateForceArrow(arrow, [0, 0, 0])
  assert.equal(arrow.visible, false, '力回到死区必须隐藏')

  // 只改已有的几何体/方向，**不重建** —— 运行期反复创建几何体是这个项目禁止的做法。
  const geometryAfter = arrow.children[0]?.geometry ?? arrow.line?.geometry
  assert.equal(geometryAfter, geometry, '不得重建几何体')

  // 坏输入不抛错
  assert.doesNotThrow(() => updateForceArrow(null, [1, 0, 0]))
  assert.doesNotThrow(() => updateForceArrow(arrow, null))
  assert.doesNotThrow(() => updateForceArrow(arrow, 'x'))

  disposeOverlay(arrow)
})

test('disposeOverlay 释放几何体与材质，且对 null / 空对象安全', () => {
  const sphere = createReachSphere(2)
  let geometries = 0
  let materials = 0
  sphere.traverse((node) => {
    if (node.geometry?.dispose) {
      const original = node.geometry.dispose.bind(node.geometry)
      node.geometry.dispose = () => { geometries += 1; original() }
    }
    const material = node.material
    if (material?.dispose) {
      const original = material.dispose.bind(material)
      material.dispose = () => { materials += 1; original() }
    }
  })

  disposeOverlay(sphere)
  assert.ok(geometries >= 2, `应释放壳与线框的几何体，实测 ${geometries}`)
  assert.ok(materials >= 2, `应释放材质，实测 ${materials}`)

  assert.doesNotThrow(() => disposeOverlay(null))
  assert.doesNotThrow(() => disposeOverlay(undefined))
  assert.doesNotThrow(() => disposeOverlay({}))
})

/**
 * TCP 坐标轴 gizmo（清单第 6 条）的专项测试。
 *
 * 这里能在 Node 里直接跑，是因为这些函数只碰 three 的场景图对象，不碰 WebGL。
 * 标签走 `document.createElement('canvas')`，在 Node 里**必然拿不到** —— 所以顺带
 * 验证了"无 canvas 环境优雅退化"这条契约。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createTcpAxes,
  disposeTcpAxes,
  tcpAxesSizeFor,
  updateTcpAxesSize,
  TCP_AXES_RADIUS_RATIO,
  TCP_AXES_SIZE,
  TCP_AXES_SIZE_MAX,
  TCP_AXES_SIZE_MIN,
  TCP_AXIS_LABELS,
} from '../src/client/robot/tcp-axes.js'

test('tcpAxesSizeFor：中段按半径比例、两端钳住、非法半径回退默认值', () => {
  // 还没取景过时半径是 0：必须回退默认轴长，而不是算出 0 让 gizmo 消失。
  assert.equal(tcpAxesSizeFor(0), TCP_AXES_SIZE)
  assert.equal(tcpAxesSizeFor(-1), TCP_AXES_SIZE)
  assert.equal(tcpAxesSizeFor(Number.NaN), TCP_AXES_SIZE)
  assert.equal(tcpAxesSizeFor(undefined), TCP_AXES_SIZE)
  assert.equal(tcpAxesSizeFor(null), TCP_AXES_SIZE)
  assert.equal(tcpAxesSizeFor('0.5'), TCP_AXES_SIZE)

  // 中段：纯比例。
  assert.ok(Math.abs(tcpAxesSizeFor(1) - TCP_AXES_RADIUS_RATIO) < 1e-12)

  // 两端：钳住而不是线性外推（UR3 半径很小、UR30 很大）。
  assert.equal(tcpAxesSizeFor(0.01), TCP_AXES_SIZE_MIN)
  assert.equal(tcpAxesSizeFor(100), TCP_AXES_SIZE_MAX)

  // 单调不减 —— 换更大的臂不该得到更小的 gizmo。
  for (let r = 0.1; r < 3; r += 0.1) {
    assert.ok(
      tcpAxesSizeFor(r) <= tcpAxesSizeFor(r + 0.1) + 1e-12,
      `半径 ${r} → ${r + 0.1} 时轴长不应变小`,
    )
  }
})

test('createTcpAxes：外层 Group 承接矩阵、内层 content 承接尺度，AxesHelper 挂在内层', () => {
  const gizmo = createTcpAxes(TCP_AXES_SIZE)

  assert.equal(gizmo.type, 'Group')
  assert.equal(gizmo.name, 'ur-twin-tcp-axes')

  const content = gizmo.userData.content
  assert.ok(content, '必须有内层 content（尺度），否则缩放会被 tool0 矩阵吃掉')
  assert.equal(content.name, 'ur-twin-tcp-axes-content')

  const axes = gizmo.userData.axes
  assert.ok(axes, '必须挂出内部 AxesHelper')
  assert.ok(content.children.includes(axes), 'AxesHelper 必须挂在**内层** content 上')
  assert.ok(!gizmo.children.includes(axes), 'AxesHelper 不该直接挂在外层')
})

test('无 canvas 环境（Node）必须优雅退化：gizmo 仍然可用，只是没有字母标签', () => {
  assert.equal(typeof document, 'undefined', '本用例的前提就是 Node 里没有 document')

  let gizmo
  assert.doesNotThrow(() => {
    gizmo = createTcpAxes(TCP_AXES_SIZE)
  }, '画不出标签绝不能抛错')

  assert.ok(gizmo.userData.axes, '轴本身必须还在')
  assert.deepEqual(gizmo.userData.labels, [], '拿不到 canvas 时标签数组为空，而不是半成品')
})

test('轴标签常量与 AxesHelper 的 X/Y/Z 配色一致，顺序固定', () => {
  assert.equal(TCP_AXIS_LABELS.length, 3)
  assert.deepEqual(TCP_AXIS_LABELS.map((entry) => entry.text), ['X', 'Y', 'Z'])
  // AxesHelper 内部用 0xff3653 / 0x8cff36 / 0x36a2ff；改成别的颜色会让轴与字母对不上。
  assert.deepEqual(TCP_AXIS_LABELS.map((entry) => entry.color), [0xff3653, 0x8cff36, 0x36a2ff])
  assert.ok(Object.isFrozen(TCP_AXIS_LABELS), '常量必须冻结，避免被运行时改写')
})

test('updateTcpAxesSize 缩的是内层 content —— 外层的 scale 会被每帧 tool0 矩阵覆盖', () => {
  const gizmo = createTcpAxes(TCP_AXES_SIZE)
  const content = gizmo.userData.content

  updateTcpAxesSize(gizmo, TCP_AXES_SIZE * 2)
  assert.equal(content.scale.x, 2)
  assert.equal(
    gizmo.scale.x,
    1,
    '外层 scale 必须保持 1：它的矩阵每帧由 tool0 直接覆写，在那里缩放不会生效',
  )

  // 非法尺寸 → 回到 1 倍，而不是把 NaN 写进场景图（那会让整棵子树消失）。
  updateTcpAxesSize(gizmo, Number.NaN)
  assert.equal(content.scale.x, 1)
  updateTcpAxesSize(gizmo, 0)
  assert.equal(content.scale.x, 1)
  updateTcpAxesSize(gizmo, -1)
  assert.equal(content.scale.x, 1)

  // 缺节点时不抛错：调用方可能在 dispose 之后才收到回调。
  assert.doesNotThrow(() => updateTcpAxesSize(null, 0.1))
  assert.doesNotThrow(() => updateTcpAxesSize({}, 0.1))
})

test('disposeTcpAxes 释放几何体与材质，且对 null / 空对象安全', () => {
  const gizmo = createTcpAxes(TCP_AXES_SIZE)

  let geometryDisposed = 0
  let materialDisposed = 0
  gizmo.traverse((object) => {
    if (object.geometry?.dispose) {
      const original = object.geometry.dispose.bind(object.geometry)
      object.geometry.dispose = () => { geometryDisposed += 1; original() }
    }
    const material = object.material
    if (material?.dispose) {
      const original = material.dispose.bind(material)
      material.dispose = () => { materialDisposed += 1; original() }
    }
  })

  disposeTcpAxes(gizmo)
  assert.ok(geometryDisposed >= 1, '必须释放 AxesHelper 的几何体')
  assert.ok(materialDisposed >= 1, '必须释放材质')

  assert.doesNotThrow(() => disposeTcpAxes(null))
  assert.doesNotThrow(() => disposeTcpAxes(undefined))
  assert.doesNotThrow(() => disposeTcpAxes({}))
})

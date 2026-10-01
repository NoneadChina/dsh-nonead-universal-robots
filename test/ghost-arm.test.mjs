/**
 * 幽灵臂（清单第 7 条）专项测试。
 *
 * 这里最要紧的两条正确性契约：
 * 1. 克隆是**浅拷** —— 幽灵臂与真臂共享 geometry（多一层几乎不占显存）；
 * 2. **绝不能释放那批 geometry** —— 释放了会把真臂一起毁掉（模型突然消失）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fkChain } from '../src/client/robot/fk.js'
import {
  createGhostArm,
  disposeGhostArm,
  GHOST_ARM_OPACITY,
  GHOST_ARM_PENDING_COLOR,
} from '../src/client/robot/ghost-arm.js'
import { loadRobotModel } from '../src/client/robot/loader.js'
import { resolveKinematics } from '../src/client/twin-panel.js'

const Q0 = [0, -Math.PI / 2, Math.PI / 2, -Math.PI / 2, -Math.PI / 2, 0]

/** 造一个必定回退的模型句柄（回退臂 7 段胶囊，结构与真臂一致）。 */
async function fallbackHandle(tag) {
  return await loadRobotModel(`ghost-unit-${tag}`, {
    loadGltf: () => Promise.reject(new Error('本用例不需要真 GLB')),
  })
}

test('createGhostArm 克隆出 7 个装配组，且默认隐藏（没目标数据时不该出现假臂）', async () => {
  const handle = await fallbackHandle('shape')
  const ghost = createGhostArm(handle)

  assert.equal(ghost.root.name, 'ur-twin-ghost-arm')
  assert.equal(ghost.root.visible, false, '默认必须隐藏')
  assert.equal(ghost.groups.length, 7)
  for (let i = 0; i < 7; i++) {
    assert.ok(ghost.groups[i], `第 ${i} 个装配组必须被按名字重新解析出来`)
    assert.ok(ghost.groups[i].name.startsWith('assemble_'))
  }

  ghost.setVisible(true)
  assert.equal(ghost.root.visible, true)
  ghost.setVisible(false)
  assert.equal(ghost.root.visible, false)
  // 严格比较 true，别把 truthy 当可见。
  ghost.setVisible('yes')
  assert.equal(ghost.root.visible, false)

  disposeGhostArm(ghost)
  handle.dispose()
})

test('材质是半透明的，且整棵树共用同一个材质实例（省 draw call）', async () => {
  const handle = await fallbackHandle('material')
  const ghost = createGhostArm(handle)

  assert.equal(ghost.material.transparent, true)
  assert.equal(ghost.material.opacity, GHOST_ARM_OPACITY)
  assert.equal(ghost.material.depthWrite, false, '半透明写深度会互相遮挡出硬边')

  const materials = new Set()
  ghost.root.traverse((object) => {
    if (object.isMesh) materials.add(object.material)
  })
  assert.ok(materials.size > 0, '树上必须有 mesh')
  assert.equal(materials.size, 1, '整棵树必须共用同一个材质实例')
  assert.ok(materials.has(ghost.material))

  disposeGhostArm(ghost)
  handle.dispose()
})

test('幽灵臂与真臂**共享** geometry（浅拷），dispose 时绝不释放它们', async () => {
  const handle = await fallbackHandle('share')
  const ghost = createGhostArm(handle)

  const realGeometries = new Set()
  handle.root.traverse((object) => {
    if (object.geometry) realGeometries.add(object.geometry)
  })
  const ghostGeometries = new Set()
  ghost.root.traverse((object) => {
    if (object.geometry) ghostGeometries.add(object.geometry)
  })

  assert.ok(realGeometries.size > 0 && ghostGeometries.size > 0)
  assert.equal(ghostGeometries.size, realGeometries.size)
  for (const geometry of ghostGeometries) {
    assert.ok(realGeometries.has(geometry), '幽灵臂必须复用真臂的 geometry，而不是深拷一份')
  }

  // 给每个共享 geometry 装一个计数器，然后释放幽灵臂 —— 计数必须保持 0。
  let geometryDisposed = 0
  for (const geometry of realGeometries) {
    const original = geometry.dispose.bind(geometry)
    geometry.dispose = () => {
      geometryDisposed += 1
      original()
    }
  }
  disposeGhostArm(ghost)
  assert.equal(
    geometryDisposed,
    0,
    '绝不能释放与真臂共享的 geometry —— 那会把真臂一起毁掉',
  )

  // 真臂仍然完好，能被正常释放。
  let realDisposed = 0
  for (const geometry of realGeometries) {
    const original = geometry.dispose.bind(geometry)
    geometry.dispose = () => {
      realDisposed += 1
      original()
    }
  }
  handle.dispose()
  assert.equal(realDisposed, realGeometries.size, '真臂的 geometry 应被 handle.dispose 释放')
})

test('ghost.applyFK 与真臂 applyFK 语义一致：groups[0] 单位阵、groups[k] 取 links[k-1]', async () => {
  const handle = await fallbackHandle('fk')
  const ghost = createGhostArm(handle)

  const result = fkChain(resolveKinematics('ur3'), Q0)
  ghost.applyFK(result)
  handle.applyFK(result)

  for (let k = 1; k < 7; k++) {
    const expected = result.links[k - 1]
    for (let i = 0; i < 16; i++) {
      assert.ok(
        Math.abs(ghost.groups[k].matrix.elements[i] - expected[i]) < 1e-12,
        `幽灵臂 groups[${k}].matrix[${i}] 与真臂语义不一致`,
      )
    }
  }
  // 基座恒为单位矩阵。
  assert.deepEqual([...ghost.groups[0].matrix.elements], [
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  ])

  // 坏数据静默保持上一姿态，不抛错。
  const before = [...ghost.groups[1].matrix.elements]
  assert.doesNotThrow(() => ghost.applyFK(null))
  assert.doesNotThrow(() => ghost.applyFK({ links: 'nope' }))
  assert.deepEqual([...ghost.groups[1].matrix.elements], before)

  disposeGhostArm(ghost)
  handle.dispose()
})

test('createGhostArm / disposeGhostArm 对坏输入安全', () => {
  assert.throws(() => createGhostArm(null), /需要一个含 root 的模型句柄/)
  assert.throws(() => createGhostArm({}), /需要一个含 root 的模型句柄/)
  assert.doesNotThrow(() => disposeGhostArm(null))
  assert.doesNotThrow(() => disposeGhostArm(undefined))
  assert.doesNotThrow(() => disposeGhostArm({}))
})

test('setPending 只改颜色、不换材质实例（否则每帧都在产生 GPU 资源）', async () => {
  const handle = await fallbackHandle('pending-color')
  const ghost = createGhostArm(handle)
  const material = ghost.material
  const base = material.color.getHex()

  ghost.setPending(true)
  assert.equal(material.color.getHex(), GHOST_ARM_PENDING_COLOR, '待审批必须换成醒目的橙色')
  assert.equal(ghost.material, material, '不能换材质实例')

  ghost.setPending(false)
  assert.equal(material.color.getHex(), base, '取消待审批要恢复原色')
  assert.equal(ghost.material, material)

  // 只有严格 true 才算待审批，别把 truthy 当信号。
  ghost.setPending('yes')
  assert.equal(material.color.getHex(), base)

  disposeGhostArm(ghost)
  handle.dispose()
})

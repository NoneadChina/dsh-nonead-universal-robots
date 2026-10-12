/**
 * 回退臂的连杆长度（清单第 14 条）专项测试。
 *
 * 原先 `buildFallbackArm()` 无条件用 UR3 量级的 `ARM_LINKS`，未知型号回退时几何尺寸
 * 明显不符。现在长度可从 `kinematics.json` 的 `links` 相邻原点距离算出来并传下去。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  ARM_LINKS,
  buildFallbackArm,
  linkLengthsFromKinematics,
  loadRobotModel,
  normalizeArmLinks,
} from '../src/client/robot/loader.js'

/** 造一个"沿基座 x 轴逐段前进"的假变换表：相邻间距就是段长。 */
function straightLinks(step) {
  return Array.from({ length: 7 }, (_, i) => [
    1, 0, 0, step * i,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ])
}

test('normalizeArmLinks：恰好 7 个正的有限长度，非法位置逐个回退 ARM_LINKS 同位值', () => {
  assert.deepEqual(normalizeArmLinks(null), [...ARM_LINKS])
  assert.deepEqual(normalizeArmLinks(undefined), [...ARM_LINKS])
  assert.deepEqual(normalizeArmLinks('nope'), [...ARM_LINKS])

  // 短数组：缺的位置回退，已有的保留。
  assert.deepEqual(
    normalizeArmLinks([1, 2, 3]),
    [1, 2, 3, ARM_LINKS[3], ARM_LINKS[4], ARM_LINKS[5], ARM_LINKS[6]],
  )

  // 逐个非法值回退 —— 绝不让 NaN/0/负数进几何体（NaN 顶点会让整棵子树消失）。
  assert.deepEqual(
    normalizeArmLinks([1, Number.NaN, 0, -1, 'x', null, 2]),
    [1, ARM_LINKS[1], ARM_LINKS[2], ARM_LINKS[3], ARM_LINKS[4], ARM_LINKS[5], 2],
  )
  assert.deepEqual(normalizeArmLinks([Number.POSITIVE_INFINITY]), [...ARM_LINKS])

  // 永远返回 7 个。
  assert.equal(normalizeArmLinks([1, 2, 3, 4, 5, 6, 7, 8, 9]).length, 7)
})

test('linkLengthsFromKinematics：相邻原点距离，形状不对时返回 null 而不是猜', () => {
  const lengths = linkLengthsFromKinematics(straightLinks(0.4))
  assert.ok(lengths, '合法输入必须算出长度')
  assert.equal(lengths.length, 7)
  for (let i = 0; i < 6; i++) {
    assert.ok(Math.abs(lengths[i] - 0.4) < 1e-12, `第 ${i + 1} 段应为 0.4，实测 ${lengths[i]}`)
  }
  // 第 7 段（末端）用最后一段近似。
  assert.ok(Math.abs(lengths[6] - lengths[5]) < 1e-12)

  // 数据不足 / 形状不对：返回 null，让调用方保持缺省，而不是造出 NaN 长度。
  assert.equal(linkLengthsFromKinematics(null), null)
  assert.equal(linkLengthsFromKinematics([]), null)
  assert.equal(linkLengthsFromKinematics([[1]]), null)
  assert.equal(linkLengthsFromKinematics(straightLinks(0.4).slice(0, 5)), null)
  const broken = straightLinks(0.4)
  broken[3] = [1, 0, 0, Number.NaN, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  assert.equal(linkLengthsFromKinematics(broken), null, '平移分量非有限数时必须放弃')
})

test('linkLengthsFromKinematics：认识 assets/kinematics.json 的真实位移格式（0.6.9 回归）', async () => {
  const KIN = JSON.parse(await readFile(new URL('../assets/kinematics.json', import.meta.url), 'utf8'))
  const ids = Object.keys(KIN)
  assert.equal(ids.length, 14, '内置型号数变了 —— 请同步更新本断言')

  const reach = {}
  for (const id of ids) {
    const lengths = linkLengthsFromKinematics(KIN[id].links)
    // 旧实现（只认 7 × 4×4 矩阵）对这里**一律**返回 null —— 那正是"换什么型号可达范围都一样大"的根因。
    assert.ok(Array.isArray(lengths), `${id}: 真实位移格式必须能算出长度`)
    assert.equal(lengths.length, 7, `${id}: 必须恰好 7 段（base + 6 连杆）`)
    for (const value of lengths) {
      assert.ok(Number.isFinite(value) && value >= 0, `${id}: 段长必须是有限非负数，实测 ${value}`)
    }
    reach[id] = lengths.slice(0, 6).reduce((sum, value) => sum + value, 0)
  }

  // 量级（米）：UR3 ≈ 0.804、UR20 ≈ 2.168 —— 与官方 reach 的 2.5 倍以上跨度一致。
  assert.ok(Math.abs(reach.ur3 - 0.804) < 0.01, `ur3 实测 ${reach.ur3}`)
  assert.ok(Math.abs(reach.ur20 - 2.168) < 0.02, `ur20 实测 ${reach.ur20}`)
  assert.ok(reach.ur20 > reach.ur3 * 2.5, `UR20/UR3 应 >2.5，实测 ${(reach.ur20 / reach.ur3).toFixed(2)}`)
  // 同族升级必须单调变长（否则就是数据抄错了）。
  assert.ok(reach.ur3 < reach.ur5 && reach.ur5 < reach.ur10 && reach.ur10 < reach.ur20)
})

test('buildFallbackArm(armLinks)：几何尺寸跟着传入的长度走，而不是永远 UR3 量级', () => {
  const big = buildFallbackArm([0.3, 0.3, 0.35, 0.3, 0.2, 0.2, 0.2])
  const small = buildFallbackArm(ARM_LINKS)

  const midLength = (root, index) => {
    const mesh = root.children[index]
    return mesh.geometry.parameters.height
  }

  // 第 3 段（最长的一段）在两个臂上必须明显不同。
  const bigMid = midLength(big, 2)
  const smallMid = midLength(small, 2)
  assert.ok(
    bigMid > smallMid * 1.2,
    `大臂中段 ${bigMid} 应明显长于 UR3 的 ${smallMid}`,
  )
  assert.ok(Math.abs(bigMid - 0.35 * 0.8) < 1e-9, '段长应等于 armLinks[i] * 0.8')

  // 段名必须与 LINK_MESH_NODES 一致（装配表靠它匹配）。
  for (const root of [big, small]) {
    assert.equal(root.children.length, 7)
    for (const mesh of root.children) assert.ok(mesh.name, '每段都必须有名字')
  }
})

/**
 * 收集树里所有胶囊的高度。
 *
 * `loadRobotModel` 会按 LINK_MESH_NODES 把 7 段**重新装配**进 7 个装配组，所以
 * `root.children` 不是那 7 个 mesh —— 断言必须与装配结构解耦。
 */
function collectCapsuleHeights(root) {
  const heights = []
  root.traverse?.((object) => {
    const height = object.geometry?.parameters?.height
    if (Number.isFinite(height)) heights.push(height)
  })
  return heights
}

test('loadRobotModel 的回退路径使用 deps.armLinks（GLB 失败时也保持型号尺寸）', async () => {
  const failing = () => Promise.reject(new Error('没有这个 GLB'))
  const armLinks = [0.42, 0.42, 0.44, 0.42, 0.21, 0.21, 0.21]

  const handle = await loadRobotModel('unit-test-large-fallback', { loadGltf: failing, armLinks })
  assert.equal(handle.usedFallback, true)
  assert.ok(
    collectCapsuleHeights(handle.root).some((h) => Math.abs(h - 0.44 * 0.8) < 1e-9),
    '回退臂必须用传入的连杆长度，而不是 UR3 量级的 ARM_LINKS',
  )
  handle.dispose()

  // 不传 armLinks 时保持旧行为（UR3 量级），确保这条改动是纯增量的。
  const plain = await loadRobotModel('unit-test-default-fallback', { loadGltf: failing })
  assert.equal(plain.usedFallback, true)
  assert.ok(
    collectCapsuleHeights(plain.root).some((h) => Math.abs(h - ARM_LINKS[2] * 0.8) < 1e-9),
    '缺省仍走 ARM_LINKS',
  )
  plain.dispose()
})

/**
 * test/fk.test.mjs — Task 3：UR 正向运动学纯函数测试。
 *
 * 断言纪律（见 task-3-brief.md）：**不硬编码猜测出来的浮点数值**。
 * 本文件只使用以下可证明的断言类型：
 *   1. 恒等元 / 定义性事实（rotZ(0)=I、rotZ(π/2)·ex = ey、刚性变换的正交性 + det=+1）
 *   2. 代数律（乘法结合律、单位元）
 *   3. 与**独立推导的参考实现**对拍（行主序写法的 Rz(yaw)·Ry(pitch)·Rx(roll)，URDF rpy 定义）
 *   4. 合成运动学数据上的**精确**几何（纯平移串联、绕 z 旋转等，输入是选定值而非猜出的输出）
 *   5. 结构/几何不变量（下三角依赖、末端关节不改变末端位置、可达半径上界由数据自身推出）
 *
 * 运行：node --test test/fk.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { identity4, multiply4, rotZ, poseToMatrix4, fkChain } from '../src/client/robot/fk.js'

const KIN = JSON.parse(await readFile(new URL('../assets/kinematics.json', import.meta.url), 'utf8'))
const MODEL_NAMES = Object.keys(KIN)

const EPS = 1e-9

/* ------------------------------------------------------------------ *
 * 断言辅助
 * ------------------------------------------------------------------ */

function closeTo(actual, expected, eps = EPS, label = '') {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${label} 实际 ${actual} ≈ 期望 ${expected}，偏差 ${Math.abs(actual - expected)} > ${eps}`,
  )
}

function matrixCloseTo(actual, expected, eps = EPS, label = '') {
  assert.ok(Array.isArray(actual), `${label} 必须是数组`)
  assert.equal(actual.length, 16, `${label} 长度必须是 16`)
  for (let i = 0; i < 16; i++) closeTo(actual[i], expected[i], eps, `${label}[${i}]`)
}

function vectorCloseTo(actual, expected, eps = EPS, label = '') {
  assert.ok(Array.isArray(actual), `${label} 必须是数组`)
  assert.equal(actual.length, expected.length, `${label} 维度`)
  for (let i = 0; i < expected.length; i++) closeTo(actual[i], expected[i], eps, `${label}[${i}]`)
}

const translationOf = (m) => [m[12], m[13], m[14]]
const norm3 = (v) => Math.hypot(v[0], v[1], v[2])
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const columnsOf = (m) => [
  [m[0], m[1], m[2]],
  [m[4], m[5], m[6]],
  [m[8], m[9], m[10]],
]

/** 用旋转部分作用到一个 3 维向量上（忽略平移列）。 */
function applyRot(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ]
}

/** 断言 m 是合法刚体变换的列主序表示：底行 [0,0,0,1]、旋转部分正交、det = +1。 */
function assertRigid(m, label = '', eps = EPS) {
  assert.ok(Array.isArray(m) && m.length === 16, `${label} 长度必须是 16`)
  closeTo(m[3], 0, eps, `${label} m[3]`)
  closeTo(m[7], 0, eps, `${label} m[7]`)
  closeTo(m[11], 0, eps, `${label} m[11]`)
  closeTo(m[15], 1, eps, `${label} m[15]`)

  const [c0, c1, c2] = columnsOf(m)
  closeTo(norm3(c0), 1, eps, `${label} |c0|`)
  closeTo(norm3(c1), 1, eps, `${label} |c1|`)
  closeTo(norm3(c2), 1, eps, `${label} |c2|`)
  closeTo(dot3(c0, c1), 0, eps, `${label} c0·c1`)
  closeTo(dot3(c0, c2), 0, eps, `${label} c0·c2`)
  closeTo(dot3(c1, c2), 0, eps, `${label} c1·c2`)

  // det[c0 c1 c2] = c0 · (c1 × c2)；+1 表示真旋转（无镜像）
  const cross = [
    c1[1] * c2[2] - c1[2] * c2[1],
    c1[2] * c2[0] - c1[0] * c2[2],
    c1[0] * c2[1] - c1[1] * c2[0],
  ]
  closeTo(dot3(c0, cross), 1, eps, `${label} det`)
}

/* ------------------------------------------------------------------ *
 * 独立参考实现（行主序；不共享被测模块的任何代码路径）
 * ------------------------------------------------------------------ */

const toColMajor = (rm) => [
  rm[0], rm[4], rm[8], rm[12],
  rm[1], rm[5], rm[9], rm[13],
  rm[2], rm[6], rm[10], rm[14],
  rm[3], rm[7], rm[11], rm[15],
]

function refMulRowMajor(a, b) {
  const out = new Array(16)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[4 * r + k] * b[4 * k + c]
      out[4 * r + c] = s
    }
  }
  return out
}

/**
 * 独立参考：URDF 的 rpy 是外旋 xyz 序，等价于内旋 zyx，即 R = Rz(yaw)·Ry(pitch)·Rx(roll)。
 * 行主序显式写出三个基本旋转矩阵再相乘——与 fk.js 的写法无关。
 */
function refPoseToMatrix4(x, y, z, roll, pitch, yaw) {
  const cr = Math.cos(roll), sr = Math.sin(roll)
  const cp = Math.cos(pitch), sp = Math.sin(pitch)
  const cy = Math.cos(yaw), sy = Math.sin(yaw)

  const RX = [1, 0, 0, 0, 0, cr, -sr, 0, 0, sr, cr, 0, 0, 0, 0, 1]
  const RY = [cp, 0, sp, 0, 0, 1, 0, 0, -sp, 0, cp, 0, 0, 0, 0, 1]
  const RZ = [cy, -sy, 0, 0, sy, cy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

  const R = refMulRowMajor(refMulRowMajor(RZ, RY), RX)
  // 先把行主序旋转部分转成列主序，再写平移列（列主序的 m[12..14]）
  const m = toColMajor(R)
  m[12] = x
  m[13] = y
  m[14] = z
  return m
}

/** 合成运动学数据：只给指定下标设置连杆，其余为全零（单位变换）。 */
function syntheticKin(overrides = {}) {
  const links = []
  for (let i = 0; i < 6; i++) {
    links.push({ x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0, ...(overrides[i] ?? {}) })
  }
  return { links }
}

/** 由 kin 数据自身推出末端可达半径上界：|p| ≤ Σ|t_i|（每次平移前只经过正交矩阵）。 */
function reachUpperBound(kin) {
  return kin.links.reduce(
    (acc, l) => acc + Math.hypot(l.x ?? 0, l.y ?? 0, l.z ?? 0),
    0,
  )
}

/* ------------------------------------------------------------------ *
 * identity4 / multiply4
 * ------------------------------------------------------------------ */

test('identity4() 返回 4x4 单位矩阵', () => {
  assert.deepEqual(identity4(), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
})

test('identity4() 是 multiply4 的左右单位元', () => {
  const I = identity4()
  const samples = [
    refPoseToMatrix4(0.1, -0.2, 0.3, 0.4, -0.5, 0.6),
    fkChain(KIN.ur3, [0.1, -0.2, 0.3, -0.4, 0.5, -0.6]).tool0,
  ]
  for (const [i, m] of samples.entries()) {
    matrixCloseTo(multiply4(I, m), m, EPS, `I·m[${i}]`)
    matrixCloseTo(multiply4(m, I), m, EPS, `m·I[${i}]`)
  }
})

test('multiply4 满足结合律', () => {
  const a = fkChain(KIN.ur5e, [0.3, 0.4, -0.5, 0.6, -0.7, 0.8]).links[2]
  const b = refPoseToMatrix4(0.05, 0.06, -0.07, 0.2, -0.3, 0.4)
  const c = rotZ(-1.1)
  matrixCloseTo(
    multiply4(multiply4(a, b), c),
    multiply4(a, multiply4(b, c)),
    1e-12,
    '(a·b)·c vs a·(b·c)',
  )
})

test('multiply4 的平移列等于矩阵作用后的复合平移', () => {
  const t = multiply4(poseToMatrix4(1, 2, 3, 0, 0, 0), poseToMatrix4(0.5, -1, 2, 0, 0, 0))
  vectorCloseTo(translationOf(t), [1.5, 1, 5], EPS, '纯平移复合')
})

test('multiply4 不修改其参数', () => {
  const a = fkChain(KIN.ur10, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]).links[0]
  const b = rotZ(0.7)
  const aCopy = a.slice()
  const bCopy = b.slice()
  multiply4(a, b)
  assert.deepEqual(a, aCopy, 'a 被修改')
  assert.deepEqual(b, bCopy, 'b 被修改')
})

/* ------------------------------------------------------------------ *
 * rotZ
 * ------------------------------------------------------------------ */

test('rotZ(0) 是单位矩阵', () => {
  matrixCloseTo(rotZ(0), identity4(), EPS, 'rotZ(0)')
})

test('rotZ 是纯旋转：平移列为 0，旋转部分正交且 det=+1', () => {
  for (const t of [0.3, -0.7, Math.PI / 2, Math.PI, 2.4, -3.0]) {
    const m = rotZ(t)
    assertRigid(m, `rotZ(${t})`)
    closeTo(m[12], 0, EPS, `rotZ(${t}) m[12]`)
    closeTo(m[13], 0, EPS, `rotZ(${t}) m[13]`)
    closeTo(m[14], 0, EPS, `rotZ(${t}) m[14]`)
  }
})

test('rotZ(π/2) 把 x 轴映到 y 轴，rotZ(t) 保持 z 轴不动', () => {
  const r90 = applyRot(rotZ(Math.PI / 2), [1, 0, 0])
  closeTo(r90[0], 0, EPS, 'R·ex 的 x 分量')
  closeTo(r90[1], 1, EPS, 'R·ex 的 y 分量')
  closeTo(r90[2], 0, EPS, 'R·ex 的 z 分量')

  for (const t of [0.4, -1.3, 2.9]) {
    const ez = applyRot(rotZ(t), [0, 0, 1])
    closeTo(ez[0], 0, EPS, 'R·ez 的 x 分量')
    closeTo(ez[1], 0, EPS, 'R·ez 的 y 分量')
    closeTo(ez[2], 1, EPS, 'R·ez 的 z 分量')
  }
})

test('rotZ(t) 与其逆 rotZ(-t) 相乘得到单位矩阵', () => {
  for (const t of [0.25, -1.75, Math.PI]) {
    matrixCloseTo(multiply4(rotZ(t), rotZ(-t)), identity4(), 1e-12, `rotZ(${t})·rotZ(${-t})`)
  }
})

/* ------------------------------------------------------------------ *
 * poseToMatrix4
 * ------------------------------------------------------------------ */

test('poseToMatrix4 的平移列等于输入的 x/y/z', () => {
  const m = poseToMatrix4(0.12, -0.34, 0.56, 0.7, -0.8, 0.9)
  closeTo(m[12], 0.12, EPS, 'x')
  closeTo(m[13], -0.34, EPS, 'y')
  closeTo(m[14], 0.56, EPS, 'z')
})

test('poseToMatrix4 在 rpy 全零时退化为纯平移', () => {
  matrixCloseTo(
    poseToMatrix4(1, 2, 3, 0, 0, 0),
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1],
    EPS,
    'poseToMatrix4(1,2,3,0,0,0)',
  )
})

test('poseToMatrix4 与独立参考实现 Rz(yaw)·Ry(pitch)·Rx(roll) 一致', () => {
  const samples = [
    [0, 0, 0, 0, 0, 0],
    [1, 2, 3, Math.PI / 2, 0, 0],
    [0, 0, 0, 0, Math.PI / 2, 0],
    [0, 0, 0, 0, 0, Math.PI / 2],
    [0.1, -0.2, 0.3, 0.4, -0.5, 0.6],
    [-0.3, 0.4, -0.5, -1.2, 0.7, -2.1],
    [0, 0, 0, Math.PI / 2, Math.PI / 2, Math.PI / 2],
  ]
  for (const s of samples) {
    matrixCloseTo(poseToMatrix4(...s), refPoseToMatrix4(...s), 1e-12, `poseToMatrix4(${s})`)
  }
})

test('poseToMatrix4 的输出始终是刚体变换', () => {
  for (const s of [
    [1, 2, 3, 0.3, -0.4, 0.5],
    [0, 0, 0, Math.PI, Math.PI / 3, -Math.PI / 5],
    [-0.2, 0.7, -0.9, -2.5, 1.1, 3.3],
  ]) {
    assertRigid(poseToMatrix4(...s), `poseToMatrix4(${s})`)
  }
})

test('poseToMatrix4 的 yaw 部分与 rotZ 一致', () => {
  for (const t of [0, 0.7, -1.9, Math.PI / 2]) {
    matrixCloseTo(poseToMatrix4(0, 0, 0, 0, 0, t), rotZ(t), 1e-12, `yaw=${t}`)
  }
})

/* ------------------------------------------------------------------ *
 * fkChain —— 合成数据上的精确几何
 * ------------------------------------------------------------------ */

test('fkChain：全零运动学 + q=0 得到单位矩阵', () => {
  const { links, tool0 } = fkChain(syntheticKin(), [0, 0, 0, 0, 0, 0])
  assert.equal(links.length, 6)
  for (const [i, m] of links.entries()) matrixCloseTo(m, identity4(), EPS, `links[${i}]`)
  matrixCloseTo(tool0, identity4(), EPS, 'tool0')
})

test('fkChain：纯平移链在 q=0 时把各连杆平移相加（次序无关）', () => {
  const kin = syntheticKin({ 0: { z: 0.2 }, 2: { x: 0.3 }, 5: { y: -0.4 } })
  const { tool0 } = fkChain(kin, [0, 0, 0, 0, 0, 0])
  vectorCloseTo(translationOf(tool0), [0.3, -0.4, 0.2], EPS, '纯平移复合')
  matrixCloseTo(tool0, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.3, -0.4, 0.2, 1], EPS, 'tool0')
})

test('fkChain：连杆旋转作用在后续连杆的平移上（链序正确）', () => {
  // links[0] 只给 z 位移；links[1] 绕 x 转 π/2 且带 x 位移。
  // 由于 t = P0·Rz(q0)·P1·Rz(q1)…，P1 的位移必须在其自身旋转之后、且被 P0 平移搬移。
  const kin = syntheticKin({ 0: { z: 0.1 }, 1: { x: 0.2, roll: Math.PI / 2 } })
  const { tool0 } = fkChain(kin, [0, 0, 0, 0, 0, 0])
  // Rx(π/2) 保持 x 轴 → P1 的 (0.2,0,0) 仍是 (0.2,0,0)，再加 P0 的 (0,0,0.1)
  vectorCloseTo(translationOf(tool0), [0.2, 0, 0.1], EPS, '含旋转的链序')
  // 旋转部分必须等于 Rx(π/2)：ey → ez
  const ey = applyRot(tool0, [0, 1, 0])
  closeTo(ey[0], 0, EPS, 'R·ey x')
  closeTo(ey[1], 0, EPS, 'R·ey y')
  closeTo(ey[2], 1, EPS, 'R·ey z')
})

test('fkChain：关节 0 绕基座 z 轴旋转（合成数据上精确成立）', () => {
  const kin = syntheticKin({ 0: { z: 0.1 }, 1: { x: 0.2 } })
  const q0 = fkChain(kin, [0, 0, 0, 0, 0, 0]).tool0
  const q90 = fkChain(kin, [Math.PI / 2, 0, 0, 0, 0, 0]).tool0
  // Rz(π/2)·(0.2,0,0) = (0,0.2,0)，再被 (0,0,0.1) 平移
  vectorCloseTo(translationOf(q90), [0, 0.2, 0.1], EPS, 'q0=π/2 的末端位置')
  closeTo(translationOf(q0)[2], translationOf(q90)[2], EPS, 'z 分量不变')
})

test('fkChain：改变末端关节 q[5] 不改变 tool0 的平移（Rz 无平移分量）', () => {
  for (const name of MODEL_NAMES) {
    const base = fkChain(KIN[name], [0.2, -0.3, 0.4, -0.5, 0.6, 0]).tool0
    for (const q5 of [0.5, -1.7, Math.PI, 2.9]) {
      const moved = fkChain(KIN[name], [0.2, -0.3, 0.4, -0.5, 0.6, q5]).tool0
      vectorCloseTo(translationOf(moved), translationOf(base), 1e-12, `${name} q5=${q5} 平移不变`)
    }
  }
})

/* ------------------------------------------------------------------ *
 * fkChain —— 结构 / 不变量（跑遍 assets/kinematics.json 的全部型号）
 * ------------------------------------------------------------------ */

test('fkChain 返回结构正确：links 有 6 项且每项 16 个数，tool0 === links[5] 的值', () => {
  for (const name of MODEL_NAMES) {
    const { links, tool0 } = fkChain(KIN[name], [0.1, 0.2, 0.3, 0.4, 0.5, 0.6])
    assert.equal(links.length, 6, `${name} links 数量`)
    for (const [i, m] of links.entries()) {
      assert.ok(Array.isArray(m), `${name} links[${i}] 必须是数组`)
      assert.equal(m.length, 16, `${name} links[${i}] 长度`)
    }
    assert.equal(tool0.length, 16, `${name} tool0 长度`)
    matrixCloseTo(tool0, links[5], 0, `${name} tool0 与 links[5]`)
  }
})

test('fkChain 输出全部是刚体变换（全部型号 × 两组位形）', () => {
  for (const name of MODEL_NAMES) {
    for (const q of [[0, 0, 0, 0, 0, 0], [0.4, -1.2, 2.1, -0.7, 3.0, 1.5]]) {
      const { links, tool0 } = fkChain(KIN[name], q)
      for (const [i, m] of links.entries()) assertRigid(m, `${name} q=${q} links[${i}]`)
      assertRigid(tool0, `${name} q=${q} tool0`)
    }
  }
})

test('fkChain 是纯函数：不修改输入 kin/q，重复调用结果一致', () => {
  for (const name of MODEL_NAMES) {
    const kinCopy = structuredClone(KIN[name])
    const q = [0.35, -0.75, 1.15, -1.55, 1.95, -2.35]
    const qCopy = q.slice()
    const first = fkChain(KIN[name], q)
    const second = fkChain(KIN[name], q)
    assert.deepEqual(KIN[name], kinCopy, `${name} kin 被修改`)
    assert.deepEqual(q, qCopy, `${name} q 被修改`)
    assert.deepEqual(first, second, `${name} 两次调用结果不一致`)
    // 返回值之间不得别名：tool0 与 links[5] 是各自独立的数组
    assert.notEqual(first.tool0, first.links[5], `${name} tool0 不得与 links[5] 共享同一数组`)
    assert.notEqual(first.links[0], first.links[1], `${name} links 之间不得别名`)
  }
})

test('fkChain：修改上一次的返回值不影响下一次调用（无内部状态泄漏）', () => {
  const q = [0.4, -0.8, 1.2, -1.6, 2.0, -2.4]
  const snapshot = fkChain(KIN.ur5, q)
  const expected = snapshot.tool0.slice()
  // 污染第一次返回的所有数组
  for (const m of snapshot.links) m.fill(999)
  snapshot.tool0.fill(999)
  const again = fkChain(KIN.ur5, q)
  matrixCloseTo(again.tool0, expected, 0, 'tool0 应还原为原值')
})

test('fkChain：links[j] 只依赖 q[0..j]（下三角依赖）', () => {
  const q = [0.3, -0.6, 0.9, -1.2, 1.5, -1.8]
  const base = fkChain(KIN.ur10e, q).links
  for (let i = 0; i < 6; i++) {
    const perturbed = q.slice()
    perturbed[i] += 0.7
    const links = fkChain(KIN.ur10e, perturbed).links
    for (let j = 0; j < i; j++) {
      matrixCloseTo(links[j], base[j], 0, `q[${i}] 变化不应影响 links[${j}]`)
    }
    // links[i] 自身必须随 q[i] 变化（rotZ 非恒等）
    assert.notDeepEqual(links[i], base[i], `q[${i}] 变化必须影响 links[${i}]`)
  }
})

test('fkChain：只转关节 0 时末端位置绕基座 z 轴旋转（z 与到基座距离不变）', () => {
  for (const name of MODEL_NAMES) {
    const l0 = KIN[name].links[0]
    // 该不变量的前提：links[0] 自身不含旋转（否则旋转轴不在世界 z 上）
    const link0HasNoRotation =
      Math.abs(l0.roll ?? 0) < 1e-12 &&
      Math.abs(l0.pitch ?? 0) < 1e-12 &&
      Math.abs(l0.yaw ?? 0) < 1e-12
    assert.ok(link0HasNoRotation, `${name} links[0] 预期无旋转，前提被破坏`)

    const rest = [0, 0.4, -0.9, 0.3, 1.1, -0.6]
    const a = fkChain(KIN[name], rest).tool0
    for (const q0 of [Math.PI / 2, -Math.PI / 3, 2.1, -2.8]) {
      const b = fkChain(KIN[name], [q0, ...rest.slice(1)]).tool0
      closeTo(translationOf(b)[2], translationOf(a)[2], 1e-12, `${name} q0=${q0} z 不变`)
      closeTo(norm3(translationOf(b)), norm3(translationOf(a)), 1e-12, `${name} q0=${q0} |p| 不变`)
    }
  }
})

test('fkChain：末端位置不超过数据自身推出的可达半径上界', () => {
  for (const name of MODEL_NAMES) {
    const bound = reachUpperBound(KIN[name])
    assert.ok(bound > 0, `${name} 可达上界应为正`)
    const samples = [
      [0, 0, 0, 0, 0, 0],
      [0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
      [-1.1, 1.4, -2.0, 0.8, -2.6, 2.2],
      [Math.PI, -Math.PI / 2, Math.PI / 3, 2 * Math.PI, -Math.PI, Math.PI / 4],
    ]
    for (const q of samples) {
      const p = translationOf(fkChain(KIN[name], q).tool0)
      assert.ok(
        norm3(p) <= bound + 1e-9,
        `${name} q=${q} |p|=${norm3(p)} 超过 Σ|t_i|=${bound}`,
      )
      assert.ok(norm3(p) > 1e-6, `${name} q=${q} 末端不应落在基座原点上`)
    }
  }
})

test('fkChain：q 缺省（短数组 / undefined 项）按 0 处理', () => {
  const full = fkChain(KIN.ur3, [0, 0, 0, 0, 0, 0]).tool0
  matrixCloseTo(fkChain(KIN.ur3, []).tool0, full, EPS, '空数组')
  matrixCloseTo(fkChain(KIN.ur3, [0, 0, 0]).tool0, full, EPS, '短数组')
  matrixCloseTo(fkChain(KIN.ur3).tool0, full, EPS, '未传 q')
})

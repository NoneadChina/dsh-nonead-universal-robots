// 跨工件契约测试：客户端装配用的节点名，必须与 assets/models/*.glb 里的真实节点逐一相等。
//
// 为什么需要（Task 7 遗留项 U3）：`loader.js` 用**固定名字**把 7 个网格节点挂到 6 个关节变换上
// （计划 Ruling 25）。如果资产侧改了节点名或少了节点，客户端**不会崩**，只会显示一个残缺/散架的模型 ——
// 这类静默失败最难排查。本测试把它变成测试失败。
//
// 只读 GLB 的 JSON chunk（12 字节头 + chunk 长度/类型），不解析几何，故很快。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import { Group, Object3D } from 'three'

import { LINK_MESH_NODES, ARM_LINKS, loadRobotModel } from '../src/client/robot/loader.js'
import { identity4, multiply4, fkChain } from '../src/client/robot/fk.js'

const MODELS_DIR = new URL('../assets/models/', import.meta.url)

/** 与 assets/kinematics.json 的 14 个型号一致（客户端按型号取资产）。 */
const EXPECTED_MODELS = [
  'ur3', 'ur5', 'ur10', 'ur3e', 'ur5e', 'ur7e', 'ur10e', 'ur12e', 'ur16e',
  'ur8long', 'ur15', 'ur18', 'ur20', 'ur30',
]

/** 解析 GLB 的 JSON chunk（结构测试与几何测试共用）。 */
function glbJson(buf) {
  assert.equal(buf.subarray(0, 4).toString('ascii'), 'glTF', 'GLB magic 不是 glTF')
  const jsonLen = buf.readUInt32LE(12)
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'))
}

/** 每个顶层节点的局部 AABB：直接用 POSITION accessor 的 min/max，无需解二进制。 */
function nodeBounds(doc) {
  const out = {}
  for (const node of doc.nodes ?? []) {
    if (typeof node.name !== 'string' || node.mesh === undefined) continue
    let lo = [Infinity, Infinity, Infinity]
    let hi = [-Infinity, -Infinity, -Infinity]
    for (const prim of doc.meshes[node.mesh].primitives) {
      const acc = doc.accessors[prim.attributes.POSITION]
      assert.ok(acc.min && acc.max, `${node.name} 的 POSITION accessor 缺 min/max`)
      lo = lo.map((v, i) => Math.min(v, acc.min[i]))
      hi = hi.map((v, i) => Math.max(v, acc.max[i]))
    }
    out[node.name] = [lo, hi]
  }
  return out
}

/**
 * 型号 → `{ doc, boxes }` 缓存。
 *
 * 本文件有 3 个用例要用 GLB：14 个型号合计 ~35 MB，每个用例各读一遍既慢又会把
 * 整份 Buffer 同时留在内存里（在全量并发跑规格时足以拖垮测试运行器的 IPC）。这里只解析一次。
 */
const glbCache = new Map()

async function glbFor(model) {
  const hit = glbCache.get(model)
  if (hit) return hit
  const buf = await readFile(new URL(`${model}.glb`, MODELS_DIR))
  const doc = glbJson(buf)
  const parsed = { doc, boxes: nodeBounds(doc) }
  glbCache.set(model, parsed)
  return parsed
}

/** 把局部 AABB 的 8 个角点用列主序 4x4 变换后取世界 AABB。 */
function worldAabb([lo, hi], m) {
  let wlo = [Infinity, Infinity, Infinity]
  let whi = [-Infinity, -Infinity, -Infinity]
  for (const x of [lo[0], hi[0]]) {
    for (const y of [lo[1], hi[1]]) {
      for (const z of [lo[2], hi[2]]) {
        const w = [
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        ]
        wlo = wlo.map((v, i) => Math.min(v, w[i]))
        whi = whi.map((v, i) => Math.max(v, w[i]))
      }
    }
  }
  return [wlo, whi]
}

/** 两个 AABB 的分离距离（相接/相交为 0）。 */
function aabbGap(a, b) {
  if (!a || !b) return 0
  let sum = 0
  for (let i = 0; i < 3; i++) {
    const d = Math.max(0, Math.max(a[0][i] - b[1][i], b[0][i] - a[1][i]))
    sum += d * d
  }
  return Math.sqrt(sum)
}

test('每个型号的 GLB 都存在，且节点名与顺序等于 LINK_MESH_NODES', async () => {
  const files = (await readdir(MODELS_DIR)).filter((f) => f.endsWith('.glb')).sort()
  assert.deepEqual(
    files,
    EXPECTED_MODELS.map((m) => `${m}.glb`).sort(),
    `assets/models 下的 GLB 集合与期望的 14 个型号不一致（实得 ${files.length} 个）`,
  )

  const mismatched = []
  for (const f of files) {
    const { doc } = await glbFor(f.replace(/\.glb$/, ''))
    const names = (doc.nodes ?? []).map((n) => n.name)
    if (JSON.stringify(names) !== JSON.stringify(LINK_MESH_NODES)) {
      mismatched.push({ file: f, names })
    }
  }
  assert.deepEqual(mismatched, [], '以下 GLB 的节点名/顺序与 LINK_MESH_NODES 不符（客户端会静默散架）')
})

test('ARM_LINKS 与 LINK_MESH_NODES 等长（7 段：基座 + 6 连杆）', () => {
  assert.equal(LINK_MESH_NODES.length, 7)
  assert.equal(ARM_LINKS.length, 7)
})

test('资产总量在预期量级（防止误提交空文件或被抽稀替换）', async () => {
  const files = (await readdir(MODELS_DIR)).filter((f) => f.endsWith('.glb'))
  let total = 0
  let smallest = Number.POSITIVE_INFINITY
  for (const f of files) {
    const s = await stat(new URL(f, MODELS_DIR))
    total += s.size
    smallest = Math.min(smallest, s.size)
  }
  const mb = total / 1024 / 1024
  // 体积沿革（每一步都由人明确决策，不是随手改的）：
  //   转换原始输出            35.11 MB（Ruling 24：全量原始精度、不抽稀）
  //   `compress-models.mjs`   28.27 MB（无损：索引 uint32→uint16 + 删没材质读的 `_color`）
  //   `--texture-size 1024`   20.86 MB（**有损**：5 个新型号的 2048² 底色贴图降到 1024²，
  //                                     几何与索引仍逐字节/逐值不变）
  // 下限 15 MB 给"贴图再降一档"留余量，同时仍能挡住被抽稀/截断或误提交空文件；
  // 上限 55 MB 挡住混入 collision。最小文件 >0.5 MB 这条继续挡住空/截断文件
  // （当前最小是 ur20 的 0.69 MB —— 若将来把贴图降到 512²，这条和下限要一起复核）。
  assert.ok(mb > 15 && mb < 55, `GLB 总量 ${mb.toFixed(2)} MB 超出预期区间 [15, 55]`)
  assert.ok(smallest > 0.5 * 1024 * 1024, `存在过小的 GLB（${smallest} B），疑似空文件`)
})

/* ------------------------------------------------------------------ *
 * Ruling 37：**几何装配契约** —— 相邻连杆必须相接
 *
 * 这是缺陷 D-1 的回归保护。此前 GLB 里的网格**不在连杆系**（官方 DAE 以 Z_UP 的 CAD
 * 朝向导出，长轴沿局部 +z，而运动学把下一个关节放在 −x），装配后 7 段绕各自长轴错开
 * 约 90°、肘部悬空 0.3–0.7 m，**且不报错**。所有"矩阵接线"类断言（groups[k] === links[k-1]）
 * 都与实现共享同一假设，看不见几何，所以 120 个测试全绿也没发现。
 *
 * 修法：`scripts/convert-meshes.py` 按官方 `urdf/ur_macro.xacro` 的 `<visual><origin>`
 * 把变换烘焙进网格。本测试用 GLB 的 accessor min/max（不解二进制，秒级）断言修法生效。
 * ------------------------------------------------------------------ */

test('几何装配契约：相邻连杆间隙必须小于总臂长的 5%（Ruling 37）', async () => {
  const kin = JSON.parse(await readFile(new URL('../assets/kinematics.json', import.meta.url), 'utf8'))
  const failures = []
  const report = []

  for (const model of EXPECTED_MODELS) {
    const { boxes } = await glbFor(model)

    // 与 loader.js 的 assemble() 同一张表：base 挂单位矩阵，其余 groups[k] = links[k-1]
    const segments = kin[model].links
    const { links: frames4 } = fkChain(kin[model], [0, 0, 0, 0, 0, 0])
    const frames = [identity4(), ...frames4]
    const world = LINK_MESH_NODES.map((name, k) => (boxes[name] ? worldAabb(boxes[name], frames[k]) : null))

    // 尺度无关判据：阈值取该型号总连杆长度的 5%。
    // 依据：修好视觉 origin 后残余最大 29 mm / 1.69 m ≈ 1.7%（CAD 装配间隙量级）；
    //       而 D-1 未修时上臂↔肘为 0.16–0.70 m（占总长 15%–65%）—— 两者被清晰分开。
    const reach = segments.reduce(
      (sum, s) => sum + Math.hypot(s.x ?? 0, s.y ?? 0, s.z ?? 0),
      0,
    )
    const limit = 0.05 * reach
    let worst = 0
    let worstPair = ''
    for (let k = 0; k < 6; k++) {
      const g = aabbGap(world[k], world[k + 1])
      if (g > worst) {
        worst = g
        worstPair = `${LINK_MESH_NODES[k]} → ${LINK_MESH_NODES[k + 1]}`
      }
    }
    report.push(`${model}: worst ${(worst * 1000).toFixed(1)} mm (${worstPair}), limit ${(limit * 1000).toFixed(1)} mm`)
    if (worst >= limit) {
      failures.push(`${model}: ${worstPair} 间隙 ${(worst * 1000).toFixed(1)} mm ≥ 总臂长 5%（${(limit * 1000).toFixed(1)} mm）`)
    }
  }

  assert.deepEqual(
    failures,
    [],
    `存在明显脱节的相邻连杆 —— 装配缺视觉 origin（Ruling 37）或资产被替换成连杆系之外的网格。\n实测：${report.join('\n')}`,
  )
})

test('几何装配契约：GBL 总量与运动学链长度量级一致（防张冠李戴）', async () => {
  const kin = JSON.parse(await readFile(new URL('../assets/kinematics.json', import.meta.url), 'utf8'))
  const mismatched = []
  for (const model of EXPECTED_MODELS) {
    const { boxes } = await glbFor(model)
    // 上臂网格沿「到下一个关节」方向的伸展，应与运动学给出的上臂长度同量级
    const upper = boxes.upperarm
    if (!upper) {
      mismatched.push(`${model}: 缺 upperarm 节点`)
      continue
    }
    const armLen = Math.hypot(kin[model].links[1].x ?? 0, kin[model].links[1].y ?? 0, kin[model].links[1].z ?? 0)
    const span = Math.max(...upper[1].map((v, i) => v - upper[0][i]))
    if (armLen > 1e-6 && (span < 0.5 * armLen || span > 2.5 * armLen)) {
      mismatched.push(`${model}: upperarm span ${span.toFixed(3)} m vs 运动学上臂长 ${armLen.toFixed(3)} m`)
    }
  }
  assert.deepEqual(mismatched, [], '上臂网格尺寸与运动学链明显不匹配，疑似资产/型号对错')
})

/* ------------------------------------------------------------------ *
 * 关节位置契约（真装配路径）：14 个型号 × 多个姿态
 *
 * 上一个用例自己算 `frames = [单位阵, ...links]` 再看 AABB 间隙，**绕过了 assemble()/applyFK()**。
 * 于是「绝对变换被写进嵌套的局部矩阵、matrixWorld 把父链连乘」这个缺陷它能全绿通过 ——
 * 而真机上表现为「所有关节都不在正确位置」。本用例改用**真实装配出来的 groups[k].matrixWorld**
 * 变换网格 AABB，把装配语义纳入断言。
 *
 * 判据：连杆是刚体、相邻连杆在关节处相接 ⇒ 无论关节角如何，
 * 相邻网格的 AABB 间隙都必须远小于总臂长（阈值取 5%，与上一用例同口径）。
 * ------------------------------------------------------------------ */

/** 与真实 GLB 同名的 7 个独立顶层节点（几何由 GLB 的 accessor min/max 提供，这里只要名字）。 */
function fakeNamedScene() {
  const scene = new Group()
  for (const name of LINK_MESH_NODES) {
    const node = new Object3D()
    node.name = name
    scene.add(node)
  }
  return scene
}

test('关节位置契约：14 个型号在多个姿态下，真实装配出来的相邻连杆必须相接', async () => {
  const kin = JSON.parse(await readFile(new URL('../assets/kinematics.json', import.meta.url), 'utf8'))
  const POSES = [
    { label: 'q=0（竖直）', q: [0, 0, 0, 0, 0, 0] },
    { label: 'q=伸展', q: [0.6, -1.2, 1.0, -0.5, 1.4, -0.8] },
    { label: 'q=折拢', q: [-1.6, -1.6, 1.6, -1.6, -1.6, 0] },
  ]
  const failures = []
  const report = []

  for (const model of EXPECTED_MODELS) {
    const { boxes } = await glbFor(model)
    const handle = await loadRobotModel(`geometry-${model}`, { loadGltf: async () => ({ scene: fakeNamedScene() }) })
    assert.equal(handle.usedFallback, false, `${model}: 假 GLB 不应触发回退`)

    const reach = kin[model].links.reduce((sum, s) => sum + Math.hypot(s.x ?? 0, s.y ?? 0, s.z ?? 0), 0)
    const limit = 0.05 * reach
    const worstPerPose = []

    for (const { label, q } of POSES) {
      handle.applyFK({ links: fkChain(kin[model], q).links })
      handle.root.updateMatrixWorld(true)
      const world = LINK_MESH_NODES.map((name, k) => (
        boxes[name] ? worldAabb(boxes[name], handle.groups[k].matrixWorld.elements) : null
      ))
      let worst = 0
      let worstPair = ''
      for (let k = 0; k < 6; k++) {
        const gap = aabbGap(world[k], world[k + 1])
        if (gap > worst) {
          worst = gap
          worstPair = `${LINK_MESH_NODES[k]} → ${LINK_MESH_NODES[k + 1]}`
        }
      }
      worstPerPose.push(`${label} ${(worst * 1000).toFixed(1)} mm`)
      if (worst >= limit) {
        failures.push(`${model} @ ${label}: ${worstPair} 间隙 ${(worst * 1000).toFixed(1)} mm ≥ 总臂长 5%（${(limit * 1000).toFixed(1)} mm）`)
      }
    }
    report.push(`${model}: ${worstPerPose.join(' | ')}, limit ${(limit * 1000).toFixed(1)} mm`)
    handle.dispose()
  }

  assert.deepEqual(
    failures,
    [],
    `存在关节位置错误的型号 —— 装配语义或运动学/资产不匹配。\n实测：\n${report.join('\n')}`,
  )
})

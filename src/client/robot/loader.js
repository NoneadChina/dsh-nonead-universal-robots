/**
 * src/client/robot/loader.js — 按需加载 GLB + 未知型号近似几何回退 + 装配层级 + applyFK。
 *
 * ## Ruling 25（装配规则，核心）
 * UR 是 **6 关节 / 7 连杆**：`base_link`（固定）+ `shoulder / upper_arm / forearm / wrist_1 / wrist_2 / wrist_3`。
 * `fkChain(kin, q)`（`fk.js`）返回的 `links` 长度 6，是**每个关节转动后**的位姿；`tool0` 由第 6 关节之后再叠加。
 * `assets/models/<m>.glb` 里是 **7 个彼此独立的顶层节点**（无层级），名字固定为
 * `base, shoulder, upperarm, forearm, wrist1, wrist2, wrist3`（与 `scripts/convert-meshes.py` 的
 * `NODE_NAMES` 一致）。⇒ 客户端必须**自己搭层级**，映射固定为：
 *
 * | GLB 节点   | 挂到哪个变换          |
 * |------------|----------------------|
 * | `base`     | 单位矩阵（基座固定）  |
 * | `shoulder` | `links[0]`           |
 * | `upperarm` | `links[1]`           |
 * | `forearm`  | `links[2]`           |
 * | `wrist1`   | `links[3]`           |
 * | `wrist2`   | `links[4]`           |
 * | `wrist3`   | `links[5]`           |
 *
 * 装配结果是 7 个 `Group`（`matrixAutoUpdate = false`）：`groups[0]` 是运动根（base，恒单位矩阵），
 * `groups[1..6]` 都是它的**直接子节点**，各自接收绝对变换 `links[k-1]`。
 * **不是**父子链：`applyFK` 写的是基座绝对变换，串成父链会让 `matrixWorld` 把前人变换重复施加
 * （除肩部外每个连杆都错位），因为每个网格的几何写在**它自己的连杆坐标系**里。
 * **回退几何体（未知型号）走同一张表**，否则回退臂会塌成一坨堆在原点。
 *
 * ## 依赖纪律
 * 本模块进浏览器 bundle（esbuild），**只能 import 零依赖共享模块**：
 * `lib/twin-paths.js`（纯常量）。**不要** import `lib/twin-routes.js`（它要 `node:fs`）。
 *
 * ## 可测性
 * `loadRobotModel(modelId, deps)` 的 `deps.loadGltf` 是**可选注入点**（缺省走真实
 * `new GLTFLoader().loadAsync(url)`），单测注入假实现即可在 Node 下覆盖装配/回退/缓存，
 * 且**默认对外行为完全不变**。
 */

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Group, Mesh, CapsuleGeometry, MeshStandardMaterial } from 'three'
import { TWIN_ASSET_PATH } from '../../../lib/twin-paths.js'
import { TWIN_3D_PALETTES } from '../theme.js'

/** GLB 内 7 个网格节点的名字（与 scripts/convert-meshes.py 的 NODE_NAMES 一致）。 */
export const LINK_MESH_NODES = ['base', 'shoulder', 'upperarm', 'forearm', 'wrist1', 'wrist2', 'wrist3']

/** 近似臂的默认连杆长度（米），按 UR3 量级取，仅用于未知型号回退。长度与 LINK_MESH_NODES 对齐。 */
export const ARM_LINKS = [0.15, 0.12, 0.24, 0.21, 0.085, 0.092, 0.092]

/** 已装配句柄的进程内缓存：key = 小写型号 id。 */
const cache = new Map()

/**
 * 缺省加载器：走 host 资产路由取 GLB（[Ruling 7] 插件静态路径只服务 client.js，GLB 必须走路由）。
 *
 * 复用**同一个** `GLTFLoader` 实例：它内部持有解析器注册表与纹理缓存，每次新建都等于把
 * 那些状态丢掉重来。命中模型缓存时根本不会走到这里，所以这条只影响"换型号"的路径。
 */
let sharedGltfLoader = null

async function defaultLoadGltf(url) {
  sharedGltfLoader ??= new GLTFLoader()
  return await sharedGltfLoader.loadAsync(url)
}

/**
 * 把 root 下名为 LINK_MESH_NODES 的 7 个对象，按 Ruling 25 的表挂到 7 个装配组上。
 * 返回 7 个装配组（`[0]` = base 运动根，`[1..6]` = 依次对应 `links[0..5]`）。
 *
 * - 找不到某个名字时**不抛错**：跳过并留下空组（保持数组长度恒为 7，applyFK 才不会错位）。
 * - `groups[0]` 会被挂回 `root`，使调用方直接 `scene.add(handle.root)` 即可看到模型
 *   （见报告「偏差与理由」D1）。
 */
function assemble(root) {
  const groups = []
  for (let i = 0; i < 7; i++) {
    const g = new Group()
    g.name = `assemble_${LINK_MESH_NODES[i]}`
    g.matrixAutoUpdate = false // 由 applyFK 直接写 matrix
    groups.push(g)
  }
  // 6 个连杆组都是运动根（`groups[0]` = base，单位矩阵）的**直接子节点**，各自接收
  // 「基座 → 该连杆」的**绝对**变换 `links[k-1]`。
  //
  // **不要**把它们串成父子链：`applyFK` 写进 `group.matrix` 的是绝对变换，而 three.js 的
  // `matrixWorld` 会把父链相乘 ⇒ 串起来等于把前人变换重复施加一次（肩部之后每个连杆都错位）。
  // 之所以必须用绝对变换，是因为每个网格的几何都写在**它自己的连杆坐标系**里
  // （Ruling 37 已把官方 `ur_macro.xacro` 的 `<visual><origin>` 烘进网格）。
  for (let i = 1; i < 7; i++) groups[0].add(groups[i])

  for (let i = 0; i < 7; i++) {
    const found = root?.getObjectByName?.(LINK_MESH_NODES[i])
    if (found) groups[i].add(found) // add() 会自动把 found 从原父节点摘下
  }

  root?.add?.(groups[0])
  return groups
}

/**
 * 把任意输入规整成 7 个**正的有限**长度；不合法的位置回退 `ARM_LINKS` 的同位值。
 *
 * 回退臂是最后一道防线：它绝不能因为型号数据里的一个 `null` 就长出 NaN 几何体 ——
 * NaN 顶点会让整棵子树从场景里消失，那比"尺寸不太准"严重得多。
 *
 * @param {unknown} armLinks 候选长度数组
 * @returns {number[]} 恰好 7 个长度（米）
 */
export function normalizeArmLinks(armLinks) {
  const out = []
  for (let i = 0; i < 7; i++) {
    const value = Array.isArray(armLinks) ? armLinks[i] : undefined
    out.push(Number.isFinite(value) && value > 0 ? value : ARM_LINKS[i])
  }
  return out
}

/**
 * 从容器的两种形状里取出平移分量 `[x, y, z]`。
 *
 * - **位移格式**（`assets/kinematics.json` 的真实形状，与 `fk.js` 同源）：`{x, y, z, …}`；
 * - **旧矩阵格式**（现在只出现在单测的假数据里）：4×4 **行主序** `number[16]`，平移在 3/7/11。
 *
 * 形状不对、或分量不是有限数时返回 `null` —— 调用方据此放弃，**绝不猜**。
 *
 * @param {unknown} entry
 * @returns {[number, number, number]|null}
 */
function translationOf(entry) {
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    const { x = 0, y = 0, z = 0 } = entry
    return [x, y, z].every(Number.isFinite) ? [x, y, z] : null
  }
  if (Array.isArray(entry) && entry.length >= 12) {
    const [x, y, z] = [entry[3], entry[7], entry[11]]
    return [x, y, z].every(Number.isFinite) ? [x, y, z] : null
  }
  return null
}

/** 两点间的欧氏距离（米）。 */
function distanceBetween(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
}

/**
 * 从 `kinematics.json` 的 `links` 算出 7 段连杆长度（米）。
 *
 * 数据有**两种形状**，本函数都吃：
 *
 * 1. **位移格式（真实数据）**：`[6 × {x,y,z,roll,pitch,yaw}]`（见 `fk.js` 的文件头）。每一项是
 *    "相对上一个坐标系"的**固定位移**（在关节旋转之前施加），所以该链段的长度就是位移向量的
 *    模长 `hypot(x,y,z)`。⛔ 不要按"相邻原点距离"去读它：那需要累积变换，而这里是相对量。
 *    全表的可达上界口径与此一致（`test/model-contract.test.mjs` 用的也是这个和）。
 * 2. **旧矩阵格式**：`[7 × 4×4 行主序 number[16]]`，平移在索引 3/7/11，相邻两个原点的欧氏
 *    距离即段长。
 *
 * 两种形状都返回**恰好 7 个**长度（`LINK_MESH_NODES` 是 7 个：base + 6 连杆）：第 7 段（末端）
 * 没有下一个原点可比，用第 6 段近似（保持历史行为）。
 *
 * ⚠️ **0.6.9 修掉的 bug**：此前的实现只认第 2 种形状、且要求 `links.length >= 7`，而真实数据是
 * 第 1 种形状、只有 6 项 ⇒ 对**任何**内置型号都返回 `null`：可达范围包络球因此永远停在单位半径
 * （1 m，与型号无关 —— "换哪台机器人都一样大"），未知型号的回退臂也永远退化成 UR3 量级。
 * 它对旧单测是绿的，因为那边喂的是自造的矩阵假数据；**接真实数据**的断言已随本次修复补进
 * `test/fallback-arm.test.mjs` 与 `test/overlays.test.mjs`。
 *
 * @param {Array<{x?: number, y?: number, z?: number}|number[]>} links 型号的关节变换表
 * @returns {number[]|null} 7 个长度；数据不足或形状不对时 `null`（调用方据此保持缺省）
 */
export function linkLengthsFromKinematics(links) {
  if (!Array.isArray(links) || links.length === 0) return null
  const points = []
  for (const entry of links) {
    const point = translationOf(entry)
    if (point === null) return null
    points.push(point)
  }
  const displacementForm = links.every(
    (entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry),
  )
  let lengths
  if (displacementForm) {
    // 位移格式：每项就是一个链段的固定位移，段长 = 模长。
    if (points.length < 6) return null
    lengths = points.map(([x, y, z]) => Math.hypot(x, y, z))
  } else {
    // 旧矩阵格式：要有 7 个原点才谈得上 6 段 + 末端近似。
    if (points.length < 7) return null
    lengths = []
    for (let i = 0; i < 6; i++) lengths.push(distanceBetween(points[i], points[i + 1]))
  }
  if (lengths.length === 0 || lengths.some((value) => !Number.isFinite(value))) return null
  while (lengths.length < 7) lengths.push(lengths[lengths.length - 1])
  return lengths.slice(0, 7)
}

/**
 * 未知型号的近似臂：7 段胶囊，名字与 LINK_MESH_NODES 一致。
 * 返回的是**未装配**的 root（7 段都在 root 下）；`loadRobotModel` 会用同一张表装配它，
 * 所以不要直接把返回值丢进场景。
 *
 * @param {number[]} [armLinks=ARM_LINKS] 7 段连杆长度（米）。
 *        内置型号的真实长度可由 `linkLengthsFromKinematics(kin.links)` 算出并传进来，
 *        这样回退臂的尺寸才与该型号相符；缺省仍是 UR3 量级的 `ARM_LINKS`。
 * @param {number} [color=TWIN_3D_PALETTES.dark.fallbackArm] 材质色（来自主题色板：
 *        浅色主题下原来的灰蓝在浅底上几乎看不清，见 `theme.js`）。
 */
export function buildFallbackArm(armLinks = ARM_LINKS, color = TWIN_3D_PALETTES.dark.fallbackArm) {
  const links = normalizeArmLinks(armLinks)
  const root = new Group()
  root.name = 'fallback_arm'
  const mat = new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 })
  for (let i = 0; i < 7; i++) {
    // 胶囊半径随连杆粗细、长度随连杆长度缩放；沿自身局部 +z 平移半段，让关节落在连杆一端。
    const len = Math.max(0.04, links[i] * 0.8)
    const m = new Mesh(new CapsuleGeometry(Math.max(0.03, links[i] * 0.18), len), mat)
    m.name = LINK_MESH_NODES[i]
    m.position.z = links[i] * 0.5
    root.add(m)
  }
  return root
}

/**
 * 按型号按需加载并装配模型。加载失败（未内置 / 404 / 结果非法）时回退近似几何体，**不抛错**。
 *
 * @param {string} modelId 型号 id（内部小写化）
 * @param {{ loadGltf?: (url: string) => Promise<{scene: import('three').Object3D}>,
 *           armLinks?: number[] }} [deps]
 *        可选注入点，仅测试与调用方传型号数据时使用；缺省走真实 `GLTFLoader` 与 UR3 量级的
 *        回退臂长度。`armLinks` 由 `linkLengthsFromKinematics(kin.links)` 得到。
 * @returns {Promise<{root: import('three').Object3D, groups: import('three').Group[],
 *                    usedFallback: boolean, applyFK: (result: {links?: number[][]}) => void,
 *                    dispose: () => void}>}
 */
export async function loadRobotModel(modelId, deps = {}) {
  const id = String(modelId ?? '').toLowerCase()
  const cached = cache.get(id)
  if (cached) {
    cached.refs += 1
    return makeHandle(cached)
  }

  const loadGltf = typeof deps.loadGltf === 'function' ? deps.loadGltf : defaultLoadGltf
  let root
  let usedFallback = false
  try {
    const gltf = await loadGltf(`${TWIN_ASSET_PATH}?model=${encodeURIComponent(id)}`)
    const scene = gltf?.scene
    if (!scene || typeof scene.traverse !== 'function') throw new Error('GLB 结果缺少 scene')
    root = scene
  } catch {
    // 未内置/加载失败 → 回退，不抛错。带上该型号的真实连杆长度，让回退臂的尺寸相符。
    root = buildFallbackArm(deps.armLinks, deps.fallbackColor)
    usedFallback = true
  }

  const groups = assemble(root)

  /** @type {{id: string, refs: number, root: object, groups: object[], usedFallback: boolean, applyFK: Function}} */
  const entry = {
    id,
    refs: 1, // 本次调用自己持有的那一份
    root,
    groups,
    usedFallback,
    /**
     * 用 `fkChain(kin, q)` 的结果摆正姿态：`groups[0]` 恒为单位矩阵（基座固定），
     * `groups[k]`（k≥1）取 `links[k-1]`（**绝对**变换，`groups[k].matrixWorld` 因此等于它）。
     * `links` 缺失/非法时静默保持上一姿态。
     */
    applyFK(result) {
      applyLinksToGroups(groups, result)
    },
  }

  cache.set(id, entry)
  return makeHandle(entry)
}

/**
 * 引用计数（Ruling 36）：**每次 `loadRobotModel` 调用返回一个独立的释放句柄**，
 * 句柄内部的 `released` 闭包保证 `dispose()` 幂等且只扣减本次取得的那一份。
 *
 * 为什么必须这样做：模型句柄按型号进程内缓存，侧边栏缩略图与中栏大视图会拿到
 * **同一份** geometry/material。若任一方 `dispose()` 就直接释放资源，另一方会立刻变黑/报错。
 * 句柄本身是共享对象，所以**不能在共享对象上打 `released` 标记**——那会让第一个释放者
 * 屏蔽掉其他释放者；必须让每个调用方持有自己的那一份。
 *
 * 只有引用归零才真正释放 GPU 资源并清缓存。
 */
/**
 * 用 `fkChain(kin, q)` 的结果摆正一套装配组的姿态。
 *
 * 语义（真臂与幽灵臂**必须完全一致**，所以抽成一份）：
 * - `groups[0]` 恒为单位矩阵（基座固定）；
 * - `groups[k]`（k≥1）取 `links[k-1]`，是**绝对**变换 —— 所以 `groups[k].matrixWorld` 直接
 *   等于它。**不要**把这些组串成父子链：绝对变换经父链相乘会被重复施加。
 * - `links` 缺失/非法时静默保持上一姿态，绝不抛错（一帧坏数据不该让画面卡死）。
 *
 * @param {Array<import('three').Object3D|null>} groups 7 个装配组
 * @param {{links?: number[][]}} result `fkChain` 的返回值
 */
export function applyLinksToGroups(groups, result) {
  const links = result?.links
  if (!Array.isArray(links) || !Array.isArray(groups)) return
  if (groups[0]) {
    groups[0].matrix.identity()
    groups[0].matrixWorldNeedsUpdate = true
  }
  for (let k = 1; k < 7; k++) {
    const m = links[k - 1]
    if (groups[k] && Array.isArray(m)) {
      groups[k].matrix.fromArray(m)
      groups[k].matrixWorldNeedsUpdate = true
    }
  }
}

function makeHandle(entry) {
  let released = false
  return {
    root: entry.root,
    groups: entry.groups,
    usedFallback: entry.usedFallback,
    applyFK: entry.applyFK,
    /** 释放本次调用持有的引用；**幂等**（重复调用不再扣减）。 */
    dispose() {
      if (released) return
      released = true
      entry.refs -= 1
      if (entry.refs > 0) return
      disposeObject3D(entry.root)
      // 缓存里若正是本条目则清掉，避免把已释放的模型再次发出去。
      if (cache.get(entry.id) === entry) cache.delete(entry.id)
    },
  }
}

/** 递归释放 GPU 资源（几何体 + 材质及其贴图），再从父节点摘下。 */
export function disposeObject3D(obj) {
  obj?.traverse?.((n) => {
    n.geometry?.dispose?.()
    const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : []
    for (const m of mats) {
      for (const k of Object.keys(m)) m[k]?.dispose?.()
      m.dispose?.()
    }
  })
  obj?.parent?.remove?.(obj)
}

/**
 * test/scene-alignment.test.mjs — 「世界坐标系 = UR 基座坐标系」的几何契约。
 *
 * ## 为什么需要
 * 机器人各连杆姿态是 FK 直接算出的**基座系**坐标（基座 X 前、Y 左、Z 上），`applyFK()` 原样写进
 * 装配组。于是场景侧必须让世界坐标系与基座系重合：**网格平面 = 基座平面（XY 面，z=0）**、
 * **相机 up = +Z**。three.js 的 `GridHelper` 默认躺在 XZ 面（法线 +Y），直接 add 进场景就会得到
 * 「网格是竖墙、基座从网格里穿出来」的画面 —— 平面上与三条轴上都对不齐。
 *
 * `WebGLRenderer` 在 Node 下构造不了（`createScene()` 仍不做单测），但 `GridHelper` 是纯几何，
 * 所以朝向这一条契约可以真跑：由 `createBaseGrid()` 覆盖。
 *
 * 运行：node --test test/scene-alignment.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Vector3 } from 'three'

import { createBaseGrid } from '../src/client/robot/scene.js'

const sceneSource = readFileSync(
  fileURLToPath(new URL('../src/client/robot/scene.js', import.meta.url)), 'utf8',
).replace(/\r\n/g, '\n')

const EPS = 1e-9

test('网格平面与基座平面重合：法线为 +Z，且平面过 z=0', () => {
  const grid = createBaseGrid()
  grid.updateMatrixWorld(true)

  // GridHelper 的几何躺在自身 XZ 面（法线 +Y）；装配后法线必须指向世界 +Z。
  const normal = new Vector3(0, 1, 0).applyQuaternion(grid.quaternion)
  assert.ok(Math.abs(normal.x) < EPS && Math.abs(normal.y) < EPS, `网格法线应只剩 z 分量：${normal.toArray()}`)
  assert.ok(Math.abs(normal.z - 1) < EPS, `网格法线应为 +Z：${normal.toArray()}`)

  // 平面过原点 ⇒ 与基座平面（z=0）重合，而不是平行错开。
  assert.deepEqual(grid.position.toArray(), [0, 0, 0], '网格必须位于世界原点')
})

test('网格的两条线方向落在世界 X / Y 上（与基座 X/Y 重合）', () => {
  const grid = createBaseGrid()
  grid.updateMatrixWorld(true)

  // 几何自身的两条线方向：局部 +X 与局部 +Z（GridHelper 在 XZ 面画线）。
  const alongLocalX = new Vector3(1, 0, 0).applyQuaternion(grid.quaternion)
  const alongLocalZ = new Vector3(0, 0, 1).applyQuaternion(grid.quaternion)
  for (const [name, dir] of [['局部 +X', alongLocalX], ['局部 +Z', alongLocalZ]]) {
    assert.ok(Math.abs(dir.z) < EPS, `${name} 必须落在 XY 面内（z 分量应为 0）：${dir.toArray()}`)
  }
  // 两条方向都无 z 分量、且互相垂直 ⇒ 它们张成世界 XY 面。
  assert.ok(Math.abs(alongLocalX.dot(alongLocalZ)) < EPS, '两条线方向应互相垂直')
})

test('网格默认尺寸/分格仍是 2 m × 20 格（0.1 m 一格）', () => {
  const grid = createBaseGrid()
  grid.geometry.computeBoundingBox()
  const box = grid.geometry.boundingBox
  assert.ok(Math.abs(box.min.x + 1) < 1e-6 && Math.abs(box.max.x - 1) < 1e-6, '网格应为 2 m 见方')
  // 每条方向 divisions+1 条线、每线 2 个顶点 ⇒ position.count = (divisions + 1) * 4。
  assert.equal(grid.geometry.attributes.position.count / 4 - 1, 20, '分格数应为 20')
})

test('契约：相机 up 为 +Z，且网格只经 createBaseGrid 创建', () => {
  assert.match(sceneSource, /camera\.up\.set\(0,\s*0,\s*1\)/,
    '相机 up 必须设为 +Z（否则 OrbitControls 把 Z 当侧向，整个视角歪掉）')
  const gridCreations = sceneSource.match(/new GridHelper\(/g) ?? []
  assert.equal(gridCreations.length, 1, 'GridHelper 只应在 createBaseGrid() 里创建一次')
  // 网格必须是 `createBaseGrid()` 的产物（保留引用是为了能在 dispose 里释放它的
  // geometry/material —— 以前它每挂载一次就泄漏一组，见 0.5.0 的渲染资源修复）。
  assert.match(sceneSource, /const grid = createBaseGrid\(\)/, '网格必须来自 createBaseGrid()')
  assert.match(sceneSource, /scene\.add\(grid\)/, '场景必须加入该网格')
})

test('契约：dispose 必须释放 WebGL 上下文与网格资源（否则每次展开都泄漏一个上下文）', () => {
  // three 的 `renderer.dispose()` **不释放上下文**（只丢缓存并摘掉自己的 context-lost 监听）；
  // 不调 `forceContextLoss()` 时，反复展开/收起面板会攒满浏览器的上下文上限（约 16 个），
  // 之后最老的上下文被回收 —— 表现是孪生面板或其它 WebGL 视图变黑。
  assert.match(sceneSource, /renderer\.forceContextLoss\?\.\(\)/,
    'dispose 必须调用 forceContextLoss()')
  assert.match(sceneSource, /grid\.geometry\?\.dispose\?\.\(\)/, '网格 geometry 必须释放')
  assert.match(sceneSource, /grid\.material\?\.dispose\?\.\(\)/, '网格 material 必须释放')
  assert.match(sceneSource, /renderer\.setPixelRatio\(/,
    '必须按 devicePixelRatio 设置渲染像素比，否则 HiDPI 屏上画面发虚')
})

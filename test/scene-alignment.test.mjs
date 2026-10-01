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

import { createBaseGrid, fitDistanceFor, gridExtentFor, VIEW_PRESETS } from '../src/client/robot/scene.js'

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
  // geometry/material —— 以前它每挂载一次就泄漏一组，见 0.5.0 的渲染资源修复；
  // 0.6.3 起引用还要可变，因为换机型时按包围盒重建网格）。
  assert.match(sceneSource, /grid = createBaseGrid\(/, '网格必须来自 createBaseGrid()')
  assert.match(sceneSource, /scene\.add\(grid\)/, '场景必须加入该网格')
})

test('契约：dispose 必须释放 WebGL 上下文与网格资源（否则每次展开都泄漏一个上下文）', () => {
  // three 的 `renderer.dispose()` **不释放上下文**（只丢缓存并摘掉自己的 context-lost 监听）；
  // 不调 `forceContextLoss()` 时，反复展开/收起面板会攒满浏览器的上下文上限（约 16 个），
  // 之后最老的上下文被回收 —— 表现是孪生面板或其它 WebGL 视图变黑。
  assert.match(sceneSource, /renderer\.forceContextLoss\?\.\(\)/,
    'dispose 必须调用 forceContextLoss()')
  assert.match(sceneSource, /grid\?\.geometry\?\.dispose\?\.\(\)/, '网格 geometry 必须释放')
  assert.match(sceneSource, /grid\?\.material\?\.dispose\?\.\(\)/, '网格 material 必须释放')
  assert.match(sceneSource, /renderer\.setPixelRatio\(/,
    '必须按 devicePixelRatio 设置渲染像素比，否则 HiDPI 屏上画面发虚')
})

/* ------------------------------------------------------------------ *
 * 0.6.3：取景/网格尺度必须由包围盒推导，而不是按某台臂写死
 * ------------------------------------------------------------------ */

test('fitDistanceFor：包围球越大距离越远，且随留边系数线性放大', () => {
  const a = fitDistanceFor(0.5, 45, 1)
  const b = fitDistanceFor(1.0, 45, 1)
  assert.ok(b > a, '半径翻倍，距离必须变远')
  assert.ok(Math.abs(b / a - 2) < 1e-9, '同视场下距离与半径成正比')
  assert.ok(Math.abs(fitDistanceFor(0.5, 45, 1, 2) / fitDistanceFor(0.5, 45, 1, 1) - 2) < 1e-9,
    '留边系数线性放大距离')
})

test('fitDistanceFor：竖长视口要退得更远（水平方向才是瓶颈）', () => {
  const square = fitDistanceFor(1, 45, 1)
  const tall = fitDistanceFor(1, 45, 0.4)
  const wide = fitDistanceFor(1, 45, 3)
  assert.ok(tall > square, `窄高视口必须退得更远：tall=${tall} square=${square}`)
  // 宽视口水平视场更大 ⇒ 垂直仍是瓶颈 ⇒ 距离与正方视口一致。
  assert.ok(Math.abs(wide - square) < 1e-9, '宽视口由垂直视场决定，距离应与正方一致')
})

test('fitDistanceFor：非法输入退回安全默认值，不产生 NaN/Infinity', () => {
  for (const bad of [0, -1, NaN, Infinity, undefined]) {
    const d = fitDistanceFor(bad, 45, 1)
    assert.ok(Number.isFinite(d) && d > 0, `radius=${String(bad)} 必须得到有限正距离，实际 ${d}`)
  }
  for (const bad of [0, -5, NaN, 180, 200]) {
    assert.ok(Number.isFinite(fitDistanceFor(1, bad, 1)), `fov=${String(bad)} 必须回退到默认视场`)
  }
  assert.ok(Number.isFinite(fitDistanceFor(1, 45, 0)), 'aspect=0 不得产生 Infinity')
})

test('gridExtentFor：尺寸随半径增长、是 0.5 m 的倍数，分格数被钳在 [8,40]', () => {
  const small = gridExtentFor(0.2)
  const large = gridExtentFor(2.4)
  assert.ok(large.size > small.size, '大臂需要更大的网格')
  assert.ok(small.size >= 0.5, '再小的臂也要有可见网格')
  for (const r of [0.05, 0.4, 1, 2.4, 10]) {
    const { size, divisions } = gridExtentFor(r)
    assert.ok(Math.abs(size * 2 - Math.round(size * 2)) < 1e-9, `size 必须是 0.5 的倍数：${size}`)
    assert.ok(divisions >= 8 && divisions <= 40, `divisions 越界：${divisions}`)
    assert.ok(Number.isInteger(divisions), 'divisions 必须是整数')
  }
  // 非法半径不得抛错，也不得产生 NaN。
  const fallback = gridExtentFor(NaN)
  assert.ok(Number.isFinite(fallback.size) && Number.isFinite(fallback.divisions))
})

test('VIEW_PRESETS：四个预设齐全，且俯视不与管理 up 的 +Z 平行（否则方位角退化）', () => {
  for (const key of ['iso', 'front', 'side', 'top']) {
    const preset = VIEW_PRESETS[key]
    assert.ok(preset, `缺少预设 ${key}`)
    assert.equal(preset.direction.length, 3, `${key} 的方向必须是三维`)
    assert.ok(preset.direction.some((v) => v !== 0), `${key} 的方向不得是零向量`)
  }
  const top = new Vector3(...VIEW_PRESETS.top.direction).normalize()
  const up = new Vector3(0, 0, 1)
  assert.ok(Math.abs(top.dot(up)) < 1 - 1e-4,
    '俯视方向不得与 camera.up（+Z）平行 —— 叉积退化会让 OrbitControls 抖动或翻转')
})

test('契约：createScene 暴露 fitTo/setViewPreset/onCameraChange，并按包围盒取景', () => {
  for (const method of ['fitTo', 'setViewPreset', 'onCameraChange']) {
    assert.match(sceneSource, new RegExp(`\\b${method}\\b`), `createScene 必须提供 ${method}()`)
  }
  assert.match(sceneSource, /new Box3\(\)\.setFromObject\(/, '取景必须由模型包围盒推导')
  assert.match(sceneSource, /controls\.minDistance = radius \*/, 'minDistance 必须随机型缩放')
  assert.match(sceneSource, /controls\.maxDistance = radius \*/, 'maxDistance 必须随机型缩放')
  assert.match(sceneSource, /replaceGrid\(radius\)/, '网格尺度必须跟着取景半径重算')
  // 换机型重建网格时必须释放旧网格，否则每次切型号都漏一组 geometry/material。
  assert.match(sceneSource, /function replaceGrid\(/, '换网格必须走 replaceGrid()')
})

test('契约：必须开 tone mapping 与环境贴图（UR 的 GLB 是 PBR 金属），且 dispose 释放它们', () => {
  // 只有平行光 + 环境光时，PBR 金属没有可反射的环境，会渲染成发灰发平的塑料。
  assert.match(sceneSource, /renderer\.toneMapping = ACESFilmicToneMapping/, '必须开 ACES tone mapping')
  assert.match(sceneSource, /new PMREMGenerator\(/, '必须用 PMREMGenerator 生成环境贴图')
  assert.match(sceneSource, /RoomEnvironment/, '环境贴图必须来自程序化的 RoomEnvironment（不依赖外部 HDR 资源）')
  assert.match(sceneSource, /scene\.environment = /, '环境贴图必须挂到 scene.environment')
  // 两者各自持有 GPU 资源：不释放就是每次展开/收起面板漏一份。
  assert.match(sceneSource, /environment\?\.dispose\?\.\(\)/, 'dispose 必须释放环境贴图')
  assert.match(sceneSource, /pmrem\?\.dispose\?\.\(\)/, 'dispose 必须释放 PMREMGenerator')
  // 缺扩展的环境必须能降级建场景，而不是抛出去让面板空白。
  assert.match(sceneSource, /environment = null/, '取环境贴图失败时必须回退为 null 而不是中断建场景')
})

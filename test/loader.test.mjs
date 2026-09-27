/**
 * test/loader.test.mjs — Task 7：模型加载 / Ruling 25 装配层级 / applyFK / 回退 / 释放 的单测。
 *
 * 为什么能测：three 的 `Group / Mesh / CapsuleGeometry / Matrix4 / Object3D` 在 Node 下可用，
 * 且 `loadRobotModel` 提供 `deps.loadGltf` 注入点 ⇒ **不发任何网络请求**即可覆盖加载路径。
 * `scene.js`（WebGLRenderer）在 Node 下无法构造，故不在此文件覆盖（缺口已在 scene.js 内标注）。
 *
 * 断言纪律：不猜浮点常量。输入的"假 links"是**选定值**（绕 z 转 90° / 纯平移），
 * 期望的世界矩阵用 `fk.js` 的独立参考实现 `multiply4` 现算，而不是硬编码数字。
 *
 * 运行：node --test test/loader.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Group, Mesh, Object3D, Matrix4 } from 'three'

import {
  LINK_MESH_NODES,
  ARM_LINKS,
  buildFallbackArm,
  loadRobotModel,
  disposeObject3D,
} from '../src/client/robot/loader.js'
import { TWIN_ASSET_PATH } from '../lib/twin-paths.js'
import { multiply4, identity4 } from '../src/client/robot/fk.js'

const EPS = 1e-9

/* ------------------------------------------------------------------ *
 * 辅助
 * ------------------------------------------------------------------ */

/** 造一个"假 GLB"：无层级的顶层节点，名字取自 names。 */
function fakeGltfScene(names = LINK_MESH_NODES) {
  const scene = new Group()
  scene.name = 'fake_gltf_scene'
  for (const n of names) {
    const o = new Object3D()
    o.name = n
    scene.add(o)
  }
  return scene
}

/** 注入用的假加载器：记录调用 URL，返回给定 scene（或缺省 7 节点 scene）。 */
function fakeLoader(scene = fakeGltfScene()) {
  const calls = []
  const fn = async (url) => {
    calls.push(url)
    return { scene }
  }
  fn.calls = calls
  return fn
}

function elementsCloseTo(actual, expected, label, eps = EPS) {
  assert.equal(actual.length, 16, `${label} 长度必须是 16`)
  for (let i = 0; i < 16; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= eps,
      `${label}[${i}] 实际 ${actual[i]} ≠ 期望 ${expected[i]}`,
    )
  }
}

const meshNamesUnder = (root) => {
  const out = []
  root.traverse((n) => {
    if (n.isMesh) out.push(n.name)
  })
  return out
}

/* ------------------------------------------------------------------ *
 * 用例 1：回退臂 —— 恰好 7 个 Mesh，名字等于 LINK_MESH_NODES
 * ------------------------------------------------------------------ */

test('buildFallbackArm：7 段命名胶囊，名字与顺序等于 LINK_MESH_NODES', () => {
  assert.equal(LINK_MESH_NODES.length, 7, 'LINK_MESH_NODES 必须是 7 个')
  assert.equal(ARM_LINKS.length, 7, 'ARM_LINKS 必须与 LINK_MESH_NODES 对齐（7 段）')

  const root = buildFallbackArm()
  const meshes = []
  root.traverse((n) => {
    if (n.isMesh) meshes.push(n)
  })

  assert.equal(meshes.length, 7, `回退臂必须恰好 7 个 Mesh，实得 ${meshes.length}`)
  assert.deepEqual(meshes.map((m) => m.name), LINK_MESH_NODES, '名字与顺序必须等于 LINK_MESH_NODES')
  for (const m of meshes) {
    assert.ok(m.isMesh === true && m.geometry?.type === 'CapsuleGeometry', `${m.name} 必须是胶囊 Mesh`)
  }
})

/* ------------------------------------------------------------------ *
 * 用例 2：装配层级 —— 7 组层层嵌套，GLB 同名节点被 reparent 进对应组
 * ------------------------------------------------------------------ */

test('loadRobotModel：7 个装配组扁平挂在运动根下，GLB 顶层节点被 reparent 进对应组', async () => {
  const scene = fakeGltfScene()
  const originals = new Map(scene.children.map((o) => [o.name, o]))
  const handle = await loadRobotModel('unit-nesting', { loadGltf: fakeLoader(scene) })

  assert.equal(handle.usedFallback, false, 'GLB 加载成功时不应回退')
  assert.equal(handle.root, scene, 'root 必须是 gltf.scene 本身')
  assert.equal(handle.groups.length, 7, 'groups 长度恒为 7')

  // (a) 扁平装配：[0] 是运动根，[1..6] 都是它的**直接子节点**（不能串成父链，否则绝对变换会连乘）
  for (let i = 0; i < 7; i++) {
    const g = handle.groups[i]
    assert.equal(g.matrixAutoUpdate, false, `groups[${i}] 必须 matrixAutoUpdate=false`)
    assert.equal(g.name, `assemble_${LINK_MESH_NODES[i]}`, `groups[${i}] 名字`)
    if (i > 0) {
      assert.equal(g.parent, handle.groups[0], `groups[${i}].parent 必须是运动根 groups[0]`)
    }
  }
  const linkGroupChildren = handle.groups[0].children.filter((c) => handle.groups.includes(c))
  assert.equal(linkGroupChildren.length, 6, 'groups[0] 应直接包含 6 个连杆组')
  assert.deepEqual(linkGroupChildren, handle.groups.slice(1), '连杆组顺序必须是 groups[1..6]')
  assert.equal(handle.groups[0].parent, handle.root, 'groups[0] 必须挂在 root 下（可直接入场景）')
  assert.equal(scene.children.length, 1, 'root 下只剩运动根（7 个原顶层节点已被摘走）')
  assert.equal(scene.children[0], handle.groups[0])

  // (b) 同名对象被 reparent 进**对应**的组，且就是原对象（不是副本）
  for (let i = 0; i < 7; i++) {
    const found = handle.root.getObjectByName(LINK_MESH_NODES[i])
    assert.equal(found, originals.get(LINK_MESH_NODES[i]), `${LINK_MESH_NODES[i]} 必须是原对象`)
    assert.equal(found.parent, handle.groups[i], `${LINK_MESH_NODES[i]} 必须挂在 groups[${i}] 下`)
  }

  handle.dispose()
})

/* ------------------------------------------------------------------ *
 * 用例 3：applyFK 正确性 —— groups[0] 恒为单位矩阵，groups[k] = links[k-1]
 * ------------------------------------------------------------------ */

test('applyFK：groups[0] 为单位矩阵，groups[k] 取 links[k-1]，世界矩阵即该绝对变换（不得连乘）', async () => {
  const handle = await loadRobotModel('unit-applyfk', { loadGltf: fakeLoader() })
  const { groups } = handle

  // 选定输入：links[0] = 绕 z 转 90°；links[1..5] = 各自沿某轴的纯平移。
  const links = [
    new Matrix4().makeRotationZ(Math.PI / 2).toArray(),
    new Matrix4().makeTranslation(0.24, 0, 0).toArray(),
    new Matrix4().makeTranslation(0, 0.21, 0).toArray(),
    new Matrix4().makeTranslation(0, 0, 0.085).toArray(),
    new Matrix4().makeTranslation(0, 0.092, 0).toArray(),
    new Matrix4().makeTranslation(0, 0, 0.092).toArray(),
  ]

  handle.applyFK({ links })

  // groups[0] 恒为单位矩阵（基座固定）
  elementsCloseTo(groups[0].matrix.elements, identity4(), 'groups[0].matrix')
  // groups[k] (k≥1) 等于 links[k-1]
  for (let k = 1; k < 7; k++) {
    elementsCloseTo(groups[k].matrix.elements, links[k - 1], `groups[${k}].matrix`)
  }

  // 世界矩阵必须**等于该绝对变换本身**：groups[k] 是运动根（单位矩阵）的直接子节点。
  handle.root.updateMatrixWorld(true)
  for (let k = 1; k < 7; k++) {
    elementsCloseTo(groups[k].matrixWorld.elements, links[k - 1], `groups[${k}].matrixWorld`)
  }

  // 反例守卫（缺陷回归）：世界矩阵**不得**等于链式连乘。旧实现把绝对变换写进嵌套的局部矩阵，
  // three.js 的 matrixWorld 会把父链乘起来，于是从第 3 个组起位置就与正确值分离（真机上表现为
  // 「所有关节都不在正确位置」）。
  let accumulated = identity4()
  for (let k = 1; k < 7; k++) {
    accumulated = multiply4(accumulated, links[k - 1])
    if (k >= 2) {
      const drift = Math.hypot(
        ...[12, 13, 14].map((i) => groups[k].matrixWorld.elements[i] - accumulated[i]),
      )
      assert.ok(drift > 1e-6, `groups[${k}] 的世界矩阵等于连乘结果（偏差 ${drift}），说明又串成了父链`)
    }
  }

  // 末端世界平移必须真的离开原点（防止"全堆在原点"式退化）
  const t = groups[6].matrixWorld.elements
  assert.ok(Math.hypot(t[12], t[13], t[14]) > 0.05, '末端位置必须离开原点')

  // 非法输入：静默保持上一姿态，不抛错
  const before = groups[3].matrix.elements.slice()
  handle.applyFK(undefined)
  handle.applyFK({})
  handle.applyFK({ links: null })
  assert.deepEqual(groups[3].matrix.elements, before, '非法 links 不得改变已有姿态')

  handle.dispose()
})

/* ------------------------------------------------------------------ *
 * 用例 4：缺节点容错 —— 部分名字缺失时不抛错，groups 长度恒为 7
 * ------------------------------------------------------------------ */

test('loadRobotModel：GLB 缺部分节点时不抛错，groups 长度恒为 7，命中的仍挂到对应组', async () => {
  const present = ['base', 'forearm', 'wrist3']
  const scene = fakeGltfScene(present)
  const handle = await loadRobotModel('unit-partial', { loadGltf: fakeLoader(scene) })

  assert.equal(handle.usedFallback, false, '节点缺失不算加载失败（按计划不回退）')
  assert.equal(handle.groups.length, 7, 'groups 长度必须恒为 7')
  assert.equal(scene.children.length, 1, 'root 下只剩运动根')

  // 命中的三个挂到各自的组；缺失的组留空（只有下一级组作为子节点）
  const expectIndex = { base: 0, forearm: 3, wrist3: 6 }
  for (const name of present) {
    const found = handle.root.getObjectByName(name)
    assert.equal(found.parent, handle.groups[expectIndex[name]], `${name} 应挂到 groups[${expectIndex[name]}]`)
  }
  for (let i = 0; i < 7; i++) {
    const nonGroupChildren = handle.groups[i].children.filter((c) => !handle.groups.includes(c))
    const expected = present.includes(LINK_MESH_NODES[i]) ? 1 : 0
    assert.equal(nonGroupChildren.length, expected, `groups[${i}] 的网格子节点数`)
  }

  // 装配照常可用
  handle.applyFK({ links: [identity4(), identity4(), identity4(), identity4(), identity4(), identity4()] })
  elementsCloseTo(handle.groups[6].matrix.elements, identity4(), 'groups[6].matrix')

  handle.dispose()
})

/* ------------------------------------------------------------------ *
 * 用例 5：回退 + 缓存（同型号只加载一次）+ URL 形状
 * ------------------------------------------------------------------ */

test('loadRobotModel：加载失败回退且不抛错，同型号命中缓存（loadGltf 只调一次）', async () => {
  let calls = 0
  const failing = async () => {
    calls++
    throw new Error('404')
  }

  const h1 = await loadRobotModel('unknown-xyz', { loadGltf: failing })
  assert.equal(h1.usedFallback, true, '加载失败必须回退')
  assert.equal(calls, 1, '第一次应真的尝试加载')
  assert.deepEqual(meshNamesUnder(h1.root).sort(), [...LINK_MESH_NODES].sort(), '回退臂 7 段都在 root 下')
  // 回退臂也走同一张装配表（不能全堆在原点）
  for (let i = 0; i < 7; i++) {
    const found = h1.root.getObjectByName(LINK_MESH_NODES[i])
    assert.equal(found.parent, h1.groups[i], `回退臂 ${LINK_MESH_NODES[i]} 必须挂到 groups[${i}]`)
  }
  h1.applyFK({ links: [identity4(), identity4(), identity4(), identity4(), identity4(), identity4()] })

  const h2 = await loadRobotModel('unknown-xyz', { loadGltf: failing })
  assert.equal(calls, 1, '第二次必须命中缓存，不得再次加载')
  assert.equal(h2.root, h1.root, '命中缓存必须复用同一份模型（root 相同）')
  assert.notEqual(h2, h1, '但每次调用返回**独立的释放句柄**（Ruling 36 引用计数）')

  const h3 = await loadRobotModel('UNKNOWN-XYZ', { loadGltf: failing })
  assert.equal(calls, 1, '型号 id 大小写不敏感（小写化后命中缓存）')
  assert.equal(h3.root, h1.root)

  // 注入点默认调用的 URL 形状（host 资产路由 + encodeURIComponent）
  const loader = fakeLoader()
  await loadRobotModel('ur3 e', { loadGltf: loader })
  assert.deepEqual(loader.calls, [`${TWIN_ASSET_PATH}?model=${encodeURIComponent('ur3 e')}`])

  // 引用计数：只释放一部分引用时，模型必须仍然有效（不得把别人正在渲染的模型放掉）
  const again = fakeLoader()
  h1.dispose()
  h1.dispose() // 幂等：同一句柄重复 dispose 不得多扣
  const h4 = await loadRobotModel('unknown-xyz', { loadGltf: again })
  assert.equal(again.calls.length, 0, '仍有未释放的引用 ⇒ 必须命中缓存、不得重新加载')
  assert.equal(h4.root, h1.root, '仍复用同一份模型')

  // 引用归零后才真正失效：再次加载会重新请求
  h2.dispose()
  h3.dispose()
  h4.dispose()
  const reload = fakeLoader()
  await loadRobotModel('unknown-xyz', { loadGltf: reload })
  assert.equal(reload.calls.length, 1, '引用归零后必须重新加载（不得复用已释放的模型）')
})

test('引用计数：任一视图释放不得破坏另一方正在渲染的模型（Ruling 36）', async () => {
  const loader = async () => ({ scene: fakeGltfScene() })
  const a = await loadRobotModel('refcount-a', { loadGltf: loader })
  const b = await loadRobotModel('refcount-a', { loadGltf: loader })
  assert.equal(a.root, b.root, '两个视图共享同一份模型')
  assert.notEqual(a, b, '两个视图各持一个释放句柄')

  // 给**共享的** geometry/material 装计数器，观察是否被释放。
  // 注意 fakeGltfScene 用的是无几何的 Object3D，所以这里直接给 7 个连杆节点挂上计数对象。
  let disposed = 0
  for (const name of LINK_MESH_NODES) {
    const node = a.root.getObjectByName(name)
    assert.ok(node, `假 scene 应有节点 ${name}`)
    node.geometry = { dispose: () => { disposed++ } }
    node.material = { dispose: () => { disposed++ } }
  }

  a.dispose()
  assert.equal(disposed, 0, '还有一个引用未释放 ⇒ 绝不能释放共享的 GPU 资源')

  b.dispose()
  assert.ok(disposed > 0, '最后一个引用释放 ⇒ 必须真正释放 GPU 资源')
})

/* ------------------------------------------------------------------ *
 * 用例 6：disposeObject3D —— 递归释放 geometry/material/贴图，并摘掉自己
 * ------------------------------------------------------------------ */

test('disposeObject3D：调用 geometry/material（含贴图）的 dispose 并把自己从父节点摘下', () => {
  const counter = () => {
    const c = { n: 0 }
    c.dispose = () => {
      c.n++
    }
    return c
  }
  const geo = counter()
  const tex = counter()
  const mat = counter()
  mat.map = tex // 材质上的贴图也要释放

  const geo2 = counter()
  const mat2 = counter()

  const parent = new Group()
  // 用假对象替换真实的 geometry/material，便于计数；traverse 仍走 three 的真实实现。
  const mesh = new Mesh()
  mesh.geometry = geo
  mesh.material = mat
  const meshArrayMat = new Mesh()
  meshArrayMat.geometry = geo2
  meshArrayMat.material = [mat2]
  const wrapper = new Group()
  wrapper.add(mesh)
  wrapper.add(meshArrayMat)
  parent.add(wrapper)

  assert.equal(parent.children.length, 1)
  disposeObject3D(wrapper)

  assert.equal(geo.n, 1, 'geometry.dispose 必须被调用一次')
  assert.equal(mat.n, 1, 'material.dispose 必须被调用一次')
  assert.equal(tex.n, 1, 'material 上的贴图 dispose 必须被调用一次')
  assert.equal(geo2.n, 1, '数组材质分支：geometry.dispose')
  assert.equal(mat2.n, 1, '数组材质分支：material.dispose')
  assert.equal(wrapper.parent, null, '必须把自己从父节点摘下')
  assert.equal(parent.children.length, 0, '父节点不得残留')

  // 容错：非 Object3D / 无父节点的输入不得抛错
  disposeObject3D(null)
  disposeObject3D(undefined)
  disposeObject3D({})
  const orphan = new Group()
  disposeObject3D(orphan)
  assert.equal(orphan.parent, null)
})

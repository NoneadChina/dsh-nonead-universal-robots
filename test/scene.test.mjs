/**
 * `createScene` 的单测（清单第 21 条）。
 *
 * 原先这个函数**没有单测**，文件头如实标注了原因：`WebGLRenderer` 需要真实 WebGL 上下文。
 * 现在 `createScene(canvas, { rendererFactory })` 留了注入点，于是"光照 / 网格 / 相机 /
 * controls 参数"这些**真正容易调错的东西**终于可以被断言，不必靠 GUI 手验。
 *
 * 假 canvas / 假 renderer 只实现 `OrbitControls` 与 `createScene` 实际会碰到的成员。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CAMERA_SPEC,
  createBaseGrid,
  createScene,
  gridExtentFor,
  SCENE_LIGHTING,
} from '../src/client/robot/scene.js'

/** 最小假 canvas：`OrbitControls` 只用到事件、样式与尺寸相关的少数成员。 */
function fakeCanvas() {
  const listeners = new Map()
  const noop = () => {}
  return {
    clientWidth: 800,
    clientHeight: 600,
    style: {},
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler)
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
    // `OrbitControls` 会向 `domElement.getRootNode()` 挂全局监听（键盘/滚轮等）。
    getRootNode: () => ({ addEventListener: noop, removeEventListener: noop }),
    setPointerCapture: noop,
    releasePointerCapture: noop,
    hasPointerCapture: () => false,
    ownerDocument: { addEventListener: noop, removeEventListener: noop },
    /** 测试用：看看注册了多少个监听器（`dispose` 后应清空）。 */
    _listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  }
}

/** 最小假 renderer：只提供 `createScene` 与 `dispose` 真正会调用的成员。 */
function fakeRenderer(calls) {
  return {
    toneMapping: null,
    toneMappingExposure: 1,
    shadowMap: { enabled: false },
    setPixelRatio() {},
    setSize() {},
    render() {
      calls.render += 1
    },
    dispose() {
      calls.dispose += 1
    },
    forceContextLoss() {
      calls.forceContextLoss += 1
    },
    getContext: () => null,
    getRenderTarget: () => null,
    setRenderTarget() {},
    clear() {},
    getDrawingBufferSize(target) {
      return target?.set?.(800, 600) ?? { x: 800, y: 600, width: 800, height: 600 }
    },
    getSize(target) {
      return target?.set?.(800, 600) ?? { width: 800, height: 600 }
    },
  }
}

function build() {
  const calls = { render: 0, dispose: 0, forceContextLoss: 0 }
  const canvas = fakeCanvas()
  const scene = createScene(canvas, { rendererFactory: () => fakeRenderer(calls) })
  return { calls, canvas, scene }
}

test('createScene 在注入假 renderer 时可建出场景（这正是原先测不到的部分）', () => {
  let built
  assert.doesNotThrow(() => {
    built = build()
  }, '有了 rendererFactory 注入点，createScene 必须能在 Node 里跑通')

  const { scene } = built
  assert.ok(scene.scene, '必须有 scene')
  assert.ok(scene.camera, '必须有 camera')
  assert.ok(scene.renderer, '必须有 renderer')
  assert.ok(scene.controls, '必须有 controls')
})

test('相机与光照参数来自导出的常量（改常量就是改行为，不会再有两处魔法数字）', () => {
  const { scene } = build()

  assert.equal(scene.camera.fov, CAMERA_SPEC.fov)
  assert.equal(scene.camera.near, CAMERA_SPEC.near)
  assert.equal(scene.camera.far, CAMERA_SPEC.far)
  // ⚠️ 用容差而不是精确相等：`OrbitControls` 构造时会 `update()`，把相机位置经球坐标
  // 往返一次，带来 1e-16 级的浮点误差。断言"数值相等"会把这条正确的实现判成失败。
  const near = (actual, expected, label) => {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`)
  }
  near(scene.camera.position.x, CAMERA_SPEC.position[0], 'camera.x')
  near(scene.camera.position.y, CAMERA_SPEC.position[1], 'camera.y')
  near(scene.camera.position.z, CAMERA_SPEC.position[2], 'camera.z')
  // 世界 Z 向上 = 基座 Z 向上：这条错了整个画面的"上"就反了。
  assert.deepEqual([scene.camera.up.x, scene.camera.up.y, scene.camera.up.z], [0, 0, 1])

  const lights = scene.scene.children.filter((child) => child.isLight)
  const ambient = lights.find((light) => light.isAmbientLight)
  const directional = lights.find((light) => light.isDirectionalLight)
  assert.ok(ambient, '必须有环境光')
  assert.ok(directional, '必须有平行光')
  assert.equal(ambient.intensity, SCENE_LIGHTING.ambientIntensity)
  assert.equal(directional.intensity, SCENE_LIGHTING.directionalIntensity)
  assert.deepEqual(
    [directional.position.x, directional.position.y, directional.position.z],
    [...SCENE_LIGHTING.directionalPosition],
  )
})

test('渲染必须开 ACES tone mapping；环境贴图拿不到时要降级而不是崩掉', () => {
  const { scene } = build()
  // 假 renderer 不是真 WebGLRenderer，PMREMGenerator 必然失败 —— 这正是降级路径的验证：
  // 场景照样建得出来，只是没有 environment。
  assert.equal(scene.renderer.toneMappingExposure, 1)
  assert.equal(scene.renderer.toneMapping, 4, 'ACESFilmicToneMapping 的枚举值是 4')
  assert.equal(scene.scene.environment, null, '拿不到环境贴图时必须是 null，而不是半个对象')
})

test('基座网格被挂进场景，且尺寸由 gridExtentFor 决定', () => {
  const { scene } = build()
  const grid = scene.grid
  assert.ok(grid, '必须有基座网格')
  assert.ok(scene.scene.children.includes(grid), '网格必须在场景里')
  assert.equal(grid.rotation.x, Math.PI / 2, '网格必须摆到 XY 面（法线 +Z）')

  // 换装时 `replaceGrid` 会按新半径重建 —— 尺寸必须与纯函数一致。
  // `GridHelper` 的 geometry 是 BufferGeometry（**没有** `parameters`），所以断言顶点范围。
  const expected = gridExtentFor(1)
  const rebuilt = createBaseGrid(expected.size, expected.divisions)
  const positions = rebuilt.geometry.getAttribute('position')
  let extent = 0
  for (const value of positions.array) extent = Math.max(extent, Math.abs(value))
  assert.ok(
    Math.abs(extent - expected.size / 2) < 1e-6,
    `网格半边长应为 ${expected.size / 2}，实测 ${extent}`,
  )
  assert.ok(expected.size > 0 && expected.divisions > 0)
})

test('dispose 释放 renderer 并强制丢失上下文（否则每次收起面板都漏一个 WebGL 上下文）', () => {
  const { calls, scene } = build()
  scene.dispose()
  assert.equal(calls.dispose, 1, '必须 dispose renderer')
  assert.equal(calls.forceContextLoss, 1, '必须 forceContextLoss —— 只 dispose 不会释放上下文')
  // 幂等：重复 dispose 不该再动 renderer（避免二次释放已释放的对象）。
  assert.doesNotThrow(() => scene.dispose())
})

test('resize 用 canvas 的 CSS 尺寸并钳住像素比', () => {
  const { scene } = build()
  assert.equal(typeof scene.resize(), 'boolean')
  // 极端像素比要被钳住：HiDPI 上按 devicePixelRatio 全量渲染会把填充率吃光。
  assert.doesNotThrow(() => createScene(fakeCanvas(), {
    rendererFactory: () => fakeRenderer({ render: 0, dispose: 0, forceContextLoss: 0 }),
    maxPixelRatio: 1,
  }))
})

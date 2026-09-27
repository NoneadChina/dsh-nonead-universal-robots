/**
 * src/client/robot/scene.js — three.js 场景/相机/光照/OrbitControls 装配。
 *
 * 与 `loader.js` 分离的原因：本模块只负责"渲染容器"，模型装配与 FK 归 loader / twin-panel。
 *
 * ## 世界坐标 = UR 基座坐标（Z 向上）
 * 机器人各连杆姿态是 FK 直接算出的**基座系**坐标（UR 基座 X 向前、Y 向左、Z 向上），
 * `applyFK()` 把它们原样写进各装配组。所以场景必须让**世界坐标系与基座坐标系重合**：
 *   - 网格**平面 = 基座平面**（XY 面，z=0）：`GridHelper` 默认躺在 XZ 面、法线 +Y，
 *     故绕 X 轴转 +90° 把法线转到 +Z（见 `createBaseGrid()`）；
 *   - `camera.up = +Z`，否则 OrbitControls 会把 Z 当"侧向"、视角整体歪掉。
 * **不要**反过来把机器人根节点旋转去迁就 Y 向上的世界：那会破坏"基座 X/Y/Z = 世界 X/Y/Z"。
 *
 * ## 测试缺口（如实标注）
 * `WebGLRenderer` 需要真实 WebGL 上下文，**Node 下无法构造**，故 `createScene()` 本身**不做单测**；
 * 但网格朝向这一条契约已抽成 `createBaseGrid()`，由 `test/scene-alignment.test.mjs` 覆盖。
 * 其余视觉与交互（光照、阻尼、缩放）交由 GUI 手动验收。
 */

import { Scene, PerspectiveCamera, WebGLRenderer, DirectionalLight, AmbientLight, GridHelper } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

/**
 * 基座网格：平面与**基座平面 XY** 重合（z=0），网格的 X/Y 方向与基座 X/Y 重合。
 *
 * `GridHelper` 默认在 XZ 面（法线 +Y）；绕 X 轴 `+π/2` 后法线变为 +Z ⇒ 落在 XY 面。
 *
 * @param {number} [size=2] 网格边长（米）
 * @param {number} [divisions=20] 分格数（每格 size/divisions 米）
 * @returns {GridHelper} 已摆正的网格（直接 add 进场景即可）
 */
export function createBaseGrid(size = 2, divisions = 20) {
  const grid = new GridHelper(size, divisions, 0x334455, 0x223344)
  grid.name = 'base_grid'
  grid.rotation.x = Math.PI / 2
  return grid
}

/**
 * 在给定 canvas 上装配渲染场景。
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]
 * @param {number} [options.maxPixelRatio=2] 设备像素比上限（HiDPI 清晰度 / 填充率的折中）
 * @returns {{renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera,
 *            controls: OrbitControls, resize: () => boolean, render: () => void,
 *            dispose: () => void}}
 */
export function createScene(canvas, { maxPixelRatio = 2 } = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  const scene = new Scene()
  const camera = new PerspectiveCamera(45, 1, 0.01, 100)
  camera.up.set(0, 0, 1) // 世界 Z 向上 = 基座 Z 向上
  camera.position.set(0.8, -0.8, 0.6)

  const grid = createBaseGrid()
  scene.add(new AmbientLight(0xffffff, 0.8))
  const dir = new DirectionalLight(0xffffff, 1.2)
  dir.position.set(1, 2, 1)
  scene.add(dir)
  scene.add(grid)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.target.set(0, 0, 0.3)
  // 没有这两条时用户可以把相机缩到机械臂内部、或推到看不见的地方，且没有任何办法回来
  // （只能收起再展开面板）。给一个与机械臂尺度相称的区间，配合面板的"重置视角"。
  controls.minDistance = 0.15
  controls.maxDistance = 6

  /**
   * 视口尺寸（CSS 像素）→ 渲染尺寸。
   *
   * **必须设 devicePixelRatio**：three 的默认 `_pixelRatio` 是 1，不设置的话在 HiDPI 屏上
   * 画面会按 CSS 像素渲染再被拉伸 ⇒ 明显发虚。
   *
   * @returns {boolean} 是否真的按新尺寸渲染（尺寸为 0 时返回 false，调用方可据此重试）
   */
  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas
    if (w === 0 || h === 0) return false
    const dpr = Math.min(
      maxPixelRatio,
      Math.max(1, (typeof globalThis !== 'undefined' && globalThis.devicePixelRatio) || 1),
    )
    renderer.setPixelRatio(dpr)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    return true
  }

  /** 每帧调用：阻尼更新 + 渲染。 */
  function render() {
    controls.update()
    renderer.render(scene, camera)
  }

  /**
   * 释放控制器、场景内自带几何体与**渲染上下文**。
   *
   * ⚠️ `renderer.dispose()` **不会**释放 WebGL 上下文（r180 里它只丢掉内部缓存并摘掉自己
   * 装的 context-lost 监听）；必须再调 `forceContextLoss()`。否则每次展开/收起面板都会
   * 留下一个活着的上下文，浏览器上限（约 16 个）一到就开始回收最老的 —— 表现是孪生面板
   * 或其它 WebGL 视图（例如任务看板）变黑。
   *
   * `GridHelper` 自带可释放的 BufferGeometry/LineBasicMaterial，之前从未被释放。
   */
  function dispose() {
    controls.dispose()
    try {
      grid.geometry?.dispose?.()
      grid.material?.dispose?.()
    } catch {
      /* 释放失败不应影响后续清理 */
    }
    scene.remove(grid)
    try {
      renderer.forceContextLoss?.()
    } catch {
      /* 某些环境（无扩展）不支持 */
    }
    renderer.dispose()
  }

  return { renderer, scene, camera, controls, grid, resize, render, dispose }
}

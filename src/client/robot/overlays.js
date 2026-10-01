/**
 * 工程辅助图层（清单第 9 条）：基座坐标系、可达范围包络、负载重心、TCP 力矩矢量。
 *
 * 这些才是"孪生"和"模型浏览器"的分界线 —— 它们显示的不是机器人**长什么样**，
 * 而是**它在物理上处于什么约束里**（能到哪、重心在哪、正在受多大力）。
 *
 * ## 设计约定
 *
 * - **全部可开关，默认关**：一次性全画出来画面会花到看不清真臂。
 * - 每个图层各自是一个 `Group` / 对象，调用方用 `visible` 控制，`dispose*` 释放。
 * - 所有几何尺寸都可由纯函数算出，因此可单测（WebGL 上下文只在真正渲染时才需要）。
 */

import {
  ArrowHelper,
  BackSide,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three'

import { linkLengthsFromKinematics } from './loader.js'

/** 可达球的缺省颜色（冷色，避免与警示红/橙混淆）。 */
export const REACH_SPHERE_COLOR = 0x3d7ea6

/** 负载重心标记的颜色（醒目但不刺眼）。 */
export const COG_MARKER_COLOR = 0xffd166

/** 力矩箭头的缺省长度（米）—— 只在力为零时可见的基准，实际长度按力的大小缩放。 */
export const FORCE_ARROW_BASE_LENGTH = 0.1

/** 每牛顿对应的箭头长度（米）。力很大时会被 `maxLength` 钳住。 */
export const FORCE_ARROW_METERS_PER_NEWTON = 0.002

/** 箭头长度上限（米）：力尖峰时不该画出一根穿过整个画面的长矛。 */
export const FORCE_ARROW_MAX_LENGTH = 0.6

/** 小于这个力（N）就不画箭头 —— 噪声级别的小量画出来只是抖动。 */
export const FORCE_ARROW_DEADZONE_N = 1

/**
 * 型号的**可达范围上界**（米）：6 段相邻原点的欧氏距离之和，即"完全伸直"能到的距离。
 *
 * ⚠️ 这是**上界**而不是厂商 spec 里的 reach：官方 reach 指"基座到腕心的最大径向距离"
 * （UR5e 是 850 mm），而这里把各段长度直接相加（UR5e ≈ 1.32 m），因为没有做关节偏置的
 * 极值优化。可视化上宁可画大一点（说明"最远能到这儿"），也要在界面上标注它是上界。
 *
 * @param {number[][]} links `kinematics.json` 的 `links`
 * @returns {number|null} 半径（米）；数据不足时 `null`
 */
export function reachRadiusFromKinematics(links) {
  const lengths = linkLengthsFromKinematics(links)
  if (lengths === null) return null
  // 最后一段（末端）是前面最后一段的近似值，计入会让上界虚高，所以只累加前 6 段。
  const total = lengths.slice(0, 6).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
  return total > 0 ? total : null
}

/**
 * 力矢量 → 箭头参数（方向单位向量 + 长度）。
 *
 * 纯函数，便于单测；也把"死区 / 上限"这两个容易写错的地方集中到一处。
 *
 * @param {number[]} force `ur_get_tcp_force` 的前三维（N）
 * @param {{deadzoneN?: number, metersPerNewton?: number, maxLength?: number}} [options]
 * @returns {{direction: [number, number, number], length: number}|null} 不画时返回 `null`
 */
export function forceArrowFor(force, options = {}) {
  if (!Array.isArray(force) || force.length < 3) return null
  const [fx, fy, fz] = force
  if (!Number.isFinite(fx) || !Number.isFinite(fy) || !Number.isFinite(fz)) return null

  const magnitude = Math.hypot(fx, fy, fz)
  const deadzone = Number.isFinite(options.deadzoneN) ? options.deadzoneN : FORCE_ARROW_DEADZONE_N
  // 死区：噪声级别的小力画出来只是一根抖动的短线，不如不画。
  if (!(magnitude > deadzone)) return null

  const perNewton = Number.isFinite(options.metersPerNewton)
    ? options.metersPerNewton
    : FORCE_ARROW_METERS_PER_NEWTON
  const maxLength = Number.isFinite(options.maxLength) ? options.maxLength : FORCE_ARROW_MAX_LENGTH
  const length = Math.min(maxLength, magnitude * perNewton)

  return {
    direction: [fx / magnitude, fy / magnitude, fz / magnitude],
    length,
  }
}

/**
 * 力/力矩的 HUD 文本。
 *
 * @param {number[]} force `ur_get_tcp_force` 的 6 维 [Fx,Fy,Fz,Tx,Ty,Tz]
 * @returns {string} 形如 `力 12.3 N  力矩 0.45 N·m`；不可用时返回空串
 */
export function formatForce(force) {
  if (!Array.isArray(force) || force.length < 6) return ''
  const [fx, fy, fz, tx, ty, tz] = force
  if (![fx, fy, fz, tx, ty, tz].every(Number.isFinite)) return ''
  const forceMagnitude = Math.hypot(fx, fy, fz)
  const torqueMagnitude = Math.hypot(tx, ty, tz)
  return `力 ${forceMagnitude.toFixed(1)} N  力矩 ${torqueMagnitude.toFixed(2)} N·m`
}

/**
 * 造一个可达范围包络球。
 *
 * 用 `BackSide` + 半透明：从球外看进去是"内壁"，不会挡住球内的机械臂；再叠一层线框
 * 让球面的形状可读。
 *
 * @param {number} radius 半径（米）
 * @returns {Group} 默认隐藏
 */
export function createReachSphere(radius) {
  const group = new Group()
  group.name = 'ur-twin-reach-sphere'
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1

  const shell = new Mesh(
    new SphereGeometry(r, 32, 20),
    new MeshBasicMaterial({
      color: REACH_SPHERE_COLOR,
      transparent: true,
      opacity: 0.06,
      side: BackSide,
      depthWrite: false,
    }),
  )
  shell.name = 'ur-twin-reach-shell'
  group.add(shell)

  const wire = new Mesh(
    new SphereGeometry(r, 16, 10),
    new MeshBasicMaterial({
      color: REACH_SPHERE_COLOR,
      transparent: true,
      opacity: 0.18,
      wireframe: true,
      depthWrite: false,
      side: DoubleSide,
    }),
  )
  wire.name = 'ur-twin-reach-wire'
  group.add(wire)

  group.visible = false
  return group
}

/**
 * 造一个负载重心标记（小球）。
 *
 * @param {number} [diameter=0.03] 标记直径（米）
 * @returns {Mesh} 默认隐藏
 */
export function createCogMarker(diameter = 0.03) {
  const size = Number.isFinite(diameter) && diameter > 0 ? diameter : 0.03
  const marker = new Mesh(
    new SphereGeometry(size / 2, 16, 12),
    new MeshBasicMaterial({ color: COG_MARKER_COLOR, depthTest: false }),
  )
  marker.name = 'ur-twin-cog-marker'
  marker.visible = false
  return marker
}

/**
 * 造一个 TCP 受力箭头，并写入一次初值。
 *
 * @param {number[]} [force] 初始力（N）；缺省画一个空箭头
 * @returns {ArrowHelper} 默认隐藏
 */
export function createForceArrow(force) {
  const arrow = new ArrowHelper(
    new Vector3(0, 0, 1),
    new Vector3(0, 0, 0),
    FORCE_ARROW_BASE_LENGTH,
    0xffffff,
    FORCE_ARROW_BASE_LENGTH * 0.25,
    FORCE_ARROW_BASE_LENGTH * 0.15,
  )
  arrow.name = 'ur-twin-force-arrow'
  arrow.visible = false
  updateForceArrow(arrow, force)
  return arrow
}

/**
 * 按新的力更新箭头；力不可用或落在死区时把箭头隐藏。
 *
 * 只改已有的 `ArrowHelper`（`setDirection` / `setLength`），**不重建** —— 每帧新建几何体
 * 是这个项目明令禁止的做法。
 *
 * @param {ArrowHelper} arrow `createForceArrow` 的返回值
 * @param {number[]|null|undefined} force 6 维力/力矩
 * @param {{deadzoneN?: number, metersPerNewton?: number, maxLength?: number}} [options]
 */
export function updateForceArrow(arrow, force, options) {
  if (arrow == null) return
  const spec = forceArrowFor(force, options)
  if (spec === null) {
    arrow.visible = false
    return
  }
  arrow.setDirection(new Vector3(...spec.direction))
  arrow.setLength(spec.length, spec.length * 0.25, spec.length * 0.15)
  arrow.visible = true
}

/**
 * 释放一组叠加图层持有的几何体与材质。
 *
 * @param {import('three').Object3D|null|undefined} object
 */
export function disposeOverlay(object) {
  if (object == null) return
  object.traverse?.((node) => {
    node.geometry?.dispose?.()
    const material = node.material
    if (Array.isArray(material)) {
      for (const entry of material) entry?.dispose?.()
    } else {
      material?.dispose?.()
    }
  })
  object.parent?.remove?.(object)
}

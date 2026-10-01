/**
 * TCP 坐标轴 gizmo：带 X/Y/Z 标签、尺寸随取景半径自适应。
 *
 * 背景（清单第 6 条）：原先是一个裸 `AxesHelper(0.08)` —— 固定 8 cm，没有轴标签。
 * 后果有两个：UR3（reach 0.5 m）上偏大、UR30（reach 1.3 m）上偏小；而且三条轴长得
 * 一模一样，看不出哪个是哪个。
 *
 * 这里把两件事都修掉：
 * 1. **尺寸按取景半径的比例给**（`tcpAxesSizeFor`），所以不同臂长下视觉比例一致；
 * 2. **每条轴末端带一个字母标签**（Sprite + CanvasTexture，不依赖外部字体或模型文件）。
 *
 * ⚠️ 标签用 `document.createElement('canvas')` 绘制。**没有 canvas 的环境（Node 单测、
 * 无 DOM 的宿主）必须优雅退化**：整个 gizmo 仍然可用，只是没有字母 —— 绝不能因为画不出
 * 标签就让面板挂掉。
 */

import { AxesHelper, CanvasTexture, Color, Group, Sprite, SpriteMaterial } from 'three'

/** 取景半径未知时的回退轴长（米）。保持与旧版本一致的默认值。 */
export const TCP_AXES_SIZE = 0.08

/** 轴长占取景半径的比例。0.12 × 半径在 UR3/UR20/UR30 上都落在舒服的视觉比例。 */
export const TCP_AXES_RADIUS_RATIO = 0.12

/** 轴长下界（米）：再小就看不清了。 */
export const TCP_AXES_SIZE_MIN = 0.03

/** 轴长上界（米）：再大就会盖住工具本身。 */
export const TCP_AXES_SIZE_MAX = 0.3

/** 三条轴的顺序、字母与颜色（与 `AxesHelper` 的 X/Y/Z 配色一致）。 */
export const TCP_AXIS_LABELS = Object.freeze([
  Object.freeze({ text: 'X', color: 0xff3653 }),
  Object.freeze({ text: 'Y', color: 0x8cff36 }),
  Object.freeze({ text: 'Z', color: 0x36a2ff }),
])

/**
 * 按取景半径算出合适的轴长（米）。
 *
 * 半径非法（0 / 负数 / NaN）时回退 `TCP_AXES_SIZE` —— 调用方常常还没完成第一次取景。
 *
 * @param {number} radius 模型包围球半径（米）
 * @returns {number} 轴长（米）
 */
export function tcpAxesSizeFor(radius) {
  if (!Number.isFinite(radius) || radius <= 0) return TCP_AXES_SIZE
  return Math.min(TCP_AXES_SIZE_MAX, Math.max(TCP_AXES_SIZE_MIN, radius * TCP_AXES_RADIUS_RATIO))
}

/**
 * 画一个字母标签用的贴图。
 *
 * @param {string} text 单个字母
 * @param {number} color 十六进制颜色
 * @returns {CanvasTexture|null} 无 canvas 环境返回 `null`
 */
function makeLabelTexture(text, color) {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // 深色描边 + 亮色填充：无论臂身是亮还是暗都能读出来。
    ctx.font = 'bold 44px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 6
    ctx.strokeStyle = 'rgba(8, 12, 16, 0.9)'
    ctx.strokeText(text, 32, 34)
    ctx.fillStyle = `#${new Color(color).getHexString()}`
    ctx.fillText(text, 32, 34)
    const texture = new CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
  } catch {
    // 没有 canvas（Node 单测、无 DOM 宿主）：放弃标签，保留轴本身。
    return null
  }
}

/**
 * 造一个带标签的 TCP 坐标轴 gizmo。
 *
 * 返回值是**一个 Group**，它自身不参与姿态写入；调用方把 `matrixAutoUpdate = false`
 * 设在自己的那个节点上并每帧写 matrix，内部元素跟着走。
 *
 * @param {number} [size=TCP_AXES_SIZE] 轴长（米）
 * @returns {Group} gizmo 根节点（`userData.axes` 指向内部 `AxesHelper`，便于测试与更新）
 */
export function createTcpAxes(size = TCP_AXES_SIZE) {
  const group = new Group()
  group.name = 'ur-twin-tcp-axes'

  /*
   * 内外两层：外层承接每帧写入的 tool0 矩阵（调用方把 `matrixAutoUpdate = false` 设在
   * 它上面），内层承接尺度缩放。
   *
   * ⚠️ 这两件事**必须分层**：外层的矩阵是 `matrix.fromArray(tool0)` 直接写进去的，
   * `scale` 属性根本不参与 compose —— 在外层改 `scale` 是**完全无效**的。这是本条实现
   * 过程中真实踩到的坑。
   */
  const content = new Group()
  content.name = 'ur-twin-tcp-axes-content'
  group.add(content)

  const axes = new AxesHelper(size)
  axes.name = 'ur-twin-tcp-axes-lines'
  content.add(axes)

  const labels = new Group()
  labels.name = 'ur-twin-tcp-axes-labels'
  const sprites = []
  for (let i = 0; i < TCP_AXIS_LABELS.length; i++) {
    const { text, color } = TCP_AXIS_LABELS[i]
    const texture = makeLabelTexture(text, color)
    if (texture === null) continue
    const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false })
    const sprite = new Sprite(material)
    // 标签摆在各自轴的正向末端，略微超出一点避免盖住轴尖。
    const offset = size * 1.12
    sprite.position.set(
      i === 0 ? offset : 0,
      i === 1 ? offset : 0,
      i === 2 ? offset : 0,
    )
    sprite.scale.setScalar(size * 0.45)
    sprite.name = `ur-twin-tcp-axis-${text.toLowerCase()}`
    labels.add(sprite)
    sprites.push(sprite)
  }
  content.add(labels)
  group.userData.content = content
  group.userData.axes = axes
  group.userData.labels = sprites
  return group
}

/**
 * 换掉 gizmo 的轴长（取景完成后按模型大小调用）。
 *
 * 改**内层 content** 的 scale，而不是重建几何体：轴长是等比缩放，`AxesHelper` 的顶点
 * 位置与缩放呈线性关系，所以缩放与重新生成一个等长轴在视觉上完全一致，却省掉了一次
 * 几何体创建与一次旧几何体释放。
 *
 * @param {Group} group `createTcpAxes` 的返回值
 * @param {number} size 新的轴长（米）
 */
export function updateTcpAxesSize(group, size) {
  const base = TCP_AXES_SIZE
  const scale = Number.isFinite(size) && size > 0 ? size / base : 1
  group?.userData?.content?.scale?.setScalar?.(scale)
}

/**
 * 释放 gizmo 持有的 GPU 资源（几何体、材质、标签贴图）。
 *
 * @param {Group} group `createTcpAxes` 的返回值
 */
export function disposeTcpAxes(group) {
  if (group == null) return
  group.traverse?.((object) => {
    object.geometry?.dispose?.()
    const material = object.material
    if (Array.isArray(material)) {
      for (const entry of material) {
        entry?.map?.dispose?.()
        entry?.dispose?.()
      }
    } else if (material) {
      material.map?.dispose?.()
      material.dispose?.()
    }
  })
}

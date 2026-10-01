/**
 * 幽灵臂：把**控制器打算去哪**画出来，与**实际姿态**叠加显示。
 *
 * 背景（清单第 7 条）：插件早已有 `ur_get_target_values`（目标关节角来自 RTDE 数据流），
 * 但面板只画实际姿态。再叠一层半透明"幽灵臂"显示目标姿态后，操作员一眼就能看出跟随
 * 误差、滞后与交融过程 —— 示教和调试时最有用的一屏，也是数字孪生相对"3D 预览"的差异点。
 *
 * ## 实现要点
 *
 * 克隆真臂（`handle.root.clone(true)`）而不是重新装配 GLB：
 * - clone 是**浅拷**：geometry 与贴图与真臂**共享**，所以多一层几乎不额外占显存；
 * - 组名（`assemble_*`）与父子结构被一起克隆，因此可以按名字重建 7 个装配组的引用，
 *   然后复用与真臂**完全相同**的 `applyLinksToGroups` 语义。
 *
 * ⚠️ **因此绝不能 dispose 克隆树的 geometry** —— 它们与真臂是同一批对象，释放掉会
 * 把真臂也一起毁掉（表现为模型突然消失或渲染报错）。`disposeGhostArm` 只释放自己
 * 新建的那一个材质。
 */

import { DoubleSide, MeshStandardMaterial } from 'three'

import { LINK_MESH_NODES, applyLinksToGroups } from './loader.js'

/** 幽灵臂的缺省颜色：明显区别于 UR 的浅灰金属本体，又不至于刺眼。 */
export const GHOST_ARM_COLOR = 0x5ac8fa

/** 幽灵臂缺省不透明度。太低看不见，太高会盖住真臂而看不出误差。 */
export const GHOST_ARM_OPACITY = 0.28

/**
 * **待审批**目标用的颜色（清单第 8 条）。
 *
 * 与已下发的目标（青色）刻意区分：橙色是"还没批准、将要发生"的语义，肉眼一眼可辨。
 */
export const GHOST_ARM_PENDING_COLOR = 0xffa657

/**
 * 为一份已加载的模型造一层半透明幽灵臂。
 *
 * @param {{root: import('three').Object3D}} handle `loadRobotModel` 的返回值
 * @param {{color?: number, opacity?: number}} [options] 外观覆盖
 * @returns {{root: import('three').Object3D, groups: Array<import('three').Object3D|null>,
 *            material: MeshStandardMaterial,
 *            applyFK: (result: {links?: number[][]}) => void,
 *            setVisible: (visible: boolean) => void}}
 */
export function createGhostArm(handle, options = {}) {
  const source = handle?.root
  if (!source || typeof source.clone !== 'function') {
    throw new Error('createGhostArm: 需要一个含 root 的模型句柄')
  }

  const root = source.clone(true)
  root.name = 'ur-twin-ghost-arm'

  // 整棵树共用一个材质：省 draw call，也保证视觉一致。
  const material = new MeshStandardMaterial({
    color: options.color ?? GHOST_ARM_COLOR,
    transparent: true,
    opacity: options.opacity ?? GHOST_ARM_OPACITY,
    // 半透明物体写深度会互相遮挡出硬边，关掉更接近"幽灵"的观感。
    depthWrite: false,
    side: DoubleSide,
    roughness: 0.5,
    metalness: 0.05,
  })
  root.traverse?.((object) => {
    if (object.isMesh) object.material = material
  })

  // 按组名重建 7 个装配组的引用：clone 保留了名字与父子结构。
  const groups = []
  for (let i = 0; i < 7; i++) {
    groups.push(root.getObjectByName?.(`assemble_${LINK_MESH_NODES[i]}`) ?? null)
  }

  // 默认隐藏：没拿到目标姿态之前不该出现一层静止的假臂。
  root.visible = false

  return {
    root,
    groups,
    material,
    applyFK(result) {
      applyLinksToGroups(groups, result)
    },
    setVisible(visible) {
      root.visible = visible === true
    },
    /**
     * 切换"这是待审批的目标"配色。
     *
     * 只改颜色，不新建材质 —— 颜色变了但材质实例不变，避免每帧产生 GPU 资源。
     */
    setPending(pending) {
      const base = options.color ?? GHOST_ARM_COLOR
      material.color.setHex(pending === true ? GHOST_ARM_PENDING_COLOR : base)
    },
  }
}

/**
 * 释放幽灵臂。
 *
 * ⚠️ **只释放自己新建的材质**：克隆树里的 geometry 与贴图与真臂共享，在这里释放会把
 * 真臂一起毁掉。
 *
 * @param {ReturnType<typeof createGhostArm>} ghost
 */
export function disposeGhostArm(ghost) {
  if (ghost == null) return
  ghost.root?.parent?.remove?.(ghost.root)
  ghost.material?.dispose?.()
}

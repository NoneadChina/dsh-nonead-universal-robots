/**
 * UR 机械臂正向运动学 — 纯函数模块。
 *
 * 约束：纯 ESM、**零 import**、无运行时依赖（不依赖 three.js，可在主进程与渲染进程共用）。
 * 矩阵约定：全部为 **4x4 列主序** `number[16]`（与 three.js / glMatrix 一致）。
 *   元素下标 m[column * 4 + row]；
 *   平移分量位于 m[12], m[13], m[14]；
 *   旋转部分为左上 3x3，列 c 为基向量 e_c 的像。
 *
 * 运动学链来源：`assets/kinematics.json` 的单个型号对象
 *   { links: [6 × {x,y,z,roll,pitch,yaw}], jointLimits: [...] }
 * 其中 rpy 采用与 URDF 一致的约定（外旋 xyz 序 ≡ 内旋 zyx 序，即 R = Rz(yaw)·Ry(pitch)·Rx(roll)）。
 * 链序与官方 default_kinematics.yaml 一致：对每个 i，先施加连杆固定变换，再绕其局部 z 轴旋转 q[i]。
 */

/** 4x4 单位矩阵（列主序）。 */
export function identity4() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/** 列主序 4x4 矩阵乘法：返回 a·b（先施加 b，再施加 a）。 */
export function multiply4(a, b) {
  const out = new Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3]
    }
  }
  return out
}

/** 绕 z 轴旋转 t 弧度的 4x4 齐次矩阵（列主序，无平移）。 */
export function rotZ(t) {
  const c = Math.cos(t)
  const s = Math.sin(t)
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/** UR 运动学链参数 → 4x4（列主序）。RPY 采用 ZYX 内旋序（与 URDF 的 rpy 一致）。 */
export function poseToMatrix4(x, y, z, roll, pitch, yaw) {
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  return [
    cy * cp, sy * cp, -sp, 0,
    cy * sp * sr - sy * cr, sy * sp * sr + cy * cr, cp * sr, 0,
    cy * sp * cr + sy * sr, sy * sp * cr - cy * sr, cp * cr, 0,
    x, y, z, 1,
  ]
}

/**
 * 由运动学链与 6 个关节角计算各连杆与 tool0 的 4x4 变换。
 * 链序来自 official default_kinematics.yaml；每个关节绕其局部 z 轴旋转 q[i]。
 * 返回的 links[i] 是“基座 → 第 i 个连杆坐标系”的累积变换，tool0 即 links[5] 的副本。
 */
export function fkChain(kin, q) {
  const links = []
  let t = identity4()
  for (let i = 0; i < 6; i++) {
    const l = kin.links[i]
    t = multiply4(t, poseToMatrix4(l.x ?? 0, l.y ?? 0, l.z ?? 0, l.roll ?? 0, l.pitch ?? 0, l.yaw ?? 0))
    t = multiply4(t, rotZ(q?.[i] ?? 0))
    links.push(t.slice())
  }
  return { links, tool0: t.slice() }
}

// Task 4 — 轨迹缓冲纯函数（纯 ESM，零 import）
// 计划参考实现：docs/superpowers/plans/2026-09-21-ur-digital-twin.md 第 425-435 行

/**
 * 追加一个采样并按 maxAgeMs 淘汰相对新样本超龄的旧样本。
 * 纯函数：不修改传入的 buf，返回新数组。
 * @param {Array<{tcp: number[], ts: number}>} buf 现有缓冲
 * @param {{tcp: number[], ts: number}} sample 新采样
 * @param {number} maxAgeMs 相对新样本的最大保留时长（毫秒）
 * @returns {Array<{tcp: number[], ts: number}>} 新的缓冲数组
 */
export function pushSample(buf, sample, maxAgeMs) {
  const next = [...buf, sample].filter((s) => sample.ts - s.ts <= maxAgeMs)
  return next
}

/**
 * 提取供 three.js 画线使用的 [x,y,z] 点列。
 * @param {Array<{tcp: number[], ts: number}>} buf 轨迹缓冲
 * @returns {number[][]} [[x,y,z], ...]，保序且不与入参共享引用
 */
export function trajectoryPoints(buf) {
  return buf.map((s) => [s.tcp[0], s.tcp[1], s.tcp[2]])
}

/** 轨迹最旧一端的颜色（暗蓝）。 */
export const TRAJECTORY_OLD_COLOR = Object.freeze([0.12, 0.28, 0.45])

/** 轨迹最新一端的颜色（亮青）。 */
export const TRAJECTORY_NEW_COLOR = Object.freeze([0.35, 0.78, 1])

/**
 * 按样本**新旧**给每个点一个顶点颜色（清单第 18 条：时间渐变）。
 *
 * 单色线看不出"往哪走、多快走"：同一段轨迹里，颜色从暗到亮就同时表达了**方向**与
 * **相对速度**（密集处颜色过渡慢 = 走得慢）。
 *
 * @param {Array<{ts: number}>} buf 轨迹缓冲
 * @param {{oldColor?: number[], newColor?: number[]}} [options]
 * @returns {number[][]} [[r,g,b], ...]，与 `trajectoryPoints` 一一对应
 */
export function trajectoryColors(buf, options = {}) {
  if (!Array.isArray(buf) || buf.length === 0) return []
  const oldColor = Array.isArray(options.oldColor) ? options.oldColor : TRAJECTORY_OLD_COLOR
  const newColor = Array.isArray(options.newColor) ? options.newColor : TRAJECTORY_NEW_COLOR

  const stamps = buf.map((s) => (Number.isFinite(s?.ts) ? s.ts : null))
  const finite = stamps.filter((value) => value !== null)
  // 时间戳全不可用（或只有一个样本）时退化成"按序号渐变"，总比全用同一种颜色好。
  const newest = finite.length > 0 ? Math.max(...finite) : null
  const oldest = finite.length > 0 ? Math.min(...finite) : null
  const span = newest !== null && oldest !== null ? newest - oldest : 0

  return buf.map((sample, index) => {
    let ratio
    if (span > 0 && Number.isFinite(sample?.ts)) {
      ratio = (sample.ts - oldest) / span
    } else {
      // 没有可用时间跨度：按序号线性铺开（单点时 ratio=1，即用最新色）。
      ratio = buf.length <= 1 ? 1 : index / (buf.length - 1)
    }
    ratio = Math.min(1, Math.max(0, ratio))
    return [
      oldColor[0] + (newColor[0] - oldColor[0]) * ratio,
      oldColor[1] + (newColor[1] - oldColor[1]) * ratio,
      oldColor[2] + (newColor[2] - oldColor[2]) * ratio,
    ]
  })
}

/** 导出 CSV 的表头（与 `trajectoryCsv` 的列一一对应）。 */
export const TRAJECTORY_CSV_HEADER = 'ts,tcp_x,tcp_y,tcp_z,j1,j2,j3,j4,j5,j6'

/**
 * 把轨迹导出成 CSV 文本（清单第 18 条：可导出）。
 *
 * 记位置**也记关节角**：只导 TCP 的话，想拿这段数据复现姿态是做不到的。
 * 数值统一用 `toFixed(6)`，避免科学计数法在表格软件里被当成文本。
 *
 * @param {Array<{tcp: number[], q?: number[], ts: number}>} buf 轨迹缓冲
 * @returns {string} CSV 文本（含表头）
 */
export function trajectoryCsv(buf) {
  const rows = [TRAJECTORY_CSV_HEADER]
  if (!Array.isArray(buf)) return rows.join('\n')
  const cell = (value) => (Number.isFinite(value) ? value.toFixed(6) : '')
  for (const sample of buf) {
    const tcp = Array.isArray(sample?.tcp) ? sample.tcp : []
    const q = Array.isArray(sample?.q) ? sample.q : []
    const cells = [
      cell(sample?.ts),
      cell(tcp[0]), cell(tcp[1]), cell(tcp[2]),
      cell(q[0]), cell(q[1]), cell(q[2]), cell(q[3]), cell(q[4]), cell(q[5]),
    ]
    rows.push(cells.join(','))
  }
  return rows.join('\n')
}

/**
 * 从缓冲区尾部取最近 `count` 个样本（导出时用）。
 *
 * @param {Array} buf
 * @param {number} count
 * @returns {Array}
 */
export function trajectoryTail(buf, count) {
  if (!Array.isArray(buf)) return []
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  if (n === 0) return []
  return buf.slice(Math.max(0, buf.length - n))
}

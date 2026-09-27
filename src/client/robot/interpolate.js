// Task 4 — 关节角插值纯函数（纯 ESM，零 import）
// 计划参考实现：docs/superpowers/plans/2026-09-21-ur-digital-twin.md 第 411-423 行

/**
 * 逐元素线性插值。
 * @param {number[]} a 起点关节角（通常长度 6）
 * @param {number[]} b 终点关节角
 * @param {number} alpha 插值系数（0 → a，1 → b）
 * @returns {number[]} 新的关节角数组
 */
export function lerpJoints(a, b, alpha) {
  return a.map((v, i) => v + (b[i] - v) * alpha)
}

/**
 * 按时间在两个采样点之间插值，alpha 钳制到 [0,1]。
 * @param {{q: number[], ts: number}} a 前一个采样
 * @param {{q: number[], ts: number}} b 后一个采样
 * @param {number} nowMs 当前时间戳
 * @returns {number[]} 新的关节角数组（退化跨度时返回 b.q 的副本，不产生 NaN）
 */
export function interpolateAt(a, b, nowMs) {
  const span = b.ts - a.ts
  if (!(span > 0)) return b.q.slice()
  const alpha = Math.min(1, Math.max(0, (nowMs - a.ts) / span))
  return lerpJoints(a.q, b.q, alpha)
}

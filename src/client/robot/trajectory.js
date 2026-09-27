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

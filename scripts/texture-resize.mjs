#!/usr/bin/env node
/**
 * scripts/texture-resize.mjs — 零依赖、跨平台的 PNG 解码 / 重采样 / 编码。
 *
 * ## 为什么手写而不用现成的
 * 选项是 `sharp`（原生模块）、`pngjs`（新依赖）、Python 的 PIL（本机没有）、Windows 的
 * `System.Drawing`（**只在 Windows 上存在**）。前两者要往这个"零第三方依赖"的仓库里塞依赖，
 * 最后一个会让**发布产物无法在 CI/macOS 上重建** —— 本项目的产物都是可重建的
 * （`check-client-bundle.mjs` 就是"重跑构建比哈希"）。所以这里只做真正需要的那一小块：
 * 8 位 PNG（灰度/RGB/调色板/RGBA，非交错）的解码、**缩小**、再编码。
 *
 * ## 缩小的算法选择（不是随手挑的）
 * `2048 → 1024` 恰好是整数倍。整数倍降采样用**块平均**（box/area average）**比双三次更正确**：
 * 双三次是插值，降采样时会漏掉被跳过的像素（aliasing）；块平均把每个 2×2 源像素平均成一个
 * 目标像素，正是"降一半分辨率"应有的语义。非整数倍（例如 2048 → 768）才退回双线性。
 *
 * ## 明确不做
 * - 不放大（`size` 大于源尺寸时原样返回）；
 * - 不支持 16 位、1/2/4 位、Adam7 交错 —— 遇到就返回 `null`，由调用方**跳过并报告**，
 *   绝不猜着写（写坏一张贴图在界面上的表现是"颜色全错"，比体积更糟）。
 */

import { deflateSync, inflateSync } from 'node:zlib'

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** CRC32（PNG 每个 chunk 都要；Node 22+ 有 zlib.crc32，但 engines 允许 Node 20，故自己算）。 */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 每通道字节数 → 通道数（仅支持 8 位，见文件头）。 */
const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/**
 * 解码 8 位非交错 PNG 为 RGBA。
 *
 * @param {Buffer} buf PNG 字节
 * @returns {{width:number,height:number,rgba:Buffer,colorType:number,hadAlpha:boolean}|null}
 *   不支持的格式返回 `null`（调用方跳过，不猜）
 */
export function decodePng(buf) {
  if (buf.length < 8 || !PNG_SIG.equals(buf.subarray(0, 8))) return null

  let offset = 8
  let ihdr = null
  let palette = null
  let transparency = null
  const idat = []
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.subarray(offset + 4, offset + 8).toString('latin1')
    const data = buf.subarray(offset + 8, offset + 8 + len)
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      }
    } else if (type === 'PLTE') palette = Buffer.from(data)
    else if (type === 'tRNS') transparency = Buffer.from(data)
    else if (type === 'IDAT') idat.push(Buffer.from(data))
    else if (type === 'IEND') break
    offset += 12 + len
  }
  if (ihdr === null || idat.length === 0) return null
  // 只支持这一档：8 位、非交错、无自定义压缩/滤波（0 = 标准）
  if (ihdr.bitDepth !== 8 || ihdr.interlace !== 0 || ihdr.compression !== 0 || ihdr.filter !== 0) return null
  const channels = CHANNELS_BY_COLOR_TYPE[ihdr.colorType]
  if (channels === undefined) return null
  if (ihdr.colorType === 3 && palette === null) return null

  const raw = inflateSync(Buffer.concat(idat))
  const stride = ihdr.width * channels
  if (raw.length < (stride + 1) * ihdr.height) return null

  // ── 反滤波（PNG 规范 9.2：每行首字节是滤波类型，其后是滤波后的字节）────────
  const out = Buffer.alloc(stride * ihdr.height)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < ihdr.height; y++) {
    const type = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const line = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      const x = src[i]
      let value
      switch (type) {
        case 0: value = x; break
        case 1: value = x + a; break
        case 2: value = x + b; break
        case 3: value = x + ((a + b) >> 1); break
        case 4: value = x + paeth(a, b, c); break
        default: return null
      }
      line[i] = value & 0xff
    }
    line.copy(out, y * stride)
    prev = line
  }

  // ── 展开成 RGBA ────────────────────────────────────────────────────────────
  const rgba = Buffer.alloc(ihdr.width * ihdr.height * 4)
  let hadAlpha = false
  for (let i = 0, n = ihdr.width * ihdr.height; i < n; i++) {
    let r, g, b, a
    switch (ihdr.colorType) {
      case 0: r = g = b = out[i]; a = 255; break
      case 4: r = g = b = out[i * 2]; a = out[i * 2 + 1]; break
      case 2: r = out[i * 3]; g = out[i * 3 + 1]; b = out[i * 3 + 2]; a = 255; break
      case 6: r = out[i * 4]; g = out[i * 4 + 1]; b = out[i * 4 + 2]; a = out[i * 4 + 3]; break
      case 3: {
        const at = out[i] * 3
        r = palette[at]; g = palette[at + 1]; b = palette[at + 2]
        a = transparency !== null && out[i] < transparency.length ? transparency[out[i]] : 255
        break
      }
      default: return null
    }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a
    if (a !== 255) hadAlpha = true
  }
  return { width: ihdr.width, height: ihdr.height, rgba, colorType: ihdr.colorType, hadAlpha }
}

/** PNG 的 Paeth 预测器。 */
function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/**
 * RGBA 缩放。
 *
 * 整数倍降采样用**块平均**（更正确，见文件头）；否则退化为双线性。**不放大**：目标尺寸
 * 大于源尺寸时原样返回副本。
 *
 * @param {Buffer} rgba 源像素（宽×高×4）
 * @param {number} sw 源宽
 * @param {number} sh 源高
 * @param {number} dw 目标宽
 * @param {number} dh 目标高
 * @returns {Buffer} 目标像素
 */
export function resizeRgba(rgba, sw, sh, dw, dh) {
  if (dw >= sw || dh >= sh) return Buffer.from(rgba)
  const out = Buffer.alloc(dw * dh * 4)
  const exact = sw % dw === 0 && sh % dh === 0
  if (exact) {
    const bw = sw / dw
    const bh = sh / dh
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        let r = 0, g = 0, b = 0, a = 0
        for (let sy = y * bh; sy < (y + 1) * bh; sy++) {
          for (let sx = x * bw; sx < (x + 1) * bw; sx++) {
            const at = (sy * sw + sx) * 4
            r += rgba[at]; g += rgba[at + 1]; b += rgba[at + 2]; a += rgba[at + 3]
          }
        }
        const n = bw * bh
        const to = (y * dw + x) * 4
        out[to] = Math.round(r / n); out[to + 1] = Math.round(g / n)
        out[to + 2] = Math.round(b / n); out[to + 3] = Math.round(a / n)
      }
    }
    return out
  }
  // 双线性：把目标像素中心映射回源坐标，取 4 邻域加权
  for (let y = 0; y < dh; y++) {
    const fy = ((y + 0.5) * sh) / dh - 0.5
    const y0 = Math.max(0, Math.floor(fy))
    const y1 = Math.min(sh - 1, y0 + 1)
    const wy = Math.max(0, Math.min(1, fy - y0))
    for (let x = 0; x < dw; x++) {
      const fx = ((x + 0.5) * sw) / dw - 0.5
      const x0 = Math.max(0, Math.floor(fx))
      const x1 = Math.min(sw - 1, x0 + 1)
      const wx = Math.max(0, Math.min(1, fx - x0))
      const to = (y * dw + x) * 4
      for (let ch = 0; ch < 4; ch++) {
        const p00 = rgba[(y0 * sw + x0) * 4 + ch]
        const p10 = rgba[(y0 * sw + x1) * 4 + ch]
        const p01 = rgba[(y1 * sw + x0) * 4 + ch]
        const p11 = rgba[(y1 * sw + x1) * 4 + ch]
        const top = p00 + (p10 - p00) * wx
        const bottom = p01 + (p11 - p01) * wx
        out[to + ch] = Math.round(top + (bottom - top) * wy)
      }
    }
  }
  return out
}

/** 写一个 PNG chunk（长度 + 类型 + 数据 + CRC）。 */
function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4, 8), data])), 0)
  return Buffer.concat([head, data, crc])
}

/**
 * 把 RGBA 编码为 PNG。
 *
 * 若整张图 alpha 全是 255 就输出色彩类型 2（RGB）—— 每像素少一个字节，压缩后通常小 25% 左右；
 * 否则输出类型 6（RGBA）。每行用"5 种滤波里绝对值和最小"的那一种（PNG 的标准启发式），
 * 这比一律 filter=0 再压要小得多。
 *
 * @param {Buffer} rgba 像素
 * @param {number} width
 * @param {number} height
 * @param {{alpha?: boolean}} [options] 显式指定是否保留 alpha 通道
 * @returns {Buffer} PNG 字节
 */
export function encodePng(rgba, width, height, options = {}) {
  let hasAlpha = options.alpha
  if (hasAlpha === undefined) {
    hasAlpha = false
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { hasAlpha = true; break }
  }
  const channels = hasAlpha ? 4 : 3
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  let prev = Buffer.alloc(stride)
  const candidates = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride))
  for (let y = 0; y < height; y++) {
    const line = Buffer.alloc(stride)
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4
      const to = x * channels
      line[to] = rgba[from]
      line[to + 1] = rgba[from + 1]
      line[to + 2] = rgba[from + 2]
      if (hasAlpha) line[to + 3] = rgba[from + 3]
    }
    let best = 0
    let bestScore = Number.POSITIVE_INFINITY
    for (const type of [0, 1, 2, 3, 4]) {
      const dst = candidates[type]
      let score = 0
      for (let i = 0; i < stride; i++) {
        const a = i >= channels ? line[i - channels] : 0
        const b = prev[i]
        const c = i >= channels ? prev[i - channels] : 0
        let v
        switch (type) {
          case 0: v = line[i]; break
          case 1: v = line[i] - a; break
          case 2: v = line[i] - b; break
          case 3: v = line[i] - ((a + b) >> 1); break
          default: v = line[i] - paeth(a, b, c); break
        }
        v &= 0xff
        dst[i] = v
        score += v < 128 ? v : 256 - v
      }
      if (score < bestScore) { bestScore = score; best = type }
    }
    raw[y * (stride + 1)] = best
    candidates[best].copy(raw, y * (stride + 1) + 1)
    prev = line
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8                     // 位深
  ihdr[9] = hasAlpha ? 6 : 2      // 色彩类型
  ihdr[10] = 0                    // 压缩法
  ihdr[11] = 0                    // 滤波法
  ihdr[12] = 0                    // 非交错
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 高层入口：把一张 PNG 的**最长边**限制到 `maxSize`（只缩不放）。
 *
 * @param {Buffer} png 原 PNG 字节
 * @param {number} maxSize 目标最长边
 * @returns {{data:Buffer,width:number,height:number,sourceWidth:number,sourceHeight:number,
 *            skipped?:string}|null} 不支持/无需缩放/解码失败时返回 `null` 或带 `skipped`
 */
export function shrinkPng(png, maxSize) {
  const decoded = decodePng(png)
  if (decoded === null) return null
  const { width, height, rgba, hadAlpha } = decoded
  const longest = Math.max(width, height)
  if (longest <= maxSize) {
    return { data: png, width, height, sourceWidth: width, sourceHeight: height, skipped: 'already small enough' }
  }
  const scale = maxSize / longest
  const dw = Math.max(1, Math.round(width * scale))
  const dh = Math.max(1, Math.round(height * scale))
  const resized = resizeRgba(rgba, width, height, dw, dh)
  return {
    data: encodePng(resized, dw, dh, { alpha: hadAlpha }),
    width: dw,
    height: dh,
    sourceWidth: width,
    sourceHeight: height,
  }
}

// 直接执行时：对给定的 PNG 文件做一次验证性往返（便于人工检查实现）
if (process.argv[1] && process.argv[1].endsWith('texture-resize.mjs')) {
  const [file, sizeArg] = process.argv.slice(2)
  if (!file) {
    console.log('用法：node scripts/texture-resize.mjs <png> [maxSize]')
    process.exit(2)
  }
  const input = (await import('node:fs')).readFileSync(file)
  const info = decodePng(input)
  if (info === null) { console.error('不支持的 PNG（只支持 8 位非交错）'); process.exit(1) }
  console.log(`源：${info.width}×${info.height}，色彩类型 ${info.colorType}，有透明 ${info.hadAlpha}，${(input.length / 1024).toFixed(0)} KB`)
  const out = shrinkPng(input, Number(sizeArg ?? 1024))
  if (out === null) { console.error('缩放失败'); process.exit(1) }
  console.log(`目标：${out.width}×${out.height}，${(out.data.length / 1024).toFixed(0)} KB${out.skipped ? `（${out.skipped}）` : ''}`)
}

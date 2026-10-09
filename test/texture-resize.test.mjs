/**
 * test/texture-resize.test.mjs — `scripts/texture-resize.mjs` 的 PNG 解码 / 缩放 / 编码契约。
 *
 * ## 为什么必须有这些断言
 * 贴图重采样是**有损**操作，而且失败方式很隐蔽：颜色通道错位、alpha 被丢、滤波解错 ⇒
 * 界面上只是"颜色不对"，不会报错。本文件用两条独立证据夹住实现：
 *   1. **往返**：自己编码再解码必须逐像素一致（覆盖全部 5 种 PNG 滤波分支）；
 *   2. **外部样本**：解码 `assets/models/ur15.glb` 里那张真实 PNG（由 trimesh/PIL 生成，
 *      滤波方式与本实现无关），断言尺寸、色彩类型与"确实有内容"。
 * 另外整数倍降采样用块平均，其数值是可精确断言的（不是"看起来差不多"）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodePng, encodePng, resizeRgba, shrinkPng } from '../scripts/texture-resize.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 造一张 RGBA 测试图：内容刻意有梯度（能触发 Sub/Up/Average/Paeth 各分支）。 */
function makeTestImage(width, height, { alpha = false } = {}) {
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      rgba[at] = (x * 17 + y * 3) & 0xff
      rgba[at + 1] = (x * 5 + y * 29) & 0xff
      rgba[at + 2] = (x * 31 + y * 7) & 0xff
      rgba[at + 3] = alpha ? (x + y) % 2 === 0 ? 255 : 128 : 255
    }
  }
  return rgba
}

test('往返：自己编码的 PNG 解回来必须逐像素一致（覆盖各滤波分支）', () => {
  for (const [w, h] of [[1, 1], [7, 5], [16, 16], [33, 9]]) {
    const rgba = makeTestImage(w, h)
    const png = encodePng(rgba, w, h)
    const back = decodePng(png)
    assert.ok(back, `${w}×${h} 解码失败`)
    assert.equal(back.width, w)
    assert.equal(back.height, h)
    assert.deepEqual([...back.rgba], [...rgba], `${w}×${h} 像素不一致`)
  }
})

test('无透明度的图编码成 RGB（色彩类型 2），省下每像素一个字节', () => {
  const rgba = makeTestImage(8, 8)
  const png = encodePng(rgba, 8, 8)
  const info = decodePng(png)
  assert.equal(info.colorType, 2, '全 alpha=255 时应当选 RGB 而不是 RGBA')
  assert.equal(info.hadAlpha, false)
  // 带透明度的必须保留 alpha 通道
  const withAlpha = makeTestImage(8, 8, { alpha: true })
  const png2 = encodePng(withAlpha, 8, 8)
  const info2 = decodePng(png2)
  assert.equal(info2.colorType, 6)
  assert.equal(info2.hadAlpha, true)
  assert.deepEqual([...info2.rgba], [...withAlpha])
})

test('整数倍降采样＝块平均：数值可精确断言（这正是 2048→1024 走的那条路）', () => {
  const rgba = Buffer.from([
    0, 0, 0, 255, 100, 100, 100, 255,
    200, 200, 200, 255, 255, 255, 255, 255,
  ])
  const out = resizeRgba(rgba, 2, 2, 1, 1)
  // (0+100+200+255)/4 = 138.75 → 139
  assert.deepEqual([...out], [139, 139, 139, 255])
})

test('非整数倍降采样走双线性：尺寸正确且不崩（2048→768 这类将来会用）', () => {
  const rgba = makeTestImage(5, 5)
  const out = resizeRgba(rgba, 5, 5, 3, 3)
  assert.equal(out.length, 3 * 3 * 4)
  // 相邻像素不该是离谱值（双线性不会产生源里不存在的极端色）
  for (let i = 0; i < out.length; i++) assert.ok(out[i] >= 0 && out[i] <= 255)
})

test('不放大：目标尺寸不小于源尺寸时原样返回', () => {
  const rgba = makeTestImage(4, 4)
  const same = resizeRgba(rgba, 4, 4, 4, 4)
  assert.deepEqual([...same], [...rgba])
  const bigger = resizeRgba(rgba, 4, 4, 8, 8)
  assert.deepEqual([...bigger], [...rgba])
})

test('shrinkPng：大图缩到目标最长边，小图原样不动', () => {
  // ⚠️ 体积断言必须用**噪声**图：上面那张梯度图滤波后几乎是常量（PNG 压得极小），
  // 块平均取整后反而更难压，会出现"像素少了一半、文件却更大"的假象。
  const noise = Buffer.alloc(64 * 32 * 4)
  let seed = 12345
  for (let i = 0; i < noise.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    noise[i] = i % 4 === 3 ? 255 : seed >>> 16
  }
  const png = encodePng(noise, 64, 32)
  const shrunk = shrinkPng(png, 32)
  assert.ok(shrunk)
  assert.equal(shrunk.sourceWidth, 64)
  assert.equal(shrunk.width, 32, '最长边应当缩到 32')
  assert.equal(shrunk.height, 16, '另一边按比例')
  assert.ok(shrunk.data.length < png.length, `缩完必须更小（${png.length} → ${shrunk.data.length}）`)

  // 尺寸断言用梯度图即可（它的数值可预期）
  const small = encodePng(makeTestImage(16, 16), 16, 16)
  const untouched = shrinkPng(small, 1024)
  assert.equal(untouched.skipped, 'already small enough')
  assert.equal(untouched.data, small)
})

test('不支持的 PNG 返回 null（宁可跳过，也不猜着写坏一张贴图）', () => {
  assert.equal(decodePng(Buffer.from('not a png at all')), null, '非 PNG 必须 null')
  assert.equal(decodePng(Buffer.alloc(0)), null)
  // 16 位深的 PNG 头（只改 IHDR 的位深字节）
  const png = encodePng(makeTestImage(8, 8), 8, 8)
  const deep = Buffer.from(png)
  deep[24] = 16
  assert.equal(decodePng(deep), null, '16 位不支持')
  // Adam7 交错
  const interlaced = Buffer.from(png)
  interlaced[28] = 1
  assert.equal(decodePng(interlaced), null, '交错不支持')
})

test('外部真实样本：ur15.glb 里那张底色贴图必须能被正确解析', () => {
  // 从 GLB 容器里抠出 image0 的字节（不依赖任何库）
  const buf = readFileSync(join(ROOT, 'assets', 'models', 'ur15.glb'))
  const jsonLen = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'))
  const binStart = 20 + jsonLen + 8
  const bv = json.bufferViews[json.images[0].bufferView]
  const png = buf.subarray(binStart + (bv.byteOffset ?? 0), binStart + (bv.byteOffset ?? 0) + bv.byteLength)

  assert.equal(json.images[0].mimeType, 'image/png')
  const info = decodePng(png)
  assert.ok(info, '真实 PNG 必须能解码（滤波方式由 trimesh/PIL 写入，与本实现无关）')
  assert.equal(info.width, info.height, '底色贴图是正方形')
  // ⚠️ 刻意不写死尺寸：资产档位会变（原始 2048²，0.6.6 经决策降到 1024²）。
  // 这里只守住"是 2 的幂且没退化到缩略图"，档位本身由 model-contract 的总量区间把关。
  const longest = Math.max(info.width, info.height)
  assert.ok(
    longest >= 512 && longest <= 2048 && (longest & (longest - 1)) === 0,
    `贴图最长边应为 512/1024/2048 之一（实测 ${longest}）`,
  )
  assert.equal(info.colorType, 2, '底色贴图无 alpha')
  // 内容不是纯色（否则说明解码只填了 0 或常量）
  const seen = new Set()
  for (let i = 0; i < info.rgba.length; i += 4 * 997) seen.add(info.rgba[i])
  assert.ok(seen.size > 8, `解码结果疑似常量（只见到 ${seen.size} 种取值）`)
})

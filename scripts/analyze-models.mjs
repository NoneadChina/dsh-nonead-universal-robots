#!/usr/bin/env node
/**
 * scripts/analyze-models.mjs — `assets/models/*.glb` 的体积体检（只读，零第三方依赖）。
 *
 * ## 为什么留一个分析脚本（而不是"压完就算了"）
 * 包体积是**发布约束**（发布包几乎全是这 14 个 GLB），而"体积去哪了"每换一次源资产就会变。
 * 加减压缩手段之前先看清楚，才不会做错方向：本仓库实测的真相比直觉反得多 ——
 * **索引占 36.4%**（trimesh 把每个索引都写成 4 字节，而最大索引值只有 24228）、
 * **纹理占 30.4% 且全部来自 5 个新型号**（各一张 2048×2048 PNG），另外 9 个型号的内嵌贴图
 * 只是 16×8 / 32×8 的极小图。这些数字直接决定"该压什么、能压多少"。
 *
 * 输出六节：
 *   1. 每个型号的体积构成（几何 / 索引 / 纹理 / JSON）
 *   2. 几何属性构成（POSITION / TEXCOORD_0 / 非法属性…）
 *   3. 索引可否降到 uint16（逐 primitive 的顶点数与**真实最大索引值**）
 *   4. 纹理详情（内嵌 vs 悬空 uri、PNG/JPEG 真实宽高、bufferView 复用）
 *   5. 顶点属性与材质引用链
 *   6. 未引用的 bufferView（纯浪费的字节）
 *
 * 用法：node scripts/analyze-models.mjs [模型目录]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = process.argv[2] ?? join(ROOT, 'assets', 'models')

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
const COMPONENT_NAME = { 5120: 'int8', 5121: 'uint8', 5122: 'int16', 5123: 'uint16', 5125: 'uint32', 5126: 'float32' }
const KB = (n) => (n / 1024).toFixed(0)
const MB = (n) => (n / 1024 / 1024).toFixed(2)

/** 解析 GLB：返回 { total, json, bin, jsonLen }。 */
function parseGlb(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('不是 GLB（magic 不符）')
  const total = dv.getUint32(8, true)
  let offset = 12
  let json = null
  let bin = Buffer.alloc(0)
  let jsonLen = 0
  while (offset + 8 <= total) {
    const len = dv.getUint32(offset, true)
    const type = dv.getUint32(offset + 4, true)
    const body = offset + 8
    if (type === CHUNK_JSON) { json = JSON.parse(buf.subarray(body, body + len).toString('utf8')); jsonLen = len }
    else if (type === CHUNK_BIN) bin = buf.subarray(body, body + len)
    offset = body + len
  }
  if (json === null) throw new Error('GLB 缺少 JSON chunk')
  return { total, json, bin, jsonLen }
}

const accessorBytes = (acc, bvs) => {
  const stride = bvs[acc.bufferView]?.byteStride
  const elem = COMPONENT_BYTES[acc.componentType] * TYPE_COMPONENTS[acc.type]
  return stride !== undefined ? stride * acc.count : elem * acc.count
}

function readIndex(acc, bvs, bin, i) {
  const bv = bvs[acc.bufferView]
  const at = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0) + i * COMPONENT_BYTES[acc.componentType]
  if (acc.componentType === 5125) return bin.readUInt32LE(at)
  if (acc.componentType === 5123) return bin.readUInt16LE(at)
  return bin.readUInt8(at)
}

/** PNG 的宽高/位深/色彩类型（非 PNG 返回 null）。 */
function pngInfo(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 26 || !sig.every((b, i) => bytes[i] === b)) return null
  if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bitDepth: bytes[24], colorType: bytes[25] }
}

/** JPEG 的宽高。 */
function jpegInfo(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue }
    const marker = bytes[i + 1]
    const len = bytes.readUInt16BE(i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) }
    }
    i += 2 + len
  }
  return null
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.glb')).sort()
const rows = []
const totals = { total: 0, geometry: 0, indices: 0, textures: 0, json: 0 }
const attrTotals = new Map()
const mimeTotals = new Map()
const extUsed = new Set()

for (const name of files) {
  const buf = readFileSync(join(DIR, name))
  const { total, json, bin, jsonLen } = parseGlb(buf)
  const bvs = json.bufferViews ?? []
  const accs = json.accessors ?? []
  const images = json.images ?? []
  const textures = json.textures ?? []
  const materials = json.materials ?? []

  let geometry = 0
  let indices = 0
  let verts = 0
  let tris = 0
  let maxVertPerPrim = 0
  let maxIndex = 0
  const indexComponents = new Set()
  const attrs = new Set()
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      for (const [attr, idx] of Object.entries(prim.attributes ?? {})) {
        const bytes = accessorBytes(accs[idx], bvs)
        geometry += bytes
        attrs.add(attr)
        attrTotals.set(attr, (attrTotals.get(attr) ?? 0) + bytes)
        if (attr === 'POSITION') { verts += accs[idx].count; maxVertPerPrim = Math.max(maxVertPerPrim, accs[idx].count) }
      }
      if (prim.indices !== undefined) {
        const ia = accs[prim.indices]
        indices += accessorBytes(ia, bvs)
        indexComponents.add(COMPONENT_NAME[ia.componentType])
        tris += ia.count / 3
        for (let i = 0; i < ia.count; i++) { const v = readIndex(ia, bvs, bin, i); if (v > maxIndex) maxIndex = v }
      }
    }
  }

  const imageDetail = []
  let textureBytes = 0
  for (const img of images) {
    if (img.bufferView === undefined) {
      imageDetail.push(`uri=${img.uri?.startsWith('data:') ? 'data-uri' : img.uri}`)
      continue
    }
    const bv = bvs[img.bufferView]
    const bytes = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)
    const info = pngInfo(bytes) ?? jpegInfo(bytes)
    textureBytes += bv.byteLength
    mimeTotals.set(img.mimeType ?? '?', (mimeTotals.get(img.mimeType ?? '?') ?? 0) + bv.byteLength)
    const dim = info ? `${info.width}×${info.height}` : '未知格式'
    imageDetail.push(`${dim}/${bv.byteLength}B`)
  }
  for (const e of json.extensionsUsed ?? []) extUsed.add(e)

  const materialRefs = materials.map((m) => {
    const p = m.pbrMetallicRoughness ?? {}
    const tex = []
    if (p.baseColorTexture) tex.push('baseColor')
    if (p.metallicRoughnessTexture) tex.push('metalRough')
    if (m.normalTexture) tex.push('normal')
    if (m.occlusionTexture) tex.push('occlusion')
    if (m.emissiveTexture) tex.push('emissive')
    const img = p.baseColorTexture ? textures[p.baseColorTexture.index]?.source : undefined
    return `${tex.join('+') || '无贴图'}${img === undefined ? '' : `→img${img}`}`
  }).join(' ')

  const usedBv = new Set()
  for (const acc of accs) if (acc.bufferView !== undefined) usedBv.add(acc.bufferView)
  for (const img of images) if (img.bufferView !== undefined) usedBv.add(img.bufferView)
  let waste = 0
  let wasteN = 0
  for (let i = 0; i < bvs.length; i++) if (!usedBv.has(i)) { waste += bvs[i].byteLength; wasteN += 1 }

  rows.push({
    name, total, geometry, indices, textures: textureBytes, json: jsonLen,
    verts, tris, maxVertPerPrim, maxIndex, indexComponents: [...indexComponents].join('/'),
    attrs: [...attrs].join(','), materialRefs, imageDetail, waste, wasteN,
  })
  totals.total += total
  totals.geometry += geometry
  totals.indices += indices
  totals.textures += textureBytes
  totals.json += jsonLen
}

console.log('=== 1. 体积构成（KB）===')
console.log('型号'.padEnd(12), '总'.padStart(7), '几何'.padStart(7), '索引'.padStart(7), '纹理'.padStart(7), 'JSON'.padStart(6), '顶点'.padStart(8), '三角'.padStart(8))
for (const r of rows) {
  console.log(r.name.padEnd(12), KB(r.total).padStart(7), KB(r.geometry).padStart(7), KB(r.indices).padStart(7), KB(r.textures).padStart(7), KB(r.json).padStart(6), String(r.verts).padStart(8), String(Math.round(r.tris)).padStart(8))
}
console.log('')
for (const [k, v] of Object.entries(totals)) console.log(`  ${k.padEnd(9)} ${MB(v).padStart(6)} MB  ${((v / totals.total) * 100).toFixed(1)}%`)
console.log(`  合计      ${MB(totals.total).padStart(6)} MB`)
console.log('')
console.log('=== 2. 几何属性构成 ===')
for (const [k, v] of [...attrTotals.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${MB(v).padStart(6)} MB  ${((v / totals.geometry) * 100).toFixed(1)}% of 几何`)
console.log('')
console.log('=== 3. 索引可否降到 uint16 ===')
for (const r of rows) console.log(`  ${r.name.padEnd(11)} 单 primitive 最大顶点=${String(r.maxVertPerPrim).padStart(6)} 最大索引值=${String(r.maxIndex).padStart(6)} 类型=${r.indexComponents}`)
const worst = rows.reduce((a, b) => (b.maxIndex > a.maxIndex ? b : a))
console.log(`  ⇒ 全局最大索引值 ${worst.maxIndex}（${worst.name}）`)
console.log(`     ${worst.maxIndex <= 65535 ? '★ 全部可降到 uint16：索引字节减半，完全无损' : '存在 >65535 的索引：需保留 uint32 或先拆 primitive'}`)
console.log('')
console.log('=== 4. 纹理详情（内嵌尺寸 / 悬空 uri）===')
for (const r of rows) {
  const embedded = r.imageDetail.filter((d) => !d.startsWith('uri='))
  const uri = r.imageDetail.filter((d) => d.startsWith('uri='))
  console.log(`  ${r.name.padEnd(11)} ${KB(r.textures).padStart(5)} KB  内嵌 ${embedded.length} 张：${embedded.slice(0, 4).join(' ')}${uri.length > 0 ? `  ${uri.length} 张 ${uri[0]}` : ''}`)
}
console.log('')
console.log('=== 5. 顶点属性与材质 ===')
for (const r of rows) console.log(`  ${r.name.padEnd(11)} 属性=${r.attrs}\n  ${' '.repeat(11)} 材质=${r.materialRefs}`)
console.log('')
console.log('=== 6. 未引用 bufferView（浪费）===')
let totalWaste = 0
for (const r of rows) if (r.wasteN > 0) { totalWaste += r.waste; console.log(`  ${r.name.padEnd(11)} ${r.wasteN} 个 / ${KB(r.waste)} KB`) }
console.log(totalWaste === 0 ? '  （无）' : `  合计 ${KB(totalWaste)} KB`)
console.log('')
console.log(`内嵌纹理 mimeType：${[...mimeTotals.entries()].map(([k, v]) => `${k}=${MB(v)}MB`).join('  ') || '（无）'}`)
console.log(`extensionsUsed：${[...extUsed].join(', ') || '（无）'}`)

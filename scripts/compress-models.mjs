#!/usr/bin/env node
/**
 * scripts/compress-models.mjs — 给 `assets/models/*.glb` 做**不改变视觉**的瘦身。
 *
 * ## 为什么需要
 * 发布包约 21 MB，几乎全是这 14 个 GLB（未压缩前 35.11 MB）。实测（`scripts/analyze-models.mjs`）体积构成：
 *   索引 12.78 MB（36.4%）+ 几何 11.78 MB（33.6%）+ 纹理 10.67 MB（30.4%）
 * 其中两处是**白扔的字节**：
 *   1. trimesh 把**所有**索引都写成 `UNSIGNED_INT`（4 字节/索引），而这 14 个型号里
 *      最大的索引值只有 24228 —— `UNSIGNED_SHORT`（2 字节）完全够用。索引值本身不变，
 *      GPU 解出来的三角形一模一样 ⇒ 这一项是 6.39 MB 的**纯浪费**。
 *   2. 每个 primitive 都带一个 `_color` 顶点属性（541 KB）。它不是 glTF 标准属性名
 *      （标准是 `COLOR_0`），three.js 的 `GLTFLoader` 会把它塞进 `geometry.attributes._color`
 *      而**没有任何材质会去读它**（本插件的材质来自 PBR baseColor）⇒ 纯显存与带宽浪费。
 *
 * 本脚本**只做这两件事**，外加把 BIN 里因此出现的空洞回收掉：
 *   - 索引 `uint32` → `uint16`（仅当最大索引值 ≤ 65535，否则原样保留并报告）；
 *   - 删除 `_color` 属性（`COLOR_0` 若出现则**保留** —— 那是标准属性，别乱删）；
 *   - 重建紧凑的 BIN + bufferView 表（未引用的 bufferView 直接丢弃）。
 *
 * ## 明确不做（以及为什么）
 * - **不抽稀、不改变顶点位置/UV/法线**：`test/model-contract.test.mjs` 与 Ruling 24 要求
 *   全量原始精度；压缩后 POSITION 与 TEXCOORD_0 的字节流必须**逐字节相同**（脚本自证）。
 * - **不做 Draco / meshopt**：客户端用 three 的 `GLTFLoader`（未注册解码器），引入解码器
 *   等于改客户端加载路径 + 多托管一个 wasm 文件，代价远大于收益。
 * - **不做 KHR_mesh_quantization**：位置量化要靠 node 的 scale/translate 补偿，而
 *   `loader.js` 的 `applyLinksToGroups()` 每帧往这 7 个组的 `matrix` 写**绝对**变换，
 *   会把补偿覆盖掉 ⇒ 手臂会错位。这条要动渲染路径，另案评估。
 * - **不重编码纹理**：那是**有损**取舍（观感下降），必须由人决定；本脚本只报告可省多少。
 *
 * ## 用法
 *   node scripts/compress-models.mjs --dry-run          # 只报告，不写盘（默认也是 dry-run）
 *   node scripts/compress-models.mjs --write            # 原地重写 assets/models/*.glb（无损）
 *   node scripts/compress-models.mjs --write --only ur3 ur5e
 *   node scripts/compress-models.mjs --check            # 只校验现有 GLB 的不变式（不压缩）
 *   node scripts/compress-models.mjs --write --texture-size 1024   # ⚠️ 有损：贴图最长边降到 1024
 *
 * `--texture-size` 是**唯一的有损开关**，默认关闭。它把"最长边超过 N"的内嵌 PNG 用块平均
 * 降到 N（`scripts/texture-resize.mjs`，零依赖、跨平台），并如实报告每张图的前后尺寸与字节；
 * 顶点位置、UV、索引序列**照旧逐字节/逐值不变**，贴图张数与引用链也不变。
 *
 * 写盘是**原地**的，但先写同目录临时文件再原子替换；文件都已被 git 跟踪，
 * 回滚就是 `git checkout -- assets/models`。
 */
import { readFileSync, writeFileSync, readdirSync, renameSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodePng, shrinkPng } from './texture-resize.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_DIR = join(ROOT, 'assets', 'models')

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942
const GL_UNSIGNED_SHORT = 5123
const GL_UNSIGNED_INT = 5125
const TARGET_ARRAY_BUFFER = 34962
const TARGET_ELEMENT_ARRAY_BUFFER = 34963

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }

const args = process.argv.slice(2)
const WRITE = args.includes('--write')
const CHECK_ONLY = args.includes('--check')
const onlyAt = args.indexOf('--only')
const ONLY = onlyAt === -1 ? null : args.slice(onlyAt + 1).filter((a) => !a.startsWith('--'))
const dirAt = args.indexOf('--dir')
const DIR = dirAt === -1 ? DEFAULT_DIR : args[dirAt + 1]
/** 有损开关：贴图最长边上限（未给出 = 不动贴图）。 */
const texAt = args.indexOf('--texture-size')
const TEXTURE_SIZE = texAt === -1 ? undefined : Number(args[texAt + 1])
if (texAt !== -1 && (!Number.isFinite(TEXTURE_SIZE) || TEXTURE_SIZE <= 0)) {
  console.error('--texture-size 需要一个正整数（例如 1024）')
  process.exit(2)
}

/**
 * 解析 GLB。
 *
 * @returns {{version:number,total:number,json:object,bin:Buffer,jsonLen:number}}
 */
export function parseGlb(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('不是 GLB（magic 不符）')
  const version = dv.getUint32(4, true)
  const total = dv.getUint32(8, true)
  if (total > buf.byteLength) throw new Error(`GLB 头声明长度 ${total} 超过实际 ${buf.byteLength}`)
  let offset = 12
  let json = null
  let bin = Buffer.alloc(0)
  let jsonLen = 0
  while (offset + 8 <= total) {
    const len = dv.getUint32(offset, true)
    const type = dv.getUint32(offset + 4, true)
    const body = offset + 8
    if (body + len > buf.byteLength) throw new Error(`chunk 越界（offset=${offset} len=${len}）`)
    if (type === CHUNK_JSON) { json = JSON.parse(buf.subarray(body, body + len).toString('utf8')); jsonLen = len }
    else if (type === CHUNK_BIN) bin = buf.subarray(body, body + len)
    offset = body + len
  }
  if (json === null) throw new Error('GLB 缺少 JSON chunk')
  return { version, total, json, bin, jsonLen }
}

/** accessor 的元素字节数（不含 byteStride）。 */
function elementBytes(acc) {
  return COMPONENT_BYTES[acc.componentType] * TYPE_COMPONENTS[acc.type]
}

/** accessor 实际跨越的字节数（有 byteStride 时按 stride）。 */
function accessorSpan(acc, bvs) {
  const stride = bvs[acc.bufferView]?.byteStride
  return (stride !== undefined ? stride * (acc.count - 1) + elementBytes(acc) : elementBytes(acc) * acc.count)
}

/** 取 accessor 覆盖的原始字节（用于逐字节自证）。 */
function accessorSlice(acc, bvs, bin) {
  const bv = bvs[acc.bufferView]
  const start = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  return bin.subarray(start, start + accessorSpan(acc, bvs))
}

/** 读出 accessor 的整数序列（用于求最大索引并自证）。 */
function readIndices(acc, bvs, bin) {
  const out = new Uint32Array(acc.count)
  const bv = bvs[acc.bufferView]
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const stride = bv.byteStride ?? COMPONENT_BYTES[acc.componentType]
  for (let i = 0; i < acc.count; i++) {
    const at = base + i * stride
    if (acc.componentType === GL_UNSIGNED_INT) out[i] = bin.readUInt32LE(at)
    else if (acc.componentType === GL_UNSIGNED_SHORT) out[i] = bin.readUInt16LE(at)
    else if (acc.componentType === 5121) out[i] = bin.readUInt8(at)
    else out[i] = bin.readUInt16LE(at)
  }
  return out
}

/** 4 字节向上取整。 */
const align4 = (n) => (n + 3) & ~3

/**
 * 压缩一个 GLB 文档。
 *
 * @param {Buffer} buf 原件
 * @param {{textureSize?: number}} [options] `textureSize` 是**唯一的有损开关**（贴图最长边上限）
 * @returns {{out: Buffer, report: object}}
 */
export function compressGlb(buf, options = {}) {
  const textureSize = options.textureSize
  const { json, bin, jsonLen } = parseGlb(buf)
  const bvs = json.bufferViews ?? []
  const accs = json.accessors ?? []
  const report = {
    before: buf.byteLength, after: 0, indexBefore: 0, indexAfter: 0,
    droppedColor: 0, droppedAccessors: 0, droppedBufferViews: 0, indexKeptU32: 0, maxIndex: 0, changed: false,
    /** 被缩放的贴图：[{from,to,before,after}]；跳过/不支持的记在 textureIssues。 */
    textures: [], textureIssues: [], textureBytesBefore: 0, textureBytesAfter: 0,
  }

  // ── 第 1 步：删掉 `_color` 属性（非标准名，没有任何材质读它）──────────────
  // ⚠️ 只从这里删是不够的：它的 accessor 还在 `json.accessors` 里，第 3 步的"沿用原字节"
  // 会把那份数据原样搬进新 BIN —— 文件照旧那么大，只是多了一堆没人引用的垃圾。
  // 所以紧接着第 2 步必须把**未被引用的 accessor 整体删掉**（连带它的数据）。
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      for (const key of Object.keys(prim.attributes ?? {})) {
        if (key !== '_color') continue
        report.droppedColor += accessorSpan(accs[prim.attributes[key]], bvs)
        delete prim.attributes[key]
      }
    }
  }

  // ── 第 2 步：删除未被任何 primitive 引用的 accessor（并重映射引用）────────
  // 保守边界：morph target / skin / animation 也会引用 accessor，这 14 个模型没有，
  // 但真出现了就整体跳过这一步（宁可少省几百 KB，也不要制造悬空引用）。
  const hasExoticRefs = (json.animations?.length ?? 0) > 0
    || (json.skins?.length ?? 0) > 0
    || (json.meshes ?? []).some((m) => (m.primitives ?? []).some((p) => (p.targets ?? []).length > 0))
  if (!hasExoticRefs) {
    const usedAcc = new Set()
    for (const mesh of json.meshes ?? []) {
      for (const prim of mesh.primitives ?? []) {
        for (const idx of Object.values(prim.attributes ?? {})) usedAcc.add(idx)
        if (prim.indices !== undefined) usedAcc.add(prim.indices)
      }
    }
    if (usedAcc.size !== accs.length) {
      const accMap = new Map()
      const kept = []
      for (let i = 0; i < accs.length; i++) {
        if (!usedAcc.has(i)) continue
        accMap.set(i, kept.length)
        kept.push(accs[i])
      }
      for (const mesh of json.meshes ?? []) {
        for (const prim of mesh.primitives ?? []) {
          for (const key of Object.keys(prim.attributes ?? {})) prim.attributes[key] = accMap.get(prim.attributes[key])
          if (prim.indices !== undefined) prim.indices = accMap.get(prim.indices)
        }
      }
      report.droppedAccessors = accs.length - kept.length
      json.accessors = kept
      accs.length = 0
      accs.push(...kept) // 下面各步继续用同一个数组对象（新索引）
    }
  }

  // ── 第 3 步：规划索引降位（uint32 → uint16）──────────────────────────────
  /** accessor 索引 → { kind:'indices16', data, values }。 */
  const plan = new Map()
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      if (prim.indices === undefined) continue
      const ia = accs[prim.indices]
      const span = accessorSpan(ia, bvs)
      report.indexBefore += span
      if (ia.componentType === GL_UNSIGNED_INT) {
        const values = readIndices(ia, bvs, bin)
        let max = 0
        for (const v of values) if (v > max) max = v
        if (max > report.maxIndex) report.maxIndex = max
        if (max <= 65535) {
          const data = Buffer.alloc(align4(values.length * 2))
          for (let i = 0; i < values.length; i++) data.writeUInt16LE(values[i], i * 2)
          plan.set(prim.indices, { kind: 'indices16', data, values })
          report.indexAfter += values.length * 2
          continue
        }
        report.indexKeptU32 += 1
      }
      report.indexAfter += span
    }
  }

  // ── 重建 BIN：只保留仍被引用的数据，紧凑排列 ─────────────────────────────
  const chunks = [] // { bytes:Buffer, bufferView:object, remap: [{acc|image, oldByteOffset}] }
  let cursor = 0
  const newBufferViews = []
  const usedBv = new Set()
  /** 旧 bufferView 索引 → 新 bufferView 索引（同一份数据被多处引用时共享）。 */
  const bvMap = new Map()

  /** 为一个旧 bufferView 建立新块（同一旧 bv 只建一次，保持共享/交错语义）。 */
  function placeBufferView(oldIndex, forceTarget) {
    if (bvMap.has(oldIndex)) return bvMap.get(oldIndex)
    const bv = bvs[oldIndex]
    if (bv === undefined) throw new Error(`引用了不存在的 bufferView ${oldIndex}`)
    const start = bv.byteOffset ?? 0
    const bytes = bin.subarray(start, start + bv.byteLength)
    const newIndex = newBufferViews.length
    // 顶点数据按 4 字节对齐；索引按 2 字节（用 4 更简单也无害）；image 无要求。
    const pad = 4 - (cursor % 4)
    if (pad !== 4) { chunks.push(Buffer.alloc(pad)); cursor += pad }
    const target = forceTarget ?? bv.target
    newBufferViews.push({
      buffer: 0,
      byteOffset: cursor,
      byteLength: bytes.length,
      ...(target === undefined ? {} : { target }),
      ...(bv.byteStride === undefined ? {} : { byteStride: bv.byteStride }),
      ...(bv.name === undefined ? {} : { name: bv.name }),
    })
    chunks.push(bytes)
    cursor += bytes.length
    bvMap.set(oldIndex, newIndex)
    usedBv.add(oldIndex)
    return newIndex
  }

  // 1) 索引：降位的那批写新数据；其余沿用原 bufferView
  for (const [accIndex, action] of plan) {
    if (action.kind !== 'indices16') continue
    const pad = 4 - (cursor % 4)
    if (pad !== 4) { chunks.push(Buffer.alloc(pad)); cursor += pad }
    const newIndex = newBufferViews.length
    newBufferViews.push({ buffer: 0, byteOffset: cursor, byteLength: action.values.length * 2, target: TARGET_ELEMENT_ARRAY_BUFFER })
    chunks.push(action.data.subarray(0, action.values.length * 2))
    cursor += action.values.length * 2
    const acc = accs[accIndex]
    acc.bufferView = newIndex
    acc.byteOffset = 0
    acc.componentType = GL_UNSIGNED_SHORT
    delete acc.byteStride // accessor 级 byteStride 只在交错时需要；新块是紧密的
  }

  // 2) 其余 accessor：沿用原 bufferView（保持交错布局不变）
  for (const [accIndex, acc] of accs.entries()) {
    if (plan.get(accIndex)?.kind === 'indices16') continue
    if (acc.bufferView === undefined) continue
    acc.bufferView = placeBufferView(acc.bufferView)
  }
  // 3) 纹理：默认沿用原 bufferView（共享关系保留）；给出 `textureSize` 时把过大的贴图
  //    **重采样后换成新块**（旧块若不再被引用会被自动丢弃，体积才真正回收）。
  for (const img of json.images ?? []) {
    if (img.bufferView === undefined) continue
    const bv = bvs[img.bufferView]
    const bytes = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)
    report.textureBytesBefore += bv.byteLength
    if (textureSize === undefined) {
      img.bufferView = placeBufferView(img.bufferView)
      report.textureBytesAfter += bv.byteLength
      continue
    }
    const shrunk = shrinkPng(bytes, textureSize)
    if (shrunk === null) {
      // 不支持的 PNG（16 位/交错/异常）：**跳过并报告**，绝不猜着写
      report.textureIssues.push(`无法解码（保留原图，${bv.byteLength} 字节）`)
      img.bufferView = placeBufferView(img.bufferView)
      report.textureBytesAfter += bv.byteLength
      continue
    }
    if (shrunk.skipped !== undefined || shrunk.data === bytes) {
      img.bufferView = placeBufferView(img.bufferView)
      report.textureBytesAfter += bv.byteLength
      continue
    }
    const pad = 4 - (cursor % 4)
    if (pad !== 4) { chunks.push(Buffer.alloc(pad)); cursor += pad }
    const newIndex = newBufferViews.length
    newBufferViews.push({ buffer: 0, byteOffset: cursor, byteLength: shrunk.data.length })
    chunks.push(shrunk.data)
    cursor += shrunk.data.length
    img.bufferView = newIndex
    report.textures.push({
      from: `${shrunk.sourceWidth}×${shrunk.sourceHeight}`,
      to: `${shrunk.width}×${shrunk.height}`,
      before: bv.byteLength,
      after: shrunk.data.length,
    })
    report.textureBytesAfter += shrunk.data.length
  }

  report.droppedBufferViews = bvs.length - usedBv.size
  // 被丢弃的 bufferView 字节（`_color` 之外的空洞）
  let droppedBytes = 0
  for (let i = 0; i < bvs.length; i++) if (!usedBv.has(i)) droppedBytes += bvs[i].byteLength
  report.droppedBufferViewsBytes = droppedBytes

  json.bufferViews = newBufferViews
  const newBin = Buffer.concat(chunks)
  if (json.buffers?.length) json.buffers[0].byteLength = newBin.length

  // ── 写回 GLB（两个 chunk 各自 4 字节对齐：JSON 用空格、BIN 用 0）──────────
  const jsonText = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = (4 - (jsonText.length % 4)) % 4
  const jsonChunk = Buffer.concat([jsonText, Buffer.alloc(jsonPad, 0x20)])
  const binPad = (4 - (newBin.length % 4)) % 4
  const binChunk = Buffer.concat([newBin, Buffer.alloc(binPad)])
  const total = 12 + 8 + jsonChunk.length + (binChunk.length > 0 ? 8 + binChunk.length : 0)
  const outBuf = Buffer.alloc(total)
  outBuf.writeUInt32LE(GLB_MAGIC, 0)
  outBuf.writeUInt32LE(2, 4)
  outBuf.writeUInt32LE(total, 8)
  outBuf.writeUInt32LE(jsonChunk.length, 12)
  outBuf.writeUInt32LE(CHUNK_JSON, 16)
  jsonChunk.copy(outBuf, 20)
  if (binChunk.length > 0) {
    const at = 20 + jsonChunk.length
    outBuf.writeUInt32LE(binChunk.length, at)
    outBuf.writeUInt32LE(CHUNK_BIN, at + 4)
    binChunk.copy(outBuf, at + 8)
  }
  report.after = total
  report.jsonBefore = jsonLen
  report.changed = total !== buf.byteLength || report.droppedColor > 0 || report.droppedBufferViews > 0
  return { out: outBuf, report }
}

/**
 * 自证：压缩前后的**几何与索引必须逐字节/逐值等价**，节点与纹理契约不变。
 *
 * 这是本脚本存在的意义 —— 一个"看起来更小"的 GLB 如果顶点错位，界面上只会静默散架。
 *
 * @param {Buffer} before 原件
 * @param {Buffer} after 压缩件
 * @param {{textureSize?: number}} [options] 给出 `textureSize` 时允许**贴图**变化，
 *   但仍然校验：张数与内嵌关系不变、mimeType 不变、未超限的贴图必须字节不变、
 *   超限贴图的新尺寸必须等于上限且宽高比与源一致。
 * @returns {string[]} 问题列表（空 = 通过）
 */
export function verifyEquivalent(before, after, options = {}) {
  const problems = []
  const A = parseGlb(before)
  const B = parseGlb(after)
  const aBv = A.json.bufferViews ?? []
  const bBv = B.json.bufferViews ?? []
  const aAcc = A.json.accessors ?? []
  const bAcc = B.json.accessors ?? []

  // 节点名与顺序（客户端按名字装配，model-contract 也这么断言）
  const names = (doc) => (doc.json.nodes ?? []).map((n) => n.name)
  if (JSON.stringify(names(A)) !== JSON.stringify(names(B))) problems.push('节点名/顺序变了')
  if ((A.json.meshes ?? []).length !== (B.json.meshes ?? []).length) problems.push('网格数变了')

  // 每个 primitive 的每个属性：POSITION / TEXCOORD_0 必须字节相同；
  // _color 允许消失；其它属性必须在且字节相同。
  for (const [mi, meshA] of (A.json.meshes ?? []).entries()) {
    const meshB = (B.json.meshes ?? [])[mi]
    if (!meshB) { problems.push(`mesh[${mi}] 缺失`); continue }
    for (const [pi, primA] of (meshA.primitives ?? []).entries()) {
      const primB = (meshB.primitives ?? [])[pi]
      if (!primB) { problems.push(`mesh[${mi}].prim[${pi}] 缺失`); continue }
      for (const [key, idxA] of Object.entries(primA.attributes ?? {})) {
        const idxB = primB.attributes?.[key]
        if (idxB === undefined) {
          if (key === '_color') continue // 唯一允许被删的属性
          problems.push(`mesh[${mi}].prim[${pi}] 属性 ${key} 丢了`)
          continue
        }
        const sa = accessorSlice(aAcc[idxA], aBv, A.bin)
        const sb = accessorSlice(bAcc[idxB], bBv, B.bin)
        if (!sa.equals(sb)) problems.push(`mesh[${mi}].prim[${pi}] 属性 ${key} 的字节变了（${sa.length} vs ${sb.length}）`)
        // accessor 元数据与 min/max 必须保留（model-contract 断言 POSITION 有 min/max）
        for (const field of ['componentType', 'type', 'count', 'normalized']) {
          if ((aAcc[idxA][field] ?? null) !== (bAcc[idxB][field] ?? null)) {
            problems.push(`mesh[${mi}].prim[${pi}] 属性 ${key} 的 ${field} 变了`)
          }
        }
        if (JSON.stringify(aAcc[idxA].min) !== JSON.stringify(bAcc[idxB].min)) problems.push(`mesh[${mi}].prim[${pi}] 属性 ${key} 的 min 变了`)
        if (JSON.stringify(aAcc[idxA].max) !== JSON.stringify(bAcc[idxB].max)) problems.push(`mesh[${mi}].prim[${pi}] 属性 ${key} 的 max 变了`)
      }
      // 索引：数值序列必须逐一相等（宽度可以从 uint32 降到 uint16）
      if (primA.indices !== undefined) {
        if (primB.indices === undefined) { problems.push(`mesh[${mi}].prim[${pi}] 索引丢了`); continue }
        const ia = aAcc[primA.indices]
        const ib = bAcc[primB.indices]
        const va = readIndices(ia, aBv, A.bin)
        const vb = readIndices(ib, bBv, B.bin)
        if (va.length !== vb.length) problems.push(`mesh[${mi}].prim[${pi}] 索引数量变了`)
        else for (let i = 0; i < va.length; i++) {
          if (va[i] !== vb[i]) { problems.push(`mesh[${mi}].prim[${pi}] 索引[${i}] ${va[i]} → ${vb[i]}`); break }
        }
        if (![GL_UNSIGNED_SHORT, GL_UNSIGNED_INT].includes(ib.componentType)) problems.push(`索引 componentType 非法：${ib.componentType}`)
      }
    }
  }

  // 纹理：张数与内嵌关系必须不变。默认（无损）时字节也必须不变；给了 `textureSize`
  // 则只允许"超过上限的那些"变，而且新尺寸与宽高比必须符合预期。
  const textureSize = options.textureSize
  if ((A.json.images ?? []).length !== (B.json.images ?? []).length) problems.push('贴图数量变了')
  for (const [i, imgB] of (B.json.images ?? []).entries()) {
    if (imgB.bufferView === undefined) { problems.push(`image[${i}] 不再内嵌`); continue }
    const imgA = A.json.images[i]
    if ((imgA.mimeType ?? null) !== (imgB.mimeType ?? null)) problems.push(`image[${i}] mimeType 变了`)
    const sa = A.bin.subarray(aBv[imgA.bufferView].byteOffset ?? 0, (aBv[imgA.bufferView].byteOffset ?? 0) + aBv[imgA.bufferView].byteLength)
    const sb = B.bin.subarray(bBv[imgB.bufferView].byteOffset ?? 0, (bBv[imgB.bufferView].byteOffset ?? 0) + bBv[imgB.bufferView].byteLength)
    if (textureSize === undefined) {
      if (!sa.equals(sb)) problems.push(`image[${i}] 的字节变了`)
      continue
    }
    const src = decodePng(sa)
    if (src === null) {
      // 本实现不支持的 PNG 会被原样保留 —— 那就必须逐字节相同
      if (!sa.equals(sb)) problems.push(`image[${i}] 声明不支持却仍被改写`)
      continue
    }
    if (Math.max(src.width, src.height) <= textureSize) {
      if (!sa.equals(sb)) problems.push(`image[${i}] 未超上限却被改写`)
      continue
    }
    const out = decodePng(sb)
    if (out === null) { problems.push(`image[${i}] 缩放结果不是可解码的 PNG`); continue }
    if (Math.max(out.width, out.height) !== textureSize) {
      problems.push(`image[${i}] 缩放后最长边 ${Math.max(out.width, out.height)} ≠ ${textureSize}`)
    }
    const ratioSrc = src.width / src.height
    const ratioOut = out.width / out.height
    if (Math.abs(ratioSrc - ratioOut) / ratioSrc > 0.01) {
      problems.push(`image[${i}] 宽高比变了（${ratioSrc.toFixed(4)} → ${ratioOut.toFixed(4)}）`)
    }
  }

  // 每个 bufferView 必须落在 buffer 内（越界会在运行时炸）
  for (const [i, bv] of bBv.entries()) {
    if ((bv.byteOffset ?? 0) + bv.byteLength > B.bin.length) problems.push(`bufferView[${i}] 越界`)
    if ((bv.byteOffset ?? 0) % 4 !== 0) problems.push(`bufferView[${i}] 未按 4 字节对齐（offset=${bv.byteOffset}）`)
  }
  return problems
}

/* ────────────────────────────────────────────────────────────────────────────
 * CLI
 * ──────────────────────────────────────────────────────────────────────────── */
function main() {
  let files = readdirSync(DIR).filter((f) => f.endsWith('.glb')).sort()
  if (ONLY !== null && ONLY.length > 0) files = files.filter((f) => ONLY.includes(f.replace(/\.glb$/, '')))
  if (files.length === 0) { console.error(`没有找到 GLB：${DIR}`); process.exit(2) }

  let totalBefore = 0
  let totalAfter = 0
  let failed = 0
  const options = TEXTURE_SIZE === undefined ? {} : { textureSize: TEXTURE_SIZE }
  console.log(`目录 ${DIR}`)
  console.log(`模式 ${CHECK_ONLY ? '只校验' : WRITE ? '压缩并写盘' : '压缩（dry-run，不写盘）'}${TEXTURE_SIZE === undefined ? '（无损）' : ` + 贴图降到 ${TEXTURE_SIZE}（⚠️ 有损）`}`)
  console.log('')
  console.log('型号'.padEnd(12), '压缩前'.padStart(9), '压缩后'.padStart(9), '省'.padStart(9), '索引前'.padStart(9), '索引后'.padStart(9), '贴图前'.padStart(9), '贴图后'.padStart(9), '备注')
  for (const name of files) {
    const path = join(DIR, name)
    const buf = readFileSync(path)
    totalBefore += buf.byteLength
    let out = buf
    let report = { before: buf.byteLength, after: buf.byteLength, indexBefore: 0, indexAfter: 0, droppedColor: 0, droppedBufferViews: 0, indexKeptU32: 0, maxIndex: 0, changed: false, droppedBufferViewsBytes: 0, textures: [], textureIssues: [], textureBytesBefore: 0, textureBytesAfter: 0 }
    try {
      if (!CHECK_ONLY) {
        const r = compressGlb(buf, options)
        out = r.out
        report = r.report
        const problems = verifyEquivalent(buf, out, options)
        if (problems.length > 0) {
          failed += 1
          console.log(`  ✖ ${name} 自证失败：${problems.slice(0, 3).join('；')}`)
          totalAfter += buf.byteLength
          continue
        }
        if (WRITE && report.changed) {
          const tmp = `${path}.tmp`
          writeFileSync(tmp, out)
          renameSync(tmp, path)
        }
      }
    } catch (e) {
      failed += 1
      console.log(`  ✖ ${name} 失败：${e.message}`)
      totalAfter += buf.byteLength
      continue
    }
    totalAfter += out.byteLength
    const saved = buf.byteLength - out.byteLength
    const note = [
      report.indexKeptU32 > 0 ? `⚠ ${report.indexKeptU32} 个索引 >65535 保持 u32` : '',
      report.droppedColor > 0 ? `删_color ${(report.droppedColor / 1024).toFixed(0)}KB` : '',
      report.droppedBufferViews > 0 ? `弃 ${report.droppedBufferViews} 个 bv` : '',
      report.textures.length > 0 ? `贴图缩 ${report.textures.length} 张：${report.textures.map((t) => `${t.from}→${t.to}`).join(' ')}` : '',
      report.textureIssues.length > 0 ? `⚠ ${report.textureIssues.length} 张贴图被跳过` : '',
      CHECK_ONLY ? `${statSync(path).size} 字节` : '',
    ].filter(Boolean).join(' ')
    console.log(
      name.padEnd(12),
      (buf.byteLength / 1024).toFixed(0).padStart(9),
      (out.byteLength / 1024).toFixed(0).padStart(9),
      `-${(saved / 1024).toFixed(0)}`.padStart(9),
      (report.indexBefore / 1024).toFixed(0).padStart(9),
      (report.indexAfter / 1024).toFixed(0).padStart(9),
      ((report.textureBytesBefore ?? 0) / 1024).toFixed(0).padStart(9),
      ((report.textureBytesAfter ?? 0) / 1024).toFixed(0).padStart(9),
      note,
    )
  }
  const MB = (n) => (n / 1024 / 1024).toFixed(2)
  console.log('')
  console.log(`合计 ${files.length} 个：${MB(totalBefore)} MB → ${MB(totalAfter)} MB（省 ${MB(totalBefore - totalAfter)} MB，${(((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1)}%）`)
  if (failed > 0) { console.log(`✖ ${failed} 个文件未通过自证/出错`); process.exit(1) }
  if (!WRITE && !CHECK_ONLY) console.log('（dry-run：未写盘；加 --write 才会原地重写）')
  process.exit(0)
}

// 只有直接执行时才跑 CLI（被 import 时只导出函数，便于测试）
if (process.argv[1] && process.argv[1].endsWith('compress-models.mjs')) main()

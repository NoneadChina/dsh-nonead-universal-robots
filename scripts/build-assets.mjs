#!/usr/bin/env node
/**
 * Task 2 资产管线 —— 抓取官方 UR 描述数据，生成数字孪生所需的本地资产。
 *
 * 数据源（BSD-3-Clause 的 `config/*.yaml`；网格许可分层见 THIRD_PARTY_NOTICES.md）：
 *   https://raw.githubusercontent.com/UniversalRobots/Universal_Robots_ROS2_Description/humble
 *
 * 用法：
 *   node scripts/build-assets.mjs --kinematics-only   # 只生成 assets/kinematics.json
 *   node scripts/build-assets.mjs                     # 另抓取网格源文件到 assets/meshes-src/
 *
 * 设计要点（见 SDD 台账 Ruling 7）：`/plugins/<id>/` 只服务 client.js 与 client.js.map，
 * 因此这些资产将来必须经 **host 路由**转发；本脚本只负责把文件产出到 assets/。
 *
 * 产物语义约定：`kinematics.json[model].jointLimits` 是长度 6 的 `[minRad, maxRad]` 数组，
 * **`null` 表示该关节无位置限位**（例如 UR3/UR3e 的 `wrist_3_joint` 在官方 `joint_limits.yaml`
 * 中为 `has_position_limits: false`，故没有 min/max_position）。消费方（FK）须据此跳过夹紧。
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BASE = 'https://raw.githubusercontent.com/UniversalRobots/Universal_Robots_ROS2_Description/humble'
const OUT = join(ROOT, 'assets')

/** 官方 description 覆盖的型号（用户要求"有多少加几个"）。 */
const MODELS = [
  'ur3', 'ur5', 'ur10', 'ur3e', 'ur5e', 'ur7e', 'ur10e', 'ur12e', 'ur16e',
  'ur8long', 'ur15', 'ur18', 'ur20', 'ur30',
]

/** 运动学链的固定顺序（对应 q[0..5]）。 */
const LINK_ORDER = ['shoulder', 'upper_arm', 'forearm', 'wrist_1', 'wrist_2', 'wrist_3']

/** joint_limits.yaml 的关节名 → q 下标。 */
const JOINT_INDEX = {
  shoulder_pan_joint: 0,
  shoulder_lift_joint: 1,
  elbow_joint: 2,
  wrist_1_joint: 3,
  wrist_2_joint: 4,
  wrist_3_joint: 5,
}

const KIN_KEYS = ['x', 'y', 'z', 'roll', 'pitch', 'yaw']

/** 有限重试的 GET（返回文本）。**任一型号失败都不得中断整体**。 */
async function fetchText(url, { attempts = 3 } = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise(r => setTimeout(r, 400 * 2 ** (attempt - 1)))
    }
  }
  throw new Error(`${url} → ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

/** 同理，取二进制（网格）。 */
async function fetchBytes(url, { attempts = 3 } = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)))
    }
  }
  throw new Error(`${url} → ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

/**
 * 极小 YAML 解析：default_kinematics.yaml 只需 `<name>:` 段落下的六个数值。
 * 例：`  z: 0.1519` / `  roll: 1.570796327`。
 */
export function parseKinematicsYaml(text) {
  const out = {}
  let cur = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line === 'kinematics:') continue
    const section = /^([A-Za-z_][A-Za-z0-9_]*):$/.exec(line)
    if (section) {
      cur = section[1]
      out[cur] = {}
      continue
    }
    const kv = /^(x|y|z|roll|pitch|yaw):\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?)$/.exec(line)
    if (kv && cur !== null) out[cur][kv[1]] = Number(kv[2])
  }
  return out
}

/**
 * 解析 joint_limits.yaml：取每个关节的 min/max_position（带 `!degrees` 标签，单位度）。
 * @returns 长度为 6 的 `[minRad, maxRad]` 数组，缺失项为 null。
 */
export function parseJointLimitsYaml(text) {
  const limits = new Array(6).fill(null)
  const pending = new Map()
  let currentJoint = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim()
    if (line === '' || line.startsWith('#')) continue
    if (line === 'joint_limits:') continue
    const joint = /^([A-Za-z_][A-Za-z0-9_]*):$/.exec(line)
    if (joint && JOINT_INDEX[joint[1]] !== undefined) {
      currentJoint = joint[1]
      continue
    }
    const kv = /^(min|max)_position:\s*(?:!\S+\s+)?(-?[0-9]+(?:\.[0-9]+)?)/.exec(line)
    if (kv && currentJoint !== null) {
      const bucket = pending.get(currentJoint) ?? {}
      bucket[kv[1]] = Number(kv[2])
      pending.set(currentJoint, bucket)
    }
  }
  for (const [joint, bucket] of pending) {
    const index = JOINT_INDEX[joint]
    if (bucket.min === undefined || bucket.max === undefined) continue
    const toRad = (deg) => (deg * Math.PI) / 180
    limits[index] = [Number(toRad(bucket.min).toFixed(9)), Number(toRad(bucket.max).toFixed(9))]
  }
  return limits
}

/** 从 visual_parameters.yaml 里抽出该型号用到的网格相对路径（visual 用 DAE、collision 用 STL）。 */
export function parseMeshPaths(text) {
  const paths = []
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*path:\s*(\S+\.(?:dae|stl))\s*$/.exec(raw)
    if (m && !paths.includes(m[1])) paths.push(m[1])
  }
  return paths
}

async function exists(path) {
  try { await access(path); return true } catch { return false }
}

async function buildKinematics() {
  const out = {}
  const missing = []
  for (const model of MODELS) {
    try {
      const kinText = await fetchText(`${BASE}/config/${model}/default_kinematics.yaml`)
      const parsed = parseKinematicsYaml(kinText)
      const links = LINK_ORDER.map((name) => {
        const link = parsed[name]
        if (link === undefined) throw new Error(`kinematics 缺少 ${name} 段`)
        const out = {}
        for (const key of KIN_KEYS) out[key] = link[key] ?? 0
        return out
      })
      let jointLimits = new Array(6).fill(null)
      try {
        jointLimits = parseJointLimitsYaml(await fetchText(`${BASE}/config/${model}/joint_limits.yaml`))
      } catch (error) {
        // 限位缺失不致命：FK 不需要它，调用方可退化为不夹紧。
        missing.push({ model, part: 'joint_limits', error: String(error.message ?? error) })
      }
      out[model] = { links, jointLimits }
      process.stdout.write(`  [ok] ${model}: links=${links.length} limits=${jointLimits.filter(Boolean).length}/6\n`)
    } catch (error) {
      missing.push({ model, part: 'kinematics', error: String(error.message ?? error) })
      process.stdout.write(`  [MISS] ${model}: ${error.message ?? error}\n`)
    }
  }
  await mkdir(OUT, { recursive: true })
  await writeFile(join(OUT, 'kinematics.json'), `${JSON.stringify(out, null, 2)}\n`, 'utf8')
  const okCount = Object.keys(out).length
  process.stdout.write(`kinematics.json: ${okCount}/${MODELS.length} 型号\n`)
  if (missing.length > 0) {
    await writeFile(join(OUT, '_missing.json'), `${JSON.stringify(missing, null, 2)}\n`, 'utf8')
    process.stdout.write(`_missing.json: ${missing.length} 条（未中断整体）\n`)
  } else if (await exists(join(OUT, '_missing.json'))) {
    await writeFile(join(OUT, '_missing.json'), '[]\n', 'utf8')
  }
  return okCount
}

async function buildMeshes() {
  const srcDir = join(OUT, 'meshes-src')
  const report = []
  let downloaded = 0
  let bytes = 0
  for (const model of MODELS) {
    try {
      const visualText = await fetchText(`${BASE}/config/${model}/visual_parameters.yaml`)
      const paths = parseMeshPaths(visualText)
      const modelBytes = []
      for (const rel of paths) {
        const data = await fetchBytes(`${BASE}/${rel}`)
        const target = join(srcDir, rel)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, data)
        downloaded += 1
        bytes += data.length
        modelBytes.push({ path: rel, bytes: data.length })
      }
      report.push({ model, meshes: modelBytes })
      const total = modelBytes.reduce((sum, m) => sum + m.bytes, 0)
      process.stdout.write(`  [ok] ${model}: ${modelBytes.length} 网格, ${(total / 1024 / 1024).toFixed(2)} MB\n`)
    } catch (error) {
      report.push({ model, error: String(error.message ?? error) })
      process.stdout.write(`  [MISS] ${model} 网格: ${error.message ?? error}\n`)
    }
  }
  await writeFile(join(OUT, 'meshes-src', '_manifest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`网格源文件: ${downloaded} 个, ${(bytes / 1024 / 1024).toFixed(2)} MB → assets/meshes-src/\n`)
}

async function main() {
  const kinematicsOnly = process.argv.includes('--kinematics-only')
  process.stdout.write(`资产管线开始（kinematics-only=${kinematicsOnly}）\n`)
  const ok = await buildKinematics()
  if (!kinematicsOnly && ok > 0) await buildMeshes()
  process.stdout.write('完成。\n')
}

const invokedDirectly = process.argv[1] !== undefined
  && process.argv[1].replace(/\\/g, '/').endsWith('scripts/build-assets.mjs')
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`资产管线失败：${error instanceof Error ? error.stack : String(error)}\n`)
    process.exitCode = 1
  })
}

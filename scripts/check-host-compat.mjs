#!/usr/bin/env node
/**
 * scripts/check-host-compat.mjs — 针对**已安装的宿主**校验本插件能否工作。
 *
 * 背景：本插件对宿主有两类硬依赖——工具参数 schema 必须落在宿主的 value-schema DSL 词表内，
 * 客户端半必须满足 `dsh.client` + `window.__ModuleLoader__` 的装载契约。两者出问题时的表现都是
 * 「静默少功能」而不是启动失败（v0.3.9 那 16 个工具就是这样消失的），所以放进一条命令里显式检查。
 *
 * 校验项：
 *   1. peer 范围：用宿主自带的 semver 比对 package.json 的 peerDependencies 与宿主实装版本；
 *   2. 工具 schema：用宿主**真实**的 @deepseek-ai/dsh-tools 编译全部工具参数 schema，并数出注册数；
 *   3. 孪生只读路由：驱动 `ctx.inject(['webServer'], …)`，确认两条路由的注册形状；
 *   4. dsh.client 声明与客户端 bundle：类型契约、`exports["./client"]` 可解析、bundle 以包名注册。
 *
 * 用法：
 *   node scripts/check-host-compat.mjs [hostNodeModules] [--strict]
 *   node scripts/check-host-compat.mjs --host-asar <resources/app.asar> [--strict]
 *   缺省依次尝试 $DSH_HOST_NODE_MODULES、../dsh-plugin-desktop/node_modules、自插件目录向上查找。
 *   `--host-asar` 用于 DSH Desktop 的标准安装形态（node_modules 打包在 app.asar 内、磁盘上没有
 *   目录）：脚本只读 asar 头，把实际 import 到的包懒解包到临时目录，DSL 校验仍然真实执行。
 *   `--strict`（发布门禁用）：缺少宿主即 exit 2，不因 --allow-missing-host 而放行。
 *
 * 退出码：0 = 全部通过或（非 strict 下）明确 SKIP；1 = 存在失败；2 = 环境错误。
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, openSync, readSync, closeSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire, registerHooks, isBuiltin } from 'node:module'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expectedToolCount } from './tool-registry.mjs'

const PLUGIN_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const PEER_PACKAGES = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/cordis',
  '@deepseek-ai/schemastery',
]
/**
 * 工具表当前规模 —— **从 `lib/index.js` 源码推导**（唯一来源 `scripts/tool-registry.mjs`），
 * 不再写死一个数字：写死的数字与真实注册数漂移时，这条断言会从一个"静默丢工具"的守卫
 * 变成一处需要人工同步的负担。
 */
const EXPECTED_TOOLS = expectedToolCount(PLUGIN_ROOT)
/**
 * 孪生侧注册的 `kind:'exact'` 路由条数。
 *
 * 0.6.3 起是 **4** 条：state / asset / models / **stream**（第 20 条的 SSE 实时流）。
 * 加路由时必须同步改这里 —— 这条断言的意义就是"注册形状变了要有人知道"，
 * 而不是"永远只能是 3 条"。
 */
const TWIN_ROUTE_COUNT = 4

const failures = []
const pass = (title, detail) => console.log(`PASS  ${title}${detail === undefined ? '' : ` — ${detail}`}`)
const fail = (title, detail) => {
  failures.push(`${title}${detail === undefined ? '' : `：${detail}`}`)
  console.log(`FAIL  ${title}${detail === undefined ? '' : ` — ${detail}`}`)
}
const note = (text) => console.log(`note  ${text}`)

// ── 命令行选项 ─────────────────────────────────────────────────────────────
// `--host-asar <path>`：宿主以 Electron 的 app.asar 形态安装时（DSH Desktop 的默认形态），
// 磁盘上没有 `node_modules` 目录，`findHostModules` 永远找不到。这个模式把 asar 当作只读
// 虚拟 node_modules：按需把被 import 的包解包到临时目录，再用 Node 正常解析（含 exports/子路径），
// 因此 `@deepseek-ai/dsh-tools` 的真实 value-schema DSL 仍然被真正执行。
// `--strict`：缺少宿主即失败（发布门禁用）；`--allow-missing-host` 仍用于本地 `npm run check`。
const ARGV = process.argv.slice(2)
const HOST_ASAR_INDEX = ARGV.indexOf('--host-asar')
const HOST_ASAR = (() => {
  if (HOST_ASAR_INDEX >= 0) {
    const value = ARGV[HOST_ASAR_INDEX + 1]
    if (value === undefined || value.startsWith('--')) {
      console.error('--host-asar 需要一个 asar 路径：node scripts/check-host-compat.mjs --host-asar <resources/app.asar>')
      process.exit(2)
    }
    return value
  }
  // `DSH_HOST_ASAR`：**发布门禁必须支持这条**，因为 `npm publish` 的 `prepublishOnly` 是固定命令，
  // 传不了命令行参数；而宿主若装在 `Program Files` 之外（例如 `D:\Software\…`，本机就是这样），
  // 自动发现也找不到它。显式环境变量是唯一"既不硬编码机器路径、又能让 publish 通过"的口子。
  const fromEnv = process.env.DSH_HOST_ASAR
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return undefined
})()
const STRICT = ARGV.includes('--strict')
const ALLOW_MISSING_HOST = ARGV.includes('--allow-missing-host')
const EXPLICIT_HOST = ARGV.find((arg, index) => !arg.startsWith('--')
  && !(HOST_ASAR_INDEX >= 0 && index === HOST_ASAR_INDEX + 1))

/** 从裸 import 说明符里取出包名（scope 感知）。 */
function packageNameOf(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return name === undefined || name === '' ? undefined : `${scope}/${name}`
  }
  const [name] = specifier.split('/')
  return name === '' ? undefined : name
}

/**
 * 把 app.asar 当作只读的 node_modules 使用。
 *
 * asar 文件头是 Chromium pickle：`[4]` = header 区长度、`[12]` = JSON 长度，JSON 从偏移 16 开始，
 * 文件数据区从 `8 + headerSize` 开始。本函数只在内存里解析一次 header，按包懒解包到临时目录；
 * `unpacked` 文件从 `<asar>.unpacked` 读取，`link`（硬链）按目标路径读取。
 */
function createAsarHost(asarPath) {
  const unpackedRoot = `${asarPath}.unpacked`
  const fd = openSync(asarPath, 'r')
  const head = Buffer.alloc(16)
  readSync(fd, head, 0, 16, 0)
  const headerSize = head.readUInt32LE(4)
  const jsonSize = head.readUInt32LE(12)
  if (!Number.isInteger(headerSize) || !Number.isInteger(jsonSize) || jsonSize <= 0) {
    closeSync(fd)
    throw new Error(`不是有效的 asar 文件（header 长度异常）：${asarPath}`)
  }
  const headerBuf = Buffer.alloc(jsonSize)
  readSync(fd, headerBuf, 0, jsonSize, 16)
  const header = JSON.parse(headerBuf.toString('utf8'))
  const base = 8 + headerSize

  const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-host-asar-'))
  const modulesDir = join(tempRoot, 'node_modules')
  mkdirSync(modulesDir, { recursive: true })
  writeFileSync(join(tempRoot, 'package.json'), '{"name":"dsh-host-asar","private":true}\n')
  const noopPath = join(tempRoot, 'noop.js')
  writeFileSync(noopPath, 'export {}\n')
  const noopUrl = pathToFileURL(noopPath).href

  const extracted = new Set()
  const absent = new Set()

  /** 按相对路径取 asar header 节点（目录节点带 `.files`）。 */
  function asarNode(parts) {
    let node = header.files
    for (const part of parts) {
      node = node?.[part]
      if (node === undefined) return undefined
      node = node.files ?? node
    }
    return node
  }

  function readMeta(meta, relParts) {
    if (meta.unpacked === true) {
      const abs = join(unpackedRoot, ...relParts)
      return existsSync(abs) ? readFileSync(abs) : null
    }
    if (typeof meta.link === 'string') return readRel(meta.link)
    if (meta.offset === undefined || typeof meta.size !== 'number') return null
    const buf = Buffer.alloc(meta.size)
    readSync(fd, buf, 0, meta.size, base + Number(meta.offset))
    return buf
  }

  function readRel(relPath) {
    const parts = relPath.split('/')
    const node = asarNode(parts.slice(0, -1))
    if (node === undefined) return null
    const meta = node[parts[parts.length - 1]]
    if (meta === undefined || meta.files !== undefined) return null
    return readMeta(meta, parts)
  }

  function walkDir(node, relParts, destDir) {
    for (const [name, meta] of Object.entries(node)) {
      const childParts = [...relParts, name]
      const dest = join(destDir, name)
      if (meta.files !== undefined) {
        mkdirSync(dest, { recursive: true })
        walkDir(meta.files, childParts, dest)
        continue
      }
      const buf = readMeta(meta, childParts)
      if (buf === null) continue
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, buf)
    }
  }

  function ensureManifest(name) {
    if (absent.has(name)) return false
    const parts = name.split('/')
    const dest = join(modulesDir, ...parts, 'package.json')
    if (existsSync(dest)) return true
    const buf = readRel(['node_modules', ...parts, 'package.json'].join('/'))
    if (buf === null) {
      absent.add(name)
      return false
    }
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, buf)
    return true
  }

  function ensurePackage(name) {
    if (extracted.has(name)) return true
    if (!ensureManifest(name)) return false
    const rootParts = ['node_modules', ...name.split('/')]
    const node = asarNode(rootParts)
    if (node === undefined) return false
    const destDir = join(modulesDir, ...name.split('/'))
    mkdirSync(destDir, { recursive: true })
    walkDir(node, rootParts, destDir)
    extracted.add(name)
    return true
  }

  // 预解包：DSL 编译直接 import 的包、peer 版本展示要读 manifest 的包、以及 semver（node:module
  // 的 createRequire 走文件系统，钩子不参与）。其余依赖由 import 钩子按需解包。
  ensureManifest('@deepseek-ai/dsh')
  for (const name of ['@deepseek-ai/dsh-tools', '@deepseek-ai/cordis', '@deepseek-ai/schemastery', 'semver']) {
    if (!ensurePackage(name)) {
      closeSync(fd)
      rmSync(tempRoot, { recursive: true, force: true })
      throw new Error(`asar 里缺少 ${name}（不是完整的 DSH 宿主安装？）：${asarPath}`)
    }
  }

  let cleaned = false
  function cleanup() {
    if (cleaned) return
    cleaned = true
    try { closeSync(fd) } catch { /* already closed */ }
    if (process.env.DSH_HOST_ASAR_KEEP === '1') {
      console.log(`note  --host-asar 解包目录保留（DSH_HOST_ASAR_KEEP=1）：${tempRoot}`)
      return
    }
    try { rmSync(tempRoot, { recursive: true, force: true }) } catch { /* Windows 偶发占用，交给系统清理 */ }
  }
  process.once('exit', cleanup)

  return { modulesDir, noopUrl, ensurePackage, ensureManifest, cleanup, asarPath }
}


/**
 * Windows 上 `Program Files` 不在 PATH 里，只能枚举目录来找宿主的 node_modules。
 *
 * ⚠️ **不能写死 `DSH Desktop`**：本机装的是 `Nonead DSH Desktop`，写死会让这条门禁在这台机器上
 * 永远"找不到宿主"（于是它从未真正跑过）。这里枚举 `Program Files` 下的每个目录，取
 * `<厂商目录>\resources\app\node_modules`（Electron 应用的标准布局）。
 */
function desktopCandidates() {
  const found = []
  // `%LOCALAPPDATA%\Programs` 是 Electron 应用**按用户安装**时的标准位置；只扫 `Program Files`
  // 会把这类安装漏掉（于是门禁"找不到宿主"）。两个都扫，仍然不写死任何厂商目录名。
  const roots = [
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : undefined,
  ].filter((root) => typeof root === 'string' && root !== '')
  for (const base of roots) {
    let entries = []
    try {
      entries = readdirSync(base, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      found.push(join(base, entry.name, 'resources', 'app', 'node_modules'))
    }
  }
  return found
}

/** 定位宿主 node_modules（含 @deepseek-ai/dsh-tools 的那个）。 */
function findHostModules(explicit) {
  const candidates = [
    explicit,
    process.env.DSH_HOST_NODE_MODULES,
    // DSH Desktop 的实际安装位置：**必须排在上面那个 walk-up 之前**。
    // 本仓库自己的 node_modules 里也有（devDependency 带进来的）@deepseek-ai/dsh-tools，
    // 但那是**驱动脚本用的旧 dev 副本**（0.1.2-rc.1），不是运行插件的那份；用它去校验
    // DSL 与 peer 版本会得到误导性的结论（例如 "0/67 注册成功"）。
    ...desktopCandidates(),
  ]
  const hasHost = (dir) => typeof dir === 'string' && dir !== ''
    && existsSync(join(dir, '@deepseek-ai', 'dsh-tools', 'package.json'))

  for (const candidate of candidates) {
    if (hasHost(candidate)) return resolvePath(candidate)
  }

  const desktopSibling = resolvePath(PLUGIN_ROOT, '..', 'dsh-plugin-desktop', 'node_modules')
  if (hasHost(desktopSibling)) return desktopSibling

  let dir = PLUGIN_ROOT
  for (;;) {
    const candidate = join(dir, 'node_modules')
    if (hasHost(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function hostManifest(hostModules, name) {
  const path = join(hostModules, ...name.split('/'), 'package.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
}

/** 解析宿主包的 ESM 入口，供加载钩子重定向本插件的裸导入。 */
function hostEntry(hostModules, specifier) {
  const [scope, name] = specifier.split('/')
  const packageDir = join(hostModules, scope, name)
  const manifestPath = join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) return undefined
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const entry = manifest.exports?.['.']
  const relative = typeof entry === 'string'
    ? entry
    : entry?.import ?? entry?.default ?? entry?.require ?? manifest.module ?? manifest.main
  return typeof relative === 'string' ? pathToFileURL(join(packageDir, relative)).href : undefined
}

const asarHost = (() => {
  if (HOST_ASAR === undefined) return undefined
  try {
    return createAsarHost(HOST_ASAR)
  } catch (cause) {
    console.error(`--host-asar 失败：${cause instanceof Error ? cause.message : String(cause)}`)
    process.exit(2)
  }
})()

const hostModules = asarHost !== undefined ? asarHost.modulesDir : findHostModules(EXPLICIT_HOST)
if (hostModules === undefined) {
  const message =
    '找不到宿主 node_modules（需要含 @deepseek-ai/dsh-tools 的那一份）；' +
    '请显式传路径：node scripts/check-host-compat.mjs <host node_modules>，' +
    '或用 --host-asar <resources/app.asar> 读取 DSH Desktop 的 asar 安装'
  // 优先级：`--strict`（发布门禁，缺宿主即失败）> `--allow-missing-host`（本地 check，响亮 SKIP）
  // > 默认（exit 2，环境错误必须与"检查通过"区分开）。
  if (!STRICT && ALLOW_MISSING_HOST) {
    console.log(`SKIP  ${message}`)
    process.exit(0)
  }
  console.error(message)
  if (STRICT) console.error('--strict：发布门禁不允许缺宿主 —— 先安装 DSH Desktop（或用 --host-asar 指定 app.asar）。')
  process.exit(2)
}
console.log(`plugin  ${PLUGIN_ROOT}`)
console.log(`host    ${asarHost !== undefined ? `${asarHost.asarPath}  (解包到 ${hostModules})` : hostModules}`)
console.log('')

const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'))
console.log(`plugin version ${manifest.version}`)
for (const name of PEER_PACKAGES) {
  const installed = hostManifest(hostModules, name)
  console.log(`  ${name.padEnd(30)} host ${installed?.version ?? '(未安装)'}  declared ${manifest.peerDependencies?.[name] ?? '(无)'}`)
}
console.log('')

// ── 1. peer 范围 ────────────────────────────────────────────────────────────
const requireBase = existsSync(join(hostModules, '..', 'package.json'))
  ? join(hostModules, '..', 'package.json')
  : join(hostModules, 'noop.cjs')
let semver
try {
  semver = createRequire(requireBase)('semver')
} catch {
  semver = undefined
}
if (semver === undefined) note('宿主未提供 semver，跳过 peer 范围求值（上面已打印版本对照）')
else {
  for (const name of PEER_PACKAGES) {
    const declared = manifest.peerDependencies?.[name]
    const installed = hostManifest(hostModules, name)?.version
    if (installed === undefined) { fail(`peer ${name}`, '宿主未安装该包'); continue }
    if (declared === undefined) { note(`${name} 未声明 peer，宿主 ${installed}`); continue }
    if (semver.satisfies(installed, declared)) pass(`peer ${name}`, `宿主 ${installed} 满足 ${declared}`)
    else fail(`peer ${name}`, `宿主 ${installed} 不满足 ${declared}（预发布范围只匹配自身版本三元组，需为该版本族补一条）`)
  }
}

// ── 2/3. 用宿主真实的编译器驱动插件 ────────────────────────────────────────
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (asarHost === undefined) {
      if (specifier.startsWith('@deepseek-ai/')) {
        const url = hostEntry(hostModules, specifier)
        if (url !== undefined) return { url, shortCircuit: true }
      }
      return nextResolve(specifier, context)
    }

    // asar 模式：**必须先解包、再让 Node 解析**。
    // 反过来做（先 nextResolve、失败后再解包重试）会踩 Node 的 package.json 负缓存：
    // 第一次解析失败时 Node 把 `.../node_modules/<pkg>/package.json` 缓存成「不存在」，
    // 解包之后的第二次解析仍读到缓存的 null，于是退化成 legacy main（index.js）并失败。
    if (specifier.startsWith('node:') || specifier.startsWith('.') || specifier.startsWith('/')
      || specifier.startsWith('file:') || specifier.startsWith('#') || isBuiltin(specifier)) {
      return nextResolve(specifier, context)
    }
    const packageName = packageNameOf(specifier)
    if (packageName !== undefined) asarHost.ensurePackage(packageName)
    try {
      return nextResolve(specifier, context)
    } catch (cause) {
      // 走到这里说明这个包不在 asar 里（不是宿主依赖）—— 用临时目录作为解析起点再试一次，
      // 让 Node 自己处理 exports/子路径；仍失败就如实抛出。
      if (packageName === undefined || !asarHost.ensurePackage(packageName)) throw cause
      return nextResolve(specifier, { ...context, parentURL: asarHost.noopUrl })
    }
  },
})

const registered = []
const mountedRoutes = []
const warnings = []
const infos = []
const effectErrors = []
const logger = {
  info: (message) => infos.push(String(message)),
  warn: (message) => warnings.push(String(message)),
  error: (message) => warnings.push(String(message)),
}
/** Cordis 的 ctx.effect 语义：立即执行回调，返回值作为 disposer。 */
const effect = (callback) => {
  try {
    const disposer = callback()
    return typeof disposer === 'function' ? disposer : () => {}
  } catch (cause) {
    effectErrors.push(cause instanceof Error ? cause.message : String(cause))
    return () => {}
  }
}

try {
  const plugin = await import(pathToFileURL(join(PLUGIN_ROOT, 'lib', 'index.js')).href)
  plugin.apply(
    {
      logger,
      effect,
      get: () => undefined,
      inject: (deps, callback) => {
        callback({
          logger,
          effect,
          webServer: {
            register: (route) => {
              mountedRoutes.push(route)
              return () => {}
            },
          },
        })
        return () => {}
      },
      tools: { register: (tool) => registered.push(tool) },
    },
    {},
  )
} catch (cause) {
  fail('驱动插件 apply()', cause instanceof Error ? cause.message : String(cause))
  if (process.env.DSH_HOST_ASAR_DEBUG === '1' && cause instanceof Error && cause.stack !== undefined) {
    console.error(cause.stack)
  }
}

if (effectErrors.length > 0) fail('effect 回调执行', effectErrors.join('；'))

const registrationFailures = warnings.filter((line) => /注册 .* 失败/.test(line))
if (registered.length === EXPECTED_TOOLS && registrationFailures.length === 0) {
  pass('工具 schema 通过宿主真实 DSL', `${registered.length}/${EXPECTED_TOOLS} 个工具注册成功`)
} else {
  const reasons = registrationFailures.length === 0 ? '(无逐条告警)' : registrationFailures.slice(0, 5).join(' | ')
  fail('工具 schema 通过宿主真实 DSL', `仅 ${registered.length}/${EXPECTED_TOOLS} 注册成功；${reasons}`)
}

if (mountedRoutes.length === TWIN_ROUTE_COUNT && mountedRoutes.every((route) => route.kind === 'exact' && typeof route.handler === 'function')) {
  pass('孪生只读路由', mountedRoutes.map((route) => route.path).join('、'))
} else {
  fail('孪生只读路由', `期望 ${TWIN_ROUTE_COUNT} 条 kind:'exact' 路由，实际 ${mountedRoutes.length} 条`)
}

if (infos.some((line) => line.includes(`已注册 ${EXPECTED_TOOLS}/${EXPECTED_TOOLS}`))) {
  pass('注册上报', '如实报告实际注册数量')
} else {
  fail('注册上报', `未看到真实计数上报：${infos.join(' | ') || '(无 info 日志)'}`)
}

// ── 4. dsh.client 声明与客户端 bundle ──────────────────────────────────────
const declaration = manifest.dsh?.client
if (declaration === undefined) {
  note('未声明 dsh.client（无客户端半）')
} else {
  const problems = []
  if (declaration.platform !== 'web') problems.push(`platform 必须是 "web"（实际 ${JSON.stringify(declaration.platform)}）`)
  for (const key of ['inject', 'external']) {
    const value = declaration[key]
    if (value !== undefined && (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))) {
      problems.push(`${key} 必须是字符串数组`)
    }
  }
  if (declaration.immediately !== undefined && typeof declaration.immediately !== 'boolean') problems.push('immediately 必须是布尔')

  const clientField = manifest.exports?.['./client']
  const clientRelative = typeof clientField === 'string' ? clientField : clientField?.default
  let bundleHead = ''
  if (typeof clientRelative !== 'string') problems.push('声明了 dsh.client 但 exports["./client"] 不是字符串或带字符串 default 的对象')
  else if (!existsSync(join(PLUGIN_ROOT, clientRelative))) problems.push(`exports["./client"] 指向的文件不存在：${clientRelative}`)
  else bundleHead = readFileSync(join(PLUGIN_ROOT, clientRelative), 'utf8').slice(0, 400)

  if (bundleHead !== '') {
    if (!bundleHead.includes('window.__ModuleLoader__.load(')) problems.push('客户端 bundle 未以 window.__ModuleLoader__.load 装载')
    else if (!bundleHead.includes(JSON.stringify(manifest.name))) problems.push(`客户端 bundle 的注册 id 必须等于包名 ${manifest.name}`)
  }

  if (problems.length === 0) pass('dsh.client 声明与客户端 bundle', `platform=${declaration.platform}，入口 ${clientRelative}`)
  else fail('dsh.client 声明与客户端 bundle', problems.join('；'))
}

// ── 运行时前置（不是宿主兼容问题，但决定工具能否真的动起来）────────────────
// 用和 `run-tests` / `run-py` 相同的解析器：裸名字 `python` 在 Windows 上可能是 Microsoft Store
// 的占位别名（执行报 exit 9009），按名字判断会误报"没有 Python"，而项目 `.venv` 里明明有。
const { resolvePython } = await import('./python-bin.mjs')
const resolvedPython = resolvePython()
if (resolvedPython.ok) {
  note(`Python 可用（${resolvedPython.label} → ${resolvedPython.executable ?? resolvedPython.command}）：worker 可以启动（首次调用工具时才会 spawn）`)
} else {
  note('找不到可用的 Python 解释器：工具会注册成功，但调用时会失败。建项目虚拟环境并装依赖：'
    + 'python -m venv .venv 然后 .venv\\Scripts\\python.exe -m pip install -r requirements.txt（见 README）')
}

console.log('')
if (failures.length === 0) {
  console.log('result: 全部通过')
  process.exit(0)
}
console.log(`result: ${failures.length} 项失败`)
for (const failure of failures) console.log(`  - ${failure}`)
process.exit(1)

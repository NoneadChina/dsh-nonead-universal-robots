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
 *   node scripts/check-host-compat.mjs [hostNodeModules]
 *   缺省依次尝试 $DSH_HOST_NODE_MODULES、../dsh-plugin-desktop/node_modules、自插件目录向上查找。
 *
 * 退出码：0 = 全部通过；1 = 存在失败；2 = 环境错误。
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire, registerHooks } from 'node:module'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PLUGIN_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')
const PEER_PACKAGES = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/cordis',
  '@deepseek-ai/schemastery',
]
/** 工具表当前规模（当前的 67 个）；注册数少于它即为「静默丢工具」。 */
const EXPECTED_TOOLS = 67
const TWIN_ROUTE_COUNT = 3

const failures = []
const pass = (title, detail) => console.log(`PASS  ${title}${detail === undefined ? '' : ` — ${detail}`}`)
const fail = (title, detail) => {
  failures.push(`${title}${detail === undefined ? '' : `：${detail}`}`)
  console.log(`FAIL  ${title}${detail === undefined ? '' : ` — ${detail}`}`)
}
const note = (text) => console.log(`note  ${text}`)

/** 定位宿主 node_modules（含 @deepseek-ai/dsh-tools 的那个）。 */
function findHostModules(argv) {
  const candidates = [
    argv[2],
    process.env.DSH_HOST_NODE_MODULES,
    // DSH Desktop 的实际安装位置：**必须排在上面那个 walk-up 之前**。
    // 本仓库自己的 node_modules 里也有（devDependency 带进来的）@deepseek-ai/dsh-tools，
    // 但那是**驱动脚本用的旧 dev 副本**（0.1.2-rc.1），不是运行插件的那份；用它去校验
    // DSL 与 peer 版本会得到误导性的结论（例如 "0/67 注册成功"）。
    // Windows 上 Program Files 不在 PATH 里，所以候选路径写死并逐个探测存在性。
    'C:\\Program Files\\DSH Desktop\\resources\\app\\node_modules',
    'C:\\Program Files (x86)\\DSH Desktop\\resources\\app\\node_modules',
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

const hostModules = findHostModules(process.argv)
if (hostModules === undefined) {
  console.error('找不到宿主 node_modules；请显式传路径：node scripts/check-host-compat.mjs <host node_modules>')
  process.exit(2)
}
console.log(`plugin  ${PLUGIN_ROOT}`)
console.log(`host    ${hostModules}`)
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
    if (specifier.startsWith('@deepseek-ai/')) {
      const url = hostEntry(hostModules, specifier)
      if (url !== undefined) return { url, shortCircuit: true }
    }
    return nextResolve(specifier, context)
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
const python = spawnSync('python', ['--version'], { stdio: 'ignore' })
if (python.status === 0) note('系统 python 可用：worker 可以启动（首次调用工具时才会 spawn）')
else note('未检测到可用的系统 python：工具会注册成功，但调用时会失败；需安装 Python 与 requirements.txt 的依赖（宿主不自带解释器）')

console.log('')
if (failures.length === 0) {
  console.log('result: 全部通过')
  process.exit(0)
}
console.log(`result: ${failures.length} 项失败`)
for (const failure of failures) console.log(`  - ${failure}`)
process.exit(1)

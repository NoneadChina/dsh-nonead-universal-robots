// scripts/build-client.mjs
// 契约（Task 1 核验，Ruling 6）：shell 用经典 script 加载 bundle，官方产物一律是
// CJS 工厂包装 —— 必须 format:'cjs' + banner/footer，否则 `export` 会 SyntaxError。
// Ruling 13：只做响亮失败（throw），**不做**任何静默的字符串重排兜底。
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'

// 输出路径可用 `BUILD_CLIENT_OUT` 覆盖：校验脚本要"重新构建到别处再比对哈希"来证明
// 提交的 bundle 与源码一致，这比任何字面量/时间戳启发式都确定，而且**不必碰**提交产物。
const OUT = process.env.BUILD_CLIENT_OUT ?? 'lib/client.js'
const ROOT = dirname(fileURLToPath(import.meta.url)) + '/..'

// DSH 以包名作为插件 id（`/plugins/<id>/client.js` 与 `window.__DSH_BOOT__` 的登记键）。
// bundle id 必须等于 package.json 的 name：漂移时它只会在运行时以
// "loaded without registering"（packages/client/modules/src/client/system.ts）暴露，
// 因此这里改为读 package.json 并断言相等 —— 改名即构建立刻失败。
const EXPECTED_ID = 'dsh-nonead-universal-robots'
const ID = JSON.parse(readFileSync('package.json', 'utf8')).name

const HEAD = `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`
const INTRO = 'var module = { exports: {} }; var exports = module.exports;'
const TAIL = 'return module.exports; } });'

if (ID !== EXPECTED_ID) {
  throw new Error(
    `build-client: package.json 的 name 为 "${ID}"，期望 "${EXPECTED_ID}"。\n` +
      `  bundle id 必须与包名一致（shell 用包名登记 entry），改名需同步 profile 安装与 shell 侧登记。`,
  )
}

await runEsbuild({ headBanner: `${HEAD}\n${INTRO}`, tailFooter: TAIL })

/**
 * 跑一次 esbuild。
 *
 * ## 为什么要优先用**独立二进制**（这不是"随便兜底"）
 * `import { build } from 'esbuild'` 让 JS 包去 spawn 平台二进制，而它启动时会**校验两者
 * 版本一致**（`Host version "X" does not match binary version "Y"`）。本仓库的
 * `node_modules/.pnpm/esbuild@0.25.0/` 里 JS 已被升到 0.25.12 而 `@esbuild/win32-x64`
 * 仍是 0.25.0（lockfile 与 store 不同步的正常残留），于是 JS API 直接报
 * "Cannot start service"，**构建彻底失败**。
 * 独立二进制不需要任何版本配对；banner/footer 用文件传入，语义与 JS API 完全一致。
 * JS API 仍作为回退（环境里没有独立二进制时）。
 *
 * @returns {{ bannner: never }|void}
 */
function runEsbuild({ headBanner, tailFooter }) {
  const candidates = [
    join(ROOT, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'),
    join(ROOT, 'node_modules', 'esbuild', 'bin', 'esbuild'),
    join(ROOT, 'node_modules', '.bin', 'esbuild'),
  ]
  const bin = candidates.find((p) => existsSync(p))

  if (bin !== undefined) {
    const args = [
      'src/client/index.js',
      '--bundle',
      '--outfile=' + OUT,
      '--format=cjs',
      '--platform=browser',
      '--target=chrome110',
      '--minify',
      '--sourcemap',
      // ⚠️ CLI 的 `--banner:js=` 收的是**内联文本**，不是文件路径：
      // 传路径时 esbuild 会把"路径"本身当横幅写进产物（首行就变成路径）。
      // 用 spawnSync 的数组参数传值，不经过 shell，换行/引号都不会被解释。
      '--banner:js=' + headBanner,
      '--footer:js=' + tailFooter,
    ]
    const r = spawnSync(bin, args, { stdio: 'inherit', cwd: join(ROOT) })
    if (r.status === 0) return
    throw new Error(`build-client: esbuild 二进制构建失败（exit ${r.status}）`)
  }

  // 回退：JS API（需要 JS 包与平台二进制版本一致）
  return import('esbuild').then(({ build }) =>
    build({
      entryPoints: ['src/client/index.js'],
      outfile: OUT,
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      target: ['chrome110'],
      minify: true,
      sourcemap: true,
      logLevel: 'info',
      // Ruling 32（更正 Ruling 12 的范围）：esbuild **根本没有 `intro` 选项** —— 不止 CLI，
      // JS API 同样会直接抛 `Invalid option in build() call: "intro"`（此前误判为沙箱 spawn EPERM）。
      // 等价施加：把 INTRO 折进 `banner.js` 的下一行（顺序仍是 HEAD → INTRO → code → footer）。
      banner: { js: headBanner },
      footer: { js: tailFooter },
    }),
  )
}

// 契约自检（Ruling 13）：任一不满足立即 throw，绝不静默改写产物。
const out = readFileSync(OUT, 'utf8')
const firstLine = out.split(/\r?\n/, 1)[0]
const contractError = (why) =>
  new Error(
    `build-client: ${OUT} 不满足 CJS 工厂包装契约 —— ${why}\n` +
      `  期望首行：${HEAD}\n` +
      `  期望收尾：${TAIL}\n` +
      `  请检查 esbuild 的 format（必须 'cjs'）与 banner.js / footer.js 两个选项，` +
      `并确认注入顺序仍是 banner(HEAD+INTRO) → code → footer（banner 打开 factory 并声明 module/exports、` +
      `footer 关闭 factory 并 return module.exports）。注意 esbuild 没有 \`intro\` 选项（Ruling 32）。`,
  )

if (!out.startsWith(HEAD)) throw contractError(`首行不是 factory 开头（实际：${JSON.stringify(firstLine.slice(0, 80))}）`)
if (/(^|[;\n}])\s*export\s*[{(]/.test(out)) throw contractError('含顶层 export，经典 script 执行时会 SyntaxError')
if (!out.includes(TAIL)) throw contractError('缺少 factory 收尾，footer 未生效')
try {
  new Script(out, { filename: OUT })
} catch (e) {
  throw contractError(`无法作为经典 script 编译（${e.message}）—— 包装括号可能不平衡`)
}

console.log(`build-client: ok — ${OUT} (id=${ID}) 首行契约通过`)

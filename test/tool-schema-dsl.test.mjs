// test/tool-schema-dsl.test.mjs
//
// 回归测试：工具参数 schema 必须只使用 DSH「值 schema DSL」支持的**作者关键字**。
//
// 背景（真实事故）：DSH Desktop 1.5.2 → 1.5.3 后，值 schema DSL 收紧了作者关键字白名单。
// 本插件的 15 个工具在参数里用了 `minimum` / `maximum` / `exclusiveMinimum`，于是
// **整个工具注册失败**，日志只留一行 warning：
//   universal-robots: 注册 ur_movej 失败：unsupported JSON schema: parameters.a.minimum is not supported by the value schema DSL
// 而收尾那行 `已注册 53 个` 是硬编码 tools.length，会在工具实际缺失时**说谎**——
// 所以"日志看起来正常"骗过了所有既有检查，直到用户发现工具不见了/插件起不来。
//
// 本测试直接驱动真实的 `apply()`、捕获真实注册的 tool 定义并静态校验 schema，
// 因此任何未受支持的关键字（以及任何注册丢失）都会立刻变红。
//
// 权威来源：`app.asar` 内 `@deepseek-ai/dsh-tools` 的 schema 编译器
// （`src/schema.ts` 的 `assertAuthorKeys` 调用点）：
//   - 注解：description / title / default / examples
//   - 结构：type / oneOf / properties / additionalProperties / items / enum / const / required
// 说明：`additionalProperties` 仅在显式 `type: 'object'` 时可用，且必须显式布尔。
//
// 运行：node --test test/tool-schema-dsl.test.mjs
//      （不要用 npm test —— 本沙箱下 npm 的 piped stdio 会 spawn EPERM）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/** 工具表规模（0.5.0：53 → 67；0.6.0 按三本官方手册补齐后：67 → 83）。
 *  改动工具表时**必须**同步这个数与 check-host-compat.mjs。 */
const EXPECTED_TOOLS = 83
const pythonDir = fileURLToPath(new URL('../python/', import.meta.url))
const workerSource = readFileSync(join(pythonDir, 'ur_worker.py'), 'utf8').replace(/\r\n/g, '\n')
const indexSource = readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8')

/** DSL 允许的作者关键字（见文件头）。 */
const ANNOTATION_KEYS = ['description', 'title', 'default', 'examples']
const STRUCTURAL_BY_TYPE = {
  json: ['type'],
  object: ['type', 'properties', 'additionalProperties'],
  array: ['type', 'items'],
  string: ['type', 'enum', 'const'],
  number: ['type', 'enum', 'const'],
  integer: ['type', 'enum', 'const'],
  boolean: ['type', 'enum', 'const'],
  null: ['type', 'enum', 'const'],
}

/**
 * 把宿主包替换为桩，以便在纯 Node 下驱动真实的 lib/index.js。
 * 只桩掉两个 peer 依赖；worker.js 是本地文件，真实加载。
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-tools') return { url: 'stub:dsh-tools', shortCircuit: true }
    if (specifier === '@deepseek-ai/schemastery') return { url: 'stub:schemastery', shortCircuit: true }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'stub:dsh-tools') {
      return { format: 'module', shortCircuit: true, source: 'export function defineTool(spec) { return spec }' }
    }
    if (url === 'stub:schemastery') {
      // Config 只被导出、不被调用（除 z.object/... 的链式构造），给一个万能可链式桩。
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          const chain = new Proxy(function () {}, {
            get: () => (...a) => chain,
            apply: () => chain,
          })
          const z = new Proxy({}, { get: () => (...a) => chain })
          export default z
        `,
      }
    }
    return nextLoad(url, context)
  },
})

/** 驱动真实的 apply()，捕获注册的 tool 定义与日志。 */
async function collectTools() {
  const mod = await import('../lib/index.js')
  const registered = []
  const warnings = []
  const infos = []
  const ctx = {
    logger: { info: (m) => infos.push(String(m)), warn: (m) => warnings.push(String(m)), error() {} },
    effect: () => () => {},
    get: () => undefined,
    inject: () => () => {},
    tools: { register: (tool) => registered.push(tool) },
  }
  mod.apply(ctx, {})
  return { mod, registered, warnings, infos }
}

/** 用给定的 tools 服务驱动 apply()，只关心它报告了什么。 */
async function collectWithTools(toolsService) {
  const mod = await import('../lib/index.js')
  const warnings = []
  const infos = []
  mod.apply(
    {
      logger: {
        info: (m) => infos.push(String(m)),
        warn: (m) => warnings.push(String(m)),
        error() {},
      },
      effect: () => () => {},
      get: () => undefined,
      inject: () => () => {},
      tools: toolsService,
    },
    {},
  )
  return { warnings, infos }
}

/**
 * 递归校验一个「参数值 schema」节点上是否有不受支持的作者关键字。
 *
 * 结构与 DSL 编译器一致：
 *   - `isMap`（或没有 `type`）的节点是**隐式属性映射**：键是**参数名**，不是关键字，
 *     因此不校验自身，而是逐个下钻（`description` / `required` 是映射层注解，跳过）。
 *   - 带 `type` 的节点：自身键必须落在该类型的白名单内。
 *   - `required` 只允许出现在「属性值」这一层（对应编译器的 `allowRequired`），
 *     数组 items / oneOf 分支里不允许。
 */
function checkNode(schema, path, out, { isMap = false, allowRequired = false } = {}) {
  if (schema === null || typeof schema !== 'object') return out
  const type = typeof schema.type === 'string' ? schema.type : undefined

  if (isMap || type === undefined) {
    for (const [key, sub] of Object.entries(schema)) {
      if (ANNOTATION_KEYS.includes(key) || key === 'required') continue
      // 属性值这一层允许 `required`
      checkNode(sub, `${path}.${key}`, out, { allowRequired: true })
    }
    return out
  }

  const base = STRUCTURAL_BY_TYPE[type]
  if (!base) {
    out.push(`${path}.type = ${JSON.stringify(type)} 不是 DSL 支持的类型`)
    return out
  }
  const allowed = [...base, ...ANNOTATION_KEYS, ...(allowRequired ? ['required'] : [])]
  for (const key of Object.keys(schema)) {
    if (!allowed.includes(key)) out.push(`${path}.${key}`)
  }
  if (type === 'object' && schema.properties && typeof schema.properties === 'object') {
    for (const [k, sub] of Object.entries(schema.properties)) {
      checkNode(sub, `${path}.properties.${k}`, out, { allowRequired: true })
    }
  }
  if (schema.items) checkNode(schema.items, `${path}[]`, out, { allowRequired: false })
  if (Array.isArray(schema.oneOf)) {
    schema.oneOf.forEach((sub, i) => checkNode(sub, `${path}.oneOf[${i}]`, out, { allowRequired: false }))
  }
  return out
}

/** 递归收集缺少 description 的参数字段。 */
function missingDescriptions(schema, path, out, isMap = false) {
  if (schema === null || typeof schema !== 'object') return out
  const type = typeof schema.type === 'string' ? schema.type : undefined
  if (isMap || type === undefined) {
    for (const [key, sub] of Object.entries(schema)) {
      if (ANNOTATION_KEYS.includes(key) || key === 'required') continue
      if (typeof sub?.description !== 'string' || sub.description.trim() === '') {
        out.push(`${path}.${key}`)
      }
      missingDescriptions(sub, `${path}.${key}`, out, false)
    }
    return out
  }
  if (schema.items) missingDescriptions(schema.items, `${path}[]`, out, false)
  return out
}

test('全部 67 个 ur_* 工具都成功注册（不得静默丢工具）', async () => {
  const { registered } = await collectTools()
  const names = registered.map((t) => t.name).sort()
  assert.equal(
    registered.length,
    EXPECTED_TOOLS,
    `期望注册 ${EXPECTED_TOOLS} 个工具，实际 ${registered.length} 个。注册失败的工具只会在日志留 warning，` +
      `而收尾日志的计数是硬编码的、会说谎。已注册：${names.join(', ')}`,
  )
  for (const required of [
    'ur_connect', 'ur_movej', 'ur_movel', 'ur_draw_circle', 'ur_get_int_register', 'ur_servoj',
    // 0.5.0 新增能力
    'ur_set_freedrive', 'ur_set_teach_mode', 'ur_power_on', 'ur_power_off', 'ur_brake_release',
    'ur_unlock_protective_stop', 'ur_shutdown', 'ur_get_runtime_telemetry', 'ur_get_speed_scaling',
    'ur_get_tcp_force', 'ur_set_gravity', 'ur_zero_ftsensor', 'ur_get_tool_analog_in',
    'ur_set_conveyor_tracking',
  ]) {
    assert.ok(names.includes(required), `缺少关键工具 ${required}`)
  }
  assert.equal(new Set(names).size, names.length, '工具名不得重复（重名会让后者静默覆盖前者）')
})

test('每个工具的参数 schema 只使用 DSL 支持的关键字（DSH 1.5.3 起）', async () => {
  const { registered } = await collectTools()
  const violations = []
  for (const tool of registered) {
    if (tool.parameters === undefined) continue
    // tool.parameters 是**隐式属性映射**（键=参数名），故以 isMap 起步
    checkNode(tool.parameters, `${tool.name}.parameters`, violations, { isMap: true })
  }
  assert.deepEqual(
    violations,
    [],
    '以下作者关键字不被值 schema DSL 支持，会导致**该工具整个注册失败**（只在日志留一行 warning）。' +
      '数值范围请写进 description，强制校验请放 python/ur_worker.py：\n' +
      violations.join('\n'),
  )
})

test('每个参数字段都有 description（DSL 不再校验取值，描述是模型唯一的依据）', async () => {
  const { registered } = await collectTools()
  const missing = []
  for (const tool of registered) {
    missingDescriptions(tool.parameters, tool.name, missing, true)
  }
  assert.deepEqual(missing, [], `以下参数缺少 description：${missing.join(', ')}`)
})

test('上报的注册数量必须是真实值（硬编码计数会在工具缺失时说谎）', async () => {
  // 成功路径：如实报告 N/N
  const ok = await collectTools()
  assert.ok(
    ok.infos.some((line) => line.includes(`已注册 ${EXPECTED_TOOLS}/${EXPECTED_TOOLS}`)),
    `成功路径应如实报告 ${EXPECTED_TOOLS}/${EXPECTED_TOOLS}，实际 info：${ok.infos.join(' | ') || '(none)'}`,
  )

  // 失败路径：只报告真实成功数，并列出失败原因（v0.3.9 事故的回归测试）
  let calls = 0
  const { warnings, infos } = await collectWithTools({
    register() {
      calls += 1
      if (calls === 1) throw new Error('boom')
    },
  })
  const summary = warnings.join('\n')
  assert.match(summary, new RegExp(`只注册了 ${EXPECTED_TOOLS - 1}/${EXPECTED_TOOLS}`),
    `失败路径必须报告真实成功数，实际：${summary || '(none)'}`)
  assert.match(summary, /boom/, '失败原因必须出现在告警里')
  assert.doesNotMatch(infos.join('\n'), /已注册/, '存在失败时不得打印成功计数')
})

test('宿主 tools.register 缺失或变更时必须指明原因，且不得谎报成功', async () => {
  const changedApi = await collectWithTools({})
  assert.match(changedApi.warnings.join('\n'), /register 不是函数/, 'API 变更必须被明确指出')
  assert.doesNotMatch(changedApi.infos.join('\n'), /已注册/, '未注册任何工具时不得打印成功计数')

  const noService = await collectWithTools(undefined)
  assert.match(noService.warnings.join('\n'), /未组合 tools 服务/, '缺少 tools 服务必须被明确指出')
  assert.doesNotMatch(noService.infos.join('\n'), /已注册/, '未注册任何工具时不得打印成功计数')
})

test('自检：本测试确实能抓到不受支持的关键字（防止测试空跑）', () => {
  const bad = { ip: { type: 'string', required: true, minimum: 0, description: 'x' } }
  const found = checkNode(bad, 'demo.parameters', [], { isMap: true })
  assert.deepEqual(found, ['demo.parameters.ip.minimum'], '未受支持的关键字必须被检出')

  const ok = { ip: { type: 'string', required: true, description: 'x' } }
  assert.deepEqual(checkNode(ok, 'demo.parameters', [], { isMap: true }), [], '合法 schema 不得误报')

  const badNested = { q: { type: 'array', items: { type: 'number', maximum: 1, description: 'y' }, description: 'z' } }
  assert.deepEqual(checkNode(badNested, 'demo.parameters', [], { isMap: true }), ['demo.parameters.q[].maximum'])
})

/* ------------------------------------------------------------------ *
 * 跨语言契约：host 侧的 op 名必须在 Python 里真实存在
 * ------------------------------------------------------------------ */

/** 静态抽出 lib/index.js 里 { op, toolName } 的配对。 */
function toolOps() {
  const pairs = []
  const re = /\{\s*op:\s*'([a-z_0-9]+)',\s*\n\s*toolName:\s*'([a-zA-Z_0-9]+)'/g
  let m
  while ((m = re.exec(indexSource)) !== null) pairs.push({ op: m[1], toolName: m[2] })
  return pairs
}

/** 通过真实 Python 读出 HANDLERS 的 op 名（不靠正则猜 Python 语法）。 */
function pythonHandlerNames() {
  const probe = 'import json,sys;sys.path.insert(0,"%s");import ur_worker;'
    + 'sys.stderr.write(json.dumps(sorted(ur_worker.HANDLERS.keys()))+"\\n")'
  const r = spawnSync(process.env.PYTHON ?? 'python', ['-u', '-c', probe.replace('%s', pythonDir.replace(/\\/g, '/'))], {
    encoding: 'utf8',
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })
  assert.equal(r.status, 0, `读取 HANDLERS 失败：${r.stderr}`)
  const line = (r.stderr ?? '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('['))
  assert.ok(line, `未拿到 HANDLERS 列表：${JSON.stringify(r.stderr)}`)
  return JSON.parse(line)
}

test('每个 ur_* 工具背后的 op 必须在 Python HANDLERS 里真实存在（跨语言契约）', () => {
  const pairs = toolOps()
  assert.ok(pairs.length >= EXPECTED_TOOLS,
    `静态抽到的 {op, toolName} 只有 ${pairs.length} 条，少于工具数 ${EXPECTED_TOOLS} —— 抽取规则与源码格式脱节了`)

  const handlers = new Set(pythonHandlerNames())
  const missing = pairs.filter((p) => !handlers.has(p.op))
  assert.deepEqual(
    missing.map((p) => `${p.toolName} → op '${p.op}'`),
    [],
    'host 注册了工具，但 Python 侧没有对应的 op —— 调用时只会得到一句「未知操作」。',
  )
})

test('op 名与控制器的 dashboard 命令**不得同名**（曾经撞名让优雅关闭静默失效）', () => {
  // 回归门禁：0.5.0 新增的"关闭控制器"用了 op 名 `shutdown`，而 host 的优雅关闭也叫
  // `shutdown` ⇒ 后者被解析成前者，于是既报 KeyError: 'ip'，又永远不会真的退出 worker
  // （worker.js 的优雅关闭只能靠超时收场，而它存在的意义正是"别用 kill 打断 RTDE 会话"）。
  assert.match(workerSource, /"shutdown_worker": op_shutdown_worker/,
    '优雅关闭必须用一个不会与 dashboard 命令撞名的 op 名（shutdown_worker）')
  assert.match(workerSource, /"shutdown": op_shutdown,/, '关闭控制器的 op 仍是 shutdown')

  // worker.js 必须调用那个不撞名的 op。
  const workerSourceJs = readFileSync(fileURLToPath(new URL('../lib/worker.js', import.meta.url)), 'utf8')
  assert.match(workerSourceJs, /this\.call\('shutdown_worker'/,
    "worker.js 的 shutdown() 必须调用 'shutdown_worker'，否则优雅关闭永远超时")
})

test('每个 op 最多被一个工具使用，且工具名不得重复（重名会让后者静默覆盖前者）', () => {
  const pairs = toolOps()
  const byOp = new Map()
  for (const p of pairs) {
    byOp.set(p.op, (byOp.get(p.op) ?? 0) + 1)
  }
  const dupOps = [...byOp.entries()].filter(([, n]) => n > 1).map(([op]) => op)
  assert.deepEqual(dupOps, [], `同一个 op 被多个工具使用会让审计/审批语义混乱：${dupOps.join(', ')}`)

  const names = pairs.map((p) => p.toolName)
  assert.equal(new Set(names).size, names.length, '工具名必须唯一')
})

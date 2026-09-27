/**
 * test/approval-gate.test.mjs — 运动审批门禁的**行为**测试（不是声明测试）。
 *
 * ## 为什么必须有这个文件
 * 门禁是语言模型与一台真机械臂之间唯一的那道人工确认。此前没有任何测试真正**驱动**过它：
 * 唯一的引用是 `tool-frame-moves.test.mjs` 里对 `APPROVAL_OPS` *声明*的一行正则，因此把
 * `lib/index.js` 里 `execute()` 的门禁语句整段删掉，21 个测试文件依然全绿 —— 一次静默的
 * 安全回归可以完全不被察觉。
 *
 * 本文件用真实的 `apply()` + 真实的 `defineTool`（只桩掉 peer）驱动，并断言四件事：
 *   1. 受门禁的 op：批准前**绝不**到达 worker；批准后才放行。
 *   2. 拒绝 / 未组合审批服务 / 无 agent ⇒ 三种情况都**失败关闭**（fail-closed），且不下发。
 *   3. `requireApprovalForMotion: false` 时不过门禁（显式关闭开关要真的关掉）。
 *   4. **回归守卫**：模型多传一个 `op` 字段无法把调用改派到别的 op。
 *      `lib/worker.js` 拼载荷时是 `{ id, op, _timeout_ms, ...params }`，`params` 展开在最后，
 *      而门禁判定用的是闭包里的 `op` —— 于是"未受门禁的工具 + 多传 op=power_off"曾经能
 *      绕过全部 38 个受门禁指令（host-audit H-1）。现在线上参数按工具声明白名单过滤。
 *
 * 运行：node test/approval-gate.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// 只桩掉两个 peer 依赖；worker.js 是本地文件，真实加载。
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
      // 必须既能链式调用（`z.object({...}).default(...)`）又能**被调用**（`z.string()`），
      // 否则真实的 `mod.apply()` 会在解析 Config 时抛错并被它自己的 try/catch 吞掉 ——
      // 表现是"一个工具都没注册"，而不是失败得清楚。
      return {
        format: 'module',
        shortCircuit: true,
        source: `
          const chain = new Proxy(function () {}, {
            get: () => (...a) => chain,
            apply: () => chain,
            construct: () => chain,
          })
          const z = new Proxy({}, { get: () => chain, apply: () => chain })
          export default z
        `,
      }
    }
    return nextLoad(url, context)
  },
})

/**
 * 驱动真实的 apply()，拿到注册的 tool 定义，并把 worker 换成记录器。
 *
 * ⚠️ 顺序很重要：`apply()` 会**当场**新建 `UrWorker` 并在闭包里捕获它，所以必须在调用
 * `apply()` **之前**替换 `UrWorker.prototype.call` —— 否则记录器接不上，测试会对着一个真去
 * spawn 子进程的 worker 断言（表现为"没有调用记录"，而不是失败得清楚）。
 */
async function harness({ config = {}, approvalOutcome = 'allowed-once', approvalService = 'present' } = {}) {
  const mod = await import('../lib/index.js')
  const { UrWorker } = await import('../lib/worker.js')
  const registered = new Map()
  const calls = []
  const approvalRequests = []

  UrWorker.prototype.call = async function call(op, params) {
    calls.push({ op, params })
    return { message: `stub:${op}`, data: { op, params } }
  }

  const approval =
    approvalService === 'missing'
      ? undefined
      : {
          async request(req) {
            approvalRequests.push(req)
            if (approvalOutcome instanceof Error) throw approvalOutcome
            return approvalOutcome
          },
        }

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    effect: () => () => {},
    get: (name) => (name === 'approval' ? approval : undefined),
    inject: () => () => {},
    tools: { register: (tool) => registered.set(tool.name, tool) },
  }
  mod.apply(ctx, config)

  return { registered, calls, approvalRequests }
}

const AGENT = { id: 'agent-1' }
const exec = { agent: AGENT, signal: undefined }

test('受门禁的 op：批准前绝不下发；批准后才下发', async () => {
  const { registered, calls, approvalRequests } = await harness({ approvalOutcome: 'denied' })
  const movej = registered.get('ur_movej')
  assert.ok(movej, '未注册 ur_movej')

  await assert.rejects(
    () => movej.execute({ ip: '1.2.3.4', q: [0, 0, 0, 0, 0, 0] }, exec),
    /未获人工批准/,
    '被拒绝时必须抛错（fail-closed）',
  )
  assert.equal(calls.length, 0, '被拒绝的指令绝不能到达 worker')

  const ok = await harness({ approvalOutcome: 'allowed-once' })
  const movej2 = ok.registered.get('ur_movej')
  await movej2.execute({ ip: '1.2.3.4', q: [0, 0, 0, 0, 0, 0] }, exec)
  assert.deepEqual(ok.calls.map((c) => c.op), ['movej'], '批准后必须下发到 worker')
  assert.equal(ok.approvalRequests.length, 1, '必须恰好请求一次人工确认')
  assert.equal(ok.approvalRequests[0].toolName, 'ur_movej')
})

test('未受门禁的只读 op 不请求确认，且照常下发', async () => {
  const { registered, calls, approvalRequests } = await harness()
  await registered.get('ur_get_tcp_pose').execute({ ip: '1.2.3.4' }, exec)
  assert.equal(approvalRequests.length, 0, '只读指令不该打扰人')
  assert.deepEqual(calls.map((c) => c.op), ['get_tcp_pose'])
})

test('fail-closed：无审批服务 / 无 agent / 审批抛异常，三种都不下发', async () => {
  // 1) 没有审批服务
  {
    const { registered, calls } = await harness({ approvalService: 'missing' })
    await assert.rejects(
      () => registered.get('ur_power_off').execute({ ip: '1.2.3.4' }, exec),
      /未组合审批服务/,
    )
    assert.equal(calls.length, 0)
  }
  // 2) 有服务但这次调用没有 agent（无法路由到会话审批）
  {
    const { registered, calls } = await harness()
    await assert.rejects(
      () => registered.get('ur_power_off').execute({ ip: '1.2.3.4' }, { signal: undefined }),
      /无 agent/,
    )
    assert.equal(calls.length, 0)
  }
  // 3) 审批服务自己抛异常 —— 绝不能被当成"默许"
  {
    const { registered, calls } = await harness({ approvalOutcome: new Error('backend down') })
    await assert.rejects(() => registered.get('ur_power_off').execute({ ip: '1.2.3.4' }, exec), /backend down/)
    assert.equal(calls.length, 0, '审批服务异常时绝不能下发')
  }
  // 4) 非 allowed-once 的任何返回值都算未批准。
  //    注意：这里**不能**用 `undefined` 来代表"审批方没给结论" —— harness 的默认参数会在
  //    `undefined` 时回落到 'allowed-once'（JS 默认参数的语义），那样断言测的是别的东西。
  //    用 `null`（审批服务返回了空值），并且下面单独测一次"服务根本不返回值"。
  for (const outcome of ['denied', 'timeout', 'allowed-always', null, false, 0, '']) {
    const { registered, calls } = await harness({ approvalOutcome: outcome })
    await assert.rejects(
      () => registered.get('ur_brake_release').execute({ ip: '1.2.3.4' }, exec),
      /未获人工批准/,
      `outcome=${String(outcome)} 必须被视为未批准`,
    )
    assert.equal(calls.length, 0)
  }
  // 5) 审批通道存在但**什么都不返回**（真实世界里的"没人应答"）
  {
    const mod = await import('../lib/index.js')
    const { UrWorker } = await import('../lib/worker.js')
    const calls = []
    UrWorker.prototype.call = async function (op, params) {
      calls.push({ op, params })
      return { message: 'stub', data: {} }
    }
    const registered = new Map()
    mod.apply(
      {
        logger: { info() {}, warn() {}, error() {} },
        effect: () => () => {},
        get: (n) => (n === 'approval' ? { async request() {} } : undefined),
        inject: () => () => {},
        tools: { register: (t) => registered.set(t.name, t) },
      },
      {},
    )
    await assert.rejects(
      () => registered.get('ur_brake_release').execute({ ip: '1.2.3.4' }, exec),
      /未获人工批准/,
    )
    assert.equal(calls.length, 0, '审批无应答时绝不能下发')
  }
})

test('requireApprovalForMotion=false 时才真正放行', async () => {
  const { registered, calls, approvalRequests } = await harness({
    config: { requireApprovalForMotion: false },
    approvalOutcome: 'denied',
  })
  await registered.get('ur_power_off').execute({ ip: '1.2.3.4' }, exec)
  assert.equal(approvalRequests.length, 0, '显式关闭后不应再问')
  assert.deepEqual(calls.map((c) => c.op), ['power_off'])
})

test('回归守卫（H-1）：模型多传 op 字段无法把调用改派到别的 op', async () => {
  // 未受门禁的工具 + 注入 op=power_off。旧实现会把载荷拼成
  // { id, op:'get_tcp_pose', _timeout_ms, ...{op:'power_off'} } ⇒ worker 执行 power_off 且无人确认。
  //
  // 用 ur_get_tcp_pose 而不是 ur_ping：后者**没有声明任何参数**（`parameters: {}`），
  // 所以白名单按定义会把 ip 也丢掉，断言就说明不了"注入被挡住"。
  const { registered, calls, approvalRequests } = await harness()
  const tool = registered.get('ur_get_tcp_pose')
  assert.ok(tool, '未注册 ur_get_tcp_pose')

  await tool.execute({ ip: '1.2.3.4', op: 'power_off', id: 4242, _timeout_ms: 1 }, exec)

  assert.deepEqual(calls.map((c) => c.op), ['get_tcp_pose'], 'op 只能来自工具定义，不能被参数改写')
  assert.equal(approvalRequests.length, 0, 'get_tcp_pose 本身不受门禁')
  const sent = calls[0].params
  assert.equal(sent.op, undefined, '注入的 op 不得进入 worker 参数')
  assert.equal(sent.id, undefined, '注入的 id 不得进入 worker 参数')
  assert.equal(sent._timeout_ms, undefined, '注入的 _timeout_ms 不得进入 worker 参数')
  assert.deepEqual(Object.keys(sent), ['ip'], '线上参数只能是该工具声明的键')
  assert.equal(sent.ip, '1.2.3.4', '声明的参数必须原样保留')
})

test('声明了参数的只读工具同样只传它声明的键', async () => {
  const { registered, calls } = await harness()
  await registered.get('ur_get_int_register').execute({ ip: '1.2.3.4', index: 3, op: 'shutdown' }, exec)
  assert.deepEqual(calls.map((c) => c.op), ['get_int_register'])
  assert.deepEqual(calls[0].params, { ip: '1.2.3.4', index: 3 })
})

test('门禁默认值必须落在代码里：apply() 收到未经 schema 解析的裸 config 时仍然受门禁', async () => {
  // Config 的 `z.boolean().default(true)` 由宿主应用；但 apply() 是导出函数，任何人用裸对象
  // 调用它（测试桩、脚本化装配）都不会经过 schema。门禁因此**不能**只靠 schema 的默认值 ——
  // 否则一次"没解析 schema"就会静默关掉整道安全门（fail-open）。
  const { registered, calls, approvalRequests } = await harness({
    config: {}, // 显式：requireApprovalForMotion 未给
    approvalOutcome: 'denied',
  })
  await assert.rejects(
    () => registered.get('ur_power_off').execute({ ip: '1.2.3.4' }, exec),
    /未获人工批准/,
    'config 里没写 requireApprovalForMotion 时，门禁必须默认开启',
  )
  assert.equal(approvalRequests.length, 1, '必须问了人工')
  assert.equal(calls.length, 0, '必须没有下发')
})

test('回归守卫（H-1 的对称面）：受门禁的工具同样无法被改派成别的 op', async () => {
  const { registered, calls, approvalRequests } = await harness({ approvalOutcome: 'denied' })
  const movej = registered.get('ur_movej')
  await assert.rejects(
    () => movej.execute({ ip: '1.2.3.4', q: [0, 0, 0, 0, 0, 0], op: 'get_tcp_pose' }, exec),
    /未获人工批准/,
    '即使注入 op 也必须先过 movej 的门禁',
  )
  assert.equal(calls.length, 0)
  assert.equal(approvalRequests.length, 1)
})

test('声明层守卫：APPROVAL_OPS 里每个名字都必须是真实存在的 op，且兄弟 op 不得一个门禁一个不门禁', async () => {
  const { registered } = await harness()
  const indexSource = (await import('node:fs')).readFileSync(
    new URL('../lib/index.js', import.meta.url),
    'utf8',
  )
  const block = /const APPROVAL_OPS = new Set\(\[(.*?)\]\);/s.exec(indexSource)?.[1] ?? ''
  const gated = new Set([...block.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]))
  assert.ok(gated.size > 0, '未能解析出 APPROVAL_OPS')

  // 1) 拼错的 op 名等于"该指令其实没被门禁" —— 必须抓到
  const pythonSource = (await import('node:fs')).readFileSync(
    new URL('../python/ur_worker.py', import.meta.url),
    'utf8',
  )
  const ops = new Set([...pythonSource.matchAll(/"([a-z_0-9]+)": op_/g)].map((m) => m[1]))
  const stale = [...gated].filter((name) => !ops.has(name))
  assert.deepEqual(stale, [], `APPROVAL_OPS 里有不存在的 op（门禁对它是空转）：${stale.join(', ')}`)

  // 2) 成对的 op 必须同时受门禁（set_payload 与 set_payload_inertia 都改负载并归零力传感器）
  for (const [a, b] of [
    ['set_payload', 'set_payload_inertia'],
    ['zero_ftsensor', 'set_payload'],
  ]) {
    assert.equal(
      gated.has(a),
      gated.has(b),
      `${a} 与 ${b} 副作用同类（都改变力/力矩测量基准），不得一个门禁一个不门禁`,
    )
  }
})

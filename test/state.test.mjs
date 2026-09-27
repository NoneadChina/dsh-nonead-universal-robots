// test/state.test.mjs — Task 6：客户端轮询状态源。
// 直接运行（不要用 npm test，当前沙箱下 npm 的 piped stdio 会 spawn EPERM）：
//   node --test test/state.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextInterval } from '../src/client/state.js'

/** 轮询等待条件成立，超时即失败（避免用固定 sleep 造成偶发假绿）。 */
async function waitFor(predicate, { timeoutMs = 1000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 2))
  }
  throw new Error(`waitFor timed out: ${label}`)
}

test('成功时回到基础间隔', () => {
  assert.equal(nextInterval(2000, true, 100, 2000), 100)
})

test('失败时按指数退避并有上限', () => {
  assert.equal(nextInterval(100, false, 100, 2000), 200)
  assert.equal(nextInterval(1600, false, 100, 2000), 2000)
  assert.equal(nextInterval(2000, false, 100, 2000), 2000)
})

// **Ruling 22 守卫**：共享常量模块必须保持**零 import** —— 这是它能否被 esbuild 安全
// 内联进浏览器 bundle 的唯一前提。一旦有人往里加 import，这条测试立即失败。
test('lib/twin-paths.js 必须零 import（浏览器 bundle 安全前提）', async () => {
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(new URL('../lib/twin-paths.js', import.meta.url), 'utf8')
  assert.equal(/^\s*(import\s|export\s+[^;]*\bfrom\s)/m.test(src), false, 'twin-paths.js 不得有任何 import/from')
  const mod = await import('../src/client/state.js')
  assert.equal(mod.TWIN_STATE_PATH, '/dsh-nonead-ur/twin/state')
})

test('start/stop 可重复调用且 stop 后不再取数', async () => {
  let calls = 0
  const fakeFetch = async () => ({ json: async () => { calls++; return { connected: true, model: 'UR3', q: [0,0,0,0,0,0], tcp: [0,0,0,0,0,0], ts: 1 } } })
  const { createTwinState } = await import('../src/client/state.js')
  const s = createTwinState({ fetchImpl: fakeFetch, ip: '1.2.3.4', baseMs: 5, maxMs: 10 })
  s.start(); s.start()                       // 重复 start 不得并行出两条轮询链
  await new Promise((r) => setTimeout(r, 40))
  s.stop(); s.stop()
  const seen = calls
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(calls, seen, 'stop 之后不得再有新的取数')
  assert.ok(seen >= 1)
})

// ---------------------------------------------------------------------------
// 以下为简报「其它行为要求」的守卫测试（计划 Step 1 只列了上面 4 块）。
// ---------------------------------------------------------------------------

test('重复 start 不产生并行轮询链：同一时刻只有一次取数在飞行中', async () => {
  const { createTwinState } = await import('../src/client/state.js')
  let inFlight = 0
  let maxInFlight = 0
  let calls = 0
  const fakeFetch = async () => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    calls++
    await new Promise((r) => setTimeout(r, 12))
    inFlight--
    return { json: async () => ({ connected: true, model: 'UR3', q: [], tcp: [], ts: calls }) }
  }
  const s = createTwinState({ fetchImpl: fakeFetch, ip: '1.2.3.4', baseMs: 5, maxMs: 10 })
  s.start(); s.start(); s.start()
  await new Promise((r) => setTimeout(r, 80))
  s.stop()
  assert.equal(maxInFlight, 1, `同一时刻只应有一次取数在飞行中，实际 ${maxInFlight}`)
  assert.ok(calls >= 2, `应至少取数两次，实际 ${calls}`)
})

// `stop()` 不会中止已发出的请求：若 stop 后立刻 start，旧链的请求回来时不得再续链，
// 否则会残留一条孤儿轮询链，且 `stop()` 只清得掉最后登记的那个定时器。
test('stop 后紧接 start（旧请求仍在飞行）不得遗留孤儿轮询链', async () => {
  const { createTwinState } = await import('../src/client/state.js')
  let calls = 0
  const fakeFetch = async () => {
    calls++
    await new Promise((r) => setTimeout(r, 20))
    return { json: async () => ({ connected: true, model: 'UR3', q: [], tcp: [], ts: calls }) }
  }
  const s = createTwinState({ fetchImpl: fakeFetch, ip: '1.2.3.4', baseMs: 5, maxMs: 10 })
  s.start()
  await waitFor(() => calls === 1, { label: 'first request sent' })
  s.stop()                                    // 链 A 的请求仍在飞行
  s.start()                                   // 重启：链 A 回来后必须自行退出
  await new Promise((r) => setTimeout(r, 80)) // 让存活的链进入稳定循环
  s.stop()
  const frozen = calls
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(calls, frozen, 'stop 之后不得再有取数（否则说明残留了孤儿轮询链）')
})

test('请求体拼接：路径带 ip 查询参数且被 URL 编码', async () => {
  const { createTwinState, TWIN_STATE_PATH } = await import('../src/client/state.js')
  const urls = []
  const fakeFetch = async (url) => {
    urls.push(url)
    return { json: async () => ({ connected: true, model: 'UR3', q: [], tcp: [], ts: 1 }) }
  }
  const s = createTwinState({ fetchImpl: fakeFetch, ip: '192.168.1.199', baseMs: 5, maxMs: 10 })
  s.start()
  await waitFor(() => urls.length >= 1, { label: 'first fetch' })
  s.stop()
  assert.equal(urls[0], `${TWIN_STATE_PATH}?ip=192.168.1.199`)
})

// **Ruling 21**：`connected !== true` 不算成功 —— 必须退避，否则对着离线机器人 10 Hz 空转。
test('未连接不算成功：走退避，且保留上一次的 model/q/tcp', async () => {
  const { createTwinState } = await import('../src/client/state.js')
  let online = true
  const fakeFetch = async () => ({
    json: async () => (online
      ? { connected: true, model: 'UR5', q: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], tcp: [1, 2, 3, 4, 5, 6], ts: 111 }
      : { connected: false, reason: 'robot offline' }),
  })
  const s = createTwinState({ fetchImpl: fakeFetch, ip: '10.0.0.5', baseMs: 5, maxMs: 20 })
  s.start()
  await waitFor(() => s.getSnapshot().connected === true, { label: 'connected' })
  online = false
  await waitFor(() => s.getSnapshot().connected === false && s.getSnapshot().error, { label: 'disconnected' })
  const snap = s.getSnapshot()
  assert.equal(snap.model, 'UR5', '失败时不得清空 model')
  assert.deepEqual(snap.q, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], '失败时不得清空 q')
  assert.deepEqual(snap.tcp, [1, 2, 3, 4, 5, 6], '失败时不得清空 tcp')
  assert.equal(snap.error, 'robot offline')
  s.stop()
})

test('fetch 抛错时写 error、保留上次数据，且轮询不中断', async () => {
  const { createTwinState } = await import('../src/client/state.js')
  let calls = 0
  const fakeFetch = async () => {
    calls++
    if (calls === 1) return { json: async () => ({ connected: true, model: 'UR10', q: [1], tcp: [2], ts: 7 }) }
    throw new Error('network down')
  }
  const s = createTwinState({ fetchImpl: fakeFetch, ip: '10.0.0.6', baseMs: 5, maxMs: 10 })
  s.start()
  await waitFor(() => s.getSnapshot().error === 'network down', { label: 'error written' })
  const snap = s.getSnapshot()
  assert.equal(snap.connected, false)
  assert.equal(snap.model, 'UR10')
  await waitFor(() => calls >= 3, { label: 'polling continues after error' })
  s.stop()
})

test('订阅者回调抛错不中断其它订阅者，也不中断轮询', async () => {
  const { createTwinState } = await import('../src/client/state.js')
  let calls = 0
  const seen = []
  const fakeFetch = async () => ({ json: async () => { calls++; return { connected: true, model: 'UR3', q: [], tcp: [], ts: calls } } })
  const s = createTwinState({ fetchImpl: fakeFetch, ip: '1.1.1.1', baseMs: 5, maxMs: 10 })
  s.subscribe(() => { throw new Error('boom') })
  s.subscribe((snap) => seen.push(snap))
  s.start()
  await waitFor(() => seen.length >= 3, { timeoutMs: 1500, label: 'healthy subscriber keeps receiving' })
  s.stop()
  assert.ok(seen.length >= 3, `第二个订阅者应持续收到通知，实际 ${seen.length}`)
})

test('unsubscribe 之后不再收到通知', async () => {
  const { createTwinState } = await import('../src/client/state.js')
  let calls = 0
  const seen = []
  const fakeFetch = async () => ({ json: async () => { calls++; return { connected: true, model: 'UR3', q: [], tcp: [], ts: calls } } })
  const s = createTwinState({ fetchImpl: fakeFetch, ip: '1.1.1.1', baseMs: 5, maxMs: 10 })
  const off = s.subscribe((snap) => seen.push(snap))
  s.start()
  await waitFor(() => seen.length >= 2, { label: 'two notifications' })
  off()
  const frozen = seen.length
  await new Promise((r) => setTimeout(r, 40))
  s.stop()
  assert.equal(seen.length, frozen, 'unsubscribe 之后不得再收到通知')
})

test('getSnapshot 初始形状可用，且每轮返回新对象', async () => {
  const { createTwinState } = await import('../src/client/state.js')
  const s = createTwinState({ fetchImpl: async () => ({ json: async () => ({ connected: true, model: 'UR3', q: [], tcp: [], ts: 1 }) }), ip: '1.1.1.1', baseMs: 5, maxMs: 10 })
  const before = s.getSnapshot()
  assert.equal(before.connected, false)
  assert.equal(before.error, null)
  assert.ok(Array.isArray(before.q) && Array.isArray(before.tcp))
  s.start()
  await waitFor(() => s.getSnapshot().connected === true, { label: 'connected' })
  s.stop()
  assert.notEqual(s.getSnapshot(), before, '新一轮应赋新快照对象')
})

test('后台标签降频容错 Node（无 document 不抛错），且 hidden=true 时仍持续轮询', async () => {
  const { createTwinState } = await import('../src/client/state.js')
  let calls = 0
  const fakeFetch = async () => ({ json: async () => { calls++; return { connected: true, model: 'UR3', q: [], tcp: [], ts: calls } } })
  const s = createTwinState({ fetchImpl: fakeFetch, ip: '1.2.3.4', baseMs: 5, maxMs: 20 })

  // Node 环境没有 document：默认分支不得抛错。
  assert.equal(typeof document, 'undefined')
  s.start()
  await waitFor(() => calls >= 2, { label: 'polling without document' })
  s.stop()

  // 模拟浏览器后台标签：document.hidden === true ⇒ 降频到 maxMs，但链路不断。
  const before = calls
  globalThis.document = { hidden: true }
  try {
    s.start()
    await waitFor(() => calls > before, { label: 'polling while hidden' })
  } finally {
    s.stop()
    delete globalThis.document
  }
  assert.ok(calls > before)
})

// ── Ruling 35：ip 可省略，省略时不拼 `?ip=`，由 host 解析到当前已连接的机器人 ──
test('省略 ip 时请求的就是裸路径（不带查询串），由 host 解析机器人', async () => {
  const urls = []
  const { createTwinState, TWIN_STATE_PATH } = await import('../src/client/state.js')
  const s = createTwinState({
    ip: undefined,
    baseMs: 5,
    maxMs: 10,
    fetchImpl: async (url) => {
      urls.push(url)
      return { json: async () => ({ connected: false, reason: 'no robot connected' }) }
    },
  })
  s.start()
  await waitFor(() => urls.length >= 1, { label: 'poll without ip' })
  s.stop()
  assert.deepEqual([...new Set(urls)], [TWIN_STATE_PATH], '省略 ip 时不得出现 ?ip= 查询串')
})

test('空白 ip 同样按省略处理；显式 ip 则被正确编码', async () => {
  const urls = []
  const { createTwinState, TWIN_STATE_PATH } = await import('../src/client/state.js')
  const mk = (ip) => createTwinState({
    ip,
    baseMs: 5,
    maxMs: 10,
    fetchImpl: async (url) => {
      urls.push(url)
      return { json: async () => ({ connected: false, reason: 'x' }) }
    },
  })

  const blank = mk('   ')
  blank.start()
  await waitFor(() => urls.length >= 1, { label: 'poll with blank ip' })
  blank.stop()
  assert.equal(urls[urls.length - 1], TWIN_STATE_PATH, '空白 ip 必须按省略处理')

  const explicit = mk('192.168.2.201')
  explicit.start()
  await waitFor(() => urls.some((u) => u.includes('192.168.2.201')), { label: 'poll with explicit ip' })
  explicit.stop()
  const withIp = urls.find((u) => u !== TWIN_STATE_PATH)
  assert.equal(withIp, `${TWIN_STATE_PATH}?ip=192.168.2.201`, '显式 ip 必须编码进查询串')
})

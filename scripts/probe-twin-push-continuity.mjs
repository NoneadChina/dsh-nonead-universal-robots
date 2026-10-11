/**
 * 探针（不是测试）：**推送架构**下，worker 被运动命令占住时孪生流是否仍然连续。
 *
 * 为什么需要它：孪生此前停在「数据已停止更新 Ns」的根因，是它的读与运动命令共用
 * Python worker 那条单线程 stdin 队列 —— 运动确认循环（`_movej_confirm` 等）占住队列，
 * 读就排在后面直到超时。
 *
 * 做法：假 worker 的 `call()` **永不 settle**（精确模拟"队列被占住"），同时提供
 * `telemetry()` 的新鲜读数（模拟 `ur_worker.py` 的 `_twin_push_loop` 主动推送）。
 *
 * 期望：帧照常按 `intervalMs` 到达 —— 孪生不再依赖那条被占住的命令通道。
 * 对照：同一场景下不提供 telemetry 时，流会退化成 stale 通知（修复前的行为）。
 *
 * 运行：node scripts/probe-twin-push-continuity.mjs
 */
import { createServer } from 'node:http'
import { createTwinStreamHandler } from '../lib/twin-routes.js'

const INTERVAL_MS = 100
const OBSERVE_MS = 2000

async function run({ withTelemetry }) {
  const worker = { call: () => new Promise(() => {}) }
  const handler = createTwinStreamHandler({
    worker,
    ...(withTelemetry
      ? { telemetry: () => ({ at: Date.now(), ts: Date.now(), q: [0, 0, 0, 0, 0, 0], tcp: [0, 0, 0.5, 0, 0, 0] }) }
      : {}),
    connectedIps: () => new Set(['1.2.3.4']),
    modelFor: () => 'UR3',
    intervalMs: INTERVAL_MS,
    detailMs: 0,
  })

  const server = createServer((req, res) => {
    if (req.url.startsWith('/twin/stream')) { handler(req, res); return }
    res.writeHead(404)
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const events = []
  const ac = new AbortController()
  const started = Date.now()
  const res = await fetch(`http://127.0.0.1:${port}/twin/stream`, { signal: ac.signal })
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk)
      let at
      while ((at = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        const type = /^event: (.*)$/mu.exec(raw)?.[1] ?? 'state'
        events.push({ at: Date.now() - started, type })
      }
      if (Date.now() - started > OBSERVE_MS) break
    }
  } catch {
    /* aborted */
  }
  ac.abort()
  server.close()
  return events
}

const framesOf = (events) => events.filter((e) => e.type === 'state')
const maxGapOf = (list) => list.slice(1).reduce((max, e, index) => Math.max(max, e.at - list[index].at), 0)

const withPush = await run({ withTelemetry: true })
const withoutPush = await run({ withTelemetry: false })

const pushFrames = framesOf(withPush)
const gap = pushFrames.length >= 2 ? maxGapOf(pushFrames) : Number.POSITIVE_INFINITY
const expected = Math.floor((OBSERVE_MS / INTERVAL_MS) * 0.6)

console.log(`有推送：${withPush.length} 个事件，其中 state 帧 ${pushFrames.length}，最大帧间隔 ${gap === Infinity ? 'n/a' : `${gap}ms`}`)
console.log(`无推送：${withoutPush.length} 个事件，类型 ${[...new Set(withoutPush.map((e) => e.type))].sort().join('/') || '(无)'}`)

const ok = pushFrames.length >= expected && gap <= INTERVAL_MS * 4
console.log(ok
  ? '结论：✅ worker 被运动命令占住时，孪生靠主动推送仍按节拍出帧（运动期间不再停更）'
  : `结论：❌ 期望 ≥${expected} 帧且帧间隔 ≤${INTERVAL_MS * 4}ms —— 检查 twin-routes 的推送缓存分支`)
process.exit(ok ? 0 : 1)

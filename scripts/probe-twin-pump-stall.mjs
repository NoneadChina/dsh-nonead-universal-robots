/**
 * 探针（不是测试）：把宿主的**真实** SSE 处理器（lib/twin-routes.js 的
 * createTwinStreamHandler）挂到一个真实 http 服务上，只换掉 worker ——
 * 模拟"机器人正在运动"时 Python worker 被占住（它是单线程 stdin 队列！）：
 * 前两帧正常，然后一次读卡住 N 秒。
 *
 * 要回答的问题：这 N 秒里宿主到底发了什么？
 *   - 什么都不发 ⇒ 客户端只看到"开着的、安静的流"，画面停在最后一帧且毫无提示
 *     （用户看到的就是"同步两个动作后不动了"）；
 *   - 发一帧"降级/陈旧"事件 ⇒ 客户端至少能知道数据停了。
 */
import { createServer } from 'node:http'
import { createTwinStreamHandler } from '../lib/twin-routes.js'

const BLOCK_AFTER_FRAMES = 2
const BLOCK_MS = 3000
const OBSERVE_MS = 5000

let reads = 0
const worker = {
  call: async (op) => {
    reads += 1
    const mine = reads
    // 第 3 次读开始：worker 被运动命令占住（Python 侧单线程，读要排队）。
    if (mine > BLOCK_AFTER_FRAMES * 2) await new Promise((r) => setTimeout(r, BLOCK_MS))
    if (op === 'get_joint_pose') return { message: '', data: { joint_positions: [mine, 0, 0, 0, 0, 0] } }
    if (op === 'get_tcp_pose') return { message: '', data: { tcp_pose: [0, 0, 0.5, 0, 0, 0] } }
    return { message: '', data: { robot_model: 'UR3' } }
  },
}

const handler = createTwinStreamHandler({
  worker,
  connectedIps: () => new Set(['1.2.3.4']),
  intervalMs: 100,
  detailMs: 0,
})

const server = createServer((req, res) => {
  if (req.url.startsWith('/twin/stream')) { handler(req, res); return }
  res.writeHead(404); res.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const events = []
const ac = new AbortController()
const res = await fetch(`http://127.0.0.1:${port}/twin/stream`, { signal: ac.signal })
const started = Date.now()
const decoder = new TextDecoder()
let buffer = ''
for await (const chunk of res.body) {
  buffer += decoder.decode(chunk)
  let at
  while ((at = buffer.indexOf('\n\n')) !== -1) {
    const raw = buffer.slice(0, at)
    buffer = buffer.slice(at + 2)
    const type = /^event: (.*)$/mu.exec(raw)?.[1] ?? 'message'
    events.push({ at: Date.now() - started, type })
  }
  if (Date.now() - started > OBSERVE_MS) break
}
ac.abort()

console.log(`观察 ${OBSERVE_MS}ms，收到 ${events.length} 个事件：`)
console.log(events.map((e) => `${e.at}ms:${e.type}`).join('  '))
const gap = []
for (let i = 1; i < events.length; i++) gap.push(events[i].at - events[i - 1].at)
const maxGap = gap.length === 0 ? OBSERVE_MS : Math.max(...gap)
console.log(`事件之间的最大间隔：${maxGap}ms（帧间隔应为 100ms）`)
const stalls = events.length === 0 || maxGap > BLOCK_MS
console.log(
  stalls
    ? `结论：worker 被占住期间宿主**一个事件都不发**（静默停帧 ${maxGap}ms）—— 客户端只能看到"开着的流 + 冻住的画面"，没有任何提示`
    : '结论：宿主会发降级事件，客户端能知道数据停了',
)
server.close()
process.exit(0)

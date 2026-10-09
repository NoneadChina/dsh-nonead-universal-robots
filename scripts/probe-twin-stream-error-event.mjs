/**
 * 探针（不是测试）：把孪生**真实的数据通道**端到端跑起来 ——
 *   真实 node:http SSE 服务端（复用 lib/twin-routes.js 的 createTwinStreamHandler）
 *   → 真实浏览器语义的 EventSource（undici 的实现，逐条按 HTML 规范）
 *   → 插件真实的客户端订阅器 src/client/robot/twin-stream.js
 * 目的是回答一个只能靠实测回答的问题：
 *   服务器按**它自己的文档策略**发一个 `event: error`（"这一帧读失败了"），
 *   客户端会不会把整条流拆掉？
 *
 * undici 的 EventSource 把 `onerror` 实现成 `addEventListener('error', …)`
 * （eventsource.js:414-427），而服务端事件是按 `event:` 字段派发的
 * （eventsource.js:296 `dispatchEvent(createFastMessageEvent(event.type, …))`）
 * ⇒ 一个名叫 `error` 的服务端事件会命中 `onerror`。探针就是要把这件事钉死。
 */
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { createTwinStream } from '../src/client/robot/twin-stream.js'

/**
 * 找一个**符合规范的** EventSource 实现。
 *
 * 本插件自己不依赖 undici（浏览器里用全局 `EventSource`），所以这里按可用的候选依次找：
 *   1. Node 的全局 `EventSource`（22.3+ 起可用，部分版本需要 `--experimental-eventsource`）；
 *   2. 已安装的 DSH 桌面应用里的 undici（`DSH_APP_DIR` 或默认安装路径）；
 *   3. `undici` 包本身（若本仓库装了）。
 * 都找不到就**明确报错**，而不是静默退化成一个不模拟 `onerror` 的假实现 —— 那样这个探针就
 * 变成了自欺欺人（它要证的恰恰是"服务端 error 事件会命中 onerror"这条浏览器语义）。
 */
async function resolveEventSource() {
  if (typeof globalThis.EventSource === 'function') return globalThis.EventSource

  const candidates = []
  if (process.env.DSH_APP_DIR) {
    candidates.push(`${process.env.DSH_APP_DIR}/node_modules/dshmarket/node_modules/undici/index.js`)
  }
  candidates.push('D:/Software/Nonead DSH Desktop/resources/app/node_modules/dshmarket/node_modules/undici/index.js')
  candidates.push('undici')
  for (const candidate of candidates) {
    const specifier = candidate === 'undici' || existsSync(candidate)
      ? (candidate === 'undici' ? 'undici' : pathToFileURL(candidate).href)
      : null
    if (specifier === null) continue
    try {
      const mod = await import(specifier)
      if (typeof mod.EventSource === 'function') return mod.EventSource
    } catch {
      /* 试下一个候选 */
    }
  }
  throw new Error(
    'probe-twin-stream-error-event: 找不到符合规范的 EventSource 实现。\n' +
      '  Node 22.3+ 可用 `node --experimental-eventsource`，或设 `DSH_APP_DIR` 指向已安装的桌面应用目录。\n' +
      '  这个探针**不能**退化成一个不模拟 onerror 的假实现 —— 那正是它要检验的东西。',
  )
}

const { pathToFileURL } = await import('node:url')
const EventSource = await resolveEventSource()

const PORT = 0
let connections = 0
const server = createServer((req, res) => {
  connections += 1
  const id = connections
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' })
  let n = 0
  const timer = setInterval(() => {
    n += 1
    if (id === 1 && n === 3) {
      // 服务端文档策略：单帧读失败 ⇒ 只发一个 error 事件，绝不拆流。
      res.write(`event: error\ndata: ${JSON.stringify({ message: '这一帧读失败了' })}\n\n`)
      return
    }
    res.write(`event: state\ndata: ${JSON.stringify({ connected: true, model: 'UR3', q: [n, 0, 0, 0, 0, 0], tcp: [0, 0, 0.5, 0, 0, 0], ts: n })}\n\n`)
  }, 20)
  req.on('close', () => clearInterval(timer))
})

await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
const port = server.address().port

const stream = createTwinStream({
  url: `http://127.0.0.1:${port}/twin/stream`,
  EventSourceImpl: EventSource,
  retryMs: 30,
  maxRetries: 3,
})
const frames = []
stream.subscribe((snap) => frames.push(snap))
stream.start()
await new Promise((r) => setTimeout(r, 1200))

console.log(`服务端接受过的连接数：${connections}（>1 说明客户端把流拆了重建）`)
console.log(`客户端状态：${stream.getStatus()}`)
console.log(`收到的帧数：${frames.length}，最后一帧 ts=${frames.at(-1)?.ts}`)
console.log(
  connections === 1 && frames.length > 10
    ? '结论：error 事件没有拆流（当前实现已正确）'
    : '结论：error 事件把整条流拆掉了 —— 与宿主"单帧失败绝不拆流"的文档策略相反',
)
stream.stop()
server.close()
process.exit(0)

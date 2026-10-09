/**
 * 探针（不是测试）：DSH 的 webServer 是**裸 node:http**（见
 * @deepseek-ai/dsh-host-webserver 的 `createServer`），而 node 默认 `server.requestTimeout = 300000`。
 * 本探针回答一个只能靠实测回答的问题：**长时间挂住的 SSE 响应会不会被 requestTimeout 掐断？**
 *   - 若超时是「整条响应最多活 N ms」⇒ 孪生流会在 N 之后被服务器拆掉（客户端只会看到 onerror）；
 *   - 若超时是「socket 空闲 N ms」⇒ 我们每 100 ms 写一帧，永远不空闲，流不会被掐。
 * 用 800 ms 的 requestTimeout + 150 ms 的写间隔，几秒内就能分辨。
 */
import { createServer } from 'node:http'

const REQUEST_TIMEOUT = 800
const WRITE_EVERY = 150
const DURATION = 4000

const server = createServer((req, res) => {
  if (req.url !== '/sse') { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
  let n = 0
  const timer = setInterval(() => {
    n += 1
    res.write(`event: state\ndata: ${JSON.stringify({ n })}\n\n`)
  }, WRITE_EVERY)
  res.on('close', () => {
    clearInterval(timer)
    console.log(`[server] response closed after ${n} frames`)
  })
})
server.requestTimeout = REQUEST_TIMEOUT

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const started = Date.now()
console.log(`[probe] listening :${port}, requestTimeout=${REQUEST_TIMEOUT}ms, write every ${WRITE_EVERY}ms`)

const ac = new AbortController()
const res = await fetch(`http://127.0.0.1:${port}/sse`, { signal: ac.signal })
let frames = 0
let lastAt = started
try {
  const decoder = new TextDecoder()
  for await (const chunk of res.body) {
    const text = decoder.decode(chunk)
    for (const line of text.split('\n')) if (line.startsWith('data:')) frames += 1
    lastAt = Date.now()
    if (lastAt - started > DURATION) break
  }
} catch (e) {
  console.log(`[client] stream error after ${Date.now() - started}ms: ${e.message}`)
}

console.log(`[client] frames=${frames} elapsed=${lastAt - started}ms`)
console.log(
  frames >= 3 && lastAt - started > REQUEST_TIMEOUT
    ? '结论：写活动能让连接活过 requestTimeout ⇒ 它是「socket 空闲」语义，长挂 SSE 不会被掐'
    : '结论：连接在 requestTimeout 附近被掐断 ⇒ requestTimeout 是「响应总时长」语义',
)
ac.abort()
server.close()
process.exit(0)

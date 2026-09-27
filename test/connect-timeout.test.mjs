/**
 * test/connect-timeout.test.mjs — 「连接构造卡死 ⇒ worker 自杀 ⇒ 下次调用换新进程」的行为契约。
 *
 * ## 防的是什么（真实故障）
 * 真机上出现过「连接失败后整个 worker 卡住，必须人工重启」：`UrScriptExt(...)` 的构造会等
 * RTDE 数据就绪（`urScript.py` 里 20×1 s），再叠加 rtde / realTimeClient 各自最长 60 s 的重连
 * 循环，于是构造可能几十秒不返回；而控制器同一时刻**只接受一个 RTDE 客户端**，那个半成品
 * 会话一直占着，下一次调用同样卡住 —— 调用方只会反复收到自己那句笼统的超时。
 *
 * 修法：`python/ur_worker.py` 的 `_connect_or_exit()` 给构造一个硬预算（`CONNECT_TIMEOUT_S`，
 * 且不超过本次请求的 `_timeout_ms`），超预算就 `os._exit(1)`。进程退出才是唯一能可靠释放
 * 那些半成品套接字的方式。`lib/worker.js` 已有配套行为：退出即失败在飞请求，并在**下次调用**
 * 按 `restartDelayMs`（500 ms）退避重启 —— 调用方重试一次即可，不必人工介入。
 *
 * 本测试不去碰机器人：用猴补丁把 `URBasic.urScriptExt.UrScriptExt` 换成一个**永不返回**的构造，
 * 然后断言子进程真的在预算内自己退出、并把「连接超时」这条可读错误写回协议 stdout。
 *
 * 运行：node --test test/connect-timeout.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { UrWorker } from '../lib/worker.js'

const pythonDir = fileURLToPath(new URL('../python/', import.meta.url))
// 工作副本是 CRLF：先归一化，免得正则里的 `\n\n` 边界全部落空。
const workerSource = readFileSync(join(pythonDir, 'ur_worker.py'), 'utf8').replace(/\r\n/g, '\n')

/** 猴补丁脚本：把连接构造换成死循环，然后调用 ensure_connected。 */
const HARNESS = `
import os, sys, tempfile, ur_worker

# 别把测试输出写进插件真实的 ur_worker.log（导入 ur_worker 时会打开它）：
# 把日志句柄换成临时文件，协议通道 _PROTOCOL_OUT 保持不变，断言照旧。
ur_worker._LOG = ur_worker._CappedLog(os.path.join(tempfile.mkdtemp(prefix="ur-ct-"), "t.log"), 4096)
sys.stdout = ur_worker._LOG

class HangingConnector:
    def __init__(self, *args, **kwargs):
        import time
        while True:
            time.sleep(0.25)

ur_worker.URBasic.urScriptExt.UrScriptExt = HangingConnector
ur_worker._CURRENT_REQUEST_ID = 7
ur_worker._CURRENT_TIMEOUT_MS = 1500

try:
    ur_worker.ensure_connected('127.0.0.1')
except BaseException as exc:
    sys.stderr.write('UNEXPECTED: %r\\n' % (exc,))
    sys.exit(2)

sys.stderr.write('UNREACHABLE: ensure_connected returned\\n')
sys.exit(3)
`

test('连接构造卡死时 worker 在预算内自杀，并把可读错误写回协议 stdout', () => {
  const started = Date.now()
  const child = spawnSync(process.env.PYTHON ?? 'python', ['-u', '-c', HARNESS], {
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, PYTHONPATH: pythonDir, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  })
  const elapsedMs = Date.now() - started

  assert.equal(child.error, undefined, `子进程未能运行：${child.error?.message ?? ''}`)
  assert.equal(child.status, 1, `卡死必须以 os._exit(1) 结束；实际 status=${child.status} stderr=${child.stderr}`)
  // 预算 1.5 s：既不能在预算内提前返回（那说明预算没生效），也不能拖到默认的 20 s。
  assert.ok(elapsedMs >= 1000, `退出太快（${elapsedMs}ms），预算似乎没生效`)
  assert.ok(elapsedMs < 10000, `退出太慢（${elapsedMs}ms），硬预算没生效`)

  const lines = child.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'))
  assert.ok(lines.length >= 1, `协议 stdout 上应有一条错误响应，实际：${JSON.stringify(child.stdout)}`)
  const reply = JSON.parse(lines[lines.length - 1])
  assert.equal(reply.id, 7, '错误响应必须带上在飞请求的 id')
  assert.equal(reply.ok, false, '卡的连接必须以 ok=false 回报，而不是假装成功')
  assert.match(reply.error, /超时/, `错误文本应说明是连接超时：${reply.error}`)
  assert.match(reply.error, /127\.0\.0\.1/, `错误文本应点名目标：${reply.error}`)
})

test('契约：硬预算必须小于 Node 侧默认命令超时（否则调用方只看到自己那句笼统超时）', () => {
  const declared = /^CONNECT_TIMEOUT_S\s*=\s*([0-9.]+)/m.exec(workerSource)
  assert.ok(declared, 'ur_worker.py 必须声明 CONNECT_TIMEOUT_S')
  const budgetMs = Number(declared[1]) * 1000

  const worker = new UrWorker({ pythonBin: 'python', pythonDir })
  assert.ok(
    budgetMs < worker.commandTimeoutMs,
    `CONNECT_TIMEOUT_S（${budgetMs}ms）必须小于 UrWorker 默认 commandTimeoutMs（${worker.commandTimeoutMs}ms）`,
  )
  assert.ok(budgetMs >= 5000, `硬预算 ${budgetMs}ms 过小，正常连接（含 RTDE 就绪等待）会被误杀`)
})

test('契约：ensure_connected 走 _connect_or_exit，且超时路径用 os._exit', () => {
  const body = /def ensure_connected\(ip\):[\s\S]*?\n\ndef /.exec(workerSource)
  assert.ok(body, '未找到 ensure_connected 定义')
  assert.match(body[0], /_connect_or_exit\(ip\)/, 'ensure_connected 必须通过 _connect_or_exit 构造连接')
  assert.doesNotMatch(
    body[0],
    /UrScriptExt\(host=/,
    'ensure_connected 不应再直接构造 UrScriptExt —— 那样会绕过硬预算',
  )

  const guard = /def _connect_or_exit\(ip\):[\s\S]*?\n\ndef /.exec(workerSource)
  assert.ok(guard, '未找到 _connect_or_exit 定义')
  assert.match(guard[0], /thread\.join\(budget\)/, '必须用 join(budget) 限时等待构造')
  assert.match(guard[0], /os\._exit\(1\)/, '超预算必须 os._exit(1)（清理会一起卡住）')
  assert.match(guard[0], /respond\(/, '自杀前应把可读错误写回协议 stdout')
})

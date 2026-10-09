/**
 * test/worker.test.mjs — Python worker 进程管理层的契约（`lib/worker.js`）。
 *
 * ## 为什么需要
 * 「连接构造卡死 ⇒ worker 自杀 ⇒ 下次调用换新进程」这条修法的后半程完全依赖本层：
 * - 子进程退出必须让**在飞的请求立即失败**（否则调用方会一直等到自己的命令超时）；
 * - 下一次 `call()` 必须能**重新拉起**一个干净进程，并遵守 `restartDelayMs` 退避
 *   （否则一个开机即崩的 worker 会变成紧凑的崩溃→重启循环）。
 * 这两条此前只有读码确认，没有测试。
 *
 * 做法：把 `pythonDir` 指向一个临时目录，里面放一个**假 worker**（实现往返/自杀/挂住三种行为），
 * 于是不需要机器人、也不需要真插件脚本就能驱动真实的 `UrWorker`。
 *
 * 运行：node --test test/worker.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { UrWorker } from '../lib/worker.js'

const PYTHON = process.env.PYTHON ?? 'python'

/** 假 worker：`echo` 正常回包；`die` 直接退出（模拟崩溃）；`hang` 永不回包。 */
const FAKE_WORKER = `
import json, sys, time

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    op = req.get("op")
    if op == "echo":
        sys.stdout.write(json.dumps({"id": req["id"], "ok": True, "data": {"echo": req.get("v")}}) + "\\n")
        sys.stdout.flush()
    elif op == "fail":
        sys.stdout.write(json.dumps({"id": req["id"], "ok": False, "error": "bad op"}) + "\\n")
        sys.stdout.flush()
    elif op == "fail-coded":
        sys.stdout.write(json.dumps({"id": req["id"], "ok": False, "error": "bad op with code",
                                     "code": "BADARG", "data": {"field": "q"}}) + "\\n")
        sys.stdout.flush()
    elif op == "die":
        sys.exit(3)
    elif op == "hang":
        time.sleep(30)
`

/** 建一个带假 worker 的临时 pythonDir，返回 { dir, worker() , cleanup() }。 */
function fakeWorkerFixture({ restartDelayMs } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ur-worker-test-'))
  writeFileSync(join(dir, 'ur_worker.py'), FAKE_WORKER, 'utf8')
  const workers = []
  return {
    dir,
    worker() {
      const instance = new UrWorker({ pythonBin: PYTHON, pythonDir: dir, ...(restartDelayMs === undefined ? {} : { restartDelayMs }) })
      workers.push(instance)
      return instance
    },
    cleanup() {
      for (const instance of workers) {
        try {
          instance.dispose()
        } catch {
          /* 忽略 */
        }
      }
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('协议往返：call() 解析响应并把 data 交给调用方', async () => {
  const fixture = fakeWorkerFixture()
  try {
    const worker = fixture.worker()
    assert.deepEqual(await worker.call('echo', { v: 42 }), { echo: 42 })
    // ok:false 的响应必须变成 reject，并把 error 文本带出来。
    await assert.rejects(() => worker.call('fail'), /bad op/)
  } finally {
    fixture.cleanup()
  }
})

test('子进程退出：在飞请求立即失败，且错误里带退出码与 stderr', async () => {
  const fixture = fakeWorkerFixture()
  try {
    const worker = fixture.worker()
    await assert.rejects(() => worker.call('die'), /UR worker exited \(code=3/)
  } finally {
    fixture.cleanup()
  }
})

test('退出→退避重启：下一次 call() 在 restartDelayMs 之后拉起干净进程并成功', async () => {
  const fixture = fakeWorkerFixture({ restartDelayMs: 500 })
  try {
    const worker = fixture.worker()
    await assert.rejects(() => worker.call('die'), /exited/)

    // 紧接着再调用：必须等完退避再重启（不是立刻 spawn，也不是永久失效）。
    const started = Date.now()
    assert.deepEqual(await worker.call('echo', { v: 'after-restart' }), { echo: 'after-restart' })
    const elapsed = Date.now() - started
    assert.ok(elapsed >= 400, `重启应遵守 restartDelayMs（实测 ${elapsed}ms）`)
    assert.ok(elapsed < 10000, `重启不应拖太久（实测 ${elapsed}ms）`)
  } finally {
    fixture.cleanup()
  }
})

test('单次调用超时：命令预算到点即 reject，不让调用方被卡死的 worker 拖住', async () => {
  const fixture = fakeWorkerFixture()
  try {
    const worker = fixture.worker()
    const started = Date.now()
    await assert.rejects(() => worker.call('hang', {}, 300), /timed out after 300ms/)
    const elapsed = Date.now() - started
    assert.ok(elapsed >= 250 && elapsed < 5000, `超时应在预算附近触发（实测 ${elapsed}ms）`)

    // 超时之后那个进程**必须**已经被杀掉：worker 是单线程的，挂在里面的请求没有任何
    // 取消机制，不换进程就等于后续每一次调用都会排队等到超时（插件等于死了，却只报
    // 一句笼统的 "timed out"）。
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(worker.proc, null, '超时后必须丢弃子进程句柄')
    assert.equal(worker.stats().running, false, '超时后子进程不应仍在运行')
  } finally {
    fixture.cleanup()
  }
})

test('超时换新进程：下一次 call() 仍然可用（自动恢复，无需人工重启插件）', async () => {
  const fixture = fakeWorkerFixture({ restartDelayMs: 100 })
  try {
    const worker = fixture.worker()
    await assert.rejects(() => worker.call('hang', {}, 300), /timed out/)
    // 同一个 UrWorker 实例：下一次调用必须拉起一个干净的 worker 并成功。
    assert.deepEqual(await worker.call('echo', { v: 'recovered' }), { echo: 'recovered' })
  } finally {
    fixture.cleanup()
  }
})

// ── 0.6.6：孪生的只读遥测**不得**因为超时就杀掉机器人会话 ────────────────────
//
// 机器人执行运动指令时孪生的读会排队（同一条单线程 stdin 队列），用默认预算会在超时时杀掉
// 子进程 —— 连带整条 RTDE/Dashboard 会话，孪生此后永远拿不到位姿。只读读传
// `killOnTimeout:false`：**这一次调用**失败，进程与会话留下。

test('killOnTimeout:false —— 超时只让这一次调用失败，不杀子进程（机器人会话必须活着）', async () => {
  const fixture = fakeWorkerFixture()
  try {
    const worker = fixture.worker()
    await worker.call('echo', { v: 'warm' })
    const procBefore = worker.proc
    assert.ok(procBefore, '先要有一个活着的子进程');

    const error = await worker.call('hang', {}, 300, undefined, { killOnTimeout: false }).then(
      () => null,
      (e) => e,
    );
    assert.ok(error, '超时必须 reject 调用方');
    assert.match(error.message, /timed out after 300ms/);
    assert.equal(error.code, 'WORKER_TIMEOUT', '★ 必须带机器可读的错误码（孪生据此降级成"陈旧帧"）');

    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(worker.proc, procBefore, '★ 不得换/杀子进程：会话（RTDE/Dashboard）在它里面');
    assert.equal(worker.stats().running, true, '子进程必须仍然活着');

    // 会话没死 ⇒ 下一个读立刻可用（这就是"机器人运动完孪生自动跟上"的前提）。
    assert.deepEqual(await worker.call('echo', { v: 'after-timeout' }), { echo: 'after-timeout' });
  } finally {
    fixture.cleanup()
  }
})

test('默认（不传选项）行为不变：超时仍然杀掉子进程以解救卡死的单线程 worker', async () => {
  const fixture = fakeWorkerFixture()
  try {
    const worker = fixture.worker()
    await assert.rejects(() => worker.call('hang', {}, 300), /timed out/)
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(worker.proc, null, '★ 命令类调用的既有语义不得被孪生的需要改掉');
  } finally {
    fixture.cleanup()
  }
})

test('在飞请求上限：超过 maxInFlight 时立即拒绝，不排队等到各自超时', async () => {
  const fixture = fakeWorkerFixture()
  try {
    const worker = new UrWorker({
      pythonBin: PYTHON,
      pythonDir: fixture.dir,
      maxInFlight: 2,
      restartDelayMs: 100,
    })
    const hanging = [worker.call('hang', {}, 30000), worker.call('hang', {}, 30000)]
    // 让前两个请求真的落到 pending 表里
    await new Promise((resolve) => setTimeout(resolve, 200))
    await assert.rejects(() => worker.call('echo', { v: 1 }), /在排队（上限 2）/)
    worker.dispose()
    await Promise.allSettled(hanging)
  } finally {
    fixture.cleanup()
  }
})

test('协议噪声可诊断：无法解析的行与未知 id 会被计数，而不是静默丢弃', async () => {
  const fixture = fakeWorkerFixture()
  try {
    const worker = fixture.worker()
    await worker.call('echo', { v: 1 })
    // 直接驱动内部解析：模拟 URBasic 之类的库往协议通道上乱打印，以及乱序/陌生的响应。
    worker._onLine('not json at all')
    worker._onLine(JSON.stringify({ id: 999999, ok: true, data: {} }))
    const stats = worker.stats()
    assert.equal(stats.droppedLines, 1, '无法解析的行必须被计数')
    assert.equal(stats.unknownResponses, 1, 'id 不认识的响应必须被计数')
    assert.match(stats.lastDroppedLine, /999999|not json/, '必须保留最后一条噪声的线索')
  } finally {
    fixture.cleanup()
  }
})

test('结构化错误码：ok:false 响应里的 code 必须挂到 Error 上', async () => {
  const fixture = fakeWorkerFixture()
  try {
    const worker = fixture.worker()
    await assert.rejects(() => worker.call('fail-coded'), (error) => {
      assert.equal(error.code, 'BADARG', '必须把协议里的 code 透传给调用方')
      assert.match(error.message, /bad op with code/)
      return true
    })
  } finally {
    fixture.cleanup()
  }
})

test('dispose()：结束子进程并让在飞请求以明确原因失败', async () => {
  const fixture = fakeWorkerFixture()
  try {
    const worker = fixture.worker()
    await worker.ensureStarted() // 先让子进程真的起来，避免与 spawn 竞态
    const pending = worker.call('hang', {}, 30000)
    // call() 内部先 await ensureStarted() 再登记 pending，等一个 tick 让请求落到 pending 表里。
    await new Promise((resolve) => setTimeout(resolve, 100))
    worker.dispose()
    await assert.rejects(() => pending, /UR worker was disposed/)
    // dispose 之后不得再拉起新进程（否则插件卸载后还会留下一个 Python 进程）。
    await assert.rejects(() => worker.call('echo', { v: 1 }), /disposed/)
  } finally {
    fixture.cleanup()
  }
})

test('契约：默认退避为 500 ms（与「自杀后约 0.5 s 换新进程」的说法一致）', () => {
  const worker = new UrWorker({ pythonBin: PYTHON, pythonDir: 'unused' })
  assert.equal(worker.restartDelayMs, 500)
  assert.equal(worker.commandTimeoutMs, 60000)
  assert.equal(worker.maxInFlight, 8)
})

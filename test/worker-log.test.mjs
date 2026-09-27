/**
 * test/worker-log.test.mjs — worker 日志必须有上限（防「日志把磁盘写满」）。
 *
 * ## 防的是什么（实测数据）
 * URBasic 的 RTDE 重连失败分支会**每次循环**打印且不 sleep。断链时那是每秒数万行的紧凑循环：
 * 本机 `python/ur_worker.log` 实测被推到 **277 MB / 1076 万行**，其中
 * `RTDE reconnection failed!` 独占 **1076 万行**，同时空转烧 CPU。
 *
 * 两层对策，本文件都钉住：
 *   1. `URBasic/rtde.py` 把该分支的打印限速到每 5 s 一行，并 `time.sleep(0.5)`；
 *   2. `ur_worker.py` 的 `_CappedLog` 给日志文件加硬上限，写满滚成 `<path>.1`
 *      （只保留一份旧文件 ⇒ 磁盘占用被钳在 ~2×上限），且与「谁在写」无关。
 *
 * 测试用**临时路径**验证限幅类本身，不碰真实日志。
 *
 * 运行：node --test test/worker-log.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const pythonDir = fileURLToPath(new URL('../python/', import.meta.url))
const workerSource = readFileSync(join(pythonDir, 'ur_worker.py'), 'utf8').replace(/\r\n/g, '\n')
const rtdeSource = readFileSync(join(pythonDir, 'URBasic', 'rtde.py'), 'utf8').replace(/\r\n/g, '\n')

/** 在临时目录里实例化 `_CappedLog`，写超限内容，报告文件大小与滚动结果。 */
const HARNESS = `
import json, os, sys, tempfile
sys.path.insert(0, ${JSON.stringify(pythonDir)})
import ur_worker

tmp = tempfile.mkdtemp(prefix="ur-log-test-")
path = os.path.join(tmp, "test.log")
cap = 1024
log = ur_worker._CappedLog(path, cap)

# 注意：句柄是行缓冲的（buffering=1），写入必须带换行并 flush 才会落到磁盘 ——
# 真实调用者是 print()，天然带换行。
log.write("A" * 699 + "\\n")   # 700 字节，未超限
log.flush()
size_before_roll = os.path.getsize(path)
log.write("B" * 699 + "\\n")   # 超限 ⇒ 滚成 .1，新文件只含这一笔
log.flush()
size_after_roll = os.path.getsize(path)
rolled_exists = os.path.exists(path + ".1")
rolled_size = os.path.getsize(path + ".1") if rolled_exists else 0
log.write("C" * 699 + "\\n")   # 再滚一次：覆盖 .1，不得产生 .2
log.flush()
result = {
  "cap": cap,
  "size_before_roll": size_before_roll,
  "size_after_roll": size_after_roll,
  "rolled_exists": rolled_exists,
  "rolled_size": rolled_size,
  "final_size": os.path.getsize(path),
  "second_generation_present": os.path.exists(path + ".2"),
  "declared_max_bytes": ur_worker._LOG_MAX_BYTES,
  "log_is_capped": isinstance(ur_worker._LOG, ur_worker._CappedLog),
}
ur_worker._PROTOCOL_OUT.write(json.dumps(result) + "\\n")
ur_worker._PROTOCOL_OUT.flush()
`

test('_CappedLog：写满即滚动，且只保留一代旧日志', () => {
  const child = spawnSync(process.env.PYTHON ?? 'python', ['-u', '-c', HARNESS], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, PYTHONPATH: pythonDir, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  })
  assert.equal(child.status, 0, `探针失败：${child.stderr}`)

  const line = child.stdout.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'))
  assert.ok(line, `未拿到 JSON 结果：${JSON.stringify(child.stdout)}`)
  const got = JSON.parse(line)

  assert.equal(got.size_before_roll, 700, `未超限时不应滚动（实测 ${JSON.stringify(got)}）`)
  assert.equal(got.rolled_exists, true, '超限后应生成 .1')
  assert.equal(got.rolled_size, 700, '.1 应保存滚动前的内容')
  assert.equal(got.size_after_roll, 700, '滚动后新文件只含滚动后写入的那一笔')
  assert.ok(got.final_size <= got.cap + 1400, `现役日志不得超过上限一个量级（实测 ${got.final_size}）`)
  assert.equal(got.second_generation_present, false, '不得累积多代日志（否则磁盘仍会涨）')
  assert.equal(got.log_is_capped, true, 'sys.stdout 必须指向 _CappedLog，否则 URBasic 的 print 不受限')
  assert.ok(got.declared_max_bytes > 0 && got.declared_max_bytes <= 64 * 1024 * 1024,
    `日志上限应在合理范围（实测 ${got.declared_max_bytes}）`)
})

test('契约：RTDE 重连失败分支必须限速且让出 CPU（不得再出现紧凑打印循环）', () => {
  const branch = /if self\.__conn_state == ConnectionState\.STARTED:[\s\S]{0,900}?time\.sleep\(0\.5\)/.exec(rtdeSource)
  assert.ok(branch, '重连失败分支必须包含 time.sleep(0.5)，否则断链时会变成紧凑循环')
  assert.match(branch[0], /last_fail_log/, '失败打印必须限速（last_fail_log）')
  assert.match(rtdeSource, /last_fail_log = 0\.0/, 'last_fail_log 必须在循环前初始化')
})

test('契约：DashboardClient.__send 的失败分支同样必须限速并 sleep', () => {
  // 同一族缺陷的第二处：socket 死掉时 select.select 会立刻抛，而上游在该 except 里无条件 print，
  // 实测单个会话刷出 296,644 行 "Could not send program!" 并把日志推到上限。
  const dashboardSource = readFileSync(join(pythonDir, 'URBasic', 'dashboard.py'), 'utf8').replace(/\r\n/g, '\n')
  const block = /def __send\(self, cmd\):[\s\S]*?\n {4}def /.exec(dashboardSource)
  assert.ok(block, '未找到 DashboardClient.__send')
  const body = block[0]
  const throttle = body.indexOf('if now - last_fail_log >= 5')
  const printAt = body.indexOf('print("Could not send program!")')
  assert.ok(throttle > 0, '失败分支必须有限速判断（last_fail_log）')
  assert.ok(printAt > throttle, 'print 必须落在限速判断之后，不能无条件打印')
  assert.match(body, /time\.sleep\(0\.2\)/, '失败分支必须让出 CPU，否则 select 抛异常时会空转')
  assert.match(dashboardSource, /last_fail_log = 0\.0/, 'last_fail_log 必须在循环前初始化')
})

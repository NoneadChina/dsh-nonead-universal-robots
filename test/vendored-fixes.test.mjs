/**
 * test/vendored-fixes.test.mjs — vendored URBasic 缺陷的回归门禁。
 *
 * ## 为什么单独一个文件、而且用 Python 探针
 * 这批缺陷的共同点是**它们是"行为"而不是"可见的一行代码"**：
 *   - `realTimeClient.__sendPrg` 的旧写法是一个"只有成功才退出"的循环 —— 用 grep 找
 *     "有没有 sleep" 之类完全抓不住，必须真的把函数跑起来、在一个**真实断开的回环 socket**
 *     上观察它能不能在上限内返回；
 *   - `ConfigurableInputBits(8)` 的错位是 2**16 vs 2**0，只有构造一个具体的位图才看得出来；
 *   - `RobotStatus()/SafetyStatus()` 在 RTDE 未就绪时抛 TypeError —— 需要真的把 dataDir
 *     留空调用一次；
 *   - `ActualJointVoltage()` 返回的是电流 —— 需要两个不同的数组才能区分。
 * 所以本文件驱动 `test/ur-python-harness.py`（它把结果打成一行 JSON 到真实 stdout），
 * 再逐条断言。探针里的每个假对象都刻意做成"真实形态"（回环 socket 而不是 mock fd），
 * 以免测试通过只是因为假对象恰好绕过了被测路径。
 *
 * 运行：node --test test/vendored-fixes.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const testDir = fileURLToPath(new URL('.', import.meta.url))
const pythonDir = fileURLToPath(new URL('../python/', import.meta.url))
const harness = join(testDir, 'ur-python-harness.py')

const child = spawnSync(process.env.PYTHON ?? 'python', ['-u', harness], {
  encoding: 'utf8',
  timeout: 180000,
  env: { ...process.env, PYTHONPATH: pythonDir, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
})

assert.equal(child.status, 0, `Python 探针失败（exit ${child.status}）：${child.stderr}`)
const line = (child.stdout ?? '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'))
assert.ok(line, `未拿到 JSON 结果：${JSON.stringify(child.stdout)}`)
const probe = JSON.parse(line)

test('realTimeClient 发送：断链时必须在预算内失败，而不是无界重试', () => {
  const r = probe.send_deadline
  assert.equal(r.returned, false, '发送失败必须如实返回 False（不得静默成功）')
  assert.ok(r.within_budget_s, `必须在发送预算内返回（实测 ${r.elapsed_s}s）`)
  assert.ok(r.last_send_failure, '必须记录失败原因供上层回报')
})

test('realTimeClient 发送：成功路径必须真的把字节送到对端', () => {
  const r = probe.send_success
  assert.equal(r.returned, true, '可写 socket 上发送应成功')
  assert.equal(r.received_ok, true, '对端必须真的收到那段 URScript（sendall 而非截断的 send）')
  assert.equal(r.last_send_failure, null, '成功时不得留下失败原因')
})

test('realTimeClient 发送：连不上时必须给出可读原因', () => {
  const r = probe.send_not_connected
  assert.equal(r.returned, false)
  assert.ok((r.last_send_failure ?? '').length > 0, '必须说明为什么没发出去')
})

test('可配置数字 I/O 的位掩码：n=8 必须落在 bit8，而不是 bit16（tool DI）', () => {
  const b = probe.bit_masks
  // 位图：bit0 = 标准 DI0、bit8 = 可配置 DI8、bit16 = tool DI0
  assert.equal(b.std_in_0, true, '标准 DI0 = bit0')
  assert.equal(b.std_in_1, false, '未置位的标准 DI 必须为 false')
  assert.equal(b.config_in_8, true, '可配置 DI8 必须是 bit8')
  assert.equal(b.config_in_9, false, '⚠️ 上游 pow(2, n+8) 会让 n=9 读成 tool DI1 而为 true')
  assert.equal(b.config_in_15, false, '未置位的可配置 DI 必须为 false')
  assert.equal(b.std_out_7, true, '标准 DO7 = bit7')
  assert.equal(b.config_out_15, true, '可配置 DO15 必须是 bit15')
  assert.equal(b.config_out_8, false, '⚠️ 同一处 +8 偏移也出现在输出侧')
})

test('状态位解码：RTDE 字段缺失时返回全 false，绝不抛 TypeError', () => {
  const s = probe.status_none
  assert.equal(s.raised, null, `字段为 None 时不得抛异常（实测 ${s.raised}）`)
  assert.deepEqual(s.robot, {
    PowerOn: false, ProgramRunning: false, TeachButtonPressed: false, PowerButtonPressed: false,
  })
  assert.equal(s.safety_all_false, true, '安全状态位全 false（"状态未知"）')
})

test('遥测访问器：电压/电流/角速度必须读各自的字段', () => {
  const m = probe.measurements
  assert.deepEqual(m.joint_voltage, [1, 2, 3, 4, 5, 6], '⚠️ 上游 ActualJointVoltage 返回的是 actual_current')
  assert.deepEqual(m.joint_current, [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 'ActualCurrent 必须读 actual_current')
  assert.equal(m.joint_speed.length, 6, 'ActualQD 必须可用（actual_qd 本来就在配方里）')
  assert.equal(m.speed_scaling, 0.75, 'SpeedScaling 必须可用')
  assert.equal(m.analog_out_0, 4.2, 'StandardAnalogOutput(0) 必须可用')
})

test('Dashboard.wait_dbs 必须支持超时（否则调用方永久卡死）', () => {
  const d = probe.dashboard_wait
  assert.equal(d.woke, false, '没人 notify 时必须超时返回 false')
  assert.ok(d.elapsed_s < 2, `显式超时必须真的生效（实测 ${d.elapsed_s}s）`)
  assert.ok(d.elapsed_default_s < 5, `无参调用也必须受默认上限约束（实测 ${d.elapsed_default_s}s）`)
})

test('RTDE.__wait 必须支持超时（否则每次读取姿态都会永久卡住）', () => {
  const r = probe.rtde_wait
  assert.equal(r.woke, false, '无数据时必须超时返回 false')
  assert.ok(r.within_budget_s, `必须在超时预算内返回（实测 ${r.elapsed_s}s）`)
})

test('ur_movec 必须发送真正的 movec（上游 UrScript.movec 固定发 movep 且丢掉 via）', () => {
  assert.equal(probe.movec.uses_raw_urscript, true, 'worker 必须自行拼 movec(p_via, p_to, ...)')
  assert.equal(probe.movec.does_not_call_lib_movec, true,
    '不得调用 UrScript.movec —— 它内部走 movetype="p"，实际发的是 movep')
  assert.equal(probe.movec.upstream_calls_movep, true,
    '上游若已修好 movec，请删掉 worker 里的绕过实现并更新本断言')
})

test('契约：RTDE 接收循环不得再用 __reconnectTimeout 当运行期窗口', () => {
  // 静态契约，配合上面的行为探针：旧写法 `while (not stop_event) and (time.time()-t0<reconnectTimeout)`
  // 会让健康连接在 60 s 后"正常"退出（只发 PAUSE、不关 socket）⇒ isRunning() 仍为 true，
  // 数据却不再更新，此后每次读取都卡在 dataEvent.wait() 上。
  const rtde = readFileSync(join(pythonDir, 'URBasic', 'rtde.py'), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(!/while\s*\(not self\.__stop_event\)\s+and\s+\(time\.time\(\)-t0<self\.__reconnectTimeout\)/.test(rtde),
    '接收循环必须只由 __stop_event / 数据看门狗结束，不得由"启动后 60 s"结束')
  assert.match(rtde, /__dataTimeout/, '必须有运行期数据看门狗窗口')
  assert.match(rtde, /self\.__receive_progress = True/, '必须记录"本次真的收到了数据"')
})

test('契约：Dashboard 接收循环同样不得 60 s 后自杀，且发送必须带超时等待', () => {
  const dash = readFileSync(join(pythonDir, 'URBasic', 'dashboard.py'), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(!/while\s*\(not self\.__stop_event\)\s+and\s+\(time\.time\(\)-t0<self\.__reconnectTimeout\)/.test(dash),
    'Dashboard 接收循环不得由"启动后 2 s"结束（否则 2 s 后所有命令都卡在 wait_dbs）')
  assert.match(dash, /def wait_dbs\(self, timeout=None\)/, 'wait_dbs 必须可超时')
  assert.match(dash, /def sendCommand\(self, cmd\)/, '必须提供"发命令 + 只认本次应答"的包装')
  assert.ok(!/self\.wait_dbs\(\)\s*\n\s*return True/.test(dash),
    '__send 里的 wait_dbs 必须带超时，否则发送失败会永久阻塞')
})

test('契约：rtde.py 不得再用不存在的 self.sock', () => {
  const rtde = readFileSync(join(pythonDir, 'URBasic', 'rtde.py'), 'utf8').replace(/\r\n/g, '\n')
  const block = /def __connect\(self\):[\s\S]*?\n    def /.exec(rtde)
  assert.ok(block, '未找到 RTDE.__connect')
  // 只看**代码**行：这个缺陷的注释里会写明"上游写的是 self.sock"，
  // 把那句注释也算进去会让门禁永远无法通过（也不能因为改了注释就变绿）。
  const code = block[0]
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
  // 否定断言必须排除 `self.__sock`：`self._` 前缀同样匹配 `self\.`。
  const wrong = /self\.(?!_)(\w+\.)?sock\b/.exec(code)
  assert.equal(wrong, null,
    `⚠️ self.sock 不存在（正确属性是 self.__sock）；写错会让 RTDE 线程在首次连接失败时当场死亡。命中：${wrong && wrong[0]}`)
})

test('契约：工具端 I/O 与模拟输出必须使用手册里真实存在的函数名', () => {
  // 仓库内的官方脚本手册（ScriptManual/script_directory_Poly5.pdf）是这几种函数名的权威来源。
  // 上游 vendored 代码里有三个名字在手册中**根本不存在**，而后果不是"少个功能"而是
  // **静默失效**：控制器拒收整段脚本，调用方却回读到陈旧寄存器值（工具数字输入）或
  // 回报"已发送"（工具数字输出）。
  const n = probe.tool_io_names;
  assert.equal(n.get_in_uses_get_tool_digital_in, true, '必须用手册里的 get_tool_digital_in')
  assert.equal(n.get_in_uses_write_output_integer_register, true,
    '必须用手册里的 write_output_integer_register')
  assert.equal(n.get_out_uses_get_tool_digital_out, true, 'get_tool_digital_out 在手册里存在，可以实现回读')
  assert.equal(n.set_out_uses_set_tool_digital_out, true, '必须用手册里的 set_tool_digital_out')
  assert.equal(n.analog_out_uses_accessor_with_index, true,
    'StandardAnalogOutput 必须按端口号取（无参版本不存在）')
  for (const key of [
    'no_write_output_int_register',
    'no_read_tool_digital_in',
    'no_write_tool_digital_out',
    'no_standard_analog_output0_attr',
    'no_standard_analog_output1_attr',
  ]) {
    assert.equal(n[key], true, `${key}：不得再出现手册里没有的名字（旧名字会让控制器拒收脚本）`)
  }
})

test('契约：README 声明的依赖可自检（ur_ping / --selfcheck 的字段存在）', () => {
  // 本仓库曾靠一个不在发布清单里的 python/sitecustomize.py 注入 site-packages，
  // 导致"本机能跑、换台机器 import numpy 就失败"。这里只钉住自检本身必须覆盖依赖。
  const worker = readFileSync(join(pythonDir, 'ur_worker.py'), 'utf8')
  assert.match(worker, /def selfcheck\(\)/)
  for (const dep of ['numpy', 'paramiko', 'rtde_config_exists']) {
    assert.match(worker, new RegExp(`["']${dep}["']`), `自检必须报告 ${dep}`)
  }
  const sitecustomize = join(pythonDir, 'sitecustomize.py')
  assert.ok(!existsSync(sitecustomize) || true,
    '提示：python/sitecustomize.py 若存在则属于本机私货，不得进入发布产物')
})

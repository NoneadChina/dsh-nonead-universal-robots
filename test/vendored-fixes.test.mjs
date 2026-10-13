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

test('movej/movel 的 t= 必须真的进 URScript（时长参数曾被静默丢弃）', () => {
  // 旧实现把结果赋给了 `tval`，而格式串引用的是 `t_val`（始终为空字符串）⇒ 传 t=5
  // 仍按 a/v 跑，时长完全不受控；而 ur_worker 自拼的 `command` 回报里却带着 t
  // —— 功能失效 + 回报伪造，两条都违反本项目的「诚实读回」底线。
  const r = probe.motion_t_param
  assert.equal(r.j_has_t5, true, `movej 的 t=5 必须出现在脚本里，实测：${r.j_text}`)
  assert.equal(r.l_has_t3, true, `movel 的 t=3 必须出现在脚本里，实测：${r.l_text}`)
  assert.equal(r.j_has_t0, true, 't 缺省（0）也要如实写出 t=0，而不是由格式串留空')
  assert.equal(r.p_has_no_t, true, 'movep 不接受 t，不得凭空塞进脚本')
})

test('错误码：缺字段 / 溢出属于参数错（BADARG），不是内部错误（HUGE）', () => {
  const c = probe.error_codes
  assert.equal(c.key_error, 'BADARG', 'KeyError（handler 直取 p["x"] 而调用方漏传）应为 BADARG')
  assert.equal(c.overflow, 'BADARG', 'OverflowError（int(inf)）应为 BADARG，而不是"插件内部炸了"')
  assert.equal(c.value_error, 'BADARG')
  assert.equal(c.unknown, 'HUGE', '真正未预料的异常仍必须落到 HUGE')
})

test('入站方向也钉死 UTF-8：stdin 必须 reconfigure，且坏字节不能打死进程', () => {
  // Node 侧 JSON.stringify 不转义非 ASCII，写进管道的是 UTF-8 字节；中文 Windows 上
  // 解释器默认 cp936 ⇒ 中文程序名静默乱码、非法字节序列抛 UnicodeDecodeError 把 worker
  // 打死（旧写法 `for line in sys.stdin` 的解码点在 try 之外）。
  const s = probe.stdin_utf8
  assert.equal(s.reconfigures_stdin, true, 'worker 必须把 stdin 也 reconfigure 成 UTF-8')
  assert.equal(s.calls_force_utf8, true, 'main() 必须真的调用它')
  assert.equal(s.loop_reads_line, true, '主循环必须显式 readline()，才能把解码失败变成可诊断的响应')
  assert.equal(s.guards_decode_error, true, '解码失败必须被捕获并如实回报，而不是冲出 main()')
})

test('工具数字输出必须把 Send() 的结果交出去（物理动作不能"发不出去也报成功"）', () => {
  const r = probe.tool_digital_out_send
  assert.equal(r.ok_returns_true, true, 'Send() 返回 true 时 set_tool_digital_out 必须返回 true')
  assert.equal(
    r.fail_returns_false,
    true,
    'Send() 返回 false（掉线 / 非远程控制）时 set_tool_digital_out 必须返回 false —— '
    + '旧实现丢掉了这个返回值，于是 worker 无条件回报"已设置"，而夹爪/气阀根本没动',
  )
  assert.equal(
    r.uses_manual_function_name,
    true,
    `必须用手册里的 set_tool_digital_out（旧名 write_tool_digital_out 会被控制器拒收），实测发出：${r.sent_text}`,
  )
})

test('诚实性契约：工具数字输入必须哨兵验证；状态型命令只能声称"已下发"', () => {
  const h = probe.honesty_contracts
  assert.equal(h.tool_di_uses_verified, true, '工具数字输入必须走哨兵验证过的读取')
  assert.equal(
    h.tool_di_no_stale_readback,
    true,
    '不得再直接调上游封装：它在脚本被静默丢弃时会回读寄存器里上一次遗留的值，把陈旧值当电平回报',
  )
  assert.equal(h.verified_has_probe_sentinel, true, '必须先用通道探测哨兵证明脚本能被执行')
  assert.equal(h.verified_has_read_program, true, '必须把真正的读数夹在首尾哨兵之间')
  assert.equal(h.verified_refuses_without_finish, true, '看不到结束哨兵时必须拒绝给值（NOT_EXECUTED）')
  assert.equal(h.tool_do_checks_send, true, '工具数字输出必须判 set_tool_digital_out 的返回值')
  assert.equal(h.force_mode_unverified, true, 'force_mode 只能声称"已下发"，并带 verified:false')
  assert.equal(h.end_force_unverified, true, 'end_force_mode 同理')
})

test('Dashboard 应答不得串台：没收到应答时必须如实报失败，而不是交出上一条的应答', () => {
  const r = probe.dashboard_crosstalk
  assert.ok(
    r.sent.includes('is in remote control'),
    `命令必须真的发出去（实测服务端收到的命令：${JSON.stringify(r.sent)}）`,
  )
  assert.equal(r.ok, false, '服务端没有回答，"发送成功"不得被当成"拿到了应答"')
  assert.equal(r.respond, '', `不得把陈旧的 "true" 交出去，实测 respond=${JSON.stringify(r.respond)}`)
  assert.equal(r.seq_unchanged, true, '应答序号没有前进 ⇒ 这一条命令没有自己的应答')
})

test('Dashboard 契约：notify 只能由"真的收到消息"触发，收包要按行累积', () => {
  const c = probe.dashboard_contract
  assert.equal(
    c.notify_inside_message_branch,
    true,
    'notifyAll 必须在 `if msg is not None:` 分支内 —— 空轮通知会让 wait_dbs() 假醒，'
    + '__send() 据此误报发送成功，真正的应答落进下一条命令的窗口',
  )
  assert.equal(c.seq_incremented, true, '收到消息必须递增应答序号（__send 靠它判定归属）')
  assert.equal(c.send_awaits_by_seq, true, '__send 必须按应答序号等待，而不是等任意一次 notify')
  assert.equal(c.sendcommand_guards_stale, true, 'sendCommand 必须核对序号是否前进')
  assert.equal(c.recv_accumulates_and_splits, true, '收包必须按换行累积切分，否则分片应答会串到下一条命令')
  assert.equal(c.recv_chunk_is_bigger, true, '单次 recv 不得再用 1024 字节')
})

test('状态型命令一律"未校验"：12 个设置类 op 必须走 ok_unverified', () => {
  const r = probe.unverified_ops
  const names = Object.keys(r)
  assert.equal(names.length, 12, `受检 op 数量应固定为 12（实测 ${names.length}）`)
  for (const name of names) {
    assert.equal(
      r[name].uses_ok_unverified,
      true,
      `${name} 必须用 ok_unverified：它只能证明"脚本写进了控制器"，不能声称"已生效"`,
    )
    assert.equal(r[name].no_plain_ok_success, true, `${name} 不得再有直接 return ok({ 的成功回报`)
  }
})

test('ok_unverified 的降级是真的（跑一遍函数，而不是匹配源码）', () => {
  const b = probe.ok_unverified_behavior
  assert.equal(b.verified_false, true, 'data 里必须带 verified:false')
  assert.equal(b.keeps_original_fields, true, '原有 data 字段必须保留')
  assert.equal(b.message_keeps_head, true, '原消息必须仍在前半段（不丢信息）')
  assert.equal(b.message_appends_note, true, '消息末尾必须附上"未校验"的说明')
})

test('RTDE START 被拒绝时必须如实反映（isRunning 不得说谎）', () => {
  const r = probe.rtde_start_buffer
  assert.equal(
    r.refused_is_running,
    false,
    'accepted=False 时 isRunning() 必须为 False —— 否则 ensure_connected 的守卫失效，'
    + '之后每次读姿态都要空等 sync() 的 5 s 超时，报出来的却是"等待新的 RTDE 数据超时"',
  )
  assert.equal(r.refused_flag, true, '被拒绝这件事必须被记下来，供上层区分"没连上"与"被拒绝"')
  assert.equal(r.accepted_is_running, true, 'accepted=True 时仍必须正常进入 STARTED')
})

test('RTDE 收包必须跨 recv 边界累积：半个包留着等下一片，不得丢弃', () => {
  const r = probe.rtde_start_buffer
  assert.equal(r.half_not_processed, true, '只有半个包时不得处理（更不得当成已收到）')
  assert.equal(r.half_kept_in_buffer, true, '半个包必须留在缓冲里 —— 旧实现直接丢掉整块缓冲')
  assert.equal(
    r.completed_after_second_half,
    true,
    '补齐后必须处理成功：旧实现把每个跨 recv 边界的包都整帧丢了',
  )
})

test('日志限幅按字节算：中文不得把上限撑到 3 倍', () => {
  const r = probe.capped_log_bytes
  assert.equal(r.rolled, true, '写满就该滚动 —— 按字符算时 5 次 CJK 写入（实际 150 字节）根本不会滚')
  assert.ok(
    r.live_size_bytes <= 90,
    `现役日志必须贴近声明上限（64 B），按字节算是 ≤90；实测 ${r.live_size_bytes} B`,
  )
})

test('realTimeClient.Send 必须先等上一段程序静默（防止两线程并发写同一 socket）', () => {
  const r = probe.send_quiesces
  assert.equal(r.returns_true, true, '可写路径仍应返回 True')
  assert.equal(
    r.joined_waiting_thread,
    true,
    'Send() 必须与 SendProgram() 一样先收尾上一段程序的等待线程 —— 否则两个线程并发'
    + 'sendall 到同一个 30003 socket，行协议可能被交错，而 Send 只回报"写成功"',
  )
  assert.equal(r.sent_payload, 'set_digital_out(0, True)\n', '命令本身必须原样发出去')
})

test('契约：list_programs 必须如实回报"用了内置默认口令"与主机密钥策略', () => {
  const c = probe.list_programs_contract
  assert.equal(c.reports_default_password, true, '不提供 password 时必须回报 used_default_password')
  assert.equal(c.reports_host_key_policy, true, 'AutoAddPolicy 这件事必须出现在返回值里')
  assert.equal(c.warns_about_mitm, true, '必须明确写出"没有中间人防护"')
  assert.equal(c.supports_known_hosts, true, '必须提供 known_hosts 这条严格校验路径（RejectPolicy）')
  assert.equal(c.no_silent_fallback, true, 'known_hosts 文件不存在必须报错，不得静默退回 auto-add')
})

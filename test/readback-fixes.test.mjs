/**
 * test/readback-fixes.test.mjs — 本轮"读回/可用性"修复的门禁。
 *
 * 覆盖四类真实缺陷（都有真机证据或明确的代码根因）：
 *  1. `ur_get_tool_telemetry` 全 null：RTDE 配方缺 `tool_*` 字段 **且** vendored 访问器是
 *     `NotImplementedError` 桩 —— 双因。现在字段进配方、工具侧直读 dataDir。
 *  2. `ur_get_tool_analog_in` 读不回：同样缺字段（`tool_analog_input0/1`）。现在优先 RTDE 直读，
 *     读不到才退回"发脚本 + 回读寄存器"（那条路会打断当前程序）。
 *  3. `ur_get_speed_scaling` 静止读 0：`speed_scaling` 是**实际**倍率（静止时控制器就报 0），
 *     请求值在 `target_speed_fraction`。两个一起给，并说明语义。
 *  4. `ur_get_freedrive_status` 无法区分"不支持/正常"：旧实现把陈旧的 0 说成"正常"。
 *     现在先写哨兵 token 确认通道，再让函数覆盖它；若寄存器仍停在 token ⇒ 明确报"不支持/未执行"。
 *  另含两处"到底有没有执行"的判定：`ur_power_off`（以 RTDE PowerOn 位为准，不再把断电时的
 *  无应答当失败）与 `ur_draw_circle`（前置起始哨兵，把 60 s 盲目超时变成即时诊断）。
 *
 * 运行：node --test test/readback-fixes.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const pythonDir = fileURLToPath(new URL('../python/', import.meta.url))
const config = readFileSync(join(pythonDir, 'URBasic', 'rtdeConfiguration.xml'), 'utf8')

const HARNESS = `
import json, os, sys, tempfile, ur_worker

ur_worker._LOG = ur_worker._CappedLog(os.path.join(tempfile.mkdtemp(prefix="ur-rb-"), "t.log"), 4096)
sys.stdout = ur_worker._LOG

IP = "1.2.3.4"

class FakeModel:
    def __init__(self, fields):
        self.dataDir = dict(fields)
    def StandardAnalogOutput(self, n):
        return self.dataDir.get("standard_analog_output%d" % n)
    def OutputIntRegister(self, index):
        return self.dataDir.get("output_int_register_%d" % index)
    def OutputDoubleRegister(self, index):
        return self.dataDir.get("output_double_register_%d" % index)

class FakeRobot:
    def __init__(self):
        self.sent = []
        self.robotConnector = type("C", (), {"RealTimeClient": self})()
    def SendProgram(self, text):
        self.sent.append(text)

def install(fields, dashboard_reply=(False, "no answer"), on_send=None):
    model = FakeModel(fields)
    robot = FakeRobot()
    ur_worker.ROBOT_MODELS[IP] = model
    ur_worker.ROBOTS[IP] = robot
    ur_worker.ensure_connected = lambda ip, r=robot, m=model: (r, m)
    ur_worker._dashboard_cmd = lambda ip, cmd, **_kw: dashboard_reply
    ur_worker._assert_remote_control = lambda ip, what: None
    original_send = ur_worker._send_program
    def send(rb, text):
        if on_send is not None:
            on_send(model, text)
        rb.sent.append(text) if hasattr(rb, "sent") else None
        return True
    ur_worker._send_program = send
    return robot, model, original_send

out = {}

# ── 1. 工具遥测 ─────────────────────────────────────────────────────────────
install({"tool_output_voltage": 24000, "tool_output_current": 0.31, "io_current": 0.02, "tool_mode": 2})
out["telemetry_present"] = ur_worker.op_get_tool_telemetry({"ip": IP})

install({})
out["telemetry_missing"] = ur_worker.op_get_tool_telemetry({"ip": IP})

# ── 2. 工具模拟输入 ─────────────────────────────────────────────────────────
_, _, _ = install({"tool_analog_input0": 3.75, "tool_analog_input_types": 1})
out["tool_analog_rtde"] = ur_worker.op_get_tool_analog_in({"ip": IP, "n": 0})
out["tool_analog_rtde_sent_scripts"] = len(ur_worker.ROBOTS[IP].sent)

install({})
out["tool_analog_fallback"] = ur_worker.op_get_tool_analog_in({"ip": IP, "n": 0})
out["tool_analog_fallback_sent"] = len(ur_worker.ROBOTS[IP].sent) > 0

# ── 3. 速度倍率 ─────────────────────────────────────────────────────────────
install({"speed_scaling": 0.0, "target_speed_fraction": 0.25})
out["speed_scaling"] = ur_worker.op_get_speed_scaling({"ip": IP})

# ── 4. freedrive 三态 ───────────────────────────────────────────────────────
def apply_register_writes(model, text, supported):
    """模拟控制器执行：数字参数照写；get_freedrive_status() 只有在 supported 时才产出值。"""
    for line in text.splitlines():
        s = line.strip()
        if not s.startswith("write_output_integer_register(21, "):
            continue
        arg = s[s.index("(") + 1:s.rindex(")")].split(",", 1)[1].strip()
        if arg.startswith("get_freedrive_status"):
            if supported:
                model.dataDir["output_int_register_21"] = 1
        else:
            model.dataDir["output_int_register_21"] = int(arg)

# 不支持：固件不认识 get_freedrive_status() ⇒ 第二个脚本不产出值，寄存器停在哨兵 token 上
install({"output_int_register_21": 7},
        on_send=lambda m, t: apply_register_writes(m, t, supported=False))
out["freedrive_unsupported"] = ur_worker.op_get_freedrive_status({"ip": IP})

# 支持：第二个脚本把寄存器改成 1（接近奇异点）
install({"output_int_register_21": 7},
        on_send=lambda m, t: apply_register_writes(m, t, supported=True))
out["freedrive_supported"] = ur_worker.op_get_freedrive_status({"ip": IP})

# ── 5. power_off：以状态位为准 ──────────────────────────────────────────────
install({"robot_status_bits": 0})          # PowerOn 位已清零
out["power_off_evidence"] = ur_worker.op_power_off({"ip": IP})

install({"robot_status_bits": 1})          # 位仍为 1
out["power_off_failed"] = ur_worker.op_power_off({"ip": IP})

install({"robot_status_bits": 1}, dashboard_reply=(True, "ok"))
out["power_off_accepted_only"] = ur_worker.op_power_off({"ip": IP})

# ── 6. draw_circle：没执行必须立刻报 -------------------------------------------------
def no_execute(model, text):
    pass                                    # 控制器什么都不做 ⇒ 哨兵永远不出现
install({"output_int_register_23": 0}, on_send=no_execute)
ur_worker._budget_ms = lambda p: 1000
out["draw_circle_not_executed"] = ur_worker.op_draw_circle(
    {"ip": IP, "center": [0.3, 0.0, 0.4, 0, 0, 0], "r": 0.05})

def executes(model, text):
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("write_output_integer_register(23, "):
            model.dataDir["output_int_register_23"] = int(line.split(",")[1].strip().rstrip(")"))
install({"output_int_register_23": 0}, on_send=executes)
ur_worker._wait_robot_idle = lambda ip, ms: (True, "已静止（测试桩）")
out["draw_circle_executed"] = ur_worker.op_draw_circle(
    {"ip": IP, "center": [0.3, 0.0, 0.4, 0, 0, 0], "r": 0.05})

ur_worker._PROTOCOL_OUT.write(json.dumps(out, ensure_ascii=False) + "\\n")
ur_worker._PROTOCOL_OUT.flush()
`

const child = spawnSync(process.env.PYTHON ?? 'python', ['-u', '-c', HARNESS], {
  encoding: 'utf8',
  timeout: 180000,
  env: { ...process.env, PYTHONPATH: pythonDir, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
})
assert.equal(child.status, 0, `探针失败：${child.stderr}`)
const line = child.stdout.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'))
assert.ok(line, `未拿到 JSON：${JSON.stringify(child.stdout)}`)
const out = JSON.parse(line)

test('配方补齐了 tool_* / io_current / target_speed_fraction 字段', () => {
  for (const field of ['tool_output_voltage', 'tool_output_current', 'tool_mode', 'io_current',
    'tool_analog_input_types', 'tool_analog_input0', 'tool_analog_input1', 'target_speed_fraction']) {
    assert.match(config, new RegExp(`<field name="${field}"`), `接收配方缺少 ${field}`)
  }
})

test('工具遥测：字段存在时给出数值，缺失时如实说明"该控制器不支持"', () => {
  const present = out.telemetry_present.data
  assert.equal(present.tool_output_voltage, 24000)
  assert.equal(present.tool_output_current, 0.31)
  assert.equal(present.io_current, 0.02)
  assert.equal(present.tool_mode, 2)
  assert.doesNotMatch(out.telemetry_present.message, /读不到/)

  const missing = out.telemetry_missing
  assert.equal(missing.data.tool_output_current, null)
  assert.match(missing.message, /读不到/)
  assert.match(missing.message, /不支持/, '缺字段要说明是"控制器不支持"，不是"读取失败"')
})

test('工具模拟输入：优先 RTDE 直读（不发脚本、不打断程序）', () => {
  const r = out.tool_analog_rtde
  assert.equal(r.data.source, 'rtde')
  assert.equal(r.data.value, 3.75)
  assert.equal(out.tool_analog_rtde_sent_scripts, 0, 'RTDE 能读时不得再发脚本')
  // 字段缺失时才退回脚本路径：本例桩不更新寄存器，所以如实报超时（而不是回一个陈旧值）
  assert.equal(out.tool_analog_fallback.code, 'TIMEOUT')
  assert.equal(out.tool_analog_fallback_sent, true, '读不到字段时退回脚本路径')
})

test('速度倍率：同时给出实际值与请求值，并说明"静止读 0"是正常的', () => {
  const r = out.speed_scaling
  assert.equal(r.data.speed_scaling, 0)
  assert.equal(r.data.target_speed_fraction, 0.25)
  assert.match(r.message, /请求倍率/)
  assert.match(r.message, /静止/, '必须解释静止时读 0 的语义，否则会被误读成"速度被压到 0"')
})

test('freedrive：能把"固件不支持"与"真的读到 0/1/2"分开', () => {
  const unsupported = out.freedrive_unsupported
  assert.equal(unsupported.code, 'UNSUPPORTED')
  assert.match(unsupported.error, /不支持/)
  assert.match(unsupported.error, /哨兵|没有执行/)

  const supported = out.freedrive_supported
  assert.equal(supported.data.status, 1)
  assert.equal(supported.data.supported, true)
  assert.match(supported.data.status_name, /接近奇异点/)
})

test('power_off：无应答但 PowerOn 位清零 ⇒ 报成功（不再是假阴性）', () => {
  const okCase = out.power_off_evidence
  assert.equal(okCase.data.power_on, false)
  assert.match(okCase.message, /已下电/)
  assert.match(okCase.message, /预期行为/, '要说清"无应答是断电时的预期行为"')

  assert.match(out.power_off_failed.message ?? out.power_off_failed.error, /下电失败|仍为 1/)
  assert.equal(out.power_off_accepted_only.data.power_on, null, '只有应答、位没清零 ⇒ 不能声称已下电')
})

test('draw_circle：控制器没执行 ⇒ 立刻报 NOT_EXECUTED（不再干等超时）且不再带 mode=0', () => {
  const bad = out.draw_circle_not_executed
  assert.equal(bad.code, 'NOT_EXECUTED')
  assert.match(bad.error, /没有执行/)
  assert.match(bad.error, /60 s/, '要指出旧版在这里是干等 60 s')
  assert.doesNotMatch(bad.data.command, /mode=/, 'movec 的 mode 参数应省略以提高跨版本兼容')

  const good = out.draw_circle_executed
  assert.equal(good.data.ok, true)
  assert.match(good.message, /控制器已开始执行/)
  assert.match(good.data.command, /movec\(/)
})

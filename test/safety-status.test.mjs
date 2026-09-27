/**
 * test/safety-status.test.mjs — 安全/机器人状态位的解码契约 + `ur_get_safety_status`。
 *
 * ## 为什么需要
 * 运动撞到安全限值时，控制器只是停下来，不会说"撞的是哪一条限值"。RTDE 的 `safety_status_bits`
 * 能说明是哪一类安全功能被触发（protective stop / safeguard / violation / fault /
 * stopped_due_to_safety），据此才能去 PolyScope 对照具体阈值。`ur_get_safety_status` 给出了这层
 * 解码，本文件把它的地基——vendored `RobotModel` 的逐位解码——钉成契约：**状态字几乎是多位的**
 * （`robot_status_bits=3` 同时表示 power on 与 program running；`safety_status_bits` 常是多位组合），
 * 所以每个位都必须独立判定，不能被"整字等于 2^k"之类的写法替代。
 *
 * ## 如实标注：这里**没有**负向验证
 * 我一度以为 `1 & word == 1` 是运算符优先级缺陷（按 C 的语义 `==` 比 `&` 紧）。**那是错的**：
 * Python 里 `&` 高于 `==`（`1 & 3 == 1` → `(1 & 3) == 1` → True），vendored 表达式本来就是对的，
 * 实测 HEAD 版解码结果与"加括号"后逐字一致（故那批纯改动已回退，不留无谓 churn）。
 * 因此本文件的用例**不是为了证明"修好了什么"**，而是把"逐位解码"这个真实契约钉住，
 * 防止日后有人按 C 的直觉"简化"这些表达式或提前 return 而悄悄改变语义。
 *
 * 这些方法只依赖 `self.dataDir`，所以可以用一个只有 `dataDir` 的桩对象调用**未绑定**方法，
 * 不必构造 `RobotModel`（它的 `__init__` 会去连 RTDE）。
 *
 * 运行：node --test test/safety-status.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const pythonDir = fileURLToPath(new URL('../python/', import.meta.url))

/** 用桩 dataDir 调用 vendored 解码器，并驱动真实的 `op_get_safety_status`。 */
const HARNESS = `
import json, os, sys, tempfile, ur_worker
from URBasic.robotModel import RobotModel

ur_worker._LOG = ur_worker._CappedLog(os.path.join(tempfile.mkdtemp(prefix="ur-ss2-"), "t.log"), 4096)
sys.stdout = ur_worker._LOG

class Stub:
    def __init__(self, dataDir):
        self.dataDir = dataDir

def decode(dataDir):
    stub = Stub(dataDir)
    robot = RobotModel.RobotStatus(stub)
    safety = RobotModel.SafetyStatus(stub)
    bits = RobotModel.OutputBitRegister(stub)
    return {
        "robot": {k: v for k, v in vars(robot).items()},
        "safety": {k: v for k, v in vars(safety).items()},
        "bits0_3": [bool(bits[i]) for i in range(4)],
        "bits32_33": [bool(bits[32]), bool(bits[33])],
        "digital_in_0": RobotModel.DigitalInputbits(stub, 0),
        "digital_in_1": RobotModel.DigitalInputbits(stub, 1),
    }

cases = {
    # 3 = power on | program running：两位同时置位（契约：必须都判真）
    "robot_multi": decode({"robot_status_bits": 3, "safety_status_bits": 0,
                           "output_bit_registers0_to_31": 1, "output_bit_registers32_to_63": None,
                           "actual_digital_input_bits": 1}),
    "robot_power_button_only": decode({"robot_status_bits": 8, "safety_status_bits": 0,
                                       "output_bit_registers0_to_31": 0, "output_bit_registers32_to_63": None,
                                       "actual_digital_input_bits": 0}),
    # 12 = protective_stop(4) | recovery_mode(8)
    "safety_protective_and_recovery": decode({"robot_status_bits": 0, "safety_status_bits": 12,
                                              "output_bit_registers0_to_31": 0, "output_bit_registers32_to_63": None,
                                              "actual_digital_input_bits": 0}),
    # 1536 = fault(512) | stopped_due_to_safety(1024)
    "safety_fault_and_stopped": decode({"robot_status_bits": 0, "safety_status_bits": 1536,
                                        "output_bit_registers0_to_31": 0, "output_bit_registers32_to_63": None,
                                        "actual_digital_input_bits": 0}),
    # 5 = bit0 | bit2，且 32–63 段给 2 = bit33
    "bit_registers_multi": decode({"robot_status_bits": 0, "safety_status_bits": 0,
                                   "output_bit_registers0_to_31": 5, "output_bit_registers32_to_63": 2,
                                   "actual_digital_input_bits": 3}),
}

# ── 真实 op_get_safety_status ────────────────────────────────────────────────
class FakeDashboard:
    def __init__(self):
        self.last_respond = ""
    def ur_safetymode(self):
        self.last_respond = "PROTECTIVE_STOP"
    def ur_robotmode(self):
        self.last_respond = "ROBOT_MODE_IDLE"
    def ur_programState(self):
        self.last_respond = "STOPPED"

class FakeRobot:
    def __init__(self):
        self.robotConnector = type("C", (), {"DashboardClient": FakeDashboard()})()

model = Stub({"robot_status_bits": 3, "safety_status_bits": 1024 | 4,
              "output_bit_registers0_to_31": 0, "output_bit_registers32_to_63": None,
              "actual_digital_input_bits": 0})
fake_dashboard = FakeDashboard()
ur_worker.ensure_connected = lambda ip: (FakeRobot(), model)
ur_worker.dashboard = lambda ip: fake_dashboard
status = ur_worker.op_get_safety_status({"ip": "1.2.3.4"})

out = {"cases": cases, "status": {"message": status["message"], "data": status["data"]}}
ur_worker._PROTOCOL_OUT.write(json.dumps(out, ensure_ascii=False) + "\\n")
ur_worker._PROTOCOL_OUT.flush()
`

const child = spawnSync(process.env.PYTHON ?? 'python', ['-u', '-c', HARNESS], {
  encoding: 'utf8',
  timeout: 120000,
  env: { ...process.env, PYTHONPATH: pythonDir, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
})
assert.equal(child.status, 0, `探针失败：${child.stderr}`)
const line = child.stdout.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'))
assert.ok(line, `未拿到 JSON：${JSON.stringify(child.stdout)}`)
const { cases, status } = JSON.parse(line)

test('机器人状态位：多位组合必须逐位判真', () => {
  // 3 = PowerOn | ProgramRunning：两个都得是 true，其余 false
  assert.deepEqual(cases.robot_multi.robot, {
    PowerOn: true, ProgramRunning: true, TeachButtonPressed: false, PowerButtonPressed: false,
  }, '3（power on + program running）两位都必须为真')

  // 8 = PowerButtonPressed：只有它 true
  assert.deepEqual(cases.robot_power_button_only.robot, {
    PowerOn: false, ProgramRunning: false, TeachButtonPressed: false, PowerButtonPressed: true,
  })
})

test('安全状态位：protective stop 与 recovery 同时置位时都要认出来', () => {
  const safety = cases.safety_protective_and_recovery.safety
  assert.equal(safety.ProtectiveStopped, true, '4 位应判真')
  assert.equal(safety.RecoveryMode, true, '8 位应判真')
  assert.equal(safety.NormalMode, false)
  assert.equal(safety.SafeguardStopped, false)
})

test('安全状态位：fault 与 stopped_due_to_safety（诊断"为什么停"的关键两位）', () => {
  const safety = cases.safety_fault_and_stopped.safety
  assert.equal(safety.Fault, true, '512 位应判真')
  assert.equal(safety.StoppedDueToSafety, true, '1024 位应判真')
  assert.equal(safety.Violation, false)
})

test('bool 寄存器：一个状态字里多个位同时置位也要逐位判对', () => {
  const c = cases.bit_registers_multi
  assert.deepEqual(c.bits0_3, [true, false, true, false], '5 = bit0|bit2，只有 0 和 2 为真')
  assert.deepEqual(c.bits32_33, [false, true], '32–63 段：2 = bit33')
  assert.equal(c.digital_in_0, true, '3 = bit0|bit1 ⇒ bit0 真')
  assert.equal(c.digital_in_1, true, '3 = bit0|bit1 ⇒ bit1 真')
})

test('ur_get_safety_status：给出安全模式 + 置位名字 + 原始值，并说明限值数值的来源', () => {
  assert.equal(status.data.safety_mode, 'PROTECTIVE_STOP')
  assert.equal(status.data.robot_mode, 'ROBOT_MODE_IDLE')
  assert.equal(status.data.safety_status_bits, 1028, '4|1024 = 1028')
  assert.deepEqual(status.data.safety_status_names, ['protective_stop', 'stopped_due_to_safety'])
  assert.deepEqual(status.data.robot_status_names, ['power_on', 'program_running'])
  assert.match(status.message, /PolyScope/, '必须说明数值化限值要去 PolyScope 读')
  assert.match(status.message, /安全限值/)
  assert.equal(status.data.limits_source.includes('安全限值'), true)
})

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
 * ## dashboard 应答的格式契约（同一个文件里的第二层契约）
 * 夹具必须照**真实协议**写：控制器对 `safetymode` / `robotmode` 回的是带标签前缀的整行
 * （`"Safetymode: NORMAL"` / `"Robotmode: RUNNING"`，见 `URBasic/dashboard.py` 的文档字符串）。
 * 早先的夹具编造了裸值（`"PROTECTIVE_STOP"`），于是"worker 没剥前缀"这个缺陷在测试里隐形：
 * 客户端查不到中文表 → 把 `NORMAL` 当成未知模式 → 判定为需要处置的安全异常 →
 * 孪生面板底部恒挂「机器人可能已停止，请检查示教器」。`_enum_token` 与 `prefixed_*` 用例
 * 就是为此立的回归门。
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
        self.last_respond = "Safetymode: PROTECTIVE_STOP"
    def ur_robotmode(self):
        self.last_respond = "Robotmode: IDLE"
    def ur_programState(self):
        # 真实应答是「**状态词 + 程序名**」：实测 PolyScope 5.21 / UR30 空闲时回
        # 「STOPPED <未命名>」（程序名可以是任意非 ASCII 文本，运行中回「PLAYING <程序名>」）。
        # 早先这里编造的是裸值 "STOPPED"，于是"只剥 标签: 前缀、不剥尾部程序名"
        # 这个缺陷在测试里隐形——与 0.6.2 修掉的 safetymode 夹具同一个错误模式。
        # 注意：本段是嵌在 JS 模板字符串里的 Python，**不能出现反引号**，否则会截断模板串。
        self.last_respond = "STOPPED <未命名>"

# dashboard 查询回的是**带标签前缀的整行**（URBasic/dashboard.py 各方法的文档字符串），
# 上层只认裸枚举词。这里把这条协议契约钉死：带前缀必须剥成裸词，裸词/哨兵原样透传。
tokens = {
    "prefixed_safety": ur_worker._enum_token("Safetymode: NORMAL"),
    "prefixed_robot": ur_worker._enum_token("Robotmode: RUNNING"),
    "prefixed_padded": ur_worker._enum_token("  Safetymode:   REDUCED  "),
    "bare": ur_worker._enum_token("PLAYING"),
    "sentinel": ur_worker._enum_token("<查询失败>"),
    "empty": ur_worker._enum_token(""),
    "none": ur_worker._enum_token(None),
}

# programState 比 safetymode/robotmode 多一层：它是「状态词 + 程序名」，尾部的
# 「<程序名>」也必须剥掉，否则客户端按裸枚举词查中文表会落空。
program_states = {
    "with_name": ur_worker._program_state("STOPPED <未命名>"),
    "playing": ur_worker._program_state("PLAYING <我的程序>"),
    "bare": ur_worker._program_state("STOPPED"),
    "prefixed": ur_worker._program_state("Program state: STOPPED <未命名>"),
    "sentinel": ur_worker._program_state("<查询失败>"),
    "empty_name": ur_worker._program_state("STOPPED <>"),
}

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

out = {"cases": cases, "tokens": tokens, "program_states": program_states,
       "status": {"message": status["message"], "data": status["data"]}}
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
const { cases, tokens, program_states: programStates, status } = JSON.parse(line)

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

test('dashboard 应答：带标签前缀的整行必须剥成裸枚举词', () => {
  // 控制器回的是 "Safetymode: NORMAL" 这类整行；若不剥前缀，客户端会查不到中文表，
  // 并把 NORMAL 当成"未知模式 = 需要处置的安全异常"，孪生面板底部就会恒挂处置提示。
  assert.equal(tokens.prefixed_safety, 'NORMAL')
  assert.equal(tokens.prefixed_robot, 'RUNNING')
  assert.equal(tokens.prefixed_padded, 'REDUCED', '首尾空白与冒号后的多余空格都要吃掉')
  assert.equal(tokens.bare, 'PLAYING', '本来就没有前缀的应答原样返回')
  assert.equal(tokens.sentinel, '<查询失败>', '查询失败哨兵不含冒号，必须原样透传')
  assert.equal(tokens.empty, '')
  assert.equal(tokens.none, '')
})

test('dashboard 应答：programState 的「状态词 + 程序名」必须剥成裸状态词', () => {
  // 实测 PolyScope 5.21 / UR30：`programState` 回 `STOPPED <未命名>`（运行中 `PLAYING <程序名>`）。
  // 只剥 `标签:` 前缀是不够的——尾部程序名留着，客户端的中文表就查不到，
  // HUD 会把「程序 STOPPED <未命名>」原样显示，而不是「程序 已停止」。
  assert.equal(programStates.with_name, 'STOPPED', '尾部 <程序名> 必须剥掉')
  assert.equal(programStates.playing, 'PLAYING', '程序名含中文同样要剥掉')
  assert.equal(programStates.bare, 'STOPPED', '本来就是裸词的原样返回')
  assert.equal(programStates.prefixed, 'STOPPED', '前缀与尾部程序名同时存在时两者都要剥')
  assert.equal(programStates.sentinel, '<查询失败>', '查询失败哨兵不能被当成程序名剥空')
  assert.equal(programStates.empty_name, 'STOPPED', '空程序名 <>(即无名字)不能留下尖括号')
})

test('ur_get_safety_status：给出安全模式 + 置位名字 + 原始值，并说明限值数值的来源', () => {
  assert.equal(status.data.safety_mode, 'PROTECTIVE_STOP')
  assert.equal(status.data.robot_mode, 'IDLE', '前缀必须剥掉，上层只认裸枚举词')
  assert.equal(status.data.runtime_state, 'STOPPED')
  assert.equal(status.data.safety_status_bits, 1028, '4|1024 = 1028')
  assert.deepEqual(status.data.safety_status_names, ['protective_stop', 'stopped_due_to_safety'])
  assert.deepEqual(status.data.robot_status_names, ['power_on', 'program_running'])
  assert.match(status.message, /PolyScope/, '必须说明数值化限值要去 PolyScope 读')
  assert.match(status.message, /安全限值/)
  assert.equal(status.data.limits_source.includes('安全限值'), true)
})

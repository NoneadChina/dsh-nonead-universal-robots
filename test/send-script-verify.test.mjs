/**
 * test/send-script-verify.test.mjs — `ur_send_script` 的**执行校验**（哨兵寄存器）。
 *
 * ## 防的是什么
 * `RealTimeClient.SendProgram()` 是单向的：控制器既不给 ACK，也不回传 URScript 运行期错误。
 * 原实现只回一句「脚本程序已发送」——模型据此以为动作生效了，而真机上完全可能**一行都没执行**。
 *
 * ## 第一版校验自身的缺陷（本文件的核心回归）
 * 第一版把哨兵拼在**顶层**：`<起> + 脚本 + <止>`。真机实测立刻暴露它是**负价值的**：
 *
 *     def dance(): … end        ← 函数体
 *     <顶层哨兵> / dance()      ← 显式调用
 *
 * 这种拼法把脚本变成「**函数体一句都不跑、顶层语句照跑**」的形态，于是两个哨兵都回读成功，
 * 工具报出「已执行完毕 0.0 s」的**假阳性**——比不校验更糟：它还伪造了证据。
 *
 * 现在的做法：**含 `def` 的脚本一律把哨兵注入函数体内部（第一句 / 最后一句）**，绝不拼顶层；
 * 多个函数又看不出顶层调用哪个时**拒绝校验**（`verified: null`，脚本原样发送）。
 * 纯语句脚本（插件自己的 movej/movel 形态）才用顶层注入——那种形态下顶层语句本来就会执行。
 *
 * 本文件用假控制器复现两种执行语义：
 *   - `execute_all`     顶层语句 + 函数体都跑（正常控制器）；
 *   - `top_level_only`  **只跑顶层语句、不跑函数体**（真机实测到的形态）；
 * 并断言：修复后 `top_level_only` 下**绝不可能**报 `verified: true`（旧形状会——本文件把这点也钉住）。
 *
 * 运行：node --test test/send-script-verify.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const pythonDir = fileURLToPath(new URL('../python/', import.meta.url))
const workerSource = readFileSync(join(pythonDir, 'ur_worker.py'), 'utf8').replace(/\r\n/g, '\n')

const HARNESS = `
import json, os, sys, tempfile, ur_worker

ur_worker._LOG = ur_worker._CappedLog(os.path.join(tempfile.mkdtemp(prefix="ur-ss-"), "t.log"), 4096)
sys.stdout = ur_worker._LOG

SCRIPT_DEF = "def dance():\\n  movej([0,0,0,0,0,0],1,1,0,0)\\n  set_digital_out(3, True)\\nend\\ndance()\\n"
SCRIPT_PURE = "movej([0,0,0,0,0,0],1,1,0,0)\\n"
SCRIPT_MULTI = "def a():\\n  set_digital_out(0, True)\\nend\\ndef b():\\n  set_digital_out(1, True)\\nend\\n"

class FakeRealTime:
    def __init__(self):
        self.programs = []
        self.controller = None
    def SendProgram(self, text):
        self.programs.append(text)
        if self.controller is not None:
            self.controller(text)

class FakeRobot:
    def __init__(self, rt):
        self.robotConnector = type("C", (), {"RealTimeClient": rt})()

class FakeModel:
    def __init__(self, registers):
        self.registers = registers
    def OutputIntRegister(self, index):
        return self.registers.get(index)

def apply_sentinels(text, registers, only_top_level):
    """模拟控制器执行：把 write_output_integer_register 行写进寄存器。

    only_top_level=True 表示"函数体不执行"——用缩进区分：函数体内的哨兵行是缩进的，
    顶层的是顶格的（这与 URScript 的书写形态一致，也是真机实测的差别所在）。
    """
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("write_output_integer_register("):
            continue
        if only_top_level and line[:1].isspace():
            continue
        inner = stripped[stripped.index("(") + 1:stripped.rindex(")")]
        idx, val = [int(part) for part in inner.split(",")]
        registers[idx] = val

def run(script, mode, **params):
    rt = FakeRealTime()
    registers = {23: 0x5A5A1234}
    if mode == "execute_all":
        rt.controller = lambda text: apply_sentinels(text, registers, only_top_level=False)
    elif mode == "top_level_only":
        rt.controller = lambda text: apply_sentinels(text, registers, only_top_level=True)
    ur_worker.ensure_connected = lambda ip: (FakeRobot(rt), FakeModel(registers))
    payload = {"ip": "1.2.3.4", "script": script, "_timeout_ms": 2500}
    payload.update(params)
    result = ur_worker.op_send_script(payload)
    data = result["data"]
    return {
        "verified": data.get("verified"),
        "started": (data.get("sentinel") or {}).get("started"),
        "injection": data.get("injection"),
        "message": result["message"],
        "sent": rt.programs[0] if rt.programs else "",
    }

def old_style_payload(script, index=23):
    """第一版的"顶层拼哨兵"形状——只为在测试里对照出假阳性，不参与生产代码。"""
    return "write_output_integer_register(%d, 111)\\n%s%s" % (
        index, script if script.endswith("\\n") else script + "\\n",
        "write_output_integer_register(%d, 222)\\n" % index)

# 对照组：旧形状在"函数体不执行"的控制器下的结果（复现假阳性）
old_registers = {23: 0x5A5A1234}
apply_sentinels(old_style_payload(SCRIPT_DEF), old_registers, only_top_level=True)
old_false_positive = old_registers[23] == 222

cases = {
    "def_execute_all": run(SCRIPT_DEF, "execute_all"),
    "def_top_level_only": run(SCRIPT_DEF, "top_level_only"),
    "pure_execute_all": run(SCRIPT_PURE, "execute_all"),
    "pure_top_level_only": run(SCRIPT_PURE, "top_level_only"),
    "multi_no_call": run(SCRIPT_MULTI, "execute_all"),
    "skipped": run(SCRIPT_DEF, "execute_all", verify=False),
    "custom_register": run(SCRIPT_PURE, "execute_all", register=7),
    "old_style_false_positive": old_false_positive,
    "scripts": {"def": SCRIPT_DEF, "pure": SCRIPT_PURE, "multi": SCRIPT_MULTI},
}
ur_worker._PROTOCOL_OUT.write(json.dumps(cases, ensure_ascii=False) + "\\n")
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
const cases = JSON.parse(line)

const linesOf = (text) => text.split('\n').filter((l) => l.trim() !== '')

test('含 def 的脚本：哨兵必须注入函数体内部，顶层绝不出现哨兵', () => {
  const c = cases.def_execute_all
  assert.equal(c.injection.mode, 'function_body', '含函数定义时不得使用顶层注入')
  assert.equal(c.injection.function, 'dance')

  const lines = linesOf(c.sent)
  const firstDef = lines.findIndex((l) => l.trim().startsWith('def '))
  const sentinelIdx = lines.map((l, i) => (l.includes('write_output_integer_register') ? i : -1)).filter((i) => i >= 0)
  assert.ok(sentinelIdx.length === 2, `应恰好注入两行哨兵，实际 ${sentinelIdx.length}`)
  assert.ok(
    sentinelIdx.every((i) => i > firstDef),
    `哨兵不得出现在第一个 def 之前（那正是假阳性的形态）：def@${firstDef} 哨兵@${sentinelIdx}`,
  )
  // 第一句哨兵，最后一句哨兵（紧挨函数自己的 end 之前）
  const endIdx = lines.findIndex((l, i) => i > firstDef && l.trim() === 'end')
  assert.match(lines[firstDef + 1], /write_output_integer_register/, '函数体第一句必须是起始哨兵')
  assert.match(lines[endIdx - 1], /write_output_integer_register/, '函数体最后一句（end 之前）必须是结束哨兵')
  // 顶层调用保持原样，且函数体内容一字未改
  assert.ok(lines.some((l) => l.trim() === 'dance()'), '顶层调用必须保留')
  assert.ok(c.sent.includes('set_digital_out(3, True)'), '函数体内容不得被改写')
})

test('回归：函数体不执行时，绝不能报"已执行完毕"（旧形状会假阳性）', () => {
  // 对照组证明这个假控制器确实能复现那个 bug
  assert.equal(cases.old_style_false_positive, true,
    '对照组应当复现"顶层哨兵照跑 ⇒ 假阳性"这一机制，否则本回归测试就是空转')

  const c = cases.def_top_level_only
  assert.notEqual(c.verified, true, '函数体没跑就绝不能报 verified:true')
  assert.equal(c.verified, false)
  assert.equal(c.started, false, '哨兵在函数体内 ⇒ 没跑函数体就一个哨兵都看不到')
  assert.match(c.message, /没有观察到|根本没有执行/)
})

test('纯语句脚本（movej/movel 形态）仍走顶层注入，且形态不变', () => {
  const c = cases.pure_execute_all
  assert.equal(c.injection.mode, 'top_level')
  const lines = linesOf(c.sent)
  assert.match(lines[0], /^write_output_integer_register\(23, \d+\)$/)
  assert.equal(lines[1], 'movej([0,0,0,0,0,0],1,1,0,0)')
  assert.match(lines[2], /^write_output_integer_register\(23, \d+\)$/)
  assert.equal(c.verified, true)
  // 顶层语句本来就会执行 ⇒ 这种形态下"只跑顶层"的控制器也应判为执行完成（与真机观察一致）
  assert.equal(cases.pure_top_level_only.verified, true)
})

test('多个函数且看不出调用哪个 ⇒ 拒绝校验：原样发送 + verified:null', () => {
  const c = cases.multi_no_call
  assert.equal(c.verified, null, '拒绝校验时必须给 null（未确认），不能给 true/false 中的任何一个')
  assert.equal(c.injection.mode, 'refused')
  assert.equal(c.sent, cases.scripts.multi, '必须原样发送，不得注入')
  assert.match(c.message, /无法执行校验/)
})

test('verify=false：只发送、不改写脚本，verified:null（"未确认"≠成功）', () => {
  const c = cases.skipped
  assert.equal(c.verified, null)
  assert.equal(c.sent, cases.scripts.def, '未校验时不得改写脚本')
  assert.match(c.message, /未做执行校验/)
})

test('register 参数可换哨兵寄存器', () => {
  const c = cases.custom_register
  assert.match(linesOf(c.sent)[0], /^write_output_integer_register\(7, \d+\)$/)
  assert.equal(c.verified, true)
})

/**
 * test/remote-control.test.mjs — 「CB3 的 URSoftware 3.1–3.20 默认允许 Remote Control」。
 *
 * ## 事实与它约束的行为
 * CB3 机器人在 URSoftware 3.1 到 3.20 之间的所有版本，**Remote Control 默认可用**，不需要在
 * PolyScope 里额外开启（用户 2026-09-27 明确给出）。于是 dashboard 的 `ur_is_remote_control`
 * 报 false 时，对这一档固件**不能**给出「请去 PolyScope 开启 Remote Control」的指引 ——
 * 那会让人去改一个本就无需改的设置。
 *
 * 本测试钉住两件事：
 *   1. 版本区间判定 `cb3_remote_control_default_on()` 的边界（3.1 与 3.20 含、3.0 与 3.21 不含、
 *      e-Series 的 5.x 一律不含、无法解析一律不含）；
 *   2. `op_connect` 的提示分档：CB3 区间内说「默认可用」，其他固件才提示去开启。
 *
 * 运行：node --test test/remote-control.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const pythonDir = fileURLToPath(new URL('../python/', import.meta.url))
const workerSource = readFileSync(join(pythonDir, 'ur_worker.py'), 'utf8').replace(/\r\n/g, '\n')

/** 直接对 `cb3_remote_control_default_on()` 跑一张版本表（不碰机器人）。 */
const HARNESS = `
import json, ur_worker

versions = ["3.15.8.106339", "3.1", "3.1.0", "3.20.0", "3.0.15547", "3.21.0",
            "5.12.0", "5.5.0", "1.8.0", "", "garbage", None, " 3.9 "]
result = {str(v): bool(ur_worker.cb3_remote_control_default_on(v)) for v in versions}
ur_worker._PROTOCOL_OUT.write(json.dumps(result) + "\\n")
ur_worker._PROTOCOL_OUT.flush()
`

test('版本区间判定：3.1–3.20 为真，其余为假', () => {
  const child = spawnSync(process.env.PYTHON ?? 'python', ['-u', '-c', HARNESS], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, PYTHONPATH: pythonDir, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  })
  assert.equal(child.status, 0, `探针失败：${child.stderr}`)

  const line = child.stdout.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'))
  assert.ok(line, `未拿到 JSON 结果：${JSON.stringify(child.stdout)}`)
  const got = JSON.parse(line)

  const expected = {
    '3.15.8.106339': true,   // 真机实测的那台 UR3（CB3）
    '3.1': true,             // 区间下界（含）
    '3.1.0': true,
    '3.20.0': true,          // 区间上界（含）
    '3.0.15547': false,      // 下界之前
    '3.21.0': false,         // 上界之后
    '5.12.0': false,         // e-Series：不适用该默认值
    '5.5.0': false,
    '1.8.0': false,
    '': false,               // 读不到版本 ⇒ 保守地按「需要开启」处理
    garbage: false,
    None: false,
    ' 3.9 ': true,           // 容忍前后空白
  }
  assert.deepEqual(got, expected)
})

test('契约：op_connect 分档提示，且不再无条件让人去开启 Remote Control', () => {
  const connect = /def op_connect\(p\):[\s\S]*?\n\ndef /.exec(workerSource)
  assert.ok(connect, '未找到 op_connect 定义')
  const body = connect[0]

  assert.match(body, /cb3_remote_control_default_on\(version\)/, 'op_connect 必须按版本分档')
  assert.match(body, /3\.1–3\.20/, 'CB3 分支应说明 3.1–3.20 区间（默认可用、无需设置）')
  assert.match(body, /请在 PolyScope 中开启 Remote Control/, '非 CB3 固件仍应给出开启指引')
  assert.doesNotMatch(
    body,
    /部分运动指令可能无法执行/,
    '旧的笼统提示已被分档提示取代（它对 CB3 3.1–3.20 是错误指引）',
  )

  // 版本取值来自 dashboard，且解析容错（读不到就是空串 ⇒ 走「需要开启」分支）。
  // 0.5.0 起所有 dashboard 读取统一经 `_dashboard_send()`（它会先清空 last_respond，
  // 只认本次应答），所以这里断言的是"版本经 dashboard 读取、且走的是防陈旧应答的路径"。
  assert.match(workerSource, /def _software_version\(d\):[\s\S]*?ur_polyscopeVersion/,
    '版本应经 _software_version() 从 dashboard 读取')
  assert.match(workerSource, /def _software_version\(d\):[\s\S]*?_dashboard_send\(d, "ur_polyscopeVersion"\)/,
    '版本读取必须走 _dashboard_send（否则会读到上一条命令的陈旧应答）')
  assert.match(workerSource, /CB3_REMOTE_CONTROL_DEFAULT_MINOR = \(1, 20\)/,
    '区间上下界应集中声明，便于日后随事实变更')
})

// ── 三态：把「没问到」和「问到了，是 false」分开 ──────────────────────────────

/** 用假 robot + 假 dashboard 驱动真实的 `op_connect`，观察提示文案。 */
const CONNECT_HARNESS = `
import json, os, sys, tempfile, ur_worker

ur_worker._LOG = ur_worker._CappedLog(os.path.join(tempfile.mkdtemp(prefix="ur-rc-"), "t.log"), 4096)
sys.stdout = ur_worker._LOG

class FakeDashboard:
    def __init__(self, reply, version, raises=False):
        self.reply = reply
        self.version = version
        self.raises = raises
        self.last_respond = ""
    def sendCommand(self, cmd):
        # 与真实 Dashboard.sendCommand 同样的契约：先清空 last_respond，只认本次应答。
        self.last_respond = None
        try:
            getattr(self, cmd)()
        except Exception as exc:
            return False, "%s: %s" % (type(exc).__name__, exc)
        if self.last_respond is None:
            return False, ""
        return True, str(self.last_respond).strip()
    def ur_is_remote_control(self):
        if self.raises:
            raise RuntimeError("dashboard 连接断了")
        self.last_respond = self.reply
    def ur_polyscopeVersion(self):
        self.last_respond = self.version

class FakeRobot:
    def __init__(self, dashboard):
        self.robotConnector = type("C", (), {"DashboardClient": dashboard})()

SCENARIOS = {
    "cb3_false": ("false", "3.15.8.106339", False),
    "eseries_false": ("false", "5.12.0", False),
    "unknown_unparsable": ("could not understand the command", "3.15.8.106339", False),
    "unknown_empty": ("", "5.12.0", False),
    "unknown_exception": ("true", "5.12.0", True),
    "remote_true": ("true", "5.4.0", False),
    "remote_true_upper": ("TRUE", "5.4.0", False),
    # 陈旧应答：dashboard 收到命令但**不回答**（接收线程已死 / 应答丢失）。
    # 旧实现会把上一条命令的应答当成答案，于是"没问到"被读成"问到了"。
    "stale_no_answer": (None, "5.4.0", False),
}

cases = {}
for name, (reply, version, raises) in SCENARIOS.items():
    robot = FakeRobot(FakeDashboard(reply, version, raises))
    ur_worker.ensure_connected = lambda ip, r=robot: (r, None)
    result = ur_worker.op_connect({"ip": "1.2.3.4"})
    cases[name] = {
        "message": result["message"],
        "remote_control": result["remote_control"],
        "software_version": result["software_version"],
    }

ur_worker._PROTOCOL_OUT.write(json.dumps(cases, ensure_ascii=False) + "\\n")
ur_worker._PROTOCOL_OUT.flush()
`

function runProbe(source) {
  const child = spawnSync(process.env.PYTHON ?? 'python', ['-u', '-c', source], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, PYTHONPATH: pythonDir, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
  })
  assert.equal(child.status, 0, `探针失败：${child.stderr}`)
  const line = child.stdout.split('\n').map((l) => l.trim()).find((l) => l.startsWith('{'))
  assert.ok(line, `未拿到 JSON 结果：${JSON.stringify(child.stdout)}`)
  return JSON.parse(line)
}

test('三态：只有明确 false 才提"未处于远程控制模式"；未知一律说未知', () => {
  const c = runProbe(CONNECT_HARNESS)

  // 明确 true：不加任何提示，只报连接成功。
  assert.equal(c.remote_true.remote_control, true)
  assert.equal(c.remote_true.message, '连接成功。IP：1.2.3.4')
  assert.equal(c.remote_true_upper.remote_control, true, '大小写/空白应容错')

  // 明确 false + CB3 3.1–3.20：说明该区间**设置层面**默认已启用，但仍要指出当前不在远程模式
  // （本地/示教模式下 URScript 与运动指令会被丢弃）——不能让人以为"默认可用"就等于"现在能收指令"。
  assert.equal(c.cb3_false.remote_control, false)
  assert.match(c.cb3_false.message, /3\.1–3\.20/)
  assert.match(c.cb3_false.message, /默认已启用/)
  assert.match(c.cb3_false.message, /当前不在远程模式|切到远程控制/, '必须点明当前不在远程模式及其后果')
  assert.doesNotMatch(c.cb3_false.message, /请在 PolyScope 中开启/, 'CB3 该区间设置在默认已启用，不该让人去开启')

  // 明确 false + e-Series：给出开启指引。
  assert.equal(c.eseries_false.remote_control, false)
  assert.match(c.eseries_false.message, /请在 PolyScope 中开启 Remote Control/)

  // 未知（不可解析 / 空回答 / 探测抛异常）：三态里的 null，
  // **不得**据此断言"未处于远程控制模式"。
  for (const name of ['unknown_unparsable', 'unknown_empty', 'unknown_exception']) {
    assert.equal(c[name].remote_control, null, `${name} 的 remote_control 应为 null（未知）`)
    assert.match(c[name].message, /远程控制状态未知/, `${name} 应如实说未知`)
    assert.doesNotMatch(c[name].message, /请在 PolyScope 中开启/, `${name} 不得基于未知信息让人去改设置`)
    assert.doesNotMatch(c[name].message, /默认可用/, `${name} 不得声称默认可用`)
  }

  // "本次没有应答"（= dashboard 没有回答 is in remote control）同样必须落进未知分支。
  // 这一档最容易出错：上一条命令（这里是 polyscopeVersion）刚刚留下 "5.4.0"，
  // 任何直接读 last_respond 的实现都会把别人的应答当成答案。
  assert.equal(c.stale_no_answer.remote_control, null, '没有本次应答时必须报未知')
  assert.match(c.stale_no_answer.message, /远程控制状态未知/)
  assert.equal(c.stale_no_answer.software_version, '5.4.0',
    '版本号是它自己那条命令的应答，必须仍然读得到（说明"未知"不是因为整体失效）')
})

test('契约：三态实现不得把"未知"折叠成 false', () => {
  assert.match(workerSource, /def _remote_control\(d\):[\s\S]*?return None, raw/,
    '_remote_control 必须能返回 None（未知）')
  assert.match(workerSource, /if lowered == "true":[\s\S]*?if lowered == "false":/,
    '只把明确的 true/false 当作已知')
})

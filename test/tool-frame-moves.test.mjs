/**
 * test/tool-frame-moves.test.mjs — `ur_move_tool_x/y/z`（工具坐标系方向的直线移动）。
 *
 * ## 为什么这么实现
 * 沿工具方向走不能再加基座坐标轴上的偏移：工具斜着的时候两者完全不同。URScript 里有
 * `pose_trans` 可以做工具系变换，但它在各软件版本上的可用性/行为不一致（CB3 3.15 上出现过
 * 运行期中止）。所以换算放在 worker 侧：读当前 TCP 姿态 → 用姿态的旋转矩阵把工具系位移换算成
 * 基座系位移 → 直接发基座系 movel。本文件用**闭式解**核对这个换算（不是拿实现算自己）：
 *   - 零姿态：      工具 X → 基座 +X
 *   - Rz(+90°)：    工具 X → 基座 +Y；工具 Y 反向 → 基座 +X
 *   - Ry(+90°)：    工具 X → 基座 −Z
 *   - Rx(+90°)：    工具 Z → 基座 −Y
 *
 * 运行：node --test test/tool-frame-moves.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const pythonDir = join(packageRoot, 'python')
const workerSource = readFileSync(join(pythonDir, 'ur_worker.py'), 'utf8').replace(/\r\n/g, '\n')
const hostSource = readFileSync(join(packageRoot, 'lib', 'index.js'), 'utf8').replace(/\r\n/g, '\n')

const HARNESS = `
import json, math, os, sys, tempfile, ur_worker

ur_worker._LOG = ur_worker._CappedLog(os.path.join(tempfile.mkdtemp(prefix="ur-tf-"), "t.log"), 4096)
sys.stdout = ur_worker._LOG

START_POSE = [0.1, 0.2, 0.3, 0.0, 0.0, 0.0]

CASES = [
    {"name": "identity_tool_x", "rot": [0.0, 0.0, 0.0], "op": "move_tool_x", "d": 0.1, "expect": [0.1, 0.0, 0.0]},
    {"name": "rz90_tool_x", "rot": [0.0, 0.0, math.pi / 2], "op": "move_tool_x", "d": 0.1, "expect": [0.0, 0.1, 0.0]},
    {"name": "rz90_tool_y", "rot": [0.0, 0.0, math.pi / 2], "op": "move_tool_y", "d": -0.2, "expect": [0.2, 0.0, 0.0]},
    {"name": "ry90_tool_x", "rot": [0.0, math.pi / 2, 0.0], "op": "move_tool_x", "d": 0.1, "expect": [0.0, 0.0, -0.1]},
    {"name": "rx90_tool_z", "rot": [math.pi / 2, 0.0, 0.0], "op": "move_tool_z", "d": 0.05, "expect": [0.0, -0.05, 0.0]},
]

class FakeRobot:
    def __init__(self, pose):
        self.pose = list(pose)
        self.movel_calls = []
    def get_actual_tcp_pose(self):
        return list(self.pose)
    def movel(self, pose, wait=False):
        self.movel_calls.append({"pose": [float(x) for x in pose], "wait": bool(wait)})

results = []
for case in CASES:
    robot = FakeRobot(START_POSE[:3] + case["rot"])
    ur_worker.ensure_connected = lambda ip, r=robot: (r, None)
    ur_worker._movel_confirm = lambda ip, pose, ms: (True, "已到达（测试桩）")
    result = getattr(ur_worker, "op_" + case["op"])({"ip": "1.2.3.4", "distance": case["d"]})
    data = result["data"]
    call = robot.movel_calls[0] if robot.movel_calls else {}
    results.append({
        "name": case["name"],
        "expect": case["expect"],
        "start_pose": [float(x) for x in START_POSE[:3] + case["rot"]],
        "base_delta": data.get("base_delta"),
        "tool_delta": data.get("tool_delta"),
        "target": call.get("pose"),
        "wait": call.get("wait"),
        "command": data.get("command"),
        "message": result["message"],
    })

ur_worker._PROTOCOL_OUT.write(json.dumps(results, ensure_ascii=False) + "\\n")
ur_worker._PROTOCOL_OUT.flush()
`

const child = spawnSync(process.env.PYTHON ?? 'python', ['-u', '-c', HARNESS], {
  encoding: 'utf8',
  timeout: 120000,
  env: { ...process.env, PYTHONPATH: pythonDir, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
})
assert.equal(child.status, 0, `探针失败：${child.stderr}`)
const line = child.stdout.split('\n').map((l) => l.trim()).find((l) => l.startsWith('['))
assert.ok(line, `未拿到 JSON：${JSON.stringify(child.stdout)}`)
const results = JSON.parse(line)
const byName = Object.fromEntries(results.map((r) => [r.name, r]))

const START = [0.1, 0.2, 0.3]
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol

test('换算正确：工具系位移 → 基座系位移（闭式解核对四种姿态）', () => {
  for (const r of results) {
    for (let i = 0; i < 3; i += 1) {
      assert.ok(
        close(r.base_delta[i], r.expect[i]),
        `${r.name} 的基座系位移第 ${i} 个分量应为 ${r.expect[i]}，实际 ${r.base_delta[i]}（完整：${JSON.stringify(r.base_delta)}）`,
      )
    }
  }
})

test('工具系位移原样保留在 data.tool_delta（可核对"我要求的"与"换算出的"）', () => {
  const near = (a, b) => a.every((v, i) => close(v, b[i]))
  assert.ok(near(byName.identity_tool_x.tool_delta, [0.1, 0, 0]), JSON.stringify(byName.identity_tool_x.tool_delta))
  assert.ok(near(byName.rz90_tool_y.tool_delta, [0, -0.2, 0]), '工具系里是 Y 反向：' + JSON.stringify(byName.rz90_tool_y.tool_delta))
  assert.ok(near(byName.rz90_tool_y.base_delta, [0.2, 0, 0]), '换算到基座系应变成 +X：' + JSON.stringify(byName.rz90_tool_y.base_delta))
})

test('目标位姿 = 当前位置 + 基座系位移，姿态保持不变', () => {
  for (const r of results) {
    assert.ok(r.target, `${r.name} 未调用 movel`)
    for (let i = 0; i < 3; i += 1) {
      assert.ok(close(r.target[i], START[i] + r.expect[i]), `${r.name} 目标位置第 ${i} 个分量不符：${r.target}`)
    }
    // 姿态三个分量必须与本用例的起始姿态完全相同（工具系直线移动不改变朝向）。
    for (let i = 3; i < 6; i += 1) {
      assert.ok(
        close(r.target[i], r.start_pose[i]),
        `${r.name} 不应改变姿态：目标 ${r.target} vs 起始 ${r.start_pose}`,
      )
    }
    assert.equal(r.wait, false, '应异步下发（等待由 _movel_confirm 负责）')
    assert.match(r.command, /^movel\(p\[/)
  }
})

test('消息里同时给出工具系与基座系位移（便于人核对方向是否符合直觉）', () => {
  assert.match(byName.rz90_tool_x.message, /工具系 x 轴/)
  assert.match(byName.rz90_tool_x.message, /基座系位移/)
  assert.match(byName.ry90_tool_x.message, /工具系 x 轴/)
})

test('契约：不用 URScript 的 pose_trans，只发基座系 movel', () => {
  assert.doesNotMatch(workerSource, /pose_trans\s*\(/, '换算必须留在 worker 侧，不得依赖 pose_trans')
  assert.match(workerSource, /def _rotvec_to_matrix\(rotvec\)/, '旋转矩阵换算应独立成函数')
  assert.match(workerSource, /"move_tool_x": op_move_tool_x/)
  assert.match(workerSource, /"move_tool_y": op_move_tool_y/)
  assert.match(workerSource, /"move_tool_z": op_move_tool_z/)
})

test('安全：三个新工具必须挂进人工审批门禁', () => {
  assert.match(hostSource, /'move_tool_x', 'move_tool_y', 'move_tool_z',/, 'APPROVAL_OPS 必须包含三个新 op')
  for (const tool of ['ur_move_tool_x', 'ur_move_tool_y', 'ur_move_tool_z']) {
    assert.match(hostSource, new RegExp(`toolName: '${tool}'`), `${tool} 必须注册`)
  }
})

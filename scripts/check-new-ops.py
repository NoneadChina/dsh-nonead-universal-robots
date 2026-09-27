"""Behavioural checks for the 0.6.0 worker ops (fake robot + model; no hardware).

Run with an interpreter that has numpy + paramiko, e.g.
    python scripts/check-new-ops.py

Every assertion below is about the *URScript that would be sent to the controller*
(and about the honest failure modes), because that string is the whole contract
between this plugin and the robot.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(os.path.dirname(HERE), "python")
sys.path.insert(0, PY)

import ur_worker  # noqa: E402

# The log file has to live inside the workspace: the DSH file sandbox allows writes
# here but not into the system temp directory. It is registered for deletion so the
# check leaves no scratch file behind (the capped log also rolls to `<path>.1`).
_TMP = os.path.join(HERE, ".tmp-new-ops.log")
for _stale in (_TMP, _TMP + ".1"):
    if os.path.exists(_stale):
        os.remove(_stale)
ur_worker._LOG = ur_worker._CappedLog(_TMP, 4096)
sys.stdout = ur_worker._LOG

failures: list[str] = []
sent: list[tuple[str, str]] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if not condition:
        failures.append("%s%s" % (name, (": " + detail) if detail else ""))
    print("%s %s%s" % ("PASS" if condition else "FAIL", name, ("  <- " + detail) if detail and not condition else ""))


class FakeModel:
    def __init__(self):
        self.value = 0.25
        self.dataDir = {"output_int_register_21": 1}

    def ActualTCPSpeed(self):
        return [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]

    def ActualQD(self):
        return [0.0] * 6

    def TargetQ(self):
        return [0.1] * 6

    def TargetQD(self):
        return [0.0] * 6

    def TargetQDD(self):
        return [0.0] * 6

    def TargetTCPPose(self):
        return [0.1, 0.2, 0.3, 0.0, 0.0, 0.0]

    def TargetTCPSpeed(self):
        return [0.0] * 6

    def ActualQ(self):
        return [0.1] * 6

    def ActualTCPPose(self):
        return [0.1, 0.2, 0.3, 0.0, 0.0, 0.0]

    def ToolOutputCurrent(self):
        return 0.11

    def ToolOutputVoltage(self):
        return 24.0

    def IoCurrent(self):
        return 0.05


class FakeRobot:
    def __init__(self):
        self.programs = []
        self.lines = []
        self.lib_calls = []

    # URBasic entry points op_movel / op_movej / op_movec reach for. They record the
    # arguments so the default a/v can be asserted (op_movel delegates the formatting
    # to URBasic, unlike movec which builds its own URScript).
    def movel(self, pose, a=None, v=None, t=None, r=None, wait=True, **kw):
        self.lib_calls.append(("movel", list(pose), a, v, t, r))

    def movej(self, q, a=None, v=None, t=None, r=None, wait=True, **kw):
        self.lib_calls.append(("movej", list(q), a, v, t, r))


robot = FakeRobot()
model = FakeModel()


def fake_ensure_connected(ip):
    return robot, model


ur_worker.ensure_connected = fake_ensure_connected
# `get_freedrive_status` reads its answer back out of the RTDE model registry, so the
# fake has to be in there too (the real op only ever sees an already-connected IP).
ur_worker.ROBOT_MODELS["1.2.3.4"] = model
ur_worker._assert_remote_control = lambda ip, what: None


def _fake_send_program(robot, script):
    """记录脚本，并**模拟控制器执行其中的寄存器写入**。

    为什么必须模拟执行：`get_freedrive_status`（以及 send_script 的哨兵）会先写一个哨兵值、
    再让被查函数覆盖它 —— 只记录不执行的替身会让它们如实报「脚本没有执行」，于是自检失败在
    替身身上，而不是在被测代码上。
    """
    robot.programs.append(script)
    for line in script.splitlines():
        text = line.strip()
        if not text.startswith("write_output_integer_register("):
            continue
        inner = text[text.index("(") + 1:text.rindex(")")]
        index_text, _, value_text = inner.partition(",")
        value_text = value_text.strip()
        try:
            value = int(value_text)
        except ValueError:
            # 形如 write_output_integer_register(21, get_freedrive_status())：给一个合法结果。
            # 取 1（接近奇异点），这样本检查能验证"非零码被翻译成文字"。
            value = 1 if "get_freedrive_status" in value_text else None
        if value is not None:
            model.dataDir["output_int_register_%s" % index_text.strip()] = value
    return True


ur_worker._send_program = _fake_send_program
ur_worker._realtime_send = lambda r, script: (r.lines.append(script), True)[1]

# `label -> (op, params)`. Most labels equal their op name; the conveyor cases need several
# parameter sets for one op, which is what the label is for.
CASES = {
    "force_mode": ("force_mode", {"ip": "1.2.3.4", "task_frame": [0.1, 0, 0, 0, 0.785, 0],
                   "selection_vector": [1, 0, 0, 0, 0, 0], "wrench": [20, 0, 40, 0, 0, 0],
                   "type": 2, "limits": [0.1, 0.1, 0.1, 0.785, 0.785, 1.57],
                   "damping": 0.05, "gain_scaling": 1.5}),
    "end_force_mode": ("end_force_mode", {"ip": "1.2.3.4"}),
    "force_mode_settings": ("force_mode_settings", {"ip": "1.2.3.4", "damping": 0.02, "gain_scaling": 0.8}),
    "speedj": ("speedj", {"ip": "1.2.3.4", "qd": [0.2, 0.3, 0.1, 0.05, 0, 0], "a": 0.5, "t": 0.5}),
    "speedl": ("speedl", {"ip": "1.2.3.4", "xd": [0.5, 0.4, 0, 1.57, 0, 0], "a": 0.5, "t": 0.5}),
    "stopj": ("stopj", {"ip": "1.2.3.4", "a": 2}),
    "stopl": ("stopl", {"ip": "1.2.3.4", "a": 0.5, "a_rot": 1.0}),
    "wait_steady": ("wait_steady", {"ip": "1.2.3.4", "timeout_s": 0.3}),
    "get_target_values": ("get_target_values", {"ip": "1.2.3.4"}),
    "tool_communication": ("tool_communication", {"ip": "1.2.3.4", "enabled": True, "baud_rate": 115200,
                           "parity": 1, "stop_bits": 2, "rx_idle_chars": 1.0, "tx_idle_chars": 3.5}),
    "set_tool_output_mode": ("set_tool_output_mode", {"ip": "1.2.3.4", "mode": 1}),
    "set_payload_inertia": ("set_payload_inertia", {"ip": "1.2.3.4", "mass": 2.5, "cog": [0, 0, 0.3],
                            "inertia": [0.01, 0, 0, 0, 0.02, 0, 0, 0, 0.03], "transition_time": 0.5}),
    "get_tool_telemetry": ("get_tool_telemetry", {"ip": "1.2.3.4"}),
    "move_optimized": ("move_optimized", {"ip": "1.2.3.4", "goal_type": "joints",
                       "goal": [0, 1.57, -1.57, 3.14, -1.57, 1.57], "a": 0.4, "v": 0.6}),
    "motion_version": ("motion_version", {"ip": "1.2.3.4", "version": 2, "jerk_gain_scaling": 0.5}),
    "get_freedrive_status": ("get_freedrive_status", {"ip": "1.2.3.4"}),
    "movec": ("movec", {"ip": "1.2.3.4", "pose_via": [0.1, 0.2, 0.3, 0, 0, 0],
              "pose_to": [0.2, 0.3, 0.4, 0, 0, 0], "mode": 1}),
    # 绘图工具的竖直方向必须落在**位置**分量上（曾经的笔误写进了旋转分量 rx）
    "draw_square": ("draw_square", {"ip": "1.2.3.4", "origin": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
                    "border": 0.2, "coordinate": "z"}),
    "draw_rectangle": ("draw_rectangle", {"ip": "1.2.3.4", "origin": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
                       "width": 0.3, "height": 0.15, "coordinate": "z"}),
    # 传送带：每个实参都要落在手册的槽位上
    "conveyor_tracking_setup_pulse": ("conveyor_tracking", {"ip": "1.2.3.4", "action": "setup_pulse",
                                      "encoder_index": 0, "decoder_type": 1,
                                      "encoder_a": 8, "encoder_b": 9}),
    "conveyor_tracking_linear": ("conveyor_tracking", {"ip": "1.2.3.4", "action": "linear",
                                 "direction": [1, 0, 0, 0, 0, 0], "ticks_per_meter": 1000.0}),
    "conveyor_tracking_circular": ("conveyor_tracking", {"ip": "1.2.3.4", "action": "circular",
                                   "center": [0.5, 0.5, 0, 0, 0, 0],
                                   "ticks_per_revolution": 500.0, "rotate_tool": False}),
    "conveyor_tracking_stop": ("conveyor_tracking", {"ip": "1.2.3.4", "action": "stop"}),
    "movel": ("movel", {"ip": "1.2.3.4", "pose": [0.2, 0.3, 0.5, 0, 0, 3.14]}),
    "movej": ("movej", {"ip": "1.2.3.4", "q": [0, 1.57, -1.57, 3.14, -1.57, 1.57]}),
}

ur_worker._movel_confirm = lambda ip, pose, ms=60000: (True, "stub-arrived")
ur_worker._movej_confirm = lambda ip, q, ms=60000: (True, "stub-arrived")

results = {}
lib_calls = {}
for label, (op, params) in CASES.items():
    robot.programs.clear()
    robot.lines.clear()
    robot.lib_calls.clear()
    result = ur_worker.HANDLERS[op](params)
    results[label] = {
        "op": op,
        "ok": "error" not in result,
        "message": result.get("message", result.get("error")),
        "program": robot.programs[-1].strip() if robot.programs else None,
        "line": robot.lines[-1].strip() if robot.lines else None,
        "lines": [line.strip() for line in robot.lines],
        "data": result.get("data"),
    }
    lib_calls[label] = list(robot.lib_calls)

# ---------------------------------------------------------------- force mode
fm = results["force_mode"]
check("force_mode 进入成功", fm["ok"], str(fm["message"]))
check("force_mode 用永不退出的程序（while True + sync）",
      "while(True)" in (fm["program"] or "") and "sync()" in (fm["program"] or ""), str(fm["program"]))
check("force_mode 在进入前先设置 damping/gain_scaling",
      (fm["program"] or "").startswith("force_mode_set_damping(0.05)"), str(fm["program"]))
check("force_mode 调用参数与手册顺序一致",
      "force_mode(p[0.1,0,0,0,0.785,0], [1,0,0,0,0,0], [20,0,40,0,0,0], 2, [0.1,0.1,0.1,0.785,0.785,1.57])"
      in (fm["program"] or ""), str(fm["program"]))
check("force_mode 手册建议的 sleep(0.02) 在脚本里",
      "sleep(0.02)" in (fm["program"] or ""), str(fm["program"]))

check("end_force_mode 发 end_force_mode()", results["end_force_mode"]["program"] == "end_force_mode()",
      str(results["end_force_mode"]["program"]))
check("force_mode_settings 报 readback_supported=false",
      results["force_mode_settings"]["data"].get("readback_supported") is False)
check("force_mode_settings 只发 set_gain_scaling（damping 走同一个 op，末条即它）",
      results["force_mode_settings"]["line"] == "force_mode_set_gain_scaling(0.8)",
      str(results["force_mode_settings"]["line"]))

# ---------------------------------------------------------------- velocity
check("speedj 签名 speedj([...], a, t)",
      results["speedj"]["program"] == "speedj([0.2,0.3,0.1,0.05,0,0], 0.5, 0.5)",
      str(results["speedj"]["program"]))
check("speedl 签名 speedl([...], a, t)",
      results["speedl"]["program"] == "speedl([0.5,0.4,0,1.57,0,0], 0.5, 0.5)",
      str(results["speedl"]["program"]))
check("stopj 签名 stopj(a)", results["stopj"]["program"] == "stopj(2)", str(results["stopj"]["program"]))
check("stopl 的 aRot 只在给出时发", results["stopl"]["program"] == "stopl(0.5, aRot=1)",
      str(results["stopl"]["program"]))
check("速度指令的返回说明强调“仍在运动”",
      "仍可以该速度运动" in results["speedj"]["message"], results["speedj"]["message"])

# ---------------------------------------------------------------- targets
tv = results["get_target_values"]
check("get_target_values 读到 target_* 与 actual_*",
      tv["ok"] and tv["data"]["target_q"] == [0.1] * 6 and tv["data"]["actual_q"] == [0.1] * 6, str(tv))
check("get_target_values 读到 target_tcp_pose", tv["data"]["target_tcp_pose"][:3] == [0.1, 0.2, 0.3])

# ---------------------------------------------------------------- tool config
tc = results["tool_communication"]
check("set_tool_communication 签名（6 个参数）",
      tc["line"] == "set_tool_communication(True, 115200, 1, 2, 1, 3.5)", str(tc["line"]))
check("set_tool_communication 提醒会禁用工具模拟输入", "模拟输入" in tc["message"], tc["message"])
check("set_tool_output_mode 签名", results["set_tool_output_mode"]["line"] == "set_tool_output_mode(1)",
      str(results["set_tool_output_mode"]["line"]))
pi = results["set_payload_inertia"]
check("set_payload_inertia 用 set_target_payload 一次设全",
      (pi["program"] or "").startswith("set_target_payload(2.5, [0,0,0.3], [[0.01,0,0],[0,0.02,0],[0,0,0.03]], 0.5)"),
      str(pi["program"]))
check("set_payload_inertia 提醒会归零力/力矩测量", "归零" in pi["message"], pi["message"])
check("get_tool_telemetry 读到工具电流/电压",
      results["get_tool_telemetry"]["data"]["tool_output_current"] == 0.11)

# ---------------------------------------------------------------- optimove / motion version
mo = results["move_optimized"]
check("optimovej 签名 optimovej([...], a, v, r)",
      mo["program"] == "optimovej([0,1.57,-1.57,3.14,-1.57,1.57], a=0.4, v=0.6, r=0)", str(mo["program"]))
check("optimove 的返回说明 a/v 是比例而不是物理单位", "比例" in mo["message"], mo["message"])
mv = results["motion_version"]
check("motion_version 先发 set 再发 jerk 增益（同一 op 的两条 URScript）",
      mv["lines"] == ["motion_version_set(2)", "jerk_gain_scaling_set(0.5)"], str(mv["lines"]))
check("motion_version 同时设置 jerk 增益并声明不可回读",
      mv["data"]["applied"] == {"version": 2, "jerk_gain_scaling": 0.5}
      and mv["data"]["readback_supported"] is False, str(mv["data"]))
fd = results["get_freedrive_status"]
check("get_freedrive_status 回读寄存器并翻译成文字",
      fd["ok"] and fd["data"]["status"] == 1 and "奇异点" in fd["data"]["status_name"], str(fd))

# ---------------------------------------------------------------- movec mode / defaults
mc = results["movec"]
check("movec 带 mode 参数", "mode=1" in (mc["program"] or ""), str(mc["program"]))
movel_call = lib_calls["movel"][0] if lib_calls["movel"] else ()
movej_call = lib_calls["movej"][0] if lib_calls["movej"] else ()
check("movel 默认 a/v 是手册值 1.2/0.25",
      len(movel_call) == 6 and movel_call[2] == 1.2 and movel_call[3] == 0.25, str(movel_call))
check("movej 默认 a/v 是手册值 1.4/1.05",
      len(movej_call) == 6 and movej_call[2] == 1.4 and movej_call[3] == 1.05, str(movej_call))

# ------------------------------------------- 绘图：竖直方向必须写在**位置**分量上
# 曾经的缺陷：`coordinate="z"` 的竖直边把"米"写进了姿态索引 3（rx，弧度），
# 于是 draw_square(border=0.2) 让工具转了 ≈11.5° 而不是画方。姿态分量必须纹丝不动。
def parse_poses(program):
    """从 movel(p[...]) 脚本里取出各路位姿（6 个数一组）。"""
    import re as _re
    out = []
    for m in _re.finditer(r"p\[([^\]]+)\]", program or ""):
        out.append([float(x) for x in m.group(1).split(",")])
    return out


for op, kwargs, vertical in (
    ("draw_square", {"border": 0.2}, 0.2),
    ("draw_rectangle", {"width": 0.3, "height": 0.15}, 0.15),
):
    prog = results[op]["program"] or ""
    poses = parse_poses(prog)
    check("%s 生成了 5 个路点（含回到起点）" % op, len(poses) == 5, str(poses))
    origin = poses[0] if poses else []
    check("%s 起点是 origin 原样" % op,
          origin == [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], str(origin))
    # 姿态分量必须全程等于 origin 的姿态 —— 一个都不能被改成距离
    check("%s 的路点姿态分量全程不变（不得把米写进 rx/ry/rz）" % op,
          all(p[3:6] == [0.4, 0.5, 0.6] for p in poses), str([p[3:6] for p in poses]))
    # 竖直位移必须出现在 z（下标 2）
    zs = [round(p[2], 6) for p in poses]
    check("%s 的竖直位移落在 z（下标 2，米）" % op,
          round(min(zs), 6) == round(0.3 - vertical, 6) and round(max(zs), 6) == 0.3, str(zs))

draw_result = results["draw_square"]
draw_poses = parse_poses(draw_result["program"] or "")
# 数值比较，不做字符串匹配：浮点累减会写出 0.09999999999999998 这种字面量。
def _same(rows, expected, tol=1e-9):
    """逐行、逐元素比较位姿列表（形如 [[x,y,z,rx,ry,rz], …]）。"""
    if len(rows) != len(expected):
        return False
    for row, want in zip(rows, expected):
        if len(row) != len(want):
            return False
        if any(abs(x - y) > tol for x, y in zip(row, want)):
            return False
    return True


check("draw_square 的路径依次是 origin → +y → +y−z → −z → 回到 origin",
      _same(draw_poses, [
          [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
          [0.1, 0.4, 0.3, 0.4, 0.5, 0.6],
          [0.1, 0.4, 0.1, 0.4, 0.5, 0.6],
          [0.1, 0.2, 0.1, 0.4, 0.5, 0.6],
          [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
      ]), str(draw_poses))
check("draw_square 的竖直边在 x 不变的前提下沿 y 走（竖直平面位于 y-z 内）",
      len(draw_poses) == 5 and abs(draw_poses[1][0] - 0.1) <= 1e-9
      and abs(draw_poses[2][0] - 0.1) <= 1e-9
      and abs(draw_poses[1][1] - 0.4) <= 1e-9
      and abs(draw_poses[2][1] - 0.4) <= 1e-9, str(draw_poses))

# ------------------------------------------- 传送带：实参必须落在手册的槽位
sp = results["conveyor_tracking_setup_pulse"]
check("setup_pulse 用 encoder_enable_pulse_decode(enc, decoder, A, B)",
      (sp["program"] or "").strip() == "encoder_enable_pulse_decode(0, 1, 8, 9)", str(sp["program"]))
lin = results["conveyor_tracking_linear"]
check("linear 用 track_conveyor_linear(direction, ticks_per_meter, encoder_index)",
      (lin["program"] or "").strip() == "track_conveyor_linear(p[1,0,0,0,0,0], 1000, 0)",
      str(lin["program"]))
circ = results["conveyor_tracking_circular"]
check("circular 用 track_conveyor_circular(center, ticks_per_rev, rotate_tool, encoder_index)",
      (circ["program"] or "").strip() == "track_conveyor_circular(p[0.5,0.5,0,0,0,0], 500, False, 0)",
      str(circ["program"]))
check("stop 只发 stop_conveyor_tracking()",
      (results["conveyor_tracking_stop"]["program"] or "").strip() == "stop_conveyor_tracking()",
      str(results["conveyor_tracking_stop"]["program"]))
check("传送带工具如实标注未经真机验证",
      results["conveyor_tracking_linear"]["data"].get("hardware_verified") is False,
      str(results["conveyor_tracking_linear"]["data"]))

# ---------------------------------------------------------------- validation must fail closed
def expects_value_error(name, op, params):
    try:
        ur_worker.HANDLERS[op](params)
    except ValueError as exc:
        print("PASS %s 被拒：%s" % (name, exc))
        return
    except Exception as exc:                                   # noqa: BLE001
        failures.append("%s 抛出了非 ValueError：%r" % (name, exc))
        print("FAIL %s 抛出了非 ValueError：%r" % (name, exc))
        return
    failures.append("%s 未被拒绝" % name)
    print("FAIL %s 未被拒绝" % name)


expects_value_error("force_mode selection_vector 非 0/1", "force_mode",
                    {"ip": "1.2.3.4", "selection_vector": [2, 0, 0, 0, 0, 0]})
expects_value_error("force_mode type=4", "force_mode", {"ip": "1.2.3.4", "type": 4})
expects_value_error("force_mode damping=1.5", "force_mode", {"ip": "1.2.3.4", "damping": 1.5})
expects_value_error("force_mode_settings 两个值都没给", "force_mode_settings", {"ip": "1.2.3.4"})
expects_value_error("optimove a>1（比例上界）", "move_optimized",
                    {"ip": "1.2.3.4", "goal_type": "joints", "goal": [0] * 6, "a": 1.4})
expects_value_error("optimove 传 frame（不支持）", "move_optimized",
                    {"ip": "1.2.3.4", "goal_type": "joints", "goal": [0] * 6, "frame": "base"})
expects_value_error("optimove goal_type 非法", "move_optimized",
                    {"ip": "1.2.3.4", "goal_type": "cartesian", "goal": [0] * 6})
expects_value_error("set_payload_inertia 负惯量对角线", "set_payload_inertia",
                    {"ip": "1.2.3.4", "mass": 1, "cog": [0, 0, 0],
                     "inertia": [-1, 0, 0, 0, 1, 0, 0, 0, 1]})
expects_value_error("set_payload_inertia 超 133 kg·m²", "set_payload_inertia",
                    {"ip": "1.2.3.4", "mass": 1, "cog": [0, 0, 0],
                     "inertia": [200, 0, 0, 0, 1, 0, 0, 0, 1]})
expects_value_error("tool_communication 非法波特率", "tool_communication",
                    {"ip": "1.2.3.4", "baud_rate": 12345})
expects_value_error("motion_version 越界", "motion_version", {"ip": "1.2.3.4", "version": 3})
expects_value_error("motion_version 什么都不给", "motion_version", {"ip": "1.2.3.4"})
expects_value_error("jerk 增益越界（下限 0.01）", "motion_version",
                    {"ip": "1.2.3.4", "jerk_gain_scaling": 0.001})
expects_value_error("servoj t 低于 0.002", "servoj", {"ip": "1.2.3.4", "q": [0] * 6, "t": 0.001})

# servoj 的新范围必须被接受（Poly5 的 0.002 / 0.01）
robot.programs.clear()
ok_result = ur_worker.HANDLERS["servoj"]({"ip": "1.2.3.4", "q": [0] * 6, "t": 0.002, "lookahead_time": 0.01})
check("servoj 接受 Poly5 的 t=0.002 / lookahead=0.01", "error" not in ok_result,
      str(ok_result.get("error")))
check("servoj 脚本形状不变", (robot.programs[-1].strip() if robot.programs else "").startswith("servoj([0.000000"),
      str(robot.programs))

# ---------------------------------------------------------------- wait_steady (real polling)
ws = results["wait_steady"]
check("wait_steady 在静止的假模型上返回 steady=true", ws["ok"] and ws["data"]["steady"] is True, str(ws))

ur_worker._PROTOCOL_OUT.write(json.dumps({"failures": failures}, ensure_ascii=False) + "\n")
ur_worker._PROTOCOL_OUT.flush()
print("\n%d 个检查失败" % len(failures))

# Leave no scratch log behind (the capped log may have rolled to `.1`).
ur_worker._LOG.close()
for _stale in (_TMP, _TMP + ".1"):
    try:
        if os.path.exists(_stale):
            os.remove(_stale)
    except OSError:
        pass

sys.exit(1 if failures else 0)

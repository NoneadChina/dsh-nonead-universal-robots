"""
dsh-nonead-universal-robots — persistent UR control worker.

© 2026 拓德科技 / Suzhou Nonead Robot Technology Co., Ltd. — https://www.nonead.com

A stdio JSON worker that owns Universal Robots connections for a DSH plugin.
It reuses the URBasic library (vendored from the reference nUR MCP server) and
keeps one RTDE / Dashboard / RealTime client per robot IP alive across calls so
the model issues one `connect` and many commands without re-establishing links.

Protocol (line-delimited JSON over stdin/stdout):

  request : {"id": <int>, "op": "<op>", "<param>": <value>, ...}
  response: {"id": <int>, "ok": true,  "data": <any>}
            {"id": <int>, "ok": false, "error": "<message>", "data": <any|null>}

The worker reads one request per line, runs it, writes exactly one response
line and flushes. It is deliberately single-threaded and serial; long motion
commands are bounded by the move-confirmation loops below.
"""

import json
import math
import os
import re
import shlex
import sys
import time
import traceback

# URBasic / RTDE returns numpy arrays and scalars for pose/register/temperature
# data; convert them to native JSON types at the serialization boundary.
import numpy as np


def _json_default(obj):
    """json.dumps default: make numpy values JSON-serializable."""
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    raise TypeError("Object of type %s is not JSON serializable" % type(obj).__name__)

# The JSON protocol lives on the real stdout (stdin/stdout pipe). Isolate the
# vendored URBasic library's own print() output to a log file so it cannot
# corrupt the response channel: URBasic (rtde.py, urScript.py, dashboard.py,
# ...) prints diagnostic lines to stdout that are not part of the protocol.
_PROTOCOL_OUT = sys.stdout
_LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ur_worker.log")
_LOG = open(_LOG_PATH, "a", encoding="utf-8", buffering=1)
sys.stdout = _LOG


def _log(msg):
    _LOG.write("%s\n" % msg)
    _LOG.flush()


import URBasic

# ---------------------------------------------------------------------------
# Connection registry
# ---------------------------------------------------------------------------

ROBOTS = {}          # ip -> UrScriptExt instance
ROBOT_MODELS = {}    # ip -> RobotModel instance


def ok(data):
    return data


def err(message):
    return {"error": str(message)}


# User-supplied path/name strings reach either a `find` shell command over SSH
# (list_programs) or the dashboard `load` line protocol (load/run program), so
# reject control characters and shell/dashboard metacharacters outright.
_PATH_BAD = re.compile(r"[;|&<>`$(){}'\"\\*?\[\]#!]")


def _sanitize_path(value, field):
    """Return a safe program-name / directory string or raise ValueError.

    Control chars (incl. newline) and shell metacharacters are rejected because
    they allow command injection through the SSH `find` command or the
    dashboard `load <file>` line protocol.
    """
    s = str(value if value is not None else "").strip()
    if any(ord(c) < 32 or ord(c) == 127 for c in s):
        raise ValueError("%s 含控制字符，已拒绝" % field)
    if _PATH_BAD.search(s):
        raise ValueError("%s 含非法字符，已拒绝" % field)
    return s


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------

def is_connected(ip):
    """True when a live robot object exists and its RTDE loop is running."""
    robot = ROBOTS.get(ip)
    if robot is None:
        return False
    try:
        return bool(robot.robotConnector and robot.robotConnector.RTDE and
                    robot.robotConnector.RTDE.isRunning())
    except Exception:
        return False


def ensure_connected(ip):
    """Return (robot, robotModel) for an IP, connecting if needed.

    Raises on connection failure so callers can surface a readable error.
    """
    if is_connected(ip):
        return ROBOTS[ip], ROBOT_MODELS[ip]

    # Replace any stale handle (e.g. RTDE dropped after a restart) before
    # reconnecting so we do not leak its sockets.
    stale = ROBOTS.pop(ip, None)
    if stale is not None:
        try:
            stale.robotConnector.close()
        except Exception:
            pass
        ROBOT_MODELS.pop(ip, None)

    robot_model = URBasic.robotModel.RobotModel()
    robot = URBasic.urScriptExt.UrScriptExt(host=ip, robotModel=robot_model)
    ROBOTS[ip] = robot
    ROBOT_MODELS[ip] = robot_model

    if not robot.robotConnector.RTDE.isRunning():
        try:
            robot.robotConnector.close()
        except Exception:
            pass
        ROBOTS.pop(ip, None)
        ROBOT_MODELS.pop(ip, None)
        raise ConnectionError("RTDE did not start after connecting to %s" % ip)
    return robot, robot_model


def dashboard(ip):
    return ROBOTS[ip].robotConnector.DashboardClient


def _remote_control(d):
    """Probe whether the robot is in remote-control mode. Returns (bool, raw).

    The dashboard `ur_is_remote_control` response is usually "true" / "false",
    but it can also be an error-like string (e.g. "could not understand ...").
    We treat only an exact "true" as remote; anything else (including a failed
    probe) is reported as not-remote so callers can warn conservatively.
    """
    raw = ""
    try:
        d.ur_is_remote_control()
        raw = (d.last_respond or "").strip().lower()
    except Exception:
        raw = ""
    return raw == "true", raw


# ---------------------------------------------------------------------------
# Pose / confirmation helpers (mirrors the reference implementation)
# ---------------------------------------------------------------------------

def _vec(p, key, n, what):
    """Coerce `p[key]` to a list of exactly `n` floats or raise ValueError.

    Guards against malformed URScript: a joint/pose vector (q, pose, center,
    origin, via/to) is required to have exactly the expected dimension. The old
    code silently accepted any length, which could emit malformed `movej(...)`
    /`movel(...)` commands or an out-of-range indexing error later.
    """
    raw = p.get(key)
    if raw is None:
        raise ValueError(what + " 缺失，需要传入 %d 维数组" % n)
    try:
        vals = [float(x) for x in raw]
    except (TypeError, ValueError):
        raise ValueError(what + " 必须是数值数组（如 [%.1f,%.1f,...]" % (n, n))
    if len(vals) != n:
        raise ValueError(what + " 必须是 %d 维数组，收到 %d 维" % (n, len(vals)))
    return vals


def _bounded_int(raw, key, lo, hi, what):
    """Coerce `p[key]` to an int within [lo, hi] or raise ValueError.

    Guards register indices and I/O port numbers: an out-of-range value would
    otherwise reach `dataDir['output_int_register_<n>']` and raise a KeyError, or
    an invalid port would silently return None. Used as the last line of defense
    on top of the JSON-schema min/max already declared in the tool definitions.
    """
    try:
        v = int(raw)
    except (TypeError, ValueError):
        raise ValueError(what + " 必须是整数，收到 %r" % (raw,))
    if not (lo <= v <= hi):
        raise ValueError(what + " 必须在 [%d, %d] 范围内，收到 %d" % (lo, hi, v))
    return v


def _nonneg_float(raw, key, what, allow_zero=True):
    """Coerce `p[key]` to a non-negative float or raise ValueError.

    Guards motion parameters (acceleration, speed, blend radius, time) and
    drawing dimensions: a negative value would make the controller behave
    unexpectedly (negative speed/acceleration, reversed geometry). `allow_zero`
    permits 0 for time/blend radius where 0 is meaningful; drawing dimensions
    that must be positive use allow_zero=False.
    """
    try:
        v = float(raw)
    except (TypeError, ValueError):
        raise ValueError(what + " 必须是数值，收到 %r" % (raw,))
    threshold = 0 if allow_zero else 0
    if v < threshold:
        raise ValueError(what + " 不能为负数，收到 %s" % v)
    if not allow_zero and v == 0:
        raise ValueError(what + " 必须大于 0，收到 0")
    return v


def _round_pose(pose):
    return [round(x, 3) for x in pose]


def _right_pose_joint(current, q, tol=0.1):
    return all(current[i] + tol >= q[i] >= current[i] - tol for i in range(6))


def _right_pose_tcp(current, pose, pos_tol=0.010, rot_tol=0.05):
    # Compare the full 6-D pose. Position (x,y,z) uses a small linear tolerance
    # (meters); orientation (rx,ry,rz in radians) uses a looser angular
    # tolerance so a valid arrival in rotation is not misreported as off-target.
    return all(current[i] + pos_tol >= pose[i] >= current[i] - pos_tol for i in range(3)) and \
        all(current[i] + rot_tol >= pose[i] >= current[i] - rot_tol for i in range(3, 6))


def _program_running(ip):
    try:
        d = dashboard(ip)
        d.ur_running()
        respond = (d.last_respond or "").strip().lower()
        return "true" in respond
    except Exception:
        # A failed dashboard probe (e.g. the RTDE/connection dropped mid-move)
        # must not crash the single-threaded worker; treat it as "not running"
        # so the confirm loop reports a clear outcome instead of a raw traceback.
        return False


def _movej_confirm(ip, q, timeout_ms=60000):
    """Wait for a movej to finish. Returns (ok, message).

    Bounded by `timeout_ms` so a robot that never reaches the target (e.g. a
    program that keeps running) cannot block the single-threaded worker forever.
    `ok` is True only when the target was reached AND the robot settled; a
    persistent deviation that never settles reports `ok=False`.
    """
    deadline = time.time() + timeout_ms / 1000.0
    settled_offsets = 0
    while True:
        if time.time() > deadline:
            return False, "移动未确认到位（超时 %.0fms）" % timeout_ms
        time.sleep(1)
        try:
            current = _round_pose(ROBOTS[ip].get_actual_joint_positions())
        except Exception:
            return False, "读取关节位置失败，无法确认到位"
        if _right_pose_joint(current, q):
            if not _program_running(ip):
                return True, "移动完成"
            # On target but the program is still running: keep waiting.
        else:
            if _program_running(ip):
                continue
            # Off-target and idle: count consecutive unsettled reads. If the
            # robot repeatedly stops off-target, report that honestly rather
            # than claiming success.
            settled_offsets += 1
            if settled_offsets > 5:
                return False, "移动结束但未到达目标（位置存在偏差）"
    return True, "移动完成"


def _movel_confirm(ip, pose, timeout_ms=60000):
    deadline = time.time() + timeout_ms / 1000.0
    settled_offsets = 0
    while True:
        if time.time() > deadline:
            return False, "移动未确认到位（超时 %.0fms）" % timeout_ms
        time.sleep(1)
        try:
            current = _round_pose(ROBOTS[ip].get_actual_tcp_pose())
        except Exception:
            return False, "读取 TCP 位置失败，无法确认到位"
        if _right_pose_tcp(current, pose):
            if not _program_running(ip):
                return True, "移动完成"
        else:
            if _program_running(ip):
                continue
            settled_offsets += 1
            if settled_offsets > 5:
                return False, "移动结束但未到达目标（位置存在偏差）"
    return True, "移动完成"


def _wait_robot_idle(ip, timeout_ms=60000):
    """Wait for the robot to leave the running state. Returns (ok, message).

    Used after fire-and-forget program sends (draw shaping) so the caller knows
    the robot actually finished instead of returning a premature success.
    """
    deadline = time.time() + timeout_ms / 1000.0
    while time.time() < deadline:
        if not _program_running(ip):
            return True, "执行完成"
        time.sleep(0.5)
    return False, "执行未确认完成（超时 %.0fms）" % timeout_ms


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------

def op_connect(p):
    ip = str(p["ip"])
    try:
        robot, robot_model = ensure_connected(ip)
        in_remote, remote = _remote_control(robot.robotConnector.DashboardClient)
        msg = "连接成功。IP：%s" % ip
        if remote and not in_remote and not remote.startswith("could not understand"):
            msg += "（注意：机器人未处于远程控制模式，部分运动指令可能无法执行）"
        return ok({"message": msg, "remote_control": in_remote,
                   "ip": ip, "connected": True})
    except Exception as e:
        return err("机器人连接失败：%s" % e)


def op_disconnect(p):
    ip = str(p["ip"])
    robot = ROBOTS.pop(ip, None)
    ROBOT_MODELS.pop(ip, None)
    if robot is None:
        return ok({"message": "连接不存在"})
    try:
        robot.robotConnector.close()
    except Exception as e:
        return err("连接断开失败：%s" % e)
    return ok({"message": "连接已断开", "ip": ip})


def op_status(p):
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)
    d = dashboard(ip)

    def dash(cmd):
        try:
            getattr(d, cmd)()
            return (d.last_respond or "").strip()
        except Exception:
            # Distinguish a failed dashboard query from a genuinely empty field:
            # an empty string would be indistinguishable from "no value", while a
            # marker tells the caller/model that this particular field could not
            # be read (e.g. the dashboard connection dropped) without failing the
            # whole status snapshot.
            return "<查询失败>"

    tcp = [float(x) for x in robot.get_actual_tcp_pose()]
    joint = [float(x) for x in robot.get_actual_joint_positions()]
    try:
        timestamp = model.RobotTimestamp()
    except Exception:
        timestamp = None
    remote, _ = _remote_control(d)
    data = {
        "ip": ip,
        "tcp_pose": tcp,
        "joint_positions": joint,
        "robot_model": dash("ur_get_robot_model"),
        "serial_number": dash("ur_serial_number"),
        "software_version": dash("ur_polyscopeVersion"),
        "safety_mode": dash("ur_safetymode"),
        "robot_mode": dash("ur_robotmode"),
        "program_state": dash("ur_programState"),
        "loaded_program": dash("ur_get_loaded_program"),
        "running": _program_running(ip),
        "remote_control": remote,
        "up_time_seconds": timestamp,
        "robot_voltage": float(model.ActualRobotVoltage()),
        "robot_current": float(model.ActualRobotCurrent()),
        "joint_temperatures": [float(x) for x in model.JointTemperatures()],
    }
    return ok({"message": "机器人状态读取成功", "data": data})


def op_get_tcp_pose(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    pose = [float(x) for x in ROBOTS[ip].get_actual_tcp_pose()]
    return ok({"message": "当前TCP位置：%s" % pose, "data": {
        "tcp_pose": pose, "ip": ip}})


def op_get_joint_pose(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    joint = [float(x) for x in ROBOTS[ip].get_actual_joint_positions()]
    return ok({"message": "当前关节姿态：%s" % joint, "data": {
        "joint_positions": joint, "ip": ip}})


def op_get_robot_model(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    d = dashboard(ip)
    d.ur_get_robot_model()
    model = (d.last_respond or "").strip()
    remote, _ = _remote_control(d)
    return ok({"message": model,
               "data": {"robot_model": model, "remote_control": remote, "ip": ip}})


def op_get_serial_number(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    d = dashboard(ip)
    d.ur_serial_number()
    sn = (d.last_respond or "").strip()
    return ok({"message": "序列号：%s" % sn,
               "data": {"serial_number": sn, "ip": ip}})


def op_get_time(p):
    ip = str(p["ip"])
    _, model = ensure_connected(ip)
    try:
        ts = model.RobotTimestamp()
    except Exception as e:
        return err("开机时长获取失败：%s" % e)
    return ok({"message": "开机时长（秒）：%.2f" % ts,
               "data": {"up_time_seconds": ts, "ip": ip}})


def op_get_software_version(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    d = dashboard(ip)
    d.ur_polyscopeVersion()
    v = (d.last_respond or "").strip()
    return ok({"message": "软件版本：%s" % v,
               "data": {"software_version": v, "ip": ip}})


def op_get_safety_mode(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    d = dashboard(ip)
    d.ur_safetymode()
    m = (d.last_respond or "").strip()
    return ok({"message": "安全模式：%s" % m,
               "data": {"safety_mode": m, "ip": ip}})


def op_get_robot_mode(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    d = dashboard(ip)
    d.ur_robotmode()
    m = (d.last_respond or "").strip()
    return ok({"message": "运行状态：%s" % m,
               "data": {"robot_mode": m, "ip": ip}})


def op_get_program_state(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    d = dashboard(ip)
    d.ur_get_loaded_program()
    prog = (d.last_respond or "").strip()
    d.ur_programState()
    state = (d.last_respond or "").strip()
    d.ur_isProgramSaved()
    saved = (d.last_respond or "").strip().lower() == "true"
    running = _program_running(ip)
    return ok({"message": "当前程序：%s；执行状态：%s" % (prog, state),
               "data": {"loaded_program": prog, "program_state": state,
                        "saved": saved, "running": running, "ip": ip}})


def op_get_robot_current(p):
    ip = str(p["ip"])
    _, model = ensure_connected(ip)
    val = model.ActualRobotCurrent()
    return ok({"message": "%s（安培）" % val,
               "data": {"robot_current": val, "ip": ip}})


def op_get_robot_voltage(p):
    ip = str(p["ip"])
    _, model = ensure_connected(ip)
    val = model.ActualRobotVoltage()
    return ok({"message": "%s（伏特）" % val,
               "data": {"robot_voltage": val, "ip": ip}})


def op_get_joint_temperatures(p):
    ip = str(p["ip"])
    _, model = ensure_connected(ip)
    val = [float(x) for x in model.JointTemperatures()]
    return ok({"message": "%s（摄氏度）" % val,
               "data": {"joint_temperatures": val, "ip": ip}})


def op_get_int_register(p):
    ip = str(p["ip"])
    idx = _bounded_int(p["index"], "index", 0, 23, "int 寄存器下标")
    _, model = ensure_connected(ip)
    val = model.OutputIntRegister(idx)
    return ok({"message": "%d" % val, "data": {"index": idx, "value": val,
                                               "ip": ip}})


def op_get_double_register(p):
    ip = str(p["ip"])
    idx = _bounded_int(p["index"], "index", 0, 23, "double 寄存器下标")
    _, model = ensure_connected(ip)
    val = model.OutputDoubleRegister(idx)
    return ok({"message": "%s" % val, "data": {"index": idx, "value": val,
                                               "ip": ip}})


def op_get_bit_register(p):
    ip = str(p["ip"])
    idx = _bounded_int(p["index"], "index", 0, 63, "bool 寄存器下标")
    _, model = ensure_connected(ip)
    bits = model.OutputBitRegister()
    val = bits[idx]
    return ok({"message": "%s" % val, "data": {"index": idx, "value": val,
                                               "ip": ip}})


def op_list_programs(p):
    import paramiko
    ip = str(p["ip"])
    username = p.get("username", "root")
    password = p.get("password", "easybot")
    programs_dir = _sanitize_path(p.get("programs_dir"), "programs_dir")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(hostname=ip, port=22, username=username, password=password,
                    timeout=8)
    except Exception as e:
        return err("SSH 连接 %s:%d 失败（%s）。请确认机器人已启动 SSH 服务，或检查 username/password。" % (ip, 22, e))

    def sh(cmd, timeout=20):
        try:
            stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
            out = stdout.read().decode("utf-8", "ignore")
            err = stderr.read().decode("utf-8", "ignore")
            return out, err
        except Exception as e:
            return "", str(e)

    # Resolve which directory to scan for *.urp files.
    #   1) programs_dir override (the operator knows best)
    #   2) real robot default  -> /programs
    #   3) URSim layout        -> ~/URSim_Linux-*/programs.<model>/
    if programs_dir:
        scan_cmd = 'find %s -name "*.urp" -type f 2>/dev/null' % shlex.quote(programs_dir)
        dirs_note = "programs_dir: %s" % programs_dir
    else:
        has_programs, _ = sh('test -d /programs && echo yes || echo no')
        if has_programs.strip() == "yes":
            scan_cmd = 'find /programs -name "*.urp" -type f 2>/dev/null'
            dirs_note = "/programs"
        else:
            scan_cmd = ('find /home -name "*.urp" '
                        '-path "*/URSim_Linux-*/programs.*/*.urp" -type f 2>/dev/null')
            dirs_note = "~/URSim_Linux-*/programs.*"

    out, err = sh(scan_cmd)
    files = [line.strip() for line in out.split("\n") if line.strip().endswith(".urp")]
    programs = [{"path": f, "name": f.rsplit("/", 1)[-1]} for f in files]
    ssh.close()
    if err and "find" not in err and "No such" not in err:
        return err("程序列表获取失败。%s" % err)
    return ok({"message": "程序列表（%s）共 %s 个：%s" % (
        dirs_note, len(programs), [x["name"] for x in programs]),
        "data": {"programs": programs, "count": len(programs), "ip": ip}})


def op_send_script(p):
    ip = str(p["ip"])
    script = str(p["script"])
    robot, _ = ensure_connected(ip)
    robot.robotConnector.RealTimeClient.SendProgram(script)
    return ok({"message": "脚本程序已发送，请确认执行结果",
               "data": {"ip": ip}})


def op_movej(p):
    ip = str(p["ip"])
    q = _vec(p, "q", 6, "movej 的 q")
    a = _nonneg_float(p.get("a", 1), "a", "movej 的加速度", allow_zero=False)
    v = _nonneg_float(p.get("v", 1), "v", "movej 的速度", allow_zero=False)
    t = _nonneg_float(p.get("t", 0), "t", "movej 的时长")
    r = _nonneg_float(p.get("r", 0), "r", "movej 的交融半径")
    robot, _ = ensure_connected(ip)
    robot.movej(q, a, v, t, r, wait=False)
    ok_flag, msg = _movej_confirm(ip, q, int(p.get("_timeout_ms", 60000)))
    cmd = "movej(%s,%s,%s,%s,%s)" % (q, a, v, t, r)
    return ok({"message": "命令 %s 已发送，%s" % (cmd, msg),
               "data": {"ok": ok_flag, "command": cmd, "ip": ip}})


def op_movel(p):
    ip = str(p["ip"])
    pose = _vec(p, "pose", 6, "movel 的 pose")
    a = _nonneg_float(p.get("a", 1), "a", "movel 的加速度", allow_zero=False)
    v = _nonneg_float(p.get("v", 1), "v", "movel 的速度", allow_zero=False)
    t = _nonneg_float(p.get("t", 0), "t", "movel 的时长")
    r = _nonneg_float(p.get("r", 0), "r", "movel 的交融半径")
    robot, _ = ensure_connected(ip)
    robot.movel(pose, a, v, t, r, wait=False)
    ok_flag, msg = _movel_confirm(ip, pose, int(p.get("_timeout_ms", 60000)))
    cmd = "movel(p%s,%s,%s,%s,%s)" % (pose, a, v, t, r)
    return ok({"message": "命令 %s 已发送，%s" % (cmd, msg),
               "data": {"ok": ok_flag, "command": cmd, "ip": ip}})


def _axis_move(p, axis):
    ip = str(p["ip"])
    distance = float(p["distance"])
    robot, _ = ensure_connected(ip)
    pose = [float(x) for x in robot.get_actual_tcp_pose()]
    if len(pose) != 6:
        return err("读取当前 TCP 位姿异常（期望 6 维，收到 %d 维），无法沿轴移动" % len(pose))
    pose[axis] = pose[axis] + distance
    robot.movel(pose, wait=False)
    ok_flag, msg = _movel_confirm(ip, pose, int(p.get("_timeout_ms", 60000)))
    cmd = "movel(p[%.4f,%.4f,%.4f,%.4f,%.4f,%.4f],0.5,0.25,0,0)" % tuple(pose)
    return ok({"message": "命令 %s 已发送，%s" % (cmd, msg),
               "data": {"ok": ok_flag, "command": cmd, "ip": ip}})


def op_move_x(p):
    return _axis_move(p, 0)


def op_move_y(p):
    return _axis_move(p, 1)


def op_move_z(p):
    return _axis_move(p, 2)


def op_draw_circle(p):
    ip = str(p["ip"])
    center = _vec(p, "center", 6, "draw_circle 的 center")
    r = _nonneg_float(p["r"], "r", "draw_circle 的半径", allow_zero=False)
    coordinate = str(p.get("coordinate", "z")).lower()
    robot, _ = ensure_connected(ip)
    wp = [list(center) for _ in range(4)]
    if coordinate == "z":
        wp[0][2] = wp[0][2] + r
        wp[1][1] = wp[1][1] + r
        wp[2][2] = wp[2][2] - r
        wp[3][1] = wp[3][1] - r
    else:
        wp[0][0] = wp[0][0] - r
        wp[1][1] = wp[1][1] + r
        wp[2][0] = wp[2][0] + r
        wp[3][1] = wp[3][1] - r
    cmd = ("movep(p%s, a=1, v=0.25, r=0.025)\n"
           "movec(p%s, p%s, a=1, v=0.25, r=0.025, mode=0)\n"
           "movec(p%s, p%s, a=1, v=0.25, r=0.025, mode=0)" %
           (wp[0], wp[1], wp[2], wp[3], wp[0]))
    robot.robotConnector.RealTimeClient.SendProgram(cmd)
    ok_flag, confirm = _wait_robot_idle(ip, int(p.get("_timeout_ms", 60000)))
    return ok({"message": "命令已发送，%s：%s" % (confirm, cmd),
               "data": {"ok": ok_flag, "command": cmd, "ip": ip}})


def op_draw_square(p):
    ip = str(p["ip"])
    origin = _vec(p, "origin", 6, "draw_square 的 origin")
    border = _nonneg_float(p["border"], "border", "draw_square 的边长", allow_zero=False)
    coordinate = str(p.get("coordinate", "z")).lower()
    robot, _ = ensure_connected(ip)
    wp = [list(origin) for _ in range(3)]
    if coordinate == "z":
        wp[0][1] = wp[0][1] + border
        wp[1][1] = wp[1][1] + border
        wp[1][3] = wp[1][3] - border
        wp[2][3] = wp[2][3] - border
    else:
        wp[0][1] = wp[0][1] + border
        wp[1][1] = wp[1][1] + border
        wp[1][0] = wp[1][0] + border
        wp[2][0] = wp[2][0] + border
    cmd = ("movel(p%s, a=1, v=0.25)\nmovel(p%s, a=1, v=0.25)\n"
           "movel(p%s, a=1, v=0.25)\nmovel(p%s, a=1, v=0.25)\n"
           "movel(p%s, a=1, v=0.25)" %
           (origin, wp[0], wp[1], wp[2], origin))
    robot.robotConnector.RealTimeClient.SendProgram(cmd)
    ok_flag, confirm = _wait_robot_idle(ip, int(p.get("_timeout_ms", 60000)))
    return ok({"message": "命令已发送，%s：%s" % (confirm, cmd),
               "data": {"ok": ok_flag, "command": cmd, "ip": ip}})


def op_draw_rectangle(p):
    ip = str(p["ip"])
    origin = _vec(p, "origin", 6, "draw_rectangle 的 origin")
    width = _nonneg_float(p["width"], "width", "draw_rectangle 的长", allow_zero=False)
    height = _nonneg_float(p["height"], "height", "draw_rectangle 的宽", allow_zero=False)
    coordinate = str(p.get("coordinate", "z")).lower()
    robot, _ = ensure_connected(ip)
    wp = [list(origin) for _ in range(3)]
    if coordinate == "z":
        wp[0][1] = wp[0][1] + width
        wp[1][1] = wp[1][1] + width
        wp[1][3] = wp[1][3] - height
        wp[2][3] = wp[2][3] - height
    else:
        wp[0][1] = wp[0][1] + width
        wp[1][1] = wp[1][1] + width
        wp[1][0] = wp[1][0] + height
        wp[2][0] = wp[2][0] + height
    cmd = ("movel(p%s, a=1, v=0.25)\nmovel(p%s, a=1, v=0.25)\n"
           "movel(p%s, a=1, v=0.25)\nmovel(p%s, a=1, v=0.25)\n"
           "movel(p%s, a=1, v=0.25)" %
           (origin, wp[0], wp[1], wp[2], origin))
    robot.robotConnector.RealTimeClient.SendProgram(cmd)
    ok_flag, confirm = _wait_robot_idle(ip, int(p.get("_timeout_ms", 60000)))
    return ok({"message": "命令已发送，%s：%s" % (confirm, cmd),
               "data": {"ok": ok_flag, "command": cmd, "ip": ip}})


def op_draw_star(p):
    """Draw a five-pointed star (pentagram) with a given side length.

    center: 6-D pose whose (x,y,z) is the star center; orientation is held.
    side:   length (m) of each pentagram side.
    coordinate: "z" -> vertical (y-z plane); anything else -> horizontal (x-y).
    """
    ip = str(p["ip"])
    center = _vec(p, "center", 6, "draw_star 的 center")
    side = _nonneg_float(p["side"], "side", "draw_star 的边长", allow_zero=False)
    coordinate = str(p.get("coordinate", "xy")).lower()
    robot, _ = ensure_connected(ip)

    # Circumscribed-circle radius so that each pentagram side == `side`.
    R = side / (2.0 * math.sin(math.radians(72.0)))
    angles = [90.0, 162.0, 234.0, 306.0, 18.0]
    verts = []
    for ang in angles:
        rad = math.radians(ang)
        dvx = R * math.cos(rad)
        dvy = R * math.sin(rad)
        if coordinate == "z":
            v = [center[0], center[1] + dvy, center[2] + dvx,
                 center[3], center[4], center[5]]
        else:
            v = [center[0] + dvx, center[1] + dvy, center[2],
                 center[3], center[4], center[5]]
        verts.append(v)

    order = [0, 2, 4, 1, 3, 0]   # connect every second vertex -> pentagram
    lines = []
    for idx in order:
        v = verts[idx]
        lines.append("movel(p[%.4f,%.4f,%.4f,%.4f,%.4f,%.4f], a=1, v=0.25, r=0.0)"
                     % tuple(v))
    cmd = "\n".join(lines)
    robot.robotConnector.RealTimeClient.SendProgram(cmd)
    ok_flag, confirm = _wait_robot_idle(ip, int(p.get("_timeout_ms", 60000)))
    return ok({"message": "命令已发送（五角星，边长 %sm，外接半径 %.4fm），%s：%s" % (side, R, confirm, cmd),
               "data": {"ok": ok_flag, "command": cmd, "vertices": verts, "radius": R, "ip": ip}})


def _build_program_target(p):
    """Build the string for the dashboard `load` command.

    Accepts a bare name (pick.urp) or a full/relative path (a URSim path). If
    `programs_dir` is supplied and the name is bare, join them so URSim paths
    like ~/URSim_Linux-*/programs.<model>/program.urp work too. Both name and
    directory go through _sanitize_path (rejects control chars + shell
    metachars) before reaching the dashboard so a `\\nplay` payload cannot be
    smuggled past the motion-approval gate.
    """
    name = _sanitize_path(p.get("program_name", ""), "program_name")
    programs_dir = _sanitize_path(p.get("programs_dir", ""), "programs_dir")
    if not name:
        return name
    if programs_dir and "/" not in name:
        return programs_dir.rstrip("/") + "/" + name
    return name


def _load_failed(resp):
    r = (resp or "").lower()
    return ("not found" in r) or ("no such" in r) or ("no program loaded" in r)


def _loaded_program(d):
    """Authoritative check: ask the dashboard what program is loaded."""
    try:
        d.ur_get_loaded_program()
        return (d.last_respond or "").strip()
    except Exception:
        return ""


def op_load_program(p):
    ip = str(p["ip"])
    name = _sanitize_path(p.get("program_name", ""), "program_name")
    ensure_connected(ip)
    if not name:
        return err("未指定要加载的程序名 program_name。")
    d = dashboard(ip)
    target = _build_program_target(p)
    d.ur_load(target)
    loaded = _loaded_program(d)
    confirmed = not _load_failed(loaded)
    note = "" if confirmed else "；加载未确认，请检查程序名/路径或是否在对应的 UR 实例下"
    return ok({"message": "加载程序：%s（已加载：%s%s）" % (name, loaded, note),
               "data": {"program_name": name, "target": target, "loaded": loaded,
                        "confirmed": confirmed, "ip": ip}})


def op_run_program(p):
    ip = str(p["ip"])
    name = _sanitize_path(p.get("program_name", ""), "program_name")
    ensure_connected(ip)
    d = dashboard(ip)
    if name:
        target = _build_program_target(p)
        d.ur_load(target)
        loaded = _loaded_program(d)
        if _load_failed(loaded):
            return err("无法运行：加载程序 %s 未确认（%s）。请检查程序名/路径，或确认该程序在当前 UR 实例的程序目录下。" % (name, loaded))
    d.ur_play()
    resp = (d.last_respond or "").strip()
    return ok({"message": "已启动程序 %s（%s）" % (name or "(当前加载)", resp),
               "data": {"program_name": name, "respond": resp, "ip": ip}})


def op_stop_program(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    d = dashboard(ip)
    d.ur_stop()
    resp = (d.last_respond or "").strip()
    return ok({"message": "已停止程序（%s）" % resp,
               "data": {"respond": resp, "ip": ip}})


def op_pause_program(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    d = dashboard(ip)
    d.ur_pause()
    resp = (d.last_respond or "").strip()
    return ok({"message": "已暂停程序（%s）" % resp,
               "data": {"respond": resp, "ip": ip}})


def op_reset_error(p):
    ip = str(p["ip"])
    robot, _ = ensure_connected(ip)
    power_on = robot.reset_error()
    return ok({"message": "错误复位完成，机器人就绪：%s" % power_on,
               "data": {"power_on": bool(power_on), "ip": ip}})


def op_ping(p):
    """Health check — no robot required."""
    return ok({"message": "pong",
               "data": {"python": sys.version.split()[0], "urbasic": True}})


def op_get_digital_in(p):
    ip = str(p["ip"])
    which = str(p.get("which", "std")).lower()
    robot, _ = ensure_connected(ip)
    if which == "config":
        n = _bounded_int(p["n"], "n", 8, 15, "config 端口号")
        val = robot.get_configurable_digital_in(n)
    elif which == "tool":
        n = _bounded_int(p["n"], "n", 0, 1, "tool 端口号")
        # Tool digital inputs are not on RTDE; get_tool_digital_in runs a
        # URScript expression via the RealTime client and reads the result back.
        val = robot.get_tool_digital_in(n)
    else:
        n = _bounded_int(p["n"], "n", 0, 7, "std 端口号")
        val = robot.get_standard_digital_in(n)
    return ok({"message": "%s" % bool(val),
               "data": {"which": which, "port": n, "value": bool(val), "ip": ip}})


def op_set_digital_out(p):
    ip = str(p["ip"])
    which = str(p.get("which", "std")).lower()
    value = bool(p["value"])
    robot, _ = ensure_connected(ip)
    if which == "config":
        n = _bounded_int(p["n"], "n", 8, 15, "config 端口号")
        robot.set_configurable_digital_out(n, value)
    elif which == "tool":
        n = _bounded_int(p["n"], "n", 0, 1, "tool 端口号")
        # Tool digital outputs are not on RTDE; set_tool_digital_out sends the
        # URScript `write_tool_digital_out` command over the RealTime client.
        robot.set_tool_digital_out(n, value)
    else:
        n = _bounded_int(p["n"], "n", 0, 7, "std 端口号")
        robot.set_standard_digital_out(n, value)
    return ok({"message": "已设置数字输出 %s.%d = %s" % (which, n, value),
               "data": {"which": which, "port": n, "value": value, "ip": ip}})


def op_get_analog_in(p):
    ip = str(p["ip"])
    n = _bounded_int(p["n"], "n", 0, 1, "模拟输入端口号")
    robot, _ = ensure_connected(ip)
    val = robot.get_standard_analog_in(n)
    return ok({"message": "%s" % val, "data": {"port": n, "value": val, "ip": ip}})


def op_set_analog_out(p):
    ip = str(p["ip"])
    n = _bounded_int(p["n"], "n", 0, 1, "模拟输出端口号")
    value = float(p["value"])
    robot, _ = ensure_connected(ip)
    # URBasic's set_standard_analog_out is an unimplemented stub (raises
    # NotImplementedError); send the URScript set_analog_out command directly
    # over the RealTime client instead, the same pattern as set_tool_digital_out.
    robot.robotConnector.RealTimeClient.Send('set_analog_out(%d, %.4f)\n' % (n, value))
    return ok({"message": "已设置模拟输出 %d = %s" % (n, value),
               "data": {"port": n, "value": value, "ip": ip}})


def op_set_tool_voltage(p):
    ip = str(p["ip"])
    voltage = int(p["voltage"])
    robot, _ = ensure_connected(ip)
    robot.set_tool_voltage(voltage)
    return ok({"message": "已设置工具电压为 %sV" % voltage,
               "data": {"voltage": voltage, "ip": ip}})


def op_set_tcp(p):
    ip = str(p["ip"])
    pose = _vec(p, "pose", 6, "set_tcp 的 pose")
    robot, _ = ensure_connected(ip)
    robot.set_tcp(pose)
    return ok({"message": "已设置 TCP：%s" % pose,
               "data": {"tcp": pose, "ip": ip}})


def op_set_payload(p):
    ip = str(p["ip"])
    mass = float(p["mass"])
    cog = _vec(p, "cog", 3, "set_payload 的 cog") if p.get("cog") is not None else [0.0, 0.0, 0.0]
    robot, _ = ensure_connected(ip)
    # URBasic's base `set_payload(m, CoG)` is a NotImplementedError stub; send the
    # two implemented URScript commands directly instead.
    cog_str = "p[%.4f,%.4f,%.4f]" % tuple(cog)
    script = "set_payload_mass(%.4f)\nset_payload_cog(%s)\n" % (mass, cog_str)
    robot.robotConnector.RealTimeClient.Send(script)
    return ok({"message": "已设置负载：%skg，重心 %s" % (mass, cog),
               "data": {"mass": mass, "cog": cog, "ip": ip}})


def op_movep(p):
    ip = str(p["ip"])
    pose = _vec(p, "pose", 6, "movep 的 pose")
    a = _nonneg_float(p.get("a", 1.2), "a", "movep 的加速度", allow_zero=False)
    v = _nonneg_float(p.get("v", 0.25), "v", "movep 的速度", allow_zero=False)
    r = _nonneg_float(p.get("r", 0), "r", "movep 的交融半径")
    robot, _ = ensure_connected(ip)
    robot.movep(pose, a, v, r, wait=False)
    cmd = "movep(p%s, a=%s, v=%s, r=%s)" % (pose, a, v, r)
    return ok({"message": "命令已发送：%s" % cmd,
               "data": {"command": cmd, "ip": ip}})


def op_movec(p):
    ip = str(p["ip"])
    via = _vec(p, "pose_via", 6, "movec 的 pose_via")
    to = _vec(p, "pose_to", 6, "movec 的 pose_to")
    a = _nonneg_float(p.get("a", 1.2), "a", "movec 的加速度", allow_zero=False)
    v = _nonneg_float(p.get("v", 0.25), "v", "movec 的速度", allow_zero=False)
    r = _nonneg_float(p.get("r", 0), "r", "movec 的交融半径")
    robot, _ = ensure_connected(ip)
    robot.movec(via, to, a, v, r, wait=False)
    cmd = "movec(p%s, p%s, a=%s, v=%s, r=%s)" % (via, to, a, v, r)
    return ok({"message": "命令已发送：%s" % cmd,
               "data": {"command": cmd, "ip": ip}})


def op_servoj(p):
    ip = str(p["ip"])
    q = _vec(p, "q", 6, "servoj 的 q")
    t = float(p.get("t", 0.008))
    look = float(p.get("lookahead_time", 0.1))
    gain = int(p.get("gain", 100))
    robot, _ = ensure_connected(ip)
    robot.servoj(q, t, look, gain, wait=False)
    return ok({"message": "servoj 已下发（连续流单步）：%s" % q,
               "data": {"q": q, "t": t, "lookahead_time": look, "gain": gain, "ip": ip}})


def _bit_masks(model):
    di = model.dataDir.get("actual_digital_input_bits") if hasattr(model.dataDir, "get") else None
    do = model.dataDir.get("actual_digital_output_bits") if hasattr(model.dataDir, "get") else None

    def bits(mask):
        return {str(i): bool(mask & (1 << i)) for i in range(16)} if mask is not None else None

    return bits(di), bits(do)


def op_get_digital_input_bits(p):
    ip = str(p["ip"])
    _, model = ensure_connected(ip)
    di, _ = _bit_masks(model)
    return ok({"message": "数字输入位（std 0-7 + config 8-15）：%s" % di,
               "data": {"bits": di, "ip": ip}})


def op_get_digital_output_bits(p):
    ip = str(p["ip"])
    _, model = ensure_connected(ip)
    _, do = _bit_masks(model)
    return ok({"message": "数字输出位（std 0-7 + config 8-15）：%s" % do,
               "data": {"bits": do, "ip": ip}})


def op_get_conveyor(p):
    ip = str(p["ip"])
    robot, _ = ensure_connected(ip)
    tick = robot.get_conveyor_tick_count()
    if hasattr(tick, "tolist"):
        tick = tick.tolist()
    elif hasattr(tick, "item"):
        tick = tick.item()
    return ok({"message": "传送带 tick：%s" % tick,
               "data": {"tick_count": tick, "ip": ip}})


def op_set_conveyor_tick(p):
    ip = str(p["ip"])
    tick = int(p["tick_count"])
    res = int(p.get("absolute_encoder_resolution", 0))
    robot, _ = ensure_connected(ip)
    robot.set_conveyor_tick_count(tick, res)
    return ok({"message": "已设置传送带 tick=%s" % tick,
               "data": {"tick_count": tick, "ip": ip}})


HANDLERS = {
    "connect": op_connect,
    "disconnect": op_disconnect,
    "status": op_status,
    "get_tcp_pose": op_get_tcp_pose,
    "get_joint_pose": op_get_joint_pose,
    "get_robot_model": op_get_robot_model,
    "get_serial_number": op_get_serial_number,
    "get_time": op_get_time,
    "get_software_version": op_get_software_version,
    "get_safety_mode": op_get_safety_mode,
    "get_robot_mode": op_get_robot_mode,
    "get_program_state": op_get_program_state,
    "get_robot_current": op_get_robot_current,
    "get_robot_voltage": op_get_robot_voltage,
    "get_joint_temperatures": op_get_joint_temperatures,
    "get_int_register": op_get_int_register,
    "get_double_register": op_get_double_register,
    "get_bit_register": op_get_bit_register,
    "list_programs": op_list_programs,
    "send_script": op_send_script,
    "movej": op_movej,
    "movel": op_movel,
    "move_x": op_move_x,
    "move_y": op_move_y,
    "move_z": op_move_z,
    "draw_circle": op_draw_circle,
    "draw_square": op_draw_square,
    "draw_rectangle": op_draw_rectangle,
    "draw_star": op_draw_star,
    "load_program": op_load_program,
    "run_program": op_run_program,
    "stop_program": op_stop_program,
    "pause_program": op_pause_program,
    "reset_error": op_reset_error,
    "ping": op_ping,
    "get_digital_in": op_get_digital_in,
    "set_digital_out": op_set_digital_out,
    "get_analog_in": op_get_analog_in,
    "set_analog_out": op_set_analog_out,
    "set_tool_voltage": op_set_tool_voltage,
    "set_tcp": op_set_tcp,
    "set_payload": op_set_payload,
    "movep": op_movep,
    "movec": op_movec,
    "servoj": op_servoj,
    "get_digital_input_bits": op_get_digital_input_bits,
    "get_digital_output_bits": op_get_digital_output_bits,
    "get_conveyor": op_get_conveyor,
    "set_conveyor_tick": op_set_conveyor_tick,
}


def respond(payload):
    # Write UTF-8 bytes on the raw buffer so locale text encodings (e.g. GBK on
    # Chinese Windows) can never corrupt or reject the JSON. Node's readline
    # decodes the pipe as UTF-8, so Chinese values round-trip cleanly.
    line = (json.dumps(payload, ensure_ascii=False, default=_json_default) + "\n").encode("utf-8")
    buf = getattr(_PROTOCOL_OUT, "buffer", None)
    if buf is not None:
        buf.write(line)
        buf.flush()
    else:
        _PROTOCOL_OUT.write(line.decode("utf-8"))
        _PROTOCOL_OUT.flush()


def selfcheck():
    """Validate the Python runtime without touching a robot.

    Runs `python ur_worker.py --selfcheck`. Prints a JSON summary to the real
    stdout and returns 0 when the required pieces are present.
    """
    results = {
        "python": sys.version.split()[0],
        "urbasic": True,
        "numpy": None,
        "paramiko": None,
        "rtde_config_exists": None,
    }
    try:
        import numpy
        results["numpy"] = numpy.__version__
    except Exception as e:
        results["numpy"] = "ERROR: %s" % e
        results["urbasic"] = False
    try:
        import paramiko
        results["paramiko"] = paramiko.__version__
    except Exception as e:
        results["paramiko"] = "ERROR: %s" % e

    rtde_config = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "URBasic", "rtdeConfigurationDefault.xml")
    results["rtde_config_exists"] = os.path.isfile(rtde_config)

    # URBasic is imported at module load — reaching here proves it is present.
    _PROTOCOL_OUT.write(json.dumps(results, ensure_ascii=False) + "\n")
    _PROTOCOL_OUT.flush()

    ok = (isinstance(results["numpy"], str) and results["numpy"][0].isdigit()
          and isinstance(results["paramiko"], str) and results["paramiko"][0].isdigit()
          and results["rtde_config_exists"] and results["urbasic"])
    return 0 if ok else 1


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            op_name = req.get("op")
            params = {k: v for k, v in req.items() if k not in ("id", "op")}
            handler = HANDLERS.get(op_name)
            if handler is None:
                raise ValueError("未知操作：%s" % op_name)
            data = handler(params)
            if isinstance(data, dict) and "error" in data:
                respond({"id": req_id, "ok": False, "data": None,
                         "error": data["error"]})
            else:
                respond({"id": req_id, "ok": True, "data": data})
        except Exception:
            respond({"id": req_id, "ok": False, "data": None,
                     "error": traceback.format_exc(limit=1).strip()})


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selfcheck":
        sys.exit(selfcheck())
    main()

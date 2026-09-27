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
import threading
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


# ---- 结构化错误码 ---------------------------------------------------------
#
# 协议过去只有一句中文 `error` 字符串，模型/脚本无法据此分支处理（"连不上"和"参数非法"
# 都是同一种失败）。现在补一个稳定的 `code`，同时**保留**人类可读的 error 文本。
#
# 为什么 `respond()` 还要拒绝 NaN/Infinity：Python 的 json.dumps 默认把它们写成
# `NaN` / `Infinity` —— 那不是合法 JSON，Node 的 JSON.parse 会抛，而 worker.js 的
# `_onLine` 又会**静默丢弃**解析失败的行 ⇒ 调用方只看到一句笼统的 "timed out"，
# 真正的原因（某次读取返回了非有限值）永远查不到。宁可在这里大声报错。
ERROR_CODES = {
    "BADARG": "参数非法（缺字段/维度不对/超范围/非有限数值）",
    "NOT_CONNECTED": "未连接或连接已断开",
    "CONNECT_FAILED": "连接机器人失败",
    "TIMEOUT": "等待机器人响应超时",
    "SAFETY": "机器人处于安全停止状态，指令被拒绝",
    "NOT_REMOTE": "控制器不在远程控制模式，URScript 会被静默丢弃",
    "SEND_FAILED": "脚本未能送达控制器",
    "UNSUPPORTED": "当前控制器/固件不支持该操作",
    "HUGE": "未实现的内部错误",
}


class WorkerError(Exception):
    """带稳定错误码的业务异常（handler 抛它，main() 直接映射成协议响应）。"""

    def __init__(self, code, message, data=None):
        super(WorkerError, self).__init__(message)
        self.code = code if code in ERROR_CODES else "HUGE"
        self.data = data


def _error_code_for(exc):
    """把异常映射成错误码。保持"粗但稳定"，不追求精确分类。"""
    if isinstance(exc, WorkerError):
        return exc.code
    if isinstance(exc, ValueError):
        return "BADARG"
    if isinstance(exc, TimeoutError):
        return "TIMEOUT"
    if isinstance(exc, ConnectionError):
        return "NOT_CONNECTED"
    if isinstance(exc, NotImplementedError):
        return "UNSUPPORTED"
    return "HUGE"


def err(message, code=None, data=None):
    """构造一个失败结果。`code` 缺省时按消息内容猜一个（兼容既有调用点）。"""
    out = {"error": str(message)}
    if code is None:
        lowered = str(message)
        if "超时" in lowered:
            code = "TIMEOUT"
        elif "未连接" in lowered or "连接不存在" in lowered or "连接失败" in lowered:
            code = "CONNECT_FAILED" if "失败" in lowered else "NOT_CONNECTED"
        elif "必须是" in lowered or "缺失" in lowered or "范围" in lowered or "拒绝" in lowered:
            code = "BADARG"
        elif "远程控制" in lowered:
            code = "NOT_REMOTE"
        else:
            code = "HUGE"
    out["code"] = code
    if data is not None:
        out["data"] = data
    return out

# The JSON protocol lives on the real stdout (stdin/stdout pipe). Isolate the
# vendored URBasic library's own print() output to a log file so it cannot
# corrupt the response channel: URBasic (rtde.py, urScript.py, dashboard.py,
# ...) prints diagnostic lines to stdout that are not part of the protocol.
_PROTOCOL_OUT = sys.stdout
_LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ur_worker.log")

# 日志上限：一份现役 + 一份滚动的旧文件，磁盘占用因此被钳在 ~2×上限。
# 为什么必须有：URBasic 的 RTDE 重连失败分支会**每次循环**打印（上游没有 sleep，
# 断链时等于每秒数万行），实测单机日志被推到 277 MB / 1076 万行。限速见
# URBasic/rtde.py 里那段注释，这里再加一道与写入者无关的兜底。
_LOG_MAX_BYTES = 8 * 1024 * 1024


class _CappedLog:
    """带大小上限的日志文件：写满就滚成 ``<path>.1``（覆盖上一份旧日志）。

    只实现 URBasic 用得到的 ``write``/``flush``（它把 stdout 当文件用）。

    **必须线程安全**：RTDE 接收线程、Dashboard 接收线程、RealTimeClient 的等待线程都会
    直接 print（即调用本对象的 write）。上游没有锁时，一次 ``_roll()`` 可能正好在另一个
    线程的 ``write()`` 中间关掉文件句柄 ⇒ 那个线程抛 ValueError 当场死亡（RTDE 线程一死，
    `isRunning()` 就永远为 False，整条连接再也不能用）。
    """

    def __init__(self, path, max_bytes):
        self._path = path
        self._max = max_bytes
        self._lock = threading.RLock()
        self._written = self._current_size()
        # newline="" ⇒ 不做 \n→\r\n 翻译：日志用 LF，且下面对写入字节数的统计与磁盘上
        # 的真实大小一致（否则每次换行都会多一个字节，限幅会被低估）。
        self._handle = open(path, "a", encoding="utf-8", buffering=1, newline="")

    def _current_size(self):
        try:
            return os.path.getsize(self._path)
        except OSError:
            return 0

    def _roll(self):
        try:
            self._handle.close()
        except Exception:
            pass
        try:
            os.replace(self._path, self._path + ".1")
        except OSError:
            pass
        self._handle = open(self._path, "a", encoding="utf-8", buffering=1, newline="")
        self._written = 0

    def write(self, text):
        if not isinstance(text, str):
            text = str(text)
        with self._lock:
            if self._written + len(text) > self._max:
                self._roll()
            self._handle.write(text)
            self._written += len(text)
            return len(text)

    def flush(self):
        with self._lock:
            try:
                self._handle.flush()
            except Exception:
                pass

    def close(self):
        with self._lock:
            try:
                self._handle.close()
            except Exception:
                pass

    # 少量文件对象的常见接口：URBasic 只用到 print/write，但第三方代码偶尔会问这些，
    # 缺了就会 AttributeError（把「日志」变成「崩溃」）。
    encoding = "utf-8"

    def isatty(self):
        return False

    def fileno(self):
        return self._handle.fileno()

    def writable(self):
        return True


_LOG = _CappedLog(_LOG_PATH, _LOG_MAX_BYTES)
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

# 连接构造的硬上限（秒）。依据：URBasic 自己那圈“等 RTDE 数据就绪”是 20×1 s
# （`urScript.py` 的 `_ready_waits > 20`），再叠加 rtde / realTimeClient 各自最长 60 s 的重连
# 循环与 dashboard 的 2 s —— 构造完全可能几十秒不返回。这个值必须**小于** Node 侧默认的
# 60 s 命令超时（`lib/worker.js` 的 `commandTimeoutMs`），否则调用方先收到自己那句笼统的
# “timed out”，看不到下面那条说明原因的 worker 错误。
CONNECT_TIMEOUT_S = 20.0

# 当前正在处理的请求（worker 单线程串行处理，故用模块级变量即可）：自杀前用它回一条可读错误。
_CURRENT_REQUEST_ID = None
_CURRENT_TIMEOUT_MS = None


def _connect_or_exit(ip):
    """构造 UrScriptExt；超过预算仍未返回就 ``os._exit(1)``。

    **为什么是进程级自杀，而不是抛错或尽力清理**：连接构造卡住时，控制器侧的 RTDE 会话仍被占着
    ——控制器同一时刻只接受一个 RTDE 客户端——而那些半成品线程/套接字已经无法可靠取消，
    清理本身也会卡。只有进程退出能真正把它们交还给操作系统。

    `lib/worker.js` 已有对应处理：进程一退出就把在飞请求全部失败，并在**下次调用**时按
    `restartDelayMs`（500 ms）退避重新拉起一个干净 worker。所以调用方只需重试一次，
    不必再人工重启任何东西。

    @returns (robot, robot_model)
    @raises 构造函数在预算内失败时，原样抛出它自己的异常。
    """
    budget = CONNECT_TIMEOUT_S
    if isinstance(_CURRENT_TIMEOUT_MS, (int, float)) and _CURRENT_TIMEOUT_MS > 0:
        budget = min(budget, max(1.0, float(_CURRENT_TIMEOUT_MS) / 1000.0))

    box = {}

    def build():
        try:
            robot_model = URBasic.robotModel.RobotModel()
            box["robot"] = URBasic.urScriptExt.UrScriptExt(host=ip, robotModel=robot_model)
            box["model"] = robot_model
        except BaseException as exc:  # 交给主线程按原语义抛出
            box["error"] = exc

    thread = threading.Thread(target=build, name="ur-connect", daemon=True)
    thread.start()
    thread.join(budget)

    if thread.is_alive():
        _log("连接 %s 在 %.1fs 内未完成 —— 进程自杀，避免卡住整条调用链"
             "（控制器侧可能仍占着上一次未回收的 RTDE 会话）" % (ip, budget))
        respond({"id": _CURRENT_REQUEST_ID, "ok": False, "data": None,
                 "error": "连接 %s 超时（%.0fs 内未完成）。控制器可能仍占着上一次未回收的 RTDE "
                          "会话；worker 已自行退出，直接重试一次即可（会自动换一个干净进程）。" % (ip, budget)})
        os._exit(1)

    if "error" in box:
        raise box["error"]
    return box["robot"], box["model"]


def ok(data):
    return data


# `err()`、`WorkerError`、`ERROR_CODES` 定义在文件前部（协议/序列化区），
# 因为它们既被 handler 使用，也被 main() 的异常映射使用。


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

    # 连接构造有硬预算：卡住时 _connect_or_exit() 会让本进程自杀，而不是把整条调用链拖住
    # （控制器侧那个未回收的 RTDE 会话只有进程退出才能真正释放）。
    robot, robot_model = _connect_or_exit(ip)
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


# ---------------------------------------------------------------------------
# 脚本发送 / 运动预检查
# ---------------------------------------------------------------------------

def _realtime(robot):
    return robot.robotConnector.RealTimeClient


def _last_send_failure(robot):
    return getattr(_realtime(robot), "lastSendFailure", None) or "原因未知"


def _send_program(robot, script):
    """把一段 URScript 送到控制器并**如实返回是否送出去了**（bool）。

    修好 `RealTimeClient.__sendPrg` 之后 `SendProgram` 已经会返回布尔值。这里对**没有**
    返回值的实现（其它版本/被替换的假对象）按"已交给发送路径"处理并记一条日志 ——
    把它当成失败会让"控制器没回 ACK"这种常态被误报为发送失败。
    """
    sender = getattr(_realtime(robot), "SendProgram", None)
    if not callable(sender):
        return False
    try:
        result = sender(script)
    except Exception as exc:
        _log("SendProgram 抛异常：%r" % (exc,))
        return False
    if result is None:
        _log("SendProgram 未返回布尔值（该实现未报告发送结果），按已发送处理")
        return True
    return bool(result)


def _realtime_send(robot, script):
    """发一条单行 URScript 语句（`set_*` 那一类）。Returns bool。"""
    sender = getattr(_realtime(robot), "Send", None)
    if not callable(sender):
        return False
    try:
        result = sender(script)
    except Exception as exc:
        _log("RealTimeClient.Send 抛异常：%r" % (exc,))
        return False
    if result is None:
        _log("RealTimeClient.Send 未返回布尔值（该实现未报告发送结果），按已发送处理")
        return True
    return bool(result)


def _budget_ms(p, reserve_ms=1000):
    """把 Node 给的命令预算收窄一点，留给 worker 回报错误。

    Node 侧的超时计时**从写入请求那一刻**就开始，而 worker 拿到预算后才开始干活；
    若两者相等，真实超时的调用方只会看到 Node 那句笼统的 "timed out"，看不到 worker
    更具体的原因（"移动未确认到位" / "未观察到脚本开始执行"）。`op_send_script`
    早就在这么做，这里把它推广到所有长耗时操作。
    """
    try:
        total = int(p.get("_timeout_ms", 60000))
    except Exception:
        total = 60000
    return max(1000, total - reserve_ms)


def _assert_remote_control(ip, what):
    """发送 URScript 之前的预检查：不在远程控制模式时**提前**给出可读原因。

    为什么值得做：本地/示教器模式下控制器会**静默丢弃** URScript（不报错），于是运动类
    工具会一直等到确认循环超时，最后报一句"移动结束但未到达目标（位置存在偏差）"——
    把"指令根本没被接收"误导成"位置有偏差"。这里问一次 dashboard（三态探测），
    确认 false 就直接失败。**未知（None）不拦**：探测不到不等于不在远程模式，不能因为
    旁证缺失就拒绝执行。
    """
    try:
        state, raw = _remote_control(dashboard(ip))
    except Exception:
        return
    if state is False:
        raise WorkerError(
            "NOT_REMOTE",
            "%s 之前检测到控制器**不在远程控制模式**（dashboard 回答 %r）：本地/示教器模式下 "
            "URScript 与运动指令会被控制器静默丢弃，因此已提前中止。请在示教器上切到远程控制"
            "（或确认 PolyScope 的 Remote Control 设置）后重试。" % (what, raw),
        )


def _dashboard_send(d, cmd):
    """对**已有 dashboard 句柄**执行一条命令并只认本次应答。Returns (ok, respond)。

    ## 为什么所有 dashboard 读取都必须经过这里（陈旧应答）
    `Dashboard.__send()` 的流程是「sendall → wait_dbs → return」，而 `wait_dbs()` 只等
    "任意一次 notify"、**不校验应答属于哪条命令**；`last_respond` 也只在真正收到消息时
    才被覆盖。于是当应答丢失/接收线程已停时，调用方读到的是**上一条命令的应答**。
    最典型的事故：上一条 `isProgramSaved` 刚回过 "True"，紧接着问 `is in remote control`，
    于是一台**没在远程控制模式**的机器人被报成 `remote_control: true`，模型据此下发
    URScript，被控制器静默丢弃，而工具全程回报成功。
    ⇒ `sendCommand()` 会先清空 `last_respond`，只认发送之后新到达的应答；这里统一走它。
    """
    send_command = getattr(d, "sendCommand", None)
    if callable(send_command):
        return send_command(cmd)
    # 旧版 Dashboard 没有 sendCommand：退回直接调用（wait_dbs 现在至少有超时）。
    try:
        getattr(d, cmd)()
    except Exception as exc:
        return False, "%s: %s" % (type(exc).__name__, exc)
    return True, (d.last_respond or "").strip()


def _dashboard_cmd(ip, cmd):
    """按 IP 执行一条 dashboard 命令。Returns (ok, respond)。见 `_dashboard_send`。"""
    try:
        d = dashboard(ip)
    except Exception as exc:
        return False, "%s: %s" % (type(exc).__name__, exc)
    return _dashboard_send(d, cmd)


def _dashboard_cmd_args(ip, cmd, *args):
    """按 IP 执行一条**带参数**的 dashboard 命令。Returns (ok, respond)。

    存在的理由：`_dashboard_send` 只支持无参命令，而 `ur_load(<file>)` 需要参数。
    这里用同一套"清空 last_respond → 发送 → 只认本次应答"的顺序，避免读到陈旧应答。
    """
    try:
        d = dashboard(ip)
    except Exception as exc:
        return False, "%s: %s" % (type(exc).__name__, exc)
    try:
        d.last_respond = None
    except Exception:
        pass
    try:
        getattr(d, cmd)(*args)
    except Exception as exc:
        return False, "%s: %s" % (type(exc).__name__, exc)
    respond = getattr(d, "last_respond", None)
    if respond is None:
        return False, ""
    return True, str(respond).strip()


def _remote_control(d):
    """探测机器人是否处于远程控制模式：**三态**。Returns (state, raw)。

    state 取值：
      - ``True``  —— dashboard 明确回答 "true"；
      - ``False`` —— dashboard 明确回答 "false"；
      - ``None``  —— **未知**：dashboard 没回答、回答不可解析（例如
        "could not understand ..."）或探测本身抛异常。

    为什么必须三态：把「没问到」与「问到了，是 false」混为一谈，会让工具对着一台状态未知的
    机器人给出「请去 PolyScope 开启 Remote Control」的指引——那是**基于未知道信息的断言**。
    而且真正决定 URScript 能不能生效的是控制器的实际模式，dashboard 的回答只是个旁证：
    所以未知时如实说未知，false 时也只在固件不在「CB3 3.1–3.20 默认可用」区间时才提示用户去改设置。
    """
    raw = ""
    try:
        ok_flag, respond = _dashboard_send(d, "ur_is_remote_control")
        if ok_flag:
            raw = respond
    except Exception:
        return None, raw
    lowered = raw.lower()
    if lowered == "true":
        return True, raw
    if lowered == "false":
        return False, raw
    return None, raw


def _software_version(d):
    """Read the controller's URSoftware / PolyScope version string ("" when unreadable)."""
    try:
        ok_flag, respond = _dashboard_send(d, "ur_polyscopeVersion")
        return respond if ok_flag else ""
    except Exception:
        return ""


# CB3（URSoftware 3.1–3.20）**默认就允许 Remote Control**，不需要在 PolyScope 里额外开启。
# 因此 dashboard 的 `ur_is_remote_control` 报 false 时，对这一段固件**不能**给出
# 「请去 PolyScope 开启」的指引 —— 那是错误指引（会让用户去改一个本就无需改的设置）。
# 这条事实由用户明确给出（2026-09-27），覆盖全部 CB3 3.1–3.20 固件。
CB3_REMOTE_CONTROL_DEFAULT_MINOR = (1, 20)


def cb3_remote_control_default_on(version):
    """该 URSoftware/PolyScope 版本是否落在「CB3 默认允许 Remote Control」区间（3.1–3.20）。

    @param version 形如 ``"3.15.8.106339"``；无法解析时返回 False（保守：仍给开启提示）。
    """
    m = re.match(r"\s*(\d+)\.(\d+)", str(version or ""))
    if m is None:
        return False
    major, minor = int(m.group(1)), int(m.group(2))
    low, high = CB3_REMOTE_CONTROL_DEFAULT_MINOR
    return major == 3 and low <= minor <= high


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
        raise ValueError(what + " 必须是数值数组（如 [1.0,2.0,...]）")
    if len(vals) != n:
        raise ValueError(what + " 必须是 %d 维数组，收到 %d 维" % (n, len(vals)))
    for v in vals:
        if not math.isfinite(v):
            # JSON 允许 `NaN`/`Infinity`（Python 的 json.loads 默认接），一路走到
            # `movel(p[nan,...])` 会让控制器收到一段语义未定义的脚本；而在返回路径上
            # 非有限值又会被写成非法 JSON（见 respond()）。在入口就拦住。
            raise ValueError(what + " 含非有限数值（NaN/Infinity），已拒绝")
    return vals


def _bounded_int(raw, key, lo, hi, what):
    """Coerce `p[key]` to an int within [lo, hi] or raise ValueError.

    Guards register indices and I/O port numbers: an out-of-range value would
    otherwise reach `dataDir['output_int_register_<n>']` and raise a KeyError, or
    an invalid port would silently return None. Since DSH 1.5.3's value-schema
    DSL rejects JSON-Schema numeric constraints, **this is the authoritative
    range check** for these parameters (the tool descriptions only *document*
    the range).
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
    if not math.isfinite(v):
        raise ValueError(what + " 必须是有穷数值，收到 %s" % v)
    threshold = 0 if allow_zero else 0
    if v < threshold:
        raise ValueError(what + " 不能为负数，收到 %s" % v)
    if not allow_zero and v == 0:
        raise ValueError(what + " 必须大于 0，收到 0")
    return v


def _bounded_float(raw, key, lo, hi, what):
    """Coerce `p[key]` to a float within [lo, hi] or raise ValueError.

    Used for `servoj`'s online-control parameters (control period, lookahead
    time, proportional gain). Those ranges used to be declared in the tool's
    JSON schema, but DSH 1.5.3's value-schema DSL no longer accepts JSON-Schema
    numeric constraints (`minimum`/`maximum`/`exclusiveMinimum`) — a tool that
    declares them fails to register entirely. The range therefore lives here:
    **this function is the only enforcement** for these three parameters, and
    out-of-range values would drive the robot's online controller unstable.
    """
    try:
        v = float(raw)
    except (TypeError, ValueError):
        raise ValueError(what + " 必须是数值，收到 %r" % (raw,))
    if not math.isfinite(v):
        raise ValueError(what + " 必须是有穷数值，收到 %s" % v)
    if not (lo <= v <= hi):
        raise ValueError(what + " 必须在 [%s, %s] 范围内，收到 %s" % (lo, hi, v))
    return v


def _round_pose(pose):
    return [round(x, 3) for x in pose]


def _right_pose_joint(current, q, tol=0.1):
    return all(current[i] + tol >= q[i] >= current[i] - tol for i in range(6))


def _rotation_angle_between(rotvec_a, rotvec_b):
    """两个 UR 姿态旋转向量（轴角）之间的**最小旋转夹角**（弧度，[0, π]）。

    ⚠️ 为什么不能逐分量比较：`(rx,ry,rz)` 是轴角表示，同一个姿态有无数等价写法 ——
    `[0,0,2π]` 与 `[0,0,0]` 是**同一个姿态**（逐分量比较会判成相差 6.28）；
    而 `[0.05,0,0]` 与 `[0,0,0.05]` 是**不同姿态**（绕不同轴转 0.05）却逐分量只差 0.05。
    因此到达判定必须走矩阵：θ = acos((tr(R_aᵀ R_b) − 1) / 2)。
    """
    ra = _rotvec_to_matrix(rotvec_a)
    rb = _rotvec_to_matrix(rotvec_b)
    cos_theta = (float(np.trace(ra.T.dot(rb))) - 1.0) / 2.0
    # 数值误差可能让 cos 略超 [-1,1]，acos 会得到 nan
    cos_theta = max(-1.0, min(1.0, cos_theta))
    return math.acos(cos_theta)


def _right_pose_tcp(current, pose, pos_tol=0.010, rot_tol=0.05):
    """判断 TCP 是否"到位"：位置逐分量、姿态用**夹角**。

    位置用 10 mm 线性容差；姿态用 0.05 rad（≈2.9°）的**角**容差 —— 见
    `_rotation_angle_between` 的说明，逐分量比较会同时产生假阴（等价姿态判为偏差）与
    假阳（不同姿态判为到位）。
    """
    if not all(current[i] + pos_tol >= pose[i] >= current[i] - pos_tol for i in range(3)):
        return False
    return _rotation_angle_between(current[3:6], pose[3:6]) <= rot_tol


# RTDE 的 `robot_status_bits` 第 1 位 = 程序正在运行（UR RTDE 文档）。
ROBOT_STATUS_PROGRAM_RUNNING = 0x2


def _program_running(ip):
    """程序是否在运行 —— **优先读 RTDE 状态位**，不再依赖 dashboard 往返。

    为什么改：旧实现每次都跑一趟 dashboard（`ur_running`），而 dashboard 是一条
    带状态机的单 socket 协议（应答靠 `last_respond` 传递、接收线程可能已停）。用它做
    每秒一次的确认轮询，既慢又错 —— 只要 `last_respond` 里残留着上一条 `isProgramSaved`
    的 "True"，就会把"没在运行"读成"在运行"，于是确认循环一路空转到超时。
    RTDE 的 `robot_status_bits` 是随数据流以 500 Hz 更新的，读它零成本、无往返、不可能陈旧。
    """
    try:
        model = ROBOT_MODELS.get(ip)
        if model is not None:
            word = model.dataDir.get("robot_status_bits") if hasattr(model.dataDir, "get") else None
            if word is not None:
                return bool(int(word) & ROBOT_STATUS_PROGRAM_RUNNING)
    except Exception:
        pass
    # RTDE 状态位还不可用（刚连上/数据未到）：退回 dashboard 探测。
    ok_flag, respond = _dashboard_cmd(ip, "ur_running")
    if not ok_flag:
        # 两次探测都失败：如实当作"没在运行"，好过卡住整条调用链。
        return False
    return "true" in respond.lower()


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
    """等机器人执行完一段"发完即返回"的脚本。Returns (ok, message)。

    ## 为什么必须先看到"在运行"
    旧实现是「发完脚本 → 立刻问一次"在跑吗" → 没在跑就报『执行完成』」。可是
    `RealTimeClient.SendProgram` 只是把字节写进 socket 就返回（真正的执行由控制器稍后
    开始），所以**第一次探测几乎必然看到"没在运行"** —— 于是四个绘图操作（draw_circle /
    draw_square / draw_rectangle / draw_star）无论脚本是否真的被执行，都会回报
    `ok: true`「执行完成」。而 UR 在非远程控制模式下会**静默丢弃** URScript，
    这正是最需要被区分出来的情形。
    ⇒ 现在要求先观察到"确实在运行"（`saw_running`），否则如实报告"从未观察到开始执行"。
    """
    deadline = time.time() + timeout_ms / 1000.0
    saw_running = False
    while time.time() < deadline:
        running = _program_running(ip)
        if running:
            saw_running = True
        elif saw_running:
            return True, "执行完成"
        time.sleep(0.2)
    if saw_running:
        return False, "执行未确认完成（超时 %.0fms）" % timeout_ms
    return False, ("未观察到脚本开始执行（超时 %.0fms）—— 控制器很可能没有执行这段 URScript，"
                   "最常见原因是机器人不在远程控制模式（本地/示教器模式下脚本会被静默丢弃）"
                   % timeout_ms)


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------

def op_connect(p):
    ip = str(p["ip"])
    try:
        robot, robot_model = ensure_connected(ip)
        d = robot.robotConnector.DashboardClient
        in_remote, remote = _remote_control(d)
        version = _software_version(d)
        msg = "连接成功。IP：%s" % ip
        if in_remote is False:
            if cb3_remote_control_default_on(version):
                # 「CB3 3.1–3.20 默认允许 Remote Control」说的是**设置层面已启用**，不需要在
                # 设置里额外打开；但 dashboard 的 false 说明控制器**当前**不在远程模式——本地/
                # 示教器模式下 URScript 与运动指令会被静默丢弃。两者都要说清楚，否则用户会以为
                # "默认可用"就等于"现在就能收指令"。
                msg += ("（软件版本 %s 属 CB3 的 3.1–3.20 区间：Remote Control 在设置层面默认已启用、"
                        "无需额外开启；但 dashboard 报 false 表示控制器当前不在远程模式——本地/示教器"
                        "模式下 URScript 与运动指令会被静默丢弃，请在示教器上切到远程控制后再下发）" % version)
            else:
                msg += ("（注意：机器人未处于远程控制模式，运动指令与 URScript 会被丢弃；"
                        "请在 PolyScope 中开启 Remote Control）")
        elif in_remote is None:
            msg += "（远程控制状态未知：dashboard 未给出可解析的回答 %s）" % (remote or "<空>")
        return ok({"message": msg, "remote_control": in_remote,
                   "software_version": version, "ip": ip, "connected": True})
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
        ok_flag, respond = _dashboard_cmd(ip, cmd)
        if not ok_flag:
            # Distinguish a failed dashboard query from a genuinely empty field:
            # an empty string would be indistinguishable from "no value", while a
            # marker tells the caller/model that this particular field could not
            # be read (e.g. the dashboard connection dropped) without failing the
            # whole status snapshot.
            return "<查询失败>"
        return respond

    tcp = [float(x) for x in robot.get_actual_tcp_pose()]
    joint = [float(x) for x in robot.get_actual_joint_positions()]
    try:
        timestamp = model.RobotTimestamp()
    except Exception:
        timestamp = None
    remote, remote_raw = _remote_control(d)
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
        # true / false / null（null = 未能问到，见 _remote_control 的三态说明）。
        "remote_control": remote,
        "remote_control_raw": remote_raw,
        "up_time_seconds": timestamp,
        "robot_voltage": float(model.ActualRobotVoltage()),
        "robot_current": float(model.ActualRobotCurrent()),
        "joint_temperatures": [float(x) for x in model.JointTemperatures()],
        # 这些量本来就已经在 500 Hz 的 RTDE 数据流里，读取零成本；以前没有任何工具暴露它们。
        "joint_currents": [float(x) for x in model.ActualCurrent()],
        "joint_voltages": [float(x) for x in model.ActualJointVoltage()],
        "joint_speeds": [float(x) for x in model.ActualQD()],
        "tcp_speed": [float(x) for x in model.ActualTCPSpeed()],
        "tcp_force": [float(x) for x in model.ActualTCPForce()],
        "speed_scaling": float(model.SpeedScaling()),
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
    ok_flag, model = _dashboard_cmd(ip, "ur_get_robot_model")
    if not ok_flag:
        return err("读取机器人型号失败：%s" % model, "TIMEOUT")
    remote, _ = _remote_control(d)
    return ok({"message": model,
               "data": {"robot_model": model, "remote_control": remote, "ip": ip}})


def op_get_serial_number(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    ok_flag, sn = _dashboard_cmd(ip, "ur_serial_number")
    if not ok_flag:
        return err("读取序列号失败：%s" % sn, "TIMEOUT")
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
    ok_flag, v = _dashboard_cmd(ip, "ur_polyscopeVersion")
    if not ok_flag:
        return err("读取软件版本失败：%s" % v, "TIMEOUT")
    return ok({"message": "软件版本：%s" % v,
               "data": {"software_version": v, "ip": ip}})


def op_get_safety_mode(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    ok_flag, m = _dashboard_cmd(ip, "ur_safetymode")
    if not ok_flag:
        return err("读取安全模式失败：%s" % m, "TIMEOUT")
    return ok({"message": "安全模式：%s" % m,
               "data": {"safety_mode": m, "ip": ip}})


# UR RTDE 输出位定义。只列**有明确文档**的位：没列出的位不会出现在名字表里，但仍然会以原始
# 数值回给调用方（宁可少说，也不要编造位含义）。
_SAFETY_STATUS_BITS = {
    0: "normal_mode", 1: "reduced_mode", 2: "protective_stop", 3: "recovery_mode",
    4: "safeguard_stop", 5: "system_emergency_stop", 6: "robot_emergency_stop",
    7: "emergency_stop", 8: "violation", 9: "fault", 10: "stopped_due_to_safety",
}
_ROBOT_STATUS_BITS = {
    0: "power_on", 1: "program_running", 2: "teach_button_pressed", 3: "power_button_pressed",
}


def _read_status_word(model, field):
    """读一个 32 位状态字（读不到返回 None）。

    vendored `RobotModel` 只提供解码成布尔标志的 `SafetyStatus()` / `RobotStatus()`，没有"原始值"
    访问器；而原始值本身有诊断价值（未列出的位也要能看到），所以这里直接读 `dataDir`。
    """
    try:
        value = model.dataDir[field]
        return None if value is None else int(value)
    except Exception:
        return None


def _status_bit_names(raw, table):
    """按 {位号: 名字} 表列出已置位的名字（raw 读不到时返回 None）。"""
    if raw is None:
        return None
    return [name for bit, name in sorted(table.items()) if raw & (1 << bit)]


def op_get_safety_status(p):
    """安全/机器人状态位 + 安全模式。

    为什么需要它：运动撞到安全限值时，控制器只会停下来，不会告诉你"撞的是哪一条限值"。RTDE 的
    `safety_status_bits` 能说明**是哪一类安全功能被触发**（protective stop / safeguard / violation /
    fault / stopped_due_to_safety ...），据此再去 PolyScope 的「设置 → 安全 → 安全限值」页对照具体阈值。
    数值化的限值本身**不经** RTDE/dashboard 暴露，插件读不到（这是协议限制，不是本工具的缺陷）。
    """
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)

    def dash(name):
        found, respond = _dashboard_cmd(ip, name)
        return respond if found else "<查询失败>"

    safety_raw = _read_status_word(model, "safety_status_bits")
    robot_raw = _read_status_word(model, "robot_status_bits")
    safety_names = _status_bit_names(safety_raw, _SAFETY_STATUS_BITS)
    robot_names = _status_bit_names(robot_raw, _ROBOT_STATUS_BITS)
    mode = dash("ur_safetymode")

    def hex_or_unknown(value):
        return "未知" if value is None else "0x%X" % value

    return ok({
        "message": ("安全模式：%s；安全状态位 %s（%s）；机器人状态位 %s（%s）。"
                    "注意：**配置的安全限值数值**（力/力矩/功率/动量/速度等上限）不经 RTDE/dashboard 暴露，"
                    "需在 PolyScope 的「设置 → 安全 → 安全限值」页读取；本工具能指出是哪一类安全功能被触发"
                    "（含 violation / fault），据此对照那一页的具体阈值。"
                    % (mode, hex_or_unknown(safety_raw),
                       "、".join(safety_names) if safety_names else "无置位",
                       hex_or_unknown(robot_raw),
                       "、".join(robot_names) if robot_names else "无置位")),
        "data": {
            "ip": ip,
            "safety_mode": mode,
            "robot_mode": dash("ur_robotmode"),
            "runtime_state": dash("ur_programState"),
            "safety_status_bits": safety_raw,
            "safety_status_names": safety_names,
            "robot_status_bits": robot_raw,
            "robot_status_names": robot_names,
            "limits_source": "PolyScope 设置 → 安全 → 安全限值（RTDE/dashboard 不暴露数值）",
        },
    })


def op_get_robot_mode(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    ok_flag, m = _dashboard_cmd(ip, "ur_robotmode")
    if not ok_flag:
        return err("读取运行状态失败：%s" % m, "TIMEOUT")
    return ok({"message": "运行状态：%s" % m,
               "data": {"robot_mode": m, "ip": ip}})


def op_get_program_state(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    prog_ok, prog = _dashboard_cmd(ip, "ur_get_loaded_program")
    state_ok, state = _dashboard_cmd(ip, "ur_programState")
    saved_ok, saved_raw = _dashboard_cmd(ip, "ur_isProgramSaved")
    running = _program_running(ip)
    if not (prog_ok or state_ok):
        return err("读取程序状态失败：%s" % (prog or state), "TIMEOUT")
    return ok({"message": "当前程序：%s；执行状态：%s" % (prog, state),
               "data": {"loaded_program": prog, "program_state": state,
                        # saved 读不到时给 null（"未知"），而不是谎报 false
                        "saved": (saved_raw.strip().lower() == "true") if saved_ok else None,
                        "running": running, "ip": ip}})


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

    out, errout = sh(scan_cmd)
    files = [line.strip() for line in out.split("\n") if line.strip().endswith(".urp")]
    programs = [{"path": f, "name": f.rsplit("/", 1)[-1]} for f in files]
    ssh.close()
    if errout and "find" not in errout and "No such" not in errout:
        return err("程序列表获取失败。%s" % errout)
    return ok({"message": "程序列表（%s）共 %s 个：%s" % (
        dirs_note, len(programs), [x["name"] for x in programs]),
        "data": {"programs": programs, "count": len(programs), "ip": ip}})


# ---------------------------------------------------------------------------
# send_script 执行校验（哨兵寄存器）
# ---------------------------------------------------------------------------

# RealTimeClient.SendProgram() 是**单向**的：控制器既不给 ACK，也不把 URScript 的运行期错误
# 回传给我们。所以「脚本到底执行了没有」没有直接返回值——只能在脚本前后各注入一行
# `write_output_integer_register(N, token)`，再从 RTDE 回读该寄存器。两个 token 让结论更细：
#   - 回读到**结束** token ⇒ 脚本确实在控制器上跑到了末尾；
#   - 只回读到**起始** token ⇒ 通道通、脚本开始执行了，但在预算内没跑到末尾（仍在执行、或中途
#     在控制器侧报错中止）；
#   - 两个都没回读到 ⇒ 控制器很可能**根本没执行**这段脚本（本地/示教器模式下 URScript 会被
#     静默丢弃、或脚本在编译阶段就被拒）。
# 这正是「只回一句『脚本程序已发送』」的害处：模型会以为动作生效了。
# 代价：该 int 输出寄存器的旧值会被覆盖（默认取最后一个 23，可用 register 参数改）。
DEFAULT_SENTINEL_REGISTER = 23
SEND_SCRIPT_VERIFY_TIMEOUT_S = 2.0


def _read_int_register(model, index):
    """回读 int 输出寄存器；读不到（未连接 / 该字段不在接收配方里）返回 None。"""
    try:
        value = model.OutputIntRegister(index)
        return None if value is None else int(value)
    except Exception:
        return None


def _sentinel_token(previous):
    """造一个与 `previous` 不同的哨兵 token（32 位内正数且带固定前缀，便于人眼核对）。"""
    token = 0x5A5A0000 | (int(time.time() * 1000) & 0xFFFF)
    if previous is not None and token == previous:
        token = (token + 1) & 0x7FFFFFFF
    return token


# URScript 的块结构：`def` / `if` / `while` / `for` / `switch` 各自需要一个 `end`；
# `else` / `elif` 是 if 的延续，不额外开块。
_BLOCK_OPEN_RE = re.compile(r"^\s*(?:def|if|while|for|switch)\b")
_BLOCK_END_RE = re.compile(r"^\s*end\b")
_FUNC_DEF_RE = re.compile(r"^(\s*)def\s+([A-Za-z_][\w]*)\s*\(")
_TOP_LEVEL_CALL_RE = re.compile(r"^\s*([A-Za-z_][\w]*)\s*\(")


def _find_function_bodies(lines):
    """定位每个 `def … end`：返回 [(名字, def 行号, 对应 end 行号)]（行号 0 基）。

    块用深度计数配对，所以函数体里嵌套的 if/while 不会把 `end` 认错。
    """
    bodies = []
    index = 0
    while index < len(lines):
        match = _FUNC_DEF_RE.match(lines[index])
        if match is None:
            index += 1
            continue
        depth = 1
        cursor = index + 1
        end_index = None
        while cursor < len(lines):
            if _BLOCK_OPEN_RE.match(lines[cursor]):
                depth += 1
            elif _BLOCK_END_RE.match(lines[cursor]):
                depth -= 1
                if depth == 0:
                    end_index = cursor
                    break
            cursor += 1
        if end_index is None:
            index += 1
            continue
        bodies.append((match.group(2), index, end_index))
        index = end_index + 1
    return bodies


def _inject_sentinels(script, start_sentinel, finish_sentinel):
    """把哨兵注入到「真正会被执行的那段代码」里，且**不改变脚本的执行形态**。

    两种形态，处理方式不同：

    1. **纯语句脚本**（插件自己的 `movej` / `movel` 就是这种）：顶层前后各一行。顶层语句本来就会
       被执行，所以形态不变。
    2. **含 `def … end` 的脚本**：注入到**函数体内部**（第一句 / 最后一句）。
       **绝不拼到顶层**——真机实测过：在 `def … end` 之外拼顶层哨兵，会把脚本变成
       「函数体一句都不跑、顶层语句照跑」的形态，于是哨兵回读成功、实际什么都没做 ⇒
       报出假阳性「已执行完毕 0.0 s」。注入进函数体则不改变形态，且哨兵真的代表「跑到了末尾」。
       只有一个函数时（无论顶层有没有调用）就注入它；有多个函数时只注入**被顶层调用的那个**；
       看不出调用哪个就**拒绝注入**（返回 None）——宁可不校验，也不能假报成功。

    Returns: (payload 文本 或 None, info dict)
    """
    lines = script.split("\n")
    bodies = _find_function_bodies(lines)
    if not bodies:
        return ("%s%s%s" % (start_sentinel, script if script.endswith("\n") else script + "\n",
                            finish_sentinel),
                {"mode": "top_level"})

    body_span = [(start, end) for _name, start, end in bodies]

    def inside_body(index):
        return any(start <= index <= end for start, end in body_span)

    called = []
    for index, line in enumerate(lines):
        if inside_body(index):
            continue
        call = _TOP_LEVEL_CALL_RE.match(line)
        if call is not None and any(call.group(1) == name for name, _s, _e in bodies):
            called.append(call.group(1))

    if len(set(called)) == 1:
        target = called[0]
    elif not called and len(bodies) == 1:
        target = bodies[0][0]
    else:
        return None, {"mode": "refused",
                      "functions": [name for name, _s, _e in bodies],
                      "top_level_calls": sorted(set(called))}

    def_index, end_index = next((start, end) for name, start, end in bodies if name == target)

    # 沿用函数体自身的缩进，保持排版不变。
    body_indent = ""
    if end_index > def_index + 1:
        indent_match = re.match(r"^(\s*)\S", lines[def_index + 1])
        if indent_match is not None:
            body_indent = indent_match.group(1)
    if body_indent == "":
        def_match = _FUNC_DEF_RE.match(lines[def_index])
        body_indent = (def_match.group(1) if def_match is not None else "") + "    "

    injected = (lines[:def_index + 1]
                + [body_indent + start_sentinel.strip()]
                + lines[def_index + 1:end_index]
                + [body_indent + finish_sentinel.strip()]
                + lines[end_index:])
    payload = "\n".join(injected)
    if not payload.endswith("\n"):
        payload += "\n"
    return payload, {"mode": "function_body", "function": target,
                     "def_line": def_index + 1, "end_line": end_index + 1}


def op_send_script(p):
    ip = str(p["ip"])
    script = str(p["script"])
    verify = bool(p.get("verify", True))
    robot, model = ensure_connected(ip)

    if not verify:
        if not _send_program(robot, script):
            return err("脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
        return ok({"message": "脚本已发送，但**未做执行校验**（verify=false）：本工具无法确认控制器是否真的执行了它",
                   "data": {"ip": ip, "sent": True, "verified": None}})

    index = _bounded_int(p.get("register", DEFAULT_SENTINEL_REGISTER), "register", 0, 23, "哨兵寄存器编号")
    before = _read_int_register(model, index)
    start_token = _sentinel_token(before)
    finish_token = _sentinel_token(start_token)
    start_line = "write_output_integer_register(%d, %d)\n" % (index, start_token)
    finish_line = "write_output_integer_register(%d, %d)\n" % (index, finish_token)

    payload, injection = _inject_sentinels(script, start_line, finish_line)
    if payload is None:
        # 定位不到该注入哪个函数体 ⇒ **原样发送、不做校验**。绝不用"顶层拼哨兵"糊弄过去：
        # 那正是会报假阳性的形态（见 _inject_sentinels 的说明）。
        sent = _send_program(robot, script)
        if not sent:
            return err("脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
        return ok({"message": ("脚本已按原样发送，但**无法执行校验**：脚本里有多个函数定义，"
                               "顶层看不出会调用哪一个（%s）。要做校验，请只保留一个函数、或在顶层显式调用其中一个；"
                               "也可以传 verify=false 明确表示不校验。注意：此时 verified 为 null ⇒ 表示"
                               "「未确认」，不等于成功。"
                               % ("、".join(injection.get("functions") or []) or "无")),
                   "data": {"ip": ip, "sent": True, "verified": None, "injection": injection}})
    if not _send_program(robot, payload):
        return err("脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")

    budget = min(SEND_SCRIPT_VERIFY_TIMEOUT_S,
                 max(0.5, int(p.get("_timeout_ms", 60000)) / 1000.0 - 1.0))
    deadline = time.time() + budget
    started = False
    observed = before
    while time.time() < deadline:
        observed = _read_int_register(model, index)
        if observed == finish_token:
            return ok({"message": "脚本已在控制器上执行完毕（结束哨兵 %d 已回读，用时 %.1fs）"
                                  % (finish_token, budget - max(0.0, deadline - time.time())),
                       "data": {"ip": ip, "sent": True, "verified": True,
                                "injection": injection,
                                "sentinel": {"register": index, "before": before,
                                             "start_token": start_token, "finish_token": finish_token,
                                             "observed": observed, "started": True}}})
        if observed == start_token:
            started = True
        time.sleep(0.1)

    if started:
        return ok({"message": ("脚本已在控制器上**开始执行**（起始哨兵 %d 已回读），但在 %.1fs 内未见结束哨兵"
                               "（寄存器 %d = %s，期望 %d）⇒ 它可能仍在执行，或中途在控制器侧报错中止。"
                               "如需等待完成，可稍后用 ur_status 看 program_state；"
                               "若脚本本身是阻塞/长动作脚本，可传 verify=false 跳过校验。"
                               % (start_token, budget, index, observed, finish_token)),
                   "data": {"ip": ip, "sent": True, "verified": False,
                            "injection": injection,
                            "sentinel": {"register": index, "before": before,
                                         "start_token": start_token, "finish_token": finish_token,
                                         "observed": observed, "started": True}}})
    return ok({"message": ("脚本已发送，但**连起始哨兵都没观察到**（寄存器 %d 仍为 %s，本次写入过 %d）⇒ 控制器很可能"
                           "根本没有执行这段脚本。最常见的原因：控制器未处于远程控制模式（本地/示教器模式下 URScript "
                           "按设计被静默丢弃）；其次是脚本在控制器侧被拒或立即报错（例如某个函数在该软件版本上不可用）。"
                           "可先用 ur_status 看 remote_control / program_state，或发一段最简脚本单独验证通道。"
                           % (index, observed, start_token)),
               "data": {"ip": ip, "sent": True, "verified": False,
                        "injection": injection,
                        "sentinel": {"register": index, "before": before,
                                     "start_token": start_token, "finish_token": finish_token,
                                     "observed": observed, "started": False}}})


def op_movej(p):
    ip = str(p["ip"])
    q = _vec(p, "q", 6, "movej 的 q")
    a = _nonneg_float(p.get("a", 1), "a", "movej 的加速度", allow_zero=False)
    v = _nonneg_float(p.get("v", 1), "v", "movej 的速度", allow_zero=False)
    t = _nonneg_float(p.get("t", 0), "t", "movej 的时长")
    r = _nonneg_float(p.get("r", 0), "r", "movej 的交融半径")
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "movej")
    robot.movej(q, a, v, t, r, wait=False)
    ok_flag, msg = _movej_confirm(ip, q, _budget_ms(p))
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
    _assert_remote_control(ip, "movel")
    robot.movel(pose, a, v, t, r, wait=False)
    ok_flag, msg = _movel_confirm(ip, pose, _budget_ms(p))
    cmd = "movel(p%s,%s,%s,%s,%s)" % (pose, a, v, t, r)
    return ok({"message": "命令 %s 已发送，%s" % (cmd, msg),
               "data": {"ok": ok_flag, "command": cmd, "ip": ip}})


def _axis_move(p, axis):
    ip = str(p["ip"])
    distance = float(p["distance"])
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "沿轴移动")
    pose = [float(x) for x in robot.get_actual_tcp_pose()]
    if len(pose) != 6:
        return err("读取当前 TCP 位姿异常（期望 6 维，收到 %d 维），无法沿轴移动" % len(pose))
    pose[axis] = pose[axis] + distance
    robot.movel(pose, wait=False)
    ok_flag, msg = _movel_confirm(ip, pose, _budget_ms(p))
    cmd = "movel(p[%.4f,%.4f,%.4f,%.4f,%.4f,%.4f],0.5,0.25,0,0)" % tuple(pose)
    return ok({"message": "命令 %s 已发送，%s" % (cmd, msg),
               "data": {"ok": ok_flag, "command": cmd, "ip": ip}})


def op_move_x(p):
    return _axis_move(p, 0)


def op_move_y(p):
    return _axis_move(p, 1)


def op_move_z(p):
    return _axis_move(p, 2)


def _rotvec_to_matrix(rotvec):
    """UR 的 TCP 姿态 (rx,ry,rz)（轴角：方向为旋转轴、模长为旋转角，单位弧度）→ 3×3 旋转矩阵。

    Rodrigues 公式；零旋转返回单位阵。
    """
    v = np.asarray(rotvec, dtype=float)
    theta = float(np.linalg.norm(v))
    if theta < 1e-12:
        return np.eye(3)
    k = v / theta
    skew = np.array([[0.0, -k[2], k[1]],
                     [k[2], 0.0, -k[0]],
                     [-k[1], k[0], 0.0]])
    return np.eye(3) + math.sin(theta) * skew + (1.0 - math.cos(theta)) * (skew @ skew)


def _tool_axis_move(p, axis):
    """沿**工具坐标系**的某条轴做直线移动（axis: 0=x, 1=y, 2=z）。

    做法：读当前 TCP 位姿 → 用其姿态的旋转矩阵把「工具系位移」换算成「基座系位移」→ 直接发基座系
    的 movel 目标位姿。**刻意不用 URScript 的 pose_trans**：它在各软件版本上的可用性/行为有差异
    （CB3 3.15 上出现过运行期中止），而这里的换算只用 numpy、与控制器版本无关，且目标位姿是我们
    自己算出来的、可核对——返回值里同时给出工具系位移与换算后的基座系位移。
    """
    ip = str(p["ip"])
    distance = float(p["distance"])
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "沿工具轴移动")
    pose = [float(x) for x in robot.get_actual_tcp_pose()]
    if len(pose) != 6:
        return err("读取当前 TCP 位姿异常（期望 6 维，收到 %d 维），无法沿工具轴移动" % len(pose))
    delta_tool = [0.0, 0.0, 0.0]
    delta_tool[axis] = distance
    delta_base = _rotvec_to_matrix(pose[3:6]).dot(np.asarray(delta_tool, dtype=float))
    target = [pose[0] + float(delta_base[0]), pose[1] + float(delta_base[1]),
              pose[2] + float(delta_base[2]), pose[3], pose[4], pose[5]]
    robot.movel(target, wait=False)
    ok_flag, msg = _movel_confirm(ip, target, _budget_ms(p))
    cmd = "movel(p[%.4f,%.4f,%.4f,%.4f,%.4f,%.4f],0.5,0.25,0,0)" % tuple(target)
    return ok({"message": "命令 %s 已发送（工具系 %s 轴 %.4f m ⇒ 基座系位移 [%.4f, %.4f, %.4f]），%s"
                          % (cmd, "xyz"[axis], distance, float(delta_base[0]),
                             float(delta_base[1]), float(delta_base[2]), msg),
               "data": {"ok": ok_flag, "command": cmd, "ip": ip,
                        "tool_delta": delta_tool,
                        "base_delta": [float(x) for x in delta_base]}})


def op_move_tool_x(p):
    return _tool_axis_move(p, 0)


def op_move_tool_y(p):
    return _tool_axis_move(p, 1)


def op_move_tool_z(p):
    return _tool_axis_move(p, 2)


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
    _assert_remote_control(ip, "draw_circle")
    if not _send_program(robot, cmd):
        return err("draw_circle 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    ok_flag, confirm = _wait_robot_idle(ip, _budget_ms(p))
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
    _assert_remote_control(ip, "draw_square")
    if not _send_program(robot, cmd):
        return err("draw_square 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    ok_flag, confirm = _wait_robot_idle(ip, _budget_ms(p))
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
    _assert_remote_control(ip, "draw_rectangle")
    if not _send_program(robot, cmd):
        return err("draw_rectangle 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    ok_flag, confirm = _wait_robot_idle(ip, _budget_ms(p))
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
    _assert_remote_control(ip, "draw_star")
    if not _send_program(robot, cmd):
        return err("draw_star 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    ok_flag, confirm = _wait_robot_idle(ip, _budget_ms(p))
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


# dashboard 对 stop/pause/play 的失败应答关键词。缺少这层检查时，"命令被拒"与"命令生效"
# 都只回一句原始应答，工具则一律回报成功。
_DASHBOARD_FAILURE_WORDS = (
    "could not", "not understand", "not allowed", "failed", "no program",
    "unable", "error", "denied", "not loaded",
)


def _dashboard_ok(resp):
    """dashboard 应答是否表示成功（无法判断的应答按成功处理，但会原样回报）。"""
    r = (resp or "").strip().lower()
    return not any(word in r for word in _DASHBOARD_FAILURE_WORDS)


def _loaded_program(d):
    """Authoritative check: ask the dashboard what program is loaded."""
    try:
        send_command = getattr(d, "sendCommand", None)
        if callable(send_command):
            ok_flag, respond = send_command("ur_get_loaded_program")
            return respond if ok_flag else ""
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
    target = _build_program_target(p)
    # `ur_load` 需要参数，不能走无参的 _dashboard_cmd；但**必须**沿用同一套"只认本次应答"
    # 的做法（先清空 last_respond），否则 "File not found" 会被上一条应答顶掉。
    sent, resp = _dashboard_cmd_args(ip, "ur_load", target)
    loaded = _loaded_program(dashboard(ip))
    confirmed = (not _load_failed(loaded)) and (not _load_failed(resp)) and loaded != ""
    note = "" if confirmed else "；加载未确认，请检查程序名/路径或是否在对应的 UR 实例下"
    return ok({"message": "加载程序：%s（已加载：%s%s）" % (name, loaded, note),
               "data": {"program_name": name, "target": target, "loaded": loaded,
                        "respond": resp, "sent": sent,
                        "confirmed": confirmed, "ip": ip}})


def op_run_program(p):
    ip = str(p["ip"])
    name = _sanitize_path(p.get("program_name", ""), "program_name")
    ensure_connected(ip)
    d = dashboard(ip)
    if name:
        target = _build_program_target(p)
        d.last_respond = None
        d.ur_load(target)
        loaded = _loaded_program(d)
        if _load_failed(loaded):
            return err("无法运行：加载程序 %s 未确认（%s）。请检查程序名/路径，或确认该程序在当前 UR 实例的程序目录下。" % (name, loaded))
    play_ok, resp = _dashboard_cmd(ip, "ur_play")
    # 只回报"已下发"，并且**同时给出运行状态**：dashboard 说 play 了、但机器人可能因安全
    # 停止/未使能而根本没启动。把 running 一并返回，调用方（与模型）才有依据下判断。
    running = _program_running(ip)
    if not play_ok:
        return err("启动程序失败：%s" % resp, "TIMEOUT")
    if not _dashboard_ok(resp):
        return err("启动程序被控制器拒绝：%s" % resp)
    return ok({"message": "已下发启动程序 %s（控制器应答：%s；运行状态：%s）"
                          % (name or "(当前加载)", resp, "运行中" if running else "未在运行"),
               "data": {"program_name": name, "respond": resp, "running": running, "ip": ip}})


def op_stop_program(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    sent, resp = _dashboard_cmd(ip, "ur_stop")
    if not sent:
        return err("停止程序失败：%s" % resp, "TIMEOUT")
    if not _dashboard_ok(resp):
        return err("停止程序被控制器拒绝：%s" % resp)
    return ok({"message": "已停止程序（%s）" % resp,
               "data": {"respond": resp, "running": _program_running(ip), "ip": ip}})


def op_pause_program(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    sent, resp = _dashboard_cmd(ip, "ur_pause")
    if not sent:
        return err("暂停程序失败：%s" % resp, "TIMEOUT")
    if not _dashboard_ok(resp):
        return err("暂停程序被控制器拒绝：%s" % resp)
    return ok({"message": "已暂停程序（%s）" % resp,
               "data": {"respond": resp, "running": _program_running(ip), "ip": ip}})


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
    # 全部数字输出都走 URScript（与 tool/analog/payload/TCP 的既有做法一致），
    # 不走 RTDE *输入*：控制器会拒绝第二次 SETUP_INPUTS（"An input parameter is
    # already in use."），该异常在 RTDE 线程里会把整条连接拖死（详见
    # URBasic/rtde.py 中 run() 处的注释）。代价：UR 只在「远程控制」模式下接受
    # URScript，本地（示教器）模式下该命令会被控制器按设计静默丢弃。
    flag = "True" if value else "False"
    if which == "config":
        n = _bounded_int(p["n"], "n", 8, 15, "config 端口号")
        # URBasic 内部按 0-7 给 8 路 configurable 输出编号，而本工具沿用 UR 的
        # 全局 I/O 编号 8-15；不做换算时掩码会算出 2**8=256 而溢出 UINT8。
        script = "set_configurable_digital_out(%d, %s)\n" % (n - 8, flag)
    elif which == "tool":
        n = _bounded_int(p["n"], "n", 0, 1, "tool 端口号")
        # Tool digital outputs are not on RTDE; set_tool_digital_out sends the
        # URScript `write_tool_digital_out` command over the RealTime client.
        robot.set_tool_digital_out(n, value)
        return ok({"message": "已设置数字输出 %s.%d = %s" % (which, n, value),
                   "data": {"which": which, "port": n, "value": value, "ip": ip}})
    else:
        n = _bounded_int(p["n"], "n", 0, 7, "std 端口号")
        script = "set_standard_digital_out(%d, %s)\n" % (n, flag)
    if not _realtime_send(robot, script):
        return err("数字输出脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok({"message": "已设置数字输出 %s.%d = %s" % (which, n, value),
               "data": {"which": which, "port": n, "value": value, "ip": ip}})


def op_get_analog_in(p):
    ip = str(p["ip"])
    n = _bounded_int(p["n"], "n", 0, 1, "模拟输入端口号")
    robot, _ = ensure_connected(ip)
    val = robot.get_standard_analog_in(n)
    return ok({"message": "%s" % val, "data": {"port": n, "value": val, "ip": ip}})


# 模拟输出端口的"域"：电压域满量程 10 V，电流域满量程 20 mA。
# URScript 的 `set_analog_out(n, f)` 收的是**相对电平 f∈[0,1]**（f=1.0 对应 10V / 20mA，
# 取决于该端口的域设置）。而 RTDE 回读的 `standard_analog_outputN` 是工程值。
ANALOG_ASSUMED_FULL_SCALE = 10.0


def op_set_analog_out(p):
    """设置标准模拟输出。

    ⚠️ 上游语义陷阱：URScript 的 `set_analog_out(n, f)` 的参数 f 是**相对电平 [0,1]**，
    不是伏特/毫安。旧实现把调用方给的数字**原样**发过去，于是 `value=5` 被当成 f=5 ⇒
    端口输出满量程（约 10 V），而工具说明写的是"0-10 或 0-20"。同时它连范围都不校验。
    现在接受**工程单位**（默认伏特，`full_scale` 可指定 20 表示电流域），换算成 [0,1] 后发送，
    并把换算前后的值都回报出来，方便核对。
    """
    ip = str(p["ip"])
    n = _bounded_int(p["n"], "n", 0, 1, "模拟输出端口号")
    full_scale = _bounded_float(p.get("full_scale", 10.0), "full_scale", 0.001, 1000.0,
                                "模拟输出满量程（电压域 10，电流域 20）")
    value = float(p["value"])
    if not math.isfinite(value):
        raise WorkerError("BADARG", "模拟输出值必须是有穷数值，收到 %s" % value)
    if value < 0 or value > full_scale:
        raise WorkerError("BADARG", "模拟输出值必须在 [0, %s]（%s）范围内，收到 %s"
                          % (full_scale, "工程单位", value))
    fraction = value / full_scale
    robot, _ = ensure_connected(ip)
    # URBasic 的 set_standard_analog_out 是 NotImplementedError 桩，所以直接发 URScript。
    if not _realtime_send(robot, 'set_analog_out(%d, %.6f)\n' % (n, fraction)):
        return err("模拟输出脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    read_back = None
    try:
        read_back = float(ROBOT_MODELS[ip].StandardAnalogOutput(n))
    except Exception:
        pass
    return ok({"message": "已设置模拟输出 %d = %s（相对电平 %.4f；回读 %s）"
                          % (n, value, fraction, read_back if read_back is not None else "不可用"),
               "data": {"port": n, "value": value, "full_scale": full_scale,
                        "fraction": fraction, "read_back": read_back, "ip": ip}})


def op_set_tool_voltage(p):
    """设置工具法兰供电电压（0 / 12 / 24 V）。

    ⚠️ 上游 `UrScript.set_tool_voltage()` 是 `NotImplementedError` 桩（urScript.py），
    所以旧实现在**每一次调用**上都必然抛异常并回报 ok:false —— 这个工具从来没有成功过。
    这里按同样的模式直接发 URScript。
    """
    ip = str(p["ip"])
    voltage = int(p["voltage"])
    if voltage not in (0, 12, 24):
        raise WorkerError("BADARG", "工具电压只能是 0 / 12 / 24，收到 %s" % voltage)
    robot, _ = ensure_connected(ip)
    if not _realtime_send(robot, "set_tool_voltage(%d)\n" % voltage):
        return err("工具电压脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok({"message": "已设置工具电压为 %sV" % voltage,
               "data": {"voltage": voltage, "ip": ip}})


def op_set_tcp(p):
    ip = str(p["ip"])
    pose = _vec(p, "pose", 6, "set_tcp 的 pose")
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "set_tcp")
    if not _send_program(robot, "set_tcp(p[%.6f,%.6f,%.6f,%.6f,%.6f,%.6f])\n" % tuple(pose)):
        return err("set_tcp 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok({"message": "已设置 TCP：%s" % pose,
               "data": {"tcp": [float(x) for x in pose], "ip": ip}})


def op_set_payload(p):
    ip = str(p["ip"])
    mass = float(p["mass"])
    if not math.isfinite(mass) or mass < 0:
        raise WorkerError("BADARG", "负载质量必须是非负有穷数值，收到 %s" % mass)
    cog = _vec(p, "cog", 3, "set_payload 的 cog") if p.get("cog") is not None else [0.0, 0.0, 0.0]
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "set_payload")
    # URBasic 的 `set_payload(m, CoG)` 是 NotImplementedError 桩，发两条已实现的 URScript。
    cog_str = "p[%.4f,%.4f,%.4f]" % tuple(cog)
    script = "set_payload_mass(%.4f)\nset_payload_cog(%s)\n" % (mass, cog_str)
    if not _realtime_send(robot, script):
        return err("负载设置脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok({"message": "已设置负载：%skg，重心 %s" % (mass, cog),
               "data": {"mass": mass, "cog": [float(x) for x in cog], "ip": ip}})


def op_movep(p):
    ip = str(p["ip"])
    pose = _vec(p, "pose", 6, "movep 的 pose")
    a = _nonneg_float(p.get("a", 1.2), "a", "movep 的加速度", allow_zero=False)
    v = _nonneg_float(p.get("v", 0.25), "v", "movep 的速度", allow_zero=False)
    r = _nonneg_float(p.get("r", 0), "r", "movep 的交融半径")
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "movep")
    if not _send_program(robot, "movep(p[%.6f,%.6f,%.6f,%.6f,%.6f,%.6f], a=%s, v=%s, r=%s)"
                                % (pose[0], pose[1], pose[2], pose[3], pose[4], pose[5], a, v, r)):
        return err("movep 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    cmd = "movep(p%s, a=%s, v=%s, r=%s)" % (pose, a, v, r)
    ok_flag, msg = _movel_confirm(ip, pose, _budget_ms(p))
    return ok({"message": "命令 %s 已发送，%s" % (cmd, msg),
               "data": {"ok": ok_flag, "command": cmd, "ip": ip}})


def op_movec(p):
    """圆弧运动：从当前位置，经 `pose_via` 到 `pose_to`。

    ⚠️ **不能调用 URBasic 的 `UrScript.movec()`**：它内部把 `movetype` 写死成 `'p'`
    （urScript.py 里 `self._move(movetype='p', pose=pose_to, ..., pose_via=pose_via)`），
    而 `_move` 的 `if movetype == 'c'` 分支在 `'p'` 下永远不成立 —— 结果是
    **`pose_via` 被完全丢弃、实际发出去的是 `movep`（直线交融运动）**；即使把 movetype
    改成 `'c'`，那个分支拼出来的是未替换的模板字面量 `movec({prefix_via}{pose_via_x}, ...)`，
    同样是废的。所以这里与 `op_draw_circle` 一样**自己拼原始 URScript** 再发送。
    """
    ip = str(p["ip"])
    via = _vec(p, "pose_via", 6, "movec 的 pose_via")
    to = _vec(p, "pose_to", 6, "movec 的 pose_to")
    a = _nonneg_float(p.get("a", 1.2), "a", "movec 的加速度", allow_zero=False)
    v = _nonneg_float(p.get("v", 0.25), "v", "movec 的速度", allow_zero=False)
    r = _nonneg_float(p.get("r", 0), "r", "movec 的交融半径")
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "movec")
    cmd = "movec(p[%.4f,%.4f,%.4f,%.4f,%.4f,%.4f], p[%.4f,%.4f,%.4f,%.4f,%.4f,%.4f], a=%s, v=%s, r=%s)" % (
        via[0], via[1], via[2], via[3], via[4], via[5],
        to[0], to[1], to[2], to[3], to[4], to[5], a, v, r)
    if not _send_program(robot, cmd):
        return err("movec 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    ok_flag, msg = _movel_confirm(ip, to, _budget_ms(p))
    return ok({"message": "命令 %s 已发送，%s" % (cmd, msg),
               "data": {"ok": ok_flag, "command": cmd, "ip": ip}})


def op_servoj(p):
    ip = str(p["ip"])
    q = _vec(p, "q", 6, "servoj 的 q")
    t = _nonneg_float(p.get("t", 0.008), "t", "servoj 的控制时长")
    look = _bounded_float(p.get("lookahead_time", 0.1), "lookahead_time",
                         0.03, 0.2, "servoj 的前瞻时间")
    gain = int(_bounded_float(p.get("gain", 100), "gain", 100, 2000, "servoj 的比例增益"))
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "servoj")
    if not _send_program(robot, "servoj([%s], t=%s, lookahead_time=%s, gain=%s)"
                                % (",".join("%.6f" % x for x in q), t, look, gain)):
        return err("servoj 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
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


# ---------------------------------------------------------------------------
# 控制模式 / 电源 / 安全（新增能力）
# ---------------------------------------------------------------------------
#
# 这一组全部通过原始 URScript 或 dashboard 命令实现，理由与既有实现一致：
# URBasic 里对应的包装要么是 NotImplementedError 桩，要么会额外做"等程序结束"的阻塞式等待，
# 而 freedrive / teach 这类程序**本来就设计成永不结束**，用包装函数会把单线程 worker 卡死。

def _set_control_mode(p, mode):
    """freedrive / teach 的开与关。mode ∈ {freedrive, teach}。"""
    ip = str(p["ip"])
    enabled = bool(p.get("enabled", True))
    robot, _ = ensure_connected(ip)
    if mode == "freedrive":
        start_cmd, end_cmd = "freedrive_mode()", "end_freedrive_mode()"
    else:
        start_cmd, end_cmd = "teach_mode()", "end_teach_mode()"
    if enabled:
        # 用「永不退出」的程序让被控模式在控制器侧持续生效（这正是 URBasic 的做法：
        # `while(True): freedrive_mode(); sleep(600) end`）。send 后不需要等它结束 ——
        # 它不会结束。
        script = "def ur_%s_on():\n  while(True):\n    %s\n    sleep(600)\n  end\nend\n" % (mode, start_cmd)
    else:
        # 关闭：向 30003 发一段新脚本会**抢占**正在运行的那个永续程序，而
        # `end_*_mode()` 这一句随之被执行。
        script = "%s\n" % end_cmd
    if not _send_program(robot, script):
        return err("%s 脚本未能送达控制器：%s" % (mode, _last_send_failure(robot)), "SEND_FAILED")
    return ok({"message": "%s 模式已%s（%s）" % (mode, "开启" if enabled else "关闭",
                                                "可在控制器停止运行程序前手动拖动机械臂，"
                                                "或在面板上停止程序来退出" if enabled
                                                else "已恢复正常位置控制"),
               "data": {"mode": mode, "enabled": enabled, "command": script.strip(), "ip": ip}})


def op_set_freedrive(p):
    """开关"自由驱动"（freedrive）：开启后可手动拖动机械臂。"""
    return _set_control_mode(p, "freedrive")


def op_set_teach_mode(p):
    """开关"示教模式"（teach）。"""
    return _set_control_mode(p, "teach")


def _dashboard_switch(p, cmd, description):
    """执行一条 dashboard 开关类命令并要求应答不表示失败。"""
    ip = str(p["ip"])
    ensure_connected(ip)
    sent, resp = _dashboard_cmd(ip, cmd)
    if not sent:
        return err("%s 失败（控制器无应答）：%s" % (description, resp), "TIMEOUT")
    if not _dashboard_ok(resp):
        return err("%s 被控制器拒绝：%s" % (description, resp))
    return ok({"message": "%s 已下发（控制器应答：%s）" % (description, resp),
               "data": {"respond": resp, "ip": ip}})


def op_power_on(p):
    """机器人上电（使能电机）。"""
    return _dashboard_switch(p, "ur_power_on", "机器人上电")


def op_power_off(p):
    """机器人下电。⚠️ 会让机械臂失去刚性支撑。"""
    return _dashboard_switch(p, "ur_power_off", "机器人下电")


def op_brake_release(p):
    """释放刹车。⚠️ 释放后机械臂可能因重力下落。"""
    return _dashboard_switch(p, "ur_brake_release", "释放刹车")


def op_unlock_protective_stop(p):
    """解除保护性停止 / 关闭安全弹窗。

    与 `ur_reset_error` 的区别：后者走 `UrScriptExt.reset_error()`，会**顺带**做上电与
    释放刹车；只想把保护性停止解掉、不想让机械臂动起来时，用这个工具。
    """
    ip = str(p["ip"])
    ensure_connected(ip)
    unlocked, unlock_resp = _dashboard_cmd(ip, "ur_unlock_protective_stop")
    closed, close_resp = _dashboard_cmd(ip, "ur_close_safety_popup")
    if not (unlocked or closed):
        return err("解除保护性停止失败（控制器无应答）：%s / %s" % (unlock_resp, close_resp), "TIMEOUT")
    # 解除后**重新读一次安全状态**，让调用方看到结果而不是"已发送"。
    try:
        model = ROBOT_MODELS[ip]
        safety_raw = _read_status_word(model, "safety_status_bits")
        names = _status_bit_names(safety_raw, _SAFETY_STATUS_BITS)
    except Exception:
        safety_raw, names = None, None
    return ok({"message": "已解除保护性停止/关闭安全弹窗（unlock：%s；close popup：%s）；"
                          "当前安全状态位：%s"
                          % (unlock_resp, close_resp, names if names else "无置位"),
               "data": {"unlock_respond": unlock_resp, "close_popup_respond": close_resp,
                        "safety_status_bits": safety_raw, "safety_status_names": names, "ip": ip}})


def op_shutdown(p):
    """关闭控制器（电源）。⚠️ 需要人工重新上电。"""
    return _dashboard_switch(p, "ur_shutdown", "关闭控制器")


def op_get_runtime_telemetry(p):
    """一次读取所有"已在 RTDE 数据流里、但以前没有任何工具暴露"的实时量。

    这些字段**本来就在 500 Hz 的 RTDE 输出配方里**（见 URBasic/rtdeConfiguration.xml），
    读取它们不需要额外配置、也不需要 dashboard 往返，因此代价几乎为零：
    关节电流/电压/角速度、TCP 线速度/受力、速度倍率、动量、工具加速度计。
    """
    ip = str(p["ip"])
    _, model = ensure_connected(ip)

    def vec(getter):
        try:
            return [float(x) for x in getter()]
        except Exception:
            return None

    return ok({
        "message": "实时遥测读取成功（全部来自 RTDE 数据流，无需额外配置）",
        "data": {
            "ip": ip,
            "joint_currents": vec(model.ActualCurrent),
            "joint_voltages": vec(model.ActualJointVoltage),
            "joint_speeds": vec(model.ActualQD),
            "tcp_speed": vec(model.ActualTCPSpeed),
            "tcp_force": vec(model.ActualTCPForce),
            "tool_accelerometer": vec(model.ActualToolAccelerometer),
            "speed_scaling": float(model.SpeedScaling()),
            "momentum": float(model.ActualMomentum()),
            "robot_voltage": float(model.ActualRobotVoltage()),
            "robot_current": float(model.ActualRobotCurrent()),
            "joint_temperatures": vec(model.JointTemperatures),
        },
    })


def op_get_speed_scaling(p):
    """读取速度倍率（0-1）。"""
    ip = str(p["ip"])
    _, model = ensure_connected(ip)
    return ok({"message": "速度倍率：%s" % model.SpeedScaling(),
               "data": {"speed_scaling": float(model.SpeedScaling()), "ip": ip}})


def op_set_gravity(p):
    """设置重力方向向量的方向（单位向量），用于非水平安装。

    ⚠️ 只在机器人**非水平安装**或需要显式声明重力方向时才需要；设置错误会让控制器的
    重力补偿出错（表现为松手后下坠或上飘）。
    """
    ip = str(p["ip"])
    d = _vec(p, "direction", 3, "gravity 的 direction")
    norm = math.sqrt(sum(x * x for x in d))
    if norm < 1e-9:
        raise WorkerError("BADARG", "重力方向不能是零向量")
    unit = [x / norm for x in d]
    robot, _ = ensure_connected(ip)
    if not _send_program(robot, "set_gravity([%.6f,%.6f,%.6f])\n" % tuple(unit)):
        return err("set_gravity 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok({"message": "已设置重力方向为 [%.4f, %.4f, %.4f]（已归一化）" % tuple(unit),
               "data": {"direction": unit, "normalized_from": d, "ip": ip}})


def op_zero_ftsensor(p):
    """把力/力矩传感器的读数归零。⚠️ 归零瞬间机械臂应处于"无力"状态。"""
    ip = str(p["ip"])
    robot, _ = ensure_connected(ip)
    if not _send_program(robot, "zero_ftsensor()\n"):
        return err("zero_ftsensor 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok({"message": "已下发力/力矩传感器归零", "data": {"ip": ip}})


def op_get_tcp_force(p):
    """读取 TCP 受力/力矩 [Fx,Fy,Fz,Tx,Ty,Tz]（来自 RTDE）。"""
    ip = str(p["ip"])
    _, model = ensure_connected(ip)
    force = [float(x) for x in model.ActualTCPForce()]
    return ok({"message": "TCP 受力：%s" % force,
               "data": {"tcp_force": force, "ip": ip}})


def op_conveyor_tracking(p):
    """传送带跟踪（线性/圆形）的开启与关闭。

    action = "linear" / "circular" 需要给出编码器与传送带参数；action = "stop" 停止跟踪。
    ⚠️ 会改变机器人的运动学行为：开启后机器人会跟随传送带运动，请确认机械臂周围安全。
    """
    ip = str(p["ip"])
    action = str(p.get("action", "")).lower()
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "conveyor_tracking")
    if action == "stop":
        script = "stop_conveyor_tracking()\n"
    elif action in ("linear", "circular"):
        # 编码器：a = 通道 A 输入、b = 通道 B 输入、ticks_per_meter = 每米脉冲数。
        a = _bounded_int(p.get("encoder_a", 0), "encoder_a", 0, 7, "编码器 A 通道")
        b = _bounded_int(p.get("encoder_b", 1), "encoder_b", 0, 7, "编码器 B 通道")
        ticks = _nonneg_float(p.get("ticks_per_meter", 0), "ticks_per_meter",
                              "每米脉冲数", allow_zero=False)
        script = ("conveyor_pulse_decode({a}, {b}, 0)\nset_conveyor_tick_count(0, {t})\n"
                  .format(a=a, b=b, t=ticks))
        if action == "linear":
            script += ("track_conveyor_linear(p[0,0,0,0,0,0], %s)\n"
                       % _bounded_float(p.get("speed", 0.1), "speed", 0.0, 5.0, "跟踪速度"))
        else:
            script += ("track_conveyor_circular(p[0,0,0,0,0,0], %s, %s)\n"
                       % (_nonneg_float(p.get("radius", 0.1), "radius", "半径", allow_zero=False),
                          _bounded_float(p.get("speed", 0.1), "speed", 0.0, 5.0, "跟踪速度")))
    else:
        raise WorkerError("BADARG", 'action 必须是 "linear" / "circular" / "stop"，收到 %r' % action)
    if not _send_program(robot, script):
        return err("传送带跟踪脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok({"message": "传送带跟踪已下发：%s" % script.strip(),
               "data": {"action": action, "command": script.strip(), "ip": ip}})


def op_get_tool_analog_in(p):
    """读取工具端模拟输入（0/1）。

    ⚠️ **未经真机验证的实现**（与仓库里其它"直接发 URScript"的工具同一风险等级）：
    工具模拟输入不经 RTDE，只能靠 URScript 表达式读取，而表达式必须跑在程序里；这里按
    UR 脚本手册的 `get_tool_analog_in(n)` + `write_output_float_register(address, value)`
    组合把结果写进一个**专用**的输出寄存器再经 RTDE 回读。可选参数 `read_register`
    （默认 22）让调用方在固件不认识上述函数名时换一个寄存器；若 5 s 内读不回值，
    工具会**如实报失败**并说明原因，而不是返回一个陈旧值。

    代价：会覆盖该寄存器的旧值；且这次读取会打断当前正在运行的程序。
    """
    ip = str(p["ip"])
    n = _bounded_int(p["n"], "n", 0, 1, "工具模拟输入端口号")
    # 默认 22：避开 send_script 的默认哨兵 23，也避开厂内程序常用的 0-3。
    register = _bounded_int(p.get("read_register", 22), "read_register", 0, 23, "回读用寄存器")
    robot, model = ensure_connected(ip)
    _assert_remote_control(ip, "get_tool_analog_in")
    before = None
    try:
        before = float(model.OutputDoubleRegister(register))
    except Exception:
        pass
    script = ("def ur_read_tool_analog():\n"
              "    write_output_float_register(%d, get_tool_analog_in(%d))\n"
              "end\n" % (register, n))
    if not _send_program(robot, script):
        return err("读取工具模拟输入失败：%s" % _last_send_failure(robot), "SEND_FAILED")
    deadline = time.time() + 5.0
    while time.time() < deadline:
        try:
            value = model.OutputDoubleRegister(register)
        except Exception:
            value = None
        # 必须等到**值发生变化**（或原本就是 None）才算读到本次结果：寄存器里可能残留着
        # 上一次的值，拿它当本次读数就是上文反复出现的"陈旧应答"问题。
        if value is not None and (before is None or float(value) != before):
            return ok({"message": "工具模拟输入 %d = %s（回读寄存器 %d）" % (n, value, register),
                       "data": {"port": n, "value": float(value), "register": register,
                                "previous": before, "ip": ip}})
        time.sleep(0.1)
    return err("未能读回工具模拟输入 %d：5s 内寄存器 %d 没有更新（旧值 %s）。可能原因："
               "①该寄存器被控制器/程序占用；②当前固件不认识 get_tool_analog_in 或 "
               "write_output_float_register（可换 read_register 再试）；③机器人不在远程控制模式。"
               % (n, register, before), "TIMEOUT")


def op_shutdown_worker(p):
    """优雅退出：先关掉所有机器人连接，再结束进程。

    为什么需要它：RTDE 会话在控制器侧是**独占**的。进程被 kill 时窗口来不及走 FIN，
    控制器可能在一个超时窗口内仍认为旧会话存在，于是紧接着的重连会失败（本文件多处注释
    都提到过这个现象）。让 worker 自己把连接关干净再退出，可以避免这类"重启后连不上"。

    ⚠️ **不能在这里直接 `os._exit(0)`**：本函数的返回值会由 `main()` 序列化成一行响应写进
    stdout，而 `os._exit` 不刷新任何缓冲、也不等管道被读走 —— 实测 Node 侧因此收不到应答，
    `shutdown()` 只能靠超时收场（`selftest.test.mjs` 就是这么发现它的）。
    改为交回返回值、由 `main()` 负责"先应答、再在下一轮读循环前退出"。
    """
    closed = []
    for ip in list(ROBOTS.keys()):
        robot = ROBOTS.pop(ip, None)
        ROBOT_MODELS.pop(ip, None)
        try:
            if robot is not None:
                robot.robotConnector.close()
            closed.append(ip)
        except Exception as exc:
            _log("关闭 %s 的连接时出错：%r" % (ip, exc))
    return ok({"message": "worker 正在退出", "data": {"closed": closed}})


def _exit_soon(code=0, delay_s=0.2):
    """应答写完之后再退出进程（见 op_shutdown_worker 的说明）。

    用 daemon 线程延迟一下退出：给 stdout 的管道缓冲一点时间被对端读走。
    `os._exit` 而不是 `sys.exit` —— 我们不想跑 atexit/线程清理（RTDE/Dashboard 的
    接收线程可能正卡在 recv 里，join 会把"退出"变成新的卡死点）。
    """
    def _boom():
        time.sleep(delay_s)
        try:
            _LOG.close()
        except Exception:
            pass
        os._exit(code)

    threading.Thread(target=_boom, name="ur-exit", daemon=True).start()


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
    "get_safety_status": op_get_safety_status,
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
    # 工具坐标系方向（worker 侧用旋转矩阵换算成基座系位移，不依赖 URScript 的 pose_trans）
    "move_tool_x": op_move_tool_x,
    "move_tool_y": op_move_tool_y,
    "move_tool_z": op_move_tool_z,
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
    # ── 新增能力（0.5.0）───────────────────────────────────────────────────
    # 控制模式 / 电源 / 安全
    "set_freedrive": op_set_freedrive,
    "set_teach_mode": op_set_teach_mode,
    "power_on": op_power_on,
    "power_off": op_power_off,
    "brake_release": op_brake_release,
    "unlock_protective_stop": op_unlock_protective_stop,
    "shutdown": op_shutdown,
    # 实时遥测（字段本来就在 RTDE 数据流里）
    "get_runtime_telemetry": op_get_runtime_telemetry,
    "get_speed_scaling": op_get_speed_scaling,
    "get_tcp_force": op_get_tcp_force,
    # 配置 / 工具端 I/O / 传送带跟踪
    "set_gravity": op_set_gravity,
    "zero_ftsensor": op_zero_ftsensor,
    "get_tool_analog_in": op_get_tool_analog_in,
    "conveyor_tracking": op_conveyor_tracking,
    # 优雅退出（host 侧 dispose 前调用；见 op_shutdown_worker 的说明）。
    # ⚠️ 名字不能是 "shutdown" —— 那是**关闭控制器**（上面 op_shutdown）。两者曾经撞名，
    # 表现是 `shutdown` 这个 op 被解析成"关闭控制器"，于是既报 KeyError: 'ip'，
    # 又永远不会真的退出 worker（worker.js 的优雅关闭因此只能靠超时收场）。
    "shutdown_worker": op_shutdown_worker,
}


def respond(payload):
    # Write UTF-8 bytes on the raw buffer so locale text encodings (e.g. GBK on
    # Chinese Windows) can never corrupt or reject the JSON. Node's readline
    # decodes the pipe as UTF-8, so Chinese values round-trip cleanly.
    #
    # `allow_nan=False`：Python 默认把 NaN/Infinity 写成 `NaN`/`Infinity`，那**不是合法
    # JSON** —— Node 的 JSON.parse 会抛，而 lib/worker.js 的 `_onLine` 对解析失败的行
    # 是静默丢弃的，调用方只会看到一句笼统的 "timed out"。宁可在这里大声失败
    # （由 main() 的 except 兜住并回报一个可读错误）。
    body = json.dumps(payload, ensure_ascii=False, default=_json_default, allow_nan=False)
    line = (body + "\n").encode("utf-8")
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

    # rtde.py resolves URBasic/rtdeConfiguration.xml first and only falls back to the
    # vendored ...Default.xml. The **preferred** file is the one that must be present:
    # without it no input recipe reaches the controller and every RTDE write dies with
    # AttributeError on `__rtde_input_config.names`. Checking the fallback alone is what
    # let this selfcheck pass while that outage was live.
    rtde_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "URBasic")
    results["rtde_config_exists"] = os.path.isfile(os.path.join(rtde_dir, "rtdeConfiguration.xml"))
    results["rtde_config_fallback_exists"] = os.path.isfile(
        os.path.join(rtde_dir, "rtdeConfigurationDefault.xml"))

    # URBasic is imported at module load — reaching here proves it is present.
    _PROTOCOL_OUT.write(json.dumps(results, ensure_ascii=False) + "\n")
    _PROTOCOL_OUT.flush()

    ok = (isinstance(results["numpy"], str) and results["numpy"][0].isdigit()
          and isinstance(results["paramiko"], str) and results["paramiko"][0].isdigit()
          and results["rtde_config_exists"] and results["urbasic"])
    return 0 if ok else 1


def main():
    global _CURRENT_REQUEST_ID, _CURRENT_TIMEOUT_MS
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            # 供 _connect_or_exit() 在自杀前回报「哪一条请求、什么原因」。
            _CURRENT_REQUEST_ID = req_id
            _CURRENT_TIMEOUT_MS = req.get("_timeout_ms")
            op_name = req.get("op")
            params = {k: v for k, v in req.items() if k not in ("id", "op")}
            handler = HANDLERS.get(op_name)
            if handler is None:
                raise WorkerError("BADARG", "未知操作：%s" % op_name)
            data = handler(params)
            if isinstance(data, dict) and "error" in data:
                respond({"id": req_id, "ok": False, "data": data.get("data"),
                         "error": data["error"], "code": data.get("code", "HUGE")})
            else:
                respond({"id": req_id, "ok": True, "data": data})
            # 优雅退出：应答已经写出去，再让进程稍后消失（见 _exit_soon 的说明）。
            if op_name == "shutdown_worker":
                _exit_soon(0)
        except WorkerError as exc:
            # 业务异常：已有稳定错误码，直接回报（完整栈写日志，协议行保持简短）。
            _log("WorkerError %s: %s\n%s" % (exc.code, exc, traceback.format_exc()))
            respond({"id": req_id, "ok": False, "data": exc.data,
                     "error": str(exc), "code": exc.code})
        except Exception as exc:
            # 未预料的异常：**完整栈进日志**（旧实现只取 limit=1，库里抛出的
            # AttributeError 会丢掉所有上下文，实际排障时等于没有信息），协议行只回
            # 一句可读的摘要 + 稳定错误码。
            _log("未处理异常（op=%s）：\n%s" % (req.get("op") if isinstance(req, dict) else "?",
                                            traceback.format_exc()))
            respond({"id": req_id, "ok": False, "data": None,
                     "error": "%s: %s" % (type(exc).__name__, exc),
                     "code": _error_code_for(exc)})


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selfcheck":
        sys.exit(selfcheck())
    main()

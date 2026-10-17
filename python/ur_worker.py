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
    # KeyError / OverflowError 都是"参数写错了"：handler 里大量 `p["x"]` 直取（漏字段）
    # 和 `int(inf)`（超范围）都会走到这里。以前它们落到 HUGE（"未实现的内部错误"），
    # 把"调用方少传了一个字段"伪装成"插件内部炸了"，与 ERROR_CODES 里 BADARG 的自述不符。
    if isinstance(exc, (ValueError, KeyError, OverflowError)):
        return "BADARG"
    if isinstance(exc, TimeoutError):
        return "TIMEOUT"
    if isinstance(exc, ConnectionError):
        return "NOT_CONNECTED"
    if isinstance(exc, NotImplementedError):
        return "UNSUPPORTED"
    return "HUGE"


# 状态型命令的统一措辞。
#
# 本插件**无法证实**这类命令真的生效：`_send_program()` / `RealTimeClient.Send()` 能证明的
# 只是"字节写进了 socket"，而 UR 仅在**远程控制模式**下接受 URScript —— 本地/示教器模式下
# 控制器会**静默丢弃**且不报错。凡是没有回读通道可供核实的设置类命令，一律改用
# `ok_unverified()`：措辞降级为「未校验」，并在 data 里带 `verified: False`。
UNVERIFIED_NOTE = ("（未校验：脚本只写进了控制器 —— UR 仅在远程控制模式下接受 URScript，"
                   "本地/示教器模式下会被静默丢弃；请自行核实是否真的生效）")


def ok_unverified(result):
    """`ok()` 的诚实版：把一条状态型命令的"成功"降级为"已下发（未校验）"。

    参数与 `ok()` 完全一样（一个带 message/data 的字典），所以调用点只需改函数名。
    """
    out = dict(result)
    data = dict(out.get("data") or {})
    data["verified"] = False
    out["data"] = data
    out["message"] = "%s%s" % (out.get("message", ""), UNVERIFIED_NOTE)
    return ok(out)


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

# 协议行（响应 + 主动推送）的写入锁。
#
# 孪生遥测现在由后台线程**主动推送**（见 `_twin_push_loop`），它会与主线程的
# `respond()` 并发写同一个 stdout。少了这把锁，两条 JSON 行会交错甚至互相截断，
# Node 侧 readline 于是拿到无法解析的行 —— 表现为孪生随机丢帧、请求莫名超时。
_PROTOCOL_LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# 孪生遥测的**独立通道**：stderr + 魔数前缀 + 自己的锁
#
# 为什么推送不能继续与响应共用 stdout + `_PROTOCOL_LOCK`（真机上会冻结孪生）：
#   - 主线程写一条**大响应**时占着 `_PROTOCOL_LOCK`；若此时 stdout 管道因宿主一时没抽干而背压，
#     这条写会**阻塞**，推送线程就被同一把锁挡在门外；
#   - 超过宿主 `TWIN_PUSH_FRESH_MS`（300 ms）没收到推送，`lib/twin-routes.js` 就**回退**去发一次
#     显式读 —— 运动期间那次读排在运动指令后面，于是孪生只剩"数据已停止更新"。
# 独立通道后：推送既不被响应的锁串行化，也不被 stdout 的背压堵住。宿主两路都收
# （`lib/worker.js` 同时接受 stdout 的推送行与本通道的前缀行，见 `lib/push-channel.js`）。
_PUSH_LOCK = threading.Lock()
PUSH_CHANNEL_PREFIX = "@@DSH-UR-PUSH@@ "
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
        # ⚠️ 限幅必须按**字节**算。文件以 utf-8 打开，一个中文字符占 3 字节，而 `len(str)`
        # 数的是**字符** ⇒ 中文日志能把声明上限撑到约 3 倍（8 MB 的现役档写到约 24 MB，
        # 加上滚动档接近 50 MB）。`max_bytes` 与 `_current_size()` 一直是字节语义，这里对齐；
        # 测试用 ASCII（`"A"*699`）永远看不出这个差，所以另有一条 CJK 用例守着。
        nbytes = len(text.encode("utf-8"))
        with self._lock:
            if self._written + nbytes > self._max:
                self._roll()
            self._handle.write(text)
            self._written += nbytes
            # 返回值仍是"写入的字符数"（file-like 的 write 语义），不要改成字节数：
            # URBasic 与 print 都按字符数用它。
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


def _enum_token(respond):
    """把一条 dashboard 查询的**整行应答**剥成裸枚举词。

    UR 控制器对这些查询回的是带标签前缀的整行文本（`safetymode` → `"Safetymode: NORMAL"`、
    `robotmode` → `"Robotmode: RUNNING"`，见 `URBasic/dashboard.py` 各方法的文档字符串）。
    客户端按裸枚举词查中文表、并按"未知模式算异常"判定安全问题 ⇒ 带前缀的值既翻不出中文，
    又会把 `NORMAL` 误报成需要处置的安全异常（孪生面板底部会恒挂处置提示）。所以在**协议
    边界**统一剥掉 `标签:` 前缀，只把枚举词交给上层。

    返回值里没有冒号时（如 `programState` 回的 `"PLAYING"`）原样返回；查询失败哨兵
    `"<查询失败>"` 同样原样透传。
    """
    text = str(respond if respond is not None else "").strip()
    if ":" in text:
        return text.rsplit(":", 1)[-1].strip()
    return text


_PROGRAM_STATE_NAME = re.compile(r"^(?P<state>\S+)\s+<[^>]*>$")


def _program_state(respond):
    """把 `programState` 的应答剥成**裸程序状态词**。

    与 `safetymode` / `robotmode` 只带 `标签:` **前缀**不同，`programState` 回的是
    「状态词 + 程序名」：实测 PolyScope 5.21 / UR30 空闲时回 `STOPPED <未命名>`，
    运行中回 `PLAYING <程序名>`。`_enum_token` 只剥前缀，这串会原样到达客户端，
    而客户端按裸枚举词查中文表（`describeProgramState`），查不到就把
    `STOPPED <未命名>` 原样显示成「程序 STOPPED <未命名>」而不是「程序 已停止」。
    这里在协议边界把尾部的 `<程序名>` 去掉。

    **不能误伤查询失败哨兵 `"<查询失败>"`**：它前面没有状态词，而本正则要求
    `状态词 + 空白` 在前，故哨兵与任何裸值都原样透传。
    """
    text = _enum_token(respond)
    match = _PROGRAM_STATE_NAME.match(text)
    if match:
        return match.group("state")
    return text


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
        "safety_mode": _enum_token(dash("ur_safetymode")),
        "robot_mode": _enum_token(dash("ur_robotmode")),
        "program_state": _program_state(dash("ur_programState")),
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
    # 链路诊断：RTDE 因畸形长度而"丢一个字节重新对齐"过的字节数（0 = 一路干净）。
    # 这个计数以前只写进 worker 的 stdout，模型与用户都看不到 —— "链路在悄悄错位"因此
    # 没有任何可见入口。放在状态里，排障时一眼能看到是不是在丢包。
    _rtde_obj = getattr(getattr(robot, "robotConnector", None), "RTDE", None)
    _resync = getattr(_rtde_obj, "_RTDE__recv_resync_bytes", None)
    if _resync is not None:
        data["rtde_resync_bytes"] = _resync
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
    mode = _enum_token(m)
    return ok({"message": "安全模式：%s" % mode,
               "data": {"safety_mode": mode, "ip": ip}})


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
    value = _rtde_field(model, field)
    try:
        return None if value is None else int(value)
    except Exception:
        return None


def _rtde_field(model, name):
    """读一个 RTDE 接收字段的**原始**值（字段缺失 / 尚未更新时返回 None）。

    为什么不走 URBasic 的访问器：工具遥测与工具模拟输入那一批
    （`ToolOutputCurrent` / `ToolOutputVoltage` / `IoCurrent` / `ToolAnalogInput0/1`）
    在 vendored `robotModel.py` 里全是 `NotImplementedError` **桩** —— 桩只会抛异常，
    调用方于是拿到 None（表现为"全 null"，看起来像控制器没数据，其实是代码里根本没有读）。
    这里直接读 `dataDir`，并且**原样返回**（不做单位换算）。
    """
    try:
        getattr(model, "dataDir")
    except Exception:
        return None
    try:
        return model.dataDir[name]
    except Exception:
        return None


def _wait_robot_power(ip, want_on, timeout=8.0):
    """等 RTDE `robot_status_bits` 的 PowerOn 位到达期望状态。

    Returns: (reached, last_bits)。model 不存在（未连接）时返回 (None, None)。

    为什么用它判断下电：`power off` 生效的瞬间控制器就停止应答 dashboard（它正在断电），
    所以"命令有没有生效"不能问 dashboard，只能看控制器自己的状态位。
    """
    model = ROBOT_MODELS.get(ip)
    if model is None:
        return None, None
    deadline = time.time() + timeout
    bits = None
    while time.time() < deadline:
        bits = _read_status_word(model, "robot_status_bits")
        if bits is not None and bool(bits & 1) == bool(want_on):
            return True, bits
        time.sleep(0.2)
    return False, bits


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
    mode = _enum_token(dash("ur_safetymode"))

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
            "robot_mode": _enum_token(dash("ur_robotmode")),
            "runtime_state": _program_state(dash("ur_programState")),
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
    mode = _enum_token(m)
    return ok({"message": "运行状态：%s" % mode,
               "data": {"robot_mode": mode, "ip": ip}})


def op_get_program_state(p):
    ip = str(p["ip"])
    ensure_connected(ip)
    prog_ok, prog = _dashboard_cmd(ip, "ur_get_loaded_program")
    state_ok, state = _dashboard_cmd(ip, "ur_programState")
    saved_ok, saved_raw = _dashboard_cmd(ip, "ur_isProgramSaved")
    state = _program_state(state)
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
    # 走统一的读取路径：访问器缺失时回落原始 RTDE 字段，而不是抛异常或返回 None。
    val = _read_double_register(model, idx)
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
    # 内置默认口令是"静默地用一个公开凭据去连真机"。不改默认值（会破坏既有调用），但必须
    # **如实回报**用了它，并由调用方决定是否接受。
    used_default_password = p.get("password") in (None, "")
    programs_dir = _sanitize_path(p.get("programs_dir"), "programs_dir")
    # 主机密钥严格校验的入口。**默认仍是 auto-add**：机器人主机密钥通常未知，一上来就
    # RejectPolicy 会让最常见的场景直接失败；传了 known_hosts 才走严格校验。文件不存在时
    # 直接报错 —— 绝不静默退回 auto-add（那会把"我要严格校验"变成一句空话）。
    known_hosts = p.get("known_hosts")
    if known_hosts is not None:
        known_hosts = str(known_hosts)
        if not os.path.isfile(known_hosts):
            return err("known_hosts 指向的文件不存在：%s" % known_hosts, "BADARG")

    ssh = paramiko.SSHClient()
    if known_hosts:
        ssh.load_host_keys(known_hosts)
        ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
        host_key_policy = "known-hosts:%s（严格校验主机指纹）" % known_hosts
    else:
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        host_key_policy = "auto-add（接受任意主机密钥，无中间人防护）"
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
    return ok({"message": "程序列表（%s）共 %s 个：%s%s" % (
        dirs_note, len(programs), [x["name"] for x in programs],
        "。⚠️ 未提供 password，本次用的是**内置默认口令**（等同公开凭据）；并且本工具用 "
        "AutoAddPolicy 接受任意主机密钥 —— 这条 SSH 连接没有中间人防护。生产环境请显式传 "
        "password，并把机器人指纹写进 known_hosts 文件后用 known_hosts 参数传入。"
        if used_default_password else ""),
        "data": {"programs": programs, "count": len(programs), "ip": ip,
                 "used_default_password": used_default_password,
                 # 主机密钥策略如实回报：`auto-add` 意味着没有 MITM 防护，`known-hosts` 才是严格校验。
                 "host_key_policy": host_key_policy}})


# ---------------------------------------------------------------------------
# 程序文件传输（SFTP）：上传 / 下载 / 删除
#
# ⚠️ **本地路径的安全边界不在这一层**：`worker` 拿不到 `programDir` 配置，而"把本机任意文件
# 传到机器人上 / 把机器人文件写到本机任意路径"正是要防的事。所以本地路径由**宿主侧**的
# `lib/program-files.js` 牢笼把关（realpath 后必须在 programDir 内），这里只做基本健全性检查
# 与"做完了没"的核对。远端路径同理只做形状检查（绝对、无 ..、.urp）。
#
# ⚠️ 三个 op 里都**显式**读 username/password/known_hosts，没有抽成公共 helper：
# `scripts/check-tool-params.py` 逐 op 对账"声明的参数"与"handler 真的读了哪些参数"，
# 藏在 helper 里的读法它看不见，会直接判契约不一致。
# ---------------------------------------------------------------------------


def _ssh_client(ip, username, password, known_hosts):
    """建一条 SSH 连接，供程序文件传输用。返回 `(ssh, host_key_policy)`。

    与 `op_list_programs` 用**同一套**主机密钥策略（传了 `known_hosts` 就 `RejectPolicy` 严格
    校验，否则 `auto-add` 并如实回报）；那边保持原样不动，以免碰到已经验证过的行为。
    """
    import paramiko
    ssh = paramiko.SSHClient()
    if known_hosts:
        ssh.load_host_keys(known_hosts)
        ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
        policy = "known-hosts:%s（严格校验主机指纹）" % known_hosts
    else:
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        policy = "auto-add（接受任意主机密钥，无中间人防护）"
    ssh.connect(hostname=ip, port=22, username=username, password=password, timeout=8)
    return ssh, policy


# 与 `lib/program-files.js` 的 `DEFAULT_MAX_PROGRAM_BYTES` 保持一致。worker 看不到宿主配置，
# 因此默认用同一个常量给"下载前"的远端文件大小把关；宿主也可以注入 `_max_program_bytes`
# 覆盖（见 FIX_PLAN_074 C5）。
PROGRAM_FILE_MAX_BYTES = 1024 * 1024

# 远端程序路径的**形状**规则（C5/C6）：机器人是 POSIX 路径，必须是 `/` 开头的绝对路径、
# 不含 `..` 段、以 `.urp` 结尾。以前这条只在 JS 侧对 upload/download 做过（delete 完全没有），
# 而 worker 是独立可直连的协议端点 —— 它必须能自己拒绝 `/etc/passwd` 这类路径。
def _remote_program_path_problem(value):
    """校验机器人上的程序路径；合法返回 None，否则返回一句可读原因。"""
    text = str(value if value is not None else "").strip()
    if not text:
        return "远端路径不能为空"
    if not text.startswith("/"):
        return "远端路径必须是机器人上的绝对路径（以 / 开头），实得 %r" % (text,)
    if ".." in text.split("/"):
        return "远端路径不得包含 .. 段，实得 %r" % (text,)
    if not text.lower().endswith(".urp"):
        return "远端路径必须以 .urp 结尾，实得 %r" % (text,)
    return None


def op_upload_program(p):
    """把本地的 `.urp` 上传到机器人，并**回读远端大小核对**后才报成功。

    C5：路径优先取宿主注入的 `_local_path`/`_remote_path`（模型传的同名参数已被宿主
    `sanitizeArgs` 丢掉，注入发生在过滤之后）；有 `_local_path` 时它必须是绝对路径。
    没有注入时回退到旧行为，但**在返回里如实标明**这是模型给的路径。
    """
    ip = str(p["ip"])
    injected_local = p.get("_local_path")
    if injected_local is not None:
        local = str(injected_local)
        if not os.path.isabs(local):
            return err("不执行上传：_local_path 必须是宿主注入的**绝对路径**，实得 %r" % (local,),
                       "BADARG", {"ip": ip, "local_path": local, "_local_path": local})
        local_source, path_warning = "host", None
    else:
        local = str(p["local_path"])
        local_source = "model"
        path_warning = ("未收到宿主注入的 _local_path：本次改用模型参数 local_path（旧行为，"
                        "宿主侧 programDir 牢笼未被验证）")
    injected_remote = p.get("_remote_path")
    if injected_remote is not None:
        remote = str(injected_remote)
        remote_source = "host"
    else:
        remote = str(p["remote_path"])
        remote_source = "model"
    problem = _remote_program_path_problem(remote)
    if problem is not None:
        return err("不执行上传：%s" % problem, "BADARG",
                   {"ip": ip, "local_path": local, "remote_path": remote})
    username = p.get("username", "root")
    password = p.get("password", "easybot")
    known_hosts = p.get("known_hosts")
    if known_hosts is not None:
        known_hosts = str(known_hosts)
        if not os.path.isfile(known_hosts):
            return err("known_hosts 指向的文件不存在：%s" % known_hosts, "BADARG")
    if not os.path.isfile(local):
        return err("本地文件不存在：%s" % local, "BADARG")
    local_size = os.path.getsize(local)

    try:
        ssh, policy = _ssh_client(ip, username, password, known_hosts)
    except Exception as e:
        return err("SSH 连接 %s:22 失败（%s）。请确认机器人已启动 SSH 服务，或检查 username/password。"
                   % (ip, e))
    try:
        sftp = ssh.open_sftp()
        try:
            sftp.put(local, remote)
            observed = int(sftp.stat(remote).st_size)
        finally:
            sftp.close()
    except Exception as e:
        return err("上传 %s → %s 失败：%s" % (local, remote, e), "SEND_FAILED")
    finally:
        ssh.close()

    if observed != local_size:
        return err("上传后远端大小 %d 字节与本地 %d 字节**不一致** ⇒ 传输不完整，"
                   "不要在机器人上运行这个文件。" % (observed, local_size),
                   "VERIFY_FAILED",
                   {"ip": ip, "local_path": local, "remote_path": remote,
                    "local_bytes": local_size, "remote_bytes": observed,
                    "path_source": {"local": local_source, "remote": remote_source}})
    note = ("；%s" % path_warning) if path_warning else ""
    return ok({"message": "程序已上传到 %s（%d 字节，远端回读一致）%s" % (remote, observed, note),
               "data": {"ip": ip, "local_path": local, "remote_path": remote,
                        "bytes": observed, "verified": True, "host_key_policy": policy,
                        "path_source": {"local": local_source, "remote": remote_source},
                        "path_warning": path_warning}})


def op_download_program(p):
    """把机器人上的 `.urp` 下载到本地，并**回读本地大小核对**。

    C5：路径优先取宿主注入的 `_remote_path` / `_local_path`；有 `_local_path` 时必须是绝对路径。
    下载前先 `sftp.stat` 取远端大小，超过上限（`PROGRAM_FILE_MAX_BYTES`，可被宿主注入的
    `_max_program_bytes` 覆盖）就**在动本地文件之前**拒绝 —— 拒绝路径绝不能留下"原文件被改名成
    `.bak`"的副作用。

    目标文件已存在时**先备份成 `<path>.bak` 再写**，绝不静默覆盖（覆盖掉的是一个可能还有用的
    程序文件）。备份失败就拒绝下载。
    """
    ip = str(p["ip"])
    injected_local = p.get("_local_path")
    if injected_local is not None:
        local = str(injected_local)
        if not os.path.isabs(local):
            return err("不执行下载：_local_path 必须是宿主注入的**绝对路径**，实得 %r" % (local,),
                       "BADARG", {"ip": ip, "local_path": local})
        local_source, path_warning = "host", None
    else:
        local = str(p["local_path"])
        local_source = "model"
        path_warning = ("未收到宿主注入的 _local_path：本次改用模型参数 local_path（旧行为，"
                        "宿主侧 programDir 牢笼未被验证）")
    injected_remote = p.get("_remote_path")
    if injected_remote is not None:
        remote = str(injected_remote)
        remote_source = "host"
    else:
        remote = str(p["remote_path"])
        remote_source = "model"
    problem = _remote_program_path_problem(remote)
    if problem is not None:
        return err("不执行下载：%s" % problem, "BADARG", {"ip": ip, "remote_path": remote})
    max_bytes = p.get("_max_program_bytes")
    try:
        max_bytes = int(max_bytes) if max_bytes is not None else PROGRAM_FILE_MAX_BYTES
    except (TypeError, ValueError):
        max_bytes = PROGRAM_FILE_MAX_BYTES
    if max_bytes <= 0:
        max_bytes = PROGRAM_FILE_MAX_BYTES
    username = p.get("username", "root")
    password = p.get("password", "easybot")
    known_hosts = p.get("known_hosts")
    if known_hosts is not None:
        known_hosts = str(known_hosts)
        if not os.path.isfile(known_hosts):
            return err("known_hosts 指向的文件不存在：%s" % known_hosts, "BADARG")

    try:
        ssh, policy = _ssh_client(ip, username, password, known_hosts)
    except Exception as e:
        return err("SSH 连接 %s:22 失败（%s）。请确认机器人已启动 SSH 服务，或检查 username/password。"
                   % (ip, e))
    backed_up = False
    try:
        sftp = ssh.open_sftp()
        try:
            # ★ 先按大小上限把关，再动本地文件：拒绝路径不能把用户的原文件留在 .bak 上。
            remote_size = int(sftp.stat(remote).st_size)
            if remote_size > max_bytes:
                return err("远端文件 %s 有 %d 字节，超过下载大小上限 %d 字节 ⇒ 拒绝下载，"
                           "本地文件未改动。" % (remote, remote_size, max_bytes), "BADARG",
                           {"ip": ip, "remote_path": remote, "remote_bytes": remote_size,
                            "max_bytes": max_bytes,
                            "path_source": {"remote": remote_source}})
            if os.path.exists(local):
                try:
                    os.replace(local, local + ".bak")
                    backed_up = True
                except Exception as e:
                    return err("目标文件已存在且无法备份为 %s.bak（%s）⇒ 拒绝下载以免覆盖丢数据。"
                               % (local, e), "BADARG")
            sftp.get(remote, local)
        finally:
            sftp.close()
    except Exception as e:
        return err("下载 %s → %s 失败：%s" % (remote, local, e), "SEND_FAILED")
    finally:
        ssh.close()

    local_size = os.path.getsize(local) if os.path.exists(local) else -1
    if local_size != remote_size:
        return err("下载后本地大小 %d 字节与远端 %d 字节**不一致** ⇒ 传输不完整。"
                   % (local_size, remote_size), "VERIFY_FAILED",
                   {"ip": ip, "local_path": local, "remote_path": remote,
                    "local_bytes": local_size, "remote_bytes": remote_size})
    note = ("；%s" % path_warning) if path_warning else ""
    return ok({"message": "程序已下载到 %s（%d 字节，本地回读一致）%s%s"
               % (local, local_size,
                  "；原有同名文件已备份为 .bak" if backed_up else "", note),
               "data": {"ip": ip, "local_path": local, "remote_path": remote,
                        "bytes": local_size, "verified": True, "backed_up": backed_up,
                        "max_bytes": max_bytes, "host_key_policy": policy,
                        "path_source": {"local": local_source, "remote": remote_source},
                        "path_warning": path_warning}})


def op_delete_program(p):
    """删除机器人上的一个 `.urp`：**先确认存在、删除后再确认真的没了**。

    C6：远端路径必须绝对、不含 `..`、`.urp` 结尾。这条以前只在 JS 侧（且只对 upload/download）
    存在，delete 完全没校验 —— 一个 `remote_path=/etc/passwd` 会先 stat 成功、再被 root SSH 删掉。
    这里在 worker 侧独立拒绝；宿主注入 `_remote_path` 时优先用它。
    """
    ip = str(p["ip"])
    injected_remote = p.get("_remote_path")
    if injected_remote is not None:
        remote = str(injected_remote)
        remote_source = "host"
    else:
        remote = str(p["remote_path"])
        remote_source = "model"
    problem = _remote_program_path_problem(remote)
    if problem is not None:
        return err("不执行删除：%s" % problem, "BADARG",
                   {"ip": ip, "remote_path": remote})
    username = p.get("username", "root")
    password = p.get("password", "easybot")
    known_hosts = p.get("known_hosts")
    if known_hosts is not None:
        known_hosts = str(known_hosts)
        if not os.path.isfile(known_hosts):
            return err("known_hosts 指向的文件不存在：%s" % known_hosts, "BADARG")

    try:
        ssh, policy = _ssh_client(ip, username, password, known_hosts)
    except Exception as e:
        return err("SSH 连接 %s:22 失败（%s）。请确认机器人已启动 SSH 服务，或检查 username/password。"
                   % (ip, e))
    try:
        sftp = ssh.open_sftp()
        try:
            try:
                sftp.stat(remote)
            except IOError:
                return err("远端文件不存在，未做任何删除：%s" % remote, "BADARG")
            sftp.remove(remote)
            try:
                sftp.stat(remote)
                still_there = True
            except IOError:
                still_there = False
        finally:
            sftp.close()
    except Exception as e:
        return err("删除 %s 失败：%s" % (remote, e), "SEND_FAILED")
    finally:
        ssh.close()

    if still_there:
        return err("删除后仍能 stat 到 %s ⇒ 没有真正删除，不要以为它没了。" % remote,
                   "VERIFY_FAILED", {"ip": ip, "remote_path": remote})
    return ok({"message": "已删除机器人上的 %s（删除后 stat 已确认不存在）。" % remote,
               "data": {"ip": ip, "remote_path": remote, "verified": True,
                        "host_key_policy": policy,
                        "path_source": {"remote": remote_source}}})


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
# 传送带读回用的是 **double** 寄存器（载荷）配一个 **int** 寄存器（哨兵）。刻意分成两个
# 寄存器家族：这样"double 那条写路径坏了"不会把哨兵一起带走 —— 否则三种结局会退化成
# "什么都没发生"，正好把最需要看见的原因藏起来（历史事故就是这条路径静默失效）。
# 20 号避开 send_script 默认的 23 与 freedrive 用的 21。
CONVEYOR_SENTINEL_REGISTER = 20
CONVEYOR_PAYLOAD_REGISTER = 0
# 脚本类运动（draw_* 等）"到底有没有被执行"的探测窗：足够短到能立刻给出结论。
SCRIPT_START_CHECK_TIMEOUT_S = 1.5
# `ur_check_pose` 的寄存器布局。刻意避开既有占用：int 23=send_script 默认哨兵、20=传送带哨兵、
# 21=freedrive 状态、22=工具模拟输入回读；double 0=传送带载荷、22=工具模拟输入回读。
CHECK_POSE_LIMITS_REGISTER = 19
CHECK_POSE_IK_REGISTERS = (12, 13, 14, 15, 16, 17)
# 阶段标记寄存器：记录"限值那一步做完了吗 / IK 那一步做完了吗"。
# 为什么必须有它：脚本半途中止时，光看"结束哨兵不在"无法区分**死在哪一步** ——
# 而整数寄存器在没被写过时读到的是 0（不是 None），据此推断会把"第一步就报错"
# 误判成"死在后一步"（真机踩过：布尔值写整数寄存器 ⇒ 脚本在第一句就中止，
# 却被归因到 get_inverse_kin，于是完全可达的位姿被报成"不可达"）。
CHECK_POSE_STAGE_REGISTER = 18
CHECK_POSE_TIMEOUT_S = 2.0
# `set_speed_slider` 之后回读 `target_speed_fraction` 的窗口与容差。
SPEED_READBACK_TIMEOUT_S = 2.0
SPEED_READBACK_TOLERANCE = 0.01


def _read_int_register(model, index):
    """回读 int 输出寄存器；读不到返回 None。

    先用 URBasic 的访问器，访问器缺失（或它自己抛异常）时回落到原始 RTDE 字段 —— 两条路
    都读不到才算"读不到"，避免把一个可用的字段因为访问器不存在而误判为不可用。
    """
    value = None
    if model is not None:
        try:
            value = model.OutputIntRegister(index)
        except Exception:
            value = None
    if value is None:
        value = _rtde_field(model, "output_int_register_%d" % index)
    try:
        return None if value is None else int(value)
    except Exception:
        return None


def _read_double_register(model, index):
    """回读 double 输出寄存器；读不到返回 None（与 `_read_int_register` 同构）。

    为什么要有这个 helper：传送带 tick 走的是 **double** 寄存器（RTDE 字段
    `output_double_register_<n>`），而此前只有 int 那一侧有"访问器失败就回落原始 RTDE 字段"
    的统一读法。缺了它，调用方各自内联 `model.OutputDoubleRegister(n)`，一旦访问器缺失
    就直接炸或静默返回 None —— 两种都不该发生。
    """
    value = None
    if model is not None:
        try:
            value = model.OutputDoubleRegister(index)
        except Exception:
            value = None
    if value is None:
        value = _rtde_field(model, "output_double_register_%d" % index)
    try:
        return None if value is None else float(value)
    except Exception:
        return None


def _sentinel_token(previous, *avoid):
    """造一个与 `previous` **以及 `avoid` 里任何一个**都不同的哨兵 token。

    为什么必须能一次排除一整组：token 的基值是 `0x5A5A0000 | (毫秒 & 0xFFFF)`，
    同一毫秒内反复调用会得到**同一个值**。而"只保证与紧邻的前一个不同"是不够的——
    首尾两个 token 并不相邻，一旦撞上，"脚本被拒收"（寄存器停在起始值）就会被误判成
    "已经跑到结束哨兵"，正好把这个哨兵存在的意义反过来用。
    实测撞过两次（真机 UR30 与单测各一次），所以这里改成显式排除一组。
    """
    taken = set()
    if previous is not None:
        taken.add(previous)
    for item in avoid:
        if item is not None:
            taken.add(item)
    token = 0x5A5A0000 | (int(time.time() * 1000) & 0xFFFF)
    while token in taken:
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
    # `finish` 必须同时避开 `before` 与 `start`：它与 `before` **不相邻**，撞上就会把
    # "脚本没执行"直接读成"已跑到末尾"（假阳性）。
    finish_token = _sentinel_token(start_token, before)
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
    # 默认值取自手册：Poly5 15.29 / PolyScope X 15.28 的 `movej(q, a=1.4, v=1.05, t=0, r=0)`
    # （旧代码给的是 a=1/v=1，既不是手册默认值、也不是 URBasic 的默认值，纯粹是随手写的）。
    a = _nonneg_float(p.get("a", 1.4), "a", "movej 的加速度", allow_zero=False)
    v = _nonneg_float(p.get("v", 1.05), "v", "movej 的速度", allow_zero=False)
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
    # 手册默认值：Poly5 15.30 / PolyScope X 15.29 的 `movel(pose, a=1.2, v=0.25, t=0, r=0)`
    # —— 250 mm/s。旧代码默认 v=1（1 m/s，是手册默认的 4 倍），对协作臂来说是"没写速度就按
    # 手册跑得最快的那一档"，这里改回手册值。
    a = _nonneg_float(p.get("a", 1.2), "a", "movel 的加速度", allow_zero=False)
    v = _nonneg_float(p.get("v", 0.25), "v", "movel 的速度", allow_zero=False)
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
    # C7：相对位移是唯一漏掉 isfinite 的数值入口。NaN/Infinity 一旦进入目标位姿，
    # 会被 URBasic 原样拼成 `movel(p[nan,...])` —— 语义未定义（且 XML/JSON 里也非法）。
    if not math.isfinite(distance):
        return err("不执行沿轴移动：distance 必须是有穷数值（拒绝 NaN/Infinity），收到 %s"
                   % distance, "BADARG", {"ip": ip, "distance": distance})
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
    # C7：与 `_axis_move` 同一条 isfinite 防线（NaN/Infinity 不得进入目标位姿）。
    if not math.isfinite(distance):
        return err("不执行沿工具轴移动：distance 必须是有穷数值（拒绝 NaN/Infinity），收到 %s"
                   % distance, "BADARG", {"ip": ip, "distance": distance})
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
    # `movec` 的 mode 参数省略（默认就是 0）：某些固件对多余的关键字参数更严格，省略可提高跨版本兼容性。
    cmd = ("movep(p%s, a=1, v=0.25, r=0.025)\n"
           "movec(p%s, p%s, a=1, v=0.25, r=0.025)\n"
           "movec(p%s, p%s, a=1, v=0.25, r=0.025)" %
           (wp[0], wp[1], wp[2], wp[3], wp[0]))
    _assert_remote_control(ip, "draw_circle")

    # 「控制器到底有没有执行这段脚本」必须当场确认：固件差异会让这段指令组合被拒（真机实测：
    # CB3/3.15 正常，UR20/PS5.21 一动不动），而旧实现只会在 _wait_robot_idle 里干等满预算
    # （60 s 后才报超时，且说明不了原因）。前置一行起始哨兵即可把"完全不动"变成即时结论。
    index = _bounded_int(p.get("register", DEFAULT_SENTINEL_REGISTER), "register", 0, 23,
                         "执行哨兵寄存器编号")
    model = ROBOT_MODELS.get(ip)
    token = _sentinel_token(_read_int_register(model, index))
    script = "write_output_integer_register(%d, %d)\n%s\n" % (index, token, cmd)
    if not _send_program(robot, script):
        return err("draw_circle 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    deadline = time.time() + SCRIPT_START_CHECK_TIMEOUT_S
    while time.time() < deadline:
        if _read_int_register(model, index) == token:
            break
        time.sleep(0.1)
    else:
        return err("控制器**没有执行** draw_circle 脚本：%.1fs 内没看到起始哨兵（寄存器 %d）。"
                   "机器人不会移动 —— 旧版就是在这里干等满 60 s 再报超时。可能原因：该固件不接受这段"
                   "指令组合（movep/movec），或控制器未处于远程控制模式。"
                   % (SCRIPT_START_CHECK_TIMEOUT_S, index), "NOT_EXECUTED",
                   {"command": cmd, "register": index, "token": token, "ip": ip})

    ok_flag, confirm = _wait_robot_idle(ip, _budget_ms(p))
    return ok({"message": "命令已发送（控制器已开始执行），%s：%s" % (confirm, cmd),
               "data": {"ok": ok_flag, "command": cmd, "register": index, "ip": ip}})


def op_draw_square(p):
    """以 origin 为一个角、border 为边长，走一个闭合正方形。

    ★ 位姿向量的下标：0-2 是 x/y/z（**米**），3-5 是 rx/ry/rz（**弧度**）。
    `coordinate="z"` 表示在 **y-z 竖直平面**内画（与 draw_circle / draw_star 的约定一致），
    因此竖直那条边必须写 **下标 2（z，米）**。

    ⚠️ 这里曾经写成 `wp[1][3] -= border` / `wp[2][3] -= border` —— 把米写进了**旋转分量**，
    于是 `draw_square(border=0.2, coordinate="z")` 实际是让工具绕 rx 转 ±0.2 rad（≈11.5°）
    而不是画方。同一函数里水平分支用的是位置分量，draw_circle/draw_star 的 z 分支也用下标 2，
    所以这是笔误而非设计。
    """
    ip = str(p["ip"])
    origin = _vec(p, "origin", 6, "draw_square 的 origin")
    border = _nonneg_float(p["border"], "border", "draw_square 的边长", allow_zero=False)
    coordinate = str(p.get("coordinate", "z")).lower()
    robot, _ = ensure_connected(ip)
    wp = [list(origin) for _ in range(3)]
    if coordinate == "z":
        # y-z 竖直平面：先沿 +y 走 border，再沿 z 走 border（回到原 x）
        wp[0][1] = wp[0][1] + border
        wp[1][1] = wp[1][1] + border
        wp[1][2] = wp[1][2] - border
        wp[2][2] = wp[2][2] - border
    else:
        # x-y 水平平面：先沿 +y 走 border，再沿 +x 走 border
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
    """以 origin 为一个角、width × height 走一个闭合长方形。

    ★ 同 `op_draw_square`：竖直方向的位移必须落在**位置**分量上
    （`coordinate="z"` 时是下标 2 = z，米），不能落在旋转分量（下标 3 = rx，弧度）。
    这里同样修掉了 `wp[1][3] -= height` 的笔误。
    """
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
        wp[1][2] = wp[1][2] - height
        wp[2][2] = wp[2][2] - height
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


# load 命令的**失败判定**不能直接复用 `_dashboard_ok`：后者按任意位置出现 "error"/"failed"
# 判失败，而成功应答会把程序路径原样回显（`Loading program: /programs/error_pick.urp`），
# 文件名里带 "error" 就会被误判成加载失败。这里先认成功前缀，再只匹配明确的失败措辞。
_LOAD_SUCCESS_PREFIX = "loading program"
_LOAD_FAILURE_WORDS = ("could not", "cannot", "unable", "not allowed", "failed",
                       "not understand", "invalid")


def _load_reply_failed(resp):
    """load 的 dashboard 应答是否明确表示失败（"File not found" / "Could not load program"…）。"""
    text = (resp or "").strip().lower()
    if not text:
        return False
    if text.startswith(_LOAD_SUCCESS_PREFIX):
        return False
    if _load_failed(text):
        return True
    return any(word in text for word in _LOAD_FAILURE_WORDS)


# `get loaded program` 的应答是 `Program loaded: <path>`（或 `No program loaded`）。
# 比对"是不是同一个程序"时先剥掉这个标签，再取 basename —— dashboard 可能回绝对路径，
# 而模型给的是 `pick.urp`（相对 programs_dir），整串比较会把正确加载判成不匹配。
_LOADED_LABEL_RE = re.compile(r"^\s*program\s+loaded\s*:\s*", re.IGNORECASE)


def _remote_program_basename(path):
    """取机器人程序路径的 basename（剥掉 dashboard 的 `Program loaded:` 前缀）。"""
    text = str(path if path is not None else "").strip()
    match = _LOADED_LABEL_RE.match(text)
    if match is not None:
        text = text[match.end():].strip()
    text = text.replace("\\", "/").rstrip("/")
    if "/" in text:
        text = text.rsplit("/", 1)[-1]
    return text.strip()


def _program_paths_match(loaded, target):
    """C6：已加载程序与请求目标是否同一个文件（按 basename 比对）。"""
    loaded_name = _remote_program_basename(loaded)
    target_name = _remote_program_basename(target)
    return bool(loaded_name) and bool(target_name) and loaded_name == target_name


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
    """加载一个 UR 程序；`confirmed` 只在**有正向证据**时为 True（C6）。

    - `sent`（load 命令拿到自己的应答）为真，且 dashboard 报的已加载程序与 target 的 basename
      一致 ⇒ `confirmed=True`；
    - 控制器明确说加载失败（"not found" / "no such" / "could not ..." 等）或已加载的是**另一个**
      程序 ⇒ 直接 `err`，不谎报成功；
    - 应答丢失 / 读不到已加载程序 ⇒ `confirmed=None`（"无法判定"，不等于成功）。
    """
    ip = str(p["ip"])
    name = _sanitize_path(p.get("program_name", ""), "program_name")
    ensure_connected(ip)
    if not name:
        return err("未指定要加载的程序名 program_name。", "BADARG")
    target = _build_program_target(p)
    # `ur_load` 需要参数，不能走无参的 _dashboard_cmd；但**必须**沿用同一套"只认本次应答"
    # 的做法（先清空 last_respond），否则 "File not found" 会被上一条应答顶掉。
    sent, resp = _dashboard_cmd_args(ip, "ur_load", target)
    loaded = _loaded_program(dashboard(ip))
    matches = _program_paths_match(loaded, target)
    resp_failed = _load_reply_failed(resp)
    data = {"program_name": name, "target": target, "loaded": loaded, "respond": resp,
            "sent": sent, "matched": matches, "confirmed": None, "ip": ip}
    if _load_failed(resp) or _load_failed(loaded) or resp_failed:
        return err("加载程序失败：控制器应答 %r（已加载：%r）⇒ 目标 %s 没有加载成功。"
                   % (resp, loaded, target), "BADARG", data)
    if sent and matches:
        data["confirmed"] = True
        return ok({"message": "加载程序：%s（已加载：%s，已确认与目标一致）" % (name, loaded),
                   "data": data})
    if loaded and not matches:
        return err("加载未生效：控制器当前加载的是 %r，不是请求的 %s ⇒ 不当作成功。"
                   % (loaded, target), "BADARG", data)
    # sent=False 或者读不到已加载程序：没有正向证据，只能如实说"无法判定"，不宣称成功。
    return ok({"message": "加载程序：%s（已下发，但**无法确认**：load 应答=%r，已加载=%r）"
                          % (name, resp, loaded), "data": data})


def op_run_program(p):
    """加载（可选）并启动程序；**play 之前必须有正向证据**（C6）。

    旧实现只看"当前已加载程序"是否像失败文案，于是加载失败/应答丢失/加载被忽略时仍会
    `ur_play()` —— 跑的是控制器上原来加载的**另一个程序**（P0）。现在三条判据缺一不可：
    load 拿到应答、已加载程序非空且与 target 同 basename、应答不是失败文案；任一不满足直接
    返回 err，**绝不 play**。
    """
    ip = str(p["ip"])
    name = _sanitize_path(p.get("program_name", ""), "program_name")
    ensure_connected(ip)
    d = dashboard(ip)
    load_data = {}
    if name:
        target = _build_program_target(p)
        sent, load_resp = _dashboard_cmd_args(ip, "ur_load", target)
        loaded = _loaded_program(d)
        matches = _program_paths_match(loaded, target)
        resp_failed = _load_reply_failed(load_resp)
        load_data = {"target": target, "load_respond": load_resp, "sent": sent,
                     "loaded": loaded, "matched": matches}
        if not sent:
            return err("未启动：加载程序 %s 的指令没有得到控制器应答（无法确认已加载）⇒ 不执行 play。"
                       % name, "NOT_EXECUTED", load_data)
        if _load_failed(load_resp) or _load_failed(loaded) or resp_failed:
            return err("未启动：加载程序 %s 失败（控制器应答 %r；已加载 %r）⇒ 不执行 play。"
                       % (name, load_resp, loaded), "BADARG", load_data)
        if not loaded:
            return err("未启动：无法读取控制器当前加载的程序 ⇒ 不执行 play。", "NOT_EXECUTED", load_data)
        if not matches:
            return err("未启动：控制器当前加载的是 %r，与请求的 %r 不符 ⇒ 不执行 play"
                       "（否则会运行控制器上原来的旧程序）。" % (loaded, target), "BADARG", load_data)
    play_ok, resp = _dashboard_cmd(ip, "ur_play")
    # 只回报"已下发"，并且**同时给出运行状态**：dashboard 说 play 了、但机器人可能因安全
    # 停止/未使能而根本没启动。把 running 一并返回，调用方（与模型）才有依据下判断。
    running = _program_running(ip)
    if not play_ok:
        return err("启动程序失败：%s" % resp, "TIMEOUT")
    if not _dashboard_ok(resp):
        return err("启动程序被控制器拒绝：%s" % resp)
    data = {"program_name": name, "respond": resp, "running": running, "ip": ip}
    data.update(load_data)
    return ok({"message": "已下发启动程序 %s（控制器应答：%s；运行状态：%s）"
                          % (name or "(当前加载)", resp, "运行中" if running else "未在运行"),
               "data": data})


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


# 工具数字输入的工具脚本回读：**与传送带读取共用同一组 scratch 寄存器**（20 / 0）。
# 它们只是"一次读取期间的临时便签"，不是持久状态；worker 单线程、一次只处理一条请求，
# 且每次读取前都用 `_sentinel_token()` 避开寄存器里的既有值，所以复用不会串台。
# 复用还有一个硬理由：RTDE 配方里启用的 int/double 寄存器是**逐个数列举**的，
# 新开一个寄存器就得同步改 rtdeConfiguration*.xml，否则 check-rtde-recipe.py 会失败。
TOOL_DI_SENTINEL_REGISTER = CONVEYOR_SENTINEL_REGISTER
TOOL_DI_PAYLOAD_REGISTER = CONVEYOR_PAYLOAD_REGISTER


def _read_tool_digital_in_verified(robot, model, n, ip,
                                   index=TOOL_DI_SENTINEL_REGISTER,
                                   payload_index=TOOL_DI_PAYLOAD_REGISTER):
    """读工具数字输入，并**用哨兵证明脚本真的执行过**。返回 `(value, failure)`。

    工具数字输入不在 RTDE 上，只能靠一段 URScript 把表达式结果写进输出寄存器再回读。
    问题是：控制器在**非远程控制模式**下会静默丢弃 URScript，而 `waitRobotIdleOrStopFlag()`
    不会因此报错（它只在"看到程序开始后又停下"时才置错）—— 上游实现直接回读寄存器 0，
    于是把**上一次遗留的值**当成输入电平报出去。安全相关的电气读数被报反，比报错更糟。

    判定与 `op_get_conveyor` 同一套：先写通道探测哨兵确认脚本能被执行，再把真正的读数
    夹在首尾哨兵之间；看不到结束哨兵就**不给值**（`failure` 非 None）。
    """
    probe_token = _sentinel_token(_read_int_register(model, index))
    probe = ("def ur_write_tool_di_probe():\n"
             "  write_output_integer_register(%d, %d)\n"
             "end\nur_write_tool_di_probe()\n" % (index, probe_token))
    if not _send_program(robot, probe):
        return None, err("工具数字输入通道探测脚本未能送达控制器：%s" % _last_send_failure(robot),
                         "SEND_FAILED", {"ip": ip})
    deadline = time.time() + SEND_SCRIPT_VERIFY_TIMEOUT_S
    while time.time() < deadline:
        if _read_int_register(model, index) == probe_token:
            break
        time.sleep(0.1)
    else:
        return None, err(
            "控制器没有执行探测脚本（output_int_register_%d 上一直看不到哨兵值 %d）⇒ 它可能未处于"
            "远程控制模式，或整段 URScript 被静默丢弃。此时**无法**给出工具数字输入电平，"
            "也不会回读一个陈旧值来冒充它。" % (index, probe_token),
            "NOT_EXECUTED", {"register": index, "token": probe_token, "ip": ip})

    # 三个 token 必须互不相同：只保证"与紧邻的前一个不同"不够 —— 首尾哨兵不相邻，
    # 一旦撞上，"脚本被拒收"（寄存器停在起始值）就会被误判成"已跑到结束哨兵"。
    start_token = _sentinel_token(probe_token)
    finish_token = _sentinel_token(start_token, probe_token)
    program = ("def ur_read_tool_digital_in():\n"
               "  write_output_integer_register(%d, %d)\n"
               "  write_output_float_register(%d, get_tool_digital_in(%d))\n"
               "  write_output_integer_register(%d, %d)\n"
               "end\nur_read_tool_digital_in()\n"
               % (index, start_token, payload_index, n, index, finish_token))
    if not _send_program(robot, program):
        return None, err("工具数字输入读取脚本未能送达控制器：%s" % _last_send_failure(robot),
                         "SEND_FAILED", {"ip": ip})

    observed = start_token
    started = False
    deadline = time.time() + SEND_SCRIPT_VERIFY_TIMEOUT_S
    while time.time() < deadline:
        observed = _read_int_register(model, index)
        if observed == finish_token:
            # 走到末尾必然开始过。轮询间隔（0.1s）可能整个错过中间态，显式置位以免报出
            # "verified 但 started=false" 这种自相矛盾的证据组合。
            started = True
            break
        if observed == start_token:
            started = True
        time.sleep(0.1)
    sentinel = {"register": index, "payload_register": payload_index,
                "probe_token": probe_token, "start_token": start_token,
                "finish_token": finish_token, "observed": observed, "started": started}

    if observed != finish_token:
        if started:
            return None, err(
                "工具数字输入读取脚本**开始执行了但没走到末尾**（起始哨兵 %d 已回读，结束哨兵 %d 没出现）"
                "⇒ `get_tool_digital_in(%d)` 在该控制器上很可能不可用，或中途报错中止"
                "（常见原因：未接工具、工具数字 I/O 未启用，或工具端被 TCI 串口占用）。因此**不给**电平值。"
                % (start_token, finish_token, n),
                "UNSUPPORTED", dict(sentinel, ip=ip))
        return None, err(
            "控制器**没有执行**工具数字输入读取脚本：哨兵仍停在通道探测值 %d（起始与结束哨兵都没出现）"
            "⇒ 整段脚本在控制器侧被拒。因此**不给**电平值 —— 旧实现在这种情况下会把一个从没被写过的"
            "寄存器读成输入电平。" % probe_token,
            "NOT_EXECUTED", dict(sentinel, ip=ip))

    raw = _read_double_register(model, payload_index)
    if raw is None:
        return None, err("脚本已执行完毕（结束哨兵已回读），但 output_double_register_%d 读不到值"
                         % payload_index, "READ_FAILED", dict(sentinel, ip=ip))
    return bool(raw), None


def op_get_digital_in(p):
    ip = str(p["ip"])
    which = str(p.get("which", "std")).lower()
    robot, model = ensure_connected(ip)
    if which == "config":
        n = _bounded_int(p["n"], "n", 8, 15, "config 端口号")
        val = robot.get_configurable_digital_in(n)
    elif which == "tool":
        n = _bounded_int(p["n"], "n", 0, 1, "tool 端口号")
        # Tool digital inputs are not on RTDE; the read goes through a URScript
        # expression plus a sentinel-verified register read-back.
        #
        # ⚠️ 旧实现只把"运行期错误"翻译成人话，却漏掉了最需要区分的第三种情况：
        # 控制器处于本地/示教器模式时会**静默丢弃**整段脚本，而 `waitRobotIdleOrStopFlag()`
        # 不会置错（它只在"看到程序开始后又停下"时置位）⇒ 随后回读的输出寄存器 0 里躺着
        # **上一次遗留的值**，工具把它当输入电平报出去。现在整条读取走
        # `_read_tool_digital_in_verified()`：先用通道探测哨兵确认脚本真的被执行，再把读数
        # 夹在首尾哨兵之间；任何一步看不到就**不给值**（`failure` 非 None 直接返回）。
        val, failure = _read_tool_digital_in_verified(robot, model, n, ip)
        if failure is not None:
            return failure
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
        # 工具数字输出不在 RTDE 上，只能走 URScript。**必须判发送结果**：std / config
        # 两条分支都用 `_realtime_send()` 判过，唯独 tool 这条以前把
        # `RealTimeClient.Send()` 的返回值丢掉就回报"已设置" —— 掉线或非远程控制模式
        # （URScript 被静默丢弃）时输出根本没置位，工具却宣称已置位。这是全仓唯一一处
        # "连发没发出去都不看"的路径，而它驱动的恰恰是夹爪/气阀这类物理执行器。
        if not robot.set_tool_digital_out(n, value):
            return err("工具数字输出脚本未能送达控制器：%s" % _last_send_failure(robot),
                       "SEND_FAILED", {"ip": ip})
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
    # ⚠️ 回读的是该通道的**电压**量。若通道被配置成电流域（0-20 mA），这个读数与你设定的电流
    # 根本不是同一个量（真机实测：设 5 V、通道为电流域时回读只有 0.012 V）——所以把类型字一起给出。
    io_types = _rtde_field(ROBOT_MODELS.get(ip), "analog_io_types")
    try:
        io_types = None if io_types is None else int(io_types)
    except Exception:
        io_types = None
    return ok({"message": "已设置模拟输出 %d = %s（相对电平 %.4f；回读 %s%s）"
                          % (n, value, fraction,
                             read_back if read_back is not None else "不可用",
                             "；注意：回读的是电压量，若该通道是电流域则与设定值不是同一个量"
                             if read_back is not None and abs(read_back - value) > 0.05 else ""),
               "data": {"port": n, "value": value, "full_scale": full_scale,
                        "fraction": fraction, "read_back": read_back,
                        "analog_io_types": io_types, "ip": ip}})


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
    return ok_unverified({"message": "已设置工具电压为 %sV" % voltage,
               "data": {"voltage": voltage, "ip": ip}})


def op_set_tcp(p):
    ip = str(p["ip"])
    pose = _vec(p, "pose", 6, "set_tcp 的 pose")
    # C7：TCP 决定此后所有运动的物理落点，但模型可以不经审批直接调它（门禁在宿主侧）。
    # worker 侧再给一道幅值上限：位置 ≤ 1 m、旋转 ≤ 2π rad —— 超出必然是单位/幅值写错。
    for index, value in enumerate(pose):
        limit = 1.0 if index < 3 else (2.0 * math.pi)
        if abs(value) > limit:
            return err("不执行 set_tcp：pose[%d]=%s 超出上限 %s（|xyz| ≤ 1 m，|r| ≤ 2π rad）"
                       % (index, value, limit), "BADARG",
                       {"tcp": [float(x) for x in pose], "index": index,
                        "limit": limit, "ip": ip})
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "set_tcp")
    if not _send_program(robot, "set_tcp(p[%.6f,%.6f,%.6f,%.6f,%.6f,%.6f])\n" % tuple(pose)):
        return err("set_tcp 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok_unverified({"message": "已设置 TCP：%s" % pose,
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
    return ok_unverified({"message": "已设置负载：%skg，重心 %s" % (mass, cog),
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
    # 手册新增参数（Poly5 15.28 / PolyScope X 15.27）：`mode=0` 沿途插补姿态，
    # `mode=1` 姿态相对圆弧切线保持不变（即"固定姿态"圆弧）。旧实现根本没发这个参数，
    # 于是想走固定姿态圆弧只能绕开这个工具。
    mode = _bounded_int(p.get("mode", 0), "mode", 0, 1, "movec 的 mode（0 插补姿态 / 1 固定姿态）")
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "movec")
    cmd = ("movec(p[%.4f,%.4f,%.4f,%.4f,%.4f,%.4f], p[%.4f,%.4f,%.4f,%.4f,%.4f,%.4f], "
           "a=%s, v=%s, r=%s, mode=%d)") % (
        via[0], via[1], via[2], via[3], via[4], via[5],
        to[0], to[1], to[2], to[3], to[4], to[5], a, v, r, mode)
    if not _send_program(robot, cmd):
        return err("movec 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    ok_flag, msg = _movel_confirm(ip, to, _budget_ms(p))
    return ok({"message": "命令 %s 已发送，%s" % (cmd, msg),
               "data": {"ok": ok_flag, "command": cmd, "ip": ip}})


def op_servoj(p):
    ip = str(p["ip"])
    q = _vec(p, "q", 6, "servoj 的 q")
    # 手册的 t 默认值随版本变化：3.15.4 写的是 t=0.008，Poly5 15.44 / PolyScope X 15.43 改成
    # t=0.002（"preferred to call this function with a new setpoint in each timestep"）。
    # 这里保留 0.008 作为默认值以兼容 CB3，但把范围放宽到 0.002 —— 调用方显式给 0.002 时
    # 不会因为"低于旧下限"被拒。
    t = _bounded_float(p.get("t", 0.008), "t", 0.002, 1.0, "servoj 的控制时长")
    # lookahead_time 的下限同样随版本变化：3.15.4 是 0.03，Poly5/PolyScope X 是 0.01。
    look = _bounded_float(p.get("lookahead_time", 0.1), "lookahead_time",
                         0.01, 0.2, "servoj 的前瞻时间")
    gain = int(_bounded_float(p.get("gain", 100), "gain", 100, 2000, "servoj 的比例增益"))
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "servoj")
    if not _send_program(robot, "servoj([%s], t=%s, lookahead_time=%s, gain=%s)"
                                % (",".join("%.6f" % x for x in q), t, look, gain)):
        return err("servoj 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok({"message": "servoj 已下发（连续流单步）：%s" % q,
               "data": {"q": q, "t": t, "lookahead_time": look, "gain": gain, "ip": ip}})


# ---------------------------------------------------------------------------
# 力控 / 速度控制 / 目标值 / 稳态等待（手册交叉核对后新增）
# ---------------------------------------------------------------------------
#
# 这一组全部直接拼 URScript（理由与 movec/draw_* 一致：URBasic 里对应的包装要么是
# NotImplementedError 桩，要么会阻塞等待一段**永不结束**的程序）。参数名与语义逐条对照
# 仓库内的三本官方手册：
#   ScriptManual/scriptManual_3.15.4.pdf          （URSoftware 3.x / CB3）
#   ScriptManual/script_directory_Poly5.pdf       （PolyScope 5 / e-Series）
#   ScriptManual/script_directory_PolyscopeX.pdf  （PolyScope X / 10.x）
# 三个版本的签名一致处才写成"通用"；版本差异见工具描述与 docs/urscript-manual-analysis.md。

# 手册给出的力控参数范围（Poly5 15.12 / 15.16 / 15.17；PolyScope X 15.11 / 15.14 / 15.15）。
FORCE_MODE_TYPES = (1, 2, 3)
FORCE_MODE_DAMPING_RANGE = (0.0, 1.0)
FORCE_MODE_GAIN_RANGE = (0.0, 2.0)


def _float_list(raw, n, what):
    """把 JSON 数组强转成 n 个有限浮点数（力控的 selection_vector/wrench/limits 用）。"""
    if raw is None:
        raise ValueError(what + " 缺失，需要传入 %d 维数组" % n)
    try:
        vals = [float(x) for x in raw]
    except (TypeError, ValueError):
        raise ValueError(what + " 必须是数值数组（如 [1,0,0,0,0,0]）")
    if len(vals) != n:
        raise ValueError(what + " 必须是 %d 维数组，收到 %d 维" % (n, len(vals)))
    for v in vals:
        if not math.isfinite(v):
            raise ValueError(what + " 含非有限数值（NaN/Infinity），已拒绝")
    return vals


def _ur_number(v):
    """URScript 里数值的字面量写法。

    整数必须写成 `2` 而不是 `2.0`（`force_mode` 的 type 只接受整数 1/2/3），
    其余用 `%g`：既保留足够精度，又不会把 `0.05` 写成 `0.050000` —— 这些脚本会被写进
    日志和工具返回值里供人核对，短一点的数字更容易看出"我传的到底是几"。
    """
    f = float(v)
    if f.is_integer() and abs(f) < 1e15:
        return "%d" % int(f)
    return "%g" % f


def _ur_list(vals):
    return "[%s]" % ",".join(_ur_number(v) for v in vals)


def op_force_mode(p):
    """进入力控（Force Mode）。

    Poly5 15.12 / PolyScope X 15.11：`force_mode(task_frame, selection_vector, wrench, type, limits)`

    ⚠️ 行为要点（手册原文的直译）：
      - selection_vector 里 1 = 该轴**柔性**（机器人会沿/绕该轴运动以达成 wrench），0 = 刚性；
      - limits 对柔性轴是**最大 TCP 速度**，对刚性轴是**允许的最大位置偏差**；
      - 手册明确建议进入力控前先 `sleep(0.02)`，并避免沿柔性轴的运动与高减速 ——
        这里采纳该建议，在脚本里先 sleep 再进力控；
      - type=1/3 会对力坐标系做变换（1：y 轴指向力坐标系原点；3：x 轴为 TCP 速度在
        力坐标系 xy 面的投影），type=2 不做变换。

    实现方式与 URBasic 的 `UrScript.force_mode()` 相同：把 `force_mode(...)` 放进一个
    永不退出的程序（`while True: force_mode(...) sync() end`），这样力控在控制器侧持续生效，
    而 worker 不会被阻塞。**退出**用 `ur_end_force_mode`（它发一条新脚本抢占该程序，并调用
    `end_force_mode()`），或直接停止控制器上的程序。
    """
    ip = str(p["ip"])
    task_frame = _float_list(p.get("task_frame", [0, 0, 0, 0, 0, 0]), 6, "force_mode 的 task_frame")
    selection = _float_list(p.get("selection_vector", [0, 0, 1, 0, 0, 0]), 6,
                            "force_mode 的 selection_vector")
    wrench = _float_list(p.get("wrench", [0, 0, 0, 0, 0, 0]), 6, "force_mode 的 wrench")
    f_type = _bounded_int(p.get("type", 2), "type", 1, 3, "force_mode 的 type（1/2/3）")
    limits = _float_list(p.get("limits", [2, 2, 1.5, 1, 1, 1]), 6, "force_mode 的 limits")
    damping = None
    if p.get("damping") is not None:
        damping = _bounded_float(p["damping"], "damping",
                                 FORCE_MODE_DAMPING_RANGE[0], FORCE_MODE_DAMPING_RANGE[1],
                                 "force_mode 的 damping")
    gain = None
    if p.get("gain_scaling") is not None:
        gain = _bounded_float(p["gain_scaling"], "gain_scaling",
                              FORCE_MODE_GAIN_RANGE[0], FORCE_MODE_GAIN_RANGE[1],
                              "force_mode 的 gain_scaling")
    # selection_vector 只能是 0/1：别的值控制器会直接报错，提前拦住并说明。
    for i, s in enumerate(selection):
        if s not in (0.0, 1.0):
            raise ValueError("force_mode 的 selection_vector 只能由 0/1 组成，第 %d 个是 %s"
                             % (i, s))
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "force_mode")
    prelude = ""
    if damping is not None:
        # 手册 15.16 / 15.15：这两个值必须**在进入力控之前**设置才会生效。
        prelude += "force_mode_set_damping(%s)\n" % _ur_number(damping)
    if gain is not None:
        prelude += "force_mode_set_gain_scaling(%s)\n" % _ur_number(gain)
    call = "force_mode(p%s, %s, %s, %d, %s)" % (
        _ur_list(task_frame), _ur_list(selection), _ur_list(wrench), f_type, _ur_list(limits))
    # 永不退出的程序：力控需要持续被"重新声明"，程序一旦结束力控就退出（手册亦如此说明）。
    script = (prelude
              + "def ur_force_mode():\n"
                "  sleep(0.02)\n"
                "  while(True):\n"
                "    %s\n"
                "    sync()\n"
                "  end\n"
                "end\nur_force_mode()\n" % call)
    if not _send_program(robot, script):
        return err("force_mode 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    # ⚠️ 这里只能说"已下发"：`_send_program()` 证明的是**字节写进了 socket**，不是控制器执行了它。
    # UR 只在远程控制模式下接受 URScript，本地/示教器模式下会被**静默丢弃**（且不报错）。
    # 旧文案「力控已进入」会让操作员据此把手或工件交给其实没在力控的机械臂 —— 这是本插件
    # 最危险的一类谎报，因此措辞降级 + verified:false，把确认责任明确交回使用者。
    return ok({"message": "力控程序**已下发**（未校验）：%s。退出请调用 ur_end_force_mode，"
                          "或在示教器上停止程序。⚠️ 本插件只能确认脚本已写入控制器，无法证明力控"
                          "真的生效 —— UR 仅在远程控制模式下接受 URScript，本地/示教器模式下会被"
                          "静默丢弃。请用 ur_get_robot_mode 或现场观察确认后再松手。" % call,
               "data": {"command": call, "task_frame": task_frame,
                        "selection_vector": selection, "wrench": wrench, "type": f_type,
                        "limits": limits, "damping": damping, "gain_scaling": gain,
                        "verified": False, "ip": ip}})


def op_end_force_mode(p):
    """退出手动/力控模式（`end_force_mode()`）。

    手册 15.8 / PolyScope X 15.7。向 30003 发一段新脚本会抢占正在运行的力控程序，
    `end_force_mode()` 随之执行（与 `_set_control_mode` 的关闭路径同一机制）。
    """
    ip = str(p["ip"])
    robot, _ = ensure_connected(ip)
    if not _send_program(robot, "end_force_mode()\n"):
        return err("end_force_mode 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    # 同 `op_force_mode`：能证明的只有"脚本已写进 socket"，不是"力控已退出"。
    return ok({"message": "退出力控的脚本**已下发**（未校验）：`end_force_mode()`。本插件只能确认"
                          "脚本已写入控制器；UR 仅在远程控制模式下接受 URScript，本地/示教器模式下"
                          "会被静默丢弃，请用 ur_get_safety_status / ur_get_robot_mode 复核。",
               "data": {"verified": False, "ip": ip}})


def op_force_mode_settings(p):
    """读取/设置力控的 damping 与 gain_scaling。

    ⚠️ 这两个值**没有回读通道**：手册只定义了 `force_mode_set_*`（Poly5 15.16/15.17、
    PolyScope X 15.15/15.14），本插件因此只记住**本次会话通过本工具设置过的值**，
    并在返回值里把这一点写清楚 —— 不做"读回来的当前值"这种假装。
    """
    ip = str(p["ip"])
    robot, _ = ensure_connected(ip)
    applied = {}
    if p.get("damping") is not None:
        damping = _bounded_float(p["damping"], "damping",
                                 FORCE_MODE_DAMPING_RANGE[0], FORCE_MODE_DAMPING_RANGE[1],
                                 "力控 damping")
        if not _realtime_send(robot, "force_mode_set_damping(%s)\n" % _ur_number(damping)):
            return err("force_mode_set_damping 未能送达控制器：%s" % _last_send_failure(robot),
                       "SEND_FAILED")
        applied["damping"] = damping
    if p.get("gain_scaling") is not None:
        gain = _bounded_float(p["gain_scaling"], "gain_scaling",
                              FORCE_MODE_GAIN_RANGE[0], FORCE_MODE_GAIN_RANGE[1],
                              "力控 gain_scaling")
        if not _realtime_send(robot, "force_mode_set_gain_scaling(%s)\n" % _ur_number(gain)):
            return err("force_mode_set_gain_scaling 未能送达控制器：%s"
                       % _last_send_failure(robot), "SEND_FAILED")
        applied["gain_scaling"] = gain
    if not applied:
        raise ValueError("至少要给出 damping 或 gain_scaling 之一（这两个值无法回读）")
    return ok_unverified({"message": "已设置力控参数 %s（该值在控制器侧无法回读，这里只回报本次设置值）"
                          % applied,
               "data": {"applied": applied, "readback_supported": False, "ip": ip}})


def op_speedj(p):
    """关节速度控制 `speedj(qd, a, t)`（Poly5 15.48 / PolyScope X 15.47）。

    线性加速到恒定关节速度后**持续运动**。手册给出 t 是可选的：给了 t，函数在 t 秒后返回；
    没给，则在达到目标速度时返回 —— **此时机器人仍在以该速度运动**，直到 stopj 或新指令。
    因此这里把"没给 t"如实写进返回值（否则调用方会以为指令已经结束）。
    """
    ip = str(p["ip"])
    qd = _vec(p, "qd", 6, "speedj 的 qd")
    a = _nonneg_float(p.get("a", 0.5), "a", "speedj 的关节加速度", allow_zero=False)
    t = _nonneg_float(p.get("t", 0), "t", "speedj 的时长")
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "speedj")
    cmd = "speedj(%s, %s, %s)" % (_ur_list(qd), _ur_number(a), _ur_number(t))
    if not _send_program(robot, cmd + "\n"):
        return err("speedj 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    looped = "持续运动" if t == 0 else ("%.3fs 后返回，机械臂仍可以该速度运动" % t)
    return ok({"message": "speedj 已下发（%s；停止请调用 ur_stopj）" % looped,
               "data": {"command": cmd, "qd": qd, "a": a, "t": t, "ip": ip}})


def op_speedl(p):
    """TCP 速度控制 `speedl(xd, a, t, aRot='a')`（Poly5 15.49 / PolyScope X 15.48）。

    ⚠️ **这是全插件最"放得开"的运动指令**：它绕过正常的位置轨迹规划，直接给 TCP 速度。
    手册要求 a > 0；aRot 省略时按 a 处理（`aRot='a'` 即此意）。
    """
    ip = str(p["ip"])
    xd = _vec(p, "xd", 6, "speedl 的 xd")
    a = _nonneg_float(p.get("a", 0.5), "a", "speedl 的加速度", allow_zero=False)
    t = _nonneg_float(p.get("t", 0), "t", "speedl 的时长")
    a_rot = None
    if p.get("a_rot") is not None:
        a_rot = _nonneg_float(p["a_rot"], "a_rot", "speedl 的旋转加速度", allow_zero=False)
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "speedl")
    args = "%s, %s, %s" % (_ur_list(xd), _ur_number(a), _ur_number(t))
    if a_rot is not None:
        args += ", aRot=%s" % _ur_number(a_rot)
    cmd = "speedl(%s)" % args
    if not _send_program(robot, cmd + "\n"):
        return err("speedl 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    looped = "持续运动" if t == 0 else ("%.3fs 后返回，TCP 仍可以该速度运动" % t)
    return ok({"message": "speedl 已下发（%s；停止请调用 ur_stopl）" % looped,
               "data": {"command": cmd, "xd": xd, "a": a, "t": t, "a_rot": a_rot, "ip": ip}})


def op_stopj(p):
    """减速到关节速度为零 `stopj(a)`（Poly5 15.51 / PolyScope X 15.50）。"""
    ip = str(p["ip"])
    a = _nonneg_float(p.get("a", 2.0), "a", "stopj 的关节减速度", allow_zero=False)
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "stopj")
    cmd = "stopj(%s)" % _ur_number(a)
    if not _send_program(robot, cmd + "\n"):
        return err("stopj 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok({"message": "stopj 已下发（关节减速，a=%s rad/s²）" % a,
               "data": {"command": cmd, "a": a, "ip": ip}})


def op_stopl(p):
    """减速到 TCP 速度为零 `stopl(a, aRot='a')`（Poly5 15.52 / PolyScope X 15.51）。"""
    ip = str(p["ip"])
    a = _nonneg_float(p.get("a", 0.5), "a", "stopl 的减速度", allow_zero=False)
    a_rot = None
    if p.get("a_rot") is not None:
        a_rot = _nonneg_float(p["a_rot"], "a_rot", "stopl 的旋转减速度", allow_zero=False)
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "stopl")
    args = _ur_number(a) + (", aRot=%s" % _ur_number(a_rot) if a_rot is not None else "")
    cmd = "stopl(%s)" % args
    if not _send_program(robot, cmd + "\n"):
        return err("stopl 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok({"message": "stopl 已下发（TCP 减速，a=%s）" % a,
               "data": {"command": cmd, "a": a, "a_rot": a_rot, "ip": ip}})


def op_wait_steady(p):
    """等待机器人完全静止（对应手册的 `is_steady()`）。

    ⚠️ **没有调用 URScript 的 `is_steady()`**，理由是它没法可靠地用在本 worker 的形态里：
    `is_steady()` 是表达式，需要在控制器上跑一段程序把结果写进寄存器再读回；更关键的是
    手册（Poly5 16.39）明确写着"在非标准位置模式（力控、示教）下它**总是返回 false**"，
    而在标准位置模式里等它变 true，与直接观察 RTDE 的速度量是同一件事。
    这里改为轮询**已在 RTDE 数据流里**的 `actual_TCP_speed` 与 `actual_qd`：
    零额外往返、不受程序运行状态影响，且在力控/示教模式下同样能给出真实的静止判断。
    """
    ip = str(p["ip"])
    _, model = ensure_connected(ip)
    timeout_s = _bounded_float(p.get("timeout_s", 10.0), "timeout_s", 0.1, 300.0,
                               "等待静止的超时（秒）")
    lin_tol = _bounded_float(p.get("linear_tolerance", 0.005), "linear_tolerance", 1e-4, 1.0,
                             "TCP 线速度静止阈值（m/s）")
    ang_tol = _bounded_float(p.get("angular_tolerance", 0.01), "angular_tolerance", 1e-4, 10.0,
                             "TCP 角速度静止阈值（rad/s）")
    deadline = time.time() + timeout_s
    last = None
    while True:
        try:
            tcp_speed = [float(x) for x in model.ActualTCPSpeed()]
            qd = [float(x) for x in model.ActualQD()]
        except Exception as exc:                                      # noqa: BLE001
            return err("读取速度量失败，无法判断是否静止：%s" % exc, "NOT_CONNECTED")
        lin = math.sqrt(sum(x * x for x in tcp_speed[:3]))
        ang = math.sqrt(sum(x * x for x in tcp_speed[3:6]))
        joint = max(abs(x) for x in qd)
        last = {"tcp_linear_speed": round(lin, 6), "tcp_angular_speed": round(ang, 6),
                "max_joint_speed": round(joint, 6)}
        steady = lin <= lin_tol and ang <= ang_tol
        if steady:
            return ok({"message": "机器人已静止（TCP 线速度 %.4f m/s ≤ %.4f，角速度 %.4f rad/s ≤ %.4f）"
                                  % (lin, lin_tol, ang, ang_tol),
                       "data": dict(last, steady=True, waited_tolerance=True, ip=ip)})
        if time.time() >= deadline:
            return ok({"message": "等待静止超时（%.1fs）：TCP 线速度 %.4f m/s、角速度 %.4f rad/s，"
                                  "**未达到静止判据**" % (timeout_s, lin, ang),
                       "data": dict(last, steady=False, timeout_s=timeout_s, ip=ip)})
        time.sleep(0.05)


def _vec_or_none(model, getter, n):
    try:
        vals = [float(x) for x in getter()]
    except Exception:
        return None
    return vals if len(vals) == n else None


def op_get_target_values(p):
    """读取"控制器打算去哪"：目标关节角/速度/加速度 与 目标 TCP 位姿/速度。

    数据来自 RTDE 的 `target_*` 字段（本插件已把它们加入接收配方，见
    URBasic/rtdeConfiguration.xml）—— 零额外往返。与 `actual_*`（实际值）的差值是唯一能
    直接看出"指令已下发但还没执行 / 被交融 / 被安全限速拉住"的观测量；手册里对应的
    URScript 函数是 `get_target_joint_positions/speeds`、`get_target_tcp_speed`（Poly5 16.24 /
    16.25 / 16.30）等。
    """
    ip = str(p["ip"])
    _, model = ensure_connected(ip)
    data = {
        "target_q": _vec_or_none(model, model.TargetQ, 6),
        "target_qd": _vec_or_none(model, model.TargetQD, 6),
        "target_qdd": _vec_or_none(model, model.TargetQDD, 6),
        "target_tcp_pose": _vec_or_none(model, model.TargetTCPPose, 6),
        "target_tcp_speed": _vec_or_none(model, model.TargetTCPSpeed, 6),
        "actual_q": _vec_or_none(model, model.ActualQ, 6),
        "actual_tcp_pose": _vec_or_none(model, model.ActualTCPPose, 6),
        "ip": ip,
    }
    if data["target_tcp_pose"] is None and data["target_q"] is None:
        return err("RTDE 的 target_* 字段尚不可用（数据流可能刚建立或配方被替换）",
                   "TIMEOUT", {"ip": ip})
    return ok({"message": "目标值读取成功（target_* 来自 RTDE 数据流）", "data": data})


def op_tool_communication(p):
    """开关工具端 RS-485/TCP 通信（Tool Communication Interface）。

    手册：`set_tool_communication(enabled, baud_rate, parity, stop_bits, rx_idle_chars, tx_idle_chars)`
    （Poly5 18.50 / PolyScope X 18.50）。**手册明确警告：启用 TCI 会禁用工具模拟输入。**
    """
    ip = str(p["ip"])
    enabled = bool(p.get("enabled", True))
    baud = _bounded_int(p.get("baud_rate", 115200), "baud_rate", 9600, 5000000, "波特率")
    if baud not in (9600, 19200, 38400, 57600, 115200, 1000000, 2000000, 5000000):
        raise ValueError("波特率只能是手册列出的 9600/19200/38400/57600/115200/1000000/"
                         "2000000/5000000，收到 %d" % baud)
    parity = _bounded_int(p.get("parity", 2), "parity", 0, 2, "校验位（0 无 / 1 奇 / 2 偶）")
    stop_bits = _bounded_int(p.get("stop_bits", 1), "stop_bits", 1, 2, "停止位（1 或 2）")
    rx_idle = _bounded_float(p.get("rx_idle_chars", 1.0), "rx_idle_chars", 1.0, 40.0,
                             "RX idle chars")
    tx_idle = _bounded_float(p.get("tx_idle_chars", 3.5), "tx_idle_chars", 0.0, 40.0,
                             "TX idle chars")
    robot, _ = ensure_connected(ip)
    cmd = "set_tool_communication(%s, %d, %d, %d, %s, %s)" % (
        "True" if enabled else "False", baud, parity, stop_bits,
        _ur_number(rx_idle), _ur_number(tx_idle))
    if not _realtime_send(robot, cmd + "\n"):
        return err("set_tool_communication 脚本未能送达控制器：%s"
                   % _last_send_failure(robot), "SEND_FAILED")
    return ok_unverified({"message": "已%s工具通信接口（%s）%s"
                          % ("启用" if enabled else "禁用", cmd,
                             "；⚠️ 工具模拟输入已被禁用" if enabled else ""),
               "data": {"enabled": enabled, "baud_rate": baud, "parity": parity,
                        "stop_bits": stop_bits, "rx_idle_chars": rx_idle,
                        "tx_idle_chars": tx_idle, "command": cmd, "ip": ip}})


def op_set_tool_output_mode(p):
    """工具输出模式：1 = power（双针供电模式）/ 0 = 普通数字输出。

    手册 Poly5 18.52 / PolyScope X 18.52：mode 1 表示数字输出针被用作**附加电源**。
    """
    ip = str(p["ip"])
    mode = _bounded_int(p.get("mode", 1), "mode", 0, 1, "工具输出模式（0 普通 / 1 power）")
    robot, _ = ensure_connected(ip)
    cmd = "set_tool_output_mode(%d)" % mode
    if not _realtime_send(robot, cmd + "\n"):
        return err("set_tool_output_mode 脚本未能送达控制器：%s"
                   % _last_send_failure(robot), "SEND_FAILED")
    return ok_unverified({"message": "已设置工具输出模式为 %d%s" % (mode, "（power/双针供电）" if mode == 1 else ""),
               "data": {"mode": mode, "command": cmd, "ip": ip}})


def op_set_payload_inertia(p):
    """设置负载的**质量 + 重心 + 惯性矩阵**（PolyScope X 16.52 `set_target_payload`）。

    手册要点：
      - 惯性矩阵对角线（Ixx, Iyy, Izz）不得为负，每个元素上限 ±133 kg·m²；
      - `set_payload(m, cog)` 会**重置**惯性矩阵（手册把它标为 deprecated，因为会出现
        "质量/重心/惯量不一致"的组合），所以要设惯量就用这个工具一次设全；
      - 设置负载会**自动把力/力矩测量归零**（等效于 zero_ftsensor）；
      - transition_time > 0 可以让负载切换时机器人不"跳"一下（抓/放重物时有用）。

    CB3（URSoftware 3.x）上控制器**没有**这个函数 —— 手册 3.15.4 只有 `set_payload(m, cog)`。
    因此本工具在旧固件上会退回只设置质量与重心，并在返回值里说明。
    """
    ip = str(p["ip"])
    mass = _nonneg_float(p.get("mass"), "mass", "负载质量（kg）", allow_zero=True)
    cog = _vec(p, "cog", 3, "负载重心 cog")
    inertia = None
    if p.get("inertia") is not None:
        inertia = _float_list(p["inertia"], 9, "负载惯性矩阵 inertia（行主序 3×3，kg·m²）")
        for i, name in ((0, "Ixx"), (4, "Iyy"), (8, "Izz")):
            if inertia[i] < 0:
                raise ValueError("惯性矩阵对角线不得为负：%s = %s" % (name, inertia[i]))
        for i, v in enumerate(inertia):
            if abs(v) > 133.0:
                raise ValueError("惯性矩阵元素上限为 ±133 kg·m²，第 %d 个是 %s" % (i, v))
    transition = _bounded_float(p.get("transition_time", 0.0), "transition_time", 0.0, 60.0,
                                "负载切换过渡时间（秒）")
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "set_payload")
    if inertia is None:
        # 与既有 op_set_payload 相同的两条 URScript，三个手册版本都有。**刻意不用**
        # `set_payload(m, cog)`：手册明确说它会**重置惯性矩阵**（5.10.0 起被标为 deprecated），
        # 于是"只想改质量"会顺手把惯量清零，质量/重心/惯量三者不再自洽。
        # 分成 set_payload_mass + set_payload_cog 两条就不会动惯量矩阵。
        script = ("set_payload_mass(%s)\nset_payload_cog(%s)\n"
                  % (_ur_number(mass), _ur_list(cog)))
        note = "只设置了质量与重心（未给 inertia）：用 set_payload_mass + set_payload_cog，不会重置惯性矩阵"
    else:
        m = ",".join(_ur_list(inertia[i * 3:i * 3 + 3]) for i in range(3))
        script = "set_target_payload(%s, %s, [%s], %s)\n" % (
            _ur_number(mass), _ur_list(cog), m, _ur_number(transition))
        note = "已同时设置质量、重心与惯性矩阵"
    if not _send_program(robot, script):
        return err("负载设置脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok_unverified({"message": "%s（⚠️ 设置负载会同时把力/力矩测量归零）" % note,
               "data": {"mass": mass, "cog": cog, "inertia": inertia,
                        "transition_time": transition, "command": script.strip(), "ip": ip}})


def op_move_optimized(p):
    """OptiMove 平滑运动：`optimovej(goal, a=0.3, v=0.3, r=0)` / `optimovel(...)`。

    手册：Poly5 15.32/15.33、PolyScope X 15.31/15.32。与 movej/movel 的区别是
    **jerk 受限**的速度剖面，运动更平滑、振动更小；`a`/`v` 不是 rad/s 或 m/s，而是
    "机器人能力的一个比例"，取值范围 (0, 1]，1 表示该构型下能达到的最快。

    `goal` 在手册里可写四种形态（关节、基座位姿、`struct{pose,frame}`、世界模型对象名）。
    本工具支持前两种 —— 后两种需要 PolyScope 侧的坐标系/世界模型对象，脚本里写错只会得到
    控制器的一句运行期错误，因此**在这里明确拒绝**并说明原因，而不是把含糊的脚本发出去。

    ⚠️ 手册说明 OptiMove **不受 Motion Version 设置影响**，且只能与 movej/l、optimovej/l
    互相交融（从其它运动类型切入时机器人应处于静止）。
    """
    ip = str(p["ip"])
    kind = str(p.get("goal_type", "")).lower()
    a = _bounded_float(p.get("a", 0.3), "a", 0.0001, 1.0, "optimove 的加速度比例")
    v = _bounded_float(p.get("v", 0.3), "v", 0.0001, 1.0, "optimove 的速度比例")
    r = _nonneg_float(p.get("r", 0), "r", "optimove 的交融半径")
    frame = p.get("frame")
    if frame is not None:
        raise ValueError("optimove 的 frame（坐标系名/世界模型对象）需要 PolyScope 侧的对象，"
                         "本插件不支持：请不要传 frame，或改用 movej/movel 自行换算到基座系")
    if kind in ("j", "joint", "joints", "optimovej"):
        q = _vec(p, "goal", 6, "optimovej 的 goal（六关节角）")
        call = "optimovej(%s, a=%s, v=%s, r=%s)" % (_ur_list(q), _ur_number(a),
                                                    _ur_number(v), _ur_number(r))
        confirm = lambda: _movej_confirm(ip, q, _budget_ms(p))          # noqa: E731
        goal_desc = {"goal_type": "joints", "goal": q}
    elif kind in ("l", "pose", "linear", "optimovel"):
        pose = _vec(p, "goal", 6, "optimovel 的 goal（六维位姿）")
        call = "optimovel(p%s, a=%s, v=%s, r=%s)" % (_ur_list(pose), _ur_number(a),
                                                     _ur_number(v), _ur_number(r))
        confirm = lambda: _movel_confirm(ip, pose, _budget_ms(p))       # noqa: E731
        goal_desc = {"goal_type": "pose", "goal": pose}
    else:
        raise ValueError('optimove 的 goal_type 必须是 "joints"（optimovej）或 "pose"（optimovel），'
                         "收到 %r" % kind)
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "optimove")
    if not _send_program(robot, call + "\n"):
        return err("optimove 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    ok_flag, msg = confirm()
    data = {"ok": ok_flag, "command": call, "a": a, "v": v, "r": r, "ip": ip}
    data.update(goal_desc)
    return ok({"message": "命令 %s 已发送（a/v 是能力比例，不是物理单位），%s" % (call, msg),
               "data": data})


def op_motion_version(p):
    """读取/设置 Motion Version（Poly5 14.x、PolyScope X 14.x），以及 jerk 增益。

    - 版本 1：与旧版 PolyScope 相同的运动剖面；
    - 版本 2：规划时把速度/加速度**钳到硬件上限**，交融半径重叠时**动态收缩**而不是跳过该段
      （版本 1 在交融重叠时会跳过整段运动并给 "Overlapping Blends" 警告）。

    ⚠️ 手册明确：**新机型与 PolyScope X 只支持版本 2**，而 CB3（3.x）没有这个设置。

    `jerk_gain_scaling`（PolyScope X 15.23/15.24）只作用于**jerk 受限**的剖面 ——
    手册点名的正是 `movej[motion_version>=2]`、`movel[...>=2]`、`optimovej`、`optimovel`，
    也就是 `ur_move_optimized` 与版本 2 的运动。范围 [0.01, 1.0]，默认 1.0；
    手册建议"需要更平滑的运动就调小"，并把它写在程序开头（值会保留到下次设置或重启）。
    """
    ip = str(p["ip"])
    robot, _ = ensure_connected(ip)
    version = p.get("version")
    jerk = None
    if p.get("jerk_gain_scaling") is not None:
        jerk = _bounded_float(p["jerk_gain_scaling"], "jerk_gain_scaling", 0.01, 1.0,
                              "jerk 增益（1.0 = 默认，越小越平滑）")
    if version is None and jerk is None:
        raise ValueError("至少要给出 version 或 jerk_gain_scaling 之一")
    applied = {}
    if version is not None:
        ver = _bounded_int(version, "version", 1, 2, "Motion Version")
        if not _realtime_send(robot, "motion_version_set(%d)\n" % ver):
            return err("motion_version_set 未能送达控制器：%s" % _last_send_failure(robot),
                       "SEND_FAILED")
        applied["version"] = ver
    if jerk is not None:
        if not _realtime_send(robot, "jerk_gain_scaling_set(%s)\n" % _ur_number(jerk)):
            return err("jerk_gain_scaling_set 未能送达控制器：%s"
                       % _last_send_failure(robot), "SEND_FAILED")
        applied["jerk_gain_scaling"] = jerk
    return ok_unverified({"message": "已设置 %s（这两个设置都没有回读通道，返回值只报告本次设置值）" % applied,
               "data": {"applied": applied, "readback_supported": False, "ip": ip}})


def op_get_freedrive_status(p):
    """读取 freedrive（手动拖动）当前姿态的**奇异点接近程度**（PolyScope X 15.20）。

    ⚠️ 这个函数的返回值**不是**"freedrive 开着还是关着"，而是当前姿态离奇异点多远：
    `0` = 正常、`1` = 接近奇异点、`2` = 太接近（拖动阻力明显变大）。
    手册原话：受限 freedrive（`freedrive_mode(freeAxes=...)`）在奇异点附近可用性下降，
    因此这个值用来**建议操作员换一条路径或改用不受限的 freedrive**。

    它需要控制器能执行 URScript 表达式并回读寄存器，因此会向输出寄存器写一个值
    （默认 21 号 int 寄存器，旧值会被覆盖）；读不到时如实报失败并说明可能原因。
    """
    ip = str(p["ip"])
    robot, _ = ensure_connected(ip)
    register = _bounded_int(p.get("register", 21), "register", 0, 23,
                            "回读用的 int 输出寄存器编号")

    # 两步走，才能区分「固件不支持」与「真的读到 0」：
    #   第一步：写一个与旧值不同的 token，确认 **该寄存器可被这段脚本改写**（通道通）；
    #   第二步：让 get_freedrive_status() 去覆盖它。若固件不认识该函数，整段脚本会编译失败，
    #           寄存器就停在 token 上 ⇒ 如实报「不支持/未执行」，而不是把陈旧的 0 说成"正常"。
    token = _sentinel_token(_read_int_register(ROBOT_MODELS.get(ip), register))
    setter = ("def ur_write_token():\n"
              "  write_output_integer_register(%d, %d)\n"
              "end\nur_write_token()\n" % (register, token))
    if not _send_program(robot, setter):
        return err("get_freedrive_status 通道探测脚本未能送达控制器：%s"
                   % _last_send_failure(robot), "SEND_FAILED")
    deadline = time.time() + 2.0
    while time.time() < deadline:
        if _read_int_register(ROBOT_MODELS.get(ip), register) == token:
            break
        time.sleep(0.1)
    else:
        return err("未能写入哨兵值（寄存器 output_int_register_%d 上一直看不到 %d）⇒ 控制器没有执行"
                   "这段脚本，可能是未处于远程控制模式" % (register, token), "NOT_EXECUTED",
                   {"register": register, "token": token, "ip": ip})

    program = ("def ur_get_freedrive_status():\n"
               "  write_output_integer_register(%d, get_freedrive_status())\n"
               "end\nur_get_freedrive_status()\n" % register)
    if not _send_program(robot, program):
        return err("get_freedrive_status 脚本未能送达控制器：%s"
                   % _last_send_failure(robot), "SEND_FAILED")
    deadline = time.time() + 2.0
    raw = token
    while time.time() < deadline:
        raw = _read_int_register(ROBOT_MODELS.get(ip), register)
        if raw is not None and raw != token:
            break
        time.sleep(0.1)
    if raw is None or raw == token:
        return err("该控制器**不支持** get_freedrive_status()：脚本没有执行，寄存器仍停在通道探测用的"
                   "哨兵值 %d（PolyScope 版本可能低于 5.24；这不是「读到 0 = 正常」）"
                   % token, "UNSUPPORTED",
                   {"register": register, "token": token, "observed": raw, "ip": ip})
    code = int(raw)
    names = {0: "正常（离奇异点足够远）", 1: "接近奇异点", 2: "太接近奇异点（拖动阻力明显）"}
    return ok({"message": "freedrive 姿态状态：%d —— %s%s"
                          % (code, names.get(code, "未知"), "" if code == 0 else "；建议换路径或改用不受限 freedrive"),
               "data": {"status": code, "status_name": names.get(code, "unknown"),
                        "supported": True, "register": register, "ip": ip}})


def op_get_tool_telemetry(p):
    """读取工具端电气遥测：工具电压/电流、I/O 电流、工具模式（全部来自 RTDE 数据流）。

    ⚠️ 这三个访问器在 vendored `robotModel.py` 里都是 `NotImplementedError` 桩，且它们的
    RTDE 字段以前**不在接收配方里** —— 两个原因叠加，旧实现必然返回全 null（看起来像
    "控制器没数据"，其实是插件根本没读）。现在字段已加进配方，这里直接读 `dataDir`。

    ⚠️ 单位：UR RTDE 文档把 `tool_output_voltage` 定义为 **INT32**（不是浮点伏特），
    所以这里原样回报，不擅自换算；需要物理量时请按控制器文档解释该整数。
    """
    ip = str(p["ip"])
    _, model = ensure_connected(ip)

    def num(name, accessor=None):
        """优先用访问器（某些控制器/测试替身实现了它），失败或为 None 时回落到原始 RTDE 字段。"""
        if accessor is not None:
            try:
                value = getattr(model, accessor)()
                if value is not None:
                    return float(value)
            except Exception:
                pass
        value = _rtde_field(model, name)
        if value is None:
            return None
        try:
            return float(value)
        except Exception:
            return None

    data = {
        "tool_output_voltage": num("tool_output_voltage", "ToolOutputVoltage"),
        "tool_output_current": num("tool_output_current", "ToolOutputCurrent"),
        "io_current": num("io_current", "IoCurrent"),
        "tool_mode": num("tool_mode"),
        "ip": ip,
    }
    missing = [name for name in ("tool_output_voltage", "tool_output_current", "io_current")
               if data[name] is None]
    message = "工具电气遥测读取成功（来自 RTDE 数据流）"
    if missing:
        message += ("；以下字段读不到：%s。若控制器固件未提供该 RTDE 字段，它会一直是 null —— "
                    "这表示「该控制器不支持」，而不是「读取出错」" % "、".join(missing))
    return ok({"message": message, "data": data})


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
    """读取传送带编码器 tick —— **并且自证这段脚本真的被执行过**。

    为什么必须自证（事故复盘）：`get_conveyor_tick_count()` 是一段 URScript，它可能因为
    任何原因整段被控制器**在加载期拒收**（用了该固件不认识的函数名、不在远程控制模式…）。
    拒收时**一行都不会执行**，而且不会置"程序执行错误"标志 —— `waitRobotIdleOrStopFlag()`
    什么也看不到。旧实现于是照样回读 `output_double_register_0`，把**一个从没人写过的值**
    当成 tick 报出去。这个事故真的发生过：脚本里的函数名被"修正"成不存在的
    `write_output_double_register`（把 RTDE 字段名当成了 URScript 函数名），
    于是 `ur_get_conveyor` 长期静默返回 0，且没有任何报错。

    结论的三种结局必须分开报：
      - 回读到**结束**哨兵 ⇒ 脚本跑完了，寄存器里的 tick 可信；
      - 只回读到**起始**哨兵 ⇒ 通道通、脚本开始了，但没走到末尾 ⇒ `get_conveyor_tick_count()`
        在该固件上很可能不可用/中途报错 ⇒ **不给** tick 值；
      - 两个都没回读到 ⇒ 整段脚本没被执行 ⇒ **不给** tick 值，并说明最可能的原因。

    哨兵用 **int** 寄存器、载荷用 **double** 寄存器：两个不同的寄存器家族，这样"载荷那条
    写路径坏了"不会连哨兵一起带走 —— 否则三种结局会退化成"什么都没发生"，又把原因藏起来。
    """
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)
    index = _bounded_int(p.get("register", CONVEYOR_SENTINEL_REGISTER), "register", 0, 23,
                         "哨兵用的 int 输出寄存器编号")
    payload_index = _bounded_int(p.get("payload_register", CONVEYOR_PAYLOAD_REGISTER),
                                 "payload_register", 0, 23,
                                 "写 tick 用的 double 输出寄存器编号")

    # 第一步：通道探测。仅当这一步成功，后面"脚本没执行"才能归因到脚本本身。
    probe_token = _sentinel_token(_read_int_register(model, index))
    probe = ("def ur_write_conveyor_probe():\n"
             "  write_output_integer_register(%d, %d)\n"
             "end\nur_write_conveyor_probe()\n" % (index, probe_token))
    if not _send_program(robot, probe):
        return err("传送带通道探测脚本未能送达控制器：%s" % _last_send_failure(robot),
                   "SEND_FAILED", {"ip": ip})
    deadline = time.time() + SEND_SCRIPT_VERIFY_TIMEOUT_S
    while time.time() < deadline:
        if _read_int_register(model, index) == probe_token:
            break
        time.sleep(0.1)
    else:
        return err("控制器没有执行探测脚本（output_int_register_%d 上一直看不到哨兵值 %d）⇒ "
                   "它可能未处于远程控制模式，或整段 URScript 被静默丢弃。此时**无法**给出传送带 tick，"
                   "也不会回读一个陈旧值来冒充它。" % (index, probe_token),
                   "NOT_EXECUTED",
                   {"register": index, "token": probe_token, "ip": ip})

    # 第二步：载荷 + 首尾哨兵。`finish` 必须同时避开 probe 与 start —— 三个 token 互不相同
    # 是这套判定成立的前提（否则"没执行"会被读成"执行完毕"）。
    start_token = _sentinel_token(probe_token)
    finish_token = _sentinel_token(start_token, probe_token)
    payload = ("def ur_get_conveyor_tick_count():\n"
               "  write_output_integer_register(%d, %d)\n"
               "  write_output_float_register(%d, get_conveyor_tick_count())\n"
               "  write_output_integer_register(%d, %d)\n"
               "end\nur_get_conveyor_tick_count()\n"
               % (index, start_token, payload_index, index, finish_token))
    if not _send_program(robot, payload):
        return err("get_conveyor_tick_count 脚本未能送达控制器：%s" % _last_send_failure(robot),
                   "SEND_FAILED", {"ip": ip})

    deadline = time.time() + SEND_SCRIPT_VERIFY_TIMEOUT_S
    observed = probe_token
    started = False
    while time.time() < deadline:
        observed = _read_int_register(model, index)
        if observed == finish_token:
            # 走到末尾**必然**开始过。轮询间隔（0.1s）可能整个错过中间态，所以这里显式置位 ——
            # 否则会报出 "verified=true 但 started=false" 这种自相矛盾的证据组合。
            started = True
            break
        if observed == start_token:
            started = True
        time.sleep(0.1)

    sentinel = {"register": index, "payload_register": payload_index,
                "probe_token": probe_token, "start_token": start_token,
                "finish_token": finish_token, "observed": observed, "started": started}

    if observed != finish_token:
        if started:
            return err("传送带读取脚本**开始执行了但没走到末尾**（起始哨兵 %d 已回读，结束哨兵 %d 没出现）⇒ "
                       "`get_conveyor_tick_count()` 在该控制器上很可能不可用、或中途报错中止。"
                       "因此**不给** tick 值。" % (start_token, finish_token),
                       "UNSUPPORTED", dict(sentinel, ip=ip))
        return err("传送带读取脚本**根本没有执行**：哨兵仍停在通道探测值 %d（起始与结束哨兵都没出现）⇒ "
                   "整段脚本在控制器侧被拒（最常见原因：脚本里用了该固件不认识的函数，"
                   "例如把 RTDE 字段名 `output_double_register` 当成了 URScript 函数名）。"
                   "此时**不给** tick 值 —— 旧实现在这种情况下会把一个从没被写过的寄存器读成 tick。"
                   % probe_token,
                   "NOT_EXECUTED", dict(sentinel, ip=ip))

    tick = _read_double_register(model, payload_index)
    if tick is None:
        return err("脚本已执行完毕（结束哨兵已回读），但 output_double_register_%d 读不到值"
                   % payload_index, "READ_FAILED", dict(sentinel, ip=ip))
    return ok({"message": "传送带 tick：%s（脚本已在控制器上执行完毕，结束哨兵 %d 已回读）"
                          % (tick, finish_token),
               "data": {"tick_count": tick, "register": payload_index,
                        "sentinel": sentinel, "verified": True, "ip": ip}})


def op_set_conveyor_tick(p):
    """设置传送带编码器 tick —— **并且自己回读确认**。

    为什么不能只发不验（真机实测）：同族的 `op_get_conveyor` 早就有完整的三哨兵回读（probe → start →
    载荷 → finish），而这里以前只 `set_conveyor_tick_count()` 然后 `ok_unverified`。实测写入
    `tick_count=1234` 之后回读仍然是 **0**，而调用方只拿到一句"已设置传送带 tick=1234（未校验）" ——
    既不知道有没有生效，也不知道该去查什么（真正的原因通常是控制器没配置编码器/传送带）。

    所以这里复用**同一个**读取器自证：回读一致才 `verified: true`；不一致就明说**没有生效**并给出最可能
    的排查方向；连回读都失败时，把失败原因一起交出去，而不是含糊其辞。

    ★ 判据必须是 `"error"` 键，**不能**是 `"ok"`：`ok(data)` 是**恒等函数**（`return data`），信封里的
    `ok: true` 是 `main()` 序列化时才加上的 —— 所以 handler 之间传阅的结果字典里**根本没有 `"ok"` 键**，
    用 `.get("ok")` 判断"成功与否"会恒为假（本函数第一版就是这么写的，被"回读"这条路径自己抓出来了）。
    """
    ip = str(p["ip"])
    tick = int(p["tick_count"])
    res = int(p.get("absolute_encoder_resolution", 0))
    robot, _ = ensure_connected(ip)
    robot.set_conveyor_tick_count(tick, res)

    read_back = op_get_conveyor({"ip": ip})
    data = {"tick_count": tick, "ip": ip}
    if read_back.get("error") is not None:
        return ok_unverified({
            "message": "已下发传送带 tick=%s，但**回读失败**（%s）⇒ 无法确认是否生效"
                       % (tick, read_back.get("error") or read_back.get("code") or "未知原因"),
            "data": dict(data, read_back=None, read_back_error=read_back.get("error"),
                         read_back_code=read_back.get("code"))})
    observed = (read_back.get("data") or {}).get("tick_count")
    if observed == tick:
        return ok({
            "message": "已设置传送带 tick=%s，且**回读一致**（%s）" % (tick, observed),
            "data": dict(data, read_back=observed, verified=True)})
    return ok_unverified({
        "message": "已下发传送带 tick=%s，但**回读是 %s（不一致）⇒ 没有生效**。最常见原因：控制器未配置"
                   "编码器/传送带（URSim 默认如此），或该固件不接受 set_conveyor_tick —— 请先在 "
                   "PolyScope 的「安装 → 传送带跟踪」里配置编码器。" % (tick, observed),
        "data": dict(data, read_back=observed)})


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


# 下电 / 关机类命令的验证预算：命令生效后控制器会停止应答 dashboard，所以只能等状态位。
POWER_OFF_VERIFY_TIMEOUT_S = 8.0


def op_power_off(p):
    """机器人下电。⚠️ 会让机械臂失去刚性支撑。

    为什么不能只看 dashboard 的应答：`power off` 生效的瞬间控制器就**停止应答**（它正在断电），
    旧实现把"无应答"当成失败 ⇒ 真机上明明已下电却报「失败（控制器无应答）」的**假阴性**。
    现在以控制器自己的状态为准：等 RTDE `robot_status_bits` 的 PowerOn 位清零；等到了就报成功
    （附证据），等不到才报失败，并把看到的状态位交出来供复核。
    """
    ip = str(p["ip"])
    ensure_connected(ip)
    sent, resp = _dashboard_cmd(ip, "ur_power_off")
    reached, bits = _wait_robot_power(ip, want_on=False, timeout=POWER_OFF_VERIFY_TIMEOUT_S)
    if reached:
        return ok({"message": "机器人已下电（RTDE 的 PowerOn 位已清零%s）"
                              % ("；dashboard 未应答 —— 这正是断电时的预期行为，不是失败"
                                 if not sent else "；dashboard 应答：%s" % resp),
                   "data": {"power_on": False, "robot_status_bits": bits,
                            "dashboard_sent": sent, "dashboard_respond": resp, "ip": ip}})
    if sent and _dashboard_ok(resp):
        return ok({"message": "下电命令已被控制器接受（应答：%s），但 %.0fs 内没看到 PowerOn 位清零；"
                              "请用 ur_status 复核（状态位更新有延迟时也会这样）"
                              % (resp, POWER_OFF_VERIFY_TIMEOUT_S),
                   "data": {"power_on": None, "robot_status_bits": bits,
                            "dashboard_sent": sent, "dashboard_respond": resp, "ip": ip}})
    return err("下电失败：dashboard 未应答，且 %.0fs 内 RTDE 的 PowerOn 位仍为 1（应答：%s）"
               % (POWER_OFF_VERIFY_TIMEOUT_S, resp), "TIMEOUT",
               {"robot_status_bits": bits, "ip": ip})


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
    """关闭控制器（电源）。⚠️ 需要人工重新上电。

    与 `ur_power_off` 同理：控制器关机时不会给你一个"成功"应答，所以"无应答"不能算失败 ——
    这里把「命令已发出 + 之后再问一次 dashboard 已经不通」作为成功的**旁证**并明确标注为旁证。
    """
    ip = str(p["ip"])
    ensure_connected(ip)
    sent, resp = _dashboard_cmd(ip, "ur_shutdown")
    if sent and _dashboard_ok(resp):
        return ok({"message": "关闭控制器命令已被接受（应答：%s）；控制器将断开，需要人工重新上电" % resp,
                   "data": {"accepted": True, "dashboard_respond": resp, "ip": ip}})
    time.sleep(2.0)
    alive, alive_resp = _dashboard_cmd(ip, "ur_robotmode")
    if not alive:
        return ok({"message": "已发出关闭控制器命令；2s 后 dashboard 已不可达 —— 与关机行为一致"
                              "（旁证，不是确定性证据：%s）" % alive_resp,
                   "data": {"accepted": None, "dashboard_reachable": False,
                            "dashboard_respond": resp, "ip": ip}})
    return err("关闭控制器命令未生效：dashboard 仍可应答（%s / %s）" % (resp, alive_resp), "TIMEOUT",
               {"ip": ip})


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
    """读取速度倍率。

    ⚠️ 两个字段语义完全不同，旧实现只给了前者，于是"静止时读 0"看起来像"速度被压到 0"：
      - `speed_scaling`：控制器**实际**的倍率。**静止时控制器就报 0**，这是正常的。
      - `target_speed_fraction`：**请求**的倍率（速度滑块 / 程序里 `set_speed_slider` 的值）。
    判断"速度有没有被限制"请看 target_speed_fraction；判断"此刻跑多快"看运动中的 speed_scaling。
    """
    ip = str(p["ip"])
    _, model = ensure_connected(ip)

    def num(name):
        value = _rtde_field(model, name)
        try:
            return None if value is None else float(value)
        except Exception:
            return None

    actual = num("speed_scaling")
    target = num("target_speed_fraction")
    return ok({"message": ("实际速度倍率（speed_scaling）：%s；请求倍率（target_speed_fraction）：%s。"
                           "注意：speed_scaling 在**静止时**读 0 属正常（它反映的是「此刻实际」），"
                           "要判断速度是否被限制请看请求倍率。"
                           % (actual if actual is not None else "不可用",
                              target if target is not None else "不可用")),
               "data": {"speed_scaling": actual, "target_speed_fraction": target, "ip": ip}})


def _pose6(value, name):
    """校验 6 维数值（位姿或关节角）。不合法抛 `ValueError` —— main() 会把它映射成 BADARG。"""
    if not isinstance(value, (list, tuple)) or len(value) != 6:
        raise ValueError("%s 必须是 6 个数组成的数组（位姿 [x,y,z,rx,ry,rz] 或 6 个关节角）" % name)
    numbers = []
    for item in value:
        try:
            number = float(item)
        except (TypeError, ValueError):
            raise ValueError("%s 里有非数值元素：%r" % (name, item))
        if number != number or number in (float("inf"), float("-inf")):
            raise ValueError("%s 里有非有限数：%r" % (name, item))
        numbers.append(number)
    return numbers


def check_pose_script(pose, qnear, *, start_token, stage1_token, stage2_token, finish_token):
    """生成"位姿预检"用的 URScript（**纯函数**，离线可单测）。

    ★ 为什么必须把布尔值先落到 `local`：URScript 强类型，`write_output_integer_register(n, <bool>)`
    会让控制器**在该行抛错中止**（真机实测：起始哨兵已回读、结束哨兵永不到来、整数寄存器留下 0）。
    于是 `is_within_safety_limits` 的答案既没被写下、`get_inverse_kin` 也没被调用，而工具把那个 0
    读成"不在安全限值内"、把"没有结束哨兵"推断成"IK 解不出" ⇒ 对**机器人此刻正站着的位姿**报假阴性。
    改成先 `local within = …` 再 `if/else` 写 1/0 之后，同一台控制器上完全正常。

    阶段标记（`CHECK_POSE_STAGE_REGISTER`）让"半途中止"可以归因：写完限值答案打 `stage1`、
    IK 解完并写完关节角打 `stage2`。标记值由 `start_token` 链式派生（每个都把前一个喂进去），
    所以上一次运行留下的残值不会冒充本次的标记。
    """
    index = DEFAULT_SENTINEL_REGISTER
    pose_literal = "p[%s]" % ", ".join("%.10g" % x for x in pose)
    qnear_arg = "" if qnear is None else ", [%s]" % ", ".join("%.10g" % x for x in qnear)
    ik_writes = "\n".join(
        "  write_output_float_register(%d, q_sol[%d])" % (register, axis)
        for axis, register in enumerate(CHECK_POSE_IK_REGISTERS)
    )
    return ("def dsh_check_pose():\n"
            "  write_output_integer_register(%d, %d)\n"
            "  local p_target = %s\n"
            "  local within = is_within_safety_limits(p_target)\n"
            "  if within:\n"
            "    write_output_integer_register(%d, 1)\n"
            "  else:\n"
            "    write_output_integer_register(%d, 0)\n"
            "  end\n"
            "  write_output_integer_register(%d, %d)\n"
            "  local q_sol = get_inverse_kin(p_target%s)\n"
            "%s\n"
            "  write_output_integer_register(%d, %d)\n"
            "  write_output_integer_register(%d, %d)\n"
            "end\ndsh_check_pose()\n"
            % (index, start_token, pose_literal,
               CHECK_POSE_LIMITS_REGISTER, CHECK_POSE_LIMITS_REGISTER,
               CHECK_POSE_STAGE_REGISTER, stage1_token,
               qnear_arg, ik_writes,
               CHECK_POSE_STAGE_REGISTER, stage2_token,
               index, finish_token))


def op_check_pose(p):
    """**动之前先问**：这个位姿在安全限值内吗？逆运动学解得出吗？

    为什么值得单独一个工具：模型很容易给出"看起来合理但够不到"的位姿（超出臂展、超出关节限位、
    或落在控制器配置的安全限值之外）。此前唯一的反馈来自"指令下发之后控制器报错"—— 而运动指令
    是**会真的动**的。事前问一句的成本，远低于事后撞一次。

    实现走"发 URScript → 写输出寄存器 → 首尾哨兵回读"。**不能**用 `urScript.py` 的
    `get_inverse_kin` 访问器：那些访问器依赖 RTDE **输入**字段，而本插件刻意没有 send 配方
    （见 `rtdeConfiguration.xml` 的说明），它们在这里根本不可用。写 double 寄存器用的是仓库里
    已被传送带路径验证过的 `write_output_float_register`。

    三种结局如实分开（与 `op_get_conveyor` 同一套判据）：
      - 回读到**结束**哨兵 ⇒ 两个答案都有；
      - 回读到**阶段标记 = stage1**（限值那步做完了）而没到结束哨兵 ⇒ 控制器在执行
        `get_inverse_kin` 时抛了（通常就是不可达/超关节限位）⇒ `reachable = False`；
      - **连阶段标记 stage1 都没看到** ⇒ 脚本在"限值"这一步就没走完（该固件不接受该表达式，
        或本地/示教器模式下 URScript 被静默丢弃）⇒ 按 NOT_EXECUTED 报错，**不给**可达性结论；
      - **连起始哨兵都没有** ⇒ 通道根本没执行 ⇒ NOT_EXECUTED。

    ★ 真机教训（本工具曾经因此报**假阴性**）：URScript 是**强类型**的，
    `write_output_integer_register(n, is_within_safety_limits(p))` 这种"布尔值直接写整数寄存器"
    会让控制器**在该行抛错中止**；脚本既没写下限值答案、也走不到 IK，而回读到的整数寄存器是 0，
    于是"机器人此刻正站着的位姿"被报成"不在安全限值内 + IK 解不出"。
    所以布尔值必须先落到 `local`，再用 `if/else` 写成整数（见 `check_pose_script()`）。
    """
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)
    pose = _pose6(p.get("pose"), "pose")
    qnear = None if p.get("qnear") is None else _pose6(p.get("qnear"), "qnear")

    index = DEFAULT_SENTINEL_REGISTER
    # 第一步：通道探测。只有这一步成功，后面"脚本没执行"才能归因到脚本本身。
    probe_token = _sentinel_token(_read_int_register(model, index))
    probe = ("def dsh_check_pose_probe():\n"
             "  write_output_integer_register(%d, %d)\n"
             "end\ndsh_check_pose_probe()\n" % (index, probe_token))
    if not _send_program(robot, probe):
        return err("位姿预检的通道探测脚本未能送达控制器：%s" % _last_send_failure(robot),
                   "SEND_FAILED", {"ip": ip})
    deadline = time.time() + CHECK_POSE_TIMEOUT_S
    while time.time() < deadline:
        if _read_int_register(model, index) == probe_token:
            break
        time.sleep(0.1)
    else:
        return err("控制器没有执行探测脚本（output_int_register_%d 上一直看不到哨兵值 %d）⇒ "
                   "它可能未处于远程控制模式（本地/示教器模式下 URScript 会被静默丢弃），"
                   "或该固件不支持 is_within_safety_limits。此时**无法**给出可达性结论，"
                   "也不会拿寄存器里的陈旧值冒充它。" % (index, probe_token),
                   "NOT_EXECUTED", {"register": index, "token": probe_token, "ip": ip})

    # 第二步：限值 + IK + 阶段标记 + 首尾哨兵。四个 token 按链式派生（每个都把前一个喂进去），
    # 因此互不相同 —— 这是整套判定成立的前提。
    start_token = _sentinel_token(probe_token)
    stage1_token = _sentinel_token(start_token, index)
    stage2_token = _sentinel_token(stage1_token, index)
    finish_token = _sentinel_token(stage2_token, index)
    script = check_pose_script(pose, qnear, start_token=start_token, stage1_token=stage1_token,
                               stage2_token=stage2_token, finish_token=finish_token)
    if not _send_program(robot, script):
        return err("位姿预检脚本未能送达控制器：%s" % _last_send_failure(robot),
                   "SEND_FAILED", {"ip": ip})

    deadline = time.time() + CHECK_POSE_TIMEOUT_S
    observed = probe_token
    while time.time() < deadline:
        observed = _read_int_register(model, index)
        if observed == finish_token:
            break
        time.sleep(0.05)

    limits_raw = _read_int_register(model, CHECK_POSE_LIMITS_REGISTER)
    stage_raw = _read_int_register(model, CHECK_POSE_STAGE_REGISTER)
    solved = [_read_double_register(model, register) for register in CHECK_POSE_IK_REGISTERS]
    ik_solution = solved if all(value is not None for value in solved) else None
    # ★ 阶段标记是"限值答案可信"的**前提**：脚本在第一句就中止时该寄存器读到的是 0，
    #   把 0 当答案就是假阴性（这正是本工具曾经的 bug）。没有标记就不给结论。
    limits_known = stage_raw in (stage1_token, stage2_token)
    within = bool(limits_raw) if limits_known else None

    if observed == finish_token:
        return ok({
            "message": ("位姿预检完成：在安全限值内 = %s；逆运动学%s。"
                        % (within, "可解" if ik_solution is not None else "**解不出**（位姿不可达或超出关节限位）")),
            "data": {"ip": ip, "within_safety_limits": within, "reachable": ik_solution is not None,
                     "joint_solution": ik_solution, "pose": pose,
                     "registers": {"sentinel": index, "limits": CHECK_POSE_LIMITS_REGISTER,
                                   "stage": CHECK_POSE_STAGE_REGISTER,
                                   "ik": list(CHECK_POSE_IK_REGISTERS)}},
        })

    if stage_raw == stage1_token:
        # 阶段标记证明"限值那步确实跑完了"（因此 within 有效），而结束哨兵缺失
        # ⇒ 中止点就在其后的 get_inverse_kin。这条推论现在有证据，不再是猜。
        return ok({
            "message": ("位姿预检：在安全限值内 = %s；但**逆运动学解不出**（控制器在执行 "
                        "get_inverse_kin 时中止，脚本停在阶段标记 1 与结束哨兵之间）⇒ "
                        "该位姿通常不可达或超出关节限位。" % within),
            "data": {"ip": ip, "within_safety_limits": within, "reachable": False,
                     "joint_solution": None, "pose": pose,
                     "note": "依据：阶段标记寄存器已读到 stage1（说明 is_within_safety_limits 那一步"
                             "跑完了、限值答案有效），而结束哨兵缺失 ⇒ 中止点在 get_inverse_kin。",
                     "registers": {"sentinel": index, "limits": CHECK_POSE_LIMITS_REGISTER,
                                   "stage": CHECK_POSE_STAGE_REGISTER,
                                   "ik": list(CHECK_POSE_IK_REGISTERS)}},
        })

    return err("位姿预检：脚本**在「安全限值」这一步就没走完**（阶段标记寄存器 = %s，既不是 %s 也不是 %s）"
               "⇒ 无法给出可达性结论。可能是该固件不接受 is_within_safety_limits，或控制器未处于"
               "远程控制模式（URScript 被静默丢弃）。寄存器里读到的 0 **不会**被当成「不在安全限值内」。"
               % (stage_raw, stage1_token, stage2_token),
               "NOT_EXECUTED", {"register": index, "observed": observed, "stage": stage_raw,
                                "start": start_token, "stage1": stage1_token,
                                "finish": finish_token, "ip": ip})


def op_set_speed_scaling(p):
    """设置**速度倍率（速度滑块）**：URScript `set_speed_slider(f)`。

    为什么值得有：这是最贴合直觉的"安全旋钮" —— 交出一段精细动作之前把整体速度压下来，
    比逐条去改每条运动的 a/v 可靠得多。

    ⚠️ 与那 12 个"没有回读通道"的设置类 op 不同，这一个**有**回读通道：接收配方里的
    `target_speed_fraction` 就是速度滑块的目标值。所以这里**不**套 `ok_unverified()`，而是
    设置后回读校验：一致才报 `verified: true`；不一致就如实说"未核实"，绝不假装已生效。
    ⚠️ "set_speed_slider ⇒ target_speed_fraction" 这条映射**未经真机验证**（与
    `set_conveyor_tracking` 同级别的诚实标注），因此一并回报 `hardware_verified: false`。
    """
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)
    try:
        fraction = float(p.get("fraction"))
    except (TypeError, ValueError):
        raise ValueError("fraction 必须是 0.0-1.0 的数（0 = 停住，1 = 满速）")
    if not (0.0 <= fraction <= 1.0):
        raise ValueError("fraction 必须在 [0.0, 1.0] 之间，实得 %r" % (p.get("fraction"),))

    before = _rtde_field(model, "target_speed_fraction")
    if not _realtime_send(robot, "set_speed_slider(%.10g)\n" % fraction):
        return err("set_speed_slider 未能送出：%s" % _last_send_failure(robot),
                   "SEND_FAILED", {"ip": ip})

    deadline = time.time() + SPEED_READBACK_TIMEOUT_S
    observed = None
    while True:
        observed = _rtde_field(model, "target_speed_fraction")
        matched = observed is not None and abs(float(observed) - fraction) <= SPEED_READBACK_TOLERANCE
        if matched or time.time() >= deadline:
            break
        time.sleep(0.05)
    matched = observed is not None and abs(float(observed) - fraction) <= SPEED_READBACK_TOLERANCE

    if matched:
        message = ("速度倍率已设为 %.3f（回读 target_speed_fraction = %.3f，**已核实**）。"
                   "⚠️ 该映射未经真机验证。" % (fraction, float(observed)))
    else:
        message = ("已下发 set_speed_slider(%.3f)，但 %.1fs 内回读的 target_speed_fraction 是 %s"
                   "（与请求值不一致）⇒ **未核实**：可能被正在运行的程序覆盖、被速度滑块限制策略"
                   "接管，或该固件不支持。不要把它当作已生效。"
                   % (fraction, SPEED_READBACK_TIMEOUT_S,
                      "不可用" if observed is None else ("%.3f" % float(observed))))
    return ok({"message": message,
               "data": {"ip": ip, "requested": fraction,
                        "target_speed_fraction_before": None if before is None else float(before),
                        "target_speed_fraction": None if observed is None else float(observed),
                        "verified": matched, "hardware_verified": False}})


# 示教器文本（弹窗 / 日志）的长度上限：那是给人看一眼的提示，不是放长文的地方。
DASHBOARD_TEXT_MAX_CHARS = 300


def _dashboard_text(value, name):
    """校验要送进 dashboard **命令行**的文本。

    ⚠️ 这是注入防线。dashboard 的命令是**按行**解析的（`dashboard.py` 直接
    `'popup ' + popupText + '\\n'`），因此文本里一旦有换行，后半截会被当成**另一条 dashboard
    命令**执行 —— `"x\\nshutdown"` 就是一次关机注入。所以这里**拒绝**，而不是悄悄替换成空格：
    调用方应当知道自己的文本被拦下了。
    """
    if not isinstance(value, str) or value.strip() == "":
        raise ValueError("%s 必须是非空字符串" % name)
    if len(value) > DASHBOARD_TEXT_MAX_CHARS:
        raise ValueError("%s 超过 %d 字符上限（示教器弹窗/日志不是用来看长文的）"
                         % (name, DASHBOARD_TEXT_MAX_CHARS))
    for bad, why in (("\n", "换行"), ("\r", "回车")):
        if bad in value:
            raise ValueError(
                "%s 里不得含%s —— dashboard 按行解析命令，换行会注入额外的 dashboard 命令"
                "（例如在弹窗/日志之后再跟一句 shutdown）" % (name, why))
    return value


def op_popup_message(p):
    """在示教器上弹一条消息（dashboard `popup <text>`）。

    人机协作里最缺的一环：让机器人"开口"告诉现场下一步要做什么（"请取下工件"、
    "即将移动到维护位"）。⚠️ 这是**模态**提示框，要现场有人点掉；它不会让机械臂运动，
    因此**不受运动审批门禁**。同一时刻面板上只显示一个弹窗，要换内容先 `ur_close_popup`。
    """
    ip = str(p["ip"])
    text = _dashboard_text(p.get("text"), "text")
    ok_flag, resp = _dashboard_cmd_args(ip, "ur_popup", text)
    if not ok_flag:
        return err("示教器弹窗命令没有得到控制器应答（%s）。可能是 dashboard 服务未启用，"
                   "或该固件不支持这条命令。" % (resp or "无应答"), "NOT_EXECUTED", {"ip": ip})
    return ok({"message": "已在示教器上弹出消息（控制器应答：%s）。⚠️ 这是模态提示框，需要现场点掉。"
               % resp, "data": {"ip": ip, "text": text, "respond": resp}})


def op_close_popup(p):
    """关闭示教器上的弹窗（dashboard `close popup`）。"""
    ip = str(p["ip"])
    ok_flag, resp = _dashboard_cmd(ip, "ur_close_popup")
    if not ok_flag:
        return err("关闭弹窗没有得到控制器应答（%s）。可能当前压根没有弹窗，或 dashboard 服务不可用。"
                   % (resp or "无应答"), "NOT_EXECUTED", {"ip": ip})
    return ok({"message": "已请求关闭示教器弹窗（控制器应答：%s）。" % resp,
               "data": {"ip": ip, "respond": resp}})


def op_add_log(p):
    """往机器人的**日志历史**里写一条消息（dashboard `addToLog <text>`）。

    ⚠️ 它会**留在控制器的日志里**（操作员在示教器的日志页能看到）—— 这正是它有用的地方：
    出了问题能把"当时是谁让它做了什么"对上。所以**不要**把密钥、口令之类不该留痕的东西写进去。
    """
    ip = str(p["ip"])
    text = _dashboard_text(p.get("text"), "text")
    ok_flag, resp = _dashboard_cmd_args(ip, "ur_addToLog", text)
    if not ok_flag:
        return err("写日志命令没有得到控制器应答（%s）。可能是 dashboard 服务未启用，"
                   "或该固件不支持这条命令。" % (resp or "无应答"), "NOT_EXECUTED", {"ip": ip})
    return ok({"message": "已把消息写进机器人日志（控制器应答：%s）。⚠️ 这条消息会留在控制器日志里。"
               % resp, "data": {"ip": ip, "text": text, "respond": resp}})


# ---------------------------------------------------------------------------
# Modbus（外部 PLC / 现场总线）
#
# ⚠️ vendored 的 `urScript.py` 里那八个 `modbus_*` 方法**全是桩**
# （逐个 `raise NotImplementedError('Function Not yet implemented')`），**没有实现可复用** ——
# 所以这里只能自己拼 URScript 发出去（与 `ur_check_pose` 同一条路）。
#
# ⚠️ 诚实边界：Modbus 的写类命令**没有应答**（手册原话：`send custom command`
# "cannot be used to request data, since the response will not be received"）。因此这些工具能证明的
# 只有"这段 URScript 确实在控制器上跑完了"（首尾哨兵）。它**不能**证明 PLC 收到了，更不能证明
# 现场设备动了 —— 返回值里用 `fieldbus_confirmed: false` 把这条边界写死。
# ---------------------------------------------------------------------------

MODBUS_PAYLOAD_REGISTER = 18
MODBUS_SIGNAL_NAME_RE = re.compile(r"^[A-Za-z0-9_.\- ]{1,64}$")
MODBUS_IP_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")


def _modbus_text(value, name):
    """校验 Modbus 信号名 —— 它会**进 URScript 字符串字面量**，所以必须挡住引号与换行。

    ⚠️ 注入防线（与 dashboard 那条同族）：名为 `a", 0)` + 换行 + `shutdown()` 的信号名能把任意
    URScript 塞进控制器。信号名在 UR 里本来就是字母/数字/下划线/点/连字符/空格，所以这里用
    **白名单**，而不是试图转义。
    """
    if not isinstance(value, str) or not MODBUS_SIGNAL_NAME_RE.match(value):
        raise ValueError("%s 只允许字母/数字/下划线/点/连字符/空格，长度 1-64（实得 %r）。"
                         "信号名会被拼进 URScript 字符串字面量，因此用白名单挡注入。" % (name, value))
    return value


def _modbus_ip(value, name):
    """校验 IPv4 字符串（同样会进 URScript 字面量）。"""
    if not isinstance(value, str) or not MODBUS_IP_RE.match(value):
        raise ValueError("%s 必须是 IPv4 点分十进制字符串，例如 192.168.1.10（实得 %r）" % (name, value))
    for part in value.split("."):
        if int(part) > 255:
            raise ValueError("%s 的每一段必须在 0-255 之间：%s" % (name, value))
    return value


def _modbus_int(value, name, low, high):
    """校验整数并给出**带范围**的报错（模型能据此自己改）。"""
    if isinstance(value, bool) or not isinstance(value, int):
        try:
            value = int(value)
        except (TypeError, ValueError):
            raise ValueError("%s 必须是 %d-%d 的整数（实得 %r）" % (name, low, high, value))
    if not low <= value <= high:
        raise ValueError("%s 必须在 %d-%d 之间（实得 %r）" % (name, low, high, value))
    return value


def _modbus_byte_list(value, name):
    """校验字节数组（`send custom command` 的 data）。"""
    if not isinstance(value, (list, tuple)) or not value:
        raise ValueError("%s 必须是非空的字节数组，例如 [17, 32, 2, 88]（实得 %r）" % (name, value))
    if len(value) > 64:
        raise ValueError("%s 最多 64 个字节（实得 %d）" % (name, len(value)))
    return [_modbus_int(item, "%s[%d]" % (name, index), 0, 255) for index, item in enumerate(value)]


def _run_sentinel_script(robot, model, call_lines, call_name, *, payload_register=None,
                         index=DEFAULT_SENTINEL_REGISTER, timeout=SEND_SCRIPT_VERIFY_TIMEOUT_S):
    """发一段"首尾带哨兵"的 URScript，并把三种结局如实分开。

    Returns `(outcome, info)`，outcome ∈ `"executed"` / `"partial"` / `"not_executed"`：
      - 回读到**结束**哨兵 ⇒ executed：脚本确实在控制器上跑到了末尾；
      - 只回读到**起始**哨兵 ⇒ partial：开始执行了但没跑完，多半在中间那句被控制器拒绝；
      - 连起始哨兵都没有 ⇒ not_executed：未处于远程控制模式，或整段脚本被静默丢弃。
    `payload_register` 非空时，调用方应在 `call_lines` 里把结果写进该 double 寄存器（结束哨兵之前）。
    """
    probe_token = _sentinel_token(_read_int_register(model, index))
    probe = ("def dsh_modbus_probe():\n"
             "  write_output_integer_register(%d, %d)\n"
             "end\ndsh_modbus_probe()\n" % (index, probe_token))
    if not _send_program(robot, probe):
        return "not_executed", {"reason": "通道探测脚本未能送达控制器：%s" % _last_send_failure(robot)}
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _read_int_register(model, index) == probe_token:
            break
        time.sleep(0.1)
    else:
        return "not_executed", {
            "reason": "控制器没有执行探测脚本（output_int_register_%d 上看不到哨兵 %d）⇒ 它可能未处于"
                      "远程控制模式（本地/示教器模式下 URScript 会被静默丢弃）。" % (index, probe_token)}

    start_token = _sentinel_token(probe_token)
    finish_token = _sentinel_token(start_token, probe_token)
    lines = ["def %s():" % call_name,
             "  write_output_integer_register(%d, %d)" % (index, start_token)]
    lines += ["  " + line for line in call_lines]
    lines.append("  write_output_integer_register(%d, %d)" % (index, finish_token))
    lines += ["end", "%s()" % call_name]
    if not _send_program(robot, "\n".join(lines) + "\n"):
        return "not_executed", {"reason": "脚本未能送达控制器：%s" % _last_send_failure(robot)}

    deadline = time.time() + timeout
    observed = probe_token
    while time.time() < deadline:
        observed = _read_int_register(model, index)
        if observed == finish_token:
            break
        time.sleep(0.05)
    info = {"observed": observed, "probe_token": probe_token, "start_token": start_token,
            "finish_token": finish_token, "register": index,
            "payload": None if payload_register is None else _read_double_register(model, payload_register)}
    if observed == finish_token:
        return "executed", info
    if observed == start_token:
        return "partial", info
    return "not_executed", info


def _modbus_verdict(ip, robot, model, call_line, fn_name, data, *, payload_register=None,
                    executed_note="URScript 已在控制器上执行完毕（首尾哨兵确认）"):
    """跑一条 Modbus 调用并把结果翻译成 ok / err。三种结局分开说话，不夸大也不隐瞒。"""
    outcome, info = _run_sentinel_script(robot, model, [call_line], fn_name,
                                        payload_register=payload_register)
    out = dict(data)
    out["ip"] = ip
    out["fieldbus_confirmed"] = False
    if payload_register is not None and outcome == "executed":
        out["value_raw"] = info.get("payload")
    if outcome == "executed":
        return ok({"message": ("%s。⚠️ 这**不**证明 PLC/现场设备执行了：Modbus 的写类命令没有应答"
                               "（手册：expects no response），现场总线侧未被确认。" % executed_note),
                   "data": out, "outcome": outcome})
    if outcome == "partial":
        return err("脚本在控制器上**开始执行但没跑完**（只回读到起始哨兵）⇒ 那句调用很可能被控制器"
                   "拒绝了（信号不存在 / 类型不符 / 地址非法）。⚠️ 但**不能**据此断定现场设备没收到任何"
                   "东西：中止也可能发生在结果回写那一步。", "NOT_EXECUTED", out)
    return err("控制器没有执行这段 URScript（连起始哨兵都没回读到）⇒ 本次命令**是否生效未知**。%s"
               % info.get("reason", ""), "NOT_EXECUTED", out)


def op_modbus_add_signal(p):
    """添加一个 Modbus 信号（URScript `modbus_add_signal`）。`signal_type`：0 数字输入 / 1 数字输出 /
    2 寄存器输入 / 3 寄存器输出。同名信号会被替换。⚠️ 受审批门禁（让控制器开始监管新的现场总线点位）。"""
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)
    unit_ip = _modbus_ip(p.get("unit_ip"), "unit_ip")
    slave = _modbus_int(p.get("slave_number", 255), "slave_number", 0, 255)
    address = _modbus_int(p.get("signal_address"), "signal_address", 0, 65535)
    kind = _modbus_int(p.get("signal_type"), "signal_type", 0, 3)
    name = _modbus_text(p.get("signal_name"), "signal_name")
    line = 'modbus_add_signal("%s", %d, %d, %d, "%s")' % (unit_ip, slave, address, kind, name)
    return _modbus_verdict(ip, robot, model, line, "dsh_modbus_add_signal",
                           {"unit_ip": unit_ip, "slave_number": slave, "signal_address": address,
                            "signal_type": kind, "signal_name": name})


def op_modbus_delete_signal(p):
    """删除一个 Modbus 信号（URScript `modbus_delete_signal`）。⚠️ 受审批门禁（删掉一个正在被现场
    逻辑使用的点位，后果不比一次运动轻）。"""
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)
    name = _modbus_text(p.get("signal_name"), "signal_name")
    line = 'modbus_delete_signal("%s")' % name
    return _modbus_verdict(ip, robot, model, line, "dsh_modbus_delete_signal",
                           {"signal_name": name})


def op_modbus_get_signal_status(p):
    """读一个 Modbus 信号的当前值（URScript `modbus_get_signal_status`）——**这一条有真正的回读**。

    ⚠️ 必须显式声明 `kind`：URScript 是强类型的，数字信号返回 true/false、寄存器信号返回无符号整数，
    这两种返回值没法用同一段脚本安全地回写（拿 bool 去写 float 寄存器会在控制器上报错），所以
    工具不猜、由调用方声明。
    """
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)
    name = _modbus_text(p.get("signal_name"), "signal_name")
    kind = p.get("kind", "register")
    if kind not in ("digital", "register"):
        raise ValueError("kind 只能是 'digital'（数字信号 ⇒ true/false）或 'register'（寄存器信号 ⇒ "
                         "无符号整数）；实得 %r" % (p.get("kind"),))
    if kind == "digital":
        lines = ['local v = modbus_get_signal_status("%s", False)' % name,
                 "if v == True:",
                 "  write_output_float_register(%d, 1)" % MODBUS_PAYLOAD_REGISTER,
                 "else:",
                 "  write_output_float_register(%d, 0)" % MODBUS_PAYLOAD_REGISTER,
                 "end"]
    else:
        lines = ['local v = modbus_get_signal_status("%s", False)' % name,
                 "write_output_float_register(%d, v)" % MODBUS_PAYLOAD_REGISTER]

    outcome, info = _run_sentinel_script(robot, model, lines, "dsh_modbus_get_signal_status",
                                        payload_register=MODBUS_PAYLOAD_REGISTER)
    data = {"signal_name": name, "kind": kind, "ip": ip, "fieldbus_confirmed": False}
    if outcome != "executed":
        data["value"] = None
        if outcome == "partial":
            return err("读信号脚本在控制器上开始执行但没跑完（只回读到起始哨兵）⇒ 很可能该信号不存在，"
                       "或 kind 声明与该信号类型不符（数字/寄存器不是一个类型）。", "NOT_EXECUTED", data)
        return err("控制器没有执行这段 URScript（连起始哨兵都没回读到）⇒ 本次读到的东西不可信，"
                   "**没有**给出数值。%s" % info.get("reason", ""), "NOT_EXECUTED", data)
    if info.get("payload") is None:
        return err("脚本跑完了，但 double 寄存器 %d 上回读不到值（该寄存器可能未在接收配方里启用）"
                   "⇒ 拒绝给一个无法担保的数字。" % MODBUS_PAYLOAD_REGISTER, "UNSUPPORTED", data)
    value = float(info["payload"])
    data["value"] = bool(round(value)) if kind == "digital" else int(round(value))
    return ok({"message": "信号 %s（%s）= %s（脚本执行完毕且结果已回读）。" % (name, kind, data["value"]),
               "data": data, "outcome": outcome})


def op_modbus_send_custom_command(p):
    """向 Modbus 单元发一条自定义命令（URScript `modbus_send_custom_command`）。
    ⚠️ 手册明确**收不到应答**，且用户需自己保证 data 对该 function_code 有意义。
    ⚠️ 受审批门禁：它能直接驱动 PLC（例如改看门狗、写寄存器）。"""
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)
    unit_ip = _modbus_ip(p.get("unit_ip"), "unit_ip")
    slave = _modbus_int(p.get("slave_number"), "slave_number", 0, 255)
    code = _modbus_int(p.get("function_code"), "function_code", 1, 127)
    data = _modbus_byte_list(p.get("data"), "data")
    line = 'modbus_send_custom_command("%s", %d, %d, [%s])' % (
        unit_ip, slave, code, ", ".join(str(b) for b in data))
    return _modbus_verdict(ip, robot, model, line, "dsh_modbus_send_custom_command",
                           {"unit_ip": unit_ip, "slave_number": slave, "function_code": code,
                            "data": data})


def op_modbus_set_output_register(p):
    """把一个 Modbus 输出寄存器信号设成给定值（0-65535）。⚠️ 受审批门禁（直接驱动 PLC）。"""
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)
    name = _modbus_text(p.get("signal_name"), "signal_name")
    value = _modbus_int(p.get("register_value"), "register_value", 0, 65535)
    line = 'modbus_set_output_register("%s", %d, False)' % (name, value)
    return _modbus_verdict(ip, robot, model, line, "dsh_modbus_set_output_register",
                           {"signal_name": name, "register_value": value})


def op_modbus_set_output_signal(p):
    """把一个 Modbus 输出数字信号设成 true/false。⚠️ 受审批门禁（直接驱动 PLC）。"""
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)
    name = _modbus_text(p.get("signal_name"), "signal_name")
    digital = p.get("digital_value")
    if not isinstance(digital, bool):
        raise ValueError("digital_value 必须是布尔值 true/false（实得 %r）" % (digital,))
    line = 'modbus_set_output_signal("%s", %s, False)' % (name, "True" if digital else "False")
    return _modbus_verdict(ip, robot, model, line, "dsh_modbus_set_output_signal",
                           {"signal_name": name, "digital_value": digital})


def op_modbus_set_runstate_dependent_choice(p):
    """设置输出信号在程序未运行时的行为（0 保持 / 1 置低 / 2 置高）。不改现场设备，不受门禁。"""
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)
    name = _modbus_text(p.get("signal_name"), "signal_name")
    choice = _modbus_int(p.get("runstate_choice"), "runstate_choice", 0, 2)
    line = 'modbus_set_runstate_dependent_choice("%s", %d)' % (name, choice)
    return _modbus_verdict(ip, robot, model, line, "dsh_modbus_set_runstate_choice",
                           {"signal_name": name, "runstate_choice": choice},
                           executed_note="该信号的程序状态依赖行为已设置（首尾哨兵确认脚本执行完毕）")


def op_modbus_set_signal_update_frequency(p):
    """设置该信号的刷新频率（0-125 Hz）。不改现场设备的值，不受门禁。"""
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)
    name = _modbus_text(p.get("signal_name"), "signal_name")
    frequency = _modbus_int(p.get("update_frequency"), "update_frequency", 0, 125)
    line = 'modbus_set_signal_update_frequency("%s", %d)' % (name, frequency)
    return _modbus_verdict(ip, robot, model, line, "dsh_modbus_set_update_frequency",
                           {"signal_name": name, "update_frequency": frequency},
                           executed_note="刷新频率已设置（首尾哨兵确认脚本执行完毕）")


def _selection6(value):
    """力控选择向量：6 个 0/1（1 = 该轴柔性，0 = 刚性）。"""
    if not isinstance(value, (list, tuple)) or len(value) != 6:
        raise ValueError("selection_vector 必须是 6 个数（1 = 该轴柔性，0 = 刚性）")
    out = []
    for index, item in enumerate(value):
        if isinstance(item, bool):
            out.append(int(item))
            continue
        if not isinstance(item, int) or item not in (0, 1):
            raise ValueError("selection_vector[%d] 必须是 0 或 1（实得 %r）" % (index, item))
        out.append(item)
    return out


def _simple_pose(model):
    """读实际 TCP 位姿；读不到返回 None（**绝不**拿上一次的值冒充）。"""
    try:
        pose = model.ActualTCPPose()
        values = [float(x) for x in pose]
    except Exception:
        return None
    return values if len(values) == 6 else None


def op_move_force(p):
    """**力控引导运动**：在力控模式下朝目标位姿走，碰到工件就停 —— 力控装配的核心动作。

    与 vendored `urScriptExt.move_force`（:510-535）是**同一段 URScript 形状**：
    `force_mode(...)` → `movel(...)` → `stopl(...)` → `end_force_mode()`，一次交给控制器跑完。

    ⚠️ **不复用** `urScriptExt.move_force_2stop`：它靠 `set_force_remote()` 每 8 ms 把 wrench 写进
    **RTDE 输入寄存器**（`input_double_register_0..17`）来持续施力，而本插件刻意没有 send 配方 ——
    那些输入字段在这里 claim 不了（claim 一个不存在的 send 字段会让控制器抛异常、崩掉 RTDE 接收线程）。
    本工具改把"持续施力 + 沿轨迹前进"整段交给控制器的 `force_mode` 自己完成，用**首尾哨兵**证明脚本
    真的跑完了，再拿只读 RTDE 读运动前后的实际位姿，据此判断"是否提前停下"。全程不需要 PC 侧推流。

    ⚠️ 力/力矩受安全闸的 `safetyMaxForceN` / `safetyMaxTorqueNm` 限制，且本 op 受运动审批门禁。
    """
    ip = str(p["ip"])
    robot, model = ensure_connected(ip)
    pose = _pose6(p.get("pose"), "pose")
    task_frame = _pose6(p.get("task_frame", [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]), "task_frame")
    selection = _selection6(p.get("selection_vector"))
    wrench = _pose6(p.get("wrench"), "wrench")
    limits = _pose6(p.get("limits", [0.1, 0.1, 0.1, 0.1, 0.1, 0.1]), "limits")
    f_type = p.get("f_type", 2)
    if f_type not in (1, 2, 3):
        raise ValueError("f_type 只能是 1 / 2 / 3（手册：其它值无效）；实得 %r" % (f_type,))
    try:
        acc = float(p.get("a", 1.2))
        vel = float(p.get("v", 0.25))
        blend = float(p.get("r", 0.0))
    except (TypeError, ValueError):
        raise ValueError("a / v / r 必须是数值")
    if not acc > 0:
        raise ValueError("a 必须 > 0（实得 %r）" % (p.get("a"),))
    if not vel > 0:
        raise ValueError("v 必须 > 0（实得 %r）" % (p.get("v"),))
    if blend < 0:
        raise ValueError("r 必须 ≥ 0（实得 %r）" % (p.get("r"),))

    before = _simple_pose(model)
    lines = [
        "force_mode(p[%s], [%s], [%s], %d, [%s])" % (
            ", ".join("%.10g" % x for x in task_frame),
            ", ".join(str(x) for x in selection),
            ", ".join("%.10g" % x for x in wrench),
            int(f_type),
            ", ".join("%.10g" % x for x in limits)),
        "movel(p[%s], a=%.10g, v=%.10g, r=%.10g)" % (
            ", ".join("%.10g" % x for x in pose), acc, vel, blend),
        "stopl(%.10g)" % acc,
        "end_force_mode()",
    ]
    # 哨兵预算按"要走的距离 / 速度"估：力控模式下被挡住时 movel 会一直尝试到目标，可能很久。
    span = 0.0
    if before is not None:
        span = sum((pose[i] - before[i]) ** 2 for i in range(3)) ** 0.5
    budget = min(120.0, max(5.0, 2.0 * span / max(vel, 1e-6) + 5.0))
    outcome, info = _run_sentinel_script(robot, model, lines, "dsh_move_force", timeout=budget)
    after = _simple_pose(model)
    try:
        stopped_safety = bool(model.SafetyStatus().StoppedDueToSafety)
    except Exception:
        stopped_safety = None

    data = {"ip": ip, "target_pose": pose, "task_frame": task_frame, "selection_vector": selection,
            "wrench": wrench, "limits": limits, "f_type": int(f_type), "a": acc, "v": vel, "r": blend,
            "tcp_pose_before": before, "tcp_pose_after": after,
            "stopped_due_to_safety": stopped_safety, "sentinel_budget_s": budget}
    if outcome != "executed":
        data["reached_target"] = None
        data["stopped_short"] = None
        if outcome == "partial":
            return err("力控运动脚本在 %.1fs 预算内**没跑到结束哨兵**（只回读到起始哨兵）⇒ 它可能仍在执行"
                       "（力控模式下被挡住时 movel 会一直尝试到目标），也可能在力控/运动那一句被控制器拒绝。"
                       "**运动是否结束未知** —— 请先用 ur_get_program_state / ur_get_status 看现场，"
                       "不要假设机械臂已停或已到位。" % budget, "NOT_EXECUTED", data)
        return err("控制器没有执行这段 URScript（连起始哨兵都没回读到）⇒ 本次运动**是否发生未知**。%s"
                   % info.get("reason", ""), "NOT_EXECUTED", data)

    if after is None:
        data["reached_target"] = None
        data["stopped_short"] = None
        return ok({"message": "力控运动脚本已在控制器上执行完毕（首尾哨兵确认），但**读不到**运动后的实际 TCP "
                              "位姿，因此无法判断是否到位。", "data": data, "outcome": outcome})

    shortfall = sum((after[i] - pose[i]) ** 2 for i in range(3)) ** 0.5
    data["shortfall_m"] = shortfall
    data["reached_target"] = shortfall <= 0.001
    data["stopped_short"] = shortfall > 0.001
    if data["reached_target"]:
        message = ("力控运动执行完毕，实际 TCP 已到达目标位姿（位置差 %.4f m）。⚠️ 到位**不**等于过程中"
                   "没有接触，也不等于施加的力真的压到了工件上。" % shortfall)
    else:
        message = ("力控运动执行完毕，但实际 TCP **停在目标之前**（位置差 %.4f m）。力控模式下被工件/环境"
                   "挡住时控制器无法继续沿轨迹前进，就会停在这里 —— 这正是力控装配要的效果。"
                   "⚠️ 本工具**无法区分**「被力/力矩限值止住」与「被安全停止或程序被停」："
                   "安全停止标志=%s；请结合 tcp_pose_after 与现场确认。" % (shortfall, stopped_safety))
    return ok({"message": message, "data": data, "outcome": outcome})


# ---------------------------------------------------------------------------
# 命名位姿表：worker 只负责读写那个**已被宿主校验过**的绝对路径
#
# ⚠️ 分工（与 `lib/program-files.js` 同一模式）：**名字牢笼、配额判定、向量形状都在宿主侧**
# （`lib/pose-store.js`，纯逻辑 + 可注入 IO + 单测覆盖）；worker 拿到的是已经校验过的绝对路径，
# 以及宿主**注入**的 `_` 前缀协议字段（`_path` / `_dir` / `_pose_count` / `_max_poses` / `_capture`）。
# 那些字段**不在**工具 schema 里，而 `sanitizeArgs` 只保留声明过的键，所以模型无法自己指定路径 ——
# `scripts/check-tool-params.py` 也据此把 `_` 前缀视为协议内部字段，并反过来禁止**声明**这种名字。
# ---------------------------------------------------------------------------

POSE_FILE_VERSION = 1
# 与 lib/pose-store.js 的 MAX_POSE_FILE_BYTES 保持一致（harness 里有断言盯着这两个数）。
POSE_FILE_MAX_BYTES = 64 * 1024


def _iso_now():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def _six_numbers_or_none(value):
    """把可能是 6 维数值的东西读出来；不是就返回 None（用于"这个文件被手工改坏了"的判定）。"""
    if not isinstance(value, list) or len(value) != 6:
        return None
    try:
        return [float(x) for x in value]
    except (TypeError, ValueError):
        return None


def _pose_read_json(path):
    """读一个位姿文件。返回 `(doc, error_code, error_message)`；doc 为 None 时看后两个。

    ⚠️ **"不存在"与"损坏"必须分开**：前者说明这个名字没存过，后者说明**存过但坏了** ——
    把它们混成一句"读不到"，会让调用方去重新保存一个其实已经存在、只是坏了的位姿。
    """
    if not os.path.exists(path):
        return None, "NOT_FOUND", "文件不存在"
    try:
        size = os.path.getsize(path)
    except Exception:
        size = None
    if size is not None and size > POSE_FILE_MAX_BYTES:
        return None, "BADARG", "文件有 %d 字节，超过上限 %d 字节（这个目录里的东西不对劲）" % (
            size, POSE_FILE_MAX_BYTES)
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle), None, None
    except Exception as exc:
        return None, "CORRUPT", "文件存在但读不出/解析不了：%r" % (exc,)


def op_pose_save(p):
    """保存/更新一条命名位姿（一位姿一文件）。**写后回读核对**，不是"写完就报成功"。

    写盘用"先写 `<path>.tmp`、`fsync`、再 `os.replace`"：同目录内的 replace 是原子的，
    因此不会留下"半截 JSON"这种状态。不给 pose/joints 时改为**从机器人当前姿态捕获**。
    """
    path = str(p["_path"])
    name = str(p["name"])
    pose = p.get("pose")
    joints = p.get("joints")
    capture = bool(p.get("_capture"))
    ip = p.get("ip")

    if pose is None and joints is None:
        if not capture:
            raise ValueError("至少要给 pose 或 joints 之一；或者两者都不给、并给出 ip 让插件从机器人"
                             "当前姿态捕获")
        if not ip:
            raise ValueError("要从机器人当前姿态捕获时必须给出 ip")
        robot, model = ensure_connected(str(ip))
        try:
            pose = _pose6([float(x) for x in model.ActualTCPPose()], "pose")
            joints = _pose6([float(x) for x in model.ActualQ()], "joints")
        except Exception as exc:
            return err("从机器人读当前姿态失败（%r）⇒ 没有写入任何东西。" % (exc,),
                       "CONNECT_FAILED", {"ip": str(ip), "path": path})
    else:
        if pose is not None:
            pose = _pose6(pose, "pose")
        if joints is not None:
            joints = _pose6(joints, "joints")

    existed = os.path.exists(path)
    if not existed:
        count = p.get("_pose_count")
        cap = p.get("_max_poses")
        if count is not None and cap is not None and int(count) >= int(cap):
            return err("位姿表已达上限 %d 条（当前 %d）⇒ 先删掉不再用的位姿再保存。"
                       % (int(cap), int(count)), "BADARG",
                       {"count": int(count), "max_poses": int(cap)})

    doc = {"version": POSE_FILE_VERSION, "name": name, "pose": pose, "joints": joints,
           "saved_at": _iso_now()}
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(doc, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except Exception as exc:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except Exception:
            pass
        return err("写入位姿文件失败：%s（%r）" % (path, exc), "IO_FAILED", {"path": path})

    read_back, _code, reason = _pose_read_json(path)
    if read_back is None:
        return err("位姿已写入但**回读失败**（%s）：%s ⇒ 不要当作保存成功。" % (path, reason),
                   "VERIFY_FAILED", {"path": path})
    if (not isinstance(read_back, dict) or read_back.get("pose") != pose
            or read_back.get("joints") != joints or read_back.get("name") != name):
        return err("位姿写入后回读的内容与要保存的不一致（%s）⇒ 保存不可信。" % path,
                   "VERIFY_FAILED", {"path": path, "read_back": read_back})
    try:
        size = os.path.getsize(path)
    except Exception:
        size = None
    return ok({"message": "位姿“%s”已%s（%s 字节，回读一致）。文件：%s"
               % (name, "更新" if existed else "保存", "?" if size is None else size, path),
               "data": {"name": name, "path": path, "pose": pose, "joints": joints,
                        "replaced": existed, "bytes": size, "saved_at": read_back.get("saved_at"),
                        "verified": True}})


def op_pose_get(p):
    """读回一条命名位姿。**"不存在"与"损坏"分开说**，并指出 pose/joints 是否仍是合法 6 维数。"""
    path = str(p["_path"])
    name = str(p["name"])
    doc, code, reason = _pose_read_json(path)
    if doc is None:
        if code == "NOT_FOUND":
            return err("位姿“%s”不存在（%s）⇒ 可用 ur_list_poses 看看已经存了哪些名字。"
                       % (name, path), "NOT_FOUND", {"name": name, "path": path})
        if code == "CORRUPT":
            return err("位姿文件 %s **存在但损坏**：%s ⇒ 这与「不存在」是两回事，请人工看一眼这个文件"
                       "（或删掉后重新保存）。" % (path, reason), "CORRUPT",
                       {"name": name, "path": path})
        return err("位姿文件 %s 不可用：%s" % (path, reason), code or "BADARG",
                   {"name": name, "path": path})
    if not isinstance(doc, dict):
        return err("位姿文件 %s 的内容不是一个 JSON 对象（实得 %s）⇒ 视为损坏。"
                   % (path, type(doc).__name__), "CORRUPT", {"name": name, "path": path})

    pose = doc.get("pose")
    joints = doc.get("joints")
    pose_ok = _six_numbers_or_none(pose) is not None
    joints_ok = _six_numbers_or_none(joints) is not None
    note = ""
    if not (pose_ok or joints_ok):
        note = ("（⚠️ 里面的 pose/joints 形状不合法，可能是手工编辑弄坏的 —— 直接拿去运动之前请先核对）")
    return ok({"message": "位姿“%s”：TCP 位姿 %s；关节角 %s；保存于 %s%s"
               % (doc.get("name") or name, pose, joints, doc.get("saved_at"), note),
               "data": {"name": doc.get("name") or name, "path": path, "pose": pose,
                        "joints": joints, "saved_at": doc.get("saved_at"),
                        "version": doc.get("version"), "pose_well_formed": pose_ok,
                        "joints_well_formed": joints_ok}})


def op_pose_list(p):
    """列出位姿表（只列 `*.json`）。**单个条目损坏不会让整张表失败** —— 否则一个坏文件就让整个
    功能不可用，而调用方连"坏的是哪个"都看不到。"""
    directory = str(p["_dir"])
    if not os.path.isdir(directory):
        return ok({"message": "位姿目录 %s 还不存在（说明还没保存过任何位姿）。" % directory,
                   "data": {"dir": directory, "poses": [], "count": 0, "broken": []}})
    try:
        filenames = sorted(f for f in os.listdir(directory) if f.lower().endswith(".json"))
    except Exception as exc:
        return err("位姿目录 %s 读不了（%r）⇒ 不会假装它是空的。" % (directory, exc),
                   "IO_FAILED", {"dir": directory})
    needle = p.get("filter")
    if isinstance(needle, str) and needle.strip():
        lowered = needle.strip().lower()
        filenames = [f for f in filenames if lowered in f.lower()]

    poses = []
    for filename in filenames:
        entry = {"file": filename, "name": filename[:-5]}
        doc, _code, reason = _pose_read_json(os.path.join(directory, filename))
        if isinstance(doc, dict):
            entry.update({"ok": True, "name": doc.get("name") or entry["name"],
                          "pose": doc.get("pose"), "joints": doc.get("joints"),
                          "saved_at": doc.get("saved_at")})
        else:
            entry.update({"ok": False, "reason": reason or "读不出"})
        poses.append(entry)
    broken = [item["file"] for item in poses if not item.get("ok")]
    return ok({"message": "位姿表共 %d 条%s" % (
        len(poses), "，其中 %d 条**损坏**：%s" % (len(broken), ", ".join(broken)) if broken else ""),
        "data": {"dir": directory, "poses": poses, "count": len(poses), "broken": broken}})


def op_pose_delete(p):
    """删除一条命名位姿：**先确认存在、删完再确认真的没了**（同 `delete_program` 的纪律）。"""
    path = str(p["_path"])
    name = str(p["name"])
    if not os.path.exists(path):
        return err("位姿“%s”不存在，未做任何删除（%s）。" % (name, path), "NOT_FOUND",
                   {"name": name, "path": path})
    try:
        os.remove(path)
    except Exception as exc:
        return err("删除位姿文件失败：%s（%r）" % (path, exc), "IO_FAILED",
                   {"name": name, "path": path})
    if os.path.exists(path):
        return err("删除后仍然能 stat 到 %s ⇒ 没有真正删除。" % path, "VERIFY_FAILED",
                   {"name": name, "path": path})
    return ok({"message": "已删除位姿“%s”（删除后已确认文件不存在）：%s" % (name, path),
               "data": {"name": name, "path": path, "verified": True}})


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
    return ok_unverified({"message": "已设置重力方向为 [%.4f, %.4f, %.4f]（已归一化）" % tuple(unit),
               "data": {"direction": unit, "normalized_from": d, "ip": ip}})


def op_zero_ftsensor(p):
    """把力/力矩传感器的读数归零。⚠️ 归零瞬间机械臂应处于"无力"状态。"""
    ip = str(p["ip"])
    robot, _ = ensure_connected(ip)
    if not _send_program(robot, "zero_ftsensor()\n"):
        return err("zero_ftsensor 脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok_unverified({"message": "已下发力/力矩传感器归零", "data": {"ip": ip}})


def op_get_tcp_force(p):
    """读取 TCP 受力/力矩 [Fx,Fy,Fz,Tx,Ty,Tz]（来自 RTDE）。"""
    ip = str(p["ip"])
    _, model = ensure_connected(ip)
    force = [float(x) for x in model.ActualTCPForce()]
    return ok({"message": "TCP 受力：%s" % force,
               "data": {"tcp_force": force, "ip": ip}})


def op_conveyor_tracking(p):
    """传送带跟踪：编码器设置 / 线性跟踪 / 圆盘跟踪 / 停止。

    ## 这一版是**按手册重写**的（旧版每个实参都在错误的位置）

    旧实现发的是 `conveyor_pulse_decode(a, b, 0)` /
    `set_conveyor_tick_count(0, ticks_per_meter)` /
    `track_conveyor_linear(p[0,…], speed)` / `track_conveyor_circular(p[0,…], radius, speed)`。
    逐条对照 PolyScope 5 手册（`ScriptManual/txt/script_directory_Poly5.txt`）：

    - `conveyor_pulse_decode(type,A,B)`（15.1，764 行）—— 第一个槽是**解码方式**，而旧代码把
      "编码器 A 通道"放了进去；默认 `encoder_a=0` 恰好等于手册里 "0 is no encoder, pulse
      decoding is disabled"（770 行），也就是**解码根本没开**。
    - `set_conveyor_tick_count(tick_count, absolute_encoder_resolution)`（15.45，1595 行）——
      第二个槽是 0-4 的**位宽枚举**，旧代码把"每米脉冲数"塞了进去；而且该参数被
      `allow_zero=False` 校验，恰恰拒绝了唯一合理的值 0。
    - `track_conveyor_linear(direction, ticks_per_meter, encoder_index=0)`（15.57，1772 行）——
      第一个参是**方向位姿**，旧代码传的是零位姿；第二个参是每米脉冲数，旧代码传的是"速度"。
    - `track_conveyor_circular(center, ticks_per_revolution, rotate_tool='False',
      encoder_index=0)`（15.56，1746 行）—— 旧代码把"半径"当成每转脉冲数、把浮点数当成布尔量。

    ⇒ 现在每个参数都按手册的槽位与量纲传，且**不再有默认的"速度"这种手册里不存在的概念**。

    ⚠️ **未经真机验证**：本实现只保证"发出去的 URScript 与手册签名/语义一致"，签名本身已用
    手册逐条核对（见上），但跟踪行为需要一台真的带编码器的传送带才能确认。请先在 URSim 上
    试，并在真机上空载验证后再接工件。

    action：
      "setup_pulse"   —— 把控制器脉冲解码器挂到编码器上（`encoder_enable_pulse_decode`）
      "setup_absolute"—— 告诉控制器编码器通过 `encoder_set_tick_count` 喂绝对值
      "linear" / "circular" —— 开始跟踪（不含编码器设置，便于先设置一次、之后反复启停）
      "stop"          —— 停止跟踪
    """
    ip = str(p["ip"])
    action = str(p.get("action", "")).lower()
    robot, _ = ensure_connected(ip)
    _assert_remote_control(ip, "conveyor_tracking")

    def encoder_index():
        return _bounded_int(p.get("encoder_index", 0), "encoder_index", 0, 1,
                            "编码器编号（手册：只能是 0 或 1）")

    if action == "stop":
        script = "stop_conveyor_tracking()\n"
        note = "已停止传送带跟踪"
    elif action == "setup_pulse":
        # encoder_enable_pulse_decode(encoder_index, decoder_type, A, B)
        enc = encoder_index()
        decoder = _bounded_int(p.get("decoder_type", 1), "decoder_type", 1, 4,
                               "解码方式（1 正交 / 2 升降沿 / 3 升沿 / 4 降沿；手册里的 0 表示"
                               "关闭解码，作为设置动作没有意义，故不接受）")
        # 引脚范围随固件不同：CB3（3.x）脉冲解码器只有数字输入 0-3，
        # e-Series / PolyScope X 是 8-11（手册 15.3：「A: Encoder input A pin. Must be 8-11」）。
        # 两种都被接受，但由调用方显式给出 —— 猜错会让解码静默失效。
        a = _bounded_int(p.get("encoder_a"), "encoder_a", 0, 11, "编码器 A 引脚")
        b = _bounded_int(p.get("encoder_b"), "encoder_b", 0, 11, "编码器 B 引脚")
        script = "encoder_enable_pulse_decode(%d, %d, %d, %d)\n" % (enc, decoder, a, b)
        note = ("已把脉冲解码器挂到编码器 %d（方式 %d，引脚 A=%d B=%d）。"
                "⚠️ 引脚合法范围随固件不同：CB3(3.x) 用 0-3，e-Series/PolyScope X 用 8-11"
                % (enc, decoder, a, b))
    elif action == "setup_absolute":
        # encoder_enable_set_tick_count(encoder_index, range_id)
        enc = encoder_index()
        range_id = _bounded_int(p.get("range_id", 0), "range_id", 0, 4,
                                "编码器计数范围（0=32 位有符号 … 4=32 位无符号）")
        script = "encoder_enable_set_tick_count(%d, %d)\n" % (enc, range_id)
        if p.get("tick_count") is not None:
            tick = int(p["tick_count"])
            script += "encoder_set_tick_count(%d, %d)\n" % (enc, tick)
        note = "已把编码器 %d 配置为外部喂计数值（范围 %d）" % (enc, range_id)
    elif action in ("linear", "circular"):
        enc = encoder_index()
        if action == "linear":
            # track_conveyor_linear(direction, ticks_per_meter, encoder_index=0)
            direction = _vec(p, "direction", 6,
                             "track_conveyor_linear 的 direction（基座系下传送带的方向位姿，"
                             "例如 x 轴方向为 [1,0,0,0,0,0]）")
            ticks = _nonneg_float(p.get("ticks_per_meter"), "ticks_per_meter",
                                  "每米脉冲数（>0；手册：编码器走过 1 米产生的脉冲数）",
                                  allow_zero=False)
            script = "track_conveyor_linear(p%s, %s, %d)\n" % (
                _ur_list(direction), _ur_number(ticks), enc)
            note = "已开始线性跟踪（方向 p%s，%s 脉冲/米）" % (_ur_list(direction), _ur_number(ticks))
        else:
            # track_conveyor_circular(center, ticks_per_revolution, rotate_tool='False',
            #                          encoder_index=0)
            center = _vec(p, "center", 6, "track_conveyor_circular 的 center（基座系下的圆心位姿）")
            ticks = _nonneg_float(p.get("ticks_per_revolution"), "ticks_per_revolution",
                                  "每转脉冲数（>0；手册：传送带转一圈编码器看到的脉冲数）",
                                  allow_zero=False)
            rotate_raw = p.get("rotate_tool", False)
            rotate = "True" if (rotate_raw is True or str(rotate_raw).lower() in ("true", "1")) else "False"
            script = "track_conveyor_circular(p%s, %s, %s, %d)\n" % (
                _ur_list(center), _ur_number(ticks), rotate, enc)
            note = "已开始圆盘跟踪（圆心 p%s，%s 脉冲/转，工具随传送带旋转=%s）" % (
                _ur_list(center), _ur_number(ticks), rotate)
    else:
        raise WorkerError(
            "BADARG",
            'action 必须是 "setup_pulse" / "setup_absolute" / "linear" / "circular" / "stop"，收到 %r'
            % action)

    if not _send_program(robot, script):
        return err("传送带跟踪脚本未能送达控制器：%s" % _last_send_failure(robot), "SEND_FAILED")
    return ok_unverified({"message": "%s。下发脚本：%s" % (note, script.strip()),
               "data": {"action": action, "command": script.strip(),
                        "hardware_verified": False, "ip": ip}})


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

    # 优先走 RTDE 直读（tool_analog_input0/1）：零代价、也不打断当前运行的程序。
    # 只有该字段读不到时，才退回下面"发脚本 + 回读寄存器"的笨办法。
    direct = _rtde_field(model, "tool_analog_input%d" % n)
    if direct is not None:
        types_raw = _rtde_field(model, "tool_analog_input_types")
        try:
            types_value = None if types_raw is None else int(types_raw)
        except Exception:
            types_value = None
        return ok({"message": "工具模拟输入 %d = %s（RTDE 直读；该通道类型编码 %s，按控制器文档解释）"
                              % (n, direct, types_value if types_value is not None else "不可用"),
                   "data": {"n": n, "value": float(direct), "source": "rtde",
                            "tool_analog_input_types": types_value, "ip": ip}})

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
    "check_pose": op_check_pose,
    "set_speed_scaling": op_set_speed_scaling,
    "list_programs": op_list_programs,
    "upload_program": op_upload_program,
    "download_program": op_download_program,
    "delete_program": op_delete_program,
    "popup_message": op_popup_message,
    "close_popup": op_close_popup,
    "add_log": op_add_log,
    "modbus_add_signal": op_modbus_add_signal,
    "modbus_delete_signal": op_modbus_delete_signal,
    "modbus_get_signal_status": op_modbus_get_signal_status,
    "modbus_send_custom_command": op_modbus_send_custom_command,
    "modbus_set_output_register": op_modbus_set_output_register,
    "modbus_set_output_signal": op_modbus_set_output_signal,
    "modbus_set_runstate_dependent_choice": op_modbus_set_runstate_dependent_choice,
    "modbus_set_signal_update_frequency": op_modbus_set_signal_update_frequency,
    "move_force": op_move_force,
    "pose_save": op_pose_save,
    "pose_get": op_pose_get,
    "pose_list": op_pose_list,
    "pose_delete": op_pose_delete,
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
    # ── 力控 / 速度控制 / 目标值（0.6.0，手册 15.x / 16.x / 18.x 交叉核对后新增）──
    "force_mode": op_force_mode,
    "end_force_mode": op_end_force_mode,
    "force_mode_settings": op_force_mode_settings,
    "speedj": op_speedj,
    "speedl": op_speedl,
    "stopj": op_stopj,
    "stopl": op_stopl,
    "wait_steady": op_wait_steady,
    "get_target_values": op_get_target_values,
    "tool_communication": op_tool_communication,
    "set_tool_output_mode": op_set_tool_output_mode,
    "set_payload_inertia": op_set_payload_inertia,
    "get_tool_telemetry": op_get_tool_telemetry,
    # OptiMove（jerk 受限的平滑运动）与 Motion Version 设置
    "move_optimized": op_move_optimized,
    "motion_version": op_motion_version,
    "get_freedrive_status": op_get_freedrive_status,
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


def _write_protocol_line(body):
    """写一行协议 JSON —— 响应与主动推送共用，必须整行原子（见 `_PROTOCOL_LOCK`）。"""
    line = (body + "\n").encode("utf-8")
    with _PROTOCOL_LOCK:
        buf = getattr(_PROTOCOL_OUT, "buffer", None)
        if buf is not None:
            buf.write(line)
            buf.flush()
        else:
            _PROTOCOL_OUT.write(line.decode("utf-8"))
            _PROTOCOL_OUT.flush()


def _write_push_line(body):
    """把一个遥测推送行写到**独立通道**（stderr + `PUSH_CHANNEL_PREFIX`）。

    两层意义：①不与响应争 `_PROTOCOL_LOCK`；②不受 stdout 背压影响。
    前缀让宿主能把遥测从普通 stderr（Python traceback、URBasic 的 print）里分出来 ——
    那些仍然进 `stderrTail` 供诊断，不会被遥测挤掉。
    """
    line = (PUSH_CHANNEL_PREFIX + body + "\n").encode("utf-8")
    with _PUSH_LOCK:
        try:
            buf = getattr(sys.stderr, "buffer", None)
            if buf is not None:
                buf.write(line)
                buf.flush()
            else:
                sys.stderr.write(line.decode("utf-8"))
                sys.stderr.flush()
        except Exception:
            # 推送是加分项：写不出去（stderr 被关掉/重定向到不可写对象）绝不能打死推送线程，
            # 更不能影响主协议。丢一帧遥测远好过崩掉 worker。
            pass


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
    _write_protocol_line(body)


# ---------------------------------------------------------------------------
# 孪生遥测主动推送 —— 数字孪生"完整跟随机器人动作"的关键
# ---------------------------------------------------------------------------
#
# 为什么必须有：本 worker 是单线程 stdin 队列，运动类工具（`_movej_confirm` /
# `_wait_robot_idle` 的确认循环）会一直占着它，孪生的读因此排在后面并超时 ——
# 用户看到的是「数据已停止更新 Ns」。但遥测数据本身**从来没有停过**：RTDE 由
# URBasic 的后台线程以 500 Hz 持续写入 `model.dataDir`，读它与 stdin 队列无关。
#
# 所以遥测改由这里**主动推送**：推送行不带 `id`，与"请求/响应"天然区分，旧宿主
# 只会把它记成一条无法匹配的响应（无副作用），因此协议向后兼容。

# 推送节拍：孪生 SSE 每 100 ms 一帧，20 Hz 足够让每一帧都拿到新鲜读数。
TWIN_PUSH_INTERVAL_S = 0.05

# 推送线程开关（诊断可用 DSH_UR_TWIN_PUSH=0 关掉，便于对比"有没有推送"的行为差异）。
TWIN_PUSH_DISABLED = os.environ.get("DSH_UR_TWIN_PUSH", "").strip().lower() in ("0", "off", "false", "no")


def _twin_push_snapshot(ip):
    """只读 RTDE 接收缓存，返回 ``{"q": […6], "tcp": […6]}``；拿不到就返回 None。

    **绝不走命令队列、绝不做网络往返**：这正是它能在机器人运动期间继续出数的原因。
    字段优先取原始 RTDE 数据（`_rtde_field`，零往返），缺失时回退到 URBasic 访问器。
    """
    robot = ROBOTS.get(ip)
    if robot is None:
        return None
    model = ROBOT_MODELS.get(ip)
    q = _rtde_field(model, "actual_q") if model is not None else None
    tcp = _rtde_field(model, "actual_TCP_pose") if model is not None else None
    if q is None:
        try:
            q = robot.get_actual_joint_positions()
        except Exception:
            return None
    if tcp is None:
        try:
            tcp = robot.get_actual_tcp_pose()
        except Exception:
            return None
    try:
        q = [float(x) for x in q]
        tcp = [float(x) for x in tcp]
    except Exception:
        return None
    if len(q) < 6 or len(tcp) < 6:
        return None
    return {"q": q[:6], "tcp": tcp[:6]}


def _twin_push_loop():
    """后台推送线程：周期性把每台已连接机器人的姿态写成一行协议 JSON。

    行里**没有 `id`** —— 这是与响应区分开的唯一标志，Node 侧据此把它当推送处理
    （见 lib/worker.js 的 `_onLine`）。任何异常都不允许打死这条线程，更不允许影响主协议。
    """
    while True:
        time.sleep(TWIN_PUSH_INTERVAL_S)
        try:
            for ip in list(ROBOTS.keys()):
                snapshot = _twin_push_snapshot(ip)
                if snapshot is None:
                    continue
                _write_push_line(json.dumps({
                    "push": "telemetry",
                    "ip": ip,
                    "ts": int(time.time() * 1000),
                    "data": snapshot,
                }, ensure_ascii=False, default=_json_default, allow_nan=False))
        except Exception:
            continue


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


def _force_utf8_stdio():
    """把三个标准流钉死在 UTF-8 上。

    出站方向一直是 UTF-8（`respond()` 直接写 `sys.stdout.buffer`，就是为绕开 GBK 默认值），
    但**入站方向此前一个字没管**：Node 侧 `JSON.stringify` 不转义非 ASCII，写进管道的
    是 UTF-8 字节，而中文 Windows 上 `sys.stdin` 默认按 cp936 解码 ⇒ 中文程序名/脚本
    静默变成乱码（不报错，直接发给控制器），非法字节序列则抛 UnicodeDecodeError 把
    worker 打死。`lib/worker.js` 的 spawn env 另外补了 PYTHONUTF8/PYTHONIOENCODING 做双保险。
    """
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError, OSError):
            # 非标准流（被重定向成 BytesIO/自定义对象）时静默跳过：不能因为一个
            # 环境差异让 worker 起不来，真正的编码问题会在读写时如实暴露。
            pass


def main():
    global _CURRENT_REQUEST_ID, _CURRENT_TIMEOUT_MS
    _force_utf8_stdio()
    # 孪生遥测的推送线程：与运动命令**并行**（RTDE 缓存由 URBasic 自己的接收线程更新），
    # 所以机器人运动期间孪生照样有数据。daemon=True：主线程退出即随之结束。
    if not TWIN_PUSH_DISABLED:
        threading.Thread(target=_twin_push_loop, name="twin-push", daemon=True).start()
    while True:
        # 用 readline() 而不是 `for line in sys.stdin`：解码失败发生在**迭代器内部**，
        # 那时异常在下面这层 try 之外，会直接冲出 main() 把进程打死（在飞请求全失败）。
        # 显式读一行才能把"坏字节"变成一次可诊断的 BADARG。
        try:
            line = sys.stdin.readline()
        except UnicodeDecodeError as exc:
            respond({"id": None, "ok": False, "data": None,
                     "error": "stdin 收到非法 UTF-8 字节（本插件协议固定 UTF-8）：%s" % exc,
                     "code": "BADARG"})
            # 继续读会在同一段坏字节上原地打转（缓冲位置不前进），如实报错后有序退出。
            return
        if not line:
            return
        line = line.strip()
        if not line:
            continue
        req = None
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

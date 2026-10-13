"""
test/ur-python-harness.py — 内置库（vendored URBasic）缺陷回归探针。

由 `test/vendored-fixes.test.mjs` 以 `python -u test/ur-python-harness.py` 调用，
把结果写成一行 JSON 到**真实 stdout**（`ur_worker._PROTOCOL_OUT`）。

为什么要有这个文件：这一批缺陷的性质决定了它们**无法用"读源码看有没有那段代码"来钉住**
（例如"发送失败会无限重试"是一个循环结构，不是一行可见的字符串），必须真的把函数跑起来、
在受控的假对象上观察它的**行为**：
  - `__sendPrg` 过去无界重试 ⇒ 现在必须在上限内返回 False 并给出可读原因；
  - `ConfigurableInputBits(8)` 过去算成 2**16 ⇒ 现在必须是 2**0；
  - `RobotStatus()/SafetyStatus()` 过去在字段为 None 时抛 TypeError ⇒ 现在必须全 False；
  - `ActualJointVoltage()` 过去返回电流 ⇒ 现在必须读 `actual_joint_voltage`；
  - `Dashboard.wait_dbs()` 过去无参无限等待 ⇒ 现在必须支持超时并真的超时返回；
  - `Dashboard.run()` 的接收循环过去 60 s 后自杀（socket 还开着）⇒ 现在源码里不得再出现
    那个时间条件（静态契约，配合 `dashboard.sendCommand` 的存在）。
"""

import json
import os
import socket
import sys
import time

US = os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(os.path.dirname(US), 'python')
sys.path.insert(0, PY)

import ur_worker  # noqa: E402  （它会隔离 stdout 到日志文件）
from URBasic import realTimeClient, robotModel  # noqa: E402
from URBasic.connectionState import ConnectionState  # noqa: E402

out = {}


# ---------------------------------------------------------------------------
# 1. realTimeClient.__sendPrg 必须有界，且失败要如实上报
#
# 这里用**真实的回环 socket**，而不是假对象：`__sendPrg` 内部要过
# `select.select([], [sock], ...)`，而 select 只接受真的 fd（假对象会直接抛
# "argument must be an int, or have a fileno() method"，反而测不到真实路径）。
#   - 可发送：监听 + 已连接的对端（数据能被接收）
#   - 必失败：对端已关闭的连接 —— TCP 半开，select 仍说可写，写下去才报错。
#     这正是上游无界重试循环最容易被触发的形态。
# ---------------------------------------------------------------------------

def _connected_pair():
    """返回 (client_sock, server_sock)，两者已建立回环连接。"""
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(('127.0.0.1', 0))
    listener.listen(1)
    client_sock = socket.create_connection(listener.getsockname(), timeout=2.0)
    server_sock, _ = listener.accept()
    listener.close()
    client_sock.settimeout(1.0)
    return client_sock, server_sock


def _dead_sock():
    """一个「已与对端断开」的真实 socket：写下去必然失败。"""
    client_sock, server_sock = _connected_pair()
    server_sock.close()
    # 让对端确实关闭：本端再写会先成功一两次（进入内核缓冲）然后 RST/EPIPE，
    # 因此再多发一次空包把连接打到真正的错误态。
    for _ in range(2):
        try:
            client_sock.sendall(b'x')
        except OSError:
            break
    time.sleep(0.05)
    client_sock.settimeout(0.5)
    return client_sock


def _client(sock, connect_ok=True):
    """构造一个真实的 RealTimeClient，socket 与"重连"都被替换掉。

    注意 `__init__` 会**无条件**把 `rtcConnectionState` 重置为 DISCONNECTED，所以
    `Send()` 第一句一定会尝试 `__connect()`；把它替换成可控结果，测试才能直接打到
    `__sendPrg` 上。替换用**实例属性**，而 `Send` 调用的是类内的 `self.__connect()`
    （名字已被编译器改写成 `_RealTimeClient__connect`），所以两者同名同效。
    """
    model = robotModel.RobotModel()
    model.ipAddress = '127.0.0.1'
    client = realTimeClient.RealTimeClient(model)
    client._RealTimeClient__sock = sock
    # 不要真的等 15 s：把发送预算压到 0.6 s。
    client._RealTimeClient__sendTimeout = 0.6
    client._RealTimeClient__connect = lambda: connect_ok
    return client


def probe_send_deadline():
    sock = _dead_sock()
    client = _client(sock)
    t0 = time.time()
    result = client.Send('set_digital_out(0, True)\n')
    elapsed = time.time() - t0
    try:
        sock.close()
    except OSError:
        pass
    return {
        'returned': result,
        'elapsed_s': round(elapsed, 2),
        'within_budget_s': elapsed < 5.0,
        'last_send_failure': client.lastSendFailure,
    }


def probe_send_not_connected():
    """连不上时必须**立刻**返回 False 并给出原因（而不是静默成功）。"""
    sock, peer = _connected_pair()
    client = _client(sock, connect_ok=False)
    client._RealTimeClient__sock = None
    t0 = time.time()
    result = client.SendProgram('set_digital_out(0, True)\n')
    elapsed = time.time() - t0
    sock.close()
    peer.close()
    return {
        'returned': result,
        'elapsed_s': round(elapsed, 2),
        'last_send_failure': client.lastSendFailure,
    }


def probe_send_success():
    sock, peer = _connected_pair()
    client = _client(sock)
    result = client.Send('set_digital_out(0, True)\n')
    time.sleep(0.1)
    received = b''
    try:
        peer.settimeout(1.0)
        received = peer.recv(4096)
    except OSError:
        pass
    sock.close()
    peer.close()
    return {
        'returned': result,
        'received_ok': received == b'set_digital_out(0, True)\n',
        'last_send_failure': client.lastSendFailure,
    }


out['send_deadline'] = probe_send_deadline()
out['send_not_connected'] = probe_send_not_connected()
out['send_success'] = probe_send_success()


# ---------------------------------------------------------------------------
# 2. 可配置数字 I/O 的位掩码（过去偏移 +8 ⇒ 读到 tool DI）
# ---------------------------------------------------------------------------

def probe_bit_masks():
    model = robotModel.RobotModel()
    # bit0 = 标准 DI0、bit8 = 可配置 DI8、bit16 = tool DI0
    model.dataDir['actual_digital_input_bits'] = (1 << 0) | (1 << 8) | (1 << 16)
    model.dataDir['actual_digital_output_bits'] = (1 << 7) | (1 << 15) | (1 << 17)
    return {
        'std_in_0': bool(model.DigitalInputbits(0)),
        'std_in_1': bool(model.DigitalInputbits(1)),
        'config_in_8': bool(model.ConfigurableInputBits(8)),
        'config_in_9': bool(model.ConfigurableInputBits(9)),
        'config_in_15': bool(model.ConfigurableInputBits(15)),
        'std_out_7': bool(model.DigitalOutputBits(7)),
        'config_out_15': bool(model.ConfigurableOutputBits(15)),
        'config_out_8': bool(model.ConfigurableOutputBits(8)),
    }


out['bit_masks'] = probe_bit_masks()


# ---------------------------------------------------------------------------
# 3. 状态位解码在字段缺失时不得抛 TypeError
# ---------------------------------------------------------------------------

def probe_status_none():
    model = robotModel.RobotModel()          # 所有 dataDir 全是 None（= RTDE 未就绪）
    captured = {}
    try:
        robot = model.RobotStatus()
        safety = model.SafetyStatus()
        captured['robot'] = {k: v for k, v in vars(robot).items()}
        captured['safety_all_false'] = not any(
            v for k, v in vars(safety).items() if k != 'StoppedDueToSafety')
        captured['safety_stopped_due_to_safety'] = bool(safety.StoppedDueToSafety)
        captured['raised'] = None
    except Exception as exc:                                   # noqa: BLE001
        captured['raised'] = '%s: %s' % (type(exc).__name__, exc)
    return captured


out['status_none'] = probe_status_none()


# ---------------------------------------------------------------------------
# 4. 量纲/字段：ActualJointVoltage 必须是电压，ActualCurrent 是电流
# ---------------------------------------------------------------------------

def probe_measurements():
    model = robotModel.RobotModel()
    model.dataDir['actual_joint_voltage'] = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    model.dataDir['actual_current'] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
    model.dataDir['actual_qd'] = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06]
    model.dataDir['speed_scaling'] = 0.75
    model.dataDir['standard_analog_output0'] = 4.2
    model.dataDir['actual_joint_voltage'] = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
    return {
        'joint_voltage': list(model.ActualJointVoltage()),
        'joint_current': list(model.ActualCurrent()),
        'joint_speed': list(model.ActualQD()),
        'speed_scaling': model.SpeedScaling(),
        'analog_out_0': model.StandardAnalogOutput(0),
    }


out['measurements'] = probe_measurements()


# ---------------------------------------------------------------------------
# 5. Dashboard.wait_dbs() 必须可以超时返回（否则调用方永久卡死）
# ---------------------------------------------------------------------------

def probe_dashboard_wait():
    # 只测 `wait_dbs` 的超时语义：绕开线程与 socket，直接构造条件变量。
    from URBasic import dashboard
    import threading
    dash = dashboard.DashBoard.__new__(dashboard.DashBoard)
    dash._DashBoard__dataEvent = threading.Condition()
    dash._DashBoard__reconnectTimeout = 0.3
    t0 = time.time()
    woke = dash.wait_dbs(0.3)
    elapsed = time.time() - t0
    t1 = time.time()
    woke_default = dash.wait_dbs()            # 无参时也应受 __reconnectTimeout 限制，不得永久阻塞
    elapsed_default = time.time() - t1
    return {
        'woke': bool(woke),
        'elapsed_s': round(elapsed, 2),
        'woke_default': bool(woke_default),
        'elapsed_default_s': round(elapsed_default, 2),
    }


out['dashboard_wait'] = probe_dashboard_wait()


def probe_rtde_wait_timeout():
    """RTDE.__wait 必须能超时返回（否则任何一次 pose 读取都会永久卡住）。"""
    from URBasic import rtde
    from URBasic.connectionState import ConnectionState as CS
    import threading
    rt = rtde.RTDE.__new__(rtde.RTDE)
    rt._RTDE__dataEvent = threading.Condition()
    rt._RTDE__conn_state = CS.STARTED
    t0 = time.time()
    woke = rt._RTDE__wait(0.3)
    elapsed = time.time() - t0
    return {'woke': bool(woke), 'elapsed_s': round(elapsed, 2), 'within_budget_s': elapsed < 3.0}


out['rtde_wait'] = probe_rtde_wait_timeout()


# ---------------------------------------------------------------------------
# 6. movec 走的是原始 URScript（不是 UrScript.movec —— 它内部固定发 movep）
# ---------------------------------------------------------------------------

def probe_movec_source():
    src = open(os.path.join(PY, 'ur_worker.py'), encoding='utf-8').read()
    start = src.index('def op_movec(')
    end = src.index('\ndef ', start + 1)
    body = src[start:end]
    # 上游 movec 自身是否仍然走 movetype='p'（= 实际发 movep）
    lib = open(os.path.join(PY, 'URBasic', 'urScript.py'), encoding='utf-8').read()
    lstart = lib.index('def movec(')
    lend = lib.index('\n    def ', lstart + 1)
    return {
        'uses_raw_urscript': 'movec(p' in body,
        'does_not_call_lib_movec': 'robot.movec(' not in body,
        'upstream_calls_movep': "_move(movetype='p'" in lib[lstart:lend],
    }


out['movec'] = probe_movec_source()


# ---------------------------------------------------------------------------
# 8. 工具端 I/O 与模拟输出的 URScript 函数名（用仓库内的官方手册核对）
#
# 手册（ScriptManual/script_directory_Poly5.pdf）是这几种函数名的**权威来源**；上游
# vendored 代码里有三个名字在手册中根本不存在，后果不是"少个功能"，而是**静默失效**：
# 控制器拒收整段脚本，而调用方仍然回读到一个陈旧寄存器值 / 回报"已发送"。
# ---------------------------------------------------------------------------

_USCRIPT_DIR = os.path.join(PY, 'URBasic', 'urScript.py')


def _extract(path, start_marker, end_marker='\n    def '):
    """取一个方法的源码段，并**去掉注释行**。

    注释里会写明"上游原来用的是错名字"，把那句算进去会让门禁永远无法通过，
    也会变成"改注释就变绿"的假门禁。
    """
    src = open(path, encoding='utf-8').read()
    start = src.index(start_marker)
    try:
        end = src.index(end_marker, start + 1)
    except ValueError:
        end = len(src)
    body = src[start:end]
    return '\n'.join(line for line in body.split('\n') if not line.strip().startswith('#'))


def probe_tool_io_names():
    get_in = _extract(_USCRIPT_DIR, 'def get_tool_digital_in(self, n):')
    get_out = _extract(_USCRIPT_DIR, 'def get_tool_digital_out(self, n):')
    set_out = _extract(_USCRIPT_DIR, 'def set_tool_digital_out(self, n, b):')
    analog_out = _extract(_USCRIPT_DIR, 'def get_standard_analog_out(self, n, wait=True):')
    return {
        # 必须用的是手册里的真名
        'get_in_uses_get_tool_digital_in': 'get_tool_digital_in(' in get_in,
        'get_in_uses_write_output_integer_register': 'write_output_integer_register(' in get_in,
        'get_out_uses_get_tool_digital_out': 'get_tool_digital_out(' in get_out,
        'set_out_uses_set_tool_digital_out': 'set_tool_digital_out(' in set_out,
        'analog_out_uses_accessor_with_index': 'StandardAnalogOutput(n)' in analog_out,
        # 不得再出现手册里没有的名字
        'no_write_output_int_register': 'write_output_int_register(' not in (
            get_in + get_out + set_out),
        'no_read_tool_digital_in': 'read_tool_digital_in(' not in (get_in + get_out + set_out),
        'no_write_tool_digital_out': 'write_tool_digital_out(' not in (get_in + get_out + set_out),
        'no_standard_analog_output0_attr': 'StandardAnalogOutput0' not in analog_out,
        'no_standard_analog_output1_attr': 'StandardAnalogOutput1' not in analog_out,
    }


out['tool_io_names'] = probe_tool_io_names()


# ---------------------------------------------------------------------------
# 9. `t=` 必须真的进生成的 URScript（回归：movej/movel 的时长参数曾被静默丢弃）
#
# 这个缺陷活了很久，正是因为**没有任何测试看过"传了 t 之后生成的脚本长什么样"**。
# 只扫源码也抓不住它：旧代码里 `t_val = ''` 与 `tval = 't={t},'` 同时存在，
# 真正的错误是"格式串引用前者、赋值给了后者"—— 只有真的执行一遍才看得见。
# ---------------------------------------------------------------------------

def probe_motion_t_param():
    import importlib.util

    spec = importlib.util.spec_from_file_location('ur_uscript_probe', _USCRIPT_DIR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # `_move()` 只用局部变量拼字符串、不碰 socket ⇒ 绕过 __init__ 直接造实例。
    move = getattr(object.__new__(module.UrScript), '_move')

    joint_5 = move(movetype='j', q=[0.1, 0.2, 0.3, 0.4, 0.5, 0.6], a=1.4, v=1.05, t=5, r=0)
    linear_3 = move(movetype='l', pose=[0.1, 0.2, 0.3, 0, 0, 0], a=1.2, v=0.25, t=3, r=0)
    joint_0 = move(movetype='j', q=[0, 0, 0, 0, 0, 0], a=1.4, v=1.05, t=0, r=0)
    process = move(movetype='p', pose=[0.1, 0.2, 0.3, 0, 0, 0], a=1.2, v=0.25, t=0, r=0)
    return {
        'j_has_t5': 't=5' in joint_5,
        'l_has_t3': 't=3' in linear_3,
        'j_has_t0': 't=0' in joint_0,
        'p_has_no_t': 't=' not in process,
        'j_text': joint_5.strip()[:160],
        'l_text': linear_3.strip()[:160],
    }


out['motion_t_param'] = probe_motion_t_param()


# ---------------------------------------------------------------------------
# 10. 错误码映射：缺字段 / 溢出是"参数错"（BADARG），不是"内部错误"（HUGE）
# ---------------------------------------------------------------------------

def probe_error_codes():
    return {
        'key_error': ur_worker._error_code_for(KeyError('distance')),
        'overflow': ur_worker._error_code_for(OverflowError('int(inf)')),
        'value_error': ur_worker._error_code_for(ValueError('bad')),
        'unknown': ur_worker._error_code_for(RuntimeError('boom')),
    }


out['error_codes'] = probe_error_codes()


# ---------------------------------------------------------------------------
# 11. 入站方向也必须是 UTF-8（stdout 侧早就钉住了，stdin 侧以前没管）
# ---------------------------------------------------------------------------

def probe_stdin_utf8():
    src = open(os.path.join(PY, 'ur_worker.py'), encoding='utf-8').read()
    main = src[src.index('def main():'):]
    return {
        # 必须**覆盖 stdin**（stdout 侧一直是 UTF-8，缺陷只在入站方向）。
        'reconfigures_stdin': ('reconfigure(encoding="utf-8")' in src
                               and 'sys.stdin, sys.stdout, sys.stderr' in src),
        'calls_force_utf8': '_force_utf8_stdio()' in main,
        'guards_decode_error': 'UnicodeDecodeError' in main,
        'loop_reads_line': 'sys.stdin.readline()' in main,
    }


out['stdin_utf8'] = probe_stdin_utf8()


# ---------------------------------------------------------------------------
# 12. 工具数字输出：`Send()` 的结果必须被交出来（物理动作不能"发不出去也报成功"）
# ---------------------------------------------------------------------------

def probe_tool_digital_out_send_result():
    """真的调一遍 `set_tool_digital_out`，看它把 `Send()` 的结果交没交出来。

    它驱动的是夹爪/气阀这类**物理执行器**：掉线或非远程控制模式下 `Send()` 返回 False
    并写下 `lastSendFailure`，而旧实现把返回值丢掉 ⇒ worker 无条件回报"已设置"。
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location('ur_uscript_tdo', _USCRIPT_DIR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    class _FakeRtc:
        def __init__(self, ok):
            self.ok = ok
            self.sent = []

        def Send(self, text):
            self.sent.append(text)
            return self.ok

    def once(ok):
        script = object.__new__(module.UrScript)
        rtc = _FakeRtc(ok)
        script.robotConnector = type('C', (), {'RealTimeClient': rtc})()
        returned = script.set_tool_digital_out(1, True)
        return returned, (rtc.sent[0].strip() if rtc.sent else None)

    ok_returned, ok_sent = once(True)
    fail_returned, _ = once(False)
    return {
        'ok_returns_true': ok_returned is True,
        'fail_returns_false': fail_returned is False,
        'sent_text': ok_sent,
        'uses_manual_function_name': ok_sent == 'set_tool_digital_out(1, True)',
    }


out['tool_digital_out_send'] = probe_tool_digital_out_send_result()


# ---------------------------------------------------------------------------
# 13. 诚实性契约（源码级）：验证过的读取 / 只能声称"已下发"
# ---------------------------------------------------------------------------

def probe_honesty_contracts():
    src = open(os.path.join(PY, 'ur_worker.py'), encoding='utf-8').read()

    def body(name):
        start = src.index('def %s(' % name)
        end = src.index('\ndef ', start + 1)
        return src[start:end]

    get_di = body('op_get_digital_in')
    set_do = body('op_set_digital_out')
    force = body('op_force_mode')
    end_force = body('op_end_force_mode')
    verified = body('_read_tool_digital_in_verified')
    return {
        # 工具数字输入：必须走哨兵验证过的读取，且不得再直接调上游那个"逐句回读寄存器"的封装
        'tool_di_uses_verified': '_read_tool_digital_in_verified(' in get_di,
        'tool_di_no_stale_readback': 'robot.get_tool_digital_in(' not in get_di,
        'verified_has_probe_sentinel': 'ur_write_tool_di_probe' in verified,
        'verified_has_read_program': 'ur_read_tool_digital_in' in verified,
        'verified_refuses_without_finish': 'NOT_EXECUTED' in verified,
        # 工具数字输出：必须判发送结果
        'tool_do_checks_send': 'if not robot.set_tool_digital_out(' in set_do,
        # 状态型命令：只能声称"已下发"，并带 verified:False
        'force_mode_unverified': '"verified": False' in force and '已下发' in force,
        'end_force_unverified': '"verified": False' in end_force and '已下发' in end_force,
    }


out['honesty_contracts'] = probe_honesty_contracts()


# ---------------------------------------------------------------------------
# 14. Dashboard 陈旧应答串台：没收到应答时，绝不把上一条的应答交出去
# ---------------------------------------------------------------------------

def probe_dashboard_crosstalk():
    """真的建一条 TCP 连接（假 Dashboard 服务端**故意不回答**），验证两件事：

      - "发送成功" ≠ "收到应答"：`sendCommand()` 必须返回 (False, '')；
      - 它**绝不能**把上一条命令留下的 "true" 交出去。

    真机故障链：上一条 `isProgramSaved` 回过 "True"，于是 `is in remote control` 被报成
    true ⇒ 模型据此下发 URScript，而控制器在本地/示教器模式下把它静默丢弃。
    """
    import socket
    import threading
    from URBasic import dashboard as dashmod

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('127.0.0.1', 0))
    server.listen(1)
    port = server.getsockname()[1]
    seen = []

    def serve():
        try:
            conn, _ = server.accept()
        except OSError:
            return
        buf = b''
        try:
            while True:
                chunk = conn.recv(dashmod.RECV_CHUNK)
                if not chunk:
                    break
                buf += chunk
                while b'\n' in buf:
                    line, buf = buf.split(b'\n', 1)
                    seen.append(line.decode('utf-8', 'replace').strip())
                    # 故意不回答任何命令：模拟"应答没回来 / 接收线程已死"。
        except OSError:
            pass

    threading.Thread(target=serve, daemon=True).start()

    old_timeout = dashmod.DEFAULT_TIMEOUT
    dashmod.DEFAULT_TIMEOUT = 0.25          # 让探针在秒级内跑完
    sock = socket.create_connection(('127.0.0.1', port), timeout=2)
    try:
        dash = dashmod.DashBoard.__new__(dashmod.DashBoard)
        dash._DashBoard__robotModel = None
        dash._DashBoard__reconnectTimeout = 2
        dash._DashBoard__conn_state = dashmod.ConnectionState.STARTED
        dash.last_respond = 'true'          # ← 上一条命令留下的陈旧应答
        dash.respond_seq = 7
        dash._DashBoard__recv_buf = ''
        dash._DashBoard__stop_event = False
        dash._DashBoard__dataEvent = threading.Condition()
        dash._DashBoard__dataAccess = threading.Lock()
        dash._DashBoard__sock = sock

        ok, respond = dash.sendCommand('ur_is_remote_control')
        seq_after = dash.respond_seq
    finally:
        dashmod.DEFAULT_TIMEOUT = old_timeout
        for closable in (sock, server):
            try:
                closable.close()
            except OSError:
                pass

    return {
        'sent': list(seen),
        'ok': bool(ok),
        'respond': str(respond),
        'seq_unchanged': seq_after == 7,
    }


out['dashboard_crosstalk'] = probe_dashboard_crosstalk()


# ---------------------------------------------------------------------------
# 15. Dashboard 契约（源码级）：notify 只能由"真的收到消息"触发
# ---------------------------------------------------------------------------

def probe_dashboard_contract():
    src = open(os.path.join(PY, 'URBasic', 'dashboard.py'), encoding='utf-8').read()
    run_body = src[src.index('def run(self):'):src.index('def wait_dbs(')]
    seg = run_body[run_body.index('msg = self.__receive()'):]
    seg = seg[:seg.index('t0 = time.time()')]
    return {
        # notify 必须落在 `if msg is not None:` 分支内（空轮通知会让 wait_dbs 假醒）
        'notify_inside_message_branch': 'notifyAll()' in seg and 'if msg is not None:' in seg,
        'seq_incremented': 'self.respond_seq += 1' in seg,
        'send_awaits_by_seq': '__await_respond(before_seq' in src,
        'sendcommand_guards_stale': "'respond_seq', 0) == before_seq" in src,
        'recv_accumulates_and_splits': 'self.__recv_buf' in src and 'rfind' in src,
        'recv_chunk_is_bigger': 'recv(RECV_CHUNK)' in src,
    }


out['dashboard_contract'] = probe_dashboard_contract()


# ---------------------------------------------------------------------------
# 16. 状态型命令的诚实性：一律走 ok_unverified（措辞降级 + verified:False）
# ---------------------------------------------------------------------------

UNVERIFIED_OPS = [
    'op_set_tool_voltage', 'op_set_tcp', 'op_set_payload', 'op_set_payload_inertia',
    'op_force_mode_settings', 'op_tool_communication', 'op_set_tool_output_mode',
    'op_motion_version', 'op_set_conveyor_tick', 'op_set_gravity', 'op_zero_ftsensor',
    'op_conveyor_tracking',
]


def probe_unverified_ops():
    src = open(os.path.join(PY, 'ur_worker.py'), encoding='utf-8').read()
    result = {}
    for name in UNVERIFIED_OPS:
        start = src.index('def %s(' % name)
        end = src.index('\ndef ', start + 1)
        body = src[start:end]
        result[name] = {
            'uses_ok_unverified': 'return ok_unverified({' in body,
            'no_plain_ok_success': 'return ok({' not in body,
        }
    return result


out['unverified_ops'] = probe_unverified_ops()


def probe_ok_unverified_behavior():
    """`ok_unverified()` 真的降级了吗？（这不是源码匹配，是把函数跑一遍）"""
    out = ur_worker.ok_unverified({"message": "已设置 X", "data": {"ip": "1.2.3.4"}})
    data = out.get("data") or {}
    message = out.get("message") or ""
    return {
        'verified_false': data.get('verified') is False,
        'keeps_original_fields': data.get('ip') == '1.2.3.4',
        'message_keeps_head': message.startswith('已设置 X'),
        'message_appends_note': '未校验' in message,
    }


out['ok_unverified_behavior'] = probe_ok_unverified_behavior()


# ---------------------------------------------------------------------------
# 17. RTDE：START 应答必须被采信 + 收包必须跨 recv 边界累积
#
# 两条都用**真 socket 对**驱动 `__receive()`（不是把它 mock 掉），因为缺陷正好在
# "字节怎么被切开"这一层：mock 掉就什么都测不出来。
# ---------------------------------------------------------------------------

def probe_rtde_start_and_buffer():
    import socket
    import struct
    import threading
    from URBasic import rtde as rtdemod
    from URBasic.connectionState import ConnectionState as CS

    def pair():
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(('127.0.0.1', 0))
        srv.listen(1)
        cli = socket.create_connection(srv.getsockname(), timeout=2)
        conn, _ = srv.accept()
        return srv, cli, conn

    def make_rt(cli):
        rt = rtdemod.RTDE.__new__(rtdemod.RTDE)
        rt._RTDE__sock = cli
        rt._RTDE__conn_state = CS.CONNECTED
        rt._RTDE__dataEvent = threading.Condition()
        rt._RTDE__recv_buffer = bytes()
        rt._RTDE__recv_resync_bytes = 0
        rt._RTDE__start_refused = False
        rt._RTDE__receive_progress = False
        return rt

    cmd = rtdemod.Command.RTDE_CONTROL_PACKAGE_START
    result = {}

    # (a) accepted=False：**绝不能**把状态置成 STARTED
    srv, cli, conn = pair()
    try:
        rt = make_rt(cli)
        conn.sendall(struct.pack('>HB', 4, cmd) + b'\x00')
        rt._RTDE__receive()
        result['refused_is_running'] = bool(rt.isRunning())
        result['refused_flag'] = bool(getattr(rt, '_RTDE__start_refused', False))
        # (b) accepted=True：必须恢复 STARTED
        conn.sendall(struct.pack('>HB', 4, cmd) + b'\x01')
        rt._RTDE__receive()
        result['accepted_is_running'] = bool(rt.isRunning())
    finally:
        for s in (conn, cli, srv):
            try:
                s.close()
            except OSError:
                pass

    # (c) 跨 recv 边界的半包：先发一半 → 必须**留着**（不入状态、不清空）；补齐后 → 必须处理
    srv, cli, conn = pair()
    try:
        rt = make_rt(cli)
        frame = struct.pack('>HB', 4, cmd) + b'\x01'
        conn.sendall(frame[:3])
        time.sleep(0.05)
        rt._RTDE__receive()
        result['half_not_processed'] = not rt.isRunning()
        result['half_kept_in_buffer'] = len(rt._RTDE__recv_buffer) == 3
        conn.sendall(frame[3:])
        time.sleep(0.05)
        rt._RTDE__receive()
        result['completed_after_second_half'] = bool(rt.isRunning())
    finally:
        for s in (conn, cli, srv):
            try:
                s.close()
            except OSError:
                pass

    return result


out['rtde_start_buffer'] = probe_rtde_start_and_buffer()


# ---------------------------------------------------------------------------
# 18. 日志限幅按字节算（中文下按字符算会把上限撑到约 3 倍）
# ---------------------------------------------------------------------------

def probe_capped_log_bytes():
    import tempfile
    path = os.path.join(tempfile.gettempdir(), 'dsh-capped-log-probe.log')
    for stale in (path, path + '.1'):
        try:
            os.remove(stale)
        except OSError:
            pass
    log = ur_worker._CappedLog(path, 64)
    # 每次写 10 个中文字符 = **30 字节**。按字符算会以为每次只写 10 ⇒ 5 次后仍不滚动。
    for _ in range(5):
        log.write("中" * 10)
    log.flush()
    size = os.path.getsize(path)
    rolled = os.path.exists(path + '.1')
    log._handle.close()
    for stale in (path, path + '.1'):
        try:
            os.remove(stale)
        except OSError:
            pass
    return {'live_size_bytes': size, 'rolled': rolled}


out['capped_log_bytes'] = probe_capped_log_bytes()


# ---------------------------------------------------------------------------
# 19. realTimeClient.Send 必须先等上一段程序静默（否则两线程并发写同一 socket）
# ---------------------------------------------------------------------------

def probe_send_quiesces():
    from URBasic import realTimeClient as rtcmod
    from URBasic.connectionState import ConnectionState as CS

    class _FakeThread:
        def __init__(self):
            self.joined = 0

        def join(self):
            self.joined += 1

    class _Model:
        def __init__(self):
            self.rtcConnectionState = CS.STARTED
            self.rtcProgramRunning = False
            self.rtcProgramExecutionError = False
            self.stopRunningFlag = False

    client = rtcmod.RealTimeClient.__new__(rtcmod.RealTimeClient)
    client._RealTimeClient__robotModel = _Model()
    client._RealTimeClient__thread = _FakeThread()
    sent = []
    # 绕开真正的 socket：只记录"发出去的字符串"
    client._RealTimeClient__sendPrg = lambda prg: (sent.append(prg), True)[1]
    returned = client.Send('set_digital_out(0, True)\n')
    return {
        'returns_true': returned is True,
        'joined_waiting_thread': client._RealTimeClient__thread.joined == 1,
        'sent_payload': (sent[0] if sent else None),
    }


out['send_quiesces'] = probe_send_quiesces()


# ---------------------------------------------------------------------------
# 20. 契约（源码级）：list_programs 必须回报"用了内置默认口令"与主机密钥策略
# ---------------------------------------------------------------------------

def probe_list_programs_contract():
    src = open(os.path.join(PY, 'ur_worker.py'), encoding='utf-8').read()
    start = src.index('def op_list_programs(')
    end = src.index('\ndef ', start + 1)
    body = src[start:end]
    return {
        'reports_default_password': 'used_default_password' in body,
        'reports_host_key_policy': 'host_key_policy' in body,
        'warns_about_mitm': 'AutoAddPolicy' in body and '中间人' in body,
        # 真硬化必须有一条**可选**的严格路径：传了 known_hosts 就走 RejectPolicy。
        'supports_known_hosts': 'known_hosts' in body and 'RejectPolicy' in body,
        'no_silent_fallback': 'known_hosts 指向的文件不存在' in body,
    }


out['list_programs_contract'] = probe_list_programs_contract()


ur_worker._PROTOCOL_OUT.write(json.dumps(out, ensure_ascii=False) + '\n')
ur_worker._PROTOCOL_OUT.flush()

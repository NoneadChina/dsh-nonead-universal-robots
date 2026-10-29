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
    'op_motion_version', 'op_set_gravity', 'op_zero_ftsensor',
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


# ---------------------------------------------------------------------------
# 21. 新工具契约：ur_check_pose（可达性/安全限值预检）与 ur_set_speed_scaling（速度滑块）
# ---------------------------------------------------------------------------

def probe_new_ops_contract():
    """源码级契约：两条新 op 必须走"能回读/能自证"的路径，而不是"发出去就算成功"。

    ⚠️ `check_pose` 的 URScript 生成已抽成纯函数 `check_pose_script()`（为了能离线单测
    "布尔值不得写整数寄存器"这条类型约束），所以"实现"要看**两段**：
    脚本生成 + 判定逻辑 —— 少看一段，断言就会指着空气说话。
    """
    src = open(os.path.join(PY, 'ur_worker.py'), encoding='utf-8').read()

    def body_of(name):
        start = src.index('def %s(' % name)
        return src[start:src.index('\ndef ', start + 1)]

    check_body = body_of('check_pose_script') + body_of('op_check_pose')
    speed_body = body_of('op_set_speed_scaling')
    return {
        'check_pose_dispatched': '"check_pose": op_check_pose' in src,
        'speed_dispatched': '"set_speed_scaling": op_set_speed_scaling' in src,
        'check_uses_safety_limits': 'is_within_safety_limits' in check_body,
        'check_uses_inverse_kin': 'get_inverse_kin' in check_body,
        'check_has_sentinels': 'start_token' in check_body and 'finish_token' in check_body,
        'check_reports_not_executed': 'NOT_EXECUTED' in check_body,
        # 写 double 寄存器必须用仓库已验证过的 write_output_float_register（不是 RTDE 字段名）。
        'check_writes_registers': ('write_output_float_register' in check_body
                                   and 'write_output_integer_register' in check_body),
        'speed_uses_slider': 'set_speed_slider' in speed_body,
        'speed_reads_back': 'target_speed_fraction' in speed_body,
        'speed_marks_unverified_hw': 'hardware_verified' in speed_body,
    }


out['new_ops_contract'] = probe_new_ops_contract()


def probe_pose6_validation():
    """`_pose6` 必须挡住畸形输入（BADARG 的来源），而不是把垃圾拼进 URScript。"""
    results = {'accepts_valid': ur_worker._pose6([1, 2, 3, 0, 0, 0], 'pose') == [1.0, 2.0, 3.0, 0.0, 0.0, 0.0]}
    cases = {
        'short': [1, 2, 3],
        'not_a_list': 'x',
        'nan': [1, 2, 3, 4, 5, float('nan')],
        'inf': [1, 2, 3, 4, 5, float('inf')],
        'text_element': [1, 2, 3, 4, 5, 'a'],
    }
    for name, bad in cases.items():
        try:
            ur_worker._pose6(bad, 'pose')
            results['rejects_' + name] = False
        except ValueError:
            results['rejects_' + name] = True
    return results


out['pose6_validation'] = probe_pose6_validation()


# ---------------------------------------------------------------------------
# 22. 程序文件传输契约：必须"核对做成了没有"，而不是"请求已发出"
# ---------------------------------------------------------------------------

def probe_program_ops_contract():
    src = open(os.path.join(PY, 'ur_worker.py'), encoding='utf-8').read()

    def body(name):
        start = src.index('def %s(' % name)
        return src[start:src.index('\ndef ', start + 1)]

    upload = body('op_upload_program')
    download = body('op_download_program')
    delete = body('op_delete_program')
    ops = (('upload_program', 'op_upload_program'),
           ('download_program', 'op_download_program'),
           ('delete_program', 'op_delete_program'))
    return {
        'all_dispatched': all(('"%s": %s' % pair) in src for pair in ops),
        # 上传/下载都要比对另一侧的字节数，不一致时报 VERIFY_FAILED（绝不报成功）。
        'upload_verifies_size': 'st_size' in upload and 'local_size' in upload and 'VERIFY_FAILED' in upload,
        'download_verifies_size': 'st_size' in download and 'local_size' in download and 'VERIFY_FAILED' in download,
        # 删除必须在 remove 之后再 stat 一次确认真的没了。
        'delete_rechecks': 'remove(' in delete and delete.count('stat(') >= 2 and 'VERIFY_FAILED' in delete,
        # 下载不得静默覆盖：先备份成 .bak。
        'download_backs_up': '.bak' in download and 'os.replace' in download,
        # 三者都要**显式**读凭据参数（check-tool-params 逐 op 对账声明与读取）。
        'credentials_read_explicitly': all(
            'p.get("username"' in text and 'p.get("password"' in text and 'p.get("known_hosts")' in text
            for text in (upload, download, delete)),
    }


out['program_ops_contract'] = probe_program_ops_contract()


# ---------------------------------------------------------------------------
# 23. 现场消息（示教器弹窗 / 日志）：文本注入防线 + 三个 op 的通道契约
# ---------------------------------------------------------------------------

def probe_dashboard_text_guard():
    """`_dashboard_text` 必须拒绝换行 —— dashboard 按行解析，换行等于注入另一条命令。"""
    results = {
        'accepts_normal': ur_worker._dashboard_text('请取下工件', 'text') == '请取下工件',
        'max_chars': int(ur_worker.DASHBOARD_TEXT_MAX_CHARS),
    }
    cases = {
        'newline': 'x\nshutdown',
        'cr': 'x\rshutdown',
        'empty': '',
        'spaces': '   ',
        'too_long': 'a' * (ur_worker.DASHBOARD_TEXT_MAX_CHARS + 1),
        'not_a_string': 123,
    }
    for name, bad in cases.items():
        try:
            ur_worker._dashboard_text(bad, 'text')
            results['rejects_' + name] = False
        except ValueError:
            results['rejects_' + name] = True
    return results


out['dashboard_text_guard'] = probe_dashboard_text_guard()


def probe_messaging_ops_contract():
    """三个现场消息 op 必须走 dashboard 通道，且吃文本的两个都过注入防线。"""
    src = open(os.path.join(PY, 'ur_worker.py'), encoding='utf-8').read()

    def body(name):
        start = src.index('def %s(' % name)
        return src[start:src.index('\ndef ', start + 1)]

    popup = body('op_popup_message')
    close = body('op_close_popup')
    log = body('op_add_log')
    return {
        'all_dispatched': all(('"%s": %s' % pair) in src for pair in (
            ('popup_message', 'op_popup_message'),
            ('close_popup', 'op_close_popup'),
            ('add_log', 'op_add_log'))),
        'popup_via_dashboard_args': 'ur_popup' in popup and '_dashboard_cmd_args' in popup,
        'close_via_dashboard': 'ur_close_popup' in close and '_dashboard_cmd(' in close,
        'log_via_dashboard_args': 'ur_addToLog' in log and '_dashboard_cmd_args' in log,
        'text_guard_applied': ('_dashboard_text(' in popup and '_dashboard_text(' in log),
        # 拿不到控制器应答时必须报 NOT_EXECUTED，不能假装成功。
        'honest_on_no_reply': all('NOT_EXECUTED' in text for text in (popup, close, log)),
    }


out['messaging_ops_contract'] = probe_messaging_ops_contract()


# ---------------------------------------------------------------------------
# 24. Modbus：八个 op 的通道契约 + 信号名/字节数组的注入与范围防线 + 门禁归属
# ---------------------------------------------------------------------------

MODBUS_OPS = ('op_modbus_add_signal', 'op_modbus_delete_signal', 'op_modbus_get_signal_status',
              'op_modbus_send_custom_command', 'op_modbus_set_output_register',
              'op_modbus_set_output_signal', 'op_modbus_set_runstate_dependent_choice',
              'op_modbus_set_signal_update_frequency')


def probe_modbus_contract():
    """八个 op 必须走"首尾哨兵 + 三种结局"的公共运行器，且如实标注现场总线未被确认。"""
    src = open(os.path.join(PY, 'ur_worker.py'), encoding='utf-8').read()

    def body(name):
        start = src.index('def %s(' % name)
        return src[start:src.index('\ndef ', start + 1)]

    bodies = {name: body(name) for name in MODBUS_OPS}
    status = bodies['op_modbus_get_signal_status']
    host_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'lib', 'index.js')
    host = open(host_path, encoding='utf-8').read()
    approval = host[host.index('const APPROVAL_OPS = new Set(['):]
    approval = approval[:approval.index(']);')]
    return {
        'all_dispatched': all(('"%s": %s' % (name[3:], name)) in src for name in MODBUS_OPS),
        'all_use_sentinel_runner': all(
            ('_modbus_verdict' in text or '_run_sentinel_script' in text) for text in bodies.values()),
        'declares_fieldbus_unconfirmed': 'fieldbus_confirmed' in src,
        # 唯一有回读的那条必须真的回读 payload 寄存器
        'status_reads_back': 'MODBUS_PAYLOAD_REGISTER' in status,
        # 数字/寄存器两种 kind 必须生成不同的脚本（URScript 强类型，不能靠一次转换蒙混）
        'status_kind_branches': ('if v == True:' in status
                                 and 'write_output_float_register(%d, v)' in status),
        'validators_used': all('_modbus_text(' in bodies[name] for name in (
            'op_modbus_add_signal', 'op_modbus_delete_signal',
            'op_modbus_set_output_register', 'op_modbus_set_output_signal')),
        'byte_list_validated': '_modbus_byte_list(' in bodies['op_modbus_send_custom_command'],
        # 门禁归属：五个写类必须入，只读那个与两个配置项必须不入
        'write_ops_gated': all("'%s'" % name[3:] in approval for name in (
            'op_modbus_add_signal', 'op_modbus_delete_signal', 'op_modbus_send_custom_command',
            'op_modbus_set_output_register', 'op_modbus_set_output_signal')),
        'read_op_not_gated': "'modbus_get_signal_status'" not in approval,
        'config_ops_not_gated': ("'modbus_set_runstate_dependent_choice'" not in approval
                                 and "'modbus_set_signal_update_frequency'" not in approval),
    }


out['modbus_contract'] = probe_modbus_contract()


def probe_modbus_validators():
    """信号名/IP/整数/字节数组的防线：注入与越界都必须被拒。"""
    results = {'accepts_signal_name': ur_worker._modbus_text('output1', 'signal_name') == 'output1',
               'accepts_ip': ur_worker._modbus_ip('192.168.1.10', 'unit_ip') == '192.168.1.10',
               'accepts_bytes': ur_worker._modbus_byte_list([17, 32, 2, 88], 'data') == [17, 32, 2, 88]}
    text_cases = {'quote_injection': 'a", 0)', 'newline_injection': 'a\nshutdown()',
                  'semicolon': 'a;b', 'empty': '', 'not_a_string': 5}
    for name, bad in text_cases.items():
        try:
            ur_worker._modbus_text(bad, 'signal_name')
            results['rejects_text_' + name] = False
        except ValueError:
            results['rejects_text_' + name] = True
    for name, bad in {'octet_overflow': '192.168.1.300', 'not_an_ip': 'plc.local'}.items():
        try:
            ur_worker._modbus_ip(bad, 'unit_ip')
            results['rejects_ip_' + name] = False
        except ValueError:
            results['rejects_ip_' + name] = True
    for name, bad in {'byte_too_big': [256], 'empty': [], 'not_a_list': 'x'}.items():
        try:
            ur_worker._modbus_byte_list(bad, 'data')
            results['rejects_bytes_' + name] = False
        except ValueError:
            results['rejects_bytes_' + name] = True
    for name, bad in {'out_of_range': 70000, 'not_a_number': 'x'}.items():
        try:
            ur_worker._modbus_int(bad, 'register_value', 0, 65535)
            results['rejects_int_' + name] = False
        except ValueError:
            results['rejects_int_' + name] = True
    return results


out['modbus_validators'] = probe_modbus_validators()


# ---------------------------------------------------------------------------
# 25. 力控引导运动（move_force）：脚本形状 + 绝不碰 RTDE 输入 + 门禁归属
# ---------------------------------------------------------------------------

def probe_move_force_contract():
    src = open(os.path.join(PY, 'ur_worker.py'), encoding='utf-8').read()
    start = src.index('def op_move_force(')
    body = src[start:src.index('\ndef ', start + 1)]
    # 只看代码、不看 docstring —— docstring 里**必须**写清"为什么不用 move_force_2stop"，
    # 那个名字与 input_double_register 都会出现在注释里，不能据此判定它写了输入寄存器。
    code = body[body.index('"""', body.index('"""') + 3) + 3:]
    host = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'lib', 'index.js'),
                encoding='utf-8').read()
    approval = host[host.index('const APPROVAL_OPS = new Set(['):]
    approval = approval[:approval.index(']);')]
    return {
        'dispatched': '"move_force": op_move_force' in src,
        # 脚本形状与 urScriptExt.move_force（:510-535）一致：进力控 → 直线运动 → 减速 → 退力控
        'script_shape': all(token in code for token in (
            'force_mode(', 'movel(', 'stopl(', 'end_force_mode()')),
        # ★ 绝不写 RTDE 输入寄存器：本插件没有 send 配方，claim 输入字段会让控制器抛异常
        'no_rtde_input_write': ('input_double_register' not in code
                                and 'setData(' not in code
                                and 'set_force_remote' not in code),
        'reads_pose_before_after': ('tcp_pose_before' in code and 'tcp_pose_after' in code
                                    and '_simple_pose(' in code),
        'uses_sentinel_runner': '_run_sentinel_script(' in code,
        'reports_shortfall': 'shortfall_m' in code and 'reached_target' in code,
        'declares_safety_flag': 'stopped_due_to_safety' in code,
        'gated': "'move_force'" in approval,
    }


out['move_force_contract'] = probe_move_force_contract()


def probe_selection_vector_guard():
    """力控选择向量只接受 6 个 0/1（布尔按 0/1 归一化，否则会渲染成 True/False 下发）。"""
    results = {
        'accepts_valid': ur_worker._selection6([0, 0, 1, 0, 0, 0]) == [0, 0, 1, 0, 0, 0],
        'accepts_bool_as_int': ur_worker._selection6([False, False, True, False, False, False]) == [0, 0, 1, 0, 0, 0],
    }
    for name, bad in {'short': [0, 0, 1], 'two': [0, 0, 2, 0, 0, 0],
                      'string': [0, 0, '1', 0, 0, 0], 'not_a_list': 1}.items():
        try:
            ur_worker._selection6(bad)
            results['rejects_' + name] = False
        except ValueError:
            results['rejects_' + name] = True
    return results


out['selection_vector_guard'] = probe_selection_vector_guard()


# ---------------------------------------------------------------------------
# 26. 命名位姿表：四个 pose op 的契约（原子写 + 回读 + 区分缺失/损坏 + 配额 + 跨语言常量一致）
# ---------------------------------------------------------------------------

def _size_product(text):
    """把 `64 * 1024`（可能带 `;` 或 `=`）算出一个数 —— 按"数字串"提取，不用 re。

    ⚠️ 不能用 `str.isdigit()` 逐 token 判：`1024;` 会被判成非数字，于是只取到 64，
    断言就会以"两个常量不一致"的形式误报（本探针第一版就是这么错的）。
    """
    parts = []
    current = ''
    for char in text:
        if char.isdigit():
            current += char
        elif current:
            parts.append(int(current))
            current = ''
    if current:
        parts.append(int(current))
    if not parts:
        return 0
    if len(parts) == 1:
        return parts[0]
    return parts[0] * parts[1]


def probe_pose_ops_contract():
    src = open(os.path.join(PY, 'ur_worker.py'), encoding='utf-8').read()

    def code_of(name):
        start = src.index('def %s(' % name)
        text = src[start:src.index('\ndef ', start + 1)]
        # 只看代码：docstring 里写着「不存在」「损坏」这些词本身，不能据此判定实现。
        return text[text.index('"""', text.index('"""') + 3) + 3:]

    save = code_of('op_pose_save')
    get = code_of('op_pose_get')
    listing = code_of('op_pose_list')
    delete = code_of('op_pose_delete')
    host = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                             'lib', 'pose-store.js'), encoding='utf-8').read()
    host_limit_line = [l for l in host.splitlines() if 'MAX_POSE_FILE_BYTES' in l and '=' in l]
    worker_limit_line = [l for l in src.splitlines() if l.startswith('POSE_FILE_MAX_BYTES')]
    return {
        'all_dispatched': all(('"%s": %s' % pair) in src for pair in (
            ('pose_save', 'op_pose_save'), ('pose_get', 'op_pose_get'),
            ('pose_list', 'op_pose_list'), ('pose_delete', 'op_pose_delete'))),
        'atomic_write': ('os.replace(' in save and '.tmp' in save),
        'save_reads_back': ('_pose_read_json(' in save and 'VERIFY_FAILED' in save),
        'save_reports_replaced': 'replaced' in save,
        # ★ 「从没存过」与「存过但坏了」必须是两个不同的回答
        'get_separates_missing': ('"NOT_FOUND"' in get and '"CORRUPT"' in get),
        'get_flags_shape': 'pose_well_formed' in get,
        # ★ 单个损坏条目不能让整张表失败
        'list_survives_corrupt': ('"ok": False' in listing and 'broken' in listing),
        'delete_rechecks': ('os.remove(' in delete and delete.count('os.path.exists(') >= 2
                            and 'VERIFY_FAILED' in delete),
        'quota_respects_existing': ('existed' in save and 'BADARG' in save),
        # 跨语言常量一致：宿主的 MAX_POSE_FILE_BYTES 与 worker 的 POSE_FILE_MAX_BYTES 必须相等
        'limit_matches_host': bool(host_limit_line and worker_limit_line
                                   and _size_product(host_limit_line[0]) == _size_product(worker_limit_line[0])),
    }


out['pose_ops_contract'] = probe_pose_ops_contract()


# ---------------------------------------------------------------------------
# 22. `check_pose_script`：URScript 是**强类型**的 —— 布尔值不得直接写整数寄存器
#
# 真机踩出来的 bug：`write_output_integer_register(19, is_within_safety_limits(p))` 会让控制器
# **在该行抛错中止** ⇒ 限值答案没被写下、`get_inverse_kin` 也没被调用；而整数寄存器回读到的是
# 0（**不是** None），工具于是把"机器人此刻正站着的位姿"报成"不在安全限值内 + IK 解不出"（假阴性，
# 会让模型拒绝完全可达的位姿）。修复后：布尔值先落 `local`，再 `if/else` 写 1/0，并加阶段标记。
#
# 这里对**生成的脚本文本**做类型检查：所有 `write_output_integer_register` 的第 2 个实参
# 都必须是整数字面量 —— 这条断言直接等价于"不再有布尔值写整数寄存器"。
# ---------------------------------------------------------------------------

def probe_check_pose_script_types():
    import re
    pose = [-0.2199266, -0.7992707, 0.4120088, -0.0006115, 3.1113093, 0.0415924]
    qnear = [-1.6, -1.73, -2.2, -0.81, 1.6, -0.03]
    # token 用大而互不相同的数，避免"11 恰好出现在浮点字面量里"这类误判。
    tok = dict(start_token=111111, stage1_token=222222, stage2_token=333333, finish_token=444444)
    plain = ur_worker.check_pose_script(pose, None, **tok)
    with_near = ur_worker.check_pose_script(pose, qnear, **tok)
    calls = re.findall(r'write_output_integer_register\((\d+),\s*([^)]*)\)', plain)
    limits = ur_worker.CHECK_POSE_LIMITS_REGISTER
    stage = ur_worker.CHECK_POSE_STAGE_REGISTER
    return {
        'int_register_args_are_literals': bool(calls) and all(v.strip().isdigit() for _, v in calls),
        'no_bool_into_int_register': 'is_within_safety_limits' not in ''.join(
            v for _, v in calls),
        'bool_lands_in_local_first': 'local within = is_within_safety_limits(p_target)' in plain,
        'writes_both_branches': ('  if within:' in plain and '  else:' in plain
                                 and '  end' in plain
                                 and ('write_output_integer_register(%d, 1)' % limits) in plain
                                 and ('write_output_integer_register(%d, 0)' % limits) in plain),
        'stage_register_distinct_from_limits': limits != stage,
        'stage1_before_ik': plain.index(str(tok['stage1_token'])) < plain.index('get_inverse_kin'),
        'stage2_after_ik_result': (plain.index('get_inverse_kin') < plain.index(str(tok['stage2_token']))
                                   and plain.index('write_output_float_register') < plain.index(str(tok['stage2_token']))),
        'sentinels_bracket_script': (plain.index(str(tok['start_token'])) < plain.index('local p_target')
                                     and plain.index(str(tok['finish_token'])) > plain.index(str(tok['stage2_token']))),
        'qnear_optional': ('get_inverse_kin(p_target)' in plain
                           and 'get_inverse_kin(p_target, [' in with_near),
        'one_script_per_call': plain.startswith('def dsh_check_pose():') and plain.rstrip().endswith('dsh_check_pose()'),
    }


out['check_pose_script_types'] = probe_check_pose_script_types()


# ---------------------------------------------------------------------------
# 23. `op_set_conveyor_tick` 必须**自己回读确认**（它已从"只能声称已下发"的清单里毕业）
#
# 真机实测：写入 tick=1234 后回读仍是 0，而旧实现只回报"已设置（未校验）" —— 调用方既不知道生效没生效，
# 也不知道该查什么。同族的 `op_get_conveyor` 早就有完整三哨兵回读，所以修法是复用同一个读取器。
# ---------------------------------------------------------------------------

def probe_conveyor_set_contract():
    src = open(os.path.join(PY, 'ur_worker.py'), encoding='utf-8').read()
    start = src.index('def op_set_conveyor_tick(')
    text = src[start:src.index('\ndef ', start + 1)]
    # ★ 只看**代码**：这个函数的 docstring 里逐字写着那条反面写法（`.get("ok")`）当教训，
    #   拿整段文本去匹配就会把"讲过的错"当成"犯着的错"（第一版探针就是这么误报的，
    #   被全量套件当场抓住）。与 `probe_pose_ops_contract` 的 `code_of()` 同一套办法。
    body = text[text.index('"""', text.index('"""') + 3) + 3:]
    return {
        'still_dispatches': 'set_conveyor_tick_count(' in body,
        'reuses_verified_reader': 'op_get_conveyor(' in body,
        'reports_verified_only_after_readback': ('op_get_conveyor(' in body and 'verified=True' in body
                                                and body.index('op_get_conveyor(') < body.index('verified=True')),
        'honest_on_mismatch': ('ok_unverified({' in body and '没有生效' in body),
        'honest_when_read_fails': 'read_back_error' in body,
        # ★ `ok(data)` 是恒等函数（信封的 ok:true 由 main() 序列化时加），所以 handler 之间传阅的结果
        #   字典里没有 "ok" 键 —— 判"成功与否"只能看 "error" 键。第一版写成 `.get("ok")` 就恒为假。
        'discriminates_by_error_key': 'read_back.get("error") is not None' in body,
        'does_not_inspect_ok_key': '.get("ok")' not in body,
        'graduates_from_unverified_list': 'op_set_conveyor_tick' not in UNVERIFIED_OPS,
    }


out['conveyor_set_contract'] = probe_conveyor_set_contract()


# ---------------------------------------------------------------------------
# 24. FIX_PLAN_074 C5/C6/C7：程序确认、远端路径牢笼、注入路径、数值防线
#
# 这一组都是**行为**探针：把真实的 handler 跑在假 dashboard / 假 SSH 上，观察它
# "有没有 play"、"有没有先 stat"、"有没有拒绝"。只读源码字符串钉不住这些语义 ——
# 例如 P0 的根因不是少了一行判断，而是判断用了错的对象（看的是 loaded，不是 load 应答）。
# ---------------------------------------------------------------------------

def probe_program_confirmation_contract():
    """C5/C6/C7 的行为回归：三坏路径不 play、delete 路径牢笼、注入路径、NaN/幅值。"""
    import types

    results = {}
    errors = {}
    originals = {name: getattr(ur_worker, name) for name in (
        'ensure_connected', 'dashboard', '_dashboard_cmd_args', '_loaded_program',
        '_dashboard_cmd', '_program_running', '_ssh_client', '_assert_remote_control',
        '_movel_confirm')}

    class FakeDash:
        def __init__(self, load_reply=None, loaded='', play_reply='Starting program'):
            self.load_reply = load_reply
            self.loaded = loaded
            self.play_reply = play_reply
            self.played = False
            self.last_respond = None
            self.respond_seq = 0

    def wire(dash, load_sent=True, play_ok=True):
        ur_worker.ensure_connected = lambda ip: (types.SimpleNamespace(), types.SimpleNamespace())
        ur_worker.dashboard = lambda ip: dash
        ur_worker._dashboard_cmd_args = lambda ip, cmd, *args: (load_sent, dash.load_reply or '')
        ur_worker._loaded_program = lambda d: dash.loaded

        def cmd_side_effect(ip, cmd):
            if cmd == 'ur_play':
                dash.played = play_ok
                return play_ok, dash.play_reply
            return True, ''

        ur_worker._dashboard_cmd = cmd_side_effect
        ur_worker._program_running = lambda ip: False

    try:
        # --- P0：三种坏路径都不得 play ---
        bad_run = {
            'file_not_found': (FakeDash('File not found: NEW.urp',
                                        'Program loaded: /programs/OLD.urp'), True),
            'no_reply': (FakeDash(None, 'Program loaded: /programs/OLD.urp'), False),
            'load_ignored': (FakeDash('Loading program: NEW.urp',
                                      'Program loaded: /programs/OLD.urp'), True),
        }
        for name, (dash, sent) in bad_run.items():
            wire(dash, load_sent=sent)
            res = ur_worker.op_run_program({'ip': 'ip', 'program_name': 'NEW.urp'})
            results['run_rejects_' + name] = ('error' in res and dash.played is False)

        good = FakeDash('Loading program: /programs/NEW.urp', 'Program loaded: /programs/NEW.urp')
        wire(good)
        res = ur_worker.op_run_program({'ip': 'ip', 'program_name': 'NEW.urp'})
        results['run_plays_only_with_evidence'] = ('error' not in res and good.played is True)

        # --- load_program confirmed 语义 ---
        match = FakeDash('Loading program: NEW.urp', 'Program loaded: /programs/NEW.urp')
        wire(match)
        res = ur_worker.op_load_program({'ip': 'ip', 'program_name': 'NEW.urp'})
        results['load_confirmed_true_with_evidence'] = (
            'error' not in res and (res.get('data') or {}).get('confirmed') is True)
        # 成功应答会回显程序路径：文件名里带 "error" 不得被当成加载失败。
        tricky = FakeDash('Loading program: /programs/error_pick.urp',
                          'Program loaded: /programs/error_pick.urp')
        wire(tricky)
        res = ur_worker.op_load_program({'ip': 'ip', 'program_name': 'error_pick.urp'})
        results['load_not_fooled_by_error_in_program_name'] = (
            'error' not in res and (res.get('data') or {}).get('confirmed') is True)
        results['load_reply_failure_words'] = (
            ur_worker._load_reply_failed('Could not load program: x.urp') is True
            and ur_worker._load_reply_failed('Loading program: error_pick.urp') is False
            and ur_worker._load_reply_failed('') is False)
        mismatch = FakeDash('Loading program: NEW.urp', 'Program loaded: /programs/OLD.urp')
        wire(mismatch)
        res = ur_worker.op_load_program({'ip': 'ip', 'program_name': 'NEW.urp'})
        results['load_errs_on_mismatch'] = 'error' in res
        unknown = FakeDash(None, '')
        wire(unknown, load_sent=False)
        res = ur_worker.op_load_program({'ip': 'ip', 'program_name': 'NEW.urp'})
        results['load_confirmed_none_when_unknown'] = (
            'error' not in res and (res.get('data') or {}).get('confirmed') is None)

        # --- basename 比对（dashboard 带标签/绝对路径） ---
        results['basename_match_handles_label_and_relative'] = (
            ur_worker._program_paths_match('Program loaded: /programs/pick.urp', 'pick.urp')
            and ur_worker._program_paths_match('/programs/pick.urp', 'pick.urp'))
        results['basename_match_rejects_other_program'] = not ur_worker._program_paths_match(
            'Program loaded: /programs/old.urp', 'pick.urp')

        # --- delete 远端路径牢笼（必须在 SSH 之前拒绝） ---
        ssh_calls = {'n': 0}

        def ssh_factory(ip, username, password, known_hosts):
            ssh_calls['n'] += 1
            raise AssertionError('SSH 不应被调用')

        ur_worker._ssh_client = ssh_factory
        for bad in ('/etc/passwd', 'etc/passwd', '/programs/../etc/passwd', '/programs/x.txt', ''):
            res = ur_worker.op_delete_program({'ip': 'ip', 'remote_path': bad})
            results['delete_rejects_' + (bad.replace('/', '_').replace('.', '_') or 'empty')] = (
                'error' in res)
        results['delete_rejected_before_ssh'] = ssh_calls['n'] == 0

        # --- upload：注入路径优先；_local_path 必须绝对 ---
        import tempfile as _tempfile
        import atexit as _atexit
        import shutil as _shutil
        work = _tempfile.mkdtemp(prefix='ur-harness-')
        # P5：临时目录必须自己收拾。Python 的 tempfile 在候选临时目录**不可写**时会静默回退到
        # `os.getcwd()` —— 本机实测 `tempfile.gettempdir()` 就返回仓库根，于是每跑一次套件就在
        # 仓库里留一个 `ur-harness-*` 目录。退出时删掉，无论中间控制流怎么走。
        _atexit.register(_shutil.rmtree, work, ignore_errors=True)
        local_file = os.path.join(work, 'pick.urp')
        with open(local_file, 'w', encoding='utf-8') as fh:
            fh.write('<urp/>')

        class FakeSftp:
            def __init__(self):
                self.calls = []
                self.local = None
                self.remote_size = None

            def put(self, local, remote):
                self.local = local
                self.calls.append(('put', local, remote))

            def stat(self, remote):
                self.calls.append(('stat', remote))
                size = self.remote_size
                if size is None:
                    size = os.path.getsize(self.local) if self.local else 0
                return types.SimpleNamespace(st_size=size)

            def get(self, remote, local):
                self.calls.append(('get', remote, local))
                with open(local, 'wb') as fh:
                    fh.write(b'x' * (self.remote_size or 1))

            def remove(self, remote):
                self.calls.append(('remove', remote))

            def close(self):
                pass

        class FakeSSH:
            def __init__(self):
                self.sftp = FakeSftp()

            def open_sftp(self):
                return self.sftp

            def close(self):
                pass

        upload_ssh = FakeSSH()
        ur_worker._ssh_client = lambda ip, u, pw, kh: (upload_ssh, 'test-policy')
        res = ur_worker.op_upload_program({
            'ip': 'ip', 'local_path': local_file, 'remote_path': '/programs/pick.urp',
            '_local_path': local_file, '_remote_path': '/programs/pick.urp'})
        results['upload_uses_injected_paths'] = (
            'error' not in res
            and upload_ssh.sftp.calls[:2] == [('put', local_file, '/programs/pick.urp'),
                                              ('stat', '/programs/pick.urp')])
        results['upload_reports_host_path_source'] = (
            (res.get('data') or {}).get('path_source', {}).get('local') == 'host')

        ssh_calls['n'] = 0
        ur_worker._ssh_client = ssh_factory
        res = ur_worker.op_upload_program({
            'ip': 'ip', 'local_path': local_file, 'remote_path': '/programs/pick.urp',
            '_local_path': 'relative/pick.urp', '_remote_path': '/programs/pick.urp'})
        results['upload_rejects_relative_injected_local_path'] = (
            'error' in res and ssh_calls['n'] == 0)

        # --- download：大小上限在动本地文件之前生效 ---
        download_dir = os.path.join(work, 'out')
        os.makedirs(download_dir, exist_ok=True)
        target = os.path.join(download_dir, 'dl.urp')
        big_ssh = FakeSSH()
        big_ssh.sftp.remote_size = ur_worker.PROGRAM_FILE_MAX_BYTES + 1
        ur_worker._ssh_client = lambda ip, u, pw, kh: (big_ssh, 'test-policy')
        res = ur_worker.op_download_program({
            'ip': 'ip', 'local_path': target, 'remote_path': '/programs/big.urp',
            '_local_path': target, '_remote_path': '/programs/big.urp'})
        results['download_rejects_oversized_remote'] = ('error' in res)
        results['download_size_check_precedes_local_write'] = (
            not os.path.exists(target) and not os.path.exists(target + '.bak'))

        # --- _axis_move 的 NaN/Inf 防线 ---
        moved = []
        fake_robot = types.SimpleNamespace(
            robotConnector=types.SimpleNamespace(RealTimeClient=types.SimpleNamespace(
                SendProgram=lambda prg: True, Send=lambda prg: True)),
            get_actual_tcp_pose=lambda: [0.3, 0.0, 0.4, 0.0, 3.1416, 0.0],
            movel=lambda pose, **kw: moved.append(pose))
        ur_worker.ensure_connected = lambda ip: (fake_robot, None)
        ur_worker._assert_remote_control = lambda ip, what: None
        ur_worker._movel_confirm = lambda ip, pose, t: (False, 'stub')
        results['axis_move_rejects_nan'] = all(
            'error' in ur_worker.op_move_x({'ip': 'ip', 'distance': bad})
            for bad in (float('nan'), float('inf'), float('-inf')))
        results['axis_move_rejects_nan_tool_frame'] = all(
            'error' in ur_worker.op_move_tool_x({'ip': 'ip', 'distance': bad})
            for bad in (float('nan'), float('inf')))
        results['axis_move_never_sent_nan'] = moved == []

        # --- set_tcp 幅值上限 ---
        results['set_tcp_rejects_xyz_over_1m'] = 'error' in ur_worker.op_set_tcp(
            {'ip': 'ip', 'pose': [1.5, 0, 0, 0, 0, 0]})
        results['set_tcp_rejects_rotation_over_2pi'] = 'error' in ur_worker.op_set_tcp(
            {'ip': 'ip', 'pose': [0, 0, 0, 0, 0, 7.0]})
        results['set_tcp_accepts_in_range'] = 'error' not in ur_worker.op_set_tcp(
            {'ip': 'ip', 'pose': [0.1, 0.2, 0.3, 0, 0, 1.0]})

        # --- 105 个 op 不变 ---
        results['handlers_still_105'] = len(ur_worker.HANDLERS) == 105
    except Exception as exc:  # noqa: BLE001  —— 探针自身异常要让调用方看见，而不是静默 False
        errors['unexpected'] = '%s: %s' % (type(exc).__name__, exc)
    finally:
        for name, fn in originals.items():
            setattr(ur_worker, name, fn)

    results['_errors'] = errors
    return results


out['program_confirmation_contract'] = probe_program_confirmation_contract()


ur_worker._PROTOCOL_OUT.write(json.dumps(out, ensure_ascii=False) + '\n')
ur_worker._PROTOCOL_OUT.flush()

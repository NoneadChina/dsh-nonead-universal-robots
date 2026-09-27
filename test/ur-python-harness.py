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

ur_worker._PROTOCOL_OUT.write(json.dumps(out, ensure_ascii=False) + '\n')
ur_worker._PROTOCOL_OUT.flush()

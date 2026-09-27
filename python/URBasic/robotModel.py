__author__ = "Anthony Zhuang"
__copyright__ = "Copyright 2009-2025"
__license__ = "MIT License"

import URBasic


class RobotModel(object):
    '''
    Data class holding all data and states
         
    Input parameters:

    '''

    def __init__(self):
        '''
        Constructor see class description for more info.
        '''

        # Universal Robot Model content
        self.password = None
        self.ipAddress = None

        # 等待类自旋的上限（秒）。这几个值存在的唯一目的是让"读一次位置/等一次动作结束"
        # 永远不可能**无限**等下去 —— 上游这些循环都没有出口，一旦 RTDE 数据流或程序状态位
        # 出问题，单线程 worker 就会被永久锁死（详见 urScript.sync /
        # waitRobotIdleOrStopFlag 的注释）。worker 侧还会再用自己的命令预算收紧它们。
        self.syncTimeout = 5.0
        self.idleTimeout = 300.0

        self.dataDir = {'timestamp': None,
                        'target_q': None,
                        'target_qd': None,
                        'target_qdd': None,
                        'target_current': None,
                        'target_moment': None,
                        'actual_q': None,
                        'actual_qd': None,
                        'actual_current': None,
                        'joint_control_output': None,
                        'actual_TCP_pose': None,
                        'actual_TCP_speed': None,
                        'actual_TCP_force': None,
                        'target_TCP_pose': None,
                        'target_TCP_speed': None,
                        'actual_digital_input_bits': None,
                        'joint_temperatures': None,
                        'actual_execution_time': None,
                        'robot_mode': None,
                        'joint_mode': None,
                        'safety_mode': None,
                        'actual_tool_accelerometer': None,
                        'speed_scaling': None,
                        'target_speed_fraction': None,
                        'actual_momentum': None,
                        'actual_main_voltage': None,
                        'actual_robot_voltage': None,
                        'actual_robot_current': None,
                        'actual_joint_voltage': None,
                        'actual_digital_output_bits': None,
                        'runtime_state': None,
                        'robot_status_bits': None,
                        'safety_status_bits': None,
                        'analog_io_types': None,
                        'standard_analog_input0': None,
                        'standard_analog_input1': None,
                        'standard_analog_output0': None,
                        'standard_analog_output1': None,
                        'io_current': None,
                        'euromap67_input_bits': None,
                        'euromap67_output_bits': None,
                        'euromap67_24V_voltage': None,
                        'euromap67_24V_current': None,
                        'tool_mode': None,
                        'tool_analog_input_types': None,
                        'tool_analog_input0': None,
                        'tool_analog_input1': None,
                        'tool_output_voltage': None,
                        'tool_output_current': None,
                        'tcp_force_scalar': None,
                        'output_bit_registers0_to_31': None,
                        'output_bit_registers32_to_63': None,
                        'output_int_register_0': None,
                        'output_int_register_1': None,
                        'output_int_register_2': None,
                        'output_int_register_3': None,
                        'output_int_register_4': None,
                        'output_int_register_5': None,
                        'output_int_register_6': None,
                        'output_int_register_7': None,
                        'output_int_register_8': None,
                        'output_int_register_9': None,
                        'output_int_register_10': None,
                        'output_int_register_11': None,
                        'output_int_register_12': None,
                        'output_int_register_13': None,
                        'output_int_register_14': None,
                        'output_int_register_15': None,
                        'output_int_register_16': None,
                        'output_int_register_17': None,
                        'output_int_register_18': None,
                        'output_int_register_19': None,
                        'output_int_register_20': None,
                        'output_int_register_21': None,
                        'output_int_register_22': None,
                        'output_int_register_23': None,
                        'output_double_register_0': None,
                        'output_double_register_1': None,
                        'output_double_register_2': None,
                        'output_double_register_3': None,
                        'output_double_register_4': None,
                        'output_double_register_5': None,
                        'output_double_register_6': None,
                        'output_double_register_7': None,
                        'output_double_register_8': None,
                        'output_double_register_9': None,
                        'output_double_register_10': None,
                        'output_double_register_11': None,
                        'output_double_register_12': None,
                        'output_double_register_13': None,
                        'output_double_register_14': None,
                        'output_double_register_15': None,
                        'output_double_register_16': None,
                        'output_double_register_17': None,
                        'output_double_register_18': None,
                        'output_double_register_19': None,
                        'output_double_register_20': None,
                        'output_double_register_21': None,
                        'output_double_register_22': None,
                        'output_double_register_23': None,
                        'urPlus_force_torque_sensor': None,
                        'urPlus_totalMovedVerticalDistance': None
                        }

        self.rtcConnectionState = None
        self.rtcProgramRunning = False
        self.rtcProgramExecutionError = False
        self.stopRunningFlag = False
        self.forceRemoteActiveFlag = False
        self.servojRemoteActiveFlag = False  # modified by Daniel

        # UR plus content
        self.hasForceTorqueSensor = False
        self.forceTourqe = None

    def RobotTimestamp(self):
        return self.dataDir['timestamp']

    def LastUpdateTimestamp(self):
        raise NotImplementedError('Function Not yet implemented')

    def RTDEConnectionState(self):
        raise NotImplementedError('Function Not yet implemented')

    def RuntimeState(self):
        return self.rtcProgramRunning

    def StopRunningFlag(self):
        return self.stopRunningFlag

    def DigitalInputbits(self, n):
        if 0 <= n < 8:
            n = pow(2, n)
            return n & self.dataDir['actual_digital_input_bits'] == n
        else:
            return None

    def ConfigurableInputBits(self, n):
        '''Configurable digital input `n`（全局编号 8-15）的位。

        ⚠️ 上游写的是 `pow(2, n + 8)` —— **偏移算错了 8 位**。`actual_digital_input_bits`
        的位分配是：0-7 = 标准 DI、8-15 = 可配置 DI、16-17 = tool DI。传 n=8 时
        `2**(8+8)=2**16` 实际取到的是 **tool DI 0**，n=9 取到 tool DI 1，n≥10 则永远为
        False。也就是说 `ur_get_digital_in(which="config", n=8)` 在修好之前回答的是**另一路
        输入**的值，而本插件自己的批量读取 `_bit_masks`（ur_worker.py）用的是 n-8 的正确
        掩码 —— 同一台机器人上两个工具给出互相矛盾的结果。
        '''
        if 8 <= n < 16:
            bit = pow(2, n - 8)
            return bit & self.dataDir['actual_digital_input_bits'] == bit
        else:
            return None

    def DigitalOutputBits(self, n):
        if 0 <= n < 8:
            n = pow(2, n)
            return n & self.dataDir['actual_digital_output_bits'] == n
        else:
            return None

    def ConfigurableOutputBits(self, n):
        '''Configurable digital output `n`（全局编号 8-15）的位；同 ConfigurableInputBits，
        上游的 `pow(2, n + 8)` 会偏移到 tool DO / 越界。'''
        if 8 <= n < 16:
            bit = pow(2, n - 8)
            return bit & self.dataDir['actual_digital_output_bits'] == bit
        else:
            return None

    def RTDEProtocolVersion(self):
        raise NotImplementedError('Function Not yet implemented')

    def ActualTCPPose(self):
        return self.dataDir['actual_TCP_pose']

    def RobotModee(self):
        raise NotImplementedError('Function Not yet implemented')

    def SafetyMode(self):
        raise NotImplementedError('Function Not yet implemented')

    def TargetQ(self):
        raise NotImplementedError('Function Not yet implemented')

    def TargetQD(self):
        raise NotImplementedError('Function Not yet implemented')

    def TargetQDD(self):
        raise NotImplementedError('Function Not yet implemented')

    def TargetCurrent(self):
        raise NotImplementedError('Function Not yet implemented')

    def TargetMoment(self):
        raise NotImplementedError('Function Not yet implemented')

    def ActualQ(self):
        return self.dataDir['actual_q']

    def ActualQD(self):
        '''实际关节角速度（rad/s）。字段 `actual_qd` 本来就在 RTDE 输出配方里以 500 Hz
        流上来，上游却是个 NotImplementedError 桩 —— 读取它不需要任何新配置。'''
        return self.dataDir['actual_qd']

    def ActualCurrent(self):
        '''实际关节电流（A）。字段 `actual_current` 一直在流，上游同样是桩函数。'''
        return self.dataDir['actual_current']

    def JointControlOutput(self):
        raise NotImplementedError('Function Not yet implemented')

    def ActualTCPSpeed(self):
        return self.dataDir['actual_TCP_speed']

    def ActualTCPForce(self):
        return self.dataDir['actual_TCP_force']

    def TargetTCPPose(self):
        raise NotImplementedError('Function Not yet implemented')

    def TargetTCPSpeed(self):
        raise NotImplementedError('Function Not yet implemented')

    def JointTemperatures(self):
        return self.dataDir['joint_temperatures']

    def ActualExecutionTime(self):
        raise NotImplementedError('Function Not yet implemented')

    def JointMode(self):
        raise NotImplementedError('Function Not yet implemented')

    def ActualToolAccelerometer(self):
        return self.dataDir['actual_tool_accelerometer']

    def SpeedScaling(self):
        '''控制器当前的速度倍率（0-1）。字段 `speed_scaling` 已在配方中。'''
        return self.dataDir['speed_scaling']

    def TargetSpeedFraction(self):
        raise NotImplementedError('Function Not yet implemented')

    def ActualMomentum(self):
        return self.dataDir['actual_momentum']

    def ActualMainVoltage(self):
        raise NotImplementedError('Function Not yet implemented')

    def ActualRobotVoltage(self):
        # raise NotImplementedError('Function Not yet implemented')
        return self.dataDir['actual_robot_voltage']

    def ActualRobotCurrent(self):
        return self.dataDir['actual_robot_current']

    def ActualJointVoltage(self):
        '''实际关节电压（V）。

        ⚠️ 上游这里写的是 `return self.dataDir['actual_current']` —— 返回的是**关节电流
        （安培）**却挂着"电压"的名字。真正的 `actual_joint_voltage` 就在 RTDE 输出配方里
        （rtdeConfiguration.xml:48）却没有任何访问器。任何按名字取用的调用方都会拿到
        量纲完全不对的数值，所以这里改成读正确的字段，并把电流留给 `ActualCurrent()`。
        '''
        return self.dataDir['actual_joint_voltage']

    def StandardAnalogOutput(self, n):
        '''标准模拟输出 n（0/1）当前值（域为电压时 0-10 V，域为电流时 0-20 mA）。

        URScript 的 `set_analog_out(n, f)` 收的是**相对电平 f∈[0,1]**，而 RTDE 的
        `standard_analog_output0/1` 是工程值 ⇒ 这个访问器同时是"发送值 ↔ 回读值"的换算依据。
        '''
        if n == 0:
            return self.dataDir['standard_analog_output0']
        elif n == 1:
            return self.dataDir['standard_analog_output1']
        else:
            raise KeyError('Index out of range')

    def RunTimeState(self):
        raise NotImplementedError('Function Not yet implemented')

    def IoCurrent(self):
        raise NotImplementedError('Function Not yet implemented')

    def ToolAnalogInput0(self):
        raise NotImplementedError('Function Not yet implemented')

    def ToolAnalogInput1(self):
        raise NotImplementedError('Function Not yet implemented')

    def ToolOutputCurrent(self):
        raise NotImplementedError('Function Not yet implemented')

    def ToolOutputVoltage(self):
        raise NotImplementedError('Function Not yet implemented')

    def StandardAnalogInput(self, n):
        if n == 0:
            return self.dataDir['standard_analog_input0']
        elif n == 1:
            return self.dataDir['standard_analog_input1']
        else:
            raise KeyError('Index out of range')

    def RobotStatus(self):
        '''
        SafetyStatusBit class defined in the bottom of this file

        ⚠️ RTDE 尚未就绪时 `robot_status_bits` 是 None，而 `1 & None` 会抛
        TypeError（`&` 比 `==` 结合得紧，所以是 `(1 & None) == 1`）。上游这个异常会从
        `RealTimeClient.__waitForProgram2Finish` 里抛出并**杀死那个守护线程**，留下
        `rtcProgramRunning = True` 永不复位；`UrScriptExt.reset_error()` 也同样会炸。
        因此这里在字缺失时返回**全 False**（"状态未知"）而不是抛异常。
        '''
        word = self.dataDir['robot_status_bits']
        raw = 0 if word is None else int(word)
        result = RobotStatusBit()
        result.PowerOn = 1 & raw == 1
        result.ProgramRunning = 2 & raw == 2
        result.TeachButtonPressed = 4 & raw == 4
        result.PowerButtonPressed = 8 & raw == 8
        return result

    def SafetyStatus(self):
        '''
        SafetyStatusBit class defined in the bottom of this file

        同 RobotStatus：字缺失时返回全 False，绝不抛 TypeError（它的调用者包括
        `RealTimeClient` 的守护线程与 `reset_error`）。
        '''
        word = self.dataDir['safety_status_bits']
        raw = 0 if word is None else int(word)
        result = SafetyStatusBit()
        result.NormalMode = 1 & raw == 1
        result.ReducedMode = 2 & raw == 2
        result.ProtectiveStopped = 4 & raw == 4
        result.RecoveryMode = 8 & raw == 8
        result.SafeguardStopped = 16 & raw == 16
        result.SystemEmergencyStopped = 32 & raw == 32
        result.RobotEmergencyStopped = 64 & raw == 64
        result.EmergencyStopped = 128 & raw == 128
        result.Violation = 256 & raw == 256
        result.Fault = 512 & raw == 512
        result.StoppedDueToSafety = 1024 & raw == 1024
        return result

    def TcpForceScalar(self):
        raise NotImplementedError('Function Not yet implemented')

    def OutputBitRegister(self):
        result = [None] * 64
        for ii in range(64):
            if ii < 32 and self.dataDir['output_bit_registers0_to_31'] is not None:
                result[ii] = 2 ** (ii) & self.dataDir['output_bit_registers0_to_31'] == 2 ** (ii)
            elif ii > 31 and self.dataDir['output_bit_registers32_to_63'] is not None:
                result[ii] = 2 ** (ii - 32) & self.dataDir['output_bit_registers32_to_63'] == 2 ** (ii - 32)
        return result

    def OutputDoubleRegister(self, index):
        address = f"output_double_register_{index}"
        return self.dataDir[address]

    def OutputIntRegister(self, index):
        address = f"output_int_register_{index}"
        return self.dataDir[address]

    def UrControlVersion(self):
        raise NotImplementedError('Function Not yet implemented')

    def ClearToSend(self):
        raise NotImplementedError('Function Not yet implemented')


class RobotStatusBit(object):
    PowerOn = None
    ProgramRunning = None
    TeachButtonPressed = None
    PowerButtonPressed = None


class SafetyStatusBit(object):
    NormalMode = None
    ReducedMode = None
    ProtectiveStopped = None
    RecoveryMode = None
    SafeguardStopped = None
    SystemEmergencyStopped = None
    RobotEmergencyStopped = None
    EmergencyStopped = None
    Violation = None
    Fault = None
    StoppedDueToSafety = None

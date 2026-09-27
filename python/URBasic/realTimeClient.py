__author__ = "Anthony Zhuang"
__copyright__ = "Copyright 2009-2025"
__license__ = "MIT License"

import URBasic
import socket
import threading
import select
import re
import numpy as np
import time

DEFAULT_TIMEOUT = 1.0

class ConnectionState:
    ERROR = 0
    DISCONNECTED = 1
    CONNECTED = 2
    PAUSED = 3
    STARTED = 4

class RealTimeClient(object):
    '''
    Interface to UR robot Real Time Client interface.
    For more detailes see this site:
    http://www.universal-robots.com/how-tos-and-faqs/how-to/ur-how-tos/remote-control-via-tcpip-16496/
    
    The Real Time Client in this version is only used to send program and script commands 
    to the robot, not to read data from the robot, all data reading is done via the RTDE interface.
    
    The constructor takes a UR robot hostname as input, and a RTDE configuration file.

    Input parameters:
    host (string):  hostname or IP of UR Robot (RT CLient server)
    conf_filename (string):  Path to xml file describing what channels to activate

    
    Example:
    rob = URBasic.realTimeClient.RT_CLient('192.168.56.101')
    self.close_rtc()
    '''


    def __init__(self, robotModel):
        '''
        Constructor see class description for more info.
        '''
        if(False):
            assert isinstance(robotModel, URBasic.robotModel.RobotModel)  ### This line is to get code completion for RobotModel
        self.__robotModel = robotModel

        self.__robotModel.rtcConnectionState = ConnectionState.DISCONNECTED
        self.__reconnectTimeout = 60
        # `__sendPrg` 的发送预算（秒）。**故意远小于** `__reconnectTimeout`：发送失败要么
        # 说明对端不可达（重试 60 s 也不会变好），要么说明控制器不在远程模式（重试永远无效）。
        # 让调用方拿到一句可读的失败，比让它等到 Node 侧 60 s 笼统超时有用得多。
        self.__sendTimeout = 15
        # `__waitForProgram2Finish` 的兜底等待上限（秒）。正常路径靠状态位退出；这个上限只用于
        # 「状态位不可用」时不让守护线程永久占着 rtcProgramRunning。
        self.__waitTimeout = 600
        self.__sock = None
        self.__thread = None
        # 最近一次发送失败的原因（None = 未失败）。`__sendPrg` 过去是**无界重试**：
        # 机器人掉线时 `select.select([], [None], ...)` 立刻抛 TypeError → 裸
        # `except` → `__connect()`（自身又循环 60 s）→ 无限重试，单线程 worker 被
        # 永久占死。现在发送有硬预算并把失败**如实记下来**，供上层回报给模型。
        self.lastSendFailure = None

    def __connect(self):
        '''
        Initialize RT Client connection to host .
        
        Return value:
        success (boolean)
        
        Example:
        rob = URBasic.realTimeClient.RT_CLient('192.168.56.101')
        rob.connect()
        '''       
        if self.__sock:
            return True

        t0 = time.time()
        while (time.time()-t0<self.__reconnectTimeout) and self.__robotModel.rtcConnectionState < ConnectionState.CONNECTED:
            try:
                self.__sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)            
                self.__sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)         
                self.__sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                self.__sock.settimeout(DEFAULT_TIMEOUT)
                self.__sock.connect((self.__robotModel.ipAddress, 30003))
                self.__robotModel.rtcConnectionState = ConnectionState.CONNECTED
                time.sleep(0.5)
                # self.__logger.info('Connected')
                return True
            except (socket.timeout, socket.error):
                self.__sock = None
                # self.__logger.error('RTC connecting')

        return False
                

    def Disconnect(self):
        '''
        Disconnect the RT Client connection.
        '''        
        if self.__sock:
            self.__sock.close()
            self.__sock = None
            # self.__logger.info('Disconnected')
        self.__robotModel.rtcConnectionState = ConnectionState.DISCONNECTED
        return True


    def IsRtcConnected(self):
        '''
        Returns True if the connection is open.

        Return value:
        status (boolean): True if connected and False of not connected.

        Example:
        rob = URBasic.realTimeClient.RT_CLient('192.168.56.101')
        rob.connect()
        print(rob.is_connected())
        rob.disconnect()
        '''
        return self.__robotModel.rtcConnectionState > ConnectionState.DISCONNECTED
        
    def SendProgram(self,prg=''):
        '''
        Send a new command or program (string) to the UR controller. 
        The command or program will be executed as soon as it's received by the UR controller. 
        Sending a new command or program while stop and existing running command or program and start the new one.
        The program or command will also bee modified to include some control signals to be used
        for monitoring if a program execution is successful and finished.  

        Input parameters:
        prg (string): A string containing a single command or a whole program.

        Example:
        rob = URBasic.realTimeClient.RT_CLient('192.168.56.101',logger=logger)
        rob.connect()
        rob.send_srt('set_digital_out(0, True)')
        rob.disconnect()        
        '''
        if not self.IsRtcConnected():
            if not self.__connect():
                # self.__logger.error('SendProgram: Not connected to robot')
                print("SendProgram: Not connected to robot")
 
        if self.__robotModel.stopRunningFlag:
            # self.__logger.info('SendProgram: Send program aborted due to stopRunningFlag')
            # ⚠️ 这里必须**显式**返回布尔值：上游是个裸 `return`（None）。调用方若按
            # `if not SendProgram(...)` 判断，就会把"主动放弃（停止标志已置位）"误判成
            # "发送失败"，于是一个正常的停机路径会报出 SEND_FAILED。
            self.lastSendFailure = '发送被中止：stopRunningFlag 已置位（机器人正在停止）'
            return False
 
        #Close down previous thread 
        if self.__thread is not None:
            if self.__robotModel.rtcProgramRunning:
                self.__robotModel.stopRunningFlag = True
                while self.__robotModel.rtcProgramRunning: time.sleep(0.1)
                self.__robotModel.stopRunningFlag = False
            self.__thread.join()
            
        
        #Rest status bits
        self.__robotModel.rtcProgramRunning = True
        self.__robotModel.rtcProgramExecutionError = False
        
        #Send and wait from program
        if not self.__sendPrg(self.__AddStatusBit2Prog(prg)):
            return False
        self.__thread = threading.Thread(target=self.__waitForProgram2Finish, kwargs={'prg': prg})
        self.__thread.start()
        #self.__waitForProgram2Finish(prg)
        return True
            
    def Send(self,prg=''):
        '''
        Send a new command (string) to the UR controller. 
        The command or program will be executed as soon as it's received by the UR controller. 
        Sending a new command or program while stop and existing running command or program and start the new one.
        The program or command will also bee modified to include some control signals to be used
        for monitoring if a program execution is successful and finished.  

        Input parameters:
        prg (string): A string containing a single command or a whole program.


        Example:
        rob = URBasic.realTimeClient.RT_CLient('192.168.56.101',logger=logger)
        rob.connect()
        rob.send_srt('set_digital_out(0, True)')
        rob.disconnect()        
        '''
        # 直接读连接状态，不用 IsRtcConnected()：后者的判据是
        # `rtcConnectionState > DISCONNECTED`，而 DISCONNECTED 的枚举值是 1（不是 0），
        # 所以状态未初始化/为 None 时它反而返回 True —— 于是"未连接"被当成"已连接"，
        # 下面的 select 会在一个 None socket 上白转，发不出去也不报错。
        if self.__robotModel.rtcConnectionState in (None, ConnectionState.DISCONNECTED,
                                                    ConnectionState.ERROR):
            if not self.__connect():
                self.lastSendFailure = '未连接到机器人实时端口（30003）'
                print('SendProgram: Not connected to robot')
                return False

        #Rest status bits
        self.__robotModel.rtcProgramRunning = True
        self.__robotModel.rtcProgramExecutionError = False

        #Send
        sent = self.__sendPrg(prg)
        self.__robotModel.rtcProgramRunning = False
        return sent

    def __AddStatusBit2Prog(self,prg):
        '''
        Modifying program to include status bit's in beginning and end of program
        '''
        def1 = prg.find('def ')
        if def1>=0:
            prglen = len(prg)
            prg = prg.replace('):\n', '):\n  write_output_boolean_register(0, True)\n',1)
            if len(prg) == prglen:
                # self.__logger.warning('Send_program: Syntax error in program')
                return False
                
            if (len(re.findall('def ', prg)))>1:
                mainprg = prg[0:prg[def1+4:].find('def ')+def1+4]
                mainPrgEnd = (np.max([mainprg.rfind('end '), mainprg.rfind('end\n')]))
                prg = prg.replace(prg[0:mainPrgEnd], prg[0:mainPrgEnd] + '\n  write_output_boolean_register(1, True)\n',1)
            else:
                mainPrgEnd = prg.rfind('end')
                prg = prg.replace(prg[0:mainPrgEnd], prg[0:mainPrgEnd] + '\n  write_output_boolean_register(1, True)\n',1)
                
        else:
            prg = 'def script():\n  write_output_boolean_register(0, True)\n  ' + prg + '\n  write_output_boolean_register(1, True)\nend\n'
        return prg
        
    def __sendPrg(self,prg):
        '''
        Sending program str via socket

        Return value:
        success (boolean)

        ## 为什么必须有硬预算（本文件历史上最严重的一次挂死）
        上游写法是 `while not stopRunningFlag and not programSend:`，**唯一出口是发送成功**。
        机器人掉线/断电时：`select.select([], [None], ...)` 立刻抛 TypeError →
        裸 `except` 把 `__sock` 置 None 并调用 `__connect()` —— 而 `__connect()` 自身
        也是一个最长 `__reconnectTimeout`(60 s) 的循环，于是外层每轮都要重跑一次 60 s 的
        内层循环，**永不返回**。本插件是单线程 worker（`for line in sys.stdin`），
        因此一次掉线就会永久占死整条调用链：Node 侧 60 s 超时只让那一个 promise 失败，
        进程还活着，后续每个工具调用都会排队等到超时。
        ⇒ 现在给发送加 `__sendTimeout`(默认 15 s) 硬预算，失败时**如实**记录到
        `lastSendFailure`（而不是静默成功），并把 False 一路返回到调用方。
        '''
        programSend = False
        self.lastSendFailure = None
        self.__robotModel.forceRemoteActiveFlag = False
        deadline = time.time() + self.__sendTimeout
        while not self.__robotModel.stopRunningFlag and not programSend:
            if self.__sock is None:
                self.__robotModel.rtcConnectionState = ConnectionState.ERROR
                if time.time() >= deadline:
                    break
                if not self.__connect() and time.time() >= deadline:
                    break
                continue
            if time.time() >= deadline:
                break
            try:
                (_, writable, _) = select.select([], [self.__sock], [], DEFAULT_TIMEOUT)
                if len(writable):
                    # sendall：大脚本（例如注入哨兵后的 URScript）可能超过一次
                    # send() 的发送量，上游的 `send` 会**静默截断**，控制器收到半截
                    # 脚本后拒不执行，而调用方看到的是"已发送"。
                    self.__sock.sendall(prg.encode())
                    # self.__logger.info('Program send to Robot:\n' + prg)
                    programSend = True
            except Exception as exc:
                self.lastSendFailure = '%s: %s' % (type(exc).__name__, exc)
                try:
                    self.__sock.close()
                except Exception:
                    pass
                self.__sock = None
                self.__robotModel.rtcConnectionState = ConnectionState.ERROR
                # self.__logger.warning('Could not send program!')
                if time.time() >= deadline:
                    break
                self.__connect()
        if not programSend:
            self.__robotModel.rtcProgramRunning = False
            if self.lastSendFailure is None:
                self.lastSendFailure = ('%.0fs 内未能把脚本送到控制器（远程端口 30003 不可写；'
                                        '机器人可能掉线/断电，或控制器不在远程控制模式）'
                                        % self.__sendTimeout)
            # self.__logger.error('Program re-sending timed out - Could not send program!')
        time.sleep(0.1)
        return programSend


    def __waitForProgram2Finish(self,prg):
        '''
        waiting for program to finish

        ## 两条安全性修正
        1. **必须清 `rtcProgramRunning`**：上游若在本函数里抛异常（例如 RTDE 数据尚未
           就绪时 `SafetyStatus()`/`RobotStatus()` 对 None 做位运算抛 TypeError），
           `rtcProgramRunning = True` 就再也不会被清掉，而 `waitRobotIdleOrStopFlag()`
           （urScript.py）正是靠它跳出循环 ⇒ 单线程 worker 永久卡死。
           现在用 try/finally 保证标志一定归零。
        2. **要有时间上限**：状态位异常时上游还会出现"程序没在跑、标志却一直是 True"
           的组合，因此再加一道与状态位无关的兜底预算（`__waitTimeout`）。
        '''
        waitForProgramStart = len(prg)/50
        notrun = 0
        prgRest = 'def resetRegister():\n  write_output_boolean_register(0, False)\n  write_output_boolean_register(1, False)\nend\n'
        deadline = time.time() + self.__waitTimeout
        try:
            while not self.__robotModel.stopRunningFlag and self.__robotModel.rtcProgramRunning:
                if time.time() > deadline:
                    self.__robotModel.rtcProgramExecutionError = True
                    break
                if self.__robotModel.SafetyStatus().StoppedDueToSafety:
                    self.__robotModel.rtcProgramRunning = False
                    self.__robotModel.rtcProgramExecutionError = True
                    # self.__logger.error('SendProgram: Safety Stop')
                elif self.__robotModel.OutputBitRegister()[0] == False:
                    # self.__logger.debug('sendProgram: Program not started')
                    notrun += 1
                    if notrun > waitForProgramStart:
                        self.__robotModel.rtcProgramRunning = False
                        # self.__logger.error('sendProgram: Program not able to run')
                elif self.__robotModel.OutputBitRegister()[0] == True and self.__robotModel.OutputBitRegister()[1] == True:
                    self.__robotModel.rtcProgramRunning = False
                    # self.__logger.info('sendProgram: Finished')
                elif self.__robotModel.OutputBitRegister()[0] == True:
                    if self.__robotModel.RobotStatus().ProgramRunning:
                        # self.__logger.debug('sendProgram: UR running')
                        notrun = 0
                    else:
                        notrun += 1
                        if notrun>10:
                            self.__robotModel.rtcProgramRunning = False
                            self.__robotModel.rtcProgramExecutionError = True
                            # self.__logger.error('SendProgram: Program Stopped but not finiched!!!')
                else:
                    self.__robotModel.rtcProgramRunning = False
                    # self.__logger.error('SendProgram: Unknown error')
                time.sleep(0.05)
        except Exception:
            # 状态位不可用（RTDE 未就绪/连接已断）：如实标记执行可疑，但**绝不能**把
            # 异常留在这个守护线程里 —— 它会让 rtcProgramRunning 永远为 True。
            self.__robotModel.rtcProgramExecutionError = True
        finally:
            self.__robotModel.rtcProgramRunning = False
        self.__sendPrg(prgRest)
        
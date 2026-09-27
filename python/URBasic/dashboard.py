__author__ = "Anthony Zhuang"
__copyright__ = "Copyright 2009-2025"
__license__ = "MIT License"

import URBasic
import threading
import socket
import struct
import select
import time

DEFAULT_TIMEOUT = 2.0

class ConnectionState:
    ERROR = 0
    DISCONNECTED = 1
    CONNECTED = 2
    PAUSED = 3
    STARTED = 4


class DashBoard(threading.Thread): 
    '''
    A Universal Robot can be controlled from remote by sending simple commands to the 
    GUI over a TCP/IP socket. This interface is called the "DashBoard server". 
    The server is running on port 29999 on the robots IP address.
    See more at: http://www.universal-robots.com/how-tos-and-faqs/how-to/ur-how-tos/dashboard-server-port-29999-15690/
    https://www.universal-robots.com/articles/ur/dashboard-server-e-series-port-29999/
    
    The constructor takes a UR robot hostname as input, and optional a logger object.

    Input parameters:
    host (string):  hostname or IP of UR Robot (RT CLient server)

    
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

        self.__reconnectTimeout = 2 #Seconds (while in run)
        self.__conn_state = ConnectionState.DISCONNECTED
        self.last_respond = None
        self.__stop_event = True
        threading.Thread.__init__(self)
        self.__dataEvent = threading.Condition()
        self.__dataAccess = threading.Lock()
        self.__sock = None
        self.start()
        if self.__conn_state >= ConnectionState.CONNECTED:
            self.wait_dbs()
        #self._logger.info('Dashboard server constructor done')


    def ur_load(self, file):
        '''
        Load the specified program. Return when loading has completed.
        
        Return value to Log file:
        "Loading program: <program.urp>" OR "File not found: <program.urp>"
        '''
        self.__send('load ' + file + '\n')

    def ur_play(self):
        '''
        Starts program, if any program is loaded and robot is ready. Return when the program execution has been started.

        Return value to Log file:
        "Starting program"
        '''
        self.__send('play\n')
        
    def ur_stop(self):
        '''
        Stops running program and returns when stopping is completed.
        
        Return value to Log file:
        "Stopped"
        '''
        self.__send('stop\n')


    def ur_pause(self):
        '''
        Pauses the running program and returns when pausing is completed.
        
        Return value to Log file:
        "Pausing program"
        '''
        self.__send('pause\n')


    def ur_shutdown(self):
        '''
        Shuts down and turns off robot and controller.
        
        Return value to Log file:
        "Shutting down"
        '''
        self.__send('shutdown\n')
        
    def ur_running(self):
        '''
        Execution state enquiry.
        
        Return value to Log file:
        "Robot running: True" OR "Robot running: False"
        '''
        self.__send('running\n')
        
    def ur_robotmode(self):
        '''
        Robot mode enquiry
        
        Return value to Log file:
        "Robotmode: <mode>", where <mode> is:        
        NO_CONTROLLER
        DISCONNECTED
        CONFIRM_SAFETY
        BOOTING
        POWER_OFF
        POWER_ON
        IDLE
        BACKDRIVE
        RUNNING
        '''
        self.__send('robotmode\n')

    def ur_get_loaded_program(self):
        '''
        Which program is loaded.
        
        Return value to Log file:
        "Program loaded: <path to loaded program file>" OR "No program loaded"
        '''
        self.__send('get loaded program\n')

    def ur_popup(self,  popupText=''):
        '''
        The popup-text will be translated to the selected language, if the text exists in the language file.
        
        Return value to Log file:
        "showing popup"
        '''
        self.__send('popup ' + popupText + '\n')

    def ur_close_popup(self):
        '''
        Closes the popup.
        
        Return value to Log file:
        "closing popup"
        '''
        self.__send('close popup\n')

    def ur_addToLog(self, logMessage):
        '''
        Adds log-message to the Log history.

        Return value to Log file:
        "Added log message" Or "No log message to add"
        '''
        self.__send('addToLog ' + logMessage + '\n')

    def ur_setUserRole(self, role):
        '''
        Simple control of user privileges: controls the available options on the Welcome screen.
        
        Return value to Log file:
        "Setting user role: <role>" OR "Failed setting user role: <role>"
        '''
        self.__send('setUserRole ' + role + '\n')

    def ur_isProgramSaved(self):
        '''
        Returns the save state of the active program.
        
        Return value to Log file:
        "True" OR "False"
        '''
        self.__send('isProgramSaved\n')

    def ur_programState(self):
        '''
        Returns the state of the active program, or STOPPED if no program is loaded.
        
        Return value to Log file:
        "STOPPED" if no program is running OR "PLAYING" if program is running
        '''
        self.__send('programState\n')

    def ur_polyscopeVersion(self):
        '''
        Returns the version of the Polyscope software.
        
        Return value to Log file:
        version number, like "3.0.15547"
        '''
        self.__send('polyscopeVersion\n')

    def ur_setUserRole_where(self, role, level):
        '''
        "setUserRole <role>, where <role> is"
        programmer = "SETUP Robot" button is disabled, "Expert Mode" is available (if correct password is supplied)
        operator = Only "RUN Program" and "SHUTDOWN Robot" buttons are enabled, "Expert Mode" cannot be activated
        none ( or send setUserRole) = All buttons enabled, "Expert Mode" is available (if correct password is supplied)
        locked = All buttons disabled and "Expert Mode" cannot be activated
        Control of user privileges: controls the available options on the Welcome screen.
        
        Note: If the Welcome screen is not active when the command is sent, 
        the user privileges defined by the new user role will not be effective 
        until the user switches to the Welcome screen.

        Return value to Log file:
        "Setting user role: <role>" OR "Failed setting user role: <role>"
        '''
        self.__send('setUserRole '+ role + ', where ' + role + ' is' + level +'\n')

    def ur_power_on(self):
        '''
        Powers on the robot arm.
        
        Return value to Log file:
        "Powering on"
        '''
        self.__send('power on\n')

    def ur_power_off(self):
        '''
        Powers off the robot arm.
        
        Return value to Log file:
        "Powering off"
        '''
        self.__send('power off\n')

    def ur_brake_release(self):
        '''
        Releases the brakes.
        
        Return value to Log file:
        "Brake releasing"        
        '''
        self.__send('brake release\n')

    def ur_safetymode(self):
        '''
        Safety mode enquiry.
        
        Return value to Log file:
        "safety mode: <mode>", where <mode> is
        
        NORMAL
        REDUCED
        PROTECTIVE_STOP
        RECOVERY
        SAFEGUARD_STOP
        SYSTEM_EMERGENCY_STOP
        ROBOT_EMERGENCY_STOP
        VIOLATION
        FAULT        
        '''
        return self.__send('safetymode\n')

    def ur_unlock_protective_stop(self):
        '''
        Closes the current popup and unlocks protective stop.
        
        Return value to Log file:
        "Protective stop releasing"
        '''
        self.__send('unlock protective stop\n')

    def ur_close_safety_popup(self):
        '''
        Closes a safety popup.
        
        Return value to Log file:
        "closing safety popup"        
        '''
        self.__send('close safety popup\n')

    def ur_load_installation(self, instal='default.installation'):
        '''
        Loads the specified installation file.
        
        Return value to Log file:
        "Loading installation: <default.installation>" OR "File not found: <default.installation>"
        '''
        self.__send('load installation '+ instal +'\n')

    def ur_serial_number(self):
        '''

        Return serial number:
        "serial number: XXXXXXX" OR ""
        '''
        self.__send('get serial number\n')

    def ur_is_remote_control(self):
        '''

        Returns the remote-control status of the robot.
        If the robot is in remote control it returns false and
        if remote control is disabled or robot is in local control it returns false.
        '''
        self.__send('is in remote control\n')

    def ur_get_robot_model(self):
        '''
        Returns the robot model
        '''
        self.__send('get robot model\n')
    
        
        



    def __connect(self):
        '''
        Initialize DashBoard connection to host.
        
        Return value:
        success (boolean)
        '''       
        if self.__sock:
            return True

        t0 = time.time()
        while (time.time()-t0<self.__reconnectTimeout) and self.__conn_state < ConnectionState.CONNECTED:
            try:
                self.__sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)            
                self.__sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)         
                self.__sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                self.__sock.settimeout(DEFAULT_TIMEOUT)
                self.__sock.connect((self.__robotModel.ipAddress, 29999))
                self.__conn_state = ConnectionState.CONNECTED
                time.sleep(0.5)
                #self._logger.info('Connected')
                return True
            except (socket.timeout, socket.error):
                self.__sock = None
                # self._logger.error('Dashboard connecting')

        return False

    def close(self):
        '''
        Close the DashBoard connection.
        Example:
        rob = URBasic.dashboard.DashBoard('192.168.56.101', rtde_conf_filename='rtde_configuration.xml', logger=logger)
        rob.close_dbs()
        '''
#        if self.IsRtcConnected():
#            self.close_rtc()

        if self.__stop_event is False:
            self.__stop_event = True
            # 带超时的 join：接收线程可能正卡在 `__receive()` 里，无界 join 会把一次
            # "断开连接" 变成新的卡死点。
            try:
                self.join(5.0)
            except Exception:
                pass
        if self.__sock:
            self.__sock.close()
            self.__sock = None
        self.__conn_state = ConnectionState.DISCONNECTED
        return True

    def dbs_is_running(self):
        '''
        Return True if Dash Board server is running
        '''
        return self.__conn_state >= ConnectionState.STARTED

    
    def run(self):
        self.__stop_event = False
        t0 = time.time()
        while (time.time()-t0<self.__reconnectTimeout) and self.__conn_state < ConnectionState.CONNECTED:
            if not self.__connect():
                # self._logger.warning("UR Dashboard connection failed!")
                print("UR Dashboard connection failed!")
                raise ValueError("UR Dashboard connection failed!")

        if self.__conn_state < ConnectionState.CONNECTED:
            # self._logger.error("UR Dashboard interface not able to connect and timed out!")
            raise ValueError("UR Dashboard interface not able to connect and timed out!")
            # return
        
        # ⚠️ 循环**不能**再带 `time.time()-t0<self.__reconnectTimeout` 这个条件。
        # 上游写法会让接收线程在启动 60 s 后"正常"退出（退出时把状态置为 PAUSED，
        # **但 socket 还开着**）⇒ `dbs_is_running()` 依旧返回 True、`__sock` 依旧可写，
        # 可是再没有任何线程会去 `__receive()` 并 notify。于是 60 s 之后每一次
        # `__send()` 都会把命令发出去、然后永久卡在 `wait_dbs()` 上：
        # **整个单线程 worker 就此死掉**，而 Node 侧只看得到自己那句笼统超时。
        # 这与 rtde.py 里同族缺陷（"60 s 后健康连接自杀"）是同一个根因。
        # 现在只有 `__stop_event` 能结束接收循环；断链由 except 分支重连并继续。
        while not self.__stop_event:
            try:
                msg = self.__receive()
                if msg is not None:
                    #self._logger.info('UR Dashboard respond ' + msg)
                    self.last_respond = msg

                with self.__dataEvent:
                    self.__dataEvent.notifyAll()
                t0 = time.time()
                self.__conn_state = ConnectionState.STARTED

            except Exception:
                if self.__conn_state >= ConnectionState.CONNECTED:
                    self.__conn_state = ConnectionState.ERROR
                    # self._logger.error("Dashboard server interface stopped running")

                    try:
                        self.__sock.close()
                    except:
                        pass
                    self.__sock = None
                    self.__connect()
                    # 重连成功后必须回到"已启动"状态：否则 `dbs_is_running()` 永远为
                    # False，而 `__send()` 的 select 又需要 socket 可写 ⇒ 命令有去无回。
                    if self.__conn_state == ConnectionState.CONNECTED:
                        self.__conn_state = ConnectionState.STARTED

                if self.__conn_state >= ConnectionState.STARTED:
                    # self._logger.info("Dashboard server interface reconnected")
                    print("Dashboard server interface reconnected")
                else:
                    # self._logger.warning("Dashboard server reconnection failed!")
                    print("Dashboard server reconnection failed!")
                time.sleep(0.5)

        self.__conn_state = ConnectionState.PAUSED
        with self.__dataEvent:
            self.__dataEvent.notifyAll()
        #self._logger.info("Dashboard server interface is stopped")

    def wait_dbs(self, timeout=None):
        '''Wait while the data receiving thread is receiving a new message.

        `timeout` 默认取 `__reconnectTimeout`：**必须**有上限。上游是无参的
        `Condition.wait()` —— 一旦接收线程已经退出（见 run() 的注释），这个等待就再也
        不会被唤醒，调用方（单线程 worker）永久卡死。
        '''
        if timeout is None:
            timeout = self.__reconnectTimeout
        with self.__dataEvent:
            return bool(self.__dataEvent.wait(timeout))

    def sendCommand(self, cmd):
        '''发送一条 Dashboard 命令并**同步等待**它自己的应答。

        Return value: (ok: bool, respond: str)

        ## 为什么需要这个包装（陈旧应答）
        上游 `__send()` 的流程是「sendall → `wait_dbs()` → return」，而 `wait_dbs()`
        只等"任意一次 notify"，**不校验应答属于哪条命令**；`last_respond` 也只在真正
        收到消息时才被覆盖。结果：如果接收线程恰好死掉（或应答还没回来），调用方读到的
        是**上一条命令的应答**。这对 `is in remote control` 是致命的 —— 例如上一条
        `isProgramSaved` 刚回过 "True"，于是一台**没在远程控制模式**的机器人被报成
        `remote_control: true`，模型据此下发 URScript 并被控制器静默丢弃。
        ⇒ 这里先清空 `last_respond`，再发送，然后只认"发送之后新到达"的应答。
        '''
        self.last_respond = None
        try:
            getattr(self, cmd)()
        except Exception as exc:
            return False, '%s: %s' % (type(exc).__name__, exc)
        respond = self.last_respond
        if respond is None:
            return False, ''
        return True, str(respond).strip()
        
    def __send(self, cmd):
        '''
        Send command to Robot Controller. 

        Input parameters:
        cmd (str)

        Return value:
        success (boolean)
        '''
        t0 = time.time()
        last_fail_log = 0.0
        while (time.time()-t0<self.__reconnectTimeout):
            if self.__sock is None:
                # 接收线程已判定断链：这里不能再去 select([None]) —— 那会抛 TypeError
                # 被下面的裸 except 吞掉，变成"静默失败 + 空转"，调用方拿不到任何原因。
                if not self.__connect():
                    time.sleep(0.2)
                    continue
            try:
                buf = bytes(cmd, 'utf-8')
                (_, writable, _) = select.select([], [self.__sock], [], DEFAULT_TIMEOUT)
                if len(writable):
                    self.__sock.sendall(buf)
                    # 带超时地等应答：sendCommand() 依赖"发送之后新到达的应答"来避免
                    # 读到陈旧值，超时返回 False 而不是永久阻塞。
                    self.wait_dbs(DEFAULT_TIMEOUT * 2)
                    return True
            except:
                # NOTE: this `except` sits inside the reconnect loop. With a dead socket
                # `select.select` raises immediately, so upstream's unconditional print
                # turns into a tight loop — measured 296,644 lines of
                # "Could not send program!" in one session (it pushed the worker log to
                # the 8 MB cap) while burning CPU. Throttle the line to one per 5 s and
                # give the loop real time back (each iteration is a failed send anyway).
                now = time.time()
                if now - last_fail_log >= 5:
                    print("Could not send program!")
                    last_fail_log = now
                time.sleep(0.2)

        # self._logger.error('Program re-sending timed out - Could not send program!')
        return False

    def __receive(self):
        '''
        Receive the respond a send command from the Robot Controller. 

        Return value:
        Output from Robot controller (type is depended on the input parameters)
        '''
        if self.__sock is None:
            # 同上：断链后 `select.select([None], ...)` 抛 TypeError 会冲出接收线程，
            # 线程一死 `wait_dbs()` 就再也不会被唤醒。
            return None
        (readable, _, _) = select.select([self.__sock], [], [], DEFAULT_TIMEOUT)
        if len(readable):
            data = self.__sock.recv(1024)
            if len(data) == 0:
                return None
            
            fmt = ">" + str(len(data)) + "B"
            out =  struct.unpack_from(fmt, data)        
            return ''.join(map(chr,out[:-1]))
            
            
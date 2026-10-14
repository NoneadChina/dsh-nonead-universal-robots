# dsh-nonead-universal-robots

**一个让 DSH 用自然语言直接控制 Universal Robots（UR）机械臂的插件，由拓德科技（Nonead）基于自研的 nUR MCP Server 同源逻辑开发。**（[Suzhou Nonead Robot Technology Co., Ltd.](https://www.nonead.com)）

插件启动一个常驻的 Python worker（内部复用 vendored 的 `URBasic` 库），把机器人控制以**原生 DSH 工具**的形式接入：工具经由该 worker 与机器人通信，因此 `connect` 一次后即可在同一 IP 上持续发指令。仓库：<https://github.com/NoneadChina/dsh-nonead-universal-robots>

> ⚠️ **安全提示**：本插件会直接驱动真实机械臂。使用时务必保证机器人可见、急停按钮触手可及、工作区无障碍物与人员。请把它当作授予模型 `bash` 工具一样慎重对待。你（或模型）对任何运动指令负全责。

> 🛡️ **运动审批门禁**：**49** 个会驱动机器人运动、执行程序、**让机械臂脱离程序控制或失去刚性支撑**、**改写/删除机器人上已存程序**、**通过 Modbus 驱动现场总线设备**，以及**在力控下顶住工件**的指令，在真正下发前会**暂停等待人工确认**：
>
> | 分组 | 工具 |
> |---|---|
> | 运动 | `ur_movej` `ur_movel` `ur_movep` `ur_movec` `ur_servoj` `ur_move_optimized` `ur_move_x` `ur_move_y` `ur_move_z` `ur_move_tool_x` `ur_move_tool_y` `ur_move_tool_z` `ur_move_force` |
> | 绘图 | `ur_draw_circle` `ur_draw_square` `ur_draw_rectangle` `ur_draw_star` |
> | 程序与脚本 | `ur_load_program` `ur_run_program` `ur_send_script` `ur_reset_error` |
> | 控制模式 / 电源 / 安全 | `ur_set_freedrive` `ur_set_teach_mode` `ur_power_on` `ur_power_off` `ur_brake_release` `ur_unlock_protective_stop` `ur_shutdown` |
> | 力控与速度 | `ur_force_mode` `ur_end_force_mode` `ur_force_mode_settings` `ur_speedj` `ur_speedl` `ur_stopj` `ur_stopl` |
> | 程序存储 | `ur_upload_program` `ur_delete_program` |
> | 物理状态变更 | `ur_set_payload` `ur_set_payload_inertia` `ur_set_gravity` `ur_zero_ftsensor` `ur_motion_version` `ur_set_speed_scaling` `ur_set_conveyor_tracking` |
> | Modbus 写类 | `ur_modbus_add_signal` `ur_modbus_delete_signal` `ur_modbus_send_custom_command` `ur_modbus_set_output_register` `ur_modbus_set_output_signal` |
>
> 交互式部署（审批策略为 `ask`）会在界面上弹出确认框。未组合审批服务、无代理、或应答不是 `allowed-once` 的调用都会**以拒绝方式安全关闭**（fail-closed）—— 指令被拒绝，绝不会到达机器人。默认值写在**代码**里（`config.requireApprovalForMotion ?? true`），因此"调用方跳过 schema 解析"也不会把门禁关掉；可用配置 `requireApprovalForMotion: false` 显式关闭。`test/approval-gate.test.mjs` 驱动真实工具注册表逐条验证上述行为，包括"多传一个 `op` 参数无法把调用改派到别的指令"。

> 🧭 **预飞安全闸**：在审批门禁之外，再加一层"**单条指令最多能要求多少**"的物理上限。上限项：`safetyMaxStepM`（0.5 m，轴位移）、`safetyMaxLinearSpeed`（0.5 m/s）、`safetyMaxJointSpeed`（1.05 rad/s）、`safetyMaxDurationS`（60 s）、力控的 `safetyMaxForceN` / `safetyMaxTorqueNm`（40 N / 10 N·m），以及可选的 `safetyWorkspace` 包围盒（`"x:-1,1 y:-1,1 z:0,1.2"`，只针对显式笛卡尔目标）。它在**审批之前**判定 —— 一个物理上不可能的请求不该拿去打扰人 —— 并且与审批**解耦**：`requireApprovalForMotion: false` 只关掉人工确认，绝不会顺手关掉这些物理上限（那需要显式设 `safetyGate: false`）。`safetyWorkspace` 写错时 **fail closed**（拒绝一切运动指令），而不是被静默忽略。它是"防手滑 / 防单位写错"的一层，**不是**安全边界（安全边界仍是控制器自己的安全配置）；也刻意不覆盖 `ur_send_script` —— 那是任意 URScript 文本，本闸不解析脚本。
>
> 📝 **动作审计账本**：每条受门禁的指令都会追加一行 NDJSON（默认 `<DSH_HOME>/nonead-ur/audit.ndjson`；`auditLogPath` 换位置、`auditLog: false` 关掉、`auditLogAll: true` 连不受门禁的读取也记），字段为 `{ts, ip, op, tool_name, args, decision, reason}`，`decision ∈ {approved, denied, blocked, unchecked}` —— 事后能回答"模型到底对机器人做了什么"。写日志**绝不影响下发路径**：失败只回报，不抛异常。

---

## 功能一览

共 **104** 个工具（`ur_*`）。

| 类别 | 工具（`ur_*`） | 说明 |
|---|---|---|
| 连接 | `ur_connect` / `ur_disconnect` | 按 IP 连接 / 断开一台 UR 机器人 |
| 状态 | `ur_get_status` | 一次性读取 TCP、关节、型号、序列号、版本、安全模式、运行/程序状态、电压、电流、温度、开机时长、关节电流/电压/角速度、TCP 速度与受力、速度倍率，以及 `rtde_resync_bytes`（RTDE 接收端为重新同步而丢弃的字节数；`0` 表示链路干净） |
| 位姿 | `ur_get_tcp_pose` / `ur_get_joint_pose` | 读取当前 TCP 位置 / 关节角度 |
| 目标值 | `ur_get_target_values` / `ur_check_pose` | 读取「**控制器打算去哪**」：目标关节角/角速度/角加速度、目标 TCP 位姿与速度（外加实际值便于对比）。来自 RTDE 的 `target_*` 字段，读取零代价 —— 这是判断「指令已下发但还没执行 / 正在交融 / 被安全限速拉住」的直接依据。`ur_check_pose` 回答的是**动之前**值得先问的问题：这个 TCP 位姿在控制器的**安全限值**内吗？**逆运动学**解得出吗（即可达吗）？它是只读预检：由控制器执行 `is_within_safety_limits` + `get_inverse_kin`，结果经输出寄存器在首尾哨兵之间回读，所以"控制器根本没执行"会被如实报出来，而不是靠猜 |
| 设备信息 | `ur_get_robot_model` / `ur_get_serial_number` / `ur_get_uptime` / `ur_get_software_version` / `ur_get_safety_mode` / `ur_get_safety_status` / `ur_get_robot_mode` | 型号（含 `remote_control` 字段）/ 序列号 / 开机时长 / 软件版本 / 安全模式 / **安全与机器人状态位**（哪一类安全功能被触发，含 violation / fault；**限值数值本身**不经 RTDE/dashboard 暴露，需去 PolyScope 安全页读）/ 运行状态 |
| 程序 | `ur_get_program_state` / `ur_load_program` / `ur_run_program` / `ur_stop_program` / `ur_pause_program` / `ur_list_programs` / `ur_upload_program` / `ur_download_program` / `ur_delete_program` | 程序状态、加载、运行、停止、暂停、SSH 列表，以及**程序文件的 SFTP 传输**。三个传输工具都**核对"到底做成了没有"**，而不是"请求已发出"：上传回读远端大小、下载回读本地大小、删除后确认文件真的不在了；下载**绝不静默覆盖**（目标已存在时先改名成 `<path>.bak`，备份失败就拒绝下载）。它们的本地路径被锁在 `programDir` 内 —— 见下文「本地文件访问」。`ur_list_programs` 扫描真机 `/programs` 或 URSim 的 `~/URSim_Linux-*/programs.*` 布局（可用 `programs_dir` 覆盖）；不传口令时会回报 `used_default_password`，并给出当前生效的 `host_key_policy`，可选 `known_hosts` 文件会让 SSH 切到 **`RejectPolicy` 严格校验主机指纹**（文件不存在直接报错，绝不静默退回）。运行/停止/暂停都会检查控制器应答并回带运行状态 |
| 现场消息 | `ur_popup` / `ur_close_popup` / `ur_add_log` | 跟站在机器人旁边的人说话：在示教器上弹一个**模态**提示、关掉它、往**控制器自己的日志历史**里写一行。三者都不会让机械臂运动，因此都不在审批门禁后面；文本有注入校验（dashboard 按行解析命令，换行会注入另一条命令），长度上限 300 字符。注意 `ur_add_log` 会在控制器上**留下永久痕迹** —— 这正是它的用途，所以不要往里写密钥 |
| Modbus | `ur_modbus_add_signal` / `ur_modbus_delete_signal` / `ur_modbus_get_signal_status` / `ur_modbus_send_custom_command` / `ur_modbus_set_output_register` / `ur_modbus_set_output_signal` / `ur_modbus_set_runstate_dependent_choice` / `ur_modbus_set_signal_update_frequency` | 现场总线 I/O：增删控制器监管的信号、读回一个信号、置输出寄存器与数字输出、发一条原始 Modbus 命令，以及调信号的程序状态行为与刷新频率。⚠️ vendored `urScript.py` 里那八个 `modbus_*` 方法**全是桩**（`raise NotImplementedError`），所以这些脚本是本插件自己拼的。⚠️ Modbus 写类**没有应答** —— 这些工具能证明的只是"这段 URScript 在控制器上跑完了"（首尾哨兵），**永远不能**证明 PLC 执行了，因此每条回执都带 `fieldbus_confirmed: false`；只有 `ur_modbus_get_signal_status` 能读回一个值（经输出寄存器，同样在哨兵之间回读）。信号名走**白名单**校验 —— 它会被拼进 URScript 字符串字面量，引号或换行等于注入脚本；读的时候必须显式声明 `kind`，因为 URScript 是强类型的（数字信号返回布尔、寄存器信号返回整数，一段脚本没法安全地回写两种）。五个写类工具在审批门禁后面；只读那一个与两个信号配置项不在 |
| 命名位姿 | `ur_save_pose` / `ur_get_pose` / `ur_list_poses` / `ur_delete_pose` | **本机**的命名位姿表 —— 一位姿一文件 `<poseDir>/<名字>.json`，默认 `<DSH_HOME>/nonead-ur/poses`：保存当前姿态（或直接给数值）、读回一条、列出全部、删除一条。⚠️ **名字会变成文件名**，所以走白名单（允许 Unicode 字母/数字，**中文可用**；拒绝路径分隔符、Windows 非法字符、保留设备名与首尾空白），且围栏判据是 `realpath` **之后**的结果 —— 与程序文件同一套"宿主设围栏 / worker 落盘"分工。写盘是原子的（`tmp` + `os.replace`），写完还会**回读比对**；报 `VERIFY_FAILED` 就是别信那个文件。读的时候把**「从没存过」（`NOT_FOUND`）与「存过但损坏」（`CORRUPT`）分开** —— 混成一句会让调用方去重新保存一个其实已经存在的东西。单个条目损坏**不会**让整张表失败：按条目回报，文件名列在 `broken` 里。⚠️ 刻意**不提供**"按名字直接运动"：那样位姿数值在调用前对安全闸与审批门禁都是不可见的；安全流程是两步 —— 先 `ur_get_pose(name)`、再 `ur_movel(pose, …)`，让两道门禁都看到真实数字 |
| 寄存器 | `ur_get_int_register` / `ur_get_double_register` / `ur_get_bit_register` | 读取 Int / Double / Bool 寄存器 |
| 健康检查 | `ur_ping` | 无需连接机器人，检测 worker / Python / URBasic 就绪 |
| I/O | `ur_get_digital_in` / `ur_set_digital_out` / `ur_get_digital_in_bits` / `ur_get_digital_out_bits` / `ur_get_analog_in` / `ur_set_analog_out` / `ur_get_tool_analog_in` | 数字输入/输出（含批量读位、`which="tool"` 的工具端 I/O）与标准模拟输入/输出（**按工程单位收值**：URScript 的 `set_analog_out` 收的是相对电平 [0,1]；电流域端口可用 `full_scale: 20`）。读工具端数字输入是**哨兵校验**的：控制器若始终没回报脚本执行完毕，工具会拒绝给值，而不是报一个无法担保的数字 |
| 工具配置 | `ur_set_tool_voltage` / `ur_set_tcp` / `ur_set_payload` / `ur_set_payload_inertia` / `ur_set_gravity` / `ur_zero_ftsensor` / `ur_set_tool_output_mode` / `ur_set_tool_communication` | 工具电压（0/12/24 V）、TCP、负载质量/重心、**质量+重心+惯性矩阵一次设全**（`set_target_payload`，PolyScope 5.10+；与 `set_payload` 不同，它不会重置惯性矩阵而让三者互相矛盾）、重力方向（非水平安装用）、力/力矩传感器归零、**工具输出模式**（普通 / power 双针供电）、**工具串口**（TCI/RS-485 —— ⚠️ 启用会禁用工具模拟输入）。⚠️ 这类设置**没有回读通道**：成功的回执写明「已下发（未校验）」并带 `verified: false` —— 插件能证明的只是脚本已送达控制器，而 UR 只在远程控制模式下接受 URScript，其余情况会被静默丢弃 |
| 控制模式 / 电源 / 安全 | `ur_set_freedrive` / `ur_set_teach_mode` / `ur_power_on` / `ur_power_off` / `ur_brake_release` / `ur_unlock_protective_stop` / `ur_shutdown` | 自由驱动 / 示教模式（可手动拖动机械臂）、上电 / 下电 / **释放刹车**（⚠️ 可能因重力掉落）、**只解保护性停止**（不上电、不释放刹车，这就是它与 `ur_reset_error` 的区别）、关闭控制器 |
| 力控 | `ur_force_mode` / `ur_end_force_mode` / `ur_force_mode_settings` / `ur_move_force` | **力控（Force Mode）**：沿/绕选定轴柔性贴合环境并持续施加指定力/力矩。参数与手册逐条对齐：`task_frame` / `selection_vector`（1=柔性）/ `wrench` / `type`（1–3）/ `limits`（柔性轴=最大 TCP 速度，刚性轴=最大位置偏差）/ `damping` / `gain_scaling`。脚本按手册建议先 `sleep(0.02)` 再进力控；退出用 `ur_end_force_mode`。⚠️ `damping`/`gain_scaling` **控制器侧无法回读**，工具只回报本次设置值，不假装读到当前值。**`ur_move_force`** 是架在它上面的**装配动作**：一段 URScript 把 `force_mode(...)` → `movel(...)` → `stopl(...)` → `end_force_mode()` 一次跑完，于是机械臂朝目标推进、到工件处停住。⚠️ 它**不是** vendored 的 `move_force_2stop` —— 那个靠 RTDE **输入**寄存器每 8 ms 推 wrench，而本插件刻意没有 send 配方，那些字段在这里 claim 不了（claim 会让控制器抛异常并崩掉 RTDE 线程）。本工具的做法是：整段运动交给控制器跑，用首尾哨兵证明它真的跑了，再用**只读** RTDE 读运动前后的实际位姿 —— 于是"停在目标之前"表示控制器无法再沿轨迹前进（正是力控装配要的效果），但**不**证明力真的压到了工件上；回报里同时给出 `stopped_due_to_safety`，把「被力限止住」与「被安全停止」的区分留给你 |
| 速度控制 | `ur_speedj` / `ur_speedl` / `ur_stopj` / `ur_stopl` / `ur_wait_steady` | 关节/TCP **速度指令**（`speedj` / `speedl`）与对应的减速停止（`stopj` / `stopl`）。⚠️ 速度指令是**开放式**的：`t=0`（默认）时"达速即返回"而机械臂**仍在运动**，必须用 `stop*` 或 `ur_wait_steady` 收尾。`ur_wait_steady` 轮询 RTDE 已有的速度量判断是否真的停住（**没有**用 URScript 的 `is_steady()` —— 那个在力控/示教模式下恒为 false） |
| 实时遥测 | `ur_get_runtime_telemetry` / `ur_get_robot_voltage` / `ur_get_robot_current` / `ur_get_joint_temperatures` / `ur_get_speed_scaling` / `ur_get_tcp_force` / `ur_get_tool_telemetry` | 关节电流/电压/角速度、TCP 线速度与受力/力矩、工具加速度计、速度倍率、整机电压电流、关节温度、工具电流/电压、I/O 电流。**这些字段本来就在 500 Hz 的 RTDE 数据流里**，读取零代价、无需改配置。单点读取（整机电压/电流、关节温度）与一次性汇总（`ur_get_runtime_telemetry`）并存：轮询某一项时用单点，诊断时用汇总 |
| 传送带 | `ur_get_conveyor` / `ur_set_conveyor_tick` / `ur_set_conveyor_tracking` | 传送带 tick 读取 / 设置，以及**线性或圆盘跟踪的开启与停止**。`ur_get_conveyor` 对它依赖的那段脚本自证：只有观察到控制器把脚本执行完毕才给出 tick。⚠️ `ur_set_conveyor_tracking` **未经真机验证** —— 签名与量纲逐条对照官方手册，但跟踪行为需要真带编码器的传送带才能确认，请先在 URSim 上试 |
| 运动 | `ur_movej` / `ur_movel` / `ur_movep` / `ur_movec` / `ur_servoj` / `ur_move_optimized` / `ur_move_x` / `ur_move_y` / `ur_move_z` / `ur_move_tool_x` / `ur_move_tool_y` / `ur_move_tool_z` | 关节空间 / 直线 / 路径 / **圆弧**（`mode` 0 插补姿态、1 固定姿态）/ 连续流 / **OptiMove 平滑运动**（`optimovej`/`optimovel`，jerk 受限、振动更小；⚠️ 它的 `a`/`v` 是**能力比例** (0,1] 而非 rad/s 或 m/s）/ 沿轴直线运动：`_move_*` 沿**基座**轴、`_move_tool_*` 沿**当前工具**轴（worker 侧用旋转矩阵换算，不依赖 URScript 的 `pose_trans`）。默认值取手册值（`movej` 1.4 / 1.05，`movel` 1.2 / 0.25）；给了 `t > 0` 时时长优先于 `a`/`v` |
| 运动规划 | `ur_motion_version` / `ur_set_speed_scaling` / `ur_get_freedrive_status` | 设置 **Motion Version**（手册第 14 章）与 **jerk 增益**（0.01–1.0，只作用于 jerk 受限的剖面：版本 2 的 movej/movel 与 optimovej/optimovel）。版本 2 规划时把速度/加速度**钳到硬件上限**、交融半径重叠时**动态收缩**，而不是像版本 1 那样跳过整段运动并给 "Overlapping Blends" 警告。⚠️ 新机型与 PolyScope X **只支持版本 2**；CB3 没有这个设置。⚠️ 这两个设置**没有回读通道**。`ur_set_speed_scaling` 设置**速度滑块**（`set_speed_slider`：0 = 停住 / 1 = 满速）—— 交出精细动作前把整体速度压下来，最直接可靠。与其它设置类 op 不同，它**有**回读通道（`target_speed_fraction`）：只有回读一致才报 `verified: true`；又因为该映射从未在真机上确认过，会同时回报 `hardware_verified: false`。`ur_get_freedrive_status` 读取当前姿态在 freedrive 下离**奇异点**的距离（0 正常 / 1 接近 / 2 太接近 —— **不是** freedrive 的开关状态），据此提示操作员换路径 |
| 绘图 | `ur_draw_circle` / `ur_draw_square` / `ur_draw_rectangle` / `ur_draw_star` | 画圆 / 正方形 / 长方形 / 五角星。只有**观察到脚本真的在运行**之后才回报「执行完成」 |
| 脚本 / 紧急 | `ur_send_script` / `ur_reset_error` | 发送 URScript（**校验执行**：哨兵注入到函数体内部/顶层语句之间并回读，「已发送」不再冒充「已执行」；含多个函数且看不出调用哪个时拒绝校验并给 `verified: null`）/ 复位错误 |

除「连接」外，所有工具都接受 `ip` 参数，且都要求**先连接**该 IP。

---

## 只读 3D 数字孪生

插件还内置机器人的**只读 3D 数字孪生**（three.js 渲染）：入口是**右侧栏**「开始」面板里的一张卡片，位置在「工作区文件 / 新建终端 / 浏览器」三张卡片下面；点击后 3D 视图占满右侧栏的内容区。视图订阅宿主的 **SSE 实时流**（`/twin/stream`，100 ms 一帧），始终与真机同步显示**关节姿态、TCP 坐标系与近期运动轨迹**。数字孪生**严格只读，绝不下发任何机器人指令** —— 它只订阅 host 的只读路由并渲染收到的数据。工具栏提供「重置视角」与等轴测/前视/侧视/俯视四个预设，且相机与基座网格按模型包围盒取景 —— UR3 与 UR20 都能正确入画。数值面板还会显示 dashboard 侧状态（安全模式、机器人模式、程序状态、速度倍率、关节温度、母线电压电流），同样走这条路由、按较慢的节拍取。

运动期间也不会停更：遥测由 worker **主动推送**（20 Hz），孪生的每一帧优先读这份推送缓存、**不经过那条单线程命令队列** —— 机器人运动时，运动确认循环占住的是命令队列，而 RTDE 缓存由 URBasic 自己的接收线程持续更新，推送因此照常到达（协议上是一条不带 `id` 的 JSON 行，旧宿主只会把它当成匹配不上的响应，向后兼容）。缓存过期（>300 ms）或缺失时才回退到显式读；孪生的读仍只带 **2.5 s 的专用预算且超时不杀 worker**：一条只读可视化读**绝不能**把整条机器人会话（RTDE/Dashboard）带走。万一真的停滞，流里仍会推 `stale` 事件、面板写出「数据已停止更新 Ns · 正在重试」，绝不静静冻住。断线后无限重连（指数退避封顶 30 s），窗口重新可见或停滞过久时立即重试。诊断时可用 `DSH_UR_TWIN_PUSH=0` 关掉推送做对照。

**跟随桌面程序的颜色主题**：面板的 DOM 部分用宿主设计 token（`--dsw-alias-*`）着色 —— 工具栏、HUD 与状态行会随「设置 → 外观」里选的主题（以及第三方主题）自动翻转，**不需要 JS**。3D 画布里的基座网格线与回退臂材质色由 `src/client/theme.js` 监听 `body[data-ds-dark-theme]`、在主题切换时重刷（CSS 够不到 WebGL 里的数值）。主题判定只认该属性，不退回系统偏好。

host 侧路由（均限定 loopback 调用方）：

| 路由 | 说明 |
|---|---|
| `GET /dsh-nonead-ur/twin/stream[?ip=<ip>]` | **SSE 实时流**（客户端默认走这条）：每 100 ms 一帧完整状态快照，另有 `stale`（这一帧读还没回来）与 `frame-error`（这一帧失败）事件 |
| `GET /dsh-nonead-ur/twin/state[?ip=<ip>][&detail=1]` | 实时位姿（关节角 / TCP / 型号）。`detail=1` 附带 dashboard 侧状态（安全模式、运行状态、速度倍率、关节温度/电流等），位姿通道仍独立轮询，detail 失败不影响位姿 |
| `GET /dsh-nonead-ur/twin/asset?model=<urXX>` | GLB 网格，带内容哈希 `ETag` + `immutable`，支持 `If-None-Match` → 304 |
| `GET /dsh-nonead-ur/twin/models` | 本地实际存在的模型清单 |

失败响应带**机器可读的 `code`**（`no_robot` / `robot_not_connected` / `ambiguous_robot` / `worker_unavailable` / `robot_error`）并回显本次解析到的 `ip`，界面据此给出不同的提示与处置建议。读**暂时**拿不到（worker 正忙着执行运动指令是最常见的原因）时不会报 `robot_error`：宿主回放最后一笔已知读数并标记 `stale:true`（最多 30 s），孪生保留画面并显示停滞提示。回放的帧**从不带审批状态**：`pending_motion` 是现场重读的，因此一个早已结束的审批不会被画成幽灵目标。

---

## 安装到 DSH profile

> 📦 **尚未发布到 npm**，因此没有可写进 `dependencies` 的版本号。请从插件市场/插件页安装，或从本仓库安装（本地检出目录或它的 GitHub 地址）。

### 方式一：插件市场 / 插件页（GUI）

插件已在 DSH 插件市场中登记为 `dsh-nonead-universal-robots`。打开**设置 → 插件市场**（或侧边栏**插件**页），找到并安装。

两点须知：

- 市场在**有 agent 正在运行**时会拒绝安装（"安装会修改插件文件，正在工作的 agent 可能中途报错"）。请先结束或取消当前回合。
- 市场按目录条目里的 GitHub 地址安装，而 pnpm 对 `github:` 规格是从 `codeload.github.com` 下 tarball。网络慢或被过滤时这次下载会超时；下面的 CLI 方式可完全绕开它。

### 方式二：CLI，从本地检出安装（开发时推荐）

```sh
# DSH Desktop 会为每个 profile 生成一个 CLI 包装器：
#   %APPDATA%\<app>\host-commands\<profile>\generations\<hash>\bin\dsh.cmd
dsh.cmd plugin add "file:D:/path/to/dsh-nonead-universal-robots"
# （该包装器会自己补上 --profile <profile>；其他环境用 `dsh plugin --profile <profile> add <spec>`）
```

这与插件页走的是同一条路径：它会写入依赖**和** `dsh.profile.bundles` 条目，并把插件**热加载**进正在运行的会话（无需重启 —— `ur_*` 工具会立刻出现在工具表里）。

⚠️ `file:` 安装进来的是**副本**而非软链：**改检出目录不会影响已装的插件** —— 改了源码要重新执行这条命令。

### 方式三：作为 bundle 手动安装

1. 在目标 profile 的 `package.json` 中把本插件加入依赖：

   ```jsonc
   // <DSH_HOME>/profiles/<profile>/package.json
   {
     "dependencies": {
       "dsh-nonead-universal-robots": "file:D:/path/to/dsh-nonead-universal-robots"
       // 或（GitHub 可达时）："github:NoneadChina/dsh-nonead-universal-robots"
     },
     "dsh": {
       "profile": {
         "bundles": [               // 把本插件加到数组里（顺序靠后即可）
           "...",
           "dsh-nonead-universal-robots"
         ]
       }
     }
   }
   ```

2. 通过 `dsh plugin`（等价于在 profile 目录内跑 pnpm）安装依赖：

   ```sh
   dsh plugin --profile <profile> install
   # 或：cd "$DSH_HOME/profiles/<profile>" && pnpm install
   ```

3. 重启 DSH。插件的 `cordis.patch.yml` 会把插件行插入配置树，工具以 `ur_*` 形式出现在模型工具列表中。

---

## Python 运行时

插件需要一个可用的 Python 以及 `numpy`、`paramiko` 才能启动 worker：

```sh
pip install -r requirements.txt
```

> ⚠️ **依赖必须装在 worker 真正使用的那个解释器里。** `lib/worker.js` 会把 `PYTHONPATH`
> 指向插件的 `python/` 目录，而 CPython 启动时会 import 该目录下的 `sitecustomize.py`（如果存在）
> —— 于是一个把本机用户级 `site-packages` 塞进 `sys.path` 的 `sitecustomize.py` 会"本机能跑、
> 换台机器就全挂"。请把 `pythonBin` 指向已装好依赖的解释器（或一个 venv）。

`cordis.patch.yml` 中的 `pythonBin`（默认 `python`）、`commandTimeoutMs`（运动/脚本超时，默认 60000）、`connectTimeoutMs`（首次连接超时，默认 30000）都可按部署覆盖。若 `python` 不在 PATH，改成绝对路径，例如 `"C:\\Python312\\python.exe"` 或 `"/usr/bin/python3"`。`ur_ping` / `npm run test:python` 就是这条链路的自检入口。

---

## 健康检查 / 测试

无需连接真实机器人即可验证插件与 Python 运行时是否就绪：

```sh
npm run test:python   # python ur_worker.py --selfcheck：校验 Python/numpy/paramiko/URBasic/RTDE 配置
npm test              # 51 项：37 个测试文件 + 9 条门禁 + 5 个离线探针，最后汇总
npm run test:node     # 只跑 Node 侧：跳过需要 Python 的测试文件**与门禁**
npm run check         # 只跑静态 + 跨语言门禁，不跑测试文件
npm run verify:host   # 用宿主真实的 schema DSL 校验全部工具注册与 peer 版本
npm run verify:models # 校验 14 个 GLB 的结构契约
```

`npm test` 跑两类东西，两类都必须过：

- **37 个测试文件**（端到端协议自检、审批门禁、孪生路由、客户端状态机、FK、vendored 库回归）。名单来自 `test/test-manifest.json`，并由 `check:manifest` 保证"会调用 Python 的用例"不会被漏登记。
- **9 条门禁** 加上 **5 个离线探针**：`check-test-manifest` / `check-package-metadata` / `check-client-bundle` / `check-doc-tools`（Node），`check-worker-ops` / `check-tool-params` / `check-rtde-recipe` / `check-approval-gate` / `check-new-ops`（Python），随后是 `scripts/probe-*.mjs` 那几个孪生/SSE 探针。

**被跳过不等于通过。** 只要有项目被跳过，整轮就以非零退出 —— 想接受跳过必须显式要求（`--allow-skip`，或 Node-only 的 `--skip-python`），而**全部被跳过时无论如何都算失败**。两个探针需要全局 `EventSource`，用 `--experimental-eventsource` 运行（Node ≥22.3）；再加上 `module.registerHooks`（Node ≥22.15），真实的开发下限记录在 `devEngines` 里。

`npm test` 会打印逐项汇总。若 `python` 不在 PATH，用环境变量指定：

```sh
UR_PYTHON=C:\\Python312\\python.exe npm test
```

发布前、以及每次升级 DSH 内核后，都应跑一遍**宿主兼容自检** —— 它拿**已安装的宿主**校验本插件，而不是校验一份抄下来的关键字清单：

```sh
npm run verify:host                                # 严格模式：找不到已装宿主时 exit 2
npm run check:host                                 # 同一检查，但缺宿主时给一条响亮的 SKIP
node scripts/check-host-compat.mjs <node_modules>  # 也可显式指定宿主
```

它会用宿主实装版本核对 peer 范围、用宿主**真实**的 value-schema DSL 编译**每一个**工具参数 schema（被拒的 schema 会让该工具静默消失）、驱动宿主路由注册，并校验 `dsh.client` 声明与客户端 bundle 的 `__ModuleLoader__` 注册 id。退出码 `0` 表示与该宿主兼容；报告里会写清"声明了多少个、注册成功多少个"（例如 `83/83`）。

> 首次连接到某机器人时，`ur_connect` 有约 20 s 的 RTDE 就绪等待，超时会返回清晰错误而非卡死。

---

## 工作原理

```
DSH 模型        @deepseek-ai/dsh-tools        python/ur_worker.py          UR 机器人
  │  ur_movej(...)  │                              │                          │
  ├────────────────►  ctx.tools.register(defineTool)                        │
  │                  │  lib/worker.js               │                          │
  │                  ├── spawn(ur_worker.py) ──────►│  import URBasic          │
  │                  │   {id,op,params} ───────────►│  RTDE+Dashboard+RTC      │
  │                  │  ◄── {message,data} ─────────┤  各 op 执行              │
  │  ◄── text ───────┤                              │                          │
```

- **`python/ur_worker.py`**：常驻 stdio JSON worker。维护 `ROBOTS` / `ROBOT_MODELS` 字典，按 IP 连接，每次调用一条指令。运动指令用「到位确认」轮询（有界），并在出错时返回结构化错误。
- **`lib/worker.js`**：按需拉起 worker 一次并保持存活，行分隔 JSON 协议配对请求/响应，带超时与取消（转发 `exec.signal`）。
- **`lib/index.js`**：Cordis 插件，导入 `defineTool` 把上述控制逻辑注册成工具；`inject: ['tools']`。

---

## 工具命名与示例

工具名稳定为 `ur_*`，示例提示词：

> 连接 192.168.1.199，读取当前 TCP 位姿。

```
ur_connect(ip="192.168.1.199")
ur_get_tcp_pose(ip="192.168.1.199")
```

> 让 192.168.1.199 的 TCP 沿 Z 轴下降 20 mm。

```
ur_get_tcp_pose(ip="192.168.1.199")
ur_move_z(ip="192.168.1.199", distance=-0.02)
```

> 绘制一个半径 50 mm 的圆（竖直平面）。

```
ur_draw_circle(ip="192.168.1.199", center=[0.3,-0.2,0.4,0,3.14,0], r=0.05)
```

---

## 注意事项 / 限制

- **连接持久性**：worker 进程在插件生命周期内常驻，机器人连接按 IP 保留；worker 崩溃或 DSH 重启后需重新 `connect`。
- **远程控制模式**：部分 UR 机器人需处于「远程控制」才能执行运动/程序指令，`ur_connect` 会报告该状态。**URSoftware 3.1–3.20 之间的 CB3 机器人默认就允许远程控制**；但 `remote_control: false` 仍说明控制器**当前**不在远程模式 —— 本地/示教模式下 URScript 与运动指令会被静默丢弃，需在示教器上切到远程控制。其他固件（e-Series，或不在该区间的 CB3）则需先在 PolyScope 中开启 Remote Control。状态读不到时按"未知"处理，而不是假装是 `false`。
- **读不到就不假装读到**：没有回读通道的设置型指令只回报 `verified: false`；控制器拒绝 RTDE 会话时报"未运行"而不是"已连接"；孪生某一帧刷新不出来会标 `stale`。
- **本地文件访问**：`ur_upload_program` 会**读**本地文件、`ur_download_program` 会**写**本地文件，因此两者都被锁在 `programDir`（默认 `<DSH_HOME>/nonead-ur/programs`，可用 `programDir` 配置改）内。路径必须在该目录内 —— 判据是 `realpath` **之后**的结果，所以软链也带不出去；只传输 `.urp`；`maxProgramBytes`（1 MiB）限大小。**未配置或目录不存在的 `programDir` 一律 fail closed**：不读也不写任何本地文件。这与"把 shell 交给模型"是同一类暴露面，所以这里是设围栏，而不是靠信任。
- **程序传输不是"发出去就算完"**：上传与下载都比对另一侧的字节数，删除会在删完之后再 `stat` 一次。不一致就报失败（`VERIFY_FAILED`），绝不报成功 —— 因为调用方的下一步很可能就是去运行那个程序。
- **命名位姿是本机数据，不是机器人状态**：`ur_save_pose` / `ur_get_pose` / `ur_list_poses` / `ur_delete_pose` 只在 `poseDir` 下按"一位姿一文件"读写 JSON，不碰控制器（除非让 `ur_save_pose` 捕获当前姿态，那需要 `ip`）。目录在首次保存时自动创建；未配置 `poseDir` 则 fail closed。真要走到某个保存过的位姿，请**分两步**（先 `ur_get_pose` 再 `ur_movel`），让门禁看到真实数字。
- **长时间运动绝不能让孪生冻结**：孪生唯一不受命令队列影响的数据源是 worker 的遥测推送线程，而那个线程与 RTDE、Dashboard 装在**同一个 Python 子进程**里。因此单次工具调用**绝不能**因为"运动合法地超出了调用预算"就杀掉这个子进程：运动指令的预算现在**按参数推算**（`t=` / `timeout_s`，力控引导运动另给宽兜底），并且一律 `killOnTimeout: false` —— 超时仍会如实报超时，只是不再毁掉会话（以及孪生）。
- **遥测走独立通道**：推送帧走 **stderr + 魔数前缀**并用自己的锁，不再排在响应写锁后面的 stdout 上。共用 stdout 意味着：一条大响应写（或 stdout 背压）能把那把锁占住超过 300 ms，推送一停，路由就回退到显式读 —— 而那次读正好排在运行中的运动指令后面。普通 stderr（traceback 等）仍原样进诊断尾巴；宿主**两路都收**，旧版 Python 侧也能工作。
- **工具端数字 I/O**：`ur_get_digital_in` / `ur_set_digital_out` 的 `which="tool"` 用于工具端（法兰侧）数字 I/O。工具端数字信号**不经 RTDE**，因此读取工具输入会发送一段短的 URScript 程序，**可能打断正在运行的程序**。**工具端数字输出的读回不支持**（没有可靠的 `read_tool_digital_out` 表达式）。
- **关节电流**：接收配方里本来就有 `actual_current`，`ur_get_runtime_telemetry` 会以 `joint_currents` 返回它；缺的只是一个**单独的** `ur_get_joint_current` 工具，而不是这个值本身。
- **线程/取消**：运动指令为阻塞到位的轮询，`commandTimeoutMs` 内完成；对长时间轨迹，请在描述中提醒模型设置合理超时或分步执行。
- **非安全边界**：此插件与 bash 工具同级，可驱动物理设备，务必在真实机器人上充分测试后再用于生产。
- **未知型号回退**：若某机器人没有内置网格（未知或定制型号字符串），会**回退到近似几何体渲染而不报错**，数字孪生不会因未知型号失败。
- **资产**：14 个 `assets/models/*.glb` 网格（约 21 MB，几乎就是整个发布包）由 `python scripts/convert-meshes.py` 生成，其结构契约由 `python scripts/verify-models.py` 校验（即 `npm run verify:models`）。它们的体积构成与许可来源见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)；`npm run analyze:models` 可看字节都花在哪里。

---

## 参考实现

本插件与拓德科技的 [`Nonead-Universal-Robots-MCP`](https://gitee.com/nonead/Nonead-Universal-Robots-MCP)（GitHub: <https://github.com/nonead/Nonead-Universal-Robots-MCP>）同源，复用其中的 `URBasic` 库与机器人控制逻辑，由同一团队面向 DeepSeek Harness 重新封装为本插件的 `ur_*` 工具与 stdio worker 协议。`URBasic` 为 MIT（© Tony Ke & Anthony Zhuang / Universal Robots，2009-2025）。

---

## 第三方资产与许可

除插件自身代码外，本包还随附 14 个机器人网格 `assets/models/*.glb`（约 21 MB）与 `assets/kinematics.json`，全部派生自 Universal Robots 的 [`Universal_Robots_ROS2_Description`](https://github.com/UniversalRobots/Universal_Robots_ROS2_Description)（`humble` 分支，获取日期 2026-09-21）。

许可按型号分为两类，同一型号内不会混用：

- **BSD-3-Clause**（9 款）：`ur3`、`ur5`、`ur10`、`ur3e`、`ur5e`、`ur7e`、`ur10e`、`ur12e`、`ur16e` —— 同时涵盖 `assets/kinematics.json` 所派生的运动学与关节限位配置。
- **UR「Graphical Documentation」条款**（5 款）：`ur8long`、`ur15`、`ur18`、`ur20`、`ur30`。这 5 款的网格**不是** BSD-3-Clause，而属于 UR 的「Graphical Documentation」，其使用受 UR 的 *Terms and Conditions for use of Graphical Documentation* 约束 —— 该条款不符合 OSI 开源定义，但**允许**在若干限制下使用、修改与分享。相关疑问请联系 <legal@universal-robots.com>。

客户端 3D 渲染基于 [three.js](https://threejs.org/)（MIT）；[esbuild](https://esbuild.github.io/)（MIT）仅用于构建期。

逐型号派生清单、转换参数与许可全文见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。

---

## License

本项目采用**区分用户的双重许可 (User-Segmented Dual Licensing)** 模式：

- **AGPLv3**：适用于**个人用户**及**10 人及以下企业/组织**（开源；详见 <https://www.gnu.org/licenses/agpl-3.0.html>）。
- **商业许可证（必须）**：适用于**超过 10 人**的组织，或任何需要规避 AGPLv3 源代码公开义务（如 SaaS / 闭源分发）的用户。

完整条款见 [LICENSE](./LICENSE)。商业授权请联系 [service@nonead.com](mailto:service@nonead.com)。

`python/URBasic`（vendored）仍沿用其自身 **MIT** 许可（© Anthony Zhuang / Universal Robots，2009-2025）。

# 更新日志 / Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.8] - 2026-09

### 变更
- **统一远程控制探测**：抽取 `_remote_control(d)` 公共函数，`op_connect` / `op_status` / `op_get_robot_model` 三处共用一个判定（只有精确的 `"true"` 视为远程；类错误响应或探测失败视为非远程），消除三份手写重复逻辑。
- **描述同步**：`ur_get_robot_model` 的描述补充说明其返回的 `remote_control` 字段。

## [0.3.7] - 2026-09

### 修复
- **worker.js 中止计时器清理**：`call()` 的 `onAbort` 现在 `clearTimeout`，已中止的请求不再遗留一个在超时后触发的空 reject（轻微资源泄漏/不干净）。
- **`op_status` 读取失败可辨**：`dash()` 查询失败时返回 `"<查询失败>"` 标记，而非空字符串——避免把"无法读取某字段"误当"字段为空"。

## [0.3.6] - 2026-09

### 健全性
- **运动/绘图参数范围校验**：新增 `_nonneg_float` 校验，拒绝负值/零值运动与绘图参数（控制器会把负速度/负加速度/反向几何当作异常）：
  - `movej` / `movel` / `movep` / `movec`：`a`（加速度）、`v`（速度）须 >0；`t`（时长）、`r`（交融半径）>=0。
  - `draw_circle` / `draw_square` / `draw_rectangle` / `draw_star`：`r` / `border` / `width` / `height` / `side` 须 >0。
  - `servoj`：`lookahead_time` 0.03-0.2、`gain` 100-2000、`t`>=0。
- **工具定义 schema 约束**：为 `MOVE_PARAMS`、`movep`/`movec`、`servoj`、`draw_*` 的参数加 `minimum`/`exclusiveMinimum` 约束，让模型在调用前即看到限制。

## [0.3.5] - 2026-09

### 修复
- **vendored URBasic 运算符优先级**：`RobotModel` 的 `DigitalInputbits` / `ConfigurableInputBits` / `DigitalOutputBits` / `ConfigurableOutputBits` 里 `n >= 0 & n < 8` 被 Python 解析为链式比较，导致 n=8/15 越界时错误返回 True。改为 `0 <= n < 8`（及 `8 <= n < 16`），越界正确返回 None。
- **`urScriptExt.get_in` 签名不匹配**：`BCI` 分支调用 `get_configurable_digital_in` 时多传了 `wait` 参数（该方法只接受 `n`），去除后不再抛 `TypeError`。
- **`urScriptExt.set_output` 空分支**：`BCO`/`BDO` 补 `return True`；`TDO`（工具数字输出）改为调用已实现的 `set_tool_digital_out`；`BAO`（模拟输出）明确抛 `NotImplementedError`（不再静默 pass）。
- **`_right_pose_tcp` 只比较前 3 维**：到位确认改为比较**完整 6 维**位姿（位置 + 姿态），位置容差 0.010m、姿态容差 0.05rad，避免姿态偏差被误判为已到位。
- **`ur_set_analog_out` 崩溃**：原调用 URBasic 桩 `set_standard_analog_out`（`NotImplementedError`）会崩溃，改为直接发送 URScript `set_analog_out` 命令。
- **`_program_running` 连接断开容错**：dashboard 探测失败不再使单线程 worker 崩溃（返回 False，确认循环给出清晰结果）。

### 健全性
- **参数范围校验**：新增 `_bounded_int`，对寄存器（int/double 0-23、bool 0-63）与数字/模拟口（std 0-7、config 8-15、tool 0-1、模拟 0-1）做 worker 端校验；并在工具定义（index.js）为 `index`/`n` 加 JSON-schema 的 `minimum`/`maximum` 约束。越界或非整数返回清晰错误，而非 KeyError。
- 清理未跟踪的 `debug.log` 与 `Release/*.tgz`。

## [0.3.4] - 2026-09

### 修复
- **`ur_get_digital_in` 的 `which="std"` 读取崩溃**：修复 vendored URBasic 的方法名大小写错误——`get_standard_digital_in` 调用的是不存在的 `RobotModel.DigitalInputBits`（大写 B，触发 `AttributeError`），而实际定义为 `DigitalInputbits`（小写 b）。改为匹配定义后，读取标准数字输入恢复正常。该问题在真机 UR3 上发现。

## [0.3.3] - 2026-09

### 新增
- **工具端数字 IO**：在 vendored URBasic 的真实实现基础上，新增并接通 `ur_get_digital_in` / `ur_set_digital_out` 的 `which="tool"` 分支：
  - `get_tool_digital_in`：工具端数字输入不经 RTDE，通过 URScript `read_tool_digital_in(n)`（`SendProgram`）把结果写入 `output_int_register_0`，再经 RTDE 读回（与 `get_conveyor_tick_count` 同模式）。已在真机 UR3 上验证，能正确读取布尔值。
  - `set_tool_digital_out`：经 RealTime 客户端发送 URScript 命令 `write_tool_digital_out(n, v)` 设置工具端数字输出。已在真机 UR3 上验证，set/clear 均被接受。
  - `get_tool_digital_out`：仍为桩并附说明（工具数字输出无可靠的 `read_tool_digital_out` 回读表达式），仅可通过 `set_tool_digital_out` 控制。

### 变更
- `ur_get_digital_in` 的工具描述补充说明：`which="tool"` 读取经由 URScript 发送短程序，可能打断正在运行的程序。
- 此前的 `which="tool"` 分支由"返回未实现提示"改为调用真实实现。

## [0.3.2] - 2026-09

### 修复
- **传送带 tick 读取崩溃**：`ur_get_conveyor` 读取传送带 tick 时，`get_conveyor_tick_count()` 修复两处 vendored URBasic 缺陷——URScript 改用 `write_output_double_register(0, …)`（此前用 `write_output_float_register`，但 RTDE 配置只暴露 `output_double_register_0`，float 值读不进来，会一直返回 0）；Python 侧改用 `RobotModel.OutputDoubleRegister(0)` 读取（此前用不存在的**小写属性** `outputDoubleRegister[0]`，触发 `AttributeError: 'RobotModel' object has no attribute 'outputDoubleRegister'`）。
- **`ur_get_robot_model` 型号污染**：此前的远程控制探测复用 `d.last_respond`，会覆盖型号字符串，且在探测成功时给型号硬拼接一个 `"e"`（如 `UR5` → `UR5e`）。现在 `robot_model` 返回纯净型号，远程控制状态另以 `remote_control` 字段返回，不再污染。
- **运动确认语义**：`_movej_confirm` / `_movel_confirm` 在机器人多次偏移且非程序运行态时，改为如实返回**未到位（`ok=False`）**，此前会谎报为成功送回「移动结束（位置存在偏差）」；读取关节/TCP 位置失败也改为明确报错，而非静默 `break`。
- **`ur_list_programs` 连接报错**：SSH 连接失败现返回清晰中文错误（提示检查 SSH 服务与 username/password），此前会抛原始异常并误报「共 0 个」。

### 健全性
- **向量参数校验**：新增 `_vec` 辅助函数，对 `movej`/`movel`/`move_x|y|z`/`draw_circle|square|rectangle|star`/`set_tcp`/`set_payload`/`movep`/`movec`/`servoj` 的关节/位姿向量统一校验**维度**（长度不足、非数值、缺失均返回明确错误），避免生成畸形 URScript 或越界索引。
- **worker 崩溃退避**：`worker.js` 实现 `restartDelayMs` 崩溃退避（此前字段已定义但从未使用），避免 worker 启动即崩时形成 tight crash loop。
- **worker spawn/exit 竞态**：`call()` 写入前区分「可写 / 不可写 / 进程已退」三种状态并分别清晰报错，不再静默丢弃请求。

## [0.3.1] - (2026-09)

### 修复
- **安全**：`ur_load_program` 纳入运动审批门禁（`APPROVAL_OPS`），并对 `program_name` / `programs_dir` 做白名单校验（拒绝控制字符与 shell/URScript 元字符），封堵「`load <file>\nplay` 注入绕过人工批准」的绕过路径。
- **安全**：`ur_list_programs` 的 `programs_dir` 经 `shlex.quote` 参数化后再进 `find`，消除经 SSH 的远程 shell 注入。
- **可用性**：移除会固定返回 `NotImplementedError` 的 `ur_get_inverse_kin`（URBasic 基类为空实现）；重写 `ur_set_payload` 为直接发送 `set_payload_mass` / `set_payload_cog` URScript（此前同样命中空桩）。
- **健壮性**：JS 侧把 `_timeout_ms` 传给 worker，Python 的 `_movej_confirm` / `_movel_confirm` / draw 完成确认改为**有界超时**，避免单线程 worker 被永不返回的运动循环永久卡死。
- **行为**：`ur_draw_*` 返回前做有界完成确认，不再提前报「已发送」；`ur_get_digital_in` 的 `which="tool"`（URBasic 未实现）改为明确报错提示改用 `std`/`config`。

### 变更
- 工具数由 50 减为 49（移除 `ur_get_inverse_kin`）。

## [0.3.0] - 2026-09

### 新增
- **更多工具**：
  - `ur_movep`（路径移动）、`ur_movec`（圆弧移动）、`ur_servoj`（连续流关节目标，在线控制单步）。
  - `ur_get_digital_in_bits` / `ur_get_digital_out_bits`（**批量**读数字输入/输出位，std0-7+config8-15）。
  - `ur_get_conveyor` / `ur_set_conveyor_tick`（传送带 tick 读取/设置）。

### 变更
- 补全发布元数据：`repository`（Nonead GitHub）、`bugs`。

## [0.2.0] - 2026-09

### 变更
- 插件改名为 `dsh-nonead-universal-robots`（全小写，可 npm 发布），声明宿主要求 `DSH ^0.1.2-rc.1`（`peerDependencies`）。
- 插件简介：一个让 DSH 用自然语言直接控制 Universal Robots（UR）机械臂的插件，由拓德科技（Nonead）基于自研的 nUR MCP Server 同源逻辑开发。

### 新增
- **运动审批门禁**：`ur_movej/ur_movel/ur_move_x|y|z/ur_draw_*/ur_run_program/ur_send_script/ur_reset_error` 会先走 DSH 审批通道（`ctx.approval`），人工确认后才下发；无审批服务/无 agent 时 fail-closed。可用 `requireApprovalForMotion` 关闭。
- **更多工具**：`ur_ping`（健康检查）、`ur_get_digital_in`/`ur_set_digital_out`、`ur_get_analog_in`/`ur_set_analog_out`、`ur_set_tool_voltage`、`ur_set_tcp`、`ur_set_payload`、`ur_get_inverse_kin`、`ur_draw_star`（五角星）。
- **URSim 兼容**：`ur_list_programs` 支持真机 `/programs` 与 URSim `~/URSim_Linux-*/programs.*`，`ur_load_program`/`ur_run_program` 支持完整/URSim 路径与 `programs_dir`。
- **测试**：worker `--selfcheck` 模式与 `npm test`/`npm run test:python`。

### 修复
- 修复 URBasic/RTDE 返回 **numpy 数据无法 JSON 序列化**的问题（worker 的 `_json_default` 递归转换）。
- 修复**中文 Windows stdout 为 GBK**，写入协议管道导致 `UnicodeEncodeError`（改为向 `stdout.buffer` 写 UTF-8 字节）。
- 修复 dashboard `load` 原始响应滞后导致加载结果不可靠（改用 `ur_get_loaded_program` 做权威确认）。
- 修复 `ur_get_joint_temperatures`/`op_status` 中 numpy 值拼进 message 的显示问题。
- 修复 worker 进程管理：首次调用与 spawn 竞态、环境变量清洗、崩溃自动重启。

### 增强
- 新增 `ur_get_status` 的 `remote_control` 字段，便于排查是否处于远程控制模式。
- worker.js 对子进程环境做凭据清洗（剔除 `DSH_*` 与形似密钥的变量）。

## [0.1.0] - 2026-09

- 首个版本：连接/状态/位姿/寄存器/运动/绘图/程序/脚本等 `ur_*` 控制工具。
- 复用 vendored `URBasic` 与拓德科技 nUR MCP Server 同源逻辑，封装为 DSH 原生工具。

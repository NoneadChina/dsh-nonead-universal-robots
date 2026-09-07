# 更新日志 / Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] - 2026-09

### 新增
- **更多工具**：
  - `ur_movep`（路径移动）、`ur_movec`（圆弧移动）、`ur_servoj`（连续流关节目标，在线控制单步）。
  - `ur_get_digital_in_bits` / `ur_get_digital_out_bits`（**批量**读数字输入/输出位，std0-7+config8-15）。
  - `ur_get_conveyor` / `ur_set_conveyor_tick`（传送带 tick 读取/设置）。

### 变更
- 补全发布元数据：`repository`（Nonead GitHub）、`bugs`。

## [0.3.1] - (2026-09)

### 修复
- **安全**：`ur_load_program` 纳入运动审批门禁（`APPROVAL_OPS`），并对 `program_name` / `programs_dir` 做白名单校验（拒绝控制字符与 shell/URScript 元字符），封堵「`load <file>\nplay` 注入绕过人工批准」的绕过路径。
- **安全**：`ur_list_programs` 的 `programs_dir` 经 `shlex.quote` 参数化后再进 `find`，消除经 SSH 的远程 shell 注入。
- **可用性**：移除会固定返回 `NotImplementedError` 的 `ur_get_inverse_kin`（URBasic 基类为空实现）；重写 `ur_set_payload` 为直接发送 `set_payload_mass` / `set_payload_cog` URScript（此前同样命中空桩）。
- **健壮性**：JS 侧把 `_timeout_ms` 传给 worker，Python 的 `_movej_confirm` / `_movel_confirm` / draw 完成确认改为**有界超时**，避免单线程 worker 被永不返回的运动循环永久卡死。
- **行为**：`ur_draw_*` 返回前做有界完成确认，不再提前报「已发送」；`ur_get_digital_in` 的 `which="tool"`（URBasic 未实现）改为明确报错提示改用 `std`/`config`。

### 变更
- 工具数由 50 减为 49（移除 `ur_get_inverse_kin`）。

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

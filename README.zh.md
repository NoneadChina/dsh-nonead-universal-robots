# dsh-nonead-universal-robots

**一个让 DSH 用自然语言直接控制 Universal Robots（UR）机械臂的插件，由拓德科技（Nonead）基于自研的 nUR MCP Server 同源逻辑开发。**（[Suzhou Nonead Robot Technology Co., Ltd.](https://www.nonead.com)）

本插件与该公司的 `Nonead-Universal-Robots-MCP`（见「参考实现」一节）同源，把「用 AI 控制 UR 机器人」的能力以**原生 DSH 工具**的形式接入：插件启动一个常驻的 Python worker（内部复用 vendored 的 `URBasic` 库），工具通过该 worker 与机器人通信，`connect` 一次后即可在同一 IP 上持续发指令。

> ⚠️ **安全提示**：本插件会直接驱动真实机械臂。使用时务必保证机器人可见、急停按钮在触手可及处、工作区无障碍物/人员。把它当作授予 bash 工具一样慎重对待。你（或模型）对任何运动指令负全责。

> 🛡️ **运动审批门禁**：`ur_movej` / `ur_movel` / `ur_move_x|y|z` / `ur_draw_*` / `ur_load_program` / `ur_run_program` / `ur_send_script` / `ur_reset_error` 这些会驱动机器人运动或执行程序的指令，在真正下发到机器人前会**暂停等待人工确认**。交互式部署（审批策略为 `ask`）会在界面上弹出确认框；未组合审批服务或无代理的调用会**以拒绝方式安全关闭**（fail-closed），绝不会在未获批准时运动。可用配置 `requireApprovalForMotion: false` 关闭此门禁。

---

## 功能一览

| 类别 | 工具（`ur_*`） | 说明 |
|---|---|---|
| 连接 | `ur_connect` / `ur_disconnect` | 按 IP 连接 / 断开一台 UR 机器人 |
| 状态 | `ur_get_status` | 一次性读取 TCP、关节、型号、序列号、版本、安全模式、运行/程序状态、电压、电流、温度、开机时长 |
| 位姿 | `ur_get_tcp_pose` / `ur_get_joint_pose` | 读取当前 TCP 位置 / 关节角度 |
| 设备信息 | `ur_get_robot_model` / `ur_get_serial_number` / `ur_get_uptime` / `ur_get_software_version` / `ur_get_safety_mode` / `ur_get_robot_mode` | 型号（含 `remote_control` 字段）/ 序列号 / 开机时长 / 软件版本 / 安全模式 / 运行状态 |
| 程序 | `ur_get_program_state` / `ur_load_program` / `ur_run_program` / `ur_stop_program` / `ur_pause_program` / `ur_list_programs` | 程序状态、加载、运行、停止、暂停、SSH 列表（`list_programs` 兼容真机 `/programs` 与 URSim `~/URSim_Linux-*/programs.*`；`load/run` 支持完整路径/URSim 路径与 `programs_dir`） |
| 寄存器 | `ur_get_int_register` / `ur_get_double_register` / `ur_get_bit_register` | 读取 Int / Double / Bool 寄存器 |
| 健康检查 | `ur_ping` | 无需连接机器人，检测 worker/Python/URBasic 就绪 |
| I/O | `ur_get_digital_in` / `ur_set_digital_out` / `ur_get_digital_in_bits` / `ur_get_digital_out_bits` / `ur_get_analog_in` / `ur_set_analog_out` | 数字输入/输出（含**批量读位**、`which="tool"` 的工具端数字 I/O）、标准模拟输入/输出 |
| 工具配置 | `ur_set_tool_voltage` / `ur_set_tcp` / `ur_set_payload` | 工具电压、TCP、负载质量/重心 |
| 传送带 | `ur_get_conveyor` / `ur_set_conveyor_tick` | 传送带 tick 读取 / 设置 |
| 运动 | `ur_movej` / `ur_movel` / `ur_movep` / `ur_movec` / `ur_servoj` / `ur_move_x` / `ur_move_y` / `ur_move_z` | 关节空间 / 直线 / 路径 / 圆弧 / 连续流 / 沿轴直线运动 |
| 绘图 | `ur_draw_circle` / `ur_draw_square` / `ur_draw_rectangle` / `ur_draw_star` | 画圆 / 正方形 / 长方形 / 五角星（含 URSim 路径） |
| 脚本 / 紧急 | `ur_send_script` / `ur_reset_error` | 发送 URScript / 复位错误 |

除「连接」外，所有工具都接受 `ip` 参数，且都要求**先连接**该 IP。

---

## 安装到 DSH profile

### 方式一：作为 bundle 手动安装

1. 在目标 profile 的 `package.json` 中把本插件加入依赖：

   ```jsonc
   // C:\Users\<you>\.dsh\profiles\web\package.json
   {
     "dependencies": {
       "dsh-nonead-universal-robots": "^0.3.8"
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
   dsh plugin --profile web install
   # 或 cd "$DSH_HOME/profiles/web" && pnpm install
   ```

3. 重启 DSH。插件的 `cordis.patch.yml` 会自动把插件行插入配置树，工具以 `ur_*` 形式出现在模型工具列表中。

### 方式二：本地路径（开发时）

把仓库路径加入 profile 依赖（pnpm 支持 `file:`），便于在本仓库迭代：

```jsonc
"dependencies": {
  "dsh-nonead-universal-robots": "file:D:/MyProgram/GitLab/dsh-Nonead-Universal-Robots/dsh-nonead-universal-robots"
}
```

---

## Python 运行时

插件需要一个可用的 Python 与若干依赖（`numpy`、`paramiko`）来启动 worker。可用 `pythonBin` 配置指向解释器：

```sh
pip install -r requirements.txt
```

`cordis.patch.yml` 中的 `pythonBin`（默认 `python`）、`commandTimeoutMs`（运动/脚本超时，默认 60000）、`connectTimeoutMs`（首次连接超时，默认 30000）都可按部署覆盖。若 `python` 不在 PATH，改成绝对路径，例如 `"C:\\Python312\\python.exe"` 或 `"/usr/bin/python3"`。

---

## 健康检查 / 测试

无需连接真实机器人即可验证插件与 Python 运行时是否就绪：

```sh
npm run test:python   # python ur_worker.py --selfcheck：校验 Python/numpy/paramiko/URBasic/RTDE 配置
npm test              # 起一个真实 worker，走一遍 ping + 异常操作（验证 stdio 协议与进程管理）
```

`npm test` 会返回 `selftest passed.` 或非零退出。若 `python` 不在 PATH，用环境变量指定：

```sh
UR_PYTHON=C:\\Python312\\python.exe npm test
```

> 首次连接到某机器人时，`ur_connect` 有约 20s 的 RTDE 就绪等待，超时会返回清晰错误而非卡死。

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

> 让 192.168.1.199 的 TCP 沿 Z 轴下降 20mm。

```
ur_get_tcp_pose(ip="192.168.1.199")
ur_move_z(ip="192.168.1.199", distance=-0.02)
```

> 绘制一个半径 50mm 的圆（竖直平面）。

```
ur_draw_circle(ip="192.168.1.199", center=[0.3,-0.2,0.4,0,3.14,0], r=0.05)
```

---

## 参考实现

- 本插件仓库：<https://github.com/NoneadChina/dsh-nonead-universal-robots>

本插件与拓德科技的 [`Nonead-Universal-Robots-MCP`](https://gitee.com/nonead/Nonead-Universal-Robots-MCP)（GitHub: <https://github.com/nonead/Nonead-Universal-Robots-MCP>）同源，复用其中的 `URBasic` 库与机器人控制逻辑，由同一团队面向 DeepSeek Harness 重新封装为本插件的 `ur_*` 工具与 stdio worker 协议。`URBasic` 为 MIT（© Tony Ke & Anthony Zhuang / Universal Robots，2009-2025）。

---

## 注意事项 / 限制

- **连接持久性**：worker 进程在插件生命周期内常驻，机器人连接按 IP 保留；worker 崩溃或 DSH 重启后需重新 `connect`。
- **远程控制模式**：部分 UR 机器人需处于「远程控制」才能执行运动/程序指令；`ur_connect` 会提示该状态。
- **工具端数字 I/O**：`ur_get_digital_in` / `ur_set_digital_out` 的 `which="tool"` 用于工具端（法兰侧）数字 I/O。工具端数字信号**不经 RTDE**：读取工具输入会经 `SendProgram` 发送一段短的 URScript 程序，**可能打断正在运行的程序**；写入工具输出则发送 URScript `write_tool_digital_out` 命令。**工具端数字输出的读回不支持**（无可靠的 `read_tool_digital_out` 表达式）。
- **关节电流**：当前 RTDE 配方未直接暴露单关节电流，故未提供 `ur_get_joint_current`（参考实现中的该工具存在取值错误，本实现未沿用）。
- **线程/取消**：运动指令为阻塞到位的轮询，`commandTimeoutMs` 内完成；对长时间轨迹，请在描述中提醒模型设置合理超时或分步执行。
- **非安全边界**：此插件与 bash 工具同级，可驱动物理设备，务必在真实机器人上充分测试后再用于生产。

---

## License

本项目采用**区分用户的双重许可 (User-Segmented Dual Licensing)** 模式：

- **AGPLv3**：适用于**个人用户**及**10人及以下企业/组织**（开源；详见 <https://www.gnu.org/licenses/agpl-3.0.html>）。
- **商业许可证（必须）**：适用于**超过10人**的组织，或任何需要规避 AGPLv3 源代码公开义务（如 SaaS / 闭源分发）的用户。

完整条款见 [LICENSE](./LICENSE)。商业授权请联系 [service@nonead.com](mailto:service@nonead.com)。

`python/URBasic`（vendored）仍沿用其自身 **MIT** 许可（© Anthony Zhuang / Universal Robots，2009-2025）。

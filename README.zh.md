# dsh-nonead-universal-robots

**一个让 DSH 用自然语言直接控制 Universal Robots（UR）机械臂的插件，由拓德科技（Nonead）基于自研的 nUR MCP Server 同源逻辑开发。**（[Suzhou Nonead Robot Technology Co., Ltd.](https://www.nonead.com)）

本插件与该公司的 `Nonead-Universal-Robots-MCP`（见「参考实现」一节）同源，把「用 AI 控制 UR 机器人」的能力以**原生 DSH 工具**的形式接入：插件启动一个常驻的 Python worker（内部复用 vendored 的 `URBasic` 库），工具通过该 worker 与机器人通信，`connect` 一次后即可在同一 IP 上持续发指令。

> ⚠️ **安全提示**：本插件会直接驱动真实机械臂。使用时务必保证机器人可见、急停按钮在触手可及处、工作区无障碍物/人员。把它当作授予 bash 工具一样慎重对待。你（或模型）对任何运动指令负全责。

> 🛡️ **运动审批门禁**：`ur_movej` / `ur_movel` / `ur_movep` / `ur_movec` / `ur_servoj` / `ur_move_optimized` / `ur_move_x|y|z` / `ur_move_tool_x|y|z` / `ur_draw_*` / `ur_load_program` / `ur_run_program` / `ur_send_script` / `ur_reset_error`；0.5.0 新增的 `ur_set_freedrive` / `ur_set_teach_mode` / `ur_power_on` / `ur_power_off` / `ur_brake_release` / `ur_unlock_protective_stop` / `ur_shutdown` / `ur_zero_ftsensor` / `ur_set_conveyor_tracking`；0.6.0 新增的 `ur_force_mode` / `ur_end_force_mode` / `ur_force_mode_settings` / `ur_speedj` / `ur_speedl` / `ur_stopj` / `ur_stopl` / `ur_set_payload_inertia`，以及 `ur_motion_version`、`ur_set_payload`、`ur_set_gravity` —— 这些会驱动机器人运动、执行程序、**或让机械臂脱离程序控制 / 失去刚性支撑**的指令，在真正下发到机器人前会**暂停等待人工确认**。交互式部署（审批策略为 `ask`）会在界面上弹出确认框；未组合审批服务、无代理、或应答不是 `allowed-once` 的调用都会**以拒绝方式安全关闭**（fail-closed），绝不会在未获批准时运动。默认值写在**代码**里（`config.requireApprovalForMotion ?? true`），因此"调用方跳过 schema 解析"这种情形也不会把门禁关掉。可用配置 `requireApprovalForMotion: false` 显式关闭此门禁。`test/approval-gate.test.mjs` 驱动真实工具注册表逐条验证上述行为，包括"多传一个 `op` 参数无法把调用改派到别的指令"。

---

## 功能一览

共 **83** 个工具（`ur_*`）。

| 类别 | 工具（`ur_*`） | 说明 |
|---|---|---|
| 连接 | `ur_connect` / `ur_disconnect` | 按 IP 连接 / 断开一台 UR 机器人 |
| 状态 | `ur_get_status` | 一次性读取 TCP、关节、型号、序列号、版本、安全模式、运行/程序状态、电压、电流、温度、开机时长、关节电流/电压/角速度、TCP 速度与受力、速度倍率 |
| 位姿 | `ur_get_tcp_pose` / `ur_get_joint_pose` | 读取当前 TCP 位置 / 关节角度 |
| 目标值 | `ur_get_target_values` | 读取「**控制器打算去哪**」：目标关节角/角速度/角加速度、目标 TCP 位姿与速度（外加实际值便于对比）。来自 RTDE 的 `target_*` 字段（0.6.0 加入接收配方），读取零代价——这是判断「指令已下发但还没执行 / 正在交融 / 被安全限速拉住」的直接依据 |
| 设备信息 | `ur_get_robot_model` / `ur_get_serial_number` / `ur_get_uptime` / `ur_get_software_version` / `ur_get_safety_mode` / `ur_get_safety_status` / `ur_get_robot_mode` | 型号（含 `remote_control` 字段）/ 序列号 / 开机时长 / 软件版本 / 安全模式 / **安全与机器人状态位**（哪一类安全功能被触发，含 violation / fault；限值数值需去 PolyScope 安全页读）/ 运行状态 |
| 程序 | `ur_get_program_state` / `ur_load_program` / `ur_run_program` / `ur_stop_program` / `ur_pause_program` / `ur_list_programs` | 程序状态、加载、运行、停止、暂停、SSH 列表（`list_programs` 兼容真机 `/programs` 与 URSim `~/URSim_Linux-*/programs.*`；`load/run` 支持完整路径/URSim 路径与 `programs_dir`）。**运行/停止/暂停都会检查控制器应答并回带运行状态**，不再把 "could not understand" 一类拒绝当作成功 |
| 寄存器 | `ur_get_int_register` / `ur_get_double_register` / `ur_get_bit_register` | 读取 Int / Double / Bool 寄存器 |
| 健康检查 | `ur_ping` | 无需连接机器人，检测 worker/Python/URBasic 就绪 |
| I/O | `ur_get_digital_in` / `ur_set_digital_out` / `ur_get_digital_in_bits` / `ur_get_digital_out_bits` / `ur_get_analog_in` / `ur_set_analog_out` / `ur_get_tool_analog_in` | 数字输入/输出（含**批量读位**、`which="tool"` 的工具端数字 I/O）、标准模拟输入/输出（**按工程单位收值**：URScript 的 `set_analog_out` 收的是相对电平 [0,1]，旧实现把 5 当成满量程；`full_scale` 可指定电流域 20）、工具端模拟输入（函数名已对照仓库内官方手册确认，参数语义未经真机验证） |
| 工具配置 | `ur_set_tool_voltage` / `ur_set_tcp` / `ur_set_payload` / `ur_set_payload_inertia` / `ur_set_gravity` / `ur_zero_ftsensor` / `ur_set_tool_output_mode` / `ur_set_tool_communication` | 工具电压（**0/12/24，旧实现调用的是 NotImplementedError 桩，从未成功过**）、TCP、负载质量/重心、**质量+重心+惯性矩阵一次设全**（`set_target_payload`，5.10+；避免 `set_payload` 重置惯性矩阵导致三者不一致）、重力方向（非水平安装用）、力/力矩传感器归零、**工具输出模式**（普通 / power 双针供电）、**工具串口（TCI/RS-485，⚠️ 启用会禁用工具模拟输入）** |
| 控制模式 / 电源 / 安全 | `ur_set_freedrive` / `ur_set_teach_mode` / `ur_power_on` / `ur_power_off` / `ur_brake_release` / `ur_unlock_protective_stop` / `ur_shutdown` | 自由驱动 / 示教模式（可手动拖动机械臂）、上电 / 下电 / **释放刹车**（⚠️ 可能因重力掉落）、**只解保护性停止**（不上电、不释放刹车，与 `ur_reset_error` 的区别）、关闭控制器 |
| 力控 | `ur_force_mode` / `ur_end_force_mode` / `ur_force_mode_settings` | **力控（Force Mode）**：沿/绕选定轴柔性贴合环境并持续施加指定力/力矩。参数与手册逐条对齐：`task_frame` / `selection_vector`（1=柔性）/ `wrench` / `type`（1-3）/ `limits`（柔性轴=最大速度，刚性轴=最大偏差）/ `damping` / `gain_scaling`。脚本里按手册建议先 `sleep(0.02)` 再进力控；退出用 `ur_end_force_mode`。⚠️ `damping`/`gain_scaling` **控制器侧无法回读**，工具只回报本次设置值，不假装读到当前值 |
| 速度控制 | `ur_speedj` / `ur_speedl` / `ur_stopj` / `ur_stopl` / `ur_wait_steady` | 关节/TCP **速度指令**（`speedj` / `speedl`）与对应的减速停止（`stopj` / `stopl`）。⚠️ 速度指令是**开放式**的：`t=0`（默认）时"达速即返回"但机械臂**仍在运动**，必须用 stop* 或 `ur_wait_steady` 收尾。`ur_wait_steady` 轮询 RTDE 已有速度量判断是否真的停住（**没有**用 URScript 的 `is_steady()`——那个在力控/示教模式下恒为 false） |
| 实时遥测 | `ur_get_runtime_telemetry` / `ur_get_robot_voltage` / `ur_get_robot_current` / `ur_get_joint_temperatures` / `ur_get_speed_scaling` / `ur_get_tcp_force` / `ur_get_tool_telemetry` | 关节电流/电压/角速度、TCP 线速度与受力/力矩、工具加速度计、速度倍率、整机电压电流、关节温度、工具电流/电压、I/O 电流。**这些字段本来就在 500 Hz 的 RTDE 数据流里**，读取零代价、无需改配置。单点读取（整机电压/电流、关节温度）与一次性汇总（`ur_get_runtime_telemetry`）并存：轮询某一项时用单点，诊断时用汇总 |
| 传送带 | `ur_get_conveyor` / `ur_set_conveyor_tick` / `ur_set_conveyor_tracking` | 传送带 tick 读取 / 设置、**线性或圆盘跟踪的开启与停止** |
| 运动 | `ur_movej` / `ur_movel` / `ur_movep` / `ur_movec` / `ur_servoj` / `ur_move_optimized` / `ur_move_x` / `ur_move_y` / `ur_move_z` / `ur_move_tool_x` / `ur_move_tool_y` / `ur_move_tool_z` | 关节空间 / 直线 / 路径 / **真正的圆弧**（旧实现内部把 `movetype` 写死成 `'p'`，实际发的是 `movep` 且丢弃途经点；0.6.0 起补上手册的 `mode` 参数：0 插补姿态 / 1 固定姿态）/ 连续流 / **OptiMove 平滑运动**（`optimovej`/`optimovel`，jerk 受限、振动更小；⚠️ 它的 `a`/`v` 是**能力比例** (0,1] 而不是 rad/s 或 m/s）/ 沿轴直线运动 —— `_move_*` 沿**基座**轴，`_move_tool_*` 沿**当前工具**轴（worker 侧用旋转矩阵换算，不依赖 URScript 的 `pose_trans`）。**默认 a/v 已改回官方手册值**（`movej` 1.4 / 1.05，`movel` 1.2 / 0.25；旧代码默认 `movel` v=1 m/s，是手册默认的 4 倍） |
| 运动规划 | `ur_motion_version` / `ur_get_freedrive_status` | 设置 **Motion Version**（手册第 14 章）与 **jerk 增益**（0.01-1.0，只作用于 jerk 受限的剖面：版本 2 的 movej/movel 与 optimovej/optimovel）：版本 2 规划时把速度/加速度**钳到硬件上限**、交融半径重叠时**动态收缩**，而不是像版本 1 那样跳过整段运动并给 "Overlapping Blends" 警告。⚠️ 新机型与 PolyScope X **只支持版本 2**；CB3 没有这个设置。⚠️ 这两个设置**没有回读通道**，只报告本次设置值。`ur_get_freedrive_status` 读取当前姿态在 freedrive 下离**奇异点**的距离（0 正常 / 1 接近 / 2 太接近——**不是** freedrive 的开关状态），据此提示操作员换路径 |
| 绘图 | `ur_draw_circle` / `ur_draw_square` / `ur_draw_rectangle` / `ur_draw_star` | 画圆 / 正方形 / 长方形 / 五角星。**必须先观察到脚本真的在运行**才回报「执行完成」——旧实现发完立刻探测，必然看到"没在跑"，于是无论脚本是否执行都报成功 |
| 脚本 / 紧急 | `ur_send_script` / `ur_reset_error` | 发送 URScript（**校验执行**：哨兵注入到函数体内部/顶层语句之间并回读，「已发送」不再冒充「已执行」；含多个函数且看不出调用哪个时拒绝校验并给 `verified: null`）/ 复位错误 |

除「连接」外，所有工具都接受 `ip` 参数，且都要求**先连接**该 IP。

> 📚 **0.6.0 的手册对齐**：本版本逐条对照仓库内三本官方手册（URSoftware 3.15.4 / PolyScope 5 / PolyScope X）核对了签名、默认值、参数范围与已废弃函数，分析结果见 [`docs/urscript-manual-analysis.md`](./docs/urscript-manual-analysis.md)。其中三处与旧实现不同的**实质修正**：① `movel`/`movej` 默认速度改回手册值；② `ur_force_mode` 的 `damping`/`gain_scaling` 明确标注"无法回读"而不是假装能读；③ `set_target_payload` 只有在给出 `inertia` 时才使用（旧固件上自动退回 `set_payload_mass`+`set_payload_cog`）。

### 只读 3D 数字孪生

插件还内置机器人的**只读 3D 数字孪生**（three.js 渲染）：入口是**右侧栏**「开始」面板里的一张卡片，位置在「工作区文件 / 新建终端 / 浏览器」三张卡片下面；点击后 3D 视图占满右侧栏的内容区。视图轮询同一份状态源，始终与真机同步显示**关节姿态、TCP 坐标系与近期运动轨迹**。数字孪生**严格只读，绝不下发任何机器人指令**——它只轮询 host 的只读路由并渲染收到的数据。

host 侧路由（均限定 loopback 调用方）：

| 路由 | 说明 |
|---|---|
| `GET /dsh-nonead-ur/twin/state[?ip=<ip>][&detail=1]` | 实时位姿（关节角 / TCP / 型号）。`detail=1` 附带 dashboard 侧状态（安全模式、运行状态、速度倍率、关节温度/电流等），位姿通道仍独立轮询，detail 失败不影响位姿 |
| `GET /dsh-nonead-ur/twin/asset?model=<urXX>` | GLB 网格，带内容哈希 `ETag` + `immutable`，支持 `If-None-Match` → 304 |
| `GET /dsh-nonead-ur/twin/models` | 本地实际存在的模型清单 |

失败响应带**机器可读的 `code`**（`no_robot` / `robot_not_connected` / `ambiguous_robot` / `worker_unavailable` / `robot_error`）并回显本次解析到的 `ip`，界面据此给出不同的提示与处置建议（以前四种完全不同的故障都渲染成同一句「未连接机器人」）。

---

## 安装到 DSH profile

### 方式一：作为 bundle 手动安装

1. 在目标 profile 的 `package.json` 中把本插件加入依赖：

   ```jsonc
   // C:\Users\<you>\.dsh\profiles\web\package.json
   {
     "dependencies": {
       "dsh-nonead-universal-robots": "^0.6.1"
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

> ⚠️ **依赖必须装在 worker 用的那个解释器里（一个真实的坑）**
> `lib/worker.js` 会把 `PYTHONPATH` 指向插件的 `python/` 目录，而 CPython 启动时会 import 该目录下的
> `sitecustomize.py`（如果存在）。本仓库里曾有一个**本机私货** `python/sitecustomize.py`，它把本机
> 用户级 `site-packages` 硬编码进 `sys.path` —— 于是"本机能跑"，而换一台机器、或安装发布版
> （该文件**不在** `files` 清单里）之后，`import numpy` 直接失败，所有工具调用都会死。
> 正确做法：**给 `pythonBin` 指向的解释器装好依赖**（或指向一个 venv）。`ur_ping` /
> `npm run test:python` 就是这条链路的自检入口；`npm run verify:host` 则用宿主真实的
> schema DSL 校验工具注册（应报告 83/83）。

---

## 健康检查 / 测试

无需连接真实机器人即可验证插件与 Python 运行时是否就绪：

```sh
npm run test:python   # python ur_worker.py --selfcheck：校验 Python/numpy/paramiko/URBasic/RTDE 配置
npm test              # 跑全部 22 个测试文件 **以及全部门禁脚本**，最后汇总
npm run test:node     # 只跑 Node 侧：跳过需要 Python 的测试文件**与门禁**
npm run check         # 只跑静态 + 跨语言门禁，不跑测试文件
npm run verify:host   # 用宿主真实的 schema DSL 校验全部工具注册与 peer 版本
npm run verify:models # 校验 14 个 GLB 的结构契约
```

`npm test` 跑两类东西，两类都必须过：

- **22 个测试文件**（端到端协议自检、审批门禁、孪生路由、客户端状态机、FK、vendored 库回归）。
  名单来自 `test/test-manifest.json`，并由 `check:manifest` 保证"会调用 Python 的用例"不会被漏登记。
- **10 个门禁脚本**：`check-test-manifest` / `check-package-metadata` / `check-client-bundle` /
  `check-doc-tools`（Node），以及 `check-worker-ops` / `check-tool-params` / `check-rtde-recipe` /
  `check-approval-gate` / `check-new-ops`（Python）。解释器没有 `numpy` 时，依赖 Python 的项会以
  **SKIP + 原因**出现，绝不会显示成通过。

> 0.6.0 新增 `scripts/pdf-extract2.py`：**只用标准库**从 `ScriptManual/*.pdf` 抽文本到
> `ScriptManual/txt/*.txt`（两个 PolyScope 手册的字符码是 glyph id，必须走字体自带的
> `ToUnicode` CMap 才能解出文字）。它是本版所有签名/默认值/范围的可复核来源：
> 有疑问时重新抽取一次，直接查手册原文。

> `check-client-bundle.mjs` 会把 `src/client/**` 重新构建到临时文件并与提交的 `lib/client.js`
> **逐字节**比对：产物落后于源码（改了界面但没重建）会直接让检查失败，而不是静默发布。
> 它绝不覆盖提交产物 —— `scripts/build-client.mjs` 为此支持 `BUILD_CLIENT_OUT`。

> 0.5.0 之前 `npm test` **只跑一次 worker ping**，仓库里另外 20 多个 `*.test.mjs` 一个都不跑 ——
> 所以"npm test 绿了"完全不能说明插件是好的。现在统一由 `scripts/run-tests.mjs` 枚举执行并汇总。

`npm test` 会返回 `selftest passed.` 或非零退出。若 `python` 不在 PATH，用环境变量指定：

```sh
UR_PYTHON=C:\\Python312\\python.exe npm test
```

发布前、以及每次升级 DSH 内核后，都应跑一遍**宿主兼容自检**——它拿**已安装的宿主**校验本插件，而不是校验一份抄下来的关键字清单：

```sh
node scripts/check-host-compat.mjs                 # 缺省宿主 = ../dsh-plugin-desktop/node_modules
node scripts/check-host-compat.mjs <node_modules>  # 也可显式指定宿主
```

它会用宿主实装版本核对 peer 范围、用宿主**真实**的 value-schema DSL 编译**每一个**工具参数 schema（被拒的 schema 会让该工具静默消失）、驱动宿主路由注册，并校验 `dsh.client` 声明与客户端 bundle 的 `__ModuleLoader__` 注册 id。退出码 `0` 表示与该宿主兼容。

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
- **远程控制模式**：部分 UR 机器人需处于「远程控制」才能执行运动/程序指令，`ur_connect` 会报告该状态。**URSoftware 3.1–3.20 之间的 CB3 机器人默认就允许远程控制（设置层面无需额外开启）**；但 `remote_control: false` 仍说明控制器**当前**不在远程模式——本地/示教模式下 URScript 与运动指令会被静默丢弃，需在示教器上切到远程控制。其他固件（e-Series，或不在该区间的 CB3）则需先在 PolyScope 中开启 Remote Control。`ur_status` 另给出 `remote_control_raw`，状态读不到时按"未知"处理而不是假装是 `false`。
- **工具端数字 I/O**：`ur_get_digital_in` / `ur_set_digital_out` 的 `which="tool"` 用于工具端（法兰侧）数字 I/O。工具端数字信号**不经 RTDE**：读取工具输入会经 `SendProgram` 发送一段短的 URScript 程序，**可能打断正在运行的程序**；写入工具输出则发送 URScript `write_tool_digital_out` 命令。**工具端数字输出的读回不支持**（无可靠的 `read_tool_digital_out` 表达式）。
- **关节电流**：当前 RTDE 配方未直接暴露单关节电流，故未提供 `ur_get_joint_current`（参考实现中的该工具存在取值错误，本实现未沿用）。
- **线程/取消**：运动指令为阻塞到位的轮询，`commandTimeoutMs` 内完成；对长时间轨迹，请在描述中提醒模型设置合理超时或分步执行。
- **非安全边界**：此插件与 bash 工具同级，可驱动物理设备，务必在真实机器人上充分测试后再用于生产。
- **包体积**：发布包约 **35 MB**，几乎全部来自 **14 个 `assets/models/*.glb`** 网格；插件自身代码只有数百 KB。若部署在意体积，可用 `python scripts/convert-meshes.py --only <型号…>` 只重新生成需要的子集。
- **未知型号回退**：若某机器人没有内置网格（未知或定制型号字符串），会**回退到近似几何体渲染而不报错**，数字孪生不会因未知型号失败。
- **资产管线**：网格由 `python scripts/convert-meshes.py` 生成，其结构契约（每个 GLB 含 7 个固定命名节点、贴图内嵌）由 `python scripts/verify-models.py` 校验（也暴露为 `npm run verify:models`）。

---

## 第三方资产与许可

除插件自身代码外，本包还随附 14 个机器人网格 `assets/models/*.glb`（约 35 MB）与 `assets/kinematics.json`，全部派生自 Universal Robots 的 [`Universal_Robots_ROS2_Description`](https://github.com/UniversalRobots/Universal_Robots_ROS2_Description)（`humble` 分支，获取日期 2026-09-21）。

许可按型号分为两类，同一型号内不会混用：

- **BSD-3-Clause**（9 款）：`ur3`、`ur5`、`ur10`、`ur3e`、`ur5e`、`ur7e`、`ur10e`、`ur12e`、`ur16e`——同时涵盖 `assets/kinematics.json` 所派生的运动学与关节限位配置。
- **UR「Graphical Documentation」条款**（5 款）：`ur8long`、`ur15`、`ur18`、`ur20`、`ur30`。这 5 款的网格**不是** BSD-3-Clause，而属于 UR 的「Graphical Documentation」，其使用受 UR 的 *Terms and Conditions for use of Graphical Documentation* 约束——该条款不符合 OSI 开源定义，但**允许**在若干限制下使用、修改与分享。相关疑问请联系 <legal@universal-robots.com>。

客户端 3D 渲染基于 [three.js](https://threejs.org/)（MIT）；[esbuild](https://esbuild.github.io/)（MIT）仅用于构建期。

逐型号派生清单、转换参数与许可全文见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。

---

## License

本项目采用**区分用户的双重许可 (User-Segmented Dual Licensing)** 模式：

- **AGPLv3**：适用于**个人用户**及**10人及以下企业/组织**（开源；详见 <https://www.gnu.org/licenses/agpl-3.0.html>）。
- **商业许可证（必须）**：适用于**超过10人**的组织，或任何需要规避 AGPLv3 源代码公开义务（如 SaaS / 闭源分发）的用户。

完整条款见 [LICENSE](./LICENSE)。商业授权请联系 [service@nonead.com](mailto:service@nonead.com)。

`python/URBasic`（vendored）仍沿用其自身 **MIT** 许可（© Anthony Zhuang / Universal Robots，2009-2025）。

# 更新日志 / Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.6.5] - 2026-10

> 本版把数字孪生从"只读预览"做成现场工具，并把 10 Hz 轮询换成推送通道。同时收尾了一批
> **读取回执的诚实性修复**：好几个工具在报告它们其实读不到的值 —— 工具遥测永远返回 `null`、
> 自由驱动检查把陈旧的 `0` 读成"正常"、`power_off` 把"控制器因为刚断电而不应答"当成失败。
> 以下内容都已在树里，只是从未被写下来；0.6.3 与 0.6.4 没有作为独立条目发布过。

### 新增 — 宿主的第 4 条只读路由：SSE 实时流

- **`/dsh-nonead-ur/twin/stream`**（`lib/twin-routes.js`）：用 Server-Sent Events 取代"轮询碰运气"。
  每 `100 ms` 一帧、15 s 一次 `: ping` 心跳（空闲连接正是代理会在 30–60 s 后切掉的东西）、
  `pumping` 标志做背压（上一帧没写完就不发下一帧）、订阅即推首帧、`x-accel-buffering: no`，
  非 `GET` 一律 `405`。**单帧失败只发一个 `error` 事件，绝不拆掉整条流** —— 客户端保留上一帧好数据。
- **流里的 `detail` 走自己的慢节拍**（`TWIN_STREAM_DETAIL_MS` = 2000 ms）：不能每帧带（每帧一次
  dashboard 往返，10 Hz 会把机器人打满），也不能一帧都不带（安全模式、温度与母线电压会永远是空的）。
- **客户端订阅器**（`src/client/robot/twin-stream.js`）：`EventSource`，断线 1 s 重连，连续 8 次失败
  即放弃**并通知订阅者**；环境没有 `EventSource` 时明确说明，而不是静默什么都不做。
- **流与轮询严格互斥**（`src/client/state.js`）：`stream: true` 时一次 `fetch` 都不发 —— 两者并存会让
  同一帧推两次、机械臂画面抖动。切换机器人会整条重建流，且客户端半现在**默认 `stream: true`**。
- 宿主兼容门禁现在期望 **4** 条 `kind:'exact'` 孪生路由（`state` / `asset` / `models` / `stream`），
  不再是 3 条。这条断言的意义是"注册形状变了要让**人知道**"，不是把条数冻死。

### 新增 — 在多台机器人之间选择，并看清自己在看哪一台

- **`setIp()` 会清掉上一台的读数**（`src/client/state.js`）：切换目标立即丢弃 `connected`、`q`、`tcp`、
  `ts` 与 `detail`。把 A 的位姿当成 B 的显示，比什么都不显示更危险。同一个 IP 是 no-op（连快照对象都
  不重建）；空白或非字符串表示"交回宿主解析"。
- **机器人选择按钮与身份行**（`src/client/twin-panel.js`）：选择器只在签名（`${resolvedIp}|${candidates}`）
  变化时重建 —— 每帧重建会在手指还没抬起时把按钮换掉。数值面板最上面一行现在显示 `型号 · IP`；
  IP 以前只躺在 `data-ur-twin-ip` 属性里，界面上一个字都看不到。
- 未连接的帧**必须保留 `ips` 候选**，否则选择器恰恰在最需要它的时候点不到（连了多台 ⇒ 目标有歧义）；
  `setIp` 会 abort 在飞的请求并立刻重取一次，而不是干等下一个 tick。

### 新增 — 先看后动：待审批运动预览

- **`lib/pending-motion.js`** 把审批弹窗变成一次预览，并且**绝不假装自己知道得更多**：`joints`（可以画
  整条幽灵臂）/ `pose`（本插件没有 IK，只在目标位置放标记）/ `relative`（只给文字 —— 绝对目标要先结合
  当前 TCP）/ `opaque`（画圆方星、跑程序、力控与速度指令没有单一目标）。它**永不抛错**：畸形参数退化成
  `opaque`，摘要截断在 200 字符。
- **`createPendingMotionStore()`** 为每次审批发放专属 **token**，于是两次审批重叠时，先结束的那次
  抹不掉后一次的预览。`read()` 把超过 `PENDING_MOTION_TTL_MS`（10 分钟）的预览视为已结束 ——
  一次被打断的审批就是这样停止在屏幕上留下一层假目标的。
- `lib/index.js` 在弹窗**之前** `begin`、在 `finally` 里 `end`，所以批准、拒绝、以及"审批服务抛异常"
  三种情况都会撤掉预览。
- 状态路由**只在有待审批时**才带 `pending_motion` 字段（没有时字段缺席，而不是 `null`），客户端才能
  区分"当前没有审批"与"有审批但解析不出目标"。与 `detail` 不同，客户端**刻意不**沿用上一帧的
  `pending_motion`。

### 新增 — 孪生面板上的现场工具

- **幽灵臂**（`src/client/robot/ghost-arm.js`）：克隆真臂叠加在实际位姿上，跟随误差、滞后与交融一眼可见。
  geometry 与贴图与真臂**共享**（多一层几乎不额外占显存）—— 也正因为如此，克隆树的 geometry
  **绝不 dispose**：那正是真臂在渲染的同一批对象。待审批目标显示为橙色，控制器当前目标为青色。
- **TCP 坐标轴**（`src/client/robot/tcp-axes.js`）：固定 8 cm 的 `AxesHelper` 在 UR3 上偏大、在 UR30 上
  偏小，而且没有标签。尺寸改为臂半径的 `0.12 ×`，钳在 `[0.03, 0.3]`，并配 X/Y/Z 字母标签（用 canvas
  画，不依赖外部字体，无 canvas 环境优雅退化）。缩放必须写在内层节点：外层节点每帧接收 `tool0` 矩阵，
  而 `scale` 在 `matrix.fromArray` 里是留不住的。
- **工程辅助图层**（`src/client/robot/overlays.js`），默认全关：可达包络、负载重心、TCP 受力箭头
  （死区 1 N、上限 0.6 m）。可达半径取前 6 段连杆长度之和，并明确注明它是**上界**，不是厂商 spec 的
  reach 值。重心标记已实现但**刻意不暴露** —— 插件没有能读回载荷的 op，按钮点下去不会有任何反应。
- **截图导出**（`src/client/robot/screenshot.js`）：PNG 水印带型号、IP、安全模式、速度倍率、关节角、
  TCP 与本地时间。水印画在画布的**副本**上，而副本必须在**渲染之后同步**取 —— 上下文是
  `preserveDrawingBuffer: false`，先让出控制权再取图可能拿到一张全黑图。
- **轨迹控件**：清空 / 暂停-继续 / 导出 CSV。CSV 除位置外**还带关节角**，否则导出的数据无法复现姿态。
  颜色现在随样本新旧从暗蓝渐变到亮青，同时表达方向与相对速度；时间戳全不可用时退化为按序号渐变，
  而不是产出 `NaN`。
- **可访问性**：canvas 是 `role="img"` + `aria-label` + `tabindex="0"`，方向键与 `Home` 驱动既有的视角
  预设 —— 这是纯键盘用户目前唯一能操作 3D 视图的途径。数值面板是 `role="status"` + `aria-live="polite"`
  （只播报变化，不每次重读整块），开关按钮带 `aria-pressed`，被截断的读数补 `title`。

### 新增 — 客户端文案变成一张真正的表

- `src/client/strings.js` 不去赌 `@deepseek-ai/dsh-client-locale`（本机并未安装）：`zh` 与 `en` 的键集合
  **完全对称**（有测试双向断言这一点），带插值的键写成函数，`resolveLocale` 只认主语言子标签，并且
  认不出时**回退中文而不是英文**。右栏入口卡片与覆盖层的文案也取自同一张表。

### 修复 — 读取回执：工具报告了它们读不到的值

- **`ur_get_tool_telemetry` 除了 `null` 什么都返回不了。** 工具侧字段既不在 RTDE 配方里，vendored
  访问器又是 `NotImplementedError` 桩。配方现在声明了它们（`tool_*`、`io_current`、
  `target_speed_fraction`；按 RTDE 文档 `tool_output_voltage` 是 `INT32`，24 V 读作 24000），工具也改为
  直读 `dataDir`。
- **`ur_get_tool_analog_in` 改为优先直读 RTDE**，只在不得不时才回退到"发脚本 + 回读寄存器"那条路 ——
  那条路会打断正在运行的程序。回读寄存器默认 22，以避开 `send_script` 用的 23。
- **`ur_get_speed_scaling` 不再把静止读成"被压到 0"。** `speed_scaling` 是**实际**倍率，
  `target_speed_fraction` 是**请求**倍率；现在两个都给，并在应答里写清语义。
- **`ur_get_freedrive_status` 用哨兵 token** 区分"该固件不支持"与"值真的是 0"。旧实现读到的是一个
  陈旧寄存器，却把它当成正常。
- **`ur_power_off` 以 `robot_status_bits` 的 `PowerOn` 位为准**，于是"控制器正因为刚断电而不应答"
  不再被报告成失败。
- **`ur_draw_circle` 写入起始哨兵**，把一次盲目的 60 s 超时变成即时的 `NOT_EXECUTED`（控制器根本没跑脚本时）。
- **`ur_move_tool_x/y/z` 的工具系→基座系换算放在 worker 侧**（`_tool_axis_move`）：读当前 TCP 位姿，
  用该位姿的旋转矩阵把位移转过去，再发基座系 `movel`。这里**刻意不用** `pose_trans` —— 它在 CB3 /
  URSoftware 3.15 上出现过运行期中止。

### 修复 — 两处肉眼可见的缺陷

- **回退臂永远是 UR3 量级。** `buildFallbackArm()` 无条件使用 `ARM_LINKS`，于是加载失败的未知型号会退回到
  与眼前这台机器人不符的几何。连杆长度现在由 `linkLengthsFromKinematics(kin.links)` 推出，逐值回退，
  且永不产出 `NaN`/`0`/负数 —— 一个 `NaN` 顶点会让整棵子树消失。
- **右栏 3D 视图原先是一个绝对定位的覆盖层。** 它的包含块不是右栏内容体，实测比右栏宽、压到对话区上方。
  现在改为正常流的 flex 子项，并以内联方式隐藏引导列（记录原值，收起时还原）。入口卡片优先**深度克隆
  原生卡片**（主题、圆角与图标槽全都挂在哈希类名上，手工复刻必然漂移），原生卡片缺失时退回自建卡片，
  引导列稍后渲染出来时再升级为克隆卡片；点了别的卡片或引导列消失即自动收起。

### 变更 — worker 背压

- `lib/worker.js` 的 `DEFAULT_MAX_IN_FLIGHT = 8`：超过上限的调用**直接拒绝，不排队**。worker 是单线程的，
  排在卡住的那个请求后面的调用只会各自烧完自己的超时；错误文案现在会点名可能的原因（"机器人可能已无响应"）。

### 新增 / 变更 — 门禁与自检

- **`scripts/check-new-ops.py`** —— 0.6.0 新增的每个 worker op 的行为门禁：对着假控制器断言**实际下发的
  URScript**（力控、`speedj`、`optimove`、`movec`、传送带跟踪、绘图路点序列），外加 14 条必须 fail-closed
  的 `ValueError` 用例。
- **`scripts/check-test-manifest.mjs`** 把 `test/test-manifest.json` 与 `test/**` 里真实的 Python 调用
  **双向**对账：需要 Python 却没登记的用例失败，登记了却根本不碰 Python 的用例同样失败。
- **`scripts/check-package-metadata.mjs`**：`main` / `exports` / `dsh.bundle.patch` 必须可解析、客户端
  bundle 必须以包名注册、`files` 必须覆盖运行时且**不得**含本机的 `python/sitecustomize.py`、任何源文件
  不得硬编码作者机器的路径。**`scripts/check-doc-tools.mjs`** 把 README 工具表与真实注册表对账（只解析
  表格行 —— 旧版扫全文，删掉一整行表格它照样通过），**`scripts/check-tool-params.py`** 双向强制跨语言
  参数契约。有两个坑值得记下来：`check-host-compat.mjs` 把已安装的桌面 `node_modules` 排在向上查找**之前**，
  因为本仓库自带的 `@deepseek-ai/dsh-tools` dev 副本更旧，用它校验会得出误导性的"0/83 注册成功"；
  `check-tool-params.py` 的中文诊断只写文件、stdout 保持 ASCII，否则中文 Windows 控制台会让检查自己
  以 `UnicodeEncodeError` 死掉。
- `npm test` 现跑 **9 条门禁**（4 Node + 5 Python）与 **35 个测试文件**（11 Python、24 Node）；
  `check-host-compat.mjs`（对宿主真实 DSL 的 83/83 个工具、4 条路由）仍走 `npm run verify:host`。
  本机实测 **44 项全部通过**（Python 那一半需要 `numpy`/`paramiko` 可导入 —— 见 `python/sitecustomize.py`）。

- **`tool_mode` 不是工具输出模式，它的含义未确认。** 在 UR30 / PolyScope 5.21 上实测为 253，且
  调用 `ur_set_tool_output_mode(0)` / `(1)` 时**不发生变化**。读它本身没问题 —— 它是从 RTDE
  原样透传的 —— 但 `test/readback-fixes.test.mjs` 的夹具编造了一个看起来很像模式枚举的 `2`，
  让这个字段显得有意义。夹具现改用实测值 253，并写明其含义待定。
- **程序加载/运行/暂停/停止在"控制器没有可运行的程序"时表现得如实。** `ur_run_program` 逐字回报
  控制器的拒绝（`Failed to execute: play`），而不是谎报成功；`ur_load_program` 会拒绝含尖括号的
  名字 —— 这是对的（`<未命名>` 是 PolyScope **显示**未保存程序的方式，不是文件名），但也意味着
  `loaded_program` 那串不能直接喂回 `ur_load_program`。

- **`ur_get_conveyor` 现在会自证那段 URScript 真的执行过，而不是回读一个没人写过的寄存器。**
  传送带 tick 只能靠控制器执行一段 URScript 取回，而**在加载期被拒收**的程序一行都不会执行，
  也不会置"程序执行错误"标志 —— 旧实现于是照样回读 `output_double_register_0`，把那里碰巧残留的
  值报出去。上面那个"函数名写错"的缺陷能潜伏这么久，根因就在这里。现在工具先探测通道，
  再执行一段由首尾哨兵夹住的载荷：哨兵写 **int** 寄存器、tick 写 **double** 寄存器 ——
  刻意分成两个寄存器家族，这样"载荷那条路坏了"不会把哨兵一起带走、把所有结局都塌缩成
  "什么都没发生"。三种结局分开报：**跑到末尾**（`verified: true`，tick 可信）、
  **开始了但没跑到末尾**（`UNSUPPORTED`，不给 tick 值）、**压根没执行**
  （`NOT_EXECUTED`，不给 tick 值并点名最可能的原因）。已在 UR30 / PolyScope 5.21 上验证：
  工具报 `verified: true`，而独立回读 `output_int_register_20` 得到的就是它声称的那个结束哨兵。
  两个可选参数（`register`、`payload_register`）用来挑寄存器，两者的旧值都会被覆盖。
- **`ur_get_double_register` 与 int 寄存器走同一条读取路径。** 它此前直接调
  `OutputDoubleRegister`，访问器缺失或抛异常就变成异常而不是取值；现在改用新增的
  `_read_double_register` helper，读不到时回落原始 RTDE 字段 —— 这正是 `_read_int_register`
  一直以来的做法。

### 修复 — 一次对 URSim（UR30 / PolyScope 5.21.3）的实机测试查出来的

- **`ur_get_conveyor` 只可能返回 0 —— 因为更早的一次"修复"让控制器把整段脚本拒收了。**
  URScript 里写双精度寄存器的函数叫 **`write_output_float_register`**；`output_double_register_0`
  是**同一条数据的 RTDE 字段名**。更早的版本把这两个名字当成了同一个，把调用"改正"为
  `write_output_double_register` —— 一个并不存在的函数。控制器于是在**加载阶段就拒收整段程序**，
  一行都不会执行；`waitRobotIdleOrStopFlag()` 因此永远看不到执行错误，而
  `get_conveyor_tick_count()` 接着去回读寄存器 0 —— 一个从未被写过的值。**一次看得见的报错，
  就这样变成了静默的错值。** 在 PolyScope 5.21 / UR30 上实测：`write_output_float_register(0, 42.5)`
  被接受且 `output_double_register_0` 读回 42.5；而 `write_output_double_register(0, 99.5)` 被直接
  拒收（`ur_send_script` 的哨兵根本不落地）。现已改回，`urScript.py` 里就地写明证据，并由
  `test/readback-fixes.test.mjs` 在错误名字再次出现时失败 —— 当初那次改动**完全没有测试覆盖**，
  它就是这样溜过去的。

- **控制器发来的每一个非 ASCII 字符串都是乱码。** `dashboard.py` 的接收路径用
  `''.join(map(chr, out))` 拼字符串 —— 一个字节取一个码点，等价于按 Latin-1 解码，于是
  PolyScope 5 的 `STOPPED <未命名>` 到手变成 `<æªå½å>`、`(三月 14 2025)` 变成 `(ä¸æ 14 2025)`：
  中文程序名在任何一处读数里都读不出来。现在按 UTF-8 解码，解不开再退回 Latin-1
  （老固件若真发单字节文本仍能工作）。
- **`program_state` / `runtime_state` 把程序名一起带出来了。** 与 `safetymode` / `robotmode`
  只带 `标签:` **前缀**不同，`programState` 回的是「状态词 **加上** 程序名」—— 实测空闲时
  `STOPPED <未命名>`、运行中 `PLAYING <程序名>`。`_enum_token` 只剥前缀，于是客户端按裸枚举词
  查中文表落空，HUD 显示的是「程序 STOPPED <未命名>」而不是「程序 已停止」。新增的
  `_program_state` 在协议边界剥掉尾部的 `<程序名>`，同时**不动** `"<查询失败>"` 哨兵。这与 0.6.2
  修的前缀缺陷是同一类 —— 而夹具又犯了同样的错（`ur_programState` 被伪造成裸值 `"STOPPED"`），
  所以 `test/safety-status.test.mjs` 现在喂真实的 `STOPPED <未命名>`，并把"剥掉程序名"双向钉住。
- **`ur_get_digital_in(which="tool")` 抛出的错误没有信息量，还可能报出陈旧值。** 工具数字输入
  不经 RTDE，只能发一段 URScript 程序 —— 而在**没有接工具**的 UR30/URSim 上，控制器会**让这段
  程序以运行期错误结束**。上游随即抛出 `RuntimeError: Robot program execution error!!!`
  （完全没有信息量），而 `urScript.get_tool_digital_in` 接着去**回读输出寄存器 0** —— 把那里残留的
  值当成输入电平报出去。现在这条失败路径返回可操作的错误（点名常见原因：未连接工具、工具 I/O
  未启用、工具端被 TCI 串口占用），并且**不读任何寄存器**。同时也对着控制器证实了：寄存器这条路
  从来没问题 —— `write_output_integer_register(7, 12345)` 读回来就是 12345，被控制器拒绝的是
  `get_tool_digital_in` 本身。

### 文档

- **补回丢失的 `## [0.6.0]` 标题。** 手册交叉核对的说明（"工具数 67 → 83"）自写下起就一直挂在 0.6.1
  条目内部，没有自己的版本标题；其余每个版本都有。

## [0.6.2] - 2026-09

> 针对 DSH `0.2.0-rc.2` 做了一次兼容核对（并与 `0.1.7-rc.2` 交叉对照），发现有三个工具从未
> 到达模型。它们的参数 schema 写了显式的 `required: false`，而值 schema DSL 直接拒绝这种写法——
> 被拒的参数会让**整个工具**注册失败，只在日志留一行 warning。表里写着 83 个工具，实际能调的只有 80 个。

### 新增 — 面板终于用上了宿主一直在发的遥测

- **`detail=1` 原本没有任何消费者。** 路由一直能返回 dashboard 侧状态（`safety_mode`、
  `robot_mode`、`program_state`、`running`、`speed_scaling`、`joint_temperatures`、
  `joint_currents`、`robot_voltage/current`），但客户端从不请求它。现在它在**既有那条轮询链上
  按慢节拍**取（`detailMs`，默认 2 s）——不新增第二条链，所以"同一时刻只有一次请求在飞行中"
  依然成立，位姿通道也保持 10 Hz。某一轮没带 detail 时沿用上一次的值，数值行不会闪烁。
- 数值面板多了两行（安全/模式/程序/速度，以及关节温度与母线电压电流），并且**安全模式异常时
  会接管状态行**，不再埋在「已连接 · ur5e」后面。不认识的模式串**原样显示并视为异常** ——
  固件新增一个模式，绝不能因此让一次保护性停止看起来像正常。

### 新增 — 视角工具栏、按包围盒取景、按需渲染

- **相机与基座网格不再按 ~0.8 m 的臂写死**，两者都由模型包围盒推导，于是从 UR3（reach ≈0.94 m）
  到 UR20/UR8long（≈2.4 m）开面板都是正确取景；`min/maxDistance`、`near/far` 与网格尺度跟同一个
  半径走。换机型时网格会重建（并释放旧的那一个）。
- **补上了一直不存在的工具栏**：重置视角 + 等轴测/前视/侧视/俯视。`scene.js` 从写下那天起就
  提到过一个"重置视角"控件，但面板里从来没有 —— 视角弄丢之后唯一的办法是收起面板再展开。
- **按需渲染**：只有确实有变化（新采样、尺寸变化、换模型、相机被拖动、切换预设）才真的画一帧。
  以前每帧无条件渲染，包括未连接时和机械臂静止时。
- **后台标签彻底停帧**（`visibilitychange`），回到前台自动继续。轮询早就对后台降频了，渲染没有。

### 修复 — 三个工具被静默漏注册

- 数组参数助手无条件写出 `required`，于是那些要求**可选**数组的调用点生成了 `required: false`。
  值 schema DSL 只接受 `required: true`（`required must be true when present`）；声明"可选"的方式是
  **省略**这个键。助手现在改为省略，而不是写 `false`。
- 恢复的工具：`ur_set_conveyor_tracking`（`direction`、`center`）、`ur_force_mode`（`task_frame`、
  `wrench`、`limits`）与 `ur_set_payload_inertia`（`inertia`）。`scripts/check-host-compat.mjs`
  对 `0.1.7-rc.2` 与 `0.2.0-rc.2` **两个宿主都报 83/83**。
- 该规则在两个宿主版本里逐字节相同，所以这从来不是版本兼容性回归：插件自带的
  `test/tool-schema-dsl.test.mjs` 看不见它，因为它把 `@deepseek-ai/dsh-tools` 换成了桩，只校验
  作者关键字白名单、从不校验 `required` 的取值。

### 修复 — dashboard 应答带着标签前缀，`NORMAL` 被读成安全异常

- **安全模式从来没有以裸枚举词到达客户端。** UR 对 `safetymode` / `robotmode` 这类查询回的是
  带标签的整行（`"Safetymode: NORMAL"`、`"Robotmode: RUNNING"`），而 worker 把整行**逐字**塞进了
  `safety_mode`、`robot_mode` 与 `program_state`。客户端按裸枚举词查表，于是查不到 —— 而
  `isSafetyHazard` 又刻意把"不认识的模式"算作异常，`NORMAL` 就这样被判成了异常。孪生面板底部
  随即**恒挂**「机器人可能已停止，请检查示教器」，**机械臂动与不动都一样**；带前缀的字符串还
  一并渗进了数值行、截图水印与 `ur_get_status`。
- 修法：`_enum_token` 在**协议边界**（唯一知道 dashboard 原始线格式的地方）剥掉 `标签:` 前缀，
  所有枚举字段统一走它。本来就没有前缀的应答（`programState` 回的 `"PLAYING"`）与
  `"<查询失败>"` 哨兵原样透传。
- `test/safety-status.test.mjs` 原先编造了裸值应答（`"PROTECTIVE_STOP"`），这正是套件一直全绿的
  原因。现在它喂真实带前缀格式，并把这条归一化钉成契约。

## [0.6.1] - 2026-09

> 对整个项目做了一次审核（四路并行审计 + 我本人动手复核，报告在 `docs/audit/`），发现了一批
> **测试看不见**的缺陷：运动审批门禁可被**完全绕过**、一个随包发布的文件**没有被 git 跟踪**、
> `test:node` 不可能通过、两个运动工具的行为与文档不符。本版全部修掉，并把审计用的检查
> 变成真正会失败的门禁。

### 安全 — 审批门禁可被完全绕过（host-audit H-1）

- **`lib/worker.js` 拼线上载荷时是 `{ id, op, _timeout_ms, ...params }`（`params` 展开在最后），
  而门禁判定用的是闭包里的 `op`。** DSH 的值 schema 不拒绝未声明的参数，于是模型只要在任意
  **未受门禁**的工具上多传一个 `{"op":"power_off"}`，worker 就会执行 `op_power_off` 而
  **完全不弹确认**。全部 38 个受门禁的指令（`movej`、`send_script`、`run_program`、
  `brake_release`、`force_mode`、`shutdown`…）都能这样触达；多传 `id` 还能让调用挂满超时后被 kill。
- 修法：参数在到达 worker 之前，按**该工具自己声明的参数表**白名单过滤；`op` 永远取门禁判定
  所用的那个闭包值，不可能被参数影响。`test/approval-gate.test.mjs` 驱动真实工具注册表，
  断言注入的 `op` / `id` / `_timeout_ms` 一律到不了 worker。

### 安全 — 门禁依赖 schema 应用默认值（host-audit M-6）

- `requireApprovalForMotion` 是 `Config` 四个字段里**唯一**在 `apply()` 中没有 `??` 兜底的，
  因此任何用"未经 schema 解析的裸 config"调用 `apply()` 的路径都会拿到 `undefined`，
  于是**静默关掉整道门禁**（fail-open）。现在默认值落在代码里
  （`config.requireApprovalForMotion ?? true`），并有测试钉住它。

### 修复 — 受门禁清单不完整（host-audit H-2）

- `set_payload` 没受门禁，而和它同类的 `set_payload_inertia` 受了 —— 两者都发
  `set_payload_mass` + `set_payload_cog`，都会**把力/力矩测量归零**（与受门禁的
  `zero_ftsensor` 同效）。`set_gravity` 同样没受门禁，而设错就是"松手后下坠或上飘"。
  两者现已受门禁，并加了成对断言，防止将来只门禁其中一个。

### 修复 — 两个工具的行为与文档不符（worker-audit HIGH-1 / HIGH-2）

- **`draw_square` / `draw_rectangle` 把距离写进了旋转分量。** `coordinate="z"` 时竖直边写的是
  `wp[1][3] -= border`，而索引 3 是 **rx（弧度）** —— 于是 `draw_square(border=0.2)` 让工具转了
  ≈11.5° 而不是画方。现在两处都用索引 2（z，米），并用测试断言整条路点序列与"姿态分量全程不变"。
- **`conveyor_tracking` 每个实参都在手册的错误槽位。** 它发的是 `conveyor_pulse_decode(a, b, 0)`
  （第一槽是**解码方式**，而 `0` 的含义是"脉冲解码关闭"）、
  `set_conveyor_tick_count(0, ticks_per_meter)`（第二槽是 0-4 位宽枚举）、以及
  `track_conveyor_linear(p[0,…], speed)` / `track_conveyor_circular(p[0,…], radius, speed)`
  （手册要的是方向/圆心位姿、每米/每转脉冲数、布尔量）。已按手册重写为
  `setup_pulse` / `setup_absolute` / `linear` / `circular` / `stop` 五个动作，量纲正确，
  并按固件区分编码器引脚范围（CB3 0-3、e-Series 8-11）。返回值里
  `hardware_verified: false` 如实标注：签名已对过手册，但跟踪行为需要真带编码器的传送带才能确认。

### 修复 — worker 错误处理里的崩溃路径（worker-audit MEDIUM）

- `ur_worker.py` 的未预期异常分支要记 `req.get("op")`，而 `req` 是在 `try` **内部**绑定的 ——
  于是一行坏 JSON 会在**异常处理里再抛** `UnboundLocalError`：既不回应本次请求，还让 worker
  直接退出。现在 `req` 在 `try` 之前初始化；用 `scripts/probe-malformed-request.py` 复现并复核。

### 修复 — 死掉的子进程会污染它的继任者（host-audit H-3）

- `lib/worker.js` 的 `exit` 处理无条件清掉 `this.proc` / `_spawnPromise` 并失败**所有**在飞请求。
  被 kill 的子进程，其 `exit` 事件完全可能在新子进程已经起来并开始服务之后才到达（500 ms 重启
  退避窗口，而孪生面板每秒发约 20 次调用）——于是健康的调用会收到"UR worker exited"，而它的
  子进程其实活着；`stats().running` 说谎；`dispose()` 可能留下一个仍占着控制器独占 RTDE 会话的
  孤儿 Python 进程。现在只清理属于自己的状态、只失败**路由到该子进程**的请求，并为每个子进程
  单独保留 stderr。
- `proc.stdin` 上补了 `error` 监听：子进程死后写入触发的 EPIPE 是**未处理的 'error' 事件**，
  它会掀掉整个 DSH 宿主进程，而不是让这一次调用失败。

### 修复 — 审计仓库本身发现的发布阻断

- **`python/URBasic/rtdeConfiguration.xml` 没有被 git 跟踪**，而 `package.json` 声明要发布它、
  `test/rtde-config.test.mjs` 要求它存在、`rtde.py` 优先解析它（vendored Default 没有
  `target_*` 字段、没有位寄存器 32-63、还带一个 `<send>` 段）。新克隆会静默丢掉这份配方。
  现已纳入跟踪。
- **`npm run test:node` 不可能通过**：`test/selftest.test.mjs` 会 spawn Python，却不在
  `PYTHON_DEPENDENT` 里。名单现在由 `test/test-manifest.json` 描述，并由
  `scripts/check-test-manifest.mjs` 从源码重新推导"哪些测试文件真的会调用 Python"并与名单对账
  —— 漏登记会变成一次失败的自检，而不是一句莫名其妙的 `exit 1`。
- 解释器探针现在验证 **worker 真正需要的依赖**（`import numpy`），而不是"Python 能启动"：
  以前一个没有 numpy 的解释器会让那十个依赖 Python 的文件**被执行并失败**，于是环境问题被
  误报成插件缺陷。
- **`ur_set_analog_out` 从没声明 `full_scale`**，而 worker 会读它、两份 README 与 CHANGELOG 都
  宣传它 —— 结果是 0-20 mA 端口根本用不了（`value=16` 会被"必须在 [0, 10.0] 内"拒掉）。
  现已声明并写清域（电压 10 / 电流 20）的语义。
- **`numberArray()` 把 `required` 写死成 `true`**，让"文档说可选"的数组在 schema 里变成必填
  （`force_mode.task_frame` / `wrench` / `limits`、`set_payload_inertia.inertia`），
  也使 `set_payload_inertia` 文档里写的 CB3 兜底路径完全不可达。现在 `required` 必须显式给。
- 英文 README：审批门禁清单漏掉全部 0.6.0 新工具；安装片段仍写 `^0.4.0`（会装到 0.5.0 之前的版本）。

### 新增 — 审计用的检查变成 `npm test` 里真正会失败的门禁

- **`test/approval-gate.test.mjs`**（新增，9 个用例）：驱动真实工具注册表，逐条证明受门禁的
  op 在获批前绝不下发；四条 fail-closed 路径（无审批服务 / 无 agent / 审批抛异常 / 任何非
  `allowed-once` 应答）全部拒绝；只读 op 不打扰人；`requireApprovalForMotion: false` 才真正放行；
  参数注入无法改派调用。
- 六个审计脚本原来都是**只打印、永远 exit 0** —— 正是本项目自己反复警告的"绿灯说明不了什么"。
  `check-worker-ops.py`、`check-approval-gate.py`、`check-rtde-recipe.py`、`check-tool-params.py`
  现在会在真有问题时**非零退出**，并且全部（连同 `check-test-manifest`、`check-package-metadata`、
  `check-doc-tools`，以及新增的 `check-client-bundle.mjs`）都接进了 `npm test` 与 `npm run check`。
- `check-client-bundle.mjs` 取代了原来的"字面量抽样"启发式（要么只看 6/113 条、要么大量假警报），
  改成**确定性的重建比对**：把 `src/client/**` 重建到临时文件再与提交产物比对，于是"产物落后于
  源码"会让构建失败。它绝不覆盖提交产物 —— `build-client.mjs` 为此新增 `BUILD_CLIENT_OUT`。
- `scripts/probe-malformed-request.py` 与 `scripts/probe-sendprogram-blocking.py` 保留两个无需硬件的
  探针：前者复现"坏 JSON 杀死 worker"的路径，后者是"进入永不结束的模式（力控/自由驱动）不会卡住
  后续发送"的可执行证据（实测 0.25 s —— 记下来，免得将来又有人只读源码重新怀疑一遍）。

### 文档

- `docs/audit/` — 四份带 `file:LINE` 引用与代码原文的审计报告（`worker-audit.md`、`host-audit.md`、
  `client-vendored-audit.md`、`verification-audit.md`），外加 `round2-verification.md`：记录我动手
  复核的结论、**修正了子代理报告中三条评级过高的 HIGH**，并列出"已检查确认无问题"的清单
  （门禁清单完整性、RTDE 配方余量、包元数据、bundle 新鲜度、`SendProgram` 阻塞行为）。

## [0.6.0] - 2026-09

> 本版把插件**逐条对照仓库内三本官方 URScript 手册**（`ScriptManual/scriptManual_3.15.4.pdf`
> 对应 URSoftware 3.x / CB3、`script_directory_Poly5.pdf` 对应 PolyScope 5 / e-Series、
> `script_directory_PolyscopeX.pdf` 对应 PolyScope X / 10.x）重新校对了一遍：补齐了手册里有、
> 插件里没有的能力，改正了三处**默认值与语义与手册不符**的地方，并把交叉核对结果沉淀成
> [`docs/urscript-manual-analysis.md`](./docs/urscript-manual-analysis.md)。
> 工具数 67 → **83**。

### 新增 — 力控（`ur_force_mode` / `ur_end_force_mode` / `ur_force_mode_settings`）

- 这是插件此前**完全没有**的一大块能力：力控让机器人沿/绕选定轴变"柔性"并持续施加指定力/力矩
  （打磨、装配、贴合、拖动示教之外的下压类工艺都要用它）。参数与手册逐条对齐：
  `task_frame` / `selection_vector`（1=柔性）/ `wrench` / `type`（1-3）/ `limits`
  （柔性轴=最大 TCP 速度，刚性轴=最大允许偏差）/ `damping`（0-1）/ `gain_scaling`（0-2）。
- 实现方式与手册语义一致：力控是一个**持续状态**——脚本用
  `while True: force_mode(...); sync() end` 让它在控制器侧一直生效（与 URBasic 的做法相同），
  因此 `ur_force_mode` 只负责"进入"，退出用 `ur_end_force_mode`（发新脚本抢占该程序并调用
  `end_force_mode()`）或在示教器停止程序。
- 按手册建议在进入力控前插入 `sleep(0.02)`（手册 15.12 的 Note 明确要求，用于避免沿柔性轴的
  运动与高减速），并**在本地就校验** `selection_vector` 只能是 0/1、`type` ∈ 1/2/3、
  `damping` ∈ [0,1]、`gain_scaling` ∈ [0,2]——这些越界在控制器上会直接报错或让力控不稳定。
- ⚠️ **如实标注**：`damping` / `gain_scaling` **控制器侧没有回读通道**（手册只定义了
  `force_mode_set_*`），所以 `ur_force_mode_settings` 只回报"本次设置值"并显式给出
  `readback_supported: false`，不假装读到了当前值。

### 新增 — 速度控制与静止判定（`ur_speedj` / `ur_speedl` / `ur_stopj` / `ur_stopl` / `ur_wait_steady`）

- `speedj(qd, a, t)` / `speedl(xd, a, t, aRot)` / `stopj(a)` / `stopl(a, aRot)` 按手册签名实现。
  `aRot` 省略时按手册语义走 `aRot='a'`（与 `a` 同值）。
- ⚠️ 速度指令是**开放式**的：手册说明 `t` 省略时"达到目标速度后函数返回"——**返回不等于停下**。
  因此工具返回值里明确写出"机械臂仍在运动，需要 stop*/wait_steady 收尾"，`t=0`（默认）时不会
  假装动作已经结束。
- `ur_wait_steady` 实现"等机器人静止"：**没有**用 URScript 的 `is_steady()`（手册 Poly5 16.39
  明确写着它在力控/示教模式下恒为 false，且它是表达式、需要额外一段程序+寄存器回读），
  改为轮询**已在 500 Hz RTDE 数据流里**的 `actual_TCP_speed` 与 `actual_qd`——零额外往返、
  在力控模式下同样给出真实判断。超时不报错，而是回报 `steady: false` 与当时的实测速度。

### 新增 — 目标值（`ur_get_target_values`）与 RTDE 配方扩展

- 新增读取"**控制器打算去哪**"：目标关节角/角速度/角加速度、目标 TCP 位姿/速度（并附带实际值
  便于对比）。这是判断"指令已下发但未执行 / 正在交融 / 被安全限速拉住 / 程序被取消"的直接依据。
- 实现方式是给 `URBasic/rtdeConfiguration.xml` 的接收配方补上
  `target_q` / `target_qd` / `target_qdd` / `target_TCP_pose` / `target_TCP_speed` 五个字段
  （74 → 79 个字段；UR 的上限是 96 个数据值，两个 `output_bit_registers*` 只算一个），
  并把 `RobotModel` 里对应的四个 `NotImplementedError` 桩（`TargetQ`/`TargetQD`/`TargetQDD`/
  `TargetTCPPose`/`TargetTCPSpeed`）改成真正读 RTDE 字段。
- 这比发 URScript 表达式再回读寄存器更可靠：零往返、不打断正在运行的程序、也不会因为
  表达式在旧固件上不存在而失败。

### 新增 — 工具端配置与遥测（4 个）

- `ur_set_tool_communication`：工具法兰串口（TCI / RS-485）开关，参数按手册
  `set_tool_communication(enabled, baud_rate, parity, stop_bits, rx_idle_chars, tx_idle_chars)`
  校验（波特率只允许手册列出的 8 档，parity 0-2，stop_bits 1-2，idle chars 按手册范围）。
  ⚠️ 工具描述里写明手册的警告：**启用 TCI 会禁用工具端模拟输入**。
- `ur_set_tool_output_mode`：工具输出模式 0 普通 / 1 power（双针供电）。
- `ur_set_payload_inertia`：一次性设置**质量 + 重心 + 惯性矩阵**（PolyScope 5.10 起的
  `set_target_payload`），按手册校验 Ixx/Iyy/Izz 非负、每个元素 |I| ≤ 133 kg·m²，
  并支持 `transition_time`。**只有在给出 `inertia` 时才使用 `set_target_payload`**；
  没给惯量时退回 `set_payload_mass` + `set_payload_cog`（CB3 3.x 上没有 `set_target_payload`，
  这样两条路径都能用）。工具描述里写明手册的提示：设置负载会**自动把力/力矩测量归零**，
  而 `set_payload(m, cog)` 会**重置**惯性矩阵（手册已将其标为 deprecated）。
- `ur_get_tool_telemetry`：工具输出电流/电压、I/O 电流（RTDE 字段，读取零代价）。
  手册里还有 `get_tool_temp()`，但当前配方没有对应 RTDE 字段，因此**不提供**该值，并在
  工具描述里说明原因，而不是编一个数出来。

### 修复 — 默认值与手册不符（`ur_movej` / `ur_movel`）

- **`ur_movel` 的默认速度是手册值的 4 倍**：旧代码 `movel` 默认 `a=1, v=1`，而手册
  （Poly5 15.30 / PolyScope X 15.29）是 `a=1.2, v=0.25`（250 mm/s）。对协作臂来说
  "没写速度"和"按 1 m/s 跑"是两件完全不同的事，现在改回手册默认值。
- **`ur_movej` 默认值同样不是手册值**（旧 `a=1, v=1`；手册是 `a=1.4, v=1.05`），一并改回。
- 工具描述里同时写明手册的另一条语义：**给了 `t` 就忽略 `a`/`v`**（手册原文 "Time setting has
  priority over speed and acceleration settings."），这是模型最容易搞错的一点。

### 修复 — `ur_movec` 缺少手册的 `mode` 参数

- 手册的 `movec(pose_via, pose_to, a, v, r, mode)`（Poly5 15.28）用 `mode` 选择姿态插补方式：
  `0` 从当前姿态插补到目标姿态，`1` 姿态相对圆弧**切线**保持不变（固定姿态圆弧）。
  旧实现根本不发这个参数，想做固定姿态圆弧只能绕开这个工具。现在补上并默认 0（与手册一致）。

### 新增 — OptiMove、Motion Version 与 freedrive 奇异点状态（`ur_move_optimized` / `ur_motion_version` / `ur_get_freedrive_status`）

- `ur_move_optimized` 暴露 `optimovej(goal, a=0.3, v=0.3, r=0)` / `optimovel(...)`
  （Poly5 15.32/15.33、PolyScope X 15.31/15.32）：目标与 `movej`/`movel` 相同，但用 **jerk 受限**
  的速度剖面，运动更平顺、振动更小。⚠️ 手册明确 `a`/`v` 是"**机器人能力的比例**"
  （`a, v ∈ (0, 1]`，1 = 该构型下能达到的最快），**不是 rad/s 或 m/s** —— 传 `a=1.4`
  （对 `movej` 完全合法的值）在这里就是越界，所以工具在本地校验范围并在描述里写明。
  手册支持的 `struct{pose, frame}` 与"世界模型对象名"两种 goal 形态**被明确拒绝**：
  它们需要 PolyScope 侧的坐标系/世界模型对象，脚本写错只会换来控制器一句运行期报错，
  不如在这里说清；`goal_type` 选择 `joints`（等价 optimovej）或 `pose`（等价 optimovel）。
- `ur_motion_version` 设置 **Motion Version**（手册第 14 章）与/或 **jerk 增益**
  （`jerk_gain_scaling_set`，0.01-1.0）：版本 2 在规划时把速度/加速度**钳到硬件上限**、
  交融半径重叠时**动态收缩**；版本 1 则会跳过整段运动并给 "Overlapping Blends" 警告。
  jerk 增益只作用于 **jerk 受限**的剖面 —— 版本 2 的 `movej`/`movel` 与 `optimovej`/`optimovel`，
  正是 `ur_move_optimized` 走的那条路。⚠️ 手册写明新机型与 PolyScope X **只支持版本 2**，
  CB3 没有这个设置。这两个设置**都没有回读通道**，工具只报告本次设置值（`readback_supported:
  false`），不假装读到了当前值。
- `ur_get_freedrive_status` 读取 `get_freedrive_status()`（PolyScope X 15.20）：当前姿态在
  freedrive 下离**奇异点**有多远 —— `0` 正常 / `1` 接近 / `2` 太接近（拖动阻力明显）。
  它**不是** freedrive 的开关状态位；手册的用意正在于"受限 freedrive 在奇异点附近可用性下降"，
  所以这个值用来建议操作员换一条路径。实现上经一个输出寄存器回读（默认 21 号 int 寄存器，
  旧值会被覆盖）；固件低于引入该函数的版本时，如实回报"没读到值"而不是编一个数。

### 修复 — `servoj` 的取值范围是 3.x 的旧值

- `t` 的默认值从 3.15.4 的 `0.008` 变成了 Poly5 15.44 / PolyScope X 15.43 的 `0.002`
  （手册推荐的"每个控制周期给一个新设定点"），`lookahead_time` 的下限也从 `0.03` 放宽到 `0.01`。
  工具保留 `0.008` 作为默认值（兼容 CB3），但现在**接受 `t ≥ 0.002`、`lookahead_time ≥ 0.01`**
  —— 照新手册传值的调用方不会再被一个过期的范围拦下。

### 修复 — `run-tests.mjs` 只认 `PYTHON` 不认 `UR_PYTHON`

- README 与 `test/selftest.test.mjs` 一直约定 `UR_PYTHON || PYTHON || 'python'`，而
  `scripts/run-tests.mjs` 的探针只读 `PYTHON` ⇒ `UR_PYTHON=... npm test` 会出现
  "探针说没有 Python、于是跳过全部 Python 用例，但被跳过的用例自己其实能跑"的矛盾结果。
  现在探针按 README 的约定取值。

### 工具链 / 文档

- 新增 `scripts/pdf-extract2.py`：**零依赖**（只用标准库）从三本手册 PDF 抽取文本。
  两个 PolyScope 手册的嵌入字体是**子集化的 CID Type0 字体**（`/Encoding /Identity-H`），
  PDF 里的字符码是 **glyph id**，必须走各自的 `ToUnicode` CMap 才能解出文字；3.15.4 则是普通的
  WinAnsi Type1 字体，字节即字符码。脚本两条路都走，并按基线/字距重建词间空格、剔除整页旋转的
  版权水印。抽取结果落在 `ScriptManual/txt/*.txt`（含页码分隔），是本版所有签名与默认值核对的依据。
- `docs/urscript-manual-analysis.md`：三本手册的函数签名、参数范围、版本差异（3.15.4 → Poly5 →
  PolyScope X 的新增 / 删除 / 改名 / 废弃）与安全限值事实，逐条带手册行号引用。
- 工具数门禁同步：`test/tool-schema-dsl.test.mjs` 与 `scripts/check-host-compat.mjs` 的
  `EXPECTED_TOOLS` 由 67 改为 83；README（中英）工具表、审批门禁清单、`67/67`→`83/83` 一并更新。

## [0.5.0] - 2026-09

> 本版是一次**以"还能不能信它"为主题的审计与加固**：一次代码审计发现并修掉了若干会让插件
> **永久卡死**、**回报假成功**、**读到别的命令的应答**的缺陷。工具数 53 → 67。

### 修复 — 会让插件永久卡死（最高优先级）

- **单次掉线会让整个 worker 永久死掉（`RealTimeClient.__sendPrg` 无界重试）**：上游的发送循环
  `while not stopRunningFlag and not programSend` **唯一出口是发送成功**。机器人掉线/断电时，
  `select.select([], [None], …)` 立刻抛 `TypeError` → 裸 `except` → `__connect()`（自身又循环
  60 s）→ **永不返回**。本插件是**单线程** worker（`for line in sys.stdin`），所以一次掉线就占死
  整条调用链：Node 侧 60 s 超时只让那**一个** promise 失败，进程还活着，此后**每一个**工具调用
  都会排队等到超时。现在发送有硬预算（`__sendTimeout`，默认 15 s），失败**如实**记入
  `lastSendFailure` 并逐层返回 `False`；同时 `lib/worker.js` 改为**超时即杀掉子进程**（并在下次
  调用时按 500 ms 退避拉起干净的 worker），因此调用方只需重试一次。
- **RTDE 接收线程会在 60 s 后"正常"退出，留下一个不再更新的连接**：`rtde.py` 的接收循环条件里
  混用了 `__reconnectTimeout`（那是"多久之内必须连上"的预算）当**运行期窗口**；到期后循环退出，
  退出前只发 PAUSE、**不关 socket** ⇒ `isRunning()` 依旧为 True（状态停在 PAUSED），数据却再也
  不更新。此后每次读取姿态都卡在 `dataEvent.wait()` 上。现在运行期用**独立的数据看门狗**
  （`__dataTimeout`，30 s 无任何 RTDE 包即重建会话），`__wait()` 带超时，`__receive()` 在 socket
  为 None 时直接返回而不是抛 `TypeError` 杀掉线程。**`dashboard.py` 有同族缺陷**：它的接收循环
  2 s 后退出且同样不关 socket，于是 2 s 之后每一条 dashboard 命令都会永久卡在 `wait_dbs()` 上，
  `wait_dbs()` 现在带超时（默认 2 s），循环只由 `__stop_event` 结束。
- **每次"读一次关节角"都可能永久自旋**：`urScript.sync()` 的
  `while RobotTimestamp() == initialRobotTime: sleep(0.001)` 与 `waitRobotIdleOrStopFlag()` 都没有
  出口。前者是所有 `get_actual_*` 的必经之路（默认 `wait=True`），后者被 `get_tool_digital_in` /
  `get_conveyor` 使用。两者现在都有超时并抛可读的 `TimeoutError`。
- **RTDE 线程在首次连接失败时当场死亡**：`rtde.py` 的 `__connect()` 在 `except` 里写的是
  `self.sock` —— 一个**不存在的属性**，于是失败时抛 `AttributeError` 冲出 `run()`：既看不到真实
  的 socket 错误，也不会像设计那样重试 60 s，`isRunning()` 永远为 False。改为 `self.__sock`
  （并加 try/except 关闭）。
- **`Dashboard.wait_dbs()` 无参无限等待**：现在必须带超时；`Dashboard.__send()` 也改为带超时等待
  应答。
- **`onLine` 静默丢弃**：`lib/worker.js` 现在统计无法解析的行与未知 id 的响应（`stats()`），
  并把这些线索保留下来——以前它们被完全吞掉，表现为"莫名其妙的超时"。
- **优雅关闭曾经完全没生效**：新增的"关闭控制器"工具与 host 的优雅关闭**撞了 op 名**
  （都是 `shutdown`），于是后者被解析成前者：既报 `KeyError: 'ip'`，又永远不会真的退出 worker。
  现在 host 用 `shutdown_worker`，并新增**跨语言契约测试**（host 的每个 op 必须在 Python
  `HANDLERS` 里存在、op 名不得与 dashboard 命令撞名）。这个缺陷是 `selftest.test.mjs` 端到端
  用例抓到的。

### 修复 — 回报了假成功 / 读到了错的东西

- **`ur_movec` 发的不是圆弧运动**：`UrScript.movec()` 内部把 `movetype` 写死成 `'p'`
  （`_move(movetype='p', …)`），`if movetype == 'c'` 分支永远不成立 ⇒ **`pose_via` 被完全丢弃、
  实际发出去的是 `movep`**（直线/交融运动），而工具回报的却是 `movec(p…, p…)`。即使把 movetype
  改成 `'c'`，那个分支拼出来的也是未替换的模板字面量。现在与 `op_draw_circle` 一样**自己拼原始
  URScript**。（已用真实 vendored 模块执行验证：旧路径确实产出 `movep(...)`。）
- **"移动到位"的判定不是朝向度量**：`_right_pose_tcp` 逐分量比较轴角表示的三个姿态分量，
  于是 `[0,0,2π]` 与 `[0,0,0]`（**同一姿态**）被判成相差 6.28，报出"移动结束但未到达目标"；
  而 `[0.05,0,0]` 与 `[0,0,0.05]`（**不同姿态**）却被判为到位。现在用夹角判据
  `θ = acos((tr(Rₐᵀ R_b) − 1)/2)`（0.05 rad 容差），位置仍用 10 mm 线性容差。
- **四个绘图操作无条件回报"执行完成"**：`_wait_robot_idle()` 在 `SendProgram()` 之后**立刻**问一次
  "在跑吗" —— 而 `SendProgram` 只是把字节写进 socket 就返回（真正的执行由控制器稍后开始），
  所以第一次探测几乎必然看到"没在运行"，于是无论脚本是否真的被执行都回报
  `ok: true`「执行完成」。现在必须**先观察到"确实在运行"**才接受"已空闲"，否则如实报告
  "未观察到脚本开始执行（控制器很可能根本没执行这段 URScript）"。
- **确认轮询读到的是上一条 dashboard 命令的应答**：`Dashboard.__send()` 只等"任意一次 notify"，
  **不校验应答属于哪条命令**，而 `last_respond` 只在真正收到消息时才被覆盖。最典型的事故：
  上一条 `isProgramSaved` 刚回过 "True"，紧接着问 `is in remote control`，于是一台**没在远程
  控制模式**的机器人被报成 `remote_control: true`，模型据此下发 URScript 并被控制器**静默丢弃**，
  而工具全程回报成功。新增 `Dashboard.sendCommand(cmd)`（先清空 `last_respond`，只认本次新到达的
  应答），worker 里所有 dashboard 读取统一经 `_dashboard_send()` / `_dashboard_cmd()`。
- **`ur_set_tool_voltage` 从来没有成功过**：它调用 `UrScript.set_tool_voltage()` —— 一个
  `NotImplementedError` 桩，因此**每一次**调用都必然抛异常并回报 `ok:false`。现在直接发
  `set_tool_voltage(N)` 的 URScript，并校验取值只能是 0/12/24。
- **`ur_set_analog_out` 的量纲错了**：URScript 的 `set_analog_out(n, f)` 收的是**相对电平
  f∈[0,1]**，而工具说明写的是"0-10 或 0-20"。旧实现把调用方的数字**原样**发过去 ⇒ `value=5`
  被当成 f=5 ⇒ 端口输出**满量程**（约 10 V），且完全不校验范围。现在接受工程单位（`full_scale`
  可指定 20 表示电流域），换算成 [0,1] 后发送并回读，返回值同时给出 `value` / `fraction` /
  `read_back`。
- **可配置数字输入的位掩码偏移了 8 位**：`RobotModel.ConfigurableInputBits(n)` 算的是
  `pow(2, n + 8)`，而 `actual_digital_input_bits` 的位分配是 0-7 标准 DI、8-15 可配置 DI、
  16-17 tool DI ⇒ `ur_get_digital_in(which="config", n=8)` 读到的其实是 **tool DI 0**，n=9 是
  **tool DI 1**，n≥10 永远为 False。输出侧（`ConfigurableOutputBits`）有同样的偏移。
  注意本插件自己的批量读取 `_bit_masks` 一直是对的，所以同一台机器人上两个工具会给出**互相矛盾**
  的结果。现在两处都按 `n - 8` 计算。
- **`RobotStatus()` / `SafetyStatus()` 在 RTDE 未就绪时抛 `TypeError`**：`1 & None` 会炸
  （`&` 比 `==` 结合得紧），而这个异常会从 `RealTimeClient.__waitForProgram2Finish` 里抛出并
  **杀死那个守护线程**，留下 `rtcProgramRunning = True` 永不复位，使
  `waitRobotIdleOrStopFlag()` 永久自旋。现在字段缺失时返回**全 False**（"状态未知"）。
- **`ActualJointVoltage()` 返回的是关节电流**：名字是电压，读的却是 `actual_current`（安培）。
  真正的 `actual_joint_voltage` 就在 RTDE 配方里却没有访问器。已修正，并补齐 `ActualCurrent()` /
  `ActualQD()` / `SpeedScaling()` / `StandardAnalogOutput(n)` 等一直接口齐全、数据也一直在 500 Hz
  流里、但上游是桩函数的访问器。
- **`ur_run_program` / `ur_stop_program` / `ur_pause_program` 不看应答**：dashboard 的
  "could not understand / not allowed / failed" 一类应答以前被当作成功；现在只回报"已下发"，
  并**同时给出运行状态**（`running`），让调用方有依据判断。
- **`ur_status` 里的 dashboard 字段可能整片陈旧**：现在每个字段都走"只认本次应答"的读取，
  读不到时明确标记 `<查询失败>` 而不是把旧值当成现值。
- **NaN / Infinity 曾经能一路走到控制器**：JSON 允许 `NaN`，`float("nan")` 也通得过所有校验，
  于是 `movel(p[nan,…])` 会被发出去；而在**返回**路径上，Python 默认把非有限值写成 `NaN` ——
  那不是合法 JSON，Node 的 `JSON.parse` 抛错后 `_onLine` 会**静默丢弃**那一行，调用方只看到
  一句笼统的 "timed out"。现在所有数值入口都拒绝非有限值，`respond()` 用 `allow_nan=False`
  大声失败。

### 新增 — UR 能力（14 个工具，53 → 67）

- **自由驱动 / 示教模式**：`ur_set_freedrive`、`ur_set_teach_mode`（可手动拖动机械臂；退出方式
  说明写在工具描述里）。实现走"永不退出的 URScript 程序"，正是 `freedrive_mode()` 语义所需，
  也避免 URBasic 包装函数在单线程 worker 里阻塞。
- **电源与刹车**：`ur_power_on`、`ur_power_off`、`ur_brake_release`，以及 `ur_shutdown`（关闭
  控制器）。全部带 ⚠️ 说明其物理后果（失去刚性、可能在重力下掉落）。
- **只解保护性停止**：`ur_unlock_protective_stop` —— 与 `ur_reset_error` 的区别是**不做上电、
  不释放刹车**（后者会顺带让机械臂动起来）；解除后会重新读取安全状态位一并返回。
- **实时遥测**：`ur_get_runtime_telemetry` 一次给出关节电流/电压/角速度、TCP 线速度与受力/力矩、
  工具加速度计、速度倍率、整机电压电流、关节温度。**这些字段本来就在 500 Hz 的 RTDE 数据流里**
  （见 `URBasic/rtdeConfiguration.xml`），读取零代价、不需要改配置，只是以前没有任何工具暴露它们。
  另有 `ur_get_speed_scaling`、`ur_get_tcp_force` 两个聚焦工具。
- **安装与 I/O 配置**：`ur_set_gravity`（非水平安装时的重力方向，含归一化与零向量拒绝）、
  `ur_zero_ftsensor`（力/力矩传感器归零）、`ur_get_tool_analog_in`（工具端模拟输入；函数名已对照
  仓库内官方脚本手册确认存在，但**参数语义未经真机验证**，读不到时说明可能原因并可换回读寄存器重试）。
- **传送带跟踪**：`ur_set_conveyor_tracking`（`linear` / `circular` / `stop`），此前只有 tick 计数
  的读写。

### 新增 — 数字孪生（面板与路由）

- **失败原因终于可见**：host 的失败响应新增机器可读的 `code`
  （`no_robot` / `robot_not_connected` / `ambiguous_robot` / `worker_unavailable` / `robot_error`），
  并回显本次解析到的 `ip`、歧义时的候选 `ips` 列表。此前客户端只渲染一句固定的「未连接机器人」，
  于是"worker 进程挂了"、"还没连过机器人"、"两台机器人有歧义"在界面上长得一模一样（而且歧义那种
  情况还会永远白轮询下去）。客户端现在把它们翻译成不同的人话与处置建议。
- **`detail=1` 慢通道**：附带 dashboard 侧的状态（安全模式、机器人模式、程序状态、运行状态、
  速度倍率、关节温度/电流等）。位姿通道仍以 10 Hz 独立轮询，detail 查询失败**不影响**位姿通道。
- **`/dsh-nonead-ur/twin/models` 模型清单**：列出本地真实存在的 GLB，让"机器人报了一个我们没有
  资产的型号"不再表现为静默回退。
- **资产缓存**：GLB 响应带内容哈希强 `ETag` + `immutable`，并支持 `If-None-Match` → 304。
  关闭面板会释放模型句柄，而以前没有任何校验器 ⇒ **每次展开面板都要重新下载并解析 1.5–3.5 MB**。
- **状态响应禁止缓存**（`Cache-Control: no-store`，客户端 `fetch(..., {cache:'no-store'})`）：
  缓存的位姿比没有位姿更糟。
- **模型名按 IP 记忆**：孪生的 10 Hz 轮询以前**每次都**去问一遍机器人型号（一次 Dashboard 往返），
  而型号在连接存续期间不可能变。现在 host 侧缓存，重连时失效。

### 修复 — 数字孪生客户端

- **每次展开面板泄漏一个 WebGL 上下文**：three 的 `renderer.dispose()` **不释放上下文**
  （只丢内部缓存并摘掉自己装的 context-lost 监听），而面板每次挂载都新建 canvas + renderer。
  浏览器上限约 16 个，反复展开/收起后会开始回收最老的 ⇒ 孪生面板或其它 WebGL 视图（例如任务看板）
  变黑。现在 `dispose()` 调 `renderer.forceContextLoss()`；同时释放从未被释放的 `GridHelper`
  几何体/材质，并监听 `webglcontextlost` / `webglcontextrestored` 以如实提示 GPU 重置。
- **HiDPI 屏上画面发虚**：从未调用 `setPixelRatio`（three 默认 1）。现在按 `devicePixelRatio`
  设置（上限 2）。另外新增 `ResizeObserver`：侧栏是用户可拖动改宽的，而 `window.resize` 不会因此
  触发，以前画布会被 CSS 拉伸到下次窗口变化为止。
- **画布尺寸量到 0×0 后永不重试**：面板刚展开时 flex 高度可能还没算出来，旧实现直接跳过并**不再**
  重试，于是那次之后画布一直用默认后备缓冲被 CSS 拉伸。现在记为待处理并逐帧重试。
- **WebGL 不可用时是"永久假加载 + 未处理异常"**：`new WebGLRenderer` 的异常发生在任何 try/catch
  之外，既变成未处理的 promise rejection，又让状态行永远停在「正在加载模型…」而画布空白。现在
  降级为**纯数值模式**（关节角与 TCP 仍更新）并说明原因。
- **轨迹缓冲被重复样本灌满**：`pushTrajectorySample()` 原本**每帧**都跑（60 fps），而采样只有
  10 Hz ⇒ 同一个 `ts` 被重复压入约 6 次，600 点的容量实际只装下约 100 个真样本（≈10 s 而不是
  文档里说的 60 s），且每帧重建约 600 个数组。现在只在新采样时入队，并加了回归测试。
- **数值面板给的是插值中间态**：关节行显示的是为网格平滑而算出的插值值，而 TCP 行用的是原始样本
  ⇒ 两行的时间基准不同（最多相差一个采样周期 + 渲染滞后）。现在两行都用**测量样本**（插值只服务
  于网格观感），并给出行内 `title` 以便读到被省略号截断的 J5/J6。
- **TCP 姿态被按 RPY 误导**：`rx/ry/rz` 是 UR 的**轴角旋转向量**（方向=旋转轴、模长=旋转角，弧度），
  不是 roll/pitch/yaw。HUD 现在明确标注 `TCP(米/轴角弧度)`。
- **状态行不随失败原因变化**：一直未连接时 `applyConnection` 直接 return，于是 host 的原因变了
  （例如从"还没连过"变成"worker 挂了"）界面也不更新。
- **在飞的取数无法取消**：`stop()` 只清定时器，已发出的请求仍会跑完（最长可拖到命令超时）。
  现在用 `AbortController` 取消，并区分"我们主动取消"（不写错误快照）与真实故障。

### 新增 — 工程质量

- **`npm test` 现在真的跑全部测试**（以前只跑一次 worker ping，仓库里另外 20 多个
  `*.test.mjs` —— 客户端轮询状态机、FK、模型契约、孪生路由、vendored 库缺陷 —— **一个都没跑**，
  所以"npm test 绿了"完全不能说明插件是好的）。新增 `scripts/run-tests.mjs` 枚举并逐个执行
  21 个测试文件，汇总成败；`test/selftest.mjs` 升级为真正的 `test/selftest.test.mjs`
  （端到端协议自检，含优雅关闭用例——**正是它抓到了上面那个 op 撞名缺陷**）。
- **`test/vendored-fixes.test.mjs` + `test/ur-python-harness.py`**：把本版修掉的 vendored 缺陷
  逐条钉成**行为**门禁（不是"源码里有没有那段代码"）。探针刻意用**真实的回环 socket** 而不是假
  对象：`__sendPrg` 内部要过 `select.select`，而 select 只接受真 fd —— 假对象会直接抛
  "argument must be an int"，反而绕过了被测路径。
- **`test/tool-schema-dsl.test.mjs` 增加跨语言契约**：host 侧的每个 op 必须在 Python `HANDLERS`
  里真实存在；op 名不得与 dashboard 命令撞名；同一 op 不得被多个工具使用；工具名不得重复。
- **删除死代码**：`src/client/sidebar-entry.js` 与 `src/client/thumbnail.js` 早已不被构建图引用
  （CHANGELOG 0.4.1 就写了"已删除"，但文件与它们的测试还在，让覆盖率看起来比实际好）。
- **`scripts/build-client.mjs` 改为优先使用独立 esbuild 二进制**：JS API 会在启动时校验
  JS 包与平台二进制**版本一致**，而本仓库 `node_modules` 里两者不同步（JS 0.25.12 / 二进制
  0.25.0）⇒ `Cannot start service`，构建直接失败。独立二进制不需要版本配对，banner/footer 用
  内联文本传入（CLI 的 `--banner:js=` 收的是文本，不是文件路径），JS API 仍作为回退。
- **`scripts/check-host-compat.mjs` 优先探测真实的 DSH 安装目录**：本仓库自己的
  `node_modules` 里也有（devDependency 带进来的）旧版 `@deepseek-ai/dsh-tools`，用它去校验 DSL
  与 peer 版本会得到误导性结论。现在命中真实安装时，**67/67 个工具通过宿主真实 DSL**。
  期望值（工具数、路由数）一并更新为 67 / 3。

### 变更

- **有物理后果的新工具全部纳入人工审批**：`set_freedrive` / `set_teach_mode` / `power_on` /
  `power_off` / `brake_release` / `unlock_protective_stop` / `shutdown` / `zero_ftsensor` /
  `conveyor_tracking` —— 它们都能让机械臂脱离程序控制或失去刚性支撑。
- **所有长耗时操作的预算留出余量**（`_budget_ms`）：Node 侧的超时计时从写入请求就开始了，两者
  相等时调用方只会看到 Node 那句笼统的 "timed out"，看不到 worker 更具体的原因。
- **发送失败不再算成功**：`op_send_script` / 四个绘图操作 / 数字与模拟输出 / `set_tcp` /
  `set_payload` 等现在都检查"脚本是否真的送出去了"，失败回报 `SEND_FAILED` 并附原因。
- **`_CappedLog` 线程安全**：RTDE / Dashboard / RealTime 的接收线程都会直接 print，而一次
  `_roll()` 可能正好在另一个线程的 `write()` 中间关掉句柄 ⇒ 那个线程抛 `ValueError` 当场死亡
  （RTDE 线程一死，`isRunning()` 就永远为 False）。
- **未处理异常的完整栈写入日志**：`traceback.format_exc(limit=1)` 只留最后一帧，库里抛出的
  `AttributeError` 因此丢掉全部上下文；协议行改为一句可读摘要 + 稳定错误码。

### 已知事项（如实标注）

- **工具端 I/O 与模拟输出回读用了手册里不存在的函数名（静默失效，不是少个功能）**：仓库内有 UR 官方
  脚本手册（`ScriptManual/script_directory_Poly5.pdf`、`..._PolyscopeX.pdf`），逐一核对后发现 vendored
  代码里有**三个名字在手册中根本不存在**：
  - `get_tool_digital_in()` 发的是 `write_output_int_register(0, read_tool_digital_in(n))` ——
    两个名字都不存在（手册里是 `write_output_integer_register` 与 `get_tool_digital_in`）。
    控制器会拒收整段脚本，而函数随后**回读寄存器 0 的陈旧值并把它当成输入电平报出去**。
  - `set_tool_digital_out()` 发的是 `write_tool_digital_out(n, value)` —— 手册里是
    `set_tool_digital_out(n, b)`。后果是**数字输出从来没被设置过，工具却回报成功**。
  - `get_standard_analog_out()` 读的是 `RobotModel.StandardAnalogOutput0` / `...1` ——
    **这两个属性都不存在**，必然抛 `AttributeError`；而且 `n == 1` 分支把 `return` 写在了
    `if wait:` 里面，`wait=False` 时返回 `None`。
  三处全部改为手册中的真名。顺带发现 `get_tool_digital_out` 在手册里确实存在，因此"工具数字输出无法
  回读"这个结论不成立，已实现回读。
- `scripts/twin-contiguity-check.py`（原仓库根目录的 `.twin-contiguity-check.py`）的链式乘法顺序错了：
  它把 DH 段矩阵写成 `R·Trans`，而真实渲染（`src/client/robot/fk.js` 的 `poseToMatrix4()` =
  URDF `<origin>` 语义）是 **`Trans·R`**。两者在 `links[4]`/`links[5]`（rpy 与 xyz 同时非零）上
  相差约 **0.18 m** —— 也就是说这个脚本报出的 PASS/FAIL 与客户端实际画面无关。已改为 `Trans·R`
  并移入 `scripts/`（仓库根目录的隐藏脚本容易被误认为项目配置）。
- `python/sitecustomize.py` 是**本机私货**（写死了本机 Python 用户级 site-packages 路径），
  它之所以能生效是因为 `lib/worker.js` 把 `PYTHONPATH` 指向插件的 `python/` 目录，而 CPython 启动
  时会 import 该目录下的 `sitecustomize`。**换一台机器、或安装发布版（该文件不在 `files` 清单里）
  之后，`import numpy` 会失败，所有工具调用都会死。** 正确做法是给 worker 用的解释器装好依赖
  （`pip install -r requirements.txt`）或用 `pythonBin` 指向一个 venv；`ur_ping` /
  `--selfcheck` 是这条链路的自检入口。本版**未删除**该文件（它属于使用者的本地环境），
  但已在此明确记录。
- `ur_get_tool_analog_in` 与 `conveyor_tracking`（脚本函数名与参数语义）**未经真机验证**：
  函数名已对照仓库内官方手册确认存在，但**参数语义与真机行为**未在 URSim/真机上跑过。
  两者在读不到/失败时都会**如实报失败**并列出可能原因，而不是返回陈旧值或假装成功。
  请在 URSim 或真机上先验证再用于生产。
- `assets/kinematics.json` 中 `ur3`/`ur3e` 的 `jointLimits[5]` 为 `null`，因此这两个型号暂时做不了
  J6 限位提示（需要新的数据来源）。

## [0.4.1] - 2026-09

### 变更
- **删除不再装配的左栏/中栏模块**：`sidebar-entry.js`（左栏入口行 + 中栏大视图 + `dsh-panel-activate` 协议）与 `thumbnail.js`（缩略 3D）随「只在右栏呈现」一并删除；仍在用的变更自愈 hub 独立为 `mutation-hub.js`（行为未变，全局单例语义保持）。
- **数字孪生的呈现位置迁到右侧栏**：入口改为右侧栏「开始」面板里的一张卡片，位于「工作区文件 / 新建终端 / 浏览器」三张卡片下面；点击后在右侧栏内显示 3D 视图。原先的左栏入口行与缩略视图、覆盖中栏的大视图不再使用。

### 修复
- **`ur_send_script` 的执行校验会假报成功（比不校验更糟：它伪造证据）**：第一版把哨兵拼在**顶层**（`<起> + 脚本 + <止>`）。真机实测：`def dance(): … end` + 顶层调用这种脚本被拼上顶层哨兵后，会变成「**函数体一句都不跑、顶层语句照跑**」的形态——DO3 从不置位，而两行哨兵都回读成功，工具报出「已执行完毕 0.0 s」。现在**含 `def` 的脚本一律把哨兵注入函数体内部**（第一句 / 最后一句，块用深度计数配对，函数体里嵌套的 if/while 不会认错 `end`），**绝不拼顶层**；多个函数又看不出顶层调用哪个时**拒绝校验**（脚本原样发送，`verified: null`，并说明原因）。纯语句脚本（插件自身 movej/movel 的形态）才用顶层注入——那种形态下顶层语句本来就会执行。返回值新增 `injection`（`mode` / `function` / 行号）以便复核注入位置。回归测试用假控制器复现"只跑顶层、不跑函数体"的语义，并对照出旧形状必然假阳性。
- **`ur_send_script` 会谎报成功**：`RealTimeClient.SendProgram()` 是单向的（控制器既不给 ACK，也不回传 URScript 运行期错误），原实现只回一句「脚本程序已发送，请确认执行结果」——模型据此以为动作生效了，而真机上完全可能**一行都没执行**（本地/示教器模式下 URScript 会被设计性地静默丢弃，或脚本在控制器侧报错中止；实测就是这样：位置一动不动，工具却报"已发送"）。现在会在脚本前后各注入一行 `write_output_integer_register(N, token)` 并回读该寄存器，结论分三种：**跑完** / **开始跑了但没跑到末尾** / **连起始哨兵都没出现（≈控制器根本没执行，并点明最常见原因）**。`verified` 为 `true`/`false`；`verify=false` 时为 `null`——那表示"未确认"，不等于成功。默认用 23 号 int 输出寄存器当哨兵（可用 `register` 参数改，注意其旧值会被覆盖）。
- **`remote_control` 探测三态化**：原实现把"没问到"与"问到了，是 false"折叠成同一个 `false`，于是工具会对着状态未知的机器人给出「请去 PolyScope 开启 Remote Control」——那是**基于未知信息的断言**。现在 `_remote_control()` 返回 `True` / `False` / `None`（未知）：`ur_connect` 只在明确 false 时才提这件事（CB3 3.1–3.20 区间说明"设置在默认已启用、但当前不在远程模式时指令仍会被丢弃"），未知时如实说未知；`ur_status` 额外给出 `remote_control_raw` 便于诊断。
- **清掉配方里已失效的输入段**：`rtdeConfiguration.xml` 现在只声明 `receive`（接收配方），`<send>` 段整段删除——写操作全走 URScript，不需要认领输入变量；而上游重连分支**每次重连**都会调 `__setupInput()`，留着非空输入配方会把这个「参数已被认领」的拒绝打成循环（该拒绝会从 `__decodePayload` 冒出来打崩整个 worker）。空配方下它只是一个空请求。
- **连上机器人却黑屏（孪生拿不到 model/q/tcp）**：`lib/twin-routes.js` 按**单层**读 op 结果（`jp.joint_positions`），而真实信封是两层——协议响应是 `{id, ok, data:<op 返回值>}`，每个 op 自己又返回 `{message, data:{…}}`（`ur_worker.py` 的 `ok()` **原样**返回传入的 dict），而 `UrWorker.call()` resolve 的是响应里的 `data` ⇒ 真正的载荷在**再下一层** `.data`。于是 `model`/`q`/`tcp` 恒为空：无论机器人是否连上，孪生面板都只有黑屏，姿态自然也无从同步。路由已改为读 `.data`；`test/twin-routes.test.mjs` 的假 worker 同步改成**真实信封形状**（它此前造的是扁平对象，所以这个缺陷长期全绿），并新增一条反向守卫（扁平返回值不得被当成数据）。
- **worker 日志无限增长 + RTDE 重连紧凑循环**：`rtde.py` 的重连失败分支每次循环都打印且**不 sleep**，断链时等于每秒数万行；实测本机 `python/ur_worker.log` 被推到 **277 MB / 1076 万行**（其中 `RTDE reconnection failed!` 独占 1076 万行）并空转烧 CPU。现在该分支限速到**每 5 s 一行**并 `time.sleep(0.5)`；`ur_worker.py` 再加一道与写入者无关的硬上限：日志超过 8 MB 即滚成 `ur_worker.log.1`（只保留一代 ⇒ 磁盘占用钳在 ~2×上限）。**同一族缺陷还有第二处**：`dashboard.py` 的 `DashboardClient.__send` 在 socket 已死时 `select.select` 会立刻抛，而 except 里无条件 `print("Could not send program!")` —— 实测**同一个会话刷出 296,644 行**并把日志顶到 8 MB 上限、持续空转烧 CPU；已同样改为每 5 s 一行 + `time.sleep(0.2)`。另外，正因为插件配方的输入侧为空，这个**每次重连都会走到 `__setupInput()`** 的分支才不会反复认领输入变量（否则会踩上游那个「参数已被认领」的崩溃）。
- **世界坐标系与基座坐标系对齐**：`GridHelper` 默认躺在 XZ 面（three.js 习惯的 Y 向上，法线 +Y），而机器人的连杆姿态是 FK 直接算出的**基座系**坐标（基座平面是 XY 面、Z 向上）——两者平面不同、三条轴也不重合，表现为「网格像一堵竖墙、基座从网格里穿出来」。现在网格绕 X 轴转 +90° 落在 **XY 面（z=0）**、`camera.up` 设为 **+Z**，于是**基座平面与网格平面重合、基座 X/Y/Z 与世界 X/Y/Z 重合**（`scene.js` 的 `createBaseGrid()`）。
- **CB3 不再被误导去开启 Remote Control**：`ur_connect` 原先只要 dashboard 报 `false` 就提示「未处于远程控制模式，部分运动指令可能无法执行」。但 **URSoftware 3.1–3.20 的 CB3 机器人默认就允许远程控制、无需任何设置**，那条提示对这一档固件是错误指引。现在按 `polyscopeVersion` 分档：落在该区间就说明「设置在默认已启用（无需在设置里开启）」，**并指出 dashboard 报 false 时控制器当前不在远程模式、指令仍会被静默丢弃**；其他固件（e-Series 或区间外的 CB3）才提示去 PolyScope 开启。（措辞随后又按真机观察校准过：见上文三态化那条。）
- **连接构造卡死不再需要人工重启**：`UrScriptExt(...)` 的构造会等 RTDE 数据就绪（`urScript.py` 里 20×1 s），再叠加 rtde / realTimeClient 各自最长 60 s 的重连循环；一旦控制器侧还占着上一次未回收的 RTDE 会话（控制器同时只接受一个客户端），构造就可能几十秒不返回、后续每次调用都跟着卡住。现在 `ur_worker.py` 的 `_connect_or_exit()` 给构造一个硬预算（`CONNECT_TIMEOUT_S = 20 s`，且不超过本次请求的 `_timeout_ms`），超预算就写回一条说明原因的错误并 `os._exit(1)` —— 只有进程退出能可靠释放那些半成品套接字。`lib/worker.js` 已有的行为接管后半程：退出即失败在飞请求，**下次调用**按 500 ms 退避拉起干净进程，调用方重试一次即可。
- **发布包不再夹带 `python/sitecustomize.py`**：该文件是某台机器上的解释器垫片（硬编码本机路径），插件自己的 `files` 已刻意不含它，但两版桌面打包是整目录收 `python/**`。两版 electron-builder 的 `files` 现在显式排除它。
- **数字孪生的关节位置全错**（真机 UR3 上肉眼可见：连杆散开、不在关节上）：`loader.js` 的 `assemble()` 把 7 个装配组串成父子链，而 `applyFK()` 往每个组的**局部** `matrix` 写的是「基座 → 该连杆」的**绝对**变换 ⇒ three.js 的 `matrixWorld` 把父链连乘，肩部之后的每个连杆都被重复施加了前人变换。每个网格的几何本来就写在**它自己的连杆坐标系**里（Ruling 37 已把官方 `ur_macro.xacro` 的 visual origin 烘进网格），所以 6 个连杆组现在都是运动根（单位矩阵）的**直接子节点**。实测 14 个型号 × 3 个姿态下相邻连杆最大间隙 0–1.3 mm（阈值 40–108 mm）。
- **`rtde.py` 的 `self.hasattr` 笔误**：`setData()` 的列表分支写成 `self.hasattr(self.__rtde_input_config.names, ...)`——`RTDE` 没有这个方法，且对列表来说 `hasattr` 也不成立。已改为与标量分支同语义的 `variable_name[ii] in self.__rtde_input_config.names`。
- **所有 RTDE 写操作都会崩**（`ur_set_digital_out` 等在真机上直接抛 `AttributeError: 'NoneType' object has no attribute 'names'`）：根因是插件此前经 `RTDE.setData()` 写输出，而这条路要求先向控制器**认领 RTDE 输入变量**——`rtde.py` 的 `__setupInput()` 是**被注释掉的上游代码**，从不发 SETUP_INPUTS，`__rtde_input_config` 因此恒为 None。**修法是让写操作改走 URScript**（`RealTimeClient.Send("set_standard_digital_out(...)")` 等，与 tool / analog / payload / TCP 的既有做法一致），从此不需要任何 RTDE 输入认领。之所以必须避开输入认领：UR 控制器会拒绝为已认领的变量再发 SETUP_INPUTS（`An input parameter is already in use.`），该异常会从 `__decodePayload` 冒到 RTDE 线程里**打崩整个 worker**，之后除非控制器释放认领，会话无法重建。（曾试过「补输入配方 + 放开 `__setupInput()`」，已被这条更干净的路径取代。）
- **插件自带的 RTDE 配方只服务接收侧、输入侧故意留空**：`python/URBasic/rtdeConfiguration.xml`（`rtde.py` 优先解析它，vendored Default 仅作回退）保留 int/double 寄存器 0..23 并启用 `output_bit_registers32_to_63`；`<send>` 段**零字段**，确保任何 SETUP_INPUTS（含上游重连分支里那次调用）都不会认领输入变量。
- **`ur_get_bit_register` 读 32–63 恒为 null**：接收配方只启用了 `output_bit_registers0_to_31`，而 `RobotModel.OutputBitRegister()` 仅在该字段存在时才填充 32–63。新配方已启用 `output_bit_registers32_to_63`。
- **`ur_set_digital_out` 的 `which="config"` 在 8–15 端口抛 `struct.error`**：URBasic 内部按 0–7 给 8 路 configurable 输出编号（掩码算的是 `2 ** n`），而工具沿用 UR 的全局 I/O 编号 8–15，`n = 8` 会算出 256（`'B' format requires 0 <= number <= 255`）。现在换算成 URBasic 的编号再调用。
- **`ur_list_programs` 拿不到结果**：局部变量 `err` 遮蔽了模块级 `err()` 辅助函数，出错分支等于把一个字符串当函数调用。
- **客户端半此前完全无法激活**：`resolveRobotIp()` 曾读取 `ctx.config` / `ctx.options`，而 cordis 的上下文代理对未通过 `inject` 声明的属性读取会抛 `cannot get property "config" without inject`。该读取发生在 `apply()` 的 `try` 之外，导致该 entry 的 fiber 落为 FAILED、渲染侧只报「1 plugin(s) 未激活」且不给原因。配置现取自 `apply(ctx, config)` 的第二实参。

## [0.4.0] - 2026-09

### 修复
- **注册结果如实上报**：`apply()` 现在统计 `ctx.tools.register` 的实际成功数，并把每个失败工具连同原因列出，不再打印硬编码的工具总数——部分注册失败再也无法在日志里显得“正常”。全部失败时会区分三种原因：worker 初始化失败、宿主未组合 `tools` 服务、宿主 `ctx.tools.register` API 已变更。
- **peer 范围接受当前内核**：`@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-tools` 声明为 `^0.1.2-rc.1 || ^0.1.7-rc.2`。原 `^0.1.2-rc.1` 不匹配 `0.1.7-rc.2`（预发布范围只匹配自身版本三元组），严格 peer 校验会拒绝本插件实际适配的内核。

### 新增
- **`scripts/check-host-compat.mjs`**：一条命令完成对已安装宿主的兼容自检——peer 范围、全部工具参数 schema 过一遍宿主**真实**的 value-schema DSL、`dsh.client` 声明、以及客户端 bundle 的注册 id。升级所适配的内核族后应重跑。
- **只读 3D 数字孪生**：侧边栏缩略视图 + 中栏大视图（three.js 渲染），两者共用同一份轮询状态源，实时同步机器人的关节姿态、工具（TCP）坐标系与近期运动轨迹。数字孪生严格只读，绝不下发任何机器人指令。
- **host 只读孪生路由**：`/dsh-nonead-ur/twin/state` 与 `/dsh-nonead-ur/twin/asset`，均限定 loopback（`localhost` / `[::1]` / `127.0.0.0/8`）调用方。
- **随包分发机器人网格**：14 款 UR 官方视觉网格转换为 `assets/models/*.glb`（约 35 MB）随包分发，并附 `assets/kinematics.json`；许可划分见 `THIRD_PARTY_NOTICES.md`（9 款 BSD-3-Clause、5 款 UR Graphical Documentation）。`assets` 已列入发布 `files`，并新增 `verify:models` 脚本校验 GLB 结构契约。
- **`three` 作为构建期依赖**（`devDependencies`），供 `scripts/build-client.mjs` 构建客户端 bundle。

## [0.3.9] - 2026-09

### 修复
- **16 个工具在 DSH 1.5.3 下消失**：工具参数 schema 使用了 JSON-Schema 的数值约束（`minimum` / `maximum` / `exclusiveMinimum`），而值 schema DSL 不再接受这些关键字，导致受影响工具**整个注册失败**；且收尾那行打印的是硬编码的 `已注册 49 个`，失败是静默的。在仍拒绝这些关键字的宿主上重新实测：仅 **33/49** 个工具注册成功、**16** 个注册失败（`ur_movej`、`ur_movel`、`ur_movep`、`ur_movec`、`ur_servoj`、`ur_draw_*` 以及寄存器 / I/O 类工具）。现约束已移除，范围写进工具 description，权威校验在 `python/ur_worker.py`（`_nonneg_float` / `_bounded_int` / `_bounded_float`）。

### 新增
- **`test/tool-schema-dsl.test.mjs`**：驱动真实的 `apply()`、捕获真实注册的工具定义，逐条校验参数 schema 是否落在值 schema DSL 词表内，并断言 49 个工具全部注册；测试自带自检，证明它并非空转。

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

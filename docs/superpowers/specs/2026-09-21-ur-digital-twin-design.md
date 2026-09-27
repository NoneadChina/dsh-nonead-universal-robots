# UR 机械臂 3D 数字孪生（侧边栏）— 设计文档

- 日期：2026-09-21
- 项目：`dsh-nonead-universal-robots`
- 状态：设计已确认，待转实现计划

---

## 1. 背景与目标

在 DSH Web GUI 的侧边栏加入 UR 机械臂 3D 模型，作为实体机器人的**数字孪生**：操作实体机器人时，模型实时同步显示其姿态。

**目标**

- 侧边栏内嵌**缩略 3D 视图**（常驻可见）
- 点击展开**大视图**（中栏）
- 实时同步实体机器人姿态（6 关节角 + TCP 位姿）
- 显示 **TCP 坐标系**与**运动轨迹**
- 纯只读，不新增任何机器人控制入口

**非目标（本期不做）**

- 从视图控制机器人（点选/拖拽示教、jog、程序下发）
- 多机器人同时显示（本期只支持当前已连接的那一个 IP）
- 无插值的 60 Hz 高保真流（采用轮询 + 客户端插值）

---

## 2. 已确认决策

| # | 决策项 | 选择 |
|---|---|---|
| 1 | 放置形态 | 侧边栏内嵌缩略 + 点击展开大视图（中栏） |
| 2 | 刷新机制 | host REST 轮询 10–20 Hz + 客户端插值 |
| 3 | 模型精度 | 官方 URDF 网格 + TCP 坐标系 + 运动轨迹 |
| 4 | 交互 | 纯只读（视角旋转/缩放/平移属渲染基础能力，不下发任何指令） |
| 5 | 型号 | 全部 **14 款**：`ur3 ur5 ur10 ur3e ur5e ur7e ur10e ur12e ur16e`（BSD，9 款）+ `ur8long ur15 ur18 ur20 ur30`（UR 条款，5 款） |
| 6 | 许可 | 全部打包，附 UR Graphical Documentation 条款与来源声明 |
| 7 | 构建 | esbuild 最小构建 + 原生 DOM + three.js，**不引入 React** |

---

## 3. 架构

插件由**纯 host 插件**升级为**双半插件**（host 半 + client 半），范式参照 `@linxin666/dsh-client-ui-task-board`。

| 层 | 现有 | 新增 |
|---|---|---|
| host 半 | `lib/index.js`（工具注册）、`python/ur_worker.py` + `URBasic` | `src/host/twin-routes.*`：注册位姿查询 HTTP 路由 |
| client 半 | — | `src/client/*` → esbuild 打包 → `lib/client.js` |
| 资产 | — | `assets/models/<urXX>.glb`（14 款）、`assets/kinematics.json` |
| 合规 | `LICENSE` | `THIRD_PARTY_NOTICES.md` |

### 3.1 客户端文件划分（各自单一职责）

| 文件 | 职责 | 依赖 |
|---|---|---|
| `src/client/index.js` | 客户端入口：装配状态源、挂载侧边栏入口与面板 | 下列全部 |
| `src/client/state.js` | 轮询循环、失败退避、订阅分发（单一数据源） | host 路由 |
| `src/client/sidebar-entry.js` | DOM 注入侧边栏入口行（含自愈），点击切换大视图 | 复用 task-board 的 self-healing 模式 |
| `src/client/thumbnail.js` | 侧边栏内嵌缩略 3D 视图（同一 FK 状态的轻量渲染） | three.js、state |
| `src/client/twin-panel.js` | 中栏大视图：全模渲染 + TCP gizmo + 轨迹 + 数值面板 | three.js、state |
| `src/client/robot/fk.js` | 由 `kinematics.json` + 关节角计算各连杆位姿（纯函数） | kinematics.json |
| `src/client/robot/loader.js` | 按型号按需加载 GLB，未知型号回退近似几何体 | three.js GLTFLoader |
| `src/client/robot/scene.js` | 场景/相机/光照/OrbitControls 装配（缩略与大视图共用） | three.js |
| `src/client/robot/trajectory.js` | TCP 轨迹环形缓冲（纯函数，可单测） | — |
| `src/client/robot/interpolate.js` | 两帧间关节角插值（纯函数，可单测） | — |
| `src/client/styles.css` | 样式，继承 shell 的 CSS 变量以对齐主题 | — |

### 3.2 host 侧文件

| 文件 | 职责 |
|---|---|
| `src/host/twin-routes.js` | 注册 `GET /dsh-nonead-ur/twin/state`；校验同源/回环（沿用 task-board 的边界做法） |
| `lib/index.js`（改造） | 在 `apply()` 中挂载路由（复用现有 `UrWorker` 实例） |

### 3.3 清单变更

- `package.json`：
  - `exports` 增 `"./client": "./lib/client.js"`
  - `dsh.client`：`{ "platform": "web", "inject": [...] }`（`inject` 具体清单在实现期依 shell 版本核对）
  - `devDependencies` 增 `esbuild`
  - `scripts` 增 `build:client`（esbuild 打包 `src/client/index.js` → `lib/client.js`，**CJS 工厂包装** + minify，见 §11.4）
  - `files` 增 `assets`、`lib/client.js`、`THIRD_PARTY_NOTICES.md`
- `cordis.patch.yml`：**不变**（沿用现有单行 `insert`）
- `.gitignore`：设计上无需变更（仓库卫生已在 Ruling 9 另行追加 `.pnpm-store/`）

---

## 4. 数据流与协议

```
Python worker  (RTDE dataDir: actual_q / actual_TCP_pose)
      ↑  stdio JSON —— 现有协议，不改
host 路由  GET /dsh-nonead-ur/twin/state?ip=<ip>
      ↑  fetch 轮询 10–20 Hz
client  → 关节角插值(60 fps) → FK → three.js 模型姿态
        → TCP 坐标系 gizmo + 轨迹 polyline
```

### 4.1 路由契约

`GET /dsh-nonead-ur/twin/state?ip=<ip>`

```jsonc
// 200 已连接
{ "connected": true, "model": "UR3", "q": [/* 6 floats, rad */],
  "tcp": [/* 6 floats */], "ts": 1695000000000 }

// 200 未连接 / worker 未就绪
{ "connected": false, "reason": "<可读原因>" }
```

- host 通过现有 `UrWorker.call()` 取 `get_joint_pose` / `get_tcp_pose` / `get_robot_model`
- 路由挂载在现有 webServer 上；沿用 task-board 的回环 + 同源校验边界
- **不改动 Python worker 协议**（那是当前最稳定、且近期刚加固过的部分）

### 4.2 客户端渲染

- **由 6 个关节角经 FK 驱动模型姿态**（最准确）；TCP 位姿用于坐标系 gizmo 与数值面板
- 缩略图与大视图**共享同一轮询循环与同一 FK 状态**（一个数据源，避免重复请求）
- 插值：以相邻两帧的关节角按时间线性插值，渲染至 60 fps。**必须滞后一个采样周期渲染**（见下）
- 轨迹：TCP 位置环形缓冲，默认保留最近 **30 s**（可配置），在场景中画 polyline

**插值的时钟域与渲染滞后（实现期裁决，Ruling 34 —— 不这样做等于没有插值）**

- **时钟域**：快照的 `ts` 来自 host 的 `Date.now()`（epoch 毫秒），而渲染侧的 `now()` 通常是
  `performance.now()`（页面相对原点）。两者直接相减会让 `alpha` 被钳死 ⇒ **必须先把 host 时间戳
  锚定到本地 `now()` 时钟轴**（记录 `{hostTs, localTs}` 锚点，之后按差值平移；host 时间倒退——重连或
  host 重启——则重新锚定并丢弃跨断层的插值对）。
- **渲染滞后**：若按 `now()` 直接插值，最新样本的**到达时刻 ≈ 它的产生时刻**，`alpha` 恒被钳到 1，
  表现为 ~10 Hz 的阶梯跟随、"看着在动"但**没有任何插值**。⇒ 渲染时刻取 `now() - delay`，
  其中 `delay = clamp(cur.ts - prev.ts, 0, 400ms)`（用宿主时间戳差值**自校准**，无需知道轮询间隔）。
  代价是画面滞后约一个采样周期（10 Hz 轮询 ⇒ ~100 ms），对只读孪生可接受。
  轨迹缓冲仍按**真实** `ts` 记录，不受该滞后影响。

---

## 5. 模型与资产管线

**构建期（离线脚本，非运行时）**

1. 从官方 `UniversalRobots/Universal_Robots_ROS2_Description`（分支 `humble`）获取各型号网格
2. 转换为 Web 友好的 **GLB**（three.js `GLTFLoader` 直接加载），输出到 `assets/models/<urXX>.glb`
3. 由其 `config/urXX/default_kinematics.yaml`（6 段 `{x,y,z,roll,pitch,yaw}` 运动学链）与 `joint_limits.yaml` 生成 `assets/kinematics.json`（FK 与关节限位数据源，权威）

**运行时**

- **按需加载**：只加载实机型号（`ur_get_robot_model` 报出的型号）对应的 GLB
- **未知/未内置型号** → 回退**近似几何体**占位并在视图提示（不崩）
- 缩略图可选低模、大视图用全模（实现期按体量决定，不阻塞）

---

## 6. 许可与合规

| 范围 | 许可 | 处理 |
|---|---|---|
| `ur3 ur5 ur10 ur3e ur5e ur7e ur10e ur12e ur16e` 网格 + 全部 `config/*.yaml` | BSD-3-Clause | 附 BSD-3-Clause 声明与版权行 |
| `ur8long ur15 ur18 ur20 ur30` 网格 | UR「Graphical Documentation」条款（非 OSI） | 附 UR 条款全文链接与来源声明 |
| three.js 等前端依赖 | 各自许可 | 一并列入 `THIRD_PARTY_NOTICES.md` |

- 新增 `THIRD_PARTY_NOTICES.md`，按上表分类列明来源、许可、版权
- `README.md` / `README.zh.md` 增"第三方资产与许可"一节指向该文件
- **决策记录**：用户（拓德科技）决定全部打包；该条款适用于再分发场景的确认责任在用户方（已在设计阶段明示）

---

## 7. 错误处理与边界

| 场景 | 行为 |
|---|---|
| 未连接机器人 | 视图显示"未连接"空态与引导文案，不阻塞 shell |
| worker 未启动 / 崩溃 | 显示明确状态；轮询**指数退避**，避免打爆单线程 worker |
| 型号未知 / 未内置 | 近似几何体占位 + 提示 |
| GLB 加载失败 | 回退近似几何体 + 提示，不中断轮询 |
| 路由未挂载（host 半缺失） | 客户端把它们渲染为"宿主未就绪"，不抛 JS 错误 |
| 页面隐藏（`document.hidden`） | 降低轮询频率（省资源） |
| 机器人断开重连 | 自动恢复（下一次轮询成功即恢复） |

**机器人范围**：本期只显示**当前已连接的那一个 IP**；多机器人留作后续独立特性。

---

## 8. 测试策略

| 层 | 测试 |
|---|---|
| FK（`fk.js`） | 用官方 `default_kinematics.yaml` 的已知关节角对拍已知 TCP 位姿；关节限位边界 |
| 插值（`interpolate.js`） | 纯函数：端点一致、时间对齐、跨帧单调性 |
| 轨迹缓冲（`trajectory.js`） | 纯函数：环形容量、老化淘汰、乱序时间戳 |
| host 路由（`twin-routes.js`） | 未连接/已连接/非法参数/非同源的响应；沿用 task-board 的单测风格 |
| 客户端装配 | 离线构建通过 + 在真实 Web GUI 中手动验收（缩略图/大视图/断连空态） |

现有 `npm test`（worker selftest）与 `npm run test:python` 保持不变并继续通过。

---

## 9. 交付物

- 代码：`src/client/*`、`src/host/twin-routes.js`、`lib/client.js`（构建产物）、`lib/index.js`（改造）
- 资产：`assets/models/*.glb`、`assets/kinematics.json`
- 合规：`THIRD_PARTY_NOTICES.md`、README 增补
- 清单：`package.json`（`dsh.client` / exports / build script / files）
- 文档：本设计文档 + 实现计划

---

## 10. 待实现期核验项（尚未验证，不得凭假设实现）

1. **插件静态资产服务路径**：`/plugins/<id>/...` 是否可服务插件目录下的任意文件（GLB/JSON）；据此决定资产加载方式（否则需经 host 路由转发资产）
2. **`dsh.client.inject` 的准确服务清单**：依当前 shell（DSH Desktop 所带版本）核对
3. **官方仓库型号清单与网格格式**：逐型号确认存在性（已实测 `ur3`、`ur7e` 的 `default_kinematics.yaml` 可读），并确认网格为 DAE 还是 STL
4. **GLB 转换工具链**与产物体量（决定是否分包/压缩）
5. 侧边栏 DOM 注入的稳定锚点（沿用 task-board 的 self-healing 选择器策略）

---

## 11. 实现期核验结果（Task 1）

- 日期：2026-09-21
- 方法：**静态核验**（读源码取证）。按控制器 Ruling 5，需要**重启 DSH 或打开浏览器**的验证在本会话无法执行，本节不含任何 GUI 结论。
- 证据来源（除注明外）：本机 DSH 源码检出 `D:\MyProgram\GitLab\nHarness\deepseek-harness`。

### 11.1 核验项 2：`dsh.client.inject` 的实际语义与最小清单 → **`[]`**

**结论**：`dsh.client.inject` 是**信息性**字段（包名依赖边），不参与激活等待；本骨架只使用 `ctx.logger`，因此最小清单就是空数组——即 `package.json` 已写定的 `"inject": []`。原 Step 5 设想的"从 shell 报错逐条补齐"在本插件上**不会触发**。

**证据**

| # | 位置 | 事实 |
|---|---|---|
| 1 | `packages/client/modules/src/index.ts:126-146` | `parseDshClient` 对 inject 仅做 `string[]` 校验，**不解析、不校验包是否存在** |
| 2 | `packages/client/modules/src/index.ts:167-176` | `graphRow` 把 inject **原样**写入 boot 行 |
| 3 | `packages/client/modules/src/client/manifest.ts:45-49` | 原文：*"`inject` is informational graph metadata (the authoritative edges live in each package's `dsh.client` declaration and reach fibers through entry creation)"*；*"`external` carries module-graph edges: **unlike `inject`**, they constrain code arrival"* |
| 4 | `packages/client/modules/src/index.ts:188-220` | `orderByModuleGraph` 只遍历 **`entry.external`**，从不读 `inject` |
| 5 | `packages/client/web/src/boot.ts:127-131` | shell 用 `loader.create({ name })` 建条目，**不转发** manifest 的 inject；功能性服务等待来自 bundle 自身的 `export const inject` |
| 6 | `packages/client/web/src/boot.ts:149` | `assertEntriesActive` 的 pending 报错只针对**服务名**：`Object.keys(entry.fiber.inject).filter(service => ctx.get(service) === undefined)` |
| 7 | `@linxin666/dsh-client-ui-task-board/package.json:31-41` 对比 `src/client/index.ts:84` | 前者 `dsh.client.inject` = 6 个**包名**；后者功能性 `export const inject` = `['slots','sessions','workspaces','connection','settingsScope','locale','remote','remote.session']` **服务名**。两者语义不同，不可互推 |
| 8 | `vendor/cordis/src/context.ts:27-28, 81` | `logger: LoggerService` 由 `Context` 自身构造（`this.logger = new LoggerService(self)`），**不是插件提供的服务**，故永不需 inject |

**含义**：后续任务若要用 shell 的服务（槽位/会话/连接/设置/语言环境等），正确姿势是在 bundle 里写 `export const inject = ['slots', ...]`（**服务名**），`dsh.client.inject` 只用于登记包名依赖边。

### 11.2 核验项 1：`/plugins/<id>/` 是否服务插件目录下**任意**文件 → **否**

**结论**：`/plugins/<id>/` **只**服务 `<id>/client.js` 与 `<id>/client.js.map` 两个文件，其余一律 404。`assets/models/*.glb` 与 `assets/kinematics.json` **不能**经由该路径加载，必须走 host 路由转发（或内联进 bundle）。

**证据**：`packages/client/modules/src/index.ts:529-565`（`serveBundle`）
- 注册点唯一：`index.ts:340` — `ctx.webServer.register({ kind: 'prefix', path: '/plugins', handler: this.serveBundle })`（全仓 `/plugins` 前缀注册仅此一处）
- 后缀白名单：`isSourceMap = pathname.endsWith('/client.js.map')`，`bundleSuffix = '/client.js'`；两者都不匹配即 `clientPath === undefined` → `res.writeHead(404)`
- 路径解析：`this.clientPath(pathname.slice(prefix.length, -suffix.length))` —— 只查 boot 表里已登记的 bundle 绝对路径，**没有**任何目录级静态文件服务
- 源码注释亦确认：*"Anything else under /plugins … is an unknown resource."*

**不可读取项（如实记录）**：`D:\Software\Nonead DSH Desktop\resources\app.asar` 为 168 MB 打包档，内含代码**不可读取**（`app.asar.unpacked\node_modules` 下无 `@deepseek-ai/dsh-client-*`，其 `build` 子目录为空）。本核验未对 asar 内容做任何猜测，改以本机源码检出取证。

### 11.3 核验项 5：侧边栏注入锚点与自愈策略（对照 task-board）

来源：`@linxin666/dsh-client-ui-task-board\src\client\sidebar-entry-core.ts`（321 行，另有 `body-mutations.ts`）。

| 项 | 事实（含行号） |
|---|---|
| 侧边栏根锚点 | `sidebar-entry-core.ts:100-108`：`[data-pane="sidebar"], [class*="sidebarCol"]` → 优先取其内 `[class*="logoRow"]` 的 `parentElement`；回退 `column.firstElementChild` |
| 插入锚点 | `sidebar-entry-core.ts:111-118`：`button[class*="newSession"]`；回退 root 的第一个 `BUTTON` 子元素 |
| 定位基线 | `sidebar-entry-core.ts:196-218`：`logoRow.parentElement === root ? logoRow : button` 为 `base`；`insertBefore(entry, anchor)`，anchor 由**家族选择器**（`familySelectors`）决定，`position: 'before' | 'after'` 控序 |
| 自愈（局部） | `sidebar-entry-core.ts:286-295`：root 级 `MutationObserver{childList:true, subtree:true}`；条目不在 root 内即同帧重插 |
| 自愈（整树重建兜底） | `sidebar-entry-core.ts:282` + `body-mutations.ts:60-133`：页面级共享 `document.body` 观测中枢，注册键 `Symbol.for('dsh-web.body-mutation-hub')`，**每页仅一个** observer、rAF 合帧；`unsubscribeBody` 负责解绑 |
| 幂等 | `sidebar-entry-core.ts:231-233`：`document.querySelector(rowSelector) !== null` 时直接返回 no-op disposer（防重复 apply / HMR 重注 / 陈旧模块） |
| 明确的反模式 | `sidebar-entry-core.ts:202-206` 注释：**没有** append-to-end 兜底 —— *"appending at the end would randomly reorder the block after a shell re-render"* |
| 行是纯 DOM | `sidebar-entry-core.ts:121-193`：`createEntry` 用 `document.createElement`，不入 React 树；图标用 `innerHTML` 注入内联 SVG |

**对本插件的取值（后续任务沿用）**：`rowAttribute = 'data-dsh-ur-twin-entry'`、`rowSelector = '[data-dsh-ur-twin-entry]'`，并复用同一个 body-mutation hub。

### 11.4 本任务发现的高风险项（**已解决**：于 `9227e14` 按 Ruling 6 修复）

> **状态：已修复，本节转为历史记录。** 核验取证全部保留以便追溯；其中的判断属于修复前的状态，已不再是待决项。修复提交：`9227e14`（`fix(twin): emit client bundle as CJS factory + repo hygiene`）。

**当时的缺陷**：按 brief Step 2 写定的 esbuild 配置（`format: 'esm'`，无 banner/footer）产出的 `lib/client.js` 是 `export { apply, name }`，而 shell 以**经典 script** 加载 bundle —— 因此该产物在执行时 `export` 即 **SyntaxError**，且从不调用 `window.__ModuleLoader__.load`，entry 既不注册也不激活。

- shell 加载 bundle 的方式是**经典 script**：`packages/client/modules/src/client/system.ts:13-27`（`defaultLoadBundle`：`document.createElement('script')`、`el.async = true`、`el.src = url`，**不设** `type="module"`）。
- 官方 client 构建产物的形态是**CJS 工厂包装**，而不是 ESM：`packages/client/tsdown.client.ts`
  - `:446` `format: 'cjs'`
  - `:562` `banner: window.__ModuleLoader__.load({ id: "<id>", factory: (require) => {`
  - `:563` `footer: 'return module.exports; } });'`
  - `:564` `intro: 'var module = { exports: {} }; var exports = module.exports;'`
  - `:3` 注释原文：*"artifact: the bundle calls `window.__ModuleLoader__.load({id, factory})`"*
- 实证对照：`@linxin666/dsh-client-ui-task-board\lib\client.js` 首行即 `window.__ModuleLoader__.load({ id: "@linxin666/dsh-client-ui-task-board", factory: (require) => { …`
- 上述形态由修复提交实证：`lib/client.js` 现首行为 `window.__ModuleLoader__.load({ id: "dsh-nonead-universal-robots", factory: (require) => {`（`-ceq` 全等，89 字符），全文 `\bexport\b` 计数为 0。

**最终修法（已实施于 `9227e14`）**：`scripts/build-client.mjs` 改为 `format: 'cjs'` 并加三段包装（与 `tsdown.client.ts:562-564` 等价），bundle id 取包名 `dsh-nonead-universal-robots`：

- `banner.js`（打开 factory）：``window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => {``
- `intro`（声明 CJS 别名）：`var module = { exports: {} }; var exports = module.exports;`
- `footer.js`（收尾）：`return module.exports; } });`

产物以 `node:vm` 的 `Script` 编译通过（可作经典 script 解析）；脚本内置契约自检，任一契约不满足即 `throw` 并给出可操作报错（Ruling 13：不做静默的字符串重排兜底）。

### 11.5 仍需重启 DSH 后才能确认的项

1. 浏览器控制台是否出现 `[ur-twin] client half loaded`、`window.__UR_TWIN__.loaded === true`（brief Step 4）。
2. 客户端 entry 在 shell 启动页是否 `active`（`boot.ts:137-158` 的激活审计是否报 pending/failed）。
3. **残留检查（构建侧，需无沙箱环境）**：首次真实执行 `npm run build:client`，确认 esbuild 的 `banner → intro → footer` 注入顺序如预期、契约自检通过、产物不被改写（脚本已无任何静默重排分支）。构建格式本身已于 `9227e14` 修正，**不再是**前置条件；随后的 `/plugins/dsh-nonead-universal-robots/client.js`（及 `client.js.map`）是否 200 且被登记进 `window.__DSH_BOOT__`，仍待重启 DSH 后确认。
4. 侧边栏注入行的**实际**渲染位置与顺序（锚点选择器在真实 DOM 上的命中情况）。

**观察（未解释，仅记录）**：desktop profile 的 `package.json` 中 `dsh-nonead-universal-robots` 只有 `link:` 依赖，**不在** `dsh.profile.bundles` 列表内，且 `profiles/desktop/cordis.yml` 为 `[]`；但本会话 `ur_*` 工具实际可用，说明其挂载路径不由 profile 清单直接解释（推测由 desktop launcher 层 `dsh-plugin-desktop` 组合 `desktopBundleList(...)`）。Step 4 的 `dsh plugin --profile desktop install` 因此仍是必需动作。

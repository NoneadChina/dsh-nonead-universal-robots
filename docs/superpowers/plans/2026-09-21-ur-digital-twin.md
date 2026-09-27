# UR 3D 数字孪生（侧边栏）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DSH Web GUI 侧边栏加入 UR 机械臂 3D 模型，作为实体机器人的只读数字孪生，实时同步显示姿态、TCP 坐标系与运动轨迹。

**Architecture:** 插件由纯 host 插件升级为**双半插件**。host 半新增一条 HTTP 路由（`GET /dsh-nonead-ur/twin/state`），通过现有 `UrWorker` 读取关节角与 TCP；client 半（esbuild 打包成单个 `lib/client.js`，原生 DOM + three.js，无 React）以 10–20 Hz 轮询该路由，在客户端做关节角插值并以 FK 驱动模型，同时内嵌侧边栏缩略视图与可展开的中栏大视图。**不改动 Python worker 协议。**

**Tech Stack:** Node ESM、esbuild（唯一新增 devDependency）、three.js（`GLTFLoader` + `OrbitControls`）、原生 DOM + CSS、`node --test`（零依赖测试）、Python（仅构建期资产转换）。

**Spec:** `docs/superpowers/specs/2026-09-21-ur-digital-twin-design.md`

## Global Constraints

- **只读**：client 半不得下发任何机器人指令；所有 robot 命令仍只经现有 `ur_*` 工具与审批门禁。
- **不改动 Python worker 协议**（`python/ur_worker.py` 的 stdio 契约保持不变）。
- **不引入 React**；客户端 UI 用原生 DOM。
- **侧边栏无对外 slot**：必须 DOM 注入 + React 重渲染时自愈（本仓库既定模式，见项目笔记）。
- **不新增运行时 npm 依赖**给 host 半；客户端依赖（three.js）只经 esbuild 打进 `lib/client.js`。
- 现有 `npm test`（`node test/selftest.mjs`）与 `npm run test:python` 必须继续通过。
- 许可：BSD 9 款（`ur3 ur5 ur10 ur3e ur5e ur7e ur10e ur12e ur16e`）+ UR Graphical Documentation 5 款（`ur8long ur15 ur18 ur20 ur30`），两类声明都写入 `THIRD_PARTY_NOTICES.md`。
- 未知/未内置型号 → 近似几何体回退，**不得抛错、不得中断轮询**。
- 机器人范围：只显示**当前已连接的那一个 IP**。

## 文件结构（先定边界，再拆任务）

```
package.json                      # 改：exports["./client"] / dsh.client / scripts / devDeps / files
cordis.patch.yml                  # 不改
src/client/index.js               # 新：客户端入口（装配 state + 挂载 entry/panel）
src/client/state.js               # 新：轮询循环 + 退避 + 订阅（唯一数据源）
src/client/sidebar-entry.js       # 新：DOM 注入侧边栏入口（自愈）
src/client/thumbnail.js           # 新：侧边栏内嵌缩略 3D
src/client/twin-panel.js          # 新：中栏大视图（模型 + TCP gizmo + 轨迹 + 数值面板）
src/client/styles.js              # 新：样式（导出 CSS 字符串 + injectStyles()，见 Ruling 28）
src/client/robot/fk.js            # 新：纯函数 FK（kinematics.json + q → 各连杆变换）
src/client/robot/interpolate.js   # 新：纯函数 帧插值
src/client/robot/trajectory.js    # 新：纯函数 TCP 轨迹环形缓冲
src/client/robot/loader.js        # 新：按型号按需加载 GLB + 未知型号回退
src/client/robot/scene.js         # 新：three.js 场景/相机/光照/OrbitControls 装配
lib/twin-routes.js           # 新：注册并处理 GET /dsh-nonead-ur/twin/state
lib/index.js                      # 改：apply() 中挂载路由
lib/client.js                     # 生成：esbuild 产物（不入版本库手改）
scripts/build-client.mjs          # 新：esbuild 打包
scripts/build-assets.mjs          # 新：获取官方运动学 yaml + 网格 → GLB + kinematics.json
assets/kinematics.json            # 生成：14 款型号运动学链 + 关节限位
assets/models/<urXX>.glb          # 生成：14 款网格
test/fk.test.mjs                  # 新
test/interpolate.test.mjs         # 新
test/trajectory.test.mjs          # 新
test/state.test.mjs               # 新
test/twin-routes.test.mjs         # 新
THIRD_PARTY_NOTICES.md            # 新
README.md / README.zh.md          # 改：第三方资产与许可一节
```

---

### Task 1: 双半插件骨架（核验 dsh.client / inject / 静态服务）

先做风险最高、最不确定的部分：证明 client 半能被 shell 加载，并查明插件目录的静态服务规则。

**Files:**
- Modify: `package.json`（`exports`、`dsh.client`、`scripts.build:client`、`devDependencies.esbuild`）
- Create: `src/client/index.js`、`scripts/build-client.mjs`
- Generate: `lib/client.js`（构建产物）

**Interfaces:**
- Produces: `lib/client.js`（ESM，浏览器侧入口）；`npm run build:client`；`window.__UR_TWIN__`（调试标记）

- [ ] **Step 1: 写最小客户端入口**

```js
// src/client/index.js
// 最小骨架：证明 client 半被 shell 加载。后续任务在此装配 state 与视图。
export const name = 'ur-digital-twin-client'

export function apply(ctx) {
  globalThis.__UR_TWIN__ = { loaded: true, at: Date.now() }
  ctx.logger?.info?.('[ur-twin] client half loaded')
  return () => { delete globalThis.__UR_TWIN__ }
}
```

- [ ] **Step 2: 加 esbuild 与构建脚本**

```js
// scripts/build-client.mjs
// 契约（Task 1 核验，Ruling 6）：shell 用**经典 script** 加载 bundle，官方产物一律是
// CJS 工厂包装 —— 必须 format:'cjs' + banner/intro/footer，否则 `export` 会 SyntaxError。
import { build } from 'esbuild'

const ID = 'dsh-nonead-universal-robots'

await build({
  entryPoints: ['src/client/index.js'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome110'],
  minify: true,
  sourcemap: true,
  logLevel: 'info',
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {` },
  intro: 'var module = { exports: {} }; var exports = module.exports;',
  footer: { js: 'return module.exports; } });' },
})
```

**产物验收**：`lib/client.js` 首行必须形如
`window.__ModuleLoader__.load({ id: "dsh-nonead-universal-robots", factory: (require) => {`
（对照 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\@linxin666\dsh-client-ui-task-board\lib\client.js` 首行）。

**契约自检（Ruling 13，定案）**：`build-client.mjs` 在写盘前/写盘后校验上述首行；**不满足即 `throw` 并给出可操作报错**（提示检查 esbuild 的 banner/intro/footer 选项）。
**不得**做静默的字符串重排兜底（未经验证的自动改写风险高于响亮失败）；**不得**产出 ESM（顶层 `export` 即失败）。

> 附注（Ruling 12）：esbuild 0.25.0 **CLI 无 `--intro`**。若在受限环境需用 CLI 绕行，等价施加是 `--banner:js = <HEAD>\n<INTRO>` + `--footer:js = <TAIL>`（同三段字符串、同相对次序）。

`package.json` 增：

```jsonc
"exports": {
  ".": "./lib/index.js",
  "./client": "./lib/client.js",
  "./package.json": "./package.json"
},
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "inject": [] }   // inject 清单在 Step 5 按实际报错补齐
},
"scripts": { "build:client": "node scripts/build-client.mjs" },
"devDependencies": { "esbuild": "^0.25.0" }
```

- [ ] **Step 3: 安装并构建**

Run: `pnpm add -D esbuild && npm run build:client`
Expected: 生成 `lib/client.js`，无报错。

- [ ] **Step 4: 安装到 desktop profile 并重启，验证 client 半被加载**

Run（本机既有 link 安装）: `dsh plugin --profile desktop install` 后重启 DSH。
Expected: 浏览器 DevTools 控制台出现 `[ur-twin] client half loaded`，且 `window.__UR_TWIN__.loaded === true`。

- [ ] **Step 5: 核验并记录三条未知（写入 spec 的 §10 核验项）**

1. `dsh.client.inject` 的真实必需清单——从 shell 报错逐条补齐；
2. `GET /plugins/<plugin-id>/client.js` 是否可服务该目录下**任意**文件（用 `assets/` 下放一个测试文件试探）；
3. 侧边栏 DOM 注入的稳定锚点选择器（对照 task-board 的 `sidebar-entry-core` 策略）。

把三条结论写成一小节追加到 `docs/superpowers/specs/2026-09-21-ur-digital-twin-design.md` 末尾。

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/build-client.mjs src/client/index.js lib/client.js
git commit -m "feat(twin): add dual-face plugin skeleton with client half"
```

---

### Task 2: 资产管线（官方运动学 yaml → kinematics.json；网格 → GLB）

**Files:**
- Create: `scripts/build-assets.mjs`、`assets/kinematics.json`、`assets/models/*.glb`
- Create: `THIRD_PARTY_NOTICES.md`（本任务先落骨架，Task 10 补全）

**Interfaces:**
- Produces: `assets/kinematics.json` — `{ "<urXX>": { "links": [{x,y,z,roll,pitch,yaw} ×6], "jointLimits": [[lo,hi] ×6] } }`（供 Task 3 的 FK 消费）

- [ ] **Step 1: 写运动学抓取脚本**

从官方 `UniversalRobots/Universal_Robots_ROS2_Description`（分支 `humble`）抓取每型号：

```js
// scripts/build-assets.mjs —— 抓取部分（网格转换见 Step 3）
const BASE = 'https://raw.githubusercontent.com/UniversalRobots/Universal_Robots_ROS2_Description/humble'
const MODELS = ['ur3','ur5','ur10','ur3e','ur5e','ur7e','ur10e','ur12e','ur16e',
                'ur8long','ur15','ur18','ur20','ur30']
const LINK_ORDER = ['shoulder','upper_arm','forearm','wrist_1','wrist_2','wrist_3']

// YAML 极小解析：仅需 "<name>:" 段落下的 x/y/z/roll/pitch/yaw 六个数值
function parseKinematicsYaml(text) {
  const out = {}; let cur = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line === 'kinematics:') continue
    const m = /^([a-z_0-9]+):$/.exec(line)
    if (m) { cur = m[1]; out[cur] = {}; continue }
    const kv = /^(x|y|z|roll|pitch|yaw):\s*([-0-9.eE+]+)$/.exec(line)
    if (kv && cur) out[cur][kv[1]] = Number(kv[2])
  }
  return out
}
```

对每型号抓 `config/<m>/default_kinematics.yaml` 与 `config/<m>/joint_limits.yaml`，映射成 `assets/kinematics.json`。**任一型号抓取失败不得中断**：记录到 `assets/_missing.json` 并继续（满足"有几个加几个"）。

- [ ] **Step 2: 跑脚本，验证 kinematics.json**

Run: `node scripts/build-assets.mjs --kinematics-only`
Expected: `assets/kinematics.json` 含 14 个型号键（缺的记入 `_missing.json`）；UR3 数值与实测一致（`shoulder.z == 0.1519`、`forearm.x == -0.24365`）。

- [ ] **Step 3: 网格抓取 + GLB 转换（先探明格式再定工具）**

先抓一个型号（`ur3`）的网格清单，确认是 **DAE 还是 STL**；据结果选转换工具：
- STL → 用 `gltf-transform` 或 Python `trimesh` 合并成一个 GLB；
- DAE → 需 `pycollada`（Python）或 `assimp`。

**转换产物一律写入 `assets/models/<urXX>.glb`，并在日志打印每款体积。** 若单款过大（>3 MB），记录并考虑 draco 压缩（记为后续优化，不阻塞）。

- [ ] **Step 4: 生成许可声明骨架**

写 `THIRD_PARTY_NOTICES.md`，按 spec §6 的两类（BSD-3-Clause / UR Graphical Documentation）列出来源、许可、版权与获取日期。

- [ ] **Step 5: Commit**

```bash
git add scripts/build-assets.mjs assets THIRD_PARTY_NOTICES.md
git commit -m "feat(twin): add asset pipeline (kinematics + GLB meshes)"
```

---

### Task 3: FK 纯函数 + 测试

**Files:**
- Create: `src/client/robot/fk.js`、`test/fk.test.mjs`

**Interfaces:**
- Consumes: `assets/kinematics.json`（Task 2）
- Produces:
  - `rp yToMatrix4(x,y,z,roll,pitch,yaw) -> number[16]`（列主序，与 three.js 一致）
  - `fkChain(kin, q) -> { links: number[16][], tool0: number[16] }`
  - `multiply4(a, b) -> number[16]`、`rotZ(angle) -> number[16]`

- [ ] **Step 1: 写失败测试**

```js
// test/fk.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fkChain, multiply4, identity4 } from '../src/client/robot/fk.js'

const kin = JSON.parse(await readFile(new URL('../assets/kinematics.json', import.meta.url), 'utf8'))

test('q=0 时 tool0 位置等于各连杆 z/x 位移的串联（UR3 已知几何）', () => {
  const { tool0 } = fkChain(kin.ur3, [0, 0, 0, 0, 0, 0])
  // UR3 在 q=0 时末端相对基座的位置（由官方运动学链解析得出，符号由实现期对拍确认）
  const t = translationOf(tool0)
  assert.ok(Math.abs(t[0]) < 1e-6)
  assert.ok(Math.abs(t[1]) < 1e-6)
  assert.ok(t[2] > 0.4 && t[2] < 0.7)   // 量级断言，避免硬编码浮点
})

test('关节 0 转 90° 时末端绕基座 z 轴旋转，z 分量不变', () => {
  const a = fkChain(kin.ur3, [0, 0, 0, 0, 0, 0]).tool0
  const b = fkChain(kin.ur3, [Math.PI / 2, 0, 0, 0, 0, 0]).tool0
  assert.ok(Math.abs(translationOf(a)[2] - translationOf(b)[2]) < 1e-9)
})

test('multiply4 单位元', () => {
  const m = fkChain(kin.ur3, [0.1, -0.2, 0.3, -0.4, 0.5, -0.6]).tool0
  assert.deepEqual(multiply4(identity4(), m).map((v) => Math.round(v * 1e9) / 1e9),
                   m.map((v) => Math.round(v * 1e9) / 1e9))
})

function translationOf(m) { return [m[12], m[13], m[14]] }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/fk.test.mjs`
Expected: FAIL（`fkChain` 未定义）

- [ ] **Step 3: 最小实现**

```js
// src/client/robot/fk.js
export function identity4() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] }

export function multiply4(a, b) {
  const out = new Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
                   + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  }
  return out
}

export function rotZ(t) {
  const c = Math.cos(t), s = Math.sin(t)
  return [c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]
}

/** UR 运动学链参数 → 4x4（列主序）。RPY 采用 ZYX 内旋序（与 URDF 的 rpy 一致）。 */
export function poseToMatrix4(x, y, z, roll, pitch, yaw) {
  const cr=Math.cos(roll), sr=Math.sin(roll)
  const cp=Math.cos(pitch), sp=Math.sin(pitch)
  const cy=Math.cos(yaw), sy=Math.sin(yaw)
  return [
    cy*cp,            sy*cp,            -sp,   0,
    cy*sp*sr - sy*cr, sy*sp*sr + cy*cr, cp*sr, 0,
    cy*sp*cr + sy*sr, sy*sp*cr - cy*sr, cp*cr, 0,
    x, y, z, 1,
  ]
}

/**
 * 由运动学链与 6 个关节角计算各连杆与 tool0 的 4x4 变换。
 * 链序来自 official default_kinematics.yaml；每个关节绕其局部 z 轴旋转 q[i]。
 */
export function fkChain(kin, q) {
  const links = []
  let t = identity4()
  for (let i = 0; i < 6; i++) {
    const l = kin.links[i]
    t = multiply4(t, poseToMatrix4(l.x ?? 0, l.y ?? 0, l.z ?? 0, l.roll ?? 0, l.pitch ?? 0, l.yaw ?? 0))
    t = multiply4(t, rotZ(q[i] ?? 0))
    links.push(t.slice())
  }
  return { links, tool0: t.slice() }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/fk.test.mjs`
Expected: PASS

- [ ] **Step 5: 真机对拍（可选但有价值）**

若 `192.168.2.201` 可用：把机器人 TCP 置零（`ur_set_tcp([0,0,0,0,0,0])`，走审批），用 `ur_get_joint_pose` + `ur_get_tcp_pose` 采几组样本，断言 `fkChain(...).tool0` 与 TCP 位置误差 < 5 mm。把结论记入 spec §10。

- [ ] **Step 6: Commit**

```bash
git add src/client/robot/fk.js test/fk.test.mjs
git commit -m "feat(twin): add forward kinematics with tests"
```

---

### Task 4: 插值与轨迹纯函数 + 测试

**Files:**
- Create: `src/client/robot/interpolate.js`、`src/client/robot/trajectory.js`
- Test: `test/interpolate.test.mjs`、`test/trajectory.test.mjs`

**Interfaces:**
- Produces:
  - `lerpJoints(a, b, alpha) -> number[6]`
  - `interpolateAt(a, b, nowMs) -> number[6]`（a/b 为 `{q, ts}`，按时间钳制 alpha∈[0,1]）
  - `pushSample(buf, {tcp, ts}, maxAgeMs) -> buf`（返回新数组，淘汰超时样本）
  - `trajectoryPoints(buf) -> number[][]`（供 three.js 画线）

- [ ] **Step 1: 写失败测试**

```js
// test/interpolate.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lerpJoints, interpolateAt } from '../src/client/robot/interpolate.js'

test('lerpJoints 端点一致', () => {
  const a = [0,0,0,0,0,0], b = [1,2,3,4,5,6]
  assert.deepEqual(lerpJoints(a, b, 0), a)
  assert.deepEqual(lerpJoints(a, b, 1), b)
})

test('interpolateAt 按时间插值并钳制', () => {
  const a = { q: [0,0,0,0,0,0], ts: 1000 }
  const b = { q: [2,0,0,0,0,0], ts: 2000 }
  assert.equal(interpolateAt(a, b, 1500)[0], 1)
  assert.equal(interpolateAt(a, b, 0)[0], 0)      // 早于 a → 钳到 a
  assert.equal(interpolateAt(a, b, 9999)[0], 2)   // 晚于 b → 钳到 b
})
```

```js
// test/trajectory.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushSample, trajectoryPoints } from '../src/client/robot/trajectory.js'

test('超出 maxAgeMs 的样本被淘汰', () => {
  let buf = []
  buf = pushSample(buf, { tcp: [0,0,0,0,0,0], ts: 1000 }, 5000)
  buf = pushSample(buf, { tcp: [1,0,0,0,0,0], ts: 7000 }, 5000)
  assert.equal(buf.length, 1)
  assert.equal(trajectoryPoints(buf)[0][0], 1)
})

test('乱序时间戳不破坏缓冲', () => {
  let buf = []
  buf = pushSample(buf, { tcp: [0,0,0,0,0,0], ts: 2000 }, 5000)
  buf = pushSample(buf, { tcp: [1,0,0,0,0,0], ts: 1000 }, 5000)
  assert.equal(buf.length, 2)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/interpolate.test.mjs test/trajectory.test.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```js
// src/client/robot/interpolate.js
export function lerpJoints(a, b, alpha) {
  return a.map((v, i) => v + (b[i] - v) * alpha)
}

export function interpolateAt(a, b, nowMs) {
  const span = b.ts - a.ts
  if (!(span > 0)) return b.q.slice()
  const alpha = Math.min(1, Math.max(0, (nowMs - a.ts) / span))
  return lerpJoints(a.q, b.q, alpha)
}
```

```js
// src/client/robot/trajectory.js
export function pushSample(buf, sample, maxAgeMs) {
  const next = [...buf, sample].filter((s) => sample.ts - s.ts <= maxAgeMs)
  return next
}

export function trajectoryPoints(buf) {
  return buf.map((s) => [s.tcp[0], s.tcp[1], s.tcp[2]])
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/interpolate.test.mjs test/trajectory.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/client/robot/interpolate.js src/client/robot/trajectory.js test/interpolate.test.mjs test/trajectory.test.mjs
git commit -m "feat(twin): add interpolation and trajectory buffer with tests"
```

---

### Task 5: host 路由 `/dsh-nonead-ur/twin/state` + 测试

**Files:**
- Create: `lib/twin-routes.js`、`test/twin-routes.test.mjs`
- Modify: `lib/index.js`（在 `apply()` 中挂载）

> **Ruling 19（路径定案）**：host 路由模块放 **`lib/`**，不放 `src/host/`。
> 依据：`package.json` 的 `main` 是 `lib/index.js`，且 `files: ["lib", ...]` **不含 `src/`**（`src/` 只是 client 的构建输入，经 esbuild 打进 `lib/client.js`）。
> 若把 host 半放进 `src/`，`import '../src/host/twin-routes.js'` 在 **npm 包 / 插件安装后**会 `ERR_MODULE_NOT_FOUND`。
> 仓库既有约定即 `lib/` = 手写 host 半（`lib/index.js`、`lib/worker.js`）。
> ⇒ Task 10 必须把 **`assets/`** 加进 `files`（`assets/models/*.glb` 需运行时经 host 路由读取）；`assets/kinematics.json` 则在构建期被 esbuild import 进 `lib/client.js`，无需运行时读取。

**Interfaces:**
- Consumes: 现有 `UrWorker`（`lib/worker.js`）的 `call(op, params, timeoutMs)`
- Produces:
  - `createTwinStateHandler({ worker, connectedIps }) -> async (req) => {status, body}`
  - `createTwinAssetHandler({ assetsDir }) -> async (query) => {status, headers, body}`（**Ruling 7**：`/plugins/<id>/` 只服务 `client.js`/`.map`，GLB 必须经此路由）
  - 路径常量 `TWIN_STATE_PATH = '/dsh-nonead-ur/twin/state'`、`TWIN_ASSET_PATH = '/dsh-nonead-ur/twin/asset'`

- [ ] **Step 1: 写失败测试**

```js
// test/twin-routes.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTwinStateHandler } from '../lib/twin-routes.js'

const worker = { call: async (op) => ({
  get_joint_pose: { joint_positions: [0,0,0,0,0,0] },
  get_tcp_pose: { tcp_pose: [0,0,0.5,0,0,0] },
  get_robot_model: { robot_model: 'UR3', remote_control: false },
}[op]) }

test('已连接时返回 connected + model + q + tcp + ts', async () => {
  const h = createTwinStateHandler({ worker, connectedIps: () => new Set(['1.2.3.4']) })
  const r = await h({ ip: '1.2.3.4' })
  assert.equal(r.status, 200)
  assert.equal(r.body.connected, true)
  assert.equal(r.body.model, 'UR3')
  assert.equal(r.body.q.length, 6)
  assert.equal(r.body.tcp.length, 6)
  assert.equal(typeof r.body.ts, 'number')
})

test('未连接时返回 connected:false 与原因', async () => {
  const h = createTwinStateHandler({ worker, connectedIps: () => new Set() })
  const r = await h({ ip: '1.2.3.4' })
  assert.equal(r.status, 200)
  assert.equal(r.body.connected, false)
  assert.equal(typeof r.body.reason, 'string')
})

test('缺少 ip 参数时返回 400', async () => {
  const h = createTwinStateHandler({ worker, connectedIps: () => new Set() })
  const r = await h({})
  assert.equal(r.status, 400)
})

test('worker 抛错时返回 connected:false 而非 500', async () => {
  const bad = { call: async () => { throw new Error('worker down') } }
  const h = createTwinStateHandler({ worker: bad, connectedIps: () => new Set(['1.2.3.4']) })
  const r = await h({ ip: '1.2.3.4' })
  assert.equal(r.status, 200)
  assert.equal(r.body.connected, false)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/twin-routes.test.mjs`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

```js
// lib/twin-routes.js
export const TWIN_STATE_PATH = '/dsh-nonead-ur/twin/state'

/**
 * 生成 twin 状态处理器。纯逻辑（无 HTTP/socket），便于单测。
 * @param {{worker: {call: Function}, connectedIps: () => Set<string>}} deps
 * @returns {(query: {ip?: string}) => Promise<{status: number, body: object}>}
 */
export function createTwinStateHandler({ worker, connectedIps }) {
  return async function handle(query = {}) {
    const ip = typeof query.ip === 'string' ? query.ip.trim() : ''
    if (ip === '') return { status: 400, body: { error: 'ip is required' } }
    if (!connectedIps().has(ip)) {
      return { status: 200, body: { connected: false, reason: `robot ${ip} is not connected` } }
    }
    try {
      const [jp, tp, md] = await Promise.all([
        worker.call('get_joint_pose', { ip }),
        worker.call('get_tcp_pose', { ip }),
        worker.call('get_robot_model', { ip }),
      ])
      return {
        status: 200,
        body: {
          connected: true,
          model: String(md?.robot_model ?? '').trim(),
          q: jp?.joint_positions ?? [],
          tcp: tp?.tcp_pose ?? [],
          ts: Date.now(),
        },
      }
    } catch (e) {
      return { status: 200, body: { connected: false, reason: e instanceof Error ? e.message : String(e) } }
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test test/twin-routes.test.mjs`
Expected: PASS

- [ ] **Step 5: 在 `lib/index.js` 中挂载路由**

**Ruling 18（已核验的真实 API）**：shell 暴露的是 `ctx.webServer.register({ kind, path, handler })`，
**没有** `webServer.route({path, methods, handler})` 这种签名。证据（本机已装插件）：
`dsh-dream-skin/lib/index.js:269`、`@lcthe/dsh-skills-hub/lib/index.js:387`、
`@linxin666/dsh-client-ui-git-graph/lib/types/host/routes.js:334`、`dsh-free-search/lib/index.js:2032`、
`dsh-config-manager/lib/index.js:5167` —— 均为 `register({ kind: 'exact' | 'prefix', path, handler })`，
`handler` 是 node 原生 `(req, res)`。

**同时修正**：`UrWorker`（`lib/worker.js`）**没有** `connectedIps()` 方法（全文无此成员）；
计划原先的 `worker?.connectedIps?.()` 会恒为空集，导致路由**永远**返回 `connected:false`。
改为在 host 半维护一个由 `connect`/`disconnect` 工具成功调用后更新的 `Set`（**不改动 Python worker 协议**），
并让处理器的 `try/catch` 继续作为正确性兜底（注册表过期只会多一次失败探测，不会误报已连接）。

在该插件 host 半 `apply()` 内：

```js
// lib/index.js —— apply() 内
// 已连接 IP 注册表：由 connect/disconnect 成功调用后维护。
// 仅作快速前置判断；真实正确性由处理器的 try/catch 承担（见 twin-routes.js）。
const connectedIps = new Set()

ctx.inject(['webServer'], (hostCtx) => {
  const stateHandler = createTwinStateHandler({ worker, connectedIps: () => connectedIps })
  const assetHandler = createTwinAssetHandler({ assetsDir: ASSETS_DIR })

  const isTrustedRequest = (req) => {
    // 只信任 loopback（或 webRuntime.trustedHosts 配置的权威）且同源的请求
    const host = typeof req.headers.host === 'string' ? req.headers.host : undefined
    if (host === undefined) return false
    let hostUrl
    try { hostUrl = new URL(`http://${host}`) } catch { return false }
    const hn = hostUrl.hostname
    const loopback = hn === 'localhost' || hn === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hn)
    if (!loopback) return false
    if (req.headers['sec-fetch-site'] === 'cross-site') return false
    const origin = req.headers.origin
    if (origin === undefined) return true
    try { return new URL(origin).host === hostUrl.host } catch { return false }
  }

  const sendJson = (res, { status, body }) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  hostCtx.effect(() => hostCtx.webServer.register({
    kind: 'exact',
    path: TWIN_STATE_PATH,
    handler: async (req, res) => {
      if (!isTrustedRequest(req)) { res.writeHead(403); res.end('forbidden'); return }
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      const url = new URL(req.url, 'http://localhost')
      sendJson(res, await stateHandler({ ip: url.searchParams.get('ip') ?? '' }))
    },
  }), 'ur-twin: state route')

  hostCtx.effect(() => hostCtx.webServer.register({
    kind: 'exact',
    path: TWIN_ASSET_PATH,
    handler: async (req, res) => {
      if (!isTrustedRequest(req)) { res.writeHead(403); res.end('forbidden'); return }
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
      const url = new URL(req.url, 'http://localhost')
      const r = await assetHandler({ model: url.searchParams.get('model') ?? '' })
      res.writeHead(r.status, r.headers ?? {})
      res.end(r.body ?? '')
    },
  }), 'ur-twin: asset route')
})
```

并在 `makeTool(...)` 的 `execute` 中，`worker.call(...)` **成功返回后**更新注册表：

```js
const res = await worker.call(op, args, timeoutMs ?? config.commandTimeoutMs, exec.signal)
if (op === 'connect' && typeof args.ip === 'string') connectedIps.add(args.ip)
if (op === 'disconnect' && typeof args.ip === 'string') connectedIps.delete(args.ip)
```


- [ ] **Step 6: 手动验证路由**

Run: 重启 DSH 后 `curl "http://127.0.0.1:<port>/dsh-nonead-ur/twin/state?ip=192.168.2.201"`
Expected: 已连接时 `connected:true` + `q`/`tcp`；未连接时 `connected:false` + reason。

- [ ] **Step 6b: 资产路由（Ruling 7）**

新增 `createTwinAssetHandler({ assetsDir })`：仅接受 `model` 参数，**白名单**匹配 `^[a-z0-9]+$` 且限定在 `assets/models/` 下解析（**必须防路径穿越**：拒绝含 `/`、`\`、`..` 的取值），命中则回 `200` + `content-type: model/gltf-binary`，未命中回 `404`。并为其补 3 例单测：合法型号 200、未知型号 404、穿越取值（如 `../../package.json`）被拒。

- [ ] **Step 7: Commit**

```bash
git add lib/twin-routes.js test/twin-routes.test.mjs lib/index.js
git commit -m "feat(twin): add host state route with tests"
```

---

### Task 6: 客户端状态源（轮询 + 退避 + 订阅）

**Files:**
- Create: `src/client/state.js`
- Test: `test/state.test.mjs`

**Interfaces:**
- Consumes: `TWIN_STATE_PATH`（Task 5）
- Produces:
  - `createTwinState({ fetchImpl, ip, baseMs = 100, maxMs = 2000 })`
  - `TWIN_STATE_PATH`（客户端侧独立常量，见 Ruling 20）
  - `state.subscribe(listener) -> unsubscribe`
  - `state.getSnapshot() -> { connected, model, q, tcp, ts, error }`
  - `state.start()` / `state.stop()`
  - `nextInterval(current, ok) -> number`（纯函数，退避可单测）

- [ ] **Step 1: 写失败测试**

```js
// test/state.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextInterval } from '../src/client/state.js'

test('成功时回到基础间隔', () => {
  assert.equal(nextInterval(2000, true, 100, 2000), 100)
})

test('失败时按指数退避并有上限', () => {
  assert.equal(nextInterval(100, false, 100, 2000), 200)
  assert.equal(nextInterval(1600, false, 100, 2000), 2000)
  assert.equal(nextInterval(2000, false, 100, 2000), 2000)
})

// **Ruling 22 守卫**：共享常量模块必须保持**零 import** —— 这是它能否被 esbuild 安全
// 内联进浏览器 bundle 的唯一前提。一旦有人往里加 import，这条测试立即失败。
test('lib/twin-paths.js 必须零 import（浏览器 bundle 安全前提）', async () => {
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(new URL('../lib/twin-paths.js', import.meta.url), 'utf8')
  assert.equal(/^\s*(import\s|export\s+[^;]*\bfrom\s)/m.test(src), false, 'twin-paths.js 不得有任何 import/from')
  const mod = await import('../src/client/state.js')
  assert.equal(mod.TWIN_STATE_PATH, '/dsh-nonead-ur/twin/state')
})

test('start/stop 可重复调用且 stop 后不再取数', async () => {
  let calls = 0
  const fakeFetch = async () => ({ json: async () => { calls++; return { connected: true, model: 'UR3', q: [0,0,0,0,0,0], tcp: [0,0,0,0,0,0], ts: 1 } } })
  const { createTwinState } = await import('../src/client/state.js')
  const s = createTwinState({ fetchImpl: fakeFetch, ip: '1.2.3.4', baseMs: 5, maxMs: 10 })
  s.start(); s.start()                       // 重复 start 不得并行出两条轮询链
  await new Promise((r) => setTimeout(r, 40))
  s.stop(); s.stop()
  const seen = calls
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(calls, seen, 'stop 之后不得再有新的取数')
  assert.ok(seen >= 1)
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL（`nextInterval` 未定义）
- [ ] **Step 3: 最小实现**

```js
// src/client/state.js
// **Ruling 20/22（必须遵守）**：客户端半**不得** import host 半的路由模块
// `lib/twin-routes.js`（它要 `node:fs`，被打进浏览器 bundle 会解析失败/带入 Node 内置模块）。
// 路径常量的唯一真源是**零 import** 的 `lib/twin-paths.js`：host 与 client 都 import 它，
// 由 esbuild 在构建期把两个字符串内联进 bundle ⇒ 不可能漂移。
export { TWIN_STATE_PATH } from '../../lib/twin-paths.js'
import { TWIN_STATE_PATH } from '../../lib/twin-paths.js'

export function nextInterval(current, ok, baseMs, maxMs) {
  if (ok) return baseMs
  return Math.min(maxMs, Math.max(baseMs, current * 2))
}

export function createTwinState({ fetchImpl = globalThis.fetch, ip, baseMs = 100, maxMs = 2000 }) {
  let snapshot = { connected: false, model: '', q: [], tcp: [], ts: 0, error: null }
  const listeners = new Set()
  let timer = null, interval = baseMs, stopped = true

  const emit = () => { for (const l of listeners) { try { l(snapshot) } catch {} } }

  async function tick() {
    let ok = false
    try {
      const res = await fetchImpl(`${TWIN_STATE_PATH}?ip=${encodeURIComponent(ip)}`)
      const body = await res.json()
      snapshot = body.connected
        ? { connected: true, model: body.model, q: body.q, tcp: body.tcp, ts: body.ts, error: null }
        : { ...snapshot, connected: false, error: body.reason ?? 'not connected' }
      // **Ruling 21**：只有"确实连上机器人"才算成功。未连接时也要退避到 maxMs，
      // 否则会对着一条离线机器人以 10 Hz 空转，白白打满 host 路由与 worker 调用。
      // 重连检测延迟最多 maxMs（2 s），可接受。
      ok = body.connected === true
    } catch (e) {
      snapshot = { ...snapshot, connected: false, error: e instanceof Error ? e.message : String(e) }
    }
    emit()
    interval = nextInterval(interval, ok, baseMs, maxMs)
    // 浏览器后台标签降频；Node（单测）环境没有 document，必须容错。
    const hidden = typeof document !== 'undefined' && document.hidden === true
    if (!stopped) timer = setTimeout(tick, hidden ? maxMs : interval)
  }

  return {
    subscribe(l) { listeners.add(l); return () => listeners.delete(l) },
    getSnapshot: () => snapshot,
    start() { if (stopped) { stopped = false; tick() } },
    stop() { stopped = true; if (timer) clearTimeout(timer) },
  }
}
```

- [ ] **Step 4: 跑测试确认通过** → PASS
- [ ] **Step 5: Commit**

```bash
git add src/client/state.js test/state.test.mjs
git commit -m "feat(twin): add polling state source with backoff"
```

---

### Task 7: three.js 场景装配 + 按需加载 + 未知型号回退

**Files:**
- Create: `src/client/robot/scene.js`、`src/client/robot/loader.js`

**Interfaces:**
- Consumes: `fkChain`（Task 3）、`assets/models/<urXX>.glb`（Task 2）
- Produces:
  - `createScene(canvas) -> { renderer, scene, camera, controls, resize(), render(), dispose() }`
  - `loadRobotModel(modelId) -> Promise<{ root, applyFK(result), dispose() }>`（未知型号 → 近似几何体）
  - `disposeObject3D(obj)`
  - `LINK_MESH_NODES`（7 个 GLB 节点名）、`ARM_LINKS`（6 段近似臂的默认长度）

> **Ruling 25（装配规则，必须先读，否则模型会散成一堆叠在原点的零件）**
> 官方运动学是 **6 个关节 / 7 个连杆**：`base_link`（固定）+ `shoulder / upper_arm / forearm / wrist_1 / wrist_2 / wrist_3`。
> `fkChain(kin, q)` 返回 `links`（长度 6）= **每个关节转动后**的位姿；`tool0` = 第 6 关节之后再叠加。
> `assets/models/<m>.glb` 里是 **7 个各自独立的顶层节点**（无层级），名字 `base, shoulder, upperarm, forearm, wrist1, wrist2, wrist3`。
> ⇒ 必须由客户端**自己搭层级**，映射关系固定为：
> | GLB 节点 | 挂到哪个变换 |
> |---|---|
> | `base` | 单位矩阵（基座固定） |
> | `shoulder` | `links[0]` |
> | `upperarm` | `links[1]` |
> | `forearm` | `links[2]` |
> | `wrist1` | `links[3]` |
> | `wrist2` | `links[4]` |
> | `wrist3` | `links[5]` |
> `applyFK({links})` 就是把上表逐行写成 `group.matrix.fromArray(links[k])`（`matrixAutoUpdate = false`）。
> **回退几何体（未知型号）必须用同一张表装配**，否则回退臂会塌成一坨。

- [ ] **Step 1: 实现按需加载与回退**

```js
// src/client/robot/loader.js
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Group, Mesh, CapsuleGeometry, MeshStandardMaterial, Matrix4, Object3D } from 'three'
import { TWIN_ASSET_PATH } from '../../../lib/twin-paths.js'

/** GLB 内 7 个网格节点的名字（与 scripts/convert-meshes.py 的 NODE_NAMES 一致）。 */
export const LINK_MESH_NODES = ['base', 'shoulder', 'upperarm', 'forearm', 'wrist1', 'wrist2', 'wrist3']

/** 近似臂的默认连杆长度（米），按 UR3 量级取，仅用于未知型号回退。 */
export const ARM_LINKS = [0.15, 0.12, 0.24, 0.21, 0.085, 0.092, 0.092]

const cache = new Map()

/**
 * 把 root 下名为 LINK_MESH_NODES 的 7 个对象，按 Ruling 25 的表挂到 7 个装配组上。
 * 返回 7 个装配组（[0] = base，[1..6] = 依次对应 links[0..5]）。
 * 找不到某个名字时不抛错：跳过并留下空组（保持数组长度固定，applyFK 才不会错位）。
 */
function assemble(root) { /* 见 Step 1b：建 7 个 Group，把 root 里同名对象 reparent 进去 */ }

/** 未知型号的近似臂：7 段胶囊，按同一张表装配（不能全部堆在原点）。 */
export function buildFallbackArm() {
  const root = new Group()
  const mat = new MeshStandardMaterial({ color: 0x8899aa, roughness: 0.6, metalness: 0.1 })
  for (let i = 0; i < 7; i++) {
    // 第 0 段是基座；其余每段沿自身 -y 方向伸出，长度取 ARM_LINKS[i]
    const len = Math.max(0.04, ARM_LINKS[i] * 0.8)
    const m = new Mesh(new CapsuleGeometry(Math.max(0.03, ARM_LINKS[i] * 0.18), len), mat)
    m.name = LINK_MESH_NODES[i]
    m.position.z = ARM_LINKS[i] * 0.5      // 让关节位于连杆一端
    root.add(m)
  }
  return root
}

export async function loadRobotModel(modelId) {
  const id = String(modelId ?? '').toLowerCase()
  if (cache.has(id)) return cache.get(id)
  let root, usedFallback = false
  try {
    // 资产经 host 路由转发（Ruling 7）：/plugins/<id>/ 只服务 client.js 与 client.js.map，
    // 其余一律 404，故 GLB 不能走插件静态路径。
    const gltf = await new GLTFLoader().loadAsync(`${TWIN_ASSET_PATH}?model=${encodeURIComponent(id)}`)
    root = gltf.scene
  } catch {
    root = buildFallbackArm()   // 未内置/加载失败 → 回退，不抛错
    usedFallback = true
  }
  const groups = assemble(root)
  const handle = {
    root, groups, usedFallback,
    /** 用 fkChain 的结果摆正姿态；links 缺失时静默保持上一姿态。 */
    applyFK(result) {
      const links = result?.links
      if (!Array.isArray(links)) return
      groups[0]?.matrix.identity()
      for (let k = 1; k < 7; k++) {
        const m = links[k - 1]
        if (groups[k] && Array.isArray(m)) {
          groups[k].matrix.fromArray(m)
          groups[k].matrixWorldNeedsUpdate = true
        }
      }
    },
    dispose() { disposeObject3D(root) },
  }
  cache.set(id, handle)
  return handle
}

/** 递归释放 GPU 资源（几何/材质），再从父节点摘下。 */
export function disposeObject3D(obj) {
  obj?.traverse?.((n) => {
    n.geometry?.dispose?.()
    const mats = Array.isArray(n.material) ? n.material : n.material ? [n.material] : []
    for (const m of mats) { for (const k of Object.keys(m)) { m[k]?.dispose?.() } m.dispose?.() }
  })
  obj?.parent?.remove?.(obj)
}
```

- [ ] **Step 1b: `assemble(root)` 的具体实现**

```js
function assemble(root) {
  const groups = []
  for (let i = 0; i < 7; i++) {
    const g = new Group()
    g.name = `assemble_${LINK_MESH_NODES[i]}`
    g.matrixAutoUpdate = false        // 由 applyFK 直接写 matrix
    groups.push(g)
  }
  groups[0].add(groups[1])            // base → shoulder
  groups[1].add(groups[2])            // shoulder → upperarm
  groups[2].add(groups[3])
  groups[3].add(groups[4])
  groups[4].add(groups[5])
  groups[5].add(groups[6])
  for (let i = 0; i < 7; i++) {
    const found = root.getObjectByName(LINK_MESH_NODES[i])
    if (found) groups[i].add(found)   // add() 会自动从原父节点摘下
  }
  return groups
}
```
> 注意：`root` 自身（GLTF 的 `gltf.scene`）要继续作为最外层返回给调用方加入场景；
> 调用方用 `handle.root` 入场景、用 `handle.groups[0]` 作为运动根（把 `groups[0]` 加进 `root` 即可）。

（资产必须经 host 路由（Ruling 7）；host 侧需实现 `GET /dsh-nonead-ur/twin/asset?model=<urXX>` 以正确 `content-type: model/gltf-binary` 回传 `assets/models/<urXX>.glb`。**对外签名不变**。）

- [ ] **Step 2: 实现场景装配**

```js
// src/client/robot/scene.js
import { Scene, PerspectiveCamera, WebGLRenderer, DirectionalLight, AmbientLight, GridHelper } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export function createScene(canvas) {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  const scene = new Scene()
  const camera = new PerspectiveCamera(45, 1, 0.01, 100)
  camera.position.set(0.8, 0.6, 0.8)
  scene.add(new AmbientLight(0xffffff, 0.8))
  const dir = new DirectionalLight(0xffffff, 1.2); dir.position.set(1, 2, 1); scene.add(dir)
  scene.add(new GridHelper(2, 20, 0x334455, 0x223344))
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.target.set(0, 0, 0.3)

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas
    if (w === 0 || h === 0) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  function render() { controls.update(); renderer.render(scene, camera) }
  function dispose() { controls.dispose(); renderer.dispose() }
  return { renderer, scene, camera, controls, resize, render, dispose }
}
```

- [ ] **Step 3: 手动验证**

在 GUI 中打开大视图，确认模型出现、可旋转缩放；把型号换成不存在的（手动改 `modelId`）确认走回退且不报错。

- [ ] **Step 4: Commit**

```bash
git add src/client/robot/scene.js src/client/robot/loader.js
git commit -m "feat(twin): add three.js scene and on-demand model loading"
```

---

### Task 8: 大视图面板（模型 + TCP gizmo + 轨迹 + 数值面板）

**Files:**
- Create: `src/client/twin-panel.js`、`src/client/styles.js`
- Test: `test/twin-panel.test.mjs`

> **Ruling 28（CSS 交付方式，实测依据）**：客户端产物只有单个 `client.js`，shell **不会**加载任何同目录 `.css`。
> 既定模式（本机已装插件 `@linxin666/dsh-client-ui-task-board/lib/client.js:1988`、`dsh-dream-skin`）是
> `document.createElement('style')` + `textContent = <CSS 字符串>` 注入。
> 因此样式写成 **`src/client/styles.js`**（导出 CSS 字符串 + `injectStyles()`），**不要**用 `.css` 文件：
> esbuild 默认把 `.css` 输出成**独立文件**（`client.css`），shell 不加载它，样式会静默全丢；
> 而要改成 `--loader:.css=text` 就得动 `scripts/build-client.mjs`——该脚本在本沙箱**无法运行验证**
> （esbuild 的 JS API 走管道 spawn），改它属于"改不动也验不了"的动作，规避掉。
> 若判断有误的代价：无（纯字符串注入即可用，且样式可见）。

> **Ruling 29（可测性：必须依赖注入，否则 Task 8 一行都测不了）**
> `WebGLRenderer` 需要 WebGL、`requestAnimationFrame` 在 Node 里不存在 ⇒ 直接写死的面板**无法单测**，
> 而本环境又做不了 GUI 验收。⇒ `mountTwinPanel` 必须接受注入口：
> `mountTwinPanel({ container, state, sceneFactory = createScene, modelLoader = loadRobotModel, raf = globalThis.requestAnimationFrame, caf = globalThis.cancelAnimationFrame, now = () => performance.now() })`
> 缺省值保持真实行为不变；测试注入假实现（假 scene = 记录 `add`/`remove` 的对象）。
> 若判断有误的代价：Task 8 只剩"看起来对"的静态审查，无处验证。

**Interfaces:**
- Consumes: `createScene`/`loadRobotModel`（Task 7）、`fkChain`（Task 3）、`interpolateAt`/`pushSample`/`trajectoryPoints`（Task 4）、`createTwinState`（Task 6）
- Produces: `mountTwinPanel({ container, state, ...注入项 }) -> { dispose() }`（**返回值必须含 `dispose`**）

- [ ] **Step 1: 实现面板**

要求（逐条落实，勿省略）：
- 一个渲染循环，读 `state.getSnapshot()`，用 `interpolateAt(prev, cur, now)` 得到平滑关节角，`fkChain` 后经
  **Task 7 的 `handle.applyFK(result)`** 写入姿态。**用注入的 `raf`/`caf`，不要直接调全局 `requestAnimationFrame`。**
- **模型入场景用 `scene.add(handle.root)`**（Task 7 的 `assemble()` 已把 7 个装配组挂回 `root`；不要再手动 add `groups[0]`）。
- TCP 坐标系 gizmo（`AxesHelper` 0.08）贴到 `tool0`（`applyFK` 之后用 `handle.groups[6]` 的世界矩阵或 `tool0` 直接定位）。
- 轨迹：每帧 `pushSample`，`trajectoryPoints` 更新一条 `Line`（`BufferGeometry` **预分配**固定容量，避免每帧重建）；超龄样本淘汰。
- 数值面板：6 关节角（度）+ TCP `x,y,z,rx,ry,rz`，纯 DOM 文本，**节流到 ~10 Hz**（不要每帧写 DOM）。
- 未连接/加载中：显示明确状态文案（如"未连接机器人"），**不显示空 3D**；恢复连接后自动显示模型。
- 型号变化时重建模型（`loadRobotModel` 缓存命中；旧模型 `dispose()`）。
- `dispose()` 必须：`caf` 停循环、`modelLoader` 得到的东西 dispose、DOM 清空、不留下监听器。**幂等**（重复调用安全）。
- **只读**：面板不得调用任何下发指令的接口。

- [ ] **Step 2: 单测（`test/twin-panel.test.mjs`，用注入的假对象）**

至少覆盖：
1. 挂载后容器内出现 canvas 与状态元素。
2. `state` 快照 `connected:false` 时显示"未连接"文案，且**不**加载模型。
3. 快照 `connected:true` 时用正确型号调用 `modelLoader`，并在每帧调用 `applyFK`。
4. 型号从 `UR3` 变到 `UR5E` 时重新加载模型、旧模型被 `dispose`。
5. 轨迹点数随帧增长且**不超过预分配容量**（喂超过容量的帧数，断言不越界、不重建 geometry）。
6. `dispose()` 后：`caf` 被调用、容器被清空、再触发已排队的帧回调**不再**调用 `applyFK`；重复 `dispose()` 不抛错。

- [ ] **Step 3: 手动验收（对照 spec §8；**本会话无 GUI，如实标注为未验证**）**

逐项确认：平滑跟随、TCP gizmo 正确、轨迹累积与淘汰、断连空态、未知型号回退。

- [ ] **Step 4: Commit**

```bash
git add src/client/twin-panel.js src/client/styles.js test/twin-panel.test.mjs
git commit -m "feat(twin): add center-column twin panel with DOM HUD and trajectory"
```
```

---

### Task 9: 侧边栏入口（DOM 注入 + 自愈）+ 缩略视图

**Files:**
- Create: `src/client/sidebar-entry.js`、`src/client/thumbnail.js`
- Test: `test/sidebar-entry.test.mjs`、`test/thumbnail.test.mjs`
- Modify: `src/client/index.js`（装配与挂载）

**Interfaces:**
- Consumes: `createTwinState`（Task 6）、`mountTwinPanel`（Task 8）
- Produces: `mountSidebarEntry({ onToggle }) -> dispose`；`mountThumbnail({ container, state }) -> { dispose() }`

- [ ] **Step 1: 入口注入（沿用既定模式）**

> **Ruling 30（真实锚点，已从本机已装插件读出，别再猜）**
> 来源：`%USERPROFILE%\.dsh\profiles\desktop\node_modules\@linxin666\dsh-client-ui-task-board\lib\client.js`
> （`shared/client/sidebar-entry-core.ts` 的发行版）。
> ```js
> const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
> const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
> const ACTIVATE_EVENT = 'dsh-panel-activate'   // detail = 激活的面板名
> ```
> 要点：
> 1. **侧边栏入口**插在 `[class*="newSession"]` 之后（与工作区浏览器之间），行上打 `data-dsh-ur-twin-entry` 标记。
> 2. **自愈**用**一个全局单例** `MutationObserver`（`observe(document.body ?? document.documentElement, {childList:true, subtree:true})`），
>    变更**批量到下一帧**再处理（`rAF` 去抖），多个订阅者共享同一个 observer，最后一个退订时 `disconnect()`。
>    **不要**每个挂载点各起一个 observer。
> 3. **中栏是跨插件公共资源**：`dsh-panel-activate`（detail = 激活者名字）用来协调。我们激活自己的面板时要
>    `dispatchEvent(new CustomEvent('dsh-panel-activate', { detail: PANEL_NAME }))`，并在收到**别人**的激活事件时
>    收起自己的面板。**不做这一步会与 task-board 的面板争抢同一列。**
> 4. 中栏容器可能尚未挂载（`conversationColumn()` 返回 `undefined`）⇒ 挂载要**可重试**，由上面那个 observer 触发，不能只试一次。

按上述锚点实现：在"新建会话"按钮与工作区浏览器之间插入一行（`data-dsh-ur-twin-entry`），
带单例 `MutationObserver` 自愈以应对 React 重渲染；点击切换中栏大视图。

- [ ] **Step 2: 缩略视图**

复用 `createScene` + 同一个 `state`（**不得另起轮询**）；尺寸适配侧边栏宽度；无交互（`OrbitControls` 关闭、固定相机）。

- [ ] **Step 2b: 可测性（Ruling 31，与 Task 8 的 Ruling 29 同源，必须有）**

本环境**没有 DOM 也没有 WebGL**，所以两个模块都必须接受注入，否则一行都测不了：
```js
mountSidebarEntry({ doc = globalThis.document, onToggle }) -> { dispose(), isActive() }
mountThumbnail({ container, state, sceneFactory = createScene, modelLoader = loadRobotModel, raf = globalThis.requestAnimationFrame, caf = globalThis.cancelAnimationFrame, now = () => performance.now() }) -> { dispose() }
```
- `sidebar-entry.js` 只经注入的 `doc` 使用 `querySelector` / `createElement` / `addEventListener`，
  **不要**直接摸全局 `document`（测试传一个手写的假 document 即可覆盖插入/自愈/清理）。
- 必须可单测的行为：① 插到 `[class*="newSession"]` 之后且带 `data-dsh-ur-twin-entry`；
  ② 该行被 React 移除后，**下一次 observer 触发时重新插入**（自愈）；③ `dispose()` 摘掉自己的 DOM、断开 observer、移除监听；
  ④ 收到 `dsh-panel-activate` 且 `detail` **不是**自己时收起面板；自己激活时派发该事件。
  ⑤ 中栏容器不存在时**不抛错**，并在容器出现后自动完成挂载（重试路径）。
- `thumbnail.js` 用假 `sceneFactory`/`modelLoader` 测：无 `state` 订阅泄漏、`dispose()` 幂等、未连接时不加模型。

- [ ] **Step 3: 在 `src/client/index.js` 装配**

创建唯一 `state`，`start()`；挂载入口与缩略图；大视图按需挂载/卸载；返回 `dispose` 清理（含 `state.stop()`）。

- [ ] **Step 4: 手动验收**

侧边栏出现入口与缩略模型且实时跟随；点击展开/收起大视图；React 重渲染后入口仍在（自愈生效）。

- [ ] **Step 5: Commit**

```bash
git add src/client/sidebar-entry.js src/client/thumbnail.js src/client/index.js
git commit -m "feat(twin): add sidebar entry and thumbnail view"
```

---

### Task 10: 合规、打包与文档

**Files:**
- Create/Complete: `THIRD_PARTY_NOTICES.md`
- Modify: `README.md`、`README.zh.md`、`package.json`（`files`）、`CHANGELOG.md`、`CHANGELOG.zh.md`

- [ ] **Step 1: 补全 `THIRD_PARTY_NOTICES.md`**

按 spec §6 分类列明：BSD-3-Clause 9 款（附版权行与许可全文链接）、UR Graphical Documentation 5 款（附条款链接、来源与获取日期）、three.js 及 esbuild 的许可。

- [ ] **Step 2: README 增"第三方资产与许可"一节**（中英双语），指向该文件；并说明数字孪生功能与"只读"边界。

- [ ] **Step 3: 打包清单与版本**

`package.json` 的 `files` 增 `assets`、`lib/client.js`、`docs`（如需）；`CHANGELOG` 按 `### 新增` 记录本功能；版本按语义化 bump。

- [ ] **Step 4: 全量验证**

> **Ruling 32（命令必须绕开 npm）**：`npm test` / `npm run *` / `npx` 在本沙箱会因 piped stdio 生成子进程而 `spawn EPERM`。
> 语义等价的直调命令**全部可用**，Step 4 一律用后者：

Run: `node --test test/*.test.mjs`（全部单测）
Run: `node test/selftest.mjs`（现有 selftest 必须仍通过，末行 `selftest passed.`）
Run: `python python/ur_worker.py --selfcheck`（等价于 `npm run test:python`）
Run: `python scripts/verify-models.py`（14 个 GLB 的节点契约）
Run: `node scripts/build-client.mjs`（等价于 `npm run build:client`；**应 exit 0 并打印"首行契约通过"**；重复构建产物应稳定）
Expected: 全部通过。若任一条失败，如实记录，**不得**因为"沙箱限制"而跳过——Ruling 32 已证明这些命令能跑。

- [ ] **Step 5: Commit**

```bash
git add THIRD_PARTY_NOTICES.md README.md README.zh.md package.json CHANGELOG.md CHANGELOG.zh.md
git commit -m "docs(twin): add third-party notices and release metadata"
```

---

## 自审记录

- **Spec 覆盖**：§3 架构→Task 1/5/7/8/9；§4 数据流→Task 5/6/8；§5 资产管线→Task 2；§6 许可→Task 2 Step 4 + Task 10；§7 错误处理→Task 5 Step 3（worker 抛错）+ Task 6 Step 3（退避）+ Task 7 Step 1（回退）+ Task 8 Step 1（空态）；§8 测试→Task 3/4/5/6 + Task 8/9 手动验收；§9 交付物→Task 10；§10 核验项→Task 1 Step 5 + Task 2 Step 3 + Task 3 Step 5。
- **占位符扫描**：无 TBD/TODO；每个代码步骤均给出实际代码。
- **类型一致性**：`fkChain` 返回 `{links, tool0}`、`interpolateAt(a,b,nowMs)`、`pushSample(buf,sample,maxAgeMs)`、`createTwinStateHandler({worker, connectedIps})`、`TWIN_STATE_PATH` 在 Task 5/6 间一致；`loadRobotModel(modelId)` 在 Task 7/8 间一致。
- **已知依赖外部事实的两处**（Task 1 Step 5、Task 2 Step 3）**已显式标为核验项**，不允许实现者凭假设推进。

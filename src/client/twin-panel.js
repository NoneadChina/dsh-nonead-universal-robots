/**
 * src/client/twin-panel.js — 中栏大视图面板：UR 模型 + TCP 坐标系 gizmo + 轨迹 + 数值面板。
 *
 * ## 数据流（只读）
 * `state.getSnapshot()`（Task 6，轮询 host 的只读 `/twin/state`）
 *   → `interpolateAt(prev, cur, now())`（Task 4 平滑）
 *   → `fkChain(kin, q)`（Task 3，运动学链取自构建期内联的 `assets/kinematics.json`）
 *   → `handle.applyFK(result)`（Task 7 写姿态）
 *   → `sceneHandle.render()`（Task 7 的场景）
 * **本面板不下发任何机器人指令**：没有 `fetch`、没有写路由、没有 MCP 工具调用。
 *
 * ## Ruling 29（依赖注入，硬约束）
 * `WebGLRenderer` 要真实 WebGL 上下文、`requestAnimationFrame` 在 Node 里不存在
 * ⇒ 写死的面板**一行都测不了**（本环境又没有 GUI 做手动验收）。故全部外部副作用都从参数进来：
 * `sceneFactory` / `modelLoader` / `raf` / `caf` / `now`。**缺省值保持真实行为**，
 * 循环里一律用注入的 `raf`/`caf`，不直接摸全局。
 * DOM 也是注入的：面板从 `container.ownerDocument` 取文档（真实浏览器里就是 `document`），
 * 这样单测可以喂一个最小假 DOM。
 *
 * ## 关键实现约束（逐条对应计划 Task 8 Step 1）
 * - 模型入场景用 **`scene.add(handle.root)`**：Task 7 的 `assemble()` 已把 7 个装配组挂回 `root`，
 *   再手动 add `groups[0]` 会把它从 root 摘走。
 * - 轨迹的 `BufferGeometry` **预分配固定容量**（`TRAJECTORY_CAPACITY` 点），逐帧只覆写
 *   position 数据 + `setDrawRange`，**绝不每帧重建 geometry**；缓冲本身按容量与龄期双重淘汰。
 * - 数值面板**节流到 ~10 Hz**（`HUD_INTERVAL_MS`），不每帧写 DOM。
 * - 未连接：显示中文状态文案、隐藏 3D 视图、**不创建空场景、不 render**；恢复连接自动显示。
 * - 型号变化：重新 `modelLoader(id)`，新模型入场景、旧模型从场景摘除并 `dispose()`。
 * - `dispose()` 幂等：`caf` 停循环、释放模型与场景资源、清空 DOM、摘掉监听。
 *
 * ## 时间轴（偏差 D1，见报告）
 * 快照的 `ts` 来自 host（`lib/twin-routes.js` 的 `ts: Date.now()`，epoch 毫秒），
 * 而注入的 `now` 缺省是 `performance.now()`（原点不是 epoch）。两者直接相减会让
 * `interpolateAt` 的 alpha 恒被钳到 0（= 永远显示上一帧采样、永不插值）。
 * ⇒ 面板用**相对增量锚定**把快照时间戳映射到 `now()` 的时钟轴上（只做加法，不改采样间隔），
 * 于是两种时钟域都能得到正确的 alpha；宿主时间倒退（重连/host 重启）时重新锚定并丢弃跨断层的插值对。
 *
 * ## 渲染滞后一个采样周期（fix round 1，控制器裁决 U2）
 * 只做上述锚定还不够：最新样本的**到达时刻 ≈ 它的产生时刻** ⇒ `now` 几乎总是 ≥ `cur.ts`，
 * alpha 仍被钳到 1，结果只是 ~10 Hz 阶梯、等于没有插值。
 * ⇒ 渲染时刻取 `now() - delayMs`，而 `delayMs = cur.ts - prev.ts`（用宿主 ts 的差值**自校准**，
 * 不需要知道轮询间隔）：滞后恰好一个采样周期后，渲染时刻落在 `[prev.ts, cur.ts]` 内，
 * alpha ∈ (0,1)，帧与帧之间连续推进就是真正的插值平滑。
 * 采样间隔异常大（host 卡顿/丢帧）时滞后被钳到 `RENDER_DELAY_MAX_MS`，避免画面无限滞后在很久以前。
 * 只有单个样本（`prev` 为空）时不做插值，直接返回该样本。
 * 轨迹的时间戳**不**受这个滞后影响：轨迹按样本真实的 `ts` 记录（`pushTrajectorySample` 用 `snap.ts`）。
 */

import {
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
} from 'three'

import kinematicsJson from '../../assets/kinematics.json' with { type: 'json' }

import { createScene } from './robot/scene.js'
import {
  createTcpAxes,
  disposeTcpAxes,
  tcpAxesSizeFor,
  updateTcpAxesSize,
  TCP_AXES_SIZE,
} from './robot/tcp-axes.js'
import { linkLengthsFromKinematics, loadRobotModel } from './robot/loader.js'
import { createGhostArm, disposeGhostArm } from './robot/ghost-arm.js'
import {
  createCogMarker,
  createForceArrow,
  createReachSphere,
  disposeOverlay,
  formatForce,
  reachRadiusFromKinematics,
  updateForceArrow,
} from './robot/overlays.js'
import { fkChain } from './robot/fk.js'
import { interpolateAt } from './robot/interpolate.js'
import { pushSample, trajectoryColors, trajectoryCsv, trajectoryPoints } from './robot/trajectory.js'
import { injectStyles } from './styles.js'
import { activeStrings } from './strings.js'

/**
 * 当前语言的文案表（清单第 15 条）。
 *
 * ⚠️ **必须定义在模块最前面**：下面的 `SAFETY_TEXT = S.safetyMode` 等映射表在**模块求值期**
 * 就会读它，放到后面会直接 TDZ 报错（`Cannot access 'S' before initialization`）。
 *
 * 模块级只取一次：面板是长期驻留的，运行期不会换语言。`STATUS_*` 等导出常量刻意保持
 * 中文原样 —— 它们是大量既有测试的断言目标，而运行时一律走这里。
 */
const S = activeStrings()
import { captureTwinPng, downloadDataUrl, screenshotFileName } from './robot/screenshot.js'

/* ------------------------------------------------------------------ *
 * 常量（可单测的纯数据）
 * ------------------------------------------------------------------ */

/** 轨迹 `BufferGeometry` 的预分配容量（点）。超过就淘汰最老的，**不重建 geometry**。 */
export const TRAJECTORY_CAPACITY = 600

/** 轨迹样本最大保留时长（毫秒，按快照自带 ts 的差值计）。 */
export const TRAJECTORY_MAX_AGE_MS = 60_000

/** 数值面板节流间隔（毫秒）≈ 10 Hz。 */
export const HUD_INTERVAL_MS = 100

/** 渲染滞后的下限（毫秒）：采样间隔退化（≤0 / 非有限）时退化为"不滞后"。 */
export const RENDER_DELAY_MIN_MS = 0

/**
 * 渲染滞后的上限（毫秒）。
 * host 卡顿/丢帧导致采样间隔异常大时，滞后不能跟着无限增长，否则画面会"卡在很久以前"。
 */
export const RENDER_DELAY_MAX_MS = 400

/** TCP 坐标系 gizmo 的轴长（米）——与机械臂尺度（~0.8 m）相称，肉眼可见又不喧宾夺主。 */
export { TCP_AXES_SIZE }

/** 未连接时的中文状态文案。 */
export const STATUS_DISCONNECTED = '未连接机器人'
/** 已连接但模型尚未就绪。 */
export const STATUS_LOADING = '已连接 · 正在加载模型…'
/** 已连接（前缀，后面接型号）。 */
export const STATUS_CONNECTED = '已连接'
/** 近似几何体回退提示后缀。 */
export const STATUS_FALLBACK_SUFFIX = '（无内置模型，使用近似几何体）'
/** 渲染异常前缀（帧内异常被吞掉并显示，不影响循环存活）。 */
export const STATUS_ERROR_PREFIX = '渲染异常：'
/** 模型加载失败前缀。 */
export const STATUS_LOAD_FAILED = '模型加载失败：'
/** 3D 不可用（没有 WebGL）时的回退文案：数值通道仍然可用。 */
export const STATUS_NO_WEBGL = '当前环境不支持 WebGL：已切换为纯数值模式（关节角与 TCP 仍会更新）'
/** 位姿载荷不完整（q 不足 6 维）时的提示。 */
export const STATUS_INCOMPLETE = '机器人未返回完整的关节角'
/** 上下文丢失提示。 */
export const STATUS_CONTEXT_LOST = '3D 上下文丢失（GPU 重置）—— 收起并重新展开面板可恢复'
/** 安全模式异常时跟在模式名后面的处置提示（状态行会用它取代常规的「已连接 · 型号」）。 */
export const STATUS_SAFETY_HINT = '机器人可能已停止，请检查示教器'

/**
 * 把 host 给的 `code` 翻译成一句人话。
 *
 * 为什么需要：host 的失败响应里既有 `code` 也有 `reason`，但客户端以前**只**渲染一句固定的
 * 「未连接机器人」——于是"worker 进程挂了"、"机器人没连上"、"两台机器人有歧义"这三种完全
 * 不同的处置方式在界面上长得一模一样（而且歧义那种情况还会永远白轮询下去）。
 *
 * @param {string} code host 的机器可读错误码
 * @param {string} reason host 附带的原因（可能为空）
 * @param {string[]} ips 歧义时 host 给出的候选
 * @returns {string} 面向用户的状态文案
 */
export function describeDisconnected(code, reason, ips) {
  switch (code) {
    case 'no_robot':
      return S.disconnectNeverConnected
    case 'robot_not_connected':
      return S.disconnectReason(reason)
    case 'ambiguous_robot':
return S.disconnectAmbiguous(S.disconnectCandidates(ips))
    case 'worker_unavailable':
      return S.disconnectWorkerDown(reason)
    case 'robot_error':
      return S.disconnectReadFailed(reason)
    default:
      return reason ? S.disconnectReason(reason) : S.statusDisconnected
  }
}

/** 构建期内联的运动学表（14 个型号；esbuild 会把 JSON 直接打进 bundle，无运行时读取）。 */
export const KINEMATICS = kinematicsJson

/** 型号缺失时的兜底运动学键（`assets/kinematics.json` 必含）。 */
export const DEFAULT_KINEMATICS_KEY = 'ur3'

/**
 * 型号 id → 运动学链（纯函数，可单测）。
 *
 * 未知/空型号**不抛错**，退回 `DEFAULT_KINEMATICS_KEY`（再退到表里第一项），
 * 这样机器人报出一个我们没有资产的型号时面板仍能摆姿态而不是每帧抛异常。
 *
 * @param {string} modelId 型号（大小写不敏感，如 `UR5E` / `ur5e`）
 * @returns {{links: Array<object>, jointLimits?: number[][]}|null}
 */
export function resolveKinematics(modelId) {
  const table = KINEMATICS ?? {}
  const id = String(modelId ?? '').trim().toLowerCase()
  return table[id] ?? table[DEFAULT_KINEMATICS_KEY] ?? Object.values(table)[0] ?? null
}

/**
 * 6 关节角（**弧度**）→ 数值面板文本（**度**）。
 *
 * @param {number[]} joints 关节角（弧度）
 * @returns {string} 如 `关节角 (°)  J1 5.7  J2 -22.9  …`
 */
export function formatJoints(joints) {
  const parts = []
  for (let i = 0; i < 6; i++) {
    const v = joints?.[i]
    const deg = Number.isFinite(v) ? (v * 180) / Math.PI : null
    parts.push(`J${i + 1} ${deg === null ? '--' : deg.toFixed(1)}`)
  }
  return `${S.jointsPrefix}  ${parts.join('  ')}`
}

/**
 * 找出**超出关节限位**的关节编号（1 基）。
 *
 * `kinematics.json` 里每个型号都带 `jointLimits`（`[[min,max], …]`，个别关节是 `null`），
 * 但在此之前客户端从未用过它。这是**零新增数据**的可视化：超限了就直接在 HUD 上标出来，
 * 而不是让操作员自己去比对六个数字。
 *
 * 纯函数：缺值、`null` 限位、长度不齐一律跳过而不是抛错 —— 一个畸形的限位表不该让整块
 * HUD 停止更新。
 *
 * @param {ArrayLike<number>} joints 六个关节角（弧度）
 * @param {ArrayLike<ArrayLike<number>|null>} limits 与 `joints` 对齐的限位表
 * @returns {number[]} 超限关节编号（1 基，升序）
 */
export function overLimitJoints(joints, limits) {
  if (joints == null || limits == null) return []
  const over = []
  const count = Math.min(joints.length ?? 0, limits.length ?? 0)
  for (let i = 0; i < count; i++) {
    const limit = limits[i]
    const value = joints[i]
    // 必须先确认限位是数组：`limit = 0` 这种坏数据会让数组解构直接抛 TypeError，
    // 而那会打断整帧、让 HUD 停在上一笔读数上。
    if (!Array.isArray(limit) || !Number.isFinite(value)) continue
    const [min, max] = limit
    if (!Number.isFinite(min) || !Number.isFinite(max)) continue
    // 反转区间（min > max）是坏数据：拿它去判定只会凭空把好关节标红，直接跳过。
    if (min > max) continue
    if (value < min || value > max) over.push(i + 1)
  }
  return over
}

/**
 * TCP 六维 → 数值面板文本（位置 4 位小数 / 姿态 3 位小数）。
 *
 * ⚠️ 姿态三个数 `rx/ry/rz` 是 UR 的**轴角旋转向量**（方向=旋转轴、模长=旋转角，弧度），
 * **不是** roll/pitch/yaw。以前只写 `rx ry rz` 会让人按 RPY 去读，从而得出错误的朝向。
 *
 * @param {number[]} tcp `[x, y, z, rx, ry, rz]`
 * @returns {string} 如 `TCP(米/轴角弧度)  x 0.1234  y -0.2345  z 0.3456  rx 0.000  ry 0.000  rz 0.000`
 */
export function formatTcp(tcp) {
  const names = ['x', 'y', 'z', 'rx', 'ry', 'rz']
  const parts = names.map((n, i) => {
    const v = tcp?.[i]
    if (!Number.isFinite(v)) return `${n} --`
    return `${n} ${v.toFixed(i < 3 ? 4 : 3)}`
  })
  return `${S.tcpPrefix}  ${parts.join('  ')}`
}

/* ------------------------------------------------------------------ *
 * detail=1（dashboard 侧状态）—— 纯映射，可单测
 * ------------------------------------------------------------------ */

/**
 * 安全模式原始串 → 中文。**未知值原样返回**：宁可显示 `SOMETHING_NEW` 也不要显示空白，
 * 否则固件新增一个模式时界面会假装"一切正常"。
 */
const SAFETY_TEXT = S.safetyMode

/** 机器人模式原始串 → 中文（未知值原样返回）。 */
const ROBOT_MODE_TEXT = S.robotMode

/** 程序状态原始串 → 中文（未知值原样返回）。 */
const PROGRAM_STATE_TEXT = S.programState

/**
 * dashboard 查询失败时 host 给的哨兵值（见 `python/ur_worker.py` 的 `dash()`）：
 * 语义是"这个字段没问到"，与"字段为空"不是一回事。
 */
export const DETAIL_QUERY_FAILED = '<查询失败>'

/** 把原始状态串翻成人话；空值/缺失/查询失败都有明确文案。 */
function translate(raw, table) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '') return '--'
  if (value === DETAIL_QUERY_FAILED) return S.queryFailed
  return table[value] ?? value
}

/** @param {unknown} raw `detail.safety_mode` @returns {string} 中文安全模式 */
export const describeSafetyMode = (raw) => translate(raw, SAFETY_TEXT)
/** @param {unknown} raw `detail.robot_mode` @returns {string} 中文机器人模式 */
export const describeRobotMode = (raw) => translate(raw, ROBOT_MODE_TEXT)
/** @param {unknown} raw `detail.program_state` @returns {string} 中文程序状态 */
export const describeProgramState = (raw) => translate(raw, PROGRAM_STATE_TEXT)

/**
 * 安全模式是否"需要操作员立刻看一眼"。
 *
 * `NORMAL` / `REDUCED` 是正常运行态；**查询失败与未知值都算异常**（宁可多提醒一次，
 * 也不要因为固件换了个字符串就把一次保护性停止显示成正常）。
 * 没有 detail（还没问到）时返回 false —— 那是"未知"，不是"异常"。
 *
 * @param {unknown} raw `detail.safety_mode`
 * @returns {boolean}
 */
export function isSafetyHazard(raw) {
  if (typeof raw !== 'string') return false
  const value = raw.trim().toUpperCase()
  if (value === '') return false
  return value !== 'NORMAL' && value !== 'REDUCED'
}

/**
 * 速度倍率 → `x1.00`。宿主给的是 0–1 的比例（`model.SpeedScaling()`）。
 *
 * @param {unknown} raw `detail.speed_scaling`
 * @returns {string}
 */
export function formatSpeedScaling(raw) {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) return '--'
  return `x${value.toFixed(2)}`
}

/**
 * 六路关节量 → 紧凑一行（HUD 里的关节角/温度共用这个形状）。
 *
 * @param {unknown} values 六元数组
 * @param {string} label 行首标签
 * @param {number} [digits=0] 小数位
 * @param {string} [unit=''] 单位后缀
 * @returns {string}
 */
function formatJointRow(values, label, digits = 0, unit = '') {
  if (!Array.isArray(values) || values.length === 0) return `${label}  --`
  const parts = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    parts.push(`J${i + 1} ${Number.isFinite(v) ? v.toFixed(digits) + unit : '--'}`)
  }
  return `${label}  ${parts.join('  ')}`
}

/**
 * detail → HUD 几行文本（纯函数）。
 *
 * 返回的每一行都可能为空串（表示"这一项这次没有"），由调用方决定是否保留旧的 DOM 内容。
 *
 * @param {object|null|undefined} detail host 的 `body.detail`
 * @returns {{status: string, temps: string, power: string, hazard: boolean}}
 */
export function formatDetail(detail) {
  const d = detail && typeof detail === 'object' ? detail : null
  if (d === null || typeof d.error === 'string') {
    // detail 通道自己报错（host 把 dashboard 失败包成 `{error}`）：如实说，不冒充"没有异常"。
    return { status: d?.error ? S.detailStatusFailed(d.error) : '', temps: '', power: '', hazard: false }
  }
  const bits = [
    `安全 ${describeSafetyMode(d.safety_mode)}`,
    `模式 ${describeRobotMode(d.robot_mode)}`,
    `程序 ${describeProgramState(d.program_state)}`,
    `速度 ${formatSpeedScaling(d.speed_scaling)}`,
  ]
  if (d.running === true) bits.push(S.detailRunning)
  return {
    status: bits.join('  '),
    temps: formatJointRow(d.joint_temperatures, S.detailTempsPrefix),
    power: Number.isFinite(Number(d.robot_voltage)) && Number.isFinite(Number(d.robot_current))
      ? S.detailBus(Number(d.robot_voltage).toFixed(1), Number(d.robot_current).toFixed(2))
      : '',
    hazard: isSafetyHazard(d.safety_mode),
  }
}

/** 视图预设按钮（顺序即 UI 顺序；`reset` 是"对准当前模型"而不是某个固定方向）。 */
export const VIEW_BUTTONS = [
  { key: 'reset', label: S.viewReset },
  { key: 'iso', label: S.viewIso },
  { key: 'front', label: S.viewFront },
  { key: 'side', label: S.viewSide },
  { key: 'top', label: S.viewTop },
]

/**
 * 渲染滞后（毫秒）：**自校准**为"一个采样周期"，使渲染时刻恰好落在最近两个样本的时间窗内。
 *
 * 间隔用样本自己的 ts 差值度量 ⇒ 与轮询间隔无关（无需把 `baseMs` 传进来），
 * host 卡顿/丢帧导致间隔异常大时由 `RENDER_DELAY_MAX_MS` 兜底。
 * 间隔非法（≤0 / 非有限）时退化为 `RENDER_DELAY_MIN_MS`（不滞后）。
 *
 * @param {{q: number[], ts: number}} prev 前一个样本
 * @param {{q: number[], ts: number}} cur 当前样本
 * @returns {number} 滞后毫秒数，落在 [RENDER_DELAY_MIN_MS, RENDER_DELAY_MAX_MS]
 */
export function renderDelayMs(prev, cur) {
  const span = cur?.ts - prev?.ts
  if (!Number.isFinite(span)) return RENDER_DELAY_MIN_MS
  return Math.min(RENDER_DELAY_MAX_MS, Math.max(RENDER_DELAY_MIN_MS, span))
}

/* ------------------------------------------------------------------ *
 * 内部小工具
 * ------------------------------------------------------------------ */

/** 建一个带 class（可选 data 标记）的元素。 */
function makeEl(doc, tag, className, dataAttr) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  if (dataAttr) node.setAttribute(dataAttr, '')
  return node
}

/** 从场景摘掉一个对象（优先用场景的 remove；没有则退回父节点摘除）。 */
function detach(scene, obj) {
  if (!obj) return
  if (typeof scene?.remove === 'function') scene.remove(obj)
  else obj.parent?.remove?.(obj)
}

/* ------------------------------------------------------------------ *
 * 面板
 * ------------------------------------------------------------------ */

/**
 * 在 `container` 里挂载数字孪生大视图面板。
 *
 * @param {object} options
 * @param {HTMLElement} options.container 宿主容器（其 `ownerDocument` 决定用哪个文档）
 * @param {{getSnapshot: () => object, subscribe?: Function}} options.state 只读状态源（Task 6）
 * @param {(canvas: HTMLCanvasElement) => object} [options.sceneFactory=createScene] 场景工厂（注入点）
 * @param {(modelId: string) => Promise<object>} [options.modelLoader=loadRobotModel] 模型加载（注入点）
 * @param {(cb: Function) => number} [options.raf=globalThis.requestAnimationFrame] 帧调度（注入点）
 * @param {(id: number) => void} [options.caf=globalThis.cancelAnimationFrame] 帧取消（注入点）
 * @param {() => number} [options.now=() => performance.now()] 时钟（注入点）
 * @returns {{dispose: () => void}} 幂等的卸载句柄
 */
export function mountTwinPanel({
  container,
  state,
  sceneFactory = createScene,
  modelLoader = loadRobotModel,
  raf = globalThis.requestAnimationFrame,
  caf = globalThis.cancelAnimationFrame,
  now = () => performance.now(),
} = {}) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('mountTwinPanel: 需要一个可用的 container 元素')
  }
  const doc = container.ownerDocument ?? globalThis.document
  if (!doc || typeof doc.createElement !== 'function') {
    throw new TypeError('mountTwinPanel: 需要可用的 DOM（container.ownerDocument 或 globalThis.document）')
  }

  injectStyles(doc)

  /* ---------------- 可变状态 ---------------- */
  let disposed = false
  let frameId = null
  let sceneHandle = null
  let handle = null // Task 7 的模型句柄
  let requestedModelId = '' // 最近一次请求加载的型号（小写）
  let loadedModelId = '' // 已挂进场景的型号（小写）
  let loadToken = 0 // 型号重建的代次，避免旧加载覆盖新模型
  let trajectory = []
  let lastTrajectoryTs = 0
  let lastSnapshotTs = null // 已消费的快照 ts（判断"是否新采样"）
  /** 最近一笔快照（截图水印要用它读型号/IP/读数）。 */
  let lastSnapshot = null
  /** 轨迹是否暂停记录（清单第 18 条）——暂停只停止记录，不清空已有的线。 */
  let trajectoryPaused = false
  /** 多机器人候选的最近一次签名（清单第 19 条）——只在变化时重建 DOM。 */
  let lastRobotsSignature = null
  let prevSample = null
  let curSample = null
  let clock = null // 快照时间戳 → now() 时钟轴的锚点
  let wasConnected = false
  let lastHudMs = -Infinity
  /** 最近一次"尺寸还没量出来"的重试计数（见 ensureSized）。 */
  let pendingResize = false
  /** 3D 上下文是否已丢失（丢失后不再尝试渲染，只显示提示）。 */
  let contextLost = false
  /** 没有 WebGL 时置位：改用纯数值模式，不再尝试建场景。 */
  let sceneUnavailable = false
  /** 最近一次模型加载失败的原因（空串=没有失败）。 */
  let loadError = ''
  /** host 报告位姿载荷不完整（q 不足 6 维）。 */
  let snapDegraded = false
  /** detail 里的安全模式是否处于异常态（状态行据此在保护性停止时让位）。 */
  let snapHazard = false
  /**
   * 按需渲染的脏标记：只有"确实有新东西要画"时才调用 `render()`。
   *
   * 以前是**每帧无条件渲染**：机器人静止时画面完全没变也照画 60 fps；未连接时虽然 `step()`
   * 提前返回，循环末尾仍会渲染一帧空场景 —— 纯烧 GPU。现在帧循环照旧跑（成本只是一次函数
   * 调用），但 `render()` 只在 `dirty` 或插值窗口内发生。
   */
  let dirty = true
  /** 插值推进到此毫秒之前必须连续出帧（否则平滑会退化成阶梯）。 */
  let animatingUntil = -Infinity
  /** 页面是否在后台。隐藏时**彻底停帧**（见 onVisibility / pauseLoop）。 */
  let hidden = doc.hidden === true

  /* ---------------- DOM ---------------- */
  const root = makeEl(doc, 'div', 'ur-twin-panel', 'data-ur-twin-panel')
  root.setAttribute('data-ur-twin-connected', 'false')

  const view = makeEl(doc, 'div', 'ur-twin-view', 'data-ur-twin-view')
  const canvas = makeEl(doc, 'canvas', 'ur-twin-canvas', 'data-ur-twin-canvas')
  /*
   * 可访问性（清单第 16 条）：
   *
   * - canvas 对读屏软件完全不可见，所以给它 `role="img"` + `aria-label`，让"这里有一个
   *   3D 机器人视图"至少能被读出来；
   * - `tabindex="0"` 让它可聚焦 —— 只有能聚焦，下面的方向键才有意义；
   * - 方向键切视角预设（与工具栏同一套 `VIEW_PRESETS`）。这是纯键盘用户目前**唯一**能操作
   *   3D 的途径：OrbitControls 的旋转/缩放在鼠标之外没有等价键盘操作。
   */
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', S.canvasLabel)
  canvas.setAttribute('tabindex', '0')
  canvas.addEventListener('keydown', (event) => {
    const key = event?.key
    // 方向键映射到**工具栏已有的那套 key**（`iso`/`front`/`side`/`top` + 工具栏特殊处理的
    // `reset`）。⚠️ 别凭直觉造 key —— `VIEW_PRESETS` 里没有 `left`/`right`。
    const preset = key === 'ArrowUp' ? 'top'
      : key === 'ArrowDown' ? 'iso'
        : key === 'ArrowLeft' ? 'side'
          : key === 'ArrowRight' ? 'front'
            : key === 'Home' ? 'reset'
              : null
    if (preset === null) return
    event.preventDefault?.()
    applyView(preset)
  })
  view.appendChild(canvas)

  const hud = makeEl(doc, 'div', 'ur-twin-hud', 'data-ur-twin-hud')
  // HUD 是纯读数：`aria-live="polite"` 让关节角/TCP/状态的**变化**被播报，而不是每次都
  // 重读整块（`aria-atomic` 保持默认的 false）。
  hud.setAttribute('role', 'status')
  hud.setAttribute('aria-live', 'polite')
  hud.setAttribute('aria-label', S.hudLabel)
  // 多机器人选择（清单第 19 条）：host 在 2 台以上且未指定 ip 时返回歧义候选，这里给出切换入口。
  const hudRobots = makeEl(doc, 'div', 'ur-twin-hud-row', 'data-ur-twin-robots')
  // 待审批的运动目标（清单第 8 条）：审批弹窗说"要动了"，这里同步写出"要往哪动"。
  const hudPending = makeEl(doc, 'div', 'ur-twin-hud-row', 'data-ur-twin-pending')
  // 身份行放最上面：多机场景下"我在看哪一台"比任何读数都重要，而 `ip` 以前只被写进
  // `data-ur-twin-ip` 属性、界面上一个字都看不到。
  const hudIdentity = makeEl(doc, 'div', 'ur-twin-hud-row', 'data-ur-twin-identity')
  const hudJoints = makeEl(doc, 'div', 'ur-twin-hud-row', 'data-ur-twin-joints')
  const hudTcp = makeEl(doc, 'div', 'ur-twin-hud-row', 'data-ur-twin-tcp')
  // dashboard 侧状态（detail=1）：安全模式/机器人模式/程序状态/速度倍率一行，温度与母线一行。
  const hudDetail = makeEl(doc, 'div', 'ur-twin-hud-row', 'data-ur-twin-detail')
  const hudPower = makeEl(doc, 'div', 'ur-twin-hud-row', 'data-ur-twin-power')
  hud.appendChild(hudRobots)
  hud.appendChild(hudPending)
  hud.appendChild(hudIdentity)
  // 工程辅助图层的开关（清单第 9 条）。四个图层默认全关：一次全画出来会看不清真臂。
  //
  // 这里引用后面才定义的 `layers` 与 `invalidate` 是安全的：`layers` 只在**点击回调**里
  // 求值（那时早已初始化），`invalidate` 是函数声明、会提升。
  const hudLayers = makeEl(doc, 'div', 'ur-twin-hud-row', 'data-ur-twin-layers')
  // ⚠️ 这里**刻意不暴露"重心"图层**：`createCogMarker` 已经就绪，但插件目前**没有读回
  // 载荷的 op**（只有 `ur_set_payload*`，没有对应的 get），打开它只会得到一个点了没反应的
  // 死按钮 —— 那比没有更糟。等补上读回接口再接（见交接账本）。
  for (const [layerKey, layerLabel] of [
    ['reach', S.layerReach],
    ['base', S.layerBase],
    ['force', S.layerForce],
  ]) {
    const button = makeEl(doc, 'button', 'ur-twin-layer-toggle', `data-ur-twin-layer-${layerKey}`)
    button.type = 'button'
    button.textContent = layerLabel
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', () => {
      layers[layerKey] = !layers[layerKey]
      button.setAttribute('aria-pressed', layers[layerKey] ? 'true' : 'false')
      applyLayers()
      invalidate()
    })
    hudLayers.appendChild(button)
  }
  hud.appendChild(hudLayers)
  // 截图导出（清单第 17 条）：带型号/IP/时间的 PNG，现场报障用（不必再拿手机拍屏幕）。
  const shotButton = makeEl(doc, 'button', 'ur-twin-layer-toggle', 'data-ur-twin-screenshot')
  shotButton.type = 'button'
  shotButton.textContent = S.screenshot
  shotButton.setAttribute('aria-label', S.screenshotLabel)
  shotButton.addEventListener('click', () => {
    /*
     * ⚠️ 顺序很关键：WebGL canvas 的绘制缓冲默认不保留，**让出控制权之后可能已被清空**，
     * 那样导出的是全黑图。所以先**同步**渲染这一帧，再**同步**取图，中间不能 await。
     */
    renderFrame()
    const target = sceneHandle?.renderer?.domElement ?? canvas
    const dataUrl = captureTwinPng(target, lastSnapshot, { document: doc })
    if (dataUrl === null) return
    downloadDataUrl(dataUrl, screenshotFileName(lastSnapshot, new Date()), { document: doc })
  })
  hudLayers.appendChild(shotButton)

  /*
   * 轨迹操作（清单第 18 条）：清空 / 暂停 / 导出。
   *
   * 原先只有一条单色线，既不能清、不能停、也拿不出来 —— 现场想"把刚才那段轨迹带走"
   * 是做不到的。导出走 CSV（复用截图那条 `downloadDataUrl`），带位置**也带关节角**。
   */
  const trajectoryButton = (label, key, onClick) => {
    const button = makeEl(doc, 'button', 'ur-twin-layer-toggle', `data-ur-twin-trajectory-${key}`)
    button.type = 'button'
    button.textContent = label
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', () => {
      onClick(button)
      invalidate()
    })
    hudLayers.appendChild(button)
    return button
  }

  trajectoryButton(S.trajectoryClear, 'clear', () => {
    trajectory = []
    trajGeometry.setDrawRange(0, 0)
  })

  trajectoryButton(S.trajectoryPause, 'pause', (button) => {
    trajectoryPaused = !trajectoryPaused
    button.setAttribute('aria-pressed', trajectoryPaused ? 'true' : 'false')
    button.textContent = trajectoryPaused ? S.trajectoryResume : S.trajectoryPause
  })

  trajectoryButton(S.trajectoryExport, 'export', () => {
    const csv = trajectoryCsv(trajectory)
    const dataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
    downloadDataUrl(dataUrl, `ur-twin-trajectory-${screenshotFileName(lastSnapshot, new Date()).replace(/^ur-twin-|\.png$/gu, '')}.csv`, { document: doc })
  })
  hud.appendChild(hudJoints)
  hud.appendChild(hudTcp)
  hud.appendChild(hudDetail)
  hud.appendChild(hudPower)

  /*
   * 视角工具栏。
   *
   * 以前没有任何找回视角的办法：OrbitControls 允许把相机推远/缩进机械臂内部，而面板只有
   * 一个画布 —— 唯一的"重置"是收起面板再展开。`scene.js` 的注释还提到过一个"重置视角"，
   * 但那个控件在面板里从未存在。这里补上：`reset` 按当前模型重新取景，其余四个是固定方向。
   */
  const toolbar = makeEl(doc, 'div', 'ur-twin-toolbar', 'data-ur-twin-toolbar')
  for (const button of VIEW_BUTTONS) {
    // 属性名不能叫 `data-ur-twin-view` —— 视图容器本身就用着那个名字，查询会多命中一个容器。
    const el = makeEl(doc, 'button', 'ur-twin-toolbar-button', 'data-ur-twin-view-button')
    el.setAttribute('type', 'button')
    el.setAttribute('data-ur-twin-view-button', button.key)
    el.setAttribute('title', button.label)
    el.textContent = button.label
    el.addEventListener('click', () => applyView(button.key))
    toolbar.appendChild(el)
  }

  const status = makeEl(doc, 'div', 'ur-twin-status', 'data-ur-twin-status')
  const errorLine = makeEl(doc, 'div', 'ur-twin-error', 'data-ur-twin-error')

  root.appendChild(toolbar)
  root.appendChild(view)
  root.appendChild(hud)
  root.appendChild(status)
  root.appendChild(errorLine)
  container.appendChild(root)

  /* 未连接态：不显示空 3D（隐藏工具栏/视图/HUD，只留状态文案）。 */
  toolbar.style.display = 'none'
  view.style.display = 'none'
  hud.style.display = 'none'
  status.textContent = STATUS_DISCONNECTED

  /* ---------------- 3D 资源（预分配，不进循环重建） ---------------- */
  // 幽灵臂（清单第 7 条）：叠加显示"控制器打算去哪"的目标姿态。模型就绪后创建。
  let ghost = null
  /** 上一次用于算幽灵臂的目标关节角**引用** —— 只在变化时重算 FK（detail 是 1 Hz 通道）。 */
  let ghostTargetQ = null

  // 工程辅助图层（清单第 9 条）：可达范围包络、基座坐标系、TCP 受力箭头、负载重心标记。
  // **全部默认关闭** —— 一次全画出来画面会花到看不清真臂。
  //
  // 可达球按**单位半径**造一次，之后只改 `scale`：半径随型号变化时不需要重建几何体
  // （这个项目明令禁止在运行期反复创建几何体）。
  const reachSphere = createReachSphere(1)
  const baseAxes = createTcpAxes(TCP_AXES_SIZE)
  baseAxes.name = 'ur-twin-base-axes'
  const cogMarker = createCogMarker()
  const forceArrow = createForceArrow(null)
  const layers = { reach: false, base: false, force: false, cog: false }

  /** 把 `layers` 的状态同步到场景对象上。 */
  function applyLayers() {
    reachSphere.visible = layers.reach
    baseAxes.visible = layers.base
    forceArrow.visible = false // 由 updateForceArrow 按力的大小决定
    cogMarker.visible = layers.cog
  }
  applyLayers()

  // 带 X/Y/Z 字母标签的 TCP 坐标轴（清单第 6 条）：轴长在每次取景后按模型半径自适应。
  const tcpAxes = createTcpAxes(TCP_AXES_SIZE)
  tcpAxes.matrixAutoUpdate = false // 每帧由 tool0 直接写 matrix

  const trajGeometry = new BufferGeometry()
  // 预分配固定容量：一次分配，逐帧只覆写数据（Ruling：不得每帧重建 geometry）。
  const trajPosition = new Float32BufferAttribute(new Float32Array(TRAJECTORY_CAPACITY * 3), 3)
  trajPosition.setUsage(DynamicDrawUsage)
  trajGeometry.setAttribute('position', trajPosition)
  // 顶点颜色（清单第 18 条）：单色线看不出方向与相对速度，按样本新旧渐变就能同时表达两者。
  const trajColor = new Float32BufferAttribute(new Float32Array(TRAJECTORY_CAPACITY * 3), 3)
  trajColor.setUsage(DynamicDrawUsage)
  trajGeometry.setAttribute('color', trajColor)
  trajGeometry.setDrawRange(0, 0)
  const trajArray = trajPosition.array
  const trajColorArray = trajColor.array

  const trajLine = new Line(trajGeometry, new LineBasicMaterial({ color: 0x35d0ff, vertexColors: true }))
  trajLine.name = 'ur-twin-trajectory'
  trajLine.frustumCulled = false // 逐帧改写顶点，包围球会过期；关掉剔除免得整条线消失

  /* ---------------- 尺寸监听（必须可摘除） ---------------- */
  const win = doc.defaultView ?? (typeof globalThis.addEventListener === 'function' ? globalThis : null)
  const onResize = () => resize()
  win?.addEventListener?.('resize', onResize)

  /*
   * 侧栏是**用户可拖动改宽**的，而 `window.resize` 只在窗口尺寸变化时触发 —— 拖动侧栏
   * 不会触发它，于是画布会被 CSS 拉伸（画面变形/发虚）直到下次窗口变化。
   * `ResizeObserver` 能在容器尺寸变化时立刻回调；环境没有它就退回窗口监听 + 每帧重试。
   */
  let resizeObserver = null
  const ResizeObserverImpl = doc.defaultView?.ResizeObserver ?? globalThis.ResizeObserver
  if (typeof ResizeObserverImpl === 'function') {
    try {
      resizeObserver = new ResizeObserverImpl(() => resize())
      resizeObserver.observe(container)
    } catch {
      resizeObserver = null
    }
  }

  /* ---------------- 状态文案 ---------------- */
  function setStatus(text) {
    status.textContent = text
  }

  function refreshStatus() {
    if (contextLost) {
      setStatus(STATUS_CONTEXT_LOST)
      return
    }
    if (!wasConnected) {
      // host 的失败原因（含机器可读 code）必须显示出来：以前四种完全不同的故障
      // （worker 挂了 / 没连机器人 / 多台机器人有歧义 / 读取失败）都渲染成同一句
      // 「未连接机器人」，用户没有任何可操作信息。
      const snap = state?.getSnapshot?.() ?? {}
      setStatus(describeDisconnected(snap.code, snap.error, snap.ips))
      return
    }
    if (snapDegraded) {
      setStatus(`${STATUS_CONNECTED} · ${STATUS_INCOMPLETE}`)
      return
    }
    // 安全状态**压过**一切常规文案：以前机器人处于保护性停止时，状态行照样写着
    // 「已连接 · ur5e」，界面看上去一切正常 —— 而这正是最该被一眼看到的情况。
    const safetyRaw = state?.getSnapshot?.()?.detail?.safety_mode
    if (isSafetyHazard(safetyRaw)) {
      setStatus(`${describeSafetyMode(safetyRaw)} · ${STATUS_SAFETY_HINT}`)
      return
    }
    if (sceneUnavailable) {
      setStatus(STATUS_NO_WEBGL)
      return
    }
    if (loadError !== '') {
      setStatus(`${STATUS_CONNECTED} · ${STATUS_LOAD_FAILED}${loadError}`)
      return
    }
    if (!handle) {
      setStatus(STATUS_LOADING)
      return
    }
    setStatus(
      handle.usedFallback
        ? `${STATUS_CONNECTED} · ${loadedModelId}${STATUS_FALLBACK_SUFFIX}`
        : `${STATUS_CONNECTED} · ${loadedModelId}`,
    )
  }

  /* ---------------- 场景（懒创建：未连接不建空 3D） ---------------- */
  function ensureScene() {
    if (sceneHandle || sceneUnavailable) return sceneHandle
    try {
      sceneHandle = sceneFactory(canvas) ?? {}
    } catch (e) {
      // 没有 WebGL（或在构造中抛错）时**不能**让异常变成未处理的 promise rejection：
      // 那样 `handle` 永远是 null，状态行会永久停在「正在加载模型…」而画布一片空白。
      // 改成降级为纯数值模式（HUD 仍然更新）。
      sceneUnavailable = true
      sceneHandle = null
      loadError = e instanceof Error ? e.message : String(e)
      refreshStatus()
      return null
    }
    sceneHandle.scene?.add?.(tcpAxes)
    sceneHandle.scene?.add?.(trajLine)
    sceneHandle.scene?.add?.(reachSphere)
    sceneHandle.scene?.add?.(baseAxes)
    sceneHandle.scene?.add?.(cogMarker)
    sceneHandle.scene?.add?.(forceArrow)
    // 相机被拖动（含阻尼收敛）时也要重画：按需渲染下缺这个回调，画面会停在上一帧。
    sceneHandle.onCameraChange?.(() => invalidate())
    watchContextLoss()
    ensureSized()
    return sceneHandle
  }

  /** 把 canvas 的 CSS 尺寸告诉渲染器；量到 0 就先记为待处理，下一帧继续试。 */
  function ensureSized() {
    if (!sceneHandle || contextLost) return
    let ok = false
    try {
      ok = sceneHandle.resize?.() !== false
    } catch {
      ok = false
    }
    pendingResize = !ok
  }

  /**
   * 监听 WebGL 上下文丢失/恢复。
   *
   * 没有这个监听时，GPU 重置（驱动更新、显存回收、标签长时间后台）之后画布会永久变黑，
   * 而状态行仍显示「已连接」——用户完全看不出发生了什么。这里至少如实说明，并允许
   * 恢复事件到达后继续渲染。
   */
  function watchContextLoss() {
    const target = sceneHandle?.renderer?.domElement ?? canvas
    if (!target?.addEventListener) return
    target.addEventListener('webglcontextlost', (event) => {
      event?.preventDefault?.()
      contextLost = true
      refreshStatus()
    })
    target.addEventListener('webglcontextrestored', () => {
      contextLost = false
      ensureSized()
      refreshStatus()
    })
  }

  function resize() {
    ensureSized()
  }

  function renderFrame() {
    sceneHandle?.render?.()
  }

  /** 标脏：下一帧确实要画。 */
  function invalidate() {
    dirty = true
  }

  /**
   * 应用一个视角按钮。
   *
   * `reset` = 按**当前模型**重新取景（换了大臂之后"贴脸"就是靠这一步修正）；
   * 其余四个只改相机方向、沿用上一次的取景中心与半径，所以来回切换不会越切越偏。
   * 场景还没建好（未连接 / 无 WebGL）时静默忽略 —— 此时工具栏本来就隐藏着。
   */
  function applyView(key) {
    if (key === 'reset') sceneHandle?.fitTo?.(handle?.root)
    else sceneHandle?.setViewPreset?.(key)
    invalidate()
  }

  /** 停帧：取消已排队的那一帧，并且不再续排（后台标签、卸载都走这里）。 */
  function pauseLoop() {
    if (frameId !== null) {
      caf?.(frameId)
      frameId = null
    }
  }

  /** 恢复帧循环（回到前台、或首次启动）。已经排着帧时是空操作。 */
  function wake() {
    if (disposed || hidden || frameId !== null) return
    frameId = raf(frame)
  }

  /** 后台标签彻底停帧；回到前台再续上。 */
  const onVisibility = () => {
    hidden = doc.hidden === true
    if (hidden) pauseLoop()
    else {
      invalidate()
      wake()
    }
  }
  // 注册点必须在 `onVisibility` 初始化之后（同一作用域里提前读 const 会命中 TDZ）。
  win?.addEventListener?.('visibilitychange', onVisibility)

  /* ---------------- 连接态切换 ---------------- */
  function applyConnection(connected) {
    if (connected !== wasConnected) {
      wasConnected = connected
      root.setAttribute('data-ur-twin-connected', connected ? 'true' : 'false')
      view.style.display = connected ? '' : 'none'
      hud.style.display = connected ? '' : 'none'
      toolbar.style.display = connected ? '' : 'none'
      if (!connected) {
        // 断连：丢弃插值对与轨迹，避免重连后画出跨越断层的直线/错误插值。
        prevSample = null
        curSample = null
        clock = null
        lastSnapshotTs = null
        trajectory = []
        lastTrajectoryTs = 0
        trajGeometry.setDrawRange(0, 0)
        hudIdentity.textContent = ''
        hudPending.textContent = ''
        hudJoints.textContent = ''
        hudJoints.setAttribute('data-ur-twin-overlimit', 'false')
        hudTcp.textContent = ''
        hudDetail.textContent = ''
        hudPower.textContent = ''
        root.setAttribute('data-ur-twin-hazard', 'false')
        lastHudMs = -Infinity
      }
      invalidate()
      resize()
      refreshStatus()
    } else if (!connected) {
      // 一直是未连接：host 的**失败原因可能变了**（例如从"还没有连过机器人"变成
      // "worker 进程挂了"）。状态行必须跟着变，否则用户看到的永远是第一次那句。
      refreshStatus()
    }
  }

  /* ---------------- 模型加载（型号变化 → 重建） ---------------- */
  async function loadModel(rawModel) {
    const token = ++loadToken
    let next = null
    try {
      // 把该型号的真实连杆长度一并传下去：GLB 加载失败时回退臂会用它们建几何体，
      // 否则未知型号会退化成 UR3 量级（清单第 14 条）。
      next = await modelLoader(rawModel, {
        armLinks: linkLengthsFromKinematics(resolveKinematics(rawModel)?.links) ?? undefined,
      })
    } catch (e) {
      if (!disposed && token === loadToken) {
        loadError = e instanceof Error ? e.message : String(e)
        refreshStatus()
      }
      return
    }
    if (!next) return
    // 面板已卸载 / 型号又被换掉：把这次拿到的模型直接释放，避免泄漏。
    if (disposed || token !== loadToken) {
      next.dispose?.()
      return
    }

    loadError = ''
    const scene = ensureScene()?.scene
    scene?.add?.(next.root) // ★ 只 add root：7 个装配组已挂在 root 下（Task 7 assemble）
    if (handle) {
      detach(scene, handle.root)
      handle.dispose?.()
    }
    handle = next
    // 幽灵臂：克隆真臂的装配结构（浅拷 —— geometry 与真臂共享，多一层几乎不占显存），
    // 换一层半透明材质。目标姿态只在 detail 通道里来，所以默认隐藏。
    disposeGhostArm(ghost)
    ghost = null
    ghostTargetQ = null
    try {
      ghost = createGhostArm(handle)
      scene?.add?.(ghost.root)
    } catch {
      // 克隆失败只是少一层叠加显示，绝不能因此让模型加载失败。
      ghost = null
    }
    loadedModelId = String(rawModel).trim().toLowerCase()
    // 换装即重新取景：内置型号的链路长度从 UR3（≈0.94 m）到 UR20（≈2.4 m）相差 2.6 倍，
    // 固定相机与固定网格必然对其中一端是错的（"换个大臂就贴脸"就是这么来的）。
    sceneHandle?.fitTo?.(handle?.root)
    // 取景完成后才知道模型有多大：把轴长按半径缩放，否则 UR3 上偏大、UR30 上偏小。
    updateTcpAxesSize(tcpAxes, tcpAxesSizeFor(sceneHandle?.currentFitRadius?.()))
    // 可达范围包络：半径只取决于型号（与姿态无关），所以换装时更新一次即可。
    // 球体几何恒为**单位半径**，这里只改 scale —— 不重建几何体。
    const reach = reachRadiusFromKinematics(resolveKinematics(loadedModelId)?.links)
    if (reach !== null) reachSphere.scale.setScalar(reach)
    dirty = true
    refreshStatus()
  }

  /* ---------------- 时间轴锚定 ---------------- */
  function resolveSampleTime(hostTs, nowMs) {
    if (!Number.isFinite(hostTs)) return { ts: nowMs, reset: false }
    if (clock === null || hostTs < clock.hostTs) {
      // 首次 / 宿主时间倒退（重连、host 重启）→ 重新锚定；跨断层的插值对作废。
      clock = { hostTs, localTs: nowMs }
      return { ts: nowMs, reset: true }
    }
    return { ts: clock.localTs + (hostTs - clock.hostTs), reset: false }
  }

  /* ---------------- 轨迹 ---------------- */
  function pushTrajectorySample(snap) {
    // 暂停时只停止**记录**，不清空已有的线：现场常要"停下动作、保留刚才那段"。
    if (trajectoryPaused) return
    const tcp = snap?.tcp
    if (!Array.isArray(tcp) || tcp.length < 3 || !Number.isFinite(tcp[0])) return
    const ts = Number.isFinite(snap.ts) ? snap.ts : lastTrajectoryTs + 1
    lastTrajectoryTs = ts
    // 除了位置也记**关节角**（清单第 18 条）：只记 TCP 的话，导出的数据无法复现姿态。
    const q = Array.isArray(snap?.q) && snap.q.length >= 6 ? [...snap.q] : undefined
    trajectory = pushSample(
      trajectory,
      { tcp: [tcp[0], tcp[1], tcp[2]], ts, ...(q === undefined ? {} : { q }) },
      TRAJECTORY_MAX_AGE_MS,
    )
    if (trajectory.length > TRAJECTORY_CAPACITY) {
      trajectory = trajectory.slice(trajectory.length - TRAJECTORY_CAPACITY)
    }
  }

  /** 把轨迹缓冲写进**已预分配**的 position/color 属性（覆写 + drawRange，零重建）。 */
  function drawTrajectory() {
    const points = trajectoryPoints(trajectory)
    const count = Math.min(points.length, TRAJECTORY_CAPACITY)
    const start = points.length - count
    // 颜色要按**同一段**尾部样本算新旧比例，否则画出来的渐变与线的起点对不上。
    const colors = trajectoryColors(trajectory.slice(start))
    for (let i = 0; i < count; i++) {
      const p = points[start + i]
      trajArray[i * 3] = p[0]
      trajArray[i * 3 + 1] = p[1]
      trajArray[i * 3 + 2] = p[2]
      const c = colors[i] ?? [1, 1, 1]
      trajColorArray[i * 3] = c[0]
      trajColorArray[i * 3 + 1] = c[1]
      trajColorArray[i * 3 + 2] = c[2]
    }
    trajPosition.needsUpdate = true
    trajColor.needsUpdate = true
    trajGeometry.setDrawRange(0, count)
  }

  /* ---------------- 数值面板（节流 ~10 Hz） ---------------- */
  /** 优先用控制器报的 TCP；没有时才退回 FK 的 tool0 位置（姿态填 0，并靠 title 说明）。 */
  function tcpForHud(snap, fkResult) {
    const tcp = snap?.tcp
    if (Array.isArray(tcp) && tcp.length >= 3) return tcp
    const m = fkResult?.tool0
    return Array.isArray(m) ? [m[12], m[13], m[14], 0, 0, 0] : null
  }

  /**
   * 写数值面板。
   *
   * `joints` 必须是**测量值**（host 报出的那一笔），不是插值值 —— 插值只服务于网格的观感，
   * 工程读数不能是"算出来的中间态"。
   */
  function writeHud(nowMs, snap, joints, fkResult) {
    if (!(nowMs - lastHudMs >= HUD_INTERVAL_MS)) return
    lastHudMs = nowMs
    // 身份行：机型 + 机器人 IP。IP 以前只落在属性上，界面上看不到。
    const identity = [snap?.model ?? loadedModelId, snap?.ip].filter(v => typeof v === 'string' && v !== '')
    hudIdentity.textContent = identity.length === 0 ? '' : S.identity(snap?.model ?? loadedModelId, snap?.ip)
    hudIdentity.setAttribute('title', hudIdentity.textContent)
    // 多机器人选择（清单第 19 条）：候选或当前目标变了才重建 DOM（这不是热路径，
    // 但每帧重建按钮会让点击落空 —— 手指还没抬起来按钮就被换掉了）。
    const candidates = Array.isArray(snap?.ips)
      ? snap.ips.filter((value) => typeof value === 'string' && value !== '')
      : []
    const resolvedIp = typeof snap?.ip === 'string' ? snap.ip : ''
    const robotsSignature = `${resolvedIp}|${candidates.join(',')}`
    if (robotsSignature !== lastRobotsSignature) {
      lastRobotsSignature = robotsSignature
      hudRobots.textContent = ''
      for (const candidate of candidates) {
        const button = makeEl(doc, 'button', 'ur-twin-layer-toggle', 'data-ur-twin-robot')
        button.type = 'button'
        button.textContent = candidate
        button.setAttribute('aria-pressed', candidate === resolvedIp ? 'true' : 'false')
        button.addEventListener('click', () => { state?.setIp?.(candidate) })
        hudRobots.appendChild(button)
      }
    }
    // 待审批目标：审批进行中才有内容，结束后 host 不再返回该字段、这里自然清空。
    const pendingSummary = typeof snap?.pendingMotion?.summary === 'string' ? snap.pendingMotion.summary : ''
    hudPending.textContent = pendingSummary === '' ? '' : `${S.pendingPrefix}  ${pendingSummary}`
    hudPending.setAttribute('title', hudPending.textContent)
    // 关节角：同时标出**超出限位**的关节（限位表来自 kinematics.json，此前从未被用过）。
    const over = overLimitJoints(joints, fkResult?.jointLimits)
    hudJoints.textContent = over.length === 0
      ? formatJoints(joints)
      : `${formatJoints(joints)}  ${S.overLimit(`J${over.join('/J')}`)}`
    hudJoints.setAttribute('data-ur-twin-overlimit', over.length === 0 ? 'false' : 'true')
    // 关节行在窄侧栏里会被省略号截断；把完整值放到 title 上，鼠标悬停即可读到 J5/J6。
    hudJoints.setAttribute('title', hudJoints.textContent)
    // TCP 行优先用控制器报的 TCP；拿不到时才退回 FK 的 tool0 位置（并标注是推算值）。
    const tcp = tcpForHud(snap, fkResult)
    hudTcp.textContent = tcp ? formatTcp(tcp) : 'TCP  --'
    hudTcp.setAttribute('title', hudTcp.textContent)
    // dashboard 侧状态（detail=1 的慢节拍）：安全模式/机器人模式/程序状态/速度倍率一行，
    // 关节温度与母线电压电流一行。`hazard` 同时写到面板根节点上，供 CSS 把状态行染红。
    const detail = formatDetail(snap?.detail)
    hudDetail.textContent = detail.status
    hudDetail.setAttribute('title', detail.status)
    hudDetail.setAttribute('data-ur-twin-hazard', detail.hazard ? 'true' : 'false')
    const power = [detail.temps, detail.power].filter(Boolean).join('   ')
    hudPower.textContent = power
    hudPower.setAttribute('title', power)
    root.setAttribute('data-ur-twin-hazard', detail.hazard ? 'true' : 'false')
    if (snap?.ip) root.setAttribute('data-ur-twin-ip', String(snap.ip))
  }

  /* ---------------- 单帧 ---------------- */
  function step(nowMs) {
    const snap = state?.getSnapshot?.() ?? {}
    const connected = snap.connected === true
    const wasDegraded = snapDegraded
    snapDegraded = snap.degraded === true
    applyConnection(connected)
    if (!connected) return
    if (wasDegraded !== snapDegraded) refreshStatus()

    // 安全模式只在 detail 通道（慢节拍）变化，连接态本身没变 —— 但它必须能改写状态行，
    // 否则一次保护性停止要等到下次断连/重连才会显示出来。
    const hazard = isSafetyHazard(snap?.detail?.safety_mode)
    if (hazard !== snapHazard) {
      snapHazard = hazard
      refreshStatus()
    }

    // 型号：首次或变化 → （重新）加载。
    const rawModel = String(snap.model ?? '').trim()
    const wantModelId = rawModel.toLowerCase()
    if (wantModelId !== '' && wantModelId !== requestedModelId) {
      requestedModelId = wantModelId
      void loadModel(rawModel)
    }

    const kin = resolveKinematics(loadedModelId || wantModelId)
    const joints = Array.isArray(snap.q) && snap.q.length >= 6 ? snap.q : null
    let fkResult = null

    if (kin && joints) {
      const sampled = resolveSampleTime(snap.ts, nowMs)
      if (sampled.reset) {
        prevSample = null
        curSample = null
      }
      // 只在"确实换了采样"时推进插值对（同一样本被重复读到不重复入队）。
      const finiteTs = Number.isFinite(snap.ts)
      // 截图水印要读最近一笔快照（型号/IP/读数/安全模式）。
    lastSnapshot = snap
    const isNewSample = !finiteTs || snap.ts !== lastSnapshotTs || curSample === null
      if (finiteTs) lastSnapshotTs = snap.ts
      if (isNewSample) {
        prevSample = curSample
        curSample = { q: joints.slice(), ts: sampled.ts }
        // ⚠️ 轨迹样本**只在新采样时**入队。以前这行每帧都跑（60 fps），而采样只有 10 Hz
        // ⇒ 同一个 ts 被重复压入约 6 次，600 点的容量实际只装下 ~100 个真样本（约 10 s，
        // 而不是注释里说的 60 s），并且每帧都要重建 ~600 个数组（持续 GC 抖动）。
        pushTrajectorySample(snap)
        dirty = true
        // 插值要在 `nowMs - delay` 走过 [prev, cur] 这段时间内连续出帧；多留 64 ms（≈4 帧）
        // 吸收调度抖动，否则最后一次插值会被按需渲染跳过、画面退化成阶梯。
        animatingUntil = nowMs + renderDelayMs(prevSample, curSample) + 64
      }

      // 渲染滞后一个采样周期（自校准）：只有一个样本时不插值，直接呈现该样本。
      const smooth = prevSample
        ? interpolateAt(prevSample, curSample, nowMs - renderDelayMs(prevSample, curSample))
        : curSample.q.slice()
      fkResult = fkChain(kin, smooth)

      // 姿态：只在模型就绪时写（applyFK 不产生 GPU 资源，无需暂存）。
      handle?.applyFK?.(fkResult)

      // 幽灵臂：把"控制器打算去哪"画出来，与上面的**实际**姿态叠加 —— 跟随误差、滞后与
      // 交融过程一眼可见。
      //
      // 目标姿态来自 detail 慢通道（1 Hz 级）而这里是 60 fps，所以只在**引用变化**时重算
      // FK：省掉 59/60 的无效计算，同时画面稳定停在最近一次收到的目标上。
      if (ghost) {
        // 可画的关节角有两个来源：**待审批**目标优先（它是"即将发生的事"，比当前目标
        // 更该被看见），其次是控制器当前的目标。
        const pending = snap?.pendingMotion
        const pendingQ = pending?.kind === 'joints' ? pending.q : null
        const liveQ = snap?.detail?.target_q
        // 数值防御：非有限的关节角会让 fkChain 产出坏矩阵，画出来是扭曲的假臂 ——
        // 那比不画更误导。
        const usable = (q) => Array.isArray(q) && q.length === 6 && q.every(Number.isFinite)
        const chosen = usable(pendingQ) ? pendingQ : (usable(liveQ) ? liveQ : null)
        if (chosen === null) {
          ghostTargetQ = null
          // 没有可画的目标就不显示：露出一层静止的假臂比不显示更误导。
          ghost.setVisible(false)
        } else {
          if (chosen !== ghostTargetQ) {
            ghostTargetQ = chosen
            ghost.applyFK(fkChain(kin, chosen))
          }
          // 橙色 = 还没批准、将要发生；青色 = 控制器当前的目标。
          ghost.setPending(usable(pendingQ))
          ghost.setVisible(true)
        }
      }

      // TCP 坐标系 gizmo：贴到 tool0（第六关节之后的累积变换）。
      if (Array.isArray(fkResult.tool0)) {
        tcpAxes.matrix.fromArray(fkResult.tool0)
        tcpAxes.matrixWorldNeedsUpdate = true
        // TCP 受力箭头（清单第 9 条）：贴在 TCP 位置，方向按**世界系**受力方向 ——
        // 刻意不继承 TCP 的旋转，因为力是环境施加的，不是工具坐标系里的量。
        forceArrow.position.set(
          tcpAxes.matrix.elements[12],
          tcpAxes.matrix.elements[13],
          tcpAxes.matrix.elements[14],
        )
        if (layers.force) updateForceArrow(forceArrow, snap?.detail?.tcp_force)
        else forceArrow.visible = false
      }

      drawTrajectory()
      // HUD 用**测量值**而不是插值值：插值是为了让网格看起来连续，而工程读数必须是
      // 控制器真实报出的那一笔（两者可能相差一个采样周期 + 渲染滞后）。
      writeHud(nowMs, snap, joints, fkResult)
    }

    // 画布尺寸：面板刚展开时 flex 高度可能还没算出来（量到 0×0），必须每帧重试，
    // 否则那一帧之后 canvas 会一直用默认后备缓冲被 CSS 拉伸（糊成一片）。
    if (pendingResize) ensureSized()

    // 按需渲染：只有"确实有新东西"（新采样/尺寸变化/模型换装/相机被动过）或插值窗口尚未
    // 走完时才真的画。未连接时 `step()` 早已提前返回，这里也不会再画空场景。
    if (dirty || nowMs < animatingUntil) {
      renderFrame()
      dirty = false
    }
  }

  function frame() {
    // `hidden` 也要挡：`caf` 只是"请求取消"，浏览器可能已经把这一帧排好队了
    // （测试里的假 caf 更是不删队列），所以面板必须自己守住"后台不出帧"。
    if (disposed || hidden) return
    try {
      step(now())
      if (errorLine.textContent !== '') errorLine.textContent = ''
    } catch (e) {
      // 单帧异常不得打死循环，也不得静默：写到错误行上（下一帧成功会自动清掉）。
      errorLine.textContent = `${STATUS_ERROR_PREFIX}${e instanceof Error ? e.message : String(e)}`
    } finally {
      // 后台标签不再续帧（回到前台由 `onVisibility` → `wake()` 重新起链）。
      if (disposed || hidden) frameId = null
      else frameId = raf(frame)
    }
  }

  wake()

  /* ---------------- 卸载（幂等） ---------------- */
  function dispose() {
    if (disposed) return
    disposed = true

    if (frameId !== null) {
      caf?.(frameId)
      frameId = null
    }
    win?.removeEventListener?.('resize', onResize)
    win?.removeEventListener?.('visibilitychange', onVisibility)
    resizeObserver?.disconnect?.()
    resizeObserver = null

    const scene = sceneHandle?.scene
    if (handle) {
      detach(scene, handle.root)
      handle.dispose?.()
      handle = null
    }
    detach(scene, tcpAxes)
    detach(scene, trajLine)
    disposeGhostArm(ghost)
    ghost = null
    for (const overlay of [reachSphere, baseAxes, cogMarker, forceArrow]) disposeOverlay(overlay)
    sceneHandle?.dispose?.()

    disposeTcpAxes(tcpAxes)
    trajGeometry.dispose()
    trajLine.material?.dispose?.()

    trajectory = []
    prevSample = null
    curSample = null
    clock = null
    sceneHandle = null

    // 清空宿主容器（样式 `<style>` 是共享资源，故意保留）。
    if (root.parentNode === container) container.removeChild(root)
    else root.remove?.()
    while (root.firstChild) root.removeChild(root.firstChild)
  }

  return { dispose }
}

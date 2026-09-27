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
  AxesHelper,
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
} from 'three'

import kinematicsJson from '../../assets/kinematics.json' with { type: 'json' }

import { createScene } from './robot/scene.js'
import { loadRobotModel } from './robot/loader.js'
import { fkChain } from './robot/fk.js'
import { interpolateAt } from './robot/interpolate.js'
import { pushSample, trajectoryPoints } from './robot/trajectory.js'
import { injectStyles } from './styles.js'

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
export const TCP_AXES_SIZE = 0.08

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
      return '未连接机器人：还没有成功执行过 ur_connect'
    case 'robot_not_connected':
      return `机器人未连接${reason ? `：${reason}` : ''}`
    case 'ambiguous_robot':
      return `检测到多台已连接机器人，请指定机器人 IP${
        Array.isArray(ips) && ips.length > 0 ? `（候选：${ips.join('、')}）` : ''
      }`
    case 'worker_unavailable':
      return `UR 控制进程不可用${reason ? `：${reason}` : ''}（可运行 ur_ping 自检 Python 依赖）`
    case 'robot_error':
      return `读取机器人状态失败${reason ? `：${reason}` : ''}`
    default:
      return reason ? `未连接机器人：${reason}` : STATUS_DISCONNECTED
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
  return `关节角 (°)  ${parts.join('  ')}`
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
  return `TCP(米/轴角弧度)  ${parts.join('  ')}`
}

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

  /* ---------------- DOM ---------------- */
  const root = makeEl(doc, 'div', 'ur-twin-panel', 'data-ur-twin-panel')
  root.setAttribute('data-ur-twin-connected', 'false')

  const view = makeEl(doc, 'div', 'ur-twin-view', 'data-ur-twin-view')
  const canvas = makeEl(doc, 'canvas', 'ur-twin-canvas', 'data-ur-twin-canvas')
  view.appendChild(canvas)

  const hud = makeEl(doc, 'div', 'ur-twin-hud', 'data-ur-twin-hud')
  const hudJoints = makeEl(doc, 'div', 'ur-twin-hud-row', 'data-ur-twin-joints')
  const hudTcp = makeEl(doc, 'div', 'ur-twin-hud-row', 'data-ur-twin-tcp')
  hud.appendChild(hudJoints)
  hud.appendChild(hudTcp)

  const status = makeEl(doc, 'div', 'ur-twin-status', 'data-ur-twin-status')
  const errorLine = makeEl(doc, 'div', 'ur-twin-error', 'data-ur-twin-error')

  root.appendChild(view)
  root.appendChild(hud)
  root.appendChild(status)
  root.appendChild(errorLine)
  container.appendChild(root)

  /* 未连接态：不显示空 3D（隐藏视图与 HUD，只留状态文案）。 */
  view.style.display = 'none'
  hud.style.display = 'none'
  status.textContent = STATUS_DISCONNECTED

  /* ---------------- 3D 资源（预分配，不进循环重建） ---------------- */
  const tcpAxes = new AxesHelper(TCP_AXES_SIZE)
  tcpAxes.name = 'ur-twin-tcp-axes'
  tcpAxes.matrixAutoUpdate = false // 每帧由 tool0 直接写 matrix

  const trajGeometry = new BufferGeometry()
  // 预分配固定容量：一次分配，逐帧只覆写数据（Ruling：不得每帧重建 geometry）。
  const trajPosition = new Float32BufferAttribute(new Float32Array(TRAJECTORY_CAPACITY * 3), 3)
  trajPosition.setUsage(DynamicDrawUsage)
  trajGeometry.setAttribute('position', trajPosition)
  trajGeometry.setDrawRange(0, 0)
  const trajArray = trajPosition.array

  const trajLine = new Line(trajGeometry, new LineBasicMaterial({ color: 0x35d0ff }))
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

  /* ---------------- 连接态切换 ---------------- */
  function applyConnection(connected) {
    if (connected !== wasConnected) {
      wasConnected = connected
      root.setAttribute('data-ur-twin-connected', connected ? 'true' : 'false')
      view.style.display = connected ? '' : 'none'
      hud.style.display = connected ? '' : 'none'
      if (!connected) {
        // 断连：丢弃插值对与轨迹，避免重连后画出跨越断层的直线/错误插值。
        prevSample = null
        curSample = null
        clock = null
        lastSnapshotTs = null
        trajectory = []
        lastTrajectoryTs = 0
        trajGeometry.setDrawRange(0, 0)
        hudJoints.textContent = ''
        hudTcp.textContent = ''
        lastHudMs = -Infinity
      }
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
      next = await modelLoader(rawModel)
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
    loadedModelId = String(rawModel).trim().toLowerCase()
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
    const tcp = snap?.tcp
    if (!Array.isArray(tcp) || tcp.length < 3 || !Number.isFinite(tcp[0])) return
    const ts = Number.isFinite(snap.ts) ? snap.ts : lastTrajectoryTs + 1
    lastTrajectoryTs = ts
    trajectory = pushSample(trajectory, { tcp: [tcp[0], tcp[1], tcp[2]], ts }, TRAJECTORY_MAX_AGE_MS)
    if (trajectory.length > TRAJECTORY_CAPACITY) {
      trajectory = trajectory.slice(trajectory.length - TRAJECTORY_CAPACITY)
    }
  }

  /** 把轨迹缓冲写进**已预分配**的 position 属性（覆写 + drawRange，零重建）。 */
  function drawTrajectory() {
    const points = trajectoryPoints(trajectory)
    const count = Math.min(points.length, TRAJECTORY_CAPACITY)
    const start = points.length - count
    for (let i = 0; i < count; i++) {
      const p = points[start + i]
      trajArray[i * 3] = p[0]
      trajArray[i * 3 + 1] = p[1]
      trajArray[i * 3 + 2] = p[2]
    }
    trajPosition.needsUpdate = true
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
    hudJoints.textContent = formatJoints(joints)
    // 关节行在窄侧栏里会被省略号截断；把完整值放到 title 上，鼠标悬停即可读到 J5/J6。
    hudJoints.setAttribute('title', hudJoints.textContent)
    // TCP 行优先用控制器报的 TCP；拿不到时才退回 FK 的 tool0 位置（并标注是推算值）。
    const tcp = tcpForHud(snap, fkResult)
    hudTcp.textContent = tcp ? formatTcp(tcp) : 'TCP  --'
    hudTcp.setAttribute('title', hudTcp.textContent)
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
      const isNewSample = !finiteTs || snap.ts !== lastSnapshotTs || curSample === null
      if (finiteTs) lastSnapshotTs = snap.ts
      if (isNewSample) {
        prevSample = curSample
        curSample = { q: joints.slice(), ts: sampled.ts }
        // ⚠️ 轨迹样本**只在新采样时**入队。以前这行每帧都跑（60 fps），而采样只有 10 Hz
        // ⇒ 同一个 ts 被重复压入约 6 次，600 点的容量实际只装下 ~100 个真样本（约 10 s，
        // 而不是注释里说的 60 s），并且每帧都要重建 ~600 个数组（持续 GC 抖动）。
        pushTrajectorySample(snap)
      }

      // 渲染滞后一个采样周期（自校准）：只有一个样本时不插值，直接呈现该样本。
      const smooth = prevSample
        ? interpolateAt(prevSample, curSample, nowMs - renderDelayMs(prevSample, curSample))
        : curSample.q.slice()
      fkResult = fkChain(kin, smooth)

      // 姿态：只在模型就绪时写（applyFK 不产生 GPU 资源，无需暂存）。
      handle?.applyFK?.(fkResult)

      // TCP 坐标系 gizmo：贴到 tool0（第六关节之后的累积变换）。
      if (Array.isArray(fkResult.tool0)) {
        tcpAxes.matrix.fromArray(fkResult.tool0)
        tcpAxes.matrixWorldNeedsUpdate = true
      }

      drawTrajectory()
      // HUD 用**测量值**而不是插值值：插值是为了让网格看起来连续，而工程读数必须是
      // 控制器真实报出的那一笔（两者可能相差一个采样周期 + 渲染滞后）。
      writeHud(nowMs, snap, joints, fkResult)
    }

    // 画布尺寸：面板刚展开时 flex 高度可能还没算出来（量到 0×0），必须每帧重试，
    // 否则那一帧之后 canvas 会一直用默认后备缓冲被 CSS 拉伸（糊成一片）。
    if (pendingResize) ensureSized()

    renderFrame()
  }

  function frame() {
    if (disposed) return
    try {
      step(now())
      if (errorLine.textContent !== '') errorLine.textContent = ''
    } catch (e) {
      // 单帧异常不得打死循环，也不得静默：写到错误行上（下一帧成功会自动清掉）。
      errorLine.textContent = `${STATUS_ERROR_PREFIX}${e instanceof Error ? e.message : String(e)}`
    } finally {
      if (!disposed) frameId = raf(frame)
    }
  }

  frameId = raf(frame)

  /* ---------------- 卸载（幂等） ---------------- */
  function dispose() {
    if (disposed) return
    disposed = true

    if (frameId !== null) {
      caf?.(frameId)
      frameId = null
    }
    win?.removeEventListener?.('resize', onResize)
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
    sceneHandle?.dispose?.()

    tcpAxes.dispose?.()
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

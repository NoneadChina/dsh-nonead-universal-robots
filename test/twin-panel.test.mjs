/**
 * test/twin-panel.test.mjs — Task 8：大视图面板（模型 + TCP gizmo + 轨迹 + 数值面板）的单测。
 *
 * ## 为什么能测（Ruling 29）
 * 面板把**全部外部副作用**都做成了注入点：`sceneFactory` / `modelLoader` / `raf` / `caf` / `now`，
 * 文档从 `container.ownerDocument` 取。于是 Node 下：
 *   - 假场景记录 `add`/`remove`，不需要 WebGL；
 *   - 假 raf 手动 `flush()` 推帧，不需要 `requestAnimationFrame`；
 *   - 假时钟控制 `now()`，插值/节流都变成确定性可断言；
 *   - 最小假 DOM（本仓库没装 jsdom/happy-dom，也**不允许为了测试装依赖**）提供
 *     `createElement/appendChild/removeChild/setAttribute/textContent` 这一小撮面板真正用到的 API。
 *
 * 轨迹/姿态断言用 `fk.js` 的独立参考实现现算，不猜浮点常数。
 *
 * 运行：node --test test/twin-panel.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  mountTwinPanel,
  resolveKinematics,
  formatJoints,
  formatTcp,
  describeDisconnected,
  TRAJECTORY_CAPACITY,
  HUD_INTERVAL_MS,
  TCP_AXES_SIZE,
  DEFAULT_KINEMATICS_KEY,
  renderDelayMs,
  RENDER_DELAY_MIN_MS,
  RENDER_DELAY_MAX_MS,
} from '../src/client/twin-panel.js'
import { fkChain } from '../src/client/robot/fk.js'
import { lerpJoints } from '../src/client/robot/interpolate.js'
import { TWIN_CSS, TWIN_STYLE_ID, injectStyles } from '../src/client/styles.js'

/* ------------------------------------------------------------------ *
 * 最小假 DOM
 * ------------------------------------------------------------------ */

/** 建一个假元素：只实现面板真正用到的 DOM 面。 */
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    parentNode: null,
    attributes: Object.create(null),
    style: {},
    className: '',
    id: '',
    _text: '',
    listeners: Object.create(null),
    get firstChild() {
      return this.children[0] ?? null
    },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child)
      this.children.push(child)
      child.parentNode = this
      return child
    },
    removeChild(child) {
      const i = this.children.indexOf(child)
      if (i >= 0) this.children.splice(i, 1)
      child.parentNode = null
      return child
    },
    remove() {
      this.parentNode?.removeChild(this)
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value)
    },
    getAttribute(name) {
      return name in this.attributes ? this.attributes[name] : null
    },
    hasAttribute(name) {
      return name in this.attributes
    },
    addEventListener(type, fn) {
      ;(this.listeners[type] ??= []).push(fn)
    },
    removeEventListener(type, fn) {
      const list = this.listeners[type] ?? []
      const i = list.indexOf(fn)
      if (i >= 0) list.splice(i, 1)
    },
    get textContent() {
      return this._text
    },
    set textContent(v) {
      this._text = v === null || v === undefined ? '' : String(v)
    },
  }
  return el
}

/** 深度优先收集匹配元素。 */
function findAll(root, pred, out = []) {
  if (!root || typeof root !== 'object') return out
  if (pred(root)) out.push(root)
  for (const child of root.children ?? []) findAll(child, pred, out)
  return out
}

/** 按 `data-*` 属性找元素（面板用它标注各部件）。 */
const byAttr = (root, attr) => findAll(root, (e) => e.hasAttribute?.(attr) === true)

/** 假文档 + 假 window（记录 resize 监听，便于断言"不留监听器"）。 */
function makeDoc() {
  const doc = {
    created: [],
    head: null,
    defaultView: null,
    createElement(tag) {
      const el = makeEl(tag)
      doc.created.push(el)
      return el
    },
    getElementById(id) {
      return findAll(doc.head, (e) => e.id === id)[0] ?? null
    },
  }
  doc.head = makeEl('head')
  doc.head.ownerDocument = doc
  const win = {
    resizeListeners: [],
    addEventListener(type, fn) {
      win.resizeListeners.push({ type, fn })
    },
    removeEventListener(type, fn) {
      const i = win.resizeListeners.findIndex((l) => l.type === type && l.fn === fn)
      if (i >= 0) win.resizeListeners.splice(i, 1)
    },
  }
  doc.defaultView = win
  return doc
}

function makeContainer(doc) {
  const el = makeEl('div')
  el.ownerDocument = doc
  el.clientWidth = 800
  el.clientHeight = 600
  return el
}

/* ------------------------------------------------------------------ *
 * 假协作者
 * ------------------------------------------------------------------ */

/** 假场景：记录 add/remove/render/resize/dispose。 */
function makeFakeScene(canvas) {
  const added = []
  const removed = []
  let renders = 0
  let resizes = 0
  let disposals = 0
  return {
    canvas,
    scene: {
      added,
      removed,
      add(o) {
        added.push(o)
        return this
      },
      remove(o) {
        removed.push(o)
        const i = added.indexOf(o)
        if (i >= 0) added.splice(i, 1)
        return this
      },
    },
    render() {
      renders++
    },
    resize() {
      resizes++
    },
    dispose() {
      disposals++
    },
    get renders() {
      return renders
    },
    get resizes() {
      return resizes
    },
    get disposals() {
      return disposals
    },
  }
}

function makeSceneFactory() {
  const created = []
  const factory = (canvas) => {
    const s = makeFakeScene(canvas)
    created.push(s)
    return s
  }
  factory.created = created
  return factory
}

/** 假模型加载器：每次调用返回一个全新的假 handle（记录 applyFK 与 dispose）。 */
function makeModelLoader({ usedFallback = false } = {}) {
  const calls = []
  const handles = []
  const loader = async (modelId) => {
    calls.push(modelId)
    let applyFKCount = 0
    let disposed = 0
    let lastResult = null
    const h = {
      root: { isFakeRoot: true, name: `root:${modelId}` },
      groups: Array.from({ length: 7 }, (_, i) => ({ name: `assemble_${i}` })),
      usedFallback,
      applied: [],
      applyFK(result) {
        applyFKCount++
        lastResult = result
        h.applied.push(result)
      },
      dispose() {
        disposed++
      },
      get applyFKCount() {
        return applyFKCount
      },
      get disposed() {
        return disposed
      },
      get lastResult() {
        return lastResult
      },
    }
    handles.push(h)
    return h
  }
  loader.calls = calls
  loader.handles = handles
  return loader
}

/** 假状态源：只提供面板需要的 `getSnapshot`（外加 subscribe，供"不留监听器"检查）。 */
function makeFakeState(initial = {}) {
  let snap = { connected: false, model: '', q: [], tcp: [], ts: 0, error: null, ...initial }
  const listeners = new Set()
  return {
    getSnapshot: () => snap,
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    set(next) {
      snap = { ...snap, ...next }
    },
    listenerCount: () => listeners.size,
  }
}

/**
 * 假时钟 + 假 raf/caf。
 * `caf` **故意不从队列里删除**：模拟"浏览器已经把这一帧排好队、取消来得太晚"，
 * 从而真正验证面板内部的 `disposed` 守卫（而不是靠假实现掩盖掉）。
 */
function makeClock() {
  const queue = new Map()
  const cancelled = []
  let nextId = 1
  let time = 0
  return {
    raf(cb) {
      const id = nextId++
      queue.set(id, cb)
      return id
    },
    caf(id) {
      cancelled.push(id)
    },
    /** 推进 dt 毫秒，并执行"本批次"已排队的帧回调。 */
    flush(dt = 0) {
      time += dt
      const batch = [...queue.values()]
      queue.clear()
      for (const cb of batch) cb(time)
    },
    now: () => time,
    queue,
    cancelled,
  }
}

/** 等模型加载那几跳微任务落地（loader 是 async）。 */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** 组装一个可直接推帧的面板。 */
function boot({ initial = {}, usedFallback = false } = {}) {
  const doc = makeDoc()
  const container = makeContainer(doc)
  const state = makeFakeState(initial)
  const sceneFactory = makeSceneFactory()
  const modelLoader = makeModelLoader({ usedFallback })
  const clock = makeClock()
  const panel = mountTwinPanel({
    container,
    state,
    sceneFactory,
    modelLoader,
    raf: clock.raf,
    caf: clock.caf,
    now: clock.now,
  })
  return { doc, container, state, sceneFactory, modelLoader, clock, panel }
}

const statusEl = (ctx) => byAttr(ctx.container, 'data-ur-twin-status')[0]
const errorEl = (ctx) => byAttr(ctx.container, 'data-ur-twin-error')[0]
const jointsEl = (ctx) => byAttr(ctx.container, 'data-ur-twin-joints')[0]
const tcpEl = (ctx) => byAttr(ctx.container, 'data-ur-twin-tcp')[0]
const panelRoot = (ctx) => byAttr(ctx.container, 'data-ur-twin-panel')[0]
const sceneOf = (ctx) => ctx.sceneFactory.created[0]?.scene ?? null
/** 轨迹 Line：注意 `AxesHelper`（LineSegments）同样带 `isLine`，必须排除线段类。 */
const lineOf = (ctx) =>
  sceneOf(ctx)?.added.find((o) => o.isLine === true && o.isLineSegments !== true) ?? null

const Q0 = [Math.PI / 2, 0, 0, 0, 0, 0]
const TCP0 = [0.1, 0.2, 0.3, 0.01, 0.02, 0.03]

/** 16 元素矩阵逐元素比较（避嫌浮点字面量：差值容差而非硬编码数字）。 */
function tool0Equals(a, b, eps = 1e-9) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 16) return false
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > eps) return false
  return true
}

function assertClose(actual, expected, label, eps = 1e-9) {
  assert.ok(tool0Equals(actual, expected, eps), `${label}（实际 ${JSON.stringify(actual)}）`)
}

/* ------------------------------------------------------------------ *
 * 用例 1：挂载后的 DOM + 未连接不渲染空 3D + 样式走 <style> 字符串
 * ------------------------------------------------------------------ */

test('挂载后容器内出现 canvas 与状态元素；未连接不建场景；样式以 <style> 字符串注入', () => {
  const ctx = boot()

  assert.equal(ctx.container.children.length, 1, '容器内应只有一个面板根元素')
  assert.equal(findAll(ctx.container, (e) => e.tagName === 'CANVAS').length, 1, '必须有 canvas')
  assert.equal(byAttr(ctx.container, 'data-ur-twin-status').length, 1, '必须有状态元素')
  assert.match(statusEl(ctx).textContent, /未连接/, '未连接时必须显示中文状态文案')
  assert.equal(statusEl(ctx).tagName, 'DIV')

  // "不渲染空 3D"：一个空的 WebGL 场景都不该建、更不该 render。
  assert.equal(ctx.sceneFactory.created.length, 0, '未连接不得创建场景')

  // Ruling 28：样式是 <style> + textContent（不是 .css 文件，shell 不会加载那种产物）。
  const styles = findAll(ctx.doc.head, (e) => e.tagName === 'STYLE')
  assert.equal(styles.length, 1, '样式应恰好注入一份')
  assert.equal(styles[0].id, TWIN_STYLE_ID)
  assert.equal(styles[0].textContent, TWIN_CSS)
  assert.ok(TWIN_CSS.includes('.ur-twin-panel'), 'CSS 文本必须真的含面板规则')

  ctx.panel.dispose()
})

/* ------------------------------------------------------------------ *
 * 用例 2：connected:false —— 文案 + 不加载模型 + 不渲染
 * ------------------------------------------------------------------ */

test('快照 connected:false 时显示「未连接」且不加载模型、不渲染', async () => {
  const ctx = boot({ initial: { connected: false, model: 'UR3', q: Q0, tcp: TCP0, ts: 1 } })

  ctx.clock.flush()
  ctx.clock.flush()
  await tick()

  assert.match(statusEl(ctx).textContent, /未连接机器人/)
  assert.equal(ctx.modelLoader.calls.length, 0, '未连接不得调用 modelLoader')
  assert.equal(ctx.sceneFactory.created.length, 0, '未连接不得创建场景')
  assert.equal(panelRoot(ctx).getAttribute('data-ur-twin-connected'), 'false')

  // 恢复连接后自动显示模型并创建场景
  ctx.state.set({ connected: true, ts: 2 })
  ctx.clock.flush()
  await tick()
  assert.equal(ctx.modelLoader.calls.length, 1, '恢复连接后必须自动加载模型')
  assert.equal(ctx.sceneFactory.created.length, 1)
  assert.equal(panelRoot(ctx).getAttribute('data-ur-twin-connected'), 'true')
  assert.match(statusEl(ctx).textContent, /已连接/)

  ctx.panel.dispose()
})

/* ------------------------------------------------------------------ *
 * 用例 3：connected:true —— 正确型号 + 只 add root + 每帧 applyFK
 * ------------------------------------------------------------------ */

test('connected:true 时以正确型号调用 modelLoader、只 add handle.root，且每帧 applyFK', async () => {
  const ctx = boot({ initial: { connected: true, model: 'UR3', q: Q0, tcp: TCP0, ts: 1000 } })

  ctx.clock.flush()
  await tick()

  assert.deepEqual(ctx.modelLoader.calls, ['UR3'], '必须按快照里的型号加载')
  const h = ctx.modelLoader.handles[0]
  const scene = sceneOf(ctx)
  assert.ok(scene, '连接后必须创建场景')
  assert.ok(scene.added.includes(h.root), '必须 scene.add(handle.root)')
  // Task 7 的 assemble() 已把 7 个装配组挂回 root；再手动 add groups[0] 会把它摘出 root。
  assert.ok(!scene.added.includes(h.groups[0]), '不得再手动 add groups[0]')

  // 模型就绪后的每一帧都必须 applyFK
  const frames = 5
  for (let i = 1; i <= frames; i++) {
    ctx.clock.flush(16)
    assert.equal(h.applyFKCount, i, `第 ${i} 帧必须调用一次 applyFK`)
  }

  // 姿态正确性：单采样（无 prev）时插值退化为样本本身，应与独立算出的 FK 逐元素一致。
  const expected = fkChain(resolveKinematics('ur3'), Q0).tool0
  for (let i = 0; i < 16; i++) {
    assert.ok(
      Math.abs(h.lastResult.tool0[i] - expected[i]) < 1e-12,
      `tool0[${i}] 实际 ${h.lastResult.tool0[i]} ≠ 期望 ${expected[i]}`,
    )
  }
  assert.equal(h.lastResult.links.length, 6, 'fkChain 的 links 长度恒为 6')

  ctx.panel.dispose()
})

/* ------------------------------------------------------------------ *
 * 用例 4：型号变化 → 重建模型 + dispose 旧的
 * ------------------------------------------------------------------ */

test('型号 UR3 → UR5E 时重新加载模型，旧模型被摘出场景并 dispose', async () => {
  const ctx = boot({ initial: { connected: true, model: 'UR3', q: Q0, tcp: TCP0, ts: 1000 } })

  ctx.clock.flush()
  await tick()
  const h1 = ctx.modelLoader.handles[0]
  const scene = sceneOf(ctx)
  assert.ok(scene.added.includes(h1.root))

  ctx.state.set({ model: 'UR5E', ts: 1100 })
  ctx.clock.flush()
  await tick()

  assert.deepEqual(ctx.modelLoader.calls, ['UR3', 'UR5E'], '型号变化必须重新调用 modelLoader')
  assert.equal(h1.disposed, 1, '旧模型必须被 dispose')
  assert.ok(scene.removed.includes(h1.root), '旧模型必须被摘出场景')
  const h2 = ctx.modelLoader.handles[1]
  assert.ok(scene.added.includes(h2.root), '新模型必须入场景')
  assert.equal(ctx.sceneFactory.created.length, 1, '换型号不得重建场景本身')

  // 新模型的姿态用新型号的运动学链（ur5e）
  ctx.clock.flush(16)
  const expected = fkChain(resolveKinematics('ur5e'), Q0).tool0
  assert.ok(Math.abs(h2.lastResult.tool0[12] - expected[12]) < 1e-12, '换型号后必须用新运动学链')

  ctx.panel.dispose()
})

/* ------------------------------------------------------------------ *
 * 用例 5：轨迹 —— 逐帧增长、不超容量、不重建 geometry
 * ------------------------------------------------------------------ */

test('轨迹逐帧增长但不超过预分配容量，且始终复用同一个 BufferGeometry', async () => {
  const ctx = boot({ initial: { connected: true, model: 'UR3', q: Q0, tcp: [0, 0, 0, 0, 0, 0], ts: 0 } })

  ctx.clock.flush()
  await tick()

  const line = lineOf(ctx)
  assert.ok(line, '轨迹 Line 必须已入场景')
  assert.equal(line.type, 'Line', '轨迹必须是 Line（不是 LineSegments）')
  const geometry = line.geometry
  const attr = geometry.getAttribute('position')
  assert.equal(attr.count, TRAJECTORY_CAPACITY, 'position 必须按容量预分配')
  assert.equal(attr.array.length, TRAJECTORY_CAPACITY * 3)

  const startTs = 1000
  const frames = TRAJECTORY_CAPACITY + 120 // 喂超过容量的帧数
  for (let i = 0; i < frames; i++) {
    ctx.state.set({ tcp: [(i + 1) / 1000, 0, 0, 0, 0, 0], ts: startTs + i * 10 })
    ctx.clock.flush(16)
    assert.equal(line.geometry, geometry, 'geometry 不得被重建')
  }

  const count = geometry.drawRange.count
  assert.equal(count, TRAJECTORY_CAPACITY, `喂 ${frames} 帧后 drawRange.count 必须钳到容量`)
  // 不越界：写入点全部落在预分配数组内
  for (let i = 0; i < TRAJECTORY_CAPACITY; i++) {
    const x = attr.array[i * 3]
    assert.ok(Number.isFinite(x), `positions[${i}] 必须是有限数（未越界写入）`)
    assert.ok(x > 0, '轨迹点应来自被喂入的 tcp 样本')
  }
  assert.ok(attr.array.length === TRAJECTORY_CAPACITY * 3, '数组长度不得增长')

  // 淘汰策略：把 ts 拉远到超过 maxAge → 老样本被淘汰、点数回落
  ctx.state.set({ tcp: [9, 9, 9, 0, 0, 0], ts: startTs + 10 * frames + 120_000 })
  ctx.clock.flush(16)
  assert.ok(geometry.drawRange.count < TRAJECTORY_CAPACITY, '超龄样本必须被淘汰')
  assert.ok(geometry.drawRange.count >= 1)

  ctx.panel.dispose()
})

/* ------------------------------------------------------------------ *
 * 用例 6：dispose —— caf / 清容器 / 已排队帧不再 applyFK / 幂等
 * ------------------------------------------------------------------ */

test('dispose() 停循环（caf）、清空容器、已排队帧不再 applyFK，且重复调用不抛错', async () => {
  const ctx = boot({ initial: { connected: true, model: 'UR3', q: Q0, tcp: TCP0, ts: 1000 } })

  ctx.clock.flush()
  await tick()
  ctx.clock.flush(16)
  const h = ctx.modelLoader.handles[0]
  const sceneHandle = ctx.sceneFactory.created[0]
  const appliedBefore = h.applyFKCount
  assert.ok(appliedBefore > 0, 'dispose 前必须已 applyFK')
  const rendersBefore = sceneHandle.renders
  assert.ok(rendersBefore > 0, '连接期间必须调用场景 render')

  const pendingId = [...ctx.clock.queue.keys()].at(-1)
  assert.equal(typeof pendingId, 'number', '必须已排好下一帧')

  ctx.panel.dispose()

  assert.ok(ctx.clock.cancelled.includes(pendingId), '必须用注入的 caf 取消已排的帧')
  assert.equal(ctx.container.children.length, 0, '容器必须被清空')
  assert.equal(h.disposed, 1, '模型必须被 dispose')
  assert.equal(sceneHandle.disposals, 1, '场景必须被 dispose')
  assert.equal(ctx.doc.defaultView.resizeListeners.length, 0, '不得留下 resize 监听')
  assert.equal(ctx.state.listenerCount(), 0, '不得留下 state 订阅')

  // 假 caf 故意不删队列 ⇒ 这一帧仍会被调用；面板必须靠自身守卫不再 applyFK。
  ctx.clock.flush(16)
  assert.equal(h.applyFKCount, appliedBefore, 'dispose 后不得再 applyFK')
  assert.equal(sceneHandle.renders, rendersBefore, 'dispose 后不得再 render')

  // 共享样式是资源、不随面板卸载移除（另一个实例可能还在用）
  assert.equal(findAll(ctx.doc.head, (e) => e.tagName === 'STYLE').length, 1)

  assert.doesNotThrow(() => ctx.panel.dispose(), '重复 dispose 必须安全')
  assert.doesNotThrow(() => ctx.panel.dispose())
  assert.equal(ctx.clock.cancelled.length, 1, '重复 dispose 不得重复 caf')
})

/* ------------------------------------------------------------------ *
 * 用例 7：数值面板 —— 度 + 节流 ~10 Hz
 * ------------------------------------------------------------------ */

test('数值面板显示「度」并节流到 ~10 Hz（不每帧写 DOM）', async () => {
  const ctx = boot({ initial: { connected: true, model: 'UR3', q: Q0, tcp: TCP0, ts: 1000 } })

  ctx.clock.flush() // t=0：首帧就应写一次
  await tick()

  const joints = jointsEl(ctx)
  const tcp = tcpEl(ctx)
  assert.equal(joints.textContent, formatJoints(Q0))
  assert.equal(tcp.textContent, formatTcp(TCP0))
  assert.ok(joints.textContent.includes('J1 90.0'), 'π/2 rad 必须显示为 90.0 度')
  assert.ok(joints.textContent.includes('°'))
  assert.ok(tcp.textContent.includes('x 0.1000'), 'TCP 位置按米显示')

  // 之后 9 帧（每帧 +10 ms，累计 90 ms）都不得改写 DOM
  for (let i = 1; i <= 9; i++) {
    joints.textContent = 'SENTINEL'
    ctx.clock.flush(10)
    assert.equal(joints.textContent, 'SENTINEL', `第 ${i} 帧（t=${i * 10}ms）不应写 DOM`)
  }
  // 第 10 帧累计到 100 ms → 再写一次
  joints.textContent = 'SENTINEL'
  ctx.clock.flush(10)
  assert.equal(joints.textContent, formatJoints(Q0), `t=100ms 必须刷新（节流间隔 ${HUD_INTERVAL_MS}ms）`)
  assert.equal(HUD_INTERVAL_MS, 100)

  ctx.panel.dispose()
})

/* ------------------------------------------------------------------ *
 * 用例 8：TCP gizmo —— AxesHelper(0.08) 且矩阵等于 tool0
 * ------------------------------------------------------------------ */

test('TCP gizmo 是 AxesHelper(0.08)，其矩阵等于该帧的 tool0', async () => {
  const ctx = boot({ initial: { connected: true, model: 'UR3', q: Q0, tcp: TCP0, ts: 1000 } })

  ctx.clock.flush()
  await tick()
  ctx.clock.flush(16)

  const axes = sceneOf(ctx).added.find((o) => o.type === 'AxesHelper')
  assert.ok(axes, '场景里必须有 AxesHelper')
  assert.equal(TCP_AXES_SIZE, 0.08)
  // AxesHelper 的几何是「原点 → size」的三段轴 ⇒ 顶点坐标最大绝对值即构造参数。
  const pos = axes.geometry.getAttribute('position')
  let maxAbs = 0
  for (const v of pos.array) maxAbs = Math.max(maxAbs, Math.abs(v))
  assert.ok(
    Math.abs(maxAbs - 0.08) < 1e-6,
    `AxesHelper 尺寸必须是 0.08（实测顶点最大坐标 ${maxAbs}）`,
  )

  const expected = fkChain(resolveKinematics('ur3'), Q0).tool0
  for (let i = 0; i < 16; i++) {
    assert.ok(
      Math.abs(axes.matrix.elements[i] - expected[i]) < 1e-12,
      `gizmo 矩阵[${i}] 实际 ${axes.matrix.elements[i]} ≠ tool0 ${expected[i]}`,
    )
  }

  ctx.panel.dispose()
})

/* ------------------------------------------------------------------ *
 * 用例 9：时间轴锚定（偏差 D1）—— epoch 域的快照 ts + performance.now 域的 now
 *
 * 注：本用例在 fix round 1 之后按"渲染滞后一个采样周期"重述了时间轴
 * （渲染时刻 = now - 一个采样周期）。锚定的作用因此表现为：
 * **渲染时刻能正确落在样本的 epoch 时间轴上**；若不做锚定（直接用 performance.now 减 epoch ts），
 * alpha 会恒为 0 ⇒ 无论时间怎么推进都停在 fk(A)。
 * ------------------------------------------------------------------ */

test('宿主 ts 为 epoch 毫秒时仍平滑跟随：alpha 随时间推进，而不是恒被钳到 0', async () => {
  const EPOCH = 1_700_000_000_000 // host 侧 ts: Date.now()（lib/twin-routes.js）
  const A = [0, 0, 0, 0, 0, 0]
  const B = [Math.PI / 2, 0, 0, 0, 0, 0]
  const kin = resolveKinematics('ur3')
  const ctx = boot({ initial: { connected: true, model: 'UR3', q: A, tcp: TCP0, ts: EPOCH } })

  ctx.clock.flush() // t=0：锚定 + 首个采样 A（映射到本地 ts=0）
  await tick()
  ctx.clock.flush(16) // t=16：仍是采样 A
  const h = ctx.modelLoader.handles[0]
  assertClose(h.applied.at(-1).tool0, fkChain(kin, A).tool0, '单采样阶段必须就是样本本身')

  // 第二个采样：host ts 只前进 100 ms（epoch 域）
  ctx.state.set({ q: B, ts: EPOCH + 100 })
  ctx.clock.flush(16) // t=32 ⇒ 渲染时刻 = 32 - 100 = -68 ⇒ alpha=0（仍在滞后窗口内）
  assertClose(h.applied.at(-1).tool0, fkChain(kin, A).tool0, '滞后窗口内呈现的是 prev（A）')

  // 时间推进到"渲染时刻进入样本窗口"：t=116 ⇒ 渲染时刻 16 ⇒ alpha=16/100
  ctx.clock.flush(84)
  const mid = h.applied.at(-1).tool0
  assertClose(mid, fkChain(kin, lerpJoints(A, B, 16 / 100)).tool0, 't=116ms 应为 16% 插值')
  assert.ok(
    !tool0Equals(mid, fkChain(kin, A).tool0),
    'epoch ts 下不得冻结在上一采样（少了时钟锚定就会恒等于 fk(A)）',
  )
  assert.ok(!tool0Equals(mid, fkChain(kin, B).tool0), '尚未越过窗口，不应已经等于 fk(B)')

  // 渲染时刻越过样本窗口 → 收敛到新采样
  ctx.clock.flush(100) // t=216 ⇒ 渲染时刻 116 ≥ 100
  assertClose(h.applied.at(-1).tool0, fkChain(kin, B).tool0, '超过采样窗口后必须收敛到最新采样')

  ctx.panel.dispose()
})

/* ------------------------------------------------------------------ *
 * 用例 10：未知型号不崩 + 回退文案
 * ------------------------------------------------------------------ */

test('未知型号不抛错：仍按该型号加载并 applyFK，错误行为空；回退时文案有提示', async () => {
  const ctx = boot({
    initial: { connected: true, model: 'UR99', q: Q0, tcp: TCP0, ts: 1000 },
    usedFallback: true,
  })

  ctx.clock.flush()
  await tick()
  ctx.clock.flush(16)

  assert.deepEqual(ctx.modelLoader.calls, ['UR99'], '型号原样交给 modelLoader（大小写由 loader 处理）')
  assert.ok(ctx.modelLoader.handles[0].applyFKCount >= 1, '未知型号也必须能摆姿态（退回默认链）')
  assert.equal(errorEl(ctx).textContent, '', '不得留下渲染异常')
  assert.match(statusEl(ctx).textContent, /近似几何体/, '回退时必须给出提示文案')

  ctx.panel.dispose()
})

/* ------------------------------------------------------------------ *
 * 用例 10：纯函数 —— 运动学解析 / 文本格式化 / 样式幂等
 * ------------------------------------------------------------------ */

test('resolveKinematics：大小写不敏感，未知/空型号退回默认链且不抛错', () => {
  assert.equal(resolveKinematics('UR5E'), resolveKinematics('ur5e'))
  assert.equal(resolveKinematics('UR5E').links.length, 6)
  assert.equal(resolveKinematics('ur99'), resolveKinematics(DEFAULT_KINEMATICS_KEY))
  assert.equal(resolveKinematics(''), resolveKinematics(DEFAULT_KINEMATICS_KEY))
  assert.equal(resolveKinematics(null), resolveKinematics(DEFAULT_KINEMATICS_KEY))
  assert.equal(resolveKinematics(undefined), resolveKinematics(DEFAULT_KINEMATICS_KEY))
  assert.equal(resolveKinematics('ur3').links[0].z, 0.1519, 'UR3 shoulder.z 应与官方一致')
})

test('formatJoints/formatTcp：弧度转度、缺值显示 --、不抛错', () => {
  assert.equal(
    formatJoints([Math.PI, -Math.PI / 2, 0, 0, 0, 0]),
    '关节角 (°)  J1 180.0  J2 -90.0  J3 0.0  J4 0.0  J5 0.0  J6 0.0',
  )
  assert.equal(formatJoints([]), '关节角 (°)  J1 --  J2 --  J3 --  J4 --  J5 --  J6 --')
  assert.equal(
    formatTcp([0.1, 0.2, 0.3, 0.01, 0.02, 0.03]),
    'TCP(米/轴角弧度)  x 0.1000  y 0.2000  z 0.3000  rx 0.010  ry 0.020  rz 0.030',
  )
  assert.ok(formatTcp(null).includes('x --'))
  assert.equal(formatJoints(undefined).includes('--'), true)
  // 姿态必须标明是轴角旋转向量：写成 rx/ry/rz 会被当成 RPY 读，从而得出错误朝向。
  assert.match(formatTcp([0, 0, 0, 0, 0, 0]), /轴角/)
})

test('describeDisconnected：不同失败码必须给出不同的人话（不要都渲染成"未连接"）', () => {
  assert.match(describeDisconnected('no_robot', 'no robot connected'), /ur_connect/)
  assert.match(describeDisconnected('robot_not_connected', 'robot 1.2.3.4 is not connected'), /1\.2\.3\.4/)
  const ambiguous = describeDisconnected('ambiguous_robot', '要指定', ['1.1.1.1', '2.2.2.2'])
  assert.match(ambiguous, /多台/)
  assert.match(ambiguous, /1\.1\.1\.1/)
  assert.match(describeDisconnected('worker_unavailable', 'UR worker unavailable'), /ur_ping/)
  assert.match(describeDisconnected('robot_error', '超时'), /超时/)
  // 未知码不得吞掉 reason
  assert.match(describeDisconnected(undefined, '自定义原因'), /自定义原因/)
})

test('未连接时状态行显示 host 的具体原因，而不是一句固定的「未连接机器人」', () => {
  const ctx = boot({ initial: { connected: false, code: 'worker_unavailable', error: 'UR worker unavailable' } })
  ctx.clock.flush()
  assert.match(statusEl(ctx).textContent, /UR 控制进程不可用/)
  assert.match(statusEl(ctx).textContent, /ur_ping/)
  assert.doesNotMatch(statusEl(ctx).textContent, /^未连接机器人$/)
  ctx.panel.dispose()
})

test('host 报 degraded（q 不完整）时状态行如实提示，而不是继续显示"已连接"', async () => {
  const ctx = boot({ initial: { connected: true, model: 'UR3', q: Q0, tcp: TCP0, ts: 1000 } })
  ctx.clock.flush()
  await tick()
  assert.match(statusEl(ctx).textContent, /已连接/)

  ctx.state.set({ connected: true, model: 'UR3', q: [], tcp: [], ts: 2000, degraded: true })
  ctx.clock.flush(20)
  assert.match(statusEl(ctx).textContent, /未返回完整的关节角/)
  ctx.panel.dispose()
})

test('轨迹只在"新采样"时入队：同一 ts 被读多帧不得把缓冲灌满重复点', async () => {
  const ctx = boot({ initial: { connected: true, model: 'UR3', q: Q0, tcp: TCP0, ts: 1000 } })

  // 同一份快照（同一个 ts）推 30 帧：真样本只有 1 个。
  ctx.clock.flush()
  await tick()
  for (let i = 0; i < 29; i++) ctx.clock.flush(16)

  const line = lineOf(ctx)
  const drawn = line.geometry.drawRange.count
  assert.equal(drawn, 1,
    `同一个 ts 必须只入队一次（实测画出 ${drawn} 个点）—— 以前每帧都压一次，600 点容量只装得下约 100 个真样本`)

  // 换一个 ts → 才应该再多一个点。
  ctx.state.set({ connected: true, model: 'UR3', q: Q0, tcp: [0.2, 0.2, 0.3, 0, 0, 0], ts: 2000 })
  ctx.clock.flush(16)
  assert.equal(line.geometry.drawRange.count, 2, '新采样必须入队')
  ctx.panel.dispose()
})

test('数值面板显示的是测量样本（不是插值中间态），且带 title 便于读被截断的关节', async () => {
  const ctx = boot({ initial: { connected: true, model: 'UR3', q: Q0, tcp: TCP0, ts: 1000 } })
  ctx.clock.flush()
  await tick()

  const joints = jointsEl(ctx)
  assert.equal(joints.textContent, formatJoints(Q0), 'HUD 关节行必须是控制器报出的那一笔')
  assert.equal(joints.getAttribute('title'), joints.textContent, '必须给出完整文本的 title')

  // 新采样到达后，HUD 显示的应是**新样本**而不是上一笔与它之间的插值。
  const Q1 = [0, Math.PI / 4, 0, 0, 0, 0]
  ctx.state.set({ connected: true, model: 'UR3', q: Q1, tcp: TCP0, ts: 1100 })
  ctx.clock.flush(16)
  ctx.clock.flush(HUD_INTERVAL_MS)
  assert.equal(joints.textContent, formatJoints(Q1), 'HUD 必须跟到最新测量值')
  ctx.panel.dispose()
})

test('WebGL 不可用时降级为纯数值模式：不抛未处理异常、状态行说明原因、循环继续跑', async () => {
  const doc = makeDoc()
  const container = makeContainer(doc)
  const state = makeFakeState({ connected: true, model: 'UR3', q: Q0, tcp: TCP0, ts: 1000 })
  const clock = makeClock()
  const throwingSceneFactory = () => { throw new Error('no WebGL context available') }

  const panel = mountTwinPanel({
    container,
    state,
    sceneFactory: throwingSceneFactory,
    modelLoader: makeModelLoader({}),
    raf: clock.raf,
    caf: clock.caf,
    now: clock.now,
  })

  clock.flush()
  // 场景是在模型加载完成后才创建的（懒创建），所以要让 async 的 loadModel 跑完。
  await tick()
  clock.flush(16)
  const status = byAttr(container, 'data-ur-twin-status')[0]
  // 以前这个异常会变成未处理的 promise rejection：状态行永远停在「正在加载模型…」，
  // 画布一片空白，且没有任何错误提示。
  assert.match(status.textContent, /不支持 WebGL/, `实测：${status.textContent}`)
  // 循环必须还活着（数值通道继续更新）。
  const joints = byAttr(container, 'data-ur-twin-joints')[0]
  assert.equal(joints.textContent, formatJoints(Q0), '纯数值模式下数值仍必须更新')
  panel.dispose()
})

test('dispose 会断开 ResizeObserver（侧栏宽度变化必须有监听，且不能泄漏）', () => {
  const ctx = boot({ initial: { connected: true, model: 'UR3', q: Q0, tcp: TCP0, ts: 1000 } })
  ctx.clock.flush()
  const observers = ctx.doc.defaultView.__observers
  // 假 DOM 里可能没有 ResizeObserver 实现：此时退回 window.resize + 每帧重试，也算通过。
  if (Array.isArray(observers) && observers.length > 0) {
    assert.equal(observers[0].disconnected, false)
    ctx.panel.dispose()
    assert.equal(observers[0].disconnected, true, 'dispose 必须 disconnect')
  } else {
    ctx.panel.dispose()
  }
})

test('injectStyles 幂等：重复调用复用同一个 <style>，无 DOM 时返回 null 而不抛错', () => {
  const doc = makeDoc()
  const a = injectStyles(doc)
  const b = injectStyles(doc)
  assert.equal(a, b, '第二次调用必须复用同一个元素')
  assert.equal(findAll(doc.head, (e) => e.tagName === 'STYLE').length, 1, '不得重复注入')
  assert.equal(a.id, TWIN_STYLE_ID)
  assert.equal(a.textContent, TWIN_CSS)
  assert.equal(a.getAttribute('data-dsh-ur-twin-style'), '')
  assert.equal(injectStyles(null), null, '没有 DOM 时必须安全返回 null')
  assert.equal(injectStyles({}), null)
})

/* ================================================================== *
 * fix round 1（控制器裁决 U2）：渲染滞后一个采样周期
 *
 * 设计意图：客户端要做的是**插值**平滑，而不是"显示最新采样"。
 * 最新样本的到达时刻 ≈ 它的产生时刻 ⇒ 不滞后时 alpha 恒被钳到 1，
 * 只有 ~10 Hz 阶梯、等于没有插值。滞后"一个采样周期"后，渲染时刻恰好
 * 落在最近两个样本的时间窗内 ⇒ alpha ∈ (0,1)。
 * 滞后量用**宿主 ts 的差值**自校准（不需要知道轮询间隔），并有上限兜底。
 *
 * 时序约定：假时钟每帧 +16 ms，host 样本按测试给定的间隔到达；
 * host ts 用 epoch 量级（与 lib/twin-routes.js 的 `ts: Date.now()` 一致），
 * 面板的时钟锚定把 host 时间轴平移到本地 `now()` 轴上（偏差 D1）。
 * ================================================================== */

const EPOCH = 1_700_000_000_000
const A0 = [0, 0, 0, 0, 0, 0]
const B0 = [Math.PI / 2, 0, 0, 0, 0, 0]
const KIN3 = resolveKinematics('ur3')
const fkOf = (q) => fkChain(KIN3, q).tool0
const lastFk = (ctx) => ctx.modelLoader.handles[0].applied.at(-1).tool0

/** 与 `twin-panel.js` 导出的 `RENDER_DELAY_MAX_MS` 必须一致（下面有交叉断言）。 */
const RENDER_DELAY_CAP_EXPECTED = 400

/** 连接中 + 模型已就绪 + 时钟锚定在本地 t=0、已吃下样本 A0 的上下文。 */
async function bootConnectedSampleA() {
  const ctx = boot({ initial: { connected: true, model: 'UR3', q: A0, tcp: TCP0, ts: EPOCH } })
  ctx.clock.flush() // t=0：锚定（host EPOCH → 本地 0）并吃下样本 A0
  await tick() // 模型就绪，之后每一帧都会 applyFK
  return ctx
}

test('fix round 1：渲染滞后一个采样周期 —— 插值位置严格落在两端之间（不得钳到端点）', async () => {
  const ctx = await bootConnectedSampleA()

  // 采样未变（prev 仍为空）⇒ 不插值，就是 A 本身
  ctx.clock.flush(100) // t=100
  assertClose(lastFk(ctx), fkOf(A0), '单样本阶段必须就是样本本身')

  // host 在 t=100 出了第二个样本（ts 前进 100 ms）
  ctx.state.set({ q: B0, ts: EPOCH + 100 })
  ctx.clock.flush(16) // t=116 ⇒ 滞后 100 ms ⇒ 渲染时刻 16 ms ⇒ alpha=0.16
  const pose = lastFk(ctx)
  assert.ok(!tool0Equals(pose, fkOf(B0)), '不得钳到最新端点 fk(B)：无滞后的实现会恒等于 fk(B)')
  assert.ok(!tool0Equals(pose, fkOf(A0)), '也不得仍停在 fk(A)')
  assertClose(pose, fkOf(lerpJoints(A0, B0, 16 / 100)), '渲染时刻 = now - 100 ms ⇒ alpha=0.16')

  // 帧继续推进 ⇒ alpha 在样本窗口内单调推进；越过一个采样周期后到达最新样本
  ctx.clock.flush(16) // t=132 ⇒ alpha=0.32
  assertClose(lastFk(ctx), fkOf(lerpJoints(A0, B0, 32 / 100)), 't=132 ms ⇒ alpha=0.32')
  for (let i = 0; i < 5; i++) ctx.clock.flush(16) // t=212 ≥ 100+100
  assertClose(lastFk(ctx), fkOf(B0), '越过采样间隔后必须收敛到最新样本')

  ctx.panel.dispose()
})

test('fix round 1：滞后量由宿主 ts 的采样间隔自校准（间隔不同 ⇒ alpha 不同）', async () => {
  /** 采样间隔 spanMs：新样本到达后 16 ms 的那一帧，渲染时刻应为 16 ms ⇒ alpha=16/spanMs。 */
  const poseAfterNewSample = async (spanMs) => {
    const ctx = await bootConnectedSampleA()
    ctx.clock.flush(spanMs) // 采样未变，时间推进一整个采样间隔
    ctx.state.set({ q: B0, ts: EPOCH + spanMs })
    ctx.clock.flush(16)
    const pose = lastFk(ctx)
    ctx.panel.dispose()
    return pose
  }

  const p100 = await poseAfterNewSample(100)
  const p200 = await poseAfterNewSample(200)

  assertClose(p100, fkOf(lerpJoints(A0, B0, 16 / 100)), '间隔 100 ms ⇒ alpha=0.16')
  assertClose(p200, fkOf(lerpJoints(A0, B0, 16 / 200)), '间隔 200 ms ⇒ alpha=0.08（滞后量随间隔变）')
  assert.ok(!tool0Equals(p100, p200), '同一组样本在不同采样间隔下必须得到不同的插值位置')
})

test('fix round 1：滞后上限生效（超长间隔不卡在很久以前）', async () => {
  const ctx = await bootConnectedSampleA()

  ctx.clock.flush(5000) // host 卡顿/丢帧：间隔 5000 ms
  ctx.state.set({ q: B0, ts: EPOCH + 5000 })
  ctx.clock.flush(16) // t=5016 ⇒ 原始间隔 5000 ms，滞后必须被钳到上限
  const pose = lastFk(ctx)
  const cappedRenderTime = 5016 - RENDER_DELAY_CAP_EXPECTED
  assertClose(
    pose,
    fkOf(lerpJoints(A0, B0, cappedRenderTime / 5000)),
    `滞后必须被钳到上限 ${RENDER_DELAY_CAP_EXPECTED} ms`,
  )
  assert.ok(!tool0Equals(pose, fkOf(A0)), '不得"卡在很久以前"（滞后不能随间隔无限增长）')

  ctx.panel.dispose()
})

test('fix round 1：只有单个样本时不插值（行为不变）', async () => {
  const ctx = await bootConnectedSampleA()

  // 长时间无新样本：prev 始终为空 ⇒ 每帧都应精确等于 fk(A0)（不插值、不 NaN）
  for (const dt of [16, 16, 500, 5000]) {
    ctx.clock.flush(dt)
    assertClose(lastFk(ctx), fkOf(A0), `单样本阶段（+${dt}ms）必须就是样本本身`)
  }
  assert.equal(ctx.modelLoader.handles[0].applyFKCount >= 4, true)

  ctx.panel.dispose()
})

test('fix round 1：renderDelayMs 纯函数 —— 自校准为采样间隔，并有上下限钳制', () => {
  // 测试里引用的上限必须与实现导出的常量一致
  assert.equal(RENDER_DELAY_MAX_MS, RENDER_DELAY_CAP_EXPECTED)
  assert.equal(RENDER_DELAY_MIN_MS, 0)

  assert.equal(renderDelayMs({ q: [], ts: 1000 }, { q: [], ts: 1100 }), 100, '间隔 100ms ⇒ 滞后 100ms')
  assert.equal(renderDelayMs({ q: [], ts: 1000 }, { q: [], ts: 1200 }), 200, '间隔 200ms ⇒ 滞后 200ms')
  assert.equal(renderDelayMs({ q: [], ts: 0 }, { q: [], ts: 5000 }), RENDER_DELAY_MAX_MS, '超长间隔钳到上限')
  assert.equal(renderDelayMs({ q: [], ts: 100 }, { q: [], ts: 100 }), RENDER_DELAY_MIN_MS, '零间隔 ⇒ 不滞后')
  assert.equal(renderDelayMs({ q: [], ts: 200 }, { q: [], ts: 100 }), RENDER_DELAY_MIN_MS, '时间倒退 ⇒ 不滞后')
  assert.equal(renderDelayMs(undefined, { q: [], ts: 1 }), RENDER_DELAY_MIN_MS, '缺样本 ⇒ 不滞后（不返回 NaN）')
  assert.equal(renderDelayMs({ q: [], ts: 1 }, undefined), RENDER_DELAY_MIN_MS)
  assert.equal(Number.isFinite(renderDelayMs({ q: [], ts: NaN }, { q: [], ts: NaN })), true)
})


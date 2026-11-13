// test/guide-entry.test.mjs
// 覆盖 src/client/guide-entry.js：把入口卡片注册成宿主开始页 catalog 的正式成员。
//
// 这一层不碰真实 DOM/React —— 生产环境的 React 由宿主的 `require('react')` 提供，
// node 测试中 `getReact()` 一定返回 null，因此这里用假 React 注入，验证**注册时序与降级语义**：
//   · 服务已在 → 立即注册（guide + tab 正文），调用方不再挂 DOM 克隆；
//   · 服务晚到 → 先挂克隆兜底，服务出现后注册并通知调用方拆掉克隆；
//   · 宿主没有 React / 该服务 → 返回 null，整条链降级为旧的 DOM 克隆路径。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  GUIDE_ENTRY_ID,
  GUIDE_ENTRY_KIND,
  SLOT_TAB_BODY,
  createGuideDefinition,
  createGuideIcon,
  createTabBody,
  getReact,
  registerGuideEntry,
} from '../src/client/guide-entry.js'

const strings = { dockLabel: '拓德UR数字孪生', dockDescription: '实时 3D 与状态' }

/** 假 React：只实现本模块用到的四个 API。 */
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useRef: () => ({ current: null }),
  useEffect: () => {},
}

/** 造一个最小可用的假 guide 注册表。 */
function createRegistry(options = {}) {
  const registered = []
  const state = { registered, disposed: 0 }
  return {
    state,
    register(definition) {
      if (options.throwOnRegister) throw new Error('duplicate id')
      registered.push(definition)
      return () => {
        state.disposed += 1
      }
    },
  }
}

/** 造一个假 slots 服务，记录正文注册。 */
function createSlots() {
  const calls = { injected: [], registered: [] }
  return {
    calls,
    inject(name, factory) {
      calls.injected.push(name)
      const dispose = factory()
      return () => {
        dispose?.()
      }
    },
    register(spec, Component) {
      calls.registered.push({ spec, Component })
      return () => {}
    },
  }
}

/**
 * 造一个假 cordis ctx。
 * `services` 里的键会被 `get()` 命中；`deferInject` 为 true 时回调挂起，交给用例手动触发。
 */
function createCtx({ services = {}, deferInject = false } = {}) {
  const pending = []
  const calls = { get: [], inject: [] }
  const ctx = {
    calls,
    get(name) {
      calls.get.push(name)
      return services[name]
    },
    inject(deps, callback) {
      calls.inject.push(deps)
      if (!deferInject) callback(Object.fromEntries(deps.map((name) => [name, services[name]])))
      else pending.push({ deps, callback })
      return () => {
        calls.injectOff = (calls.injectOff ?? 0) + 1
      }
    },
  }
  return { ctx, pending, calls }
}

test('createGuideDefinition：id/kind/标题与引导项结构', () => {
  const withoutReact = createGuideDefinition({ strings, react: null })
  assert.equal(withoutReact.id, GUIDE_ENTRY_ID)
  assert.equal(withoutReact.kind, GUIDE_ENTRY_KIND)
  assert.equal(withoutReact.title(), '拓德UR数字孪生')
  assert.equal(withoutReact.guide.length, 1)
  const [entry] = withoutReact.guide
  assert.equal(entry.id, 'twin')
  assert.equal(entry.order, 5)
  assert.equal(entry.title(), '拓德UR数字孪生')
  assert.equal(entry.description(), '实时 3D 与状态')
  assert.equal(entry.icon, undefined)

  // 有 React 时给图标函数（返回元素，不是把元素固化在定义里）
  const withReact = createGuideDefinition({ strings, react: fakeReact })
  assert.equal(typeof withReact.guide[0].icon, 'function')
  assert.equal(withReact.guide[0].icon().type, 'svg')
})

test('createGuideIcon：虚线虚拟空间 + 实线机械臂 + 三个关节点', () => {
  const icon = createGuideIcon(fakeReact, 22)
  assert.equal(icon.type, 'svg')
  assert.equal(icon.props.width, 22)
  assert.equal(icon.props.height, 22)
  assert.equal(icon.props.viewBox, '0 0 24 24')
  // 跟随主题：不写死颜色，也不给填充
  assert.equal(icon.props.stroke, 'currentColor')
  assert.equal(icon.props.fill, 'none')
  assert.equal(icon.props['aria-hidden'], 'true')

  const [frame, base, arm, ...joints] = icon.children
  assert.equal(icon.children.length, 6) // 框 + 底座 + 臂 + 3 个关节点
  // 虚拟空间用虚线区分实体；这是图标「数字孪生」语义的唯一来源，不能丢
  assert.equal(frame.type, 'path')
  assert.equal(frame.props.strokeDasharray, '2.4 2.2')
  assert.equal(base.type, 'path')
  assert.equal(arm.type, 'path')
  // 机械臂是 3 段折线（起点 2 个坐标 + 立柱 1 个 + 两段折线各 2 个 = 7 个数）
  assert.equal((arm.props.d.match(/-?\d*\.?\d+/g) ?? []).length, 7)
  assert.equal(joints.length, 3)
  for (const joint of joints) {
    assert.equal(joint.type, 'circle')
    assert.ok(joint.props.r > 0)
  }
})

test('createGuideIcon：宿主按 size prop 渲染时尺寸跟随，缺省 16', () => {
  const def = createGuideDefinition({ strings, react: fakeReact })
  const icon = def.guide[0].icon
  assert.equal(icon({ size: 22 }).props.width, 22)
  assert.equal(icon({ size: 18 }).props.height, 18)
  assert.equal(icon().props.width, 16)
})

test('getReact：无 require 的运行时返回 null（降级信号）', () => {
  assert.equal(getReact(), null)
})

test('createTabBody：返回可注册的组件函数', () => {
  const Body = createTabBody({ react: fakeReact, mountPanel: () => ({ dispose() {} }) })
  assert.equal(typeof Body, 'function')
  assert.equal(Body.displayName, 'UrTwinTabBody')
})

test('registerGuideEntry：服务已在 → 立即注册 guide 与正文并通知调用方', () => {
  const registry = createRegistry()
  const slots = createSlots()
  const { ctx } = createCtx({ services: { sidebarRightTabs: registry, slots } })
  let notified = 0

  const handle = registerGuideEntry({
    ctx,
    strings,
    react: fakeReact,
    mountPanel: () => ({ dispose() {} }),
    onRegistered: () => {
      notified += 1
    },
  })

  assert.ok(handle)
  assert.equal(handle.immediate, true)
  assert.equal(registry.state.registered.length, 1)
  assert.equal(registry.state.registered[0].id, GUIDE_ENTRY_ID)
  assert.equal(notified, 1)
  // 正文槽注册：槽名与 key 必须与 guide id 对齐，否则点开是空白页
  assert.deepEqual(slots.calls.injected, [SLOT_TAB_BODY])
  assert.equal(slots.calls.registered.length, 1)
  assert.equal(slots.calls.registered[0].spec.name, SLOT_TAB_BODY)
  assert.equal(slots.calls.registered[0].spec.key, GUIDE_ENTRY_ID)
  assert.equal(typeof slots.calls.registered[0].Component, 'function')

  handle.dispose()
  handle.dispose() // 幂等
  assert.equal(registry.state.disposed, 1)
})

test('registerGuideEntry：服务晚到 → 先降级，注册成功后通知拆掉克隆', () => {
  const registry = createRegistry()
  const { ctx, pending } = createCtx({ services: {}, deferInject: true })
  let notified = 0

  const handle = registerGuideEntry({
    ctx,
    strings,
    react: fakeReact,
    mountPanel: () => ({ dispose() {} }),
    onRegistered: () => {
      notified += 1
    },
  })

  assert.ok(handle)
  assert.equal(handle.immediate, false)
  assert.equal(registry.state.registered.length, 0)
  assert.equal(notified, 0)
  assert.deepEqual(ctx.calls.inject[0], ['sidebarRightTabs'])

  pending[0].callback({ sidebarRightTabs: registry })
  assert.equal(registry.state.registered.length, 1)
  assert.equal(notified, 1)

  handle.dispose()
  assert.equal(registry.state.disposed, 1)
})

test('registerGuideEntry：注册抛错 → 返回 null，调用方回退 DOM 克隆', () => {
  const registry = createRegistry({ throwOnRegister: true })
  const { ctx } = createCtx({ services: { sidebarRightTabs: registry } })
  const handle = registerGuideEntry({
    ctx,
    strings,
    react: fakeReact,
    mountPanel: () => ({ dispose() {} }),
  })
  assert.equal(handle, null)
})

test('registerGuideEntry：服务缺席但可等待 → 返回非 immediate 句柄（调用方先挂克隆）', () => {
  const { ctx } = createCtx({ services: {} })
  const handle = registerGuideEntry({
    ctx,
    strings,
    react: fakeReact,
    mountPanel: () => ({ dispose() {} }),
  })
  assert.ok(handle)
  assert.equal(handle.immediate, false)
  assert.deepEqual(ctx.calls.inject, [['sidebarRightTabs']])
})

test('registerGuideEntry：既无服务也无 inject → 返回 null（旧宿主降级）', () => {
  const handle = registerGuideEntry({
    ctx: { get: () => undefined },
    strings,
    react: fakeReact,
  })
  assert.equal(handle, null)
})

test('registerGuideEntry：没有 React → 返回 null（宁可不接管，也不给空白页）', () => {
  const registry = createRegistry()
  const { ctx } = createCtx({ services: { sidebarRightTabs: registry } })
  const handle = registerGuideEntry({
    ctx,
    strings,
    react: null,
    mountPanel: () => ({ dispose() {} }),
  })
  assert.equal(handle, null)
  assert.equal(registry.state.registered.length, 0)
})

test('registerGuideEntry：没有 ctx / strings 时安全返回 null', () => {
  assert.equal(registerGuideEntry({ ctx: undefined, strings, react: fakeReact }), null)
  assert.equal(registerGuideEntry({ ctx: {}, strings: undefined, react: fakeReact }), null)
})

test('registerGuideEntry：dispose 之后晚到的服务不再注册', () => {
  const registry = createRegistry()
  const { ctx, pending } = createCtx({ services: {}, deferInject: true })
  const handle = registerGuideEntry({
    ctx,
    strings,
    react: fakeReact,
    mountPanel: () => ({ dispose() {} }),
  })
  assert.ok(handle)
  handle.dispose()

  pending[0].callback({ sidebarRightTabs: registry })
  assert.equal(registry.state.registered.length, 0)
})

test('SLOT_TAB_BODY 与宿主槽名一致', () => {
  assert.equal(SLOT_TAB_BODY, 'sidebar.right.pane.tab')
})

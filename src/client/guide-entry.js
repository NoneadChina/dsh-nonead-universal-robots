/**
 * src/client/guide-entry.js — 把「拓德UR数字孪生」注册成**正式的**开始页卡片。
 *
 * ## 为什么必须注册，而不是继续克隆 DOM
 * 右栏「开始」面板的卡片有两个消费者，读的都是同一个数据源：
 *   1. 宿主 shell 自带的引导列（`ShippedGuide`）；
 *   2. 第三方侧边栏插件 `dsh-better-sidebar`（它接管「开始」面板后自己渲染网格）。
 * 两者的数据源都是 `ctx.sidebarRightTabs.guide()`（better-sidebar 通过
 * `createNativeGuideCatalog(ctx)` 建的 `guideCatalog` 只是它的镜像）。
 *
 * 「调整顺序 / 隐藏 / 行预算 / 『更多』卡片」全部作用在这份 catalog 上
 * （`orderGuideEntries(guideInventory, prefs.guideOrder)`）。**DOM 克隆出来的卡片不在
 * catalog 里**，所以它能显示，却永远不进排序对话框 —— 这就是「调整顺序里看不到」的根因。
 *
 * 注册之后卡片由宿主渲染，位置/顺序/开关全部归宿主管，本插件不再克隆任何原生卡片。
 *
 * ## 正文也必须注册
 * 点击引导卡片走的是 `tab.actions.openTab(kind, { replaceTab: true })`（`guide.commandId`
 * **不是**点击行为）。只注册 guide 而不注册 tab 正文，点开就是一个空白页 —— 所以这里同时把
 * `sidebar.right.pane.tab` 的正文槽注册成一个 React 组件，组件内部再把现有的
 * `mountTwinPanel` DOM 挂进去（面板本体仍是纯 DOM，不需要重写）。
 *
 * ## React 从哪来
 * 插件 bundle 由宿主 `window.__ModuleLoader__.load({ factory: (require) => … })` 执行，
 * `require` 由宿主提供：`react` / `react-dom` / `react/jsx-runtime` 等 external 都可直接取
 * （`dsh-better-sidebar/lib/client.js` 首部即如此）。构建脚本把这些标记为 external，
 * 因此本文件**不在模块顶层**调用 `require`：拿不到 react 时整条注册链降级，DOM 克隆路径仍然生效。
 *
 * ## 时序
 * `sidebarRightTabs` / `slots` 可能比本 entry 晚就绪（cordis 声明触发式注册会读到
 * `undefined`）。因此先用 `ctx.get()` 同步探测，取不到再用 `ctx.inject([...])` 等它出现；
 * 注册成功的那一刻通过 `onRegistered()` 通知调用方撤掉保底的 DOM 克隆卡片。
 */

/** 注册 id：全局唯一（同一 id 二次注册会 throw）。包名是自然取值。 */
export const GUIDE_ENTRY_ID = 'dsh-nonead-universal-robots/twin'

/** tab 类型 kind：宿主用它把卡片点开成一个页。 */
export const GUIDE_ENTRY_KIND = 'nonead-ur-twin'

/** 右栏页正文的 slot 名（与 shell 的 `sidebar.right.pane.tab` 一致）。 */
export const SLOT_TAB_BODY = 'sidebar.right.pane.tab'

/**
 * 惰性取 React：只在浏览器 bundle 里可用（宿主 factory 提供的 `require`）。
 * node 测试里没有 `require`，返回 `null`，调用方据此跳过正文注册。
 */
export function getReact() {
  try {
    // eslint-disable-next-line no-undef -- bundle 由宿主 factory 注入 require
    if (typeof require === 'function') return require('react')
  } catch {
    /* 宿主没提供 react：降级 */
  }
  return null
}

/** 入口图标：一条轨道 + 圆心，风格与宿主引导列一致（纯 stroke，跟随 currentColor）。 */
export function createGuideIcon(react, size = 16) {
  const h = react.createElement
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
    h('path', { d: 'M12 3v3.5M12 17.5V21M4.6 7.6l3 1.75M16.4 14.65l3 1.75M4.6 16.4l3-1.75M16.4 9.35l3-1.75' }),
    h('circle', { cx: 12, cy: 12, r: 3.2 }),
  )
}

/**
 * 生成 `sidebarRightTabs.register()` 的声明对象。
 *
 * `title` / `description` 是函数：宿主每次渲染都重新取，因此语言切换后立刻是新文案
 * （本插件传入的 `strings` 是 `liveStrings()` 的 Proxy）。
 *
 * @param {{strings: {dockLabel: string, dockDescription: string}, react?: object|null}} options
 */
export function createGuideDefinition({ strings, react }) {
  const icon = react ? () => createGuideIcon(react) : undefined
  return {
    id: GUIDE_ENTRY_ID,
    kind: GUIDE_ENTRY_KIND,
    title: () => strings.dockLabel,
    guide: [
      {
        id: 'twin',
        order: 5,
        title: () => strings.dockLabel,
        description: () => strings.dockDescription,
        icon,
      },
    ],
  }
}

/**
 * tab 正文组件：一个铺满的容器，`useEffect` 里把现有数字孪生面板挂进去。
 *
 * 面板本体保持纯 DOM（`mountPanel` 返回 `{ dispose }`），React 只负责生命周期，
 * 这样 3D 场景代码不需要改写成 React 组件。
 */
export function createTabBody({ react, mountPanel }) {
  const h = react.createElement
  function UrTwinTabBody() {
    const ref = react.useRef(null)
    react.useEffect(() => {
      const element = ref.current
      if (!element) return undefined
      let handle
      try {
        handle = mountPanel(element)
      } catch {
        handle = undefined
      }
      return () => {
        try {
          handle?.dispose?.()
        } catch {
          /* 忽略 */
        }
      }
    }, [])
    return h('div', {
      className: 'dsh-ur-twin-tab-body',
      ref,
      style: { position: 'absolute', inset: '0', display: 'flex', minWidth: '0', minHeight: '0' },
    })
  }
  UrTwinTabBody.displayName = 'UrTwinTabBody'
  return UrTwinTabBody
}

/** 把任意返回 disposer 的函数安全地包成清理函数。 */
function toDisposer(value) {
  return typeof value === 'function' ? value : () => {}
}

/**
 * 注册正式的开始页卡片（guide entry + tab 正文）。
 *
 * @param {object} options
 * @param {object} options.ctx cordis 上下文
 * @param {object} options.strings `liveStrings()` 的 Proxy
 * @param {(container: Element) => ({dispose?: () => void})} options.mountPanel 面板挂载函数
 * @param {() => void} [options.onRegistered] 注册成功回调（调用方据此撤掉保底 DOM 克隆）
 * @param {object} [options.react] React 实例（缺省 `getReact()`；测试可注入假实现）
 * @returns {{immediate: boolean, dispose: () => void}|null}
 *   `immediate` 为 true 表示卡片已由宿主接管，调用方**不要**再挂 DOM 克隆；
 *   false 表示还在等服务就绪，调用方应先挂克隆兜底。返回 `null` 表示宿主不提供该能力，彻底降级。
 */
export function registerGuideEntry({ ctx, strings, mountPanel, onRegistered, react = getReact() }) {
  if (!ctx || !strings) return null
  /*
   * 没有 React 就**不**注册 guide：guide 卡片点开走 `openTab(kind)`，正文槽没注册就是一张空白页。
   * 宁可不接管卡片（回退 DOM 克隆，行为与旧版一致），也不要给用户一个点开就白的入口。
   */
  if (!react) return null
  const definition = createGuideDefinition({ strings, react })

  let disposed = false
  let notified = false
  let disposeTab = () => {}
  let disposeBody = () => {}
  let pendingDisposers = []
  let immediate = false

  const notifyRegistered = () => {
    if (notified || disposed) return
    notified = true
    try {
      onRegistered?.()
    } catch {
      /* 回调失败不影响注册结果 */
    }
  }

  const registerBody = () => {
    if (!react || typeof mountPanel !== 'function') return
    const slots = readService(ctx, 'slots')
    if (!slots || typeof slots.inject !== 'function') return
    try {
      const Body = createTabBody({ react, mountPanel })
      disposeBody = toDisposer(
        slots.inject(SLOT_TAB_BODY, () =>
          slots.register({ name: SLOT_TAB_BODY, key: GUIDE_ENTRY_ID }, Body),
        ),
      )
    } catch {
      disposeBody = () => {}
    }
  }

  const registerTab = (registry) => {
    try {
      disposeTab = toDisposer(registry.register(definition))
    } catch {
      disposeTab = () => {}
      return false
    }
    registerBody()
    notifyRegistered()
    return true
  }

  const tabs = readService(ctx, 'sidebarRightTabs')
  if (tabs && typeof tabs.register === 'function') {
    if (!registerTab(tabs)) return null
    immediate = true
  } else if (typeof ctx.inject !== 'function') {
    // 既没有服务、也没有等待能力：彻底降级（调用方回退 DOM 克隆）。
    return null
  } else {
    // 服务晚到：声明式等待。注册成功时由 notifyRegistered() 通知调用方拆掉克隆卡片。
    const off = waitForService(ctx, 'sidebarRightTabs', (registry) => {
      if (disposed) return
      if (!registerTab(registry)) return
      // slots 也可能晚于 sidebarRightTabs 就绪，正文单独等一次
      if (react && typeof mountPanel === 'function') {
        const slots = readService(ctx, 'slots')
        if (!slots || typeof slots.inject !== 'function') {
          pendingDisposers.push(
            waitForService(ctx, 'slots', () => {
              if (!disposed) registerBody()
            }),
          )
        }
      }
    })
    pendingDisposers.push(off)
  }

  return {
    immediate,
    dispose() {
      if (disposed) return
      disposed = true
      for (const off of pendingDisposers) {
        try {
          off?.()
        } catch {
          /* 忽略 */
        }
      }
      pendingDisposers = []
      try {
        disposeBody?.()
      } catch {
        /* 忽略 */
      }
      try {
        disposeTab?.()
      } catch {
        /* 忽略 */
      }
      disposeBody = () => {}
      disposeTab = () => {}
    },
  }
}

/** `ctx.get()` 取服务；cordis 对未声明服务可能抛，统一吞掉并返回 undefined。 */
function readService(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

/**
 * 等服务出现后再执行回调，返回退订函数。
 *
 * `ctx.inject([name], scope => …)` 是 cordis 的声明式等待：依赖就绪时回调执行一次。
 * 宿主没有 inject（旧版本/测试假 ctx）时直接视为不可用。
 */
function waitForService(ctx, name, callback) {
  if (typeof ctx.inject !== 'function') return () => {}
  try {
    return toDisposer(
      ctx.inject([name], (scope) => {
        const service = scope?.[name] ?? readService(scope ?? ctx, name)
        if (service) callback(service)
        return undefined
      }),
    )
  } catch {
    return () => {}
  }
}

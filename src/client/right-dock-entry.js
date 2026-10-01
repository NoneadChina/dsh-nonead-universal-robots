/**
 * src/client/right-dock-entry.js — 右侧栏（右 dock）入口卡片 + 右栏内嵌 3D 大视图。
 *
 * ## 为什么仍是 DOM 注入（沿用 Ruling 30）
 * DSH 的右 dock 也没有向外部插件开放注册插槽，唯一可行做法是把入口卡片**插进 shell 的 DOM**。
 * 位置：`[data-sidebar-right-guide="true"]`（右栏「开始」面板的引导列）**最后一个原生入口之后**，
 * 即「工作区文件 / 新建终端 / 浏览器」三张卡片的下面。锚点全部用 shell 的 `data-*` 钩子：
 * - `[data-sidebar-right-guide="true"]` 引导列容器（注入根）
 * - `[data-sidebar-right-guide-entry]` 原生入口卡片（定位"最后一张"；也用于"点了别的卡片就收起"）
 * - `[data-sidebar-right-tab]` 右栏 tab 内容体（由 guide 向上 `closest` 取得，**不是**同名的标签标题节点）
 * 不要用 `NXjQza_*` / `_keys_*` 这类 CSS Modules 哈希类名做锚点：它们随构建变化。
 *
 * ## 入口卡片：克隆原生卡片
 * 原生卡片的观感（白底、20px 圆角、图标槽、标题/描述层级、深浅色主题变量）全部由哈希类名承载，
 * 手工复刻必然漂移 ⇒ **优先深度克隆同列的一张原生卡片**，只改写图标、标题、描述，删掉快捷键提示。
 * 克隆节点没有 React fiber，shell 的委托 click 处理器不会命中它 ⇒ 点击只走本模块自己的监听。
 * 原生卡片不可用时退回自建卡片（保证"能插就插"，绝不抛错）。
 *
 * ## 3D 视图：流入式占位 + 隐藏引导列
 * 早先的做法是把 `position:absolute; inset:0` 的覆盖层插进内容体。**不可行**：该覆盖层的包含块是
 * 最近的定位祖先，实测并不是内容体（内容体自身 `position:static`，其父级虽 `relative` 但形状不同），
 * 结果覆盖层比右栏宽得多、压到对话区上方。
 * 现在的做法：把面板作为**正常流的 flex 子项**追加进内容体（内容体是 `display:flex; overflow:hidden`，
 * 高度确定），同时把引导列内联 `display:none`，面板自然精确占满右栏内容区。
 * 收起时移除面板并把引导列的内联样式还原（记录进入前的原值，不写死 `''`）。
 *
 * 覆盖层自带标题栏 + 收起按钮：引导列被隐藏后鼠标点不到原生卡片，必须留一个出口。
 *
 * ## 自愈：共用全局单例 hub
 * React 重渲染会把注入的卡片/覆盖层当"多余子节点"抹掉。本模块订阅 `./mutation-hub.js` 的
 * 全局单例 observer（登记在 `globalThis[MUTATION_HUB_KEY]`），每帧批量 reconcile：
 * 补齐卡片 + 补齐覆盖层。引导列消失 ⇒ 说明用户离开了「开始」面板 ⇒ 自动收起
 * （避免覆盖层盖在别的 tab 上）。
 *
 * ## 与中栏激活协议无关
 * 旧的中栏大视图（已删除的 `sidebar-entry.js`）要与 task-board / ssh 抢中栏，故有
 * `dsh-panel-activate` 协议。
 * 本模块占用的是右栏，不碰中栏 ⇒ **不派发、也不响应**该事件；`<html data-dsh-ur-twin-active>`
 * 也不再设置（那个标记的语义是"中栏被本插件盖住"）。
 *
 * ## 可测性（Ruling 31）
 * 本模块只经由**注入的 `doc`** 使用 DOM（`querySelector` / `createElement` / `cloneNode` /
 * `addEventListener` / `closest`），observer 与帧调度也可注入 ⇒ `test/right-dock-entry.test.mjs`
 * 用手写假 document 即可覆盖：插入位置 / 自愈 / 激活与收起 / 覆盖层挂载 / dispose。
 */

import { subscribeMutations } from './mutation-hub.js'
import { activeStrings } from './strings.js'

/* ------------------------------------------------------------------ *
 * 真实锚点与标记常量
 * ------------------------------------------------------------------ */

/** 右栏「开始」面板的引导列容器（**注入根**）。 */
export const RIGHT_GUIDE_SELECTOR = '[data-sidebar-right-guide="true"]'

/** 原生引导卡片（三张：files / terminal / browser）。 */
export const RIGHT_GUIDE_ENTRY_SELECTOR = '[data-sidebar-right-guide-entry]'

/** 右栏 tab 内容体（由 guide 向上 `closest` 取得；同名属性也出现在标签标题上）。 */
export const RIGHT_TAB_BODY_SELECTOR = '[data-sidebar-right-tab]'

/** 本插件入口卡片的标记属性。 */
export const RIGHT_ENTRY_ATTRIBUTE = 'data-dsh-ur-twin-right-entry'

/** 本插件入口卡片选择器。 */
export const RIGHT_ENTRY_SELECTOR = `[${RIGHT_ENTRY_ATTRIBUTE}]`

/** 右栏 3D 覆盖层的标记属性。 */
export const RIGHT_VIEW_ATTRIBUTE = 'data-dsh-ur-twin-right-view'

/** 覆盖层收起按钮的标记属性。 */
export const RIGHT_CLOSE_ATTRIBUTE = 'data-dsh-ur-twin-right-close'

/** 覆盖层内面板宿主（`mountPanel` 收到的容器）的标记属性。 */
export const RIGHT_PANEL_HOST_ATTRIBUTE = 'data-dsh-ur-twin-right-panel'

/** 入口卡片文案（与左栏入口保持一致）。 */
const S = activeStrings()

/** 入口标题（跟随当前语言）。 */
export const RIGHT_ENTRY_LABEL = S.dockLabel

/** 入口卡片描述（对齐原生卡片的「浏览网页」「在会话工作区运行命令」语气）。 */
export const RIGHT_ENTRY_DESCRIPTION = S.dockDescription

/** 覆盖层标题。 */
export const RIGHT_PANEL_TITLE = S.dockLabel

/* ------------------------------------------------------------------ *
 * 卡片图标（26px，对齐原生卡片的图标槽尺寸；用固定强调色融入三张卡片）
 * ------------------------------------------------------------------ */

const CARD_ICON =
  '<svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="#539CFA" ' +
  'stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M3 10.5V6.2l5-2.7 5 2.7v4.3"/><circle cx="8" cy="4.6" r="1.4"/>' +
  '<path d="M5.6 13.2 6.9 9.4M10.4 13.2 9.1 9.4M6.9 9.4h2.2"/></svg>'

/* ------------------------------------------------------------------ *
 * 退回自建卡片用的内联样式（原生卡片可用时不会用到）
 * ------------------------------------------------------------------ */

const FALLBACK_ENTRY_STYLE = {
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: '14px',
  width: '100%',
  padding: '14px 20px',
  border: '0.8px solid var(--dsw-alias-border-secondary, rgba(0, 0, 0, 0.12))',
  borderRadius: '20px',
  background: 'var(--dsw-alias-bg-elevated, #ffffff)',
  color: 'var(--dsw-alias-label-primary, #0f1115)',
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'left',
}

const FALLBACK_ICON_STYLE = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none',
}

const FALLBACK_TEXT_STYLE = { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' }

const FALLBACK_TITLE_STYLE = { fontSize: '14px', fontWeight: '500', lineHeight: '20px' }

const FALLBACK_DESCRIPTION_STYLE = {
  fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #6b7280)',
}

/* ------------------------------------------------------------------ *
 * 覆盖层样式（内联；不新增样式表）
 * ------------------------------------------------------------------ */

const OVERLAY_STYLE = {
  boxSizing: 'border-box',
  position: 'relative',
  flex: '1 1 auto',
  minWidth: '0',
  minHeight: '0',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: 'var(--dsw-alias-bg-base, #0d1117)',
}

const HEADER_STYLE = {
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  flex: '0 0 auto',
  padding: '8px 12px',
  borderBottom: '1px solid var(--dsw-alias-border-secondary, rgba(128, 128, 128, 0.24))',
  color: 'var(--dsw-alias-label-primary, #e6edf3)',
  fontSize: '13px',
  fontWeight: '600',
}

const TITLE_STYLE = { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

const CLOSE_STYLE = {
  flex: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '22px',
  height: '22px',
  padding: '0',
  border: 'none',
  borderRadius: '6px',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '13px',
  lineHeight: '1',
}

const HOST_STYLE = { position: 'relative', flex: '1 1 auto', minHeight: '0', overflow: 'hidden' }

/** 入口卡片激活态（原生卡片类名不知道，用描边表达选中）。 */
const ENTRY_ACTIVE_STYLE = {
  boxShadow: 'inset 0 0 0 1.5px var(--dsw-alias-brand-primary, #539CFA)',
}

/* ------------------------------------------------------------------ *
 * 小工具（对"缺失/极简环境"容错，绝不抛错）
 * ------------------------------------------------------------------ */

function registry() {
  return typeof globalThis === 'undefined' ? undefined : globalThis
}

function setStyle(el, props) {
  if (!el || !el.style) return
  for (const key of Object.keys(props)) el.style[key] = props[key]
}

function isConnected(node) {
  if (!node) return false
  if (typeof node.isConnected === 'boolean') return node.isConnected
  return node.parentElement !== null && node.parentElement !== undefined
}

/* ------------------------------------------------------------------ *
 * 入口卡片
 * ------------------------------------------------------------------ */

/** 深度克隆一张原生卡片并改写成本插件的入口；不可用时返回 undefined。 */
function cloneNativeEntry(doc) {
  const native = doc.querySelector(RIGHT_GUIDE_ENTRY_SELECTOR)
  if (!native || typeof native.cloneNode !== 'function') return undefined
  let clone
  try {
    clone = native.cloneNode(true)
  } catch {
    return undefined
  }
  if (!clone || typeof clone.querySelector !== 'function') return undefined

  // 去掉快捷键提示：按类名排除，只留图标槽与文案块（类名是哈希的，故用"保留白名单"）。
  for (const child of [...(clone.children ?? [])]) {
    const className = String(child?.className ?? '')
    if (!/entryIcon|entryText/.test(className)) {
      try {
        child.remove?.()
      } catch {
        /* 忽略 */
      }
    }
  }

  const icon = clone.querySelector('[class*="entryIcon"]')
  if (icon) icon.innerHTML = CARD_ICON
  const title = clone.querySelector('[class*="entryTitle"]')
  if (title) title.textContent = RIGHT_ENTRY_LABEL
  const description = clone.querySelector('[class*="entryDescription"]')
  if (description) description.textContent = RIGHT_ENTRY_DESCRIPTION

  clone.removeAttribute?.('data-sidebar-right-guide-entry')
  clone.removeAttribute?.('aria-keyshortcuts')
  if (typeof clone.className === 'string' && !clone.className.includes('entry')) {
    clone.className = 'dsh-ur-twin-right-entry'
  }
  return clone
}

/** 退回路径：原生卡片不可用时自建一张形似卡片。 */
function buildEntryElement(doc) {
  const entry = doc.createElement('button')
  entry.setAttribute('type', 'button')
  if (typeof entry.className === 'string') entry.className = 'dsh-ur-twin-right-entry'
  setStyle(entry, FALLBACK_ENTRY_STYLE)

  const icon = doc.createElement('span')
  icon.setAttribute('aria-hidden', 'true')
  icon.innerHTML = CARD_ICON
  setStyle(icon, FALLBACK_ICON_STYLE)

  const text = doc.createElement('span')
  setStyle(text, FALLBACK_TEXT_STYLE)
  const title = doc.createElement('span')
  title.textContent = RIGHT_ENTRY_LABEL
  setStyle(title, FALLBACK_TITLE_STYLE)
  const description = doc.createElement('span')
  description.textContent = RIGHT_ENTRY_DESCRIPTION
  setStyle(description, FALLBACK_DESCRIPTION_STYLE)
  text.appendChild(title)
  text.appendChild(description)

  entry.appendChild(icon)
  entry.appendChild(text)
  return entry
}

/**
 * 造入口卡片：优先克隆原生卡片（含哈希类名 ⇒ 观感/主题与三张卡片一致），
 * 原生卡片不可用时退回自建卡片。
 *
 * @returns {{element: Element, cloned: boolean}} `cloned=false` 表示走了退回路径，
 *   引导列稍后渲染出来时可升级为克隆卡片
 */
function createEntryElement(doc) {
  const cloned = cloneNativeEntry(doc)
  const entry = cloned ?? buildEntryElement(doc)
  entry.setAttribute(RIGHT_ENTRY_ATTRIBUTE, '')
  entry.setAttribute('data-dsh-plugin', 'ur-digital-twin')
  entry.setAttribute('aria-label', RIGHT_ENTRY_LABEL)
  entry.setAttribute('title', RIGHT_ENTRY_LABEL)
  entry.setAttribute('aria-pressed', 'false')
  return { element: entry, cloned: cloned !== undefined }
}

/* ------------------------------------------------------------------ *
 * 挂载
 * ------------------------------------------------------------------ */

/**
 * 挂载右栏入口卡片，并在右栏 tab 内容体内挂/收 3D 覆盖层。
 *
 * @param {object} [options]
 * @param {Document} [options.doc=globalThis.document] 目标文档（**唯一** DOM 入口，测试注入假对象）
 * @param {(active: boolean) => void} [options.onToggle] 激活状态变化通知（不参与状态决策）
 * @param {(container: Element) => ({dispose?: Function}|void)} [options.mountPanel]
 *        覆盖层就绪后调用一次（下标：本插件的 3D 视图，如 `mountTwinPanel`）；返回值需含 `dispose`
 * @param {Function} [options.MutationObserver] observer 实现注入点
 * @param {Function} [options.raf] 帧调度注入点
 * @param {Function} [options.caf] 帧取消注入点
 * @returns {{dispose: () => void, isActive: () => boolean, toggle: () => void, setActive: (active: boolean) => void}}
 *          幂等句柄（无可用 doc 时是安全空转句柄）
 */
export function mountRightDockEntry({
  doc = registry()?.document,
  onToggle,
  mountPanel,
  MutationObserver: ObserverImpl,
  raf,
  caf,
} = {}) {
  if (!doc || typeof doc.createElement !== 'function' || typeof doc.querySelector !== 'function') {
    return { dispose() {}, isActive: () => false, toggle() {}, setActive() {} }
  }

  const options = { MutationObserver: ObserverImpl, raf, caf }

  let disposed = false
  let active = false
  let entry
  let entryCloned = false
  let overlay
  let panelHost
  let panel
  let hiddenGuide
  let hiddenGuideDisplay
  let unsubscribeMutations = () => {}

  /* ---------------- 入口卡片 ---------------- */

  /** 引导列容器（原生卡片所在列）。 */
  const guideRoot = () => doc.querySelector(RIGHT_GUIDE_SELECTOR)

  /**
   * 入口卡片缺失或被 React 抹掉时重新插回（插在最后一张原生卡片之后）。
   *
   * 卡片**延迟到引导列就绪时才创建**：插件在客户端启动时就挂载，那时右栏往往还没渲染
   * （原生卡片取不到 ⇒ 只能退回自建卡片）。若首次创建时没有原生卡片可克隆，而之后引导列
   * 渲染出来了，这里把它**升级**为克隆卡片，保持与三张原生卡片外观一致。
   */
  const ensureEntry = () => {
    if (disposed) return
    const guide = guideRoot()
    if (!guide || typeof guide.appendChild !== 'function') return

    const native = doc.querySelector(RIGHT_GUIDE_ENTRY_SELECTOR)
    // 只在**确实能克隆**时才升级，否则退回卡片会被每帧重建。
    const canClone = native !== null && typeof native.cloneNode === 'function'
    const upgradeable = entry !== undefined && !entryCloned && canClone

    // 已在位且无需升级：什么都不做（自愈重插也必须复用同一个节点，不能每帧重建）。
    if (entry !== undefined && isConnected(entry) && !upgradeable) return

    if (upgradeable) {
      try {
        entry.removeEventListener?.('click', onClick)
      } catch {
        /* 忽略 */
      }
      try {
        entry.remove?.()
      } catch {
        /* 忽略 */
      }
      entry = undefined
    }

    if (entry === undefined) {
      const created = createEntryElement(doc)
      entry = created.element
      entryCloned = created.cloned
      entry.addEventListener('click', onClick)
    }

    paintActive()
    guide.appendChild(entry)
  }

  /* ---------------- 右栏 3D 面板 ---------------- */

  /** 进入孪生视图时隐藏引导列（记录原内联值，收起时还原）。 */
  const hideGuide = () => {
    const guide = guideRoot()
    if (!guide || hiddenGuide === guide) return
    showGuide()
    hiddenGuide = guide
    hiddenGuideDisplay = guide.style?.display ?? ''
    setStyle(guide, { display: 'none' })
  }

  /** 还原引导列（可能已被 React 换成新节点，还原旧节点是无害的）。 */
  const showGuide = () => {
    if (!hiddenGuide) return
    setStyle(hiddenGuide, { display: hiddenGuideDisplay ?? '' })
    hiddenGuide = undefined
    hiddenGuideDisplay = undefined
  }

  /** 覆盖层容器：从引导列向上找 tab 内容体（同名属性也在标签标题上，不能直接 querySelector）。 */
  const overlayHost = () => {
    const guide = guideRoot()
    if (!guide || typeof guide.closest !== 'function') return undefined
    let body
    try {
      body = guide.closest(RIGHT_TAB_BODY_SELECTOR)
    } catch {
      return undefined
    }
    return body && typeof body.appendChild === 'function' ? body : undefined
  }

  const createOverlay = () => {
    const root = doc.createElement('div')
    root.setAttribute(RIGHT_VIEW_ATTRIBUTE, '')
    root.setAttribute('data-dsh-plugin', 'ur-digital-twin')
    setStyle(root, OVERLAY_STYLE)

    const header = doc.createElement('div')
    setStyle(header, HEADER_STYLE)
    const title = doc.createElement('span')
    title.textContent = RIGHT_PANEL_TITLE
    setStyle(title, TITLE_STYLE)
    const close = doc.createElement('button')
    close.setAttribute('type', 'button')
    close.setAttribute(RIGHT_CLOSE_ATTRIBUTE, '')
    close.setAttribute('aria-label', S.dockCollapse)
    close.setAttribute('title', S.dockCollapse)
    close.textContent = '✕'
    setStyle(close, CLOSE_STYLE)
    close.addEventListener('click', onCloseClick)
    header.appendChild(title)
    header.appendChild(close)

    const host = doc.createElement('div')
    host.setAttribute(RIGHT_PANEL_HOST_ATTRIBUTE, '')
    setStyle(host, HOST_STYLE)

    root.appendChild(header)
    root.appendChild(host)
    panelHost = host
    return root
  }

  const teardownOverlay = () => {
    if (panel) {
      try {
        panel.dispose?.()
      } catch {
        /* 面板自身的问题，吞掉 */
      }
      panel = undefined
    }
    if (overlay) {
      try {
        overlay.remove?.()
      } catch {
        /* 忽略 */
      }
      overlay = undefined
    }
    panelHost = undefined
    showGuide()
  }

  /** 保证面板存在（内容体/引导列都可能尚未挂载：只做"能挂就挂"，其余等下一次 flush）。 */
  const ensureOverlay = () => {
    if (disposed || !active) return
    if (overlay && !isConnected(overlay)) teardownOverlay()
    if (!overlay) {
      const host = overlayHost()
      if (!host) return
      overlay = createOverlay()
      host.appendChild(overlay)
      hideGuide()
    }
    // 引导列可能被 React 换成新节点 ⇒ 每次 flush 都重新压住当前那一个。
    hideGuide()
    if (panel || typeof mountPanel !== 'function' || !panelHost) return
    try {
      panel = mountPanel(panelHost) ?? undefined
    } catch {
      panel = undefined
    }
  }

  /* ---------------- 激活状态 ---------------- */

  const paintActive = () => {
    if (!entry) return
    entry.setAttribute('aria-pressed', active ? 'true' : 'false')
    if (active) entry.setAttribute('data-active', '')
    else entry.removeAttribute('data-active')
    setStyle(entry, active ? ENTRY_ACTIVE_STYLE : { boxShadow: '' })
  }

  const setActive = (next) => {
    if (disposed) return
    const wanted = next === true
    if (wanted === active) {
      if (wanted) ensureOverlay()
      return
    }
    active = wanted
    paintActive()
    if (active) ensureOverlay()
    else teardownOverlay()
    if (typeof onToggle === 'function') {
      try {
        onToggle(active)
      } catch {
        /* 回调自身的问题，吞掉 */
      }
    }
  }

  const toggle = () => setActive(!active)

  function onClick(event) {
    event?.preventDefault?.()
    toggle()
  }

  function onCloseClick(event) {
    event?.preventDefault?.()
    setActive(false)
  }

  /** 用户点了别的引导卡片（工作区文件 / 新建终端 / 浏览器）⇒ 收起，别盖住对方。 */
  const onDocumentClick = (event) => {
    if (disposed || !active) return
    const target = event?.target
    if (!target || typeof target.closest !== 'function') return
    if (target === entry || entry?.contains?.(target)) return
    let hit = null
    try {
      hit = target.closest(RIGHT_GUIDE_ENTRY_SELECTOR)
    } catch {
      hit = null
    }
    if (hit) setActive(false)
  }

  /** observer flush：补齐卡片 + 补齐覆盖层；引导列消失说明用户离开了「开始」面板。 */
  const reconcile = () => {
    if (disposed) return
    ensureEntry()
    if (active) {
      if (guideRoot() === null || guideRoot() === undefined) setActive(false)
      else ensureOverlay()
    }
  }

  /* ---------------- 启动与清理 ---------------- */

  doc.addEventListener?.('click', onDocumentClick, true)
  unsubscribeMutations = subscribeMutations(doc, options, reconcile)
  ensureEntry()

  return {
    isActive: () => active,
    toggle,
    setActive,
    dispose() {
      if (disposed) return
      disposed = true
      try {
        unsubscribeMutations()
      } catch {
        /* 忽略 */
      }
      unsubscribeMutations = () => {}
      try {
        doc.removeEventListener?.('click', onDocumentClick, true)
      } catch {
        /* 忽略 */
      }
      try {
        entry?.removeEventListener?.('click', onClick)
      } catch {
        /* 忽略 */
      }
      teardownOverlay()
      try {
        entry?.remove?.()
      } catch {
        /* 忽略 */
      }
      entry = undefined
      active = false
    },
  }
}

/**
 * test/right-dock-entry.test.mjs — 右栏入口卡片 + 右栏 3D 覆盖层。
 *
 * 本环境**没有 DOM**：这里手写一个够用的假 document（querySelector / createElement /
 * cloneNode / closest / addEventListener + 可受控触发的假 MutationObserver），覆盖：
 *   ① 卡片插在引导列**最后一张原生卡片之后**，且改写成本插件文案、去掉快捷键提示
 *   ② 原生卡片不可克隆时退回自建卡片（仍带标记属性）
 *   ③ 被 React 抹掉后，**下一次 observer 触发**时重新插入（自愈）
 *   ④ 点击卡片 → 右栏 tab 内容体内出现覆盖层与面板宿主，`mountPanel` 恰好调用一次
 *   ⑤ 再次点击 / 覆盖层收起按钮 / 点击别的引导卡片 → 收起并 dispose 面板
 *   ⑥ 引导列消失（用户离开「开始」面板）→ 下一次 flush 自动收起
 *   ⑦ `dispose()` 摘 DOM、断开 observer、移除监听（且幂等）
 *
 * 运行：node --test test/right-dock-entry.test.mjs
 * （**不要**用 npm test：当前沙箱下 npm 的 piped stdio 会 spawn EPERM）
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  RIGHT_CLOSE_ATTRIBUTE,
  RIGHT_ENTRY_ATTRIBUTE,
  RIGHT_ENTRY_DESCRIPTION,
  RIGHT_ENTRY_LABEL,
  RIGHT_GUIDE_SELECTOR,
  RIGHT_PANEL_HOST_ATTRIBUTE,
  RIGHT_VIEW_ATTRIBUTE,
  mountRightDockEntry,
} from '../src/client/right-dock-entry.js'
import { resetMutationHub } from '../src/client/mutation-hub.js'

/* ================================================================== *
 * 假 DOM
 * ================================================================== */

/** 支持的选择器子集：`[attr]`、`[attr="v"]`、`[class*="v"]`、标签名、逗号分隔。 */
function matchesSimple(el, simple) {
  if (!simple) return false
  if (!simple.startsWith('[')) return el.tagName.toLowerCase() === simple.toLowerCase()
  const m = /^\[([\w-]+)(?:([*^$~|]?=)"([^"]*)")?\]$/.exec(simple)
  if (!m) return false
  const [, name, op, value] = m
  if (op === undefined) return el.hasAttribute(name)
  const raw = el.getAttribute(name)
  if (raw === null || raw === undefined) return false
  const actual = String(raw)
  if (op === '*=') return actual.includes(value)
  return actual === value
}

function matchesSelector(el, selector) {
  return String(selector).split(',').some((part) => matchesSimple(el, part.trim()))
}

class FakeElement {
  constructor(tagName, { cloneable = true } = {}) {
    this.tagName = String(tagName).toUpperCase()
    this.children = []
    this.parentNode = null
    this.attributes = new Map()
    this.style = {}
    this.listeners = new Map()
    this.ownerDocument = null
    this.innerHTML = ''
    this.__text = undefined
    this.__root = false
    // 不可克隆的实例**不提供** cloneNode（真实环境里老浏览器/极简 DOM 就是这个样子）。
    if (!cloneable) this.cloneNode = undefined
  }

  /** 与真实 DOM 一致：设置即清空子节点；读取时聚合子节点文本。 */
  get textContent() {
    if (this.children.length > 0) return this.children.map((child) => child.textContent).join('')
    return this.__text ?? ''
  }

  set textContent(value) {
    this.__text = String(value)
    for (const child of [...this.children]) this.removeChild(child)
  }

  get className() {
    return this.attributes.get('class') ?? ''
  }

  set className(value) {
    this.attributes.set('class', String(value))
  }

  get parentElement() {
    return this.parentNode
  }

  get isConnected() {
    let node = this
    while (node.parentNode) node = node.parentNode
    return node.__root === true
  }

  appendChild(node) {
    node.parentNode?.removeChild(node)
    this.children.push(node)
    node.parentNode = this
    if (!node.ownerDocument) node.ownerDocument = this.ownerDocument
    return node
  }

  removeChild(node) {
    const i = this.children.indexOf(node)
    if (i >= 0) this.children.splice(i, 1)
    node.parentNode = null
    return node
  }

  remove() {
    this.parentNode?.removeChild(this)
  }

  contains(node) {
    let cursor = node
    while (cursor) {
      if (cursor === this) return true
      cursor = cursor.parentNode
    }
    return false
  }

  matches(selector) {
    return matchesSelector(this, selector)
  }

  closest(selector) {
    let node = this
    while (node) {
      if (matchesSelector(node, selector)) return node
      node = node.parentNode
    }
    return null
  }

  querySelector(selector) {
    return descend(this, selector)[0] ?? null
  }

  querySelectorAll(selector) {
    return descend(this, selector)
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  removeAttribute(name) {
    this.attributes.delete(name)
  }

  addEventListener(type, fn) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(fn)
    this.listeners.set(type, set)
  }

  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn)
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0
  }

  /** 深度克隆（含子节点、属性、文本）；`cloneable: false` 的实例没有这个方法。 */
  cloneNode() {
    const copy = new FakeElement(this.tagName)
    for (const [name, value] of this.attributes) copy.attributes.set(name, value)
    copy.innerHTML = this.innerHTML
    if (this.__text !== undefined) copy.__text = this.__text
    for (const child of this.children) copy.appendChild(child.cloneNode(true))
    return copy
  }

  /** 近似冒泡：先自身、再祖先，最后 document（capture 与 bubble 不区分，够用即可）。 */
  dispatchEvent(event) {
    const ev = event ?? {}
    if (ev.target === undefined) ev.target = this
    ev.preventDefault = ev.preventDefault ?? (() => {})
    let node = this
    while (node) {
      const fns = node.listeners?.get(ev.type)
      if (fns) for (const fn of [...fns]) fn(ev)
      node = node.parentNode
    }
    if (this.ownerDocument?.dispatchEvent) this.ownerDocument.dispatchEvent(ev)
    return true
  }
}

function descend(el, selector, out = []) {
  for (const child of el.children) {
    if (matchesSelector(child, selector)) out.push(child)
    descend(child, selector, out)
  }
  return out
}

/**
 * 搭一个右栏最小骨架：
 * ```
 * body > section[data-sidebar-right-tab] > guide[data-sidebar-right-guide] > files/terminal/browser
 * ```
 * @param {object} [options]
 * @param {boolean} [options.cloneable=true] 原生卡片是否可克隆（false 走退回路径）
 */
function createFakeDom({ cloneable = true } = {}) {
  const html = new FakeElement('html')
  html.__root = true
  const body = new FakeElement('body')
  html.appendChild(body)

  const docListeners = new Map()
  const observers = []

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      observers.push(this)
    }

    observe(target, options) {
      this.target = target
      this.options = options
    }

    disconnect() {
      this.disconnected = true
    }

    takeRecords() {
      return []
    }

    trigger(records = [{ type: 'childList' }]) {
      if (this.disconnected) return
      this.callback(records, this)
    }
  }

  const tabBody = new FakeElement('div')
  tabBody.setAttribute('data-sidebar-right-tab', 'tab4')
  body.appendChild(tabBody)

  const guide = new FakeElement('div')
  guide.setAttribute('data-sidebar-right-guide', 'true')
  tabBody.appendChild(guide)

  const nativeCards = {}
  for (const id of ['files', 'terminal', 'browser']) {
    const card = new FakeElement(id === 'terminal' ? 'div' : 'button', { cloneable })
    card.setAttribute('data-sidebar-right-guide-entry', id)
    card.className = 'NXjQza_entry'
    const icon = new FakeElement('span')
    icon.className = 'NXjQza_entryIcon'
    icon.innerHTML = '<svg id="native-icon"></svg>'
    const text = new FakeElement('span')
    text.className = 'NXjQza_entryText'
    const title = new FakeElement('span')
    title.className = 'NXjQza_entryTitle'
    title.textContent = id
    const description = new FakeElement('span')
    description.className = 'NXjQza_entryDescription'
    description.textContent = `${id} 描述`
    text.appendChild(title)
    text.appendChild(description)
    const keys = new FakeElement('span')
    keys.className = '_keys_hash_1'
    card.appendChild(icon)
    card.appendChild(text)
    card.appendChild(keys)
    guide.appendChild(card)
    nativeCards[id] = card
  }

  const document_ = {
    body,
    documentElement: html,
    defaultView: { MutationObserver: FakeMutationObserver },
    createElement: (tag) => {
      const el = new FakeElement(tag)
      el.ownerDocument = document_
      return el
    },
    querySelector: (selector) => descend(body, selector).concat(matchesSelector(body, selector) ? [body] : [])[0] ?? null,
    querySelectorAll: (selector) => descend(body, selector),
    getElementById: () => null,
    addEventListener(type, fn) {
      const set = docListeners.get(type) ?? new Set()
      set.add(fn)
      docListeners.set(type, set)
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn)
    },
    dispatchEvent(event) {
      const fns = docListeners.get(event.type)
      if (fns) for (const fn of [...fns]) fn(event)
      return true
    },
    listenerCount(type) {
      return docListeners.get(type)?.size ?? 0
    },
  }
  body.ownerDocument = document_
  html.ownerDocument = document_

  // 先建骨架、后才有 document 对象 ⇒ 这里把 ownerDocument 补播到所有已有节点
  // （元素 dispatchEvent 依赖它把事件送到 document 级监听器）。
  const bindOwner = (node) => {
    node.ownerDocument = document_
    for (const child of node.children) bindOwner(child)
  }
  bindOwner(html)

  return { document: document_, body, tabBody, guide, nativeCards, observers }
}

/** 引导列里本插件的卡片。 */
const pluginEntry = (dom) => dom.guide.querySelector(`[${RIGHT_ENTRY_ATTRIBUTE}]`)
/** 覆盖层。 */
const overlayOf = (dom) => dom.tabBody.querySelector(`[${RIGHT_VIEW_ATTRIBUTE}]`)

/* ================================================================== *
 * 用例
 * ================================================================== */

beforeEach(() => {
  resetMutationHub()
})

afterEach(() => {
  resetMutationHub()
})

test('① 卡片插在引导列最后一张原生卡片之后，并改写成本插件文案', () => {
  const dom = createFakeDom()
  const handle = mountRightDockEntry({ doc: dom.document })

  const entry = pluginEntry(dom)
  assert.ok(entry, '入口卡片应已注入')
  assert.equal(dom.guide.children[dom.guide.children.length - 1], entry, '应插在最后（三张原生卡片之下）')
  assert.equal(dom.guide.children.length, 4)
  assert.equal(entry.querySelector('[class*="entryTitle"]').textContent, RIGHT_ENTRY_LABEL)
  assert.equal(entry.querySelector('[class*="entryDescription"]').textContent, RIGHT_ENTRY_DESCRIPTION)
  assert.equal(entry.hasAttribute('data-sidebar-right-guide-entry'), false, '不能冒充原生引导卡片')
  assert.equal(entry.hasAttribute('aria-keyshortcuts'), false, '没有快捷键就不该留快捷键提示')
  assert.equal(entry.children.length, 2, '快捷键提示应被摘掉，只剩图标槽与文案块')
  assert.match(entry.querySelector('[class*="entryIcon"]').innerHTML, /<svg/)
  assert.equal(entry.getAttribute('aria-pressed'), 'false')

  handle.dispose()
})

test('② 原生卡片不可克隆时退回自建卡片，仍带标记属性', () => {
  const dom = createFakeDom({ cloneable: false })
  const handle = mountRightDockEntry({ doc: dom.document })

  const entry = pluginEntry(dom)
  assert.ok(entry, '退回路径也应注入卡片')
  assert.equal(entry.tagName, 'BUTTON')
  assert.equal(entry.textContent.includes(RIGHT_ENTRY_LABEL), true)
  assert.equal(entry.textContent.includes(RIGHT_ENTRY_DESCRIPTION), true)
  assert.equal(dom.guide.children.length, 4)

  handle.dispose()
})

test('③ 被 React 抹掉后，下一次 observer flush 重新插入（自愈）', () => {
  const dom = createFakeDom()
  const handle = mountRightDockEntry({ doc: dom.document })
  const entry = pluginEntry(dom)

  entry.remove()
  assert.equal(pluginEntry(dom), null)

  dom.observers[0].trigger()
  assert.equal(pluginEntry(dom), entry, '应插回同一个节点')
  assert.equal(dom.guide.children[dom.guide.children.length - 1], entry)

  handle.dispose()
})

test('④ 点击卡片 → 右栏 tab 内容体内出现覆盖层与面板宿主，mountPanel 调用一次', () => {
  const dom = createFakeDom()
  const mounts = []
  const disposed = []
  const toggles = []
  const handle = mountRightDockEntry({
    doc: dom.document,
    onToggle: (active) => toggles.push(active),
    mountPanel: (container) => {
      mounts.push(container)
      return { dispose: () => disposed.push(true) }
    },
  })

  assert.equal(overlayOf(dom), null, '未激活时不应有覆盖层')
  assert.equal(dom.guide.style.display, undefined, '未激活时引导列不该被改写')

  pluginEntry(dom).dispatchEvent({ type: 'click' })

  const overlay = overlayOf(dom)
  assert.ok(overlay, '激活后应出现覆盖层')
  assert.equal(overlay.parentNode, dom.tabBody, '覆盖层挂在右栏 tab 内容体里')
  assert.equal(dom.guide.style.display, 'none', '进入孪生视图要隐藏引导列（否则两张卡并排）')
  const host = overlay.querySelector(`[${RIGHT_PANEL_HOST_ATTRIBUTE}]`)
  assert.ok(host, '覆盖层内应有面板宿主')
  assert.equal(mounts.length, 1)
  assert.equal(mounts[0], host)
  assert.equal(handle.isActive(), true)
  assert.equal(pluginEntry(dom).getAttribute('aria-pressed'), 'true')
  assert.deepEqual(toggles, [true])

  // 重复 flush 不应重复挂载面板
  dom.observers[0].trigger()
  assert.equal(mounts.length, 1)

  handle.dispose()
})

test('⑤ 再次点击卡片 / 覆盖层收起按钮 / 点击别的引导卡片 → 收起并 dispose 面板', () => {
  const dom = createFakeDom()
  const disposed = []
  const handle = mountRightDockEntry({
    doc: dom.document,
    mountPanel: () => ({ dispose: () => disposed.push(true) }),
  })

  // 再次点击卡片
  pluginEntry(dom).dispatchEvent({ type: 'click' })
  assert.ok(overlayOf(dom))
  assert.equal(dom.guide.style.display, 'none')
  pluginEntry(dom).dispatchEvent({ type: 'click' })
  assert.equal(overlayOf(dom), null)
  assert.equal(dom.guide.style.display, '', '收起后要还原引导列')
  assert.equal(disposed.length, 1)
  assert.equal(handle.isActive(), false)

  // 覆盖层收起按钮
  pluginEntry(dom).dispatchEvent({ type: 'click' })
  const close = overlayOf(dom).querySelector(`[${RIGHT_CLOSE_ATTRIBUTE}]`)
  assert.ok(close, '覆盖层应有收起按钮')
  close.dispatchEvent({ type: 'click' })
  assert.equal(overlayOf(dom), null)
  assert.equal(disposed.length, 2)

  // 点击别的引导卡片（工作区文件）
  pluginEntry(dom).dispatchEvent({ type: 'click' })
  assert.ok(overlayOf(dom))
  dom.nativeCards.files.dispatchEvent({ type: 'click' })
  assert.equal(overlayOf(dom), null)
  assert.equal(disposed.length, 3)

  handle.dispose()
})

test('⑥ 引导列消失（离开「开始」面板）→ 下一次 flush 自动收起；回来再自愈', () => {
  const dom = createFakeDom()
  const handle = mountRightDockEntry({ doc: dom.document })

  pluginEntry(dom).dispatchEvent({ type: 'click' })
  assert.ok(overlayOf(dom))

  dom.guide.remove()
  dom.observers[0].trigger()
  assert.equal(handle.isActive(), false, '引导列消失应自动收起')
  assert.equal(overlayOf(dom), null)

  dom.tabBody.appendChild(dom.guide)
  dom.observers[0].trigger()
  assert.ok(pluginEntry(dom), '回到该面板后卡片应自愈插回')
  assert.equal(handle.isActive(), false, '自愈不应自行激活')

  handle.dispose()
})

test('⑦ dispose 摘 DOM、断开 observer、移除监听，且幂等', () => {
  const dom = createFakeDom()
  const handle = mountRightDockEntry({ doc: dom.document })

  const observer = dom.observers[0]
  assert.equal(dom.document.listenerCount('click'), 1)

  handle.dispose()

  assert.equal(pluginEntry(dom), null, '卡片应被摘掉')
  assert.equal(overlayOf(dom), null)
  assert.equal(observer.disconnected, true, 'observer 应断开')
  assert.equal(dom.document.listenerCount('click'), 0, 'document 监听应移除')

  handle.dispose()
  assert.equal(pluginEntry(dom), null)
})

test('⑧ 无可用 doc 时返回安全空转句柄', () => {
  const handle = mountRightDockEntry({ doc: undefined })
  assert.equal(handle.isActive(), false)
  handle.toggle()
  handle.setActive(true)
  handle.dispose()
  assert.equal(handle.isActive(), false)
})

test('⑨ 引导列尚未挂载时不抛错，出现后由 flush 补齐', () => {
  const dom = createFakeDom()
  dom.guide.remove()

  const handle = mountRightDockEntry({ doc: dom.document })
  assert.equal(pluginEntry(dom), null)

  handle.toggle()
  assert.equal(overlayOf(dom), null, '容器缺失时激活不抛错、也不挂空覆盖层')

  dom.tabBody.appendChild(dom.guide)
  dom.observers[0].trigger()
  assert.ok(pluginEntry(dom), '卡片补齐')
  assert.ok(overlayOf(dom), '已激活 ⇒ 覆盖层补齐')

  handle.dispose()
})

test('⑩ 全局单例 observer：再次挂载不新建 observer', () => {
  const dom = createFakeDom()
  const first = mountRightDockEntry({ doc: dom.document })
  assert.equal(dom.observers.length, 1)

  const second = mountRightDockEntry({ doc: dom.document })
  assert.equal(dom.observers.length, 1, '两处挂载点共用同一个 hub')

  first.dispose()
  second.dispose()
  assert.equal(RIGHT_GUIDE_SELECTOR, '[data-sidebar-right-guide="true"]')
})

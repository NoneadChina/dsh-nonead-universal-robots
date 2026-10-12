/**
 * src/client/theme.js — 孪生面板跟随桌面程序的颜色主题。
 *
 * ## 为什么需要它（CSS 跟上了，3D 还跟不上）
 * 面板的 DOM 部分（工具栏、HUD、状态行）用 `--dsw-alias-*` token 着色即可自动跟随 —— 见
 * `styles.js`。但 **WebGL 画布里的东西 CSS 够不到**：网格线色、回退机械臂的材质色、轨迹线色
 * 都写在 three.js 的材质里，必须在主题变化时由 JS 自己重刷。
 *
 * ## 主题真源
 * 宿主（DSH 客户端）把主题快照投影到 document：深色时 `body` 带 `data-ds-dark-theme`，浅色时
 * 该属性被移除；同时 `html{color-scheme}` 与 body 上的 `--dsw-alias-*` 一并翻转。
 *
 * ⚠️ **只认这个布尔属性**：不要在没有它的时候退回 `prefers-color-scheme` ——
 * 「浅色主题 + 深色系统」会被判反（系统是深色，但宿主被设成了浅色）。
 */

/** 宿主投影深色主题用的布尔属性（深色时存在、浅色时移除）。 */
export const DARK_THEME_ATTRIBUTE = 'data-ds-dark-theme'

/**
 * 当前是否为深色主题。
 *
 * 拿不到 `body`（Node/极简宿主）时返回 `false`（浅色）—— 与"宿主没有投影层"时
 * CSS fallback 的观感一致。
 *
 * @param {Document} [doc=globalThis.document] 目标文档
 * @returns {boolean}
 */
export function isDarkTheme(doc = globalThis.document) {
  const body = doc?.body
  if (body === null || body === undefined || typeof body.hasAttribute !== 'function') return false
  return body.hasAttribute(DARK_THEME_ATTRIBUTE) === true
}

/**
 * 3D 侧色板：只收「不随 token 走、且对比度敏感」的四项。
 *
 * 其余颜色**刻意不收**：TCP 轴 XYZ 是几何约定色、安全警示/待审批是语义色（与 CSS 的
 * `state-error|warn-primary` 呼应），它们在两种主题下都可读，搬进来只会徒增漂移面。
 */
export const TWIN_3D_PALETTES = Object.freeze({
  dark: Object.freeze({
    gridMajor: 0x334455,
    gridMinor: 0x223344,
    fallbackArm: 0x8899aa,
    trajectory: 0x35d0ff,
  }),
  light: Object.freeze({
    // 浅色主题下深色网格几乎糊成一片、亮青轨迹在白底上发飘，所以两项都换成对应更深的色。
    gridMajor: 0x9aa7b4,
    gridMinor: 0xc6cfd8,
    fallbackArm: 0x6b7785,
    trajectory: 0x1f6feb,
  }),
})

/**
 * 按主题取 3D 色板。
 *
 * @param {boolean} dark 是否深色主题
 * @returns {{gridMajor: number, gridMinor: number, fallbackArm: number, trajectory: number}}
 */
export function twin3dPalette(dark) {
  return dark ? TWIN_3D_PALETTES.dark : TWIN_3D_PALETTES.light
}

/**
 * 监听主题切换（观察 `body` 上的深色属性），变化时回调新的 `dark` 值。
 *
 * 返回取消函数，可安全重复调用；环境不支持 `MutationObserver` 时返回一个空操作，
 * **绝不抛错**（面板挂载不得因为主题观察失败而失败）。
 *
 * @param {(dark: boolean) => void} listener 主题变化回调
 * @param {Document} [doc=globalThis.document] 目标文档
 * @returns {() => void} 取消观察
 */
export function observeTheme(listener, doc = globalThis.document) {
  const body = doc?.body
  const Observer = globalThis.MutationObserver
  if (body === null || body === undefined || typeof Observer !== 'function') return () => {}
  const observer = new Observer(() => {
    try {
      listener(isDarkTheme(doc))
    } catch {
      /* 监听者自身的问题不得影响观察本身 */
    }
  })
  observer.observe(body, { attributes: true, attributeFilter: [DARK_THEME_ATTRIBUTE] })
  return () => {
    try {
      observer.disconnect()
    } catch {
      /* 已断开 */
    }
  }
}

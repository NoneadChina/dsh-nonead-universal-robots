/**
 * src/client/styles.js — 数字孪生面板的样式（**JS 字符串**，不是 .css 文件）。
 *
 * ## Ruling 28（为什么要用字符串注入）
 * 客户端产物只有单个 `client.js`，shell **不会**加载同目录的任何 `.css`。
 * esbuild 默认把 `import './x.css'` 输出成**独立文件**（`client.css`），shell 不加载它
 * ⇒ 样式静默全丢（不报错、不失败，只是没样式）。既定做法（本机已装插件
 * `@linxin666/dsh-client-ui-task-board`、`dsh-dream-skin`）是
 * `document.createElement('style')` + `textContent = <CSS 字符串>` 注入。
 * ⇒ 本模块导出 CSS 字符串与幂等的 `injectStyles()`，**不要**新增 `.css` 文件。
 *
 * ## 幂等
 * `injectStyles()` 以固定 id 复用已存在的 `<style>`：多次挂载（大视图反复开关、
 * 缩略图 + 大视图并存）只注入一份样式，也不会互相覆盖。样式是**共享**资源，
 * 故面板 `dispose()` **不**移除它（另一个实例可能还在用，而且移除后无法再复用）。
 */

/** 注入用的 `<style>` 元素 id（幂等复用的键）。 */
export const TWIN_STYLE_ID = 'dsh-ur-twin-styles'

/** `<style>` 上的标记属性（便于宿主/测试识别来源）。 */
export const TWIN_STYLE_ATTR = 'data-dsh-ur-twin-style'

/** 面板样式表（单一真源；改样式只改这里）。 */
export const TWIN_CSS = `
.ur-twin-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: radial-gradient(circle at 50% 25%, #161b22 0%, #0b0f14 72%);
  color: #c9d1d9;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
}
.ur-twin-view {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}
/*
 * 视角工具栏。以前面板里唯一的控件是一个画布 —— OrbitControls 允许把相机推进机械臂内部或
 * 推到看不见的地方，而"重置"只能靠收起面板再展开。这排按钮补上那个缺口。
 */
.ur-twin-toolbar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid #21262d;
  background: rgba(13, 17, 23, 0.72);
}
.ur-twin-toolbar-button {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid #30363d;
  border-radius: 4px;
  background: #161b22;
  color: #c9d1d9;
  font: inherit;
  cursor: pointer;
}
.ur-twin-toolbar-button:hover { border-color: #58a6ff; color: #58a6ff; }
.ur-twin-toolbar-button:active { background: #21262d; }
.ur-twin-canvas {
  display: block;
  width: 100%;
  height: 100%;
  outline: none;
}
.ur-twin-hud {
  flex: 0 0 auto;
  display: grid;
  gap: 2px;
  padding: 8px 10px;
  border-top: 1px solid #21262d;
  background: rgba(13, 17, 23, 0.72);
}
.ur-twin-hud-row {
  overflow: hidden;
  white-space: pre;
  text-overflow: ellipsis;
  color: #8b949e;
}
.ur-twin-status {
  flex: 0 0 auto;
  padding: 6px 10px;
  border-top: 1px solid #21262d;
  color: #8b949e;
}
.ur-twin-error {
  flex: 0 0 auto;
  padding: 0 10px 6px;
  color: #f85149;
  white-space: pre-wrap;
}
.ur-twin-panel[data-ur-twin-connected='true'] .ur-twin-status { color: #3fb950; }
/* 安全状态异常时压过上面那条绿色：同等特异性，靠**写在后面**取胜，不要上移这两条。 */
.ur-twin-panel[data-ur-twin-hazard='true'] .ur-twin-status { color: #f85149; }
.ur-twin-hud-row[data-ur-twin-hazard='true'] { color: #f85149; }
/* 关节超出 kinematics.json 的限位：和"安全异常"用同一个警示色，但只染那一行。 */
.ur-twin-hud-row[data-ur-twin-overlimit='true'] { color: #f85149; }
/* 待审批的运动目标：与幽灵臂的"待审批"橙色一致，让 HUD 文字与 3D 里的假臂对得上。
   空的时候（没有审批）这一行不染色，也就看不出占位。 */
.ur-twin-hud-row[data-ur-twin-pending]:not(:empty) { color: #ffa657; }
/* 工程辅助图层的开关（清单第 9 条）：克制的小按钮，激活态用实心蓝，一眼看出哪些图层开着。 */
.ur-twin-layer-toggle {
  margin-right: 6px;
  padding: 1px 6px;
  font: inherit;
  font-size: 11px;
  color: #8b949e;
  background: transparent;
  border: 1px solid #30363d;
  border-radius: 4px;
  cursor: pointer;
}
.ur-twin-layer-toggle[aria-pressed='true'] {
  color: #0d1117;
  background: #58a6ff;
  border-color: #58a6ff;
}
/* 身份行（机型 + IP）比读数更重要，给它正常前景色而不是注释灰。 */
.ur-twin-hud-row[data-ur-twin-identity] { color: #c9d1d9; }
/* 数据通道健康度（0.6.6）：停滞/重连必须一眼可见 —— 画面停住时用户要能分清
   "机器人停了"与"数据停了"，所以这一行用警示色（黄=停滞/重连中，红=通道不可用）。 */
.ur-twin-hud-row[data-ur-twin-feed-state='stale'] { color: #d29922; }
.ur-twin-hud-row[data-ur-twin-feed-state='retrying'] { color: #d29922; }
`.trim()

/**
 * 幂等地把面板样式注入文档头部。
 *
 * @param {Document} [doc=globalThis.document] 目标文档（注入点，Node 无 DOM 时传假对象）
 * @returns {Element|null} 已存在或新建的 `<style>` 元素；无可用 DOM 时返回 `null`（不抛错）
 */
export function injectStyles(doc = globalThis.document) {
  if (!doc || typeof doc.createElement !== 'function') return null

  const existing = typeof doc.getElementById === 'function' ? doc.getElementById(TWIN_STYLE_ID) : null
  if (existing) return existing

  const style = doc.createElement('style')
  style.id = TWIN_STYLE_ID
  if (typeof style.setAttribute === 'function') style.setAttribute(TWIN_STYLE_ATTR, '')
  style.textContent = TWIN_CSS

  const host = doc.head ?? doc.documentElement ?? doc.body ?? null
  host?.appendChild?.(style)
  return style
}

/**
 * 截图导出（清单第 17 条）：一键导出带**型号 / IP / 时间**水印的 PNG。
 *
 * 产品其它地方已经确立了"截图要能带上版本以便报障"的思路（market 把版本放进标题）。
 * 孪生面板此前只能靠手机拍屏幕 —— 现场报障时那张照片既看不清读数、也不知道是哪台机器人。
 *
 * ## 两个容易踩的地方
 *
 * 1. **WebGL canvas 的 `toDataURL` 必须在渲染之后立刻调用**。默认
 *    `preserveDrawingBuffer: false`，一旦让出控制权（例如 await 了别的异步任务），
 *    绘制缓冲就可能已被清空，导出的是一张**全黑/全透明**的图。所以调用方要先把这一帧
 *    渲染出来，再**同步**调用本模块。
 * 2. 水印必须画在**副本**上，绝不能污染正在显示的那张 canvas。
 */

/** 水印文字的行高（像素）。 */
export const WATERMARK_LINE_HEIGHT = 22

/** 水印距画布左下的边距（像素）。 */
export const WATERMARK_PADDING = 16

/**
 * 把时间格式化成 `YYYY-MM-DD HH:MM:SS`（本地时区）。
 *
 * 用本地时间而不是 ISO/UTC：报障的人看的是自己墙上的钟。
 *
 * @param {Date} date
 * @returns {string}
 */
export function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0')
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(0)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 导出文件名：带上型号与时间，便于一次收集多张时区分。
 *
 * @param {{model?: string, ip?: string}|null|undefined} snap
 * @param {Date} date
 * @returns {string}
 */
export function screenshotFileName(snap, date) {
  const model = typeof snap?.model === 'string' && snap.model.trim() !== '' ? snap.model.trim() : 'robot'
  // 文件名里不能出现路径分隔符与 Windows 保留字符，统一换成短横。
  const safeModel = model.replace(/[^A-Za-z0-9._-]+/gu, '-')
  const stamp = formatTimestamp(date).replace(/[: ]/gu, '-')
  return `ur-twin-${safeModel}-${stamp}.png`
}

/**
 * 水印文字行（自下而上绘制时用的顺序：第一行在最下面）。
 *
 * 每行都是"报障时真正需要的信息"：哪台、什么型号、什么模式、什么读数、什么时候。
 *
 * @param {{model?: string, ip?: string, q?: number[], tcp?: number[], detail?: object}|null|undefined} snap
 * @param {Date} date
 * @returns {string[]}
 */
export function watermarkLines(snap, date) {
  const lines = []
  const model = typeof snap?.model === 'string' && snap.model !== '' ? snap.model : '未知型号'
  const ip = typeof snap?.ip === 'string' && snap.ip !== '' ? snap.ip : '未指定 IP'
  lines.push(`${model}  ·  ${ip}`)

  // 安全模式与速度倍率是排查现场问题时最先要看的两项（第 1 条把它们接进 detail 的理由）。
  const detail = snap?.detail
  if (detail !== null && typeof detail === 'object') {
    const parts = []
    if (typeof detail.safety_mode === 'string' && detail.safety_mode !== '') parts.push(`安全 ${detail.safety_mode}`)
    if (typeof detail.robot_mode === 'string' && detail.robot_mode !== '') parts.push(`模式 ${detail.robot_mode}`)
    if (Number.isFinite(detail.speed_scaling)) parts.push(`倍率 ${(detail.speed_scaling * 100).toFixed(0)}%`)
    if (parts.length > 0) lines.push(parts.join('  ·  '))
  }

  const q = snap?.q
  if (Array.isArray(q) && q.length >= 6 && q.every(Number.isFinite)) {
    // 关节角用度：现场的人是按度数读示教器的。
    lines.push(q.map((value, index) => `J${index + 1} ${((value * 180) / Math.PI).toFixed(1)}°`).join('  '))
  }

  const tcp = snap?.tcp
  if (Array.isArray(tcp) && tcp.length >= 3 && tcp.slice(0, 3).every(Number.isFinite)) {
    lines.push(`TCP [${tcp[0].toFixed(3)}, ${tcp[1].toFixed(3)}, ${tcp[2].toFixed(3)}] m`)
  }

  lines.push(formatTimestamp(date))
  return lines
}

/**
 * 把水印画到一个 2D 上下文上（**从画布左下角往上**排，最后一行在最上面）。
 *
 * 抽成独立函数是为了可测：它只碰 2D 上下文的几个方法，用假上下文就能断言。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string[]} lines `watermarkLines` 的返回值
 * @param {{width: number, height: number, padding?: number, lineHeight?: number}} layout
 */
export function drawWatermark(ctx, lines, layout) {
  if (ctx == null || !Array.isArray(lines) || lines.length === 0) return
  const padding = Number.isFinite(layout?.padding) ? layout.padding : WATERMARK_PADDING
  const lineHeight = Number.isFinite(layout?.lineHeight) ? layout.lineHeight : WATERMARK_LINE_HEIGHT
  const height = Number.isFinite(layout?.height) ? layout.height : 0
  const width = Number.isFinite(layout?.width) ? layout.width : 0

  ctx.save?.()
  // 半透明底衬：机械臂是浅灰的，纯亮色文字在它上面会看不清。
  ctx.fillStyle = 'rgba(8, 12, 16, 0.62)'
  const blockHeight = lines.length * lineHeight + padding * 0.6
  ctx.fillRect?.(0, height - blockHeight, width, blockHeight)

  ctx.font = `${Math.round(lineHeight * 0.6)}px sans-serif`
  ctx.fillStyle = '#e6edf3'
  ctx.textBaseline = 'bottom'
  for (let i = 0; i < lines.length; i++) {
    // i=0 在最下面，往上依次排。
    const y = height - padding - i * lineHeight
    ctx.fillText?.(lines[i], padding, y)
  }
  ctx.restore?.()
}

/**
 * 合成导出用的 PNG（data URL）。
 *
 * ⚠️ 必须**同步**调用，且调用前这一帧已经渲染过（见文件头的第 1 条）。
 *
 * @param {HTMLCanvasElement} canvas 正在显示的那个 WebGL canvas
 * @param {object|null} snap 当前快照
 * @param {{document?: Document, now?: Date, lineHeight?: number, padding?: number}} [options]
 * @returns {string|null} data URL；环境不支持时 `null`
 */
export function captureTwinPng(canvas, snap, options = {}) {
  const doc = options.document ?? globalThis.document
  if (doc == null || canvas == null || typeof doc.createElement !== 'function') return null
  try {
    const out = doc.createElement('canvas')
    out.width = canvas.width
    out.height = canvas.height
    const ctx = out.getContext?.('2d')
    if (ctx == null) return null
    ctx.drawImage(canvas, 0, 0)
    drawWatermark(ctx, watermarkLines(snap, options.now ?? new Date()), {
      width: out.width,
      height: out.height,
      ...(options.lineHeight === undefined ? {} : { lineHeight: options.lineHeight }),
      ...(options.padding === undefined ? {} : { padding: options.padding }),
    })
    return out.toDataURL('image/png')
  } catch {
    // 拿不到 2D 上下文（离屏 canvas 被禁用等）或 toDataURL 抛错：导出失败不该影响面板。
    return null
  }
}

/**
 * 触发浏览器下载。
 *
 * @param {string} dataUrl `captureTwinPng` 的返回值
 * @param {string} fileName
 * @param {{document?: Document}} [options]
 * @returns {boolean} 是否成功发起下载
 */
export function downloadDataUrl(dataUrl, fileName, options = {}) {
  const doc = options.document ?? globalThis.document
  if (doc == null || typeof dataUrl !== 'string' || dataUrl === '') return false
  try {
    const link = doc.createElement('a')
    link.href = dataUrl
    link.download = fileName
    link.rel = 'noopener'
    link.click?.()
    return true
  } catch {
    return false
  }
}

/**
 * 截图导出（清单第 17 条）专项测试。
 *
 * 「水印里该有什么」与「文件名怎么拼」都是纯逻辑，能在这里全覆盖；真正需要 WebGL 的
 * 只有"把画布内容拷出来"那一句，用假 document/canvas 也能验证它的调用序列与失败降级。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  captureTwinPng,
  downloadDataUrl,
  drawWatermark,
  formatTimestamp,
  screenshotFileName,
  watermarkLines,
  WATERMARK_LINE_HEIGHT,
  WATERMARK_PADDING,
} from '../src/client/robot/screenshot.js'

const SNAP = {
  connected: true,
  model: 'UR5E',
  ip: '192.168.2.201',
  q: [0, -Math.PI / 2, Math.PI / 2, -Math.PI / 2, -Math.PI / 2, 0],
  tcp: [0.1234, -0.5678, 0.9, 0, 0, 0],
  detail: { safety_mode: 'NORMAL', robot_mode: 'RUNNING', speed_scaling: 0.5 },
}

/** 记录所有绘制的假 2D 上下文。 */
function fakeContext() {
  const calls = { fillRect: [], fillText: [], save: 0, restore: 0, drawImage: 0 }
  return {
    calls,
    fillStyle: '',
    font: '',
    textBaseline: '',
    save() { calls.save += 1 },
    restore() { calls.restore += 1 },
    fillRect(...args) { calls.fillRect.push(args) },
    fillText(...args) { calls.fillText.push(args) },
    drawImage() { calls.drawImage += 1 },
  }
}

test('formatTimestamp：本地时区 YYYY-MM-DD HH:MM:SS，非法输入退化成 epoch 而不是抛错', () => {
  const date = new Date(2026, 8, 30, 7, 5, 3) // 本地时间 2026-09-30 07:05:03
  assert.equal(formatTimestamp(date), '2026-09-30 07:05:03')
  // 报障的人看的是自己墙上的钟，所以用本地时间而不是 UTC/ISO。
  assert.doesNotThrow(() => formatTimestamp(null))
  assert.doesNotThrow(() => formatTimestamp(new Date('nope')))
  assert.match(formatTimestamp(new Date('nope')), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u)
})

test('screenshotFileName：带型号与时间，且不含路径分隔符或 Windows 保留字符', () => {
  const date = new Date(2026, 8, 30, 7, 5, 3)
  const name = screenshotFileName(SNAP, date)
  assert.equal(name, 'ur-twin-UR5E-2026-09-30-07-05-03.png')

  // 畸形型号名不得带出 `/` `\` `:` 等字符（那会变成路径或被系统拒绝）。
  const weird = screenshotFileName({ model: 'UR/5\\E: v2*?' }, date)
  assert.ok(!/[/\\:*?"<>|]/u.test(weird), `文件名不得含保留字符：${weird}`)
  assert.match(weird, /\.png$/u)

  // 没有型号时给个可读的兜底，而不是 "undefined"。
  assert.match(screenshotFileName(null, date), /^ur-twin-robot-/u)
  assert.match(screenshotFileName({ model: '   ' }, date), /^ur-twin-robot-/u)
})

test('watermarkLines：型号/IP/安全模式/倍率/关节角/TCP/时间都在，且不塞 undefined', () => {
  const lines = watermarkLines(SNAP, new Date(2026, 8, 30, 7, 5, 3))
  const text = lines.join('\n')

  assert.match(text, /UR5E/u)
  assert.match(text, /192\.168\.2\.201/u)
  assert.match(text, /安全 NORMAL/u)
  assert.match(text, /倍率 50%/u, '倍率要按百分比显示')
  assert.match(text, /J2 -90\.0°/u, '关节角用度，现场是按度数读示教器的')
  assert.match(text, /TCP \[0\.123, -0\.568, 0\.900\] m/u)
  assert.match(text, /2026-09-30 07:05:03/u)
  assert.ok(!text.includes('undefined'), '不得把 undefined 塞进水印')

  // 极简快照：仍然要有可读的两行（型号/IP + 时间）。
  const bare = watermarkLines({}, new Date(2026, 8, 30, 7, 5, 3))
  assert.match(bare.join('\n'), /未知型号/u)
  assert.match(bare.join('\n'), /未指定 IP/u)
  assert.ok(!bare.join('\n').includes('undefined'))

  // 非法快照不抛错
  for (const bad of [null, undefined, 'x', { q: [1, 2], tcp: 'nope', detail: 'nope' }]) {
    assert.doesNotThrow(() => watermarkLines(bad, new Date()))
  }
})

test('drawWatermark：底衬 + 每行一次 fillText，且从下往上排', () => {
  const ctx = fakeContext()
  const lines = ['第一行', '第二行', '第三行']
  drawWatermark(ctx, lines, { width: 800, height: 600 })

  assert.equal(ctx.calls.save, 1)
  assert.equal(ctx.calls.restore, 1, '必须成对 save/restore，别把状态泄漏给调用方')
  assert.equal(ctx.calls.fillRect.length, 1, '需要一层半透明底衬，否则浅色机械臂上读不清')
  assert.equal(ctx.calls.fillText.length, 3)

  // i=0 在最下面：y 随 i 递减。
  const ys = ctx.calls.fillText.map(([, , y]) => y)
  assert.ok(ys[0] > ys[1] && ys[1] > ys[2], `应从下往上排，实测 y=${ys.join(',')}`)
  assert.equal(ys[0], 600 - WATERMARK_PADDING)
  assert.equal(ys[1], 600 - WATERMARK_PADDING - WATERMARK_LINE_HEIGHT)

  // 空输入不该画任何东西，也不该抛错。
  const empty = fakeContext()
  assert.doesNotThrow(() => drawWatermark(empty, [], { width: 10, height: 10 }))
  assert.equal(empty.calls.fillText.length, 0)
  assert.doesNotThrow(() => drawWatermark(null, lines, { width: 10, height: 10 }))
})

test('captureTwinPng：拷贝画布 → 画水印 → 出 PNG data URL；缺能力时返回 null', () => {
  const ctx = fakeContext()
  const created = []
  const doc = {
    createElement(tag) {
      created.push(tag)
      return {
        width: 0,
        height: 0,
        getContext: () => ctx,
        toDataURL: (type) => `data:${type};base64,AAAA`,
      }
    },
  }
  const source = { width: 800, height: 600 }

  const dataUrl = captureTwinPng(source, SNAP, { document: doc, now: new Date(2026, 8, 30, 7, 5, 3) })
  assert.equal(dataUrl, 'data:image/png;base64,AAAA')
  assert.deepEqual(created, ['canvas'], '必须新建一张副本画布，绝不能污染正在显示的那张')
  assert.equal(ctx.calls.drawImage, 1, '副本要先拷原图')
  assert.ok(ctx.calls.fillText.length >= 3, '水印必须画在副本上')

  // 降级：没有 document / 没有 2D 上下文 / toDataURL 抛错 —— 一律返回 null，不抛。
  assert.equal(captureTwinPng(source, SNAP, { document: null }), null)
  const no2d = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) }
  assert.equal(captureTwinPng(source, SNAP, { document: no2d }), null)
  const throwing = {
    createElement: () => ({
      width: 0, height: 0, getContext: () => ctx, toDataURL: () => { throw new Error('tainted') },
    }),
  }
  assert.doesNotThrow(() => captureTwinPng(source, SNAP, { document: throwing }))
  assert.equal(captureTwinPng(source, SNAP, { document: throwing }), null)
  assert.equal(captureTwinPng(null, SNAP, { document: doc }), null)
})

test('downloadDataUrl：用 <a download> 发起下载；无效输入返回 false 而不抛错', () => {
  const clicked = []
  const doc = {
    createElement: () => ({
      click() { clicked.push(this.download) },
    }),
  }

  assert.equal(downloadDataUrl('data:image/png;base64,AAAA', 'shot.png', { document: doc }), true)
  assert.deepEqual(clicked, ['shot.png'])
  assert.equal(downloadDataUrl('', 'shot.png', { document: doc }), false)
  assert.equal(downloadDataUrl(null, 'shot.png', { document: doc }), false)
  assert.equal(downloadDataUrl('data:x', 'shot.png', { document: null }), false)

  const throwing = { createElement: () => ({ click() { throw new Error('blocked') } }) }
  assert.doesNotThrow(() => downloadDataUrl('data:x', 'shot.png', { document: throwing }))
  assert.equal(downloadDataUrl('data:x', 'shot.png', { document: throwing }), false)
})

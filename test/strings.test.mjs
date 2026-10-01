/**
 * 客户端 i18n（清单第 15 条）专项测试。
 *
 * 最要紧的一条是 **zh / en 两套键必须完全对称** —— 漏一个键，英文用户就会在那儿看到
 * `undefined`，而中文路径下永远发现不了。带插值的键写成函数，这里也一并钉住它们可调用。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  activeStrings,
  DEFAULT_LOCALE,
  en,
  resolveLocale,
  stringsFor,
  SUPPORTED_LOCALES,
  zh,
} from '../src/client/strings.js'

test('resolveLocale：只认主语言子标签，认不出时回退缺省语言而不是英文', () => {
  assert.equal(resolveLocale('zh'), 'zh')
  assert.equal(resolveLocale('zh-CN'), 'zh')
  assert.equal(resolveLocale('zh-Hans-CN'), 'zh')
  // 繁体也先归到 zh（有繁体词条时再细化）—— 绝不能因为认不出就退回英文。
  assert.equal(resolveLocale('zh-TW'), 'zh')
  assert.equal(resolveLocale('en'), 'en')
  assert.equal(resolveLocale('en-US'), 'en')
  assert.equal(resolveLocale('EN_gb'), 'en', '大小写与下划线都要能认')

  // 不支持 / 畸形 → 缺省语言
  assert.equal(DEFAULT_LOCALE, 'zh')
  for (const bad of ['fr', 'de-DE', '', '   ', null, undefined, 42, {}]) {
    assert.equal(resolveLocale(bad), DEFAULT_LOCALE, `${String(bad)} 应回退缺省语言`)
  }
  assert.deepEqual([...SUPPORTED_LOCALES], ['zh', 'en'])
})

test('stringsFor：取值与回退', () => {
  assert.equal(stringsFor('zh'), zh)
  assert.equal(stringsFor('zh-CN'), zh)
  assert.equal(stringsFor('en-US'), en)
  assert.equal(stringsFor('fr'), zh, '不支持的语言回退缺省')
})

test('activeStrings：读 navigator.language，可用注入点覆盖', () => {
  assert.equal(activeStrings({ language: 'en-US' }), en)
  assert.equal(activeStrings({ language: 'zh-CN' }), zh)
  // 没有 navigator 线索 → 缺省语言，而不是崩掉
  assert.equal(activeStrings({}), zh)
  assert.equal(activeStrings({ language: undefined }), zh)
  assert.equal(activeStrings(null), stringsFor(globalThis.navigator?.language))
})

test('zh 与 en 的键完全对称（漏一个键英文用户就会看到 undefined）', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(enKeys, zhKeys, '两套文案的键集合必须一致')

  // 值也必须同类型：标量 vs 函数不能串（那会在调用点直接抛错）。
  for (const key of zhKeys) {
    assert.equal(
      typeof en[key],
      typeof zh[key],
      `${key} 的类型不一致：zh=${typeof zh[key]} / en=${typeof en[key]}`,
    )
  }
})

test('枚举映射表：zh/en 的键对称，且每个键都有非空译文', () => {
  for (const table of ['safetyMode', 'robotMode', 'programState']) {
    const zhTable = zh[table]
    const enTable = en[table]
    assert.deepEqual(Object.keys(enTable).sort(), Object.keys(zhTable).sort(), `${table} 键不对称`)
    for (const key of Object.keys(zhTable)) {
      assert.ok(zhTable[key].length > 0, `${table}.${key} 中文为空`)
      assert.ok(enTable[key].length > 0, `${table}.${key} 英文为空`)
    }
  }
  // 与 python 侧上报的原始串对齐（少一个就会显示原始大写下划线串）。
  assert.ok(zh.safetyMode.NORMAL && zh.safetyMode.PROTECTIVE_STOP)
  assert.ok(zh.robotMode.RUNNING && zh.robotMode.BACKDRIVE)
  assert.ok(zh.programState.PLAYING && zh.programState.PAUSED)
})

test('带插值的键是函数，且两种语言都能正常产出文本', () => {
  for (const strings of [zh, en]) {
    assert.match(strings.disconnectReason('boom'), /boom/u)
    assert.match(strings.disconnectReason(''), /^[^:]*$/u)
    assert.match(strings.disconnectCandidates(['a', 'b']), /a/u)
    assert.equal(strings.disconnectCandidates([]), '', '没有候选时必须是空串，不能留括号')
    assert.equal(strings.disconnectCandidates(null), '')
    assert.match(strings.disconnectWorkerDown(''), /ur_ping/u, '无论语言都要提到 ur_ping（那是真实的工具名）')
    assert.match(strings.identity('UR5E', '10.0.0.1'), /UR5E/u)
    assert.match(strings.identity('UR5E', '10.0.0.1'), /10\.0\.0\.1/u)
    assert.match(strings.overLimit('J2'), /J2/u)
    assert.match(strings.detailBus('48.1', '2.30'), /48\.1/u)
  }
})

test('英文文案里不该混入中文（抓漏翻的键）', () => {
  const cjk = /[\u4e00-\u9fff]/u
  for (const [key, value] of Object.entries(en)) {
    if (typeof value === 'string') {
      assert.ok(!cjk.test(value), `en.${key} 仍是中文：${value}`)
    }
  }
  // dock 的短标签最容易漏
  assert.ok(!cjk.test(en.dockLabel) && !cjk.test(en.dockDescription))
})

test('中文文案里不该出现英文占位（抓没写完的键）', () => {
  for (const [key, value] of Object.entries(zh)) {
    if (typeof value !== 'string') continue
    // 允许含专有名词（ur_connect / ur_ping / TCP / WebGL / GPU / IP 等），但不允许整句英文。
    assert.ok(!/^(TODO|FIXME|undefined|null)$/u.test(value), `zh.${key} 是占位值：${value}`)
    assert.ok(value.trim().length > 0, `zh.${key} 为空`)
  }
})

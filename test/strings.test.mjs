/**
 * 客户端 i18n（清单第 15 条）专项测试 —— 8 种语言。
 *
 * 最要紧的一条是 **8 套键必须与中文完全对称**：漏一个键，那个语言的用户就会在那儿看到
 * `undefined`，而中文路径下永远发现不了。带插值的键写成函数，这里也一并钉住它们可调用。
 *
 * 语言清单与宿主 `@deepseek-ai/dsh-client-locale` 一致：zh/en/ja/es/fr/de/ru/pt。其中 `pt` 是
 * 巴西葡萄牙语（宿主也用 `pt` 承接 pt / pt-BR / pt-PT 的浏览器请求）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  activeLocale,
  activeStrings,
  bindHostLocale,
  DEFAULT_LOCALE,
  de,
  en,
  es,
  fr,
  getHostLocale,
  ja,
  LANGUAGE_LABELS,
  liveNested,
  liveStrings,
  LOCALES,
  pt,
  registerWithLocale,
  resolveLocale,
  ru,
  setHostLocale,
  stringsFor,
  SUPPORTED_LOCALES,
  useHostLocale,
  zh,
} from '../src/client/strings.js'

const EXPECTED = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt']

test('resolveLocale：8 种语言（含 pt-BR / es-419 这类区域标签），认不出回退缺省而不是英文', () => {
  assert.deepEqual([...SUPPORTED_LOCALES], EXPECTED, '支持的语言必须正好是这 8 种')

  // 主语言子标签（大小写与下划线都要能认）
  assert.equal(resolveLocale('zh'), 'zh')
  assert.equal(resolveLocale('zh-CN'), 'zh')
  assert.equal(resolveLocale('zh-Hans-CN'), 'zh')
  assert.equal(resolveLocale('zh-TW'), 'zh', '繁体先归 zh —— 绝不能因为认不出就退回英文')
  assert.equal(resolveLocale('en'), 'en')
  assert.equal(resolveLocale('EN_gb'), 'en')
  assert.equal(resolveLocale('ja-JP'), 'ja')
  assert.equal(resolveLocale('es-419'), 'es')
  assert.equal(resolveLocale('fr-FR'), 'fr')
  assert.equal(resolveLocale('de-DE'), 'de')
  assert.equal(resolveLocale('ru-RU'), 'ru')
  assert.equal(resolveLocale('pt-BR'), 'pt', '巴西葡萄牙语走 pt（宿主 id）')
  assert.equal(resolveLocale('pt-PT'), 'pt', 'pt-PT 也归 pt（宿主同样如此）')

  // 不支持 / 畸形 → 缺省语言
  assert.equal(DEFAULT_LOCALE, 'zh')
  for (const bad of ['xx', 'eo', '', '   ', null, undefined, 42, {}]) {
    assert.equal(resolveLocale(bad), DEFAULT_LOCALE, `${String(bad)} 应回退缺省语言`)
  }
})

test('stringsFor：8 种语言各自取到自己的表，未知语言回退缺省', () => {
  assert.equal(stringsFor('zh'), zh)
  assert.equal(stringsFor('en-US'), en)
  assert.equal(stringsFor('ja-JP'), ja)
  assert.equal(stringsFor('es'), es)
  assert.equal(stringsFor('fr'), fr)
  assert.equal(stringsFor('de-DE'), de)
  assert.equal(stringsFor('ru'), ru)
  assert.equal(stringsFor('pt-BR'), pt)
  assert.equal(stringsFor('xx'), zh, '不支持的语言回退缺省')
})

test('activeStrings：宿主语言优先于浏览器语言，其次是 languages 列表，最后缺省', () => {
  // 宿主 locale 优先 —— 这就是「与桌面程序语言一致」
  assert.equal(activeStrings({ locale: 'ja', language: 'en-US' }), ja)
  assert.equal(activeStrings({ locale: 'pt-BR', language: 'zh-CN' }), pt)
  // 没有宿主语言时退回浏览器
  assert.equal(activeStrings({ language: 'en-US' }), en)
  assert.equal(activeStrings({ language: 'zh-CN' }), zh)
  assert.equal(activeStrings({ languages: ['fr-CA', 'en-US'] }), fr, 'languages 列表逐个匹配')
  assert.equal(activeStrings({ languages: ['xx-YY', 'ru'] }), ru, '跳过不支持的语言继续找')
  // 没有任何线索 → 缺省语言，而不是崩掉
  assert.equal(activeStrings({}), zh)
  assert.equal(activeStrings({ language: undefined }), zh)
  assert.equal(activeStrings(null), stringsFor(globalThis.navigator?.language))
  assert.equal(activeLocale({ locale: 'de-DE' }), 'de')
  assert.equal(activeLocale({ languages: ['pt-BR'] }), 'pt')
})

test('8 套文案的键与值类型与中文完全对称（漏一个键就会显示 undefined）', () => {
  const base = Object.keys(zh).sort()
  for (const id of SUPPORTED_LOCALES) {
    const table = LOCALES[id]
    assert.deepEqual(Object.keys(table).sort(), base, `${id} 的键集合与 zh 不一致`)
    for (const key of base) {
      assert.equal(typeof table[key], typeof zh[key], `${id}.${key} 类型不一致`)
    }
  }
})

test('枚举映射表：8 种语言的键对称，且每个键都有非空译文', () => {
  for (const ns of ['safetyMode', 'robotMode', 'programState']) {
    const keys = Object.keys(zh[ns]).sort()
    for (const id of SUPPORTED_LOCALES) {
      const table = LOCALES[id][ns]
      assert.deepEqual(Object.keys(table).sort(), keys, `${id}.${ns} 键不对称`)
      for (const key of keys) {
        assert.ok(typeof table[key] === 'string' && table[key].trim().length > 0, `${id}.${ns}.${key} 为空`)
      }
    }
  }
  // 与 python 侧上报的原始串对齐（少一个就会显示原始大写下划线串）。
  assert.ok(zh.safetyMode.NORMAL && zh.safetyMode.PROTECTIVE_STOP)
  assert.ok(zh.robotMode.RUNNING && zh.robotMode.BACKDRIVE)
  assert.ok(zh.programState.PLAYING && zh.programState.PAUSED)
})

test('带插值的键在所有语言里都是函数，且都能正常产出文本', () => {
  for (const id of SUPPORTED_LOCALES) {
    const s = LOCALES[id]
    assert.match(s.disconnectReason('boom'), /boom/u, `${id}.disconnectReason 丢了原因`)
    assert.ok(s.disconnectReason('').length > 0, `${id}.disconnectReason('') 不该是空串`)
    assert.match(s.disconnectCandidates(['a', 'b']), /a/u, `${id}.disconnectCandidates 丢了候选`)
    assert.equal(s.disconnectCandidates([]), '', `${id}：没有候选时必须是空串，不能留括号`)
    assert.equal(s.disconnectCandidates(null), '', `${id}：null 候选也必须是空串`)
    assert.match(s.disconnectWorkerDown(''), /ur_ping/u, `${id}：无论语言都要提到 ur_ping（真实工具名）`)
    assert.match(s.identity('UR5E', '10.0.0.1'), /UR5E/u)
    assert.match(s.identity('UR5E', '10.0.0.1'), /10\.0\.0\.1/u)
    assert.match(s.overLimit('J2'), /J2/u)
    assert.match(s.detailBus('48.1', '2.30'), /48\.1/u)
    assert.match(s.detailSpeed('0.5'), /0\.5/u)
  }
})

test('非中日文文案里不该混入中文字符（抓漏翻的键）', () => {
  const cjk = /[\u4e00-\u9fff]/u
  // ja 用汉字，跳过；zh 本身就是中文。
  for (const id of ['en', 'es', 'fr', 'de', 'ru', 'pt']) {
    for (const [key, value] of Object.entries(LOCALES[id])) {
      if (typeof value !== 'string') continue
      assert.ok(!cjk.test(value), `${id}.${key} 仍是中文：${value}`)
    }
    // 枚举表也要检查
    for (const ns of ['safetyMode', 'robotMode', 'programState']) {
      for (const [key, value] of Object.entries(LOCALES[id][ns])) {
        assert.ok(!cjk.test(value), `${id}.${ns}.${key} 仍是中文：${value}`)
      }
    }
  }
})

test('每种语言都有自称（语言选择器用），且都不为空', () => {
  for (const id of SUPPORTED_LOCALES) {
    assert.ok(typeof LANGUAGE_LABELS[id] === 'string' && LANGUAGE_LABELS[id].trim().length > 0, `${id} 缺少自称`)
  }
  assert.equal(LANGUAGE_LABELS.pt, 'Português (Brasil)')
})

test('liveStrings：跟随宿主语言热切换（无需重新取对象）', () => {
  setHostLocale('ja')
  const S = liveStrings()
  assert.equal(S.statusConnected, ja.statusConnected)
  assert.equal(S.viewTop, ja.viewTop)
  setHostLocale('ru')
  assert.equal(S.statusConnected, ru.statusConnected, '同一对象在语言切换后必须给出新语言')
  setHostLocale('pt')
  assert.equal(S.statusConnected, pt.statusConnected)
  setHostLocale(undefined)
  assert.equal(S.statusConnected, zh.statusConnected, '没有宿主语言线索时回退中文')
})

test('liveNested：嵌套枚举表同样跟随语言热切换', () => {
  const safety = liveNested('safetyMode')
  setHostLocale('de')
  assert.equal(safety.NORMAL, de.safetyMode.NORMAL)
  setHostLocale('es')
  assert.equal(safety.NORMAL, es.safetyMode.NORMAL, '嵌套表不能停在第一次取到的语言上')
  assert.ok('PROTECTIVE_STOP' in safety, 'has 也要走当前语言')
  setHostLocale(undefined)
  assert.equal(safety.NORMAL, zh.safetyMode.NORMAL)
})

test('registerWithLocale / useHostLocale / bindHostLocale：宿主可用时注册并跟随，不可用时安全回退', () => {
  // 宿主不可用（没有 locale 服务）
  assert.equal(registerWithLocale(undefined), false)
  assert.equal(registerWithLocale({}), false)
  assert.equal(useHostLocale(undefined), undefined)
  assert.equal(useHostLocale({}), undefined)
  const disposeNoop = bindHostLocale({})
  assert.equal(typeof disposeNoop, 'function')
  disposeNoop()
  assert.equal(getHostLocale(), undefined)

  // 假宿主：注册 8 份字典 + 读快照 + 订阅
  const registered = []
  let notify
  const ctx = {
    locale: {
      register: (ns, dict) => registered.push({ ns, dict }),
      getSnapshot: () => ({ locale: 'fr' }),
      subscribe: (fn) => {
        notify = fn
        return () => {
          notify = undefined
        }
      },
    },
  }
  assert.equal(registerWithLocale(ctx, 'ur-twin'), true)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].ns, 'ur-twin')
  assert.deepEqual(Object.keys(registered[0].dict).sort(), [...EXPECTED].sort(), '必须把 8 份字典交给宿主')
  assert.equal(useHostLocale(ctx), 'fr')

  const dispose = bindHostLocale(ctx, 'ur-twin')
  assert.equal(getHostLocale(), 'fr', '绑定后语言跟随宿主快照')
  notify?.({ locale: 'ru' })
  assert.equal(getHostLocale(), 'ru', '订阅回调要更新语言')
  const S = liveStrings()
  assert.equal(S.statusConnected, ru.statusConnected)
  dispose()
  assert.equal(getHostLocale(), undefined)
  assert.equal(notify, undefined, 'dispose 必须退订')
})

test('注册失败不抛（宿主接口形态不匹配时面板必须照常工作）', () => {
  const ctx = {
    locale: {
      register: () => {
        throw new Error('boom')
      },
    },
    logger: { warn: () => {} },
  }
  assert.equal(registerWithLocale(ctx), false)
})


test('cordis 严格上下文：locale 只能经 ctx.get 取，属性读取抛错也不能让 entry 失败（0.8.2 回归）', () => {
  const registered = []
  const locale = {
    register: (ns, dict) => registered.push([ns, Object.keys(dict)]),
    getSnapshot: () => ({ active: 'en' }),
    subscribe: () => () => {},
  }
  const base = {
    logger: { warn() {}, info() {}, error() {} },
    get: (name) => (name === 'locale' ? locale : undefined),
    on: () => () => {},
    effect: () => () => {},
  }
  // cordis 的上下文代理：未 inject 的服务属性读取直接抛错（这正是桌面启动失败的原因）。
  const strict = new Proxy(base, {
    get(target, key) {
      if (key in target) return target[key]
      throw new Error(`cannot get property "${String(key)}" without inject`)
    },
  })
  assert.equal(registerWithLocale(strict), true, '必须经 ctx.get 拿到服务并注册成功')
  assert.deepEqual(registered[0][0], 'ur-twin')
  assert.equal(useHostLocale(strict), 'en')
  assert.doesNotThrow(() => bindHostLocale(strict), '语言绑定失败不得拖垮客户端 entry')
  assert.equal(registerWithLocale(undefined), false)
})

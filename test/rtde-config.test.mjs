/**
 * test/rtde-config.test.mjs — 插件自有 RTDE 配方的防回归门禁。
 *
 * ## 这个文件钉的是什么（以及一段被取代的历史）
 * `rtde.py` 优先解析 `URBasic/rtdeConfiguration.xml`（缺失才回退 vendored 的 `...Default.xml`）。
 * 插件自带一份，**只声明接收侧，输入侧整段不存在**：
 *
 * 1. **接收侧（在用）**：vendored Default 只启用了 `output_bit_registers0_to_31`，而
 *    `ur_get_bit_register` 接受 0..63、`RobotModel.OutputBitRegister()` 仅在该字段存在时才填充
 *    32–63 ⇒ 缺了它 bool 寄存器 32–63 恒读回 null。所以本文件启用
 *    `output_bit_registers32_to_63`，并保持 int/double 寄存器 0..23（工具实际读的范围）。
 *
 * 2. **输入侧（整段不存在）**：本插件的 RTDE 写操作全部改走 URScript（`op_set_digital_out` 等），
 *    不再需要向控制器认领输入变量。之所以必须没有：UR 控制器会拒绝为「已被认领」的输入变量再发
 *    SETUP_INPUTS（`An input parameter is already in use.`），该拒绝会从 `__decodePayload` 冒到
 *    RTDE 线程里把整个 worker 打崩，之后除非控制器释放认领，会话无法重建；而上游的重连分支
 *    每次重连都会调 `__setupInput()`，非空配方会把这个拒绝**打成循环**。
 *    **曾经**试过「补一份带输入字段的配方 + 放开 `__setupInput()`」来修
 *    `AttributeError: 'NoneType' object has no attribute 'names'`；那条路已被上面这个更干净的
 *    方案取代（写操作走 URScript），因此现在反过来要守住「配方里没有输入段」。
 *
 * 运行：node --test test/rtde-config.test.mjs
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const pythonRoot = join(packageRoot, 'python')
const configPath = join(pythonRoot, 'URBasic', 'rtdeConfiguration.xml')
const defaultConfigPath = join(pythonRoot, 'URBasic', 'rtdeConfigurationDefault.xml')
const rtdePath = join(pythonRoot, 'URBasic', 'rtde.py')
const workerPath = join(pythonRoot, 'ur_worker.py')
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

/** 工作副本是 CRLF：先归一化，免得正则里的 `\n` 边界落空。 */
const normalize = (text) => text.replace(/\r\n/g, '\n')
const config = existsSync(configPath) ? normalize(readFileSync(configPath, 'utf8')) : ''
const rtdeSource = normalize(readFileSync(rtdePath, 'utf8'))
const workerSource = normalize(readFileSync(workerPath, 'utf8'))

/** 去掉 XML 注释（头部说明里也出现了 `<send>` 字样，不能直接按字面量切片）。 */
const configBody = config.replace(/<!--[\s\S]*?-->/g, '')

/** 取某个顶层段（`receive` / `send`）里的全部 `<field .../>` 属性表。 */
function fields(section) {
  const block = new RegExp(`<${section}\\b[^>]*>([\\s\\S]*?)</${section}>`).exec(configBody)
  assert.ok(block, `配方缺少 <${section}> 段`)
  return [...block[1].matchAll(/<field\s+([^/>]*)\/>/g)].map((match) => {
    const attributes = {}
    for (const attribute of match[1].matchAll(/(\w+)="([^"]*)"/g)) attributes[attribute[1]] = attribute[2]
    return attributes
  })
}

/** `run()` 里从「下发输出配方」到「启动数据包」之间的连接序列。 */
function connectSequence() {
  const run = /def run\(self\):([\s\S]*?)\n {4}def /.exec(rtdeSource)
  assert.ok(run, '未找到 RTDE.run() 定义')
  const body = run[1]
  const from = body.indexOf('self.__setupOutput()')
  const to = body.indexOf('self.__sendStart()', from)
  assert.ok(from > 0 && to > from, 'run() 里应能定位 __setupOutput() → __sendStart() 这一段')
  return body.slice(from, to)
}

test('配方文件存在，且 rtde.py 优先查找的就是它', () => {
  assert.ok(existsSync(configPath), `缺少 ${configPath}：rtde.py 找不到它就回退到 vendored Default`)
  assert.ok(existsSync(defaultConfigPath), 'vendored Default 仍在（作为回退）')

  const preferred = rtdeSource.indexOf("'URBasic/rtdeConfiguration.xml'")
  const fallback = rtdeSource.indexOf("'URBasic/rtdeConfigurationDefault.xml'")
  assert.ok(preferred > 0, 'rtde.py 应首选 URBasic/rtdeConfiguration.xml')
  assert.ok(fallback > preferred, 'Default 必须只是回退，不能被提到前面')
})

test('接收侧：启用 bool 寄存器 32–63 与工具实际用到的 int/double 寄存器', () => {
  const names = fields('receive').map((field) => field.name)
  assert.ok(names.includes('output_bit_registers0_to_31'), '接收段应启用 bool 寄存器 0–31')
  assert.ok(
    names.includes('output_bit_registers32_to_63'),
    '接收段缺少 output_bit_registers32_to_63：RobotModel.OutputBitRegister() 只有在该字段存在时才填充 32–63',
  )
  // 工具实际读的 int/double 寄存器下标上限是 23（见 ur_worker 的 _bounded_int(0, 23)）。
  for (const index of [0, 23]) {
    assert.ok(names.includes(`output_int_register_${index}`), `接收段应启用 output_int_register_${index}`)
    assert.ok(names.includes(`output_double_register_${index}`), `接收段应启用 output_double_register_${index}`)
  }
  assert.equal(new Set(names).size, names.length, '接收段字段不得重复')
})

test('输入侧必须不存在：不得认领任何 RTDE 输入变量', () => {
  assert.doesNotMatch(
    configBody,
    /<send\b/,
    '配方里不得出现 <send> 段：认领输入变量会让后续 SETUP_INPUTS 被控制器拒绝'
      + '（"An input parameter is already in use."），该异常会打崩 RTDE 线程并使会话无法重建',
  )
})

test('初次连接不得启用 RTDE 输入配方（上游重连分支的调用因配方为空而无害）', () => {
  const sequence = connectSequence()
  assert.ok(
    !/^\s*self\.__setupInput\(\)/m.test(sequence),
    'run() 的初次连接序列里不得调用 __setupInput()（配方为空 ⇒ 即便上游重连分支调用它也只是空请求）',
  )
})

test('写操作走 URScript，不再经 RTDE 输入', () => {
  // 断言的是**行为契约**（这几条 URScript 语句必须被拼出来并交给发送路径），而不是
  // 某一行 `RealTimeClient.Send(...)` 的写法：0.5.0 起统一经 `_realtime_send()` 发送，
  // 好让"发送失败"能被如实回报（旧写法只是把字符串丢进 socket 就报成功）。
  assert.match(
    workerSource,
    /"set_standard_digital_out\(%d, %s\)\\n" % \(n, flag\)/,
    'op_set_digital_out 必须拼出 set_standard_digital_out 的 URScript',
  )
  assert.match(
    workerSource,
    /"set_configurable_digital_out\(%d, %s\)\\n" % \(n - 8, flag\)/,
    'config 分支同样走 URScript，且必须做 8-15 → 0-7 的编号换算',
  )
  assert.match(
    workerSource,
    /_realtime_send\(robot, script\)/,
    '数字输出必须经 _realtime_send()（它会把发送失败如实变成 ok:false）',
  )
  // URBasic 里那两个用 RTDE setData 的 helper 不得再被调用（它们需要输入配方）。
  assert.doesNotMatch(
    workerSource,
    /robot\.set_standard_digital_out\(|robot\.set_configurable_digital_out\(/,
    '不得再调用 URBasic 里经 RTDE setData 的数字输出 helper',
  )
})

test('package.json 的 files 会把配方发出去', () => {
  assert.ok(
    manifest.files.includes('python/URBasic/rtdeConfiguration.xml'),
    'package.json 的 files 必须包含 python/URBasic/rtdeConfiguration.xml，否则发布的包里没有接收配方',
  )
  assert.ok(manifest.files.includes('python/URBasic/rtdeConfigurationDefault.xml'), 'files 应保留 Default 作为回退')
})

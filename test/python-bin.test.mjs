/**
 * `scripts/python-bin.mjs` 的注入式单测（审核 P3）。
 *
 * 这个解析器是发布门槛的入口：它决定 `check:ops` / `npm test` 用哪个解释器。它踩过的坑都很具体 ——
 * Windows 上 `python` 是 Microsoft Store 占位别名（**执行报 9009**）、`py` 指向已被删除的
 * `C:\Python314`（**101/103**）、沙箱下 `spawnSync` 建管道被拒（**EPERM，拿不到退出码**）。
 * 这些情况以前只有"实机能跑"这一层保证，换个机器/换个 npm 版本就可能静默回归。
 *
 * 这里全部**注入** `spawn` / `run` / `exists` / `env` / `cwd`：不装 Python 也能跑，也不碰真实系统。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { candidateList, resolvePython } from '../scripts/python-bin.mjs'

/** 一个"谁都不成功"的探测桩。 */
const noneWork = () => ({ status: 9009, stdout: '', stderr: '' })

/** 让某个可执行名成功的探测桩。 */
const onlyWorks = (...commands) => {
  const wanted = new Set(commands)
  return (candidate) => (wanted.has(candidate.command)
    ? { status: 0, stdout: `${candidate.command}\n` }
    : { status: 9009, stdout: '', stderr: '' })
}

test('UR_PYTHON 最优先：第一个就成功，就不再探测后面的候选', () => {
  const seen = []
  const spawn = (candidate) => {
    seen.push(candidate.command)
    return candidate.command === '/custom/python' ? { status: 0, stdout: '/custom/python\n' } : noneWork()
  }
  const out = resolvePython({
    env: { UR_PYTHON: '/custom/python' },
    cwd: '/w',
    exists: () => false,
    run: () => ({ status: 1, stdout: '' }),
    spawn,
  })
  assert.equal(out.ok, true)
  assert.equal(out.command, '/custom/python')
  assert.deepEqual(seen, ['/custom/python'], '成功后不该再探测别的候选')
  assert.equal(out.label, 'UR_PYTHON')
})

test('UR_PYTHON 指向坏解释器时不盲信环境变量，继续往下找到能用的', () => {
  const out = resolvePython({
    env: { UR_PYTHON: '/broken/python' },
    cwd: '/w',
    exists: () => false,
    run: () => ({ status: 1, stdout: '' }),
    spawn: onlyWorks('python3'),
  })
  assert.equal(out.ok, true, '环境变量坏了也必须回退，而不是直接失败')
  assert.equal(out.command, 'python3')
  assert.ok(out.tried.some((t) => t.command === '/broken/python'), '坏掉的那个要留在 tried 里（可诊断）')
})

test('候选顺序：项目 .venv 先于 python3，python3 先于 python（不依赖平台）', () => {
  const labels = candidateList({
    env: {},
    cwd: '/w',
    exists: () => false,
    run: () => ({ status: 1, stdout: '' }),
  }).map((c) => c.label)
  assert.ok(labels.includes('.venv'), '项目内虚拟环境必须是一个候选')
  assert.ok(labels.indexOf('.venv') < labels.indexOf('python3'), '.venv 应先于 PATH 上的 python3')
  assert.ok(labels.indexOf('python3') < labels.indexOf('python'), 'python3 应先于 python')
})

test('诊断区分"没能启动"与"退出码非 0"，并逐个候选给出原因', () => {
  const spawn = (candidate) => {
    if (candidate.command === 'python3') return { status: null, stdout: '', stderr: '', error: 'EPERM' }
    return { status: 9009, stdout: '', stderr: '' }
  }
  const out = resolvePython({
    env: { UR_PYTHON: '/broken/python' },
    cwd: '/w',
    exists: () => false,
    run: () => ({ status: 1, stdout: '' }),
    spawn,
  })
  assert.equal(out.ok, false)
  assert.match(out.reason, /找不到可用的 Python 解释器/, '失败要给出总结论')
  assert.match(out.reason, /UR_PYTHON=/, '失败诊断里必须有"怎么修"')
  assert.ok(out.tried.some((t) => /无法启动/u.test(t.reason) && /EPERM/u.test(t.reason)), 'EPERM 要单独说清是"没能启动"')
  assert.ok(out.tried.some((t) => /9009/u.test(t.reason)), '9009 要指出是 Store 占位别名那种情况')
})

test('py -0p 列出的已注册安装会被采用，不存在的路径被跳过（仅 Windows）', (t) => {
  if (process.platform !== 'win32') {
    // 这条分支只存在于 Windows（`py` 启动器与注册表安装列表）—— POSIX 上没有等价物。
    t.skip('py -0p 是 Windows 专属分支，跳过')
    return
  }
  const listed = ' -V:3.12 *        C:\\Py312\\python.exe\n -V:3.10          C:\\Gone\\python.exe\n'
  const candidates = candidateList({
    env: {},
    cwd: 'C:\\w',
    exists: (p) => p === 'C:\\Py312\\python.exe', // 3.10 那条已不存在
    run: (cmd, args) => (cmd === 'py' && args[0] === '-0p' ? { status: 0, stdout: listed } : { status: 1, stdout: '' }),
  })
  const commands = candidates.map((c) => c.command)
  assert.ok(commands.includes('C:\\Py312\\python.exe'), '存在的安装要成为候选')
  assert.ok(!commands.includes('C:\\Gone\\python.exe'), '不存在的安装不能成为候选（否则每台机器都多一次必然失败的 spawn）')
})

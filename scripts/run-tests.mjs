/**
 * scripts/run-tests.mjs — 跑**全部**测试，而不是只跑自检。
 *
 * ## 为什么需要这个脚本（这是一次真实的覆盖率事故）
 * `package.json` 的 `test` 原本只指向 `test/selftest.mjs`（一次 worker ping）。仓库里
 * 另外 20 多个 `*.test.mjs` —— 客户端轮询状态机、FK、模型契约、孪生路由、vendored 库缺陷 ——
 * **一个都没有被 `npm test` 跑到**。于是"npm test 绿了"完全不能说明插件是好的：
 * 那些文件只有人工逐个 `node test/x.test.mjs` 才会执行。
 *
 * 现在统一入口：本脚本枚举 `test/*.test.mjs`（外加 Python worker 的自检 selftest），
 * 逐个跑，汇总成败，全部通过才返回 0。
 *
 * 单独跑某一个：
 *   node test/<name>.test.mjs
 * 只跑 Node 测试（跳过需要 Python 的）：
 *   node scripts/run-tests.mjs --skip-python
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testDir = join(root, 'test');
const skipPython = process.argv.includes('--skip-python');

/** 需要 Python 解释器的用例：环境没装 Python 时给出可跳过的明确说明。 */
const PYTHON_DEPENDENT = new Set([
  'connect-timeout.test.mjs',
  'remote-control.test.mjs',
  'rtde-config.test.mjs',
  'safety-status.test.mjs',
  'send-script-verify.test.mjs',
  'tool-frame-moves.test.mjs',
  'vendored-fixes.test.mjs',
  'worker-log.test.mjs',
  'worker.test.mjs',
  'tool-schema-dsl.test.mjs',
]);

function probePython() {
  const bin = process.env.PYTHON ?? 'python';
  const r = spawnSync(bin, ['-c', 'print(1)'], { encoding: 'utf8' });
  return r.status === 0;
}

const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

if (files.length === 0) {
  console.error('run-tests: test/ 下没有 *.test.mjs —— 测试入口丢失了？');
  process.exit(1);
}

const hasPython = probePython();
const results = [];

for (const file of files) {
  const needsPython = PYTHON_DEPENDENT.has(file);
  if (skipPython && needsPython) {
    results.push({ file, status: 'skipped', detail: '--skip-python' });
    continue;
  }
  if (!hasPython && needsPython) {
    results.push({ file, status: 'skipped', detail: '未找到 Python 解释器（可用 PYTHON=<path> 指定）' });
    continue;
  }
  process.stdout.write(`\n── ${file} ──\n`);
  const r = spawnSync(process.execPath, [join(testDir, file)], {
    stdio: 'inherit',
    env: process.env,
  });
  results.push({
    file,
    status: r.status === 0 ? 'pass' : 'fail',
    detail: r.status === 0 ? '' : `exit ${r.status}${r.signal ? ` signal ${r.signal}` : ''}`,
  });
}

const failed = results.filter((r) => r.status === 'fail');
const skipped = results.filter((r) => r.status === 'skipped');

console.log('\n================ 汇总 ================');
for (const r of results) {
  const mark = r.status === 'pass' ? 'PASS' : r.status === 'skipped' ? 'SKIP' : 'FAIL';
  console.log(`${mark}  ${r.file}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log(
  `\n共 ${results.length} 个测试文件：通过 ${results.length - failed.length - skipped.length}，` +
    `失败 ${failed.length}，跳过 ${skipped.length}`,
);

process.exit(failed.length === 0 ? 0 : 1);

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
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testDir = join(root, 'test');
const skipPython = process.argv.includes('--skip-python');

/**
 * 需要「可用的 Python」的用例。
 *
 * ⚠️ 这份名单必须与实际 spawn Python 的文件一致，否则 `--skip-python` 会一边宣称
 * "跳过需要 Python 的用例"、一边把漏掉的那个跑起来并以 exit 1 收场（`test/selftest.test.mjs`
 * 就这样让 `npm run test:node` 长期不可能通过）。
 *
 * 唯一来源是 `test/test-manifest.json`；`scripts/check-test-manifest.mjs` 会扫描 `test/**`
 * 里真实的 Python 调用并与它对账，所以"漏登记"会变成一次失败的自检而不是一次误报的失败。
 */
const manifest = JSON.parse(readFileSync(join(testDir, 'test-manifest.json'), 'utf8'));
const PYTHON_DEPENDENT = new Set(manifest.pythonDependent);

/**
 * 解释器可用吗？**必须验证 worker 真正需要的依赖**，而不是"Python 能启动"。
 *
 * 旧探针只跑 `python -c print(1)`：在一个没有 numpy 的解释器上它会成功，于是这些用例被
 * **执行**（而不是跳过）并以失败收场，`npm test` 的结论就变成了"插件坏了"——实际只是环境
 * 没装依赖。`ur_worker.py` 顶层就 `import numpy`，所以这里以"能否 import numpy"为准；
 * paramiko 只有 list_programs 用得到，缺失时给一条提示但仍视为可用。
 */
function probePython() {
  // `UR_PYTHON` 在前：README 与 test/selftest.test.mjs 一直是这样约定的
  // （`UR_PYTHON || PYTHON || 'python'`）。
  const bin = process.env.UR_PYTHON ?? process.env.PYTHON ?? 'python';
  const probe = 'import numpy; print("ok")';
  const r = spawnSync(bin, ['-c', probe], { encoding: 'utf8' });
  if (r.status !== 0) {
    const why = (r.stderr ?? '').trim().split('\n').pop() ?? '';
    console.log(
      `note  ${bin} 不能 import numpy${why ? `（${why}）` : ''}：跳过需要 Python 的用例。` +
        '\n      这是环境问题，不是插件缺陷。装依赖或指定解释器：' +
        '\n        pip install -r requirements.txt' +
        '\n        UR_PYTHON=C:\\Python312\\python.exe npm test',
    );
    return false;
  }
  const p = spawnSync(bin, ['-c', 'import paramiko'], { encoding: 'utf8' });
  if (p.status !== 0) {
    console.log(`note  ${bin} 没有 paramiko：ur_list_programs 的 SSH 用例会失败（其余用例不受影响）`);
  }
  return true;
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

/*
 * `npm test` 也必须跑**静态与跨语言门禁**，否则它们只是"仓库里放着、从没人跑"的脚本 ——
 * 审计发现过好几条只有脚本、没有接入的症状（未跟踪的配方、落后的 bundle、门禁无行为测试）。
 * Python 依赖的门禁在解释器不可用时跳过，并说明这是环境问题。
 */
const CHECKS = [
  { name: 'node scripts/check-test-manifest.mjs', bin: process.execPath, args: ['scripts/check-test-manifest.mjs'] },
  { name: 'node scripts/check-package-metadata.mjs', bin: process.execPath, args: ['scripts/check-package-metadata.mjs'] },
  { name: 'node scripts/check-client-bundle.mjs', bin: process.execPath, args: ['scripts/check-client-bundle.mjs'] },
  { name: 'node scripts/check-doc-tools.mjs', bin: process.execPath, args: ['scripts/check-doc-tools.mjs'] },
  { name: 'python scripts/check-worker-ops.py', needsPython: true },
  { name: 'python scripts/check-tool-params.py', needsPython: true },
  { name: 'python scripts/check-rtde-recipe.py', needsPython: true },
  { name: 'python scripts/check-approval-gate.py', needsPython: true },
  // Needs numpy/paramiko (it imports the worker), unlike the four static gates above.
  { name: 'python scripts/check-new-ops.py', needsPython: true, needsDeps: true },
];

const pythonBin = process.env.UR_PYTHON ?? process.env.PYTHON ?? 'python';
for (const check of CHECKS) {
  const label = check.name;
  if (check.needsPython && skipPython) {
    results.push({ file: label, status: 'skipped', detail: '--skip-python' });
    continue;
  }
  if (check.needsPython && !hasPython) {
    results.push({ file: label, status: 'skipped', detail: '环境无可用依赖（numpy/paramiko），非插件缺陷' });
    continue;
  }
  process.stdout.write(`\n── ${label} ──\n`);
  const r = check.needsPython
    ? spawnSync(pythonBin, [check.name.split(' ')[1]], { stdio: 'inherit', env: process.env })
    : spawnSync(check.bin, check.args, { stdio: 'inherit', env: process.env });
  results.push({
    file: label,
    status: r.status === 0 ? 'pass' : 'fail',
    detail: r.status === 0 ? '' : `exit ${r.status}`,
  });
}

const failedAll = results.filter((r) => r.status === 'fail');
const skippedAll = results.filter((r) => r.status === 'skipped');

console.log('\n================ 汇总 ================');
for (const r of results) {
  const mark = r.status === 'pass' ? 'PASS' : r.status === 'skipped' ? 'SKIP' : 'FAIL';
  console.log(`${mark}  ${r.file}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log(
  `\n共 ${results.length} 项（测试文件 + 门禁）：通过 ${results.length - failedAll.length - skippedAll.length}，` +
    `失败 ${failedAll.length}，跳过 ${skippedAll.length}`,
);

process.exit(failedAll.length === 0 ? 0 : 1);

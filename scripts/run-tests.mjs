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
 * 环境确实缺依赖、你**明确接受**跳过时（否则有跳过即视为失败）：
 *   node scripts/run-tests.mjs --allow-skip
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
/**
 * 解释器可用吗？**分两级探测，因为两者的门槛不一样**：
 *   - `interpreter`：解释器本身能启动 —— 4 条只做 AST/正则的 Python 门禁只需要这一级
 *     （`check-worker-ops` / `check-tool-params` / `check-rtde-recipe` / `check-approval-gate`）；
 *   - `deps`：`import numpy` 成功 —— `ur_worker.py` 顶层就 `import numpy`，所以**测试文件**
 *     与 `check-new-ops.py`（它会 import worker）需要这一级。
 *
 * 旧探针只有一级（numpy），于是 4 条根本不需要 numpy 的门禁被一并跳过；`needsDeps` 字段虽然
 * 写着却从没被读过。paramiko 单独探测：只有 `ur_list_programs` 的 SSH 用例需要它。
 */
function probePython() {
  // `UR_PYTHON` 在前：README 与 test/selftest.test.mjs 一直是这样约定的
  // （`UR_PYTHON || PYTHON || 'python'`）。`cwd` 锚定仓库根：解释器垫片/相对路径不该依赖调用者站哪。
  const bin = process.env.UR_PYTHON ?? process.env.PYTHON ?? 'python';
  const run = (code) => spawnSync(bin, ['-c', code], { encoding: 'utf8', cwd: root });
  if (run('import sys').status !== 0) {
    console.log(
      `note  找不到可用的 Python 解释器（${bin}）：**所有** Python 门禁与用例都会被跳过。\n` +
        '      这是环境问题，不是插件缺陷。指定解释器：' +
        '\n        UR_PYTHON=C:\\Python312\\python.exe node scripts/run-tests.mjs',
    );
    return { bin, interpreter: false, deps: false };
  }
  const numpy = run('import numpy; print("ok")');
  const deps = numpy.status === 0;
  if (!deps) {
    const why = (numpy.stderr ?? '').trim().split('\n').pop() ?? '';
    console.log(
      `note  ${bin} 不能 import numpy${why ? `（${why}）` : ''}：需要 numpy 的用例与 ` +
        'check-new-ops.py 会被跳过；**只做 AST/正则的 4 条 Python 门禁仍然照跑**。\n' +
        '      这是环境问题，不是插件缺陷。装依赖或指定解释器：' +
        '\n        pip install -r requirements.txt' +
        '\n        UR_PYTHON=C:\\Python312\\python.exe node scripts/run-tests.mjs',
    );
  }
  if (run('import paramiko').status !== 0) {
    console.log(`note  ${bin} 没有 paramiko：ur_list_programs 的 SSH 用例会失败（其余用例不受影响）`);
  }
  return { bin, interpreter: true, deps };
}

const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

if (files.length === 0) {
  console.error('run-tests: test/ 下没有 *.test.mjs —— 测试入口丢失了？');
  process.exit(1);
}

const python = probePython();
const results = [];

for (const file of files) {
  const needsPython = PYTHON_DEPENDENT.has(file);
  if (skipPython && needsPython) {
    results.push({ file, status: 'skipped', detail: '--skip-python' });
    continue;
  }
  if (needsPython && !python.deps) {
    results.push({
      file,
      status: 'skipped',
      detail: python.interpreter
        ? `Python 缺依赖（${python.bin} 不能 import numpy）`
        : `没有可用的 Python 解释器（${python.bin}）`,
    });
    continue;
  }
  process.stdout.write(`\n── ${file} ──\n`);
  const r = spawnSync(process.execPath, [join(testDir, file)], {
    stdio: 'inherit',
    // `cwd` 锚定仓库根：用例里用相对路径（fixtures、python/）时不该依赖调用者站在哪。
    cwd: root,
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
  /*
   * 离线探针：不需要真机、也不需要宿主，纯靠注入的假流与真实定时器驱动孪生/SSE 的连续性。
   *
   * 它们以前**不接入任何门禁**，于是只能人工跑 —— 而"只有脚本、没人跑"正是审计里反复出现的
   * 症状。后两条需要 `EventSource`：Node 22.3 起用 `--experimental-eventsource` 打开。不加开关
   * 它们会立刻以 1 退出（探针自己拒绝退化成"不模拟 onerror 的假实现"），所以这里显式带上。
   */
  { name: 'node scripts/probe-sse-lifetime.mjs', bin: process.execPath, args: ['scripts/probe-sse-lifetime.mjs'] },
  { name: 'node scripts/probe-twin-pump-stall.mjs', bin: process.execPath, args: ['scripts/probe-twin-pump-stall.mjs'] },
  { name: 'node scripts/probe-twin-push-continuity.mjs', bin: process.execPath, args: ['scripts/probe-twin-push-continuity.mjs'] },
  {
    name: 'node --experimental-eventsource scripts/probe-twin-stall-end-to-end.mjs',
    bin: process.execPath,
    args: ['--experimental-eventsource', 'scripts/probe-twin-stall-end-to-end.mjs'],
  },
  {
    name: 'node --experimental-eventsource scripts/probe-twin-stream-error-event.mjs',
    bin: process.execPath,
    args: ['--experimental-eventsource', 'scripts/probe-twin-stream-error-event.mjs'],
  },
  /*
   * 宿主兼容检查（真实 DSL 编译 104 个工具 schema + 路由注册）。它是**环境检查**：
   * 没有安装 DSH Desktop 的机器上只能 SKIP，不能因此判失败，但**绝不允许静默通过** ——
   * 单独打印结果与原因，并明确标注「不计入上面的 56 项」。装了宿主（或 CI 提供
   * `--host-asar`）时它真的会跑，并把 104/104 注册数当作证据。
   */
  {
    name: 'node scripts/check-host-compat.mjs --allow-missing-host',
    bin: process.execPath,
    args: ['scripts/check-host-compat.mjs', '--allow-missing-host'],
    hostCheck: true,
  },
];

/** 宿主检查是环境项：单独记录、单独打印，不计入 56 项总数（结果不影响本机无宿主的运行）。 */
let hostResult = null;

const pythonBin = python.bin;
for (const check of CHECKS) {
  const label = check.name;
  if (check.hostCheck) {
    process.stdout.write(`\n── ${label} ──\n`);
    const r = spawnSync(check.bin, check.args, { encoding: 'utf8', cwd: root, env: process.env });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    process.stdout.write(output);
    if (r.status !== 0) hostResult = { status: 'fail', detail: `exit ${r.status}` };
    else if (/^SKIP\b/m.test(output)) hostResult = { status: 'skipped', detail: '宿主不可用（原因见上；装 DSH Desktop 或用 --host-asar）' };
    else hostResult = { status: 'pass', detail: '宿主真实 value-schema DSL 校验通过' };
    continue;
  }
  if (check.needsPython && skipPython) {
    results.push({ file: label, status: 'skipped', detail: '--skip-python' });
    continue;
  }
  if (check.needsPython && !python.interpreter) {
    results.push({ file: label, status: 'skipped', detail: '环境无可用 Python 解释器，非插件缺陷' });
    continue;
  }
  // `needsDeps` 以前只写在数据里、循环从不读它 ⇒ 4 条只做 AST/正则的门禁被连带跳过。
  if (check.needsDeps && !python.deps) {
    results.push({ file: label, status: 'skipped', detail: '环境无 numpy（该门禁会 import worker）' });
    continue;
  }
  process.stdout.write(`\n── ${label} ──\n`);
  const r = check.needsPython
    ? spawnSync(pythonBin, [check.name.split(' ')[1]], { stdio: 'inherit', cwd: root, env: process.env })
    : spawnSync(check.bin, check.args, { stdio: 'inherit', cwd: root, env: process.env });
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
if (hostResult !== null) {
  const mark = hostResult.status === 'pass' ? 'PASS' : hostResult.status === 'skipped' ? 'SKIP' : 'FAIL';
  console.log(`${mark}  宿主兼容检查 — ${hostResult.detail}（环境项，不计入下面的项数）`);
}
const ran = results.length - skippedAll.length;
console.log(
  `\n共 ${results.length} 项（测试文件 + 门禁）：通过 ${results.length - failedAll.length - skippedAll.length}，` +
    `失败 ${failedAll.length}，跳过 ${skippedAll.length}`,
);

/*
 * "全绿"必须是**真的跑了**才算。
 *
 * 旧写法是 `process.exit(failedAll.length === 0 ? 0 : 1)` —— 把"跳过"当绿。在一台没装 numpy 的
 * 机器上，11 个测试文件 + 5 条门禁会全部跳过，`npm test` 照样打印「失败 0」并 exit 0：
 * 看起来全绿，实际上什么都没验证过。显式的跳过开关（`--skip-python` / `--allow-skip`）照旧放行，
 * 因为它们表达的正是"我知道这些没跑"。
 *
 * 宿主兼容检查是唯一允许 SKIP 的项：它是**环境**（有没有装 DSH Desktop），不是插件代码；
 * 但它必须在上面的汇总里单独占一行并带上原因，不能被悄悄算进 PASS。
 */
const allowSkip = skipPython || process.argv.includes('--allow-skip');
if (failedAll.length > 0) process.exit(1);
if (hostResult !== null && hostResult.status === 'fail') process.exit(1);
if (ran === 0) {
  console.error('\n没有任何一项真正执行（全部被跳过）—— 这不能算通过。');
  process.exit(1);
}
if (skippedAll.length > 0 && !allowSkip) {
  console.error(
    `\n有 ${skippedAll.length} 项被跳过 —— 这不能算通过。\n` +
      '  如果这是你明确接受的环境状态，请显式加 --allow-skip（或 --skip-python）。',
  );
  process.exit(1);
}
process.exit(0);

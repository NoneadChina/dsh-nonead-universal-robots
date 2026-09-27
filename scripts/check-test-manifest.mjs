/**
 * scripts/check-test-manifest.mjs — 让"哪些用例需要 Python"这件事不再靠人记。
 *
 * ## 为什么需要它（一次真实的长期红灯）
 * `scripts/run-tests.mjs` 依据 `test/test-manifest.json` 的 `pythonDependent` 决定在没有可用
 * Python 时跳过哪些文件。`test/selftest.test.mjs` 会 spawn Python，却长期不在这份名单里 ——
 * 于是 `npm run test:node`（README、package.json 都声称"只跑 Node 侧用例"）每次都以
 * `FAIL selftest.test.mjs — exit 1` 收场。一份名单和一个目录，靠人眼对齐迟早会漂。
 *
 * 本脚本扫描 `test/**` 里**真实的 Python 调用**（`spawnSync(process.env.PYTHON…)`、
 * `ur_worker`/`URBasic` 导入、`--selfcheck`、`ur-python-harness.py`），与清单双向对账：
 *   - 调用了 Python 但没登记 ⇒ 失败（否则它会以 exit 1 出现，误导成"插件坏了"）
 *   - 登记了却完全不碰 Python ⇒ 失败（否则它会被无谓地跳过，白白失去覆盖）
 *
 * 用法：node scripts/check-test-manifest.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testDir = join(root, 'test');
const manifest = JSON.parse(readFileSync(join(testDir, 'test-manifest.json'), 'utf8'));

/** 一个测试文件是否真的需要 Python —— 只看会执行 Python 的形态，不看去注释。 */
function needsPython(source) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')      // 块注释
    .replace(/^\s*\/\/.*$/gm, '');         // 行注释
  return [
    /spawnSync\(\s*process\.env\.(UR_)?PYTHON/,   // 显式用环境变量里的解释器
    /spawnSync\(\s*PYTHON\b/,                     // 先取进常量再用
    /process\.env\.(UR_)?PYTHON\s*\?\?/,
    /\bpythonBin\b/,                              // 经 UrWorker 起 worker
    /from\s+['"][^'"]*ur_worker['"]/,
    /import\s+ur_worker/,
    /--selfcheck/,
    /ur-python-harness\.py/,
  ].some((pattern) => pattern.test(code));
}

const files = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

const declared = new Set(manifest.pythonDependent);
const declaredNodeOnly = new Set(manifest.nodeOnly);
let failed = false;
const fail = (message) => {
  failed = true;
  console.log(`FAIL  ${message}`);
};

const actuallyNeeds = [];
for (const file of files) {
  const source = readFileSync(join(testDir, file), 'utf8');
  if (needsPython(source)) actuallyNeeds.push(file);
}

// 1) every Python-using file must be declared
for (const file of actuallyNeeds) {
  if (!declared.has(file)) {
    fail(`${file} 会调用 Python，但没登记在 test-manifest.json 的 pythonDependent 里 —— ` +
      '在没有可用 Python 的机器上它会被执行而不是跳过，并以 exit 1 误导成插件缺陷');
  }
}
if (actuallyNeeds.every((f) => declared.has(f))) {
  console.log(`PASS  ${actuallyNeeds.length} 个需要 Python 的用例都已登记`);
}

// 2) every declared file must actually use Python
for (const file of declared) {
  if (!files.includes(file)) {
    fail(`pythonDependent 里的 ${file} 不存在`);
  } else if (!actuallyNeeds.includes(file)) {
    fail(`pythonDependent 里登记了 ${file}，但它并不调用 Python —— 它会被无谓跳过，白白丢失覆盖`);
  }
}

// 3) the two lists must partition the directory exactly
for (const file of declaredNodeOnly) {
  if (!files.includes(file)) fail(`nodeOnly 里的 ${file} 不存在`);
  if (declared.has(file)) fail(`${file} 同时出现在 pythonDependent 与 nodeOnly`);
}
const covered = new Set([...declared, ...declaredNodeOnly]);
const uncovered = files.filter((f) => !covered.has(f));
if (uncovered.length > 0) {
  fail(`以下测试文件既不在 pythonDependent 也不在 nodeOnly：${uncovered.join(', ')}`);
} else if (!failed) {
  console.log(`PASS  ${files.length} 个测试文件被两份清单完整覆盖（Python ${declared.size} / Node ${declaredNodeOnly.size}）`);
}

process.exit(failed ? 1 : 0);

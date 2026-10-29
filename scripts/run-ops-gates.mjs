#!/usr/bin/env node
/**
 * scripts/run-ops-gates.mjs — 一次解析解释器，跑完 5 个 Python 门禁（审核 P4）。
 *
 * ## 为什么不是 5 条 `run-py`
 *
 * `check:ops` 原先写成
 *   `node scripts/run-py.mjs a.py && node scripts/run-py.mjs b.py && …`
 * 每条都是一次独立进程，于是**每次都重新解析解释器**：最多 6 个候选各 spawn 一次、外加一次
 * `py -0p`，五条下来将近 30 次进程创建 —— 而结论永远相同。在 Windows 上这个过程尤其慢
 * （进程创建本身就贵），而发布门槛里 `npm run check` 又是常跑路径。
 *
 * 这里命名一次解析结果、按顺序跑完所有门禁；失败时**明确指出是哪一个门禁**，并沿用第一个
 * 非零退出码（与 `&&` 链的语义一致，不会把后面的门禁"跑绿"了当成功）。
 *
 * 解析本身仍然走 `python-bin.mjs`（`UR_PYTHON` 优先、按"真的能启动"判定），只是不再重复。
 */

import { spawnSync } from 'node:child_process';

import { resolvePython } from './python-bin.mjs';

/** 门禁脚本（顺序即执行顺序；全部只读源码/AST，不改任何东西）。 */
const GATES = [
  'scripts/check-worker-ops.py',
  'scripts/check-new-ops.py',
  'scripts/check-approval-gate.py',
  'scripts/check-tool-params.py',
  'scripts/check-rtde-recipe.py',
];

const resolved = resolvePython();
if (!resolved.ok) {
  console.error(resolved.reason);
  process.exit(127);
}

// 用 stderr 打印，避免污染门禁自己的 stdout（有门禁会打印 JSON 供人粘贴）。
console.error(`[run-ops] ${resolved.label} → ${resolved.executable ?? resolved.command}`);

// 与 `run-py.mjs` 相同的双保险：Windows 上 Python 默认按控制台代码页编码 stdout，
// 中文会变乱码；门禁输出是给人看的，必须钉死 UTF-8。
const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };

for (const script of GATES) {
  const result = spawnSync(resolved.command, [...resolved.prefixArgs, script], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env,
    windowsHide: true,
  });
  if (result.error) {
    console.error(`[run-ops] 无法启动 ${resolved.command}：${result.error.message}`);
    process.exit(127);
  }
  if (result.status !== 0) {
    // 如实指出是哪一个门禁没过（`&&` 链只会告诉你"命令失败"，看不出是哪一步）。
    console.error(`[run-ops] 门禁失败：${script}（exit ${result.status ?? 'signal'}）`);
    process.exit(result.status ?? 1);
  }
}

console.error(`[run-ops] ${GATES.length} 个 Python 门禁全部通过`);

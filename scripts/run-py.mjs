#!/usr/bin/env node
/**
 * scripts/run-py.mjs — 用"解析出来的解释器"执行一个 Python 脚本。
 *
 * 用法：
 *   node scripts/run-py.mjs scripts/check-worker-ops.py
 *   node scripts/run-py.mjs scripts/check-new-ops.py --verbose
 *   node scripts/run-py.mjs --which          # 只打印用的是哪个解释器（排障用）
 *
 * 为什么不让 package.json 直接写 `python`：在 Windows 上 `python` 可能是 Microsoft Store 的
 * 占位别名（执行报 exit 9009），或 `py` 指向一个已被删除的版本 —— 那时 `npm run check` 只会给出
 * `npm error code 9009`，看不出"是解释器的问题"。这个包装把解析过程集中到 `python-bin.mjs`，
 * 并把"试过哪些、为什么都不行、怎么修"完整打印出来。
 *
 * ⚠️ 子进程用 `stdio: 'inherit'`：沙箱下用管道捕获外部程序输出会失败，继承则不受影响。
 */

import { spawn } from 'node:child_process';

import { resolvePython } from './python-bin.mjs';

const argv = process.argv.slice(2);

if (argv.length > 0 && (argv[0] === '--which' || argv[0] === '-w')) {
  const resolved = resolvePython();
  if (!resolved.ok) {
    console.error(resolved.reason);
    process.exit(127);
  }
  console.log(`python: ${resolved.label}`);
  console.log(`command: ${resolved.command}${resolved.prefixArgs.length > 0 ? ` ${resolved.prefixArgs.join(' ')}` : ''}`);
  console.log(`executable: ${resolved.executable}`);
  process.exit(0);
}

if (argv.length === 0) {
  console.error('用法: node scripts/run-py.mjs <script.py> [args...]   或   node scripts/run-py.mjs --which');
  process.exit(2);
}

const resolved = resolvePython();
if (!resolved.ok) {
  console.error(resolved.reason);
  process.exit(127);
}

// 静默解析细节，但保留一条可核对的行（出问题时知道用的是哪个解释器）
if (!process.env.UR_PY_SILENT) {
  console.error(`[run-py] ${resolved.label} → ${resolved.executable ?? resolved.command}`);
}

const child = spawn(resolved.command, [...resolved.prefixArgs, ...argv], {
  stdio: 'inherit',
  cwd: process.cwd(),
  // `PYTHONUTF8` / `PYTHONIOENCODING`：Windows 上 Python 默认按控制台代码页（常是 cp936）编码
  // stdout，而这些门禁脚本打印的是中文 —— 不钉死在 UTF-8 上，中文就会变成乱码，读的人
  // 只能靠猜。与 `lib/worker.js` 给 worker 子进程加的双保险一致。
  env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  windowsHide: true,
});

child.on('error', (error) => {
  console.error(`[run-py] 无法启动 ${resolved.command}: ${error?.message ?? error}`);
  process.exit(127);
});

child.on('exit', (code, signal) => {
  if (signal) {
    // 被信号终止：如实报成失败，不伪装成 0
    console.error(`[run-py] 子进程被信号终止：${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

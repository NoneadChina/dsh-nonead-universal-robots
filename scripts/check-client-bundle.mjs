/**
 * scripts/check-client-bundle.mjs — 证明提交的 `lib/client.js` 与 `src/client/**` 一致。
 *
 * ## 为什么是"重建 + 比对哈希"，而不是读字面量
 * `lib/client.js`（约 620 KB）是**被提交的构建产物**，DSH 直接加载它当插件前端；而
 * `src/client/**` 里的代码不会被任何测试或运行时执行。于是"bundle 落后于源码"是一种
 * 完全静默的发布缺陷：源码里修好的东西在界面上没有生效。
 *
 * 这个脚本此前用"源码里的字符串字面量是否出现在 bundle 里"来判断，有两个问题：
 *   1. 只统计双引号字面量（本仓库大多用单引号）⇒ 只抽查了 6 条，结论没有意义；
 *   2. 放宽到单引号后，压缩器会改写/拼接/内联一部分字面量 ⇒ 大量**假警报**。
 * 两种启发式都不该当门禁。现在改成确定性做法：把同样的构建**重跑到临时路径**，与提交的
 * 文件比对哈希。不相等就是落后，相等就是一致 —— 没有中间状态。
 *
 * 用 `BUILD_CLIENT_OUT` 把产物写到工作区内的临时文件，因此**绝不覆盖**提交的 bundle。
 *
 * 用法：node scripts/check-client-bundle.mjs
 */

import { createHash } from 'node:crypto';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const committed = join(root, 'lib', 'client.js');
const scratch = join(root, 'lib', `.client.rebuild-check.js`);

/**
 * The artifact minus its trailing `//# sourceMappingURL=` comment.
 *
 * esbuild writes the *output* filename into that comment, so a rebuild to a scratch path
 * differs from the committed file in exactly those few bytes and nothing else. Comparing the
 * bodies catches real drift (much smaller than a whole-file hash) while staying immune to the
 * one difference that is an artifact of checking rather than a change in the code. Verified:
 * a scratch rebuild differs from the committed bundle **only** at byte 621855, inside that
 * comment — 621855 identical bytes before it.
 */
const bodyOf = (path) =>
  readFileSync(path, 'utf8').replace(/\n?\/\/# sourceMappingURL=.*\s*$/, '\n');

const sha = (text) => createHash('sha256').update(text).digest('hex');
const human = (n) => `${(n / 1024).toFixed(1)} KB`;

let failed = false;
const fail = (m) => {
  failed = true;
  console.log(`FAIL  ${m}`);
};

if (!existsSync(committed)) {
  console.log(`FAIL  ${committed} 不存在 —— 发布包里会没有客户端半`);
  process.exit(1);
}

// Rebuild into the scratch path (never over the committed artifact).
rmSync(scratch, { force: true });
const build = spawnSync(process.execPath, ['scripts/build-client.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, BUILD_CLIENT_OUT: `lib/${'.client.rebuild-check.js'}` },
});

if (build.status !== 0 || !existsSync(scratch)) {
  rmSync(scratch, { force: true });
  // A broken build toolchain is not a stale bundle, but it does mean this check cannot
  // vouch for the artifact — say which of the two it is instead of guessing.
  fail(
    `无法重新构建（exit ${build.status}）：无法证明提交的 bundle 与源码一致。` +
      '请先修好 `npm run build:client`（例如 esbuild 二进制缺失/版本不匹配）',
  );
  process.exit(1);
}

const committedBody = bodyOf(committed);
const rebuiltBody = bodyOf(scratch);
const a = sha(committedBody);
const b = sha(rebuiltBody);
rmSync(scratch, { force: true });
rmSync(`${scratch}.map`, { force: true });

if (a === b) {
  console.log(
    `PASS  提交的 lib/client.js 可由当前 src/client/** 逐字节重建` +
      `（正文 sha256 ${a.slice(0, 16)}…，${human(committedBody.length)}；仅 sourceMappingURL 注释不同）`,
  );
} else {
  fail(
    'lib/client.js 与 src/client/** 不一致：\n' +
      `        提交产物正文 sha256 ${a.slice(0, 16)}… (${human(committedBody.length)})\n` +
      `        重新构建正文 sha256 ${b.slice(0, 16)}… (${human(rebuiltBody.length)})\n` +
      '      => 源码改了但产物没重建，界面上不会生效；请运行 `npm run build:client`',
  );
}

process.exit(failed ? 1 : 0);

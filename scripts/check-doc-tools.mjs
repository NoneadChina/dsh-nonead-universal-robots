/**
 * scripts/check-doc-tools.mjs — keep the READMEs' tool tables honest.
 *
 * ## What this catches, and what the earlier version missed
 * The tool *count* is gated in two other places, but a count is not a list: a table can say
 * "83 tools" while naming 80 of them, or name a tool that no longer exists. The first version of
 * this check scanned the whole README for `` `ur_*` `` identifiers — which meant **prose counted
 * as documentation**. Deleting an entire table row still passed, because the tool was usually
 * mentioned somewhere else in the file (verified by mutation in the verification audit).
 *
 * Now the tool names are read from **table rows only** (`|`-delimited lines), and they must match
 * what `lib/index.js` registers:
 *   - every registered tool must appear in a table row, in both READMEs
 *   - no table may name a tool that is not registered (a stale row is worse than a missing one)
 *   - the stated total must equal the number of registered tools
 *   - the registry itself must have no duplicate names
 *
 * Names mentioned in prose are reported as a note, never as a failure — the READMEs legitimately
 * mention historical names such as `ur_status` and the deliberately-absent `ur_get_joint_current`.
 *
 * Run: node scripts/check-doc-tools.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const indexSource = readFileSync(`${root}lib/index.js`, 'utf8');

/** Tool names as registered by lib/index.js. */
const registered = [...indexSource.matchAll(/toolName:\s*'(ur_[a-z0-9_]+)'/g)].map((m) => m[1]);
const registeredSet = new Set(registered);

/** Tool names that appear inside a markdown table row. */
function tableNames(file) {
  const text = readFileSync(`${root}${file}`, 'utf8');
  const names = new Set();
  for (const line of text.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    for (const m of line.matchAll(/`(ur_[a-z0-9_]+)`/g)) names.add(m[1]);
  }
  return names;
}

/** Tool names anywhere in the file (prose included) — informational only. */
function allNames(file) {
  const text = readFileSync(`${root}${file}`, 'utf8');
  return new Set([...text.matchAll(/`(ur_[a-z0-9_]+)`/g)].map((m) => m[1]));
}

let failed = false;
const fail = (message) => {
  failed = true;
  console.log(`FAIL  ${message}`);
};
const pass = (message) => console.log(`PASS  ${message}`);

if (registered.length !== registeredSet.size) {
  fail(`lib/index.js 里有重复的工具名：${registered.filter((n, i) => registered.indexOf(n) !== i).join(', ')}`);
} else {
  pass(`lib/index.js 注册了 ${registered.length} 个唯一工具名`);
}

for (const file of ['README.md', 'README.zh.md']) {
  const inTable = tableNames(file);
  const missing = registered.filter((name) => !inTable.has(name));
  const stale = [...inTable].filter((name) => !registeredSet.has(name));

  if (missing.length > 0) {
    fail(`${file} 的**表格**里缺少 ${missing.length} 个已注册工具：${missing.join(', ')}`);
  } else {
    pass(`${file} 的表格列出了全部 ${registered.length} 个工具`);
  }
  if (stale.length > 0) {
    fail(`${file} 的表格里有 ${stale.length} 个未注册的工具名（陈旧行）：${stale.join(', ')}`);
  }

  const proseOnly = [...allNames(file)].filter((name) => !registeredSet.has(name));
  if (proseOnly.length > 0) {
    console.log(`note  ${file} 正文提到 ${proseOnly.length} 个未注册的 ur_* 名字（允许，仅提示）：${proseOnly.join(', ')}`);
  }
}

/** The stated count must match the registry (the two READMEs phrase it differently). */
for (const [file, pattern] of [
  ['README.md', /\*\*(\d+)\*\* tools \(`ur_\*`\) in total/],
  ['README.zh.md', /共 \*\*(\d+)\*\* 个工具/],
]) {
  const text = readFileSync(`${root}${file}`, 'utf8');
  const match = pattern.exec(text);
  if (!match) {
    fail(`${file} 里找不到工具总数那一句（正则失配？）`);
  } else if (Number(match[1]) !== registered.length) {
    fail(`${file} 声称 ${match[1]} 个工具，实际注册 ${registered.length} 个`);
  } else {
    pass(`${file} 的总数与实际一致（${registered.length}）`);
  }
}

process.exit(failed ? 1 : 0);

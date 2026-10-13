/**
 * scripts/tool-registry.mjs — `lib/index.js` 注册的工具名**唯一来源**。
 *
 * ## 为什么单独一个模块
 * 工具总数此前散在三处：`check-doc-tools.mjs` 从源码动态数，而 `check-host-compat.mjs` 与
 * `test/tool-schema-dsl.test.mjs` **各自写死 `83`**。加/减一个工具要手动改多处，漏改一处就会
 * 互相矛盾（doc 门禁红、另两处仍以为 83 是对的）——而"数字漂移"正是这类门禁失去信任的方式。
 * 现在三处都从这里取数。
 *
 * ⚠️ 这里数的是**源码里声明的**工具名（`toolName: 'ur_*'`），不是运行期注册成功的数量。
 * 两者的差值正是要抓的东西：注册被静默丢掉时，"运行期注册数 == 源码声明数"这条断言会红
 * （见 `scripts/check-host-compat.mjs` 与 `test/tool-schema-dsl.test.mjs`）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

/**
 * 仓库根目录（本文件在 `scripts/` 下）。
 *
 * ⚠️ **不要用字符串拼接**去和它组路径：调用方传进来的根目录**可能没有尾分隔符**
 * （`fileURLToPath(new URL('..', import.meta.url))` 在本机带尾分隔符，而
 * `resolve(dirname(...), '..')` 不带）—— 拼接会得到 `...robotslib\index.js` 这种路径，
 * 报一个看不出原因的 ENOENT。一律用 `join()`。
 */
export const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * 从 `lib/index.js` 取注册的工具名，**保持出现顺序且不折重**。
 *
 * 不折重是有意的：调用方要靠 `length !== new Set(...).size` 发现"重名工具"（后者会静默覆盖前者）。
 */
export function registeredToolNames(root = PLUGIN_ROOT) {
  const source = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
  return [...source.matchAll(/toolName:\s*'(ur_[a-z0-9_]+)'/g)].map((match) => match[1])
}

/** 期望注册的工具数（去重后的唯一来源）。 */
export function expectedToolCount(root = PLUGIN_ROOT) {
  return new Set(registeredToolNames(root)).size
}

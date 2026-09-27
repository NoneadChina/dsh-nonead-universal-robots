/**
 * 数字孪生的路径常量 —— **零 import 的共享模块**（Ruling 22）。
 *
 * 为什么单独一个文件、而不是直接写进 `lib/twin-routes.js`：
 *   host 半的 `lib/twin-routes.js` 需要 `node:fs`（资产路由要读 GLB）。客户端半由
 *   esbuild 打进浏览器 bundle，**一旦 import 到 `node:fs` 就会解析失败或把 Node 内置模块
 *   带进浏览器**。把路径常量抽到这个零依赖文件后：
 *     - host：`lib/twin-routes.js` 从本文件 import / re-export；
 *     - client：`src/client/state.js` 构建期 `import` 本文件，esbuild 直接内联两个字符串。
 *   ⇒ 两边共用**同一份真源**，不可能漂移，也不需要额外的"漂移守卫"测试。
 *
 * 本文件必须永远保持零 import。
 */

/** 只读状态轮询路由（host 注册，client 轮询）。 */
export const TWIN_STATE_PATH = '/dsh-nonead-ur/twin/state';

/** 模型资产路由（host 注册，client 取 GLB）。 */
export const TWIN_ASSET_PATH = '/dsh-nonead-ur/twin/asset';

/** 可用模型清单路由（host 注册，client 用于模型切换/离线预览）。 */
export const TWIN_MODELS_PATH = '/dsh-nonead-ur/twin/models';

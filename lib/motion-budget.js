/**
 * lib/motion-budget.js — 运动指令的**单次调用预算**（毫秒）。
 *
 * ## 为什么需要它（真机现象）
 * `UrWorker.call()` 的默认策略是**超时即 kill 掉 Python 子进程**：单线程 worker 一旦卡在库代码里，
 * 后续每个请求都会排在它后面，所以"杀掉、重来"是合理的兜底。但运动指令"跑得久"是**正常**的，
 * 而那个子进程里装着 RTDE 接收线程、Dashboard 连接**以及孪生的遥测推送线程**。
 *
 * 于是有一条很容易踩到的因果链：一次工具调用的预算按默认 **60 秒** 算 → 机器人那条运动正好
 * 要跑 60 秒以上 → 宿主在 60 秒时 kill 子进程 → **机器人还在动，孪生却永久冻结**（推送线程
 * 随子进程一起消失），而且机器人连接也一并丢失。用户看到的就是"跑 60 秒，数字孪生不动了"。
 *
 * ## 两条措施
 * 1. **按参数推算真实需要的时间**：给了 `t=`（秒）就用 `t`；`ur_wait_steady` 用 `timeout_s`；
 *    `move_force` 的时长由控制器按距离/速度决定（参数推不出来）⇒ 给一个宽的兜底。
 * 2. **运动指令一律 `killOnTimeout: false`**（由 `lib/index.js` 的调用点传）：超时只让这一次调用
 *    如实报超时，**绝不破坏机器人会话** —— 这与本插件的诚实性纪律一致："我没在预算内拿到确认"
 *    不等于"把会话毁掉"。
 *
 * 纯函数、零依赖，因此预算策略本身可以被单测钉住（`test/motion-budget.test.mjs`）。
 */

/** 默认兜底：至少 60 秒（与 `commandTimeoutMs` 的默认值一致）。 */
export const MOTION_BUDGET_FLOOR_MS = 60 * 1000;
/** 推算时额外留的余量（网络/规划/减速收尾）。 */
export const MOTION_BUDGET_MARGIN_MS = 15 * 1000;
/** `move_force` 这类"时长由控制器决定"的运动：给 5 分钟兜底。 */
export const MOTION_BUDGET_FORCE_MS = 5 * 60 * 1000;
/** 上限：1 小时（再长就该怀疑是卡住而不是在运动了）。 */
export const MOTION_BUDGET_CAP_MS = 60 * 60 * 1000;

/**
 * 算出一次运动调用的预算。
 *
 * @param {string} op worker op 名
 * @param {object} [args] 工具参数（只看 `t` 与 `timeout_s`）
 * @param {object} [options]
 * @param {number} [options.baseMs] 配置里的 `commandTimeoutMs`（**下限之一**，不会被算小）
 * @param {number} [options.marginMs]
 * @param {number} [options.floorMs]
 * @param {number} [options.capMs]
 * @returns {number} 毫秒
 */
export function motionBudgetMs(op, args, options = {}) {
  const base = pick(options.baseMs, MOTION_BUDGET_FLOOR_MS);
  const margin = pick(options.marginMs, MOTION_BUDGET_MARGIN_MS, 0);
  const floor = pick(options.floorMs, MOTION_BUDGET_FLOOR_MS);
  const cap = pick(options.capMs, MOTION_BUDGET_CAP_MS);

  let needed = 0;
  // `t=` 是"这条运动要花多少秒"的直接声明（手册：给了 t 就忽略 a/v）。
  const seconds = args?.t;
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    needed = Math.max(needed, seconds * 1000 + margin);
  }
  // `ur_wait_steady` 的 `timeout_s` 是"最多等多久"。
  const waitSeconds = args?.timeout_s;
  if (typeof waitSeconds === 'number' && Number.isFinite(waitSeconds) && waitSeconds > 0) {
    needed = Math.max(needed, waitSeconds * 1000 + margin);
  }
  // 力控引导运动：时长取决于"要走多远、被什么挡住"，参数推不出来 ⇒ 宽兜底。
  if (op === 'move_force') needed = Math.max(needed, MOTION_BUDGET_FORCE_MS);

  // `base`（配置值）也是下限：用户把 commandTimeoutMs 调大了就不该被算小。
  return Math.min(cap, Math.max(floor, base, needed));
}

/** 取一个有限正数配置值，否则退回默认值（`min` 用于允许 0）。 */
function pick(value, fallback, min = 1) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= min) return value;
  return fallback;
}

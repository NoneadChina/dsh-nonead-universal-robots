/**
 * 探针（不是测试，但它是**端到端**的那一个）：真机缺陷的完整链路复现/回归。
 *
 * 链路：真实 http 服务 + 宿主真实的 `createTwinStreamHandler`（+ 真实的
 * `createTwinReadWorker` 策略）→ 真实浏览器语义的 `EventSource` → 插件真实的
 * `createTwinState({ stream: true })`。
 *
 * 场景就是用户报的那一个：机器人**开始运动**。Python worker 是单线程 stdin 队列，运动指令
 * 占住它，孪生的读要排队并超时。修前：宿主一个事件都不发（画面冻住），而且孪生读用 60 s
 * 默认预算、超时会**杀掉整条机器人会话**。修后必须满足三条：
 *   ① 读排队期间，客户端**仍然收到事件**（`stale`）；
 *   ② 客户端**保留读数**（connected 不能变成 false —— 那会把 3D 视图整个藏起来）；
 *   ③ 读恢复后立刻跟上新帧。
 *
 * 运行：node scripts/probe-twin-stall-end-to-end.mjs
 */
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { createTwinStreamHandler } from '../lib/twin-routes.js'
import { TWIN_READ_TIMEOUT_MS, createTwinReadWorker } from '../lib/twin-worker.js'
import { createTwinState } from '../src/client/state.js'
import { createTwinStream } from '../src/client/robot/twin-stream.js'

/** 找一个符合规范的 EventSource（同 probe-twin-stream-error-event.mjs 的取舍）。 */
async function resolveEventSource() {
  if (typeof globalThis.EventSource === 'function') return globalThis.EventSource
  const candidates = [
    process.env.DSH_APP_DIR && `${process.env.DSH_APP_DIR}/node_modules/dshmarket/node_modules/undici/index.js`,
    'D:/Software/Nonead DSH Desktop/resources/app/node_modules/dshmarket/node_modules/undici/index.js',
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    try {
      const mod = await import(pathToFileURL(candidate).href)
      if (typeof mod.EventSource === 'function') return mod.EventSource
    } catch { /* 试下一个 */ }
  }
  throw new Error('找不到符合规范的 EventSource：用 `node --experimental-eventsource` 或设 DSH_APP_DIR');
}

const EventSource = await resolveEventSource()

/** 机器人"开始运动"：这个开关一开，读就要排队（真实 worker 的表现）。 */
let moving = false
/** 最后一笔成功读数（等价于 Python 侧真读到的姿态）。 */
let pose = [0, 0, 0, 0, 0, 0]

/**
 * 假 worker：**完整遵守 UrWorker 的调用签名与语义**。
 * - 预算内没答案 ⇒ 用 `WORKER_TIMEOUT` 拒绝（与 lib/worker.js 一致）；
 * - `killOnTimeout:false` ⇒ 只是这一次调用失败，进程/会话留着（真机上的关键区别）。
 */
const inner = {
  killed: 0,
  async call(op, params, timeoutMs, signal, options = {}) {
    if (op === 'get_robot_model') return { message: '', data: { robot_model: 'UR3' } };
    if (moving) {
      // 读排在运动指令后面：等到预算到点，然后如实报超时。
      await new Promise((r) => setTimeout(r, timeoutMs));
      if (options.killOnTimeout !== false) inner.killed += 1;
      const error = new Error(`UR call "${op}" timed out after ${timeoutMs}ms`);
      error.code = 'WORKER_TIMEOUT';
      throw error;
    }
    if (op === 'get_joint_pose') return { message: '', data: { joint_positions: [...pose] } };
    if (op === 'get_tcp_pose') return { message: '', data: { tcp_pose: [0, 0, 0.5, 0, 0, 0] } };
    return { message: '', data: {} };
  },
};

const handler = createTwinStreamHandler({
  // ★ 真机上 lib/index.js 就是这么接的：短预算 + 超时不杀进程。
  worker: createTwinReadWorker(inner),
  connectedIps: () => new Set(['1.2.3.4']),
  intervalMs: 100,
  detailMs: 0,
});

const server = createServer((req, res) => {
  // 客户端拼的是插件自己的路由常量（`/dsh-nonead-ur/twin/stream`）。
  if (req.url.startsWith('/dsh-nonead-ur/twin/stream')) { handler(req, res); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const state = createTwinState({
  stream: true,
  // 客户端拼的是同源相对路径（真浏览器里就是当前页面）；探针把它指到本地探针服务器上。
  streamFactory: ({ url }) => createTwinStream({
    url: `http://127.0.0.1:${port}${url}`,
    EventSourceImpl: EventSource,
  }),
});

const seen = [];
state.subscribe((snap) => seen.push({ connected: snap.connected, stale: snap.feedStale, ts: snap.ts, q: snap.q?.[0] }));

state.start();
await new Promise((r) => setTimeout(r, 700));
const beforeMotion = state.getSnapshot();
console.log(`运动前：connected=${beforeMotion.connected} q0=${beforeMotion.q?.[0]} 帧数=${seen.length}`);
console.log(`  诊断：health=${JSON.stringify(state.getStreamHealth())} code=${beforeMotion.code} error=${beforeMotion.error}`);

// ── 机器人开始运动：worker 被占住 ──────────────────────────────────────────
moving = true;
await new Promise((r) => setTimeout(r, 1200));   // 读已在飞（2.5 s 预算内）
const during = state.getSnapshot();
const staleSeen = seen.filter((s) => s.stale === true).length;
console.log(`运动中：connected=${during.connected} feedStale=${during.feedStale} q0=${during.q?.[0]} 停滞帧=${staleSeen}`);

await new Promise((r) => setTimeout(r, 2600));   // 跨过读的 2.5 s 预算
const afterTimeout = state.getSnapshot();
console.log(`读超时后：connected=${afterTimeout.connected} feedStale=${afterTimeout.feedStale} q0=${afterTimeout.q?.[0]}`);

// ── 运动结束：必须立刻跟上 ────────────────────────────────────────────────
moving = false;
pose = [1.234, 0, 0, 0, 0, 0];
const resumed = await (async () => {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const snap = state.getSnapshot();
    if (snap.connected === true && snap.feedStale !== true && snap.q?.[0] === 1.234) return snap;
    await new Promise((r) => setTimeout(r, 50));
  }
  return state.getSnapshot();
})();
console.log(`运动结束后：connected=${resumed.connected} feedStale=${resumed.feedStale} q0=${resumed.q?.[0]}`);

state.stop();
server.close();

const checks = [
  ['① 读排队期间仍然收到事件（不再静默）', staleSeen > 0],
  ['② 读超时不得把机器人报成未连接（画面/读数保留）', during.connected === true && afterTimeout.connected === true && afterTimeout.q?.[0] === 0],
  ['③ 超时只让这一次读失败：绝不杀进程/会话', inner.killed === 0],
  ['④ 运动结束后立刻跟上新帧', resumed.connected === true && resumed.feedStale !== true && resumed.q?.[0] === 1.234],
];
let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
}
console.log(`孪生读预算：${TWIN_READ_TIMEOUT_MS}ms（真机上由 lib/twin-worker.js 强制）`);
process.exit(failed === 0 ? 0 : 1);

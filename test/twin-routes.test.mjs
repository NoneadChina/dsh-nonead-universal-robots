/**
 * Task 5 — unit tests for the pure twin route handlers (lib/twin-routes.js).
 *
 * Run directly:  node --test test/twin-routes.test.mjs
 * (Do NOT use `npm test` — npm spawns children over piped stdio, which the
 *  current sandbox rejects with `spawn EPERM`.)
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  TWIN_STATE_PATH,
  TWIN_ASSET_PATH,
  TWIN_MODELS_PATH,
  TWIN_CODES,
  TWIN_STREAM_FRAME_ERROR_EVENT,
  TWIN_STREAM_STALE_EVENT,
  createTwinStateHandler,
  createTwinAssetHandler,
  createTwinModelsHandler,
  createTwinStreamHandler,
} from '../lib/twin-routes.js';

// ── fixtures ───────────────────────────────────────────────────────────────

// 真实信封形状：`UrWorker.call()` resolve 的是响应里的 `data`，而每个 op 自身返回
// `{message, data:{…}}`（见 python/ur_worker.py 的 `ok()`：原样返回传入的 dict）。
// **不要**把它"简化"成扁平对象 —— 那正是当初路由读错层级（恒返回空 model/q/tcp、连上机器人
// 也只显示黑屏）却仍然全绿的原因。
const worker = {
  call: async (op, params) => ({
    get_joint_pose: { message: '当前关节姿态', data: { joint_positions: [0, 0, 0, 0, 0, 0], ip: params?.ip } },
    get_tcp_pose: { message: '当前TCP位置', data: { tcp_pose: [0, 0, 0.5, 0, 0, 0], ip: params?.ip } },
    get_robot_model: { message: 'UR3', data: { robot_model: 'UR3', remote_control: false, ip: params?.ip } },
  }[op]),
};

const assetsDir = await mkdtemp(join(tmpdir(), 'ur-twin-assets-'));
await writeFile(join(assetsDir, 'ur3.glb'), Buffer.from([0x67, 0x6c, 0x54, 0x46]));

after(async () => {
  await rm(assetsDir, { recursive: true, force: true });
});

// ── route constants ────────────────────────────────────────────────────────

test('导出固定的宿主路由路径常量', () => {
  assert.equal(TWIN_STATE_PATH, '/dsh-nonead-ur/twin/state');
  assert.equal(TWIN_ASSET_PATH, '/dsh-nonead-ur/twin/asset');
  assert.equal(TWIN_MODELS_PATH, '/dsh-nonead-ur/twin/models');
});

// ── 机器可读的失败原因（0.5.0）─────────────────────────────────────────────
//
// 客户端以前只能拿到一句中文 reason，于是"worker 挂了"、"机器人没连"、"两台机器人有歧义"
// 全都渲染成同一行「未连接机器人」——没有地址、没有原因，而且歧义那种情况还会永远每隔
// ≤2 s 白轮询下去。现在每种失败都带一个稳定的 `code`。

test('失败必须带机器可读的 code（客户端据此给出不同提示）', async () => {
  assert.deepEqual(TWIN_CODES, {
    NO_ROBOT: 'no_robot',
    NOT_CONNECTED: 'robot_not_connected',
    AMBIGUOUS: 'ambiguous_robot',
    WORKER_UNAVAILABLE: 'worker_unavailable',
    ROBOT_ERROR: 'robot_error',
    BAD_REQUEST: 'bad_request',
  });

  const none = await createTwinStateHandler({ worker, connectedIps: () => new Set() })({});
  assert.equal(none.body.connected, false);
  assert.equal(none.body.code, 'no_robot');

  const notConnected = await createTwinStateHandler({ worker, connectedIps: () => new Set(['9.9.9.9']) })({ ip: '1.2.3.4' });
  assert.equal(notConnected.body.code, 'robot_not_connected');
  assert.equal(notConnected.body.ip, '1.2.3.4', '必须回显是哪台机器人');

  const noWorker = await createTwinStateHandler({ worker: null, connectedIps: () => new Set(['1.2.3.4']) })({ ip: '1.2.3.4' });
  assert.equal(noWorker.body.code, 'worker_unavailable');

  const boom = await createTwinStateHandler({
    worker: { call: async () => { throw new Error('机器人掉线了'); } },
    connectedIps: () => new Set(['1.2.3.4']),
  })({ ip: '1.2.3.4' });
  assert.equal(boom.body.code, 'robot_error');
  assert.equal(boom.status, 200, '机器人错误不得变成 5xx');

  const ambiguous = await createTwinStateHandler({
    worker,
    connectedIps: () => new Set(['1.1.1.1', '2.2.2.2']),
  })({});
  assert.equal(ambiguous.status, 400);
  assert.equal(ambiguous.body.code, 'ambiguous_robot');
  assert.deepEqual(ambiguous.body.ips, ['1.1.1.1', '2.2.2.2'], '必须列出候选，客户端才能提示选哪台');
});

test('状态响应必须禁止缓存（缓存的位姿比没有位姿更糟）', async () => {
  const h = createTwinStateHandler({ worker, connectedIps: () => new Set(['1.2.3.4']) });
  const r = await h({ ip: '1.2.3.4' });
  assert.match(r.headers['cache-control'], /no-store/);
  const miss = await createTwinStateHandler({ worker, connectedIps: () => new Set() })({});
  assert.match(miss.headers['cache-control'], /no-store/, '失败响应同样不得被缓存');
});

test('模型名按 IP 记忆：常数不能每次轮询都去问一遍 Dashboard', async () => {
  let asked = 0;
  const counting = {
    call: async (op, params) => {
      if (op === 'get_robot_model') asked += 1;
      return worker.call(op, params);
    },
  };
  const cache = new Map([['1.2.3.4', 'UR5e']]);
  const h = createTwinStateHandler({
    worker: counting,
    connectedIps: () => new Set(['1.2.3.4']),
    modelFor: (ip) => cache.get(ip) ?? null,
  });
  const r = await h({ ip: '1.2.3.4' });
  assert.equal(r.body.model, 'UR5e');
  assert.equal(asked, 0, '记忆命中时不得再去问 dashboard');

  // 没有记忆时仍要读一次并回填
  const cold = await createTwinStateHandler({ worker: counting, connectedIps: () => new Set(['1.2.3.4']) })({ ip: '1.2.3.4' });
  assert.equal(cold.body.model, 'UR3');
  assert.equal(asked, 1);
});

test('detail=1 附带 dashboard 状态；detail 查询失败不影响位姿通道', async () => {
  const withDetail = {
    call: async (op, params) => {
      if (op === 'status') {
        return { message: 'ok', data: { safety_mode: 'NORMAL', robot_mode: 'RUNNING', running: true, joint_temperatures: [30, 31, 32, 33, 34, 35] } };
      }
      return worker.call(op, params);
    },
  };
  const h = createTwinStateHandler({ worker: withDetail, connectedIps: () => new Set(['1.2.3.4']) });
  const r = await h({ ip: '1.2.3.4', detail: '1' });
  assert.equal(r.body.connected, true);
  assert.equal(r.body.detail.safety_mode, 'NORMAL');
  assert.equal(r.body.detail.running, true);
  assert.equal(r.body.detail.joint_temperatures.length, 6);

  // 不带 detail 时不得付出 dashboard 往返的代价
  const lean = await h({ ip: '1.2.3.4' });
  assert.equal(lean.body.detail, undefined);

  // detail 通道出错：位姿必须照常返回
  const brokenDetail = {
    call: async (op, params) => {
      if (op === 'status') throw new Error('dashboard 挂了');
      return worker.call(op, params);
    },
  };
  const r2 = await createTwinStateHandler({ worker: brokenDetail, connectedIps: () => new Set(['1.2.3.4'])})({ ip: '1.2.3.4', detail: '1' });
  assert.equal(r2.body.connected, true, 'detail 失败不得让位姿通道一起失败');
  assert.equal(r2.body.q.length, 6);
  assert.match(r2.body.detail.error, /dashboard/);
});

test('关节角不完整时给出 degraded 标记，而不是静默冻结画面', async () => {
  const shortQ = {
    call: async (op, params) => ({
      get_joint_pose: { message: '', data: { joint_positions: [] } },
      get_tcp_pose: { message: '', data: { tcp_pose: [] } },
      get_robot_model: { message: '', data: { robot_model: 'UR3' } },
    }[op]),
  };
  const r = await createTwinStateHandler({ worker: shortQ, connectedIps: () => new Set(['1.2.3.4'])})({ ip: '1.2.3.4' });
  assert.equal(r.body.connected, true);
  assert.equal(r.body.degraded, true, '必须显式标记 q 不完整');
  assert.equal(r.body.code, 'incomplete_pose');
});

// ── /twin/state ────────────────────────────────────────────────────────────

test('已连接时返回 connected + model + q + tcp + ts', async () => {
  const h = createTwinStateHandler({ worker, connectedIps: () => new Set(['1.2.3.4']) });
  const r = await h({ ip: '1.2.3.4' });
  assert.equal(r.status, 200);
  assert.equal(r.body.connected, true);
  assert.equal(r.body.model, 'UR3');
  assert.equal(r.body.q.length, 6);
  assert.equal(r.body.tcp.length, 6);
  assert.equal(typeof r.body.ts, 'number');
});

test('契约：路由读的是 op 信封的 .data —— 扁平返回值不得被当成数据', async () => {
  // 反向守卫：真实的 Python 侧就是信封形状（`{message, data}`）。若有人把返回「简化」成扁平
  // 对象却没同步路由，这条会红；反之若有人把路由改回按扁平字段读，上一条用例会红。
  const flat = {
    call: async (op) => ({
      get_joint_pose: { joint_positions: [0, 0, 0, 0, 0, 0] },
      get_tcp_pose: { tcp_pose: [0, 0, 0.5, 0, 0, 0] },
      get_robot_model: { robot_model: 'UR3' },
    }[op]),
  };
  const h = createTwinStateHandler({ worker: flat, connectedIps: () => new Set(['1.2.3.4']) });
  const r = await h({ ip: '1.2.3.4' });
  assert.equal(r.body.connected, true, 'op 成功就是 connected（载荷为空是另一回事）');
  assert.equal(r.body.model, '', '扁平形状不得被当作数据');
  assert.deepEqual(r.body.q, []);
  assert.deepEqual(r.body.tcp, []);
});

test('未连接时返回 connected:false 与原因', async () => {
  const h = createTwinStateHandler({ worker, connectedIps: () => new Set() });
  const r = await h({ ip: '1.2.3.4' });
  assert.equal(r.status, 200);
  assert.equal(r.body.connected, false);
  assert.equal(typeof r.body.reason, 'string');
});

// ── Ruling 35：`ip` 可省略，由 host 依据连接注册表解析 ──────────────────────
// 动机：浏览器半**不知道也不该猜**机器人 IP（计划原稿没定义来源，实现者只能退到默认值
// `192.168.1.199`，而真实机器人是 `192.168.2.201` ⇒ 会永远显示"未连接"）。
// host 本来就持有 connectedIps，故把解析放到 host。

test('省略 ip 且无任何机器人连接时返回 200 + connected:false（不是 400/500）', async () => {
  const h = createTwinStateHandler({ worker, connectedIps: () => new Set() });
  const r = await h({});
  assert.equal(r.status, 200);
  assert.equal(r.body.connected, false);
  assert.match(r.body.reason, /no robot connected/i);
});

test('省略 ip 且恰好一个机器人连接时自动解析到它，并回填 body.ip', async () => {
  const seen = [];
  const spy = { call: async (op, params) => { seen.push(params.ip); return worker.call(op, params); } };
  const h = createTwinStateHandler({ worker: spy, connectedIps: () => new Set(['192.168.2.201']) });
  const r = await h({});
  assert.equal(r.status, 200);
  assert.equal(r.body.connected, true);
  assert.equal(r.body.ip, '192.168.2.201');
  assert.ok(seen.length > 0, 'worker 应被调用');
  assert.deepEqual([...new Set(seen)], ['192.168.2.201'], '所有 worker 调用都必须用解析出的 IP');
});

test('省略 ip 但连接了多个机器人时返回 400（有歧义，必须显式指定）', async () => {
  const h = createTwinStateHandler({
    worker,
    connectedIps: () => new Set(['192.168.2.201', '10.0.0.7']),
  });
  const r = await h({});
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.ips, ['10.0.0.7', '192.168.2.201']);
});

test('ip 为空白字符串时按"省略"处理（走注册表解析），不再直接 400', async () => {
  const h = createTwinStateHandler({ worker, connectedIps: () => new Set(['1.2.3.4']) });
  const r = await h({ ip: '   ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.connected, true);
  assert.equal(r.body.ip, '1.2.3.4');
});

test('显式传入一个未连接的 ip 仍返回 connected:false（原行为不变）', async () => {
  const h = createTwinStateHandler({ worker, connectedIps: () => new Set(['1.2.3.4']) });
  const r = await h({ ip: '9.9.9.9' });
  assert.equal(r.status, 200);
  assert.equal(r.body.connected, false);
  assert.match(r.body.reason, /9\.9\.9\.9/);
});

test('worker 抛错时返回 connected:false 而非 500', async () => {
  const bad = { call: async () => { throw new Error('worker down'); } };
  const h = createTwinStateHandler({ worker: bad, connectedIps: () => new Set(['1.2.3.4']) });
  const r = await h({ ip: '1.2.3.4' });
  assert.equal(r.status, 200);
  assert.equal(r.body.connected, false);
  assert.match(r.body.reason, /worker down/);
});

// ── 0.6.6：读"暂时拿不到"必须降级，不能把机器人报成未连接 ────────────────────
//
// `UrWorker` 是单线程 stdin 队列：机器人执行运动指令期间孪生的读会排队并超时（常态）。
// 以前这被映射成 connected:false ⇒ 客户端藏掉整个 3D 视图与 HUD、写上「未连接机器人」，
// 用户看到的就是"孪生同步两个动作后就不动了"。

/** 造一个"读暂时失败"的 worker（错误码可控）。 */
function flakyWorker(codeRef) {
  return {
    call: async (op, params) => {
      if (codeRef.code !== null) {
        const error = new Error(codeRef.message ?? '暂时拿不到答案');
        error.code = codeRef.code;
        throw error;
      }
      return worker.call(op, params);
    },
  };
}

test('★ 读暂时失败 ⇒ 回放最后一笔已知读数并标 stale（connected 必须保持 true）', async () => {
  const codeRef = { code: null };
  const clock = { t: 1000 };
  const h = createTwinStateHandler({
    worker: flakyWorker(codeRef),
    connectedIps: () => new Set(['1.2.3.4']),
    now: () => clock.t,
  });

  const ok = await h({ ip: '1.2.3.4' });
  assert.equal(ok.body.connected, true);
  assert.equal(ok.body.ts, 1000, 'ts 用注入的时钟');
  assert.equal(ok.body.stale, undefined);

  codeRef.code = 'WORKER_TIMEOUT';
  clock.t = 4000;
  const stale = await h({ ip: '1.2.3.4' });
  assert.equal(stale.status, 200, '绝不变 5xx');
  assert.equal(stale.body.connected, true, '★ 不得报成未连接（否则客户端会藏掉 3D）');
  assert.equal(stale.body.stale, true);
  assert.equal(stale.body.stale_reason, 'WORKER_TIMEOUT');
  assert.equal(stale.body.stale_ms, 3000, '必须给出这帧有多旧');
  assert.deepEqual(stale.body.q, ok.body.q, '必须回放最后一笔已知关节角');
  assert.equal(stale.body.ts, 1000, '★ ts 不得回填 —— 客户端靠它算龄期');
});

test('★ 只有"暂时拿不到"才降级：真正的连接错误仍然必须是 connected:false', async () => {
  const codeRef = { code: null };
  const h = createTwinStateHandler({
    worker: flakyWorker(codeRef),
    connectedIps: () => new Set(['1.2.3.4']),
  });
  await h({ ip: '1.2.3.4' });

  // Python 侧的结构化错误（机器人真的连不上）不是"暂时"类：不许假装还连着。
  codeRef.code = 'TIMEOUT';
  codeRef.message = 'RTDE did not start after connecting to 1.2.3.4';
  const hard = await h({ ip: '1.2.3.4' });
  assert.equal(hard.body.connected, false, '★ 真连接错误不得被降级伪装成陈旧帧');
  assert.equal(hard.body.code, 'robot_error');
  assert.equal(hard.body.stale, undefined);
});

test('★ 陈旧帧回放有窗口：超过 staleMaxMs 之后不再假装知道机器人现在在哪', async () => {
  const codeRef = { code: null };
  const clock = { t: 1000 };
  const h = createTwinStateHandler({
    worker: flakyWorker(codeRef),
    connectedIps: () => new Set(['1.2.3.4']),
    now: () => clock.t,
    staleMaxMs: 5000,
  });
  await h({ ip: '1.2.3.4' });

  codeRef.code = 'WORKER_BUSY';
  clock.t = 5000;                                        // 恰好还在窗口内
  assert.equal((await h({ ip: '1.2.3.4' })).body.stale, true);

  clock.t = 20000;                                       // 远超窗口
  const expired = await h({ ip: '1.2.3.4' });
  assert.equal(expired.body.connected, false, '★ 十分钟前的姿态比"不知道"更危险');
  assert.equal(expired.body.code, 'robot_error');
});

test('worker 为 null（Python 半初始化失败）时返回 200 + connected:false', async () => {
  const h = createTwinStateHandler({ worker: null, connectedIps: () => new Set(['1.2.3.4']) });
  const r = await h({ ip: '1.2.3.4' });
  assert.equal(r.status, 200);
  assert.equal(r.body.connected, false);
  assert.equal(typeof r.body.reason, 'string');
});

test('connectedIps 注册表抛错时降级为未连接而非崩溃', async () => {
  const h = createTwinStateHandler({
    worker,
    connectedIps: () => { throw new Error('registry boom'); },
  });
  const r = await h({ ip: '1.2.3.4' });
  assert.equal(r.status, 200);
  assert.equal(r.body.connected, false);
});

// ── /twin/asset ────────────────────────────────────────────────────────────

test('合法型号命中时返回 200 + model/gltf-binary + Buffer', async () => {
  const h = createTwinAssetHandler({ assetsDir });
  const r = await h({ model: 'ur3' });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'model/gltf-binary');
  assert.ok(Buffer.isBuffer(r.body), 'body 必须是 Buffer');
  assert.equal(r.body.length, 4);
  assert.equal(r.headers['content-length'], '4');
});

test('未知型号（白名单合法但无文件）返回 404', async () => {
  const h = createTwinAssetHandler({ assetsDir });
  const r = await h({ model: 'ur9999' });
  assert.equal(r.status, 404);
  assert.ok(!Buffer.isBuffer(r.body));
});

test('assets/models 目录尚不存在时优雅返回 404（不抛错）', async () => {
  const h = createTwinAssetHandler({ assetsDir: join(assetsDir, 'does-not-exist-yet', 'models') });
  const r = await h({ model: 'ur3' });
  assert.equal(r.status, 404);
});

test('未提供 assetsDir 时返回 404（不抛错）', async () => {
  const h = createTwinAssetHandler({});
  const r = await h({ model: 'ur3' });
  assert.equal(r.status, 404);
});

test('缺少 model 参数时返回 400', async () => {
  const h = createTwinAssetHandler({ assetsDir });
  const r = await h({});
  assert.equal(r.status, 400);
});

test('路径穿越取值一律被拒且不泄露文件内容', async () => {
  const h = createTwinAssetHandler({ assetsDir });
  const attacks = [
    '../../package.json',
    '..\\..\\package.json',
    'ur3/../../package.json',
    '../ur3',
    'ur3.glb',
    '/etc/passwd',
    '....//....//package.json',
    'UR3',
    'ur 3',
    'ur3\u0000',
  ];
  for (const model of attacks) {
    const r = await h({ model });
    assert.equal(r.status, 400, `「${model}」必须被拒（实际 ${r.status}）`);
    assert.ok(!Buffer.isBuffer(r.body), `「${model}」不得返回文件内容`);
    assert.doesNotMatch(JSON.stringify(r.body), /nonead-universal-robots/);
  }
});

// ── 资产缓存（0.5.0）───────────────────────────────────────────────────────
//
// 关掉面板会释放模型句柄（loader 的引用计数到 0），而资产路由以前没有任何校验器 ——
// 于是每次展开面板都要重新下载并解析 1.5–3.5 MB 的 GLB。

test('资产响应带强 ETag 与不可变缓存指令', async () => {
  const h = createTwinAssetHandler({ assetsDir });
  const r = await h({ model: 'ur3' });
  assert.match(r.headers.etag ?? '', /^"[0-9a-f]{40}"$/, '必须是内容哈希形式的强校验器');
  assert.match(r.headers['cache-control'] ?? '', /immutable/);
  assert.match(r.headers['cache-control'] ?? '', /max-age=\d{6,}/);
});

test('If-None-Match 命中时返回 304 且不带正文', async () => {
  const h = createTwinAssetHandler({ assetsDir });
  const first = await h({ model: 'ur3' });
  const again = await h({ model: 'ur3' }, { 'if-none-match': first.headers.etag });
  assert.equal(again.status, 304);
  assert.equal(again.body, '', '304 不得带正文');
  assert.equal(again.headers.etag, first.headers.etag, '304 仍应回带 ETag');

  // 多值 If-None-Match（浏览器/代理会拼起来）也要能命中
  const multi = await h({ model: 'ur3' }, { 'if-none-match': `"deadbeef", ${first.headers.etag}` });
  assert.equal(multi.status, 304);

  // 不匹配时必须照常返回正文
  const changed = await h({ model: 'ur3' }, { 'if-none-match': '"deadbeef"' });
  assert.equal(changed.status, 200);
  assert.ok(Buffer.isBuffer(changed.body));
});

// ── /twin/models ───────────────────────────────────────────────────────────

test('模型清单只列出目录里真实存在的 .glb', async () => {
  const h = createTwinModelsHandler({ assetsDir });
  const r = await h();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.models, ['ur3']);
});

test('模型清单在目录缺失/未配置时返回空列表而不是报错', async () => {
  const missing = await createTwinModelsHandler({ assetsDir: join(assetsDir, 'nope') })();
  assert.deepEqual(missing.body.models, []);
  const unset = await createTwinModelsHandler({})();
  assert.deepEqual(unset.body.models, []);
});

// ── /twin/stream（0.6.3 起是 SSE）───────────────────────────────────────────
//
// 这一段是 0.6.6 补的：此前**这条路由一条测试都没有**，于是两个真机缺陷长期全绿：
//   ① `pumping` 背压 + 读卡住 ⇒ **一个事件都不发**（客户端只能看到"开着的、安静的流"，
//      画面停在最后一帧且没有提示）—— 机器人运动时 worker 被占住是常态；
//   ② 事件名叫 `error` ⇒ 被浏览器的 `EventSource.onerror` 接走 ⇒ 一次单帧失败就拆流，
//      连来 8 次就进入终态 gaveup，孪生永久冻结。

/** 捕获 SSE 写入的假响应（按 `\n\n` 切事件，解析 `event:` / `data:`）。 */
function makeSseCapture() {
  const events = [];
  let buffer = '';
  const handlers = new Map();
  const res = {
    statusCode: 0,
    headers: {},
    ended: false,
    writeHead(status, headers) { res.statusCode = status; Object.assign(res.headers, headers ?? {}); },
    setHeader(name, value) { res.headers[name] = value; },
    write(chunk) {
      buffer += String(chunk);
      let at;
      while ((at = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const type = /^event: (.*)$/mu.exec(raw)?.[1] ?? 'message';
        const dataLine = /^data: (.*)$/mu.exec(raw)?.[1];
        events.push({ type, data: dataLine === undefined ? undefined : JSON.parse(dataLine) });
      }
      return true;
    },
    end() { res.ended = true; },
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
    },
    /**
     * 测试收尾：触发 `close`，让 handler 清掉自己的 interval。
     *
     * ⚠️ **每个用例末尾都必须调用**，否则那条 SSE 的 `setInterval` 会一直挂着，
     * `node test/x.test.mjs` 跑完之后进程不退出（表现成"测试卡住"）。
     */
    close() { for (const fn of handlers.get('close') ?? []) fn(); },
  };
  return { res, events };
}

/** 假请求（handler 只读 method/url 与 close/error 事件）。 */
function requestOf(url = '/twin/stream?ip=1.2.3.4') {
  const handlers = new Map();
  return {
    method: 'GET',
    url,
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
    },
    close() { for (const fn of handlers.get('close') ?? []) fn(); },
  };
}

/** 轮询等待条件成立（比固定 sleep 稳，不受 CI 抖动影响）。 */
async function waitFor(condition, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return condition();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('事件名常量：单帧失败**绝不能**叫 error（否则会被 EventSource.onerror 接走）', () => {
  assert.equal(TWIN_STREAM_FRAME_ERROR_EVENT, 'frame-error');
  assert.notEqual(TWIN_STREAM_FRAME_ERROR_EVENT, 'error');
  assert.notEqual(TWIN_STREAM_STALE_EVENT, 'error');
  assert.equal(TWIN_STREAM_STALE_EVENT, 'stale');
});

test('SSE 响应头与首帧：立刻推一帧 state（订阅者不该先干等一个 interval）', async () => {
  const { res, events } = makeSseCapture();
  const req = requestOf();
  const handler = createTwinStreamHandler({
    worker,
    connectedIps: () => new Set(['1.2.3.4']),
    intervalMs: 1000,
    detailMs: 0,
  });
  handler(req, res);

  assert.match(res.headers['content-type'], /text\/event-stream/);
  assert.match(res.headers['cache-control'], /no-store/);
  assert.equal(res.headers['x-accel-buffering'], 'no');
  assert.equal(res.statusCode, 200);
  await waitFor(() => events.length >= 1);
  assert.equal(events[0].type, 'state', '首个事件必须是 state');
  assert.equal(events[0].data.connected, true);
  assert.equal(events[0].data.q.length, 6);
  req.close();
  assert.equal(res.ended, true, '客户端断开后必须收尾（不留 interval）');
});

test('非 GET 一律 405', () => {
  const { res } = makeSseCapture();
  createTwinStreamHandler({ worker, connectedIps: () => new Set() })(
    { method: 'POST', url: '/twin/stream', on() {} },
    res,
  );
  assert.equal(res.statusCode, 405);
});

test('★ worker 被占住（机器人运动中）时**绝不静默**：改发 stale 事件', async () => {
  let blocked = true;
  const slowWorker = {
    call: async (op, params) => {
      if (blocked) await sleep(300);
      return worker.call(op, params);
    },
  };
  const { res, events } = makeSseCapture();
  const handler = createTwinStreamHandler({
    worker: slowWorker,
    connectedIps: () => new Set(['1.2.3.4']),
    intervalMs: 10,
    staleNotifyMs: 20,
    frameTimeoutMs: 5000,
    detailMs: 0,
  });
  const req = requestOf();
  handler(req, res);

  assert.ok(
    await waitFor(() => events.some((e) => e.type === 'stale')),
    1000,
  );
  const stale = events.find((e) => e.type === 'stale');
  assert.ok(Number.isFinite(stale.data.pendingMs), 'stale 必须带上"这一帧已经等了多久"');
  assert.equal(events.filter((e) => e.type === 'state').length, 0, '读还没回来，不该有 state');
  assert.ok(events.every((e) => e.type !== 'error'), '★ 服务端事件里绝不出现名叫 error 的事件');

  // 放开 worker：必须立刻恢复推 state（这就是"机器人运动完孪生自动跟上"）
  blocked = false;
  assert.ok(await waitFor(() => events.some((e) => e.type === 'state')), 2000);
  req.close();
});

test('★ 单帧读抛错（暂时拿不到）⇒ 回放陈旧帧，而不是把机器人报成未连接', async () => {
  let broken = false; // 先成功一帧，攒下"最后一笔已知读数"
  const flaky = {
    call: async (op, params) => {
      if (broken) {
        const error = new Error('UR call "get_joint_pose" timed out after 2500ms');
        error.code = 'WORKER_TIMEOUT';
        throw error;
      }
      return worker.call(op, params);
    },
  };
  const { res, events } = makeSseCapture();
  const handler = createTwinStreamHandler({
    worker: flaky,
    connectedIps: () => new Set(['1.2.3.4']),
    intervalMs: 10,
    detailMs: 0,
  });
  const req = requestOf();
  handler(req, res);

  assert.ok(await waitFor(() => events.some((e) => e.type === 'state')), 2000);
  const first = events.find((e) => e.type === 'state');
  assert.equal(first.data.stale, undefined, '第一帧是好帧，不该被标成陈旧');

  broken = true;
  assert.ok(
    await waitFor(() => events.some((e) => e.type === 'state' && e.data.stale === true)),
    2000,
    '★ 读暂时失败必须降级成陈旧帧（客户端据此保留 3D 与读数）',
  );
  const stale = events.filter((e) => e.type === 'state' && e.data.stale === true).at(-1);
  assert.equal(stale.data.connected, true, '★ 绝不能变成"未连接"（那会把 3D 视图整个藏起来）');
  assert.deepEqual(stale.data.q, first.data.q, '必须回放最后一笔已知关节角');
  assert.equal(stale.data.ts, first.data.ts, '★ ts 必须保持不变 —— 龄期要靠它自然增长');
  assert.equal(stale.data.stale_reason, 'WORKER_TIMEOUT');
  assert.ok(Number.isFinite(stale.data.stale_ms));
  assert.ok(events.every((e) => e.type !== 'error'), '★ 绝不发名为 error 的事件');

  broken = false;
  assert.ok(
    await waitFor(() => events.some((e) => e.type === 'state' && e.data.stale === undefined)),
    2000,
    '恢复后必须重新推新鲜帧',
  );
  req.close();
});

test('★ 读永不 settle 时有安全网：放弃该帧、发 frame-error、随后恢复', async () => {
  let hang = true;
  const hanging = {
    call: async (op, params) => {
      if (hang) return new Promise(() => {});
      return worker.call(op, params);
    },
  };
  const { res, events } = makeSseCapture();
  const handler = createTwinStreamHandler({
    worker: hanging,
    connectedIps: () => new Set(['1.2.3.4']),
    intervalMs: 10,
    staleNotifyMs: 10,
    frameTimeoutMs: 60,
    detailMs: 0,
  });
  const req = requestOf();
  handler(req, res);

  assert.ok(
    await waitFor(() => events.some((e) => e.type === TWIN_STREAM_FRAME_ERROR_EVENT && e.data.reason === 'read_timeout')),
    2000,
    '超时没回来必须被放弃并如实上报',
  );
  assert.equal(res.ended, false, '安全网不得拆流');

  hang = false;
  assert.ok(await waitFor(() => events.some((e) => e.type === 'state')), 2000, '放弃该帧后必须能重新读数');
  req.close();
});

test('★ 背压：同一时刻只有一帧读在飞（绝不向单线程 worker 叠加请求）', async () => {
  let concurrent = 0;
  let peak = 0;
  const slowish = {
    call: async (op, params) => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await sleep(40);
      concurrent -= 1;
      return worker.call(op, params);
    },
  };
  const { res, events } = makeSseCapture();
  const handler = createTwinStreamHandler({
    worker: slowish,
    connectedIps: () => new Set(['1.2.3.4']),
    intervalMs: 5,
    staleNotifyMs: 10,
    detailMs: 0,
  });
  const req = requestOf();
  handler(req, res);
  await waitFor(() => events.some((e) => e.type === 'state'), 2000);
  await sleep(120);
  // 一帧的读 = get_joint_pose + get_tcp_pose（外加可能的 detail），但帧与帧之间必须串行：
  // 若叠帧，40ms 的读 + 5ms 的节拍会轻易把这个峰值推到 6 以上。
  assert.ok(peak <= 3, `并发 worker 调用峰值 ${peak} 过高 —— 帧之间没有串行（会堆满 maxInFlight=8）`);
  req.close();
});


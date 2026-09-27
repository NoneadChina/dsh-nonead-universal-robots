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
  createTwinStateHandler,
  createTwinAssetHandler,
  createTwinModelsHandler,
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

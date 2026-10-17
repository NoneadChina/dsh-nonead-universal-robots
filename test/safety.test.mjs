/**
 * 预飞安全闸（`lib/safety-gate.js`）与动作审计账本（`lib/audit-log.js`）的单元测试。
 *
 * 两个模块都被刻意写成**纯逻辑 + 注入依赖**，所以这里不需要机器人、不需要宿主，也不需要
 * Python —— 它们是"本该拦住却放过"这类缺陷成本最低的守门人：一条断言就能钉住一条物理上限。
 *
 * 运行：node --test test/safety.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_LIMITS, checkMotionSafety, parseWorkspace } from '../lib/safety-gate.js';
import { createAuditLog, summarizeArgs } from '../lib/audit-log.js';

const POSE = [0.3, -0.2, 0.4, 0, 3.14, 0];
const Q = [0, -1.57, 0, -1.57, 0, 0];

// ── parseWorkspace ─────────────────────────────────────────────────────────

test('parseWorkspace：空串 = 不检查工作空间（合法配置，不是错误）', () => {
  assert.deepEqual(parseWorkspace(''), { ok: true, workspace: null });
  assert.deepEqual(parseWorkspace('   '), { ok: true, workspace: null });
  assert.deepEqual(parseWorkspace(undefined), { ok: true, workspace: null });
});

test('parseWorkspace：正常三轴、任意顺序、空格或分号都认', () => {
  const a = parseWorkspace('x:-1,1 y:-1,1 z:0,1.2');
  assert.equal(a.ok, true);
  assert.deepEqual(a.workspace, { x: [-1, 1], y: [-1, 1], z: [0, 1.2] });
  const b = parseWorkspace('z:0,2;x:-0.5,0.5;y:-0.5,0.5');
  assert.equal(b.ok, true);
  assert.deepEqual(b.workspace.z, [0, 2]);
});

test('parseWorkspace：所有畸形输入都必须 ok:false（因为调用方要 fail closed）', () => {
  for (const bad of [
    'x:1,-1',            // low > high
    'x:0,0',             // low == high
    'x:1',               // 只有一半
    'x:0,1 x:2,3',       // 重复轴
    'q:0,1',             // 未知轴
    'x:a,b',             // 不是数
    'x:0,1,2 y:0,1',     // 多了一个值 → 正则失配
    'nonsense',          // 完全不像配置
  ]) {
    const out = parseWorkspace(bad);
    assert.equal(out.ok, false, `“${bad}” 必须被判为无法解析`);
    assert.ok(typeof out.reason === 'string' && out.reason.length > 0, '必须给出原因');
  }
});

// ── checkMotionSafety：幅值 ────────────────────────────────────────────────

test('★ 轴位移按幅值拦：-0.02 m 放行，-10（把毫米当米）拒绝', () => {
  assert.equal(checkMotionSafety('move_z', { distance: -0.02 }), null);
  const bad = checkMotionSafety('move_z', { distance: -10 });
  assert.equal(bad?.code, 'SAFETY_STEP');
  assert.match(bad.message, /超过上限/);
});

test('轴位移：缺 distance、非数、NaN 一律拒（不能让 undefined 一路下发）', () => {
  assert.equal(checkMotionSafety('move_x', {})?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('move_x', { distance: '0.1' })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('move_tool_y', { distance: Number.NaN })?.code, 'SAFETY_ARGS');
});

test('轴位移：上限可配置，且 0.5 m 边界是闭区间', () => {
  assert.equal(checkMotionSafety('move_x', { distance: 0.5 }), null);
  assert.equal(checkMotionSafety('move_x', { distance: 0.51 })?.code, 'SAFETY_STEP');
  assert.equal(checkMotionSafety('move_x', { distance: 2 }, { ...DEFAULT_LIMITS, maxStepM: 3 }), null);
});

test('movel/movep：v 超过线速度上限要拒，缺 v 不拦（缺省是手册值）', () => {
  assert.equal(checkMotionSafety('movel', { pose: POSE, v: 0.25 }), null);
  assert.equal(checkMotionSafety('movel', { pose: POSE, v: 1 })?.code, 'SAFETY_SPEED');
  assert.equal(checkMotionSafety('movel', { pose: POSE }), null);
  assert.equal(checkMotionSafety('movel', { pose: [1, 2] })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('movep', { pose: POSE, v: 0.25 }), null);
});

test('movej/servoj：q 必须是 6 个有限数；movej 的 v 有关节速度上限', () => {
  assert.equal(checkMotionSafety('movej', { q: Q }), null);
  assert.equal(checkMotionSafety('servoj', { q: Q }), null);
  assert.equal(checkMotionSafety('movej', { q: Q, v: 2 })?.code, 'SAFETY_SPEED');
  assert.equal(checkMotionSafety('movej', { q: [0, 1] })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('servoj', { q: [...Q.slice(0, 5), null] })?.code, 'SAFETY_ARGS');
});

test('movec：via 与 to 都要检，且 v 有线速度上限', () => {
  const args = { pose_via: [0.2, 0, 0.4, 0, 3.14, 0], pose_to: POSE, v: 0.25 };
  assert.equal(checkMotionSafety('movec', args), null);
  assert.equal(checkMotionSafety('movec', { ...args, v: 1.2 })?.code, 'SAFETY_SPEED');
  assert.equal(checkMotionSafety('movec', { ...args, pose_via: 'x' })?.code, 'SAFETY_ARGS');
});

test('速度指令：speedj 按关节角速度、speedl 分线速度与角速度两段判', () => {
  assert.equal(checkMotionSafety('speedj', { qd: [1, 0, 0, 0, 0, 0] }), null);
  assert.equal(checkMotionSafety('speedj', { qd: [0, 1.5, 0, 0, 0, 0] })?.code, 'SAFETY_SPEED');
  assert.equal(checkMotionSafety('speedl', { xd: [0.4, 0, 0, 0, 0, 0] }), null);
  assert.equal(checkMotionSafety('speedl', { xd: [1, 0, 0, 0, 0, 0] })?.code, 'SAFETY_SPEED');
  assert.equal(checkMotionSafety('speedl', { xd: [0, 0, 0, 0, 0, 2] })?.code, 'SAFETY_SPEED');
});

test('★ 力控：力与力矩各有一条上限（力控是"持续压向环境"，幅值写错最危险）', () => {
  assert.equal(checkMotionSafety('force_mode', { wrench: [30, 0, 10, 0, 0, 0] }), null);
  assert.equal(checkMotionSafety('force_mode', { wrench: [100, 0, 0, 0, 0, 0] })?.code, 'SAFETY_FORCE');
  assert.equal(checkMotionSafety('force_mode', { wrench: [0, 0, 0, 50, 0, 0] })?.code, 'SAFETY_FORCE');
  // 符号不敏感：反向 100 N 一样越界。
  assert.equal(checkMotionSafety('force_mode', { wrench: [-100, 0, 0, 0, 0, 0] })?.code, 'SAFETY_FORCE');
});

test('时长 t 有上限（防止一条指令把 worker 占住几分钟）', () => {
  assert.equal(checkMotionSafety('movej', { q: Q, t: 5 }), null);
  assert.equal(checkMotionSafety('movej', { q: Q, t: 600 })?.code, 'SAFETY_DURATION');
  assert.equal(checkMotionSafety('speedl', { xd: [0.1, 0, 0, 0, 0, 0], t: 120 })?.code, 'SAFETY_DURATION');
});

test('move_optimized：a/v 是能力比例 (0,1]，不是物理量 —— 判据只能是区间', () => {
  assert.equal(checkMotionSafety('move_optimized', { goal_type: 'joints', goal: Q, a: 0.3, v: 0.3 }), null);
  assert.equal(checkMotionSafety('move_optimized', { goal_type: 'joints', goal: Q, v: 2 })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('move_optimized', { goal_type: 'joints', goal: Q, v: 0 })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('move_optimized', { goal_type: 'pose', goal: [1, 2] })?.code, 'SAFETY_ARGS');
});

// ── C4：draw_* 限幅 / 严格形状 / 加速度 / 力控 limits ──────────────────────

test('★ C4 绘图幅值：半径/边长按 maxStepM 限幅（毫米写成米的典型错误）', () => {
  assert.equal(checkMotionSafety('draw_circle', { center: POSE, r: 0.05 }), null);
  const circle = checkMotionSafety('draw_circle', { center: POSE, r: 10 });
  assert.equal(circle?.code, 'SAFETY_STEP');
  assert.match(circle.message, /draw_circle 的 r=10/);
  assert.equal(checkMotionSafety('draw_square', { origin: POSE, border: 0.2 }), null);
  assert.equal(checkMotionSafety('draw_square', { origin: POSE, border: 10 })?.code, 'SAFETY_STEP');
  assert.equal(checkMotionSafety('draw_rectangle', { origin: POSE, width: 0.2, height: 0.1 }), null);
  assert.equal(checkMotionSafety('draw_rectangle', { origin: POSE, width: 0.2, height: 10 })?.code, 'SAFETY_STEP');
  assert.equal(checkMotionSafety('draw_star', { center: POSE, side: 10 })?.code, 'SAFETY_STEP');
  // 闭区间：恰好等于上限放行。
  assert.equal(checkMotionSafety('draw_circle', { center: POSE, r: 0.5 }), null);
});

test('★ C4 绘图：缺参数/负值/NaN/位姿形状错一律 SAFETY_ARGS（不得当"未提供"跳过）', () => {
  assert.equal(checkMotionSafety('draw_circle', { center: POSE })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('draw_circle', { center: POSE, r: -0.05 })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('draw_circle', { center: POSE, r: Number.NaN })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('draw_square', { origin: [0.3, 0.2], border: 0.1 })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('draw_star', { center: [0, 0, 0, 0, 0, Infinity], side: 0.1 })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('draw_rectangle', { origin: POSE, width: 0.1 })?.code, 'SAFETY_ARGS');
});

test('★ C4 绘图目标也受工作空间约束', () => {
  const limits = { ...DEFAULT_LIMITS, workspace: { x: [-0.5, 0.5], y: [-0.5, 0.5], z: [0, 1] } };
  assert.equal(checkMotionSafety('draw_circle', { center: POSE, r: 0.05 }, limits), null);
  assert.equal(
    checkMotionSafety('draw_circle', { center: [2, 0, 0.4, 0, 0, 0], r: 0.05 }, limits)?.code,
    'SAFETY_WORKSPACE',
  );
});

test('★ C4 加速度：a 出现即校验，超过 maxAccel 拒绝；负值/NaN 也拒绝', () => {
  assert.equal(checkMotionSafety('movej', { q: Q, a: 1.0 }), null);
  assert.equal(checkMotionSafety('movej', { q: Q, a: 0 })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('movej', { q: Q, a: 3 })?.code, 'SAFETY_ACCEL');
  assert.equal(checkMotionSafety('movel', { pose: POSE, a: Number.NaN })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('movel', { pose: POSE, a: 1.2 }), null);
  assert.equal(checkMotionSafety('movel', { pose: POSE, a: 2.5 })?.code, 'SAFETY_ACCEL');
  assert.equal(checkMotionSafety('speedl', { xd: [0.1, 0, 0, 0, 0, 0], a_rot: 0.5 }), null);
  assert.equal(checkMotionSafety('speedl', { xd: [0.1, 0, 0, 0, 0, 0], a_rot: -1 })?.code, 'SAFETY_ARGS');
  // 上限可配置（Config 的 safetyMaxAccel 会通过 limits 传进来）。
  assert.equal(checkMotionSafety('movej', { q: Q, a: 3 }, { ...DEFAULT_LIMITS, maxAccel: 5 }), null);
});

test('★ C4 速度：v 出现即校验（负值/NaN 不再被当作"未提供"跳过）', () => {
  assert.equal(checkMotionSafety('movel', { pose: POSE, v: -0.25 })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('movel', { pose: POSE, v: Number.NaN })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('movel', { pose: POSE, v: 0 })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('movel', { pose: POSE, v: '0.25' })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('movej', { q: Q, v: -1 })?.code, 'SAFETY_ARGS');
});

test('★ C4 速度指令形状：speedj.qd / speedl.xd 不是 6 个有限数一律拒绝', () => {
  assert.equal(checkMotionSafety('speedj', { qd: 'oops' })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('speedj', { qd: [1, 0, 0, 0, 0] })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('speedj', { qd: [1, 0, 0, 0, 0, Number.NaN] })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('speedl', { xd: [0.1, 0, 0, 0, 0] })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('speedl', { xd: [0.1, 0, 0, 0, 0, 'x'] })?.code, 'SAFETY_ARGS');
});

test('★ C4 力控 limits / task_frame / wrench：形状与幅值都必须判', () => {
  // limits：前 3 项 = 柔性轴最大速度（≤ maxLinearSpeed），后 3 项 = 刚性轴最大偏差（≤ maxJointSpeed）。
  assert.equal(checkMotionSafety('force_mode', { limits: [0.1, 0.1, 0.1, 1, 1, 1] }), null);
  assert.equal(checkMotionSafety('force_mode', { limits: [9, 0.1, 0.1, 1, 1, 1] })?.code, 'SAFETY_SPEED');
  assert.equal(checkMotionSafety('force_mode', { limits: [0.1, 0.1, 0.1, 9, 1, 1] })?.code, 'SAFETY_SPEED');
  assert.equal(checkMotionSafety('move_force', {
    pose: POSE,
    selection_vector: [0, 0, 1, 0, 0, 0],
    wrench: [0, 0, 5, 0, 0, 0],
    limits: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1],
  }), null);
  assert.equal(
    checkMotionSafety('move_force', { pose: POSE, limits: [1e9, 0.1, 0.1, 1, 1, 1] })?.code,
    'SAFETY_SPEED',
  );
  // 形状错、负值、非有限值 → SAFETY_ARGS（不能当"没给"跳过）
  assert.equal(checkMotionSafety('force_mode', { limits: [0.1, 0.1, 0.1] })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('force_mode', { limits: [-0.1, 0.1, 0.1, 1, 1, 1] })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('force_mode', { limits: 'x' })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('force_mode', { task_frame: [0, 0, 0] })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('force_mode', { task_frame: POSE }), null);
  assert.equal(checkMotionSafety('force_mode', { wrench: [30, 0, 10, 0, 0] })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('force_mode', { wrench: [30, 0, 10, 0, 0, 0] }), null);
  assert.equal(checkMotionSafety('move_force', { pose: POSE, selection_vector: [0, 0, 2, 0, 0, 0] })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('move_force', { pose: POSE, selection_vector: 'x' })?.code, 'SAFETY_ARGS');
});

test('★ C4 时长 t：NaN/负值 → SAFETY_ARGS（不再静默跳过）', () => {
  assert.equal(checkMotionSafety('movej', { q: Q, t: Number.NaN })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('movej', { q: Q, t: -1 })?.code, 'SAFETY_ARGS');
  assert.equal(checkMotionSafety('movej', { q: Q, t: 0 }), null);
});

// ── checkMotionSafety：工作空间与 fail closed ──────────────────────────────

test('★ 工作空间：声明了就把显式笛卡尔目标关在盒子里', () => {
  const limits = { ...DEFAULT_LIMITS, workspace: { x: [-0.5, 0.5], y: [-0.5, 0.5], z: [0, 1] } };
  assert.equal(checkMotionSafety('movel', { pose: POSE, v: 0.25 }, limits), null);
  const out = checkMotionSafety('movel', { pose: [2, 0, 0.4, 0, 0, 0], v: 0.25 }, limits);
  assert.equal(out?.code, 'SAFETY_WORKSPACE');
  assert.equal(checkMotionSafety('movec', { pose_via: [0, 0, 5, 0, 0, 0], pose_to: POSE }, limits)?.code, 'SAFETY_WORKSPACE');
});

test('★ move_force 与 force_mode 同受"力/力矩上限 + 工作空间 + 线速度"约束', () => {
  const limits = { ...DEFAULT_LIMITS, workspace: { x: [-0.5, 0.5], y: [-0.5, 0.5], z: [0, 1] } };
  const args = { pose: POSE, selection_vector: [0, 0, 1, 0, 0, 0], wrench: [0, 0, 20, 0, 0, 0], v: 0.25 };
  assert.equal(checkMotionSafety('move_force', args, limits), null, '合法的力控引导运动应放行');
  assert.equal(
    checkMotionSafety('move_force', { ...args, wrench: [0, 0, 100, 0, 0, 0] }, limits)?.code,
    'SAFETY_FORCE',
    '★ 力控引导运动的力必须与 force_mode 受同一条上限（它同样持续压在工件上）',
  );
  assert.equal(
    checkMotionSafety('move_force', { ...args, pose: [2, 0, 0.4, 0, 0, 0] }, limits)?.code,
    'SAFETY_WORKSPACE',
    '目标位姿也要关在工作空间里',
  );
  assert.equal(checkMotionSafety('move_force', { ...args, v: 1 }, limits)?.code, 'SAFETY_SPEED');
  assert.equal(checkMotionSafety('move_force', { ...args, pose: [1, 2] }, limits)?.code, 'SAFETY_ARGS');
});

test('★ 配置坏了就 fail closed：workspaceProblem 非空时拒绝一切运动', () => {
  const broken = { ...DEFAULT_LIMITS, workspaceProblem: '无法解析的片段 “nonsense”' };
  const out = checkMotionSafety('move_z', { distance: -0.01 }, broken);
  assert.equal(out?.code, 'SAFETY_CONFIG');
  assert.match(out.message, /fail closed/);
});

test('safetyGate=false 才关；且与审批开关是两件事（本模块不看 approval）', () => {
  assert.equal(checkMotionSafety('move_z', { distance: -10 }, { ...DEFAULT_LIMITS, enabled: false }), null);
  // `requireApprovalForMotion` 不是本模块的参数：它关不掉物理上限，这正是解耦的意义。
  const stillBlocked = checkMotionSafety('move_z', {
    distance: -10,
    requireApprovalForMotion: false,
  });
  assert.equal(stillBlocked?.code, 'SAFETY_STEP', '把审批开关塞进参数也不能绕过安全闸');
});

test('无规则的 op 直接放行（如 power_off / zero_ftsensor：没有可判的数值幅值）', () => {
  for (const op of ['power_off', 'power_on', 'zero_ftsensor', 'brake_release', 'set_payload', 'shutdown']) {
    assert.equal(checkMotionSafety(op, {}), null, `${op} 不该被数值规则误拦`);
  }
});

// ── audit-log ──────────────────────────────────────────────────────────────

test('summarizeArgs：压成一行、限长，输出里不得出现真实换行（NDJSON 的硬要求）', () => {
  assert.equal(summarizeArgs({ a: 1 }), '{"a":1}');
  // JSON.stringify 把真实换行转义成 \n，所以这里断言的是**转义后的形态**。
  assert.equal(summarizeArgs({ s: 'x\ny' }), '{"s":"x\\ny"}');
  // 真正的坑：U+2028/U+2029 JSON.stringify **不转义**，而按行解析的读者会当成换行。
  const withSeparators = summarizeArgs({ s: 'a\u2028b\u2029c' });
  assert.ok(
    !/[\r\n\u2028\u2029]/u.test(withSeparators),
    `输出里出现了真实换行/行分隔符：${JSON.stringify(withSeparators)}`,
  );
  const long = summarizeArgs({ s: 'a'.repeat(500) });
  assert.ok(long.length < 500, `必须被截断（实测 ${long.length}）`);
  assert.match(long, /…\(.*字符\)$/);
  // 循环引用不能抛：账本写入路径必须永远走到底。
  const circular = {};
  circular.self = circular;
  assert.equal(typeof summarizeArgs(circular), 'string');
});

test('audit-log：file 为空 ⇒ 禁用，record 是 no-op（不建目录、不写盘）', () => {
  const log = createAuditLog({ file: '' });
  assert.equal(log.enabled, false);
  assert.deepEqual(log.record({ op: 'movej' }), { ok: true, skipped: true });
});

test('audit-log：每条决策一行 NDJSON，字段齐全', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-audit-'));
  try {
    const file = join(dir, 'nested', 'audit.ndjson');
    const log = createAuditLog({ file, now: () => Date.UTC(2026, 9, 14, 12, 0, 0) });
    assert.equal(log.record({ ip: '1.2.3.4', op: 'move_z', tool_name: 'ur_move_z', args: { distance: -0.02 }, decision: 'approved' }).ok, true);
    assert.equal(log.record({ ip: '1.2.3.4', op: 'move_z', tool_name: 'ur_move_z', args: { distance: -10 }, decision: 'blocked', reason: 'SAFETY_STEP: 越界' }).ok, true);

    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2, '两次决策 = 两行');
    const first = JSON.parse(lines[0]);
    assert.equal(first.ts, '2026-10-14T12:00:00.000Z');
    assert.equal(first.op, 'move_z');
    assert.equal(first.tool_name, 'ur_move_z');
    assert.equal(first.decision, 'approved');
    assert.equal(first.args, '{"distance":-0.02}');
    const second = JSON.parse(lines[1]);
    assert.equal(second.decision, 'blocked');
    assert.match(second.reason, /^SAFETY_STEP/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('★ audit-log：写盘失败只回报 ok:false，绝不抛（审计不能把下发路径弄挂）', () => {
  const log = createAuditLog({
    file: 'audit.ndjson',
    write: () => {
      throw new Error('EPERM: 磁盘只读');
    },
  });
  const out = log.record({ op: 'movej', decision: 'approved' });
  assert.equal(out.ok, false);
  assert.match(out.error, /EPERM/);
});

test('audit-log：超过阈值滚到 <path>.1，且不丢当前文件', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-audit-rot-'));
  try {
    const file = join(dir, 'audit.ndjson');
    const log = createAuditLog({ file, maxBytes: 200 });
    for (let i = 0; i < 12; i += 1) {
      log.record({ op: 'move_z', args: { distance: -0.001 * i }, decision: 'approved' });
    }
    const live = await stat(file);
    assert.ok(live.size > 0, '当前文件必须还在');
    const rolled = await stat(`${file}.1`);
    assert.ok(rolled.size > 0, '必须有轮转出来的 .1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

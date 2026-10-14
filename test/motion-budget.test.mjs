/**
 * `lib/motion-budget.js` 的单元测试 —— 运动指令的调用预算。
 *
 * 背景（真机现象）：**跑 60 秒的运动，孪生就不动了**。旧逻辑下每次工具调用的预算按默认
 * `commandTimeoutMs = 60000` 算，而 `UrWorker.call()` 超时会 **kill 掉 Python 子进程**
 * （RTDE、Dashboard、孪生的遥测推送线程都在里面）⇒ 机器人在动，孪生永久冻结。
 * 所以这里钉住两件事：**按参数推算预算**、**下限不低于配置值**、**超长要封顶**。
 *
 * 运行：node --test test/motion-budget.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MOTION_BUDGET_CAP_MS,
  MOTION_BUDGET_FLOOR_MS,
  MOTION_BUDGET_FORCE_MS,
  MOTION_BUDGET_MARGIN_MS,
  motionBudgetMs,
} from '../lib/motion-budget.js';

test('★ 给了 t= 就按 t 推算：60 秒的运动绝不能再正好卡在 60 秒的默认预算上', () => {
  const budget = motionBudgetMs('movej', { t: 60 });
  assert.ok(budget > 60_000, `60 秒的运动必须拿到 >60s 的预算（实得 ${budget}）`);
  assert.equal(budget, 60_000 + MOTION_BUDGET_MARGIN_MS);
});

test('ur_wait_steady 的 timeout_s 同样计入', () => {
  assert.equal(motionBudgetMs('wait_steady', { timeout_s: 300 }), 300_000 + MOTION_BUDGET_MARGIN_MS);
});

test('★ 力控引导运动（时长由控制器按距离/速度决定）给宽兜底', () => {
  assert.ok(
    motionBudgetMs('move_force', { v: 0.25 }) >= MOTION_BUDGET_FORCE_MS,
    '参数推不出时长，必须给宽兜底，否则长时间力控会在运动中途被掐断',
  );
});

test('下限：不低于配置值、也不低于内置下限；非法参数忽略', () => {
  assert.equal(motionBudgetMs('movej', {}), MOTION_BUDGET_FLOOR_MS);
  assert.equal(
    motionBudgetMs('movej', {}, { baseMs: 120_000 }),
    120_000,
    '用户把 commandTimeoutMs 调大了，预算不能被算小',
  );
  assert.equal(motionBudgetMs('movej', { t: -5 }), MOTION_BUDGET_FLOOR_MS, '负数忽略');
  assert.equal(motionBudgetMs('movej', { t: '60' }), MOTION_BUDGET_FLOOR_MS, '字符串忽略');
  assert.equal(motionBudgetMs('movej', undefined), MOTION_BUDGET_FLOOR_MS, '没有参数也要有下限');
});

test('封顶：再长也不能变成"永远不超时"', () => {
  assert.equal(motionBudgetMs('movej', { t: 10_000 }), MOTION_BUDGET_CAP_MS);
  assert.equal(motionBudgetMs('wait_steady', { timeout_s: 99_999 }), MOTION_BUDGET_CAP_MS);
});

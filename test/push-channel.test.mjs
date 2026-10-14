/**
 * `lib/push-channel.js` 的单元测试 —— 孪生遥测独立通道的切分。
 *
 * 为什么值得单独测：这条通道是"运动期间孪生还能动"的唯一数据源，而它跑在 stderr 上，
 * 必须与普通诊断文本**共存**。真正会出错的都是边界：一行被切成两段、**连魔数前缀本身都被切断**、
 * 以及一个不以换行结尾的 traceback（那种必须立刻交出去，否则诊断就永久丢了）。
 *
 * 运行：node --test test/push-channel.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PUSH_CHANNEL_PREFIX,
  looksLikePushStart,
  splitPushChunk,
} from '../lib/push-channel.js';

const pushLine = (payload) => `${PUSH_CHANNEL_PREFIX}${payload}\n`;

test('一条完整推送：进 pushes，且**不**污染诊断', () => {
  const out = splitPushChunk('', pushLine('{"push":"telemetry","ip":"1.2.3.4"}'));
  assert.deepEqual(out.pushes, ['{"push":"telemetry","ip":"1.2.3.4"}']);
  assert.equal(out.text, '', '遥测不得进 stderrTail');
  assert.equal(out.rest, '');
});

test('★ 推送行被切成两段：前半截缓冲、后半截补齐后才产出', () => {
  const first = splitPushChunk('', `${PUSH_CHANNEL_PREFIX}{"push":"tel`);
  assert.deepEqual(first.pushes, [], '半行不能当完整行解析');
  assert.equal(first.rest, `${PUSH_CHANNEL_PREFIX}{"push":"tel`);
  const second = splitPushChunk(first.rest, 'emetry"}\n');
  assert.deepEqual(second.pushes, ['{"push":"telemetry"}']);
  assert.equal(second.rest, '');
});

test('★ 连魔数前缀本身被切断也要认（否则那一帧遥测永久丢）', () => {
  const first = splitPushChunk('', '@@DSH-');
  assert.equal(looksLikePushStart('@@DSH-'), true, '前缀的前缀必须被识别为"推送的开头"');
  assert.equal(first.rest, '@@DSH-', '必须缓冲而不是当成诊断');
  const second = splitPushChunk(first.rest, `UR-PUSH@@ {"ok":1}\n`);
  assert.deepEqual(second.pushes, ['{"ok":1}']);
});

test('遥测与诊断混在一段里：各归各位', () => {
  const chunk = `Traceback (most recent call last):\n${pushLine('{"push":"telemetry"}')}ValueError: boom\n`;
  const out = splitPushChunk('', chunk);
  assert.deepEqual(out.pushes, ['{"push":"telemetry"}']);
  assert.equal(out.text, 'Traceback (most recent call last):\nValueError: boom\n');
});

test('★ 不以换行结尾的诊断尾巴必须**立刻**交出去（否则诊断永久丢）', () => {
  const out = splitPushChunk('', 'ValueError: 没有换行的最后一行');
  assert.deepEqual(out.pushes, []);
  assert.equal(out.rest, '', '诊断尾巴不缓冲');
  assert.equal(out.text, 'ValueError: 没有换行的最后一行\n');
});

test('空输入与非法输入都安全（绝不让 stderr 处理路径抛错）', () => {
  assert.deepEqual(splitPushChunk('', ''), { pushes: [], text: '', rest: '' });
  assert.deepEqual(splitPushChunk(undefined, undefined), { pushes: [], text: '', rest: '' });
  assert.equal(looksLikePushStart(undefined), false);
  assert.equal(looksLikePushStart(''), false);
  // 前缀里带内容但不完整：仍然只缓冲，不产出。
  const out = splitPushChunk('', `${PUSH_CHANNEL_PREFIX}{"a":1}`);
  assert.deepEqual(out.pushes, []);
  assert.equal(out.rest, `${PUSH_CHANNEL_PREFIX}{"a":1}`);
});

test('多帧一次到达：全部产出', () => {
  const out = splitPushChunk('', pushLine('{"n":1}') + pushLine('{"n":2}') + pushLine('{"n":3}'));
  assert.deepEqual(out.pushes, ['{"n":1}', '{"n":2}', '{"n":3}']);
  assert.equal(out.text, '');
});

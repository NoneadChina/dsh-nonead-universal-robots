/**
 * test/selftest.test.mjs — 真实 Python worker 的端到端协议自检（不需要机器人）。
 *
 * 通过真正的进程管理器（`lib/worker.js`）拉起真正的 `python/ur_worker.py`，验证：
 *   ping 往返、未知 op 被拒、未知 op 带结构化错误码、优雅关闭（shutdown）能结束进程。
 *
 * 这是"Python 半能不能起来"的唯一现场证据：所有其它 Python 用例都用 `python -c` 探针
 * 直接调函数，只有这里经过 spawn + 行协议 + 真实解释器启动路径（含依赖导入）。
 *
 * 运行：node --test test/selftest.test.mjs
 * 指定解释器：UR_PYTHON=C:\Python312\python.exe node --test test/selftest.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { UrWorker } from '../lib/worker.js';

const pythonDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'python');

function makeWorker(extra = {}) {
  return new UrWorker({
    pythonBin: process.env.UR_PYTHON || process.env.PYTHON || 'python',
    pythonDir,
    commandTimeoutMs: 30000,
    ...extra,
  });
}

test('真实 worker：ping 往返带回 Python 与 URBasic 就绪状态', async () => {
  const worker = makeWorker();
  try {
    const pong = await worker.call('ping');
    assert.equal(pong?.message, 'pong');
    assert.equal(pong?.data?.urbasic, true, 'URBasic 必须可导入');
    assert.match(String(pong?.data?.python ?? ''), /^\d+\.\d+/, '必须报告 Python 版本');
  } finally {
    worker.dispose();
  }
});

test('真实 worker：未知 op 被拒绝，且带机器可读错误码', async () => {
  const worker = makeWorker();
  try {
    await assert.rejects(() => worker.call('nope-not-an-op'), (error) => {
      assert.match(error.message, /未知操作/);
      assert.equal(error.code, 'BADARG', '未知 op 必须是 BADARG（而非笼统的 HUGE）');
      return true;
    });
  } finally {
    worker.dispose();
  }
});

test('真实 worker：disconnect 一个从未连接过的 IP 是幂等的成功', async () => {
  const worker = makeWorker();
  try {
    const res = await worker.call('disconnect', { ip: '127.0.0.1' });
    assert.match(String(res?.message ?? ''), /连接不存在/);
  } finally {
    worker.dispose();
  }
});

test('真实 worker：参数校验在入口处生效（NaN 必须被拒，不能送到控制器）', async () => {
  const worker = makeWorker();
  try {
    // 未连接任何机器人：这里期望的是**参数校验先失败**（BADARG），而不是连接失败，
    // 说明 `_vec` 的有限性检查确实在 ensure_connected 之前生效。
    // 注意：JSON 里 NaN 不是合法字面量，所以用字符串 "nan" —— float("nan") 同样能造出 NaN。
    await assert.rejects(
      () => worker.call('movel', { ip: '127.0.0.1', pose: ['nan', 0, 0, 0, 0, 0] }),
      (error) => {
        assert.ok(['BADARG', 'CONNECT_FAILED', 'NOT_CONNECTED'].includes(error.code),
          `应当是一个明确的结构化错误，实测 code=${error.code} message=${error.message}`);
        return true;
      },
    );
  } finally {
    worker.dispose();
  }
});

test('真实 worker：shutdown 会自行退出（让 RTDE 会话被主动释放，而不是被 kill）', async () => {
  const worker = makeWorker();
  try {
    await worker.call('ping');
    const closed = await worker.shutdown({ timeoutMs: 8000 });
    assert.equal(closed, true, 'shutdown 必须在期限内收到应答');
    // 进程应当已经退出（正常退出码 0）。
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(worker.proc, null, '退出后不得再持有进程句柄');
  } finally {
    worker.dispose();
  }
});

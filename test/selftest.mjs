/**
 * dsh-nonead-universal-robots — protocol self-test (no robot required).
 *
 * Spawns the vendored Python worker through the real process manager and
 * exercises the stdio JSON protocol with `ping` and an unknown op. Run with:
 *
 *   npm test
 *
 * Set UR_PYTHON to a specific interpreter if `python` is not on PATH:
 *   UR_PYTHON=C:\\Python312\\python.exe npm test
 */

import { UrWorker } from '../lib/worker.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pythonDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'python');

async function main() {
  const worker = new UrWorker({
    pythonBin: process.env.UR_PYTHON || 'python',
    pythonDir,
    commandTimeoutMs: 15000,
  });

  let failed = false;
  try {
    const pong = await worker.call('ping');
    if (pong?.message !== 'pong') {
      throw new Error(`ping did not return pong: ${JSON.stringify(pong)}`);
    }
    console.log('[ok] worker ping →', JSON.stringify(pong));

    await worker.call('disconnect', { ip: '127.0.0.1' });
    console.log('[ok] disconnect(empty) handled');

    try {
      await worker.call('nope');
      throw new Error('unknown op should have been rejected');
    } catch (e) {
      console.log('[ok] unknown op rejected →', e.message.slice(0, 60));
    }
  } catch (e) {
    failed = true;
    console.error('[FAIL]', e.message);
  } finally {
    worker.dispose();
  }

  if (failed) process.exit(1);
  console.log('selftest passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error('selftest crashed:', e.message);
  process.exit(1);
});

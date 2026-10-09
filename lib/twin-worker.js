/**
 * dsh-nonead-universal-robots — the digital twin's **read-only** worker policy.
 *
 * © 2026 拓德科技 / Suzhou Nonead Robot Technology Co., Ltd. — https://www.nonead.com
 *
 * The twin polls the robot at ~10 Hz (SSE frames every 100 ms) through the same
 * single-threaded Python worker that executes every motion command. That shared
 * queue is what makes this file necessary: while the robot is moving, the twin's
 * read sits **behind** the motion command in the worker's stdin queue, so it
 * takes as long as the motion does.
 *
 * Two consequences, both of which used to stop the twin from ever following the
 * robot again:
 *
 * 1. **The default budget is 60 s.** `UrWorker.call()` kills the Python child
 *    when a request exceeds its deadline — by design: a single-threaded worker
 *    stuck inside library code would otherwise make every later request queue
 *    behind it. But a *read-only visualisation* read that times out must not
 *    destroy the robot session (RTDE + Dashboard live in that child): the twin
 *    would then never get a pose again, and the user sees "it synced two moves
 *    and then stopped".
 * 2. **A wedged read wedges the frame pump.** The twin's frame pump refuses to
 *    stack a second read on top of an outstanding one (8 in-flight requests is
 *    the worker's hard ceiling), so one slow read means no frames at all.
 *
 * Therefore the twin reads with a **short budget** and `killOnTimeout: false`:
 * fail fast, keep the session, let the next frame try again. Motion commands
 * keep their own budget and their own kill-on-timeout behaviour, untouched.
 *
 * Kept free of every dependency (no cordis, no schema, no `node:` beyond
 * nothing at all) so it can be unit-tested without the host module graph.
 */

/**
 * The digital twin's per-read budget (milliseconds).
 *
 * Short on purpose: a twin frame is worth ~10 ms of robot time, and the client
 * shows "data stalled" rather than silently freezing. See the file header.
 */
export const TWIN_READ_TIMEOUT_MS = 2500;

/**
 * Wrap a worker so its `call()` uses the twin's read-only policy.
 *
 * @param {{call: Function}|null|undefined} worker the live `UrWorker` (may be
 *   `null` when the Python half failed to initialise).
 * @returns {{call: (op: string, params?: object) => Promise<unknown>}|null}
 *   `null` when there is no usable worker, so the route handlers keep answering
 *   `connected:false` / `worker_unavailable` exactly as before.
 */
export function createTwinReadWorker(worker) {
  if (worker === null || worker === undefined || typeof worker.call !== 'function') return null;
  return {
    call: (op, params) =>
      worker.call(op, params, TWIN_READ_TIMEOUT_MS, undefined, { killOnTimeout: false }),
  };
}

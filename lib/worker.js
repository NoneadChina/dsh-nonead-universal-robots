/**
 * dsh-nonead-universal-robots — Python worker process manager.
 *
 * Spawns the vendored `python/ur_worker.py` once (lazily) and keeps it alive
 * across tool calls so UR robot connections persist. Speaks a line-delimited
 * JSON protocol over stdin/stdout and fans out a matching promise per request.
 *
 * Robustness notes:
 * - `ensureStarted()` awaits the child's `spawn` event before the first write,
 *   so an early `call` never hits a still-closed stdin stream.
 * - the child environment scrubs DSH_* and credential-shaped vars (like DSH's
 *   own subprocess seam) so the worker never sees harness secrets.
 * - a crashed worker fails every in-flight request and respawns on the next
 *   call, with a short backoff to avoid a tight crash loop.
 * - **a timed-out or aborted call kills the child.** The worker is strictly
 *   single-threaded (`for line in sys.stdin`): if one request never finishes,
 *   every later request queues behind it and times out too — the plugin would
 *   be dead until the host restarts, with a "timed out" message that hides the
 *   real cause. Killing the process is the only way to interrupt robot/library
 *   code that ignores our deadlines (see python/URBasic/realTimeClient.py).
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

/** Keep PATH and ordinary env, drop DSH_* and credential-shaped names. */
function scrubbedEnv(extra) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^DSH_/.test(key)) continue;
    if (/KEY|PASSWORD|SECRET|TOKEN/i.test(key)) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * Reject rather than queue when this many requests are already in flight: a
 * robot that stops answering must not let an unbounded backlog build up behind
 * a single-threaded worker (every queued caller would burn its own timeout
 * waiting for a slot that only frees when the head request finishes).
 */
export const DEFAULT_MAX_IN_FLIGHT = 8;

export class UrWorker {
  constructor({
    pythonBin,
    pythonDir,
    commandTimeoutMs = 60000,
    restartDelayMs = 500,
    maxInFlight = DEFAULT_MAX_IN_FLIGHT,
  }) {
    this.pythonBin = pythonBin;
    this.pythonDir = pythonDir;
    this.commandTimeoutMs = commandTimeoutMs;
    this.restartDelayMs = restartDelayMs;
    this.maxInFlight = maxInFlight > 0 ? maxInFlight : DEFAULT_MAX_IN_FLIGHT;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stderrTail = '';
    /** Diagnostics counters — surfaced through `stats()`. */
    this.droppedLines = 0;
    this.unknownResponses = 0;
    this.lastDroppedLine = '';
    this.respawnCount = 0;
    this._spawnPromise = null;
    this._lastExitAt = 0;
    this._disposed = false;
  }

  /** Snapshot of the manager's health — cheap, safe to log or expose. */
  stats() {
    return {
      pending: this.pending.size,
      droppedLines: this.droppedLines,
      unknownResponses: this.unknownResponses,
      respawnCount: this.respawnCount,
      lastDroppedLine: this.lastDroppedLine,
      stderrTail: this.stderrTail,
      running: this.proc !== null && this.proc.exitCode === null,
    };
  }

  /**
   * Ensure a live child process. Resolves once the child has actually spawned
   * (stdin writable) or rejects if spawn failed. Idempotent across concurrent
   * callers: only one spawn is ever in flight.
   *
   * Crash backoff: when the previous process exited recently (within
   * `restartDelayMs`), we wait out the remainder before respawning so a worker
   * that dies on startup cannot produce a tight crash->respawn loop.
   */
  async ensureStarted() {
    if (this._disposed) {
      throw new Error('UR worker was disposed');
    }
    if (this._spawnPromise === null) {
      this._spawnPromise = this._start();
    }
    await this._spawnPromise;
  }

  _start() {
    this.stderrTail = '';

    return new Promise((resolve, reject) => {
      // Crash backoff (see the class docstring): if the last run ended moments
      // ago, wait the remainder of `restartDelayMs` before spawning again so a
      // worker that exits immediately on boot cannot spin in a tight loop.
      const wait = this._lastExitAt + this.restartDelayMs - Date.now();
      const start = () => {
        this.respawnCount += 1;
        return this._spawnOnce().then(resolve, reject);
      };
      if (wait > 0) {
        const timer = setTimeout(() => {
          clearTimeout(timer);
          start().catch(reject);
        }, wait);
        return;
      }
      start().catch(reject);
    });
  }

  _spawnOnce() {
    const script = join(this.pythonDir, 'ur_worker.py');
    const env = scrubbedEnv({ PYTHONPATH: this.pythonDir, PYTHONUNBUFFERED: '1' });
    this.stderrTail = '';

    return new Promise((resolve, reject) => {
      let proc;
      try {
        proc = spawn(this.pythonBin, ['-u', script], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env,
        });
      } catch (e) {
        this._spawnPromise = null;
        reject(new Error(`UR worker failed to start: ${e.message}`));
        return;
      }
      this.proc = proc;

      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line) => this._onLine(line));

      proc.stderr.on('data', (d) => {
        const s = d.toString();
        this.stderrTail = (this.stderrTail + s).slice(-2000);
      });

      let spawned = false;
      proc.on('spawn', () => {
        spawned = true;
        resolve();
      });

      proc.on('error', (e) => {
        this._spawnPromise = null;
        if (!spawned) {
          reject(new Error(`UR worker failed to start: ${e.message}`));
        }
        this._failAll(new Error(`UR worker failed to start: ${e.message}`));
        this.proc = null;
      });

      proc.on('exit', (code, signal) => {
        this._spawnPromise = null;
        this._lastExitAt = Date.now();
        const reason = new Error(
          `UR worker exited (code=${code ?? '?'}, signal=${signal ?? '?'})${this.stderrTail ? `: ${this.stderrTail.slice(-500)}` : ''}`,
        );
        this._failAll(reason);
        this.proc = null;
      });
    });
  }

  _onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      // The worker writes the protocol on stdout and redirects URBasic's own
      // prints into a log file, so an unparseable line means something new is
      // printing to the protocol channel (or a value could not be serialised).
      // Silently ignoring it used to turn that into a mysterious client-side
      // timeout — count it and keep the tail for `stats()`.
      this.droppedLines += 1;
      this.lastDroppedLine = line.slice(0, 300);
      return;
    }
    const entry = this.pending.get(msg.id);
    if (entry === undefined) {
      this.unknownResponses += 1;
      this.lastDroppedLine = line.slice(0, 300);
      return;
    }
    // Do NOT delete from `pending` here: `entry.resolve`/`entry.reject` are the
    // settling wrappers and do the bookkeeping (delete + clearTimeout + abort
    // listener removal). Deleting first made those wrappers see "no such id"
    // and return without ever settling the promise, so every call hung until
    // its own timeout fired.
    if (msg.ok) {
      entry.resolve(msg.data);
    } else {
      // Attach the structured code (0.5.0+) so callers/tests can branch on the
      // failure class without parsing Chinese prose.
      const error = new Error(msg.error);
      if (typeof msg.code === 'string') error.code = msg.code;
      if (msg.data !== undefined) error.data = msg.data;
      entry.reject(error);
    }
  }

  _failAll(reason) {
    for (const [, entry] of this.pending) {
      try {
        entry.reject(reason);
      } catch {
        /* a rejecting handler must not stop the remaining failures */
      }
    }
    this.pending.clear();
  }

  /**
   * Kill the child and drop the spawn handle so the next `call()` starts a
   * clean process. Used when a request exceeds its deadline: the Python side is
   * single-threaded and may be stuck inside library code with no cancellation,
   * so the process is the only unit we can reliably reset.
   */
  _killFor(address) {
    const proc = this.proc;
    this.proc = null;
    this._spawnPromise = null;
    if (proc !== null && proc.exitCode === null) {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
      this._lastExitAt = Date.now();
    }
    const reason = new Error(
      `UR worker 未能及时完成 ${address}，进程已被终止以便下一个请求换用干净的 worker` +
        `${this.stderrTail ? `（stderr: ${this.stderrTail.slice(-300)}）` : ''}`,
    );
    reason.code = 'WORKER_KILLED';
    this._failAll(reason);
  }

  async call(op, params = {}, timeoutMs = this.commandTimeoutMs, signal) {
    if (this._disposed) {
      throw new Error('UR worker was disposed');
    }
    if (this.pending.size >= this.maxInFlight) {
      throw new Error(
        `UR worker 当前有 ${this.pending.size} 个请求在排队（上限 ${this.maxInFlight}）：` +
          '机器人可能已无响应，请先确认连接状态再重试。',
      );
    }
    await this.ensureStarted();
    const id = this.nextId++;
    // Carry the effective command timeout to the worker so the Python side can
    // bound its own move-confirmation / completion waits to the same budget,
    // instead of blocking the (single-threaded) worker forever.
    const payload = JSON.stringify({ id, op, _timeout_ms: timeoutMs, ...params });

    return new Promise((resolve, reject) => {
      /** Once settled we must not touch `this.pending` for this id again. */
      const settle = (fn) => (value) => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        clearTimeout(timer);
        if (signal !== undefined) signal.removeEventListener('abort', onAbort);
        fn(value);
      };
      const settleResolve = settle(resolve);
      const settleReject = settle(reject);

      const onAbort = () => {
        settleReject(new Error(`UR call "${op}" was aborted`));
        this._killFor(`"${op}"（已取消）`);
      };

      const timer = setTimeout(() => {
        settleReject(new Error(`UR call "${op}" timed out after ${timeoutMs}ms`));
        // The Python handler is still running and cannot be cancelled; kill it
        // so the *next* call is not stuck behind it forever.
        this._killFor(`"${op}"`);
      }, timeoutMs);

      this.pending.set(id, {
        timer,
        resolve: settleResolve,
        reject: settleReject,
      });

      if (signal !== undefined) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      const proc = this.proc;
      if (proc !== null && proc.exitCode === null && proc.stdin?.writable) {
        proc.stdin.write(payload + '\n');
      } else if (proc !== null) {
        // The process is still referenced but no longer writable (about to
        // exit): tell the caller instead of silently dropping the request.
        settleReject(new Error('UR worker process is not writable'));
      } else {
        // `this.proc` was cleared by an `exit` between `ensureStarted()` and
        // the write (spawn/exit race): fail clearly so the caller can retry.
        settleReject(new Error('UR worker exited before the request could be sent'));
      }
    });
  }

  /**
   * Ask the worker to release every robot connection and exit on its own, so
   * RTDE / Dashboard / RealTime sessions are closed deliberately instead of
   * being torn down by process death (which can leave the controller holding a
   * claimed RTDE session). Best-effort: never throws, never blocks for long.
   *
   * The grace period is floored at 5 s: `call()` kills the child on timeout, so
   * a shorter budget would trade a deliberate close for exactly the abrupt
   * process death this method exists to avoid. Callers may only extend it.
   */
  async shutdown({ timeoutMs = 5000 } = {}) {
    if (this._disposed) return false;
    const budget = Math.max(5000, timeoutMs);
    try {
      await Promise.race([
        // ⚠️ op 名是 `shutdown_worker`（不是 `shutdown` —— 后者是"关闭控制器"）。
        this.call('shutdown_worker', {}, budget),
        new Promise((_, reject) => setTimeout(() => reject(new Error('shutdown timeout')), budget)),
      ]);
      return true;
    } catch {
      return false;
    }
  }

  dispose() {
    this._disposed = true;
    const proc = this.proc;
    this.proc = null;
    this._spawnPromise = null;
    if (proc !== null) {
      try {
        proc.stdin.end();
      } catch {}
      try {
        proc.kill();
      } catch {}
    }
    this._failAll(new Error('UR worker was disposed'));
  }
}

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

export class UrWorker {
  constructor({ pythonBin, pythonDir, commandTimeoutMs = 60000, restartDelayMs = 500 }) {
    this.pythonBin = pythonBin;
    this.pythonDir = pythonDir;
    this.commandTimeoutMs = commandTimeoutMs;
    this.restartDelayMs = restartDelayMs;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stderrTail = '';
    this._spawnPromise = null;
    this._lastExitAt = 0;
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
    if (this._spawnPromise === null) {
      this._spawnPromise = this._start();
    }
    await this._spawnPromise;
  }

  _start() {
    const script = join(this.pythonDir, 'ur_worker.py');
    const env = scrubbedEnv({ PYTHONPATH: this.pythonDir, PYTHONUNBUFFERED: '1' });
    this.stderrTail = '';

    return new Promise((resolve, reject) => {
      // Crash backoff (see the class docstring): if the last run ended moments
      // ago, wait the remainder of `restartDelayMs` before spawning again so a
      // worker that exits immediately on boot cannot spin in a tight loop.
      const wait = this._lastExitAt + this.restartDelayMs - Date.now();
      const start = () => this._spawnOnce().then(resolve, reject);
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
      return;
    }
    const entry = this.pending.get(msg.id);
    if (entry === undefined) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) {
      entry.resolve(msg.data);
    } else {
      entry.reject(new Error(msg.error));
    }
  }

  _failAll(reason) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(reason);
    }
    this.pending.clear();
  }

  async call(op, params = {}, timeoutMs = this.commandTimeoutMs, signal) {
    await this.ensureStarted();
    const id = this.nextId++;
    // Carry the effective command timeout to the worker so the Python side can
    // bound its own move-confirmation / completion waits to the same budget,
    // instead of blocking the (single-threaded) worker forever.
    const payload = JSON.stringify({ id, op, _timeout_ms: timeoutMs, ...params });

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`UR call "${op}" was aborted`));
      };
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`UR call "${op}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        timer,
        resolve: (value) => {
          if (signal !== undefined) signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        reject: (reason) => {
          if (signal !== undefined) signal.removeEventListener('abort', onAbort);
          reject(reason);
        },
      });

      if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true });
      const proc = this.proc;
      if (proc !== null && proc.exitCode === null && proc.stdin?.writable) {
        proc.stdin.write(payload + '\n');
      } else if (proc !== null) {
        // The process is still referenced but no longer writable (about to
        // exit): tell the caller instead of silently dropping the request.
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error('UR worker process is not writable'));
      } else {
        // `this.proc` was cleared by an `exit` between `ensureStarted()` and
        // the write (spawn/exit race): fail clearly so the caller can retry.
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error('UR worker exited before the request could be sent'));
      }
    });
  }

  dispose() {
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

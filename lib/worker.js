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

/**
 * Error classes this manager attaches, so callers (e.g. the digital twin) can
 * branch on *why* a call failed without parsing Chinese/English prose.
 *
 * They split into two kinds, and the distinction matters:
 *   - "we could not get an answer in time" (busy / timeout / killed / exited /
 *     aborted) — the robot may be perfectly healthy, just occupied;
 *   - a structured failure the Python side reported (`BADARG`, `TIMEOUT`, …),
 *     which is carried through untouched from the response envelope.
 */
export const WORKER_ERROR_CODES = {
  BUSY: 'WORKER_BUSY',
  TIMEOUT: 'WORKER_TIMEOUT',
  ABORTED: 'WORKER_ABORTED',
  KILLED: 'WORKER_KILLED',
  EXITED: 'WORKER_EXITED',
  STDIN: 'WORKER_STDIN',
  DISPOSED: 'WORKER_DISPOSED',
  SPAWN: 'WORKER_SPAWN',
};

/** Build an `Error` with a machine-readable `code`. */
function coded(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

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
    /**
     * Per-child stderr, so a dying child's error message never quotes a newer child's output.
     * WeakMap keyed by the ChildProcess object (dropped automatically with the child).
     */
    this._stderrTailByProc = new WeakMap();
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
      throw coded('UR worker was disposed', WORKER_ERROR_CODES.DISPOSED);
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
        reject(coded(`UR worker failed to start: ${e.message}`, WORKER_ERROR_CODES.SPAWN));
        return;
      }
      this.proc = proc;

      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line) => this._onLine(line));

      proc.stderr.on('data', (d) => {
        const s = d.toString();
        this.stderrTail = (this.stderrTail + s).slice(-2000);
        // Per-child copy: `this.stderrTail` is shared, so at exit time it may already
        // belong to a newer child (see the `exit` handler).
        this._stderrTailByProc.set(proc, ((this._stderrTailByProc.get(proc) ?? '') + s).slice(-2000));
      });

      let spawned = false;
      proc.on('spawn', () => {
        spawned = true;
        resolve();
      });

      proc.on('error', (e) => {
        if (this.proc === proc) {
          this._spawnPromise = null;
        }
        if (!spawned) {
          reject(coded(`UR worker failed to start: ${e.message}`, WORKER_ERROR_CODES.SPAWN));
        }
        this._failFor(proc, coded(`UR worker failed to start: ${e.message}`, WORKER_ERROR_CODES.SPAWN));
        if (this.proc === proc) {
          this.proc = null;
        }
      });

      /*
       * ⚠️ **只清理属于自己的状态。**
       *
       * 旧写法无条件执行 `this.proc = null; this._spawnPromise = null;
       * this._failAll(...)`。而被 kill 的子进程与"下一个子进程"之间存在 500ms 重启退避窗口：
       * 旧子进程的 exit 事件完全可能在新子进程**已经起来并且正在服务请求**之后才到达 ——
       * 于是这次 exit 会把 `this.proc` 清成 null（`stats().running` 从此说谎）、把新子进程
       * 正在飞的请求全部 reject（调用方看到一句莫名其妙的 "UR worker exited"），而
       * `dispose()` 之后也再找不到那个新子进程去 kill —— 留下一个仍占着控制器独占 RTDE
       * 会话的孤儿 Python 进程。孪生面板每秒发 20 次 worker 调用，第二次落进这个窗口是常态。
       *
       * 现在：`exit` 先判断死的到底是不是"当前"子进程，只清自己的状态；并且只失败**路由到
       * 这个子进程**的在飞请求（每个请求在 `call()` 里记录了它的 child）。
       */
      proc.on('exit', (code, signal) => {
        const isCurrent = this.proc === proc;
        const mine = this._stderrFor(proc);
        if (isCurrent) {
          this._spawnPromise = null;
          this._lastExitAt = Date.now();
          this.proc = null;
        }
        const reason = coded(
          `UR worker exited (code=${code ?? '?'}, signal=${signal ?? '?'})${mine ? `: ${mine.slice(-500)}` : ''}`,
          WORKER_ERROR_CODES.EXITED,
        );
        this._failFor(proc, reason);
      });
    });
  }

  /**
   * The stderr tail captured for one specific child.
   *
   * `this.stderrTail` is shared state and is overwritten by whichever child wrote last, so at
   * exit time it may belong to a *different* (newer) child. Each child keeps its own tail here,
   * which is what makes the error message trustworthy.
   */
  _stderrFor(proc) {
    return this._stderrTailByProc.get(proc) ?? this.stderrTail;
  }

  /** Fail only the in-flight requests that were routed to `proc`. */
  _failFor(proc, reason) {
    const doomed = [...this.pending.values()].filter((entry) => entry.child === proc);
    for (const entry of doomed) {
      try {
        entry.reject(reason);
      } catch {
        /* a rejecting handler must not stop the remaining failures */
      }
    }
    this._stderrTailByProc.delete(proc);
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
    const reason = coded(
      `UR worker 未能及时完成 ${address}，进程已被终止以便下一个请求换用干净的 worker` +
        `${this.stderrTail ? `（stderr: ${this.stderrTail.slice(-300)}）` : ''}`,
      WORKER_ERROR_CODES.KILLED,
    );
    this._failAll(reason);
  }

  /**
   * Send one request and await its response.
   *
   * `options.killOnTimeout` (0.6.6) decides what a deadline means:
   *   - `true` (default) — the historical behaviour: kill the child, because a
   *     single-threaded worker stuck inside library code would otherwise make
   *     every later request queue behind it until its own timeout.
   *   - `false` — reject *only* this caller. Used by the digital twin's read-only
   *     telemetry: the robot session (RTDE + Dashboard, held by the child) is
   *     strictly more valuable than one visualisation frame, and the twin polls
   *     at 10 Hz — so a twin read that times out while the worker is busy
   *     executing a motion command must NOT tear the session down. The command
   *     that made the worker busy still carries its own budget and still kills
   *     the child if *it* overruns; the twin only declines to escalate.
   *
   * @param {string} op worker op name
   * @param {object} [params]
   * @param {number} [timeoutMs]
   * @param {AbortSignal} [signal]
   * @param {{killOnTimeout?: boolean}} [options]
   */
  async call(op, params = {}, timeoutMs = this.commandTimeoutMs, signal, options = {}) {
    const killOnTimeout = options?.killOnTimeout !== false;
    if (this._disposed) {
      throw coded('UR worker was disposed', WORKER_ERROR_CODES.DISPOSED);
    }
    if (this.pending.size >= this.maxInFlight) {
      throw coded(
        `UR worker 当前有 ${this.pending.size} 个请求在排队（上限 ${this.maxInFlight}）：` +
          '机器人可能已无响应，请先确认连接状态再重试。',
        WORKER_ERROR_CODES.BUSY,
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
        settleReject(coded(`UR call "${op}" was aborted`, WORKER_ERROR_CODES.ABORTED));
        this._killFor(`"${op}"（已取消）`);
      };

      const timer = setTimeout(() => {
        settleReject(coded(`UR call "${op}" timed out after ${timeoutMs}ms`, WORKER_ERROR_CODES.TIMEOUT));
        // The Python handler is still running and cannot be cancelled; kill it
        // so the *next* call is not stuck behind it forever. Skipped for
        // read-only callers that opted out (see `call()`'s doc comment): they
        // must never destroy the robot session just because it was busy.
        if (killOnTimeout) this._killFor(`"${op}"`);
      }, timeoutMs);

      // Which child this request is routed to. `_failFor()` uses it so a dying child can only
      // fail *its own* requests, never a newer child's (see the `exit` handler).
      const child = this.proc;
      this.pending.set(id, {
        timer,
        resolve: settleResolve,
        reject: settleReject,
        child,
      });

      if (signal !== undefined) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      const proc = child;
      if (proc !== null && proc.exitCode === null && proc.stdin?.writable) {
        // `stdin` 的 `error` 必须有人接：子进程在写入途中死掉（或内核缓冲满）会给出
        // EPIPE/ERR_STREAM_DESTROYED，而 EventEmitter 上未处理的 'error' 是**未捕获异常** ——
        // 它会掀掉整个 DSH 宿主进程，而不是让这一次调用失败。
        proc.stdin.on('error', (e) => {
          this.stderrTail = (this.stderrTail + `stdin error: ${e.message}\n`).slice(-2000);
          settleReject(coded(`UR worker stdin 写入失败：${e.message}`, WORKER_ERROR_CODES.STDIN));
        });
        proc.stdin.write(payload + '\n');
      } else if (proc !== null) {
        // The process is still referenced but no longer writable (about to
        // exit): tell the caller instead of silently dropping the request.
        settleReject(coded('UR worker process is not writable', WORKER_ERROR_CODES.EXITED));
      } else {
        // `this.proc` was cleared by an `exit` between `ensureStarted()` and
        // the write (spawn/exit race): fail clearly so the caller can retry.
        settleReject(coded('UR worker exited before the request could be sent', WORKER_ERROR_CODES.EXITED));
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
    this._failAll(coded('UR worker was disposed', WORKER_ERROR_CODES.DISPOSED));
  }
}

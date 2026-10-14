/**
 * lib/push-channel.js — 解析孪生遥测的**独立通道**（stderr + 魔数前缀）。
 *
 * ## 为什么推送不能继续跟响应共用 stdout
 * Python 侧原先用 `_write_protocol_line` 把"响应"和"遥测推送"都写进 stdout，并共用一把
 * `_PROTOCOL_LOCK`。真机上这会冻结孪生：
 *   1. 主线程写一条**大响应**时占着那把锁；
 *   2. 此时若 stdout 管道因为宿主一时没抽干而**背压**，这条写会阻塞，推送线程被同一把锁挡在门外；
 *   3. 超过宿主 `TWIN_PUSH_FRESH_MS`（300 ms）没收到推送，`lib/twin-routes.js` 就**回退**去发一次
 *      显式读 —— 而运动期间那次读排在运动指令后面，于是孪生只剩"数据已停止更新"。
 *
 * 所以遥测改走 stderr + `PUSH_CHANNEL_PREFIX`，并有自己的锁（Python 侧 `_PUSH_LOCK`）：
 * 既不被响应的锁串行化，也不被 stdout 的背压堵住。宿主**两路都收**（stdout 的推送行 + 这条通道），
 * 所以新旧 Python 侧都能工作。
 *
 * ## 这个模块只做一件事：把字节流切成"遥测"与"普通 stderr 诊断"
 * 纯函数、零依赖，因此"行被切断"这类边界能被单测钉住（`test/push-channel.test.mjs`）。
 */

/** 与 `python/ur_worker.py` 的 `PUSH_CHANNEL_PREFIX` 必须逐字相同。 */
export const PUSH_CHANNEL_PREFIX = '@@DSH-UR-PUSH@@ ';

/**
 * 这一段（可能只是一行的**前半截**）看起来是不是一条推送的开头？
 *
 * 三种情况都要认：完整前缀 + 内容、只有前缀、以及**前缀自身被切断**
 * （例如 chunk 恰好停在 `@@DSH-`）—— 最后这种如果不缓冲，那帧遥测就永久丢了。
 */
export function looksLikePushStart(text) {
  const value = typeof text === 'string' ? text : '';
  if (value === '') return false;
  if (value.startsWith(PUSH_CHANNEL_PREFIX)) return true;
  return PUSH_CHANNEL_PREFIX.startsWith(value);
}

/**
 * 把一段 stderr 数据切分。
 *
 * @param {string} pending 上一次没切完的残留（通常是半条推送行）
 * @param {string} chunk 本次收到的数据
 * @returns {{pushes: string[], text: string, rest: string}}
 *   - `pushes`：完整的遥测载荷（**不含**前缀，可直接 `JSON.parse`）；
 *   - `text`：应当进入 `stderrTail` 的诊断文本（保持原样，含换行）；
 *   - `rest`：留给下一次的残留 —— **只缓冲"看起来是推送"的尾巴**，普通诊断尾巴立刻交出去，
 *     否则一个不以换行结尾的 traceback 会永远进不了 `stderrTail`。
 */
export function splitPushChunk(pending, chunk) {
  const text = `${typeof pending === 'string' ? pending : ''}${typeof chunk === 'string' ? chunk : ''}`;
  if (text === '') return { pushes: [], text: '', rest: '' };

  const segments = text.split('\n');
  const tail = segments.pop() ?? '';
  const pushes = [];
  const diagnostics = [];
  for (const line of segments) {
    if (line.startsWith(PUSH_CHANNEL_PREFIX)) {
      pushes.push(line.slice(PUSH_CHANNEL_PREFIX.length));
    } else {
      diagnostics.push(line);
    }
  }

  if (looksLikePushStart(tail)) {
    return { pushes, text: diagnostics.length > 0 ? `${diagnostics.join('\n')}\n` : '', rest: tail };
  }
  // 诊断尾巴立刻交出去（与改动前的行为一致：stderr 一个字都不少）。
  if (tail !== '') diagnostics.push(tail);
  return { pushes, text: diagnostics.length > 0 ? `${diagnostics.join('\n')}\n` : '', rest: '' };
}

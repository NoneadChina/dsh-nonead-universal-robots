/**
 * lib/audit-log.js — 动作审计账本：每一条**受门禁的运动指令**留痕一行 NDJSON。
 *
 * ## 为什么需要
 * 这个插件让模型直接驱动一台会伤人的机器。出事之后（撞了、程序被覆盖了、保护性停止反复触发），
 * 第一个问题永远是"**到底谁在什么时候让它做了什么**"。在此之前这个问题答不出来：审批状态只活在
 * `pendingMotion` 的内存里，指令发出去了就没有任何痕迹。
 *
 * 记的是**决策**而不是遥测：`{ts, ip, op, tool_name, args, decision, reason}`，其中
 * `decision ∈ {approved, denied, blocked, unchecked}`：
 *   - `approved` — 人工批准后下发；
 *   - `denied`   — 审批被拒（或审批通道不可用导致 fail-closed）；
 *   - `blocked`  — **预飞安全闸**拦下（`lib/safety-gate.js`），从未走到审批；
 *   - `unchecked`— 该 op 不受门禁（只读），仅当显式开启 `auditLogAll` 时记录。
 *
 * ## 两条硬约束
 * 1. **绝不因为写日志失败而影响机器人动作**：所有 IO 异常都被吞掉并回报 `{ok:false,error}`，
 *    调用方据此决定是否告警，但**不能**让审计把下发路径弄挂。
 * 2. **单行单事件、追加写、可轮转**：便于 `grep`/`jq` 事后取证；超过上限就滚到 `<path>.1`。
 */
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

/** 参数快照的截断长度：足够看清"它到底要动多远"，又不至于把日志写爆。 */
export const ARGS_MAX_CHARS = 400;

/** 默认轮转阈值。 */
export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/** 把参数压成一行、可控长度、**不含换行**（NDJSON 的硬要求）。 */
export function summarizeArgs(args, maxChars = ARGS_MAX_CHARS) {
  let text;
  try {
    text = JSON.stringify(args ?? {});
  } catch {
    return '"<无法序列化>"';
  }
  if (typeof text !== 'string') return 'null';
  /*
   * ⚠️ 换行不是主要风险：`JSON.stringify` 已经把 `\n`/`\r` 转义掉了。真正会破坏"一条记录一行"的
   * 是 **U+2028 / U+2029（行分隔符/段分隔符）** —— JSON.stringify **不转义**它们，而按行读取的
   * 工具（`grep`、`jq`、各种 NDJSON 解析器）会把它们当成换行。所以这里一并换成空格。
   */
  text = text.replace(/[\r\n\u2028\u2029]+/gu, ' ');
  return text.length > maxChars ? `${text.slice(0, maxChars)}…(${text.length} 字符)` : text;
}

/**
 * 建一个审计账本。
 *
 * @param {object} options
 * @param {string} options.file          账本文件路径；空串则返回一个"禁用"的账本（record 恒为 no-op）。
 * @param {number} [options.maxBytes]    轮转阈值。
 * @param {() => number} [options.now]   注入时钟（测试用）。
 * @param {(path: string, line: string) => void} [options.write] 注入写入（测试用）。
 */
export function createAuditLog({ file, maxBytes = DEFAULT_MAX_BYTES, now = Date.now, write } = {}) {
  const enabled = typeof file === 'string' && file !== '';
  let written = 0;
  let warned = false;

  /** 当前文件大小：只在开启时探测一次，之后靠自己累计（避免每次 stat）。 */
  if (enabled) {
    try {
      written = statSync(file).size;
    } catch {
      written = 0;
    }
  }

  const sink =
    typeof write === 'function'
      ? write
      : (path, line) => {
          mkdirSync(dirname(path), { recursive: true });
          appendFileSync(path, line, 'utf8');
        };

  function rotateIfNeeded() {
    if (written <= maxBytes) return;
    try {
      renameSync(file, `${file}.1`);
    } catch {
      // 轮转失败（被占用等）不改语义：继续往原文件追加，只把计数清零避免每次重试。
    }
    written = 0;
  }

  return {
    enabled,
    file: enabled ? file : null,

    /**
     * 追加一条决策记录。**永不抛异常**。
     *
     * @returns `{ok:true}` 或 `{ok:false, error}`；禁用时返回 `{ok:true, skipped:true}`。
     */
    record(entry) {
      if (!enabled) return { ok: true, skipped: true };
      const payload = {
        ts: new Date(now()).toISOString(),
        ip: typeof entry?.ip === 'string' ? entry.ip : null,
        op: entry?.op ?? null,
        tool_name: entry?.tool_name ?? null,
        args: summarizeArgs(entry?.args),
        decision: entry?.decision ?? 'unknown',
        reason: entry?.reason ?? null,
      };
      const line = `${JSON.stringify(payload)}\n`;
      try {
        rotateIfNeeded();
        sink(file, line);
        written += Buffer.byteLength(line, 'utf8');
        return { ok: true };
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        if (!warned) {
          // 只吵一次：审计坏了要让人知道，但不能每来一条指令就刷一行。
          warned = true;
          console.error(`[dsh-nonead-ur] 审计账本写入失败（${file}）：${error}`);
        }
        return { ok: false, error };
      }
    },
  };
}

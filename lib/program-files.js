/**
 * lib/program-files.js — 本地 / 远端**程序文件路径的越界检查**。
 *
 * ## 为什么 LLM 插件必须有这一层
 * `ur_upload_program` 会**读本地文件**，`ur_download_program` 会**写本地文件**。没有约束时，
 * 模型可以让插件把本机任意文件（私钥、凭据、配置）传到机器人上，或把机器人上的文件写到本机
 * 任意路径 —— 这与"把 `bash` 工具交给模型"是同一级别的暴露面。而 `lib/index.js` 已有的
 * `sanitizeArgs` 只**挡参数键**，不挡**取值**。
 *
 * 所以本地路径一律锁在 `programDir`（可配置）里：
 *   - 绝对路径必须落在该目录内；
 *   - 相对路径按 `programDir` 解析；
 *   - 任何逃逸（`..`、或软链/junction 把父目录或目标文件指到外面）都被拒绝 —— 因为判据是
 *     `realpath` 之后的结果，而不是调用方给的字符串；
 *   - 只处理 `.urp`；读模式还要真的存在且是普通文件。
 * 远端路径只做**形状**检查（绝对、无 `..`、`.urp`）：它在机器人上，越界风险由操作员自己承担。
 *
 * ⚠️ 这里必须用 `realpathSync.native`，不能用 `fs.realpathSync`：Windows 下 JS 版 realpath 靠
 * 逐级 `lstat`+`readlink` 自己解链接，而 **junction 既不被 `lstat` 报成符号链接**（`isSymbolicLink()`
 * 为 false），`readlink` 也直接 `EINVAL` —— 于是它把 junction 路径**原样返回**。判据因此形同虚设：
 * 一条 `programDir` 内的 junction 就能让读/写落到目录之外。`.native` 走 OS 的
 * `GetFinalPathNameByHandle`，能解开包括 junction 在内的所有重解析点。
 *
 * 纯逻辑 + 可注入 `stat`/`lstat`/`realpath`，因此能被单测完整覆盖（`test/program-files.test.mjs`）。
 */
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

/** 单个程序文件的大小上限（1 MiB）。`.urp` 是 XML，正常远小于它；上限用来挡住"把大文件当程序传"。 */
export const DEFAULT_MAX_PROGRAM_BYTES = 1024 * 1024;

/** 默认的本地程序目录：`<DSH_HOME>/nonead-ur/programs`（与审计账本同一个插件数据目录）。 */
export function defaultProgramDir(dshHome) {
  return join(dshHome, 'nonead-ur', 'programs');
}

/** `candidate` 是否真的在 `root` 里（两者都必须是已规范化的绝对路径）。 */
function insideRoot(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * 校验一个**本地**程序路径。
 *
 * @param {string} input          调用方给的路径（相对 `programDir` 或其中的绝对路径）。
 * @param {object} options
 * @param {string} options.root   `programDir`（空 = 未配置 ⇒ fail closed）。
 * @param {'read'|'write'} options.mode  read = 上传（要存在且是文件）；write = 下载（父目录要在）。
 * @returns `{ok:true, path, size?}` 或 `{ok:false, reason}`。
 */
export function checkLocalPath(input, { root, mode, deps = {} } = {}) {
  const stat = deps.stat ?? statSync;
  const lstat = deps.lstat ?? lstatSync;
  // ⚠️ `.native`：JS 版 realpath 在 Windows 下不解 junction（见文件头说明）。
  const realpath = deps.realpath ?? realpathSync.native;

  if (typeof root !== 'string' || root.trim() === '') {
    return {
      ok: false,
      reason: '未配置本地程序目录（programDir）—— 本功能 fail closed，不读也不写任何本地文件',
    };
  }
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, reason: '必须给出 local_path（相对 programDir，或 programDir 内的绝对路径）' };
  }

  let rootReal;
  try {
    rootReal = realpath(resolve(root));
  } catch {
    return { ok: false, reason: `programDir 不存在或不可访问：${root}` };
  }

  // ⚠️ 绝对路径交给 `resolve` 时**第二个参数被忽略**，这正是我们要的：它再做一次越界检查。
  //    关键点是判据落在 `realpath` 之后 —— 字符串里没有 `..` 也可能被软链带出目录外。
  const candidate = resolve(rootReal, input);
  if (!insideRoot(rootReal, candidate)) {
    return { ok: false, reason: `local_path 逃出了 programDir（${rootReal}）：${input}` };
  }
  if (extname(candidate).toLowerCase() !== '.urp') {
    return { ok: false, reason: `只处理 .urp 程序文件，实得 ${extname(candidate) || '（无扩展名）'}` };
  }

  if (mode === 'read') {
    let info;
    try {
      info = stat(candidate);
    } catch {
      return { ok: false, reason: `本地文件不存在：${candidate}` };
    }
    if (typeof info.isFile === 'function' && !info.isFile()) {
      return { ok: false, reason: `不是普通文件：${candidate}` };
    }
    // ⚠️ 判据必须落在 `realpath` 之后：`stat` 会**跟着**链接走，所以父目录里的一条 junction
    //    就能让这里读到 `programDir` 之外的文件 —— 而字符串里连一个 `..` 都没有。
    let fileReal;
    try {
      fileReal = realpath(candidate);
    } catch {
      return { ok: false, reason: `本地文件解析不出真实路径：${candidate}` };
    }
    if (!insideRoot(rootReal, fileReal)) {
      return { ok: false, reason: `本地文件 realpath 后落在 programDir 之外：${fileReal}` };
    }
    return { ok: true, path: candidate, size: Number(info.size) };
  }

  // write：目标文件可以还不存在，但**父目录必须存在**，而且它 realpath 之后仍要在 `programDir` 内
  // （否则一条指向目录外的软链就能把下载写到任意位置）。
  if (mode !== 'write') return { ok: false, reason: `未知的检查模式：${mode}` };
  let parentReal;
  try {
    parentReal = realpath(dirname(candidate));
  } catch {
    return { ok: false, reason: `父目录不存在：${dirname(candidate)}（本插件不会替你创建目录）` };
  }
  if (!insideRoot(rootReal, parentReal)) {
    return { ok: false, reason: `父目录 realpath 后落在 programDir 之外：${parentReal}` };
  }
  if (!insideRoot(rootReal, join(parentReal, 'x'))) {
    return { ok: false, reason: `目标位置逃出了 programDir：${candidate}` };
  }
  // 目标文件**若已存在**，它自己也得落在 root 内：一条指向外面的软链会被写入过程跟着走，
  // 把下载写到 `programDir` 之外。悬空链接（`realpath` 抛错）同样拒绝 —— 跟着它写就等于在
  // 目录外**新建**文件。`lstat` 只用来判存在，不去跟链接。
  let targetExists = true;
  try {
    lstat(candidate);
  } catch {
    targetExists = false; // 目标是新文件：write 模式允许
  }
  if (targetExists) {
    let fileReal;
    try {
      fileReal = realpath(candidate);
    } catch {
      return { ok: false, reason: `目标已存在但解析不出真实路径（悬空链接？）：${candidate}` };
    }
    if (!insideRoot(rootReal, fileReal)) {
      return { ok: false, reason: `目标文件 realpath 后落在 programDir 之外：${fileReal}` };
    }
  }
  return { ok: true, path: candidate };
}

/**
 * 复合检查：把"远端路径形状 + 本地牢笼 + 大小上限"串起来，供宿主在派发前调用一次。
 *
 * @returns `null`（放行，兼容旧调用）或 `{localPath, remotePath}`（放行并给出**已 realpath 的
 *   绝对路径**，供宿主注入 wire —— Python 侧按自己的 cwd 解析相对路径，不注入就会"校验 A、读写 B"）、
 *   或 `{reason}`（拒绝，理由直接给模型看）。
 */
export function checkProgramTransfer(op, args, { root, maxBytes = DEFAULT_MAX_PROGRAM_BYTES } = {}) {
  const remote = checkRemotePath(args?.remote_path);
  if (!remote.ok) return { reason: remote.reason };

  const mode = op === 'upload_program' ? 'read' : op === 'download_program' ? 'write' : null;
  if (mode === null) return { reason: `未知的程序文件操作：${op}` };

  const local = checkLocalPath(args?.local_path, { root, mode });
  if (!local.ok) return { reason: local.reason };

  if (mode === 'read' && Number.isFinite(local.size) && local.size > maxBytes) {
    return {
      reason: `本地文件 ${local.size} 字节超过上限 ${maxBytes} 字节 —— programDir 里不该放这么大的东西`,
    };
  }
  return { localPath: local.path, remotePath: remote.path };
}

/**
 * 校验一个**远端**（机器人上）的程序路径：绝对、无 `..` 段、以 `.urp` 结尾。
 *
 * 只做形状检查：这个路径在机器人上，本插件无法也不该替操作员决定哪些目录可写。
 */
export function checkRemotePath(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, reason: '必须给出 remote_path（机器人上的绝对路径，例如 /programs/pick.urp）' };
  }
  const value = input.trim();
  // 机器人上是 POSIX 路径：只认前导 `/`。**不要**用 `isAbsolute()` —— 在 Windows 上它会把
  // `C:\x.urp` 也判成绝对路径，而那种路径在机器人上毫无意义。
  if (!value.startsWith('/')) {
    return { ok: false, reason: `remote_path 必须是机器人上的绝对路径（以 / 开头），实得：${value}` };
  }
  if (value.split('/').includes('..')) {
    return { ok: false, reason: `remote_path 不得包含 .. 段：${value}` };
  }
  if (extname(value).toLowerCase() !== '.urp') {
    return { ok: false, reason: `只处理 .urp 程序文件，实得 ${extname(value) || '（无扩展名）'}` };
  }
  return { ok: true, path: value };
}

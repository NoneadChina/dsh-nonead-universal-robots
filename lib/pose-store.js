/**
 * lib/pose-store.js — 命名位姿表的**宿主侧**名字校验与路径牢笼。
 *
 * ## 为什么名字需要牢笼
 * 位姿表按**一个位姿一个文件**存（`<poseDir>/<名字>.json`），因为这样单条增删改不会互相牵连，
 * 人类也能直接看懂。代价是：**模型给的"名字"就是文件名**，于是 `../` 这种输入天然是路径穿越面。
 * 所以这里用**白名单**（`[A-Za-z0-9_.- ]`）而不是转义，再叠一层 `realpath` 判"真的落在目录内" ——
 * 与 `lib/program-files.js` 的分工完全一致：
 *
 *   - **宿主（本模块）**：名字/路径/向量形状的校验与牢笼 —— 纯逻辑 + 可注入 IO，单测能全覆盖；
 *   - **worker**：真正读写那个已经被宿主校验过的绝对路径。
 *
 * 位姿是**本机数据**，与机器人无关：所以这些工具不需要 `ip`（除非要求"从机器人当前姿态捕获"）。
 */
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * 位姿名的白名单。
 *
 * **故意允许 Unicode 字母/数字**（`工位1`、`取料位` 是中文用户最自然的命名方式，只收 ASCII 是硬伤），
 * 同时精确排除真正危险的东西：路径分隔符、Windows 非法字符（`\ / : * ? " < > |`）与控制字符。
 * 必须以字母/数字开头（挡掉隐藏文件与以 `-` 开头这种会被当作选项的名字）。
 *
 * ⚠️ `.` 是允许的，因此 `..` 能通过这一层 —— 但它出不去：名字会被拼成 `<目录>/...json`
 * （见 `resolvePosePath` 的第二层结构判定），所以这里是白名单，而不是"见 `..` 就拒绝"的字符串匹配。
 */
export const POSE_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_.\- ]{0,63}$/u;

/** Windows 保留设备名：`CON.json` 这类文件名在 Windows 上会被当成设备，必须拒绝。 */
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/** 位姿表条目上限（防止无限增长；删除用 ur_delete_pose）。 */
export const DEFAULT_MAX_POSES = 200;

/** 默认位姿目录：`<DSH_HOME>/nonead-ur/poses`（与审计账本、程序目录同一个插件数据目录下）。 */
export function defaultPoseDir(dshHome) {
  return join(dshHome, 'nonead-ur', 'poses');
}

/** 校验位姿名。 */
export function checkPoseName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, reason: `位姿名必须是非空字符串（实得 ${JSON.stringify(name)}）` };
  }
  if (name !== name.trim()) {
    return { ok: false, reason: `位姿名不得以空白开头或结尾（实得 ${JSON.stringify(name)}）—— 那种名字看起来一样却互不相等` };
  }
  if (!POSE_NAME_RE.test(name)) {
    return {
      ok: false,
      reason: `位姿名只允许字母/数字/下划线/点/连字符/空格（可以中文），必须以字母或数字开头，长度 1-64（实得 `
        + `${JSON.stringify(name)}）—— 名字会成为文件名，所以这里排除路径分隔符与 Windows 非法字符`,
    };
  }
  if (WINDOWS_RESERVED.has(name.toLowerCase())) {
    return { ok: false, reason: `“${name}” 是 Windows 保留设备名，用作文件名会被系统当成设备（${name}.json 写不进去）` };
  }
  return { ok: true, name };
}

/**
 * 把一个位姿名解析成**位姿目录内**的绝对 JSON 路径。
 *
 * @returns `{ok:true, path, name, dir}` 或 `{ok:false, reason}`。
 */
export function resolvePosePath(name, { root, deps = {} } = {}) {
  const realpath = deps.realpath ?? realpathSync;
  const stat = deps.stat ?? statSync;

  if (typeof root !== 'string' || root.trim() === '') {
    return { ok: false, reason: '未配置位姿目录（poseDir）—— 本功能 fail closed，不读也不写任何位姿文件' };
  }
  const nameCheck = checkPoseName(name);
  if (!nameCheck.ok) return nameCheck;

  let rootReal;
  try {
    rootReal = realpath(resolve(root));
  } catch {
    // 刻意**不**自动创建：在一个"谁都不知道在哪"的目录里悄悄写文件，比报错糟糕得多。
    return { ok: false, reason: `位姿目录不存在或不可访问：${root}（插件不会替你创建它）` };
  }
  let rootInfo;
  try {
    rootInfo = stat(rootReal);
  } catch {
    return { ok: false, reason: `位姿目录不可访问：${rootReal}` };
  }
  if (typeof rootInfo.isDirectory === 'function' && !rootInfo.isDirectory()) {
    return { ok: false, reason: `位姿目录不是一个目录：${rootReal}` };
  }

  // 名字已过白名单（不含分隔符），下面这层是**纵深防御**：万一将来放宽名字规则，这里仍然拦得住。
  const candidate = resolve(rootReal, `${nameCheck.name}.json`);
  const rel = relative(rootReal, candidate);
  if (rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    return { ok: false, reason: `位姿文件路径逃出了位姿目录（${rootReal}）：${candidate}` };
  }
  return { ok: true, path: candidate, name: nameCheck.name, dir: rootReal };
}

/** 6 维有限数（位姿或关节角）。 */
export function checkPoseVector(value, label) {
  if (!Array.isArray(value) || value.length !== 6
    || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    return { ok: false, reason: `${label} 必须是 6 个有限数（实得 ${JSON.stringify(value)}）` };
  }
  return { ok: true, value: value.map(Number) };
}

/**
 * 保存前的复合校验：名字 + 牢笼 + "至少一项内容" + 向量形状。
 *
 * `capture` = 调用方要求"从机器人当前姿态捕获"（此时允许不给 pose/joints，由 worker 去读机器人）。
 */
export function checkPoseForSave({ name, pose, joints, capture = false, root, deps = {} } = {}) {
  const target = resolvePosePath(name, { root, deps });
  if (!target.ok) return target;

  if (pose === undefined && joints === undefined && !capture) {
    return {
      ok: false,
      reason: '至少要给出 pose（TCP 位姿）或 joints（关节角）之一；或者给出 ip 让插件从机器人当前姿态捕获'
        + ' —— 存一个只有名字、没有任何数值的位姿没有意义',
    };
  }

  const out = { ok: true, path: target.path, name: target.name, dir: target.dir };
  if (pose !== undefined) {
    const checked = checkPoseVector(pose, 'pose');
    if (!checked.ok) return checked;
    out.pose = checked.value;
  }
  if (joints !== undefined) {
    const checked = checkPoseVector(joints, 'joints');
    if (!checked.ok) return checked;
    out.joints = checked.value;
  }
  return out;
}

/**
 * 列表项的大小上限：一个位姿条目理应只有几百字节，超过它就是别的东西被写进了这个目录。
 * （用于 worker 读回每个文件后的健全性检查。）
 */
export const MAX_POSE_FILE_BYTES = 64 * 1024;

/**
 * 数位姿目录里现有的位姿条目（配额检查用）。
 *
 * IO **可注入**，所以"目录读不了"是个能单测的行为，而不是只能靠想象：
 *   - 目录还不存在 ⇒ 按 0 条处理（还没建过表不算错误）；
 *   - 其它读失败（权限、IO 错） ⇒ **如实拒绝**，绝不退化成"0 条"悄悄放行写入 ——
 *     否则配额形同虚设，而调用方还以为一切正常。
 */
export function countPoses(dir, { deps = {}, name } = {}) {
  const readdir = deps.readdir ?? readdirSync;
  const exists = deps.exists ?? existsSync;
  try {
    const entries = readdir(dir);
    const list = Array.isArray(entries) ? entries : [];
    const result = {
      ok: true,
      count: list.filter((entry) => typeof entry === 'string' && entry.toLowerCase().endsWith('.json')).length,
    };
    // 带上"这个名字是否已经存在"：表满时**更新**一条已有位姿仍然应当允许，只有**新增**才该被拒。
    if (typeof name === 'string' && name !== '') {
      result.existing = Boolean(exists(join(dir, `${name}.json`)));
    }
    return result;
  } catch (error) {
    const code = error && error.code ? error.code : String(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: true, count: 0, existing: false };
    return {
      ok: false,
      reason: `位姿目录读不了（${code}）⇒ 无法判断是否已达条目上限，因此拒绝写入`,
    };
  }
}

/**
 * 首次保存时把位姿目录建出来（`recursive`），返回规范化后的目录。
 *
 * 为什么这次可以"自动创建"而 `resolvePosePath` 坚持不创建：**这个目录是插件自己的数据目录**
 * （默认就在 `<DSH_HOME>/nonead-ur/` 下，与审计账本同一个位置，账本也是按需建的），不是用户
 * 随手给的路径。读取/删除仍然 fail closed（目录不存在 = 还没存过任何位姿）。
 */
export function ensurePoseDir(root, { deps = {} } = {}) {
  const mkdir = deps.mkdir ?? mkdirSync;
  const realpath = deps.realpath ?? realpathSync;
  if (typeof root !== 'string' || root.trim() === '') {
    return { ok: false, reason: '未配置位姿目录（poseDir）—— 本功能 fail closed' };
  }
  try {
    mkdir(resolve(root), { recursive: true });
    return { ok: true, dir: realpath(resolve(root)) };
  } catch (error) {
    return { ok: false, reason: `位姿目录建不出来或不可访问：${root}（${error && error.code ? error.code : error}）` };
  }
}

/** 位姿条目上限检查（`count` 由 `countPoses` 得到）。 */
export function checkPoseQuota(count, max = DEFAULT_MAX_POSES, { existing = false } = {}) {
  // 表满时**更新**一条已存在的位姿仍然放行，否则连"改一下再存"都做不了。
  if (existing) return { ok: true };
  if (Number.isFinite(count) && count >= max) {
    return {
      ok: false,
      reason: `位姿表已达上限 ${max} 条 —— 先删掉不再用的位姿（ur_delete_pose），不要让它无限增长`,
    };
  }
  return { ok: true };
}

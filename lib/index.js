/**
 * dsh-nonead-universal-robots — DeepSeek Harness plugin to control Universal Robots.
 *
 * © 2026 拓德科技 / Suzhou Nonead Robot Technology Co., Ltd. — https://www.nonead.com
 *
 * Registers a set of native tools (via @deepseek-ai/dsh-tools) that drive UR
 * collaborative robots through a vendored Python worker (python/ur_worker.py,
 * which wraps the URBasic library copied from the reference nUR MCP server).
 *
 * Design: one persistent Python worker process holds the RTDE / Dashboard /
 * RealTime client sockets per robot IP, so the model calls `connect` once and
 * then issues many commands without re-establishing links.
 *
 * Safety: this plugin commands a physical robot. It is intended for trained
 * operators with the robot in line of sight and an E-stop within reach. Tool
 * descriptions repeat the key warnings; treat it like granting the bash tool.
 */

import z from '@deepseek-ai/schemastery';
import { createHash } from 'node:crypto';
import { dirname, join, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { UrWorker } from './worker.js';
import { pendingMotion } from './pending-motion.js';
import { DEFAULT_LIMITS, checkMotionSafety, parseWorkspace } from './safety-gate.js';
import { createAuditLog } from './audit-log.js';
import {
  DEFAULT_MAX_PROGRAM_BYTES,
  checkProgramTransfer,
  checkRemotePath,
  defaultProgramDir,
} from './program-files.js';
import { motionBudgetMs } from './motion-budget.js';
import {
  DEFAULT_MAX_POSES,
  checkPoseForSave,
  checkPoseQuota,
  countPoses,
  defaultPoseDir,
  ensurePoseDir,
  resolvePosePath,
} from './pose-store.js';
import {
  TWIN_STATE_PATH,
  TWIN_ASSET_PATH,
  TWIN_MODELS_PATH,
  TWIN_STREAM_PATH,
  createTwinStateHandler,
  createTwinStreamHandler,
  createTwinAssetHandler,
  createTwinModelsHandler,
} from './twin-routes.js';
// 数字孪生只读遥测的**专用**预算与"不杀进程"语义：孪生与运动指令共用同一条单线程 worker
// 队列，机器人一动孪生的读就要排队 —— 用默认的 60 s 预算会让它超时并**杀掉 Python 子进程**
// （连带整条 RTDE/Dashboard 会话），孪生此后永远拿不到位姿。详见 lib/twin-worker.js 的文件头。
import { TWIN_READ_TIMEOUT_MS, createTwinReadWorker } from './twin-worker.js';

/** 插件根目录（打包后位于 `app.asar` 内）。 */
const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Python worker 目录。
 *
 * ⚠️ **必须做 asar 感知替换**：打包后本文件在 `app.asar` 内，而 `python/**` 经
 * `asarUnpack` 被解到 **`app.asar.unpacked/`**。Python 是**外部进程**，看不见 asar —
 * 直接指向 asar 内的路径会让 `spawn` 立刻失败（`can't open file '...app.asar\...\python\ur_worker.py'`），
 * 于是**所有 `ur_*` 工具在已安装版里全部不可用**。开发环境走 Junction、路径里没有
 * `app.asar`，替换不会生效，因此两种形态共用这一行。
 *
 * 匹配串刻意带上两边的分隔符：`app.asar.unpacked` 后面跟的是 `.` 而不是分隔符，
 * 所以幂等（不会被替换成 `app.asar.unpacked.unpacked`）。
 */
const PYTHON_DIR = join(PLUGIN_ROOT, 'python')
  .replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`);

/**
 * `assets/models/` — GLB meshes served by the twin asset route (Ruling 7).
 * The directory may legitimately not exist yet while meshes are still being
 * produced; `createTwinAssetHandler` degrades that to a clean 404.
 *
 * **无需** asar 感知：这一份由 Node 的 `fs` 读取，而 Electron 给 `fs` 打了 asar 补丁，
 * 留在 asar 内反而更快。
 */
const ASSETS_DIR = join(PLUGIN_ROOT, 'assets', 'models');

export const name = 'nonead-universal-robots';

/** DSH 主目录（审计账本与本地程序目录都放在它下面）。 */
function dshHome() {
  return typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh');
}

/** 审计账本的默认落点：`<DSH_HOME>/nonead-ur/audit.ndjson`。 */
function defaultAuditPath() {
  // 放在 DSH_HOME 下而不是插件目录里：插件目录在打包后位于 `app.asar`（只读），而账本要能追加。
  return join(dshHome(), 'nonead-ur', 'audit.ndjson');
}

export const inject = ['tools'];

export const Config = z.object({
  pythonBin: z.string().default('python'),
  commandTimeoutMs: z.number().min(1000).max(600000).default(60000),
  connectTimeoutMs: z.number().min(1000).default(30000),
  requireApprovalForMotion: z.boolean().default(true),
  /**
   * 预飞安全闸（`lib/safety-gate.js`）。**与审批门禁解耦**：`requireApprovalForMotion: false`
   * 只关掉人工确认，不会顺手关掉这里的物理上限；要关得显式设 `safetyGate: false`。
   *
   * ⚠️ 这里只能写 **schemastery 真的有的方法**（`.min/.max/.default/…`），没有 zod 的
   * `.positive()` —— 用了不存在的链式方法，schema 一构就抛，`apply()` 根本不会执行，
   * 结果是"插件静默什么都不注册"。唯一能抓住它的是拿**真实** DSL 跑一遍的
   * `check-host-compat.mjs`（`test/tool-schema-dsl.test.mjs` 里的 schemastery 是**桩**，
   * 桩不会因为多一个方法而报错，所以它抓不到这类错）。
   */
  safetyGate: z.boolean().default(true),
  safetyMaxStepM: z.number().min(0.001).default(DEFAULT_LIMITS.maxStepM),
  safetyMaxLinearSpeed: z.number().min(0.001).default(DEFAULT_LIMITS.maxLinearSpeed),
  safetyMaxJointSpeed: z.number().min(0.001).default(DEFAULT_LIMITS.maxJointSpeed),
  // 加速度上限（m/s²）：与 limit 常量解耦在这里落默认值，避免依赖 safety-gate 的常量是否已加载。
  safetyMaxAccel: z.number().min(0.001).default(2.0),
  safetyMaxDurationS: z.number().min(0.1).default(DEFAULT_LIMITS.maxDurationS),
  safetyMaxForceN: z.number().min(0.1).default(DEFAULT_LIMITS.maxForceN),
  safetyMaxTorqueNm: z.number().min(0.01).default(DEFAULT_LIMITS.maxTorqueNm),
  /** 形如 `"x:-1,1 y:-1,1 z:0,1.2"`；空串=不检查工作空间。**解析失败一律 fail closed**。 */
  safetyWorkspace: z.string().default(''),
  /** 动作审计账本（`lib/audit-log.js`）：记的是"决策"，不是遥测。 */
  auditLog: z.boolean().default(true),
  /** 空串 = 默认落点 `<DSH_HOME>/nonead-ur/audit.ndjson`。 */
  auditLogPath: z.string().default(''),
  /** 连不受门禁的只读调用也记一笔（默认只记动作，保持账本聚焦）。 */
  auditLogAll: z.boolean().default(false),
  /**
   * 本地程序文件的**牢笼**（`lib/program-files.js`）：上传/下载的本地路径必须 realpath 之后
   * 落在它里面。空串 = 默认 `<DSH_HOME>/nonead-ur/programs`。
   */
  programDir: z.string().default(''),
  /** 单个程序文件大小上限（字节）：`.urp` 是 XML，正常远小于 1 MiB。 */
  maxProgramBytes: z.number().min(1).default(DEFAULT_MAX_PROGRAM_BYTES),
  /**
   * 命名位姿表的目录（`lib/pose-store.js`）：一位姿一文件，`<poseDir>/<名字>.json`。
   * 空串 = 默认 `<DSH_HOME>/nonead-ur/poses`。
   */
  poseDir: z.string().default(''),
  /** 位姿表条目上限（防止无限增长；删旧用 `ur_delete_pose`）。 */
  maxPoses: z.number().min(1).default(DEFAULT_MAX_POSES),
});

/** Ops that physically move the arm or run a program — gated by human approval. */
const APPROVAL_OPS = new Set([
  'movej', 'movel', 'movep', 'movec', 'servoj', 'move_x', 'move_y', 'move_z',
  'move_tool_x', 'move_tool_y', 'move_tool_z',
  'draw_circle', 'draw_square', 'draw_rectangle', 'draw_star',
  'load_program', 'run_program', 'send_script', 'reset_error',
  // 0.5.0: the new ops that can move the arm or change its physical state.
  // `set_freedrive`/`set_teach_mode` hand the arm to a human (or make it limp),
  // `brake_release` lets it fall under gravity, `power_off`/`shutdown` drop it.
  'set_freedrive', 'set_teach_mode', 'power_on', 'power_off', 'brake_release',
  'unlock_protective_stop', 'shutdown', 'zero_ftsensor', 'conveyor_tracking',
  // 0.6.0: force mode presses the arm against its environment and keeps pressing;
  // `speedj`/`speedl` are open-ended *velocity* commands (the arm keeps moving
  // until it is stopped). **减速/解除类（stopj/stopl/end_force_mode）不入门禁**：
  // 紧急收尾的动作被人工审批挡住，等于把 fail-closed 用反了方向（host-audit P1-2）。
  'force_mode', 'force_mode_settings',
  'speedj', 'speedl',
  'set_payload_inertia',
  // `move_optimized` moves the arm (smoothly, but it moves); `motion_version`
  // changes how *every later* move is planned, so it is a motion-capability
  // change rather than a read.
  'move_optimized', 'motion_version',
  // 力控引导运动：它真的让机械臂在力控模式下运动，而且**持续压在工件/环境上** —— 与 movel 同级。
  'move_force',
  // 审计补齐（host-audit P1）：程序存储的改写同样是"改变机器人上的东西" —— 覆盖一个正在用的
  // 程序、或删掉一个程序，后果不比一次运动轻，而它们的兄弟 op（`load_program`）早已受门禁。
  // `download_program` **不**入：它只读机器人，并把文件写进本地牢笼（`lib/program-files.js`）。
  'upload_program', 'delete_program',

  // 速度倍率同理：它改变的是**此后所有运动**的速度上限，属于运动能力变更，不是一次读取。
  'set_speed_scaling',

  // Modbus 的**写类**：它们能直接驱动 PLC / 外部设备（置输出、发自定义命令），或改变控制器监管
  // 哪些现场总线点位（增删信号）—— 后果不比一次运动轻，所以入门禁。
  // `modbus_get_signal_status`（只读）与两个信号配置项（程序状态依赖行为、刷新频率）**不**入。
  'modbus_add_signal', 'modbus_delete_signal', 'modbus_send_custom_command',
  'modbus_set_output_register', 'modbus_set_output_signal',
  // 审计补齐（host-audit H-2）：这几个 op 的副作用与**已经受门禁**的兄弟 op 完全同类。
  //   `set_tcp` 决定此后所有笛卡尔运动的参考系；`set_tool_voltage`/`set_tool_output_mode`/
  //   `tool_communication` 会改变工具侧电气语义（接错可能损坏工具）；`set_digital_out` /
  //   `set_analog_out` / `set_conveyor_tick` 能直接驱动夹爪/阀/传送带。
  'set_payload', 'set_gravity',
  'set_tcp', 'set_tool_voltage', 'set_tool_output_mode', 'tool_communication',
  'set_digital_out', 'set_analog_out', 'set_conveyor_tick',
]);

/**
 * 运动类 op：决定"预算怎么算"与"超时是否杀子进程"，与是否需要审批**解耦**。
 *
 * 为什么必须分开：`ur_wait_steady` 是 `speedj/speedl` 的官方收尾手段，但它不需要审批；
 * 旧实现只给门禁集合 `killOnTimeout:false`，于是 wait_steady 用 60 s 默认预算，超时就把
 * 正在运动的 Python 子进程杀掉 —— 机械臂还在动，RTDE/Dashboard/孪生一起没了（host-audit P0-1）。
 * `run_program` / `send_script` 同样可能长时间占用 worker，一并归入。
 */
const MOTION_OPS = new Set([
  'movej', 'movel', 'movep', 'movec', 'servoj',
  'move_x', 'move_y', 'move_z', 'move_tool_x', 'move_tool_y', 'move_tool_z',
  'draw_circle', 'draw_square', 'draw_rectangle', 'draw_star',
  'move_optimized', 'move_force',
  'speedj', 'speedl', 'stopj', 'stopl',
  'force_mode', 'end_force_mode',
  'wait_steady',
  'run_program', 'send_script',
]);

/** 审批与审计里需要脱敏的字段（SSH 口令等不能上屏/落盘）。 */
const SENSITIVE_ARG_KEYS = ['password', 'passphrase', 'token', 'secret', 'known_hosts'];

/** 参数快照脱敏：返回浅拷贝，敏感字段替换为 `***`。 */
function redactArgs(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return args;
  const safe = { ...args };
  for (const key of SENSITIVE_ARG_KEYS) {
    if (Object.prototype.hasOwnProperty.call(safe, key) && safe[key] !== undefined) safe[key] = '***';
  }
  return safe;
}

/**
 * 审批提示正文。
 *
 * - `send_script` 展示**完整脚本**（含长度与 sha256）：这是唯一允许任意 URScript 的工具，
 *   只显示前 240 字符等于"看到开头就点头"（host-audit P1-4）。脚本长度上限在 execute 里拦。
 * - 其余工具给脱敏后的紧凑 JSON。
 */
function summarizeArgs(op, args) {
  try {
    const safe = redactArgs(args);
    if (op === 'send_script' && safe !== null && typeof safe === 'object'
      && typeof safe.script === 'string') {
      const script = safe.script;
      const digest = createHash('sha256').update(script, 'utf8').digest('hex');
      return `\n--- URScript（${Buffer.byteLength(script, 'utf8')} 字节，sha256 ${digest}）---\n`
        + `${script}\n--- URScript 结束 ---`;
    }
    return JSON.stringify(safe).slice(0, 600);
  } catch {
    return '';
  }
}

/**
 * Ask a human on the DSH approval channel before dispatching a motion op.
 * Fail-closed: no approval service, no agent, or a non-`allowed-once` outcome
 * all throw, so the command is never sent to the worker.
 */
async function requestApproval(ctx, toolName, op, args, exec) {
  const approval = typeof ctx.get === 'function' ? ctx.get('approval') : ctx.approval;
  if (approval === undefined) {
    throw new Error(`运动指令 ${toolName} 需人工批准，但当前环境未组合审批服务（fail-closed）。可设 requireApprovalForMotion=false 禁用，或补装 @deepseek-ai/dsh-user-approval。`);
  }
  if (exec.agent === undefined) {
    throw new Error(`运动指令 ${toolName} 需路由到会话审批，但该调用无 agent（fail-closed）。`);
  }
  // 先登记待审批目标，让孪生面板能把"它要往哪动"画出来（清单第 8 条：先看后动）。
  // token 保证并发/重叠审批时只清自己那一次。
  const token = pendingMotion.begin(toolName, args, typeof args?.ip === 'string' ? args.ip : undefined);
  try {
    const outcome = await approval.request({
      agent: exec.agent,
      toolName,
      reason: `请确认是否允许机器人执行 ${toolName}（${summarizeArgs(op, args)}）`,
      signal: exec.signal,
    });
    if (outcome !== 'allowed-once') {
      throw new Error(`运动指令 ${toolName} 未获人工批准（${outcome}），已取消。`);
    }
  } finally {
    // 无论批准、拒绝还是审批服务抛错，都必须撤掉预览 —— 否则面板会一直挂着一层
    // "待审批"的假目标，比不显示更误导。
    pendingMotion.end(token);
  }
}

function textOutput(extra = {}) {
  return {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
    ...extra,
  };
}

/**
 * 数组参数。第三个实参决定它在 schema 里是否**必填**：它曾经被硬编码成 `true`，于是任何
 * "文档说可选、Python 也有默认值"的数组参数（`force_mode.task_frame` / `wrench` / `limits`、
 * `set_payload_inertia.inertia`）都变成了**必填** —— 模型不给就被拒掉，而 Python 侧那些默认值
 * 永远走不到（`set_payload_inertia` 文档里写的"不给 inertia 就退回
 * `set_payload_mass`+`set_payload_cog`"因此完全不可达）。
 *
 * ⚠️ `required: false` **不是**这个 DSL 表达"可选"的方式：属性上只要出现 `required` 就必须为
 * `true`（`dsh-tools` 的 schema 编译器报 `required must be true when present`），写成 `false`
 * 会让**该工具整个注册失败**、只在日志留一行 warning，工具从模型视野里静默消失。
 * 可选 = **省略** `required`，所以这里只在必须为 true 时才写上它。
 */
function numberArray(items = { type: 'number' }, description = '', required = true) {
  return { type: 'array', items, ...(required ? { required: true } : {}), ...(description ? { description } : {}) };
}

const IP = () => ({ type: 'string', required: true, description: 'UR 机器人 IP 地址（例如 192.168.1.199；多台机器人各自用连接后保留）' });
const AXIS_MOTION_DISTANCE = () => ({ type: 'number', required: true, description: '沿该轴移动的距离（米），正负号表示方向' });
const MOVE_PARAMS = () => ({
  // ⚠️ DSH 1.5.3 起，「值 schema DSL」只接受这些关键字：
  //   description / title / default / examples / type / oneOf / properties /
  //   additionalProperties / items / enum / const / required
  // `minimum` / `maximum` / `exclusiveMinimum` 等约束关键字**不再被接受**：一旦使用，
  // 该工具会**整个注册失败**，只在日志留一行 warning，工具从模型视野里静默消失。
  // ⇒ 数值范围一律写进 description（模型据此判断），真正的强制校验在
  //   python/ur_worker.py（`_nonneg_float` / `_bounded_int` / `_bounded_float`），那里才是权威。
  a: { type: 'number', description: '加速度，必须 >0；不指定时按官方手册的 movej=1.4 / movel=1.2 取默认' },
  v: { type: 'number', description: '速度，必须 >0；不指定时按官方手册的 movej=1.05 rad/s / movel=0.25 m/s 取默认' },
  t: { type: 'number', description: '移动时长（秒），≥0，默认 0；t>0 时**优先于 a/v**（手册明确：给了 t 就忽略 a/v）' },
  r: { type: 'number', description: '交融半径（米），≥0，默认 0；>0 时机械臂不在该点停住而直接圆滑过渡' },
});

export function apply(ctx, config = {}) {
  let worker = null;
  let workerError = null;

  /*
   * ⚠️ **代码里必须有默认值，不能只依赖 Config schema。**
   *
   * `Config` 用 `z.…default(...)` 声明了四个默认值，而宿主确实会应用它们（已用真实的
   * schemastery 验证：`schema({})` ⇒ `{pythonBin:'python', commandTimeoutMs:60000,
   * connectTimeoutMs:30000, requireApprovalForMotion:true}`）。但 `apply()` 是导出函数：
   * 只要有人用**未经 schema 解析**的裸对象调用它（测试桩、脚本化装配、将来换装配路径），
   * 这几个值就都是 `undefined`。其中三个字段的下游写法本来就有 `?? 默认值` 兜底，
   * **唯独门禁那一句没有** —— 于是"没解析 schema"会静默地把**运动审批门禁整个关掉**，
   * 正是最不该 fail-open 的地方。
   * ⇒ 这里把默认值显式落到代码里，与 schema 保持一致，让门禁不依赖调用方如何装配。
   */
  const requireApprovalForMotion = config.requireApprovalForMotion ?? true;

  /*
   * 预飞安全闸与审计账本：两处都在**代码里**落默认值（与 Config schema 一致），理由同上 ——
   * `apply()` 是导出函数，未经 schema 解析的裸对象调用也必须 fail closed，而不是"安全闸不见了"。
   */
  const workspaceParse = parseWorkspace(config.safetyWorkspace ?? '');
  const safetyLimits = {
    enabled: config.safetyGate ?? true,
    maxStepM: config.safetyMaxStepM ?? DEFAULT_LIMITS.maxStepM,
    maxLinearSpeed: config.safetyMaxLinearSpeed ?? DEFAULT_LIMITS.maxLinearSpeed,
    maxJointSpeed: config.safetyMaxJointSpeed ?? DEFAULT_LIMITS.maxJointSpeed,
    maxAccel: config.safetyMaxAccel ?? DEFAULT_LIMITS.maxAccel ?? 2.0,
    maxDurationS: config.safetyMaxDurationS ?? DEFAULT_LIMITS.maxDurationS,
    maxForceN: config.safetyMaxForceN ?? DEFAULT_LIMITS.maxForceN,
    maxTorqueNm: config.safetyMaxTorqueNm ?? DEFAULT_LIMITS.maxTorqueNm,
    workspace: workspaceParse.ok ? workspaceParse.workspace : null,
    // 解析失败 ⇒ 非空 ⇒ `checkMotionSafety` 拒绝所有运动（fail closed），而不是静默不检查。
    workspaceProblem: workspaceParse.ok ? '' : workspaceParse.reason,
  };
  if (!workspaceParse.ok) {
    ctx.logger?.warn?.(
      `universal-robots: safetyWorkspace 无法解析（${workspaceParse.reason}）—— 预飞安全闸将拒绝所有运动指令`,
    );
  }
  const auditLogAll = config.auditLogAll ?? false;
  const auditLog = createAuditLog({
    file: (config.auditLog ?? true)
      ? (config.auditLogPath && config.auditLogPath.trim() !== '' ? config.auditLogPath : defaultAuditPath())
      : '',
  });
  /**
   * 统一审计入口：**先脱敏再落盘**。
   *
   * `list_programs` / `upload_program` 的参数里有 SSH `password`；账本默认长期保留在
   * `<DSH_HOME>/nonead-ur/audit.ndjson`，明文口令会随备份/共享泄漏（host-audit P1-5）。
   */
  const auditRecord = (entry) => auditLog.record({ ...entry, args: redactArgs(entry?.args) });
  /*
   * 本地程序文件牢笼（`lib/program-files.js`）。默认落在 DSH 数据目录下，可整体改到自己的工作目录。
   * 未配置（或配置成不存在的目录）时**上传/下载一律 fail closed** —— 见该模块的文件头。
   */
  const programDir = config.programDir && config.programDir.trim() !== ''
    ? config.programDir
    : defaultProgramDir(dshHome());
  const programLimits = { root: programDir, maxBytes: config.maxProgramBytes ?? DEFAULT_MAX_PROGRAM_BYTES };
  /*
   * 命名位姿表（`lib/pose-store.js`）。分工与程序文件牢笼一致：**名字牢笼、配额、向量形状都在宿主侧**，
   * worker 只拿到一个已经校验过的绝对路径；路径本身**不是**模型能给的参数（见 `makeTool` 的 `prepare`）。
   */
  const poseDir = config.poseDir && config.poseDir.trim() !== ''
    ? config.poseDir
    : defaultPoseDir(dshHome());
  const maxPoses = config.maxPoses ?? DEFAULT_MAX_POSES;

  try {
    worker = new UrWorker({
      pythonBin: config.pythonBin ?? 'python',
      pythonDir: PYTHON_DIR,
      commandTimeoutMs: config.commandTimeoutMs ?? 60000,
    });
    ctx.effect(
      () => () => {
        // Ask the worker to close its robot connections before killing it: an
        // RTDE session is exclusive on the controller, and a process death can
        // leave the controller holding it until its own timeout — which is
        // exactly the "cannot reconnect after a restart" symptom. `dispose()`
        // is still called unconditionally afterwards, and `shutdown()` is
        // best-effort, so a wedged worker never blocks teardown for long.
        // ⚠️ disposer **必须把 promise return 出去**：cordis 只在 disposer 返回 thenable
        // 时才 await 它（`runDisposable` 里是 `if (isObject(result) && "then" in result) task = result`）。
        // 旧写法直接吞掉了返回值 ⇒ `shutdown_worker` 变成 fire-and-forget，宿主拆卸时
        // 不会等这一次优雅关闭，孤儿 Python 进程继续占着控制器**独占**的 RTDE / Dashboard
        // 会话 —— 正是这段注释上一句说要避免的症状。
        const closed = worker.shutdown({ timeoutMs: 5000 });
        return Promise.resolve(closed).catch(() => {}).finally(() => worker.dispose());
      },
      'universal-robots: worker',
    );
  } catch (e) {
    workerError = e;
    ctx.logger?.warn?.(`universal-robots: worker init failed: ${e.message}`);
  }

  /*
   * Connected-IP registry for the twin state route.
   *
   * `UrWorker` exposes no `connectedIps()` member, and the Python protocol must
   * not change for a visualisation feature — so the host half derives the set
   * from successful `connect` / `disconnect` tool calls (below). It is only a
   * fast pre-check: real correctness comes from the handler's try/catch, so a
   * stale entry costs one failed probe rather than a false `connected:true`.
   */
  const connectedIps = new Set();

  /*
   * Memoised robot model per IP. The twin polls the state route ~10×/s, and the
   * model name comes from a Dashboard round trip that cannot change while the
   * connection lives — so without memoisation the twin alone hammers UR's
   * single Dashboard socket ten times a second for a constant. Cleared on
   * disconnect and on every reconnect so a swapped robot cannot inherit the old
   * name.
   */
  const robotModels = new Map();

  /**
   * Build one tool.
   *
   * ⚠️ **`op` 只能来自这里的闭包参数，绝不能来自 `args`。**
   *
   * 这里曾经直接把模型给的 `args` 交给 `worker.call(op, args, …)`，而 `lib/worker.js:272`
   * 拼线上载荷时是 `{ id, op, _timeout_ms, ...params }` —— `params` 展开在**最后**，于是
   * 模型只要多传一个 `op` 字段就能把它改掉（`{"ip":…, "op":"power_off"}`），而审批门禁检查的
   * 是闭包里的 `op`（`APPROVAL_OPS.has(op)`）。dsh-tools 的参数 schema 不拒绝未声明字段
   * （编译出来的 parameters 没有 `additionalProperties: false`），所以这个多出来的字段能一路
   * 走到 worker —— **全部 38 个受门禁的 op 都可以借任意未受门禁的工具绕过人工确认**
   * （多传 `id` 还能让调用挂满超时后被 kill）。同一个洞也允许模型覆写保护字段 `id` /
   * `_timeout_ms`。
   *
   * 现在的两道防线：
   *   1. 线上载荷按**工具自己声明的参数表**白名单过滤（未声明的字段一律丢弃）；
   *   2. `op` 始终是闭包里的那个，与门禁判定所用的值同一个来源。
   */
  const makeTool = (op, { toolName, description, parameters, timeoutMs, prepare }) => {
    const allowedKeys = new Set(Object.keys(parameters ?? {}));
    /** 只保留该工具声明过的参数 —— 挡住 `op` / `id` / `_timeout_ms` 之类的注入。 */
    const sanitizeArgs = (args) => {
      if (args === null || typeof args !== 'object') return {};
      const safe = {};
      for (const key of allowedKeys) {
        if (Object.prototype.hasOwnProperty.call(args, key)) safe[key] = args[key];
      }
      return safe;
    };

    return defineTool({
      name: toolName,
      description,
      parameters,
      output: textOutput(),
      timeoutMs,
      async execute(rawArgs, exec) {
        const args = sanitizeArgs(rawArgs);
        /*
         * 任意 URScript 的长度上限（64 KiB）。没有上限时：`JSON.stringify` 同步阻塞宿主、
         * stdin 缓冲无界、Python 单行读入无界内存；配合"审批只看 240 字符"还能做到
         * "人看开头、机器执行几 MB"（host-audit P2-8）。
         */
        if (op === 'send_script') {
          const script = args.script;
          if (typeof script !== 'string' || script.trim() === '') {
            auditRecord({ ip: args.ip, op, tool_name: toolName, args, decision: 'blocked', reason: 'SCRIPT: 空脚本' });
            throw new Error('[SCRIPT] 脚本内容不能为空');
          }
          if (Buffer.byteLength(script, 'utf8') > 64 * 1024) {
            auditRecord({
              ip: args.ip, op, tool_name: toolName, args,
              decision: 'blocked', reason: 'SCRIPT: 超过 64 KiB 上限',
            });
            throw new Error('[SCRIPT] 脚本超过 64 KiB 上限，请拆分为多条指令');
          }
        }
        /*
         * ⓪ 宿主**准备/注入**（可选）：位姿表这类"本地数据"工具需要宿主把已经校验过的绝对路径、
         *    配额等以 `_` 前缀协议字段注入。它发生在 `sanitizeArgs` **之后**（所以模型塞的同名字段
         *    已被丢掉，模型无法自己指定路径），又发生在各道门禁与 `worker.call` **之前**。
         *
         * 分隔线：`args` = **模型请求了什么**（审计账本与审批提示记的是它）；`wire` = **我们真正
         * 下发执行的东西**（安全闸与 worker 看的是它）。
         */
        let wire = args;
        if (typeof prepare === 'function') {
          const prepared = prepare(args, { config, poseDir, maxPoses, logger: ctx.logger });
          if (prepared && prepared.ok === false) {
            auditRecord({
              ip: args.ip,
              op,
              tool_name: toolName,
              args,
              decision: 'blocked',
              reason: `${prepared.code}: ${prepared.reason}`,
            });
            throw new Error(`[${prepared.code}] ${prepared.reason}`);
          }
          if (prepared && prepared.wire) wire = { ...args, ...prepared.wire };
        }
        const isGatedOp = APPROVAL_OPS.has(op);
        /*
         * ① 预飞安全闸（`lib/safety-gate.js`）：**在审批之前**判定，且**与审批开关解耦**。
         *
         * 顺序有讲究：一个物理上不可能、或落在声明工作空间之外的请求，不该拿去打扰人点确认；
         * 而 `requireApprovalForMotion: false` 只是关掉人工确认，绝不能顺手把这层物理上限也关掉
         * （要关得显式设 `safetyGate: false`）—— 否则"关掉审批"会静默地变成"关掉所有约束"。
         */
        const verdict = isGatedOp ? checkMotionSafety(op, wire, safetyLimits) : null;
        if (verdict !== null) {
          auditRecord({
            ip: args.ip,
            op,
            tool_name: toolName,
            args,
            decision: 'blocked',
            reason: `${verdict.code}: ${verdict.message}`,
          });
          throw new Error(`[${verdict.code}] ${verdict.message}`);
        }
        /*
         * ② 程序文件牢笼（`lib/program-files.js`）：上传会**读**本地文件、下载会**写**本地文件。
         *    没有这一层，模型就能让插件把本机任意文件（私钥、凭据）送到机器人上，或把机器人上的
         *    文件写到本机任意路径 —— `sanitizeArgs` 只挡参数键、不挡取值。同样在审批之前判定：
         *    路径本身不合法，就不该拿去打扰人。
         */
        if (op === 'upload_program' || op === 'download_program') {
          const transfer = checkProgramTransfer(op, args, programLimits);
          if (transfer !== null && transfer.reason) {
            auditRecord({
              ip: args.ip,
              op,
              tool_name: toolName,
              args,
              decision: 'blocked',
              reason: `PROGRAM_PATH: ${transfer.reason}`,
            });
            throw new Error(`[PROGRAM_PATH] ${transfer.reason}`);
          }
          /*
           * ⚠️ 校验通过后必须把**已 realpath 的绝对路径**注入 wire：
           * `program-files.js` 按 `programDir` 解析相对路径，而 Python 侧会按自己的 cwd
           * 打开同一个字符串 —— 不注入就会"宿主校验 A、Python 读写 B"（host-audit P1-7）。
           * 模型传的同名字段已被 `sanitizeArgs` 丢掉，所以 `_local_path` 只可能来自这里。
           */
          if (transfer && transfer.localPath) wire = { ...wire, _local_path: transfer.localPath };
          if (transfer && transfer.remotePath) wire = { ...wire, _remote_path: transfer.remotePath };
        }
        /*
         * `delete_program` 同样改写机器人上的程序存储，但旧实现只给 upload/download 做了
         * 远端路径校验 —— worker 侧直接 `sftp.remove(remote_path)`，传 `/etc/passwd` 也能删
         * （host-audit P1-3）。这里复用同一个形状检查，并把规范化的绝对路径注入 wire。
         */
        if (op === 'delete_program') {
          const remote = checkRemotePath(args.remote_path);
          if (!remote.ok) {
            auditRecord({
              ip: args.ip, op, tool_name: toolName, args,
              decision: 'blocked', reason: `PROGRAM_PATH: ${remote.reason}`,
            });
            throw new Error(`[PROGRAM_PATH] ${remote.reason}`);
          }
          wire = { ...wire, _remote_path: remote.path };
        }
        /*
         * ③ 人工审批（可关）。`upload_program` / `delete_program` 也在门禁里：改写或删除机器人上的
         *    程序存储，后果不比一次运动轻，而它们的兄弟 op（`load_program`）早已受门禁。
         *    `download_program` 不在：它只读机器人，并把文件写进本地牢笼。
         */
        if (requireApprovalForMotion && isGatedOp) {
          try {
            await requestApproval(ctx, toolName, op, args, exec);
          } catch (cause) {
            // 拒绝/不可用（fail-closed）都要留痕：账本的价值正在于"这条指令为什么没发出去"。
            auditRecord({
              ip: args.ip,
              op,
              tool_name: toolName,
              args,
              decision: 'denied',
              reason: cause instanceof Error ? cause.message : String(cause),
            });
            throw cause;
          }
          auditRecord({ ip: args.ip, op, tool_name: toolName, args, decision: 'approved' });
        } else if (auditLogAll || isGatedOp) {
          /*
           * 关掉审批（requireApprovalForMotion=false）正是最需要留痕的自主运行模式。
           * 旧实现只在 auditLogAll 时记录，导致 power_off/movej 等在此配置下**零记录**
           * （host-audit P1-6）。现在受门禁 op 一律记 `unchecked`。
           */
          auditRecord({ ip: args.ip, op, tool_name: toolName, args, decision: 'unchecked' });
        }
        /*
         * 运动类 op 的预算与"超时要不要杀子进程"（见 `lib/motion-budget.js`）：
         * - 预算按参数推算（`t=` / `timeout_s` / 力控兜底），不再"60 秒一刀切"；
         * - 运动类 op 一律 `killOnTimeout:false` + `motion:true`：worker 据此维护
         *   `activeMotions`/`motionUnknown`，在运动在飞或状态未知时拒绝杀进程。
         *
         * ⚠️ 这里的集合是 `MOTION_OPS` 而**不是** `APPROVAL_OPS`：`ur_wait_steady` 是
         * `speedj/speedl` 的官方收尾手段，但它不需要审批 —— 旧实现按门禁集合判断，
         * 于是 wait_steady 用 60 s 默认预算，超时杀掉正在运动的 worker（host-audit P0-1）。
         */
        const isMotionOp = MOTION_OPS.has(op);
        const budget = isMotionOp
          ? motionBudgetMs(op, wire, { baseMs: timeoutMs ?? config.commandTimeoutMs })
          : (timeoutMs ?? config.commandTimeoutMs);
        const res = await worker.call(
          op,
          wire,
          budget,
          exec.signal,
          isMotionOp ? { motion: true, killOnTimeout: false } : undefined,
        );
        // Only after a *successful* round-trip: the twin registry is advisory
        // (a stale entry just costs one failed probe; see twin-routes.js).
        if (op === 'connect' && typeof args.ip === 'string') {
          connectedIps.add(args.ip);
          // A reconnect must not inherit the previous robot's memoised model.
          robotModels.delete(args.ip);
        }
        if (op === 'disconnect' && typeof args.ip === 'string') {
          connectedIps.delete(args.ip);
          robotModels.delete(args.ip);
        }
        // Cache the model name the moment an op reports it (op_connect only
        // returns the version/remote state, so this covers get_robot_model and
        // status as well).
        if (typeof args.ip === 'string' && res && typeof res.data === 'object' && res.data !== null) {
          const name = res.data.robot_model;
          if (typeof name === 'string' && name.trim() !== '') {
            robotModels.set(args.ip, name.trim());
          } else if (op === 'disconnect') {
            robotModels.delete(args.ip);
          }
        }
        let text = res?.message ?? String(res);
        if (res?.data !== undefined) {
          text += '\n' + JSON.stringify(res.data, null, 2);
        }
        return text;
      },
    });
  };

  const tools = [
    {
      op: 'connect',
      toolName: 'ur_connect',
      description:
        '连接一台 UR 机器人（按 IP）。任何控制动作前必须先连接。连接成功后该机器人会被记住，后续所有操作只需传同一 IP。注意：机器人须置于远程控制模式下；请在机器人可见、急停可及的前提下操作。',
      parameters: { ip: IP() },
      timeoutMs: config.connectTimeoutMs,
    },
    {
      op: 'disconnect',
      toolName: 'ur_disconnect',
      description: '断开与指定 IP 机器人的连接并释放其资源。',
      parameters: { ip: IP() },
    },
    {
      op: 'status',
      toolName: 'ur_get_status',
      description:
        '一次性读取指定机器人当前的关键状态：TCP 位置、关节角度、型号、序列号、软件版本、安全模式、运行状态、程序状态、电压、电流、关节温度与开机时长。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_tcp_pose',
      toolName: 'ur_get_tcp_pose',
      description: '读取指定机器人的当前 TCP（末端）位置，6 维向量 [x,y,z,rx,ry,rz]。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_joint_pose',
      toolName: 'ur_get_joint_pose',
      description: '读取指定机器人的当前六个关节角度（弧度）。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_robot_model',
      toolName: 'ur_get_robot_model',
      description: '读取指定机器人的型号，并附带是否处于远程控制模式（remote_control 字段）。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_serial_number',
      toolName: 'ur_get_serial_number',
      description: '读取指定机器人的序列号。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_time',
      toolName: 'ur_get_uptime',
      description: '读取指定机器人的开机时长（秒）。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_software_version',
      toolName: 'ur_get_software_version',
      description: '读取指定机器人的 Polyscope 软件版本。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_safety_mode',
      toolName: 'ur_get_safety_mode',
      description: '读取指定机器人的安全模式。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_safety_status',
      toolName: 'ur_get_safety_status',
      description:
        '读取安全/机器人**状态位**与安全模式：能指出是哪一类安全功能被触发（protective stop / safeguard / ' +
        'violation / fault / stopped_due_to_safety ...），是运动撞到安全限值后定位原因的首选工具。' +
        '⚠️ 限值**数值**（力/力矩/功率/动量/速度等上限）不经 RTDE/dashboard 暴露，插件读不到——' +
        '需在 PolyScope 的「设置 → 安全 → 安全限值」页对照（本工具会一并说明这一点）。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_robot_mode',
      toolName: 'ur_get_robot_mode',
      description: '读取指定机器人的运行状态（robotmode）。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_program_state',
      toolName: 'ur_get_program_state',
      description: '读取指定机器人当前加载的程序及其执行状态。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_robot_voltage',
      toolName: 'ur_get_robot_voltage',
      description: '读取指定机器人的主电压（伏特）。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_robot_current',
      toolName: 'ur_get_robot_current',
      description: '读取指定机器人的主电流（安培）。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_joint_temperatures',
      toolName: 'ur_get_joint_temperatures',
      description: '读取指定机器人六个关节的温度（摄氏度）。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_int_register',
      toolName: 'ur_get_int_register',
      description: '读取指定机器人 Int 寄存器（下标 0-23）的值。',
      parameters: {
        ip: IP(),
        index: { type: 'integer', required: true, description: '寄存器下标，范围 [0,23]' },
      },
    },
    {
      op: 'get_double_register',
      toolName: 'ur_get_double_register',
      description: '读取指定机器人 Double 寄存器（下标 0-23）的值。',
      parameters: {
        ip: IP(),
        index: { type: 'integer', required: true, description: '寄存器下标，范围 [0,23]' },
      },
    },
    {
      op: 'get_bit_register',
      toolName: 'ur_get_bit_register',
      description: '读取指定机器人 Bool 寄存器（下标 0-63）的位。',
      parameters: {
        ip: IP(),
        index: { type: 'integer', required: true, description: '寄存器下标，范围 [0,63]' },
      },
    },
    {
      op: 'list_programs',
      toolName: 'ur_list_programs',
      description: '通过 SSH 读取机器人的 .urp 程序列表。优先扫描 /programs（真机默认）；若不存在则自动探测 ~/URSim_Linux-*/programs.*/*.urp（URSim）；也可用 programs_dir 覆盖。⚠️ 不传 password 时用的是内置默认口令 easybot（等同公开凭据），返回值会以 used_default_password 如实回报。⚠️ 默认用 AutoAddPolicy 接受任意主机密钥（无中间人防护）；要严格校验就把机器人指纹写进一个 known_hosts 文件并传 known_hosts。',
      parameters: {
        ip: IP(),
        username: { type: 'string', description: 'SSH 用户名，默认 root' },
        password: { type: 'string', description: 'SSH 密码；不传则用内置默认口令 easybot，并在返回值里以 used_default_password 标出' },
        programs_dir: { type: 'string', description: '覆盖要扫描 .urp 的目录（可选）' },
        known_hosts: {
          type: 'string',
          description:
            '已知主机密钥文件（OpenSSH known_hosts 格式）的路径。传了它就用 RejectPolicy **严格校验**' +
            '机器人指纹；不传则为兼容常见场景（机器人主机密钥通常未知）沿用 AutoAddPolicy 并在' +
            'host_key_policy 里如实回报。文件不存在会直接报错，不会静默退回 auto-add',
        },
      },
    },
    {
      op: 'upload_program',
      toolName: 'ur_upload_program',
      description:
        '把一个本地 `.urp` 程序文件**上传到机器人**（SFTP），上传后**回读远端大小核对**，一致才报成功。' +
        '⚠️ 本地路径被锁在 `programDir`（默认 `<DSH_HOME>/nonead-ur/programs`）里：绝对路径必须落在其中，' +
        '相对路径按它解析，`..` 与指向目录外的软链一律拒绝 —— 没有这道牢笼，模型就能让插件把本机任意文件送到机器人上。' +
        '远端必须是机器人上的绝对路径（如 `/programs/pick.urp`）。' +
        '⚠️ 受运动审批门禁：它会改写机器人上的程序存储。写不进去（目录只读 / 被示教器占用）会如实报错。',
      parameters: {
        ip: IP(),
        local_path: { type: 'string', required: true, description: '本地 .urp 路径（相对 programDir，或 programDir 内的绝对路径）' },
        remote_path: { type: 'string', required: true, description: '机器人上的绝对路径，例如 /programs/pick.urp' },
        username: { type: 'string', description: 'SSH 用户名，默认 root' },
        password: { type: 'string', description: 'SSH 密码；不传则用内置默认口令 easybot（等同公开凭据）' },
        known_hosts: { type: 'string', description: '已知主机密钥文件路径；传了就 RejectPolicy 严格校验指纹，不传则 auto-add（无中间人防护）' },
      },
    },
    {
      op: 'download_program',
      toolName: 'ur_download_program',
      description:
        '把机器人上的一个 `.urp` **下载到本地**（SFTP），下载后**回读本地大小核对**。' +
        '⚠️ 目标文件已存在时**先备份成 `<path>.bak` 再写**，绝不静默覆盖（覆盖掉的可能是还有用的程序）；' +
        '备份失败就拒绝下载。本地路径同样被锁在 `programDir`（默认 `<DSH_HOME>/nonead-ur/programs`）内。' +
        '**不受**运动审批门禁：它只读机器人，并把文件写进本地牢笼。',
      parameters: {
        ip: IP(),
        remote_path: { type: 'string', required: true, description: '机器人上的绝对路径，例如 /programs/pick.urp' },
        local_path: { type: 'string', required: true, description: '本地目标路径（相对 programDir，或其中的绝对路径）' },
        username: { type: 'string', description: 'SSH 用户名，默认 root' },
        password: { type: 'string', description: 'SSH 密码；不传则用内置默认口令 easybot（等同公开凭据）' },
        known_hosts: { type: 'string', description: '已知主机密钥文件路径；传了就 RejectPolicy 严格校验指纹，不传则 auto-add（无中间人防护）' },
      },
    },
    {
      op: 'delete_program',
      toolName: 'ur_delete_program',
      description:
        '删除机器人上的一个 `.urp`。**先确认它存在、删除后再确认真的没了**（删除后 stat 不到才算成功）——' +
        '不靠"命令已发送"。远端路径必须是绝对路径、不含 `..`。⚠️ 受运动审批门禁：删掉一个程序是不可逆的。',
      parameters: {
        ip: IP(),
        remote_path: { type: 'string', required: true, description: '机器人上的绝对路径，例如 /programs/old.urp' },
        username: { type: 'string', description: 'SSH 用户名，默认 root' },
        password: { type: 'string', description: 'SSH 密码；不传则用内置默认口令 easybot（等同公开凭据）' },
        known_hosts: { type: 'string', description: '已知主机密钥文件路径；传了就 RejectPolicy 严格校验指纹，不传则 auto-add（无中间人防护）' },
      },
    },
    {
      op: 'popup_message',
      toolName: 'ur_popup',
      description:
        '在**示教器**上弹一条消息（dashboard `popup <text>`）—— 让机器人"开口"告诉现场下一步要做什么。' +
        '⚠️ 这是**模态**提示框，需要有人点掉；同一时刻面板上只显示一个，要换内容先用 `ur_close_popup`。' +
        '它不会让机械臂运动，因此**不受运动审批门禁**。' +
        '⚠️ 文本经过注入校验：含换行/回车会被**拒绝**（dashboard 按行解析命令，换行等于注入另一条命令），' +
        '长度上限 300 字符。',
      parameters: {
        ip: IP(),
        text: { type: 'string', required: true, description: '弹窗正文（单行，≤300 字符）' },
      },
    },
    {
      op: 'close_popup',
      toolName: 'ur_close_popup',
      description: '关闭**示教器**上当前显示的弹窗（dashboard `close popup`）。无可关的弹窗时如实报错，不假装成功。',
      parameters: { ip: IP() },
    },
    {
      op: 'add_log',
      toolName: 'ur_add_log',
      description:
        '往**控制器的日志历史**里写一条消息（dashboard `addToLog <text>`），操作员在示教器的日志页能看到。' +
        '⚠️ 它会在控制器上**留下永久痕迹** —— 这正是它的用途（出了问题能把"当时是谁让它做了什么"对上），' +
        '所以**不要**把密钥、口令等不该留痕的内容写进去。⚠️ 同样有换行注入校验与 300 字符上限，' +
        '且不会让机械臂运动、**不受运动审批门禁**。',
      parameters: {
        ip: IP(),
        text: { type: 'string', required: true, description: '要写进控制器日志的一行（单行，≤300 字符）' },
      },
    },
    {
      op: 'modbus_add_signal',
      toolName: 'ur_modbus_add_signal',
      description:
        '添加一个控制器要监管的 **Modbus 信号**（URScript `modbus_add_signal`）。' +
        '`signal_type`：0 数字输入 / 1 数字输出 / 2 寄存器输入 / 3 寄存器输出；同名信号会被替换。' +
        '⚠️ 手册明确这条命令 **expects no response** —— 工具能证明的只有"这段 URScript 在控制器上执行完毕"' +
        '（首尾哨兵），**不**证明 PLC 收到了（返回值里 `fieldbus_confirmed: false`）。' +
        '⚠️ 受运动审批门禁：它改变控制器监管的现场总线点位。' +
        '⚠️ 信号名经**白名单**校验（它会被拼进 URScript 字符串字面量，引号/换行等于注入脚本）。',
      parameters: {
        ip: IP(),
        unit_ip: { type: 'string', required: true, description: 'Modbus 单元的 IPv4 地址，例如 192.168.1.10' },
        slave_number: { type: 'integer', description: '从站号 0-255（默认 255）' },
        signal_address: { type: 'integer', required: true, description: '线圈/寄存器地址（0-65535）' },
        signal_type: { type: 'integer', required: true, description: '0 数字输入 / 1 数字输出 / 2 寄存器输入 / 3 寄存器输出' },
        signal_name: { type: 'string', required: true, description: '信号名（字母/数字/下划线/点/连字符/空格，≤64 字符）' },
      },
    },
    {
      op: 'modbus_delete_signal',
      toolName: 'ur_modbus_delete_signal',
      description:
        '删除一个已添加的 Modbus 信号（URScript `modbus_delete_signal`）。' +
        '⚠️ 同样只有"脚本执行完毕"这层证据（Modbus 无应答）。' +
        '⚠️ 受运动审批门禁：删掉一个正在被现场逻辑使用的点位是不可逆的。',
      parameters: {
        ip: IP(),
        signal_name: { type: 'string', required: true, description: '要删除的信号名' },
      },
    },
    {
      op: 'modbus_get_signal_status',
      toolName: 'ur_modbus_get_signal_status',
      description:
        '读一个 Modbus 信号的当前值（URScript `modbus_get_signal_status`）—— Modbus 系列里**唯一**有真正' +
        '回读的工具：值经输出寄存器在首尾哨兵之间回读，读不到就报错，绝不给一个无法担保的数字。' +
        '⚠️ 必须显式声明 `kind`：URScript 是强类型的（数字信号返回 true/false、寄存器信号返回无符号整数），' +
        '两种返回值没法用同一段脚本安全回写，所以工具不猜。`kind` 声明错时脚本会在控制器上中止（报 NOT_EXECUTED）。' +
        '⚠️ 不受运动审批门禁（只读）。',
      parameters: {
        ip: IP(),
        signal_name: { type: 'string', required: true, description: '信号名' },
        kind: { type: 'string', description: "digital（数字信号 ⇒ true/false）或 register（寄存器信号 ⇒ 无符号整数）；默认 register" },
      },
    },
    {
      op: 'modbus_send_custom_command',
      toolName: 'ur_modbus_send_custom_command',
      description:
        '向 Modbus 单元发一条自定义命令（URScript `modbus_send_custom_command`）。' +
        '`data` 是字节数组，每项 0-255；控制器负责拼 Modbus 帧。' +
        '例：手册里给 Beckhoff BK9050 设 600 ms 看门狗 = `function_code: 6`、`data: [17,32,2,88]`。' +
        '⚠️ 手册明确**收不到应答**（"cannot be used to request data, since the response will not be received"），' +
        '且 data 是否对该 function_code 有意义完全由调用方负责。' +
        '⚠️ 受运动审批门禁：它能直接驱动 PLC。',
      parameters: {
        ip: IP(),
        unit_ip: { type: 'string', required: true, description: 'Modbus 单元的 IPv4 地址' },
        slave_number: { type: 'integer', required: true, description: '从站号 0-255' },
        function_code: { type: 'integer', required: true, description: 'Modbus 功能码 1-127' },
        data: numberArray({ type: 'integer' }, '字节数组，每项 0-255，最多 64 字节（例：[17, 32, 2, 88]）', true),
      },
    },
    {
      op: 'modbus_set_output_register',
      toolName: 'ur_modbus_set_output_register',
      description:
        '把一个 Modbus 输出寄存器信号设成给定值（URScript `modbus_set_output_register`，值 0-65535）。' +
        '⚠️ 只有"脚本执行完毕"这层证据；⚠️ 受运动审批门禁（直接驱动 PLC）。',
      parameters: {
        ip: IP(),
        signal_name: { type: 'string', required: true, description: '已添加的输出寄存器信号名' },
        register_value: { type: 'integer', required: true, description: '要写入的值 0-65535' },
      },
    },
    {
      op: 'modbus_set_output_signal',
      toolName: 'ur_modbus_set_output_signal',
      description:
        '把一个 Modbus 输出数字信号设成 true/false（URScript `modbus_set_output_signal`）。' +
        '⚠️ 只有"脚本执行完毕"这层证据；⚠️ 受运动审批门禁（直接驱动 PLC）。',
      parameters: {
        ip: IP(),
        signal_name: { type: 'string', required: true, description: '已添加的输出数字信号名' },
        digital_value: { type: 'boolean', required: true, description: 'true 置高 / false 置低' },
      },
    },
    {
      op: 'modbus_set_runstate_dependent_choice',
      toolName: 'ur_modbus_set_runstate_dependent_choice',
      description:
        '设置一个输出信号在**程序未运行**时的行为（URScript `modbus_set_runstate_dependent_choice`）：' +
        '0 保持程序状态 / 1 程序停止时置低 / 2 程序停止时置高。' +
        '⚠️ 它改的是该信号的行为，不会立刻驱动现场设备，因此**不受**运动审批门禁。',
      parameters: {
        ip: IP(),
        signal_name: { type: 'string', required: true, description: '输出数字信号名' },
        runstate_choice: { type: 'integer', required: true, description: '0 保持 / 1 置低 / 2 置高' },
      },
    },
    {
      op: 'modbus_set_signal_update_frequency',
      toolName: 'ur_modbus_set_signal_update_frequency',
      description:
        '设置机器人读写该 Modbus 信号的刷新频率（URScript `modbus_set_signal_update_frequency`，0-125 Hz；0 = 关闭刷新）。' +
        '⚠️ 不改现场设备的值，因此**不受**运动审批门禁。',
      parameters: {
        ip: IP(),
        signal_name: { type: 'string', required: true, description: '信号名' },
        update_frequency: { type: 'integer', required: true, description: '刷新频率 0-125 Hz' },
      },
    },
    {
      op: 'move_force',
      toolName: 'ur_move_force',
      description:
        '**力控引导运动（力控装配核心）**：让机械臂在**力控模式**下朝目标位姿运动，碰到工件就停。' +
        '一次 URScript 交给控制器跑完：`force_mode(...)` → `movel(...)` → `stopl(...)` → `end_force_mode()`。' +
        '⚠️ 为何不是 vendored 的 `move_force_2stop`：那个靠 RTDE **输入**寄存器每 8 ms 推 wrench 来持续施力，' +
        '而本插件刻意没有 send 配方（那些输入字段在这里 claim 不了，claim 会让控制器抛异常并崩掉 RTDE 接收线程）。' +
        '本工具因此把"持续施力 + 沿轨迹前进"整段交给控制器的 force_mode 自己完成，再用**只读** RTDE 读运动前后的' +
        '实际位姿，据此判断是否提前停下。' +
        '⚠️ 受运动审批门禁；力/力矩还受安全闸 safetyMaxForceN / safetyMaxTorqueNm 限制，目标位姿受 safetyWorkspace ' +
        '与线速度上限约束。' +
        '⚠️ 「停在目标之前」只能说明它没走到目标（力控被挡住时会如此），**不能**证明力真的压到了工件上；' +
        '返回值会连 stopped_due_to_safety 一起给出，但不替你区分「被力/力矩限值止住」与「被安全停止/程序被停」。',
      parameters: {
        ip: IP(),
        pose: numberArray({ type: 'number' }, '目标 TCP 位姿 [x,y,z,rx,ry,rz]（米 / 弧度）', true),
        selection_vector: numberArray(
          { type: 'integer' },
          '6 个 0/1：1 = 该轴柔性（做力控），0 = 刚性；例如只沿 z 做力控 = [0,0,1,0,0,0]',
          true,
        ),
        wrench: numberArray(
          { type: 'number' },
          '要施加的力/力矩 [Fx,Fy,Fz,Tx,Ty,Tz]（N / N·m）：柔性轴 = 要去达到的力，刚性轴 = 要抵消的外力',
          true,
        ),
        task_frame: numberArray({ type: 'number' }, '力坐标系位姿（相对基座；默认全 0 = 基座系）', false),
        limits: numberArray(
          { type: 'number' },
          '6 维限制：柔性轴 = 最大 TCP 速度，刚性轴 = 最大位置偏差（默认 [0.1,0.1,0.1,0.1,0.1,0.1]）',
          false,
        ),
        f_type: { type: 'integer', description: '力坐标系的解释方式：1 / 2（默认）/ 3' },
        a: { type: 'number', description: '加速度（必须 > 0，默认 1.2）' },
        v: { type: 'number', description: '速度（必须 > 0，默认 0.25 m/s）' },
        r: { type: 'number', description: '交融半径（≥ 0，默认 0）' },
      },
    },
    {
      op: 'pose_save',
      toolName: 'ur_save_pose',
      description:
        '把**当前姿态**或给定数值存成一个**有名字的位姿**（一位姿一文件，存在本机 `poseDir` 下），供以后复用。' +
        '不给 `pose`/`joints` 时改为从机器人当前姿态捕获（此时必须给 `ip`，会同时记下 TCP 位姿与关节角）。' +
        '同名会**更新**（返回值里看 `replaced`）。' +
        '⚠️ 名字会变成文件名，所以走白名单校验（支持中文，但不得含路径分隔符、不得是 Windows 保留设备名）；' +
        '写盘是"临时文件 + 原子替换"，写完还会**回读核对**，不一致就报 `VERIFY_FAILED`。' +
        '⚠️ 不受审批门禁：它不动机器人，只在本机写一个小 JSON。',
      parameters: {
        ip: { type: 'string', description: '只在"从机器人当前姿态捕获"时需要（不给 pose/joints 时必须给）' },
        name: { type: 'string', required: true, description: '位姿名（字母/数字/下划线/点/连字符/空格，可中文，≤64 字符）' },
        pose: numberArray({ type: 'number' }, '要保存的 TCP 位姿 [x,y,z,rx,ry,rz]（与 joints 至少给一个）', false),
        joints: numberArray({ type: 'number' }, '要保存的关节角（6 个，弧度）', false),
      },
      prepare: (args) => {
        const capture = args.pose === undefined && args.joints === undefined;
        // 首次保存时把插件自己的数据目录建出来（与审计账本同做法），而不是要求用户手工 mkdir。
        const made = ensurePoseDir(poseDir);
        if (!made.ok) return { ok: false, code: 'POSE_DIR', reason: made.reason };
        const checked = checkPoseForSave({
          name: args.name, pose: args.pose, joints: args.joints, capture, root: made.dir,
        });
        if (!checked.ok) return { ok: false, code: 'POSE_NAME', reason: checked.reason };
        if (capture && typeof args.ip !== 'string') {
          return {
            ok: false,
            code: 'POSE_ARGS',
            reason: '要从机器人当前姿态捕获时必须给出 ip；或者直接给出 pose / joints',
          };
        }
        const counted = countPoses(checked.dir, { name: checked.name });
        if (!counted.ok) return { ok: false, code: 'POSE_DIR', reason: counted.reason };
        const quota = checkPoseQuota(counted.count, maxPoses, { existing: Boolean(counted.existing) });
        if (!quota.ok) return { ok: false, code: 'POSE_QUOTA', reason: quota.reason };
        return {
          ok: true,
          wire: {
            _path: checked.path, _pose_count: counted.count, _max_poses: maxPoses, _capture: capture,
          },
        };
      },
    },
    {
      op: 'pose_get',
      toolName: 'ur_get_pose',
      description:
        '读回一条已保存的命名位姿（TCP 位姿 + 关节角 + 保存时间）。' +
        '⚠️ 「不存在」与「损坏」是两种不同的回答：前者说明这个名字没存过，后者说明**存过但文件坏了** —— ' +
        '回报里会带上 `pose_well_formed` / `joints_well_formed`，手工改坏的文件不会被当成可用位姿。' +
        '⚠️ 把它拿去运动，请走两步：先 `ur_get_pose` 拿到数值，再 `ur_movel` —— 这样安全闸与审批门禁' +
        '看得到真实数字（本插件刻意不提供"按名字直接运动"，因为那样数值对门禁不可见）。',
      parameters: {
        name: { type: 'string', required: true, description: '位姿名' },
      },
      prepare: (args) => {
        const target = resolvePosePath(args.name, { root: poseDir });
        if (!target.ok) return { ok: false, code: 'POSE_NAME', reason: target.reason };
        return { ok: true, wire: { _path: target.path } };
      },
    },
    {
      op: 'pose_list',
      toolName: 'ur_list_poses',
      description:
        '列出位姿表里已保存的位姿（只列 `*.json`）。可用 `filter` 按名字模糊筛选（对中文名也有效）。' +
        '⚠️ 单个条目损坏**不会**让整张表失败：坏的那个按条目回报 `ok: false` 与原因，其余照常列出，' +
        '并在 `broken` 里给出文件名清单。目录还不存在时回报"还没有保存过任何位姿"，而不是报错。',
      parameters: {
        filter: { type: 'string', description: '可选：按名字模糊筛选（大小写不敏感的子串匹配）' },
      },
      prepare: () => ({ ok: true, wire: { _dir: poseDir } }),
    },
    {
      op: 'pose_delete',
      toolName: 'ur_delete_pose',
      description:
        '删除一条已保存的命名位姿。**先确认存在、删完再确认真的没了**（与删除程序文件同一纪律）。' +
        '⚠️ 不受审批门禁（只删本机一个小 JSON），但**不可逆** —— 删掉就只能重新示教/重新保存。',
      parameters: {
        name: { type: 'string', required: true, description: '位姿名' },
      },
      prepare: (args) => {
        const target = resolvePosePath(args.name, { root: poseDir });
        if (!target.ok) return { ok: false, code: 'POSE_NAME', reason: target.reason };
        return { ok: true, wire: { _path: target.path } };
      },
    },
    {
      op: 'send_script',
      toolName: 'ur_send_script',
      description:
        '向指定机器人发送一段 URScript 脚本并执行（用于自定义动作、I/O、逻辑等）。' +
        '⚠️ 本工具会**校验执行结果**：在「真正会被执行的那段代码」前后各注入一行哨兵写寄存器并回读——' +
        '脚本含 `def … end` 时注入到**函数体内部**（第一句/最后一句，绝不拼到顶层，否则会把脚本变成' +
        '「函数体不跑、顶层照跑」并报出假阳性）；纯语句脚本才用顶层注入。结论分三种：' +
        '「已执行完毕」/「已开始执行但未在预算内结束」/「连起始哨兵都没观察到（控制器很可能根本没执行，' +
        '最常见原因是未处于远程控制模式：本地/示教器模式下 URScript 会被静默丢弃）」。' +
        '**不要仅凭「已发送」就认为动作生效**。⚠️ 会驱动机械臂运动。',
      parameters: {
        ip: IP(),
        script: { type: 'string', required: true, description: 'URScript 脚本内容' },
        verify: {
          type: 'boolean',
          default: true,
          description:
            '是否做执行校验（默认 true）。传 false 时只发送不校验，返回的 verified 为 null——' +
            '那表示"未确认"，不等于成功；脚本本身是阻塞/长动作时可用它跳过',
        },
        register: {
          type: 'number',
          description:
            '用哪个 int 输出寄存器做哨兵（0-23，默认 23）。注意该寄存器的旧值会被覆盖，' +
            '脚本运行期间也不要把它当自己的数据寄存器用',
        },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'movej',
      toolName: 'ur_movej',
      description:
        '让指定机器人的每个关节都转到指定弧度（关节空间运动）。q 为 6 个弧度。⚠️ 会驱动机械臂运动，请确保机器人可见且无人员/障碍物。',
      parameters: {
        ip: IP(),
        q: numberArray({ type: 'number' }, '六个关节目标角度（弧度）：[q0,q1,q2,q3,q4,q5]'),
        ...MOVE_PARAMS(),
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'movel',
      toolName: 'ur_movel',
      description:
        '让指定机器人的 TCP 直线移动到目标位置（笛卡尔空间直线运动）。pose 为 6 维 [x,y,z,rx,ry,rz]。⚠️ 会驱动机械臂运动，请确保机器人可见且无人员/障碍物。',
      parameters: {
        ip: IP(),
        pose: numberArray({ type: 'number' }, '目标 TCP 位置：[x,y,z,rx,ry,rz]'),
        ...MOVE_PARAMS(),
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'move_x',
      toolName: 'ur_move_x',
      description: '让指定机器人的 TCP 沿基座 X 轴移动指定距离（直线）。⚠️ 会驱动机械臂运动。',
      parameters: { ip: IP(), distance: AXIS_MOTION_DISTANCE() },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'move_y',
      toolName: 'ur_move_y',
      description: '让指定机器人的 TCP 沿基座 Y 轴移动指定距离（直线）。⚠️ 会驱动机械臂运动。',
      parameters: { ip: IP(), distance: AXIS_MOTION_DISTANCE() },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'move_z',
      toolName: 'ur_move_z',
      description: '让指定机器人的 TCP 沿基座 Z 轴移动指定距离（直线）。⚠️ 会驱动机械臂运动。',
      parameters: { ip: IP(), distance: AXIS_MOTION_DISTANCE() },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'move_tool_x',
      toolName: 'ur_move_tool_x',
      description:
        '让指定机器人的 TCP 沿**工具坐标系** X 轴移动指定距离（直线）。与 ur_move_x 的区别：那个是基座方向，这个是当前工具朝向的方向——工具斜着的时候两者完全不同。⚠️ 会驱动机械臂运动。',
      parameters: { ip: IP(), distance: AXIS_MOTION_DISTANCE() },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'move_tool_y',
      toolName: 'ur_move_tool_y',
      description:
        '让指定机器人的 TCP 沿**工具坐标系** Y 轴移动指定距离（直线）。与 ur_move_y 的区别：那个是基座方向，这个是当前工具朝向的方向。⚠️ 会驱动机械臂运动。',
      parameters: { ip: IP(), distance: AXIS_MOTION_DISTANCE() },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'move_tool_z',
      toolName: 'ur_move_tool_z',
      description:
        '让指定机器人的 TCP 沿**工具坐标系** Z 轴移动指定距离（直线，工具 Z 正向通常是从法兰指向工具末端）。与 ur_move_z 的区别：那个是基座方向，这个是当前工具朝向的方向。⚠️ 会驱动机械臂运动。',
      parameters: { ip: IP(), distance: AXIS_MOTION_DISTANCE() },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'draw_circle',
      toolName: 'ur_draw_circle',
      description:
        '让指定机器人以给定圆心与半径画一个圆。coordinate 为 "z"（竖直平面，与基座垂直）或其它（水平平面）。⚠️ 会驱动机械臂运动。',
      parameters: {
        ip: IP(),
        center: numberArray({ type: 'number' }, '圆心 TCP 位置：[x,y,z,rx,ry,rz]'),
        r: { type: 'number', required: true, description: '半径（米，必须 >0）' },
        coordinate: { type: 'string', description: '平面："z" 或其它，默认 "z"' },
        register: {
          type: 'number',
          description:
            '用哪个 int 输出寄存器做「脚本是否被执行」的哨兵（0-23，默认 23）。该寄存器旧值会被覆盖；' +
            '控制器未执行该脚本时会立刻报 NOT_EXECUTED，而不是干等到超时',
        },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'draw_square',
      toolName: 'ur_draw_square',
      description:
        '让指定机器人以给定起点与边长画一个正方形。⚠️ 会驱动机械臂运动。',
      parameters: {
        ip: IP(),
        origin: numberArray({ type: 'number' }, '起点 TCP 位置：[x,y,z,rx,ry,rz]'),
        border: { type: 'number', required: true, description: '边长（米，必须 >0）' },
        coordinate: { type: 'string', description: '平面："z" 或其它，默认 "z"' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'draw_rectangle',
      toolName: 'ur_draw_rectangle',
      description:
        '让指定机器人以给定起点、宽和高画一个长方形。⚠️ 会驱动机械臂运动。',
      parameters: {
        ip: IP(),
        origin: numberArray({ type: 'number' }, '起点 TCP 位置：[x,y,z,rx,ry,rz]'),
        width: { type: 'number', required: true, description: '长（米，必须 >0）' },
        height: { type: 'number', required: true, description: '宽（米，必须 >0）' },
        coordinate: { type: 'string', description: '平面："z" 或其它，默认 "z"' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'draw_star',
      toolName: 'ur_draw_star',
      description:
        '让指定机器人以给定中心与边长画一个五角星（pentagram）。center 为其中心位姿；side 为每条边长度（米）。⚠️ 会驱动机械臂运动。',
      parameters: {
        ip: IP(),
        center: numberArray({ type: 'number' }, '中心 TCP 位置：[x,y,z,rx,ry,rz]'),
        side: { type: 'number', required: true, description: '边长（米，必须 >0）' },
        coordinate: { type: 'string', description: '平面："z"（竖直 y-z）或其它（水平 x-y）；默认水平' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'load_program',
      toolName: 'ur_load_program',
      description: '加载指定机器人的一个 UR 程序（.urp）。加载后需再用 run 启动。program_name 可传文件名或完整/URSim 路径，可用 programs_dir 拼接。',
      parameters: {
        ip: IP(),
        program_name: { type: 'string', required: true, description: '程序名（.urp）或完整/相对路径（如 URSim 路径）' },
        programs_dir: { type: 'string', description: '程序目录（可选）；program_name 为纯文件名时用其拼接为路径' },
      },
    },
    {
      op: 'run_program',
      toolName: 'ur_run_program',
      description: '运行指定机器人当前加载的程序；若提供 program_name 则先加载再运行。program_name 可传文件名或完整/URSim 路径，可用 programs_dir 拼接。⚠️ 会驱动机械臂运动。',
      parameters: {
        ip: IP(),
        program_name: { type: 'string', description: '可选：程序名（.urp）或路径；不传则运行当前加载的程序' },
        programs_dir: { type: 'string', description: '程序目录（可选）；program_name 为纯文件名时用其拼接为路径' },
      },
    },
    {
      op: 'stop_program',
      toolName: 'ur_stop_program',
      description: '停止指定机器人当前运行的程序。',
      parameters: { ip: IP() },
    },
    {
      op: 'pause_program',
      toolName: 'ur_pause_program',
      description: '暂停指定机器人当前运行的程序。',
      parameters: { ip: IP() },
    },
    {
      op: 'reset_error',
      toolName: 'ur_reset_error',
      description: '复位指定机器人的错误并释放刹车（若需要则先上电）。⚠️ 复位后机械臂可能保持当前姿态，操作前确认安全。',
      parameters: { ip: IP() },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'ping',
      toolName: 'ur_ping',
      description: '健康检查：确认 UR 控制 worker 进程存活、Python 依赖与 vendored URBasic 就绪（无需连接机器人）。',
      parameters: {},
    },
    {
      op: 'get_digital_in',
      toolName: 'ur_get_digital_in',
      description: '读取指定机器人某路数字输入。which 为 std(默认)/config/tool。注意：tool 端数字输入不经 RTDE，通过 URScript 读取（会发送一段短程序到机器人，可能打断正在运行的程序）。',
      parameters: {
        ip: IP(),
        which: { type: 'string', description: '输入类型：std(默认)/config/tool' },
        n: { type: 'integer', required: true, description: '端口号：std 0-7、config 8-15、tool 0-1' },
      },
    },
    {
      op: 'set_digital_out',
      toolName: 'ur_set_digital_out',
      description: '设置指定机器人某路数字输出为高/低。⚠️ 会触发机器人 I/O。',
      parameters: {
        ip: IP(),
        which: { type: 'string', description: '输出类型：std(默认)/config/tool' },
        n: { type: 'integer', required: true, description: '端口号：std 0-7、config 8-15、tool 0-1' },
        value: { type: 'boolean', required: true, description: 'true 高电平 / false 低电平' },
      },
    },
    {
      op: 'get_analog_in',
      toolName: 'ur_get_analog_in',
      description: '读取指定机器人的标准模拟输入值。',
      parameters: {
        ip: IP(),
        n: { type: 'integer', required: true, description: '端口号（0 或 1）' },
      },
    },
    {
      op: 'set_analog_out',
      toolName: 'ur_set_analog_out',
      description:
        '设置指定机器人的标准模拟输出值，**按工程单位**（默认伏特）收值：URScript 的 `set_analog_out(n, f)` 收的是相对电平 [0,1]，' +
        '本工具按 `full_scale` 换算后下发，并把换算前后的值与回读值都返回，便于核对。' +
        '⚠️ 端口是**电压域**时 `full_scale=10`（默认），是**电流域**时必须显式给 `full_scale=20`，否则 10 以上的工程值会被拒绝。',
      parameters: {
        ip: IP(),
        n: { type: 'integer', required: true, description: '端口号（0 或 1）' },
        value: { type: 'number', required: true, description: '输出值（工程单位：伏特 0-10，或电流域 0-20）' },
        full_scale: {
          type: 'number',
          description: '满量程：电压域 10（默认），电流域 20 —— 决定 value 如何换算成 URScript 的相对电平',
        },
      },
    },
    {
      op: 'set_tool_voltage',
      toolName: 'ur_set_tool_voltage',
      description: '设置指定机器人的工具电压（0V / 12V / 24V）。',
      parameters: {
        ip: IP(),
        voltage: { type: 'integer', required: true, description: '工具电压：0/12/24' },
      },
    },
    {
      op: 'set_tcp',
      toolName: 'ur_set_tcp',
      description: '设置指定机器人的 TCP（工具中心点），6 维位姿 [x,y,z,rx,ry,rz]。',
      parameters: {
        ip: IP(),
        pose: numberArray({ type: 'number' }, 'TCP 位姿：[x,y,z,rx,ry,rz]'),
      },
    },
    {
      op: 'set_payload',
      toolName: 'ur_set_payload',
      description: '设置指定机器人的负载质量（kg）与重心（cog，3 维）。',
      parameters: {
        ip: IP(),
        mass: { type: 'number', required: true, description: '负载质量（kg）' },
        cog: { type: 'array', items: { type: 'number' }, description: '重心 [x,y,z]，默认 [0,0,0]' },
      },
    },
    {
      op: 'movep',
      toolName: 'ur_movep',
      description: '让指定机器人沿路径移动到目标位姿（带交融）。⚠️ 会驱动机械臂运动。',
      parameters: {
        ip: IP(),
        pose: numberArray({ type: 'number' }, '目标 TCP 位姿：[x,y,z,rx,ry,rz]'),
        a: { type: 'number', description: '加速度，必须 >0，默认 1.2' },
        v: { type: 'number', description: '速度，必须 >0，默认 0.25' },
        r: { type: 'number', description: '交融半径，≥0，默认 0' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'movec',
      toolName: 'ur_movec',
      description: '让指定机器人做圆弧运动（经 via 点到达 to 点）。⚠️ 会驱动机械臂运动。mode=0（默认）沿途插补姿态，mode=1 姿态相对圆弧切线保持不变（固定姿态圆弧）。',
      parameters: {
        ip: IP(),
        pose_via: numberArray({ type: 'number' }, '途经点 TCP 位姿：[x,y,z,rx,ry,rz]（手册：只用到位置）'),
        pose_to: numberArray({ type: 'number' }, '目标 TCP 位姿：[x,y,z,rx,ry,rz]'),
        a: { type: 'number', description: '加速度，必须 >0，默认 1.2' },
        v: { type: 'number', description: '速度，必须 >0，默认 0.25' },
        r: { type: 'number', description: '交融半径，≥0，默认 0' },
        mode: { type: 'integer', description: '0 插补姿态（默认）/ 1 固定姿态（相对圆弧切线）' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'servoj',
      toolName: 'ur_servoj',
      description: '向指定机器人下发一个 servoj 连续流关节目标（在线控制单步，需在循环里持续下发以平滑跟踪）。⚠️ 会驱动机械臂运动。',
      parameters: {
        ip: IP(),
        q: numberArray({ type: 'number' }, '六个目标关节角（弧度）'),
        t: { type: 'number', description: '控制时长（秒），≥0，默认 0.008' },
        lookahead_time: { type: 'number', description: '前瞻时间，范围 0.03-0.2，默认 0.1' },
        gain: { type: 'integer', description: '比例增益，范围 100-2000，默认 100' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'get_digital_input_bits',
      toolName: 'ur_get_digital_in_bits',
      description: '批量读取指定机器人的数字输入位（std 0-7 + config 8-15）。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_digital_output_bits',
      toolName: 'ur_get_digital_out_bits',
      description: '批量读取指定机器人的数字输出位（std 0-7 + config 8-15）。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_conveyor',
      toolName: 'ur_get_conveyor',
      description:
        '读取指定机器人的传送带 tick 计数。' +
        '工具数字输入不经 RTDE，这里的 tick 也只能靠控制器执行一段 URScript 取回，所以本工具会' +
        '**自证那段脚本真的被执行过**：先在 int 哨兵寄存器上写一个记号，再让脚本把 tick 写进 ' +
        'double 寄存器，并在首尾各写一个哨兵。三种结局分开报 —— 完整执行（给 tick 值）、' +
        '执行到一半（不给值）、压根没执行（不给值并说明原因）。' +
        '之所以必须如此：脚本被控制器**在加载期拒收**时一行都不会执行，也不会置"程序执行错误"' +
        '标志，旧实现于是照样回读寄存器，把从没被写过的值当成 tick 报出去（历史上它长期静默返回 0）。' +
        '⚠️ 该 int 与 double 寄存器的旧值会被覆盖。',
      parameters: {
        ip: IP(),
        register: { type: 'integer', description: '哨兵用的 int 输出寄存器编号（0-23），默认 20' },
        payload_register: { type: 'integer', description: '写 tick 用的 double 输出寄存器编号（0-23），默认 0' },
      },
    },
    {
      op: 'set_conveyor_tick',
      toolName: 'ur_set_conveyor_tick',
      description: '设置指定机器人的传送带 tick 计数（及可选编码器分辨率）。',
      parameters: {
        ip: IP(),
        tick_count: { type: 'integer', required: true, description: '目标 tick 数' },
        absolute_encoder_resolution: { type: 'integer', description: '绝对编码器分辨率，默认 0' },
      },
    },
    // ── 0.5.0 新增能力 ─────────────────────────────────────────────────────
    // 控制模式 / 电源 / 安全。全部在 APPROVAL_OPS 里：它们都能让机械臂脱离程序的
    // 控制、或失去刚性支撑（见该集合的注释）。
    {
      op: 'set_freedrive',
      toolName: 'ur_set_freedrive',
      description:
        '开启/关闭**自由驱动（freedrive）**：开启后可**用手直接拖动机械臂**（重力被补偿，拖起来有"漂浮"感）。' +
        '⚠️ 会接管控制模式：开启期间运动指令不会执行；请确认机械臂周围无人、无夹伤风险，' +
        '退出方式是在示教器/面板上停止程序（或调用本工具 enable=false）。',
      parameters: {
        ip: IP(),
        enabled: { type: 'boolean', default: true, description: 'true 开启（默认），false 结束并恢复正常位置控制' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'set_teach_mode',
      toolName: 'ur_set_teach_mode',
      description:
        '开启/关闭**示教模式（teach）**：与 freedrive 类似，用于手动示教路径点。⚠️ 同样会接管控制模式；enable=false 结束。',
      parameters: {
        ip: IP(),
        enabled: { type: 'boolean', default: true, description: 'true 开启（默认），false 结束' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'power_on',
      toolName: 'ur_power_on',
      description: '给指定机器人上电（使能电机/抱闸）。⚠️ 上电后机械臂立即具备刚性，请确认当前姿态与周围环境安全。',
      parameters: { ip: IP() },
    },
    {
      op: 'power_off',
      toolName: 'ur_power_off',
      description: '给指定机器人下电。⚠️ 下电后机械臂**失去刚性支撑**，可能因重力下落——务必先托住或确认姿态安全。',
      parameters: { ip: IP() },
    },
    {
      op: 'brake_release',
      toolName: 'ur_brake_release',
      description: '释放指定机器人的刹车。⚠️ 释放后机械臂**可能在重力作用下掉落**：请先托住机械臂，并确认下方无人、无障碍物。',
      parameters: { ip: IP() },
    },
    {
      op: 'unlock_protective_stop',
      toolName: 'ur_unlock_protective_stop',
      description:
        '只解除指定机器人的**保护性停止**（并关闭安全弹窗），**不做上电、不释放刹车**。' +
        '与 ur_reset_error 的区别：那个会顺带上电 + 释放刹车（可能让机械臂动起来），这个只清安全状态。' +
        '解除后会重新读取安全状态位并一并返回，便于确认结果。',
      parameters: { ip: IP() },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'shutdown',
      toolName: 'ur_shutdown',
      description: '关闭指定机器人的控制器（相当于在面板上关机）。⚠️ 关闭后需人工到现场重新上电，请勿在程序运行中调用。',
      parameters: { ip: IP() },
    },
    // 实时遥测（字段本来就在 RTDE 数据流里，读取零代价）
    {
      op: 'get_runtime_telemetry',
      toolName: 'ur_get_runtime_telemetry',
      description:
        '一次读取指定机器人的**实时遥测**：关节电流/电压/角速度、TCP 线速度与受力/力矩、工具加速度计、速度倍率、' +
        '整机电压电流、关节温度。这些量本来就在 500 Hz 的 RTDE 数据流里、读取零代价且不需要改配置；' +
        '适合判断"是不是撞了/卡了"（电流与力矩同时飙升）或"是不是被速度倍率限住了"。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_speed_scaling',
      toolName: 'ur_get_speed_scaling',
      description: '读取指定机器人当前的速度倍率（0-1）。程序"看起来在跑但很慢"时，先看它是否被面板上的速度滑块压住了。',
      parameters: { ip: IP() },
    },
    {
      op: 'get_tcp_force',
      toolName: 'ur_get_tcp_force',
      description: '读取指定机器人 TCP 处的受力与力矩 [Fx,Fy,Fz,Tx,Ty,Tz]（来自 RTDE），可用于碰撞/卡阻的辅助判断。',
      parameters: { ip: IP() },
    },
    // 配置 / 工具端 I/O / 传送带跟踪
    {
      op: 'set_gravity',
      toolName: 'ur_set_gravity',
      description:
        '设置指定机器人的**重力方向**（3 维向量，会先归一化）。只在机器人**非水平安装**（侧装/倒装）时才需要；' +
        '⚠️ 设错会让重力补偿方向反掉（松手后下坠或上飘）。水平安装通常不需要改。',
      parameters: {
        ip: IP(),
        direction: numberArray({ type: 'number' }, '重力方向向量 [x,y,z]（例如"重力朝下"为 [0,0,-1]）'),
      },
    },
    {
      op: 'zero_ftsensor',
      toolName: 'ur_zero_ftsensor',
      description:
        '把指定机器人的力/力矩传感器读数归零。⚠️ 归零瞬间机械臂应处于"不受外力"的状态（否则零点会带偏），归零后受力读数的基准随之改变。',
      parameters: { ip: IP() },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'get_tool_analog_in',
      toolName: 'ur_get_tool_analog_in',
      description:
        '读取指定机器人工具端的模拟输入（0/1）。工具模拟输入不经 RTDE，需发一段短 URScript 并把结果写进输出寄存器回读，' +
        '**会打断正在运行的程序**；读不到的场合会如实报失败并说明可能原因（含可换 read_register 再试）。',
      parameters: {
        ip: IP(),
        n: { type: 'integer', required: true, description: '工具模拟输入端口号（0 或 1）' },
        read_register: { type: 'integer', description: '回读用的 double 输出寄存器编号（0-23，默认 22）' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'conveyor_tracking',
      toolName: 'ur_set_conveyor_tracking',
      description:
        '**传送带跟踪**（按官方手册重写；旧版的每个实参都在错误的位置）。action：' +
        '"setup_pulse"（把控制器脉冲解码器挂到编码器：需 decoder_type 1-4 + encoder_a/encoder_b 引脚）、' +
        '"setup_absolute"（外部喂计数值：range_id 0-4，可选 tick_count）、' +
        '"linear"（线性跟踪：需 direction 方向位姿 + ticks_per_meter）、' +
        '"circular"（圆盘跟踪：需 center 圆心位姿 + ticks_per_revolution + 可选 rotate_tool）、' +
        '"stop"（停止）。典型顺序：先 setup_pulse 或 setup_absolute 一次，再 linear/circular，结束时 stop。' +
        '⚠️ 会改变运动学行为——开启后机械臂会跟随传送带运动，请先确认周围安全。' +
        '⚠️ **未经真机验证**：签名与量纲已逐条对照手册，但跟踪行为需要真带编码器的传送带才能确认；' +
        '返回值的 `hardware_verified` 恒为 false，请先在 URSim 上试。' +
        '⚠️ 编码器引脚范围随固件不同：CB3(3.x) 是数字输入 0-3，e-Series / PolyScope X 是 8-11。',
      parameters: {
        ip: IP(),
        action: {
          type: 'string',
          required: true,
          description: '"setup_pulse" / "setup_absolute" / "linear" / "circular" / "stop"',
        },
        encoder_index: { type: 'integer', description: '编码器编号（手册：只能 0 或 1，默认 0）' },
        decoder_type: { type: 'integer', description: 'setup_pulse 的解码方式：1 正交（默认）/ 2 升降沿 / 3 升沿 / 4 降沿' },
        encoder_a: { type: 'integer', description: 'setup_pulse 的编码器 A 引脚（CB3 0-3；e-Series 8-11）' },
        encoder_b: { type: 'integer', description: 'setup_pulse 的编码器 B 引脚（CB3 0-3；e-Series 8-11）' },
        range_id: { type: 'integer', description: 'setup_absolute 的计数范围：0=32 位有符号（默认）… 4=32 位无符号' },
        tick_count: { type: 'integer', description: 'setup_absolute 可选的初始计数值（encoder_set_tick_count）' },
        direction: numberArray({ type: 'number' }, 'linear 的传送带方向位姿（基座系，例如 x 轴方向 [1,0,0,0,0,0]）', false),
        ticks_per_meter: { type: 'number', description: 'linear 的每米脉冲数（>0；编码器走过 1 米的脉冲数）' },
        center: numberArray({ type: 'number' }, 'circular 的圆心位姿（基座系，例如 [0.5,0.5,0,0,0,0]）', false),
        ticks_per_revolution: { type: 'number', description: 'circular 的每转脉冲数（>0）' },
        rotate_tool: { type: 'boolean', description: 'circular：工具是否随传送带旋转（默认 false = 保持轨迹给出的姿态）' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    // ── 0.6.0 新增能力 ─────────────────────────────────────────────────────
    // 逐条依据仓库内三本官方手册（URSoftware 3.15.4 / PolyScope 5 / PolyScope X）：
    //   force_mode           Poly5 15.12、PolyScope X 15.11
    //   end_force_mode       Poly5 15.8、PolyScope X 15.7
    //   force_mode_set_*     Poly5 15.16/15.17、PolyScope X 15.15/15.14
    //   speedj/speedl        Poly5 15.48/15.49、PolyScope X 15.47/15.48
    //   stopj/stopl          Poly5 15.51/15.52、PolyScope X 15.50/15.51
    //   is_steady            Poly5 16.39（本插件改用 RTDE 速度量实现，见 ur_wait_steady）
    //   target_*             Poly5 16.24/16.25/16.30（改用 RTDE 的 target_* 字段）
    //   set_tool_communication  Poly5 18.50、PolyScope X 18.50
    //   set_tool_output_mode    Poly5 18.52、PolyScope X 18.52
    //   set_target_payload      PolyScope X 16.52（5.10+ 才有；CB3 上退回 set_payload_*）
    {
      op: 'force_mode',
      toolName: 'ur_force_mode',
      description:
        '让指定机器人进入**力控（Force Mode）**：机器人沿/绕你选的轴"柔性"贴合环境，并持续施加指定的力/力矩。' +
        '参数严格按手册：task_frame（6 维位姿，力坐标系）、selection_vector（6 个 0/1，1=该轴柔性）、' +
        'wrench（6 维期望力/力矩，对刚性轴表示"抵消多大的外力"）、type（1/2/3，力坐标系的变换方式）、' +
        'limits（6 维：柔性轴=最大 TCP 速度，刚性轴=最大位置偏差）、可选 damping（0-1）与 gain_scaling（0-2）。' +
        '⚠️ 力控会持续压向环境：务必确认工件/夹具能承受该力，并保持急停在手边。' +
        '⚠️ 力控是**持续状态**：退出请调用 ur_end_force_mode，或在示教器上停止程序。' +
        '手册建议进入前先 sleep 0.02s 并避免沿柔性轴的快速运动（本工具已在脚本里插入了该 sleep）。',
      parameters: {
        ip: IP(),
        // 下面三个数组在 Python 侧都有默认值（ur_worker.py:2101-2106），所以是可选参数；
        // `numberArray` 的第三个实参给 `false` 即省略 `required`（不可写作 `required: false`，
        // 那个键一旦出现就必须为 true，否则本工具整个注册失败）。
        task_frame: numberArray({ type: 'number' }, '力坐标系位姿 [x,y,z,rx,ry,rz]（相对基座，默认全 0 = 基座系）', false),
        selection_vector: {
          type: 'array',
          items: { type: 'integer' },
          description: '6 个 0/1，1 表示该轴柔性（默认 [0,0,1,0,0,0] = 沿 z 柔性）',
        },
        wrench: numberArray({ type: 'number' }, '6 维力/力矩 [Fx,Fy,Fz,Tx,Ty,Tz]（N / N·m，默认全 0）', false),
        type: { type: 'integer', description: '力坐标系解释方式：1 / 2（默认）/ 3' },
        limits: numberArray({ type: 'number' }, '6 维限制（柔性轴=最大速度，刚性轴=最大偏差；默认 [2,2,1.5,1,1,1]）', false),
        damping: { type: 'number', description: '阻尼 0-1（默认 0.005；越大无外力时减速越快）' },
        gain_scaling: { type: 'number', description: '增益缩放 0-2（默认 1；>1 可能让力控不稳定）' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'end_force_mode',
      toolName: 'ur_end_force_mode',
      description:
        '退出指定机器人的**力控模式**（URScript `end_force_mode()`），恢复正常位置控制。' +
        '程序停止时控制器也会自动退出力控，所以这个工具用于"程序还在跑但想主动退力控"的场合。',
      parameters: { ip: IP() },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'force_mode_settings',
      toolName: 'ur_force_mode_settings',
      description:
        '设置力控的 damping（0-1）与 gain_scaling（0-2）。⚠️ 这两个值**控制器侧无法回读**：' +
        '本工具只回报本次设置的值，不会假装读到了"当前值"；手册也要求它们在**进入力控之前**设置才生效。',
      parameters: {
        ip: IP(),
        damping: { type: 'number', description: '阻尼 0-1（默认 0.005）' },
        gain_scaling: { type: 'number', description: '增益缩放 0-2（默认 1）' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'speedj',
      toolName: 'ur_speedj',
      description:
        '**关节速度控制**：让指定机器人线性加速到给定的关节角速度并保持（URScript `speedj(qd, a, t)`）。' +
        '⚠️ 这是速度指令、不是位置指令：机器人会一直以该速度转动，直到 ur_stopj / 新的运动指令 / 安全停止。' +
        't>0 时函数在 t 秒后返回，t=0（默认）时在达到目标速度后返回——**两种情况机器人都还在动**。' +
        '请用 ur_wait_steady 或 ur_stopj 收尾，并务必确认终点方向的行程足够。',
      parameters: {
        ip: IP(),
        qd: numberArray({ type: 'number' }, '六个关节的目标角速度（rad/s）'),
        a: { type: 'number', description: '关节加速度（rad/s²，必须 >0，默认 0.5）' },
        t: { type: 'number', description: '运行时长（秒，≥0，默认 0 = 达速后立即返回，机械臂继续运动）' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'speedl',
      toolName: 'ur_speedl',
      description:
        '**TCP 速度控制**：让指定机器人线性加速到给定的 TCP 速度并保持（URScript `speedl(xd, a, t, aRot)`）。' +
        '⚠️ 这是本插件"放得最开"的运动指令：它绕过位置轨迹规划，直接给笛卡尔速度；' +
        '机器人会一直以该速度运动，直到 ur_stopl / 新指令 / 安全停止。t=0（默认）表示达速后返回但**仍在运动**。' +
        'aRot 省略时旋转加速度按 a 处理（=手册默认 `aRot=\'a\'`）。',
      parameters: {
        ip: IP(),
        xd: numberArray({ type: 'number' }, 'TCP 目标速度 [vx,vy,vz,ωx,ωy,ωz]（m/s 与 rad/s）'),
        a: { type: 'number', description: '加速度（m/s²，必须 >0，默认 0.5）' },
        t: { type: 'number', description: '运行时长（秒，≥0，默认 0 = 达速后立即返回，机械臂继续运动）' },
        a_rot: { type: 'number', description: '旋转加速度（rad/s²，>0；省略则按 a 处理）' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'stopj',
      toolName: 'ur_stopj',
      description: '让指定机器人**关节空间减速到零**（URScript `stopj(a)`）。speedj 之后的标准收尾动作。',
      parameters: {
        ip: IP(),
        a: { type: 'number', description: '关节减速度（rad/s²，必须 >0，默认 2）' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'stopl',
      toolName: 'ur_stopl',
      description: '让指定机器人**TCP 速度减速到零**（URScript `stopl(a, aRot)`）。speedl 之后的标准收尾动作。',
      parameters: {
        ip: IP(),
        a: { type: 'number', description: '减速度（必须 >0，默认 0.5）' },
        a_rot: { type: 'number', description: '旋转减速度（>0；省略则按 a 处理）' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'wait_steady',
      toolName: 'ur_wait_steady',
      description:
        '等待指定机器人**完全静止**后再返回（对应用户手册里的"等待机器人静止"语义）。' +
        '实现方式是轮询 RTDE 里已有的 TCP 速度与关节角速度（零额外往返），' +
        '**不是**发 URScript 的 is_steady()——那个表达式在力控/示教模式下恒为 false，反而会误导。' +
        '适合在 speedj/speedl/力控之后确认"确实停下来了"。超时不会报错，而是如实回报 steady=false 与当时的实测速度。',
      parameters: {
        ip: IP(),
        timeout_s: { type: 'number', description: '最长等待时间（秒，0.1-300，默认 10）' },
        linear_tolerance: { type: 'number', description: 'TCP 线速度静止阈值（m/s，默认 0.005）' },
        angular_tolerance: { type: 'number', description: 'TCP 角速度静止阈值（rad/s，默认 0.01）' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'get_target_values',
      toolName: 'ur_get_target_values',
      description:
        '读取指定机器人"**控制器打算去哪**"：目标关节角/角速度/角加速度与目标 TCP 位姿/速度，并同时给出实际关节角与实际 TCP 位姿。' +
        '与"实际值"的差值是判断"指令已下发但尚未执行 / 正在交融 / 被安全限速拉住"的直接依据。' +
        '数据来自 RTDE 的 target_* 字段（已在接收配方里），读取零代价。',
      parameters: { ip: IP() },
    },
    {
      op: 'check_pose',
      toolName: 'ur_check_pose',
      description:
        '**动之前先问**：给定一个 TCP 位姿，回答两件事 —— (1) 它是否在控制器配置的**安全限值**内，' +
        '(2) 逆运动学能否解出关节角（即是否**可达**）。' +
        '做法是让控制器执行 is_within_safety_limits + get_inverse_kin，把结果写进输出寄存器回读，' +
        '并用首尾哨兵把三种结局分开：跑完（两个答案都有）／只跑到一半（限值有答案、IK 解不出 ⇒ 通常不可达）' +
        '／控制器根本没执行（未处于远程控制模式，或该固件没有这些函数 ⇒ 报 NOT_EXECUTED，不猜）。' +
        '这是**只读预检**，不会让机械臂运动；建议在 ur_movel / ur_movec / ur_move_optimized 之前对目标位姿用一次。',
      parameters: {
        ip: IP(),
        pose: numberArray({ type: 'number' }, '待检查的 TCP 位姿 [x,y,z,rx,ry,rz]（米 / 弧度）', true),
        qnear: numberArray(
          { type: 'number' },
          '可选的 IK 起始关节角（6 个，弧度）：给出它可以让解更接近当前姿态，避免"换手"型的另一组解',
          false,
        ),
      },
    },
    {
      op: 'tool_communication',
      toolName: 'ur_set_tool_communication',
      description:
        '开关指定机器人工具法兰的**串口通信接口（TCI, RS-485）**，用于夹爪/拧紧枪等工具免外接走线。' +
        '参数对照手册 set_tool_communication(enabled, baud_rate, parity, stop_bits, rx_idle_chars, tx_idle_chars)。' +
        '⚠️ 手册明确警告：**启用 TCI 会禁用工具端的模拟输入**（那两路被复用成串口）。',
      parameters: {
        ip: IP(),
        enabled: { type: 'boolean', default: true, description: 'true 启用（默认），false 关闭' },
        baud_rate: {
          type: 'integer',
          description: '波特率：9600/19200/38400/57600/115200/1000000/2000000/5000000（默认 115200）',
        },
        parity: { type: 'integer', description: '校验位：0 无 / 1 奇 / 2 偶（默认 2）' },
        stop_bits: { type: 'integer', description: '停止位：1 或 2（默认 1）' },
        rx_idle_chars: { type: 'number', description: 'RX idle chars（1.0-40.0，默认 1.0）' },
        tx_idle_chars: { type: 'number', description: 'TX idle chars（0.0-40.0，默认 3.5）' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'set_tool_output_mode',
      toolName: 'ur_set_tool_output_mode',
      description:
        '设置指定机器人工具输出的模式：1 = power（双针供电模式，两路数字输出被用作附加电源）/ 0 = 普通数字输出。' +
        '⚠️ 改这个会改变工具法兰上针脚的电平语义，接错可能损坏工具。',
      parameters: {
        ip: IP(),
        mode: { type: 'integer', required: true, description: '0 普通 / 1 power（双针供电）' },
      },
    },
    {
      op: 'set_payload_inertia',
      toolName: 'ur_set_payload_inertia',
      description:
        '一次性设置负载的**质量 + 重心 + 惯性矩阵**（PolyScope 5.10 起的 `set_target_payload`）。' +
        '⚠️ 相比如今已被手册标为 deprecated 的 ur_set_payload（它会把惯性矩阵**重置**），' +
        '这个工具不会让质量/重心/惯量三者互相不一致；手册要求 Ixx/Iyy/Izz 非负、每个元素 |I|≤133 kg·m²。' +
        '⚠️ 设置负载会**自动把力/力矩测量归零**（等效 zero_ftsensor），因此请在真正需要用力的场合之前设置。' +
        'transition_time>0 可让负载切换时机器人不"跳"一下（抓/放重物有用）。' +
        'CB3（URSoftware 3.x）没有 `set_target_payload`：**没给 inertia 时**会依次发 `set_payload_mass` + ' +
        '`set_payload_cog`（而不是 `set_payload(m, cog)`——后者会重置惯性矩阵），这两条在所有版本上都存在。',
      parameters: {
        ip: IP(),
        mass: { type: 'number', required: true, description: '负载质量（kg，≥0）' },
        cog: numberArray({ type: 'number' }, '重心 [x,y,z]（米，相对工具法兰）'),
        inertia: numberArray(
          { type: 'number' },
          '惯性矩阵（行主序 9 个数，kg·m²），可选；给了才走 set_target_payload',
          false,
        ),
        transition_time: { type: 'number', description: '负载切换过渡时间（秒，默认 0）' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'move_optimized',
      toolName: 'ur_move_optimized',
      description:
        '**OptiMove 平滑运动**（手册 Poly5 15.32/15.33、PolyScope X 15.31/15.32）：与 ur_movej/ur_movel 目标相同，' +
        '但用 jerk 受限的速度剖面，运动更平顺、振动更小。' +
        '⚠️ a/v 不是 rad/s 或 m/s，而是"机器人能力的一个比例"，范围 (0, 1]：1 = 该构型下能达到的最快。' +
        '手册提示：a/v 的绝对速度取决于当时构型，因此同一组数值在不同工作区间的实际速度不同。' +
        'goal_type="joints" 时 goal 是六关节角（等价 optimovej）；"pose" 时 goal 是六维基座位姿（等价 optimovel）。' +
        '手册支持的 struct{pose,frame} 与世界模型对象名**本工具不支持**（需要 PolyScope 侧对象，脚本写错只会得到运行期报错），' +
        '传 frame 会被明确拒绝。⚠️ 会驱动机械臂运动，且请确认机器人当前静止。',
      parameters: {
        ip: IP(),
        goal_type: { type: 'string', required: true, description: '"joints"（关节角，等价 optimovej）/ "pose"（基座位姿，等价 optimovel）' },
        goal: numberArray({ type: 'number' }, '目标：joints 时为六关节角（rad），pose 时为 [x,y,z,rx,ry,rz]'),
        a: { type: 'number', description: '加速度**比例** (0,1]，默认 0.3（1 = 该构型下最快）' },
        v: { type: 'number', description: '速度**比例** (0,1]，默认 0.3' },
        r: { type: 'number', description: '交融半径（米），≥0，默认 0' },
        // 声明它是为了让拒绝**可达**：Python 侧明确拒绝这个参数（需要 PolyScope 侧坐标系/
        // 世界模型对象，写错只会换来控制器一句运行期报错）。不声明的话模型永远传不进来，
        // 那条清晰的错误信息就成了死代码（`scripts/check-tool-params.py` 会抓到这种不一致）。
        frame: {
          type: 'string',
          description: '不支持：手册的 struct{pose,frame} 形态需要 PolyScope 侧坐标系；传了会被明确拒绝',
        },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'motion_version',
      toolName: 'ur_motion_version',
      description:
        '设置 **Motion Version**（手册第 14 章）与/或 **jerk 增益**。' +
        'Motion Version：版本 1 与旧版 PolyScope 的运动剖面相同；版本 2 在规划时把速度/加速度' +
        '**钳到硬件上限**，交融半径重叠时**动态收缩**而不是跳过整段运动（版本 1 会跳过并给 ' +
        '"Overlapping Blends" 警告）。⚠️ 手册明确：**新机型与 PolyScope X 只支持版本 2**，CB3 没有这个设置。' +
        'jerk_gain_scaling（0.01-1.0，默认 1.0）：只影响 **jerk 受限**的剖面，即版本 2 的 movej/movel ' +
        '与 optimovej/optimovel（= 本插件的 ur_move_optimized）；需要更平滑的运动就调小。' +
        '⚠️ 这两个设置**都没有回读通道**，返回值只报告本次设置的值，不假装读到当前值。',
      parameters: {
        ip: IP(),
        version: { type: 'integer', description: 'Motion Version：1 或 2；省略则不改' },
        jerk_gain_scaling: { type: 'number', description: 'jerk 增益 0.01-1.0（1.0 = 默认，越小越平滑）；省略则不改' },
      },
    },
    {
      op: 'set_speed_scaling',
      toolName: 'ur_set_speed_scaling',
      description:
        '设置**速度倍率（速度滑块）**：URScript `set_speed_slider(fraction)`，0 = 停住、1 = 满速。' +
        '这是"交出一段精细动作之前先把整体速度压下来"最直接的手段（比逐条去改每条运动的 a/v 可靠）。' +
        '⚠️ 与其它设置类 op 不同，这一个**有回读通道**（接收配方里的 target_speed_fraction），' +
        '所以本工具会**设置后回读校验**：一致才报 verified:true，不一致就如实说"未核实"，绝不假装已生效。' +
        '⚠️ "set_speed_slider ⇒ target_speed_fraction" 这条映射**未经真机验证**（回报 hardware_verified:false）。' +
        '⚠️ 受运动审批门禁 —— 它会改变此后所有运动的速度。',
      parameters: {
        ip: IP(),
        fraction: { type: 'number', required: true, description: '速度倍率 0.0-1.0（0 停住 / 1 满速）' },
      },
    },
    {
      op: 'get_freedrive_status',
      toolName: 'ur_get_freedrive_status',
      description:
        '读取当前姿态在 **freedrive（手动拖动）** 下离**奇异点**有多远（PolyScope X 15.20）。' +
        '返回 0 = 正常、1 = 接近奇异点、2 = 太接近（拖动阻力明显变大）。' +
        '⚠️ 注意它**不是**"freedrive 开没开"的状态位，而是受限 freedrive 的可用性提示：' +
        '手册建议据此让操作员换一条路径，或改用不受限的 freedrive。' +
        '实现上需要控制器执行 URScript 表达式并把它写进一个输出寄存器（默认 21 号 int 寄存器，旧值会被覆盖）；' +
        '较老的 PolyScope（早于引入该函数的版本）上读不到，会如实报失败并说明原因。',
      parameters: {
        ip: IP(),
        register: { type: 'integer', description: '回读用的 int 输出寄存器编号（0-23），默认 21' },
      },
      timeoutMs: config.commandTimeoutMs,
    },
    {
      op: 'get_tool_telemetry',
      toolName: 'ur_get_tool_telemetry',
      description:
        '读取指定机器人工具端的**电气遥测**：工具输出电流（A）、工具输出电压（V）、I/O 电流（A）。' +
        '来自 RTDE 数据流，读取零代价；可用于判断工具是否真的在上电/耗电（例如夹爪没动时电流为 0）。' +
        '（手册里还有 get_tool_temp()，但当前 RTDE 配方不含对应字段，故本工具不提供该值。）',
      parameters: { ip: IP() },
    },
  ];

  /*
   * 注册结果必须如实上报。
   *
   * v0.3.9 的事故复现：多家工具的参数 schema 被 DSL 拒绝，注册在 try/catch 里逐个静默失败，
   * 而收尾那行打印的是硬编码的 `tools.length`，于是「日志看起来正常」骗过了所有检查，
   * 直到用户发现工具不见了。⇒ 现在按**实际成功数**上报；有失败就把清单与原因写出来；
   * 一个都没装成时区分三种原因（worker 初始化失败 / 宿主没有 tools 服务 / register 不是函数）。
   */
  const registerTool = ctx.tools?.register;
  if (worker !== null && typeof registerTool === 'function') {
    const failures = [];
    let registered = 0;
    for (const t of tools) {
      try {
        registerTool.call(ctx.tools, makeTool(t.op, t));
        registered += 1;
      } catch (e) {
        failures.push(`${t.toolName}（${e?.message ?? e}）`);
        ctx.logger?.warn?.(`universal-robots: 注册 ${t.toolName} 失败：${e.message}`);
      }
    }
    if (failures.length === 0) {
      ctx.logger?.info?.(`universal-robots: 已注册 ${registered}/${tools.length} 个 UR 机器人控制工具`);
    } else {
      ctx.logger?.warn?.(
        `universal-robots: 只注册了 ${registered}/${tools.length} 个 UR 机器人控制工具；失败 ${failures.length} 个：${failures.join('；')}`,
      );
    }
  } else {
    const reason = worker === null
      ? `worker 初始化失败（${workerError?.message ?? '未知原因'}）`
      : ctx.tools === undefined
        ? '宿主未组合 tools 服务'
        : '宿主的 ctx.tools.register 不是函数（宿主 API 可能已变更）';
    ctx.logger?.warn?.(`universal-robots: 未注册任何工具，原因：${reason}`);
  }

  /*
   * ── Digital-twin host routes (read-only) ──────────────────────────────────
   *
   * Mounted through `ctx.inject(['webServer'], …)` rather than a top-level
   * `inject` entry: adding 'webServer' to the module-level `inject` array would
   * make the *whole* plugin (every ur_* tool) refuse to load in any host that
   * composes no web server. The routes are mounted even when the worker is
   * null, so the twin simply reports `connected:false`.
   */
  if (typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (hostCtx) => {
      /*
       * ⚠️ 孪生的读走 `createTwinReadWorker(worker)`：短预算 + **超时不杀进程**。
       * 直接用 worker 会让"机器人正在运动 ⇒ worker 忙 ⇒ 孪生读排队 ⇒ 60 s 后超时 ⇒
       * 子进程被杀 ⇒ 整条机器人会话（RTDE/Dashboard）没了 ⇒ 孪生永远不再更新"。
       * 见 lib/twin-worker.js 的文件头。
       */
      const twinWorker = createTwinReadWorker(worker);
      /**
       * 主动推送遥测的读取口（见 lib/worker.js 的 `latestTelemetry`）。
       *
       * ⚠️ 必须挂在**原始 worker** 上，不能走 `twinWorker` —— `createTwinReadWorker`
       * 只替换 `call()` 的预算，推送缓存是 `UrWorker` 自身的状态。
       *
       * 有了它，孪生的每一帧**不再需要 worker 往返**：机器人运动时运动命令占住的是
       * stdin 队列，而 RTDE 缓存由 URBasic 自己的接收线程以 500 Hz 更新，推送因此照常
       * 到达 —— 这正是「数据已停止更新 Ns」的解药。
       */
      const twinTelemetry = (ip) => (worker !== null && worker !== undefined
        && typeof worker.latestTelemetry === 'function'
        ? worker.latestTelemetry(ip)
        : undefined);
      const stateHandler = createTwinStateHandler({
        worker: twinWorker,
        connectedIps: () => connectedIps,
        modelFor: (ip) => robotModels.get(ip) ?? null,
        telemetry: twinTelemetry,
      });
      const assetHandler = createTwinAssetHandler({ assetsDir: ASSETS_DIR });
      const modelsHandler = createTwinModelsHandler({ assetsDir: ASSETS_DIR });
      // 流式路由复用与轮询**完全相同**的读取逻辑（`createTwinStateHandler`），
      // 所以两条路不会出现语义漂移。
      const streamHandler = createTwinStreamHandler({
        worker: twinWorker,
        connectedIps: () => connectedIps,
        modelFor: (ip) => robotModels.get(ip) ?? null,
        telemetry: twinTelemetry,
      });

      /**
       * Trust fence: these routes expose robot telemetry and local files, so
       * only same-origin loopback callers are served. Mirrors the shell's own
       * plugin-route guard (see e.g. dsh-dream-skin `isTrustedApiRequest`).
       */
      const isTrustedRequest = (req) => {
        const host = typeof req.headers.host === 'string' ? req.headers.host : undefined;
        if (host === undefined) return false;
        let hostUrl;
        try {
          hostUrl = new URL(`http://${host}`);
        } catch {
          return false;
        }
        const hn = hostUrl.hostname;
        const loopback = hn === 'localhost' || hn === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hn);
        if (!loopback) return false;
        if (req.headers['sec-fetch-site'] === 'cross-site') return false;
        const origin = req.headers.origin;
        if (origin === undefined) return true;
        try {
          return new URL(origin).host === hostUrl.host;
        } catch {
          return false;
        }
      };

      const sendJson = (res, { status, body, headers }) => {
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          // Live telemetry: a cached pose is worse than no pose. The handlers
          // also set this, but the shell's own responses (403/405) should not
          // be cacheable either.
          'cache-control': 'no-store, no-cache, must-revalidate',
          ...(headers ?? {}),
        });
        res.end(JSON.stringify(body));
      };

      /**
       * The asset handler returns a Buffer on a hit and a JSON-able object on a
       * miss, so serialise by type — `res.end({...})` would throw.
       */
      const sendAssetResult = (res, r) => {
        const headers = r.headers ?? {};
        if (Buffer.isBuffer(r.body) || typeof r.body === 'string') {
          res.writeHead(r.status, headers);
          res.end(r.body);
          return;
        }
        res.writeHead(r.status, {
          'content-type': 'application/json; charset=utf-8',
          ...headers,
        });
        res.end(JSON.stringify(r.body ?? ''));
      };

      hostCtx.effect(
        () =>
          hostCtx.webServer.register({
            kind: 'exact',
            path: TWIN_STREAM_PATH,
            // 流式路由自己持有响应生命周期（DSH 的 webServer 明确支持 SSE），
            // 所以这里**不**用 sendJson 收尾。信任围栏仍在最前面。
            handler: (req, res) => {
              if (!isTrustedRequest(req)) {
                res.writeHead(403);
                res.end('forbidden');
                return;
              }
              streamHandler(req, res);
            },
          }),
        'ur-twin: stream route',
      );

      hostCtx.effect(
        () =>
          hostCtx.webServer.register({
            kind: 'exact',
            path: TWIN_STATE_PATH,
            handler: async (req, res) => {
              if (!isTrustedRequest(req)) {
                res.writeHead(403);
                res.end('forbidden');
                return;
              }
              if (req.method !== 'GET') {
                res.writeHead(405);
                res.end();
                return;
              }
              const url = new URL(req.url, 'http://localhost');
              sendJson(res, await stateHandler({
                ip: url.searchParams.get('ip') ?? '',
                detail: url.searchParams.get('detail') ?? '',
              }));
            },
          }),
        'ur-twin: state route',
      );

      hostCtx.effect(
        () =>
          hostCtx.webServer.register({
            kind: 'exact',
            path: TWIN_ASSET_PATH,
            handler: async (req, res) => {
              if (!isTrustedRequest(req)) {
                res.writeHead(403);
                res.end('forbidden');
                return;
              }
              if (req.method !== 'GET') {
                res.writeHead(405);
                res.end();
                return;
              }
              const url = new URL(req.url, 'http://localhost');
              const r = await assetHandler(
                { model: url.searchParams.get('model') ?? '' },
                // Forward the validator so a cached GLB can be answered with 304:
                // without it every panel reopen re-downloads 1.5-3.5 MB.
                req.headers,
              );
              sendAssetResult(res, r);
            },
          }),
        'ur-twin: asset route',
      );

      hostCtx.effect(
        () =>
          hostCtx.webServer.register({
            kind: 'exact',
            path: TWIN_MODELS_PATH,
            handler: async (req, res) => {
              if (!isTrustedRequest(req)) {
                res.writeHead(403);
                res.end('forbidden');
                return;
              }
              if (req.method !== 'GET') {
                res.writeHead(405);
                res.end();
                return;
              }
              sendJson(res, await modelsHandler());
            },
          }),
        'ur-twin: models route',
      );

      ctx.logger?.info?.(
        `universal-robots: 已挂载数字孪生路由 ${TWIN_STATE_PATH}、${TWIN_ASSET_PATH}、${TWIN_MODELS_PATH} 与 ${TWIN_STREAM_PATH}` +
          `（只读遥测预算 ${TWIN_READ_TIMEOUT_MS}ms，超时不杀 worker）`,
      );
    });
  } else {
    ctx.logger?.warn?.('universal-robots: ctx.inject 不可用，未挂载数字孪生路由');
  }
}

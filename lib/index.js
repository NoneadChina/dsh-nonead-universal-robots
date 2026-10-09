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
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { UrWorker } from './worker.js';
import { pendingMotion } from './pending-motion.js';
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

export const inject = ['tools'];

export const Config = z.object({
  pythonBin: z.string().default('python'),
  commandTimeoutMs: z.number().min(1000).max(600000).default(60000),
  connectTimeoutMs: z.number().min(1000).default(30000),
  requireApprovalForMotion: z.boolean().default(true),
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
  // until it is stopped), and `stopj`/`stopl` decelerate a moving arm.
  // Changing the payload also re-zeros the force/torque sensor, which changes how
  // the arm responds to contact — so it is gated too.
  'force_mode', 'end_force_mode', 'force_mode_settings',
  'speedj', 'speedl', 'stopj', 'stopl',
  'set_payload_inertia',
  // `move_optimized` moves the arm (smoothly, but it moves); `motion_version`
  // changes how *every later* move is planned, so it is a motion-capability
  // change rather than a read.
  'move_optimized', 'motion_version',
  // 审计补齐（host-audit H-2）：这两个 op 的副作用与**已经受门禁**的兄弟 op 完全同类。
  //   `set_payload` 与 `set_payload_inertia` 都发 set_payload_mass + set_payload_cog，
  //   而设置负载会**自动把力/力矩测量归零**（等效于受门禁的 `zero_ftsensor`）——
  //   只门禁其中一个等于留了一个同效果的旁路。
  //   `set_gravity` 改变重力补偿方向：设错就是"松手后下坠或上飘"，属于让机械臂
  //   脱离程序控制的物理状态变更。
  'set_payload', 'set_gravity',
]);

function summarizeArgs(args) {
  try {
    return JSON.stringify(args).slice(0, 240);
  } catch {
    return '';
  }
}

/**
 * Ask a human on the DSH approval channel before dispatching a motion op.
 * Fail-closed: no approval service, no agent, or a non-`allowed-once` outcome
 * all throw, so the command is never sent to the worker.
 */
async function requestApproval(ctx, toolName, args, exec) {
  const approval = typeof ctx.get === 'function' ? ctx.get('approval') : ctx.approval;
  if (approval === undefined) {
    throw new Error(`运动指令 ${toolName} 需人工批准，但当前环境未组合审批服务（fail-closed）。可设 requireApprovalForMotion=false 禁用，或补装 @deepseek-ai/dsh-user-approval。`);
  }
  if (exec.agent === undefined) {
    throw new Error(`运动指令 ${toolName} 需路由到会话审批，但该调用无 agent（fail-closed）。`);
  }
  // 先登记待审批目标，让孪生面板能把"它要往哪动"画出来（清单第 8 条：先看后动）。
  // token 保证并发/重叠审批时只清自己那一次。
  const token = pendingMotion.begin(toolName, args);
  try {
    const outcome = await approval.request({
      agent: exec.agent,
      toolName,
      reason: `请确认是否允许机器人执行 ${toolName}（${summarizeArgs(args)}）`,
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
        const closed = worker.shutdown({ timeoutMs: 5000 });
        Promise.resolve(closed).catch(() => {}).finally(() => worker.dispose());
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
  const makeTool = (op, { toolName, description, parameters, timeoutMs }) => {
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
        if (requireApprovalForMotion && APPROVAL_OPS.has(op)) {
          await requestApproval(ctx, toolName, args, exec);
        }
        const res = await worker.call(op, args, timeoutMs ?? config.commandTimeoutMs, exec.signal);
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
      description: '通过 SSH 读取机器人的 .urp 程序列表。优先扫描 /programs（真机默认）；若不存在则自动探测 ~/URSim_Linux-*/programs.*/*.urp（URSim）；也可用 programs_dir 覆盖。默认账号 root/easybot。',
      parameters: {
        ip: IP(),
        username: { type: 'string', description: 'SSH 用户名，默认 root' },
        password: { type: 'string', description: 'SSH 密码，默认 easybot' },
        programs_dir: { type: 'string', description: '覆盖要扫描 .urp 的目录（可选）' },
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
      const stateHandler = createTwinStateHandler({
        worker: twinWorker,
        connectedIps: () => connectedIps,
        modelFor: (ip) => robotModels.get(ip) ?? null,
      });
      const assetHandler = createTwinAssetHandler({ assetsDir: ASSETS_DIR });
      const modelsHandler = createTwinModelsHandler({ assetsDir: ASSETS_DIR });
      // 流式路由复用与轮询**完全相同**的读取逻辑（`createTwinStateHandler`），
      // 所以两条路不会出现语义漂移。
      const streamHandler = createTwinStreamHandler({
        worker: twinWorker,
        connectedIps: () => connectedIps,
        modelFor: (ip) => robotModels.get(ip) ?? null,
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

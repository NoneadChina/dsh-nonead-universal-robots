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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { UrWorker } from './worker.js';
import {
  TWIN_STATE_PATH,
  TWIN_ASSET_PATH,
  TWIN_MODELS_PATH,
  createTwinStateHandler,
  createTwinAssetHandler,
  createTwinModelsHandler,
} from './twin-routes.js';

const PYTHON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'python');

/**
 * `assets/models/` — GLB meshes served by the twin asset route (Ruling 7).
 * The directory may legitimately not exist yet while meshes are still being
 * produced; `createTwinAssetHandler` degrades that to a clean 404.
 */
const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'models');

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
  const outcome = await approval.request({
    agent: exec.agent,
    toolName,
    reason: `请确认是否允许机器人执行 ${toolName}（${summarizeArgs(args)}）`,
    signal: exec.signal,
  });
  if (outcome !== 'allowed-once') {
    throw new Error(`运动指令 ${toolName} 未获人工批准（${outcome}），已取消。`);
  }
}

function textOutput(extra = {}) {
  return {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: value }],
    ...extra,
  };
}

function numberArray(items = { type: 'number' }, description = '') {
  return { type: 'array', items, required: true, ...(description ? { description } : {}) };
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
  a: { type: 'number', description: '加速度（米/秒²），必须 >0，默认 1' },
  v: { type: 'number', description: '速度（米/秒），必须 >0，默认 1' },
  t: { type: 'number', description: '移动时长（秒），≥0，默认 0' },
  r: { type: 'number', description: '交融半径（米），≥0，默认 0' },
});

export function apply(ctx, config = {}) {
  let worker = null;
  let workerError = null;
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

  const makeTool = (op, { toolName, description, parameters, timeoutMs }) =>
    defineTool({
      name: toolName,
      description,
      parameters,
      output: textOutput(),
      timeoutMs,
      async execute(args, exec) {
        if (config.requireApprovalForMotion && APPROVAL_OPS.has(op)) {
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
      description: '设置指定机器人的标准模拟输出值（0-10V 或 0-20mA，视域而定）。',
      parameters: {
        ip: IP(),
        n: { type: 'integer', required: true, description: '端口号（0 或 1）' },
        value: { type: 'number', required: true, description: '输出值（约 0-10 或 0-20）' },
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
      description: '让指定机器人做圆弧运动（经 via 点到达 to 点）。⚠️ 会驱动机械臂运动。',
      parameters: {
        ip: IP(),
        pose_via: numberArray({ type: 'number' }, '途经点 TCP 位姿：[x,y,z,rx,ry,rz]'),
        pose_to: numberArray({ type: 'number' }, '目标 TCP 位姿：[x,y,z,rx,ry,rz]'),
        a: { type: 'number', description: '加速度，必须 >0，默认 1.2' },
        v: { type: 'number', description: '速度，必须 >0，默认 0.25' },
        r: { type: 'number', description: '交融半径，≥0，默认 0' },
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
      description: '读取指定机器人的传送带 tick 计数。',
      parameters: { ip: IP() },
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
        '开启/停止指定机器人的**传送带跟踪**：action="linear"（线性跟踪）/"circular"（圆盘跟踪）/"stop"（停止）。' +
        '⚠️ 会改变机器人的运动学行为——开启后机械臂会跟随传送带运动，请先确认周围安全。' +
        '开启需要编码器通道 A/B 与每米脉冲数（ticks_per_meter）。',
      parameters: {
        ip: IP(),
        action: { type: 'string', required: true, description: '"linear" / "circular" / "stop"' },
        encoder_a: { type: 'integer', description: '编码器 A 通道（数字输入号 0-7，默认 0）' },
        encoder_b: { type: 'integer', description: '编码器 B 通道（数字输入号 0-7，默认 1）' },
        ticks_per_meter: { type: 'number', description: '每米脉冲数（>0）' },
        radius: { type: 'number', description: '圆盘跟踪半径（米，>0）' },
        speed: { type: 'number', description: '跟踪速度（米/秒，默认 0.1）' },
      },
      timeoutMs: config.commandTimeoutMs,
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
      const stateHandler = createTwinStateHandler({
        worker,
        connectedIps: () => connectedIps,
        modelFor: (ip) => robotModels.get(ip) ?? null,
      });
      const assetHandler = createTwinAssetHandler({ assetsDir: ASSETS_DIR });
      const modelsHandler = createTwinModelsHandler({ assetsDir: ASSETS_DIR });

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
        `universal-robots: 已挂载数字孪生路由 ${TWIN_STATE_PATH}、${TWIN_ASSET_PATH} 与 ${TWIN_MODELS_PATH}`,
      );
    });
  } else {
    ctx.logger?.warn?.('universal-robots: ctx.inject 不可用，未挂载数字孪生路由');
  }
}

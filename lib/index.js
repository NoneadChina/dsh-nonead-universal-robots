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

const PYTHON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'python');

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
  'draw_circle', 'draw_square', 'draw_rectangle', 'draw_star',
  'load_program', 'run_program', 'send_script', 'reset_error',
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
  a: { type: 'number', description: '加速度（米/秒²），默认 1' },
  v: { type: 'number', description: '速度（米/秒），默认 1' },
  t: { type: 'number', description: '移动时长（秒），默认 0' },
  r: { type: 'number', description: '交融半径（米），默认 0' },
});

export function apply(ctx, config = {}) {
  let worker = null;
  try {
    worker = new UrWorker({
      pythonBin: config.pythonBin ?? 'python',
      pythonDir: PYTHON_DIR,
      commandTimeoutMs: config.commandTimeoutMs ?? 60000,
    });
    ctx.effect(() => () => worker.dispose(), 'universal-robots: worker');
  } catch (e) {
    ctx.logger?.warn?.(`universal-robots: worker init failed: ${e.message}`);
  }

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
      description: '读取指定机器人的型号。',
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
      description: '向指定机器人发送一段 URScript 脚本并执行（用于自定义动作、I/O、逻辑等）。',
      parameters: {
        ip: IP(),
        script: { type: 'string', required: true, description: 'URScript 脚本内容' },
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
      op: 'draw_circle',
      toolName: 'ur_draw_circle',
      description:
        '让指定机器人以给定圆心与半径画一个圆。coordinate 为 "z"（竖直平面，与基座垂直）或其它（水平平面）。⚠️ 会驱动机械臂运动。',
      parameters: {
        ip: IP(),
        center: numberArray({ type: 'number' }, '圆心 TCP 位置：[x,y,z,rx,ry,rz]'),
        r: { type: 'number', required: true, description: '半径（米）' },
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
        border: { type: 'number', required: true, description: '边长（米）' },
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
        width: { type: 'number', required: true, description: '长（米）' },
        height: { type: 'number', required: true, description: '宽（米）' },
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
        side: { type: 'number', required: true, description: '边长（米）' },
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
      description: '读取指定机器人某路数字输入。which 为 std(config)/tool（默认 std）。',
      parameters: {
        ip: IP(),
        which: { type: 'string', description: '输入类型：std(默认)/config/tool' },
        n: { type: 'integer', required: true, description: '端口号（0-…）' },
      },
    },
    {
      op: 'set_digital_out',
      toolName: 'ur_set_digital_out',
      description: '设置指定机器人某路数字输出为高/低。⚠️ 会触发机器人 I/O。',
      parameters: {
        ip: IP(),
        which: { type: 'string', description: '输出类型：std(默认)/config/tool' },
        n: { type: 'integer', required: true, description: '端口号（0-…）' },
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
        a: { type: 'number', description: '加速度，默认 1.2' },
        v: { type: 'number', description: '速度，默认 0.25' },
        r: { type: 'number', description: '交融半径，默认 0' },
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
        a: { type: 'number', description: '加速度，默认 1.2' },
        v: { type: 'number', description: '速度，默认 0.25' },
        r: { type: 'number', description: '交融半径，默认 0' },
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
        t: { type: 'number', description: '控制时长（秒），默认 0.008' },
        lookahead_time: { type: 'number', description: '前瞻时间 0.03-0.2，默认 0.1' },
        gain: { type: 'integer', description: '比例增益 100-2000，默认 100' },
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
  ];

  if (worker !== null && ctx.tools) {
    for (const t of tools) {
      try {
        ctx.tools.register(makeTool(t.op, t));
      } catch (e) {
        ctx.logger?.warn?.(`universal-robots: 注册 ${t.toolName} 失败：${e.message}`);
      }
    }
    ctx.logger?.info?.(`universal-robots 已注册 ${tools.length} 个 UR 机器人控制工具`);
  } else {
    ctx.logger?.warn?.('universal-robots: 未注册工具（ctx.tools 不可用或 worker 初始化失败）');
  }
}

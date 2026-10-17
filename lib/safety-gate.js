/**
 * lib/safety-gate.js — 预飞安全闸：**即使人点了头，也不许越界**。
 *
 * ## 为什么要有第二道闸
 * 运动审批门（`lib/index.js` 的 `requestApproval`）管的是"**要不要人点头**"：它挡的是
 * "模型自作主张让机械臂动起来"。但它对"人点了头之后要走的这一步本身有多离谱"毫无意见 ——
 * 模型把 `ur_move_z(distance=-10)` 理解成"下降 10 毫米"而人没看清就点了同意，10 米的下压
 * 照样会下发。真实事故里，**幅值写错**比"没审批"更常见。
 *
 * 所以这里再加一层**与审批独立**的物理/几何上限：
 *   - 与审批开关**解耦**：`requireApprovalForMotion: false` 只是关掉人工确认，
 *     **不会**顺手把这层物理上限也关掉（要关得显式设 `safetyGate: false`）。
 *   - 在**审批之前**判定：一个物理上不可能/超出声明工作空间的请求，不该拿去打扰人。
 *   - **fail closed**：工作空间配置写得无法解析时，拒绝一切受闸 op，而不是"当作没配"。
 *
 * ## 能查什么、不能查什么（别把它当安全边界）
 * 能查：
 *   - 轴位移（`move_x/y/z`、`move_tool_*`）的幅值；
 *   - 显式笛卡尔目标（`movel/movep/movec/move_force`，以及绘图的 `center/origin`）是否落在
 *     声明的工作空间包围盒内；
 *   - **绘图 op 的半径/边长**（`draw_circle.r`、`draw_square.border`、`draw_rectangle.width/height`、
 *     `draw_star.side`）按 `maxStepM` 限幅 —— 把毫米写成米是这类指令最典型的错误；
 *   - 线速度/关节速度/加速度/时长/力/力矩的幅值，以及力控 `limits`（柔性轴最大速度、刚性轴
 *     最大偏差）的取值范围；
 *   - 形状：`q`/`pose`/`center`/`origin`/`qd`/`xd`/`wrench`/`limits`/`task_frame` 必须是
 *     6 个有限数；参数**出现了但不合格**一律拒绝（不再"当成没提供"跳过）。
 * **查不了**：`ur_send_script`（任意 URScript 文本，本模块不解析脚本）与任何需要机器人
 * 当前位姿才能算出的目标（相对位移的绝对落点、`movej` 的关节空间落点——后者要 FK）。
 * 因此它是"防手滑"的一层，**不是**替代控制器安全配置的边界；真正的安全边界仍是 PolyScope
 * 里的安全限值。
 *
 * 纯函数、零 IO —— 单测见 `test/safety.test.mjs`。
 */

/** 默认上限。数值刻意保守但仍然可用：单步 0.5 m、线速度 0.5 m/s、关节速度 1.05 rad/s。 */
export const DEFAULT_LIMITS = {
  enabled: true,
  maxStepM: 0.5,
  maxLinearSpeed: 0.5,
  maxJointSpeed: 1.05,
  /**
   * 加速度上限。单位随 op 而定（线加速度 m/s² / 关节角加速度 rad/s²）—— 共用同一条
   * 保守上限，宁可多拦一次也不让"a 写大了"直接下发。
   */
  maxAccel: 2.0,
  maxDurationS: 60,
  maxForceN: 40,
  maxTorqueNm: 10,
  /** `{x:[min,max], y:[min,max], z:[min,max]}`，或 null（不检查工作空间）。 */
  workspace: null,
};

/** 轴对齐位移 op：参数就是位移量（米），最容易被模型写成离谱的数值。 */
const AXIS_STEP_OPS = new Set([
  'move_x', 'move_y', 'move_z',
  'move_tool_x', 'move_tool_y', 'move_tool_z',
]);
/** 目标位姿直接给出的 op → 参数名。 */
const ABSOLUTE_POSE_OPS = new Map([
  ['movel', ['pose']],
  ['movep', ['pose']],
  ['movec', ['pose_via', 'pose_to']],
  // 力控引导运动的目标也是显式位姿：它同样受工作空间与速度上限约束（力上限见下面的 wrench 检查）。
  ['move_force', ['pose']],
]);

/**
 * 绘图 op → 幅值参数（米）。这些参数此前完全不过闸：`draw_circle(r=50)`（把 50 mm 写成
 * 50 m）会被直接拼成半径 50 m 的 `movep/movec` 下发 —— 属于"单位写错"这一类，正是本闸
 * 存在的理由。它们都按 `maxStepM` 限幅。
 */
const DRAW_STEP_PARAMS = new Map([
  ['draw_circle', ['r']],
  ['draw_square', ['border']],
  ['draw_rectangle', ['width', 'height']],
  ['draw_star', ['side']],
]);
/** 绘图 op → 位姿参数（圆心/起点）：6 个有限数 + 工作空间。 */
const DRAW_POSE_PARAMS = new Map([
  ['draw_circle', 'center'],
  ['draw_square', 'origin'],
  ['draw_rectangle', 'origin'],
  ['draw_star', 'center'],
]);

/** `v` 是线速度（m/s）的 op。 */
const LINEAR_SPEED_OPS = new Set(['movel', 'movep', 'movec', 'move_force']);
/** `v` 是关节角速度（rad/s）的 op。 */
const JOINT_SPEED_OPS = new Set(['movej']);
/**
 * `a` 是**物理加速度**的 op（`move_optimized` 的 a/v 是能力比例，另有判据，不在此列）。
 * `stopj`/`stopl` 的 a 是**减速度**：越大停得越快，不该被加速度上限拦，故不在此列。
 */
const ACCEL_OPS = new Set(['movej', 'movel', 'movep', 'movec', 'move_force', 'speedj', 'speedl']);
/** 力控 op：wrench / limits / task_frame / selection_vector 的形状与幅值。 */
const FORCE_OPS = new Set(['force_mode', 'move_force']);

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** 6 维向量（位姿或关节角）必须是 6 个有限数。 */
function isSixVector(value) {
  return Array.isArray(value) && value.length === 6 && value.every(isFiniteNumber);
}

/**
 * 参数是否**出现**。
 *
 * `undefined` 视为未提供；`null`/`NaN`/错误类型都属于"提供了但不合格" —— 必须拒绝，
 * 不能像旧实现那样当作"没给"跳过（那会让 `<key>: null` 变成一条绕过检查的输入）。
 */
function hasParam(params, key) {
  return Object.prototype.hasOwnProperty.call(params, key) && params[key] !== undefined;
}

function isInsideWorkspace(position, workspace) {
  if (workspace === null || workspace === undefined) return true;
  return ['x', 'y', 'z'].every((axis) => {
    const range = workspace[axis];
    if (!Array.isArray(range) || range.length !== 2) return false;
    const value = position[['x', 'y', 'z'].indexOf(axis)];
    return value >= range[0] && value <= range[1];
  });
}

/**
 * 解析工作空间配置串：`"x:-1,1 y:-1,1 z:0,1.2"`（分隔符空格或 `;`，轴顺序任意）。
 *
 * 返回 `{ok:true, workspace}` 或 `{ok:false, reason}` —— **调用方在 `ok:false` 时必须
 * fail closed**（见文件头）。空串表示"不检查"，返回 `{ok:true, workspace:null}`。
 */
export function parseWorkspace(text) {
  if (typeof text !== 'string' || text.trim() === '') return { ok: true, workspace: null };
  const workspace = {};
  for (const chunk of text.trim().split(/[;\s]+/)) {
    if (chunk === '') continue;
    const match = /^([xyz]):(-?[0-9.]+),(-?[0-9.]+)$/i.exec(chunk);
    if (match === null) {
      return { ok: false, reason: `无法解析的片段 “${chunk}”（应形如 x:-1,1 y:-1,1 z:0,1.2）` };
    }
    const axis = match[1].toLowerCase();
    const low = Number(match[2]);
    const high = Number(match[3]);
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      return { ok: false, reason: `轴 ${axis} 的边界不是有限数` };
    }
    if (!(low < high)) return { ok: false, reason: `轴 ${axis} 的区间不是 low<high（${low},${high}）` };
    if (workspace[axis] !== undefined) return { ok: false, reason: `轴 ${axis} 出现了两次` };
    workspace[axis] = [low, high];
  }
  if (Object.keys(workspace).length === 0) return { ok: false, reason: '没有解析出任何轴' };
  return { ok: true, workspace };
}

const reject = (code, message, detail) => ({ code, message, detail: detail ?? null });
const argsReject = (op, message) => reject('SAFETY_ARGS', `${op} ${message}`);

/**
 * 判定一次运动指令是否越界。
 *
 * @returns `null`（放行）或 `{code, message, detail}`（拒绝；`code` 恒为 `SAFETY_*`）。
 */
export function checkMotionSafety(op, args, limits = DEFAULT_LIMITS) {
  const config = { ...DEFAULT_LIMITS, ...(limits ?? {}) };
  if (config.enabled === false) return null;

  const workspaceProblem = config.workspaceProblem;
  if (typeof workspaceProblem === 'string' && workspaceProblem !== '') {
    // fail closed：配置坏了就不放行任何运动（绝不"当作没配"）。
    return reject(
      'SAFETY_CONFIG',
      `工作空间配置无法解析（${workspaceProblem}）—— 预飞安全闸 fail closed，拒绝所有运动指令。` +
        '请修正 safetyWorkspace 或显式设 safetyGate=false。',
    );
  }

  const params = args ?? {};

  /**
   * 出现即校验的正数参数：`undefined` = 未提供（放行）；出现但非有限/≤0 → SAFETY_ARGS；
   * 给了 `limit` 且超过 → `limitCode`。`limit === undefined` 表示只验"正的有限数"。
   */
  const requirePositive = (key, limit, limitCode, unit) => {
    if (!hasParam(params, key)) return null;
    const value = params[key];
    if (!isFiniteNumber(value)) {
      return argsReject(op, `的 ${key} 必须是有限数（${unit}），实得 ${JSON.stringify(value)}`);
    }
    if (value <= 0) return argsReject(op, `的 ${key} 必须 > 0（${unit}），实得 ${value}`);
    if (limit !== undefined && value > limit) {
      return reject(limitCode, `${op} 的 ${key}=${value} ${unit} 超过上限 ${limit}`, { [key]: value, limit });
    }
    return null;
  };

  // ① 轴位移：参数就是位移量（米）。
  if (AXIS_STEP_OPS.has(op)) {
    const distance = params.distance;
    if (!isFiniteNumber(distance)) {
      return reject('SAFETY_ARGS', `${op} 需要有限的 distance（米），实得 ${JSON.stringify(distance)}`);
    }
    if (Math.abs(distance) > config.maxStepM) {
      return reject(
        'SAFETY_STEP',
        `${op} 的单步位移 ${distance} m 超过上限 ${config.maxStepM} m —— 疑似单位或幅值写错` +
          `（毫米请写成 0.01，而不是 10）。确认无误可调高 safetyMaxStepM。`,
        { distance, limit: config.maxStepM },
      );
    }
  }

  // ② 显式笛卡尔目标：形状 + 工作空间。
  const poseParams = ABSOLUTE_POSE_OPS.get(op);
  if (poseParams !== undefined) {
    for (const key of poseParams) {
      const pose = params[key];
      if (!isSixVector(pose)) {
        return reject('SAFETY_ARGS', `${op} 的 ${key} 必须是 6 个有限数（[x,y,z,rx,ry,rz]）`);
      }
      if (!isInsideWorkspace(pose.slice(0, 3), config.workspace)) {
        return reject(
          'SAFETY_WORKSPACE',
          `${op} 的目标位置 [${pose.slice(0, 3).join(', ')}] 落在声明的工作空间之外`,
          { position: pose.slice(0, 3), workspace: config.workspace },
        );
      }
    }
  }

  // ③ 绘图：半径/边长按单步上限限幅；圆心/起点 6 有限数 + 工作空间。
  const drawSteps = DRAW_STEP_PARAMS.get(op);
  if (drawSteps !== undefined) {
    for (const key of drawSteps) {
      if (!hasParam(params, key)) return argsReject(op, `缺少 ${key}（米）`);
      const value = params[key];
      if (!isFiniteNumber(value)) {
        return argsReject(op, `的 ${key} 必须是有限数（米），实得 ${JSON.stringify(value)}`);
      }
      if (value <= 0) return argsReject(op, `的 ${key} 必须 > 0（米），实得 ${value}`);
      if (value > config.maxStepM) {
        return reject(
          'SAFETY_STEP',
          `${op} 的 ${key}=${value} m 超过单步上限 ${config.maxStepM} m —— 疑似单位或幅值写错` +
            '（毫米请写成 0.05，而不是 50）。确认无误可调高 safetyMaxStepM。',
          { [key]: value, limit: config.maxStepM },
        );
      }
    }
    const poseKey = DRAW_POSE_PARAMS.get(op);
    const pose = params[poseKey];
    if (!isSixVector(pose)) {
      return argsReject(op, `的 ${poseKey} 必须是 6 个有限数（[x,y,z,rx,ry,rz]）`);
    }
    if (!isInsideWorkspace(pose.slice(0, 3), config.workspace)) {
      return reject(
        'SAFETY_WORKSPACE',
        `${op} 的 ${poseKey} [${pose.slice(0, 3).join(', ')}] 落在声明的工作空间之外`,
        { position: pose.slice(0, 3), workspace: config.workspace },
      );
    }
  }

  // ④ 关节目标 / 关节与 TCP 速度指令的形状必须严格 6 维。
  if (op === 'movej' || op === 'servoj') {
    if (!isSixVector(params.q)) {
      return reject('SAFETY_ARGS', `${op} 的 q 必须是 6 个有限数（弧度）`);
    }
  }
  if (op === 'speedj' && !isSixVector(params.qd)) {
    return reject('SAFETY_ARGS', 'speedj 的 qd 必须是 6 个有限数（rad/s）');
  }
  if (op === 'speedl' && !isSixVector(params.xd)) {
    return reject('SAFETY_ARGS', 'speedl 的 xd 必须是 6 个有限数（前 3 项 m/s，后 3 项 rad/s）');
  }

  // ⑤ 速度/加速度：**出现即校验**（不得因为 NaN/Inf/负值而当成"没提供"跳过）。
  if (JOINT_SPEED_OPS.has(op)) {
    const bad = requirePositive('v', config.maxJointSpeed, 'SAFETY_SPEED', 'rad/s');
    if (bad !== null) return bad;
  }
  if (LINEAR_SPEED_OPS.has(op)) {
    // `move_force` 的 v 是"力控模式下朝目标推进"的线速度，与 movel 同级 —— 同样要限。
    const bad = requirePositive('v', config.maxLinearSpeed, 'SAFETY_SPEED', 'm/s');
    if (bad !== null) return bad;
  }
  if (ACCEL_OPS.has(op)) {
    const bad = requirePositive('a', config.maxAccel, 'SAFETY_ACCEL', 'm/s²');
    if (bad !== null) return bad;
    if (op === 'speedl') {
      // `aRot` 是旋转加速度（rad/s²）：只要求是正的有限数（量纲与线加速度不同，不共用上限）。
      const badRot = requirePositive('a_rot', undefined, 'SAFETY_ACCEL', 'rad/s²');
      if (badRot !== null) return badRot;
    }
  }

  // ⑥ move_optimized：a/v 是**能力比例** (0,1]，不是物理量 —— 判据只能是区间。
  if (op === 'move_optimized') {
    for (const key of ['a', 'v']) {
      const value = params[key];
      if (value === undefined) continue;
      if (!isFiniteNumber(value) || value <= 0 || value > 1) {
        return reject('SAFETY_ARGS', `move_optimized 的 ${key} 必须是 (0,1] 的能力比例，实得 ${JSON.stringify(value)}`);
      }
    }
    if (params.goal_type === 'pose' && !isSixVector(params.goal)) {
      return reject('SAFETY_ARGS', 'move_optimized 的 goal（pose 模式）必须是 6 个有限数');
    }
    if (params.goal_type === 'pose' && Array.isArray(params.goal) && !isInsideWorkspace(params.goal.slice(0, 3), config.workspace)) {
      return reject('SAFETY_WORKSPACE', 'move_optimized 的目标位置落在声明的工作空间之外');
    }
  }

  // ⑦ speedj / speedl 的幅值（形状已在 ④ 校验过）。
  if (op === 'speedj') {
    const worst = Math.max(...params.qd.map((x) => Math.abs(x)));
    if (worst > config.maxJointSpeed) {
      return reject('SAFETY_SPEED', `speedj 的关节角速度最大 ${worst} rad/s 超过上限 ${config.maxJointSpeed}`, {
        worst,
        limit: config.maxJointSpeed,
      });
    }
  }
  if (op === 'speedl') {
    const linear = Math.max(...params.xd.slice(0, 3).map((x) => Math.abs(x)));
    const angular = Math.max(...params.xd.slice(3, 6).map((x) => Math.abs(x)));
    if (linear > config.maxLinearSpeed) {
      return reject('SAFETY_SPEED', `speedl 的线速度最大 ${linear} m/s 超过上限 ${config.maxLinearSpeed}`);
    }
    if (angular > config.maxJointSpeed) {
      return reject('SAFETY_SPEED', `speedl 的角速度最大 ${angular} rad/s 超过上限 ${config.maxJointSpeed}`);
    }
  }

  /*
   * ⑧ 力控：wrench 的力/力矩上限、limits 的速度/偏差上限、task_frame 的形状。
   * `move_force` 与 `force_mode` 都要过这一关：前者是"在力控模式下朝目标走"，它施加的
   * 力与后者一样会持续压在工件/环境上 —— 幅值写错的后果也一模一样。
   */
  if (FORCE_OPS.has(op)) {
    if (hasParam(params, 'wrench')) {
      const wrench = params.wrench;
      if (!isSixVector(wrench)) {
        return argsReject(op, '的 wrench 必须是 6 个有限数（[Fx,Fy,Fz,Tx,Ty,Tz]，N / N·m）');
      }
      const worstForce = Math.max(...wrench.slice(0, 3).map((x) => Math.abs(x)));
      const worstTorque = Math.max(...wrench.slice(3, 6).map((x) => Math.abs(x)));
      if (worstForce > config.maxForceN) {
        return reject('SAFETY_FORCE', `${op} 的力 ${worstForce} N 超过上限 ${config.maxForceN} N`, {
          worstForce,
          limit: config.maxForceN,
        });
      }
      if (worstTorque > config.maxTorqueNm) {
        return reject('SAFETY_FORCE', `${op} 的力矩 ${worstTorque} N·m 超过上限 ${config.maxTorqueNm} N·m`, {
          worstTorque,
          limit: config.maxTorqueNm,
        });
      }
    }
    if (hasParam(params, 'limits')) {
      const forceLimits = params.limits;
      if (!isSixVector(forceLimits)) {
        return argsReject(op, '的 limits 必须是 6 个有限数（柔性轴=最大速度，刚性轴=最大偏差）');
      }
      for (let i = 0; i < 6; i += 1) {
        if (forceLimits[i] < 0) return argsReject(op, `的 limits[${i}] 不得为负（实得 ${forceLimits[i]}）`);
      }
      const worstLinear = Math.max(...forceLimits.slice(0, 3).map((x) => Math.abs(x)));
      const worstJoint = Math.max(...forceLimits.slice(3, 6).map((x) => Math.abs(x)));
      if (worstLinear > config.maxLinearSpeed) {
        return reject(
          'SAFETY_SPEED',
          `${op} 的 limits 前 3 项（柔性轴最大速度）最大值 ${worstLinear} 超过 ${config.maxLinearSpeed} m/s`,
          { worstLinear, limit: config.maxLinearSpeed },
        );
      }
      if (worstJoint > config.maxJointSpeed) {
        return reject(
          'SAFETY_SPEED',
          `${op} 的 limits 后 3 项（刚性轴最大偏差）最大值 ${worstJoint} 超过 ${config.maxJointSpeed}`,
          { worstJoint, limit: config.maxJointSpeed },
        );
      }
    }
    if (hasParam(params, 'task_frame') && !isSixVector(params.task_frame)) {
      return argsReject(op, '的 task_frame 必须是 6 个有限数（力坐标系位姿）');
    }
    if (hasParam(params, 'selection_vector')) {
      const selection = params.selection_vector;
      if (!Array.isArray(selection) || selection.length !== 6
        || !selection.every((item) => item === 0 || item === 1)) {
        return argsReject(op, '的 selection_vector 必须是 6 个 0/1');
      }
    }
  }

  // ⑨ 时长 t（出现即校验：非有限/负值 → SAFETY_ARGS；超上限 → SAFETY_DURATION）。
  if (hasParam(params, 't')) {
    const duration = params.t;
    if (!isFiniteNumber(duration) || duration < 0) {
      return argsReject(op, `的 t 必须是有限且 ≥0 的秒数，实得 ${JSON.stringify(duration)}`);
    }
    if (duration > config.maxDurationS) {
      return reject('SAFETY_DURATION', `${op} 的 t=${duration}s 超过单次时长上限 ${config.maxDurationS}s`, {
        t: duration,
        limit: config.maxDurationS,
      });
    }
  }

  return null;
}

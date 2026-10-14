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
 * ## 这一层能查什么、不能查什么（别把它当安全边界）
 * 能查：结构化运动 op 的**参数幅值**（单步位移、线/关节速度、时长、力控力/力矩）与
 * **显式笛卡尔目标**是否落在声明的工作空间包围盒内。
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

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** 6 维向量（位姿或关节角）必须是 6 个有限数。 */
function isSixVector(value) {
  return Array.isArray(value) && value.length === 6 && value.every(isFiniteNumber);
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

  if (op === 'movej' || op === 'servoj') {
    if (!isSixVector(params.q)) {
      return reject('SAFETY_ARGS', `${op} 的 q 必须是 6 个有限数（弧度）`);
    }
  }
  if (op === 'movej' && isFiniteNumber(params.v) && params.v > config.maxJointSpeed) {
    return reject('SAFETY_SPEED', `movej 的 v=${params.v} rad/s 超过上限 ${config.maxJointSpeed}`, {
      v: params.v,
      limit: config.maxJointSpeed,
    });
  }

  // `move_force` 的 v 是"力控模式下朝目标推进"的线速度，与 movel 同级 —— 同样要限。
  if (op === 'movel' || op === 'movep' || op === 'movec' || op === 'move_force') {
    if (isFiniteNumber(params.v) && params.v > config.maxLinearSpeed) {
      return reject('SAFETY_SPEED', `${op} 的 v=${params.v} m/s 超过上限 ${config.maxLinearSpeed}`, {
        v: params.v,
        limit: config.maxLinearSpeed,
      });
    }
  }

  if (op === 'move_optimized') {
    // ⚠️ 这里的 a/v 是**能力比例** (0,1]，不是物理量 —— 判据只能是区间。
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

  if (op === 'speedj' && Array.isArray(params.qd)) {
    const worst = Math.max(...params.qd.map((x) => Math.abs(x)));
    if (!Number.isFinite(worst) || worst > config.maxJointSpeed) {
      return reject('SAFETY_SPEED', `speedj 的关节角速度最大 ${worst} rad/s 超过上限 ${config.maxJointSpeed}`, {
        worst,
        limit: config.maxJointSpeed,
      });
    }
  }
  if (op === 'speedl' && Array.isArray(params.xd) && params.xd.length === 6) {
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
   * 力/力矩上限。`move_force` 与 `force_mode` 都要过这一关：前者是"在力控模式下朝目标走"，
   * 它施加的力与后者一样会持续压在工件/环境上 —— 幅值写错的后果也一模一样。
   */
  if ((op === 'force_mode' || op === 'move_force')
    && Array.isArray(params.wrench) && params.wrench.length === 6) {
    const forces = params.wrench.slice(0, 3).map((x) => Math.abs(x));
    const torques = params.wrench.slice(3, 6).map((x) => Math.abs(x));
    const worstForce = Math.max(...forces);
    const worstTorque = Math.max(...torques);
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

  if (isFiniteNumber(params.t) && params.t > config.maxDurationS) {
    return reject('SAFETY_DURATION', `${op} 的 t=${params.t}s 超过单次时长上限 ${config.maxDurationS}s`, {
      t: params.t,
      limit: config.maxDurationS,
    });
  }

  return null;
}

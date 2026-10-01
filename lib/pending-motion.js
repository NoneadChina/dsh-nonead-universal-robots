/**
 * 待审批运动的预览（清单第 8 条：**先看后动**）。
 *
 * 所有会动机械臂的工具在下发前都要过人工审批（见 `index.js` 的 `APPROVAL_OPS` 与
 * `requestApproval`）。审批弹窗里给一串数字，人很难判断"它要往哪动"；这里把这次调用的
 * 目标解析成渲染层能直接用的形状，由孪生面板画出来。
 *
 * ## 三类目标，能力递减（**不装作能做做不到的事**）
 *
 * - `joints`：直接给了 6 个绝对关节角 → 可以画整条幽灵臂。
 * - `pose`：只给了目标位姿。本插件没有 IK，**画不出对应姿态的臂** → 退化成在目标位置
 *   放一个标记。
 * - `relative`：给的是相对位移（"沿基座 X 轴走 0.05 m"）。要结合当前 TCP 才能算绝对
 *   目标，而审批发生时客户端未必有同一时刻的 TCP → 只给文字。
 * - `opaque`：画圆/方/星、跑程序、力控、速度指令等 —— 没有单一"目标位姿"可言 → 只给文字。
 *
 * 模块内不做任何 IO，因此全部可单测。
 */

/** 审批流程可能异常中断（进程被杀、弹窗被关掉而回调没跑）；超过这个时长就当作已结束。 */
export const PENDING_MOTION_TTL_MS = 10 * 60 * 1000

/** 给了 6 个绝对关节角的工具。 */
const JOINT_GOAL_OPS = new Set(['ur_movej'])

/** 给了目标位姿的工具（取"终点"那个参数）。 */
const POSE_GOAL_OPS = new Map([
  ['ur_movel', 'pose'],
  ['ur_movep', 'pose'],
  ['ur_movec', 'pose_to'],
])

/** 相对位移工具：轴 + 参考系，只用于生成文字。 */
const RELATIVE_OPS = new Map([
  ['ur_move_x', { axis: 'X', frame: '基座' }],
  ['ur_move_y', { axis: 'Y', frame: '基座' }],
  ['ur_move_z', { axis: 'Z', frame: '基座' }],
  ['ur_move_tool_x', { axis: 'X', frame: '工具' }],
  ['ur_move_tool_y', { axis: 'Y', frame: '工具' }],
  ['ur_move_tool_z', { axis: 'Z', frame: '工具' }],
])

/** 长度参数的显示上限，避免把畸形输入原样塞进界面。 */
const MAX_SUMMARY_LENGTH = 200

function isSixNumbers(value) {
  return Array.isArray(value) && value.length === 6 && value.every(Number.isFinite)
}

function degrees(radians) {
  return (radians * 180) / Math.PI
}

function formatJoints(q) {
  return `J1..J6 ${q.map((v, i) => `J${i + 1} ${degrees(v).toFixed(1)}°`).join('  ')}`
}

function formatPose(pose) {
  const [x, y, z] = pose
  return `TCP [${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}] m`
}

function clip(text) {
  return text.length > MAX_SUMMARY_LENGTH ? `${text.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : text
}

/**
 * 把一次待审批的调用解析成预览。
 *
 * 永不抛错：畸形参数退化成 `opaque` 加一句说明 —— 审批弹窗自己的职责是批准/拒绝，
 * 预览解析失败绝不能把它弄崩。
 *
 * @param {string} toolName 完整工具名（如 `ur_move_x`）
 * @param {unknown} args 该次调用的原始参数
 * @returns {{tool: string, kind: 'joints'|'pose'|'relative'|'opaque',
 *            q?: number[], pose?: number[], axis?: string, frame?: string,
 *            distance?: number, summary: string}}
 */
export function describePendingMotion(toolName, args) {
  const tool = typeof toolName === 'string' ? toolName : ''
  const source = args !== null && typeof args === 'object' ? args : {}

  if (JOINT_GOAL_OPS.has(tool) && isSixNumbers(source.q)) {
    return {
      tool,
      kind: 'joints',
      q: [...source.q],
      summary: clip(`关节运动：${formatJoints(source.q)}`),
    }
  }

  if (tool === 'ur_move_optimized') {
    // 这个工具有两种目标形态，按 goal_type 分流。
    if (source.goal_type === 'joints' && isSixNumbers(source.goal)) {
      return {
        tool,
        kind: 'joints',
        q: [...source.goal],
        summary: clip(`平滑关节运动：${formatJoints(source.goal)}`),
      }
    }
    if (source.goal_type === 'pose' && isSixNumbers(source.goal)) {
      return {
        tool,
        kind: 'pose',
        pose: [...source.goal],
        summary: clip(`平滑直线运动：${formatPose(source.goal)}`),
      }
    }
  }

  const poseKey = POSE_GOAL_OPS.get(tool)
  if (poseKey !== undefined && isSixNumbers(source[poseKey])) {
    const pose = source[poseKey]
    const label = tool === 'ur_movec' ? '圆弧运动终点' : '直线运动'
    return {
      tool,
      kind: 'pose',
      pose: [...pose],
      summary: clip(`${label}：${formatPose(pose)}`),
    }
  }

  const relative = RELATIVE_OPS.get(tool)
  if (relative !== undefined && Number.isFinite(source.distance)) {
    const direction = source.distance >= 0 ? '正向' : '负向'
    return {
      tool,
      kind: 'relative',
      axis: relative.axis,
      frame: relative.frame,
      distance: source.distance,
      summary: clip(
        `沿${relative.frame} ${relative.axis} 轴${direction}移动 ${Math.abs(source.distance).toFixed(4)} m`,
      ),
    }
  }

  return {
    tool,
    kind: 'opaque',
    summary: clip(`该动作没有单一目标位姿（${tool || '未知工具'}），请在执行前确认现场安全。`),
  }
}

/**
 * 待审批状态：`index.js` 写、`twin-routes.js` 读。
 *
 * @param {{now?: () => number, ttlMs?: number}} [options]
 */
export function createPendingMotionStore(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : PENDING_MOTION_TTL_MS
  let current = null

  return {
    /**
     * 记下一次待审批，返回**本次专属的 token**。
     *
     * token 让 `end` 只清自己那一次：两次审批重叠时，先结束的那次不该把后一次的预览抹掉。
     */
    begin(toolName, args) {
      const token = { tool: toolName }
      current = { token, preview: describePendingMotion(toolName, args), startedAt: now() }
      return token
    },

    /** 结束一次待审批；token 不匹配（已被后一次覆盖）就什么都不做。 */
    end(token) {
      if (current !== null && current.token === token) current = null
    },

    /**
     * 读当前的待审批预览；没有、或已超过 TTL 时返回 `null`。
     *
     * 超时即视为结束 —— 审批流程被异常中断时，界面不该永远挂着一层"待审批"的假目标。
     */
    read() {
      if (current === null) return null
      if (!Number.isFinite(current.startedAt) || now() - current.startedAt > ttlMs) {
        current = null
        return null
      }
      return current.preview
    },

    /** 无条件清空（插件卸载等场合）。 */
    clear() {
      current = null
    },
  }
}

/**
 * 进程内单例。
 *
 * `index.js`（审批）与 `twin-routes.js`（快照）是两个模块，需要一个共同的落点；
 * 做成单例比让它们互相 import 更简单，也避免把状态挂在 ctx 上。
 */
export const pendingMotion = createPendingMotionStore()

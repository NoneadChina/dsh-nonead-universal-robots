/**
 * 客户端文案表（清单第 15 条：i18n）。
 *
 * ## 为什么是自建而不是用 `@deepseek-ai/dsh-client-locale`
 *
 * 该包**没有安装**，harness 里也不存在同名包；`dsh-community-market` 与
 * `dsh-nonead-client-skin` 里只有一句 `import type {} from '@deepseek-ai/dsh-client-locale/client'`
 * —— 那是**类型增强**，没有任何实际调用可供参照。赌一个看不见的 API 风险太高，所以
 * 这里自建一张表：结构简单、可单测、零依赖。
 *
 * ## 与既有导出的关系
 *
 * `twin-panel.js` 里的 `STATUS_*` 等常量有大量既有测试断言它们。所以那些常量**保持原样**
 * （中文），而**运行时**走本表的 `stringsFor(locale)`。这样双语可用、断言不破。
 *
 * ## 结构约定
 *
 * `zh` 与 `en` 必须是**完全对称**的键集合（有测试钉住），带插值的键写成函数。
 */

/** 中文文案（也是缺省语言）。 */
export const zh = {
  /* ---- 连接状态（STATUS_* 的运行时对应） ---- */
  statusDisconnected: '未连接机器人',
  statusLoading: '已连接 · 正在加载模型…',
  statusConnected: '已连接',
  statusFallbackSuffix: '（无内置模型，使用近似几何体）',
  statusErrorPrefix: '渲染异常：',
  statusLoadFailed: '模型加载失败：',
  statusNoWebgl: '当前环境不支持 WebGL：已切换为纯数值模式（关节角与 TCP 仍会更新）',
  statusIncomplete: '机器人未返回完整的关节角',
  statusContextLost: '3D 上下文丢失（GPU 重置）—— 收起并重新展开面板可恢复',
  statusSafetyHint: '机器人可能已停止，请检查示教器',

  /* ---- 未连接原因 ---- */
  disconnectNeverConnected: '未连接机器人：还没有成功执行过 ur_connect',
  disconnectReason: (reason) => `机器人未连接${reason ? `：${reason}` : ''}`,
  disconnectAmbiguous: (candidates) => `检测到多台已连接机器人，请指定机器人 IP${candidates}`,
  disconnectCandidates: (ips) => (Array.isArray(ips) && ips.length > 0 ? `（候选：${ips.join('、')}）` : ''),
  disconnectWorkerDown: (reason) => `UR 控制进程不可用${reason ? `：${reason}` : ''}（可运行 ur_ping 自检 Python 依赖）`,
  disconnectReadFailed: (reason) => `读取机器人状态失败${reason ? `：${reason}` : ''}`,

  /* ---- 读数前缀 ---- */
  jointsPrefix: '关节角 (°)',
  tcpPrefix: 'TCP(米/轴角弧度)',
  queryFailed: '查询失败',
  detailStatusFailed: (error) => `状态查询失败：${error}`,
  detailSafety: (mode) => `安全 ${mode}`,
  detailRobotMode: (mode) => `模式 ${mode}`,
  detailProgram: (state) => `程序 ${state}`,
  detailSpeed: (value) => `速度 ${value}`,
  detailRunning: '运行中',
  detailTempsPrefix: '温度(°C)',
  detailTemps: (row) => `温度(°C)  ${row}`,
  detailBus: (voltage, current) => `母线 ${voltage} V  ${current} A`,

  /* ---- 关节限位 ---- */
  overLimit: (joints) => `⚠ 超限 ${joints}`,

  /* ---- 机器人模式枚举（与 python 侧字符串一一对应） ---- */
  safetyMode: {
    NORMAL: '正常',
    REDUCED: '缩减模式',
    PROTECTIVE_STOP: '保护性停止',
    SAFEGUARD_STOP: '安全停止',
    EMERGENCY_STOP: '急停',
    SYSTEM_EMERGENCY_STOP: '系统急停',
    ROBOT_EMERGENCY_STOP: '机器人急停',
    RECOVERY: '恢复中',
    VIOLATION: '违反安全限制',
    FAULT: '故障',
    AUTOMATIC_MODE_SAFEGUARD_STOP: '自动模式安全停止',
    SYSTEM_THREE_POSITION_ENABLING_STOP: '三位使能停止',
  },
  robotMode: {
    POWER_OFF: '已下电',
    POWER_ON: '已上电',
    IDLE: '空闲',
    BACKDRIVE: '拖动',
    RUNNING: '运行中',
    BOOTING: '启动中',
    CONFIRM_SAFETY: '待确认安全',
    DISCONNECTED: '未连接',
    NO_CONTROLLER: '无控制器',
  },
  programState: {
    STOPPED: '已停止',
    PLAYING: '运行中',
    PAUSED: '已暂停',
  },

  /* ---- 视角预设（与 VIEW_BUTTONS / VIEW_PRESETS 的 key 对应） ---- */
  viewReset: '重置视角',
  viewIso: '等轴测',
  viewFront: '前视',
  viewSide: '侧视',
  viewTop: '俯视',

  /* ---- HUD 与工具条 ---- */
  identity: (model, ip) => `机器人  ${[model, ip].filter(Boolean).join('  ·  ')}`,
  pendingPrefix: '待审批',
  canvasLabel: '机器人数字孪生 3D 视图；可用方向键切换视角',
  hudLabel: '机器人实时读数',
  layerReach: '可达范围',
  layerBase: '基座系',
  layerForce: '受力',
  screenshot: '截图',
  screenshotLabel: '导出带水印的截图',
  trajectoryClear: '清轨迹',
  trajectoryPause: '暂停轨迹',
  trajectoryResume: '继续记录',
  trajectoryExport: '导出轨迹',

  /* ---- 右侧 dock 入口 ---- */
  dockLabel: 'UR 数字孪生',
  dockDescription: '机器人实时孪生视图',
  dockCollapse: '收起',
}

/** 英文文案。键集合必须与 `zh` 完全一致（有测试钉住）。 */
export const en = {
  statusDisconnected: 'Robot not connected',
  statusLoading: 'Connected · loading model…',
  statusConnected: 'Connected',
  statusFallbackSuffix: ' (no built-in model, using approximate geometry)',
  statusErrorPrefix: 'Render error: ',
  statusLoadFailed: 'Model failed to load: ',
  statusNoWebgl: 'WebGL is unavailable here: switched to numeric-only mode (joint angles and TCP keep updating)',
  statusIncomplete: 'The robot did not return a full set of joint angles',
  statusContextLost: '3D context lost (GPU reset) — collapse and reopen the panel to recover',
  statusSafetyHint: 'The robot may have stopped; check the teach pendant',

  disconnectNeverConnected: 'Robot not connected: ur_connect has never succeeded',
  disconnectReason: (reason) => `Robot not connected${reason ? `: ${reason}` : ''}`,
  disconnectAmbiguous: (candidates) => `More than one robot is connected; specify the robot IP${candidates}`,
  disconnectCandidates: (ips) => (Array.isArray(ips) && ips.length > 0 ? ` (candidates: ${ips.join(', ')})` : ''),
  disconnectWorkerDown: (reason) => `The UR control process is unavailable${reason ? `: ${reason}` : ''} (run ur_ping to check the Python dependencies)`,
  disconnectReadFailed: (reason) => `Failed to read the robot state${reason ? `: ${reason}` : ''}`,

  jointsPrefix: 'Joint angles (°)',
  tcpPrefix: 'TCP (m / axis-angle rad)',
  queryFailed: 'query failed',
  detailStatusFailed: (error) => `Status query failed: ${error}`,
  detailSafety: (mode) => `Safety ${mode}`,
  detailRobotMode: (mode) => `Mode ${mode}`,
  detailProgram: (state) => `Program ${state}`,
  detailSpeed: (value) => `Speed ${value}`,
  detailRunning: 'Running',
  detailTempsPrefix: 'Temp (°C)',
  detailTemps: (row) => `Temp (°C)  ${row}`,
  detailBus: (voltage, current) => `Bus ${voltage} V  ${current} A`,

  overLimit: (joints) => `⚠ over limit ${joints}`,

  safetyMode: {
    NORMAL: 'Normal',
    REDUCED: 'Reduced',
    PROTECTIVE_STOP: 'Protective stop',
    SAFEGUARD_STOP: 'Safeguard stop',
    EMERGENCY_STOP: 'Emergency stop',
    SYSTEM_EMERGENCY_STOP: 'System emergency stop',
    ROBOT_EMERGENCY_STOP: 'Robot emergency stop',
    RECOVERY: 'Recovery',
    VIOLATION: 'Safety violation',
    FAULT: 'Fault',
    AUTOMATIC_MODE_SAFEGUARD_STOP: 'Automatic-mode safeguard stop',
    SYSTEM_THREE_POSITION_ENABLING_STOP: 'Three-position enabling stop',
  },
  robotMode: {
    POWER_OFF: 'Power off',
    POWER_ON: 'Power on',
    IDLE: 'Idle',
    BACKDRIVE: 'Backdrive',
    RUNNING: 'Running',
    BOOTING: 'Booting',
    CONFIRM_SAFETY: 'Confirm safety',
    DISCONNECTED: 'Disconnected',
    NO_CONTROLLER: 'No controller',
  },
  programState: {
    STOPPED: 'Stopped',
    PLAYING: 'Playing',
    PAUSED: 'Paused',
  },

  viewReset: 'Reset view',
  viewIso: 'Isometric',
  viewFront: 'Front',
  viewSide: 'Side',
  viewTop: 'Top',

  identity: (model, ip) => `Robot  ${[model, ip].filter(Boolean).join('  ·  ')}`,
  pendingPrefix: 'Pending approval',
  canvasLabel: 'Robot digital-twin 3D view; arrow keys switch the view',
  hudLabel: 'Live robot readouts',
  layerReach: 'Reach',
  layerBase: 'Base frame',
  layerForce: 'Force',
  screenshot: 'Screenshot',
  screenshotLabel: 'Export a watermarked screenshot',
  trajectoryClear: 'Clear path',
  trajectoryPause: 'Pause path',
  trajectoryResume: 'Resume path',
  trajectoryExport: 'Export path',

  dockLabel: 'UR digital twin',
  dockDescription: 'Live robot twin view',
  dockCollapse: 'Collapse',
}

/** 支持的语言。 */
export const SUPPORTED_LOCALES = Object.freeze(['zh', 'en'])

/** 缺省语言（拿不到任何线索时用中文 —— 产品的主用户群）。 */
export const DEFAULT_LOCALE = 'zh'

/**
 * 把一个 BCP-47 语言标签规整成受支持的语言。
 *
 * 只认主语言子标签（`zh-CN` → `zh`、`en-US` → `en`）；繁体（`zh-TW`/`zh-Hant`）也先归到
 * `zh` —— 有繁体词条时再细化，但**绝不能因为认不出就退回英文**（那对中文用户是退化）。
 *
 * @param {string} tag 例如 `navigator.language`
 * @returns {'zh'|'en'} 受支持的语言
 */
export function resolveLocale(tag) {
  if (typeof tag !== 'string' || tag.trim() === '') return DEFAULT_LOCALE
  const primary = tag.trim().toLowerCase().split(/[-_]/u)[0]
  return SUPPORTED_LOCALES.includes(primary) ? primary : DEFAULT_LOCALE
}

/**
 * 取某个语言的文案表；语言不可识别时回退缺省语言。
 *
 * @param {string} locale
 * @returns {typeof zh}
 */
export function stringsFor(locale) {
  return resolveLocale(locale) === 'en' ? en : zh
}

/**
 * 按运行环境的语言线索取文案表。
 *
 * @param {object} [env] 注入点（测试用）；缺省读 `globalThis.navigator`
 * @returns {typeof zh}
 */
export function activeStrings(env) {
  const navigatorLike = env ?? globalThis.navigator
  return stringsFor(navigatorLike?.language)
}

/**
 * 客户端文案表（清单第 15 条：i18n）—— 8 种语言。
 *
 * ## 语言与「与桌面程序语言一致」
 *
 * 宿主自带 `@deepseek-ai/dsh-client-locale`（它自己的 locale 目录就是 zh/en/ja/es/fr/de/ru/pt）：
 * 用户在 DSH 设置里选的语言会持久化为 `locale.preference`，并通过 `locale/change` 事件即时生效。
 * 所以本模块把**语言偏好来源**按优先级排成：
 *
 *   1. 宿主 locale 服务当前语言（`activeStrings({ locale: 'ja' })` 或 `useHostLocale(ctx)`）；
 *   2. `navigator.language`（浏览器形态 / 宿主未注入时）；
 *   3. `DEFAULT_LOCALE`（中文 —— 产品主用户群；**绝不因为认不出就退回英文**）。
 *
 * ⚠️ 宿主侧语言 id 是 `pt`（含 pt-PT 浏览器请求），本项目按需求填**巴西葡萄牙语**用词。
 *
 * ## 为什么仍然保留这张自建表
 *
 * 宿主 API 是 `ctx.locale.register(ns, {zh, en, ja, …})` + `ctx.locale.bind(ns)`。本表就是**同一份
 * 字典**的纯数据形态：既能（在宿主可用时）交给 `registerWithLocale()` 注册进去，也能在宿主
 * 未注入（单测、独立浏览器、旧宿主）时由 `stringsFor()` 直接取用。两条路共用同一份词条，
 * 不会出现"注册的"和"自带的不一致"。
 *
 * ## 结构约定
 *
 * 8 种语言的**键集合必须完全一致**（有测试钉住），带插值的键写成函数。
 */

/** 简体中文（缺省语言）。 */
export const zh = {
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

  disconnectNeverConnected: '未连接机器人：还没有成功执行过 ur_connect',
  disconnectReason: (reason) => `机器人未连接${reason ? `：${reason}` : ''}`,
  disconnectAmbiguous: (candidates) => `检测到多台已连接机器人，请指定机器人 IP${candidates}`,
  disconnectCandidates: (ips) => (Array.isArray(ips) && ips.length > 0 ? `（候选：${ips.join('、')}）` : ''),
  disconnectWorkerDown: (reason) => `UR 控制进程不可用${reason ? `：${reason}` : ''}（可运行 ur_ping 自检 Python 依赖）`,
  disconnectReadFailed: (reason) => `读取机器人状态失败${reason ? `：${reason}` : ''}`,

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

  overLimit: (joints) => `⚠ 超限 ${joints}`,

  /* ---- 数据通道健康（孪生「停更/重连」，出现在 HUD 顶部那一行） ---- */
  feedStale: '数据已停止更新',
  feedRetrying: '数据通道重连中…',
  feedRetryWord: '正在重试',
  feedNoEventSource: '当前环境没有 EventSource',
  feedFrames: (frames, errors) => `（已收 ${frames} 帧${errors > 0 ? `，失败 ${errors} 帧` : ''}）`,

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

  viewReset: '重置视角',
  viewIso: '等轴测',
  viewFront: '前视',
  viewSide: '侧视',
  viewTop: '俯视',

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

  dockLabel: 'UR 数字孪生',
  dockDescription: '机器人实时孪生视图',
  dockCollapse: '收起',
}

/** English. */
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

  feedStale: 'Data has stopped updating',
  feedRetrying: 'Reconnecting the data channel…',
  feedRetryWord: 'retrying',
  feedNoEventSource: 'EventSource is unavailable here',
  feedFrames: (frames, errors) => ` (${frames} frames${errors > 0 ? `, ${errors} failed` : ''})`,

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

/** 日本語。 */
export const ja = {
  statusDisconnected: 'ロボット未接続',
  statusLoading: '接続済み · モデルを読み込み中…',
  statusConnected: '接続済み',
  statusFallbackSuffix: '（組み込みモデルがないため近似形状を使用）',
  statusErrorPrefix: '描画エラー：',
  statusLoadFailed: 'モデルの読み込みに失敗：',
  statusNoWebgl: 'この環境では WebGL を利用できません：数値のみのモードに切り替えました（関節角と TCP は更新を続けます）',
  statusIncomplete: 'ロボットから完全な関節角が返されませんでした',
  statusContextLost: '3D コンテキストが失われました（GPU リセット）—— パネルを折りたたんで開き直すと復帰します',
  statusSafetyHint: 'ロボットが停止している可能性があります。ティーチペンダントを確認してください',

  disconnectNeverConnected: 'ロボット未接続：ur_connect がまだ一度も成功していません',
  disconnectReason: (reason) => `ロボット未接続${reason ? `：${reason}` : ''}`,
  disconnectAmbiguous: (candidates) => `複数のロボットが接続されています。ロボットの IP を指定してください${candidates}`,
  disconnectCandidates: (ips) => (Array.isArray(ips) && ips.length > 0 ? `（候補：${ips.join('、')}）` : ''),
  disconnectWorkerDown: (reason) => `UR 制御プロセスを利用できません${reason ? `：${reason}` : ''}（ur_ping で Python 依存関係を確認できます）`,
  disconnectReadFailed: (reason) => `ロボット状態の読み取りに失敗${reason ? `：${reason}` : ''}`,

  jointsPrefix: '関節角 (°)',
  tcpPrefix: 'TCP(メートル/軸角ラジアン)',
  queryFailed: 'クエリ失敗',
  detailStatusFailed: (error) => `状態クエリ失敗：${error}`,
  detailSafety: (mode) => `安全 ${mode}`,
  detailRobotMode: (mode) => `モード ${mode}`,
  detailProgram: (state) => `プログラム ${state}`,
  detailSpeed: (value) => `速度 ${value}`,
  detailRunning: '実行中',
  detailTempsPrefix: '温度(°C)',
  detailTemps: (row) => `温度(°C)  ${row}`,
  detailBus: (voltage, current) => `母線 ${voltage} V  ${current} A`,

  overLimit: (joints) => `⚠ 上限超過 ${joints}`,

  feedStale: 'データの更新が停止しました',
  feedRetrying: 'データチャネルを再接続中…',
  feedRetryWord: '再試行中',
  feedNoEventSource: 'この環境には EventSource がありません',
  feedFrames: (frames, errors) => `（受信 ${frames} フレーム${errors > 0 ? `、失敗 ${errors} フレーム` : ''}）`,

  safetyMode: {
    NORMAL: '正常',
    REDUCED: '縮小モード',
    PROTECTIVE_STOP: '保護停止',
    SAFEGUARD_STOP: 'セーフガード停止',
    EMERGENCY_STOP: '緊急停止',
    SYSTEM_EMERGENCY_STOP: 'システム緊急停止',
    ROBOT_EMERGENCY_STOP: 'ロボット緊急停止',
    RECOVERY: '復帰中',
    VIOLATION: '安全制限違反',
    FAULT: '故障',
    AUTOMATIC_MODE_SAFEGUARD_STOP: '自動モードのセーフガード停止',
    SYSTEM_THREE_POSITION_ENABLING_STOP: '3 位置イネーブル停止',
  },
  robotMode: {
    POWER_OFF: '電源オフ',
    POWER_ON: '電源オン',
    IDLE: 'アイドル',
    BACKDRIVE: 'バックドライブ',
    RUNNING: '実行中',
    BOOTING: '起動中',
    CONFIRM_SAFETY: '安全の確認待ち',
    DISCONNECTED: '未接続',
    NO_CONTROLLER: 'コントローラなし',
  },
  programState: {
    STOPPED: '停止',
    PLAYING: '実行中',
    PAUSED: '一時停止',
  },

  viewReset: '視点をリセット',
  viewIso: '等角投影',
  viewFront: '正面',
  viewSide: '側面',
  viewTop: '上面',

  identity: (model, ip) => `ロボット  ${[model, ip].filter(Boolean).join('  ·  ')}`,
  pendingPrefix: '承認待ち',
  canvasLabel: 'ロボットデジタルツインの 3D ビュー；矢印キーで視点を切り替え',
  hudLabel: 'ロボットのリアルタイム値',
  layerReach: '到達範囲',
  layerBase: 'ベース座標系',
  layerForce: '力',
  screenshot: 'スクリーンショット',
  screenshotLabel: '透かし入りのスクリーンショットを書き出す',
  trajectoryClear: '軌跡を消去',
  trajectoryPause: '軌跡を一時停止',
  trajectoryResume: '記録を再開',
  trajectoryExport: '軌跡を書き出す',

  dockLabel: 'UR デジタルツイン',
  dockDescription: 'ロボットのリアルタイムツイン表示',
  dockCollapse: '折りたたむ',
}

/** Español. */
export const es = {
  statusDisconnected: 'Robot no conectado',
  statusLoading: 'Conectado · cargando modelo…',
  statusConnected: 'Conectado',
  statusFallbackSuffix: ' (sin modelo integrado; se usa geometría aproximada)',
  statusErrorPrefix: 'Error de renderizado: ',
  statusLoadFailed: 'No se pudo cargar el modelo: ',
  statusNoWebgl: 'WebGL no está disponible aquí: se cambió al modo solo numérico (los ángulos de las articulaciones y el TCP siguen actualizándose)',
  statusIncomplete: 'El robot no devolvió el conjunto completo de ángulos de articulación',
  statusContextLost: 'Se perdió el contexto 3D (reinicio de la GPU) — contraiga y vuelva a abrir el panel para recuperarlo',
  statusSafetyHint: 'Es posible que el robot se haya detenido; revise el teach pendant',

  disconnectNeverConnected: 'Robot no conectado: ur_connect nunca se ha ejecutado con éxito',
  disconnectReason: (reason) => `Robot no conectado${reason ? `: ${reason}` : ''}`,
  disconnectAmbiguous: (candidates) => `Hay más de un robot conectado; indique la IP del robot${candidates}`,
  disconnectCandidates: (ips) => (Array.isArray(ips) && ips.length > 0 ? ` (candidatos: ${ips.join(', ')})` : ''),
  disconnectWorkerDown: (reason) => `El proceso de control de UR no está disponible${reason ? `: ${reason}` : ''} (ejecute ur_ping para comprobar las dependencias de Python)`,
  disconnectReadFailed: (reason) => `No se pudo leer el estado del robot${reason ? `: ${reason}` : ''}`,

  jointsPrefix: 'Ángulos de articulación (°)',
  tcpPrefix: 'TCP (m / rad de eje-ángulo)',
  queryFailed: 'consulta fallida',
  detailStatusFailed: (error) => `Falló la consulta de estado: ${error}`,
  detailSafety: (mode) => `Seguridad ${mode}`,
  detailRobotMode: (mode) => `Modo ${mode}`,
  detailProgram: (state) => `Programa ${state}`,
  detailSpeed: (value) => `Velocidad ${value}`,
  detailRunning: 'En ejecución',
  detailTempsPrefix: 'Temp (°C)',
  detailTemps: (row) => `Temp (°C)  ${row}`,
  detailBus: (voltage, current) => `Bus ${voltage} V  ${current} A`,

  overLimit: (joints) => `⚠ fuera de límite ${joints}`,

  feedStale: 'Los datos dejaron de actualizarse',
  feedRetrying: 'Reconectando el canal de datos…',
  feedRetryWord: 'reintentando',
  feedNoEventSource: 'EventSource no está disponible aquí',
  feedFrames: (frames, errors) => ` (${frames} tramas${errors > 0 ? `, ${errors} con error` : ''})`,

  safetyMode: {
    NORMAL: 'Normal',
    REDUCED: 'Reducido',
    PROTECTIVE_STOP: 'Parada de protección',
    SAFEGUARD_STOP: 'Parada de salvaguarda',
    EMERGENCY_STOP: 'Parada de emergencia',
    SYSTEM_EMERGENCY_STOP: 'Parada de emergencia del sistema',
    ROBOT_EMERGENCY_STOP: 'Parada de emergencia del robot',
    RECOVERY: 'Recuperación',
    VIOLATION: 'Violación de seguridad',
    FAULT: 'Fallo',
    AUTOMATIC_MODE_SAFEGUARD_STOP: 'Parada de salvaguarda en modo automático',
    SYSTEM_THREE_POSITION_ENABLING_STOP: 'Parada de habilitación de tres posiciones',
  },
  robotMode: {
    POWER_OFF: 'Apagado',
    POWER_ON: 'Encendido',
    IDLE: 'Inactivo',
    BACKDRIVE: 'Arrastre manual',
    RUNNING: 'En ejecución',
    BOOTING: 'Arrancando',
    CONFIRM_SAFETY: 'Confirmar seguridad',
    DISCONNECTED: 'Desconectado',
    NO_CONTROLLER: 'Sin controlador',
  },
  programState: {
    STOPPED: 'Detenido',
    PLAYING: 'En ejecución',
    PAUSED: 'Pausado',
  },

  viewReset: 'Restablecer vista',
  viewIso: 'Isométrica',
  viewFront: 'Frontal',
  viewSide: 'Lateral',
  viewTop: 'Superior',

  identity: (model, ip) => `Robot  ${[model, ip].filter(Boolean).join('  ·  ')}`,
  pendingPrefix: 'Aprobación pendiente',
  canvasLabel: 'Vista 3D del gemelo digital del robot; las flechas cambian la vista',
  hudLabel: 'Lecturas del robot en vivo',
  layerReach: 'Alcance',
  layerBase: 'Sistema base',
  layerForce: 'Fuerza',
  screenshot: 'Captura',
  screenshotLabel: 'Exportar una captura con marca de agua',
  trajectoryClear: 'Borrar trayectoria',
  trajectoryPause: 'Pausar trayectoria',
  trajectoryResume: 'Reanudar registro',
  trajectoryExport: 'Exportar trayectoria',

  dockLabel: 'Gemelo digital UR',
  dockDescription: 'Vista en vivo del gemelo del robot',
  dockCollapse: 'Contraer',
}

/** Français. */
export const fr = {
  statusDisconnected: 'Robot non connecté',
  statusLoading: 'Connecté · chargement du modèle…',
  statusConnected: 'Connecté',
  statusFallbackSuffix: ' (aucun modèle intégré, géométrie approchée utilisée)',
  statusErrorPrefix: 'Erreur de rendu : ',
  statusLoadFailed: 'Échec du chargement du modèle : ',
  statusNoWebgl: "WebGL n'est pas disponible ici : passage en mode numérique seul (les angles d'articulation et le TCP continuent d'être actualisés)",
  statusIncomplete: "Le robot n'a pas renvoyé l'ensemble complet des angles d'articulation",
  statusContextLost: 'Contexte 3D perdu (réinitialisation du GPU) — repliez puis rouvrez le panneau pour le récupérer',
  statusSafetyHint: 'Le robot a peut-être été arrêté ; vérifiez le teach pendant',

  disconnectNeverConnected: "Robot non connecté : ur_connect n'a jamais réussi",
  disconnectReason: (reason) => `Robot non connecté${reason ? ` : ${reason}` : ''}`,
  disconnectAmbiguous: (candidates) => `Plusieurs robots sont connectés ; précisez l'adresse IP du robot${candidates}`,
  disconnectCandidates: (ips) => (Array.isArray(ips) && ips.length > 0 ? ` (candidats : ${ips.join(', ')})` : ''),
  disconnectWorkerDown: (reason) => `Le processus de contrôle UR est indisponible${reason ? ` : ${reason}` : ''} (exécutez ur_ping pour vérifier les dépendances Python)`,
  disconnectReadFailed: (reason) => `Échec de la lecture de l'état du robot${reason ? ` : ${reason}` : ''}`,

  jointsPrefix: "Angles d'articulation (°)",
  tcpPrefix: 'TCP (m / rad axe-angle)',
  queryFailed: 'échec de la requête',
  detailStatusFailed: (error) => `Échec de la requête d'état : ${error}`,
  detailSafety: (mode) => `Sécurité ${mode}`,
  detailRobotMode: (mode) => `Mode ${mode}`,
  detailProgram: (state) => `Programme ${state}`,
  detailSpeed: (value) => `Vitesse ${value}`,
  detailRunning: 'En cours',
  detailTempsPrefix: 'Temp (°C)',
  detailTemps: (row) => `Temp (°C)  ${row}`,
  detailBus: (voltage, current) => `Bus ${voltage} V  ${current} A`,

  overLimit: (joints) => `⚠ hors limite ${joints}`,

  feedStale: 'Les données ne se mettent plus à jour',
  feedRetrying: 'Reconnexion du canal de données…',
  feedRetryWord: 'nouvelle tentative',
  feedNoEventSource: "EventSource n'est pas disponible ici",
  feedFrames: (frames, errors) => ` (${frames} trames${errors > 0 ? `, ${errors} en échec` : ''})`,

  safetyMode: {
    NORMAL: 'Normal',
    REDUCED: 'Réduit',
    PROTECTIVE_STOP: 'Arrêt de protection',
    SAFEGUARD_STOP: 'Arrêt de sécurité',
    EMERGENCY_STOP: "Arrêt d'urgence",
    SYSTEM_EMERGENCY_STOP: "Arrêt d'urgence système",
    ROBOT_EMERGENCY_STOP: "Arrêt d'urgence du robot",
    RECOVERY: 'Récupération',
    VIOLATION: 'Violation de sécurité',
    FAULT: 'Défaut',
    AUTOMATIC_MODE_SAFEGUARD_STOP: 'Arrêt de sécurité en mode automatique',
    SYSTEM_THREE_POSITION_ENABLING_STOP: 'Arrêt de validation à trois positions',
  },
  robotMode: {
    POWER_OFF: 'Hors tension',
    POWER_ON: 'Sous tension',
    IDLE: 'Inactif',
    BACKDRIVE: 'Déplacement manuel',
    RUNNING: 'En cours',
    BOOTING: 'Démarrage',
    CONFIRM_SAFETY: 'Confirmer la sécurité',
    DISCONNECTED: 'Déconnecté',
    NO_CONTROLLER: 'Aucun contrôleur',
  },
  programState: {
    STOPPED: 'Arrêté',
    PLAYING: 'En cours',
    PAUSED: 'En pause',
  },

  viewReset: 'Réinitialiser la vue',
  viewIso: 'Isométrique',
  viewFront: 'Face',
  viewSide: 'Côté',
  viewTop: 'Dessus',

  identity: (model, ip) => `Robot  ${[model, ip].filter(Boolean).join('  ·  ')}`,
  pendingPrefix: 'Approbation en attente',
  canvasLabel: 'Vue 3D du jumeau numérique du robot ; les flèches changent la vue',
  hudLabel: 'Mesures du robot en direct',
  layerReach: 'Portée',
  layerBase: 'Repère de base',
  layerForce: 'Effort',
  screenshot: 'Capture',
  screenshotLabel: 'Exporter une capture avec filigrane',
  trajectoryClear: 'Effacer la trajectoire',
  trajectoryPause: 'Mettre la trajectoire en pause',
  trajectoryResume: "Reprendre l'enregistrement",
  trajectoryExport: 'Exporter la trajectoire',

  dockLabel: 'Jumeau numérique UR',
  dockDescription: 'Vue en direct du jumeau du robot',
  dockCollapse: 'Replier',
}

/** Deutsch. */
export const de = {
  statusDisconnected: 'Roboter nicht verbunden',
  statusLoading: 'Verbunden · Modell wird geladen…',
  statusConnected: 'Verbunden',
  statusFallbackSuffix: ' (kein eingebautes Modell, vereinfachte Geometrie wird verwendet)',
  statusErrorPrefix: 'Darstellungsfehler: ',
  statusLoadFailed: 'Modell konnte nicht geladen werden: ',
  statusNoWebgl: 'WebGL ist hier nicht verfügbar: auf reinen Zahlenmodus umgeschaltet (Gelenkwinkel und TCP werden weiter aktualisiert)',
  statusIncomplete: 'Der Roboter hat keinen vollständigen Satz Gelenkwinkel zurückgegeben',
  statusContextLost: '3D-Kontext verloren (GPU-Reset) — Panel einklappen und erneut öffnen, um ihn wiederherzustellen',
  statusSafetyHint: 'Der Roboter wurde möglicherweise gestoppt; prüfen Sie das Teach-Pendant',

  disconnectNeverConnected: 'Roboter nicht verbunden: ur_connect war noch nie erfolgreich',
  disconnectReason: (reason) => `Roboter nicht verbunden${reason ? `: ${reason}` : ''}`,
  disconnectAmbiguous: (candidates) => `Es ist mehr als ein Roboter verbunden; geben Sie die Roboter-IP an${candidates}`,
  disconnectCandidates: (ips) => (Array.isArray(ips) && ips.length > 0 ? ` (Kandidaten: ${ips.join(', ')})` : ''),
  disconnectWorkerDown: (reason) => `Der UR-Steuerprozess ist nicht verfügbar${reason ? `: ${reason}` : ''} (führen Sie ur_ping aus, um die Python-Abhängigkeiten zu prüfen)`,
  disconnectReadFailed: (reason) => `Roboterstatus konnte nicht gelesen werden${reason ? `: ${reason}` : ''}`,

  jointsPrefix: 'Gelenkwinkel (°)',
  tcpPrefix: 'TCP (m / Achsenwinkel rad)',
  queryFailed: 'Abfrage fehlgeschlagen',
  detailStatusFailed: (error) => `Statusabfrage fehlgeschlagen: ${error}`,
  detailSafety: (mode) => `Sicherheit ${mode}`,
  detailRobotMode: (mode) => `Modus ${mode}`,
  detailProgram: (state) => `Programm ${state}`,
  detailSpeed: (value) => `Geschwindigkeit ${value}`,
  detailRunning: 'Läuft',
  detailTempsPrefix: 'Temp (°C)',
  detailTemps: (row) => `Temp (°C)  ${row}`,
  detailBus: (voltage, current) => `Bus ${voltage} V  ${current} A`,

  overLimit: (joints) => `⚠ über Grenzwert ${joints}`,

  feedStale: 'Die Daten werden nicht mehr aktualisiert',
  feedRetrying: 'Datenkanal wird neu verbunden…',
  feedRetryWord: 'erneuter Versuch',
  feedNoEventSource: 'EventSource ist hier nicht verfügbar',
  feedFrames: (frames, errors) => ` (${frames} Frames${errors > 0 ? `, ${errors} fehlgeschlagen` : ''})`,

  safetyMode: {
    NORMAL: 'Normal',
    REDUCED: 'Reduziert',
    PROTECTIVE_STOP: 'Schutzstopp',
    SAFEGUARD_STOP: 'Sicherheitsstopp',
    EMERGENCY_STOP: 'Not-Halt',
    SYSTEM_EMERGENCY_STOP: 'System-Not-Halt',
    ROBOT_EMERGENCY_STOP: 'Roboter-Not-Halt',
    RECOVERY: 'Wiederherstellung',
    VIOLATION: 'Sicherheitsverletzung',
    FAULT: 'Störung',
    AUTOMATIC_MODE_SAFEGUARD_STOP: 'Sicherheitsstopp im Automatikmodus',
    SYSTEM_THREE_POSITION_ENABLING_STOP: 'Drei-Stellungen-Freigabestopp',
  },
  robotMode: {
    POWER_OFF: 'Ausgeschaltet',
    POWER_ON: 'Eingeschaltet',
    IDLE: 'Leerlauf',
    BACKDRIVE: 'Handführung',
    RUNNING: 'Läuft',
    BOOTING: 'Startet',
    CONFIRM_SAFETY: 'Sicherheit bestätigen',
    DISCONNECTED: 'Nicht verbunden',
    NO_CONTROLLER: 'Keine Steuerung',
  },
  programState: {
    STOPPED: 'Gestoppt',
    PLAYING: 'Läuft',
    PAUSED: 'Pausiert',
  },

  viewReset: 'Ansicht zurücksetzen',
  viewIso: 'Isometrisch',
  viewFront: 'Vorne',
  viewSide: 'Seite',
  viewTop: 'Oben',

  identity: (model, ip) => `Roboter  ${[model, ip].filter(Boolean).join('  ·  ')}`,
  pendingPrefix: 'Freigabe ausstehend',
  canvasLabel: '3D-Ansicht des digitalen Zwillings; Pfeiltasten wechseln die Ansicht',
  hudLabel: 'Live-Messwerte des Roboters',
  layerReach: 'Reichweite',
  layerBase: 'Basiskoordinatensystem',
  layerForce: 'Kraft',
  screenshot: 'Screenshot',
  screenshotLabel: 'Screenshot mit Wasserzeichen exportieren',
  trajectoryClear: 'Bahn löschen',
  trajectoryPause: 'Bahn pausieren',
  trajectoryResume: 'Aufzeichnung fortsetzen',
  trajectoryExport: 'Bahn exportieren',

  dockLabel: 'UR digitaler Zwilling',
  dockDescription: 'Live-Ansicht des Roboter-Zwillings',
  dockCollapse: 'Einklappen',
}

/** Русский. */
export const ru = {
  statusDisconnected: 'Робот не подключён',
  statusLoading: 'Подключено · загрузка модели…',
  statusConnected: 'Подключено',
  statusFallbackSuffix: ' (встроенной модели нет, используется приближённая геометрия)',
  statusErrorPrefix: 'Ошибка отрисовки: ',
  statusLoadFailed: 'Не удалось загрузить модель: ',
  statusNoWebgl: 'WebGL здесь недоступен: включён режим только числовых значений (углы сочленений и TCP продолжают обновляться)',
  statusIncomplete: 'Робот не вернул полный набор углов сочленений',
  statusContextLost: 'Контекст 3D потерян (сброс GPU) — сверните и снова разверните панель, чтобы восстановить',
  statusSafetyHint: 'Возможно, робот остановлен; проверьте пульт обучения',

  disconnectNeverConnected: 'Робот не подключён: ur_connect ещё ни разу не завершался успешно',
  disconnectReason: (reason) => `Робот не подключён${reason ? `: ${reason}` : ''}`,
  disconnectAmbiguous: (candidates) => `Подключено несколько роботов; укажите IP-адрес робота${candidates}`,
  disconnectCandidates: (ips) => (Array.isArray(ips) && ips.length > 0 ? ` (кандидаты: ${ips.join(', ')})` : ''),
  disconnectWorkerDown: (reason) => `Процесс управления UR недоступен${reason ? `: ${reason}` : ''} (запустите ur_ping, чтобы проверить зависимости Python)`,
  disconnectReadFailed: (reason) => `Не удалось прочитать состояние робота${reason ? `: ${reason}` : ''}`,

  jointsPrefix: 'Углы сочленений (°)',
  tcpPrefix: 'TCP (м / рад оси-угла)',
  queryFailed: 'запрос не выполнен',
  detailStatusFailed: (error) => `Запрос состояния не выполнен: ${error}`,
  detailSafety: (mode) => `Безопасность: ${mode}`,
  detailRobotMode: (mode) => `Режим: ${mode}`,
  detailProgram: (state) => `Программа: ${state}`,
  detailSpeed: (value) => `Скорость: ${value}`,
  detailRunning: 'Выполняется',
  detailTempsPrefix: 'Темп. (°C)',
  detailTemps: (row) => `Темп. (°C)  ${row}`,
  detailBus: (voltage, current) => `Шина ${voltage} В  ${current} А`,

  overLimit: (joints) => `⚠ за пределом ${joints}`,

  feedStale: 'Данные перестали обновляться',
  feedRetrying: 'Переподключение канала данных…',
  feedRetryWord: 'повторная попытка',
  feedNoEventSource: 'EventSource здесь недоступен',
  feedFrames: (frames, errors) => ` (кадров: ${frames}${errors > 0 ? `, ошибок: ${errors}` : ''})`,

  safetyMode: {
    NORMAL: 'Норма',
    REDUCED: 'Ограниченный режим',
    PROTECTIVE_STOP: 'Защитная остановка',
    SAFEGUARD_STOP: 'Остановка по защите',
    EMERGENCY_STOP: 'Аварийный останов',
    SYSTEM_EMERGENCY_STOP: 'Аварийный останов системы',
    ROBOT_EMERGENCY_STOP: 'Аварийный останов робота',
    RECOVERY: 'Восстановление',
    VIOLATION: 'Нарушение безопасности',
    FAULT: 'Неисправность',
    AUTOMATIC_MODE_SAFEGUARD_STOP: 'Остановка по защите в автоматическом режиме',
    SYSTEM_THREE_POSITION_ENABLING_STOP: 'Остановка трёхпозиционного разрешения',
  },
  robotMode: {
    POWER_OFF: 'Питание отключено',
    POWER_ON: 'Питание включено',
    IDLE: 'Простой',
    BACKDRIVE: 'Ручное перемещение',
    RUNNING: 'Выполняется',
    BOOTING: 'Загрузка',
    CONFIRM_SAFETY: 'Подтвердите безопасность',
    DISCONNECTED: 'Не подключён',
    NO_CONTROLLER: 'Нет контроллера',
  },
  programState: {
    STOPPED: 'Остановлена',
    PLAYING: 'Выполняется',
    PAUSED: 'Пауза',
  },

  viewReset: 'Сбросить вид',
  viewIso: 'Изометрия',
  viewFront: 'Спереди',
  viewSide: 'Сбоку',
  viewTop: 'Сверху',

  identity: (model, ip) => `Робот  ${[model, ip].filter(Boolean).join('  ·  ')}`,
  pendingPrefix: 'Ожидает одобрения',
  canvasLabel: '3D-вид цифрового двойника робота; стрелки переключают вид',
  hudLabel: 'Показания робота в реальном времени',
  layerReach: 'Зона досягаемости',
  layerBase: 'Базовая система',
  layerForce: 'Сила',
  screenshot: 'Снимок',
  screenshotLabel: 'Экспорт снимка с водяным знаком',
  trajectoryClear: 'Очистить траекторию',
  trajectoryPause: 'Пауза траектории',
  trajectoryResume: 'Продолжить запись',
  trajectoryExport: 'Экспорт траектории',

  dockLabel: 'Цифровой двойник UR',
  dockDescription: 'Вид двойника робота в реальном времени',
  dockCollapse: 'Свернуть',
}

/** Português (Brasil). */
export const pt = {
  statusDisconnected: 'Robô não conectado',
  statusLoading: 'Conectado · carregando modelo…',
  statusConnected: 'Conectado',
  statusFallbackSuffix: ' (sem modelo embutido; usando geometria aproximada)',
  statusErrorPrefix: 'Erro de renderização: ',
  statusLoadFailed: 'Falha ao carregar o modelo: ',
  statusNoWebgl: 'WebGL não está disponível aqui: alternado para o modo somente numérico (os ângulos das juntas e o TCP continuam sendo atualizados)',
  statusIncomplete: 'O robô não retornou o conjunto completo de ângulos das juntas',
  statusContextLost: 'Contexto 3D perdido (reinício da GPU) — recolha e reabra o painel para recuperar',
  statusSafetyHint: 'O robô pode ter parado; verifique o teach pendant',

  disconnectNeverConnected: 'Robô não conectado: o ur_connect nunca foi executado com sucesso',
  disconnectReason: (reason) => `Robô não conectado${reason ? `: ${reason}` : ''}`,
  disconnectAmbiguous: (candidates) => `Há mais de um robô conectado; informe o IP do robô${candidates}`,
  disconnectCandidates: (ips) => (Array.isArray(ips) && ips.length > 0 ? ` (candidatos: ${ips.join(', ')})` : ''),
  disconnectWorkerDown: (reason) => `O processo de controle UR não está disponível${reason ? `: ${reason}` : ''} (execute ur_ping para verificar as dependências do Python)`,
  disconnectReadFailed: (reason) => `Falha ao ler o estado do robô${reason ? `: ${reason}` : ''}`,

  jointsPrefix: 'Ângulos das juntas (°)',
  tcpPrefix: 'TCP (m / rad eixo-ângulo)',
  queryFailed: 'falha na consulta',
  detailStatusFailed: (error) => `Falha na consulta de estado: ${error}`,
  detailSafety: (mode) => `Segurança ${mode}`,
  detailRobotMode: (mode) => `Modo ${mode}`,
  detailProgram: (state) => `Programa ${state}`,
  detailSpeed: (value) => `Velocidade ${value}`,
  detailRunning: 'Em execução',
  detailTempsPrefix: 'Temp (°C)',
  detailTemps: (row) => `Temp (°C)  ${row}`,
  detailBus: (voltage, current) => `Barramento ${voltage} V  ${current} A`,

  overLimit: (joints) => `⚠ acima do limite ${joints}`,

  feedStale: 'Os dados pararam de ser atualizados',
  feedRetrying: 'Reconectando o canal de dados…',
  feedRetryWord: 'tentando novamente',
  feedNoEventSource: 'EventSource não está disponível aqui',
  feedFrames: (frames, errors) => ` (${frames} quadros${errors > 0 ? `, ${errors} com erro` : ''})`,

  safetyMode: {
    NORMAL: 'Normal',
    REDUCED: 'Reduzido',
    PROTECTIVE_STOP: 'Parada de proteção',
    SAFEGUARD_STOP: 'Parada de salvaguarda',
    EMERGENCY_STOP: 'Parada de emergência',
    SYSTEM_EMERGENCY_STOP: 'Parada de emergência do sistema',
    ROBOT_EMERGENCY_STOP: 'Parada de emergência do robô',
    RECOVERY: 'Recuperação',
    VIOLATION: 'Violação de segurança',
    FAULT: 'Falha',
    AUTOMATIC_MODE_SAFEGUARD_STOP: 'Parada de salvaguarda em modo automático',
    SYSTEM_THREE_POSITION_ENABLING_STOP: 'Parada de habilitação de três posições',
  },
  robotMode: {
    POWER_OFF: 'Desligado',
    POWER_ON: 'Ligado',
    IDLE: 'Ocioso',
    BACKDRIVE: 'Arraste manual',
    RUNNING: 'Em execução',
    BOOTING: 'Inicializando',
    CONFIRM_SAFETY: 'Confirmar segurança',
    DISCONNECTED: 'Desconectado',
    NO_CONTROLLER: 'Sem controlador',
  },
  programState: {
    STOPPED: 'Parado',
    PLAYING: 'Em execução',
    PAUSED: 'Pausado',
  },

  viewReset: 'Redefinir visão',
  viewIso: 'Isométrica',
  viewFront: 'Frontal',
  viewSide: 'Lateral',
  viewTop: 'Superior',

  identity: (model, ip) => `Robô  ${[model, ip].filter(Boolean).join('  ·  ')}`,
  pendingPrefix: 'Aguardando aprovação',
  canvasLabel: 'Visão 3D do gêmeo digital do robô; as setas alternam a visão',
  hudLabel: 'Leituras do robô ao vivo',
  layerReach: 'Alcance',
  layerBase: 'Sistema base',
  layerForce: 'Força',
  screenshot: 'Captura',
  screenshotLabel: 'Exportar uma captura com marca d’água',
  trajectoryClear: 'Limpar trajetória',
  trajectoryPause: 'Pausar trajetória',
  trajectoryResume: 'Retomar gravação',
  trajectoryExport: 'Exportar trajetória',

  dockLabel: 'Gêmeo digital UR',
  dockDescription: 'Visão ao vivo do gêmeo do robô',
  dockCollapse: 'Recolher',
}

/** 语言 id → 文案表。id 与宿主 locale 服务一致（`pt` 即巴西葡萄牙语；宿主也接受 pt-PT 浏览器请求）。 */
export const LOCALES = Object.freeze({ zh, en, ja, es, fr, de, ru, pt })

/** 支持的语言（顺序即语言选择器的展示顺序）。 */
export const SUPPORTED_LOCALES = Object.freeze(['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'])

/** 缺省语言（拿不到任何线索时用中文 —— 产品的主用户群）。 */
export const DEFAULT_LOCALE = 'zh'

/** 各语言的自称（用于语言选择器/日志；宿主自带同一套名称）。 */
export const LANGUAGE_LABELS = Object.freeze({
  zh: '简体中文',
  en: 'English',
  ja: '日本語',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ru: 'Русский',
  pt: 'Português (Brasil)',
})

/**
 * 把一个 BCP-47 语言标签规整成受支持的语言。
 *
 * - 只认主语言子标签（`ja-JP` → `ja`、`pt-BR` → `pt`、`es-419` → `es`）；
 * - 繁体（`zh-TW`/`zh-Hant`）归到 `zh` —— 词条是简体，但**绝不能因为认不出就退回英文**；
 * - 认不出的一律回退 `DEFAULT_LOCALE`（中文），而不是英文。
 *
 * @param {string} tag 例如 `navigator.language`
 * @returns {string} 受支持的语言 id
 */
export function resolveLocale(tag) {
  const first = Array.isArray(tag) ? tag[0] : tag
  if (typeof first !== 'string' || first.trim() === '') return DEFAULT_LOCALE
  const primary = first.trim().toLowerCase().split(/[-_]/u)[0]
  return SUPPORTED_LOCALES.includes(primary) ? primary : DEFAULT_LOCALE
}

/**
 * 取某个语言的文案表；语言不可识别时回退缺省语言。
 *
 * @param {string} locale
 * @returns {typeof zh}
 */
export function stringsFor(locale) {
  return LOCALES[resolveLocale(locale)] ?? LOCALES[DEFAULT_LOCALE]
}

/**
 * 按运行环境的语言线索取文案表。
 *
 * 优先级：宿主 locale 服务（`env.locale`）→ `navigator.languages` / `navigator.language` → 缺省。
 * `env.locale` 由调用方从宿主服务读（见 `useHostLocale`）—— 这就是「与桌面程序语言一致」。
 *
 * @param {object} [env] 注入点（测试用）；缺省读 `globalThis.navigator`
 * @param {string} [env.locale] 宿主当前语言（已授权时）
 * @param {string|string[]} [env.language] 浏览器语言
 * @param {string[]} [env.languages] 浏览器语言列表（优先逐个匹配）
 * @returns {typeof zh}
 */
export function activeStrings(env) {
  const source = env ?? globalThis.navigator
  if (!source) return LOCALES[DEFAULT_LOCALE]
  if (typeof source.locale === 'string' && source.locale.trim() !== '') return stringsFor(source.locale)
  const list = Array.isArray(source.languages) ? source.languages.filter((t) => typeof t === 'string' && t.trim() !== '') : []
  for (const tag of list) {
    const primary = tag.trim().toLowerCase().split(/[-_]/u)[0]
    if (SUPPORTED_LOCALES.includes(primary)) return LOCALES[primary]
  }
  return stringsFor(source.language)
}

/** 当前语言 id（与 `activeStrings` 同一套优先级）。 */
export function activeLocale(env) {
  const source = env ?? globalThis.navigator
  if (!source) return DEFAULT_LOCALE
  if (typeof source.locale === 'string' && source.locale.trim() !== '') return resolveLocale(source.locale)
  const list = Array.isArray(source.languages) ? source.languages : []
  for (const tag of list) {
    const primary = typeof tag === 'string' ? tag.trim().toLowerCase().split(/[-_]/u)[0] : ''
    if (SUPPORTED_LOCALES.includes(primary)) return primary
  }
  return resolveLocale(source.language)
}

/**
 * 取宿主 locale 服务。
 *
 * ⚠️ **不能**直接用 `ctx.locale`：cordis 的上下文代理对未经 `inject` 声明的服务读取会抛
 * `cannot get property "locale" without inject`；一旦在客户端 `apply` 里抛出，整个 entry 就会
 * 卡在 loading/failed —— 桌面启动时表现为 `web boot: 1 entry did not activate`
 * + `<plugin>: loading`。`ctx.get(name)` 是 cordis 的**非严格**访问器（宿主自己也用它探测
 * 注入服务），服务不存在时只返回 `undefined`，因此优先用它；兜底再试属性读取。
 *
 * @param {object} ctx cordis 上下文
 * @returns {object|undefined} locale 服务（`register`/`getSnapshot`/`subscribe`）
 */
function getLocaleService(ctx) {
  if (ctx === null || typeof ctx !== 'object') return undefined
  try {
    if (typeof ctx.get === 'function') {
      const service = ctx.get('locale')
      if (service) return service
    }
  } catch {
    /* 没有 get 或服务未提供：继续尝试属性读取 */
  }
  try {
    return ctx.locale ?? undefined
  } catch {
    return undefined
  }
}

/**
 * 把 8 份字典注册进宿主 locale 服务（宿主可用时调用一次）。
 *
 * 契约见 `@deepseek-ai/dsh-client-locale` 的 README：`locale.register(ns, { zh, en, … })`
 * —— `zh`/`en` 是强制基线，其余可选；切换语言由宿主推送 `locale/change`，**无需重载页面**。
 *
 * @param {object} ctx cordis 上下文（locale 服务经 `ctx.get('locale')` 探测，无需声明 inject）
 * @param {string} [namespace='ur-twin'] 字典命名空间
 * @returns {boolean} 是否注册成功（宿主没有 locale 服务时返回 false，调用方继续用本地表）
 */
export function registerWithLocale(ctx, namespace = 'ur-twin') {
  const locale = getLocaleService(ctx)
  if (!locale || typeof locale.register !== 'function') return false
  try {
    locale.register(namespace, LOCALES)
    return true
  } catch (error) {
    // 注册失败不该让面板白屏：本地表仍然可用，只把原因记到日志。
    ctx?.logger?.warn?.(`[ur-twin] locale.register 失败，回退本地文案表：${error?.message ?? error}`)
    return false
  }
}

/**
 * 从宿主读当前语言；宿主不可用时返回 `undefined`（调用方回退到浏览器线索）。
 *
 * 只读 `getSnapshot()`（README 里的 `LocaleRuntime` 快照接口），不做订阅 —— 订阅由调用方
 * 在需要热更新时处理（例如 `locale/change` 事件后重新取一次文案）。
 *
 * @param {object} ctx
 * @returns {string|undefined}
 */
export function useHostLocale(ctx) {
  const locale = getLocaleService(ctx)
  if (!locale) return undefined
  try {
    const snapshot = typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : undefined
    const current = snapshot?.locale ?? snapshot?.current ?? snapshot?.active
    return typeof current === 'string' && current.trim() !== '' ? current : undefined
  } catch {
    return undefined
  }
}

/**
 * 宿主当前语言（由 `bindHostLocale` 写入）。模块级状态而不是每次读 `navigator`：
 * 桌面程序的语言是**宿主设置**，与浏览器 UI 语言无关。
 * @type {string|undefined}
 */
let hostLocale

/** 写入宿主语言（语言切换时调用；`undefined` 表示回退浏览器线索）。 */
export function setHostLocale(locale) {
  hostLocale = typeof locale === 'string' && locale.trim() !== '' ? locale : undefined
}

/** 读回当前宿主语言（调试/测试用）。 */
export function getHostLocale() {
  return hostLocale
}

/**
 * 一个「跟着语言走」的文案对象：**每次取属性**都重新解析一次当前语言（宿主优先，其次浏览器）。
 *
 * 为什么需要它：`twin-panel.js` / `right-dock-entry.js` 在模块顶层写 `const S = activeStrings()`，
 * 那会把语言**冻结在加载那一刻**；用户在设置里换语言后（宿主支持免刷新切换）界面不会变。
 * 把 `S` 换成这个 Proxy 之后，所有既有 `S.xxx` 调用点一行不用改，语言切换立刻生效 ——
 * 面板按孪生帧重渲染，文案自然跟着刷新。
 *
 * 嵌套对象（`safetyMode` / `robotMode` / `programState`）同样按需代理。
 *
 * @param {object} [env] 注入点（测试用），语义同 `activeStrings`
 * @returns {typeof zh}
 */
export function liveStrings(env) {
  const current = () => activeStrings(env ?? { locale: hostLocale, ...globalThis.navigator })
  const nested = new Map()
  const proxyFor = (locale) => {
    const table = stringsFor(locale)
    if (!nested.has(locale)) {
      nested.set(locale, new Map())
    }
    const cache = nested.get(locale)
    const wrap = (obj) => new Proxy(obj, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          if (!cache.has(prop)) cache.set(prop, wrap(value))
          return cache.get(prop)
        }
        return value
      },
    })
    return wrap(table)
  }
  // 顶层：每次访问都按"当前语言"取表；宿主切换语言后无需重新赋值。
  let lastLocale
  let lastProxy
  return new Proxy({}, {
    get(_target, prop) {
      const source = current()
      const locale = sourceLocaleOf(source)
      if (locale !== lastLocale || lastProxy === undefined) {
        lastLocale = locale
        lastProxy = proxyFor(locale)
      }
      return Reflect.get(lastProxy, prop)
    },
    has(_target, prop) {
      return Reflect.has(current(), prop)
    },
    ownKeys() {
      return Reflect.ownKeys(current())
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Reflect.getOwnPropertyDescriptor(current(), prop)
    },
  })
}

/** 从文案表反查语言 id（`LOCALES` 是冻结映射，直接按引用找）。 */
function sourceLocaleOf(table) {
  for (const id of SUPPORTED_LOCALES) {
    if (LOCALES[id] === table) return id
  }
  return DEFAULT_LOCALE
}

/**
 * 一个「跟着语言走」的**嵌套**文案对象（`safetyMode` / `robotMode` / `programState`）。
 *
 * 为什么需要：`const SAFETY_TEXT = S.safetyMode` 这类模块级常量会在**求值那一刻**把某个语言的
 * 嵌套表固定下来 —— 之后换语言，`describeSafetyMode()` 仍返回旧语言。`liveNested('safetyMode')`
 * 每次取属性都按当前语言解析，于是这些常量名保持不变、行为变成"永远跟随语言"。
 *
 * @param {'safetyMode'|'robotMode'|'programState'} key
 * @returns {Record<string, string>}
 */
export function liveNested(key) {
  return new Proxy({}, {
    get(_target, prop) {
      const table = liveStrings()[key]
      return table === undefined ? undefined : Reflect.get(table, prop)
    },
    has(_target, prop) {
      const table = liveStrings()[key]
      return table === undefined ? false : Reflect.has(table, prop)
    },
    ownKeys() {
      const table = liveStrings()[key]
      return table === undefined ? [] : Reflect.ownKeys(table)
    },
    getOwnPropertyDescriptor(_target, prop) {
      const table = liveStrings()[key]
      return table === undefined ? undefined : Reflect.getOwnPropertyDescriptor(table, prop)
    },
  })
}

/**
 * 把本插件的 8 份字典绑到宿主 locale 服务上，并让后续语言切换自动生效。
 *
 * 做了三件事（每一步都容错，缺哪一步都不影响面板工作）：
 *   1. `ctx.locale.register('ur-twin', 8 份字典)` —— 宿主可用时由宿主来做选择与持久化；
 *   2. `setHostLocale(useHostLocale(ctx))` —— 让本地表**跟随桌面程序语言**；
 *   3. 订阅语言变化（`ctx.locale.subscribe` / `ctx.on('locale/change')`，存在哪个用哪个）。
 *
 * @param {object} ctx cordis 上下文
 * @param {string} [namespace='ur-twin']
 * @returns {() => void} 清理函数（退订 + 复位）
 */
export function bindHostLocale(ctx, namespace = 'ur-twin') {
  registerWithLocale(ctx, namespace)
  setHostLocale(useHostLocale(ctx))
  const apply = (locale) => {
    if (typeof locale === 'string' && locale.trim() !== '') setHostLocale(locale)
  }
  const disposers = []
  const locale = getLocaleService(ctx)
  if (typeof locale?.subscribe === 'function') {
    try {
      const off = locale.subscribe((snapshot) => {
        const next = snapshot?.locale ?? snapshot?.current ?? snapshot?.active
        if (typeof next === 'string') apply(next)
      })
      if (typeof off === 'function') disposers.push(off)
    } catch {
      /* 订阅接口形态不匹配：忽略，仍由 navigator 兜底 */
    }
  }
  if (typeof ctx?.on === 'function') {
    try {
      const off = ctx.on('locale/change', (payload) => apply(payload?.locale ?? payload?.current))
      if (typeof off === 'function') disposers.push(off)
    } catch {
      /* 事件名不存在：忽略 */
    }
  }
  return () => {
    for (const off of disposers) {
      try {
        off()
      } catch {
        /* 清理失败不该抛到调用方 */
      }
    }
    hostLocale = undefined
  }
}

/**
 * src/client/index.js — 客户端半的装配入口。
 *
 * 装配顺序（**唯一** `state`，全客户端只此一条轮询链）：
 *   1. `createTwinState({ ip })` → `start()`（Task 6：轮询 host 只读状态路由 + 失败退避）
 *   2. `mountRightDockEntry(...)`：把「UR 数字孪生」入口卡片注入**右栏**「开始」面板的引导列
 *      （位置在「工作区文件 / 新建终端 / 浏览器」三张卡片**下面**），并负责自愈与激活状态
 *   3. 大视图 `mountTwinPanel`（Task 8）由入口在**点击展开时**才挂进右栏的覆盖层，
 *      收起/离开面板时 dispose —— 不做无谓的 WebGL 初始化
 *
 * 呈现位置的历史：本插件原先把入口行注入**左栏**、大视图覆盖**中栏**，并在左栏入口行下面
 * 挂一个缩略 3D 插槽。现在改为**只在右栏**呈现（入口在三张引导卡片下面、3D 显示在右侧栏），
 * 因此左栏入口 + 中栏大视图（原 `sidebar-entry.js`）与缩略图（原 `thumbnail.js`）
 * **已随本次改版删除**，中栏的 `dsh-panel-activate` 协调协议也随之不再使用。
 * 仍在用的变更自愈 hub 已独立为 `./mutation-hub.js`。
 *
 * `apply(ctx, config)` 返回清理函数：dispose 所有挂载 + `state.stop()`（`ctx.effect` 语义）。
 * 调试标记 `globalThis.__UR_TWIN__` 在 Task 1 就已约定并保留（`loaded`/`at` 字段不许改），
 * 这里额外挂上 `ip` / `state` / 入口句柄，便于 GUI 侧排查。
 *
 * IP 来源（Ruling 35）：**默认不指定**，由 host 依据其连接注册表解析到"当前已连接的那一个机器人"
 * —— 浏览器半不该猜机器人地址（曾默认 `192.168.1.199`，与真实机器人 `192.168.2.201` 不符，
 * 会导致数字孪生永远显示"未连接"）。仅在需要覆盖时才提供：
 * `globalThis.__UR_TWIN_IP__`（调试/验收）→ `apply(ctx, config)` 的第二实参 `config.ip` / `config.robotIp`。
 *
 * 配置只能取自 `apply` 的第二实参：cordis 的上下文代理对未 `inject` 的属性读取会直接抛
 * `cannot get property "..." without inject`（读 `ctx.config` 即属此类）。`apply` 抛出的异常
 * 会让该 entry 的 fiber 落为 FAILED，渲染侧只会报「1 plugin(s) 未激活」而拿不到原因。
 */

import { createTwinState } from './state.js'
import { mountRightDockEntry } from './right-dock-entry.js'
import { mountTwinPanel } from './twin-panel.js'
import { bindHostLocale, liveStrings } from './strings.js'
import { registerGuideEntry } from './guide-entry.js'

export const name = 'ur-digital-twin-client'

/**
 * 解析**显式**指定的机器人 IP；没有任何显式来源时返回 `undefined`
 * （= 交给 host 解析当前已连接的机器人，见 Ruling 35）。
 *
 * @param {object} [config] `apply` 的第二实参（插件配置），**不是** `ctx.config`。
 * @param {object} [globalScope] 全局作用域，测试可注入。
 */
export function resolveRobotIp(config, globalScope = globalThis) {
  const candidates = [
    globalScope?.__UR_TWIN_IP__,
    config?.ip,
    config?.robotIp,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }
  return undefined
}

/**
 * 挂载客户端半。
 *
 * @param {object} ctx cordis 上下文（只用到可选的 `logger`）
 * @param {object} [config] 插件配置（cordis 作为第二实参传入；`config.ip` / `config.robotIp` 可覆盖 IP）
 * @returns {() => void} 清理函数（`ctx.effect` 语义：dispose 所有挂载并停止轮询）
 */
export function apply(ctx, config) {
  const doc = globalThis.document
  const ip = resolveRobotIp(config)
  /*
   * 语言（i18n）：把本插件的 8 份字典注册到**宿主 locale 服务**，并让本地文案表跟随桌面
   * 程序语言（`locale.preference`），语言切换免刷新。绑定必须在挂载面板**之前** —— 这样
   * 第一次渲染就是宿主语言，不会先闪一下中文。
   *
   * 宿主没有 locale 服务时（独立浏览器/旧宿主）`bindHostLocale` 内部全部容错，回退
   * `navigator.languages`，再回退中文。
   */
  let unbindLocale = () => {}
  try {
    unbindLocale = bindHostLocale(ctx) ?? unbindLocale
  } catch (error) {
    // 语言绑定只是增强项：宿主 locale 服务形态不符时绝不能拖垮整个客户端 entry
    // （否则桌面启动会报 `1 entry did not activate`）。
    ctx.logger?.warn?.(
      `[ur-twin] 宿主 locale 绑定失败，回退浏览器语言：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  /*
   * SSE 实时流（清单第 20 条）：**默认启用**。
   *
   * host 侧的 `/twin/stream` 复用与轮询完全相同的读取逻辑，并自带 detail 慢节拍，
   * 所以切过来不会丢任何字段。`state.js` 保证两套数据源互斥 —— 开了流就不轮询。
   */
  const state = createTwinState({ ip, stream: true })

  /** 调试标记：Task 1 的验收依赖 `loaded` / `at` 两个字段，不要删。 */
  const info = {
    loaded: true,
    at: Date.now(),
    ip,
    state,
    guide: undefined,
    entry: undefined,
    error: null,
  }
  globalThis.__UR_TWIN__ = info

  ctx.logger?.info?.('[ur-twin] client half loaded')

  let entryHandle
  let guideHandle

  /** 面板挂载：guide tab 正文与保底覆盖层共用同一份实现。 */
  const mountPanel = (container) => mountTwinPanel({ container, state })

  try {
    state.start()

    /*
     * 首选路径：把卡片注册成宿主开始页 catalog 的**正式成员**
     * （`sidebarRightTabs.guide()` → better-sidebar 的 `guideCatalog` 只是它的镜像）。
     *
     * 只有进 catalog，卡片才会出现在「调整顺序 / 隐藏」对话框里，并受宿主的行预算、双列布局
     * 与「更多」卡片调度。注册成功后卡片由宿主渲染，我们**不再克隆**原生卡片。
     */
    try {
      guideHandle = registerGuideEntry({
        ctx,
        strings: liveStrings(),
        mountPanel,
        onRegistered: () => {
          // 服务晚到、保底克隆已经挂上时，宿主接管后立刻撤掉克隆，避免出现两张卡片。
          try {
            entryHandle?.dispose?.()
          } catch {
            /* 忽略 */
          }
          entryHandle = undefined
          info.entry = undefined
          ctx.logger?.info?.('[ur-twin] guide entry registered — host owns the card')
        },
      })
    } catch (error) {
      guideHandle = undefined
      ctx.logger?.warn?.(
        `[ur-twin] guide 注册失败，回退 DOM 克隆：${error instanceof Error ? error.message : String(error)}`,
      )
    }

    /*
     * 保底路径：宿主没有 `sidebarRightTabs`（旧宿主 / 未装侧边栏插件）时，继续克隆一张原生卡片。
     * `immediate === false` 表示注册还在等服务就绪，也先挂上克隆，等 `onRegistered` 再拆。
     */
    if (!guideHandle?.immediate) {
      entryHandle = mountRightDockEntry({
        doc,
        onToggle: (active) => {
          info.active = active
        },
        mountPanel,
      })
    }

    info.guide = guideHandle ?? null
    info.entry = entryHandle
    const surface = guideHandle?.immediate ? 'guide-entry' : 'right-dock'
    ctx.logger?.info?.(`[ur-twin] mounted (ip=${ip}, surface=${surface})`)
  } catch (error) {
    // 客户端半装配失败不得拖垮 shell：如实记录到调试标记，清理函数照常返回。
    info.error = error instanceof Error ? error.message : String(error)
    ctx.logger?.warn?.(`[ur-twin] 客户端装配失败：${info.error}`)
  }

  return () => {
    try {
      unbindLocale?.()
    } catch {
      /* 忽略 */
    }
    try {
      guideHandle?.dispose?.()
    } catch {
      /* 忽略 */
    }
    try {
      entryHandle?.dispose?.()
    } catch {
      /* 忽略 */
    }
    try {
      state.stop()
    } catch {
      /* 忽略 */
    }
    guideHandle = undefined
    entryHandle = undefined
    delete globalThis.__UR_TWIN__
  }
}

# 第三方资产与许可 / Third-Party Notices

本文件列出 `dsh-nonead-universal-robots` 随附或依赖的第三方资产、其来源与许可条款。

---

## 1. Universal Robots 描述数据与网格

**来源**：`UniversalRobots/Universal_Robots_ROS2_Description`
**仓库**：https://github.com/UniversalRobots/Universal_Robots_ROS2_Description
**分支**：`humble`
**获取日期**：2026-09-21
**本仓库取用的内容**：
1. 各型号的 `config/<urXX>/default_kinematics.yaml` 与 `config/<urXX>/joint_limits.yaml`（用于生成 `assets/kinematics.json`）；
2. 各型号的 `config/<urXX>/visual_parameters.yaml`（用于定位视觉网格）；
3. 视觉网格 `meshes/<urXX>/visual/*.dae`（仅 visual，不含 collision），离线转换为 `assets/models/<urXX>.glb`（共 14 个文件，20.86 MB，见 §1.3）。

### 1.1 BSD-3-Clause 部分

以下内容依 **BSD-3-Clause** 许可：

- 上述**运动学与限位配置**（本项目 `assets/kinematics.json` 即由其派生）；
- 型号 `ur3`、`ur5`、`ur10`、`ur3e`、`ur5e`、`ur7e`、`ur10e`、`ur12e`、`ur16e` 的网格；
- 仓库中其余未单独声明的内容。

许可全文：<https://opensource.org/license/bsd-3-clause>
使用时应保留原始版权声明与许可声明。

### 1.2 UR「Graphical Documentation」条款部分

以下型号的**网格（mesh）**并非 BSD-3-Clause，而是构成 UR 的 “Graphical Documentation”，其使用受 UR 的
**Terms and Conditions for use of Graphical Documentation** 约束：

- `ur8long`、`ur15`、`ur18`、`ur20`、`ur30`

条款链接：<https://www.universal-robots.com/legal/terms-and-conditions/terms_and_conditions_for_use_of_graphical_documentation.txt>

> 该条款不完全符合 OSI 的开源定义，但**允许**使用、修改与分享这些 “Graphical Documentation”（含上述网格），
> 唯须遵守其中若干限制。如对许可或使用场景有疑问，请联系 <legal@universal-robots.com>。

**当前分发状态**：**已随包分发**上述 5 个型号对应的网格（已转为 GLB）。分发与转换的完整说明见 §1.3。

### 1.3 网格分发状态与派生清单

原始网格为 **DAE（visual）+ STL（collision）**。本项目**只取 visual**（collision 对渲染无用且体积翻倍），
用 `scripts/convert-meshes.py`（`trimesh` + `pycollada` + `fast-simplification`）离线转换为
**每型号一个 GLB**，输出到 `assets/models/<urXX>.glb`，随包分发。

**转换参数**：顶点焊接（`merge_vertices`，体积约 −40%、面数与外观不变）；**不做抽稀**（保持原始精度）。
**结构契约**：每个 GLB 内含 7 个各自独立的顶层节点，名字固定为
`base, shoulder, upperarm, forearm, wrist1, wrist2, wrist3`；贴图以 PNG **内嵌**。
该契约由 `python scripts/verify-models.py` 校验（节点名/顺序、网格数 7、贴图已内嵌），**退出码非 0 即失败**。
客户端在 `src/client/robot/loader.js` 里按这些固定名字装配到 6 个关节变换上。

**派生清单（14 个 GLB，20.86 MB）**

| GLB | 网格来源 | 许可类别 |
|---|---|---|
| `ur3` `ur5` `ur10` `ur3e` `ur5e` `ur10e` `ur16e` | 自有网格（`ur16e` 的 base/shoulder/wrist 引用 `ur10e`） | BSD-3-Clause |
| `ur7e` | **全部**引用 `ur5e` 的网格 | BSD-3-Clause |
| `ur12e` | **全部**引用 `ur10e` 的网格 | BSD-3-Clause |
| `ur15` `ur20` | 自有网格 | UR Graphical Documentation |
| `ur18` | upperarm/forearm 自有，base/shoulder/wrist 引用 `ur15` | UR Graphical Documentation |
| `ur8long` | upperarm/forearm 自有，base/shoulder/wrist 引用 `ur15` | UR Graphical Documentation |
| `ur30` | upperarm/forearm 自有，base/shoulder/wrist 引用 `ur20` | UR Graphical Documentation |

> **关于网格复用（重要事实）**：上游仓库 `meshes/` 下**只有 12 套**网格目录。`ur7e`、`ur12e`、`ur16e`、
> `ur18`、`ur8long`、`ur30` 并不各自拥有全部 7 个网格，而是通过 `config/<model>/visual_parameters.yaml`
> 引用别的型号的网格。因此**不能**假设 `meshes/<model>/visual/<link>.dae` 一定存在；
> 转换脚本据 `visual_parameters.yaml` 解析真实路径。许可类别按**实际取用的网格**判定，上表已逐行标注——
> 两类之间没有混合型号（BSD 型号只引用 BSD 网格，UR GD 型号只引用 UR GD 网格）。

**体积说明**：14 款 GLB 合计 **20.86 MB**，是本插件包体的主要构成。相对转换脚本的原始输出
**35.11 MB** 共减少 40.6%，分两步（都由 `node scripts/compress-models.mjs` 完成，逐步可复现）：

1. **无损瘦身（28.27 MB）**：把 trimesh 一律写成 4 字节的顶点索引降到 2 字节（这 14 个型号最大索引值
   仅 24228），并删掉没有任何材质读取的非标准属性 `_color`。顶点位置、UV、贴图字节与索引序列
   **逐字节/逐值不变**（脚本内含自证，不通过就拒绝写盘），几何精度仍完全符合 Ruling 24。
2. **贴图降分辨率（20.86 MB，有损，经明确决策）**：5 个新型号里**共 8 张** 2048×2048 底色贴图
   （ur15 ×1、ur18 ×2、ur20 ×1、ur30 ×2、ur8long ×2；ur8long 复用 ur15 的贴图、ur30 复用 ur20 的）
   用块平均降到 1024×1024（`--texture-size 1024`）。10.67 MB 纹理降到 3.25 MB；
   同一物理区域在 1024² 下与原图肉眼难以区分，而孪生面板实际只有几百像素宽。另外 9 个型号的
   内嵌贴图是 16×8/32×8 的极小图（合计约 1 KB），**不在**本次重采样范围内（未放大、未改动）。

若你的部署仍在意包体积，可只用 `--only <型号…>` 重新生成子集
（客户端对缺失型号会回退到近似几何体，不会报错）。

**版权**：网格版权归 Universal Robots A/S 所有，本项目仅按其许可条款（见 §1.1 / §1.2）使用与再分发。

---

## 2. 前端与构建依赖

| 依赖 | 用途 | 许可 |
|---|---|---|
| [three.js](https://threejs.org/) | 客户端 3D 渲染（`GLTFLoader` / `ColladaLoader` / `OrbitControls`） | MIT |
| [esbuild](https://esbuild.github.io/) | 仅构建期：打包客户端 bundle | MIT |

---

## 3. 其他

本插件本体（`lib/`、`python/ur_worker.py`）的许可见仓库根 `LICENSE`。
`python/URBasic`（vendored）保持其自身 **MIT** 许可，不在本项目双许可范围内。

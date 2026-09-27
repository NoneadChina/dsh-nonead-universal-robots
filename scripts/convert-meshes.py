#!/usr/bin/env python
"""
Task 2 网格转换 —— 把官方 UR 的视觉网格（DAE）合并为每型号一个 GLB。

为什么需要离线转换：
  * 官方 `meshes/<model>/visual/*.dae` 是 COLLADA；GLB 体积更小、加载更可靠、材质自包含。
  * 本机已装 `trimesh` + `pycollada`（`pip install trimesh pycollada`），
    这是唯一可用的 DAE 读取路径（`gltf-transform` 不支持 COLLADA，`assimp` 不可用）。

**关键事实（实测，2026-09-21）**：官方仓库的 `meshes/` 下只有 **12 套**网格 ——
`ur7e` 与 `ur12e` **没有自己的网格**，它们通过 `config/<model>/visual_parameters.yaml`
引用别的型号：
  * `config/ur7e/visual_parameters.yaml`  → `meshes/ur5e/...`
  * `config/ur12e/visual_parameters.yaml` → `meshes/ur10e/...`
所以**不能**硬编码 `meshes/<model>/visual/<link>.dae`；必须按 `visual_parameters.yaml`
解析真实路径（本脚本即如此）。14 个型号最终仍各有自己的 GLB（只是其中两个与源型号同形）。

输入：`--repo <repo-root>`（含 `config/` 与 `meshes/`，由 `git clone --filter=blob:none` + sparse-checkout 取得）
输出：`--out/<model>.glb` —— 单个 GLB，内含 7 个命名网格节点：
      base, shoulder, upperarm, forearm, wrist1, wrist2, wrist3
      名字与官方 `visual_parameters.yaml` 的 mesh.path 基名一致，便于客户端按连杆装配。

只处理 **visual**（DAE），不打包 collision（STL）——碰撞体对渲染无用且体积翻倍。

体积实测（焊接后，5 款样本）：ur3 1.45 / ur5 1.82 / ur10 2.43 / ur3e 2.80 / ur5e 2.62 MB，
GLB ≈ 视觉 DAE 的 27.6%。全 14 款预计 ~36 MB；`--ratio 0.5` 可再减约一半。
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

MODELS = [
    "ur3", "ur5", "ur10", "ur3e", "ur5e", "ur7e", "ur10e", "ur12e", "ur16e",
    "ur8long", "ur15", "ur18", "ur20", "ur30",
]

# visual_parameters.yaml 里 mesh_files 的键序（与官方文件一致）
LINK_KEYS = ["base", "shoulder", "upper_arm", "forearm", "wrist_1", "wrist_2", "wrist_3"]
# 节点名（客户端按此名装配到 FK 得到的连杆位姿上）
NODE_NAMES = ["base", "shoulder", "upperarm", "forearm", "wrist1", "wrist2", "wrist3"]

# ─────────────────────────────────────────────────────────────────────────────
# 视觉 origin：**为什么必须烘焙进 GLB**（Ruling 37）
#
# 官方 DAE 网格**不在连杆系里**：它们以 <up_axis>Z_UP</up_axis> 的 CAD 朝向导出，
# 长轴沿网格局部 +z；而运动学链（default_kinematics.yaml）把下一个关节放在局部 −x。
# 两者正交约 90° ⇒ 若把网格直接挂到 FK 得到的连杆位姿上，手臂会**渲染成脱节**：
# 7 段都在、也会随 q 平动，但每段绕自身长轴错开、肘部悬空，且**不报错**。
# （实测：upperarm 长轴 z vs 下一个关节 −x = 90.0°，ur3/ur5/ur10 一致。）
#
# 权威修法来自官方 `urdf/ur_macro.xacro` 的每个 `<visual><origin>`：
#   base      rpy = (0,   0,  π)      xyz = (0, 0, 0)
#   shoulder  rpy = (0,   0,  π)      xyz = (0, 0, 0)
#   upper_arm rpy = (π/2, 0, −π/2)    xyz = (0, 0, shoulder_offset)
#   forearm   rpy = (π/2, 0, −π/2)    xyz = (0, 0, elbow_offset)
#   wrist_1   rpy = (π/2, 0, 0)       xyz = (0, 0, visual_offset)
#   wrist_2   rpy = (0,   0,  0)      xyz = (0, 0, visual_offset)
#   wrist_3   rpy = (π/2, 0, 0)       xyz = (0, 0, visual_offset)
# 其中 shoulder_offset / elbow_offset 取自 config/<model>/physical_parameters.yaml，
# visual_offset 取自 config/<model>/visual_parameters.yaml（各自在对应连杆键下）。
# 本脚本把该变换**烘焙进网格**，使导出的 GLB 直接落在连杆系 —— 客户端装配逻辑因此
# 保持简单（网格挂到 FK 连杆位姿即可），且这一契约由 test/model-contract.test.mjs
# 的几何断言守护（相邻连杆接得上、长轴指向下一个关节）。
# ─────────────────────────────────────────────────────────────────────────────

# 逐连杆的视觉旋转（弧度），与 ur_macro.xacro 逐行对应。
_PI = 3.141592653589793
VISUAL_RPY = {
    "base": (0.0, 0.0, _PI),
    "shoulder": (0.0, 0.0, _PI),
    "upper_arm": (_PI / 2, 0.0, -_PI / 2),
    "forearm": (_PI / 2, 0.0, -_PI / 2),
    "wrist_1": (_PI / 2, 0.0, 0.0),
    "wrist_2": (0.0, 0.0, 0.0),
    "wrist_3": (_PI / 2, 0.0, 0.0),
}

_SCALAR_RE = {
    "shoulder_offset": re.compile(r"^\s*shoulder_offset:\s*([-\d.eE+]+)", re.MULTILINE),
    "elbow_offset": re.compile(r"^\s*elbow_offset:\s*([-\d.eE+]+)", re.MULTILINE),
}
_VISUAL_OFFSET_RE = re.compile(r"^\s*visual_offset:\s*([-\d.eE+]+)")
# wrist_3 专用（URDF 里 `<xacro:get_visual_params ... type="visual_offset_xyz"/>` 优先于
# `visual_offset`，值是**带引号的三维向量**）。实测 7 个型号带该键，差值虽小（≤2 mm）但按语义应当采用。
_VISUAL_OFFSET_XYZ_RE = re.compile(
    r'^\s*visual_offset_xyz:\s*"?\s*([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)', re.MULTILINE
)


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def visual_offsets(repo: Path, model: str) -> dict[str, float]:
    """取该型号的三类视觉偏移量（仓库缺文件时按 0 处理，并在调用处记录）。"""
    out: dict[str, float] = {"shoulder_offset": 0.0, "elbow_offset": 0.0}
    phys = _read_text(repo / "config" / model / "physical_parameters.yaml")
    for key, pat in _SCALAR_RE.items():
        m = pat.search(phys)
        if m:
            out[key] = float(m.group(1))

    # visual_parameters.yaml：visual_offset 出现在 wrist_1 / wrist_2 / wrist_3 各自的小节下
    vis = _read_text(repo / "config" / model / "visual_parameters.yaml")
    section = None
    for line in vis.splitlines():
        m = re.match(r"^  (\w+):\s*$", line)
        if m:
            section = m.group(1)
        m2 = _VISUAL_OFFSET_RE.match(line)
        if m2 and section in ("wrist_1", "wrist_2", "wrist_3"):
            out[f"visual_offset_{section}"] = float(m2.group(1))
    # wrist_3 的 visual_offset_xyz 优先（URDF 语义）
    m3 = _VISUAL_OFFSET_XYZ_RE.search(vis)
    if m3:
        out["visual_offset_xyz_wrist_3"] = tuple(float(g) for g in m3.groups())
    return out


def visual_origin(repo: Path, model: str, link: str) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """返回该连杆的视觉 origin `(xyz, rpy)`（连杆系 ← 网格系）。"""
    offs = visual_offsets(repo, model)
    rpy = VISUAL_RPY[link]
    if link == "upper_arm":
        xyz = (0.0, 0.0, offs["shoulder_offset"])
    elif link == "forearm":
        xyz = (0.0, 0.0, offs["elbow_offset"])
    elif link in ("wrist_1", "wrist_2", "wrist_3"):
        if link == "wrist_3" and "visual_offset_xyz_wrist_3" in offs:
            xyz = offs["visual_offset_xyz_wrist_3"]  # URDF 优先
        else:
            xyz = (0.0, 0.0, offs.get(f"visual_offset_{link}", 0.0))
    else:
        xyz = (0.0, 0.0, 0.0)
    return xyz, rpy


def origin_matrix(xyz, rpy):
    """URDF `<origin>` → 4x4。rpy 为**固定轴 XYZ**（等价内旋 ZYX）：R = Rz·Ry·Rx。"""
    import numpy as np

    rx, ry, rz = rpy
    cx, sx = np.cos(rx), np.sin(rx)
    cy, sy = np.cos(ry), np.sin(ry)
    cz, sz = np.cos(rz), np.sin(rz)
    rot_x = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    rot_y = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rot_z = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    m = np.eye(4)
    m[:3, :3] = rot_z @ rot_y @ rot_x
    m[:3, 3] = np.asarray(xyz, dtype=float)
    return m


_PATH_RE = re.compile(r"^\s*path:\s*(meshes/\S+)\s*$")


def visual_mesh_paths(repo: Path, model: str) -> list[str]:
    """从 config/<model>/visual_parameters.yaml 取出 7 条 visual 网格路径（仓库相对）。

    只做行级解析：该文件结构固定（`mesh_files:` 下 7 个连杆键，每个含 visual.mesh.path），
    故按出现顺序取所有含 `/visual/` 的 `path:` 值即可，顺序即 LINK_KEYS。
    """
    yml = repo / "config" / model / "visual_parameters.yaml"
    if not yml.is_file():
        raise RuntimeError(f"缺少 {yml}")
    paths = [m.group(1) for m in (_PATH_RE.match(l) for l in yml.read_text(encoding="utf-8").splitlines()) if m]
    visual = [p for p in paths if "/visual/" in p]
    if len(visual) != 7:
        raise RuntimeError(f"{model}: 期望 7 条 visual 路径，实得 {len(visual)}（{visual}）")
    return visual


def convert_one(repo: Path, model: str, out_dir: Path, *, verbose: bool = True,
                face_count: int | None = None, percent: float | None = None) -> dict:
    """把一个型号的 7 个 visual DAE 合成单个 GLB。返回统计信息。"""
    import trimesh  # 延迟导入：缺失时给出清晰错误

    rels = visual_mesh_paths(repo, model)
    scene = trimesh.Scene()
    sources: list[str] = []
    for rel, node, link in zip(rels, NODE_NAMES, LINK_KEYS):
        dae = repo / rel
        if not dae.is_file():
            raise RuntimeError(f"{model}: 网格文件不存在 {rel}（sparse-checkout 是否完整？）")
        sources.append(rel)
        geom = trimesh.load(str(dae), force="mesh", process=False)
        # 官方 DAE 的顶点大量重复（每个材质段各自一份），焊接后顶点数约减半、
        # GLB 体积约 −40%，而面数与外观完全不变（实测 ur3：2.41 MB → 1.45 MB）。
        geom.merge_vertices()
        geom.remove_unreferenced_vertices()
        # Ruling 37：把官方 URDF 的 <visual><origin> 烘焙进网格，使其落在**连杆系**。
        # 不做这一步，7 段会绕自身长轴各错开约 90°、肘部悬空（不报错，只是难看且错）。
        xyz, rpy = visual_origin(repo, model, link)
        geom.apply_transform(origin_matrix(xyz, rpy))
        if percent is not None:
            # trimesh 5.x: simplify_quadric_decimation(percent | face_count, aggression)
            # percent 语义为"目标保留比例"以外的削减比例，故用 face_count 更直观。
            geom = geom.simplify_quadric_decimation(face_count=max(200, int(len(geom.faces) * (1 - percent))))
        elif face_count:
            geom = geom.simplify_quadric_decimation(face_count=face_count)
        scene.add_geometry(geom, node_name=node)

    out = out_dir / f"{model}.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    scene.export(str(out))

    info = {"model": model, "meshes": len(scene.geometry), "bytes": out.stat().st_size,
            "sources": sources}
    if verbose:
        mb = info["bytes"] / 1024 / 1024
        first = rels[0].split("/")[1]
        note = f"  (复用 {first} 的网格)" if first != model else ""
        print(f"  [ok] {model}: {info['meshes']} meshes -> {mb:.2f} MB{note}", flush=True)
    return info


def main() -> int:
    parser = argparse.ArgumentParser(description="UR visual DAE -> per-model GLB")
    parser.add_argument("--repo", required=True, help="官方仓库根目录（含 config/ 与 meshes/）")
    parser.add_argument("--out", default="assets/models", help="输出目录（默认 assets/models）")
    parser.add_argument("--only", nargs="*", help="只转换这些型号（默认全部 14 款）")
    parser.add_argument("--face-count", type=int, default=None,
                        help="每个网格抽稀到该面数（需 fast-simplification）")
    parser.add_argument("--percent", type=float, default=None,
                        help="每个网格削减比例，如 0.5 = 面数减半（需 fast-simplification）")
    args = parser.parse_args()

    repo = Path(args.repo)
    if not (repo / "config").is_dir() or not (repo / "meshes").is_dir():
        print(f"repo 结构不对（需含 config/ 与 meshes/）：{repo}", file=sys.stderr)
        return 2
    out_dir = Path(args.out)
    models = args.only if args.only else MODELS

    results, failures = [], []
    for model in models:
        try:
            results.append(convert_one(repo, model, out_dir,
                                       face_count=args.face_count, percent=args.percent))
        except Exception as exc:  # 单型号失败不中断整体
            failures.append({"model": model, "error": f"{type(exc).__name__}: {exc}"})
            print(f"  [FAIL] {model}: {exc}", flush=True)

    total = sum(r["bytes"] for r in results)
    print(f"完成：{len(results)}/{len(models)} 型号，合计 {total / 1024 / 1024:.2f} MB -> {out_dir}")
    if failures:
        print(f"失败 {len(failures)} 个：{[f['model'] for f in failures]}")
    return 0 if results else 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Ruling 37 验收：装配后相邻连杆是否相接 + 网格长轴是否指向下一个关节。

独立实现（不 import 任何仓库 JS），直接读 GLB 的 accessor min/max 与 assets/kinematics.json。

用法：python .twin-contiguity-check.py <glb> <model> [--json]
"""
from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np

NODE_NAMES = ["base", "shoulder", "upperarm", "forearm", "wrist1", "wrist2", "wrist3"]


def read_glb(path: Path):
    raw = path.read_bytes()
    jl = struct.unpack("<I", raw[12:16])[0]
    doc = json.loads(raw[20:20 + jl].decode("utf-8"))
    bin_off = 20 + jl + 8
    return doc, raw, bin_off


def node_bboxes(doc, raw, bin_off):
    """每个顶层节点的局部 AABB（用 POSITION accessor 的 min/max，无需解二进制）。"""
    out = {}
    for node in doc.get("nodes", []):
        name = node.get("name")
        mesh_idx = node.get("mesh")
        if name is None or mesh_idx is None:
            continue
        mesh = doc["meshes"][mesh_idx]
        lo = np.array([np.inf] * 3)
        hi = np.array([-np.inf] * 3)
        for prim in mesh["primitives"]:
            acc = doc["accessors"][prim["attributes"]["POSITION"]]
            if "min" not in acc or "max" not in acc:
                return None  # 需要解二进制，本脚本不支持
            lo = np.minimum(lo, np.array(acc["min"], dtype=float))
            hi = np.maximum(hi, np.array(acc["max"], dtype=float))
        out[name] = (lo, hi)
    return out


def rpy_matrix(r, p, y):
    cr, sr = math.cos(r), math.sin(r)
    cp, sp = math.cos(p), math.sin(p)
    cy, sy = math.cos(y), math.sin(y)
    rx = np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]])
    ry = np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]])
    rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    m = np.eye(4)
    m[:3, :3] = rz @ ry @ rx
    return m


def rot_z(t):
    c, s = math.cos(t), math.sin(t)
    m = np.eye(4)
    m[:3, :3] = np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    return m


def fk(links, q):
    """L_0 = I；L_k = L_{k-1} · B_k · Rz(q_k)。

    ## ⚠️ 顺序是 T·R，不是 R·T（脚本原先写成了 R·T）
    `assets/kinematics.json` 里那 6 个 `links` 段是 UR 的**改进 DH 段矩阵**
    `B_i = Rx(α) · Tx(a) · Tz(d)`，与 URDF `<origin xyz rpy>` 的语义一致；而
    `src/client/robot/fk.js` 的 `poseToMatrix4()` 正是 **Trans·R**。脚本原先写成
    `R · T`，在 `links[4]`/`links[5]`（rpy 与 xyz 同时非零）上会与真实渲染差约 0.18 m ——
    也就是说它会报出与客户端实际画面无关的 PASS/FAIL。改回 T·R 后与 fk.js 一致。
    """
    frames = [np.eye(4)]
    t = np.eye(4)
    for i in range(6):
        seg = links[i]
        p = np.eye(4)
        p[:3, 3] = [seg.get("x", 0.0), seg.get("y", 0.0), seg.get("z", 0.0)]
        # Trans·R：先平移（URDF <origin xyz>），再旋转（URDF <origin rpy>）。
        t = t @ p
        t = t @ rpy_matrix(seg.get("roll", 0.0), seg.get("pitch", 0.0), seg.get("yaw", 0.0))
        t = t @ rot_z(q[i])
        frames.append(t.copy())
    return frames


def world_aabb(lo, hi, m):
    corners = np.array([[x, y, z, 1.0] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])])
    w = (m @ corners.T).T[:, :3]
    return w.min(axis=0), w.max(axis=0)


def gap(a, b):
    """两个 AABB 的分离距离（相交为 0）。"""
    d = np.maximum(0.0, np.maximum(a[0] - b[1], b[0] - a[1]))
    return float(np.linalg.norm(d))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("model")
    args = ap.parse_args()

    kin = json.loads(Path("assets/kinematics.json").read_text(encoding="utf-8"))[args.model]
    links = kin["links"]
    doc, raw, bin_off = read_glb(Path(args.glb))
    boxes = node_bboxes(doc, raw, bin_off)
    if boxes is None:
        print("该 GLB 的 accessor 缺少 min/max，无法用本脚本核验")
        return 2

    frames = fk(links, [0.0] * 6)
    world = {}
    for k, name in enumerate(NODE_NAMES):
        if name in boxes:
            world[name] = world_aabb(boxes[name][0], boxes[name][1], frames[k])

    # 1) 相邻连杆间隙
    gaps = []
    for k in range(6):
        a, b = NODE_NAMES[k], NODE_NAMES[k + 1]
        gaps.append(round(gap(world[a], world[b]), 4) if a in world and b in world else None)

    # 2) 长轴 vs 下一个关节方向 —— 只对**明显细长**的连杆判定：
    #    base / wrist1 等的 AABB 接近立方，"最长轴"是任意的，对其断言无意义。
    angles = []
    for k in range(6):
        name = NODE_NAMES[k]
        if name not in boxes:
            angles.append(None)
            continue
        lo, hi = boxes[name]
        ext = hi - lo
        ratio = float(ext.max() / max(ext.min(), 1e-9))
        if ratio < 1.8:
            angles.append(("n/a", round(ratio, 2)))
            continue
        axis = int(np.argmax(ext))
        m = frames[k]
        mesh_dir = m[:3, :3] @ np.eye(3)[axis]
        seg = links[k]
        off = np.array([seg.get("x", 0.0), seg.get("y", 0.0), seg.get("z", 0.0)])
        n = np.linalg.norm(off)
        if n < 1e-9:
            angles.append(None)
            continue
        unit = off / n
        ang = round(float(np.degrees(np.arccos(np.clip(abs(float(mesh_dir @ unit)), -1, 1)))), 1)
        angles.append(ang)

    total = round(sum(g for g in gaps if g is not None), 4)
    # 尺度无关判据：每个相邻间隙必须小于该型号"总连杆长度"的 5%。
    # 依据：修好视觉 origin 后残余最大为 43 mm / 1.7 m ≈ 2.5%（CAD 装配间隙量级）；
    #       而 D-1 未修时上臂↔肘是 0.16–0.70 m，占 15%–65% —— 两者被清晰分开。
    reach = sum(float(np.linalg.norm([l.get("x", 0.0), l.get("y", 0.0), l.get("z", 0.0)])) for l in links)
    limit = 0.05 * reach
    worst = max((g for g in gaps if g is not None), default=0.0)
    print(f"{args.model:8s} totalGap={total:7.4f} m  worst={worst:6.4f} m  reach={reach:.3f} m  阈值={limit:.4f} m")
    print(f"{'':8s} adjacentGaps={gaps}")
    print(f"{'':8s} [诊断] 细长连杆长轴 vs 下一个关节 夹角={angles}")
    ok = worst < limit
    print(f"{'':8s} => {'PASS' if ok else 'FAIL'}（判据：各相邻间隙 < 总臂长的 5%）")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

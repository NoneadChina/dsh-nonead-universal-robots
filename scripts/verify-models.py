#!/usr/bin/env python
"""
校验 `assets/models/*.glb` 的结构契约（Task 2 / Task 7 的装配前提）。

为什么需要：客户端在 `src/client/robot/loader.js` 里按 **固定名字** 装配 7 个网格节点
（`base / shoulder / upperarm / forearm / wrist1 / wrist2 / wrist3`，见计划 Ruling 25）。
GLB 一旦改了节点名或丢了某个节点，模型会在界面里静默散架——本脚本把这种静默失败变成响亮失败。

用法：python scripts/verify-models.py [--dir assets/models] [--expect 14]
退出码非 0 表示有型号不达标。
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

EXPECTED_NODES = ["base", "shoulder", "upperarm", "forearm", "wrist1", "wrist2", "wrist3"]


def read_glb_json(path: Path) -> dict:
    """读出 GLB 的 JSON chunk。GLB 布局：12 字节头 + (长度,类型) + JSON + BIN。"""
    raw = path.read_bytes()
    if len(raw) < 20 or raw[:4] != b"glTF":
        raise ValueError("不是合法的 GLB（magic 不是 glTF）")
    json_len = struct.unpack("<I", raw[12:16])[0]
    return json.loads(raw[20:20 + json_len])


def check(path: Path) -> tuple[bool, list[str], dict]:
    problems: list[str] = []
    meta: dict = {}
    try:
        doc = read_glb_json(path)
    except Exception as exc:
        return False, [f"无法解析：{exc}"], meta

    names = [n.get("name") for n in doc.get("nodes", [])]
    meta["nodes"] = names
    meta["images"] = len(doc.get("images", []))
    meta["meshes"] = len(doc.get("meshes", []))
    meta["bytes"] = path.stat().st_size

    if names != EXPECTED_NODES:
        problems.append(f"节点名/顺序不符：期望 {EXPECTED_NODES}，实得 {names}")
    if meta["meshes"] != 7:
        problems.append(f"网格数不是 7：{meta['meshes']}")
    for img in doc.get("images", []):
        if "bufferView" not in img:
            problems.append(f"贴图未内嵌（缺 bufferView）：{img.get('uri')}")
    return (not problems), problems, meta


def main() -> int:
    ap = argparse.ArgumentParser(description="校验 assets/models 下 GLB 的节点契约")
    ap.add_argument("--dir", default="assets/models")
    ap.add_argument("--expect", type=int, default=14, help="期望的型号数（默认 14）")
    args = ap.parse_args()

    glbs = sorted(Path(args.dir).glob("*.glb"))
    if not glbs:
        print(f"没有找到任何 GLB：{args.dir}", file=sys.stderr)
        return 2

    total = 0
    bad = []
    for p in glbs:
        ok, problems, meta = check(p)
        total += meta.get("bytes", 0)
        tag = "OK" if ok else "FAIL"
        mb = meta.get("bytes", 0) / 1024 / 1024
        print(f"  [{tag}] {p.name:12s} {mb:6.2f} MB  nodes={len(meta.get('nodes', []))} images={meta.get('images', 0)}")
        for pr in problems:
            print(f"         - {pr}")
        if not ok:
            bad.append(p.name)

    print(f"合计 {len(glbs)} 个文件 {total / 1024 / 1024:.2f} MB；不达标 {len(bad)} 个")
    if len(glbs) != args.expect:
        print(f"警告：型号数 {len(glbs)} != 期望 {args.expect}")
        bad.append(f"<count {len(glbs)} != {args.expect}>")
    return 0 if not bad else 1


if __name__ == "__main__":
    raise SystemExit(main())

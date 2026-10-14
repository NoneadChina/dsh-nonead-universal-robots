"""Cross-language contract check: does every tool's declared parameter exist in the
Python handler that receives it, and does every parameter the handler *reads* get
declared by the tool?

Why this matters: `lib/index.js` declares the schema the model sees; `ur_worker.py`
does `p["x"]` / `p.get("x", default)`. A model-supplied key that the handler ignores is
a silently dropped instruction ("I set the tool voltage" -> nothing happens), and a
handler reading a key the schema never declares means the model cannot set it at all
(an undocumented but required argument).

Both directions are checked statically: the tool list is parsed from lib/index.js and
the parameter reads from the handler bodies via `ast`. Keys starting with `_` (the
protocol's own `_timeout_ms`) and the `ip` envelope field are excluded.
"""
from __future__ import annotations

import ast
import json
import os
import re

INDEX = "lib/index.js"
WORKER = "python/ur_worker.py"

index = open(INDEX, encoding="utf-8").read()
worker = open(WORKER, encoding="utf-8").read()
tree = ast.parse(worker)

# ---- tools: op -> set of declared parameter names -------------------------
tools = {}
for m in re.finditer(r"\{\s*op:\s*'([a-z_0-9]+)',\s*\n\s*toolName:\s*'(ur_[a-zA-Z_0-9]+)'", index):
    op, tool = m.group(1), m.group(2)
    # the parameters block of this tool: from "parameters:" to the matching close
    start = index.find("parameters:", m.end())
    if start < 0:
        continue
    brace = index.find("{", start)
    depth = 0
    i = brace
    while i < len(index):
        if index[i] == "{":
            depth += 1
        elif index[i] == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    block = index[brace : i + 1]
    # Top-level parameter keys only: the block is `{ ip: IP(), pose: numberArray({...}),
    # ..., ...MOVE_PARAMS() }`. Take the keys at the block's own depth so nested schema
    # objects (`{ type: 'array', items: {...} }`) are not mistaken for parameters, and
    # expand the spread helpers into their real keys.
    keys = set()
    depth = 0
    for line in block.split("\n"):
        stripped = line.strip()
        opened = line.count("{") + line.count("[") + line.count("(")
        closed = line.count("}") + line.count("]") + line.count(")")
        if depth == 1:
            m = re.match(r"([a-zA-Z_][a-zA-Z_0-9]*)\s*:", stripped)
            if m:
                keys.add(m.group(1))
        depth += opened - closed
    spread = re.findall(r"\.\.\.\s*([A-Z_]+)\(\)", block)
    if "MOVE_PARAMS" in spread:
        keys |= {"a", "v", "t", "r"}
    tools[op] = {"tool": tool, "params": keys}

# ---- handlers: op -> set of parameter keys read via p["x"] / p.get("x") ----
handlers = {}

# The worker reads a parameter in one of three shapes:
#   p["key"]                      -- required
#   p.get("key", default)         -- optional
#   _vec(p, "key", 6, "...")      -- validated helper, key passed as a string
#   _bounded_int(p, ... no: (_bounded_int(p.get("key", d), "key", ...)) -- key also literal
# The helper forms are the reason a naive `p[...]`-only scan reports false positives,
# so the helper argument is collected too.
HELPERS = {"_vec", "_bounded_int", "_bounded_float", "_nonneg_float", "_float_list"}

for node in ast.walk(tree):
    if not isinstance(node, ast.FunctionDef) or not node.name.startswith("op_"):
        continue
    read = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Subscript) and isinstance(sub.value, ast.Name) and sub.value.id == "p":
            if isinstance(sub.slice, ast.Constant) and isinstance(sub.slice.value, str):
                read.add(sub.slice.value)
        if (
            isinstance(sub, ast.Call)
            and isinstance(sub.func, ast.Attribute)
            and isinstance(sub.func.value, ast.Name)
            and sub.func.value.id == "p"
            and sub.func.attr == "get"
            and sub.args
            and isinstance(sub.args[0], ast.Constant)
        ):
            read.add(sub.args[0].value)
        if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name) and sub.func.id in HELPERS:
            # Helper shape is `_vec(p, "key", n, "human description")`: the parameter name
            # is the FIRST string after `p`, the following string is prose for the error
            # message. Collecting both would report every description as an undeclared
            # parameter.
            for arg in sub.args[1:2]:
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    read.add(arg.value)
    handlers[node.name] = read

# map op -> handler function
op_to_fn = {}
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "HANDLERS" for t in node.targets):
        for k, v in zip(node.value.keys, node.value.values):
            if isinstance(k, ast.Constant) and isinstance(v, ast.Name):
                op_to_fn[k.value] = v.id

IGNORE = {"ip", "_timeout_ms"}


def is_protocol_internal(name: str) -> bool:
    """`_` 前缀 = 宿主**注入**的协议字段（`_timeout_ms` 是第一个，位姿表的 `_path`/`_dir`/配额字段是后来的）。

    docstring 一直写着"`_` 开头的键会被排除"，而实现原先只排除字面的 `{"ip", "_timeout_ms"}` ——
    实现比自己的文档更严。这里让实现回到文档，因为这是协议**本来就有**的注入通道：
    `sanitizeArgs` 只保留 schema 声明过的键，而未声明的 `_` 字段由宿主在过滤之后自己塞进去，
    所以模型既改不了 `_timeout_ms`，也指定不了位姿文件路径。
    """
    return name.startswith("_")

# Chinese messages on a GBK console: write the report to a file as UTF-8 and keep stdout
# ASCII-safe, or the check itself dies with UnicodeEncodeError on a Chinese Windows box.
# The file is written next to this script and deleted on the way out.
REPORT = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".tmp-tool-params.txt")

# Two shapes are reported by this static scan but are NOT defects, because the parameter is
# read by a shared helper that the scan does not follow into. They are listed explicitly so a
# *new* occurrence still fails the check:
#   programs_dir -> _resolve_program_path()   (ur_worker.py:1666-1677)
#   enabled      -> _set_control_mode()       (ur_worker.py:2635-2638)
HELPER_READS = {
    "load_program": {"programs_dir"},
    "run_program": {"programs_dir"},
    "set_freedrive": {"enabled"},
    "set_teach_mode": {"enabled"},
}

out = open(REPORT, "w", encoding="utf-8")
print("tool op -> handler, declared vs read")
print("=" * 78)
problems = 0
for op, info in sorted(tools.items()):
    fn = op_to_fn.get(op)
    if fn is None:
        print("  !! %-24s %s has NO handler in HANDLERS" % (op, info["tool"]))
        problems += 1
        continue
    read = {k for k in handlers.get(fn, set()) - IGNORE if not is_protocol_internal(k)}
    declared = info["params"] - IGNORE
    ignored = sorted(declared - read - HELPER_READS.get(op, set()))
    undeclared = sorted(read - declared - HELPER_READS.get(op, set()))
    # ★ 新增：**声明过的**参数绝不能长得像协议内部字段。否则模型就能设置一个宿主打算注入的字段
    # （宿主会在过滤后覆盖它，或者更糟：把某个 op 指向模型自己挑的路径/状态）。
    internal_declared = sorted(k for k in info["params"] if is_protocol_internal(k))
    if internal_declared:
        problems += 1
        print("  %-22s %s" % (op, info["tool"]))
        print("      declared with a protocol-internal `_` name (the model would be able to set it): %s"
              % internal_declared)
    if ignored or undeclared:
        problems += 1
        print("  %-22s %s" % (op, info["tool"]))
        if ignored:
            print("      declared but never read (silently ignored): %s" % ignored)
        if undeclared:
            print("      read but not declared (model cannot set):     %s" % undeclared)

print("=" * 78)
print("ops with a contract mismatch: %d / %d" % (problems, len(tools)))
out.write("checked %d tools\n" % len(tools))
out.close()
os.remove(REPORT)
if problems:
    print("FAIL  以上 op 的 schema 与 Python 读取的参数不一致（见每条的说明）")
    raise SystemExit(1)
print("PASS  每个工具声明的参数都会被 Python 读到，且 Python 读的参数都已声明")
print(json.dumps({"mismatched_ops": problems, "tools": len(tools)}))

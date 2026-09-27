"""Cross-check the approval gate against every op the worker implements.

Two questions, both of which must have a definite answer before this can be a gate:

1. **Is every gated name real?** A typo in `APPROVAL_OPS` means that command is not gated at
   all — the set silently does nothing for it. Exit 1.
2. **Which ops are reachable without approval?** Most are legitimate reads. But an op that can
   move the arm, run a program, drop power/stiffness or change a payload/motion characteristic
   must never appear in that list. That judgement cannot be automated, so the list is printed in
   full and a small, explicit set of "must be gated" ops is asserted (see `MUST_BE_GATED`).

Exit code: 0 only when no gated name is stale and every op in MUST_BE_GATED is gated.
"""
import ast
import re
import sys

# Ops whose side effects are physical and unrecoverable enough that a human must confirm first.
# Expanding this list is the intended way to respond to a new dangerous op; the printout below
# is what makes the rest reviewable.
MUST_BE_GATED = {
    # motion
    "movej", "movel", "movep", "movec", "servoj", "move_x", "move_y", "move_z",
    "move_tool_x", "move_tool_y", "move_tool_z", "move_optimized",
    "draw_circle", "draw_square", "draw_rectangle", "draw_star",
    # open-ended velocity / force control
    "speedj", "speedl", "stopj", "stopl", "force_mode", "end_force_mode", "force_mode_settings",
    # programs and raw scripting
    "load_program", "run_program", "send_script", "reset_error",
    # arm state: stiffness, power, brakes, safety
    "set_freedrive", "set_teach_mode", "power_on", "power_off", "brake_release",
    "unlock_protective_stop", "shutdown",
    # anything that re-zeros or re-defines the force/torque reference, or how motion is planned
    "zero_ftsensor", "set_payload", "set_payload_inertia", "set_gravity",
    "conveyor_tracking", "motion_version",
}

failures = []

idx = open("lib/index.js", encoding="utf-8").read()
src = open("python/ur_worker.py", encoding="utf-8").read()
tree = ast.parse(src)

handlers = None
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "HANDLERS" for t in node.targets):
        handlers = node
ops = [k.value for k in handlers.value.keys]

pairs = re.findall(r"\{\s*op:\s*'([a-z_0-9]+)',\s*\n\s*toolName:\s*'(ur_[a-zA-Z_0-9]+)'", idx)
tool_of_op = {op: name for op, name in pairs}

orphans = [o for o in ops if o not in tool_of_op and o != "shutdown_worker"]
print("ops in HANDLERS:        %d" % len(ops))
print("tools registered:       %d" % len(pairs))
print("ops without a tool:     %s" % (orphans or "none"))
if orphans:
    failures.append("ops without a tool: %s" % orphans)

block = re.search(r"const APPROVAL_OPS = new Set\(\[(.*?)\]\);", idx, re.S).group(1)
approved = set(re.findall(r"'([a-z_0-9]+)'", block))
print("ops gated by approval:  %d" % len(approved))

stale = sorted(o for o in approved if o not in ops)
print("\nGATED but no such op (stale entry, typo => gate is useless for it): %s" % (stale or "none"))
if stale:
    failures.append("APPROVAL_OPS 里有不存在的 op（门禁对它是空转）：%s" % ", ".join(stale))

missing = sorted(op for op in MUST_BE_GATED if op not in approved)
if missing:
    failures.append("以下 op 的副作用必须人工确认，但没在 APPROVAL_OPS 里：%s" % ", ".join(missing))
    print("\n!! MUST_BE_GATED 里未受门禁的 op: %s" % ", ".join(missing))
else:
    print("\nPASS  %d 个必须受门禁的 op 全部已门禁" % len(MUST_BE_GATED))

ungated = sorted(o for o in ops if o not in approved and o != "shutdown_worker")
print("\nNOT GATED (%d) — each needs a judgement: can it move the arm," % len(ungated))
print("run a program, change power/stiffness, or physically actuate something?")
for op in ungated:
    print("   %-26s -> %s" % (op, tool_of_op.get(op, "(NO TOOL)")))

if failures:
    print("\n%d 项失败：" % len(failures))
    for f in failures:
        print("   - %s" % f)
    sys.exit(1)
print("\n审批门禁一致性检查通过。")


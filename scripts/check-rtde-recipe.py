"""Compare the plugin's RTDE receive recipe with the vendored default — as a gate.

Context: UR accepts a bounded number of values in one RTDE receive configuration. Exceeding it
makes the controller refuse SETUP_OUTPUTS, which fails the connection outright — so "one field
too many" is a release blocker, not a nicety. The plugin also asserts a specific field count in
its own comment, and that comment has already drifted from the file once.

Exits non-zero when either recipe exceeds the limit, when the plugin's recipe lost a field a tool
depends on, or when a `<send>` section reappears (the project deliberately claims no RTDE input
variables; a non-empty one makes the reconnect path crash the worker).
"""
import re
import sys

LIMIT = 96
SEND_SECTION_FORBIDDEN = True
# Fields a shipped tool actually reads; losing one silently degrades that tool.
REQUIRED = {
    "actual_q", "actual_qd", "actual_current", "actual_TCP_pose", "actual_TCP_speed",
    "actual_TCP_force", "target_q", "target_qd", "target_qdd", "target_TCP_pose",
    "target_TCP_speed", "output_bit_registers0_to_31", "output_bit_registers32_to_63",
    "robot_status_bits", "safety_status_bits", "speed_scaling",
}

failures = []


def enabled_fields(path):
    src = open(path, encoding="utf-8").read()
    body = re.sub(r"<!--[\s\S]*?-->", "", src)          # drop commented-out fields
    recv = re.search(r"<receive\b[^>]*>([\s\S]*?)</receive>", body)
    if recv is None:
        return None, 0
    names = re.findall(r'<field\s+name="([^"]+)"', recv.group(1))
    return names, len(re.findall(r"<!--\s*<field", src))


def has_send_section(path):
    body = re.sub(r"<!--[\s\S]*?-->", "", open(path, encoding="utf-8").read())
    return bool(re.search(r"<send\b", body))


for path in ("python/URBasic/rtdeConfigurationDefault.xml", "python/URBasic/rtdeConfiguration.xml"):
    names, commented = enabled_fields(path)
    if names is None:
        failures.append("%s 缺少 <receive> 段" % path)
        continue
    counted = len(names)
    if "output_bit_registers0_to_31" in names and "output_bit_registers32_to_63" in names:
        counted -= 1            # UR counts the two 32-bit entries as one 64-bit value
    print("%-52s enabled=%-4d counted=%-4d commented_out=%d" %
          (path.split("/")[-1], len(names), counted, commented))
    if counted > LIMIT:
        failures.append("%s 用了 %d 个值，超过 UR 的 %d 上限（控制器会拒绝 SETUP_OUTPUTS，"
                        "连接直接失败）" % (path, counted, LIMIT))
    if len(set(names)) != len(names):
        failures.append("%s 里有重复字段" % path)
    if SEND_SECTION_FORBIDDEN and has_send_section(path):
        failures.append("%s 出现了 <send> 段：本项目刻意不认领 RTDE 输入变量，"
                        "非空输入配方会让上游重连分支每次重连都触发"
                        "「input parameter is already in use」并打崩 worker" % path)

names, _ = enabled_fields("python/URBasic/rtdeConfiguration.xml")
if names is not None:
    missing = sorted(REQUIRED - set(names))
    if missing:
        failures.append("插件配方缺少工具依赖的字段：%s" % ", ".join(missing))
    else:
        print("PASS  插件配方包含全部 %d 个工具依赖字段，且计数在 %d 上限内" % (len(REQUIRED), LIMIT))
    target = [n for n in names if n.startswith("target_")]
    print("     target_* 字段：%s" % (target or "none"))

if failures:
    print("FAIL")
    for f in failures:
        print("   - %s" % f)
    sys.exit(1)
print("PASS  RTDE 配方检查通过")


"""Measure whether `RealTimeClient.SendProgram` blocks while a previous program is
still flagged as running.

Why this matters for the plugin: force mode and freedrive are implemented as
*never-ending* URScript programs (that is what those modes require). Entering one makes
`SendProgram` start a status-guardian thread and set `rtcProgramRunning = True`. The
question this probe answers is whether a LATER `SendProgram` (exiting force mode, or
just commanding a move afterwards) has to wait that flag out — which would stall the
single-threaded worker far beyond any caller timeout.

Result on this checkout: it does NOT stall. `SendProgram`'s precondition
(`while rtcProgramRunning: sleep(0.1)`) is satisfied immediately because it raises
`stopRunningFlag` first, and the guardian thread's loop exits on that flag and clears
`rtcProgramRunning` in its `finally`. Measured: 0.10 s to send the never-ending program,
0.25 s to send the next one. The residual cost is one thread join plus up to 0.1 s of
sleep — not a defect. This file is kept as the executable record of that check so nobody
re-investigates it from the source alone.

Run with an interpreter that has numpy:

    <python> scripts/probe-sendprogram-blocking.py
"""
import os
import socket
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "python"))

from URBasic import realTimeClient  # noqa: E402
from URBasic.connectionState import ConnectionState  # noqa: E402


class Status:
    StoppedDueToSafety = False


class RobotStatus:
    ProgramRunning = True


class StubModel:
    """Only what SendProgram / the guardian thread touch."""

    ipAddress = "127.0.0.1"
    rtcConnectionState = ConnectionState.CONNECTED
    stopRunningFlag = False
    rtcProgramRunning = False
    rtcProgramExecutionError = False
    forceRemoteActiveFlag = False
    hasForceTorqueSensor = False

    def SafetyStatus(self):
        return Status()

    def RobotStatus(self):
        return RobotStatus()

    def OutputBitRegister(self):
        # [0] = "program started", [1] = "program finished". A never-ending program
        # sets [0] once and never sets [1] — this is exactly the state an infinite
        # force_mode / freedrive program leaves behind.
        return (True, False)


def loopback():
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    peer = socket.create_connection(listener.getsockname(), timeout=2.0)
    accepted, _ = listener.accept()
    listener.close()
    accepted.settimeout(0.5)
    return peer, accepted


model = StubModel()
client = realTimeClient.RealTimeClient(model)
peer, accepted = loopback()
# Point the client at our loopback peer instead of port 30003.
client._RealTimeClient__sock = peer
client._RealTimeClient__connect = lambda: True
# Keep the guardian's own budget short so the probe finishes quickly; the question is
# whether a *later* send blocks on the flag, not how long the budget is.
client._RealTimeClient__waitTimeout = 3.0

print("step 1: send a never-ending program (the force_mode / freedrive shape)")
t0 = time.time()
sent = client.SendProgram("def ur_force_mode():\n  while(True):\n    sync()\n  end\nend\n"
                          "ur_force_mode()\n")
t1 = time.time()
print("   returned %s after %.2fs; rtcProgramRunning=%s stopRunningFlag=%s"
      % (sent, t1 - t0, model.rtcProgramRunning, model.stopRunningFlag))

print("step 2: immediately send another program (the `end_force_mode` / next-move shape)")
t2 = time.time()
sent2 = client.SendProgram("end_force_mode()\n")
t3 = time.time()
print("   returned %s after %.2fs; rtcProgramRunning=%s"
      % (sent2, t3 - t2, model.rtcProgramRunning))

print()
if t3 - t2 > 1.0:
    print("RESULT: the second send waited %.2fs on the previous program's flag." % (t3 - t2))
    print("        => entering an infinite mode would stall every later SendProgram until")
    print("           the guardian's budget expires (600 s in production).")
elif t3 - t2 > 0.3:
    print("RESULT: the second send waited %.2fs — a thread join plus the 0.1 s poll," % (t3 - t2))
    print("        not a stall. Callers see a short, bounded delay.")
else:
    print("RESULT: the second send did not stall (%.3fs)." % (t3 - t2))

for sock in (peer, accepted):
    try:
        sock.close()
    except OSError:
        pass

"""Does a malformed request line get an answer, or is the caller left hanging?

`ur_worker.py`'s receive loop catches `Exception` for unexpected failures and its handler
mentions `req`:

    _log("未处理异常（op=%s）：\\n%s" % (req.get("op") if isinstance(req, dict) else "?",
                                    traceback.format_exc()))

If the exception was raised *before* `req` was bound (i.e. by the `json.loads(line)` on the
line above it), then evaluating that argument raises NameError inside the except block, the
`respond(...)` call below it never runs, and the caller waits forever — the worker handles
one request per line and has no other way to answer.

This probe drives `main()`'s logic directly with an in-memory stdin/stdout so it does not need
a robot, but it does need the module to import, i.e. an interpreter with numpy/paramiko:

    <python> scripts/probe-malformed-request.py
"""
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "python"))

import ur_worker  # noqa: E402

CAPTURED = io.StringIO()
ur_worker._PROTOCOL_OUT = CAPTURED
# Keep our own log noise out of the way for this probe.
ur_worker._log = lambda msg: None

# `import ur_worker` redirects sys.stdout into the capped log file, so the probe's own
# output has to go to stderr (which the harness shows) to be visible at all.
def say(message):
    sys.stderr.write(message + "\n")

CASES = {
    "malformed JSON": "{ this is not json\n",
    "JSON but not an object": "[1,2,3]\n",
    "unknown op (control case)": json.dumps({"id": 2, "op": "nope-not-an-op"}) + "\n",
    "valid op, no robot (control case)": json.dumps({"id": 3, "op": "ping"}) + "\n",
}

for label, line in CASES.items():
    CAPTURED.seek(0)
    CAPTURED.truncate(0)
    saved_stdin = sys.stdin
    sys.stdin = io.StringIO(line)
    try:
        ur_worker.main()
    except Exception as exc:                                   # noqa: BLE001
        say("%-34s main() raised %s: %s" % (label, type(exc).__name__, exc))
        sys.stdin = saved_stdin
        continue
    finally:
        sys.stdin = saved_stdin
    out = CAPTURED.getvalue().strip()
    if out:
        try:
            parsed = json.loads(out.splitlines()[-1])
            say("%-34s answered: ok=%s code=%s" % (label, parsed.get("ok"), parsed.get("code")))
        except Exception:                                      # noqa: BLE001
            say("%-34s answered (unparseable): %r" % (label, out[:80]))
    else:
        say("%-34s *** NO ANSWER — the caller would hang until its timeout ***" % label)

# dsh-nonead-universal-robots

**A DeepSeek Harness (DSH) plugin that lets you control Universal Robots (UR) collaborative arms directly from natural language, developed by Suzhou Nonead Robot Technology Co., Ltd. based on the same logic as the company's own nUR MCP Server.** ([Suzhou Nonead Robot Technology Co., Ltd.](https://www.nonead.com))

This plugin shares the same ancestry as the company's `Nonead-Universal-Robots-MCP` (see "Reference implementation" below). It exposes the "control a UR robot with AI" capability as **native DSH tools**: the plugin starts a persistent Python worker (which internally reuses the vendored `URBasic` library), and tools talk to the robot through that worker. After a single `connect`, you can keep issuing commands to the same IP.

> ⚠️ **Safety notice**: this plugin drives a real robotic arm directly. Always keep the robot in sight, keep the emergency stop within reach, and keep the workspace clear of people/obstacles. Treat it with the same care as granting the `bash` tool. You (or the model) bear full responsibility for any motion command.

> 🛡️ **Motion approval gate**: commands that physically move the arm, run a program, **take the arm out of program control, or remove its rigidity** — `ur_movej` / `ur_movel` / `ur_movep` / `ur_movec` / `ur_servoj` / `ur_move_optimized` / `ur_move_x|y|z` / `ur_move_tool_x|y|z` / `ur_draw_*` / `ur_load_program` / `ur_run_program` / `ur_send_script` / `ur_reset_error`; (0.5.0) `ur_set_freedrive` / `ur_set_teach_mode` / `ur_power_on` / `ur_power_off` / `ur_brake_release` / `ur_unlock_protective_stop` / `ur_shutdown` / `ur_zero_ftsensor` / `ur_set_conveyor_tracking`; (0.6.0) `ur_force_mode` / `ur_end_force_mode` / `ur_force_mode_settings` / `ur_speedj` / `ur_speedl` / `ur_stopj` / `ur_stopl` / `ur_set_payload_inertia`, plus `ur_motion_version`, `ur_set_payload` and `ur_set_gravity` — **pause and wait for human confirmation** before being sent to the robot. In an interactive deployment (approval policy `ask`) a confirmation dialog is shown in the UI; a call made without an approval service, without an agent, or answered with anything other than `allowed-once` **fails closed** (the command is rejected) and never moves without approval. The default lives in code (`config.requireApprovalForMotion ?? true`), so it cannot be turned off by a caller that skips schema parsing. Set `requireApprovalForMotion: false` to disable this gate deliberately. `test/approval-gate.test.mjs` drives the real tool registry and proves all of the above, including that an extra `op` argument cannot re-route a call.

---

## Feature overview

**83** tools (`ur_*`) in total.

| Category | Tool(s) (`ur_*`) | Description |
|---|---|---|
| Connection | `ur_connect` / `ur_disconnect` | Connect / disconnect a UR robot by IP |
| Status | `ur_get_status` | One-shot read of TCP, joints, model, serial, version, safety mode, run/program state, voltage, current, temperatures, uptime, joint currents/voltages/speeds, TCP speed and wrench, speed scaling |
| Pose | `ur_get_tcp_pose` / `ur_get_joint_pose` | Read current TCP pose / joint angles |
| Targets | `ur_get_target_values` | Read **where the controller is *taking* the arm**: target joint positions/velocities/accelerations and target TCP pose/speed, plus the matching actual values for comparison. Comes from the RTDE `target_*` fields (added to the receive recipe in 0.6.0), so it is free — and it is the only direct evidence for "command sent but not executed yet / being blended / held back by the safety limit" |
| Device info | `ur_get_robot_model` / `ur_get_serial_number` / `ur_get_uptime` / `ur_get_software_version` / `ur_get_safety_mode` / `ur_get_safety_status` / `ur_get_robot_mode` | Model (with `remote_control` field) / serial / uptime / software version / safety mode / **safety and robot status bits** (which safety function fired, incl. violation / fault; numeric limits must be read from PolyScope's Safety page) / run state |
| Programs | `ur_get_program_state` / `ur_load_program` / `ur_run_program` / `ur_stop_program` / `ur_pause_program` / `ur_list_programs` | Program state, load, run, stop, pause, SSH listing (`list_programs` works with the real robot's `/programs` and URSim `~/URSim_Linux-*/programs.*`; `load/run` accept full/URSim paths and `programs_dir`). **Run/stop/pause now check the controller's reply and report the run state**, instead of treating "could not understand" as success |
| Registers | `ur_get_int_register` / `ur_get_double_register` / `ur_get_bit_register` | Read Int / Double / Bool registers |
| Health | `ur_ping` | Check worker/Python/URBasic readiness without a robot |
| I/O | `ur_get_digital_in` / `ur_set_digital_out` / `ur_get_digital_in_bits` / `ur_get_digital_out_bits` / `ur_get_analog_in` / `ur_set_analog_out` / `ur_get_tool_analog_in` | Digital in/out (incl. **bit-mask reads**, plus `which="tool"` for the tool-flange digital I/O), standard analog in/out (**in engineering units**: URScript's `set_analog_out` takes a relative level [0,1], and the old code sent 5 as full scale; `full_scale` may be 20 for a current-domain port), tool analog in (function name confirmed against the bundled official manuals; argument semantics not verified on hardware) |
| Tool config | `ur_set_tool_voltage` / `ur_set_tcp` / `ur_set_payload` / `ur_set_payload_inertia` / `ur_set_gravity` / `ur_zero_ftsensor` / `ur_set_tool_output_mode` / `ur_set_tool_communication` | Tool voltage (**0/12/24 — the old implementation called a `NotImplementedError` stub and had never once succeeded**), TCP, payload mass/centre of gravity, **mass + CoG + inertia matrix in one call** (`set_target_payload`, 5.10+; avoids the `set_payload` behaviour that resets the inertia matrix and leaves the three parameters inconsistent), gravity direction (for non-horizontal mounting), force/torque sensor zeroing, **tool output mode** (normal / power dual-pin), **tool serial (TCI/RS-485 — ⚠️ enabling it disables the tool analog inputs)** |
| Control mode / power / safety | `ur_set_freedrive` / `ur_set_teach_mode` / `ur_power_on` / `ur_power_off` / `ur_brake_release` / `ur_unlock_protective_stop` / `ur_shutdown` | Freedrive / teach mode (move the arm by hand), power on / off / **brake release** (⚠️ the arm may fall under gravity), **protective-stop unlock only** (no power-on, no brake release — that is what distinguishes it from `ur_reset_error`), controller shutdown |
| Force control | `ur_force_mode` / `ur_end_force_mode` / `ur_force_mode_settings` | **Force Mode**: the arm becomes compliant along/about the selected axes and keeps applying the requested force/torque. Arguments match the manual one by one — `task_frame` / `selection_vector` (1 = compliant) / `wrench` / `type` (1-3) / `limits` (compliant axes = max TCP speed, stiff axes = max deviation) / `damping` / `gain_scaling`. The script inserts the manual's recommended `sleep(0.02)` before entering force mode; exit with `ur_end_force_mode`. ⚠️ `damping`/`gain_scaling` **cannot be read back from the controller**, so the tool reports what it set rather than pretending to read the current value |
| Velocity control | `ur_speedj` / `ur_speedl` / `ur_stopj` / `ur_stopl` / `ur_wait_steady` | Joint/TCP **velocity commands** (`speedj`/`speedl`) and the matching decelerations (`stopj`/`stopl`). ⚠️ Velocity commands are **open-ended**: with `t=0` (the default) the function returns once the target speed is reached while the arm **keeps moving** — always finish with a stop* or `ur_wait_steady`. `ur_wait_steady` polls the RTDE speed fields instead of using URScript's `is_steady()` (which is documented to return false in force/teach mode) |
| Live telemetry | `ur_get_runtime_telemetry` / `ur_get_robot_voltage` / `ur_get_robot_current` / `ur_get_joint_temperatures` / `ur_get_speed_scaling` / `ur_get_tcp_force` / `ur_get_tool_telemetry` | Joint currents/voltages/speeds, TCP speed and wrench, tool accelerometer, speed scaling, robot voltage/current, joint temperatures, tool current/voltage, I/O current. **These fields are already in the 500 Hz RTDE stream**, so reading them is free and needs no reconfiguration. Single-value reads and the one-shot `ur_get_runtime_telemetry` summary coexist: poll a single value when that is all you need, use the summary for diagnosis |
| Conveyor | `ur_get_conveyor` / `ur_set_conveyor_tick` / `ur_set_conveyor_tracking` | Conveyor tick read / set, and **starting/stopping linear or circular tracking** |
| Motion | `ur_movej` / `ur_movel` / `ur_movep` / `ur_movec` / `ur_servoj` / `ur_move_optimized` / `ur_move_x` / `ur_move_y` / `ur_move_z` / `ur_move_tool_x` / `ur_move_tool_y` / `ur_move_tool_z` | Joint-space / linear / path / **genuine circular motion** (the old implementation hardcoded `movetype='p'` internally, so it actually sent `movep` and discarded the via point; 0.6.0 adds the manual's `mode` argument: 0 = interpolate orientation, 1 = fixed orientation) / continuous servo / **OptiMove** (`optimovej`/`optimovel`: jerk-limited, smoother, less vibration — ⚠️ its `a`/`v` are **fractions of capability** in (0,1], not rad/s or m/s) / axis-aligned motion — the `_move_*` tools move along **base** axes, the `_move_tool_*` ones along the **current tool** axes (converted in the worker with a rotation matrix, so it does not depend on URScript `pose_trans`). **The default a/v are the manual's again** (`movej` 1.4 / 1.05, `movel` 1.2 / 0.25; the old code defaulted `movel` to v=1 m/s, four times the manual value) |
| Motion planning | `ur_motion_version` / `ur_get_freedrive_status` | Set the **Motion Version** (manual chapter 14) and the **jerk gain** (0.01-1.0, which only affects jerk-limited profiles: version-2 `movej`/`movel` and `optimovej`/`optimovel`). Version 2 clamps velocities/accelerations to the hardware limits while planning and **shrinks blend radii dynamically** instead of skipping the whole move with an "Overlapping Blends" warning as version 1 does. ⚠️ Newer robot models and PolyScope X support **only version 2**; CB3 has no such setting. ⚠️ Neither setting has a read-back channel, so the tool reports what it set. `ur_get_freedrive_status` returns how close the current pose is to a **singularity** during freedrive (0 normal / 1 near / 2 too close — **not** an on/off flag), which is what tells an operator to pick another path |
| Drawing | `ur_draw_circle` / `ur_draw_square` / `ur_draw_rectangle` / `ur_draw_star` | Draw a circle / square / rectangle / pentagram. **"Completed" is only reported after the script was actually observed running** — the old code probed immediately after sending, inevitably saw "not running", and reported success whether or not the script ever executed |
| Script / emergency | `ur_send_script` / `ur_reset_error` | Send URScript (**execution-verified**: sentinels are injected *inside the function body* / between top-level statements and read back, so "sent" never masquerades as "ran"; with several functions and no visible call site it refuses to verify and returns `verified: null`) / reset errors |

Every tool except `connect` takes an `ip` argument and requires that IP to be **connected first**.

> 📚 **0.6.0 manual alignment**: this release checked signatures, defaults, ranges and deprecated
> functions against the three official manuals bundled in `ScriptManual/` (URSoftware 3.15.4 /
> PolyScope 5 / PolyScope X); the analysis is in
> [`docs/urscript-manual-analysis.md`](./docs/urscript-manual-analysis.md). Three findings changed
> behaviour: ① `movel`/`movej` defaults are the manual's again; ② `ur_force_mode` states plainly
> that `damping`/`gain_scaling` cannot be read back; ③ `set_target_payload` is only used when an
> inertia matrix is supplied (older firmware falls back to `set_payload_mass` + `set_payload_cog`).

### Read-only 3D digital twin

The plugin also ships a **read-only 3D digital twin** of the robot, rendered with three.js: the entry is a card in the **right sidebar's Start panel**, directly below the "Workspace files / New terminal / Browser" cards, and selecting it fills the right sidebar's content area with the live 3D view. The view subscribes to the host's **SSE stream** (`/twin/stream`, one frame every 100 ms), so it stays in sync with the live robot's **joint poses, tool (TCP) coordinate frame and recent motion trajectory**. The twin is **strictly read-only — it never sends a command to the robot**: it only subscribes to the host's read-only routes and renders what it receives. A toolbar offers a reset-view control plus isometric / front / side / top presets, and the camera and base grid are framed from the model's bounding box, so a UR3 and a UR20 are both framed correctly. The numeric panel also shows the dashboard-side state (safety mode, robot mode, program state, speed scaling, joint temperatures, bus voltage/current), taken from the same route on a slower cadence.

**A stalled feed is shown, never hidden.** The twin and every motion command share one (single-threaded) worker, so while the robot is moving the twin's reads queue behind the motion: the stream then emits `stale` events and the panel says "data stopped updating Ns · retrying" instead of leaving a silently frozen arm on screen. Twin reads use a dedicated **2.5 s budget with `killOnTimeout:false`** — a read-only visualisation read must never destroy the robot session (RTDE/Dashboard) just because it was busy. After a disconnect the stream reconnects indefinitely (exponential backoff capped at 30 s) and retries immediately when the window becomes visible again or the feed has been stalled too long.

Host-side routes (all fenced to loopback callers):

| Route | Description |
|---|---|
| `GET /dsh-nonead-ur/twin/stream[?ip=<ip>]` | **SSE stream** (what the client uses by default): one full state frame every 100 ms, plus `stale` (this frame's read has not returned yet) and `frame-error` (this frame failed) events |
| `GET /dsh-nonead-ur/twin/state[?ip=<ip>][&detail=1]` | Live pose (joint angles / TCP / model). `detail=1` adds the dashboard-side state (safety mode, run state, speed scaling, joint temperatures/currents); the pose channel keeps polling independently and a failing detail query never takes it down |
| `GET /dsh-nonead-ur/twin/asset?model=<urXX>` | GLB mesh, with a content-hash `ETag` + `immutable` and `If-None-Match` → 304 support |
| `GET /dsh-nonead-ur/twin/models` | The model list actually present locally |

Failure responses carry a **machine-readable `code`** (`no_robot` / `robot_not_connected` / `ambiguous_robot` / `worker_unavailable` / `robot_error`) and echo the resolved `ip`, so the UI can say which of four very different failures happened (it used to render one "not connected" line for all of them). A read that is only **temporarily** unavailable (most often: the worker is busy executing a motion command) is *not* reported as `robot_error`: the host replays the last known reading with `stale:true` (for up to 30 s), so the twin keeps its picture and says the data is stale.

---

## Install into a DSH profile

### Option 1 — install as a bundle (manual)

1. Add the plugin as a dependency in your target profile's `package.json`:

   ```jsonc
   // C:\Users\<you>\.dsh\profiles\web\package.json
   {
     "dependencies": {
       "dsh-nonead-universal-robots": "^0.6.6"
     },
     "dsh": {
       "profile": {
         "bundles": [               // add the plugin here (later order is fine)
           "...",
           "dsh-nonead-universal-robots"
         ]
       }
     }
   }
   ```

2. Install dependencies via `dsh plugin` (equivalent to running pnpm inside the profile directory):

   ```sh
   dsh plugin --profile web install
   # or cd "$DSH_HOME/profiles/web" && pnpm install
   ```

3. Restart DSH. The plugin's `cordis.patch.yml` automatically inserts the plugin line into the config tree, and the tools appear in the model's tool list as `ur_*`.

### Option 2 — local path (development)

Add the repository path to the profile dependency (pnpm supports `file:`) to iterate in this repository:

```jsonc
"dependencies": {
  "dsh-nonead-universal-robots": "file:D:/MyProgram/GitLab/dsh-Nonead-Universal-Robots/dsh-nonead-universal-robots"
}
```

---

## Python runtime

The plugin needs a usable Python and a few dependencies (`numpy`, `paramiko`) to start the worker. Point it at an interpreter with the `pythonBin` config:

```sh
pip install -r requirements.txt
```

`pythonBin` (default `python`), `commandTimeoutMs` (motion/script timeout, default `60000`), and `connectTimeoutMs` (first-connect timeout, default `30000`) in `cordis.patch.yml` can all be overridden per deployment. If `python` is not on PATH, use an absolute path, e.g. `"C:\\Python312\\python.exe"` or `"/usr/bin/python3"`.

> ⚠️ **The dependencies must be installed for the interpreter the worker actually uses (a real trap)**
> `lib/worker.js` points `PYTHONPATH` at the plugin's `python/` directory, and CPython imports
> `sitecustomize.py` from there at startup if it exists. This repository once carried a
> **machine-local** `python/sitecustomize.py` that hardcoded a user-level `site-packages` path into
> `sys.path` — so it worked on that one machine, while on any other machine, or from a published
> install (the file is **not** in the `files` list), `import numpy` fails outright and every tool call
> dies. The correct setup is to **install the dependencies for the interpreter `pythonBin` points at**
> (or point it at a venv). `ur_ping` / `npm run test:python` is the self-check for that chain, and
> `npm run verify:host` validates tool registration through the host's real schema DSL (it should
> report 83/83).

---

## Health check / testing

Verify the plugin and Python runtime without touching a real robot:

```sh
npm run test:python   # python ur_worker.py --selfcheck: verify Python/numpy/paramiko/URBasic/RTDE config
npm test              # run all 36 test files AND every check gate (see below), then summarise
npm run test:node     # Node-side only: skips the test files *and* the gates that need Python
npm run check         # all static + cross-language gates without running the test files
npm run verify:host   # validate every tool schema through the host's real value-schema DSL, plus peer ranges
npm run verify:models # validate the structural contract of the 14 GLBs
```

`npm test` runs two kinds of thing, and both must pass:

- **36 test files** under `test/` (e2e protocol self-check, approval gate, twin routes, client
  state machine, FK, vendored-library regressions) — enumerated from `test/test-manifest.json`,
  which `check:manifest` keeps honest so a Python-using file can never be silently unlisted.
- **10 check gates**: `check-test-manifest` / `check-package-metadata` / `check-client-bundle` /
  `check-doc-tools` (Node) and `check-worker-ops` / `check-tool-params` / `check-rtde-recipe` /
  `check-approval-gate` / `check-new-ops` (Python). When the interpreter has no `numpy`, the
  Python-dependent items are reported as **SKIP with the reason**, never as a pass.

> New in 0.6.0: `scripts/pdf-extract2.py` extracts text from `ScriptManual/*.pdf` into
> `ScriptManual/txt/*.txt` using **only the standard library** (the PolyScope manuals encode
> glyph ids, so the text only comes out through each font's `ToUnicode` CMap). It is the
> reproducible source behind every signature, default and range quoted in this release — when in
> doubt, re-extract and read the manual.

> `check-client-bundle.mjs` rebuilds `src/client/**` into a scratch file and compares the result
> with the committed `lib/client.js` byte for byte, so a stale bundle (source changed UI, shipped
> artifact did not) fails the build instead of silently shipping. It never overwrites the
> committed artifact; `scripts/build-client.mjs` honours `BUILD_CLIENT_OUT` for that reason.

`npm test` prints a per-file summary and exits non-zero if anything failed. If `python` is not on PATH, set it via the environment:

```sh
UR_PYTHON=C:\\Python312\\python.exe npm test
```

> Before 0.5.0 `npm test` ran **one worker ping** and none of the other 20-plus `*.test.mjs` files —
> so a green `npm test` said nothing about the plugin. `scripts/run-tests.mjs` now enumerates and runs
> them all, plus every check gate, and summarises the result.

Run the **host compatibility check** before a release and whenever the DSH runtime is upgraded — it validates the plugin against an installed host instead of a copy of its keyword list:

```sh
npm run verify:host                                # auto-discovers a real DSH installation
node scripts/check-host-compat.mjs <node_modules>  # or an explicit host
```

It checks the peer ranges against the installed versions, compiles **every** tool parameter schema with the host's real value-schema DSL (a rejected schema silently drops that tool), drives the host route registration, and validates the `dsh.client` declaration plus the client bundle's `__ModuleLoader__` id. Exit code `0` means this plugin works with that host. Against DSH 0.1.7-rc.2 it reports **83/83 tools registered**.

> The first `ur_connect` to a robot has an ~20s RTDE readiness wait; on timeout it returns a clear error rather than hanging.

---

## How it works

```
DSH model        @deepseek-ai/dsh-tools        python/ur_worker.py          UR robot
  │  ur_movej(...)  │                              │                          │
  ├────────────────►  ctx.tools.register(defineTool)                        │
  │                  │  lib/worker.js               │                          │
  │                  ├── spawn(ur_worker.py) ──────►│  import URBasic          │
  │                  │   {id,op,params} ───────────►│  RTDE+Dashboard+RTC      │
  │                  │  ◄── {message,data} ─────────┤  run each op             │
  │  ◄── text ───────┤                              │                          │
```

- **`python/ur_worker.py`** — a persistent stdio JSON worker. It keeps `ROBOTS` / `ROBOT_MODELS` dicts, connects by IP, and runs one command per call. Motion commands use (bounded) "arrival confirmation" polling and return a structured error on failure.
- **`lib/worker.js`** — lazily starts the worker once and keeps it alive, matching line-delimited JSON requests/responses, with timeout and cancel (forwards `exec.signal`).
- **`lib/index.js`** — the Cordis plugin that imports `defineTool` to register the above as tools; `inject: ['tools']`.

---

## Tool naming & examples

Tool names are stable as `ur_*`. Example prompts:

> Connect to 192.168.1.199 and read the current TCP pose.

```
ur_connect(ip="192.168.1.199")
ur_get_tcp_pose(ip="192.168.1.199")
```

> Lower the TCP of 192.168.1.199 by 20mm along the Z axis.

```
ur_get_tcp_pose(ip="192.168.1.199")
ur_move_z(ip="192.168.1.199", distance=-0.02)
```

> Draw a circle of radius 50mm (vertical plane).

```
ur_draw_circle(ip="192.168.1.199", center=[0.3,-0.2,0.4,0,3.14,0], r=0.05)
```

---

## Reference implementation

- Plugin repository: <https://github.com/NoneadChina/dsh-nonead-universal-robots>

This plugin shares the same ancestry as Nonead's [`Nonead-Universal-Robots-MCP`](https://gitee.com/nonead/Nonead-Universal-Robots-MCP) (GitHub: <https://github.com/nonead/Nonead-Universal-Robots-MCP>), reusing its `URBasic` library and robot-control logic, re-encapsulated by the same team for DeepSeek Harness as this plugin's `ur_*` tools and stdio worker protocol. `URBasic` is MIT (© Tony Ke & Anthony Zhuang / Universal Robots, 2009-2025).

---

## Notes / limitations

- **Connection persistence** — the worker process lives for the plugin's lifetime and keeps robot connections by IP; after a worker crash or a DSH restart you must `connect` again.
- **Remote control mode** — some UR robots must be in "remote control" before they execute motion/program commands, and `ur_connect` reports that state. **CB3 robots running URSoftware 3.1 through 3.20 already allow remote control by default (nothing to enable at the settings level)**; a `remote_control: false` reading still means the controller is *currently* not in remote mode — in local/teach-pendant mode URScript and motion commands are silently discarded, so switch the pendant to remote control. Other firmware (e-Series, or CB3 outside that range) needs Remote Control enabled in PolyScope first. `ur_status` also reports `remote_control_raw`, and an unreadable state is reported as unknown rather than pretended to be `false`.
- **Tool digital I/O** — `ur_get_digital_in` / `ur_set_digital_out` with `which="tool"` control the tool-flange digital I/O. Tool digital signals are **not carried by RTDE**, so reading a tool input runs a short URScript program (via `SendProgram`) that may **interrupt a running program**; writing a tool output sends the URScript `write_tool_digital_out` command. Tool digital **output read-back is not supported** (no reliable `read_tool_digital_out` expression).
- **Joint current** — the current RTDE recipe does not expose per-joint current directly, so `ur_get_joint_current` is not provided (the reference implementation's version of this tool has a value bug; this implementation does not carry it over).
- **Threading / cancel** — motion commands poll until arrival within `commandTimeoutMs`; for long trajectories, remind the model in the prompt to set a reasonable timeout or split the motion into steps.
- **Not a safety boundary** — this plugin is on par with the `bash` tool and can drive physical equipment; test thoroughly on a real robot before production use.
- **Package size** — the published package is about **21 MB**, almost entirely the **14 `assets/models/*.glb`** meshes; the plugin's own code adds only a few hundred KB. The meshes are down from the converter's raw 35.11 MB in two reproducible steps (`node scripts/compress-models.mjs`, plus `npm run analyze:models` to see where the bytes go): a **lossless** pass to 28.27 MB (`uint32` → `uint16` indices — the largest index in these models is only 24228 — plus dropping the non-standard `_color` attribute no material reads; vertex positions, UVs, textures and the index sequence stay byte-for-byte/value-for-value identical, and the script proves it before writing), then a **lossy, explicitly decided** pass to 20.86 MB that box-filters the **eight** 2048×2048 base-colour PNGs embedded by the five newer models (ur15 ×1, ur18 ×2, ur20 ×1, ur30 ×2, ur8long ×2) down to 1024×1024 (`--texture-size 1024`). The twin panel is only a few hundred pixels wide, and a same-region 1:1 comparison shows no visible difference. Geometry precision is untouched (Ruling 24); `test/model-contract.test.mjs` guards the resulting size band. To drop whole models instead, regenerate a subset with `python scripts/convert-meshes.py --only <model…>`.
- **Unknown models fall back** — a robot whose model has no bundled mesh (unknown or customized model string) is rendered with **approximate geometry instead of failing**; the twin never errors out on an unknown model.
- **Asset pipeline** — the meshes are generated by `python scripts/convert-meshes.py` and their structure contract (7 named nodes per GLB, embedded textures) is validated by `python scripts/verify-models.py` (also exposed as `npm run verify:models`).

---

## Third-party assets & licensing

Beyond its own code, this package distributes 14 robot meshes under `assets/models/*.glb` (≈21 MB) plus `assets/kinematics.json`, all derived from Universal Robots' [`Universal_Robots_ROS2_Description`](https://github.com/UniversalRobots/Universal_Robots_ROS2_Description) (branch `humble`, fetched 2026-09-21).

Two licence regimes apply, split by model, and they are never mixed within a model:

- **BSD-3-Clause** (9 models): `ur3`, `ur5`, `ur10`, `ur3e`, `ur5e`, `ur7e`, `ur10e`, `ur12e`, `ur16e` — this covers the meshes and the kinematic / joint-limit configuration that `assets/kinematics.json` is derived from.
- **UR "Graphical Documentation" terms** (5 models): `ur8long`, `ur15`, `ur18`, `ur20`, `ur30`. These meshes are **not** BSD-3-Clause; they are UR "Graphical Documentation" and their use is governed by UR's *Terms and Conditions for use of Graphical Documentation*, which is not an OSI open-source licence but does allow use, modification and sharing under certain restrictions. Questions: <legal@universal-robots.com>.

The client-side 3D renderer builds on [three.js](https://threejs.org/) (MIT); [esbuild](https://esbuild.github.io/) (MIT) is used only at build time.

See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for the per-model derivation list, the conversion parameters and the licence texts.

---

## License

This project adopts a **User-Segmented Dual Licensing** model:

- **AGPLv3** for individual users and organizations with **≤10 people** (open source; see <https://www.gnu.org/licenses/agpl-3.0.html>).
- **Commercial license (required)** for organizations with **>10 people**, or for anyone who needs to avoid the AGPLv3 source-disclosure obligation (e.g. SaaS / closed distribution).

See [LICENSE](./LICENSE) for the full agreement. For a commercial license, contact [service@nonead.com](mailto:service@nonead.com).

`python/URBasic` (vendored) remains under its own **MIT License** (© Anthony Zhuang / Universal Robots, 2009-2025).

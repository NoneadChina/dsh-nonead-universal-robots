# dsh-nonead-universal-robots

**A DeepSeek Harness (DSH) plugin that lets you control Universal Robots (UR) collaborative arms directly from natural language, developed by Suzhou Nonead Robot Technology Co., Ltd. based on the same logic as the company's own nUR MCP Server.** ([Suzhou Nonead Robot Technology Co., Ltd.](https://www.nonead.com))

The plugin starts a persistent Python worker (which internally reuses the vendored `URBasic` library) and exposes robot control as **native DSH tools**: the tools talk to the robot through that worker, so after a single `connect` you can keep issuing commands to the same IP. Repository: <https://github.com/NoneadChina/dsh-nonead-universal-robots>

> ⚠️ **Safety notice**: this plugin drives a real robotic arm directly. Always keep the robot in sight, keep the emergency stop within reach, and keep the workspace clear of people and obstacles. Treat it with the same care as granting a model the `bash` tool. You (or the model) bear full responsibility for any motion command.

> 🛡️ **Motion approval gate**: the **48** commands that physically move the arm, run a program, take the arm out of program control, remove its rigidity, **overwrite/delete a program stored on the robot**, or **drive a fieldbus device over Modbus** pause and wait for human confirmation before being sent to the robot:
>
> | Group | Tools |
> |---|---|
> | Motion | `ur_movej` `ur_movel` `ur_movep` `ur_movec` `ur_servoj` `ur_move_optimized` `ur_move_x` `ur_move_y` `ur_move_z` `ur_move_tool_x` `ur_move_tool_y` `ur_move_tool_z` |
> | Drawing | `ur_draw_circle` `ur_draw_square` `ur_draw_rectangle` `ur_draw_star` |
> | Programs & scripts | `ur_load_program` `ur_run_program` `ur_send_script` `ur_reset_error` |
> | Control mode / power / safety | `ur_set_freedrive` `ur_set_teach_mode` `ur_power_on` `ur_power_off` `ur_brake_release` `ur_unlock_protective_stop` `ur_shutdown` |
> | Force & velocity | `ur_force_mode` `ur_end_force_mode` `ur_force_mode_settings` `ur_speedj` `ur_speedl` `ur_stopj` `ur_stopl` |
> | Program storage | `ur_upload_program` `ur_delete_program` |
> | Physical state changes | `ur_set_payload` `ur_set_payload_inertia` `ur_set_gravity` `ur_zero_ftsensor` `ur_motion_version` `ur_set_speed_scaling` `ur_set_conveyor_tracking` |
> | Modbus writes | `ur_modbus_add_signal` `ur_modbus_delete_signal` `ur_modbus_send_custom_command` `ur_modbus_set_output_register` `ur_modbus_set_output_signal` |
>
> In an interactive deployment (approval policy `ask`) a confirmation dialog appears in the UI. A call made without an approval service, without an agent, or answered with anything other than `allowed-once` **fails closed** — the command is rejected and never reaches the robot. The default lives in code (`config.requireApprovalForMotion ?? true`), so it cannot be turned off by a caller that skips schema parsing; set `requireApprovalForMotion: false` to disable the gate deliberately. `test/approval-gate.test.mjs` drives the real tool registry and proves all of the above, including that an extra `op` argument cannot re-route a call.

> 🧭 **Pre-flight safety gate**: a second layer that caps what a *single* command may ask for, independent of the approval gate. Limits: `safetyMaxStepM` (0.5 m, axis moves), `safetyMaxLinearSpeed` (0.5 m/s), `safetyMaxJointSpeed` (1.05 rad/s), `safetyMaxDurationS` (60 s), `safetyMaxForceN` / `safetyMaxTorqueNm` (40 N / 10 N·m, force mode), plus an optional `safetyWorkspace` box (`"x:-1,1 y:-1,1 z:0,1.2"`) checked against explicit Cartesian targets. It runs **before** the approval prompt — an impossible request should not bother a human — and is **decoupled** from it: `requireApprovalForMotion: false` turns off the human confirmation only, never these physical caps; that requires `safetyGate: false`. A malformed `safetyWorkspace` **fails closed** (every motion op is refused) instead of being silently ignored. It is a guard against typos and unit mistakes, **not** a safety boundary (the controller's own safety configuration still is), and it deliberately does not cover `ur_send_script`, which is arbitrary URScript this gate does not parse.
>
> 📝 **Motion audit ledger**: every gated command appends one NDJSON line (`<DSH_HOME>/nonead-ur/audit.ndjson` by default; `auditLogPath` to move it, `auditLog: false` to disable, `auditLogAll: true` to also record unchecked reads) as `{ts, ip, op, tool_name, args, decision, reason}` with `decision ∈ {approved, denied, blocked, unchecked}` — so "what did the model actually do to the robot" is answerable after the fact. Writing to it never affects the robot path: an audit failure is reported, never thrown.

---

## Feature overview

**99** tools (`ur_*`) in total.

| Category | Tool(s) (`ur_*`) | Description |
|---|---|---|
| Connection | `ur_connect` / `ur_disconnect` | Connect / disconnect a UR robot by IP |
| Status | `ur_get_status` | One-shot read of TCP, joints, model, serial, version, safety mode, run/program state, voltage, current, temperatures, uptime, joint currents/voltages/speeds, TCP speed and wrench, speed scaling, plus `rtde_resync_bytes` (how many bytes the RTDE receiver had to drop to re-synchronise; `0` means a clean stream) |
| Pose | `ur_get_tcp_pose` / `ur_get_joint_pose` | Read current TCP pose / joint angles |
| Targets | `ur_get_target_values` / `ur_check_pose` | Read **where the controller is taking the arm**: target joint positions/velocities/accelerations and target TCP pose/speed, plus the matching actual values for comparison. Comes from the RTDE `target_*` fields, so it is free — and it is the only direct evidence for "command sent but not executed yet / being blended / held back by the safety limit". `ur_check_pose` answers the question worth asking *before* moving: is this TCP pose inside the controller's **safety limits**, and does **inverse kinematics** solve (is it reachable)? A read-only pre-check: the controller runs `is_within_safety_limits` + `get_inverse_kin` and the answers come back through output registers behind start/finish sentinels, so "the controller never ran it" is reported rather than guessed |
| Device info | `ur_get_robot_model` / `ur_get_serial_number` / `ur_get_uptime` / `ur_get_software_version` / `ur_get_safety_mode` / `ur_get_safety_status` / `ur_get_robot_mode` | Model (with a `remote_control` field) / serial / uptime / software version / safety mode / **safety and robot status bits** (which safety function fired, incl. violation / fault; the numeric limits themselves are not exposed by RTDE or the dashboard and must be read from PolyScope's Safety page) / run state |
| Programs | `ur_get_program_state` / `ur_load_program` / `ur_run_program` / `ur_stop_program` / `ur_pause_program` / `ur_list_programs` / `ur_upload_program` / `ur_download_program` / `ur_delete_program` | Program state, load, run, stop, pause, SSH listing, and **program file transfer over SFTP**. The three transfer tools each **verify what they did** instead of trusting that a transfer was requested: upload reads the remote size back, download reads the local size back, and delete confirms the file is really gone; a download never silently overwrites (an existing target is renamed to `<path>.bak` first, and a failed backup refuses the download). Their local paths are fenced to `programDir` — see "Local file access" below. `ur_list_programs` scans the real robot's `/programs` or the URSim `~/URSim_Linux-*/programs.*` layout (override with `programs_dir`); it reports `used_default_password` when no password was given and the `host_key_policy` in force, and an optional `known_hosts` file switches SSH to **strict `RejectPolicy` host-key verification** (a missing file is an error, never a silent fallback). Run/stop/pause check the controller's reply and report the run state |
| Operator messaging | `ur_popup` / `ur_close_popup` / `ur_add_log` | Talk to the person standing at the robot: show a **modal** popup on the teach pendant, close it, and write one line into the **controller's own log history**. None of them moves the arm, so none is behind the approval gate; the text is injection-checked (dashboard parses its commands line by line, so a newline would inject another command) and capped at 300 characters. Note that `ur_add_log` leaves a permanent trace on the controller — that is the point of it, so do not write secrets there |
| Modbus | `ur_modbus_add_signal` / `ur_modbus_delete_signal` / `ur_modbus_get_signal_status` / `ur_modbus_send_custom_command` / `ur_modbus_set_output_register` / `ur_modbus_set_output_signal` / `ur_modbus_set_runstate_dependent_choice` / `ur_modbus_set_signal_update_frequency` | Fieldbus I/O: add/delete the signals the controller supervises, read one back, set output registers and digital outputs, send a raw Modbus command, and tune a signal's run-state behaviour and refresh rate. ⚠️ The vendored `urScript.py`'s eight `modbus_*` methods are **stubs** (`raise NotImplementedError`), so these build the URScript themselves. ⚠️ Modbus writes get **no response** — all these tools can prove is that the URScript *ran on the controller* (start/finish sentinels), never that the PLC acted, so every reply carries `fieldbus_confirmed: false`; only `ur_modbus_get_signal_status` reads a value back (through an output register, behind its own sentinels). Signal names are whitelist-checked — they are interpolated into a URScript string literal, so a quote or a newline would inject script — and a read must declare `kind` because URScript is strongly typed (a digital signal returns a bool, a register an int, and one script cannot safely write both). The five write-side tools are behind the approval gate; the read and the two signal-configuration tools are not |
| Registers | `ur_get_int_register` / `ur_get_double_register` / `ur_get_bit_register` | Read Int / Double / Bool registers |
| Health | `ur_ping` | Check worker / Python / URBasic readiness without a robot |
| I/O | `ur_get_digital_in` / `ur_set_digital_out` / `ur_get_digital_in_bits` / `ur_get_digital_out_bits` / `ur_get_analog_in` / `ur_set_analog_out` / `ur_get_tool_analog_in` | Digital in/out (incl. bit-mask reads, and `which="tool"` for the tool-flange I/O) and standard analog in/out (**in engineering units**: URScript's `set_analog_out` takes a relative level [0,1], and `full_scale` may be set to 20 for a current-domain port). Reading a tool digital input is **sentinel-verified** — if the controller never reports the script finished, the tool refuses to give a number instead of reporting one it cannot vouch for |
| Tool config | `ur_set_tool_voltage` / `ur_set_tcp` / `ur_set_payload` / `ur_set_payload_inertia` / `ur_set_gravity` / `ur_zero_ftsensor` / `ur_set_tool_output_mode` / `ur_set_tool_communication` | Tool voltage (0/12/24 V), TCP, payload mass / centre of gravity, **mass + CoG + inertia matrix in one call** (`set_target_payload`, PolyScope 5.10+; unlike `set_payload` it does not reset the inertia matrix and leave the three parameters inconsistent), gravity direction (for non-horizontal mounting), force/torque sensor zeroing, **tool output mode** (normal / power dual-pin), **tool serial port** (TCI/RS-485 — ⚠️ enabling it disables the tool analog inputs). ⚠️ These are settings with **no read-back channel**: a successful reply says 「已下发（未校验）」 and carries `verified: false`, because all the plugin can prove is that the script reached the controller — UR accepts URScript only in remote-control mode and silently discards it otherwise |
| Control mode / power / safety | `ur_set_freedrive` / `ur_set_teach_mode` / `ur_power_on` / `ur_power_off` / `ur_brake_release` / `ur_unlock_protective_stop` / `ur_shutdown` | Freedrive / teach mode (move the arm by hand), power on / off / **brake release** (⚠️ the arm may fall under gravity), **protective-stop unlock only** (no power-on and no brake release — that is what distinguishes it from `ur_reset_error`), controller shutdown |
| Force control | `ur_force_mode` / `ur_end_force_mode` / `ur_force_mode_settings` | **Force Mode**: the arm becomes compliant along/about the selected axes and keeps applying the requested force/torque. Arguments match the manual one by one — `task_frame` / `selection_vector` (1 = compliant) / `wrench` / `type` (1–3) / `limits` (compliant axes = max TCP speed, stiff axes = max deviation) / `damping` / `gain_scaling`. The script inserts the manual's recommended `sleep(0.02)` before entering force mode; exit with `ur_end_force_mode`. ⚠️ `damping`/`gain_scaling` cannot be read back from the controller, so the tool reports what it set instead of pretending to read the current value |
| Velocity control | `ur_speedj` / `ur_speedl` / `ur_stopj` / `ur_stopl` / `ur_wait_steady` | Joint/TCP **velocity commands** (`speedj` / `speedl`) and the matching decelerations (`stopj` / `stopl`). ⚠️ Velocity commands are **open-ended**: with `t=0` (the default) the function returns once the target speed is reached while the arm **keeps moving** — always finish with a `stop*` or `ur_wait_steady`. `ur_wait_steady` polls the RTDE speed fields rather than using URScript's `is_steady()` (which is documented to return false in force/teach mode) |
| Live telemetry | `ur_get_runtime_telemetry` / `ur_get_robot_voltage` / `ur_get_robot_current` / `ur_get_joint_temperatures` / `ur_get_speed_scaling` / `ur_get_tcp_force` / `ur_get_tool_telemetry` | Joint currents/voltages/speeds, TCP speed and wrench, tool accelerometer, speed scaling, robot voltage/current, joint temperatures, tool current/voltage, I/O current. **These fields are already in the 500 Hz RTDE stream**, so reading them is free and needs no reconfiguration. Single-value reads and the one-shot `ur_get_runtime_telemetry` summary coexist: poll a single value when that is all you need, use the summary for diagnosis |
| Conveyor | `ur_get_conveyor` / `ur_set_conveyor_tick` / `ur_set_conveyor_tracking` | Conveyor tick read / set, and starting or stopping **linear or circular tracking**. `ur_get_conveyor` self-verifies the script it depends on: the tick is only reported after the controller was observed finishing it. ⚠️ `ur_set_conveyor_tracking` is **not hardware-verified** — its signature and units follow the official manual, but tracking behaviour needs a real encoder-equipped conveyor to confirm; try it on URSim first |
| Motion | `ur_movej` / `ur_movel` / `ur_movep` / `ur_movec` / `ur_servoj` / `ur_move_optimized` / `ur_move_x` / `ur_move_y` / `ur_move_z` / `ur_move_tool_x` / `ur_move_tool_y` / `ur_move_tool_z` | Joint-space / linear / path / **circular** motion (`mode` 0 interpolates orientation, `mode` 1 keeps it fixed) / continuous servo / **OptiMove** (`optimovej`/`optimovel`: jerk-limited, smoother, less vibration — ⚠️ its `a`/`v` are **fractions of capability** in (0,1], not rad/s or m/s) / axis-aligned motion: the `_move_*` tools move along **base** axes and the `_move_tool_*` ones along the **current tool** axes (converted in the worker with a rotation matrix, so they do not depend on URScript `pose_trans`). Defaults are the manual's (`movej` 1.4 / 1.05, `movel` 1.2 / 0.25); with `t > 0` the duration takes precedence over `a`/`v` |
| Motion planning | `ur_motion_version` / `ur_set_speed_scaling` / `ur_get_freedrive_status` | Set the **Motion Version** (manual chapter 14) and the **jerk gain** (0.01–1.0, which only affects jerk-limited profiles: version-2 `movej`/`movel` and `optimovej`/`optimovel`). Version 2 clamps velocities/accelerations to the hardware limits while planning and **shrinks blend radii dynamically** instead of skipping the whole move with an "Overlapping Blends" warning. ⚠️ Newer robot models and PolyScope X support **only version 2**; CB3 has no such setting. ⚠️ Neither setting has a read-back channel. `ur_set_speed_scaling` sets the **speed slider** (`set_speed_slider`: 0 = stopped, 1 = full speed) — the most direct way to slow everything down before handing over a delicate motion. Unlike the other settings it **does** have a read-back channel (`target_speed_fraction`), so it reports `verified: true` only when the read-back matches, and `hardware_verified: false` because that mapping has never been confirmed on a real robot. `ur_get_freedrive_status` returns how close the current pose is to a **singularity** during freedrive (0 normal / 1 near / 2 too close — **not** an on/off flag), which is what tells an operator to pick another path |
| Drawing | `ur_draw_circle` / `ur_draw_square` / `ur_draw_rectangle` / `ur_draw_star` | Draw a circle / square / rectangle / pentagram. "Completed" is only reported after the script was actually observed running |
| Script / emergency | `ur_send_script` / `ur_reset_error` | Send URScript (**execution-verified**: sentinels are injected inside the function body / between top-level statements and read back, so "sent" never masquerades as "ran"; with several functions and no visible call site it refuses to verify and returns `verified: null`) / reset errors |

Every tool except `connect` takes an `ip` argument and requires that IP to be **connected first**.

---

## Read-only 3D digital twin

The plugin also ships a **read-only 3D digital twin** of the robot, rendered with three.js: the entry is a card in the **right sidebar's Start panel**, directly below the "Workspace files / New terminal / Browser" cards, and selecting it fills the right sidebar's content area with the live 3D view. The view subscribes to the host's **SSE stream** (`/twin/stream`, one frame every 100 ms) and stays in sync with the live robot's **joint poses, tool (TCP) coordinate frame and recent motion trajectory**. The twin is **strictly read-only — it never sends a command to the robot**: it only subscribes to the host's read-only routes and renders what it receives. A toolbar offers a reset-view control plus isometric / front / side / top presets, and the camera and base grid are framed from the model's bounding box, so a UR3 and a UR20 are both framed correctly. The numeric panel also shows the dashboard-side state (safety mode, robot mode, program state, speed scaling, joint temperatures, bus voltage/current), taken from the same route on a slower cadence.

The feed does not stall while the robot moves: telemetry is **pushed by the worker** at 20 Hz, and every twin frame reads that push cache first — **without touching the single-threaded command queue**, which is what a running motion confirmation loop occupies. On the wire a push is simply a JSON line without `id`, so an older host treats it as an unmatched response and nothing breaks. Only when the cache is stale (>300 ms) or missing does the twin fall back to an explicit read, and twin reads still use a dedicated **2.5 s budget with `killOnTimeout:false`** — a read-only visualisation read must never destroy the robot session (RTDE/Dashboard) just because it was busy. If a stall does happen, the stream emits `stale` events and the panel says "data stopped updating Ns · retrying" rather than leaving a silently frozen arm on screen. After a disconnect the stream reconnects indefinitely (exponential backoff capped at 30 s) and retries immediately when the window becomes visible again or the feed has been stalled too long. Set `DSH_UR_TWIN_PUSH=0` to turn the push channel off for comparison.

It follows the desktop app's colour theme: the panel's DOM half is coloured with the host's design tokens (`--dsw-alias-*`), so the toolbar, HUD and status line flip automatically with whatever theme is selected under Settings → Appearance (and with third-party themes) — **no JS needed**. The base grid lines and the fallback arm's material colour inside the WebGL canvas are repainted on a theme change by `src/client/theme.js`, which watches `body[data-ds-dark-theme]` (CSS cannot reach values inside WebGL). Theme detection only trusts that attribute and never falls back to the system preference.

Host-side routes (all fenced to loopback callers):

| Route | Description |
|---|---|
| `GET /dsh-nonead-ur/twin/stream[?ip=<ip>]` | **SSE stream** (what the client uses by default): one full state frame every 100 ms, plus `stale` (this frame's read has not returned yet) and `frame-error` (this frame failed) events |
| `GET /dsh-nonead-ur/twin/state[?ip=<ip>][&detail=1]` | Live pose (joint angles / TCP / model). `detail=1` adds the dashboard-side state (safety mode, run state, speed scaling, joint temperatures/currents); the pose channel keeps polling independently and a failing detail query never takes it down |
| `GET /dsh-nonead-ur/twin/asset?model=<urXX>` | GLB mesh, with a content-hash `ETag` + `immutable` and `If-None-Match` → 304 support |
| `GET /dsh-nonead-ur/twin/models` | The model list actually present locally |

Failure responses carry a **machine-readable `code`** (`no_robot` / `robot_not_connected` / `ambiguous_robot` / `worker_unavailable` / `robot_error`) and echo the resolved `ip`, so the UI can say which of four very different failures happened. A read that is only **temporarily** unavailable (most often because the worker is busy executing a motion command) is not reported as `robot_error`: the host replays the last known reading with `stale:true` (for up to 30 s), so the twin keeps its picture and says the data is stale. A replayed frame never carries approval state — `pending_motion` is re-read live, so a finished approval cannot keep being drawn as a ghost target.

---

## Install into a DSH profile

> 📦 **Not published to npm (yet)**, so there is no version range to write into `dependencies`. Install from the plugin market / plugin page or from this repository (a local checkout or its GitHub URL).

### Option 1 — plugin market / plugin page (GUI)

The plugin is listed in the DSH plugin market as `dsh-nonead-universal-robots`. Open **Settings → Plugin market** (or the sidebar **Plugins** page), find it and install.

Two things to know:

- The market refuses to install **while an agent is running** ("installing changes plugin files, so a working agent can fail mid-turn"). Finish or cancel the running turn first.
- The market installs from the entry's GitHub URL, and pnpm fetches `github:` sources as a tarball from `codeload.github.com`. On a slow or filtered network that download can time out; the CLI route below avoids it entirely.

### Option 2 — CLI, from a local checkout (recommended for development)

```sh
# DSH Desktop ships a CLI wrapper per profile:
#   %APPDATA%\<app>\host-commands\<profile>\generations\<hash>\bin\dsh.cmd
dsh.cmd plugin add "file:D:/path/to/dsh-nonead-universal-robots"
# (the wrapper adds --profile <profile> itself; on other setups use `dsh plugin --profile <profile> add <spec>`)
```

This is the same path the plugin page uses: it writes the dependency **and** the `dsh.profile.bundles` entry, and the plugin is hot-loaded into running sessions (no restart needed — the `ur_*` tools appear immediately).

⚠️ A `file:` install is a **copy**, not a symlink: **editing the checkout does not affect the installed plugin** — re-run the command after changing the source.

### Option 3 — as a bundle, by hand

1. Add the plugin to your target profile's `package.json`:

   ```jsonc
   // <DSH_HOME>/profiles/<profile>/package.json
   {
     "dependencies": {
       "dsh-nonead-universal-robots": "file:D:/path/to/dsh-nonead-universal-robots"
       // or, once GitHub is reachable: "github:NoneadChina/dsh-nonead-universal-robots"
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
   dsh plugin --profile <profile> install
   # or: cd "$DSH_HOME/profiles/<profile>" && pnpm install
   ```

3. Restart DSH. The plugin's `cordis.patch.yml` inserts the plugin line into the config tree, and the tools appear in the model's tool list as `ur_*`.

---

## Python runtime

The plugin needs a usable Python with `numpy` and `paramiko` to start the worker:

```sh
pip install -r requirements.txt
```

> ⚠️ **Install those dependencies for the interpreter the worker actually uses.** `lib/worker.js`
> points `PYTHONPATH` at the plugin's `python/` directory, and CPython imports `sitecustomize.py`
> from there at startup if it exists — so a machine-local `sitecustomize.py` that pokes a user-level
> `site-packages` into `sys.path` "works" on one machine and fails everywhere else. Point `pythonBin`
> at an interpreter (or a venv) that has the dependencies.

`pythonBin` (default `python`), `commandTimeoutMs` (motion/script timeout, default `60000`) and `connectTimeoutMs` (first-connect timeout, default `30000`) are configurable in `cordis.patch.yml`. If `python` is not on PATH, use an absolute path, e.g. `"C:\\Python312\\python.exe"` or `"/usr/bin/python3"`. `ur_ping` / `npm run test:python` is the self-check for this chain.

---

## Health check / testing

Verify the plugin and Python runtime without touching a real robot:

```sh
npm run test:python   # python ur_worker.py --selfcheck: verify Python/numpy/paramiko/URBasic/RTDE config
npm test              # 51 items: all 37 test files + 9 gates + 5 offline probes, then a summary
npm run test:node     # Node side only: skip the test files *and* the gates that need Python
npm run check         # all static + cross-language gates without running the test files
npm run verify:host   # validate every tool schema through the host's real value-schema DSL, plus peer ranges
npm run verify:models # validate the structural contract of the 14 GLBs
```

`npm test` runs two kinds of thing, and both must pass:

- **37 test files** under `test/` (end-to-end protocol self-check, approval gate, twin routes, client state machine, FK, vendored-library regressions) — enumerated from `test/test-manifest.json`, which `check:manifest` keeps honest so a Python-using file can never be silently unlisted.
- **9 check gates** plus **5 offline probes**: `check-test-manifest` / `check-package-metadata` / `check-client-bundle` / `check-doc-tools` (Node) and `check-worker-ops` / `check-tool-params` / `check-rtde-recipe` / `check-approval-gate` / `check-new-ops` (Python), then the `scripts/probe-*.mjs` twin/SSE probes.

**Skipped is not green.** A run with any skipped item exits non-zero — the only way to accept skips is to ask for them explicitly (`--allow-skip`, or `--skip-python` for the Node-only run), and a run in which *everything* was skipped always fails. Two probes need a global `EventSource` and run with `--experimental-eventsource` (Node ≥22.3); between that and `module.registerHooks` (Node ≥22.15) the real development floor is recorded in `devEngines`.

`npm test` prints a per-item summary. If `python` is not on PATH, set it via the environment:

```sh
UR_PYTHON=C:\\Python312\\python.exe npm test
```

Run the **host compatibility check** before a release and whenever the DSH runtime is upgraded — it validates the plugin against an installed host instead of a copy of its keyword list:

```sh
npm run verify:host                                # strict: exits 2 when no installed host is found
npm run check:host                                 # same check, but a missing host is a loud SKIP
node scripts/check-host-compat.mjs <node_modules>  # or an explicit host
```

It checks the peer ranges against the installed versions, compiles **every** tool parameter schema with the host's real value-schema DSL (a rejected schema silently drops that tool), drives the host route registration, and validates the `dsh.client` declaration plus the client bundle's `__ModuleLoader__` id. Exit code `0` means this plugin works with that host, and it reports how many tools registered out of how many were declared (e.g. `83/83`).

> The first `ur_connect` to a robot has an ~20 s RTDE readiness wait; on timeout it returns a clear error rather than hanging.

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

> Lower the TCP of 192.168.1.199 by 20 mm along the Z axis.

```
ur_get_tcp_pose(ip="192.168.1.199")
ur_move_z(ip="192.168.1.199", distance=-0.02)
```

> Draw a circle of radius 50 mm (vertical plane).

```
ur_draw_circle(ip="192.168.1.199", center=[0.3,-0.2,0.4,0,3.14,0], r=0.05)
```

---

## Notes / limitations

- **Connection persistence** — the worker process lives for the plugin's lifetime and keeps robot connections by IP; after a worker crash or a DSH restart you must `connect` again.
- **Remote control mode** — some UR robots must be in "remote control" before they execute motion/program commands, and `ur_connect` reports that state. **CB3 robots running URSoftware 3.1 through 3.20 already allow remote control by default**; a `remote_control: false` reading still means the controller is *currently* not in remote mode — in local/teach-pendant mode URScript and motion commands are silently discarded, so switch the pendant to remote control. Other firmware (e-Series, or CB3 outside that range) needs Remote Control enabled in PolyScope first. An unreadable state is reported as unknown rather than pretended to be `false`.
- **Reads you cannot trust are reported as such** — a state-setting command that has no read-back channel answers `verified: false`; a controller that refuses the RTDE session is reported as not running instead of "connected"; a twin frame that could not be refreshed is flagged `stale`.
- **Local file access** — `ur_upload_program` **reads** a local file and `ur_download_program` **writes** one, so both are fenced to `programDir` (`<DSH_HOME>/nonead-ur/programs` by default; change it with the `programDir` config). A path must resolve — after `realpath`, so a symlink cannot smuggle it out — inside that directory, only `.urp` files are transferred, and `maxProgramBytes` (1 MiB) caps the size. **An unconfigured or non-existent `programDir` fails closed**: nothing local is read or written. This is the same class of exposure as handing the model a shell, which is exactly why it is fenced rather than trusted.
- **Program transfer is not "fire and forget"** — upload and download compare the byte count on the other side, and delete re-`stat`s the path afterwards. A mismatch is reported as a failure (`VERIFY_FAILED`), never as a success, because the caller's next step would be to run that program.
- **Tool digital I/O** — `ur_get_digital_in` / `ur_set_digital_out` with `which="tool"` control the tool-flange digital I/O. Tool digital signals are **not carried by RTDE**, so reading a tool input runs a short URScript program that may **interrupt a running program**. Tool digital **output read-back is not supported** (there is no reliable `read_tool_digital_out` expression).
- **Joint current** — the receive recipe does carry `actual_current`, and `ur_get_runtime_telemetry` reports it as `joint_currents`; what is missing is a *dedicated* `ur_get_joint_current` tool, not the value itself.
- **Threading / cancel** — motion commands poll until arrival within `commandTimeoutMs`; for long trajectories, tell the model to set a reasonable timeout or split the motion into steps.
- **Not a safety boundary** — this plugin is on par with the `bash` tool and can drive physical equipment; test thoroughly on a real robot before production use.
- **Unknown models fall back** — a robot whose model has no bundled mesh is rendered with approximate geometry instead of failing; the twin never errors out on an unknown model.
- **Assets** — the 14 meshes under `assets/models/*.glb` (≈21 MB, which is almost the whole published package) are generated by `python scripts/convert-meshes.py` and their structure contract is validated by `python scripts/verify-models.py` (`npm run verify:models`). Their size and licence provenance are documented in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md); `npm run analyze:models` shows where the bytes go.

---

## Reference implementation

This plugin shares the same ancestry as Nonead's [`Nonead-Universal-Robots-MCP`](https://gitee.com/nonead/Nonead-Universal-Robots-MCP) (GitHub: <https://github.com/nonead/Nonead-Universal-Robots-MCP>), reusing its `URBasic` library and robot-control logic, re-encapsulated by the same team for DeepSeek Harness as this plugin's `ur_*` tools and stdio worker protocol. `URBasic` is MIT (© Tony Ke & Anthony Zhuang / Universal Robots, 2009-2025).

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

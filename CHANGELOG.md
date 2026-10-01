# Changelog

This project adheres to [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [0.6.5] - 2026-10

> This release turns the digital twin from a read-only preview into a bench tool, and replaces the
> 10 Hz polling loop with a push channel. It also finishes a batch of **honest readback** fixes in
> the worker: several tools reported values they could not actually read — a tool-telemetry call that
> was always `null`, a freedrive check that called a stale `0` normal, and a `power_off` that treated
> "the controller stopped answering because it just powered down" as a failure. Everything below was
> already in the tree but had never been written down; 0.6.3 and 0.6.4 were never released as
> separate entries.

### Added — the host's fourth read-only route: a live SSE stream

- **`/dsh-nonead-ur/twin/stream`** (`lib/twin-routes.js`): Server-Sent Events instead of
  poll-and-hope. One frame every `100 ms`, a `: ping` heartbeat every 15 s (an idle connection is
  exactly what a proxy cuts after 30–60 s), a `pumping` flag for backpressure (no next frame until
  the previous write has drained), an immediate first frame, `x-accel-buffering: no`, and `405` for
  anything that is not a `GET`. **A failed frame emits an `error` event and never tears the stream
  down** — the client keeps the last good frame.
- **The stream carries `detail` on its own slow cadence** (`TWIN_STREAM_DETAIL_MS` = 2000 ms): not on
  every frame (a dashboard round trip per frame would saturate the robot at 10 Hz), and not never
  (safety mode, temperatures and bus voltage would stay empty forever).
- **Client subscriber** (`src/client/robot/twin-stream.js`): `EventSource`, reconnect after 1 s, give
  up after 8 consecutive failures *and tell the subscribers*, and say so explicitly when the
  environment has no `EventSource` instead of silently doing nothing.
- **Stream and polling are mutually exclusive** (`src/client/state.js`): with `stream: true` not a
  single `fetch` is made — running both would push every frame twice and make the arm jitter.
  Switching robot rebuilds the whole stream, and the client half now **defaults to `stream: true`**.
- The host-compat gate now expects **4** exact twin routes (`state` / `asset` / `models` / `stream`),
  not 3. The assertion exists so that a changed registration shape is *noticed*, not to freeze it.

### Added — choosing among robots, and seeing which one you are looking at

- **`setIp()` clears the previous robot's readings** (`src/client/state.js`): switching target
  immediately drops `connected`, `q`, `tcp`, `ts` and `detail`. Showing robot A's pose as robot B's
  is worse than showing nothing. The same IP is a no-op (the snapshot object is not even rebuilt),
  and a blank or non-string value means "hand it back to the host's resolution".
- **A robot picker and an identity row** (`src/client/twin-panel.js`): the picker is rebuilt only
  when its signature (`${resolvedIp}|${candidates}`) changes — rebuilding it every frame swaps the
  button out from under the finger. The HUD's first row now shows `model · IP`; the IP used to live
  only in `data-ur-twin-ip` and was not visible anywhere in the UI.
- A disconnected frame **keeps the `ips` candidates**, otherwise the picker is unreachable exactly
  when it is needed (several robots connected ⇒ the target is ambiguous); `setIp` aborts the
  in-flight request and refetches at once instead of waiting for the next tick.

### Added — look before it moves: a pending-motion preview

- **`lib/pending-motion.js`** turns an approval prompt into a preview, and **never pretends to know
  more than it does**: `joints` (a whole ghost arm can be drawn) / `pose` (the plugin has no IK, so
  only a marker at the target position) / `relative` (text only — the absolute target needs the
  current TCP) / `opaque` (circles, squares, stars, program runs, force and speed commands have no
  single target). It never throws: malformed arguments degrade to `opaque`, and the summary is
  truncated at 200 characters.
- **`createPendingMotionStore()`** hands out a per-approval **token**, so when two approvals overlap
  the one that finishes first cannot wipe the other's preview. `read()` treats a preview older than
  `PENDING_MOTION_TTL_MS` (10 minutes) as finished — which is how an approval that was interrupted
  stops leaving a phantom target on screen.
- `lib/index.js` calls `begin` **before** the prompt and `end` in a `finally`, so approving,
  rejecting and "the approval service threw" all clear the preview.
- The state route carries `pending_motion` **only while an approval is pending** (the field is
  absent, not `null`), so the client can tell "nothing pending" from "pending but unparseable".
  Unlike `detail`, the client deliberately does **not** carry `pending_motion` over from the
  previous frame.

### Added — bench instrumentation in the twin

- **Ghost arm** (`src/client/robot/ghost-arm.js`): the real arm is cloned and overlaid on the actual
  pose, so following error, lag and blending are visible at a glance. Geometry and textures are
  **shared** with the real arm (one extra layer costs almost no VRAM) — and for that same reason the
  clone's geometry is **never disposed**: those are the very objects the real arm renders. A pending
  target is orange, the controller's current target is cyan.
- **TCP axes** (`src/client/robot/tcp-axes.js`): a fixed 8 cm `AxesHelper` was too big on a UR3, too
  small on a UR30, and unlabelled. The size is now `0.12 ×` the arm radius, clamped to
  `[0.03, 0.3]`, with X/Y/Z sprite labels drawn from a canvas (no external font, and a graceful
  degradation where there is no canvas). The scale has to be applied to an **inner** node: the outer
  node receives the `tool0` matrix every frame, and `scale` does not survive `matrix.fromArray`.
- **Engineering overlays** (`src/client/robot/overlays.js`), all off by default: reach envelope,
  load centre of gravity, and a TCP force/torque arrow (1 N dead zone, 0.6 m cap). The reach radius
  is the sum of the first six link lengths and is documented as an **upper bound**, not a vendor
  "reach" figure. The CoG marker is implemented but **deliberately not exposed** — the plugin has no
  op that reads the payload back, so the button would do nothing.
- **Screenshot export** (`src/client/robot/screenshot.js`): a PNG watermarked with model, IP, safety
  mode, speed scaling, joint angles, TCP and a local timestamp. The watermark is drawn on a **copy**
  of the canvas, and that copy is taken **synchronously right after a render** — the context is
  `preserveDrawingBuffer: false`, so yielding to the event loop first can hand back a fully black
  image.
- **Trajectory controls**: clear / pause-resume / export CSV. The CSV carries **joint angles as well
  as position**, without which an export cannot reproduce a pose. Colours now run from dark blue to
  bright cyan with sample age, which shows direction and relative speed at once; when no timestamps
  are usable it degrades to index order instead of producing `NaN`.
- **Accessibility**: the canvas is `role="img"` with an `aria-label` and `tabindex="0"`, and the
  arrow keys / `Home` drive the existing view presets — currently the only way a keyboard-only user
  can operate the 3D view. The HUD is `role="status"` + `aria-live="polite"` (announce changes, not
  the whole block), toggle buttons carry `aria-pressed`, and truncated readouts get a `title`.

### Added — the client strings are now a real table

- `src/client/strings.js` does not gamble on `@deepseek-ai/dsh-client-locale` (which is not installed
  on this host): the `zh` and `en` key sets are **exactly symmetric** (a test asserts this both ways),
  interpolated entries are functions, and `resolveLocale` looks only at the primary subtag and
  **falls back to Chinese, not English**, when it cannot tell. The right-dock card and overlay read
  their text from the same table.

### Fixed — readback: tools that reported what they could not read

- **`ur_get_tool_telemetry` returned nothing but `null`.** The tool-side fields were missing from the
  RTDE recipe *and* the vendored accessors were `NotImplementedError` stubs. The recipe now declares
  them (`tool_*`, `io_current`, `target_speed_fraction`; `tool_output_voltage` is an `INT32` per the
  RTDE documentation and reads 24000 for 24 V), and the tool reads `dataDir` directly.
- **`ur_get_tool_analog_in` now prefers a direct RTDE read** and only falls back to the
  script-plus-register route when it has to — that route interrupts whatever program is running. The
  readback register defaults to 22 to stay clear of `send_script`'s 23.
- **`ur_get_speed_scaling` no longer reads a standstill as "scaled to zero".** `speed_scaling` is the
  *actual* fraction and `target_speed_fraction` is the *requested* one; both are reported now, with
  the semantics spelled out in the reply.
- **`ur_get_freedrive_status` uses a sentinel token** to tell "this firmware does not support it"
  from "the value really is 0". The old implementation read a stale register and called it normal.
- **`ur_power_off` takes the `PowerOn` bit of `robot_status_bits` as the answer**, so a controller
  that stops answering *because it has just powered down* is no longer reported as a failure.
- **`ur_draw_circle` writes a start sentinel**, turning a blind 60 s timeout into an immediate
  `NOT_EXECUTED` when the controller never ran the script.
- **`ur_move_tool_x/y/z` convert the tool-frame displacement to the base frame in the worker**
  (`_tool_axis_move`): read the current TCP pose, rotate the delta by that pose's rotation matrix,
  and send a base-frame `movel`. `pose_trans` is deliberately *not* used — it caused runtime aborts
  on CB3 / URSoftware 3.15.

### Fixed — two defects that were visible on screen

- **The fallback arm was always UR3-sized.** `buildFallbackArm()` unconditionally used `ARM_LINKS`,
  so a model that failed to load fell back to geometry that did not match the robot in front of you.
  Link lengths now come from `linkLengthsFromKinematics(kin.links)`, with a per-value fallback and
  never a `NaN`/`0`/negative output — a single `NaN` vertex makes the whole subtree disappear.
- **The right-dock 3D view was an absolutely positioned overlay.** Its containing block was not the
  dock's content box, so it measured wider than the dock and overlapped the conversation column. It
  is now a normal-flow flex child, and the start-panel guide column is hidden inline (its previous
  value is recorded and restored on collapse). The entry card prefers a **deep clone of the native
  card** (theme, radius and icon slot all ride on hashed class names that cannot be re-created by
  hand), falls back to a self-built card when the native one is absent, and upgrades to the clone
  once the guide column renders. Clicking another card, or the column disappearing, collapses it.

### Changed — worker backpressure

- `DEFAULT_MAX_IN_FLIGHT = 8` in `lib/worker.js`: past the limit a call is **rejected, not queued**.
  The worker is single-threaded, so a call queued behind a stuck one only burns its own timeout; the
  error now names the likely cause ("the robot may not be responding").

### Added / Changed — gates and self-checks

- **`scripts/check-new-ops.py`** — the behavioural gate for every worker op added in 0.6.0: it
  asserts the exact URScript sent to a fake controller (force mode, `speedj`, `optimove`, `movec`,
  conveyor tracking, the drawing waypoint sequence) plus 14 `ValueError` cases that must fail closed.
- **`scripts/check-test-manifest.mjs`** reconciles `test/test-manifest.json` against the real Python
  invocations under `test/**` **in both directions**: a test that needs Python but is not listed
  fails, and so does one that is listed but never touches it.
- **`scripts/check-package-metadata.mjs`**: `main` / `exports` / `dsh.bundle.patch` must resolve, the
  client bundle must register under the package name, `files` must cover the runtime and must not
  include the machine-local `python/sitecustomize.py`, and no source file may hardcode the author's
  paths. **`scripts/check-doc-tools.mjs`** reconciles the README tool tables against the real
  registry (parsing table rows only — the previous full-text scan still passed after a row was
  deleted), and **`scripts/check-tool-params.py`** enforces the cross-language parameter contract in
  both directions. Two traps are worth recording: `check-host-compat.mjs` probes the installed
  Desktop `node_modules` **before** walking up, because this repository's own dev copy of
  `@deepseek-ai/dsh-tools` is older and would report a misleading "0/83 registered"; and
  `check-tool-params.py` writes its diagnostics in Chinese while keeping stdout ASCII, so a Chinese
  Windows console cannot kill the check with `UnicodeEncodeError`.
- `npm test` runs **9 gates** (4 Node + 5 Python) alongside **35 test files** (11 Python, 24 Node);
  `check-host-compat.mjs` (83/83 tools against the host's real DSL, 4 routes) stays behind
  `npm run verify:host`. All **44** items pass on this host (the Python half needs `numpy`/`paramiko`
  importable — see `python/sitecustomize.py`).

- **`tool_mode` is not the tool output mode, and its meaning is unconfirmed.** It measures 253 on
  UR30 / PolyScope 5.21 and does **not** change when `ur_set_tool_output_mode(0)` / `(1)` is called.
  Reading it is fine — it is passed through raw from RTDE — but the fixture in
  `test/readback-fixes.test.mjs` invented a plausible-looking `2`, which made the field read like a
  mode enum. The fixture now uses the measured 253 and states that the field's meaning is open.
- **Program load/run/pause/stop behave honestly against a controller that has nothing to run.**
  `ur_run_program` reports the controller's refusal verbatim (`Failed to execute: play`) rather than
  claiming success, and `ur_load_program` rejects a name containing angle brackets — which is correct
  (`<未命名>` is how PolyScope *displays* an unsaved program, not a filename), but it does mean the
  `loaded_program` string cannot be fed straight back into `ur_load_program`.

- **`ur_get_conveyor` now proves its URScript actually ran, instead of reading back a register nobody
  wrote.** The tick can only come from a URScript program, and a program the controller rejects at
  *load* time executes zero lines and raises no "program execution error" — so the old code happily
  read `output_double_register_0` and reported whatever happened to be there. That is exactly how the
  wrong-function-name defect above stayed invisible for so long. The tool now probes the channel
  first, then runs a payload bracketed by start/finish sentinels in an **int** register while the
  tick lands in a **double** one — two different register families on purpose, so a broken payload
  path cannot take the sentinel down with it and collapse every diagnosis into "nothing happened".
  Three outcomes are reported separately: **ran to the end** (`verified: true`, tick is
  trustworthy), **started but never finished** (`UNSUPPORTED`, no tick value), or **never executed**
  (`NOT_EXECUTED`, no tick value, likely cause named). Verified on UR30 / PolyScope 5.21: the tool
  reports `verified: true`, and reading `output_int_register_20` back independently returns exactly
  the finish token it claims. Two optional parameters (`register`, `payload_register`) choose the
  registers; both are overwritten.
- **`ur_get_double_register` shares the same read path as the int registers.** It called
  `OutputDoubleRegister` directly, so a missing or throwing accessor meant an exception instead of a
  value; it now uses a new `_read_double_register` helper that falls back to the raw RTDE field, the
  way `_read_int_register` always has.

### Fixed — found by a live pass against URSim (UR30 / PolyScope 5.21.3)

- **`ur_get_conveyor` could only ever return 0, because an earlier "fix" made the controller
  reject the whole script.** URScript's function for writing a double register is
  **`write_output_float_register`**; `output_double_register_0` is the **RTDE field name** for the
  same datum. An earlier release treated the two as one name and "corrected" the call to
  `write_output_double_register` — a function that does not exist. The controller therefore rejects
  the entire program at load time, so not a single line runs; `waitRobotIdleOrStopFlag()` never
  sees an execution error, and `get_conveyor_tick_count()` goes on to read back register 0 —
  a value nothing ever wrote. The visible complaint became a **silent wrong answer**. Measured on
  PolyScope 5.21 / UR30: `write_output_float_register(0, 42.5)` is accepted and
  `output_double_register_0` reads back 42.5, while `write_output_double_register(0, 99.5)` is
  rejected outright (the `ur_send_script` sentinel never lands). The call is reverted, `urScript.py`
  now carries the evidence in a comment, and `test/readback-fixes.test.mjs` fails if the wrong name
  ever reappears — the earlier change shipped with **no test covering it at all**, which is how it
  got through.

- **Every non-ASCII string the controller sent came back as mojibake.** `dashboard.py`'s receive
  path built its text with `''.join(map(chr, out))` — one code point per byte, i.e. Latin-1 — so
  PolyScope 5's `STOPPED <未命名>` arrived as `<æªå½å>` and `(三月 14 2025)` as `(ä¸æ 14 2025)`: a
  Chinese program name was unreadable in every readout. It now decodes UTF-8, falling back to
  Latin-1 so an older firmware that really does send single-byte text still works.
- **`program_state` / `runtime_state` kept the program name.** Unlike `safetymode` / `robotmode`
  (which carry a `label:` **prefix**), `programState` answers *state **plus** program name* —
  measured `STOPPED <未命名>` while idle, `PLAYING <name>` while running. `_enum_token` only strips a
  prefix, so the client's bare-token table missed and the HUD showed `程序 STOPPED <未命名>` instead
  of `程序 已停止`. A dedicated `_program_state` now strips the trailing `<program name>` at the
  protocol boundary, while leaving the `"<查询失败>"` sentinel untouched. Same class of defect as
  the 0.6.2 prefix fix — and the fixture repeated the same mistake (`ur_programState` was mocked as
  a bare `"STOPPED"`), so `test/safety-status.test.mjs` now feeds the real `STOPPED <未命名>` and
  pins the strip in both directions.
- **`ur_get_digital_in(which="tool")` raised an opaque error, and could report a stale value.**
  Tool digital inputs are not on RTDE, so the worker runs a URScript program — and on a UR30/URSim
  with no tool attached the controller **ends that program with a runtime error**. Upstream then
  raised `RuntimeError: Robot program execution error!!!` (no information at all) and
  `urScript.get_tool_digital_in` went on to **read back output register 0** — whatever was left
  there — as if it were the input level. The failure now returns an actionable error naming the
  likely causes (no tool connected, tool I/O not enabled, tool port taken by TCI serial), and the
  failure path reads **no** register. Verified against the controller that the register path was
  never the problem: `write_output_integer_register(7, 12345)` reads back as exactly 12345.

### Documentation

- **Restored the missing `## [0.6.0]` heading.** The manual cross-check notes ("Tool count 67 → 83")
  had been sitting inside the 0.6.1 entry since they were written, with no version heading of their
  own; every other release has one.

## [0.6.2] - 2026-09

> A compatibility pass against DSH `0.2.0-rc.2` (cross-checked against `0.1.7-rc.2`) found three
> tools that never reached the model. Their parameter schemas used an explicit `required: false`,
> which the value-schema DSL rejects outright — and a rejected parameter fails **the whole tool**,
> leaving only a warning line. The table read 83 tools while 80 could actually be called.

### Added — the twin panel now uses telemetry the host was already sending

- **`detail=1` had no consumer.** The route has always been able to return the dashboard-side
  state (`safety_mode`, `robot_mode`, `program_state`, `running`, `speed_scaling`,
  `joint_temperatures`, `joint_currents`, `robot_voltage/current`), but the client never asked
  for it. It is now polled on a **slow cadence over the existing chain** (`detailMs`, default 2 s)
  — no second poller, so "only one request in flight" still holds and the pose channel keeps its
  10 Hz. Without `detail` in a response the previous values are kept, so the row does not flicker.
- The HUD gained two rows (safety/robot/program/speed, then joint temperatures and bus
  voltage/current), and an abnormal safety mode now **takes over the status line** instead of hiding
  behind `已连接 · ur5e`. Unknown mode strings are shown verbatim **and treated as abnormal** — a
  firmware that adds a mode must not be able to make a protective stop look normal.

### Added — view toolbar, bounding-box framing, on-demand rendering

- **The camera and the base grid are no longer hard-coded for a ~0.8 m arm.** Both are derived from
  the model's bounding box, so UR3 (≈0.94 m reach) through UR20/UR8long (≈2.4 m) all open correctly
  framed; `min/maxDistance`, `near/far` and the grid extent follow the same radius. The grid is
  rebuilt (and the old one disposed) whenever the model changes.
- **A toolbar that did not exist before**: reset view plus isometric / front / side / top presets.
  `scene.js` had referred to a "reset view" control since it was written, but the panel never had
  one — the only way back from a bad camera was collapsing and reopening the panel.
- **On-demand rendering**: a frame is drawn only when something actually changed (new sample,
  resize, model swap, camera moved, preset applied). Every frame used to render unconditionally,
  including while disconnected and while the arm was standing still.
- **Background tabs stop the frame loop entirely** (`visibilitychange`) and resume on return.
  Polling had already been throttled when hidden; rendering had not.

### Fixed — three tools were silently unregistered

- The array-parameter helper emitted `required` unconditionally, so the call sites that asked for
  an **optional** array produced `required: false`. The value-schema DSL accepts `required` only as
  `true` (`required must be true when present`); a property is declared optional by **omitting**
  the key. The helper now omits it instead of writing `false`.
- Restored: `ur_set_conveyor_tracking` (`direction`, `center`), `ur_force_mode` (`task_frame`,
  `wrench`, `limits`) and `ur_set_payload_inertia` (`inertia`). `scripts/check-host-compat.mjs`
  now reports **83/83** against both `0.1.7-rc.2` and `0.2.0-rc.2`.
- The rule is byte-identical in both harness versions, so this was never a compatibility regression:
  the plugin's own `test/tool-schema-dsl.test.mjs` could not see it because it stubs
  `@deepseek-ai/dsh-tools` and checks only the author-keyword allowlist — never the value of
  `required`.

### Fixed — dashboard replies kept their label prefix, so `NORMAL` read as a hazard

- **The safety mode never reached the client as a bare token.** UR answers the `safetymode` /
  `robotmode` dashboard queries with a labelled line (`"Safetymode: NORMAL"`, `"Robotmode: RUNNING"`),
  and the worker passed that line through verbatim into `safety_mode`, `robot_mode` and
  `program_state`. The client looks those up in a bare-token table, so the lookup missed — and
  `isSafetyHazard`, which deliberately treats an unrecognised mode as abnormal, flagged `NORMAL`
  as one. The twin panel then pinned "the robot may have stopped; check the teach pendant" to its
  status line **permanently, moving or not**, and the prefixed string also leaked into the HUD row,
  the screenshot watermark and `ur_get_status`.
- Fix: `_enum_token` strips the `label:` prefix at the protocol boundary — the one place that knows
  the raw dashboard wire format — and every enum-valued field now goes through it. Replies that
  carry no prefix (`programState` answers `"PLAYING"`) and the `"<查询失败>"` sentinel pass through
  unchanged.
- `test/safety-status.test.mjs` had invented bare replies (`"PROTECTIVE_STOP"`), which is precisely
  why the suite stayed green. It now feeds the real labelled form and pins the normalisation as a
  contract.

## [0.6.1] - 2026-09

> A full-project audit (four delegated audits + hands-on verification; reports in `docs/audit/`)
> found defects that the suite could not see: a **complete bypass of the motion approval gate**,
> a **shipped file that was not tracked by git**, `test:node` that could never pass, and two
> motion ops that did not do what they documented. This release fixes all of them and turns the
> audit's own checks into real gates.

### Security — the approval gate could be bypassed entirely (host-audit H-1)

- **`lib/worker.js` builds the wire payload as `{ id, op, _timeout_ms, ...params }` — `params`
  spread last — while the gate tests the closure's `op`.** Because the DSH value-schema does not
  reject undeclared arguments, a model could call any *ungated* tool with an extra
  `{"op":"power_off"}` and the worker would run `op_power_off` with **no approval prompt at all**.
  Every one of the 38 gated ops (`movej`, `send_script`, `run_program`, `brake_release`,
  `force_mode`, `shutdown`, …) was reachable this way; an extra `id` additionally let a call hang
  for its full timeout and then kill the worker.
- Fix: tool arguments are now filtered against **the tool's own declared parameter list** before
  they reach the worker, and `op` is always the closure value the gate decided on — it can never
  be influenced by an argument. Verified by `test/approval-gate.test.mjs`, which drives the real
  tool registry and asserts that an injected `op` / `id` / `_timeout_ms` never reaches the worker.

### Security — the gate depended on the schema applying its default (host-audit M-6)

- `requireApprovalForMotion` was the only one of the four `Config` fields with no `??` fallback in
  `apply()`, so any caller passing a config object that had not been through schema parsing got
  `undefined` — silently **disabling the gate** (fail-open). The default now lives in code
  (`config.requireApprovalForMotion ?? true`) and a test pins it.

### Fixed — the approval set was incomplete (host-audit H-2)

- `set_payload` was ungated while its twin `set_payload_inertia` was gated, although both send
  `set_payload_mass` + `set_payload_cog` and both **re-zero the force/torque sensor** — i.e. the
  same physical effect as the gated `zero_ftsensor`. `set_gravity` was ungated too, although
  mis-setting it makes the arm drop or float. Both are gated now, and the pairing is asserted so
  one of a pair cannot drift out of the gate again.

### Fixed — two ops did not do what they documented (worker-audit HIGH-1 / HIGH-2)

- **`draw_square` / `draw_rectangle` wrote a distance into the rotation component.** For
  `coordinate="z"` the vertical edge did `wp[1][3] -= border` — index 3 is **rx in radians**, so
  `draw_square(border=0.2)` rotated the tool ≈11.5° instead of drawing a square. Both now use
  index 2 (z, metres); a test asserts the whole waypoint sequence and that the orientation
  components never change.
- **`conveyor_tracking` sent every conveyor argument in the wrong slot.** It emitted
  `conveyor_pulse_decode(a, b, 0)` (first slot is the *decoder type*, and `0` means "pulse decoding
  disabled"), `set_conveyor_tick_count(0, ticks_per_meter)` (second slot is a 0–4 bit-width enum),
  and `track_conveyor_linear(p[0,…], speed)` / `track_conveyor_circular(p[0,…], radius, speed)`
  (the manuals want a direction/centre pose, ticks per metre/revolution, and a boolean). Rewritten
  against the manual with distinct `setup_pulse` / `setup_absolute` / `linear` / `circular` /
  `stop` actions, correct units, and encoder pin ranges per firmware (CB3 0–3, e-Series 8–11). It
  reports `hardware_verified: false` and says so, because the signatures are manual-verified but
  the tracking behaviour needs a real conveyor.

### Fixed — a crash path in the worker's error handler (worker-audit MEDIUM)

- `ur_worker.py`'s unexpected-exception handler logs `req.get("op")`, but `req` is bound *inside*
  the `try` — so a malformed first line raised `UnboundLocalError` **inside the handler**, never
  answered the request, and killed the worker. Now `req` is initialised before the `try`;
  reproduced and re-verified with `scripts/probe-malformed-request.py`.

### Fixed — a dying worker could clobber its replacement (host-audit H-3)

- `lib/worker.js`'s `exit` handler unconditionally cleared `this.proc` / `_spawnPromise` and failed
  **every** in-flight request. A killed child's `exit` can arrive after a new child has already
  spawned and started serving (the 500 ms restart backoff is the window, and the twin panel issues
  ~20 calls/s), so a healthy call could be rejected with "UR worker exited" while its child was
  alive, `stats().running` lied, and `dispose()` could leave an orphaned Python process holding the
  controller's exclusive RTDE session. The handler now only clears state it owns, fails only the
  requests routed to *that* child, and keeps per-child stderr.
- `proc.stdin` now has an `error` listener: an EPIPE after the child dies was an unhandled
  `'error'` event, which would take down the whole DSH host rather than failing one call.

### Fixed — release blockers found by auditing the repository itself

- **`python/URBasic/rtdeConfiguration.xml` was not tracked by git** although `package.json`
  publishes it, `test/rtde-config.test.mjs` requires it, and `rtde.py` prefers it over the
  vendored default (which has no `target_*` fields, no bit registers 32–63, and a `<send>`
  section). A fresh clone therefore silently lost the recipe. Now tracked.
- **`npm run test:node` could never pass**: `test/selftest.test.mjs` spawns Python but was missing
  from `PYTHON_DEPENDENT`. The list now lives in `test/test-manifest.json` and
  `scripts/check-test-manifest.mjs` re-derives "which test files actually call Python" from the
  sources, so a missing entry fails a check instead of turning into a mysterious `exit 1`.
- The interpreter probe now verifies **the dependencies the worker needs** (`import numpy`) rather
  than that Python can start: previously a Python without numpy made the ten Python-dependent
  files *run and fail* instead of being skipped, so an environment problem looked like a plugin
  defect.
- **`ur_set_analog_out` never declared `full_scale`** although the worker reads it and both READMEs
  and the CHANGELOG advertised it — so a 0–20 mA port was unreachable (`value=16` was rejected
  with "must be between 0 and 10.0"). Declared, with the domain behaviour documented.
- **`numberArray()` hard-coded `required: true`**, which made documented-optional arrays mandatory
  in the schema (`force_mode.task_frame` / `wrench` / `limits`, `set_payload_inertia.inertia`) and
  made `set_payload_inertia`'s documented CB3 fallback unreachable. `required` is now explicit.
- English README: the approval-gate list was missing every 0.6.0 op, and the install snippet still
  pinned `^0.4.0` (which installs a pre-0.5.0 release).

### Added — the audit's checks are now gates that run in `npm test`

- **`test/approval-gate.test.mjs`** (new, 9 cases): drives the real tool registry and proves that a
  gated op never reaches the worker before approval, that all four fail-closed paths reject
  (no approval service / no agent / the service throws / any non-`allowed-once` answer), that
  read-only ops are not bothered, that `requireApprovalForMotion: false` really disables it, and
  that argument injection cannot re-route a call.
- Six audit scripts were print-only and always exited 0 — the exact "a green check proves nothing"
  failure the project warns about. `check-worker-ops.py`, `check-approval-gate.py`,
  `check-rtde-recipe.py` and `check-tool-params.py` now **exit non-zero** on a real problem, and
  all of them (plus `check-test-manifest`, `check-package-metadata`, `check-doc-tools`, and a new
  `check-client-bundle.mjs`) are wired into `npm test` and `npm run check`.
- `check-client-bundle.mjs` replaces the literal-sampling heuristic (which either looked at 6 of
  ~113 literals or produced false alarms) with a **deterministic rebuild-and-compare**: it rebuilds
  `src/client/**` into a scratch file and compares the result with the committed bundle, so a stale
  artifact fails the build. It never overwrites the committed bundle — `build-client.mjs` gained
  `BUILD_CLIENT_OUT` for that.
- `scripts/probe-malformed-request.py` and `scripts/probe-sendprogram-blocking.py` keep two
  hardware-free probes: the first reproduces the malformed-line crash path, the second is the
  executable evidence that entering a never-ending mode (force/freedrive) does **not** stall later
  sends (measured 0.25 s — recorded so it is not re-investigated from source alone).

### Documentation

- `docs/audit/` — four audit reports with `file:LINE` citations and quoted code
  (`worker-audit.md`, `host-audit.md`, `client-vendored-audit.md`, `verification-audit.md`), plus
  `round2-verification.md`, which records the hands-on verification, **corrects three over-rated
  HIGH findings** in the delegated reports, and lists what was checked and found clean (approval-set
  completeness, RTDE recipe headroom, package metadata, bundle freshness, `SendProgram` blocking).

## [0.6.0] - 2026-09

> This release re-checked the plugin, line by line, against the three official URScript manuals
> bundled in `ScriptManual/` (`scriptManual_3.15.4.pdf` = URSoftware 3.x / CB3,
> `script_directory_Poly5.pdf` = PolyScope 5 / e-Series, `script_directory_PolyscopeX.pdf` =
> PolyScope X / 10.x). It adds the capabilities the manuals document but the plugin lacked, fixes
> three places where the **defaults or semantics disagreed with the manual**, and records the
> cross-check in [`docs/urscript-manual-analysis.md`](./docs/urscript-manual-analysis.md).
> Tool count 67 → **83**.

### Added — force control (`ur_force_mode` / `ur_end_force_mode` / `ur_force_mode_settings`)

- A whole capability the plugin did not have at all: force mode makes the arm compliant along/about
  selected axes while it keeps applying a requested force/torque (sanding, assembly, surface
  following, any pressing process). Arguments match the manual one by one — `task_frame` /
  `selection_vector` (1 = compliant) / `wrench` / `type` (1-3) / `limits` (compliant axes = max TCP
  speed, stiff axes = max allowed deviation) / `damping` (0-1) / `gain_scaling` (0-2).
- The implementation follows the manual's semantics of force mode as a **continuing state**: the
  script runs `while True: force_mode(...); sync() end` so it stays in force mode on the controller
  (the same shape URBasic uses), so `ur_force_mode` only *enters* it — leave with
  `ur_end_force_mode` (which preempts that program and calls `end_force_mode()`) or by stopping the
  program on the pendant.
- The manual's recommended `sleep(0.02)` before entering force mode is inserted (Poly5 15.12 requires
  it to avoid motion along compliant axes and high deceleration), and the arguments are validated
  locally: `selection_vector` may only contain 0/1, `type` ∈ 1/2/3, `damping` ∈ [0,1],
  `gain_scaling` ∈ [0,2] — out-of-range values either make the controller refuse the script or make
  force mode unstable.
- ⚠️ Stated plainly: `damping` / `gain_scaling` **cannot be read back from the controller** (the
  manuals only define `force_mode_set_*`), so `ur_force_mode_settings` reports what it set and
  returns `readback_supported: false` instead of pretending to read the current value.

### Added — velocity control and standstill (`ur_speedj` / `ur_speedl` / `ur_stopj` / `ur_stopl` / `ur_wait_steady`)

- `speedj(qd, a, t)` / `speedl(xd, a, t, aRot)` / `stopj(a)` / `stopl(a, aRot)` with the manuals'
  signatures. Omitting `aRot` follows the manual's `aRot='a'` semantics (same value as `a`).
- ⚠️ Velocity commands are **open-ended**: the manuals state that with `t` omitted the function
  returns once the target speed is reached — **returning is not stopping**. The tool's answer says
  so explicitly ("the arm is still moving; finish with stop*/wait_steady") and never pretends the
  motion is over when `t=0` (the default).
- `ur_wait_steady` implements "wait until the robot is at rest" **without** URScript's `is_steady()`
  (Poly5 16.39 documents that it always returns false in force/teach mode, and it is an expression
  that needs an extra program plus register read-back). It polls the `actual_TCP_speed` and
  `actual_qd` fields that are **already in the 500 Hz RTDE stream** — no extra round trip, and it
  still gives a true answer while force mode is active. On timeout it does not fail: it reports
  `steady: false` together with the measured speeds.

### Added — target values (`ur_get_target_values`) and a wider RTDE recipe

- Reads **where the controller is taking the arm**: target joint positions/velocities/accelerations
  and target TCP pose/speed (with the actual values alongside for comparison). This is the direct
  evidence for "command sent but not executed yet / being blended / held back by the safety limit /
  program cancelled".
- Implemented by adding `target_q` / `target_qd` / `target_qdd` / `target_TCP_pose` /
  `target_TCP_speed` to the receive recipe in `URBasic/rtdeConfiguration.xml` (74 → 79 fields; UR
  allows 96 data values, and the two `output_bit_registers*` entries count as one), and by turning
  the five matching `NotImplementedError` stubs in `RobotModel` into real RTDE reads.
- This is more reliable than sending a URScript expression and reading a register back: zero round
  trips, it does not interrupt a running program, and it cannot fail because the expression is
  missing on older firmware.

### Added — tool-side configuration and telemetry (4 tools)

- `ur_set_tool_communication`: the tool-flange serial interface (TCI / RS-485), validated against
  the manual's `set_tool_communication(enabled, baud_rate, parity, stop_bits, rx_idle_chars,
  tx_idle_chars)` (only the eight documented baud rates, parity 0-2, stop bits 1-2, idle chars
  within the documented ranges). ⚠️ The description repeats the manual's warning that **enabling
  TCI disables the tool analog inputs**.
- `ur_set_tool_output_mode`: tool output mode 0 = normal, 1 = power (dual-pin supply).
- `ur_set_payload_inertia`: mass + centre of gravity + inertia matrix in one call
  (`set_target_payload`, PolyScope 5.10+), validating the manual's rules (Ixx/Iyy/Izz non-negative,
  every element |I| ≤ 133 kg·m²) and supporting `transition_time`. `set_target_payload` is used
  **only when an inertia matrix is supplied**; without one the tool falls back to
  `set_payload_mass` + `set_payload_cog` (CB3 3.x has no `set_target_payload`, so both paths work).
  The description also carries the manual's two notes: setting a payload **automatically re-zeros
  the force/torque measurement**, and `set_payload(m, cog)` **resets** the inertia matrix (the
  manual marks it deprecated).
- `ur_get_tool_telemetry`: tool output current/voltage and I/O current (RTDE fields, free to read).
  The manuals also document `get_tool_temp()`, but the current recipe has no matching RTDE field, so
  that value is **not** provided — the description says why rather than inventing a number.

### Fixed — defaults that disagreed with the manual (`ur_movej` / `ur_movel`)

- **`ur_movel`'s default speed was four times the manual value**: the old code used `a=1, v=1`
  while the manual (Poly5 15.30 / PolyScope X 15.29) says `a=1.2, v=0.25` (250 mm/s). On a cobot
  "no speed given" and "run at 1 m/s" are very different things; the defaults are the manual's now.
- **`ur_movej` had the same problem** (old `a=1, v=1`; the manual says `a=1.4, v=1.05`).
- The tool descriptions now also state the manual's other rule: **supplying `t` overrides `a`/`v`**
  ("Time setting has priority over speed and acceleration settings.") — the thing models get wrong.

### Fixed — `ur_movec` was missing the manual's `mode` argument

- The manual's `movec(pose_via, pose_to, a, v, r, mode)` (Poly5 15.28) uses `mode` to pick the
  orientation interpolation: `0` interpolates from the current pose to the target, `1` keeps the
  orientation constant relative to the **tangent** of the arc (fixed-orientation circular motion).
  The old code never sent the argument at all, so a fixed-orientation arc meant bypassing the tool.
  It is sent now, defaulting to 0 exactly as the manual does.

### Added — OptiMove, Motion Version and freedrive singularity (`ur_move_optimized` / `ur_motion_version` / `ur_get_freedrive_status`)

- `ur_move_optimized` exposes `optimovej(goal, a=0.3, v=0.3, r=0)` / `optimovel(...)` (Poly5
  15.32/15.33, PolyScope X 15.31/15.32): the same targets as `movej`/`movel` but with jerk-limited
  speed profiles, so the motion is smoother and vibrates less. ⚠️ The manual is explicit that `a`
  and `v` are **fractions of what the robot is able to do** — `a, v ∈ (0, 1]`, where 1 is the fastest
  the robot can manage in that configuration — *not* rad/s or m/s. The tool validates that range and
  says so in its description, because passing `a=1.4` (a perfectly good `movej` argument) would be
  out of range here. The manual's `struct{pose, frame}` and world-model-object-name goal forms are
  **refused explicitly** (they need PolyScope-side objects; a wrong script would only produce a
  runtime error on the controller), and `goal_type` selects `joints` (optimovej) or `pose`
  (optimovel).
- `ur_motion_version` sets the Motion Version (manual chapter 14) and/or the **jerk gain**
  (`jerk_gain_scaling_set`, 0.01-1.0). Version 2 clamps velocity/acceleration to the hardware limits
  during planning and shrinks overlapping blend radii dynamically, where version 1 skips the move and
  emits an "Overlapping Blends" warning; the jerk gain only affects jerk-limited profiles — version-2
  `movej`/`movel` and `optimovej`/`optimovel`, which is exactly what `ur_move_optimized` uses. ⚠️ The
  manual states that newer models and PolyScope X support **only version 2**, and CB3 has no such
  setting at all. Neither setting has a read-back channel, so the tool reports what it set
  (`readback_supported: false`) instead of pretending to read the current value.
- `ur_get_freedrive_status` reads `get_freedrive_status()` (PolyScope X 15.20): how close the current
  pose is to a **singularity** during freedrive — `0` normal, `1` near, `2` too close (noticeable
  resistance). It is **not** an on/off flag for freedrive, and the manual's point is precisely that
  constrained freedrive degrades near singularities, so this is what tells an operator to follow a
  different path. The read goes through an output register (default int register 21, whose previous
  value is overwritten); on firmware predating the function it reports honestly that nothing came
  back rather than inventing a value.

### Fixed — `servoj` ranges were the 3.x ones

- The `t` default moved from `0.008` in 3.15.4 to `0.002` in Poly5 15.44 / PolyScope X 15.43 (the
  manual's preferred "new setpoint every timestep"), and the `lookahead_time` lower bound moved from
  `0.03` to `0.01`. The tool keeps `0.008` as its default (CB3 compatibility) but now **accepts
  `t ≥ 0.002` and `lookahead_time ≥ 0.01`**, so a caller following the newer manual is no longer
  rejected by a stale range.

### Fixed — `run-tests.mjs` honoured `PYTHON` but not `UR_PYTHON`

- The README and `test/selftest.test.mjs` have always used `UR_PYTHON || PYTHON || 'python'`, while
  the runner's probe only read `PYTHON` — so `UR_PYTHON=... npm test` would report "no Python
  found", skip every Python case, and contradict the skipped tests that could actually run. The
  probe now follows the documented convention.

### Tooling / documentation

- New `scripts/pdf-extract2.py`: a **dependency-free** (standard library only) text extractor for the
  three manual PDFs. Both PolyScope manuals embed subset CID Type0 fonts (`/Encoding /Identity-H`),
  so the character codes in their content streams are **glyph ids** and the text can only be
  recovered through each font's `ToUnicode` CMap; 3.15.4 uses plain WinAnsi Type1 fonts where the
  byte *is* the character code. The script handles both, rebuilds word spacing from baseline and
  kerning, and drops the rotated copyright watermark stamped on every page. Output lands in
  `ScriptManual/txt/*.txt` (page-separated) and is the evidence behind every signature/default
  checked in this release.
- `docs/urscript-manual-analysis.md`: function signatures, parameter ranges, version differences
  (3.15.4 → PolyScope 5 → PolyScope X additions / removals / renames / deprecations) and the safety
  limits the manuals state — each with a manual line citation.
- Tool-count gates updated: `EXPECTED_TOOLS` in `test/tool-schema-dsl.test.mjs` and
  `scripts/check-host-compat.mjs` went 67 → 83, along with both READMEs' tool tables, the approval
  list, and `67/67` → `83/83`.

## [0.5.0] - 2026-09

> An audit-and-hardening release whose theme is **"can you still believe it?"**. A code audit found
> and fixed defects that made the plugin **hang forever**, **report success it never had**, and
> **read another command's answer**. Tool count 53 → 67.

### Fixed — defects that wedged the plugin permanently

- **One dropped link killed the worker for good (`RealTimeClient.__sendPrg` retried without bound)**: upstream's send loop `while not stopRunningFlag and not programSend` has **exactly one exit — a successful send**. With the robot offline, `select.select([], [None], …)` raises `TypeError` at once → bare `except` → `__connect()` (itself a 60 s loop) → **never returns**. This plugin's worker is **single-threaded** (`for line in sys.stdin`), so one dropped link occupies the whole call chain: Node's 60 s timeout fails only *that one* promise while the process lives on, and **every subsequent tool call** queues up until it times out too. Sends now have a hard budget (`__sendTimeout`, default 15 s), record the reason in `lastSendFailure`, and return `False` up the stack; `lib/worker.js` now **kills the child on timeout** (and the next call respawns a clean worker after a 500 ms backoff), so a caller only needs one retry.
- **The RTDE receive thread "successfully" exited after 60 s, orphaning a live-but-dead connection**: `rtde.py`'s receive loop reused `__reconnectTimeout` (a "how long to establish" budget) as a **run-time window**; on expiry the loop ended having sent only PAUSE and **without closing the socket** ⇒ `isRunning()` stayed true (state sat at PAUSED) while data never updated again, and every later pose read blocked in `dataEvent.wait()`. Run time now uses a **separate data watchdog** (`__dataTimeout`, 30 s without any RTDE packet rebuilds the session), `__wait()` takes a timeout, and `__receive()` returns instead of raising `TypeError` when the socket is gone. **`dashboard.py` had the same defect**: its receive loop exited after 2 s without closing the socket, after which every dashboard command blocked forever in `wait_dbs()`; `wait_dbs()` now has a timeout (2 s default) and the loop only ends on `__stop_event`.
- **Every "read the joint angles" call could spin forever**: `urScript.sync()` (`while RobotTimestamp() == initialRobotTime: sleep(0.001)`) and `waitRobotIdleOrStopFlag()` had no exit at all. The former is on the path of every `get_actual_*` (which default to `wait=True`); the latter is used by `get_tool_digital_in` / `get_conveyor`. Both now time out with a readable `TimeoutError`.
- **The RTDE thread died outright on the first failed connect**: `rtde.py`'s `__connect()` wrote `self.sock` in its `except` — **an attribute that does not exist** — so a failure raised `AttributeError` out of `run()`: the real socket error was masked, the intended 60 s retry never happened, and `isRunning()` stayed false forever. Now `self.__sock`, closed defensively.
- **`Dashboard.wait_dbs()` waited forever**: it now requires a timeout, and `Dashboard.__send()` waits for the answer with one.
- **`_onLine` dropped protocol lines silently**: `lib/worker.js` now counts unparseable lines and unknown-id responses (via `stats()`) and keeps the evidence — they used to vanish entirely, surfacing as an inexplicable timeout.
- **Graceful shutdown never actually worked**: the newly added "shut down the controller" tool and the host's graceful worker shutdown **collided on the op name** (`shutdown`), so the latter was parsed as the former: it answered `KeyError: 'ip'` and never exited the worker. The host now uses `shutdown_worker`, and a **cross-language contract test** was added (every host op must exist in Python's `HANDLERS`; an op name must not collide with a dashboard command). The end-to-end `selftest.test.mjs` case is what caught it.

### Fixed — success reported where there was none, and answers read from the wrong command

- **`ur_movec` never sent a circular move**: `UrScript.movec()` hardcodes `movetype='p'` internally (`_move(movetype='p', …)`), so the `if movetype == 'c'` branch was dead ⇒ **`pose_via` was discarded entirely and the robot received a `movep`** (linear/blended) while the tool reported `movec(p…, p…)`. Even with `movetype='c'`, that branch emits an unsubstituted template. It now builds raw URScript, like `op_draw_circle`. (Verified by executing the real vendored module: the old path really does emit `movep(...)`.)
- **The "arrived" test was not an orientation metric**: `_right_pose_tcp` compared the three axis-angle components, so `[0,0,2π]` vs `[0,0,0]` (**the same orientation**) read as 6.28 apart and reported "movement ended but target not reached", while `[0.05,0,0]` vs `[0,0,0.05]` (**different orientations**) passed. It now uses the angle `θ = acos((tr(Rₐᵀ R_b) − 1)/2)` with a 0.05 rad tolerance; position keeps its 10 mm linear tolerance.
- **All four drawing ops reported "execution complete" unconditionally**: `_wait_robot_idle()` polled "is it running?" **immediately** after `SendProgram()` — which only queues bytes (the controller starts the script later) — so the first probe almost always saw "not running" and answered `ok: true`, whether or not the script ever ran. It must now **first observe the script actually running** before accepting "idle"; otherwise it reports honestly that the script was never seen to start (the controller most likely never executed it).
- **The confirmation pollers read the previous dashboard command's answer**: `Dashboard.__send()` waited for *any* notification, **never checking that the answer belonged to the command**, and `last_respond` was only overwritten when a message actually arrived. The classic failure: a previous `isProgramSaved` had just answered "True", so the next `is in remote control` reported `remote_control: true` for a robot **not in remote mode** — the model then sent URScript that the controller **silently discards**, with the tool reporting success throughout. `Dashboard.sendCommand(cmd)` now clears `last_respond` first and accepts only an answer that arrives after the send; every dashboard read in the worker goes through `_dashboard_send()` / `_dashboard_cmd()`.
- **`ur_set_tool_voltage` could never succeed**: it called `UrScript.set_tool_voltage()`, a `NotImplementedError` stub, so **every** call raised and answered `ok:false`. It now sends `set_tool_voltage(N)` URScript directly and validates that N is 0/12/24.
- **`ur_set_analog_out` had the wrong unit**: URScript's `set_analog_out(n, f)` takes a **relative level f∈[0,1]**, while the tool documented "0-10 or 0-20". The old code passed the caller's number straight through ⇒ `value=5` became f=5 ⇒ the port drove **full scale** (≈10 V), with no range check at all. It now accepts engineering units (`full_scale` may be 20 for a current-domain port), converts to [0,1], reads the value back, and returns `value` / `fraction` / `read_back`.
- **Configurable digital inputs were masked 8 bits off**: `RobotModel.ConfigurableInputBits(n)` computed `pow(2, n + 8)`, but `actual_digital_input_bits` is bit 0-7 standard DI, 8-15 configurable DI, 16-17 tool DI ⇒ `ur_get_digital_in(which="config", n=8)` actually read **tool DI 0**, n=9 read **tool DI 1**, and n≥10 always returned false. `ConfigurableOutputBits` had the identical offset. The plugin's own bulk reader (`_bit_masks`) was always correct, so two tools disagreed about the same robot. Both now use `n - 8`.
- **`RobotStatus()` / `SafetyStatus()` raised `TypeError` before RTDE data arrives**: `1 & None` throws (`&` binds tighter than `==`), and that exception escaped `RealTimeClient.__waitForProgram2Finish` and **killed the guardian thread**, leaving `rtcProgramRunning = True` forever and sending `waitRobotIdleOrStopFlag()` into an endless spin. Both now return **all-false** ("state unknown") when the word is missing.
- **`ActualJointVoltage()` returned the joint currents**: the name says voltage, the body read `actual_current` (amperes), while the real `actual_joint_voltage` sat in the RTDE recipe with no accessor at all. Fixed, along with the stubbed-but-available `ActualCurrent()` / `ActualQD()` / `SpeedScaling()` / `StandardAnalogOutput(n)`.
- **`ur_run_program` / `ur_stop_program` / `ur_pause_program` ignored the answer**: dashboard replies like "could not understand / not allowed / failed" used to count as success. They now report only "dispatched" and **include the running state** so the caller has something to judge by.
- **Dashboard fields in `ur_status` could all be stale**: every field now goes through a fresh-answer read, and an unreadable field is marked `<查询失败>` instead of passing an old value off as current.
- **NaN / Infinity could reach the controller**: JSON permits `NaN`, `float("nan")` passed every check, and `movel(p[nan,…])` went out. On the way back Python writes non-finite values as `NaN` — not legal JSON — so Node's `JSON.parse` threw and `_onLine` **dropped the line silently**, leaving the caller with a generic "timed out". All numeric entry points now reject non-finite values and `respond()` uses `allow_nan=False` to fail loudly.

### Added — UR capability (14 tools, 53 → 67)

- **Freedrive / teach mode**: `ur_set_freedrive`, `ur_set_teach_mode` (move the arm by hand; how to exit is spelled out in the description). Implemented with a never-ending URScript program, which is what `freedrive_mode()` semantics require, and which avoids the URBasic wrapper blocking a single-threaded worker.
- **Power and brakes**: `ur_power_on`, `ur_power_off`, `ur_brake_release`, and `ur_shutdown` (controller power-off). Each carries a ⚠️ note about its physical consequence (loss of rigidity, possible fall under gravity).
- **Protective-stop unlock only**: `ur_unlock_protective_stop` — unlike `ur_reset_error` it does **not** power on or release the brakes (the latter can set the arm moving); it re-reads the safety status bits afterwards and returns them.
- **Live telemetry**: `ur_get_runtime_telemetry` returns joint currents/voltages/speeds, TCP speed and wrench, tool accelerometer, speed scaling, robot voltage/current and joint temperatures in one call. **These fields are already in the 500 Hz RTDE stream** (`URBasic/rtdeConfiguration.xml`), so reading them is free and needs no reconfiguration — no tool had ever exposed them. Plus the focused `ur_get_speed_scaling` and `ur_get_tcp_force`.
- **Installation and I/O configuration**: `ur_set_gravity` (gravity direction for non-horizontal mounting, normalised, zero vector rejected), `ur_zero_ftsensor` (zero the force/torque sensor), `ur_get_tool_analog_in` (tool analog input; the function name was confirmed against the repository's official script manuals, but the **argument semantics are not verified on hardware** — it reports likely causes and allows a different read-back register when it cannot read).
- **Conveyor tracking**: `ur_set_conveyor_tracking` (`linear` / `circular` / `stop`); previously only the tick counter could be read or written.

### Added — digital twin (panel and routes)

- **Failure reasons are finally visible**: host failure responses now carry a machine-readable `code` (`no_robot` / `robot_not_connected` / `ambiguous_robot` / `worker_unavailable` / `robot_error`), echo the `ip` that was resolved, and list the candidate `ips` when ambiguous. The client used to render one fixed "not connected" line, so "the worker process is gone", "you have not connected yet" and "two robots are connected, pick one" looked identical (and the ambiguous case would poll forever). Each now maps to distinct wording and advice.
- **`detail=1` slow channel**: adds the dashboard-side state (safety mode, robot mode, program state, running, speed scaling, joint temperatures/currents). The pose channel keeps polling independently at 10 Hz, and a failing detail query **never** takes the pose channel down.
- **`/dsh-nonead-ur/twin/models`**: lists the GLBs actually present, so "the robot reports a model we have no asset for" is no longer a silent fallback.
- **Asset caching**: GLB responses carry a content-hash strong `ETag` plus `immutable`, and honour `If-None-Match` with a 304. Closing the panel releases the model handle, and without validators **every reopen re-downloaded and re-parsed 1.5-3.5 MB**.
- **State responses are uncacheable** (`Cache-Control: no-store`, and the client fetches with `{cache:'no-store'}`): a cached pose is worse than no pose.
- **Robot model memoised per IP**: the twin's 10 Hz poll used to ask for the robot model (a Dashboard round trip) **every time**, although the name cannot change while the connection lives. The host caches it now and invalidates on reconnect.

### Fixed — digital twin client

- **Every panel open leaked a WebGL context**: three's `renderer.dispose()` does **not** release the context (it only drops internal caches and removes its own context-lost listeners), and the panel creates a fresh canvas + renderer on each mount. Browsers cap live contexts at around 16 before evicting the oldest ⇒ the twin, or another WebGL view such as the task board, goes black. `dispose()` now calls `renderer.forceContextLoss()`, releases the never-released `GridHelper` geometry/material, and listens for `webglcontextlost` / `webglcontextrestored` to report a GPU reset honestly.
- **Blurry on HiDPI displays**: `setPixelRatio` was never called (three defaults to 1). It now follows `devicePixelRatio` (capped at 2). A `ResizeObserver` was added too: the right dock is user-resizable while `window.resize` never fires for it, so the canvas used to be stretched by CSS until the window changed.
- **A 0×0 canvas measurement was never retried**: a freshly opened panel may not have resolved its flex height yet, and the old code simply skipped — forever — leaving the canvas at its default backing store, stretched by CSS. It is now flagged and retried every frame.
- **Without WebGL the panel was a permanent fake "loading" plus an unhandled rejection**: `new WebGLRenderer` threw outside any try/catch, turning into an unhandled promise rejection while the status line stayed on "loading model…" and the canvas stayed blank. It now degrades to a **numeric-only mode** (joints and TCP keep updating) and says why.
- **The trajectory buffer filled up with duplicate frames**: `pushTrajectorySample()` ran **every frame** (60 fps) while sampling is 10 Hz ⇒ the same `ts` was pushed about six times, so the 600-point capacity held only ~100 real samples (≈10 s instead of the documented 60 s) and rebuilt ~600 arrays per frame. It is now pushed only on a new sample, with a regression test.
- **The numeric panel showed interpolated values**: the joint row displayed the value computed to smooth the mesh while the TCP row used the raw sample, so the rows had different time bases (up to one sample period plus the render delay). Both now use the **measured sample** (interpolation serves the mesh only), and the rows carry a `title` so J5/J6 are readable despite the ellipsis.
- **TCP orientation was mislabelled as RPY**: `rx/ry/rz` is UR's **axis-angle rotation vector** (direction = axis, magnitude = angle in radians), not roll/pitch/yaw. The HUD now says `TCP(m/axis-angle rad)`.
- **The status line ignored changing failure reasons**: while disconnected, `applyConnection` returned early, so when the host's reason changed (say from "never connected" to "worker is gone") the UI kept showing the first one.
- **An in-flight request could not be cancelled**: `stop()` only cleared the timer, so an issued request still ran to completion (up to the command timeout). It is now aborted via `AbortController`, distinguishing a deliberate cancel (no error snapshot) from a real failure.

### Added — engineering hygiene

- **`npm test` now actually runs the tests** (it used to run one worker ping; the other 20-plus `*.test.mjs` files — client polling state machine, FK, model contract, twin routes, vendored-library defects — **were not run at all**, so a green `npm test` said nothing about the plugin). The new `scripts/run-tests.mjs` enumerates and runs all 21 files and summarises; `test/selftest.mjs` became a real `test/selftest.test.mjs` (end-to-end protocol self-check including a graceful-shutdown case — **which is exactly what caught the op-name collision above**).
- **`test/vendored-fixes.test.mjs` + `test/ur-python-harness.py`**: pin every vendored defect fixed here as a **behaviour** gate (not "is that code present in the source"). The probe deliberately uses **real loopback sockets** instead of fakes: `__sendPrg` goes through `select.select`, which only accepts real fds, so a fake object would raise "argument must be an int" and bypass the very path under test.
- **`test/tool-schema-dsl.test.mjs` grew cross-language contracts**: every host op must exist in Python's `HANDLERS`; an op name must not collide with a dashboard command; one op may not back two tools; tool names must be unique.
- **Dead code removed**: `src/client/sidebar-entry.js` and `src/client/thumbnail.js` were no longer in the build graph (0.4.1's changelog already said "deleted", yet the files and their tests remained, making coverage look better than it was).
- **`scripts/build-client.mjs` prefers the standalone esbuild binary**: the JS API validates that the JS package and the platform binary **share a version**, and this checkout has them out of sync (JS 0.25.12 / binary 0.25.0) ⇒ `Cannot start service`, and the build simply failed. The standalone binary needs no pairing; banner/footer are passed as inline text (the CLI's `--banner:js=` takes text, not a file path), with the JS API kept as a fallback.
- **`scripts/check-host-compat.mjs` prefers a real DSH installation**: this repository's own `node_modules` also contains an (older, devDependency) `@deepseek-ai/dsh-tools`, and validating the DSL and peer versions against it yields misleading conclusions. Against the real install the check now reports **67/67 tools registering through the host's real DSL**. The expected counts were updated to 67 tools / 3 routes.

### Changed

- **Every new tool with physical consequences joined the human-approval gate**: `set_freedrive` / `set_teach_mode` / `power_on` / `power_off` / `brake_release` / `unlock_protective_stop` / `shutdown` / `zero_ftsensor` / `conveyor_tracking` — each can take the arm out of program control or remove its rigidity.
- **Long-running operations reserve headroom in their budget** (`_budget_ms`): Node's timeout starts when the request is written, so making both equal means a genuine timeout shows only Node's generic "timed out" instead of the worker's more specific reason.
- **A failed send is no longer a success**: `op_send_script`, the four drawing ops, digital and analog outputs, `set_tcp`, `set_payload` and friends now check that the script actually left, answering `SEND_FAILED` with the reason when it did not.
- **`_CappedLog` is thread-safe**: the RTDE, Dashboard and RealTime receiver threads all print directly, and a `_roll()` could close the handle in the middle of another thread's `write()` ⇒ that thread raised `ValueError` and died (and a dead RTDE thread means `isRunning()` is false forever).
- **Full tracebacks for unexpected exceptions**: `traceback.format_exc(limit=1)` kept only the last frame, so a library-internal `AttributeError` lost all context; the protocol line is now a readable summary plus a stable error code.

### Known items (stated honestly)

- **`scripts/twin-contiguity-check.py` (formerly the hidden `.twin-contiguity-check.py` at the repository root) chained its matrices in the wrong order**: it composed the DH segment as `R·Trans`, whereas the real renderer (`src/client/robot/fk.js`'s `poseToMatrix4()` = URDF `<origin>` semantics) uses **`Trans·R`**. The two differ by about **0.18 m** on `links[4]`/`links[5]` (where rpy and xyz are both non-zero) — so its PASS/FAIL had nothing to do with what the client actually draws. It now uses `Trans·R` and lives under `scripts/` (a hidden script in the repository root invites being mistaken for project configuration).
- `python/sitecustomize.py` is a **machine-local shim** (it hardcodes this machine's user-level site-packages path). It works only because `lib/worker.js` points `PYTHONPATH` at the plugin's `python/` directory and CPython imports `sitecustomize` from there at startup. **On another machine, or from a published install (the file is not in the `files` list), `import numpy` fails and every tool call dies.** The right fix is to install the dependencies for the interpreter the worker uses (`pip install -r requirements.txt`) or point `pythonBin` at a venv; `ur_ping` / `--selfcheck` is the self-check for that chain. This release does **not** delete the file (it belongs to the local environment) but documents it here.
- **The tool-side I/O and analog-output read-back used function names that do not exist in the manual (silent failure, not a missing feature)**: the repository carries UR's official script manuals (`ScriptManual/script_directory_Poly5.pdf`, `..._PolyscopeX.pdf`), and checking them one by one turned up **three names in the vendored code that appear nowhere in the manual**:
  - `get_tool_digital_in()` sent `write_output_int_register(0, read_tool_digital_in(n))` — **neither name exists** (the manual has `write_output_integer_register` and `get_tool_digital_in`). The controller rejects the whole script, and the method then **reads back a stale value from register 0 and reports it as the input level**.
  - `set_tool_digital_out()` sent `write_tool_digital_out(n, value)` — the manual has `set_tool_digital_out(n, b)`. The result: **the digital output was never set, yet the tool reported success**.
  - `get_standard_analog_out()` read `RobotModel.StandardAnalogOutput0` / `...1` — **neither attribute exists**, so it always raised `AttributeError`; and the `n == 1` branch put its `return` inside `if wait:`, returning `None` when `wait=False`.
  All three now use the manual's real names. This also showed that `get_tool_digital_out` *does* exist in the manual, so the earlier conclusion "tool digital outputs cannot be read back" was wrong — the read-back is implemented.
- `python/sitecustomize.py` is a **machine-local shim** (it hardcodes this machine's user-level site-packages path). It only works because `lib/worker.js` points `PYTHONPATH` at the plugin's `python/` directory and CPython imports `sitecustomize` from there at startup. **On another machine, or from a published install (the file is not in the `files` list), `import numpy` fails and every tool call dies.** The right fix is to install the dependencies for the interpreter the worker uses (`pip install -r requirements.txt`) or point `pythonBin` at a venv; `ur_ping` / `--selfcheck` is the self-check for that chain. This release does **not** delete the file (it belongs to the local environment) but documents it here.
- `ur_get_tool_analog_in` and `conveyor_tracking` (function names and argument semantics) are **not verified on hardware**: the function names were confirmed to exist in the repository's official manuals, but the **argument semantics and on-hardware behaviour** have not been exercised on URSim or a real robot. Both **report failure honestly** with likely causes when they cannot complete, instead of returning a stale value or pretending success. Validate on URSim or a real robot before production use.
- `jointLimits[5]` is `null` for `ur3`/`ur3e` in `assets/kinematics.json`, so a J6 limit warning is not possible for those two models without new data.

## [0.4.1] - 2026-09

### Changed
- **Deleted the no-longer-assembled left/centre modules**: `sidebar-entry.js` (left-sidebar entry row + centre-column view + the `dsh-panel-activate` protocol) and `thumbnail.js` (thumbnail 3D) went away with the "right sidebar only" change; the mutation hub they shared now lives in its own `mutation-hub.js` (behaviour unchanged, still a global singleton).
- **The digital twin moved to the right sidebar**: the entry is now a card in the right sidebar's Start panel, directly below the "Workspace files / New terminal / Browser" cards, and selecting it shows the 3D view inside the right sidebar. The former left-sidebar entry row, its thumbnail view, and the center-column overlay are no longer used.

### Fixed
- **`ur_send_script`'s execution check could report a false success — worse than not verifying, because it fabricates evidence**: the first version appended the sentinels at the **top level** (`<start> + script + <finish>`). Measured on the real robot: wrapping a `def dance(): … end` + top-level call that way turns the submission into a shape where **the function body never runs while the top-level statements do** — DO3 was never set, yet both sentinel lines were read back, so the tool answered "ran to completion in 0.0 s". Now any script containing a `def` gets its sentinels injected **inside the function body** (first and last statement; blocks are paired by depth so nested if/while cannot capture the function's `end`), and they are **never** placed at the top level; when several functions are defined and no top-level call identifies one, it **refuses to verify** (script sent verbatim, `verified: null`, with the reason). Pure-statement scripts (the plugin's own movej/movel shape) still use top-level injection, where top-level statements execute anyway. The result now carries `injection` (`mode` / `function` / line numbers) so the injection point can be audited. The regression test reproduces the "top level only, function body never runs" semantics with a fake controller and demonstrates that the old shape must produce a false positive.
- **`ur_send_script` used to report success it could not know about**: `RealTimeClient.SendProgram()` is one-way — the controller sends neither an ACK nor the URScript runtime error back — and the old implementation answered with nothing but "script sent, please confirm the result". A model reads that as "the motion happened", while in reality **not a single line may have run** (in local/teach-pendant mode URScript is discarded by design, and a script that errors on the controller aborts). The tool now injects a `write_output_integer_register(N, token)` line before *and* after the script and reads that register back, so the answer is one of three: **ran to completion** / **started but never reached the end** / **not even the start sentinel appeared (≈ the controller never executed it, with the most likely cause named)**. `verified` is `true`/`false`, and `null` when `verify=false` — "unconfirmed", not "success". Sentinel register defaults to int output register 23 (override with `register`; note its previous value is overwritten).
- **`remote_control` probing is tri-state now**: the old code collapsed "could not ask" and "asked, got false" into the same `false`, so the tool told users of a robot in an unknown state to "enable Remote Control in PolyScope" — an assertion built on unknown information. `_remote_control()` now returns `True` / `False` / `None` (unknown); `ur_connect` mentions the mode only on an explicit false (for CB3 3.1–3.20 it distinguishes "enabled at the settings level by default" from "currently not in remote mode, where commands are silently dropped"), and says "unknown" when it is unknown. `ur_status` also reports `remote_control_raw` for diagnosis.
- **Removed the defunct input section from the recipe**: `rtdeConfiguration.xml` now declares only the `receive` (output) recipe; the whole `<send>` section is gone. Every write goes over URScript and needs no input claim, while the upstream reconnect branch calls `__setupInput()` on **every** reconnect attempt — a non-empty input recipe would turn the controller's "parameter already in use" rejection into a loop (and that rejection surfaces from `__decodePayload` and crashes the whole worker). With no input section it is just an empty request.
- **Black twin even with the robot connected (no `model`/`q`/`tcp`)**: `lib/twin-routes.js` read the op result one level too shallow (`jp.joint_positions`), while the real envelope is two levels deep — a response is `{id, ok, data: <op return value>}` and each op returns `{message, data:{…}}` (`ur_worker.py`'s `ok()` returns the dict it is handed **as-is**), and `UrWorker.call()` resolves with the response's `data`, so the actual payload sits one level further down at `.data`. `model`/`q`/`tcp` therefore stayed empty: the twin showed a black canvas whether or not a robot was connected, and the pose had nothing to sync to. The route now reads `.data`, and `test/twin-routes.test.mjs`'s fake worker was updated to the **real envelope shape** (it used to fabricate a flat object, which is why this stayed green), with a new reverse guard asserting a flat payload is not treated as data.
- **Unbounded worker log + a tight RTDE reconnect loop**: `rtde.py`'s reconnect-failure branch printed on **every** iteration without sleeping, which on a downed link is tens of thousands of lines per second; the local `python/ur_worker.log` had grown to **277 MB / 10.76 M lines** (`RTDE reconnection failed!` alone) while spinning the CPU. That branch now throttles to **one line per 5 s** and calls `time.sleep(0.5)`; `ur_worker.py` adds a writer-independent hard cap on top: past 8 MB the log rolls to `ur_worker.log.1` (one generation only ⇒ disk stays within ~2× the cap). **The same defect has a second site**: `DashboardClient.__send` in `dashboard.py` — when the socket is dead `select.select` raises immediately and the `except` prints `"Could not send program!"` unconditionally; one measured session produced **296,644 such lines** and pushed the log to its 8 MB cap while spinning the CPU. It is now throttled to one line per 5 s with `time.sleep(0.2)` as well. Note also that the recipe's empty input side is what keeps this branch — which calls `__setupInput()` on every reconnect — from repeatedly claiming input variables (that would hit the upstream "parameter already in use" crash).
- **World frame now coincides with the robot base frame**: `GridHelper` lies in the XZ plane by default (three.js's Y-up habit, normal +Y), while every link pose is a **base-frame** FK result (UR's base plane is XY with Z up) — different planes and mismatched axes, which showed up as a grid that read like a vertical wall with the base poking through it. The grid is now rotated +90° about X onto the **XY plane (z = 0)** and `camera.up` is set to **+Z**, so the **base plane coincides with the grid plane and the base X/Y/Z coincide with world X/Y/Z** (`createBaseGrid()` in `scene.js`).
- **CB3 robots are no longer told to enable Remote Control**: `ur_connect` used to say "not in remote control mode, some motion commands may not execute" whenever the dashboard read `false`. But **CB3 robots running URSoftware 3.1–3.20 allow remote control by default with nothing to enable**, so that advice was wrong for that firmware. It now branches on `polyscopeVersion`: inside that range it states that remote control is enabled at the settings level by default (nothing to enable) **and that a `false` reading means the controller is currently not in remote mode, where commands are still dropped silently**; other firmware (e-Series, or CB3 outside the range) still gets the PolyScope instruction. (The wording was calibrated again against a real robot — see the tri-state entry above.)
- **A stuck connection no longer needs a manual restart**: `UrScriptExt(...)` construction waits for RTDE data readiness (`urScript.py`'s 20×1 s), on top of the rtde / realTimeClient reconnect loops that each run up to 60 s. When the controller still holds an unreclaimed RTDE session from a previous attempt — it accepts one client at a time — construction can fail to return for tens of seconds and every later call piles up behind it. `ur_worker.py`'s `_connect_or_exit()` now gives construction a hard budget (`CONNECT_TIMEOUT_S = 20 s`, never more than the request's own `_timeout_ms`), writes back an error that names the cause and calls `os._exit(1)`: process exit is the only reliable way to release those half-built sockets. The existing `lib/worker.js` behaviour takes over from there — the exit fails every in-flight request and the **next call** respawns a clean process after a 500 ms backoff, so one retry is all the caller needs.
- **Releases no longer carry `python/sitecustomize.py`**: that file is a machine-local interpreter shim (hardcoded local paths). The plugin's own `files` deliberately omits it, but both desktop editions packed the whole `python/**` directory. Both electron-builder `files` configs now exclude it explicitly.
- **The digital twin placed every joint wrong** (plainly visible on a real UR3: the links came apart and sat off their joints): `loader.js`'s `assemble()` chained the 7 assembly groups as parent/child, while `applyFK()` writes the **absolute** base→link transform into each group's **local** `matrix` — so three.js composed the ancestor chain in `matrixWorld` and every link after the shoulder got its predecessors' transforms applied again. Each mesh's geometry is authored in **its own link frame** (Ruling 37 bakes the official `ur_macro.xacro` visual origins into the meshes), so the six link groups are now **direct children** of the motion root (identity). Measured across 14 models × 3 poses: worst adjacent-link gap 0–1.3 mm against 40–108 mm limits.
- **`self.hasattr` typo in `rtde.py`**: `setData()`'s list branch read `self.hasattr(self.__rtde_input_config.names, ...)`, a method `RTDE` does not define — and `hasattr` on a list is wrong anyway. It now uses the scalar branch's semantics, `variable_name[ii] in self.__rtde_input_config.names`.
- **Every RTDE write crashed** (`ur_set_digital_out` and friends died with `AttributeError: 'NoneType' object has no attribute 'names'` on a real robot): the plugin used to write outputs through `RTDE.setData()`, which requires the controller to have **claimed RTDE input variables** first — and the vendored `rtde.py` ships its `__setupInput()` call commented out, so `SETUP_INPUTS` was never sent and `__rtde_input_config` stayed `None`. **Writes now go over URScript** (`RealTimeClient.Send("set_standard_digital_out(...)")` and friends, matching the existing tool / analog / payload / TCP paths), so no RTDE input claim is needed at all. Avoiding input claims is deliberate: UR controllers reject a second `SETUP_INPUTS` for an already-claimed variable (`An input parameter is already in use.`), and that rejection surfaces from `__decodePayload` in the RTDE thread and **crashes the whole worker**, after which the session cannot be re-established until the controller releases the claim. (An earlier attempt that shipped an input recipe and re-enabled `__setupInput()` is superseded by this cleaner path.)
- **The plugin's RTDE recipe now serves the receive side only, with an intentionally empty input side**: `python/URBasic/rtdeConfiguration.xml` (resolved by `rtde.py` before the vendored default) keeps int/double registers 0..23 and enables `output_bit_registers32_to_63`, while its `<send>` section declares **zero fields** so that no `SETUP_INPUTS` — including the upstream reconnect branch's call — can claim an input variable.
- **`ur_get_bit_register` returned null for indexes 32–63**: the receive recipe enabled only `output_bit_registers0_to_31`, and `RobotModel.OutputBitRegister()` fills 32–63 only when `output_bit_registers32_to_63` is present. The new recipe enables it.
- **`ur_set_digital_out` with `which="config"` raised `struct.error` for ports 8–15**: URBasic numbers the eight configurable outputs 0–7 internally (it builds the mask as `2 ** n`), while the tool uses UR's global I/O numbering 8–15, so `n = 8` produced 256 (`'B' format requires 0 <= number <= 255`). The call now converts to URBasic's index.
- **`ur_list_programs` never returned a result**: its local `err` shadowed the module-level `err()` helper, so the error branch called a string.
- **The client half could never activate**: `resolveRobotIp()` read `ctx.config` / `ctx.options`, but the cordis context proxy throws `cannot get property "config" without inject` for properties the plugin does not declare through `inject`. That read sat outside `apply()`'s `try`, so the entry's fiber ended FAILED and the renderer reported only "1 plugin(s) did not activate", with no cause. Configuration now comes from the second `apply(ctx, config)` argument.

## [0.4.0] - 2026-09

### Fixed
- **Registration reports real results**: `apply()` now counts successful `ctx.tools.register` calls and lists every failed tool with its reason, instead of printing a hardcoded tool count — a partially registered tool set can no longer look healthy in the log. A total failure distinguishes a worker-init error from a host without a `tools` service or a changed `ctx.tools.register` API.
- **Peer ranges accept the current harness**: `@deepseek-ai/dsh` and `@deepseek-ai/dsh-tools` are declared as `^0.1.2-rc.1 || ^0.1.7-rc.2`. The previous `^0.1.2-rc.1` does not match `0.1.7-rc.2` (a prerelease range only matches its own version tuple), so a strict peer check rejected exactly the runtime this plugin is built for.

### Added
- **`scripts/check-host-compat.mjs`**: validates this plugin against an installed host in one command — peer ranges, every tool parameter schema through the host's real value-schema DSL, the `dsh.client` declaration, and the client bundle's registration id. Run it after bumping the tested harness family.
- **Read-only 3D digital twin**: a sidebar thumbnail and a center-column large view (three.js) sharing a single polling state source, live-syncing the robot's joint poses, tool (TCP) coordinate frame and recent motion trajectory. The twin is strictly read-only and never sends a command to the robot.
- **Host read-only twin routes**: `/dsh-nonead-ur/twin/state` and `/dsh-nonead-ur/twin/asset`, both fenced to loopback callers (`localhost` / `[::1]` / `127.0.0.0/8`).
- **Bundled robot meshes**: 14 official UR visual meshes converted to `assets/models/*.glb` (≈35 MB) and shipped with the package, together with `assets/kinematics.json`; the licence split is documented in `THIRD_PARTY_NOTICES.md` (9 models BSD-3-Clause, 5 models UR Graphical Documentation). `assets` is part of the published `files` list, and a `verify:models` script validates the GLB structure contract.
- **`three` as a build-time dependency** (`devDependencies`), used by `scripts/build-client.mjs` to build the client bundle.

## [0.3.9] - 2026-09

### Fixed
- **16 tools vanished under DSH 1.5.3**: tool parameter schemas used JSON-Schema numeric constraints (`minimum` / `maximum` / `exclusiveMinimum`), which the value-schema DSL no longer accepts, so every affected tool failed to register entirely — silently, because the closing log line printed a hardcoded `registered 49 tools`. Re-measured on a host that still rejects those keywords: 33/49 tools registered and 16 registrations failed (`ur_movej`, `ur_movel`, `ur_movep`, `ur_movec`, `ur_servoj`, `ur_draw_*`, and the register / I/O tools). The constraints are gone; the ranges now live in the tool descriptions and, authoritatively, in `python/ur_worker.py` (`_nonneg_float` / `_bounded_int` / `_bounded_float`).

### Added
- **`test/tool-schema-dsl.test.mjs`**: drives the real `apply()`, captures the real tool definitions, validates every parameter schema against the value-schema DSL vocabulary, and asserts all 49 tools register — with a self-check proving the test is not vacuous.

## [0.3.8] - 2026-09

### Changed
- **Unified remote-control probe**: extracted `_remote_control(d)` and used it in `op_connect` / `op_status` / `op_get_robot_model` so the three places agree on what counts as remote (only an exact `"true"`; error-like or failed probe -> not remote) instead of three hand-written copies.
- **Description sync**: `ur_get_robot_model` description now mentions the `remote_control` field it returns.

## [0.3.7] - 2026-09

### Fixed
- **worker.js abort timer cleanup**: `call()`'s `onAbort` now calls `clearTimeout`, so an aborted request no longer leaves a stray timeout that later fires a no-op reject (a minor leak / untidiness).
- **`op_status` distinguishable read failures**: a failed `dash()` query returns a `"<查询失败>"` marker instead of an empty string, so a field that could not be read is not mistaken for a genuinely empty value.

## [0.3.6] - 2026-09

### Robustness
- **Motion/drawing parameter validation**: added `_nonneg_float` to reject negative/zero motion and drawing parameters (the controller treats negative speed/acceleration and reversed geometry as invalid):
  - `movej` / `movel` / `movep` / `movec`: `a` (acceleration) and `v` (speed) must be >0; `t` (time) and `r` (blend radius) >=0.
  - `draw_circle` / `draw_square` / `draw_rectangle` / `draw_star`: `r` / `border` / `width` / `height` / `side` must be >0.
  - `servoj`: `lookahead_time` 0.03-0.2, `gain` 100-2000, `t`>=0.
- **Tool-definition schema constraints**: added `minimum`/`exclusiveMinimum` on `MOVE_PARAMS`, `movep`/`movec`, `servoj`, and `draw_*` parameters so the model sees the limit before calling.

## [0.3.5] - 2026-09

### Fixed
- **Vendored URBasic operator precedence**: `RobotModel.DigitalInputbits` / `ConfigurableInputBits` / `DigitalOutputBits` / `ConfigurableOutputBits` used `n >= 0 & n < 8`, which Python parses as a chained comparison and mis-returned True for out-of-range n=8/15. Changed to `0 <= n < 8` (and `8 <= n < 16`) so out-of-range returns None.
- **`urScriptExt.get_in` signature mismatch**: the `BCI` branch passed `wait` to `get_configurable_digital_in`, which only accepts `n`; removed it so it no longer raises `TypeError`.
- **`urScriptExt.set_output` empty branches**: `BCO`/`BDO` now `return True`; `TDO` (tool digital output) now calls the implemented `set_tool_digital_out`; `BAO` (analog out) raises `NotImplementedError` instead of silently passing.
- **`_right_pose_tcp` compared only the first 3 dims**: arrival confirmation now compares the full 6-D pose (position + orientation), with a 0.010 m position tolerance and a 0.05 rad orientation tolerance.
- **`ur_set_analog_out` crash**: it called the URBasic `set_standard_analog_out` stub (raised `NotImplementedError`); now sends the URScript `set_analog_out` command directly.
- **`_program_running` disconnect tolerance**: a failed dashboard probe no longer crashes the single-threaded worker (returns False so the confirm loop reports a clear outcome).

### Robustness
- **Argument range validation**: added `_bounded_int` for register indices (int/double 0-23, bool 0-63) and I/O port numbers (std 0-7, config 8-15, tool 0-1, analog 0-1); also added JSON-schema `minimum`/`maximum` on `index`/`n` in the tool definitions. Out-of-range or non-int values return a clear error instead of a KeyError.
- Removed untracked `debug.log` and `Release/*.tgz`.

## [0.3.4] - 2026-09

### Fixed
- **`ur_get_digital_in` with `which="std"` crashed**: fixed a vendored-URBasic method-name case error — `get_standard_digital_in` called the non-existent `RobotModel.DigitalInputBits` (uppercase B, raising `AttributeError`), while the actual definition is `DigitalInputbits` (lowercase b). Aligned the call with the definition so standard digital input reads work again. Found on a real UR3.

## [0.3.3] - 2026-09

### Added
- **Tool digital I/O**: implemented and wired the `which="tool"` branch of `ur_get_digital_in` / `ur_set_digital_out` on top of the vendored URBasic:
  - `get_tool_digital_in`: tool digital inputs are not carried by RTDE, so run the URScript expression `read_tool_digital_in(n)` (via `SendProgram`), stash the result into `output_int_register_0`, and read it back over RTDE (same pattern as `get_conveyor_tick_count`). Verified on a real UR3 — reads a correct boolean.
  - `set_tool_digital_out`: send the URScript command `write_tool_digital_out(n, v)` over the RealTime client. Verified on a real UR3 — set/clear accepted.
  - `get_tool_digital_out`: remains a stub with a clarifying note (no reliable `read_tool_digital_out` read-back expression), controllable only via `set_tool_digital_out`.

### Changed
- The `ur_get_digital_in` tool description now notes that `which="tool"` reads by sending a short URScript program, which may interrupt a running program.
- The previous `which="tool"` branches changed from "not implemented" hint to the real implementation.

## [0.3.2] - 2026-09

### Fixed
- **Conveyor tick read crash**: `get_conveyor_tick_count()` inside `ur_get_conveyor` fixed two vendored-URBasic defects — the URScript now writes via `write_output_double_register(0, …)` (it used `write_output_float_register`, but the RTDE config only exposes `output_double_register_0`, so the float value never read back and always returned 0); the Python side now reads via `RobotModel.OutputDoubleRegister(0)` (it used the non-existent **lowercase attribute** `outputDoubleRegister[0]`, raising `AttributeError: 'RobotModel' object has no attribute 'outputDoubleRegister'`).
- **`ur_get_robot_model` model corruption**: the remote-control probe reused `d.last_respond`, overwriting the model string, and on a successful probe it appended a stray `"e"` to the model (e.g. `UR5` → `UR5e`). `robot_model` now returns the clean model and the remote-control state is returned separately as `remote_control`.
- **Motion-confirmation semantics**: `_movej_confirm` / `_movel_confirm` now honestly report **not-arrived (`ok=False`)** when the robot repeatedly stops off-target and is not running a program, instead of falsely reporting success ("移动结束（位置存在偏差）"); a failed joint/TCP read is also reported explicitly rather than silently `break`-ing.
- **`ur_list_programs` connection error**: a failed SSH connection now returns a clear Chinese message (checking the SSH service and username/password) instead of surfacing a raw exception and misreporting "0 programs".

### Robustness
- **Vector argument validation**: a new `_vec` helper validates the dimension of joint/pose vectors across `movej`/`movel`/`move_x|y|z`/`draw_circle|square|rectangle|star`/`set_tcp`/`set_payload`/`movep`/`movec`/`servoj`, returning a clear error on wrong length, non-numeric, or missing values instead of emitting malformed URScript or an out-of-range index.
- **Worker crash backoff**: `worker.js` now honors `restartDelayMs` (previously declared but never used), so a worker that exits on startup cannot spin in a tight crash loop.
- **Worker spawn/exit race**: `call()` distinguishes "writable / not writable / process already exited" before writing and reports each clearly, rather than silently dropping the request.

## [0.3.1] - (2026-09)

### Fixed
- **Security**: `ur_load_program` is now part of the motion approval gate (`APPROVAL_OPS`), and `program_name` / `programs_dir` are validated against a whitelist (rejecting control characters and shell/URScript metacharacters), closing the `load <file>\nplay` injection path that previously bypassed human approval.
- **Security**: `ur_list_programs` now passes `programs_dir` through `shlex.quote` before building the `find` command, eliminating the remote shell injection over SSH.
- **Usability**: removed `ur_get_inverse_kin`, which always returned `NotImplementedError` (the URBasic base implementation is an empty stub); rewrote `ur_set_payload` to send `set_payload_mass` / `set_payload_cog` URScript directly (it previously hit the same stub).
- **Robustness**: the JS side now forwards `_timeout_ms` to the worker, and Python's `_movej_confirm` / `_movel_confirm` / draw completion confirmation are all **bounded by a timeout**, so the single-threaded worker can no longer be blocked forever by a motion loop that never returns.
- **Behavior**: `ur_draw_*` now performs a bounded completion confirmation before returning, instead of prematurely reporting "sent"; `ur_get_digital_in` with `which="tool"` (not implemented in URBasic) now returns an explicit error telling the caller to use `std` / `config`.

### Changed
- Tool count reduced from 50 to 49 (removed `ur_get_inverse_kin`).

## [0.3.0] - 2026-09

### Added
- **More tools**:
  - `ur_movep` (path move), `ur_movec` (circular move), `ur_servoj` (continuous-servo joint target, single-step online control).
  - `ur_get_digital_in_bits` / `ur_get_digital_out_bits` (**bit-mask** reads of digital in/out, std0-7 + config8-15).
  - `ur_get_conveyor` / `ur_set_conveyor_tick` (conveyor tick read / set).

### Changed
- Completed release metadata: `repository` (Nonead GitHub), `bugs`.

## [0.2.0] - 2026-09

### Changed
- Renamed the plugin to `dsh-nonead-universal-robots` (all lowercase, npm-publishable) and declared a host requirement of `DSH ^0.1.2-rc.1` (`peerDependencies`).
- Plugin description: a DSH plugin to control Universal Robots arms from natural language, developed by Nonead based on the same logic as the company's own nUR MCP Server.

### Added
- **Motion approval gate**: `ur_movej/ur_movel/ur_move_x|y|z/ur_draw_*/ur_run_program/ur_send_script/ur_reset_error` now go through the DSH approval channel (`ctx.approval`) and are only dispatched after human confirmation; fail-closed when there is no approval service / no agent. Disable with `requireApprovalForMotion`.
- **More tools**: `ur_ping` (health), `ur_get_digital_in`/`ur_set_digital_out`, `ur_get_analog_in`/`ur_set_analog_out`, `ur_set_tool_voltage`, `ur_set_tcp`, `ur_set_payload`, `ur_get_inverse_kin`, `ur_draw_star` (pentagram).
- **URSim compatibility**: `ur_list_programs` supports the real robot's `/programs` and URSim `~/URSim_Linux-*/programs.*`; `ur_load_program` / `ur_run_program` support full/URSim paths and `programs_dir`.
- **Testing**: worker `--selfcheck` mode and `npm test` / `npm run test:python`.

### Fixed
- Fixed URBasic/RTDE returning **numpy data that could not be JSON-serialized** (the worker's `_json_default` recursive conversion).
- Fixed **Chinese Windows stdout being GBK**, which corrupted the protocol pipe with `UnicodeEncodeError` (now writes UTF-8 bytes to `stdout.buffer`).
- Fixed the dashboard `load` raw-response lag that made load results unreliable (now uses `ur_get_loaded_program` for authoritative confirmation).
- Fixed numpy values being interpolated into `message` in `ur_get_joint_temperatures` / `op_status`.
- Fixed worker process management: first-call/spawn race, environment scrubbing, auto-restart on crash.

### Enhanced
- Added a `remote_control` field to `ur_get_status` to help diagnose whether the robot is in remote-control mode.
- worker.js scrubs the child process environment (drops `DSH_*` and credential-like variables).

## [0.1.0] - 2026-09

- First release: `ur_*` control tools for connection/status/pose/registers/motion/drawing/programs/scripts.
- Reuses the vendored `URBasic` and the same-source logic of Nonead's nUR MCP Server, packaged as DSH-native tools.

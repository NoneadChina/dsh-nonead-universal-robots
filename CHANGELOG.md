# Changelog

This project adheres to [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

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

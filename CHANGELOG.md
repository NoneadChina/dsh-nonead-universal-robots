# Changelog

This project adheres to [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-09

### Added
- **More tools**:
  - `ur_movep` (path move), `ur_movec` (circular move), `ur_servoj` (continuous-servo joint target, single-step online control).
  - `ur_get_digital_in_bits` / `ur_get_digital_out_bits` (**bit-mask** reads of digital in/out, std0-7 + config8-15).
  - `ur_get_conveyor` / `ur_set_conveyor_tick` (conveyor tick read / set).

### Changed
- Completed release metadata: `repository` (Nonead GitHub), `bugs`.

## [0.3.1] - (2026-09)

### Fixed
- **Security**: `ur_load_program` is now part of the motion approval gate (`APPROVAL_OPS`), and `program_name` / `programs_dir` are validated against a whitelist (rejecting control characters and shell/URScript metacharacters), closing the `load <file>\nplay` injection path that previously bypassed human approval.
- **Security**: `ur_list_programs` now passes `programs_dir` through `shlex.quote` before building the `find` command, eliminating the remote shell injection over SSH.
- **Usability**: removed `ur_get_inverse_kin`, which always returned `NotImplementedError` (the URBasic base implementation is an empty stub); rewrote `ur_set_payload` to send `set_payload_mass` / `set_payload_cog` URScript directly (it previously hit the same stub).
- **Robustness**: the JS side now forwards `_timeout_ms` to the worker, and Python's `_movej_confirm` / `_movel_confirm` / draw completion confirmation are all **bounded by a timeout**, so the single-threaded worker can no longer be blocked forever by a motion loop that never returns.
- **Behavior**: `ur_draw_*` now performs a bounded completion confirmation before returning, instead of prematurely reporting "sent"; `ur_get_digital_in` with `which="tool"` (not implemented in URBasic) now returns an explicit error telling the caller to use `std` / `config`.

### Changed
- Tool count reduced from 50 to 49 (removed `ur_get_inverse_kin`).

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

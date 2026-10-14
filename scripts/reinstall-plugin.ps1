# scripts/reinstall-plugin.ps1
#
# Install THIS workspace into the DSH profile that is currently running, using the
# `file:` spec. Run it whenever you changed the workspace and want the running host
# to pick the changes up.
#
# Why this script exists: installing by hand means pasting a very long
# `...\host-commands\<profile>\generations\<hash>\bin\dsh.cmd` path, and that hash
# changes between DSH releases. This script finds the newest one for you.
#
# Usage (PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts\reinstall-plugin.ps1
#
# Notes:
#   * `file:` installs a COPY of this directory into the profile. Editing the
#     workspace afterwards does nothing until you run this again.
#   * pnpm treats a dependency whose version did not change as "already satisfied"
#     and then SKIPS re-copying. That is why the version in package.json has to be
#     bumped before a reinstall can take effect.
#   * On Windows you may see: EPERM ... rename '..._tmp_...' -> '...' (the running
#     host briefly holds the directory). Just run the script again -- the second or
#     third run succeeds.
#   * If it fails with "timed out waiting for the writer lock", the profile has a
#     stale `package.json.lock` (its PID is dead). Check the PID, then delete that
#     file and re-run.

$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repo 'package.json'))) {
  throw "package.json not found next to $repo -- run this from the repository's scripts/ directory."
}
$version = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
Write-Host "workspace : $repo"
Write-Host "version   : $version"

$hostCommands = Join-Path $env:APPDATA 'Nonead DSH Desktop\host-commands'
if (-not (Test-Path $hostCommands)) {
  throw "DSH host-commands directory not found: $hostCommands"
}

$dsh = Get-ChildItem $hostCommands -Recurse -Filter 'dsh.cmd' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $dsh) {
  throw "No dsh.cmd found under $hostCommands"
}
Write-Host "dsh.cmd   : $($dsh.FullName)"
Write-Host ""

& $dsh.FullName plugin add "file:$repo"
$exit = $LASTEXITCODE
Write-Host ""
Write-Host "plugin add exited with $exit"

$copy = Join-Path $env:USERPROFILE '.dsh\profiles\work\node_modules\dsh-nonead-universal-robots'
if (Test-Path (Join-Path $copy 'package.json')) {
  $installed = (Get-Content (Join-Path $copy 'package.json') -Raw | ConvertFrom-Json).version
  Write-Host "installed : $installed"
  if ($installed -ne $version) {
    Write-Host "NOTE: installed version still differs from the workspace -- run this script again (EPERM is usually transient)."
  }
} else {
  Write-Host "WARNING: the profile copy is missing. Run this script again until it appears."
}

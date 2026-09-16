[CmdletBinding()]
param(
  [string]$NodePath = "C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
  [string]$PnpmCliPath = $env:npm_execpath,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$projectDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Windows Node not found: $NodePath" }
if (-not $PnpmCliPath -or -not (Test-Path -LiteralPath $PnpmCliPath -PathType Leaf)) {
  throw "pnpm CLI not found. Run this script through pnpm or pass -PnpmCliPath <pnpm.cjs>."
}

$shimDir = Join-Path ([IO.Path]::GetTempPath()) ("voxweave-pnpm-shim-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $shimDir | Out-Null
$shim = "@echo off`r`n`"$NodePath`" `"$PnpmCliPath`" %*`r`n"
[IO.File]::WriteAllText((Join-Path $shimDir "pnpm.cmd"), $shim, [Text.Encoding]::ASCII)
$env:PATH = "$shimDir;$(Split-Path -Parent $NodePath);$env:PATH"
Push-Location $projectDir
try {
  & $NodePath --version
  & $NodePath $PnpmCliPath --version
  if (-not $SkipBuild) {
    & $NodePath $PnpmCliPath run build
    if ($LASTEXITCODE -ne 0) { throw "Windows production build failed ($LASTEXITCODE)." }
  }

  $marker = Join-Path ([IO.Path]::GetTempPath()) ("voxweave-windows-smoke-" + [guid]::NewGuid().ToString("N") + ".json")
  $env:VOXWEAVE_SMOKE_TEST = "1"
  $env:VOXWEAVE_SMOKE_RESULT = $marker
  & $NodePath $PnpmCliPath start
  if ($LASTEXITCODE -ne 0) { throw "Electron smoke process failed ($LASTEXITCODE)." }
  if (-not (Test-Path -LiteralPath $marker)) { throw "Electron opened without writing the smoke marker." }
  $result = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  Remove-Item -LiteralPath $marker -Force
  if (-not $result.ok -or $result.platform -ne "win32") { throw "Unexpected smoke result: $($result | ConvertTo-Json -Compress)" }
  Write-Host "Windows Electron smoke passed: Electron $($result.electron), Chrome $($result.chrome), $($result.arch)." -ForegroundColor Green
} finally {
  Remove-Item Env:VOXWEAVE_SMOKE_TEST -ErrorAction SilentlyContinue
  Remove-Item Env:VOXWEAVE_SMOKE_RESULT -ErrorAction SilentlyContinue
  Remove-Item $shimDir -Recurse -Force -ErrorAction SilentlyContinue
  Pop-Location
}

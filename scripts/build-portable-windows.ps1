[CmdletBinding()]
param(
  [string]$NodePath = 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe',
  [string]$PnpmCliPath = 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.cjs',
  [string]$ReleaseDir,
  [switch]$KeepStage
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Run this script with Windows PowerShell.' }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Windows Node not found: $NodePath" }
if (-not (Test-Path -LiteralPath $PnpmCliPath -PathType Leaf)) { throw "Windows pnpm CLI not found: $PnpmCliPath" }

$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$stageRoot = Join-Path $sourceRoot ('.windows-stage-' + [guid]::NewGuid().ToString('N'))
$releaseRoot = if ($ReleaseDir) { [IO.Path]::GetFullPath($ReleaseDir) } else { Join-Path $sourceRoot 'release-dev' }
$previousPath = $env:PATH

try {
  New-Item -ItemType Directory -Path $stageRoot | Out-Null
  foreach ($item in @('src', 'electron', 'shared', 'cli', 'scripts', 'package.json', 'pnpm-lock.yaml',
      'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.electron.json', 'vite.config.ts',
      'index.html', 'LICENSE', 'LICENSES.md')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $item) -Destination $stageRoot -Recurse -Force
  }
  $env:PATH = "$(Split-Path -Parent $NodePath);$previousPath"
  Push-Location $stageRoot
  try {
    & $NodePath $PnpmCliPath install --frozen-lockfile --offline
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'The local pnpm store is incomplete; retrying dependency installation online.'
      & $NodePath $PnpmCliPath install --frozen-lockfile
      if ($LASTEXITCODE -ne 0) { throw "Windows dependency installation failed ($LASTEXITCODE)." }
    }
  } finally { Pop-Location }

  & (Join-Path $sourceRoot 'scripts\package-windows-offline.ps1') -NodePath $NodePath `
    -PnpmCliPath $PnpmCliPath -ProjectDir $stageRoot `
    -ResourceDir (Join-Path $sourceRoot 'resources') -ReleaseDir $releaseRoot
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Portable packaging failed ($LASTEXITCODE)." }
} finally {
  $env:PATH = $previousPath
  if (-not $KeepStage -and (Test-Path -LiteralPath $stageRoot)) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Write-Host "Windows staging directory: $stageRoot"
  }
}

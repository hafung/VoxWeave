[CmdletBinding()]
param(
  [string]$NodePath = "C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
  [string]$PnpmCliPath = $env:npm_execpath,
  [string]$ResourceDir,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$projectDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$resourceRoot = if ($ResourceDir) { [IO.Path]::GetFullPath($ResourceDir) } else { Join-Path $projectDir "resources" }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw "Windows Node not found: $NodePath" }
if (-not $SkipBuild -and (-not $PnpmCliPath -or -not (Test-Path -LiteralPath $PnpmCliPath -PathType Leaf))) {
  throw "pnpm CLI not found. Run this script through pnpm or pass -PnpmCliPath <pnpm.cjs>."
}

$shimDir = $null
if ($PnpmCliPath) {
  $shimDir = Join-Path ([IO.Path]::GetTempPath()) ("voxweave-pnpm-shim-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $shimDir | Out-Null
  $shim = "@echo off`r`n`"$NodePath`" `"$PnpmCliPath`" %*`r`n"
  [IO.File]::WriteAllText((Join-Path $shimDir "pnpm.cmd"), $shim, [Text.Encoding]::ASCII)
  $env:PATH = "$shimDir;$(Split-Path -Parent $NodePath);$env:PATH"
}

Push-Location $projectDir
try {
  if (-not $SkipBuild) {
    & $NodePath $PnpmCliPath run build
    if ($LASTEXITCODE -ne 0) { throw "Windows production build failed ($LASTEXITCODE)." }
  }
  $marker = Join-Path ([IO.Path]::GetTempPath()) ("voxweave-composition-smoke-" + [guid]::NewGuid().ToString("N") + ".json")
  $screenshot = Join-Path $projectDir "composition-smoke.png"
  $env:VOXWEAVE_RESOURCE_ROOT = $resourceRoot
  $env:VOXWEAVE_ENGINE = Join-Path $resourceRoot "engine\qwen_tts.exe"
  $env:VOXWEAVE_MODEL = Join-Path $resourceRoot "models\qwen3-tts-0.6b-customvoice"
  $env:VOXWEAVE_FFMPEG = Join-Path $resourceRoot "ffmpeg\ffmpeg.exe"
  $env:VOXWEAVE_FFPROBE = Join-Path $resourceRoot "ffmpeg\ffprobe.exe"
  $env:VOXWEAVE_COMPOSITION_SMOKE_RESULT = $marker
  $env:VOXWEAVE_COMPOSITION_SMOKE_SCREENSHOT = $screenshot
  $electronCli = Join-Path $projectDir "node_modules\electron\cli.js"
  if (-not (Test-Path -LiteralPath $electronCli -PathType Leaf)) { throw "Electron CLI not found: $electronCli" }
  & $NodePath $electronCli "."
  if ($LASTEXITCODE -ne 0) { throw "Electron composition smoke process failed ($LASTEXITCODE)." }
  if (-not (Test-Path -LiteralPath $marker)) { throw "Composition smoke marker was not written." }
  $result = Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
  [IO.File]::WriteAllText((Join-Path $projectDir "composition-smoke.json"), ($result | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
  Remove-Item -LiteralPath $marker -Force
  if (-not $result.ok -or -not $result.playerReadyObserved -or -not $result.playerReadyAfterPlayback -or $result.status -ne "resolved" -or $result.playerDurationSeconds -le 0 -or $result.playerScenes -le 0 -or $result.previewNonDarkPixelRatio -le 0.001) {
    throw "Unexpected composition smoke result: $($result | ConvertTo-Json -Compress)"
  }
  Write-Host "Windows composition smoke passed: '$($result.captionText)', $($result.durationMs) ms, Player $($result.playerDurationSeconds) s." -ForegroundColor Green
  Write-Host "Screenshot: $screenshot"
} finally {
  @(
    "VOXWEAVE_RESOURCE_ROOT", "VOXWEAVE_ENGINE", "VOXWEAVE_MODEL", "VOXWEAVE_FFMPEG",
    "VOXWEAVE_FFPROBE", "VOXWEAVE_COMPOSITION_SMOKE_RESULT", "VOXWEAVE_COMPOSITION_SMOKE_SCREENSHOT"
  ) | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  if ($shimDir) { Remove-Item $shimDir -Recurse -Force -ErrorAction SilentlyContinue }
  Pop-Location
}

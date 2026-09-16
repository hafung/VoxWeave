[CmdletBinding()]
param(
  [string]$NodePath = "C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
  [string]$PnpmCliPath = $env:npm_execpath,
  [switch]$SkipBuild,
  [switch]$IncludeSetup
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "Directory-portable packaging must run with Windows Node/pnpm." }

$projectDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$nodePath = if ($env:npm_node_execpath) { $env:npm_node_execpath } else { $NodePath }
$pnpmCli = $PnpmCliPath
if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath)) { throw "Windows Node not found: $nodePath" }
if (-not $SkipBuild -and (-not $pnpmCli -or -not (Test-Path -LiteralPath $pnpmCli))) { throw "pnpm CLI not found. Run through pnpm or pass -PnpmCliPath <pnpm.cjs>." }
$shimDir = $null
if ($pnpmCli) {
  $shimDir = Join-Path ([IO.Path]::GetTempPath()) ("voxweave-pnpm-shim-" + [guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $shimDir | Out-Null
  $shim = "@echo off`r`n`"$nodePath`" `"$pnpmCli`" %*`r`n"
  [IO.File]::WriteAllText((Join-Path $shimDir "pnpm.cmd"), $shim, [Text.Encoding]::ASCII)
  $env:PATH = "$shimDir;$(Split-Path -Parent $nodePath);$env:PATH"
}

Push-Location $projectDir
try {
  if (-not $SkipBuild) {
    & $nodePath $pnpmCli run build
    if ($LASTEXITCODE -ne 0) { throw "Build failed ($LASTEXITCODE)." }
  }
  & $nodePath (Join-Path $projectDir "scripts\verify-offline-resources.mjs") --write-manifest
  if ($LASTEXITCODE -ne 0) { throw "Offline resource verification failed ($LASTEXITCODE)." }
  $builderTarget = if ($IncludeSetup) { "nsis" } else { "dir" }
  $builderCli = Join-Path $projectDir "node_modules\electron-builder\out\cli\cli.js"
  if (-not (Test-Path -LiteralPath $builderCli -PathType Leaf)) { throw "electron-builder CLI not found: $builderCli" }
  & $nodePath $builderCli --win $builderTarget
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed ($LASTEXITCODE)." }

  $package = Get-Content (Join-Path $projectDir "package.json") -Raw | ConvertFrom-Json
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  $releaseDir = Join-Path $projectDir "release"
  $unpackedDir = Join-Path $releaseDir "win-unpacked"
  $portableName = "VoxWeave-Portable-$($package.version)-$arch"
  $portableDir = Join-Path $releaseDir $portableName
  $portableZip = "$portableDir.zip"
  if (-not (Test-Path (Join-Path $unpackedDir "resources\models\qwen3-tts-0.6b-customvoice\model.safetensors"))) {
    throw "Packaged directory does not contain the external default Qwen CustomVoice model resource."
  }
  if (Test-Path $portableDir) { Remove-Item $portableDir -Recurse -Force }
  if (Test-Path $portableZip) { Remove-Item $portableZip -Force }
  Move-Item $unpackedDir $portableDir
  $applicationExe = Get-ChildItem -LiteralPath $portableDir -Filter "*.exe" -File | Select-Object -First 1
  if (-not $applicationExe) { throw "Packaged application executable is missing." }
  if ($applicationExe.Name -ne "VoxWeave.exe") { Rename-Item -LiteralPath $applicationExe.FullName -NewName "VoxWeave.exe" }
  Push-Location $releaseDir
  try {
    & tar.exe -a -cf "$portableName.zip" $portableName
    if ($LASTEXITCODE -ne 0) { throw "Creating directory-portable ZIP failed ($LASTEXITCODE)." }
  } finally { Pop-Location }
  $hash = (Get-FileHash $portableZip -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content "$portableZip.sha256" "$hash  $portableName.zip" -Encoding ASCII
  Write-Host "Offline directory package: $portableZip" -ForegroundColor Green
  if ($IncludeSetup) { Write-Host "Setup installer was requested and remains in $releaseDir." }
} finally {
  if ($shimDir) { Remove-Item $shimDir -Recurse -Force -ErrorAction SilentlyContinue }
  Pop-Location
}

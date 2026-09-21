[CmdletBinding()]
param(
  [string]$NodePath = "C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe",
  [string]$PnpmCliPath = $env:npm_execpath,
  [string]$ProjectDir,
  [string]$ResourceDir,
  [string]$ReleaseDir,
  [switch]$SkipBuild,
  [switch]$IncludeSetup
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "Directory-portable packaging must run with Windows Node/pnpm." }

$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$projectDir = if ($ProjectDir) { [IO.Path]::GetFullPath($ProjectDir) } else { $sourceRoot }
$resourceRoot = if ($ResourceDir) { [IO.Path]::GetFullPath($ResourceDir) } else { Join-Path $projectDir 'resources' }
$releaseRoot = if ($ReleaseDir) { [IO.Path]::GetFullPath($ReleaseDir) } else { Join-Path $projectDir 'release' }
$nodePath = if ($env:npm_node_execpath) { $env:npm_node_execpath } else { $NodePath }
$pnpmCli = $PnpmCliPath
if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath)) { throw "Windows Node not found: $nodePath" }
if (-not $pnpmCli -or -not (Test-Path -LiteralPath $pnpmCli)) { throw "pnpm CLI is required for dependency collection even with -SkipBuild. Run through pnpm or pass -PnpmCliPath <pnpm.cjs>." }
$shimDir = $null
$builderConfig = $null
$package = Get-Content (Join-Path $projectDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$arch = 'x64'
$portableName = "VoxWeave-Portable-$($package.version)-$arch"
$portableDir = Join-Path $releaseRoot $portableName
$portableZip = "$portableDir.zip"
if ((Test-Path $portableDir) -or (Test-Path $portableZip)) { throw "Release already exists. Bump package.json version or choose -ReleaseDir; existing packages are preserved: $portableDir" }
$buildDir = Join-Path $releaseRoot ('.build-' + $package.version + '-' + [guid]::NewGuid().ToString('N'))
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
  & $nodePath (Join-Path $sourceRoot "scripts\verify-offline-resources.mjs") --root $resourceRoot --write-manifest
  if ($LASTEXITCODE -ne 0) { throw "Offline resource verification failed ($LASTEXITCODE)." }
  $builderTarget = if ($IncludeSetup) { "nsis" } else { "dir" }
  $builderCli = Join-Path $projectDir "node_modules\electron-builder\out\cli\cli.js"
  if (-not (Test-Path -LiteralPath $builderCli -PathType Leaf)) { throw "electron-builder CLI not found: $builderCli" }
  $package.build.directories.output = $buildDir
  $package.build.extraResources[0].from = $resourceRoot
  $builderConfig = Join-Path ([IO.Path]::GetTempPath()) ('voxweave-builder-' + [guid]::NewGuid().ToString('N') + '.json')
  [IO.File]::WriteAllText($builderConfig, ($package.build | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
  & $nodePath $builderCli --win $builderTarget --x64 --config $builderConfig
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed ($LASTEXITCODE)." }

  $unpackedDir = Join-Path $buildDir "win-unpacked"
  if (-not (Test-Path (Join-Path $unpackedDir "resources\models\qwen3-tts-0.6b-customvoice\model.safetensors"))) {
    throw "Packaged directory does not contain the external default Qwen CustomVoice model resource."
  }
  Move-Item $unpackedDir $portableDir
  $applicationExe = Get-ChildItem -LiteralPath $portableDir -Filter "*.exe" -File | Select-Object -First 1
  if (-not $applicationExe) { throw "Packaged application executable is missing." }
  if ($applicationExe.Name -ne "VoxWeave.exe") { Rename-Item -LiteralPath $applicationExe.FullName -NewName "VoxWeave.exe" }
  Push-Location $releaseRoot
  try {
    & tar.exe -a -cf "$portableName.zip" $portableName
    if ($LASTEXITCODE -ne 0) { throw "Creating directory-portable ZIP failed ($LASTEXITCODE)." }
  } finally { Pop-Location }
  $hash = (Get-FileHash $portableZip -Algorithm SHA256).Hash.ToLowerInvariant()
  Set-Content "$portableZip.sha256" "$hash  $portableName.zip" -Encoding ASCII
  Write-Host "Offline directory package: $portableZip" -ForegroundColor Green
  if ($IncludeSetup) {
    Get-ChildItem $buildDir -File | Where-Object { $_.Name -match '\.(exe|blockmap|yml)$' } | Move-Item -Destination $releaseRoot
    Write-Host "Setup installer was requested and is in $releaseRoot."
  }
} finally {
  if ($buildDir -and (Test-Path -LiteralPath $buildDir)) { Remove-Item -LiteralPath $buildDir -Recurse -Force -ErrorAction SilentlyContinue }
  if ($builderConfig) { Remove-Item -LiteralPath $builderConfig -Force -ErrorAction SilentlyContinue }
  if ($shimDir) { Remove-Item $shimDir -Recurse -Force -ErrorAction SilentlyContinue }
  Pop-Location
}

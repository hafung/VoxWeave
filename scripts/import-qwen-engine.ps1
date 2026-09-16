[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$SourceDir,
  [string]$ResourceDir
)

$ErrorActionPreference = "Stop"
$ResourceDir = if ($ResourceDir) { $ResourceDir } else { Join-Path $PSScriptRoot "..\resources\engine" }
$source = [IO.Path]::GetFullPath($SourceDir)
$required = @(
  "qwen_tts.exe",
  "libopenblas.dll",
  "libwinpthread-1.dll",
  "QWEN3-TTS-C-LICENSE",
  "INGOT-LICENSE",
  "OPENBLAS-LICENSE",
  "LZ4-LICENSE",
  "WINPTHREADS-LICENSE",
  "THIRD-PARTY-NOTICES.txt",
  "build-info.json"
)
foreach ($relative in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $source $relative) -PathType Leaf)) {
    throw "Reviewed engine bundle is missing $relative."
  }
}
$buildInfo = Get-Content -LiteralPath (Join-Path $source "build-info.json") -Raw | ConvertFrom-Json
if ($buildInfo.target -ne "x86_64-w64-windows-gnu-ucrt") { throw "Unsupported Qwen engine target: $($buildInfo.target)" }
New-Item -ItemType Directory -Force -Path $ResourceDir | Out-Null
Copy-Item (Join-Path $source "*") $ResourceDir -Recurse -Force

$bundledEngine = Join-Path $ResourceDir "qwen_tts.exe"
& $bundledEngine --self-test
if ($LASTEXITCODE -ne 0) { throw "qwen_tts.exe self-test failed; verify DLL closure and CPU baseline." }
& $bundledEngine --caps
if ($LASTEXITCODE -ne 0) { throw "qwen_tts.exe capability probe failed." }

$files = @()
$resourcePrefix = [IO.Path]::GetFullPath($ResourceDir).TrimEnd("\") + "\"
Get-ChildItem $ResourceDir -Recurse -File | Where-Object Name -ne "manifest.json" | Sort-Object FullName | ForEach-Object {
  $files += [ordered]@{
    path = $_.FullName.Substring($resourcePrefix.Length).Replace("\", "/")
    size = $_.Length
    sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
$manifest = [ordered]@{
  version = $buildInfo.engineVersion
  source = "https://github.com/gabriele-mastrapasqua/qwen3-tts"
  sourceCommit = $buildInfo.sourceCommit
  sourceDiffSha256 = $buildInfo.sourceDiffSha256
  sourceTreeSha256 = $buildInfo.sourceTreeSha256
  target = $buildInfo.target
  cpuBaseline = $buildInfo.cpuBaseline
  compiler = $buildInfo.compiler
  dependencies = [ordered]@{ openblas = $buildInfo.openblas; lz4 = $buildInfo.lz4 }
  imports = $buildInfo.imports
  validation = @("--self-test", "--caps")
  files = $files
}
$manifestJson = $manifest | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $ResourceDir "manifest.json"), "$manifestJson`n", [Text.UTF8Encoding]::new($false))
Write-Host "Qwen Windows engine and dependency closure imported into $ResourceDir" -ForegroundColor Green

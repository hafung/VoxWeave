[CmdletBinding()]
param(
  [string]$ResourceDir
)

$ErrorActionPreference = "Stop"
$ResourceDir = if ($ResourceDir) { $ResourceDir } else { Join-Path $PSScriptRoot "..\resources\ffmpeg" }
$version = "n8.1.2-52-g5a03dfa0f6"
$asset = "ffmpeg-$version-win64-lgpl-8.1.zip"
$source = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-12-13-12/$asset"
$temporary = Join-Path ([IO.Path]::GetTempPath()) ("voxweave-ffmpeg-" + [guid]::NewGuid().ToString("N"))
$expectedHashes = @{
  "ffmpeg.exe" = "547737d0bfd668b9c8aeac4831ccc967d96c4cbdc19a5b14b71e103ed4a390e3"
  "ffprobe.exe" = "3ff9e903a6257d3ff875f0a8919ec7972209435088662c87b49556b8fa132cbe"
  "LICENSE.txt" = "da7eabb7bafdf7d3ae5e9f223aa5bdc1eece45ac569dc21b3b037520b4464768"
}

function Test-Hash([string]$Path, [string]$Expected) {
  return (Test-Path -LiteralPath $Path -PathType Leaf) -and ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Expected)
}

New-Item -ItemType Directory -Force -Path $temporary, $ResourceDir | Out-Null
try {
  $complete = $true
  foreach ($name in $expectedHashes.Keys) {
    if (-not (Test-Hash (Join-Path $ResourceDir $name) $expectedHashes[$name])) { $complete = $false }
  }
  if (-not $complete) {
    $archive = Join-Path $temporary $asset
    Invoke-WebRequest -Uri $source -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $temporary -Force
    foreach ($name in $expectedHashes.Keys) {
      $found = Get-ChildItem $temporary -Recurse -Filter $name | Select-Object -First 1
      if (-not $found) { throw "FFmpeg archive is missing $name." }
      Copy-Item $found.FullName (Join-Path $ResourceDir $name) -Force
    }
  }
  foreach ($name in $expectedHashes.Keys) {
    $actual = (Get-FileHash (Join-Path $ResourceDir $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expectedHashes[$name]) { throw "$name SHA-256 mismatch. Expected $($expectedHashes[$name]), got $actual." }
  }
  $manifest = [ordered]@{
    version = $version
    source = $source
    license = "LGPL v2.1 or later; see LICENSE.txt"
    files = [ordered]@{}
  }
  foreach ($name in @("ffmpeg.exe", "ffprobe.exe", "LICENSE.txt")) {
    $manifest.files[$name] = [ordered]@{
      path = $name
      sha256 = (Get-FileHash (Join-Path $ResourceDir $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  $manifestJson = $manifest | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText((Join-Path $ResourceDir "manifest.json"), "$manifestJson`n", [Text.UTF8Encoding]::new($false))
  Write-Host "FFmpeg $version is ready in $ResourceDir" -ForegroundColor Green
} finally {
  Remove-Item $temporary -Recurse -Force -ErrorAction SilentlyContinue
}

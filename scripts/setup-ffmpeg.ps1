[CmdletBinding()]
param(
  [string]$ResourceDir,
  [string]$ArchivePath
)

$ErrorActionPreference = "Stop"
$ResourceDir = if ($ResourceDir) { $ResourceDir } else { Join-Path $PSScriptRoot "..\resources\ffmpeg" }
$version = "n8.1.2-52-g5a03dfa0f6"
$asset = "ffmpeg-$version-win64-gpl-8.1.zip"
$source = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-12-13-12/$asset"
$temporary = Join-Path ([IO.Path]::GetTempPath()) ("voxweave-ffmpeg-" + [guid]::NewGuid().ToString("N"))
$expectedHashes = @{
  "ffmpeg.exe" = "7b25e8c22217ccfc608bd609530620ccad0f8a0f9d1a6bf4ca3b09b46e9e1a66"
  "ffprobe.exe" = "56fbe12cde902fe7ce85a3b20f200d8049c15370bd2b736979c0500e3d632a4c"
  "LICENSE.txt" = "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903"
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
    $archive = if ($ArchivePath) { $ArchivePath } else { Join-Path $temporary $asset }
    if (-not $ArchivePath) { Invoke-WebRequest -Uri $source -OutFile $archive }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '8ebd7e82791b8f753ade7fd6f2eacf8ce02127dfb1f25102d85154d1779cd2de') { throw 'FFmpeg archive SHA-256 mismatch' }
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
    license = "GPL v3 or later; see LICENSE.txt; includes libx264 for MP4 rendering"
    archiveSha256 = '8ebd7e82791b8f753ade7fd6f2eacf8ce02127dfb1f25102d85154d1779cd2de'
    files = [ordered]@{}
  }
  foreach ($name in @("ffmpeg.exe", "ffprobe.exe", "LICENSE.txt")) {
    $manifest.files[$name] = [ordered]@{
      path = $name
      sha256 = (Get-FileHash (Join-Path $ResourceDir $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  $manifestJson = ($manifest | ConvertTo-Json -Depth 6).Replace("`r`n", "`n")
  [IO.File]::WriteAllText((Join-Path $ResourceDir "manifest.json"), "$manifestJson`n", [Text.UTF8Encoding]::new($false))
  Write-Host "FFmpeg $version is ready in $ResourceDir" -ForegroundColor Green
} finally {
  Remove-Item $temporary -Recurse -Force -ErrorAction SilentlyContinue
}

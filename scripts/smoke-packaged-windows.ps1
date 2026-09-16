[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$PackageDir,
  [string]$ResultPath
)

$ErrorActionPreference = "Stop"
$packageRoot = [IO.Path]::GetFullPath($PackageDir)
$result = if ($ResultPath) { [IO.Path]::GetFullPath($ResultPath) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.windows-smoke\packaged-composition-smoke.json")) }
$executable = Get-ChildItem -LiteralPath $packageRoot -Filter "*.exe" -File | Select-Object -First 1 -ExpandProperty FullName
if (-not $executable) { throw "Packaged VoxWeave executable was not found in: $packageRoot" }

$screenshot = [IO.Path]::ChangeExtension($result, ".png")
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $result) | Out-Null
Remove-Item -LiteralPath $result -Force -ErrorAction SilentlyContinue
$env:VOXWEAVE_COMPOSITION_SMOKE_RESULT = $result
$env:VOXWEAVE_COMPOSITION_SMOKE_SCREENSHOT = $screenshot
try {
  $process = Start-Process -FilePath $executable -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "Packaged VoxWeave exited with code $($process.ExitCode)." }
  if (-not (Test-Path -LiteralPath $result -PathType Leaf)) { throw "Packaged composition smoke did not write its result." }
  $data = Get-Content -LiteralPath $result -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $data.ok -or $data.status -ne "resolved" -or -not $data.playerReadyAfterPlayback -or $data.playerScenes -le 0 -or $data.previewNonDarkPixelRatio -le 0.001) {
    throw "Unexpected packaged composition result: $($data | ConvertTo-Json -Compress)"
  }
  Write-Host "Packaged Windows composition smoke passed: $($data.durationMs) ms, visible-pixel ratio $($data.previewNonDarkPixelRatio)." -ForegroundColor Green
  Write-Host "Screenshot: $screenshot"
} finally {
  Remove-Item Env:VOXWEAVE_COMPOSITION_SMOKE_RESULT -ErrorAction SilentlyContinue
  Remove-Item Env:VOXWEAVE_COMPOSITION_SMOKE_SCREENSHOT -ErrorAction SilentlyContinue
}

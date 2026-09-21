[CmdletBinding()]
param(
  [string]$NodePath = 'C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe',
  [string]$AppDir = ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))),
  [string]$ResourceDir = ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\resources')))
)
$ErrorActionPreference = 'Stop'
$output = Join-Path $AppDir 'export-check'
New-Item -ItemType Directory -Force -Path $output | Out-Null
& $NodePath (Join-Path $AppDir 'dist-electron\electron\renderers\export-smoke.js') $ResourceDir $output
if ($LASTEXITCODE -ne 0) { throw 'Native renderer smoke failed' }
$env:VOXWEAVE_RESOURCE_ROOT = $ResourceDir
$env:VOXWEAVE_COMPOSITION_SMOKE_RESULT = Join-Path $output 'electron-result.json'
$env:VOXWEAVE_COMPOSITION_SMOKE_SCREENSHOT = Join-Path $output 'electron-preview.png'
$env:VOXWEAVE_EXPORT_SMOKE_OUTPUT = Join-Path $output 'tts-final.mp4'
$env:VOXWEAVE_TEST_USER_DATA = Join-Path $output 'test-user-data'
try {
  & $NodePath (Join-Path $AppDir 'node_modules\electron\cli.js') $AppDir
  if ($LASTEXITCODE -ne 0) { throw 'Electron TTS-to-export smoke failed' }
  $result = Get-Content $env:VOXWEAVE_COMPOSITION_SMOKE_RESULT -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $result.ok -or $result.exportResult.phase -ne 'complete') { throw 'Missing export completion marker' }
  & (Join-Path $ResourceDir 'ffmpeg\ffprobe.exe') -v error -show_entries 'format=duration:stream=codec_name,width,height' -of json $env:VOXWEAVE_EXPORT_SMOKE_OUTPUT
  if ($LASTEXITCODE -ne 0) { throw 'Export probe failed' }
  Write-Host 'Windows TTS, aligned captions, Player and MP4 export smoke passed.'
} finally {
  'VOXWEAVE_RESOURCE_ROOT', 'VOXWEAVE_COMPOSITION_SMOKE_RESULT', 'VOXWEAVE_COMPOSITION_SMOKE_SCREENSHOT', 'VOXWEAVE_EXPORT_SMOKE_OUTPUT', 'VOXWEAVE_TEST_USER_DATA' | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
}

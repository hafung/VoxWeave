[CmdletBinding()]
param(
  [ValidateSet('base-0.6b','custom-0.6b')][string]$Variant = 'base-0.6b',
  [string]$Destination,
  [string]$Revision
)
$ErrorActionPreference = 'Stop'
$defaultFolder = if ($Variant -eq 'base-0.6b') { 'qwen3-tts-0.6b-base' } else { 'qwen3-tts-0.6b-customvoice' }
$Destination = if ($Destination) { $Destination } else { Join-Path $PSScriptRoot "..\resources\models\$defaultFolder" }
$repo = if ($Variant -eq 'base-0.6b') { 'Qwen/Qwen3-TTS-12Hz-0.6B-Base' } else { 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice' }
$Revision = if ($Revision) { $Revision } elseif ($Variant -eq 'base-0.6b') { '5d83992436eae1d760afd27aff78a71d676296fc' } else { '85e237c12c027371202489a0ec509ded67b5e4b5' }
$destinationPath = [IO.Path]::GetFullPath($Destination)
$files = @('config.json','generation_config.json','tokenizer_config.json','preprocessor_config.json','model.safetensors','vocab.json','merges.txt')
$codecFiles = @('config.json','configuration.json','model.safetensors','preprocessor_config.json')
New-Item -ItemType Directory -Force -Path $destinationPath, (Join-Path $destinationPath 'speech_tokenizer') | Out-Null
$manifestPath = Join-Path $destinationPath 'manifest.json'
$previousManifest = if (Test-Path -LiteralPath $manifestPath) { Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } else { $null }
$knownLargeHashes = @{
  'model.safetensors' = if ($Variant -eq 'base-0.6b') { '180b3b10eb1c9f1b4db7806d5475bae3071c0243c299d49926bab1da3b6946f6' } else { 'bc3c7e785eb961179c25450d1acff03f839e0002f2f3a5aeb67b5735c0fa2adb' }
  'speech_tokenizer/model.safetensors' = '836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258'
}

function Get-ExpectedHash([string]$Relative) {
  if ($knownLargeHashes.ContainsKey($Relative)) { return $knownLargeHashes[$Relative] }
  if ($previousManifest -and $previousManifest.version -eq $Revision -and $previousManifest.files) {
    $property = $previousManifest.files.PSObject.Properties[$Relative]
    if ($property -and $property.Value.sha256) { return [string]$property.Value.sha256 }
  }
  return $null
}

function Get-HfFile([string]$Relative, [string]$Target) {
  $expected = Get-ExpectedHash $Relative
  if ((Test-Path -LiteralPath $Target) -and (Get-Item -LiteralPath $Target).Length -gt 0) {
    if (-not $expected -or (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expected) {
      Write-Host "[cached] $Relative"; return
    }
    Write-Warning "$Relative does not match the pinned hash; downloading a clean copy."
  }
  $url = "https://huggingface.co/$repo/resolve/$Revision/$Relative"
  $partial = "$Target.part"
  Write-Host "[download] $Relative"
  & curl.exe --fail --location --retry 5 --retry-all-errors --continue-at - --output $partial $url
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $Relative" }
  Move-Item -LiteralPath $partial -Destination $Target -Force
  if ($expected) {
    $actual = (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "$Relative SHA-256 mismatch. Expected $expected, got $actual." }
  }
}

foreach ($file in $files) { Get-HfFile $file (Join-Path $destinationPath $file) }
foreach ($file in $codecFiles) { Get-HfFile "speech_tokenizer/$file" (Join-Path $destinationPath "speech_tokenizer\$file") }
# The model repository declares Apache-2.0 but does not publish a standalone
# license file, so store the canonical Apache text next to the weights.
$licensePath = Join-Path $destinationPath 'MODEL-LICENSE.txt'
$licenseHash = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'
if (-not (Test-Path -LiteralPath $licensePath) -or (Get-FileHash -LiteralPath $licensePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $licenseHash) {
  Invoke-WebRequest -Uri 'https://www.apache.org/licenses/LICENSE-2.0.txt' -OutFile "$licensePath.part"
  Move-Item -LiteralPath "$licensePath.part" -Destination $licensePath -Force
}
$actualLicenseHash = (Get-FileHash -LiteralPath $licensePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualLicenseHash -ne $licenseHash) { throw "Apache 2.0 notice SHA-256 mismatch. Expected $licenseHash, got $actualLicenseHash." }

$manifestFiles = [ordered]@{}
foreach ($relative in @($files + ($codecFiles | ForEach-Object { "speech_tokenizer/$_" }) + 'MODEL-LICENSE.txt')) {
  $local = Join-Path $destinationPath ($relative.Replace('/', '\'))
  $manifestFiles[$relative] = [ordered]@{
    path = $relative
    size = (Get-Item -LiteralPath $local).Length
    sha256 = (Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
$manifest = [ordered]@{
  version = $Revision
  source = "https://huggingface.co/$repo/tree/$Revision"
  license = 'Apache-2.0; see MODEL-LICENSE.txt'
  files = $manifestFiles
}
$manifestJson = $manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($manifestPath, "$manifestJson`n", [Text.UTF8Encoding]::new($false))
Write-Host "Model resources are ready: $destinationPath" -ForegroundColor Green

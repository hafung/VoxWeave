[CmdletBinding()]
param(
  [ValidateSet('base-1.7b','custom-1.7b')][string]$Variant = 'custom-1.7b',
  [string]$Destination,
  [string]$Revision
)
$ErrorActionPreference = 'Stop'
$models = @{
  'base-1.7b' = @{ Folder = 'qwen3-tts-1.7b-base'; Repo = 'Qwen/Qwen3-TTS-12Hz-1.7B-Base'; Revision = 'fd4b254389122332181a7c3db7f27e918eec64e3'; Hash = '38fc7fc51c5e776e840414b6fd443962e9411b9654888fd7913e4da643cb857c' }
  'custom-1.7b' = @{ Folder = 'qwen3-tts-1.7b-customvoice'; Repo = 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice'; Revision = '0c0e3051f131929182e2c023b9537f8b1c68adfe'; Hash = '38b1d5971bdbd982b561cccec982669a53b0537c3cf5e9bd4778ed07bb2f5137' }
}
$model = $models[$Variant]
$defaultFolder = $model.Folder
$Destination = if ($Destination) { $Destination } else { Join-Path $PSScriptRoot "..\resources\models\$defaultFolder" }
$repo = $model.Repo
$Revision = if ($Revision) { $Revision } else { $model.Revision }
$destinationPath = [IO.Path]::GetFullPath($Destination)
$files = @('config.json','generation_config.json','tokenizer_config.json','preprocessor_config.json','model.safetensors','vocab.json','merges.txt')
$codecFiles = @('config.json','configuration.json','model.safetensors','preprocessor_config.json')
New-Item -ItemType Directory -Force -Path $destinationPath, (Join-Path $destinationPath 'speech_tokenizer') | Out-Null
$manifestPath = Join-Path $destinationPath 'manifest.json'
$previousManifest = if (Test-Path -LiteralPath $manifestPath) { Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } else { $null }
$knownLargeHashes = @{
  'model.safetensors' = $model.Hash
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
  if ((Test-Path -LiteralPath $partial) -and $expected -and (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expected) {
    Move-Item -LiteralPath $partial -Destination $Target -Force
    Write-Host "[complete] $Relative"; return
  }
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

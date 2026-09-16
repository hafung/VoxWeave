param(
  [string]$ResourceDir = (Join-Path $PSScriptRoot "..\resources\models\sensevoice-small")
)

$ErrorActionPreference = "Stop"
$modelName = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17"
$modelUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$modelName.tar.bz2"
$vadUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"
$funAsrRevision = "486b4b7ceb27b72db24a84c6e1be7cf6c5be6609"
$modelLicenseUrl = "https://raw.githubusercontent.com/modelscope/FunASR/$funAsrRevision/MODEL_LICENSE"
$vadLicenseUrl = "https://raw.githubusercontent.com/snakers4/silero-vad/caddb3b7ce1dee88a14d5621a0e9a8fdeb2c2c48/LICENSE"
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("voxweave-sensevoice-" + [guid]::NewGuid().ToString("N"))

$expectedHashes = @{
  model = "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51"
  tokens = "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc"
  sileroVad = "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"
  packageLicense = "221c6df10b0931a5629adad671ea48fb7747e034c414b6d2bfa275bc3dd4ea17"
  sileroLicense = "2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b"
}

function Get-Hash([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-Hash([string]$Path, [string]$Expected) {
  return (Test-Path -LiteralPath $Path -PathType Leaf) -and ((Get-Hash $Path) -eq $Expected)
}

function Assert-Hash([string]$Path, [string]$Expected, [string]$Name) {
  $actual = Get-Hash $Path
  if ($actual -ne $Expected) { throw "$Name SHA-256 mismatch. Expected $Expected, got $actual." }
}

New-Item -ItemType Directory -Force -Path $temporary, $ResourceDir | Out-Null
try {
  $modelPath = Join-Path $ResourceDir "model.int8.onnx"
  $tokensPath = Join-Path $ResourceDir "tokens.txt"
  $packageLicensePath = Join-Path $ResourceDir "SENSEVOICE-LICENSE"
  if (-not ((Test-Hash $modelPath $expectedHashes.model) -and (Test-Hash $tokensPath $expectedHashes.tokens) -and (Test-Hash $packageLicensePath $expectedHashes.packageLicense))) {
    $archive = Join-Path $temporary "$modelName.tar.bz2"
    Invoke-WebRequest -Uri $modelUrl -OutFile $archive
    tar -xf $archive -C $temporary
    if ($LASTEXITCODE -ne 0) { throw "Extracting the SenseVoice archive failed ($LASTEXITCODE)." }
    Copy-Item (Join-Path $temporary "$modelName\model.int8.onnx") $modelPath -Force
    Copy-Item (Join-Path $temporary "$modelName\tokens.txt") $tokensPath -Force
    Copy-Item (Join-Path $temporary "$modelName\LICENSE") $packageLicensePath -Force
  }

  $vadPath = Join-Path $ResourceDir "silero_vad.onnx"
  if (-not (Test-Hash $vadPath $expectedHashes.sileroVad)) { Invoke-WebRequest -Uri $vadUrl -OutFile $vadPath }
  $sileroLicensePath = Join-Path $ResourceDir "SILERO-LICENSE"
  if (-not (Test-Hash $sileroLicensePath $expectedHashes.sileroLicense)) { Invoke-WebRequest -Uri $vadLicenseUrl -OutFile $sileroLicensePath }
  $modelLicensePath = Join-Path $ResourceDir "SENSEVOICE-MODEL-LICENSE"
  Invoke-WebRequest -Uri $modelLicenseUrl -OutFile $modelLicensePath

  Assert-Hash $modelPath $expectedHashes.model "SenseVoice model"
  Assert-Hash $tokensPath $expectedHashes.tokens "SenseVoice tokens"
  Assert-Hash $vadPath $expectedHashes.sileroVad "Silero VAD model"
  Assert-Hash $packageLicensePath $expectedHashes.packageLicense "SenseVoice package license pointer"
  Assert-Hash $sileroLicensePath $expectedHashes.sileroLicense "Silero license"

  $manifestPath = Join-Path $ResourceDir "manifest.json"
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  $manifest.license = "FunASR Model Open Source License Agreement v1.1 plus MIT-licensed Silero VAD; see bundled notices"
  $manifest.files.model | Add-Member -NotePropertyName sha256 -NotePropertyValue (Get-Hash $modelPath) -Force
  $manifest.files.tokens | Add-Member -NotePropertyName sha256 -NotePropertyValue (Get-Hash $tokensPath) -Force
  $manifest.files.sileroVad | Add-Member -NotePropertyName sha256 -NotePropertyValue (Get-Hash $vadPath) -Force
  $manifest | Add-Member -NotePropertyName notices -NotePropertyValue ([ordered]@{
    modelPackage = [ordered]@{ path = "SENSEVOICE-LICENSE"; sha256 = (Get-Hash $packageLicensePath) }
    modelTerms = [ordered]@{ path = "SENSEVOICE-MODEL-LICENSE"; sha256 = (Get-Hash $modelLicensePath); revision = $funAsrRevision }
    sileroVad = [ordered]@{ path = "SILERO-LICENSE"; sha256 = (Get-Hash $sileroLicensePath) }
  }) -Force
  $manifestJson = $manifest | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText($manifestPath, "$manifestJson`n", [Text.UTF8Encoding]::new($false))
  Write-Host "SenseVoiceSmall INT8 and Silero VAD are ready in $ResourceDir"
} finally {
  Remove-Item $temporary -Recurse -Force -ErrorAction SilentlyContinue
}

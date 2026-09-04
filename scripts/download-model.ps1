[CmdletBinding()]
param(
  [ValidateSet('base-0.6b','custom-0.6b')][string]$Variant = 'base-0.6b',
  [string]$Destination = (Join-Path $PSScriptRoot '..\resources\models\qwen3-tts-0.6b-base')
)
$ErrorActionPreference = 'Stop'
$repo = if ($Variant -eq 'base-0.6b') { 'Qwen/Qwen3-TTS-12Hz-0.6B-Base' } else { 'Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice' }
$destinationPath = [IO.Path]::GetFullPath($Destination)
$files = @('config.json','generation_config.json','tokenizer_config.json','preprocessor_config.json','model.safetensors','vocab.json','merges.txt')
$codecFiles = @('config.json','configuration.json','model.safetensors','preprocessor_config.json')
New-Item -ItemType Directory -Force -Path $destinationPath, (Join-Path $destinationPath 'speech_tokenizer') | Out-Null

function Get-HfFile([string]$Relative, [string]$Target) {
  if ((Test-Path -LiteralPath $Target) -and (Get-Item -LiteralPath $Target).Length -gt 0) { Write-Host "[已有] $Relative"; return }
  $url = "https://huggingface.co/$repo/resolve/main/$Relative"
  $partial = "$Target.part"
  Write-Host "[下载] $Relative"
  & curl.exe --fail --location --retry 5 --retry-all-errors --continue-at - --output $partial $url
  if ($LASTEXITCODE -ne 0) { throw "下载失败：$Relative" }
  Move-Item -LiteralPath $partial -Destination $Target -Force
}

foreach ($file in $files) { Get-HfFile $file (Join-Path $destinationPath $file) }
foreach ($file in $codecFiles) { Get-HfFile "speech_tokenizer/$file" (Join-Path $destinationPath "speech_tokenizer\$file") }
Write-Host "模型准备完成：$destinationPath" -ForegroundColor Green

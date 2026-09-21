[CmdletBinding()]
param([string]$ArchivePath)
$ErrorActionPreference = 'Stop'
$version = '152.0.7977.75'
$expected = '97bf78fdb5eba45b19ba875e2215cf02813c576780ad406ad7d2a003eef4b956'
$url = "https://storage.googleapis.com/chrome-for-testing-public/$version/win64/chrome-headless-shell-win64.zip"
$root = Join-Path ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))) 'resources\browser'
New-Item -ItemType Directory -Force -Path $root | Out-Null
if (-not $ArchivePath) {
  $ArchivePath = Join-Path ([IO.Path]::GetTempPath()) "voxweave-chrome-$version.zip"
  Invoke-WebRequest -Uri $url -OutFile $ArchivePath
}
if ((Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Browser archive SHA-256 mismatch' }
Expand-Archive -LiteralPath $ArchivePath -DestinationPath $root -Force
$files = @(Get-ChildItem (Join-Path $root 'chrome-headless-shell-win64') -File -Recurse | ForEach-Object {
  @{ path = $_.FullName.Substring($root.Length + 1).Replace('\', '/'); sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$manifest = @{ version = $version; source = $url; archiveSha256 = $expected; files = $files }
[IO.File]::WriteAllText((Join-Path $root 'manifest.json'), (($manifest | ConvertTo-Json -Depth 8).Replace("`r`n", "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
Write-Host "Offline render browser installed: $version"

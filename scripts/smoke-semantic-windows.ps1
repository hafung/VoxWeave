[CmdletBinding()]
param([string]$ResourceDir)

$ErrorActionPreference = 'Stop'
$ResourceDir = if ($ResourceDir) { [IO.Path]::GetFullPath($ResourceDir) } else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\resources\semantic')) }
$engine = Join-Path $ResourceDir 'runtime\llama-server.exe'
$model = Join-Path $ResourceDir 'model\Qwen3-Embedding-0.6B-Q8_0.gguf'
if (-not (Test-Path -LiteralPath $engine) -or -not (Test-Path -LiteralPath $model)) { throw 'Run scripts/setup-semantic.ps1 first.' }

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$endpoint = "http://127.0.0.1:$port"
$arguments = @('-m', ('"' + $model + '"'), '--embedding', '--pooling', 'last', '--host', '127.0.0.1', '--port', [string]$port, '-ngl', '0', '-c', '1024')
$server = Start-Process -FilePath $engine -ArgumentList $arguments -PassThru -WindowStyle Hidden
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if ($server.HasExited) { throw "llama-server exited with code $($server.ExitCode)." }
    try {
      $health = Invoke-RestMethod -Uri "$endpoint/health" -TimeoutSec 1
      if ($health.status -eq 'ok') { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $ready) { throw 'Timed out waiting for the local embedding server.' }
  $texts = @(
    "Instruct: Retrieve media descriptions relevant to a video scene.`nQuery: nighttime city street",
    'City street at night with cars and lights',
    'Fruit and bread in a kitchen'
  )
  $body = @{ input = $texts } | ConvertTo-Json -Compress
  $response = Invoke-RestMethod -Uri "$endpoint/v1/embeddings" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 60
  $vectors = @($response.data | Sort-Object index | ForEach-Object { ,$_.embedding })
  if ($vectors.Count -ne 3 -or $vectors[0].Count -ne 1024) { throw 'Unexpected embedding response.' }
  function Get-Cosine($left, $right) {
    $dot = 0.0; $leftNorm = 0.0; $rightNorm = 0.0
    for ($index = 0; $index -lt $left.Count; $index++) {
      $dot += $left[$index] * $right[$index]
      $leftNorm += $left[$index] * $left[$index]
      $rightNorm += $right[$index] * $right[$index]
    }
    return $dot / [Math]::Sqrt($leftNorm * $rightNorm)
  }
  $city = Get-Cosine $vectors[0] $vectors[1]
  $kitchen = Get-Cosine $vectors[0] $vectors[2]
  if ($city -le $kitchen) { throw "Semantic order is wrong: city=$city, kitchen=$kitchen" }
  Write-Host ("Windows CPU semantic smoke passed: 1024 dimensions, city={0:N3}, kitchen={1:N3}" -f $city, $kitchen) -ForegroundColor Green
} finally {
  if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}

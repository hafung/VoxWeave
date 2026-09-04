[CmdletBinding()]
param([string]$InstallDir = '/opt/voxweave/qwen3-tts')
$ErrorActionPreference = 'Stop'
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) { throw '未找到 WSL2。请先运行：wsl --install -d Ubuntu' }
$script = @"
set -euo pipefail
sudo apt-get update
sudo apt-get install -y build-essential git libopenblas-dev curl
parent=`$(dirname '$InstallDir')
if [ ! -d '$InstallDir/.git' ]; then sudo mkdir -p "`$parent"; sudo chown -R `$USER:`$USER "`$parent"; git clone https://github.com/gabriele-mastrapasqua/qwen3-tts.git '$InstallDir'; fi
cd '$InstallDir'
git pull --ff-only
make clean && make blas
./qwen_tts --self-test
echo '引擎路径：$InstallDir/qwen_tts'
"@
& wsl.exe -- bash -lc $script
if ($LASTEXITCODE -ne 0) { throw 'WSL2 引擎构建失败' }

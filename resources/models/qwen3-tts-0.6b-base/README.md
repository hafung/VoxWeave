# Qwen3-TTS 0.6B Base resources

Run `powershell -ExecutionPolicy Bypass -File scripts/download-model.ps1` on an online build machine.
The script downloads the revision pinned in `manifest.json`, records SHA-256 hashes, and stores the Apache 2.0 notice next to the model. Binary weights remain outside Git and are copied as external files into the directory-portable package.

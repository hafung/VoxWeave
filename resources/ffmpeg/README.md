# FFmpeg Windows resources

Run `powershell -ExecutionPolicy Bypass -File scripts/setup-ffmpeg.ps1` on an online build machine. The script installs pinned static LGPL Windows x64 `ffmpeg.exe` and `ffprobe.exe`, copies the license, and records SHA-256 hashes. These files remain external to `app.asar` in directory-portable builds.

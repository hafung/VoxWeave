# FFmpeg Windows resources

Run `powershell -ExecutionPolicy Bypass -File scripts/setup-ffmpeg.ps1` on an online build machine. The script installs pinned static **GPL v3 or later** Windows x64 `ffmpeg.exe` and `ffprobe.exe`, including libx264 required by Producer's H.264 encoder. It verifies the archive and binary SHA-256 hashes, copies the license, and records provenance. These executables remain external to `app.asar`.

Pinned build: `n8.1.2-52-g5a03dfa0f6`, BtbN release `autobuild-2026-09-12-13-12`.

- Binary/source build distribution: https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-12-13-12
- Build recipes and dependency source references: https://github.com/BtbN/FFmpeg-Builds
- FFmpeg source revision: https://github.com/FFmpeg/FFmpeg/commit/5a03dfa0f6
- x264 source: https://code.videolan.org/videolan/x264

The earlier LGPL-only build is no longer sufficient for video export. Distributors must retain the bundled GPL notice and provide corresponding source as required by that license.

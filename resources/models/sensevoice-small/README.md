# SenseVoiceSmall runtime resources

Place the pinned INT8 SenseVoice model, `tokens.txt`, and Silero VAD ONNX file at the paths declared in `manifest.json`.
VoxWeave validates presence and optional SHA-256 hashes before constructing the native recognizer. Model binaries are intentionally not represented by placeholder files.

On Windows, run `powershell -ExecutionPolicy Bypass -File scripts/setup-sensevoice.ps1`. The script downloads version-pinned upstream artifacts, bundles both the release archive's license pointer and the full pinned FunASR model agreement, and records SHA-256 hashes in the manifest. Existing verified binary files are reused.

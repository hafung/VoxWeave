# Qwen3-TTS 1.7B CustomVoice resources

VoxWeave's default preset narration model. It runs with the bundled CPU C engine
under INT8 and accepts the application's natural-language prosody instruction.
Users enter plain text; paragraph grouping and pauses are generated internally.

Run `powershell -ExecutionPolicy Bypass -File scripts/download-model.ps1 -Variant custom-1.7b`.
Weights are pinned to `0c0e3051f131929182e2c023b9537f8b1c68adfe`, downloaded from
`Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`, and verified before offline packaging.
Cloned voices are extracted with the paired 1.7B Base model and loaded through
the native engine's voice-profile support. Both paths use 2048-dimensional
profiles; the application rejects profiles from older model sizes.

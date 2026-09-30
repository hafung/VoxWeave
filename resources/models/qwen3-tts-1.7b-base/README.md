# Qwen3-TTS 1.7B Base resources

This model extracts cloned voice profiles from reference audio on CPU. The
profiles are then read by the paired 1.7B CustomVoice model with narration
instructions through the native C engine's cross-model voice support.

Run `powershell -ExecutionPolicy Bypass -File scripts/download-model.ps1 -Variant base-1.7b`.
Weights are pinned to `fd4b254389122332181a7c3db7f27e918eec64e3` from
`Qwen/Qwen3-TTS-12Hz-1.7B-Base`. The application uses only the 1.7B model pair.

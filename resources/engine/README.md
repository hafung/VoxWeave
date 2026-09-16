# Qwen Windows engine resources

This directory contains the native Windows x64 `qwen_tts.exe`, its OpenBLAS and winpthreads DLLs, build provenance, licenses, and third-party notices. Rebuild the fixed UCRT/AVX2 bundle from WSL with `scripts/build-qwen-engine-windows.sh`, or import an independently reviewed bundle with `scripts/import-qwen-engine.ps1`. The importer rejects incomplete legal/runtime bundles, runs `--self-test` and `--caps` on Windows, then records every file hash. A real CustomVoice Chinese synthesis and SenseVoice round trip are still required before declaring a release ready.

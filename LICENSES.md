# Third-party notices

VoxWeave application code is provided under the MIT License.

The optional inference backend is [gabriele-mastrapasqua/qwen3-tts](https://github.com/gabriele-mastrapasqua/qwen3-tts), Copyright (c) 2025 Gabriele Mastrapasqua, licensed under the MIT License.

Qwen3-TTS 0.6B CustomVoice and Base model weights are published by the Qwen team under Apache License 2.0. The offline resource directory keeps each model at a pinned revision with its own manifest and Apache notice; CustomVoice is the default for the preset narration voices, while Base is retained for voice cloning.

OpenBLAS is Copyright (c) 2011-2014, The OpenBLAS Project, and is distributed under the BSD 3-Clause License. The reviewed Windows engine bundle includes OpenBLAS 0.3.34, LLVM-MinGW winpthreads, LZ4 notices, the required DLLs, and hash-verified build metadata under `resources/engine/`.

FFmpeg 8.1 is distributed under LGPL v2.1 or later. VoxWeave uses the Windows x64 LGPL build produced by [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds). Its complete build license is bundled at `resources/ffmpeg/LICENSE.txt`; corresponding source and reproducible build scripts are available from that repository and [ffmpeg.org](https://ffmpeg.org/).

[HyperFrames Player and Producer](https://github.com/heygen-com/hyperframes) are distributed under the Apache License 2.0. VoxWeave keeps both behind a renderer-neutral EditPlan boundary. Producer is installed for integration work but is not yet enabled in the default production path.

[Puppeteer](https://github.com/puppeteer/puppeteer) is distributed under the Apache License 2.0. The npm dependency is pinned for HyperFrames compatibility; a browser binary is not currently bundled.

[`@node-rs/jieba`](https://github.com/napi-rs/node-rs) is distributed under the MIT License and provides local Chinese word segmentation.

[`sherpa-onnx`](https://github.com/k2-fsa/sherpa-onnx) is distributed under the Apache License 2.0 and provides the native ONNX Runtime integration for local alignment. The pinned SenseVoiceSmall weights are redistributed under the bundled FunASR Model Open Source License Agreement v1.1, which requires source/author attribution and retention of the model name. Silero VAD is MIT-licensed. Model files and all three notices are hash-verified under `resources/models/sensevoice-small/`; commercial distribution should still receive a license review because the FunASR model agreement is a custom license.

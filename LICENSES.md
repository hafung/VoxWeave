# Third-party notices

VoxWeave application code is provided under the MIT License.

The optional inference backend is [gabriele-mastrapasqua/qwen3-tts](https://github.com/gabriele-mastrapasqua/qwen3-tts), Copyright (c) 2025 Gabriele Mastrapasqua, licensed under the MIT License.

Qwen3-TTS 0.6B Base model weights are published by the Qwen team under Apache License 2.0 and are bundled in the complete offline distribution together with their upstream metadata.

OpenBLAS is Copyright (c) 2011-2014, The OpenBLAS Project, and is distributed under the BSD 3-Clause License. VoxWeave bundles its native Windows runtime and the required MinGW-w64 runtime libraries.

FFmpeg 8.1 is distributed under LGPL v2.1 or later. VoxWeave uses the Windows x64 LGPL build produced by [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds). Its complete build license is bundled at `resources/ffmpeg/LICENSE.txt`; corresponding source and reproducible build scripts are available from that repository and [ffmpeg.org](https://ffmpeg.org/).

[HyperFrames Player and Producer](https://github.com/heygen-com/hyperframes) are distributed under the Apache License 2.0. VoxWeave keeps both behind a renderer-neutral EditPlan boundary. Producer is installed for integration work but is not yet enabled in the default production path.

[Puppeteer](https://github.com/puppeteer/puppeteer) is distributed under the Apache License 2.0. The npm dependency is pinned for HyperFrames compatibility; a browser binary is not currently bundled.

[`@node-rs/jieba`](https://github.com/napi-rs/node-rs) is distributed under the MIT License and provides local Chinese word segmentation.

[`sherpa-onnx`](https://github.com/k2-fsa/sherpa-onnx) is distributed under the Apache License 2.0. Its Node package provides the native ONNX Runtime integration planned for local SenseVoice alignment. SenseVoice and Silero model files are not yet bundled; their notices and hashes must be added when the model resource closure is implemented.

# VoxWeave · Private, local AI voice creation

<p align="center">
  <strong>Turn scripts into expressive, production-ready speech—on your own computer.</strong><br>
  No cloud upload. No subscription. No discrete GPU required.
</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="https://github.com/hafung/VoxWeave/releases/latest">Download for Windows</a> ·
  <a href="#command-line">CLI</a>
</p>

VoxWeave (声织) is a local-first voice studio for video makers, podcasters, educators, and developers. It combines a focused desktop editor with a scriptable CLI and a native C inference engine powered by Qwen3-TTS 0.6B.

Your drafts, reference voices, and generated audio stay on your machine. The Windows offline package is being closed as an extracted directory: the app executable and external engine, model, and FFmpeg resources live side by side, with no customer-side model download.

> **Current release:** v0.2.1 for Windows x64. macOS and Linux packages are on the roadmap; the application layer is already built on cross-platform Electron, React, TypeScript, and C.

## Why creators use VoxWeave

- **Keep unreleased content private.** Scripts and voice samples are processed locally instead of being sent to a third-party API.
- **Create on ordinary hardware.** CPU inference and INT8/INT4 modes make local voice production possible without a discrete GPU.
- **Spend time editing, not configuring.** The Windows release layout bundles pre-downloaded models, the native engine runtime, and FFmpeg as inspectable external resources.
- **Control the performance.** Add exact pauses such as `[pause:500ms]`, reuse cloned voices, and tune temperature, Top-k, Top-p, seed, and threads.
- **Fit it into a real workflow.** Export WAV, FLAC, MP3, Ogg/Opus, or M4A/AAC from the GUI or automate batches with the CLI.
- **Stay responsive on long jobs.** Inference runs in an isolated native process, so loading a model or cancelling a task does not freeze the editor.

## What it can do today

- Text-to-speech in the 10 languages supported by Qwen3-TTS, including Chinese, English, and Japanese
- Instant voice cloning with Qwen3-TTS 0.6B Base from a reference audio file and optional transcript
- Reusable `.qvoice` voice profiles
- Exact `[pause:500ms]` and `<break time="1s"/>` pauses inserted at the PCM level
- Experimental `[laugh]` and `[sigh]` performance tags
- BF16, INT8, and INT4 inference controls
- Automatic normalization of common reference-audio formats to 24 kHz mono PCM
- Shared parsing, inference settings, audio assembly, and transcoding behavior across GUI and CLI

## Download and run offline

Download the latest Windows build from [GitHub Releases](https://github.com/hafung/VoxWeave/releases/latest).

- **Setup EXE (recommended):** installs once and starts quickly in everyday use.
- **Portable directory ZIP:** extract once; models, engine, and FFmpeg remain separate files under `resources`, and the app starts directly from the extracted directory.

For a local build, extract the ZIP and launch `VoxWeave.exe`; do not run it from inside the archive.

The current directory build has passed a packaged-EXE sample on the build host; customer clean-machine acceptance remains a release gate. Customers will not need Node.js, an account, API key, Python, WSL, or a model download. An engine/model override remains available in Settings for developers testing custom builds.

## Command line

The complete Windows installation includes a CLI and does not require Node.js:

```powershell
& 'C:\Users\you\AppData\Local\Programs\voxweave\声织 VoxWeave.exe' --cli `
  -t 'Hello [pause:300ms] from VoxWeave.' -o .\hello.mp3 -f mp3 -l English

& 'C:\Users\you\AppData\Local\Programs\voxweave\声织 VoxWeave.exe' --cli --help
```

You can also call `resources\cli\voxweave.cmd` from the installation directory. Output formats are `wav`, `flac`, `mp3`, `opus`, and `m4a`; reference audio may be WAV, FLAC, MP3, Ogg/Opus, or M4A/AAC.

## Develop from source

The desktop application requires Node.js 22+ and pnpm:

```bash
pnpm install
pnpm dev
```

Quality checks:

```bash
pnpm typecheck
pnpm test
pnpm build
```

On an online Windows build machine, populate the external resources once and build the directory package:

```powershell
.\scripts\download-model.ps1 -Variant custom-0.6b
.\scripts\download-model.ps1 -Variant base-0.6b
.\scripts\setup-sensevoice.ps1
.\scripts\setup-ffmpeg.ps1
pnpm verify:resources
pnpm package:win
```

`package:win` creates `release\VoxWeave-Portable-<version>-<arch>.zip`; `package:win:installer` additionally requests an NSIS Setup build. Both strictly verify the model, native Qwen engine, runtime DLL, FFmpeg, and license closure first.

For CLI development, point VoxWeave to a compatible engine, model, and FFmpeg binary:

```powershell
$env:VOXWEAVE_ENGINE='C:\path\to\qwen_tts.exe'
$env:VOXWEAVE_MODEL='D:\models\qwen3-tts-0.6b-base'
$env:VOXWEAVE_FFMPEG='C:\path\to\ffmpeg.exe'
pnpm cli --text 'Hello from VoxWeave.' --output .\hello.wav --language English
```

Multi-gigabyte model weights and redistributable binaries are kept out of Git. The setup scripts place them under `resources`, and the strict packager refuses to produce an offline deliverable while a required runtime file is missing.

## Architecture and platform direction

```text
src/       React creation studio
electron/  Desktop process, preload bridge, and native-engine adapter
shared/    Markup parser, types, and WAV assembly shared by GUI and CLI
cli/       Scriptable command-line entry point
engine/    Pinned native C inference engine source
scripts/   Model and engine setup helpers
```

Electron, React, TypeScript, and the native C backend are portable foundations. The current release pipeline, bundled DLL closure, and installer are Windows-specific. Releasing on macOS and Linux still requires platform-native engine builds, resource packaging, CI, and end-to-end validation.

VoxWeave is intended to grow beyond speech generation into a private creator toolkit: batch narration, timeline-aware audio, subtitle alignment, media assembly, and eventually local-first remixing and content production.

## Responsible use

Only clone a voice when you have the speaker's permission. Do not use VoxWeave for impersonation, fraud, harassment, or deceptive media. You are responsible for complying with applicable laws and platform disclosure rules.

## License and acknowledgements

VoxWeave application code is released under the [MIT License](LICENSE). The model, native engine, FFmpeg, OpenBLAS, fonts, and other dependencies retain their respective licenses; see [LICENSES.md](LICENSES.md) for details.

# 声织 VoxWeave · 私密、本地的 AI 语音创作台

<p align="center">
  <strong>把文案变成可直接用于作品的自然语音，一切都在你自己的电脑上完成。</strong><br>
  不上传云端 · 不按月付费 · 不需要独立显卡
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="https://github.com/hafung/VoxWeave/releases/latest">下载 Windows 版</a> ·
  <a href="#命令行">命令行</a>
</p>

声织 VoxWeave 是为视频博主、播客、知识区作者、教育工作者和开发者打造的本地语音工作台。它把专注好用的桌面创作界面、可自动化的 CLI 与 Qwen3-TTS 0.6B 原生 C 推理引擎组合在一起。

未发布的选题、口播文案、参考音色和生成结果都留在你的电脑里。Windows 完整离线发行包的目标是不需要 Python、WSL、单独下载模型或 NVIDIA 显卡；当前源码版仍在完成 Windows 原生引擎与真实样片验证。

> **当前版本：** v0.2.1，支持 Windows x64。macOS 与 Linux 安装包在路线图中；应用层已经采用可跨平台的 Electron、React、TypeScript 与 C 技术栈。

## 它解决哪些创作者痛点

- **敏感文案不出本机。** 未发布脚本和真人音色无需交给第三方云服务，降低内容泄露与素材滥用风险。
- **普通电脑也能做 AI 配音。** 支持 CPU 推理与 INT8/INT4 模式，没有独立显卡也能建立自己的本地语音工作流。
- **下载后直接创作。** 完整离线发行包会带齐模型、原生引擎依赖和 FFmpeg，不用在客户机器上处理 Python、CUDA 或模型下载。
- **不是“生成完再凑合剪”。** 用 `[pause:500ms]` 写入精确停顿，复用克隆音色，并可调温度、Top-k、Top-p、随机种子和线程数。
- **真正进入生产流程。** GUI 可快速试听与导出，CLI 可做批量旁白；支持 WAV、FLAC、MP3、Ogg/Opus、M4A/AAC。
- **长任务也不拖死界面。** 推理运行在隔离的原生子进程中，模型加载、任务取消与异常不会把编辑器一起卡住。

## 目前已经能做什么

- 文本转语音，覆盖 Qwen3-TTS 支持的 10 种语言，包括中文、英文和日文
- 使用 Qwen3-TTS 0.6B Base，通过参考音频与可选原文即时克隆音色
- 保存并复用 `.qvoice` 音色文件
- 支持 `[pause:500ms]` / `<break time="1s"/>`，在 PCM 层插入精确静音
- 实验性 `[laugh]`、`[sigh]` 表演标签
- BF16 / INT8 / INT4、温度、Top-k、Top-p、随机种子与线程数控制
- 常见参考音频自动标准化为 24 kHz 单声道 PCM
- GUI 与 CLI 共用文本解析、推理参数、音频拼接和转码逻辑

## 下载并完全离线运行

前往 [GitHub Releases](https://github.com/hafung/VoxWeave/releases/latest) 下载最新版：

- **Setup 安装版（推荐）：** 只在安装时展开一次资源，日常启动更快。
- **Portable 目录版：** 下载 ZIP 后解压，模型、引擎和 FFmpeg 作为独立资源文件保留在目录中，双击应用即可启动。

本地构建产物可直接双击解压目录中的 `VoxWeave.exe`；不要在 ZIP 内直接运行。

当前目录发行包已通过本机打包后 EXE 样片；正式发布前仍需完成客户干净机验收。客户侧不需要 Node.js、账号、API Key、Python、WSL 或另行下载模型。设置页仍提供引擎和模型覆盖入口，方便开发者测试自定义版本。

## 命令行

Windows 完整版自带 CLI，不需要 Node.js：

```powershell
& 'C:\Users\你\AppData\Local\Programs\voxweave\声织 VoxWeave.exe' --cli `
  -t '你好，[pause:500ms] 欢迎使用声织。' -o .\hello.mp3 -f mp3 -l Chinese

& 'C:\Users\你\AppData\Local\Programs\voxweave\声织 VoxWeave.exe' --cli --help
```

也可以直接调用安装目录内的 `resources\cli\voxweave.cmd`。输出格式支持 `wav`、`flac`、`mp3`、`opus` 和 `m4a`；参考音频支持 WAV、FLAC、MP3、Ogg/Opus 与 M4A/AAC。

## 从源码开发

桌面应用需要 Node.js 22+ 与 pnpm：

```bash
pnpm install
pnpm dev
```

质量检查：

```bash
pnpm typecheck
pnpm test
pnpm build
```

在可联网的 Windows 构建机上先一次性准备外部资源，再生成目录便携包：

```powershell
.\scripts\download-model.ps1 -Variant custom-0.6b
.\scripts\download-model.ps1 -Variant base-0.6b
.\scripts\setup-sensevoice.ps1
.\scripts\setup-ffmpeg.ps1
.\scripts\setup-render-browser.ps1
pnpm verify:resources
pnpm package:win
```

`package:win` 自动构建并生成 `release\VoxWeave-Portable-<version>-x64\VoxWeave.exe`、同名 ZIP 和 SHA-256 文件；`package:win:installer` 会额外请求 NSIS Setup。两者都会先严格校验模型、原生 Qwen 引擎、依赖 DLL、FFmpeg、渲染浏览器和许可证闭包。资源已准备好时无需重新下载。

当前开发发行物为 `release\VoxWeave-Portable-0.2.2-x64` 和同名 ZIP。0.2.1 是旧界面包，顶部“素材库”会直接打开文件选择框；0.2.2 会打开完整素材管理界面。

同名发行目录或 ZIP 已存在时脚本会停止，保留旧包。新版本先更新 `package.json` 版本；同版本临时测试可指定其他输出目录：

```powershell
pnpm package:win -ReleaseDir .\release-test
pnpm smoke:package:win -PackageDir .\release-test\VoxWeave-Portable-0.2.2-x64 -WithExport
```

打包请使用 Windows Node/pnpm 和 Windows 安装的依赖，不要复用 WSL 的 `node_modules`。开发环境若同时使用两者，可用独立 Windows staging 目录，并通过打包脚本的 `-ProjectDir`、`-ResourceDir`、`-ReleaseDir` 指定输入与输出；`-SkipBuild` 仅适用于已同步最新构建产物的目录。

开发 CLI 时，需要指定兼容的引擎、模型和 FFmpeg：

```powershell
$env:VOXWEAVE_ENGINE='C:\path\to\qwen_tts.exe'
$env:VOXWEAVE_MODEL='D:\models\qwen3-tts-0.6b-base'
$env:VOXWEAVE_FFMPEG='C:\path\to\ffmpeg.exe'
pnpm cli --text '你好，欢迎使用声织。' --output .\hello.wav --language Chinese
```

数 GB 的模型权重与可再发行二进制不会进入 Git。准备发行资源时由仓库脚本下载到 `resources`，严格打包脚本会在任何必需运行时缺失时拒绝生成离线包。

## 架构与跨平台方向

```text
src/       React 创作台界面
electron/  桌面主进程、预加载桥和原生引擎适配器
shared/    GUI/CLI 共用标记解析、类型与 WAV 拼接
cli/       可脚本化命令行入口
engine/    固定版本的原生 C 推理引擎源码
scripts/   模型和引擎准备工具
```

Electron、React、TypeScript 和原生 C 后端都具备跨平台基础。目前的发行流水线、DLL 资源闭包和安装程序仍是 Windows 专用；真正发布 macOS/Linux 版本还需要对应平台的引擎构建、资源打包、CI 和端到端验证。

当前开发版本已支持“文案 + 可选原视频 → TTS → 字幕对齐 → 本地素材补画面 → 预览 → MP4 导出”。预览生成后可选择本地 BGM、调整音量和人声闪避，先应用试听，再导出 H.264/AAC 视频。

顶部“素材库”支持多选导入视频、图片和音频、检索、预览、批量人工标签及规则自动标签。Pexels 页可配置 API Key，使用中英文关键词搜索并选择下载免费图片/视频；下载素材保留作者和许可来源。没有 Key 也可以完整使用本地流程。自动标签目前基于文件名、目录和媒体属性，不代表视觉 AI 内容识别。

新构建机需要先运行 `scripts/setup-render-browser.ps1` 与 `scripts/setup-ffmpeg.ps1`。导出使用固定的离线浏览器和包含 libx264 的 FFmpeg **GPL** 包；详细许可证见 `LICENSES.md`。此开发版本已验证短样片导出，更新后的安装包与长视频压力验收尚未完成。

自动成片方向已经明确为“文案 + 可选原始视频 → TTS → 逐词字幕 → 自动 B-roll → 成品视频”，而不是通用剪辑器。详细决策见：

- [自动成片产品方案](docs/product-spec.zh-CN.md)
- [自动成片开发文档](docs/development.zh-CN.md)

## 负责任地使用

请只在获得说话人许可时克隆其声音。不得将声织用于冒充、诈骗、骚扰或制作欺骗性内容。使用者有责任遵守所在地法律及内容平台的 AI 标注规则。

## 开源协议与致谢

声织应用代码采用 [MIT License](LICENSE)。模型、原生引擎、FFmpeg、OpenBLAS、字体和其他依赖保留各自协议，详情见 [LICENSES.md](LICENSES.md)。

# 声织 VoxWeave 自动成片开发文档

> 本文描述目标架构、模块边界、数据流、里程碑和工程约束。实现状态以“当前进度”一节为准。

## 1. 技术决策

| 领域 | 选择 | 说明 |
| --- | --- | --- |
| 桌面端 | Electron 44 + React 19 + TypeScript | 延续现有工程；只支持当前受维护 Electron 主版本 |
| 业务协议 | Zod 校验的 EditPlan v1 | 不绑定具体渲染器 |
| TTS | 现有 Qwen3-TTS C 引擎 | 旁白分段生成，结果缓存 |
| 中文分词 | `@node-rs/jieba` | Node-API 预编译包，自定义词典 |
| ASR/对齐 | `sherpa-onnx-node` + SenseVoiceSmall INT8 | C++/ONNX Runtime，本地 CPU，提供 token 起始时间 |
| VAD | sherpa-onnx + Silero VAD | 长音频切段和末词边界 |
| 预览 | `@hyperframes/player` | 在隔离 iframe 中播放可 seek composition |
| 渲染 | HyperFrames Producer，保留适配层 | 已精确锁定 Producer/Puppeteer；浏览器资源仍需闭包验证 |
| 媒体处理 | FFmpeg + ffprobe | 探测、代理、混音和最终编码 |
| 素材索引 | SQLite + FTS5 | 媒体文件不写入数据库 |
| 打包 | electron-builder | Windows x64 优先 |

## 2. 模块边界

建议逐步形成以下目录：

```text
shared/
  edit-plan.ts          EditPlan schema、类型和通用校验
  captions.ts           与运行时无关的字幕数据结构

electron/
  composition/          自动成片编排服务
    planner.ts          文案到 draft plan
    resolver.ts         TTS 后解析时间并选择素材
  alignment/
    sensevoice.ts       sherpa-onnx 适配器
    align-text.ts       ASR token 与原文对齐
  library/
    database.ts         SQLite 与迁移
    importer.ts         素材导入
    search.ts           标签/FTS 检索和排序
  media/
    ffmpeg.ts           安全参数化调用
    probe.ts            ffprobe 数据归一化
    proxy.ts            缩略图、关键帧和代理
  renderers/
    renderer.ts         Renderer 接口
    hyperframes.ts      EditPlan 到 composition 的编译和渲染
  jobs/
    queue.ts            可持久化后台任务

src/
  features/create/      极简创建页
  features/preview/     预览与单分镜换素材
  features/library/     素材库维护
```

Renderer 接口不得泄露 HyperFrames 类型：

```ts
interface VideoRenderer {
  prepare(plan: ResolvedEditPlan, workspace: string): Promise<PreparedComposition>;
  render(input: RenderRequest, onProgress: RenderProgressHandler): Promise<RenderResult>;
  cancel(jobId: string): Promise<void>;
}
```

## 3. EditPlan 数据约束

- 所有时间统一使用整数毫秒；只在渲染适配器中换算为帧或秒。
- `schemaVersion` 必填；读取旧工程时先迁移再校验。
- `draft` 允许素材未解析，`resolved` 必须有旁白文件、真实时长和确定素材。
- 分镜按 `startMs` 排序，不得重叠，必须覆盖旁白时长；允许显式标记的空白转场。
- caption token 必须落在对应 cue 内，cue 必须落在旁白时长内。
- 素材路径不直接进入 renderer；先通过 `assetId` 解析并验证。
- 每次重新选择素材产生新的 plan revision，避免原地破坏已渲染版本。

## 4. 自动成片流水线

```text
createDraftPlan
  → synthesizeNarration
  → probeNarration
  → alignCaptions
  → analyzeOptionalSource
  → resolveVisualSlots
  → resolveBgm
  → validateResolvedPlan
  → compileComposition
  → render
  → verifyOutput
```

每一步都应：

- 接收结构化输入并返回结构化输出；
- 支持取消；
- 写入任务进度；
- 使用输入 hash 缓存；
- 失败后保留上一步产物；
- 不从 renderer 进程接受任意 shell 命令。

## 5. TTS 与字幕对齐

### 5.1 旁白生成

按自然句或较短语义段生成 WAV，同时保存每段在最终拼接音频中的起止时间。精确停顿仍由当前 markup 解析器处理。

缓存键至少包含：

```text
normalizedText + voiceId/voiceHash + language + temperature +
topK + topP + seed + precision + engineVersion + modelVersion
```

### 5.2 SenseVoice 适配器

模型资源不通过 npm 包隐式下载，放入 `resources/models/sensevoice-small/`，并在构建清单中记录：

- ONNX 模型；
- `tokens.txt`；
- Silero VAD 模型；
- 模型许可证和来源；
- 模型 hash 与版本。

适配器输出统一为：

```ts
interface AcousticToken {
  text: string;
  startMs: number;
  endMs?: number;
  confidence?: number;
}
```

SenseVoice 的识别 token 与原文使用规范化、编辑距离/动态规划对齐。首选原文文字，不用识别文本覆盖用户文案。词结束时间优先使用下一 token 起点；段落最后一词使用 VAD 段落终点。

### 5.3 jieba 聚合

先对原文分词，再把已对齐字符时间聚合到自然词。字幕词组按以下规则继续合并：

- 遇标点强制断组；
- 单组建议 4–10 个汉字；
- 单组建议持续 0.8–2.2 秒；
- 专有词不得拆分；
- 超过两行或安全区宽度时提前断组。

## 6. B-roll 规划

每个语义段生成 `VisualIntent`：

```ts
interface VisualIntent {
  keywords: string[];
  mood?: string[];
  preferredTypes: Array<'source' | 'video' | 'image' | 'kinetic-text'>;
  avoidAssetIds: string[];
  minDurationMs: number;
  orientation: 'portrait' | 'landscape' | 'square';
}
```

首版排序函数由可解释分数组成：

```text
tagScore + fullTextScore + orientationScore + qualityScore
- reusePenalty - licensePenalty - cropPenalty
```

原始视频导入后作为高优先级素材集合参与同一排序。单镜头连续使用超过模板阈值时，规划器主动创建新的 B-roll 插槽。

## 7. HyperFrames 集成

### 7.1 原则

- EditPlan 是 source of truth；HyperFrames composition 是可删除的编译产物。
- 只使用固定模板和允许列表中的 CSS/动画参数。
- 不执行模型或用户生成的任意 JavaScript。
- 预览 composition 与最终渲染 composition 使用相同模板版本和字体资源。
- 模板版本写入 EditPlan，避免升级模板后旧工程视觉漂移。

### 7.2 依赖闭包与剩余验证

截至 2026-09-14，`@hyperframes/producer@0.8.38` 的 Puppeteer 范围会尝试解析尚未发布的 `puppeteer-core@25.11.0`。当前工程通过精确锁定 `puppeteer` 和 `puppeteer-core` 为 `25.10.0`，已完成可复现安装和 Producer API 导入验证；升级三者时必须一起验证，不能只放宽单个版本。

pnpm 默认忽略 Puppeteer 的浏览器下载脚本，因此当前依赖安装不包含可供 Producer 使用的 Chrome。进入默认生产路径前仍需：

1. 将通过校验的 Chrome for Testing/Headless Shell 作为显式构建资源，并配置 `chromePath`；
2. 验证 electron-builder 正确包含浏览器、字体和 Producer 资源；
3. 完成 60 秒竖屏压力样片；
4. 记录临时磁盘、峰值内存、渲染耗时和取消清理行为；
5. 验证 Windows 安装版在无系统 Chrome 的机器上可以离线渲染。

Player 可以先行用于 composition 预览；浏览器资源闭包和黄金样片通过前，Producer adapter 不进入默认生产路径。

## 8. 安全边界

- Renderer、FFmpeg、ASR 和 TTS 都运行在 Electron 主进程控制的子进程/worker 中。
- Renderer IPC 的每个入口使用 Zod 验证，不接受 renderer 传入的任意输出路径或命令参数。
- 用户素材通过内部 asset ID 访问；预览 composition 使用受控本地协议，不直接暴露任意 `file://`。
- HyperFrames Player 使用不透明 sandbox origin，除非某项已审核功能明确需要同源 DOM 访问。
- 临时目录使用每任务独立目录；取消、失败和退出时可回收。

## 9. 测试策略

### 单元测试

- EditPlan schema 与跨字段约束；
- 文案分段、jieba、自定义词典；
- token/原文对齐；
- 素材排序和重复惩罚；
- 时间到帧换算；
- renderer 模板转义。

### 集成测试

- TTS → WAV → 对齐 → caption tokens；
- ffprobe → 媒体元数据；
- resolved plan → composition；
- composition → 短 MP4；
- 取消任务和恢复任务。

### 黄金样片

至少维护：纯图片、纯 B-roll、有原始视频、中英混合、长停顿、无 BGM、竖屏裁切七类样片。除了视觉快照，使用 ffprobe 校验时长、尺寸、帧率、音视频轨和编码。

## 10. 里程碑

### M0：基础协议与依赖

- [x] 产品方案和开发文档；
- [x] Electron 44；
- [x] HyperFrames Player/Producer、jieba、sherpa-onnx 依赖；
- [x] EditPlan v1 schema 与测试；
- [x] EditPlan 原子持久化与不可变修订；
- [x] Renderer 接口；
- [x] HyperFrames Producer/Puppeteer 可复现安装与 API 兼容性 spike；
- [ ] Producer 浏览器资源闭包与短样片渲染。

### M1：文案到可预览 composition

- [x] 极简创建页；
- [x] TTS 分段产物和真实时长；
- [x] draft → resolved plan；
- [x] jieba 初始字幕分组；
- [x] 静态图片/动态图形模板；
- [x] HyperFrames Player 预览集成；
- [x] Windows x64 Electron 44 实机启动冒烟。

### M2：SenseVoice 与素材库

- [x] SenseVoice INT8 + Silero VAD 资源闭包（固定模型、完整许可证、SHA-256 manifest 与 Windows 原生推理冒烟）；
- [x] token/原文对齐；
- [x] SQLite/FTS5；
- [x] 素材导入、缩略图和标签；
- [x] B-roll 自动选择和单分镜替换。

### R1：Windows 离线发行闭包

- [x] 原生 `qwen_tts.exe`、OpenBLAS/winpthreads DLL、许可证与可复现构建信息；
- [x] Windows `--self-test`、`--caps`、UTF-8 中文最短旁白；
- [x] 打包后 TTS → SenseVoice/Silero → HyperFrames Player 实机样片；
- [x] 模型独立存放的目录 Portable 包与 ZIP/SHA-256。

### M3：稳定渲染

- [ ] Producer 或等价 renderer；
- [ ] BGM 闪避与响度；
- [ ] 可恢复任务；
- [ ] 硬件编码探测；
- [ ] 黄金样片和 Windows 安装包验证。

## 11. 当前进度

截至 2026-09-16，M1 的代码纵向切片已经完成：极简创建页可提交文案和可选原视频，composition job 会保存 draft、按分镜生成带稳定缓存键的 WAV、探测真实时长、生成连续覆盖旁白的 resolved 新修订，并编译只引用本地 GSAP/HyperFrames runtime 的固定模板。预览通过受控 `voxweave-preview://` 协议和 sandboxed HyperFrames Player 加载，支持播放、暂停、seek、阶段进度、取消、错误后重新生成、重启恢复和分镜卡片换画面。动态图形与字幕使用独立 composition/GSAP 时间线，Windows 冒烟同时断言 Player ready、scene 数、播放后时间和预览区域非黑像素比例。启动恢复与新任务并发时的旧预览覆盖竞态也已消除。原视频短于旁白时会在精确出点后切换为 kinetic-text 兜底。

M2 已完成：SenseVoiceSmall INT8、Silero VAD 和 FFmpeg/ffprobe 已下载到外部 `resources` 目录，下载脚本锁定来源版本并校验 SHA-256；SenseVoice 的发行包许可证指针、固定 revision 的 FunASR Model Open Source License Agreement v1.1 和 Silero MIT 文本均随资源保存并参与哈希校验。适配器、16 kHz VAD、识别 token 到已知原文的动态规划对齐、jieba 词组回聚合、Node SQLite/FTS5 索引、SHA-256 去重、ffprobe 元数据、FFmpeg 缩略图、文件名/人工标签、可解释检索评分、授权和重复惩罚、自动 B-roll 与不可变单分镜替换均已接入。资源缺失时流水线仍明确降级到 TTS 估时字幕，不丢失 resolved 工程。

兼容性记录：`@hyperframes/core`、`@hyperframes/player`、`@hyperframes/producer` 固定为 `0.8.38`，`gsap` 固定为 `3.14.2`，`puppeteer`/`puppeteer-core` 固定为 `25.10.0`。composition 编译时从已安装包复制 runtime 和 GSAP，不依赖 CDN；Manrope 与 Noto Sans SC 字体已进入 Vite 构建产物。Player 0.8.38 的跨源 iframe 会出现 ready/load 先后竞态，冒烟必须等待目标 `src` 对应的新 Player；模板不能给框架管理的 clip 写死 `opacity:0`。Windows 宿主使用 `C:\Users\admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`（Node v24.19.0）完成原生生产构建和 Electron 启动；Electron 44.3.0 / Chromium 152.0.7977.78 / x64 冒烟通过。`sherpa-onnx-node` 1.13.8 在同一 Windows x64 环境加载真实 SenseVoice/Silero 资源成功；为规避 Electron 退出时第三方原生 addon 崩溃，对齐改在 `ELECTRON_RUN_AS_NODE` 隔离子进程中执行。固定的 FFmpeg `n8.1.2-52-g5a03dfa0f6` 与 ffprobe 也已在 Windows 运行。

验证边界必须继续区分：原生 Qwen 引擎使用 LLVM-MinGW 20260908 / LLVM 23.1.1、OpenBLAS 0.3.34、LZ4 1.10.0 构建为 UCRT x64/AVX2+FMA 目标，`--self-test`、`--caps` 和 UTF-8 `你好。` 实际合成均已在 Windows 通过；该 1.36 秒、24 kHz 单声道 WAV 随后由 SenseVoice/Silero 对齐并进入 Player。Qwen CustomVoice revision `85e237c12c027371202489a0ec509ded67b5e4b5` 是默认预设音色模型，Base 模型用于克隆，两者仍是目录内的外部文件，不进入 Git 或单个 EXE。开发态和打包后 EXE 的完整 TTS → SenseVoice → Player 样片都已通过；Producer 最终 MP4 渲染仍未走通，也未进入默认路径。

离线交付采用“目录 Portable ZIP”，不是把模型塞进单个 EXE：应用、`resources/models`、`resources/engine`、`resources/ffmpeg` 并列保存。严格资源校验通过，共 54 个文件、5,571,818,489 字节；引擎 manifest 同时锁定源码 commit/diff/tree hash、导入 DLL 和各许可证。当前本地发行物为 `release/VoxWeave-Portable-0.2.1-x64/`（约 5.8 GiB）及同名 ZIP（约 4.4 GiB），顶层入口固定为跨区域兼容的 `VoxWeave.exe`，ZIP SHA-256 为 `70f018f3a20774486f16b818ba46bbd735ad98888ad49b9cdc3a0750828f2f14`。打包后 EXE 已在本宿主机不经 Node.js 完成 1.36 秒中文样片和可见画面断言；真正客户干净机仍需人工验收。Producer 所需的 Chrome for Testing 属于 M0/M3 最终渲染闭包，不与 Electron 自带 Chromium 的预览启动混为一谈。

每次实现应同时更新里程碑勾选项和关键兼容性记录，避免文档成为一次性设计稿。

## 12. 下一迭代执行计划

### 12.1 目标

完成 M0 最后一个未完成项：为 HyperFrames Producer 建立固定版本、可校验、可随 Windows 离线包分发的浏览器资源闭包，并从现有 `PreparedComposition` 渲染一条最短 MP4。此批只证明 renderer 边界和短样片可工作，不同时扩展 BGM、硬件编码或完整黄金样片矩阵。

### 12.2 实施顺序

1. **冻结浏览器资源**
   - 选择与 Puppeteer 25.10.0 兼容的 Chrome for Testing/Headless Shell x64 版本；
   - 固定官方下载 URL、版本、SHA-256、许可证和目录布局，不依赖 Puppeteer 安装脚本隐式下载。
2. **实现 Producer adapter**
   - 在 `VideoRenderer` 边界内接入 `@hyperframes/producer@0.8.38`；
   - 只接受已验证的 `PreparedComposition`、目标文件和渲染参数，显式传入 `chromePath`；
   - 把进度、取消、子进程退出和错误统一映射回现有 composition job。
3. **最短 MP4 样片**
   - 使用现有本地 kinetic-text、旁白和字幕 composition 渲染 1–3 秒 MP4；
   - 用 ffprobe 断言时长、尺寸、视频轨、音频轨和编码，不只检查文件存在。
4. **离线打包闭包**
   - 将浏览器资源加入严格 verifier、分项 manifest、许可证和 electron-builder `extraResources`；
   - 从打包后 EXE 触发一次短渲染，确认没有回退到系统 Chrome 或联网下载。
5. **测试与文档**
   - 增加 adapter 参数校验、取消和错误路径测试；
   - 运行 `pnpm typecheck`、`pnpm test`、`pnpm build`，更新第 10–12 节。

### 12.3 完成标准

- 浏览器二进制、许可证和 SHA-256 都有固定 manifest，断网机器不触发下载；
- Producer adapter 不绕过 `VideoRenderer`，也不接受任意 shell 参数；
- 1–3 秒样片在开发态和打包后 EXE 中均能完成，ffprobe 结构断言通过；
- 取消和失败不会遗留 Chrome/FFmpeg 子进程或半成品目标文件；
- 此批完成后只勾选 M0 浏览器资源闭包，不提前宣称 M3 稳定渲染完成；
- 类型检查、自动测试和生产构建全部通过。

### 12.4 推荐拆分

为了让每次变更可审查，按以下连续开发批次推进：

1. **M1-A（已完成）：** TTS composition service、真实时长、resolver 与单元测试；
2. **M1-B（已完成）：** 固定模板编译器、HyperFrames Player 与预览集成；
3. **M1-C（已完成）：** 极简创建页、进度/取消/恢复已完成；Linux Xvfb 与 Windows x64 Electron 44 启动冒烟均已通过。
4. **M2 离线资源闭包（已完成）：** SenseVoiceSmall INT8、Silero VAD、FFmpeg/ffprobe、字体、版本清单和许可证已落盘；Windows 原生 ASR/VAD 与媒体探测已用真实资源验证。
5. **R1-A Windows 离线发行闭包（已完成）：** 原生 `qwen_tts.exe`、依赖 DLL、许可证和可复现构建信息已闭包；`--self-test`、`--caps`、UTF-8 中文旁白、TTS → SenseVoice → Player、打包后 EXE 和目录 Portable ZIP 均已在 Windows 实机通过。Qwen CustomVoice 是默认预设音色模型，Base 模型用于克隆，两者均为独立资源文件。

第一个未完成批次现在是 M0 的 Producer 浏览器资源闭包与短样片渲染；完成后继续 M3 的最终 MP4 稳定化。

下一批只处理 Producer 浏览器闭包与最短 MP4；BGM、硬件编码和完整黄金样片留在 M3，避免范围失控。

## 13. AI 接棒约定

新的开发会话开始时，AI 应先阅读：

1. `docs/product-spec.zh-CN.md`；
2. 本开发文档，尤其是第 10–13 节；
3. `shared/edit-plan.ts`、`electron/composition/` 和 `electron/renderers/renderer.ts`；
4. 当前 `git status`、相关测试和最近变更，不覆盖用户已有修改。

接着从第 12.4 节第一个未完成批次继续，实现代码和测试，而不是只输出新方案。完成一批后必须：

- 更新第 10 节里程碑和第 11 节当前进度；
- 记录新增的版本锁定、资源闭包或兼容性问题；
- 执行并汇报 `pnpm typecheck`、`pnpm test`、`pnpm build`；
- 清楚区分“依赖已安装”“预览已走通”和“最终渲染已走通”。

可直接把下面这段交给下一次 AI：

> 继续开发 VoxWeave。先完整阅读 `docs/product-spec.zh-CN.md`、`docs/development.zh-CN.md` 第 10–13 节、`shared/edit-plan.ts`、`electron/composition/`、`electron/renderers/renderer.ts`，并检查当前 `git status`。从第 12.4 节第一个未完成批次继续，本次完成 M0 的 Producer 浏览器资源闭包与 1–3 秒短 MP4，不要只输出方案。完成后更新开发文档，并运行 `pnpm typecheck`、`pnpm test`、`pnpm build`，汇报验证结果、剩余风险和下一个未完成批次。

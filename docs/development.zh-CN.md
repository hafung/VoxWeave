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

- [ ] 极简创建页；
- [ ] TTS 分段产物和真实时长；
- [ ] draft → resolved plan；
- [ ] jieba 初始字幕分组；
- [ ] 静态图片/动态图形模板；
- [ ] HyperFrames Player 预览。

### M2：SenseVoice 与素材库

- [ ] SenseVoice INT8 + Silero VAD 资源闭包；
- [ ] token/原文对齐；
- [ ] SQLite/FTS5；
- [ ] 素材导入、缩略图和标签；
- [ ] B-roll 自动选择和单分镜替换。

### M3：稳定渲染

- [ ] Producer 或等价 renderer；
- [ ] BGM 闪避与响度；
- [ ] 可恢复任务；
- [ ] 硬件编码探测；
- [ ] 黄金样片和 Windows 安装包验证。

## 11. 当前进度

已完成从“语音工作室”向“极简自动成片”的第一批底座：EditPlan v1、文案分镜草稿、jieba 关键词、版本化项目存储、renderer-neutral 接口和创建草稿 IPC。当前 UI 和实际渲染仍沿用/停留在原语音能力；下一个纵向切片是“文案 → TTS → resolved plan → 固定模板预览”。

每次实现应同时更新里程碑勾选项和关键兼容性记录，避免文档成为一次性设计稿。

## 12. 下一迭代执行计划

### 12.1 目标

完成第一个真正可操作的 M1 纵向切片：用户只输入文案，选择性提供一个原始视频，即可生成旁白、带时间的字幕与可播放的固定模板预览，并把结果保存为 `resolved` EditPlan。

本迭代暂不追求素材库自动检索、SenseVoice 精确对齐、复杂 B-roll 推荐和最终 MP4 导出。字幕先使用 TTS 分段真实时长加 jieba 权重估时，后续再由 SenseVoice 替换时间来源，保持 EditPlan 和 UI 不变。

### 12.2 实施顺序

1. **旁白产物服务化**
   - 抽取现有 TTS 调用为 composition service；
   - 按语义段生成或复用 WAV，拼接后使用 ffprobe 获取真实总时长；
   - 为产物生成稳定缓存键，并支持取消与进度回调。
2. **实现 draft → resolved resolver**
   - 根据真实旁白时长重新计算连续分镜区间；
   - 使用 jieba 生成词/词组字幕，并将时间来源标记为 `estimated`；
   - 有原始视频时生成受控裁切段，无原视频时生成 kinetic-text 占位画面；
   - 通过 `EditPlanSchema` 校验后写入新 revision，不覆盖旧修订。
3. **固定模板 composition 编译器**
   - 首个模板只支持背景、原视频/纯色画面、标题与逐词高亮字幕；
   - 转义全部文案，不执行用户或模型提供的 JavaScript；
   - composition 是临时编译产物，不能反向成为业务数据源。
4. **HyperFrames Player 预览**
   - 使用受控本地资源协议加载音频和视频；
   - 支持播放、暂停、seek，并保证画面与同一时间轴字幕同步；
   - Player 加载失败时显示可重试错误，不丢失已生成工程。
5. **极简创建页**
   - 默认只展示文案、可选原始视频和“生成视频”主按钮；
   - 音色、比例、字幕样式收进“更多设置”；
   - 展示生成阶段、进度、取消、错误恢复和预览，不提供传统时间线。
6. **验证和文档回写**
   - 增加 resolver、字幕估时、模板转义和 IPC 集成测试；
   - 使用无原视频与有原视频两条最短样例走通预览；
   - 运行 `pnpm typecheck`、`pnpm test`、`pnpm build`；
   - 在 Windows 上完成 Electron 44 启动检查，并更新本文件勾选项。

### 12.3 完成标准

- 文案为空或输入非法时，在进入 TTS 前返回明确错误；
- 不提供原视频也能生成完整预览；
- 提供原视频时能作为首选视觉源播放，时长不足部分由受控占位画面覆盖；
- resolved plan 从 `0ms` 连续覆盖到真实旁白末尾，字幕不越界；
- 关闭并重启应用后可以重新读取该 EditPlan；
- 取消任务不会遗留运行中的 TTS/媒体子进程；
- renderer 进程不能传入任意命令、脚本或未验证输出路径；
- 类型检查、自动测试和生产构建全部通过。

### 12.4 推荐拆分

为了让每次变更可审查，建议分为三个连续开发批次：

1. **M1-A：** TTS composition service、真实时长、resolver 与单元测试；
2. **M1-B：** 固定模板编译器、HyperFrames Player 与预览集成；
3. **M1-C：** 极简创建页、进度/取消/恢复和 Windows 冒烟测试。

除非实现时发现协议缺口，否则不要在 M1-A 中同时引入 SQLite 素材库、SenseVoice 模型或 Producer 最终渲染，避免纵向切片失控。

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

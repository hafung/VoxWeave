# Needle 3 接入评估（2026-09-23）

## 结论

Needle 3 适合做声织的**本地剪辑指令路由器**：把“把第三个分镜换成办公室画面”“背景音乐小一点”解析成受限的结构化动作，由声织自己的工程层执行。它不是语音识别器、视频渲染器，也不是开放式聊天模型。声织现有的 Windows 离线运行包已经不要求客户安装 Python；接入 Needle 不会改变这一点，但可直接使用其 Windows x64 原生运行器和 `.cact` 权重，不必在客户机安装 Python。

来源：[Needle 仓库](https://github.com/cactus-compute/needle)、[原生部署说明](https://cactuscompute.com/blog/needle-supported-devices)、[模型卡](https://huggingface.co/Cactus-Compute/needle3)。

### 音频支持核对（2026-09-23）

搜索索引仍能找到曾经支持 `complete(audio=...)` 的 `doc/apis.md`，但该页面已从当前仓库删除。更关键的是，公开的 Needle 3 权重提交记录明确写了“drop the speech vocabulary rows”，随后发布的原生头文件和 WASI 接口移除了 `audio` 参数。**当前公开的 Needle 3 不能据旧文档视为可直接处理音频**；声织的口述剪辑仍需使用现有 SenseVoice 或另一套 STT。以后若上游重新发布音频版本，需要按具体二进制与 API 版本重新验证。[权重提交记录](https://huggingface.co/Cactus-Compute/needle3/commits/main)、[移除音频参数的变更](https://huggingface.co/Cactus-Compute/needle3/commit/3e8e2a66057a29694052d915128b91b53e7e5ead)。

当前官方公开评测未给出中文剪辑指令准确率；英文工具调用指标不能替代中文多动作、否定句和数字参数的测试。官方微调说明也提醒非英语部署不能直接信任基础模型置信度。因此需要基于声织命令集自建中文样本测试，不能凭模型大小或英文榜单断言能正确执行中文口述命令。[官方微调说明](https://cactuscompute.com/blog/finetuning-needle)。

## 和现有架构的连接点

```text
麦克风 / 输入框
  → SenseVoice 转写（仅语音时；目前 SenseVoice 已用于旁白对齐）
  → Needle 3：只输出函数名、参数、置信度
  → 声织校验：工程版本、分镜 ID、参数范围、素材存在性
  → 显示操作预览 / 用户确认
  → EditPlan 新修订 → 预览重编译 → 可撤销
```

第一期建议只有 4–5 个动作，例如 `replace_scene_visual(scene_number, search_query)`、`set_bgm_volume(percent)`、`set_caption_style(style)`、`set_aspect_ratio(ratio)`、`export_video()`。每个动作都应有明确边界；目前工程层只实现了随机换画面和配乐更新，定向换素材、字幕风格修订、撤销栈等动作还需要单独实现。不要直接让模型修改 `EditPlan` JSON 或调用 FFmpeg。

Needle 官方建议工具少而窄；超过 5 个工具时会先检索，仅把最相关的 5 个放进当前推理。返回空调用表示无法处理，置信度低时可展示动作供确认。应用必须自行校验参数与执行权限。[工具设计](https://cactuscompute.com/blog/designing-tools-for-needle)、[Python API 行为说明](https://cactuscompute.com/blog/needle-python-docs)。

## 部署选择

推荐 Electron 主进程启动 `windows-x86_64/needle.exe` 本地子进程，加载随包固定版本的 `needle3.cact` 和 `tools.json`，通过本机 HTTP `POST /complete` 或单次 CLI 调用。先在独立进程隔离崩溃，再考虑 C API；`libneedle.a` 需要原生桥接，直接塞入渲染进程没有收益。官方还提供 WASM，但在当前 Electron 桌面架构中，原生进程更易管理资源和生命周期。推理可完全离线；官方二进制默认启用匿名遥测，离线产品启动时应设置 `NEEDLE_TELEMETRY=0` 与 `DO_NOT_TRACK=1`。[设备与运行器](https://cactuscompute.com/blog/needle-supported-devices)、[仓库部署说明](https://github.com/cactus-compute/needle#deploy)。

仓库与权重标记 Apache-2.0；打包时仍需固定下载版本、校验哈希，并将许可放入第三方清单。[源码许可](https://github.com/cactus-compute/needle/blob/main/LICENSE)、[权重模型卡](https://huggingface.co/Cactus-Compute/needle3)。

## 先验证再上线

1. 用 50–100 条真实中文剪辑命令和拒绝样例，测动作选择、参数准确率、误执行率、延迟。加入“不要换第三幕”“把第四幕改成……然后把音乐调低”这类否定和多动作指令。
2. 单独验证中文。官方文档说明非英语部署的基础模型置信度需要谨慎看待；目前没有看到针对中文剪辑指令的官方准确率。[微调说明](https://cactuscompute.com/blog/finetuning-needle)。
3. 只在测试集达到可接受误执行率后接入编辑动作。初期每次先展示“将执行什么”，用户确认后形成新修订；保留撤销。低置信度或无调用时不执行。
4. 若基础模型中文效果不足，再用本产品命令样本微调。官方说明本地 LoRA 微调后的 `confidence` 为 `None`，不能再把原阈值当成可靠安全门；需要自建验证策略。[微调说明](https://cactuscompute.com/blog/finetuning-needle)。

因此，“口述直接剪辑”在架构上可行，但 Needle 只承担文本到动作这一步。语音采集、SenseVoice 转写、可控编辑动作、确认与撤销都要由声织实现。本次只完成接入评估，未把未经中文验证的模型接到实际剪辑操作。

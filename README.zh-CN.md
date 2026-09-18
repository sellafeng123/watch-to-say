# YouTube Digest to Corpus Palace

[English](README.md) | [简体中文](README.zh-CN.md)

把每个 YouTube 视频变成一份可以深入学习的资料。YouTube Digest to Corpus Palace 把字幕、双语翻译、AI 概览、内容讲解和时间戳笔记放进同一个 Chrome 侧边栏，让你可以持续学习视频中的知识和语言，同时不丢失原视频上下文。

- 把零碎字幕变成清晰、可搜索的学习资料。
- 查看原文、简体中文翻译，或中英双语对照字幕来学习语言。
- 通过 AI 概览、章节、重点引用和选中文本讲解建立系统理解。
- 点击字幕、概览或笔记中的时间戳，快速跳转到对应位置。
- 保存自动润色的时间戳笔记，方便之后复习。
- 使用自己的 API Key，数据保存在本地 Chrome 中，不包含分析统计或行为追踪。

YouTube Digest to Corpus Palace 是一个需要自行提供 API Key 的开源项目，通过 GitHub 安装。目前没有上架 Chrome 应用商店，不赠送 API 额度，也没有开发者运营的服务器。

点击查看演示和教学视频（小白友好）：[https://www.bilibili.com/video/BV1dnuq6dEak/](https://www.bilibili.com/video/BV1dnuq6dEak/)

![YouTube Digest to Corpus Palace 双语演示](YouTube%20Digest%20demo%20bilingual.png)

## v2.4.3 更新

- Chrome 图标、侧边栏空状态和安装包已统一改用透明背景的新版 Corpus Palace PNG Logo。

## v2.4.2 更新

- Chrome 图标、侧边栏空状态和安装包已统一替换为项目作者最新优化的 Corpus Palace Logo。

## v2.4.1 更新

- Chrome 图标、侧边栏空状态和发布安装包现已统一使用你提供的 Corpus Palace PNG Logo。

## v2.4.0 更新

- 全新的 Corpus Palace 语料手账 Logo，统一用于 Chrome 扩展图标与空状态，主色为中紫、深紫和薄荷绿。
- 侧边栏升级为像素手账式界面：浅紫工作区、紫色描边字幕卡、薄荷绿表达高亮和深紫主操作。
- Transcript 顶部练习入口拆分为更清晰的“虚线重点汇总卡 + 开始内化练习按钮”。
- 设置页同步采用手绘感卡片、薄荷绿错位阴影；琥珀金仅用于提醒和警告。

## v2.3.3 更新

- Chrome、设置页、导出内容和说明文档中的产品名称已统一为 **YouTube Digest to Corpus Palace**。
- 练习材料校验会保留已通过的表达，只针对失败项和具体失败原因定向重新生成。
- 如果定向修复仍失败，错误提示会直接列出表达和未通过的规则。

## v2.3.1 更新

- 直接点击 Transcript 中已保存的紫色高亮，无需再次框选即可重新打开对应的 AI 语境双解卡。
- 点击高亮不会触发视频跳转；点击字幕行其他位置仍可正常跳转。
- 支持用 Enter 或空格键打开已聚焦的高亮。

## v2.3.0 更新

- 同一视频、同一处字幕中的同一选中表达，再次打开时直接读取 Chrome 本地保存的 AI 语境双解，不再重复调用 DeepSeek。
- 只有主动点击卡片中的 **重新生成** 才会请求新的 AI 结果；同一表达出现在另一处字幕时仍会按新语境单独生成。

## v2.2.1 更新

- 修复参考答案已经覆盖高亮表达，但覆盖状态经过学习会话后错误显示为 `0/N` 的问题。

## v2.2.0 更新

- 在 Transcript 顶部进入 **本期表达练习**，自由选择这支视频里已经高亮的表达。
- 按 **听辨回想 → 表达内化 → 一次完整口语练习** 的顺序学习。所有已选表达都必须在内化阶段标记为掌握后，才能进入口语。
- 在设置中粘贴自己的口语题目，识别后检查结构化预览，再明确保存为题库。
- 雅思可使用你准备并审核过的本地精确题库。工作、日常对话和旅行可使用自己的题库、DeepSeek 或说明中的智能兜底。
- 需要再练时，可无 API 调用地重试同一题，或请求一条未使用过的新题。
- 雅思参考答案会优先自然融入全部高亮表达。首版答案有遗漏时，插件会自动润色一次，并在口语卡片中显示经过实际文本校验的覆盖率。

## v1.2.0 更新

- 搜索字幕中的单词或短语，并依次查看所有匹配位置。
- 在 Transcript、Overview 和 Notes 中共用 Original、中文和双语设置。新视频默认保持 Original，不会自动消耗翻译 token。
- 只翻译当前可见的 Overview 和 Notes 内容，并通过小批次渐进显示和缓存结果。
- 选中字幕后，可以直接讲解内容或保存带时间戳的笔记。
- 页面跳转后保留字幕阅读位置，并在离开 YouTube 视频页面时自动关闭侧边栏。

## Corpus Palace 口语学习流程

这个个人改造版增加了以语境为核心的英语口语学习流程，但不会把每次框选都拆成一篇独立笔记。

1. 在 YouTube 播放器字幕或侧边栏 **Transcript** 中框选英文。
2. 点击生成 **AI 语境释义**。DeepSeek 会结合相邻字幕给出句中英汉释义、词性、常见搭配、句型、口语使用频率、同义改写和同语义族扩展。
3. 在导出前编辑表达的适用场景、词伙/句型类型、口语频率和自己的练习笔记；同义改写与扩展默认都不勾选。适用场景属于表达本身，不等于视频主题；泛用表达可留空。
4. 点击 **一键追加到 Obsidian**。同一支视频的条目会进入同一篇 Markdown 视频笔记，统一追加到一张语料总表中，并保留时间戳与原语境。

这里的内容是 AI 为学习者生成的语境释义，不是词典原文。建议在有字幕、且已配置 DeepSeek API Key 的视频中使用。

### 配置 Obsidian 导出

在 **Settings** 中填写本机 Obsidian Vault 的准确名称和可选文件夹（默认是 `YouTube English`）。只有点击导出按钮后，扩展才会发起 `obsidian://new` 追加请求；实际的本地文件操作由 Obsidian 完成，因此打开后请在 Obsidian 中确认结果。

## 本地 IELTS OCR 工作流（仅 macOS）

这个开发工具使用 macOS 的 PDFKit、Vision 和 AppKit。它不属于公开扩展包；PDF、OCR、中间审核文件和生成的题库都必须只留在本地，并保持 Git 忽略。

1. 用 `npm run ocr:ielts -- INPUT.pdf tmp/ielts-ocr-YYYY-MM_DD.json` 生成私有 OCR 中间文件。
2. 渲染并检查每一页源 PDF。在被忽略的 `data/ielts-ocr-review-YYYY-MM_DD.json` 审核文件中记录页码和 OCR 摘要，以及针对源文件的替换。不要手动编辑生成的题库。
3. 只从已审核的输入重新生成：`node scripts/parse-ielts-ocr.mjs INPUT.json data/ielts-question-bank.local.json REVIEW.json`。解析器只有在 46 页 OCR 都已审核且审核文件状态为 approved 时才会写入本地题库。

普通 Swift 命令要求 Xcode 或 Command Line Tools 的编译器与 macOS SDK 相匹配。这个主机当前的 Swift 是 6.3.3，而默认 SDK 接口由 6.3.2 构建，因此在修复或更新 Command Line Tools/Xcode 前，普通命令会失败。请使用正常匹配的 macOS 工具链，不要把临时的本地编译绕过方案当作项目默认做法。

## 口语题库与本地 IELTS 数据

在 **Settings** 中选择一个或多个口语场景，粘贴纯文本题目后点击 **识别题库**。只有你主动发起识别时，粘贴内容才会发送给 DeepSeek。请先检查返回的结构化题目，再决定是否保存。成功保存后，原始粘贴内容会被丢弃，Chrome 本地存储只保留结构化题目记录。识别失败或不保存预览时，原始内容仍会留在设置输入框中，方便修改。

每次识别、每次由 AI 生成新口语题，以及每次生成新的 AI 参考答案，都会产生独立的 DeepSeek 请求，可能增加服务商费用。重试同一口语题不会调用 DeepSeek。频繁识别或练习前，请检查 DeepSeek 价格和账号限额。

题目来源规则如下：

- IELTS 使用已批准的本地题库中的精确存储题目。在 **内置题库加我的题库** 模式中，符合条件的个人题库题目也可以与这一本地来源一起参与。没有安装已批准题库时，IELTS 的内置题目不可用，不会用合成示例替代。
- 工作、日常对话和旅行可选择 **智能混合**、**仅我的题库** 或 **仅 DeepSeek**。智能混合会优先选择符合条件且未使用过的个人题目，只有需要新题时才调用 DeepSeek。
- 公开仓库只有用于说明结构和测试的合成示例，不会作为 IELTS 内容提供给学习者。

随附的季节性 IELTS PDF 可能包含第三方材料。其 OCR 题库保存在 `data/ielts-question-bank.local.json`，该文件会被 Git 忽略，也不会进入公开安装包。只有在你已审核并批准本地题库、且确认自己有权使用其中内容后，才运行 `npm run package:local`。该命令会验证题库，运行测试和公开发布检查，创建 `dist/youtube-digest-v2.4.3-local-with-question-bank.zip`，扫描归档输入中的常见凭证，并输出 SHA-256 摘要。`npm run package` 始终只创建不含该题库的公开 ZIP。

安装本地包时，请把该 ZIP 解压到长期保留的文件夹，在 Chrome 的“加载已解压的扩展程序”中选择这个准确文件夹，并保持它不被移动。重新构建或替换解压文件后，请在 `chrome://extensions` 中为 YouTube Digest to Corpus Palace 点击“重新加载”，再刷新已打开的 YouTube 页面。

扩展运行时不支持 PDF 导入，没有 PDF 渲染器，也没有 OCR 引擎。上面的 macOS OCR 工作流只是一次性的开发工具，不会进入任何扩展运行时。

## 让你的编程 Agent 帮你安装

你不需要看懂代码，也不需要会使用命令行。把下面这段话发送给你的编程 Agent：

> 请把这个项目下载或克隆到我选择的长期保留文件夹，告诉我准确的完整路径，并让 Chrome“加载已解压的扩展程序”使用同一个文件夹。如果我在第一次安装时需要位置建议，可以推荐 macOS 或 Linux 上的 `~/Documents/youtube-digest`，或 Windows 上的 `%USERPROFILE%\Documents\youtube-digest`，但不要假设我一定使用这些路径。请用简单易懂的语言一步一步指导我完成安装和配置。https://github.com/zarazhangrui/youtube-digest

你的 Agent 应该帮你：

1. 先询问你想把项目长期保存在哪里，再下载或克隆到那里，并告诉你准确的完整路径。如果你需要建议，可以推荐 macOS 或 Linux 上的 `~/Documents/youtube-digest`，或 Windows 上的 `%USERPROFILE%\Documents\youtube-digest`。
2. 打开下方 Supadata 和 DeepSeek 官方页面，指导你创建自己的账号。
3. 指导你在 Chrome 中通过“加载已解压的扩展程序”选择你刚才确定的那个准确项目文件夹。
4. 告诉你应该在扩展的“设置”页面哪个位置填写 API Key。
5. 打开一个带字幕的 YouTube 视频，确认字幕和翻译功能可以使用。

安装后请让这个文件夹留在原位。如果移动或删除它，Chrome 中加载的本地扩展会失效，需要从新的长期存放位置重新加载。

不要把 API Key 发送到 AI 对话、源代码、截图或公开消息中。请你自己在 YouTube Digest to Corpus Palace 的设置页面直接填写。编程 Agent 可以告诉你填写位置，但不需要看到 Key。

## 手动安装

如果你想自己操作：

1. 打开 [github.com/zarazhangrui/youtube-digest](https://github.com/zarazhangrui/youtube-digest)。
2. 点击 **Code**，再选择 **Download ZIP**。
3. 选择一个长期保留的文件夹，并把项目解压到这里。可选建议是 macOS 或 Linux 上的 `~/Documents/youtube-digest`，或 Windows 上的 `%USERPROFILE%\Documents\youtube-digest`。你也可以使用其他文件夹。
4. 在 Chrome 地址栏打开 `chrome://extensions`。
5. 打开右上角的“开发者模式”。
6. 点击“加载已解压的扩展程序”。
7. 选择你刚才确定的那个准确项目文件夹，其中必须包含 `manifest.json`。
8. 如果需要，可以在 Chrome 扩展菜单中固定 YouTube Digest to Corpus Palace。

这是一个本地加载的扩展，不会自动更新。下载新版或让 Agent 修改代码后，请在 `chrome://extensions` 中找到 YouTube Digest to Corpus Palace 并点击“重新加载”，然后刷新已经打开的 YouTube 页面。如果移动或删除源代码文件夹，Chrome 中加载的扩展会失效，需要从新的位置重新加载。

## 设置 API Key

YouTube Digest to Corpus Palace 需要你在自己的服务账号中准备两个 Key：

1. **Supadata API Key**，用于获取 YouTube 字幕。
2. **DeepSeek API Key**，用于生成概览、讲解内容、翻译和自动润色笔记。

### 获取 Supadata API Key

1. 打开 Supadata 官方[注册页面](https://dash.supadata.ai/auth/sign-up)。
2. 创建账号并完成简短的新手引导。
3. Supadata 会在新手引导过程中自动生成 API Key。
4. 之后可以随时打开 [Supadata 控制台](https://dash.supadata.ai/)查找或管理 Key。
5. 复制 Key，并粘贴到 YouTube Digest to Corpus Palace 设置中的 **Supadata API key**。

如果页面流程发生变化，请查看 [Supadata 官方文档](https://docs.supadata.ai/)。

### 获取 DeepSeek API Key

1. 打开 DeepSeek 官方 [API Keys 页面](https://platform.deepseek.com/api_keys)。
2. 按照提示登录，或创建 DeepSeek 开放平台账号。
3. 点击 **Create new API key**，填写容易识别的名称，例如 `YouTube Digest to Corpus Palace`，然后创建 Key。
4. 立即复制 Key。完整 Key 可能只会显示一次。
5. 把 Key 粘贴到 YouTube Digest to Corpus Palace 设置中的 **DeepSeek API key**。
6. 如果 DeepSeek 提示余额不足，请在 DeepSeek 开放平台账号中充值后再试。

当前账号和接口说明请查看 [DeepSeek 官方 API 文档](https://api-docs.deepseek.com/)。

在侧边栏中打开 **Settings**。你也可以在 `chrome://extensions` 的 YouTube Digest to Corpus Palace 卡片中打开扩展选项。Key 只能粘贴到这些设置输入框中。不要把 Key 发送到 AI 对话、项目文件、截图或公开消息中。

发布版本只支持 DeepSeek V4 Flash：

```text
Base URL: https://api.deepseek.com
Model: deepseek-v4-flash
```

YouTube Digest to Corpus Palace 会让所有 DeepSeek 请求使用非思考模式，以获得更快、更稳定的交互。设置中的接口地址和模型固定，只需要填写 DeepSeek API Key。如果想使用其他服务或模型，请在设置中复制安全的自定义 prompt，让编程 Agent 修改你自己的本地副本。不要把任何 API Key 放进 prompt 或对话。

API Key 和设置保存在你设备上的 Chrome 扩展本地存储中。发布包不会包含或使用 `config.js`。

## 使用 YouTube Digest to Corpus Palace

1. 打开一个有字幕的普通 YouTube 视频页面。
2. 点击 YouTube Digest to Corpus Palace 扩展图标，打开侧边栏。
3. 阅读带时间戳的字幕，或选择 **Original**、**中文**、**双语**。
4. 打开 **Overview**，查看 AI 生成的章节和重点引用。
5. 选中字幕，获取 AI 内容讲解。
6. 从播放器或重点引用中保存笔记，之后可以在 **Notes** 中查看。

## 当前支持范围

- Chrome 116 或更高版本。
- 标准的 `youtube.com/watch` 视频页面。
- Supadata 能够返回的原生字幕。YouTube Digest to Corpus Palace 会优先请求英文字幕，也可能显示其他可用的原生语言。
- 原文、简体中文和双语对照字幕。
- AI 概览、选中文本讲解、翻译和自动润色笔记。
- 本地笔记，以及最近字幕、概览和翻译的本地缓存。
- 发布版本的所有 AI 功能都使用 DeepSeek V4 Flash。其他服务需要修改本地代码，不属于发布版本的支持范围。

Shorts、直播、私密视频、受访问限制的视频，以及没有原生字幕的视频可能无法使用。目前没有测试 Firefox、Safari、移动浏览器或其他 Chromium 浏览器。

YouTube Digest to Corpus Palace 强制使用 Supadata 的 `mode=native`，不会在没有原生字幕时请求 AI 生成转录，也不会在本地转录音频。

## Supadata 免费额度和请求成本

截至 2026 年 8 月 9 日，[Supadata 价格页面](https://supadata.ai/pricing)显示免费版每月提供 **100 credits**，不需要信用卡，未使用的额度不会结转。价格可能变化，使用前请查看最新页面。

[Supadata 字幕接口文档](https://docs.supadata.ai/get-transcript)说明了不同模式的计费方式：

- 获取一次原生字幕消耗 **1 credit**，与视频时长无关。
- AI 生成字幕每分钟消耗 **2 credits**。YouTube Digest to Corpus Palace 不会使用这条路径，因为它强制使用 `mode=native`。
- 如果没有可用原生字幕并返回 HTTP `206`，仍会消耗 **1 credit**。

按照当前只获取原生字幕的方式，如果每次请求都成功，免费版每月大约可以查询 100 个视频。重试和没有字幕的查询也会消耗额度，所以实际成功数量可能更少。

DeepSeek 的额度与 Supadata 分开计算。YouTube Digest to Corpus Palace 不收款，也不转售 API 服务。建议为两个账号设置消费上限并定期查看用量。

## DeepSeek V4 Flash 价格

截至 2026 年 8 月 27 日，DeepSeek 官方[价格页面](https://api-docs.deepseek.com/quick_start/pricing/)列出的每 100 万 token 美元价格如下：

| Token 类型 | 非高峰 | 高峰 |
| --- | ---: | ---: |
| 缓存命中输入 | $0.007 | $0.014 |
| 缓存未命中输入 | $0.22 | $0.44 |
| 输出 | $0.66 | $1.32 |

高峰时段为周一至周五 UTC 01:00–04:00 和 06:00–10:00，其他时间使用非高峰价格。

一个实测的 20 分钟英文视频使用约 **32,600 个输入 token**，并在 43 个小批次中产生约 **3,500 到 4,500 个输出 token**。按当前价格，完整翻译该视频的费用约为：

- **非高峰：$0.003 到 $0.010 USD**。
- **高峰：$0.005 到 $0.020 USD**。

低值假设大部分重复输入命中 DeepSeek 缓存，高值假设输入未命中缓存。翻译按需执行并复用缓存，只翻译部分视频时费用会更低。使用前请查看官方页面确认最新价格。

## 用编程 Agent 改造成自己的版本

这是一个个人 Remix 项目，不接受上游 Issue 或 Pull Request。如果功能出错，或者你想增加新功能，请下载或 Fork 自己的副本，再让你的编程 Agent 帮你修复、改造和个性化。

YouTube Digest to Corpus Palace 使用原生 HTML、CSS 和 JavaScript，没有构建步骤，很适合用编程 Agent 做个人项目。你可以尝试：

- 增加更多翻译语言，并让每个人选择自己的学习语言。
- 为课程、访谈、教程、测评或研究视频增加自定义总结模板。
- 增加生词本，保存单词、原句、解释和视频时间戳。
- 把笔记和生词导出到 Markdown、CSV、Anki 或其他学习工具。
- 增加个人主题筛选，只突出与你目标相关的章节。
- 增加本地模型选项，获得不同的隐私和成本方案。
- 改善键盘操作、字体大小和高对比度等无障碍体验。

请让 Agent 保留用户自带 API Key 的模式，不要把秘密写入源代码，并运行下方检查。分享自己的版本前，也要在真实视频上测试。

如果想使用其他 AI 服务或模型，请先在编程 Agent 中打开 Chrome 通过“加载已解压的扩展程序”使用的那个准确的 YouTube Digest to Corpus Palace 项目文件夹。然后打开 YouTube Digest to Corpus Palace 设置并点击 **Copy customization prompt**。发送前替换 `[PROVIDER]` 和 `[MODEL]`，但不要加入任何 API Key。Agent 完成本地代码修改后，请你自己在它指出的设置位置填写 Key。

## 隐私和数据流向

YouTube Digest to Corpus Palace 会直接从扩展向服务商发送请求：

1. 把标准化的 YouTube 视频地址发送给 Supadata，用于获取原生字幕。
2. 当你使用 AI 功能时，把字幕和相关视频信息发送给 DeepSeek。
3. 翻译或讲解等功能只发送当前需要的内容，例如选中的文本和上下文，或少量字幕分段。
4. API Key、设置、笔记和最近缓存保存在 Chrome 本地。

YouTube Digest to Corpus Palace 没有账号系统、广告、分析统计或行为追踪。Supadata 和 DeepSeek 仍会按照各自的条款和隐私政策处理数据。详情请查看 [PRIVACY.md](PRIVACY.md)。

## 常见问题

### YouTube 视频页面没有显示 Digest 按钮

- 在 `chrome://extensions` 中找到 YouTube Digest to Corpus Palace，点击“重新加载”，然后刷新 YouTube 页面。
- 确认当前页面是标准 `https://www.youtube.com/watch?...` 页面，而不是 Shorts、嵌入页面或直播页面。
- 当前版本会在 YouTube 响应式操作栏变化时自动重新定位按钮。页面加载完成后可以稍等片刻。
- 如果你使用的是较早下载的版本，可以先横向调整一次 YouTube 窗口宽度让按钮出现，然后下载最新版，这样之后不再需要调整窗口。
- 如果按钮仍然没有出现，让你的编程 Agent 在这个具体视频页面检查 content script。

### 侧边栏无法打开

- 确认你打开的是标准 `https://www.youtube.com/watch?...` 页面。
- 在 `chrome://extensions` 中确认 YouTube Digest to Corpus Palace 已启用，并点击“重新加载”。
- 重新加载扩展后，刷新 YouTube 页面。
- 如果问题仍然存在，让你的编程 Agent 检查扩展。

### YouTube Digest to Corpus Palace 提示需要设置

- 打开 **Settings**，保存 Supadata Key 和 DeepSeek Key。
- 发布版本固定使用 DeepSeek V4 Flash，没有需要填写的 Base URL 或 Model 字段。
- 如果设置提示旧的自定义服务已移除，请重新填写 DeepSeek Key。旧 AI Key 已安全清除，避免被错误用于 DeepSeek。

### 找不到字幕

- 确认视频是公开的，并且有原生字幕。
- 检查 Supadata Key、剩余额度、限速和账号状态。
- 没有字幕的查询和手动重试也可能消耗额度。

YouTube Digest to Corpus Palace 不会自动改用 AI 生成字幕。

### AI 请求失败

- `401` 或 `403` 通常表示 DeepSeek Key 或账号权限有问题。
- `429` 通常表示达到了 DeepSeek 服务限速或消费上限。
- 确认 Key 来自上方链接的 DeepSeek 开放平台账号，并且账号有可用额度。
- 如果你把本地副本改成了其他模型，请再次使用设置中的自定义 prompt，让编程 Agent 检查本地实现。

不要在对话、截图或日志中分享 API Key、私密字幕或个人笔记。

## 给编程 Agent 的检查命令

修改项目后，让你的编程 Agent 运行：

```bash
npm test
npm run check
npm run package
```

Agent 还应该在 Chrome 中重新加载扩展，并测试多个真实 YouTube 视频。自动检查通过，不代表真实服务请求和 YouTube 交互一定正常。

## 开源许可

MIT，详见 [LICENSE](LICENSE)。

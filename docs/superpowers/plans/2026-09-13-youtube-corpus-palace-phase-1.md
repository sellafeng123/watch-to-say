# YouTube Corpus Palace · Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 YouTube Digest v1.2.0 上实现“视频中即时学习 → AI 语境双解 → 用户编辑 → 一键追加到同一篇 Obsidian 视频笔记”的最小闭环；用户可从 YouTube 播放器字幕或插件侧栏 Transcript 框选英文进入同一流程。

**Architecture:** 以 `corpus.js` 承担无依赖的数据契约、校验、Markdown 与 Obsidian URI 生成；`background.js` 成为唯一的 DeepSeek 与字幕上下文协调点；`corpus-ui.js` 提供侧栏和播放器共同使用的语境双解卡及编辑器；`sidepanel.js` 和 `content.js` 仅负责各自入口与挂载。浏览器扩展只保存轻量缓存、设置和导出历史；跨视频语料库始终由 Obsidian 承担。

**Tech Stack:** Manifest V3、原生 HTML/CSS/JavaScript、Chrome `storage.local` / Side Panel API、Supadata、DeepSeek V4 Flash、Obsidian URI、Node 内建 `node:test` 与 `vm`。

**Spec:** `docs/superpowers/specs/2026-09-13-youtube-corpus-palace-design.md`

## Global Constraints

- 先导入用户提供的上游 v1.2.0 原始代码；不覆写 `docs/superpowers/` 中的设计和计划文档。
- 保留现有 Digest、翻译、Overview、Notes、Transcript 的行为。语境双解替换侧栏现有 Explain 的学习入口，不移除普通 Note 的快速摘录能力。
- 只使用用户已配置的 DeepSeek；每张结果必须显示 `AI 语境释义`，不得出现 Oxford、牛津或欧路词典数据/命名。
- 选择来源必须限于 YouTube 播放器字幕或扩展侧栏 Transcript，不能对页面任意文本启用。
- 所有“沉淀到 Obsidian”都必须经过可编辑表单；不得自动导出整段字幕或整支视频词表。
- 一次导出一个表达块；同一视频始终计算为同一个稳定 Markdown 路径，并通过 `append=true` 追加。扩展表达默认不选择，不自动写入。
- 绝不把 API key、完整本机路径或用户 API 响应写入日志、提交、测试夹具或仓库文档。
- 所有模型输出均是不可信输入：JSON 要容错解析、白名单重建、截断字符串，并用 `textContent`/转义渲染。
- 不新增账户、云端同步、录音、ASR、发音评分或浏览器内全局语料库仪表盘。

---

## 1. 导入并锁定上游基线

- [ ] **Step 1: 将用户提供的 YouTube Digest v1.2.0 解压内容导入当前仓库根目录。**

  **Files:** `manifest.json`, `background.js`, `content.js`, `settings.js`, `sidepanel.html`, `sidepanel.css`, `sidepanel.js`, `options.html`, `options.css`, `options.js`, `prompts/`, `scripts/`, `tests/`, `icons/`, `README.md`, `README.zh-CN.md`, `PRIVACY.md`, `SECURITY.md`, `package.json`, `.github/workflows/ci.yml`

  **Actions:**
  - 从 `/Users/stella/Desktop/youtube-digest-main.zip` 解压 `youtube-digest-main/` 到临时目录，逐文件复制到当前项目根目录。
  - 保留现有 `docs/superpowers/specs/` 与 `docs/superpowers/plans/`，不将 zip 根目录的 `youtube-digest-main/` 再套一层进项目。
  - 检查 `manifest.json` 的版本为 `1.2.0`、`package.json` 的测试命令为 `node --test tests/*.test.js`，且 `git diff --check` 无空白错误。

  **Verify:**
  - Run: `npm test`
  - Run: `npm run check`
  - Run: `npm run package`
  - Expected: 上游 7 个测试文件全部通过，release 检查与打包脚本成功，生成的 zip 不进入 Git。

  **Commit:** `chore: import youtube digest v1.2.0 baseline`

## 2. 建立可测试的学习语料数据层

- [ ] **Step 2: 先写共享数据与 Obsidian URI 的失败测试。**

  **Files:** `tests/corpus.test.js` (new)

  **Write tests for:**
  - `normalizeSelectionRequest()` 仅接受 `player-caption` / `sidepanel-transcript` 两个 `source`、去除多余空白、将选区限制在 500 个字符以内、拒绝无 video ID / 空文本 / 负时间戳。
  - `normalizeContextualGloss()` 只保留允许字段与枚举值；处理代码围栏、尾逗号 JSON；每类 `paraphrases` / `relatedExtensions` 最多保留 3 个；所有扩展默认不带入导出。
  - `buildCorpusEntry()` 将用户可编辑的 `topic`、`expression`、`kind`、`spokenFrequency`、个人笔记和选中的扩展组合成稳定 entry；不选中的扩展绝不进入结果。
  - `buildVideoNotePath()` 用传入的首次导出日期对同一 `videoId` 生成稳定且安全的 `YouTube English/<日期> - <安全视频标题>.md` 相对路径；拒绝 `..`、控制字符、绝对路径和 URI 保留字符。
  - `renderCorpusEntryMarkdown()` 输出可追加的 Markdown 块，包含来源、时间戳链接、原句上下文、`AI 语境释义`、同义改写、相关扩展、用户练习栏位；所有用户文本中的 Markdown/HTML 均按字面显示。
  - `buildObsidianAppendUri()` 使用 `obsidian://new`，对 `vault`、`file`、`content` 逐一 `encodeURIComponent`，带 `append=true`，且绝不带 `overwrite=true`。

  **Verify:** Run `node --test tests/corpus.test.js` and confirm all tests initially fail because `corpus.js` does not exist.

- [ ] **Step 3: 实现共享、无 UI 的 `YTD_CORPUS` 数据层。**

  **Files:** `corpus.js` (new), `manifest.json`, `sidepanel.html`, `background.js`, `tests/corpus.test.js`

  **Implementation:**
  - 在 `corpus.js` 创建 IIFE 全局 `YTD_CORPUS`，同时用 `module.exports` 暴露给 Node 测试；实现 Step 2 的纯函数与常量：`MAX_SELECTION_CHARS`、四档口语学习优先级 `high` / `common` / `situational` / `low_formal`、`word` / `phrase` / `sentence_frame`。
  - 为模型返回建立白名单 schema：`label` 固定为 `AI 语境释义`、`expression`、`kind`、`suggestedTopic`、`partOfSpeech`、`contextMeaningEn`、`contextMeaningZh`、`collocations`、`sentenceFrame`、`spokenFrequency`、`frequencyReasonZh`、`paraphrases`、`relatedExtensions`。对每项设定明确字符上限。
  - Markdown 块以 `## HH:MM · expression` 开头，包含 `Source`、`Context`、`AI 语境释义`、`Paraphrases`、`Related extensions`、`My practice`；表达块本身携带视频标题、频道、时间戳 URL，保证单文件即使没有 frontmatter 也能独立追溯。
  - `buildVideoNotePath()` 保持纯函数；首次导出日期和 `videoId → notePath` 映射由后台 `ytd_corpus_video_notes` 负责保存，避免同一视频跨日导出被拆成两篇文件。
  - `manifest.json` 的 `content_scripts[0].js` 改为先加载 `corpus.js`、再加载 `content.js`；`sidepanel.html` 在 `sidepanel.js` 前加载 `corpus.js`；`background.js` 通过现有 `importScripts` 加载它。不得新增外部依赖或 host permission。

  **Verify:**
  - Run: `node --test tests/corpus.test.js`
  - Run: `npm test`
  - Expected: 新旧测试通过；生成 URI 的内容可被解析，且没有未编码的空格、`#`、`&` 或 `?`。

  **Commit:** `feat: add corpus entry data contracts`

## 3. 让后台提供可信的字幕语境与 DeepSeek 结果

- [ ] **Step 4: 为字幕语境解析与 AI 结构化响应添加测试。**

  **Files:** `tests/contextual-gloss.test.js` (new), `background.js`

  **Write tests for:**
  - 同一词在字幕中重复时，`resolveSelectionContext()` 以用户时间戳附近的转录段为准，而不是第一次文本匹配。
  - 上下文由目标段与前后相邻字幕组成，并保留准确 `timestampSeconds` 与 `timestampedUrl`。
  - 后台优先读取既有 `digest_<videoId>` 缓存；没有时使用 `ytd_corpus_transcript_<videoId>`；两者都没有才调用 `handleFetchTranscript()` 并写入 30 天 corpus 缓存。
  - `validateContextualGlossResponse()` 能拒绝无效 JSON、错误 label、超长字段、错误的 frequency / kind，且不会把模型任意字段传给 UI。
  - `handleContextualGloss()` 在缺 DeepSeek key、缺字幕、限流、无效 JSON 时返回稳定的 `{ success: false, error, message }`；成功请求使用已有 `requestAiCompletion()`、`responseFormat: { type: "json_object" }` 与 non-thinking DeepSeek 配置。

  **Verify:** Run `node --test tests/contextual-gloss.test.js` and confirm failure before implementation.

- [ ] **Step 5: 在 `background.js` 中实现统一的语境双解协调器。**

  **Files:** `background.js`, `prompts/contextual-gloss.md` (new), `tests/contextual-gloss.test.js`

  **Implementation:**
  - 在现有 `chrome.runtime.onMessage` switchboard 增加 `getContextualGloss`、`getCorpusSettings` 与 `recordCorpusExport` 三个 action；`getContextualGloss` 成功时同时返回已解析的 `selection`、`gloss`、非秘密 `corpusSettings` 与当前视频的稳定 `notePath`，所有 async 分支保持 `return true`。
  - 新增 `loadCorpusTranscript(videoId)`、`resolveSelectionContext(selectionRequest, sender)`、`handleContextualGloss(selectionRequest, sender)`、`validateContextualGlossResponse(raw, selectionContext)` 与 `recordCorpusExport(entryKey)`。
  - `resolveSelectionContext()` 必须以 `YTD_CORPUS.normalizeSelectionRequest()` 入参开始，使用 sender tab 的 URL/现有 `YTD_SETTINGS.canonicalYouTubeUrl()` 校验视频 ID，按最近时间戳匹配字幕；仅向模型传递所选表达、目标句、前后少量字幕、视频标题和频道名，不发送无关缓存内容。新增 `resolveVideoNotePath(videoId, title, now)` 读取 `ytd_corpus_video_notes`，无记录时仅计算候选路径；`recordCorpusExport()` 才将该候选路径与首次导出日期持久化。
  - 新缓存键 `ytd_corpus_transcript_<videoId>` 只存 transcript、时间戳、保存时间，TTL 30 天；`ytd_corpus_exports` 只存 entry key、video ID、time、note path、时间，最多 300 条。它只用于提醒“本条已交给 Obsidian”，不能声称确认写入成功。
  - `prompts/contextual-gloss.md` 按上游 `analysis.md` 的 `System prompt` / `User prompt` section 格式编写严格 JSON 提示：解释目标表达在当前句中的英汉意义、词性、常见搭配、句型框架、四档口语学习优先级、最多三条可直接替换的 paraphrase，以及最多三条同语义族扩展并说明差异。明确禁止虚构字典来源，`label` 必须是 `AI 语境释义`。
  - 在 `background.js` 的测试暴露对象（现有 `__YTD_TRANSLATION_TESTING__`）中加入上述纯 helper；不在 production 环境暴露 API key 或完整 storage 内容。

  **Verify:**
  - Run: `node --test tests/contextual-gloss.test.js`
  - Run: `npm test`
  - Expected: 重复语料选择正确、结构化 JSON 被安全归一化、缓存优先级与失败提示均受测试覆盖。

  **Commit:** `feat: add contextual gloss service`

## 4. 复用侧栏 Transcript 的选区，展示并编辑学习卡

- [ ] **Step 6: 为学习卡、编辑器和导出前约束编写 UI 测试。**

  **Files:** `tests/corpus-ui.test.js` (new), `tests/transcript-selection.test.js`, `tests/release.test.js`

  **Write tests for:**
  - `renderGlossCard()` 把所有模型内容作为文本渲染；卡片始终显示 `AI 语境释义`，区分 `Paraphrases` 与 `Related extensions`。
  - 编辑器用模型建议预填 `topic`、`kind`、`spokenFrequency`，但三项均可改；口语频率的可选标签是“高频 / 常用 / 场景常用 / 低频或偏书面”。
  - `paraphrases` 和 `relatedExtensions` 的 checkbox 初始均不选；用户勾选后才进入 `YTD_CORPUS.buildCorpusEntry()`。
  - 没有 Obsidian vault 设置时，不能形成可点击导出 URI，UI 显示进入设置的行动项。
  - Transcript 工具条仍阻止 pointer/mousedown 破坏选区；其中 Explain 入口改为“AI 语境双解”，现有 Note 快速摘录保留。
  - release 测试允许新增 `prompts/contextual-gloss.md` 并验证其存在 `System prompt`、`User prompt`，产品 UI 不新增 emoji。

  **Verify:** Run `node --test tests/corpus-ui.test.js tests/transcript-selection.test.js tests/release.test.js` and confirm failure before UI implementation.

- [ ] **Step 7: 创建可复用的 `YTD_CORPUS_UI` 并接入侧栏。**

  **Files:** `corpus-ui.js` (new), `sidepanel.html`, `sidepanel.js`, `sidepanel.css`, `tests/corpus-ui.test.js`, `tests/transcript-selection.test.js`

  **Implementation:**
  - 在 `corpus-ui.js` 创建 `YTD_CORPUS_UI.mountGlossCard({ root, gloss, selection, corpusSettings, onRecordExport })`。它在给定根节点内依次渲染结果卡与“编辑后沉淀”表单，不依赖全局页面 ID，因此可被 side panel 与 Shadow DOM 复用。
  - 结果卡包含：原表达、词性、当前句中义英汉、搭配、句型、口语学习优先级、两个折叠区（可直接替换的同义改写 / 同语义族表达扩展）及“编辑后沉淀”按钮。
  - 编辑表单包含：主题、词伙/句型类型、表达本体、口语使用频率、个人笔记、可选 paraphrase、可选 related extension。视频原句、上下文、视频链接与 timestamp 显示为不可删来源信息。
  - 使用 `getContextualGloss` 返回的 `corpusSettings` 与 `notePath`，通过 `YTD_CORPUS.buildObsidianAppendUri()` 同步设置真实 `<a href="obsidian://...">` 的导出链接，确保浏览器以用户点击打开自定义协议；点击后异步发送 `recordCorpusExport`，失败时只提示“未记录导出历史”，绝不假称 Obsidian 已保存。
  - 在 `sidepanel.html` 的 `corpus.js` 后、`sidepanel.js` 前加载 `corpus-ui.js`；在 `setupExplainFeature()` 中保留 selection 生命周期与定位逻辑，将 Explain 按钮文字和行为改为调用 `getContextualGloss`，再在一个关闭后会销毁的 modal 内挂载 `YTD_CORPUS_UI`。现有 `showExplanation()` 与宽松纯文本输出移除或改名，避免两个解释通道并存。
  - `sidepanel.css` 在当前 Calm Terracotta 变量体系内添加 `.corpus-gloss-*`、`.corpus-editor-*`、折叠与频率标签样式；使用可访问 label、button、fieldset、focus-visible；不要引入新字体、图片或 emoji。

  **Verify:**
  - Run: `npm test`
  - Manual: 在侧栏 Transcript 选取跨一行字幕的英文，工具条不消失；点击“AI 语境双解”后确认卡的所有字段完整；只勾选一个 paraphrase 并编辑 Topic，再点击“沉淀到 Obsidian”，URL 只含已勾选内容。

  **Commit:** `feat: add editable contextual gloss card to transcript`

## 5. 在 YouTube 播放器字幕中提供同一入口

- [ ] **Step 8: 为播放器字幕选择器添加隔离和 SPA 回归测试。**

  **Files:** `tests/player-caption-selection.test.js` (new), `tests/digest-button.test.js`, `content.js`

  **Write tests for:**
  - `isPlayerCaptionSelection(range)` 只在起止节点均位于 `.ytp-caption-window-container` 的 `.ytp-caption-segment` 时通过；视频标题、评论、描述、侧栏文字等选择必须被拒绝。
  - `buildPlayerCaptionSelection()` 用 `<video>` 当前 `currentTime` 生成 `source: "player-caption"` 请求；无 video、空文本、非 watch 页面时返回 null。
  - `mountPlayerCorpusSelection()` 每个 YouTube SPA 页面最多有一个 `#ytd-corpus-selection-root`，使用 Shadow DOM；navigation 后旧根节点与监听器被清理，重挂载不产生重复工具条。
  - 提示卡的按钮在 `mousedown` 阶段阻止默认行为，从而不丢失浏览器选区。

  **Verify:** Run `node --test tests/player-caption-selection.test.js tests/digest-button.test.js` and confirm it fails before implementation.

- [ ] **Step 9: 在 `content.js` 中实现播放器字幕选区入口。**

  **Files:** `content.js`, `manifest.json`, `tests/player-caption-selection.test.js`

  **Implementation:**
  - 新增 `setupCorpusCaptionSelection()`、`isPlayerCaptionSelection()`、`buildPlayerCaptionSelection()`、`mountPlayerCorpusSelection()` 与 `dismissPlayerCorpusSelection()`；将其生命周期接到现有 YouTube `MutationObserver` / watch-page reconciliation，而不替换 Digest 按钮的逻辑。
  - 工具条使用一个固定 ID 的宿主和 Shadow DOM，卡片只提供“AI 语境双解”主按钮；点击后调用后台 `getContextualGloss`，成功时将 `YTD_CORPUS_UI.mountGlossCard()` 挂到同一 Shadow Root，失败时显示安全的可重试文案。
  - 从 `video.html5-main-video.currentTime` 取秒数、从 watch URL 取 `v`、从现有 `extractVideoInfo()` 取 title/channel。播放器入口不尝试直接抓取/拼接字幕文本，语境一律由后台解析 timestamped transcript。
  - `manifest.json` 的 content script load order 必须为 `corpus.js`、`corpus-ui.js`、`content.js`。权限与 host permissions 不变。

  **Verify:**
  - Run: `npm test`
  - Manual: 在真实 YouTube 视频打开字幕，框选一段英文字幕；确认卡只出现在字幕上、不会出现在标题/评论区；跳转到另一支视频后旧卡消失且新页面只有一份入口。

  **Commit:** `feat: support player caption contextual gloss`

## 6. 配置 Obsidian、清理本地数据并完成交付验证

- [ ] **Step 10: 先为 Obsidian 设置、历史去重和重置行为增加测试。**

  **Files:** `tests/settings.test.js`, `tests/options-language.test.js`, `tests/corpus-export.test.js` (new), `options.js`, `settings.js`

  **Write tests for:**
  - `YTD_SETTINGS.normalize()` 迁移旧设置时安全保留/默认 `obsidianVault` 和 `obsidianFolder: "YouTube English"`；vault 名称为空或 folder 含危险路径时导出不可用。
  - `recordCorpusExport()` 对相同 `entryKey` 返回已记录状态，但用户可以在编辑器明确点击“再次交给 Obsidian”生成相同 append URI；不会产生覆盖语义。
  - Options 英中双语界面都有 Obsidian Vault 名称和存放文件夹字段、解释仅使用 Obsidian URI 与本地 Chrome storage、无 API key 显示。
  - 清除缓存、删除笔记、重置数据分别清理其应负责的 `ytd_corpus_transcript_*`、`ytd_corpus_video_notes`、`ytd_corpus_exports`；不会误删未涉及的浏览器 storage。

  **Verify:** Run `node --test tests/settings.test.js tests/options-language.test.js tests/corpus-export.test.js` and confirm failure before implementation.

- [ ] **Step 11: 完成 Options、隐私说明与本地数据治理。**

  **Files:** `settings.js`, `options.html`, `options.js`, `options.css`, `background.js`, `README.md`, `README.zh-CN.md`, `PRIVACY.md`, `SECURITY.md`, `tests/settings.test.js`, `tests/options-language.test.js`, `tests/corpus-export.test.js`, `tests/release.test.js`

  **Implementation:**
  - 在 `YTD_SETTINGS.normalize()` 添加非秘密字段 `obsidianVault`、`obsidianFolder`；只接受 vault 内相对文件夹，不接受磁盘绝对路径。Options 使用现有双语 `COPY`、`translate()`、storage adapter 模式新增两个字段和保存/校验反馈。
  - Options 的 Local data 区新增“清除语料学习缓存 / 清除语料导出历史”可逆操作；保留原 `Clear cached digests`、`Delete all notes`、`Reset extension data` 的原有含义，并把 corpus key 明确纳入 Reset。
  - 更新两份 README：说明两种选区入口、`AI 语境释义` 的非词典性质、paraphrase 与 related extension 的区别、必须编辑再导出、每支视频一篇 Obsidian note、官方 URI 的 `append=true` 行为及重新加载步骤。
  - 更新 `PRIVACY.md` 和 `SECURITY.md`：DeepSeek 会收到目标表达及少量上下文；Obsidian URI 在用户点击后把内容交给本机已安装 Obsidian；扩展不读取 vault、不确认落盘、不上传到开发者服务器。
  - `tests/release.test.js` 覆盖新增运行时文件、prompt 和 manifest 加载顺序；禁止错误声称 “Oxford definition” 或 “saved to Obsidian”。

  **Verify:**
  - Run: `npm test`
  - Run: `npm run check`
  - Run: `npm run package`
  - Expected: 全部测试、release 检查、CRX/zip 打包通过，且没有额外 host permission、第三方依赖、凭据或构建产物被追踪。

  **Commit:** `feat: configure obsidian corpus export`

- [ ] **Step 12: 进行真实扩展验收和回归检查。**

  **Files:** `README.zh-CN.md`（只在验收发现缺少操作说明时更新）

  **Manual acceptance checklist:**
  - 在 Chrome `chrome://extensions` 打开开发者模式，加载当前项目根目录的 unpacked extension，输入 Supadata 与 DeepSeek key，再保存 Obsidian vault 名称和文件夹。
  - 在有英文字幕的 YouTube 视频中：从播放器字幕和 Transcript 各选一次词伙，得到同一结构的 `AI 语境释义` 卡。
  - 编辑每次导出的主题、词伙/句型类型和口语频率；确认 two groups 的扩展默认均未勾选，只将勾选项写入 URI 内容。
  - 对同一视频连续导出两个表达：确认两次 URI `file` 参数完全相同、每次 `content` 不同且都含 `append=true`；在 Obsidian 中确认两块按点击顺序追加到一篇视频笔记。
  - 在未配置 Obsidian、无字幕、无 DeepSeek key、模型返回无效 JSON、API 限流场景，确认显示可理解的失败提示且不产生空链接/损坏数据。
  - 回归 Digest、Transcript 翻译、Overview、普通 Note 保存/删除、侧栏切换、YouTube SPA 导航；确认各功能未重复注入或失效。

  **Verify:** Repeat `npm test && npm run check && npm run package` after manual fixes.

  **Commit:** `docs: document corpus palace workflow`（仅当验收导致文档变更）

## Deferred: Phase 2

在第一阶段通过真实视频验收后，另建实施计划实现“预表达 → 精选片段盲听/填空 → 跟读/造句/句型替换 → 主题输出 → 初始/最终回答对照”。原因是它需要独立的学习会话状态、片段挑选、练习数据与 UI 流，不应与稳定可靠的选词和 Obsidian 沉淀链路绑在同一次发布中。

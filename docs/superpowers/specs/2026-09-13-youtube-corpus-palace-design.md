# YouTube Digest × Corpus Palace 设计规格

## 1. 背景与目标

本项目基于 YouTube Digest 二次开发，服务英语口语学习中的“输入—内化—输出”闭环。它不试图在浏览器插件内重建完整 Notion 或语料库系统。

产品分工如下：

- YouTube Digest：在观看视频的当下完成预表达、听辨、查释、选材、跟读和短输出。
- Obsidian：保存一支视频的一期完整语料笔记，承接长期整理、跨视频复习与个人表达积累。

核心目标是把用户主动选中的视频片段，转化为带来源、语境、可迁移表达和练习记录的学习材料，而不是自动批量抓取词汇。

## 2. 已确认的产品原则

1. 一支视频对应一篇 Obsidian 语料笔记；同一视频的后续片段追加到同一篇笔记。
2. 视频原句和 AI 生成内容必须分区标注，不能混为同一来源。
3. 入库前总会显示可编辑卡片；主题、词伙、句型与口语常用度均由用户最终确认。
4. 双解卡使用 DeepSeek 生成的“AI 语境释义”，不展示或声称为 Oxford 内容。
5. 插件只保留当前视频学习必需的流程；大规模主题库、跨视频 Mini Test 和长期归档留在 Obsidian。
6. 每期只精选少量核心表达。AI 扩展默认折叠，用户主动选择后才入库。

## 3. 学习闭环

```text
预表达
→ 精选片段听辨
→ 选取核心语料
→ AI 语境双解
→ 可选扩展包
→ 跟读、造句、句型替换
→ 主题输出
→ 初始回答与最终回答对照
→ 追加到本期 Obsidian 笔记
```

这套流程继承原始 Episode 工作流中的五步法，但不要求用户一次完成所有项目。每一步都可以在当前视频内继续或在 Obsidian 中延后完成。

## 4. 插件功能与界面

### 4.1 视频学习模式

用户在某个 YouTube 视频中启动学习模式。插件读取带时间戳的 Transcript 后显示本期进度：预表达、听辨、核心语料、内化、输出。

学习模式不自动扫完整视频生成大量卡片。用户选取 4–8 条核心表达；练习只围绕其中 3–5 个片段展开。

### 4.2 预表达

插件依据视频主题和候选核心表达生成 3–5 条中文提示。用户先用现有水平说或写出英文；第一版保留文本输入和“已口头回答”标记，不引入语音识别或自动口音评分。

初始回答追加到 Obsidian 视频笔记的 `## 预表达` 区块，供最终输出时比较。

### 4.3 片段听辨

用户将有价值的字幕片段加入听辨队列。每个片段依次提供：

1. 盲听循环；
2. 关键词或词伙挖空；
3. 揭示原句并跳转到解释或跟读。

不为整支长视频创建全量填空题，避免完成门槛和 AI 调用成本过高。

### 4.4 AI 语境双解卡

支持两个入口：

- YouTube 播放器字幕中的英文选区；
- YouTube Digest 侧栏 Transcript 中的英文选区。

播放器选区由 content script 读取文字、播放时间和锚点位置；后台从完整 Transcript 中取最近的前后语境。侧栏选区直接读取对应字幕行与时间戳。两种入口统一为同一种 `SelectionContext` 请求。

卡片显示：

- 选中表达与词性；
- AI 语境释义与句中中文；
- 常见搭配；
- 可迁移句型；
- 口语常用度；
- 同义改说和同类表达扩展（默认折叠）；
- 加入本期语料。

卡片及任何导出内容都标注“AI 语境释义”。第一版不输出 AI 生成的 IPA 或发音音频。

### 4.5 入库编辑卡

点击“加入本期语料”后打开编辑卡。固定来源信息包括原句、前后语境、视频标题、时间戳和回跳链接。用户可以编辑：

- 主题标签；
- 核心词伙；
- 句型；
- 每个词伙的口语常用度；
- 是否将同义改说或同类扩展纳入本期扩展包。

常用度使用四档：高频、常用、场景常用、低频/偏书面。它是学习优先级提示，不冒充精确词频统计。

### 4.6 内化与输出

本期练习只作用于用户选定的核心表达：

- 跟读：片段循环、字幕显示控制和完成标记；
- 词伙造句：每个核心词伙建议完成 1–2 句自造句；
- 句型替换：至少完成一次句型槽位替换；
- 情境短文：用 3–5 条已选表达生成 2–3 段练习材料，并标明为 AI 练习材料；
- 输出：生成 1–2 道贴近视频主题的口语问题。用户先作答，再查看目标表达与参考组织方式。

最终回答、用户勾选的目标表达和自评记录保存到 Obsidian；不在第一版承诺语音转写或自动发音评分。

## 5. 表达扩展规则

### 5.1 同义改说

“同义改说”仅收录在大多数日常语境中可直接替换的表达。每项包含表达、中文、细微差异和口语常用度。

### 5.2 同类表达扩展

“同类表达扩展”表示相同语义场或句型家族，不表示完全同义。每项必须说明与原表达的场景、语气或程度差异。

两类内容各最多建议 3 条；默认不导出，用户在入库编辑卡显式勾选后才写入 Obsidian 的 `## 额外扩展` 区块。

## 6. 标准数据契约

### 6.1 SelectionContext

```js
{
  videoId: "abc123",
  source: "player_caption" | "transcript",
  selectedText: "pull an all-nighter",
  timestampSeconds: 204,
  sentence: "I had to pull an all-nighter to meet the deadline.",
  beforeContext: "I was behind on several assignments.",
  afterContext: "By morning, I finally got everything done.",
  videoTitle: "How I stay productive at university",
  channelName: "Breanna Quan"
}
```

### 6.2 AIContextGloss

```js
{
  source: "ai_contextual",
  unit: "pull an all-nighter",
  type: "verb phrase",
  meaningZh: "熬夜通宵，尤指为了学习或工作赶进度",
  meaningInContext: "此处指为了赶截止日期而熬夜",
  collocations: ["pull an all-nighter", "meet a deadline"],
  sentenceFrame: "I had to ___ to ___.",
  spokenFrequency: "situational",
  register: "informal",
  paraphrases: [
    {
      expression: "stay up all night",
      meaningZh: "整晚不睡",
      difference: "最接近，但不一定强调赶学习或工作。",
      spokenFrequency: "common"
    }
  ],
  relatedExpressions: [
    {
      expression: "work through the night",
      meaningZh: "连夜工作",
      relation: "同类扩展",
      difference: "更强调持续工作，语气稍正式。",
      spokenFrequency: "situational"
    }
  ],
  note: "AI 语境释义"
}
```

### 6.3 CorpusEntry

以下为 schema 表示法；`origin` 与 `glossary` 分别采用 6.1、6.2 中完整字段，不是省略后直接写入的数据。

```ts
{
  origin: SelectionContext,
  glossary: AIContextGloss,
  topicTags: ["study-work"],
  expressions: [
    { text: "pull an all-nighter", spokenFrequency: "situational" },
    { text: "meet a deadline", spokenFrequency: "high" }
  ],
  sentenceFrames: ["I had to ___ to ___."],
  selectedParaphrases: [],
  selectedRelatedExpressions: [],
  savedAt: "2026-09-13T00:00:00.000Z"
}
```

## 7. 存储与 Obsidian 集成

### 7.1 插件本地存储

Chrome 本地存储只持有：

- Obsidian Vault 名称或 ID；
- Obsidian 语料目录；
- `videoId → filePath` 的视频笔记映射；
- 有上限的 AI 双解缓存；
- 当前视频的学习进度和听辨队列。

插件不承担长期语料库，不保存可无限增长的全部学习数据。

### 7.2 一视频一笔记

首次导出创建视频笔记；后续导出按 `videoId` 找到同一路径并追加。片段去重键为 `videoId + timestampSeconds + normalizedSentence`。

使用 Obsidian URI 的 `new` 动作创建或追加。插件把 Markdown 写入剪贴板后触发 URI，避免长内容的 URL 长度问题。用户首次配置 Vault 和目录，之后静默追加，并提供“打开本期笔记”入口。

### 7.3 Markdown 模板

```md
---
type: youtube-corpus
video_id: abc123
title: How I stay productive at university
channel: Breanna Quan
url: https://www.youtube.com/watch?v=abc123
status: inbox
---

# How I stay productive at university

## 预表达

## 原始语料

### 03:24

> I had to pull an all-nighter to meet the deadline.

前文：I was behind on several assignments.
后文：By morning, I finally got everything done.

- 主题：学习与工作
- 🧱 `pull an all-nighter`｜熬夜通宵｜场景常用
- 🧱 `meet a deadline`｜赶截止日期｜高频
- 🏗️ `I had to ___ to ___.`
- [回到视频 03:24](https://www.youtube.com/watch?v=abc123&t=204s)
- [ ] 待跟读
- [ ] 待输出

## 额外扩展

## AI 练习材料

## 最终输出
```

## 8. AI 请求、缓存与安全

所有 AI 请求仍沿用 YouTube Digest 的自带 API Key 模式：密钥只存在受信任的 Chrome 扩展本地存储中。

新增 AI 请求必须使用严格 JSON 结果，并在后台验证：

- 选区长度、字段类型、数组项数和枚举值；
- 同义项与扩展项均不超过 3 条；
- 常用度只能取四个指定等级；
- AI 失败时不丢失原始选区，允许“仅保存原句”；
- 相同选区语境使用缓存，避免重复付费。

播放器页面只接收需要展示的解释结果，不接触 API Key 或整份 Chrome 本地存储。

## 9. 错误处理

- 视频无原生字幕：沿用上游错误提示，不能进入带语境的学习模式。
- 选区过长或没有英语字符：提示缩小到一个词伙、短语或一句话。
- Transcript 未准备好：显示加载状态，完成后再解释。
- AI 请求失败或限流：保留选区，提供重试和“仅保存原句”。
- Obsidian 未配置或 URI 无法打开：显示配置入口并保留待复制的 Markdown，避免学习成果丢失。
- Obsidian 追加失败：不标记为已导出；允许重新尝试。

## 10. 分期交付

### 第一阶段：选区理解与采集

1. 播放器字幕和侧栏 Transcript 选区；
2. AI 语境双解卡与缓存；
3. 入库编辑卡；
4. 同义改说和同类扩展的选择性导出；
5. 一视频一 Obsidian 笔记的创建、追加和去重。

### 第二阶段：一视频内化闭环

1. 预表达；
2. 精选片段盲听与挖空；
3. 跟读队列、词伙造句与句型替换；
4. 情境短文与最终输出；
5. 初始回答和最终回答对照。

### 不在当前范围内

- 自动抓取或展示 Oxford、欧路等受版权保护词典内容；
- 插件内大型全局语料库、完整主题商店或跨视频看板；
- 录音转写、口音打分或发音评测；
- 云端账号、服务器、分析追踪或同步服务。

## 11. 验证策略

自动测试覆盖：选区标准化、语境匹配、AI JSON 验证、缓存键、片段去重、Markdown 序列化和 Obsidian URI 构建。

手动测试覆盖：

1. 有原生英文字幕的常规 YouTube 视频；
2. 播放器字幕和侧栏各一次选区；
3. 单词、多词短语和完整句子；
4. AI 失败、网络失败和未配置 Obsidian；
5. 同视频连续追加与重复片段导出；
6. Obsidian 创建、静默追加与回跳链接；
7. 窄窗口、深浅主题及 YouTube 页面重新渲染后的卡片位置。

## 12. 参考来源

- 原始 Episode 2 Notion 导出：`/Users/stella/Desktop/参考/Episode 2 cba4654a02c04cee9040e3b7b033682f.md`
- Episode 2 的预表达、核心语料和额外材料 CSV：`/Users/stella/Desktop/参考/Episode 2/`
- 全局 Mini Test、建筑材料商店和额外材料包 CSV：`/Users/stella/Desktop/参考/Your Corpus Palace/`

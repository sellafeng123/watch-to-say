const test = require("node:test");
const assert = require("node:assert/strict");

const corpus = require("../corpus.js");

test("normalizes only supported caption selection requests", () => {
  const normalized = corpus.normalizeSelectionRequest({
    source: "player-caption",
    selectedText: "  get   into\n the zone  ",
    videoId: "abc123",
    timestampSeconds: 42.8,
    videoTitle: "A title",
    channelName: "A channel",
  });

  assert.deepEqual(normalized, {
    source: "player-caption",
    selectedText: "get into the zone",
    videoId: "abc123",
    timestampSeconds: 42,
    videoTitle: "A title",
    channelName: "A channel",
  });
  assert.equal(
    corpus.normalizeSelectionRequest({
      source: "page-text",
      selectedText: "caption",
      videoId: "abc123",
      timestampSeconds: 0,
    }),
    null,
  );
  assert.equal(
    corpus.normalizeSelectionRequest({
      source: "sidepanel-transcript",
      selectedText: "",
      videoId: "abc123",
      timestampSeconds: 0,
    }),
    null,
  );
  assert.equal(
    corpus.normalizeSelectionRequest({
      source: "sidepanel-transcript",
      selectedText: "caption",
      videoId: "abc123",
      timestampSeconds: -1,
    }),
    null,
  );
});

test("rebuilds contextual gloss from tolerant JSON without untrusted fields", () => {
  const gloss = corpus.normalizeContextualGloss(`\`\`\`json
{
  "label": "AI 语境释义",
  "expression": "get into the zone",
  "kind": "phrase",
  "suggestedTopic": "学习状态",
  "partOfSpeech": "verb phrase",
  "contextMeaningEn": "to become fully focused",
  "contextMeaningZh": "进入高度专注的状态",
  "collocations": [{ "text": "get back into the zone", "noteZh": "重新进入状态" }],
  "sentenceFrame": "I get into the zone when ...",
  "spokenFrequency": "common",
  "frequencyReasonZh": "日常学习和工作场景常用",
  "paraphrases": [
    { "expression": "focus deeply", "differenceZh": "更直接，不强调进入状态的过程" },
    { "expression": "be in the zone", "differenceZh": "描述已经处于专注状态" },
    { "expression": "concentrate hard", "differenceZh": "语气更中性" },
    { "expression": "must be dropped", "differenceZh": "超过三条" }
  ],
  "relatedExtensions": [
    { "expression": "zone out", "differenceZh": "指走神，语义相反" },
    { "expression": "knuckle down", "differenceZh": "指开始认真投入工作" }
  ],
  "providerClaim": "named dictionary"
}
\`\`\``);

  assert.deepEqual(gloss, {
    label: "AI 语境释义",
    expression: "get into the zone",
    kind: "phrase",
    suggestedTopic: "学习状态",
    partOfSpeech: "verb phrase",
    contextMeaningEn: "to become fully focused",
    contextMeaningZh: "进入高度专注的状态",
    collocations: [
      { text: "get back into the zone", noteZh: "重新进入状态" },
    ],
    sentenceFrame: "I get into the zone when ...",
    spokenFrequency: "common",
    frequencyReasonZh: "日常学习和工作场景常用",
    paraphrases: [
      { expression: "focus deeply", differenceZh: "更直接，不强调进入状态的过程" },
      { expression: "be in the zone", differenceZh: "描述已经处于专注状态" },
      { expression: "concentrate hard", differenceZh: "语气更中性" },
    ],
    relatedExtensions: [
      { expression: "zone out", differenceZh: "指走神，语义相反" },
      { expression: "knuckle down", differenceZh: "指开始认真投入工作" },
    ],
  });
});

test("builds an entry with only learning extensions selected by the user", () => {
  const entry = corpus.buildCorpusEntry({
    selection: {
      source: "sidepanel-transcript",
      selectedText: "get into the zone",
      videoId: "abc123",
      timestampSeconds: 65,
      videoTitle: "Study routine",
      channelName: "Daily English",
      timestampedUrl: "https://www.youtube.com/watch?v=abc123&t=65s",
      context: "When I study, I get into the zone after coffee.",
    },
    gloss: {
      label: "AI 语境释义",
      expression: "get into the zone",
      kind: "phrase",
      suggestedTopic: "Study habits",
      partOfSpeech: "verb phrase",
      contextMeaningEn: "to become fully focused",
      contextMeaningZh: "进入高度专注的状态",
      collocations: [],
      sentenceFrame: "I get into the zone when ...",
      spokenFrequency: "common",
      frequencyReasonZh: "日常学习和工作场景常用",
      paraphrases: [
        { expression: "focus deeply", differenceZh: "更直接" },
      ],
      relatedExtensions: [
        { expression: "zone out", differenceZh: "走神，语义相反" },
      ],
    },
    edits: {
      topic: "学习与工作",
      expression: "get into the zone",
      kind: "phrase",
      spokenFrequency: "high",
      personalNote: "下次描述学习状态时用。",
      selectedParaphraseIndexes: [0],
      selectedRelatedExtensionIndexes: [],
    },
  });

  assert.deepEqual(entry.paraphrases, [
    { expression: "focus deeply", differenceZh: "更直接" },
  ]);
  assert.deepEqual(entry.relatedExtensions, []);
  assert.equal(entry.topic, "学习与工作");
  assert.equal(entry.spokenFrequency, "high");
  assert.equal(entry.timestamp, "1:05");
});

test("creates a stable safe video-note path and encoded append URI", () => {
  const path = corpus.buildVideoNotePath({
    folder: "YouTube English",
    videoTitle: "Study / Work: focus?",
    firstExportedAt: new Date("2026-09-13T12:00:00Z"),
  });
  assert.equal(path, "YouTube English/2026-09-13 - Study Work focus.md");
  assert.equal(
    corpus.buildVideoNotePath({
      folder: "../outside",
      videoTitle: "Unsafe",
      firstExportedAt: new Date("2026-09-13T12:00:00Z"),
    }),
    null,
  );

  const uri = corpus.buildObsidianAppendUri({
    vault: "English Vault",
    file: path,
    content: "## 1:05 · get into the zone\n#study & practice",
  });
  assert.equal(
    uri,
    "obsidian://new?vault=English%20Vault&file=YouTube%20English%2F2026-09-13%20-%20Study%20Work%20focus.md&content=%23%23%201%3A05%20%C2%B7%20get%20into%20the%20zone%0A%23study%20%26%20practice&append=true",
  );
  assert.equal(uri.includes("overwrite="), false);
});

test("renders export markdown as literal learner content with source context", () => {
  const markdown = corpus.renderCorpusEntryMarkdown({
    topic: "Study [habits]",
    expression: "get into the zone",
    kind: "phrase",
    spokenFrequency: "common",
    timestamp: "1:05",
    timestampedUrl: "https://www.youtube.com/watch?v=abc123&t=65s",
    videoTitle: "Study routine",
    channelName: "Daily English",
    context: "I <focus> after [coffee].",
    label: "AI 语境释义",
    partOfSpeech: "verb phrase",
    contextMeaningEn: "to become fully focused",
    contextMeaningZh: "进入高度专注的状态",
    collocations: [],
    sentenceFrame: "I get into the zone when ...",
    frequencyReasonZh: "日常学习和工作场景常用",
    paraphrases: [],
    relatedExtensions: [],
    personalNote: "说出自己的例子。",
  });

  assert.match(markdown, /^## 1:05 · get into the zone/m);
  assert.match(markdown, /\[1:05\]\(https:\/\/www\.youtube\.com\/watch\?v=abc123&t=65s\)/);
  assert.match(markdown, /AI 语境释义/);
  assert.ok(markdown.includes("I &lt;focus&gt; after \\[coffee\\]."));
  assert.match(markdown, /说出自己的例子。/);
});

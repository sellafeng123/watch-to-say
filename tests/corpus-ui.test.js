const test = require("node:test");
const assert = require("node:assert/strict");

const ui = require("../corpus-ui.js");

test("prepares editable corpus state without preselecting AI extensions", () => {
  const state = ui.createEditorState({
    expression: "get into the zone",
    kind: "phrase",
    suggestedUsageContexts: "学习 · 工作",
    spokenFrequency: "common",
    paraphrases: [{ expression: "focus deeply", differenceZh: "更直接" }],
    relatedExtensions: [{ expression: "zone out", differenceZh: "语义相反" }],
  });

  assert.deepEqual(state, {
    usageContexts: "学习 · 工作",
    expression: "get into the zone",
    kind: "phrase",
    spokenFrequency: "common",
    personalNote: "",
    selectedParaphraseIndexes: [],
    selectedRelatedExtensionIndexes: [],
  });
});

test("labels learner-facing spoken-frequency choices in Chinese", () => {
  assert.deepEqual(ui.SPOKEN_FREQUENCY_OPTIONS, [
    { value: "high", label: "高频" },
    { value: "common", label: "常用" },
    { value: "situational", label: "场景常用" },
    { value: "low_formal", label: "低频或偏书面" },
  ]);
});

test("builds a readable export-preview model and makes missing usage contexts explicit", () => {
  assert.deepEqual(ui.createEntryPreviewModel({
    expression: "day-to-day lives",
    kind: "phrase",
    spokenFrequency: "common",
    usageContexts: "日常聊天 · 生活描述",
    timestamp: "7:12",
    context: "We talk about our day-to-day lives.",
    contextMeaningZh: "日常生活",
    contextMeaningEn: "ordinary everyday life",
    partOfSpeech: "noun phrase",
    frequencyReasonZh: "日常聊天常用",
    collocations: [{ text: "in day-to-day life", noteZh: "在日常生活中" }],
    sentenceFrame: "In my day-to-day life, ...",
    paraphrases: [],
    relatedExtensions: [],
    personalNote: "用它描述自己的生活。",
  }), {
    expression: "day-to-day lives",
    meta: "【词伙】 · 常用 · 【重点】",
    usageContexts: "日常聊天 · 生活描述",
    timestamp: "7:12",
    context: "We talk about our day-to-day lives.",
    meaning: "日常生活\nEN: ordinary everyday life",
    partOfSpeech: "noun phrase",
    frequencyReason: "日常聊天常用",
    collocationsAndFrame: ["in day-to-day life — 在日常生活中", "句型: In my day-to-day life, ..."],
    extensions: [],
    personalNote: "用它描述自己的生活。",
  });

  assert.equal(
    ui.createEntryPreviewModel({ expression: "get", kind: "word", spokenFrequency: "high" }).usageContexts,
    "未设置，可在编辑时填写",
  );
});

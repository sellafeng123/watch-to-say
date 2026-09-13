const test = require("node:test");
const assert = require("node:assert/strict");

const ui = require("../corpus-ui.js");

test("prepares editable corpus state without preselecting AI extensions", () => {
  const state = ui.createEditorState({
    expression: "get into the zone",
    kind: "phrase",
    suggestedTopic: "Study habits",
    spokenFrequency: "common",
    paraphrases: [{ expression: "focus deeply", differenceZh: "更直接" }],
    relatedExtensions: [{ expression: "zone out", differenceZh: "语义相反" }],
  });

  assert.deepEqual(state, {
    topic: "Study habits",
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

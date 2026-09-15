const test = require("node:test");
const assert = require("node:assert/strict");

const practice = require("../practice-session.js");

test("reveals only the sentence containing the selected phrase", () => {
  assert.equal(practice.extractAnswerSentence({
    context: "I was tired. Then I got into the zone and finished. That felt great.",
    selectedText: "got into the zone",
    expression: "get into the zone",
  }), "Then I got into the zone and finished.");
});

test("uses the timestamp-resolved target caption when a selected expression repeats", () => {
  assert.equal(practice.extractAnswerSentence({
    context: "I get into the zone after coffee. At night, I get into the zone more easily. Then I finish my work.",
    selectedText: "get into the zone",
    expression: "get into the zone",
    targetText: "At night, I get into the zone more easily.",
  }), "At night, I get into the zone more easily.");
});

test("extracts a matching final sentence after mixed English and Chinese terminators", () => {
  assert.equal(practice.extractAnswerSentence({
    context: "Wait! Are you ready? 前面没有目标。最后我进入状态。",
    selectedText: "进入状态",
    expression: "进入状态",
  }), "最后我进入状态。");
});

test("finds expression tokens across inflections when the selected text is unavailable", () => {
  assert.equal(practice.extractAnswerSentence({
    context: "I write notes. She keeps a notebook beside her desk! It helps.",
    selectedText: "unavailable selection",
    expression: "keep a notebook",
  }), "She keeps a notebook beside her desk!");
});

test("retains sentence terminators including paired Chinese punctuation and quoted punctuation", () => {
  assert.equal(practice.extractAnswerSentence({
    context: "他说：“准备好了吗？” 然后我们进入状态！最后回家。",
    selectedText: "进入状态",
    expression: "进入状态",
  }), "然后我们进入状态！");
});

test("prefers the target caption and bounds a long unpunctuated context", () => {
  const context = `Before caption ${"context ".repeat(90)}At night I get into the zone more easily ${"afterward ".repeat(90)}`;
  const answer = practice.extractAnswerSentence({
    context,
    selectedText: "get into the zone",
    expression: "get into the zone",
    targetText: "At night I get into the zone more easily",
  });
  assert.equal(answer, "At night I get into the zone more easily");
  assert.ok(answer.length <= 320);
});

test("bounds an unpunctuated target window when no target caption was stored", () => {
  const context = `${"before ".repeat(90)}I get into the zone while studying ${"after ".repeat(90)}`;
  const answer = practice.extractAnswerSentence({ context, selectedText: "get into the zone", expression: "get into the zone" });
  assert.match(answer, /get into the zone/);
  assert.ok(answer.length <= 320);
  assert.notEqual(answer, context);
});

test("centers an unpunctuated window on an inflected expression match", () => {
  const context = `${"before ".repeat(90)}She keeps a notebook beside her desk ${"after ".repeat(90)}`;
  const answer = practice.extractAnswerSentence({ context, selectedText: "missing selection", expression: "keep a notebook" });
  assert.match(answer, /keeps a notebook/);
  assert.ok(answer.length <= 320);
  assert.notEqual(answer, context);
});

test("falls back to the shortest clause when the expression is absent", () => {
  assert.equal(practice.extractAnswerSentence({
    context: "This opening clause is deliberately much longer, short fallback clause; another longer clause follows.",
    selectedText: "not present",
    expression: "also absent",
  }), "short fallback clause;");
});

function highlight(overrides = {}) {
  return {
    videoId: "video-123",
    videoTitle: "A study video",
    expression: "get into the zone",
    kind: "phrase",
    partOfSpeech: "verb phrase",
    usageContexts: "学习 · 工作",
    spokenFrequency: "common",
    timestamp: "0:18",
    timestampSeconds: 18,
    timestampedUrl: "https://www.youtube.com/watch?v=video-123&t=18s",
    selectedText: "get into the zone",
    targetText: "I get into the zone after coffee.",
    context: "I get into the zone after coffee.",
    ...overrides,
  };
}

test("merges a same-expression same-POS highlight while retaining every source anchor", () => {
  const highlights = practice.mergePracticeHighlights([
    highlight({ expression: "Get  into the zone", timestampSeconds: 18 }),
    highlight({ expression: "get into the zone", timestampSeconds: 74, timestamp: "1:14", context: "Music helps me get into the zone." }),
  ]);

  assert.equal(highlights.length, 1);
  assert.equal(highlights[0].expression, "Get into the zone");
  assert.equal(highlights[0].anchors.length, 2);
  assert.deepEqual(highlights[0].anchors.map((anchor) => anchor.timestampSeconds), [18, 74]);
  assert.equal(highlights[0].anchors[0].targetText, "I get into the zone after coffee.");
});

test("keeps different parts of speech as independent practice highlights", () => {
  const highlights = practice.mergePracticeHighlights([
    highlight({ expression: "manifestation", partOfSpeech: "noun", kind: "word" }),
    highlight({ expression: "manifestation", partOfSpeech: "adjective", kind: "word", timestampSeconds: 43 }),
  ]);

  assert.equal(highlights.length, 2);
  assert.notEqual(highlights[0].id, highlights[1].id);
});

test("creates a session with every supplied highlight selected and all stages unstarted", () => {
  const [item] = practice.mergePracticeHighlights([highlight()]);
  const session = practice.createSession({
    video: { id: "video-123", title: "A study video" },
    highlights: [item],
  });

  assert.equal(session.profile, "ielts");
  assert.deepEqual(session.selectedItemIds, [item.id]);
  assert.deepEqual(session.items[0].stages, {
    listening: "not_started",
    internalization: "not_started",
    speaking: "not_started",
  });
});

test("does not let a later stage be rated before its prerequisite is mastered", () => {
  const [item] = practice.mergePracticeHighlights([highlight()]);
  const session = practice.createSession({ video: { id: "video-123", title: "A study video" }, highlights: [item] });

  const result = practice.rateStage(session, {
    itemId: item.id,
    stage: "internalization",
    rating: "mastered",
  });

  assert.equal(result, null);
  assert.equal(session.items[0].stages.internalization, "not_started");
});

test("queues failed stages for exactly one retry and never creates a retry loop", () => {
  const [item] = practice.mergePracticeHighlights([highlight()]);
  let session = practice.createSession({ video: { id: "video-123", title: "A study video" }, highlights: [item] });

  session = practice.rateStage(session, { itemId: item.id, stage: "listening", rating: "review" });
  assert.deepEqual(practice.nextRetryTasks(session), [{ itemId: item.id, stage: "listening" }]);

  session = practice.rateStage(session, { itemId: item.id, stage: "listening", rating: "review", retry: true });
  assert.deepEqual(practice.nextRetryTasks(session), []);
  assert.equal(session.items[0].stages.listening, "review");
});

test("builds an approved concise Obsidian practice summary without a corpus table", () => {
  const [item] = practice.mergePracticeHighlights([highlight()]);
  let session = practice.createSession({ video: { id: "video-123", title: "A study video" }, highlights: [item] });
  session = practice.rateStage(session, { itemId: item.id, stage: "listening", rating: "mastered" });
  session = practice.rateStage(session, { itemId: item.id, stage: "internalization", rating: "review" });

  const markdown = practice.buildPracticeSummaryMarkdown(session, new Date("2026-09-14T00:00:00Z"));
  assert.match(markdown, /^## 本期表达练习 · 2026-09-14$/m);
  assert.match(markdown, /输出档案：雅思口语题型与高频主题/);
  assert.match(markdown, /听辨：1 会 \/ 0 待复习/);
  assert.match(markdown, /内化：0 会 \/ 1 待复习/);
  assert.match(markdown, /输出：0 会 \/ 0 待复习/);
  assert.match(markdown, /get into the zone（内化）/);
  assert.doesNotMatch(markdown, /语料总表/);
});

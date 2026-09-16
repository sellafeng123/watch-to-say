const test = require("node:test");
const assert = require("node:assert/strict");

const practice = require("../practice-session.js");

test("internalization accepts listening review after an attempt but rejects unattempted listening", () => {
  const session = practice.createSession({ highlights: [{ expression: "focus", partOfSpeech: "verb", timestampSeconds: 0 }] });
  const itemId = session.selectedItemIds[0];
  assert.equal(practice.rateStage(session, { itemId, stage: "internalization", rating: "mastered" }), null);
  const reviewed = practice.rateStage(session, { itemId, stage: "listening", rating: "review" });
  const internalized = practice.rateStage(reviewed, { itemId, stage: "internalization", rating: "mastered" });
  assert.ok(internalized, "a completed listening attempt must allow internalization");
  assert.equal(practice.isReadyForSpeaking(internalized), true);
  assert.deepEqual(practice.stageCounts(internalized, "internalization"), { mastered: 1, review: 0 });
  assert.deepEqual(practice.nextRetryTasks(internalized), [{ itemId, stage: "listening" }]);
});

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

for (const targetText of [
  "At night I focus on my work. Then I rest.",
  "coffee. At night I focus",
  "focus on my work. Then I",
]) {
  test(`resolves a cross-sentence target caption to one complete sentence: ${targetText}`, () => {
    assert.equal(practice.extractAnswerSentence({
      context: "I focus after coffee. At night I focus on my work. Then I rest.",
      selectedText: "focus", expression: "focus", targetText,
    }), "At night I focus on my work.");
  });
}

test("preserves a complete punctuated target sentence longer than the unpunctuated fallback limit", () => {
  const sentence = `At night I focus on ${"the detailed project and ".repeat(18)}finish my work.`;
  assert.equal(practice.extractAnswerSentence({
    context: `Before this. ${sentence} Then I rest.`, selectedText: "focus", expression: "focus", targetText: sentence,
  }), sentence);
});

test("matches an expression beyond the first thousand characters of a complete target sentence", () => {
  const sentence = `${"the detailed project and ".repeat(50)}I focus before I finish my work.`;
  assert.ok(sentence.length > 1200);
  assert.equal(practice.extractAnswerSentence({
    context: `Before this. ${sentence} Then I rest.`, selectedText: "focus", expression: "focus", targetText: sentence,
  }), sentence);
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

test("centers a long target caption on the selected expression instead of truncating its start", () => {
  const targetText = `${"lead ".repeat(80)}Then I got into the zone and finished my notes ${"tail ".repeat(20)}`;
  const answer = practice.extractAnswerSentence({
    context: targetText,
    selectedText: "got into the zone",
    expression: "get into the zone",
    targetText,
  });
  assert.match(answer, /got into the zone/);
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

test("requires a contiguous ordered expression sequence in generated references", () => {
  const target = { selectedText: "got into the zone", expression: "get into the zone" };
  assert.equal(practice.referenceUsesExpression("I get coffee before I walk into the zone.", target), false);
  assert.equal(practice.referenceUsesExpression("After tea, I got into the zone.", target), true);
});

test("accepts a natural singular life variant for a selected day-to-day lives phrase", () => {
  const target = { selectedText: "day-to-day lives", expression: "day-to-day lives" };
  assert.equal(practice.referenceUsesExpression("Our day-to-day life feels calmer when we plan ahead.", target), true);
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

test("creates a session with every supplied highlight selected and only listening and internalization stages", () => {
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
  });
  assert.equal(session.questionSourceMode, "bundled");
  assert.deepEqual(session.speakingExpressionIds, []);
  assert.deepEqual(session.speakingRounds, []);
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

test("keeps listening review to one retry while internalization review remains repeatable", () => {
  const [item] = practice.mergePracticeHighlights([highlight()]);
  let session = practice.createSession({ video: { id: "video-123", title: "A study video" }, highlights: [item] });

  session = practice.rateStage(session, { itemId: item.id, stage: "listening", rating: "review" });
  assert.deepEqual(practice.nextRetryTasks(session), [{ itemId: item.id, stage: "listening" }]);

  session = practice.rateStage(session, { itemId: item.id, stage: "listening", rating: "review", retry: true });
  assert.deepEqual(practice.nextRetryTasks(session), []);
  assert.equal(session.items[0].stages.listening, "review");

  session = practice.rateStage(session, { itemId: item.id, stage: "listening", rating: "mastered" });
  session = practice.rateStage(session, { itemId: item.id, stage: "internalization", rating: "review" });
  assert.deepEqual(practice.internalizationReviewItems(session).map((item) => item.id), [item.id]);
  session = practice.rateStage(session, { itemId: item.id, stage: "internalization", rating: "review" });
  assert.deepEqual(practice.internalizationReviewItems(session).map((item) => item.id), [item.id]);
});

test("locks speaking until every selected expression is mastered and snapshots the complete set", () => {
  const items = practice.mergePracticeHighlights([
    highlight(),
    highlight({ expression: "keep a notebook", timestampSeconds: 44, selectedText: "keep a notebook" }),
  ]);
  let session = practice.createSession({ video: { id: "video-123", title: "A study video" }, highlights: items });

  session = practice.rateStage(session, { itemId: items[0].id, stage: "listening", rating: "mastered" });
  session = practice.rateStage(session, { itemId: items[0].id, stage: "internalization", rating: "mastered" });
  session = practice.rateStage(session, { itemId: items[1].id, stage: "listening", rating: "mastered" });
  session = practice.rateStage(session, { itemId: items[1].id, stage: "internalization", rating: "review" });

  assert.equal(practice.isReadyForSpeaking(session), false);
  assert.deepEqual(session.speakingExpressionIds, []);
  assert.deepEqual(practice.speakingItems(session), []);

  const ready = practice.rateStage(session, { itemId: items[1].id, stage: "internalization", rating: "mastered" });
  assert.equal(practice.isReadyForSpeaking(ready), true);
  assert.deepEqual(ready.speakingExpressionIds, items.map((item) => item.id));
  assert.deepEqual(practice.speakingItems(ready).map((item) => item.id), items.map((item) => item.id));
  assert.deepEqual(session.speakingExpressionIds, []);

  const reviewedAgain = practice.rateStage(ready, { itemId: items[0].id, stage: "internalization", rating: "review" });
  assert.equal(practice.isReadyForSpeaking(reviewedAgain), false);
  assert.deepEqual(practice.speakingItems(reviewedAgain), []);
  assert.equal(practice.addSpeakingRound(reviewedAgain, speakingRound()), null);
});

function speakingRound(overrides = {}) {
  return {
    questionId: "question-1",
    source: "learner_bank",
    part: "part2",
    question: "Describe a study habit that works for you.",
    cuePoints: ["what it is", "why it works"],
    reference: "I keep a notebook and get into the zone after coffee.",
    ...overrides,
  };
}

test("preserves detected expression coverage when a speaking round enters the session", () => {
  const [item] = practice.mergePracticeHighlights([highlight()]);
  let session = practice.createSession({ video: { id: "video-123", title: "A study video" }, highlights: [item] });
  session = practice.rateStage(session, { itemId: item.id, stage: "listening", rating: "mastered" });
  session = practice.rateStage(session, { itemId: item.id, stage: "internalization", rating: "mastered" });

  session = practice.addSpeakingRound(session, speakingRound({ usedExpressionIds: [item.id] }));

  assert.deepEqual(session.speakingRounds[0].usedExpressionIds, [item.id]);
});

test("retries the same speaking round in place without another question ID", () => {
  const [item] = practice.mergePracticeHighlights([highlight()]);
  let session = practice.createSession({ video: { id: "video-123", title: "A study video" }, highlights: [item] });
  session = practice.rateStage(session, { itemId: item.id, stage: "listening", rating: "mastered" });
  session = practice.rateStage(session, { itemId: item.id, stage: "internalization", rating: "mastered" });
  session = practice.addSpeakingRound(session, speakingRound());

  const retried = practice.retrySameSpeakingRound(session, { roundId: session.speakingRounds[0].id });
  assert.equal(retried.speakingRounds.length, 1);
  assert.equal(retried.speakingRounds[0].questionId, "question-1");
  assert.equal(retried.speakingRounds[0].attemptCount, 2);
  assert.deepEqual(practice.usedQuestionIds(retried), ["question-1"]);
  assert.equal(session.speakingRounds[0].attemptCount, 1);
});

test("freezes an active speaking round while internalization readiness is revoked", () => {
  const items = practice.mergePracticeHighlights([
    highlight(),
    highlight({ expression: "keep a notebook", timestampSeconds: 44, selectedText: "keep a notebook" }),
  ]);
  let session = practice.createSession({ video: { id: "video-123", title: "A study video" }, highlights: items });
  items.forEach((item) => {
    session = practice.rateStage(session, { itemId: item.id, stage: "listening", rating: "mastered" });
    session = practice.rateStage(session, { itemId: item.id, stage: "internalization", rating: "mastered" });
  });
  session = practice.addSpeakingRound(session, speakingRound());
  const roundId = session.speakingRounds[0].id;
  const revoked = practice.rateStage(session, {
    itemId: items[0].id,
    stage: "internalization",
    rating: "review",
  });
  const beforeRejectedTransitions = structuredClone(revoked);

  assert.equal(practice.isReadyForSpeaking(revoked), false);
  assert.equal(practice.retrySameSpeakingRound(revoked, { roundId }), null);
  assert.equal(practice.finishSpeakingRound(revoked, { roundId, outcome: "finished" }), null);
  assert.equal(practice.addSpeakingRound(revoked, speakingRound({ questionId: "question-2" })), null);
  assert.deepEqual(revoked, beforeRejectedTransitions);

  const remastered = practice.rateStage(revoked, {
    itemId: items[0].id,
    stage: "internalization",
    rating: "mastered",
  });
  const resumed = practice.retrySameSpeakingRound(remastered, { roundId });
  assert.equal(resumed.speakingRounds[0].attemptCount, 2);
  assert.equal(resumed.speakingRounds[0].outcome, null);
});

test("rejects finished and non-current speaking round IDs for retry and finish", () => {
  const [item] = practice.mergePracticeHighlights([highlight()]);
  let session = practice.createSession({ video: { id: "video-123", title: "A study video" }, highlights: [item] });
  session = practice.rateStage(session, { itemId: item.id, stage: "listening", rating: "mastered" });
  session = practice.rateStage(session, { itemId: item.id, stage: "internalization", rating: "mastered" });
  session = practice.addSpeakingRound(session, speakingRound());
  const firstRoundId = session.speakingRounds[0].id;
  session = practice.finishSpeakingRound(session, { roundId: firstRoundId, outcome: "needs_practice" });
  session = practice.addSpeakingRound(session, speakingRound({ questionId: "question-2" }));
  const secondRoundId = session.speakingRounds[1].id;

  assert.equal(practice.retrySameSpeakingRound(session, { roundId: firstRoundId }), null);
  assert.equal(practice.finishSpeakingRound(session, { roundId: firstRoundId, outcome: "finished" }), null);

  session = practice.finishSpeakingRound(session, { roundId: secondRoundId, outcome: "finished" });
  assert.equal(practice.retrySameSpeakingRound(session, { roundId: secondRoundId }), null);
  assert.equal(practice.finishSpeakingRound(session, { roundId: secondRoundId, outcome: "needs_practice" }), null);
});

test("changes question only after recording needs_practice and rejects duplicate or empty rounds", () => {
  const [item] = practice.mergePracticeHighlights([highlight()]);
  let session = practice.createSession({ video: { id: "video-123", title: "A study video" }, highlights: [item] });
  session = practice.rateStage(session, { itemId: item.id, stage: "listening", rating: "mastered" });
  session = practice.rateStage(session, { itemId: item.id, stage: "internalization", rating: "mastered" });
  session = practice.addSpeakingRound(session, speakingRound());

  const needsPractice = practice.finishSpeakingRound(session, {
    roundId: session.speakingRounds[0].id,
    outcome: "needs_practice",
  });
  assert.equal(needsPractice.speakingRounds[0].outcome, "needs_practice");
  assert.equal(practice.addSpeakingRound(needsPractice, speakingRound()), null);
  assert.equal(practice.addSpeakingRound(needsPractice, speakingRound({ questionId: "question-2", reference: "" })), null);

  const nextQuestion = practice.addSpeakingRound(needsPractice, speakingRound({ questionId: "question-2" }));
  assert.deepEqual(practice.usedQuestionIds(nextQuestion), ["question-1", "question-2"]);
});

test("finishing a speaking round leaves unresolved listening review for final review and rejects item speaking ratings", () => {
  const [item] = practice.mergePracticeHighlights([highlight()]);
  let session = practice.createSession({ video: { id: "video-123", title: "A study video" }, highlights: [item] });
  session = practice.rateStage(session, { itemId: item.id, stage: "listening", rating: "mastered" });
  session = practice.rateStage(session, { itemId: item.id, stage: "internalization", rating: "mastered" });
  session = practice.addSpeakingRound(session, speakingRound());
  const withPendingListening = {
    ...session,
    items: session.items.map((candidate) => candidate.id === item.id
      ? { ...candidate, stages: { ...candidate.stages, listening: "review" } }
      : candidate),
  };

  const finished = practice.finishSpeakingRound(withPendingListening, {
    roundId: withPendingListening.speakingRounds[0].id,
    outcome: "finished",
  });
  assert.deepEqual(practice.nextRetryTasks(finished), [{ itemId: item.id, stage: "listening" }]);
  assert.equal(practice.rateStage(finished, { itemId: item.id, stage: "speaking", rating: "mastered" }), null);
});

test("builds a concise summary with whole-set speaking rounds and pending review", () => {
  const [item] = practice.mergePracticeHighlights([highlight()]);
  let session = practice.createSession({ video: { id: "video-123", title: "A study video" }, highlights: [item] });
  session = practice.rateStage(session, { itemId: item.id, stage: "listening", rating: "mastered" });
  session = practice.rateStage(session, { itemId: item.id, stage: "internalization", rating: "mastered" });
  session = practice.addSpeakingRound(session, speakingRound());
  session = practice.retrySameSpeakingRound(session, { roundId: session.speakingRounds[0].id });
  session = practice.finishSpeakingRound(session, { roundId: session.speakingRounds[0].id, outcome: "needs_practice" });

  const markdown = practice.buildPracticeSummaryMarkdown(session, new Date("2026-09-14T00:00:00Z"));
  assert.match(markdown, /^## 本期表达练习 · 2026-09-14$/m);
  assert.match(markdown, /输出档案：雅思口语题型与高频主题/);
  assert.match(markdown, /听辨：1 会 \/ 0 待复习/);
  assert.match(markdown, /内化：1 会 \/ 0 待复习/);
  assert.match(markdown, /口语输出：完成 0 题 \/ 需要再练 1 题 \/ 原题重答 1 次/);
  assert.match(markdown, /待复习：—/);
  assert.doesNotMatch(markdown, /语料总表/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const flowApi = require("../practice-flow.js");

function session() {
  return {
    id: "session", profile: "work", questionSourceMode: "smart_mix",
    selectedItemIds: ["a", "b"], speakingExpressionIds: [], speakingRounds: [],
    retriedStageKeys: [], createdAt: 1, updatedAt: 1,
    items: ["a", "b"].map((id) => ({ id, expression: id, anchors: [], stages: {
      listening: "not_started", internalization: "not_started",
    } })),
  };
}
const round = { questionId: "q1", source: "deepseek", part: null,
  question: "How do you work?", cuePoints: [], reference: "I use a and b." };
function rate(flow, rating = "mastered") {
  const view = flowApi.currentView(flow);
  return flowApi.reduce(flow, { type: "RATE_ITEM", itemId: view.item.id, stage: view.stage, rating });
}
function readyFlow(listeningRating = "mastered") {
  let flow = flowApi.create(session());
  flow = rate(flow, listeningRating).flow;
  flow = rate(flow).flow;
  flow = rate(flow).flow;
  return rate(flow);
}
function speakingFlow() {
  return flowApi.reduce(readyFlow().flow, { type: "SPEAKING_READY", round }).flow;
}

test("all selected items enter internalization even with listening review; only internalization reviews repeat", () => {
  let flow = flowApi.create(session());
  assert.equal(flowApi.currentView(flow).stage, "listening");
  flow = rate(flow, "review").flow;
  flow = rate(flow).flow;
  assert.equal(flowApi.currentView(flow).stage, "internalization");
  assert.equal(flowApi.currentView(flow).item.id, "a");
  flow = rate(flow, "review").flow;
  let result = rate(flow);
  assert.equal(result.effect, null);
  flow = result.flow;
  for (let attempt = 0; attempt < 5; attempt++) {
    const view = flowApi.currentView(flow);
    assert.equal(view.stage, "internalization");
    assert.equal(view.item.id, "a");
    assert.equal(view.total, 1);
    assert.equal(view.isRetry, true);
    result = rate(flow, "review");
    assert.equal(result.effect, null);
    flow = result.flow;
  }
  result = rate(flow);
  assert.deepEqual(result.effect, { type: "REQUEST_SPEAKING_ROUND", expressionIds: ["a", "b"], usedQuestionIds: [] });
  assert.deepEqual(result.flow.session.speakingExpressionIds, ["a", "b"]);
  assert.equal(flowApi.currentView(result.flow).type, "speaking_loading");
  assert.equal(flowApi.reduce(result.flow, { type: "RATE_ITEM", itemId: "a", stage: "internalization", rating: "mastered" }).effect, null);
});

test("same-question retry increments one round and hides reference without any request", () => {
  let flow = speakingFlow();
  assert.equal(flowApi.currentView(flow).revealed, false);
  assert.equal(flowApi.reduce(flow, { type: "FINISH_SPEAKING" }).flow, flow);
  flow = flowApi.reduce(flow, { type: "REVEAL_SPEAKING" }).flow;
  const sessionBefore = flow.session;
  flow = flowApi.reduce(flow, { type: "OPEN_RETRY_CHOICE" }).flow;
  assert.equal(flow.session, sessionBefore);
  assert.equal(flowApi.currentView(flow).retryChoiceOpen, true);
  const result = flowApi.reduce(flow, { type: "RETRY_SAME_QUESTION" });
  assert.equal(result.effect, null);
  assert.equal(result.flow.session.speakingRounds.length, 1);
  assert.equal(result.flow.session.speakingRounds[0].attemptCount, 2);
  assert.equal(flowApi.currentView(result.flow).revealed, false);
  assert.equal(flowApi.currentView(result.flow).retryChoiceOpen, false);
});

test("cancel preserves round; new-question failure restores it and allows retry or finish", () => {
  let flow = flowApi.reduce(speakingFlow(), { type: "REVEAL_SPEAKING" }).flow;
  const original = flow.session;
  flow = flowApi.reduce(flow, { type: "OPEN_RETRY_CHOICE" }).flow;
  flow = flowApi.reduce(flow, { type: "CANCEL_RETRY_CHOICE" }).flow;
  assert.equal(flow.session, original);
  assert.equal(flowApi.currentView(flow).retryChoiceOpen, false);
  flow = flowApi.reduce(flow, { type: "OPEN_RETRY_CHOICE" }).flow;
  const request = flowApi.reduce(flow, { type: "RETRY_NEW_QUESTION" });
  assert.deepEqual(request.effect, { type: "REQUEST_SPEAKING_ROUND", expressionIds: ["a", "b"], usedQuestionIds: ["q1"] });
  assert.equal(request.flow.session.speakingRounds[0].outcome, "needs_practice");
  assert.equal(flowApi.reduce(request.flow, { type: "RETRY_NEW_QUESTION" }).effect, null);
  const failed = flowApi.reduce(request.flow, { type: "SPEAKING_FAILED", message: "Network unavailable" });
  const view = flowApi.currentView(failed.flow);
  assert.equal(view.type, "speaking");
  assert.equal(view.round.questionId, "q1");
  assert.equal(view.round.outcome, null);
  assert.equal(view.revealed, true);
  assert.equal(view.error, "Network unavailable");
  assert.equal(flowApi.reduce(failed.flow, { type: "FINISH_SPEAKING" }).flow.session.speakingRounds[0].outcome, "finished");
  const next = flowApi.reduce(request.flow, { type: "SPEAKING_READY", round: { ...round, questionId: "q2" } });
  assert.equal(flowApi.currentView(next.flow).round.questionId, "q2");
  assert.equal(next.flow.session.speakingRounds.length, 2);
});

test("finish runs unresolved listening retry exactly once before summary", () => {
  let flow = flowApi.reduce(readyFlow("review").flow, { type: "SPEAKING_READY", round }).flow;
  flow = flowApi.reduce(flow, { type: "REVEAL_SPEAKING" }).flow;
  flow = flowApi.reduce(flow, { type: "FINISH_SPEAKING" }).flow;
  const view = flowApi.currentView(flow);
  assert.equal(view.type, "item");
  assert.equal(view.stage, "listening");
  assert.equal(view.item.id, "a");
  assert.equal(view.isRetry, true);
  const result = rate(flow, "review");
  assert.equal(result.effect, null);
  assert.equal(flowApi.currentView(result.flow).type, "summary");
});

test("initial failure can retry, invalid and stale events do nothing, and transitions are immutable and deterministic", () => {
  const flow = flowApi.create(session());
  const before = JSON.stringify(flow);
  assert.equal(flowApi.reduce(flow, { type: "RATE_ITEM", itemId: "b", stage: "listening", rating: "mastered" }).flow, flow);
  assert.equal(flowApi.reduce(flow, { type: "SPEAKING_READY", round }).flow, flow);
  assert.deepEqual(rate(flow), rate(flow));
  assert.equal(JSON.stringify(flow), before);
  const failed = flowApi.reduce(readyFlow().flow, { type: "SPEAKING_FAILED", message: "Try again" }).flow;
  assert.equal(flowApi.currentView(failed).type, "speaking_error");
  assert.deepEqual(flowApi.reduce(failed, { type: "RETRY_NEW_QUESTION" }).effect,
    { type: "REQUEST_SPEAKING_ROUND", expressionIds: ["a", "b"], usedQuestionIds: [] });
});

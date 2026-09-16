const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const practiceUi = require("../practice-ui.js");
globalThis.YTD_PRACTICE = require("../practice-session.js");
const { createFakeDom, click } = require("./helpers/fake-dom.js");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("asks learners to say two sentences for every internalization expression type", () => {
  ["word", "phrase", "sentence_frame"].forEach((kind) => {
    assert.match(practiceUi.internalizationGuidance(kind), /两句/);
  });
});

test("listening reveals only its selected sentence and unlocks ratings after reveal", () => {
  const { root } = createFakeDom();
  const ratings = [];
  practiceUi.mountStage({
    root,
    stage: "listening",
    item: {
      expression: "get into the zone",
      anchors: [{ timestamp: "0:18", timestampSeconds: 18, selectedText: "got into the zone", context: "I was tired. Then I got into the zone and finished. That felt great." }],
    },
    position: 1,
    total: 1,
    onRate: (rating) => ratings.push(rating),
  });

  assert.equal(root.querySelector(".practice-reveal").textContent, "显示答案");
  assert.equal(root.querySelector(".practice-answer").hidden, true);
  assert.equal(root.querySelector(".practice-rating-actions").hidden, true);
  click(root.querySelector(".practice-reveal"));
  assert.equal(root.querySelector(".practice-answer").textContent, "参考答案Then I got into the zone and finished.");
  assert.equal(root.querySelector(".practice-rating-actions").hidden, false);
  click(root.querySelector(".practice-rating-actions").querySelectorAll("button")[0]);
  assert.deepEqual(ratings, ["review"]);
});

test("listening renders a bounded target caption as text rather than markup", () => {
  const { root } = createFakeDom();
  const context = `${"before ".repeat(90)}<img src=x onerror=alert(1)> get into the zone safely ${"after ".repeat(90)}`;
  practiceUi.mountStage({
    root,
    stage: "listening",
    item: {
      expression: "get into the zone",
      anchors: [{ selectedText: "get into the zone", targetText: "<img src=x onerror=alert(1)> get into the zone safely", context }],
    },
    position: 1,
    total: 1,
  });

  click(root.querySelector(".practice-reveal"));
  const answer = root.querySelector(".practice-answer");
  assert.equal(answer.textContent, "参考答案<img src=x onerror=alert(1)> get into the zone safely");
  assert.equal(answer.querySelector("img"), null);
  assert.ok(answer.textContent.length <= 324);
});

test("internalization reveals exactly three ordered reference examples after speak-first gating", () => {
  const { root } = createFakeDom();
  practiceUi.mountStage({
    root,
    stage: "internalization",
    item: { expression: "get into the zone", kind: "phrase", anchors: [{ timestamp: "0:18" }] },
    material: {
      internalization: {
        promptZh: "用真实场景各说两句。",
        references: ["I get into the zone after coffee.", "Music helps me get into the zone.", "Once I get into the zone, I stop checking my phone."],
      },
    },
    position: 1,
    total: 1,
  });

  assert.match(root.textContent, /先在口中完成，再显示参考答案/);
  assert.equal(root.querySelector(".practice-reveal").textContent, "表达参考");
  assert.equal(root.querySelector(".practice-answer").hidden, true);
  assert.equal(root.querySelector(".practice-answer").querySelectorAll("li").length, 3);
  click(root.querySelector(".practice-reveal"));
  assert.equal(root.querySelector(".practice-answer").textContent, "表达参考I get into the zone after coffee.Music helps me get into the zone.Once I get into the zone, I stop checking my phone.");
  assert.equal(root.querySelector(".practice-answer").querySelectorAll("li").length, 3);
  assert.equal(root.querySelector(".practice-rating-actions").hidden, false);
});

test("side panel loads the practice UI before its orchestrator", () => {
  const html = read("sidepanel.html");
  assert.match(html, /id="practiceModal"/);
  assert.match(html, /<script src="practice-ui\.js"><\/script>[\s\S]*<script src="sidepanel\.js"><\/script>/);
});

test("setup changes source choices and defaults with profile and submits the selected source", () => {
  const { root } = createFakeDom();
  const starts = [];
  practiceUi.mountSetup({ root, highlights: [{ id: "a", expression: "hello" }], questionSources: { bundledAvailable: true }, onStart: (value) => starts.push(value) });
  const profile = root.querySelector('[name="profile"]');
  const source = root.querySelector('[name="sourceMode"]');
  assert.ok(source, "source selector must be rendered");
  assert.deepEqual(source.children.map((option) => option.value), ["bundled", "bundled_plus_mine"]);
  assert.equal(source.value, "bundled");
  for (const name of ["work", "daily", "travel"]) {
    profile.value = name;
    profile.dispatchEvent("change");
    assert.deepEqual(source.children.map((option) => option.value), ["smart_mix", "mine_only", "ai_only"]);
    assert.equal(source.value, "smart_mix");
  }
  source.value = "mine_only";
  click(root.querySelector('[type="submit"]') || root.querySelector(".practice-primary"));
  assert.deepEqual(starts, [{ selectedIds: ["a"], profile: "travel", sourceMode: "mine_only" }]);
  profile.value = "ielts";
  profile.dispatchEvent("change");
  assert.equal(source.value, "bundled");
});

test("setup disables sources only during metadata loading and blocks IELTS with a missing local bank", () => {
  const { root } = createFakeDom();
  const starts = [];
  const setup = practiceUi.mountSetup({ root, highlights: [{ id: "a", expression: "hello" }], onStart: (value) => starts.push(value) });
  assert.equal(root.querySelector('[name="sourceMode"]').disabled, true);
  setup.updateQuestionSources({ bundledAvailable: false });
  assert.equal(root.querySelector('[name="sourceMode"]').disabled, false);
  assert.equal(root.querySelector(".practice-primary").disabled, true);
  assert.match(root.querySelector(".practice-source-status").textContent, /本地.*题库.*安装/);
  click(root.querySelector(".practice-primary"));
  assert.deepEqual(starts, []);
  const profile = root.querySelector('[name="profile"]');
  profile.value = "work";
  profile.dispatchEvent("change");
  assert.equal(root.querySelector(".practice-primary").disabled, false);
});

test("one speaking question, cue list, expression coverage, safe highlighted reference and overall actions obey speak-first gating", () => {
  const { root } = createFakeDom();
  const events = [];
  practiceUi.mountSpeakingRound({ root, round: { part: "part2", question: "Describe <img src=x> a day.", cuePoints: ["when", "<script>where</script>"], reference: "I <img src=x> get into the zone & focus.", usedExpressionIds: ["a"] }, expressions: [{ id: "a", expression: "get into the zone", anchors: [{ timestampSeconds: 18 }] }, { id: "b", expression: "<b>focus</b>" }], position: 1,
    onReveal: () => events.push("reveal"), onFinish: () => events.push("finish"), onNeedPractice: () => events.push("practice"), onSeek: (value) => events.push(value) });
  assert.equal(root.querySelectorAll(".practice-speaking-question").length, 1);
  assert.match(root.textContent, /IELTS Part 2/);
  assert.deepEqual(root.querySelector(".practice-cue-points").querySelectorAll("li").map((node) => node.textContent), ["when", "<script>where</script>"]);
  assert.equal(root.querySelectorAll(".practice-expression-chip").length, 2);
  click(root.querySelector(".practice-expression-chip"));
  assert.deepEqual(events, [18]);
  assert.equal(root.querySelector(".practice-answer").hidden, true);
  assert.equal(root.querySelector(".practice-speaking-actions").hidden, true);
  assert.equal(root.querySelector(".practice-reveal").textContent, "口语参考");
  click(root.querySelector(".practice-reveal"));
  assert.equal(root.querySelector(".practice-answer").hidden, false);
  assert.equal(root.querySelector(".practice-coverage").textContent, "已覆盖 1/2 个高亮表达");
  const unusedChip = root.querySelectorAll(".practice-expression-chip")[1];
  assert.match(unusedChip.className, /is-unused/);
  assert.equal(root.querySelector(".practice-expression-status").textContent, "本题未覆盖");
  assert.equal(root.querySelector("mark").textContent, "get into the zone");
  assert.equal(root.querySelector("img"), null);
  assert.equal(root.querySelector("script"), null);
  assert.deepEqual(root.querySelector(".practice-speaking-actions").querySelectorAll("button").map((node) => node.textContent), ["完成本次练习", "需要再练"]);
  root.querySelector(".practice-speaking-actions").querySelectorAll("button").forEach(click);
  assert.deepEqual(events, [18, "reveal", "finish", "practice"]);
});

test("retry panel exposes three choices and only changing questions carries the API reminder; failures stay inline", () => {
  const { root } = createFakeDom();
  const events = [];
  practiceUi.mountSpeakingRound({ root, round: { question: "Question", reference: "Reference", attemptCount: 2 }, expressions: [], position: 1, revealed: true, retryChoiceOpen: true, error: "<img> request failed",
    onRetrySame: () => events.push("same"), onChangeQuestion: () => events.push("new"), onCancelRetry: () => events.push("cancel") });
  const panel = root.querySelector(".practice-retry-choices");
  assert.equal(panel.hidden, false);
  const buttons = panel.querySelectorAll("button");
  assert.deepEqual(buttons.map((node) => node.textContent), ["再答一次这道题", "换一道新题", "返回当前题目"]);
  assert.match(buttons[1].parentNode.textContent, /API.*费用/);
  assert.doesNotMatch(buttons[0].parentNode.textContent, /API.*费用/);
  buttons.forEach(click);
  assert.deepEqual(events, ["same", "new", "cancel"]);
  assert.equal(root.querySelector(".practice-inline-error").textContent, "<img> request failed");
  assert.equal(root.querySelector("img"), null);
});

test("summary reports whole-round outcomes and same-question attempts", () => {
  const { root } = createFakeDom();
  practiceUi.mountSummary({ root, session: { items: [], selectedItemIds: [], speakingRounds: [{ outcome: "finished", attemptCount: 3 }, { outcome: "needs_practice", attemptCount: 1 }] } });
  assert.match(root.textContent, /口语输出：完成 1 题 \/ 需要再练 1 题 \/ 原题重答 2 次/);
});

function loadPracticePanel(sendMessage) {
  const vm = require("node:vm");
  const { document } = createFakeDom();
  document.addEventListener = () => {};
  document.body.classList = { add() {}, remove() {} };
  const overlay = document.createElement("div");
  overlay.id = "practiceModal";
  const content = document.createElement("div");
  content.id = "practiceModalContent";
  overlay.append(content);
  document.body.append(overlay);
  const listeners = { addListener() {} };
  const context = vm.createContext({ document, console, URL, setTimeout, clearTimeout,
    window: {}, YTD_SETTINGS: {}, YTD_PRACTICE: globalThis.YTD_PRACTICE,
    YTD_PRACTICE_UI: practiceUi, YTD_PRACTICE_FLOW: require("../practice-flow.js"),
    chrome: { runtime: { onMessage: listeners, sendMessage }, windows: { getCurrent: async () => ({ id: 1 }) }, tabs: { onUpdated: listeners, onActivated: listeners } },
  });
  vm.runInContext(read("sidepanel.js"), context);
  vm.runInContext('currentVideoId = "video"; currentPracticeHighlights = YTD_PRACTICE.mergePracticeHighlights([{ expression: "focus", partOfSpeech: "verb", timestampSeconds: 0 }]);', context);
  return { content, run: (code) => vm.runInContext(code, context) };
}
const flushPanel = () => new Promise((resolve) => setImmediate(resolve));

test("side-panel DOM flow requests one whole-set round, makes no same-question request, and restores failed changes", async () => {
  const requests = [];
  const panel = loadPracticePanel(async (message) => {
    requests.push(message);
    if (message.action === "getPracticeQuestionSources") return { success: true, bundledAvailable: true, banks: [] };
    if (message.action === "getPracticeMaterials") return { success: true, materials: { items: [] } };
    if (message.action === "getSpeakingRound") return requests.filter((request) => request.action === "getSpeakingRound").length === 1
      ? { success: true, round: { questionId: "q1", source: "deepseek", question: "How do you focus?", reference: "I focus at work." } }
      : { success: false, error: "QUESTION_BANK_EXHAUSTED" };
    throw new Error(`Unexpected action ${message.action}`);
  });
  panel.run("openPracticeSetup()");
  await flushPanel();
  assert.equal(requests[0]?.action, "getPracticeQuestionSources");
  const profile = panel.content.querySelector('[name="profile"]');
  profile.value = "work";
  profile.dispatchEvent("change");
  click(panel.content.querySelector(".practice-primary"));
  await flushPanel();
  for (let stage = 0; stage < 2; stage++) {
    click(panel.content.querySelector(".practice-reveal"));
    click(panel.content.querySelector(".practice-rating-actions").querySelector(".practice-primary"));
  }
  await flushPanel();
  const speaking = requests.filter((request) => request.action === "getSpeakingRound");
  assert.equal(speaking.length, 1);
  assert.equal(speaking[0].request.profile, "work");
  assert.equal(speaking[0].request.sourceMode, "smart_mix");
  assert.deepEqual(speaking[0].request.expressions.map((item) => item.expression), ["focus"]);
  assert.deepEqual(speaking[0].request.usedQuestionIds, []);
  click(panel.content.querySelector(".practice-reveal"));
  click(panel.content.querySelector(".practice-speaking-actions").querySelector(".practice-secondary"));
  click(panel.content.querySelector(".practice-retry-choices").querySelectorAll("button")[0]);
  await flushPanel();
  assert.equal(requests.filter((request) => request.action === "getSpeakingRound").length, 1);
  assert.equal(panel.content.querySelector(".practice-answer").hidden, true);
  click(panel.content.querySelector(".practice-reveal"));
  click(panel.content.querySelector(".practice-speaking-actions").querySelector(".practice-secondary"));
  click(panel.content.querySelector(".practice-retry-choices").querySelectorAll("button")[1]);
  await flushPanel();
  assert.deepEqual(requests.at(-1).request.usedQuestionIds, ["q1"]);
  assert.equal(panel.content.querySelector(".practice-speaking-question").textContent, "How do you focus?");
  assert.match(panel.content.querySelector(".practice-inline-error").textContent, /题库/);
  click(panel.content.querySelector(".practice-speaking-actions").querySelector(".practice-primary"));
  assert.match(panel.content.textContent, /口语输出：完成 1 题/);
});

test("closing setup or a loading session ignores late metadata and material responses", async () => {
  let resolveMessage;
  const panel = loadPracticePanel(() => new Promise((resolve) => { resolveMessage = resolve; }));
  panel.run("openPracticeSetup()");
  assert.equal(typeof resolveMessage, "function");
  panel.run("closePracticeModal()");
  resolveMessage({ success: true, bundledAvailable: true });
  await flushPanel();
  assert.equal(panel.content.children.length, 0);
  panel.run('startPracticeSession({ selectedIds: currentPracticeHighlights.map((item) => item.id), profile: "work", sourceMode: "ai_only" })');
  panel.run("closePracticeModal()");
  resolveMessage({ success: true, materials: { items: [] } });
  await flushPanel();
  assert.equal(panel.content.children.length, 0);
});

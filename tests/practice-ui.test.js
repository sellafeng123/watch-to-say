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

test("side panel orchestrates setup, AI materials, fixed stages, and one retry pass", () => {
  const source = read("sidepanel.js");
  assert.match(source, /startPracticeBtn[\s\S]*openPracticeSetup/);
  assert.match(source, /action: "getPracticeMaterials"/);
  assert.match(source, /\["listening", "internalization", "speaking"\]/);
  assert.match(source, /YTD_PRACTICE\.nextRetryTasks/);
  assert.match(source, /YTD_PRACTICE_UI\.mountSummary/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const practiceUi = require("../practice-ui.js");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("uses a different contextual internalization instruction for every expression type", () => {
  assert.match(practiceUi.internalizationGuidance("word"), /搭配.*真实场景/);
  assert.match(practiceUi.internalizationGuidance("phrase"), /保留.*替换/);
  assert.match(practiceUi.internalizationGuidance("sentence_frame"), /保留框架.*补全/);
});

test("practice stages preserve speak first, reveal, then self-rate", () => {
  const source = read("practice-ui.js");
  assert.match(source, /先在口中完成，再显示参考答案/);
  assert.match(source, /显示答案/);
  assert.match(source, /我会/);
  assert.match(source, /还不会/);
  assert.match(source, /ratingActions\.hidden = true/);
  assert.match(source, /answer\.hidden = false;[\s\S]*ratingActions\.hidden = false/);
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

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadClassicPage } = require("./helpers/classic-page.js");
const { input, click } = require("./helpers/fake-dom.js");
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("Settings classic scripts render the question bank manager without injected module globals", async () => {
  const { document } = loadClassicPage("options.html");
  await settle();
  assert.ok(document.querySelector(".question-bank-recognize"));
  assert.ok(document.querySelector("#questionBankSourceText"));
});

test("side panel classic scripts reveal the complete listening sentence", () => {
  const { document, run } = loadClassicPage("sidepanel.html");
  run(`YTD_PRACTICE_UI.mountStage({ root: document.getElementById("practiceModalContent"), stage: "listening",
    item: { expression: "focus", anchors: [{ selectedText: "focus", context: "It is quiet. I focus on my work. Then I rest." }] }, position: 1, total: 1 });`);
  click(document.querySelector(".practice-reveal"));
  assert.equal(document.querySelector(".practice-answer").textContent, "参考答案I focus on my work.");
});

for (const action of ["language", "rename", "delete"]) {
  test(`Settings preserves an unrecognized draft across ${action} rerenders`, async () => {
    const messages = [];
    const { document } = loadClassicPage("options.html", async (message) => {
      messages.push(message);
      return { success: true, banks: [{ id: "saved", name: "Saved bank", profiles: ["daily"], questionCount: 1 }] };
    });
    await settle();
    assert.ok(document.querySelector("#questionBankSourceText"), "manager loaded from classic scripts");
    input(document.querySelector("#questionBankName"), "  Unrecognized draft  ");
    input(document.querySelector("#questionBankSourceText"), "My question?\nAnother question?");
    const profile = document.querySelector('[data-profile="work"]');
    profile.checked = true;
    profile.dispatchEvent("change");
    if (action === "language") click(document.querySelector('[data-language="zh-CN"]'));
    else click(document.querySelector(`.question-bank-${action}`));
    await settle();
    assert.equal(document.querySelector("#questionBankSourceText").value, "My question?\nAnother question?");
    assert.equal(document.querySelector("#questionBankName").value, "  Unrecognized draft  ");
    assert.equal(document.querySelector('[data-profile="work"]').checked, true);
    assert.equal(messages.some((message) => message.action === "previewQuestionBankImport"), false);
  });
}

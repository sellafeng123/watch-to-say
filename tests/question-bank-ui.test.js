const test = require("node:test");
const assert = require("node:assert/strict");

const ui = require("../question-bank-ui.js");
const options = require("../options.js");
const { createFakeDom, input, click } = require("./helpers/fake-dom.js");

const copy = {
  title: "Speaking question banks",
  help: "Paste questions, then review them before saving.",
  bankName: "Bank name",
  profiles: "Use with",
  profileIelts: "IELTS",
  profileWork: "Work",
  profileDaily: "Daily conversation",
  profileTravel: "Travel",
  profileGeneral: "General speaking",
  sourceText: "Questions to recognize",
  recognize: "Recognize question bank",
  profilesRequired: "Choose at least one profile.",
  previewTitle: "Recognition preview",
  questionCount: ({ count }) => `${count} questions`,
  profileCount: ({ count }) => `${count} profiles`,
  partCount: ({ part, count }) => `${part}: ${count}`,
  sampleQuestions: "Sample questions",
  unrecognized: ({ count }) => `${count} unrecognized fragments`,
  save: "Save question bank",
  savedBanks: "Saved question banks",
  rename: "Rename",
  replace: "Replace questions",
  delete: "Delete",
  noBanks: "No saved question banks yet.",
  deleteConfirm: "Delete this question bank?",
};

const preview = {
  previewToken: "preview-1",
  summary: {
    name: "Office English",
    profiles: ["work", "general"],
    questionCount: 4,
    partCounts: { part1: 2, part2: 1, part3: 1 },
  },
  sampleQuestions: [
    { part: "part1", question: "How do you prepare for an important meeting?" },
    { part: "part2", question: "Describe a project you enjoyed." },
    { part: "part3", question: "How has remote work changed communication?" },
  ],
  unrecognized: ["heading only"],
};

function managerState(overrides = {}) {
  return {
    draft: { name: "Office English", profiles: ["work"], sourceText: "1. How do you prepare for an important meeting?" },
    preview: null,
    banks: [{ id: "learner-7", name: "Existing bank", profiles: ["daily"], questionCount: 8 }],
    ...overrides,
  };
}

function addOptionsPage(document) {
  const ids = [
    ["form", "settingsForm"], ["input", "aiApiKey"], ["input", "supadataApiKey"],
    ["input", "obsidianVault"], ["input", "obsidianFolder"], ["textarea", "customizationPrompt"],
    ["button", "copyCustomizationPromptBtn"], ["span", "copyStatus"], ["span", "saveStatus"],
    ["span", "dataStatus"], ["section", "questionBankManager"], ["button", "clearCacheBtn"],
    ["button", "clearNotesBtn"], ["button", "resetBtn"],
  ];
  const form = document.createElement("form");
  form.id = "settingsForm";
  document.body.append(form);
  for (const [tag, id] of ids.slice(1, 10)) {
    const element = document.createElement(tag);
    element.id = id;
    form.append(element);
  }
  for (const [tag, id] of ids.slice(10)) {
    const element = document.createElement(tag);
    element.id = id;
    document.body.append(element);
  }
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test("requires a profile before recognizing and keeps the typed source after recognition failure", () => {
  const { root } = createFakeDom();
  const received = [];
  ui.mountManager({
    root,
    copy,
    state: managerState({ draft: { name: "Draft", profiles: [], sourceText: "My original pasted question" } }),
    callbacks: { onRecognize: (draft) => received.push(draft) },
  });

  click(root.querySelector(".question-bank-recognize"));
  assert.equal(received.length, 0);
  assert.equal(root.querySelector(".question-bank-status").textContent, "Choose at least one profile.");
  assert.equal(root.querySelector("#questionBankSourceText").value, "My original pasted question");

  const profile = root.querySelector('[data-profile="work"]');
  profile.checked = true;
  profile.dispatchEvent("input");
  click(root.querySelector(".question-bank-recognize"));
  assert.deepEqual(received[0], {
    name: "Draft",
    profiles: ["work"],
    sourceText: "My original pasted question",
    replaceBankId: null,
  });

  ui.mountManager({
    root,
    copy,
    state: managerState({ draft: received[0], status: "Recognition failed. Try again." }),
    callbacks: {},
  });
  assert.equal(root.querySelector("#questionBankSourceText").value, "My original pasted question");
});

test("shows only an explicit recognition preview before save and renders its summary", () => {
  const { root } = createFakeDom();
  ui.mountManager({ root, copy, state: managerState(), callbacks: {} });
  assert.equal(root.querySelector(".question-bank-save"), null);

  ui.mountManager({ root, copy, state: managerState({ preview }), callbacks: {} });
  assert.match(root.querySelector(".question-bank-preview").textContent, /4 questions/);
  assert.match(root.querySelector(".question-bank-preview").textContent, /2 profiles/);
  assert.match(root.querySelector(".question-bank-preview").textContent, /part1: 2/);
  assert.match(root.querySelector(".question-bank-preview").textContent, /part2: 1/);
  assert.match(root.querySelector(".question-bank-preview").textContent, /part3: 1/);
  assert.match(root.querySelector(".question-bank-preview").textContent, /1 unrecognized fragments/);
  assert.deepEqual(
    root.querySelectorAll(".question-bank-sample").map((node) => node.textContent),
    preview.sampleQuestions.map((item) => item.question),
  );
  assert.ok(root.querySelector(".question-bank-save"));
});

test("exposes recognition loading through the accessible status region", () => {
  const { root } = createFakeDom();
  ui.mountManager({ root, copy, state: managerState({ loading: true, status: "Recognizing question bank…" }), callbacks: {} });
  assert.equal(root.querySelector(".question-bank-manager").getAttribute("aria-busy"), "true");
  assert.equal(root.querySelector(".question-bank-status").getAttribute("role"), "status");
  assert.equal(root.querySelector(".question-bank-recognize").disabled, true);
});

test("rename, replace, and delete controls target the selected learner bank", () => {
  const { root } = createFakeDom();
  const events = [];
  ui.mountManager({
    root,
    copy,
    state: managerState(),
    callbacks: {
      onRename: (bankId, name) => events.push(["rename", bankId, name]),
      onReplace: (bankId) => events.push(["replace", bankId]),
      onDelete: (bankId) => events.push(["delete", bankId]),
    },
  });
  const row = root.querySelector('[data-bank-id="learner-7"]');
  input(row.querySelector(".question-bank-bank-name"), "Renamed bank");
  click(row.querySelector(".question-bank-rename"));
  click(row.querySelector(".question-bank-replace"));
  click(row.querySelector(".question-bank-delete"));
  assert.deepEqual(events, [
    ["rename", "learner-7", "Renamed bank"],
    ["replace", "learner-7"],
    ["delete", "learner-7"],
  ]);
});

test("uses localized English and Chinese labels and confirms immediately before deleting", async () => {
  const english = createFakeDom();
  ui.mountManager({ root: english.root, copy, state: managerState(), callbacks: {} });
  assert.match(english.root.textContent, /Speaking question banks/);
  assert.doesNotMatch(english.root.textContent, /识别题库/);

  const chineseCopy = {
    ...copy,
    title: "口语题库",
    bankName: "题库名称",
    recognize: "识别题库",
    savedBanks: "已保存题库",
  };
  const chinese = createFakeDom();
  ui.mountManager({ root: chinese.root, copy: chineseCopy, state: managerState(), callbacks: {} });
  assert.match(chinese.root.textContent, /口语题库/);
  assert.match(chinese.root.textContent, /识别题库/);

  const calls = [];
  const callbacks = options.createQuestionBankCallbacks({
    request: async (message) => { calls.push(["request", message]); return { success: true }; },
    confirm: () => { calls.push(["confirm"]); return true; },
    copy,
  });
  await callbacks.onDelete("learner-7");
  assert.deepEqual(calls, [
    ["confirm"],
    ["request", { action: "deleteQuestionBank", request: { bankId: "learner-7" } }],
  ]);
});

test("options preserves a failed recognition draft, clears only after save, and passes replacement IDs", async () => {
  const { document } = createFakeDom();
  addOptionsPage(document);
  const messages = [];
  let previewSucceeds = false;
  const root = {
    document,
    YTD_QUESTION_BANK_UI: ui,
    YTD_SETTINGS: {
      STORAGE_KEY: "settings",
      migrateLegacyCustom: () => ({ migrated: false, settings: { aiApiKey: "", supadataApiKey: "", obsidianVault: "", obsidianFolder: "" } }),
      normalize: (value) => value,
    },
    confirm: () => true,
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {}, clear: async () => {} } },
      runtime: {
        sendMessage: async (message) => {
          messages.push(message);
          if (message.action === "listQuestionBanks") {
            return { success: true, banks: [{ id: "learner-7", name: "Existing bank", profiles: ["daily"], questionCount: 8 }] };
          }
          if (message.action === "previewQuestionBankImport") {
            return previewSucceeds ? { success: true, ...preview } : { success: false, error: "INVALID_AI_RESPONSE" };
          }
          if (message.action === "saveQuestionBank") return { success: true };
          return { success: true };
        },
      },
    },
  };
  options.initialize(root);
  await settle();
  let manager = document.getElementById("questionBankManager");
  input(manager.querySelector("#questionBankName"), "Replacement");
  input(manager.querySelector("#questionBankSourceText"), "Question text that must survive failure");
  const work = manager.querySelector('[data-profile="work"]');
  work.checked = true;
  click(manager.querySelector(".question-bank-recognize"));
  await settle();
  manager = document.getElementById("questionBankManager");
  assert.equal(manager.querySelector("#questionBankSourceText").value, "Question text that must survive failure");
  assert.match(manager.querySelector(".question-bank-status").textContent, /still here to edit/);

  previewSucceeds = true;
  click(manager.querySelector(".question-bank-recognize"));
  await settle();
  manager = document.getElementById("questionBankManager");
  click(manager.querySelector(".question-bank-save"));
  await settle();
  manager = document.getElementById("questionBankManager");
  assert.equal(manager.querySelector("#questionBankSourceText").value, "");

  const row = manager.querySelector('[data-bank-id="learner-7"]');
  click(row.querySelector(".question-bank-replace"));
  manager = document.getElementById("questionBankManager");
  input(manager.querySelector("#questionBankSourceText"), "Replacement source");
  click(manager.querySelector(".question-bank-recognize"));
  await settle();
  const recognition = messages.filter((message) => message.action === "previewQuestionBankImport").at(-1);
  assert.equal(recognition.request.replaceBankId, "learner-7");
});

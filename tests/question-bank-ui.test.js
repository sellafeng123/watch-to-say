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
  profileLabel: ({ profile }) => ({ ielts: "IELTS", work: "Work", daily: "Daily conversation", travel: "Travel", general: "General speaking" })[profile],
  partLabel: ({ part }) => ({ part1: "Part 1", part2: "Part 2", part3: "Part 3" })[part],
  defaultBankName: "Speaking question bank",
  sourceText: "Questions to recognize",
  recognize: "Recognize question bank",
  profilesRequired: "Choose at least one profile.",
  previewTitle: "Recognition preview",
  questionCount: ({ count }) => `${count} questions`,
  profileCount: ({ count }) => `${count} profiles`,
  partCount: ({ part, count }) => `${part}: ${count}`,
  sampleQuestions: "Sample questions",
  unrecognized: ({ count }) => `${count} unrecognized fragments`,
  unrecognizedItems: "Unrecognized fragments to review",
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

function addOptionsPage(document, { languageButtons = false } = {}) {
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
  if (languageButtons) {
    for (const language of ["en", "zh-CN"]) {
      const button = document.createElement("button");
      button.setAttribute("data-language", language);
      document.body.append(button);
    }
  }
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
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

test("gives an unnamed draft a deterministic safe bank name before recognition", () => {
  const { root } = createFakeDom();
  const received = [];
  ui.mountManager({
    root,
    copy,
    state: managerState({ draft: { name: "", profiles: ["daily"], sourceText: "What do you enjoy doing after work?" } }),
    callbacks: { onRecognize: (draft) => received.push(draft) },
  });
  click(root.querySelector(".question-bank-recognize"));
  assert.equal(received[0].name, "Speaking question bank");
});

test("shows only an explicit recognition preview before save and renders its summary", () => {
  const { root } = createFakeDom();
  ui.mountManager({ root, copy, state: managerState(), callbacks: {} });
  assert.equal(root.querySelector(".question-bank-save"), null);

  ui.mountManager({ root, copy, state: managerState({ preview }), callbacks: {} });
  assert.match(root.querySelector(".question-bank-preview").textContent, /4 questions/);
  assert.match(root.querySelector(".question-bank-preview").textContent, /2 profiles/);
  assert.match(root.querySelector(".question-bank-preview").textContent, /Part 1: 2/);
  assert.match(root.querySelector(".question-bank-preview").textContent, /Part 2: 1/);
  assert.match(root.querySelector(".question-bank-preview").textContent, /Part 3: 1/);
  assert.match(root.querySelector(".question-bank-preview").textContent, /1 unrecognized fragments/);
  assert.deepEqual(
    root.querySelectorAll(".question-bank-sample").map((node) => node.textContent),
    preview.sampleQuestions.map((item) => item.question),
  );
  assert.ok(root.querySelector(".question-bank-save"));
});

test("shows bounded unrecognized fragments as text for review", () => {
  const { root } = createFakeDom();
  ui.mountManager({
    root,
    copy,
    state: managerState({ preview: { ...preview, unrecognized: ["<not a question>", "Topic heading"] } }),
    callbacks: {},
  });
  assert.equal(root.querySelector(".question-bank-unrecognized-list").textContent, "<not a question>Topic heading");
});

test("localizes profile and IELTS Part metadata instead of leaking record identifiers", () => {
  const chinese = createFakeDom();
  const chineseCopy = {
    ...copy,
    profileLabel: ({ profile }) => ({ ielts: "雅思", work: "职场", daily: "日常聊天", travel: "旅行", general: "通用口语" })[profile],
    partLabel: ({ part }) => ({ part1: "第一部分", part2: "第二部分", part3: "第三部分" })[part],
  };
  ui.mountManager({ root: chinese.root, copy: chineseCopy, state: managerState({ preview }), callbacks: {} });
  assert.match(chinese.root.textContent, /第一部分: 2/);
  assert.match(chinese.root.textContent, /日常聊天/);
  assert.doesNotMatch(chinese.root.textContent, /part1|daily/);

  const english = createFakeDom();
  ui.mountManager({ root: english.root, copy, state: managerState({ preview }), callbacks: {} });
  assert.match(english.root.textContent, /Part 1: 2/);
  assert.match(english.root.textContent, /Daily conversation/);
  assert.doesNotMatch(english.root.textContent, /part1|daily/);
});

test("options renders its real English and Chinese metadata copy", async () => {
  async function render(language) {
    const { document } = createFakeDom();
    addOptionsPage(document, { languageButtons: true });
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
        storage: { local: {
          get: async (key) => key === "ytd_options_language" ? { ytd_options_language: language } : {},
          set: async () => {}, remove: async () => {}, clear: async () => {},
        } },
        runtime: { sendMessage: async (message) => {
          if (message.action === "listQuestionBanks") {
            return { success: true, banks: [{ id: "learner-7", name: "Existing bank", profiles: ["daily"], questionCount: 8 }] };
          }
          if (message.action === "previewQuestionBankImport") return { success: true, ...preview };
          return { success: true };
        } },
      },
    };
    options.initialize(root);
    await settle();
    const manager = document.getElementById("questionBankManager");
    input(manager.querySelector("#questionBankSourceText"), "How do you prepare for an important meeting?");
    const daily = manager.querySelector('[data-profile="daily"]');
    daily.checked = true;
    click(manager.querySelector(".question-bank-recognize"));
    await settle();
    return document.getElementById("questionBankManager").textContent;
  }

  const english = await render("en");
  assert.match(english, /Part 1: 2/);
  assert.match(english, /Daily conversation/);
  assert.doesNotMatch(english, /part1|daily/);

  const chinese = await render("zh-CN");
  assert.match(chinese, /第一部分: 2/);
  assert.match(chinese, /日常聊天/);
  assert.doesNotMatch(chinese, /part1|daily/);
});

test("exposes recognition loading through the accessible status region", () => {
  const { root } = createFakeDom();
  ui.mountManager({ root, copy, state: managerState({ loading: true, status: "Recognizing question bank…" }), callbacks: {} });
  assert.equal(root.querySelector(".question-bank-manager").getAttribute("aria-busy"), "true");
  assert.equal(root.querySelector(".question-bank-status").getAttribute("role"), "status");
  assert.equal(root.querySelector(".question-bank-recognize").disabled, true);
});

test("makes draft and learner-bank actions inert while a request is pending", () => {
  const { root } = createFakeDom();
  const calls = [];
  ui.mountManager({
    root,
    copy,
    state: managerState({ loading: true, preview }),
    callbacks: {
      onRecognize: () => calls.push("recognize"),
      onSave: () => calls.push("save"),
      onRename: () => calls.push("rename"),
      onReplace: () => calls.push("replace"),
      onDelete: () => calls.push("delete"),
    },
  });
  const manager = root.querySelector(".question-bank-manager");
  for (const element of manager.querySelectorAll("input").concat(manager.querySelectorAll("textarea"), manager.querySelectorAll("button"))) {
    assert.equal(element.disabled, true, element.className || element.tagName);
    click(element);
  }
  assert.deepEqual(calls, []);
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

test("options ignores duplicate recognition clicks and restores controls after a rejected message", async () => {
  const { document } = createFakeDom();
  addOptionsPage(document);
  let rejectRecognition;
  let recognitionCalls = 0;
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
        sendMessage: (message) => {
          if (message.action === "listQuestionBanks") return Promise.resolve({ success: true, banks: [] });
          if (message.action === "previewQuestionBankImport") {
            recognitionCalls += 1;
            return new Promise((_, reject) => { rejectRecognition = reject; });
          }
          return Promise.resolve({ success: true });
        },
      },
    },
  };
  options.initialize(root);
  await settle();
  let manager = document.getElementById("questionBankManager");
  input(manager.querySelector("#questionBankSourceText"), "A question for the race test?");
  const daily = manager.querySelector('[data-profile="daily"]');
  daily.checked = true;
  const recognize = manager.querySelector(".question-bank-recognize");
  click(recognize);
  click(recognize);
  await settle();
  assert.equal(recognitionCalls, 1);
  manager = document.getElementById("questionBankManager");
  assert.equal(manager.querySelector("#questionBankSourceText").disabled, true);
  rejectRecognition(new Error("offline"));
  await settle();
  manager = document.getElementById("questionBankManager");
  assert.equal(manager.querySelector("#questionBankSourceText").disabled, false);
  assert.match(manager.querySelector(".question-bank-status").textContent, /still here to edit/);
});

test("options restores nonbusy controls after save and saved-bank message rejections", async () => {
  const { document } = createFakeDom();
  addOptionsPage(document);
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
      runtime: { sendMessage: async (message) => {
        if (message.action === "listQuestionBanks") {
          return { success: true, banks: [{ id: "learner-7", name: "Existing bank", profiles: ["daily"], questionCount: 8 }] };
        }
        if (message.action === "previewQuestionBankImport") return { success: true, ...preview };
        if (["saveQuestionBank", "renameQuestionBank", "deleteQuestionBank"].includes(message.action)) {
          throw new Error("offline");
        }
        return { success: true };
      } },
    },
  };
  options.initialize(root);
  await settle();
  let manager = document.getElementById("questionBankManager");
  input(manager.querySelector("#questionBankSourceText"), "How do you prepare for an important meeting?");
  const daily = manager.querySelector('[data-profile="daily"]');
  daily.checked = true;
  click(manager.querySelector(".question-bank-recognize"));
  await settle();
  manager = document.getElementById("questionBankManager");
  click(manager.querySelector(".question-bank-save"));
  await settle();
  manager = document.getElementById("questionBankManager");
  assert.equal(manager.querySelector(".question-bank-save").disabled, false);
  assert.match(manager.querySelector(".question-bank-status").textContent, /Could not save/);

  let row = manager.querySelector('[data-bank-id="learner-7"]');
  click(row.querySelector(".question-bank-rename"));
  await settle();
  manager = document.getElementById("questionBankManager");
  row = manager.querySelector('[data-bank-id="learner-7"]');
  assert.equal(row.querySelector(".question-bank-rename").disabled, false);
  assert.match(manager.querySelector(".question-bank-status").textContent, /Could not rename/);

  click(row.querySelector(".question-bank-delete"));
  await settle();
  manager = document.getElementById("questionBankManager");
  row = manager.querySelector('[data-bank-id="learner-7"]');
  assert.equal(row.querySelector(".question-bank-delete").disabled, false);
  assert.match(manager.querySelector(".question-bank-status").textContent, /Could not delete/);
});

test("options reports a rejected saved-bank refresh without staying busy", async () => {
  const { document } = createFakeDom();
  addOptionsPage(document);
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
      runtime: { sendMessage: async () => { throw new Error("offline"); } },
    },
  };
  options.initialize(root);
  await settle();
  const manager = document.getElementById("questionBankManager");
  assert.equal(manager.querySelector(".question-bank-recognize").disabled, false);
  assert.match(manager.querySelector(".question-bank-status").textContent, /Could not refresh/);
});

test("options surfaces a failed post-save refresh after saving succeeds", async () => {
  const { document } = createFakeDom();
  addOptionsPage(document);
  let listCalls = 0;
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
      runtime: { sendMessage: async (message) => {
        if (message.action === "listQuestionBanks") {
          listCalls += 1;
          if (listCalls > 1) throw new Error("offline");
          return { success: true, banks: [] };
        }
        if (message.action === "previewQuestionBankImport") return { success: true, ...preview };
        if (message.action === "saveQuestionBank") return { success: true };
        return { success: true };
      } },
    },
  };
  options.initialize(root);
  await settle();
  let manager = document.getElementById("questionBankManager");
  input(manager.querySelector("#questionBankSourceText"), "How do you prepare for an important meeting?");
  const daily = manager.querySelector('[data-profile="daily"]');
  daily.checked = true;
  click(manager.querySelector(".question-bank-recognize"));
  await settle();
  manager = document.getElementById("questionBankManager");
  click(manager.querySelector(".question-bank-save"));
  await settle();
  manager = document.getElementById("questionBankManager");
  assert.equal(manager.querySelector(".question-bank-recognize").disabled, false);
  assert.match(manager.querySelector(".question-bank-status").textContent, /Could not refresh/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");
const corpus = require("../corpus.js");
const practice = require("../practice-session.js");
const questionBank = require("../question-bank.js");

function loadPracticeHelpers(initialStorage = {}, options = {}) {
  const storage = { ...initialStorage };
  const writes = [];
  let messageListener = null;
  const listeners = { addListener() {} };
  const runtimeMessages = {
    addListener(listener) { messageListener = listener; },
  };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    AbortController,
    crypto: webcrypto,
    fetch: options.fetch || (async () => { throw new Error("not used"); }),
    setTimeout() { return 0; },
    clearTimeout() {},
    importScripts() {},
    YTD_CORPUS: corpus,
    YTD_PRACTICE: practice,
    YTD_QUESTION_BANK: questionBank,
    YTD_SETTINGS: {
      STORAGE_KEY: "ytd_settings",
      normalize: (settings) => ({ aiApiKey: "key", supadataApiKey: "key", ...settings }),
      canonicalYouTubeUrl: (videoId) => `https://www.youtube.com/watch?v=${videoId}`,
      chatCompletionsUrl: () => "https://api.deepseek.com/chat/completions",
    },
    chrome: {
      storage: { local: {
        setAccessLevel: () => Promise.resolve(),
        get: async (keys) => Array.isArray(keys)
          ? Object.fromEntries(keys.map((key) => [key, storage[key]]))
          : { [keys]: storage[keys] },
        set: async (values) => {
          writes.push(structuredClone(values));
          Object.assign(storage, values);
        },
        remove: async (keys) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key];
        },
      } },
      action: { onClicked: listeners },
      sidePanel: { setPanelBehavior() {}, setOptions: async () => {} },
      runtime: {
        onInstalled: listeners,
        onMessage: runtimeMessages,
        getURL: (file) => `chrome-extension://test/${file}`,
        sendMessage: () => Promise.resolve(),
      },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(backgroundSource, sandbox);
  return {
    helpers: sandbox.__YTD_TRANSLATION_TESTING__,
    storage,
    writes,
    dispatch(message) {
      return new Promise((resolve, reject) => {
        if (!messageListener) return reject(new Error("message listener missing"));
        const keepOpen = messageListener(message, {}, resolve);
        if (keepOpen !== true) reject(new Error(`message channel closed for ${message.action}`));
      });
    },
  };
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
  };
}

function completion(content) {
  return jsonResponse({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "deepseek-chat",
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function learnerBankRecord(index, overrides = {}) {
  return questionBank.normalizeBank({
    id: `learner-bank-${index}`,
    name: `Learner bank ${index}`,
    source: "learner_bank",
    profiles: ["daily"],
    questions: [{
      part: null,
      topic: "Meetings",
      question: `How do you prepare for meeting ${index}?`,
      cuePoints: [],
    }],
    ...overrides,
  });
}

function validPreview(bank, overrides = {}) {
  return {
    bank,
    replaceBankId: null,
    unrecognized: [],
    expiresAt: Date.now() + 30 * 60 * 1000,
    ...overrides,
  };
}

function approvedBundledBank(overrides = {}) {
  const part2 = {
    id: "question-part2",
    bankId: "ielts-private",
    source: "bundled_ielts",
    profiles: ["ielts"],
    part: "part2",
    topic: "A useful object",
    question: "Describe a useful object you own.",
    cuePoints: ["What it is"],
    parentCueCardId: null,
    season: "2026-09_12",
    createdAt: 0,
  };
  part2.id = questionBank.makeQuestionId(part2);
  const records = [
    { part: "part1", topic: "Home", question: "Do you like your home?", parentCueCardId: null },
    part2,
    { part: "part3", topic: "Useful objects", question: "Why do people keep useful objects?", parentCueCardId: part2.id },
  ].map((record) => {
    if (record.id) return record;
    const complete = {
      bankId: "ielts-private",
      source: "bundled_ielts",
      profiles: ["ielts"],
      cuePoints: [],
      season: "2026-09_12",
      createdAt: 0,
      ...record,
    };
    return { id: questionBank.makeQuestionId(complete), ...complete };
  });
  return {
    id: "ielts-private",
    name: "IELTS private bank",
    source: "bundled_ielts",
    profiles: ["ielts"],
    questions: records,
    approval: {
      status: "approved",
      schemaVersion: 1,
      sourcePdfSha256: "a".repeat(64),
      ocrSha256: "b".repeat(64),
      pageCount: 46,
      reviewedPageCount: 46,
      correctionsApplied: 0,
      reviewedAt: "2026-09-15T12:00:00.000Z",
    },
    ...overrides,
  };
}

function entry(overrides = {}) {
  return {
    videoId: "abc123",
    videoTitle: "Study video",
    expression: "get into the zone",
    kind: "phrase",
    partOfSpeech: "verb phrase",
    usageContexts: "学习 · 工作",
    spokenFrequency: "common",
    timestamp: "0:18",
    timestampSeconds: 18,
    timestampedUrl: "https://www.youtube.com/watch?v=abc123&t=18s",
    context: "I get into the zone after coffee.",
    ...overrides,
  };
}

test("saves a prepared corpus entry as a same-video practice highlight without an Obsidian handoff", async () => {
  const { helpers, storage } = loadPracticeHelpers();

  const result = await helpers.savePracticeHighlight(entry());

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: true, count: 1 });
  assert.equal(storage.ytd_practice_highlights_v1.abc123.length, 1);
  assert.equal(storage.ytd_practice_highlights_v1.abc123[0].anchors[0].timestampSeconds, 18);
  assert.equal(storage.ytd_corpus_exports, undefined);
});

test("merges same normalized expression and POS but preserves separate anchors", async () => {
  const { helpers, storage } = loadPracticeHelpers();
  await helpers.savePracticeHighlight(entry({ expression: "Get  into the zone", timestampSeconds: 18 }));
  await helpers.savePracticeHighlight(entry({ expression: "get into the zone", timestampSeconds: 74, timestamp: "1:14" }));

  const result = await helpers.getPracticeHighlights("abc123");
  assert.equal(result.highlights.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.highlights[0].anchors.map((anchor) => anchor.timestampSeconds))), [18, 74]);
  assert.equal(storage.ytd_practice_highlights_v1.abc123.length, 1);
});

test("preserves an expression with a different POS as its own practice highlight", async () => {
  const { helpers } = loadPracticeHelpers();
  await helpers.savePracticeHighlight(entry({ expression: "manifestation", kind: "word", partOfSpeech: "noun" }));
  await helpers.savePracticeHighlight(entry({ expression: "manifestation", kind: "word", partOfSpeech: "adjective", timestampSeconds: 51 }));

  const result = await helpers.getPracticeHighlights("abc123");
  assert.equal(result.highlights.length, 2);
});

test("rejects malformed highlights instead of storing a broad unvalidated record", async () => {
  const { helpers, storage } = loadPracticeHelpers();
  const result = await helpers.savePracticeHighlight({ videoId: "abc123", expression: "missing anchor" });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { success: false, error: "INVALID_PRACTICE_HIGHLIGHT" });
  assert.equal(storage.ytd_practice_highlights_v1, undefined);
});

test("keeps AI practice materials bounded to the learner-selected highlight IDs", () => {
  const { helpers } = loadPracticeHelpers();
  const materials = helpers.validatePracticeMaterials(`{
    "label":"AI 练习材料",
    "items":[
      {"id":"practice-a","internalization":{"promptZh":"先替换一个真实场景。","reference":"I get into the zone when I study."},"speaking":{"question":"How do you focus?","reference":"I get into the zone after coffee."}},
      {"id":"not-selected","internalization":{"promptZh":"ignore","reference":"ignore"},"speaking":{"question":"ignore","reference":"ignore"}}
    ],
    "synthesis":{"itemIds":["practice-a","not-selected"],"question":"Tell a story.","reference":"I get into the zone."}
  }`, ["practice-a"]);

  assert.deepEqual(JSON.parse(JSON.stringify(materials)), {
    label: "AI 练习材料",
    items: [{
      id: "practice-a",
      internalization: { promptZh: "先替换一个真实场景。", reference: "I get into the zone when I study." },
      speaking: { question: "How do you focus?", reference: "I get into the zone after coffee." },
    }],
    synthesis: null,
  });
});

test("rejects duplicate AI items that leave a selected expression without practice material", () => {
  const { helpers } = loadPracticeHelpers();
  const repeated = {
    id: "practice-a",
    internalization: { promptZh: "替换场景。", reference: "I get into the zone." },
    speaking: { question: "How do you focus?", reference: "I get into the zone." },
  };
  assert.equal(helpers.validatePracticeMaterials({
    label: "AI 练习材料",
    items: [repeated, repeated],
    synthesis: null,
  }, ["practice-a", "practice-b"]), null);
});

test("practice material generation refuses to run without a configured DeepSeek key", async () => {
  const { helpers } = loadPracticeHelpers({ ytd_settings: { aiApiKey: "" } });
  const result = await helpers.handlePracticeMaterials({
    profile: "ielts",
    highlights: [{ ...entry(), id: "practice-a", anchors: [{ ...entry() }] }],
  });
  assert.equal(result.success, false);
  assert.equal(result.error, "NO_AI_KEY");
});

test("rejects an 80,001-character bank paste before loading prompts or calling DeepSeek", async () => {
  let fetches = 0;
  const { helpers } = loadPracticeHelpers({}, {
    fetch: async () => {
      fetches += 1;
      throw new Error("oversized paste must not fetch");
    },
  });

  const result = await helpers.previewQuestionBankImport({
    name: "Too large",
    profiles: ["daily"],
    sourceText: "x".repeat(80_001),
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    success: false,
    error: "PASTE_TOO_LARGE",
  });
  assert.equal(fetches, 0);
});

test("recognizes paragraph chunks no larger than 12,000 characters with at most three AI calls in flight", async () => {
  const prompt = fs.readFileSync(path.join(root, "prompts/question-bank-import.md"), "utf8");
  const paragraphs = Array.from({ length: 5 }, (_, index) => (
    `Question chunk ${index + 1}? ${"x".repeat(7_900)}`
  ));
  let active = 0;
  let maximumActive = 0;
  const aiSources = [];
  const { helpers } = loadPracticeHelpers({}, {
    fetch: async (url, request = {}) => {
      if (url.startsWith("chrome-extension://")) return { ok: true, text: async () => prompt };
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const body = JSON.parse(request.body);
      const userPrompt = body.messages.at(-1).content;
      const source = userPrompt.split("SOURCE_TEXT_START\n")[1].split("\nSOURCE_TEXT_END")[0];
      aiSources.push(source);
      const match = source.match(/Question chunk \d+\?/);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return completion(JSON.stringify({
        label: "AI 题库识别",
        questions: [{ part: null, topic: "Chunks", question: match[0], cuePoints: [] }],
        unrecognized: [],
      }));
    },
  });

  const result = await helpers.previewQuestionBankImport({
    name: "Chunked bank",
    profiles: ["daily"],
    sourceText: paragraphs.join("\n\n"),
  });

  assert.equal(result.success, true);
  assert.equal(result.summary.questionCount, 5);
  assert.equal(aiSources.length, 5);
  assert.ok(aiSources.every((source) => source.length <= 12_000));
  assert.equal(maximumActive, 3);
});

test("rejects a recognition preview when DeepSeek rewrites the source question", async () => {
  const prompt = fs.readFileSync(path.join(root, "prompts/question-bank-import.md"), "utf8");
  const { helpers, storage } = loadPracticeHelpers({}, {
    fetch: async (url) => url.startsWith("chrome-extension://")
      ? { ok: true, text: async () => prompt }
      : completion(JSON.stringify({
        label: "AI 题库识别",
        questions: [{ part: null, topic: "Meetings", question: "How do you plan an important meeting?", cuePoints: [] }],
        unrecognized: [],
      })),
  });

  const result = await helpers.previewQuestionBankImport({
    name: "Meetings",
    profiles: ["work"],
    sourceText: "How do you prepare for an important meeting?",
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "INVALID_AI_RESPONSE");
  assert.equal(storage.ytd_question_bank_previews_v1, undefined);
});

test("stores a structured preview separately without writing raw paste to the durable bank key", async () => {
  const prompt = fs.readFileSync(path.join(root, "prompts/question-bank-import.md"), "utf8");
  const rawPadding = "PRIVATE RAW PADDING THAT MUST NOT BE STORED";
  const { helpers, storage, writes } = loadPracticeHelpers({}, {
    fetch: async (url) => url.startsWith("chrome-extension://")
      ? { ok: true, text: async () => prompt }
      : completion(JSON.stringify({
        label: "AI 题库识别",
        questions: [{ part: null, topic: "Meetings", question: "How do you prepare for an important meeting?", cuePoints: [] }],
        unrecognized: [],
      })),
  });

  const result = await helpers.previewQuestionBankImport({
    name: "Meetings",
    profiles: ["work"],
    sourceText: `How do you prepare for an important meeting?\n\n${rawPadding}`,
  });

  assert.equal(result.success, true);
  assert.equal(typeof result.previewToken, "string");
  assert.equal(result.summary.questionCount, 1);
  assert.equal(result.sampleQuestions.length, 1);
  assert.equal(storage[questionBank.STORAGE_KEY], undefined);
  assert.equal(Object.hasOwn(storage.ytd_question_bank_previews_v1[result.previewToken], "sourceText"), false);
  assert.doesNotMatch(JSON.stringify(writes), new RegExp(rawPadding));
});

test("keeps both preview tokens when two recognitions finish together", async () => {
  const prompt = fs.readFileSync(path.join(root, "prompts/question-bank-import.md"), "utf8");
  const { helpers, storage } = loadPracticeHelpers({}, {
    fetch: async (url) => url.startsWith("chrome-extension://")
      ? { ok: true, text: async () => prompt }
      : completion(JSON.stringify({
        label: "AI 题库识别",
        questions: [{ part: null, topic: "Meetings", question: "How do you prepare for an important meeting?", cuePoints: [] }],
        unrecognized: [],
      })),
  });

  const [first, second] = await Promise.all([
    helpers.previewQuestionBankImport({
      name: "First",
      profiles: ["work"],
      sourceText: "How do you prepare for an important meeting?",
    }),
    helpers.previewQuestionBankImport({
      name: "Second",
      profiles: ["work"],
      sourceText: "How do you prepare for an important meeting?",
    }),
  ]);

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(Object.keys(storage.ytd_question_bank_previews_v1).length, 2);
  assert.ok(storage.ytd_question_bank_previews_v1[first.previewToken]);
  assert.ok(storage.ytd_question_bank_previews_v1[second.previewToken]);
});

test("requires a known unexpired preview token before saving a bank", async () => {
  const bank = learnerBankRecord("preview");
  const expiredToken = "expired-token";
  const { helpers, storage } = loadPracticeHelpers({
    ytd_question_bank_previews_v1: {
      [expiredToken]: validPreview(bank, { expiresAt: Date.now() - 1 }),
    },
  });

  const missing = await helpers.saveQuestionBank({ previewToken: "missing-token" });
  const expired = await helpers.saveQuestionBank({ previewToken: expiredToken });

  assert.equal(missing.success, false);
  assert.equal(missing.error, "INVALID_PREVIEW_TOKEN");
  assert.equal(expired.success, false);
  assert.equal(expired.error, "PREVIEW_EXPIRED");
  assert.equal(storage[questionBank.STORAGE_KEY], undefined);
});

test("refuses a thirteenth learner bank without deleting any existing bank", async () => {
  const banks = Array.from({ length: 12 }, (_, index) => learnerBankRecord(index));
  const token = "thirteenth-token";
  const { helpers, storage } = loadPracticeHelpers({
    [questionBank.STORAGE_KEY]: banks,
    ytd_question_bank_previews_v1: { [token]: validPreview(learnerBankRecord(13)) },
  });

  const result = await helpers.saveQuestionBank({ previewToken: token });

  assert.equal(result.success, false);
  assert.equal(result.error, "QUESTION_BANK_LIMIT");
  assert.deepEqual(storage[questionBank.STORAGE_KEY].map((bank) => bank.id), banks.map((bank) => bank.id));
});

test("atomically replaces only the selected learner bank and preserves its bank ID", async () => {
  const original = learnerBankRecord("keep-id", { id: "learner-keep-id", name: "Old bank" });
  const untouched = learnerBankRecord("untouched");
  const replacement = learnerBankRecord("draft", { id: "learner-keep-id", name: "New bank" });
  const token = "replace-token";
  const { helpers, storage } = loadPracticeHelpers({
    [questionBank.STORAGE_KEY]: [original, untouched],
    ytd_question_bank_previews_v1: {
      [token]: validPreview(replacement, { replaceBankId: original.id }),
    },
  });

  const result = await helpers.saveQuestionBank({ previewToken: token });

  assert.equal(result.success, true);
  assert.equal(result.bank.id, original.id);
  assert.equal(result.bank.questions[0].bankId, original.id);
  assert.deepEqual(storage[questionBank.STORAGE_KEY].map((bank) => bank.id), [original.id, untouched.id]);
  assert.deepEqual(storage[questionBank.STORAGE_KEY][1], untouched);
  assert.equal(storage.ytd_question_bank_previews_v1[token], undefined);
});

test("renames only the bounded display name without rewriting question IDs", async () => {
  const original = learnerBankRecord("rename");
  const originalQuestionIds = original.questions.map((question) => question.id);
  const { helpers, storage } = loadPracticeHelpers({ [questionBank.STORAGE_KEY]: [original] });

  const result = await helpers.renameQuestionBank({
    bankId: original.id,
    name: `  ${"N".repeat(500)}  `,
  });

  assert.equal(result.success, true);
  assert.equal(result.bank.name.length, 120);
  assert.deepEqual(result.bank.questions.map((question) => question.id), originalQuestionIds);
  assert.deepEqual(storage[questionBank.STORAGE_KEY][0].questions, original.questions);
});

test("deletes only the requested learner bank", async () => {
  const first = learnerBankRecord("first");
  const second = learnerBankRecord("second");
  const { helpers, storage } = loadPracticeHelpers({ [questionBank.STORAGE_KEY]: [first, second] });

  const missing = await helpers.deleteQuestionBank({ bankId: "bundled-ielts" });
  assert.equal(missing.success, false);
  assert.deepEqual(storage[questionBank.STORAGE_KEY].map((bank) => bank.id), [first.id, second.id]);

  const deleted = await helpers.deleteQuestionBank({ bankId: first.id });
  assert.deepEqual(JSON.parse(JSON.stringify(deleted)), { success: true });
  assert.deepEqual(storage[questionBank.STORAGE_KEY].map((bank) => bank.id), [second.id]);
});

test("lists compact learner metadata and approved bundled IELTS metadata separately", async () => {
  const bundled = approvedBundledBank();
  const learner = learnerBankRecord("listed");
  const requested = [];
  const { helpers, dispatch } = loadPracticeHelpers({ [questionBank.STORAGE_KEY]: [learner] }, {
    fetch: async (url) => {
      requested.push(url);
      return jsonResponse(bundled);
    },
  });

  const listed = await helpers.listQuestionBanks();
  const sources = await dispatch({ action: "getPracticeQuestionSources" });

  assert.equal(listed.success, true);
  assert.equal(listed.bundledAvailable, true);
  assert.equal(listed.bundled.id, bundled.id);
  assert.equal(listed.bundled.questionCount, 3);
  assert.equal(Object.hasOwn(listed.bundled, "questions"), false);
  assert.equal(listed.banks.length, 1);
  assert.equal(listed.banks[0].questionCount, 1);
  assert.equal(Object.hasOwn(listed.banks[0], "questions"), false);
  assert.deepEqual(JSON.parse(JSON.stringify(sources)), JSON.parse(JSON.stringify(listed)));
  assert.deepEqual([...new Set(requested)], ["chrome-extension://test/data/ielts-question-bank.local.json"]);
});

test("fails closed for missing, malformed, draft, or incomplete bundled IELTS data and never loads the sample", async () => {
  const variants = [
    jsonResponse({}, { ok: false, status: 404 }),
    jsonResponse({ questions: "not-an-array" }),
    jsonResponse(approvedBundledBank({ approval: { status: "draft" } })),
    jsonResponse(approvedBundledBank({
      approval: { ...approvedBundledBank().approval, pageCount: 45, reviewedPageCount: 45 },
    })),
    jsonResponse(approvedBundledBank({
      approval: { ...approvedBundledBank().approval, correctionsApplied: -1 },
    })),
    jsonResponse(approvedBundledBank({ questions: approvedBundledBank().questions.filter((item) => item.part !== "part3") })),
    jsonResponse((() => {
      const malformed = approvedBundledBank();
      malformed.questions[1].cuePoints = ["x".repeat(questionBank.LIMITS.maxCuePointChars + 1)];
      return malformed;
    })()),
  ];

  for (const response of variants) {
    const requested = [];
    const { helpers } = loadPracticeHelpers({}, {
      fetch: async (url) => {
        requested.push(url);
        return response;
      },
    });
    const result = await helpers.listQuestionBanks();
    assert.equal(result.success, true);
    assert.equal(result.bundledAvailable, false);
    assert.equal(result.bundled, null);
    assert.ok(requested.every((url) => !url.includes("sample")));
  }
});

test("accepts the optional installed IELTS bank only with its machine-checkable approval", {
  skip: !fs.existsSync(path.join(root, "data/ielts-question-bank.local.json")),
}, async () => {
  const localBank = JSON.parse(fs.readFileSync(
    path.join(root, "data/ielts-question-bank.local.json"),
    "utf8",
  ));
  const { helpers } = loadPracticeHelpers({}, {
    fetch: async () => jsonResponse(localBank),
  });

  const result = await helpers.listQuestionBanks();

  assert.equal(result.bundledAvailable, true);
  assert.equal(result.bundled.id, localBank.id);
  assert.equal(result.bundled.questionCount, localBank.questions.length);
});

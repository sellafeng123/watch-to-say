const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash, webcrypto } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");
const corpus = require("../corpus.js");
const practice = require("../practice-session.js");
const questionBank = require("../question-bank.js");

function loadPracticeHelpers(initialStorage = {}, options = {}) {
  const storage = { ...initialStorage };
  const writes = [];
  const reads = [];
  const extensionId = "test-extension-id";
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
        get: async (keys) => {
          reads.push(structuredClone(keys));
          return Array.isArray(keys)
            ? Object.fromEntries(keys.map((key) => [key, storage[key]]))
            : { [keys]: storage[keys] };
        },
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
        id: extensionId,
        onInstalled: listeners,
        onMessage: runtimeMessages,
        getURL: (file) => `chrome-extension://${extensionId}/${file}`,
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
    reads,
    dispatch(message, sender = {
      id: extensionId,
      url: `chrome-extension://${extensionId}/options.html`,
    }) {
      return new Promise((resolve, reject) => {
        if (!messageListener) return reject(new Error("message listener missing"));
        let responded = false;
        const sendResponse = (result) => {
          responded = true;
          resolve(result);
        };
        const keepOpen = messageListener(message, sender, sendResponse);
        if (keepOpen !== true && !responded) {
          reject(new Error(`message channel closed for ${message.action}`));
        }
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
  const bank = {
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
  if (bank.approval?.status === "approved" && !Object.hasOwn(bank.approval, "bankSha256")) {
    bank.approval = {
      ...bank.approval,
      bankSha256: createHash("sha256")
        .update(JSON.stringify(questionBank.normalizeBank(bank)))
        .digest("hex"),
    };
  }
  return bank;
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

function speakingExpression(index = 1, overrides = {}) {
  return {
    id: `expression-${index}`,
    expression: `useful phrase ${index}`,
    kind: "phrase",
    partOfSpeech: "phrase",
    usageContexts: "work meetings",
    originalExamples: [`I use useful phrase ${index} in meetings.`],
    ...overrides,
  };
}

function speakingPromptFetch(aiPayload, { bundled = null, requests = [] } = {}) {
  const prompt = fs.existsSync(path.join(root, "prompts/speaking-round.md"))
    ? fs.readFileSync(path.join(root, "prompts/speaking-round.md"), "utf8")
    : "## System prompt\n\n```text\nplaceholder\n```\n\n## User prompt\n\n```text\n{requestJson}\n```";
  return async (url, options = {}) => {
    if (url.includes("speaking-round.md")) return { ok: true, text: async () => prompt };
    if (url.includes("ielts-question-bank.local.json")) {
      return bundled ? jsonResponse(bundled) : jsonResponse({}, { ok: false, status: 404 });
    }
    requests.push(JSON.parse(options.body));
    return completion(JSON.stringify(typeof aiPayload === "function" ? aiPayload(requests.at(-1)) : aiPayload));
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

test("stores the timestamp-resolved target caption with a practice anchor", async () => {
  const { helpers, storage } = loadPracticeHelpers();
  await helpers.savePracticeHighlight(entry({
    targetText: "At night, I get into the zone more easily.",
    context: "I get into the zone after coffee. At night, I get into the zone more easily.",
  }));

  assert.equal(storage.ytd_practice_highlights_v1.abc123[0].anchors[0].targetText, "At night, I get into the zone more easily.");
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

test("keeps target-grounded internalization references bounded to learner-selected highlights", () => {
  const { helpers } = loadPracticeHelpers();
  const materials = helpers.validatePracticeMaterials(`{
    "label":"AI 练习材料",
    "items":[
      {"id":"practice-a","internalization":{"promptZh":"用真实场景各说两句。","references":["I get into the zone after coffee.","Music helps me get into the zone.","Once I get into the zone, I stop checking my phone."]}},
      {"id":"not-selected","internalization":{"promptZh":"ignore","references":["ignore one","ignore two","ignore three"]}}
    ]
  }`, [{ id: "practice-a", expression: "get into the zone", anchors: [{ selectedText: "got into the zone" }] }]);

  assert.deepEqual(JSON.parse(JSON.stringify(materials)), {
    label: "AI 练习材料",
    items: [{
      id: "practice-a",
      internalization: {
        promptZh: "用真实场景各说两句。",
        references: [
          "I get into the zone after coffee.",
          "Music helps me get into the zone.",
          "Once I get into the zone, I stop checking my phone.",
        ],
      },
    }],
  });
});

test("rejects incomplete, duplicate, empty, overlong, unrelated, or near-duplicate internalization references", () => {
  const { helpers } = loadPracticeHelpers();
  const valid = {
    id: "practice-a",
    internalization: {
      promptZh: "替换场景。",
      references: ["I get into the zone after coffee.", "Music helps me get into the zone.", "Once I get into the zone, I stop checking my phone."],
    },
  };
  const invalidReferences = [
    ["I get into the zone."],
    ["I get into the zone.", "Music helps me get into the zone."],
    ["I get into the zone.", "Music helps me get into the zone.", "Once I get into the zone, I stop checking my phone.", "I get into the zone before work."],
    ["I get into the zone after coffee.", " I get into the zone after coffee. ", "Music helps me get into the zone."],
    ["I get into the zone after coffee.", "", "Music helps me get into the zone."],
    ["I get into the zone after coffee.", "Music helps me get into the zone.", `I get into the zone ${"x".repeat(301)}`],
    ["I drink tea before work.", "Music helps me get into the zone.", "Once I get into the zone, I stop checking my phone."],
    ["I get coffee before I walk into the zone.", "Music helps me get into the zone.", "Once I get into the zone, I stop checking my phone."],
    ["I get into the zone after coffee before work.", "I get into the zone after coffee before work every day.", "Once I get into the zone, I stop checking my phone."],
  ];
  invalidReferences.forEach((references) => {
    assert.equal(helpers.validatePracticeMaterials({
      label: "AI 练习材料",
      items: [{ ...valid, internalization: { ...valid.internalization, references } }],
    }, [{ id: "practice-a", expression: "get into the zone", anchors: [{ selectedText: "got into the zone" }] }]), null);
  });
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

test("sends every expression beyond eighty while bounding IELTS candidates and resolving stored data", async () => {
  const bank = questionBank.normalizeBank({
    id: "learner-ielts",
    name: "IELTS questions",
    source: "learner_bank",
    profiles: ["ielts"],
    questions: Array.from({ length: 45 }, (_, index) => ({
      part: "part1",
      topic: `Meetings ${index}`,
      question: `How do you prepare for meeting ${index}?`,
      cuePoints: [`Stored cue ${index}`],
    })),
  });
  const expressions = Array.from({ length: 81 }, (_, index) => speakingExpression(index + 1));
  let chosen;
  const requests = [];
  const { helpers } = loadPracticeHelpers({ [questionBank.STORAGE_KEY]: [bank] }, {
    fetch: speakingPromptFetch((request) => {
      const requestPayload = JSON.parse(request.messages[1].content);
      chosen = bank.questions.find((question) => question.id === requestPayload.candidates[0].id);
      return {
        label: "AI 口语练习",
        questionId: chosen.id,
        reference: "I prepare carefully. I review the agenda. Then I get into the zone.",
        usedExpressionIds: [expressions[0].id],
      };
    }, { requests }),
  });

  const result = await helpers.handleSpeakingRound({
    profile: "ielts",
    sourceMode: "bundled_plus_mine",
    expressions,
    usedQuestionIds: [],
  });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(JSON.parse(JSON.stringify(result.round)), {
    questionId: chosen.id,
    source: "learner_bank",
    part: "part1",
    question: chosen.question,
    cuePoints: chosen.cuePoints,
    reference: "I prepare carefully. I review the agenda. Then I get into the zone.",
    usedExpressionIds: [expressions[0].id],
  });
  const requestPayload = JSON.parse(requests[0].messages[1].content);
  assert.deepEqual(requestPayload.expressions.map((item) => item.id), expressions.map((item) => item.id));
  assert.equal(requestPayload.candidates.length, 40);
  assert.ok(requestPayload.candidates.every((candidate) => bank.questions.some((question) => question.id === candidate.id)));
});

test("rejects IELTS IDs outside the supplied candidate list", async () => {
  const bank = learnerBankRecord("ielts-invalid", {
    profiles: ["ielts"],
    questions: [{ part: "part1", topic: "Home", question: "Do you enjoy your home?", cuePoints: [] }],
  });
  const { helpers } = loadPracticeHelpers({ [questionBank.STORAGE_KEY]: [bank] }, {
    fetch: speakingPromptFetch({
      label: "AI 口语练习",
      questionId: "question-not-offered",
      reference: "Yes, I do. It feels peaceful. I can get into the zone there.",
      usedExpressionIds: ["expression-1"],
    }),
  });

  const result = await helpers.handleSpeakingRound({
    profile: "ielts",
    sourceMode: "bundled_plus_mine",
    expressions: [speakingExpression(1)],
    usedQuestionIds: [],
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "INVALID_AI_RESPONSE");
});

test("mine_only never generates and distinguishes an empty bank from exhausted questions", async () => {
  let apiCalls = 0;
  const noBank = loadPracticeHelpers({}, {
    fetch: async (url) => {
      if (url.includes("ielts-question-bank.local.json")) return jsonResponse({}, { ok: false, status: 404 });
      apiCalls += 1;
      throw new Error("mine_only must not call DeepSeek without a candidate");
    },
  });
  const empty = await noBank.helpers.handleSpeakingRound({
    profile: "daily",
    sourceMode: "mine_only",
    expressions: [speakingExpression(1)],
    usedQuestionIds: [],
  });
  assert.equal(empty.error, "QUESTION_BANK_EMPTY");

  const bank = learnerBankRecord("only");
  const exhaustedHarness = loadPracticeHelpers({ [questionBank.STORAGE_KEY]: [bank] }, {
    fetch: async (url) => {
      if (url.includes("ielts-question-bank.local.json")) return jsonResponse({}, { ok: false, status: 404 });
      apiCalls += 1;
      throw new Error("mine_only must not fall back to generation");
    },
  });
  const exhausted = await exhaustedHarness.helpers.handleSpeakingRound({
    profile: "daily",
    sourceMode: "mine_only",
    expressions: [speakingExpression(1)],
    usedQuestionIds: [bank.questions[0].id],
  });
  assert.equal(exhausted.error, "QUESTION_BANK_EXHAUSTED");
  assert.equal(apiCalls, 0);
});

test("smart_mix uses learner candidates before generation and falls back only after exhaustion", async () => {
  const bank = learnerBankRecord("smart");
  const expression = speakingExpression(1);
  const storedHarness = loadPracticeHelpers({ [questionBank.STORAGE_KEY]: [bank] }, {
    fetch: speakingPromptFetch({
      label: "AI 口语练习",
      generatedQuestion: "What helps you focus?",
      reference: "A quiet room helps me use useful phrase one naturally.",
      usedExpressionIds: [expression.id],
    }),
  });
  const invalidStoredResponse = await storedHarness.helpers.handleSpeakingRound({
    profile: "daily",
    sourceMode: "smart_mix",
    expressions: [expression],
    usedQuestionIds: [],
  });
  assert.equal(invalidStoredResponse.error, "INVALID_AI_RESPONSE");

  const generatedQuestion = "What helps you prepare for a difficult day?";
  const generatedHarness = loadPracticeHelpers({ [questionBank.STORAGE_KEY]: [bank] }, {
    fetch: speakingPromptFetch({
      label: "AI 口语练习",
      generatedQuestion,
      reference: "Planning early helps me stay calm and use useful phrase one naturally.",
      usedExpressionIds: [expression.id],
    }),
  });
  const generated = await generatedHarness.helpers.handleSpeakingRound({
    profile: "daily",
    sourceMode: "smart_mix",
    expressions: [expression],
    usedQuestionIds: [bank.questions[0].id],
  });
  assert.equal(generated.success, true);
  assert.equal(generated.round.source, "deepseek");
  assert.equal(generated.round.question, generatedQuestion);
});

test("generated question IDs are deterministic and rejected when already used", async () => {
  const generatedQuestion = "What helps you prepare for a difficult journey?";
  const expression = speakingExpression(1);
  const payload = {
    label: "AI 口语练习",
    generatedQuestion,
    reference: "I plan ahead so I can use useful phrase one without sounding forced.",
    usedExpressionIds: [expression.id],
  };
  const firstHarness = loadPracticeHelpers({}, { fetch: speakingPromptFetch(payload) });
  const first = await firstHarness.helpers.handleSpeakingRound({
    profile: "travel", sourceMode: "ai_only", expressions: [expression], usedQuestionIds: [],
  });
  const secondHarness = loadPracticeHelpers({}, { fetch: speakingPromptFetch(payload) });
  const second = await secondHarness.helpers.handleSpeakingRound({
    profile: "travel", sourceMode: "ai_only", expressions: [expression], usedQuestionIds: [],
  });
  assert.equal(first.round.questionId, second.round.questionId);

  const repeatHarness = loadPracticeHelpers({}, { fetch: speakingPromptFetch(payload) });
  const repeat = await repeatHarness.helpers.handleSpeakingRound({
    profile: "travel", sourceMode: "ai_only", expressions: [expression], usedQuestionIds: [first.round.questionId],
  });
  assert.equal(repeat.error, "INVALID_AI_RESPONSE");
});

test("validates IELTS answer bands, response fields, reference bounds, and used expression IDs", () => {
  const { helpers } = loadPracticeHelpers();
  const expressionIds = ["expression-1", "expression-2"];
  const candidate = { id: "known-id", part: "part1" };
  const valid = {
    label: "AI 口语练习",
    questionId: candidate.id,
    reference: "I like it. It feels calm. I can focus there.",
    usedExpressionIds: [expressionIds[0]],
  };
  const context = { profile: "ielts", candidates: [candidate], expressionIds, generation: false };

  assert.ok(helpers.validateSpeakingRoundResponse(valid, context));
  for (const invalid of [
    { ...valid, reference: "Too short." },
    { ...valid, reference: "One. Two. Three. Four. Five. Six." },
    { ...valid, reference: "x".repeat(4001) },
    { ...valid, usedExpressionIds: ["not-supplied"] },
    { ...valid, unexpected: true },
  ]) {
    assert.equal(helpers.validateSpeakingRoundResponse(invalid, context), null);
  }

  const words = (count) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ") + ".";
  assert.ok(helpers.validateSpeakingRoundResponse({ ...valid, reference: words(180) }, {
    ...context, candidates: [{ id: "known-id", part: "part2" }],
  }));
  assert.equal(helpers.validateSpeakingRoundResponse({ ...valid, reference: words(179) }, {
    ...context, candidates: [{ id: "known-id", part: "part2" }],
  }), null);
  assert.ok(helpers.validateSpeakingRoundResponse({ ...valid, reference: words(80) }, {
    ...context, candidates: [{ id: "known-id", part: "part3" }],
  }));
  assert.equal(helpers.validateSpeakingRoundResponse({ ...valid, reference: words(79) }, {
    ...context, candidates: [{ id: "known-id", part: "part3" }],
  }), null);
});

test("getSpeakingRound dispatches the bounded background result", async () => {
  const expression = speakingExpression(1);
  const { dispatch } = loadPracticeHelpers({}, {
    fetch: speakingPromptFetch({
      label: "AI 口语练习",
      generatedQuestion: "What makes a normal day enjoyable?",
      reference: "A relaxed start helps me use useful phrase one naturally.",
      usedExpressionIds: [expression.id],
    }),
  });

  const result = await dispatch({
    action: "getSpeakingRound",
    request: { profile: "daily", sourceMode: "ai_only", expressions: [expression], usedQuestionIds: [] },
  });

  assert.equal(result.success, true);
  assert.equal(result.round.source, "deepseek");
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

test("gives an unnamed learner import a deterministic backend-safe display name", async () => {
  const prompt = fs.readFileSync(path.join(root, "prompts/question-bank-import.md"), "utf8");
  const { helpers } = loadPracticeHelpers({}, {
    fetch: async (url) => url.startsWith("chrome-extension://")
      ? { ok: true, text: async () => prompt }
      : completion(JSON.stringify({
        label: "AI 题库识别",
        questions: [{ part: null, topic: "Daily", question: "What do you enjoy doing after work?", cuePoints: [] }],
        unrecognized: [],
      })),
  });
  const result = await helpers.previewQuestionBankImport({
    name: "",
    profiles: ["daily"],
    sourceText: "What do you enjoy doing after work?",
  });
  assert.equal(result.success, true);
  assert.equal(result.summary.name, "Learner question bank");
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

test("shares the three-call recognition limit across simultaneous imports", async () => {
  const prompt = fs.readFileSync(path.join(root, "prompts/question-bank-import.md"), "utf8");
  const sourceFor = (prefix) => Array.from({ length: 4 }, (_, index) => (
    `Question ${prefix}${index + 1}? ${prefix.repeat(7_900)}`
  )).join("\n\n");
  let active = 0;
  let maximumActive = 0;
  const { helpers } = loadPracticeHelpers({}, {
    fetch: async (url, request = {}) => {
      if (url.startsWith("chrome-extension://")) return { ok: true, text: async () => prompt };
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const userPrompt = JSON.parse(request.body).messages.at(-1).content;
      const question = userPrompt.match(/Question [AB]\d+\?/)[0];
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return completion(JSON.stringify({
        label: "AI 题库识别",
        questions: [{ part: null, topic: "Concurrency", question, cuePoints: [] }],
        unrecognized: [],
      }));
    },
  });

  const results = await Promise.all([
    helpers.previewQuestionBankImport({ name: "First", profiles: ["work"], sourceText: sourceFor("A") }),
    helpers.previewQuestionBankImport({ name: "Second", profiles: ["work"], sourceText: sourceFor("B") }),
  ]);

  assert.ok(results.every((result) => result.success));
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

test("rejects an entire recognition response when any raw question violates the import contract", async () => {
  const prompt = fs.readFileSync(path.join(root, "prompts/question-bank-import.md"), "utf8");
  const good = {
    part: null,
    topic: "Meetings",
    question: "How do you prepare for an important meeting?",
    cuePoints: [],
  };
  const longQuestion = `${"Q".repeat(questionBank.LIMITS.maxQuestionChars)}?`;
  const longCue = "C".repeat(questionBank.LIMITS.maxCuePointChars + 1);
  const cases = [
    { label: "unknown Part", questions: [good, { ...good, question: "Unknown part?", part: "part4" }], source: `${good.question}\nUnknown part?` },
    { label: "empty question", questions: [good, { ...good, question: "" }], source: good.question },
    { label: "source mismatch", questions: [good, { ...good, question: "Invented question?" }], source: good.question },
    { label: "duplicate question", questions: [good, good], source: good.question },
    { label: "duplicate wording under another topic", questions: [good, { ...good, topic: "Other" }], source: good.question },
    { label: "overlong question", questions: [{ ...good, question: longQuestion }], source: longQuestion },
    { label: "overlong topic", questions: [{ ...good, topic: "T".repeat(questionBank.LIMITS.maxQuestionChars + 1) }], source: good.question },
    {
      label: "too many cue points",
      questions: [{ ...good, cuePoints: Array.from({ length: questionBank.LIMITS.maxCuePoints + 1 }, (_, index) => `Cue ${index}`) }],
      source: `${good.question}\n${Array.from({ length: 13 }, (_, index) => `Cue ${index}`).join("\n")}`,
    },
    { label: "overlong cue point", questions: [{ ...good, cuePoints: [longCue] }], source: `${good.question}\n${longCue}` },
  ];

  for (const fixture of cases) {
    const { helpers, storage } = loadPracticeHelpers({}, {
      fetch: async (url) => url.startsWith("chrome-extension://")
        ? { ok: true, text: async () => prompt }
        : completion(JSON.stringify({
          label: "AI 题库识别",
          questions: fixture.questions,
          unrecognized: [],
        })),
    });
    const result = await helpers.previewQuestionBankImport({
      name: fixture.label,
      profiles: ["work"],
      sourceText: fixture.source,
    });
    assert.equal(result.success, false, fixture.label);
    assert.equal(result.error, "INVALID_AI_RESPONSE", fixture.label);
    assert.equal(storage.ytd_question_bank_previews_v1, undefined, fixture.label);
  }
});

test("strips unknown response properties after strict question validation", async () => {
  const prompt = fs.readFileSync(path.join(root, "prompts/question-bank-import.md"), "utf8");
  const question = "How do you prepare for an important meeting?";
  const { helpers, storage } = loadPracticeHelpers({}, {
    fetch: async (url) => url.startsWith("chrome-extension://")
      ? { ok: true, text: async () => prompt }
      : completion(JSON.stringify({
        label: "AI 题库识别",
        unexpected: "discard",
        questions: [{
          part: null,
          topic: "Meetings",
          question,
          cuePoints: [],
          unexpected: "discard",
        }],
        unrecognized: [],
      })),
  });

  const result = await helpers.previewQuestionBankImport({
    name: "Extra fields",
    profiles: ["work"],
    sourceText: question,
  });

  assert.equal(result.success, true);
  const storedQuestion = storage.ytd_question_bank_previews_v1[result.previewToken].bank.questions[0];
  assert.equal(Object.hasOwn(storedQuestion, "unexpected"), false);
});

test("validates each recognition response against only the chunk sent to that call", async () => {
  const prompt = fs.readFileSync(path.join(root, "prompts/question-bank-import.md"), "utf8");
  const firstQuestion = "What makes a meeting useful?";
  const secondQuestion = "How do you prepare for a presentation?";
  const sourceText = [
    `${firstQuestion} ${"a".repeat(7_900)}`,
    `${secondQuestion} ${"b".repeat(7_900)}`,
  ].join("\n\n");
  const { helpers } = loadPracticeHelpers({}, {
    fetch: async (url, request = {}) => {
      if (url.startsWith("chrome-extension://")) return { ok: true, text: async () => prompt };
      const userPrompt = JSON.parse(request.body).messages.at(-1).content;
      const borrowed = userPrompt.includes(firstQuestion) ? secondQuestion : firstQuestion;
      return completion(JSON.stringify({
        label: "AI 题库识别",
        questions: [{ part: null, topic: "Work", question: borrowed, cuePoints: [] }],
        unrecognized: [],
      }));
    },
  });

  const result = await helpers.previewQuestionBankImport({
    name: "Borrowed chunks",
    profiles: ["work"],
    sourceText,
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "INVALID_AI_RESPONSE");
});

test("rejects duplicate normalized question IDs returned by different chunks", async () => {
  const prompt = fs.readFileSync(path.join(root, "prompts/question-bank-import.md"), "utf8");
  const question = "How do you prepare for an important meeting?";
  const sourceText = [
    `${question} ${"a".repeat(7_900)}`,
    `${question} ${"b".repeat(7_900)}`,
  ].join("\n\n");
  const { helpers } = loadPracticeHelpers({}, {
    fetch: async (url) => url.startsWith("chrome-extension://")
      ? { ok: true, text: async () => prompt }
      : completion(JSON.stringify({
        label: "AI 题库识别",
        questions: [{ part: null, topic: "Meetings", question, cuePoints: [] }],
        unrecognized: [],
      })),
  });

  const result = await helpers.previewQuestionBankImport({
    name: "Duplicate chunks",
    profiles: ["work"],
    sourceText,
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "INVALID_AI_RESPONSE");
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

test("rename and delete preserve unrelated raw bank records byte-for-byte", async () => {
  const target = learnerBankRecord("target");
  const unrelated = {
    ...learnerBankRecord("unrelated"),
    legacyMetadata: { importedBy: "older-version", keep: true },
  };
  const renameHarness = loadPracticeHelpers({
    [questionBank.STORAGE_KEY]: [target, unrelated],
  });

  const renamed = await renameHarness.helpers.renameQuestionBank({
    bankId: target.id,
    name: "Renamed target",
  });

  assert.equal(renamed.success, true);
  assert.deepEqual(renameHarness.storage[questionBank.STORAGE_KEY][1], unrelated);

  const deleteHarness = loadPracticeHelpers({
    [questionBank.STORAGE_KEY]: [target, unrelated],
  });
  const deleted = await deleteHarness.helpers.deleteQuestionBank({ bankId: target.id });
  assert.equal(deleted.success, true);
  assert.deepEqual(deleteHarness.storage[questionBank.STORAGE_KEY], [unrelated]);
});

test("management fails safely when the stored collection exceeds its hard bound", async () => {
  const banks = Array.from({ length: 13 }, (_, index) => learnerBankRecord(index));
  const { helpers, storage, writes } = loadPracticeHelpers({
    [questionBank.STORAGE_KEY]: banks,
  });

  const result = await helpers.renameQuestionBank({
    bankId: banks[0].id,
    name: "Must not rewrite",
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "QUESTION_BANK_STORAGE_CORRUPT");
  assert.equal(writes.length, 0);
  assert.deepEqual(storage[questionBank.STORAGE_KEY], banks);
});

test("management rejects a malformed target instead of normalizing it during rename", async () => {
  const malformed = learnerBankRecord("malformed-target");
  malformed.questions[0].part = "part4";
  const { helpers, storage, writes } = loadPracticeHelpers({
    [questionBank.STORAGE_KEY]: [malformed],
  });

  const result = await helpers.renameQuestionBank({
    bankId: malformed.id,
    name: "Must not repair",
  });

  assert.equal(result.success, false);
  assert.equal(result.error, "QUESTION_BANK_STORAGE_CORRUPT");
  assert.equal(writes.length, 0);
  assert.deepEqual(storage[questionBank.STORAGE_KEY], [malformed]);
});

test("rejects all question-bank messages from content-script senders before side effects", async () => {
  const prompt = fs.readFileSync(path.join(root, "prompts/question-bank-import.md"), "utf8");
  const hostileSender = {
    id: "test-extension-id",
    url: "https://www.youtube.com/watch?v=abc123",
    tab: { id: 1 },
  };
  const messages = [
    {
      action: "previewQuestionBankImport",
      name: "Hostile",
      profiles: ["work"],
      sourceText: "How do you prepare for an important meeting?",
    },
    { action: "saveQuestionBank", previewToken: "token" },
    { action: "renameQuestionBank", bankId: "bank", name: "Hostile" },
    { action: "listQuestionBanks" },
    { action: "deleteQuestionBank", bankId: "bank" },
    { action: "getPracticeQuestionSources" },
  ];

  for (const message of messages) {
    let fetches = 0;
    const { dispatch, reads, writes } = loadPracticeHelpers({}, {
      fetch: async (url) => {
        fetches += 1;
        if (url.includes("question-bank-import.md")) return { ok: true, text: async () => prompt };
        if (url.includes("ielts-question-bank.local.json")) return jsonResponse({}, { ok: false, status: 404 });
        return completion(JSON.stringify({
          label: "AI 题库识别",
          questions: [],
          unrecognized: [],
        }));
      },
    });

    const result = await dispatch(message, hostileSender);

    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
      success: false,
      error: "UNTRUSTED_SENDER",
    }, message.action);
    assert.equal(fetches, 0, message.action);
    assert.equal(reads.length, 0, message.action);
    assert.equal(writes.length, 0, message.action);
  }
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
  assert.deepEqual([...new Set(requested)], ["chrome-extension://test-extension-id/data/ielts-question-bank.local.json"]);
});

test("fails closed for missing, malformed, draft, or incomplete bundled IELTS data and never loads the sample", async () => {
  const missingDigest = approvedBundledBank();
  delete missingDigest.approval.bankSha256;
  const mismatchedDigest = approvedBundledBank();
  mismatchedDigest.questions[0].question = "Do you enjoy your home?";
  mismatchedDigest.questions[0].id = questionBank.makeQuestionId(mismatchedDigest.questions[0]);
  const variants = [
    jsonResponse({}, { ok: false, status: 404 }),
    jsonResponse({ questions: "not-an-array" }),
    jsonResponse(approvedBundledBank({ approval: { status: "draft" } })),
    jsonResponse(missingDigest),
    jsonResponse(mismatchedDigest),
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

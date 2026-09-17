const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "background.js"), "utf8");
const corpus = require("../corpus.js");

function loadHelpers({ settings = {}, initialStorage = {}, fetchImpl } = {}) {
  const listeners = { addListener() {} };
  const localStorage = { ...initialStorage, ytd_settings: settings };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    AbortController,
    fetch: fetchImpl || (async () => {
      throw new Error("No network call expected in a contextual-gloss validator test");
    }),
    setTimeout() { return 0; },
    clearTimeout() {},
    importScripts() {},
    YTD_CORPUS: corpus,
    YTD_SETTINGS: {
      STORAGE_KEY: "ytd_settings",
      normalize: (value) => value || {},
      canonicalYouTubeUrl: (videoId) => `https://www.youtube.com/watch?v=${videoId}`,
      chatCompletionsUrl: (baseUrl) => `${baseUrl}/chat/completions`,
    },
    chrome: {
      storage: {
        local: {
          setAccessLevel: () => Promise.resolve(),
          get: async (key) => Array.isArray(key)
            ? Object.fromEntries(key.map((item) => [item, localStorage[item]]))
            : ({ [key]: localStorage[key] }),
          set: async (values) => Object.assign(localStorage, values),
        },
      },
      action: { onClicked: listeners },
      sidePanel: { setPanelBehavior() {}, setOptions: async () => {} },
      runtime: {
        onInstalled: listeners,
        onMessage: listeners,
        getURL: (resourcePath) => `chrome-extension://test/${resourcePath}`,
        sendMessage: () => Promise.resolve(),
      },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return { helpers: sandbox.__YTD_TRANSLATION_TESTING__, storage: localStorage };
}

function aiGloss(expression, meaningZh) {
  return {
    label: "AI 语境释义",
    expression,
    kind: "phrase",
    suggestedUsageContexts: "日常聊天",
    partOfSpeech: "phrase",
    contextMeaningEn: "the meaning in this sentence",
    contextMeaningZh: meaningZh,
    collocations: [],
    sentenceFrame: `I use ${expression} when ...`,
    spokenFrequency: "common",
    frequencyReasonZh: "口语常见",
    paraphrases: [],
    relatedExtensions: [],
  };
}

function contextualGlossFetch(responses, calls) {
  const prompt = fs.readFileSync(path.join(root, "prompts/contextual-gloss.md"), "utf8");
  return async (url) => {
    if (url.includes("contextual-gloss.md")) return { ok: true, text: async () => prompt };
    const response = responses[calls.length];
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(response) } }],
      }),
    };
  };
}

function cachedTranscript() {
  return {
    digest_abc123: {
      transcript: [
        { start: 4, text: "I get into the zone after coffee." },
        { start: 55, text: "Sometimes I need a break." },
        { start: 60, text: "At night, I get into the zone more easily." },
        { start: 68, text: "Then I finish my work." },
      ],
    },
  };
}

test("resolves repeated selected text from the transcript nearest to the video timestamp", () => {
  const { helpers } = loadHelpers();
  const context = helpers.resolveSelectionContext(
    {
      source: "sidepanel-transcript",
      selectedText: "get into the zone",
      videoId: "abc123",
      timestampSeconds: 61,
      videoTitle: "Study routine",
      channelName: "Daily English",
    },
    [
      { start: 4, text: "I get into the zone after coffee." },
      { start: 55, text: "Sometimes I need a break." },
      { start: 60, text: "At night, I get into the zone more easily." },
      { start: 68, text: "Then I finish my work." },
    ],
  );

  assert.deepEqual(JSON.parse(JSON.stringify(context)), {
    source: "sidepanel-transcript",
    selectedText: "get into the zone",
    videoId: "abc123",
    timestampSeconds: 61,
    timestampedUrl: "https://www.youtube.com/watch?v=abc123&t=61s",
    contextTimestampSeconds: 60,
    videoTitle: "Study routine",
    channelName: "Daily English",
    targetText: "At night, I get into the zone more easily.",
    beforeText: "I get into the zone after coffee. Sometimes I need a break.",
    afterText: "Then I finish my work.",
    context: "I get into the zone after coffee. Sometimes I need a break. At night, I get into the zone more easily. Then I finish my work.",
  });
});

test("accepts only a validated AI contextual gloss with the selected expression", () => {
  const { helpers } = loadHelpers();
  const valid = helpers.validateContextualGlossResponse(`{
    "label": "AI 语境释义",
    "expression": "get into the zone",
    "kind": "phrase",
    "suggestedUsageContexts": "学习 · 工作",
    "partOfSpeech": "verb phrase",
    "contextMeaningEn": "to become fully focused",
    "contextMeaningZh": "进入专注状态",
    "collocations": [],
    "sentenceFrame": "I get into the zone when ...",
    "spokenFrequency": "common",
    "frequencyReasonZh": "口语常见",
    "paraphrases": [],
    "relatedExtensions": []
  }`, "get into the zone");

  assert.equal(valid.expression, "get into the zone");
  assert.equal(valid.label, "AI 语境释义");
  assert.equal(valid.suggestedUsageContexts, "学习 · 工作");
  assert.equal(
    helpers.validateContextualGlossResponse(`{
      "label":"AI 语境释义",
      "expression":"a different phrase",
      "kind":"phrase",
      "contextMeaningEn":"x",
      "contextMeaningZh":"x"
    }`, "get into the zone"),
    null,
  );
});

test("refuses contextual gloss before fetching a transcript when no DeepSeek key is configured", async () => {
  const { helpers } = loadHelpers({ settings: { aiApiKey: "" } });
  const result = await helpers.handleContextualGloss({
    source: "player-caption",
    selectedText: "get into the zone",
    videoId: "abc123",
    timestampSeconds: 61,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    success: false,
    error: "NO_AI_KEY",
    message: "DeepSeek API key not configured. Open YouTube Digest Settings.",
  });
});

test("reuses a persisted contextual gloss for the same caption occurrence without another AI call", async () => {
  const calls = [];
  const firstHarness = loadHelpers({
    settings: { aiApiKey: "key" },
    initialStorage: cachedTranscript(),
    fetchImpl: contextualGlossFetch([aiGloss("get into the zone", "进入专注状态")], calls),
  });
  const request = {
    source: "sidepanel-transcript",
    selectedText: "get into the zone",
    videoId: "abc123",
    timestampSeconds: 61,
    videoTitle: "Study routine",
  };

  const first = await firstHarness.helpers.handleContextualGloss(request);
  const secondHarness = loadHelpers({
    settings: { aiApiKey: "key" },
    initialStorage: firstHarness.storage,
    fetchImpl: async () => { throw new Error("cached gloss must not call the network"); },
  });
  const second = await secondHarness.helpers.handleContextualGloss({ ...request, timestampSeconds: 62 });

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(second.fromCache, true);
  assert.equal(second.gloss.contextMeaningZh, "进入专注状态");
  assert.equal(calls.length, 1);
});

test("does not reuse a contextual gloss when the same expression occurs in another caption", async () => {
  const calls = [];
  const harness = loadHelpers({
    settings: { aiApiKey: "key" },
    initialStorage: cachedTranscript(),
    fetchImpl: contextualGlossFetch([
      aiGloss("get into the zone", "喝咖啡后进入状态"),
      aiGloss("get into the zone", "晚上更容易进入状态"),
    ], calls),
  });
  const base = {
    source: "sidepanel-transcript",
    selectedText: "get into the zone",
    videoId: "abc123",
    videoTitle: "Study routine",
  };

  const first = await harness.helpers.handleContextualGloss({ ...base, timestampSeconds: 4 });
  const second = await harness.helpers.handleContextualGloss({ ...base, timestampSeconds: 61 });

  assert.equal(first.gloss.contextMeaningZh, "喝咖啡后进入状态");
  assert.equal(second.gloss.contextMeaningZh, "晚上更容易进入状态");
  assert.equal(second.fromCache, false);
  assert.equal(calls.length, 2);
});

test("force refresh replaces a cached contextual gloss with one new AI call", async () => {
  const calls = [];
  const harness = loadHelpers({
    settings: { aiApiKey: "key" },
    initialStorage: cachedTranscript(),
    fetchImpl: contextualGlossFetch([
      aiGloss("get into the zone", "第一次释义"),
      aiGloss("get into the zone", "重新生成的释义"),
    ], calls),
  });
  const request = {
    source: "sidepanel-transcript",
    selectedText: "get into the zone",
    videoId: "abc123",
    timestampSeconds: 61,
    videoTitle: "Study routine",
  };

  await harness.helpers.handleContextualGloss(request);
  const refreshed = await harness.helpers.handleContextualGloss(request, { forceRefresh: true });
  const cached = await harness.helpers.handleContextualGloss(request);

  assert.equal(refreshed.gloss.contextMeaningZh, "重新生成的释义");
  assert.equal(cached.gloss.contextMeaningZh, "重新生成的释义");
  assert.equal(cached.fromCache, true);
  assert.equal(calls.length, 2);
});

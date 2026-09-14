const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "background.js"), "utf8");
const corpus = require("../corpus.js");

function loadHelpers({ settings = {} } = {}) {
  const listeners = { addListener() {} };
  const localStorage = { ytd_settings: settings };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    AbortController,
    fetch: async () => {
      throw new Error("No network call expected in a contextual-gloss validator test");
    },
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
          get: async (key) => ({ [key]: localStorage[key] }),
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
  return sandbox.__YTD_TRANSLATION_TESTING__;
}

test("resolves repeated selected text from the transcript nearest to the video timestamp", () => {
  const helpers = loadHelpers();
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
    videoTitle: "Study routine",
    channelName: "Daily English",
    targetText: "At night, I get into the zone more easily.",
    beforeText: "I get into the zone after coffee. Sometimes I need a break.",
    afterText: "Then I finish my work.",
    context: "I get into the zone after coffee. Sometimes I need a break. At night, I get into the zone more easily. Then I finish my work.",
  });
});

test("accepts only a validated AI contextual gloss with the selected expression", () => {
  const helpers = loadHelpers();
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
  const helpers = loadHelpers({ settings: { aiApiKey: "" } });
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

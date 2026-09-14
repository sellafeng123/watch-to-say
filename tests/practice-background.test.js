const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");
const corpus = require("../corpus.js");
const practice = require("../practice-session.js");

function loadPracticeHelpers(initialStorage = {}) {
  const storage = { ...initialStorage };
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    AbortController,
    fetch: async () => { throw new Error("not used"); },
    setTimeout() { return 0; },
    clearTimeout() {},
    importScripts() {},
    YTD_CORPUS: corpus,
    YTD_PRACTICE: practice,
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
        set: async (values) => Object.assign(storage, values),
      } },
      action: { onClicked: listeners },
      sidePanel: { setPanelBehavior() {}, setOptions: async () => {} },
      runtime: { onInstalled: listeners, onMessage: listeners, getURL: () => "", sendMessage: () => Promise.resolve() },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(backgroundSource, sandbox);
  return { helpers: sandbox.__YTD_TRANSLATION_TESTING__, storage };
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

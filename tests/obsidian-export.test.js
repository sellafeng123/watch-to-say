const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const backgroundSource = fs.readFileSync(path.join(root, "background.js"), "utf8");
const corpus = require("../corpus.js");

function loadExportHelpers(initialStorage = {}) {
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
    YTD_SETTINGS: {
      STORAGE_KEY: "ytd_settings",
      normalize: (settings) => ({
        provider: "deepseek", aiApiKey: "key", supadataApiKey: "key",
        obsidianVault: "English Vault", obsidianFolder: "YouTube English", ...settings,
      }),
      canonicalYouTubeUrl: (videoId) => `https://www.youtube.com/watch?v=${videoId}`,
      chatCompletionsUrl: () => "https://api.deepseek.com/chat/completions",
    },
    chrome: {
      storage: { local: {
        setAccessLevel: () => Promise.resolve(),
        get: async (keys) => {
          if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          return { [keys]: storage[keys] };
        },
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

test("keeps one stable Obsidian note path per video and records handoff without claiming a write", async () => {
  const { helpers, storage } = loadExportHelpers({ ytd_settings: { obsidianVault: "English Vault" } });
  const destination = await helpers.resolveVideoNoteDestination("abc123", "Study: Focus", new Date("2026-09-13T00:00:00Z"));
  assert.deepEqual(JSON.parse(JSON.stringify(destination)), {
    vault: "English Vault",
    folder: "YouTube English",
    notePath: "YouTube English/2026-09-13 - Study Focus.md",
    includeTableHeader: true,
  });
  await helpers.recordCorpusExport({ entryKey: "abc123:65:get into the zone", videoId: "abc123", notePath: destination.notePath });
  assert.deepEqual(JSON.parse(JSON.stringify(storage.ytd_corpus_video_notes.abc123)), {
    notePath: destination.notePath,
    corpusTableInitialized: true,
  });
  assert.equal(storage.ytd_corpus_exports[0].status, "handed_off");
  assert.equal(storage.ytd_corpus_exports[0].savedToObsidian, undefined);
  const laterDestination = await helpers.resolveVideoNoteDestination("abc123", "Study: Focus", new Date("2026-09-14T00:00:00Z"));
  assert.equal(laterDestination.includeTableHeader, false);
});

test("adds a first Corpus Palace table after a legacy hierarchical video note", async () => {
  const { helpers } = loadExportHelpers({
    ytd_settings: { obsidianVault: "English Vault" },
    ytd_corpus_video_notes: {
      abc123: "YouTube English/2026-09-12 - Existing Video.md",
    },
  });

  const destination = await helpers.resolveVideoNoteDestination(
    "abc123",
    "Existing Video",
    new Date("2026-09-14T00:00:00Z"),
  );
  assert.equal(destination.notePath, "YouTube English/2026-09-12 - Existing Video.md");
  assert.equal(destination.includeTableHeader, true);
});

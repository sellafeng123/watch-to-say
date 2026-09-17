const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "sidepanel.js"),
  "utf8",
);

function loadTranscriptInteractionHelpers() {
  const listeners = { addListener() {} };
  const sandbox = {
    console,
    URL,
    setTimeout,
    clearTimeout,
    window: { getSelection: () => null, close() {} },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      querySelector: () => null,
      getElementById: () => null,
      createElement: () => ({
        set textContent(value) { this._textContent = String(value); },
        get innerHTML() { return this._textContent || ""; },
      }),
    },
    chrome: {
      runtime: { onMessage: listeners, sendMessage: async () => ({}) },
      windows: { getCurrent: async () => ({ id: 1 }) },
      tabs: { onUpdated: listeners, onActivated: listeners },
    },
    YTD_SETTINGS: {},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox;
}

test("clicking a saved Transcript highlight opens its gloss instead of seeking", () => {
  const sandbox = loadTranscriptInteractionHelpers();
  vm.runInNewContext(
    "globalThis.__interactionCalls = []; showExplanation = (text, seconds) => __interactionCalls.push(['gloss', text, seconds]); seekTo = (seconds) => __interactionCalls.push(['seek', seconds]);",
    sandbox,
  );
  const event = {
    target: {
      closest: (selector) => selector === "mark.practice-highlight"
        ? { textContent: "  get into the zone  " }
        : null,
    },
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };

  sandbox.__YTD_TRANSCRIPT_TESTING__.handleTranscriptEntryClick(event, 42);

  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.__interactionCalls)),
    [["gloss", "get into the zone", 42]],
  );
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test("keyboard activation opens a saved Transcript highlight while ordinary row clicks still seek", () => {
  const sandbox = loadTranscriptInteractionHelpers();
  vm.runInNewContext(
    "globalThis.__interactionCalls = []; showExplanation = (text, seconds) => __interactionCalls.push(['gloss', text, seconds]); seekTo = (seconds) => __interactionCalls.push(['seek', seconds]);",
    sandbox,
  );
  const mark = {
    textContent: "focus on",
    closest: (selector) => selector === "mark.practice-highlight" ? mark : null,
  };
  const keyEvent = {
    key: "Enter",
    target: mark,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
  };
  const rowEvent = {
    target: { closest: () => null },
    preventDefault() {},
    stopPropagation() {},
  };

  sandbox.__YTD_TRANSCRIPT_TESTING__.handleTranscriptEntryKeydown(keyEvent, 18);
  sandbox.__YTD_TRANSCRIPT_TESTING__.handleTranscriptEntryClick(rowEvent, 27);

  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.__interactionCalls)),
    [["gloss", "focus on", 18], ["seek", 27]],
  );
  assert.equal(keyEvent.defaultPrevented, true);
  assert.equal(keyEvent.propagationStopped, true);
});

test("all timestamped transcript row clicks use the highlight-aware interaction helper", () => {
  assert.match(
    source,
    /function hasNonCollapsedTextSelection\(\)[\s\S]*?selection\.rangeCount > 0 && !selection\.isCollapsed/,
  );
  assert.match(
    source,
    /function seekFromTranscriptEntryClick\(event, seconds\)[\s\S]*?if \(hasNonCollapsedTextSelection\(\)\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?event\.stopPropagation\(\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?seekTo\(seconds\);/,
  );

  const guardedRowHandlers = source.match(
    /div\.addEventListener\("click", \(event\) =>\s+handleTranscriptEntryClick\(event, group\.start\),\s+\);/g,
  );
  assert.equal(
    guardedRowHandlers?.length,
    1,
    "raw transcript rows must use the guard",
  );
  assert.match(
    source,
    /div\.addEventListener\("click", \(event\) =>\s+handleTranscriptEntryClick\(event, segment\.start\),\s+\);/,
    "translated-only and bilingual rows must use the guard",
  );
  assert.doesNotMatch(
    source,
    /div\.addEventListener\("click", \(\) => seekTo\(group\.start\)\);/,
  );
});

test("the selection toolbar preserves selection and contains pointer events", () => {
  assert.match(
    source,
    /class="explain-btn"[\s\S]*?>Explain<[\s\S]*class="selection-note-btn"[\s\S]*?>Note</,
  );
  assert.match(
    source,
    /tooltip\.addEventListener\("mousedown", \(event\) => \{\s+event\.preventDefault\(\);\s+event\.stopPropagation\(\);/,
  );
  assert.match(
    source,
    /tooltip\.addEventListener\("mouseup", \(event\) => \{\s+event\.stopPropagation\(\);/,
  );
  assert.match(
    source,
    /\.addEventListener\("click", async \(event\) => \{\s+event\.preventDefault\(\);\s+event\.stopPropagation\(\);/,
  );
  assert.match(
    source,
    /querySelector\("\.selection-note-btn"\)[\s\S]*action: "saveNote"[\s\S]*timestamp: selectedTimestamp[\s\S]*selectedText/,
  );
  assert.match(
    source,
    /tooltip\.style\.top =[\s\S]*tooltip\.style\.left =[\s\S]*tooltip\.style\.display = "flex"/,
    "the toolbar must be positioned before it becomes visible",
  );
});

test("a prepared Transcript corpus entry becomes a practice highlight before Obsidian handoff", () => {
  assert.match(
    source,
    /function showCorpusEntryPreview\(root, entry, destination\)[\s\S]*?YTD_CORPUS_UI\.mountEntryPreview\(\{ root, entry \}\);[\s\S]*?action: "savePracticeHighlight"/,
  );
});

test("Transcript shows a practice entry and safely emphasizes saved expressions", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "sidepanel.html"), "utf8");
  assert.match(html, /id="startPracticeBtn"[\s\S]*?本期表达练习 · 已选 0 条/);
  assert.match(source, /function renderPracticeTranscriptMarkup\(text, highlights\)/);
  assert.match(source, /class="practice-highlight"/);
  assert.match(source, /function refreshPracticeHighlights\(\)[\s\S]*?action: "getPracticeHighlights"/);
  assert.match(source, /message\.action === "practiceHighlightSaved"[\s\S]*?refreshPracticeHighlights\(\)[\s\S]*?renderTranscript\(\)/);
});

test("leaving Transcript dismisses its selection actions", () => {
  assert.match(
    source,
    /if \(tabName !== "transcript" && transcriptTabIsActive\(\)\) \{\s*captureCurrentTranscriptScrollTop\(\);\s*dismissSelectionActions\(true\);/,
  );
  assert.match(
    source,
    /function dismissSelectionActions\(clearSelection = false\)[\s\S]*tooltip\.style\.display = "none"[\s\S]*window\.getSelection\(\)\?\.removeAllRanges\(\)/,
  );
});

test("Notes opens at its newest item and Transcript keeps its position", () => {
  assert.match(
    source,
    /if \(tabName === "notes"\)[\s\S]*notesPanelIsActive[\s\S]*contentArea\.scrollTop = 0/,
  );
  assert.match(
    source,
    /if \(tabName === "transcript"\)[\s\S]*contentArea\.scrollTop = lastTranscriptScrollTop/,
  );
});

test("the transcript view restores without resuming automatic scrolling", () => {
  assert.match(
    source,
    /void saveCurrentTranscriptViewState\(\);\s+window\.close\(\);/,
  );
  assert.match(
    source,
    /pendingTranscriptViewState = await loadTranscriptViewState\(videoId\)/,
  );
  assert.match(
    source,
    /function restorePendingTranscriptViewState\(videoId\)[\s\S]*autoScrollEnabled = false;[\s\S]*contentArea\.scrollTop = state\.scrollTop;/,
  );
  assert.match(
    source,
    /willRestoreReadingPosition[\s\S]*autoScrollEnabled = !willRestoreReadingPosition/,
  );
  assert.match(
    source,
    /function scheduleTranscriptViewStateSave\(\)[\s\S]*!transcriptTabIsActive\(\)[\s\S]*return;/,
  );
  assert.match(
    source,
    /tabName !== "transcript" && transcriptTabIsActive\(\)[\s\S]*captureCurrentTranscriptScrollTop\(\)/,
  );
});

test("the first non-YouTube navigation is checked again after commit", () => {
  assert.match(
    source,
    /function getNavigationUrl\(changeInfo, tab\)[\s\S]*changeInfo\.status !== "loading"[\s\S]*changeInfo\.status !== "complete"[\s\S]*tab\.pendingUrl \|\| tab\.url/,
  );
  assert.match(
    source,
    /chrome\.tabs\.onUpdated\.addListener\(\(tabId, changeInfo, tab\)[\s\S]*getNavigationUrl\(changeInfo, tab\)[\s\S]*handleFrontTabUrl\(url\)/,
  );
});

test("the panel never borrows a background YouTube tab", () => {
  assert.match(
    source,
    /const tabs = await chrome\.tabs\.query\(\{\s*active: true,\s*lastFocusedWindow: true,\s*\}\);/,
  );
  assert.match(
    source,
    /if \(!tab\.url\.startsWith\("https:\/\/www\.youtube\.com"\)\) \{\s*handleFrontTabUrl\(tab\.url\);\s*return;/,
  );
  assert.doesNotMatch(
    source,
    /chrome\.tabs\.query\(\{ url: "https:\/\/www\.youtube\.com\/\*" \}\)/,
  );
});

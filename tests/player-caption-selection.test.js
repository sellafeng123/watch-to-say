const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "content.js"),
  "utf8",
);

test("player-caption selection is limited to YouTube caption text", () => {
  assert.match(
    source,
    /function getPlayerCaptionSelection()[\s\S]*?\.ytp-caption-window-container[\s\S]*?selection\.rangeCount[\s\S]*?contains\(range\.startContainer\)[\s\S]*?contains\(range\.endContainer\)/,
  );
  assert.match(
    source,
    /document\.addEventListener\("mouseup", handlePlayerCaptionMouseUp\)/,
  );
});

test("player-caption cards use the contextual-gloss contract and Obsidian handoff", () => {
  assert.match(
    source,
    /source: "player-caption"[\s\S]*?action: "getContextualGloss"/,
  );
  assert.match(source, /YTD_CORPUS_UI\.mountGlossCard/);
  assert.match(source, /action: "recordCorpusExport"/);
  assert.match(source, /buildObsidianAppendUri/);
});

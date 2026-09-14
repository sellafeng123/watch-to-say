# Video Expression Practice Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Let learners turn the expressions they deliberately save from one YouTube video into a recoverable, spoken-first practice session: listening recall, contextual substitution, profile-led speaking, one retry pass, and an opt-in Obsidian closing summary.

**Architecture:** Keep expression highlights and practice sessions in `chrome.storage.local`, keyed by video ID. A pure `practice-session.js` module owns all normalization, merging, state transitions, retry selection, and Markdown summary rendering. The side panel owns the setup and stage UI. `background.js` validates/persists data and requests bounded AI practice materials. `content.js` owns short player audio clips. Obsidian remains an explicit URI handoff and is written only after the learner clicks the final save action.

**Tech Stack:** Manifest V3 Chrome extension; vanilla JavaScript and DOM APIs; DeepSeek JSON responses; `chrome.storage.local`; Node built-in test runner; Obsidian URI scheme.

**Spec:** `docs/superpowers/specs/2026-09-14-video-closing-learning-sheet-design.md`

## Global Constraints

- Preserve the existing V1 three-column `语料总表（宽表）`; V2 appends a separate concise summary only.
- Never call the result an Oxford definition. New AI output is labeled `AI 练习材料`.
- Do not record microphone input, send learner speech to an API, add ASR, or score pronunciation.
- A learner must click `显示答案` before `会 / 不会` controls become available in every stage.
- A learner-selected highlight persists even if it is unchecked for one practice session.
- Merge only the same normalized expression **and** same part of speech. Preserve each source example/anchor. Different POS stays separate.
- AI does not choose the learner's highlighted expressions. It only prepares exercises for the selected entries.
- Local IELTS imports use the browser File API and remain in local extension storage; do not scrape, poll, or auto-update third-party topic banks.
- Every data parser must limit untrusted text sizes and list lengths before saving it.

## Repository Map

| Path | Responsibility in V2 |
| --- | --- |
| `practice-session.js` | Pure model: highlight normalization/merging, session creation, stage state, retry queue, summary Markdown. |
| `practice-ui.js` | DOM-only setup, exercise, retry, and closing-summary views. No Chrome API calls. |
| `prompts/expression-practice.md` | DeepSeek system/user prompt sections and strict JSON contract for `AI 练习材料`. |
| `background.js` | Storage-backed highlight/session handlers, local IELTS import persistence, AI request validation, note-destination lookup. |
| `content.js` | `playPracticeClip` message: seek to anchor, play 4–8 seconds, then pause safely. |
| `sidepanel.html` | Transcript-top practice CTA plus practice modal root; script load order. |
| `sidepanel.js` | Fetch highlights, render transcript highlight ranges, orchestrate UI callbacks and background/player messages. |
| `sidepanel.css` | CTA, transcript-highlight, setup, stage, status, and compact summary styles. |
| `tests/practice-session.test.js` | Pure model and Markdown-summary behavior. |
| `tests/practice-background.test.js` | Background storage/message-related helper behavior and AI payload validation. |
| `tests/practice-ui.test.js` | Lightweight DOM contract/source checks for spoken-first controls. |
| `tests/release.test.js` | Manifest/file/prompt inclusion checks. |

---

## Task 1: Create the pure practice-session model

**Files:**
- Create: `practice-session.js`
- Create: `tests/practice-session.test.js`
- Modify: `manifest.json`
- Modify: `sidepanel.html`

- [ ] **Step 1: Write failing model tests**

  Cover these observable rules with ordinary objects only (no Chrome mocks):

  ```js
  const practice = require("../practice-session.js");

  test("merges same normalized expression and POS but retains every anchor", () => {
    const highlights = practice.mergePracticeHighlights([
      { expression: "Get  into the zone", partOfSpeech: "verb phrase", timestampSeconds: 18 },
      { expression: "get into the zone", partOfSpeech: "verb phrase", timestampSeconds: 74 },
    ]);
    assert.equal(highlights.length, 1);
    assert.equal(highlights[0].anchors.length, 2);
  });

  test("keeps different parts of speech as independent highlights", () => { /* ... */ });
  test("does not advance an item until the learner rates the revealed answer", () => { /* ... */ });
  test("adds failed stages to one retry pass and never creates a loop", () => { /* ... */ });
  test("renders the approved concise Obsidian closing summary", () => { /* ... */ });
  ```

- [ ] **Step 2: Run the new test and verify it fails**

  Run: `node --test tests/practice-session.test.js`

  Expected: failure because `practice-session.js` does not exist yet.

- [ ] **Step 3: Implement the minimal session contract**

  Export a browser global and CommonJS module, following `corpus.js`:

  ```js
  const YTD_PRACTICE = (() => {
    const STAGES = ["listening", "internalization", "speaking"];
    const RATINGS = new Set(["mastered", "review"]);
    const PROFILES = { ielts: "雅思口语题型与高频主题", work: "职场", daily: "日常聊天", travel: "旅行" };

    function mergePracticeHighlights(entries) { /* expression + normalized POS key */ }
    function createSession({ video, highlights, profile }) { /* selected IDs default true */ }
    function rateStage(session, { itemId, stage, rating, retry }) { /* immutable next session */ }
    function nextRetryTasks(session) { /* at most one task per failed stage */ }
    function buildPracticeSummaryMarkdown(session, date) { /* heading + counts + pending list */ }
    return { STAGES, PROFILES, mergePracticeHighlights, createSession, rateStage, nextRetryTasks, buildPracticeSummaryMarkdown };
  })();
  ```

  Use `not_started`, `mastered`, and `review` as durable values. Store `answerRevealed` only in the transient UI state, never as a success substitute. A highlight item contains `expression`, `kind`, `partOfSpeech`, `usageContexts`, `spokenFrequency`, `anchors[]`, and a deterministic `id`. An anchor contains timestamp, timestamped URL, original selected text, and surrounding context.

  `buildPracticeSummaryMarkdown` must produce only the agreed final block, including the chosen profile, counts for listening/internalization/speaking, and compact pending stages. It must not include the raw table row or a full AI response.

- [ ] **Step 4: Load the model where the extension needs it**

  Add `practice-session.js` before `content.js` in `manifest.json`, and after `corpus.js` before `sidepanel.js` in `sidepanel.html`.

- [ ] **Step 5: Run focused tests and static packaging check**

  Run:

  ```bash
  node --test tests/practice-session.test.js
  npm run check
  ```

  Expected: model tests pass; extension scripts remain valid.

- [ ] **Step 6: Commit the model slice**

  ```bash
  git add practice-session.js tests/practice-session.test.js manifest.json sidepanel.html
  git commit -m "feat: add practice session model"
  ```

## Task 2: Persist deliberately saved expressions as video highlights

**Files:**
- Modify: `background.js`
- Modify: `content.js`
- Modify: `sidepanel.js`
- Modify: `tests/obsidian-export.test.js`
- Create: `tests/practice-background.test.js`

- [ ] **Step 1: Write failing persistence tests**

  Extend the existing VM-backed background test setup. Test that `savePracticeHighlight`:

  - accepts only a compact corpus entry with a video ID, expression, type/POS, and timestamp;
  - merges same normalized expression + POS rather than overwriting anchors;
  - preserves different POS separately;
  - caps saved videos and highlights per video;
  - does not create an Obsidian export record.

  Also test `getPracticeHighlights(videoId)` returns only that video's normalized data.

- [ ] **Step 2: Run the test and verify it fails**

  Run: `node --test tests/practice-background.test.js`

  Expected: helpers/message handlers are absent.

- [ ] **Step 3: Implement background persistence and message actions**

  Add a dedicated storage key such as `ytd_practice_highlights_v1`.

  Implement and expose pure-ish helpers:

  ```js
  async function savePracticeHighlight(entry) { /* sanitize → merge → storage.set */ }
  async function getPracticeHighlights(videoId) { /* lookup + YTD_PRACTICE.mergePracticeHighlights */ }
  ```

  Add message actions:

  ```js
  if (message.action === "savePracticeHighlight") { /* async response */ }
  if (message.action === "getPracticeHighlights") { /* async response */ }
  ```

  Do not overload `recordCorpusExport`: the highlight should be available immediately after the learner clicks `保存并准备导出`, before they hand it off to Obsidian. Preserve the existing export record behavior unchanged.

- [ ] **Step 4: Save the highlight from both V1 entry editors**

  In `showPlayerCorpusEntryPreview` (`content.js`) and `showCorpusEntryPreview` (`sidepanel.js`), call:

  ```js
  chrome.runtime.sendMessage({ action: "savePracticeHighlight", entry }).catch(() => {});
  ```

  immediately after `YTD_CORPUS_UI.mountEntryPreview`. The preview/export UI must still work if local storage fails.

- [ ] **Step 5: Run focused regression tests**

  Run:

  ```bash
  node --test tests/practice-background.test.js tests/obsidian-export.test.js tests/corpus.test.js
  ```

  Expected: highlight persistence passes and existing note path/table behavior is unchanged.

- [ ] **Step 6: Commit the persistence slice**

  ```bash
  git add background.js content.js sidepanel.js tests/practice-background.test.js tests/obsidian-export.test.js
  git commit -m "feat: save video expression highlights"
  ```

## Task 3: Add the Transcript-top entry and persistent visual highlights

**Files:**
- Modify: `sidepanel.html`
- Modify: `sidepanel.js`
- Modify: `sidepanel.css`
- Create: `tests/practice-ui.test.js`

- [ ] **Step 1: Write failing UI contract tests**

  Check the static DOM contract and deterministic helpers:

  - `sidepanel.html` has `#startPracticeBtn` within the Transcript panel above search, with initial text `本期表达练习 · 已选 0 条`;
  - `renderTranscript` can receive merged highlights without injecting unescaped HTML;
  - matching text in a source anchor is wrapped in a `.practice-highlight` mark;
  - the count is the number of merged highlights, not the number of examples;
  - clicking a highlight never prevents timestamp seeking.

- [ ] **Step 2: Run the test and verify it fails**

  Run: `node --test tests/practice-ui.test.js`

  Expected: CTA and highlighter do not exist.

- [ ] **Step 3: Implement the entry strip and highlight loading**

  In the Transcript panel place an unobtrusive button above the search control:

  ```html
  <button id="startPracticeBtn" class="practice-start-btn" type="button" disabled>
    本期表达练习 · 已选 0 条
  </button>
  ```

  In `sidepanel.js`, maintain `currentPracticeHighlights`. On video load and after every V1 save, request `getPracticeHighlights`; then update CTA text/disabled state and rerender the transcript.

  Add a pure `renderPracticeTranscriptMarkup(text, highlights)` that escapes transcript content before marking exact normalized source-expression matches. Apply the `practice-highlight` class only to a transcript group containing an anchor's timestamp/text. Keep existing translation markup and search highlighting intact by doing practice rendering before `refreshTranscriptSearch` runs.

- [ ] **Step 4: Add concise visual and accessibility styling**

  Style only the selected expression with a soft, high-contrast underline/background; use `aria-label="本期重点表达"`. The CTA must remain readable at the side-panel width and display a helpful disabled title when there are no saved expressions.

- [ ] **Step 5: Run focused UI and transcript regressions**

  Run:

  ```bash
  node --test tests/practice-ui.test.js tests/transcript-search.test.js tests/transcript-selection.test.js
  npm run check
  ```

  Expected: practice emphasis works without breaking selection/search/seek behavior.

- [ ] **Step 6: Commit the Transcript entry slice**

  ```bash
  git add sidepanel.html sidepanel.js sidepanel.css tests/practice-ui.test.js
  git commit -m "feat: highlight saved expressions in transcript"
  ```

## Task 4: Build the setup view, local IELTS import, and bounded AI materials endpoint

**Files:**
- Create: `practice-ui.js`
- Create: `prompts/expression-practice.md`
- Modify: `sidepanel.html`
- Modify: `sidepanel.js`
- Modify: `background.js`
- Modify: `manifest.json`
- Modify: `tests/practice-background.test.js`
- Modify: `tests/release.test.js`

- [ ] **Step 1: Write failing tests for AI and setup contracts**

  Test the background validator rejects malformed/out-of-scope model data and accepts only:

  ```json
  {
    "label": "AI 练习材料",
    "items": [{
      "id": "existing-highlight-id",
      "internalization": {
        "promptZh": "…",
        "reference": "…"
      },
      "speaking": {
        "question": "…",
        "reference": "…"
      }
    }],
    "synthesis": { "itemIds": ["…"], "question": "…", "reference": "…" }
  }
  ```

  Test that IDs not present in the user-selected highlight list are dropped, strings/lists are capped, the default profile is IELTS, and imported local questions are sent only when the `custom_ielts` profile is selected.

- [ ] **Step 2: Run the tests and verify they fail**

  Run: `node --test tests/practice-background.test.js tests/release.test.js`

  Expected: no practice-material validator/prompt/file references exist.

- [ ] **Step 3: Implement a DOM-only preparation view**

  `practice-ui.js` must expose `mountPracticeSetup({ root, highlights, profile, importedBank, onStart, onImport, onCancel })`.

  The setup view must:

  - show all merged expressions with checkbox and example-count metadata, all checked by default;
  - provide native profile controls: IELTS default, 职场, 日常聊天, 旅行, and `使用我导入的雅思题库` only after a valid import;
  - offer a file input that reads user-selected `.txt`, `.md`, `.json`, or `.csv` with `FileReader`, displays a local-only confirmation/count, and passes raw content to the sidepanel for validation/storage;
  - start only when at least one expression is checked;
  - make cancel discard only unsaved transient setup choices.

  Add `practice-ui.js` before `sidepanel.js` in `sidepanel.html` and `manifest.json` only where required by the side panel (not as a content script).

- [ ] **Step 4: Implement local-bank storage and practice material request**

  In `background.js`:

  - add an `ytd_practice_ielts_bank_v1` record (normalized questions, source filename, imported timestamp; capped);
  - add `savePracticeIeltsBank` / `getPracticeIeltsBank` actions;
  - add `getPracticeMaterials` action, requiring selected sanitized highlights and one known profile;
  - load `prompts/expression-practice.md` through existing `loadPromptSection`;
  - invoke `requestAiCompletion` with JSON output, low temperature, and an input list of selected expression/anchors/type—not entire transcript;
  - validate against the selected IDs before returning.

  The prompt must state: content is AI practice material, keep sentence frames/phrases intact, exercises vary by `word`/`phrase`/`sentence_frame`, reference answers are hidden first, and do not fabricate dictionary attributions.

- [ ] **Step 5: Wire the Transcript button to setup and material generation**

  Use a reusable modal root in `sidepanel.html`. On start: create a session via `YTD_PRACTICE.createSession`, persist it through the background, then request materials. Display an explicit retryable error if the AI call fails; never lose selected highlights or session choices.

- [ ] **Step 6: Run focused tests**

  Run:

  ```bash
  node --test tests/practice-background.test.js tests/practice-ui.test.js tests/release.test.js
  npm run check
  ```

  Expected: local-only import constraints and material validation are covered.

- [ ] **Step 7: Commit the setup/materials slice**

  ```bash
  git add practice-ui.js prompts/expression-practice.md sidepanel.html sidepanel.js background.js manifest.json tests/practice-background.test.js tests/practice-ui.test.js tests/release.test.js
  git commit -m "feat: prepare expression practice materials"
  ```

## Task 5: Implement spoken-first stages, player clips, and one retry pass

**Files:**
- Modify: `practice-ui.js`
- Modify: `practice-session.js`
- Modify: `sidepanel.js`
- Modify: `content.js`
- Modify: `sidepanel.css`
- Modify: `tests/practice-session.test.js`
- Modify: `tests/practice-ui.test.js`
- Modify: `tests/player-caption-selection.test.js`

- [ ] **Step 1: Write failing stage and player tests**

  Add tests proving:

  - `会 / 不会` is absent or disabled before `显示答案`;
  - listening task receives the first retained anchor and a 4–8 second duration;
  - failed items are queued for only one later retry of that same stage;
  - mastered listening is the only route into internalization; mastered internalization is the only route into speaking;
  - type-specific internalization text is requested/rendered for word, phrase, and sentence frame;
  - the content script has a bounded `playPracticeClip` command that seeks, plays, and pauses rather than leaving a timer after navigation.

- [ ] **Step 2: Run focused tests and verify they fail**

  Run:

  ```bash
  node --test tests/practice-session.test.js tests/practice-ui.test.js tests/player-caption-selection.test.js
  ```

  Expected: stage renderer and clip command are missing.

- [ ] **Step 3: Add safe short audio playback to `content.js`**

  Add `playPracticeClip` to the existing message listener:

  ```js
  if (message.action === "playPracticeClip") {
    playPracticeClip(message.seconds, message.durationSeconds);
    sendResponse({ success: true });
    return false;
  }
  ```

  `playPracticeClip` must clamp start at zero, clamp duration to `[4, 8]`, cancel a prior practice timer, seek, call `video.play().catch(...)`, then pause only if the same clip token is still current. Clear the timer when navigation/reinjection removes the player.

- [ ] **Step 4: Render each stage in `practice-ui.js`**

  Implement `mountPracticeStage({ root, stage, item, material, isRetry, onPlayClip, onReveal, onRate, onExit })`.

  Every stage starts with:

  ```text
  先在口中完成，再点“显示答案”。
  [播放原音 / 重新播放]  [显示答案]
  ```

  After reveal only, show the original anchor and target expression for listening; show the AI prompt + reference for internalization; show the profile-led question + reference for speaking. Then expose `我会` and `还不会`.

  For internalization, render a type label and guidance:

  - word: “先说一个搭配，再说一个自己的真实场景句”；
  - phrase: “保留这个词伙，替换人物、时间或情境”；
  - sentence frame: “保留框架，用自己的内容补全或重写”。

  On each rating, use `YTD_PRACTICE.rateStage` and persist the session before advancing. Failed expressions continue in the later retry queue; they do not block other selected expressions. The retry view runs each failed stage once, then gives a final end option without requeueing.

- [ ] **Step 5: Add optional synthesis after individual speaking**

  If AI returns a synthesis question for 2–3 expressions that passed internalization, show it after individual speaking as optional. Its flow is also speak → reveal reference → self-rate, but it never changes whether individual expressions are pending review.

- [ ] **Step 6: Run focused and regression tests**

  Run:

  ```bash
  node --test tests/practice-session.test.js tests/practice-ui.test.js tests/player-caption-selection.test.js tests/transcript-selection.test.js
  npm run check
  ```

  Expected: flow order and existing player/selection behavior pass.

- [ ] **Step 7: Commit the interactive flow slice**

  ```bash
  git add practice-ui.js practice-session.js sidepanel.js content.js sidepanel.css tests/practice-session.test.js tests/practice-ui.test.js tests/player-caption-selection.test.js
  git commit -m "feat: add spoken expression practice flow"
  ```

## Task 6: Add opt-in Obsidian closing summaries and release verification

**Files:**
- Modify: `background.js`
- Modify: `sidepanel.js`
- Modify: `practice-ui.js`
- Modify: `tests/obsidian-export.test.js`
- Modify: `tests/practice-session.test.js`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `manifest.json`

- [ ] **Step 1: Write failing summary/export tests**

  Test that:

  - the final screen reports per-stage mastered/review counts and compact pending expressions;
  - `buildPracticeSummaryMarkdown` begins `## 本期表达练习 · YYYY-MM-DD` and has no corpus-table header;
  - `resolveVideoNoteDestination` chooses the same existing video note;
  - clicking the final save action creates an Obsidian append URI but does not claim a direct write;
  - repeated click records a `practiceSummary` handoff idempotently without changing V1 corpus mappings.

- [ ] **Step 2: Run tests and verify they fail**

  Run:

  ```bash
  node --test tests/practice-session.test.js tests/obsidian-export.test.js
  ```

  Expected: no practice-summary handoff record or final action exists.

- [ ] **Step 3: Implement explicit summary handoff**

  Add a `recordPracticeSummaryExport` helper/action under a separate storage key. It can record `{ sessionId, videoId, notePath, status: "handed_off" }`, but must never use `savedToObsidian` or imply file-system confirmation.

  In the final `practice-ui.js` view display:

  ```text
  本期表达练习 · {profile}
  听辨：N 会 / N 待复习
  内化：N 会 / N 待复习
  输出：N 会 / N 待复习
  ```

  Expose `保存本次总结到 Obsidian` only if the learner configured a vault/note destination. It builds an append URI with the pure model's Markdown and records the handoff only upon click. If no vault is configured, offer the existing settings route instead. Do not append the summary automatically at session completion.

- [ ] **Step 4: Document exactly what V2 does and does not retain**

  In both READMEs add the feature flow, local-only IELTS import, explicit-Obsidian-save behavior, and privacy boundary (no recording/ASR). Update manifest version and description in lockstep with release test expectations.

- [ ] **Step 5: Run full verification**

  Run:

  ```bash
  npm test
  npm run check
  npm run package
  git status --short
  ```

  Expected: all tests/checks/package pass; only intentional distributable artifacts or no uncommitted source changes remain.

- [ ] **Step 6: Commit release-ready V2**

  ```bash
  git add background.js sidepanel.js practice-ui.js practice-session.js tests/obsidian-export.test.js tests/practice-session.test.js README.md README.zh-CN.md manifest.json
  git commit -m "feat: export video practice summaries"
  ```

## Final Review Checklist

- [ ] Compare every acceptance criterion in the design spec to a passing test or manual side-panel check.
- [ ] Confirm an unchecked setup entry remains a Transcript highlight and corpus entry.
- [ ] Confirm a failed task appears exactly once in “再过一遍” and session can end after it.
- [ ] Confirm a V2 summary appends to the same note as the V1 wide table, without rewriting that table.
- [ ] Confirm no prompt/output labels AI content as Oxford or dictionary text.
- [ ] Confirm the packaged zip contains `practice-session.js`, `practice-ui.js`, and `prompts/expression-practice.md`.

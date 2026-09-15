# Question Banks and Group Speaking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local IELTS bank, learner-pasted question banks, sentence-level listening answers, three-example internalization, and one repeatable whole-set speaking question.

**Architecture:** Introduce a pure `question-bank.js` domain module shared by the service worker, Settings, and side panel, plus a pure `practice-flow.js` reducer that drives item practice, whole-set speaking, retry, and summary transitions. Keep third-party OCR output in an ignored local JSON file while the public repository ships only schema, conversion tooling, and synthetic test fixtures; neither OCR tooling nor synthetic question data enters the installable extension. Split AI contracts into bank parsing, per-expression internalization, and whole-set speaking-round prompts; keep Chrome storage and network calls in `background.js`, DOM rendering in focused UI modules, and immutable learning state in `practice-session.js`.

**Tech Stack:** Manifest V3 Chrome extension, vanilla JavaScript and DOM APIs, `chrome.storage.local`, DeepSeek JSON responses, macOS PDFKit/Vision for development-time OCR, Node built-in test runner, shell release scripts.

**Spec:** `docs/superpowers/specs/2026-09-15-question-bank-and-group-speaking-design.md`

## Global Constraints

- IELTS mode displays exact stored questions; DeepSeek may select a stored ID and generate an answer but may not rewrite the question.
- Work, daily conversation, and travel support `smart_mix`, `mine_only`, and `ai_only`; IELTS supports `bundled` and `bundled_plus_mine`.
- Listening reveal contains only the complete source sentence that contains the target expression.
- Internalization asks for two learner sentences and reveals exactly three varied reference examples under `表达参考`.
- Speaking stays locked until every selected expression is marked `mastered` for internalization; `review` items loop without a retry limit, while the learner can exit without output.
- Speaking is one whole-set round with `完成本次练习` and `需要再练`; the latter offers same-question retry, new-question replacement, or return, and it is never rated per expression.
- Requesting a new speaking question must exclude every question ID already used in the current session; same-question retry remains in the existing round.
- Pasted source text is sent to DeepSeek only after `识别题库` and is not stored after the learner confirms the structured preview.
- Learner speech is never recorded or uploaded.
- The supplied OCR-derived IELTS content remains local and Git-ignored unless redistribution permission is confirmed.
- Existing Transcript highlighting and the Obsidian three-column corpus table must remain unchanged.
- Every parser must enforce explicit limits: 12 learner banks, 80,000 pasted characters, 800 questions per bank, 800 characters per question, 12 cue points, and 300 characters per cue point.

---

### Task 1: Add the pure question-bank domain module

**Files:**
- Create: `question-bank.js`
- Create: `tests/question-bank.test.js`
- Modify: `background.js:1-20`
- Modify: `options.html:225-236`
- Modify: `sidepanel.html:278-288`
- Modify: `scripts/check-release.sh:25-55`
- Modify: `tests/release.test.js:340-365`

**Interfaces:**
- Consumes: plain JavaScript objects only.
- Produces: global/CommonJS `YTD_QUESTION_BANK` with `normalizeQuestion(record, bank)`, `normalizeBank(record)`, `makeQuestionId(record)`, `normalizeSourceMode(profile, value)`, `eligibleQuestions({ banks, bundledBank, profile, sourceMode, usedQuestionIds })`, `rankCandidates({ questions, expressions, limit })`, `validateParsedBank(raw, draft, sourceText)`, and constants `STORAGE_KEY`, `LIMITS`, `PROFILE_SOURCE_MODES`.

- [ ] **Step 1: Write failing behavior tests**

Add literal fixtures that prove: IDs are deterministic; malformed Parts/profiles are stripped; an imported question must occur verbatim after whitespace normalization in the pasted source; IELTS source modes never produce AI-only candidates; `mine_only` never includes bundled or generated records; general questions are eligible for work/daily/travel but not IELTS; used IDs are excluded; ranking returns at most 40 stable candidates.

```js
test("rejects a model-rewritten question that was not in the pasted source", () => {
  const parsed = bank.validateParsedBank({
    label: "AI 题库识别",
    questions: [{ part: "part1", topic: "Home", question: "Do you enjoy your home?", cuePoints: [] }],
    unrecognized: [],
  }, { name: "My bank", profiles: ["ielts"] }, "Do you like your home?");
  assert.equal(parsed, null);
});

test("smart mix excludes questions already used in the session", () => {
  const result = bank.eligibleQuestions({
    banks: [learnerBank], bundledBank, profile: "daily", sourceMode: "smart_mix",
    usedQuestionIds: [learnerBank.questions[0].id],
  });
  assert.deepEqual(result, []);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/question-bank.test.js`

Expected: FAIL because `question-bank.js` does not exist.

- [ ] **Step 3: Implement the bounded pure module**

Use these exact limits and mode tables:

```js
const STORAGE_KEY = "ytd_question_banks_v1";
const LIMITS = Object.freeze({
  maxBanks: 12, maxPasteChars: 80000, maxQuestionsPerBank: 800,
  maxQuestionChars: 800, maxCuePoints: 12, maxCuePointChars: 300,
  maxCandidates: 40,
});
const PROFILE_SOURCE_MODES = Object.freeze({
  ielts: ["bundled", "bundled_plus_mine"],
  work: ["smart_mix", "mine_only", "ai_only"],
  daily: ["smart_mix", "mine_only", "ai_only"],
  travel: ["smart_mix", "mine_only", "ai_only"],
});
```

`validateParsedBank` must compare normalized returned questions and cue points against normalized substrings in the original paste, cap every list/string, discard unknown fields, reject duplicate deterministic IDs, and return `{ bank, unrecognized }` only when at least one question survives.

`rankCandidates` tokenizes English and Chinese text from expression, usage contexts, source examples, topic, and question; it sorts by descending overlap score and then deterministic ID, filling zero-score space deterministically until the 40-item cap.

- [ ] **Step 4: Load the module in every trusted runtime**

Change the service worker import to:

```js
importScripts("settings.js", "corpus.js", "practice-session.js", "question-bank.js");
```

Load `question-bank.js` before `options.js` and before `sidepanel.js`. Add it to the public release allowlist and update runtime-order tests.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
node --test tests/question-bank.test.js tests/release.test.js
npm run check
```

Expected: all tests pass and the release checker includes `question-bank.js`.

Commit:

```bash
git add question-bank.js tests/question-bank.test.js background.js options.html sidepanel.html scripts/check-release.sh tests/release.test.js
git commit -m "feat: add question bank domain model"
```

---

### Task 2: Build and validate the local IELTS bank conversion pipeline

**Files:**
- Create: `scripts/ocr-ielts-pdf.swift`
- Create: `scripts/parse-ielts-ocr.mjs`
- Create: `tests/ielts-ocr-parser.test.js`
- Create: `tests/fixtures/ielts-ocr-sample.json`
- Create: `data/ielts-question-bank.sample.json`
- Modify: `.gitignore`
- Modify: `package.json`
- Modify: `scripts/check-release.sh`

**Interfaces:**
- Consumes: `ocr-ielts-pdf.swift INPUT.pdf OUTPUT.json`; page records shaped as `{ page, lines: [{ text, confidence, x, y }] }`.
- Produces: `parseIeltsOcrPages(pages, bankMeta)` and CLI `node scripts/parse-ielts-ocr.mjs INPUT.json OUTPUT.json`; output is a normalized bank accepted by `YTD_QUESTION_BANK.normalizeBank`.

- [ ] **Step 1: Write a synthetic OCR fixture and failing parser tests**

The fixture must contain one Part 1 topic with two numbered questions and one Part 2 cue card with three cue points followed by two Part 3 questions. Tests assert exact English wording, Part assignment, cue points, `parentCueCardId`, topic continuity across a page break, and rejection of a record without a question mark or cue-card instruction.

```js
test("keeps a Part 2 cue card linked to its Part 3 questions", () => {
  const result = parseIeltsOcrPages(fixture, { id: "ielts-2026-09_12", season: "2026-09_12" });
  const cue = result.questions.find((item) => item.part === "part2");
  const followUp = result.questions.find((item) => item.part === "part3");
  assert.deepEqual(cue.cuePoints, ["Where it is", "Who you go with", "Why you like it"]);
  assert.equal(followUp.parentCueCardId, cue.id);
});
```

- [ ] **Step 2: Run the parser test and verify RED**

Run: `node --test tests/ielts-ocr-parser.test.js`

Expected: FAIL because the parser module is missing.

- [ ] **Step 3: Implement the OCR parser**

Sort lines by page and visual position, normalize common OCR variants (`Partl` to `Part1`, curly apostrophes to canonical apostrophes only for matching), and use explicit state transitions for `Part1`, `Part 2`, `You should say`, and `Part 3`. Do not invent missing question text. Export rejected lines with page numbers in `warnings[]` for manual review.

- [ ] **Step 4: Implement the macOS OCR command**

Create a Swift CLI using `PDFKit`, `Vision`, and `AppKit`. For each page, render at 2x scale, run `VNRecognizeTextRequest` with `recognitionLevel = .accurate`, `usesLanguageCorrection = true`, and `recognitionLanguages = ["en-US", "zh-Hans"]`, then emit UTF-8 JSON with text, confidence, and bounding-box coordinates. Exit nonzero for unreadable input, zero pages, or zero recognized lines.

- [ ] **Step 5: Verify the parser and run the real local conversion**

Run:

```bash
node --test tests/ielts-ocr-parser.test.js
swift scripts/ocr-ielts-pdf.swift '/Users/stella/Desktop/2026年9-12月雅思口语题库（9.9).pdf' 'tmp/ielts-ocr-2026-09_12.json'
node scripts/parse-ielts-ocr.mjs 'tmp/ielts-ocr-2026-09_12.json' 'data/ielts-question-bank.local.json'
```

Expected: 46 OCR page records, nonzero Part 1/2/3 counts, no duplicate IDs, and a warnings report listing every low-confidence or unparsed line.

- [ ] **Step 6: Manually verify representative local-bank records**

Compare structured output against PDF pages 5, 10, 20, 30, 40, and 46. Confirm exact question wording, correct Part, cue-point grouping, and Part 2 to Part 3 linkage. Correct parser rules and rerun the whole conversion rather than hand-editing individual JSON records.

- [ ] **Step 7: Protect private OCR output and commit only tooling**

Add these ignores:

```gitignore
tmp/ielts-ocr-*.json
data/ielts-question-bank.local.json
dist/*-local-with-question-bank.zip
```

Keep the Swift/Node scripts, synthetic fixture, and sample bank in the repository only; do not add any of them to the extension release allowlist. Extend `check-release.sh` so every `data/ielts-question-bank*.json`, OCR intermediate, and development script is absent from the public archive. The only question-bank runtime code added to the public allowlist is `question-bank.js` from Task 1. Add `ocr:ielts` as a documented macOS-only development command.

Commit:

```bash
git add .gitignore package.json scripts/ocr-ielts-pdf.swift scripts/parse-ielts-ocr.mjs tests/ielts-ocr-parser.test.js tests/fixtures/ielts-ocr-sample.json data/ielts-question-bank.sample.json scripts/check-release.sh
git commit -m "feat: add local IELTS bank conversion tools"
```

---

### Task 3: Add durable learner-bank storage and pasted-text recognition

**Files:**
- Create: `prompts/question-bank-import.md`
- Modify: `background.js:380-1020`
- Modify: `tests/practice-background.test.js`
- Modify: `scripts/check-release.sh`
- Modify: `tests/release.test.js`

**Interfaces:**
- Consumes: `previewQuestionBankImport({ name, profiles, sourceText, replaceBankId? })`, `saveQuestionBank({ previewToken })`, `renameQuestionBank({ bankId, name })`, `listQuestionBanks()`, `deleteQuestionBank({ bankId })`.
- Produces: message actions `previewQuestionBankImport`, `saveQuestionBank`, `renameQuestionBank`, `listQuestionBanks`, `deleteQuestionBank`, and `getPracticeQuestionSources`.

- [ ] **Step 1: Write failing background behavior tests**

Extend the existing VM-backed background harness. Test that an 80,001-character paste is rejected before any AI call; parsing runs in bounded chunks; source mismatch rejects the preview; preview data is not written to the durable bank key; save requires a valid unexpired preview token; saving a 13th bank fails without deleting an existing one; replacing a bank is atomic and preserves its bank ID; rename changes only the bounded display name; delete removes only the requested learner bank; bundled-bank metadata is listed separately.

Use complete DeepSeek response fixtures:

```json
{"label":"AI 题库识别","questions":[{"part":null,"topic":"Meetings","question":"How do you prepare for an important meeting?","cuePoints":[]}],"unrecognized":[]}
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/practice-background.test.js`

Expected: FAIL because the new handlers do not exist.

- [ ] **Step 3: Add the import prompt and bounded chunking**

Create `question-bank-import.md` with `System prompt` and `User prompt` sections. Require JSON label `AI 题库识别`, exact source wording, known Parts, topic, cue points, and unrecognized fragments. Split source text at paragraph boundaries into chunks of at most 12,000 characters and process at most three concurrent calls. Merge only through `YTD_QUESTION_BANK.validateParsedBank`.

- [ ] **Step 4: Implement preview and explicit confirmation storage**

Store import previews under `ytd_question_bank_previews_v1` with a random token, normalized bank, optional validated `replaceBankId`, unrecognized fragments, and `expiresAt = Date.now() + 30 * 60 * 1000`. `saveQuestionBank` atomically creates a bank or replaces only that learner-owned bank while preserving its ID, then deletes the preview. `renameQuestionBank` accepts a non-empty bounded display name and never rewrites question IDs. Never store `sourceText` in either key.

Load the optional local bank from `data/ielts-question-bank.local.json`. If it is absent or invalid, return no bundled IELTS questions and report `bundledAvailable: false` rather than crashing. `data/ielts-question-bank.sample.json` is synthetic parser/test documentation only and must never be offered to learners as an authentic IELTS source.

- [ ] **Step 5: Add message routing and validate side effects**

Add the five bank-management message actions plus `getPracticeQuestionSources`. Return `{ success, previewToken, summary, sampleQuestions, unrecognized }` for previews, `{ success, bank }` for save/rename, and compact metadata for lists. Do not return the full bank to Settings until the learner asks to inspect it.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
node --test tests/practice-background.test.js tests/question-bank.test.js tests/release.test.js
npm run check
```

Commit:

```bash
git add background.js prompts/question-bank-import.md tests/practice-background.test.js scripts/check-release.sh tests/release.test.js
git commit -m "feat: import learner speaking question banks"
```

---

### Task 4: Add question-bank management to Settings

**Files:**
- Create: `question-bank-ui.js`
- Create: `tests/question-bank-ui.test.js`
- Create: `tests/helpers/fake-dom.js`
- Modify: `options.html:115-225`
- Modify: `options.js:1-580`
- Modify: `options.css:1-402`
- Modify: `scripts/check-release.sh`
- Modify: `tests/release.test.js`

**Interfaces:**
- Consumes: callbacks `onRecognize(draft)`, `onSave(previewToken)`, `onRename(bankId, name)`, `onReplace(bankId)`, `onDelete(bankId)`, `onRefresh()`.
- Produces: `YTD_QUESTION_BANK_UI.mountManager({ root, copy, state, callbacks })` and DOM events carrying `{ name, profiles, sourceText }`.

- [ ] **Step 1: Write failing DOM behavior tests**

Create a small project-owned fake DOM helper that implements only the primitives used by the component (`createElement`, attributes, text/value/checked state, children, event listeners, dispatch, and selectors by id/class/data attribute). Drive the rendered component through dispatched input/click events rather than reading source text. Assert that: at least one profile must be selected; the textarea preserves content after a failed recognition; a successful preview shows Part/profile counts, three sample questions, and unrecognized count; no save button appears before preview; rename and replace target the intended learner bank; delete emits the requested bank ID and `options.js` invokes `window.confirm` immediately before its callback; localized labels render in English and Chinese.

- [ ] **Step 2: Run the UI test and verify RED**

Run: `node --test tests/question-bank-ui.test.js`

Expected: FAIL because `question-bank-ui.js` is missing.

- [ ] **Step 3: Add the Settings card and localized copy**

Add a `#questionBankManager` card after the AI provider card. Include bank name, profile checkboxes (`ielts`, `work`, `daily`, `travel`, `general`), bounded textarea, `识别题库`, accessible loading/status region, preview region, and saved-bank list. Add all copy keys to both `COPY.en` and `COPY["zh-CN"]`; do not embed untranslated Chinese in English mode.

- [ ] **Step 4: Implement UI state without mixing network logic**

`question-bank-ui.js` renders only from state and invokes callbacks. `options.js` calls Chrome messages, retains the draft string on failure, clears it only after successful save, reloads metadata, and uses `window.confirm` immediately before delete. Replace pre-fills the selected bank name/profiles and sets `replaceBankId`; it still requires recognition preview and explicit save, so an AI/parser failure cannot overwrite the old bank.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
node --test tests/question-bank-ui.test.js tests/options-page.test.js tests/settings.test.js
npm run check
```

Commit:

```bash
git add question-bank-ui.js tests/question-bank-ui.test.js tests/helpers/fake-dom.js options.html options.js options.css scripts/check-release.sh tests/release.test.js
git commit -m "feat: manage speaking question banks in settings"
```

---

### Task 5: Revise listening sentences and internalization materials

**Files:**
- Modify: `practice-session.js:1-199`
- Modify: `practice-ui.js:1-148`
- Modify: `prompts/expression-practice.md`
- Modify: `background.js:930-1030`
- Modify: `tests/practice-session.test.js`
- Modify: `tests/practice-ui.test.js`
- Modify: `tests/practice-background.test.js`

**Interfaces:**
- Produces: `extractAnswerSentence({ context, selectedText, expression }) -> string`; validated material `{ id, internalization: { promptZh, references: [string, string, string] } }`.
- Removes: per-item `speaking` fields from the expression-practice AI contract.

- [ ] **Step 1: Write failing sentence-extraction tests**

Cover the target in the first/middle/last sentence, repeated target text, `!?。！？` punctuation, quoted punctuation, no punctuation, and an absent target. Use hand-derived expected sentences.

```js
test("reveals only the sentence containing the selected phrase", () => {
  assert.equal(practice.extractAnswerSentence({
    context: "I was tired. Then I got into the zone and finished. That felt great.",
    selectedText: "got into the zone", expression: "get into the zone",
  }), "Then I got into the zone and finished.");
});
```

- [ ] **Step 2: Write failing material/UI tests**

Assert that validation rejects one, two, four, duplicate, empty, or overlong references; internalization guidance says two sentences for all kinds; `表达参考` is rendered only for internalization; the rating controls stay hidden until reveal; listening still uses `显示答案` and renders `extractAnswerSentence` output.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --test tests/practice-session.test.js tests/practice-background.test.js tests/practice-ui.test.js
```

Expected: failures for the missing extractor, old single reference, and old labels.

- [ ] **Step 4: Implement sentence extraction and the new AI contract**

Split on sentence terminators while retaining punctuation, find exact `selectedText` case-insensitively first, then inflection-tolerant expression tokens, and fall back to the shortest clause capped at 320 characters. Update the prompt to return exactly:

```json
{"label":"AI 练习材料","items":[{"id":"...","internalization":{"promptZh":"...","references":["...","...","..."]}}]}
```

Require three distinct contexts and two-sentence learner instructions. Update validator limits and remove per-item speaking generation.

- [ ] **Step 5: Render three reference examples**

In `mountStage`, choose reveal copy by stage: `显示答案` for listening and `表达参考` for internalization. Render the three references as an ordered list. Preserve speak-first gating and item-level `我会 / 还不会` controls.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
node --test tests/practice-session.test.js tests/practice-background.test.js tests/practice-ui.test.js
npm test
```

Commit:

```bash
git add practice-session.js practice-ui.js prompts/expression-practice.md background.js tests/practice-session.test.js tests/practice-background.test.js tests/practice-ui.test.js
git commit -m "feat: deepen listening and internalization practice"
```

---

### Task 6: Replace per-item speaking state with whole-set rounds

**Files:**
- Modify: `practice-session.js:1-220`
- Modify: `tests/practice-session.test.js`

**Interfaces:**
- Produces: `internalizationReviewItems(session)`, `isReadyForSpeaking(session)`, `speakingItems(session)`, `addSpeakingRound(session, round)`, `retrySameSpeakingRound(session, { roundId })`, `finishSpeakingRound(session, { roundId, outcome })`, `usedQuestionIds(session)`, and session fields `questionSourceMode`, `speakingExpressionIds`, `speakingRounds`.
- Consumes: validated round `{ questionId, source, part, question, cuePoints, reference }`.

- [ ] **Step 1: Write failing state-transition tests**

Test that one remaining internalization `review` item keeps speaking locked; only review items enter the next internalization pass; repeated review passes have no fixed limit; all-mastered readiness snapshots the complete selected ID set; retrying the same round increments `attemptCount` without duplicating its question ID; changing questions records `needs_practice`; `finished` advances to unresolved listening review or summary; no item-level speaking rating is accepted.

- [ ] **Step 2: Run the model tests and verify RED**

Run: `node --test tests/practice-session.test.js`

Expected: failures because round transitions are absent and speaking remains an item stage.

- [ ] **Step 3: Implement immutable round transitions**

Set item stages to `{ listening, internalization }`. Initialize `speakingExpressionIds: []` and `speakingRounds: []`, and normalize source mode through `YTD_QUESTION_BANK.normalizeSourceMode`. `isReadyForSpeaking` returns true only when every selected item is `mastered` for internalization; when it first becomes true, snapshot every selected item ID in `speakingExpressionIds`. `internalizationReviewItems` remains repeatable without consuming the existing one-pass listening retry marker. `addSpeakingRound` rejects duplicate new-question IDs and empty references. `retrySameSpeakingRound` increments only `attemptCount`. `finishSpeakingRound` changes only the current unfinished round and accepts only `needs_practice` or `finished`.

- [ ] **Step 4: Update summary behavior**

Replace per-item output counts with `口语输出：完成 N 题 / 需要再练 N 题 / 原题重答 N 次`. Preserve listening pending-expression summaries. Internalization review loops disappear from the final summary once mastered; only an explicit early exit can summarize unresolved internalization items.

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test tests/practice-session.test.js`

Commit:

```bash
git add practice-session.js tests/practice-session.test.js
git commit -m "feat: model whole-set speaking rounds"
```

---

### Task 7: Add validated whole-set speaking-round generation

**Files:**
- Create: `prompts/speaking-round.md`
- Modify: `background.js:930-1100`
- Modify: `tests/practice-background.test.js`
- Modify: `scripts/check-release.sh`
- Modify: `tests/release.test.js`

**Interfaces:**
- Consumes: `handleSpeakingRound({ profile, sourceMode, expressions, usedQuestionIds })`.
- Produces: message action `getSpeakingRound` returning `{ success: true, round }` or bounded errors `NO_ELIGIBLE_EXPRESSIONS`, `QUESTION_BANK_EMPTY`, `QUESTION_BANK_EXHAUSTED`, `INVALID_AI_RESPONSE`.

- [ ] **Step 1: Write failing selection and validation tests**

Cover: IELTS responses must return an ID from candidates; displayed question/cue points come from stored data, not AI text; `mine_only` never falls back to generation; `smart_mix` falls back only when there are no unused suitable learner questions; generated IDs are deterministic and excluded when changing questions; the request contains the complete mastered expression set but at most 40 candidates; IELTS Part answer length bands and unknown fields are validated.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/practice-background.test.js`

Expected: FAIL because `handleSpeakingRound` and its validator do not exist.

- [ ] **Step 3: Define the prompt contracts**

For stored candidates require:

```json
{"label":"AI 口语练习","questionId":"known-id","reference":"...","usedExpressionIds":["..."]}
```

For DeepSeek-only non-IELTS generation require:

```json
{"label":"AI 口语练习","generatedQuestion":"...","reference":"...","usedExpressionIds":["..."]}
```

The system prompt must enforce exact candidate IDs, profile-specific answer style, Band 7 to 7.5 IELTS length rules, natural rather than forced expression use, and no claims that generated non-IELTS questions came from a bank.

- [ ] **Step 4: Implement source policy and candidate resolution**

Load enabled banks, call `eligibleQuestions`, rank to 40, and remove used IDs before the AI call. For stored selection, ignore any returned question text and resolve the exact stored record by `questionId`. For `smart_mix`, generation is allowed only if eligible learner candidates are empty. For `mine_only`, return `QUESTION_BANK_EXHAUSTED` instead.

- [ ] **Step 5: Validate and highlight reference usage safely**

Cap references at 4,000 characters, validate returned used-expression IDs against the supplied set, and return plain text plus valid IDs. Highlighting remains a UI concern and must escape both reference and expression text.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
node --test tests/practice-background.test.js tests/question-bank.test.js tests/release.test.js
npm run check
```

Commit:

```bash
git add prompts/speaking-round.md background.js tests/practice-background.test.js scripts/check-release.sh tests/release.test.js
git commit -m "feat: generate whole-set speaking rounds"
```

---

### Task 8: Build source selection and the speaking-round UI

**Files:**
- Create: `practice-flow.js`
- Create: `tests/practice-flow.test.js`
- Modify: `practice-ui.js:20-148`
- Modify: `sidepanel.js:40-1380`
- Modify: `sidepanel.html:278-288`
- Modify: `sidepanel.css:720-1020`
- Modify: `tests/practice-ui.test.js`
- Modify: `scripts/check-release.sh`
- Modify: `tests/release.test.js`

**Interfaces:**
- Consumes: `mountSetup` receives question-source metadata; `mountSpeakingRound({ root, round, expressions, position, retryChoiceOpen, onSeek, onReveal, onFinish, onNeedPractice, onRetrySame, onChangeQuestion, onCancelRetry, onExit })`.
- Produces: setup callback `{ selectedIds, profile, sourceMode }`; speaking-round callbacks without item-level ratings; global/CommonJS `YTD_PRACTICE_FLOW` with `create(session)`, `currentView(flow)`, and `reduce(flow, event) -> { flow, effect }`.

- [ ] **Step 1: Write failing UI behavior tests**

Test observable DOM behavior: IELTS profile exposes only bundled modes; non-IELTS exposes smart/mine/AI; source choices update when profile changes; speaking screen displays one question and every selected-expression chip; reference and final actions are hidden before `口语参考`; after reveal exactly `完成本次练习` and `需要再练` appear; opening retry choices shows `再答一次这道题`, `换一道新题`, and `返回当前题目`; only the new-question choice shows the API-cost reminder; Part 2 cue points render as a list.

- [ ] **Step 2: Write failing orchestration tests**

Drive the pure reducer with literal events: `RATE_ITEM`, `SPEAKING_READY`, `REVEAL_SPEAKING`, `OPEN_RETRY_CHOICE`, `RETRY_SAME_QUESTION`, `RETRY_NEW_QUESTION`, `CANCEL_RETRY_CHOICE`, `FINISH_SPEAKING`, and `SPEAKING_FAILED`. Prove that the flow contains only listening/internalization item queues; any internalization review result sends only those items through another internalization pass and emits no speaking request; the all-mastered transition emits `{ type: "REQUEST_SPEAKING_ROUND", expressionIds, usedQuestionIds }` once for the complete set; same-question retry hides the reference and increments the existing attempt without an effect; new-question retry records the used ID and emits another request; `SPEAKING_FAILED` keeps the prior round visible with an inline error. Do not assert by grepping `sidepanel.js` source.

- [ ] **Step 3: Run UI tests and verify RED**

Run: `node --test tests/practice-ui.test.js tests/practice-flow.test.js`

Expected: failures for missing source selector, speaking-round component, and repeat flow.

- [ ] **Step 4: Implement dynamic source selection in setup**

Fetch `getPracticeQuestionSources` when opening setup. Default IELTS to `bundled`; default other profiles to `smart_mix`. Keep a source select disabled only while metadata loads. If the bundled bank is unavailable, explain the local installation issue and disable starting IELTS rather than silently generating a fake IELTS question.

- [ ] **Step 5: Implement group-speaking rendering**

Add `mountSpeakingRound` with escaped question text, optional IELTS Part label/cue list, target-expression chips, speak-first copy, `口语参考`, a highlighted safe reference answer, and the two final actions. Keep ratings hidden before reveal.

- [ ] **Step 6: Replace side-panel per-item speaking orchestration**

Implement `practice-flow.js` as an immutable reducer and load it before `sidepanel.js`. Use `const PRACTICE_STAGES = ["listening", "internalization"]`. `sidepanel.js` renders `currentView(flow)` and performs only declared effects. After the initial internalization pass, the reducer repeatedly queues only `internalizationReviewItems`; it requests the first speaking round only after `isReadyForSpeaking` passes and sends all `speakingExpressionIds`. `OPEN_RETRY_CHOICE` changes only the view. `RETRY_SAME_QUESTION` hides the reference and increments the current round with no request. `RETRY_NEW_QUESTION` marks the current round and requests another using `usedQuestionIds`; a failed request dispatches `SPEAKING_FAILED` so the reducer restores the prior round and attaches an inline error. `FINISH_SPEAKING` proceeds to unresolved listening retry items and then summary.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
node --test tests/practice-ui.test.js tests/practice-flow.test.js tests/practice-session.test.js tests/transcript-selection.test.js tests/release.test.js
npm test
```

Commit:

```bash
git add practice-flow.js tests/practice-flow.test.js practice-ui.js sidepanel.js sidepanel.html sidepanel.css tests/practice-ui.test.js scripts/check-release.sh tests/release.test.js
git commit -m "feat: add repeatable group speaking UI"
```

---

### Task 9: Add local packaging, documentation, and final verification

**Files:**
- Create: `scripts/package-local-extension.sh`
- Modify: `package.json`
- Modify: `manifest.json`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `PRIVACY.md`
- Modify: `SECURITY.md`
- Modify: `tests/release.test.js`

**Interfaces:**
- Produces: public `npm run package` without the private local bank and personal `npm run package:local` with validated `data/ielts-question-bank.local.json`.

- [ ] **Step 1: Write failing release-boundary tests**

Run the public release file list and assert it excludes `data/ielts-question-bank.local.json`. Validate the synthetic sample and reject a malformed local bank before packaging. Verify the local archive contains exactly one additional data file and is named `youtube-digest-v2.1.0-local-with-question-bank.zip`.

- [ ] **Step 2: Run release tests and verify RED**

Run: `node --test tests/release.test.js`

Expected: FAIL because local packaging and version 2.1.0 are absent.

- [ ] **Step 3: Implement guarded local packaging**

`package-local-extension.sh` first runs `npm test` and `scripts/check-release.sh`, validates the local bank through `question-bank.js`, copies the public allowlist plus the single local bank into a temporary archive, scans for credentials/private paths, and prints its SHA-256. It must never add the local bank to Git or the public package command.

- [ ] **Step 4: Update version and user documentation**

Bump manifest/package version to `2.1.0`. Document question-source behavior, the paste recognition data flow, repeated DeepSeek cost, local-bank publishing boundary, installation/reload steps, and the absence of runtime PDF import/OCR.

- [ ] **Step 5: Run fresh full verification**

Run:

```bash
npm test
npm run check
npm run package
npm run package:local
unzip -t dist/youtube-digest-v2.1.0.zip
unzip -t dist/youtube-digest-v2.1.0-local-with-question-bank.zip
git diff --check
git status --short
```

Expected: zero test failures; both archives pass integrity checks; the public archive omits the local bank; the local archive contains it; only intended generated/ignored artifacts remain outside Git.

- [ ] **Step 6: Commit the release slice**

```bash
git add scripts/package-local-extension.sh package.json manifest.json README.md README.zh-CN.md PRIVACY.md SECURITY.md tests/release.test.js
git commit -m "release: package question bank practice v2.1.0"
```

After the commit, rerun `npm test`, `npm run check`, and both packaging commands before reporting completion.

# V2.1: Question Banks and Group Speaking Design

## Status

This document extends and supersedes the speaking-output and question-bank sections of `2026-09-14-video-closing-learning-sheet-design.md`. The existing highlight collection, Transcript emphasis, Obsidian corpus table, listening stage, and internalization stage remain in place except where this document explicitly changes them.

## Goal

Turn the speaking-output stage from one question per expression into a lighter whole-set exercise:

1. the learner moves every selected expression through listening and internalization;
2. any expression marked `review` for internalization repeats until every selected expression is marked `mastered`, or the learner exits without entering output;
3. the output stage receives the complete selected expression set only after that strict mastery gate passes;
4. one relevant speaking question is selected or generated for the set;
5. the learner answers aloud, reveals an appropriate reference answer, and chooses to finish, retry the same question, or practise with a different question.

IELTS mode must select authentic questions from an IELTS question bank. Work, daily conversation, and travel modes can use a learner-pasted bank, DeepSeek-generated questions, or both.

## Product Decisions

### Practice profiles and question sources are separate

The practice profile controls the situation and answer style:

- IELTS speaking;
- work;
- daily conversation;
- travel.

The question source controls where the prompt comes from:

- bundled IELTS bank;
- learner-pasted bank;
- DeepSeek generation.

The UI must not describe these as the same setting.

### Source choices by profile

IELTS mode offers:

- `Bundled IELTS bank`;
- `Bundled + my IELTS bank`.

IELTS questions are always selected from a stored bank. DeepSeek may rank candidates and generate the reference answer, but it must not invent or rewrite the displayed IELTS question.

Work, daily conversation, and travel offer:

- `Smart mix` (default): prefer an eligible learner question, then generate with DeepSeek if no suitable unused question remains;
- `My bank only`: select only eligible learner questions and report when the bank is exhausted;
- `DeepSeek only`: generate a new profile-matched question.

A learner-pasted bank can be assigned to one or more profiles. A `general speaking` assignment is eligible in work, daily conversation, and travel, but not automatically in IELTS.

## Bundled IELTS Bank

### Source and extraction

The supplied `2026年9-12月雅思口语题库（9.9).pdf` is a 46-page image-only PDF with no text layer. It requires OCR before it can become structured data.

The one-time conversion pipeline is development-time work, not runtime extension work:

1. render every PDF page to an image;
2. OCR Chinese and English text;
3. parse Part 1 topics/questions and Part 2 cue cards with their associated Part 3 questions;
4. retain the original English question wording;
5. run structural validation and manually review representative pages and low-confidence records;
6. produce a compact JSON bank.

The Chrome extension does not bundle a full PDF renderer or OCR engine in V2.1. This keeps installation size and runtime memory use small.

### Publishing boundary

The supplied PDF contains third-party branding and may be copyrighted. OCR output is therefore treated as user-local data by default and must not be committed to or published from the public GitHub fork unless the user confirms they have permission to redistribute the question content.

The implementation should support a local packaged bank for the user's installation while keeping that generated data ignored by Git. The public repository may include only the schema, parser, tests with synthetic examples, and an empty or clearly original sample bank. If redistribution rights are confirmed later, the validated bank can be moved into the public release allowlist.

## Learner-Pasted Question Banks

### Import flow

Settings gains a `Speaking question banks` section. The learner:

1. chooses one or more applicable profiles;
2. gives the bank an optional name;
3. pastes plain text into a bounded textarea;
4. clicks `Recognize question bank`;
5. reviews a summary and representative parsed questions;
6. confirms `Save question bank`.

The pasted text can contain headings, numbered questions, Part labels, cue-card bullets, or loosely formatted lists. It does not need to follow a rigid template.

### Parsing and validation

DeepSeek converts pasted text into the structured schema. The raw paste is sent only after the learner clicks the recognition button. Before the API request, the extension limits text size and rejects empty or excessively large input.

The response validator must:

- accept only known profile and IELTS Part values;
- limit bank, topic, question, and cue-point counts;
- reject empty questions and duplicate IDs;
- require every returned question to match normalized source text from the paste instead of accepting model rewrites;
- strip unknown properties;
- show unrecognized fragments without saving them silently;
- save only after explicit learner confirmation.

After confirmation, structured records are saved in `chrome.storage.local`. The raw pasted text is discarded. A learner can inspect counts, rename a bank, replace it, or delete it.

## Question Data Model

```js
{
  id: "stable-source-id",
  bankId: "bank-id",
  source: "bundled_ielts" | "learner_bank",
  profiles: ["ielts" | "work" | "daily" | "travel" | "general"],
  part: "part1" | "part2" | "part3" | null,
  topic: "Hometown",
  question: "Do you like your hometown?",
  cuePoints: [],
  parentCueCardId: null,
  season: "2026-09_12",
  createdAt: 0
}
```

Part 2 uses `question` for the cue-card instruction and `cuePoints` for `You should say` prompts. Related Part 3 questions use `parentCueCardId` so they can be presented independently while preserving their topic relationship.

Question IDs are deterministic within a bank and based on normalized Part, topic, and exact question text. This supports deduplication and prevents repeats within one practice session.

## Revised Practice Flow

### 1. Listening recall

The learner jumps to the source timestamp and answers aloud before revealing the answer.

`Show answer` displays only the complete sentence containing the selected expression. It must not display the entire grouped transcript paragraph. Sentence selection follows this order:

1. find the sentence containing the exact selected expression;
2. if the expression occurs more than once, choose the occurrence nearest the stored selection text;
3. if sentence punctuation is missing, use the shortest available source caption or bounded clause;
4. escape all displayed source text.

The learner then marks the item `mastered` or `review` as before.

### 2. Expression internalization

Every internalization task explicitly asks the learner to create two spoken sentences.

Type-specific guidance remains:

- word: use a natural collocation and produce two personal sentences;
- phrase: retain the chunk while changing person, time, or situation across two sentences;
- sentence frame: retain the frame and complete or rewrite it twice with different content.

The reveal button is labelled `表达参考`, not `显示答案`. Revealing it displays exactly three concise reference examples with meaningfully different contexts. These examples are guidance, not a single correct answer.

The learner then marks the item `mastered` or `review`. After every selected expression has completed its first internalization attempt, expressions still marked `review` enter an immediate `再过一遍` internalization loop. Only those expressions repeat; expressions already marked `mastered` are not shown again. The loop has no fixed retry limit: it continues until every selected expression is `mastered` or the learner exits the session. Exiting is always allowed, but no speaking-output question is created for an incomplete session.

### 3. Group speaking output

Speaking no longer creates one task per word, phrase, or sentence frame. It starts only when every selected expression's internalization status is `mastered`. One speaking round is then created for the complete selected expression set; the implementation must not start early with a mastered subset.

The screen contains:

- the selected or generated question;
- IELTS Part and cue points when applicable;
- the target expressions as reference chips;
- an instruction to answer aloud before revealing the reference;
- a `口语参考` reveal action;
- one profile-appropriate reference answer;
- `完成本次练习` and `需要再练` actions.

The round receives one overall outcome. It does not ask the learner to rate every expression separately.

Selecting `完成本次练习` marks the group-output round finished and proceeds to any unresolved listening-recall review items, then the session summary. Internalization cannot remain unresolved because it is the output gate.

Selecting `需要再练` does not immediately change the question. It reveals three inline choices:

- `再答一次这道题`: increment the current round's attempt count, hide the reference again, and return to speak-first mode without a DeepSeek request;
- `换一道新题`: mark the current round as needing practice, record its question ID, request a different unused question for the same complete expression set, and start a new round;
- `返回当前题目`: close the choice panel without changing state.

The learner may retry the same question or change questions repeatedly until selecting `完成本次练习`. Only changing questions can consume another DeepSeek request, so the API-cost reminder appears next to `换一道新题`, not next to same-question retry.

## IELTS Question Selection and Answers

For IELTS mode:

1. filter bank entries to enabled IELTS banks and remove question IDs already used in this session;
2. create a bounded candidate list using the expressions' usage contexts, meanings, and stored topics;
3. ask DeepSeek to return one candidate ID only, plus the reference answer;
4. validate that the returned ID exists in the candidate list;
5. display the exact stored question and cue points, never model-returned question text.

The reference answer defaults to a natural Band 7 to 7.5 target:

- Part 1: direct, personal, and concise, normally 3 to 5 sentences;
- Part 2: a coherent cue-card response designed for roughly 1.5 to 2 minutes;
- Part 3: a developed analytical answer, normally 40 to 60 seconds.

The answer uses as many target expressions as sound natural. It must not damage coherence or IELTS authenticity merely to include every expression. Used target expressions are highlighted in the reference answer.

## Other Profile Questions and Answers

For work, daily conversation, and travel:

- `My bank only` selects an unused eligible stored question and asks DeepSeek only for a reference answer;
- `DeepSeek only` asks for both a new profile-matched question and its reference answer;
- `Smart mix` first tries a learner-bank candidate, falling back to DeepSeek generation when no suitable unused candidate exists.

Generated questions must match the profile, be answerable from personal experience, and provide enough room to use several target expressions naturally. The validator rejects empty, duplicate, unrelated, or overlong results.

## Session State

The session adds:

```js
{
  questionSourceMode: "bundled" | "bundled_plus_mine" | "smart_mix" | "mine_only" | "ai_only",
  speakingExpressionIds: [],
  usedQuestionIds: [],
  speakingRounds: [
    {
      id: "round-id",
      questionId: "stored-id-or-generated-id",
      source: "bundled_ielts" | "learner_bank" | "deepseek",
      part: "part1" | "part2" | "part3" | null,
      question: "...",
      cuePoints: [],
      reference: "...",
      attemptCount: 1,
      outcome: null | "needs_practice" | "finished",
      createdAt: 0
    }
  ]
}
```

Item-level speaking statuses are no longer used for new sessions. V2.0 did not persist active practice sessions, so no durable session migration is required. V2.1 keeps active round state in the side panel for the current session; question banks remain durable in `chrome.storage.local`.

## AI Contracts

Separate bounded AI actions are used:

1. `parsePastedQuestionBank`: converts learner text into validated question records;
2. `prepareInternalizationMaterials`: creates a two-sentence task and exactly three reference examples per selected item;
3. `prepareSpeakingRound`: selects a validated stored question ID or creates one permitted non-IELTS question, then produces a profile-appropriate reference answer.

No action receives the complete long-term corpus. Each request contains only the current video's eligible expressions and a bounded candidate-question list.

## Error Handling

- OCR conversion failures are reported during development and never produce a partially bundled bank without review.
- Paste parsing errors preserve the textarea for correction and do not overwrite an existing saved bank.
- If `My bank only` is exhausted, the UI offers to change source mode or finish; it does not silently call DeepSeek for a new question.
- If an IELTS response returns an unknown question ID, the request is rejected and can be retried once.
- If DeepSeek fails while changing questions, the current round remains visible and the learner can retry the same question, try changing again, or finish.
- Closing the practice modal must not delete saved highlights or question banks.

## Privacy and Storage Limits

- Question banks are stored locally in Chrome. Active practice-round state remains in the current side-panel session.
- Raw pasted text is sent to DeepSeek only after the learner clicks recognition and is discarded after structured import confirmation.
- Learner speech is never recorded or uploaded.
- Storage limits apply per bank and across all banks; oldest inactive custom banks are never deleted silently.
- Deleting a bank requires an explicit confirmation and does not delete past session summaries.

## Non-Goals for V2.1

- runtime OCR or direct scanned-PDF import inside Chrome;
- automatic download or scraping of seasonal IELTS banks;
- speech recognition, pronunciation scoring, or microphone recording;
- guaranteeing that every target expression appears in one reference answer;
- publishing third-party OCR-derived question content without redistribution permission;
- exporting full question-bank contents to Obsidian.

## Acceptance Criteria

1. Listening reveal shows only the complete source sentence containing the expression.
2. Internalization asks for two learner sentences and reveals exactly three varied reference examples under `表达参考`.
3. Speaking remains locked until every selected expression is marked mastered for internalization; review items loop without a retry limit and the learner may exit without output.
4. Speaking creates one whole-set round using the complete selected expression set rather than one question per expression or an early mastered subset.
5. A speaking round is rated only as finished or needing more practice.
6. Needing more practice lets the learner retry the same question without an API call, change to a different unused question, or return without changing state.
7. IELTS mode displays an exact stored Part 1, Part 2, or Part 3 question and a Part-appropriate Band 7 to 7.5 reference answer.
8. Work, daily conversation, and travel can use learner banks, DeepSeek generation, or the documented smart fallback.
9. Pasted text is previewed and explicitly confirmed before structured records replace or create a bank.
10. New-question IDs cannot repeat within one session; repeating the same question remains another attempt on its existing round.
11. The existing Transcript highlighting and Obsidian three-column corpus table remain unchanged.

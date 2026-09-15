const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const questionBank = require("../question-bank.js");
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures/ielts-ocr-sample.json"),
  "utf8",
));

const parserPath = path.join(__dirname, "../scripts/parse-ielts-ocr.mjs");
const parserUrl = pathToFileURL(parserPath);

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function approvedReview(pages, overrides = {}) {
  return {
    schemaVersion: 1,
    status: "approved",
    sourcePdfSha256: "a".repeat(64),
    ocrSha256: digest(pages),
    pageCount: pages.length,
    reviewedAt: "2026-09-15T12:00:00.000Z",
    reviewedPages: pages.map((page) => ({
      page: page.page,
      status: "reviewed",
      ocrSha256: digest(page),
    })),
    corrections: [],
    ...overrides,
  };
}

function pagesWithExpectedCount(pages, expectedPageCount = 46) {
  const present = new Set(pages.map((page) => page.page));
  return [
    ...pages,
    ...Array.from({ length: expectedPageCount }, (_, index) => index + 1)
      .filter((page) => !present.has(page))
      .map((page) => ({ page, lines: [] })),
  ];
}

async function parseFixture() {
  const { parseIeltsOcrPages } = await import(parserUrl.href);
  return parseIeltsOcrPages(fixture, {
    id: "ielts-2026-09_12",
    season: "2026-09_12",
  });
}

test("preserves exact Part 1 wording and topic across a page break", async () => {
  const result = await parseFixture();
  const part1 = result.questions.filter((item) => item.part === "part1");

  assert.deepEqual(part1.map((item) => item.question), [
    "Where is your hometown?",
    "What do you like most about your hometown?",
  ]);
  assert.deepEqual(part1.map((item) => item.topic), ["Hometown", "Hometown"]);
});

test("keeps a Part 2 cue card linked to its Part 3 questions", async () => {
  const result = await parseFixture();
  const cue = result.questions.find((item) => item.part === "part2");
  const followUps = result.questions.filter((item) => item.part === "part3");

  assert.equal(cue.question, "Describe a place you enjoy visiting.");
  assert.deepEqual(cue.cuePoints, ["Where it is", "Who you go with", "Why you like it"]);
  assert.deepEqual(followUps.map((item) => item.question), [
    "Why do people enjoy visiting the same place again?",
    "How can tourism change a local area?",
  ]);
  assert.ok(followUps.every((item) => item.parentCueCardId === cue.id));
});

test("rejects numbered text without a question mark or cue-card instruction", async () => {
  const result = await parseFixture();

  assert.equal(
    result.questions.some((item) => item.question.includes("no question mark")),
    false,
  );
  assert.deepEqual(
    result.warnings.filter((warning) => warning.text.includes("no question mark")),
    [{
      page: 2,
      text: "3. This numbered sentence has no question mark",
      reason: "unparsed",
    }],
  );
});

test("returns a bank already normalized by the shared runtime contract", async () => {
  const result = await parseFixture();
  const normalized = questionBank.normalizeBank(result);

  assert.equal(result.id, "ielts-2026-09_12");
  assert.equal(result.source, "bundled_ielts");
  assert.deepEqual(result.profiles, ["ielts"]);
  assert.deepEqual(normalized, {
    id: result.id,
    name: result.name,
    source: result.source,
    profiles: result.profiles,
    questions: result.questions,
  });
  assert.equal(new Set(result.questions.map((item) => item.id)).size, result.questions.length);
  assert.ok(result.questions.every((item) => item.season === "2026-09_12"));
});

test("uses numbered Part 1 topics and joins wrapped question text", async () => {
  const { parseIeltsOcrPages } = await import(parserUrl.href);
  const result = parseIeltsOcrPages([{
    page: 5,
    lines: [
      { text: "Part1", confidence: 1, x: 0.1, y: 0.9 },
      { text: "1. Home", confidence: 1, x: 0.1, y: 0.8 },
      { text: "1. What is the difference between where you live now and where you", confidence: 1, x: 0.1, y: 0.7 },
      { text: "lived in the past?", confidence: 1, x: 0.1, y: 0.6 },
      { text: "2. Would you like to see more parks in your city!", confidence: 1, x: 0.1, y: 0.5 },
      { text: "3. Are there parks nearby?", confidence: 1, x: 0.1, y: 0.4 },
      { text: "4. A numbered note without punctuation", confidence: 1, x: 0.1, y: 0.3 },
      { text: "Part 2", confidence: 1, x: 0.1, y: 0.2 },
    ],
  }], { id: "ielts-test" });

  assert.deepEqual(result.questions.map((item) => ({
    part: item.part,
    topic: item.topic,
    question: item.question,
  })), [
    {
      part: "part1",
      topic: "Home",
      question: "What is the difference between where you live now and where you lived in the past?",
    },
    {
      part: "part1",
      topic: "Home",
      question: "Are there parks nearby?",
    },
  ]);
  assert.ok(result.warnings.some((warning) => (
    warning.text === "4. A numbered note without punctuation"
    && warning.reason === "unparsed"
  )));
  assert.ok(result.warnings.some((warning) => (
    warning.text === "2. Would you like to see more parks in your city!"
    && warning.reason === "unparsed"
  )));
});

test("joins a wrapped cue instruction before collecting cue points", async () => {
  const { parseIeltsOcrPages } = await import(parserUrl.href);
  const result = parseIeltsOcrPages([{
    page: 40,
    lines: [
      { text: "Part 2", confidence: 1, x: 0.1, y: 0.9 },
      { text: "Describe a home that you like to visit but do not want to live in You should", confidence: 1, x: 0.1, y: 0.8 },
      { text: "say:", confidence: 1, x: 0.1, y: 0.7 },
      { text: "Where it is", confidence: 1, x: 0.1, y: 0.6 },
      { text: "Why you like to visit it", confidence: 1, x: 0.1, y: 0.5 },
      { text: "bilibili", confidence: 1, x: 0.1, y: 0.04 },
    ],
  }, {
    page: 41,
    lines: [
      { text: "IELTS", confidence: 1, x: 0.1, y: 0.99 },
      { text: "Part 3", confidence: 1, x: 0.1, y: 0.9 },
      { text: "1 . Why do people visit other homes?", confidence: 1, x: 0.1, y: 0.8 },
    ],
  }], { id: "ielts-test" });
  const cue = result.questions.find((item) => item.part === "part2");
  const followUp = result.questions.find((item) => item.part === "part3");

  assert.equal(cue.question, "Describe a home that you like to visit but do not want to live in");
  assert.deepEqual(cue.cuePoints, ["Where it is", "Why you like to visit it"]);
  assert.equal(followUp.question, "Why do people visit other homes?");
  assert.equal(followUp.parentCueCardId, cue.id);
  assert.deepEqual(result.warnings.filter((warning) => ["bilibili", "IELTS"].includes(warning.text)), [
    { page: 40, text: "bilibili", reason: "unparsed" },
    { page: 41, text: "IELTS", reason: "unparsed" },
  ]);
});

test("keeps low-confidence noise out and infers a missed Part 3 marker", async () => {
  const { parseIeltsOcrPages } = await import(parserUrl.href);
  const result = parseIeltsOcrPages([{
    page: 39,
    lines: [
      { text: "Part2", confidence: 1, x: 0.1, y: 0.9 },
      { text: "Describe a thing you did to learn another language", confidence: 1, x: 0.1, y: 0.8 },
      { text: "You should say:", confidence: 1, x: 0.1, y: 0.7 },
      { text: "What language you learned", confidence: 1, x: 0.1, y: 0.6 },
      { text: "luobo IELTS", confidence: 0.5, x: 0.3, y: 0.55 },
      { text: "1. What difficulties do people face when learning a language?", confidence: 1, x: 0.1, y: 0.5 },
      { text: "2. Which is better, to study alone or in a group?", confidence: 1, x: 0.1, y: 0.4 },
    ],
  }], { id: "ielts-test" });
  const cue = result.questions.find((item) => item.part === "part2");
  const followUps = result.questions.filter((item) => item.part === "part3");

  assert.deepEqual(cue.cuePoints, ["What language you learned"]);
  assert.deepEqual(followUps.map((item) => item.question), [
    "What difficulties do people face when learning a language?",
    "Which is better, to study alone or in a group?",
  ]);
  assert.ok(followUps.every((item) => item.parentCueCardId === cue.id));
  assert.ok(followUps.every((item) => item.topic === cue.topic));
  assert.deepEqual(result.warnings.find((warning) => warning.text === "luobo IELTS"), {
    page: 39,
    text: "luobo IELTS",
    reason: "low-confidence; unparsed",
  });
});

test("fails before normalization can truncate a 900-character question", async () => {
  const { parseIeltsOcrPages } = await import(parserUrl.href);
  const question = `${"a".repeat(899)}?`;

  assert.throws(() => parseIeltsOcrPages([{
    page: 1,
    lines: [
      { text: "Part1", confidence: 1, x: 0.1, y: 0.9 },
      { text: "Long question", confidence: 1, x: 0.1, y: 0.8 },
      { text: question, confidence: 1, x: 0.1, y: 0.7 },
    ],
  }], { id: "ielts-test" }), /question exceeds 800 characters on page 1/i);
});

test("fails before normalization can drop a thirteenth cue point", async () => {
  const { parseIeltsOcrPages } = await import(parserUrl.href);
  const cuePoints = Array.from({ length: 13 }, (_, index) => ({
    text: `Cue point ${index + 1}`,
    confidence: 1,
    x: 0.1,
    y: 0.65 - index * 0.03,
  }));

  assert.throws(() => parseIeltsOcrPages([{
    page: 1,
    lines: [
      { text: "Part 2", confidence: 1, x: 0.1, y: 0.9 },
      { text: "Describe a place you remember", confidence: 1, x: 0.1, y: 0.8 },
      { text: "You should say:", confidence: 1, x: 0.1, y: 0.7 },
      ...cuePoints,
    ],
  }], { id: "ielts-test" }), /cue card has 13 points on page 1; maximum is 12/i);
});

test("rejects malformed, empty, and duplicate OCR structures", async () => {
  const { parseIeltsOcrPages } = await import(parserUrl.href);
  assert.throws(() => parseIeltsOcrPages({}, { id: "ielts-test" }), /pages must be a non-empty array/i);
  assert.throws(() => parseIeltsOcrPages([], { id: "ielts-test" }), /pages must be a non-empty array/i);
  assert.throws(() => parseIeltsOcrPages([{ page: 1, lines: [] }], { id: "ielts-test" }), /zero questions/i);
  assert.throws(() => parseIeltsOcrPages([{
    page: 1,
    lines: [
      { text: "Part1", confidence: 1, x: 0.1, y: 0.9 },
      { text: "Home", confidence: 1, x: 0.1, y: 0.8 },
      { text: "1. Do you like your home?", confidence: 1, x: 0.1, y: 0.7 },
      { text: "2. Do you like your home?", confidence: 1, x: 0.1, y: 0.6 },
    ],
  }], { id: "ielts-test" }), /duplicate question would be lost during normalization/i);
});

test("skips page margins while joining a wrapped question", async () => {
  const { parseIeltsOcrPages } = await import(parserUrl.href);
  const result = parseIeltsOcrPages([{
    page: 1,
    lines: [
      { text: "Part1", confidence: 1, x: 0.1, y: 0.9 },
      { text: "Home", confidence: 1, x: 0.1, y: 0.8 },
      { text: "1. What is the difference between your current home and", confidence: 1, x: 0.1, y: 0.1 },
      { text: "bilibili", confidence: 1, x: 0.1, y: 0.04 },
    ],
  }, {
    page: 2,
    lines: [
      { text: "IELTS", confidence: 1, x: 0.1, y: 0.99 },
      { text: "your previous home?", confidence: 1, x: 0.1, y: 0.9 },
    ],
  }], { id: "ielts-test" });

  assert.equal(
    result.questions[0].question,
    "What is the difference between your current home and your previous home?",
  );
  assert.deepEqual(result.warnings.filter((warning) => ["bilibili", "IELTS"].includes(warning.text)), [
    { page: 1, text: "bilibili", reason: "unparsed" },
    { page: 2, text: "IELTS", reason: "unparsed" },
  ]);
});

test("keeps the left edge first when OCR fragments share a visual row", async () => {
  const { parseIeltsOcrPages } = await import(parserUrl.href);
  const result = parseIeltsOcrPages([{
    page: 1,
    lines: [
      { text: "Part1", confidence: 1, x: 0.1, y: 0.9 },
      { text: "Messages", confidence: 1, x: 0.1, y: 0.8 },
      { text: "situations do people spend a long time responding to others'", confidence: 1, x: 0.3, y: 0.701 },
      { text: "1. In what", confidence: 1, x: 0.1, y: 0.7 },
      { text: "messages?", confidence: 1, x: 0.1, y: 0.68 },
    ],
  }], { id: "ielts-test" });

  assert.equal(
    result.questions[0].question,
    "In what situations do people spend a long time responding to others' messages?",
  );
});

test("applies an approved reviewed correction and stamps the bank", async () => {
  const { parseIeltsOcrPages } = await import(parserUrl.href);
  const completeFixture = pagesWithExpectedCount(fixture);
  const review = approvedReview(completeFixture, {
    corrections: [{
      operation: "replace",
      page: 2,
      original: "3. This numbered sentence has no question mark",
      replacement: "3. Is this a reviewed source question?",
    }],
  });
  const result = parseIeltsOcrPages(completeFixture, {
    id: "ielts-2026-09_12",
    season: "2026-09_12",
    review,
  });

  assert.ok(result.questions.some((item) => item.question === "Is this a reviewed source question?"));
  assert.deepEqual(result.approval, {
    status: "approved",
    schemaVersion: 1,
    sourcePdfSha256: "a".repeat(64),
    ocrSha256: digest(completeFixture),
    pageCount: 46,
    reviewedPageCount: 46,
    correctionsApplied: 1,
    reviewedAt: "2026-09-15T12:00:00.000Z",
  });
});

test("rejects an approved review that is self-consistent but omits page 46", async () => {
  const { parseIeltsOcrPages } = await import(parserUrl.href);
  const pages = Array.from({ length: 45 }, (_, index) => ({ page: index + 1, lines: [] }));

  assert.throws(
    () => parseIeltsOcrPages(pages, { review: approvedReview(pages) }),
    /expected 46 OCR pages numbered 1 through 46/i,
  );
});

test("complete-bank validation requires every Part 3 question to link to a cue card", async () => {
  const { parseIeltsOcrPages, validateCompleteIeltsBank } = await import(parserUrl.href);
  const completeFixture = pagesWithExpectedCount(fixture);
  const bank = parseIeltsOcrPages(completeFixture, {
    id: "ielts-test",
    review: approvedReview(completeFixture),
  });
  bank.questions.find((question) => question.part === "part3").parentCueCardId = null;

  assert.throws(() => validateCompleteIeltsBank(bank), /Part 3 question .*requires a parentCueCardId/i);
});

test("rejects chained corrections that target a replacement instead of original OCR", async () => {
  const { parseIeltsOcrPages } = await import(parserUrl.href);
  const completeFixture = pagesWithExpectedCount(fixture);
  const review = approvedReview(completeFixture, {
    corrections: [
      {
        operation: "replace",
        page: 2,
        original: "3. This numbered sentence has no question mark",
        replacement: "3. Is this a reviewed source question?",
      },
      {
        operation: "replace",
        page: 2,
        original: "3. Is this a reviewed source question?",
        replacement: "3. Is this a chained reviewed source question?",
      },
    ],
  });

  assert.throws(
    () => parseIeltsOcrPages(completeFixture, { review }),
    /must target one immutable original OCR line exactly once/i,
  );
});

test("CLI fails closed without complete approved review and all three Parts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ielts-parser-test-"));
  const input = path.join(directory, "ocr.json");
  const output = path.join(directory, "bank.json");
  const reviewPath = path.join(directory, "review.json");
  const completeFixture = pagesWithExpectedCount(fixture);
  fs.writeFileSync(input, JSON.stringify(completeFixture));

  const withoutReview = spawnSync(process.execPath, [parserPath, input, output], { encoding: "utf8" });
  assert.notEqual(withoutReview.status, 0);
  assert.match(withoutReview.stderr, /approved review artifact is required/i);
  assert.equal(fs.existsSync(output), false);

  fs.writeFileSync(reviewPath, JSON.stringify(approvedReview(completeFixture, {
    status: "draft",
  })));
  const draft = spawnSync(process.execPath, [parserPath, input, output, reviewPath], { encoding: "utf8" });
  assert.notEqual(draft.status, 0);
  assert.match(draft.stderr, /review status must be approved/i);
  assert.equal(fs.existsSync(output), false);

  const pendingPage = approvedReview(completeFixture);
  pendingPage.reviewedPages[1].status = "pending";
  fs.writeFileSync(reviewPath, JSON.stringify(pendingPage));
  const pending = spawnSync(process.execPath, [parserPath, input, output, reviewPath], { encoding: "utf8" });
  assert.notEqual(pending.status, 0);
  assert.match(pending.stderr, /Page 2 is not marked reviewed/i);
  assert.equal(fs.existsSync(output), false);

  const noPart3 = pagesWithExpectedCount(fixture.slice(0, 2));
  fs.writeFileSync(input, JSON.stringify(noPart3));
  fs.writeFileSync(reviewPath, JSON.stringify(approvedReview(noPart3)));
  const incomplete = spawnSync(process.execPath, [parserPath, input, output, reviewPath], { encoding: "utf8" });
  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /Part 3 count must be greater than zero/i);
  assert.equal(fs.existsSync(output), false);

  fs.rmSync(directory, { recursive: true, force: true });
});

test("complete-bank validation rejects a dangling Part 3 parent", async () => {
  const { parseIeltsOcrPages, validateCompleteIeltsBank } = await import(parserUrl.href);
  const completeFixture = pagesWithExpectedCount(fixture);
  const bank = parseIeltsOcrPages(completeFixture, {
    id: "ielts-test",
    review: approvedReview(completeFixture),
  });
  const part3 = bank.questions.find((question) => question.part === "part3");
  part3.parentCueCardId = "missing-cue-card";

  assert.throws(() => validateCompleteIeltsBank(bank), /dangling parentCueCardId/i);
});

test("CLI rejects non-array and zero-question input before writing output", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ielts-parser-test-"));
  const input = path.join(directory, "ocr.json");
  const output = path.join(directory, "bank.json");
  const reviewPath = path.join(directory, "review.json");

  fs.writeFileSync(input, JSON.stringify({ pages: [] }));
  fs.writeFileSync(reviewPath, JSON.stringify({ status: "approved" }));
  const malformed = spawnSync(process.execPath, [parserPath, input, output, reviewPath], { encoding: "utf8" });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /pages must be a non-empty array/i);
  assert.equal(fs.existsSync(output), false);

  const empty = pagesWithExpectedCount([{ page: 1, lines: [] }]);
  fs.writeFileSync(input, JSON.stringify(empty));
  fs.writeFileSync(reviewPath, JSON.stringify(approvedReview(empty)));
  const zero = spawnSync(process.execPath, [parserPath, input, output, reviewPath], { encoding: "utf8" });
  assert.notEqual(zero.status, 0);
  assert.match(zero.stderr, /zero questions/i);
  assert.equal(fs.existsSync(output), false);

  fs.rmSync(directory, { recursive: true, force: true });
});

test("CLI writes only a complete approved bank with valid parent links", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ielts-parser-test-"));
  const input = path.join(directory, "ocr.json");
  const output = path.join(directory, "bank.json");
  const reviewPath = path.join(directory, "review.json");
  const completeFixture = pagesWithExpectedCount(fixture);
  fs.writeFileSync(input, JSON.stringify(completeFixture));
  fs.writeFileSync(reviewPath, JSON.stringify(approvedReview(completeFixture)));

  const result = spawnSync(process.execPath, [parserPath, input, output, reviewPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const bank = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(bank.approval.status, "approved");
  assert.ok(["part1", "part2", "part3"].every((part) => (
    bank.questions.some((question) => question.part === part)
  )));
  const ids = new Set(bank.questions.map((question) => question.id));
  assert.ok(bank.questions.every((question) => (
    !question.parentCueCardId || ids.has(question.parentCueCardId)
  )));

  fs.rmSync(directory, { recursive: true, force: true });
});

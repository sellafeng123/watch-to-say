const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const questionBank = require("../question-bank.js");
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, "fixtures/ielts-ocr-sample.json"),
  "utf8",
));

const parserUrl = pathToFileURL(path.join(__dirname, "../scripts/parse-ielts-ocr.mjs"));

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

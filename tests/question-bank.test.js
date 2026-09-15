const test = require("node:test");
const assert = require("node:assert/strict");

const bank = require("../question-bank.js");

function learnerQuestion(overrides = {}) {
  return {
    part: null,
    topic: "Morning routines",
    question: "How do you start your day?",
    cuePoints: [],
    ...overrides,
  };
}

function learnerBank(overrides = {}) {
  return bank.normalizeBank({
    id: "learner-bank",
    name: "My questions",
    source: "learner_bank",
    profiles: ["daily"],
    questions: [learnerQuestion()],
    ...overrides,
  });
}

test("makes stable IDs from normalized part topic and exact question text", () => {
  const first = bank.makeQuestionId({
    bankId: "bank-1",
    part: "part1",
    topic: " Home ",
    question: " Do you like\n your home? ",
  });
  const same = bank.makeQuestionId({
    bankId: "bank-1",
    part: "part1",
    topic: "Home",
    question: "Do you like your home?",
  });
  const changed = bank.makeQuestionId({
    bankId: "bank-1",
    part: "part1",
    topic: "Home",
    question: "Do you enjoy your home?",
  });

  assert.equal(first, same);
  assert.notEqual(first, changed);
});

test("strips malformed Parts profiles and unknown question properties", () => {
  const normalized = bank.normalizeBank({
    id: "learner-bank",
    name: "  Questions  ",
    source: "learner_bank",
    profiles: ["daily", "unknown", "daily", 42],
    questions: [
      {
        part: "part9",
        topic: "  Morning routines ",
        question: " How do you start your day? ",
        cuePoints: ["  After breakfast "],
        unexpected: "discard me",
      },
    ],
    unexpected: true,
  });

  assert.deepEqual(normalized.profiles, ["daily"]);
  assert.deepEqual(normalized.questions[0], {
    id: normalized.questions[0].id,
    bankId: "learner-bank",
    source: "learner_bank",
    profiles: ["daily"],
    part: null,
    topic: "Morning routines",
    question: "How do you start your day?",
    cuePoints: ["After breakfast"],
    parentCueCardId: null,
    season: "",
    createdAt: 0,
  });
  assert.equal(Object.hasOwn(normalized.questions[0], "unexpected"), false);
});

test("rejects a model-rewritten question that was not in the pasted source", () => {
  const parsed = bank.validateParsedBank({
    label: "AI 题库识别",
    questions: [{ part: "part1", topic: "Home", question: "Do you enjoy your home?", cuePoints: [] }],
    unrecognized: [],
  }, { name: "My bank", profiles: ["ielts"] }, "Do you like your home?");
  assert.equal(parsed, null);
});

test("validates whitespace-normalized imported question and cue points from the paste", () => {
  const parsed = bank.validateParsedBank({
    label: "AI 题库识别",
    questions: [{
      part: "part2",
      topic: "A place",
      question: "Describe\n a place you enjoy visiting.",
      cuePoints: ["Where it is", "Why you like it"],
      invented: "discard me",
    }],
    unrecognized: ["A heading the model could not parse", 3],
  }, { id: "learner-bank", name: "My bank", profiles: ["ielts", "invalid"] }, `
    Describe a place you enjoy visiting.
    You should say:
    - Where it is
    - Why you like it
  `);

  assert.deepEqual(parsed, {
    bank: {
      id: "learner-bank",
      name: "My bank",
      source: "learner_bank",
      profiles: ["ielts"],
      questions: [{
        id: parsed.bank.questions[0].id,
        bankId: "learner-bank",
        source: "learner_bank",
        profiles: ["ielts"],
        part: "part2",
        topic: "A place",
        question: "Describe a place you enjoy visiting.",
        cuePoints: ["Where it is", "Why you like it"],
        parentCueCardId: null,
        season: "",
        createdAt: 0,
      }],
    },
    unrecognized: ["A heading the model could not parse"],
  });
});

test("IELTS source modes only return stored bundled or learner questions", () => {
  const bundledBank = bank.normalizeBank({
    id: "bundled-bank",
    source: "bundled_ielts",
    profiles: ["ielts"],
    questions: [learnerQuestion({ topic: "Home", question: "Do you like your hometown?" })],
  });
  const mine = learnerBank({ profiles: ["ielts"] });
  const generated = bank.normalizeQuestion(learnerQuestion({
    source: "deepseek",
    profiles: ["ielts"],
    question: "What do you enjoy at home?",
  }), { id: "generated", source: "deepseek", profiles: ["ielts"] });

  const bundled = bank.eligibleQuestions({
    banks: [mine, { questions: [generated] }], bundledBank, profile: "ielts", sourceMode: "bundled",
    usedQuestionIds: [],
  });
  const mixed = bank.eligibleQuestions({
    banks: [mine, { questions: [generated] }], bundledBank, profile: "ielts", sourceMode: "bundled_plus_mine",
    usedQuestionIds: [],
  });

  assert.deepEqual(bundled.map((question) => question.source), ["bundled_ielts"]);
  assert.deepEqual(mixed.map((question) => question.source).sort(), ["bundled_ielts", "learner_bank"]);
});

test("mine only excludes bundled and generated questions", () => {
  const mine = learnerBank();
  const bundledBank = bank.normalizeBank({
    id: "bundled-bank", source: "bundled_ielts", profiles: ["daily"],
    questions: [learnerQuestion({ question: "Bundled question?" })],
  });
  const generated = bank.normalizeQuestion(learnerQuestion({ source: "deepseek", question: "Generated question?" }), {
    id: "generated", source: "deepseek", profiles: ["daily"],
  });

  const result = bank.eligibleQuestions({
    banks: [mine, { questions: [generated] }], bundledBank, profile: "daily", sourceMode: "mine_only",
    usedQuestionIds: [],
  });

  assert.deepEqual(result.map((question) => question.source), ["learner_bank"]);
});

test("general questions serve non-IELTS profiles and used IDs are excluded", () => {
  const general = learnerBank({ profiles: ["general"] });

  for (const profile of ["work", "daily", "travel"]) {
    const result = bank.eligibleQuestions({
      banks: [general], bundledBank: null, profile, sourceMode: "smart_mix", usedQuestionIds: [],
    });
    assert.equal(result.length, 1, profile);
  }
  assert.deepEqual(bank.eligibleQuestions({
    banks: [general], bundledBank: null, profile: "ielts", sourceMode: "bundled_plus_mine", usedQuestionIds: [],
  }), []);
  assert.deepEqual(bank.eligibleQuestions({
    banks: [general], bundledBank: null, profile: "daily", sourceMode: "smart_mix",
    usedQuestionIds: [general.questions[0].id],
  }), []);
});

test("ranks overlap first then uses deterministic IDs and never returns more than forty", () => {
  const questions = Array.from({ length: 45 }, (_, index) => ({
    id: `q-${String(45 - index).padStart(2, "0")}`,
    topic: index === 44 ? "Coffee habits" : `Topic ${index}`,
    question: index === 44 ? "How does coffee help your work day?" : `Question ${index}?`,
  }));

  const result = bank.rankCandidates({
    questions,
    expressions: [{
      expression: "coffee",
      usageContexts: "work",
      sourceExamples: ["Coffee helps me focus at work."],
    }],
    limit: 400,
  });

  assert.equal(result.length, 40);
  assert.equal(result[0].id, "q-01");
  assert.deepEqual(result.slice(1).map((question) => question.id),
    result.slice(1).map((question) => question.id).slice().sort());
});

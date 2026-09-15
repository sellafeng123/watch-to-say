const YTD_QUESTION_BANK = (() => {
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

  const PROFILES = new Set(["ielts", "work", "daily", "travel", "general"]);
  const PARTS = new Set(["part1", "part2", "part3"]);
  const SOURCES = new Set(["bundled_ielts", "learner_bank", "deepseek"]);

  function normalizeWhitespace(value, maxLength = LIMITS.maxQuestionChars) {
    return typeof value === "string"
      ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
      : "";
  }

  function normalizeProfiles(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((profile) => PROFILES.has(profile)))];
  }

  function normalizeSource(value, fallback = "learner_bank") {
    return SOURCES.has(value) ? value : fallback;
  }

  function hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  function makeQuestionId(record = {}) {
    const bankId = normalizeWhitespace(record.bankId, 160) || "bank";
    const part = PARTS.has(record.part) ? record.part : "general";
    const topic = normalizeWhitespace(record.topic);
    const question = normalizeWhitespace(record.question);
    return `question-${hash([bankId, part, topic, question].join("\u001f"))}`;
  }

  function normalizeCuePoints(value) {
    if (!Array.isArray(value)) return [];
    return value
      .slice(0, LIMITS.maxCuePoints)
      .map((cuePoint) => normalizeWhitespace(cuePoint, LIMITS.maxCuePointChars))
      .filter(Boolean);
  }

  function normalizeQuestion(record, bank = {}) {
    if (!record || typeof record !== "object") return null;
    const bankId = normalizeWhitespace(record.bankId || bank.id, 160);
    const question = normalizeWhitespace(record.question);
    if (!bankId || !question) return null;
    const bankProfiles = normalizeProfiles(bank.profiles);
    const profiles = normalizeProfiles(record.profiles);
    const source = normalizeSource(record.source, normalizeSource(bank.source));
    const createdAt = Number.isFinite(record.createdAt)
      ? Math.max(0, Math.floor(record.createdAt))
      : Number.isFinite(bank.createdAt)
        ? Math.max(0, Math.floor(bank.createdAt))
        : 0;
    return {
      id: makeQuestionId({ bankId, part: record.part, topic: record.topic, question }),
      bankId,
      source,
      profiles: profiles.length ? profiles : bankProfiles,
      part: PARTS.has(record.part) ? record.part : null,
      topic: normalizeWhitespace(record.topic),
      question,
      cuePoints: normalizeCuePoints(record.cuePoints),
      parentCueCardId: normalizeWhitespace(record.parentCueCardId, 160) || null,
      season: normalizeWhitespace(record.season, 100),
      createdAt,
    };
  }

  function makeBankId(record = {}) {
    const name = normalizeWhitespace(record.name);
    const source = normalizeSource(record.source);
    const profiles = normalizeProfiles(record.profiles);
    return `bank-${hash([name, source, ...profiles].join("\u001f"))}`;
  }

  function normalizeBank(record) {
    if (!record || typeof record !== "object") return null;
    const id = normalizeWhitespace(record.id, 160) || makeBankId(record);
    const source = normalizeSource(record.source);
    const profiles = normalizeProfiles(record.profiles);
    const createdAt = Number.isFinite(record.createdAt)
      ? Math.max(0, Math.floor(record.createdAt))
      : 0;
    const bank = {
      id,
      name: normalizeWhitespace(record.name),
      source,
      profiles,
      createdAt,
    };
    const seen = new Set();
    const questions = (Array.isArray(record.questions) ? record.questions : [])
      .slice(0, LIMITS.maxQuestionsPerBank)
      .map((question) => normalizeQuestion(question, bank))
      .filter((question) => question && !seen.has(question.id) && seen.add(question.id));
    return {
      id,
      name: bank.name,
      source,
      profiles,
      questions,
    };
  }

  function normalizeSourceMode(profile, value) {
    const normalizedProfile = Object.hasOwn(PROFILE_SOURCE_MODES, profile)
      ? profile
      : "ielts";
    const modes = PROFILE_SOURCE_MODES[normalizedProfile];
    return modes.includes(value) ? value : modes[0];
  }

  function isProfileEligible(question, profile) {
    if (!question.profiles.includes(profile)) {
      return profile !== "ielts" && question.profiles.includes("general");
    }
    return true;
  }

  function sourceAllowed(sourceMode, profile, source) {
    if (profile === "ielts") {
      return sourceMode === "bundled"
        ? source === "bundled_ielts"
        : source === "bundled_ielts" || source === "learner_bank";
    }
    return sourceMode !== "ai_only" && source === "learner_bank";
  }

  function eligibleQuestions({ banks, bundledBank, profile, sourceMode, usedQuestionIds } = {}) {
    const normalizedProfile = Object.hasOwn(PROFILE_SOURCE_MODES, profile)
      ? profile
      : "ielts";
    const normalizedMode = normalizeSourceMode(normalizedProfile, sourceMode);
    const used = new Set(Array.isArray(usedQuestionIds) ? usedQuestionIds : []);
    const sourceBanks = [];
    if (bundledBank) sourceBanks.push(bundledBank);
    if (Array.isArray(banks)) sourceBanks.push(...banks.slice(0, LIMITS.maxBanks));

    const seen = new Set();
    return sourceBanks
      .flatMap((candidate) => {
        const normalized = normalizeBank(candidate);
        return normalized ? normalized.questions : [];
      })
      .filter((question) => (
        !used.has(question.id)
        && !seen.has(question.id)
        && seen.add(question.id)
        && isProfileEligible(question, normalizedProfile)
        && sourceAllowed(normalizedMode, normalizedProfile, question.source)
      ))
      .sort((first, second) => first.id.localeCompare(second.id));
  }

  function tokenize(value) {
    const normalized = normalizeWhitespace(value, LIMITS.maxPasteChars).toLowerCase();
    const tokens = normalized.match(/[a-z0-9]+|[\u3400-\u9fff]/g) || [];
    return new Set(tokens);
  }

  function textFromExamples(value) {
    if (typeof value === "string") return [value];
    if (!Array.isArray(value)) return [];
    return value.flatMap((example) => {
      if (typeof example === "string") return [example];
      if (!example || typeof example !== "object") return [];
      return [example.text, example.context, example.example, example.sourceText]
        .filter((text) => typeof text === "string");
    });
  }

  function expressionTokens(expressions) {
    const tokens = new Set();
    for (const expression of Array.isArray(expressions) ? expressions : []) {
      if (!expression || typeof expression !== "object") continue;
      const text = [
        expression.expression,
        expression.usageContexts,
        expression.sourceExample,
        expression.context,
        ...textFromExamples(expression.sourceExamples),
      ];
      for (const item of text) {
        for (const token of tokenize(item)) tokens.add(token);
      }
    }
    return tokens;
  }

  function rankCandidates({ questions, expressions, limit } = {}) {
    const maximum = Math.min(
      LIMITS.maxCandidates,
      Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : LIMITS.maxCandidates,
    );
    const terms = expressionTokens(expressions);
    return (Array.isArray(questions) ? questions : [])
      .map((question, index) => {
        const questionTokens = tokenize(`${question?.topic || ""} ${question?.question || ""}`);
        let score = 0;
        for (const token of questionTokens) {
          if (terms.has(token)) score += 1;
        }
        return { question, index, score, id: normalizeWhitespace(question?.id, 200) };
      })
      .filter(({ question, id }) => question && id)
      .sort((first, second) => (
        second.score - first.score
        || first.id.localeCompare(second.id)
        || first.index - second.index
      ))
      .slice(0, maximum)
      .map(({ question }) => question);
  }

  function validateParsedBank(raw, draft, sourceText) {
    if (!raw || raw.label !== "AI 题库识别" || typeof sourceText !== "string") return null;
    const normalizedSource = normalizeWhitespace(sourceText, LIMITS.maxPasteChars);
    if (!normalizedSource || sourceText.length > LIMITS.maxPasteChars) return null;
    const profiles = normalizeProfiles(draft?.profiles);
    if (!profiles.length) return null;
    const bank = normalizeBank({
      id: draft?.id,
      name: draft?.name,
      source: "learner_bank",
      profiles,
      questions: [],
    });
    const seen = new Set();
    const questions = [];
    for (const record of (Array.isArray(raw.questions) ? raw.questions : []).slice(0, LIMITS.maxQuestionsPerBank)) {
      const question = normalizeQuestion(record, bank);
      if (!question || seen.has(question.id)) continue;
      if (!normalizedSource.includes(question.question)) continue;
      if (!question.cuePoints.every((cuePoint) => normalizedSource.includes(cuePoint))) continue;
      seen.add(question.id);
      questions.push(question);
    }
    if (!questions.length) return null;
    return {
      bank: { ...bank, questions },
      unrecognized: (Array.isArray(raw.unrecognized) ? raw.unrecognized : [])
        .slice(0, LIMITS.maxQuestionsPerBank)
        .map((fragment) => normalizeWhitespace(fragment))
        .filter(Boolean),
    };
  }

  return {
    STORAGE_KEY,
    LIMITS,
    PROFILE_SOURCE_MODES,
    normalizeQuestion,
    normalizeBank,
    makeQuestionId,
    normalizeSourceMode,
    eligibleQuestions,
    rankCandidates,
    validateParsedBank,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_QUESTION_BANK;
}

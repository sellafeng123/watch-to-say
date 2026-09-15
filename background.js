/**
 * BACKGROUND SERVICE WORKER
 *
 * This is the "brain" of the extension. It runs in the background and handles:
 * 1. Opening the side panel when the user clicks the extension icon
 * 2. Fetching YouTube transcripts via Supadata API
 * 3. Calling DeepSeek to analyze the transcript
 * 4. Sending results back to the side panel
 *
 * Think of it like a backend server — it does the heavy lifting
 * so the UI (side panel) can stay fast and responsive.
 */

// Import safe defaults and validation helpers. Secret keys live in
// chrome.storage.local and are never part of the extension source.
importScripts("settings.js", "corpus.js", "practice-session.js", "question-bank.js");

const DEBUG = false;
const AI_PROVIDER_IDLE_TIMEOUT_MS = 50_000;
const AI_PROVIDER_HARD_TIMEOUT_MS = 120_000;
const AI_PROVIDER_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CORPUS_VIDEO_NOTES_KEY = "ytd_corpus_video_notes";
const CORPUS_EXPORTS_KEY = "ytd_corpus_exports";
const PRACTICE_HIGHLIGHTS_KEY = "ytd_practice_highlights_v1";
const QUESTION_BANK_PREVIEWS_KEY = "ytd_question_bank_previews_v1";
const QUESTION_BANK_IMPORT_CHUNK_CHARS = 12_000;
const QUESTION_BANK_IMPORT_CONCURRENCY = 3;
const QUESTION_BANK_PREVIEW_TTL_MS = 30 * 60 * 1000;
const QUESTION_BANK_NAME_CHARS = 120;
const DEFAULT_QUESTION_BANK_NAME = "Learner question bank";
const BUNDLED_IELTS_BANK_PATH = "data/ielts-question-bank.local.json";
const BUNDLED_IELTS_REVIEWED_PAGE_COUNT = 46;
const QUESTION_BANK_PROFILES = new Set(["ielts", "work", "daily", "travel", "general"]);
const QUESTION_BANK_MESSAGE_ACTIONS = new Set([
  "previewQuestionBankImport",
  "saveQuestionBank",
  "renameQuestionBank",
  "listQuestionBanks",
  "deleteQuestionBank",
  "getPracticeQuestionSources",
]);
let questionBankMutationQueue = Promise.resolve();
let bundledIeltsBankPromise;
let activeQuestionBankAiCalls = 0;
const questionBankAiWaiters = [];
const debugLog = (...args) => {
  if (DEBUG) console.log(...args);
};

// Prevent the YouTube content script from reading API keys or cached data.
// Side panel, options, and service-worker contexts remain trusted.
chrome.storage.local
  .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
  .catch((error) =>
    console.warn("[YouTube Digest] Could not restrict storage access:", error),
  );

async function getSettings() {
  const stored = await chrome.storage.local.get(YTD_SETTINGS.STORAGE_KEY);
  return YTD_SETTINGS.normalize(stored[YTD_SETTINGS.STORAGE_KEY]);
}

const promptFileCache = new Map();

async function loadPromptSection(fileName, heading, variables = {}) {
  let markdown = promptFileCache.get(fileName);
  if (!markdown) {
    const response = await fetch(chrome.runtime.getURL(`prompts/${fileName}`));
    if (!response.ok) {
      throw new Error(`Could not load prompt file: ${fileName}`);
    }
    markdown = await response.text();
    promptFileCache.set(fileName, markdown);
  }

  const marker = `## ${heading}`;
  const markerIndex = markdown.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Prompt section not found: ${fileName}#${heading}`);
  }
  const sectionStart = markerIndex + marker.length;
  const nextSection = markdown.indexOf("\n## ", sectionStart);
  const section = markdown.slice(
    sectionStart,
    nextSection === -1 ? markdown.length : nextSection,
  );
  const fenceMatch = section.match(/```(?:[A-Za-z0-9_-]+)?\n([\s\S]*?)\n```/);
  if (!fenceMatch) {
    throw new Error(`Prompt section not found: ${fileName}#${heading}`);
  }

  let prompt = fenceMatch[1];
  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.split(`{${key}}`).join(String(value ?? ""));
  }
  return prompt;
}

async function requestAiCompletion({
  messages,
  maxTokens,
  temperature,
  responseFormat,
}) {
  const settings = await getSettings();
  if (!settings.aiApiKey) {
    const error = new Error(
      "DeepSeek API key not configured. Open YouTube Digest Settings.",
    );
    error.code = "NO_AI_KEY";
    throw error;
  }
  const body = {
    model: settings.aiModel,
    max_tokens: maxTokens,
    messages,
  };
  if (typeof temperature === "number") body.temperature = temperature;
  if (responseFormat) {
    body.response_format = responseFormat;
  }
  // Product features need bounded, predictable latency rather than reasoning traces.
  body.thinking = { type: "disabled" };

  const controller = new AbortController();
  let timeoutKind = "";
  let idleTimeoutId;
  let hardTimeoutId;
  const abortForTimeout = (kind) => {
    if (controller.signal.aborted) return;
    timeoutKind = kind;
    controller.abort();
  };
  const resetIdleTimeout = () => {
    clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(
      () => abortForTimeout("idle"),
      AI_PROVIDER_IDLE_TIMEOUT_MS,
    );
  };

  hardTimeoutId = setTimeout(
    () => abortForTimeout("hard"),
    AI_PROVIDER_HARD_TIMEOUT_MS,
  );
  resetIdleTimeout();
  try {
    const response = await fetch(
      YTD_SETTINGS.chatCompletionsUrl(),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.aiApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    // Receiving headers proves DeepSeek is still making progress. DeepSeek
    // may then send blank-line body chunks while a non-streaming request queues.
    resetIdleTimeout();

    const data = await readBoundedAiResponse(response, resetIdleTimeout);
    if (!response.ok) {
      const errorData = data && typeof data === "object" ? data : {};
      const error = new Error(
        errorData.error?.message ||
          errorData.message ||
          `DeepSeek error: ${response.status}`,
      );
      error.status = response.status;
      throw error;
    }

    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
      const error = new Error("DeepSeek returned an empty response.");
      error.code = "EMPTY_AI_RESPONSE";
      throw error;
    }

    return { text, settings };
  } catch (error) {
    if (timeoutKind === "idle") {
      const timeoutError = new Error(
        "DeepSeek request was inactive for 50 seconds. Please Retry.",
      );
      timeoutError.code = "AI_IDLE_TIMEOUT";
      throw timeoutError;
    }
    if (timeoutKind === "hard") {
      const timeoutError = new Error(
        "DeepSeek request exceeded the 120-second limit. Please Retry.",
      );
      timeoutError.code = "AI_HARD_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(idleTimeoutId);
    clearTimeout(hardTimeoutId);
  }
}

function questionBankError(error) {
  return { success: false, error };
}

function cleanQuestionBankText(value, limit) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, limit)
    : "";
}

function normalizeQuestionBankProfiles(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((profile) => QUESTION_BANK_PROFILES.has(profile)))];
}

function makeQuestionBankToken() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  const error = new Error("Secure random tokens are unavailable.");
  error.code = "TOKEN_GENERATION_FAILED";
  throw error;
}

function splitQuestionBankSource(sourceText) {
  const chunks = [];
  let current = "";
  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };
  const append = (piece) => {
    if (!piece) return;
    const separator = current ? "\n\n" : "";
    if (current.length + separator.length + piece.length <= QUESTION_BANK_IMPORT_CHUNK_CHARS) {
      current += separator + piece;
      return;
    }
    flush();
    current = piece;
  };

  for (const paragraph of sourceText.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    let remaining = paragraph.trim();
    while (remaining.length > QUESTION_BANK_IMPORT_CHUNK_CHARS) {
      let splitAt = remaining.lastIndexOf("\n", QUESTION_BANK_IMPORT_CHUNK_CHARS);
      if (splitAt < QUESTION_BANK_IMPORT_CHUNK_CHARS / 2) {
        splitAt = remaining.lastIndexOf(" ", QUESTION_BANK_IMPORT_CHUNK_CHARS);
      }
      if (splitAt < QUESTION_BANK_IMPORT_CHUNK_CHARS / 2) {
        splitAt = QUESTION_BANK_IMPORT_CHUNK_CHARS;
      }
      append(remaining.slice(0, splitAt).trim());
      flush();
      remaining = remaining.slice(splitAt).trimStart();
    }
    append(remaining);
  }
  flush();
  return chunks;
}

async function mapWithQuestionBankConcurrency(items, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const workerCount = Math.min(QUESTION_BANK_IMPORT_CONCURRENCY, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => run()));
  return results;
}

async function withQuestionBankAiSlot(operation) {
  if (activeQuestionBankAiCalls >= QUESTION_BANK_IMPORT_CONCURRENCY) {
    await new Promise((resolve) => questionBankAiWaiters.push(resolve));
  } else {
    activeQuestionBankAiCalls += 1;
  }
  try {
    return await operation();
  } finally {
    const next = questionBankAiWaiters.shift();
    if (next) {
      next();
    } else {
      activeQuestionBankAiCalls -= 1;
    }
  }
}

function withQuestionBankMutation(operation) {
  const result = questionBankMutationQueue.then(operation, operation);
  questionBankMutationQueue = result.catch(() => {});
  return result;
}

function normalizeStoredLearnerBanks(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map((bank) => YTD_QUESTION_BANK.normalizeBank(bank))
    .filter((bank) => (
      bank
      && bank.source === "learner_bank"
      && bank.id
      && bank.name
      && bank.questions.length
      && !seen.has(bank.id)
      && seen.add(bank.id)
    ));
}

function boundedRawQuestionBankCollection(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > YTD_QUESTION_BANK.LIMITS.maxBanks) {
    return null;
  }
  return value;
}

function sameStringArray(first, second) {
  return Array.isArray(first)
    && first.length === second.length
    && first.every((value, index) => value === second[index]);
}

function normalizeValidatedLearnerBank(raw) {
  const normalized = YTD_QUESTION_BANK.normalizeBank(raw);
  if (
    !normalized
    || raw?.id !== normalized.id
    || raw.name !== normalized.name
    || raw.source !== "learner_bank"
    || !sameStringArray(raw.profiles, normalized.profiles)
    || !Array.isArray(raw.questions)
    || !normalized.questions.length
    || raw.questions.length !== normalized.questions.length
  ) {
    return null;
  }
  for (let index = 0; index < raw.questions.length; index += 1) {
    const original = raw.questions[index];
    const question = normalized.questions[index];
    if (
      original?.id !== question.id
      || original.bankId !== question.bankId
      || original.source !== question.source
      || !sameStringArray(original.profiles, question.profiles)
      || original.part !== question.part
      || original.topic !== question.topic
      || original.question !== question.question
      || !sameStringArray(original.cuePoints, question.cuePoints)
      || original.parentCueCardId !== question.parentCueCardId
      || original.season !== question.season
      || original.createdAt !== question.createdAt
    ) {
      return null;
    }
  }
  return normalized;
}

function findStoredLearnerBank(rawBanks, bankId) {
  const matches = rawBanks
    .map((bank, index) => ({ bank, index }))
    .filter(({ bank }) => bank?.id === bankId);
  if (matches.length > 1) return { error: "QUESTION_BANK_STORAGE_CORRUPT" };
  if (matches.length === 0) return { error: "QUESTION_BANK_NOT_FOUND" };
  const { bank: raw, index } = matches[0];
  const normalized = normalizeValidatedLearnerBank(raw);
  if (!normalized || normalized.id !== bankId) {
    return { error: "QUESTION_BANK_STORAGE_CORRUPT" };
  }
  return { raw, normalized, index };
}

function questionBankMetadata(bank) {
  const partCounts = { part1: 0, part2: 0, part3: 0, general: 0 };
  for (const question of bank.questions) {
    partCounts[question.part || "general"] += 1;
  }
  return {
    id: bank.id,
    name: bank.name,
    source: bank.source,
    profiles: [...bank.profiles],
    questionCount: bank.questions.length,
    partCounts,
  };
}

function validateRecognizedQuestionBankChunk(raw, draft, sourceText) {
  if (
    !raw
    || raw.label !== "AI 题库识别"
    || !Array.isArray(raw.questions)
    || raw.questions.length === 0
    || raw.questions.length > YTD_QUESTION_BANK.LIMITS.maxQuestionsPerBank
    || !Array.isArray(raw.unrecognized)
    || raw.unrecognized.length > YTD_QUESTION_BANK.LIMITS.maxQuestionsPerBank
  ) {
    return null;
  }
  const seenQuestions = new Set();
  for (const record of raw.questions) {
    const normalizedQuestion = cleanQuestionBankText(
      record?.question,
      YTD_QUESTION_BANK.LIMITS.maxQuestionChars,
    );
    if (
      !record
      || typeof record !== "object"
      || ![null, "part1", "part2", "part3"].includes(record.part)
      || typeof record.topic !== "string"
      || !cleanQuestionBankText(record.topic, YTD_QUESTION_BANK.LIMITS.maxQuestionChars)
      || record.topic.length > YTD_QUESTION_BANK.LIMITS.maxQuestionChars
      || typeof record.question !== "string"
      || !normalizedQuestion
      || record.question.length > YTD_QUESTION_BANK.LIMITS.maxQuestionChars
      || seenQuestions.has(normalizedQuestion)
      || !Array.isArray(record.cuePoints)
      || record.cuePoints.length > YTD_QUESTION_BANK.LIMITS.maxCuePoints
      || record.cuePoints.some((cuePoint) => (
        typeof cuePoint !== "string"
        || !cleanQuestionBankText(cuePoint, YTD_QUESTION_BANK.LIMITS.maxCuePointChars)
        || cuePoint.length > YTD_QUESTION_BANK.LIMITS.maxCuePointChars
      ))
    ) {
      return null;
    }
    seenQuestions.add(normalizedQuestion);
  }
  if (raw.unrecognized.some((fragment) => (
    typeof fragment !== "string"
    || !cleanQuestionBankText(fragment, YTD_QUESTION_BANK.LIMITS.maxQuestionChars)
    || fragment.length > YTD_QUESTION_BANK.LIMITS.maxQuestionChars
  ))) {
    return null;
  }
  const parsed = YTD_QUESTION_BANK.validateParsedBank(raw, draft, sourceText);
  if (
    !parsed
    || parsed.bank.questions.length !== raw.questions.length
    || parsed.unrecognized.length !== raw.unrecognized.length
  ) {
    return null;
  }
  return parsed;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const result = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function validateBundledIeltsBank(raw) {
  const approval = raw?.approval;
  if (
    !raw
    || raw.source !== "bundled_ielts"
    || !Array.isArray(raw.profiles)
    || raw.profiles.length !== 1
    || raw.profiles[0] !== "ielts"
    || !Array.isArray(raw.questions)
    || raw.questions.length < 3
    || raw.questions.length > YTD_QUESTION_BANK.LIMITS.maxQuestionsPerBank
    || approval?.status !== "approved"
    || approval.schemaVersion !== 1
    || approval.pageCount !== BUNDLED_IELTS_REVIEWED_PAGE_COUNT
    || approval.reviewedPageCount !== approval.pageCount
    || !Number.isInteger(approval.correctionsApplied)
    || approval.correctionsApplied < 0
    || !/^[a-f0-9]{64}$/i.test(approval.sourcePdfSha256 || "")
    || !/^[a-f0-9]{64}$/i.test(approval.ocrSha256 || "")
    || !/^[a-f0-9]{64}$/i.test(approval.bankSha256 || "")
    || !Number.isFinite(Date.parse(approval.reviewedAt || ""))
  ) {
    return null;
  }
  const normalized = YTD_QUESTION_BANK.normalizeBank(raw);
  if (
    !normalized
    || !normalized.id
    || !normalized.name
    || raw.id !== normalized.id
    || raw.name !== normalized.name
    || normalized.questions.length !== raw.questions.length
  ) {
    return null;
  }
  const byId = new Map(normalized.questions.map((question) => [question.id, question]));
  const counts = { part1: 0, part2: 0, part3: 0 };
  for (let index = 0; index < raw.questions.length; index += 1) {
    const original = raw.questions[index];
    const question = normalized.questions[index];
    if (
      !original
      || original.id !== question?.id
      || original.bankId !== normalized.id
      || original.source !== "bundled_ielts"
      || !Array.isArray(original.profiles)
      || original.profiles.length !== 1
      || original.profiles[0] !== "ielts"
      || !Object.hasOwn(counts, original.part)
      || original.topic !== question.topic
      || original.question !== question.question
      || !Array.isArray(original.cuePoints)
      || original.cuePoints.length !== question.cuePoints.length
      || original.cuePoints.some((cuePoint, cueIndex) => cuePoint !== question.cuePoints[cueIndex])
      || original.parentCueCardId !== question.parentCueCardId
      || original.season !== question.season
      || original.createdAt !== question.createdAt
    ) {
      return null;
    }
    counts[original.part] += 1;
  }
  if (Object.values(counts).some((count) => count === 0)) return null;
  for (const question of normalized.questions) {
    if (question.part === "part3" && !question.parentCueCardId) return null;
    if (!question.parentCueCardId) continue;
    const parent = byId.get(question.parentCueCardId);
    if (!parent || parent.part !== "part2") return null;
  }
  if (await sha256Hex(JSON.stringify(normalized)) !== approval.bankSha256) {
    return null;
  }
  return normalized;
}

async function loadBundledIeltsBank() {
  if (!bundledIeltsBankPromise) {
    bundledIeltsBankPromise = (async () => {
      try {
        const response = await fetch(chrome.runtime.getURL(BUNDLED_IELTS_BANK_PATH));
        if (!response.ok) return null;
        return await validateBundledIeltsBank(await response.json());
      } catch (error) {
        debugLog("[YouTube Digest] Optional IELTS bank unavailable:", error);
        return null;
      }
    })();
  }
  return bundledIeltsBankPromise;
}

async function previewQuestionBankImport(draft = {}) {
  if (typeof draft.sourceText !== "string" || !draft.sourceText.trim()) {
    return questionBankError("INVALID_SOURCE_TEXT");
  }
  if (draft.sourceText.length > YTD_QUESTION_BANK.LIMITS.maxPasteChars) {
    return questionBankError("PASTE_TOO_LARGE");
  }
  const name = cleanQuestionBankText(draft.name, QUESTION_BANK_NAME_CHARS)
    || DEFAULT_QUESTION_BANK_NAME;
  const profiles = normalizeQuestionBankProfiles(draft.profiles);
  if (!profiles.length) return questionBankError("INVALID_BANK_PROFILES");

  let replaceBankId = null;
  let bankId = `learner-${makeQuestionBankToken()}`;
  if (draft.replaceBankId != null) {
    replaceBankId = cleanQuestionBankText(draft.replaceBankId, 160);
    const stored = await chrome.storage.local.get(YTD_QUESTION_BANK.STORAGE_KEY);
    const banks = boundedRawQuestionBankCollection(stored[YTD_QUESTION_BANK.STORAGE_KEY]);
    if (!banks) return questionBankError("QUESTION_BANK_STORAGE_CORRUPT");
    const existing = replaceBankId ? findStoredLearnerBank(banks, replaceBankId) : null;
    if (!replaceBankId || existing?.error) {
      return questionBankError(existing?.error || "QUESTION_BANK_NOT_FOUND");
    }
    bankId = existing.normalized.id;
  }

  try {
    const chunks = splitQuestionBankSource(draft.sourceText);
    const systemPrompt = await loadPromptSection("question-bank-import.md", "System prompt");
    const recognized = await mapWithQuestionBankConcurrency(chunks, async (sourceText) => {
      const userPrompt = await loadPromptSection(
        "question-bank-import.md",
        "User prompt",
        { sourceText },
      );
      const { text } = await withQuestionBankAiSlot(async () => await requestAiCompletion({
        temperature: 0,
        maxTokens: 8192,
        responseFormat: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }));
      const parsed = parseLooseJson(text);
      const validated = validateRecognizedQuestionBankChunk(
        parsed,
        { id: bankId, name, profiles },
        sourceText,
      );
      if (!validated) {
        throw Object.assign(new Error("Invalid question-bank recognition response."), {
          code: "INVALID_AI_RESPONSE",
        });
      }
      return validated;
    });
    const questions = recognized.flatMap((result) => result.bank.questions);
    const unrecognized = recognized.flatMap((result) => result.unrecognized);
    const ids = new Set(questions.map((question) => question.id));
    const questionTexts = new Set(questions.map((question) => question.question));
    if (
      questions.length > YTD_QUESTION_BANK.LIMITS.maxQuestionsPerBank
      || ids.size !== questions.length
      || questionTexts.size !== questions.length
      || unrecognized.length > YTD_QUESTION_BANK.LIMITS.maxQuestionsPerBank
    ) {
      return questionBankError("INVALID_AI_RESPONSE");
    }
    const bank = { ...recognized[0].bank, questions };

    const previewToken = makeQuestionBankToken();
    await withQuestionBankMutation(async () => {
      const stored = await chrome.storage.local.get(QUESTION_BANK_PREVIEWS_KEY);
      const now = Date.now();
      const previews = Object.fromEntries(
        Object.entries(stored[QUESTION_BANK_PREVIEWS_KEY] || {})
          .filter(([, preview]) => Number.isFinite(preview?.expiresAt) && preview.expiresAt > now),
      );
      previews[previewToken] = {
        bank,
        replaceBankId,
        unrecognized,
        expiresAt: now + QUESTION_BANK_PREVIEW_TTL_MS,
      };
      await chrome.storage.local.set({ [QUESTION_BANK_PREVIEWS_KEY]: previews });
    });
    return {
      success: true,
      previewToken,
      summary: {
        name: bank.name,
        profiles: [...bank.profiles],
        questionCount: bank.questions.length,
        partCounts: bank.questions.reduce((counts, question) => {
          if (question.part) counts[question.part] = (counts[question.part] || 0) + 1;
          return counts;
        }, {}),
      },
      sampleQuestions: bank.questions.slice(0, 5),
      unrecognized,
    };
  } catch (error) {
    return questionBankError(error.code || "QUESTION_BANK_RECOGNITION_FAILED");
  }
}

async function saveQuestionBank(request = {}) {
  return withQuestionBankMutation(async () => {
    const previewToken = cleanQuestionBankText(request.previewToken, 200);
    if (!previewToken) return questionBankError("INVALID_PREVIEW_TOKEN");
    const stored = await chrome.storage.local.get([
      YTD_QUESTION_BANK.STORAGE_KEY,
      QUESTION_BANK_PREVIEWS_KEY,
    ]);
    const previews = { ...(stored[QUESTION_BANK_PREVIEWS_KEY] || {}) };
    const preview = previews[previewToken];
    if (!preview || typeof preview !== "object") {
      return questionBankError("INVALID_PREVIEW_TOKEN");
    }
    if (!Number.isFinite(preview.expiresAt) || preview.expiresAt <= Date.now()) {
      delete previews[previewToken];
      await chrome.storage.local.set({ [QUESTION_BANK_PREVIEWS_KEY]: previews });
      return questionBankError("PREVIEW_EXPIRED");
    }
    const bank = normalizeValidatedLearnerBank(preview.bank);
    if (!bank) {
      return questionBankError("INVALID_PREVIEW_TOKEN");
    }
    const banks = boundedRawQuestionBankCollection(stored[YTD_QUESTION_BANK.STORAGE_KEY]);
    if (!banks) return questionBankError("QUESTION_BANK_STORAGE_CORRUPT");
    let nextBanks;
    if (preview.replaceBankId) {
      const existing = findStoredLearnerBank(banks, preview.replaceBankId);
      if (existing.error || bank.id !== preview.replaceBankId) {
        return questionBankError(existing.error || "QUESTION_BANK_NOT_FOUND");
      }
      nextBanks = banks.slice();
      nextBanks[existing.index] = bank;
    } else {
      if (banks.length >= YTD_QUESTION_BANK.LIMITS.maxBanks) {
        return questionBankError("QUESTION_BANK_LIMIT");
      }
      if (banks.some((candidate) => candidate?.id === bank.id)) {
        return questionBankError("QUESTION_BANK_EXISTS");
      }
      nextBanks = [...banks, bank];
    }
    delete previews[previewToken];
    await chrome.storage.local.set({
      [YTD_QUESTION_BANK.STORAGE_KEY]: nextBanks,
      [QUESTION_BANK_PREVIEWS_KEY]: previews,
    });
    return { success: true, bank };
  });
}

async function renameQuestionBank(request = {}) {
  return withQuestionBankMutation(async () => {
    const bankId = cleanQuestionBankText(request.bankId, 160);
    const name = cleanQuestionBankText(request.name, QUESTION_BANK_NAME_CHARS);
    if (!bankId) return questionBankError("INVALID_BANK_ID");
    if (!name) return questionBankError("INVALID_BANK_NAME");
    const stored = await chrome.storage.local.get(YTD_QUESTION_BANK.STORAGE_KEY);
    const banks = boundedRawQuestionBankCollection(stored[YTD_QUESTION_BANK.STORAGE_KEY]);
    if (!banks) return questionBankError("QUESTION_BANK_STORAGE_CORRUPT");
    const existing = findStoredLearnerBank(banks, bankId);
    if (existing.error) return questionBankError(existing.error);
    const bank = { ...existing.normalized, name };
    const nextBanks = banks.slice();
    nextBanks[existing.index] = { ...existing.raw, name };
    await chrome.storage.local.set({ [YTD_QUESTION_BANK.STORAGE_KEY]: nextBanks });
    return { success: true, bank };
  });
}

async function deleteQuestionBank(request = {}) {
  return withQuestionBankMutation(async () => {
    const bankId = cleanQuestionBankText(request.bankId, 160);
    if (!bankId) return questionBankError("INVALID_BANK_ID");
    const stored = await chrome.storage.local.get(YTD_QUESTION_BANK.STORAGE_KEY);
    const banks = boundedRawQuestionBankCollection(stored[YTD_QUESTION_BANK.STORAGE_KEY]);
    if (!banks) return questionBankError("QUESTION_BANK_STORAGE_CORRUPT");
    const existing = findStoredLearnerBank(banks, bankId);
    if (existing.error) return questionBankError(existing.error);
    const nextBanks = banks.slice();
    nextBanks.splice(existing.index, 1);
    await chrome.storage.local.set({ [YTD_QUESTION_BANK.STORAGE_KEY]: nextBanks });
    return { success: true };
  });
}

async function listQuestionBanks() {
  const [stored, bundledBank] = await Promise.all([
    chrome.storage.local.get(YTD_QUESTION_BANK.STORAGE_KEY),
    loadBundledIeltsBank(),
  ]);
  const banks = boundedRawQuestionBankCollection(stored[YTD_QUESTION_BANK.STORAGE_KEY]);
  if (!banks) return questionBankError("QUESTION_BANK_STORAGE_CORRUPT");
  return {
    success: true,
    banks: normalizeStoredLearnerBanks(banks).map(questionBankMetadata),
    bundledAvailable: !!bundledBank,
    bundled: bundledBank ? questionBankMetadata(bundledBank) : null,
  };
}

function isTrustedQuestionBankSender(sender) {
  const extensionRoot = chrome.runtime.getURL("");
  return !!(
    sender
    && sender.id === chrome.runtime.id
    && typeof sender.url === "string"
    && sender.url.startsWith(extensionRoot)
  );
}

async function readBoundedAiResponse(response, onActivity) {
  const reader = response.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    let responseText = "";
    let responseBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Every received chunk is activity, including DeepSeek's blank lines.
      onActivity();
      const byteLength = value?.byteLength ?? 0;
      responseBytes += byteLength;
      if (responseBytes > AI_PROVIDER_MAX_RESPONSE_BYTES) {
        await reader.cancel?.().catch(() => {});
        const error = new Error("DeepSeek response exceeded the 2 MiB limit.");
        error.code = "AI_RESPONSE_TOO_LARGE";
        throw error;
      }
      responseText += decoder.decode(value, { stream: true });
    }
    responseText += decoder.decode();
    return JSON.parse(responseText.trimStart());
  }

  // Some fetch implementations do not expose a readable stream. Preserve a
  // bounded body read for that case.
  if (typeof response.text === "function") {
    const responseText = await response.text();
    onActivity();
    const byteLength = new TextEncoder().encode(responseText).byteLength;
    if (byteLength > AI_PROVIDER_MAX_RESPONSE_BYTES) {
      const error = new Error("DeepSeek response exceeded the 2 MiB limit.");
      error.code = "AI_RESPONSE_TOO_LARGE";
      throw error;
    }
    return JSON.parse(responseText.trimStart());
  }

  // Legacy/test fetch shims may expose only json(). The hard and idle timers
  // still bound this fallback even though chunk-level activity is unavailable.
  const data = await response.json();
  onActivity();
  return data;
}

// ============================================================
// SIDE PANEL SETUP
// ============================================================

/**
 * When the user clicks the extension icon, open the side panel.
 * Chrome's Side Panel API lets us show a persistent panel alongside the page.
 */
chrome.action.onClicked.addListener((tab) => {
  if (!(tab.url || "").startsWith("https://www.youtube.com")) {
    void updatePanelForTab(tab.id, tab.url, tab.windowId);
    return;
  }

  // Re-enable + open without awaiting — preserves user gesture context
  chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: "sidepanel.html",
    enabled: true,
  });
  chrome.sidePanel.open({ tabId: tab.id });
});

/**
 * Allow the side panel to open on any page, but it's designed for YouTube.
 */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});

/**
 * Keep the side panel scoped to YouTube tabs only.
 *
 * Chrome side panels are "global" by default: once opened, the panel follows
 * you to every tab. To make YouTube Digest behave like a YouTube-only tool, we
 * enable the panel on YouTube tabs and disable it everywhere else. Disabling
 * on a tab makes Chrome hide/close the panel for that tab, so it never lingers
 * on a new tab or some other website.
 *
 * We have to react to BOTH things that can change "what tab you're looking at":
 *   - onUpdated: the current tab navigates to a new URL
 *   - onActivated: you switch to (or open) a different tab
 * The original code only handled onUpdated, which is why the panel stayed
 * visible when switching to an already-loaded non-YouTube tab.
 */
async function closePanelForTab(tabId, windowId) {
  // Chrome 141 added an explicit close API. On older supported versions,
  // disabling the tab-specific panel below remains the compatibility path.
  if (typeof chrome.sidePanel.close !== "function") return;

  try {
    // This closes the tab-specific panel used by YouTube Digest.
    await chrome.sidePanel.close({ tabId });
    return;
  } catch (error) {
    // Chrome 145+ rejects tabId when the visible instance is global. Close
    // that instance by window instead.
  }

  if (Number.isInteger(windowId)) {
    await chrome.sidePanel.close({ windowId }).catch(() => {});
  }
}

async function updatePanelForTab(tabId, url, windowId) {
  const isYouTube = (url || "").startsWith("https://www.youtube.com");
  if (!isYouTube) {
    // Close the visible instance first. Then disable this tab so Chrome cannot
    // reopen the global default panel as navigation settles.
    await closePanelForTab(tabId, windowId);
    await chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
    return;
  }

  // setOptions can reject if the tab just closed. Ignore that harmlessly.
  await chrome.sidePanel
    .setOptions({ tabId, path: "sidepanel.html", enabled: true })
    .catch(() => {});
}

/**
 * Gets the best URL from a tab update that can change panel availability.
 * Chrome can apply tab-specific side-panel state before a navigation commits,
 * then reset it during the commit. Handling loading and complete gives the
 * first non-YouTube navigation a reliable second reconciliation.
 */
function getNavigationUrl(changeInfo, tab) {
  if (changeInfo.url) return changeInfo.url;
  if (changeInfo.status !== "loading" && changeInfo.status !== "complete") {
    return "";
  }
  return tab.pendingUrl || tab.url || "";
}

// A tab started or completed navigation. Reconcile at both stages because
// Chrome can replace per-tab side-panel options while the page commits.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = getNavigationUrl(changeInfo, tab);
  if (!url) return; // Ignore title and favicon-only updates.
  void updatePanelForTab(tabId, url, tab.windowId);
});

// The user switched to a different tab (or opened a new one).
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    void updatePanelForTab(tabId, tab.url || tab.pendingUrl, windowId);
  } catch (e) {
    // Tab vanished before we could read it — nothing to do.
  }
});

// ============================================================
// MESSAGE HANDLING
// ============================================================

/**
 * Listen for messages from the side panel and content script.
 * This is like a switchboard — different "actions" trigger different handlers.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    QUESTION_BANK_MESSAGE_ACTIONS.has(message.action)
    && !isTrustedQuestionBankSender(sender)
  ) {
    sendResponse({ success: false, error: "UNTRUSTED_SENDER" });
    return false;
  }

  // We need to return true to indicate we'll respond asynchronously
  if (message.action === "fetchTranscript") {
    handleFetchTranscript(message.videoId)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // Keep the message channel open for async response
  }

  if (message.action === "analyzeTranscript") {
    // Pass video duration to help the AI validate timestamps
    handleAnalyzeTranscript(
      message.transcriptText,
      message.videoTitle,
      message.channelName,
      message.videoDescription,
      message.videoDuration,
    )
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === "explainSelection") {
    // Explain selected text using DeepSeek.
    handleExplainSelection(
      message.selectedText,
      message.transcriptContext,
      message.videoTitle,
    )
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.action === "getContextualGloss") {
    handleContextualGloss(message.selectionRequest)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "getCorpusSettings") {
    getCorpusSettings().then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "recordCorpusExport") {
    recordCorpusExport(message.exportRecord).then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "savePracticeHighlight") {
    savePracticeHighlight(message.entry)
      .then((result) => {
        sendResponse(result);
        if (result?.success) {
          chrome.runtime.sendMessage({
            action: "practiceHighlightSaved",
            videoId: message.entry?.videoId,
          }).catch(() => {});
        }
      })
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "getPracticeHighlights") {
    getPracticeHighlights(message.videoId).then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "getPracticeMaterials") {
    handlePracticeMaterials(message.request).then(sendResponse).catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "previewQuestionBankImport") {
    previewQuestionBankImport(message.request || message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "saveQuestionBank") {
    saveQuestionBank(message.request || message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "renameQuestionBank") {
    renameQuestionBank(message.request || message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "deleteQuestionBank") {
    deleteQuestionBank(message.request || message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "listQuestionBanks" || message.action === "getPracticeQuestionSources") {
    listQuestionBanks()
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "saveNote") {
    // Save a note at the current timestamp, or save exact selected transcript
    // text when the side panel supplies it.
    handleSaveNote(
      message.videoId,
      message.timestamp,
      message.videoTitle,
      message.channelName,
      message.selectedText,
    )
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "getNotes") {
    // Get all saved notes
    handleGetNotes(message.videoId)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "deleteNote") {
    // Delete a specific note
    handleDeleteNote(message.noteId)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "getVideoInfo") {
    handleGetVideoInfo(message.tabId)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  // Translation: send content to DeepSeek.
  if (message.action === "translateContent") {
    handleTranslateContent(
      message.content,
      message.contentType,
      message.targetLanguage,
      message.videoTitle,
    )
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "checkConfig") {
    getSettings()
      .then((settings) =>
        sendResponse({
          hasSupadataKey: !!settings.supadataApiKey,
          hasAiKey: !!settings.aiApiKey,
        }),
      )
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message.action === "openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return false;
  }

  if (message.action === "openSidePanel") {
    const tabId = sender.tab?.id;
    debugLog("[YouTube Digest BG] openSidePanel requested from tab:", tabId);

    // Re-enable the panel (it may have been disabled by auto-close) and open it.
    // IMPORTANT: we call setOptions + open synchronously (no await between them)
    // to preserve the user gesture context. Chrome requires sidePanel.open()
    // to be called within a user gesture — awaiting anything first can expire it.
    if (tabId) {
      chrome.sidePanel.setOptions({
        tabId,
        path: "sidepanel.html",
        enabled: true,
      });
      chrome.sidePanel
        .open({ tabId })
        .then(() => {
          // Broadcast to side panel to start digest (in case it's already open)
          setTimeout(() => {
            chrome.runtime
              .sendMessage({ action: "startDigestFromButton" })
              .catch(() => {});
          }, 300);
        })
        .catch((err) => {
          console.error("[YouTube Digest BG] openSidePanel error:", err);
        });
    } else {
      // Fallback: find the active tab
      chrome.tabs
        .query({ active: true, lastFocusedWindow: true })
        .then((tabs) => {
          if (tabs[0]) {
            chrome.sidePanel.setOptions({
              tabId: tabs[0].id,
              path: "sidepanel.html",
              enabled: true,
            });
            chrome.sidePanel.open({ tabId: tabs[0].id }).catch((err) => {
              console.error(
                "[YouTube Digest BG] openSidePanel fallback error:",
                err,
              );
            });
          }
        });
    }

    sendResponse({ success: true });
    return false;
  }

  // Relay messages from side panel to content script
  if (message.action === "relayToContent") {
    debugLog("[YouTube Digest BG] Relay request:", message.payload?.action);
    (async () => {
      try {
        // Query specifically for YouTube tabs to avoid side panel context issues
        // Try multiple query strategies to find the right tab
        let tabs = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        debugLog(
          "[YouTube Digest BG] Active tab in last focused window:",
          tabs.length,
          tabs[0]?.url,
        );

        // If no YouTube tab found, try broader query
        if (!tabs[0] || !tabs[0].url?.includes("youtube.com")) {
          tabs = await chrome.tabs.query({
            url: "https://www.youtube.com/*",
            active: true,
          });
          debugLog("[YouTube Digest BG] Active YouTube tabs:", tabs.length);
        }

        // Still nothing? Try any YouTube tab
        if (!tabs[0]) {
          tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
          debugLog("[YouTube Digest BG] Any YouTube tabs:", tabs.length);
        }

        if (tabs[0]) {
          debugLog(
            "[YouTube Digest BG] Sending to tab:",
            tabs[0].id,
            "URL:",
            tabs[0].url,
          );
          let response = await chrome.tabs.sendMessage(
            tabs[0].id,
            message.payload,
          );

          // For getVideoInfo, PREFER YouTube's own player data over the
          // DOM scrape. The player's videoDetails is canonical: its `author`
          // is always THIS video's channel and its `shortDescription` is the
          // full text. The DOM scrape is unreliable — e.g. on a playlist page
          // it grabbed the playlist owner's name ("Zara Zhang") instead of the
          // real channel ("Replit and Stripe"), and its description is
          // truncated while the box is collapsed. We fall back to the DOM
          // only for fields the player didn't provide.
          if (message.payload?.action === "getVideoInfo") {
            const playerInfo = await getPlayerVideoDetails(tabs[0].id);
            if (playerInfo) {
              response = {
                title: playerInfo.title || response?.title || "",
                channelName:
                  playerInfo.channelName || response?.channelName || "",
                duration: playerInfo.duration || response?.duration || 0,
                description:
                  playerInfo.description || response?.description || "",
              };
            }
          }

          debugLog("[YouTube Digest BG] Got response from content:", response);
          sendResponse({ success: true, response });
        } else {
          debugLog("[YouTube Digest BG] No YouTube tab found");
          sendResponse({ success: false, error: "No YouTube tab found" });
        }
      } catch (err) {
        console.error("[YouTube Digest BG] Relay error:", err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true; // Keep channel open for async response
  }
});

/**
 * Reads the current video's full details straight from YouTube's player.
 *
 * Content scripts live in an isolated world and can't touch the page's own
 * JavaScript. But with the "scripting" permission we can run a tiny function
 * in the page's MAIN world, where YouTube's player object lives. Its
 * getPlayerResponse() carries videoDetails with the FULL description —
 * unlike the DOM, which truncates it until the user clicks "...more".
 *
 * Returns null on any failure so callers can fall back to DOM scraping.
 */
async function getPlayerVideoDetails(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        try {
          const player = document.getElementById("movie_player");
          const details = player?.getPlayerResponse?.()?.videoDetails;
          if (!details) return null;
          return {
            title: details.title || "",
            channelName: details.author || "",
            description: details.shortDescription || "",
            duration: Number(details.lengthSeconds) || 0,
          };
        } catch (e) {
          return null;
        }
      },
    });
    return results?.[0]?.result || null;
  } catch (e) {
    console.warn("[YouTube Digest BG] Player details unavailable:", e.message);
    return null;
  }
}

// ============================================================
// TRANSCRIPT FETCHING VIA SUPADATA API
// ============================================================

/**
 * Fetches the transcript for a YouTube video using Supadata API.
 *
 * Supadata is a specialized service that reliably extracts transcripts
 * from YouTube videos. It handles all the complexity of parsing YouTube's
 * internal data structures, dealing with different caption formats, etc.
 *
 * API Docs: https://docs.supadata.ai
 *
 * @param {string} videoId - The YouTube video ID (e.g., "dQw4w9WgXcQ")
 * @returns {Object} - { success, transcript, transcriptText, language } or { success: false, error }
 */
async function handleFetchTranscript(videoId) {
  try {
    const settings = await getSettings();
    if (!settings.supadataApiKey) {
      return {
        success: false,
        error: "NO_SUPADATA_KEY",
        message: "Supadata API key not configured. Open YouTube Digest Settings.",
      };
    }

    // Share only the canonical watch URL. This strips playlist, referral,
    // timestamp, and other browsing parameters from the active tab URL.
    const canonicalVideoUrl = YTD_SETTINGS.canonicalYouTubeUrl(videoId);
    // Using the universal transcript endpoint with text=false to get timestamped chunks
    const apiUrl = new URL("https://api.supadata.ai/v1/transcript");
    apiUrl.searchParams.set("url", canonicalVideoUrl);
    apiUrl.searchParams.set("text", "false"); // Get timestamped chunks, not plain text
    apiUrl.searchParams.set("lang", "en"); // Prefer English
    // Caption-only product scope: never fall back to paid AI transcription.
    apiUrl.searchParams.set("mode", "native");

    // Make the API request
    const response = await fetch(apiUrl.toString(), {
      method: "GET",
      headers: {
        "x-api-key": settings.supadataApiKey,
      },
    });

    // Handle async jobs (for videos > 20 minutes, Supadata returns a job ID)
    if (response.status === 202) {
      const jobData = await response.json();
      // Poll for the result
      return await pollTranscriptJob(jobData.jobId, settings.supadataApiKey);
    }

    if (response.status === 206) {
      return {
        success: false,
        error: "NO_TRANSCRIPT",
        message: "No native subtitle track is available for this video.",
      };
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 401) {
        return {
          success: false,
          error: "INVALID_SUPADATA_KEY",
          message: "Your Supadata API key is invalid. Open YouTube Digest Settings.",
        };
      }
      if (response.status === 404) {
        return {
          success: false,
          error: "NO_TRANSCRIPT",
          message: "No subtitles found for this video.",
        };
      }
      if (response.status === 429) {
        return {
          success: false,
          error: "RATE_LIMITED",
          message:
            "Supadata rate limit reached. Please wait a minute and try again.",
        };
      }
      throw new Error(
        errorData.message || `Supadata API error: ${response.status}`,
      );
    }

    const data = await response.json();

    // Parse the response into our internal format
    // Supadata returns: { content: [{ text, offset, duration, lang }], lang, availableLangs }
    const transcript = [];
    let transcriptTextPlain = ""; // Plain text for display/export
    let transcriptTextTimestamped = ""; // Timestamped text for AI analysis

    if (data.content && Array.isArray(data.content)) {
      for (const chunk of data.content) {
        if (chunk.text) {
          // Clean up caption artifacts:
          // ">>" = speaker change marker from YouTube auto-captions
          const cleanText = chunk.text.replace(/>> ?/g, "").trim();
          if (!cleanText) continue; // Skip if nothing left after cleanup

          // offset is in milliseconds, convert to seconds
          const startSeconds = Math.floor((chunk.offset || 0) / 1000);
          const minutes = Math.floor(startSeconds / 60);
          const seconds = startSeconds % 60;
          const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

          transcript.push({
            text: cleanText,
            start: startSeconds,
            duration: Math.floor((chunk.duration || 0) / 1000),
            language: chunk.lang || data.lang || null,
          });

          // Plain text without timestamps (for display/export)
          transcriptTextPlain += cleanText + " ";

          // Timestamped text for DeepSeek (format: [MM:SS] text)
          // This allows the model to reference actual transcript positions.
          transcriptTextTimestamped += `[${timestamp}] ${cleanText}\n`;
        }
      }
    }

    if (transcript.length === 0) {
      return {
        success: false,
        error: "EMPTY_TRANSCRIPT",
        message: "Supadata returned an empty transcript for this video.",
      };
    }

    return {
      success: true,
      transcript: transcript,
      transcriptText: transcriptTextPlain.trim(), // For display
      transcriptTextTimestamped: transcriptTextTimestamped.trim(), // For AI
      language: typeof data.lang === "string" ? data.lang : null,
    };
  } catch (error) {
    console.error("Transcript fetch error:", error);
    return {
      success: false,
      error: error.message || "Failed to fetch transcript",
    };
  }
}

/**
 * Polls for transcript job completion (for long videos).
 * Supadata processes videos > 20 minutes asynchronously.
 *
 * @param {string} jobId - The job ID returned by the initial request
 * @returns {Object} - Same format as handleFetchTranscript
 */
async function pollTranscriptJob(jobId, supadataApiKey) {
  const maxAttempts = 60; // Max 60 seconds of polling
  const pollInterval = 1000; // Poll every 1 second

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Wait before polling
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const response = await fetch(
      `https://api.supadata.ai/v1/transcript/${encodeURIComponent(jobId)}`,
      {
        headers: { "x-api-key": supadataApiKey },
      },
    );

    if (!response.ok) {
      throw new Error(`Job polling failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.status === "completed") {
      // Parse the completed transcript
      const transcript = [];
      let transcriptTextPlain = "";
      let transcriptTextTimestamped = "";

      if (data.content && Array.isArray(data.content)) {
        for (const chunk of data.content) {
          if (chunk.text) {
            // Clean up caption artifacts (">>" = speaker change marker)
            const cleanText = chunk.text.replace(/>> ?/g, "").trim();
            if (!cleanText) continue;

            const startSeconds = Math.floor((chunk.offset || 0) / 1000);
            const minutes = Math.floor(startSeconds / 60);
            const seconds = startSeconds % 60;
            const timestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

            transcript.push({
              text: cleanText,
              start: startSeconds,
              duration: Math.floor((chunk.duration || 0) / 1000),
              language: chunk.lang || data.lang || null,
            });
            transcriptTextPlain += cleanText + " ";
            transcriptTextTimestamped += `[${timestamp}] ${chunk.text}\n`;
          }
        }
      }

      return {
        success: true,
        transcript: transcript,
        transcriptText: transcriptTextPlain.trim(),
        transcriptTextTimestamped: transcriptTextTimestamped.trim(),
        language: typeof data.lang === "string" ? data.lang : null,
      };
    }

    if (data.status === "failed") {
      throw new Error("Transcript processing failed");
    }

    // Status is 'queued' or 'active' — keep polling
  }

  throw new Error("Transcript processing timed out");
}

// ============================================================
// JSON HELPER
// ============================================================

/**
 * Parses JSON returned by an LLM, tolerating the small mistakes they sometimes
 * make. Some models occasionally emit a trailing
 * comma before a ] or }, or wraps the JSON in prose / code fences. Plain
 * JSON.parse throws on those, which is what caused the "Unexpected token ']'"
 * error on the Overview tab. This function strips fences, isolates the outer
 * JSON object, removes trailing commas, and only then parses.
 *
 * @param {string} text - The raw text from the model
 * @returns {Object} - The parsed object (throws if still unparseable)
 */
function parseLooseJson(text) {
  let cleaned = (text || "").trim();

  // Strip ```json ... ``` style code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }

  // Isolate the outermost { ... } in case the model added a sentence around it
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    // Most common LLM slip: a trailing comma right before a } or ].
    // e.g. ["a", "b", ]  ->  ["a", "b" ]
    const repaired = cleaned.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(repaired);
  }
}

function practiceMaterialText(value, limit = 1000) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function validatePracticeMaterials(rawResponse, selectedIds) {
  let parsed;
  try {
    parsed = typeof rawResponse === "string" ? parseLooseJson(rawResponse) : rawResponse;
  } catch (_error) {
    return null;
  }
  if (!parsed || parsed.label !== "AI 练习材料" || !Array.isArray(selectedIds)) return null;
  const selectedItems = new Map(selectedIds
    .map((item) => ({
      id: practiceMaterialText(item?.id, 120),
      expression: practiceMaterialText(item?.expression, 240),
      selectedText: practiceMaterialText(item?.anchors?.[0]?.selectedText || item?.expression, 300),
    }))
    .filter((item) => item.id && item.expression && item.selectedText)
    .map((item) => [item.id, item]));
  const allowedIds = new Set(selectedItems.keys());
  const items = (Array.isArray(parsed.items) ? parsed.items : []).slice(0, 80)
    .map((item) => {
      const id = practiceMaterialText(item?.id, 120);
      const rawReferences = item?.internalization?.references;
      if (!Array.isArray(rawReferences) || rawReferences.length !== 3) return null;
      const internalization = {
        promptZh: practiceMaterialText(item?.internalization?.promptZh, 600),
        references: rawReferences.map((reference) => practiceMaterialText(reference, 320)),
      };
      const distinctReferences = new Set(internalization.references.map((reference) => reference.toLocaleLowerCase()));
      const selectedItem = selectedItems.get(id);
      if (
        !allowedIds.has(id)
        || !internalization.promptZh
        || rawReferences.some((reference) => typeof reference !== "string" || reference.replace(/\s+/g, " ").trim().length > 320)
        || internalization.references.some((reference) => !reference)
        || distinctReferences.size !== 3
        || internalization.references.some((reference) => !YTD_PRACTICE.referenceUsesExpression(reference, selectedItem))
        || !YTD_PRACTICE.referencesHaveDistinctContexts(internalization.references, selectedItem)
      ) return null;
      return { id, internalization };
    })
    .filter(Boolean);
  const returnedIds = new Set(items.map((item) => item.id));
  if (items.length !== allowedIds.size || returnedIds.size !== allowedIds.size) return null;
  return {
    label: "AI 练习材料",
    items,
  };
}

async function handlePracticeMaterials(request) {
  const profile = Object.hasOwn(YTD_PRACTICE.PROFILES, request?.profile) ? request.profile : "ielts";
  const highlights = YTD_PRACTICE.mergePracticeHighlights(request?.highlights).slice(0, 30);
  if (!highlights.length) return { success: false, error: "NO_PRACTICE_ITEMS" };
  const settings = await getSettings();
  if (!settings.aiApiKey) {
    return { success: false, error: "NO_AI_KEY", message: "DeepSeek API key not configured." };
  }
  const expressions = highlights.map((item) => ({
    id: item.id,
    expression: item.expression,
    kind: item.kind,
    partOfSpeech: item.partOfSpeech,
    usageContexts: item.usageContexts,
    originalExamples: item.anchors.slice(0, 3).map((anchor) => anchor.context || anchor.selectedText),
  }));
  try {
    const variables = {
      profile: YTD_PRACTICE.PROFILES[profile],
      videoTitle: practiceMaterialText(request?.videoTitle, 500) || "Unknown",
      expressionsJson: JSON.stringify(expressions),
    };
    const systemPrompt = await loadPromptSection("expression-practice.md", "System prompt", variables);
    const userPrompt = await loadPromptSection("expression-practice.md", "User prompt", variables);
    const { text } = await requestAiCompletion({
      temperature: 0.3,
      maxTokens: Math.min(5000, 800 + highlights.length * 480),
      responseFormat: { type: "json_object" },
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    });
    const materials = validatePracticeMaterials(text, highlights);
    if (!materials || materials.items.length !== highlights.length) {
      return { success: false, error: "INVALID_AI_RESPONSE", message: "练习材料不完整，请重试。" };
    }
    return { success: true, materials };
  } catch (error) {
    return { success: false, error: error.code || error.message || "PRACTICE_MATERIALS_FAILED", message: "暂时无法生成练习材料，请重试。" };
  }
}

// ============================================================
// DEEPSEEK ANALYSIS
// ============================================================

/**
 * Sends the transcript to DeepSeek for analysis.
 *
 * The prompt asks the model to produce chapters covering the whole video
 * and 3-5 key quotes with timestamps.
 *
 * @param {string} transcriptText - The full transcript as plain text
 * @param {string} videoTitle - The video title
 * @param {string} channelName - The channel name
 * @returns {Object} - { success, analysis } or { success: false, error }
 */
async function handleAnalyzeTranscript(
  transcriptText,
  videoTitle,
  channelName,
  videoDescription,
  videoDuration,
) {
  try {
    const settings = await getSettings();
    if (!settings.aiApiKey) {
      return {
        success: false,
        error: "NO_AI_KEY",
        message: "DeepSeek API key not configured. Open YouTube Digest Settings.",
      };
    }

    // Convert duration to MM:SS format for context
    // The transcript text is already prefixed with [M:SS] markers. Its LAST
    // marker is the most reliable signal of where the content actually ends —
    // more trustworthy than the duration metadata, which is sometimes missing
    // or wrong. We use the larger of (metadata duration, last transcript stamp).
    let lastTranscriptSeconds = 0;
    const stampMatches = transcriptText.match(/\[(\d+):(\d{2})\]/g) || [];
    if (stampMatches.length) {
      const last =
        stampMatches[stampMatches.length - 1].match(/\[(\d+):(\d{2})\]/);
      lastTranscriptSeconds = parseInt(last[1]) * 60 + parseInt(last[2]);
    }

    const effectiveSeconds = Math.max(
      Math.floor(videoDuration || 0),
      lastTranscriptSeconds,
    );
    const durationMinutes = Math.floor(effectiveSeconds / 60);
    const durationSeconds = Math.floor(effectiveSeconds % 60);
    const durationFormatted = `${durationMinutes}:${String(durationSeconds).padStart(2, "0")}`;
    const maxTimestampSeconds = effectiveSeconds;

    // The "last chapter must be after" threshold (75% in) forces the model to
    // cover the WHOLE video instead of front-loading chapters near the start.
    // We do NOT prescribe a chapter count — the model picks the natural splits.
    const lateThresholdSeconds = Math.floor(effectiveSeconds * 0.75);
    const lateThreshold = `${Math.floor(lateThresholdSeconds / 60)}:${String(
      lateThresholdSeconds % 60,
    ).padStart(2, "0")}`;

    const promptVariables = {
      durationFormatted,
      lateThreshold,
      maxTimestampSeconds,
      videoTitle: videoTitle || "Unknown",
      channelName: channelName || "Unknown",
      videoDescription: videoDescription || "No description available",
      transcriptText,
    };
    const systemPrompt = await loadPromptSection(
      "analysis.md",
      "System prompt",
      promptVariables,
    );
    const userPrompt = await loadPromptSection(
      "analysis.md",
      "User prompt",
      promptVariables,
    );

    debugLog("[YouTube Digest] Requesting video analysis", settings.aiModel);
    const { text: responseText } = await requestAiCompletion({
      maxTokens: 8192,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    // Parse the JSON, tolerating trailing commas / stray prose
    let analysis = parseLooseJson(responseText);

    // Treat every model response as untrusted data. Rebuild the supported
    // schema and derive display timestamps from validated numeric seconds.
    analysis = validateAndFixTimestamps(analysis, maxTimestampSeconds);

    return {
      success: true,
      analysis: analysis,
    };
  } catch (error) {
    console.error("Analysis error:", error);
    if (error.status === 401) {
      return {
        success: false,
        error: "INVALID_AI_KEY",
        message: "DeepSeek rejected the API key.",
      };
    }
    if (error.status === 429) {
      return {
        success: false,
        error: "RATE_LIMITED",
        message: "DeepSeek rate-limited this request. Try again shortly.",
      };
    }
    return {
      success: false,
      error: error.message || "Failed to analyze transcript",
    };
  }
}

/**
 * Validates all timestamps in the analysis and fixes any that exceed video duration.
 * This is a safety net to prevent hallucinated timestamps from reaching the UI.
 *
 * @param {Object} analysis - The parsed analysis from DeepSeek
 * @param {number} maxSeconds - Maximum valid timestamp in seconds
 * @returns {Object} - Analysis with validated timestamps
 */
function validateAndFixTimestamps(analysis, maxSeconds) {
  const safeMax =
    Number.isFinite(Number(maxSeconds)) && Number(maxSeconds) > 0
      ? Number(maxSeconds)
      : Number.MAX_SAFE_INTEGER;

  // Helper to format seconds as MM:SS
  const formatTimestamp = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  const safeString = (value, maxLength) =>
    typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  const safeSeconds = (value) => {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > safeMax) {
      return null;
    }
    return Math.floor(seconds);
  };

  const chapters = (Array.isArray(analysis?.chapters) ? analysis.chapters : [])
    .slice(0, 100)
    .map((chapter) => {
      const seconds = safeSeconds(chapter?.timestampSeconds);
      const title = safeString(chapter?.title, 300);
      if (seconds === null || !title) return null;
      return {
        title,
        summary: safeString(chapter?.summary, 1500),
        timestampSeconds: seconds,
        timestamp: formatTimestamp(seconds),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  const keyQuotes = (
    Array.isArray(analysis?.keyQuotes) ? analysis.keyQuotes : []
  )
    .slice(0, 50)
    .map((quote) => {
      const seconds = safeSeconds(quote?.timestampSeconds);
      const text = safeString(quote?.quote, 3000);
      if (seconds === null || !text) return null;
      return {
        quote: text,
        timestampSeconds: seconds,
        timestamp: formatTimestamp(seconds),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);

  const keyMoments = (
    Array.isArray(analysis?.keyMoments) ? analysis.keyMoments : []
  )
    .map(safeSeconds)
    .filter((seconds) => seconds !== null)
    .slice(0, 100);

  return { chapters, keyQuotes, keyMoments };
}

// ============================================================
// VIDEO INFO EXTRACTION
// ============================================================

/**
 * Gets video info (title, channel, description) from the active YouTube tab.
 * We do this by asking the content script to read the page.
 */
async function handleGetVideoInfo(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      action: "getVideoInfo",
    });
    return response;
  } catch (error) {
    return { title: "", channelName: "", description: "" };
  }
}

// ============================================================
// EXPLAIN SELECTION
// ============================================================

function resolveSelectionContext(selectionRequest, transcript) {
  const selection = YTD_CORPUS.normalizeSelectionRequest(selectionRequest);
  if (!selection || !Array.isArray(transcript) || transcript.length === 0) {
    return null;
  }
  const rows = transcript
    .map((entry) => ({
      start: Math.max(0, Math.floor(Number(entry?.start) || 0)),
      text: typeof entry?.text === "string" ? entry.text.replace(/\s+/g, " ").trim() : "",
    }))
    .filter((entry) => entry.text);
  if (!rows.length) return null;

  let targetIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  rows.forEach((row, index) => {
    const distance = Math.abs(row.start - selection.timestampSeconds);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      targetIndex = index;
    }
  });
  const beforeText = rows
    .slice(Math.max(0, targetIndex - 2), targetIndex)
    .map((row) => row.text)
    .join(" ");
  const targetText = rows[targetIndex].text;
  const afterText = rows
    .slice(targetIndex + 1, targetIndex + 3)
    .map((row) => row.text)
    .join(" ");
  const timestampedUrl = `${YTD_SETTINGS.canonicalYouTubeUrl(selection.videoId)}&t=${selection.timestampSeconds}s`;
  return {
    ...selection,
    timestampedUrl,
    targetText,
    beforeText,
    afterText,
    context: [beforeText, targetText, afterText].filter(Boolean).join(" "),
  };
}

function validateContextualGlossResponse(rawResponse, selectedText) {
  const gloss = YTD_CORPUS.normalizeContextualGloss(rawResponse);
  const normalizedSelected = typeof selectedText === "string"
    ? selectedText.replace(/\s+/g, " ").trim().toLocaleLowerCase()
    : "";
  if (!gloss || !normalizedSelected) return null;
  if (gloss.expression.toLocaleLowerCase() !== normalizedSelected) return null;
  return gloss;
}

async function loadCorpusTranscript(videoId) {
  const digestKey = `digest_${videoId}`;
  const corpusKey = `ytd_corpus_transcript_${videoId}`;
  const stored = await chrome.storage.local.get([digestKey, corpusKey]);
  const digestTranscript = stored[digestKey]?.transcript;
  if (Array.isArray(digestTranscript) && digestTranscript.length) return digestTranscript;
  const cachedTranscript = stored[corpusKey]?.transcript;
  if (Array.isArray(cachedTranscript) && cachedTranscript.length) return cachedTranscript;

  const fetched = await handleFetchTranscript(videoId);
  if (!fetched.success) return null;
  await chrome.storage.local.set({
    [corpusKey]: {
      transcript: fetched.transcript,
      savedAt: Date.now(),
    },
  });
  return fetched.transcript;
}

async function handleContextualGloss(selectionRequest) {
  const selection = YTD_CORPUS.normalizeSelectionRequest(selectionRequest);
  if (!selection) {
    return { success: false, error: "INVALID_SELECTION", message: "Select text from captions or Transcript." };
  }
  const settings = await getSettings();
  if (!settings.aiApiKey) {
    return {
      success: false,
      error: "NO_AI_KEY",
      message: "DeepSeek API key not configured. Open YouTube Digest Settings.",
    };
  }

  try {
    const transcript = await loadCorpusTranscript(selection.videoId);
    const selectionContext = resolveSelectionContext(selection, transcript);
    if (!selectionContext) {
      return {
        success: false,
        error: "NO_TRANSCRIPT_CONTEXT",
        message: "A timestamped transcript is needed to explain this selection.",
      };
    }
    const variables = {
      selectedText: selectionContext.selectedText,
      targetText: selectionContext.targetText,
      beforeText: selectionContext.beforeText || "(none)",
      afterText: selectionContext.afterText || "(none)",
      videoTitle: selectionContext.videoTitle || "Unknown",
      channelName: selectionContext.channelName || "Unknown",
    };
    const systemPrompt = await loadPromptSection(
      "contextual-gloss.md",
      "System prompt",
      variables,
    );
    const userPrompt = await loadPromptSection(
      "contextual-gloss.md",
      "User prompt",
      variables,
    );
    const { text } = await requestAiCompletion({
      temperature: 0.2,
      maxTokens: 1200,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    const gloss = validateContextualGlossResponse(text, selectionContext.selectedText);
    if (!gloss) {
      return {
        success: false,
        error: "INVALID_AI_RESPONSE",
        message: "The AI response was incomplete. Try again.",
      };
    }
    const destination = await resolveVideoNoteDestination(
      selectionContext.videoId,
      selectionContext.videoTitle || "Untitled Video",
      new Date(),
    );
    return { success: true, selection: selectionContext, gloss, destination };
  } catch (error) {
    if (error.status === 429) {
      return {
        success: false,
        error: "RATE_LIMITED",
        message: "DeepSeek rate-limited this request. Try again shortly.",
      };
    }
    return {
      success: false,
      error: error.message || "CONTEXTUAL_GLOSS_FAILED",
      message: "Could not create an AI contextual gloss.",
    };
  }
}

async function getCorpusSettings() {
  const settings = await getSettings();
  return {
    success: true,
    vault: settings.obsidianVault || "",
    folder: settings.obsidianFolder || "YouTube English",
  };
}

async function resolveVideoNoteDestination(videoId, videoTitle, now) {
  const settings = await getSettings();
  const vault = settings.obsidianVault || "";
  const folder = settings.obsidianFolder || "YouTube English";
  const stored = await chrome.storage.local.get(CORPUS_VIDEO_NOTES_KEY);
  const mappings = stored[CORPUS_VIDEO_NOTES_KEY] || {};
  const existingMapping = mappings[videoId];
  const existingPath = typeof existingMapping === "string"
    ? existingMapping
    : existingMapping?.notePath;
  const notePath = existingPath || YTD_CORPUS.buildVideoNotePath({
    folder,
    videoTitle,
    firstExportedAt: now,
  });
  return {
    vault,
    folder,
    notePath,
    // Historical mappings may point at either the old hierarchical export or
    // the original 11-column table. Start a fresh wide table for both so a
    // three-column row is never appended to a table with a different shape.
    includeTableHeader: existingMapping?.corpusTableFormat !== "wide-v2",
  };
}

async function recordCorpusExport(record) {
  const entryKey = typeof record?.entryKey === "string" ? record.entryKey.slice(0, 800) : "";
  const videoId = typeof record?.videoId === "string" ? record.videoId.slice(0, 100) : "";
  const notePath = typeof record?.notePath === "string" ? record.notePath.slice(0, 500) : "";
  if (!entryKey || !videoId || !notePath) return { success: false, error: "INVALID_EXPORT_RECORD" };
  const stored = await chrome.storage.local.get([CORPUS_EXPORTS_KEY, CORPUS_VIDEO_NOTES_KEY]);
  const exports = Array.isArray(stored[CORPUS_EXPORTS_KEY]) ? stored[CORPUS_EXPORTS_KEY] : [];
  const next = [
    { entryKey, videoId, notePath, status: "handed_off", createdAt: Date.now() },
    ...exports.filter((item) => item?.entryKey !== entryKey),
  ].slice(0, 300);
  const mappings = {
    ...(stored[CORPUS_VIDEO_NOTES_KEY] || {}),
    [videoId]: { notePath, corpusTableInitialized: true, corpusTableFormat: "wide-v2" },
  };
  await chrome.storage.local.set({ [CORPUS_EXPORTS_KEY]: next, [CORPUS_VIDEO_NOTES_KEY]: mappings });
  return { success: true, alreadyRecorded: exports.some((item) => item?.entryKey === entryKey) };
}

function cleanPracticeHighlightText(value, limit) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function normalizePracticeHighlightEntry(entry) {
  const videoId = cleanPracticeHighlightText(entry?.videoId, 100);
  const expression = cleanPracticeHighlightText(entry?.expression, 240);
  const partOfSpeech = cleanPracticeHighlightText(entry?.partOfSpeech, 120);
  const timestampSeconds = Math.floor(Number(entry?.timestampSeconds));
  if (!videoId || !expression || !partOfSpeech || !Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
    return null;
  }
  return {
    videoId,
    videoTitle: cleanPracticeHighlightText(entry.videoTitle, 500),
    expression,
    kind: ["word", "phrase", "sentence_frame"].includes(entry.kind) ? entry.kind : "phrase",
    partOfSpeech,
    usageContexts: cleanPracticeHighlightText(entry.usageContexts, 120),
    spokenFrequency: cleanPracticeHighlightText(entry.spokenFrequency, 40),
    timestamp: cleanPracticeHighlightText(entry.timestamp, 30),
    timestampSeconds,
    timestampedUrl: cleanPracticeHighlightText(entry.timestampedUrl, 2000),
    selectedText: cleanPracticeHighlightText(entry.selectedText || expression, 300),
    targetText: cleanPracticeHighlightText(entry.targetText, 1800),
    context: cleanPracticeHighlightText(entry.context, 1800),
  };
}

async function savePracticeHighlight(entry) {
  const normalized = normalizePracticeHighlightEntry(entry);
  if (!normalized) return { success: false, error: "INVALID_PRACTICE_HIGHLIGHT" };
  const stored = await chrome.storage.local.get(PRACTICE_HIGHLIGHTS_KEY);
  const highlightsByVideo = stored[PRACTICE_HIGHLIGHTS_KEY] || {};
  const merged = YTD_PRACTICE.mergePracticeHighlights([
    ...(Array.isArray(highlightsByVideo[normalized.videoId]) ? highlightsByVideo[normalized.videoId] : []),
    normalized,
  ]);
  await chrome.storage.local.set({
    [PRACTICE_HIGHLIGHTS_KEY]: { ...highlightsByVideo, [normalized.videoId]: merged },
  });
  return { success: true, count: merged.length };
}

async function getPracticeHighlights(videoId) {
  const safeVideoId = cleanPracticeHighlightText(videoId, 100);
  if (!safeVideoId) return { success: false, error: "INVALID_VIDEO_ID", highlights: [] };
  const stored = await chrome.storage.local.get(PRACTICE_HIGHLIGHTS_KEY);
  const highlightsByVideo = stored[PRACTICE_HIGHLIGHTS_KEY] || {};
  const highlights = YTD_PRACTICE.mergePracticeHighlights(
    Array.isArray(highlightsByVideo[safeVideoId]) ? highlightsByVideo[safeVideoId] : [],
  );
  return { success: true, highlights };
}

/**
 * Explains selected text using DeepSeek.
 * Provides context, definitions, and clarification for complex terms.
 *
 * @param {string} selectedText - The text the user selected
 * @param {string} transcriptContext - Surrounding transcript for context
 * @param {string} videoTitle - Video title for additional context
 * @returns {Object} - { success, explanation } or { success: false, error }
 */
// ============================================================
// NOTE MANAGEMENT
// ============================================================

/**
 * Saves a note at a timestamp. Exact selected text is stored directly.
 * Other note requests find the relevant transcript line and clean it up.
 */
async function handleSaveNote(
  videoId,
  timestamp,
  videoTitle,
  channelName,
  selectedText,
) {
  try {
    const canonicalVideoUrl = YTD_SETTINGS.canonicalYouTubeUrl(videoId);
    const safeTimestamp = Math.max(0, Math.floor(Number(timestamp) || 0));
    const exactSelectedText =
      typeof selectedText === "string"
        ? selectedText.replace(/\s+/g, " ").trim().slice(0, 3000)
        : "";

    // A selected transcript note is already the exact text the user wants.
    // Save it directly without a transcript fetch or an AI cleanup request.
    if (exactSelectedText) {
      const minutes = Math.floor(safeTimestamp / 60);
      const seconds = safeTimestamp % 60;
      const note = {
        id: `note_${Date.now()}`,
        videoId,
        videoTitle:
          typeof videoTitle === "string"
            ? videoTitle.slice(0, 500)
            : "Untitled Video",
        channelName:
          typeof channelName === "string" ? channelName.slice(0, 300) : "",
        timestamp: `${minutes}:${String(seconds).padStart(2, "0")}`,
        timestampSeconds: safeTimestamp,
        timestampedUrl: `${canonicalVideoUrl}&t=${safeTimestamp}s`,
        text: exactSelectedText,
        rawText: exactSelectedText,
        createdAt: Date.now(),
      };

      await saveNoteToStorage(note);
      chrome.runtime.sendMessage({ action: "noteSaved", note }).catch(() => {});
      return { success: true, note };
    }

    // First, try to get the transcript from the digest cache. The side panel
    // saves digests to chrome.storage.LOCAL — this used to look in
    // storage.session (the wrong store), so it missed every time and
    // refetched the transcript from Supadata on every saved note.
    let transcript = null;
    try {
      const cached = await chrome.storage.local.get(`digest_${videoId}`);
      if (cached[`digest_${videoId}`]?.transcript) {
        transcript = cached[`digest_${videoId}`].transcript;
        debugLog("[YouTube Digest] Using cached transcript for note");
      }
    } catch (e) {
      debugLog("[YouTube Digest] No cached transcript, fetching...");
    }

    // If no cached transcript, fetch it
    if (!transcript) {
      const transcriptResult = await handleFetchTranscript(videoId);
      if (!transcriptResult.success) {
        return { success: false, error: "Could not fetch transcript" };
      }
      transcript = transcriptResult.transcript;
    }

    // Find the transcript line at the current timestamp
    // Look for the line that contains this timestamp (or the closest one before)
    let matchedLine = null;
    let matchedIndex = 0;
    let contextLines = [];
    let beforeLine = null; // a few sentences before
    let afterLine = null; // a few sentences after

    for (let i = 0; i < transcript.length; i++) {
      const line = transcript[i];
      if (
        line.start <= safeTimestamp &&
        (!transcript[i + 1] || transcript[i + 1].start > safeTimestamp)
      ) {
        matchedLine = line;
        matchedIndex = i;

        // Build a buffer of 2 lines before and 4 lines after the target.
        // This gives the model enough text to find a natural sentence boundary
        // and complete a thought that spans multiple short caption chunks.
        const beforeLines = [];
        for (let j = 1; j <= 2 && i - j >= 0; j++) {
          beforeLines.unshift(transcript[i - j].text);
        }
        if (beforeLines.length > 0) {
          beforeLine = beforeLines.join(" ");
        }

        const afterLines = [];
        for (let j = 1; j <= 4 && i + j < transcript.length; j++) {
          afterLines.push(transcript[i + j].text);
        }
        if (afterLines.length > 0) {
          afterLine = afterLines.join(" ");
        }

        // Get broader context (8 lines before and 12 lines after) for understanding
        const startIdx = Math.max(0, i - 8);
        const endIdx = Math.min(transcript.length - 1, i + 12);
        for (let j = startIdx; j <= endIdx; j++) {
          contextLines.push(transcript[j].text);
        }
        break;
      }
    }

    if (!matchedLine) {
      // Fallback: use the last line if timestamp is beyond transcript
      matchedLine = transcript[transcript.length - 1];
      matchedIndex = transcript.length - 1;

      // Get buffer sentence (only before, since we're at the end)
      const beforeLines = [];
      for (let j = 1; j <= 2 && matchedIndex - j >= 0; j++) {
        beforeLines.unshift(transcript[matchedIndex - j].text);
      }
      if (beforeLines.length > 0) {
        beforeLine = beforeLines.join(" ");
      }

      const startIdx = Math.max(0, matchedIndex - 8);
      for (let j = startIdx; j <= matchedIndex; j++) {
        contextLines.push(transcript[j].text);
      }
    }

    // Clean up the text with DeepSeek.
    const cleanedText = await cleanupNoteText(
      matchedLine.text,
      beforeLine,
      afterLine,
      contextLines.join(" "),
      videoTitle,
    );

    // Format timestamp as MM:SS
    const minutes = Math.floor(safeTimestamp / 60);
    const seconds = safeTimestamp % 60;
    const formattedTimestamp = `${minutes}:${String(seconds).padStart(2, "0")}`;

    // Create timestamped URL
    const timestampedUrl = `${canonicalVideoUrl}&t=${safeTimestamp}s`;

    // Create the note object
    const note = {
      id: `note_${Date.now()}`,
      videoId: videoId,
      videoTitle:
        typeof videoTitle === "string"
          ? videoTitle.slice(0, 500)
          : "Untitled Video",
      channelName:
        typeof channelName === "string" ? channelName.slice(0, 300) : "",
      timestamp: formattedTimestamp,
      timestampSeconds: safeTimestamp,
      timestampedUrl: timestampedUrl,
      text: cleanedText,
      rawText: matchedLine.text,
      createdAt: Date.now(),
    };

    // Save to storage
    await saveNoteToStorage(note);

    // Notify side panel to refresh notes list
    chrome.runtime.sendMessage({ action: "noteSaved", note }).catch(() => {});

    return { success: true, note };
  } catch (error) {
    console.error("[YouTube Digest] Save note error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Cleans up transcript lines using DeepSeek.
 * Takes the target line plus buffer sentences (1 before, 1 after).
 * Uses JSON output to prevent any preambles from appearing.
 */
async function cleanupNoteText(
  targetText,
  beforeText,
  afterText,
  fullContext,
  videoTitle,
) {
  const settings = await getSettings();
  if (!settings.aiApiKey) {
    return [beforeText, targetText, afterText].filter(Boolean).join(" ");
  }

  try {
    debugLog("[YouTube Digest] Requesting note cleanup");
    const variables = {
      videoTitle: videoTitle || "Unknown",
      fullContext,
      beforeText: beforeText || "(none)",
      targetText,
      afterText: afterText || "(none)",
    };
    const systemPrompt = await loadPromptSection(
      "note-cleanup.md",
      "System prompt",
      variables,
    );
    const userPrompt = await loadPromptSection(
      "note-cleanup.md",
      "User prompt",
      variables,
    );
    const { text: resultText } = await requestAiCompletion({
      maxTokens: 512,
      responseFormat: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    let result = resultText.trim() || targetText;

    // Parse the JSON response (tolerating trailing commas / fences).
    try {
      const parsed = parseLooseJson(result);
      if (typeof parsed.quote === "string" && parsed.quote.trim()) {
        return parsed.quote.trim().slice(0, 3000);
      }
    } catch (parseError) {
      console.warn(
        "[YouTube Digest] JSON parse failed for note, stripping preambles:",
        parseError,
      );
      result = result.replace(
        /^(Here'?s?( the)?( cleaned)?( version)?:?\s*)/i,
        "",
      );
      result = result.replace(
        /^(The cleaned (quote|text|version)( is)?:?\s*)/i,
        "",
      );
      result = result.replace(/^(I will.*?:?\s*)/i, "");
      result = result.replace(/^(Cleaned:?\s*)/i, "");
      result = result.replace(/^["']|["']$/g, "");
    }

    return result.slice(0, 3000);
  } catch (e) {
    console.error("[YouTube Digest] Cleanup error:", e);
  }

  // Return combined raw text if cleanup fails
  return [beforeText, targetText, afterText].filter(Boolean).join(" ");
}

/**
 * Saves a note to chrome.storage.local
 */
async function saveNoteToStorage(note) {
  const result = await chrome.storage.local.get("ytd_notes");
  const notes = result.ytd_notes || [];
  notes.unshift(note); // Add to beginning (newest first)

  // Keep only last 100 notes to prevent storage bloat
  if (notes.length > 100) {
    notes.splice(100);
  }

  await chrome.storage.local.set({ ytd_notes: notes });
}

/**
 * Gets notes from storage, optionally filtered by video ID
 */
async function handleGetNotes(videoId) {
  try {
    const result = await chrome.storage.local.get("ytd_notes");
    let notes = result.ytd_notes || [];

    if (videoId) {
      notes = notes.filter((n) => n.videoId === videoId);
    }

    return { success: true, notes };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Deletes a note by ID
 */
async function handleDeleteNote(noteId) {
  try {
    const result = await chrome.storage.local.get("ytd_notes");
    let notes = result.ytd_notes || [];
    notes = notes.filter((n) => n.id !== noteId);
    await chrome.storage.local.set({ ytd_notes: notes });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function handleExplainSelection(
  selectedText,
  transcriptContext,
  videoTitle,
) {
  try {
    const settings = await getSettings();
    if (!settings.aiApiKey) {
      return {
        success: false,
        error: "NO_AI_KEY",
        message: "DeepSeek API key not configured.",
      };
    }

    const variables = {
      videoTitle: videoTitle || "Unknown",
      selectedText,
      transcriptContext: transcriptContext || "None",
    };
    const systemPrompt = await loadPromptSection(
      "explain.md",
      "System prompt",
      variables,
    );
    const userPrompt = await loadPromptSection(
      "explain.md",
      "User prompt",
      variables,
    );

    debugLog("[YouTube Digest] Requesting selection explanation");
    const { text: explanation } = await requestAiCompletion({
      maxTokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    return {
      success: true,
      explanation: explanation.trim(),
    };
  } catch (error) {
    console.error("Explain selection error:", error);
    return {
      success: false,
      error: error.message || "Failed to explain selection",
    };
  }
}

// ============================================================
// TRANSLATION — Translate transcript batches into Simplified Chinese
// ============================================================
// Uses a low temperature for consistent, natural translations.

/**
 * Shared base rules that every translation prompt includes.
 * These ensure translations sound natural rather than machine-translated.
 *
 * @param {string} targetLanguage - Must be 'zh'
 * @returns {Promise<string>} - The base translation rules
 */
async function getTranslationBaseRules(targetLanguage) {
  if (targetLanguage !== "zh") {
    throw new Error(`Unsupported translation target: ${targetLanguage}`);
  }
  const langName = "Simplified Chinese";
  const langSpecific = await loadPromptSection(
    "translation.md",
    "Chinese rules",
  );
  return loadPromptSection("translation.md", "Shared base rules", {
    langName,
    langSpecific,
  });
}

function validateTranscriptBatchRequest(content) {
  const segments = content?.segments;
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 4) {
    throw new Error("Transcript translation requires 1 to 4 segments");
  }

  const seenIds = new Set();
  let totalCharacters = 0;
  const normalized = segments.map((segment) => {
    const id = typeof segment?.id === "string" ? segment.id.trim() : "";
    const text = typeof segment?.text === "string" ? segment.text.trim() : "";
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(id) || seenIds.has(id)) {
      throw new Error("Transcript translation segment IDs must be unique and stable");
    }
    if (!text || text.length > 4000) {
      throw new Error("Transcript translation segment text is invalid or too long");
    }
    seenIds.add(id);
    totalCharacters += text.length;
    return { id, text };
  });
  if (totalCharacters > 12000) {
    throw new Error("Transcript translation batch is too large");
  }
  return normalized;
}

function looksLikeChineseTranslation(text, sourceText) {
  const latinLetters = (sourceText.match(/[A-Za-z]/g) || []).length;
  if (latinLetters < 20) return true;
  return /[\u3400-\u9fff]/.test(text);
}

/**
 * Aligns untrusted model output by exact stable ID. Missing, duplicated,
 * unknown, empty, or clearly non-Chinese values become explicit row errors.
 */
function normalizeTranslatedSegmentBatch(parsed, sourceSegments) {
  const candidates = Array.isArray(parsed?.segments) ? parsed.segments : [];
  const sourceById = new Map(sourceSegments.map((segment) => [segment.id, segment]));
  const translatedById = new Map();

  candidates.forEach((candidate) => {
    if (
      typeof candidate?.id !== "string" ||
      typeof candidate?.text !== "string" ||
      !sourceById.has(candidate.id) ||
      translatedById.has(candidate.id)
    ) {
      return;
    }
    const text = candidate.text.trim();
    const source = sourceById.get(candidate.id);
    if (text && looksLikeChineseTranslation(text, source.text)) {
      translatedById.set(candidate.id, text);
    }
  });

  return {
    segments: sourceSegments.map((source) => ({
      id: source.id,
      text: translatedById.get(source.id) || "",
      error: translatedById.has(source.id)
        ? ""
        : "Missing or invalid Chinese translation",
    })),
  };
}

/**
 * Translates content using DeepSeek.
 * @param {Object} content - JSON object containing semantic transcript segments
 * @param {string} contentType - 'transcriptBatch' or 'interfaceBatch'
 * @param {string} targetLanguage - 'zh' for Simplified Chinese
 * @param {string} videoTitle - The video title (for context)
 * @returns {Object} - { success, translatedContent } or { success: false, error }
 */
async function handleTranslateContent(
  content,
  contentType,
  targetLanguage,
  videoTitle,
) {
  try {
    if (targetLanguage !== "zh") {
      return {
        success: false,
        error: `Unsupported translation target: ${String(targetLanguage)}`,
      };
    }
    if (!["transcriptBatch", "interfaceBatch"].includes(contentType)) {
      return {
        success: false,
        error: `Unsupported translation content type: ${String(contentType)}`,
      };
    }

    const settings = await getSettings();
    if (!settings.aiApiKey) {
      return { success: false, error: "DeepSeek API key not configured" };
    }

    const sourceSegments = validateTranscriptBatchRequest(content);
    const langName = "Simplified Chinese";
    const baseRules = await getTranslationBaseRules(targetLanguage);
    const promptSection =
      contentType === "transcriptBatch"
        ? "Transcript batch translation"
        : "Interface content translation";
    const systemPrompt = await loadPromptSection(
      "translation.md",
      promptSection,
      {
        langName,
        videoTitle: videoTitle || "Unknown",
        baseRules,
      },
    );
    const userContent = JSON.stringify({ segments: sourceSegments });
    const translationOptions = {
      temperature: 0.2,
      maxTokens: 1536,
      responseFormat: { type: "json_object" },
    };
    let result = await callAiTranslation(
      systemPrompt,
      userContent,
      translationOptions,
    );

    // DeepSeek JSON mode can rarely return an empty content string. The prompt
    // already requires JSON, so retry once without response_format.
    if (!result.success && result.code === "EMPTY_AI_RESPONSE") {
      result = await callAiTranslation(systemPrompt, userContent, {
        temperature: translationOptions.temperature,
        maxTokens: translationOptions.maxTokens,
      });
    }
    if (!result.success) return result;

    const parsed = parseLooseJson(result.text);
    const aligned = normalizeTranslatedSegmentBatch(parsed, sourceSegments);
    if (!aligned.segments.some((segment) => segment.text)) {
      return {
        success: false,
        error: "Translation returned no valid Chinese segments",
      };
    }
    return { success: true, translatedContent: aligned };
  } catch (error) {
    console.error("[YouTube Digest] Translation error:", error);
    return { success: false, error: error.message || "Translation failed" };
  }
}

/**
 * Makes a single DeepSeek call for translation.
 * Uses temperature 0.3 for consistent, predictable translations.
 *
 * @param {string} systemPrompt - The system-level instructions
 * @param {string} userContent - The user message (content to translate)
 * @returns {Object} - { success, text } or { success: false, error }
 */
async function callAiTranslation(
  systemPrompt,
  userContent,
  { temperature = 0.3, maxTokens = 8192, responseFormat } = {},
) {
  try {
    const { text } = await requestAiCompletion({
      temperature,
      maxTokens,
      responseFormat,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    return { success: true, text };
  } catch (error) {
    if (error.status === 429) {
      return {
        success: false,
        error: "Rate limited — try again in a moment",
        code: "RATE_LIMITED",
      };
    }
    return { success: false, error: error.message, code: error.code };
  }
}

// Pure validators are exposed for the repository's Node tests only.
globalThis.__YTD_TRANSLATION_TESTING__ = {
  requestAiCompletion,
  callAiTranslation,
  validateTranscriptBatchRequest,
  normalizeTranslatedSegmentBatch,
  handleSaveNote,
  handleTranslateContent,
  closePanelForTab,
  updatePanelForTab,
  resolveSelectionContext,
  validateContextualGlossResponse,
  handleContextualGloss,
  getCorpusSettings,
  recordCorpusExport,
  resolveVideoNoteDestination,
  savePracticeHighlight,
  getPracticeHighlights,
  validatePracticeMaterials,
  handlePracticeMaterials,
  splitQuestionBankSource,
  validateBundledIeltsBank,
  previewQuestionBankImport,
  saveQuestionBank,
  renameQuestionBank,
  listQuestionBanks,
  deleteQuestionBank,
};

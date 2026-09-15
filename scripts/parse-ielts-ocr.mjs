#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const questionBank = require("../question-bank.js");
const LOW_CONFIDENCE = 0.75;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const VISUAL_ROW_TOLERANCE = 0.004;
const DEFAULT_APPROVED_PAGE_COUNT = 46;

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function matchingText(value) {
  return cleanText(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/^part\s*[il|](?=\b)/i, "Part1");
}

function stripListPrefix(value) {
  return cleanText(value).replace(/^\s*(?:\(?\d{1,2}\)?\s*[.)、:]|[-•·▪●])\s*/, "");
}

function partHeading(value) {
  const match = matchingText(value).match(/^part\s*([123ilh])\b/i);
  if (!match) return null;
  return `part${/[ilh]/i.test(match[1]) ? "1" : match[1]}`;
}

function isCueInstruction(value) {
  return /^(?:describe|talk about)\b/i.test(matchingText(stripListPrefix(value)));
}

function looksLikeQuestion(value) {
  return /^(?:what|why|how|when|where|who|which|do|does|did|is|are|was|were|can|could|would|will|have|has|had|should|may|might)\b/i
    .test(matchingText(value));
}

function warningReason(reasons) {
  return [...reasons].join("; ");
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizedBankPayload(bank) {
  const normalized = questionBank.normalizeBank(bank);
  if (!normalized) throw new Error("IELTS bank payload is invalid.");
  return normalized;
}

function validatePageRecords(pages, expectedPageCount = null) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("OCR pages must be a non-empty array.");
  }
  const seen = new Set();
  for (const page of pages) {
    if (!Number.isInteger(page?.page) || page.page < 1 || !Array.isArray(page.lines)) {
      throw new Error("Every OCR page must have a positive integer page number and a lines array.");
    }
    if (seen.has(page.page)) throw new Error(`Duplicate OCR page record: ${page.page}.`);
    seen.add(page.page);
  }
  if (expectedPageCount !== null) {
    if (!Number.isInteger(expectedPageCount) || expectedPageCount < 1) {
      throw new Error("Expected OCR page count must be a positive integer.");
    }
    if (pages.length !== expectedPageCount || [...Array(expectedPageCount).keys()].some((index) => !seen.has(index + 1))) {
      throw new Error(`Expected ${expectedPageCount} OCR pages numbered 1 through ${expectedPageCount}.`);
    }
  }
}

function applyReviewedCorrections(pages, review) {
  if (!review || typeof review !== "object") {
    throw new Error("An approved review artifact is required.");
  }
  if (review.schemaVersion !== 1) throw new Error("Review schemaVersion must be 1.");
  if (review.status !== "approved") throw new Error("Review status must be approved.");
  if (!SHA256_PATTERN.test(review.sourcePdfSha256 || "")) {
    throw new Error("Review sourcePdfSha256 must be a SHA-256 digest.");
  }
  if (review.ocrSha256 !== digest(pages)) throw new Error("Review OCR digest does not match the input.");
  if (review.pageCount !== pages.length) throw new Error("Review page count does not match the input.");
  if (typeof review.reviewedAt !== "string" || !review.reviewedAt.trim()) {
    throw new Error("Review reviewedAt is required.");
  }
  if (!Array.isArray(review.reviewedPages) || review.reviewedPages.length !== pages.length) {
    throw new Error("Every OCR page must have one reviewed-page record.");
  }

  const pagesByNumber = new Map(pages.map((page) => [page.page, page]));
  const reviewedNumbers = new Set();
  for (const record of review.reviewedPages) {
    const page = pagesByNumber.get(record?.page);
    if (!page || reviewedNumbers.has(record.page)) {
      throw new Error("Reviewed pages must match every OCR page exactly once.");
    }
    if (record.status !== "reviewed") throw new Error(`Page ${record.page} is not marked reviewed.`);
    if (record.ocrSha256 !== digest(page)) throw new Error(`Page ${record.page} review digest is stale.`);
    reviewedNumbers.add(record.page);
  }

  const corrected = pages.map((page) => ({
    ...page,
    lines: page.lines.map((line) => ({ ...line })),
  }));
  const originalByNumber = new Map(pages.map((page) => [page.page, page]));
  const correctedByNumber = new Map(corrected.map((page) => [page.page, page]));
  const corrections = Array.isArray(review.corrections) ? review.corrections : [];
  const correctedTargets = new Set();
  for (const correction of corrections) {
    if (correction?.operation !== "replace") {
      throw new Error(`Unsupported review correction operation on page ${correction?.page ?? "unknown"}.`);
    }
    const originalPage = originalByNumber.get(correction.page);
    const page = correctedByNumber.get(correction.page);
    const original = cleanText(correction.original);
    const replacement = cleanText(correction.replacement);
    if (!page || !originalPage || !original || !replacement) throw new Error("Review replacements require page, original, and replacement.");
    const matches = originalPage.lines
      .map((line, index) => cleanText(line.text) === original ? index : -1)
      .filter((index) => index >= 0);
    if (matches.length !== 1 || correctedTargets.has(`${correction.page}:${matches[0]}`)) {
      throw new Error(`Review replacement on page ${correction.page} must target one immutable original OCR line exactly once.`);
    }
    correctedTargets.add(`${correction.page}:${matches[0]}`);
    page.lines[matches[0]].text = replacement;
  }

  return {
    pages: corrected,
    approval: {
      status: "approved",
      schemaVersion: 1,
      sourcePdfSha256: review.sourcePdfSha256,
      ocrSha256: review.ocrSha256,
      pageCount: review.pageCount,
      reviewedPageCount: review.reviewedPages.length,
      correctionsApplied: corrections.length,
      reviewedAt: review.reviewedAt,
    },
  };
}

function validateBeforeNormalization(rawQuestions) {
  if (rawQuestions.length === 0) throw new Error("IELTS OCR conversion produced zero questions.");
  if (rawQuestions.length > questionBank.LIMITS.maxQuestionsPerBank) {
    throw new Error(`Question count exceeds ${questionBank.LIMITS.maxQuestionsPerBank}.`);
  }
  const ids = new Set();
  for (const question of rawQuestions) {
    const page = question.sourcePage;
    if (question.question.length > questionBank.LIMITS.maxQuestionChars) {
      throw new Error(`Question exceeds ${questionBank.LIMITS.maxQuestionChars} characters on page ${page}.`);
    }
    if (question.topic.length > questionBank.LIMITS.maxQuestionChars) {
      throw new Error(`Topic exceeds ${questionBank.LIMITS.maxQuestionChars} characters on page ${page}.`);
    }
    if (question.cuePoints.length > questionBank.LIMITS.maxCuePoints) {
      throw new Error(`Cue card has ${question.cuePoints.length} points on page ${page}; maximum is ${questionBank.LIMITS.maxCuePoints}.`);
    }
    for (const cuePoint of question.cuePoints) {
      if (cuePoint.length > questionBank.LIMITS.maxCuePointChars) {
        throw new Error(`Cue point exceeds ${questionBank.LIMITS.maxCuePointChars} characters on page ${page}.`);
      }
    }
    const id = questionBank.makeQuestionId(question);
    if (ids.has(id)) throw new Error(`Duplicate question would be lost during normalization on page ${page}.`);
    ids.add(id);
  }
}

export function validateCompleteIeltsBank(bank, { requireApproval = true } = {}) {
  if (!bank || typeof bank !== "object" || !Array.isArray(bank.questions) || bank.questions.length === 0) {
    throw new Error("IELTS bank has zero questions.");
  }
  if (requireApproval && bank.approval?.status !== "approved") {
    throw new Error("IELTS bank requires an approved review marker.");
  }
  const counts = Object.fromEntries(["part1", "part2", "part3"].map((part) => [
    part,
    bank.questions.filter((question) => question.part === part).length,
  ]));
  for (const [part, count] of Object.entries(counts)) {
    if (count === 0) throw new Error(`${part.replace("part", "Part ")} count must be greater than zero.`);
  }
  const byId = new Map();
  for (const question of bank.questions) {
    if (!question.id || byId.has(question.id)) throw new Error("IELTS bank contains duplicate or missing IDs.");
    byId.set(question.id, question);
  }
  for (const question of bank.questions) {
    if (question.part === "part3" && !cleanText(question.parentCueCardId)) {
      throw new Error(`Part 3 question ${question.id} requires a parentCueCardId.`);
    }
    if (!question.parentCueCardId) continue;
    const parent = byId.get(question.parentCueCardId);
    if (!parent || parent.part !== "part2") {
      throw new Error(`Question ${question.id} has a dangling parentCueCardId.`);
    }
  }
  if (requireApproval) {
    const expectedDigest = digest(normalizedBankPayload(bank));
    if (bank.approval?.bankSha256 !== expectedDigest) {
      throw new Error("Approved bank digest does not match the normalized payload.");
    }
  }
  return counts;
}

export function parseIeltsOcrPages(pages, bankMeta = {}) {
  validatePageRecords(pages, bankMeta.review ? DEFAULT_APPROVED_PAGE_COUNT : null);
  const reviewed = bankMeta.review
    ? applyReviewedCorrections(pages, bankMeta.review)
    : { pages, approval: null };
  const id = cleanText(bankMeta.id) || "ielts-local";
  const season = cleanText(bankMeta.season);
  const bank = {
    id,
    name: cleanText(bankMeta.name) || (season ? `IELTS ${season}` : "IELTS local question bank"),
    source: "bundled_ielts",
    profiles: ["ielts"],
    createdAt: Number.isFinite(bankMeta.createdAt) ? bankMeta.createdAt : 0,
  };
  const rawQuestions = [];
  const warningRecords = new Map();
  let sequence = 0;

  const visualLines = reviewed.pages
    .flatMap((pageRecord) => {
      const page = Number.isFinite(pageRecord?.page) ? pageRecord.page : 0;
      return (Array.isArray(pageRecord?.lines) ? pageRecord.lines : []).map((line) => ({
        page,
        text: cleanText(line?.text),
        confidence: Number.isFinite(line?.confidence) ? line.confidence : 0,
        x: Number.isFinite(line?.x) ? line.x : 0,
        y: Number.isFinite(line?.y) ? line.y : 0,
        sequence: sequence++,
      }));
    })
    .filter((line) => line.text)
    .sort((first, second) => (
      first.page - second.page
      || second.y - first.y
      || first.sequence - second.sequence
    ));
  const visualRows = [];
  for (const line of visualLines) {
    const row = visualRows[visualRows.length - 1];
    if (row && row.page === line.page && Math.abs(row.y - line.y) <= VISUAL_ROW_TOLERANCE) {
      row.lines.push(line);
    } else {
      visualRows.push({ page: line.page, y: line.y, lines: [line] });
    }
  }
  const orderedLines = visualRows
    .flatMap((row) => row.lines.sort((first, second) => (
      first.x - second.x
      || first.sequence - second.sequence
    )));

  function warn(line, reason) {
    const key = line.sequence;
    const current = warningRecords.get(key) || { line, reasons: new Set() };
    current.reasons.add(reason);
    warningRecords.set(key, current);
  }

  let part = null;
  let topic = "";
  let awaitingTopic = false;
  let collectingCuePoints = false;
  let currentCue = null;
  let lastCueCardId = null;
  let pendingCueParts = null;
  let pendingCuePage = null;

  function addCue(question, page = pendingCuePage) {
    const cue = {
      bankId: id,
      source: "bundled_ielts",
      profiles: ["ielts"],
      part: "part2",
      topic: topic || question,
      question,
      cuePoints: [],
      parentCueCardId: null,
      season,
      createdAt: bank.createdAt,
      sourcePage: page,
    };
    rawQuestions.push(cue);
    currentCue = cue;
    lastCueCardId = questionBank.makeQuestionId(cue);
    topic = cue.topic;
    pendingCueParts = null;
    pendingCuePage = null;
    awaitingTopic = false;
    return cue;
  }

  function finalizePendingCue() {
    if (!pendingCueParts?.length) return null;
    return addCue(cleanText(pendingCueParts.join(" ")));
  }

  function numberedText(value) {
    const match = cleanText(value).match(/^\s*\(?\d{1,2}\)?\s*[.)、:]\s*(.+)$/);
    return match ? cleanText(match[1]) : null;
  }

  function nextUsableLine(startIndex) {
    for (let index = startIndex + 1; index < orderedLines.length; index += 1) {
      if (orderedLines[index].confidence >= LOW_CONFIDENCE) return orderedLines[index];
    }
    return null;
  }

  function wrappedQuestionAt(startIndex) {
    const first = numberedText(orderedLines[startIndex].text);
    if (!first) return null;
    const parts = [first];
    let endIndex = startIndex;
    for (let index = startIndex + 1; index < orderedLines.length; index += 1) {
      const candidate = orderedLines[index];
      if (candidate.confidence < LOW_CONFIDENCE || candidate.y < 0.06 || candidate.y > 0.97) {
        if (candidate.confidence < LOW_CONFIDENCE) warn(candidate, "low-confidence");
        warn(candidate, "unparsed");
        endIndex = index;
        continue;
      }
      if (
        partHeading(candidate.text)
        || /^you should say\s*:?$/i.test(matchingText(candidate.text))
        || /^say\s*:?$/i.test(matchingText(candidate.text))
        || numberedText(candidate.text) !== null
        || isCueInstruction(candidate.text)
      ) {
        break;
      }
      parts.push(cleanText(candidate.text));
      endIndex = index;
      if (cleanText(candidate.text).endsWith("?")) {
        return { question: cleanText(parts.join(" ")), endIndex };
      }
    }
    return null;
  }

  for (let index = 0; index < orderedLines.length; index += 1) {
    const line = orderedLines[index];
    if (line.confidence < LOW_CONFIDENCE) warn(line, "low-confidence");

    if (line.y < 0.06 || line.y > 0.97) {
      warn(line, "unparsed");
      continue;
    }

    const heading = partHeading(line.text);
    if (heading) {
      finalizePendingCue();
      part = heading;
      collectingCuePoints = false;
      currentCue = null;
      awaitingTopic = heading !== "part3";
      if (heading !== "part3") topic = "";
      continue;
    }

    if (line.confidence < LOW_CONFIDENCE) {
      warn(line, "unparsed");
      continue;
    }

    if (!part) {
      warn(line, "unparsed");
      continue;
    }

    const cueMarker = /^you should say\s*:?$/i.test(matchingText(line.text))
      || (pendingCueParts && /^say\s*:?$/i.test(matchingText(line.text)));
    if (cueMarker) {
      if (part === "part2" && (currentCue || pendingCueParts)) {
        if (!currentCue) finalizePendingCue();
        collectingCuePoints = true;
      } else {
        warn(line, "unparsed");
      }
      continue;
    }

    const text = stripListPrefix(line.text);
    const numbered = numberedText(line.text) !== null;

    if (part === "part2" && pendingCueParts) {
      pendingCueParts.push(text);
      continue;
    }

    if (part === "part2" && collectingCuePoints) {
      if (numbered && text.endsWith("?")) {
        part = "part3";
        collectingCuePoints = false;
        currentCue = null;
      } else {
        if (text) currentCue.cuePoints.push(text);
        continue;
      }
    }

    if (part === "part2" && isCueInstruction(text)) {
      const inlineMarker = text.match(/^(.*?)\s+you should(?:\s+say\s*:?)?$/i);
      const instruction = cleanText(inlineMarker ? inlineMarker[1] : text);
      if (/\byou should say\s*:?$/i.test(text)) {
        addCue(instruction, line.page);
        collectingCuePoints = true;
      } else {
        pendingCueParts = [instruction];
        pendingCuePage = line.page;
      }
      continue;
    }

    if (numbered && !text.endsWith("?")) {
      const wrapped = wrappedQuestionAt(index);
      if (wrapped) {
        rawQuestions.push({
          bankId: id,
          source: "bundled_ielts",
          profiles: ["ielts"],
          part,
          topic: topic || "General",
          question: wrapped.question,
          cuePoints: [],
          parentCueCardId: part === "part3" ? lastCueCardId : null,
          season,
          createdAt: bank.createdAt,
          sourcePage: line.page,
        });
        index = wrapped.endIndex;
        awaitingTopic = false;
        continue;
      }

      const next = nextUsableLine(index);
      if (
        part === "part1"
        && numberedText(next?.text) !== null
        && !looksLikeQuestion(text)
      ) {
        topic = text;
        awaitingTopic = false;
        continue;
      }
      warn(line, "unparsed");
      continue;
    }

    if (text.endsWith("?")) {
      if (awaitingTopic && !topic) topic = "General";
      rawQuestions.push({
        bankId: id,
        source: "bundled_ielts",
        profiles: ["ielts"],
        part,
        topic: topic || "General",
        question: text,
        cuePoints: [],
        parentCueCardId: part === "part3" ? lastCueCardId : null,
        season,
        createdAt: bank.createdAt,
        sourcePage: line.page,
      });
      awaitingTopic = false;
      continue;
    }

    if (awaitingTopic) {
      topic = text;
      awaitingTopic = false;
      continue;
    }

    warn(line, "unparsed");
  }

  finalizePendingCue();

  validateBeforeNormalization(rawQuestions);

  const normalized = questionBank.normalizeBank({
    ...bank,
    questions: rawQuestions,
  });
  const warnings = [...warningRecords.values()]
    .sort((first, second) => (
      first.line.page - second.line.page
      || second.line.y - first.line.y
      || first.line.x - second.line.x
      || first.line.sequence - second.line.sequence
    ))
    .map(({ line, reasons }) => ({
      page: line.page,
      text: line.text,
      reason: warningReason(reasons),
    }));

  if (normalized.questions.length !== rawQuestions.length) {
    throw new Error("Normalization would silently drop parsed questions.");
  }
  const result = { ...normalized, warnings };
  if (reviewed.approval) {
    result.approval = {
      ...reviewed.approval,
      bankSha256: digest(normalizedBankPayload(normalized)),
    };
  }
  return result;
}

function seasonFromPath(inputPath) {
  return path.basename(inputPath).match(/20\d{2}-\d{2}_\d{2}/)?.[0] || "";
}

function runCli(argv) {
  if (argv.length === 2) {
    console.error("IELTS OCR parse failed: an approved review artifact is required.");
    process.exitCode = 2;
    return;
  }
  if (argv.length !== 3) {
    console.error("Usage: node scripts/parse-ielts-ocr.mjs INPUT.json OUTPUT.json REVIEW.json");
    process.exitCode = 2;
    return;
  }

  const [inputPath, outputPath, reviewPath] = argv;
  try {
    const pages = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
    const season = seasonFromPath(inputPath);
    const result = parseIeltsOcrPages(pages, {
      id: season ? `ielts-${season}` : "ielts-local",
      season,
      review,
    });
    validateCompleteIeltsBank(result);
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    const counts = Object.fromEntries(["part1", "part2", "part3"].map((partName) => [
      partName,
      result.questions.filter((question) => question.part === partName).length,
    ]));
    console.error(`Parsed ${result.questions.length} questions (${Object.entries(counts)
      .map(([partName, count]) => `${partName}: ${count}`)
      .join(", ")}); warnings: ${result.warnings.length}.`);
  } catch (error) {
    console.error(`IELTS OCR parse failed: ${error.message}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) runCli(process.argv.slice(2));

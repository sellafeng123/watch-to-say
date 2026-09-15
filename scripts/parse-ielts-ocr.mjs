#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const questionBank = require("../question-bank.js");
const LOW_CONFIDENCE = 0.75;

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

export function parseIeltsOcrPages(pages, bankMeta = {}) {
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

  const orderedLines = (Array.isArray(pages) ? pages : [])
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
      || first.x - second.x
      || first.sequence - second.sequence
    ));

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

  function addCue(question) {
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
    };
    rawQuestions.push(cue);
    currentCue = cue;
    lastCueCardId = questionBank.makeQuestionId(cue);
    topic = cue.topic;
    pendingCueParts = null;
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
      if (candidate.confidence < LOW_CONFIDENCE) break;
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
        addCue(instruction);
        collectingCuePoints = true;
      } else {
        pendingCueParts = [instruction];
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

  return { ...normalized, warnings };
}

function seasonFromPath(inputPath) {
  return path.basename(inputPath).match(/20\d{2}-\d{2}_\d{2}/)?.[0] || "";
}

function runCli(argv) {
  if (argv.length !== 2) {
    console.error("Usage: node scripts/parse-ielts-ocr.mjs INPUT.json OUTPUT.json");
    process.exitCode = 2;
    return;
  }

  const [inputPath, outputPath] = argv;
  try {
    const pages = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    const season = seasonFromPath(inputPath);
    const result = parseIeltsOcrPages(pages, {
      id: season ? `ielts-${season}` : "ielts-local",
      season,
    });
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

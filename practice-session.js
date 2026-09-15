const YTD_PRACTICE = (() => {
  const STAGES = ["listening", "internalization", "speaking"];
  const RATINGS = new Set(["mastered", "review"]);
  const KINDS = new Set(["word", "phrase", "sentence_frame"]);
  const PROFILES = {
    ielts: "雅思口语题型与高频主题",
    work: "职场",
    daily: "日常聊天",
    travel: "旅行",
    custom_ielts: "我导入的雅思题库",
  };
  const MAX_HIGHLIGHTS = 80;
  const MAX_ANCHORS_PER_HIGHLIGHT = 8;

  function cleanText(value, limit = 800) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "";
  }

  function splitSentences(value) {
    const text = cleanText(value, 4000);
    if (!text) return [];
    return text.match(/[^.!?。！？]+(?:[.!?。！？]+["'”’）】》]*)|[^.!?。！？]+$/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) || [];
  }

  function expressionTokens(value, limit = 300) {
    return cleanText(value, limit).toLocaleLowerCase().match(/[a-z]+(?:'[a-z]+)?|[\u4e00-\u9fff]+/g) || [];
  }

  function inflectedExpressionSpan(source, expression) {
    const targets = expressionTokens(expression).map(normalizeExpressionToken);
    if (!targets.length) return null;
    const words = [...cleanText(source, 4000).matchAll(/[a-z]+(?:'[a-z]+)?|[\u4e00-\u9fff]+/gi)]
      .map((match) => ({ index: match.index, length: match[0].length, token: normalizeExpressionToken(match[0]) }));
    for (let index = 0; index <= words.length - targets.length; index += 1) {
      if (targets.every((token, offset) => words[index + offset].token === token)) {
        return { index: words[index].index, length: words[index + targets.length - 1].index + words[index + targets.length - 1].length - words[index].index };
      }
    }
    return null;
  }

  function normalizeExpressionToken(token) {
    const value = token.toLocaleLowerCase();
    const irregular = { got: "get", gotten: "get", went: "go", gone: "go", did: "do", done: "do", was: "be", were: "be" };
    if (irregular[value]) return irregular[value];
    if (value.endsWith("ies") && value.length > 4) return `${value.slice(0, -3)}y`;
    if (value.endsWith("ing") && value.length > 5) {
      const base = value.slice(0, -3);
      return base.length > 2 && base.at(-1) === base.at(-2) ? base.slice(0, -1) : base;
    }
    if (value.endsWith("ed") && value.length > 4) return value.slice(0, -2);
    if (value.endsWith("es") && value.length > 4) return value.slice(0, -2);
    if (value.endsWith("s") && value.length > 3) return value.slice(0, -1);
    return value;
  }

  function sentenceHasExpressionTokens(sentence, expression) {
    const targets = expressionTokens(expression).map(normalizeExpressionToken);
    if (!targets.length) return false;
    const words = new Set(expressionTokens(sentence, 4000).map(normalizeExpressionToken));
    return targets.every((token) => words.has(token));
  }

  function referenceUsesExpression(text, { selectedText, expression } = {}) {
    const source = cleanText(text, 1000).toLocaleLowerCase();
    const selected = cleanText(selectedText, 300).toLocaleLowerCase();
    return Boolean(source && ((selected && source.includes(selected)) || inflectedExpressionSpan(source, expression)));
  }

  function referenceContextTokens(reference, selectedText, expression) {
    const targetTokens = new Set([
      ...expressionTokens(selectedText),
      ...expressionTokens(expression),
    ].map(normalizeExpressionToken));
    return new Set(expressionTokens(reference)
      .map(normalizeExpressionToken)
      .filter((token) => !targetTokens.has(token)));
  }

  function referencesHaveDistinctContexts(references, { selectedText, expression } = {}) {
    if (!Array.isArray(references) || references.length !== 3) return false;
    const contexts = references.map((reference) => referenceContextTokens(reference, selectedText, expression));
    if (contexts.some((context) => !context.size)) return false;
    return contexts.every((left, index) => contexts.slice(index + 1).every((right) => {
      const shared = [...left].filter((token) => right.has(token)).length;
      return shared / Math.min(left.size, right.size) < 0.75;
    }));
  }

  function shortestClause(text) {
    const clauses = cleanText(text, 4000).match(/[^,;:，；：.!?。！？]+[,;:，；：.!?。！？]*/g)
      ?.map((clause) => clause.trim())
      .filter(Boolean) || [];
    return (clauses.sort((left, right) => left.length - right.length)[0] || cleanText(text, 320)).slice(0, 320);
  }

  function targetExpressionSpan(source, selectedText, expression) {
    const lowerSource = source.toLocaleLowerCase();
    const needles = [selectedText, expression]
      .map((value) => cleanText(value, 300).toLocaleLowerCase())
      .filter(Boolean);
    return needles
      .map((needle) => ({ index: lowerSource.indexOf(needle), length: needle.length }))
      .find((candidate) => candidate.index >= 0) || inflectedExpressionSpan(source, expression);
  }

  function boundedTargetWindow(text, selectedText, expression) {
    const source = cleanText(text, 4000);
    if (source.length <= 320) return source;
    const match = targetExpressionSpan(source, selectedText, expression);
    if (!match) return shortestClause(source);
    const availableBefore = Math.floor((320 - match.length) / 2);
    const start = Math.max(0, Math.min(match.index - availableBefore, source.length - 320));
    return source.slice(start, start + 320).trim();
  }

  function answerForSentence(sentence, context, selectedText, expression) {
    return sentence.length <= 320 || /[.!?。！？]/.test(sentence)
      ? sentence
      : boundedTargetWindow(context, selectedText, expression);
  }

  function extractAnswerSentence({ context, selectedText, expression, targetText } = {}) {
    const sentences = splitSentences(context);
    const target = cleanText(targetText, 4000);
    if (target) {
      if (target.length > 320) {
        return targetExpressionSpan(target, selectedText, expression)
          ? boundedTargetWindow(target, selectedText, expression)
          : boundedTargetWindow(context, selectedText, expression);
      }
      const anchored = sentences.find((sentence) => sentence.toLocaleLowerCase().includes(target.toLocaleLowerCase()));
      if (anchored && /[.!?。！？]/.test(anchored)) return anchored;
      return target;
    }
    const selected = cleanText(selectedText, 300).toLocaleLowerCase();
    if (selected) {
      const exact = sentences.find((sentence) => sentence.toLocaleLowerCase().includes(selected));
      if (exact) return answerForSentence(exact, context, selectedText, expression);
    }
    const expressionMatch = sentences.find((sentence) => sentenceHasExpressionTokens(sentence, expression));
    return expressionMatch
      ? answerForSentence(expressionMatch, context, selectedText, expression)
      : shortestClause(context);
  }

  function normalizeKey(value) {
    return cleanText(value, 300).toLocaleLowerCase();
  }

  function makeId(expression, partOfSpeech) {
    const source = `${normalizeKey(expression)}\u0000${normalizeKey(partOfSpeech)}`;
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `practice-${(hash >>> 0).toString(36)}`;
  }

  function normalizeAnchor(entry) {
    const timestampSeconds = Math.floor(Number(entry?.timestampSeconds));
    if (!Number.isFinite(timestampSeconds) || timestampSeconds < 0) return null;
    return {
      timestamp: cleanText(entry.timestamp, 30) || formatTimestamp(timestampSeconds),
      timestampSeconds,
      timestampedUrl: cleanText(entry.timestampedUrl, 2000),
      selectedText: cleanText(entry.selectedText || entry.expression, 300),
      targetText: cleanText(entry.targetText, 1800),
      context: cleanText(entry.context, 1800),
    };
  }

  function normalizeHighlight(entry) {
    const expression = cleanText(entry?.expression, 240);
    const partOfSpeech = cleanText(entry?.partOfSpeech, 120);
    const anchor = normalizeAnchor(entry);
    if (!expression || !partOfSpeech || !anchor) return null;
    return {
      id: makeId(expression, partOfSpeech),
      expression,
      kind: KINDS.has(entry.kind) ? entry.kind : "phrase",
      partOfSpeech,
      usageContexts: cleanText(entry.usageContexts, 120),
      spokenFrequency: cleanText(entry.spokenFrequency, 40),
      anchors: [anchor],
    };
  }

  function mergePracticeHighlights(entries) {
    if (!Array.isArray(entries)) return [];
    const merged = new Map();
    entries.forEach((entry) => {
      const normalized = entry?.anchors ? normalizeMergedHighlight(entry) : normalizeHighlight(entry);
      if (!normalized) return;
      const existing = merged.get(normalized.id);
      if (!existing) {
        merged.set(normalized.id, normalized);
        return;
      }
      const anchors = [...existing.anchors, ...normalized.anchors]
        .filter((anchor, index, all) => all.findIndex((candidate) =>
          candidate.timestampSeconds === anchor.timestampSeconds && candidate.selectedText === anchor.selectedText,
        ) === index)
        .sort((left, right) => left.timestampSeconds - right.timestampSeconds)
        .slice(0, MAX_ANCHORS_PER_HIGHLIGHT);
      merged.set(normalized.id, { ...existing, anchors });
    });
    return [...merged.values()].slice(0, MAX_HIGHLIGHTS);
  }

  function normalizeMergedHighlight(entry) {
    const firstAnchor = Array.isArray(entry.anchors) ? entry.anchors[0] : null;
    const base = normalizeHighlight({ ...entry, ...firstAnchor });
    if (!base) return null;
    const anchors = entry.anchors
      .map((anchor) => normalizeAnchor(anchor))
      .filter(Boolean)
      .slice(0, MAX_ANCHORS_PER_HIGHLIGHT);
    return anchors.length ? { ...base, anchors } : null;
  }

  function formatTimestamp(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
  }

  function createSession({ video, highlights, profile = "ielts" } = {}) {
    const items = mergePracticeHighlights(highlights).map((highlight) => ({
      ...highlight,
      stages: { listening: "not_started", internalization: "not_started", speaking: "not_started" },
    }));
    const videoId = cleanText(video?.id, 100);
    return {
      id: `session-${makeId(`${videoId}:${items.map((item) => item.id).join(",")}`, "practice")}`,
      video: { id: videoId, title: cleanText(video?.title, 500) },
      profile: Object.hasOwn(PROFILES, profile) ? profile : "ielts",
      selectedItemIds: items.map((item) => item.id),
      items,
      retriedStageKeys: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function stageIsAvailable(item, stage) {
    if (stage === "listening") return true;
    if (stage === "internalization") return item.stages.listening === "mastered";
    return item.stages.internalization === "mastered";
  }

  function rateStage(session, { itemId, stage, rating, retry = false } = {}) {
    if (!session || !STAGES.includes(stage) || !RATINGS.has(rating)) return null;
    const target = session.items?.find((item) => item.id === itemId);
    if (!target || !session.selectedItemIds?.includes(itemId) || !stageIsAvailable(target, stage)) return null;
    const stageKey = `${itemId}:${stage}`;
    const items = session.items.map((item) => item.id === itemId
      ? { ...item, stages: { ...item.stages, [stage]: rating } }
      : item);
    const retriedStageKeys = retry && !session.retriedStageKeys.includes(stageKey)
      ? [...session.retriedStageKeys, stageKey]
      : [...session.retriedStageKeys];
    return { ...session, items, retriedStageKeys, updatedAt: Date.now() };
  }

  function selectedItems(session) {
    return (session?.items || []).filter((item) => session.selectedItemIds?.includes(item.id));
  }

  function nextRetryTasks(session) {
    return selectedItems(session).flatMap((item) => STAGES
      .filter((stage) => item.stages[stage] === "review")
      .map((stage) => ({ itemId: item.id, stage }))
      .filter((task) => !session.retriedStageKeys?.includes(`${task.itemId}:${task.stage}`)));
  }

  function stageCounts(session, stage) {
    const eligible = selectedItems(session).filter((item) => stageIsAvailableForSummary(item, stage));
    return {
      mastered: eligible.filter((item) => item.stages[stage] === "mastered").length,
      review: eligible.filter((item) => item.stages[stage] === "review").length,
    };
  }

  function stageIsAvailableForSummary(item, stage) {
    if (stage === "listening") return true;
    if (stage === "internalization") return item.stages.listening === "mastered" || item.stages.internalization === "review";
    return item.stages.internalization === "mastered" || item.stages.speaking === "review";
  }

  function markdownText(value) {
    return cleanText(value, 500).replace(/([\\`*_{}\[\]()#+!|])/g, "\\$1");
  }

  function stageLabel(stage) {
    return { listening: "听辨", internalization: "内化", speaking: "输出" }[stage] || stage;
  }

  function buildPracticeSummaryMarkdown(session, date = new Date()) {
    const safeDate = date instanceof Date ? date : new Date(date);
    const datePart = Number.isNaN(safeDate.getTime())
      ? ""
      : `${safeDate.getUTCFullYear()}-${String(safeDate.getUTCMonth() + 1).padStart(2, "0")}-${String(safeDate.getUTCDate()).padStart(2, "0")}`;
    const lines = [`## 本期表达练习 · ${datePart}`, "", `- 输出档案：${PROFILES[session?.profile] || PROFILES.ielts}`];
    STAGES.forEach((stage) => {
      const counts = stageCounts(session, stage);
      lines.push(`- ${stageLabel(stage)}：${counts.mastered} 会 / ${counts.review} 待复习`);
    });
    const pending = selectedItems(session).flatMap((item) => STAGES
      .filter((stage) => item.stages[stage] === "review")
      .map((stage) => `${markdownText(item.expression)}（${stageLabel(stage)}）`));
    lines.push(`- 待复习：${pending.length ? pending.join("；") : "—"}`, "");
    return lines.join("\n");
  }

  return {
    STAGES,
    PROFILES,
    extractAnswerSentence,
    referenceUsesExpression,
    referencesHaveDistinctContexts,
    mergePracticeHighlights,
    createSession,
    rateStage,
    nextRetryTasks,
    stageCounts,
    buildPracticeSummaryMarkdown,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = YTD_PRACTICE;

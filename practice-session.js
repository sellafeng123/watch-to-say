var YTD_PRACTICE = (() => {
  const STAGES = ["listening", "internalization"];
  const RATINGS = new Set(["mastered", "review"]);
  const SPEAKING_OUTCOMES = new Set(["needs_practice", "finished"]);
  const SPEAKING_SOURCES = new Set(["bundled_ielts", "learner_bank", "deepseek"]);
  const SPEAKING_PARTS = new Set(["part1", "part2", "part3"]);
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
    const irregular = { got: "get", gotten: "get", went: "go", gone: "go", did: "do", done: "do", was: "be", were: "be", lives: "life" };
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
    const source = cleanText(text, 4000).toLocaleLowerCase();
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

  function hasSentenceTerminator(sentence) {
    return /[.!?。！？]+["'”’）】》]*$/.test(sentence);
  }

  function sharedTokenRunLength(left, right) {
    const leftTokens = expressionTokens(left, 4000).map(normalizeExpressionToken);
    const rightTokens = expressionTokens(right, 4000).map(normalizeExpressionToken);
    let longest = 0;
    let previous = new Array(rightTokens.length + 1).fill(0);
    for (const leftToken of leftTokens) {
      const current = new Array(rightTokens.length + 1).fill(0);
      rightTokens.forEach((rightToken, index) => {
        if (leftToken !== rightToken) return;
        current[index + 1] = previous[index] + 1;
        longest = Math.max(longest, current[index + 1]);
      });
      previous = current;
    }
    return longest;
  }

  function targetSentenceScore(sentence, target) {
    const normalizedSentence = sentence.toLocaleLowerCase();
    const normalizedTarget = target.toLocaleLowerCase();
    if (normalizedSentence.includes(normalizedTarget)) return normalizedTarget.length;
    if (normalizedTarget.includes(normalizedSentence)) return normalizedSentence.length;
    return sharedTokenRunLength(sentence, target);
  }

  function extractAnswerSentence({ context, selectedText, expression, targetText } = {}) {
    const sentences = splitSentences(context);
    const target = cleanText(targetText, 4000);
    if (target) {
      const candidates = sentences.filter((sentence) =>
        referenceUsesExpression(sentence, { selectedText, expression }),
      );
      const bestMatch = candidates
        .map((sentence) => ({ sentence, score: targetSentenceScore(sentence, target) }))
        .sort((left, right) => right.score - left.score)[0];
      if (bestMatch?.score && hasSentenceTerminator(bestMatch.sentence)) {
        return bestMatch.sentence;
      }
      if (target.length <= 320) return target;
      return targetExpressionSpan(target, selectedText, expression)
        ? boundedTargetWindow(target, selectedText, expression)
        : boundedTargetWindow(context, selectedText, expression);
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

  function createSession({ video, highlights, profile = "ielts", sourceMode } = {}) {
    const items = mergePracticeHighlights(highlights).map((highlight) => ({
      ...highlight,
      stages: { listening: "not_started", internalization: "not_started" },
    }));
    const videoId = cleanText(video?.id, 100);
    const normalizedProfile = Object.hasOwn(PROFILES, profile) ? profile : "ielts";
    return {
      id: `session-${makeId(`${videoId}:${items.map((item) => item.id).join(",")}`, "practice")}`,
      video: { id: videoId, title: cleanText(video?.title, 500) },
      profile: normalizedProfile,
      questionSourceMode: normalizeQuestionSourceMode(normalizedProfile, sourceMode),
      selectedItemIds: items.map((item) => item.id),
      items,
      retriedStageKeys: [],
      speakingExpressionIds: [],
      speakingRounds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function normalizeQuestionSourceMode(profile, sourceMode) {
    if (typeof YTD_QUESTION_BANK !== "undefined" && typeof YTD_QUESTION_BANK.normalizeSourceMode === "function") {
      return YTD_QUESTION_BANK.normalizeSourceMode(profile, sourceMode);
    }
    return profile === "ielts"
      ? (["bundled", "bundled_plus_mine"].includes(sourceMode) ? sourceMode : "bundled")
      : (["smart_mix", "mine_only", "ai_only"].includes(sourceMode) ? sourceMode : "smart_mix");
  }

  function stageIsAvailable(item, stage) {
    if (stage === "listening") return true;
    if (stage === "internalization") return RATINGS.has(item.stages.listening);
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
    const nextSession = { ...session, items, retriedStageKeys, updatedAt: Date.now() };
    return snapshotSpeakingExpressions(nextSession);
  }

  function selectedItems(session) {
    return (session?.items || []).filter((item) => session.selectedItemIds?.includes(item.id));
  }

  function nextRetryTasks(session) {
    return selectedItems(session)
      .filter((item) => item.stages.listening === "review")
      .map((item) => ({ itemId: item.id, stage: "listening" }))
      .filter((task) => !session.retriedStageKeys?.includes(`${task.itemId}:${task.stage}`));
  }

  function internalizationReviewItems(session) {
    return selectedItems(session).filter((item) => item.stages.internalization === "review");
  }

  function isReadyForSpeaking(session) {
    const items = selectedItems(session);
    return items.length > 0 && items.every((item) => item.stages.internalization === "mastered");
  }

  function snapshotSpeakingExpressions(session) {
    if (!isReadyForSpeaking(session) || session.speakingExpressionIds?.length) return session;
    return { ...session, speakingExpressionIds: selectedItems(session).map((item) => item.id) };
  }

  function speakingItems(session) {
    if (!isReadyForSpeaking(session)) return [];
    const expressionIds = new Set(Array.isArray(session?.speakingExpressionIds) ? session.speakingExpressionIds : []);
    return selectedItems(session).filter((item) => expressionIds.has(item.id));
  }

  function normalizeSpeakingRound(round) {
    const questionId = cleanText(round?.questionId, 200);
    const source = SPEAKING_SOURCES.has(round?.source) ? round.source : "";
    const question = cleanText(round?.question, 800);
    const reference = cleanText(round?.reference, 4000);
    if (!questionId || !source || !question || !reference) return null;
    return {
      id: `round-${makeId(questionId, "speaking")}`,
      questionId,
      source,
      part: SPEAKING_PARTS.has(round?.part) ? round.part : null,
      question,
      cuePoints: Array.isArray(round?.cuePoints)
        ? round.cuePoints.map((cuePoint) => cleanText(cuePoint, 300)).filter(Boolean).slice(0, 12)
        : [],
      reference,
      usedExpressionIds: Array.isArray(round?.usedExpressionIds)
        ? round.usedExpressionIds
          .map((expressionId) => cleanText(expressionId, 200))
          .filter((expressionId, index, ids) => expressionId && ids.indexOf(expressionId) === index)
          .slice(0, MAX_HIGHLIGHTS)
        : [],
      attemptCount: 1,
      outcome: null,
      createdAt: Date.now(),
    };
  }

  function currentUnfinishedRound(session) {
    const rounds = Array.isArray(session?.speakingRounds) ? session.speakingRounds : [];
    const current = rounds.at(-1);
    return current?.outcome === null ? current : null;
  }

  function addSpeakingRound(session, round) {
    if (!isReadyForSpeaking(session) || currentUnfinishedRound(session)) return null;
    const normalized = normalizeSpeakingRound(round);
    if (!normalized || usedQuestionIds(session).includes(normalized.questionId)) return null;
    return {
      ...session,
      speakingRounds: [...(session.speakingRounds || []), normalized],
      updatedAt: Date.now(),
    };
  }

  function retrySameSpeakingRound(session, { roundId } = {}) {
    const current = currentUnfinishedRound(session);
    if (!isReadyForSpeaking(session) || !current || current.id !== roundId) return null;
    return {
      ...session,
      speakingRounds: session.speakingRounds.map((round) => round.id === roundId
        ? { ...round, attemptCount: round.attemptCount + 1 }
        : round),
      updatedAt: Date.now(),
    };
  }

  function finishSpeakingRound(session, { roundId, outcome } = {}) {
    const current = currentUnfinishedRound(session);
    if (!isReadyForSpeaking(session) || !current || current.id !== roundId || !SPEAKING_OUTCOMES.has(outcome)) return null;
    return {
      ...session,
      speakingRounds: session.speakingRounds.map((round) => round.id === roundId
        ? { ...round, outcome }
        : round),
      updatedAt: Date.now(),
    };
  }

  function usedQuestionIds(session) {
    return (Array.isArray(session?.speakingRounds) ? session.speakingRounds : [])
      .map((round) => cleanText(round?.questionId, 200))
      .filter((questionId, index, ids) => questionId && ids.indexOf(questionId) === index);
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
    return RATINGS.has(item.stages.listening) || item.stages.internalization === "review";
  }

  function markdownText(value) {
    return cleanText(value, 500).replace(/([\\`*_{}\[\]()#+!|])/g, "\\$1");
  }

  function stageLabel(stage) {
    return { listening: "听辨", internalization: "内化" }[stage] || stage;
  }

  function speakingRoundCounts(session) {
    const rounds = Array.isArray(session?.speakingRounds) ? session.speakingRounds : [];
    return {
      finished: rounds.filter((round) => round.outcome === "finished").length,
      needsPractice: rounds.filter((round) => round.outcome === "needs_practice").length,
      retries: rounds.reduce((total, round) => total + Math.max(0, (Number(round.attemptCount) || 1) - 1), 0),
    };
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
    const speaking = speakingRoundCounts(session);
    lines.push(`- 口语输出：完成 ${speaking.finished} 题 / 需要再练 ${speaking.needsPractice} 题 / 原题重答 ${speaking.retries} 次`);
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
    internalizationReviewItems,
    isReadyForSpeaking,
    speakingItems,
    addSpeakingRound,
    retrySameSpeakingRound,
    finishSpeakingRound,
    usedQuestionIds,
    stageCounts,
    buildPracticeSummaryMarkdown,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = YTD_PRACTICE;

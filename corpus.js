const YTD_CORPUS = (() => {
  const MAX_SELECTION_CHARS = 500;
  const MAX_TEXT_CHARS = 800;
  const SOURCES = new Set(["player-caption", "sidepanel-transcript"]);
  const KINDS = new Set(["word", "phrase", "sentence_frame"]);
  const FREQUENCIES = new Set(["high", "common", "situational", "low_formal"]);

  function safeString(value, maxLength = MAX_TEXT_CHARS) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  }

  function normalizeWhitespace(value, maxLength) {
    return safeString(value, maxLength).replace(/\s+/g, " ").trim();
  }

  function formatTimestamp(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
  }

  function normalizeSelectionRequest(value) {
    if (!value || !SOURCES.has(value.source)) return null;
    const selectedText = normalizeWhitespace(value.selectedText, MAX_SELECTION_CHARS);
    const videoId = safeString(value.videoId, 100);
    const timestampSeconds = Number(value.timestampSeconds);
    if (!selectedText || !videoId || !Number.isFinite(timestampSeconds) || timestampSeconds < 0) {
      return null;
    }
    return {
      source: value.source,
      selectedText,
      videoId,
      timestampSeconds: Math.floor(timestampSeconds),
      videoTitle: normalizeWhitespace(value.videoTitle, 500),
      channelName: normalizeWhitespace(value.channelName, 300),
    };
  }

  function parseLooseJson(value) {
    if (value && typeof value === "object") return value;
    let text = safeString(value, 20000);
    if (!text) return null;
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) return null;
    text = text.slice(firstBrace, lastBrace + 1).replace(/,(\s*[}\]])/g, "$1");
    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  function normalizeExtensionList(items) {
    if (!Array.isArray(items)) return [];
    return items
      .slice(0, 3)
      .map((item) => ({
        expression: normalizeWhitespace(item?.expression, 160),
        differenceZh: normalizeWhitespace(item?.differenceZh, 240),
      }))
      .filter((item) => item.expression && item.differenceZh);
  }

  function normalizeCollocations(items) {
    if (!Array.isArray(items)) return [];
    return items
      .slice(0, 5)
      .map((item) => ({
        text: normalizeWhitespace(item?.text, 160),
        noteZh: normalizeWhitespace(item?.noteZh, 240),
      }))
      .filter((item) => item.text && item.noteZh);
  }

  function normalizeContextualGloss(value) {
    const parsed = parseLooseJson(value);
    if (!parsed || parsed.label !== "AI 语境释义") return null;
    const kind = KINDS.has(parsed.kind) ? parsed.kind : "phrase";
    const spokenFrequency = FREQUENCIES.has(parsed.spokenFrequency)
      ? parsed.spokenFrequency
      : "situational";
    const expression = normalizeWhitespace(parsed.expression, 240);
    const contextMeaningEn = normalizeWhitespace(parsed.contextMeaningEn, 600);
    const contextMeaningZh = normalizeWhitespace(parsed.contextMeaningZh, 600);
    if (!expression || !contextMeaningEn || !contextMeaningZh) return null;
    return {
      label: "AI 语境释义",
      expression,
      kind,
      suggestedTopic: normalizeWhitespace(parsed.suggestedTopic, 100),
      partOfSpeech: normalizeWhitespace(parsed.partOfSpeech, 120),
      contextMeaningEn,
      contextMeaningZh,
      collocations: normalizeCollocations(parsed.collocations),
      sentenceFrame: normalizeWhitespace(parsed.sentenceFrame, 400),
      spokenFrequency,
      frequencyReasonZh: normalizeWhitespace(parsed.frequencyReasonZh, 300),
      paraphrases: normalizeExtensionList(parsed.paraphrases),
      relatedExtensions: normalizeExtensionList(parsed.relatedExtensions),
    };
  }

  function pickIndexes(items, indexes) {
    if (!Array.isArray(indexes)) return [];
    return [...new Set(indexes)]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < items.length)
      .map((index) => items[index]);
  }

  function buildCorpusEntry({ selection, gloss, edits }) {
    const normalizedSelection = normalizeSelectionRequest(selection);
    const normalizedGloss = normalizeContextualGloss(gloss);
    if (!normalizedSelection || !normalizedGloss || !edits) return null;
    const kind = KINDS.has(edits.kind) ? edits.kind : normalizedGloss.kind;
    const spokenFrequency = FREQUENCIES.has(edits.spokenFrequency)
      ? edits.spokenFrequency
      : normalizedGloss.spokenFrequency;
    const expression = normalizeWhitespace(edits.expression, 240) || normalizedGloss.expression;
    return {
      topic: normalizeWhitespace(edits.topic, 120) || normalizedGloss.suggestedTopic,
      expression,
      kind,
      spokenFrequency,
      timestamp: formatTimestamp(normalizedSelection.timestampSeconds),
      timestampSeconds: normalizedSelection.timestampSeconds,
      timestampedUrl: safeString(selection.timestampedUrl, 2000),
      videoId: normalizedSelection.videoId,
      videoTitle: normalizedSelection.videoTitle,
      channelName: normalizedSelection.channelName,
      source: normalizedSelection.source,
      context: normalizeWhitespace(selection.context, 1800),
      label: "AI 语境释义",
      partOfSpeech: normalizedGloss.partOfSpeech,
      contextMeaningEn: normalizedGloss.contextMeaningEn,
      contextMeaningZh: normalizedGloss.contextMeaningZh,
      collocations: normalizedGloss.collocations,
      sentenceFrame: normalizedGloss.sentenceFrame,
      frequencyReasonZh: normalizedGloss.frequencyReasonZh,
      paraphrases: pickIndexes(normalizedGloss.paraphrases, edits.selectedParaphraseIndexes),
      relatedExtensions: pickIndexes(
        normalizedGloss.relatedExtensions,
        edits.selectedRelatedExtensionIndexes,
      ),
      personalNote: normalizeWhitespace(edits.personalNote, 1200),
    };
  }

  function normalizeFolder(folder) {
    const normalized = safeString(folder, 180).replace(/\\/g, "/");
    if (!normalized || normalized.startsWith("/") || normalized.includes("..")) return null;
    const segments = normalized.split("/");
    if (segments.some((segment) => !segment || /[\x00-\x1f#?&%<>:"|*]/.test(segment))) {
      return null;
    }
    return segments.join("/");
  }

  function safeFileTitle(title) {
    return normalizeWhitespace(title, 160)
      .replace(/[\\/:?*"<>|#&%{}\[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildVideoNotePath({ folder, videoTitle, firstExportedAt }) {
    const safeFolder = normalizeFolder(folder);
    const safeTitle = safeFileTitle(videoTitle);
    const date = firstExportedAt instanceof Date ? firstExportedAt : new Date(firstExportedAt);
    if (!safeFolder || !safeTitle || Number.isNaN(date.getTime())) return null;
    const datePart = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    return `${safeFolder}/${datePart} - ${safeTitle}.md`;
  }

  function escapeMarkdownText(value) {
    return safeString(value, 4000)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/([\\`*_{}\[\]()#+!|])/g, "\\$1");
  }

  function renderExtensionList(items) {
    if (!items.length) return "- None selected";
    return items
      .map((item) => `- ${escapeMarkdownText(item.expression)} — ${escapeMarkdownText(item.differenceZh)}`)
      .join("\n");
  }

  function renderCorpusEntryMarkdown(entry) {
    if (!entry) return "";
    const source = entry.timestampedUrl
      ? `[${escapeMarkdownText(entry.timestamp)}](${entry.timestampedUrl})`
      : escapeMarkdownText(entry.timestamp);
    const collocations = entry.collocations?.length
      ? entry.collocations
          .map((item) => `- ${escapeMarkdownText(item.text)} — ${escapeMarkdownText(item.noteZh)}`)
          .join("\n")
      : "- None";
    return [
      `## ${escapeMarkdownText(entry.timestamp)} · ${escapeMarkdownText(entry.expression)}`,
      "",
      `- Topic: ${escapeMarkdownText(entry.topic) || "Unsorted"}`,
      `- Type: ${escapeMarkdownText(entry.kind)}`,
      `- Spoken frequency: ${escapeMarkdownText(entry.spokenFrequency)}`,
      `- Source: ${source} · ${escapeMarkdownText(entry.videoTitle)} · ${escapeMarkdownText(entry.channelName)}`,
      "",
      "### Context",
      escapeMarkdownText(entry.context),
      "",
      "### AI 语境释义",
      `- Part of speech: ${escapeMarkdownText(entry.partOfSpeech)}`,
      `- EN: ${escapeMarkdownText(entry.contextMeaningEn)}`,
      `- 中文: ${escapeMarkdownText(entry.contextMeaningZh)}`,
      `- Frequency note: ${escapeMarkdownText(entry.frequencyReasonZh)}`,
      "",
      "### Collocations",
      collocations,
      "",
      "### Sentence frame",
      escapeMarkdownText(entry.sentenceFrame),
      "",
      "### Paraphrases",
      renderExtensionList(entry.paraphrases || []),
      "",
      "### Related extensions",
      renderExtensionList(entry.relatedExtensions || []),
      "",
      "### My practice",
      escapeMarkdownText(entry.personalNote),
      "",
    ].join("\n");
  }

  function buildObsidianAppendUri({ vault, file, content }) {
    const safeVault = safeString(vault, 180);
    const safeFile = safeString(file, 500);
    const safeContent = typeof content === "string" ? content : "";
    if (!safeVault || !safeFile || !safeContent) return null;
    return `obsidian://new?vault=${encodeURIComponent(safeVault)}&file=${encodeURIComponent(safeFile)}&content=${encodeURIComponent(safeContent)}&append=true`;
  }

  return {
    MAX_SELECTION_CHARS,
    buildCorpusEntry,
    buildObsidianAppendUri,
    buildVideoNotePath,
    escapeMarkdownText,
    formatTimestamp,
    normalizeContextualGloss,
    normalizeSelectionRequest,
    renderCorpusEntryMarkdown,
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YTD_CORPUS;
}

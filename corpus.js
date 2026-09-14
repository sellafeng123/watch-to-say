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

  function escapeTableCell(value) {
    return escapeMarkdownText(normalizeWhitespace(value, 4000));
  }

  function spokenFrequencyLabel(value) {
    return {
      high: "高频",
      common: "常用",
      situational: "场景常用",
      low_formal: "低频或偏书面",
    }[value] || "场景常用";
  }

  function kindLabel(value) {
    return {
      word: "单词",
      phrase: "词伙",
      sentence_frame: "句型",
    }[value] || "词伙";
  }

  function renderCorpusEntryMarkdown(entry, { includeTableHeader = true } = {}) {
    if (!entry) return "";
    const source = entry.timestampedUrl
      ? `[${escapeMarkdownText(entry.timestamp)}](${entry.timestampedUrl})`
      : escapeMarkdownText(entry.timestamp);
    const studySection = (title, lines) => {
      const content = lines.filter(Boolean);
      return `**${title}**<br>${content.length ? content.join("<br>") : "—"}`;
    };
    const meaningLines = [
      escapeTableCell(entry.contextMeaningZh),
      entry.contextMeaningEn ? `EN: ${escapeTableCell(entry.contextMeaningEn)}` : "",
    ];
    const collocationLines = [
      ...(entry.collocations || []).map((item) =>
        `• ${escapeTableCell(item.text)}${item.noteZh ? ` — ${escapeTableCell(item.noteZh)}` : ""}`,
      ),
      entry.sentenceFrame ? `• 句型: ${escapeTableCell(entry.sentenceFrame)}` : "",
    ];
    const extensionLines = [
      ...(entry.paraphrases || []).map((item) =>
        `• 同义: ${escapeTableCell(item.expression)}${item.differenceZh ? ` — ${escapeTableCell(item.differenceZh)}` : ""}`,
      ),
      ...(entry.relatedExtensions || []).map((item) =>
        `• 扩展: ${escapeTableCell(item.expression)}${item.differenceZh ? ` — ${escapeTableCell(item.differenceZh)}` : ""}`,
      ),
    ];
    const focus = [
      `**${escapeTableCell(entry.expression)}**`,
      `\`${kindLabel(entry.kind)}\` · ${spokenFrequencyLabel(entry.spokenFrequency)} · \`${escapeTableCell(entry.learningStatus) || "重点"}\``,
      `主题：*${escapeTableCell(entry.topic) || "未分类"}*`,
    ].join("<br>");
    const context = [source, entry.context ? `*${escapeTableCell(entry.context)}*` : ""]
      .filter(Boolean)
      .join("<br><br>");
    const studyNotes = [
      studySection("AI 语境释义", meaningLines),
      studySection("词性", [escapeTableCell(entry.partOfSpeech)]),
      studySection("口语使用提示", [escapeTableCell(entry.frequencyReasonZh)]),
      studySection("搭配 / 句型", collocationLines),
      studySection("同义改写 / 扩展", extensionLines),
      studySection("我的练习", [escapeTableCell(entry.personalNote)]),
    ].join("<br><br>");
    const row = [focus, context, studyNotes];
    const tableRow = `| ${row.join(" | ")} |`;
    if (!includeTableHeader) return `${tableRow}\n`;
    return [
      "## 语料总表（宽表）",
      "",
      "| 重点表达 | 原句语境 | 学习笔记 |",
      "| --- | --- | --- |",
      tableRow,
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

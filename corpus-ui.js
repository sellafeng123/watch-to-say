const YTD_CORPUS_UI = (() => {
  const SPOKEN_FREQUENCY_OPTIONS = [
    { value: "high", label: "高频" },
    { value: "common", label: "常用" },
    { value: "situational", label: "场景常用" },
    { value: "low_formal", label: "低频或偏书面" },
  ];

  function createEditorState(gloss) {
    return {
      usageContexts: gloss?.suggestedUsageContexts || "",
      expression: gloss?.expression || "",
      kind: gloss?.kind || "phrase",
      spokenFrequency: gloss?.spokenFrequency || "situational",
      personalNote: "",
      selectedParaphraseIndexes: [],
      selectedRelatedExtensionIndexes: [],
    };
  }

  function el(documentRef, tagName, className, text) {
    const node = documentRef.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function addTextSection(documentRef, root, title, content) {
    if (!content) return;
    const section = el(documentRef, "section", "corpus-gloss-section");
    section.append(el(documentRef, "h3", "corpus-gloss-heading", title));
    section.append(el(documentRef, "p", "corpus-gloss-copy", content));
    root.append(section);
  }

  function addExtensionList(documentRef, root, title, items) {
    const details = el(documentRef, "details", "corpus-gloss-extensions");
    const summary = el(documentRef, "summary", "corpus-gloss-summary", `${title} (${items.length})`);
    details.append(summary);
    const list = el(documentRef, "ul", "corpus-gloss-list");
    items.forEach((item) => {
      const row = el(documentRef, "li", "corpus-gloss-list-item");
      row.append(el(documentRef, "strong", "", item.expression));
      row.append(el(documentRef, "span", "", ` — ${item.differenceZh}`));
      list.append(row);
    });
    details.append(list);
    root.append(details);
  }

  function kindLabel(value) {
    return { word: "单词", phrase: "词伙", sentence_frame: "句型" }[value] || "词伙";
  }

  function createEntryPreviewModel(entry = {}) {
    const collocationsAndFrame = [
      ...(entry.collocations || []).map((item) =>
        `${item.text}${item.noteZh ? ` — ${item.noteZh}` : ""}`,
      ),
      entry.sentenceFrame ? `句型: ${entry.sentenceFrame}` : "",
    ].filter(Boolean);
    const extensions = [
      ...(entry.paraphrases || []).map((item) =>
        `同义: ${item.expression}${item.differenceZh ? ` — ${item.differenceZh}` : ""}`,
      ),
      ...(entry.relatedExtensions || []).map((item) =>
        `扩展: ${item.expression}${item.differenceZh ? ` — ${item.differenceZh}` : ""}`,
      ),
    ].filter(Boolean);
    return {
      expression: entry.expression || "—",
      meta: `【${kindLabel(entry.kind)}】 · ${frequencyLabel(entry.spokenFrequency)} · 【${entry.learningStatus || "重点"}】`,
      usageContexts: entry.usageContexts || "未设置，可在编辑时填写",
      timestamp: entry.timestamp || "—",
      context: entry.context || "—",
      meaning: [entry.contextMeaningZh, entry.contextMeaningEn ? `EN: ${entry.contextMeaningEn}` : ""].filter(Boolean).join("\n") || "—",
      partOfSpeech: entry.partOfSpeech || "—",
      frequencyReason: entry.frequencyReasonZh || "—",
      collocationsAndFrame,
      extensions,
      personalNote: entry.personalNote || "—",
    };
  }

  function addPreviewList(documentRef, root, title, items) {
    const section = el(documentRef, "section", "corpus-gloss-section");
    section.append(el(documentRef, "h3", "corpus-gloss-heading", title));
    if (!items.length) {
      section.append(el(documentRef, "p", "corpus-gloss-copy", "—"));
    } else {
      const list = el(documentRef, "ul", "corpus-gloss-list");
      items.forEach((item) => list.append(el(documentRef, "li", "corpus-gloss-list-item", item)));
      section.append(list);
    }
    root.append(section);
  }

  function mountEntryPreview({ root, entry }) {
    if (!root || !entry) return null;
    const documentRef = root.ownerDocument || document;
    const model = createEntryPreviewModel(entry);
    const card = el(documentRef, "section", "corpus-gloss-card corpus-entry-preview");
    card.append(el(documentRef, "p", "corpus-gloss-label", "导出预览"));
    card.append(el(documentRef, "h2", "corpus-gloss-expression", model.expression));
    addTextSection(documentRef, card, model.meta, model.usageContexts);
    addTextSection(documentRef, card, `原句语境 · ${model.timestamp}`, model.context);
    addTextSection(documentRef, card, "AI 语境释义", model.meaning);
    addTextSection(documentRef, card, "词性", model.partOfSpeech);
    addTextSection(documentRef, card, "口语使用提示", model.frequencyReason);
    addPreviewList(documentRef, card, "搭配 / 句型", model.collocationsAndFrame);
    addPreviewList(documentRef, card, "同义改写 / 扩展", model.extensions);
    addTextSection(documentRef, card, "我的练习", model.personalNote);
    root.append(card);
    return card;
  }

  function mountGlossCard({ root, gloss, selection, onSave, onRegenerate }) {
    if (!root || !gloss || !selection) return null;
    const documentRef = root.ownerDocument || document;
    root.replaceChildren();
    const card = el(documentRef, "div", "corpus-gloss-card");
    card.append(el(documentRef, "p", "corpus-gloss-label", "AI 语境释义"));
    card.append(el(documentRef, "h2", "corpus-gloss-expression", gloss.expression));
    addTextSection(documentRef, card, "适用场景建议", gloss.suggestedUsageContexts || "未建议，可在编辑时填写");
    addTextSection(documentRef, card, gloss.partOfSpeech || "词性", gloss.partOfSpeech);
    addTextSection(documentRef, card, "句中义（EN）", gloss.contextMeaningEn);
    addTextSection(documentRef, card, "句中义（中文）", gloss.contextMeaningZh);
    addTextSection(documentRef, card, "句型", gloss.sentenceFrame);
    addTextSection(documentRef, card, "口语使用频率", `${frequencyLabel(gloss.spokenFrequency)}${gloss.frequencyReasonZh ? `：${gloss.frequencyReasonZh}` : ""}`);
    if (gloss.collocations?.length) {
      addExtensionList(documentRef, card, "常见搭配", gloss.collocations.map((item) => ({ expression: item.text, differenceZh: item.noteZh })));
    }
    addExtensionList(documentRef, card, "可直接替换的同义改写", gloss.paraphrases || []);
    addExtensionList(documentRef, card, "同语义族表达扩展", gloss.relatedExtensions || []);
    const editButton = el(documentRef, "button", "corpus-primary-button", "编辑后沉淀");
    editButton.type = "button";
    editButton.addEventListener("click", () => mountEditor({ root, gloss, selection, onSave }));
    card.append(editButton);
    if (typeof onRegenerate === "function") {
      const regenerateButton = el(documentRef, "button", "corpus-regenerate-button", "重新生成");
      regenerateButton.type = "button";
      regenerateButton.addEventListener("click", onRegenerate);
      card.append(regenerateButton);
    }
    root.append(card);
    return card;
  }

  function frequencyLabel(value) {
    return SPOKEN_FREQUENCY_OPTIONS.find((option) => option.value === value)?.label || "场景常用";
  }

  function mountEditor({ root, gloss, selection, onSave }) {
    const documentRef = root.ownerDocument || document;
    const state = createEditorState(gloss);
    root.replaceChildren();
    const form = el(documentRef, "form", "corpus-editor");
    form.append(el(documentRef, "h2", "corpus-editor-title", "编辑学习条目"));
    const fields = [
      ["usageContexts", "适用场景（可选）", "text"],
      ["expression", "词伙 / 表达", "text"],
    ];
    fields.forEach(([key, label, type]) => {
      const labelNode = el(documentRef, "label", "corpus-editor-field", label);
      const input = el(documentRef, "input", "corpus-editor-input");
      input.type = type;
      input.name = key;
      input.value = state[key];
      labelNode.append(input);
      form.append(labelNode);
    });
    form.append(selectField(documentRef, "kind", "类型", [
      ["word", "单词"], ["phrase", "词伙"], ["sentence_frame", "句型"],
    ], state.kind));
    form.append(selectField(documentRef, "spokenFrequency", "口语使用频率", SPOKEN_FREQUENCY_OPTIONS.map((option) => [option.value, option.label]), state.spokenFrequency));
    const noteLabel = el(documentRef, "label", "corpus-editor-field", "我的笔记 / 练习");
    const note = el(documentRef, "textarea", "corpus-editor-textarea");
    note.name = "personalNote";
    note.rows = 3;
    noteLabel.append(note);
    form.append(noteLabel);
    appendCheckboxes(documentRef, form, "selectedParaphraseIndexes", "选择要带入的同义改写", gloss.paraphrases || []);
    appendCheckboxes(documentRef, form, "selectedRelatedExtensionIndexes", "选择要带入的表达扩展", gloss.relatedExtensions || []);
    const saveButton = el(documentRef, "button", "corpus-primary-button", "保存并准备导出");
    saveButton.type = "submit";
    form.append(saveButton);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const edits = {
        usageContexts: data.get("usageContexts"), expression: data.get("expression"), kind: data.get("kind"),
        spokenFrequency: data.get("spokenFrequency"), personalNote: data.get("personalNote"),
        selectedParaphraseIndexes: data.getAll("selectedParaphraseIndexes").map(Number),
        selectedRelatedExtensionIndexes: data.getAll("selectedRelatedExtensionIndexes").map(Number),
      };
      const entry = YTD_CORPUS.buildCorpusEntry({ selection, gloss, edits });
      if (entry) onSave?.(entry);
    });
    root.append(form);
    return form;
  }

  function selectField(documentRef, name, label, options, selected) {
    const labelNode = el(documentRef, "label", "corpus-editor-field", label);
    const select = el(documentRef, "select", "corpus-editor-select");
    select.name = name;
    options.forEach(([value, text]) => {
      const option = el(documentRef, "option", "", text);
      option.value = value;
      option.selected = value === selected;
      select.append(option);
    });
    labelNode.append(select);
    return labelNode;
  }

  function appendCheckboxes(documentRef, form, name, title, items) {
    if (!items.length) return;
    const fieldset = el(documentRef, "fieldset", "corpus-editor-extensions");
    fieldset.append(el(documentRef, "legend", "", title));
    items.forEach((item, index) => {
      const label = el(documentRef, "label", "corpus-editor-check");
      const checkbox = el(documentRef, "input", "");
      checkbox.type = "checkbox";
      checkbox.name = name;
      checkbox.value = String(index);
      label.append(checkbox, documentRef.createTextNode(` ${item.expression} — ${item.differenceZh}`));
      fieldset.append(label);
    });
    form.append(fieldset);
  }

  return { SPOKEN_FREQUENCY_OPTIONS, createEditorState, createEntryPreviewModel, mountEntryPreview, mountGlossCard };
})();

if (typeof module !== "undefined" && module.exports) module.exports = YTD_CORPUS_UI;

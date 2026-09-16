var YTD_QUESTION_BANK_UI = (() => {
  const PROFILES = ["ielts", "work", "daily", "travel", "general"];

  function el(documentRef, tagName, className, text) {
    const node = documentRef.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function countParts(preview) {
    const supplied = preview?.summary?.partCounts || preview?.partCounts;
    if (supplied && typeof supplied === "object") return supplied;
    return (preview?.sampleQuestions || []).reduce((counts, question) => {
      const part = question?.part;
      if (part) counts[part] = (counts[part] || 0) + 1;
      return counts;
    }, {});
  }

  function readDraft(form, fallback, copy = {}) {
    return {
      name: form.querySelector("#questionBankName")?.value.trim() || copy.defaultBankName || "Learner question bank",
      profiles: PROFILES.filter((profile) =>
        form.querySelector(`[data-profile="${profile}"]`)?.checked,
      ),
      sourceText: form.querySelector("#questionBankSourceText")?.value || "",
      replaceBankId: fallback?.replaceBankId || null,
    };
  }

  function readLiveDraft(form, fallback) {
    return {
      name: form.querySelector("#questionBankName")?.value || "",
      profiles: PROFILES.filter((profile) =>
        form.querySelector(`[data-profile="${profile}"]`)?.checked,
      ),
      sourceText: form.querySelector("#questionBankSourceText")?.value || "",
      replaceBankId: fallback?.replaceBankId || null,
    };
  }

  function appendPreview(documentRef, manager, copy, state, callbacks) {
    const preview = state.preview;
    if (!preview?.previewToken) return;
    const section = el(documentRef, "section", "question-bank-preview");
    section.setAttribute("aria-labelledby", "questionBankPreviewTitle");
    const heading = el(documentRef, "h3", "question-bank-subheading", copy.previewTitle);
    heading.id = "questionBankPreviewTitle";
    const summary = preview.summary || {};
    const metrics = el(documentRef, "p", "question-bank-preview-summary");
    metrics.append(
      el(documentRef, "span", "question-bank-metric", copy.questionCount({ count: summary.questionCount || 0 })),
      el(documentRef, "span", "question-bank-metric", copy.profileCount({ count: summary.profiles?.length || 0 })),
    );
    section.append(heading, metrics);
    const partCounts = countParts(preview);
    const parts = Object.entries(partCounts).filter(([, count]) => count > 0);
    if (parts.length) {
      const partList = el(documentRef, "p", "question-bank-part-counts");
      for (const [part, count] of parts) {
        partList.append(el(documentRef, "span", "question-bank-metric", copy.partCount({
          part: copy.partLabel?.({ part }) || part,
          count,
        })));
      }
      section.append(partList);
    }
    section.append(el(documentRef, "h4", "question-bank-samples-heading", copy.sampleQuestions));
    const samples = el(documentRef, "ol", "question-bank-samples");
    for (const question of (preview.sampleQuestions || []).slice(0, 3)) {
      samples.append(el(documentRef, "li", "question-bank-sample", question.question || ""));
    }
    section.append(samples);
    section.append(el(documentRef, "p", "question-bank-unrecognized", copy.unrecognized({ count: preview.unrecognized?.length || 0 })));
    if (preview.unrecognized?.length) {
      section.append(el(documentRef, "h4", "question-bank-samples-heading", copy.unrecognizedItems));
      const unrecognized = el(documentRef, "ul", "question-bank-unrecognized-list");
      for (const fragment of preview.unrecognized) {
        unrecognized.append(el(documentRef, "li", "question-bank-unrecognized-item", fragment));
      }
      section.append(unrecognized);
    }
    const save = el(documentRef, "button", "primary question-bank-save", copy.save);
    save.type = "button";
    save.disabled = !!state.loading;
    save.addEventListener("click", () => {
      if (!state.loading) callbacks.onSave?.(preview.previewToken);
    });
    section.append(save);
    manager.append(section);
  }

  function appendSavedBanks(documentRef, manager, copy, state, callbacks) {
    const section = el(documentRef, "section", "question-bank-saved");
    section.append(el(documentRef, "h3", "question-bank-subheading", copy.savedBanks));
    const banks = state.banks || [];
    if (!banks.length) {
      section.append(el(documentRef, "p", "question-bank-empty", copy.noBanks));
      manager.append(section);
      return;
    }
    const list = el(documentRef, "ul", "question-bank-bank-list");
    for (const bank of banks) {
      const row = el(documentRef, "li", "question-bank-bank");
      row.setAttribute("data-bank-id", bank.id);
      const name = el(documentRef, "input", "question-bank-bank-name");
      name.type = "text";
      name.value = bank.name || "";
      name.setAttribute("aria-label", copy.bankName);
      const profiles = (bank.profiles || []).map((profile) =>
        copy.profileLabel?.({ profile }) || profile,
      );
      const meta = el(documentRef, "p", "question-bank-bank-meta", `${copy.questionCount({ count: bank.questionCount || 0 })} · ${profiles.join(", ")}`);
      const actions = el(documentRef, "div", "question-bank-bank-actions");
      const rename = el(documentRef, "button", "question-bank-rename", copy.rename);
      const replace = el(documentRef, "button", "question-bank-replace", copy.replace);
      const remove = el(documentRef, "button", "danger question-bank-delete", copy.delete);
      name.disabled = !!state.loading;
      for (const button of [rename, replace, remove]) {
        button.type = "button";
        button.disabled = !!state.loading;
      }
      rename.addEventListener("click", () => {
        if (!state.loading) callbacks.onRename?.(bank.id, name.value);
      });
      replace.addEventListener("click", () => {
        if (!state.loading) callbacks.onReplace?.(bank.id);
      });
      remove.addEventListener("click", () => {
        if (!state.loading) callbacks.onDelete?.(bank.id);
      });
      actions.append(rename, replace, remove);
      row.append(name, meta, actions);
      list.append(row);
    }
    section.append(list);
    manager.append(section);
  }

  function mountManager({ root, copy, state = {}, callbacks = {} }) {
    if (!root) return null;
    const documentRef = root.ownerDocument || document;
    const draft = state.draft || {};
    root.replaceChildren();
    const manager = el(documentRef, "div", "question-bank-manager");
    manager.setAttribute("aria-busy", String(!!state.loading));
    manager.append(el(documentRef, "h2", "question-bank-title", copy.title));
    manager.append(el(documentRef, "p", "help question-bank-help", copy.help));
    const form = el(documentRef, "form", "question-bank-form");
    const nameLabel = el(documentRef, "label", "", copy.bankName);
    nameLabel.setAttribute("for", "questionBankName");
    const name = el(documentRef, "input", "question-bank-name");
    name.id = "questionBankName";
    name.type = "text";
    name.maxLength = 120;
    name.value = draft.name || "";
    name.disabled = !!state.loading;
    nameLabel.append(name);
    form.append(nameLabel);
    const profiles = el(documentRef, "fieldset", "question-bank-profiles");
    profiles.append(el(documentRef, "legend", "", copy.profiles));
    for (const profile of PROFILES) {
      const label = el(documentRef, "label", "question-bank-profile", copy[`profile${profile[0].toUpperCase()}${profile.slice(1)}`]);
      const input = el(documentRef, "input", "");
      input.type = "checkbox";
      input.setAttribute("data-profile", profile);
      input.checked = (draft.profiles || []).includes(profile);
      input.disabled = !!state.loading;
      label.append(input);
      profiles.append(label);
    }
    form.append(profiles);
    const sourceLabel = el(documentRef, "label", "", copy.sourceText);
    sourceLabel.setAttribute("for", "questionBankSourceText");
    const source = el(documentRef, "textarea", "question-bank-source");
    source.id = "questionBankSourceText";
    source.value = draft.sourceText || "";
    source.maxLength = 80000;
    source.rows = 8;
    source.disabled = !!state.loading;
    sourceLabel.append(source);
    form.append(sourceLabel);
    const updateDraft = () => callbacks.onDraftChange?.(readLiveDraft(form, draft));
    name.addEventListener("input", updateDraft);
    name.addEventListener("change", updateDraft);
    source.addEventListener("input", updateDraft);
    source.addEventListener("change", updateDraft);
    for (const profile of profiles.querySelectorAll("input")) {
      profile.addEventListener("input", updateDraft);
      profile.addEventListener("change", updateDraft);
    }
    const status = el(documentRef, "p", "question-bank-status", state.status || "");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const recognize = el(documentRef, "button", "primary question-bank-recognize", copy.recognize);
    recognize.type = "submit";
    recognize.disabled = !!state.loading;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (state.loading) return;
      const nextDraft = readDraft(form, draft, copy);
      if (!nextDraft.profiles.length) {
        status.textContent = copy.profilesRequired;
        return;
      }
      callbacks.onRecognize?.(nextDraft);
    });
    form.append(recognize, status);
    manager.append(form);
    appendPreview(documentRef, manager, copy, state, callbacks);
    appendSavedBanks(documentRef, manager, copy, state, callbacks);
    root.append(manager);
    return manager;
  }

  return { PROFILES, mountManager, readDraft, readLiveDraft };
})();

if (typeof module !== "undefined" && module.exports) module.exports = YTD_QUESTION_BANK_UI;

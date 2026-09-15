const YTD_PRACTICE_UI = (() => {
  function el(documentRef, tag, className, text) {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function internalizationGuidance(kind) {
    return {
      word: "先说一个常见搭配，再用自己的真实场景说两句。",
      phrase: "保留这个词伙，替换人物、时间或情境，各说两句。",
      sentence_frame: "保留框架，用自己的内容补全或重写，各说两句。",
    }[kind] || "保留核心表达，用自己的真实场景说两句。";
  }

  function stageTitle(stage, isRetry) {
    const title = { listening: "听辨回想", internalization: "表达内化", speaking: "口语输出" }[stage] || "练习";
    return isRetry ? `再过一遍 · ${title}` : title;
  }

  function mountSetup({ root, highlights, onStart, onCancel }) {
    const documentRef = root.ownerDocument || document;
    root.replaceChildren();
    const card = el(documentRef, "section", "practice-card");
    card.append(el(documentRef, "h2", "practice-title", "本期表达练习"));
    card.append(el(documentRef, "p", "practice-help", "默认全选。取消只影响本次练习，不会删除 Transcript 高亮。"));
    const form = el(documentRef, "form", "practice-setup");
    const list = el(documentRef, "div", "practice-selection-list");
    highlights.forEach((item) => {
      const label = el(documentRef, "label", "practice-selection-item");
      const checkbox = el(documentRef, "input");
      checkbox.type = "checkbox";
      checkbox.name = "practiceItem";
      checkbox.value = item.id;
      checkbox.checked = true;
      const copy = el(documentRef, "span");
      copy.append(el(documentRef, "strong", "", item.expression));
      copy.append(el(documentRef, "small", "", `${item.anchors?.length || 1} 个原句 · ${item.partOfSpeech || "表达"}`));
      label.append(checkbox, copy);
      list.append(label);
    });
    form.append(list);
    const profileLabel = el(documentRef, "label", "practice-field", "口语场景");
    const profile = el(documentRef, "select", "practice-select");
    [["ielts", "雅思口语题型与高频主题"], ["work", "职场"], ["daily", "日常聊天"], ["travel", "旅行"]].forEach(([value, text]) => {
      const option = el(documentRef, "option", "", text);
      option.value = value;
      profile.append(option);
    });
    profileLabel.append(profile);
    form.append(profileLabel);
    const actions = el(documentRef, "div", "practice-actions");
    const cancel = el(documentRef, "button", "practice-secondary", "取消");
    cancel.type = "button";
    cancel.addEventListener("click", () => onCancel?.());
    const start = el(documentRef, "button", "practice-primary", "开始练习");
    start.type = "submit";
    actions.append(cancel, start);
    form.append(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const selectedIds = [...form.querySelectorAll('input[name="practiceItem"]:checked')].map((input) => input.value);
      if (!selectedIds.length) return;
      onStart?.({ selectedIds, profile: profile.value });
    });
    card.append(form);
    root.append(card);
  }

  function mountLoading({ root }) {
    const documentRef = root.ownerDocument || document;
    root.replaceChildren();
    const card = el(documentRef, "section", "practice-card practice-loading");
    card.append(el(documentRef, "h2", "practice-title", "正在准备练习材料"));
    card.append(el(documentRef, "p", "practice-help", "DeepSeek 正在根据你选中的表达生成内化提示和口语题。"));
    root.append(card);
  }

  function mountStage({ root, stage, item, material, position, total, isRetry, onSeek, onRate, onExit }) {
    const documentRef = root.ownerDocument || document;
    root.replaceChildren();
    const card = el(documentRef, "section", "practice-card");
    const top = el(documentRef, "div", "practice-stage-top");
    top.append(el(documentRef, "span", "practice-kicker", stageTitle(stage, isRetry)));
    top.append(el(documentRef, "span", "practice-progress", `${position} / ${total}`));
    card.append(top, el(documentRef, "h2", "practice-expression", item.expression));
    card.append(el(documentRef, "p", "practice-speak-first", "先在口中完成，再显示参考答案。"));
    if (stage === "listening") card.append(el(documentRef, "p", "practice-prompt", "点击原句时间，听原音后说出目标表达或所在句子。"));
    if (stage === "internalization") {
      card.append(el(documentRef, "p", "practice-prompt", internalizationGuidance(item.kind)));
      card.append(el(documentRef, "p", "practice-ai-prompt", material?.internalization?.promptZh || "用这个表达说一个自己的例子。"));
    }
    if (stage === "speaking") card.append(el(documentRef, "p", "practice-ai-prompt", material?.speaking?.question || "请用这个表达回答一个与你有关的问题。"));
    const anchor = item.anchors?.[0] || {};
    const seek = el(documentRef, "button", "practice-timestamp", `${anchor.timestamp || "0:00"} · 跳转原句`);
    seek.type = "button";
    seek.addEventListener("click", () => onSeek?.(anchor.timestampSeconds || 0));
    card.append(seek);
    const revealCopy = stage === "internalization" ? "表达参考" : "显示答案";
    const reveal = el(documentRef, "button", "practice-secondary practice-reveal", revealCopy);
    reveal.type = "button";
    const answer = el(documentRef, "div", "practice-answer");
    answer.hidden = true;
    if (stage === "listening") {
      const reference = globalThis.YTD_PRACTICE?.extractAnswerSentence?.({
        context: anchor.context,
        selectedText: anchor.selectedText,
        expression: item.expression,
      }) || anchor.selectedText || item.expression;
      answer.append(el(documentRef, "strong", "", "参考答案"), el(documentRef, "p", "", reference));
    } else if (stage === "internalization") {
      const references = Array.isArray(material?.internalization?.references) ? material.internalization.references : [];
      const list = el(documentRef, "ol", "practice-reference-list");
      references.forEach((reference) => list.append(el(documentRef, "li", "", reference)));
      answer.append(el(documentRef, "strong", "", "表达参考"), list);
    } else {
      answer.append(el(documentRef, "strong", "", "参考答案"), el(documentRef, "p", "", item.expression));
    }
    const ratingActions = el(documentRef, "div", "practice-actions practice-rating-actions");
    ratingActions.hidden = true;
    const mastered = el(documentRef, "button", "practice-primary", "我会");
    const review = el(documentRef, "button", "practice-secondary", "还不会");
    [mastered, review].forEach((button) => { button.type = "button"; });
    mastered.addEventListener("click", () => onRate?.("mastered"));
    review.addEventListener("click", () => onRate?.("review"));
    ratingActions.append(review, mastered);
    reveal.addEventListener("click", () => {
      answer.hidden = false;
      ratingActions.hidden = false;
      reveal.hidden = true;
    });
    const exit = el(documentRef, "button", "practice-text-button", "退出本次练习");
    exit.type = "button";
    exit.addEventListener("click", () => onExit?.());
    card.append(reveal, answer, ratingActions, exit);
    root.append(card);
  }

  function mountSummary({ root, session, onClose }) {
    const documentRef = root.ownerDocument || document;
    root.replaceChildren();
    const card = el(documentRef, "section", "practice-card");
    card.append(el(documentRef, "h2", "practice-title", "本期表达练习完成"));
    const labels = { listening: "听辨", internalization: "内化", speaking: "输出" };
    Object.entries(labels).forEach(([stage, label]) => {
      const counts = YTD_PRACTICE.stageCounts(session, stage);
      card.append(el(documentRef, "p", "practice-summary-row", `${label}：${counts.mastered} 会 / ${counts.review} 待复习`));
    });
    const close = el(documentRef, "button", "practice-primary", "完成");
    close.type = "button";
    close.addEventListener("click", () => onClose?.());
    card.append(close);
    root.append(card);
  }

  return { internalizationGuidance, mountSetup, mountLoading, mountStage, mountSummary };
})();

if (typeof module !== "undefined" && module.exports) module.exports = YTD_PRACTICE_UI;

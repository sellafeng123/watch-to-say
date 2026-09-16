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

  function mountSetup({ root, highlights, questionSources = null, onStart, onCancel }) {
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
      checkbox.setAttribute("name", "practiceItem");
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
    profile.setAttribute("name", "profile");
    [["ielts", "雅思口语题型与高频主题"], ["work", "职场"], ["daily", "日常聊天"], ["travel", "旅行"]].forEach(([value, text]) => {
      const option = el(documentRef, "option", "", text);
      option.value = value;
      profile.append(option);
    });
    profileLabel.append(profile);
    profile.value = "ielts";
    form.append(profileLabel);
    const sourceLabel = el(documentRef, "label", "practice-field", "题目来源");
    const source = el(documentRef, "select", "practice-select");
    source.setAttribute("name", "sourceMode");
    sourceLabel.append(source);
    const sourceStatus = el(documentRef, "p", "practice-help practice-source-status");
    sourceStatus.setAttribute("role", "status");
    form.append(sourceLabel, sourceStatus);
    const actions = el(documentRef, "div", "practice-actions");
    const cancel = el(documentRef, "button", "practice-secondary", "取消");
    cancel.type = "button";
    cancel.addEventListener("click", () => onCancel?.());
    const start = el(documentRef, "button", "practice-primary", "开始练习");
    start.type = "submit";
    function updateSources(reset = false) {
      const previous = source.value;
      const choices = profile.value === "ielts"
        ? [["bundled", "内置雅思题库"], ["bundled_plus_mine", "内置 + 我的雅思题库"]]
        : [["smart_mix", "智能混合"], ["mine_only", "仅我的题库"], ["ai_only", "仅 DeepSeek 生成"]];
      source.replaceChildren();
      choices.forEach(([value, copy]) => {
        const option = el(documentRef, "option", "", copy);
        option.value = value;
        source.append(option);
      });
      source.value = !reset && choices.some(([value]) => value === previous) ? previous : choices[0][0];
      source.disabled = questionSources === null;
      const missingIelts = profile.value === "ielts" && !questionSources?.bundledAvailable;
      start.disabled = source.disabled || missingIelts;
      sourceStatus.textContent = source.disabled ? "正在读取题库信息…"
        : missingIelts ? "本地雅思题库不可用，请检查本地题库安装后重新打开练习。"
          : questionSources?.message || "";
    }
    profile.addEventListener("change", () => updateSources(true));
    updateSources();
    actions.append(cancel, start);
    form.append(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const selectedIds = [...form.querySelectorAll('input[name="practiceItem"]:checked')].map((input) => input.value);
      if (!selectedIds.length || start.disabled) return;
      onStart?.({ selectedIds, profile: profile.value, sourceMode: source.value });
    });
    card.append(form);
    root.append(card);
    return { updateQuestionSources(next) { questionSources = next || {}; updateSources(); } };
  }

  function mountLoading({ root, speaking = false, onExit }) {
    const documentRef = root.ownerDocument || document;
    root.replaceChildren();
    const card = el(documentRef, "section", "practice-card practice-loading");
    card.append(el(documentRef, "h2", "practice-title", speaking ? "正在准备整组口语题" : "正在准备练习材料"));
    card.append(el(documentRef, "p", "practice-help", speaking ? "正在为全部已掌握表达准备一道口语题和参考。" : "DeepSeek 正在根据你选中的表达生成内化提示。"));
    if (onExit) {
      const exit = el(documentRef, "button", "practice-text-button", "退出本次练习");
      exit.type = "button";
      exit.addEventListener("click", onExit);
      card.append(exit);
    }
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
        targetText: anchor.targetText,
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

  function mountSpeakingRound({ root, round, expressions, position, revealed = false, retryChoiceOpen = false, error = "", onSeek, onReveal, onFinish, onNeedPractice, onRetrySame, onChangeQuestion, onCancelRetry, onExit }) {
    const documentRef = root.ownerDocument || document;
    root.replaceChildren();
    const card = el(documentRef, "section", "practice-card");
    const top = el(documentRef, "div", "practice-stage-top");
    top.append(el(documentRef, "span", "practice-kicker", "整组口语输出"), el(documentRef, "span", "practice-progress", `第 ${position || 1} 题 · 第 ${round.attemptCount || 1} 次作答`));
    card.append(top);
    const part = { part1: "IELTS Part 1", part2: "IELTS Part 2", part3: "IELTS Part 3" }[round.part];
    if (part) card.append(el(documentRef, "p", "practice-kicker", part));
    card.append(el(documentRef, "h2", "practice-title practice-speaking-question", round.question));
    if (round.cuePoints?.length) {
      const cues = el(documentRef, "ul", "practice-cue-points");
      round.cuePoints.forEach((cue) => cues.append(el(documentRef, "li", "", cue)));
      card.append(cues);
    }
    const chips = el(documentRef, "div", "practice-expression-chips");
    expressions.forEach((item) => {
      const chip = el(documentRef, "button", "practice-expression-chip", item.expression);
      chip.type = "button";
      chip.setAttribute("aria-label", `${item.expression} · 跳转原句`);
      chip.addEventListener("click", () => onSeek?.(item.anchors?.[0]?.timestampSeconds || 0));
      chips.append(chip);
    });
    card.append(chips, el(documentRef, "p", "practice-speak-first", "先开口完整回答，再查看口语参考。自然运用这些表达即可。"));
    if (error) {
      const notice = el(documentRef, "p", "practice-inline-error", error);
      notice.setAttribute("role", "alert");
      card.append(notice);
    }
    const answer = el(documentRef, "div", "practice-answer");
    answer.hidden = !revealed;
    answer.append(el(documentRef, "strong", "", "口语参考"));
    const reference = el(documentRef, "p", "practice-speaking-reference");
    const targets = [...new Set(expressions.map((item) => item.expression).filter(Boolean))].sort((a, b) => b.length - a.length);
    const text = String(round.reference || "");
    if (targets.length) {
      const pattern = targets.map((target) => target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      let cursor = 0;
      for (const match of text.matchAll(new RegExp(pattern, "giu"))) {
        reference.append(documentRef.createTextNode(text.slice(cursor, match.index)), el(documentRef, "mark", "practice-highlight", match[0]));
        cursor = match.index + match[0].length;
      }
      reference.append(documentRef.createTextNode(text.slice(cursor)));
    } else reference.textContent = text;
    answer.append(reference);
    function button(copy, callback, className = "practice-secondary") {
      const node = el(documentRef, "button", className, copy);
      node.type = "button";
      node.addEventListener("click", () => callback?.());
      return node;
    }
    const actions = el(documentRef, "div", "practice-actions practice-speaking-actions");
    actions.hidden = !revealed;
    actions.append(button("完成本次练习", onFinish, "practice-primary"), button("需要再练", onNeedPractice));
    const reveal = button("口语参考", () => {
      answer.hidden = false;
      actions.hidden = false;
      reveal.hidden = true;
      onReveal?.();
    }, "practice-secondary practice-reveal");
    reveal.hidden = revealed;
    const choices = el(documentRef, "div", "practice-retry-choices");
    choices.hidden = !revealed || !retryChoiceOpen;
    [["再答一次这道题", onRetrySame], ["换一道新题", onChangeQuestion], ["返回当前题目", onCancelRetry]].forEach(([copy, callback], index) => {
      const choice = el(documentRef, "div", "practice-retry-choice");
      const action = button(copy, callback);
      choice.append(action);
      if (index === 1) {
        const cost = el(documentRef, "small", "practice-help", "换新题会再次请求 DeepSeek API，产生费用。");
        cost.id = "practiceNewQuestionCost";
        action.setAttribute("aria-describedby", cost.id);
        choice.append(cost);
      }
      choices.append(choice);
    });
    card.append(reveal, answer, actions, choices, button("退出本次练习", onExit, "practice-text-button"));
    root.append(card);
  }

  function mountSummary({ root, session, onClose }) {
    const documentRef = root.ownerDocument || document;
    root.replaceChildren();
    const card = el(documentRef, "section", "practice-card");
    card.append(el(documentRef, "h2", "practice-title", "本期表达练习完成"));
    const labels = { listening: "听辨", internalization: "内化" };
    Object.entries(labels).forEach(([stage, label]) => {
      const counts = YTD_PRACTICE.stageCounts(session, stage);
      card.append(el(documentRef, "p", "practice-summary-row", `${label}：${counts.mastered} 会 / ${counts.review} 待复习`));
    });
    const rounds = session.speakingRounds || [];
    const finished = rounds.filter((round) => round.outcome === "finished").length;
    const needsPractice = rounds.filter((round) => round.outcome === "needs_practice").length;
    const retries = rounds.reduce((sum, round) => sum + Math.max(0, (round.attemptCount || 1) - 1), 0);
    card.append(el(documentRef, "p", "practice-summary-row", `口语输出：完成 ${finished} 题 / 需要再练 ${needsPractice} 题 / 原题重答 ${retries} 次`));
    const close = el(documentRef, "button", "practice-primary", "完成");
    close.type = "button";
    close.addEventListener("click", () => onClose?.());
    card.append(close);
    root.append(card);
  }

  return { internalizationGuidance, mountSetup, mountLoading, mountStage, mountSpeakingRound, mountSummary };
})();

if (typeof module !== "undefined" && module.exports) module.exports = YTD_PRACTICE_UI;

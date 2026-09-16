const YTD_PRACTICE_FLOW = (() => {
  const practice = typeof module !== "undefined" && module.exports
    ? require("./practice-session.js") : YTD_PRACTICE;
  const PRACTICE_STAGES = ["listening", "internalization"];

  function create(session) {
    return {
      session, phase: session.selectedItemIds.length ? "items" : "summary",
      stage: PRACTICE_STAGES[0], queue: [...session.selectedItemIds], index: 0,
      isRetry: false, listeningRetry: false,
      revealed: false, retryChoiceOpen: false, error: "", previousSession: null,
    };
  }

  function currentView(flow) {
    if (flow.phase === "items") return {
      type: "item", stage: flow.stage,
      item: flow.session.items.find((item) => item.id === flow.queue[flow.index]),
      position: flow.index + 1, total: flow.queue.length, isRetry: flow.isRetry,
    };
    return {
      type: flow.phase, round: flow.session.speakingRounds.at(-1) || null,
      expressions: practice.speakingItems(flow.session), position: flow.session.speakingRounds.length,
      revealed: flow.revealed, retryChoiceOpen: flow.retryChoiceOpen, error: flow.error,
    };
  }

  // Session helpers stamp wall time for other consumers. Reducer outputs retain
  // the input timestamp so identical events always produce identical state.
  function stableSession(flow, session) {
    return session ? { ...session, updatedAt: flow.session.updatedAt } : null;
  }

  function requestSpeaking(flow) {
    return {
      flow: { ...flow, phase: "speaking_loading", error: "", retryChoiceOpen: false },
      effect: { type: "REQUEST_SPEAKING_ROUND", expressionIds: [...flow.session.speakingExpressionIds], usedQuestionIds: practice.usedQuestionIds(flow.session) },
    };
  }

  function finishItems(flow) {
    if (flow.listeningRetry) return { flow: { ...flow, phase: "summary", queue: [] }, effect: null };
    if (flow.stage === "listening") return {
      flow: { ...flow, stage: PRACTICE_STAGES[1], queue: [...flow.session.selectedItemIds], index: 0 }, effect: null,
    };
    const reviews = practice.internalizationReviewItems(flow.session);
    if (reviews.length) return {
      flow: { ...flow, queue: reviews.map((item) => item.id), index: 0, isRetry: true }, effect: null,
    };
    if (practice.isReadyForSpeaking(flow.session)) return requestSpeaking(flow);
    return { flow, effect: null };
  }

  function speakingFailed(flow, message) {
    return { flow: {
      ...flow, session: flow.previousSession || flow.session, previousSession: null,
      phase: flow.previousSession ? "speaking" : "speaking_error",
      retryChoiceOpen: false, error: String(message || "暂时无法准备口语题，请重试。").slice(0, 500),
    }, effect: null };
  }

  function reduce(flow, event) {
    const unchanged = { flow, effect: null };
    if (!flow || !event) return unchanged;
    if (event.type === "RATE_ITEM") {
      if (flow.phase !== "items" || event.itemId !== flow.queue[flow.index] || event.stage !== flow.stage) return unchanged;
      const session = stableSession(flow, practice.rateStage(flow.session, {
        itemId: event.itemId, stage: event.stage, rating: event.rating, retry: flow.listeningRetry,
      }));
      if (!session) return unchanged;
      const next = { ...flow, session, index: flow.index + 1 };
      return next.index < next.queue.length ? { flow: next, effect: null } : finishItems(next);
    }
    if (event.type === "SPEAKING_FAILED") return flow.phase === "speaking_loading" ? speakingFailed(flow, event.message) : unchanged;
    if (event.type === "SPEAKING_READY") {
      if (flow.phase !== "speaking_loading") return unchanged;
      let session = stableSession(flow, practice.addSpeakingRound(flow.session, event.round));
      if (!session) return speakingFailed(flow, "口语题无效或已使用，请重新换题。");
      session = { ...session, speakingRounds: session.speakingRounds.map((round, index) => index === session.speakingRounds.length - 1
        ? { ...round, createdAt: flow.session.updatedAt } : round) };
      return { flow: { ...flow, session, phase: "speaking", revealed: false, retryChoiceOpen: false, error: "", previousSession: null, queue: [] }, effect: null };
    }
    if (event.type === "RETRY_NEW_QUESTION" && flow.phase === "speaking_error") return requestSpeaking(flow);
    if (flow.phase !== "speaking") return unchanged;
    if (event.type === "REVEAL_SPEAKING") return { flow: { ...flow, revealed: true }, effect: null };
    if (!flow.revealed) return unchanged;
    if (event.type === "OPEN_RETRY_CHOICE") return { flow: { ...flow, retryChoiceOpen: true }, effect: null };
    if (event.type === "CANCEL_RETRY_CHOICE") return { flow: { ...flow, retryChoiceOpen: false }, effect: null };
    const roundId = flow.session.speakingRounds.at(-1)?.id;
    if (event.type === "RETRY_SAME_QUESTION" && flow.retryChoiceOpen) {
      const session = stableSession(flow, practice.retrySameSpeakingRound(flow.session, { roundId }));
      return session ? { flow: { ...flow, session, revealed: false, retryChoiceOpen: false, error: "" }, effect: null } : unchanged;
    }
    if (event.type === "RETRY_NEW_QUESTION" && flow.retryChoiceOpen) {
      const session = stableSession(flow, practice.finishSpeakingRound(flow.session, { roundId, outcome: "needs_practice" }));
      return session ? requestSpeaking({ ...flow, session, previousSession: flow.session }) : unchanged;
    }
    if (event.type === "FINISH_SPEAKING") {
      const session = stableSession(flow, practice.finishSpeakingRound(flow.session, { roundId, outcome: "finished" }));
      if (!session) return unchanged;
      const queue = practice.nextRetryTasks(session).map((task) => task.itemId);
      return { flow: { ...flow, session, queue, index: 0, phase: queue.length ? "items" : "summary", stage: "listening", listeningRetry: true, isRetry: true, error: "", retryChoiceOpen: false }, effect: null };
    }
    return unchanged;
  }

  return { create, currentView, reduce };
})();

if (typeof module !== "undefined" && module.exports) module.exports = YTD_PRACTICE_FLOW;

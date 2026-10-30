(() => {
  "use strict";

  const levels = { watch: 1, "at-least-watch": 1, "near-limit": 2, "at-least-near-limit": 2, critical: 3, "at-least-critical": 3 };
  const displayNames = { 1: "Watch", 2: "Near limit", 3: "Critical" };

  function rankForRisk(risk) {
    return levels[risk?.level] || 0;
  }

  function crossing(previousState, nextState, model, highestNotified = 0, assessRisk) {
    if (!previousState || !nextState || !model?.available || typeof assessRisk !== "function") return null;
    if (!Number.isFinite(previousState.estimatedTextTokens) || !Number.isFinite(nextState.estimatedTextTokens)) return null;
    if (nextState.estimatedTextTokens <= previousState.estimatedTextTokens) return null;
    const previousRisk = assessRisk(model, previousState.estimatedTextTokens, previousState.historyStatus);
    const nextRisk = assessRisk(model, nextState.estimatedTextTokens, nextState.historyStatus);
    const previousRank = rankForRisk(previousRisk);
    const nextRank = rankForRisk(nextRisk);
    if (nextRank <= previousRank || nextRank <= highestNotified) return null;
    return { rank: nextRank, level: displayNames[nextRank], partial: nextState.historyStatus !== "Complete" };
  }

  function shouldDispatch({ enabled, collecting, crossing: transition }) {
    return enabled === true && collecting !== true && Boolean(transition && transition.rank >= 1 && transition.rank <= 3);
  }

  function notificationText(chatTitle, transition) {
    const title = typeof chatTitle === "string" && chatTitle.trim() ? chatTitle.trim().slice(0, 120) : "This chat";
    const quotedTitle = `“${title}”`;
    let message;
    if (transition.level === "Critical") {
      message = transition.partial
        ? `${quotedTitle} has reached at least the Critical threshold in the loaded part of its history. Consider starting a new branch or chat; the ChatGPT limit has not been confirmed reached.`
        : `${quotedTitle} is in the Critical range. Consider starting a new branch or chat; the ChatGPT limit has not been confirmed reached.`;
    } else if (transition.partial) {
      message = `${quotedTitle} has already reached at least the ${transition.level} threshold in the loaded part of its history.`;
    } else if (transition.level === "Near limit") {
      message = `${quotedTitle} is approaching the observed chat-length limit.`;
    } else {
      message = `${quotedTitle} has entered the Watch range for observed chat length.`;
    }
    return { title: `GPT Limits — ${transition.partial ? "At least " : ""}${transition.level}`, message };
  }

  globalThis.GptRiskNotifications = { rankForRisk, crossing, shouldDispatch, notificationText };
})();

if (typeof module !== "undefined" && module.exports) module.exports = globalThis.GptRiskNotifications;

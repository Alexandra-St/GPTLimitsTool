(() => {
  "use strict";

  const labels = ["normal", "near_limit", "limit_reached"];
  const histories = ["Complete", "Partial", "Unknown"];
  const labelNames = { normal: "Normal", near_limit: "Near limit", limit_reached: "Limit reached" };
  const sourceKeyPattern = /^src_[a-f0-9]{16}$/;

  function totalAttachments(point) {
    return point.images + point.audio + point.video + point.otherAttachments;
  }

  function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    if (sorted.length === 0) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function ranges(points) {
    const fields = ["messagesCollected", "estimatedTextTokens", "images", "totalAttachments"];
    return Object.fromEntries(fields.map((field) => {
      const values = points.map((point) => field === "totalAttachments" ? totalAttachments(point) : point[field]);
      return [field, values.length ? { min: Math.min(...values), median: median(values), max: Math.max(...values) } : null];
    }));
  }

  function summarize(chats) {
    const points = [];
    for (const chat of Array.isArray(chats) ? chats : []) {
      for (const [pointIndex, point] of (Array.isArray(chat.calibrationPoints) ? chat.calibrationPoints : []).entries()) {
        if (!point || !labels.includes(point.label)) continue;
        points.push({
          chatTitle: chat.title || "Unknown",
          conversationId: chat.conversationId,
          sourceKey: sourceKeyPattern.test(chat.calibrationSourceKey || "") ? chat.calibrationSourceKey : (sourceKeyPattern.test(point.sourceKey || "") ? point.sourceKey : null),
          pointIndex,
          label: point.label,
          timestamp: Number.isFinite(point.timestamp) ? point.timestamp : 0,
          messagesCollected: point.messagesCollected || 0,
          estimatedTextTokens: point.estimatedTextTokens || 0,
          images: point.images || 0,
          audio: point.audio || 0,
          video: point.video || 0,
          otherAttachments: point.otherAttachments || 0,
          historyStatus: histories.includes(point.historyStatus) ? point.historyStatus : "Unknown",
        });
      }
    }
    const byLabel = {};
    for (const label of labels) {
      const matching = points.filter((point) => point.label === label);
      byLabel[label] = {
        count: matching.length,
        uniqueSources: new Set(matching.map((point) => point.sourceKey).filter(Boolean)).size,
        byHistory: Object.fromEntries(histories.map((history) => {
          const group = matching.filter((point) => point.historyStatus === history);
          return [history, { count: group.length, uniqueSources: new Set(group.map((point) => point.sourceKey).filter(Boolean)).size, ranges: ranges(group) }];
        })),
      };
    }
    points.sort((left, right) => right.timestamp - left.timestamp || left.chatTitle.localeCompare(right.chatTitle));
    const latestBySource = new Map();
    const latestCompleteBySource = new Map();
    for (const point of points) {
      if (!point.sourceKey) continue;
      if (!latestBySource.has(point.sourceKey)) latestBySource.set(point.sourceKey, point);
      if (point.historyStatus === "Complete" && !latestCompleteBySource.has(point.sourceKey)) latestCompleteBySource.set(point.sourceKey, point);
    }
    return {
      counts: Object.fromEntries(labels.map((label) => [label, byLabel[label].count])),
      uniqueSourceCounts: Object.fromEntries(labels.map((label) => [label, byLabel[label].uniqueSources])),
      byLabel,
      points,
      latestPerSource: [...latestBySource.values()],
      latestCompletePerSource: [...latestCompleteBySource.values()],
    };
  }

  function buildRiskModel(chats) {
    const completePoints = summarize(chats).latestCompletePerSource;
    const normal = completePoints.filter((point) => point.label === "normal");
    const limitReached = completePoints.filter((point) => point.label === "limit_reached");
    const safeCeiling = normal.length ? Math.max(...normal.map((point) => point.estimatedTextTokens)) : null;
    const limitFloor = limitReached.length ? Math.min(...limitReached.map((point) => point.estimatedTextTokens)) : null;
    const model = {
      available: false,
      reason: null,
      normalSources: normal.length,
      limitReachedSources: limitReached.length,
      safeCeiling,
      limitFloor,
      gap: safeCeiling !== null && limitFloor !== null ? limitFloor - safeCeiling : null,
      watchThreshold: null,
      nearLimitThreshold: null,
      criticalThreshold: null,
      normalMessagesCeiling: normal.length ? Math.max(...normal.map((point) => point.messagesCollected)) : null,
      limitMessagesFloor: limitReached.length ? Math.min(...limitReached.map((point) => point.messagesCollected)) : null,
    };
    if (normal.length < 2 || limitReached.length < 2) {
      model.reason = "insufficient-data";
      return model;
    }
    if (safeCeiling >= limitFloor) {
      model.reason = "overlap";
      return model;
    }
    model.available = true;
    model.gap = limitFloor - safeCeiling;
    model.watchThreshold = Math.round(safeCeiling + model.gap * 0.3);
    model.nearLimitThreshold = Math.round(safeCeiling + model.gap * 0.6);
    model.criticalThreshold = Math.round(safeCeiling + model.gap * 0.8);
    return model;
  }

  function assessRisk(model, estimatedTextTokens, historyStatus) {
    if (!model?.available) {
      return {
        level: "unavailable",
        text: model?.reason === "overlap"
          ? "Calibration overlap detected — risk model unavailable."
          : "Risk model unavailable — more calibration data is needed.",
      };
    }
    const tokens = Number.isFinite(estimatedTextTokens) ? Math.max(0, estimatedTextTokens) : 0;
    const complete = historyStatus === "Complete";
    if (complete) {
      if (tokens >= model.criticalThreshold) return { level: "critical", text: "Risk: Critical" };
      if (tokens >= model.nearLimitThreshold) return { level: "near-limit", text: "Risk: Near limit" };
      if (tokens >= model.watchThreshold) return { level: "watch", text: "Risk: Watch" };
      return { level: "normal", text: "Risk: Normal" };
    }
    if (tokens >= model.criticalThreshold) return { level: "at-least-critical", text: "Risk: At least Critical — history incomplete" };
    if (tokens >= model.nearLimitThreshold) return { level: "at-least-near-limit", text: "Risk: At least Near limit — history incomplete" };
    if (tokens >= model.watchThreshold) return { level: "at-least-watch", text: "Risk: At least Watch — history incomplete" };
    return { level: "unknown", text: "Risk: Unknown — history incomplete" };
  }

  function exportText(chats) {
    const summary = summarize(chats);
    const safePoints = summary.points.map((point) => ({
      title: point.chatTitle,
      sourceKey: point.sourceKey,
      label: labelNames[point.label],
      timestamp: point.timestamp,
      messagesCollected: point.messagesCollected,
      estimatedTextTokens: point.estimatedTextTokens,
      images: point.images,
      audio: point.audio,
      video: point.video,
      otherAttachments: point.otherAttachments,
      totalAttachments: totalAttachments(point),
      historyStatus: point.historyStatus,
    }));
    return JSON.stringify({ counts: {
      normal: summary.counts.normal,
      nearLimit: summary.counts.near_limit,
      limitReached: summary.counts.limit_reached,
    }, uniqueSources: {
      normal: summary.uniqueSourceCounts.normal,
      nearLimit: summary.uniqueSourceCounts.near_limit,
      limitReached: summary.uniqueSourceCounts.limit_reached,
    }, points: safePoints }, null, 2);
  }

  globalThis.GptCalibrationSummary = { labels, labelNames, histories, totalAttachments, median, ranges, summarize, buildRiskModel, assessRisk, exportText };
})();

if (typeof module !== "undefined" && module.exports) module.exports = globalThis.GptCalibrationSummary;

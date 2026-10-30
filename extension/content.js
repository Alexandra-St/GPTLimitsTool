(() => {
  "use strict";

  const marker = "gpt-limits-tool-capture-v1";
  const replayMarker = `${marker}:replay-last-capture`;
  const chatsKey = "gptLimitsChats";
  const legacyStorageKey = "gptLimitsCurrentConversation";
  const notificationsPreferenceKey = "gptLimitsDesktopRiskNotifications";
  const backgroundCheckStatusKey = "gptLimitsBackgroundCheckStatus";
  const calibrationLabels = ["normal", "near_limit", "limit_reached"];
  const sourceKeyPattern = /^src_[a-f0-9]{16}$/;
  const aggregator = globalThis.GptLimitsAggregator;
  const historyCollector = globalThis.GptHistoryCollector;
  const calibrationSummary = globalThis.GptCalibrationSummary;
  const riskNotifications = globalThis.GptRiskNotifications;
  let chats = {};
  let captureStatus = "Waiting";
  let desktopNotificationsEnabled = false;
  let historyCollection = null;
  let backgroundCheck = null;
  let isBackgroundCheckTab = false;
  let backgroundReadySent = false;
  let backgroundReadyPending = false;
  let backgroundCheckStarting = false;
  let backgroundRouteMonitor = null;
  const recentCapturePages = [];
  const seenCaptureSequences = new Set();
  const pendingReplayRequests = new Map();
  let replayRequestSequence = 0;
  let fallbackCaptureSequence = 0;
  let collectionGeneration = 0;
  let lastUserScrolledContainer = null;
  let userScrollIntentUntil = 0;
  const historyPagesObserved = Object.create(null);

  const noteUserScrollIntent = (event) => {
    if (event.isTrusted) userScrollIntentUntil = Date.now() + 1500;
  };
  window.addEventListener("wheel", noteUserScrollIntent, { capture: true, passive: true });
  window.addEventListener("touchstart", noteUserScrollIntent, { capture: true, passive: true });
  window.addEventListener("keydown", (event) => {
    if (event.isTrusted && ["ArrowUp", "PageUp", "Home", "Space"].includes(event.code)) userScrollIntentUntil = Date.now() + 1500;
  }, true);

  window.addEventListener("scroll", (event) => {
    if (!event.isTrusted || Date.now() > userScrollIntentUntil || typeof document === "undefined") return;
    const roots = [...document.querySelectorAll("main, [role='main']")];
    const target = event.target === document ? document.scrollingElement : event.target;
    if (!target || target.nodeType !== 1) return;
    if (roots.length && target !== document.scrollingElement && !roots.some((root) => root === target || root.contains(target))) return;
    const height = target.clientHeight || 0;
    const width = target.clientWidth || 0;
    if (target.scrollHeight - height < 120 || height < 250 || width < 300) return;
    lastUserScrolledContainer = target;
  }, true);

  function extractConversationIdFromUrl(value) {
    if (typeof value !== "string") return null;
    const route = value.match(/^https:\/\/chatgpt\.com(?::443)?(\/[^?#]*)?(?:[?#]|$)/i);
    if (!route) return null;
    const match = (route[1] || "/").match(/(?:^|\/)c\/([^/]+)(?:\/|$)/i);
    if (!match) return null;
    try { return decodeURIComponent(match[1]); } catch { return null; }
  }

  function activeConversationId() {
    return extractConversationIdFromUrl(window.location.href || `${window.location.origin}${window.location.pathname}`) || "";
  }

  function stopBackgroundRouteMonitor() {
    if (backgroundRouteMonitor !== null) clearInterval(backgroundRouteMonitor);
    backgroundRouteMonitor = null;
  }

  function startBackgroundRouteMonitor() {
    if (backgroundRouteMonitor !== null) return;
    backgroundRouteMonitor = setInterval(() => {
      if (!isBackgroundCheckTab) { stopBackgroundRouteMonitor(); return; }
      const conversationId = activeConversationId();
      if (conversationId && !backgroundReadySent && !backgroundReadyPending) {
        backgroundReadyPending = true;
        void sendBackgroundMessage({ type: "gpt-limits:background-check-ready" }).then((result) => {
          if (result?.ok === true && result.started === true) backgroundReadySent = true;
        }).catch(() => {}).finally(() => { backgroundReadyPending = false; });
      }
      const check = backgroundCheck;
      if (check && conversationId && conversationId !== check.conversationId) {
        stopBackgroundRouteMonitor();
        void reportBackgroundCheck("failed", "navigation");
      }
      if (backgroundReadySent && !backgroundCheck) stopBackgroundRouteMonitor();
    }, 250);
  }

  function stateForStorage(state) {
    const sourceKey = validSourceKey(state.calibrationSourceKey) ? state.calibrationSourceKey : createCalibrationSourceKey();
    return {
      conversationId: typeof state.conversationId === "string" ? state.conversationId : "",
      title: typeof state.title === "string" ? state.title.slice(0, 500) : "",
      processedMessageIds: Array.isArray(state.processedMessageIds)
        ? [...new Set(state.processedMessageIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 256))]
        : [],
      messagesCollected: safeCount(state.messagesCollected),
      userMessages: safeCount(state.userMessages),
      assistantMessages: safeCount(state.assistantMessages),
      otherMessages: safeCount(state.otherMessages),
      estimatedTextTokens: safeCount(state.estimatedTextTokens),
      attachments: {
        images: safeCount(state.attachments?.images),
        audio: safeCount(state.attachments?.audio),
        video: safeCount(state.attachments?.video),
        files: safeCount(state.attachments?.files),
      },
      hasPreviousPage: typeof state.hasPreviousPage === "boolean" ? state.hasPreviousPage : null,
      hasNextPage: typeof state.hasNextPage === "boolean" ? state.hasNextPage : null,
      historyComplete: state.historyComplete === true && state.hasPreviousPage === false,
      updatedAt: Number.isFinite(state.updatedAt) ? state.updatedAt : null,
      monitored: state.monitored === true,
      riskNotificationLevel: Number.isSafeInteger(state.riskNotificationLevel) && state.riskNotificationLevel >= 0 && state.riskNotificationLevel <= 3
      ? state.riskNotificationLevel
      : 0,
      lastAutomaticCheckAt: Number.isFinite(state.lastAutomaticCheckAt) ? state.lastAutomaticCheckAt : null,
      lastAutomaticCheckResult: ["complete", "failed", "skipped"].includes(state.lastAutomaticCheckResult) ? state.lastAutomaticCheckResult : null,
      calibrationSourceKey: sourceKey,
      calibrationSnapshots: sanitizeSnapshots(state.calibrationSnapshots),
      calibrationLabel: calibrationLabels.includes(state.calibrationLabel) ? state.calibrationLabel : null,
      calibrationPoints: sanitizeCalibrationPoints(state.calibrationPoints, sourceKey),
    };
  }

  function sendBackgroundMessage(message) {
    if (typeof chrome.runtime.sendMessage !== "function") return Promise.resolve(null);
    return Promise.resolve().then(() => chrome.runtime.sendMessage(message));
  }

  function requestLatestCapture(conversationId, startedAt) {
    if (typeof window.postMessage !== "function") return Promise.resolve();
    const requestId = `${Date.now()}-${++replayRequestSequence}`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pendingReplayRequests.delete(requestId);
        resolve();
      }, 150);
      pendingReplayRequests.set(requestId, () => {
        clearTimeout(timeout);
        pendingReplayRequests.delete(requestId);
        resolve();
      });
      window.postMessage({
        source: replayMarker,
        requestId,
        conversationId,
        startedAt,
      }, window.location.origin);
    });
  }

  const backgroundTabReady = sendBackgroundMessage({ type: "gpt-limits:identify-background-check-tab" })
    .then((result) => { isBackgroundCheckTab = result?.active === true; })
    .catch(() => { isBackgroundCheckTab = false; });

  function validSourceKey(value) {
    return typeof value === "string" && sourceKeyPattern.test(value);
  }

  function createCalibrationSourceKey() {
    const bytes = new Uint8Array(8);
    const cryptoApi = window.crypto || globalThis.crypto;
    if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    return `src_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  function safeCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  function normalizeStoredChat(conversationId, value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || value.conversationId !== conversationId) return null;
    const title = typeof value.title === "string" ? value.title.slice(0, 500) : "";
    const normalized = aggregator.emptyState(conversationId, title);
    normalized.processedMessageIds = Array.isArray(value.processedMessageIds)
      ? [...new Set(value.processedMessageIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 256))]
      : [];
    for (const field of ["messagesCollected", "userMessages", "assistantMessages", "otherMessages", "estimatedTextTokens"]) {
      normalized[field] = safeCount(value[field]);
    }
    const savedAttachments = value.attachments && typeof value.attachments === "object" && !Array.isArray(value.attachments) ? value.attachments : {};
    normalized.attachments = {
      images: safeCount(savedAttachments.images),
      audio: safeCount(savedAttachments.audio),
      video: safeCount(savedAttachments.video),
      files: safeCount(savedAttachments.files),
    };
    normalized.hasPreviousPage = typeof value.hasPreviousPage === "boolean" ? value.hasPreviousPage : null;
    normalized.hasNextPage = typeof value.hasNextPage === "boolean" ? value.hasNextPage : null;
    normalized.historyComplete = value.historyComplete === true && normalized.hasPreviousPage === false;
    normalized.updatedAt = Number.isFinite(value.updatedAt) ? value.updatedAt : null;
    normalized.monitored = value.monitored === true;
    normalized.riskNotificationLevel = Number.isSafeInteger(value.riskNotificationLevel) && value.riskNotificationLevel >= 0 && value.riskNotificationLevel <= 3 ? value.riskNotificationLevel : 0;
    normalized.lastAutomaticCheckAt = Number.isFinite(value.lastAutomaticCheckAt) ? value.lastAutomaticCheckAt : null;
    normalized.lastAutomaticCheckResult = ["complete", "failed", "skipped"].includes(value.lastAutomaticCheckResult) ? value.lastAutomaticCheckResult : null;
    normalized.calibrationSourceKey = validSourceKey(value.calibrationSourceKey) ? value.calibrationSourceKey : createCalibrationSourceKey();
    normalized.calibrationSnapshots = sanitizeSnapshots(value.calibrationSnapshots);
    normalized.calibrationLabel = calibrationLabels.includes(value.calibrationLabel) ? value.calibrationLabel : null;
    normalized.calibrationPoints = sanitizeCalibrationPoints(value.calibrationPoints, normalized.calibrationSourceKey);
    return normalized;
  }

  function sanitizeCalibrationPoints(points, fallbackSourceKey = null) {
    if (!Array.isArray(points)) return [];
    return points.slice(-20).filter((point) => point && typeof point === "object" && calibrationLabels.includes(point.label)).map((point) => ({
      sourceKey: validSourceKey(fallbackSourceKey) ? fallbackSourceKey : (validSourceKey(point.sourceKey) ? point.sourceKey : null),
      timestamp: Number.isFinite(point.timestamp) ? point.timestamp : 0,
      label: point.label,
      messagesCollected: Number.isSafeInteger(point.messagesCollected) && point.messagesCollected >= 0 ? point.messagesCollected : 0,
      userMessages: Number.isSafeInteger(point.userMessages) && point.userMessages >= 0 ? point.userMessages : 0,
      assistantMessages: Number.isSafeInteger(point.assistantMessages) && point.assistantMessages >= 0 ? point.assistantMessages : 0,
      otherMessages: Number.isSafeInteger(point.otherMessages) && point.otherMessages >= 0 ? point.otherMessages : 0,
      estimatedTextTokens: Number.isSafeInteger(point.estimatedTextTokens) && point.estimatedTextTokens >= 0 ? point.estimatedTextTokens : 0,
      images: Number.isSafeInteger(point.images) && point.images >= 0 ? point.images : 0,
      audio: Number.isSafeInteger(point.audio) && point.audio >= 0 ? point.audio : 0,
      video: Number.isSafeInteger(point.video) && point.video >= 0 ? point.video : 0,
      otherAttachments: Number.isSafeInteger(point.otherAttachments) && point.otherAttachments >= 0 ? point.otherAttachments : 0,
      historyStatus: ["Partial", "Complete", "Unknown"].includes(point.historyStatus) ? point.historyStatus : "Unknown",
      calibrationSnapshotsCount: Number.isSafeInteger(point.calibrationSnapshotsCount) && point.calibrationSnapshotsCount >= 0 ? point.calibrationSnapshotsCount : 0,
    }));
  }

  function calibrationPoint(state, label, timestamp) {
    const snapshot = createSnapshot(state, timestamp);
    return { ...snapshot, sourceKey: state.calibrationSourceKey, label, calibrationSnapshotsCount: state.calibrationSnapshots.length };
  }

  function sameCalibrationSample(left, right) {
    return left && ["label", "messagesCollected", "userMessages", "assistantMessages", "otherMessages", "estimatedTextTokens", "images", "audio", "video", "otherAttachments", "historyStatus"]
      .every((key) => left[key] === right[key]);
  }

  function sanitizeSnapshots(snapshots) {
    if (!Array.isArray(snapshots)) return [];
    return snapshots.slice(-100).filter((snapshot) => snapshot && typeof snapshot === "object").map((snapshot) => ({
      timestamp: Number.isFinite(snapshot.timestamp) ? snapshot.timestamp : 0,
      messagesCollected: safeCount(snapshot.messagesCollected),
      userMessages: safeCount(snapshot.userMessages),
      assistantMessages: safeCount(snapshot.assistantMessages),
      otherMessages: safeCount(snapshot.otherMessages),
      estimatedTextTokens: safeCount(snapshot.estimatedTextTokens),
      images: safeCount(snapshot.images),
      audio: safeCount(snapshot.audio),
      video: safeCount(snapshot.video),
      otherAttachments: safeCount(snapshot.otherAttachments),
      historyStatus: ["Partial", "Complete", "Unknown"].includes(snapshot.historyStatus) ? snapshot.historyStatus : "Unknown",
    }));
  }

  function historyStatus(state) {
    if (state.historyComplete === true && state.hasPreviousPage === false) return "Complete";
    if (state.hasPreviousPage === true) return "Partial";
    return "Unknown";
  }

  async function notifyOnRiskCrossing(previousState, nextState, wasNewChat, allowBackgroundCheck = false) {
    if (wasNewChat || !desktopNotificationsEnabled ||
      historyCollection?.conversationId === nextState.conversationId && historyCollection.status === "collecting" ||
      backgroundCheck?.conversationId === nextState.conversationId && ["waiting", "collecting", "finishing"].includes(backgroundCheck.status) ||
      isBackgroundCheckTab && !allowBackgroundCheck) return;
    const current = chats[nextState.conversationId];
    const transition = riskNotifications.crossing(
      { estimatedTextTokens: previousState.estimatedTextTokens, historyStatus: historyStatus(previousState) },
      { estimatedTextTokens: nextState.estimatedTextTokens, historyStatus: historyStatus(nextState) },
      calibrationSummary.buildRiskModel(Object.values(chats)),
      current.riskNotificationLevel,
      calibrationSummary.assessRisk,
    );
    if (!riskNotifications.shouldDispatch({ enabled: desktopNotificationsEnabled, collecting: false, crossing: transition })) return;
    try {
      const result = await chrome.runtime.sendMessage({
        type: "gpt-limits:show-risk-notification",
        chatTitle: nextState.title || "This chat",
        level: transition.level,
        partial: transition.partial,
      });
      if (result?.ok) current.riskNotificationLevel = Math.max(current.riskNotificationLevel || 0, transition.rank);
    } catch {
      // A failed send must not consume a higher notification level.
    }
  }

  function createSnapshot(state, timestamp) {
    return {
      timestamp,
      messagesCollected: state.messagesCollected,
      userMessages: state.userMessages,
      assistantMessages: state.assistantMessages,
      otherMessages: state.otherMessages,
      estimatedTextTokens: state.estimatedTextTokens,
      images: state.attachments.images,
      audio: state.attachments.audio,
      video: state.attachments.video,
      otherAttachments: state.attachments.files,
      historyStatus: historyStatus(state),
    };
  }

  function maybeAddSnapshot(state, timestamp) {
    if (state.monitored !== true) return;
    const snapshot = createSnapshot(state, timestamp);
    const previous = state.calibrationSnapshots[state.calibrationSnapshots.length - 1];
    const shouldAdd = !previous ||
      snapshot.messagesCollected - previous.messagesCollected >= 10 ||
      snapshot.estimatedTextTokens - previous.estimatedTextTokens >= 2000 ||
      snapshot.images !== previous.images ||
      snapshot.audio !== previous.audio ||
      snapshot.video !== previous.video ||
      snapshot.otherAttachments !== previous.otherAttachments ||
      snapshot.historyStatus !== previous.historyStatus;
    if (!shouldAdd) return;
    state.calibrationSnapshots.push(snapshot);
    if (state.calibrationSnapshots.length > 100) state.calibrationSnapshots.splice(0, state.calibrationSnapshots.length - 100);
  }

  function sortedChats() {
    return Object.values(chats).sort((left, right) =>
      Number(right.monitored === true) - Number(left.monitored === true) ||
      (Number.isFinite(right.updatedAt) ? right.updatedAt : 0) -
      (Number.isFinite(left.updatedAt) ? left.updatedAt : 0),
    );
  }

  async function persistChats() {
    const clean = {};
    for (const [id, state] of Object.entries(chats)) clean[id] = stateForStorage(state);
    await chrome.storage.local.set({ [chatsKey]: clean });
  }

  function cancelCollection(reason) {
    if (!historyCollection || historyCollection.status !== "collecting") return;
    collectionGeneration += 1;
    historyCollection = {
      ...historyCollection,
      status: "stopped",
      reason,
    };
  }

  function collectionState(state = chats[historyCollection?.conversationId]) {
    return {
      status: historyCollection?.status || "idle",
      reason: historyCollection?.reason || null,
      messagesCollected: state?.messagesCollected || 0,
    };
  }

  async function runHistoryCollection(conversationId, generation) {
    if (!historyCollector) return;
    let observedRoot = null;
    let mutationObserver = null;
    let domMutationVersion = 0;
    const refreshMutationObserver = () => {
      const root = document.querySelector("main, [role='main']");
      if (root === observedRoot) return;
      mutationObserver?.disconnect();
      observedRoot = root;
      const Observer = window.MutationObserver;
      if (root && Observer) {
        mutationObserver = new Observer((records) => { domMutationVersion += records.length; });
        mutationObserver.observe(root, { childList: true, subtree: true });
      }
    };
    try {
      refreshMutationObserver();
      const result = await historyCollector.collect({
        expectedConversationId: conversationId,
        getConversationId: activeConversationId,
        getState: async () => {
          await updateQueue;
          return chats[conversationId] || null;
        },
        findContainers: () => {
          refreshMutationObserver();
          return historyCollector.findScrollableContainers(document, window, lastUserScrolledContainer);
        },
        scrollToTop: (container) => {
          const beforeScrollTop = Number(container.scrollTop) || 0;
          const scrollHeight = Number(container.scrollHeight) || 0;
          if (beforeScrollTop <= 1) return { moved: false, alreadyAtTop: true, beforeScrollTop, afterScrollTop: beforeScrollTop, scrollHeight };
          try {
            container.scrollTo({ top: 0, behavior: "instant" });
          } catch {}
          if ((Number(container.scrollTop) || 0) > 1) container.scrollTop = 0;
          const afterScrollTop = Number(container.scrollTop) || 0;
          return { moved: afterScrollTop < beforeScrollTop, alreadyAtTop: afterScrollTop <= 1, beforeScrollTop, afterScrollTop, scrollHeight };
        },
        getExtraSignals: () => {
          refreshMutationObserver();
          return { historyPagesObserved: historyPagesObserved[conversationId] || 0, domMutationVersion };
        },
        wait: (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
        isCancelled: () => generation !== collectionGeneration,
        onProgress: (state, cycles) => {
          if (generation !== collectionGeneration || !historyCollection) return;
          historyCollection = { ...historyCollection, status: "collecting", cycles, messagesCollected: state?.messagesCollected || 0 };
        },
        pollIntervalMs: 400,
        attemptWaitMs: 12000,
        mutationQuietMs: 1200,
        maxAttemptWaitMs: 18000,
        maxCycles: 1000,
        maxStalledAttempts: 3,
      });
      if (generation !== collectionGeneration || !historyCollection) return;
      historyCollection = {
        ...historyCollection,
        status: result.status,
        reason: result.reason || null,
        messagesCollected: result.state?.messagesCollected || 0,
      };
    } catch {
      if (generation === collectionGeneration && historyCollection) {
        historyCollection = { ...historyCollection, status: "paused", reason: "error" };
      }
    } finally {
      mutationObserver?.disconnect();
    }
  }

  function compactCapturedPage(summary, captureSequence, observedAt) {
    return {
      conversationId: summary.conversationId,
      ids: Array.isArray(summary.items) ? summary.items.map((item) => item?.id).filter((id) => typeof id === "string") : [],
      captureSequence,
      observedAt,
      consumed: false,
    };
  }

  async function reportBackgroundCheck(status, reason = null) {
    if (!backgroundCheck) return;
    const check = backgroundCheck;
    stopBackgroundRouteMonitor();
    let finalStatus = status;
    let finalReason = reason;
    check.status = status === "complete" ? "finishing" : status;
    if (status === "complete") {
      try {
        await updateQueue;
        const finalState = chats[check.conversationId];
        if (backgroundCheck !== check) return;
        if (finalState && check.overlapFound) {
          // A complete baseline plus a continuous sequence back to an old ID
          // proves the aggregate spans the previously complete history.
          finalState.historyComplete = true;
          finalState.hasPreviousPage = false;
          maybeAddSnapshot(finalState, Date.now());
          await persistChats();
        }
        if (backgroundCheck === check) backgroundCheck = null;
        if (finalState) {
          try { await notifyOnRiskCrossing(check.baselineState, finalState, false, true); } catch {}
        }
      } catch {
        finalStatus = "failed";
        finalReason = "tab-error";
      }
    }
    if (backgroundCheck === check) backgroundCheck = null;
    try {
      await sendBackgroundMessage({
        type: "gpt-limits:background-check-result",
        tabId: check.tabId,
        status: finalStatus,
        reason: finalReason,
        newMessages: Math.max(0, check.newMessages),
        pagesLoaded: check.pagesLoaded,
        overlapFound: check.overlapFound,
      });
    } catch {}
  }

  async function runBackgroundCatchUp(check) {
    if (check.collectorStarted) return;
    check.collectorStarted = true;
    check.status = "collecting";
    let lastBackgroundHeartbeatAt = 0;
    try {
      const findContainers = () => historyCollector.findScrollableContainers(document, window, lastUserScrolledContainer);
      const readiness = await historyCollector.waitForScrollableContainers({
        findContainers,
        hasConversationDom: () => Boolean(document.querySelector("main, [role='main']")),
        getConversationId: activeConversationId,
        expectedConversationId: check.conversationId,
        isCancelled: () => backgroundCheck !== check || check.status !== "collecting",
        wait: (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
        timeoutMs: 5000,
        pollIntervalMs: 100,
      });
      if (backgroundCheck !== check) return;
      if (readiness.status !== "ready") {
        await reportBackgroundCheck("failed", readiness.reason || "conversation-dom-not-ready");
        return;
      }
      const result = await historyCollector.collectUntilOverlap({
      expectedConversationId: check.conversationId,
      getConversationId: activeConversationId,
      getState: async () => {
        await updateQueue;
        return chats[check.conversationId] || null;
      },
      findContainers,
      scrollToTop: (container) => {
        const before = Number(container.scrollTop) || 0;
        try { container.scrollTo({ top: 0, behavior: "instant" }); } catch {}
        if ((Number(container.scrollTop) || 0) > 1) container.scrollTop = 0;
        return { moved: (Number(container.scrollTop) || 0) < before };
      },
      getPageSignals: () => ({ pagesObserved: check.pagesObserved, overlapFound: check.overlapFound }),
      wait: (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs)),
      isCancelled: () => backgroundCheck !== check || check.status !== "collecting",
      onProgress: ({ state, pagesLoaded }) => {
        check.pagesLoaded = Math.max(check.pagesLoaded, pagesLoaded + check.initialPages);
        check.newMessages = Math.max(check.newMessages, (state?.messagesCollected || 0) - check.baselineMessageCount);
        void sendBackgroundMessage({
          type: "gpt-limits:background-check-progress",
          tabId: check.tabId,
          newMessages: check.newMessages,
          pagesLoaded: check.pagesLoaded,
        }).catch(() => {});
      },
      onHeartbeat: () => {
        if (Date.now() - lastBackgroundHeartbeatAt < 10000) return;
        lastBackgroundHeartbeatAt = Date.now();
        void sendBackgroundMessage({
          type: "gpt-limits:background-check-progress",
          tabId: check.tabId,
          newMessages: check.newMessages,
          pagesLoaded: check.pagesLoaded,
        }).catch(() => {});
      },
      pageWaitMs: 15000,
      maxPages: 30,
      maxStalledPages: 2,
      });
      if (backgroundCheck !== check) return;
      if (result.status === "complete" && check.overlapFound) {
        await reportBackgroundCheck("complete");
        return;
      }
      const reason = result.reason === "no-container" ? "scroll-container-not-found" : result.reason || "no-overlap";
      await reportBackgroundCheck("failed", reason);
    } catch {
      if (backgroundCheck === check) await reportBackgroundCheck("failed", "collector-start-exception");
    }
  }

  function recordBackgroundPage(summary, previousState, nextState) {
    const check = backgroundCheck;
    if (!check || check.conversationId !== summary.conversationId || ["complete", "failed", "finishing"].includes(check.status)) return;
    check.pagesObserved += 1;
    check.pagesLoaded += 1;
    check.newMessages = Math.max(check.newMessages, (nextState?.messagesCollected || 0) - check.baselineMessageCount);
    void sendBackgroundMessage({
      type: "gpt-limits:background-check-capture-observed",
      tabId: check.tabId,
      newMessages: check.newMessages,
      pagesLoaded: check.pagesLoaded,
    }).catch(() => {});
    const ids = summary.items.map((item) => item?.id).filter((id) => typeof id === "string");
    if (historyCollector.containsBaselineOverlap(ids, check.baselineIds)) {
      check.overlapFound = true;
      void reportBackgroundCheck("complete");
      return;
    }
    if (check.status === "waiting") {
      check.status = "collecting";
      void runBackgroundCatchUp(check);
    } else {
      void sendBackgroundMessage({
        type: "gpt-limits:background-check-progress",
        tabId: check.tabId,
        newMessages: check.newMessages,
        pagesLoaded: check.pagesLoaded,
      }).catch(() => {});
    }
  }

  function startBackgroundCheck(message, sender, sendResponse) {
    const requestedId = typeof message.conversationId === "string" ? message.conversationId : "";
    // chrome.tabs.sendMessage delivers this from the extension worker; sender.tab
    // is therefore absent. The worker supplies the target temporary tab ID.
    const tabId = Number.isInteger(message.tabId) ? message.tabId : null;
    const startedAt = Number.isSafeInteger(message.startedAt) ? message.startedAt : Date.now();
    if (typeof chrome.runtime.id === "string" && sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: "not-eligible" });
      return;
    }
    if (backgroundCheck || backgroundCheckStarting) {
      sendResponse({ ok: false, reason: "collector-already-running" });
      return;
    }
    if (!requestedId || requestedId !== activeConversationId() || !Number.isInteger(tabId) || !Array.isArray(message.baselineIds)) {
      sendResponse({ ok: false, reason: "not-eligible" });
      return;
    }
    backgroundCheckStarting = true;
    void (async () => {
      await updateQueue;
      let eligible = recentCapturePages.filter((page) => page.conversationId === requestedId && page.observedAt >= startedAt && !page.consumed);
      if (eligible.length === 0) {
        await requestLatestCapture(requestedId, startedAt);
        await updateQueue;
        eligible = recentCapturePages.filter((page) => page.conversationId === requestedId && page.observedAt >= startedAt && !page.consumed);
      }
      const state = chats[requestedId];
      if (!state || state.monitored !== true || state.historyComplete !== true || state.hasPreviousPage !== false ||
        requestedId !== activeConversationId() || message.baselineIds.length === 0 || message.baselineIds.some((id) => typeof id !== "string") ||
        backgroundCheck) {
        sendResponse({ ok: false, reason: "not-eligible" });
        return;
      }
      // One latest relevant page is enough to establish initial overlap. Older
      // duplicates from the same load are not counted as separate pages.
      const recent = eligible.length ? [eligible[eligible.length - 1]] : [];
      for (const page of recent) page.consumed = true;
      const baselineIds = new Set(message.baselineIds);
      const check = {
        conversationId: requestedId,
        tabId,
        status: "waiting",
        startedAt,
        baselineIds,
        baselineState: message.baselineState && typeof message.baselineState === "object" ? message.baselineState : { estimatedTextTokens: 0, historyComplete: true, hasPreviousPage: false },
        baselineMessageCount: message.baselineIds.length,
        pagesObserved: recent.length,
        initialPages: recent.length,
        pagesLoaded: recent.length,
        newMessages: Math.max(0, state.messagesCollected - message.baselineIds.length),
        overlapFound: recent.some((page) => historyCollector.containsBaselineOverlap(page.ids, baselineIds)),
      };
      backgroundCheck = check;
      sendResponse({ ok: true, started: true });
      if (recent.length) void sendBackgroundMessage({
        type: "gpt-limits:background-check-capture-observed",
        tabId: check.tabId,
        newMessages: check.newMessages,
        pagesLoaded: check.pagesLoaded,
      }).catch(() => {});
      if (check.overlapFound) {
        void reportBackgroundCheck("complete");
        return;
      }
      if (recent.length) {
        check.status = "collecting";
        void runBackgroundCatchUp(check);
      } else {
        setTimeout(() => {
          if (backgroundCheck === check && check.status === "waiting") void reportBackgroundCheck("failed", "initial-capture-unavailable");
        }, 30000);
      }
    })().catch(() => sendResponse({ ok: false, reason: "collector-start-exception" })).finally(() => { backgroundCheckStarting = false; });
  }

  const stateReady = chrome.storage.local
    .get([chatsKey, legacyStorageKey, notificationsPreferenceKey])
    .then(async (stored) => {
      desktopNotificationsEnabled = stored[notificationsPreferenceKey] === true;
      const savedChats = stored[chatsKey];
      if (savedChats && typeof savedChats === "object" && !Array.isArray(savedChats)) {
        for (const [id, state] of Object.entries(savedChats)) {
          const normalized = normalizeStoredChat(id, state);
          if (normalized) chats[id] = normalized;
        }
      }

      const legacy = stored[legacyStorageKey];
      if (legacy && typeof legacy === "object" && typeof legacy.conversationId === "string" && !chats[legacy.conversationId]) {
        const normalized = normalizeStoredChat(legacy.conversationId, legacy);
        if (normalized) chats[legacy.conversationId] = normalized;
      }

      // One-time migration from the former single-chat key; also remove stale
      // research diagnostics left by earlier extension versions.
      await persistChats();
      await chrome.storage.local.remove([
        legacyStorageKey,
        "gptLimitsLastCaptureDiagnostic",
        "gptLimitsLastCandidatePath",
        "gptLimitsHookTiming",
        "gptLimitsObservedNetworkResources",
      ]);
    })
    .catch(() => undefined);
  let updateQueue = stateReady;

  chrome.storage.onChanged?.addListener((changes, areaName) => {
    if (areaName === "local" && changes[notificationsPreferenceKey]) {
      desktopNotificationsEnabled = changes[notificationsPreferenceKey].newValue === true;
    }
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== marker) return;

    if (data.summary && typeof data.summary.conversationId === "string" && Array.isArray(data.summary.items)) {
      const sequence = Number.isSafeInteger(data.captureSequence) ? data.captureSequence : ++fallbackCaptureSequence;
      const pendingResolve = typeof data.replayRequestId === "string" ? pendingReplayRequests.get(data.replayRequestId) : null;
      if (seenCaptureSequences.has(sequence)) {
        pendingResolve?.();
        return;
      }
      seenCaptureSequences.add(sequence);
      if (seenCaptureSequences.size > 40) seenCaptureSequences.delete(seenCaptureSequences.values().next().value);
      const observedAt = Number.isSafeInteger(data.summary.capturedAt) ? data.summary.capturedAt : Date.now();
      recentCapturePages.push(compactCapturedPage(data.summary, sequence, observedAt));
      if (recentCapturePages.length > 20) recentCapturePages.shift();
      pendingResolve?.();
    }

    updateQueue = updateQueue
      .then(async () => {
        await backgroundTabReady;
        if (data.diagnostic && typeof data.diagnostic === "object") {
          captureStatus = data.diagnostic.error ? "Error" : "Capturing";
        }
        if (data.summary) {
          const conversationId = data.summary.conversationId;
          if (typeof conversationId !== "string" || !conversationId) return;
          const previousState = chats[conversationId] || null;
          const wasNewChat = previousState === null;
          const previousNotificationLevel = previousState?.riskNotificationLevel || 0;
          if (data.summary.isPaginationResponse === true) {
            historyPagesObserved[conversationId] = (historyPagesObserved[conversationId] || 0) + 1;
          }
          const monitored = chats[conversationId]?.monitored === true;
          const calibrationSourceKey = validSourceKey(chats[conversationId]?.calibrationSourceKey)
            ? chats[conversationId].calibrationSourceKey
            : createCalibrationSourceKey();
          const calibrationSnapshots = sanitizeSnapshots(chats[conversationId]?.calibrationSnapshots);
          const calibrationLabel = calibrationLabels.includes(chats[conversationId]?.calibrationLabel) ? chats[conversationId].calibrationLabel : null;
          const calibrationPoints = sanitizeCalibrationPoints(chats[conversationId]?.calibrationPoints, calibrationSourceKey);
          chats[conversationId] = aggregator.mergePage(chats[conversationId] || null, data.summary);
          chats[conversationId].riskNotificationLevel = previousNotificationLevel;
          chats[conversationId].calibrationSourceKey = calibrationSourceKey;
          chats[conversationId].monitored = monitored;
          chats[conversationId].calibrationSnapshots = calibrationSnapshots;
          chats[conversationId].calibrationLabel = calibrationLabel;
          chats[conversationId].calibrationPoints = calibrationPoints;
          maybeAddSnapshot(chats[conversationId], chats[conversationId].updatedAt || Date.now());
          captureStatus = "Capturing";
          recordBackgroundPage(data.summary, previousState, chats[conversationId]);
          await notifyOnRiskCrossing(previousState, chats[conversationId], wasNewChat);
          await persistChats();
        }
      })
      .catch(() => undefined);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "gpt-limits:get-current-state") {
      updateQueue.then(() => {
        const conversationId = activeConversationId();
        sendResponse({
          state: chats[conversationId] || null,
          currentConversationId: conversationId || null,
          captureStatus,
          historyCollection: historyCollection?.conversationId === conversationId
            ? collectionState(chats[historyCollection.conversationId])
            : { status: "idle", reason: null, messagesCollected: chats[conversationId]?.messagesCollected || 0 },
          backgroundCheck: backgroundCheck?.conversationId === conversationId
            ? { status: backgroundCheck.status, newMessages: backgroundCheck.newMessages, pagesLoaded: backgroundCheck.pagesLoaded }
            : null,
          chats: sortedChats().map(stateForStorage),
        });
      });
      return true;
    }

    if (message?.type === "gpt-limits:reset-current-chat") {
      const requestedId = typeof message.conversationId === "string" ? message.conversationId : "";
      if (!requestedId || requestedId !== activeConversationId() || !chats[requestedId]) {
        sendResponse({ ok: false });
        return false;
      }
      cancelCollection("reset");
      const cancelBackgroundCheck = sendBackgroundMessage({ type: "gpt-limits:cancel-background-check-chat", conversationId: requestedId, reason: "reset" }).catch(() => null);
      updateQueue = updateQueue
        .then(async () => {
          await cancelBackgroundCheck;
          const previous = chats[requestedId];
          historyPagesObserved[requestedId] = 0;
          const title = typeof previous.title === "string" && previous.title.trim() ? previous.title : "";
          chats[requestedId] = aggregator.emptyState(requestedId, title);
          chats[requestedId].riskNotificationLevel = 0;
          chats[requestedId].monitored = previous.monitored === true;
          chats[requestedId].calibrationSourceKey = previous.calibrationSourceKey;
          chats[requestedId].calibrationSnapshots = [];
          chats[requestedId].calibrationLabel = calibrationLabels.includes(previous.calibrationLabel) ? previous.calibrationLabel : null;
          chats[requestedId].calibrationPoints = sanitizeCalibrationPoints(previous.calibrationPoints, previous.calibrationSourceKey);
          captureStatus = "Waiting";
          await persistChats();
          sendResponse({ ok: true, chats: sortedChats().map(stateForStorage), historyCollection: collectionState(chats[requestedId]) });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (message?.type === "gpt-limits:collect-full-history") {
      const requestedId = typeof message.conversationId === "string" ? message.conversationId : "";
      if (!requestedId || requestedId !== activeConversationId()) {
        sendResponse({ ok: false, reason: "not-current-chat" });
        return false;
      }
      updateQueue = updateQueue.then(() => {
        if (requestedId !== activeConversationId()) {
          sendResponse({ ok: false, reason: "not-current-chat" });
          return;
        }
        const state = chats[requestedId];
        if (!state || (state.historyComplete === true && state.hasPreviousPage === false)) {
          sendResponse({ ok: false, reason: state ? "complete" : "not-collected" });
          return;
        }
        if (state.hasPreviousPage !== true) {
          sendResponse({ ok: false, reason: "history-unknown" });
          return;
        }
        if (historyCollection?.status === "collecting") {
          sendResponse({ ok: false, reason: "already-collecting" });
          return;
        }
        const generation = ++collectionGeneration;
        historyCollection = { conversationId: requestedId, status: "collecting", reason: null, cycles: 0, messagesCollected: state.messagesCollected };
        sendResponse({ ok: true, historyCollection: collectionState(state) });
        void runHistoryCollection(requestedId, generation);
      }).catch(() => sendResponse({ ok: false, reason: "error" }));
      return true;
    }

    if (message?.type === "gpt-limits:stop-history-collection") {
      const requestedId = typeof message.conversationId === "string" ? message.conversationId : "";
      if (!historyCollection || historyCollection.status !== "collecting" || requestedId !== historyCollection.conversationId) {
        sendResponse({ ok: false });
        return false;
      }
      cancelCollection("user");
      sendResponse({ ok: true, historyCollection: collectionState(chats[requestedId]) });
      return false;
    }

    if (message?.type === "gpt-limits:background-check-start") {
      startBackgroundCheck(message, _sender, sendResponse);
      return true;
    }

    if (message?.type === "gpt-limits:set-monitored") {
      const requestedId = typeof message.conversationId === "string" ? message.conversationId : "";
      if (!requestedId || typeof message.monitored !== "boolean" || !chats[requestedId]) {
        sendResponse({ ok: false });
        return false;
      }
      updateQueue = updateQueue
        .then(async () => {
          chats[requestedId].monitored = message.monitored;
          await persistChats();
          sendResponse({ ok: true, chats: sortedChats().map(stateForStorage) });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (message?.type === "gpt-limits:set-calibration-label") {
      const requestedId = typeof message.conversationId === "string" ? message.conversationId : "";
      const label = message.label === null ? null : message.label;
      if (!requestedId || !chats[requestedId] || chats[requestedId].monitored !== true || (label !== null && !calibrationLabels.includes(label))) {
        sendResponse({ ok: false });
        return false;
      }
      updateQueue = updateQueue
        .then(async () => {
          const state = chats[requestedId];
          state.calibrationLabel = label;
          if (label !== null) {
            const point = calibrationPoint(state, label, Date.now());
            const previous = state.calibrationPoints.at(-1);
            if (!sameCalibrationSample(previous, point)) {
              state.calibrationPoints.push(point);
              if (state.calibrationPoints.length > 20) state.calibrationPoints.splice(0, state.calibrationPoints.length - 20);
            }
          }
          await persistChats();
          sendResponse({ ok: true, chats: sortedChats().map(stateForStorage) });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (message?.type === "gpt-limits:delete-calibration-point") {
      const requestedId = typeof message.conversationId === "string" ? message.conversationId : "";
      const pointIndex = message.pointIndex;
      if (!requestedId || !chats[requestedId] || !Number.isSafeInteger(pointIndex) || pointIndex < 0 || pointIndex >= chats[requestedId].calibrationPoints.length) {
        sendResponse({ ok: false });
        return false;
      }
      updateQueue = updateQueue
        .then(async () => {
          chats[requestedId].calibrationPoints.splice(pointIndex, 1);
          await persistChats();
          sendResponse({ ok: true, chats: sortedChats().map(stateForStorage) });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (message?.type === "gpt-limits:remove-chat") {
      const requestedId = typeof message.conversationId === "string" ? message.conversationId : "";
      if (!requestedId) {
        sendResponse({ ok: false });
        return false;
      }
      updateQueue = updateQueue
        .then(async () => {
          await sendBackgroundMessage({ type: "gpt-limits:cancel-background-check-chat", conversationId: requestedId, reason: "removed" }).catch(() => null);
          delete chats[requestedId];
          if (requestedId === activeConversationId()) captureStatus = "Waiting";
          await persistChats();
          sendResponse({ ok: true, chats: sortedChats().map(stateForStorage) });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    return false;
  });

  // Install the receiver first. If ChatGPT is between routes, keep the ready
  // handshake alive until a conversation route appears; same-ID SPA changes
  // remain valid, while a different ID ends only this temporary check.
  void backgroundTabReady.then(() => {
    if (!isBackgroundCheckTab) return null;
    startBackgroundRouteMonitor();
    return null;
  }).catch(() => {});
})();

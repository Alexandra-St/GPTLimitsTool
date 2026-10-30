(() => {
  "use strict";

  function findScrollableContainers(document, window, preferredElement = null) {
    const roots = [...document.querySelectorAll("main, [role='main']")];
    const searchRoots = roots.length ? roots : [document.body].filter(Boolean);
    const candidates = new Set();
    for (const root of searchRoots) {
      candidates.add(root);
      for (const element of root.querySelectorAll("*")) candidates.add(element);
    }
    const scrollingElement = document.scrollingElement;
    if (scrollingElement) candidates.add(scrollingElement);

    const valid = (element) => {
      if (!element || element.isConnected === false) return false;
      const height = element.clientHeight || 0;
      const width = element.clientWidth || 0;
      const range = (element.scrollHeight || 0) - height;
      if (range < 120 || height < 250 || width < 300) return false;
      if (element !== scrollingElement && !searchRoots.some((root) => root === element || root.contains?.(element))) return false;
      const style = window.getComputedStyle(element);
      return element === scrollingElement || ["auto", "scroll"].includes(style.overflowY);
    };

    const scrollable = [...candidates].filter(valid).map((element) => ({ element, range: element.scrollHeight - element.clientHeight }));
    scrollable.sort((left, right) => right.range - left.range);
    const preferred = scrollable.find((entry) => entry.element === preferredElement);
    if (preferred) {
      scrollable.splice(scrollable.indexOf(preferred), 1);
      scrollable.unshift(preferred);
    }
    return scrollable.map((entry) => entry.element);
  }

  function findScrollableContainer(document, window, preferredElement = null) {
    return findScrollableContainers(document, window, preferredElement)[0] || null;
  }

  function isComplete(state) {
    return state?.historyComplete === true && state.hasPreviousPage === false;
  }

  function containsBaselineOverlap(pageIds, baselineIds) {
    const baseline = baselineIds instanceof Set ? baselineIds : new Set(baselineIds || []);
    return Array.isArray(pageIds) && pageIds.some((id) => typeof id === "string" && baseline.has(id));
  }

  function numericSignals(state, extraSignals, container) {
    const range = container ? Math.max(0, (container.scrollHeight || 0) - (container.clientHeight || 0)) : 0;
    return {
      messagesCollected: state?.messagesCollected ?? 0,
      updatedAt: state?.updatedAt ?? null,
      historyPagesObserved: extraSignals?.historyPagesObserved ?? 0,
      domMutationVersion: extraSignals?.domMutationVersion ?? 0,
      scrollHeight: container?.scrollHeight ?? 0,
      scrollRange: range,
      scrollTop: container?.scrollTop ?? 0,
    };
  }

  function hasHistoryProgress(before, after) {
    return after.messagesCollected > before.messagesCollected ||
      after.updatedAt !== before.updatedAt ||
      after.historyPagesObserved > before.historyPagesObserved ||
      after.scrollHeight > before.scrollHeight ||
      after.scrollRange > before.scrollRange ||
      (after.scrollHeight > before.scrollHeight && after.scrollTop !== before.scrollTop);
  }

  async function waitForScrollableContainers(options) {
    const {
      findContainers,
      hasConversationDom = () => false,
      wait,
      isCancelled = () => false,
      timeoutMs = 5000,
      pollIntervalMs = 100,
      getConversationId,
      expectedConversationId,
    } = options;
    let elapsed = 0;
    let conversationDomSeen = false;
    while (true) {
      if (isCancelled() || (getConversationId && getConversationId() !== expectedConversationId)) {
        return { status: "stopped", reason: "navigation", containers: [] };
      }
      const containers = findContainers();
      if (containers.length) return { status: "ready", reason: null, containers };
      conversationDomSeen = conversationDomSeen || Boolean(hasConversationDom());
      if (elapsed >= timeoutMs) {
        return {
          status: "failed",
          reason: conversationDomSeen ? "scroll-container-not-found" : "conversation-dom-not-ready",
          containers: [],
        };
      }
      const pause = Math.min(pollIntervalMs, timeoutMs - elapsed);
      await wait(pause);
      elapsed += pause;
    }
  }

  async function collect(options) {
    const {
      expectedConversationId,
      getConversationId,
      getState,
      findContainers,
      scrollToTop,
      getExtraSignals = () => ({}),
      wait,
      isCancelled,
      onProgress,
      pollIntervalMs = 400,
      attemptWaitMs = 12000,
      mutationQuietMs = 1200,
      maxAttemptWaitMs = 18000,
      maxCycles = 1000,
      maxStalledAttempts = 3,
    } = options;
    let state = await getState();
    let stalledAttempts = 0;
    let cycles = 0;

    while (cycles < maxCycles) {
      if (isCancelled() || getConversationId() !== expectedConversationId) return { status: "stopped", reason: "navigation", state };
      if (isComplete(state)) return { status: "complete", state };

      let containers = findContainers();
      if (!containers.length) {
        cycles += 1;
        let elapsed = 0;
        while (elapsed < attemptWaitMs) {
          if (isCancelled() || getConversationId() !== expectedConversationId) return { status: "stopped", reason: "navigation", state };
          const pause = Math.min(pollIntervalMs, attemptWaitMs - elapsed);
          await wait(pause);
          elapsed += pause;
          if (isCancelled() || getConversationId() !== expectedConversationId) return { status: "stopped", reason: "navigation", state };
          state = await getState();
          if (isComplete(state)) return { status: "complete", state };
          containers = findContainers();
          if (containers.length) break;
        }
        if (containers.length) {
          stalledAttempts = 0;
          continue;
        }
        stalledAttempts += 1;
        if (stalledAttempts >= maxStalledAttempts) return { status: "paused", reason: "no-container", state };
        continue;
      }
      let chosen = null;
      let scrollResult = null;
      let startSignals = null;
      let topCandidate = null;
      for (const candidate of containers) {
        const candidateSignals = numericSignals(state, getExtraSignals(), candidate);
        const result = scrollToTop(candidate);
        if (result?.moved) {
          chosen = candidate;
          scrollResult = result;
          startSignals = candidateSignals;
          break;
        }
        if (result?.alreadyAtTop && !topCandidate) topCandidate = { candidate, result, signals: candidateSignals };
      }
      if (!chosen) {
        containers = findContainers();
        chosen = containers.find((container) => container.scrollTop > 0) || topCandidate?.candidate || containers[0];
        if (!chosen) return { status: "paused", reason: "no-container", state };
        if (topCandidate?.candidate === chosen) {
          startSignals = topCandidate.signals;
          scrollResult = topCandidate.result;
        } else {
          startSignals = numericSignals(state, getExtraSignals(), chosen);
          scrollResult = scrollToTop(chosen);
        }
      }

      cycles += 1;
      let elapsed = 0;
      let lastMutationAt = -Infinity;
      let progressed = false;
      let currentContainer = chosen;

      while (elapsed < maxAttemptWaitMs) {
        if (isCancelled() || getConversationId() !== expectedConversationId) return { status: "stopped", reason: "navigation", state };
        const pause = Math.min(pollIntervalMs, maxAttemptWaitMs - elapsed);
        await wait(pause);
        elapsed += pause;
        if (isCancelled() || getConversationId() !== expectedConversationId) return { status: "stopped", reason: "navigation", state };

        // Re-resolve on every poll so pagination-driven DOM replacement cannot
        // leave the collector driving a detached or obsolete scroll element.
        const replacements = findContainers();
        if (replacements.length) currentContainer = replacements[0];
        state = await getState();
        const signals = numericSignals(state, getExtraSignals(), currentContainer);
        if (signals.domMutationVersion !== startSignals.domMutationVersion) lastMutationAt = elapsed;
        onProgress(state, cycles, { ...signals, consecutiveStalls: stalledAttempts, scrollMoved: scrollResult?.moved === true });
        if (isComplete(state)) return { status: "complete", state };
        if (hasHistoryProgress(startSignals, signals)) {
          progressed = true;
          break;
        }
        if (elapsed >= attemptWaitMs && elapsed - lastMutationAt >= mutationQuietMs) break;
      }

      if (progressed) {
        stalledAttempts = 0;
        continue;
      }
      stalledAttempts += 1;
      onProgress(state, cycles, {
        ...numericSignals(state, getExtraSignals(), currentContainer),
        consecutiveStalls: stalledAttempts,
        scrollMoved: scrollResult?.moved === true,
      });
      if (stalledAttempts >= maxStalledAttempts) return { status: "paused", reason: "no-progress", state };
    }
    return { status: "paused", reason: "safety-limit", state };
  }

  async function collectUntilOverlap(options) {
    const {
      expectedConversationId,
      getConversationId,
      getState,
      findContainers,
      scrollToTop,
      getPageSignals,
      wait,
      isCancelled = () => false,
      onProgress = () => {},
      onHeartbeat = () => {},
      pollIntervalMs = 350,
      pageWaitMs = 15000,
      maxPages = 30,
      maxStalledPages = 2,
    } = options;
    let state = await getState();
    let pagesLoaded = 0;
    let stalled = 0;
    while (pagesLoaded < maxPages) {
      if (isCancelled() || getConversationId() !== expectedConversationId) return { status: "failed", reason: "navigation", state, pagesLoaded };
      const containers = findContainers();
      if (!containers.length) return { status: "failed", reason: "no-container", state, pagesLoaded };
      const container = containers.find((candidate) => (Number(candidate.scrollTop) || 0) > 0) || containers[0];
      scrollToTop(container);
      const start = getPageSignals();
      let elapsed = 0;
      let receivedPage = false;
      while (elapsed < pageWaitMs) {
        if (isCancelled() || getConversationId() !== expectedConversationId) return { status: "failed", reason: "navigation", state, pagesLoaded };
        const pause = Math.min(pollIntervalMs, pageWaitMs - elapsed);
        await wait(pause);
        elapsed += pause;
        onHeartbeat();
        state = await getState();
        const signals = getPageSignals();
        if (signals.overlapFound) {
          pagesLoaded += Math.max(0, signals.pagesObserved - start.pagesObserved);
          return { status: "complete", reason: null, state, pagesLoaded, overlapFound: true };
        }
        if (signals.pagesObserved > start.pagesObserved) {
          pagesLoaded += signals.pagesObserved - start.pagesObserved;
          receivedPage = true;
          onProgress({ state, pagesLoaded, overlapFound: false });
          break;
        }
      }
      if (receivedPage) {
        stalled = 0;
        continue;
      }
      stalled += 1;
      if (stalled >= maxStalledPages) return { status: "failed", reason: "no-overlap", state, pagesLoaded };
    }
    return { status: "failed", reason: "no-overlap", state, pagesLoaded };
  }

  globalThis.GptHistoryCollector = { findScrollableContainer, findScrollableContainers, waitForScrollableContainers, isComplete, containsBaselineOverlap, collect, collectUntilOverlap };
})();

if (typeof module !== "undefined" && module.exports) module.exports = globalThis.GptHistoryCollector;

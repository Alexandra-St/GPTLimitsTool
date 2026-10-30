"use strict";

importScripts("risk-notifications.js");

const notificationPreferenceKey = "gptLimitsDesktopRiskNotifications";
const permittedRiskLevels = new Set(["Watch", "Near limit", "Critical"]);
const backgroundMonitoringKey = "gptLimitsBackgroundMonitoring";
const backgroundCheckStatusKey = "gptLimitsBackgroundCheckStatus";
const automaticCheckIntervalKey = "gptLimitsAutomaticCheckInterval";
const automaticSchedulerStatusKey = "gptLimitsAutomaticSchedulerStatus";
const activeCheckSessionKey = "gptLimitsActiveCheckSession";
const checkDeadlineAlarm = "gptLimitsBackgroundCheckDeadline";
const automaticCheckAlarm = "gptLimitsMonitoredChatScheduler";
const automaticIntervals = new Map([["30", 30], ["60", 60], ["180", 180]]);
const checkTimeoutMs = 180000;
const readyTimeoutMs = 20000;
const startTimeoutMs = 15000;
const captureTimeoutMs = 30000;
const failureReasons = new Set(["not-eligible", "collect-full-history-first", "already-open", "already-running", "no-capture", "initial-capture-unavailable", "no-container", "scroll-container-not-found", "conversation-dom-not-ready", "collector-already-running", "collector-start-exception", "no-overlap", "navigation", "reset", "removed", "user-closed", "load-timeout", "timeout", "tab-error", "interrupted", "cleanup-error", "alarm-permission", "content-not-ready", "start-failed"]);
const backgroundPhases = new Set(["creating-tab", "loading-tab", "waiting-for-content", "starting-collector", "waiting-for-capture", "catching-up", "finalizing"]);
let activeBackgroundCheck = null;
let checkStartPromise = null;
let alarmListenerRegistered = false;
let automaticCheckRunning = false;
let schedulerRestorePromise = null;

function hasAlarmsApi() {
  return Boolean(chrome.alarms && chrome.alarms.onAlarm && typeof chrome.alarms.onAlarm.addListener === "function" &&
    typeof chrome.alarms.create === "function" && typeof chrome.alarms.clear === "function");
}

async function hasAlarmsPermission() {
  if (!hasAlarmsApi() || !chrome.permissions || typeof chrome.permissions.contains !== "function") return false;
  try { return await chrome.permissions.contains({ permissions: ["alarms"] }); } catch { return false; }
}

async function scheduleCheckAlarm(when) {
  if (!(await hasAlarmsPermission())) return false;
  try { await chrome.alarms.create(checkDeadlineAlarm, { when }); return true; } catch { return false; }
}

async function clearCheckAlarm() {
  if (!(await hasAlarmsPermission())) return;
  try { await chrome.alarms.clear(checkDeadlineAlarm); } catch {}
}

async function clearAutomaticCheckAlarm() {
  if (!hasAlarmsApi()) return;
  try { await chrome.alarms.clear(automaticCheckAlarm); } catch {}
}

async function readAutomaticCheckAlarm() {
  if (!hasAlarmsApi() || typeof chrome.alarms.get !== "function") return null;
  try { return await chrome.alarms.get(automaticCheckAlarm) || null; } catch { return null; }
}

async function saveAutomaticSchedulerStatus(patch) {
  try {
    const stored = await chrome.storage.local.get(automaticSchedulerStatusKey);
    const current = stored[automaticSchedulerStatusKey] && typeof stored[automaticSchedulerStatusKey] === "object" ? stored[automaticSchedulerStatusKey] : {};
    const safe = {
      enabled: patch.enabled === undefined ? current.enabled === true : patch.enabled === true,
      interval: ["30", "60", "180"].includes(String(patch.interval ?? current.interval)) ? String(patch.interval ?? current.interval) : "off",
      alarmExists: patch.alarmExists === undefined ? current.alarmExists === true : patch.alarmExists === true,
      nextScheduledTime: Number.isFinite(patch.nextScheduledTime) && patch.nextScheduledTime >= 0 ? patch.nextScheduledTime : patch.nextScheduledTime === null ? null : Number.isFinite(current.nextScheduledTime) && current.nextScheduledTime >= 0 ? current.nextScheduledTime : null,
      lastTickAt: Number.isFinite(patch.lastTickAt) && patch.lastTickAt >= 0 ? patch.lastTickAt : Number.isFinite(current.lastTickAt) && current.lastTickAt >= 0 ? current.lastTickAt : null,
      lastTickResult: ["Started", "Running", "Skipped", "Failed", "Complete"].includes(patch.lastTickResult) ? patch.lastTickResult : ["Started", "Running", "Skipped", "Failed", "Complete"].includes(current.lastTickResult) ? current.lastTickResult : null,
      lastReason: typeof patch.lastReason === "string" && patch.lastReason.length <= 80 ? patch.lastReason : patch.lastReason === null ? null : typeof current.lastReason === "string" && current.lastReason.length <= 80 ? current.lastReason : null,
    };
    await chrome.storage.local.set({ [automaticSchedulerStatusKey]: safe });
    return safe;
  } catch { return null; }
}

async function configureAutomaticCheckSchedule(interval) {
  if (schedulerRestorePromise) await schedulerRestorePromise;
  await clearAutomaticCheckAlarm();
  if (interval === "off") {
    await saveAutomaticSchedulerStatus({ enabled: false, interval: "off", alarmExists: false, nextScheduledTime: null, lastReason: null });
    return { ok: true, interval: "off" };
  }
  const periodInMinutes = automaticIntervals.get(String(interval));
  if (!periodInMinutes) return { ok: false, reason: "invalid-interval" };
  if (!(await hasAlarmsPermission()) || !registerAlarmListenerIfAvailable()) {
    await saveAutomaticSchedulerStatus({ enabled: false, interval: String(interval), alarmExists: false, nextScheduledTime: null, lastReason: "alarm-permission-missing" });
    return { ok: false, reason: "alarm-permission" };
  }
  try {
    // Start the cadence after the chosen interval; enabling/restarting never triggers an immediate burst.
    await chrome.alarms.create(automaticCheckAlarm, { delayInMinutes: periodInMinutes, periodInMinutes });
    const alarm = await readAutomaticCheckAlarm();
    if (!alarm || alarm.periodInMinutes !== periodInMinutes || !Number.isFinite(alarm.scheduledTime)) {
      await saveAutomaticSchedulerStatus({ enabled: false, interval: String(interval), alarmExists: false, nextScheduledTime: null, lastReason: "scheduler-alarm-missing" });
      return { ok: false, reason: "scheduler-alarm-missing" };
    }
    await saveAutomaticSchedulerStatus({ enabled: true, interval: String(interval), alarmExists: true, nextScheduledTime: alarm.scheduledTime, lastReason: null });
    return { ok: true, interval: String(interval) };
  } catch {
    await saveAutomaticSchedulerStatus({ enabled: false, interval: String(interval), alarmExists: false, nextScheduledTime: null, lastReason: "scheduler-alarm-missing" });
    return { ok: false, reason: "scheduler-alarm-missing" };
  }
}

async function restoreAutomaticCheckSchedule() {
  if (schedulerRestorePromise) return schedulerRestorePromise;
  schedulerRestorePromise = (async () => {
    let settings = {};
    try {
      settings = await chrome.storage.local.get([automaticCheckIntervalKey, backgroundMonitoringKey, notificationPreferenceKey]);
      const defaults = {};
      if (typeof settings[backgroundMonitoringKey] !== "boolean") defaults[backgroundMonitoringKey] = false;
      if (typeof settings[notificationPreferenceKey] !== "boolean") defaults[notificationPreferenceKey] = false;
      if (!automaticIntervals.has(String(settings[automaticCheckIntervalKey])) && settings[automaticCheckIntervalKey] !== "off") defaults[automaticCheckIntervalKey] = "off";
      if (Object.keys(defaults).length) {
        await chrome.storage.local.set(defaults);
        settings = { ...settings, ...defaults };
      }
    } catch { return; }
    const interval = String(settings[automaticCheckIntervalKey] || "off");
    if (interval === "off") {
      await clearAutomaticCheckAlarm();
      await saveAutomaticSchedulerStatus({ enabled: false, interval: "off", alarmExists: false, nextScheduledTime: null });
      return;
    }
    const periodInMinutes = automaticIntervals.get(interval);
    if (!periodInMinutes) {
      await saveAutomaticSchedulerStatus({ enabled: false, interval: "off", alarmExists: false, nextScheduledTime: null, lastReason: "scheduler-disabled" });
      return;
    }
    if (!(await hasAlarmsPermission()) || !registerAlarmListenerIfAvailable()) {
      await saveAutomaticSchedulerStatus({ enabled: false, interval, alarmExists: false, nextScheduledTime: null, lastReason: "alarm-permission-missing" });
      return;
    }
    let alarm = await readAutomaticCheckAlarm();
    if (!alarm || alarm.periodInMinutes !== periodInMinutes || !Number.isFinite(alarm.scheduledTime)) {
      try {
        await chrome.alarms.clear(automaticCheckAlarm);
        await chrome.alarms.create(automaticCheckAlarm, { delayInMinutes: periodInMinutes, periodInMinutes });
      } catch {}
      alarm = await readAutomaticCheckAlarm();
    }
    const exists = Boolean(alarm && alarm.periodInMinutes === periodInMinutes && Number.isFinite(alarm.scheduledTime));
    await saveAutomaticSchedulerStatus({ enabled: exists, interval, alarmExists: exists, nextScheduledTime: exists ? alarm.scheduledTime : null, lastReason: exists ? null : "scheduler-alarm-missing" });
  })().finally(() => { schedulerRestorePromise = null; });
  return schedulerRestorePromise;
}

async function updateAutomaticChatResult(sourceKey, result) {
  if (typeof sourceKey !== "string" || !sourceKey) return;
  try {
    const stored = await chrome.storage.local.get("gptLimitsChats");
    const chats = stored.gptLimitsChats && typeof stored.gptLimitsChats === "object" ? stored.gptLimitsChats : {};
    const entry = Object.entries(chats).find(([, chat]) => chat?.calibrationSourceKey === sourceKey);
    if (!entry) return;
    const [id, chat] = entry;
    const checkedAt = Math.max(Date.now(), Number.isFinite(chat.lastAutomaticCheckAt) ? chat.lastAutomaticCheckAt + 1 : 0);
    chats[id] = { ...chat, lastAutomaticCheckAt: checkedAt, lastAutomaticCheckResult: result };
    await chrome.storage.local.set({ gptLimitsChats: chats });
  } catch {}
}

function storedCheckState(check) {
  return {
    temporaryTabId: check.temporaryTabId,
    phase: check.phase,
    startedAt: check.startedAt,
    deadlineAt: check.deadlineAt,
    phaseDeadlineAt: check.phaseDeadlineAt,
    started: check.started === true,
    baselineIds: Array.isArray(check.baselineIds) ? [...check.baselineIds] : [],
    baselineState: {
      estimatedTextTokens: Number.isSafeInteger(check.baselineState?.estimatedTextTokens) ? check.baselineState.estimatedTextTokens : 0,
      historyComplete: check.baselineState?.historyComplete === true,
      hasPreviousPage: check.baselineState?.hasPreviousPage === false ? false : null,
    },
    finalStatus: check.finalStatus || null,
    finalReason: failureReasons.has(check.finalReason) ? check.finalReason : null,
    finalDetails: {
      newMessages: Number.isSafeInteger(check.finalDetails?.newMessages) ? check.finalDetails.newMessages : 0,
      pagesLoaded: Number.isSafeInteger(check.finalDetails?.pagesLoaded) ? check.finalDetails.pagesLoaded : 0,
      overlapFound: check.finalDetails?.overlapFound === true,
    },
    closeTab: check.closeTab !== false,
    cleanupAttempts: Number.isSafeInteger(check.cleanupAttempts) ? check.cleanupAttempts : 0,
    automatic: check.automatic === true,
    automaticSourceKey: typeof check.automaticSourceKey === "string" ? check.automaticSourceKey : null,
  };
}

async function restoreActiveCheck() {
  if (activeBackgroundCheck) return activeBackgroundCheck;
  try {
    const stored = await chrome.storage.session.get(activeCheckSessionKey);
    const check = stored[activeCheckSessionKey];
    if (check && Number.isInteger(check.temporaryTabId)) {
      let conversationId = "";
      try {
        const tab = await chrome.tabs.get(check.temporaryTabId);
        conversationId = extractConversationIdFromUrl(tab.url);
      } catch {}
      activeBackgroundCheck = {
        ...check,
        conversationId,
        baselineIds: Array.isArray(check.baselineIds) ? check.baselineIds : [],
        baselineState: check.baselineState && typeof check.baselineState === "object" ? check.baselineState : { estimatedTextTokens: 0, historyComplete: false, hasPreviousPage: null },
        retries: check.retries || 0,
      };
    }
  } catch {}
  return activeBackgroundCheck;
}

async function markInterruptedCheck() {
  try {
    const [session, local] = await Promise.all([
      chrome.storage.session.get(activeCheckSessionKey),
      chrome.storage.local.get(backgroundCheckStatusKey),
    ]);
    const status = local[backgroundCheckStatusKey];
    if (status && !session[activeCheckSessionKey] && (status.status === "running" || Number.isInteger(status.temporaryTabId))) {
      if (Number.isInteger(status.temporaryTabId)) {
        try {
          const tab = await chrome.tabs.get(status.temporaryTabId);
          const isChatConversation = Boolean(extractConversationIdFromUrl(tab.url));
          if (tab.url === "about:blank" || isChatConversation) await chrome.tabs.remove(status.temporaryTabId);
        } catch {}
      }
      if (status.status === "running") await saveBackgroundStatus("failed", { reason: "interrupted" });
      else await saveBackgroundStatus(status.status, { reason: status.reason, pagesLoaded: status.pagesLoaded, overlapFound: status.overlapFound, newMessages: status.newMessages });
    }
  } catch {}
}

async function saveBackgroundStatus(status, details = {}) {
  const reason = failureReasons.has(details.reason) ? details.reason : null;
  const value = {
    status,
    lastCheckAt: Date.now(),
    phase: backgroundPhases.has(details.phase) ? details.phase : null,
    reason,
    newMessages: Number.isSafeInteger(details.newMessages) && details.newMessages >= 0 ? details.newMessages : 0,
    pagesLoaded: Number.isSafeInteger(details.pagesLoaded) && details.pagesLoaded >= 0 ? details.pagesLoaded : 0,
    overlapFound: details.overlapFound === true,
  };
  if (Number.isInteger(details.temporaryTabId)) value.temporaryTabId = details.temporaryTabId;
  await chrome.storage.local.set({ [backgroundCheckStatusKey]: value });
}

function extractConversationIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com") return null;
    const match = url.pathname.match(/(?:^|\/)c\/([^/]+)(?:\/|$)/i);
    return match ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
}

async function updateCheckPhase(check, phase, phaseTimeoutMs = null) {
  if (!check || activeBackgroundCheck !== check || check.phase === "finalizing" || !backgroundPhases.has(phase)) return;
  check.phase = phase;
  check.phaseDeadlineAt = Number.isFinite(phaseTimeoutMs) ? Date.now() + phaseTimeoutMs : null;
  try { await chrome.storage.session.set({ [activeCheckSessionKey]: storedCheckState(check) }); } catch {}
  await saveBackgroundStatus("running", { phase, newMessages: check.newMessages || 0, pagesLoaded: check.pagesLoaded || 0, overlapFound: check.overlapFound === true, temporaryTabId: check.temporaryTabId });
  const alarmAt = check.phaseDeadlineAt === null ? check.deadlineAt : Math.min(check.deadlineAt, check.phaseDeadlineAt);
  await scheduleCheckAlarm(alarmAt);
}

async function finalizeBackgroundCheck(status, reason, details = {}, expectedTemporaryTabId = null, closeTab = true) {
  const check = await restoreActiveCheck();
  if (!check || (expectedTemporaryTabId !== null && check.temporaryTabId !== expectedTemporaryTabId)) return false;
  if (check.finalizePromise) return check.finalizePromise;
  if (check.phase === "finalizing") {
    status = check.finalStatus || status;
    reason = check.finalReason ?? reason;
    details = check.finalDetails || details;
    closeTab = check.closeTab !== false;
  }
  check.phase = "finalizing";
  check.finalStatus = status;
  check.finalReason = reason;
  check.finalDetails = details;
  check.closeTab = closeTab;
  activeBackgroundCheck = check;
  check.finalizePromise = (async () => {
    // Persist the terminal intent first so a worker restart can resume cleanup.
    try { await chrome.storage.session.set({ [activeCheckSessionKey]: storedCheckState(check) }); } catch {}
    try { await saveBackgroundStatus(status, { ...details, reason, temporaryTabId: check.temporaryTabId }); } catch {}
    let tabClosed = !closeTab;
    if (closeTab && Number.isInteger(check.temporaryTabId)) {
      try {
        await chrome.tabs.remove(check.temporaryTabId);
        tabClosed = true;
      } catch {
        // A manual close may race this cleanup. Verify and retry only the exact
        // owned ID; a missing tab is already clean, with no URL-based lookup.
        try {
          await chrome.tabs.get(check.temporaryTabId);
          await chrome.tabs.remove(check.temporaryTabId);
          tabClosed = true;
        } catch {
          try { await chrome.tabs.get(check.temporaryTabId); } catch { tabClosed = true; }
        }
      }
    }
    if (!tabClosed) {
      check.cleanupAttempts = (check.cleanupAttempts || 0) + 1;
      check.finalStatus = "failed";
      check.finalReason = "cleanup-error";
      try { await saveBackgroundStatus("failed", { ...details, reason: "cleanup-error" }); } catch {}
      try { await chrome.storage.session.set({ [activeCheckSessionKey]: storedCheckState(check) }); } catch {}
      await scheduleCheckAlarm(Date.now() + Math.min(30000, 1000 * (check.cleanupAttempts + 1)));
      check.finalizePromise = null;
      return false;
    }
    if (check.automatic) await updateAutomaticChatResult(check.automaticSourceKey, status === "complete" ? "complete" : status === "skipped" ? "skipped" : "failed");
    await clearCheckAlarm();
    try { await chrome.storage.session.remove(activeCheckSessionKey); } catch {}
    if (activeBackgroundCheck === check) activeBackgroundCheck = null;
    try { await saveBackgroundStatus(status, { ...details, reason }); } catch {}
    return true;
  })();
  return check.finalizePromise;
}

function onBackgroundCheckAlarm(alarm) {
  if (alarm.name === automaticCheckAlarm) {
    void runAutomaticSchedulerTick("alarm");
    return;
  }
  if (alarm.name !== checkDeadlineAlarm) return;
  void restoreActiveCheck().then((check) => {
    if (!check) return;
    if (check.phase === "finalizing") {
      void finalizeBackgroundCheck(check.finalStatus || "failed", check.finalReason || "timeout", check.finalDetails || {}, check.temporaryTabId);
      return;
    }
    const now = Date.now();
    if (Number.isFinite(check.deadlineAt) && now >= check.deadlineAt) {
      void chrome.storage.local.get(backgroundCheckStatusKey).then((stored) => {
        const progress = stored[backgroundCheckStatusKey] || {};
        return finalizeBackgroundCheck("failed", "timeout", {
          newMessages: Number.isSafeInteger(progress.newMessages) ? progress.newMessages : 0,
          pagesLoaded: Number.isSafeInteger(progress.pagesLoaded) ? progress.pagesLoaded : 0,
          overlapFound: progress.overlapFound === true,
        }, check.temporaryTabId);
      });
      return;
    }
    if (Number.isFinite(check.phaseDeadlineAt) && now >= check.phaseDeadlineAt) {
      const reason = check.phase === "waiting-for-content" ? "content-not-ready"
        : check.phase === "starting-collector" ? "start-failed"
          : check.phase === "waiting-for-capture" ? "initial-capture-unavailable" : "timeout";
      void finalizeBackgroundCheck("failed", reason, {
        newMessages: check.newMessages || 0,
        pagesLoaded: check.pagesLoaded || 0,
        overlapFound: check.overlapFound === true,
      }, check.temporaryTabId);
      return;
    }
    const nextAlarmAt = Number.isFinite(check.phaseDeadlineAt) ? Math.min(check.deadlineAt, check.phaseDeadlineAt) : check.deadlineAt;
    void scheduleCheckAlarm(nextAlarmAt);
  });
}

async function runAutomaticSchedulerTick(trigger = "alarm") {
  const lastTickAt = Date.now();
  await saveAutomaticSchedulerStatus({ lastTickAt, lastTickResult: "Running", lastReason: null });
  const recordTick = async (result, reason = null) => {
    const alarm = await readAutomaticCheckAlarm();
    let interval = "off";
    try { interval = String((await chrome.storage.local.get(automaticCheckIntervalKey))[automaticCheckIntervalKey] || "off"); } catch {}
    const periodInMinutes = automaticIntervals.get(interval);
    const permissionGranted = periodInMinutes ? await hasAlarmsPermission() : false;
    const alarmExists = Boolean(alarm && alarm.periodInMinutes === periodInMinutes && Number.isFinite(alarm.scheduledTime));
    const finalReason = reason || (interval === "off" ? "scheduler-disabled"
      : !permissionGranted ? "alarm-permission-missing"
        : !alarmExists ? "scheduler-alarm-missing" : null);
    await saveAutomaticSchedulerStatus({
      enabled: Boolean(periodInMinutes && permissionGranted && alarmExists), interval, alarmExists,
      nextScheduledTime: alarmExists ? alarm.scheduledTime : null,
      lastTickAt, lastTickResult: result, lastReason: finalReason,
    });
    return { ok: result === "Started", result, reason: finalReason, trigger };
  };
  if (automaticCheckRunning) return await recordTick("Skipped", "background-check-running");
  automaticCheckRunning = true;
  let selectedSourceKey = null;
  try {
    const settings = await chrome.storage.local.get([automaticCheckIntervalKey, "gptLimitsChats"]);
    const interval = String(settings[automaticCheckIntervalKey] || "off");
    if (!automaticIntervals.has(interval)) return await recordTick("Skipped", "scheduler-disabled");
    if (!(await hasAlarmsPermission())) return await recordTick("Failed", "alarm-permission-missing");
    await restoreActiveCheck();
    if (activeBackgroundCheck || checkStartPromise) {
      await saveBackgroundStatus("skipped", { reason: "already-running" });
      return await recordTick("Skipped", "background-check-running");
    }
    const chats = settings.gptLimitsChats && typeof settings.gptLimitsChats === "object"
      ? Object.values(settings.gptLimitsChats)
      : [];
    const eligible = chats.filter((chat) => chat?.monitored === true && chat.historyComplete === true && chat.hasPreviousPage === false &&
      Array.isArray(chat.processedMessageIds) && chat.processedMessageIds.length > 0 && typeof chat.calibrationSourceKey === "string");
    eligible.sort((a, b) => {
      const aTime = Number.isFinite(a.lastAutomaticCheckAt) ? a.lastAutomaticCheckAt : -Infinity;
      const bTime = Number.isFinite(b.lastAutomaticCheckAt) ? b.lastAutomaticCheckAt : -Infinity;
      return aTime - bTime;
    });
    const selected = eligible[0];
    const monitored = chats.filter((chat) => chat?.monitored === true);
    if (!selected) {
      const reason = monitored.length ? "no-eligible-chats" : "no-monitored-chats";
      await saveBackgroundStatus("skipped", { reason: "not-eligible" });
      return await recordTick("Skipped", reason);
    }
    selectedSourceKey = selected.calibrationSourceKey;
    const matches = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    if (matches.some((tab) => extractConversationIdFromUrl(tab.url) === selected.conversationId)) {
      await updateAutomaticChatResult(selected.calibrationSourceKey, "skipped");
      await saveBackgroundStatus("skipped", { reason: "already-open" });
      return await recordTick("Skipped", "chat-already-open");
    }
    const start = await startBackgroundCheck({ automatic: true, selectedSourceKey: selected.calibrationSourceKey });
    if (start?.ok) return await recordTick("Started");
    const reason = start?.reason === "already-running" ? "background-check-running"
      : start?.reason === "alarm-permission" ? "alarm-permission-missing"
        : "start-failed";
    return await recordTick(reason === "background-check-running" ? "Skipped" : "Failed", reason);
  } catch {
    if (selectedSourceKey) await updateAutomaticChatResult(selectedSourceKey, "failed");
    await saveBackgroundStatus("failed", { reason: "tab-error" });
    return await recordTick("Failed", "start-failed");
  } finally {
    automaticCheckRunning = false;
  }
}

function registerAlarmListenerIfAvailable() {
  if (alarmListenerRegistered) return true;
  if (!hasAlarmsApi()) return false;
  try {
    chrome.alarms.onAlarm.addListener(onBackgroundCheckAlarm);
    alarmListenerRegistered = true;
    return true;
  } catch { return false; }
}

registerAlarmListenerIfAvailable();
chrome.permissions.onAdded?.addListener((permissions) => {
  if (permissions.permissions?.includes("alarms")) {
    registerAlarmListenerIfAvailable();
    void restoreAutomaticCheckSchedule();
  }
});

async function restoreCheckWatchdog() {
  const check = await restoreActiveCheck();
  if (!check) return;
  if (!(await hasAlarmsPermission()) || !registerAlarmListenerIfAvailable()) {
    void finalizeBackgroundCheck("failed", "alarm-permission", {}, check.temporaryTabId);
    return;
  }
  if (check.phase === "finalizing") {
    void finalizeBackgroundCheck(check.finalStatus || "failed", check.finalReason || "timeout", check.finalDetails || {}, check.temporaryTabId);
    return;
  }
  if (Number.isFinite(check.deadlineAt) && check.deadlineAt <= Date.now()) {
    void finalizeBackgroundCheck("failed", "timeout", {}, check.temporaryTabId);
    return;
  }
  if (!check.conversationId || !Array.isArray(check.baselineIds) || check.baselineIds.length === 0) {
    void finalizeBackgroundCheck("failed", "interrupted", {}, check.temporaryTabId);
    return;
  }
  await scheduleCheckAlarm(Number.isFinite(check.phaseDeadlineAt) ? Math.min(check.deadlineAt, check.phaseDeadlineAt) : check.deadlineAt || Date.now() + checkTimeoutMs);
}

chrome.runtime.onStartup?.addListener(() => { void restoreCheckWatchdog(); void markInterruptedCheck(); });
chrome.runtime.onInstalled?.addListener(() => { void restoreCheckWatchdog(); void markInterruptedCheck(); });
// Service worker activation (including a reload) restores the alarm but never runs a tick.
void restoreAutomaticCheckSchedule();
void markInterruptedCheck();
chrome.permissions.onRemoved?.addListener((permissions) => {
  if (permissions.permissions?.includes("alarms")) {
    void clearAutomaticCheckAlarm();
    void chrome.storage.local.get(automaticCheckIntervalKey).then((stored) => saveAutomaticSchedulerStatus({
      enabled: false, interval: String(stored[automaticCheckIntervalKey] || "off"), alarmExists: false,
      nextScheduledTime: null, lastReason: "alarm-permission-missing",
    }));
  }
});

function safeBaselineState(state) {
  return {
    estimatedTextTokens: Number.isSafeInteger(state.estimatedTextTokens) ? state.estimatedTextTokens : 0,
    historyComplete: state.historyComplete === true,
    hasPreviousPage: state.hasPreviousPage === false ? false : null,
  };
}

async function startBackgroundCheck(options = {}) {
  if (checkStartPromise) return checkStartPromise;
  checkStartPromise = (async () => {
    const settings = await chrome.storage.local.get([backgroundMonitoringKey, "gptLimitsChats"]);
    if (settings[backgroundMonitoringKey] !== true && options.automatic !== true) {
      await saveBackgroundStatus("failed", { reason: "not-eligible" });
      return { ok: false, reason: "disabled" };
    }
    await restoreActiveCheck();
    if (activeBackgroundCheck) {
      if (options.automatic) await updateAutomaticChatResult(options.selectedSourceKey, "skipped");
      return { ok: false, reason: "already-running" };
    }
    const chats = settings.gptLimitsChats && typeof settings.gptLimitsChats === "object" ? Object.values(settings.gptLimitsChats) : [];
    const monitored = chats.filter((chat) => chat?.monitored === true);
    const eligible = options.automatic
      ? monitored.find((chat) => chat.calibrationSourceKey === options.selectedSourceKey && chat.historyComplete === true && chat.hasPreviousPage === false && Array.isArray(chat.processedMessageIds) && chat.processedMessageIds.length > 0)
      : monitored.find((chat) => chat.historyComplete === true && chat.hasPreviousPage === false && Array.isArray(chat.processedMessageIds) && chat.processedMessageIds.length > 0);
    if (!eligible) {
      const hasPartial = monitored.some((chat) => chat.historyComplete !== true || chat.hasPreviousPage !== false);
      const reason = hasPartial ? "collect-full-history-first" : "not-eligible";
      await saveBackgroundStatus("failed", { reason });
      return { ok: false, reason };
    }
    const conversationId = eligible.conversationId;
    const matches = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    const alreadyOpen = matches.some((tab) => extractConversationIdFromUrl(tab.url) === conversationId);
    if (alreadyOpen) {
      if (options.automatic) await updateAutomaticChatResult(eligible.calibrationSourceKey, "skipped");
      await saveBackgroundStatus("skipped", { reason: "already-open" });
      return { ok: false, reason: "already-open" };
    }
    if (!(await hasAlarmsPermission()) || !registerAlarmListenerIfAvailable()) {
      if (options.automatic) await updateAutomaticChatResult(eligible.calibrationSourceKey, "failed");
      await saveBackgroundStatus("failed", { reason: "alarm-permission" });
      return { ok: false, reason: "alarm-permission" };
    }
    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    activeBackgroundCheck = {
      conversationId,
      automatic: options.automatic === true,
      automaticSourceKey: options.automatic === true ? eligible.calibrationSourceKey : null,
      temporaryTabId: tab.id,
      baselineIds: [...eligible.processedMessageIds],
      baselineState: safeBaselineState(eligible),
      started: false,
      retries: 0,
      phase: "loading-tab",
      startedAt: Date.now(),
      deadlineAt: Date.now() + checkTimeoutMs,
      phaseDeadlineAt: null,
    };
    await chrome.storage.session.set({ [activeCheckSessionKey]: storedCheckState(activeBackgroundCheck) });
    await saveBackgroundStatus("running", { phase: "loading-tab", temporaryTabId: tab.id });
    if (!(await scheduleCheckAlarm(activeBackgroundCheck.deadlineAt))) {
      await finalizeBackgroundCheck("failed", "alarm-permission", {}, activeBackgroundCheck.temporaryTabId);
      return { ok: false, reason: "alarm-permission" };
    }
    await chrome.tabs.update(tab.id, { url: `https://chatgpt.com/c/${encodeURIComponent(conversationId)}` });
    return { ok: true };
  })().catch(async () => {
    if (activeBackgroundCheck) await finalizeBackgroundCheck("failed", "tab-error", {}, activeBackgroundCheck.temporaryTabId);
    else {
      if (options.automatic) await updateAutomaticChatResult(options.selectedSourceKey, "failed");
      await saveBackgroundStatus("failed", { reason: "tab-error" });
    }
    return { ok: false, reason: "tab-error" };
  }).finally(() => { checkStartPromise = null; });
  return checkStartPromise;
}

async function startContentCheck(tabId) {
  const check = await restoreActiveCheck();
  if (!check || check.temporaryTabId !== tabId || check.started) return;
  if (check.phase === "finalizing") return { ok: false, reason: "interrupted" };
  if (typeof check.conversationId !== "string" || !Array.isArray(check.baselineIds)) {
    void finalizeBackgroundCheck("failed", "interrupted", {}, tabId, true);
    return { ok: false, reason: "interrupted" };
  }
  check.started = true;
  await updateCheckPhase(check, "starting-collector", startTimeoutMs);
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "gpt-limits:background-check-start",
      tabId,
      conversationId: check.conversationId,
      startedAt: check.startedAt,
      baselineIds: check.baselineIds,
      baselineState: check.baselineState,
    });
    if (response?.ok !== true || response.started !== true) {
      const reason = failureReasons.has(response?.reason) ? response.reason : "start-failed";
      void finalizeBackgroundCheck("failed", reason, {}, tabId, true);
      return { ok: false, reason };
    }
    if (check.phase === "starting-collector") await updateCheckPhase(check, "waiting-for-capture", captureTimeoutMs);
    return { ok: true, started: true };
  } catch {
    void finalizeBackgroundCheck("failed", "start-failed", {}, tabId, true);
    return { ok: false, reason: "start-failed" };
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const urlChanged = typeof changeInfo.url === "string";
  if (changeInfo.status !== "complete" && !urlChanged) return;
  void restoreActiveCheck().then((check) => {
    if (check?.temporaryTabId === tabId) {
      const currentConversationId = extractConversationIdFromUrl(tab.url || changeInfo.url || "");
      // Redirects and route normalization may briefly pass through URLs without
      // a conversation ID. Only a different extracted ID means navigation.
      if (currentConversationId && currentConversationId !== check.conversationId) {
        void finalizeBackgroundCheck("failed", "navigation", {}, tabId, true);
        return;
      }
      if (changeInfo.status === "complete" && check.phase === "loading-tab") {
        void updateCheckPhase(check, "waiting-for-content", readyTimeoutMs);
      }
      return;
    }
    if (changeInfo.status === "complete" && check && check.temporaryTabId !== tabId &&
      extractConversationIdFromUrl(tab.url || "") === check.conversationId) {
      void finalizeBackgroundCheck("skipped", "already-open", {}, check.temporaryTabId, true);
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void restoreActiveCheck().then((check) => {
    if (check?.temporaryTabId === tabId && check.phase !== "finalizing") {
      void finalizeBackgroundCheck("failed", "user-closed", {
        newMessages: check.newMessages || 0,
        pagesLoaded: check.pagesLoaded || 0,
        overlapFound: check.overlapFound === true,
      }, tabId, false);
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "gpt-limits:identify-background-check-tab") {
    restoreActiveCheck().then((check) => sendResponse({ active: sender.tab?.id === check?.temporaryTabId }));
    return true;
  }
  if (message?.type === "gpt-limits:background-check-ready") {
    restoreActiveCheck().then(async (check) => {
      if (!check || sender.tab?.id !== check.temporaryTabId || check.phase === "finalizing") {
        sendResponse({ ok: false });
        return;
      }
      const routeConversationId = extractConversationIdFromUrl(sender.tab?.url || "");
      if (routeConversationId && routeConversationId !== check.conversationId) {
        void finalizeBackgroundCheck("failed", "navigation", {}, check.temporaryTabId);
        sendResponse({ ok: false, reason: "navigation" });
        return;
      }
      if (!routeConversationId) {
        sendResponse({ ok: false, reason: "not-conversation" });
        return;
      }
      if (check.started) {
        sendResponse({ ok: true, started: true });
        return;
      }
      const result = await startContentCheck(check.temporaryTabId);
      sendResponse(result || { ok: false, reason: "start-failed" });
    }).catch(() => sendResponse({ ok: false, reason: "start-failed" }));
    return true;
  }
  if (message?.type === "gpt-limits:start-background-check") {
    startBackgroundCheck().then(sendResponse);
    return true;
  }
  if (message?.type === "gpt-limits:configure-automatic-checks") {
    if (sender.id !== chrome.runtime.id || !["off", "30", "60", "180"].includes(String(message.interval))) {
      sendResponse({ ok: false, reason: "invalid-interval" });
      return false;
    }
    configureAutomaticCheckSchedule(String(message.interval)).then(sendResponse);
    return true;
  }
  if (message?.type === "gpt-limits:run-automatic-scheduler-tick") {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, result: "Failed", reason: "start-failed" });
      return false;
    }
    runAutomaticSchedulerTick("manual").then(sendResponse);
    return true;
  }
  if (message?.type === "gpt-limits:background-check-progress") {
    void restoreActiveCheck().then((check) => {
      if (sender.tab?.id !== check?.temporaryTabId || message.tabId !== check?.temporaryTabId) return;
      const phase = backgroundPhases.has(message.phase) ? message.phase : check.phase;
      if (phase && phase !== check.phase) void updateCheckPhase(check, phase);
      else saveBackgroundStatus("running", { ...message, phase }).catch(() => {});
    });
    // Progress messages also keep the MV3 worker responsive during a long catch-up.
    return false;
  }
  if (message?.type === "gpt-limits:background-check-capture-observed") {
    void restoreActiveCheck().then((check) => {
      if (sender.tab?.id !== check?.temporaryTabId || message.tabId !== check?.temporaryTabId) return;
      check.newMessages = Number.isSafeInteger(message.newMessages) ? message.newMessages : check.newMessages || 0;
      check.pagesLoaded = Number.isSafeInteger(message.pagesLoaded) ? message.pagesLoaded : check.pagesLoaded || 0;
      void updateCheckPhase(check, "catching-up");
    });
    return false;
  }
  if (message?.type === "gpt-limits:background-check-result") {
    restoreActiveCheck().then((check) => {
      if (sender.tab?.id !== check?.temporaryTabId || message.tabId !== check?.temporaryTabId) {
        sendResponse({ ok: false });
        return;
      }
      const success = message.status === "complete" && message.overlapFound === true;
      finalizeBackgroundCheck(success ? "complete" : "failed", success ? null : message.reason || "no-overlap", message, check.temporaryTabId, true).then(() => sendResponse({ ok: true }));
    });
    return true;
  }
  if (message?.type === "gpt-limits:cancel-background-check-chat") {
    restoreActiveCheck().then((check) => {
      if (!check) {
        sendResponse({ ok: false });
        return;
      }
      const matches = check.conversationId === message.conversationId
        ? Promise.resolve(true)
        : chrome.tabs.get(check.temporaryTabId).then((tab) => extractConversationIdFromUrl(tab.url) === message.conversationId).catch(() => false);
      matches.then((matchesConversation) => {
        if (!matchesConversation) { sendResponse({ ok: false }); return; }
        finalizeBackgroundCheck("failed", message.reason === "reset" ? "reset" : "removed", {}, check.temporaryTabId, true).then(() => sendResponse({ ok: true }));
      });
    });
    return true;
  }
  return false;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "gpt-limits:send-test-notification") {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, reason: "untrusted-sender" });
      return false;
    }
    Promise.all([
      chrome.storage.local.get(notificationPreferenceKey),
      chrome.permissions.contains({ permissions: ["notifications"] }),
    ]).then(async ([stored, permissionGranted]) => {
      if (stored[notificationPreferenceKey] !== true) {
        sendResponse({ ok: false, reason: "disabled" });
        return;
      }
      if (!permissionGranted) {
        sendResponse({ ok: false, reason: "permission-required" });
        return;
      }
      if (!chrome.notifications) {
        sendResponse({ ok: false, reason: "unavailable" });
        return;
      }
      await chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("notification-icon.png"),
        title: "GPT Limits — Test notification",
        message: "Desktop risk notifications are working.",
      });
      sendResponse({ ok: true });
    }).catch(() => sendResponse({ ok: false, reason: "error" }));
    return true;
  }
  if (message?.type !== "gpt-limits:show-risk-notification") return false;
  if (sender.id !== chrome.runtime.id || !permittedRiskLevels.has(message.level)) {
    sendResponse({ ok: false });
    return false;
  }

  Promise.all([
    chrome.storage.local.get(notificationPreferenceKey),
    chrome.permissions.contains({ permissions: ["notifications"] }),
  ]).then(async ([stored, permissionGranted]) => {
    if (stored[notificationPreferenceKey] !== true || !permissionGranted) {
      sendResponse({ ok: false, reason: "disabled" });
      return;
    }
    if (!chrome.notifications) {
      sendResponse({ ok: false, reason: "unavailable" });
      return;
    }
    const text = GptRiskNotifications.notificationText(message.chatTitle, { level: message.level, partial: message.partial === true });
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("notification-icon.png"),
      title: text.title,
      message: text.message,
    });
    sendResponse({ ok: true });
  }).catch(() => sendResponse({ ok: false, reason: "error" }));
  return true;
});

"use strict";

const statusElement = document.getElementById("status");
const detailsElement = document.getElementById("details");
const resetButton = document.getElementById("reset-current-chat");
const resetStatusElement = document.getElementById("reset-status");
const trackedChatsElement = document.getElementById("tracked-chats-section");
const calibrationSummaryElement = document.getElementById("calibration-summary-section");
const calibrationSummary = globalThis.GptCalibrationSummary;
const calibrationCopyButton = document.getElementById("copy-calibration-summary");
const calibrationCopyStatus = document.getElementById("calibration-copy-status");
const desktopNotificationsCheckbox = document.getElementById("desktop-risk-notifications");
const desktopNotificationsState = document.getElementById("desktop-risk-notifications-state");
const desktopNotificationsHelp = document.getElementById("desktop-risk-notifications-help");
const testNotificationButton = document.getElementById("send-test-notification");
const desktopNotificationsPreferenceKey = "gptLimitsDesktopRiskNotifications";
const backgroundMonitoringCheckbox = document.getElementById("background-monitoring");
const backgroundMonitoringState = document.getElementById("background-monitoring-state");
const backgroundMonitoringPreferenceKey = "gptLimitsBackgroundMonitoring";
const backgroundCheckStatusKey = "gptLimitsBackgroundCheckStatus";
const backgroundCheckButton = document.getElementById("check-monitored-chat");
const backgroundCheckStatusElement = document.getElementById("background-check-status");
const automaticCheckInterval = document.getElementById("automatic-check-interval");
const automaticCheckStatus = document.getElementById("automatic-check-status");
const automaticCheckNext = document.getElementById("automatic-check-next");
const automaticCheckSchedule = document.getElementById("automatic-check-schedule");
const automaticSchedulerAlarm = document.getElementById("automatic-scheduler-alarm");
const automaticSchedulerNext = document.getElementById("automatic-scheduler-next");
const automaticSchedulerLastTick = document.getElementById("automatic-scheduler-last-tick");
const automaticSchedulerResult = document.getElementById("automatic-scheduler-result");
const runAutomaticTickButton = document.getElementById("run-automatic-tick");
const automaticCheckIntervalKey = "gptLimitsAutomaticCheckInterval";
const automaticSchedulerStatusKey = "gptLimitsAutomaticSchedulerStatus";
const collectHistoryButton = document.getElementById("collect-full-history");
const stopHistoryButton = document.getElementById("stop-history-collection");
const historyCollectionStatus = document.getElementById("history-collection-status");
const rescueSection = document.getElementById("chat-rescue-section");
const rescueOpenButton = document.getElementById("rescue-current-chat");
const rescueConfirmPanel = document.getElementById("rescue-confirm");
const rescueStartButton = document.getElementById("start-rescue");
const rescueConfirmCancelButton = document.getElementById("cancel-rescue-confirm");
const rescueProgressPanel = document.getElementById("rescue-progress-panel");
const rescueProgressStatus = document.getElementById("rescue-progress-status");
const rescueProgressBar = document.getElementById("rescue-progress-bar");
const rescueOperationCancelButton = document.getElementById("cancel-rescue-operation");
const rescueResultPanel = document.getElementById("rescue-result-panel");
const rescueResultStatus = document.getElementById("rescue-result-status");
const rescueHTMLButton = document.getElementById("save-rescue-html");
const rescueTextButton = document.getElementById("save-rescue-text");
let activeTabId = null;
let currentConversationId = "";
let currentState = null;
let trackedChats = [];
let collectionPollTimer = null;
let backgroundCheckPollTimer = null;
let savedAutomaticCheckInterval = "off";
let rescuePollTimer = null;

function formatTime(value) {
  return Number.isFinite(value) ? new Date(value).toLocaleString() : "Unknown";
}

function historyLabel(state) {
  if (state.historyComplete === true && state.hasPreviousPage === false) return "Complete";
  if (state.hasPreviousPage === true) return "Partial";
  return "Unknown";
}

function showState(state, captureStatus) {
  currentState = state || null;
  if (!state) {
    detailsElement.hidden = true;
    collectHistoryButton.hidden = true;
    stopHistoryButton.hidden = true;
    statusElement.textContent = captureStatus === "Error"
      ? "Error — could not capture this chat. Reload the ChatGPT tab and try again."
      : "Waiting for ChatGPT conversation response.";
    renderCurrentRisk(null);
    return;
  }
  statusElement.textContent = captureStatus === "Error"
    ? "Error — capture failed. Reload the ChatGPT tab and try again."
    : "Capturing this chat locally.";
  document.getElementById("title").textContent = state.title || "Unknown";
  document.getElementById("message-count").textContent = String(state.messagesCollected);
  document.getElementById("user-count").textContent = String(state.userMessages);
  document.getElementById("assistant-count").textContent = String(state.assistantMessages);
  document.getElementById("other-count").textContent = String(state.otherMessages);
  document.getElementById("token-count").textContent = Number(state.estimatedTextTokens).toLocaleString();
  document.getElementById("images-count").textContent = String(state.attachments.images);
  document.getElementById("audio-count").textContent = String(state.attachments.audio);
  document.getElementById("video-count").textContent = String(state.attachments.video);
  document.getElementById("files-count").textContent = String(state.attachments.files);
  document.getElementById("history-status").textContent = historyLabel(state);
  document.getElementById("last-updated").textContent = formatTime(state.updatedAt);
  renderCurrentRisk(state);
  collectHistoryButton.hidden = !currentConversationId || state.historyComplete === true || state.hasPreviousPage !== true;
  detailsElement.hidden = false;
}

function showHistoryCollection(collection, state) {
  const status = collection?.status || "idle";
  stopHistoryButton.hidden = status !== "collecting";
  collectHistoryButton.hidden = !currentConversationId || !state || state.historyComplete === true || state.hasPreviousPage !== true || status === "collecting";
  if (status === "collecting") {
    historyCollectionStatus.textContent = `Collecting history… ${Number(collection.messagesCollected || state?.messagesCollected || 0).toLocaleString()} messages`;
    historyCollectionStatus.hidden = false;
    if (collectionPollTimer === null) collectionPollTimer = setInterval(pollHistoryCollection, 700);
    return;
  }
  if (collectionPollTimer !== null) {
    clearInterval(collectionPollTimer);
    collectionPollTimer = null;
  }
  const count = Number(collection?.messagesCollected ?? state?.messagesCollected ?? 0).toLocaleString();
  if (status === "complete") historyCollectionStatus.textContent = `History collection complete — ${count} messages`;
  else if (status === "paused" && collection.reason === "no-progress") historyCollectionStatus.textContent = "Collection paused — no new history was loaded.";
  else if (status === "paused") historyCollectionStatus.textContent = "Collection paused — could not continue loading history.";
  else if (status === "stopped" && collection.reason === "user") historyCollectionStatus.textContent = `History collection stopped — ${count} messages collected.`;
  else if (status === "stopped" && collection.reason === "reset") historyCollectionStatus.textContent = "History collection stopped because the chat was reset.";
  else if (status === "stopped" && collection.reason === "navigation") historyCollectionStatus.textContent = "History collection stopped after leaving this chat.";
  else historyCollectionStatus.textContent = "";
  historyCollectionStatus.hidden = !historyCollectionStatus.textContent;
}

async function pollHistoryCollection() {
  try {
    const result = await getCurrentState();
    if (result.currentConversationId !== currentConversationId) {
      showHistoryCollection({ status: "stopped", reason: "navigation", messagesCollected: 0 }, null);
      return;
    }
    showHistoryCollection(result.historyCollection, result.state);
  } catch {
    showHistoryCollection({ status: "paused", reason: "error" }, null);
  }
}

function renderTrackedChatGroup(elementId, chats) {
  const list = document.getElementById(elementId);
  list.replaceChildren();
  for (const chat of chats) {
    const row = document.createElement("li");
    const title = document.createElement("span");
    title.className = "tracked-title";
    title.textContent = chat.title || "Unknown";
    const meta = document.createElement("span");
    meta.className = "tracked-meta";
    meta.textContent = `${chat.messagesCollected} messages · History: ${historyLabel(chat)} · Updated: ${formatTime(chat.updatedAt)}`;
    if (chat.monitored === true) {
      const sampleCount = Array.isArray(chat.calibrationSnapshots) ? chat.calibrationSnapshots.length : 0;
      const pointCount = Array.isArray(chat.calibrationPoints) ? chat.calibrationPoints.length : 0;
      const labels = { normal: "Normal", near_limit: "Near limit", limit_reached: "Limit reached" };
      meta.textContent += ` · Calibration samples: ${sampleCount} · Manual points: ${pointCount} · Calibration: ${labels[chat.calibrationLabel] || "Unlabeled"}`;
      const label = document.createElement("label");
      label.className = "tracked-calibration-control";
      label.textContent = "Calibration ";
      const select = document.createElement("select");
      select.className = "tracked-calibration-select";
      select.dataset.conversationId = chat.conversationId;
      select.setAttribute("aria-label", `Set calibration for ${chat.title || "tracked chat"}`);
      const options = [["", "Choose label…"], ["normal", "Normal"], ["near_limit", "Near limit"], ["limit_reached", "Limit reached"], ["clear", "Clear current label"]];
      for (const [value, text] of options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.append(option);
      }
      label.append(select);
      row.append(label);
    }
    const monitor = document.createElement("button");
    monitor.type = "button";
    monitor.className = `tracked-action${chat.monitored ? " monitored" : ""}`;
    monitor.textContent = chat.monitored ? "Stop monitoring" : "Monitor";
    monitor.setAttribute("aria-pressed", chat.monitored ? "true" : "false");
    monitor.dataset.conversationId = chat.conversationId;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tracked-remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${chat.title || "tracked chat"}`);
    remove.dataset.conversationId = chat.conversationId;
    row.append(title, meta, monitor, remove);
    list.append(row);
  }
  if (list.children.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "None";
    list.append(empty);
  }
}

function renderTrackedChats(chats) {
  const valid = Array.isArray(chats) ? chats : [];
  trackedChats = valid;
  renderTrackedChatGroup("monitored-chats", valid.filter((chat) => chat.monitored === true));
  renderTrackedChatGroup("other-tracked-chats", valid.filter((chat) => chat.monitored !== true));
  renderCalibrationSummary(valid);
  renderCurrentRisk(currentState);
}

function renderCurrentRisk(state) {
  const riskElement = document.getElementById("risk-state");
  const model = calibrationSummary.buildRiskModel(trackedChats);
  if (!state) {
    riskElement.textContent = model.reason === "overlap"
      ? "Calibration overlap detected — risk model unavailable."
      : "Risk model unavailable — more calibration data is needed.";
    return;
  }
  riskElement.textContent = calibrationSummary.assessRisk(model, state.estimatedTextTokens, historyLabel(state)).text;
}

function renderCalibrationSummary(chats) {
  const summary = calibrationSummary.summarize(chats);
  const riskModel = calibrationSummary.buildRiskModel(chats);
  document.getElementById("calibration-counts").textContent =
    `Normal: ${summary.counts.normal} points · ${summary.uniqueSourceCounts.normal} chats · Near limit: ${summary.counts.near_limit} points · ${summary.uniqueSourceCounts.near_limit} chats · Limit reached: ${summary.counts.limit_reached} points · ${summary.uniqueSourceCounts.limit_reached} chats`;
  const rangesElement = document.getElementById("calibration-ranges");
  rangesElement.replaceChildren();
  if (summary.points.length === 0) {
    const empty = document.createElement("p");
    empty.className = "calibration-empty";
    empty.textContent = "No manually labeled points yet.";
    rangesElement.append(empty);
  }
  for (const label of calibrationSummary.labels) {
    const group = summary.byLabel[label];
    if (group.count === 0) continue;
    const section = document.createElement("section");
    section.className = "calibration-label-summary";
    const heading = document.createElement("h3");
    heading.textContent = `${calibrationSummary.labelNames[label]} · ${group.count} points · ${group.uniqueSources} chats`;
    section.append(heading);
    for (const history of calibrationSummary.histories) {
      const historyGroup = group.byHistory[history];
      if (!historyGroup.count) continue;
      const subheading = document.createElement("h4");
      subheading.textContent = `History: ${history} · ${historyGroup.count} points · ${historyGroup.uniqueSources} chats`;
      section.append(subheading);
      for (const [field, name] of [["messagesCollected", "Messages"], ["estimatedTextTokens", "Estimated text tokens"], ["images", "Images"], ["totalAttachments", "Total attachments"]]) {
        const range = historyGroup.ranges[field];
        const line = document.createElement("p");
        line.textContent = `${name}: min ${Number(range.min).toLocaleString()} · median ${Number(range.median).toLocaleString()} · max ${Number(range.max).toLocaleString()}`;
        section.append(line);
      }
    }
    rangesElement.append(section);
  }
  renderLatestCalibrationPoints("latest-points", "Latest point per chat", summary.latestPerSource);
  renderLatestCalibrationPoints("latest-complete-points", "Latest Complete point per chat", summary.latestCompletePerSource);
  renderRiskModelDetails(riskModel);
  const pointsList = document.getElementById("calibration-points");
  pointsList.replaceChildren();
  if (summary.points.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No calibration points yet.";
    pointsList.append(empty);
  }
  for (const point of summary.points) {
    const row = document.createElement("li");
    row.className = "calibration-point";
    const details = document.createElement("div");
    const fields = [
      calibrationSummary.labelNames[point.label],
      `Chat: ${point.chatTitle}`,
      `Time: ${formatTime(point.timestamp)}`,
      `Messages: ${Number(point.messagesCollected).toLocaleString()}`,
      `Estimated text tokens: ${Number(point.estimatedTextTokens).toLocaleString()}`,
      `Images: ${point.images}`,
      `Other attachments: ${point.otherAttachments}`,
      `History: ${point.historyStatus}`,
    ];
    details.textContent = fields.join(" · ");
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-calibration-point";
    remove.textContent = "Delete point";
    remove.dataset.conversationId = point.conversationId;
    remove.dataset.pointIndex = String(point.pointIndex);
    remove.setAttribute("aria-label", `Delete ${calibrationSummary.labelNames[point.label]} point for ${point.chatTitle}`);
    row.append(details, remove);
    pointsList.append(row);
  }
}

function renderRiskModelDetails(model) {
  const container = document.getElementById("risk-model-content");
  container.replaceChildren();
  const number = (value) => value === null ? "Not available" : Number(value).toLocaleString();
  const lines = [
    `Complete Normal chats: ${model.normalSources}`,
    `Complete Limit reached chats: ${model.limitReachedSources}`,
    `Highest observed Normal: ${number(model.safeCeiling)} tokens`,
    `Lowest observed Limit reached: ${number(model.limitFloor)} tokens`,
  ];
  if (model.available) {
    lines.push(`Watch: ${number(model.watchThreshold)}`, `Near limit: ${number(model.nearLimitThreshold)}`, `Critical: ${number(model.criticalThreshold)}`);
  } else {
    lines.push(model.reason === "overlap"
      ? "Calibration overlap detected — risk model unavailable."
      : "Risk model unavailable — more calibration data is needed.");
  }
  lines.push(`Messages: Normal ceiling ${number(model.normalMessagesCeiling)} · Limit reached floor ${number(model.limitMessagesFloor)}`);
  lines.push("Attachments are recorded but are not yet included in the risk model.");
  for (const text of lines) {
    const line = document.createElement("p");
    line.textContent = text;
    container.append(line);
  }
}

function renderLatestCalibrationPoints(elementId, headingText, points) {
  const container = document.getElementById(elementId);
  container.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = headingText;
  container.append(heading);
  if (!points.length) {
    const empty = document.createElement("p");
    empty.className = "calibration-empty";
    empty.textContent = "No matching calibration points yet.";
    container.append(empty);
    return;
  }
  const list = document.createElement("ul");
  for (const point of points) {
    const row = document.createElement("li");
    row.className = "calibration-point";
    row.textContent = [
      calibrationSummary.labelNames[point.label],
      `Chat: ${point.chatTitle}`,
      `Time: ${formatTime(point.timestamp)}`,
      `Messages: ${Number(point.messagesCollected).toLocaleString()}`,
      `Estimated text tokens: ${Number(point.estimatedTextTokens).toLocaleString()}`,
      `Images: ${point.images}`,
      `Other attachments: ${point.otherAttachments}`,
      `History: ${point.historyStatus}`,
    ].join(" · ");
    list.append(row);
  }
  container.append(list);
}

async function getCurrentState() {
  return chrome.tabs.sendMessage(activeTabId, { type: "gpt-limits:get-current-state" });
}

async function main() {
  await initializeDesktopNotificationSetting();
  await initializeBackgroundMonitoringSetting();
  await initializeAutomaticCheckSetting();
  await refreshBackgroundCheckStatus();
  detailsElement.hidden = true;
  resetButton.hidden = true;
  collectHistoryButton.hidden = true;
  stopHistoryButton.hidden = true;
  trackedChatsElement.hidden = true;
  calibrationSummaryElement.hidden = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!isChatGPTConversationTab(tab)) {
      statusElement.textContent = "Open a ChatGPT conversation to view current-chat statistics.";
      return;
    }
    activeTabId = tab.id;
    rescueSection.hidden = false;
    const rescueState = await pollRescueStatus();
    if (rescueState?.status === "collecting" && rescuePollTimer === null) rescuePollTimer = setInterval(pollRescueStatus, 500);
    trackedChatsElement.hidden = false;
    calibrationSummaryElement.hidden = false;
    const result = await getCurrentState();
    currentConversationId = typeof result?.currentConversationId === "string" ? result.currentConversationId : "";
    resetButton.hidden = !currentConversationId || !result?.state;
    renderTrackedChats(result?.chats ?? []);
    showState(result?.state ?? null, result?.captureStatus);
    showHistoryCollection(result?.historyCollection, result?.state);
  } catch {
    statusElement.textContent = "Could not load current-chat statistics. Global background controls remain available.";
  }
}

function isChatGPTConversationTab(tab) {
  if (!tab?.id || typeof tab.url !== "string") return false;
  try {
    const url = new URL(tab.url);
    return url.hostname === "chatgpt.com" && /(?:^|\/)c\/[^/]+(?:\/|$)/i.test(url.pathname);
  } catch { return false; }
}

function formatRescueElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function renderRescueState(value) {
  const status = value?.status || "idle";
  rescueConfirmPanel.hidden = true;
  rescueProgressPanel.hidden = status !== "collecting";
  rescueResultPanel.hidden = !status.startsWith("rescue_") || status === "rescue_export_failed";
  rescueOpenButton.disabled = status === "collecting";
  if (status === "idle" || status === "not_started") return;
  if (status === "collecting") {
    const progress = value.progress || {};
    rescueProgressStatus.textContent = `Collecting… ${Number(progress.capturedUniqueMessages || 0).toLocaleString()} unique messages · scroll ${Number(progress.scrollPercent || 0)}% · step ${Number(progress.step || 0)} · ${formatRescueElapsed(progress.elapsedMs)}`;
    rescueProgressBar.value = Number.isFinite(progress.scrollPercent) ? Math.min(100, Math.max(0, progress.scrollPercent)) : 0;
    return;
  }
  if (!status.startsWith("rescue_")) return;
  const labels = {
    rescue_complete: "Rescue complete",
    rescue_partial_top_unproven: "Partial — the start of history could not be proven",
    rescue_partial_no_progress: "Partial — the page stopped changing before the end was confirmed",
    rescue_cancelled: "Partial — rescue cancelled",
    rescue_unsupported_layout: "Rescue unavailable — unsupported conversation layout",
  };
  const result = value.result || {};
  const count = Number(result.messageCount || 0).toLocaleString();
  const restore = result.restoreSuccess === true ? "Original scroll restored" : "Scroll restoration could not be confirmed";
  rescueResultStatus.textContent = `${labels[status] || "Rescue finished"} · ${count} messages · ${Number(result.steps || 0)} steps · ${formatRescueElapsed(result.elapsedMs)} · ${restore}`;
  rescueHTMLButton.disabled = Number(result.messageCount || 0) === 0;
  rescueTextButton.disabled = rescueHTMLButton.disabled;
}

async function pollRescueStatus() {
  if (!activeTabId) return null;
  try {
    const value = await chrome.tabs.sendMessage(activeTabId, { type: "gpt-limits:rescue:status" });
    renderRescueState(value);
    if (value?.status !== "collecting" && rescuePollTimer !== null) {
      clearInterval(rescuePollTimer);
      rescuePollTimer = null;
    }
    return value;
  } catch {
    rescueProgressStatus.textContent = "Rescue status unavailable — keep the ChatGPT tab open.";
    return null;
  }
}

rescueOpenButton.addEventListener("click", async () => {
  await pollRescueStatus();
  if (rescueProgressPanel.hidden) {
    rescueConfirmPanel.hidden = false;
    rescueResultPanel.hidden = true;
  }
});

rescueConfirmCancelButton.addEventListener("click", () => { rescueConfirmPanel.hidden = true; });

rescueStartButton.addEventListener("click", async () => {
  if (!activeTabId) return;
  rescueStartButton.disabled = true;
  try {
    const result = await chrome.tabs.sendMessage(activeTabId, { type: "gpt-limits:rescue:start" });
    if (!result?.ok) {
      rescueConfirmPanel.hidden = false;
      rescueProgressPanel.hidden = true;
      rescueResultPanel.hidden = false;
      rescueResultStatus.textContent = result?.reason === "already-running" ? "A rescue is already running for this chat." : "Rescue could not start. Open a supported ChatGPT conversation and try again.";
      rescueHTMLButton.disabled = true;
      rescueTextButton.disabled = true;
      return;
    }
    rescueConfirmPanel.hidden = true;
    rescueResultPanel.hidden = true;
    rescueProgressPanel.hidden = false;
    rescueProgressStatus.textContent = "Collecting… 0 unique messages · preparing scroll";
    const state = await pollRescueStatus();
    if (state?.status === "collecting" && rescuePollTimer === null) rescuePollTimer = setInterval(pollRescueStatus, 500);
  } catch {
    rescueConfirmPanel.hidden = false;
    rescueProgressPanel.hidden = true;
    rescueResultPanel.hidden = false;
    rescueResultStatus.textContent = "Rescue could not start. Keep the ChatGPT conversation open and try again.";
    rescueHTMLButton.disabled = true;
    rescueTextButton.disabled = true;
  } finally {
    rescueStartButton.disabled = false;
  }
});

rescueOperationCancelButton.addEventListener("click", async () => {
  if (!activeTabId) return;
  rescueOperationCancelButton.disabled = true;
  try { await chrome.tabs.sendMessage(activeTabId, { type: "gpt-limits:rescue:cancel" }); }
  catch { rescueProgressStatus.textContent = "Cancel requested; waiting for the current scroll step to finish."; }
  finally { rescueOperationCancelButton.disabled = false; }
});

async function downloadRescue(format) {
  if (!activeTabId) return;
  const button = format === "html" ? rescueHTMLButton : rescueTextButton;
  button.disabled = true;
  try {
    const result = await chrome.tabs.sendMessage(activeTabId, { type: "gpt-limits:rescue:export" });
    if (!result?.ok) throw new Error("not-ready");
    const content = format === "html" ? result.html : result.text;
    const extension = format === "html" ? "html" : "txt";
    const blob = new Blob([content], { type: format === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8" });
    const objectURL = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectURL;
    anchor.download = String(result.filenameBase || "chat-rescue").replace(/\.[^.]+$/, `.${extension}`);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
  } catch {
    rescueResultStatus.textContent = "rescue_export_failed — could not create the file. The captured snapshot remains available in this tab.";
  } finally {
    button.disabled = false;
  }
}

rescueHTMLButton.addEventListener("click", () => downloadRescue("html"));
rescueTextButton.addEventListener("click", () => downloadRescue("txt"));

async function initializeBackgroundMonitoringSetting() {
  try {
    const stored = await chrome.storage.local.get(backgroundMonitoringPreferenceKey);
    const enabled = stored[backgroundMonitoringPreferenceKey] === true;
    backgroundMonitoringCheckbox.checked = enabled;
    backgroundMonitoringState.textContent = enabled ? "On" : "Off";
    backgroundCheckButton.disabled = !enabled;
  } catch {
    backgroundMonitoringCheckbox.checked = false;
    backgroundMonitoringState.textContent = "Off";
    backgroundCheckButton.disabled = true;
  }
}

async function initializeAutomaticCheckSetting() {
  try {
    const stored = await chrome.storage.local.get([automaticCheckIntervalKey, automaticSchedulerStatusKey, "gptLimitsChats"]);
    const interval = ["off", "30", "60", "180"].includes(String(stored[automaticCheckIntervalKey])) ? String(stored[automaticCheckIntervalKey]) : "off";
    savedAutomaticCheckInterval = interval;
    automaticCheckInterval.value = interval;
    renderLastAutomaticCheck(stored.gptLimitsChats);
    renderAutomaticSchedulerStatus(stored[automaticSchedulerStatusKey], interval);
  } catch {
    automaticCheckInterval.value = "off";
    automaticCheckStatus.textContent = "Last automatic check: Not run";
  }
}

function formatClockTime(value) {
  return Number.isFinite(value) ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
}

function renderAutomaticSchedulerStatus(statusValue, selectedInterval = automaticCheckInterval.value || "off") {
  const status = statusValue && typeof statusValue === "object" ? statusValue : null;
  const intervalNames = { off: "Off", "30": "Every 30 minutes", "60": "Every 1 hour", "180": "Every 3 hours" };
  const interval = intervalNames[selectedInterval] ? selectedInterval : "off";
  automaticCheckSchedule.textContent = `Automatic checks: ${intervalNames[interval]}`;
  automaticCheckNext.textContent = `Next check: ${status && status.alarmExists ? formatClockTime(status.nextScheduledTime) : "—"}`;
  if (!status) {
    automaticSchedulerAlarm.textContent = interval === "off" ? "Scheduler alarm: Off" : "Scheduler alarm: Checking…";
    automaticSchedulerNext.textContent = "Next tick: —";
    automaticSchedulerLastTick.textContent = "Last tick: —";
    automaticSchedulerResult.textContent = "Result: —";
    return;
  }
  const reasonText = {
    "alarm-permission-missing": "alarms permission required",
    "scheduler-alarm-missing": "alarm was not created",
    "scheduler-disabled": "scheduler is Off",
  };
  automaticSchedulerAlarm.textContent = `Automatic checks: ${intervalNames[interval]} · Scheduler alarm: ${status.alarmExists ? "Active" : reasonText[status.lastReason] || "Off"}`;
  automaticSchedulerNext.textContent = `Next tick: ${formatClockTime(status.nextScheduledTime)}`;
  automaticSchedulerLastTick.textContent = `Last tick: ${formatClockTime(status.lastTickAt)}`;
  const resultText = {
    Started: "Started",
    Running: "Running…",
    Skipped: "Skipped",
    Failed: "Failed",
  };
  const tickReason = {
    "no-monitored-chats": "no monitored chats",
    "no-eligible-chats": "no eligible monitored chat",
    "chat-already-open": "chat already open",
    "background-check-running": "another background check is running",
    "alarm-permission-missing": "alarm permission required",
    "scheduler-disabled": "scheduler is Off",
    "scheduler-alarm-missing": "scheduler alarm missing",
    "start-failed": "could not start background check",
  };
  const result = resultText[status.lastTickResult] || "—";
  const reason = tickReason[status.lastReason];
  automaticSchedulerResult.textContent = `Result: ${result}${reason ? ` · ${reason}` : ""}`;
}

function renderLastAutomaticCheck(chatsValue) {
  const chats = chatsValue && typeof chatsValue === "object" ? Object.values(chatsValue) : [];
  const latest = chats.filter((chat) => Number.isFinite(chat?.lastAutomaticCheckAt))
    .sort((a, b) => b.lastAutomaticCheckAt - a.lastAutomaticCheckAt)[0];
  if (!latest) {
    automaticCheckStatus.textContent = "Last check: Not run";
    return;
  }
  const result = latest.lastAutomaticCheckResult === "complete" ? "Complete"
    : latest.lastAutomaticCheckResult === "skipped" ? "Skipped" : "Failed";
  automaticCheckStatus.textContent = `Last check: ${latest.title || "Untitled chat"} · ${result} · ${formatClockTime(latest.lastAutomaticCheckAt)}`;
}

function renderBackgroundCheckStatus(status) {
  const value = status && typeof status === "object" ? status : null;
  if (!value || !value.status) {
    backgroundCheckStatusElement.textContent = "Background check: Not run";
    return;
  }
  const last = Number.isFinite(value.lastCheckAt) ? ` · ${formatTime(value.lastCheckAt)}` : "";
  if (value.status === "running") {
    const phaseLabels = {
      "creating-tab": "creating temporary tab",
      "loading-tab": "loading chat",
      "waiting-for-content": "waiting for chat page",
      "starting-collector": "starting collector",
      "waiting-for-capture": "waiting for conversation response",
      "catching-up": "checking recent history",
      "finalizing": "finishing",
    };
    const phase = phaseLabels[value.phase] || "starting";
    backgroundCheckStatusElement.textContent = `Background check: Running · ${phase} · ${Number(value.newMessages || 0).toLocaleString()} new messages · ${Number(value.pagesLoaded || 0)} pages loaded`;
    if (backgroundCheckPollTimer === null) backgroundCheckPollTimer = setInterval(refreshBackgroundCheckStatus, 1000);
    return;
  }
  if (backgroundCheckPollTimer !== null) {
    clearInterval(backgroundCheckPollTimer);
    backgroundCheckPollTimer = null;
  }
  if (value.status === "complete") {
    backgroundCheckStatusElement.textContent = `Background check: Complete · New messages: ${Number(value.newMessages || 0).toLocaleString()} · Pages loaded: ${Number(value.pagesLoaded || 0)} · Overlap found: Yes${last}`;
    return;
  }
  if (value.status === "skipped" && value.reason === "already-open") {
    backgroundCheckStatusElement.textContent = `Background check: Skipped — chat already open.${last}`;
    return;
  }
  if (value.status === "skipped" && value.reason === "already-running") {
    backgroundCheckStatusElement.textContent = `Background check: Skipped — another background check is running.${last}`;
    return;
  }
  const messages = {
    "collect-full-history-first": "Background check unavailable — collect full history first.",
    "no-overlap": "Background check: Failed · Reason: No overlap found",
    "no-capture": "Background check: Failed · Reason: No conversation response was captured",
    "initial-capture-unavailable": "Background check: Failed · Reason: Initial conversation response was unavailable",
    "content-not-ready": "Background check: Failed · Reason: Chat page did not become ready",
    "start-failed": "Background check: Failed · Reason: History collector could not start",
    "no-container": "Background check: Failed · Reason: Could not find the conversation scroll area",
    "scroll-container-not-found": "Background check: Failed · Reason: Conversation loaded, but its scroll area was not found",
    "conversation-dom-not-ready": "Background check: Failed · Reason: Conversation area did not appear",
    "collector-already-running": "Background check unavailable · A collector is already running",
    "collector-start-exception": "Background check: Failed · Collector could not start because of an internal error",
    "load-timeout": "Background check: Failed · Reason: ChatGPT load timed out",
    timeout: "Background check: Failed · Reason: Check timed out",
    "user-closed": "Background check: Failed · Reason: Temporary tab was closed",
    "navigation": "Background check: Failed · Reason: Conversation changed",
    reset: "Background check: Failed · Reason: Chat data was reset",
    removed: "Background check: Failed · Reason: Chat was removed",
    "tab-error": "Background check: Failed · Reason: Temporary tab could not be started",
    interrupted: "Background check: Failed · Reason: Check was interrupted",
    "alarm-permission": "Background check unavailable — alarm permission required.",
    "cleanup-error": "Background check: Failed · Reason: Temporary tab cleanup could not be confirmed",
    "not-eligible": "Background check unavailable — no eligible monitored chat.",
  };
  backgroundCheckStatusElement.textContent = `${messages[value.reason] || "Background check: Failed"}${last}`;
}

async function refreshBackgroundCheckStatus() {
  try {
    const stored = await chrome.storage.local.get([backgroundCheckStatusKey, automaticSchedulerStatusKey, automaticCheckIntervalKey, "gptLimitsChats"]);
    renderBackgroundCheckStatus(stored[backgroundCheckStatusKey]);
    renderLastAutomaticCheck(stored.gptLimitsChats);
    renderAutomaticSchedulerStatus(stored[automaticSchedulerStatusKey], String(stored[automaticCheckIntervalKey] || "off"));
  } catch {
    renderBackgroundCheckStatus(null);
  }
}

automaticCheckInterval.addEventListener("change", async () => {
  const selected = String(automaticCheckInterval.value);
  automaticCheckInterval.disabled = true;
  try {
    if (selected !== "off") {
      const granted = await chrome.permissions.request({ permissions: ["alarms"] });
      if (!granted) {
        automaticCheckInterval.value = savedAutomaticCheckInterval;
        automaticSchedulerAlarm.textContent = "Scheduler alarm: alarms permission required";
        return;
      }
    }
    await chrome.storage.local.set({ [automaticCheckIntervalKey]: selected });
    const result = await chrome.runtime.sendMessage({ type: "gpt-limits:configure-automatic-checks", interval: selected });
    if (result?.ok !== true) {
      if (selected !== "off") {
        automaticCheckInterval.value = "off";
        await chrome.storage.local.set({ [automaticCheckIntervalKey]: "off" });
      }
      await refreshBackgroundCheckStatus();
      return;
    }
    savedAutomaticCheckInterval = selected;
    await refreshBackgroundCheckStatus();
  } catch {
    automaticCheckInterval.value = savedAutomaticCheckInterval;
    automaticSchedulerAlarm.textContent = "Scheduler alarm: Could not update schedule";
  } finally {
    automaticCheckInterval.disabled = false;
  }
});

runAutomaticTickButton.addEventListener("click", async () => {
  runAutomaticTickButton.disabled = true;
  automaticSchedulerResult.textContent = "Result: Running…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "gpt-limits:run-automatic-scheduler-tick" });
    if (!result || typeof result !== "object") automaticSchedulerResult.textContent = "Result: Failed · scheduler tick could not run";
    await refreshBackgroundCheckStatus();
  } catch {
    automaticSchedulerResult.textContent = "Result: Failed · scheduler tick could not run";
  } finally {
    runAutomaticTickButton.disabled = false;
  }
});

backgroundMonitoringCheckbox.addEventListener("change", async () => {
  backgroundMonitoringCheckbox.disabled = true;
  try {
    const enabled = backgroundMonitoringCheckbox.checked;
    await chrome.storage.local.set({ [backgroundMonitoringPreferenceKey]: enabled });
    backgroundMonitoringState.textContent = enabled ? "On" : "Off";
    backgroundCheckButton.disabled = !enabled;
  } catch {
    backgroundMonitoringCheckbox.checked = false;
    backgroundMonitoringState.textContent = "Off";
    backgroundCheckButton.disabled = true;
  } finally {
    backgroundMonitoringCheckbox.disabled = false;
  }
});

backgroundCheckButton.addEventListener("click", async () => {
  if (!backgroundMonitoringCheckbox.checked) {
    backgroundCheckStatusElement.textContent = "Background check unavailable — turn on background monitoring first.";
    return;
  }
  backgroundCheckButton.disabled = true;
  backgroundCheckStatusElement.textContent = "Background check: Starting…";
  try {
    // Request directly in the click handler before any await so Chrome keeps
    // the user gesture required for an optional permission prompt.
    const permissionRequest = chrome.permissions.request({ permissions: ["alarms"] });
    const granted = await permissionRequest;
    if (!granted) {
      backgroundCheckStatusElement.textContent = "Background check: Failed · alarm permission required.";
      return;
    }
    const result = await chrome.runtime.sendMessage({ type: "gpt-limits:start-background-check" });
    if (!result || typeof result !== "object") {
      backgroundCheckStatusElement.textContent = "Background check: Failed · could not start.";
      return;
    }
    if (result.ok !== true) {
      if (result.reason === "alarm-permission") {
        backgroundCheckStatusElement.textContent = "Background check: Failed · alarm permission required.";
      } else if (result.reason === "already-open") {
        renderBackgroundCheckStatus({ status: "skipped", reason: "already-open", lastCheckAt: Date.now() });
      } else if (result.reason === "collect-full-history-first") {
        renderBackgroundCheckStatus({ status: "failed", reason: "collect-full-history-first", lastCheckAt: Date.now() });
      } else if (result.reason === "not-eligible" || result.reason === "disabled") {
        renderBackgroundCheckStatus({ status: "failed", reason: "not-eligible", lastCheckAt: Date.now() });
      } else if (result.reason === "already-running") {
        backgroundCheckStatusElement.textContent = "Background check: Already running.";
      } else {
        backgroundCheckStatusElement.textContent = "Background check: Failed · could not start.";
      }
      return;
    }
    await refreshBackgroundCheckStatus();
  } catch {
    backgroundCheckStatusElement.textContent = "Background check: Failed · could not start.";
  } finally {
    backgroundCheckButton.disabled = !backgroundMonitoringCheckbox.checked;
  }
});

async function initializeDesktopNotificationSetting() {
  try {
    const stored = await chrome.storage.local.get(desktopNotificationsPreferenceKey);
    let enabled = stored[desktopNotificationsPreferenceKey] === true;
    if (enabled && !(await chrome.permissions.contains({ permissions: ["notifications"] }))) {
      enabled = false;
      await chrome.storage.local.set({ [desktopNotificationsPreferenceKey]: false });
    }
    desktopNotificationsCheckbox.checked = enabled;
    desktopNotificationsState.textContent = enabled ? "On" : "Off";
    testNotificationButton.disabled = !enabled;
  } catch {
    desktopNotificationsCheckbox.checked = false;
    desktopNotificationsState.textContent = "Off";
    testNotificationButton.disabled = true;
  }
}

desktopNotificationsCheckbox.addEventListener("change", async () => {
  desktopNotificationsCheckbox.disabled = true;
  desktopNotificationsHelp.hidden = true;
  try {
    if (desktopNotificationsCheckbox.checked) {
      const granted = await chrome.permissions.request({ permissions: ["notifications"] });
      if (!granted) {
        desktopNotificationsCheckbox.checked = false;
        desktopNotificationsState.textContent = "Off";
        desktopNotificationsHelp.textContent = "Notifications unavailable — permission was not granted.";
        desktopNotificationsHelp.hidden = false;
        testNotificationButton.disabled = true;
        await chrome.storage.local.set({ [desktopNotificationsPreferenceKey]: false });
        return;
      }
      await chrome.storage.local.set({ [desktopNotificationsPreferenceKey]: true });
      desktopNotificationsState.textContent = "On";
      testNotificationButton.disabled = false;
      desktopNotificationsHelp.hidden = true;
      return;
    }
    await chrome.storage.local.set({ [desktopNotificationsPreferenceKey]: false });
    desktopNotificationsState.textContent = "Off";
    testNotificationButton.disabled = true;
  } catch {
    desktopNotificationsCheckbox.checked = false;
    desktopNotificationsState.textContent = "Off";
    desktopNotificationsHelp.textContent = "Could not update desktop notification settings.";
    desktopNotificationsHelp.hidden = false;
    testNotificationButton.disabled = !desktopNotificationsCheckbox.checked;
  } finally {
    desktopNotificationsCheckbox.disabled = false;
  }
});

testNotificationButton.addEventListener("click", async () => {
  if (!desktopNotificationsCheckbox.checked || testNotificationButton.disabled) return;
  testNotificationButton.disabled = true;
  desktopNotificationsHelp.hidden = false;
  desktopNotificationsHelp.textContent = "Sending test notification…";
  try {
    const result = await chrome.runtime.sendMessage({ type: "gpt-limits:send-test-notification" });
    if (result?.ok) desktopNotificationsHelp.textContent = "Test notification sent.";
    else if (result?.reason === "permission-required" || result?.reason === "disabled") {
      desktopNotificationsCheckbox.checked = false;
      desktopNotificationsState.textContent = "Off";
      await chrome.storage.local.set({ [desktopNotificationsPreferenceKey]: false });
      desktopNotificationsHelp.textContent = "Notifications unavailable — permission was not granted.";
    } else desktopNotificationsHelp.textContent = "Could not send test notification.";
  } catch {
    desktopNotificationsHelp.textContent = "Could not send test notification.";
  } finally {
    testNotificationButton.disabled = !desktopNotificationsCheckbox.checked;
  }
});

resetButton.addEventListener("click", async () => {
  if (!activeTabId || !currentConversationId) return;
  resetButton.disabled = true;
  resetStatusElement.hidden = true;
  try {
    const result = await chrome.tabs.sendMessage(activeTabId, {
      type: "gpt-limits:reset-current-chat",
      conversationId: currentConversationId,
    });
    if (!result?.ok) throw new Error("Reset was not accepted");
    detailsElement.hidden = true;
    renderTrackedChats(result.chats);
    showHistoryCollection(result.historyCollection, null);
    statusElement.textContent = "";
    resetStatusElement.textContent = "Current chat data reset. Reload or scroll the chat to rebuild statistics.";
    resetStatusElement.hidden = false;
  } catch {
    resetStatusElement.textContent = "Could not reset current chat data. Reload the chat and try again.";
    resetStatusElement.hidden = false;
  } finally {
    resetButton.disabled = false;
  }
});

collectHistoryButton.addEventListener("click", async () => {
  if (!activeTabId || !currentConversationId) return;
  collectHistoryButton.disabled = true;
  try {
    const result = await chrome.tabs.sendMessage(activeTabId, {
      type: "gpt-limits:collect-full-history",
      conversationId: currentConversationId,
    });
    if (!result?.ok) throw new Error(result?.reason || "Collection was not accepted");
    showHistoryCollection(result.historyCollection, { hasPreviousPage: true, messagesCollected: result.historyCollection.messagesCollected });
  } catch (error) {
    historyCollectionStatus.textContent = error.message === "complete"
      ? "History is already complete."
      : "Could not start history collection for this chat.";
    historyCollectionStatus.hidden = false;
  } finally {
    collectHistoryButton.disabled = false;
  }
});

stopHistoryButton.addEventListener("click", async () => {
  if (!activeTabId || !currentConversationId) return;
  stopHistoryButton.disabled = true;
  try {
    const result = await chrome.tabs.sendMessage(activeTabId, {
      type: "gpt-limits:stop-history-collection",
      conversationId: currentConversationId,
    });
    if (result?.ok) showHistoryCollection(result.historyCollection, { hasPreviousPage: true, messagesCollected: result.historyCollection.messagesCollected });
  } finally {
    stopHistoryButton.disabled = false;
  }
});

trackedChatsElement.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-conversation-id]");
  if (!button) return;
  button.disabled = true;
  try {
    const isMonitorAction = button.classList.contains("tracked-action");
    if (!activeTabId) throw new Error("No active ChatGPT conversation");
    const result = await chrome.tabs.sendMessage(activeTabId, {
      type: isMonitorAction ? "gpt-limits:set-monitored" : "gpt-limits:remove-chat",
      conversationId: button.dataset.conversationId,
      ...(isMonitorAction ? { monitored: button.getAttribute("aria-pressed") !== "true" } : {}),
    });
    if (!result?.ok) throw new Error("Remove was not accepted");
    renderTrackedChats(result.chats);
    if (!isMonitorAction && button.dataset.conversationId === currentConversationId) {
      detailsElement.hidden = true;
      resetButton.hidden = true;
      statusElement.textContent = "Waiting for ChatGPT conversation response.";
    }
  } catch {
    button.disabled = false;
  }
});

calibrationCopyButton.addEventListener("click", async () => {
  calibrationCopyButton.disabled = true;
  calibrationCopyStatus.hidden = true;
  try {
    const text = calibrationSummary.exportText(trackedChats);
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        copyWithSelection(text);
      }
    } else {
      copyWithSelection(text);
    }
    calibrationCopyStatus.textContent = "Calibration summary copied.";
  } catch {
    calibrationCopyStatus.textContent = "Could not copy the calibration summary. Check clipboard access and try again.";
  } finally {
    calibrationCopyStatus.hidden = false;
    calibrationCopyButton.disabled = false;
  }
});

function copyWithSelection(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard copy command failed");
}

trackedChatsElement.addEventListener("change", async (event) => {
  const select = event.target.closest("select.tracked-calibration-select");
  if (!select || !select.value) return;
  select.disabled = true;
  try {
    const result = await chrome.tabs.sendMessage(activeTabId, {
      type: "gpt-limits:set-calibration-label",
      conversationId: select.dataset.conversationId,
      label: select.value === "clear" ? null : select.value,
    });
    if (!result?.ok) throw new Error("Calibration label was not accepted");
    renderTrackedChats(result.chats);
  } catch {
    select.disabled = false;
    select.value = "";
  }
});

document.getElementById("calibration-points").addEventListener("click", async (event) => {
  const button = event.target.closest("button.delete-calibration-point");
  if (!button) return;
  button.disabled = true;
  try {
    const result = await chrome.tabs.sendMessage(activeTabId, {
      type: "gpt-limits:delete-calibration-point",
      conversationId: button.dataset.conversationId,
      pointIndex: Number(button.dataset.pointIndex),
    });
    if (!result?.ok) throw new Error("Calibration point was not deleted");
    renderTrackedChats(result.chats);
  } catch {
    button.disabled = false;
  }
});

main();

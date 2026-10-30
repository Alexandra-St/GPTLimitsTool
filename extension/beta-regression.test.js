"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = __dirname;
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const aggregator = require("./aggregator.js");
const calibration = require("./calibration-summary.js");
const riskNotifications = require("./risk-notifications.js");

async function loadContent(storage) {
  let listener;
  const windowListeners = {};
  const window = {
    location: { origin: "https://chatgpt.com", pathname: "/c/beta-chat", href: "https://chatgpt.com/c/beta-chat" },
    crypto: { getRandomValues(bytes) { bytes.fill(7); return bytes; } },
    addEventListener(type, callback) { windowListeners[type] = callback; },
    postMessage() {},
  };
  const chrome = {
    storage: { local: {
      async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, storage[key]])); },
      async set(values) { Object.assign(storage, values); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]; },
    } },
    runtime: {
      onMessage: { addListener(callback) { listener = callback; } },
      async sendMessage() { return { active: false }; },
    },
  };
  vm.runInNewContext(read("content.js"), { window, chrome, globalThis: { GptLimitsAggregator: aggregator } });
  await new Promise((resolve) => setImmediate(resolve));
  const send = (message) => new Promise((resolve) => listener(message, {}, resolve));
  return { storage, send, windowListeners };
}

function loadWorker({ local = {}, session = {}, alarm = null, tabs = [] } = {}) {
  const messages = [];
  const removedTabs = [];
  const alarmListeners = [];
  const startupListeners = [];
  const installedListeners = [];
  const chrome = {
    runtime: {
      id: "beta-extension",
      onMessage: { addListener(callback) { messages.push(callback); } },
      onStartup: { addListener(callback) { startupListeners.push(callback); } },
      onInstalled: { addListener(callback) { installedListeners.push(callback); } },
      getURL: (name) => `chrome-extension://beta/${name}`,
    },
    storage: {
      local: {
        async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, local[key]])); },
        async set(values) { Object.assign(local, values); },
      },
      session: {
        async get(key) { return { [key]: session[key] }; },
        async set(values) { Object.assign(session, values); },
        async remove(key) { delete session[key]; },
      },
    },
    tabs: {
      onUpdated: { addListener() {} }, onRemoved: { addListener() {} },
      async query() { return tabs; },
      async get(id) { const tab = tabs.find((candidate) => candidate.id === id); if (!tab) throw new Error("missing tab"); return tab; },
      async remove(id) { removedTabs.push(id); },
      async create() { throw new Error("unexpected tab creation"); },
    },
    permissions: { async contains() { return true; }, onAdded: { addListener() {} }, onRemoved: { addListener() {} } },
    alarms: {
      onAlarm: { addListener(callback) { alarmListeners.push(callback); } },
      async create() {}, async clear() {}, async get() { return alarm; },
    },
  };
  vm.runInNewContext(read("background.js"), { chrome, GptRiskNotifications: riskNotifications, importScripts() {}, setTimeout, clearTimeout, URL, Date, Promise, Set, Number, Object, Array });
  return { local, session, removedTabs, startupListeners, installedListeners };
}

function calibrationChats() {
  const entry = (key, label, tokens) => ({
    calibrationSourceKey: key,
    calibrationPoints: [{ timestamp: 10, label, estimatedTextTokens: tokens, messagesCollected: tokens / 10, historyStatus: "Complete", images: 0, audio: 0, video: 0, otherAttachments: 0 }],
  });
  return [
    entry("src_0000000000000001", "normal", 1000), entry("src_0000000000000002", "normal", 2000),
    entry("src_0000000000000003", "limit_reached", 5000), entry("src_0000000000000004", "limit_reached", 6000),
  ];
}

test("beta 01: fresh install defaults notifications and background checks to off", async () => {
  const worker = loadWorker();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(worker.local.gptLimitsDesktopRiskNotifications, false);
  assert.equal(worker.local.gptLimitsBackgroundMonitoring, false);
  assert.equal(worker.local.gptLimitsAutomaticCheckInterval, "off");
});

test("beta 02: old chat records migrate missing source, notification, check, and calibration fields", async () => {
  const old = { conversationId: "beta-chat", title: "Old", processedMessageIds: ["m1"], attachments: {}, messagesCollected: 1, hasPreviousPage: true, mysteryText: "private text sentinel" };
  const { storage } = await loadContent({ gptLimitsChats: { "beta-chat": old } });
  const migrated = storage.gptLimitsChats["beta-chat"];
  assert.match(migrated.calibrationSourceKey, /^src_[a-f0-9]{16}$/);
  assert.equal(migrated.riskNotificationLevel, 0);
  assert.equal(migrated.lastAutomaticCheckAt, null);
  assert.equal(migrated.lastAutomaticCheckResult, null);
  assert.deepEqual(JSON.parse(JSON.stringify(migrated.calibrationPoints)), []);
  assert.equal(migrated.monitored, false);
  assert.equal(migrated.mysteryText, undefined);
});

test("beta 03: migration preserves existing calibration points and snapshots", async () => {
  const record = { conversationId: "beta-chat", processedMessageIds: [], attachments: {}, calibrationSourceKey: "src_1234567890abcdef", calibrationPoints: [{ label: "normal", timestamp: 4, estimatedTextTokens: 120, historyStatus: "Complete" }], calibrationSnapshots: [{ timestamp: 3, messagesCollected: 2, estimatedTextTokens: 20, historyStatus: "Partial" }] };
  const { storage } = await loadContent({ gptLimitsChats: { "beta-chat": record } });
  const migrated = storage.gptLimitsChats["beta-chat"];
  assert.equal(migrated.calibrationPoints.length, 1);
  assert.equal(migrated.calibrationPoints[0].sourceKey, record.calibrationSourceKey);
  assert.equal(migrated.calibrationSnapshots.length, 1);
});

test("beta 03b: single-chat legacy key preserves its calibration data during migration", async () => {
  const legacy = { conversationId: "beta-chat", title: "Legacy", processedMessageIds: [], attachments: {}, calibrationPoints: [{ label: "limit_reached", timestamp: 5, estimatedTextTokens: 500, historyStatus: "Complete" }], calibrationSnapshots: [{ timestamp: 4, messagesCollected: 5, estimatedTextTokens: 250, historyStatus: "Complete" }] };
  const { storage } = await loadContent({ gptLimitsCurrentConversation: legacy });
  const migrated = storage.gptLimitsChats["beta-chat"];
  assert.equal(migrated.calibrationPoints.length, 1);
  assert.equal(migrated.calibrationPoints[0].label, "limit_reached");
  assert.equal(migrated.calibrationSnapshots.length, 1);
  assert.equal(storage.gptLimitsCurrentConversation, undefined);
});

test("beta 04: malformed legacy fields receive safe defaults without crashing state reads", async () => {
  const record = { conversationId: "beta-chat", processedMessageIds: [null, "m1", "m1"], attachments: null, messagesCollected: -2, userMessages: null, estimatedTextTokens: "bad", hasPreviousPage: "yes", historyComplete: true };
  const instance = await loadContent({ gptLimitsChats: { "beta-chat": record } });
  const result = await instance.send({ type: "gpt-limits:get-current-state" });
  assert.deepEqual(JSON.parse(JSON.stringify(result.state.processedMessageIds)), ["m1"]);
  assert.equal(result.state.messagesCollected, 0);
  assert.equal(result.state.estimatedTextTokens, 0);
  assert.equal(result.state.attachments.images, 0);
  assert.equal(result.state.hasPreviousPage, null);
  assert.equal(result.state.historyComplete, false);
});

test("beta 05: extension reload retains monitored state and calibration metadata", async () => {
  const store = { gptLimitsChats: { "beta-chat": { conversationId: "beta-chat", title: "A", processedMessageIds: ["m1"], messagesCollected: 1, attachments: {}, monitored: true, calibrationSourceKey: "src_1234567890abcdef", calibrationPoints: [{ label: "near_limit", timestamp: 2, historyStatus: "Complete" }] } } };
  await loadContent(store);
  const afterReload = (await loadContent(store)).storage.gptLimitsChats["beta-chat"];
  assert.equal(afterReload.monitored, true);
  assert.equal(afterReload.messagesCollected, 1);
  assert.equal(afterReload.calibrationPoints.length, 1);
  assert.equal(afterReload.calibrationSourceKey, "src_1234567890abcdef");
});

test("beta 06: worker restore retains an existing alarm without launching a temporary tab", async () => {
  const existing = { name: "gptLimitsMonitoredChatScheduler", scheduledTime: Date.now() + 900000, periodInMinutes: 30 };
  const worker = loadWorker({ local: { gptLimitsAutomaticCheckInterval: "30", gptLimitsBackgroundMonitoring: true, gptLimitsDesktopRiskNotifications: true }, alarm: existing });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(worker.local.gptLimitsAutomaticSchedulerStatus.alarmExists, true);
  assert.equal(worker.local.gptLimitsAutomaticSchedulerStatus.nextScheduledTime, existing.scheduledTime);
  assert.equal(worker.local.gptLimitsAutomaticCheckInterval, "30");
  assert.equal(worker.local.gptLimitsBackgroundMonitoring, true);
  assert.equal(worker.local.gptLimitsDesktopRiskNotifications, true);
  assert.deepEqual(worker.removedTabs, []);
});

test("beta 06b: corrupted global settings and scheduler metadata migrate to safe Off/default values", async () => {
  const worker = loadWorker({ local: {
    gptLimitsAutomaticCheckInterval: "invalid",
    gptLimitsBackgroundMonitoring: "enabled",
    gptLimitsDesktopRiskNotifications: null,
    gptLimitsAutomaticSchedulerStatus: { enabled: "yes", alarmExists: "yes", nextScheduledTime: -2, lastTickAt: "bad", lastTickResult: "unknown", lastReason: { secret: true } },
  } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(worker.local.gptLimitsAutomaticCheckInterval, "off");
  assert.equal(worker.local.gptLimitsBackgroundMonitoring, false);
  assert.equal(worker.local.gptLimitsDesktopRiskNotifications, false);
  assert.equal(worker.local.gptLimitsAutomaticSchedulerStatus.enabled, false);
  assert.equal(worker.local.gptLimitsAutomaticSchedulerStatus.alarmExists, false);
  assert.equal(worker.local.gptLimitsAutomaticSchedulerStatus.nextScheduledTime, null);
  assert.equal(worker.local.gptLimitsAutomaticSchedulerStatus.lastTickAt, null);
  assert.equal(worker.local.gptLimitsAutomaticSchedulerStatus.lastTickResult, null);
  assert.equal(worker.local.gptLimitsAutomaticSchedulerStatus.lastReason, null);
});

test("beta 07: automatic schedule restore never invokes a tick as a startup side effect", async () => {
  const source = read("background.js");
  assert.match(source, /void restoreAutomaticCheckSchedule\(\);\s*void markInterruptedCheck\(\);/);
  assert.match(source, /Service worker activation \(including a reload\) restores the alarm but never runs a tick/);
  assert.doesNotMatch(source.slice(source.indexOf("async function restoreAutomaticCheckSchedule"), source.indexOf("async function updateAutomaticChatResult")), /runAutomaticSchedulerTick\(/);
});

test("beta 08: manual background check remains a user-triggered worker command", () => {
  assert.match(read("popup.js"), /gpt-limits:start-background-check/);
  assert.match(read("background.js"), /message\?\.type === "gpt-limits:start-background-check"/);
  assert.match(read("background.js"), /tabs\.create\(\{ url: "about:blank", active: false \}\)/);
});

test("beta 09: automatic tick processes one selected monitored source per cycle", () => {
  const source = read("background.js");
  assert.match(source, /async function runAutomaticSchedulerTick\(trigger = "alarm"\)/);
  assert.match(source, /eligible\.sort\(\(a, b\) =>/);
  assert.match(source, /const selected = eligible\[0\]/);
  assert.match(source, /startBackgroundCheck\(\{ automatic: true, selectedSourceKey:/);
});

test("beta 10: round-robin selector prioritizes chats never checked or least recently checked", () => {
  const source = read("background.js");
  assert.match(source, /Number\.isFinite\(a\.lastAutomaticCheckAt\) \? a\.lastAutomaticCheckAt : -Infinity/);
  assert.match(source, /aTime - bTime/);
});

test("beta 11: test notification command uses the fixed Chrome notification payload only", () => {
  const source = read("background.js");
  const section = source.slice(source.indexOf('message?.type === "gpt-limits:send-test-notification"'), source.indexOf('message?.type !== "gpt-limits:show-risk-notification"'));
  assert.match(section, /chrome\.notifications\.create/);
  assert.match(section, /GPT Limits — Test notification/);
  assert.match(section, /Desktop risk notifications are working\./);
  assert.doesNotMatch(section, /riskNotificationLevel|calibration|gptLimitsChats/);
});

test("beta 12: actual risk notification dedup still only permits upward crossings once", () => {
  const model = calibration.buildRiskModel(calibrationChats());
  const assess = calibration.assessRisk;
  const previous = { estimatedTextTokens: 1000, historyStatus: "Complete" };
  const watch = riskNotifications.crossing(previous, { estimatedTextTokens: 3000, historyStatus: "Complete" }, model, 0, assess);
  assert.equal(watch.level, "Watch");
  assert.equal(riskNotifications.crossing(previous, { estimatedTextTokens: 3000, historyStatus: "Complete" }, model, watch.rank, assess), null);
});

test("beta 13: Reset command targets only the current conversation record", () => {
  const source = read("content.js");
  assert.match(source, /requestedId !== activeConversationId\(\) \|\| !chats\[requestedId\]/);
  assert.match(source, /chats\[requestedId\] = aggregator\.emptyState/);
  assert.match(source, /chats\[requestedId\]\.riskNotificationLevel = 0/);
});

test("beta 14: Remove command deletes only the requested tracked record", () => {
  const source = read("content.js");
  assert.match(source, /delete chats\[requestedId\]/);
  assert.doesNotMatch(source, /chats = \{\};[\s\S]{0,100}remove-chat/);
});

test("beta 15: full-history collection remains explicitly user-triggered and current-chat scoped", () => {
  const source = read("content.js");
  assert.match(source, /message\?\.type === "gpt-limits:collect-full-history"/);
  assert.match(source, /requestedId !== activeConversationId\(\)/);
  assert.match(source, /message\?\.type === "gpt-limits:stop-history-collection"/);
});

test("beta 16: calibration labeling and point history remain manual and bounded", () => {
  const source = read("content.js");
  assert.match(source, /message\?\.type === "gpt-limits:set-calibration-label"/);
  assert.match(source, /state\.calibrationPoints\.push\(point\)/);
  assert.match(source, /state\.calibrationPoints\.length > 20/);
  assert.match(source, /message\?\.type === "gpt-limits:delete-calibration-point"/);
});

test("beta 17: partial history risk is displayed only as a lower bound or Unknown", () => {
  const model = calibration.buildRiskModel(calibrationChats());
  assert.equal(calibration.assessRisk(model, model.watchThreshold, "Partial").level, "at-least-watch");
  assert.equal(calibration.assessRisk(model, 0, "Partial").level, "unknown");
});

test("beta 18: complete history risk keeps the Normal, Watch, Near limit, and Critical labels", () => {
  const model = calibration.buildRiskModel(calibrationChats());
  assert.equal(calibration.assessRisk(model, 0, "Complete").level, "normal");
  assert.equal(calibration.assessRisk(model, model.watchThreshold, "Complete").level, "watch");
  assert.equal(calibration.assessRisk(model, model.nearLimitThreshold, "Complete").level, "near-limit");
  assert.equal(calibration.assessRisk(model, model.criticalThreshold, "Complete").level, "critical");
});

test("beta 19: optional permissions remain gated and absent permissions are safe", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.deepEqual(manifest.optional_permissions, ["notifications", "alarms"]);
  assert.deepEqual(manifest.permissions, ["storage"]);
  const background = read("background.js");
  assert.match(background, /hasAlarmsPermission/);
  assert.match(background, /permission-required/);
});

test("beta 20: lost worker session cleanup removes only its recorded temporary tab", async () => {
  const id = 93;
  const worker = loadWorker({
    local: { gptLimitsBackgroundCheckStatus: { status: "running", temporaryTabId: id } },
    session: {},
    tabs: [{ id, url: "https://chatgpt.com/c/stale-temporary" }, { id: 94, url: "https://chatgpt.com/c/user-tab" }],
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(worker.removedTabs, [id]);
  assert.equal(worker.local.gptLimitsBackgroundCheckStatus.status, "failed");
});

test("beta 21: stored aggregates use an allowlist and never retain message text", async () => {
  const record = { conversationId: "beta-chat", title: "A", processedMessageIds: ["m1"], messagesCollected: 1, attachments: {}, messageText: "must not persist" };
  const { storage } = await loadContent({ gptLimitsChats: { "beta-chat": record } });
  assert.equal(storage.gptLimitsChats["beta-chat"].messageText, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(storage.gptLimitsChats["beta-chat"].processedMessageIds)), ["m1"]);
});

test("beta 22: calibration export contains no conversation IDs or message IDs", () => {
  const exported = calibration.exportText([{ conversationId: "secret-conversation", title: "Example", calibrationSourceKey: "src_0000000000000001", calibrationPoints: [{ sourceKey: "src_0000000000000001", label: "normal", timestamp: 1, messagesCollected: 2, estimatedTextTokens: 20, historyStatus: "Complete", images: 0, audio: 0, video: 0, otherAttachments: 0, messageIds: ["secret-message"] }] }]);
  assert.equal(exported.includes("secret-conversation"), false);
  assert.equal(exported.includes("secret-message"), false);
});

test("beta 23: implementation makes no owned fetch calls to ChatGPT API", () => {
  for (const file of ["background.js", "content.js", "history-collector.js", "page-hook.js"]) assert.doesNotMatch(read(file), /\bfetch\s*\(/, `${file} should not issue network fetches`);
});

test("beta 24: permissions are minimal and UI uses the beta product name", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.name, "GPT Limits Tool");
  assert.equal(manifest.host_permissions.includes("https://chatgpt.com/*"), true);
  assert.equal(manifest.permissions.includes("activeTab"), false);
  assert.equal(read("popup.html").includes("Research Capture"), false);
});

test("beta 25: calibration labels and research controls are collapsed by default", () => {
  const html = read("popup.html");
  assert.match(html, /<details id="calibration-details">\s*<summary>Calibration<\/summary>/);
  assert.match(html, /id="calibration-summary-section"[^>]*hidden/);
  assert.match(html, /id="copy-calibration-summary"/);
  assert.match(html, /id="calibration-points"/);
});

test("beta 26: privacy copy states local aggregate and message text policy", () => {
  assert.match(read("popup.html"), /GPT Limits Tool stores local aggregate counts and message IDs for deduplication\. Message text is not stored\./);
  const readme = read("../README.md");
  for (const phrase of ["No paid API is used", "do not make their own undocumented ChatGPT API requests", "do not extract cookies, tokens, or passwords", "does not store message text", "runs locally"]) assert.ok(readme.includes(phrase), `README includes ${phrase}`);
});


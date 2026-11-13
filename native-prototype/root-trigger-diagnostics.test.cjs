const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = fs.readFileSync(path.join(__dirname, 'CycleEngine.swift'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'Main.swift'), 'utf8');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

test('root trigger milestones use a monotonic clock and a fixed privacy-safe allowlist', () => {
  const recorder = engine.slice(engine.indexOf('func recordCycleRootTriggerMilestone'), engine.indexOf('func migrateBundleIdentityDefaultsAtStartup'));
  assert.match(recorder, /ProcessInfo\.processInfo\.systemUptime/);
  assert.match(recorder, /allowed\.contains\(name\)/);
  assert.doesNotMatch(recorder, /title|conversationID|messageText|rawURL|headers/i);
});

test('same-route and actual navigation are reported independently', () => {
  assert.match(engine, /cycleRootRouteBefore=safeNavigationRouteTemplate\(web\.url\)/);
  assert.ok(engine.includes('already on home \\(cycleRootRouteBefore=="/" ? "yes":"no")'));
  assert.ok(engine.includes('document generation changed \\(documentGenerationChanged)'));
  assert.match(main, /recordCycleRootTriggerMilestone\("navigation_started"\)/);
  assert.match(main, /recordCycleRootTriggerMilestone\("navigation_finished"\)/);
});

test('hook readiness and observation arming are acknowledged before request milestones', () => {
  const handler = main.slice(main.indexOf('if event=="root_hook_health"'), main.indexOf('if event=="rate_limit"'));
  assert.match(handler, /rootListHookInstalled/);
  assert.match(handler, /hook_ready_acknowledged/);
  assert.match(handler, /bridgeReady/);
  assert.match(handler, /bridge_ready/);
  assert.match(handler, /generationAttached/);
  assert.match(handler, /root_observation_armed/);
  assert.match(main, /recordFirstRootListRequestMilestone\(data\)/);
  assert.doesNotMatch(main, /cycleRootRequests==1 \{recordCycleRootTriggerMilestone\("first_root_list_request"\)\}/);
});

test('first root scroll request and execution are recorded without changing the scroll call', () => {
  const loop = engine.slice(engine.indexOf('while cycleRootNavigation != nil'), engine.indexOf('// One bounded retry of the existing home navigation'));
  assert.match(loop, /reason=="initial" \{recordCycleRootTriggerMilestone\("initial_sidebar_scroll_requested"\)\}/);
  assert.match(loop, /let scrollResult=try\? await evaluateForCycle\(script\)/);
  assert.match(loop, /reason=="initial",scrollResult != nil \{recordCycleRootTriggerMilestone\("initial_sidebar_scroll_executed"\)\}/);
  assert.match(loop, /window\.gptDiagnoseRootScrollOwner\?\.\(\{sequence:/);
  assert.ok(engine.includes('owner-found \\(entry["selectedOwner"] is [String:Any]'));
  assert.ok(engine.includes('owner-moved \\(ownerMoved)'));
  assert.ok(engine.includes('rows visible \\(rowsBefore["visible"]'));
});

test('trigger timeline exposes only bounded milestone labels and sanitized route templates', () => {
  assert.match(engine, /cycleRootTriggerMilestones\.count<40/);
  assert.match(engine, /Root trigger milestones:/);
  assert.ok(engine.includes('cycleRootTriggerMilestones.map{"+\\($0.elapsedMs)ms \\($0.name)"}'));
  assert.match(engine, /safeNavigationRouteTemplate/);
  assert.doesNotMatch(engine, /cycleRootTriggerMilestones\.append\([^\n]*(title|conversationID|message)/i);
});

test('README starts with the active-development pre-beta warning',()=>{
  assert.match(readme,/^> ⚠️ \*\*Status: active development \/ pre-beta\*\*/);
  assert.match(readme,/not yet production-ready[\s\S]*incomplete or inaccurate[\s\S]*Do not rely on the tool as an authoritative source/);
});

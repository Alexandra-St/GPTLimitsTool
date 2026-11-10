const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = __dirname;
const source = fs.readFileSync(path.join(root, 'conversation-history-diagnostic.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'Main.swift'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'CycleEngine.swift'), 'utf8');
const model = fs.readFileSync(path.join(root, 'CycleModel.swift'), 'utf8');
const build = fs.readFileSync(path.join(root, 'build.sh'), 'utf8');

function fixture({rows = [], pathname = '/c/private-chat-id', fetchImpl = null} = {}) {
  const makeNode = ({tag = 'DIV', attrs = {}, children = [], visible = true, height = 40, top = 10, shadowRoot = null, text = 'PRIVATE MESSAGE TEXT'} = {}) => ({
    nodeType: 1,
    tagName: tag,
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    children,
    parentElement: null,
    shadowRoot,
    clientHeight: 100,
    clientWidth: 300,
    overflowY: 'hidden',
    scrollHeight: 300,
    scrollWidth: 300,
    getAttribute(name) { return Object.hasOwn(attrs, name) ? attrs[name] : null; },
    getBoundingClientRect() { return visible ? { width: 200, height, top, bottom: top + height, right: 200 } : { width: 0, height: 0, top, bottom: top, right: 0 }; },
    querySelectorAll() { return children; },
    get textContent() { throw new Error('diagnostic must never inspect textContent'); },
  });
  const rootNode = makeNode({ tag: 'MAIN', attrs: { role: 'main' }, children: rows });
  rootNode.overflowY = 'auto';
  const attach = (node, parent = null) => { node.parentElement = parent; for (const child of node.children || []) attach(child, node); };
  attach(rootNode);
  const clockStart = Date.now();
  const performance = { now: () => Date.now() - clockStart, getEntriesByType: () => [] };
  const window = { fetch: fetchImpl || (() => Promise.resolve({ status: 200, clone() { return { json: async () => ({ messages: [] }) }; } })) };
  class PerformanceObserver { observe() {} disconnect() {} }
  const document = {
    body: rootNode,
    querySelector(selector) { return selector === 'main' || selector === 'main,[role="main"]' ? rootNode : null; },
    createTreeWalker(node) { const nodes = []; const visit = current => { for (const child of current.children || []) { nodes.push(child); visit(child); } }; visit(node); let index = 0; return { nextNode() { return nodes[index++] || null; } }; },
  };
  const context = { window, document, location: { origin: 'https://chatgpt.com', href: `https://chatgpt.com${pathname}?private=query`, pathname }, performance, PerformanceObserver, URL, WeakMap, setTimeout, clearTimeout, Promise, console, getComputedStyle: node => ({ overflowY: node.overflowY || 'hidden', display: 'block', visibility: 'visible', opacity: '1' }) };
  window.XMLHttpRequest = undefined;
  vm.runInNewContext(source, context);
  return { window, rootNode, makeNode };
}

test('message DOM structure snapshot aggregates safe shapes, repeated vertical candidates and open shadow roots', () => {
  const page = fixture({ rows: [] });
  const rowA = page.makeNode({ tag: 'DIV', attrs: { 'data-private-id': 'message-secret-1', 'aria-label': 'PRIVATE LABEL' }, height: 120, top: 20 });
  const rowB = page.makeNode({ tag: 'DIV', attrs: { 'data-private-id': 'message-secret-2', 'aria-label': 'PRIVATE LABEL' }, height: 120, top: 160 });
  const shadowChild = page.makeNode({ tag: 'ARTICLE', attrs: { 'data-turn-private': 'private-turn-value', role: 'article' }, height: 100, top: 300 });
  const shadowHost = page.makeNode({ tag: 'SECTION', attrs: { 'data-testid': 'private-test-id' }, children: [], shadowRoot: { children: [shadowChild] } });
  page.rootNode.children.push(rowA, rowB, shadowHost);
  rowA.parentElement = page.rootNode; rowB.parentElement = page.rootNode; shadowHost.parentElement = page.rootNode; shadowChild.parentElement = shadowHost;
  const result = page.window.gptInspectCurrentMessageDOMStructure({ maxNodes: 100, maxDepth: 8, maxMs: 500 });
  assert.equal(result.result, 'success');
  assert.equal(result.scannedNodeCount, 5);
  assert.equal(result.openShadowRootCount, 1);
  assert.equal(result.repeatGroupCount >= 1, true);
  assert.equal(result.verticalRepeatGroupCount >= 1, true);
  assert.equal(result.candidateElementCount >= 2, true);
  assert.equal(result.markerCounts.testId, 1);
  assert.equal(result.markerCounts.turn, 1);
  assert.ok(result.signatures.some(s => s.verticalRepeatCount >= 2));
  const encoded = JSON.stringify(result);
  for (const privateValue of ['private-chat-id', 'private=query', 'PRIVATE MESSAGE TEXT', 'PRIVATE LABEL', 'message-secret-1', 'message-secret-2', 'private-turn-value', 'private-test-id', 'https://']) assert.equal(encoded.includes(privateValue), false);
  assert.ok(result.dataAttributeNames.includes('data-private-id'));
  assert.ok(result.ariaAttributeNames.includes('aria-label'));
});

test('message DOM structure handles an empty conversation and enforces node/depth bounds', () => {
  const empty = fixture({ rows: [] });
  const result = empty.window.gptInspectCurrentMessageDOMStructure({ maxNodes: 100 });
  assert.equal(result.result, 'success');
  assert.equal(result.reason, 'empty_conversation_container');
  assert.equal(result.scannedNodeCount, 1);
  assert.equal(result.candidateElementCount, 0);

  let current = empty.makeNode({ tag: 'DIV' });
  const chain = current;
  for (let i = 0; i < 140; i++) { const child = empty.makeNode({ tag: 'DIV' }); current.children.push(child); child.parentElement = current; current = child; }
  empty.rootNode.children.push(chain); chain.parentElement = empty.rootNode;
  const bounded = empty.window.gptInspectCurrentMessageDOMStructure({ maxNodes: 100, maxDepth: 3, maxMs: 500 });
  assert.equal(bounded.scannedNodeCount <= 100, true);
  assert.equal(bounded.truncated, true);
});

test('conversation inspection is bounded and recognizes existing turn candidates without reading text', async () => {
  const row = fixture({ rows: [] });
  const turn = row.makeNode({ tag: 'ARTICLE', attrs: { 'data-message-author-role': 'user', 'data-testid': 'conversation-turn-3', 'data-private-id': 'never-return' } });
  row.rootNode.children.push(turn);
  const start = Date.now();
  const result = await row.window.gptInspectCurrentChatHistorySource({ durationMs: 100, maxNodes: 100 });
  assert.ok(Date.now() - start < 1000);
  assert.equal(result.result, 'success');
  assert.equal(result.dom.candidateCount, 1);
  assert.equal(result.dom.visibleCandidateCount, 1);
  assert.equal(result.dom.userAssistantMarkerPresent, true);
  assert.equal(result.dom.shapes[0].tag, 'article');
  assert.ok(result.dom.markerAttributeNames.includes('data-message-author-role'));
  assert.equal(result.reason, 'history_present_in_dom_without_network');
  const encoded = JSON.stringify(result);
  for (const privateValue of ['private-chat-id', 'private=query', 'PRIVATE MESSAGE TEXT', 'never-return', 'conversation-turn-3', 'https://']) assert.equal(encoded.includes(privateValue), false);
});

test('empty conversation DOM returns a safe not-loaded result', async () => {
  const page = fixture({ rows: [] });
  const result = await page.window.gptInspectCurrentChatHistorySource({ durationMs: 100 });
  assert.equal(result.dom.candidateCount, 0);
  assert.equal(result.dom.visibleCandidateCount, 0);
  assert.equal(result.reason, 'history_not_loaded');
});

test('network observation returns normalized templates, schema keys and rejection reason only', async () => {
  const page = fixture();
  setTimeout(() => {
    page.window.fetch('https://chatgpt.com/backend-api/conversations/opaque-conversation-id/messages?cursor=private-cursor');
  }, 20);
  const result = await page.window.gptInspectCurrentChatHistorySource({ durationMs: 150 });
  assert.equal(result.requestCount, 1);
  assert.equal(result.responseCount, 1);
  const response = result.network.find(item => item.status === 200);
  assert.equal(response.endpointTemplate, '/backend-api/conversations/:id/messages');
  assert.equal(response.transport, 'fetch');
  assert.deepEqual(Array.from(response.topLevelKeys), ['messages']);
  assert.equal(response.arrayCounts[0].count, 0);
  assert.equal(response.recognizedHistory, true);
  const encoded = JSON.stringify(result);
  for (const privateValue of ['opaque-conversation-id', 'private-cursor', 'private=query', 'https://']) assert.equal(encoded.includes(privateValue), false);
});

test('unexpected history endpoint and changed response shape are distinguished', async () => {
  const changedEndpoint = fixture({ fetchImpl: () => Promise.resolve({ status: 200, clone() { return { json: async () => ({ payload: 'private' }) }; } }) });
  setTimeout(() => changedEndpoint.window.fetch('https://chatgpt.com/backend-api/history/private-slug'), 20);
  const endpointResult = await changedEndpoint.window.gptInspectCurrentChatHistorySource({ durationMs: 150 });
  assert.equal(endpointResult.reason, 'history_network_endpoint_changed');
  assert.equal(endpointResult.network.find(event => event.status === 200).parserRejectionReason, 'unrecognized_payload_shape');

  const changedShape = fixture({ fetchImpl: () => Promise.resolve({ status: 200, clone() { return { json: async () => ({ unexpected: [] }) }; } }) });
  setTimeout(() => changedShape.window.fetch('https://chatgpt.com/backend-api/conversations/private-id/messages'), 20);
  const shapeResult = await changedShape.window.gptInspectCurrentChatHistorySource({ durationMs: 150 });
  assert.equal(shapeResult.reason, 'history_response_shape_changed');
});

test('non-chat route is rejected and the network capture has a hard maximum window', async () => {
  const notChat = fixture({ pathname: '/' });
  assert.equal((await notChat.window.gptInspectCurrentChatHistorySource({ durationMs: 100 })).reason, 'not_chat_route');
  const bounded = fixture();
  const start = Date.now();
  await bounded.window.gptInspectCurrentChatHistorySource({ durationMs: 60000 });
  assert.ok(Date.now() - start < 7000);
});

test('Diagnostics starts with compact current-cycle summary and keeps raw telemetry collapsible below', () => {
  assert.match(main, /group\("Current cycle summary"/);
  const summary=main.slice(main.indexOf('group("Current cycle summary"'),main.indexOf('let rawToggle=button("Show raw diagnostics"'));
  assert.doesNotMatch(summary, /Inspect current chat history source|Inspect current message DOM structure|conversationHistoryDiagnosticOutput|messageDOMStructureDiagnosticOutput/);
  assert.doesNotMatch(main, /group\("Discovery diagnostics"[^\n]*(Inspect recent-chat list traffic|Inspect sidebar element structure)/);
  assert.match(main, /gptInspectCurrentMessageDOMStructure/);
  assert.match(main, /renderCurrentMessageDOMStructureDiagnostic/);
  assert.match(main, /rawStack\.addArrangedSubview\(uiLabel\("Raw diagnostics"/);
  assert.match(main, /rawStack\.isHidden = !rawDiagnosticsVisible/);
  assert.match(main, /func toggleRawDiagnostics\(\)[\s\S]*rawDiagnosticsStack\?\.isHidden = !rawDiagnosticsVisible[\s\S]*layoutDiagnosticsDocument\(\)/);
  assert.match(main, /func updateCurrentCycleSummary\(\)[\s\S]*Discovery source:[\s\S]*Coverage:[\s\S]*Last render readiness:[\s\S]*Last chat check trace stages:/);
  assert.match(main, /let historyParsing=cycleState\.lastHistoryResponseParsing\?\.summary/);
  assert.match(main, /Per-chat history diagnostics:/);
  assert.match(main, /let perChatDetails=perChatDiagnostics\?\.detailedResponseSummary/);
  assert.match(main, /perChatHistoryRawOutput/);
  assert.match(model, /struct PerChatHistoryDiagnostic:Codable,Equatable/);
  assert.match(model, /responseEntries\.count>20/);
  assert.match(model, /mutating func beginPerChatHistoryDiagnostic\(ordinal:Int\)/);
  assert.match(model, /mutating func finishPerChatHistoryDiagnostic\(terminal:String,telemetry:ChatCheckStageTelemetry\?\)/);
  assert.doesNotMatch(model.slice(model.indexOf('struct PerChatHistoryDiagnostic:'), model.indexOf('struct PerChatHistoryDiagnostics:')), /conversationId|title|rawURL|responseBody|messageText/);
  assert.match(engine, /cycleState\.perChatHistoryDiagnostics=PerChatHistoryDiagnostics\(\)/);
  assert.match(engine, /cycleState\.beginPerChatHistoryDiagnostic\(ordinal:cycleCurrentChatCheckOrdinal\)/);
  assert.match(engine, /cycleState\.recordObservedHistoryRequest\(\)/);
  assert.match(engine, /cycleState\.finishPerChatHistoryDiagnostic\(terminal:terminal,telemetry:chatCheckTelemetry\)/);
  assert.match(engine, /updateCurrentCycleSummary\(\);chatCheckBudgetController=nil/);
  assert.match(engine, /recordChatCheckHistoryResponseParsing[\s\S]*checkProgress\.observeParsedResponse\(entry\)[\s\S]*recordHistoryResponseParsing\(entry\)[\s\S]*observePerChatHistoryDiagnostic\(telemetry\)[\s\S]*saveCycle\(\)/);
  assert.match(engine, /recordChatCheckActivity[\s\S]*recordObservedHistoryResponse\(\)/);
  assert.match(fs.readFileSync(path.join(root, 'CycleModel.swift'), 'utf8'), /entries\.count>20/);
  assert.match(fs.readFileSync(path.join(root, 'automation-bridge.js'), 'utf8'), /history_response_parse_diagnostic[\s\S]*pageUpdateCallbackFired/);
  assert.match(build, /page-hook\.js/);
  assert.match(fs.readFileSync(path.join(root, 'CycleModel.swift'), 'utf8'), /History response parsing: observed/);
  assert.match(main, /cycleState\.lastChatCheckTrace\?\.events\.map\{\$0\.stage\.rawValue\}/);
  for (const raw of ['runtimeIdentityOutput', 'mainWindowLifecycleOutput', 'windowOrderingProbeOutput', 'cycleOutput']) assert.match(main, new RegExp(`rawStack\\.addArrangedSubview\\(group\\([\\s\\S]*?${raw}`));
  assert.match(build, /conversation-history-diagnostic\.js/);
  assert.match(engine, /updateCurrentCycleSummary\(\)/);
  assert.match(main, /manualDiagnosticOwnerLabel\(\)==nil[\s\S]*sanitizedChatCheckRoute\(web\.url\)\.category == \.chat/);
  assert.doesNotMatch(main.slice(main.indexOf('func inspectCurrentChatHistorySource()'), main.indexOf('func renderCurrentChatHistoryDiagnostic')), /runCycle\(|checkRecord\(|load\(URLRequest/);
});

test('Task 11 pure formatter renders runtime maintenance values and safe report provenance',()=>{
 const source=main.match(/func formatMaintenanceDiagnostics\(lastStatus:String,chatCheckReports:\[String\]\)->\(counters:String,admission:String\) \{[\s\S]*?\n\}/)?.[0];
 assert.ok(source,'pure formatter exists');
 const swift=spawnSync('swift',['-e',`import Foundation\n${source}\nlet report="Chat 4: Partial · eligibility reason stale_incomplete_maintenance · safe report"\nprint(formatMaintenanceDiagnostics(lastStatus:"Stale incomplete maintenance: eligible 4 · admitted 3 · deferred by cap 1",chatCheckReports:[report]).counters)\nprint(formatMaintenanceDiagnostics(lastStatus:"Stale incomplete maintenance: eligible 4 · admitted 3 · deferred by cap 1",chatCheckReports:[report]).admission)\nprint(formatMaintenanceDiagnostics(lastStatus:"Stale incomplete maintenance: eligible 0 · admitted 0 · deferred by cap 0",chatCheckReports:[]).counters)\nprint(formatMaintenanceDiagnostics(lastStatus:"Stale incomplete maintenance: eligible 0 · admitted 0 · deferred by cap 0",chatCheckReports:[]).admission)`],{encoding:'utf8'});
 assert.equal(swift.status,0,swift.stderr);
 assert.match(swift.stdout,/eligible: 4 · admitted: 3 · deferred by cap: 1/);
 assert.match(swift.stdout,/stale_incomplete_maintenance/);
 assert.match(swift.stdout,/eligible: 0 · admitted: 0 · deferred by cap: 0/);
 assert.match(swift.stdout,/Per-chat admission provenance: unavailable/);
 for(const sentinel of ['private-chat-id','Private title','https://secret.invalid']) assert.equal(swift.stdout.includes(sentinel),false);
 const cycleState=model.slice(model.indexOf('struct CycleState: Codable'),model.indexOf('let nativeCycleStateDefaultsKey'));
 assert.doesNotMatch(cycleState,/admissionProvenance|maintenanceAdmission|chatCheckReports/);
});

test('per-chat completion diagnostics follow the accepted response through proof, terminal, and persistence', () => {
  assert.match(engine, /if update\.state\.historyComplete[\s\S]*recordCompletionProof\(\)[\s\S]*recordPerChatCompletionDecision\(candidate:true,accepted:true,reason:"none"/);
  assert.match(engine, /recordPerChatPersistedAggregate\(saved\.aggregate\)[\s\S]*finishPerChatHistoryDiagnostic\(terminal:terminal/);
  assert.match(model, /no_accepted_history_response[\s\S]*aggregate_empty[\s\S]*has_previous_page_true[\s\S]*has_previous_page_unknown[\s\S]*terminal_false_page_observed[\s\S]*completion_set_but_lost_before_persist/);
  assert.match(model, /accepted history responses[\s\S]*endpoint categories[\s\S]*aggregate messages at decision[\s\S]*persisted historyComplete[\s\S]*persisted hasPreviousPage/);
  assert.match(main, /Per-chat history diagnostics:[\s\S]*perChatSummary/);
  assert.match(model, /responseEntries\.count>20/);
});

test('an already-open Diagnostics window refreshes one cycle snapshot after cycle completion', () => {
  const cycle=engine.slice(engine.indexOf('cycleTask=Task { @MainActor in'),engine.indexOf('// One read-only prefix pass per cycle'));
  const refresh=main.slice(main.indexOf('func updateCurrentCycleSummary()'),main.indexOf('@objc func toggleRawDiagnostics()'));
  assert.match(cycle,/defer \{[\s\S]*saveCycle\(\);scheduleCycle\(\);renderCycle\(\)/);
  assert.match(cycle,/let summary=CycleChatOutcomeCounts\(finalPerChatResults:cycleChatTerminalResults/);
  assert.match(cycle,/cycleState\.lastStatus="Last cycle:[\s\S]*Skipped unchanged:/);
  assert.match(engine,/func renderCycle\(\)[\s\S]*updateCurrentCycleSummary\(\)/);
  assert.match(refresh,/let perChatDiagnostics=cycleState\.perChatHistoryDiagnostics[\s\S]*let perChatSummary=perChatDiagnostics\?\.summary[\s\S]*let perChatDetails=perChatDiagnostics\?\.detailedResponseSummary[\s\S]*perChatHistoryRawOutput\.stringValue=[\s\S]*currentCycleSummaryOutput\.stringValue=/);
  assert.match(refresh,/let checkedLine=line\("Checked:"\)/);
  assert.match(cycle,/cycleState\.finishPerChatHistoryDiagnostic\(terminal:terminal,telemetry:chatCheckTelemetry\)[\s\S]*cycleState\.records\[record\.conversationId\]=saved;[\s\S]*saveCycle\(\)/);
  assert.match(model,/func needsAttentionActionable\(record:ChatRecord/); // state selection remains in the existing display predicate
});

test('current chat persisted-record diagnostic matches only the route ID and is read-only and private',()=>{
  const helper=model.slice(model.indexOf('struct PersistedChatRecordDiagnostic:'),model.indexOf('func notificationAuditStatus'));
  const action=main.slice(main.indexOf('func inspectCurrentChatPersistedRecord()'),main.indexOf('func inspectCurrentMessageDOMStructure()'));
  assert.match(main,/Inspect current chat persisted record/);
  assert.match(action,/let safeRoute=sanitizedChatCheckRoute\(web\.url\)[\s\S]*safeRoute\.category == \.chat/);
  assert.match(action,/let routeID=conversationID\(in:web\.url\)/);
  assert.match(action,/persistedChatRecordDiagnostic\(routeConversationID:routeID,state:cycleState,model:currentRiskModel\(\)\)/);
  assert.doesNotMatch(action,/runCycle\(|checkRecord\(|saveCycle\(|load\(URLRequest/);
  assert.match(helper,/state\.records\[routeConversationID\],record\.conversationId==routeConversationID/);
  assert.match(helper,/record_not_present/);
  assert.match(helper,/route_id_unavailable/);
  assert.match(helper,/state_not_loaded/);
  assert.match(helper,/state\.notificationAudit/);
  assert.match(helper,/record\.lastNotifiedRiskRank/);
  assert.match(helper,/measurement|riskCategory|tokenLowerBound|messageLowerBound|historyComplete|hasPreviousPage|lastCheckAt|activityState|betaRiskCategory|priorWatchNearCritical/);
  assert.doesNotMatch(helper,/print\(|FileHandle|UserDefaults|conversationId:.*displayText|title:.*displayText|rawURL|messageText/);
});

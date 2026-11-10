const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const engine = fs.readFileSync(path.join(__dirname, 'CycleEngine.swift'), 'utf8');
const model = fs.readFileSync(path.join(__dirname, 'CycleModel.swift'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'Main.swift'), 'utf8');
const activityHook = fs.readFileSync(path.join(__dirname, 'activity-hook.js'), 'utf8');
const listHook = fs.readFileSync(path.join(__dirname, 'list-hook.js'), 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing source marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test('every cycle begins with fresh ChatGPT home discovery regardless of cached chats', () => {
  const start = section(engine, 'func startCycle(trigger:String)', 'func checkRecord(');
  assert.match(start, /let home=URL\(string:"https:\/\/chatgpt\.com\/"\)!/);
  assert.match(start, /web\.load\(URLRequest\(url:home\)\)/);
  assert.ok(start.indexOf('web.load(URLRequest(url:home))') < start.indexOf('let recent='));
  assert.doesNotMatch(start, /cached|cache|backoff/);
  assert.match(model, /let scheduledDiscoveryInterval: TimeInterval = 30 \* 60/);
});

test('sidebar scroll mechanics readiness is native-driven, compares semantic snapshots, and is serial',()=>{
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const action=section(main,'@objc func inspectSidebarScrollMechanics()','@objc func diagnoseVisiblePinnedRows()');
 assert.match(action,/DispatchTime\.now\(\)\.uptimeNanoseconds/);assert.match(action,/phase A 4000ms/);assert.match(action,/requestSidebarScrollReadinessPoll/);assert.match(action,/Task \{ @MainActor/);assert.match(action,/min\(100_000_000,remaining\)/);assert.match(action,/nativeGuardFired/);
 assert.match(action,/gptSampleSidebarScrollReadiness/);assert.doesNotMatch(action,/readinessBudgetMs|gptInspectSidebarScrollMechanics\?\.\(\{operationToken:.*readinessTimeoutMs/);
 assert.match(main,/gptInspectSidebarScrollMechanics/);assert.match(main,/sidebarScrollReadinessPollCount/);
 const diagnostic=section(bridge,'window.gptSampleSidebarScrollReadiness=',' const intersects=');
 assert.match(diagnostic,/window\.gptSampleSidebarScrollReadiness/);assert.match(diagnostic,/return \{sidebarRootPresent/);assert.doesNotMatch(diagnostic,/setTimeout|setInterval|requestAnimationFrame|Promise|await |sleep/);
 assert.match(section(bridge,'window.gptInspectSidebarScrollMechanics=async',' const intersects='),/native_readiness_required/);
 assert.match(main,/sidebarScrollReadinessCurrentDeadline/);assert.match(action,/native emergency guard fired yes/);
 assert.match(main,/native_readiness_terminal/);assert.match(main,/firstPollTimestampMs/);assert.match(main,/lastPollTimestampMs/);
 assert.match(action,/row_count_changed/);assert.match(action,/identity_set_changed/);assert.match(action,/identity_order_changed/);assert.match(action,/duplicate_identity/);assert.match(action,/identity_missing/);assert.match(action,/root_changed/);
 const acceptance=section(main,'func sidebarScrollReadinessAcceptance(now:UInt64)','func processSidebarScrollReadinessSample(');
 assert.match(acceptance,/sidebarScrollReadinessStablePolls>=4/);assert.match(acceptance,/elapsedNs>=320_000_000/);assert.match(action,/requiredStableSamples":4/);assert.match(action,/requiredStableDurationMs":320/);assert.match(action,/identitySetFingerprint/);assert.match(action,/identityOrderFingerprint/);
 for(const event of ['poll_scheduled','poll_started_native','evaluate_js_called','evaluate_js_callback_received','sample_parsed','next_poll_scheduled'])assert.ok(action.includes(`"${event}"`)||action.includes(`'${event}'`),`missing lifecycle event ${event}`);
 assert.match(action,/sidebarScrollReadinessScheduledCount/);assert.match(action,/sidebarScrollReadinessEvaluateCalledCount/);assert.match(action,/sidebarScrollReadinessCallbackCount/);assert.match(action,/sidebarScrollReadinessInFlight/);assert.match(action,/MaxCallbackLatencyMs/);assert.match(action,/callbackLatency/);assert.match(action,/maxEventGapMs/);assert.match(action,/sample_parsed/);
 assert.match(bridge,/const waitForConversationRowsReady=/);
});

test('v5.84 diagnostic readiness grants one progress-gated stabilization grace under an absolute cap',()=>{
 const source=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
 const processor=section(source,'func processSidebarScrollReadinessSample(','func finishSidebarScrollReadiness(');
 assert.match(source,/sidebarScrollReadinessPhaseABudgetNs:UInt64=4_000_000_000/);
 assert.match(source,/sidebarScrollReadinessGraceBudgetNs:UInt64=1_200_000_000/);
 assert.match(source,/sidebarScrollReadinessAbsoluteBudgetNs:UInt64=6_000_000_000/);
 assert.match(source,/sidebarScrollReadinessHadSemanticChange/);assert.match(source,/rows_never_appeared/);
 assert.match(processor,/semanticChange=comparisonReasons\.contains\("row_count_changed"\).*identity_set_changed.*identity_order_changed/);
 assert.match(source,/activateSidebarScrollReadinessGrace/);assert.match(processor,/sidebarScrollReadinessCurrentDeadline/);
 assert.match(processor,/min\(now\+sidebarScrollReadinessGraceBudgetNs,sidebarScrollReadinessAbsoluteDeadline/);
 const acceptance=section(source,'func sidebarScrollReadinessAcceptance(now:UInt64)','func processSidebarScrollReadinessSample(');
 assert.match(acceptance,/sidebarScrollReadinessStablePolls>=4/);assert.match(acceptance,/elapsedNs>=320_000_000/);
 const phase=section(source,'func advanceSidebarScrollReadinessPhase(','func sidebarScrollReadinessCurrentDeadline(');
 assert.match(phase,/now>=sidebarScrollReadinessPhaseADeadline/);assert.match(phase,/sidebarScrollReadinessFirstPositiveCount>0/);assert.match(phase,/HadSemanticChange/);
 assert.match(phase,/sidebarScrollReadinessAcceptance\(now:now\)\.accepted/);assert.match(phase,/now>=sidebarScrollReadinessCurrentDeadline/);
 const finish=section(source,'func finishSidebarScrollReadiness(','@objc func diagnoseVisiblePinnedRows(');
 for(const field of ['phaseABudgetMs','stabilizationGraceMs','absoluteReadinessCapMs','firstPositiveTimestampMs','lastSemanticChangeTimestampMs','extensionActivated','stableSnapshotAccepted'])assert.ok(finish.includes(field),`missing ${field}`);
 assert.match(source,/let pinnedDiagnosticVersion="6.1.0"/);
});

test('root discovery provenance allows only one bounded home retry and sanitized hook state',()=>{
 const start=section(engine,'func startCycle(trigger:String)','func checkRecord(');
 const snapshot=start.indexOf('rootDiscoverySnapshotScript(attachContext:true)');
 const load=start.indexOf('cycleRootNavigation=web.load(URLRequest(url:home))');
 const postflight=start.indexOf('rootDiscoverySnapshotScript(attachContext:false)');
 assert.ok(snapshot>=0&&load>snapshot&&postflight>load);
 assert.equal((start.match(/web\.load\(URLRequest\(url:home\)\)/g)||[]).length,2);
 assert.match(start,/if shouldRetryRootDiscovery\(stallDetail:stallDetail,rateLimited:discoveryRateLimited/);
 assert.match(start,/Date\(\)\.timeIntervalSince\(retryStarted\)<45/);
 assert.match(start,/cycleRootTriggerStarted=true/);
 assert.match(start,/cycleRootLoadReturnedNavigation=cycleRootNavigation != nil/);
 assert.match(start,/cycleRootRouteImmediatelyAfter=safeNavigationRouteTemplate\(web\.url\)/);
 assert.match(start,/cycleRootLoadingImmediatelyAfter=web\.isLoading/);
 assert.match(start,/cycleRootProgressImmediatelyAfter=web\.estimatedProgress/);
 assert.match(model,/root_trigger_no_network_activity/);
 assert.match(model,/root_request_without_response/);
 assert.match(model,/root_response_unclassified/);
 assert.match(model,/root_ui_data_without_network_response/);
 assert.match(model,/root_list_hook_detached/);
 assert.match(main,/root_hook_health/);
 assert.match(main,/recordRootTriggerDelegate\("provisional_started"/);
 assert.match(main,/recordRootTriggerDelegate\("committed"/);
 assert.match(main,/recordRootTriggerDelegate\("finished"/);
 assert.match(main,/recordRootTriggerDelegate\("provisional_failed"/);
 assert.match(main,/cycleDiscovering,cycleRootTriggerStarted/);
 assert.match(main,/recordRootDocumentSnapshot\(cycleRootHookHealth\)/);
 assert.match(main,/cycleRootDocumentSnapshots.count>4/);
 assert.match(engine,/Root document telemetry \(separate hook events and resource timing/);
 assert.match(listHook,/rootBackendTraffic:rootTraffic/);
 assert.match(listHook,/rootHookEvents:rootDiscoveryObservationToken===expectedToken/);
 assert.match(listHook,/rootResourceEvents:rootDiscoveryObservationToken===expectedToken/);
 assert.match(listHook,/rootSidebarTimeline:rootDiscoveryObservationToken===expectedToken/);
 assert.match(listHook,/const rootObservationPath=raw/);
 assert.match(engine,/hook events \[/);
 assert.match(engine,/resource-timing \[/);
 assert.match(engine,/sidebar row changes \[/);
 assert.match(main,/"rootHookEvents","rootResourceEvents","rootSidebarTimeline"/);
 assert.match(listHook,/pageshowPersisted:rootPageShowPersisted/);
 assert.match(listHook,/zeroTransfer/);
 assert.match(listHook,/attachRootTrafficGeneration\(expectedToken\)/);
 assert.match(model,/if e\.postTriggerConversationLinks>0\{return "root_ui_data_without_network_response"\}/);
 assert.match(model,/e.hookRequests==0 && e.resourceRequests==0 && e.hookResponses==0 && e.resourceResponses==0/);
});

test('root discovery telemetry keeps hook and resource events separate and reports safe partition/sidebar proof fields',()=>{
 const hook=fs.readFileSync(path.join(__dirname,'list-hook.js'),'utf8');
 const engineStart=section(engine,'func rootDocumentTelemetryLine()','func rootDiscoveryProvenanceLine()');
 assert.match(hook,/rootHookEvents:\s*rootDiscoveryObservationToken===expectedToken/);
 assert.match(hook,/rootResourceEvents:\s*rootDiscoveryObservationToken===expectedToken/);
 assert.match(hook,/rootHookEvents\.push\(\{\.\.\.entry\}\)/);
 assert.match(hook,/event:status==null\?'failure':'response'/);
 assert.match(hook,/safeRootPartition/);assert.match(hook,/generation:'current'/);
 assert.match(hook,/rootHookEvents\.length>80/);assert.match(hook,/rootResourceEvents\.length>80/);
 assert.match(hook,/rowsWithoutInternalIdentity/);assert.match(hook,/hiddenScrollRangePossible/);
 assert.match(engineStart,/rootHookEvents/);assert.match(engineStart,/rootResourceEvents/);
 assert.match(engineStart,/hook events/);assert.match(engineStart,/resource-timing/);
 assert.match(engineStart,/rowsWithInternalIdentity/);assert.match(engineStart,/hidden-range/);assert.match(engineStart,/endOfListProof/);
 assert.match(main,/"rootHookEvents","rootResourceEvents","rootSidebarTimeline"/);
 assert.match(model,/base complete; starred coverage unresolved/);
 assert.match(model,/starred\.descriptor\.starred==true/);
});

test('v5.39 inspects only active rendered sidebar metadata and keeps native cache informational',()=>{
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const hook=fs.readFileSync(path.join(__dirname,'list-hook.js'),'utf8');
 const inspector=section(bridge,'const inspectRenderedRootSidebarMetadata=()=>','window.gptInspectRootSidebarMetadata=');
 assert.match(inspector,/activeSidebarSnapshot\(\)/);assert.match(inspector,/actuallyRendered\(anchor\)/);
 assert.match(inspector,/timestampFields/);assert.match(inspector,/sectionGroups/);assert.match(inspector,/pinnedStarred/);
 assert.match(inspector,/archived/);assert.match(inspector,/locked/);assert.match(inspector,/domOrderStable/);assert.match(inspector,/topProofPossible/);
 assert.match(inspector,/rowsWithInternalIdentity/);assert.match(inspector,/scrollGeometry/);assert.match(inspector,/endOfListProof:'unavailable'/);
 assert.doesNotMatch(inspector,/React|__reactProps|__reactFiber|serializedProps|innerHTML|outerHTML/);
 assert.match(hook,/window\.gptInspectRootSidebarMetadata\?\.\(\)/);assert.match(hook,/sidebarMetadata/);
 const start=section(engine,'func startCycle(trigger:String)','func checkRecord(');
 assert.equal((start.match(/rootDiscoverySnapshotScript\(attachContext:false\)/g)||[]).length,1);
 assert.ok(start.indexOf('try await pauseCycle(0.35)')>start.indexOf('rootDiscoverySnapshotScript(attachContext:false)'));
 assert.match(start,/await enrichNativeRootSidebarCacheSummary\(\)/);
 assert.match(engine,/window\.gptRootSidebarConversationIds\?\.\(\)\|\|\[\]/);
 assert.match(engine,/Native cached metadata for same rows/);assert.match(engine,/sourceProvenanceAvailable/);
 assert.match(engine,/internal identity rows/);assert.match(engine,/end-of-list proof/);
 const cache=section(engine,'func enrichNativeRootSidebarCacheSummary()','func rootSidebarMetadataLine()');
 assert.match(cache,/cycleState\.records\[\$0\]/);assert.doesNotMatch(cache,/cycleState\.(records\s*=|merge\(|discoveryStatus\s*=)|coverage/);
 assert.match(model,/coverageAfterListStatus/);assert.match(model,/root_ui_data_without_network_response/);
});

test('v5.40 tags every lastSeenUpdatedAt writer and keeps coverage trust informational',()=>{
 const listHook=fs.readFileSync(path.join(__dirname,'list-hook.js'),'utf8');
 assert.match(model,/enum LastSeenUpdatedAtSource:String,Codable/);
 assert.match(model,/isTrustedForRecentCoverage/);
 assert.match(model,/lastSeenUpdatedAtObservedAt/);
 assert.match(engine,/cycleState\.merge\(records,source:scope == \.project \? \.projectConversationUpdateTime:\.rootConversationUpdateTime\)/);
 assert.match(engine,/source:LastSeenUpdatedAtSource\.fromActivitySource\(activity\["activitySource"\] as\? String\)/);
 assert.match(listHook,/sourceFamily:info\.scope==='project'\?'project_conversation_list':'root_conversation_list'/);
 assert.match(engine,/Cached activity provenance: records/);
 assert.match(engine,/lastSeenProvenanceSchemaVersion=1/);
 assert.match(model,/rawSource\.flatMap\(LastSeenUpdatedAtSource\.init\(rawValue:\)\) \?\? \.legacyUnknown/);
 assert.equal((engine.match(/cycleState\.merge\(/g)||[]).length,2);
 assert.doesNotMatch(engine,/source:\.completeHistory/); // complete-history checks currently update only aggregates
 assert.match(engine,/let provenanceLine="Cached activity provenance:/);
 assert.doesNotMatch(engine,/let provenanceLine=[^\n]*(conversationId|title|href)/);
 assert.match(engine,/if needsProvenanceMigration \|\| interruptedDispatch \{saveCycle\(\)\}/);
 assert.doesNotMatch(engine,/isTrustedForRecentCoverage[\s\S]{0,300}composite\.status/);
});

test('429 stops the current discovery before scroll and does not trigger recovery navigation or reload', () => {
  const start = section(engine, 'func startCycle(trigger:String)', 'func checkRecord(');
  const candidates = section(engine,'func finalizeDiscoveryAndBuildCandidates(','func recordCandidateAdmission(');
  const statusCheck = start.indexOf('if discoveryRateLimited(Array(cycleRootStatuses)) {break}');
  const scroll = start.indexOf('gptScrollSidebar');
  assert.ok(statusCheck >= 0 && scroll > statusCheck);
  assert.doesNotMatch(start, /web\.reload\(\)|Retrying ChatGPT home|Reloading ChatGPT home/);
  assert.match(model, /func discoveryRateLimited\(_ statusCodes:\[Int\]\)->Bool \{statusCodes\.contains\(429\)\}/);
  assert.match(candidates, /cycleState\.discoveryStatus = \.rateLimited/);
  assert.match(engine, /coverageAfterListStatus\(composite,statusCodes:Array\(cycleRootStatuses\)\)/);
});

test('429 provenance is operation-token scoped: only scheduler discovery list events stop cycle discovery',()=>{
 assert.match(main,/owner=="scheduler_discovery",generation==cycleToken,cycleDiscovering,[\s\S]*cycleRootStatuses\.insert\(429\)/);
 assert.match(main,/status != 429\{cycleRootStatuses\.insert\(status\)\}/);
 assert.doesNotMatch(main,/if cycleDiscovering,\(data\["httpStatus"\] as\? Int\)==429\s*\{cycleRootStatuses\.insert\(429\)\}/);
 assert.match(engine,/window\.gptRateLimitContext=\{owner:'scheduler_discovery',generation:/);
 const listHook=fs.readFileSync(path.join(__dirname,'list-hook.js'),'utf8');
 assert.match(listHook,/owner==='scheduler_discovery'&&!\['root_conversation_list','project_conversation_list'\]\.includes\(family\)/);
 assert.match(listHook,/owner==='scheduler_conversation_check'&&!\['conversation_messages','conversation_detail'\]\.includes\(family\)/);
 assert.doesNotMatch(engine,/web\.reload\(\)/);
});

test('isolated timestamp fallback 429 is terminal activity_http_429 and cannot become prefix failure',()=>{
 assert.match(model,/event\["operationOwner"\] as\? String,owner==expectedOwner/);assert.match(model,/event\["operationGeneration"\] as\? String,generation==expectedGeneration/);
 assert.match(main,/reason:"activity_http_429"/);assert.match(main,/pinnedActivityEventMatches\(data,expectedConversationID:expected/);
 assert.match(main,/installPinnedActivityContextUserScript/);
 assert.doesNotMatch(section(main,'func beginPinnedActivityNavigation','func isCurrentPinnedNavigation'),/sessionStorage/);
 assert.match(main,/HTTP 429 observed:/);
 assert.match(engine,/owner:"scheduler_conversation_check"/);
});

test('v5.13 isolated probe launch is visible, single-owner, and acknowledged before readiness',()=>{
 const action=section(main,'@objc func diagnosePinnedActivityTimestamp()','func continuePinnedActivityLaunch()');
 const launch=section(main,'func continuePinnedActivityLaunch()','func rejectPinnedActivityLaunch');
 const reject=section(main,'func rejectPinnedActivityLaunch','func armPinnedActivityBridgeAckDeadline');
 const ack=section(main,'func armPinnedActivityBridgeAckDeadline','func startPinnedActivityProbe');
 const start=section(main,'func startPinnedActivityProbe','func pinnedActivityStatusText');
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 assert.ok(action.indexOf('pinnedActivityLaunchStage="action_received"')<action.indexOf('continuePinnedActivityLaunch()'));
 assert.ok(action.indexOf('setLastIsolatedDiagnostic("Last isolated diagnostic: State: starting\\nStage: action_received')>=0);
 assert.match(action,/pinnedActivityDiagnosticToken != nil \|\| pinnedActivityLaunchPending/);
 assert.match(launch,/pinnedActivityLaunchStage="gate_check_started"/);
 assert.match(launch,/pinnedActivityLaunchStage="gate_passed"[\s\S]*pinnedActivityDiagnosticToken=token[\s\S]*pinnedActivityLaunchStage="operation_created"/);
 for(const reason of ['scheduler_running','render_lease_unavailable','runtime_gate_failed','page_unavailable'])assert.ok(launch.includes(`rejectPinnedActivityLaunch("${reason}")`));
 assert.match(reject,/pinnedActivityLaunchPending=false/);assert.match(reject,/State: rejected/);
 assert.match(start,/pinnedActivityLaunchStage="bridge_invocation_started"/);assert.match(start,/armPinnedActivityBridgeAckDeadline\(token:token\)/);
 assert.match(ack,/bridge_start_timeout/);assert.ok(main.includes('operation active: '+String.fromCharCode(92)+'(active)'));
 assert.match(bridge,/if\(activityInternal\)emitPinnedActivityStage\(options,'probe_started'\)/);
 assert.ok(bridge.indexOf("emitPinnedActivityStage(options,'probe_started')")<bridge.indexOf("emitPinnedActivityStage(options,currentStage)"));
 assert.match(main,/if stage=="probe_started"[\s\S]*pinnedActivityLaunchAckTask\?\.cancel\(\)[\s\S]*pinnedActivityLaunchStage="probe_started"/);
 assert.match(main,/pinnedActivityLaunchAckTask\?\.cancel\(\);pinnedActivityLaunchAckTask=nil/);
 assert.match(main,/pinnedActivityExpectedOrdinal=nil;pinnedActivityDiagnosticToken=nil/);
});

test('v5.17 activity fallback uses in-memory ownership and sends native navigation without preparation evaluation',()=>{
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 const resolve=section(main,'func resolveNextPinnedActivity(token:String)','func handlePinnedActivityProbe(');
 const navigation=section(main,'func beginPinnedActivityNavigation','func isCurrentPinnedNavigation(');
 const scheduler=section(main,'func schedulePinnedActivityResolver(token:String)','@MainActor func resolveNextPinnedActivity(');
 assert.match(scheduler,/Task \{ @MainActor[\s\S]*await self\.resolveNextPinnedActivity\(token:token\)/);
 assert.match(main,/@MainActor func resolveNextPinnedActivity\(token:String\) async/);
 assert.match(resolve,/recordPinnedActivityPreNavigationStage\("fallback_started"/);
 assert.match(resolve,/recordPinnedActivityPreNavigationStage\("route_available"/);
 assert.match(resolve,/frontend_route_missing/);
 assert.match(resolve,/recordPinnedActivityPreNavigationStage\("navigation_request_created"/);
 assert.match(resolve,/let navigationSent=await beginPinnedSidebarNavigation\(id:id,route:exactRoute,token:token,ordinal:ordinal\)/);
 assert.doesNotMatch(navigation,/Task \{|sessionStorage|evaluateJavaScript|activity_target_preparation|navigation_preparation_eval/);
 assert.match(navigation,/recordPinnedActivityPreNavigationStage\("main_actor_entered"/);
 assert.match(navigation,/recordPinnedActivityPreNavigationStage\("webview_resolved"/);
 assert.match(navigation,/recordPinnedActivityPreNavigationStage\("render_lease_verified"/);
 for(const reason of ['operation_cancelled','stale_operation','timestamp_already_terminal','webview_unavailable','render_lease_lost','navigation_context_invalid']) assert.match(navigation,new RegExp(reason));
 const aboutToSend=navigation.indexOf('recordPinnedActivityPreNavigationStage("navigation_command_about_to_send"');
 const script=navigation.indexOf('installPinnedActivityContextUserScript');
 const load=navigation.indexOf('resolvedWebView.load(URLRequest(url:components.url!))');
 const sent=navigation.indexOf('recordPinnedActivityPreNavigationStage("navigation_command_sent"');
 assert.ok(script>=0 && aboutToSend>script && load>aboutToSend && sent>load);
 assert.doesNotMatch(navigation.slice(aboutToSend,load),/\bawait\b|Task\s*\{/);
 assert.match(navigation,/guard let navigation=resolvedWebView\.load\(URLRequest\(url:components\.url!\)\) else/);
 assert.match(navigation,/navigation_command_rejected/);
 assert.match(main,/pinnedNavigationDeadlineReason\(commandSent:false\)/);
 assert.match(main,/pre_navigation_timeout/);
 const finish=section(main,'func finishPinnedActivityFallback','func handleConfirmedPinnedActivityResponse');
 assert.match(finish,/pinnedActivityChildTerminalReason=reason/);
 assert.match(main,/pinnedTimestampFailureReason\(childReason:pinnedActivityChildTerminalReason/);
 assert.match(model,/func pinnedTimestampFailureReason\(childReason:String,fallbackReason:String\)->String/);
 assert.ok(main.includes('Pre-navigation: \\(pinnedNavigationPreflightSummary())'));
 assert.match(resolve,/guard !Task\.isCancelled,pinnedActivityDiagnosticToken==token,pinnedActivityTimestampExpected else\{return\}/);
 assert.ok(navigation.indexOf('recordPinnedActivityPreNavigationStage("main_actor_entered"')<navigation.indexOf('guard !Task.isCancelled'));
 assert.match(navigation,/finishPinnedActivityFallback\(state:\.error,reason:"navigation_command_rejected"/);
 assert.match(main,/pinnedTimestampFailureReason\(childReason:pinnedActivityChildTerminalReason/);
 assert.match(model,/func pinnedTimestampFailureReason\(childReason:String,fallbackReason:String\)->String \{childReason == "none" \? fallbackReason:childReason\}/);
});

test('v5.86 isolated pinned activity holds an ownership-based lease through resolution and cleans up only at terminal completion',()=>{
 assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 const lease=section(main,'func recordPinnedActivityLeaseStage','@MainActor func beginPinnedSidebarNavigation');
 assert.match(lease,/backgroundRenderLease\?\.owner==token/);
 assert.match(lease,/backgroundRenderLeaseGate\.owner==token/);
 assert.match(lease,/session\.contentView === web && web\.window === session/);
 assert.match(lease,/valid=ownerMatches && gateMatches && attached && surfaceReady/);
 assert.doesNotMatch(lease,/valid=[^\n]*session\.isVisible/);
 const resultHandler=section(main,'func handlePinnedActivityProbe','@objc func diagnoseSidebarRoutes()');
 for(const stage of ['activity_started','lease_present_before_activity','render_lease_lost_before_activity'])assert.ok(resultHandler.includes(stage),`missing ${stage}`);
 const resolver=section(main,'@MainActor func resolveNextPinnedActivity(token:String)','func handlePinnedActivityProbe(');
 for(const stage of ['lease_present_before_primary','activity_primary_attempt','activity_fallback_started','lease_present_before_fallback','render_lease_lost_during_primary','render_lease_lost_during_fallback'])assert.ok(resolver.includes(stage),`missing ${stage}`);
 assert.match(resolver,/recordPinnedActivityLeaseStage\("lease_present_before_fallback"/);
 const navigation=section(main,'@MainActor func beginPinnedSidebarNavigation','func finishPinnedSidebarNavigation');
 assert.match(navigation,/recordPinnedActivityLeaseStage\("fallback_navigation_entered"/);
 assert.match(navigation,/render_lease_lost_during_fallback/);
 assert.doesNotMatch(navigation,/guard backgroundRenderLeaseOwner==token,session\.isVisible/);
 const finish=section(main,'func finishPinnedActivityDiagnostic()','@discardableResult func completePinnedActivityItem');
 assert.ok(finish.indexOf('pinnedDiagnosticCanFinish')<finish.indexOf('restoreBackgroundRenderSurface(owner:owner)'));
 assert.match(finish,/pinnedActivityLeaseStages\.last != "activity_completed"/);
 assert.equal((finish.match(/restoreBackgroundRenderSurface\(owner:owner\)/g)||[]).length,1);
 assert.match(finish,/finalTelemetry=.*Activity lease stages:/);
 assert.match(main,/Activity lease stages:/);
});

test('v5.19 uses inline WKWebView snapshots after load without a fire-and-forget observer',()=>{
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
assert.match(main,/guard pinnedDiagnosticVersion=="6.1.0", runtimeSource != "unexpected"/);
 const begin=section(main,'@MainActor func beginPinnedActivityNavigation','func isCurrentPinnedNavigation');
 assert.match(begin,/safeNavigationRouteTemplate\(resolvedWebView\.url\)/);
 assert.match(begin,/pinnedActivityTargetDiffersFromCurrent=/);
 assert.match(begin,/navigationDelegate != nil/);assert.match(begin,/navigationDelegate === self/);
 assert.match(begin,/pinnedNavigationTargetAlreadyLoaded/);
 const alreadyLoaded=begin.slice(begin.indexOf('if pinnedNavigationTargetAlreadyLoaded'),begin.indexOf('guard installPinnedActivityContextUserScript'));
 assert.match(alreadyLoaded,/target_route_already_loaded/);assert.match(alreadyLoaded,/confirmPinnedActivityRoute/);assert.doesNotMatch(alreadyLoaded,/\.load\(/);
 assert.match(begin,/let navigation=resolvedWebView\.load\(URLRequest\(url:components\.url!\)\)/);
 assert.match(begin,/pinnedActivityNavigationObjectReturned=true/);
 assert.match(begin,/navigation_command_rejected/);
 assert.match(begin,/return await observePinnedNavigationInline\(webView:resolvedWebView/);
 assert.ok(begin.indexOf('resolvedWebView.load(URLRequest(url:components.url!))')<begin.indexOf('return await observePinnedNavigationInline'));
 assert.doesNotMatch(begin,/\.navigationDelegate\s*=(?!=)/);
 const observe=section(main,'func recordPinnedNavigationSnapshot','@MainActor func confirmPinnedActivityRoute');
 for(const marker of ['0 ms','100 ms','500 ms','1 s','2 s','5 s'])assert.ok(observe.includes(marker),`missing inline snapshot ${marker}`);
 assert.match(observe,/webView\.isLoading/);assert.match(observe,/webView\.estimatedProgress/);
 assert.doesNotMatch(observe,/absoluteString|URLRequest|Task\s*\{/);
 for(const reason of ['navigation_observation_not_started','navigation_route_reached','navigation_load_no_effect'])assert.match(observe,new RegExp(reason));
 assert.match(model,/return "navigation_started_but_stalled"/);
 assert.match(main,/Navigation snapshots:/);assert.match(main,/pinnedActivityNavigationDiagnosticReason/);
 assert.match(model,/func pinnedNavigationObservationClassification/);assert.match(model,/func pinnedNavigationTargetAlreadyLoaded/);
});

test('v5.14 readiness preserves signature telemetry and timestamp dispatch has explicit terminal gates in v5.16',()=>{
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const readiness=section(bridge,'const waitForConversationRowsReady=','window.gptWaitForConversationRowsReady=');
 assert.match(readiness,/exactConversationRouteFromAnchor\(anchor\)/);
 assert.match(readiness,/conversationSignatureChanges\+\+/);
 assert.match(readiness,/current\.signature!==lastSignature\|\|current\.root!==lastRoot/);
 assert.match(readiness,/mutationChecks\+\+/);
 assert.match(readiness,/unrelatedMutationChecks\+\+/);
 assert.match(readiness,/observer=new MutationObserver\(records=>\{if\(records\?\.length\)sample\(true\);\}\)/);
 assert.match(readiness,/stableChecks>=4&&now-lastChangeAt>=quietWindowMs/);
 assert.match(readiness,/phaseABudgetMs=Math\.max\(1,Math\.min\(4000,requestedPhaseA\)\)/);
 assert.match(readiness,/stabilizationGraceMs=Math\.max\(0,Math\.min\(1200/);assert.match(readiness,/absoluteReadinessCapMs=Math\.max\(phaseABudgetMs,Math\.min\(6000/);
 assert.match(readiness,/finalStableCount:stableCount/);
 assert.match(readiness,/readinessTerminalReason:terminalReason/);
 const activity=section(bridge,'window.gptInspectVisiblePinnedRows=async(options={})=>{',' window.gptRunPinnedSidebarDiagnostic=async()=>{');
 for(const stage of ['prefix_completed','timestamp_dispatch_evaluated','timestamp_dispatch_allowed','timestamp_dispatch_blocked'])assert.ok(activity.includes(`'${stage}'`),`missing JS dispatch marker ${stage}`);
 assert.match(activity,/timestampDispatch:\{evaluated:activityInternal,allowed:timestampEligible,reason:timestampDispatchReason/);
 assert.match(activity,/finalStableCount:readiness\.finalStableCount/);assert.match(activity,/phaseABudgetMs:readiness\.phaseABudgetMs/);assert.match(activity,/extensionActivated:readiness\.extensionActivated/);assert.match(activity,/conversationSignatureChanges:readiness\.conversationSignatureChanges/);assert.match(activity,/mutationChecks:readiness\.mutationChecks/);assert.match(activity,/unrelatedMutationChecks:readiness\.unrelatedMutationChecks/);
 const lease=section(main,'func renderLeaseFailureReason','func acquireBackgroundRenderSurface');
 assert.match(lease,/case \.readinessFailed\(let reason\):return reason/);
 assert.match(lease,/case \.busy,\.activationFailed:return "render_lease_unavailable"/);
 const acquire=section(main,'func acquireBackgroundRenderSurface','func evaluateRenderReadiness');
 assert.ok(acquire.includes('primaryFailureReason \\(status)'));
 assert.ok(acquire.includes('cleanupFailureReason \\(restored ? "none":"render_surface_restore_failed")'));
 const launch=section(main,'func continuePinnedActivityLaunch()','func rejectPinnedActivityLaunch');
 assert.match(launch,/let primary=self\.renderLeaseFailureReason\(error\)/);
 assert.match(launch,/pinnedActivityPrimaryFailureReason=primary/);
 assert.match(launch,/pinnedActivityCleanupFailureReason=cleanupFailed \? "render_surface_restore_failed":"none"/);
 const resolverSchedule=section(main,'func schedulePinnedActivityResolver(token:String)','@MainActor func resolveNextPinnedActivity(');
 for(const marker of ['timestamp_resolver_invoked','timestamp_resolver_entered','timestamp_resolver_not_entered'])assert.ok(resolverSchedule.includes(marker),`missing resolver marker ${marker}`);
 assert.match(resolverSchedule,/self\.pinnedActivityTimestampResolverEntered/);assert.match(resolverSchedule,/pinnedActivityTimeoutTask=Task/);
 assert.ok(main.includes('["allowed","items_created","resolver_invoked","resolver_entered","passive_lookup_started","fallback_started"].contains(pinnedActivityTimestampDispatchStage)'));
 const dispatch=section(main,'func handlePinnedActivityProbe','@objc func diagnoseSidebarRoutes()');
 for(const reason of ['prefix_incomplete','pinned_ids_empty','timestamp_dispatch_blocked','timestamp_items_mismatch','scheduler_running','timestamp_operation_stale','diagnostic_already_terminal'])assert.ok(dispatch.includes(`"${reason}"`),`missing explicit dispatch reason ${reason}`);
 assert.match(dispatch,/timestamp_items_created/);assert.match(dispatch,/schedulePinnedActivityResolver\(token:token\)/);
 assert.ok(main.includes('signature changes \\(pinnedActivityConversationSignatureChanges)'));
 assert.ok(main.includes('unrelated mutation checks \\(pinnedActivityUnrelatedMutationChecks)'));
 const nav=section(main,'func beginPinnedActivityNavigation','func isCurrentPinnedNavigation');
 assert.match(nav,/installPinnedActivityContextUserScript\(owner:"isolated_timestamp_fallback"/);
 assert.doesNotMatch(nav,/boundedPinnedPreparationEval|preparationScript|sessionStorage/);
 assert.match(nav,/resolvedWebView\.load\(URLRequest\(url:components\.url!\)\)/);
});

test('v5.15 pinned traversal scrolls pending rows only after the initial shared top proof and restores position',()=>{
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const activity=section(bridge,'window.gptInspectVisiblePinnedRows=async(options={})=>{',' window.gptRunPinnedSidebarDiagnostic=async()=>{');
 assert.match(activity,/const positioned=await scrollConversationRowIntoView\(anchor,root,scroller,\(\)=>resolveSnapshotRow\(snapshotRow\),\{strictDiagnosticOwner:activityInternal,validateSnapshot:activityInternal\?validateSnapshotAfterScroll:null,rowIndex:rowNumber\}\)/);
 assert.match(activity,/scrollAttempts\.push\(\.\.\.positioned\.attempts\)/);
 assert.match(bridge,/strictDiagnosticOwner&&!first\.visible&&first\.moved/);
 assert.match(bridge,/const findSidebarScrollOwner=/);assert.match(bridge,/const collectSidebarScrollCandidates=/);assert.match(bridge,/resolveUniqueSidebarScrollOwner/);assert.match(bridge,/scroll_owner_missing/);assert.match(bridge,/scroll_owner_detached/);assert.match(bridge,/row_missing_after_scroll/);assert.match(bridge,/scroll_did_not_move/);assert.match(bridge,/row_not_reached_after_scroll/);
 assert.match(activity,/scrollContainer\.scrollTop=initialScrollPosition/);
 assert.match(activity,/scrollRestoreSuccessful/);assert.match(activity,/rowVisibleAfterScroll/);
 assert.equal((activity.match(/inspectConversationListTopState\(/g)||[]).length,1,'top proof runs once before prefix traversal');
 assert.match(activity,/snapshotExpansionCount>=3/);assert.match(activity,/live\.length>maxRows\|\|expanded\.length>maxRows/);assert.match(activity,/snapshot_exceeds_traversal_budget/);
 assert.match(activity,/requiredTraversalRows:initialSnapshotCount/);assert.match(activity,/absoluteTraversalCap:absoluteSnapshotSafetyCap/);assert.match(activity,/initialSnapshotCount>absoluteSnapshotSafetyCap/);assert.match(activity,/snapshot_exceeds_traversal_cap/);
});

test('production and isolated prefix paths share snapshot-aware row capacity and expose it in diagnostics',()=>{
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const engineSource=fs.readFileSync(path.join(__dirname,'CycleEngine.swift'),'utf8');
 const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
 assert.match(bridge,/const absoluteSnapshotSafetyCap=32/);
 assert.match(bridge,/requestedTraversalBudget=Math\.max\(1,Math\.min\(\(activityInternal\|\|cycleInternal\)\?absoluteSnapshotSafetyCap:20,requestedRows\)\)/);
 assert.match(bridge,/Math\.max\(requestedTraversalBudget,initialSnapshotCount\+snapshotMargin\)/);
 assert.match(bridge,/prefixSnapshot=\(activityInternal\|\|cycleInternal\)\?initialSnapshot:initialSnapshot\.slice\(0,maxRows\)/);
 assert.match(engineSource,/window\.gptInspectVisiblePinnedRows\(\{maxRows:20/);
 assert.match(engineSource,/Traversal capacity: snapshot rows .*required rows .*selected budget .*absolute cap .*budget sufficient .*processed rows/);
 assert.match(bridge,/snapshot_exceeds_traversal_cap/);
 assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
});

test('successful pinned-prefix result separates completion reason from failure',()=>{
 const model=fs.readFileSync(path.join(__dirname,'CycleModel.swift'),'utf8');
 const engine=fs.readFileSync(path.join(__dirname,'CycleEngine.swift'),'utf8');
 assert.match(model,/var completionReason:String\? = nil/);
 assert.match(model,/canonical\.unresolvedReason="none"/);
 assert.match(model,/failureReason=nil;fallbackStatus = \.completed/);
 assert.match(model,/completion reason .* · failure /);
 assert.match(engine,/else \{proofFailureReason="none"\}/);
 assert.match(engine,/proof\.completionReason=proof\.complete \? prefixReason : nil/);
 assert.ok(engine.includes("starredProofState.diagnosticsLine"));
});

test('duplicate logical pages do not advance the page version that gates scrolling', () => {
  const consume = section(engine, 'func consumeDiscoveryPage(', 'func updatePartitionReport(');
  assert.ok(consume.indexOf('cyclePageKeys.insert(signature).inserted') < consume.indexOf('cycleListVersion+=1'));
  const start = section(engine, 'func startCycle(trigger:String)', 'func checkRecord(');
  assert.match(start, /if version != scrolledVersion/);
  assert.ok(start.indexOf('cycleRootStatuses') < start.indexOf('gptScrollSidebar'));
});

test('coverage update helper is used after merge and the safety-probe branch follows merge',()=>{
 const consume=section(engine,'func consumeDiscoveryPage(', 'func updatePartitionReport(');
 assert.ok(consume.indexOf('cycleState.merge(records')<consume.indexOf('updateDiscoveryCoverage('));
 assert.ok(consume.indexOf('cycleState.merge(records')<consume.indexOf('if case .recent_safety_probe = source'));
 assert.match(consume,/updateDiscoveryCoverage\(source:source,rootProof:&rootProof,partitions:&cyclePartitions/);
 const helper=section(engine,'func updateDiscoveryCoverage(', 'func consumeDiscoveryPage(');
 assert.match(helper,/guard source == \.normal_discovery else\{return\}/);
});
test('original normal-discovery failure is preserved once before probe eligibility',()=>{
 const start=section(engine,'func startCycle(trigger:String)','func checkRecord(');
 const candidates=section(engine,'func finalizeDiscoveryAndBuildCandidates(','func recordCandidateAdmission(');
 assert.match(main,/var originalNormalDiscoveryFailureReason:String\?/); // A
 assert.match(start,/cycleRootResponseReceived=false;originalNormalDiscoveryFailureReason=nil/); // B
 assert.match(start,/cycleRootStallDetail=nil/);
 assert.match(start,/originalNormalDiscoveryFailureReason==nil, !cycleRootResponseReceived,[\s\S]*?stallDetail=="no_list_response" \|\| stallDetail=="root_request_without_response"\)\s*\{\s*originalNormalDiscoveryFailureReason=stallDetail/); // C/D
 const snapshotAt=start.indexOf('originalNormalDiscoveryFailureReason=stallDetail');
 const probeAt=start.indexOf('if shouldRunRecentSafetyProbeForOriginalFailure');
 assert.ok(snapshotAt>=0 && probeAt>snapshotAt,'original failure is preserved before probe eligibility');
 assert.match(candidates,/if !cycleRootResponseReceived\s*\{composite\.status = \.incompleteStall;composite\.detail=stallDetail/);
});
test('recent safety probe eligibility is a pure predicate over original failure and root proof',()=>{
 const predicate=section(engine,'var shouldRunRecentSafetyProbeForOriginalFailure:Bool {','func updateDiscoveryCoverage(');
 assert.match(predicate,/!cycleRootResponseReceived/);
 assert.match(predicate,/originalNormalDiscoveryFailureReason=="no_list_response" \|\| originalNormalDiscoveryFailureReason=="root_request_without_response"/);
 assert.doesNotMatch(predicate,/=nil|append|remove|cycleState\.|stallDetail/);
});
test('recent safety probe lifecycle has minimal cycle-scoped one-shot state only',()=>{
 assert.match(main,/var recentSafetyProbeAttempted=false/);
 assert.match(main,/var recentSafetyProbeToken:String\?/);
 assert.match(main,/var recentSafetyProbeTerminalResult:RecentSafetyProbeTerminalResult\?/);
 assert.match(main,/var recentSafetyProbePending=false/);
 const generation=section(main,'var cycleToken="" {','var cycleOrigins=');
 for(const reset of ['recentSafetyProbeAttempted=false','recentSafetyProbeToken=nil','recentSafetyProbeTerminalResult=nil','recentSafetyProbePending=false'])assert.ok(generation.includes(reset),`generation reset missing ${reset}`);
 assert.match(main,/struct RecentSafetyProbeState/);assert.match(main,/var recentSafetyProbe:RecentSafetyProbeState\?/);
 const lifecycle=section(engine,'func startCycle(trigger:String)','func checkRecord(');
 assert.match(lifecycle,/if shouldRunRecentSafetyProbeForOriginalFailure, !recentSafetyProbeAttempted,[\s\S]*?cycleToken==cycleGeneration,cycleDiscovering/);
 assert.equal((lifecycle.match(/await runRecentSafetyProbe\(probeToken\)/g)||[]).length,1);
 assert.equal((lifecycle.match(/await awaitRecentSafetyProbeTerminal\(/g)||[]).length,1);
 assert.ok(lifecycle.indexOf('awaitRecentSafetyProbeTerminal(')>lifecycle.indexOf('runRecentSafetyProbe(probeToken)'));
});
test('Prototype cycleSequence increments once for each nonempty cycle generation',()=>{
 assert.match(main,/var cycleSequence:UInt64=0/);
 const generation=section(main,'var cycleToken="" {','var cycleOrigins=');
 assert.match(generation,/if !cycleToken\.isEmpty \{cycleSequence &\+= 1\}/);
 assert.equal((generation.match(/cycleSequence\s*&\+=\s*1/g)||[]).length,1);
 assert.ok(generation.indexOf('if !cycleToken.isEmpty')<generation.indexOf('cycleSequence &+= 1'));
 const engineStart=section(engine,'func startCycle(trigger:String)','func checkRecord(');
 assert.match(engineStart,/guard cycleGate\.begin\(\) else\{return\}/);
 assert.doesNotMatch(main,/cycleSequence\s*&\+=\s*1[\s\S]{0,300}(runRecentSafetyProbe|finalizeTerminalEvidence)/);
});
test('eligible recent safety probe is one-shot and finalized by the candidate helper',()=>{
 const start=section(engine,'func startCycle(trigger:String)','func checkRecord(');
 const trigger=start.indexOf('if shouldRunRecentSafetyProbeForOriginalFailure');
 const terminal=start.indexOf('await awaitRecentSafetyProbeTerminal(',trigger);
 const helperCall=start.indexOf('finalizeDiscoveryAndBuildCandidates(',terminal);
 const reset=start.indexOf('cycleDiscovering=false',helperCall);
 assert.ok(trigger>=0&&terminal>trigger&&helperCall>terminal&&reset<0);
 const phase=start.slice(trigger,helperCall);
 const ordered=['shouldRunRecentSafetyProbeForOriginalFailure','!recentSafetyProbeAttempted','cycleToken==cycleGeneration,cycleDiscovering','recentSafetyProbeAttempted=true','recentSafetyProbeToken=probeToken','recentSafetyProbePending=true','runRecentSafetyProbe(probeToken)','awaitRecentSafetyProbeTerminal('];
 let previous=-1;for(const marker of ordered){const at=phase.indexOf(marker,previous+1);assert.ok(at>previous,`lifecycle order missing or misplaced in probe phase: ${marker}`);previous=at;}
 assert.equal((phase.match(/await runRecentSafetyProbe\(probeToken\)/g)||[]).length,1);
 assert.equal((phase.match(/await awaitRecentSafetyProbeTerminal\(/g)||[]).length,1);
 assert.doesNotMatch(phase,/coverageAfterListStatus|stallDetail\s*=|checkCandidates|cycleState\.queue/);
 const helper=section(engine,'func finalizeDiscoveryAndBuildCandidates(','func recordCandidateAdmission(');
 assert.match(helper,/recentSafetyProbeTerminalResult=terminalResult[\s\S]*recentSafetyProbePending=false/);
 assert.match(helper,/discoveryFinalizedAfterProbe=[\s\S]*coverageComplete=composite\.isComplete[\s\S]*let recent=cycleState\.records\.values\.filter[\s\S]*let checkCandidates=Array\(checkCandidatesByID\.values\)[\s\S]*candidatesBuiltAfterProbe=/);
 assert.doesNotMatch(helper,/recordCandidateAdmission\(|checkRecord\(/);
});
test('production ordering is probe completion, helper, queue, admission, then chat checks',()=>{
 const start=section(engine,'func startCycle(trigger:String)','func checkRecord(');
 const consume=section(engine,'func consumeDiscoveryPage(','func updatePartitionReport(');
 const terminal=start.indexOf('await awaitRecentSafetyProbeTerminal(');
 const helperCall=start.indexOf('finalizeDiscoveryAndBuildCandidates(',terminal);
 const queue=start.indexOf('let queue=cycleState.queue(checkCandidates)',helperCall);
 const admission=start.indexOf('recordCandidateAdmission(queue:queue',queue);
 const chatLoop=start.indexOf('for record in queue {',admission);
 assert.ok(terminal>=0&&helperCall>terminal&&queue>helperCall&&admission>queue&&chatLoop>admission);
 assert.match(start,/let queue=cycleState\.queue\(checkCandidates\)/);
 assert.match(start,/recordCandidateAdmission\(queue:queue,[\s\S]*terminalEvidence:&terminalEvidence\)/);
 assert.match(consume,/cycleState\.merge\(records,[\s\S]*?cycleIds\.formUnion\(ids\)/);
 assert.match(consume,/if case \.recent_safety_probe = source \{updatePartitionReport\(\);renderCycle\(\);return \.accepted_new\}/);
 const helper=section(engine,'func finalizeDiscoveryAndBuildCandidates(','func recordCandidateAdmission(');
 assert.match(helper,/let recent=cycleState\.records\.values\.filter[\s\S]*let checkCandidates=Array\(checkCandidatesByID\.values\)/);
 assert.match(helper,/let checkCandidates=Array\(checkCandidatesByID\.values\)[\s\S]*candidatesBuiltAfterProbe=[\s\S]*return PostProbeCandidateResult/);
 assert.doesNotMatch(helper,/recordCandidateAdmission\(|checkRecord\(/);
 const coverageUpdate=section(engine,'func updateDiscoveryCoverage(','func consumeDiscoveryPage(');
 assert.match(coverageUpdate,/guard source == \.normal_discovery else\{return\}/);
 assert.match(start,/originalNormalDiscoveryFailureReason=stallDetail/);
});
test('terminal evidence accumulator is wired to common cleanup without influencing cycle decisions',()=>{
 const start=section(engine,'func startCycle(trigger:String)','func checkRecord(');
 const candidates=section(engine,'func finalizeDiscoveryAndBuildCandidates(','func recordCandidateAdmission(');
 const task=start.slice(start.indexOf('cycleTask=Task'));
 const init=start.indexOf('var terminalEvidence=CycleTerminalEvidence(cycleSequence:cycleSequence)'),cycleTask=start.indexOf('cycleTask=Task');
 const deferAt=task.indexOf('defer {'),doAt=task.indexOf('do {');
 assert.ok(init>=0&&cycleTask>init&&deferAt>=0&&doAt>deferAt); // A
 assert.match(task,/defer \{\s*finalizeTerminalEvidence\(terminalEvidence\)/); // B/G
 assert.match(task,/terminalEvidence\.terminalKind = \.success/); // C
 const admission=section(engine,'func recordCandidateAdmission(','func startCycle(trigger:String)');
 assert.match(candidates,/terminalEvidence\.coverageComplete=composite\.isComplete/); // D
 assert.match(admission,/terminalEvidence\.admittedCandidateCount=queue\.count/);
 assert.match(task,/let queue=cycleState\.queue\(checkCandidates\)[\s\S]*recordCandidateAdmission\(queue:queue,[\s\S]*for record in queue \{/);
 assert.match(admission,/let queuedIDs=Set\(queue\.map\(\\.conversationId\)\)[\s\S]*\$0\.queued=queued/);
 assert.doesNotMatch(admission,/checkRecord\(|cycleRootResponseReceived\s*=|cyclePartitions\s*=/);
 assert.match(task,/catch \{\s*terminalEvidence\.terminalKind = \.error/); // E
 assert.match(task,/catch is CancellationError \{\s*terminalEvidence\.terminalKind = \.cancelled_or_stale/); // F
 assert.match(candidates,/terminalEvidence\.probeJSOutcome=recentSafetyProbe\?\.jsOutcome[\s\S]*terminalEvidence\.probeListReceived=recentSafetyProbe\?\.listMessageReceived[\s\S]*terminalEvidence\.probeConsumeResult=recentSafetyProbe\?\.consumeResult\?\.rawValue/); // G
 assert.doesNotMatch(task,/if\s+terminalEvidence|guard\s+terminalEvidence|while\s+terminalEvidence|switch\s+terminalEvidence/); // H
 assert.match(main,/struct CycleTerminalEvidence \{\s*enum TerminalKind:String,Codable \{ case success,error,cancelled_or_stale \}\s*let cycleSequence:UInt64/); // A
 assert.match(start,/var terminalEvidence=CycleTerminalEvidence\(cycleSequence:cycleSequence\)/); // B/C
 assert.match(task,/defer \{\s*finalizeTerminalEvidence\(terminalEvidence\)/); // D/E
 assert.doesNotMatch(task,/terminalEvidence\.cycleSequence\s*=|finalizeTerminalEvidence\([^)]*cycleSequence/);
 assert.doesNotMatch(task,/if\s+[^\n]*cycleSequence|guard\s+[^\n]*cycleSequence|while\s+[^\n]*cycleSequence/); // F
});
test('terminal evidence converts to a sanitized Codable snapshot without lifecycle reads or persistence',()=>{
 const model=main.slice(main.indexOf('struct LastCycleTerminalSnapshot:'),main.indexOf('func makeLastCycleTerminalSnapshot('));
 const helper=main.slice(main.indexOf('func makeLastCycleTerminalSnapshot('),main.indexOf('\nfunc persistLastCycleTerminalSnapshot('));
 assert.match(model,/struct LastCycleTerminalSnapshot:Codable,Equatable/);
 for(const field of ['buildID:String','cycleSequence:UInt64','terminalKind:CycleTerminalEvidence.TerminalKind','cycleFinished:Bool','finishedAt:Date'])assert.ok(model.includes(field),`missing ${field}`);
 for(const field of ['normalDiscoveryOutcome','originalNormalDiscoveryFailureReason','recentSafetyProbeAttempted','probeJSOutcome','probeListReceived','probeConsumeResult','probeTerminalResult','discoveryFinalizedAfterProbe','candidatesBuiltAfterProbe','coverageComplete','cycleRootResponseReceived','probeContributedPartition','admittedCandidateCount'])assert.match(model,new RegExp(`let ${field}:`));
 assert.match(helper,/cycleSequence:evidence\.cycleSequence/);assert.match(helper,/terminalKind= evidence\.terminalKind|let terminalKind=evidence\.terminalKind/);
 assert.match(helper,/cycleFinished:true/);assert.match(helper,/finishedAt:finishedAt/);assert.match(helper,/buildID:buildID/);
 assert.doesNotMatch(helper,/self\.|Prototype|cycleToken|cycleState|cycleRootResponseReceived\s*=|UserDefaults|FileManager/);
 for(const forbidden of ['conversationId','title','records','messages','url','headers','authorization','body','rawProbeResponse'])assert.doesNotMatch(model,new RegExp(forbidden,'i'));
 assert.doesNotMatch(helper,/write\(|JSONEncoder|UserDefaults|FileManager/);
});
test('Task 90 forensic admission history is merged before the final ChatRecord write',()=>{
 const model=fs.readFileSync(path.join(__dirname,'CycleModel.swift'),'utf8');
 assert.match(engine,/mergingForensicHistory\(from:cycleState\.records\[record\.conversationId\],into:&saved\)[\s\S]{0,160}cycleState\.records\[record\.conversationId\]=saved/);
 assert.match(model,/func mergingForensicHistory\(from current:ChatRecord\?,into saved:inout ChatRecord\)/);
});

test('complete base triggers one pinned prefix pass, never a required starred endpoint',()=>{
 const start=section(engine,'func startCycle(trigger:String)','func checkRecord(');
 assert.doesNotMatch(start,/gptOpenStarredSection/);
 assert.match(start,/let explicitStarredObserved=observations\.contains/);
 assert.match(start,/baseDiscoveryComplete,!explicitStarredObserved\s*\{/);
 assert.match(start,/discoverPinnedPrefix\(renderLeaseOwner:renderLeaseOwner\)/);assert.match(start,/starredProofState\.finishFallback\(proof\)[\s\S]*starredProofState:starredProofState/);
 assert.match(start,/discoveryRateLimited/);assert.match(engine,/cyclePinnedReport/);
 assert.match(model,/30 \* 60/);
});
test('old pinned metadata resolution never configures full history; only recent records enter queue',()=>{
 const loader=section(engine,'func loadPinnedActivity','func checkRecord(');
 assert.doesNotMatch(loader,/gptConfigureCheck|gptScrollHistory/);
 assert.match(engine,/lastSeenUpdatedAt>=cycleCutoffTimestamp/);
 assert.match(engine,/let checkCandidates=Array\(checkCandidatesByID\.values\)[\s\S]*let queue=cycleState\.queue\(checkCandidates\)/);
 assert.match(main,/cycleRootStatuses.insert\(429\)/);
});

test('each recent chat has a hard bounded timeout and timeout does not block later chats or the next tick',()=>{
 const start=section(engine,'func startCycle(trigger:String)','func discoverPinnedPrefix(');
 const record=section(engine,'func checkRecord(','\n}');
 assert.match(start,/ChatCheckBudgetController\(checkStartedAt:Date\(\),cycleDeadline:cycleHardDeadline\)/);
 assert.match(start,/isolateCheck\(budget:checkBudget\)/);
 assert.match(start,/Timed out · per_chat_timeout/);
 assert.match(start,/defer \{[\s\S]*cycleGate\.end\(\)[\s\S]*scheduleCycle\(\)/);
 assert.match(record,/defer \{_=clearChatCheckState\(ownerGeneration:token,caller:"worker defer"\);activeChatCheckWorkers\.remove\(token\)\}/);
 assert.match(record,/while Date\(\)\.timeIntervalSince\(start\)<180/);
 assert.match(model,/DispatchQueue\.global\(\)\.asyncAfter\(deadline:\.now\(\)\+max\(0,timeoutSeconds\),execute:timeout\)/);
 assert.match(model,/race\.finish\(\.success\(\.failure\(IsolatedCheckError\.timeout\)\)\)/);
 assert.match(model,/func isolateCheck<T>\(timeoutSeconds:TimeInterval=60/);
 assert.doesNotMatch(record,/web\.reload\(\)|gptConfigureCheck\?\.\(.*history/);
});

test('production per-chat timeouts preserve sanitized stage and operation evidence',()=>{
 const start=section(engine,'func startCycle(trigger:String)','func discoverPinnedPrefix(');
 const record=section(engine,'func checkRecord(','\n}');
 assert.match(model,/struct ChatCheckStageTelemetry/);
 assert.match(record,/ChatCheckStageTelemetry\(renderLeaseActive:backgroundRenderLeaseOwner != nil\)/);
 assert.match(record,/navigation_started/);assert.match(main,/routeReached=true/);
 assert.match(main,/message\.name=="chatCheck"/);assert.match(main,/recordChatCheckActivity\(data\)/);
 assert.match(activityHook,/gptReportHistoryRequest/);assert.match(activityHook,/gptChatCheckHookHealth/);
 assert.match(listHook,/gptReportHistoryRequest\?\.\(raw,requestRateContext\)/);
 for(const stage of ['history_wait_started','history_response_seen','pagination_started','pagination_page_seen','aggregation_started','aggregation_complete','history_complete','chat_check_finished'])assert.ok(model.includes(`"${stage}"`)||main.includes(`"${stage}"`)||record.includes(`"${stage}"`),`missing ${stage}`);
 assert.match(start,/isolateCheck\(budget:checkBudget\)/);
 assert.match(start,/per_chat_timeout/);assert.match(start,/timeoutSubtype/);
 assert.match(start,/clearChatCheckState\(ownerGeneration:chatCheckTelemetry\?\.operationGeneration \?\? "",caller:"timeout handler"\)/);
 assert.match(record,/defer \{_=clearChatCheckState/);
 assert.match(record,/navigationObjectReturned=true/);
 assert.match(model,/terminal:"Failed · no_progress/);
 assert.match(record,/noProgressTerminalDecision/);
 assert.match(start,/cycleFreshRiskCounts\["Unknown",default:0\] \+= 1/);
 assert.match(model,/var timeoutSubtype/);
 assert.match(model,/stageBeforeFinish \?\? stage/);
 assert.match(model,/hookHealthRecorded \? [\s\S]*: "unobserved"/);
 assert.doesNotMatch(activityHook,/messageText|responseBody|rawURL/);
});

test('no-progress terminal uses accepted page evidence without requiring a live automation update',()=>{
 const record=section(engine,'func checkRecord(','\n}');
 const parser=section(engine,'func recordChatCheckHistoryResponseParsing(',' func cycleProvenanceSummary(');
 const nativePage=section(engine,'func recordChatCheckPage(',' func recordChatCheckActivity(');
 assert.match(model,/func isHistoryProgressProven\(acceptedPages:Int,pageUpdateCallbacks:Int,producedMessages:Int,paginationProgressObserved:Bool\)->Bool/);
 assert.match(model,/struct ChatCheckProgressAccumulator/);
 assert.match(model,/func noProgressTerminalDecision\(existing:SafeAggregate\?,candidate:SafeAggregate\?,hasProvenHistoryProgress:Bool,hasPreviousPage:Bool\?,completionProven:Bool,subtype:String\)/);
 assert.match(record,/let matchingUpdate=automationUpdate\.flatMap/);
 assert.match(record,/let progressState=telemetry\?\.checkProgress \?\? ChatCheckProgressAccumulator\(\)/);
 assert.match(record,/hasProvenHistoryProgress:progressState\.hasProvenHistoryProgress[\s\S]*completionProven:progressState\.historyCompleteProven/);
 assert.match(record,/hasPreviousPage:progressState\.hasPreviousPage/);
 assert.doesNotMatch(record,/hasPreviousPage:matchingUpdate\?\.state\.hasPreviousPage \?\? progressState\.hasPreviousPage/);
 assert.match(parser,/telemetry\.checkProgress\.observeParsedResponse\(entry\)/);
 assert.match(parser,/chatCheckTelemetry=telemetry[\s\S]*cycleState\.observePerChatHistoryDiagnostic\(telemetry\)/);
 assert.match(nativePage,/telemetry\.checkProgress\.observeNativePage\(/);
 assert.match(model,/mutating func observe\(telemetry:ChatCheckStageTelemetry\)[\s\S]*parserAccepted=telemetry\.checkProgress\.parserAccepted[\s\S]*pagesProduced=telemetry\.checkProgress\.pagesProduced/);
 assert.match(record,/noProgressTerminalDecision\(existing:record\.aggregate,candidate:matchingUpdate\?\.state[\s\S]*if decision\.terminal\.hasPrefix\("Partial"\) \{return\(decision\.aggregate,decision\.terminal\)\}/);
 assert.match(record,/if update\.state\.historyComplete \{[\s\S]*record\.aggregate\?\.historyComplete != true \|\| update\.overlap \|\| update\.oldest/);
 assert.doesNotMatch(model,/func hasProvenHistoryProgress\([^}]*historyResponses/);
 assert.match(model,/usableCandidate\.messagesCollected>=existing\.messagesCollected && usableCandidate\.estimatedTextTokens>=existing\.estimatedTextTokens/);
});

test('accepted hasPreviousPage false is carried from the terminal page through persistence and clears stale uncertainty',()=>{
 const aggregator=fs.readFileSync(path.join(__dirname,'../extension/aggregator.js'),'utf8');
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const record=section(engine,'func checkRecord(','\n}');
 const cycleState=section(engine,'func startCycle(trigger:String)','func discoverPinnedPrefix(');
 assert.match(aggregator,/if \(page\.hasPreviousPage === false\) \{\s*state\.hasPreviousPage = false;[\s\S]*state\.historyComplete = true;/);
 assert.match(bridge,/state=GptLimitsAggregator\.mergePage\(state,acceptedPage\)/);
 assert.match(record,/if update\.state\.historyComplete \{[\s\S]*recordCompletionProof\(\)[\s\S]*return\(update\.state,"Complete"\)/);
 assert.match(cycleState,/if result\.1=="Complete" \{saved\.lastCheckedUpdatedAt=record\.lastSeenUpdatedAt\}/);
 assert.match(cycleState,/if result\.1=="Complete" \{saved\.consecutiveIncompleteChecks=0;saved\.partialObservedActivityAt=nil;saved\.paginationBoundaryMessageCount=nil\}/);
 assert.match(cycleState,/if completeAndCurrent \{saved\.uncertainSince=nil;saved\.uncertainAcknowledgedAt=nil\}/);
});

test('continuation carries canonical parser progress and rejected generations are recorded safely',()=>{
 const record=section(engine,'func checkRecord(','\n}');
 const parser=section(engine,'func recordChatCheckHistoryResponseParsing(',' func cycleProvenanceSummary(');
 assert.match(engine,/historyProgress:firstTelemetry\.checkProgress/);
 assert.match(record,/telemetry\.checkProgress=continuation\.historyProgress/);
 assert.match(record,/telemetry\.hasPreviousPage=continuation\.historyProgress\.hasPreviousPage \?\? continuation\.aggregate\.hasPreviousPage/);
 assert.match(parser,/historyProgressEventRejectionReason\(eventGeneration:eventGeneration,activeGeneration:automationToken,telemetryGeneration:telemetryGeneration\)/);
 assert.match(parser,/recordHistoryProgressEventRejection\(rejection\)/);
 assert.match(model,/func historyProgressEventRejectionReason\(/);
 assert.match(model,/struct HistoryProgressEventRejectionState:Codable,Equatable/);
 assert.match(main,/History parser event rejections:/);
});

test('current DOM turn evidence is sampled in the standard check and distinguishes rendered history from missing network history',()=>{
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const detector=section(bridge,'window.gptConversationTurnReadiness=',' let liveResumeRun=null;');
 const record=section(engine,'func checkRecord(','\n}');
 const evidence=section(engine,'func recordChatCheckDOMTurnEvidence(',' func recordChatCheckContinuationResponse(');
 assert.match(detector,/\[data-turn-key\]/);assert.match(detector,/GptHistoryCollector\.findScrollableContainers/);
 assert.match(detector,/outermostCandidates/);assert.match(detector,/data-user-message-bubble/);assert.match(detector,/data-chatgpt-agent-turn-start/);
 assert.match(detector,/let source='legacy'/);assert.doesNotMatch(detector,/textContent|innerText|data-turn-key.*getAttribute/);
 assert.match(record,/window\.gptConversationTurnReadiness\?\.\(\)/);assert.match(record,/recordChatCheckDOMTurnEvidence/);
 assert.match(evidence,/renderedDOMTurnCount/);assert.doesNotMatch(evidence,/historyResponses\s*=|historyComplete\s*=|processedMessageIds/);
 assert.match(record,/renderedDOMTurnCount \?\? 0\)>0,chatCheckTelemetry\?\.historyResponses==0[\s\S]*Partial · rendered_history_without_network/);
 assert.match(model,/rendered_dom_history_without_network/);
 assert.match(model,/renderedDOMTurnCount/);
});

test('v5.42 per-chat ownership fences stale cleanup and reports each pagination page without identifiers',()=>{
 const record=section(engine,'func checkRecord(','\n}');
 const clear=section(engine,'func clearChatCheckState(ownerGeneration:String,caller:String)','@objc func runCycle()');
 assert.match(record,/generationCreated=true/);assert.match(record,/operationGeneration=token/);
 assert.match(record,/defer \{_\=clearChatCheckState\(ownerGeneration:token,caller:"worker defer"\);activeChatCheckWorkers\.remove\(token\)\}/);
 assert.match(clear,/guard !ownerGeneration\.isEmpty else\{return false\}/);
 assert.match(clear,/guard automationToken==ownerGeneration else/);
 assert.match(clear,/restoreRuntimeUserScripts\(\)/);
 assert.match(startCycleText(),/clearChatCheckState\(ownerGeneration:chatCheckTelemetry\?\.operationGeneration \?\? "",caller:"timeout handler"\)/);
 function startCycleText(){return section(engine,'func startCycle(trigger:String)','func discoverPinnedPrefix(');}
 assert.match(model,/struct ChatPaginationPageTelemetry/);assert.match(model,/struct ChatPaginationProgressTracker/);
 assert.match(model,/repeatedProgressToken/);assert.match(model,/repeatedPage/);assert.match(model,/shouldStopForNoProgress/);
 assert.match(engine,/recordChatCheckPage\(_ update:AutomationUpdate/);assert.match(main,/recordChatCheckPage\(update\)/);
 assert.match(record,/Partial · pagination_no_progress/);
 assert.match(record,/Failed · navigation_no_progress/);assert.match(record,/navigation_not_started/);
 assert.match(model,/pagination\.currentlyProgressing \? "pagination_progressing":"pagination"/);
 assert.match(engine,/hookHealthRecorded=true/);assert.match(model,/unobserved/);
 assert.match(clear,/cleanupOwnershipResult=caller=="timeout handler"/);
 assert.match(engine,/Render lease cleanup:/);
 assert.match(engine,/owner generation/);
 assert.match(startCycleText(),/isolateCheck\(budget:checkBudget\)/);
 assert.doesNotMatch(record,/web\.reload\(\)/);
});

test('v5.59 allows one bounded same-document continuation after replay or new-history progress',()=>{
 const start=section(engine,'func startCycle(trigger:String)','func discoverPinnedPrefix(');
 const record=section(engine,'func checkRecord(','\n}');
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 assert.match(start,/var continuationUsed=false/);
 assert.match(start,/continuationAlreadyUsed:continuationUsed/);
 assert.match(start,/let timedOut:Bool=/);
 assert.match(start,/result\.1=="Partial · pagination_no_progress"/);
 assert.match(start,/firstTelemetry\.pagination\.replayProgressObserved/);
 assert.match(start,/firstTelemetry\.pagination\.olderHistoryProgressObserved/);
 assert.match(start,/uniqueMessagesBeyondBaseline:firstTelemetry\.pagination\.olderUniqueBaselineMessageCount/);
 assert.match(start,/hasPreviousPage:firstProgress\.state\.hasPreviousPage==true/);
 assert.match(start,/firstPassHistoryRequests:firstTelemetry\.historyRequests,firstPassHistoryResponses:firstTelemetry\.historyResponses/);
 assert.match(start,/let firstProgress=chatCheckTerminalUpdate \?\? automationUpdate/);
 assert.match(start,/historyComplete:firstProgress\.state\.historyComplete/);
 assert.match(start,/let remainingBudget=max\(0,60-elapsed\)/);
 assert.match(start,/isolateCheck\(budget:checkBudget\)/);
 assert.match(start,/checkBudget\.beginContinuation\(at:Date\(\),baseBudgetMs:Int\(remainingBudget\*1000\)\)/);
 assert.match(start,/activeChatCheckWorkers\.contains/);
 assert.match(start,/scheduler-continuation-/);
 assert.match(start,/withBackgroundRenderSurface\(owner:continuationLeaseOwner\)/);
 assert.match(record,/checkRecord\(_ record: ChatRecord,continuation:ChatCheckContinuationCheckpoint\?=nil,budget:ChatCheckBudgetController\)/);
 assert.match(record,/chatCheckTerminalUpdate=nil/);
 assert.match(record,/context\?\["documentIdentity"\] as\? String==continuation\.documentIdentity/);
 assert.match(record,/web\.load\(URLRequest\(url:URL\(string:"https:\/\/chatgpt\.com\/c\/"\+record\.conversationId\)!\)\)/);
 assert.match(record,/if let continuation \{[\s\S]*config\["continuation"\]=true;config\["expectedFrontier"\]=continuation\.frontierTimestamp[\s\S]*config\["hasPreviousPage"\]=continuation\.hasPreviousPage/);
 assert.match(record,/gptSetRateLimitContext\?\.\(\\\(contextJSON\)\[0\],\\\(contextJSON\)\[1\],\\\(contextJSON\)\[2\]\)/);
 assert.match(engine,/observeContinuationPage\(sequence:update\.received,messageCount:update\.state\.messagesCollected,olderUniqueMessages:update\.olderUniqueMessageCount/);
 assert.match(model,/continuation_request_observer_missed_progress/);assert.match(model,/continuation_response_observer_missed_progress/);
 assert.match(model,/continuationPageResponses>0 \|\| continuationAggregateGrowth>0 \|\| continuationOlderUniqueMessages>0/);
 assert.match(bridge,/page\.liveResumeGeneration!==config\.token/);
 assert.match(bridge,/Number\(item\.activityTime\)<config\.expectedFrontier/);
 assert.match(bridge,/olderUniqueMessageCount:continuationOlderIds\.size/);
 assert.match(bridge,/pageActivityMinimum,pageActivityMaximum,pageDirection:direction,pageFingerprint:fingerprint,pageKnownMessageCount:knownPageIds,pageReplay:replayPage/);
 assert.match(bridge,/newHistoryProgress,replayProgressObserved,replayPagesProgressed/);
 assert.match(bridge,/olderPageTransition&&pageNewBaselineIds\.size>0&&acceptedPage\.hasPreviousPage===true/);
 assert.match(model,/validReplayProgress=isReplay && pageDirection=="older" && olderBounds && !repeatedFingerprint && hasPreviousPage==true/);
 assert.match(model,/replayProgressObserved \|\| \(newHistoryProgressObserved && uniqueMessagesBeyondBaseline>0\)/);
 assert.match(bridge,/window\.gptLiveResumeCaptureGeneration=c\.token/);
 const clear=section(engine,'func clearChatCheckState(ownerGeneration:String,caller:String)','@objc func runCycle()');
 assert.match(clear,/if automationUpdate\?\.token==ownerGeneration \{chatCheckTerminalUpdate=automationUpdate\}/);
 assert.match(model,/paginationFrontierTimestamp/);
 assert.match(model,/continuationFirstPassPages/);
 assert.match(main,/documentIdentity:String\?/);
 assert.match(main,/olderUniqueMessageCount:Int\?/);
 assert.doesNotMatch(record,/web\.reload\(\)/);
});

test('v5.43 cycle summary buckets the same final per-chat results as detailed reports',()=>{
 assert.match(model,/struct CycleChatOutcomeCounts/);
 assert.match(engine,/cycleChatTerminalResults\.append\(terminal\)/);
 assert.match(engine,/CycleChatOutcomeCounts\(finalPerChatResults:cycleChatTerminalResults,freshRiskCounts:cycleFreshRiskCounts\)/);
 assert.match(engine,/Checked: .*summary\.checked/);
 assert.doesNotMatch(engine,/var checked=0,failed=0,partial=0/);
});

test('per-chat timing telemetry measures replay corridor without changing bounded budgets',()=>{
 const timing=section(model,'struct ChatCheckTimingTelemetry {','\n}\n\nstruct ChatCheckStageTelemetry');
 assert.match(timing,/check_started/);assert.match(timing,/first_history_request/);assert.match(timing,/first_history_response/);
 assert.match(timing,/first_cached_replay_page/);assert.match(timing,/last_cached_replay_page_before_new_history/);
 assert.match(timing,/first_genuinely_new_older_page/);assert.match(timing,/first_new_identity_added/);assert.match(timing,/last_progress_event/);assert.match(timing,/per_chat_timeout_fired/);
 assert.match(timing,/continuationCachedReplayPages/);assert.match(timing,/continuationNewHistoryPages/);assert.match(timing,/timeoutPhase/);
 assert.match(timing,/min\(600000,max\(0,Int\(date\.timeIntervalSince\(origin \?\? checkStartedAt\)\*1000\)\)\)/);
 assert.match(engine,/timing\.recordHistoryRequest\(at:Date\(\)\)/);
 assert.match(engine,/timing\.recordContinuationResponse\(data,at:now\)/);
 assert.match(engine,/recordContinuationAggregateProgress\(olderUniqueMessages:update\.olderUniqueMessageCount \?\? 0,at:now\)/);
 assert.match(engine,/isolateCheck\(budget:checkBudget\)/);
 assert.match(engine,/remainingBudget=max\(0,60-elapsed\)/);
});

test('v5.104 budget decisions are explicit, pure, and preserve existing bounded policy',()=>{
 const controller=section(model,'final class ChatCheckBudgetController','enum IsolatedCheckError');
 const decision=section(model,'func decideBudgetExtension','struct ChatCheckBudgetSnapshot');
 const timing=section(model,'struct ChatCheckTimingTelemetry {','\n}\n\nstruct ChatCheckStageTelemetry');
 const start=section(engine,'func startCycle(trigger:String)','func discoverPinnedPrefix(');
 const record=section(engine,'func checkRecord(','\n}');
 assert.match(controller,/extensionPoolRemainingMs=60000/);
 assert.match(decision,/min\(30000,input\.extensionPoolRemainingMs,input\.absoluteTimeRemainingMs,input\.cycleBudgetRemainingMs\)/);
 assert.match(decision,/age<=10000/);assert.match(decision,/hasPreviousPage==false/);
 for(const reason of ['no_genuine_history_progress','genuine_progress_stale','has_previous_page_false','extension_pool_exhausted','absolute_cap_reached','cycle_budget_insufficient'])assert.ok(decision.includes(`"${reason}"`),`missing ${reason}`);
 assert.match(controller,/let hitAbsoluteCap=now>=passAbsoluteDeadline \|\| now>=chatDeadline/);
 assert.match(controller,/now>=cycleDeadline/);
 assert.match(controller,/cachedReplayAt/);
 assert.match(controller,/decisions\.append\(decision\)/);
 assert.match(timing,/not_evaluated/);assert.match(timing,/recent_cached_replay_progress/);assert.match(timing,/recent_genuine_history_progress/);assert.match(timing,/recent_any_pagination_progress/);
 assert.match(start,/started\.addingTimeInterval\(600\)/);
 assert.match(start,/var continuationUsed=false/);
 assert.match(start,/cycleBudgetSkipped/);
 assert.match(start,/if workerStopped && remainingBudget>0 \{[\s\S]*checkBudget\.beginContinuation/);
 assert.match(model,/terminal:"Partial · no_progress/);
 assert.match(record,/noProgressTerminalDecision/);
});

test('v5.1 isolated prefix reuses its pinned IDs for bounded activity resolution',()=>{
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 assert.match(bridge,/activityInternal=options\.includePinnedRecords===true[\s\S]*activityDiagnosticToken===window\.gptPinnedActivityDiagnosticToken/);
 assert.match(bridge,/window\.gptResolvePinnedRecords\?\.\(pinnedIds\)/);
 const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
 const diagnostic=section(main,'@objc func diagnosePinnedActivityTimestamp()','@objc func diagnoseSidebarRoutes()');
 assert.match(diagnostic,/gptInspectVisiblePinnedRows\(\{maxRows:20,hardTimeoutMs:600000,preflightTimeoutMs:18000,[\s\S]*includePinnedRecords:true/);
 assert.equal((diagnostic.match(/gptInspectVisiblePinnedRows\(/g)||[]).length,1,'prefix must be found only once per invocation');
 assert.match(diagnostic,/if pinnedActivityDiagnosticToken != nil \|\| pinnedActivityLaunchPending/);assert.match(diagnostic,/guard pinnedActivityDiagnosticToken==nil else \{rejectPinnedActivityLaunch\(\"probe_already_running\"\);return\}/);assert.match(diagnostic,/guard pinnedActivityLaunchPending else \{rejectPinnedActivityLaunch\(\"launch_not_pending\"\);return\}/);assert.match(diagnostic,/pinnedPrefixStatus/);assert.match(diagnostic,/pinnedActivityReadiness/);assert.match(diagnostic,/pinnedActivityTopReason/);assert.match(diagnostic,/pinnedActivityPrefixSnapshotCount/);
 assert.match(diagnostic,/pinnedActivityTimestampStage=PinnedTimestampState\.notStarted\.rawValue/);assert.match(diagnostic,/Timestamp stage: /);
 assert.match(diagnostic,/beginPinnedSidebarNavigation\(id:id,route:exactRoute/);
 assert.doesNotMatch(diagnostic,/gptConfigureCheck|gptScrollHistory|fetch\(/);
 assert.match(main,/pinnedActivityExpectedConversationID/);assert.match(main,/pinnedActivityItemTimeoutTask/);assert.ok(diagnostic.includes('Recent:'));
 assert.match(main,/button\("Inspect pinned prefix \+ activity",\s*#selector\(diagnosePinnedActivityTimestamp\)\)/);
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 assert.match(bridge,/PINNED_DIAGNOSTIC_VERSION='__PINNED_DIAGNOSTIC_VERSION__'/);
 assert.match(main,/replacingOccurrences\(of:"__PINNED_DIAGNOSTIC_VERSION__",with:pinnedDiagnosticVersion\)/);
 assert.match(main,/Bundle\.main\.executableURL\?\.standardizedFileURL\.path/);
 assert.match(main,/Bundle\.main\.bundleURL\.standardizedFileURL\.path/);
 assert.match(main,/func runtimeSourceClassification\(\)/);
 assert.match(main,/installedRoot=.*GPT Limits Tool\.app/);
 assert.match(main,/installed\/local release/);
 assert.match(main,/gptLimitsExecutableBuildIDMarker/);
 assert.match(main,/ProcessInfo\.processInfo\.processIdentifier/);
 assert.ok(main.includes('Runtime source: \\(source)'));
assert.match(main,/guard pinnedDiagnosticVersion=="6.1.0", runtimeSource != "unexpected"/);
 assert.match(bridge,/stageRun=async\(stage,fn,timeoutMs\)/);assert.match(bridge,/boundedDiagnosticAwait\(stage,fn,timeoutMs\)/);
 for(const stage of ['invoke_started','readiness_started','readiness_completed','top_started','top_completed','prefix_started','prefix_completed','menu_cleanup_started','menu_cleanup_completed','cleanup_started','cleanup_completed','finished'])assert.ok(bridge.includes(`'${stage}'`),`missing JS stage ${stage}`);
 assert.match(main,/handlePinnedActivityProgress/);assert.match(main,/stage_timeout:/);assert.match(main,/pinnedActivityJSPromiseStatus/);assert.match(main,/pinnedActivitySwiftCompletion/);
 assert.match(main,/case "readiness_started","diagnostic_readiness_started": return 20/);assert.match(main,/case "top_started": return 3/);assert.match(main,/case "prefix_started": return Double\(pinnedActivityTraversalBudgetMs\+pinnedActivityCleanupReserveMs\)\/1000/);assert.match(main,/case "cleanup_started": return Double\(pinnedActivityCleanupReserveMs\)\/1000/);assert.match(main,/Task\.sleep\(nanoseconds:8_000_000_000\)/);assert.match(main,/navigation_observation_not_started/);assert.match(main,/timestamp_timeout/);
 assert.match(main,/preflightTimeoutMs:18000/);assert.match(main,/webViewVisible:/);assert.match(main,/navigationActive:/);assert.match(main,/preflightSummary/);assert.match(bridge,/documentReadyState/);assert.doesNotMatch(bridge,/conversation_list_unavailable/);assert.match(bridge,/document_not_ready/);assert.match(bridge,/sidebar_unavailable/);assert.match(bridge,/Math\.min\(6000,rowBudget\)/);
 const probeHandler=section(main,'func handlePinnedActivityProbe','@objc func diagnoseSidebarRoutes()');
 assert.match(probeHandler,/let jsTimestampStage=result\["timestampStage"\]/);assert.match(probeHandler,/pinnedActivityRecords=result\["pinnedRecords"\]/);assert.match(probeHandler,/schedulePinnedActivityResolver\(token:token\)/);
 assert.match(bridge,/quietWindowMs=320/);assert.match(bridge,/stableChecks>=4/);assert.match(bridge,/signature=rows\.map/);assert.match(bridge,/const finishOnce=/);assert.match(bridge,/finalSnapshotCount/);assert.match(bridge,/firstPositiveCount/);assert.match(bridge,/timeToFirstPositiveMs/);
 assert.match(bridge,/initialSnapshot=readCurrentSnapshot\(\)/);assert.match(bridge,/prefixSnapshot=\(activityInternal\|\|cycleInternal\)\?initialSnapshot:initialSnapshot\.slice\(0,maxRows\)/);assert.match(bridge,/resolveSnapshotRow=item/);assert.match(bridge,/anchor=resolveSnapshotRow\(snapshotRow\)/);assert.match(bridge,/row_missing_after_snapshot/);
 assert.match(bridge,/domConversationsBeforeMenu/);assert.match(bridge,/domConversationsAfterCleanup/);assert.match(bridge,/prefixSnapshotCount/);
 assert.match(bridge,/const reconcileSnapshot=/);assert.match(bridge,/snapshotExpansionCount>=3/);assert.match(bridge,/live\.length>maxRows\|\|expanded\.length>maxRows\)\{markTraversalTerminal\('snapshot_reconciliation',live\.length>absoluteSnapshotSafetyCap\|\|expanded\.length>absoluteSnapshotSafetyCap\?'snapshot_exceeds_traversal_cap':'snapshot_exceeds_traversal_budget'/);assert.match(bridge,/sidebar_snapshot_unstable/);assert.match(bridge,/prefixSnapshot=expanded/);assert.match(bridge,/classified=new Map\(\),processed=new Set\(\)/);
 assert.match(bridge,/traversalTerminal:\{lastCompletedStage:lastCompletedTraversalStage,stage:traversalTerminalStage,internalReason:stopReason/);assert.match(bridge,/semanticSnapshotValid:acceptedSemanticSnapshot\? !firstSemanticSnapshotChange:null/);
 assert.match(engine,/Traversal terminal: last successful stage[\s\S]*failure stage[\s\S]*canonical fallback reason/);assert.match(main,/bridge_result_invalid/);assert.match(engine,/bridge_result_missing/);
 assert.match(bridge,/const timestampEligible=activityInternal&&complete&&pinnedIds\.length>0/);assert.match(bridge,/timestampRecords=pinnedIds\.map/);assert.match(bridge,/timestamp_dispatch_allowed/);assert.match(bridge,/timestampStage:timestampEligible\?'started'/);
 const finished=section(main,'func finishPinnedActivityDiagnostic()','func resolveNextPinnedActivity(');
 for(const field of ['firstPositiveCount','finalStableCount','finalSnapshotCount','timeToFirstPositive','timeToStable','Prefix snapshot: initial','expansions','sequence:','First not-pinned found:','exact prefix reason:','DOM conversations before/after cleanup per row'])assert.ok(finished.includes(field),`missing detailed result field ${field}`);
 assert.match(finished,/let withScrollDiagnostics=withWaitState\.replacingOccurrences/);assert.match(finished,/setLastIsolatedDiagnostic\(withScrollDiagnostics\.replacingOccurrences/);assert.ok(finished.includes('pinnedActivityScrollAttemptsSummary'));assert.ok(finished.includes('Activity wait state:'));assert.ok(finished.includes('Timestamp stage: \\(pinnedActivityTimestampStage)'));assert.ok(finished.includes('Activity timestamps (UTC)'));assert.ok(finished.includes('Cutoff (UTC)'));const visibleMessage=finished.slice(finished.indexOf('let message='),finished.indexOf('let withObservation='));assert.doesNotMatch(visibleMessage,/pinnedActivityRecords|conversationId|title|expectedConversationID/);
 assert.match(main,/Prefix snapshot:/);assert.match(main,/DOM conversations before\/after cleanup per row:/);
});

test('v5.2 timestamp lifecycle blocks premature finish and terminalizes every item exactly once',()=>{
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 assert.match(model,/enum PinnedTimestampState: String/);for(const state of ['not_started','resolving','resolved','partial','timeout','error','skipped'])assert.ok(model.includes(`"${state}"`));
 assert.match(model,/var isTerminal:Bool/);assert.match(model,/func pinnedTimestampAggregateState/);assert.match(model,/func pinnedTimestampItemCanTransition/);assert.match(model,/func pinnedDiagnosticCanFinish/);assert.match(model,/itemStates\.contains\("pending"\)/);
 const progress=section(main,'func handlePinnedActivityProgress','func updatePinnedActivityStage');assert.match(progress,/if stage=="finished" \{return\}/);
 const finish=section(main,'func finishPinnedActivityDiagnostic()','@discardableResult func completePinnedActivityItem');assert.match(finish,/guard pinnedDiagnosticCanFinish/);
 const resolver=section(main,'@discardableResult func completePinnedActivityItem','func handlePinnedActivityProbe');
 assert.match(resolver,/pinnedTimestampItemCanTransition/);assert.match(resolver,/state:\.timeout/);assert.match(resolver,/state:\.error/);assert.match(resolver,/navigation_timeout/);assert.match(main,/activity_response_timeout/);assert.match(resolver,/pinnedActivityItemTimeoutTask\?\.cancel\(\)/);
 assert.match(resolver,/finishPinnedActivityTimestamps/);assert.doesNotMatch(resolver,/gptConfigureCheck|gptScrollHistory/);
 const probe=section(main,'func handlePinnedActivityProbe','@objc func diagnoseSidebarRoutes');const resolverSchedule=section(main,'func schedulePinnedActivityResolver(token:String)','@MainActor func resolveNextPinnedActivity(');assert.match(probe,/pinnedActivityTimestampStage=PinnedTimestampState\.resolving\.rawValue/);assert.match(resolverSchedule,/pinnedActivityTimestampStage=PinnedTimestampState\.timeout\.rawValue/);assert.match(probe,/finishPinnedActivityDiagnostic\(\)/);
 assert.match(finish,/Timestamp items:/);assert.match(finish,/pinnedActivityTimestampReason/);
 const modelTests=fs.readFileSync(path.join(__dirname,'CycleModelTests.swift'),'utf8');assert.match(modelTests,/!pinnedDiagnosticCanFinish\(timestampExpected:true,timestampState:\.resolving\)/);assert.match(modelTests,/timestampState:\.resolved,itemStates:\["pending"\]/);assert.match(modelTests,/late success after timeout is ignored/);assert.match(modelTests,/timeout after success is cancelled/);
});

test('v5.6 timestamp provenance separates passive cache, navigation, and activity response terminals',()=>{
 const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
 const hook=fs.readFileSync(path.join(__dirname,'activity-hook.js'),'utf8');
 const list=fs.readFileSync(path.join(__dirname,'list-hook.js'),'utf8');
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 const resolver=section(main,'func resolveNextPinnedActivity(token:String)','func handlePinnedActivityProbe');
 assert.ok(resolver.indexOf('if validPinnedActivity(record)')<resolver.indexOf('fallback_started'));
 for(const state of ['timestamp_started','passive_lookup_started','passive_lookup_hit','passive_lookup_miss','fallback_started','fallback_navigation_started','timestamp_resolved'])assert.ok(resolver.includes(`"${state}"`),`missing provenance stage ${state}`);
 assert.match(resolver,/passiveMatch/);assert.match(resolver,/matchingMetadataRecords/);assert.match(resolver,/updateTimePresent/);assert.match(main,/activity_live_wait_deadline_started/);
 assert.match(main,/activity_response_timeout/);assert.match(main,/navigation_finished/);assert.match(main,/activity_response_waiting/);
 for(const reason of ['navigation_command_failed','navigation_provisional_failed','navigation_failed','navigation_timeout','route_mismatch','activity_response_timeout','activity_timestamp_missing','timestamp_parse_failed'])assert.ok(main.includes(`"${reason}"`),`missing terminal reason ${reason}`);
 assert.match(resolver,/frontendRoute/);assert.match(resolver,/beginPinnedSidebarNavigation/);assert.doesNotMatch(resolver,/https:\/\/chatgpt\.com\/c\/\+id/);
 assert.match(main,/didStartProvisionalNavigation/);assert.match(main,/didCommit navigation/);assert.match(main,/didFinish navigation/);assert.match(main,/didFailProvisionalNavigation/);assert.match(main,/didFail navigation/);
 assert.match(main,/navigation===active/);assert.match(main,/pinnedActivityRouteConfirmed/);assert.match(main,/pinnedActivityPendingResponse/);assert.match(main,/activity_response_waiting/);
 assert.match(engine,/record\["frontendRoute"\]/);assert.match(engine,/cyclePinnedNavigationFinished/);assert.match(engine,/validPinnedActivity\(activity\)/);
 assert.match(engine,/p\.match\(\/\^\\\\\/g/);assert.doesNotMatch(engine,/https:\/\/chatgpt\.com\/c\/"\+id/);
 assert.ok(hook.includes('conversations?\\/([A-Za-z0-9-]+)(?:\\/messages)?'));assert.match(hook,/conversationId,timestamp:/);assert.match(hook,/endpointFamily,httpStatus/);assert.match(hook,/operationOwner:context\.owner/);assert.match(hook,/operationGeneration:context\.generation/);assert.match(hook,/timestampFieldType/);assert.match(hook,/timestampSource/);assert.doesNotMatch(hook,/sessionStorage|responseSeen:true/);
 assert.match(list,/isConversationActivityPath/);assert.match(list,/\/messages/);assert.match(list,/passiveMatch:true/);
 assert.doesNotMatch(resolver,/gptConfigureCheck|gptScrollHistory|gptStartHistory|aggregate/);
 assert.match(main,/Full history triggered: No/);assert.match(main,/pinnedActivityExpectedConversationID=nil/);
});

test('v5.7 preserves exact pinned routes and sequences native navigation before activity waiting',()=>{
 const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const engine=fs.readFileSync(path.join(__dirname,'CycleEngine.swift'),'utf8');
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 assert.match(bridge,/exactConversationRouteFromAnchor/);
 assert.match(bridge,/frontendRoute:pinnedRoutes\.get\(conversationId\)\|\|null/);
 const resolver=section(main,'func resolveNextPinnedActivity(token:String)','func handlePinnedActivityProbe');
 assert.match(resolver,/record\["frontendRoute"\]/);assert.match(resolver,/beginPinnedSidebarNavigation\(id:id,route:exactRoute/);
 assert.doesNotMatch(resolver,/URL\(string:"https:\/\/chatgpt\.com\/c\/"\+id/);
 const begin=section(main,'func beginPinnedActivityNavigation','func isCurrentPinnedNavigation');
 assert.match(begin,/resolvedWebView\.load\(URLRequest\(url:components\.url!\)\)/);assert.match(begin,/return await observePinnedNavigationInline/);assert.doesNotMatch(begin,/seconds:10,reason:"navigation_timeout"/);
 assert.match(begin,/pinnedActivityNavigationCommandAccepted=true/);assert.match(begin,/navigation_command_sent/);
 for(const callback of ['didStartProvisionalNavigation','didCommit navigation','didFinish navigation','didFailProvisionalNavigation','didFail navigation'])assert.ok(main.includes(callback),`missing WKWebView delegate ${callback}`);
 assert.match(main,/navigation===active/);assert.match(main,/navigationErrorSummary/);
 const finish=section(main,'func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!)','func webView(_ webView:WKWebView,didCommit');
 assert.ok(finish.indexOf('navigation_finished')<finish.indexOf('confirmPinnedActivityRoute'));
 const confirm=section(main,'func confirmPinnedActivityRoute','@MainActor func beginPinnedActivityNavigation');
 assert.ok(confirm.indexOf('route_confirmed')<confirm.indexOf('activity_response_waiting'));
 assert.match(finish,/conversationRouteTemplate\(webView\.url\?\.path/);assert.match(finish,/conversationID\(in:webView\.url\)==id/);
 assert.match(main,/return "\/c\/<id>"/);assert.match(main,/return "\/g\/<id>\/c\/<id>"/);
 assert.match(main,/pinnedActivityPendingResponse=data/);assert.match(main,/if pinnedActivityRouteConfirmed \{handleConfirmedPinnedActivityResponse/);
 const fallback=section(main,'func finishPinnedActivityFallback','func handleConfirmedPinnedActivityResponse');
 assert.match(fallback,/pinnedActivityNavigation=nil/);assert.match(fallback,/pinnedActivityNavigationOperationToken=nil/);assert.match(fallback,/web\.stopLoading\(\)/);
 const resolverCycle=section(engine,'func loadPinnedActivity(_ record:[String:Any])','func conversationID(in url:URL)');
 assert.match(resolverCycle,/record\["frontendRoute"\]/);assert.match(resolverCycle,/cyclePinnedNavigationFinished/);
 assert.match(resolverCycle,/routeConversation==id/);assert.match(resolverCycle,/pinnedActivityEventMatches\(activity,expectedConversationID:id/);
 assert.doesNotMatch(resolverCycle,/https:\/\/chatgpt\.com\/c\/"\+id/);
 assert.doesNotMatch(resolver,/fetch\(|URLSession|backend-api/);assert.doesNotMatch(resolver,/gptConfigureCheck|gptScrollHistory|gptStartHistory/);
});

test('v5.4 hidden render experiment is non-key, bounded, read-only, and restores captured window state',()=>{
 const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 const action=section(main,'@objc func inspectHiddenWebViewRendering()','func finishHiddenRenderDiagnostic(');
 assert.match(action,/let original=renderControlState\(\)/);
 assert.match(action,/window\.gptRenderStateSnapshot/);assert.match(action,/gptInspectRenderDOM/);assert.match(action,/renderSurfaceActive:false/);assert.match(action,/timeoutMs:5000/);assert.match(action,/Task\.sleep\(nanoseconds:8_000_000_000\)/);
 assert.doesNotMatch(action,/makeKey|makeKeyAndOrderFront|NSApp\.activate|orderFront|orderOut|ignoresMouseEvents=true|web\.isHidden=false|\.load\(|\.reload\(|\.click\(/);
 const finish=section(main,'func finishHiddenRenderDiagnostic(','@objc func diagnosePinnedActivityTimestamp()');
 assert.match(finish,/renderDiagnosticRestore\?\(\)/);assert.match(finish,/Window\/focus state unchanged/);
 assert.match(main,/hiddenRenderOutcome\(hiddenList:/);
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const render=section(bridge,'window.gptInspectRenderDOM=async(options={})=>{',' const waitForPinnedReadinessPreflight=async(options={})=>{');
 assert.match(render,/new MutationObserver/);assert.match(render,/setInterval\(sample,100\)/);assert.match(render,/Math\.min\(5000/);assert.match(render,/disconnect/);
 assert.doesNotMatch(render,/fetch\(|location\.(?:assign|replace)|\.click\(|reload\(|gptInspectVisiblePinnedRows/);
});

test('v5.82 readiness telemetry and terminal verdict share one acceptance predicate',()=>{
 const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
 const helper=section(main,'func sidebarScrollReadinessAcceptance(now:UInt64)','func processSidebarScrollReadinessSample(');
 assert.match(helper,/sidebarScrollReadinessStablePolls>=4/);assert.match(helper,/elapsedNs>=320_000_000/);assert.match(helper,/countCondition && durationCondition/);
 assert.match(helper,/rows>0 && duplicates==0 && missing==0 && root && context=="chatgpt.com"/);
 const process=section(main,'func processSidebarScrollReadinessSample(','func finishSidebarScrollReadiness(');
 assert.match(process,/let acceptance=sidebarScrollReadinessAcceptance\(now:now\)/);assert.match(process,/if acceptance\.accepted/);
 const finish=section(main,'func finishSidebarScrollReadiness(','@objc func diagnoseVisiblePinnedRows(');
 assert.match(finish,/let acceptance=sidebarScrollReadinessAcceptance\(now:DispatchTime\.now\(\)\.uptimeNanoseconds\)/);
 assert.match(finish,/acceptance\.accepted \? "snapshot_ready"/);assert.match(finish,/"stableSnapshotAccepted":acceptance\.accepted/);
 assert.match(finish,/"stableCountCondition":acceptance\.countCondition/);assert.match(finish,/"stableDurationCondition":acceptance\.durationCondition/);
 assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
});

test('v5.34 automatic and isolated prefix share readiness and top proof while retaining the production render lease',()=>{
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const prefix=section(bridge,'window.gptInspectVisiblePinnedRows=async(options={})=>{',' window.gptRunPinnedSidebarDiagnostic=async()=>{');
 assert.match(prefix,/waitForPinnedReadinessPreflight\(/);
 assert.match(prefix,/inspectConversationListTopState\(root,\{normalizeFirstRow:true\}\)/);
 assert.match(prefix,/topProof=atTop\?'top_proven':hasConversationRows\?'top_unproven':'not_run'/);
 assert.match(prefix,/if\(!readiness\.ready\)\{stopReason=readiness\.status/);
 assert.match(bridge,/diagnosticStatus=terminalReason==='ready'\?'snapshot_ready':firstPositiveAt===null\?\(snap\.root\?'rows_never_appeared':'sidebar_root_missing'\):'rows_appeared_but_never_stabilized'/);
 assert.match(bridge,/supportedConversationContext/);assert.match(bridge,/wrong_route_or_context/);assert.match(bridge,/sidebar_root_missing/);
 const engine=fs.readFileSync(path.join(__dirname,'CycleEngine.swift'),'utf8');
 const cycle=section(engine,'func startCycle(trigger:String)','func discoverPinnedPrefix(');
 const resolver=section(engine,'func discoverPinnedPrefix(renderLeaseOwner:String)','func validPinnedActivity(');
 assert.ok(cycle.indexOf('acquireBackgroundRenderSurface(owner:renderLeaseOwner)')<cycle.indexOf('discoverPinnedPrefix(renderLeaseOwner:renderLeaseOwner)'));
 const prefixCall=cycle.indexOf('discoverPinnedPrefix(renderLeaseOwner:renderLeaseOwner)');
 assert.ok(prefixCall>=0&&prefixCall<cycle.indexOf('restoreBackgroundRenderSurface(owner:renderLeaseOwner)',prefixCall));
 assert.match(resolver,/let leaseAcquired=backgroundRenderLeaseOwner==renderLeaseOwner/);
 assert.match(resolver,/maxRows:20,hardTimeoutMs:40000,preflightTimeoutMs:18000/);
 assert.match(resolver,/renderActivationElapsedMs:/);assert.match(resolver,/renderLeaseTimeToFirstConversationLinkMs:/);
 assert.match(main,/normalizeTop:true,webViewVisible:/);
 const lease=section(main,'func acquireBackgroundRenderSurface(owner:String)','func evaluateRenderReadiness');
 assert.match(lease,/backgroundRenderLeaseReadiness=readiness/);assert.match(lease,/let ready=\(readiness\["ready"\] as\? Bool\)==true/);
 assert.match(lease,/guard ready,links>0/);assert.match(lease,/firstPositiveCount/);
 for(const field of ['Sidebar candidates','list-region candidates','first conversation links','stable conversation links','Readiness','Top proof','rows inspected','Prefix'])assert.ok(resolver.includes(field),`missing production telemetry ${field}`);
 assert.match(resolver,/lease held through result/);
});

test('v5.36 first-row normalization reports active-context geometry without DOM content and preserves proof gates',()=>{
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const top=section(bridge,'const inspectConversationListTopState=async(inputRoot','const failedConversationListTopState=');
 for(const field of ['scrollableAncestorFound','viewportTop','viewportBottom','fullyAboveViewport','intersectsViewport','displayNone','visibilityHidden','ariaHidden','zeroSize','sameScrollContainer','activeSidebarCandidate','maxAboveViewportDeltaPx','preceding_row_above_viewport_at_scroll_origin','scrollIntoView({block:\'start\',inline:\'nearest\',behavior:\'auto\'})','first_row_scroll_normalization_failed','active_context_changed_after_scroll','firstRowVisibleAfter'])assert.ok(top.includes(field),`missing geometry/normalization field ${field}`);
 assert.match(bridge,/const activeSidebarSnapshot=\(\)=>/);assert.match(bridge,/const actuallyRendered=el=>/);assert.match(bridge,/inactiveCandidateCount/);assert.match(bridge,/duplicateConversationRows/);
 const cycle=fs.readFileSync(path.join(__dirname,'CycleEngine.swift'),'utf8');
 assert.match(cycle,/Preceding rows: fully above[\s\S]*same scroll container[\s\S]*max above delta/);
 assert.match(cycle,/First-row normalization: invoked[\s\S]*changed ancestors[\s\S]*first row visible after/);
 assert.match(cycle,/duplicate conversation rows across candidates/);assert.match(cycle,/inactive rows excluded/);
 assert.match(cycle,/Pinned relevant total: \\\(pinnedTotal\.map\(String\.init\) \?\? "unknown"\)/);
 assert.match(model,/timestampsResolved==pinnedCount/);
 for(const sensitive of ['innerText','textContent','href:anchor','title:anchor'])assert.equal(top.includes(sensitive),false);
});

test('isolated pinned-group diagnostic targets the shared ChatGPT WebView and returns async results through its bridge', () => {
  const diagnostic = section(main, '@objc func diagnoseStarredControl()', '    func startListDiagnostic(');
  assert.match(diagnostic, /web\.url\?\.host == "chatgpt\.com"/);
  assert.match(diagnostic, /web\.evaluateJavaScript\("typeof window\.gptRunPinnedSidebarDiagnostic/);
  assert.match(diagnostic, /window\.gptRunPinnedSidebarDiagnostic/);
  assert.match(diagnostic, /messageHandlers\.starredDiagnostic\.postMessage\(\{result\}\)/);
  assert.match(diagnostic, /Diagnostic hook available: Yes/);
  assert.match(main, /config\.userContentController\.add\(self, name: "starredDiagnostic"\)/);
  assert.match(main, /message\.name=="starredDiagnostic"/);
  assert.match(main, /WKUserScript\(source:guarded,injectionTime:\.atDocumentStart/);
  const bridge = fs.readFileSync(path.join(__dirname, 'automation-bridge.js'), 'utf8');
  assert.match(bridge, /const sidebarSnapshot=/);
  assert.match(bridge, /const pinnedSidebarSnapshot=root=>/);
  assert.match(bridge, /window\.gptRunPinnedSidebarDiagnostic=async/);
  assert.match(bridge, /window\.gptSummarizePinnedLinkSources/);
  const pinnedDiagnostic = section(bridge, 'window.gptRunPinnedSidebarDiagnostic=async()=>{', ' window.gptInspectStarredControl=');
  assert.doesNotMatch(pinnedDiagnostic, /\.click\(/);
  assert.match(bridge, /relationships/);
  assert.match(bridge, /regionCounts/);
  assert.match(bridge, /routeKind/);
  assert.match(pinnedDiagnostic, /delete safeStructure\.pinnedIds/);
  assert.match(pinnedDiagnostic, /delete safeStructure\.allVisibleConversationIds/);
});

test('first-row pin diagnostic uses one semantic menu button without native hover',()=>{
 assert.match(main,/button\("Inspect sidebar route templates",\s*#selector\(diagnoseSidebarRoutes\)\)/);
 for(const label of ['Inspect sidebar top position','Inspect pinned rows at sidebar top','Inspect hidden WebView rendering','Inspect pinned prefix + activity']) assert.ok(main.includes(`button("${label}"`),`missing diagnostics action ${label}`);
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 assert.match(main,/var latestIsolatedDiagnosticText="Last isolated diagnostic: not run"/);
 assert.match(main,/func setLastIsolatedDiagnostic\(_ message:String\)/);
 const menuResult=section(main,'if let result=payload["firstRowMenuResult"]','if let progress=payload["topChatPinProgress"]');
 assert.match(menuResult,/setLastIsolatedDiagnostic/);assert.doesNotMatch(menuResult,/starredDiagnosticOutput\.stringValue/);
 assert.match(menuResult,/pinActionPresent/);assert.match(menuResult,/unpinActionPresent/);assert.match(menuResult,/menuLeftOpen/);
 const routeDiagnostic=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 assert.match(routeDiagnostic,/window\.gptInspectSidebarRoutes=\(\)=>/);
 assert.match(routeDiagnostic,/acceptedTemplates:\['\/c\/<id>','\/g\/<id>\/c\/<id>','\/g\/<id> \(project\)','\/<id> \(Octane sidebar item\)','\/<id>\/<id> \(Octane sidebar item\)'\]/);
 assert.match(routeDiagnostic,/safeRouteTemplate/);
 assert.match(routeDiagnostic,/PINNED_DIAGNOSTIC_VERSION='__PINNED_DIAGNOSTIC_VERSION__'/);
 const action=section(main,'@objc func diagnoseFirstRowMenuTrigger()','    func finishPinDiagnostic(');
 assert.match(action,/gptInspectFirstRowMenuTrigger/);
 assert.match(action,/window\.pinnedDiagnosticVersion/);assert.doesNotMatch(action,/makeKeyAndOrderFront|NSApp\.activate/);
 assert.match(action,/Task\.sleep\(nanoseconds:10_000_000_000\)/);
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const diagnostic=section(bridge,'window.gptInspectFirstRowMenuTrigger=async()=>{',' window.gptRunPinnedSidebarDiagnostic=async()=>{');
 assert.match(diagnostic,/for\(let level=1;node&&node!==first\.root&&level<=6/);
 assert.match(diagnostic,/conversationLinks===1&&menuButtons\.length===1/);
 assert.doesNotMatch(diagnostic,/closest\?\.\('\[data-thread-title-trigger\]'\)/);
 assert.match(diagnostic,/sidebarSized/);
 assert.match(diagnostic,/button\[aria-haspopup="menu"\]/);assert.match(diagnostic,/dispatch\(trigger,'pointerdown',true,1\)/);assert.match(diagnostic,/triggerStateAfterPointerdown=state\(trigger\)/);
 assert.match(diagnostic,/new MutationObserver\(collectMutations\)/);assert.match(diagnostic,/afterSequenceCounts/);
 assert.match(diagnostic,/triggerCount/);assert.match(diagnostic,/conversationLinks>1\|\|menuButtons\.length>1/);
 assert.match(diagnostic,/openPopupCandidates\(\)/);assert.match(diagnostic,/Math\.min\(ms,Math\.max\(0,deadline-Date\.now\(\)\)\)/);
 assert.match(diagnostic,/finally\{/);assert.match(diagnostic,/sendEscape\(\)/);
 assert.doesNotMatch(diagnostic,/action\.click\(\)|menuItem\.click\(\)/);assert.match(diagnostic,/pinActionPresent/);assert.match(diagnostic,/unpinActionPresent/);
 assert.match(diagnostic,/PINNED_DIAGNOSTIC_VERSION/);assert.doesNotMatch(diagnostic,/trigger\.click\(\)/);
 assert.doesNotMatch(main,/CGEvent|CGWarpMouseCursorPosition|diagnoseNativeHover|nativeScreenPoint/);
 assert.doesNotMatch(bridge,/gptPrepareNativeHover|gptFinishNativeHover|nativeHoverState/);
});

test('v4.5 readiness and pinned-prefix share bounded row wait and top proof, preserving reason and privacy',()=>{
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const diagnostic=section(bridge,'window.gptInspectVisiblePinnedRows=async(options={})=>{',' window.gptRunPinnedSidebarDiagnostic=async()=>{');
 assert.match(bridge,/const waitForConversationRowsReady=\(timeoutMs=4000,overallDeadline=Infinity,options=\{\}\)=>new Promise\(resolve=>/);assert.match(bridge,/const inspectConversationListTopState=async\(inputRoot/);assert.match(bridge,/gptInspectSidebarTopPosition=async\(options=\{\}\)=>[\s\S]*waitForConversationRowsReady\(options\.readinessTimeoutMs\)/);assert.match(diagnostic,/const readinessBudget=18500/);assert.match(diagnostic,/waitForPinnedReadinessPreflight/);assert.match(diagnostic,/inspectConversationListTopState\(root/);assert.match(diagnostic,/topReason=top\.reason/);assert.match(diagnostic,/top_unproven/);assert.match(diagnostic,/Math\.min\(\(activityInternal\|\|cycleInternal\)\?absoluteSnapshotSafetyCap:20/);
 const cycle=fs.readFileSync(path.join(__dirname,'CycleEngine.swift'),'utf8');assert.match(cycle,/gptInspectVisiblePinnedRows\([\s\S]*cycleToken/);
 assert.match(diagnostic,/dispatchMenuSequence\(trigger\)/);assert.match(diagnostic,/sendEscape\(\)/);assert.match(diagnostic,/cleanup_failed/);
 assert.match(diagnostic,/minimalMenuRow\(anchor,root\)/);assert.match(diagnostic,/if\(activityInternal\)\{if\(diagnosticFirstOrdinaryRow===null\)diagnosticFirstOrdinaryRow=rowNumber;\}/);assert.match(diagnostic,/else\{stopReason='first_not_pinned'/);assert.match(diagnostic,/firstNotPinnedFound/);assert.match(diagnostic,/pinned_prefix_complete/);assert.match(diagnostic,/if\(options\.cycleToken\)/);assert.match(diagnostic,/gptSummarizePinnedLinkSources\?\.\(pinnedIds\)/);
 assert.match(diagnostic,/pinnedStructureComplete/);assert.match(diagnostic,/observedStreams/);
 assert.doesNotMatch(diagnostic,/postMessage\([^)]*(?:conversationId|title|href|pinnedIds)/s);
 assert.match(main,/visiblePinnedRowsResult/);assert.ok(main.includes('Readiness: \\(readiness["status"] as? String ?? "unknown")'));assert.ok(main.includes('Top: \\(top["proof"] as? String ?? "unproven") · Reason: \\(top["reason"] as? String ?? "unknown")'));assert.match(main,/setLastIsolatedDiagnostic\(message\)/);
});

test('v5.22 awaits an exactly-once bounded activity wait and preserves child timeout reason',()=>{
 const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 const begin=section(main,'@MainActor func beginPinnedActivityNavigation','func isCurrentPinnedNavigation');
 assert.ok(begin.indexOf('pinnedActivityWaiterArmed=true')<begin.indexOf('resolvedWebView.load('));
 assert.ok(begin.indexOf('pinnedActivityWaiterToken=token')<begin.indexOf('resolvedWebView.load('));
 const bridge=section(main,'if message.name=="activity"','if message.name=="starredDiagnostic"');
 assert.match(bridge,/pinnedActivityWaiterArmed/);assert.match(bridge,/pinnedActivityEventMatches\(data,expectedConversationID:expected/);
 assert.match(bridge,/pinnedActivityPendingResponse=data;pinnedActivityResponseBufferedBeforeRoute=true/);assert.match(bridge,/pinnedActivityUnrelatedActivityEvents\+=1/);
 const confirm=section(main,'@MainActor func confirmPinnedActivityRoute','@MainActor func beginPinnedActivityLiveWait');
 assert.ok(confirm.indexOf('route_confirmed')<confirm.indexOf('activity_buffer_checked'));
 assert.match(confirm,/activity_buffer_hit/);assert.match(confirm,/activity_buffer_miss/);assert.match(confirm,/beginPinnedActivityLiveWait\(token:token,id:id,ordinal:ordinal\)/);
 assert.doesNotMatch(confirm,/cache|gptResolvePinnedRecords/);assert.doesNotMatch(main,/func recheckPinnedActivityPassiveCache/);
 const live=section(main,'@MainActor func beginPinnedActivityLiveWait','@MainActor func finishPinnedActivityLiveWait');
 assert.match(live,/pinnedActivityLiveWaitState="waiting"/);assert.match(live,/activity_live_wait_deadline_started/);assert.match(live,/Task\.sleep\(nanoseconds:8_000_000_000\)/);
 const finishWait=section(main,'@MainActor func finishPinnedActivityLiveWait','@MainActor func awaitPinnedActivityLiveWait');
 assert.match(finishWait,/pinnedActivityLiveWaitCanFinish\(state:pinnedActivityLiveWaitState\)/);assert.match(finishWait,/continuation\.resume\(returning:result\)/);assert.match(finishWait,/pinnedActivityLiveWaitTimeoutTask\?\.cancel\(\)/);
 const resolver=section(main,'@MainActor func resolveNextPinnedActivity','func handlePinnedActivityProbe');
 assert.ok(resolver.indexOf('await beginPinnedSidebarNavigation')<resolver.indexOf('await awaitPinnedActivityLiveWait'));
 assert.match(resolver,/case \.timeout:[\s\S]*activity_response_timeout/);assert.match(resolver,/applyConfirmedPinnedActivityResponse\(data,token:token,id:id,ordinal:ordinal\)/);
 const event=section(main,'func handleConfirmedPinnedActivityResponse','func applyConfirmedPinnedActivityResponse');
 assert.match(event,/pinnedActivityLiveWaitState=="waiting"/);assert.match(event,/result:\.response\(data\)/);assert.match(event,/pinnedActivityLiveWaitState=="not_started"/);
 const generic=section(main,'let budget=max(120','await self.resolveNextPinnedActivity');
 assert.match(generic,/pinnedActivityGenericTimeoutActivityState/);assert.match(generic,/pinnedActivityLiveWaitState=="waiting"/);assert.match(generic,/finishPinnedActivityLiveWait[\s\S]*return/);assert.match(generic,/\["response_received","timeout","error"\]/);
 const failStage=section(main,'func failPinnedActivityStage','func finishPinnedActivityDiagnostic');
 assert.match(failStage,/pinnedActivityLiveWaitState=="waiting"[\s\S]*finishPinnedActivityLiveWait[\s\S]*return/);
 assert.match(main,/pinnedActivityLiveWaitDurationMs/);assert.match(main,/activity_response_timeout/);assert.match(main,/activity_timestamp_missing/);
 const finish=section(main,'func finishPinnedActivityDiagnostic()','@discardableResult func completePinnedActivityItem');
 assert.match(finish,/Navigation\/menu cleanup:/);assert.match(finish,/Render lease cleanup:/);assert.match(finish,/Overall cleanup:/);assert.match(finish,/backgroundRenderLeaseRestoreDetails/);
 const restore=section(main,'func restoreBackgroundRenderSurface(owner:String)->Bool','func withBackgroundRenderSurface');
 for(const field of ['frameRestored','orderingRestored','ignoresMouseEventsRestored','ownershipReleased'])assert.ok(restore.includes(field),`missing restore substep ${field}`);
assert.match(main,/guard pinnedDiagnosticVersion=="6.1.0", runtimeSource != "unexpected"/);
});

test('v5.23 passively observes sanitized responses while native operation filtering remains isolated',()=>{
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 assert.match(main,/config\.userContentController\.add\(self, name: "backendTraffic"\)/);
 const hook=fs.readFileSync(path.join(__dirname,'activity-hook.js'),'utf8');
 assert.match(hook,/window\.gptObserveBackendResponse=/);
 const observe=section(hook,'window.gptObserveBackendResponse=','const family=path=>');
 assert.match(observe,/capturedAtMs/);assert.match(observe,/conversationId:id/);assert.match(observe,/timestampValue/);
 assert.doesNotMatch(observe,/operationGeneration|backendTrafficObservation\?\.active/);
 for(const forbidden of ['rawURL','rawUrl','query:', 'body:', 'messageText','title:'])assert.equal(observe.includes(forbidden),false,`unsafe bridge field ${forbidden}`);
 const list=fs.readFileSync(path.join(__dirname,'list-hook.js'),'utf8');
 assert.match(list,/window\.gptObserveBackendResponse\?\.\(raw,payload,meta\?\.status\)/);
 assert.match(list,/observePassiveBackendResponse\(raw,response\)/);
 assert.match(list,/gptObserveConversationActivity\?\.\(raw,body,response\.status,requestRateContext,backendTrafficContext\)/);
 const handler=section(main,'func handlePinnedBackendTraffic','func recordPinnedActivityNavigationStage');
 assert.match(handler,/pinnedActivityBackendResponsesObserved\+=1/);assert.match(handler,/pinnedActivityBackendFamilies\[family,default:0\]\+=1/);
 assert.match(handler,/pinnedActivityBackendExpectedMatches\+=1/);assert.match(handler,/pinnedActivityBackendTimestampBearingMatches\+=1/);
 assert.match(handler,/window\.accepts\(generation:token,receivedAtMs:receivedAt,conversationID:conversationID\)/);
 assert.match(main,/activity_response_timeout/);assert.match(main,/activity_timestamp_missing/);assert.match(main,/timestamp_parse_failed/);
 assert.match(main,/Full history triggered: No/);
});

test('v5.32 uses anchor.click and a bounded native route observer',()=>{
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const list=fs.readFileSync(path.join(__dirname,'list-hook.js'),'utf8');
 const hook=fs.readFileSync(path.join(__dirname,'activity-hook.js'),'utf8');
 const resolver=section(main,'@MainActor func resolveNextPinnedActivity','func handlePinnedActivityProbe');
 const sidebar=section(main,'@MainActor func beginPinnedSidebarNavigation','@MainActor func finishPinnedSidebarNavigation');
 const helper=section(bridge,'const dispatchSidebarClick=',' const visibleConversationRows=');
 const lookup=section(bridge,'const lookupSidebarRow=',' const dispatchSidebarClick=');
 const entry=section(bridge,'window.gptSidebarNavigateSync=',' window.gptContinueSidebarScroll=');
 const routeWait=section(main,'@MainActor func beginPinnedSidebarRouteWait','@MainActor func finishPinnedSidebarNavigation');
 const routePoll=section(main,'@MainActor func pollPinnedSidebarRoute','@MainActor func beginPinnedSidebarRouteWait');
 const sidebarDispatch=section(main,'@MainActor func beginPinnedSidebarNavigation','@MainActor func finishPinnedSidebarNavigation');
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 assert.match(main,/name: "sidebarNavigation"/);
 assert.match(main,/message\.name=="sidebarNavigation"/);
 assert.match(resolver,/record\["frontendRoute"\]/);assert.match(resolver,/beginPinnedSidebarNavigation\(id:id,route:exactRoute/);
 assert.ok(sidebar.indexOf('pinnedActivityWaiterArmed=true')<sidebar.indexOf('pinnedActivityObservationWindow=ActivityObservationWindow'));
 assert.ok(sidebar.indexOf('pinnedActivityObservationWindow=ActivityObservationWindow')<sidebar.indexOf('gptSidebarNavigateSync'));
 assert.match(sidebar,/withCheckedContinuation/);assert.match(sidebar,/webView\.evaluateJavaScript\(invocation\)/);
 assert.match(sidebar,/typeof window\.gptInspectVisiblePinnedRows!=='function'/);assert.match(sidebar,/typeof window\.gptSidebarNavigateSync!=='function'/);
 for(const reason of ['sidebar_bridge_missing','sidebar_handler_missing','sidebar_sync_dispatch_error','sidebar_sync_dispatch_timeout','sidebar_row_missing','sidebar_row_ambiguous','sidebar_row_lookup_error'])assert.ok(sidebar.includes(reason),`missing synchronous dispatch failure reason ${reason}`);
 assert.doesNotMatch(sidebar,/sidebar_command_ack_timeout|pinnedSidebarNavigationAckTimeoutTask=Task/);assert.match(sidebar,/sidebar_navigation_bridge_timeout/);
 assert.doesNotMatch(sidebar,/window\.gptSidebarNavigate\?\./);const fallback=section(main,'func finishPinnedActivityFallback','func handleConfirmedPinnedActivityResponse');assert.match(fallback,/pinnedActivityChildTerminalReason=reason/);assert.match(fallback,/pinnedActivityTimestampReason=reason/);
 assert.ok(main.includes('Bridge dispatch: automation bridge \\(pinnedActivityAutomationBridgePresent'));
 assert.ok(main.includes('primitive result \\(pinnedActivitySidebarDispatchPrimitive'));
 assert.match(entry,/postSidebarNavigation\(generation,'sidebar_navigation_command_received'\)/);assert.ok(entry.indexOf("sidebar_navigation_command_received")<entry.indexOf("lookupSidebarRow"));
 assert.match(entry,/row_resolved_needs_scroll/);assert.doesNotMatch(entry,/Promise|await|setTimeout/);
 assert.match(sidebar,/finishPinnedSidebarNavigation\(token:token,result:false\)/);
 assert.match(lookup,/sidebar_row_lookup_started/);assert.match(lookup,/Array\.from\(document\.querySelectorAll\('a\[href\]'\)\)/);
 assert.match(lookup,/sidebar_row_anchor_scan_complete/);assert.match(lookup,/matchingAnchors:matches\.length/);assert.match(lookup,/sidebar_row_lookup_error/);
 assert.doesNotMatch(lookup,/conversationIdFromAnchor\(anchor\)|exactConversationRouteFromAnchor\(anchor\)|MutationObserver|TreeWalker|while\s*\(|Promise|await|setTimeout/);
 assert.match(helper,/anchor\.scrollIntoView\(\{block:'nearest',inline:'nearest'\}\)/);
 assert.match(helper,/sidebar_row_scroll_failed/);assert.match(helper,/row_ambiguous/);assert.match(helper,/row_missing/);
 assert.match(helper,/anchor\.click\(\)/);assert.doesNotMatch(helper,/dispatchEvent\(new (PointerEvent|MouseEvent)/);
 assert.match(helper,/sidebar_anchor_activation_prepared/);assert.match(helper,/targetAttributePresent/);assert.match(helper,/downloadAttributePresent/);assert.match(helper,/routeChangedImmediately/);
 assert.match(routeWait,/sidebar_route_wait_started/);assert.match(routeWait,/pinnedSidebarRouteWaitTimeoutTask=Task/);assert.match(routeWait,/sidebar_navigation_wrong_route/);assert.match(routeWait,/sidebar_navigation_no_effect/);
 assert.match(routePoll,/gptPinnedConversationRouteState/);assert.match(routePoll,/sidebar_route_reached/);
 assert.match(routeWait,/4_500_000_000/);assert.match(routePoll,/pinnedActivitySidebarRouteChangedDuringWait/);assert.match(routePoll,/finishPinnedSidebarRouteWait/);
 assert.match(main,/pinnedSidebarRouteWaitTimeoutTask\?\.cancel\(\);pinnedSidebarRouteWaitTimeoutTask=nil/);
 assert.match(main,/finishPinnedActivityFallback\(state:\.error,reason:terminal,token:token,id:id,ordinal:ordinal\)/);
 assert.doesNotMatch(sidebar,/gptWaitForSidebarRoute/);
 assert.doesNotMatch(helper,/dispatchEvent\(new (PointerEvent|MouseEvent)|button\.click|gptDispatchPinnedConversationLink/);
 assert.match(main,/func finishPinnedSidebarNavigation/);assert.match(main,/sidebar_row_scroll_failed/);assert.match(main,/launch_not_pending/);assert.match(main,/finishPinnedActivityFallback\(state:\.timeout,reason:"sidebar_navigation_bridge_timeout"/);
 assert.match(main,/sidebar_sync_dispatch_timeout/);assert.match(main,/sidebar_row_anchor_scan_complete/);assert.match(main,/pinnedActivitySidebarTotalAnchors/);assert.match(main,/pinnedActivitySidebarMatchingAnchors/);
 assert.match(model,/struct ActivityObservationWindow/);assert.match(model,/receivedAtMs>=startedAtMs/);
 const observe=section(hook,'window.gptObserveBackendResponse=','const family=path=>');
 assert.match(observe,/messageHandlers\?\.backendTraffic\?\.postMessage\(\{responseSequence,capturedAtMs,endpointFamily,httpStatus:safeStatus/);
 for(const forbidden of ['rawURL','rawUrl','query:', 'body:', 'messageText','title:'])assert.equal(observe.includes(forbidden),false,`unsafe bridge field ${forbidden}`);
 assert.doesNotMatch(observe,/backendTrafficObservation\?\.active/);
 assert.match(list,/const observe=\(raw,payload,meta,backendTrafficContext=null\)=>\{\s*window\.gptObserveBackendResponse\?\.\(raw,payload,meta\?\.status\)/);
 assert.match(list,/observePassiveBackendResponse\(raw,response\)/);
 const handler=section(main,'func handlePinnedBackendTraffic','func recordPinnedActivityNavigationStage');
 assert.match(handler,/window\.accepts\(generation:token,receivedAtMs:receivedAt,conversationID:conversationID\)/);
 assert.match(handler,/pinnedActivityPendingResponse=normalized/);
 const end=section(main,'func endPinnedBackendTrafficObservation','func restoreRuntimeUserScripts');
 assert.doesNotMatch(end,/evaluateJavaScript/);assert.match(end,/pinnedActivityObservationWindow=nil/);
 assert.match(main,/Activity observation window: native started[\s\S]*extra WebKit observer-arm call/);
 assert.match(main,/Full history triggered: No/);
});

test('v5.27 bridge timeout keeps its specific reason and launch gates never silently return',()=>{
 const start=section(main,'func continuePinnedActivityLaunch()','func rejectPinnedActivityLaunch');
 assert.match(start,/guard pinnedActivityDiagnosticToken==nil else \{rejectPinnedActivityLaunch\("probe_already_running"\);return\}/);
 assert.match(start,/guard pinnedActivityLaunchPending else \{rejectPinnedActivityLaunch\("launch_not_pending"\);return\}/);
 const timeoutAt=main.indexOf('self.pinnedActivityTimeoutTask=Task { @MainActor [weak self] in',main.indexOf('func schedulePinnedActivityResolver'));
 assert.notEqual(timeoutAt,-1);
 const timeout=main.slice(timeoutAt,main.indexOf('await self.resolveNextPinnedActivity(token:token)',timeoutAt));
 assert.match(timeout,/pinnedSidebarNavigationToken==token/);
 assert.match(timeout,/reason:"sidebar_navigation_bridge_timeout"/);
 assert.ok(timeout.indexOf('reason:"sidebar_navigation_bridge_timeout"')<timeout.indexOf('reason:"timestamp_timeout"'));
 assert.match(main,/pinnedSidebarNavigationTimeoutTask=Task \{ @MainActor \[weak self\] in[\s\S]*?sidebar_navigation_bridge_timeout/);
 assert.match(main,/pinnedActivityObservationWindow=ActivityObservationWindow[\s\S]*?gptSidebarNavigate/);
 assert.match(main,/activity_wait_armed/);
});

test('native risk UI uses a local beta fallback and only sanitized transition notifications',()=>{
 assert.match(model,/safeCeiling:210640,limitFloor:539543,watch:309311,near:407982,critical:473762/);
 assert.match(model,/normals.count>=2,limits.count>=2,let safe=normals.max\(\),let floor=limits.min\(\),safe<floor/);
 assert.match(model,/func riskUpwardCrossing/);assert.match(model,/measurement == \.complete/);
 assert.match(model,/func shouldDispatchSystemRiskNotification\(kind:String,level:String\)->Bool/);
 assert.match(model,/kind=="risk" && \["Watch","Near","Critical"\]\.contains\(level\)/);
 assert.match(engine,/guard shouldDispatchSystemRiskNotification\(kind:kind,level:level\) else\{return\}/);
 assert.match(engine,/notifications accepted/);assert.match(engine,/dispatch audit stored locally/);
 assert.match(model,/A recent chat is approaching the conversation length limit/);
 assert.match(model,/func riskNotificationContent\(level:String,chatTitle:String\?=nil,showChatTitle:Bool=true\)/);
 assert.match(model,/func riskNotificationRoute\(conversationID:String\)->String\?/);
 assert.match(model,/showChatTitlesInNotifications\(storedValue:Bool\?\)->Bool \{ storedValue \?\? true \}/);
 assert.match(engine,/riskNotificationContent\(level:level,chatTitle:saved\.title,showChatTitle:showChatTitlesInNotifications/);
 assert.match(engine,/submitMonitoredNotification\(kind:"risk",level:level,body:content\.body,conversationID:saved\.conversationId\)/);
 assert.match(engine,/content\.userInfo=\["conversationID":conversationID,"conversationRoute":riskNotificationRoute/);
 assert.doesNotMatch(engine,/content.body=.*record.title|content.body=.*conversationId/);
 assert.match(main,/Show chat titles in notifications/);
 assert.match(main,/register\(defaults:\[showChatTitlesInNotificationsDefaultsKey:true\]\)/);
 assert.match(main,/didReceive response:UNNotificationResponse[\s\S]*validatedRiskNotificationRoute[\s\S]*presentWindow\(self\.session,intent:\.userInitiated,callSite:"risk_notification_click"[\s\S]*web\.load\(URLRequest\(url:url\)\)/);
 assert.match(engine,/Risk model: .*thresholds Watch/);
 assert.match(engine,/model\.source\.rawValue/);
 assert.match(engine,/latest Complete checked chat/);
 assert.match(engine,/empirically labeled Limit reached/);
 assert.match(main,/Use latest complete chat as Normal sample/);
assert.match(main,/pinnedDiagnosticVersion="6.1.0"/);
});

test('v6.1.1 partial-risk notifications use one post-result decision for timeout and other incomplete outcomes',()=>{
 assert.match(model,/func incompleteRiskNotificationNeeded\(measurement:RiskMeasurementStatus,lastAcceptedRank:Int\?,lowerBoundTokens:Int\?,model:RiskModel\)->String\?/);
 assert.match(model,/guard measurement != \.complete else\{return nil\}[\s\S]*partialRiskNotificationNeeded/);
 assert.match(model,/case \.near:rank=2;case \.critical:rank=3;case \.normal,\.uncertain,\.watch:return nil/);
 assert.match(engine,/case \.failure\(let error\):[\s\S]*let partialAggregate=timeoutProgressPartialAggregate[\s\S]*terminal="Partial · pagination_progressing · per_chat_timeout[\s\S]*saved\.lastCheckResult=terminal[\s\S]*terminal="Timed out · per_chat_timeout[\s\S]*saved\.lastCheckResult=terminal[\s\S]*saved\.lastCheckResult="Failed · check_error"/);
 assert.match(engine,/let finalMeasurement=riskMeasurementStatus\(result:saved\.lastCheckResult,aggregate:saved\.aggregate\)[\s\S]*if let aggregate=saved\.aggregate,finalMeasurement != \.complete[\s\S]*incompleteRiskNotificationNeeded\(measurement:finalMeasurement,lastAcceptedRank:saved\.lastNotifiedRiskRank,lowerBoundTokens:aggregate\.estimatedTextTokens,model:model\)/);
 assert.match(engine,/func finishNotificationAudit[\s\S]*if kind=="risk",let rank=riskRank\(level\) \{record\.lastNotifiedRiskRank=rank\}/);
 assert.match(main,/let gptLimitsAppVersion="6\.2\.3"/);
 assert.match(main,/let pinnedDiagnosticVersion="6\.1\.0"/);
 assert.match(main,/guard bundleBuildVersion==gptLimitsAppVersion,[\s\S]*gptLimitsExecutableBuildVersionMarker==gptLimitsAppVersion/);
});

test('v6.2.2 persists sanitized per-chat navigation and history trace through terminal result',()=>{
 assert.match(model,/enum ChatCheckTraceStage:String,Codable,CaseIterable\s*\{[\s\S]*?checkStarted="check_started"[\s\S]*?terminalResult="terminal_result"/);
 assert.match(model,/struct ChatCheckTraceEvent:Codable,Equatable\s*\{[^}]*let elapsedMs:Int[^}]*let routeTemplate:String[^}]*let timestamp:Date/);
 assert.match(model,/func sanitizedChatCheckRoute\(_ url:URL\?\)/);
 assert.match(model,/return SanitizedChatCheckRoute\(template:"\/c\/:id",category:\.chat\)/);
 assert.match(model,/return SanitizedChatCheckRoute\(template:"\/:id\/:id",category:\.chat\)/);
 assert.match(engine,/cycleState\.beginChatCheckTrace\(route:sanitizedChatCheckRoute\(web\.url\)\)[\s\S]*saveCycle\(\)/);
 assert.match(engine,/recordPersistedChatCheckTrace\(stage:\.navigationRequested/);
 assert.match(main,/recordPersistedChatCheckTrace\(stage:\.navigationFinished[\s\S]*stage:\.conversationRouteObserved[\s\S]*stage:\.documentReady/);
 assert.match(engine,/recordPersistedChatCheckTrace\(stage:\.historyWaitStarted/);
 assert.match(engine,/recordPersistedChatCheckTrace\(stage:\.historyResponseObserved/);
 assert.match(engine,/recordPersistedChatCheckTrace\(stage:\.historyRowsObserved/);
 assert.match(engine,/finishPersistedChatCheckTrace\(terminalResult:[\s\S]*stage:\.terminalResult/);
 assert.match(engine,/lastChatCheckTraceOutput\.stringValue=cycleState\.lastChatCheckTrace\?\.displayText/);
 assert.match(model,/let elapsed=max\(0,min\(600000,Int\(at\.timeIntervalSince\(startedAt\)\*1000\)\)\)/);
 assert.match(model,/enum ChatCheckTraceReason:String,Codable/);
 const traceEvent=section(model,'struct ChatCheckTraceEvent:Codable,Equatable {','struct PersistedChatCheckTrace:Codable,Equatable');
 assert.doesNotMatch(traceEvent,/conversationId|rawURL|title|query|cookie|token/);
});

test('pinned unknown-row diagnostics are bounded, persisted, and do not alter pinned proof classification',()=>{
 const model=fs.readFileSync(path.join(__dirname,'CycleModel.swift'),'utf8');
 const engine=fs.readFileSync(path.join(__dirname,'CycleEngine.swift'),'utf8');
 const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 assert.match(bridge,/const unknownRowDiagnostics=rows\.filter\(row=>row\.status==='unknown'\)\.slice\(0,20\)/);
 assert.match(bridge,/dataAttributeNames,ariaAttributeNames,visible,conversationRouteClassification:route,navigationRowClassification:navigationClassification,pinnedStarredClassification:'unknown'/);
 assert.match(engine,/statuses\.contains\("unknown"\) \{proofFailureReason="unknown_row_in_stable_snapshot"\}/);
 assert.match(engine,/result\["unknownRowDiagnostics"\][\s\S]*compactMap\(PinnedUnknownRowDiagnostic\.make\)/);
 assert.match(engine,/cycleState\.lastPinnedUnknownRows=\[\]/);
 assert.match(model,/var lastPinnedUnknownRows:\[PinnedUnknownRowDiagnostic\]\? = nil/);
 assert.match(model,/static let maxRows=20/);
 assert.ok(main.includes('Pinned proof unknown rows: \\(pinnedUnknownRows.count)'));
 assert.match(main,/pinnedUnknownRowsRawOutput/);
});

test('v5.45 user dashboard separates diagnostics and restores interactive input after render cleanup',()=>{
 assert.match(main,/panel\.title = "GPT Limits Tool — Diagnostics"/);
 assert.match(main,/mainWindow\.title="GPT Limits Tool"/);
 assert.match(main,/func restoreInteractiveWindowState\(\)[\s\S]*window\.ignoresMouseEvents=false/);
 const restore=section(main,'func restoreBackgroundRenderSurface(owner:String)->Bool','func withBackgroundRenderSurface');
 assert.doesNotMatch(restore,/restoreInteractiveWindowState\(\)/);
 assert.match(restore,/guard let lease=backgroundRenderLease,lease\.owner==owner,backgroundRenderLeaseGate\.owner==owner/);
 assert.match(restore,/window ordering preserved/);assert.match(restore,/key\/main preserved/);assert.doesNotMatch(restore,/orderFront|orderOut|\.order\(|makeKey|makeMain|makeFirstResponder|NSApp\.activate/);
 for(const label of ['focus snapshot captured','window ordering preserved','key\/main preserved','GPT Limits Tool activation unchanged','first responder preserved','ownership released']) assert.ok(restore.includes(label),`missing cleanup telemetry ${label}`);
 assert.match(main,/@objc func showMainWindow\(\)[\s\S]*restoreInteractiveWindowState\(\)/);
 const dashboard=section(main,'func buildUserWindows()','func runtimeSourceClassification()');
 for(const label of ['Monitoring: Off','Last check: Never','Next check: Off','Coverage: Not checked','Confirmed conversation risks','Needs attention','Recent result','Check now','Open ChatGPT','Settings…','Diagnostics…']) assert.ok(dashboard.includes(label),`missing dashboard element ${label}`);
 assert.doesNotMatch(dashboard,/runtimeIdentityOutput|listDiagnosticOutput|cycleOutput|pinnedDiagnostic/);
 assert.match(main,/@objc func showPanel\(\)[\s\S]*?presentWindow\(panel,intent:\.userInitiated,callSite:"menu_diagnostics"\)/);
 assert.match(main,/@objc func setAutomaticChecks/);
 assert.match(main,/func refreshNotificationAuthorization\(completion:/);
 assert.match(model,/func userFacingRiskLabel/);
 assert.match(model,/func userFacingRiskChatTitle/);
 assert.match(model,/return \("GPT Limits Tool"/);
 assert.match(main,/panel\.acceptsMouseMovedEvents=true/);
 assert.match(main,/panel\.ignoresMouseEvents=false/);
});

test('v5.45 Open ChatGPT restores a visible interactive WebView and defers across render ownership',()=>{
assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 const show=section(main,'@objc func showSession','@objc func hideSession');
 assert.match(show,/restoreVisibleSessionPresentation\(\)/);
 const restore=section(main,'func restoreVisibleSessionPresentation()','@objc func hideSession');
 for(const state of [/session\.ignoresMouseEvents=false/,/session\.acceptsMouseMovedEvents=true/,/session\.alphaValue=1/,/web\.alphaValue=1/,/web\.isHidden=false/,/session\.contentView=web/,/web\.autoresizingMask=\[\.width,\.height\]/,/web\.layoutSubtreeIfNeeded\(\)/,/presentWindow\(session,intent:\.userInitiated,callSite:"open_chatgpt_session"\)/]) assert.match(restore,state,`visible-session restore missing ${state}`);
 assert.match(restore,/session\.frame\.width<640[\s\S]*?setContentSize\(NSSize\(width:1100,height:760\)\)/);
 assert.match(restore,/if web\.url\?\.host != "chatgpt\.com"[\s\S]*?web\.load\(/);
 assert.equal((restore.match(/web\.load\(/g)||[]).length,1); // navigation is only permitted in the missing/wrong-origin branch
 assert.match(main,/visibleSessionPresentationPending=true/);
 assert.match(main,/if visibleSessionPresentationPending \{restoreVisibleSessionPresentation\(\);return\}/);
 assert.ok(main.includes('Visible session presentation: \\(visibleSessionPresentationReport)'));
});

test('v5.46 render lease restores the captured window position without activating a hidden session',()=>{
 const restore=section(main,'func restoreBackgroundRenderSurface(owner:String)->Bool','func withBackgroundRenderSurface');
 const acquire=section(main,'func acquireBackgroundRenderSurface(owner:String) async throws','func evaluateRenderReadiness');
 assert.match(restore,/guard let lease=backgroundRenderLease,lease\.owner==owner,backgroundRenderLeaseGate\.owner==owner/);
 assert.match(restore,/window ordering preserved/);
 assert.match(restore,/first responder preserved/);
 assert.doesNotMatch(restore,/\.order\(|orderFront|orderOut|makeKey|makeMain|makeFirstResponder|NSApp\.activate|restoreInteractiveWindowState/);
 assert.match(acquire,/windowAboveNumber:aboveNumber/);
 assert.match(acquire,/firstResponder:WeakResponderReference/);
 for(const field of ['focus snapshot captured','window ordering preserved','key\/main preserved','GPT Limits Tool activation unchanged','first responder preserved','ownership released']) assert.ok(restore.includes(field),`missing cleanup telemetry ${field}`);
});

test('v5.49 manual diagnostics release terminal ownership and allow the next diagnostic',()=>{
 assert.match(main,/func finishListDiagnostic\(generation:UUID\)[\s\S]*listDiagnosticTask=nil[\s\S]*listDiagnosticMode=""[\s\S]*listDiagnosticGenerationGate\.finish\(generation\)/);
 assert.match(main,/func finishListDiagnosticCancellation\(generation:UUID\)[\s\S]*listDiagnosticGenerationGate\.finish\(generation\)/);
 assert.match(main,/reconcileStaleListDiagnosticGeneration\(\)/);
 assert.match(main,/listDiagnosticGenerationGate\.activeGeneration/);
 assert.match(main,/listDiagnosticTask\?\.isCancelled/);
 assert.match(main,/func manualDiagnosticOwnerLabel\(\)[\s\S]*reconcileStaleListDiagnosticGeneration\(\)/);
 assert.match(main,/Diagnostic running:/);
 const start=section(main,'func startListDiagnostic(visible:Bool,','func finishListDiagnostic(generation:UUID)');
 assert.match(start,/listDiagnosticGenerationGate\.tryBegin\(\)/);
 assert.match(start,/guard let self=self,self\.listDiagnosticGenerationGate\.owns\(generation\) else\{return\}/);
 assert.match(start,/finishListDiagnosticCancellation\(generation:generation\)/);
 const finish=section(main,'func finishListDiagnostic(generation:UUID)','@objc func checkFirstRecent');
 assert.match(finish,/listDiagnosticMode=""/);
 assert.match(finish,/listDiagnosticGenerationGate\.finish\(generation\)/);
});

test('v5.52 visible ChatGPT restore records sanitized paintability and invalidates only the existing WebView display',()=>{
 assert.match(main,/let pinnedDiagnosticVersion="6.1.0"/);
 const snapshot=section(main,'func sessionPresentationSnapshot()->String','func sessionRenderDOMSummary');
 assert.match(snapshot,/session\.isVisible/);assert.match(snapshot,/hitTest/);assert.match(snapshot,/higherWindowCoversCenter/);assert.match(snapshot,/web\.wantsLayer/);
 assert.match(main,/window\.gptSessionRenderSnapshot\?\.\(\) \|\| null/);
 const summary=section(main,'func sessionRenderDOMSummary','@objc func inspectVisibleSessionRendering');
 for(const field of ['DOM markers','render targets','selector counts','marker rect/style','target rect/style','viewport center hit'])assert.ok(summary.includes(field));
 const show=section(main,'func restoreVisibleSessionPresentation()','@objc func hideSession');
 assert.match(show,/web\.setNeedsDisplay\(web\.bounds\)/);
 assert.match(show,/web\.layer\?\.setNeedsDisplay\(\)/);
 assert.match(show,/session\.contentView\?\.setNeedsDisplay/);
 assert.match(show,/web\.displayIfNeeded\(\)/);
 assert.equal((show.match(/web\.load\(/g)||[]).length,1);
 const js=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const render=js.slice(js.indexOf('window.gptSessionRenderSnapshot='),js.indexOf('window.gptInspectRenderDOM='));
 assert.match(render,/getBoundingClientRect/);assert.match(render,/getComputedStyle/);
 assert.doesNotMatch(render,/innerText|textContent|conversationId|messageId|\.href/);
 const watch=js.slice(js.indexOf('window.gptWatchConversationPaint='),js.indexOf('window.gptInspectRenderDOM='));
 for(const field of ['MutationObserver','requestAnimationFrame','render_target_observed','visibleRenderTargetCount','afterFirstFrame','afterSecondFrame'])assert.ok(watch.includes(field));
 assert.doesNotMatch(watch,/innerText|textContent|conversationId|messageId|\.href/);
 assert.match(watch,/timeoutMs=20000/);assert.match(watch,/Math\.min\(30000/);
 assert.match(render,/renderTargetCount/);assert.match(render,/visibleRenderTargetCount/);
 const handler=section(main,'if event=="session_paint_watch"','if event=="root_hook_health"');
 assert.match(handler,/result\["status"\] as\? String=="render_target_observed"/);
 assert.match(handler,/backgroundRenderLease==nil/);assert.match(handler,/session\.isVisible/);
 assert.match(handler,/visibleSessionPaintSyncGeneration/);assert.match(handler,/web\.layoutSubtreeIfNeeded\(\)/);
 assert.match(handler,/web\.layer\?\.setNeedsDisplay\(\)/);assert.match(handler,/web\.displayIfNeeded\(\)/);
 assert.match(handler,/hydration display sync performed once after two frames/);
});

test('live-document resume proof is manual, generation-isolated, bounded, and outside production scheduler state',()=>{
 const start=section(main,'@objc func startLiveDocumentResumeProof()','@objc func cancelLiveDocumentResumeProof()');
 assert.match(start,/guard !cycleRunning,backgroundRenderLeaseOwner == nil/);
 assert.match(start,/manualDiagnosticOwnerLabel\(\) == nil/);
 assert.match(start,/conversationID\(in:url\)/);
 assert.match(start,/passDurationMs":60000/);
 assert.doesNotMatch(start,/web\.load\(/);
 assert.match(start,/125_000_000_000/);
 const handler=section(main,'func handleLiveDocumentResumeDiagnostic','func userContentController');
 assert.match(handler,/data\["operationGeneration"\][\s\S]*generation/);
 assert.match(handler,/passGeneration\.hasPrefix\(generation\+":"\)/);
 assert.match(main,/config\.userContentController\.add\(self, name: "liveResumeDiagnostic"\)/);
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const proof=section(bridge,'window.gptRunLiveDocumentResumeProof=async options=>{',' window.gptCancelLiveDocumentResumeProof=');
 assert.match(proof,/durationMs>60000/);
 assert.match(bridge,/location\.pathname===run\.initialPath/);
 assert.match(proof,/newOlderIds\.size>0/);
 assert.match(proof,/second\.hasPreviousPage===true/);
 assert.match(proof,/sameDocument/);
 assert.match(proof,/reloadBetweenPasses:false/);
 assert.match(proof,/livePassOrderEvidence/);
 const pageHookSource=fs.readFileSync(path.join(__dirname,'../extension/page-hook.js'),'utf8');
 assert.match(pageHookSource,/capture\(requestUrl, payload, "fetch", responseMeta\)/);
 assert.match(pageHookSource,/capture\(requestUrl, payload, "XHR", metadata\)/);
 assert.match(proof,/liveDOMOrderEvidence/);
 assert.match(proof,/chronologicalSequence/);
 assert.doesNotMatch(proof,/\.sort\(/);
 assert.doesNotMatch(proof,/fetch\(|XMLHttpRequest|\.load\(/);
 const pageHook=fs.readFileSync(path.join(__dirname,'../extension/page-hook.js'),'utf8');
 assert.match(pageHook,/liveResumeGeneration = typeof window\.gptLiveResumeCaptureGeneration === "string"[\s\S]*originalFetch\.apply\(this, args\)/);
 assert.match(pageHook,/capture\(requestUrl, payload, "fetch", responseMeta\)/);
 assert.match(pageHook,/capture\(requestUrl, payload, "XHR", metadata\)/);
});

test('v5.65 background presentation never activates, orders, or focuses windows',()=>{
 const launch=section(main,'func applicationDidFinishLaunching','func button(');
 assert.doesNotMatch(launch,/showMainWindow\(\)|presentWindow\(|NSApp\.activate|makeKeyAndOrderFront|orderFront/);
 const presenter=section(main,'func presentWindow(_ window:NSWindow,intent:WindowPresentationIntent,callSite:String','@objc func showPanel');
 assert.match(presenter,/guard intent == \.userInitiated else/);
 assert.match(presenter,/cycleRunning \|\| backgroundRenderLease != nil/);
 assert.match(presenter,/pendingForegroundWindow=window/);
 assert.match(presenter,/NSApp\.activate/);assert.match(presenter,/window\.makeKeyAndOrderFront/);
 const reopen=section(main,'func applicationShouldHandleReopen','func applicationDidFinishLaunching');
 assert.match(reopen,/showMainWindow\(\)/);
 const visible=section(main,'func restoreVisibleSessionPresentation()','@objc func hideSession');
 assert.match(visible,/presentWindow\(session,intent:\.userInitiated,callSite:"open_chatgpt_session"\)/);
 const acquire=section(main,'func acquireBackgroundRenderSurface(owner:String) async throws','func evaluateRenderReadiness');
 const cleanup=section(main,'func restoreBackgroundRenderSurface(owner:String)->Bool','func withBackgroundRenderSurface');
 assert.doesNotMatch(acquire,/activate\(|makeKey|makeMain|orderFront|orderOut|\.order\(/);
 assert.doesNotMatch(cleanup,/activate\(|makeKey|makeMain|makeFirstResponder|orderFront|orderOut|\.order\(/);
 for(const actionName of ['diagnoseTopChatPinStatus','diagnoseFirstRowMenuTrigger','diagnoseSidebarTopPosition','diagnoseVisiblePinnedRows','diagnoseSidebarRoutes']) {
  const start=main.indexOf(`func ${actionName}()`);assert.ok(start>=0,`missing ${actionName}`);
  const end=main.indexOf('\n    }',start);const action=main.slice(start,end);
  assert.doesNotMatch(action,/NSApp\.activate|makeKeyAndOrderFront|orderFront|orderOut/ ,`${actionName} changes presentation`);
 }
 const listDiagnostic=section(main,'func startListDiagnostic(visible:Bool,','func finishListDiagnostic(generation:UUID)');
 assert.doesNotMatch(listDiagnostic,/NSApp\.activate|makeKeyAndOrderFront|orderFront|orderOut/);
 const popup=section(main,'func webView\(_ webView: WKWebView, createWebViewWith','func webViewDidClose');
 assert.match(popup,/let userInitiated = NSApp\.isActive && session\.isKeyWindow && !cycleRunning && backgroundRenderLease==nil/);
 assert.match(popup,/if userInitiated \{_=presentWindow\(window,intent:\.userInitiated,callSite:"user_opened_webkit_child_window"\)\}/);
 assert.doesNotMatch(popup,/window\.makeKeyAndOrderFront/);
});

test('v5.65 background focus telemetry separates frontmost process from AppKit activation and cleanup',()=>{
 const engine=fs.readFileSync(path.join(__dirname,'CycleEngine.swift'),'utf8');
 const start=section(engine,'func startCycle(trigger:String)','cycleTask=Task');
 assert.match(start,/beginBackgroundFocusObservation\(\)/);
 assert.match(start,/recordBackgroundFocusSample\("before scheduler session orderOut"\)[\s\S]*session\.orderOut\(nil\)[\s\S]*recordBackgroundFocusSample\("after scheduler session orderOut"\)/);
 const snapshot=section(main,'func captureBackgroundFocusSnapshot()','func beginBackgroundFocusObservation()');
 assert.match(snapshot,/NSWorkspace\.shared\.frontmostApplication/);
 assert.match(snapshot,/ProcessInfo\.processInfo\.processIdentifier/);
 assert.match(snapshot,/NSApp\.isActive/);
 assert.match(snapshot,/NSApp\.keyWindow/);
 assert.match(snapshot,/NSApp\.mainWindow/);
 assert.doesNotMatch(snapshot,/localizedName|window\.title|bundleIdentifier/);
 const restore=section(main,'func restoreBackgroundRenderSurface(owner:String)->Bool','func withBackgroundRenderSurface');
 assert.match(restore,/recordBackgroundFocusSample\("before render lease cleanup"\)/);
 assert.match(restore,/recordBackgroundFocusSample\("after render lease cleanup"\)/);
 assert.match(restore,/let stateRestored=keyMainRestored && responderRestored/);
 assert.doesNotMatch(restore,/restored=.*applicationActivationRestored/);
 for(const label of ['frontmost preserved','GPT Limits Tool activation unchanged','key\/main preserved','window ordering preserved','GPT Limits Tool was frontmost during samples']) assert.ok(main.includes(label),`missing distinct focus telemetry ${label}`);
 assert.match(main,/finalizeBackgroundFocusObservation\(captureBackgroundFocusSnapshot\(\)\)/);
 assert.match(main,/func presentWindow\(_ window:NSWindow,intent:WindowPresentationIntent,callSite:String[\s\S]*guard intent == \.userInitiated else[\s\S]*cycleRunning \|\| backgroundRenderLease != nil[\s\S]*NSApp\.activate/);
 assert.match(main,/func installBackgroundActivationTraceObservers\(\)/);
 assert.match(main,/NSApplication\.willBecomeActiveNotification/);
 assert.match(main,/NSWindow\.didBecomeKeyNotification/);
 assert.match(main,/NSWindow\.didBecomeMainNotification/);
});

test('v5.66 sidebar scroll inspection is a single manual read-only traversal and never asserts root completeness',()=>{
 assert.match(main,/button\("Diagnose root sidebar scrolling",#selector\(diagnoseRootSidebarScroll\)\)/);
 const action=section(main,'@objc func diagnoseRootSidebarScroll()','@objc func diagnoseVisiblePinnedRows');
 assert.match(action,/guard !cycleRunning/);assert.match(action,/manualDiagnosticOwnerLabel\(\)==nil/);assert.match(action,/pinnedDiagnosticVersion/);
 assert.doesNotMatch(action,/web\.load\(|\.reload\(|fetch\(|XMLHttpRequest|session\.makeKey|NSApp\.activate/);
 assert.match(main,/rootSidebarScrollResult/);assert.match(main,/operationToken/);
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const diagnostic=section(bridge,'window.gptDiagnoseRootSidebarScroll=async','window.gptInspectRootSidebarMetadata=');
 for(const field of ['scrollOwnerFound','clientHeight','scrollHeight','scrollTop','uniqueIdentitiesSeen','newIdentities','previousIdentitiesMissingFromDOM','virtualized','lazyLoadingObserved','boundedEndCandidate','endOfListProof:\'unavailable\'','rootUniverseComplete:false','scrollRestoreSuccessful'])assert.ok(diagnostic.includes(field),`missing sidebar traversal evidence ${field}`);
 assert.doesNotMatch(diagnostic,/title|innerText|textContent|(?:^|[,\s])href:|messageText/);
});


test('v5.67 global window-order telemetry samples onscreen z-order without reading titles',()=>{
 assert.match(main,/import CoreGraphics/);
 assert.match(main,/CGWindowListCopyWindowInfo\(\.optionOnScreenOnly,kCGNullWindowID\)/);
 const summary=section(main,'func cgWindowSummary(_ entry:[String:Any],order:Int,kind:String)','func beginGlobalWindowOrderMonitoring');
 for(const field of ['kCGWindowOwnerPID','kCGWindowNumber','kCGWindowLayer','kCGWindowBounds','kCGWindowAlpha','index<$0','globalWindowOrderViolationCount']) assert.ok(summary.includes(field),`missing global ordering evidence ${field}`);
 assert.doesNotMatch(summary,/kCGWindowName|localizedName|bundleIdentifier|window\.title/);
 const monitor=section(main,'func beginGlobalWindowOrderMonitoring()','func finishGlobalWindowOrderMonitoring()');
 assert.match(monitor,/repeating:\.milliseconds\(100\)/);
 assert.match(monitor,/self\.cycleRunning\s*\|\|\s*self\.backgroundRenderLease != nil/);
 const finish=section(main,'func finishGlobalWindowOrderMonitoring()','func captureBackgroundFocusSnapshot()');
 assert.match(finish,/GPT windows above baseline foreground observed/);
 const start=section(engine,'func startCycle(trigger:String)','func checkRecord(');
 assert.match(start,/beginBackgroundFocusObservation\(\)/);
 assert.match(start,/finishGlobalWindowOrderMonitoring\(\)/);
 assert.doesNotMatch(start,/makeKey|makeMain|orderFront|orderFrontRegardless|NSApp\.activate|\.floating|\.statusBar/);
 const acquire=section(main,'func acquireBackgroundRenderSurface(owner:String) async throws','func evaluateRenderReadiness');
 assert.match(acquire,/if globalWindowOrderMonitor==nil \{beginGlobalWindowOrderMonitoring\(\)\}/);
 assert.doesNotMatch(acquire,/makeKey|makeMain|orderFront|orderFrontRegardless|NSApp\.activate|\.floating|\.statusBar/);
 const cleanup=section(main,'func restoreBackgroundRenderSurface(owner:String)->Bool','func withBackgroundRenderSurface');
 assert.match(cleanup,/finishGlobalWindowOrderMonitoring\(\)/);
 assert.doesNotMatch(cleanup,/makeKey|makeMain|orderFront|orderFrontRegardless|NSApp\.activate|\.floating|\.statusBar/);
 const explicit=section(main,'func restoreVisibleSessionPresentation()','@objc func hideSession');
 assert.match(explicit,/presentWindow\(session,intent:\.userInitiated,callSite:"open_chatgpt_session"\)/);
 assert.match(explicit,/session\.level = \.normal/);
 const diagnostics=section(main,'@objc func diagnoseRootSidebarScroll()','@objc func diagnoseVisiblePinnedRows');
 assert.doesNotMatch(diagnostics,/makeKey|makeMain|orderFront|orderFrontRegardless|NSApp\.activate|\.floating|\.statusBar/);
 assert.doesNotMatch(main,/\.floating|\.modalPanel|\.statusBar|\.popUpMenu/);
 const notification=section(main,'func userNotificationCenter(_ center:UNUserNotificationCenter,didReceive response:UNNotificationResponse','@objc func beginNativeRescue');
 assert.match(notification,/presentWindow\(self\.session,intent:\.userInitiated,callSite:"risk_notification_click"/);
 assert.match(notification,/onPresented:[\s\S]*web\.load/);
 assert.doesNotMatch(notification,/NSApp\.activate|session\.makeKeyAndOrderFront/);
 const rescue=section(main,'func showNativeRescueProgress(operationID:String)','@objc func cancelNativeRescue');
 assert.match(rescue,/presentWindow\(progressPanel,intent:\.userInitiated,callSite:"native_rescue_progress"/);
 assert.match(rescue,/nativeRescueOperationID==operationID/);
 assert.doesNotMatch(rescue,/progressPanel\.makeKeyAndOrderFront/);
});

test('v5.70 window-order probe reports real overlap and AppKit window semantics without changing z-order',()=>{
 const properties=section(main,'func windowOrderingProbeSnapshot()->String','@objc func startWindowOrderingProbe()');
 for(const field of ['window.level.rawValue','window.collectionBehavior.rawValue','window.parent','window.childWindows','window.hidesOnDeactivate','isFloatingPanel','becomesKeyOnlyIfNeeded','intersects foreground','above foreground'])assert.ok(properties.includes(field),`missing window property ${field}`);
 assert.match(properties,/CGRect\(x:value\("X"\),y:value\("Y"\),width:value\("Width"\),height:value\("Height"\)\)/);
 const start=section(main,'@objc func startWindowOrderingProbe()','func captureGlobalWindowOrder');
 assert.match(start,/guard !cycleRunning,backgroundRenderLease==nil,windowOrderingProbeTimer==nil/);
 assert.match(start,/addingTimeInterval\(15\)/);
 assert.match(start,/repeating:\.milliseconds\(100\)/);
 assert.doesNotMatch(start,/NSApp\.activate|makeKeyAndOrderFront|orderFront|orderOut|orderWindow/);
 const global=section(main,'func captureGlobalWindowOrder(stage:String)','func beginGlobalWindowOrderMonitoring');
 assert.match(global,/windowRect\(entry\)\.intersects\(targetRect\)/);
 const constructors=section(main,'func buildUserWindows()','func renderUserUI()');
 assert.match(constructors,/mainWindow=NSWindow\(/);assert.match(constructors,/settingsWindow=NSWindow\(/);
 assert.doesNotMatch(constructors,/\.floating|\.statusBar|\.modalPanel|\.popUpMenu|addChildWindow|orderFront|makeKeyAndOrderFront/);
});

test('v5.68 root pagination trace reports offsets, frontend hints, next-request state, and the stall watchdog without changing recovery',()=>{
 const hook=fs.readFileSync(path.join(__dirname,'list-hook.js'),'utf8');
 assert.match(hook,/expectedNextOffset/);assert.match(hook,/paginationHintSource/);assert.match(hook,/pageDecision/);
 assert.match(hook,/newIdentityCount/);assert.match(hook,/rootDiscoverySeenPageIds/);assert.match(hook,/relativeMs:relativeNow\(\)/);
 const report=section(engine,'func rootPaginationStallLine\(\)->String','func updatePartitionReport');
 for(const field of ['partitionKey','cycleRootAcceptedPageEvents','Accepted root pages','no_next_request_observed','unexpected_offset_observed','stop_coverage_complete','45-second cycleListVersion inactivity watchdog elapsed','last successful offset','expected next offset','last request','last response/failure','last new-identity progress'])assert.ok(report.includes(field),`missing pagination report field ${field}`);
 assert.match(report,/partitionKey\(event\)==\(lastShape \?\? ""\)/);
 const cycle=section(engine,'var changedAt=Date\(\),version=0,scrolledVersion = -1','// One bounded retry of the existing home navigation');
 assert.match(cycle,/Date\(\)\.timeIntervalSince\(changedAt\)>45/);
 assert.match(engine,/shouldRetryRootDiscovery\(stallDetail:stallDetail/);
 assert.match(engine,/no_next_request_observed/);
 assert.doesNotMatch(cycle,/WKWebView\.load|evaluateJavaScript\([^\n]*offset/);
});

test('v5.73 isolated diagnostic uses bounded snapshot-derived traversal and preserves a cleanup reserve',()=>{
 const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const inspector=section(bridge,'window.gptInspectVisiblePinnedRows=async(options={})=>','window.gptRunPinnedSidebarDiagnostic=async()=>');
 assert.match(inspector,/Math\.min\(600000,Number\(options\.hardTimeoutMs\)\|\|40000\)/);
 assert.match(inspector,/Math\.min\(90000,Math\.max\(15000,5000\+Math\.min\(absoluteSnapshotSafetyCap,prefixSnapshot\.length\)\*2500\)\)/);
 assert.match(inspector,/deadline-Date\.now\(\)-\(manualDiagnosticRun\?manualDiagnosticReserveMs:10000\)/);
 assert.match(inspector,/stopReason='traversal_timeout'/);
 assert.match(inspector,/processedRows:rows\.length,pinnedCount:/);
 assert.match(inspector,/const absoluteSnapshotSafetyCap=32/);
 assert.match(inspector,/requestedTraversalBudget=Math\.max\(1,Math\.min\(\(activityInternal\|\|cycleInternal\)\?absoluteSnapshotSafetyCap:20,requestedRows\)\)/);
 assert.match(inspector,/if\(\(activityInternal\|\|cycleInternal\)&&initialSnapshotCount>absoluteSnapshotSafetyCap\)/);
 assert.match(inspector,/\(activityInternal\|\|cycleInternal\)\?initialSnapshot:initialSnapshot\.slice\(0,maxRows\)/);
 assert.match(inspector,/sidebar_snapshot_unstable/);
 assert.match(inspector,/snapshot_exceeds_traversal_cap/);
 const tests=fs.readFileSync(path.join(__dirname,'automation-bridge.test.cjs'),'utf8');
 assert.match(tests,/stable snapshots of 20, 21, and more than 20 rows/);
 assert.match(tests,/fails distinctly above the absolute snapshot cap/);
 assert.match(tests,/real stable-snapshot growth as sidebar_snapshot_unstable/);
 const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
 assert.match(main,/func pinnedActivityBudget\(rowCount:Int,pinnedCount:Int\?=nil\)/);
 assert.match(main,/let traversal=min\(90_000,max\(15_000,5_000\+rows\*2_500\)\)/);
 assert.match(main,/let activity=max\(120_000,45_000\+activityRows\*20_000\)/);
 assert.match(main,/let total=min\(600_000,20_000\+5_000\+traversal\+activity\+pinnedActivityCleanupReserveMs\)/);
 assert.match(main,/case "prefix_started": return Double\(pinnedActivityTraversalBudgetMs\+pinnedActivityCleanupReserveMs\)\/1000/);
 assert.match(main,/case "cleanup_started": return Double\(pinnedActivityCleanupReserveMs\)\/1000/);
 assert.match(main,/hardTimeoutMs:600000/);
 assert.match(main,/pinnedActivityTraversalDeadline:Date\?/);assert.match(main,/pinnedActivityTraversalActive=false/);
 assert.match(main,/pinnedActivityTraversalActive=true[\s\S]*pinnedActivityTraversalDeadline=Date\(\)\.addingTimeInterval/);
 assert.match(main,/if stage=="row_classified" \{\s*resumePinnedActivityTraversalWatchdog\(token:token\)/);
 assert.match(main,/if stage=="cleanup_completed",pinnedActivityTraversalActive \{resumePinnedActivityTraversalWatchdog\(token:token\);return\}/);
 const watchdog=section(main,'func resumePinnedActivityTraversalWatchdog(token:String)','func updatePinnedActivityStage(');
 assert.match(watchdog,/deadline\.timeIntervalSinceNow/);assert.match(watchdog,/failPinnedActivityStage\("traversal_timeout"/);
 assert.match(watchdog,/updatePinnedActivityStage\("prefix_started",token:token,timeoutSeconds:remaining\)/);
 const mainProgress=section(main,'func handlePinnedActivityProgress','func updatePinnedActivityStage');
 const fail=section(main,'func failPinnedActivityStage(_ reason:String,token:String)','func finishPinnedActivityDiagnostic()');
 assert.match(mainProgress,/if stage=="menu_cleanup_started"[\s\S]*pinnedActivityMenuCleanupTimeoutTask/);
 assert.match(mainProgress,/if stage=="menu_cleanup_completed"[\s\S]*pinnedActivityMenuCleanupTimeoutTask\?\.cancel/);
 assert.match(fail,/reason=="menu_cleanup_timeout"[\s\S]*pinnedActivityNavigationMenuCleanup="failed"/);
 assert.match(fail,/reason=="render_cleanup_timeout"[\s\S]*pinnedActivityRenderLeaseCleanup="failed"/);
 const finish=section(main,'func finishPinnedActivityDiagnostic()','func resolveNextPinnedActivity(');
 for(const item of ['Diagnostic terminal reason:','Budget: total','Rows: processed','Activity: attempted'])assert.ok(finish.includes(item),`final report missing ${item}`);
 assert.match(main,/pinnedActivityRowsInspected=max\(pinnedActivityProcessedRows/);
});

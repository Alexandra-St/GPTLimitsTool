const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const main=fs.readFileSync(path.join(root,'Main.swift'),'utf8');
const engine=fs.readFileSync(path.join(root,'CycleEngine.swift'),'utf8');
const model=fs.readFileSync(path.join(root,'CycleModel.swift'),'utf8');
const hook=fs.readFileSync(path.join(root,'list-hook.js'),'utf8');
const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));

test('root sequence propagates on the existing list message without altering records',()=>{
 assert.match(hook,/rootRequestSequence:rootSequence/);
 assert.match(hook,/records\}\);/);
 assert.doesNotMatch(hook,/messageHandlers\.list\.postMessage\(\{[^}]*records:[^}]*diagnostic/i);
});
test('native records sequence-only handoff and puts exactly one consume attempt before ingestion',()=>{
 const list=section(main,'func consumeValidatedListMessage(','let now = Date');
 assert.match(list,/recordRootRequestCorrelation\(sequence:sequence,stage:\.native_handoff\)/);
 assert.match(list,/recordRootRequestCorrelation\(sequence:sequence,stage:\.consume_attempt\)[\s\S]*?consumeDiscoveryPage\(data,records:records,source:/);
 assert.match(list,/consumeDiscoveryPage\(data,records:records,source:isProbe \? \.recent_safety_probe:\.normal_discovery\)/);
 assert.match(engine,/source:DiscoveryPageSource = \.normal_discovery/);
 assert.doesNotMatch(list,/diagnosticRequestId/);
});
test('recent safety bridge restricts token ownership and exposes sanitized consume outcome',()=>{
 const list=section(main,'func consumeValidatedListMessage(','let now = Date');
 const helper=section(main,'@MainActor func runRecentSafetyProbe','var cycleOrigins=');
 assert.match(helper,/gptRunRecentSafetyProbe\?\.\(token\)/);
 assert.match(helper,/return allowed\.includes\(r\?\.outcome\) \? r\.outcome/);
 assert.doesNotMatch(helper,/records|conversationId|authorization|headers/i);
 for(const field of ['probeToken','cycleGeneration','jsOutcome','listMessageReceived','consumeResult','terminalCompleted','terminalResult','waiter','bridgeFailureReason'])assert.match(main,new RegExp(field));
 assert.match(list,/probe\.cycleGeneration==cycleToken/);assert.match(list,/data\["probeToken"\] as\? String==probe\.probeToken/);
 assert.match(list,/!probe\.terminalCompleted/);assert.match(list,/stale_or_mismatched_probe_token/);
 assert.match(helper,/outcome != "response_dispatched"/);
 assert.match(list,/bridgeFailureReason="invalid_probe_list_payload"/);assert.match(list,/result:\.bridge_failure/);assert.match(list,/result:\.consume_terminal/);
 assert.match(list,/probe_consume_result:\\\(result\.rawValue\)/);
 assert.equal((list.match(/consumeDiscoveryPage\(data,records:records,source:isProbe \? \.recent_safety_probe:\.normal_discovery\)/g)||[]).length,1);
 for(const name of ['accepted_new','accepted_repeated','rejected_stale_cycle','rejected_rate_limited','rejected_invalid_page'])assert.match(engine,new RegExp('return \\.'+name));
});
test('repeated logical pages receive a distinct repeated outcome without changing deduplication behavior',()=>{
 assert.match(engine,/isNew \? \.consume_new:\.consume_repeated/);
 assert.match(engine,/let isNew=cyclePageKeys\.insert\(signature\)\.inserted/);
 const consume=section(engine,'@discardableResult func consumeDiscoveryPage','func rootDiscoverySnapshotScript');
 assert.match(consume,/guard isNew else \{[\s\S]*itemCount>=pageLimit,!exhausted[\s\S]*cycleRootRepeatedFullPageNoProgress=true[\s\S]*return \.accepted_repeated/);
 const cycle=section(engine,'var changedAt=Date\(\),version=0,scrolledVersion = -1','// One bounded retry of the existing home navigation');
 assert.match(cycle,/if cycleRootRepeatedFullPageNoProgress \{stallDetail="pagination_repeated_page_no_progress";break\}/);
 assert.match(engine,/else if let stallDetail \{composite\.status = \.incompleteStall;composite\.detail=stallDetail\}/);
 assert.match(main,/pagination_repeated_page_no_progress.*coverage is incomplete/);
 assert.match(cycle,/if Date\(\)\.timeIntervalSince\(changedAt\)>45/);
 assert.match(consume,/cycleRootRepeatedFullPageNoProgress=true[\s\S]*return \.accepted_repeated/);
});
test('correlation schema has no sensitive production payload fields and persists no request identifier',()=>{
 const schema=section(model,'struct RootRequestCorrelationEvent:Codable,Equatable','struct RootRequestCorrelationState:Codable,Equatable');
 for(const key of ['records','conversationId','projectId','diagnosticRequestId','url','body','headers','headerValues'])assert.doesNotMatch(schema,new RegExp('let '+key+':'));
 assert.match(model,/"records","conversationId","projectId","diagnosticRequestId","url","body","headers","headerValues"/);
 assert.match(main,/event=="root_request_correlation"[\s\S]*RootRequestCorrelationEvent\.make\(data\)/);
});
test('duplicate list messages remain visible as repeated sent events for the same scalar sequence',()=>{
 assert.match(hook,/stage:'list_message_sent'/);
 assert.doesNotMatch(main,/rootRequestSequence.*dedup|dedup.*rootRequestSequence/i);
});
test('correlation stages are constrained to the declared enum',()=>{
 for(const stage of ['request_observed','response_observed','list_message_sent','native_handoff','consume_attempt','consume_new','consume_repeated','consume_rejected'])assert.ok(model.includes(stage));
});

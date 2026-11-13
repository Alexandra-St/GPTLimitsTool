const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=__dirname;
const hook=fs.readFileSync(path.join(root,'list-hook.js'),'utf8');
const main=fs.readFileSync(path.join(root,'Main.swift'),'utf8');
const engine=fs.readFileSync(path.join(root,'CycleEngine.swift'),'utf8');

test('Task 106 project-list and stale-document reproductions are rejected by exact milestone admission',()=>{
 const correlationEmitter=hook.slice(hook.indexOf('const emitRootCorrelation='),hook.indexOf('const emitRootTransportDiagnostic='));
 const correlationReceiver=main.slice(main.indexOf('if event=="root_request_correlation"'),main.indexOf('if event=="session_paint_watch"'));
 const observationBegin=hook.slice(hook.indexOf('const beginRootDiscoveryObservation='),hook.indexOf('window.gptGetValidatedRecentSafetyTemplate='));
 assert.match(observationBegin,/emitRootCorrelation\(entry\.rootRequestSequence,'request_observed',\{\.\.\.entry\.template,\.\.\.rootCorrelationIdentity\(entry\)/);
 assert.match(correlationEmitter,/category:/);
 assert.match(correlationEmitter,/endpointClass:/);
 assert.match(correlationEmitter,/cycleSequence:/);
 assert.match(correlationEmitter,/documentGeneration:/);
 assert.match(correlationEmitter,/observationSource:/);
 assert.match(correlationReceiver,/recordFirstRootListRequestMilestone\(data\)/);
 assert.match(main,/data\["category"\] as\? String == "root_conversation_list"/);
 assert.match(main,/data\["endpointClass"\] as\? String == "root_conversations"/);
 assert.match(engine,/activeCycleSequence:cycleSequence,activeDocumentGeneration:activeGeneration/);
 assert.match(engine,/healthRoute==currentRoute/);
 assert.match(engine,/cycleRootFirstRootListRequestSource==nil/);
 assert.doesNotMatch(main,/cycleRootRequests==1 \{recordCycleRootTriggerMilestone\("first_root_list_request"\)\}/);
});

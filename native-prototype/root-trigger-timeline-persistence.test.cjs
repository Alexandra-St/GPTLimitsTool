const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const root=__dirname;
const main=fs.readFileSync(path.join(root,'Main.swift'),'utf8');
const engine=fs.readFileSync(path.join(root,'CycleEngine.swift'),'utf8');
const bridge=fs.readFileSync(path.join(root,'automation-bridge.js'),'utf8');
const list=fs.readFileSync(path.join(root,'list-hook.js'),'utf8');

test('root trigger snapshots persist only the last two and can be read after process restart',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'root-trigger-timeline-runner-'));
 try {
  const mainCopy=path.join(temp,'Main.swift');
  const marker='@main struct PrototypeMain';
  assert.equal(main.split(marker).length,2);
  fs.writeFileSync(mainCopy,main.replace(marker,'struct PrototypeMain'));
  const metadata=path.join(temp,'metadata.swift');
  fs.writeFileSync(metadata,'let gptLimitsExecutableBuildVersionMarker = "test"\nlet gptLimitsExecutableBuildIDMarker = "test"\n');
  const binary=path.join(temp,'runner');
  const sources=['CycleEngine.swift','CycleModel.swift','RuntimeIdentity.swift','SingleInstanceLock.swift','root-trigger-timeline-runner-tests.swift'].map(file=>path.join(root,file));
  execFileSync('swiftc',['-module-cache-path','/private/tmp/gpt-limits-swift-cache',mainCopy,...sources,metadata,'-framework','AppKit','-framework','WebKit','-framework','UserNotifications','-o',binary],{stdio:'pipe'});
  assert.match(execFileSync(binary,{encoding:'utf8'}),/PASS: root milestone admission, transport correlation, pagination progress, initial scroll outcome, passive exact-root evidence, generation isolation, bounded persistence, privacy, and monitoring isolation/);
  const defer=engine.slice(engine.indexOf('cycleTask=Task { @MainActor in'),engine.indexOf('cycleDiscovering=false',engine.indexOf('cycleTask=Task { @MainActor in')));
  assert.match(defer,/finalizeTerminalEvidence\(terminalEvidence\)[\s\S]*persistCompletedRootTriggerTimeline\(terminalEvidence\)/);
  assert.match(main,/--inspect-root-trigger-timelines"\) \{print\(inspectRootTriggerTimelineSnapshots\(\)\);return\}/);
  const inspector=main.slice(main.indexOf('func inspectRootTriggerTimelineSnapshots('),main.indexOf('struct ContinuationSourceMessage'));
  assert.doesNotMatch(inspector,/conversationId|title|messages|cookies|headers|rawDOM|authorization/i);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('the persisted schema contains only bounded root-trigger evidence fields',()=>{
 for(const field of ['cycleID:String','buildID:String','finalReason:String','routeBefore:String','routeAfter:String','actualNavigationReload:RootTriggerBooleanSnapshot','documentGenerationChanged:RootTriggerBooleanSnapshot','milestones:[RootTriggerMilestoneSnapshot]','initialScroll:RootTriggerScrollSnapshot','firstRootListRequestSource:RootRequestMilestoneSourceSnapshot?']) assert.ok(main.includes(field),`missing ${field}`);
 for(const field of ['resourceTimingPositiveControlPassed:Bool?','resourceTimingNegativeEvidenceUsable:Bool?','evidenceSource:String?','rootResourceTimingSnapshotAvailable']) assert.ok(main.includes(field)||list.includes(field),`missing ${field}`);
 assert.match(main,/let rootTriggerTimelineSnapshotLimit=2/);
 assert.match(main,/data\.write\(to:file,options:\.atomic\)/);
 for(const field of ['rootResponseShapeRejections:[RootResponseShapeRejectionSnapshot]?','nestedObjects:[RootResponseSchemaObjectSnapshot]','rejected_missing_id','rejected_missing_or_invalid_time','rejected_invalid_shape','rejected_other','func boundedRootResponseShapeRejections'])assert.ok(main.includes(field),`missing ${field}`);
 assert.match(main,/event=="root_response_shape_rejection"[\s\S]*?cycleSequence[\s\S]*?documentGeneration[\s\S]*?boundedRootResponseShapeRejections/);
 assert.match(engine,/rootResponseShapeRejections:cycleRootResponseShapeRejections\.filter\{\$0\.cycleID==cycleID\}/);
 assert.match(list,/path==='\/backend-api\/conversations'&&info\.method==='GET'&&meta\?\.status===200&&acceptedRecords\.length===0[\s\S]*?schema:parsed\.schema/);
 assert.match(engine,/status:"not observed"/);
});

test('pagination progress persistence correlates only same-cycle document evidence',()=>{
 for(const field of ['paginationProgress:[RootPaginationProgressSnapshot]?','acceptedRequestSequence:Int','postProgressScrollRequested:Bool?','postProgressScrollExecuted:Bool?','scrollOwnerFound:Bool?','nextRootRequestObserved:Bool','nextRequestSequence:Int?','nextRequestTerminalResult:String?']) assert.ok(main.includes(field),`missing ${field}`);
 assert.match(main,/\$0\["cycleID"\] as\? String==cycleID[\s\S]*?cycleSequence[\s\S]*?documentGeneration/);
 assert.match(main,/let exactRequests=hookEvents\.filter\{[\s\S]*?root_conversation_list[\s\S]*?\/backend-api\/conversations/);
 assert.match(engine,/cycleRootTransportEvents\.contains\(where:\{\$0\.requestSequence==sequence && \$0\.documentGeneration==generation/);
 assert.match(bridge,/post_progress[\s\S]*?requestedAtMs:[\s\S]*?documentGeneration:[\s\S]*?cycleSequence:/);
 assert.match(list,/documentGeneration:Number\.isFinite\(performance\.timeOrigin\)[\s\S]*?cycleSequence:Number\.isSafeInteger\(window\.gptListCycleConfig\?\.cycleSequence\)/);
});

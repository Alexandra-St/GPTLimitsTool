const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(document={querySelectorAll:()=>[]},setTimer=setTimeout,now=()=>Date.now(),styleFor=()=>({overflowY:'auto'})){const sent=[],diagnostics=[],sidebarMessages=[],resumeMessages=[],chatCheckMessages=[],listeners={},observers=[];document.__notifyMutation=records=>observers.forEach(observer=>observer.callback(records));const window={addEventListener:(k,f)=>{(listeners[k]??=[]).push(f);},dispatchEvent:()=>{},getComputedStyle:styleFor,webkit:{messageHandlers:{automation:{postMessage:x=>sent.push(x)},chatCheck:{postMessage:x=>chatCheckMessages.push(x)},starredDiagnostic:{postMessage:x=>diagnostics.push(x)},sidebarNavigation:{postMessage:x=>sidebarMessages.push(x)},liveResumeDiagnostic:{postMessage:x=>resumeMessages.push(x)}}},fetch:()=>{throw Error('owned fetch forbidden')}};const ClockDate=class extends Date{static now(){return now();}};class TestMutationObserver{constructor(callback){this.callback=callback;observers.push(this);}observe(){}takeRecords(){return [];}disconnect(){}}class TestPointerEvent{constructor(type,options){this.type=type;Object.assign(this,options);}}const location={href:'https://chatgpt.com/g/project/c/a',origin:'https://chatgpt.com',hostname:'chatgpt.com',pathname:'/g/project/c/a'};const context=vm.createContext({window,location,document,URL,Date:ClockDate,KeyboardEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}},MouseEvent:class{constructor(type,options){this.type=type;Object.assign(this,options);}},PointerEvent:TestPointerEvent,MutationObserver:TestMutationObserver,getComputedStyle:styleFor,setTimeout:setTimer,clearTimeout,setInterval,clearInterval});for(const f of ['../extension/aggregator.js','../extension/history-collector.js','automation-bridge.js']){let source=fs.readFileSync(path.join(__dirname,f),'utf8');if(f==='automation-bridge.js')source=source.replace('__PINNED_DIAGNOSTIC_VERSION__','5.31.0');vm.runInContext(source,context);}return{window,sent,diagnostics,sidebarMessages,resumeMessages,chatCheckMessages,location,receive:(p,responsePipeline=null,extra={})=>{for(const listener of listeners.message||[])listener({source:window,origin:'https://chatgpt.com',data:{source:'gpt-limits-tool-capture-v1',summary:p,responsePipeline,...extra}});}};}
const page=(ids,extra={})=>({conversationId:'a',title:'A',items:ids.map(value=>({...(typeof value==='string'?{id:value}:value),role:'user',textTokens:5,attachments:{images:1},content:'SECRET TEXT',asset_pointer:'SECRET ASSET'})),hasPreviousPage:true,...extra});
test('cycle bridge buffers initial capture and exports only safe totals and technical IDs',()=>{const x=setup();x.receive(page(['first']));assert.equal(x.sent.length,0);assert.equal(x.window.gptConfigureCheck({id:'wrong',token:'t'}),false);assert.equal(x.window.gptConfigureCheck({id:'a',token:'t'}),true);assert.equal(x.sent[0].state.messagesCollected,1);assert.ok(!JSON.stringify(x.sent).includes('SECRET'));assert.ok(!JSON.stringify(x.sent).includes('content'));x.receive(page(['first','second']));assert.equal(x.sent.at(-1).state.messagesCollected,2);x.receive(page(['other'],{conversationId:'b'}));assert.equal(x.sent.length,2);});
test('production page telemetry proves old-history progress, keeps it sticky, and rejects top-only activity',()=>{
 const x=setup();const baseline={conversationId:'a',title:'A',processedMessageIds:['saved'],messagesCollected:1,userMessages:1,assistantMessages:0,otherMessages:0,estimatedTextTokens:5,attachments:{images:0,audio:0,video:0,files:0},historyComplete:false,hasPreviousPage:true,hasNextPage:false,responsesCaptured:0};
 x.window.gptConfigureCheck({id:'a',token:'old-proof',baseline});
 x.receive(page([{id:'saved',activityTime:300},{id:'top-new',activityTime:350}],{isPaginationResponse:true}));
 assert.equal(x.sent.at(-1).olderHistoryProgressObserved,false);
 x.receive(page([{id:'older-1',activityTime:250},{id:'older-2',activityTime:200}],{isPaginationResponse:true}));
 assert.equal(x.sent.at(-1).olderHistoryProgressObserved,true);assert.equal(x.sent.at(-1).pageDirection,'older');assert.equal(x.sent.at(-1).olderUniqueBaselineMessageCount,3);assert.equal(x.sent.at(-1).hasEarlierPages,true);
 x.receive(page([{id:'older-1',activityTime:250},{id:'older-2',activityTime:200}],{isPaginationResponse:true}));
 assert.equal(x.sent.at(-1).olderHistoryProgressObserved,true);
 const topOnly=setup();topOnly.window.gptConfigureCheck({id:'a',token:'top-only',baseline});
 topOnly.receive(page([{id:'saved',activityTime:300},{id:'new-top',activityTime:400}],{isPaginationResponse:true}));
 topOnly.receive(page([{id:'even-newer',activityTime:500}],{isPaginationResponse:true}));
 assert.equal(topOnly.sent.at(-1).olderHistoryProgressObserved,false);assert.equal(topOnly.sent.at(-1).pageDirection,'not_older');
});
test('production page telemetry fingerprints known replay pages and counts only older traversal as replay progress',()=>{
 const x=setup();const baseline={conversationId:'a',title:'A',processedMessageIds:['p1a','p1b','p2a','p2b','p3a','p3b'],messagesCollected:6,userMessages:6,assistantMessages:0,otherMessages:0,estimatedTextTokens:30,attachments:{images:0,audio:0,video:0,files:0},historyComplete:false,hasPreviousPage:true,hasNextPage:false,responsesCaptured:0};
 x.window.gptConfigureCheck({id:'a',token:'replay',baseline});
 x.receive(page([{id:'p1a',activityTime:200},{id:'p1b',activityTime:100}],{isPaginationResponse:true,hasPreviousPage:true}));
 const first=x.sent.at(-1);assert.equal(first.pageReplay,true);assert.equal(first.replayPagesProgressed,0);
 x.receive(page([{id:'p2a',activityTime:90},{id:'p2b',activityTime:70}],{isPaginationResponse:true,hasPreviousPage:true}));
 const second=x.sent.at(-1);assert.equal(second.pageReplay,true);assert.equal(second.pageDirection,'older');assert.equal(second.replayProgressObserved,true);assert.equal(second.replayPagesProgressed,1);assert.match(second.pageFingerprint,/^2:[0-9a-f]{8}$/);
 assert.ok(!second.pageFingerprint.includes('p2a'));
 x.receive(page([{id:'p3a',activityTime:60},{id:'p3b',activityTime:40}],{isPaginationResponse:true,hasPreviousPage:true}));
 assert.equal(x.sent.at(-1).replayPagesProgressed,2);
 x.receive(page([{id:'top-new',activityTime:500}],{isPaginationResponse:true,hasPreviousPage:true}));
 const top=x.sent.at(-1);assert.equal(top.pageReplay,false);assert.equal(top.pageDirection,'not_older');assert.equal(top.replayProgressObserved,true);
});
test('production same-document continuation accepts only new-generation messages older than the saved frontier',()=>{
 const first=setup();first.window.gptConfigureCheck({id:'a',token:'pass-one'});
 first.receive(page([{id:'newest',activityTime:200}],{isPaginationResponse:true,liveResumeGeneration:'pass-one'}));
 const baseline=first.sent.at(-1).state;assert.equal(baseline.messagesCollected,1);
 const next=setup();assert.equal(next.window.gptConfigureCheck({id:'a',token:'pass-two',baseline,continuation:true,expectedFrontier:200}),true);
 const identity=next.window.gptCheckDocumentIdentity('a');assert.equal(identity.routeMatches,true);
 next.receive(page([{id:'older-stale',activityTime:100}],{liveResumeGeneration:'pass-one'}));
 next.receive(page([{id:'newer',activityTime:250}],{liveResumeGeneration:'pass-two'}));
 assert.equal(next.sent.length,0);
 next.receive(page([{id:'newest',activityTime:200},{id:'older',activityTime:100}],{isPaginationResponse:true,hasPreviousPage:false,liveResumeGeneration:'pass-two'}));
 const update=next.sent.at(-1);
 assert.equal(update.state.messagesCollected,2);assert.equal(update.state.historyComplete,true);
 assert.equal(update.state.hasPreviousPage,false);assert.equal(update.olderUniqueMessageCount,1);assert.equal(update.continuationProgress,true);
 assert.equal(update.documentIdentity,identity.documentIdentity);
 assert.deepEqual(Array.from(update.state.processedMessageIds),['newest','older']);
});
test('continuation bridge handoff reports sanitized receive, acceptance, and trigger result stages',()=>{
 const baseline={processedMessageIds:['private-id'],messagesCollected:1,hasPreviousPage:true,historyComplete:false};
 const x=setup();
 assert.equal(x.window.gptConfigureCheck({id:'a',token:'continuation-generation',baseline,continuation:true,expectedFrontier:200,replayProgressObserved:true}),true);
 assert.deepEqual(x.chatCheckMessages.map(m=>m.stage),['first_pass_boundary_captured','bridge_command_received','bridge_command_accepted']);
 assert.ok(x.chatCheckMessages.every(m=>m.source==='js'));
 assert.equal(x.chatCheckMessages[0].frontierPresent,true);assert.equal(x.chatCheckMessages[0].hasPreviousPage,true);
 assert.equal(x.chatCheckMessages[2].replayProgressEligible,true);assert.equal(x.chatCheckMessages[2].bridgeResult,'accepted');
 assert.equal(x.window.gptScrollHistory('wrong-document'),'document_changed');
 assert.equal(x.chatCheckMessages.at(-2).stage,'pagination_trigger_attempted');
 assert.equal(x.chatCheckMessages.at(-1).stage,'pagination_trigger_result');
 assert.equal(x.chatCheckMessages.at(-2).source,'js');assert.equal(x.chatCheckMessages.at(-1).source,'js');
 assert.equal(x.chatCheckMessages.at(-1).bridgeResult,'document_changed');
 const rejected=setup();
 assert.equal(rejected.window.gptConfigureCheck({id:'a',token:'rejected-generation',baseline,continuation:true,expectedFrontier:0}),false);
 assert.equal(rejected.chatCheckMessages.at(-1).stage,'bridge_command_rejected');
 assert.equal(rejected.chatCheckMessages.at(-1).bridgeResult,'frontier_missing');
 const serialized=JSON.stringify(x.chatCheckMessages);
 assert.ok(!serialized.includes('private-id') && !serialized.includes('title'));
});
test('continuation response pipeline reports parse, duplicate, filter and page acceptance telemetry without raw values',()=>{
 const baseline={processedMessageIds:['private-message-id'],messagesCollected:1,hasPreviousPage:true,historyComplete:false};const x=setup();
 x.window.gptConfigureCheck({id:'a',token:'first-pass',baseline:{...baseline,processedMessageIds:[],messagesCollected:0}});
 x.receive(page([{id:'first-pass-private-id',activityTime:200}],{isPaginationResponse:true}),{sequence:1,requestClass:'conversation_messages',transport:'fetch',status:200,requestCursorFingerprint:'11111111',responseCursorFingerprint:'22222222',responsePageFingerprint:'1:33333333',pageActivityBounds:{minimum:200,maximum:200},itemCount:1,hasPreviousPage:true,payloadRecognized:true,documentIdentity:x.window.gptLiveResumeDocumentIdentity,liveResumeGeneration:'first-pass'});
 x.window.gptConfigureCheck({id:'a',token:'generation-safe',baseline,continuation:true,expectedFrontier:200,replayProgressObserved:true});
 const p=page([{id:'older-private-id',activityTime:50}],{isPaginationResponse:true,liveResumeGeneration:'generation-safe'});
 x.receive(p,{sequence:101,requestClass:'conversation_messages',transport:'fetch',status:200,requestCursorFingerprint:'deadbeef',responseCursorFingerprint:'cafebabe',responsePageFingerprint:'1:01020304',pageActivityBounds:{minimum:50,maximum:50},itemCount:1,hasPreviousPage:true,payloadRecognized:true,routeMatches:true,documentIdentity:x.window.gptLiveResumeDocumentIdentity,liveResumeGeneration:'generation-safe'});
 let event=x.chatCheckMessages.at(-1);assert.equal(event.event,'continuation_response_pipeline');assert.equal(event.accepted,true);assert.equal(event.pageDirection,'older');assert.equal(event.duplicateFirstPassPage,false);assert.equal(event.requestCursorFingerprint,'deadbeef');
 x.receive(p,{sequence:102,requestClass:'conversation_messages',transport:'XHR',status:200,requestCursorFingerprint:'deadbeef',responseCursorFingerprint:'cafebabe',responsePageFingerprint:'1:01020304',pageActivityBounds:{minimum:50,maximum:50},itemCount:1,hasPreviousPage:true,payloadRecognized:true,routeMatches:true,documentIdentity:x.window.gptLiveResumeDocumentIdentity,liveResumeGeneration:'generation-safe'});
 event=x.chatCheckMessages.at(-1);assert.equal(event.accepted,true);assert.equal(event.duplicatePage,true);assert.equal(event.rejectionReason,null);
 const serialized=JSON.stringify(x.chatCheckMessages);assert.equal(serialized.includes('private-message-id'),false);assert.equal(serialized.includes('older-private-id'),false);assert.equal(serialized.includes('SECRET TEXT'),false);assert.equal(serialized.includes('secret'),false);
});
test('continuation no-older telemetry separates known, duplicate, timestamp and frontier relations without exposing item data',()=>{
 const baseline={processedMessageIds:['known-private'],messagesCollected:1,hasPreviousPage:true,historyComplete:false};const x=setup();
 x.window.gptConfigureCheck({id:'a',token:'breakdown',baseline,continuation:true,expectedFrontier:100});
 const rejected=page([
  {id:'known-private',activityTime:50},{id:'new-private',activityTime:100},{id:'new-private',activityTime:100},
  {id:'missing-time',activityTime:null},{id:'invalid-time',activityTime:'bad'},{id:'newer-private',activityTime:120}
 ],{liveResumeGeneration:'breakdown'});
 x.receive(rejected,{sequence:501,requestClass:'conversation_messages',transport:'fetch',status:200,itemCount:6,hasPreviousPage:true,payloadRecognized:true,routeMatches:true,documentIdentity:x.window.gptLiveResumeDocumentIdentity,liveResumeGeneration:'breakdown'});
 const event=x.chatCheckMessages.at(-1);assert.equal(event.rejectionReason,'no_older_items');
 assert.equal(event.dominantReason,'no_older_items_mixed_rejections');
 assert.deepEqual({...event.itemBreakdown},{totalItems:6,alreadyKnownIdentity:1,duplicateWithinPage:1,missingIdentity:0,missingTimestamp:1,invalidTimestamp:1,notOlderThanFrontier:2,olderThanFrontierButRejectedOther:0,eligibleOlder:0,accepted:0,older:1,equal:2,newer:1,timestampUnknown:2,uniqueValidIdentities:5,alreadyKnownUniqueIdentities:1});
 assert.deepEqual({...event.frontier},{exists:true,source:'first_pass_pagination_frontier',timestampValid:true,identityPresent:false,comparisonMode:'activity_timestamp_and_message_identity',older:1,equal:2,newer:1,timestampUnknown:2});
 const serialized=JSON.stringify(event);for(const secret of ['known-private','new-private','missing-time','invalid-time','newer-private','activityTime'])assert.equal(serialized.includes(secret),false);
 const allKnown=page([{id:'known-private',activityTime:50}],{liveResumeGeneration:'breakdown'});
 x.receive(allKnown,{sequence:502,requestClass:'conversation_messages',status:200,itemCount:1,payloadRecognized:true,routeMatches:true,documentIdentity:x.window.gptLiveResumeDocumentIdentity,liveResumeGeneration:'breakdown'});
 assert.equal(x.chatCheckMessages.at(-1).dominantReason,'no_older_items_all_already_known');
});
test('continuation old unique messages are eligible and preserve existing acceptance behavior',()=>{
 const x=setup();x.window.gptConfigureCheck({id:'a',token:'eligible',baseline:{processedMessageIds:[],hasPreviousPage:true},continuation:true,expectedFrontier:100});
 x.receive(page([{id:'older-private',activityTime:90}],{liveResumeGeneration:'eligible'}),{sequence:503,requestClass:'conversation_messages',status:200,itemCount:1,payloadRecognized:true,routeMatches:true,documentIdentity:x.window.gptLiveResumeDocumentIdentity,liveResumeGeneration:'eligible'});
 const event=x.chatCheckMessages.at(-1);assert.equal(event.accepted,true);assert.equal(event.itemBreakdown.eligibleOlder,1);assert.equal(event.itemBreakdown.accepted,1);
});
test('first-pass parser diagnostics persist safe response shape and page callback result',()=>{
 const x=setup();x.window.gptConfigureCheck({id:'a',token:'parse-diagnostic'});
 const responseParseDiagnostic={endpointTemplate:'/backend-api/conversations/:id/messages',transport:'fetch',status:200,contentTypeCategory:'json',topLevelType:'object',topLevelKeyNames:['messages'],topLevelArrayCounts:[{key:'messages',count:1}],expectedStructure:{conversationId:true,messagesArray:true,mappingObject:false,pageInfoObject:true,hasPreviousPageBoolean:true},parserAttempted:true,parserAccepted:true,rejectionReason:'accepted',extractedPageCount:1,extractedMessageCount:1,hasPreviousPage:true};
 x.receive(page(['private-message-id']),{sequence:7,requestOrigin:'first_pass',requestOrdinal:1,requestClass:'conversation_messages',transport:'fetch',status:200,payloadRecognized:true,routeMatches:true,documentIdentity:x.window.gptLiveResumeDocumentIdentity,liveResumeGeneration:'parse-diagnostic',responseParseDiagnostic});
 const event=x.chatCheckMessages.find(message=>message.event==='history_response_parse_diagnostic');
 assert.ok(event);assert.equal(event.sequence,7);assert.equal(event.pageUpdateCallbackFired,true);assert.equal(event.responseParseDiagnostic.parserAccepted,true);
 assert.equal(x.sent.length,1);assert.equal(JSON.stringify(event).includes('private-message-id'),false);assert.equal(JSON.stringify(event).includes('SECRET TEXT'),false);
});
test('complete baseline requires actual overlap or newly observed oldest page',()=>{const x=setup();x.window.gptConfigureCheck({id:'a',token:'one'});x.receive(page(['old'],{hasPreviousPage:false,isPaginationResponse:true}));const baseline=x.sent.at(-1).state;const y=setup();y.window.gptConfigureCheck({id:'a',token:'two',baseline});y.receive(page(['new']));assert.equal(y.sent.at(-1).overlap,false);assert.equal(y.sent.at(-1).oldest,false);y.receive(page(['new','old']));assert.equal(y.sent.at(-1).overlap,true);assert.equal(y.sent.at(-1).state.messagesCollected,2);assert.equal(y.sent.at(-1).state.attachments.images,2);});
test('new activity invalidates an old Complete until a new page overlaps the saved boundary',()=>{const x=setup();x.window.gptConfigureCheck({id:'a',token:'one'});x.receive(page(['old'],{hasPreviousPage:false,isPaginationResponse:true}));const baseline=x.sent.at(-1).state;const y=setup();y.window.gptConfigureCheck({id:'a',token:'two',baseline,requireOverlapForComplete:true});y.receive(page(['new']));assert.equal(y.sent.at(-1).state.historyComplete,false);assert.equal(y.sent.at(-1).state.hasPreviousPage,true);y.receive(page(['new','old']));assert.equal(y.sent.at(-1).state.historyComplete,true);assert.equal(y.sent.at(-1).state.hasPreviousPage,false);});
test('sidebar scroll changes geometry without reading message text',()=>{const x=setup();assert.equal(x.window.gptScrollSidebar(),false);});

function inspectSidebarReady(x,operationToken='native-ready-proof'){
 const sample=x.window.gptSampleSidebarScrollReadiness({operationToken});
 const readiness={...sample,status:'snapshot_ready',ready:true,reason:'snapshot_ready',pollCount:4,firstPollTimestampMs:0,lastPollTimestampMs:320,waitDurationMs:320,firstPositiveCount:sample.rowCount,finalCount:sample.rowCount,identityCount:sample.identityCount,nativeGuardFired:false};
 return x.window.gptInspectSidebarScrollMechanics({operationToken,readiness});
}

function sidebarScrollFixture({owner='ancestor',transform='none',docScroll=false}={}){
 const body={tagName:'BODY',isConnected:true,clientHeight:0,scrollHeight:0,scrollTop:0,parentElement:null,computedStyle:{overflowY:'visible',display:'block',visibility:'visible',opacity:'1',position:'static',transform:'none',contain:'none'},contains(node){let n=node;while(n){if(n===this)return true;n=n.parentElement;}return false;},querySelectorAll:()=>[]};
 const viewport={tagName:'DIV',isConnected:true,clientHeight:owner==='none'?400:400,scrollHeight:owner==='none'?400:900,scrollTop:5,parentElement:body,computedStyle:{overflowY:owner==='none'?'visible':'auto',display:'block',visibility:'visible',opacity:'1',position:'relative',transform,contain:'none'},getBoundingClientRect:()=>({x:0,y:50,width:300,height:400,left:0,top:50,right:300,bottom:450}),contains(node){let n=node;while(n){if(n===this)return true;n=n.parentElement;}return false;},querySelectorAll:()=>[]};
 const root={tagName:'NAV',isConnected:true,clientHeight:400,scrollHeight:400,scrollTop:0,parentElement:owner==='sibling'?body:viewport,computedStyle:{overflowY:'visible',display:'block',visibility:'visible',opacity:'1',position:'static',transform:'none',contain:'none'},getAttribute:name=>name==='role'?'navigation':null,getBoundingClientRect:()=>({x:0,y:50,width:300,height:400,left:0,top:50,right:300,bottom:450}),contains(node){let n=node;while(n){if(n===this)return true;n=n.parentElement;}return false;},querySelectorAll(selector){if(selector==='a[href]')return rows;if(selector==='*')return [viewport,...rows];return [];}};
 if(owner==='sibling'){viewport.parentElement=root;root.querySelectorAll=selector=>selector==='a[href]'?rows:selector==='*'?[viewport,...rows]:[];}
 const rows=['one','two'].map((id,index)=>({tagName:'A',isConnected:true,parentElement:viewport,computedStyle:{overflowY:'visible',display:'block',visibility:'visible',opacity:'1',position:'static',transform:'none',contain:'none'},getAttribute:name=>name==='href'?`/g/project/c/${id}`:null,getBoundingClientRect:()=>{const y=100+index*40-(viewport.scrollTop-5);return {x:20,y,width:240,height:30,left:20,top:y,right:260,bottom:y+30};}}));
 const docElement={tagName:'HTML',isConnected:true,clientWidth:1024,clientHeight:docScroll?500:768,scrollHeight:docScroll?1400:768,scrollTop:docScroll?10:0,parentElement:null,computedStyle:{overflowY:docScroll?'auto':'visible',display:'block',visibility:'visible',opacity:'1',position:'static',transform:'none',contain:'none'},getBoundingClientRect:()=>({x:0,y:0,width:1024,height:768,left:0,top:0,right:1024,bottom:768}),contains(node){let n=node;while(n){if(n===this)return true;n=n.parentElement;}return false;},querySelectorAll:()=>[]};
 body.parentElement=docElement;docElement.parentElement=null;
 // In the document-scroll fixture, suppress the nested owner so only the document can move.
 if(docScroll){viewport.computedStyle.overflowY='visible';viewport.scrollHeight=viewport.clientHeight;viewport.scrollTop=0;}
 const document={readyState:'complete',body,documentElement:docElement,scrollingElement:docElement,querySelectorAll(selector){return selector==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[root]:[];}};
 const styleFor=node=>node?.computedStyle||{overflowY:'visible',display:'block',visibility:'visible',opacity:'1',position:'static',transform:'none',contain:'none'};
 const x=setup(document,setTimeout,()=>Date.now(),styleFor);return{x,root,rows,viewport,docElement,document};
}

test('sidebar mechanism probe finds an outer scroll ancestor beyond the sidebar root and restores one-pixel movement',async()=>{
 const {x,viewport}=sidebarScrollFixture();const result=await inspectSidebarReady(x);
 assert.equal(result.status,'movement_observed');assert.equal(result.candidateCount,1);assert.equal(result.candidates[0].tag,'div');assert.equal(result.candidates[0].containsRoot,true);
 assert.equal(result.movement.candidateType,'element_scrollTop');assert.equal(result.movement.delta,1);assert.equal(result.movement.restored,true);assert.equal(viewport.scrollTop,5);
 assert.equal(result.routeUnchanged,true);assert.equal(result.rowCount,2);assert.equal(result.uniqueIdentityCount,2);
});

test('sidebar mechanism probe detects document scrolling',async()=>{
 const {x,docElement}=sidebarScrollFixture({docScroll:true});const result=await inspectSidebarReady(x);
 assert.equal(result.status,'movement_observed');assert.equal(result.candidateCount,1);assert.equal(result.movement.candidateType,'document');assert.equal(result.movement.delta,1);assert.equal(result.movement.restored,true);assert.equal(docElement.scrollTop,10);
});

test('sidebar mechanism telemetry records transform virtualization and separate viewport/content elements',async()=>{
 const virtual=sidebarScrollFixture({transform:'matrix(1, 0, 0, 1, 0, -24)'});const transformed=await inspectSidebarReady(virtual.x);
 assert.equal(transformed.virtualizedTransformEvidence,true);assert.equal(transformed.rootChain[1].transform,'matrix');
 const nested=sidebarScrollFixture({owner:'sibling'});const result=await inspectSidebarReady(nested.x);
 assert.equal(result.candidateCount,1);assert.equal(result.candidates[0].withinRoot,true);assert.equal(result.candidates[0].containsRoot,false);
});

test('sidebar mechanism missing is a bounded explicit result and unknown rows always receive a reason',async()=>{
 const {x}=sidebarScrollFixture({owner:'none'});const result=await inspectSidebarReady(x);
 assert.equal(result.status,'scroll_mechanism_not_found');assert.equal(result.movement.attempted,false);assert.equal(result.movement.reason,'scroll_mechanism_not_found');assert.equal(result.routeUnchanged,true);
 const normalized=x.window.gptEnsureUnknownRowReasons([{status:'unknown',reason:'row_replaced'},{status:'unknown'},{status:'not pinned'}]);
 assert.deepEqual(Array.from(normalized,row=>row.unknownReason||null),['row_replaced','unclassified_row',null]);
});
test('sidebar mechanics diagnostic resolves without animation frames and returns stage timings plus a terminal result',async()=>{
 const {x,viewport}=sidebarScrollFixture();
 // A deliberately never-firing animation-frame callback must not block this diagnostic.
 x.window.requestAnimationFrame=()=>{};
 const result=await inspectSidebarReady(x,'isolated-proof');
 assert.equal(result.terminalStatus,'success');assert.equal(result.lastCompletedStage,'result_serialization_completed');
 assert.ok(result.ancestorCount>0);assert.equal(result.candidateCount,1);assert.equal(result.movement.attempted,true);assert.equal(result.movement.restored,true);assert.equal(viewport.scrollTop,5);
 assert.deepEqual(Array.from(result.stageTimings,entry=>entry.stage).filter(stage=>!stage.endsWith('_poll')&&stage!=='readiness_first_dom_sample'&&stage!=='readiness_final_sample'),['bridge_entered','readiness_completed','ancestor_snapshot_completed','candidate_analysis_completed','probe_started','probe_completed','result_serialization_completed']);
 assert.ok(x.diagnostics.some(event=>event.sidebarScrollMechanicsStage==='probe_started'&&event.operationToken==='isolated-proof'));
 assert.equal(JSON.stringify(result).includes('SECRET'),false);
});
test('sidebar mechanics diagnostic reports multiple candidates as structured terminal state',async()=>{
 const {x,viewport,docElement}=sidebarScrollFixture({docScroll:true});
 viewport.computedStyle.overflowY='auto';viewport.scrollHeight=900;viewport.scrollTop=5;
 const result=await inspectSidebarReady(x,'multi-proof');
 assert.equal(result.terminalStatus,'multiple_candidates');assert.equal(result.candidateCount,2);assert.equal(result.movement.attempted,false);assert.equal(docElement.scrollTop,10);
});
test('sidebar readiness is a synchronous one-shot sample and does not schedule JS timers',()=>{
 const {x,rows}=sidebarScrollFixture();let scheduled=0;const original=x.window.setTimeout;x.window.setTimeout=(...args)=>{scheduled++;return original(...args);};
 const first=x.window.gptSampleSidebarScrollReadiness({operationToken:'one-shot'});
 assert.equal(first.sidebarRootPresent,true);assert.equal(first.rowCount,2);assert.equal(first.identityCount,2);assert.equal(first.context,'chatgpt.com');assert.equal(typeof first.then,'undefined');assert.equal(scheduled,0);
 rows[0].computedStyle.transform='matrix(1,0,0,1,0,12)';rows[0].getBoundingClientRect=()=>({x:20,y:900,width:240,height:30,left:20,top:900,right:260,bottom:930});
 const same=x.window.gptSampleSidebarScrollReadiness({operationToken:'one-shot'});assert.equal(same.rowCount,2);assert.equal(same.identitySetChanged,false);assert.equal(same.identityOrderChanged,false);assert.equal(same.identitySetFingerprint,first.identitySetFingerprint);assert.equal(same.identityOrderFingerprint,first.identityOrderFingerprint);assert.equal(scheduled,0);
 rows.reverse();const reordered=x.window.gptSampleSidebarScrollReadiness({operationToken:'one-shot'});assert.equal(reordered.identitySetChanged,false);assert.equal(reordered.identityOrderChanged,true);assert.equal(reordered.identitySetFingerprint,first.identitySetFingerprint);assert.notEqual(reordered.identityOrderFingerprint,first.identityOrderFingerprint);
 rows[0].getAttribute=name=>name==='href'?'/g/project/c/new-id':null;const changedSet=x.window.gptSampleSidebarScrollReadiness({operationToken:'one-shot'});assert.equal(changedSet.identitySetChanged,true);assert.equal(changedSet.identityOrderChanged,true);assert.notEqual(changedSet.identitySetFingerprint,reordered.identitySetFingerprint);
 rows.push({...rows[0],getAttribute:name=>name==='href'?'/g/project/c/one':null});const duplicate=x.window.gptSampleSidebarScrollReadiness({operationToken:'one-shot'});assert.equal(duplicate.duplicateIdentityCount,1);assert.equal(duplicate.missingIdentityCount,0);
 rows.push({...rows[1],getAttribute:name=>name==='href'?'/g/project/c/third':null});const changedCount=x.window.gptSampleSidebarScrollReadiness({operationToken:'one-shot'});assert.equal(changedCount.rowCount,4);assert.equal(changedCount.identitySetChanged,true);
 const missing=sidebarScrollFixture();missing.document.querySelectorAll=()=>[];const noRoot=missing.x.window.gptSampleSidebarScrollReadiness({operationToken:'missing'});assert.equal(noRoot.sidebarRootPresent,false);assert.equal(noRoot.rowCount,0);
 assert.equal(JSON.stringify([first,same,reordered,changedSet,duplicate,changedCount]).includes('/g/project/c/'),false);
});
test('mechanics analysis requires native readiness and carries native poll telemetry',async()=>{
 const {x}=sidebarScrollFixture();
 const rejected=await x.window.gptInspectSidebarScrollMechanics({operationToken:'no-native-proof'});assert.equal(rejected.status,'readiness_sample_required');
 const result=await inspectSidebarReady(x,'native-proof');assert.equal(result.status,'movement_observed');assert.equal(result.pollCount,4);assert.equal(result.firstPollTimestampMs,0);assert.equal(result.lastPollTimestampMs,320);assert.equal(result.readinessDurationMs,320);assert.equal(result.nativeGuardFired,false);
});

test('same-document resume proof requires older unique activity and rejects stale pass replies',async()=>{
 const container={isConnected:true,clientHeight:500,clientWidth:500,scrollHeight:2400,scrollTop:900};
 const main={contains:node=>node===container,querySelectorAll:selector=>selector==='*'?[container]:[],closest:selector=>selector.includes('main')?main:null};
 const domNodes=[{id:'oldest',time:1},{id:'older',time:3},{id:'old',time:5},{id:'boundary',time:10},{id:'newer',time:20}].map(item=>({getAttribute:name=>name==='data-message-id'?item.id:null,closest:selector=>selector.includes('main')?main:null}));
 const document={querySelectorAll:selector=>selector==="main, [role='main']"?[main]:selector==='[data-message-id]'?domNodes:[],scrollingElement:null};
 const x=setup(document,setTimeout,()=>Date.now(),()=>({overflowY:'auto'}));
 const run=x.window.gptRunLiveDocumentResumeProof({conversationId:'a',operationGeneration:'operation-one',passDurationMs:1000});
 await new Promise(resolve=>setTimeout(resolve,40));const pass1=x.window.gptLiveResumeCaptureGeneration;
 x.receive({conversationId:'a',liveResumeGeneration:pass1,isPaginationResponse:true,hasPreviousPage:true,items:[{id:'boundary',activityTime:10},{id:'newer',activityTime:20}]});
 x.receive({conversationId:'a',liveResumeGeneration:pass1,isPaginationResponse:true,hasPreviousPage:true,items:[{id:'old',activityTime:5},{id:'boundary',activityTime:10}]});
 await new Promise(resolve=>setTimeout(resolve,1010));const pass2=x.window.gptLiveResumeCaptureGeneration;
 assert.notEqual(pass2,pass1);
 x.receive({conversationId:'a',liveResumeGeneration:pass1,isPaginationResponse:true,hasPreviousPage:true,items:[{id:'late-old',activityTime:1}]});
 x.receive({conversationId:'a',liveResumeGeneration:pass2,isPaginationResponse:true,hasPreviousPage:true,items:[{id:'older',activityTime:3},{id:'old',activityTime:5}]});
 x.receive({conversationId:'a',liveResumeGeneration:pass2,isPaginationResponse:true,hasPreviousPage:true,items:[{id:'oldest',activityTime:1},{id:'older',activityTime:3}]});
 const result=await run;
 assert.equal(result.status,'older_frontier_advanced');assert.equal(result.sameDocument,true);assert.equal(result.routeUnchanged,true);assert.equal(result.reloadBetweenPasses,false);
 assert.equal(result.pass1.pages,2);assert.equal(result.pass1.uniqueMessages,3);assert.equal(result.pass1.frontier,5);
 assert.equal(result.pass2.pages,2);assert.equal(result.pass2.newUniqueMessages,2);assert.equal(result.pass2.newOlderMessages,2);assert.equal(result.pass2.orderPreserved,true);
 assert.equal(result.pass2.ordering.payloadOrder,'ascending');assert.equal(result.pass2.ordering.pageArrival,'newer-to-older');assert.equal(result.pass2.ordering.chronologicalSequence,'proven');assert.equal(result.pass2.duplicateOccurrences,1);
 assert.equal(result.domOrder.candidateCount,5);assert.equal(result.domOrder.matchedTimestamps,5);assert.equal(result.domOrder.direction,'ascending');
 assert.equal(result.staleRepliesRejected,1);assert.equal(x.window.gptLiveResumeCaptureGeneration,null);assert.equal(container.scrollTop,900);
});

test('same-document resume ordering is not proven from timestamp ties or mixed payload order',async()=>{
 const container={isConnected:true,clientHeight:500,clientWidth:500,scrollHeight:2400,scrollTop:900};
 const main={contains:node=>node===container,querySelectorAll:selector=>selector==='*'?[container]:[],closest:selector=>selector.includes('main')?main:null};
 const document={querySelectorAll:selector=>selector==="main, [role='main']"?[main]:[],scrollingElement:null};
 const x=setup(document,setTimeout,()=>Date.now(),()=>({overflowY:'auto'}));
 const run=x.window.gptRunLiveDocumentResumeProof({conversationId:'a',operationGeneration:'tied-order',passDurationMs:1000});
 await new Promise(resolve=>setTimeout(resolve,40));const pass1=x.window.gptLiveResumeCaptureGeneration;
 x.receive({conversationId:'a',liveResumeGeneration:pass1,isPaginationResponse:true,hasPreviousPage:true,items:[{id:'p1a',activityTime:10},{id:'p1b',activityTime:20}]});
 x.receive({conversationId:'a',liveResumeGeneration:pass1,isPaginationResponse:true,hasPreviousPage:true,items:[{id:'p1old',activityTime:5},{id:'p1a',activityTime:10}]});
 await new Promise(resolve=>setTimeout(resolve,1010));const pass2=x.window.gptLiveResumeCaptureGeneration;
 x.receive({conversationId:'a',liveResumeGeneration:pass2,isPaginationResponse:true,hasPreviousPage:true,items:[{id:'p2a',activityTime:3},{id:'p2b',activityTime:3}]});
 x.receive({conversationId:'a',liveResumeGeneration:pass2,isPaginationResponse:true,hasPreviousPage:true,items:[{id:'p2old',activityTime:1},{id:'p2a',activityTime:3}]});
 const result=await run;assert.equal(result.status,'frontier_not_proven');assert.equal(result.pass2.ordering.chronologicalSequence,'not_proven');assert.equal(result.pass2.ordering.chronologicalEqualAdjacentTimes,1);assert.equal(result.pass2.orderPreserved,false);
});
test('same-document resume proof cancellation is bounded and restores the starting scroll position',async()=>{
 const container={isConnected:true,clientHeight:500,clientWidth:500,scrollHeight:2400,scrollTop:700};
 const main={contains:node=>node===container,querySelectorAll:selector=>selector==='*'?[container]:[]};
 const document={querySelectorAll:selector=>selector==="main, [role='main']"?[main]:[],scrollingElement:null};
 const x=setup(document,setTimeout,()=>Date.now(),()=>({overflowY:'auto'}));
 const run=x.window.gptRunLiveDocumentResumeProof({conversationId:'a',operationGeneration:'cancel-op',passDurationMs:60000});
 await new Promise(resolve=>setTimeout(resolve,25));assert.equal(x.window.gptCancelLiveDocumentResumeProof('cancel-op'),true);
 const result=await run;assert.equal(result.status,'cancelled');assert.equal(result.routeUnchanged,true);assert.equal(x.window.gptLiveResumeCaptureGeneration,null);assert.equal(container.scrollTop,700);
 assert.equal(x.resumeMessages.at(-1).status,'cancelled');
});

test('page hook tags each captured conversation response with the generation present when its request began',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../extension/page-hook.js'),'utf8');
 assert.match(source,/const liveResumeGeneration = typeof window\.gptLiveResumeCaptureGeneration === "string"[\s\S]*const responsePromise = originalFetch\.apply\(this, args\)/);
 assert.match(source,/capture\(requestUrl, payload, "fetch", responseMeta\)/);
 assert.match(source,/capture\(requestUrl, payload, "XHR", metadata\)/);
 assert.match(source,/responsePipelineSequence/);assert.match(source,/requestCursorFingerprint/);assert.match(source,/responsePageFingerprint/);
 assert.match(source,/const responseClone = response\.clone\(\)/);
 assert.match(source,/activityTime: Number\.isFinite\(createdAt\) && createdAt > 0 \? createdAt : null/);
});

test('visible session render snapshot reports safe message geometry and computed paintability without content',()=>{
 const message={tagName:'ARTICLE',getBoundingClientRect:()=>({x:120,y:180,left:120,top:180,right:520,bottom:300,width:400,height:120}),contains:node=>node===message};
 const html={clientWidth:1200,clientHeight:800,scrollWidth:1200,scrollHeight:2400,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:1200,bottom:2400,width:1200,height:2400})};
 const body={clientWidth:1200,clientHeight:800,scrollWidth:1200,scrollHeight:2400,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:1200,bottom:2400,width:1200,height:2400})};
 const document={readyState:'complete',documentElement:html,body,querySelectorAll:selector=>selector==='[data-message-author-role]'?[message]:[],elementFromPoint:()=>message};
 const x=setup(document,setTimeout,()=>Date.now(),()=>({display:'block',visibility:'visible',opacity:'1'}));
 x.window.innerWidth=1200;x.window.innerHeight=800;
 const result=x.window.gptSessionRenderSnapshot();
 assert.equal(result.documentReadyState,'complete');assert.equal(result.messageElementCount,1);
 assert.equal(result.fallbackCandidateCount,1);assert.equal(result.selectorCounts.dataMessageAuthorRole,1);
 assert.equal(result.nonzeroMessageRects,1);assert.equal(result.visibleMessageSamples,1);
 assert.equal(result.messageSamples[0].rect.x,120);assert.equal(result.messageSamples[0].rect.y,180);
 assert.equal(result.messageSamples[0].rect.width,400);assert.equal(result.messageSamples[0].rect.height,120);
 assert.equal(result.messageSamples[0].rect.right,520);assert.equal(result.messageSamples[0].rect.bottom,300);
 assert.equal(result.messageSamples[0].centerHitWithinMessage,true);
 assert.equal(result.viewportCenterHit.tag,'ARTICLE');
 assert.equal(JSON.stringify(result).includes('SECRET'),false);
 assert.equal(JSON.stringify(result).includes('conversationId'),false);
});

test('conversation layout compares real text boxes and the actual nested scroller without reading content',()=>{
 let boxes=[{x:100,y:120,left:100,top:120,right:320,bottom:140,width:220,height:20}];
 const rect={x:80,y:100,left:80,top:100,right:480,bottom:250,width:400,height:150};
 const make=(tag,parent,style={})=>({tagName:tag,parentElement:parent,children:[],scrollTop:0,scrollHeight:600,clientHeight:600,style,
  getBoundingClientRect:()=>rect,closest:()=>null});
 const main=make('MAIN',null),scroll=make('DIV',main,{overflowY:'auto'}),target=make('DIV',scroll),marker=make('SPAN',target);
 scroll.scrollTop=1200;scroll.scrollHeight=2400;scroll.children=[target];main.children=[scroll];target.children=[marker];
 marker.getBoundingClientRect=()=>({...rect,width:1,height:1});
 const text={parentElement:target};for(const field of ['textContent','nodeValue','data'])Object.defineProperty(text,field,{get(){throw Error('private content must not be read');}});
 const document={readyState:'complete',querySelectorAll:()=>[marker],elementFromPoint:()=>target,
  createTreeWalker:node=>{let visited=false;return {nextNode:()=>visited?null:(visited=true,node===target?text:null)};},
  createRange:()=>({selectNodeContents(){},getClientRects:()=>boxes,detach(){}})};
 const styles=node=>({display:'block',visibility:'visible',opacity:'1',overflowY:'visible',overflowX:'visible',position:'relative',transform:'none',...node.style,
  getPropertyValue:name=>({'content-visibility':'auto',contain:'layout paint','contain-intrinsic-size':'auto 200px','clip-path':'url(#PRIVATE-ID)'}[name]||'')});
 const x=setup(document,setTimeout,Date.now,styles);x.window.innerWidth=800;x.window.innerHeight=600;
 const visible=x.window.gptConversationLayoutSnapshot();
 assert.equal(visible.markerCount,1);assert.equal(visible.actualTextLayoutCandidates,1);assert.equal(visible.viewportTextRectCount,1);
 assert.equal(visible.scrollContainer.scrollTop,1200);assert.equal(visible.scrollContainer.scrollHeight,2400);assert.equal(visible.scrollContainer.clientHeight,600);
 assert.equal(visible.primaryHierarchy.at(-1).tag,'main');assert.equal(visible.candidates[0].firstTextParent.clipPath,'other');
 boxes=[];const blank=x.window.gptConversationLayoutSnapshot();
 assert.equal(blank.markerCount,1);assert.equal(blank.actualTextLayoutCandidates,0);assert.equal(blank.viewportTextRectCount,0);
 assert.equal(JSON.stringify(visible).includes('PRIVATE'),false);
});

test('post-restore paint watch observes a bounded candidate and two sanitized frame samples',async()=>{
 const message={tagName:'ARTICLE',getBoundingClientRect:()=>({x:24,y:36,left:24,top:36,right:224,bottom:96,width:200,height:60}),contains:node=>node===message};
 const html={clientWidth:800,clientHeight:600,scrollWidth:800,scrollHeight:1200,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:800,bottom:1200,width:800,height:1200})};
 const body={clientWidth:800,clientHeight:600,scrollWidth:800,scrollHeight:1200,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:800,bottom:1200,width:800,height:1200})};
 const document={readyState:'complete',documentElement:html,body,querySelectorAll:selector=>selector==='[data-user-message-bubble]'?[message]:[],elementFromPoint:()=>message};
 const x=setup(document,setTimeout,()=>Date.now(),()=>({display:'block',visibility:'visible',opacity:'1'}));
 x.window.innerWidth=800;x.window.innerHeight=600;
 const result=await x.window.gptWatchConversationPaint({timeoutMs:1000});
 assert.equal(result.status,'render_target_observed');assert.equal(result.firstCandidateCount,1);
 assert.equal(result.selectorCounts.dataUserMessageBubble,1);
 assert.equal(result.afterFirstFrame.candidateCount,1);assert.equal(result.afterSecondFrame.candidateCount,1);
 assert.equal(result.firstCandidateRects[0].rect.x,24);assert.equal(result.firstCandidateRects[0].rect.height,60);
 const serialized=JSON.stringify(result);assert.equal(serialized.includes('textContent'),false);assert.equal(serialized.includes('conversationId'),false);
});

test('post-restore paint watch records a candidate that appears after an asynchronous DOM mutation',async()=>{
 let inserted=false;
 const message={tagName:'DIV',getAttribute:name=>name==='data-conversation-role'?'assistant':null,
  getBoundingClientRect:()=>({x:12,y:40,left:12,top:40,right:212,bottom:92,width:200,height:52}),contains:node=>node===message,
  attributes:[{name:'data-conversation-role',value:'assistant'}]};
 const html={clientWidth:900,clientHeight:700,scrollWidth:900,scrollHeight:1400,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:900,bottom:1400,width:900,height:1400})};
 const body={...html};
 const document={readyState:'complete',documentElement:html,body,querySelectorAll:selector=>selector==='[data-conversation-role]'&&inserted?[message]:[],elementFromPoint:()=>message};
 const x=setup(document,setTimeout,()=>Date.now(),()=>({display:'block',visibility:'visible',opacity:'1'}));
 x.window.innerWidth=900;x.window.innerHeight=700;
 const resultPromise=x.window.gptWatchConversationPaint({timeoutMs:1000});
 inserted=true;document.__notifyMutation([{type:'childList'}]);
 const result=await resultPromise;
 assert.equal(result.status,'render_target_observed');assert.equal(result.firstCandidateCount,1);
 assert.equal(result.selectorCounts.dataConversationRole,1);assert.equal(result.firstCandidateRects[0].tag,'div');
 assert.deepEqual(Array.from(result.firstCandidateRects[0].attributeNames),['data-conversation-role']);
 assert.equal(JSON.stringify(result).includes('assistant'),false);
});

test('paint watch ignores 1x1 conversation markers until a visible message container exists',async()=>{
 const container={tagName:'DIV',attributes:[{name:'data-testid',value:'private-value'}],parentElement:null,
  getAttribute:name=>name==='class'?'private class names':null,
  getBoundingClientRect:()=>({x:90,y:80,left:90,top:80,right:490,bottom:180,width:400,height:100}),
  contains:node=>node===container||node===marker};
 const marker={tagName:'SPAN',attributes:[{name:'data-user-message-bubble',value:''}],parentElement:container,
  getAttribute:name=>name==='class'?'private marker':null,
  getBoundingClientRect:()=>({x:400,y:-22000,left:400,top:-22000,right:401,bottom:-21999,width:1,height:1}),
  contains:node=>node===marker};
 const html={clientWidth:800,clientHeight:600,scrollWidth:800,scrollHeight:1200,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:800,bottom:1200,width:800,height:1200})};
 const body={...html};
 const document={readyState:'complete',documentElement:html,body,
  querySelectorAll:selector=>selector==='[data-user-message-bubble]'?[marker]:[],elementFromPoint:()=>container};
 const x=setup(document,setTimeout,()=>Date.now(),()=>({display:'block',visibility:'visible',opacity:'1'}));
 x.window.innerWidth=800;x.window.innerHeight=600;
 const result=await x.window.gptWatchConversationPaint({timeoutMs:1000});
 assert.equal(result.status,'render_target_observed');
 assert.equal(result.firstCandidateRects[0].rect.width,1);
 assert.equal(result.firstRenderTargetCount,1);assert.equal(result.firstVisibleRenderTargetCount,1);
 assert.equal(result.firstRenderTargetSamples[0].rect.width,400);
 assert.equal(result.afterSecondFrameVisibleRenderTargets,1);
 const encoded=JSON.stringify(result);for(const secret of ['private-value','private class names','private marker'])assert.equal(encoded.includes(secret),false);
});

test('sidebar route diagnostic masks opaque segments, ignores query values, and keeps project/unknown routes separate',()=>{
 const make=(href,role='link')=>({tagName:'A',hidden:false,attributes:[{name:'data-testid'}],parentElement:null,getAttribute:name=>name==='href'?href:name==='role'?(role==='link'?null:role):name==='aria-current'?null:null,getClientRects:()=>[{}],querySelectorAll:()=>[]});
 const links=[make('/c/private-conversation?private=query'),make('/g/private-space/c/private-chat?title=secret'),make('/g/private-space'),make('/mystery/private-project?secret=1')];
 const button={tagName:'BUTTON',getAttribute:name=>name==='role'?'button':null};
 const nav={tagName:'NAV',hidden:false,parentElement:null,getAttribute:()=>null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:300,bottom:700,width:300,height:700}),contains:node=>links.includes(node)||rows.includes(node),querySelectorAll:selector=>selector==='a[href]'?links:[]};
 const rows=links.map((anchor,index)=>{const row={tagName:'DIV',attributes:[{name:'data-testid'}],parentElement:nav,getAttribute:name=>name==='role'?'listitem':null,querySelectorAll:selector=>selector==='a[href]'?[anchor]:[],querySelector:selector=>index===0&&selector.includes('button')?button:null};anchor.parentElement=row;return row;});
 const x=setup({querySelectorAll:selector=>selector==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[nav]:[]});
 const result=x.window.gptInspectSidebarRoutes();
 assert.deepEqual(Array.from(result.routes,route=>route.template),['/c/<id>','/g/<id>/c/<id>','/g/<id>','/<id>/<id>']);
 assert.deepEqual(Array.from(result.routes,route=>route.kind),['conversation','conversation','project','unknown']);
 assert.equal(result.firstConversation.template,'/c/<id>');assert.equal(result.firstConversation.rowRole,'listitem');
 assert.equal(result.firstConversation.rowHasButtonOrMenuControl,true);assert.equal(result.firstConversation.ancestorLevels,2);
 const encoded=JSON.stringify(result);for(const secret of ['private-conversation','private-space','private-chat','private-project','private=query','title=secret','href','secret=1'])assert.equal(encoded.includes(secret),false);
});

test('sidebar route diagnostic leaves unconfirmed opaque routes unknown and finds only classifier-approved conversation rows',()=>{
 const anchor={tagName:'A',hidden:false,parentElement:null,attributes:[],getAttribute:name=>name==='href'?'/mystery/private-id':null,getClientRects:()=>[{}],querySelectorAll:()=>[]};
 const row={tagName:'DIV',parentElement:null,attributes:[],getAttribute:()=>null,querySelectorAll:()=>[anchor],querySelector:()=>null};anchor.parentElement=row;
 const nav={tagName:'NAV',hidden:false,getClientRects:()=>[{}],getAttribute:()=>null,contains:()=>true,querySelectorAll:()=>[anchor]};
 const x=setup({querySelectorAll:()=>[nav]});const result=x.window.gptInspectSidebarRoutes();
 assert.equal(result.routes[0].kind,'unknown');assert.equal(result.firstConversation,null);assert.equal(result.routes[0].template,'/<id>/<id>');
});

test('root sidebar metadata inspection normalizes timestamp values and emits only safe active-row aggregates',()=>{
 const makeAttrs=values=>Object.entries(values).map(([name,value])=>({name,value:String(value)}));
 const heading={tagName:'H2',textContent:'Previous 7 days · PRIVATE HEADER',children:[],attributes:[],getAttribute:()=>null,getClientRects:()=>[{}]};
 const anchor={tagName:'A',hidden:false,attributes:makeAttrs({href:'/c/private-conversation-id','data-label':'private title'}),
  getAttribute:name=>name==='href'?'/c/private-conversation-id':null,getClientRects:()=>[{}],
  getBoundingClientRect:()=>({left:10,top:60,right:250,bottom:100,width:240,height:40})};
 const time={tagName:'TIME',dateTime:'2026-10-25T12:34:56.000Z',attributes:makeAttrs({datetime:'2026-10-25T12:34:56.000Z'}),
  getAttribute:name=>name==='datetime'?'2026-10-25T12:34:56.000Z':null,getClientRects:()=>[{}]};
 const row={tagName:'DIV',attributes:makeAttrs({'data-update-time':'1792931696000','data-is-starred':'true','data-index':'0','data-label':'PRIVATE ROW TEXT'}),
  getAttribute:()=>null,getClientRects:()=>[{}],children:[anchor,time],querySelectorAll:selector=>selector==='a[href]'?[anchor]:selector==='*'?[time]:[],
  parentElement:null};anchor.parentElement=row;time.parentElement=row;
 const nav={tagName:'NAV',hidden:false,attributes:[],children:[heading,row],getAttribute:()=>null,getClientRects:()=>[{}],
  getBoundingClientRect:()=>({left:0,top:0,right:280,bottom:700,width:280,height:700}),
  querySelectorAll:selector=>selector==='a[href]'?[anchor]:selector==='h1,h2,h3,h4,h5,h6,[role="heading"],[role="separator"]'?[heading]:[],
  contains:node=>node===row||node===anchor||node===time||node===heading,scrollHeight:1000,clientHeight:700,scrollTop:0};
 row.parentElement=nav;heading.parentElement=nav;
 const document={querySelectorAll:selector=>selector==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[nav]:[],body:{}};
 const x=setup(document);
 const first=x.window.gptInspectRootSidebarMetadata(),second=x.window.gptInspectRootSidebarMetadata();
 assert.equal(first.activeSidebarFound,true);assert.equal(first.renderedRows,1);assert.equal(first.visibleRows,1);
 assert.equal(first.domOrderStable,false);assert.equal(second.domOrderStable,true);assert.equal(second.topProofPossible,true);
 assert.equal(first.exactActivityMetadataAvailable,true);assert.equal(first.timeElementRows,1);assert.equal(first.datetimeRows,1);
 assert.equal(first.numericEpochRows,1);assert.ok(first.dataTimestampAttributeNames.includes('data-update-time'));
 const update=first.timestampFields.find(item=>item.field==='data-update-time');assert.equal(update.valueType,'numeric_epoch_milliseconds');
 assert.deepEqual(Array.from(update.normalizedTimestamps),['2026-10-25T12:34:56.000Z']);assert.equal(update.rowsWithValue,1);
 assert.deepEqual(Array.from(first.sectionGroups,item=>item.category),['previous_7_days']);
 assert.equal(first.pinnedStarred.rowsWithPositiveMarker,1);assert.equal(first.archived.available,false);assert.equal(first.locked.available,false);
 assert.deepEqual(Array.from(first.orderIndexAttributeNames),['data-index']);assert.equal(first.rowsWithOrderIndex,1);
 assert.equal(first.rowsWithInternalIdentity,1);assert.equal(first.rowsWithoutInternalIdentity,0);
 assert.equal(first.scrollGeometry.scrollHeight,1000);assert.equal(first.scrollGeometry.clientHeight,700);assert.equal(first.scrollGeometry.scrollRangePx,300);assert.equal(first.scrollGeometry.atScrollExtent,true);
 assert.equal(first.endOfListProof,'unavailable');
 const encoded=JSON.stringify(first);
 for(const secret of ['private-conversation-id','private title','PRIVATE ROW TEXT','PRIVATE HEADER','href','data-label','PRIVATE'])assert.equal(encoded.includes(secret),false);
});

test('root sidebar scroll diagnostic identifies the live scroll owner, detects row replacement, and never proves root completeness',async()=>{
 let scrollTop=0,page=0;
 const makeAnchor=id=>({tagName:'A',hidden:false,attributes:[],parentElement:null,getAttribute:name=>name==='href'?`/c/${id}`:null,getClientRects:()=>[{}],
  getBoundingClientRect:()=>({left:10,top:60,right:240,bottom:96,width:230,height:36})});
 const first=[makeAnchor('PRIVATE-FIRST-A'),makeAnchor('PRIVATE-FIRST-B')],second=[makeAnchor('PRIVATE-OLDER-A'),makeAnchor('PRIVATE-OLDER-B')];
 const root={tagName:'NAV',hidden:false,attributes:[],parentElement:null,clientHeight:140,get scrollHeight(){return page===0?400:700;},get scrollTop(){return scrollTop;},set scrollTop(value){scrollTop=value;if(value>0)page=1;else page=0;},
  getClientRects:()=>[{}],getBoundingClientRect:()=>({left:0,top:0,right:280,bottom:140,width:280,height:140}),contains:node=>node===root||[...first,...second].includes(node),
  querySelectorAll:selector=>selector==='a[href]'?(page===0?first:second):[]};
 for(const anchor of [...first,...second])anchor.parentElement=root;
 const document={body:{},querySelectorAll:selector=>selector==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[root]:[]};
 const x=setup(document,setTimeout,Date.now,()=>({overflowY:'auto',display:'block',visibility:'visible',opacity:'1'}));x.window.innerWidth=800;x.window.innerHeight=600;
 const result=await x.window.gptDiagnoseRootSidebarScroll({operationToken:'diagnostic-token',maxSteps:5,settleMs:0});
 assert.equal(result.scrollOwnerFound,true);assert.equal(result.scrollOwnerTag,'nav');assert.equal(result.status,'bounded_bottom_quiescent');
 assert.equal(result.virtualized,true);assert.equal(result.lazyLoadingObserved,true);assert.equal(result.boundedEndCandidate,true);
 assert.equal(result.rootUniverseComplete,false);assert.equal(result.endOfListProof,'unavailable');assert.equal(result.scrollRestoreSuccessful,true);
 assert.ok(result.steps.some(step=>step.newIdentities>0&&step.previousIdentitiesMissingFromDOM>0));
 const encoded=JSON.stringify(result);
 for(const secret of ['PRIVATE-FIRST-A','PRIVATE-FIRST-B','PRIVATE-OLDER-A','PRIVATE-OLDER-B','/c/','href','title','message'])assert.equal(encoded.includes(secret),false);
});

test('sidebar pagination uses scrollable ancestors and never reads DOM message content',()=>{
 const scroller={scrollHeight:1000,clientHeight:200,scrollTop:0,parentElement:null};Object.defineProperty(scroller,'innerText',{get(){throw Error('DOM text forbidden')}});
 const a={closest:()=>null,parentElement:scroller};const x=setup({querySelectorAll:selector=>selector.startsWith('a[')?[a]:[],body:{}});
 assert.equal(x.window.gptScrollSidebar(),true);assert.equal(scroller.scrollTop,800);
 assert.equal(x.window.gptScrollSidebar(),false);assert.equal(scroller.scrollTop,800);
});

function starredDocument({initial=true,noOp=false,role='button',sidebar=true}={}){
 let expanded=initial,clicks=0;const links=[{tagName:'A',hidden:false,parentElement:null,getAttribute:k=>k==='href'?'/c/private-starred-chat':null,getClientRects:()=>[{}]}];
 const list={hidden:false,getClientRects:()=>[{}],getAttribute:k=>k==='role'?'list':null,querySelectorAll:s=>s==='a[href*="/c/"]'||s==='a[href]'?links:[]};
 links[0].parentElement=list;
 const nav={hidden:false,getAttribute:()=>null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:20,width:260,height:700}),
  contains:node=>node===disclosure||node===list,
  querySelectorAll:s=>s==='a[href*="/c/"]'||s==='a[href]'?links:(s.includes('button')||s.includes('[aria-expanded]'))?[disclosure]:[]};
 const disclosure={tagName:'BUTTON',childNodes:[{nodeType:3,nodeValue:'Закрепленные'}],
  parentElement:{children:[]},
  getAttribute:k=>({role, 'aria-label':'Pinned','aria-expanded':String(expanded),'aria-controls':'starred-list'}[k]??null),
  closest:s=>sidebar&&s.includes('nav')?nav:null,
  click(){clicks++;if(!noOp)expanded=!expanded;}};
 disclosure.parentElement.children=[disclosure,list];
 const document={body:Object.defineProperty({},'innerText',{get(){throw Error('conversation text must not be read')}}),
  querySelectorAll:s=>s==='[aria-expanded]'?[disclosure]:s==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'&&sidebar?[nav]:[],getElementById:id=>id==='starred-list'?list:null};
 return {document,disclosure,list,links,nav,get expanded(){return expanded;},get clicks(){return clicks;}};
}

test('starred control requires disclosure role and sidebar/list relationship; state change is verified after exactly one click',async()=>{
 const dom=starredDocument({initial:false}),x=setup(dom.document);
 const resultPromise=x.window.gptToggleStarredSectionOnce();
 const result=await resultPromise;
 assert.equal(result.before.controlFound,true);assert.equal(result.before.role,'button');assert.equal(result.before.expanded,false);
 assert.equal(result.after.expanded,true);assert.equal(result.verified,true);assert.equal(dom.clicks,1);
 assert.equal(result.before.controlledList,true);assert.equal(result.after.visibleConversationLinkCount,1);
 assert.ok(!JSON.stringify(result).includes('href'));
});

test('wrong role or unrelated disclosure is not treated as the starred control',()=>{
 const wrongRole=starredDocument({role:'region'}),a=setup(wrongRole.document);
 assert.equal(a.window.gptInspectStarredControl().controlFound,false);
 const unrelated=starredDocument({sidebar:false});
 unrelated.disclosure.getAttribute=k=>k==='aria-expanded'?'false':k==='role'?'button':k==='aria-label'?'Закрепленные':null;
 const b=setup(unrelated.document);assert.equal(b.window.gptInspectStarredControl().controlFound,false);
});

test('no-op starred click is not reported as a successful UI trigger',async()=>{
 const dom=starredDocument({initial:false,noOp:true}),x=setup(dom.document);
 const result=await x.window.gptToggleStarredSectionOnce();
 assert.equal(dom.clicks,1);assert.equal(result.before.expanded,false);assert.equal(result.after.expanded,false);assert.equal(result.verified,false);
});

test('scheduled trigger never closes an already-open starred section',()=>{
 const dom=starredDocument({initial:true}),x=setup(dom.document);
 assert.equal(x.window.gptOpenStarredSection(),true);assert.equal(dom.clicks,0);assert.equal(dom.expanded,true);
});

test('starred disclosure is not found through chat rows or triggers any owned fetch',()=>{
 const document={querySelectorAll:s=>s==='[aria-expanded]'?[]:[]};const x=setup(document);
 assert.equal(x.window.gptOpenStarredSection(),false);
 assert.throws(()=>x.window.fetch('/backend-api/conversations'),/owned fetch forbidden/);
});

test('sidebar absence is reported separately from starred disclosure absence',()=>{
 const x=setup({querySelectorAll:()=>[],getElementById:()=>null});
 const result=x.window.gptInspectStarredControl(null);
 assert.equal(result.controlFound,false);assert.equal(result.reason,'not_found');
 assert.equal(x.window.gptInspectSidebar().found,false);assert.equal(x.window.gptInspectSidebar().visible,false);
});

function topChatRowsDocument(menuLabels, directMarkers={},escapeCloses=true){
 let activeMenu=null,opens=0,closes=0,actionClicks=0;const rows=[];
 const nav={hidden:false,getAttribute:()=>null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:300,bottom:700,width:300,height:700}),
  querySelectorAll:s=>s==='a[href*="/c/"]'||s==='a[href]'?rows.map(row=>row.anchor):[]};
 const document={body:{},getElementById:()=>null,dispatchEvent:event=>{if(escapeCloses&&event.key==='Escape'&&activeMenu){activeMenu=null;closes++;}},
  querySelectorAll:s=>s==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[nav]:s==='[role="menu"]'?(activeMenu?[activeMenu]:[]):s==='a[href*="/c/"]'||s==='a[href]'?rows.map(row=>row.anchor):[]};
 menuLabels.forEach((labels,index)=>{
  const actions=labels.map(label=>({getAttribute:name=>name==='role'?'menuitem':null,innerText:label,getClientRects:()=>[{}],click(){actionClicks++;}}));
  const menu={getClientRects:()=>[{}],querySelectorAll:()=>actions};
  const row={className:'chat-row',attributes:[],parentElement:nav,getAttribute:name=>directMarkers[index]?.[name]??null,querySelectorAll:s=>s==='a[href*="/c/"]'||s==='a[href]'?[row.anchor]:s==='button,[role="button"]'?[row.trigger]:[]};
  row.anchor={parentElement:row,hidden:false,getClientRects:()=>[{}],getAttribute:name=>name==='href'?`/c/private-id-${index+1}`:null};
  row.trigger={tagName:'BUTTON',className:'row-menu',getAttribute:name=>({role:'button','aria-haspopup':'menu','aria-label':'Conversation options'}[name]??null),click(){assert.equal(activeMenu,null,'previous row menu must close before the next opens');activeMenu=menu;opens++;}};
  rows.push(row);
 });
 return {document,rows,get activeMenu(){return activeMenu;},get opens(){return opens;},get closes(){return closes;},get actionClicks(){return actionClicks;}};
}

test('top-row pin inspection opens and closes one context menu at a time without selecting actions',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};
 const dom=topChatRowsDocument([['Remove from pinned'],['Pin conversation']]);
 const x=setup(dom.document,timer,()=>time);
 const privateIds=[];x.window.gptSummarizePinnedLinkSources=ids=>{privateIds.push(...ids);return {networkMatchedCount:1,updatedAtCount:1,sources:[{pathname:'/backend-api/conversations',status:200,queryKeys:['is_starred','offset'],itemCount:20,containsUpdateTime:true}]};};
 const result=await x.window.gptInspectTopChatPinStatus();
 assert.deepEqual(Array.from(result.rows,row=>row.status),['pinned','not pinned'],JSON.stringify(result));
 assert.equal(dom.opens,2);assert.equal(dom.closes,2);assert.equal(dom.activeMenu,null);assert.equal(dom.actionClicks,0);
 assert.equal(result.contiguousTopBlock,'yes');assert.equal(result.source.matched,true);assert.equal(result.source.updatedAtCount,1);
 const exported=JSON.stringify(result);assert.ok(!exported.includes('private-id'));assert.ok(!exported.includes('title'));assert.ok(!exported.includes('href'));
 assert.deepEqual(privateIds,['private-id-1']);
 assert.ok(x.diagnostics.some(item=>item.topChatPinProgress?.stage==='menu opened'));
 assert.ok(x.diagnostics.some(item=>item.topChatPinProgress?.stage==='menu closed'));
});

test('top pinned rows must form a prefix; passive source summary never exports row identifiers',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};
 const dom=topChatRowsDocument([['Remove from pinned'],['Pin'],[]],{2:{'data-is-pinned':'true'}});
 const x=setup(dom.document,timer,()=>time);
 x.window.gptSummarizePinnedLinkSources=ids=>({networkMatchedCount:0,updatedAtCount:0,sources:[]});
 const result=await x.window.gptInspectTopChatPinStatus();
 assert.deepEqual(Array.from(result.rows,row=>row.status),['pinned','not pinned','pinned']);
 assert.equal(result.contiguousTopBlock,'no');
 assert.equal(result.pinnedCount,2);assert.equal(result.notPinnedCount,1);assert.equal(result.unknownCount,0);
 assert.ok(!JSON.stringify(result).includes('private-id'));
});

test('missing menu times out as unknown and diagnostic resolves with safe reason',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};
 const dom=topChatRowsDocument([[]]);dom.rows[0].trigger.click=()=>{};
 const x=setup(dom.document,timer,()=>time);
 x.window.gptSummarizePinnedLinkSources=()=>null;
 const result=await x.window.gptInspectTopChatPinStatus({maxRows:3,hardTimeoutMs:5000});
 assert.equal(result.rowsAttempted,1);assert.equal(result.rowsCompleted,1);
 assert.equal(result.rows[0].status,'unknown');assert.equal(result.rows[0].reason,'menu_appear_timeout');
 assert.equal(result.menuLeftOpen,false);
});

test('menu cleanup failure stops before clicking the next row',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};
 const dom=topChatRowsDocument([['Unpin conversation'],['Pin conversation']],{},false);
 const x=setup(dom.document,timer,()=>time);
 x.window.gptSummarizePinnedLinkSources=()=>null;
 const result=await x.window.gptInspectTopChatPinStatus({maxRows:3,hardTimeoutMs:8500});
 assert.equal(result.rowsAttempted,1);assert.equal(result.rowsCompleted,1);
 assert.equal(result.rows[0].status,'unknown');assert.equal(result.rows[0].reason,'menu_cleanup_timeout');
 assert.equal(result.menuLeftOpen,true);assert.equal(dom.opens,1);assert.equal(dom.actionClicks,0);
});

test('hard timeout returns partial result and diagnostic version marker is exposed',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};
 const dom=topChatRowsDocument([[]]);dom.rows[0].trigger.click=()=>{};
 const x=setup(dom.document,timer,()=>time);
 x.window.gptSummarizePinnedLinkSources=()=>null;
 assert.equal(x.window.pinnedDiagnosticVersion,'5.31.0');
 const result=await x.window.gptInspectTopChatPinStatus({maxRows:3,hardTimeoutMs:100});
 assert.equal(result.version,'5.31.0');assert.equal(result.reason,'hard_timeout');
 assert.equal(result.rows[0].status,'unknown');assert.equal(result.timeoutRowIndex,1);
});

function visiblePinnedRowsDocument(actionLabels,{scrollTop=0,escapeCloses=true,triggerClickCloses=false,includeProject=true,onOpen=null,conversationRoutes=[]}={}){
 let activeMenu=null,openCount=0,closeCount=0,actionClicks=0;const rows=[],allLinks=[];
 const makeNode=(tag,attrs={},rect={x:0,y:0,width:300,height:36})=>({tagName:tag.toUpperCase(),attributes:Object.entries(attrs).map(([name,value])=>({name,value})),parentElement:null,children:[],hidden:false,
  scrollTop:0,scrollHeight:0,clientHeight:0,getAttribute(name){return attrs[name]??null;},hasAttribute(name){return Object.prototype.hasOwnProperty.call(attrs,name);},getClientRects(){return [rect];},getBoundingClientRect(){return {...rect,left:rect.x,top:rect.y,right:rect.x+rect.width,bottom:rect.y+rect.height};},
  querySelectorAll(selector){const result=[];const matches=node=>selector.split(',').some(part=>{
   part=part.trim();if(part==='a[href]')return node.tagName==='A'&&!!node.getAttribute('href');
   if(part==='button[aria-haspopup="menu"]')return node.tagName==='BUTTON'&&node.getAttribute('aria-haspopup')==='menu';
   if(part==='button,[role="button"],span[role="button"]')return node.tagName==='BUTTON'||node.getAttribute('role')==='button';
   return false;});const visit=node=>{for(const child of node.children||[]){if(matches(child))result.push(child);visit(child);}};visit(this);return result;},
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;},dispatchEvent(event){if((event.type==='pointerdown'||event.type==='click')&&!activeMenu){activeMenu=this.__menu;openCount++;this.afterOpen?.();}return true;},append(child){child.parentElement=this;this.children.push(child);}});
 const nav=makeNode('nav',{}, {x:0,y:0,width:320,height:600});nav.scrollTop=scrollTop;nav.scrollHeight=1200;nav.clientHeight=600;
 const document={readyState:'complete',body:{},documentElement:{clientWidth:1024,clientHeight:768},getElementById:()=>null,
  dispatchEvent(event){if(event.key==='Escape'&&activeMenu&&escapeCloses){activeMenu=null;closeCount++;}},
  querySelectorAll(selector){if(selector==='nav,aside,[role="navigation"],[data-testid*="sidebar"]')return [nav];if(selector.startsWith('[role="menu"]'))return activeMenu?[activeMenu]:[];return [];}};
 const appendConversation=(labels,index)=>{
  const row=makeNode('div',{}, {x:0,y:36*index,width:320,height:36});const menu={tagName:'DIV',textContent:'PRIVATE MENU CONTENT',getAttribute:name=>name==='role'?'menu':null,hasAttribute:()=>false,getClientRects:()=>activeMenu===menu?[{}]:[],
   querySelectorAll:()=>labels.map(label=>({tagName:'BUTTON',textContent:label,innerText:label,getAttribute:name=>name==='role'?'menuitem':null,getClientRects:()=>activeMenu===menu?[{}]:[],hasAttribute:()=>false})),querySelector:()=>({}),hasAttribute:()=>false};
  const anchor=makeNode('a',{href:conversationRoutes[index]||`/c/private-chat-${index+1}`},{x:8,y:36*index,width:230,height:36});
  const trigger=makeNode('button',{'aria-haspopup':'menu'},{x:270,y:36*index+8,width:20,height:20});trigger.__menu=menu;trigger.afterOpen=()=>onOpen?.(index,appendConversation);
  trigger.click=()=>{if(activeMenu===menu&&triggerClickCloses){activeMenu=null;closeCount++;}else if(!activeMenu){activeMenu=menu;openCount++;trigger.afterOpen?.();}};
  row.append(anchor);row.append(trigger);nav.append(row);rows.push({row,anchor,trigger});allLinks.push(anchor);nav._placeRow?.(rows.at(-1));
  if(includeProject&&index===0){const project=makeNode('a',{href:'/g/private-project'},{x:0,y:18,width:300,height:18});nav.append(project);allLinks.push(project);}
 };
 actionLabels.forEach((labels,index)=>appendConversation(labels,index));
 return {document,nav,rows,appendConversation,get activeMenu(){return activeMenu;},get openCount(){return openCount;},get closeCount(){return closeCount;},get actionClicks(){return actionClicks;},get allLinks(){return allLinks;}};
}

function makePinnedRowsPartiallyVisible(dom,height=36,{scrollFails=false}={}){
 dom.nav.clientHeight=height;
 dom.nav.getBoundingClientRect=()=>({x:0,y:0,width:320,height,left:0,top:0,right:320,bottom:height});
 if(scrollFails){let position=dom.nav.scrollTop;Object.defineProperty(dom.nav,'scrollTop',{configurable:true,get:()=>position,set:value=>{if(value===0)position=value;}});}
 const place=node=>{const index=dom.rows.findIndex(item=>item.row===node||item.anchor===node||item.trigger===node);if(index<0)return;const x=node===dom.rows[index].trigger?270:node===dom.rows[index].anchor?8:0,w=node===dom.rows[index].trigger?20:node===dom.rows[index].anchor?230:320,h=node===dom.rows[index].trigger?20:36;node.getBoundingClientRect=()=>{const y=index*60-(Number(dom.nav.scrollTop)||0);return {x,y,width:w,height:h,left:x,top:y,right:x+w,bottom:y+h};};};
 dom.nav._placeRow=item=>{place(item.row);place(item.anchor);place(item.trigger);};
 for(const item of dom.rows)dom.nav._placeRow(item);
 return dom;
}

test('v4.8 classifies a DOM-order snapshot, skips project links, re-resolves rows, and records safe menu counts',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};
 const dom=visiblePinnedRowsDocument([['Unpin chat','Rename'],['Unpin chat'],['Pin chat']]);const x=setup(dom.document,timer,()=>time);
 x.window.innerWidth=1024;x.window.innerHeight=768;
 x.window.gptListCycleConfig={token:'cycle'};
 x.window.gptResolvePinnedRecords=()=>[];
 const matched=[];x.window.gptSummarizePinnedLinkSources=ids=>{matched.push(...ids);return {pinnedLinkCount:ids.length,networkMatchedCount:2,updatedAtCount:2,starredTrueSourceAvailable:true,starredTrueOverlapCount:2,baseOverlapCount:0,
  sources:[{pathname:'/backend-api/conversations',status:200,queryKeys:['is_starred','offset'],itemCount:20,containsUpdateTime:true}],
  observedStreams:[{pathname:'/backend-api/conversations',status:200,queryKeys:['is_starred','offset'],itemCount:20,archived:false,starred:true,containsUpdateTime:true}]};};
 const result=await x.window.gptInspectVisiblePinnedRows({cycleToken:'cycle'});
 assert.equal(result.stopReason,'first_not_pinned',JSON.stringify(result));
 assert.equal(result.version,'5.31.0');assert.equal(result.prefixSnapshotCount,3);assert.equal(result.totalConversationLinksAtPrefixStart,3);assert.equal(result.visibleConversationLinksAtPrefixStart,3);assert.deepEqual(Array.from(result.rows,row=>row.status),['pinned','pinned','not pinned']);
 assert.equal(result.rowsAttempted,3);assert.equal(result.rowsCompleted,3);assert.equal(dom.openCount,3);assert.equal(dom.closeCount,3);assert.equal(dom.activeMenu,null);assert.equal(dom.actionClicks,0);
 assert.deepEqual(Array.from(result.rows,row=>[row.domConversationsBeforeMenu,row.domConversationsAfterCleanup]),[[3,3],[3,3],[3,3]]);
 assert.equal(result.contiguousPinnedPrefix,'yes');assert.equal(result.pinnedStructureComplete,'complete');assert.equal(result.source.matched,true);assert.equal(result.source.updatedAtCount,2);assert.deepEqual(matched,['private-chat-1','private-chat-2']);
 const serialized=JSON.stringify(result);for(const secret of ['private-chat-','private-project','PRIVATE MENU CONTENT','/g/private-project','href','title'])assert.equal(serialized.includes(secret),false);
});

test('manual pinned rows diagnostic returns sanitized snapshot with named stage callbacks',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']]),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:13,hardTimeoutMs:10000,sidebarDiagnosticRunID:'manual-normal'});
 assert.ok(result.sidebarDiagnosticSummary);assert.equal(result.sidebarDiagnosticSummary.result,'success',JSON.stringify({stopReason:result.stopReason,rows:result.rows,summary:result.sidebarDiagnosticSummary}));assert.equal(result.sidebarDiagnosticSummary.pinnedRowCandidateCount,1);
 const stages=x.diagnostics.filter(item=>item.sidebarDiagnosticRunID==='manual-normal').map(item=>item.visiblePinnedRowsStage?.stage).filter(Boolean);
 for(const stage of ['operation_started','sidebar_lookup_started','document_ready','sidebar_found','row_scan_started','row_scan_finished','route_template_scan_started','route_template_scan_finished'])assert.ok(stages.includes(stage),`missing stage ${stage}`);
 assert.ok(x.diagnostics.filter(item=>item.visiblePinnedRowsStage).every(item=>Number.isInteger(item.visiblePinnedRowsStage.elapsedMs)));
 const safe=JSON.stringify(result.sidebarDiagnosticSummary);for(const secret of ['private-chat-','private-project','href','title','content'])assert.equal(safe.includes(secret),false);
});

test('manual pinned rows diagnostic returns a partial result when sidebar is absent',async()=>{
 const dom=stagedPreflightDocument({readyState:'complete',sidebar:false,list:false}),x=setup(dom.document);const started=Date.now();
 const result=await x.window.gptInspectVisiblePinnedRows({hardTimeoutMs:6000,sidebarDiagnosticRunID:'manual-no-sidebar'});
 assert.equal(result.sidebarDiagnosticSummary.result,'failure');assert.equal(result.sidebarDiagnosticSummary.reason,'sidebar_root_missing');assert.ok(Date.now()-started<5500);
 assert.ok(x.diagnostics.some(item=>item.visiblePinnedRowsStage?.stage==='sidebar_not_found'));
});

test('manual pinned rows diagnostic returns a partial result when rows never appear',async()=>{
 const dom=stagedPreflightDocument({readyState:'complete',sidebar:true,list:false}),x=setup(dom.document);const started=Date.now();
 const result=await x.window.gptInspectVisiblePinnedRows({hardTimeoutMs:10000,sidebarDiagnosticRunID:'manual-no-rows'});
 assert.equal(result.sidebarDiagnosticSummary.result,'failure');assert.equal(result.sidebarDiagnosticSummary.detectedRowCount,0);assert.ok(Date.now()-started<8500);
 assert.ok(x.diagnostics.some(item=>item.visiblePinnedRowsStage?.stage==='document_ready'));
});

test('row scan exception returns partial failure with sanitized category and route-template scan completes with no data',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']]),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 const original=x.window.webkit.messageHandlers.starredDiagnostic.postMessage;
 x.window.webkit.messageHandlers.starredDiagnostic.postMessage=payload=>{original(payload);if(payload.visiblePinnedRowsStage?.stage==='row_scan_started')dom.nav.querySelectorAll=()=>{throw new TypeError('PRIVATE DOM DETAIL');};};
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:13,hardTimeoutMs:10000,sidebarDiagnosticRunID:'manual-route-error'});
 assert.equal(result.sidebarDiagnosticSummary.result,'failure');assert.equal(result.sidebarDiagnosticSummary.exceptionCategory,'TypeError');
 const safe=JSON.stringify(result.sidebarDiagnosticSummary);assert.equal(safe.includes('PRIVATE DOM DETAIL'),false);
 assert.ok(x.diagnostics.some(item=>item.visiblePinnedRowsStage?.stage==='row_scan_finished'&&item.visiblePinnedRowsStage.exceptionCategory==='TypeError'));
 assert.ok(x.diagnostics.some(item=>item.visiblePinnedRowsStage?.stage==='route_template_scan_finished'));
 assert.equal(result.sidebarDiagnosticSummary.recognizedRouteTemplateCount,0);
});

test('manual diagnostic stage wrapper bounds a never-resolving stage before external safety timeout',async()=>{
 const dom=stagedPreflightDocument({readyState:'complete',sidebar:true,list:false}),x=setup(dom.document);const started=Date.now();
 const outcome=await x.window.gptBoundedDiagnosticAwait('route_template_scan',()=>new Promise(()=>{}),75);
 assert.equal(outcome.status,'timeout');assert.equal(outcome.reason,'stage_timeout:route_template_scan');assert.ok(Date.now()-started<400);
});

test('v5.7 isolated activity probe preserves the exact captured frontend route',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']]);
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 x.window.gptPinnedActivityDiagnosticToken='native-only-token';
 x.window.gptResolvePinnedRecords=ids=>ids.map(conversationId=>({conversationId,lastActivityAt:1700000000000,activitySource:'conversation_update_time'}));
 const rejected=await x.window.gptInspectVisiblePinnedRows({maxRows:2,includePinnedRecords:true,activityDiagnosticToken:'wrong-token'});
 assert.equal(rejected.pinnedRecords,undefined);
 const accepted=await x.window.gptInspectVisiblePinnedRows({maxRows:2,includePinnedRecords:true,activityDiagnosticToken:'native-only-token'});
 assert.equal(accepted.pinnedPrefixStatus,'pinned_prefix_complete',JSON.stringify(accepted));assert.equal(accepted.pinnedCount,1,JSON.stringify(accepted));assert.equal(accepted.timestampStage,'started');
 assert.equal(accepted.timestampDispatch.evaluated,true);assert.equal(accepted.timestampDispatch.allowed,true);assert.equal(accepted.timestampDispatch.reason,'none');assert.equal(accepted.timestampDispatch.itemsExpected,1);
 assert.deepEqual(Array.from(accepted.pinnedRecords,record=>record.conversationId),['private-chat-1']);assert.equal(accepted.pinnedRecords[0].activitySource,'conversation_update_time');assert.equal(accepted.pinnedRecords[0].frontendRoute,'/c/private-chat-1');
 const userFacing=JSON.stringify({version:accepted.version,pinnedPrefixStatus:accepted.pinnedPrefixStatus,pinnedCount:accepted.pinnedCount,timestampStage:accepted.timestampStage,rows:accepted.rows.map(({row,status,reason})=>({row,status,reason}))});
 assert.equal(userFacing.includes('private-chat-1'),false);assert.equal(userFacing.includes('PRIVATE CHAT TITLE'),false);assert.equal(dom.actionClicks,0);assert.equal(dom.activeMenu,null);
});

test('v5.7 preserves a captured /g/project/c/conversation route without synthesizing /c/id',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{conversationRoutes:['/g/private-project/c/private-chat-1','/c/private-chat-2']});
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;x.window.gptPinnedActivityDiagnosticToken='token';
 x.window.gptResolvePinnedRecords=ids=>ids.map(conversationId=>({conversationId,lastActivityAt:1700000000000,activitySource:'conversation_update_time'}));
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:2,includePinnedRecords:true,activityDiagnosticToken:'token'});
 assert.equal(result.pinnedPrefixStatus,'pinned_prefix_complete');assert.equal(result.pinnedRecords[0].frontendRoute,'/g/private-project/c/private-chat-1');
 const safe=JSON.stringify({status:result.pinnedPrefixStatus,rows:result.rows.map(({row,status})=>({row,status}))});
 assert.equal(safe.includes('private-chat'),false);assert.equal(safe.includes('private-project'),false);
});

test('v5.1 timestamp resolution starts only for complete prefix and consumes the same scan IDs',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']]);const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 x.window.gptPinnedActivityDiagnosticToken='native-only-token';let resolverCalls=[];
 x.window.gptResolvePinnedRecords=ids=>{resolverCalls.push(...ids);return ids.map(conversationId=>({conversationId,lastActivityAt:1700000000000,activitySource:'conversation_update_time'}));};
 const complete=await x.window.gptInspectVisiblePinnedRows({maxRows:2,includePinnedRecords:true,activityDiagnosticToken:'native-only-token'});
 assert.equal(complete.pinnedPrefixStatus,'pinned_prefix_complete');assert.equal(complete.timestampStage,'started');assert.equal(complete.timestampDispatch.allowed,true);assert.equal(complete.timestampDispatch.itemsExpected,1);assert.deepEqual(resolverCalls,['private-chat-1']);
 assert.deepEqual(Array.from(complete.pinnedRecords,record=>record.conversationId),['private-chat-1']);
 assert.equal(dom.openCount,2,'one prefix traversal only');assert.equal(dom.actionClicks,0);assert.equal(dom.activeMenu,null);
 const incompleteDOM=visiblePinnedRowsDocument([['Unpin chat']]);const y=setup(incompleteDOM.document);y.window.innerWidth=1024;y.window.innerHeight=768;
 y.window.gptPinnedActivityDiagnosticToken='native-only-token';let incompleteCalls=0;y.window.gptResolvePinnedRecords=()=>{incompleteCalls++;return [];};
 const incomplete=await y.window.gptInspectVisiblePinnedRows({maxRows:1,includePinnedRecords:true,activityDiagnosticToken:'native-only-token'});
 assert.equal(incomplete.pinnedPrefixStatus,'pinned_prefix_unproven');assert.equal(incomplete.timestampStage,'skipped_prefix_incomplete');assert.equal(incomplete.timestampDispatch.evaluated,true);assert.equal(incomplete.timestampDispatch.allowed,false);assert.equal(incomplete.timestampDispatch.reason,'prefix_incomplete');assert.equal(incomplete.timestampDispatch.itemsExpected,0);assert.equal(incompleteCalls,0);assert.equal(incompleteDOM.openCount,1);
});
test('complete prefix creates one dispatch item per pinned chat and emits each dispatch stage before returning',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Unpin chat'],['Pin chat']]),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;x.window.gptPinnedActivityDiagnosticToken='dispatch-token';
 x.window.gptResolvePinnedRecords=ids=>ids.map(conversationId=>({conversationId,lastActivityAt:1700000000000,activitySource:'conversation_update_time'}));
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:3,includePinnedRecords:true,activityDiagnosticToken:'dispatch-token'});
 assert.equal(result.pinnedPrefixStatus,'pinned_prefix_complete');assert.equal(result.pinnedCount,2);assert.equal(result.timestampDispatch.allowed,true);assert.equal(result.timestampDispatch.itemsExpected,2);assert.equal(result.pinnedRecords.length,2);
 const stages=x.diagnostics.map(message=>message.pinnedActivityProgress?.stage).filter(Boolean);
 for(const stage of ['prefix_completed','timestamp_dispatch_evaluated','timestamp_dispatch_allowed'])assert.ok(stages.includes(stage),`missing ${stage}`);
 assert.equal(stages.includes('timestamp_started'),false);
});

test('v3.9 stops on cleanup failure and never processes the following row',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{escapeCloses:false});const x=setup(dom.document,timer,()=>time);
 x.window.innerWidth=1024;x.window.innerHeight=768;x.window.gptSummarizePinnedLinkSources=()=>null;
 const result=await x.window.gptInspectVisiblePinnedRows();assert.equal(result.rowsAttempted,1);assert.equal(result.rowsCompleted,0);assert.equal(result.menuLeftOpen,true);
 assert.equal(result.stopReason,'cleanup_failed');assert.equal(result.pinnedPrefixReason,'cleanup_failed');assert.equal(dom.openCount,1);assert.equal(dom.actionClicks,0);
});

test('scrollable sidebar is brought to top before inspecting the prefix',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};const dom=visiblePinnedRowsDocument([['Unpin chat']],{scrollTop:150});const x=setup(dom.document,timer,()=>time);
 x.window.innerWidth=1024;x.window.innerHeight=768;x.window.gptSummarizePinnedLinkSources=()=>null;
 const result=await x.window.gptInspectVisiblePinnedRows();assert.equal(result.sidebarTop.atTop,false);assert.equal(result.sidebarTop.proof,'top_unproven');assert.equal(dom.nav.scrollTop,150);assert.equal(result.rowsAttempted,0);assert.equal(result.stopReason,'top_unproven');assert.equal(dom.openCount,0);
});

test('pinned-prefix helper detects a pinned row after ordinary rows and unknown gaps',()=>{
 const x=setup();assert.equal(x.window.gptSummarizePinnedPrefix(['pinned','pinned','not pinned']).contiguousPinnedPrefix,'yes');
 assert.equal(x.window.gptSummarizePinnedPrefix(['pinned','not pinned','pinned']).contiguousPinnedPrefix,'no');
 assert.equal(x.window.gptSummarizePinnedPrefix(['pinned','unknown','not pinned']).contiguousPinnedPrefix,'unknown');
});

function firstRowMenuDocument({semantic=true,openOnClick=true,openOnPointerdown=false,escapeCloses=true,portal=true,extraVisibleAnchor=false,extraRowControl=false,extraConversationLink=false,actionLabels=['Pin conversation','Rename conversation','Archive conversation']}={}){
 let menuOpen=false,clicks=0,actionClicks=0,escapeCount=0;const eventLog=[];
 const actions=actionLabels.map(label=>({tagName:'BUTTON',textContent:label,innerText:label,getAttribute:name=>name==='role'?'menuitem':null,getClientRects:()=>menuOpen?[{}]:[],querySelector:()=>null,querySelectorAll:()=>[],click(){actionClicks++;}}));
 const menu={tagName:'DIV',nodeType:1,textContent:'SENSITIVE DOM TEXT MUST NOT ESCAPE',getAttribute:name=>name==='role'?'menu':name==='data-state'?'open':null,hasAttribute:name=>(name==='data-radix-popper-content-wrapper'&&portal)||name==='data-radix-menu-content',getClientRects:()=>menuOpen?[{}]:[],querySelector:s=>s.includes('menuitem')?actions[0]:null,querySelectorAll:s=>s.includes('menuitem')?actions:[],contains:()=>false};
 const trigger={tagName:'BUTTON',className:semantic?'conversation-actions':'plain-control',textContent:'',disabled:false,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:22,y:31,width:20,height:20}),getAttribute:name=>({role:'button','aria-label':semantic?'Chat actions':null,'aria-haspopup':semantic?'menu':null,'data-testid':semantic?'conversation-item-menu-button':null,'title':null,'aria-expanded':menuOpen?'true':'false','data-state':menuOpen?'open':'closed','aria-controls':'chat-menu'}[name]??null),hasAttribute:()=>false,querySelector:s=>s==='svg'?{}:null,querySelectorAll:()=>[],dispatchEvent(event){eventLog.push({type:event.type,bubbles:event.bubbles,cancelable:event.cancelable,pointerType:event.pointerType,isPrimary:event.isPrimary,button:event.button,buttons:event.buttons});if(event.type==='pointerdown'&&openOnPointerdown)menuOpen=true;if(event.type==='click'&&openOnClick)menuOpen=true;if((event.type==='pointerdown'&&openOnPointerdown)||(event.type==='click'&&openOnClick))document.__notifyMutation([{type:'childList',addedNodes:[menu]},{type:'attributes',attributeName:'aria-expanded',addedNodes:[]}]);return true;},click(){clicks++;}};
 const anchor={tagName:'A',parentElement:null,hidden:false,textContent:'SENSITIVE CHAT TITLE',getAttribute:name=>name==='href'?'/c/sensitive-conversation-id':null,getClientRects:()=>[{}],querySelectorAll:()=>[],closest:s=>s==='[data-thread-title-trigger]'?wrapper:null};
 const secondAnchor=extraConversationLink?{tagName:'A',parentElement:null,hidden:false,textContent:'ANOTHER PRIVATE TITLE',getAttribute:name=>name==='href'?'/g/project/c/second-private-id':null,getClientRects:()=>[{}],querySelectorAll:()=>[],closest:()=>null}:null;
 const otherAnchor=extraVisibleAnchor?{tagName:'A',parentElement:null,hidden:false,getAttribute:name=>name==='href'?'/mystery/private-project-id':null,getClientRects:()=>[{}],querySelectorAll:()=>[],closest:()=>null}:null;
 const generic={tagName:'BUTTON',className:'plain-control',textContent:'',getClientRects:()=>[{}],getBoundingClientRect:()=>({x:48,y:31,width:20,height:20}),getAttribute:name=>name==='role'?'button':name==='aria-haspopup'&&extraRowControl?'menu':null,querySelector:()=>null,querySelectorAll:()=>[],click(){clicks++;}};
 const wrapper={tagName:'DIV',attributes:[{name:'data-thread-title-trigger'}],parentElement:null,textContent:'SENSITIVE CHAT TITLE',getAttribute:name=>name==='data-thread-title-trigger'?'':null,getClientRects:()=>[{}],contains:el=>el===anchor,querySelectorAll:s=>s==='a[href]'||s==='a[href*="/c/"]'?[anchor]:[]};anchor.parentElement=wrapper;
 const row={tagName:'DIV',className:'conversation-row',attributes:[{name:'data-testid'}],parentElement:null,textContent:'',getAttribute:name=>name==='role'?'listitem':null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:24,width:280,height:36}),contains:el=>el===wrapper||el===anchor||el===secondAnchor||el===trigger||el===generic,querySelectorAll:s=>s==='a[href]'||s==='a[href*="/c/"]'?(extraConversationLink?[anchor,secondAnchor]:[anchor]):s==='button[aria-haspopup="menu"]'?(semantic?(extraRowControl?[trigger,generic]:[trigger]):[]):s==='button,[role="button"]'?(extraRowControl?[trigger,generic]:[trigger]):[]};wrapper.parentElement=row;trigger.parentElement=row;generic.parentElement=row;if(secondAnchor)secondAnchor.parentElement=row;
 const nav={hidden:false,getAttribute:()=>null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:300,bottom:700,width:300,height:700}),contains:el=>el===row||el===wrapper||el===anchor||el===secondAnchor||el===trigger||el===generic||el===otherAnchor,querySelectorAll:s=>s==='a[href*="/c/"]'?(extraConversationLink?[anchor,secondAnchor]:[anchor]):s==='a[href]'?(extraVisibleAnchor?[otherAnchor,anchor,...(secondAnchor?[secondAnchor]:[])]:[anchor,...(secondAnchor?[secondAnchor]:[])]):[]};row.parentElement=nav;
 const document={body:{},activeElement:null,getElementById:()=>null,dispatchEvent:event=>{if(event.key==='Escape'){escapeCount++;if(escapeCloses)menuOpen=false;}},querySelectorAll:s=>s==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[nav]:s==='a[href]'?(otherAnchor?[otherAnchor,anchor]:[anchor]):s==='[role="menu"],[role^="menuitem"]'?(menuOpen?[menu,...actions]:[]):s==='[popover],[data-radix-popper-content-wrapper],[data-radix-menu-content],[data-state="open"]'?(menuOpen?[menu]:[]):s.includes('[role="menu"]')||s.includes('[role="menuitem"]')||s.includes('[role="dialog"]')||s.includes('[role="listbox"]')||s.includes('[popover]')||s.includes('[data-radix-popper-content-wrapper]')||s.includes('[data-radix-menu-content]')||s.includes('[data-state="open"]')?(menuOpen?[menu]:[]):[]};
 return {document,row,wrapper,trigger,menu,get clicks(){return clicks;},get eventLog(){return eventLog;},get actionClicks(){return actionClicks;},get escapeCount(){return escapeCount;},get menuOpen(){return menuOpen;}};
}

test('semantic first-row pointer event sequence opens a global portal and classifies Pin without selecting any action',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};const dom=firstRowMenuDocument({actionLabels:['Pin conversation','Rename conversation','Archive conversation']});const x=setup(dom.document,timer,()=>time);
 const result=await x.window.gptInspectFirstRowMenuTrigger();
 assert.equal(result.version,'5.31.0');assert.equal(result.rowFound,true);assert.equal(result.ancestorLevelsChecked,2);assert.equal(result.ancestorSummary[0].conversationLinks,1);assert.equal(result.ancestorSummary[0].menuButtons,0);assert.equal(result.rowContainer.conversationLinks,1);assert.equal(result.rowContainer.menuButtons,1);assert.equal(result.triggerFound,true);assert.equal(result.triggerCount,1);assert.equal(dom.clicks,0);
 assert.deepEqual(dom.eventLog.map(e=>e.type),['pointerdown','mousedown','pointerup','mouseup','click']);assert.equal(dom.eventLog[0].pointerType,'mouse');assert.equal(dom.eventLog[0].isPrimary,true);assert.ok(dom.eventLog.every(e=>e.bubbles&&e.cancelable&&e.button===0));
 assert.equal(result.trigger.ariaHaspopup,'menu');assert.equal(result.trigger.width,20);assert.equal(result.trigger.height,20);assert.equal(result.trigger.insideRow,true);assert.equal(result.trigger.nearRow,true);
 assert.equal(result.menuFound,true);assert.equal(result.menuLocation,'portal');assert.equal(result.menu.containerType,'portal_popover');
 assert.equal(result.menu.actionCount,3);assert.equal(result.menu.pinActionPresent,true);assert.equal(result.menu.unpinActionPresent,false);assert.equal(result.menu.otherActionsCount,2);assert.equal(result.rowStatus,'not pinned');
 assert.equal(result.menuClosed,true);assert.equal(result.menuLeftOpen,false);assert.equal(result.cleanupSuccessful,true);assert.equal(dom.menuOpen,false);assert.equal(dom.actionClicks,0);
 assert.equal(dom.escapeCount,1);
 assert.equal(result.triggerStateBefore.ariaExpanded,'false');assert.equal(result.triggerStateAfterPointerdown.ariaExpanded,'false');assert.equal(result.triggerStateAfterSequence.ariaExpanded,'true');
 assert.equal(result.baselineCounts.menus,0);assert.equal(result.afterPointerdownCounts.menus,0);assert.equal(result.afterSequenceCounts.menus,1);
 assert.ok(result.mutations.menuLikeNodesAdded>0);assert.ok(result.mutations.menuLikeAttributesChanged>0);
 assert.ok(!JSON.stringify(result).includes('SENSITIVE'));assert.ok(!JSON.stringify(result).includes('conversation-id'));assert.ok(!JSON.stringify(result).includes('textContent'));
});

test('pointerdown state is captured separately when it opens the menu',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};const dom=firstRowMenuDocument({openOnClick:false,openOnPointerdown:true,actionLabels:['Unpin conversation']});const x=setup(dom.document,timer,()=>time);
 const result=await x.window.gptInspectFirstRowMenuTrigger();assert.equal(result.triggerStateAfterPointerdown.ariaExpanded,'true');assert.equal(result.afterPointerdownCounts.menus,1);assert.equal(result.rowStatus,'pinned');assert.deepEqual(dom.eventLog.map(e=>e.type),['pointerdown','mousedown','pointerup','mouseup','click']);assert.equal(dom.actionClicks,0);assert.equal(result.cleanupSuccessful,true);
});

test('ambiguous semantic menu buttons are never clicked',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};const dom=firstRowMenuDocument({extraRowControl:true});const x=setup(dom.document,timer,()=>time);
 const result=await x.window.gptInspectFirstRowMenuTrigger();
 assert.equal(result.triggerFound,false);assert.equal(result.triggerCount,0);assert.equal(result.reason,'ambiguous_ancestor_counts');assert.equal(dom.clicks,0);
});

test('ancestor with multiple conversation links is rejected without clicking',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};const dom=firstRowMenuDocument({extraConversationLink:true});const x=setup(dom.document,timer,()=>time);
 const result=await x.window.gptInspectFirstRowMenuTrigger();
 assert.equal(result.rowFound,false);assert.equal(result.reason,'ambiguous_ancestor_counts');assert.equal(result.ancestorSummary.at(-1).conversationLinks,2);assert.equal(dom.clicks,0);
});

test('menu classification distinguishes Unpin, both, and neither; Pin and Unpin actions are never clicked',async()=>{
 for(const [labels,expected] of [[['Unpin conversation'],'pinned'],[['Pin conversation','Unpin conversation'],'unknown'],[['Rename conversation'],'unknown']]){
  let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};const dom=firstRowMenuDocument({actionLabels:labels});const x=setup(dom.document,timer,()=>time);
  const result=await x.window.gptInspectFirstRowMenuTrigger();assert.equal(result.rowStatus,expected);assert.equal(dom.actionClicks,0);assert.equal(result.cleanupSuccessful,true);
 }
});

test('missing menu remains bounded and finally cleanup reports an unclosed menu safely',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};const dom=firstRowMenuDocument({openOnClick:false,escapeCloses:false});const x=setup(dom.document,timer,()=>time);
 const result=await x.window.gptInspectFirstRowMenuTrigger();
 assert.equal(dom.clicks,0);assert.equal(dom.eventLog.length,5);assert.equal(result.menuFound,false);assert.equal(result.menuOpened,false);assert.equal(result.menuClosed,true);assert.equal(result.menuLeftOpen,false);assert.ok(result.elapsedMs<=9500);
 assert.equal(dom.escapeCount,1);
});

test('first-row menu diagnostic uses one DOM pointer/mouse sequence and no native hover workflow',()=>{
 const source=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');
 const start=source.indexOf('window.gptInspectFirstRowMenuTrigger=async()=>{');
 const diagnostic=source.slice(start,source.indexOf('const findSidebarScroller=',start));
 assert.match(diagnostic,/button\[aria-haspopup="menu"\]/);assert.match(diagnostic,/dispatch\(trigger,'pointerdown',true,1\)/);assert.match(diagnostic,/triggerStateAfterPointerdown=state\(trigger\)/);assert.match(diagnostic,/new MutationObserver\(collectMutations\)/);assert.match(diagnostic,/finally\{/);assert.match(diagnostic,/sendEscape\(\)/);
 assert.doesNotMatch(diagnostic,/trigger\.click\(\)/);assert.doesNotMatch(diagnostic,/textContent|innerText/);
 assert.doesNotMatch(diagnostic,/dispatchRowHover|matches\?\.\(':hover'\)|CGEvent|gptPrepareNativeHover/);
});

function structuralRowDocument(){
 let hovered=false,clicks=0;
 const make=(tag,attrs={},rect={x:0,y:0,width:100,height:40})=>{
  const node={tagName:tag.toUpperCase(),attributes:Object.entries(attrs).map(([name,value])=>({name,value:String(value)})),children:[],parentElement:null,
   getAttribute(name){return Object.prototype.hasOwnProperty.call(attrs,name)?String(attrs[name]):null;},hasAttribute(name){return Object.prototype.hasOwnProperty.call(attrs,name);},
   getBoundingClientRect(){return rect;},getClientRects(){return [{}];},
   querySelectorAll(selector){const result=[];const selectors=selector.split(',').map(x=>x.trim());const matches=(item,s)=>{
    const role=item.getAttribute?.('role'),tagName=item.tagName.toLowerCase();
    if(s==='*')return true;if(s==='button')return tagName==='button';if(s==='[role="button"]')return role==='button';
    if(s==='[aria-haspopup]')return item.hasAttribute('aria-haspopup');if(s==='[data-state]')return item.hasAttribute('data-state');
    if(s==='[popover]')return item.hasAttribute('popover');if(s==='a[href]')return tagName==='a'&&item.hasAttribute('href');
    if(s==='a[href*="/c/"]')return tagName==='a'&&(item.getAttribute('href')||'').includes('/c/');return false;
   };const visit=parent=>{for(const child of parent.children){if(selectors.some(s=>matches(child,s)))result.push(child);visit(child);}};visit(this);return result;},
   querySelector(selector){return this.querySelectorAll(selector)[0]||null;},contains(target){return target===this||this.querySelectorAll('*').includes(target);},
   closest(selector){let node=this;while(node){if(selector==='[data-thread-title-trigger]'&&node.hasAttribute?.('data-thread-title-trigger'))return node;node=node.parentElement;}return null;},
   dispatchEvent(event){if(this===row&&['pointerover','mouseover','pointerenter','mouseenter','pointermove','mousemove'].includes(event.type))hovered=true;return true;},
   matches(selector){return selector===':hover'&&hovered&&(this===row||this===titleWrapper||this===anchor);},
   click(){clicks++;},
  };return node;
 };
 const nav=make('nav',{}, {x:0,y:0,width:280,height:700});
 const row=make('div',{role:'listitem','data-testid':'conversation-row'},{x:0,y:80,width:260,height:48});
 const titleWrapper=make('div',{'data-thread-title-trigger':''},{x:8,y:80,width:190,height:48});
 const anchor=make('a',{href:'/c/private-conversation-id'},{x:12,y:88,width:160,height:32});
 const actions=make('div',{}, {x:198,y:80,width:54,height:48});
 const button=make('button',{'aria-label':'Chat actions','aria-haspopup':'menu','data-testid':'conversation-item-menu-button'},{x:222,y:90,width:24,height:24});
 button.querySelector=selector=>selector==='svg'?make('svg'):null;
 button.click=()=>{clicks++;};
 const section=make('div',{}, {x:0,y:0,width:280,height:580});
 const list=make('div',{}, {x:0,y:40,width:280,height:520});
 nav.children=[section];section.parentElement=nav;section.children=[list];list.parentElement=section;list.children=[row];row.parentElement=list;
 row.children=[titleWrapper,actions];titleWrapper.parentElement=row;actions.parentElement=row;titleWrapper.children=[anchor];anchor.parentElement=titleWrapper;actions.children=[button];button.parentElement=actions;
 const document={querySelectorAll:selector=>selector==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[nav]:[],elementFromPoint:()=>row,body:{}};
 const styleFor=el=>({display:'block',visibility:'visible',opacity:el===button&&!hovered?'0':'1',pointerEvents:el===button&&!hovered?'none':'auto'});
 return {document,nav,row,titleWrapper,anchor,button,get hovered(){return hovered;},get clicks(){return clicks;},styleFor,setNativeHover(){hovered=true;}};
}

test('structural diagnostic finds row-level controls beside data-thread-title-trigger and records opacity transition without clicks',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};const dom=structuralRowDocument();const x=setup(dom.document,timer,()=>time,dom.styleFor);
 const result=await x.window.gptInspectFirstRowStructure();
 assert.equal(result.version,'5.31.0');assert.equal(result.linkFound,true);assert.equal(result.selectedRowLevel,2);
 assert.equal(result.ancestorChain.length,4);assert.equal(result.rowCandidates.length>=2,true);
 assert.equal(result.ancestorChain[0].dataAttributeNames.includes('data-thread-title-trigger'),true);
 assert.equal(result.ancestorChain[0].siblingButtons,1);assert.equal(result.rowCandidates[0].descendantButtons,1);
 const before=result.controlsBeforeHover.find(control=>control.tag==='button');const after=result.controlsAfterHover.find(control=>control.tag==='button');
 assert.equal(before.style.opacity,'0');assert.equal(before.style.pointerEvents,'none');assert.equal(before.source,'row_descendant');
 assert.equal(after.style.opacity,'1');assert.equal(after.style.pointerEvents,'auto');assert.equal(result.hoverChanges[0].styleChanged,true);
 assert.equal(result.newDomControlCount,0);assert.equal(result.clicksPerformed,0);assert.equal(dom.clicks,0);
 const serialized=JSON.stringify(result);for(const secret of ['private-conversation-id','/c/','href','SENSITIVE CHAT TITLE'])assert.equal(serialized.includes(secret),false);
});

test('structural diagnostic bounds ancestors, excludes sidebar-sized roots and never invokes clicks',async()=>{
 let time=0;const timer=(fn,ms)=>{time+=ms;queueMicrotask(fn);return 1;};const dom=structuralRowDocument();const x=setup(dom.document,timer,()=>time,dom.styleFor);
 const result=await x.window.gptInspectFirstRowStructure();
 assert.ok(result.ancestorChain.length<=6);assert.ok(result.rowCandidates.every(candidate=>candidate.rowRelativeHeightPercent<28));
 const source=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');const diagnostic=source.slice(source.indexOf('window.gptInspectFirstRowStructure=async()=>{'),source.indexOf('window.gptInspectFirstRowMenuTrigger=async()=>{'));
 assert.doesNotMatch(diagnostic,/\.click\s*\(/);assert.ok(result.elapsedMs<=9000);
});

test('sidebar toggle uses semantic label and verifies one click changes visibility',async()=>{
 let visible=false,clicks=0;const nav={getClientRects:()=>visible?[{}]:[],getBoundingClientRect:()=>({x:0,y:0,width:250,height:700}),querySelectorAll:()=>[],contains:()=>false};
 const toggle={tagName:'BUTTON',getAttribute:k=>({role:'button','aria-label':'Open navigation','aria-expanded':String(visible)}[k]??null),click(){clicks++;visible=true;}};
 const document={getElementById:()=>null,querySelectorAll:s=>s==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[nav]:s.includes('button')||s.includes('[aria-expanded]')?[toggle]:[]};
 const immediate=fn=>{queueMicrotask(fn);return 1;},x=setup(document,immediate);
 const result=await x.window.gptRunStarredTriggerDiagnostic();
 assert.equal(clicks,1);assert.equal(result.sidebar.before.visible,false);assert.equal(result.sidebar.after.visible,true);
 assert.equal(result.sidebar.toggle.status,'unique');assert.equal(result.sidebar.toggle.stateChanged,true);
});

test('starred search stays inside sidebar and ambiguous controls are never clicked',async()=>{
 const inside=starredDocument({}),outside=starredDocument({});
 const outsideControl=outside.disclosure;
 const root=inside.nav, originalQuery=root.querySelectorAll;
 root.querySelectorAll=s=>s==='a[href*="/c/"]'?inside.links:s.includes('button')||s.includes('[aria-expanded]')?[inside.disclosure]:[];
 // A matching disclosure outside nav is intentionally invisible to the scoped search.
 const document={body:inside.document.body,getElementById:inside.document.getElementById,
  querySelectorAll:s=>s==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[root]:s==='[aria-expanded]'?[inside.disclosure,outsideControl]:[]};
 const x=setup(document);assert.equal(x.window.gptInspectStarredControl(root).controlFound,true);
 assert.equal(outside.clicks,0);assert.equal(originalQuery===root.querySelectorAll,false);
});

test('ambiguous starred disclosure candidates are reported but never clicked',async()=>{
 const dom=starredDocument({}),first=dom.disclosure;let secondClicks=0,secondExpanded=false;
 const second={tagName:'BUTTON',getAttribute:k=>({role:'button','aria-label':'Starred','aria-expanded':String(secondExpanded),'aria-controls':'starred-list-2'}[k]??null),
  parentElement:{children:[]},closest:s=>s.includes('nav')?dom.nav:null,click(){secondClicks++;secondExpanded=!secondExpanded;}};
 const secondList={getClientRects:()=>[{}],getAttribute:()=> 'list',querySelectorAll:()=>[]};second.parentElement.children=[second,secondList];
 const getById=id=>id==='starred-list'?dom.list:id==='starred-list-2'?secondList:null;
 const original=dom.nav.querySelectorAll;dom.nav.querySelectorAll=s=>s==='a[href*="/c/"]'?dom.links:[first,second];
 dom.document.getElementById=getById;
 const immediate=fn=>{queueMicrotask(fn);return 1;},x=setup(dom.document,immediate);
 const result=await x.window.gptRunStarredTriggerDiagnostic();
 assert.equal(dom.clicks,0);assert.equal(secondClicks,0);assert.equal(result.before.reason,'ambiguous');
 assert.equal(result.before.candidateCount,2);assert.equal(result.before.candidates.length,2);
 assert.ok(!JSON.stringify(result).includes('href'));assert.ok(!JSON.stringify(result).includes('private'));
 assert.equal(typeof original,'function');
});

test('pinned region supports flat siblings, external ARIA target and safe conversation/project classification',async()=>{
 let clicks=0;const mk=(tag,attrs={},children=[])=>({tagName:tag,className:'',hidden:false,children,parentElement:null,attributes:Object.entries(attrs).map(([name])=>({name})),
  getAttribute:k=>attrs[k]??null,getClientRects:()=>[{}],querySelectorAll:selector=>selector==='a[href],button,[role="button"],section,ul,ol,[role="group"],[role="list"],[role="tree"]'?children.flatMap(c=>[c,...(c.children||[])]).filter(c=>selector.includes(String(c.tagName||'').toLowerCase())||String(c.tagName||'').toLowerCase()==='a'):[],contains:n=>children.includes(n)||children.some(c=>c===n||c.contains?.(n))});
 const conv=mk('A',{href:'/g/workspace/c/private-conversation-id'}),project=mk('A',{href:'/g/private-project-id'}),boundary=mk('H2',{role:'heading'});
 Object.defineProperty(conv,'textContent',{get(){throw Error('anchor text must not be read')}});Object.defineProperty(project,'textContent',{get(){throw Error('anchor text must not be read')}});
 const external=mk('DIV',{role:'list'});
 const candidate=mk('BUTTON',{'aria-label':'Pinned','aria-expanded':'false','aria-controls':'external-list','aria-labelledby':'marker','aria-owns':'external-list','data-testid':'pinned-trigger'});candidate.click=()=>{clicks++;};
 const parent=mk('DIV',{role:'group'},[candidate,conv,project,boundary]);for(const child of parent.children)child.parentElement=parent;
 const nav=mk('NAV',{},[parent]);nav.parentElement=null;nav.getBoundingClientRect=()=>({x:0,y:0,width:320,height:700});nav.contains=n=>n===parent||n===candidate||n===conv||n===project||n===boundary;
 nav.querySelectorAll=selector=>selector==='a[href*="/c/"],a[href*="/g/"]'?[conv,project]:selector==='button,[role="button"],[aria-expanded]'?[candidate]:selector==='a[href*="/c/"]'?[conv]:[];
 const doc={getElementById:id=>id==='external-list'?external:null,querySelectorAll:selector=>selector==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[nav]:selector==='button,[role="button"],[aria-expanded]'?[candidate]:[]};
 const x=setup(doc);x.window.gptSummarizePinnedLinkSources=ids=>({baseSourceAvailable:true,starredTrueSourceAvailable:false,starredTrueOverlapCount:0,baseOverlapCount:0,pinnedLinkCount:ids.length,networkMatchedCount:0,updatedAtCount:0,recentCount:0,sources:[],observedStreams:[]});
 const d=await x.window.gptRunPinnedSidebarDiagnostic(),s=d.structure;
 assert.equal(clicks,0);assert.equal(s.candidateFound,true);assert.equal(s.region.found,true);assert.equal(s.region.nonNested,true);
 assert.equal(s.region.counts.conversationLinks,1);assert.equal(s.region.counts.projectLinks,1);assert.equal(s.region.counts.unknownLinks,0);
 assert.equal(s.relationships.ariaControls.targetFound,true);assert.deepEqual(Array.from(s.relationships.ariaControls.targetRoles),['list']);
 assert.equal(s.relationships.ariaLabelledby.targetFound,false);assert.equal(s.relationships.ariaOwns.targetFound,true);
 const encoded=JSON.stringify(d);for(const secret of ['private-conversation-id','private-project-id','external-list','pinned-trigger','href'])assert.equal(encoded.includes(secret),false);
});

test('missing pinned child container does not prove the pinned section is absent',async()=>{
 const candidate={tagName:'BUTTON',attributes:[],getAttribute:k=>({'aria-label':'Pinned','aria-expanded':'false'}[k]??null),getClientRects:()=>[{}],click(){throw Error('must not click')}};
 const nav={tagName:'NAV',attributes:[],hidden:false,getAttribute:()=>null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:300,bottom:700,width:300,height:700}),contains:n=>n===candidate,
  querySelectorAll:s=>s==='button,[role="button"],[aria-expanded]'?[candidate]:[]};
 const doc={querySelectorAll:s=>s==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[nav]:s==='button,[role="button"],[aria-expanded]'?[candidate]:[],getElementById:()=>null};
 const x=setup(doc);x.window.gptSummarizePinnedLinkSources=()=>({baseSourceAvailable:false,starredTrueSourceAvailable:false,starredTrueOverlapCount:0,baseOverlapCount:0,networkMatchedCount:0,updatedAtCount:0,recentCount:0,sources:[],observedStreams:[]});
 const s=(await x.window.gptRunPinnedSidebarDiagnostic()).structure;assert.equal(s.candidateFound,true);assert.equal(s.region.found,false);assert.equal(s.pinnedGroupFound,true);assert.equal(s.fullness,'unproven');
});

test('non-scrollable list proves top without a scroll container and stops at first ordinary row',async()=>{
 let time=0;const dom=visiblePinnedRowsDocument([['Unpin chat'],['Unpin chat'],['Pin chat'],['Unpin chat']]);
 dom.nav.scrollHeight=600;dom.nav.contains=node=>dom.allLinks.includes(node)||dom.rows.some(r=>r.row===node);
 for(const r of dom.rows){r.row.clientHeight=36;r.row.scrollHeight=36;}
 const x=setup(dom.document,(f,ms)=>{time+=ms;queueMicrotask(f);},()=>time);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows();
 assert.equal(result.scrollContainerFound,false);assert.equal(result.sidebarTop.proof,'top_proven');
 assert.equal(result.pinnedStructureComplete,'complete');assert.equal(result.rowsAttempted,3);assert.equal(dom.openCount,3);assert.equal(dom.actionClicks,0);
 assert.ok(!JSON.stringify(result).includes('private-chat'));
});
test('first ordinary row proves an empty pinned prefix with zero pinned chats',async()=>{
 let time=0;const dom=visiblePinnedRowsDocument([['Pin chat'],['Unpin chat']]),x=setup(dom.document,(f,ms)=>{time+=ms;queueMicrotask(f);},()=>time);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows();assert.equal(result.pinnedPrefixStatus,'pinned_prefix_complete');assert.equal(result.pinnedCount,0);assert.equal(result.rowsInspected,1);assert.equal(result.firstNotPinnedFound,true);assert.equal(dom.openCount,1);assert.equal(dom.actionClicks,0);
});
test('a hidden conversation link before the visible first row is excluded from top proof',async()=>{
 let time=0;const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']]);dom.rows[0].anchor.hidden=true;const x=setup(dom.document,(f,ms)=>{time+=ms;queueMicrotask(f);},()=>time);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows();assert.equal(result.sidebarTop.proof,'top_proven');assert.equal(result.sidebarTop.inactiveRowsExcluded,1);assert.equal(result.sidebarTop.precedingGeometry.count,0);assert.equal(dom.openCount,0);
});
test('manual pinned-prefix output omits passive source, titles and IDs',async()=>{
 const dom=visiblePinnedRowsDocument([['Pin chat']]),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;let sourceCalls=0;x.window.gptSummarizePinnedLinkSources=()=>{sourceCalls++;return {updatedAtCount:9};};
 const result=await x.window.gptInspectVisiblePinnedRows();assert.equal(sourceCalls,0);assert.equal(result.source,null);const encoded=JSON.stringify(result);for(const secret of ['private-chat','PRIVATE MENU CONTENT','href','title','updatedAt'])assert.equal(encoded.includes(secret),false);
});
test('unknown inside prefix and all-pinned lists cannot prove completeness',async()=>{
 for(const labels of [[['Unpin chat'],['Rename'],['Pin chat']],[['Unpin chat'],['Unpin chat']]]){
  let time=0;const dom=visiblePinnedRowsDocument(labels),x=setup(dom.document,(f,ms)=>{time+=ms;queueMicrotask(f);},()=>time);
  x.window.innerWidth=1024;x.window.innerHeight=768;
  const result=await x.window.gptInspectVisiblePinnedRows();assert.equal(result.pinnedStructureComplete,'unproven');assert.equal(dom.actionClicks,0);assert.equal(dom.activeMenu,null);
 }
});
test('unrelated conversation 429 during an isolated prefix is reported but does not abort DOM classification',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']]),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 x.window.gptPinnedActivityDiagnosticToken='active-probe';x.window.gptRateLimitEvents=[];let sequence=0,emitted=false;
 x.window.gptSetRateLimitContext=(owner,generation,stage)=>{if(!emitted&&owner==='isolated_prefix_diagnostic'&&stage==='sidebar_readiness'){emitted=true;x.window.gptRateLimitEvents.push({sequence:++sequence,family:'conversation_messages',owner:'unrelated_passive_traffic',generation,status:429,occurredAtStage:stage});}};
 const result=await x.window.gptInspectVisiblePinnedRows({includePinnedRecords:true,activityDiagnosticToken:'active-probe'});
 assert.equal(dom.openCount,2);assert.equal(result.pinnedPrefixStatus,'pinned_prefix_complete');assert.equal(result.http429.observed,true);assert.equal(result.http429.family,'conversation_messages');assert.equal(result.http429.owner,'unrelated_passive_traffic');assert.equal(result.http429.relevant,false);
});
test('current-operation list 429 before universe proof aborts prefix with an exact reason',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']]),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 x.window.gptPinnedActivityDiagnosticToken='active-probe';x.window.gptRateLimitEvents=[];let sequence=0,emitted=false;
 x.window.gptSetRateLimitContext=(owner,generation,stage)=>{if(!emitted&&owner==='isolated_prefix_diagnostic'&&stage==='sidebar_readiness'){emitted=true;x.window.gptRateLimitEvents.push({sequence:++sequence,family:'root_conversation_list',owner,generation,status:429,occurredAtStage:stage});}};
 const result=await x.window.gptInspectVisiblePinnedRows({includePinnedRecords:true,activityDiagnosticToken:'active-probe'});
 assert.equal(dom.openCount,0);assert.equal(result.stopReason,'http_429_relevant');assert.equal(result.pinnedPrefixReason,'http_429_relevant');assert.equal(result.http429.relevant,true);
});
test('a previous operation 429 token does not leak into the next prefix operation',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']]),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 x.window.gptPinnedActivityDiagnosticToken='new-probe';x.window.gptRateLimitEvents=[{sequence:1,family:'root_conversation_list',owner:'isolated_prefix_diagnostic',generation:'old-probe',status:429,occurredAtStage:'prefix_classification'}];
 const result=await x.window.gptInspectVisiblePinnedRows({includePinnedRecords:true,activityDiagnosticToken:'new-probe'});
 assert.equal(dom.openCount,2);assert.equal(result.pinnedPrefixStatus,'pinned_prefix_complete');assert.equal(result.http429.observed,false);assert.equal(result.http429.relevant,false);
});
test('scheduler discovery 429 aborts the active prefix operation without opening a row menu',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']]),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 x.window.gptListCycleConfig={token:'cycle-current'};x.window.gptRateLimitEvents=[];let sequence=0,emitted=false;
 x.window.gptSetRateLimitContext=(owner,generation,stage)=>{if(!emitted&&owner==='scheduler_discovery'&&stage==='sidebar_readiness'){emitted=true;x.window.gptRateLimitEvents.push({sequence:++sequence,family:'project_conversation_list',owner,generation,status:429,occurredAtStage:stage});}};
 const result=await x.window.gptInspectVisiblePinnedRows({cycleToken:'cycle-current'});
 assert.equal(dom.openCount,0);assert.equal(result.stopReason,'http_429_relevant');assert.equal(result.http429.owner,'scheduler_discovery');assert.equal(result.http429.relevant,true);
});
test('unrelated 429 does not abort scheduler discovery prefix processing',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']]),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 x.window.gptListCycleConfig={token:'cycle-current'};x.window.gptRateLimitEvents=[];let sequence=0,emitted=false;
 x.window.gptSetRateLimitContext=(owner,generation,stage)=>{if(!emitted&&owner==='scheduler_discovery'&&stage==='sidebar_readiness'){emitted=true;x.window.gptRateLimitEvents.push({sequence:++sequence,family:'conversation_messages',owner:'unrelated_passive_traffic',generation,status:429,occurredAtStage:stage});}};
 const result=await x.window.gptInspectVisiblePinnedRows({cycleToken:'cycle-current'});
 assert.equal(dom.openCount,2);assert.equal(result.pinnedPrefixStatus,'pinned_prefix_complete');assert.equal(result.http429.relevant,false);
});

function topPositionDocument({scrollTop=0,scrollHeight=400,clientHeight=200,failScroll=false,virtualIndex=null,transformY=0,spacerBefore=false,predecessor=null,header=false,project=false,extraRows=0}={}){
 const mk=(tag,attrs={},r={x:0,y:0,width:300,height:36})=>({tagName:tag.toUpperCase(),hidden:false,attributes:Object.entries(attrs).map(([name,value])=>({name,value:String(value)})),parentElement:null,children:[],scrollTop:0,scrollHeight:0,clientHeight:0,
  getAttribute:k=>attrs[k]??null,getClientRects:()=>this.hidden?[]:[{}],getBoundingClientRect:()=>({x:r.x,y:r.y,width:r.width,height:r.height,top:r.y,bottom:r.y+r.height,left:r.x,right:r.x+r.width}),
  contains(n){return n===this||this.children.some(c=>c.contains?.(n));},querySelectorAll(sel){const all=[];const visit=n=>{for(const c of n.children){if(sel==='a[href]'&&c.tagName==='A'&&c.getAttribute('href'))all.push(c);visit(c);}};visit(this);return all;},append(n){n.parentElement=this;this.children.push(n);}});
 const nav=mk('NAV',{}, {x:0,y:0,width:320,height:clientHeight});nav.clientHeight=clientHeight;nav.scrollHeight=scrollHeight;let top=scrollTop;
 Object.defineProperty(nav,'scrollTop',{get:()=>top,set:v=>{if(!failScroll)top=v;}});
 const listAttrs=virtualIndex===null?{}:{'data-row-index':String(virtualIndex)};
 const list=mk('DIV',listAttrs,{x:0,y:20,width:320,height:scrollHeight});list.clientHeight=clientHeight;list.scrollHeight=scrollHeight;list.styleTransform=transformY?`translateY(${transformY}px)`:'none';nav.append(list);
 if(header)list.append(mk('HEADER',{}, {x:0,y:5,width:300,height:18}));
 if(project)list.append(mk('A',{href:'/g/private-project'},{x:10,y:25,width:270,height:18}));
 if(spacerBefore)list.append(mk('DIV',{'data-virtual-spacer':'before'}, {x:0,y:0,width:300,height:45}));
 const count=3+extraRows;for(let i=0;i<count;i++){const base={x:10,y:50+40*i,width:270,height:32},row=mk('A',{href:`/g/private-space/c/private-chat-${i}`},base);row.scrollIntoView=()=>{if(failScroll)return;nav.scrollTop=0;row.getBoundingClientRect=()=>({...base,top:base.y,bottom:base.y+base.height,left:base.x,right:base.x+base.width});};if(predecessor==='hidden'&&i===0)row.hidden=true;if(predecessor==='offscreen'&&i===0)row.getBoundingClientRect=()=>({x:10,y:-30,width:270,height:20,top:-30,bottom:-10,left:10,right:280});list.append(row);}
 const doc={readyState:'complete',body:mk('BODY',{}, {x:0,y:0,width:1024,height:768}),documentElement:{clientWidth:1024,clientHeight:768},querySelectorAll:s=>s==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[nav]:[]};
 const styleFor=el=>({overflowY:el===nav?'auto':'visible',transform:el===list?list.styleTransform:'none',position:'static',top:'auto'});
 return {document:doc,nav,list,styleFor};
}
function conversationReadinessDocument(){
 const nav={tagName:'NAV',hidden:false,attributes:[],parentElement:null,children:[],getAttribute:()=>null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:0,width:320,height:700,top:0,bottom:700,left:0,right:320}),
  contains(node){return node===this||this.children.includes(node);},querySelectorAll(selector){if(selector==='a[href]'||selector.includes('a[href*="/c/"]'))return this.children.filter(node=>node.tagName==='A');if(selector.includes('[role="list"]'))return[this];return[];}};
 const document={readyState:'complete',documentElement:{},body:{},querySelectorAll:selector=>selector==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[nav]:[]};
 const add=()=>{const href=`/c/private-readiness-chat-${nav.children.length}`,anchor={tagName:'A',hidden:false,attributes:[{name:'href',value:href}],parentElement:nav,getAttribute:name=>name==='href'?href:null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:8,y:25,width:270,height:30,top:25,bottom:55,left:8,right:278}),querySelectorAll:()=>[]};nav.children.push(anchor);return anchor;};
 return {document,nav,add};
}
function stagedPreflightDocument({readyState='complete',sidebar=true,list=true,initialRows=0}={}){
 let state=readyState,hasSidebar=sidebar,hasList=list;const nav={tagName:'NAV',hidden:false,attributes:[],parentElement:null,children:[],getAttribute:()=>null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:0,width:320,height:600,top:0,bottom:600,left:0,right:320}),contains(node){return node===this||this.children.includes(node);},querySelectorAll(selector){if(selector==='a[href]')return this.children.filter(node=>node.tagName==='A');if(selector.includes('[role="list"]'))return hasList?[listRegion]:[];return[];}};
 const listRegion={tagName:'DIV',attributes:[{name:'role',value:'list'}],getAttribute:name=>name==='role'?'list':null,getClientRects:()=>[{}],querySelectorAll:selector=>selector==='a[href]'?nav.children.filter(node=>node.tagName==='A'):[]};
 const doc={body:{},documentElement:{clientWidth:1024,clientHeight:768},get readyState(){return state;},querySelectorAll(selector){if(selector==='nav,aside,[role="navigation"],[data-testid*="sidebar"]')return hasSidebar?[nav]:[];if(selector==='a[href]')return nav.children.filter(node=>node.tagName==='A');return[];}};
 const add=()=>{const i=nav.children.filter(node=>node.tagName==='A').length,anchor={tagName:'A',hidden:false,attributes:[{name:'href',value:`/c/preflight-private-${i}`}],parentElement:nav,getAttribute:name=>name==='href'?`/c/preflight-private-${i}`:null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:8,y:24+i*36,width:270,height:30,top:24+i*36,bottom:54+i*36,left:8,right:278}),querySelectorAll:()=>[]};nav.children.push(anchor);return anchor;};
 for(let i=0;i<initialRows;i++)add();
 return{document:doc,nav,listRegion,add,setReadyState:value=>{state=value;},setSidebar:value=>{hasSidebar=value;},setList:value=>{hasList=value;}};
}
test('pinned preflight waits for delayed document, sidebar and routes; list region is telemetry only',async()=>{
 for(const stage of ['document','sidebar','rows']){
  const dom=stagedPreflightDocument({readyState:stage==='document'?'loading':'complete',sidebar:stage!=='sidebar',list:false}),x=setup(dom.document);
  setTimeout(()=>{if(stage==='document')dom.setReadyState('complete');if(stage==='sidebar')dom.setSidebar(true);if(stage==='rows')dom.add();else if(stage!=='document')dom.add();},20);
  if(stage==='document')setTimeout(()=>dom.add(),45);
  const result=await x.window.gptWaitForPinnedReadinessPreflight({preflightTimeoutMs:1200,webViewVisible:false,navigationActive:false});
  assert.equal(result.readiness.status,'snapshot_ready',stage);assert.equal(result.preflight.documentReadyState,'complete');assert.equal(result.preflight.sidebarAvailable,true);if(stage==='rows')assert.equal(result.preflight.listRegionCandidatesAtRowsWaitStart,0);assert.equal(result.preflight.webViewVisible,false);assert.equal(result.preflight.navigationActive,false);assert.ok(result.preflight.durationMs<=1200);
 }
});
test('a list region that mounts after conversation links does not gate readiness',async()=>{
 const dom=stagedPreflightDocument({readyState:'complete',sidebar:true,list:false}),x=setup(dom.document);
 setTimeout(()=>dom.add(),20);setTimeout(()=>dom.setList(true),150);
 const result=await x.window.gptWaitForPinnedReadinessPreflight({preflightTimeoutMs:1200});
 assert.equal(result.readiness.status,'snapshot_ready');assert.equal(result.preflight.listRegionCandidatesAtRowsWaitStart,0);assert.equal(result.preflight.listRegionAvailable,true);
});
test('late sidebar changes within phase A receive only the bounded stabilization grace',async()=>{
 const dom=stagedPreflightDocument({readyState:'complete',sidebar:true,list:false}),x=setup(dom.document),started=Date.now();
 setTimeout(()=>dom.add(),3700);
 const result=await x.window.gptWaitForPinnedReadinessPreflight({preflightTimeoutMs:17000});
 assert.equal(result.readiness.status,'snapshot_ready');assert.equal(result.readiness.firstPositiveCount,1);assert.equal(result.readiness.finalStableCount,1);assert.equal(result.preflight.listRegionCandidatesAtRowsWaitStart,0);assert.ok(result.readiness.timeToFirstPositiveMs>=3500&&result.readiness.timeToFirstPositiveMs<=4000);assert.ok(result.readiness.extensionActivated);assert.equal(result.readiness.phaseABudgetMs,4000);assert.equal(result.readiness.stabilizationGraceMs,1200);assert.equal(result.readiness.absoluteReadinessCapMs,6000);assert.ok(result.preflight.durationMs>=3900&&result.preflight.durationMs<=6500);assert.ok(Date.now()-started<7000);
});
test('pinned preflight reports the exact last readiness stage that timed out',async()=>{
 const cases=[
  [{readyState:'loading',sidebar:false,list:false},'document_not_ready'],
  [{readyState:'complete',sidebar:false,list:false},'sidebar_root_missing'],
  [{readyState:'complete',sidebar:true,list:false},'rows_never_appeared'],
  [{readyState:'complete',sidebar:true,list:true},'rows_never_appeared']
 ];
 for(const [options,expected] of cases){const dom=stagedPreflightDocument(options),x=setup(dom.document);const result=await x.window.gptWaitForPinnedReadinessPreflight({preflightTimeoutMs:90});assert.equal(result.readiness.status,expected);assert.equal(result.readiness.terminalReason,expected);assert.equal(result.preflight.reason,expected);assert.ok(result.preflight.durationMs<=300);if(expected==='rows_never_appeared'){assert.equal(result.preflight.sidebarAvailable,true);assert.equal(result.preflight.listRegionCandidatesAtRowsWaitStart,options.list?1:0);assert.equal(result.preflight.totalConversationRouteLinks,0);}}
});
test('unsupported route returns a distinct context readiness result without waiting or navigating',async()=>{
 const dom=stagedPreflightDocument(),x=setup(dom.document);x.location.pathname='/settings/account';
 const result=await x.window.gptWaitForPinnedReadinessPreflight({preflightTimeoutMs:500});
 assert.equal(result.readiness.status,'wrong_route_or_context');assert.equal(result.preflight.reason,'wrong_route_or_context');assert.equal(result.readiness.ready,false);assert.equal(result.preflight.durationMs<200,true);
});
test('render-state snapshot observes list and conversation-link changes without navigation or content',async()=>{
 const dom=stagedPreflightDocument({readyState:'complete',sidebar:true,list:false}),x=setup(dom.document),before=x.window.gptRenderStateSnapshot();
 setTimeout(()=>{dom.setList(true);dom.add();},30);
 const result=await x.window.gptInspectRenderDOM({before,timeoutMs:500,renderSurfaceActive:true});
 assert.deepEqual([before.conversationListCandidates,before.conversationLinks],[0,0]);
 assert.deepEqual([result.after.conversationListCandidates,result.after.conversationLinks],[1,1]);
 assert.ok(result.firstListRegionChangeMs>=0&&result.firstConversationLinkChangeMs>=0);assert.ok(result.elapsedMs<500);assert.equal(result.renderSurfaceActive,true);
 const json=JSON.stringify(result);for(const privateValue of ['preflight-private','private-chat','title','href','message'])assert.equal(json.includes(privateValue),false);
});
test('render-state DOM wait is bounded when the hidden page never adds a list or links',async()=>{
 const dom=stagedPreflightDocument({readyState:'complete',sidebar:true,list:false}),x=setup(dom.document),before=x.window.gptRenderStateSnapshot();
 const started=Date.now(),result=await x.window.gptInspectRenderDOM({before,timeoutMs:40});
 assert.ok(Date.now()-started<250);assert.deepEqual([result.after.conversationListCandidates,result.after.conversationLinks],[0,0]);
});
test('conversation row readiness waits for a bounded quiet window even when rows exist immediately',async()=>{
 const dom=topPositionDocument({}),x=setup(dom.document);x.window.requestAnimationFrame=callback=>setTimeout(callback,0);
 const result=await x.window.gptWaitForConversationRowsReady({timeoutMs:1000});assert.equal(result.status,'ready');assert.equal(result.rowsAtFirstDetection,3);assert.equal(result.rowsAtStabilizedSnapshot,3);assert.ok(result.waitDurationMs>=300);assert.ok(result.waitDurationMs<1000);
});
test('conversation row readiness waits for asynchronous sidebar row insertion',async()=>{
 const dom=conversationReadinessDocument(),x=setup(dom.document);x.window.requestAnimationFrame=callback=>setTimeout(callback,0);
 setTimeout(()=>{dom.add();dom.document.__notifyMutation([]);},20);
 const result=await x.window.gptWaitForConversationRowsReady({timeoutMs:1000});assert.equal(result.status,'ready');assert.equal(result.rowsAtFirstDetection,1);assert.equal(result.rowsAtStabilizedSnapshot,1);assert.ok(result.waitDurationMs>=300);
});
test('conversation row readiness waits for gradual 1 to 5 to 12 row growth and stabilizes the final count',async()=>{
 const dom=conversationReadinessDocument(),x=setup(dom.document);x.window.requestAnimationFrame=callback=>setTimeout(callback,0);
 const addRows=count=>{for(let i=dom.nav.children.length;i<count;i++)dom.add();dom.document.__notifyMutation([]);};
 setTimeout(()=>addRows(1),5);setTimeout(()=>addRows(5),90);setTimeout(()=>addRows(12),180);
 const result=await x.window.gptWaitForConversationRowsReady({timeoutMs:1200});assert.equal(result.status,'ready');assert.equal(result.rowsAtFirstDetection,1);assert.equal(result.rowsAtStabilizedSnapshot,12);assert.ok(result.waitDurationMs>=450);assert.ok(result.waitDurationMs<1200);
});
test('same 11 conversation routes with unrelated DOM mutation signals remain ready',async()=>{
 const dom=conversationReadinessDocument(),x=setup(dom.document);for(let i=0;i<11;i++)dom.add();
 setTimeout(()=>dom.document.__notifyMutation([{type:'childList'}]),40);setTimeout(()=>dom.document.__notifyMutation([{type:'childList'}]),100);
 const result=await x.window.gptWaitForConversationRowsReady({timeoutMs:1000});
 assert.equal(result.status,'ready');assert.equal(result.firstPositiveCount,11);assert.equal(result.finalStableCount,11);assert.equal(result.conversationSignatureChanges,0);assert.ok(result.unrelatedMutationChecks>=2);
 const safe=JSON.stringify(result);assert.equal(safe.includes('private'),false);assert.equal(safe.includes('href'),false);
});
test('7 to 11 to 11 conversation snapshots stabilize at 11',async()=>{
 const dom=conversationReadinessDocument(),x=setup(dom.document);for(let i=0;i<7;i++)dom.add();
 setTimeout(()=>{for(let i=dom.nav.children.length;i<11;i++)dom.add();dom.document.__notifyMutation([{type:'childList'}]);},80);
 setTimeout(()=>dom.document.__notifyMutation([{type:'childList'}]),140);
 const result=await x.window.gptWaitForConversationRowsReady({timeoutMs:1200});assert.equal(result.status,'ready');assert.equal(result.firstPositiveCount,7);assert.equal(result.finalStableCount,11);assert.equal(result.conversationSignatureChanges,1);assert.ok(result.timeToStableMs>=320);
});
test('11 to 12 to 12 conversation snapshots stabilize at 12',async()=>{
 const dom=conversationReadinessDocument(),x=setup(dom.document);for(let i=0;i<11;i++)dom.add();
 setTimeout(()=>{dom.add();dom.document.__notifyMutation([{type:'childList'}]);},70);setTimeout(()=>dom.document.__notifyMutation([{type:'childList'}]),130);
 const result=await x.window.gptWaitForConversationRowsReady({timeoutMs:1200});assert.equal(result.status,'ready');assert.equal(result.firstPositiveCount,11);assert.equal(result.finalStableCount,12);assert.equal(result.conversationSignatureChanges,1);
});
test('conversation set that keeps changing until stabilization deadline is unstable',async()=>{
 const dom=conversationReadinessDocument(),x=setup(dom.document);dom.add();
 setTimeout(()=>{dom.add();dom.document.__notifyMutation([{type:'childList'}]);},35);
 setTimeout(()=>{dom.add();dom.document.__notifyMutation([{type:'childList'}]);},80);
 setTimeout(()=>{dom.add();dom.document.__notifyMutation([{type:'childList'}]);},125);
 const result=await x.window.gptWaitForConversationRowsReady({phaseABudgetMs:150,stabilizationGraceMs:120,absoluteReadinessCapMs:270});assert.equal(result.status,'conversation_rows_unstable');assert.equal(result.diagnosticStatus,'rows_appeared_but_never_stabilized');assert.ok(result.conversationSignatureChanges>=2);assert.equal(result.finalStableCount,4);assert.equal(result.extensionActivated,true);assert.ok(result.waitDurationMs<=300);
});
test('late semantic sidebar change is accepted only after four samples and 320ms inside grace',async()=>{
 const dom=conversationReadinessDocument(),x=setup(dom.document);dom.add();
 setTimeout(()=>{dom.add();dom.document.__notifyMutation([{type:'childList'}]);},80);
 const result=await x.window.gptWaitForConversationRowsReady({phaseABudgetMs:120,stabilizationGraceMs:500,absoluteReadinessCapMs:700});
 assert.equal(result.status,'ready');assert.equal(result.extensionActivated,true);assert.equal(result.finalStableCount,2);assert.ok(result.timeToStableMs>=320);assert.equal(result.phaseABudgetMs,120);assert.equal(result.stabilizationGraceMs,500);assert.equal(result.absoluteReadinessCapMs,700);
});
test('one-row account list also reaches ready after the quiet window',async()=>{
 const dom=conversationReadinessDocument(),x=setup(dom.document);dom.add();
 const result=await x.window.gptWaitForConversationRowsReady({timeoutMs:1000});assert.equal(result.status,'ready');assert.equal(result.rowsAtFirstDetection,1);assert.equal(result.rowsAtStabilizedSnapshot,1);assert.ok(result.waitDurationMs>=300);
});
test('conversation row readiness times out when the sidebar exists without conversation rows',async()=>{
 const dom=conversationReadinessDocument(),x=setup(dom.document);
 const result=await x.window.gptWaitForConversationRowsReady({timeoutMs:25});assert.equal(result.status,'conversation_rows_timeout');assert.equal(result.diagnosticStatus,'rows_never_appeared');assert.equal(result.terminalReason,'conversation_rows_timeout');assert.equal(result.sidebarRegionFound,true);assert.equal(result.rowsAtFirstDetection,0);assert.equal(result.firstPositiveCount,0);assert.equal(result.finalSnapshotCount,0);assert.ok(result.waitDurationMs<200);
});
test('rows appearing on the phase A boundary start one bounded stabilization grace',async()=>{
 const dom=conversationReadinessDocument();let injected=false;
 const deadlineTimer=(callback,ms)=>setTimeout(()=>{if(ms<=25&&!injected){injected=true;for(let i=0;i<8;i++)dom.add();}callback();},ms);
 const x=setup(dom.document,deadlineTimer);
 const result=await x.window.gptWaitForConversationRowsReady({phaseABudgetMs:25,stabilizationGraceMs:500,absoluteReadinessCapMs:600});
 assert.equal(result.status,'ready');assert.equal(result.terminalReason,'ready');assert.equal(result.firstPositiveCount,8);assert.equal(result.rowsAtFirstDetection,8);assert.equal(result.stableCount,8);assert.equal(result.rowsAtStabilizedSnapshot,8);assert.equal(result.finalSnapshotCount,8);assert.ok(result.timeToFirstPositiveMs>=25);assert.ok(result.timeToStableMs>=320);assert.equal(result.extensionActivated,true);
});
test('rows that disappear before the stabilized snapshot return unstable',async()=>{
 const dom=conversationReadinessDocument(),x=setup(dom.document);x.window.requestAnimationFrame=callback=>setTimeout(callback,0);
 setTimeout(()=>{const anchor=dom.add();dom.document.__notifyMutation([]);setTimeout(()=>{dom.nav.children.splice(dom.nav.children.indexOf(anchor),1);dom.document.__notifyMutation([]);},90);},0);
 const result=await x.window.gptWaitForConversationRowsReady({phaseABudgetMs:100,stabilizationGraceMs:60,absoluteReadinessCapMs:160});assert.equal(result.status,'conversation_rows_unstable');assert.equal(result.diagnosticStatus,'rows_appeared_but_never_stabilized');assert.equal(result.rowsAtFirstDetection,1);assert.equal(result.rowsAtStabilizedSnapshot,0);assert.equal(result.readinessTerminalReason,'conversation_rows_unstable');
});
test('missing sidebar returns sidebar_unavailable after the bounded wait',async()=>{
 const x=setup({documentElement:{},body:{},querySelectorAll:()=>[]});const result=await x.window.gptWaitForConversationRowsReady({timeoutMs:25});assert.equal(result.status,'sidebar_unavailable');assert.equal(result.diagnosticStatus,'sidebar_root_missing');assert.equal(result.sidebarRegionFound,false);assert.ok(result.waitDurationMs<200);
});
test('pinned-prefix waits for asynchronously inserted rows before top proof and menu classification',async()=>{
 const dom=conversationReadinessDocument(),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;x.window.requestAnimationFrame=callback=>setTimeout(callback,0);
 setTimeout(()=>{dom.add();dom.document.__notifyMutation([]);},20);
 const result=await x.window.gptInspectVisiblePinnedRows({hardTimeoutMs:500});assert.equal(result.readiness.status,'snapshot_ready');assert.equal(result.readiness.rawStatus,'ready');assert.equal(result.readiness.rowsAtFirstDetection,1);assert.equal(result.sidebarTop.proof,'top_proven');assert.equal(result.rowsInspected,1);assert.equal(result.rows[0].status,'unknown');assert.equal(result.rows[0].menuOpened,false);
});
test('unknown pinned-prefix rows expose only bounded structural diagnostics and remain unproven',async()=>{
 const dom=visiblePinnedRowsDocument([[]],{includeProject:false}),x=setup(dom.document,setTimeout,Date.now,()=>({display:'block',visibility:'visible',opacity:'1'}));x.window.innerWidth=1024;x.window.innerHeight=768;
 const anchor=dom.rows[0].anchor;anchor.attributes.push({name:'data-octane-navigation-item',value:'PRIVATE-ROW-VALUE'},{name:'aria-label',value:'PRIVATE CHAT TITLE'});
 anchor.hasAttribute=name=>name==='data-octane-navigation-item'||name==='href';
 const result=await x.window.gptInspectVisiblePinnedRows({hardTimeoutMs:1000});
 assert.equal(result.pinnedPrefixStatus,'pinned_prefix_unproven');assert.equal(result.unknownCount,1);
 assert.equal(result.unknownRowDiagnostics.length,1);const row=result.unknownRowDiagnostics[0];
 assert.deepEqual(JSON.parse(JSON.stringify(row)),{positionIndex:1,tag:'a',routeTemplate:'/c/:id',hasHref:true,hasOctaneNavigationItem:true,dataAttributeNames:['data-octane-navigation-item'],ariaAttributeNames:['aria-label'],visible:true,conversationRouteClassification:'conversation',navigationRowClassification:'conversation_row',pinnedStarredClassification:'unknown',structuralClassification:'octane_conversation_row_variant',rejectionReason:'menu_items_missing'});
 const encoded=JSON.stringify(result);for(const secret of ['private-chat-1','PRIVATE-ROW-VALUE','PRIVATE CHAT TITLE','/c/private-chat-1'])assert.equal(encoded.includes(secret),false);
});
test('known conversation rows are not reported unknown and settings navigation is excluded from the proof snapshot',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{includeProject:false}),x=setup(dom.document,setTimeout,Date.now,()=>({display:'block',visibility:'visible',opacity:'1'}));x.window.innerWidth=1024;x.window.innerHeight=768;
 const complete=await x.window.gptInspectVisiblePinnedRows({hardTimeoutMs:1000});assert.equal(complete.pinnedPrefixStatus,'pinned_prefix_complete');assert.deepEqual(Array.from(complete.unknownRowDiagnostics||[]),[]);
 const nav=visiblePinnedRowsDocument([[]],{includeProject:false}),y=setup(nav.document,setTimeout,Date.now,()=>({display:'block',visibility:'visible',opacity:'1'}));y.window.innerWidth=1024;y.window.innerHeight=768;
 nav.rows[0].anchor.getAttribute=name=>name==='href'?'/settings':null;
 const navigationOnly=await y.window.gptInspectVisiblePinnedRows({hardTimeoutMs:1000});assert.equal(navigationOnly.rowsInspected,0);assert.deepEqual(Array.from(navigationOnly.unknownRowDiagnostics||[]),[]);
});
test('pinned-prefix readiness timeout leaves top unproven without opening menus',async()=>{
 const dom=conversationReadinessDocument(),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows({hardTimeoutMs:100});assert.equal(result.readiness.status,'rows_never_appeared');assert.equal(result.sidebarTop.proof,'not_run');assert.equal(result.sidebarTop.reason,'rows_never_appeared');assert.equal(result.rowsInspected,0);assert.equal(result.stopReason,'rows_never_appeared');
});

test('zero conversation rows keep an explicit readiness reason instead of top_unproven',async()=>{
 const dom=stagedPreflightDocument({readyState:'complete',sidebar:true,list:false}),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows({hardTimeoutMs:1200});
 assert.equal(result.preflight.listRegionCandidates,0);assert.equal(result.readiness.status,'rows_never_appeared');assert.equal(result.preflight.reason,'rows_never_appeared');
 assert.equal(result.sidebarTop.proof,'not_run');assert.equal(result.sidebarTop.reason,'rows_never_appeared');
 assert.equal(result.pinnedPrefixStatus,'pinned_prefix_unproven');assert.equal(result.pinnedPrefixReason,'rows_never_appeared');assert.equal(result.rowsInspected,0);
});

test('conversation rows that exist but lack top proof retain top_unproven with the structural reason',async()=>{
 const dom=conversationReadinessDocument(),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;x.window.requestAnimationFrame=callback=>setTimeout(callback,0);
 setTimeout(()=>{const row=dom.add();row.attributes.push({name:'data-index',value:'1'});dom.document.__notifyMutation([]);},15);
 const result=await x.window.gptInspectVisiblePinnedRows({hardTimeoutMs:600});
 assert.equal(result.readiness.status,'snapshot_ready');assert.ok(result.sidebarTop.totalConversationLinks>0);
 assert.equal(result.sidebarTop.proof,'top_unproven');assert.equal(result.sidebarTop.reason,'virtualized_position_unproven');
});

test('top-position scrolls a real ancestor to zero and proves first DOM conversation row without menu interaction',async()=>{
 const dom=topPositionDocument({scrollTop:75,scrollHeight:700,clientHeight:200}),x=setup(dom.document,setTimeout,Date.now,dom.styleFor);
 x.window.requestAnimationFrame=fn=>setTimeout(fn,0);x.window.innerHeight=768;
 const result=await x.window.gptInspectSidebarTopPosition();
 assert.equal(result.status,'top_proven');assert.equal(result.reason,'top_proven');assert.equal(result.visibleConversationLinks,3);
 assert.equal(result.normalization.invoked,true);assert.equal(result.normalization.scrollStateBefore.windowY,0);assert.equal(result.normalization.firstRowVisibleAfter,true);assert.equal(result.normalization.changedScrollAncestors,1);
 assert.equal(result.scrollTopAfter,0);assert.equal(result.firstVisibleIndex,0);assert.equal(result.domConversationRowsBefore,0);assert.ok(result.scrollAncestry.length<=8);assert.equal(result.menuClicks,0);
 assert.ok(!JSON.stringify(result).includes('private-'));assert.ok(!JSON.stringify(result).includes('/c/'));
});
test('native scrollIntoView proves the first active row without discovering a scroll container',async()=>{
 const dom=topPositionDocument({predecessor:'offscreen',scrollHeight:900,clientHeight:200}),x=setup(dom.document,setTimeout,Date.now,()=>({overflowY:'visible',transform:'none'}));x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectSidebarTopPosition();assert.equal(result.normalization.invoked,true);assert.equal(result.normalization.firstRowVisibleAfter,true);assert.equal(result.normalization.changedScrollAncestors,0);
 assert.equal(result.scrollableAncestorFound,false);assert.equal(result.firstVisibleIndex,0);assert.equal(result.conversationRowsBefore,0);assert.equal(result.status,'top_proven');assert.equal(result.reason,'top_proven');
});
test('top proof re-resolves the active first conversation after scrollIntoView rebuilds its DOM node',async()=>{
 const dom=topPositionDocument({predecessor:'offscreen'}),x=setup(dom.document,setTimeout,Date.now,dom.styleFor);x.window.innerWidth=1024;x.window.innerHeight=768;
 const original=dom.list.children[0];original.scrollIntoView=()=>{const rect={x:10,y:50,width:270,height:32,left:10,top:50,right:280,bottom:82};const replacement={tagName:'A',hidden:false,attributes:original.attributes,parentElement:dom.list,children:[],getAttribute:original.getAttribute,getClientRects:()=>[{}],getBoundingClientRect:()=>rect,contains(node){return node===this;},querySelectorAll:()=>[]};dom.list.children[0]=replacement;};
 const result=await x.window.gptInspectSidebarTopPosition();assert.equal(result.normalization.invoked,true);assert.equal(result.normalization.activeContextChanged,false);assert.equal(result.normalization.firstRowVisibleAfter,true);assert.equal(result.status,'top_proven',JSON.stringify(result));assert.equal(result.firstVisibleIndex,0);
});
test('ambiguous active-list replacement after scrollIntoView keeps top unproven',async()=>{
 const dom=topPositionDocument({predecessor:'offscreen'}),x=setup(dom.document,setTimeout,Date.now,dom.styleFor);x.window.innerWidth=1024;x.window.innerHeight=768;
 const original=dom.list.children[0];original.scrollIntoView=()=>{const rect={x:10,y:50,width:270,height:32,left:10,top:50,right:280,bottom:82};const replacement={tagName:'A',hidden:false,attributes:[{name:'href',value:'/c/different-private-route'}],parentElement:dom.list,children:[],getAttribute:name=>name==='href'?'/c/different-private-route':null,getClientRects:()=>[{}],getBoundingClientRect:()=>rect,contains(node){return node===this;},querySelectorAll:()=>[]};dom.list.children[0]=replacement;};
 const result=await x.window.gptInspectSidebarTopPosition();assert.equal(result.normalization.activeContextChanged,true);assert.equal(result.status,'top_unproven');assert.equal(result.reason,'active_context_changed_after_scroll');
 const safe=JSON.stringify(result);assert.equal(safe.includes('different-private-route'),false);assert.equal(safe.includes('/c/'),false);
});
test('hidden responsive sidebar clone is excluded and active container selection is deterministic',async()=>{
 const dom=topPositionDocument(),x=setup(dom.document,setTimeout,Date.now,dom.styleFor);x.window.innerWidth=1024;x.window.innerHeight=768;
 const cloneAnchor={tagName:'A',hidden:false,attributes:[{name:'href',value:'/c/private-clone-id'}],parentElement:null,getAttribute:name=>name==='href'?'/c/private-clone-id':null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:8,y:25,width:250,height:32,top:25,bottom:57,left:8,right:258})};
 const clone={tagName:'NAV',hidden:true,attributes:[],children:[cloneAnchor],parentElement:null,getAttribute:()=>null,getClientRects:()=>[],getBoundingClientRect:()=>({x:0,y:0,width:320,height:600,top:0,bottom:600,left:0,right:320}),contains:node=>node===clone||node===cloneAnchor,querySelectorAll:selector=>selector==='a[href]'?[cloneAnchor]:[]};cloneAnchor.parentElement=clone;
 const original=dom.document.querySelectorAll;dom.document.querySelectorAll=selector=>selector==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[dom.nav,clone]:original(selector);
 const result=await x.window.gptInspectSidebarTopPosition();
 assert.equal(result.status,'top_proven');assert.equal(result.activeSidebarSelection.candidateCount,2);assert.equal(result.activeSidebarSelection.inactiveCandidates,1);
 assert.equal(result.activeContextType,'scroll_container');assert.equal(result.totalConversationLinks,3);
 const safe=JSON.stringify(result);for(const secret of ['private-clone-id','href','title','textContent'])assert.equal(safe.includes(secret),false);
});
test('inactive hidden rows are excluded and active rows above the viewport are normalized into view',async()=>{
 const hidden=topPositionDocument({predecessor:'hidden'}),x=setup(hidden.document,setTimeout,Date.now,hidden.styleFor);x.window.innerWidth=1024;x.window.innerHeight=768;
 const hiddenResult=await x.window.gptInspectSidebarTopPosition();assert.equal(hiddenResult.status,'top_proven');assert.equal(hiddenResult.inactiveRowsExcluded,1);
 const above=topPositionDocument({predecessor:'offscreen'}),y=setup(above.document,setTimeout,Date.now,above.styleFor);y.window.innerWidth=1024;y.window.innerHeight=768;
 const aboveResult=await y.window.gptInspectSidebarTopPosition();assert.equal(aboveResult.normalization.invoked,true);assert.equal(aboveResult.normalization.firstRowVisibleAfter,true);
 assert.equal(aboveResult.status,'top_proven');assert.equal(aboveResult.firstVisibleIndex,0);assert.equal(aboveResult.conversationRowsBefore,0);assert.equal(aboveResult.totalConversationLinks,3);
});
test('non-scrollable list proves top even when later conversation rows extend below viewport',async()=>{
 const dom=topPositionDocument({scrollHeight:900,clientHeight:200,extraRows:8}),x=setup(dom.document,setTimeout,Date.now,()=>({overflowY:'visible',transform:'none'}));x.window.innerHeight=768;
 const result=await x.window.gptInspectSidebarTopPosition();assert.equal(result.status,'top_proven');assert.equal(result.totalConversationLinks,11);assert.equal(result.visibleConversationLinks,4);assert.equal(result.firstVisibleIndex,0);assert.equal(result.scrollAncestorFound,false);assert.equal(result.menuClicks,0);
});
test('hidden non-rendered conversation row is excluded from the active list proof',async()=>{
 const dom=topPositionDocument({predecessor:'hidden'}),x=setup(dom.document,setTimeout,Date.now,()=>({overflowY:'visible',transform:'none'}));x.window.innerHeight=768;
 const result=await x.window.gptInspectSidebarTopPosition();assert.equal(result.status,'top_proven');assert.equal(result.reason,'top_proven');assert.equal(result.totalConversationLinks,2);assert.equal(result.firstVisibleIndex,0);assert.equal(result.domConversationRowsBefore,0);assert.equal(result.inactiveRowsExcluded,1);
});
test('offscreen first conversation row is normalized before top proof',async()=>{
 const dom=topPositionDocument({predecessor:'offscreen'}),x=setup(dom.document,setTimeout,Date.now,()=>({overflowY:'visible',transform:'none'}));x.window.innerHeight=768;
 const result=await x.window.gptInspectSidebarTopPosition();assert.equal(result.status,'top_proven');assert.equal(result.normalization.invoked,true);assert.equal(result.firstVisibleIndex,0);assert.equal(result.domConversationRowsBefore,0);assert.equal(result.normalization.firstRowVisibleAfter,true);
});
test('headers and project links before first conversation do not affect conversation order proof',async()=>{
 const dom=topPositionDocument({header:true,project:true,scrollHeight:900,clientHeight:200}),x=setup(dom.document,setTimeout,Date.now,()=>({overflowY:'visible',transform:'none'}));x.window.innerHeight=768;
 const result=await x.window.gptInspectSidebarTopPosition();assert.equal(result.status,'top_proven');assert.equal(result.firstVisibleIndex,0);assert.equal(result.domConversationRowsBefore,0);assert.equal(result.totalConversationLinks,3);
});
test('a failed scrollIntoView leaves first-row normalization unproven',async()=>{
 const dom=topPositionDocument({scrollTop:75,scrollHeight:700,clientHeight:200,failScroll:true}),x=setup(dom.document,setTimeout,Date.now,dom.styleFor);
 dom.list.children[0].getBoundingClientRect=()=>({x:10,y:-80,width:270,height:32,left:10,top:-80,right:280,bottom:-48});
 dom.list.children[0].scrollIntoView=()=>{};
 x.window.requestAnimationFrame=fn=>setTimeout(fn,0);x.window.innerHeight=768;
 const result=await x.window.gptInspectSidebarTopPosition();assert.equal(result.status,'top_unproven');assert.equal(result.reason,'first_row_scroll_normalization_failed');assert.equal(result.normalization.invoked,true);assert.equal(result.normalization.firstRowVisibleAfter,false);assert.equal(result.scrollTopAfter,75);
});
test('non-zero virtual row index prevents top proof; zero index does not',async()=>{
 const zero=topPositionDocument({virtualIndex:0,scrollHeight:900,clientHeight:200}),x=setup(zero.document,setTimeout,Date.now,()=>({overflowY:'visible',transform:'none'}));x.window.innerHeight=768;
 const zeroResult=await x.window.gptInspectSidebarTopPosition();assert.equal(zeroResult.status,'top_proven');assert.equal(zeroResult.virtualization.indexAttributesPresent,true);assert.equal(zeroResult.virtualization.positiveRowIndex,false);
 const later=topPositionDocument({virtualIndex:4,scrollHeight:900,clientHeight:200}),y=setup(later.document,setTimeout,Date.now,()=>({overflowY:'visible',transform:'none'}));y.window.innerHeight=768;
 const laterResult=await y.window.gptInspectSidebarTopPosition();assert.equal(laterResult.status,'top_unproven');assert.equal(laterResult.reason,'virtualized_position_unproven');assert.equal(laterResult.virtualization.detected,true);
});
test('virtual spacer or translated list before rows prevents top proof',async()=>{
 for(const options of [{spacerBefore:true},{transformY:-40}]){const dom=topPositionDocument(options),x=setup(dom.document,setTimeout,Date.now,dom.styleFor);x.window.innerHeight=768;const result=await x.window.gptInspectSidebarTopPosition();assert.equal(result.status,'top_unproven');assert.equal(result.reason,'virtualized_position_unproven');}
});
test('standalone and pinned-prefix share the same top-proof result for 12 links with 5 visible and no scroller',async()=>{
 const dom=topPositionDocument({scrollHeight:900,clientHeight:240,extraRows:9}),x=setup(dom.document,setTimeout,Date.now,()=>({overflowY:'visible',transform:'none'}));x.window.innerHeight=768;
 const direct=await x.window.gptInspectConversationListTopState(dom.nav);
 const standalone=await x.window.gptInspectSidebarTopPosition();
 const pinned=await x.window.gptInspectVisiblePinnedRows();
 assert.equal(direct.status,'top_proven');assert.equal(direct.totalConversationLinks,12);assert.equal(direct.visibleConversationLinks,5);assert.equal(direct.firstVisibleIndex,0);assert.equal(direct.conversationRowsBefore,0);assert.equal(direct.hiddenRowsBefore,0);assert.equal(direct.scrollableAncestorFound??false,false);assert.equal(direct.virtualOffsetEvidence,false);
 for(const result of [standalone,pinned.sidebarTop]){assert.equal(result.status||result.proof,'top_proven');assert.equal(result.totalConversationLinks??12,12);assert.equal(result.visibleConversationLinks??5,5);assert.equal(result.firstVisibleIndex,0);assert.equal(result.domConversationRowsBefore??0,0);assert.equal(result.reason,'top_proven');}
 assert.equal(pinned.rowsInspected,1);
});
test('top-position reports missing sidebar immediately and waits before reporting missing rows',async()=>{
 const missing=setup({querySelectorAll:()=>[]}),noRows=topPositionDocument({});
 assert.equal((await missing.window.gptInspectSidebarTopPosition({readinessTimeoutMs:25})).reason,'sidebar_unavailable');
 const x=setup({...noRows.document,querySelectorAll:s=>s==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[{tagName:'NAV',getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:0,width:300,height:500}),querySelectorAll:()=>[]}]:[]});
 const result=await x.window.gptInspectSidebarTopPosition({readinessTimeoutMs:25});assert.equal(result.reason,'conversation_rows_timeout');assert.equal(result.readiness.status,'conversation_rows_timeout');assert.equal(result.readiness.rowsAtFirstDetection,0);
});

test('v4.7 bounded diagnostic awaits report the exact stage for synthetic hangs',async()=>{
 const x=setup();
 for(const stage of ['readiness_started','top_started','prefix_started','hidden_timestamp_navigation_started','cleanup_started']){
  const result=await x.window.gptBoundedDiagnosticAwait(stage,()=>new Promise(()=>{}),5);
  assert.equal(result.status,'timeout');assert.equal(result.reason,`stage_timeout:${stage}`);
 }
});
test('v4.7 stage wrapper reports bridge callback exceptions at their exact stage',async()=>{
 const x=setup(),result=await x.window.gptBoundedDiagnosticAwait('bridge_callback',()=>{throw Error('private detail');},20);
 assert.equal(result.status,'error');assert.equal(result.reason,'stage_error:bridge_callback');assert.equal(JSON.stringify(result).includes('private detail'),false);
});
test('v5.9 isolated activity acknowledges probe_started before readiness work',async()=>{
 const dom=visiblePinnedRowsDocument([['Pin chat']]),x=setup(dom.document);
 x.window.requestAnimationFrame=callback=>setTimeout(callback,0);x.window.innerWidth=1024;x.window.innerHeight=768;x.window.gptPinnedActivityDiagnosticToken='native-token';x.window.gptResolvePinnedRecords=()=>[];
 const result=await x.window.gptInspectVisiblePinnedRows({includePinnedRecords:true,activityDiagnosticToken:'native-token'});
 const progress=x.diagnostics.filter(message=>message.pinnedActivityProgress).map(message=>message.pinnedActivityProgress.stage);
 assert.equal(progress[0],'probe_started');
 for(const stage of ['readiness_started','readiness_completed','snapshot_ready','top_started','top_completed','traversal_started','prefix_started','prefix_completed','cleanup_started','cleanup_completed','finished'])assert.ok(progress.includes(stage),`missing ${stage}`);
 assert.ok(progress.indexOf('readiness_completed')<progress.indexOf('snapshot_ready'));
 assert.ok(progress.indexOf('snapshot_ready')<progress.indexOf('traversal_started'));
 assert.equal(result.version,'5.31.0');assert.equal(result.diagnosticStage,'finished');assert.equal(result.stageFailure,null);assert.equal(result.prefixSnapshotCount,1);assert.equal(result.pinnedRecords,undefined);
 assert.equal(JSON.stringify(x.diagnostics).includes('private-chat'),false);assert.equal(JSON.stringify(x.diagnostics).includes('href'),false);
});

test('v4.8 prefix traversal re-resolves immutable snapshot IDs after a row disappears',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat'],['Unpin chat']]);
 const first=dom.rows[0],original=first.trigger.dispatchEvent;let removed=false;
 first.trigger.dispatchEvent=function(event){const result=original.call(this,event);if(event.type==='pointerdown'&&!removed){removed=true;const victim=dom.rows[1].row;dom.nav.children.splice(dom.nav.children.indexOf(victim),1);}return result;};
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:3});
 assert.equal(result.prefixSnapshotCount,3);assert.equal(result.rowsAttempted,2);assert.deepEqual(Array.from(result.rows,row=>row.reason),['unpin_action_available','row_missing_after_snapshot']);
 assert.equal(result.stopReason,'row_missing_after_snapshot');assert.equal(result.rows[0].domConversationsBeforeMenu,3);assert.equal(result.rows[0].domConversationsAfterCleanup,2);assert.equal(result.cleanupSuccessful,true);assert.equal(dom.openCount,1);assert.equal(dom.actionClicks,0);
 const json=JSON.stringify(result);for(const secret of ['private-chat-','private-project','href'])assert.equal(json.includes(secret),false);
});

test('v4.8 row snapshot traversal survives added conversations during menu interaction',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']]);
 const first=dom.rows[0],original=first.trigger.dispatchEvent;let added=false;
 first.trigger.dispatchEvent=function(event){const result=original.call(this,event);if(event.type==='pointerdown'&&!added){added=true;dom.nav.append({tagName:'A',hidden:false,parentElement:dom.nav,children:[],getAttribute:name=>name==='href'?'/c/added-after-snapshot':null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:8,y:180,width:230,height:36}),querySelectorAll:()=>[]});}return result;};
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20});
 assert.equal(result.initialSnapshotCount,2);assert.equal(result.finalSnapshotCount,3);assert.equal(result.snapshotExpansionCount,1);assert.equal(result.prefixSnapshotCount,3);assert.deepEqual(Array.from(result.rows,row=>row.status),['pinned','not pinned']);assert.equal(result.rows[0].domConversationsBeforeMenu,2);assert.equal(result.rows[0].domConversationsAfterCleanup,3);assert.equal(result.rows[1].domConversationsBeforeMenu,3);assert.equal(result.stopReason,'first_not_pinned');assert.equal(dom.openCount,2);
 assert.equal(JSON.stringify(result).includes('added-after-snapshot'),false);
});

test('v5.0 snapshot expands from eight to twelve, preserves classified rows, and finds a newly loaded first non-pinned row',async()=>{
 const dom=visiblePinnedRowsDocument(Array.from({length:8},()=>['Unpin chat']),{includeProject:false,onOpen:(index,append)=>{
  if(index===0)for(const [offset,labels] of [['Pin chat'],['Unpin chat'],['Unpin chat'],['Unpin chat']].entries())append(labels,8+offset);
 }});
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20});
 assert.equal(result.initialSnapshotCount,8);assert.equal(result.finalSnapshotCount,12);assert.equal(result.prefixSnapshotCount,12);assert.equal(result.snapshotExpansionCount,1);
 assert.equal(result.rowsAttempted,9,JSON.stringify(result));assert.deepEqual(Array.from(result.rows,row=>row.status),Array(8).fill('pinned').concat(['not pinned']),JSON.stringify(result));
 assert.equal(result.firstNotPinnedFound,true);assert.equal(result.pinnedPrefixStatus,'pinned_prefix_complete');assert.equal(result.pinnedPrefixReason,'first_not_pinned');
 assert.deepEqual(Array.from(result.rows,row=>[row.domConversationsBeforeMenu,row.domConversationsAfterCleanup]),[[8,12],[12,12],[12,12],[12,12],[12,12],[12,12],[12,12],[12,12],[12,12]]);
 assert.equal(dom.openCount,9);assert.equal(dom.closeCount,9);assert.equal(dom.activeMenu,null);assert.equal(dom.actionClicks,0);
 const json=JSON.stringify(result);for(const secret of ['private-chat-','PRIVATE MENU CONTENT','href','title'])assert.equal(json.includes(secret),false);
});

test('v5.0 already classified IDs are not reopened after reconciliation',async()=>{
 let appendOnce=false;const dom=visiblePinnedRowsDocument([['Unpin chat'],['Unpin chat'],['Pin chat']],{includeProject:false,onOpen:(index,append)=>{
  if(index===0&&!appendOnce){appendOnce=true;append(['Unpin chat'],3);}
 }});
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20});
 assert.equal(result.initialSnapshotCount,3);assert.equal(result.finalSnapshotCount,4);assert.equal(result.snapshotExpansionCount,1);
 assert.deepEqual(Array.from(result.rows,row=>row.status),['pinned','pinned','not pinned']);assert.equal(result.rowsAttempted,3);assert.equal(dom.openCount,3);
});

test('v5.0 repeated snapshot growth stops after three expansions with an exact reason',async()=>{
 const dom=visiblePinnedRowsDocument(Array.from({length:4},()=>['Unpin chat']),{includeProject:false,onOpen:(index,append)=>append(['Unpin chat'],index+4)});
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20});
 assert.equal(result.snapshotExpansionCount,3);assert.equal(result.finalSnapshotCount,8);assert.equal(result.pinnedPrefixStatus,'pinned_prefix_unproven');
 assert.equal(result.stopReason,'sidebar_snapshot_unstable');assert.equal(result.pinnedPrefixReason,'sidebar_snapshot_unstable');assert.equal(result.firstNotPinnedFound,false);assert.equal(dom.openCount,4);
});

test('v5.73 isolated pinned activity fully classifies stable snapshots of 20, 21, and more than 20 rows within a row-derived budget',async()=>{
 for(const count of [20,21,25]){
  const labels=Array.from({length:count},(_,index)=>index===count-1?['Pin chat']:['Unpin chat']);
  const dom=visiblePinnedRowsDocument(labels,{includeProject:false}),x=setup(dom.document);
  dom.nav.clientHeight=2048;dom.nav.scrollHeight=2048;dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:2048,width:320,height:2048});
  x.window.innerWidth=1024;x.window.innerHeight=2400;x.window.gptPinnedActivityDiagnosticToken='bounded-snapshot';
  x.window.gptResolvePinnedRecords=ids=>ids.map(conversationId=>({conversationId,lastActivityAt:1700000000000,activitySource:'conversation_update_time'}));
  const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20,hardTimeoutMs:40000,includePinnedRecords:true,activityDiagnosticToken:'bounded-snapshot'});
  assert.equal(result.initialSnapshotCount,count,JSON.stringify({count,status:result.readiness,top:result.sidebarTop,reason:result.stopReason,preflight:result.preflight}));assert.equal(result.finalSnapshotCount,count);assert.equal(result.rowsInspected,count);
  assert.ok(result.traversalBudget>=count&&result.traversalBudget<=result.absoluteSnapshotSafetyCap);assert.equal(result.absoluteSnapshotSafetyCap,32);
  assert.equal(result.traversalBudgetMs,Math.min(90000,Math.max(15000,5000+count*2500)));
  assert.equal(result.cleanupReserveMs,10000);
  assert.equal(result.pinnedCount,count-1,JSON.stringify({count,statuses:result.rows.map(row=>[row.row,row.status,row.reason]),stopReason:result.stopReason}));assert.equal(result.notPinnedCount,1);assert.equal(result.unknownCount,0);
  assert.equal(result.firstNotPinnedFound,true);assert.equal(result.pinnedPrefixStatus,'pinned_prefix_complete');assert.equal(result.pinnedPrefixReason,'first_not_pinned');
  assert.equal(result.timestampDispatch.allowed,true);assert.equal(result.timestampStage,'started');assert.equal(dom.openCount,count);assert.equal(dom.closeCount,count);
  assert.equal(result.rows.every(row=>row.status==='pinned'||row.status==='not pinned'||(row.status==='unknown'&&row.reason)),true);
 }
});

test('isolated pinned activity fails distinctly above the absolute snapshot cap without opening menus',async()=>{
 const dom=visiblePinnedRowsDocument(Array.from({length:33},()=>['Unpin chat']),{includeProject:false}),x=setup(dom.document);
 dom.nav.clientHeight=2048;dom.nav.scrollHeight=2048;dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:2048,width:320,height:2048});
 x.window.innerWidth=1024;x.window.innerHeight=2400;x.window.gptPinnedActivityDiagnosticToken='over-cap';
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20,includePinnedRecords:true,activityDiagnosticToken:'over-cap'});
 assert.equal(result.initialSnapshotCount,33);assert.equal(result.absoluteSnapshotSafetyCap,32);assert.equal(result.stopReason,'snapshot_exceeds_traversal_cap');
 assert.equal(result.pinnedPrefixReason,'snapshot_exceeds_traversal_cap');assert.equal(result.rowsInspected,0);assert.equal(dom.openCount,0);
});

test('isolated traversal still reports real stable-snapshot growth as sidebar_snapshot_unstable',async()=>{
 let appended=0;
 const dom=visiblePinnedRowsDocument(Array.from({length:4},()=>['Unpin chat']),{includeProject:false,onOpen:(index,append)=>{if(appended<4){appended++;append(['Unpin chat'],4+appended);}}});
 dom.nav.clientHeight=1200;dom.nav.scrollHeight=1200;dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:1200,width:320,height:1200});
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=1400;x.window.gptPinnedActivityDiagnosticToken='changing-snapshot';
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20,includePinnedRecords:true,activityDiagnosticToken:'changing-snapshot'});
 assert.equal(result.snapshotExpansionCount,3);assert.equal(result.stopReason,'sidebar_snapshot_unstable');assert.equal(result.pinnedPrefixStatus,'pinned_prefix_unproven');assert.equal(dom.openCount,4);
});

test('production snapshot trace keeps geometry, scroll and menu changes out of semantic fingerprints',async()=>{
 let dom;const labels=[['Unpin chat'],['Pin chat']];
 dom=visiblePinnedRowsDocument(labels,{includeProject:false,onOpen:index=>{if(index===0){dom.nav.scrollTop=3;dom.rows[1].anchor.getBoundingClientRect=()=>({x:12,y:91,width:220,height:34,left:12,top:91,right:232,bottom:125});}}});
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;x.window.gptListCycleConfig={token:'snapshot-geometry'};
 const result=await x.window.gptInspectVisiblePinnedRows({cycleToken:'snapshot-geometry'}),trace=result.snapshotTrace;
 assert.ok(trace?.baseline);assert.equal(trace.baseline.identityCount,2);assert.equal(trace.firstChange,null);
 assert.ok(trace.stages.some(stage=>stage.stage==='before_top_proof'));assert.ok(trace.stages.some(stage=>stage.stage==='after_top_proof'));
 assert.ok(trace.stages.some(stage=>stage.stage==='before_row_1'));assert.ok(trace.stages.some(stage=>stage.stage==='after_menu_cleanup_row_1'));
 assert.ok(trace.stages.every(stage=>stage.setFingerprint===trace.baseline.setFingerprint&&stage.orderFingerprint===trace.baseline.orderFingerprint));
 assert.equal(result.pinnedPrefixStatus,'pinned_prefix_complete');assert.equal(JSON.stringify(trace).includes('private-chat-'),false);
});

test('production pinned-prefix stops at the first added identity after menu classification with a sanitized delta',async()=>{
 let dom;dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{includeProject:false,onOpen:(index,append)=>{if(index===0)append(['Pin chat'],2);}});
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;x.window.gptListCycleConfig={token:'snapshot-add'};
 const result=await x.window.gptInspectVisiblePinnedRows({cycleToken:'snapshot-add'}),change=result.snapshotTrace?.firstChange;
 assert.equal(result.stopReason,'sidebar_snapshot_unstable');assert.equal(result.rowsInspected,1);
 assert.equal(change.stage,'after_menu_cleanup_row_1');assert.equal(change.precedingAction,'menu_classification_and_cleanup');
 assert.equal(change.previousIdentityCount,2);assert.equal(change.currentIdentityCount,3);assert.equal(change.setChanged,true);assert.equal(change.orderChanged,true);assert.equal(change.addedCount,1);assert.equal(change.removedCount,0);assert.equal(change.reordered,false);
 assert.equal(JSON.stringify(result.snapshotTrace).includes('private-chat-'),false);
});

 test('production pinned-prefix distinguishes reorder from identity-set changes at the first affected stage',async()=>{
 let dom;dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{includeProject:false,onOpen:index=>{if(index===0)dom.nav.children.reverse();}});
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;x.window.gptListCycleConfig={token:'snapshot-order'};
 const result=await x.window.gptInspectVisiblePinnedRows({cycleToken:'snapshot-order'}),change=result.snapshotTrace?.firstChange;
 assert.equal(result.stopReason,'sidebar_snapshot_unstable');assert.equal(change.stage,'after_menu_cleanup_row_1');
 assert.equal(change.setChanged,false);assert.equal(change.orderChanged,true);assert.equal(change.addedCount,0);assert.equal(change.removedCount,0);assert.equal(change.reordered,true);
});

test('isolated and production pinned-prefix paths use the same sanitized semantic set/order fingerprints',async()=>{
 const labels=[['Unpin chat'],['Unpin chat'],['Pin chat']];
 const productionDOM=visiblePinnedRowsDocument(labels,{includeProject:false}),production=setup(productionDOM.document);production.window.innerWidth=1024;production.window.innerHeight=768;production.window.gptListCycleConfig={token:'same-snapshot'};
 const productionResult=await production.window.gptInspectVisiblePinnedRows({cycleToken:'same-snapshot'});
 const isolatedDOM=visiblePinnedRowsDocument(labels,{includeProject:false}),isolated=setup(isolatedDOM.document);isolated.window.innerWidth=1024;isolated.window.innerHeight=768;isolated.window.gptPinnedActivityDiagnosticToken='isolated-same-snapshot';isolated.window.gptResolvePinnedRecords=ids=>ids.map(conversationId=>({conversationId,lastActivityAt:1700000000000,activitySource:'conversation_update_time'}));
 const isolatedResult=await isolated.window.gptInspectVisiblePinnedRows({maxRows:20,includePinnedRecords:true,activityDiagnosticToken:'isolated-same-snapshot'});
 assert.equal(productionResult.snapshotTrace.baseline.setFingerprint,isolatedResult.snapshotTrace.baseline.setFingerprint);
 assert.equal(productionResult.snapshotTrace.baseline.orderFingerprint,isolatedResult.snapshotTrace.baseline.orderFingerprint);
 assert.equal(isolatedResult.snapshotTrace.firstChange,null);assert.equal(isolatedResult.pinnedPrefixStatus,'pinned_prefix_complete');
});

test('production traversal budget covers the full accepted snapshot up to the absolute cap',async()=>{
 for(const snapshotRows of [20,21,30,32]){
  const labels=Array.from({length:snapshotRows},(_,index)=>index===snapshotRows-1?['Pin chat']:['Unpin chat']);
  const dom=visiblePinnedRowsDocument(labels,{includeProject:false}),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=6000;
  dom.nav.clientHeight=5000;dom.nav.scrollHeight=5000;dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:5000,width:320,height:5000});
  x.window.gptListCycleConfig={token:`production-budget-${snapshotRows}`};
  const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20,cycleToken:`production-budget-${snapshotRows}`}),capacity=result.traversalCapacity;
  assert.equal(result.initialSnapshotCount,snapshotRows);assert.equal(capacity.snapshotRows,snapshotRows);assert.equal(capacity.requiredTraversalRows,snapshotRows);
  assert.ok(capacity.selectedBudget>=snapshotRows,JSON.stringify(capacity));assert.equal(capacity.absoluteCap,32);assert.equal(capacity.budgetSufficient,true);
  assert.equal(result.rowsInspected,snapshotRows,`snapshot ${snapshotRows}: ${result.stopReason}`);assert.equal(result.traversalTerminal.processedCount,snapshotRows);
  assert.equal(result.pinnedPrefixStatus,'pinned_prefix_complete');assert.equal(result.pinnedCount,snapshotRows-1);assert.equal(result.notPinnedCount,1);assert.equal(result.unknownCount,0);
 }
});

test('production traversal rejects cap plus one in preflight before classifying any row',async()=>{
 const overCapLabels=Array.from({length:33},(_,index)=>index===32?['Pin chat']:['Unpin chat']);
 const dom=visiblePinnedRowsDocument(overCapLabels,{includeProject:false}),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=6000;
 dom.nav.clientHeight=5000;dom.nav.scrollHeight=5000;dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:5000,width:320,height:5000});
 x.window.gptListCycleConfig={token:'production-over-cap'};
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20,cycleToken:'production-over-cap'}),terminal=result.traversalTerminal,capacity=result.traversalCapacity;
 assert.equal(result.initialSnapshotCount,33);assert.equal(capacity.snapshotRows,33);assert.equal(capacity.requiredTraversalRows,33);assert.equal(capacity.selectedBudget,32);assert.equal(capacity.absoluteCap,32);assert.equal(capacity.budgetSufficient,false);
 assert.equal(result.rowsInspected,0);assert.equal(result.rows.length,0);assert.equal(result.processedCount,undefined);assert.equal(result.pinnedCount,0);assert.equal(result.pinnedPrefixStatus,'pinned_prefix_unproven');
 assert.equal(result.stopReason,'snapshot_exceeds_traversal_cap');assert.equal(result.pinnedPrefixReason,'snapshot_exceeds_traversal_cap');
 assert.equal(terminal.stage,'snapshot_preflight');assert.equal(terminal.internalReason,'snapshot_exceeds_traversal_cap');
 assert.equal(terminal.lastCompletedStage,'after_top_proof');assert.equal(terminal.rowIndex,0);assert.equal(terminal.processedCount,0);assert.equal(terminal.semanticSnapshotValid,true);
 assert.equal(terminal.scrollAttempted,false);assert.equal(terminal.menuCleanupResult,'not_run');assert.equal(terminal.leaseValid,true);
 assert.equal(result.snapshotTrace.firstChange,null);assert.equal(dom.openCount,0);
 assert.equal(JSON.stringify(terminal).includes('private-chat-'),false);
});

test('production semantic changes retain sidebar_snapshot_unstable with the first terminal stage',async()=>{
 let dom;dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{includeProject:false,onOpen:(index,append)=>{if(index===0)append(['Pin chat'],2);}});
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;x.window.gptListCycleConfig={token:'production-semantic-change'};
 const result=await x.window.gptInspectVisiblePinnedRows({cycleToken:'production-semantic-change'}),terminal=result.traversalTerminal;
 assert.equal(result.stopReason,'sidebar_snapshot_unstable');assert.equal(result.snapshotTrace.firstChange.stage,'after_menu_cleanup_row_1');
 assert.equal(terminal.stage,'after_menu_cleanup_row_1');assert.equal(terminal.internalReason,'sidebar_snapshot_unstable');
 assert.equal(terminal.lastCompletedStage,'before_row_1');
 assert.equal(terminal.semanticSnapshotValid,false);assert.equal(terminal.processedCount,1);assert.equal(terminal.menuCleanupResult,'success');
});

test('isolated traversal timeout preserves classified counters and the exact traversal timeout reason',async()=>{
 let fastForward=false;const progress=[],now=()=>Date.now()+(fastForward?20000:0);
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{includeProject:false,onOpen:()=>{fastForward=true;}}),x=setup(dom.document,setTimeout,now);
 dom.nav.clientHeight=1200;dom.nav.scrollHeight=1200;dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:1200,width:320,height:1200});
 x.window.innerWidth=1024;x.window.innerHeight=1400;x.window.gptPinnedActivityDiagnosticToken='traversal-timeout';
 x.window.webkit={messageHandlers:{starredDiagnostic:{postMessage:payload=>progress.push(payload.pinnedActivityProgress)}}};
 x.window.gptResolvePinnedRecords=ids=>ids.map(conversationId=>({conversationId,lastActivityAt:1700000000000,activitySource:'conversation_update_time'}));
 try{
  const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20,hardTimeoutMs:40000,includePinnedRecords:true,activityDiagnosticToken:'traversal-timeout'});
  assert.equal(result.stopReason,'traversal_timeout',JSON.stringify({fastForward,rows:result.rows,reason:result.pinnedPrefixReason,progress}));assert.equal(result.rowsInspected,1);
  assert.equal(result.pinnedCount,1);assert.equal(result.notPinnedCount,0);assert.equal(result.unknownCount,0);
  assert.equal(result.firstNotPinnedFound,false);assert.equal(result.timestampDispatch.allowed,false);
  const rowProgress=progress.find(event=>event?.stage==='row_classified');
  assert.equal(rowProgress.processedRows,1);assert.equal(rowProgress.pinnedCount,1);assert.equal(rowProgress.ordinaryCount,0);assert.equal(rowProgress.unknownCount,0);assert.equal(rowProgress.firstOrdinaryFound,false);
  assert.equal(result.rows[0].status,'pinned');
  assert.ok(result.traversalBudgetMs>=15000&&result.traversalBudgetMs<=90000);assert.equal(result.cleanupReserveMs,10000);
 } finally {fastForward=false;}
});

test('isolated menu cleanup uses a distinct lifecycle and trigger fallback when Escape is ignored',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{includeProject:false,escapeCloses:false,triggerClickCloses:true}),x=setup(dom.document);
 dom.nav.clientHeight=1200;dom.nav.scrollHeight=1200;dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:1200,width:320,height:1200});
 x.window.innerWidth=1024;x.window.innerHeight=1400;x.window.gptPinnedActivityDiagnosticToken='menu-fallback';
 const stages=[];x.window.webkit.messageHandlers.starredDiagnostic.postMessage=payload=>stages.push(payload.pinnedActivityProgress?.stage);
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20,hardTimeoutMs:40000,includePinnedRecords:true,activityDiagnosticToken:'menu-fallback'});
 assert.equal(result.stopReason,'first_not_pinned');assert.equal(result.pinnedPrefixStatus,'pinned_prefix_complete');
 assert.deepEqual(Array.from(result.rows,row=>row.status),['pinned','not pinned']);assert.equal(result.cleanupSuccessful,true);
 assert.equal(dom.openCount,2);assert.equal(dom.closeCount,2);assert.equal(dom.activeMenu,null);assert.equal(dom.actionClicks,0);
 assert.equal(stages.filter(stage=>stage==='menu_cleanup_started').length,2);assert.equal(stages.filter(stage=>stage==='menu_cleanup_completed').length,2);
 assert.deepEqual(Array.from(result.rows[0].cleanupAttempts,attempt=>attempt.method),['Escape','trigger_toggle']);
 assert.equal(result.rows[0].cleanupAttempts[0].terminalReason,'escape_ignored');assert.equal(result.rows[0].cleanupAttempts[1].menuVisibleAfter,false);
 assert.equal(result.rows[0].cleanupTerminalReason,'none');
 assert.equal(stages.at(-1),'cleanup_completed');
});

test('isolated cleanup treats an already-disappeared target menu as closed without waiting for another callback',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat']],{includeProject:false,escapeCloses:true}),x=setup(dom.document);
 dom.nav.clientHeight=1200;dom.nav.scrollHeight=1200;dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:1200,width:320,height:1200});
 x.window.innerWidth=1024;x.window.innerHeight=1400;x.window.gptPinnedActivityDiagnosticToken='menu-disappeared';
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20,hardTimeoutMs:40000,includePinnedRecords:true,activityDiagnosticToken:'menu-disappeared'});
 assert.equal(result.rows[0].menuClosed,true);assert.equal(result.rows[0].cleanupAttempts.length,1);
 assert.equal(result.rows[0].cleanupAttempts[0].method,'Escape');assert.equal(result.rows[0].cleanupAttempts[0].menuVisibleAfter,false);
 assert.equal(result.rows[0].cleanupTerminalReason,'none');assert.equal(result.cleanupSuccessful,true);
});

test('isolated cleanup re-resolves the current row and reports replacement instead of waiting on a detached trigger',async()=>{
 let dom;dom=visiblePinnedRowsDocument([['Unpin chat']],{includeProject:false,escapeCloses:false,onOpen:index=>{
  const trigger=dom.rows[index].trigger;trigger.isConnected=false;dom.rows[index].row.children=dom.rows[index].row.children.filter(child=>child!==trigger);
 }});const x=setup(dom.document);
 dom.nav.clientHeight=1200;dom.nav.scrollHeight=1200;dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:1200,width:320,height:1200});
 x.window.innerWidth=1024;x.window.innerHeight=1400;x.window.gptPinnedActivityDiagnosticToken='row-replaced-cleanup';
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20,hardTimeoutMs:40000,includePinnedRecords:true,activityDiagnosticToken:'row-replaced-cleanup'});
 assert.equal(result.stopReason,'menu_cleanup_failed');assert.equal(result.rows[0].status,'pinned');assert.equal(result.rows[0].menuClosed,false);
 assert.equal(result.rows[0].cleanupTerminalReason,'row_replaced_during_cleanup');assert.equal(result.rows[0].cleanupAttempts[0].triggerConnected,false);
 assert.equal(result.rowsInspected,1);assert.equal(result.timestampDispatch.allowed,false);
});

test('isolated menu cleanup failure preserves classified progress and cannot claim prefix proof',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{includeProject:false,escapeCloses:false}),x=setup(dom.document);
 dom.nav.clientHeight=1200;dom.nav.scrollHeight=1200;dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:1200,width:320,height:1200});
 x.window.innerWidth=1024;x.window.innerHeight=1400;x.window.gptPinnedActivityDiagnosticToken='menu-failure';
 const progress=[];x.window.webkit.messageHandlers.starredDiagnostic.postMessage=payload=>progress.push(payload.pinnedActivityProgress);
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20,hardTimeoutMs:40000,includePinnedRecords:true,activityDiagnosticToken:'menu-failure'});
 assert.equal(result.stopReason,'menu_cleanup_failed');assert.equal(result.pinnedPrefixStatus,'pinned_prefix_unproven');
 assert.equal(result.rowsInspected,1);assert.equal(result.pinnedCount,1);assert.equal(result.unknownCount,0);
 assert.equal(result.rows[0].status,'pinned');assert.equal(result.rows[0].menuClosed,false);assert.equal(result.timestampDispatch.allowed,false);
 assert.equal(result.rows[0].cleanupTerminalReason,'trigger_click_ignored');
 assert.deepEqual(Array.from(result.rows[0].cleanupAttempts,attempt=>attempt.method),['Escape','trigger_toggle']);
 assert.equal(dom.openCount,1);assert.equal(dom.actionClicks,0);
 const cleanupProgress=progress.find(event=>event?.stage==='menu_cleanup_started');assert.equal(cleanupProgress.processedRows,1);assert.equal(cleanupProgress.pinnedCount,1);
 assert.equal(progress.some(event=>event?.stage==='cleanup_started'&&event?.row===1),false);
});

test('v5.15 scrolls a pending offscreen row into view, classifies it, and restores the initial sidebar position',async()=>{
 const dom=makePinnedRowsPartiallyVisible(visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{includeProject:false}),60),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:5});
 assert.equal(result.sidebarTop.proof,'top_proven');assert.equal(result.initialSnapshotCount,2);
 assert.deepEqual(Array.from(result.rows,row=>row.status),['pinned','not pinned'],JSON.stringify(result.rows));
 assert.equal(result.scrollUsed,true);assert.equal(result.scrolledRowIndex,2);assert.equal(result.rowVisibleAfterScroll,true);
 assert.equal(result.rows[1].scrolledIntoView,true);assert.equal(result.stopReason,'first_not_pinned');
 assert.equal(result.scrollRestoreSuccessful,true);assert.equal(dom.nav.scrollTop,0);assert.equal(result.cleanupSuccessful,true);
 assert.equal(dom.openCount,2);assert.equal(dom.closeCount,2);
});

test('v5.15 scroll-triggered lazy growth reconciles the snapshot without repeating classified rows',async()=>{
 let grew=false;const base=visiblePinnedRowsDocument([['Unpin chat'],['Unpin chat']],{includeProject:false,onOpen:index=>{if(index===0&&!grew){grew=true;base.appendConversation(['Pin chat'],2);}}});
 const dom=makePinnedRowsPartiallyVisible(base,60),x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:5});
 assert.equal(result.sidebarTop.proof,'top_proven');assert.equal(result.initialSnapshotCount,2);assert.equal(result.finalSnapshotCount,3);assert.equal(result.snapshotExpansionCount,1);
 assert.deepEqual(Array.from(result.rows,row=>row.status),['pinned','pinned','not pinned']);assert.equal(result.rowsAttempted,3);
 assert.deepEqual(Array.from(result.rows,row=>row.row),[1,2,3]);assert.equal(result.stopReason,'first_not_pinned');
 assert.equal(result.scrollUsed,true);assert.equal(result.scrolledRowIndex,3);assert.equal(result.scrollRestoreSuccessful,true);assert.equal(dom.nav.scrollTop,0);
});

test('v5.15 reports scroll failure and missing scroll container distinctly',async()=>{
 const failed=makePinnedRowsPartiallyVisible(visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{includeProject:false}),60,{scrollFails:true}),x=setup(failed.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 const failedResult=await x.window.gptInspectVisiblePinnedRows();assert.equal(failedResult.rows[1].reason,'scroll_did_not_move');assert.equal(failedResult.pinnedPrefixStatus,'pinned_prefix_unproven');assert.equal(failedResult.scrollUsed,false);
 const noScroller=makePinnedRowsPartiallyVisible(visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{includeProject:false}),60);noScroller.nav.scrollHeight=noScroller.nav.clientHeight;
 const y=setup(noScroller.document);y.window.innerWidth=1024;y.window.innerHeight=768;
 const noScrollerResult=await y.window.gptInspectVisiblePinnedRows();assert.equal(noScrollerResult.rows[1].reason,'scroll_owner_missing');assert.equal(noScrollerResult.scrollUsed,false);
});

test('pinned-prefix resolves a stable sidebar ancestor scroll owner and reaches rows below the initial viewport',async()=>{
 const labels=Array.from({length:8},(_,index)=>index===7?['Pin chat']:['Unpin chat']);
 const dom=visiblePinnedRowsDocument(labels,{includeProject:false});dom.nav.clientHeight=60;dom.nav.scrollHeight=60;
 dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60});
 const owner={tagName:'DIV',parentElement:null,scrollTop:0,clientHeight:60,scrollHeight:480,isConnected:true,
  getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60})};
 dom.nav.parentElement=owner;
 for(const [index,item] of dom.rows.entries())for(const node of [item.row,item.anchor,item.trigger])node.getBoundingClientRect=()=>{
  const x=node===item.trigger?270:node===item.anchor?8:0,w=node===item.trigger?20:node===item.anchor?230:320,h=node===item.trigger?20:36,y=index*60-(Number(owner.scrollTop)||0);
  return {x,y,width:w,height:h,left:x,top:y,right:x+w,bottom:y+h};
 };
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;x.window.gptPinnedActivityDiagnosticToken='outer-sidebar-scroll-owner';
 const mechanics=await x.window.gptInspectSidebarScrollMechanics({operationToken:'shared-owner',readiness:{ready:true,status:'snapshot_ready',root:dom.nav,finalCount:8,identityCount:8}});
 assert.equal(mechanics.candidateCount,1);assert.equal(mechanics.candidates[0].tag,'div');
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20,includePinnedRecords:true,activityDiagnosticToken:'outer-sidebar-scroll-owner'});
 assert.equal(result.scrollContainerFound,true);assert.equal(result.scrollOwner.tag,'div');assert.equal(result.scrollOwner.clientHeight,60);assert.equal(result.scrollOwner.scrollHeight,480);
 assert.equal(result.scrollOwnerCandidateCount,1);assert.equal(result.scrollOwnerReason,'unique_owner');
 assert.equal(result.scrollUsed,true);assert.equal(result.scrollRestoreSuccessful,true);assert.equal(owner.scrollTop,0);
 assert.equal(result.scrollPosition.initial,0);assert.ok(result.scrollPosition.maximumReached>0);assert.equal(result.scrollPosition.maximumCapacity,420);assert.equal(result.scrollPosition.restored,0);
 const lastRowScroll=result.scrollAttempts.find(attempt=>attempt.rowIndex===8);assert.ok(lastRowScroll);
 assert.equal(lastRowScroll.rowReResolved,true);assert.equal(lastRowScroll.correctiveAttempt,false);
 assert.ok(lastRowScroll.calculatedDelta>0);assert.equal(lastRowScroll.clampedTargetScrollTop,lastRowScroll.requestedTargetScrollTop);
 assert.equal(lastRowScroll.actualScrollTopAfter,lastRowScroll.clampedTargetScrollTop);assert.equal(lastRowScroll.intersectsViewport,true);
 assert.deepEqual(Array.from(result.rows,row=>row.status),['pinned','pinned','pinned','pinned','pinned','pinned','pinned','not pinned']);
 assert.equal(result.rows[7].scrolledIntoView,true);assert.equal(result.rows[7].rowReplacedDuringScroll,false);
 assert.equal(result.firstNotPinnedFound,true);assert.equal(result.pinnedPrefixStatus,'pinned_prefix_complete');
});

test('isolated pinned-prefix makes at most one corrective scroll after re-resolving an incompletely reached row',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Unpin chat'],['Pin chat']],{includeProject:false});dom.nav.clientHeight=60;dom.nav.scrollHeight=60;
 dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60});
 let position=0,sets=0;const owner={tagName:'DIV',parentElement:null,clientHeight:60,scrollHeight:240,isConnected:true,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60})};
 Object.defineProperty(owner,'scrollTop',{configurable:true,get:()=>position,set:value=>{if(Number(value)>0){sets++;position=sets===1?Math.min(Number(value),50):Number(value);}else position=0;}});dom.nav.parentElement=owner;
 for(const [index,item] of dom.rows.entries())for(const node of [item.row,item.anchor,item.trigger])node.getBoundingClientRect=()=>{const x=node===item.trigger?270:node===item.anchor?8:0,w=node===item.trigger?20:node===item.anchor?230:320,h=20,y=(index<2?index*20:120)-(Number(owner.scrollTop)||0);return {x,y,width:w,height:h,left:x,top:y,right:x+w,bottom:y+h};};
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;const token='corrective-scroll';x.window.gptPinnedActivityDiagnosticToken=token;
 const result=await x.window.gptInspectVisiblePinnedRows({includePinnedRecords:true,activityDiagnosticToken:token});
 const attempts=result.scrollAttempts.filter(attempt=>attempt.rowIndex===3);
 assert.equal(attempts.length,2);assert.equal(attempts[0].correctiveAttempt,false);assert.equal(attempts[0].actualScrollTopAfter,50);
 assert.equal(attempts[1].correctiveAttempt,true);assert.equal(attempts[1].ownerScrollTopBefore,50);assert.equal(attempts[1].rowReResolved,true);
 assert.equal(attempts[1].intersectsViewport,true);assert.equal(result.rows[2].status,'not pinned');assert.equal(result.scrollRestoreSuccessful,true);assert.equal(owner.scrollTop,0);
});

test('isolated scroll telemetry records owner-coordinate deltas, clamps at max, and preserves restoration on failure',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Unpin chat'],['Pin chat']],{includeProject:false});dom.nav.clientHeight=60;dom.nav.scrollHeight=60;
 dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60});
 let position=0;const owner={tagName:'DIV',parentElement:null,clientHeight:60,scrollHeight:90,isConnected:true,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60})};
 Object.defineProperty(owner,'scrollTop',{configurable:true,get:()=>position,set:value=>{position=Math.max(0,Math.min(30,Number(value)));}});dom.nav.parentElement=owner;
 for(const [index,item] of dom.rows.entries())for(const node of [item.row,item.anchor,item.trigger])node.getBoundingClientRect=()=>{const x=node===item.trigger?270:node===item.anchor?8:0,w=node===item.trigger?20:node===item.anchor?230:320,h=20,y=(index<2?index*20:120)-(Number(owner.scrollTop)||0);return {x,y,width:w,height:h,left:x,top:y,right:x+w,bottom:y+h};};
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;const token='clamped-scroll';x.window.gptPinnedActivityDiagnosticToken=token;
 const result=await x.window.gptInspectVisiblePinnedRows({includePinnedRecords:true,activityDiagnosticToken:token});
 const attempt=result.scrollAttempts.find(item=>item.rowIndex===3);assert.ok(attempt);
 assert.ok(attempt.calculatedDelta>0);assert.equal(attempt.maximumPossibleScrollTop,30);assert.equal(attempt.clampedTargetScrollTop,30);assert.equal(attempt.actualScrollTopAfter,30);
 assert.equal(attempt.rowReResolved,true);assert.equal(attempt.intersectsViewport,false);assert.equal(result.rows[2].reason,'row_not_reached_after_scroll');
 assert.equal(result.scrollPosition.initial,0);assert.equal(result.scrollPosition.maximumReached,30);assert.equal(result.scrollPosition.restored,0);assert.equal(result.scrollRestoreSuccessful,true);assert.equal(owner.scrollTop,0);
 assert.equal(JSON.stringify(result.scrollAttempts).includes('conversation-'),false);
});

test('isolated scroll telemetry calculates a negative owner-coordinate delta for a row above the viewport',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{includeProject:false});dom.nav.clientHeight=60;dom.nav.scrollHeight=60;
 dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60});
 const owner={tagName:'DIV',parentElement:null,scrollTop:0,clientHeight:60,scrollHeight:180,isConnected:true,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60})};dom.nav.parentElement=owner;
 for(const [index,item] of dom.rows.entries())for(const node of [item.row,item.anchor,item.trigger])node.getBoundingClientRect=()=>{const x=node===item.trigger?270:node===item.anchor?8:0,w=node===item.trigger?20:node===item.anchor?230:320,h=36,y=(index===0?0:-40)-(Number(owner.scrollTop)||0);return {x,y,width:w,height:h,left:x,top:y,right:x+w,bottom:y+h};};
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;const token='negative-scroll';x.window.gptPinnedActivityDiagnosticToken=token;
 const result=await x.window.gptInspectVisiblePinnedRows({includePinnedRecords:true,activityDiagnosticToken:token});
 const attempt=result.scrollAttempts.find(item=>item.rowIndex===2);assert.ok(attempt);assert.ok(attempt.calculatedDelta<0);assert.equal(attempt.requestedTargetScrollTop<0,true);assert.equal(attempt.clampedTargetScrollTop,0);
 assert.equal(attempt.actualScrollTopAfter,0);assert.equal(attempt.rowReResolved,true);assert.equal(result.rows[1].reason,'scroll_did_not_move');assert.equal(owner.scrollTop,0);
});

test('isolated pinned-prefix stops as unknown after one bounded corrective scroll still misses the row',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Unpin chat'],['Pin chat']],{includeProject:false});dom.nav.clientHeight=60;dom.nav.scrollHeight=60;
 dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60});
 let position=0,sets=0;const owner={tagName:'DIV',parentElement:null,clientHeight:60,scrollHeight:90,isConnected:true,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60})};
 Object.defineProperty(owner,'scrollTop',{configurable:true,get:()=>position,set:value=>{if(Number(value)>0){sets++;position=Math.min(Number(value),sets===1?15:30);}else position=0;}});dom.nav.parentElement=owner;
 for(const [index,item] of dom.rows.entries())for(const node of [item.row,item.anchor,item.trigger])node.getBoundingClientRect=()=>{const x=node===item.trigger?270:node===item.anchor?8:0,w=node===item.trigger?20:node===item.anchor?230:320,h=20,y=(index<2?index*20:120)-(Number(owner.scrollTop)||0);return {x,y,width:w,height:h,left:x,top:y,right:x+w,bottom:y+h};};
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;const token='bounded-corrective-failure';x.window.gptPinnedActivityDiagnosticToken=token;
 const result=await x.window.gptInspectVisiblePinnedRows({includePinnedRecords:true,activityDiagnosticToken:token});
 const attempts=result.scrollAttempts.filter(attempt=>attempt.rowIndex===3);assert.equal(attempts.length,2);assert.equal(attempts[1].correctiveAttempt,true);
 assert.equal(attempts[1].actualScrollTopAfter,30);assert.equal(attempts[1].intersectsViewport,false);assert.equal(result.rows[2].reason,'row_not_reached_after_scroll');
 assert.equal(result.scrollRestoreSuccessful,true);assert.equal(owner.scrollTop,0);
});

test('isolated pinned-prefix stops on identity-set or order changes during a bounded scroll',async()=>{
 for(const change of ['identity_set','identity_order']){
  const labels=Array.from({length:3},(_,index)=>index===2?['Pin chat']:['Unpin chat']);
  const dom=visiblePinnedRowsDocument(labels,{includeProject:false});dom.nav.clientHeight=60;dom.nav.scrollHeight=60;
  dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60});
  let position=0,changed=false;
  const owner={tagName:'DIV',parentElement:null,clientHeight:60,scrollHeight:240,isConnected:true,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60})};
  Object.defineProperty(owner,'scrollTop',{configurable:true,get:()=>position,set:value=>{position=value;if(value>0&&!changed){changed=true;if(change==='identity_set')dom.appendConversation(['Pin chat'],3);else dom.nav.children.reverse();}}});
  dom.nav.parentElement=owner;
  for(const [index,item] of dom.rows.entries())for(const node of [item.row,item.anchor,item.trigger])node.getBoundingClientRect=()=>{const x=node===item.trigger?270:node===item.anchor?8:0,w=node===item.trigger?20:node===item.anchor?230:320,h=node===item.trigger?20:36,y=index*60-(Number(owner.scrollTop)||0);return {x,y,width:w,height:h,left:x,top:y,right:x+w,bottom:y+h};};
  const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;const token=`topology-${change}`;x.window.gptPinnedActivityDiagnosticToken=token;
  const result=await x.window.gptInspectVisiblePinnedRows({maxRows:20,includePinnedRecords:true,activityDiagnosticToken:token});
  assert.equal(result.rows[1]?.reason,change==='identity_set'?'sidebar_snapshot_identity_set_changed':'sidebar_snapshot_identity_order_changed',JSON.stringify(result.rows));
  assert.equal(result.stopReason,result.rows[1].reason);assert.equal(result.scrollRestoreSuccessful,true);assert.equal(owner.scrollTop,0);
 }
});

test('isolated pinned-prefix rejects multiple scroll owners instead of selecting one arbitrarily',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{includeProject:false});dom.nav.clientHeight=60;dom.nav.scrollHeight=120;dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60});
 const owner={tagName:'DIV',parentElement:null,scrollTop:0,clientHeight:60,scrollHeight:120,isConnected:true,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60})};dom.nav.parentElement=owner;
 for(const [index,item] of dom.rows.entries())for(const node of [item.row,item.anchor,item.trigger])node.getBoundingClientRect=()=>{const x=node===item.trigger?270:node===item.anchor?8:0,w=node===item.trigger?20:node===item.anchor?230:320,h=node===item.trigger?20:36,y=index*60-(Number(owner.scrollTop)||0);return {x,y,width:w,height:h,left:x,top:y,right:x+w,bottom:y+h};};
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;x.window.gptPinnedActivityDiagnosticToken='ambiguous-owner';
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:5,includePinnedRecords:true,activityDiagnosticToken:'ambiguous-owner'});
 assert.equal(result.scrollOwnerCandidateCount,2);assert.equal(result.scrollOwnerReason,'scroll_owner_ambiguous');assert.equal(result.rows[1].reason,'scroll_owner_ambiguous');assert.equal(result.scrollUsed,false);assert.equal(owner.scrollTop,0);
});

test('pinned-prefix reports a detached owner separately and keeps an unresolved offscreen row unknown',async()=>{
 const dom=visiblePinnedRowsDocument([['Unpin chat'],['Pin chat']],{includeProject:false});dom.nav.clientHeight=60;dom.nav.scrollHeight=60;
 dom.nav.getBoundingClientRect=()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60});
 const owner={tagName:'DIV',parentElement:null,scrollTop:0,clientHeight:60,scrollHeight:120,isConnected:false,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:320,bottom:60,width:320,height:60})};dom.nav.parentElement=owner;
 for(const [index,item] of dom.rows.entries())for(const node of [item.row,item.anchor,item.trigger])node.getBoundingClientRect=()=>{const y=index*60;return {x:0,y,width:320,height:36,left:0,top:y,right:320,bottom:y+36};};
 const x=setup(dom.document);x.window.innerWidth=1024;x.window.innerHeight=768;
 const result=await x.window.gptInspectVisiblePinnedRows({maxRows:5});
 assert.ok(result.rows[1],JSON.stringify({stopReason:result.stopReason,top:result.sidebarTop,rows:result.rows,prefix:result.pinnedPrefixStatus}));
 assert.equal(result.rows[1].status,'unknown');assert.equal(result.rows[1].reason,'scroll_owner_detached');
 assert.equal(result.rows[1].unknownReason,'scroll_owner_detached');assert.equal(result.scrollUsed,false);
});


test('visible sidebar anchor uses anchor.click and returns sanitized activation telemetry directly',async()=>{
 const events=[];let clickCount=0;const anchor={tagName:'A',hidden:false,parentElement:null,getAttribute:name=>name==='href'?'/c/private-chat?secret=yes':null,hasAttribute:name=>name==='target',getClientRects:()=>[{}],getBoundingClientRect:()=>({x:10,y:20,left:10,top:20,right:250,bottom:56,width:240,height:36}),click:()=>{clickCount++;x.location.pathname='/c/private-chat';},dispatchEvent:event=>{events.push(event.type);return true;}};
 const nav={tagName:'NAV',hidden:false,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:300,bottom:700,width:300,height:700}),contains:node=>node===anchor};anchor.parentElement=nav;
 const x=setup({querySelectorAll:selector=>selector==='a[href]'?[anchor]:selector==='nav,aside,[role="navigation"],[data-testid*="sidebar"]'?[nav]:[]});
 x.window.webkit.messageHandlers.sidebarNavigation.postMessage=()=>{};
 const result=x.window.gptSidebarNavigateSync('private-chat','operation-token');
 assert.equal(result.status,'sidebar_anchor_click_invoked');assert.equal(result.totalAnchors,1);assert.equal(result.conversationAnchors,1);assert.equal(result.matchingAnchors,1);assert.equal(result.rowVisible,true);
 assert.equal(result.activationMethod,'anchor.click');assert.equal(result.clickInvoked,true);assert.equal(result.anchorFound,true);assert.equal(result.hrefMatchesExpected,true);assert.equal(result.targetAttributePresent,true);assert.equal(result.downloadAttributePresent,false);assert.equal(result.routeChangedImmediately,true);assert.equal(result.immediateTargetMatched,true);assert.equal(clickCount,1);assert.deepEqual(events,[],'synthetic pointer/mouse sequence is not used');assert.equal(x.sidebarMessages.length,0,'missing ack/telemetry cannot block synchronous result');
 const serialized=JSON.stringify(result);for(const secret of ['private-chat','secret=yes','title'])assert.equal(serialized.includes(secret),false);
 assert.equal('gptCaptureBackendTrafficContext' in x.window,false);
 const route=await x.window.gptWaitForSidebarRoute('private-chat','operation-token',150,{defaultPrevented:false});assert.equal(route.status,'sidebar_route_reached');
});

test('sync sidebar lookup returns missing, safe duplicate selection, and ambiguity directly',()=>{
 const missing=setup({querySelectorAll:()=>[]}).window.gptSidebarNavigateSync('private-chat','missing-token');assert.equal(missing.status,'row_missing');assert.equal(missing.matchingAnchors,0);
 const anchor=href=>({tagName:'A',hidden:false,parentElement:null,getAttribute:name=>name==='href'?href:null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:1,y:1,left:1,top:1,right:101,bottom:31,width:100,height:30}),click:()=>{},dispatchEvent:()=>{throw Error('synthetic activation forbidden');}});
 const inside=anchor('/c/private-chat'),outside=anchor('/g/private-space/c/private-chat');let x;const nav={tagName:'NAV',hidden:false,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:300,bottom:700,width:300,height:700}),contains:node=>node===inside};inside.parentElement=nav;
 x=setup({querySelectorAll:selector=>selector==='a[href]'?[inside,outside]:[nav]});const selected=x.window.gptSidebarNavigateSync('private-chat','one-sidebar-match');assert.equal(selected.status,'sidebar_anchor_click_invoked');assert.equal(selected.matchingAnchors,2);
 const ambiguous=setup({querySelectorAll:selector=>selector==='a[href]'?[inside,outside]:[]}).window.gptSidebarNavigateSync('private-chat','no-sidebar-match');assert.equal(ambiguous.status,'row_ambiguous');assert.equal(ambiguous.matchingAnchors,2);
});

test('sync finite anchor scan returns sanitized counts and ignores malformed href',()=>{
 const anchor=href=>({tagName:'A',hidden:false,parentElement:null,getAttribute:name=>name==='href'?href:null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:10,y:20,left:10,top:20,right:250,bottom:56,width:240,height:36}),click:()=>{},dispatchEvent:()=>{throw Error('synthetic activation forbidden');}});
 const target=anchor('/g/private-project/c/private-chat'),other=anchor('/c/another-private-chat'),malformed=anchor('http://[');
 const x=setup({querySelectorAll:selector=>selector==='a[href]'?[target,other,malformed]:[]});const result=x.window.gptSidebarNavigateSync('private-chat','scan-token');
 assert.equal(result.status,'sidebar_anchor_click_invoked');assert.equal(result.totalAnchors,3);assert.equal(result.conversationAnchors,2);assert.equal(result.matchingAnchors,1);
 assert.equal(x.sidebarMessages.some(m=>m.stage==='sidebar_row_anchor_scan_complete'&&m.totalAnchors===3&&m.conversationAnchors===2&&m.matchingAnchors===1),true);
 const safe=JSON.stringify([result,x.sidebarMessages]);for(const secret of ['private-chat','another-private-chat','private-project','http://['])assert.equal(safe.includes(secret),false);
});

test('sync row lookup exceptions return an explicit sanitized result',()=>{
 const x=setup({querySelectorAll:selector=>{if(selector==='a[href]')throw Object.assign(new Error('private href leaked'),{name:'SecurityError'});return [];}});
 const result=x.window.gptSidebarNavigateSync('target','exception-token');assert.equal(result.status,'row_lookup_error');assert.equal(result.errorCategory,'SecurityError');assert.equal(JSON.stringify(result).includes('private href leaked'),false);
});

test('sync offscreen result requests scroll; bounded continuation then clicks and starts route wait separately',async()=>{
 let scrollTop=0,menuClicks=0;const events=[];
 const anchor={tagName:'A',hidden:false,parentElement:null,getAttribute:name=>name==='href'?'/c/private-chat':null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:5,y:scrollTop===0?900:80,left:5,top:scrollTop===0?900:80,right:205,bottom:(scrollTop===0?930:110),width:200,height:30}),scrollIntoView:()=>{scrollTop=530;},click:()=>{x.location.pathname='/c/private-chat';},dispatchEvent:event=>{events.push(event.type);return true;}};
 const menu={tagName:'BUTTON',getAttribute:name=>name==='aria-haspopup'?'menu':null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:200,y:80,left:200,top:80,right:220,bottom:100,width:20,height:20}),dispatchEvent:()=>{menuClicks++;}};
 const root={tagName:'NAV',hidden:false,parentElement:null,scrollTop:0,scrollHeight:1200,clientHeight:400,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:300,bottom:400,width:300,height:400}),contains:node=>node===anchor||node===menu,querySelectorAll:selector=>selector==='a[href]'?[anchor]:selector==='button[aria-haspopup="menu"]'?[menu]:[]};
 Object.defineProperty(root,'scrollTop',{get:()=>scrollTop,set:value=>{scrollTop=value;}});anchor.parentElement=root;menu.parentElement=root;
 const x=setup({querySelectorAll:selector=>selector==='a[href]'?[anchor]:[root]});x.window.innerWidth=1024;x.window.innerHeight=768;
 const initial=x.window.gptSidebarNavigateSync('private-chat','scroll-token');assert.equal(initial.status,'row_resolved_needs_scroll');assert.equal(initial.rowVisible,false);assert.equal(events.length,0);
 const scrolled=await x.window.gptContinueSidebarScroll('private-chat','scroll-token');assert.equal(scrolled.status,'sidebar_anchor_click_invoked');assert.equal(scrolled.scrollRequired,true);
 const route=await x.window.gptWaitForSidebarRoute('private-chat','scroll-token',150,{defaultPrevented:false});assert.equal(route.status,'sidebar_route_reached');
 assert.deepEqual(events,[],'route activation must not dispatch synthetic pointer/mouse events');assert.equal(menuClicks,0);
});

test('route wait after delivered click has a bounded no-effect result',async()=>{
 const anchor={tagName:'A',hidden:false,parentElement:null,getAttribute:name=>name==='href'?'/c/private-chat':null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:10,y:20,left:10,top:20,right:250,bottom:56,width:240,height:36}),click:()=>{},dispatchEvent:()=>{throw Error('synthetic activation forbidden');}};
 const x=setup({querySelectorAll:selector=>selector==='a[href]'?[anchor]:[]});const result=x.window.gptSidebarNavigateSync('private-chat','no-effect-token');assert.equal(result.status,'sidebar_anchor_click_invoked');
 const route=await x.window.gptWaitForSidebarRoute('private-chat','no-effect-token',100,{defaultPrevented:false});assert.equal(route.status,'sidebar_navigation_no_effect');
});

test('route snapshots distinguish a changed wrong route from the expected route without exposing IDs',()=>{
 const anchor={tagName:'A',hidden:false,parentElement:null,getAttribute:name=>name==='href'?'/c/expected-private-id':null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:1,y:1,left:1,top:1,right:101,bottom:31,width:100,height:30}),click:()=>{}};
 const x=setup({querySelectorAll:selector=>selector==='a[href]'?[anchor]:[]});
 const clicked=x.window.gptSidebarNavigateSync('expected-private-id','route-snapshot-token');assert.equal(clicked.status,'sidebar_anchor_click_invoked');
 x.location.pathname='/c/different-private-id';let state=x.window.gptPinnedConversationRouteState('expected-private-id','route-snapshot-token');assert.equal(state.matches,false);assert.equal(state.routeChanged,true);assert.equal(state.routeTemplate,'/c/<id>');
 x.location.pathname='/g/private-project/c/expected-private-id';state=x.window.gptPinnedConversationRouteState('expected-private-id','route-snapshot-token');assert.equal(state.matches,true);assert.equal(state.routeChanged,true);assert.equal(state.routeTemplate,'/g/<id>/c/<id>');
 const safe=JSON.stringify(state);for(const secret of ['expected-private-id','different-private-id','private-project'])assert.equal(safe.includes(secret),false);
});


test('continuation captures the first-pass boundary before switching epochs and preserves request-time origin',()=>{
 const x=setup();
 const boundary={requestInFlightCount:1,responseInFlightCount:1,lastRequestCursorFingerprint:'deadbeef',pages:[{ordinal:7,requestCursorFingerprint:'deadbeef'}]};
 x.window.gptCaptureHistoryRequestBoundary=()=>boundary;
 const baseline={conversationId:'a',title:'A',processedMessageIds:['known'],messagesCollected:1,userMessages:1,assistantMessages:0,otherMessages:0,estimatedTextTokens:5,attachments:{images:0,audio:0,video:0,files:0},historyComplete:false,hasPreviousPage:true,hasNextPage:false,responsesCaptured:0};
 assert.equal(x.window.gptConfigureCheck({id:'a',token:'cont-token',continuation:true,expectedFrontier:10,baseline}),true);
 const captured=x.chatCheckMessages.find(message=>message.stage==='first_pass_boundary_captured');
 assert.equal(captured.boundary.requestInFlightCount,boundary.requestInFlightCount);assert.equal(captured.boundary.responseInFlightCount,boundary.responseInFlightCount);assert.deepEqual(captured.boundary.pages,boundary.pages);assert.equal(captured.boundary.firstPassAcceptedPageCount,0);
 assert.equal(x.window.gptLiveResumeContinuationGeneration,'cont-token');
 const responsePipeline={sequence:41,requestOrdinal:7,requestOrigin:'first_pass',liveResumeGeneration:'first-token',documentIdentity:'doc',requestClass:'conversation_messages',transport:'fetch',status:200,requestCursorFingerprint:'deadbeef',responseCursorFingerprint:'cafebabe',responsePageFingerprint:'1:01020304',itemCount:1,hasPreviousPage:true,payloadRecognized:true,pageActivityBounds:{minimum:1,maximum:1},pageDirection:'older'};
 const summary=page([{id:'known',activityTime:1}],{isPaginationResponse:true,hasPreviousPage:true,liveResumeGeneration:'first-token'});
 x.receive(summary,responsePipeline);
 const emitted=x.chatCheckMessages.find(message=>message.event==='continuation_response_pipeline');
 assert.equal(emitted.requestOrigin,'first_pass');
 assert.equal(emitted.requestOrdinal,7);
 assert.equal(emitted.requestCursorFingerprint,'deadbeef');
 assert.equal(emitted.pageFingerprint,'1:01020304');
 assert.equal(JSON.stringify([captured,emitted]).includes('cont-token'),true);
 assert.equal(JSON.stringify([captured,emitted]).includes('"known"'),false);
});

test('first-pass boundary reports accepted pre-configuration aggregate pages separately from tracked request pages',()=>{
 const x=setup();
 x.receive(page(['pre-config-private']),{requestOrigin:'unknown'});
 assert.equal(x.window.gptConfigureCheck({id:'a',token:'first-pass'}),true);
 for(let index=0;index<8;index++)x.receive(page([`tracked-private-${index}`]),{requestOrigin:'first_pass',requestOrdinal:index+1});
 let capturedBoundary=null;
 x.window.gptCaptureHistoryRequestBoundary=identities=>{assert.equal(Array.isArray(identities),true);assert.equal(identities.length,9);return{requestCount:8,responseCount:8,aggregateBaselineSource:'first_pass_aggregate',aggregateBaselineIdentityCount:identities.length,aggregateBaselineIdentitySetTruncated:false};};
 const baseline={conversationId:'a',processedMessageIds:Array.from({length:9},(_,index)=>`aggregate-private-${index}`),messagesCollected:9,hasPreviousPage:true,historyComplete:false};
 assert.equal(x.window.gptConfigureCheck({id:'a',token:'continuation',continuation:true,expectedFrontier:10,baseline}),true);
 capturedBoundary=x.chatCheckMessages.find(message=>message.stage==='first_pass_boundary_captured').boundary;
 assert.equal(capturedBoundary.firstPassAcceptedPageCount,9);
 assert.equal(capturedBoundary.firstPassRequestTrackedPageCount,8);
 assert.equal(capturedBoundary.firstPassPreConfigurationPendingAcceptedPageCount,1);
 assert.equal(capturedBoundary.firstPassOtherAcceptedPageCount,0);
 assert.equal(capturedBoundary.firstPassPreConfigurationPendingPageCount,1);
 assert.equal(capturedBoundary.firstPassPreConfigurationPendingItemCount,1);
 const serialized=JSON.stringify(x.chatCheckMessages);
 for(const secret of ['pre-config-private','tracked-private-0','aggregate-private-0'])assert.equal(serialized.includes(secret),false);
});

test('first-pass page origin telemetry distinguishes tracked, detail, untracked, and page-hook replay and compares continuation overlaps',()=>{
 const x=setup();
 const base=(ids,extra={})=>page(ids.map(id=>({id,activityTime:50})),extra);
 const lineage={endpointClass:'conversation_messages',requestObserved:true,requestOrigin:'first_pass',requestOrdinal:7,requestCursorFingerprint:'deadbeef',generationPresent:true,generationMatchesFirstPass:true,captureSource:'fetch',responseObserved:true,elapsedMs:100,captureSequence:11};
 x.receive(base(['hook-private']),null,{captureSequence:11,replayRequestId:'private-replay-token'});
 x.window.gptConfigureCheck({id:'a',token:'first-pass',baseline:{processedMessageIds:[],messagesCollected:0,hasPreviousPage:true,historyComplete:false}});
 x.receive(base(['tracked-private']),{requestClass:'conversation_messages',requestObserved:true,requestOrigin:'first_pass',requestOrdinal:1,requestCursorFingerprint:'cafebabe',liveResumeGeneration:'first-pass',elapsedMs:200,captureSource:'XHR',responseObserved:true,itemCount:1});
 x.receive(base(['detail-private']),{requestClass:'conversation_detail',requestObserved:false,requestOrigin:'unknown',elapsedMs:250,captureSource:'fetch',responseObserved:true});
 x.receive(base(['untracked-private']),{requestClass:'conversation_messages',requestObserved:false,requestOrigin:'unknown',elapsedMs:300,captureSource:'fetch',responseObserved:true});
 x.window.gptCaptureHistoryRequestBoundary=()=>({requestCount:1,responseCount:1,requestInFlightCount:0,responseInFlightCount:0,aggregateBaselineSource:'first_pass_aggregate',pages:[]});
 const baseline={processedMessageIds:['hook-private','tracked-private','detail-private','untracked-private'],messagesCollected:4,hasPreviousPage:true,historyComplete:false};
 x.window.gptConfigureCheck({id:'a',token:'continuation',continuation:true,expectedFrontier:100,baseline});
 const boundary=x.chatCheckMessages.find(m=>m.stage==='first_pass_boundary_captured').boundary;
 assert.equal(boundary.firstPassAcceptedPageCount,4);
 assert.equal(boundary.firstPassRequestTrackedPageCount,1);
 assert.equal(boundary.firstPassOtherAcceptedPageCount,2);
 assert.equal(boundary.firstPassPreConfigurationPendingAcceptedPageCount,1);
 assert.equal(boundary.firstPassSourcePageCounts.page_hook_preexisting,1);
 assert.equal(boundary.firstPassSourcePageCounts.conversation_messages_request_tracked,1);
 assert.equal(boundary.firstPassSourcePageCounts.conversation_detail,1);
 assert.equal(boundary.firstPassSourcePageCounts.conversation_messages_untracked,1);
 assert.equal(boundary.firstPassOtherOriginPageTrace.find(r=>r.sourceCategory==='page_hook_preexisting').captureSequence,11);
 const response=base(['hook-private','tracked-private','detail-private'],{liveResumeGeneration:'continuation',isPaginationResponse:true});
 x.receive(response,{sequence:77,requestOrigin:'continuation',requestClass:'conversation_messages',requestObserved:true,requestOrdinal:8,transport:'fetch',status:200,itemCount:3,payloadRecognized:true,routeMatches:true,documentIdentity:x.window.gptLiveResumeDocumentIdentity,liveResumeGeneration:'continuation',baselineIdentityOverlapCount:3,baselineIdentitySetCount:4,allItemsAlreadyKnownBaseline:true,newIdentityCount:0});
 const event=x.chatCheckMessages.find(m=>m.event==='continuation_response_pipeline');
 assert.equal(event.trackedFirstPassIdentityOverlapCount,1);
 assert.equal(event.otherOriginFirstPassIdentityOverlapCount,2);
 assert.equal(event.baselineIdentityOverlapCount,3);
 const serialized=JSON.stringify([boundary,event]);
 for(const secret of ['hook-private','tracked-private','detail-private','untracked-private','private-replay-token'])assert.equal(serialized.includes(secret),false);
});

test('first-seen aggregate provenance covers checkpoint and page sources, then attributes continuation replay without leaking IDs',()=>{
 const x=setup();
 const baseline={conversationId:'a',title:'A',processedMessageIds:['checkpoint-private'],messagesCollected:1,userMessages:1,assistantMessages:0,otherMessages:0,estimatedTextTokens:5,attachments:{images:0,audio:0,video:0,files:0},hasPreviousPage:true,hasNextPage:false,historyComplete:false,responsesCaptured:1,updatedAt:1};
 x.window.gptConfigureCheck({id:'a',token:'first-pass',baseline});
 const restoredOnly=x.chatCheckMessages.find(event=>event.event==='first_pass_identity_provenance');
 assert.equal(restoredOnly.provenance.aggregateIdentityCount,1);assert.equal(restoredOnly.provenance.counts.checkpoint_cache,1);assert.equal(restoredOnly.provenance.aggregateProvenanceGap,false);
 const domPage=page(['dom-private']);domPage.sourceLineage={captureSource:'initial_dom',requestObserved:false};x.receive(domPage);
 x.receive(page(['detail-private']),{requestClass:'conversation_detail',requestObserved:false,requestOrigin:'unknown',captureSource:'fetch',responseObserved:true});
 x.receive(page(['detail-private','tracked-private']),{requestClass:'conversation_messages',requestObserved:true,requestOrigin:'first_pass',requestOrdinal:1,captureSource:'fetch',responseObserved:true});
 const provenanceEvent=x.chatCheckMessages.filter(event=>event.event==='first_pass_identity_provenance').at(-1);
 assert.deepEqual({...provenanceEvent.provenance.counts},{initial_dom:1,initial_document_payload:0,'ui/bootstrap_prefetch':0,conversation_detail:1,conversation_messages_request_tracked:1,conversation_messages_untracked:0,page_hook_preexisting:0,page_hook_event_without_request_record:0,checkpoint_cache:1,response_origin_unknown:0});
 assert.equal(provenanceEvent.provenance.aggregateIdentityCount,4);assert.equal(provenanceEvent.provenance.attributedIdentityCount,4);assert.equal(provenanceEvent.provenance.aggregateProvenanceGap,false);
 const continuationBaseline={...baseline,processedMessageIds:['checkpoint-private','dom-private','detail-private','tracked-private'],messagesCollected:4};
 x.window.gptCaptureHistoryRequestBoundary=identities=>({requestCount:1,responseCount:1,aggregateBaselineSource:'first_pass_aggregate',aggregateBaselineIdentityCount:identities.length,aggregateBaselineIdentitySetTruncated:false,pages:[]});
 x.window.gptConfigureCheck({id:'a',token:'continuation',baseline:continuationBaseline,continuation:true,expectedFrontier:100});
 const boundary=x.chatCheckMessages.find(event=>event.stage==='first_pass_boundary_captured').boundary;
 assert.equal(boundary.firstPassIdentityProvenance.aggregateIdentityCount,4);
 assert.equal(boundary.firstPassIdentityProvenance.counts.checkpoint_cache,1);
 const response=page([{id:'checkpoint-private',activityTime:10},{id:'dom-private',activityTime:10},{id:'detail-private',activityTime:10},{id:'tracked-private',activityTime:10}],{liveResumeGeneration:'continuation'});
 x.receive(response,{sequence:700,requestOrigin:'continuation',requestClass:'conversation_messages',requestObserved:true,requestOrdinal:2,transport:'fetch',status:200,itemCount:4,hasPreviousPage:true,payloadRecognized:true,routeMatches:true,documentIdentity:x.window.gptLiveResumeDocumentIdentity,liveResumeGeneration:'continuation',baselineIdentityOverlapCount:4,baselineIdentitySetCount:4,allItemsAlreadyKnownBaseline:true,newIdentityCount:0});
 const pipeline=x.chatCheckMessages.find(event=>event.event==='continuation_response_pipeline');
 assert.deepEqual({...pipeline.identityProvenanceCounts},{known_from_initial_dom:1,known_from_bootstrap:0,known_from_conversation_detail:1,known_from_tracked_messages:1,known_from_untracked_messages:0,known_from_checkpoint_cache:1,known_from_other:0,genuinely_new:0});
 const serialized=JSON.stringify([provenanceEvent,boundary,pipeline]);
 for(const secret of ['checkpoint-private','dom-private','detail-private','tracked-private'])assert.equal(serialized.includes(secret),false);
});

test('baseline membership telemetry mismatch is explicit and does not alter continuation acceptance',()=>{
 const baseline={conversationId:'a',title:'A',processedMessageIds:['already-known-private'],messagesCollected:1,hasPreviousPage:true,historyComplete:false};
 const x=setup();x.window.gptConfigureCheck({id:'a',token:'mismatch',continuation:true,expectedFrontier:100,baseline});
 const p=page([{id:'older-new-private',activityTime:50}],{isPaginationResponse:true,liveResumeGeneration:'mismatch'});
 x.receive(p,{sequence:900,requestOrigin:'continuation',requestClass:'conversation_messages',transport:'fetch',status:200,itemCount:1,hasPreviousPage:true,payloadRecognized:true,routeMatches:true,documentIdentity:x.window.gptLiveResumeDocumentIdentity,liveResumeGeneration:'mismatch',baselineIdentityOverlapCount:1,baselineIdentitySetCount:2,allItemsAlreadyKnownBaseline:false,newIdentityCount:1});
 const event=x.chatCheckMessages.find(message=>message.event==='continuation_response_pipeline');
 assert.equal(event.baselineIdentityOverlapCount,1);
 assert.equal(event.itemBreakdown.alreadyKnownUniqueIdentities,0);
 assert.equal(event.itemBreakdown.uniqueValidIdentities,1);
 assert.equal(event.baselineMembershipTelemetryMismatch,true);
 assert.equal(event.baselineMembershipReason,'baseline_membership_telemetry_mismatch');
 assert.equal(event.accepted,true);
 assert.equal(event.accepted,true);
 assert.equal(JSON.stringify(event).includes('already-known-private'),false);
});

function structureNode(tag,attributes={},children=[]){
 const node={tagName:tag.toUpperCase(),attributes:Object.entries(attributes).map(([name,value])=>({name,value:String(value)})),children,parentElement:null,textContent:'PRIVATE CHAT TEXT',title:'PRIVATE TITLE',getAttribute(name){return Object.prototype.hasOwnProperty.call(attributes,name)?String(attributes[name]):null;}};
 for(const child of children)child.parentElement=node;
 node.querySelectorAll=selector=>{const selectors=selector.split(',').map(x=>x.trim()),out=[];const matches=element=>selectors.some(part=>{if(part==='a[href]')return element.tagName==='A'&&element.getAttribute('href')!==null;if(part==='button')return element.tagName==='BUTTON';if(part==='section')return element.tagName==='SECTION';if(part==='li')return element.tagName==='LI';const attr=part.match(/^\[([^\]]+)\]$/);return attr?element.getAttribute(attr[1])!==null:false;});const visit=element=>{for(const child of element.children){if(matches(child))out.push(child);visit(child);}};visit(node);return out;};
 return node;
}
test('sidebar structure diagnostic normalizes dynamic route IDs and removes query/hash',async()=>{
 const link1=structureNode('a',{href:'/g/secret-project/c/chat-secret?token=private#secret'}),link2=structureNode('a',{href:'/c/private-chat?x=secret#fragment'}),link3=structureNode('a',{href:'/project/my-private-project'});
 const nav=structureNode('nav',{},[link1,link2,link3]),x=setup({querySelectorAll:selector=>selector==='nav,aside,[role="navigation"]'?[nav]:[]});
 const result=await x.window.gptInspectSidebarElementStructure({hardTimeoutMs:1000});
 assert.equal(result.status,'success');assert.deepEqual(Array.from(result.routeTemplates,item=>item.template),['/c/:id','/g/:id/c/:id','/project/:id']);
 const serialized=JSON.stringify(result);for(const secret of ['secret-project','chat-secret','private-chat','my-private-project','token=','fragment'])assert.equal(serialized.includes(secret),false);
});
test('sidebar structure diagnostic returns only structural fields and never user text or attribute values',async()=>{
 const link=structureNode('a',{href:'/c/private-id?query=secret','aria-label':'PRIVATE ARIA LABEL','data-testid':'private-testid','data-pinned':'private-value'});
 const row=structureNode('div',{role:'listitem','data-state':'expanded'},[link]),nav=structureNode('nav',{'aria-label':'PRIVATE NAV LABEL'},[row]);
 const x=setup({querySelectorAll:selector=>selector==='nav,aside,[role="navigation"]'?[nav]:[]});const result=await x.window.gptInspectSidebarElementStructure({hardTimeoutMs:1000});const serialized=JSON.stringify(result);
 for(const secret of ['PRIVATE CHAT TEXT','PRIVATE TITLE','PRIVATE ARIA LABEL','PRIVATE NAV LABEL','private-id','query=secret','private-testid','private-value'])assert.equal(serialized.includes(secret),false);
 assert.deepEqual(Array.from(result.counts.ariaAttributeNames),['aria-label']);assert.equal(result.counts.ariaAttributeCount,2);assert.equal(result.counts.dataTestID,1);assert.equal(result.counts.dataState,1);
 assert.ok(result.rowCandidates.some(item=>item.tag==='div'&&item.role==='listitem'&&item.depth===1&&item.count===1));
 assert.deepEqual(Array.from(result.pinnedMarkerAttributeNames),['data-pinned']);
});
test('sidebar structure diagnostic is bounded by a fixed node cap',async()=>{
 const children=Array.from({length:1500},(_,index)=>structureNode(index%2?'button':'div',index%2?{'data-state':'closed'}:{}));const nav=structureNode('nav',{},children);
 const x=setup({querySelectorAll:selector=>selector==='nav,aside,[role="navigation"]'?[nav]:[]});const result=await x.window.gptInspectSidebarElementStructure({hardTimeoutMs:1000});
 assert.equal(result.nodeCount,1200);assert.equal(result.scanTruncated,true);assert.equal(result.reason,'node_cap');assert.ok(result.elapsedMs<=1000);
});
test('sidebar structure diagnostic returns a bounded empty result when no sidebar exists',async()=>{
 const x=setup({querySelectorAll:()=>[]});const result=await x.window.gptInspectSidebarElementStructure({hardTimeoutMs:1000});
 assert.equal(result.status,'partial');assert.equal(result.reason,'sidebar_not_found');assert.equal(result.rootCount,0);assert.deepEqual(Array.from(result.routeTemplates),[]);assert.deepEqual(Array.from(result.rowCandidates),[]);assert.ok(result.elapsedMs<=1000);
});

function octaneReadinessDocument(paths){
 const makeAnchor=(path,attrs={})=>{const values={href:path,'data-octane-navigation-item':'',...attrs};const anchor={tagName:'A',hidden:false,attributes:Object.entries(values).map(([name,value])=>({name,value:String(value)})),parentElement:null,children:[],getAttribute:name=>Object.prototype.hasOwnProperty.call(values,name)?String(values[name]):null,hasAttribute:name=>Object.prototype.hasOwnProperty.call(values,name),getClientRects:()=>[{}],getBoundingClientRect:()=>({x:8,y:25,width:270,height:30,top:25,bottom:55,left:8,right:278}),querySelectorAll:()=>[]};Object.defineProperty(anchor,'textContent',{get(){throw Error('row classification must not read chat text');}});Object.defineProperty(anchor,'title',{get(){throw Error('row classification must not read title');}});return anchor;};
 const nav={tagName:'NAV',hidden:false,attributes:[],parentElement:null,children:[],getAttribute:()=>null,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:0,y:0,width:320,height:700,top:0,bottom:700,left:0,right:320}),contains(node){return node===this||this.children.includes(node);},querySelectorAll(selector){if(selector==='a[href]'||selector==='a[data-octane-navigation-item][href]')return this.children.filter(node=>node.tagName==='A'&&node.getAttribute('href')&&(selector==='a[href]'||node.hasAttribute('data-octane-navigation-item')));if(selector.includes('[role="list"]'))return[this];return[];}};
 const anchors=paths.map(item=>Array.isArray(item)?makeAnchor(item[0],item[1]):makeAnchor(item));for(const anchor of anchors){anchor.parentElement=nav;nav.children.push(anchor);}
 const doc={readyState:'complete',body:{},documentElement:{clientWidth:1024,clientHeight:768},querySelectorAll(selector){if(selector==='nav,aside,[role="navigation"],[data-testid*="sidebar"]')return[nav];if(selector==='a[href]')return anchors;return[];}};
 return {document:doc,nav,anchors};
}
test('current Octane sidebar conversation routes require row attribute, sidebar context and non-navigation path',()=>{
 const dom=octaneReadinessDocument([
  ['/opaque-chat',{ 'data-status':'active' }],
  ['/opaque-project/opaque-chat',{ 'data-w-component':'navigation-item' }],
  ['/another-chat',{ 'data-status':'inactive','data-w-component':'thread-item' }],
  ['/settings',{'data-w-component':'navigation-item'}],
  ['/actions',{'data-octane-navigation-item':'','data-w-component':'navigation-action'}]
 ]),x=setup(dom.document);
 const rows=x.window.gptInspectSidebarRoutes().routes;
 assert.deepEqual(Array.from(rows.filter(row=>row.kind==='conversation'),row=>row.template),['/<id>','/<id>/<id>','/<id>']);
 assert.ok(rows.filter(row=>row.kind==='conversation').every(row=>row.dataAttributeNames.includes('data-octane-navigation-item')));
 assert.equal(rows[3].kind,'unknown','/settings remains excluded even when Octane-marked');
 assert.equal(rows[4].kind,'unknown','navigation actions remain excluded');
});
test('Octane single and nested conversation rows satisfy readiness without title or text inspection',async()=>{
 const dom=octaneReadinessDocument([['/octane-chat',{ 'data-status':'active' }],['/project-key/another-chat',{ 'data-w-component':'thread-item' }]]),x=setup(dom.document);
 const result=await x.window.gptWaitForPinnedReadinessPreflight({preflightTimeoutMs:1200});
 assert.equal(result.readiness.status,'snapshot_ready');assert.equal(result.readiness.firstPositiveCount,2);assert.equal(result.preflight.totalConversationRouteLinks,2);
 assert.deepEqual(Array.from(result.readiness.rows,anchor=>anchor.getAttribute('href')),['/octane-chat','/project-key/another-chat']);
});
test('Octane navigation actions and anchors outside sidebar do not satisfy row readiness',async()=>{
 const dom=octaneReadinessDocument([['/settings',{ 'data-w-component':'navigation-item' }],['/actions',{ 'data-status':'active' }]]),x=setup(dom.document);
 const result=await x.window.gptWaitForPinnedReadinessPreflight({preflightTimeoutMs:80});
 assert.equal(result.readiness.status,'rows_never_appeared');assert.equal(result.preflight.totalConversationRouteLinks,0);
});
test('DOM fallback accepts only visible Octane conversation rows, excludes navigation, and deduplicates identities',()=>{
 const dom=octaneReadinessDocument([
  ['/chat-one',{ 'data-status':'active' }],
  ['/project-key/chat-two',{ 'data-w-component':'thread-item' }],
  ['/chat-one',{ 'data-status':'duplicate' }],
  ['/settings',{ 'data-w-component':'navigation-item' }],
  ['/actions',{ 'data-w-component':'navigation-action' }]
 ]),x=setup(dom.document);
 x.location.pathname='/';x.location.href='https://chatgpt.com/';
 const result=x.window.gptCollectVisibleSidebarDOMFallback();
 assert.equal(result.status,'ok');assert.equal(result.candidateCount,5);assert.equal(result.acceptedConversationRowCount,2);
 assert.equal(result.rejectedNavigationRowCount,2);assert.equal(result.duplicateRowCount,1);
 assert.deepEqual(Array.from(result.conversationIds).sort(),['chat-one','chat-two']);
 assert.ok(!JSON.stringify(result).includes('textContent')&&!JSON.stringify(result).includes('title'));
});
test('DOM fallback returns bounded empty result outside home or without a sidebar',()=>{
 const noSidebar=setup({querySelectorAll:()=>[]});noSidebar.location.pathname='/';
 assert.equal(noSidebar.window.gptCollectVisibleSidebarDOMFallback().status,'sidebar_unavailable');
 const wrongRoute=setup({querySelectorAll:()=>[]});
 assert.equal(wrongRoute.window.gptCollectVisibleSidebarDOMFallback().status,'wrong_route');
});

function messageTurnDocument(turns, outside=[]) {
 const matchSelector=(node,selector)=>selector.split(',').some(raw=>{const item=raw.trim();if(item==='*')return true;const attr=item.match(/^\[([^\]]+)\]$/);if(attr)return node.attributes?.some(value=>value.name===attr[1])===true;const role=item.match(/^\[role="([^"]+)"\]$/);if(role)return node.getAttribute('role')===role[1];return String(node.tagName||'').toLowerCase()===item.toLowerCase();});
 const make=(tag,attrs={},children=[])=>{const node={tagName:tag.toUpperCase(),attributes:Object.entries(attrs).map(([name,value])=>({name,value})),children,parentElement:null,isConnected:true,clientHeight:500,clientWidth:600,scrollHeight:500,scrollWidth:600,scrollTop:0,getAttribute(name){return Object.hasOwn(attrs,name)?attrs[name]:null;},matches(selector){return matchSelector(node,selector);},contains(other){for(let item=other;item;item=item.parentElement)if(item===node)return true;return false;},querySelectorAll(selector){const result=[];const visit=parent=>{for(const child of parent.children||[]){if(matchSelector(child,selector))result.push(child);visit(child);}};visit(node);return result;},querySelector(selector){return node.querySelectorAll(selector)[0]||null;}};for(const child of children)child.parentElement=node;return node;};
 const build=spec=>make(spec.tag,spec.attrs||{},(spec.children||[]).map(build));
 const root=make('main',{role:'main'},turns.map(build));root.scrollHeight=1600;root.clientHeight=600;const body=make('body',{},[root,...outside.map(build)]);
 const document={body,scrollingElement:null,querySelectorAll(selector){if(selector==="main, [role='main']")return [root];if(selector==='main, [role="main"]')return [root];return body.querySelectorAll(selector);},querySelector(selector){if(selector==="main, [role='main']"||selector==="main,[role='main']")return root;return null;}};
 const attach=node=>{for(const child of node.children||[]){child.parentElement=node;attach(child);}};attach(body);
 return {document,root,make};
}

test('current data-turn-key DOM is scoped, nested markers deduplicate, and roles use structural markers only',()=>{
 const groups=[];
 for(let i=0;i<5;i++){
  const markers=i===0?[{tag:'DIV',attrs:{'data-user-message-bubble':'user-private'}}]:i===1?[{tag:'SPAN',attrs:{'data-chatgpt-agent-turn-start':'assistant-private'}}]:[];
  const children=markers.map(marker=>({tag:marker.tag,attrs:marker.attrs,children:[]}));
  if(i===0)children.push({tag:'DIV',attrs:{'data-turn-key':'nested-private-turn'},children:[]});
  groups.push({tag:'DIV',attrs:{'data-turn-key':`private-turn-${i}`,'data-content-search-turn-key':`private-search-${i}`,'data-talvt-turn-state':'private-state'},children});
 }
 const outside=[{tag:'DIV',attrs:{'data-turn-key':'outside-private'},children:[]}];
 // Convert lightweight specs into nodes using the fixture's element builder.
 const built=groups.map(group=>{
  const children=group.children.map(child=>({tag:child.tag,attrs:child.attrs,children:[]}));
  return {tag:group.tag,attrs:group.attrs,children};
 });
 const external=outside.map(item=>({tag:item.tag,attrs:item.attrs,children:[]}));
 const dom=messageTurnDocument(built,external),x=setup(dom.document);
 assert.equal(dom.document.querySelector("main, [role='main']"),dom.root);
 assert.equal(dom.root.querySelectorAll('[data-turn-key]').length,6);
 const result=x.window.gptConversationTurnReadiness();
 assert.deepEqual(JSON.parse(JSON.stringify(result)),{routeCategory:'chat',turnCount:5,userTurnCount:1,assistantTurnCount:1,unknownRoleTurnCount:3,source:'data-turn-key'});
 const encoded=JSON.stringify(result);for(const privateValue of ['private-turn-','private-search-','private-state','user-private','assistant-private','outside-private','PRIVATE TEXT','/g/project/c/a'])assert.equal(encoded.includes(privateValue),false);
});

test('legacy message selectors remain a contextual fallback and ambiguous role stays unknown',()=>{
 const dom=messageTurnDocument([{tag:'ARTICLE',attrs:{role:'article','data-testid':'private-testid'},children:[{tag:'DIV',attrs:{'data-user-message-bubble':'u'},children:[]}]},{tag:'DIV',attrs:{'data-conversation-role':'private-role'},children:[{tag:'DIV',attrs:{'data-user-message-bubble':'u' ,'data-chatgpt-agent-turn-start':'a'},children:[]}]}]);
 const x=setup(dom.document),result=x.window.gptConversationTurnReadiness();
 assert.equal(result.source,'legacy');assert.equal(result.turnCount,2);assert.equal(result.userTurnCount,1);assert.equal(result.assistantTurnCount,0);assert.equal(result.unknownRoleTurnCount,1);
});

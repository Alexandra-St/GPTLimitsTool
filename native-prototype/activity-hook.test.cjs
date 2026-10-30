const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(pathname='/c/local-id'){const sent=[],traffic=[],checks=[],window={fetch:{__gptListDiagnosticWrapper:true},webkit:{messageHandlers:{activity:{postMessage:x=>sent.push(x)},backendTraffic:{postMessage:x=>traffic.push(x)},chatCheck:{postMessage:x=>checks.push(x)}}}};let context={owner:'unrelated_passive_traffic',generation:null,stage:'page_idle'};window.gptSetRateLimitContext=(owner,generation,stage)=>{context={owner,generation,stage};};window.gptCaptureRateLimitContext=()=>context;const XMLHttpRequest={prototype:{open:{__gptListDiagnosticWrapper:true},send:{__gptListDiagnosticWrapper:true}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'activity-hook.js'),'utf8'),{window,XMLHttpRequest,location:{origin:'https://chatgpt.com',href:'https://chatgpt.com'+pathname,pathname},sessionStorage:{getItem(){throw Error('activity hook must not read sessionStorage');}},URL,Date});return {window,sent,traffic,checks,XMLHttpRequest};}
test('conversation update_time takes precedence and crosses bridge without content',()=>{
 const x=setup(),time=Date.now()-1000;
 x.window.gptObserveConversationActivity('/backend-api/conversation/local-id',{update_time:time/1000,mapping:{secret:{message:{content:'SECRET'}}}},200);
 assert.equal(x.sent[0].conversationId,'local-id');assert.equal(x.sent[0].timestamp,time);assert.equal(x.sent[0].timestampSource,'conversation_update_time');assert.equal(x.sent[0].endpointFamily,'conversation_detail');assert.equal(x.sent[0].httpStatus,200);assert.equal(x.sent[0].timestampFieldPresent,true);assert.equal(x.sent[0].timestampFieldType,'number');assert.ok(!JSON.stringify(x.sent).includes('SECRET'));
});
test('fallback reads only latest message timestamps; invalid and future times excluded',()=>{
 const x=setup(),time=Date.now()-1000;
 const message={create_time:time/1000,update_time:(time-1000)/1000};Object.defineProperty(message,'content',{get(){throw Error('content read');}});
 const result=x.window.gptSanitizeConversationActivity({mapping:{'private-message-id':{message},future:{message:{create_time:Date.now()*2}}}});
 assert.equal(result.timestamp,time);assert.equal(result.timestampSource,'latest_message_timestamp');assert.ok(!JSON.stringify(result).includes('private'));
 assert.equal(x.window.gptSanitizeConversationActivity({update_time:null,mapping:{}}),null);
});
test('conversation-level activity fields precede sanitized latest-message timestamps',()=>{
 const x=setup(),now=Date.now();
 const result=x.window.gptSanitizeConversationActivity({update_time:null,updated_at:new Date(now-2000).toISOString(),mapping:{m:{message:{create_time:(now-1000)/1000}}}});
 assert.equal(result.timestamp,Date.parse(new Date(now-2000).toISOString()));assert.equal(result.timestampSource,'conversation_activity_timestamp');
});
test('HTTP 429 produces only failure metadata, never activity proof; other conversation ignored',()=>{
 const x=setup();x.window.gptObserveConversationActivity('/backend-api/conversation/local-id',{update_time:1},429);
 assert.equal(x.sent[0].conversationId,'local-id');assert.equal(x.sent[0].httpStatus,429);assert.equal(x.sent[0].timestamp,null);assert.equal(x.sent[0].endpointFamily,'conversation_detail');
 x.window.gptObserveConversationActivity('/backend-api/conversation/other',{update_time:1},200);assert.equal(x.sent.length,2);assert.equal(x.sent[1].conversationId,'other');
});
test('timestamp fallback 429 carries safe operation provenance but no URL or conversation ID',()=>{
 const x=setup('/c/private-id');x.window.gptRecordRateLimit=(raw,status,context)=>({family:'conversation_messages',owner:context.owner,generation:context.generation,status,occurredAtStage:context.stage,occurredAt:123});
 x.window.gptObserveConversationActivity('/backend-api/conversations/private-id/messages?token=private',null,429,{owner:'isolated_timestamp_fallback',generation:'timestamp-op',stage:'activity_response_waiting'});
 assert.equal(x.sent[0].conversationId,'private-id');assert.equal(x.sent[0].endpointFamily,'conversation_messages');assert.equal(x.sent[0].operationOwner,'isolated_timestamp_fallback');assert.equal(x.sent[0].operationGeneration,'timestamp-op');assert.equal(x.sent[0].occurredAtStage,'activity_response_waiting');assert.equal(x.sent[0].httpStatus,429);
 for(const secret of ['/backend-api/','token=private','PRIVATE BODY'])assert.equal(JSON.stringify(x.sent[0]).includes(secret),false);
});
test('messages endpoint is recognized and emits only sanitized timestamp metadata',()=>{
 const x=setup('/g/private-space/c/local-id'),time=Date.now()-5000;
 x.window.gptObserveConversationActivity('/backend-api/conversations/local-id/messages',{update_time:time/1000,conversation:{content:'PRIVATE MESSAGE'}},200);
 const event=x.sent[0];assert.equal(event.conversationId,'local-id');assert.equal(event.endpointFamily,'conversation_messages');assert.equal(event.httpStatus,200);assert.equal(event.timestamp,time);assert.equal(event.timestampSource,'conversation_update_time');assert.equal(event.timestampFieldPresent,true);assert.equal(event.timestampFieldType,'number');
 for(const secret of ['PRIVATE MESSAGE','content','/backend-api/conversations/'])assert.equal(JSON.stringify(event).includes(secret),false,`leaked ${secret}: ${JSON.stringify(event)}`);
});
test('response without activity timestamp is still observable and invalid timestamp is distinguishable',()=>{
 const x=setup();x.window.gptObserveConversationActivity('/backend-api/conversations/local-id/messages',{messages:[{content:'PRIVATE'}]},200);
 assert.equal(x.sent[0].conversationId,'local-id');assert.equal(x.sent[0].timestampFieldPresent,false);assert.equal(x.sent[0].timestamp,null);assert.equal(x.sent[0].httpStatus,200);
 x.window.gptObserveConversationActivity('/backend-api/conversations/local-id/messages',{update_time:'not-a-date'},200);
 assert.equal(x.sent[1].timestampFieldPresent,true);assert.equal(x.sent[1].timestampFieldType,'string');assert.equal(x.sent[1].timestamp,null);assert.equal(x.sent[1].timestampSource,null);
 assert.equal(JSON.stringify(x.sent).includes('PRIVATE'),false);
});

test('always-on backend hook emits sanitized metadata without observer activation',()=>{
 const x=setup('/c/private-id'),time=Date.now()-1000;
 const body={id:'private-id',update_time:time/1000,title:'PRIVATE TITLE',messages:[{content:'PRIVATE BODY'}]};
 assert.equal(x.window.gptObserveBackendResponse('/backend-api/conversations/private-id?secret=query',body,200),true);
 assert.equal(x.traffic.length,1);
 const event=x.traffic[0];
 assert.equal(event.endpointFamily,'conversation_detail');assert.equal(event.httpStatus,200);
 assert.equal(event.conversationIdPresent,true);assert.equal(event.conversationId,'private-id');
 assert.equal(event.timestampFieldPresent,true);assert.equal(event.timestampField,'update_time');assert.equal(event.timestampFieldType,'number');
 assert.equal(event.timestampValue,time);assert.equal(event.timestampSource,'conversation_detail.update_time');
 assert.ok(Number.isFinite(event.capturedAtMs));assert.equal(typeof event.responseSequence,'number');
 for(const secret of ['PRIVATE TITLE','PRIVATE BODY','secret=query','/backend-api/'])assert.equal(JSON.stringify(event).includes(secret),false);
});

test('always-on traffic identifies conversation candidates in list responses but not arbitrary model IDs',()=>{
 const x=setup(),time=Date.now()-2000;
 x.window.gptObserveBackendResponse('/backend-api/models',{id:'model-id',name:'private'},200);
 x.window.gptObserveBackendResponse('/backend-api/conversations',{items:[{id:'expected-id',update_time:time/1000,title:'PRIVATE'}]},200);
 assert.equal(x.traffic[0].endpointFamily,'unrelated_backend');assert.equal(x.traffic[0].conversationId,null);
 assert.equal(x.traffic[1].endpointFamily,'root_conversation_list');assert.equal(x.traffic[1].conversationId,'expected-id');
 assert.equal(x.traffic[1].timestampField,'update_time');assert.equal(x.traffic[1].timestampValue,time);
 assert.equal(JSON.stringify(x.traffic).includes('PRIVATE'),false);
});

test('always-on hook classifies unrelated and conversation-related responses with no operation token',()=>{
 const x=setup(),time=Date.now()-3000;
 x.window.gptObserveBackendResponse('/backend-api/models',{},200);
 x.window.gptObserveBackendResponse('/backend-api/conversations/other-id/messages',{update_time:time/1000},200);
 x.window.gptObserveBackendResponse('/backend-api/conversation_activity',{conversation_id:'expected-id',messages:[{create_time:time/1000,content:'SECRET'}]},200);
 assert.deepEqual(x.traffic.map(e=>e.endpointFamily),['unrelated_backend','conversation_messages','conversation_related_other']);
 assert.equal(x.traffic[2].conversationId,'expected-id');assert.equal(x.traffic[2].timestampField,'create_time');
 assert.equal(x.traffic[2].timestampFieldType,'number');assert.equal(x.traffic[2].timestampValue,time);
 for(const event of x.traffic)assert.equal('operationGeneration' in event,false);
 assert.equal(JSON.stringify(x.traffic).includes('SECRET'),false);
});

test('production history request telemetry is operation-scoped and sanitized',()=>{
 const x=setup('/c/private-id');
 x.window.gptSetRateLimitContext('scheduler_conversation_check','operation-generation','conversation_check');
 assert.equal(x.window.gptReportHistoryRequest('/backend-api/conversations/private-id/messages?secret=query'),true);
 assert.equal(JSON.stringify(x.checks[0]),JSON.stringify({event:'history_request',endpointFamily:'conversation_messages',owner:'scheduler_conversation_check',generation:'operation-generation'}));
 assert.equal(JSON.stringify(x.checks).includes('private-id'),false);assert.equal(JSON.stringify(x.checks).includes('secret=query'),false);
 assert.equal(JSON.stringify(x.window.gptChatCheckHookHealth('operation-generation')),JSON.stringify({activityHookInstalled:true,fetchHookActive:true,xhrHookActive:true,generationAttached:true}));
});

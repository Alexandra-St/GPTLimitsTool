const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function makeContext(fetchImpl, xhrResponse, perfEntries=[],cycleConfig=null,cryptoOverride=null) {
 const diagnostics=[],pages=[];
 const mutationObservers=[];
 class MutationObserver {constructor(callback){this.callback=callback;mutationObservers.push(this);}observe(){}disconnect(){}trigger(){this.callback([]);}}
 function XHR(){this.listeners={};this.responseType='';this.status=xhrResponse?.status??200;this.responseText=xhrResponse?.body??'{}';}
 XHR.prototype.open=function(method,url){this.method=method;this.url=url;};
 XHR.prototype.send=function(){for(const fn of this.listeners.load||[])fn();};
 XHR.prototype.addEventListener=function(name,fn){(this.listeners[name]??=[]).push(fn);};
 const window={fetch:fetchImpl,webkit:{messageHandlers:{diagnostics:{postMessage:x=>diagnostics.push(x)},list:{postMessage:x=>pages.push(x)}}}};
 if(cycleConfig)window.gptListCycleConfig=cycleConfig;
 const document={readyState:'complete',body:{},documentElement:{},querySelectorAll:()=>[],querySelector:()=>null,visibilityState:'visible'};
 const ctx=vm.createContext({window,crypto:cryptoOverride||require('node:crypto').webcrypto,TextEncoder,Uint8Array,XMLHttpRequest:XHR,MutationObserver,location:{href:'https://chatgpt.com/',origin:'https://chatgpt.com',pathname:'/'},URL,Request:undefined,Date,setTimeout,performance:{getEntriesByType:()=>perfEntries,now:()=>123},innerWidth:1100,innerHeight:760,document});
 for(const file of ['conversation-list.js','list-hook.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),ctx);
 const waitPages=async count=>{const until=Date.now()+3000;while(pages.length<count&&Date.now()<until)await new Promise(r=>setTimeout(r,5));assert.equal(pages.length,count);};
 const waitDiagnostics=async(event,count)=>{const until=Date.now()+3000;while(diagnostics.filter(x=>x.event===event).length<count&&Date.now()<until)await new Promise(r=>setTimeout(r,5));assert.equal(diagnostics.filter(x=>x.event===event).length,count);};
 return {window,diagnostics,pages,XHR,context:ctx,mutationObservers,waitPages,waitDiagnostics};
}
const payload={items:[{id:'private-conversation-id',title:'private title',update_time:'2026-10-23T16:00:00Z',snippet:'private body'}],offset:0,limit:20,total:999};

test('list diagnostics strip query, mask IDs, and do not retain response bodies',async()=>{
 const response={status:200,clone:()=>({json:async()=>payload})};
 const c=makeContext(async()=>response);
 await c.window.fetch('/backend-api/conversations?cursor=private-query&token=private-token');await new Promise(setImmediate);
 assert.deepEqual(c.diagnostics.map(x=>x.event),['request','response','parsed']);
 assert.equal(c.diagnostics[0].pathname,'/backend-api/conversations');assert.equal(c.diagnostics[1].status,200);
 assert.equal(c.diagnostics[2].recognized,true);assert.equal(c.diagnostics[2].itemCount,1);
 const masked=c.window.gptMaskDiagnosticPath('https://chatgpt.com/g/secret/c/private-conversation-id?private=query');
 assert.equal(masked,'/g/:id/c/:id');
 const serialized=JSON.stringify(c.diagnostics);
 for(const secret of ['private-query','private-token','private-conversation-id','private title','private body','snippet'])assert.ok(!serialized.includes(secret),`diagnostics unexpectedly contain ${secret}: ${serialized}`);
 assert.equal(c.pages.length,1);assert.equal(c.pages[0].records[0].conversationId,'private-conversation-id');
});

test('request observed with no response is represented without payload data',async()=>{
 const c=makeContext(()=>new Promise(()=>{}));
 c.window.fetch('/backend-api/conversations?query=private');await new Promise(setImmediate);
 assert.equal(c.diagnostics.length,1);assert.equal(c.diagnostics[0].event,'request');
 assert.equal(c.diagnostics[0].transport,'fetch');assert.equal(c.diagnostics[0].method,'GET');
 assert.equal(JSON.stringify(c.diagnostics).includes('private'),false);
});

test('429 provenance is sanitized and bound to request-time owner and generation',async()=>{
 const c=makeContext(async()=>({status:429,clone:()=>({json:async()=>({error:'PRIVATE BODY'})})}));
 c.window.gptRateLimitContext={owner:'isolated_prefix_diagnostic',generation:'probe-token-42',stage:'prefix_classification'};
 await c.window.fetch('/backend-api/conversations?secret=PRIVATE_QUERY&conversation=PRIVATE_ID');await new Promise(setImmediate);
 const rate=c.diagnostics.find(event=>event.event==='rate_limit');assert.ok(rate);
 assert.equal(rate.family,'root_conversation_list');assert.equal(rate.owner,'isolated_prefix_diagnostic');assert.equal(rate.generation,'probe-token-42');assert.equal(rate.status,429);assert.equal(rate.occurredAtStage,'prefix_classification');
 for(const secret of ['PRIVATE_ID','PRIVATE_QUERY','PRIVATE BODY','conversation='])assert.equal(JSON.stringify(c.diagnostics).includes(secret),false);
});

test('scheduler discovery owns root-list 429 only; incidental message 429 is passive traffic',async()=>{
 const root=makeContext(async()=>({status:429,clone:()=>({json:async()=>({})})}));
 root.window.gptRateLimitContext={owner:'scheduler_discovery',generation:'cycle-token',stage:'scheduler_discovery'};
 await root.window.fetch('/backend-api/conversations?cursor=opaque');await new Promise(setImmediate);
 assert.deepEqual(JSON.parse(JSON.stringify(root.diagnostics.find(event=>event.event==='rate_limit'))),{
  event:'rate_limit',family:'root_conversation_list',owner:'scheduler_discovery',generation:'cycle-token',status:429,occurredAtStage:'scheduler_discovery',occurredAt:root.diagnostics.find(event=>event.event==='rate_limit').occurredAt,sequence:1
 });
 const messages=makeContext(async()=>({status:429,clone:()=>({json:async()=>({})})}));
 messages.window.gptRecordRateLimit('/backend-api/conversations/PRIVATE_ID/messages?token=private',429,{owner:'scheduler_discovery',generation:'cycle-token',stage:'scheduler_discovery'});
 const event=messages.diagnostics.find(item=>item.event==='rate_limit');assert.equal(event.family,'conversation_messages');assert.equal(event.owner,'unrelated_passive_traffic');
});

test('isolated network window records unknown backend list candidates using metadata only',async()=>{
 const privatePayload={items:[{id:'PRIVATE_ID',title:'PRIVATE_TITLE',update_time:'2026-10-24T00:00:00Z',snippet:'PRIVATE_TEXT'}]};
 const response={status:200,clone:()=>({json:async()=>privatePayload})};
 const c=makeContext(async()=>response);
 assert.equal(c.window.gptBeginStarredNetworkWindow(),true);
 await c.window.fetch('/backend-api/favorites/PRIVATE_PATH_ID?cursor=private-cursor&limit=10&is_starred=true&token=PRIVATE_TOKEN');
 const events=c.window.gptEndStarredNetworkWindow();
 await new Promise(setImmediate);
 assert.deepEqual(JSON.parse(JSON.stringify(events.map(x=>x.event))),['request','response','shape']);
 assert.equal(events[0].method,'GET');assert.equal(events[0].pathname,'/backend-api/favorites/:id');
 assert.deepEqual(Array.from(events[0].queryKeys),['cursor','is_starred','limit','token']);
 assert.deepEqual(JSON.parse(JSON.stringify(events[0].queryValues)),{cursor:true,is_starred:true,limit:10});
 assert.equal(events[1].status,200);
 assert.deepEqual(Array.from(events[2].safeShape.topLevelKeys),['items']);assert.equal(events[2].safeShape.arrays[0].count,1);
 assert.deepEqual(Array.from(events[2].safeShape.arrays[0].firstItemKeys),['id','title','update_time','snippet']);
 for(const secret of ['private-cursor','PRIVATE_TOKEN','PRIVATE_ID','PRIVATE_TITLE','PRIVATE_TEXT','2026-10-24','favorites?'])assert.equal(JSON.stringify(events).includes(secret),false);
 await c.window.fetch('/backend-api/favorites?token=outside-window');
 assert.deepEqual(JSON.parse(JSON.stringify(c.window.gptEndStarredNetworkWindow())),[]);
});

test('XHR diagnostics report method, status, and failed list recognition safely',()=>{
 const c=makeContext(async()=>{throw Error('not used');},{status:503,body:'{"status":"private"}'});
 const xhr=new c.XHR();xhr.open('GET','/backend-api/conversations?query=private');xhr.send();
 assert.deepEqual(c.diagnostics.map(x=>x.event),['request','response','parsed']);
 assert.equal(c.diagnostics[0].transport,'XHR');assert.equal(c.diagnostics[0].method,'GET');
 assert.equal(c.diagnostics[1].status,503);assert.equal(c.diagnostics[2].recognized,false);
 assert.deepEqual(Array.from(c.diagnostics[2].topLevelKeys),['status']);
 assert.equal(JSON.stringify(c.diagnostics).includes('private'),false);
});

test('PerformanceResourceTiming finds list resources outside the wrapped fetch/XHR hooks without query data',()=>{
 const c=makeContext(async()=>{throw Error('unused');},null,[{name:'https://chatgpt.com/backend-api/conversations?cursor=private',initiatorType:'fetch',startTime:321.4,responseEnd:400,responseStatus:200}]);
 c.window.gptListDiagnosticSnapshot();
 const resource=c.diagnostics.find(x=>x.event==='resource');
 assert.ok(resource);assert.equal(resource.pathname,'/backend-api/conversations');assert.equal(resource.initiatorType,'fetch');assert.equal(resource.relativeStartMs,321);
 assert.equal(resource.completed,true);assert.equal(resource.status,200);
 assert.deepEqual(Array.from(resource.queryKeys),['cursor']);assert.equal(resource.queryValues.cursor,true);
 assert.equal(JSON.stringify(c.diagnostics).includes('private'),false);
});

test('recent-chat traffic diagnostic returns bounded normalized endpoint and response shape without user data',async()=>{
 const body={items:[{id:'PRIVATE_CHAT_ID',title:'PRIVATE_CHAT_TITLE',snippet:'PRIVATE_MESSAGE'}],cursor:'PRIVATE_CURSOR',private_field:'PRIVATE_VALUE'};
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>body})}));
 c.window.gptBeginStarredNetworkWindow();
 await c.window.fetch('/backend-api/sidebar/list/PRIVATE_ENDPOINT?token=PRIVATE_TOKEN');await new Promise(setImmediate);
 c.window.gptRecentListTrafficCaptureArmed=true;
 const result=c.window.gptEndRecentListTrafficCapture();
 assert.ok(result.length<=50);assert.equal(result.at(-1).event,'shape');
 assert.equal(result.at(-1).pathname,'/backend-api/sidebar/list/:id');
 assert.equal(result.at(-1).transport,'fetch');assert.equal(result.at(-1).status,200);
 assert.deepEqual(Array.from(result.at(-1).topLevelKeys),['items','cursor','private_field']);
 assert.deepEqual(JSON.parse(JSON.stringify(result.at(-1).arrayCounts)),[{key:'items',count:1}]);
 assert.equal(result.at(-1).recognized,false);assert.equal(result.at(-1).parserRejectionReason,'endpoint_not_registered');
 const serialized=JSON.stringify(result);
 for(const secret of ['PRIVATE_CHAT_ID','PRIVATE_CHAT_TITLE','PRIVATE_MESSAGE','PRIVATE_CURSOR','PRIVATE_TOKEN','PRIVATE_ENDPOINT','PRIVATE_VALUE','?token'])assert.equal(serialized.includes(secret),false,`traffic diagnostic leaked ${secret}`);
});

test('recent-chat traffic parser diagnostic reports accepted and rejected list shapes without response values',async()=>{
 const responses=[
  {status:200,clone:()=>({json:async()=>({items:[{id:'PRIVATE_ID',title:'PRIVATE_TITLE',update_time:'2026-10-30T00:00:00Z'}],offset:0})})},
  {status:200,clone:()=>({json:async()=>({items:{private:'value'},cursor:'PRIVATE_CURSOR'})})}
 ];
 const c=makeContext(async()=>responses.shift());c.window.gptBeginStarredNetworkWindow();
 await c.window.fetch('/backend-api/conversations?cursor=PRIVATE_QUERY');
 await c.window.fetch('/backend-api/conversations?cursor=PRIVATE_QUERY_2');await new Promise(setImmediate);
 c.window.gptRecentListTrafficCaptureArmed=true;const result=c.window.gptEndRecentListTrafficCapture();
 const shapes=result.filter(item=>item.event==='shape');assert.equal(shapes.length,2);
 assert.equal(shapes[0].recognized,true);assert.equal(shapes[0].parserRejectionReason,'none');
 assert.equal(shapes[1].recognized,false);assert.equal(shapes[1].parserRejectionReason,'items_not_array');
 assert.deepEqual(JSON.parse(JSON.stringify(shapes[0].arrayCounts)),[{key:'items',count:1}]);
 for(const secret of ['PRIVATE_ID','PRIVATE_TITLE','PRIVATE_QUERY','PRIVATE_QUERY_2','PRIVATE_CURSOR','value'])assert.equal(JSON.stringify(result).includes(secret),false);
});

test('root discovery health snapshot is sanitized and detects the active generation and wrappers',()=>{
 const c=makeContext(async()=>{throw Error('unused');},null,[],{token:'cycle-token-private',secret:'ephemeral-secret'});
 c.context.document.querySelectorAll=selector=>selector==='a[href]'?[{href:'https://chatgpt.com/c/private-conversation-id'}]
  :selector==='nav,aside,[role="navigation"]'?[{}]:[];
 c.window.gptInspectRootSidebarMetadata=()=>({activeSidebarFound:true,renderedRows:1,visibleRows:1,exactActivityMetadataAvailable:false});
 const state=c.window.gptListRootDiscoveryState('cycle-token-private');
 assert.equal(state.routeTemplate,'/');assert.equal(state.documentReadyState,'complete');assert.equal(state.bodyPresent,true);
 assert.equal(state.sidebarAvailable,true);assert.equal(state.sidebarCandidates,1);assert.equal(state.conversationLinks,1);
 assert.equal(state.rootListHookInstalled,true);assert.equal(state.fetchHookInstalled,true);
 assert.equal(state.xhrOpenHookInstalled,true);assert.equal(state.xhrSendHookInstalled,true);assert.equal(state.generationAttached,true);
 assert.equal(state.sidebarMetadata.renderedRows,1);assert.equal(state.sidebarMetadata.exactActivityMetadataAvailable,false);
 for(const secret of ['private-conversation-id','cycle-token-private','ephemeral-secret','/c/private'])assert.equal(JSON.stringify(state).includes(secret),false);
 const health=c.diagnostics.find(event=>event.event==='root_hook_health');assert.ok(health);
 assert.equal(health.routeTemplate,'/');assert.equal(health.conversationLinks,0);
 assert.equal(JSON.stringify(health).includes('private-conversation-id'),false);
});

test('root discovery aggregates bounded backend traffic by family and transport without request data',async()=>{
 const response={status:200,clone:()=>({json:async()=>payload})};
 const c=makeContext(async()=>response,null,[],{token:'cycle-token-private',secret:'ephemeral-secret'});
 await c.window.fetch('/backend-api/conversations?cursor=PRIVATE_CURSOR&token=PRIVATE_TOKEN');
 await c.window.fetch('/backend-api/favorites/PRIVATE_ENDPOINT_ID?token=PRIVATE_TOKEN');
 const state=c.window.gptListRootDiscoveryState('cycle-token-private');
 assert.equal(state.rootBackendTraffic.root_conversation_list.fetch.requests,1);
 assert.equal(state.rootBackendTraffic.root_conversation_list.fetch.responses,1);
 assert.deepEqual(JSON.parse(JSON.stringify(state.rootBackendTraffic.root_conversation_list.fetch.statuses)),{200:1});
 assert.equal(state.rootBackendTraffic.other_chatgpt_backend.fetch.requests,1);
 assert.equal(state.rootBackendTraffic.other_chatgpt_backend.fetch.responses,1);
 assert.equal(JSON.stringify(state).includes('PRIVATE_CURSOR'),false);
 assert.equal(JSON.stringify(state).includes('PRIVATE_TOKEN'),false);
 assert.equal(JSON.stringify(state).includes('PRIVATE_ENDPOINT_ID'),false);
 assert.equal(JSON.stringify(state).includes('private title'),false);
 assert.equal(JSON.stringify(state).includes('private body'),false);
});

test('root discovery captures sanitized list-like source timing and sidebar row changes',async()=>{
 const privatePayload={items:[{id:'PRIVATE_CHAT_ID',title:'PRIVATE_CHAT_TITLE',snippet:'PRIVATE_MESSAGE'}],next:'PRIVATE_CURSOR'};
 const response={status:200,clone:()=>({json:async()=>privatePayload})};
 const c=makeContext(async()=>response,{status:200,body:JSON.stringify(privatePayload)},[],{token:'cycle-token-private',secret:'ephemeral-secret'});
 let links=[{href:'https://chatgpt.com/c/PRIVATE_CHAT_ID'}];
 c.context.document.querySelectorAll=selector=>selector==='a[href]'?links:(selector==='nav,aside,[role="navigation"]'?[{}]:[]);
 c.window.gptInspectRootSidebarMetadata=()=>({activeSidebarFound:true,renderedRows:links.length,visibleRows:Math.min(1,links.length),rowsWithInternalIdentity:links.length,rowsWithoutInternalIdentity:0,
  scrollGeometry:{scrollTop:0,scrollRangePx:300,atScrollExtent:false},endOfListProof:'unavailable'});
 const before=c.window.gptListRootDiscoveryState('cycle-token-private');assert.equal(before.rootSidebarTimeline.at(-1).renderedRows,1);
 await c.window.fetch('/backend-api/favorites/PRIVATE_ENDPOINT?cursor=PRIVATE_CURSOR&token=PRIVATE_TOKEN');await new Promise(setImmediate);
 await c.window.fetch('/api/sidebar/state?cursor=PRIVATE_OTHER_CURSOR');await new Promise(setImmediate);
 const xhr=new c.XHR();xhr.open('GET','/api/sidebar/state?cursor=PRIVATE_XHR_CURSOR');xhr.send();await new Promise(setImmediate);
 links=[...links,{href:'https://chatgpt.com/c/ANOTHER_PRIVATE_ID'}];c.mutationObservers[0].trigger();await new Promise(resolve=>setTimeout(resolve,120));
 const state=c.window.gptListRootDiscoveryState('cycle-token-private');
 const hookEvents=state.rootHookEvents;
 const request=hookEvents.find(item=>item.pathname==='/backend-api/favorites/:id'&&item.event==='request');
 const responseEvent=hookEvents.find(item=>item.pathname==='/backend-api/favorites/:id'&&item.event==='response');
 assert.ok(request&&responseEvent);assert.equal(request.method,'GET');assert.equal(request.transport,'fetch');assert.equal(responseEvent.status,200);assert.equal(responseEvent.itemCount,1);
 assert.equal(Number.isInteger(request.relativeMs),true);assert.equal(Number.isInteger(responseEvent.relativeMs),true);assert.equal(responseEvent.sequence,request.sequence);
 const nonBackend=hookEvents.filter(item=>item.pathname==='/api/sidebar/:segment'&&item.event==='response');
 assert.equal(nonBackend.length,2);assert.deepEqual(Array.from(nonBackend.map(item=>item.transport).sort()),['XHR','fetch']);
 assert.ok(nonBackend.every(item=>item.status===200&&item.itemCount===1));
 assert.equal(state.rootResourceEvents.length,0);
 assert.deepEqual(JSON.parse(JSON.stringify(state.rootSidebarTimeline.map(item=>item.renderedRows).slice(-2))),[1,2]);
 assert.ok(state.rootSidebarTimeline.every(item=>item.activeContext===true&&item.rowsWithInternalIdentity!==null&&item.rowsWithoutInternalIdentity!==null));
 assert.equal(state.rootSidebarTimeline.at(-1).hiddenScrollRangePossible,true);
 assert.equal(request.generation,'current');assert.equal(request.partition,null);
 for(const secret of ['PRIVATE_CHAT_ID','PRIVATE_CHAT_TITLE','PRIVATE_MESSAGE','PRIVATE_CURSOR','PRIVATE_TOKEN','PRIVATE_ENDPOINT','PRIVATE_OTHER_CURSOR','PRIVATE_XHR_CURSOR','ANOTHER_PRIVATE_ID'])assert.equal(JSON.stringify(state).includes(secret),false);
});

test('root pagination trace correlates request and response offsets, page hints, and progress without exporting identities',async()=>{
 let currentOffset=0;
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>({
  offset:currentOffset,limit:20,has_more:currentOffset<40,
  items:Array.from({length:currentOffset===40?3:20},(_,index)=>({id:`PRIVATE_CHAT_${currentOffset+index}`,title:'PRIVATE_TITLE',update_time:'2026-10-26T00:00:00Z'}))
 })})}),null,[],{token:'cycle-token-private',secret:'ephemeral-secret'});
 c.window.gptRateLimitContext={owner:'scheduler_discovery',generation:'cycle-token-private',stage:'scheduler_discovery'};
 for(currentOffset of [0,20,40]){await c.window.fetch(`/backend-api/conversations?offset=${currentOffset}&limit=20&token=PRIVATE_QUERY`);await new Promise(setImmediate);}
 const state=c.window.gptListRootDiscoveryState('cycle-token-private');
 const events=state.rootHookEvents.filter(event=>event.category==='root_conversation_list'&&event.source==='hook');
 assert.deepEqual(Array.from(events,event=>event.event),['request','response','request','response','request','response']);
 const requests=events.filter(event=>event.event==='request'),responses=events.filter(event=>event.event==='response');
 assert.deepEqual(Array.from(requests,event=>event.partition.offset),[0,20,40]);
 assert.deepEqual(Array.from(responses,event=>event.responseOffset),[0,20,40]);
 assert.deepEqual(Array.from(responses,event=>event.expectedNextOffset),[20,40,43]);
 assert.deepEqual(Array.from(responses,event=>event.itemCount),[20,20,3]);
 assert.deepEqual(Array.from(responses,event=>event.paginationHint),[true,true,false]);
 assert.deepEqual(Array.from(responses,event=>event.pageDecision),['request_next_page','request_next_page','stop_end_confirmed']);
 assert.deepEqual(Array.from(responses,event=>event.newIdentityCount),[20,20,3]);
 const serialized=JSON.stringify(state);
 for(const secret of ['PRIVATE_CHAT_','PRIVATE_TITLE','PRIVATE_QUERY','ephemeral-secret','cycle-token-private'])assert.equal(serialized.includes(secret),false);
});

test('root response without explicit pagination hint stays waiting and does not imply an end or next request',async()=>{
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>({offset:20,limit:20,items:[{id:'PRIVATE_CHAT',title:'PRIVATE_TITLE',update_time:'2026-10-26T00:00:00Z'}]})})}),null,[],{token:'cycle-token-private',secret:'ephemeral-secret'});
 c.window.gptRateLimitContext={owner:'scheduler_discovery',generation:'cycle-token-private',stage:'scheduler_discovery'};
 await c.window.fetch('/backend-api/conversations?offset=20&limit=20');await new Promise(setImmediate);
 const events=c.window.gptListRootDiscoveryState('cycle-token-private').rootHookEvents.filter(event=>event.category==='root_conversation_list'&&event.source==='hook');
 assert.deepEqual(Array.from(events,event=>event.event),['request','response']);
 assert.equal(events[1].paginationHint,null);assert.equal(events[1].pageDecision,'waiting_frontend');
 assert.equal(events[1].expectedNextOffset,21);
});

test('root identity progress is tracked per sanitized partition shape',async()=>{
 const payload={offset:0,limit:20,has_more:true,items:[{id:'PRIVATE_CHAT',title:'PRIVATE_TITLE',update_time:'2026-10-26T00:00:00Z'}]};
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>payload})}),null,[],{token:'cycle-token-private',secret:'ephemeral-secret'});
 c.window.gptRateLimitContext={owner:'scheduler_discovery',generation:'cycle-token-private',stage:'scheduler_discovery'};
 await c.window.fetch('/backend-api/conversations?is_archived=false&is_starred=false&conversation_origin=PRIVATE_ORIGIN&offset=0');
 await c.window.fetch('/backend-api/conversations?is_archived=false&is_starred=false&exclude_conversation_origin=PRIVATE_ORIGIN&offset=0');
 await c.window.fetch('/backend-api/conversations?is_archived=false&is_starred=false&conversation_origin=PRIVATE_ORIGIN&offset=20');
 await new Promise(setImmediate);
 const events=c.window.gptListRootDiscoveryState('cycle-token-private').rootHookEvents.filter(event=>event.category==='root_conversation_list'&&event.event==='response');
 assert.deepEqual(Array.from(events,event=>event.partitionShape),[
  'archived:false;starred:false;origin:include','archived:false;starred:false;origin:exclude','archived:false;starred:false;origin:include'
 ]);
 assert.deepEqual(Array.from(events,event=>event.newIdentityCount),[1,1,0]);
 assert.deepEqual(Array.from(events,event=>event.identityCountReliable),[true,true,true]);
 const serialized=JSON.stringify(events);
 for(const secret of ['PRIVATE_CHAT','PRIVATE_TITLE','PRIVATE_ORIGIN','ephemeral-secret'])assert.equal(serialized.includes(secret),false);
});

test('resource timing is isolated from list hook events and cannot evict them',async()=>{
 const entries=Array.from({length:120},(_,index)=>({name:`https://chatgpt.com/backend-api/conversations?offset=${index}`,initiatorType:'fetch',startTime:index+1,responseEnd:index+2,responseStatus:200,transferSize:10}));
 const payload={items:[{id:'PRIVATE_ID',title:'PRIVATE_TITLE'}]};
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>payload})}),null,entries,{token:'cycle-token-private',secret:'ephemeral-secret'});
 c.window.gptListDiagnosticSnapshot();c.window.gptListRootDiscoveryState('cycle-token-private');
 await c.window.fetch('/backend-api/conversations?is_archived=false&is_starred=true&offset=20&limit=10&cursor=PRIVATE_CURSOR');await new Promise(setImmediate);
 const state=c.window.gptListRootDiscoveryState('cycle-token-private');
 assert.equal(state.rootHookEvents.some(event=>event.pathname==='/backend-api/conversations'&&event.event==='request'),true);
 assert.ok(state.rootResourceEvents.length<=80);assert.ok(state.rootResourceEvents.length>0);
 const root=state.rootHookEvents.find(event=>event.pathname==='/backend-api/conversations'&&event.event==='request');
 assert.deepEqual(JSON.parse(JSON.stringify(root.partition)),{archived:false,starred:true,includeOriginPresent:false,excludeOriginPresent:false,offset:20,limit:10,cursorPresent:true});
 assert.equal(JSON.stringify(state).includes('PRIVATE_CURSOR'),false);assert.equal(JSON.stringify(state).includes('PRIVATE_ID'),false);assert.equal(JSON.stringify(state).includes('PRIVATE_TITLE'),false);
});

test('root discovery lifecycle snapshot distinguishes navigation metadata and timing-only resource hints',()=>{
 const entries=[{name:'https://chatgpt.com/backend-api/conversations?cursor=private',initiatorType:'fetch',startTime:10,responseEnd:20,responseStatus:200,transferSize:0}];
 const c=makeContext(async()=>{throw Error('unused');},null,entries,{token:'cycle-token-private',secret:'ephemeral-secret'});
 c.context.performance.timeOrigin=1761000000000;c.context.performance.now=()=>1234;
 c.context.performance.getEntriesByType=kind=>kind==='navigation'?[{type:'reload',responseStatus:200}]:entries;
 c.window.gptListDiagnosticSnapshot();
 const state=c.window.gptListRootDiscoveryState('cycle-token-private');
 assert.deepEqual(JSON.parse(JSON.stringify(state.documentLifecycle)),{timeOrigin:1761000000000,navigationType:'reload',navigationResponseStatus:200,pageshowPersisted:null,documentAgeMs:1234});
 assert.equal(state.rootBackendTraffic.root_conversation_list.resource.requests,1);
 assert.equal(state.rootBackendTraffic.root_conversation_list.resource.responses,1);
 assert.equal(state.rootBackendTraffic.root_conversation_list.resource.zeroTransfer,1);
 assert.equal(JSON.stringify(state).includes('cursor=private'),false);
});

test('resource diagnostics include safe backend paths and mark only the conversations list endpoint',()=>{
 const entries=[
  {name:'https://chatgpt.com/backend-api/conversations?cursor=private',initiatorType:'fetch',startTime:10,responseEnd:20,responseStatus:200},
  {name:'https://chatgpt.com/backend-api/conversations/private-conversation-id/messages?cursor=private',initiatorType:'fetch',startTime:30,responseEnd:40,responseStatus:200},
  {name:'https://chatgpt.com/backend-api/gizmos/g-p-6ad6262c149081919af4cb6e8b3b7df7/conversations',initiatorType:'fetch',startTime:50,responseEnd:60,responseStatus:200},
  {name:'https://chatgpt.com/backend-api/estuary/public_content/enc/eyJpZCI6ImZha2UtdG9rZW4tY2Fycnlpbmctc2Vuc2l0aXZlLXZhbHVlLWZha2UtdG9rZW4tY2Fycnlpbmctc2Vuc2l0aXZlLXZhbHVlLWZha2U=',initiatorType:'fetch',startTime:70,responseEnd:80,responseStatus:200}
 ];
 const c=makeContext(async()=>{throw Error('unused');},null,entries);c.window.gptListDiagnosticSnapshot();
 const resources=c.diagnostics.filter(x=>x.event==='resource');
 assert.equal(resources.length,4);assert.equal(resources[0].isConversationList,true);assert.equal(resources[1].isConversationList,false);
 assert.equal(resources[1].pathname,'/backend-api/conversations/:id/messages');
 assert.equal(resources[2].isConversationList,true);assert.equal(resources[2].pathname,'/backend-api/gizmos/:id/conversations');
 assert.equal(resources[3].pathname,'/backend-api/estuary/public_content/enc/:id');
 const page=c.diagnostics.find(x=>x.event==='page');assert.equal(page.backendResources.length,4);
 const serialized=JSON.stringify(c.diagnostics);
 for(const secret of ['private-conversation-id','cursor=private','g-p-6ad6262c149081919af4cb6e8b3b7df7','fake-token-carrying-sensitive-value'])assert.equal(serialized.includes(secret),false);
});

test('gizmo-scoped conversation list response is passively recognized and sanitized',async()=>{
 const response={status:200,clone:()=>({json:async()=>payload})};const c=makeContext(async()=>response);
 await c.window.fetch('/backend-api/gizmos/g-p-6ad6262c149081919af4cb6e8b3b7df7/conversations?offset=0&cursor=private');await new Promise(setImmediate);
 assert.deepEqual(c.diagnostics.map(x=>x.event),['request','response','parsed']);
 assert.equal(c.diagnostics[0].pathname,'/backend-api/gizmos/:id/conversations');assert.equal(c.diagnostics[2].recognized,true);
 assert.equal(c.pages.length,1);assert.equal(c.pages[0].path,'/backend-api/gizmos/:id/conversations');
 const serialized=JSON.stringify(c.diagnostics);
 for(const secret of ['g-p-6ad6262c149081919af4cb6e8b3b7df7','cursor=private','private-conversation-id','private title','private body'])assert.equal(serialized.includes(secret),false);
 assert.equal(c.pages[0].records[0].conversationId,'private-conversation-id');
 assert.equal(c.pages[0].scope,'project');assert.equal(c.pages[0].paginationKind,'offset');assert.equal(c.pages[0].offset,0);
});

test('pinned source comparison stays in page memory and returns only endpoint metadata and counts',async()=>{
 const payload={items:[{id:'PRIVATE-PINNED-ID',title:'PRIVATE_TITLE',update_time:new Date(Date.now()-60000).toISOString()}],offset:0,limit:20};
 const response={status:200,clone:()=>({json:async()=>payload})};const c=makeContext(async()=>response);
 await c.window.fetch('/backend-api/conversations?is_archived=false&is_starred=false&offset=0');await c.waitPages(1);
 const summary=c.window.gptSummarizePinnedLinkSources(['PRIVATE-PINNED-ID']);
 assert.equal(summary.baseSourceAvailable,true);assert.equal(summary.baseOverlapCount,1);assert.equal(summary.networkMatchedCount,1);
 assert.equal(summary.updatedAtCount,1);assert.equal(summary.recentCount,1);
 assert.deepEqual(JSON.parse(JSON.stringify(summary.sources[0])),{method:'GET',pathname:'/backend-api/conversations',status:200,queryKeys:['is_archived','is_starred','offset'],itemCount:1,containsUpdateTime:true});
 for(const secret of ['PRIVATE-PINNED-ID','PRIVATE_TITLE'])assert.equal(JSON.stringify(summary).includes(secret),false);
});

test('initial-load starred=true stream is reported as safe source metadata before any UI interaction',async()=>{
 const privatePayload={items:[{id:'PRIVATE-CHAT-ID',title:'PRIVATE_CHAT_TITLE',update_time:new Date(Date.now()-120000).toISOString()}],offset:0,limit:20};
 const response={status:200,clone:()=>({json:async()=>privatePayload})};const c=makeContext(async()=>response);
 await c.window.fetch('/backend-api/conversations?is_archived=false&is_starred=false&offset=0');await c.waitPages(1);
 await c.window.fetch('/backend-api/conversations?is_archived=false&is_starred=true&offset=0');await c.waitPages(2);
 const summary=c.window.gptSummarizePinnedLinkSources([]);
 assert.equal(summary.baseSourceAvailable,true);assert.equal(summary.starredTrueSourceAvailable,true);
 assert.equal(summary.starredTrueOverlapCount,0);assert.equal(summary.observedStreams.length,2);
 assert.deepEqual(JSON.parse(JSON.stringify(summary.observedStreams.map(x=>x.starred))),[false,true]);
 assert.equal(summary.observedStreams[1].containsUpdateTime,true);assert.equal(summary.observedStreams[1].status,200);
 assert.deepEqual(Array.from(summary.observedStreams[1].queryKeys),['is_archived','is_starred','offset']);
 for(const secret of ['PRIVATE-CHAT-ID','PRIVATE_CHAT_TITLE'])assert.equal(JSON.stringify(summary).includes(secret),false);
});

test('global cursor pages expose only safe cursor metadata and retain no opaque cursor value',async()=>{
 const cursorPayload={items:[{id:'private-id',title:'private title',update_time:'2026-10-23T16:00:00Z'}],cursor:{opaque:'SECRET_CURSOR_VALUE'}};
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>cursorPayload})}));
 await c.window.fetch('/backend-api/conversations?cursor=private-query');await new Promise(setImmediate);
 const page=c.pages[0];assert.equal(page.scope,'global');assert.equal(page.paginationKind,'cursor');
 assert.equal(page.cursorPresent,true);assert.equal(page.cursorNull,false);assert.equal(page.cursorType,'object');
 assert.equal(page.sequence,1);assert.equal(page.itemCount,1);assert.equal(page.timestampsValid,true);
 const serialized=JSON.stringify({diagnostics:c.diagnostics,page:{...page,records:page.records.map(({conversationId,title,updatedAt})=>({title,updatedAt}))}});
 for(const secret of ['SECRET_CURSOR_VALUE','private-query','private-id'])assert.equal(serialized.includes(secret),false);
 assert.equal(JSON.stringify(c.diagnostics).includes('private title'),false);
 assert.equal(page.records[0].conversationId,'private-id');
});

test('pagination and ordering query parameters remain account-wide candidate controls',async()=>{
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>payload})}));
 await c.window.fetch('/backend-api/conversations?offset=20&limit=20&order=updated&cursor=opaque-cursor');await new Promise(setImmediate);
 const page=c.pages[0];assert.equal(page.scope,'global');assert.equal(page.queryClassification,'pagination_or_order_only');
 assert.equal(Array.from(page.queryKeys).join(','),'cursor,limit,offset,order');
 assert.equal(JSON.stringify(page.queryValues),JSON.stringify({cursor:'<present>',limit:20,offset:20,order:'updated'}));
 assert.equal(page.offset,0);assert.equal(page.limit,20);
 const serialized=JSON.stringify({diagnostics:c.diagnostics,pages:c.pages.map(({records,...safe})=>safe)});
 assert.equal(serialized.includes('opaque-cursor'),false);
});

test('unknown opaque query values are redacted and do not imply a confirmed scope filter',async()=>{
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>payload})}));
 await c.window.fetch('/backend-api/conversations?mystery=secret-search-or-token');await new Promise(setImmediate);
 assert.equal(c.pages[0].scope,'unclassified');assert.equal(c.pages[0].queryClassification,'unclassified_parameter');
 assert.equal(Array.from(c.pages[0].queryKeys).join(','),'mystery');assert.equal(JSON.stringify(c.pages[0].queryValues),JSON.stringify({mystery:'<redacted>'}));
 assert.equal(JSON.stringify(c.diagnostics).includes('secret-search-or-token'),false);
});

test('query string presence alone does not mark pagination-only stream filtered',async()=>{
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>payload})}));
 await c.window.fetch('/backend-api/conversations?limit=20');await new Promise(setImmediate);
 assert.equal(c.pages[0].scope,'global');assert.equal(c.pages[0].queryClassification,'pagination_or_order_only');
});

test('project and query-filtered list responses cannot be mislabeled as account-wide global',async()=>{
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>payload})}));
 await c.window.fetch('/backend-api/gizmos/short-sensitive-gizmo-id/conversations?cursor=secret');
 await c.window.fetch('/backend-api/conversations?is_starred=true&token=secret');await new Promise(setImmediate);
 assert.deepEqual(c.pages.map(x=>x.scope),['project','filtered']);
 assert.equal(c.pages[0].path,'/backend-api/gizmos/:id/conversations');
 assert.equal(JSON.stringify(c.diagnostics).includes('short-sensitive-gizmo-id'),false);
 assert.equal(JSON.stringify(c.diagnostics).includes('secret'),false);
});

test('observed scope filters partition root streams while offset pages share a stream without retaining filter values',async()=>{
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>payload})}));
 await c.window.fetch('/backend-api/conversations?is_archived=false&is_starred=false&limit=20&offset=0&order=updated&conversation_origin=project-secret');
 await c.window.fetch('/backend-api/conversations?is_archived=false&is_starred=false&limit=20&offset=20&order=updated&conversation_origin=project-secret');
 await c.window.fetch('/backend-api/conversations?is_archived=false&is_starred=false&limit=20&offset=0&order=updated&exclude_conversation_origin=project-secret');
 await new Promise(setImmediate);
 assert.equal(c.pages[0].scope,'filtered');assert.equal(c.pages[1].scope,'filtered');assert.equal(c.pages[2].scope,'filtered');
 assert.equal(c.pages[0].streamId,c.pages[1].streamId);assert.notEqual(c.pages[0].streamId,c.pages[2].streamId);
 assert.equal(c.pages[0].queryClassification,'scope_filter');
 const serialized=JSON.stringify(c.diagnostics);
 for(const secret of ['project-secret','is_archived=false','is_starred=false'])assert.equal(serialized.includes(secret),false);
});

test('fetch reassignment remains passively wrapped and parser output stays sanitized',async()=>{
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>payload})}));
 c.window.fetch=async()=>({status:200,clone:()=>({json:async()=>payload})});
 await c.window.fetch('/backend-api/conversations?cursor=private-cursor&token=private-token');await new Promise(setImmediate);
 assert.deepEqual(c.diagnostics.map(x=>x.event),['request','response','parsed']);
 assert.equal(c.diagnostics[0].transport,'fetch');assert.equal(c.diagnostics[1].status,200);assert.equal(c.diagnostics[2].recognized,true);
 c.window.gptListDiagnosticSnapshot();
 const page=c.diagnostics.find(x=>x.event==='page');assert.equal(page.fetchHookActive,true);assert.equal(page.fetchAssignments,1);
 const serialized=JSON.stringify(c.diagnostics);
 for(const secret of ['private-cursor','private-token','private-conversation-id','private title','private body'])assert.equal(serialized.includes(secret),false);
});

test('XHR open/send reassignment remains wrapped',()=>{
 const c=makeContext(async()=>{throw Error('not used');},{status:200,body:JSON.stringify(payload)});
 c.XHR.prototype.open=function(method,url){this.method=method;this.url=url;};
 c.XHR.prototype.send=function(){for(const fn of this.listeners.load||[])fn();};
 const xhr=new c.XHR();xhr.open('GET','/backend-api/conversations?query=private');xhr.send();
 assert.deepEqual(c.diagnostics.map(x=>x.event),['request','response','parsed']);
 assert.equal(c.diagnostics[0].transport,'XHR');assert.equal(c.diagnostics[2].recognized,true);
 c.window.gptListDiagnosticSnapshot();
 const page=c.diagnostics.find(x=>x.event==='page');assert.equal(page.xhrHookActive,true);assert.equal(page.xhrOpenAssignments,1);assert.equal(page.xhrSendAssignments,1);
 assert.equal(JSON.stringify(c.diagnostics).includes('private'),false);
});

test('origin equality survives document navigation within a cycle but changes with a fresh cycle secret',async()=>{
 const response=async()=>({status:200,clone:()=>({json:async()=>payload})});
 const config={token:'cycle-one',secret:'random-cycle-one-secret'};
 const a=makeContext(response,null,[],config),b=makeContext(response,null,[],config);
 const c=makeContext(response,null,[],{token:'cycle-two',secret:'different-random-cycle-secret'});
 await a.window.fetch('/backend-api/conversations?conversation_origin=RAW_PRIVATE_ORIGIN&is_archived=false&is_starred=false&offset=0&limit=20&order=updated');
 await b.window.fetch('/backend-api/conversations?exclude_conversation_origin=RAW_PRIVATE_ORIGIN&is_archived=false&is_starred=false&offset=20&limit=20&order=updated');
 await c.window.fetch('/backend-api/conversations?conversation_origin=RAW_PRIVATE_ORIGIN&is_archived=false&is_starred=false&offset=0&limit=20&order=updated');
 await Promise.all([a.waitPages(1),b.waitPages(1),c.waitPages(1)]);
 const first=a.pages[0].partitionDescriptor,excluded=b.pages[0].partitionDescriptor;
 assert.equal(first.valid,true);assert.equal(first.archived,false);assert.equal(first.starred,false);
 assert.equal(first.includeOrigin,excluded.excludeOrigin);
 assert.notEqual(first.includeOrigin,c.pages[0].partitionDescriptor.includeOrigin);
 assert.match(first.includeOrigin,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify([a.diagnostics,b.diagnostics,c.diagnostics,a.pages,b.pages,c.pages]).includes('RAW_PRIVATE_ORIGIN'),false);
 assert.equal(a.pages[0].cycleToken,'cycle-one');assert.equal(c.pages[0].cycleToken,'cycle-two');
});

test('boolean selectors remain booleans and malformed or duplicate selectors cannot prove a partition',async()=>{
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>payload})}));
 for(const query of ['is_archived=true&is_starred=false','is_archived=maybe','is_starred=true&is_starred=false'])await c.window.fetch('/backend-api/conversations?'+query);
 await c.waitPages(3);
 assert.equal(c.pages[0].queryValues.is_archived,true);assert.equal(c.pages[0].queryValues.is_starred,false);
 assert.equal(c.pages[0].partitionDescriptor.valid,true);
 assert.equal(c.pages[1].partitionDescriptor.valid,false);assert.equal(c.pages[2].partitionDescriptor.valid,false);
});

test('pagination and unknown controls do not enter partition identity; unknown selectors block proof',async()=>{
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>payload})}));
 for(const query of ['is_archived=false&offset=0&limit=20&order=updated&expand=opaque&hide_snorlax=true','is_archived=false&offset=20&limit=20&order=updated&expand=other','is_archived=false&new_selector=opaque-secret'])await c.window.fetch('/backend-api/conversations?'+query);
 await c.waitPages(3);
 assert.equal(JSON.stringify(c.pages[0].partitionDescriptor),JSON.stringify(c.pages[1].partitionDescriptor));
 assert.equal(c.pages[2].partitionDescriptor.valid,false);
 assert.equal(JSON.stringify(c.diagnostics).includes('opaque-secret'),false);
});

test('expired cycle cannot deliver an origin result to the next cycle',async()=>{
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>payload})}),null,[],{token:'old-cycle',secret:'secret'});
 await c.window.fetch('/backend-api/conversations?conversation_origin=PRIVATE');
 c.window.gptListCycleConfig={token:'new-cycle',secret:'new-secret'};
 await new Promise(r=>setTimeout(r,30));
 assert.equal(c.pages.length,0);
});

test('safe HTTP status reaches partition proof without headers or body retention',async()=>{
 const c=makeContext(async()=>({status:503,clone:()=>({json:async()=>({items:[],offset:0,limit:20})})}));
 await c.window.fetch('/backend-api/conversations?offset=0&limit=20&order=updated');await c.waitPages(1);
 assert.equal(c.pages[0].httpStatus,503);assert.equal('headers' in c.pages[0],false);
});

test('async origin sanitization preserves the natural response observation sequence',async()=>{
 const crypto=require('node:crypto').webcrypto;let calls=0;
 const delayedCrypto={subtle:{importKey:(...args)=>crypto.subtle.importKey(...args),sign:async(...args)=>{if(++calls===1)await new Promise(r=>setTimeout(r,30));return crypto.subtle.sign(...args);}}};
 const c=makeContext(async raw=>({status:200,clone:()=>({json:async()=>({...payload,offset:raw.includes('offset=20')?20:0})})}),null,[],{token:'cycle',secret:'ephemeral-secret'},delayedCrypto);
 await Promise.all([c.window.fetch('/backend-api/conversations?conversation_origin=opaque&offset=0'),c.window.fetch('/backend-api/conversations?conversation_origin=opaque&offset=20')]);
 await c.waitPages(2);assert.deepEqual(c.pages.map(x=>x.offset),[0,20]);assert.deepEqual(c.pages.map(x=>x.sequence),[1,2]);
});

test('failed root responses still expose only safe attempted partition descriptors and no history pages',async()=>{
 const c=makeContext(async()=>({status:429,clone:()=>({json:async()=>({status:'rate limited'})})}),null,[],{token:'cycle',secret:'ephemeral-key'});
 await c.window.fetch('/backend-api/conversations?conversation_origin=PRIVATE_ORIGIN&is_archived=false&is_starred=false&offset=0&order=updated');
 await c.window.fetch('/backend-api/conversations?exclude_conversation_origin=PRIVATE_ORIGIN&is_archived=false&is_starred=false&offset=0&order=updated');
 await c.waitDiagnostics('partition_request',2);
 const descriptors=c.diagnostics.filter(x=>x.event==='partition_request').map(x=>x.partitionDescriptor);
 assert.equal(descriptors[0].includeOrigin,descriptors[1].excludeOrigin);
 assert.equal(descriptors[0].archived,false);assert.equal(descriptors[0].starred,false);
 assert.equal(c.pages.length,0);assert.equal(JSON.stringify(c.diagnostics).includes('PRIVATE_ORIGIN'),false);
});

test('pinned metadata uses passive list update_time locally and excludes unknown IDs',async()=>{
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>payload})}));
 await c.window.fetch('/backend-api/conversations?is_archived=false&is_starred=false');await c.waitPages(1);
 const records=c.window.gptResolvePinnedRecords(['private-conversation-id','unseen']);
 assert.equal(records[0].lastActivityAt,Date.parse(payload.items[0].update_time));assert.equal(records[0].activitySource,'root_conversation_list.update_time');assert.equal(records[1].lastActivityAt,undefined);
 assert.equal(records[0].passiveMatch,true);assert.equal(records[0].matchingMetadataRecords,1);assert.equal(records[0].updateTimePresent,true);assert.equal(records[1].passiveMatch,false);assert.equal(records[1].matchingMetadataRecords,0);
});
test('pinned update_time provenance distinguishes root from project list families',async()=>{
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>payload})}));
 await c.window.fetch('/backend-api/gizmos/private-project/conversations');await c.waitPages(1);
 const [record]=c.window.gptResolvePinnedRecords(['private-conversation-id']);
 assert.equal(record.activitySource,'project_conversation_list.update_time');assert.equal(record.lastActivityAt,Date.parse(payload.items[0].update_time));
 assert.equal(JSON.stringify(record).includes('private-project'),false);
});
test('pinned timestamp fallback uses already captured conversation-level activity fields after update_time',async()=>{
 const alternate={items:[{id:'PRIVATE-CONVERSATION-ID',title:'PRIVATE_TITLE',updated_at:new Date(Date.now()-60000).toISOString(),snippet:'PRIVATE_TEXT'}]};
 const c=makeContext(async()=>({status:200,clone:()=>({json:async()=>alternate})}));
 await c.window.fetch('/backend-api/conversations?is_archived=false&is_starred=false');await c.waitPages(1);
 const [record]=c.window.gptResolvePinnedRecords(['PRIVATE-CONVERSATION-ID']);
 assert.equal(record.activitySource,'root_conversation_list.activity_metadata');assert.ok(record.lastActivityAt>0);assert.equal(JSON.stringify(record).includes('PRIVATE_TITLE'),false);assert.equal(JSON.stringify(record).includes('PRIVATE_TEXT'),false);
});

test('conversation response delegates to sanitized activity observer without own requests',async()=>{
 let requests=0;const c=makeContext(async()=>{requests++;return {status:200,clone:()=>({json:async()=>({update_time:123})})};});let observed;
 c.window.gptObserveConversationActivity=(url,body,status)=>{observed={body,status};};
 await c.window.fetch('/backend-api/conversation/internal-chat');await new Promise(setImmediate);
 assert.equal(requests,1);assert.equal(observed.status,200);assert.equal(observed.body.update_time,123);
});
test('messages activity response is passively observed without creating a request',async()=>{
 let requests=0;const c=makeContext(async()=>{requests++;return {status:200,clone:()=>({json:async()=>({update_time:123})})};});let observed;
 c.window.gptObserveConversationActivity=(url,body,status)=>{observed={url,body,status};};
 await c.window.fetch('/backend-api/conversations/internal-chat/messages?private=secret');await new Promise(setImmediate);
 assert.equal(requests,1);assert.equal(observed.status,200);assert.equal(observed.body.update_time,123);assert.ok(observed.url.includes('/messages'));
});

test('conversation 429 is observed before body parsing, including a non-JSON response',async()=>{
 const c=makeContext(async()=>({status:429,clone:()=>{throw Error('must not parse 429 body');}}));let observed;
 c.window.gptObserveConversationActivity=(url,body,status)=>{observed={body,status};};
 await c.window.fetch('/backend-api/conversation/internal-chat');assert.equal(observed.status,429);assert.equal(observed.body,null);
});


test('unclassified ChatGPT backend responses are passively observed without opening a diagnostic window',async()=>{
 let requests=0,observed=[];
 const c=makeContext(async()=>{requests++;return {status:200,clone:()=>({json:async()=>({id:'private-model-id',name:'private'})})};});
 c.window.gptObserveBackendResponse=(raw,payload,status)=>observed.push({raw,payload,status});
 await c.window.fetch('/backend-api/models');await new Promise(setImmediate);
 assert.equal(requests,1);assert.equal(observed.length,1);assert.equal(observed[0].status,200);
 assert.equal(observed[0].raw,'/backend-api/models');assert.equal(observed[0].payload.id,'private-model-id');
 assert.equal(c.diagnostics.length,0);assert.equal(c.pages.length,0);
});

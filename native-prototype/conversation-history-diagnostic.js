(()=>{
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number.isFinite(Number(value))?Math.floor(Number(value)):min));
 const safeName=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)?value:null;
 const safeRole=value=>['article','listitem','row','group','generic','main','region'].includes(value)?value:'other';
 const apiURL=raw=>{try{const value=typeof raw==='string'?raw:raw?.url;const url=new URL(value,location.href);return url.origin===location.origin&&url.pathname.startsWith('/backend-api/')?url:null;}catch{return null;}};
 const historyPath=path=>/(conversation|message|history|thread|chat)/i.test(path);
 const endpointTemplate=path=>{
  if(typeof path!=='string'||!path.startsWith('/backend-api/'))return '/backend-api/:path';
  const parts=path.split('/').filter(Boolean),known=new Set(['backend-api','conversation','conversations','messages','message','history','threads','thread','chat','f','gizmos','list','items','search','page','read','slice','completion','completions']);
  for(let i=1;i<parts.length;i++){
   const previous=parts[i-1].toLowerCase(),part=parts[i];
   if(['conversation','conversations','thread','threads','chat','gizmos'].includes(previous)){parts[i]=':id';continue;}
   if(/^[A-Fa-f0-9-]{16,}$/.test(part)||/^[A-Za-z0-9_-]{24,}$/.test(part)){parts[i]=':id';continue;}
   if(!known.has(part.toLowerCase())&&!/^:/.test(part))parts[i]=':segment';
  }
  return '/'+parts.slice(0,9).join('/');
 };
 const route=()=>{
  if(location.origin!=='https://chatgpt.com')return {template:'other',category:'other'};
  const parts=location.pathname.split('/').filter(Boolean);
  if(parts.length===2&&parts[0]==='c')return {template:'/c/:id',category:'chat'};
  if(parts.length===4&&parts[0]==='g'&&parts[2]==='c')return {template:'/g/:id/c/:id',category:'chat'};
  if(parts.length===1&&/^[A-Za-z0-9_-]{1,128}$/.test(parts[0]))return {template:'/:id',category:'chat'};
  if(parts.length===2&&parts.every(part=>/^[A-Za-z0-9_-]{1,128}$/.test(part)))return {template:'/:id/:id',category:'chat'};
  return {template:location.pathname==='/'?'home':'other',category:location.pathname==='/'?'home':'other'};
 };
 const snapshotDOM=maxNodes=>{
  const started=performance.now(),root=document.querySelector('main')||document.body;
  if(!root)return {candidateCount:0,visibleCandidateCount:0,shapes:[],markerAttributeNames:[],scrollableContainerCount:0,lazyVirtualized:false,paginationAttributeNames:[],paginationElementCount:0,scannedNodeCount:0,truncated:false};
  const nodes=[root];let truncated=false;
  try{const walker=document.createTreeWalker(root,1);let next=walker.nextNode();while(next&&nodes.length<maxNodes&&performance.now()-started<1000){nodes.push(next);next=walker.nextNode();}truncated=!!next||performance.now()-started>=1000;}catch{const fallback=Array.from(root.querySelectorAll?.('*')||[]);nodes.push(...fallback.slice(0,maxNodes-1));truncated=fallback.length>=maxNodes;}
  const candidates=[],markerNames=new Set(),paginationNames=new Set();let scrollable=0,paginationElements=0,lazy=false;
  for(const node of nodes){
   if(performance.now()-started>=1000){truncated=true;break;}
   const attrs=Array.from(node.attributes||[]).map(attr=>String(attr.name||'').toLowerCase()).filter(name=>/^[a-z][a-z0-9_-]{0,63}$/.test(name));
   const dataNames=attrs.filter(name=>name.startsWith('data-'));
   const marker=attrs.filter(name=>['data-message-author-role','data-message-id','data-testid','data-turn-id','data-message-index','role'].includes(name)||name.startsWith('aria-')&&/(row|posinset|setsize)/.test(name));
   for(const name of marker)markerNames.add(name);
   const testId=attrs.includes('data-testid')?String(node.getAttribute?.('data-testid')||'').toLowerCase():'';
   const candidate=attrs.includes('data-message-author-role')||attrs.includes('data-message-id')||attrs.includes('data-turn-id')||/conversation[-_]turn|message[-_]turn/.test(testId);
   if(candidate)candidates.push({node,tag:String(node.tagName||'unknown').toLowerCase().slice(0,16),role:safeRole(String(node.getAttribute?.('role')||'').toLowerCase()),dataNames:dataNames.slice(0,16)});
   const pagination=dataNames.filter(name=>/(page|previous|older|history|load.?more|sentinel)/.test(name));
   if(pagination.length){paginationElements++;for(const name of pagination)paginationNames.add(name);}
   if(dataNames.some(name=>/(virtual|lazy|sentinel|list-index|row-index)/.test(name))||attrs.includes('aria-setsize')||attrs.includes('aria-posinset'))lazy=true;
   let style={};try{style=getComputedStyle(node);}catch{}
   const height=Number(node.clientHeight)||0,width=Number(node.clientWidth)||0,scrollHeight=Number(node.scrollHeight)||0,scrollWidth=Number(node.scrollWidth)||0;
   if(/^(auto|scroll|overlay)$/.test(String(style.overflowY||''))&&(scrollHeight>height+2||scrollWidth>width+2))scrollable++;
  }
  const visible=candidates.filter(({node})=>{try{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0;}catch{return false;}});
  const shapes=new Map();for(const item of candidates){const key=[item.tag,item.role,item.dataNames.join(',')].join('|');const prior=shapes.get(key)||{tag:item.tag,role:item.role,dataAttributeNames:item.dataNames,count:0};prior.count++;shapes.set(key,prior);}
  const markers=Array.from(markerNames).sort();
  return {candidateCount:candidates.length,visibleCandidateCount:visible.length,shapes:Array.from(shapes.values()).slice(0,24),markerAttributeNames:markers,userAssistantMarkerPresent:markers.includes('data-message-author-role'),scrollableContainerCount:scrollable,lazyVirtualized:lazy,paginationAttributeNames:Array.from(paginationNames).sort(),paginationElementCount:paginationElements,scannedNodeCount:nodes.length,truncated:truncated||nodes.length>=maxNodes||performance.now()-started>1000};
 };
 const summarizePayload=payload=>{
  if(!payload||typeof payload!=='object')return {topLevelKeys:[],arrayCounts:[],recognized:false,rejectionReason:'json_unavailable'};
  const topLevelKeys=Object.keys(payload).map(safeName).filter(Boolean).slice(0,32);
  const arrayCounts=Object.entries(payload).filter(([,value])=>Array.isArray(value)).slice(0,12).map(([key,value])=>({key:safeName(key)||'unknown',count:Math.min(1000000,value.length)}));
  const recognized=['messages','mapping','items','conversation','conversation_id','conversationId'].some(key=>Object.prototype.hasOwnProperty.call(payload,key));
  return {topLevelKeys,arrayCounts,recognized,rejectionReason:recognized?'none':'unrecognized_payload_shape'};
 };
 const messageStructureSnapshot=(options={})=>{
  const started=performance.now(),maxNodes=clamp(options.maxNodes,100,3000),maxDepth=clamp(options.maxDepth,2,32),maxMs=clamp(options.maxMs,50,2500),currentRoute=route();
  const empty={result:'success',reason:'conversation_container_not_found',routeCategory:currentRoute.category,scannedNodeCount:0,truncated:false,openShadowRootCount:0,tagCounts:[],roleCounts:[],dataAttributeNames:[],ariaAttributeNames:[],markerCounts:{testId:0,message:0,turn:0,author:0,role:0},depthCounts:[],visibleElementCount:0,substantialHeightCount:0,scrollContainerCount:0,nestedVirtualizationContainerCount:0,repeatGroupCount:0,verticalRepeatGroupCount:0,candidateElementCount:0,candidateSignatureCount:0,signatures:[]};
  if(currentRoute.category!=='chat')return {...empty,result:'failure',reason:'not_chat_route'};
  let main=null;try{main=document.querySelector('main,[role="main"]');}catch{}
  if(!main)return empty;
  const visible=node=>{try{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0;}catch{return false;}};
  const scrollable=node=>{try{const s=getComputedStyle(node);return /^(auto|scroll|overlay)$/.test(String(s.overflowY||''))&&(Number(node.scrollHeight||0)>Number(node.clientHeight||0)+2);}catch{return false;}};
  let container=null,containerArea=-1,truncated=false;const candidates=[main];
  try{const walker=document.createTreeWalker(main,1);let next=walker.nextNode();while(next&&candidates.length<maxNodes&&performance.now()-started<maxMs){candidates.push(next);next=walker.nextNode();}if(next)truncated=true;}catch{const pending=Array.from(main.children||[]);while(pending.length&&candidates.length<maxNodes&&performance.now()-started<maxMs){const node=pending.shift();candidates.push(node);try{pending.push(...Array.from(node.children||[]));}catch{}}if(pending.length)truncated=true;}
  for(const node of candidates){if(!scrollable(node)||!visible(node))continue;let area=0;try{const r=node.getBoundingClientRect();area=Math.max(0,r.width)*Math.max(0,r.height);}catch{}if(area>containerArea){container=node;containerArea=area;}}
  if(!container)return empty;
  const tagCounts=new Map(),roleCounts=new Map(),dataNames=new Set(),ariaNames=new Set(),depthCounts=new Map(),sigMap=new Map(),elements=[];let marker={testId:0,message:0,turn:0,author:0,role:0},openShadowRootCount=0;
  const stack=[{node:container,depth:0}],seen=new Set();
  while(stack.length&&elements.length<maxNodes&&performance.now()-started<maxMs){const {node,depth}=stack.pop();if(!node||seen.has(node)||depth>maxDepth)continue;seen.add(node);if(node.nodeType!==1)continue;
   const tag=String(node.tagName||'unknown').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,16)||'unknown';let attrNames=[];try{attrNames=Array.from(node.attributes||[]).map(a=>String(a.name||'').toLowerCase()).filter(n=>/^[a-z][a-z0-9_-]{0,63}$/.test(n));}catch{}
   const roleRaw=(()=>{try{return String(node.getAttribute?.('role')||'').toLowerCase();}catch{return '';}})(),role=safeRole(roleRaw);
   const data=attrNames.filter(n=>n.startsWith('data-')),aria=attrNames.filter(n=>n.startsWith('aria-'));data.forEach(n=>dataNames.add(n));aria.forEach(n=>ariaNames.add(n));
   marker.testId+=attrNames.includes('data-testid')?1:0;marker.message+=data.some(n=>n.startsWith('data-message-'))?1:0;marker.turn+=data.some(n=>n.startsWith('data-turn-'))?1:0;marker.author+=data.some(n=>n.startsWith('data-author-'))?1:0;marker.role+=data.some(n=>n.startsWith('data-role-'))?1:0;
   tagCounts.set(tag,(tagCounts.get(tag)||0)+1);roleCounts.set(role,(roleCounts.get(role)||0)+1);depthCounts.set(depth,(depthCounts.get(depth)||0)+1);
   const isVisible=visible(node),rect=(()=>{try{return node.getBoundingClientRect();}catch{return {width:0,height:0,bottom:0,right:0};}})(),substantial=isVisible&&Number(rect.height)>=80;
   let childCount=0;try{childCount=Array.from(node.children||[]).length;}catch{}
   const signature=[tag,role,'data:'+data.slice(0,8).sort().join(','),'aria:'+aria.slice(0,6).sort().join(','),'children:'+Math.min(10,childCount)].join('|');
   const item={node,tag,role,data,aria,depth,visible:isVisible,substantial,signature,rect};elements.push(item);
   const prior=sigMap.get(signature)||{tag,role,dataAttributeNames:data.slice(0,8).sort(),ariaAttributeNames:aria.slice(0,6).sort(),depth,count:0,visibleCount:0,substantialHeightCount:0,verticalRepeatCount:0,candidateCount:0};prior.count++;if(isVisible)prior.visibleCount++;if(substantial)prior.substantialHeightCount++;
   const marked=data.some(n=>/(message|turn|author|role)/.test(n)),semantic=['article','listitem','row'].includes(role),candidate=marked||semantic;
   if(candidate)prior.candidateCount++;sigMap.set(signature,prior);
   if(node.shadowRoot){openShadowRootCount++;try{const kids=Array.from(node.shadowRoot.children||[]);for(let i=kids.length-1;i>=0;i--)stack.push({node:kids[i],depth:depth+1});}catch{}}
   try{const kids=Array.from(node.children||[]);for(let i=kids.length-1;i>=0;i--)stack.push({node:kids[i],depth:depth+1});}catch{}
  }
  if(stack.length||elements.length>=maxNodes||performance.now()-started>=maxMs)truncated=true;
  const siblings=new Map();for(const item of elements){const parent=item.node.parentElement;if(!parent)continue;const key=item.signature,list=siblings.get(parent)||new Map(),prior=list.get(key)||[];prior.push(item);list.set(key,prior);siblings.set(parent,list);}
  let repeatGroupCount=0,verticalRepeatGroupCount=0,scrollContainerCount=0,nestedVirtualizationContainerCount=0;
  for(const item of elements){if(scrollable(item.node))scrollContainerCount++;if(item.depth>0&&scrollable(item.node))nestedVirtualizationContainerCount++;}
  for(const groups of siblings.values())for(const [key,list] of groups){if(list.length<2)continue;repeatGroupCount++;const ordered=list.slice().sort((a,b)=>a.rect.top-b.rect.top);let vertical=0;for(let i=1;i<ordered.length;i++)if(Math.abs(Number(ordered[i].rect.top)-Number(ordered[i-1].rect.top))>=24)vertical++;if(vertical){verticalRepeatGroupCount++;const sig=sigMap.get(key);if(sig){sig.verticalRepeatCount=vertical+1;if(ordered.some(item=>item.substantial)&&sig.candidateCount===0)sig.candidateCount=ordered.length;}}}
  const candidateElementCount=Array.from(sigMap.values()).reduce((sum,s)=>sum+s.candidateCount,0);
  const signatures=Array.from(sigMap.values()).filter(s=>s.count>1||s.substantialHeightCount>0||s.candidateCount>0).sort((a,b)=>(b.candidateCount-a.candidateCount)||(b.count-a.count)||(b.substantialHeightCount-a.substantialHeightCount)).slice(0,24);
  const result={result:'success',reason:elements.length>1?'snapshot_complete':'empty_conversation_container',routeCategory:'chat',scannedNodeCount:elements.length,truncated,openShadowRootCount,tagCounts:Array.from(tagCounts).sort((a,b)=>b[1]-a[1]).slice(0,24).map(([name,count])=>({name,count})),roleCounts:Array.from(roleCounts).sort((a,b)=>b[1]-a[1]).slice(0,16).map(([name,count])=>({name,count})),dataAttributeNames:Array.from(dataNames).sort().slice(0,64),ariaAttributeNames:Array.from(ariaNames).sort().slice(0,64),markerCounts:marker,depthCounts:Array.from(depthCounts).sort((a,b)=>a[0]-b[0]).slice(0,16).map(([depth,count])=>({depth,count})),visibleElementCount:elements.filter(e=>e.visible).length,substantialHeightCount:elements.filter(e=>e.substantial).length,scrollContainerCount,nestedVirtualizationContainerCount,repeatGroupCount,verticalRepeatGroupCount,candidateElementCount,candidateSignatureCount:signatures.filter(s=>s.candidateCount>0).length,signatures};
  return result;
 };
 window.gptInspectCurrentMessageDOMStructure=(options={})=>{try{return messageStructureSnapshot(options);}catch{return {result:'failure',reason:'snapshot_failed',routeCategory:route().category,scannedNodeCount:0,truncated:false,openShadowRootCount:0,tagCounts:[],roleCounts:[],dataAttributeNames:[],ariaAttributeNames:[],markerCounts:{testId:0,message:0,turn:0,author:0,role:0},depthCounts:[],visibleElementCount:0,substantialHeightCount:0,scrollContainerCount:0,nestedVirtualizationContainerCount:0,repeatGroupCount:0,verticalRepeatGroupCount:0,candidateElementCount:0,candidateSignatureCount:0,signatures:[]};}};
 window.gptInspectCurrentChatHistorySource=async(options={})=>{
  const currentRoute=route();if(currentRoute.category!=='chat')return {result:'failure',reason:'not_chat_route',route:currentRoute,dom:null,network:[],durationMs:0};
  const durationMs=clamp(options.durationMs,100,6000),maxNodes=clamp(options.maxNodes,100,3000),started=performance.now();
  let dom;try{dom=snapshotDOM(maxNodes);}catch{dom={candidateCount:0,visibleCandidateCount:0,shapes:[],markerAttributeNames:[],scrollableContainerCount:0,lazyVirtualized:false,paginationAttributeNames:[],paginationElementCount:0,scannedNodeCount:0,truncated:false};}
  const events=[],active={value:true};
  const add=(path,transport,status,payload,error)=>{
   if(!active.value||events.length>=32)return;
   const safePath=endpointTemplate(path),summary=summarizePayload(payload);
   const safeStatus=Number.isSafeInteger(status)?Math.max(0,Math.min(599,status)):0;
   const knownHistory=/^\/backend-api\/(?:conversation|conversations|thread|threads)\/:id(?:\/messages)?\/?$/.test(safePath);
   events.push({endpointTemplate:safePath,transport:['fetch','XHR','resource'].includes(transport)?transport:'unknown',status:safeStatus,topLevelKeys:summary.topLevelKeys,arrayCounts:summary.arrayCounts,recognizedHistory:summary.recognized,parserRejectionReason:error?'network_failure':safeStatus>=400?'http_error':(summary.recognized?'none':summary.rejectionReason)});
  };
  const win=window,proto=win.XMLHttpRequest?.prototype,originalFetch=win.fetch,originalOpen=proto?.open,originalSend=proto?.send,requestInfo=new WeakMap();
  let wrappedFetch=null,wrappedOpen=null,wrappedSend=null;
  if(typeof originalFetch==='function'){
   wrappedFetch=function(input,init){const url=apiURL(input);if(url&&historyPath(url.pathname)&&active.value&&events.length<32)events.push({endpointTemplate:endpointTemplate(url.pathname),transport:'fetch',status:0,topLevelKeys:[],arrayCounts:[],recognizedHistory:false,parserRejectionReason:'request_observed'});return originalFetch.apply(this,arguments).then(response=>{if(url&&historyPath(url.pathname)){let clone;try{clone=response.clone();}catch{}if(clone)clone.json().then(payload=>add(url.pathname,'fetch',response.status,payload,false),()=>add(url.pathname,'fetch',response.status,null,false));else add(url.pathname,'fetch',response.status,null,false);}return response;},error=>{if(url&&historyPath(url.pathname))add(url.pathname,'fetch',0,null,true);throw error;});};
   try{Object.defineProperty(wrappedFetch,'__gptConversationHistoryDiagnostic',{value:true});win.fetch=wrappedFetch;}catch{wrappedFetch=null;}
  }
  if(proto&&typeof originalOpen==='function'&&typeof originalSend==='function'){
   wrappedOpen=function(method,url){const parsed=apiURL(url);requestInfo.set(this,parsed&&historyPath(parsed.pathname)?parsed.pathname:null);return originalOpen.apply(this,arguments);};
   wrappedSend=function(){const path=requestInfo.get(this);if(path&&active.value){if(events.length<32)events.push({endpointTemplate:endpointTemplate(path),transport:'XHR',status:0,topLevelKeys:[],arrayCounts:[],recognizedHistory:false,parserRejectionReason:'request_observed'});this.addEventListener('load',()=>{let payload=null,error=false;try{payload=this.responseType==='json'?this.response:JSON.parse(this.responseText);}catch{error=true;}add(path,'XHR',Number(this.status)||0,payload,error);},{once:true});this.addEventListener('error',()=>add(path,'XHR',0,null,true),{once:true});}return originalSend.apply(this,arguments);};
   try{proto.open=wrappedOpen;proto.send=wrappedSend;}catch{wrappedOpen=null;wrappedSend=null;}
  }
  const before=new Set();try{for(const entry of performance.getEntriesByType('resource'))before.add(entry.name);}catch{}
  let observer=null;try{observer=new PerformanceObserver(list=>{for(const entry of list.getEntries()){if(active.value&&!before.has(entry.name)){const url=apiURL(entry.name);if(url&&historyPath(url.pathname)&&events.length<32)add(url.pathname,'resource',Number(entry.responseStatus)||0,null,false);}}});observer.observe({type:'resource',buffered:false});}catch{}
  await new Promise(resolve=>setTimeout(resolve,durationMs));
  active.value=false;try{observer?.disconnect();}catch{}
  try{if(wrappedFetch&&win.fetch===wrappedFetch)win.fetch=originalFetch;}catch{}
  try{if(wrappedOpen&&proto.open===wrappedOpen)proto.open=originalOpen;if(wrappedSend&&proto.send===wrappedSend)proto.send=originalSend;}catch{}
  const responses=events.filter(event=>event.status>0),recognized=responses.some(event=>event.recognizedHistory);
  const knownEndpoint=event=>/^\/backend-api\/(?:conversation|conversations|thread|threads)\/:id(?:\/(?:messages|history))?\/?$/.test(event.endpointTemplate);
  const changedEndpoint=responses.some(event=>!knownEndpoint(event));
  const changedShape=responses.some(event=>knownEndpoint(event)&&!event.recognizedHistory);
  const reason=changedEndpoint?'history_network_endpoint_changed':changedShape?'history_response_shape_changed':recognized?'history_source_observed':events.some(event=>event.parserRejectionReason==='request_observed')?'history_not_loaded':dom.candidateCount?'history_present_in_dom_without_network':'history_not_loaded';
  return {result:'success',reason,route:currentRoute,dom,network:events.slice(0,32),requestCount:events.filter(event=>event.parserRejectionReason==='request_observed').length,responseCount:responses.length,durationMs:Math.max(0,Math.min(7000,Math.round(performance.now()-started)))};
 };
})();

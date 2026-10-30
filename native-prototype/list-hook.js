(() => {
 'use strict';
 let requestSequence=0,rootObservationSequence=0,nextProjectStream=1,nextQueryStream=10,starredNetworkWindow=null,observedListSources=[];
 let rootHookEvents=[],rootResourceEvents=[],rootSidebarTimeline=[],rootDiscoveryObservationToken=null,rootSidebarObserver=null,rootSidebarLastSignature=null,rootDiscoverySeenPageIds=new Map();
 const rootTrafficFamilies=['root_conversation_list','project_conversation_list','conversation_messages','conversation_detail','other_chatgpt_backend'];
 const rootTraffic=Object.fromEntries(rootTrafficFamilies.map(family=>[family,{fetch:{requests:0,responses:0,failures:0,statuses:{}},XHR:{requests:0,responses:0,failures:0,statuses:{}},resource:{requests:0,responses:0,failures:0,statuses:{},zeroTransfer:0}}]));
 let rootTrafficToken=null,rootPageShowPersisted=null;
 const projectStreams=new Map(),queryStreams=new Map(),streamSequences=new Map();
 let deliveryQueue=Promise.resolve();
 let fetchAssignments=0,xhrOpenAssignments=0,xhrSendAssignments=0;
 let rateLimitSequence=0;
 const activityTime=value=>{
  let time=NaN;if(typeof value==='number'&&Number.isFinite(value))time=value>1e12?value:value*1000;
  else if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value))time=Date.parse(value);
  return Number.isFinite(time)&&time>0&&time<=Date.now()?time:null;
 };
 const isConversationActivityPath=raw=>{
  try{return /^\/backend-api\/conversations?\/[A-Za-z0-9-]+(?:\/messages)?\/?$/.test(new URL(raw,location.href).pathname);}catch{return false;}
 };
 const isChatGPTBackendPath=raw=>{try{const url=new URL(raw,location.href);return url.origin==='https://chatgpt.com'&&url.pathname.startsWith('/backend-api/');}catch{return false;}};
 const observePassiveBackendResponse=(raw,response,rootObservation=null)=>{
  const status=Number.isFinite(response?.status)?response.status:0;
  if(status===429){finishRootDiscoveryObservation(rootObservation,status);window.gptObserveBackendResponse?.(raw,null,status);return;}
  try{response.clone().json().then(payload=>{finishRootDiscoveryObservation(rootObservation,status,payload);window.gptObserveBackendResponse?.(raw,payload,status);}).catch(()=>{finishRootDiscoveryObservation(rootObservation,status);window.gptObserveBackendResponse?.(raw,null,status);});}
  catch{finishRootDiscoveryObservation(rootObservation,status);window.gptObserveBackendResponse?.(raw,null,status);}
 };
 const maskPath=raw=>{
  try {
   const path=new URL(raw,location.href).pathname;
   return path.replace(/\/g\/[^/]+(?=\/|$)/g,'/g/:id')
    .replace(/\/gizmos\/[^/]+(?=\/|$)/g,'/gizmos/:id')
    .replace(/\/c\/[^/]+(?=\/|$)/g,'/c/:id')
    .replace(/\/(conversation|conversations|messages)\/[^/]+(?=\/|$)/g,'/$1/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi,'/:id')
    .replace(/\/(g-[a-z0-9_-]{16,})(?=\/|$)/gi,'/:id')
    .replace(/\/([^/]{48,})(?=\/|$)/g,'/:id');
  } catch {return null;}
 };
 const diagnosticPath=raw=>{
  try{
   const url=new URL(raw,location.href);if(url.origin!==location.origin)return null;
   const parts=url.pathname.split('/').filter(Boolean);if(parts[0]!=='backend-api')return maskPath(url.href);
   const safe=new Set(['conversations','gizmos','messages','favorites','favorite','starred','pinned','sidebar','history','list','batch','archived','projects','search','items','estuary','public_content','enc']);
   return '/backend-api/'+parts.slice(1).map(part=>safe.has(part.toLowerCase())?part.toLowerCase():':id').join('/');
  }catch{return null;}
 };
 const rootObservationPath=raw=>{
  try{const url=new URL(raw,location.href);if(url.origin!==location.origin)return null;if(url.pathname.startsWith('/backend-api/'))return diagnosticPath(url.href)||'/backend-api/:path';
   const safe=new Set(['api','data','graphql','conversation','conversations','sidebar','history','list','projects','chats','items','search','batch']);
   return '/'+url.pathname.split('/').filter(Boolean).map(part=>safe.has(part.toLowerCase())?part.toLowerCase():':segment').join('/');
  }catch{return null;}
 };
 const safeRootPartition=raw=>{
  try{const url=new URL(raw,location.href);if(url.pathname!=='/backend-api/conversations')return null;const p=url.searchParams;
   const bool=k=>p.getAll(k).length===1&&['true','false'].includes(p.get(k))?p.get(k)==='true':null;
   return {archived:bool('is_archived'),starred:bool('is_starred'),includeOriginPresent:p.has('conversation_origin'),excludeOriginPresent:p.has('exclude_conversation_origin'),offset:/^(0|[1-9][0-9]{0,6})$/.test(p.get('offset')||'')?Number(p.get('offset')):null,
    limit:/^(1|[1-9][0-9]{0,5})$/.test(p.get('limit')||'')?Number(p.get('limit')):null,cursorPresent:p.has('cursor')};
  }catch{return null;}
 };
 const rootEndpointCategory=pathname=>pathname==='/backend-api/conversations'?'root_conversation_list'
  :/^\/backend-api\/gizmos\/[^/]+\/conversations$/.test(pathname)?'project_conversation_list'
  :/^\/backend-api\//.test(pathname)?'other_chatgpt_backend':'other_list_like';
 const relativeNow=()=>Number.isFinite(performance.now?.())?Math.max(0,Math.round(performance.now())):0;
 const recordStarredNetwork=(event,details={})=>{
  if(!starredNetworkWindow)return;
  const path=details.pathname;
  if(typeof path!=='string'||!path.startsWith('/backend-api/'))return;
  const keys=Array.isArray(details.queryKeys)?details.queryKeys.filter(k=>typeof k==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(k)).slice(0,30):[];
  const values={};for(const key of keys){const value=details.queryValues?.[key];if(['offset','limit'].includes(key)&&Number.isSafeInteger(value)&&value>=0)values[key]=value;else if(['is_starred','is_archived'].includes(key)&&typeof value==='boolean')values[key]=value;else if(key==='cursor')values[key]=value===null?false:true;}
  starredNetworkWindow.push({event,method:/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/i.test(details.method||'')?String(details.method).toUpperCase():'UNKNOWN',pathname:path,
   queryKeys:keys,queryValues:values,status:Number.isSafeInteger(details.status)?details.status:null,transport:String(details.transport||details.initiatorType||'unknown').slice(0,24),timestamp:Number.isFinite(details.timestamp)?details.timestamp:Date.now(),
   ...(event==='shape'&&details.safeShape?{safeShape:details.safeShape}:{})});
  if(starredNetworkWindow.length>50)starredNetworkWindow.shift();
 };
 const safeResponseShape=payload=>{
  const safeKey=k=>typeof k==='string'&&/^[A-Za-z0-9_]{1,64}$/.test(k);
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return {topLevelKeys:[],arrays:[]};
  const topLevelKeys=Object.keys(payload).filter(safeKey).slice(0,40),arrays=[];
  for(const key of topLevelKeys){const value=payload[key];if(!Array.isArray(value))continue;
   const item=value[0],itemKeys=item&&typeof item==='object'&&!Array.isArray(item)?Object.keys(item).filter(safeKey).slice(0,40):[];
   const fieldTypes={};for(const field of ['id','title','updated_at','update_time','is_starred','is_archived'])if(item&&Object.prototype.hasOwnProperty.call(item,field))fieldTypes[field]=typeof item[field];
   arrays.push({key,count:value.length,firstItemKeys:itemKeys,fieldTypes});if(arrays.length>=8)break;
  }
  return {topLevelKeys,arrays};
 };
 const post=(event,details={})=>{
  const {rateContext:capturedRateContext,...safeDetails}=details;
  if(event==='response'&&details.status===429)recordRateLimit(details.pathname,details.status,capturedRateContext);
  if(event==='request'||event==='response'||event==='failure')recordStarredNetwork(event,safeDetails);
  try {window.webkit?.messageHandlers?.diagnostics?.postMessage({event,timestamp:Date.now(),cycleToken:window.gptListCycleConfig?.token||null,...safeDetails});} catch {}
 };
 const endpointFamily=(pathname,origin=location.origin)=>{
  if(typeof pathname!=='string')return 'unknown';
  let path=pathname;try{const url=new URL(pathname,location.href);origin=url.origin;path=url.pathname;}catch{return 'unknown';}
  if(origin!=='https://chatgpt.com')return 'non_chatgpt';
  if(path==='/backend-api/conversations')return 'root_conversation_list';
  if(/^\/backend-api\/gizmos\/[^/]+\/conversations$/.test(path)||path==='/backend-api/gizmos/:id/conversations')return 'project_conversation_list';
  if(/^\/backend-api\/conversations\/[^/]+\/messages\/?$/.test(path)||path==='/backend-api/conversations/:id/messages')return 'conversation_messages';
  if(/^\/backend-api\/(?:conversation|conversations)\/[^/]+\/?$/.test(path)||/^\/backend-api\/(?:conversation|conversations)\/:id\/?$/.test(path))return 'conversation_detail';
  if(path.startsWith('/backend-api/'))return 'other_chatgpt_backend';
  return 'unknown';
 };
 const attachRootTrafficGeneration=token=>{
  if(typeof token!=='string'||!token||rootTrafficToken===token)return;
  rootTrafficToken=token;
  for(const family of rootTrafficFamilies){for(const channel of ['fetch','XHR','resource']){
   const bucket=rootTraffic[family][channel];bucket.requests=0;bucket.responses=0;bucket.failures=0;bucket.statuses={};if(channel==='resource')bucket.zeroTransfer=0;
  }}
 };
 const recordRootTraffic=(stage,raw,transport,status=null,entry=null)=>{
  const context=rateContext();if(context.owner!=='scheduler_discovery'||context.generation!==window.gptListCycleConfig?.token)return;
  attachRootTrafficGeneration(context.generation);
  let url;try{url=new URL(raw,location.href);}catch{return;}
  if(url.origin!=='https://chatgpt.com'||!url.pathname.startsWith('/backend-api/'))return;
  let family=endpointFamily(url.pathname,url.origin);if(!rootTraffic[family])family='other_chatgpt_backend';
  const bucket=rootTraffic[family][transport];if(!bucket)return;
  if(stage==='request')bucket.requests++;
  else if(stage==='response'){bucket.responses++;if(Number.isInteger(status)&&status>=100&&status<=599)bucket.statuses[String(status)]=(bucket.statuses[String(status)]||0)+1;}
  else if(stage==='failure')bucket.failures++;
  else if(stage==='resource'){
   bucket.requests++;
   if(entry&&Number(entry.responseEnd)>0){bucket.responses++;if(Number.isInteger(status)&&status>=100&&status<=599)bucket.statuses[String(status)]=(bucket.statuses[String(status)]||0)+1;}
   else bucket.failures++;
   if(entry&&Number(entry.transferSize)===0)bucket.zeroTransfer++;
  }
 };
 const rateContext=()=>{
  const context=window.gptRateLimitContext||null;
  let check=false;try{check=!!sessionStorage.getItem('gpt-limits-prototype-check');}catch{}
  if(context?.owner==='scheduler_discovery'&&check)return {owner:'scheduler_conversation_check',generation:context.generation,stage:'conversation_check'};
  if(context&&typeof context.owner==='string')return context;
  const cycleToken=window.gptListCycleConfig?.token;
  if(cycleToken)return {owner:check?'scheduler_conversation_check':'scheduler_discovery',generation:cycleToken,stage:check?'conversation_check':'scheduler_discovery'};
  if(typeof window.gptPinnedActivityDiagnosticToken==='string')return {owner:'isolated_prefix_diagnostic',generation:window.gptPinnedActivityDiagnosticToken,stage:'prefix_classification'};
  return {owner:'unrelated_passive_traffic',generation:null,stage:'page_idle'};
 };
 const setRateLimitContext=(owner,generation,stage)=>{
  if(!['scheduler_discovery','scheduler_conversation_check','isolated_prefix_diagnostic','isolated_timestamp_fallback','unrelated_passive_traffic'].includes(owner))owner='unrelated_passive_traffic';
  window.gptRateLimitContext={owner,generation:typeof generation==='string'?generation:null,stage:typeof stage==='string'?stage:'unknown'};
 };
 const recordRateLimit=(pathname,status,explicitContext=null)=>{
  if(status!==429)return null;
  const context=explicitContext||rateContext(),family=endpointFamily(pathname);
  let owner=context.owner||'unrelated_passive_traffic',stage=context.stage||'unknown';
  const contextToken=typeof context.generation==='string'?context.generation:null;
  if(owner==='scheduler_discovery'&&!['root_conversation_list','project_conversation_list'].includes(family))owner='unrelated_passive_traffic';
  if(owner==='scheduler_conversation_check'&&!['conversation_messages','conversation_detail'].includes(family))owner='unrelated_passive_traffic';
  if(owner==='isolated_prefix_diagnostic'&&!['root_conversation_list','project_conversation_list'].includes(family))owner='unrelated_passive_traffic';
  if(owner==='isolated_timestamp_fallback'&&!['conversation_messages','conversation_detail'].includes(family))owner='unrelated_passive_traffic';
  const event={sequence:++rateLimitSequence,family,owner,generation:contextToken,status:429,occurredAtStage:stage,occurredAt:Date.now()};
  const events=window.gptRateLimitEvents||(window.gptRateLimitEvents=[]);events.push(event);if(events.length>40)events.splice(0,events.length-40);
  try{window.webkit?.messageHandlers?.diagnostics?.postMessage({event:'rate_limit',family,owner,generation:contextToken,status:429,occurredAtStage:stage,occurredAt:event.occurredAt,sequence:event.sequence});}catch{}
  return event;
 };
 window.gptSetRateLimitContext=setRateLimitContext;
 window.gptCaptureRateLimitContext=()=>({...rateContext()});
 window.gptRecordRateLimit=recordRateLimit;
 const querySignature=url=>{
  const controls=new Set(['offset','limit','cursor','order']);
  const filters=new Set(['is_starred','is_archived','conversation_origin','exclude_conversation_origin']);
  const keys=[...new Set([...url.searchParams.keys()].filter(k=>/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(k)))].sort();
  const safeValues={};let hasFilter=false,hasUnknown=false;
  for(const key of keys){
   const values=url.searchParams.getAll(key);
   if(key==='is_archived'||key==='is_starred'){
    hasFilter=true;safeValues[key]=values.length===1&&['true','false'].includes(values[0])?values[0]==='true':'<redacted>';continue;
   }
   if(filters.has(key)){hasFilter=true;safeValues[key]='<redacted>';continue;}
   if(['offset','limit'].includes(key)){
    const value=values.length===1?values[0]:'';
    safeValues[key]=/^(0|[1-9][0-9]{0,6})$/.test(value)?Number(value):'<redacted>';continue;
   }
   if(key==='order'){
    const value=values.length===1?values[0].toLowerCase():'';
    safeValues[key]=['updated','created','asc','desc','newest','oldest'].includes(value)?value:'<redacted>';continue;
   }
   if(key==='cursor'){safeValues[key]='<present>';continue;}
   safeValues[key]='<redacted>';hasUnknown=true;
  }
  const controlOnly=!hasFilter&&!hasUnknown;
  return {keys,safeValues,classification:hasFilter?'scope_filter':(controlOnly?'pagination_or_order_only':'unclassified_parameter'),controlOnly,hasFilter,
   cursorPresent:keys.includes('cursor')||keys.includes('after')||keys.includes('before'),
   offset:Number.isInteger(safeValues.offset)?safeValues.offset:null,limit:Number.isInteger(safeValues.limit)?safeValues.limit:null};
 };
 const genericDiagnosticInfo=(raw,method,transport)=>{
  let url;try{url=new URL(raw,location.href);}catch{return null;}
  if(url.origin!==location.origin||!url.pathname.startsWith('/backend-api/'))return null;
  const queryKeys=[...new Set([...url.searchParams.keys()].filter(k=>/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(k)))].sort().slice(0,30),queryValues={};
  for(const key of queryKeys){const values=url.searchParams.getAll(key),value=values.length===1?values[0]:'';
   if(['is_starred','is_archived'].includes(key)&&['true','false'].includes(value))queryValues[key]=value==='true';
   else if(['offset','limit'].includes(key)&&/^(0|[1-9][0-9]{0,6})$/.test(value))queryValues[key]=Number(value);
   else if(key==='cursor')queryValues[key]=true;
  }
  return {method,pathname:diagnosticPath(url.href)||'/backend-api/:path',queryKeys,queryValues,transport};
 };
 const likelyListDiagnosticPath=raw=>{try{return /(conversation|sidebar|starred|pinned|favorite|history|\/list|batch)/i.test(new URL(raw,location.href).pathname);}catch{return false;}};
 window.gptBeginStarredNetworkWindow=()=>{starredNetworkWindow=[];return true;};
 window.gptEndStarredNetworkWindow=()=>{const result=starredNetworkWindow||[];starredNetworkWindow=null;return result;};
 const partitionDescriptor=async raw=>{
  const url=new URL(raw,location.href),params=url.searchParams;
  const config=window.gptListCycleConfig||{};
  const descriptor={archived:null,starred:null,includeOrigin:null,excludeOrigin:null,unknownScopeKeys:[],valid:true};
  for(const [key,field] of [['is_archived','archived'],['is_starred','starred']]){
   if(!params.has(key))continue;
   const values=params.getAll(key);
   if(values.length!==1||!['true','false'].includes(values[0]))descriptor.valid=false;
   else descriptor[field]=values[0]==='true';
  }
  for(const [key,field] of [['conversation_origin','includeOrigin'],['exclude_conversation_origin','excludeOrigin']]){
   if(!params.has(key))continue;
   const values=params.getAll(key);
   if(values.length!==1||!values[0]||!config.secret||!config.token){descriptor.valid=false;continue;}
   // HMAC has a new random key each cycle. Raw origin stays in the page world;
   // only the ephemeral equality token crosses the native bridge.
   try {
    const encoder=new TextEncoder();
    const hmacKey=await crypto.subtle.importKey('raw',encoder.encode(config.secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature=await crypto.subtle.sign('HMAC',hmacKey,encoder.encode(values[0]));
    descriptor[field]=Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,'0')).join('');
   } catch {descriptor.valid=false;}
  }
  if(descriptor.includeOrigin&&descriptor.excludeOrigin)descriptor.valid=false;
  const known=new Set(['offset','limit','order','cursor','is_archived','is_starred','conversation_origin','exclude_conversation_origin','expand','hide_snorlax']);
  descriptor.unknownScopeKeys=[...new Set([...params.keys()].filter(k=>!known.has(k)))].map(k=>/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(k)?k:'<unknown-key>').sort();
  if(descriptor.unknownScopeKeys.length)descriptor.valid=false;
  return descriptor;
 };
 const observePartitionRequest=(raw,meta)=>{
  if(meta.pathname!=='/backend-api/conversations'||!meta.cycleToken)return;
  partitionDescriptor(raw).then(descriptor=>{
   if(meta.cycleToken===(window.gptListCycleConfig?.token||null))post('partition_request',{...meta,partitionDescriptor:descriptor});
  }).catch(()=>post('failure',meta));
 };
 const targetInfo=(raw,method)=>{
  let url;try{url=new URL(raw,location.href);}catch{return null;}
  const isGlobalPath=url.pathname==='/backend-api/conversations';
  const isProjectPath=/^\/backend-api\/gizmos\/[^/]+\/conversations$/.test(url.pathname);
  const query=querySignature(url);
  const scope=isProjectPath?'project':(isGlobalPath?(query.hasFilter?'filtered':(query.controlOnly?'global':'unclassified')):'unknown');
  const isConversationList=isGlobalPath||isProjectPath;
  if(url.origin!==location.origin||!isConversationList)return null;
  const streamKey=url.pathname;
  let streamId=0;
  if(scope==='project'){
   if(!projectStreams.has(streamKey))projectStreams.set(streamKey,nextProjectStream++ + Math.floor(Math.random()*1000000000));
   streamId=projectStreams.get(streamKey);
  } else if(scope==='filtered'||scope==='unclassified'){
   // Partition by parameter names only. Filter values never leave this function
   // and are not used as a persisted or emitted identifier.
   const controls=new Set(['offset','limit','cursor','order']);
   const family=url.pathname+'|'+query.keys.filter(k=>!controls.has(k)).sort().join(',');
   if(!queryStreams.has(family))queryStreams.set(family,nextQueryStream++ + Math.floor(Math.random()*1000000000));
   streamId=queryStreams.get(family);
  }
  return {method:String(method||'GET').toUpperCase(),pathname:maskPath(url.href)||'/backend-api/conversations',scope,streamId,
   cycleToken:window.gptListCycleConfig?.token||null,
   isConversationList,queryKeys:query.keys,queryValues:query.safeValues,queryClassification:query.classification,
   orderedByUpdated:url.searchParams.get('order')==='updated'&&!query.hasFilter,
   hasPinned:query.hasFilter};
 };
 const responseShape=payload=>({
  topLevelKeys:payload&&typeof payload==='object'&&!Array.isArray(payload)?Object.keys(payload).filter(x=>typeof x==='string').slice(0,40):[],
  itemsType:Array.isArray(payload?.items)?'array':payload&&typeof payload==='object'?typeof payload.items:typeof payload,
  itemCount:Array.isArray(payload?.items)?payload.items.length:null,
  fieldTypes:{offset:typeof payload?.offset,limit:typeof payload?.limit,total:typeof payload?.total,cursor:typeof payload?.cursor,
   itemId:typeof payload?.items?.[0]?.id,title:typeof payload?.items?.[0]?.title,updateTime:typeof payload?.items?.[0]?.update_time}
 });
 const observe=(raw,payload,meta,backendTrafficContext=null)=>{
  window.gptObserveBackendResponse?.(raw,payload,meta?.status);
  if((meta?.cycleToken??null)!==(window.gptListCycleConfig?.token||null))return Promise.resolve();
  const info=targetInfo(raw,meta?.method);if(!info?.isConversationList)return;
  const path=info.pathname;
  const records=GptConversationList.sanitizeList(payload),shape=responseShape(payload);
  post('parsed',{...meta,pathname:path,recognized:records!==null,...shape});
  if(records===null)return Promise.resolve();
  const pageTimes=payload.items.map(item=>typeof item?.update_time==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(item.update_time)?Date.parse(item.update_time):NaN);
  const timestampsValid=pageTimes.every(Number.isFinite);
  const sequenceKey=info.scope+':'+info.streamId,sequence=(streamSequences.get(sequenceKey)||0)+1;streamSequences.set(sequenceKey,sequence);
  const offset=Number.isFinite(payload.offset)?payload.offset:(typeof info.queryValues.offset==='number'?info.queryValues.offset:null);
  const limit=Number.isFinite(payload.limit)?payload.limit:(typeof info.queryValues.limit==='number'?info.queryValues.limit:null);
  const cursorPresent=Object.prototype.hasOwnProperty.call(payload,'cursor'),cursor=payload.cursor;
  const cursorNull=cursorPresent&&cursor===null,cursorType=cursorNull?'null':Array.isArray(cursor)?'array':typeof cursor;
  const queryCursorPresent=info.queryKeys.includes('cursor');
  const paginationKind=offset!==null?'offset':(cursorPresent||queryCursorPresent)?'cursor':'unknown';
  const pageCursorPresent=cursorPresent||queryCursorPresent;
  const cycleToken=meta?.cycleToken??null,total=Number.isFinite(payload.total)?payload.total:null;
  const responseOffset=Number.isSafeInteger(payload.offset)&&payload.offset>=0?payload.offset:offset;
  const expectedNextOffset=responseOffset!==null&&pageTimes.length>0?responseOffset+pageTimes.length:null;
  let paginationHint=null,paginationHintSource=null;
  for(const key of ['has_more','hasMore','has_next_page','hasNextPage'])if(typeof payload[key]==='boolean'){paginationHint=payload[key];paginationHintSource=key;break;}
  if(paginationHint===null)for(const key of ['next_offset','nextOffset'])if(Number.isSafeInteger(payload[key])&&payload[key]>=0){paginationHint=true;paginationHintSource=key;break;}
  if(paginationHint===null&&Object.prototype.hasOwnProperty.call(payload,'cursor')){paginationHint=payload.cursor!==null&&payload.cursor!=='';paginationHintSource='cursor_present';}
  const frontendPageDecision=paginationHint===false?'stop_end_confirmed':paginationHint===true?'request_next_page':records.length===0?'waiting_frontend_no_identities':'waiting_frontend';
  let flags={orderedByUpdated:info.orderedByUpdated,hasPinned:info.hasPinned};
  // Preserve response-observation order while origin HMAC operations finish.
  deliveryQueue=deliveryQueue.then(async()=>{
   if(cycleToken!==(window.gptListCycleConfig?.token||null))return;
   const partition=info.scope==='project'?null:await partitionDescriptor(raw);
   if(cycleToken!==(window.gptListCycleConfig?.token||null))return;
   const partitionShape=partition?`archived:${partition.archived===null?'omitted':partition.archived};starred:${partition.starred===null?'omitted':partition.starred};origin:${partition.includeOrigin?'include':partition.excludeOrigin?'exclude':'omitted'}`:'project';
   // Page-memory-only metadata supports local pinned-link matching. IDs never
   // cross the native bridge through this diagnostic and are dropped on navigation.
   observedListSources.push({method:info.method,pathname:path,status:Number.isSafeInteger(meta?.status)?meta.status:null,queryKeys:info.queryKeys.slice(0,30),
    archived:partition?.archived??null,starred:partition?.starred??null,itemCount:records.length,
    records:(Array.isArray(payload?.items)?payload.items:[]).flatMap(item=>{
     if(typeof item?.id!=='string'||!item.id)return [];
     const sanitizedRecord=records.find(record=>record.conversationId===item.id);
     const updateTime=activityTime(item?.update_time);
     const updatedAt=updateTime??(Number.isFinite(sanitizedRecord?.updatedAt)&&sanitizedRecord.updatedAt>0&&sanitizedRecord.updatedAt<=Date.now()?sanitizedRecord.updatedAt:null);
     let activityAt=null,activitySource=null;
     for(const field of ['last_activity_at','updated_at','lastActivityAt']){activityAt=activityTime(item?.[field]);if(activityAt!==null){activitySource='conversation_activity_timestamp';break;}}
     return [{id:item.id,updatedAt,updateTimePresent:updateTime!==null,activityAt,activitySource,
      sourceFamily:info.scope==='project'?'project_conversation_list':'root_conversation_list'}];
    })});
   if(observedListSources.length>100)observedListSources.shift();
   window.webkit.messageHandlers.list.postMessage({...flags,relativeMs:relativeNow(),partitionShape,
   scope:info.scope,streamId:info.streamId,sequence,paginationKind,offset,limit,cursorPresent:pageCursorPresent,cursorNull,cursorType,
   queryKeys:info.queryKeys,queryValues:info.queryValues,queryClassification:info.queryClassification,
   cycleToken,partitionDescriptor:partition,sortOrder:info.queryValues.order??null,requestCursorPresent:queryCursorPresent,
   httpStatus:Number.isFinite(meta?.status)?meta.status:null,
   total,itemCount:pageTimes.length,responseOffset,expectedNextOffset,paginationHint,paginationHintSource,frontendPageDecision,
   pageTimes:timestampsValid?pageTimes:[],timestampsValid,path,count:records.length,
   isoTimestamp:timestampsValid,records});
  }).catch(()=>post('failure',meta));
  return deliveryQueue;
 };
 window.gptResolvePinnedRecords=ids=>[...new Set(ids)].map(conversationId=>{
  const matches=observedListSources.filter(s=>s.status>=200&&s.status<300).flatMap(s=>s.records).filter(r=>r.id===conversationId&&Number.isFinite(r.updatedAt)&&r.updatedAt>0&&r.updatedAt<=Date.now());
  const finiteTimes=matches.map(r=>r.updatedAt).filter(Number.isFinite),updatedAt=finiteTimes.length?Math.max(...finiteTimes):null;
  const metadataMatches=observedListSources.filter(s=>s.status>=200&&s.status<300).flatMap(s=>s.records).filter(r=>r.id===conversationId);
  if(updatedAt!==null){const exactUpdate=matches.find(r=>r.updateTimePresent===true&&r.updatedAt===updatedAt);return {conversationId,passiveMatch:true,matchingMetadataRecords:metadataMatches.length,updateTimePresent:!!exactUpdate,lastActivityAt:updatedAt,activitySource:exactUpdate?`${exactUpdate.sourceFamily}.update_time`:'passive_list_timestamp'};}
  const activityMatches=observedListSources.filter(s=>s.status>=200&&s.status<300).flatMap(s=>s.records).filter(r=>r.id===conversationId&&Number.isFinite(r.activityAt)&&r.activityAt>0&&r.activityAt<=Date.now());
  const activityTimes=activityMatches.sort((a,b)=>b.activityAt-a.activityAt),latestActivity=activityTimes[0],activityAt=latestActivity?.activityAt??null;
  return {conversationId,passiveMatch:metadataMatches.length>0,matchingMetadataRecords:metadataMatches.length,updateTimePresent:metadataMatches.some(r=>r.updateTimePresent===true),...(activityAt===null?{}:{lastActivityAt:activityAt,activitySource:latestActivity?.sourceFamily?`${latestActivity.sourceFamily}.activity_metadata`:'conversation_activity_metadata'})};
 });
 window.gptSummarizePinnedLinkSources=pinnedIds=>{
  const ids=new Set(Array.isArray(pinnedIds)?pinnedIds.filter(id=>typeof id==='string'&&/^[A-Za-z0-9-]{1,128}$/.test(id)):[]);
  const base=observedListSources.filter(source=>source.archived===false&&source.starred===false);
  const starred=observedListSources.filter(source=>source.starred===true);
  const baseIds=new Set(base.flatMap(source=>source.records.map(record=>record.id)));
  const matches=observedListSources.filter(source=>source.records.some(record=>ids.has(record.id)));
  const timestamps=new Map();for(const source of matches)for(const record of source.records)if(ids.has(record.id)&&Number.isFinite(record.updatedAt))timestamps.set(record.id,Math.max(timestamps.get(record.id)||0,record.updatedAt));
  const cutoff=Date.now()-6*60*60*1000;
  const safeSources=matches.slice(-10).map(source=>({method:source.method,pathname:source.pathname,status:source.status,queryKeys:source.queryKeys,itemCount:source.itemCount,
   containsUpdateTime:source.records.some(record=>ids.has(record.id)&&Number.isFinite(record.updatedAt))}));
  const observedStreams=observedListSources.slice(-20).map(source=>({method:source.method,pathname:source.pathname,status:source.status,queryKeys:source.queryKeys,itemCount:source.itemCount,
   archived:source.archived,starred:source.starred,containsUpdateTime:source.records.some(record=>Number.isFinite(record.updatedAt))}));
  const starredIds=new Set(starred.flatMap(source=>source.records.map(record=>record.id)));
  return {baseSourceAvailable:base.length>0,starredTrueSourceAvailable:starred.length>0,starredTrueOverlapCount:[...ids].filter(id=>starredIds.has(id)).length,baseOverlapCount:[...ids].filter(id=>baseIds.has(id)).length,
   pinnedLinkCount:ids.size,networkMatchedCount:new Set(matches.flatMap(source=>source.records.map(record=>record.id).filter(id=>ids.has(id)))).size,
   updatedAtCount:timestamps.size,recentCount:[...timestamps.values()].filter(time=>time>=cutoff&&time<=Date.now()).length,
   sources:safeSources,observedStreams,networkSourcesObserved:observedListSources.length};
 };
 const snapshot=()=>{
  const scrollable=[...document.querySelectorAll('body *')].filter(el=>el.scrollHeight>el.clientHeight+40&&el.clientHeight>100).length;
  try{for(const entry of performance.getEntriesByType('resource'))observeResource(entry);}catch{}
  post('page',{pathname:maskPath(location.href),width:innerWidth,height:innerHeight,visibility:document.visibilityState,
   hasNav:!!document.querySelector('nav'),hasAside:!!document.querySelector('aside'),scrollableContainers:Math.min(scrollable,100),
   fetchHookActive:window.fetch?.__gptListDiagnosticWrapper===true,
   xhrHookActive:XMLHttpRequest.prototype.send?.__gptListDiagnosticWrapper===true,
   fetchAssignments,xhrOpenAssignments,xhrSendAssignments,backendResources:resourceEvents});
  try{if(typeof window.gptListCycleConfig?.token==='string')post('root_hook_health',rootDiscoveryState(window.gptListCycleConfig.token));}catch{}
 };
 const rootDiscoveryState=expectedToken=>{
  attachRootTrafficGeneration(expectedToken);
  attachRootDiscoveryObservations(expectedToken);
  sampleRootSidebarRows(expectedToken);
  let pathname='/';try{pathname=location.pathname||new URL(location.href).pathname||'/';}catch{}
  const routeTemplate=/^\/c\/[^/]+\/?$/.test(pathname)?'/c/<id>'
   :(/^\/g\/[^/]+\/c\/[^/]+\/?$/.test(pathname)?'/g/<id>/c/<id>'
   :(pathname==='/'?'/':'other'));
  let conversationLinks=0,sidebarCandidates=0;
  try {
   conversationLinks=[...document.querySelectorAll('a[href]')].filter(anchor=>{
    try {const url=new URL(anchor.href,location.href);return url.origin===location.origin&&(/^\/c\/[^/]+\/?$/.test(url.pathname)||/^\/g\/[^/]+\/c\/[^/]+\/?$/.test(url.pathname));}catch{return false;}
   }).length;
   sidebarCandidates=document.querySelectorAll('nav,aside,[role="navigation"]').length;
  } catch {}
  let sidebarMetadata=null;try{sidebarMetadata=window.gptInspectRootSidebarMetadata?.()||null;}catch{}
  const navigation=performance.getEntriesByType?.('navigation')?.[0];
  return {routeTemplate,documentReadyState:document.readyState||'unknown',bodyPresent:!!document.body,
   sidebarAvailable:sidebarCandidates>0,sidebarCandidates,conversationLinks,
   documentLifecycle:{timeOrigin:Number.isFinite(performance.timeOrigin)?Math.round(performance.timeOrigin):null,
    navigationType:['navigate','reload','back_forward'].includes(navigation?.type)?navigation.type:'unknown',
    navigationResponseStatus:Number.isInteger(navigation?.responseStatus)&&navigation.responseStatus>=100&&navigation.responseStatus<=599?navigation.responseStatus:null,
    pageshowPersisted:rootPageShowPersisted,documentAgeMs:Number.isFinite(performance.now?.())?Math.max(0,Math.round(performance.now())):null},
   rootBackendTraffic:rootTraffic,
   rootHookEvents:rootDiscoveryObservationToken===expectedToken?rootHookEvents.slice(-80):[],
   rootResourceEvents:rootDiscoveryObservationToken===expectedToken?rootResourceEvents.slice(-80):[],
   rootSidebarTimeline:rootDiscoveryObservationToken===expectedToken?rootSidebarTimeline.slice(-40):[],
   rootListHookInstalled:typeof window.gptListRootDiscoveryState==='function',
   fetchHookInstalled:window.fetch?.__gptListDiagnosticWrapper===true,
   xhrOpenHookInstalled:XMLHttpRequest.prototype.open?.__gptListDiagnosticWrapper===true,
   xhrSendHookInstalled:XMLHttpRequest.prototype.send?.__gptListDiagnosticWrapper===true,
   generationAttached:typeof expectedToken==='string'&&expectedToken.length>0&&window.gptListCycleConfig?.token===expectedToken,sidebarMetadata};
 };
 const rootSidebarSnapshot=()=>{
  try{
   const metadata=window.gptInspectRootSidebarMetadata?.();
   if(metadata?.activeSidebarFound!==true||!Number.isInteger(metadata.renderedRows))return null;
   const scroll=metadata.scrollGeometry&&typeof metadata.scrollGeometry==='object'?metadata.scrollGeometry:{};
   return {activeContext:true,renderedRows:metadata.renderedRows,visibleRows:Number.isInteger(metadata.visibleRows)?metadata.visibleRows:null,
    rowsWithInternalIdentity:Number.isInteger(metadata.rowsWithInternalIdentity)?metadata.rowsWithInternalIdentity:null,
    rowsWithoutInternalIdentity:Number.isInteger(metadata.rowsWithoutInternalIdentity)?metadata.rowsWithoutInternalIdentity:null,
    scrollTop:Number.isFinite(Number(scroll.scrollTop))?Math.round(Number(scroll.scrollTop)):null,
    scrollRangePx:Number.isFinite(Number(scroll.scrollRangePx))?Math.round(Number(scroll.scrollRangePx)):null,
    atScrollExtent:scroll.atScrollExtent===true,hiddenScrollRangePossible:Number(scroll.scrollRangePx)>0,
    endOfListProof:metadata.endOfListProof==='unavailable'?'unavailable':'observed'};
  }catch{return null;}
 };
 const attachRootDiscoveryObservations=expectedToken=>{
  if(typeof expectedToken!=='string'||!expectedToken||rootDiscoveryObservationToken===expectedToken)return;
  rootDiscoveryObservationToken=expectedToken;rootHookEvents=[];rootResourceEvents=[];rootSidebarTimeline=[];rootSidebarLastSignature=null;rootDiscoverySeenPageIds=new Map();
  try{rootSidebarObserver?.disconnect();}catch{}
  let sampleTimer=null;
  const sample=()=>{
   sampleRootSidebarRows(expectedToken);
  };
  sample();
   try{if(typeof MutationObserver==='function'&&document.documentElement){rootSidebarObserver=new MutationObserver(()=>{if(sampleTimer!==null)return;sampleTimer=setTimeout(()=>{sampleTimer=null;sample();},100);});rootSidebarObserver.observe(document.documentElement,{subtree:true,childList:true});}}catch{}
 };
 const sampleRootSidebarRows=expectedToken=>{
  if(typeof expectedToken!=='string'||rootDiscoveryObservationToken!==expectedToken||expectedToken!==window.gptListCycleConfig?.token)return;
  const snapshot=rootSidebarSnapshot();if(!snapshot)return;
  const signature=JSON.stringify(snapshot);
  if(rootSidebarLastSignature===null||signature!==rootSidebarLastSignature){
   const sample={relativeMs:relativeNow(),...snapshot};rootSidebarTimeline.push(sample);
   if(rootSidebarTimeline.length>40)rootSidebarTimeline.shift();rootSidebarLastSignature=signature;
   try{post('root_sidebar_rows',sample);}catch{}
  }
 };
 const isRootDiscoveryCandidate=raw=>{
  try{const url=new URL(raw,location.href);return url.origin===location.origin&&likelyListDiagnosticPath(url.href);}catch{return false;}
 };
 const beginRootDiscoveryObservation=(raw,method,transport)=>{
  const context=rateContext(),token=window.gptListCycleConfig?.token;
  if(context.owner!=='scheduler_discovery'||!token||context.generation!==token||!isRootDiscoveryCandidate(raw))return null;
  attachRootDiscoveryObservations(token);
  const url=new URL(raw,location.href),path=rootObservationPath(url.href)||'/unknown',entry={sequence:++rootObservationSequence,source:'hook',event:'request',category:rootEndpointCategory(url.pathname),pathname:path,method:/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/i.test(method||'')?String(method).toUpperCase():'UNKNOWN',transport:String(transport||'unknown').slice(0,16),relativeMs:relativeNow(),status:null,completed:false,itemCount:null,arrayCounts:[],partition:safeRootPartition(url.href),generation:'current'};
  rootHookEvents.push({...entry});if(rootHookEvents.length>80)rootHookEvents.shift();
  return entry;
 };
 const finishRootDiscoveryObservation=(entry,status,payload=null)=>{
  if(!entry||rootDiscoveryObservationToken!==window.gptListCycleConfig?.token)return;
  entry.status=Number.isInteger(status)&&status>=100&&status<=599?status:null;entry.completed=true;entry.responseRelativeMs=Math.max(0,Math.round(performance.now()));
  if(payload&&typeof payload==='object'&&!Array.isArray(payload)){
   let pageItems=[];for(const key of ['items','conversations','results'])if(Array.isArray(payload[key])){pageItems=payload[key];entry.itemCount=pageItems.length;break;}
   entry.arrayCounts=Object.keys(payload).filter(key=>/^[A-Za-z0-9_]{1,40}$/.test(key)&&Array.isArray(payload[key])).slice(0,6).map(key=>({key,count:payload[key].length}));
   if(entry.category==='root_conversation_list'){
    const safeInteger=value=>Number.isSafeInteger(value)&&value>=0?value:null;
    const responseOffset=safeInteger(payload.offset)??entry.partition?.offset??null;
    const responseLimit=safeInteger(payload.limit)??entry.partition?.limit??null;
    const itemCount=safeInteger(entry.itemCount);
    const partitionKey=`archived:${entry.partition?.archived===null?'omitted':entry.partition?.archived};starred:${entry.partition?.starred===null?'omitted':entry.partition?.starred};origin:${entry.partition?.includeOriginPresent?'include':entry.partition?.excludeOriginPresent?'exclude':'omitted'}`;
    let seenIds=rootDiscoverySeenPageIds.get(partitionKey);
    if(!seenIds){seenIds=new Set();if(rootDiscoverySeenPageIds.size<64)rootDiscoverySeenPageIds.set(partitionKey,seenIds);}
    let pageNewIdentities=0,identityCountReliable=!!seenIds;
    for(const item of pageItems){
     const id=typeof item?.id==='string'?item.id:typeof item?.conversation_id==='string'?item.conversation_id:null;
     if(!id){identityCountReliable=false;continue;}
     if(seenIds&&!seenIds.has(id)){pageNewIdentities++;if(seenIds.size<20000)seenIds.add(id);else identityCountReliable=false;}
    }
    const expectedNextOffset=responseOffset!==null&&itemCount!==null&&itemCount>0?responseOffset+itemCount:null;
    let paginationHint=null,paginationHintSource=null;
    for(const key of ['has_more','hasMore','has_next_page','hasNextPage']){
     if(typeof payload[key]==='boolean'){paginationHint=payload[key];paginationHintSource=key;break;}
    }
    if(paginationHint===null){
     for(const key of ['next_offset','nextOffset']){
      if(safeInteger(payload[key])!==null){paginationHint=true;paginationHintSource=key;break;}
     }
    }
    if(paginationHint===null&&Object.prototype.hasOwnProperty.call(payload,'cursor')){
     paginationHint=payload.cursor!==null&&payload.cursor!=='';paginationHintSource='cursor_present';
    }
    entry.responseOffset=responseOffset;entry.expectedNextOffset=expectedNextOffset;entry.responseLimit=responseLimit;
    entry.paginationHint=paginationHint;entry.paginationHintSource=paginationHintSource;
    entry.partitionShape=partitionKey;entry.newIdentityCount=pageNewIdentities;entry.identityCountReliable=identityCountReliable;
    entry.pageDecision=paginationHint===false?'stop_end_confirmed':paginationHint===true?'request_next_page':pageNewIdentities===0?'waiting_frontend_no_new_identities':'waiting_frontend';
   }
  }
  const responseEvent={sequence:entry.sequence,source:'hook',event:status==null?'failure':'response',category:entry.category,pathname:entry.pathname,method:entry.method,transport:entry.transport,
   relativeMs:entry.responseRelativeMs,status:entry.status,itemCount:entry.itemCount,generation:entry.generation,partition:entry.partition,
   ...(entry.category==='root_conversation_list'?{responseOffset:entry.responseOffset??null,expectedNextOffset:entry.expectedNextOffset??null,responseLimit:entry.responseLimit??null,
    paginationHint:entry.paginationHint??null,paginationHintSource:entry.paginationHintSource??null,newIdentityCount:entry.newIdentityCount??null,identityCountReliable:entry.identityCountReliable??false,partitionShape:entry.partitionShape??'unknown',pageDecision:entry.pageDecision??'waiting_frontend'}:{})};
  rootHookEvents.push(responseEvent);if(rootHookEvents.length>80)rootHookEvents.shift();
 };
 const observeSameOriginListResponse=(raw,response,entry)=>{
  if(!entry)return;
  const status=Number.isFinite(response?.status)?response.status:null;
  if(!likelyListDiagnosticPath(raw)){finishRootDiscoveryObservation(entry,status);return;}
  try{response.clone().json().then(payload=>finishRootDiscoveryObservation(entry,status,payload)).catch(()=>finishRootDiscoveryObservation(entry,status));}
  catch{finishRootDiscoveryObservation(entry,status);}
 };
 window.gptListRootDiscoveryState=rootDiscoveryState;
 try{window.addEventListener('pageshow',event=>{rootPageShowPersisted=event.persisted===true;});}catch{}
 const seenResources=new Set();
 const resourceEvents=[];
 const observeResource=entry=>{
  let url;try{url=new URL(entry.name,location.href);}catch{return;}
  if(url.origin!==location.origin||!url.pathname.startsWith('/backend-api/'))return;
  const path=diagnosticPath(url.href)||'/backend-api/:path',relativeStartMs=Math.round(entry.startTime);
  const key=path+'|'+relativeStartMs;if(seenResources.has(key))return;seenResources.add(key);
  const resourceQueryKeys=[...new Set([...url.searchParams.keys()].filter(k=>/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(k)))].sort().slice(0,30),resourceQueryValues={};
  for(const key of resourceQueryKeys){const values=url.searchParams.getAll(key),value=values.length===1?values[0]:'';if(['is_starred','is_archived'].includes(key)&&['true','false'].includes(value))resourceQueryValues[key]=value==='true';else if(['offset','limit'].includes(key)&&/^(0|[1-9][0-9]{0,6})$/.test(value))resourceQueryValues[key]=Number(value);else if(key==='cursor')resourceQueryValues[key]=true;}
  const details={pathname:path,initiatorType:String(entry.initiatorType||'other').slice(0,32),relativeStartMs,completed:Number(entry.responseEnd)>0,
   queryKeys:resourceQueryKeys,queryValues:resourceQueryValues,
   isConversationList:url.pathname==='/backend-api/conversations'||/^\/backend-api\/gizmos\/[^/]+\/conversations$/.test(url.pathname)};
  if(Number.isFinite(entry.responseStatus))details.status=entry.responseStatus;
  recordRootTraffic('resource',url.href,'resource',details.status??null,entry);
  if(isRootDiscoveryCandidate(url.href)&&rootDiscoveryObservationToken===window.gptListCycleConfig?.token){
   const observation={sequence:++rootObservationSequence,pathname:rootObservationPath(url.href)||'/unknown',category:rootEndpointCategory(url.pathname),method:'UNKNOWN',transport:String(details.initiatorType||'other').slice(0,24),relativeMs:Math.max(0,Math.round(entry.startTime)),status:details.status??null,completed:details.completed,responseRelativeMs:Number(entry.responseEnd)>0?Math.max(0,Math.round(entry.responseEnd)):null,itemCount:null,source:'resource_timing',event:'resource',generation:'current',partition:safeRootPartition(url.href)};
   rootResourceEvents.push(observation);if(rootResourceEvents.length>80)rootResourceEvents.shift();
  }
  resourceEvents.push({pathname:details.pathname,initiatorType:details.initiatorType,relativeStartMs:details.relativeStartMs,
   completed:details.completed,status:details.status??null,isConversationList:details.isConversationList});
  if(resourceEvents.length>30)resourceEvents.shift();
  recordStarredNetwork('resource',{...details,method:'UNKNOWN',queryKeys:resourceQueryKeys,queryValues:resourceQueryValues,timestamp:Date.now()});
  post('resource',details);
 };
 try{if(typeof PerformanceObserver==='function'){const observer=new PerformanceObserver(list=>list.getEntries().forEach(observeResource));observer.observe({type:'resource',buffered:true});}}catch{}
 window.gptMaskDiagnosticPath=maskPath;
 window.gptListDiagnosticSnapshot=snapshot;
 const wrapFetch=original=>{
  if(typeof original!=='function'||original.__gptListDiagnosticWrapper)return original;
  const wrapped=function(...args){
  let raw=typeof args[0]==='string'?args[0]:args[0]?.url;
  let method=(args[1]?.method)||(typeof Request!=='undefined'&&args[0] instanceof Request?args[0].method:'GET');
  const backendTrafficContext=window.gptCaptureBackendTrafficContext?.()||null;
  const rootObservation=beginRootDiscoveryObservation(raw,method,'fetch');
  recordRootTraffic('request',raw,'fetch');
  const info=targetInfo(raw,method);
  if(!info){if(isConversationActivityPath(raw)){const requestRateContext=rateContext();window.gptReportHistoryRequest?.(raw,requestRateContext);return original.apply(this,args).then(response=>{recordRootTraffic('response',raw,'fetch',response.status);if(response.status===429){finishRootDiscoveryObservation(rootObservation,429);window.gptObserveConversationActivity?.(raw,null,429,requestRateContext,backendTrafficContext);}else response.clone().json().then(body=>{finishRootDiscoveryObservation(rootObservation,response.status,body);window.gptObserveConversationActivity?.(raw,body,response.status,requestRateContext,backendTrafficContext);}).catch(()=>{finishRootDiscoveryObservation(rootObservation,response.status);window.gptObserveBackendResponse?.(raw,null,response.status);});return response;},error=>{recordRootTraffic('failure',raw,'fetch');finishRootDiscoveryObservation(rootObservation,null);throw error;});}if(!starredNetworkWindow&&!backendTrafficContext){if(!isChatGPTBackendPath(raw)){if(!rootObservation)return original.apply(this,args);return original.apply(this,args).then(response=>{observeSameOriginListResponse(raw,response,rootObservation);return response;},error=>{finishRootDiscoveryObservation(rootObservation,null);throw error;});}return original.apply(this,args).then(response=>{recordRootTraffic('response',raw,'fetch',response.status);observePassiveBackendResponse(raw,response,rootObservation);return response;},error=>{recordRootTraffic('failure',raw,'fetch');finishRootDiscoveryObservation(rootObservation,null);throw error;});}const diagnostic=genericDiagnosticInfo(raw,method,'fetch');if(!diagnostic){if(!rootObservation)return original.apply(this,args);return original.apply(this,args).then(response=>{observeSameOriginListResponse(raw,response,rootObservation);return response;},error=>{finishRootDiscoveryObservation(rootObservation,null);throw error;});}const requestRateContext=rateContext();
   recordStarredNetwork('request',diagnostic);let pending;try{pending=original.apply(this,args);}catch(error){recordStarredNetwork('failure',diagnostic);throw error;}
   return pending.then(response=>{const meta={...diagnostic,status:Number.isFinite(response.status)?response.status:null};recordRootTraffic('response',raw,'fetch',meta.status);if(response.status===429)recordRateLimit(raw,429,requestRateContext);recordStarredNetwork('response',meta);
    observePassiveBackendResponse(raw,response);
    if(likelyListDiagnosticPath(raw))try{response.clone().json().then(payload=>{finishRootDiscoveryObservation(rootObservation,meta.status,payload);recordStarredNetwork('shape',{...meta,safeShape:safeResponseShape(payload)});}).catch(()=>finishRootDiscoveryObservation(rootObservation,meta.status));}catch{finishRootDiscoveryObservation(rootObservation,meta.status);}else finishRootDiscoveryObservation(rootObservation,meta.status);return response;},error=>{recordRootTraffic('failure',raw,'fetch');finishRootDiscoveryObservation(rootObservation,null);recordStarredNetwork('failure',diagnostic);throw error;});}
  const requestId=++requestSequence,meta={requestId,...info,transport:'fetch',rateContext:rateContext()};
  post('request',meta);
  observePartitionRequest(raw,meta);
  let promise;
  try{promise=original.apply(this,args);}catch(error){recordRootTraffic('failure',raw,'fetch');finishRootDiscoveryObservation(rootObservation,null);post('failure',meta);throw error;}
  return promise.then(response=>{
   recordRootTraffic('response',raw,'fetch',response.status);
   post('response',{...meta,status:Number.isFinite(response.status)?response.status:null});
   try{response.clone().json().then(payload=>{finishRootDiscoveryObservation(rootObservation,response.status,payload);observe(raw,payload,{...meta,status:response.status},backendTrafficContext);}).catch(()=>{finishRootDiscoveryObservation(rootObservation,response.status);window.gptObserveBackendResponse?.(raw,null,response.status,backendTrafficContext);post('parsed',{...meta,pathname:info.pathname,recognized:false,topLevelKeys:[],itemsType:'invalid_json',itemCount:null,fieldTypes:{}});});}
   catch{finishRootDiscoveryObservation(rootObservation,response.status);window.gptObserveBackendResponse?.(raw,null,response.status,backendTrafficContext);post('parsed',{...meta,pathname:info.pathname,recognized:false,topLevelKeys:[],itemsType:'unreadable',itemCount:null,fieldTypes:{}});}
   return response;
  },error=>{recordRootTraffic('failure',raw,'fetch');finishRootDiscoveryObservation(rootObservation,null);post('failure',meta);throw error;});
  };
  Object.defineProperty(wrapped,'__gptListDiagnosticWrapper',{value:true});
  return wrapped;
 };
 const installAccessor=(object,key,wrap,onAssignment)=>{
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  let active=descriptor?.get?descriptor.get.call(object):object[key];
  const enumerable=descriptor?.enumerable??true;
  try{
   Object.defineProperty(object,key,{configurable:true,enumerable,get(){return active;},set(value){onAssignment();active=wrap(value);}});
   active=wrap(active);
  }catch{
   object[key]=wrap(active);
  }
 };
 installAccessor(window,'fetch',wrapFetch,()=>{fetchAssignments++;});
 const methods=new WeakMap(),urls=new WeakMap();
 const wrapOpen=open=>{
  if(typeof open!=='function'||open.__gptListDiagnosticWrapper)return open;
  const wrapped=function(method,url,...rest){methods.set(this,method);urls.set(this,url);return open.call(this,method,url,...rest);};
  Object.defineProperty(wrapped,'__gptListDiagnosticWrapper',{value:true});return wrapped;
 };
 const wrapSend=send=>{
  if(typeof send!=='function'||send.__gptListDiagnosticWrapper)return send;
  const wrapped=function(...args){
  const raw=urls.get(this),method=methods.get(this),info=targetInfo(raw,method),diagnostic=info?null:genericDiagnosticInfo(raw,method,'XHR');
  const backendTrafficContext=window.gptCaptureBackendTrafficContext?.()||null;
  const rootObservation=beginRootDiscoveryObservation(raw,method,'XHR');
  recordRootTraffic('request',raw,'XHR');
  if(!info&&isConversationActivityPath(raw)){const requestRateContext=rateContext();window.gptReportHistoryRequest?.(raw,requestRateContext);this.addEventListener('load',()=>{recordRootTraffic('response',raw,'XHR',this.status);if(this.status===429){finishRootDiscoveryObservation(rootObservation,429);window.gptObserveConversationActivity?.(raw,null,429,requestRateContext,backendTrafficContext);return;}try{const payload=this.responseType==='json'?this.response:JSON.parse(this.responseText);finishRootDiscoveryObservation(rootObservation,this.status,payload);window.gptObserveConversationActivity?.(raw,payload,this.status,requestRateContext,backendTrafficContext);}catch{finishRootDiscoveryObservation(rootObservation,this.status);window.gptObserveBackendResponse?.(raw,null,this.status,backendTrafficContext);}},{once:true});for(const event of ['error','timeout','abort'])this.addEventListener(event,()=>{recordRootTraffic('failure',raw,'XHR');finishRootDiscoveryObservation(rootObservation,null);},{once:true});return send.apply(this,args);}
  if(!info&&(!starredNetworkWindow&&!backendTrafficContext||!diagnostic)){if(!info&&isChatGPTBackendPath(raw)){this.addEventListener('load',()=>{recordRootTraffic('response',raw,'XHR',this.status);observePassiveBackendResponse(raw,this,rootObservation);},{once:true});for(const event of ['error','timeout','abort'])this.addEventListener(event,()=>{recordRootTraffic('failure',raw,'XHR');finishRootDiscoveryObservation(rootObservation,null);},{once:true});}else if(rootObservation){this.addEventListener('load',()=>{let response=this;try{if(this.responseType==='json')response={status:this.status,clone:()=>({json:async()=>this.response})};else response={status:this.status,clone:()=>({json:async()=>JSON.parse(this.responseText)})};}catch{response={status:this.status,clone:()=>({json:()=>Promise.reject(Error('invalid_json'))})};}observeSameOriginListResponse(raw,response,rootObservation);},{once:true});for(const event of ['error','timeout','abort'])this.addEventListener(event,()=>finishRootDiscoveryObservation(rootObservation,null),{once:true});}return send.apply(this,args);}
  if(!info){const requestRateContext=rateContext();recordStarredNetwork('request',diagnostic);this.addEventListener('load',()=>{const meta={...diagnostic,status:Number.isFinite(this.status)?this.status:null};recordRootTraffic('response',raw,'XHR',meta.status);if(this.status===429)recordRateLimit(raw,429,requestRateContext);recordStarredNetwork('response',meta);
    try{const payload=this.responseType==='json'?this.response:JSON.parse(this.responseText);window.gptObserveBackendResponse?.(raw,payload,this.status);}catch{window.gptObserveBackendResponse?.(raw,null,this.status);}
    if(likelyListDiagnosticPath(raw))try{const payload=this.responseType==='json'?this.response:JSON.parse(this.responseText);finishRootDiscoveryObservation(rootObservation,meta.status,payload);recordStarredNetwork('shape',{...meta,safeShape:safeResponseShape(payload)});}catch{finishRootDiscoveryObservation(rootObservation,meta.status);}else finishRootDiscoveryObservation(rootObservation,meta.status);},{once:true});for(const event of ['error','timeout','abort'])this.addEventListener(event,()=>{recordRootTraffic('failure',raw,'XHR');finishRootDiscoveryObservation(rootObservation,null);recordStarredNetwork('failure',diagnostic);},{once:true});return send.apply(this,args);}
  const requestId=++requestSequence,meta={requestId,...info,transport:'XHR',rateContext:rateContext()};post('request',meta);
  observePartitionRequest(raw,meta);
  this.addEventListener('load',()=>{
   recordRootTraffic('response',raw,'XHR',this.status);
   const status=Number.isFinite(this.status)?this.status:null;post('response',{...meta,status});
   try{const payload=this.responseType==='json'?this.response:JSON.parse(this.responseText);finishRootDiscoveryObservation(rootObservation,status,payload);observe(raw,payload,{...meta,status},backendTrafficContext).catch(()=>post('failure',meta));}
   catch{finishRootDiscoveryObservation(rootObservation,status);window.gptObserveBackendResponse?.(raw,null,status,backendTrafficContext);post('parsed',{...meta,pathname:info.pathname,recognized:false,topLevelKeys:[],itemsType:'invalid_json',itemCount:null,fieldTypes:{}});}
  },{once:true});
  for(const event of ['error','timeout','abort'])this.addEventListener(event,()=>{finishRootDiscoveryObservation(rootObservation,null);post('failure',meta);},{once:true});
  return send.apply(this,args);
  };
  Object.defineProperty(wrapped,'__gptListDiagnosticWrapper',{value:true});return wrapped;
 };
 installAccessor(XMLHttpRequest.prototype,'open',wrapOpen,()=>{xhrOpenAssignments++;});
 installAccessor(XMLHttpRequest.prototype,'send',wrapSend,()=>{xhrSendAssignments++;});
 try{if(typeof window.gptListCycleConfig?.token==='string')post('root_hook_health',rootDiscoveryState(window.gptListCycleConfig.token));}catch{}
 try{setTimeout(snapshot,15000);}catch{}
})();

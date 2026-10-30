(() => {
 if(location.origin!=='https://chatgpt.com')return;
 const timestamp=value=>{
  if(typeof value==='number'&&Number.isFinite(value))return value>1e12?value:value*1000;
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value))return Date.parse(value);
  return NaN;
 };
 const valid=value=>Number.isFinite(value)&&value>0&&value<=Date.now();
 const activity=payload=>{
  const top=timestamp(payload?.update_time);
  if(valid(top))return {timestamp:top,timestampSource:'conversation_update_time',timestampField:'update_time',timestampFieldType:typeof payload?.update_time};
  for(const field of ['last_activity_at','updated_at','lastActivityAt']){
   const value=timestamp(payload?.[field]);if(valid(value))return {timestamp:value,timestampSource:'conversation_activity_timestamp',timestampField:field,timestampFieldType:typeof payload[field]};
  }
  // Read timestamp fields only; message content and attachment data are never inspected.
  const nodes=payload?.mapping&&typeof payload.mapping==='object'?Object.values(payload.mapping):Array.isArray(payload?.messages)?payload.messages:[];
  const times=nodes.flatMap(node=>{const message=node?.message||node;return ['update_time','create_time'].map(field=>({field,value:timestamp(message?.[field])}));}).filter(item=>valid(item.value));
  if(!times.length)return null;
  const latest=times.reduce((a,b)=>b.value>a.value?b:a);
  const messageNode=nodes.find(node=>{const message=node?.message||node;return timestamp(message?.[latest.field])===latest.value;});
  const latestMessage=messageNode?.message||messageNode;
  return {timestamp:latest.value,timestampSource:'latest_message_timestamp',timestampField:latest.field,timestampFieldType:typeof latestMessage?.[latest.field]};
 };
 const safeContext=context=>{
  const allowed=['scheduler_discovery','scheduler_conversation_check','isolated_prefix_diagnostic','isolated_timestamp_fallback','unrelated_passive_traffic'];
  const owner=allowed.includes(context?.owner)?context.owner:'unrelated_passive_traffic';
  const generation=typeof context?.generation==='string'&&/^[A-Za-z0-9-]{1,128}$/.test(context.generation)?context.generation:null;
  const stage=typeof context?.stage==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(context.stage)?context.stage:'unknown';
  return {owner,generation,stage};
 };
 let backendTrafficObservation=null;
 let backendTrafficResponseSequence=0;
 const backendEndpointFamily=pathname=>{
  if(pathname==='/backend-api/conversations')return 'root_conversation_list';
  if(/^\/backend-api\/gizmos\/[^/]+\/conversations\/?$/.test(pathname))return 'project_conversation_list';
  if(/^\/backend-api\/conversations?\/[^/]+\/messages\/?$/.test(pathname))return 'conversation_messages';
  if(/^\/backend-api\/conversations?\/[^/]+\/?$/.test(pathname))return 'conversation_detail';
  return /(conversation|messages|chat|thread|sidebar|history)/i.test(pathname)?'conversation_related_other':'unrelated_backend';
 };
 const backendTrafficContext=()=>backendTrafficObservation?.active?{generation:backendTrafficObservation.generation}:null;
 const identityOf=value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  for(const key of ['conversation_id','conversationId'])if(typeof value[key]==='string'&&/^[A-Za-z0-9-]{1,128}$/.test(value[key]))return value[key];
  const hasConversationMetadata=['is_starred','is_archived','mapping','messages'].some(key=>Object.prototype.hasOwnProperty.call(value,key));
  if(hasConversationMetadata&&typeof value.id==='string'&&/^[A-Za-z0-9-]{1,128}$/.test(value.id))return value.id;
  return null;
 };
 const candidateTime=value=>{const parsed=timestamp(value);return valid(parsed)?parsed:null;};
 const inspectConversationPayload=(payload,id,family,pathMatches)=>{
  const matches=[];let inspected=0;
  const visit=(node,depth)=>{
   if(!node||typeof node!=='object'||depth>8||inspected>=5000)return;
   inspected++;
   if(Array.isArray(node)){for(const child of node){visit(child,depth+1);if(inspected>=5000)break;}return;}
   if(identityOf(node)===id||node.id===id)matches.push(node);
   for(const key of Object.keys(node)){const child=node[key];if(child&&typeof child==='object')visit(child,depth+1);if(inspected>=5000)break;}
  };
  if(pathMatches)matches.push(payload);else visit(payload,0);
  const nodes=[...new Set(matches)],present=[],candidates=[];
  const add=(node,scope)=>{
   if(!node||typeof node!=='object'||Array.isArray(node))return;
   for(const field of ['update_time','last_activity_at','updated_at','lastActivityAt','activity_at','activity_time','last_message_at','last_message_time'])if(Object.prototype.hasOwnProperty.call(node,field)){
    const value=node[field],type=value===null?'null':Array.isArray(value)?'array':typeof value;present.push({field,type});const parsed=candidateTime(value);if(parsed!==null)candidates.push({field,type,value:parsed,scope});
   }
   const messages=[];if(node.mapping&&typeof node.mapping==='object')messages.push(...Object.values(node.mapping));if(Array.isArray(node.messages))messages.push(...node.messages);if(node.message&&typeof node.message==='object')messages.push(node.message);
   for(const entry of messages.slice(0,500)){const message=entry?.message||entry;if(!message||typeof message!=='object'||Array.isArray(message))continue;
    for(const field of ['update_time','create_time'])if(Object.prototype.hasOwnProperty.call(message,field)){
     const value=message[field],type=value===null?'null':Array.isArray(value)?'array':typeof value;present.push({field,type});const parsed=candidateTime(value);if(parsed!==null)candidates.push({field,type,value:parsed,scope:'latest_message'});
    }
   }
  };
  for(const node of nodes)add(node,'conversation');
  candidates.sort((a,b)=>b.value-a.value);const selected=candidates[0]||null,field=selected?.field||present[0]?.field||null,type=selected?.type||present[0]?.type||'none';
  return {timestampFieldPresent:present.length>0,timestampField:field,timestampFieldType:type,timestampValue:selected?.value??null,
   timestampSource:selected?`${family}.${selected.scope==='latest_message'?'latest_message.':''}${selected.field}`:null};
 };
 window.gptBeginBackendTrafficObservation=(generation,expectedConversationId)=>{
  if(typeof generation!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(generation)||typeof expectedConversationId!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(expectedConversationId))return false;
  backendTrafficObservation={generation,expectedConversationId,active:true};return true;
 };
 window.gptCaptureBackendTrafficContext=()=>backendTrafficContext();
 window.gptBackendTrafficObservationActive=()=>!!backendTrafficContext();
 window.gptEndBackendTrafficObservation=generation=>{
  if(!backendTrafficObservation||backendTrafficObservation.generation!==generation)return false;
  backendTrafficObservation.active=false;return true;
 };
 // Always-on passive observer. Native code decides whether a response belongs to
 // the current operation; this hook never receives an operation activation call.
 window.gptObserveBackendResponse=(raw,payload,status)=>{
  let url;try{url=new URL(raw,location.href);}catch{return false;}
  if(url.origin!=='https://chatgpt.com'||!url.pathname.startsWith('/backend-api/'))return false;
  const family=backendEndpointFamily(url.pathname),pathIdMatch=url.pathname.match(/^\/backend-api\/conversations?\/([A-Za-z0-9-]+)(?:\/messages)?\/?$/),pathId=pathIdMatch?.[1]||null;
  const ids=new Set();if(pathId&&/^[A-Za-z0-9-]{1,128}$/.test(pathId))ids.add(pathId);
  let inspected=0;const collect=(node,depth=0,listItem=false)=>{if(!node||typeof node!=='object'||depth>8||inspected>=5000)return;inspected++;if(Array.isArray(node)){for(const child of node){collect(child,depth+1,listItem);if(inspected>=5000)break;}return;}const id=identityOf(node)||(listItem&&typeof node.id==='string'&&/^[A-Za-z0-9-]{1,128}$/.test(node.id)&&Object.prototype.hasOwnProperty.call(node,'update_time')?node.id:null);if(id&&ids.size<200)ids.add(id);for(const key of Object.keys(node)){const child=node[key];if(child&&typeof child==='object')collect(child,depth+1,key==='items'||key==='conversations');if(inspected>=5000)break;}};
  if(payload&&typeof payload==='object')collect(payload);
  const safeStatus=Number.isSafeInteger(status)?status:0,responseSequence=++backendTrafficResponseSequence,capturedAtMs=Date.now();
  const candidates=ids.size?[...ids]:[null];
  for(const id of candidates){
   const metadata=id?inspectConversationPayload(payload,id,family,id===pathId):{timestampFieldPresent:false,timestampField:null,timestampFieldType:'none',timestampValue:null,timestampSource:null};
   const conversationRelated=['conversation_messages','conversation_detail','root_conversation_list','project_conversation_list'].includes(family)||!!id;
   const endpointFamily=family==='unrelated_backend'&&id?'conversation_related_other':family;
   window.webkit?.messageHandlers?.backendTraffic?.postMessage({responseSequence,capturedAtMs,endpointFamily,httpStatus:safeStatus,
    conversationId:id,conversationIdPresent:!!id,conversationRelated,
    timestampFieldPresent:metadata.timestampFieldPresent,timestampField:metadata.timestampField,
    timestampFieldType:metadata.timestampFieldType,timestampValue:metadata.timestampValue,timestampSource:metadata.timestampSource});
  }
  return true;
 };
  const family=path=>path.endsWith('/messages')?'conversation_messages':'conversation_detail';
 window.gptReportHistoryRequest=(raw,requestContext=null)=>{
  let url;try{url=new URL(raw,location.href);}catch{return false;}
  if(url.origin!==location.origin)return false;
  const endpointFamily=family(url.pathname),context=safeContext(requestContext||window.gptCaptureRateLimitContext?.());
  if(!['conversation_messages','conversation_detail'].includes(endpointFamily)||context.owner!=='scheduler_conversation_check'||typeof context.generation!=='string')return false;
  try{window.webkit?.messageHandlers?.chatCheck?.postMessage({event:'history_request',endpointFamily,owner:context.owner,generation:context.generation});}catch{}
  return true;
 };
 window.gptChatCheckHookHealth=expectedGeneration=>{
  const context=safeContext(window.gptCaptureRateLimitContext?.());
  return {activityHookInstalled:typeof window.gptSanitizeConversationActivity==='function'&&typeof window.gptReportHistoryRequest==='function',
   fetchHookActive:window.fetch?.__gptListDiagnosticWrapper===true,
   xhrHookActive:XMLHttpRequest.prototype.open?.__gptListDiagnosticWrapper===true&&XMLHttpRequest.prototype.send?.__gptListDiagnosticWrapper===true,
   generationAttached:context.owner==='scheduler_conversation_check'&&context.generation===expectedGeneration};
 };
 const observe=(raw,payload,status,requestContext=null,backendContext=null)=>{
  let url;try{url=new URL(raw,location.href);}catch{return;}
  if(url.origin!==location.origin)return;
  window.gptObserveBackendResponse?.(raw,payload,status);
  const endpointMatch=url.pathname.match(/^\/backend-api\/conversations?\/([A-Za-z0-9-]+)(?:\/messages)?\/?$/);
  if(!endpointMatch)return;
  const conversationId=endpointMatch[1],endpointFamily=family(url.pathname),context=safeContext(requestContext||window.gptCaptureRateLimitContext?.());
  if(status===429)window.gptRecordRateLimit?.(url.pathname,status,context);
  const payloadObject=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload:{};
  const result=status>=200&&status<300?activity(payloadObject):null;
  const fields=['update_time','last_activity_at','updated_at','lastActivityAt'];
  let field=result?.timestampField||fields.find(name=>Object.prototype.hasOwnProperty.call(payloadObject,name))||null;
  let timestampRaw=field?(payloadObject[field]??null):null;
  if(!field){
   const nodes=payloadObject.mapping&&typeof payloadObject.mapping==='object'?Object.values(payloadObject.mapping):Array.isArray(payloadObject.messages)?payloadObject.messages:[];
   for(const node of nodes){const message=node?.message||node;if(!message||typeof message!=='object')continue;field=['update_time','create_time'].find(name=>Object.prototype.hasOwnProperty.call(message,name))||null;if(field){timestampRaw=message[field]??null;break;}}
  }
  const fieldType=result?.timestampFieldType||(timestampRaw===null?'null':Array.isArray(timestampRaw)?'array':typeof timestampRaw);
  // This bridge carries only technical routing metadata and a parsed activity timestamp.
  // Never send a raw URL, query, response body, message text, title, or attachment data.
  window.webkit?.messageHandlers?.activity?.postMessage({conversationId,timestamp:result?.timestamp??null,timestampSource:result?.timestampSource??null,
   endpointFamily,httpStatus:Number.isSafeInteger(status)?status:0,operationOwner:context.owner,operationGeneration:context.generation,occurredAtStage:context.stage,
   timestampFieldPresent:!!field,timestampFieldType:fieldType});
 };
 window.gptSanitizeConversationActivity=activity;
 window.gptObserveConversationActivity=observe;
})();

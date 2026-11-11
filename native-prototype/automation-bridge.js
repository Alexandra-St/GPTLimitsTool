(() => {
 let pending=[], config=null, state=null, baseline=new Set(), baselineWasComplete=false, overlap=false, oldest=false, received=0;
 let firstPassAcceptedPageCount=0,firstPassRequestTrackedPageCount=0,firstPassPreConfigurationPendingAcceptedPageCount=0,firstPassOtherAcceptedPageCount=0;
 let firstPassPreConfigurationPendingPageCount=0,firstPassPreConfigurationPendingItemCount=0;
 const firstPassPageTrace=[],firstPassTrackedIdentityIds=new Set(),firstPassOtherOriginIdentityIds=new Set();
 const firstPassIdentityProvenance=new Map(),firstPassProvenanceLimit=50000;let firstPassProvenanceTruncated=false;
 const provenanceCategories=['initial_dom','initial_document_payload','ui/bootstrap_prefetch','conversation_detail','conversation_messages_request_tracked','conversation_messages_untracked','page_hook_preexisting','page_hook_event_without_request_record','checkpoint_cache','response_origin_unknown'];
 const firstPassSourcePageCounts=Object.create(null);let firstPassTrackedIdentitySetTruncated=false,firstPassOtherOriginIdentitySetTruncated=false;
 const firstPassTelemetryLimit=64,firstPassIdentityLimit=50000;
 let observedMessageIds=new Set(),paginationFrontierTimestamp=null,continuationOlderIds=new Set();
 let previousPageActivityBounds=null,olderHistoryProgressObserved=false,olderUniqueBaselineMessageCount=0;
 let replayProgressObserved=false,replayPagesProgressed=0;
 const pageFingerprint=items=>{let hash=2166136261;const ids=items.map(item=>typeof item?.id==='string'?item.id:'').filter(Boolean).sort();for(const id of ids){for(let i=0;i<id.length;i++){hash^=id.charCodeAt(i);hash=Math.imul(hash,16777619);}hash^=0xff;hash=Math.imul(hash,16777619);}return `${ids.length}:${(hash>>>0).toString(16).padStart(8,'0')}`;};
 const knownPageFingerprints=new Set(),knownRequestCursorFingerprints=new Set(),knownResponseCursorFingerprints=new Set();
 const firstPassPageFingerprints=new Set(),firstPassRequestCursorFingerprints=new Set(),firstPassResponseCursorFingerprints=new Set();
 const continuationPageFingerprints=new Set(),continuationRequestCursorFingerprints=new Set(),continuationResponseCursorFingerprints=new Set();
 let lastPipelineActivityBounds=null;
 const emitContinuationStage=(generation,stage,extra={})=>{try{window.webkit?.messageHandlers?.chatCheck?.postMessage({event:'continuation_stage',generation,stage,source:'js',...extra});}catch{}};
 const emitHistoryResponseParseDiagnostic=(pipeline,acceptance)=>{
  const diagnostic=pipeline?.responseParseDiagnostic;
  if(!diagnostic||!config||config.continuation||pipeline.liveResumeGeneration!==config.token)return;
  const pageAcceptanceReason=['route_mismatch','generation_mismatch','document_mismatch','page_handoff_missing','empty_page','no_older_items'].includes(acceptance?.reason)?acceptance.reason:'none';
  try{window.webkit?.messageHandlers?.chatCheck?.postMessage({event:'history_response_parse_diagnostic',generation:config.token,sequence:Number.isSafeInteger(pipeline.sequence)?pipeline.sequence:null,responseParseDiagnostic:diagnostic,pageAcceptanceReason,pageUpdateCallbackFired:acceptance?.accepted===true});}catch{}
 };
 const liveResumeDocumentIdentity=(()=>{try{return `${Math.floor(performance.timeOrigin)}:${Math.random().toString(36).slice(2)}`;}catch{return `doc:${Math.random().toString(36).slice(2)}`;}})();
 window.gptLiveResumeDocumentIdentity=liveResumeDocumentIdentity;
 const PINNED_DIAGNOSTIC_VERSION='__PINNED_DIAGNOSTIC_VERSION__';
 window.pinnedDiagnosticVersion=PINNED_DIAGNOSTIC_VERSION;
 let activePinDiagnostic=null;
 const boundedDiagnosticAwait=async(stage,operation,timeoutMs)=>{
  let timer;
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'timeout',reason:`stage_timeout:${stage}`}),Math.max(0,timeoutMs));});
  try{return await Promise.race([Promise.resolve().then(operation).then(value=>({status:'resolved',value}),()=>({status:'error',reason:`stage_error:${stage}`})),timeout]);}
  finally{clearTimeout(timer);}
 };
 window.gptBoundedDiagnosticAwait=boundedDiagnosticAwait;
 const emitPinnedActivityStage=(options,stage,extra={})=>{
  if(options?.includePinnedRecords!==true||typeof options.activityDiagnosticToken!=='string')return;
  try{window.webkit?.messageHandlers?.starredDiagnostic?.postMessage({activityDiagnosticToken:options.activityDiagnosticToken,pinnedActivityProgress:{stage,...extra}});}catch{}
 };
 const waitForFramesBounded=async(count=2,timeoutMs=300)=>{
  for(let i=0;i<count;i++){
   const result=await Promise.race([
    new Promise(resolve=>{try{window.requestAnimationFrame(()=>resolve(true));}catch{resolve(false);}}),
    new Promise(resolve=>setTimeout(()=>resolve(false),timeoutMs))
   ]);
   if(result!==true)return false;
  }
  return true;
 };
 const clean=s=>s?{
 conversationId:s.conversationId,title:s.title,processedMessageIds:s.processedMessageIds,
 messagesCollected:s.messagesCollected,userMessages:s.userMessages,assistantMessages:s.assistantMessages,otherMessages:s.otherMessages,
 estimatedTextTokens:s.estimatedTextTokens,attachments:{images:s.attachments.images,audio:s.attachments.audio,video:s.attachments.video,files:s.attachments.files},
 historyComplete:s.historyComplete,hasPreviousPage:s.hasPreviousPage,hasNextPage:s.hasNextPage,responsesCaptured:s.responsesCaptured,updatedAt:s.updatedAt}:null;
 const chatTurnEvidenceIn=node=>{if(!node)return {user:false,assistant:false};const has=(selector)=>{try{return node.matches?.(selector)===true||!!node.querySelector?.(selector);}catch{return false;}};return {user:has('[data-user-message-bubble]'),assistant:has('[data-chatgpt-agent-turn-start]')};};
 const outermostCandidates=nodes=>{const unique=[...new Set(nodes)].filter(Boolean),set=new Set(unique);return unique.filter(node=>{for(let parent=node.parentElement;parent;parent=parent.parentElement)if(set.has(parent))return false;return true;});};
 window.gptConversationTurnReadiness=()=>{
  const path=String(location.pathname||''),chatRoute=/^\/c\/[^/]+\/?$/.test(path)||/^\/g\/[^/]+\/c\/[^/]+\/?$/.test(path);
  if(!chatRoute)return {routeCategory:'other',turnCount:0,userTurnCount:0,assistantTurnCount:0,unknownRoleTurnCount:0,source:'none'};
  let main=null;try{main=document.querySelector("main, [role='main']");}catch{}
  if(!main)return {routeCategory:'chat',turnCount:0,userTurnCount:0,assistantTurnCount:0,unknownRoleTurnCount:0,source:'none'};
  let context=main;try{const scrollers=GptHistoryCollector.findScrollableContainers(document,window).filter(node=>node===main||main.contains?.(node));if(scrollers.length)context=scrollers[0];}catch{}
  let turns=[];let source='legacy';
  try{const primary=Array.from(context.querySelectorAll('[data-turn-key]'));if(primary.length){turns=outermostCandidates(primary);source='data-turn-key';}
   else {const legacy=Array.from(context.querySelectorAll('[data-message-author-role],[data-conversation-role],[data-user-message-bubble],[data-chatgpt-agent-turn-start],article,[role="article"],[data-testid^="conversation-turn-"],[data-turn]'));turns=outermostCandidates(legacy);}}
  catch{return {routeCategory:'chat',turnCount:0,userTurnCount:0,assistantTurnCount:0,unknownRoleTurnCount:0,source:'scan_failed'};}
  let userTurnCount=0,assistantTurnCount=0,unknownRoleTurnCount=0;
  for(const turn of turns){const evidence=chatTurnEvidenceIn(turn);if(evidence.user!==evidence.assistant){if(evidence.user)userTurnCount++;else assistantTurnCount++;}else unknownRoleTurnCount++;}
  return {routeCategory:'chat',turnCount:Math.min(5000,turns.length),userTurnCount:Math.min(5000,userTurnCount),assistantTurnCount:Math.min(5000,assistantTurnCount),unknownRoleTurnCount:Math.min(5000,unknownRoleTurnCount),source};
 };
 const sourceCategory=(pipeline,page,eventData)=>{const cls=pipeline?.requestClass||page?.sourceLineage?.endpointClass,origin=pipeline?.requestOrigin||page?.sourceLineage?.requestOrigin,ordinal=pipeline?.requestOrdinal??page?.sourceLineage?.requestOrdinal;if(eventData?.replayRequestId)return 'page_hook_preexisting';if(page?.sourceLineage?.captureSource==='initial_dom')return 'initial_dom';if(page?.sourceLineage?.captureSource==='initial_document_payload')return 'initial_document_payload';if(page?.sourceLineage?.captureSource==='ui/bootstrap_prefetch')return 'ui/bootstrap_prefetch';if(!pipeline&&(!page?.sourceLineage||!page.sourceLineage.requestObserved))return 'page_hook_event_without_request_record';if(cls==='conversation_detail')return 'conversation_detail';if(cls==='conversation_messages')return origin==='first_pass'&&Number.isSafeInteger(ordinal)?'conversation_messages_request_tracked':'conversation_messages_untracked';if(origin==='first_pass'&&Number.isSafeInteger(ordinal))return 'conversation_messages_request_tracked';return 'response_origin_unknown';};
 const addBoundedIdentities=(target,ids,isTracked)=>{let truncated=isTracked?firstPassTrackedIdentitySetTruncated:firstPassOtherOriginIdentitySetTruncated;for(const id of ids){if(target.size>=firstPassIdentityLimit&&!target.has(id)){truncated=true;break;}target.add(id);}if(isTracked)firstPassTrackedIdentitySetTruncated=truncated;else firstPassOtherOriginIdentitySetTruncated=truncated;};
 const provenanceCategoryForPage=meta=>{const requested=['initial_dom','initial_document_payload','ui/bootstrap_prefetch','conversation_detail','conversation_messages_request_tracked','conversation_messages_untracked','page_hook_preexisting','page_hook_event_without_request_record','response_origin_unknown'];const value=meta?.sourceCategory;return requested.includes(value)?value:'response_origin_unknown';};
 const firstPassProvenanceSnapshot=()=>{const counts=Object.fromEntries(provenanceCategories.map(category=>[category,0]));for(const category of firstPassIdentityProvenance.values())counts[category]=(counts[category]||0)+1;const aggregateIds=new Set(Array.isArray(state?.processedMessageIds)?state.processedMessageIds:[]);let missing=0;for(const id of aggregateIds)if(!firstPassIdentityProvenance.has(id))missing++;const attributed=Object.values(counts).reduce((sum,count)=>sum+count,0);return{counts,aggregateIdentityCount:aggregateIds.size,attributedIdentityCount:attributed,gapCount:Math.max(0,aggregateIds.size-attributed),aggregateProvenanceGap:missing>0||attributed!==aggregateIds.size||firstPassProvenanceTruncated,identitySetTruncated:firstPassProvenanceTruncated};};
 const continuationProvenanceCounts=ids=>{const counts={known_from_initial_dom:0,known_from_bootstrap:0,known_from_conversation_detail:0,known_from_tracked_messages:0,known_from_untracked_messages:0,known_from_checkpoint_cache:0,known_from_other:0,genuinely_new:0};for(const id of ids){const source=firstPassIdentityProvenance.get(id);if(!baseline.has(id)){counts.genuinely_new++;continue;}if(source==='initial_dom')counts.known_from_initial_dom++;else if(source==='initial_document_payload'||source==='ui/bootstrap_prefetch')counts.known_from_bootstrap++;else if(source==='conversation_detail')counts.known_from_conversation_detail++;else if(source==='conversation_messages_request_tracked')counts.known_from_tracked_messages++;else if(source==='conversation_messages_untracked')counts.known_from_untracked_messages++;else if(source==='checkpoint_cache')counts.known_from_checkpoint_cache++;else counts.known_from_other++;}return counts;};
 const consume=(page,pageOrigin='untracked_response',sourceMeta=null)=>{if(!page)return {accepted:false,reason:'page_handoff_missing'};if(!config){pending.push({page,captureOrigin:'unattributed_capture',sourceMeta});if(pending.length>50)pending.shift();return {accepted:false,reason:'configuration_not_ready'};}if(page.conversationId!==config.id)return {accepted:false,reason:'route_mismatch'};
 const continuation=config.continuation===true;
 if(continuation&&page.liveResumeGeneration!==config.token)return {accepted:false,reason:'generation_mismatch'};
 let acceptedPage=page;
 let continuationBreakdown=null,continuationFrontier=null,dominantReason=null;
 if(continuation){
  const counts={totalItems:page.items.length,alreadyKnownIdentity:0,duplicateWithinPage:0,missingIdentity:0,missingTimestamp:0,invalidTimestamp:0,notOlderThanFrontier:0,olderThanFrontierButRejectedOther:0,eligibleOlder:0,accepted:0,older:0,equal:0,newer:0,timestampUnknown:0};
  const older=page.items.filter(item=>typeof item?.id==='string'&&!baseline.has(item.id)&&Number.isFinite(Number(item.activityTime))&&Number(item.activityTime)>0&&Number(item.activityTime)<config.expectedFrontier);
  const pageSeen=new Set();const frontier=Number(config.expectedFrontier),frontierValid=Number.isFinite(frontier)&&frontier>0;
  for(const item of page.items){
   const id=typeof item?.id==='string'&&item.id.length>0?item.id:null,rawTime=item?.activityTime;
   const hasTime=rawTime!==undefined&&rawTime!==null&&rawTime!=='',time=Number(rawTime),timeValid=hasTime&&Number.isFinite(time)&&time>0;
   if(!id){counts.missingIdentity++;counts.timestampUnknown++;continue;}
   if(baseline.has(id)){counts.alreadyKnownIdentity++;if(timeValid&&frontierValid){if(time<frontier)counts.older++;else if(time===frontier)counts.equal++;else counts.newer++;}else counts.timestampUnknown++;continue;}
   if(pageSeen.has(id)){counts.duplicateWithinPage++;if(timeValid&&frontierValid){if(time<frontier)counts.older++;else if(time===frontier)counts.equal++;else counts.newer++;}else counts.timestampUnknown++;continue;}
   pageSeen.add(id);
   if(!hasTime){counts.missingTimestamp++;counts.timestampUnknown++;continue;}
   if(!timeValid){counts.invalidTimestamp++;counts.timestampUnknown++;continue;}
   if(!frontierValid){counts.olderThanFrontierButRejectedOther++;counts.timestampUnknown++;continue;}
   if(time<frontier){counts.older++;counts.eligibleOlder++;}
   else if(time===frontier){counts.equal++;counts.notOlderThanFrontier++;}
   else{counts.newer++;counts.notOlderThanFrontier++;}
  }
  counts.accepted=older.length;continuationBreakdown=counts;
  continuationFrontier={exists:frontierValid,source:'first_pass_pagination_frontier',timestampValid:frontierValid,identityPresent:false,comparisonMode:'activity_timestamp_and_message_identity',older:counts.older,equal:counts.equal,newer:counts.newer,timestampUnknown:counts.timestampUnknown};
  dominantReason=older.length?'none':page.items.length===0?'no_older_items_empty_page':
   counts.alreadyKnownIdentity===page.items.length?'no_older_items_all_already_known':
   counts.missingIdentity===page.items.length?'no_older_items_missing_identity':
   counts.missingTimestamp+counts.invalidTimestamp===page.items.length?'no_older_items_missing_timestamps':
   counts.notOlderThanFrontier===page.items.length?'no_older_items_not_before_frontier':
   counts.olderThanFrontierButRejectedOther>0?'no_older_items_other_filter':'no_older_items_mixed_rejections';
  if(!older.length)return {accepted:false,reason:page.items.length===0?'empty_page':'no_older_items',itemBreakdown:continuationBreakdown,frontier:continuationFrontier,dominantReason};
  for(const item of older)continuationOlderIds.add(item.id);
  const olderIds=new Set(older.map(item=>item.id));
  acceptedPage={...page,items:page.items.filter(item=>baseline.has(item?.id)||olderIds.has(item?.id))};
 }
 oldest ||= acceptedPage.isPaginationResponse === true && acceptedPage.hasPreviousPage === false;
 overlap ||= acceptedPage.items.some(x=>baseline.has(x.id));
 const pageTimes=acceptedPage.items.map(item=>Number(item.activityTime)).filter(value=>Number.isFinite(value)&&value>0);
 const pageActivityMinimum=pageTimes.length?Math.min(...pageTimes):null,pageActivityMaximum=pageTimes.length?Math.max(...pageTimes):null;
 const pageIds=acceptedPage.items.map(item=>item?.id).filter(id=>typeof id==='string');
 const fingerprint=pageFingerprint(acceptedPage.items);
 const pageNewBaselineIds=new Set(pageIds.filter(id=>!baseline.has(id)&&!observedMessageIds.has(id)));
 const knownPageIds=pageIds.filter(id=>baseline.has(id)).length;
 let olderPageTransition=false;
 if(previousPageActivityBounds&&pageActivityMinimum!==null&&pageActivityMaximum!==null){
  olderPageTransition=pageActivityMaximum<previousPageActivityBounds.minimum||
   (pageActivityMinimum<previousPageActivityBounds.minimum&&pageActivityMaximum<=previousPageActivityBounds.maximum);
 }
 const direction=olderPageTransition?'older':(previousPageActivityBounds?'not_older':'first_page');
 const replayPage=pageIds.length>0&&knownPageIds===pageIds.length;
 if(!continuation&&replayPage&&olderPageTransition&&acceptedPage.hasPreviousPage===true){replayProgressObserved=true;replayPagesProgressed++;}
 const newHistoryProgress=!continuation&&olderPageTransition&&pageNewBaselineIds.size>0&&acceptedPage.hasPreviousPage===true;
 if(newHistoryProgress)olderHistoryProgressObserved=true;
 if(!continuation)olderUniqueBaselineMessageCount+=pageNewBaselineIds.size;
 if(pageActivityMinimum!==null&&pageActivityMaximum!==null)previousPageActivityBounds={minimum:pageActivityMinimum,maximum:pageActivityMaximum};
 for(const item of acceptedPage.items){
  observedMessageIds.add(item.id);
  const activity=Number(item.activityTime);
  if(Number.isFinite(activity)&&activity>0&&(paginationFrontierTimestamp===null||activity<paginationFrontierTimestamp))paginationFrontierTimestamp=activity;
 }
 try{window.webkit?.messageHandlers?.chatCheck?.postMessage({event:'stage',stage:'aggregation_started',generation:config.token});}catch{}
 if(!continuation&&firstPassIdentityProvenance.size===0){for(const id of baseline){if(firstPassIdentityProvenance.size>=firstPassProvenanceLimit){firstPassProvenanceTruncated=true;break;}firstPassIdentityProvenance.set(id,'checkpoint_cache');}}const firstPassSource=provenanceCategoryForPage(sourceMeta);state=GptLimitsAggregator.mergePage(state,acceptedPage);received++;if(!continuation){for(const id of state.processedMessageIds||[])if(!firstPassIdentityProvenance.has(id)){if(firstPassIdentityProvenance.size<firstPassProvenanceLimit)firstPassIdentityProvenance.set(id,firstPassSource);else firstPassProvenanceTruncated=true;}const provenance=firstPassProvenanceSnapshot();try{window.webkit?.messageHandlers?.chatCheck?.postMessage({event:'first_pass_identity_provenance',generation:config.token,provenance});}catch{}firstPassAcceptedPageCount++;if(pageOrigin==='request_tracked')firstPassRequestTrackedPageCount++;else if(pageOrigin==='pre_configuration_pending')firstPassPreConfigurationPendingAcceptedPageCount++;else firstPassOtherAcceptedPageCount++;const meta=sourceMeta||{},category=['initial_dom','conversation_messages_request_tracked','conversation_messages_untracked','conversation_detail','page_hook_preexisting','initial_document_payload','ui/bootstrap_prefetch','page_hook_event_without_request_record','response_origin_unknown'].includes(meta.sourceCategory)?meta.sourceCategory:'response_origin_unknown',elapsed=typeof performance!=='undefined'?Math.max(0,Math.round(performance.now())):0,trackedAtAcceptance=firstPassRequestTrackedPageCount,inFlight=Math.max(0,Number.isSafeInteger(meta.historyRequestsInFlight)?meta.historyRequestsInFlight:0),trace={pageOrdinal:firstPassAcceptedPageCount,elapsedMs:elapsed,sourceElapsedMs:Number.isSafeInteger(meta.elapsedMs)?meta.elapsedMs:null,sourceCategory:category,pageOrigin,endpointClass:['conversation_messages','conversation_detail','other'].includes(meta.requestClass)?meta.requestClass:'unknown',requestObserved:meta.requestObserved===true,requestOrigin:['first_pass','continuation','unknown'].includes(meta.requestOrigin)?meta.requestOrigin:'unknown',generationPresent:meta.generationPresent===true||typeof meta.generation==='string',generationMatchesFirstPass:meta.generationMatchesFirstPass===true||typeof config.token==='string'&&meta.generation===config.token,requestSequence:Number.isSafeInteger(meta.requestOrdinal)?meta.requestOrdinal:null,responseObserved:meta.responseObserved===true,pageHookSource:['fetch','XHR'].includes(meta.captureSource)?meta.captureSource:'unknown',captureSequence:Number.isSafeInteger(meta.captureSequence)?meta.captureSequence:null,replayRequestIdPresent:meta.replayRequestIdPresent===true,pageFingerprint:fingerprint,itemCount:acceptedPage.items.length,addedNewIdentityCount:pageNewBaselineIds.size,trackedAcceptedCountAtPage:trackedAtAcceptance,trackedRequestsInFlight:inFlight,requestCursorFingerprint:/^[a-f0-9]{8}$/.test(meta.requestCursorFingerprint||'')?meta.requestCursorFingerprint:null};firstPassSourcePageCounts[category]=(firstPassSourcePageCounts[category]||0)+1;if(pageOrigin==='request_tracked')addBoundedIdentities(firstPassTrackedIdentityIds,pageIds,true);else addBoundedIdentities(firstPassOtherOriginIdentityIds,pageIds,false);firstPassPageTrace.push(trace);if(firstPassPageTrace.length>firstPassTelemetryLimit)firstPassPageTrace.shift();}
 if(baselineWasComplete&&overlap){state.historyComplete=true;state.hasPreviousPage=false;}
 try{window.webkit?.messageHandlers?.chatCheck?.postMessage({event:'stage',stage:'aggregation_complete',generation:config.token});}catch{}
 window.webkit.messageHandlers.automation.postMessage({token:config.token,state:clean(state),overlap,oldest,received,documentIdentity:liveResumeDocumentIdentity,paginationFrontierTimestamp,olderUniqueMessageCount:continuationOlderIds.size,continuationProgress:continuationOlderIds.size>0,pageActivityMinimum,pageActivityMaximum,pageDirection:direction,pageFingerprint:fingerprint,pageKnownMessageCount:knownPageIds,pageReplay:replayPage,newHistoryProgress,replayProgressObserved,replayPagesProgressed,olderUniqueBaselineMessageCount,olderHistoryProgressObserved,hasEarlierPages:acceptedPage.hasPreviousPage===true});return {accepted:true,reason:null,pageFingerprint:fingerprint,itemBreakdown:continuationBreakdown,frontier:continuationFrontier,dominantReason};};
 const emitResponsePipeline=(pipeline,page,acceptance)=>{
  if(!config?.continuation)return;
  const generationPassed=pipeline.liveResumeGeneration===config.token;
  const routePassed=pipeline.routeMatches===true&&(!page||page.conversationId===config.id);
  const documentPassed=pipeline.documentIdentity===liveResumeDocumentIdentity;
  const pageFp=pipeline.responsePageFingerprint||acceptance?.pageFingerprint||null;
  const requestCursorFp=pipeline.requestCursorFingerprint||null,responseCursorFp=pipeline.responseCursorFingerprint||null;
  const duplicateFirstPassPage=!!pageFp&&firstPassPageFingerprints.has(pageFp);
  const duplicateFirstPassCursor=!!requestCursorFp&&firstPassRequestCursorFingerprints.has(requestCursorFp);
  const duplicatePage=!!pageFp&&(knownPageFingerprints.has(pageFp)||continuationPageFingerprints.has(pageFp));
  const duplicateCursor=!!requestCursorFp&&(knownRequestCursorFingerprints.has(requestCursorFp)||continuationRequestCursorFingerprints.has(requestCursorFp));
  const duplicateResponseCursor=!!responseCursorFp&&(knownResponseCursorFingerprints.has(responseCursorFp)||continuationResponseCursorFingerprints.has(responseCursorFp));
  if(pageFp)knownPageFingerprints.add(pageFp);
  if(requestCursorFp)knownRequestCursorFingerprints.add(requestCursorFp);
  if(responseCursorFp)knownResponseCursorFingerprints.add(responseCursorFp);
  if(pageFp)continuationPageFingerprints.add(pageFp);
  if(requestCursorFp)continuationRequestCursorFingerprints.add(requestCursorFp);
  if(responseCursorFp)continuationResponseCursorFingerprints.add(responseCursorFp);
  const bounds=pipeline.pageActivityBounds;
  let pageDirection='unknown';
  if(pipeline.requestClass==='conversation_messages'&&Number.isFinite(bounds?.minimum)&&Number.isFinite(bounds?.maximum)){
   if(lastPipelineActivityBounds){pageDirection=bounds.maximum<lastPipelineActivityBounds.minimum||bounds.minimum<lastPipelineActivityBounds.minimum&&bounds.maximum<=lastPipelineActivityBounds.maximum?'older':'not_older';}
   else pageDirection='first_page';
   lastPipelineActivityBounds={minimum:bounds.minimum,maximum:bounds.maximum};
  }
  let rejectionReason=pipeline.rejectionReason||null;
  if(!pipeline.payloadRecognized)rejectionReason ||= 'not_history_payload';
  else if(!generationPassed)rejectionReason='generation_mismatch';
  else if(!routePassed)rejectionReason='route_mismatch';
  else if(!documentPassed)rejectionReason='document_mismatch';
  else if(!page)rejectionReason='page_handoff_missing';
  else if(!acceptance?.accepted){
   rejectionReason=acceptance?.reason||'page_handoff_missing';
   if(rejectionReason==='no_older_items'&&duplicatePage)rejectionReason='duplicate_page';
   else if(rejectionReason==='no_older_items'&&duplicateCursor)rejectionReason='duplicate_cursor';
  } else rejectionReason=null;
  const itemBreakdown=acceptance?.itemBreakdown?{...acceptance.itemBreakdown}:null;
  const pageIdentityKeys=new Set((Array.isArray(page?.items)?page.items:[]).map(item=>typeof item?.id==='string'&&item.id.length>0?item.id:null).filter(Boolean));
  const identityProvenanceCounts=continuationProvenanceCounts(pageIdentityKeys);
  const alreadyKnownUniqueIdentities=[...pageIdentityKeys].filter(identity=>baseline.has(identity)).length;
  const baselineIdentityOverlapCount=Number.isSafeInteger(pipeline.baselineIdentityOverlapCount)?pipeline.baselineIdentityOverlapCount:null;
  if(itemBreakdown){itemBreakdown.uniqueValidIdentities=pageIdentityKeys.size;itemBreakdown.alreadyKnownUniqueIdentities=alreadyKnownUniqueIdentities;}
  const baselineMembershipTelemetryMismatch=baselineIdentityOverlapCount!==null&&baselineIdentityOverlapCount!==alreadyKnownUniqueIdentities;
  const baselineMembershipReason=baselineMembershipTelemetryMismatch?'baseline_membership_telemetry_mismatch':baselineIdentityOverlapCount===null?'baseline_membership_not_comparable':'baseline_membership_consistent';
  const continuationIds=[...pageIdentityKeys],trackedOverlap=firstPassTrackedIdentitySetTruncated?null:continuationIds.filter(id=>firstPassTrackedIdentityIds.has(id)).length,otherOverlap=firstPassOtherOriginIdentitySetTruncated?null:continuationIds.filter(id=>firstPassOtherOriginIdentityIds.has(id)).length;
  try{window.webkit?.messageHandlers?.chatCheck?.postMessage({event:'continuation_response_pipeline',generation:config.token,source:'page_pipeline',sequence:Number.isSafeInteger(pipeline.sequence)?pipeline.sequence:null,requestOrdinal:Number.isSafeInteger(pipeline.requestOrdinal)?pipeline.requestOrdinal:null,requestOrigin:['first_pass','continuation'].includes(pipeline.requestOrigin)?pipeline.requestOrigin:'unknown',requestCursorFirstPassMatchOrdinal:Number.isSafeInteger(pipeline.requestCursorFirstPassMatchOrdinal)?pipeline.requestCursorFirstPassMatchOrdinal:null,requestCursorSeenFirstPass:pipeline.requestCursorSeenFirstPass===true,requestCursorMatchesLastFirstPass:pipeline.requestCursorMatchesLastFirstPass===true,exactFirstPassPageMatch:pipeline.exactFirstPassPageMatch===true,baselineIdentityOverlapCount,baselineIdentitySetCount:Number.isSafeInteger(pipeline.baselineIdentitySetCount)?pipeline.baselineIdentitySetCount:null,trackedFirstPassIdentityOverlapCount:trackedOverlap,otherOriginFirstPassIdentityOverlapCount:otherOverlap,trackedFirstPassIdentitySetTruncated:firstPassTrackedIdentitySetTruncated,otherOriginFirstPassIdentitySetTruncated:firstPassOtherOriginIdentitySetTruncated,identityProvenanceCounts,allItemsAlreadyKnownBaseline:typeof pipeline.allItemsAlreadyKnownBaseline==='boolean'?pipeline.allItemsAlreadyKnownBaseline:null,newIdentityCount:Number.isSafeInteger(pipeline.newIdentityCount)?pipeline.newIdentityCount:null,baselineMembershipTelemetryMismatch,baselineMembershipReason,elapsedMs:Number.isSafeInteger(pipeline.elapsedMs)?pipeline.elapsedMs:null,requestClass:['conversation_messages','conversation_detail','other'].includes(pipeline.requestClass)?pipeline.requestClass:'unknown',transport:['fetch','XHR'].includes(pipeline.transport)?pipeline.transport:'unknown',status:Number.isSafeInteger(pipeline.status)?pipeline.status:0,requestCursorFingerprint:requestCursorFp,responseCursorFingerprint:responseCursorFp,pageFingerprint:pageFp,itemSetFingerprint:pageFp,itemCount:Number.isSafeInteger(pipeline.itemCount)?pipeline.itemCount:null,hasPreviousPage:typeof pipeline.hasPreviousPage==='boolean'?pipeline.hasPreviousPage:null,pageDirection,payloadRecognized:pipeline.payloadRecognized===true,generationPassed,routePassed,documentPassed,duplicatePage,duplicateCursor,duplicateResponseCursor,duplicateFirstPassPage,duplicateFirstPassCursor,accepted:acceptance?.accepted===true,rejectionReason,dominantReason:acceptance?.dominantReason||null,itemBreakdown,frontier:acceptance?.frontier||null});}catch{}
 };
 const observePagePipeline=(pipeline,page)=>{
  if(!pipeline||typeof pipeline!=='object')return;
  const pageFp=typeof pipeline.responsePageFingerprint==='string'?pipeline.responsePageFingerprint:null;
  const reqFp=typeof pipeline.requestCursorFingerprint==='string'?pipeline.requestCursorFingerprint:null;
  const resFp=typeof pipeline.responseCursorFingerprint==='string'?pipeline.responseCursorFingerprint:null;
  if(!config?.continuation){if(pageFp){knownPageFingerprints.add(pageFp);firstPassPageFingerprints.add(pageFp);}if(reqFp){knownRequestCursorFingerprints.add(reqFp);firstPassRequestCursorFingerprints.add(reqFp);}if(resFp){knownResponseCursorFingerprints.add(resFp);firstPassResponseCursorFingerprints.add(resFp);}const bounds=pipeline.pageActivityBounds;if(pipeline.requestClass==='conversation_messages'&&Number.isFinite(bounds?.minimum)&&Number.isFinite(bounds?.maximum))lastPipelineActivityBounds={minimum:bounds.minimum,maximum:bounds.maximum};return;}
  const acceptance=pipeline.payloadRecognized===true&&page?consume(page):{accepted:false,reason:pipeline.payloadRecognized===true?'page_handoff_missing':pipeline.rejectionReason||'not_history_payload'};
  emitResponsePipeline(pipeline,page,acceptance);
 };
 window.addEventListener('message',e=>{if(e.source!==window||e.origin!==location.origin||e.data?.source!=='gpt-limits-tool-capture-v1')return;
 const p=e.data.summary||null,pipeline=e.data.responsePipeline||null,lineage=p?.sourceLineage||{},firstPassPipeline=!!(((pipeline?.requestOrigin==='first_pass'&&Number.isSafeInteger(pipeline.requestOrdinal))||(lineage.requestOrigin==='first_pass'&&Number.isSafeInteger(lineage.requestOrdinal)))&&!config?.continuation),handledByPipeline=!!(config?.continuation&&pipeline),meta={sourceCategory:sourceCategory(pipeline,p,e.data),requestClass:pipeline?.requestClass||lineage.endpointClass,requestObserved:pipeline?.requestObserved===true||lineage.requestObserved===true,requestOrigin:pipeline?.requestOrigin||lineage.requestOrigin,requestOrdinal:pipeline?.requestOrdinal??lineage.requestOrdinal,requestCursorFingerprint:pipeline?.requestCursorFingerprint||lineage.requestCursorFingerprint,captureSource:pipeline?.captureSource||lineage.captureSource||p?.captureSource,elapsedMs:pipeline?.elapsedMs??lineage.elapsedMs,historyRequestsInFlight:pipeline?.historyRequestsInFlight,responseObserved:pipeline?.responseObserved===true||lineage.responseObserved===true||p?.responseObserved===true,generation:pipeline?.liveResumeGeneration,generationPresent:pipeline?typeof pipeline.liveResumeGeneration==='string':lineage.generationPresent===true,generationMatchesFirstPass:pipeline?pipeline.requestOrigin==='first_pass'&&Number.isSafeInteger(pipeline.requestOrdinal):lineage.generationMatchesFirstPass===true,captureSequence:Number.isSafeInteger(e.data.captureSequence)?e.data.captureSequence:(Number.isSafeInteger(p?.captureSequence)?p.captureSequence:null),replayRequestIdPresent:typeof e.data.replayRequestId==='string'};if(pipeline)observePagePipeline(pipeline,p);
 if(handledByPipeline)return;
 if(!p){emitHistoryResponseParseDiagnostic(pipeline,null);return;}let result=null;if(config)result=consume(p,meta.requestOrigin==='first_pass'&&Number.isSafeInteger(meta.requestOrdinal)?'request_tracked':'untracked_response',meta);else{pending.push({page:p,captureOrigin:meta.requestOrigin==='first_pass'?'first_pass_request':'unattributed_request',requestOrdinal:Number.isSafeInteger(meta.requestOrdinal)?meta.requestOrdinal:null,sourceMeta:meta});if(pending.length>50)pending.shift();}
 emitHistoryResponseParseDiagnostic(pipeline,result);
 if(firstPassPipeline&&Number.isSafeInteger(pipeline.requestOrdinal)){try{window.gptRecordHistoryRequestAcceptance?.(pipeline.requestOrdinal,result?.accepted===true,typeof p.hasPreviousPage==='boolean'?p.hasPreviousPage:null,pipeline.pageTemporalRelation||'unknown');}catch{}}});
 window.addEventListener('message',event=>{
  if(event.source!==window||event.origin!==location.origin||event.data?.source!=='gpt-limits-tool-continuation-source-v1')return;
  const source=event.data.continuationSource,owner=config,route=String(location.pathname||'').match(/(?:^|\/)c\/([^/]+)\/?$/)?.[1],generation=owner?.captureGeneration||owner?.token;
  if(!owner||owner.captureContinuationSource!==true||!source||source.conversationID!==owner.id||source.generation!==generation||route!==owner.id||window.gptLiveResumeCaptureGeneration!==generation)return;
  const estimate=text=>{let total=0;for(const piece of String(text).match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)||[])total+=/^[\p{L}\p{N}_]/u.test(piece)?Math.max(1,Math.ceil(Array.from(piece).length/4)):1;return total;};
  const messages=[],seen=new Set();let tokens=0,earlyMessageCount=0,recentMessageCount=0;const sourceEarlyCount=Math.min(160,Number.isSafeInteger(source.earlyMessageCount)?source.earlyMessageCount:0);let truncated=source.truncated===true||(source.messages||[]).length>160;
  for(const [index,item] of (Array.isArray(source.messages)?source.messages.slice(0,160):[]).entries()){if(!item||!['user','assistant'].includes(item.role)||typeof item.id!=='string'||!item.id||seen.has(item.id)||typeof item.text!=='string')continue;let text=item.text.slice(0,30000),cost=estimate(text);if(text.length<item.text.length)truncated=true;if(tokens+cost>4000){let lo=0,hi=text.length,budget=4000-tokens;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(estimate(text.slice(0,mid))<=budget)lo=mid;else hi=mid-1;}text=text.slice(0,lo);cost=estimate(text);truncated=true;}if(!text||tokens+cost>4000)break;seen.add(item.id);tokens+=cost;messages.push({id:item.id.slice(0,256),role:item.role,text,...(Number.isFinite(item.createdAt)?{createdAt:item.createdAt}:{})});if(index<sourceEarlyCount)earlyMessageCount++;else recentMessageCount++;if(truncated&&tokens>=4000)break;}
  if(!messages.length)return;
  try{window.webkit?.messageHandlers?.chatCheck?.postMessage({event:'continuation_source',conversationID:owner.id,generation,ownerGeneration:owner.token,messages,estimatedTextTokens:tokens,truncated:truncated||messages.length<(source.messages||[]).length,earlyMessageCount,recentMessageCount});}catch{}
 });
 window.gptConfigureCheck=c=>{const continuation=c?.continuation===true,routeUnchanged=typeof c?.id==='string'&&location.pathname.endsWith('/c/'+c.id),frontierPresent=Number.isFinite(c?.expectedFrontier)&&c.expectedFrontier>0,hasPreviousPage=c?.baseline?.hasPreviousPage===true;if(continuation){const aggregateBaselineIdentities=Array.isArray(c?.baseline?.processedMessageIds)?c.baseline.processedMessageIds:[];const capturedBoundary=window.gptCaptureHistoryRequestBoundary?.(aggregateBaselineIdentities)||null;const trackedTimeline=firstPassPageTrace.filter(item=>item.pageOrigin==='request_tracked').map(item=>item.elapsedMs),otherPages=firstPassPageTrace.filter(item=>item.pageOrigin!=='request_tracked').map(item=>{const previous=trackedTimeline.filter(time=>time<=item.elapsedMs).length,next=trackedTimeline.filter(time=>time>item.elapsedMs).length;let position;if(item.trackedRequestsInFlight>0)position='concurrent_or_prefetched';else if(previous===0)position='before_first_tracked_page';else if(next>0)position=`between_tracked_pages_${previous}_and_${previous+1}`;else position=`after_last_tracked_page_${previous}`;return{...item,temporalPosition:position};});const boundary=capturedBoundary?{...capturedBoundary,firstPassAcceptedPageCount,firstPassRequestTrackedPageCount,firstPassPreConfigurationPendingAcceptedPageCount,firstPassOtherAcceptedPageCount,firstPassPreConfigurationPendingPageCount,firstPassPreConfigurationPendingItemCount,firstPassSourcePageCounts:{...firstPassSourcePageCounts},firstPassIdentityProvenance:firstPassProvenanceSnapshot(),firstPassAcceptedPageTrace:firstPassPageTrace.slice(-firstPassTelemetryLimit),firstPassOtherOriginPageTrace:otherPages,firstPassTrackedIdentitySetCount:firstPassTrackedIdentityIds.size,firstPassTrackedIdentitySetTruncated,firstPassOtherOriginIdentitySetCount:firstPassOtherOriginIdentityIds.size,firstPassOtherOriginIdentitySetTruncated,nativeAcceptedPageCountAtHandoff:received}:null;emitContinuationStage(c.token,'first_pass_boundary_captured',{boundary,routeUnchanged,documentSame:true,frontierPresent,hasPreviousPage,bridgeResult:'captured'});window.gptLiveResumeContinuationGeneration=c.token;}else{window.gptLiveResumeContinuationGeneration=null;window.gptLiveResumeFirstPassGeneration=c?.token||null;}if(continuation)emitContinuationStage(c.token,'bridge_command_received',{routeUnchanged,documentSame:true,frontierPresent,hasPreviousPage,bridgeResult:'received'});if(!routeUnchanged){if(continuation)emitContinuationStage(c.token,'bridge_command_rejected',{routeUnchanged:false,documentSame:true,frontierPresent,hasPreviousPage,bridgeResult:'route_mismatch'});return false;}if(continuation&&!frontierPresent){emitContinuationStage(c.token,'bridge_command_rejected',{routeUnchanged:true,documentSame:true,frontierPresent:false,hasPreviousPage,bridgeResult:'frontier_missing'});return false;}config=c;state=c.baseline||null;baseline=new Set(state?.processedMessageIds||[]);if(!continuation){firstPassIdentityProvenance.clear();for(const id of baseline)if(firstPassIdentityProvenance.size<firstPassProvenanceLimit)firstPassIdentityProvenance.set(id,'checkpoint_cache');}observedMessageIds=new Set();paginationFrontierTimestamp=null;continuationOlderIds=new Set();previousPageActivityBounds=null;olderHistoryProgressObserved=false;olderUniqueBaselineMessageCount=0;replayProgressObserved=false;replayPagesProgressed=0;baselineWasComplete=state?.historyComplete===true&&state?.hasPreviousPage===false&&c.requireOverlapForComplete===true;if(baselineWasComplete){state={...state,historyComplete:false,hasPreviousPage:true};}window.gptClearContinuationSource?.(window.gptContinuationSourceConfig?.generation);window.gptContinuationSourceConfig=c.captureContinuationSource===true?{captureContinuationSource:true,conversationID:c.id,generation:typeof c.captureGeneration==='string'?c.captureGeneration:c.token,ownerToken:c.token}:null;window.gptLiveResumeCaptureGeneration=c.token;if(continuation){pending=[];emitContinuationStage(c.token,'bridge_command_accepted',{routeUnchanged:true,documentSame:true,frontierPresent:true,hasPreviousPage, replayProgressEligible:c.replayProgressObserved===true,newHistoryProgressEligible:c.newHistoryProgressObserved===true,bridgeResult:'accepted'});}else{const firstPassPending=pending.splice(0);firstPassPreConfigurationPendingPageCount+=firstPassPending.length;firstPassPreConfigurationPendingItemCount+=firstPassPending.reduce((sum,item)=>sum+(Array.isArray(item?.page?.items)?item.page.items.length:0),0);firstPassPending.forEach(item=>consume(item?.page||item,'pre_configuration_pending',item?.sourceMeta));}return true;};
 const configureCheckWithProvenance=window.gptConfigureCheck;
 window.gptConfigureCheck=c=>{if(c?.continuation!==true){firstPassIdentityProvenance.clear();firstPassProvenanceTruncated=false;for(const id of c?.baseline?.processedMessageIds||[]){if(firstPassIdentityProvenance.size>=firstPassProvenanceLimit){firstPassProvenanceTruncated=true;break;}if(typeof id==='string'&&id.length)firstPassIdentityProvenance.set(id,'checkpoint_cache');}}const configured=configureCheckWithProvenance(c);if(configured&&c?.continuation!==true){try{window.webkit?.messageHandlers?.chatCheck?.postMessage({event:'first_pass_identity_provenance',generation:c.token,provenance:firstPassProvenanceSnapshot()});}catch{}}return configured;};
 window.gptCheckDocumentIdentity=expectedId=>({documentIdentity:liveResumeDocumentIdentity,routeMatches:location.pathname.endsWith('/c/'+expectedId)});
 window.gptClearCheckGeneration=token=>{if(window.gptLiveResumeCaptureGeneration===token||window.gptContinuationSourceConfig?.ownerToken===token){window.gptLiveResumeCaptureGeneration=null;window.gptClearContinuationSource?.(window.gptContinuationSourceConfig?.generation);if(window.gptContinuationSourceConfig?.ownerToken===token)window.gptContinuationSourceConfig=null;config=null;return true;}return false;};
 window.gptScrollHistory=expectedIdentity=>{const continuation=typeof expectedIdentity==='string',documentSame=!continuation||expectedIdentity===liveResumeDocumentIdentity,routeUnchanged=!continuation||!!config&&location.pathname.endsWith('/c/'+config.id);if(continuation)emitContinuationStage(config?.token,'pagination_trigger_attempted',{routeUnchanged,documentSame,frontierPresent:Number.isFinite(config?.expectedFrontier)&&config.expectedFrontier>0,hasPreviousPage:config?.baseline?.hasPreviousPage===true,replayProgressEligible:config?.replayProgressObserved===true,newHistoryProgressEligible:config?.newHistoryProgressObserved===true,bridgeResult:'entered'});if(!documentSame){if(continuation)emitContinuationStage(config?.token,'pagination_trigger_result',{routeUnchanged,documentSame,bridgeResult:'document_changed'});return 'document_changed';}if(!routeUnchanged){if(continuation)emitContinuationStage(config?.token,'pagination_trigger_result',{routeUnchanged,documentSame,bridgeResult:'route_changed'});return 'route_changed';}const c=GptHistoryCollector.findScrollableContainer(document,window);if(!c){if(continuation)emitContinuationStage(config?.token,'pagination_trigger_result',{routeUnchanged,documentSame,bridgeResult:'scroll_container_missing'});return false;}c.scrollTop=0;if(continuation)emitContinuationStage(config?.token,'pagination_trigger_result',{routeUnchanged,documentSame,bridgeResult:'success'});return true;};
 let liveResumeRun=null;
 const liveResumeRoute=()=>{const p=String(location.pathname||'');if(/^\/c\/[^/]+\/?$/.test(p))return '/c/<id>';if(/^\/g\/[^/]+\/c\/[^/]+\/?$/.test(p))return '/g/<id>/c/<id>';return 'unknown';};
 const emitLiveResume=(run,stage,extra={})=>{try{window.webkit?.messageHandlers?.liveResumeDiagnostic?.postMessage({operationGeneration:run.operationGeneration,passGeneration:run.passGeneration,stage,...extra});}catch{}};
 const liveOrder=items=>{let increasing=0,decreasing=0,equal=0,missing=0,previous=null,minimum=Infinity,maximum=-Infinity;for(const item of items){const value=typeof item==='number'?item:item?.time;if(!Number.isFinite(value)||value<=0){missing++;continue;}minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);if(previous!==null){if(value>previous)increasing++;else if(value<previous)decreasing++;else equal++;}previous=value;}return {direction:increasing&&decreasing?'mixed':increasing?'ascending':decreasing?'descending':equal?'equal':'insufficient',increasing,decreasing,equal,missing,minimum:Number.isFinite(minimum)?minimum:null,maximum:Number.isFinite(maximum)?maximum:null};};
 const livePassOrderEvidence=pass=>{const pages=pass.pageObservations,all=pages.flatMap(page=>page.items);let olderTransitions=0,overlapOlderTransitions=0,nonOlderTransitions=0,transitionCount=0;for(let i=1;i<pages.length;i++){const previous=pages[i-1],current=pages[i];if(previous.maximum===null||current.maximum===null||previous.minimum===null||current.minimum===null){nonOlderTransitions++;transitionCount++;continue;}if(current.maximum<previous.minimum){olderTransitions++;transitionCount++;}else if(current.minimum<previous.minimum&&current.maximum<=previous.maximum){overlapOlderTransitions++;transitionCount++;}else{nonOlderTransitions++;transitionCount++;}}
  const reversedPages=pages.slice().reverse(),seen=new Set(),chronological=[];let duplicateOccurrences=0,conflictingDuplicateTimes=0;for(const page of reversedPages)for(const item of page.items){if(seen.has(item.id)){duplicateOccurrences++;const prior=chronological.find(existing=>existing.id===item.id);if(prior&&prior.time!==item.time)conflictingDuplicateTimes++;continue;}seen.add(item.id);chronological.push(item);}
  const chronology=liveOrder(chronological),payloadDirections=pages.map(page=>page.order.direction),payloadOrder=payloadDirections.length&&payloadDirections.every(direction=>direction==='ascending')?'ascending':payloadDirections.length&&payloadDirections.every(direction=>direction==='descending')?'descending':payloadDirections.length&&payloadDirections.every(direction=>direction==='equal')?'equal':payloadDirections.length?'mixed':'insufficient';
  const pageArrival=transitionCount===0?'insufficient':nonOlderTransitions===0&&olderTransitions+overlapOlderTransitions===transitionCount?'newer-to-older':olderTransitions===0&&overlapOlderTransitions===0&&nonOlderTransitions===transitionCount?'not-older-or-repeated':'mixed';
  const chronologicalSequenceProven=payloadOrder==='ascending'&&pageArrival==='newer-to-older'&&chronology.missing===0&&chronology.equal===0&&chronology.decreasing===0&&conflictingDuplicateTimes===0;
  return {payloadOrder,pageArrival,olderTransitions,overlapOlderTransitions,nonOlderTransitions,chronologicalSequence:chronologicalSequenceProven?'proven':'not_proven',chronologicalUniqueCount:chronological.length,chronologicalMissingTimestamps:chronology.missing,chronologicalEqualAdjacentTimes:chronology.equal,chronologicalInversions:chronology.decreasing,duplicateOccurrences,conflictingDuplicateTimes};};
 const liveDOMOrderEvidence=timesById=>{let nodes=[];try{nodes=Array.from(document.querySelectorAll('[data-message-id]')).filter(node=>{const main=node.closest?.('main,[role="main"]');return !!main&&!node.closest?.('nav,aside,form,header,footer,[contenteditable="true"]');}).slice(0,2000);}catch{}const ids=nodes.map(node=>String(node.getAttribute?.('data-message-id')||'')).filter(Boolean);const times=ids.map(id=>timesById.get(id)).filter(value=>Number.isFinite(value)&&value>0);const order=liveOrder(times);return {candidateCount:nodes.length,uniqueIDs:new Set(ids).size,matchedTimestamps:times.length,direction:order.direction,equalAdjacentTimes:order.equal,decreasingTransitions:order.decreasing,missingMatches:ids.length-times.length};};
 const liveResumePass=async(run,passIndex,durationMs)=>{
  const passGeneration=`${run.operationGeneration}:${passIndex}`;
  const pass={operationGeneration:run.operationGeneration,passGeneration,passIndex,startedAt:Date.now(),pages:0,uniqueTimes:new Map(),pageObservations:[],seenIds:new Set(),duplicateOccurrences:0,conflictingDuplicateTimes:0,hasPreviousPage:null,scrollAttempts:0,stalePages:0};
  run.pass=pass;window.gptLiveResumeCaptureGeneration=passGeneration;
  emitLiveResume(pass,'pass_started',{passIndex,routeTemplate:liveResumeRoute(),documentIdentity:liveResumeDocumentIdentity});
  const deadline=Date.now()+durationMs;
  while(Date.now()<deadline&&!run.cancelled&&location.pathname===run.initialPath){
   let container=null;try{container=GptHistoryCollector.findScrollableContainer(document,window);}catch{}
   if(container){container.scrollTop=0;pass.scrollAttempts++;}
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(window.gptLiveResumeCaptureGeneration===passGeneration)window.gptLiveResumeCaptureGeneration=null;
  const times=[...pass.uniqueTimes.values()];return {passGeneration,passIndex,pages:pass.pages,uniqueTimes:pass.uniqueTimes,pageObservations:pass.pageObservations,duplicateOccurrences:pass.duplicateOccurrences,conflictingDuplicateTimes:pass.conflictingDuplicateTimes,frontier:times.length?Math.min(...times):null,hasPreviousPage:pass.hasPreviousPage,scrollAttempts:pass.scrollAttempts,stalePages:pass.stalePages,routeUnchanged:location.pathname===run.initialPath,documentIdentity:liveResumeDocumentIdentity};
 };
 window.addEventListener('message',event=>{
  const summary=event.data?.source==='gpt-limits-tool-capture-v1'?event.data.summary:null;
  const pass=liveResumeRun?.pass;
  if(!summary||!pass||event.source!==window||event.origin!==location.origin)return;
  if(summary.liveResumeGeneration!==pass.passGeneration){if(summary.isPaginationResponse===true)pass.stalePages++;return;}
  if(summary.isPaginationResponse!==true||summary.conversationId!==liveResumeRun.conversationId||!Array.isArray(summary.items))return;
  pass.pages++;pass.hasPreviousPage=typeof summary.hasPreviousPage==='boolean'?summary.hasPreviousPage:null;
  const pageItems=[],pageSeen=new Set();for(const item of summary.items){if(typeof item?.id!=='string'||!item.id)continue;const id=item.id,time=Number(item.activityTime),validTime=Number.isFinite(time)&&time>0?time:null;if(pageSeen.has(id)){pass.duplicateOccurrences++;const prior=pageItems.find(existing=>existing.id===id);if(prior&&prior.time!==validTime)pass.conflictingDuplicateTimes++;}else{pageSeen.add(id);if(pass.seenIds.has(id)){pass.duplicateOccurrences++;const priorTime=pass.uniqueTimes.get(id);if(priorTime!==undefined&&priorTime!==validTime)pass.conflictingDuplicateTimes++;}pass.seenIds.add(id);}pageItems.push({id,time:validTime});if(validTime!==null&&!pass.uniqueTimes.has(id))pass.uniqueTimes.set(id,validTime);}
  const order=liveOrder(pageItems);pass.pageObservations.push({items:pageItems,order,minimum:order.minimum,maximum:order.maximum});
  emitLiveResume(pass,'page_observed',{passIndex:pass.passIndex,pages:pass.pages,uniqueMessageCount:pass.uniqueTimes.size,hasPreviousPage:pass.hasPreviousPage,staleRepliesRejected:pass.stalePages});
 });
 window.gptRunLiveDocumentResumeProof=async options=>{
  const conversationId=options?.conversationId,operationGeneration=options?.operationGeneration,durationMs=Number(options?.passDurationMs);
  if(liveResumeRun)return {status:'busy'};
  const reject=(status,routeTemplate=liveResumeRoute())=>{const run={operationGeneration:typeof operationGeneration==='string'?operationGeneration:'invalid',passGeneration:`${operationGeneration||'invalid'}:0`};emitLiveResume(run,'terminal',{status,routeTemplate});return {status};};
  if(typeof conversationId!=='string'||typeof operationGeneration!=='string'||!Number.isFinite(durationMs)||durationMs<1000||durationMs>60000)return reject('invalid_arguments');
  const pathId=String(location.pathname||'').match(/\/c\/([^/]+)\/?$/)?.[1];
  if(pathId!==conversationId)return reject('route_mismatch');
  const container=GptHistoryCollector.findScrollableContainer(document,window);
  if(!container)return reject('scroll_container_unavailable');
  const initialScrollTop=container.scrollTop,initialPath=location.pathname;
  const run={operationGeneration,conversationId,initialPath,initialScrollTop,cancelled:false,pass:null};liveResumeRun=run;
  try{
   const first=await liveResumePass(run,1,durationMs);
   if(run.cancelled){const cancelled={status:'cancelled',passIndex:1,sameDocument:true,routeUnchanged:first.routeUnchanged,reloadBetweenPasses:false};emitLiveResume({operationGeneration,passGeneration:first.passGeneration},'terminal',cancelled);return cancelled;}
   const frontier=first.frontier;
   emitLiveResume({operationGeneration,passGeneration:`${operationGeneration}:1`},'pass_boundary',{passIndex:1,pages:first.pages,uniqueMessageCount:first.uniqueTimes.size,frontierAvailable:frontier!==null,routeUnchanged:first.routeUnchanged,documentIdentity:first.documentIdentity});
   if(!first.routeUnchanged){const changed={status:'route_changed',passIndex:1,sameDocument:false,routeUnchanged:false,reloadBetweenPasses:false};emitLiveResume({operationGeneration,passGeneration:first.passGeneration},'terminal',changed);return changed;}
   const second=await liveResumePass(run,2,durationMs);
   const newOlderIds=new Set();for(const [id,time] of second.uniqueTimes)if(!first.uniqueTimes.has(id)&&frontier!==null&&time<frontier)newOlderIds.add(id);
   const orderEvidence=livePassOrderEvidence(second),combinedTimes=new Map(first.uniqueTimes);for(const [id,time] of second.uniqueTimes)if(!combinedTimes.has(id))combinedTimes.set(id,time);const domOrder=liveDOMOrderEvidence(combinedTimes);const orderPreserved=orderEvidence.chronologicalSequence==='proven'&&(domOrder.candidateCount<2||(domOrder.matchedTimestamps>=2&&domOrder.direction==='ascending'&&domOrder.equalAdjacentTimes===0&&domOrder.decreasingTransitions===0));
   const sameDocument=first.documentIdentity===second.documentIdentity;
   const pass1Order=livePassOrderEvidence(first);const result={status:run.cancelled?'cancelled':(!second.routeUnchanged?'route_changed':(sameDocument&&frontier!==null&&newOlderIds.size>0&&second.hasPreviousPage===true&&orderPreserved?'older_frontier_advanced':'frontier_not_proven')),pass1:{pages:first.pages,uniqueMessages:first.uniqueTimes.size,frontier,ordering:pass1Order,duplicateOccurrences:first.duplicateOccurrences,conflictingDuplicateTimes:first.conflictingDuplicateTimes},pass2:{pages:second.pages,uniqueMessages:second.uniqueTimes.size,newUniqueMessages:new Set([...second.uniqueTimes.keys()].filter(id=>!first.uniqueTimes.has(id))).size,newOlderMessages:newOlderIds.size,orderPreserved,ordering:orderEvidence,duplicateOccurrences:second.duplicateOccurrences,conflictingDuplicateTimes:second.conflictingDuplicateTimes},domOrder,sameDocument,routeUnchanged:first.routeUnchanged&&second.routeUnchanged,reloadBetweenPasses:false,staleRepliesRejected:second.stalePages};
   emitLiveResume({operationGeneration,passGeneration:second.passGeneration},'terminal',result);return result;
  }catch{
   const failed={status:run.cancelled?'cancelled':'diagnostic_error',sameDocument:false,routeUnchanged:location.pathname===initialPath,reloadBetweenPasses:false};emitLiveResume({operationGeneration,passGeneration:run.pass?.passGeneration||`${operationGeneration}:0`},'terminal',failed);return failed;
  }finally{
   if(window.gptLiveResumeCaptureGeneration?.startsWith(`${operationGeneration}:`))window.gptLiveResumeCaptureGeneration=null;
   try{const current=GptHistoryCollector.findScrollableContainer(document,window);if(current&&location.pathname===initialPath)current.scrollTop=initialScrollTop;}catch{}
   liveResumeRun=null;
  }
 };
 window.gptCancelLiveDocumentResumeProof=operationGeneration=>{if(liveResumeRun?.operationGeneration!==operationGeneration)return false;liveResumeRun.cancelled=true;return true;};
 window.gptScrollSidebar=()=>{
 const links=[...document.querySelectorAll('a[href*="/c/"]')].filter(a=>!a.closest('main'));
 for(const a of links){for(let p=a.parentElement;p&&p!==document.body;p=p.parentElement){const style=getComputedStyle(p);if(/auto|scroll/.test(style.overflowY)&&p.scrollHeight>p.clientHeight+10&&p.clientHeight>50){const bottom=p.scrollHeight-p.clientHeight;if(p.scrollTop>=bottom-2)return false;p.scrollTop=bottom;return true;}}}
 return false;
 };
 const isVisible=el=>!!el&&!el.hidden&&el.getAttribute?.('aria-hidden')!=='true'&&
  (typeof el.getClientRects!=='function'||el.getClientRects().length>0);
 const rectOf=el=>{const r=el?.getBoundingClientRect?.();return r?{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}:null;};
 const safeLabel=el=>{
  const aria=el?.getAttribute?.('aria-label')||el?.getAttribute?.('title');if(aria)return String(aria).trim().slice(0,80);
  return '';
 };
 const roleOf=el=>el?.getAttribute?.('role')||String(el?.tagName||'').toLowerCase()||'unknown';
 const buttonLike=el=>{const role=el?.getAttribute?.('role'),tag=String(el?.tagName||'').toLowerCase();return role==='button'||(!role&&tag==='button');};
 const sidebarRoots=()=>[...document.querySelectorAll('nav,aside,[role="navigation"],[data-testid*="sidebar"]')];
 const sidebarContextRoot=anchor=>{let node=anchor,depth=0;while(node&&depth++<32){const tag=String(node.tagName||'').toLowerCase(),role=node.getAttribute?.('role')||'',testId=String(node.getAttribute?.('data-testid')||'').toLowerCase();if(tag==='nav'||tag==='aside'||role==='navigation'||testId.includes('sidebar'))return node;node=node.parentElement;}return null;};
 const octaneNavigationRoute=anchor=>{
  try{
   const href=anchor?.getAttribute?.('href');if(String(anchor?.tagName||'').toLowerCase()!=='a'||anchor.getAttribute?.('data-octane-navigation-item')===null||typeof href!=='string'||!href.trim()||!sidebarContextRoot(anchor))return null;
   const url=new URL(href,location.href);if(url.origin!==location.origin)return null;
   const parts=url.pathname.split('/').filter(Boolean),reserved=new Set(['settings','auth','login','logout','share','s','chat','conversation','workspace','explore','search','library','account','help','new','new-chat','recent','recents','archived','history','projects','project','features','about','actions','home','g','gpts','create','apps','tasks','agents','admin','enterprise','billing','subscription','subscriptions','upgrade','pricing','policy','privacy','terms','status','contact','voice','connectors','organization','organizations','org','team','teams','files','images','canvas','sora','media','start','setup','download','invites','feedback','support']);
   if((parts.length!==1&&parts.length!==2)||parts.some(part=>! /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(part)||reserved.has(part.toLowerCase())))return null;
   return {kind:'conversation',routeType:parts.length===1?'octane_conversation':'octane_project_conversation',identity:parts[parts.length-1],path:url.pathname};
  }catch{return null;}
 };
 const visibleLinkCount=root=>[...(root?.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation'&&isVisible(anchor)).length;
 const renderedInWebViewport=el=>{
  if(!el||!isVisible(el))return false;let node=el,depth=0;
  while(node&&depth++<16){let style={};try{style=getComputedStyle(node);}catch{}
   if(node.hidden||node.getAttribute?.('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;
   node=node.parentElement;
  }
  const r=el.getBoundingClientRect?.(),width=Number(window.innerWidth)||Number(document.documentElement?.clientWidth)||1024,height=Number(window.innerHeight)||Number(document.documentElement?.clientHeight)||768;
  const left=Number(r?.left??r?.x)||0,top=Number(r?.top??r?.y)||0,right=Number(r?.right??(left+(Number(r?.width)||0))),bottom=Number(r?.bottom??(top+(Number(r?.height)||0)));
  return !!r&&r.width>0&&r.height>0&&right>0&&left<width&&bottom>0&&top<height;
 };
 const actuallyRendered=el=>{
  if(!el||!isVisible(el))return false;let node=el,depth=0;
  while(node&&depth++<16){let style={};try{style=getComputedStyle(node);}catch{}
   if(node.hidden||node.getAttribute?.('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden'||Number(style.opacity)===0)return false;
   node=node.parentElement;
  }
  const r=el.getBoundingClientRect?.();return !!r&&r.width>0&&r.height>0;
 };
 const sidebarSnapshot=()=>{
  const roots=sidebarRoots(),visible=roots.filter(isVisible);
  const chosen=visible.sort((a,b)=>{const ar=rectOf(a),br=rectOf(b);return (br?.width||0)*(br?.height||0)-(ar?.width||0)*(ar?.height||0);})[0]||null;
  return {found:roots.length>0,visible:!!chosen,rect:rectOf(chosen),root:chosen,rootCount:roots.length,visibleConversationLinkCount:visibleLinkCount(chosen)};
 };
 const activeSidebarSnapshot=()=>{
  const roots=sidebarRoots(),viewportActive=roots.map((root,index)=>{
   const rect=root.getBoundingClientRect?.(),links=[...(root.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation'&&actuallyRendered(anchor));
   const rendered=renderedInWebViewport(root),visibleRows=links.filter(anchor=>renderedInWebViewport(anchor)&&viewportVisibleInSidebar(anchor,root,null)).length;
   return {root,index,rect,area:Math.max(0,Number(rect?.width)||0)*Math.max(0,Number(rect?.height)||0),rendered,linkCount:links.length,visibleRows};
  }).filter(candidate=>candidate.rendered&&candidate.linkCount>0);
  viewportActive.sort((a,b)=>b.visibleRows-a.visibleRows||b.linkCount-a.linkCount||a.area-b.area||b.index-a.index);
  const fallback=roots.map((root,index)=>{const rect=root.getBoundingClientRect?.(),area=Math.max(0,Number(rect?.width)||0)*Math.max(0,Number(rect?.height)||0);return {root,index,rect,area,rendered:renderedInWebViewport(root),linkCount:0,visibleRows:0};}).filter(candidate=>candidate.rendered).sort((a,b)=>b.area-a.area||a.index-b.index);
  const candidatesForSelection=viewportActive.length?viewportActive:fallback;
  candidatesForSelection.sort((a,b)=>b.visibleRows-a.visibleRows||b.linkCount-a.linkCount||a.area-b.area||b.index-a.index);
  const chosen=candidatesForSelection[0]||null,activeRoot=chosen?.root||null;
  const routeOccurrences=new Map();
  for(const candidate of viewportActive)for(const anchor of [...(candidate.root.querySelectorAll?.('a[href]')||[])].filter(item=>routeKind(item)==='conversation'&&actuallyRendered(item))){
   const key=`${routeType(anchor)||'unknown'}:${conversationIdFromAnchor(anchor)||'missing'}`;let instances=routeOccurrences.get(key);if(!instances){instances=new Set();routeOccurrences.set(key,instances);}instances.add(anchor);
  }
  const duplicateConversationRows=[...routeOccurrences.values()].reduce((sum,instances)=>sum+Math.max(0,instances.size-1),0);
  return {found:roots.length>0,visible:!!chosen,rect:rectOf(activeRoot),root:activeRoot,rootCount:roots.length,
   visibleConversationLinkCount:chosen?.visibleRows||0,activeCandidateOrdinal:chosen?chosen.index+1:null,
   renderedIntersectingCandidateCount:viewportActive.length,activeCandidateLinkCount:chosen?.linkCount||0,
   inactiveCandidateCount:Math.max(0,roots.length-candidatesForSelection.length),duplicateConversationRows};
 };
 const conversationRouteLinks=root=>[...(root?.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation');
 const conversationListRegionCandidates=root=>{
  if(!root)return[];
  const explicit=[...root.querySelectorAll?.('[role="list"],[role="tree"],[role="group"],[data-testid*="conversation"],[data-testid*="thread"],[data-testid*="history"]')||[]].filter(isVisible);
  if(explicit.length)return [...new Set(explicit)];
  // Some ChatGPT sidebar builds expose no list role. In that layout the visible
  // sidebar itself is a list region once it contains a recognized conversation route.
  return conversationRouteLinks(root).length?[root]:[];
 };
 const safePathTemplate=()=>{
  const path=String(location.pathname||'/');
  if(/^\/c\/[^/]+(?:\/|$)/.test(path))return '/c/<id>';
  if(/^\/g\/[^/]+(?:\/|$)/.test(path)&&!/^\/g\/[^/]+\/c\/[^/]+(?:\/|$)/.test(path))return '/g/<id>';
  if(/^\/g\/[^/]+\/c\/[^/]+(?:\/|$)/.test(path))return '/g/<id>/c/<id>';
  const parts=path.split('/').filter(Boolean);
  return parts.length?`/other/${parts.length}`:'/';
 };
 const supportedConversationContext=()=>{
  const path=String(location.pathname||'/');
  if(path==='/'||/^\/c\/[^/]+(?:\/|$)/.test(path)||/^\/g\/[^/]+(?:\/|$)/.test(path))return true;
  return sidebarRoots().some(root=>[...(root.querySelectorAll?.('a[href]')||[])].some(anchor=>routeKind(anchor)==='conversation'&&new URL(anchor.getAttribute('href')||'',location.href).pathname===path));
 };
 const readinessPreflightSnapshot=options=>{
  let docReady='unavailable',bodyPresent=false,sidebar=null;
  try{docReady=String(document.readyState||'unavailable');bodyPresent=!!document.body;sidebar=activeSidebarSnapshot();}catch{}
  const links=conversationRouteLinks(document),regions=conversationListRegionCandidates(sidebar?.root);
  return {documentReadyState:docReady,pathTemplate:safePathTemplate(),bodyPresent,sidebarAvailable:!!sidebar?.visible,
   sidebarContainerCandidates:sidebar?.rootCount||0,listRegionAvailable:regions.length>0,listRegionCandidates:regions.length,
   activeSidebarCandidateOrdinal:sidebar?.activeCandidateOrdinal??null,renderedIntersectingSidebarCandidates:sidebar?.renderedIntersectingCandidateCount||0,
   inactiveSidebarCandidates:sidebar?.inactiveCandidateCount||0,activeSidebarConversationLinks:sidebar?.activeCandidateLinkCount||0,
   activeSidebarVisibleConversationLinks:sidebar?.visibleConversationLinkCount||0,duplicateConversationRows:sidebar?.duplicateConversationRows||0,
   totalConversationRouteLinks:links.length,sidebarConversationRouteLinks:conversationRouteLinks(sidebar?.root).length,
   webViewVisible:typeof options?.webViewVisible==='boolean'?options.webViewVisible:null,
   navigationActive:typeof options?.navigationActive==='boolean'?options.navigationActive:null};
 };
 const renderStateSnapshot=()=>{
  const state=readinessPreflightSnapshot({});
  return {documentReadyState:state.documentReadyState,pathTemplate:state.pathTemplate,sidebarCandidates:state.sidebarContainerCandidates,
   conversationListCandidates:state.listRegionCandidates,conversationLinks:state.totalConversationRouteLinks};
 };
 window.gptRenderStateSnapshot=renderStateSnapshot;
 window.gptSessionRenderSnapshot=()=>{
  const rectSummary=rect=>({x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height),
   right:Math.round(rect.right),bottom:Math.round(rect.bottom)});
  const styleSummary=element=>{
   const style=getComputedStyle(element);
   return {display:String(style.display||'unknown'),visibility:String(style.visibility||'unknown'),
    opacity:Number.isFinite(Number(style.opacity))?Number(style.opacity):null};
  };
  const viewport={width:Number(window.innerWidth)||0,height:Number(window.innerHeight)||0};
  const html=document.documentElement,body=document.body;
  const selectorCounts={
   dataMessageAuthorRole:document.querySelectorAll('[data-message-author-role]').length,
   dataConversationRole:document.querySelectorAll('[data-conversation-role]').length,
   dataUserMessageBubble:document.querySelectorAll('[data-user-message-bubble]').length,
   dataChatgptAgentTurnStart:document.querySelectorAll('[data-chatgpt-agent-turn-start]').length,
   article:document.querySelectorAll('article,[role="article"]').length,
   conversationTurn:document.querySelectorAll('[data-testid^="conversation-turn-"]').length,
   dataTurn:document.querySelectorAll('[data-turn]').length
  };
  const selectors=['[data-message-author-role]','[data-conversation-role]','[data-user-message-bubble]','[data-chatgpt-agent-turn-start]','article','[role="article"]','[data-testid^="conversation-turn-"]','[data-turn]','[data-author]','[data-role]'];
  const mains=Array.from(document.querySelectorAll('main'));
  const excluded='nav,aside,form,header,footer,[contenteditable="true"],[data-testid*="sidebar"],[data-testid*="composer"],[data-testid*="navigation"]';
  const nodeSet=new Set(selectors.flatMap(item=>Array.from(document.querySelectorAll(item))));
  const nodes=Array.from(nodeSet).filter(node=>
   (!mains.length||mains.some(main=>main===node||main.contains?.(node)))&&!(typeof node.closest==='function'&&node.closest(excluded)));
  const summarizeNode=node=>{
   const rect=node.getBoundingClientRect(),style=styleSummary(node);
   const inViewport=rect.width>0&&rect.height>0&&rect.right>0&&rect.bottom>0&&rect.left<viewport.width&&rect.top<viewport.height;
   const visible=inViewport&&style.display!=='none'&&style.visibility!=='hidden'&&style.opacity>0;
   const hit=inViewport&&typeof document.elementFromPoint==='function'
    ? document.elementFromPoint(Math.max(0,Math.min(viewport.width-1,rect.left+rect.width/2)),Math.max(0,Math.min(viewport.height-1,rect.top+rect.height/2)))
    : null;
   const attributeNames=Array.from(node.attributes||[]).map(attribute=>String(attribute.name||'').toLowerCase())
    .filter(name=>(name.startsWith('data-')||name==='role'||name==='aria-label')&&!/(?:^|[-_])(?:id|url|token|title|text)(?:$|[-_])/i.test(name)).sort();
   return {tag:String(node.tagName||'unknown').toLowerCase(),classTokenCount:String(node.getAttribute?.('class')||'').trim().split(/\s+/).filter(Boolean).length,
    attributeNames,rect:rectSummary(rect),...style,visible,centerHitWithinMessage:!!hit&&(hit===node||node.contains(hit)),centerHitTag:hit?.tagName||null};
  };
  const samples=nodes.slice(0,3).map(summarizeNode);
  const renderTargetNodes=[];
  for(const marker of nodes){
   let current=marker,depth=0;
   while(current&&depth<=6){
    const rect=current.getBoundingClientRect?.();
    if(rect&&rect.width>=80&&rect.height>=20){renderTargetNodes.push(current);break;}
    current=current.parentElement;depth++;
   }
  }
  const uniqueRenderTargets=Array.from(new Set(renderTargetNodes));
  const renderTargetSamples=uniqueRenderTargets.slice(0,5).map(summarizeNode);
  const visibleRenderTargetCount=uniqueRenderTargets.filter(node=>{
   const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
   return rect.width>=80&&rect.height>=20&&rect.right>0&&rect.bottom>0&&rect.left<viewport.width&&rect.top<viewport.height&&
    style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0;
  }).length;
  let centerHit=null;
  if(typeof document.elementFromPoint==='function'){
   const hit=document.elementFromPoint(Math.floor(viewport.width/2),Math.floor(viewport.height/2));
   if(hit){const rect=hit.getBoundingClientRect(),style=styleSummary(hit);centerHit={tag:hit.tagName||null,rect:rectSummary(rect),...style};}
  }
  const htmlRect=html?.getBoundingClientRect?.()||{x:0,y:0,width:0,height:0,right:0,bottom:0};
  const bodyRect=body?.getBoundingClientRect?.()||{x:0,y:0,width:0,height:0,right:0,bottom:0};
  return {documentReadyState:String(document.readyState||'unavailable'),viewport,selectorCounts,
   fallbackCandidateCount:nodes.length,
   html:{rect:rectSummary(htmlRect),clientWidth:Number(html?.clientWidth)||0,clientHeight:Number(html?.clientHeight)||0,scrollWidth:Number(html?.scrollWidth)||0,scrollHeight:Number(html?.scrollHeight)||0,...(html?styleSummary(html):{})},
   body:{present:!!body,rect:rectSummary(bodyRect),clientWidth:Number(body?.clientWidth)||0,clientHeight:Number(body?.clientHeight)||0,scrollWidth:Number(body?.scrollWidth)||0,scrollHeight:Number(body?.scrollHeight)||0,...(body?styleSummary(body):{})},
   messageElementCount:nodes.length,nonzeroMessageRects:nodes.filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;}).length,
   visibleMessageSamples:samples.filter(sample=>sample.visible).length,messageSamples:samples,
   renderTargetCount:uniqueRenderTargets.length,visibleRenderTargetCount,renderTargetSamples,viewportCenterHit:centerHit};
 };
 // Geometry only: never serialize a node's text, attribute values or application state.
 window.gptConversationLayoutSnapshot=()=>{
  const viewport={width:Number(window.innerWidth)||0,height:Number(window.innerHeight)||0};
  const rectOf=node=>{const r=node.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),right:Math.round(r.right),bottom:Math.round(r.bottom)};};
  const intersects=r=>r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.x<viewport.width&&r.y<viewport.height;
  const cssOf=node=>{const s=getComputedStyle(node),value=name=>String(s.getPropertyValue?.(name)||s[name]||'');
   const numericCSS=v=>v.length<180&&(v===''||/^(?:matrix|matrix3d)\([-+0-9.e,\s]+\)$/.test(v)||v.split(/\s+/).every(token=>/^(?:none|normal|auto|strict|content|size|layout|style|paint|inline-size|visible|hidden|-?\d+(?:\.\d+)?(?:px|%)?)$/.test(token)))?v:'other';
   const clip=value('clip-path');
   return {display:String(s.display||''),visibility:String(s.visibility||''),opacity:Number(s.opacity),overflowY:String(s.overflowY||''),overflowX:String(s.overflowX||''),position:String(s.position||''),
    transform:numericCSS(String(s.transform||'none')),translate:numericCSS(value('translate')||'none'),contain:numericCSS(value('contain')),
    contentVisibility:numericCSS(value('content-visibility')),containIntrinsicSize:numericCSS(value('contain-intrinsic-size')),
    clipPath:clip==='none'||!clip?'none':/^(inset|circle|ellipse|polygon)\(/.test(clip)?clip.split('(')[0]:'other'};};
  const describe=node=>({tag:String(node.tagName||'').toLowerCase(),rect:rectOf(node),scrollTop:Math.round(Number(node.scrollTop)||0),scrollHeight:Number(node.scrollHeight)||0,clientHeight:Number(node.clientHeight)||0,...cssOf(node)});
  const excluded='nav,aside,form,header,footer,[contenteditable="true"],[data-testid*="sidebar"],[data-testid*="composer"]';
  const markers=Array.from(document.querySelectorAll('[data-message-author-role],[data-conversation-role],[data-user-message-bubble],[data-chatgpt-agent-turn-start],article,[data-testid^="conversation-turn-"]'))
   .filter(node=>!node.closest?.(excluded)).slice(0,160);
  const targets=[];
  for(const marker of markers){let node=marker;for(let depth=0;node&&depth<=6;depth++,node=node.parentElement){const r=node.getBoundingClientRect();if(r.width>=80&&r.height>=20){targets.push(node);break;}}}
  const unique=Array.from(new Set(targets)),seenText=new Set(),allRects=[];
  const textLayout=node=>{const rects=[],parents=[],walker=document.createTreeWalker(node,4);let current,budget=256;
   while(budget-->0&&(current=walker.nextNode())){if(current.parentElement?.closest?.('script,style,textarea,[contenteditable="true"]'))continue;
    const range=document.createRange();range.selectNodeContents(current);
    const boxes=Array.from(range.getClientRects()).filter(r=>r.width>0&&r.height>0);
    if(boxes.length){if(parents.length<1&&current.parentElement)parents.push(describe(current.parentElement));
     for(const r of boxes){const safe={x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),right:Math.round(r.right),bottom:Math.round(r.bottom)};rects.push(safe);if(!seenText.has(current))allRects.push(safe);}
     seenText.add(current);}
    range.detach?.();
   }
   return {textRectCount:rects.length,viewportTextRectCount:rects.filter(intersects).length,textRects:rects.filter(intersects).concat(rects.filter(r=>!intersects(r))).slice(0,5),firstTextParent:parents[0]||null,scanCapped:budget<0};
  };
  const candidates=unique.map((node,index)=>({index,...describe(node),...textLayout(node)}));
  const ranked=candidates.slice().sort((a,b)=>b.viewportTextRectCount-a.viewportTextRectCount||Math.abs(a.rect.y-viewport.height/2)-Math.abs(b.rect.y-viewport.height/2));
  const primary=ranked[0],primaryNode=primary?unique[primary.index]:null,hierarchy=[];let scrollNode=null;
  for(let node=primaryNode,depth=0;node&&depth<32;node=node.parentElement,depth++){
   const item=describe(node);item.depth=depth;item.scrollableY=item.scrollHeight>item.clientHeight+1&&(/auto|scroll|overlay/.test(item.overflowY)||item.scrollTop>0);
   hierarchy.push(item);if(!scrollNode&&item.scrollableY)scrollNode=node;if(String(node.tagName).toLowerCase()==='main')break;
  }
  const spacers=[];let siblingBudget=40;
  for(let node=primaryNode,depth=0;node?.parentElement&&depth<6;node=node.parentElement,depth++){
   for(const sibling of Array.from(node.parentElement.children||[])){if(sibling===node||siblingBudget--<=0)continue;const item=describe(sibling);if(item.rect.height<40)continue;
    const walker=document.createTreeWalker(sibling,4);let count=0,current,budget=32;
    while(budget-->0&&(current=walker.nextNode())){const range=document.createRange();range.selectNodeContents(current);if(Array.from(range.getClientRects()).some(r=>r.width>0&&r.height>0))count++;range.detach?.();}
    if(count===0||item.contentVisibility==='hidden'||item.containIntrinsicSize&&!/^(none|auto|0px|auto 0px)$/.test(item.containIntrinsicSize))spacers.push({ancestorDepth:depth,...item,textLayoutNodes:count});
   }
  }
  const center=document.elementFromPoint?.(Math.floor(viewport.width/2),Math.floor(viewport.height/2));
  const scroll=scrollNode?describe(scrollNode):null;
  return {documentReadyState:String(document.readyState),viewport,markerCount:markers.length,candidateCount:unique.length,actualTextLayoutCandidates:candidates.filter(c=>c.textRectCount>0).length,
   uniqueTextLayoutNodes:seenText.size,textRectCount:allRects.length,viewportTextRectCount:allRects.filter(intersects).length,
   candidates:ranked.slice(0,5),primaryHierarchy:hierarchy,scrollContainer:scroll,spacerLikeSiblings:spacers.slice(0,12),
   scrollAnchor:primary?{candidateOrdinal:primary.index,rect:primary.rect,firstViewportTextRect:primary.textRects.find(intersects)||null,offsetFromScrollTop:scroll?primary.rect.y-scroll.rect.y:null}:null,
   centerHit:center?describe(center):null};
 };
 window.gptWatchConversationPaint=({timeoutMs=20000}={})=>new Promise(resolve=>{
  const startedAt=Date.now(),deadline=startedAt+Math.max(1000,Math.min(30000,Number(timeoutMs)||20000));
  let done=false,sampling=false,observer=null,timer=null;
  const finish=(result)=>{if(done)return;done=true;try{observer?.disconnect();}catch{}if(timer!==null)clearTimeout(timer);resolve(result);};
  const sample=()=>{
   const snapshot=window.gptSessionRenderSnapshot(),elapsedMs=Math.max(0,Date.now()-startedAt);
   if(snapshot.visibleRenderTargetCount<1)return null;
   const afterFrame=()=>new Promise(frameResolve=>{
    let settled=false,frameTimer=setTimeout(()=>{if(!settled){settled=true;frameResolve(window.gptSessionRenderSnapshot());}},500);
    try{requestAnimationFrame(()=>requestAnimationFrame(()=>{if(!settled){settled=true;clearTimeout(frameTimer);frameResolve(window.gptSessionRenderSnapshot());}}));}
    catch{if(!settled){settled=true;clearTimeout(frameTimer);frameResolve(window.gptSessionRenderSnapshot());}}
   });
   return afterFrame().then(first=>afterFrame().then(second=>({status:second.visibleRenderTargetCount>0?'render_target_observed':'render_target_lost',elapsedMs,
    firstCandidateCount:snapshot.fallbackCandidateCount,firstCandidateRects:snapshot.messageSamples,
    firstRenderTargetCount:snapshot.renderTargetCount,firstVisibleRenderTargetCount:snapshot.visibleRenderTargetCount,firstRenderTargetSamples:snapshot.renderTargetSamples,
    afterFirstFrame:{candidateCount:first.fallbackCandidateCount,samples:first.messageSamples},
    afterFirstFrameVisibleRenderTargets:first.visibleRenderTargetCount,
    afterSecondFrame:{candidateCount:second.fallbackCandidateCount,samples:second.messageSamples},
    afterSecondFrameVisibleRenderTargets:second.visibleRenderTargetCount,renderTargetSamples:second.renderTargetSamples,
    selectorCounts:second.selectorCounts,viewport:second.viewport,documentReadyState:second.documentReadyState,
    body:{clientWidth:second.body?.clientWidth||0,clientHeight:second.body?.clientHeight||0,scrollHeight:second.body?.scrollHeight||0},
    html:{clientWidth:second.html?.clientWidth||0,clientHeight:second.html?.clientHeight||0,scrollHeight:second.html?.scrollHeight||0},
    viewportCenterHit:second.viewportCenterHit})));
  };
  const check=()=>{if(done||sampling)return;const observed=sample();if(observed){sampling=true;observed.then(result=>finish(result));}};
  const root=document.documentElement||document;
  try{observer=new MutationObserver(check);observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['data-message-author-role','data-conversation-role','data-user-message-bubble','data-chatgpt-agent-turn-start','data-testid','data-turn','hidden','aria-hidden','style','class']});}catch{}
  timer=setTimeout(()=>{const snapshot=window.gptSessionRenderSnapshot();finish({status:'render_target_timeout',elapsedMs:Math.max(0,Date.now()-startedAt),selectorCounts:snapshot.selectorCounts,
   renderTargetCount:snapshot.renderTargetCount,visibleRenderTargetCount:snapshot.visibleRenderTargetCount});},Math.max(0,deadline-Date.now()));
  check();
 });
 window.gptInspectRenderDOM=async(options={})=>{
  const before=options.before||renderStateSnapshot(),started=Date.now(),timeoutMs=Math.max(1,Math.min(5000,Number(options.timeoutMs)||5000));
  let firstListRegionChangeMs=null,firstConversationLinkChangeMs=null,timer=null,poll=null,observer=null,finished=false,last=before;
  const finish=()=>{
   if(finished)return;finished=true;if(timer!==null)clearTimeout(timer);if(poll!==null)clearInterval(poll);try{observer?.disconnect();}catch{}
   last=renderStateSnapshot();
   return {before:{sidebarCandidates:before.sidebarCandidates,conversationListCandidates:before.conversationListCandidates,conversationLinks:before.conversationLinks},
    after:last,firstListRegionChangeMs,firstConversationLinkChangeMs,elapsedMs:Math.max(0,Date.now()-started),renderSurfaceActive:options.renderSurfaceActive===true,
    nativeWindowVisible:options.nativeWindowVisible===true,nativeWebViewHidden:options.nativeWebViewHidden===true,
    nativeKeyWindow:options.nativeKeyWindow===true,nativeMainWindow:options.nativeMainWindow===true,focusPreserved:options.focusPreserved===true};
  };
  return await new Promise(resolve=>{
   const sample=()=>{
    if(finished)return;last=renderStateSnapshot();const elapsed=Math.max(0,Date.now()-started);
    if(firstListRegionChangeMs===null&&last.conversationListCandidates!==before.conversationListCandidates)firstListRegionChangeMs=elapsed;
    if(firstConversationLinkChangeMs===null&&last.conversationLinks!==before.conversationLinks)firstConversationLinkChangeMs=elapsed;
    if(last.conversationListCandidates>0&&last.conversationLinks>0){const result=finish();if(result)resolve(result);}
   };
   try{observer=new MutationObserver(sample);observer.observe(document.documentElement||document,{childList:true,subtree:true,attributes:true});}catch{}
   poll=setInterval(sample,100);timer=setTimeout(()=>{const result=finish();if(result)resolve(result);},timeoutMs);sample();
  });
 };
 const waitForPinnedReadinessPreflight=async(options={})=>{
  const started=Date.now(),budgetMs=Math.max(1,Math.min(18000,Number(options.preflightTimeoutMs)||18000)),deadline=started+budgetMs;
  const telemetry={started:true,durationMs:0,documentReadyState:'unavailable',pathTemplate:safePathTemplate(),bodyPresent:false,
   sidebarAvailable:false,sidebarContainerCandidates:0,listRegionAvailable:false,listRegionCandidates:0,totalConversationRouteLinks:0,
   sidebarConversationRouteLinks:0,webViewVisible:typeof options.webViewVisible==='boolean'?options.webViewVisible:null,
   navigationActive:typeof options.navigationActive==='boolean'?options.navigationActive:null,
   timeSinceRenderActivationMs:options.renderActivationElapsedMs!=null&&Number.isFinite(Number(options.renderActivationElapsedMs))?Math.max(0,Number(options.renderActivationElapsedMs)):null,
   renderLeaseTimeToFirstConversationLinkMs:options.renderLeaseTimeToFirstConversationLinkMs!=null&&Number.isFinite(Number(options.renderLeaseTimeToFirstConversationLinkMs))?Math.max(0,Number(options.renderLeaseTimeToFirstConversationLinkMs)):null,
   listRegionCandidatesAtRowsWaitStart:null,
   stage:'context',reason:'none'};
  const update=()=>Object.assign(telemetry,readinessPreflightSnapshot(options));
  const waitUntil=async(stage,condition,stageMs)=>{
   telemetry.stage=stage;const stageDeadline=Math.min(deadline,Date.now()+stageMs);
   while(Date.now()<stageDeadline){update();if(condition())return true;await new Promise(resolve=>setTimeout(resolve,80));}
   update();return condition();
  };
  if(!supportedConversationContext()){telemetry.stage='context';telemetry.reason='wrong_route_or_context';}
  else if(!await waitUntil('document',()=>telemetry.documentReadyState==='complete',3000))telemetry.reason='document_not_ready';
  else if(!await waitUntil('sidebar',()=>telemetry.sidebarContainerCandidates>0,3000))telemetry.reason='sidebar_root_missing';
  else {telemetry.stage='rows';telemetry.reason=null;telemetry.listRegionCandidatesAtRowsWaitStart=telemetry.listRegionCandidates;}
  telemetry.durationMs=Math.max(0,Date.now()-started);telemetry.final=readinessPreflightSnapshot(options);
  Object.assign(telemetry,telemetry.final);
  if(telemetry.reason===null){
   const rowBudget=Math.max(0,deadline-Date.now());
   // The list-region selector is diagnostic only. A sidebar may mount its
   // conversation links several seconds after render activation without an
   // explicit list-role wrapper, so readiness waits on confirmed routes.
   const rows=await waitForConversationRowsReady(Math.min(6000,rowBudget),deadline,{phaseABudgetMs:4000,stabilizationGraceMs:1200,absoluteReadinessCapMs:6000});
   telemetry.durationMs=Math.max(0,Date.now()-started);telemetry.reason=rows.ready?null:rows.diagnosticStatus;
   if(telemetry.timeSinceRenderActivationMs!==null)telemetry.timeSinceRenderActivationMs+=telemetry.durationMs;
   rows.rawStatus=rows.status;rows.status=rows.diagnosticStatus;
   rows.terminalReason=rows.diagnosticStatus;rows.readinessTerminalReason=rows.rawStatus;
   const finalSnapshot=readinessPreflightSnapshot(options),listAtWaitStart=telemetry.listRegionCandidatesAtRowsWaitStart;
   Object.assign(telemetry,finalSnapshot);telemetry.listRegionCandidatesAtRowsWaitStart=listAtWaitStart;
   telemetry.readinessTerminalReason=rows.readinessTerminalReason;telemetry.firstPositiveCount=rows.firstPositiveCount;
   telemetry.finalStableCount=rows.finalStableCount;telemetry.conversationSignatureChanges=rows.conversationSignatureChanges;
   telemetry.mutationChecks=rows.mutationChecks;telemetry.unrelatedMutationChecks=rows.unrelatedMutationChecks;telemetry.timeToStableMs=rows.timeToStableMs;
   return {preflight:telemetry,readiness:rows};
  }
  telemetry.durationMs=Math.max(0,Date.now()-started);
  return {preflight:telemetry,readiness:{status:telemetry.reason,diagnosticStatus:telemetry.reason,rawStatus:telemetry.reason,terminalReason:telemetry.reason,ready:false,waitStarted:true,waitStartedAtMs:started,
   waitDurationMs:telemetry.durationMs,rowsAtFirstDetection:0,rowsAtStabilizedSnapshot:0,firstPositiveCount:0,stableCount:0,finalSnapshotCount:0,
   finalStableCount:0,conversationSignatureChanges:0,unrelatedMutationChecks:0,readinessTerminalReason:telemetry.reason,
   timeToFirstPositiveMs:null,timeToStableMs:null,sidebarRegionFound:telemetry.sidebarAvailable,root:activeSidebarSnapshot().root,rows:[]}};
 };
 window.gptWaitForPinnedReadinessPreflight=waitForPinnedReadinessPreflight;
 const sidebarToggleCandidates=()=>{
  const labelPattern=/(sidebar|side\s*bar|navigation|open menu|close menu|show menu|hide menu|open side|close side|боков.{0,12}панел|панел.{0,12}боков|навигац|открыть меню|закрыть меню)/i;
  return [...document.querySelectorAll('button,[role="button"],[aria-expanded]')].filter(el=>{
   if(!buttonLike(el))return false;const label=safeLabel(el);return !!label&&labelPattern.test(label);
  }).slice(0,10).map(el=>({el,role:roleOf(el),expanded:el.getAttribute?.('aria-expanded'),label:safeLabel(el)}));
 };
 const findSidebarToggle=()=>{
  const list=sidebarToggleCandidates();return list.length===1?{status:'unique',...list[0]}:{status:list.length?'ambiguous':'not_found',candidates:list.slice(0,5).map(c=>({role:c.role,hasAriaExpanded:c.expanded!==null&&c.expanded!==undefined,expanded:c.expanded==='true'?'true':c.expanded==='false'?'false':'absent',labelClass:'sidebar-toggle'}))};
 };
 const listContainerFor=(el,root)=>{
  const id=el.getAttribute?.('aria-controls')||'',controlled=id?document.getElementById?.(id):null;
  const inside=node=>!!node&&(node===root||!!root?.contains?.(node));
  if(inside(controlled))return controlled;
  const siblings=[...(el.parentElement?.children||[])].filter(node=>node!==el);
  return siblings.find(node=>inside(node)&&(node.getAttribute?.('role')==='list'||node.getAttribute?.('role')==='tree'||!!node.querySelector?.('[role="listitem"],a[href]')&&[...node.querySelectorAll?.('a[href]')||[]].some(anchor=>routeKind(anchor)==='conversation')))||null;
 };
 const starredCandidates=root=>{
  if(!root)return[];
  const starredLabel=/(pinned|starred|favorite|favourite|закреп|избран|избранн)/i;
  return [...root.querySelectorAll('button,[role="button"],[aria-expanded]')].filter(buttonLike).map(el=>{
   const label=safeLabel(el),container=listContainerFor(el,root),expanded=el.getAttribute?.('aria-expanded');
   const labelledSection=starredLabel.test(label);
   const containerLabel=container&&starredLabel.test(safeLabel(container));
   const classified=labelledSection||containerLabel;
   if(expanded==null&&!container&&!classified)return null;
   const links=visibleLinkCount(container);
   return {el,role:roleOf(el),hasAriaExpanded:expanded!==null&&expanded!==undefined,expanded:expanded==='true'?'true':expanded==='false'?'false':'absent',
    labelClass:classified?'starred':'other',container,containerFound:!!container,containerVisible:isVisible(container),visibleConversationLinkCount:links,
    insideSidebar:true,eligible:classified&&el.getAttribute?.('aria-expanded')!==null&&el.getAttribute?.('aria-expanded')!==undefined};
  }).filter(Boolean).slice(0,10);
 };
 const candidateSummary=c=>({role:c.role,hasAriaExpanded:c.hasAriaExpanded,expanded:c.expanded,insideSidebar:c.insideSidebar,hasContainer:c.containerFound,labelClass:c.labelClass});
 const starredControl=root=>{
  const candidates=starredCandidates(root),eligible=candidates.filter(c=>c.eligible);
  if(eligible.length===1)return {status:'found',...eligible[0],candidates:candidates.slice(0,5).map(candidateSummary)};
  return {status:eligible.length?'ambiguous':'not_found',candidateCount:eligible.length,candidates:candidates.slice(0,5).map(candidateSummary)};
 };
 const starredSnapshot=root=>{
  const c=starredControl(root);
  if(c.status!=='found')return {controlFound:false,reason:c.status,candidateCount:c.candidateCount||0,candidates:c.candidates||[]};
  const expanded=c.el.getAttribute?.('aria-expanded');
  return {controlFound:true,role:c.role,expanded:expanded==='true',expandedAvailable:expanded==='true'||expanded==='false',
   sidebarRelated:true,controlledList:c.containerFound,containerFound:c.containerFound,containerVisible:c.containerVisible,
   visibleConversationLinkCount:c.visibleConversationLinkCount,candidates:c.candidates};
 };
 const markerClass=el=>{
  if(!el)return 'none';
  const attrs=[el.getAttribute?.('aria-label'),el.getAttribute?.('title'),el.getAttribute?.('data-testid'),el.className,el.getAttribute?.('role')]
   .filter(value=>typeof value==='string').join(' ').toLowerCase();
  const headings=[...(el.querySelectorAll?.('h1,h2,h3,h4,h5,h6,[role="heading"]')||[])].slice(0,3).map(node=>String(node.textContent||'')).join(' ').toLowerCase();
  const signature=attrs+' '+headings;
  if(/pinned|starred|favorite|favourite|закреп|избран|избранн/.test(signature))return 'pinned';
  if(/recent|history|истори|недавн|последн/.test(signature))return 'history';
  if(/section|group|list/.test(signature))return 'group';
  return 'other';
 };
 const safeAttrs=el=>[...(el?.attributes||[])].map(a=>String(a.name||'').toLowerCase()).filter(name=>name==='id'||name.startsWith('aria-')||name.startsWith('data-')).slice(0,30);
 const routeKind=anchor=>{try{const href=anchor?.getAttribute?.('href');if(typeof href!=='string'||!href.trim())return 'unknown';const path=new URL(href,location.href).pathname;
  if(/^\/c\/[A-Za-z0-9-]+\/?$/.test(path)||/^\/g\/[^/]+\/c\/[A-Za-z0-9-]+\/?$/.test(path))return 'conversation';if(/^\/g\/[^/]+\/?$/.test(path))return 'project';return octaneNavigationRoute(anchor)?.kind||'unknown';}catch{return 'unknown';}};
 const routeType=anchor=>{try{const href=anchor?.getAttribute?.('href');if(typeof href!=='string'||!href.trim())return null;const path=new URL(href,location.href).pathname;if(/^\/g\/[^/]+\/c\/[A-Za-z0-9-]+\/?$/.test(path))return 'g_conversation';if(/^\/c\/[A-Za-z0-9-]+\/?$/.test(path))return 'conversation';return octaneNavigationRoute(anchor)?.routeType||null;}catch{return null;}};
 const safeRouteTemplate=anchor=>{try{const path=new URL(anchor.getAttribute?.('href')||'',location.href).pathname;
  const known=new Set(['c','g','project','share','s','chat','conversation','workspace','settings','auth','login','logout','library','explore','search','account','help','new','recent','archived','projects','home','actions']);
  const segments=path.split('/').filter(Boolean).map(segment=>known.has(segment.toLowerCase())?segment.toLowerCase():'<id>');
  return '/'+segments.join('/');}catch{return '/<unknown>';}};
 const rowForAnchor=(anchor,root)=>{let node=anchor.parentElement,depth=0,chosen=anchor;
  while(node&&node!==root&&depth<8){const links=[...(node.querySelectorAll?.('a[href]')||[])];if(links.length===1){chosen=node;break;}node=node.parentElement;depth++;}
  return chosen;};
 window.gptInspectSidebarRoutes=()=>{
  const roots=sidebarRoots().filter(isVisible),root=roots.sort((a,b)=>{const ar=rectOf(a),br=rectOf(b);return (br?.width||0)*(br?.height||0)-(ar?.width||0)*(ar?.height||0);})[0]||null;
  const anchors=root?[...(root.querySelectorAll?.('a[href]')||[])].filter(isVisible).slice(0,20):[];
  const routes=anchors.map((anchor,index)=>{
   const row=rowForAnchor(anchor,root),hrefPath=safeRouteTemplate(anchor),kind=routeKind(anchor),attrs=[...(anchor.attributes||[])].map(a=>String(a.name||'').toLowerCase()).filter(name=>name.startsWith('data-')).slice(0,20);
   const role=anchor.getAttribute?.('role')||'link';let ancestors=0,node=anchor;while(node&&node!==root&&ancestors<20){ancestors++;node=node.parentElement;}
   const rowTag=String(row?.tagName||anchor.tagName||'a').toLowerCase(),rowRole=row?.getAttribute?.('role')||'none';
   const rowAttrs=[...(row?.attributes||[])].map(a=>String(a.name||'').toLowerCase()).filter(name=>name.startsWith('data-')).slice(0,20);
   const hasControl=!!row?.querySelector?.('button,[role="button"],[aria-haspopup]');
   return {row:index+1,template:hrefPath,kind,tag:String(anchor.tagName||'a').toLowerCase(),role,dataAttributeNames:attrs,hasAriaCurrent:anchor.getAttribute?.('aria-current')!=null,ancestorLevels:ancestors,hasButtonOrMenuControl:hasControl,rowTag,rowRole,rowDataAttributeNames:rowAttrs,rowHasAriaCurrent:row?.getAttribute?.('aria-current')!=null,rowHasButtonOrMenuControl:hasControl};
  });
  const firstConversation=routes.find(item=>item.kind==='conversation')||null;
  return {version:PINNED_DIAGNOSTIC_VERSION,rootsFound:sidebarRoots().length,visibleRoots:roots.length,linksInspected:routes.length,acceptedTemplates:['/c/<id>','/g/<id>/c/<id>','/g/<id> (project)','/<id> (Octane sidebar item)','/<id>/<id> (Octane sidebar item)'],firstConversation:firstConversation?{template:firstConversation.template,rowTag:firstConversation.rowTag,rowRole:firstConversation.rowRole,rowDataAttributeNames:firstConversation.rowDataAttributeNames,rowHasAriaCurrent:firstConversation.rowHasAriaCurrent,rowHasButtonOrMenuControl:firstConversation.rowHasButtonOrMenuControl,ancestorLevels:firstConversation.ancestorLevels}:null,routes};
 };
 const nodeKind=node=>{const tag=String(node?.tagName||'').toLowerCase(),role=node?.getAttribute?.('role')||'';
  if(tag==='a')return routeKind(node)==='conversation'?'conversation_link':routeKind(node)==='project'?'project_link':'unknown_link';
  if(buttonLike(node)||role==='button')return 'control';if(/^h[1-6]$/.test(tag)||role==='heading')return 'heading';
  if(['group','list','tree'].includes(role)||['div','section','ul','ol'].includes(tag))return 'group';return 'other';};
 const siblingKinds=parent=>{const counts={button:0,link:0,div_group:0,heading:0,project_link:0,conversation_link:0,other:0};
  for(const node of [...(parent?.children||[])]){const kind=nodeKind(node);if(kind==='control')counts.button++;else if(kind==='conversation_link')counts.conversation_link++;
   else if(kind==='project_link')counts.project_link++;else if(kind==='unknown_link')counts.link++;else if(kind==='heading')counts.heading++;else if(kind==='group')counts.div_group++;else counts.other++;}return counts;};
 const semanticBoundary=el=>{const tag=String(el?.tagName||'').toLowerCase(),role=el?.getAttribute?.('role')||'';
  return tag==='section'||tag==='header'||/^h[1-6]$/.test(tag)||role==='heading'||markerClass(el)==='pinned';};
 const pinnedSidebarSnapshot=root=>{
  if(!root)return {candidateFound:false,pinnedRegionFound:false,pinnedGroupFound:false,pinnedLinkCount:0,visiblePinnedLinkCount:0,groups:[],orderedLinks:[],disclosureCount:0,disclosures:[],fullness:'unknown'};
  const anchors=[...(root.querySelectorAll?.('a[href]')||[])].filter(anchor=>['conversation','project'].includes(routeKind(anchor))),visible=anchors.filter(isVisible);
  const idOf=anchor=>conversationIdFromAnchor(anchor);
  const rootIds=new Set(visible.map(idOf).filter(Boolean));
  const controls=[...(root.querySelectorAll?.('button,[role="button"],[aria-expanded]')||[])].filter(buttonLike);
  const candidate=controls.find(el=>markerClass(el)==='pinned')||[...(root.querySelectorAll?.('h1,h2,h3,h4,h5,h6,[role="heading"],[data-testid*="pinned"],[data-testid*="starred"]')||[])].find(el=>markerClass(el)==='pinned')||null;
  const relationship=(el,name)=>{const raw=el?.getAttribute?.(name)||'',tokens=raw.trim().split(/\s+/).filter(Boolean);const targets=tokens.map(id=>document.getElementById?.(id)).filter(Boolean);
   return {present:tokens.length>0,targetFound:targets.length>0,targetRoles:targets.slice(0,3).map(roleOf)};};
  const relationships=candidate?{ariaControls:relationship(candidate,'aria-controls'),ariaLabelledby:relationship(candidate,'aria-labelledby'),ariaOwns:relationship(candidate,'aria-owns'),idPresent:!!candidate.getAttribute?.('id')}:
   {ariaControls:{present:false,targetFound:false,targetRoles:[]},ariaLabelledby:{present:false,targetFound:false,targetRoles:[]},ariaOwns:{present:false,targetFound:false,targetRoles:[]},idPresent:false};
  let regionParent=null,regionNodes=[],branch=candidate,level=0;
  while(candidate&&branch&&branch!==root&&level<5){const parent=branch.parentElement,children=[...(parent?.children||[])],index=children.indexOf(branch);
   if(index>=0){const after=[];for(const sibling of children.slice(index+1)){if(semanticBoundary(sibling))break;after.push(sibling);}
    if(after.length){regionParent=parent;regionNodes=after;break;}}
   branch=parent;level++;}
  const regionElements=regionNodes.flatMap(node=>[node,...(node.querySelectorAll?.('a[href],button,[role="button"],section,ul,ol,[role="group"],[role="list"],[role="tree"]')||[])]);
  const regionLinks=regionElements.filter(el=>String(el.tagName||'').toLowerCase()==='a');
  const regionTypes=regionLinks.map(routeKind),pinnedConversationIds=regionLinks.filter((_,i)=>regionTypes[i]==='conversation').map(idOf).filter(Boolean);
  const regionCounts={conversationLinks:regionTypes.filter(x=>x==='conversation').length,projectLinks:regionTypes.filter(x=>x==='project').length,unknownLinks:regionTypes.filter(x=>x==='unknown').length,
   controls:regionElements.filter(el=>nodeKind(el)==='control').length,groups:regionElements.filter(el=>nodeKind(el)==='group').length,other:regionElements.filter(el=>nodeKind(el)==='other').length};
  const chain=[];branch=candidate;level=0;while(branch&&branch!==root&&level<5){const parent=branch.parentElement;chain.push({tag:String(branch.tagName||'').toLowerCase(),role:branch.getAttribute?.('role')||'none',ariaAttributes:safeAttrs(branch).filter(n=>n.startsWith('aria-')),
    dataAttributes:safeAttrs(branch).filter(n=>n.startsWith('data-')),idPresent:!!branch.getAttribute?.('id'),siblingCount:Math.max(0,(parent?.children?.length||0)-1),siblingKinds:siblingKinds(parent)});branch=parent;level++;}
  const ancestorGroups=new Map(),orderedLinks=[];
  visible.forEach((anchor,index)=>{let node=anchor.parentElement,depth=0,chosen=null;while(node&&node!==root&&depth<7){const tag=String(node.tagName||'').toLowerCase(),role=node.getAttribute?.('role')||'',marker=markerClass(node);
    if(tag==='section'||tag==='ul'||tag==='ol'||['group','list','tree'].includes(role)||marker==='pinned'){chosen={node,tag,role,marker};break;}node=node.parentElement;depth++;}
   const group=chosen?.node||root,key=group;const info={tag:chosen?.tag||String(group.tagName||'').toLowerCase(),role:chosen?.role||group.getAttribute?.('role')||'none',labelClass:chosen?.marker||markerClass(group),firstOrder:index+1,links:0};
   if(!ancestorGroups.has(key))ancestorGroups.set(key,info);ancestorGroups.get(key).links++;
   orderedLinks.push({order:index+1,groupClass:info.labelClass,containerTag:info.tag,containerRole:info.role});});
  const groups=[...ancestorGroups.values()].map(group=>({tag:group.tag,role:group.role,labelClass:group.labelClass,linkCount:group.links,firstOrder:group.firstOrder}));
  const pinnedGroupFound=!!candidate||groups.some(g=>g.labelClass==='pinned'),pinnedRegionFound=!!candidate&&regionNodes.length>0;
  const expanded=candidate?.getAttribute?.('aria-expanded');
  const disclosures=controls.filter(el=>el.getAttribute?.('aria-expanded')!==null&&el.getAttribute?.('aria-expanded')!==undefined);
  const disclosureSummaries=controls.slice(0,5).map(el=>({role:roleOf(el),hasAriaExpanded:el.getAttribute?.('aria-expanded')!=null,
   expanded:el.getAttribute?.('aria-expanded')==='true'?'true':el.getAttribute?.('aria-expanded')==='false'?'false':'absent',insideSidebar:true,hasContainer:!!listContainerFor(el,root),labelClass:markerClass(el)}));
  const candidateSummary=candidate?{tag:String(candidate.tagName||'').toLowerCase(),role:roleOf(candidate),ariaExpanded:expanded==='true'?'true':expanded==='false'?'false':'absent',ariaAttributes:safeAttrs(candidate).filter(n=>n.startsWith('aria-'),),dataAttributes:safeAttrs(candidate).filter(n=>n.startsWith('data-'))}:null;
  return {candidateFound:!!candidate,candidate:candidateSummary,relationships,parentChain:chain,region:{found:pinnedRegionFound,nonNested:pinnedRegionFound&&!candidate?.contains?.(regionParent),parentTag:regionParent?String(regionParent.tagName||'').toLowerCase():'none',parentRole:regionParent?.getAttribute?.('role')||'none',siblingCount:regionNodes.length,counts:regionCounts},
   pinnedGroupFound,pinnedLinkCount:regionCounts.conversationLinks,visiblePinnedLinkCount:regionCounts.conversationLinks,pinnedConversationCount:regionCounts.conversationLinks,pinnedProjectCount:regionCounts.projectLinks,pinnedUnknownCount:regionCounts.unknownLinks,
   groups:groups.slice(0,12),orderedLinks:orderedLinks.slice(0,20),disclosureCount:disclosures.length,disclosures:disclosureSummaries,fullness:pinnedRegionFound?'local_region_only_not_completeness_proof':'unproven',
   pinnedIds:pinnedConversationIds,allVisibleConversationIds:[...rootIds]};
 };
 const rowPinMarker=row=>{
  if(!row)return 'unknown';
  for(const name of ['data-is-pinned','data-pinned','data-is-starred','data-starred','aria-label','title','data-testid']){
   const value=String(row.getAttribute?.(name)||'').toLowerCase();
   if(!/(pinned|starred|favorite)/.test(name)&&!/(pinned|starred|favorite)/.test(value))continue;
   if(['true','1','yes','pinned','starred'].includes(value))return 'pinned';
   if(['false','0','no','unpinned','unstarred'].includes(value))return 'not_pinned';
   if(/(?:^|[\s_-])(pinned|starred|favorited)(?:$|[\s_-])/.test(value))return 'pinned';
  }
  const classes=typeof row.className==='string'?row.className.toLowerCase():'';
  if(/(?:^|[\s_-])(pinned|starred|favorited)(?:$|[\s_-])/.test(classes))return 'pinned';
  return 'unknown';
 };
 const overflowControl=row=>[...(row?.querySelectorAll?.('button,[role="button"]')||[])].filter(buttonLike).filter(el=>{
  const values=[safeLabel(el),el.getAttribute?.('data-testid')||'',el.className||'',el.getAttribute?.('aria-haspopup')||''].join(' ').toLowerCase();
  return el.getAttribute?.('aria-haspopup')==='menu'||/(more|overflow|option|action|menu|ellipsis|conversation)/.test(values);
 });
 const visibleMenus=()=>[...(document.querySelectorAll?.('[role="menu"]')||[])].filter(isVisible);
 const classifyMenuActions=menu=>{
  const actions=[...(menu?.querySelectorAll?.('[role="menuitem"],[role="menuitemcheckbox"],button')||[])];
  let pin=false,unpin=false;
  for(const action of actions){
   const label=[safeLabel(action),action.getAttribute?.('data-testid')||'',typeof action.innerText==='string'?action.innerText:''].join(' ').toLowerCase();
   if(/unpin|unstar|remove[^\n]{0,30}(pin|star|favorite)|откреп|убрать[^\n]{0,30}(закреп|избран)/i.test(label))unpin=true;
   else if(/\bpin\b|\bstar\b|add[^\n]{0,30}(favorite|star)|закреп|добавить[^\n]{0,30}избран/i.test(label))pin=true;
  }
  return {pin,unpin,kind:pin&&unpin?'ambiguous':unpin?'unpin_action':pin?'pin_action':actions.length?'other_actions':'no_actions'};
 };
 const waitForBounded=async(predicate,timeoutMs,run,allowCancelled=false)=>{
  const deadline=Date.now()+Math.max(0,timeoutMs);
  while(Date.now()<deadline&&(allowCancelled||!run.cancelled)){try{if(predicate())return true;}catch{}await new Promise(resolve=>setTimeout(resolve,Math.min(50,Math.max(1,deadline-Date.now()))));}
  try{return (allowCancelled||!run.cancelled)&&!!predicate();}catch{return false;}
 };
 const diagnosticProgress=(run,row,stage,extra={})=>{
  try{window.webkit?.messageHandlers?.starredDiagnostic?.postMessage({topChatPinProgress:{version:PINNED_DIAGNOSTIC_VERSION,row,stage,rowsAttempted:run.rowsAttempted,rowsCompleted:run.rowsCompleted,
   statuses:run.rows.map(item=>({row:item.row,status:item.status})),menuLeftOpen:run.menuLeftOpen,...extra}});}catch{}
 };
 const sendEscape=()=>{try{document.dispatchEvent?.(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));}catch{}};
 const classifyRow=async(index,anchor,root,run,overallDeadline)=>{
  const rowStarted=Date.now(),rowDeadline=Math.min(overallDeadline,rowStarted+2500);let status='unknown',reason='unclassified',menuKind='not_inspected',trigger=null,opened=false,stop=false;
  let row=anchor.parentElement,depth=0,selected=null;
  while(row&&row!==root&&depth<8){
   const links=[...(row.querySelectorAll?.('a[href]')||[])].filter(a=>routeKind(a)==='conversation');
   if(links.length===1){selected=row;if(overflowControl(row).length||rowPinMarker(row)!=='unknown')break;}
   row=row.parentElement;depth++;
  }
  row=selected;diagnosticProgress(run,index,'started');
  let id=null;try{id=conversationIdFromAnchor(anchor);}catch{}
  try{
   if(run.cancelled||Date.now()>=rowDeadline){reason='row_timeout';}
   else {
    const direct=rowPinMarker(row);
    if(direct!=='unknown'){status=direct==='pinned'?'pinned':'not pinned';reason='row_marker';}
    else if(!row){reason='row_container_missing';}
    else if(visibleMenus().length){reason='preexisting_menu';run.menuLeftOpen=true;stop=true;}
    else {
    const controls=overflowControl(row);
    if(controls.length!==1){reason=controls.length?'ambiguous_overflow_controls':'overflow_unavailable';}
    else {
      trigger=controls[0];run.currentTrigger=trigger;trigger.click();
     const appeared=await waitForBounded(()=>visibleMenus().length>0,Math.min(1000,rowDeadline-Date.now()),run);
     opened=visibleMenus().length>0;
     if(appeared&&opened){run.menuLeftOpen=true;diagnosticProgress(run,index,'menu opened');
      const menus=visibleMenus();
      if(menus.length!==1){reason='ambiguous_menu';}
      else {
       const actions=classifyMenuActions(menus[0]);menuKind=actions.kind;
       if(actions.unpin&&!actions.pin){status='pinned';reason='unpin_action_available';}
       else if(actions.pin&&!actions.unpin){status='not pinned';reason='pin_action_available';}
       else reason='pin_action_unproven';
      }
      diagnosticProgress(run,index,'classified',{status});
     }else reason=run.cancelled?'cancelled':'menu_appear_timeout';
    }
   }
   }
  }catch{reason=Date.now()>=rowDeadline?'row_timeout':'inspection_error';status='unknown';}
  finally{
   if(opened){
    sendEscape();let closed=await waitForBounded(()=>visibleMenus().length===0,800,run,true);
    if(!closed&&trigger){try{trigger.click();}catch{}closed=await waitForBounded(()=>visibleMenus().length===0,300,run,true);}
    run.menuLeftOpen=!closed;diagnosticProgress(run,index,closed?'menu closed':'menu cleanup timeout',{status:closed?status:'unknown'});
    run.currentTrigger=null;
    if(!closed){status='unknown';reason='menu_cleanup_timeout';stop=true;}
   }
  }
  if(Date.now()>=rowDeadline||Date.now()>=overallDeadline){status='unknown';reason='row_timeout';}
  const result={row:index,status,reason,menuKind};
  if(status==='pinned'&&id)result.id=id; // Internal only; removed before any native message.
  return {...result,stop};
 };
 window.gptCancelTopChatPinStatus=()=>{if(activePinDiagnostic){const run=activePinDiagnostic;run.cancelled=true;sendEscape();
  if(visibleMenus().length&&run.currentTrigger){try{run.currentTrigger.click();}catch{}}
  run.menuLeftOpen=visibleMenus().length>0;return !run.menuLeftOpen;}return false;};
 window.gptInspectTopChatPinStatus=async(options={})=>{
  const run={cancelled:false,rows:[],pinnedIds:[],rowsAttempted:0,rowsCompleted:0,menuLeftOpen:false};activePinDiagnostic=run;
  const maxRows=Math.max(1,Math.min(3,Number.isInteger(options.maxRows)?options.maxRows:3));
  const hardMs=Math.max(100,Math.min(10000,Number.isFinite(options.hardTimeoutMs)?options.hardTimeoutMs:10000));
  const startedAt=Date.now(),overallDeadline=startedAt+Math.min(8500,hardMs);
  let timeoutRowIndex=null,reason='completed';
  try{
   const sidebar=sidebarSnapshot(),root=sidebar.root;
   const anchors=root?[...(root.querySelectorAll?.('a[href]')||[])].filter(a=>isVisible(a)&&routeKind(a)==='conversation').slice(0,maxRows):[];
   for(let i=0;i<anchors.length;i++){
    if(run.cancelled||Date.now()>=overallDeadline){timeoutRowIndex=i+1;reason=run.cancelled?'cancelled':'hard_timeout';break;}
    run.rowsAttempted=i+1;
    const row=await classifyRow(i+1,anchors[i],root,run,overallDeadline);
    if(row.status==='pinned'&&row.id)run.pinnedIds.push(row.id);
    if(/timeout/.test(row.reason)){timeoutRowIndex=i+1;reason=row.reason;}
    const safeRow={row:row.row,status:row.status,reason:row.reason,menuActions:row.menuKind};
    run.rows.push(safeRow);run.rowsCompleted++;
    diagnosticProgress(run,i+1,'row completed',{status:safeRow.status,reason:safeRow.reason});
    if(row.stop){reason='menu_left_open';timeoutRowIndex=i+1;break;}
    if(Date.now()>=overallDeadline){reason='hard_timeout';timeoutRowIndex=i+1;break;}
   }
   if(Date.now()-startedAt>=hardMs){reason='hard_timeout';timeoutRowIndex=timeoutRowIndex||run.rowsAttempted||null;}
  }catch{reason='diagnostic_error';}
  finally{activePinDiagnostic=null;}
  const safeRows=run.rows.map(({row,status,reason,menuActions})=>({row,status,reason,menuActions}));
  const pinnedCount=safeRows.filter(row=>row.status==='pinned').length,notPinnedCount=safeRows.filter(row=>row.status==='not pinned').length,unknownCount=safeRows.filter(row=>row.status==='unknown').length;
  const firstNotPinned=safeRows.findIndex(row=>row.status==='not pinned'),pinnedAfterUnpinned=firstNotPinned>=0&&safeRows.slice(firstNotPinned+1).some(row=>row.status==='pinned');
  const contiguousTopBlock=pinnedAfterUnpinned?'no':unknownCount?'unknown':pinnedCount?'yes':'unknown';
  const source=window.gptSummarizePinnedLinkSources?.(run.pinnedIds)||null;
  return {version:PINNED_DIAGNOSTIC_VERSION,inspectedCount:run.rowsAttempted,rowsAttempted:run.rowsAttempted,rowsCompleted:run.rowsCompleted,timeoutRowIndex,menuLeftOpen:run.menuLeftOpen,
   reason,rows:safeRows,pinnedCount,notPinnedCount,unknownCount,contiguousTopBlock,
   source:source?{matched:source.networkMatchedCount>0,networkMatchedCount:source.networkMatchedCount,updatedAtCount:source.updatedAtCount,sources:source.sources}:null};
 };
 const controlLabelClass=el=>{
  const value=[safeLabel(el),el?.getAttribute?.('data-testid')||'',el?.className||''].join(' ').toLowerCase();
  if(/unpin|unstar|откреп/.test(value))return 'unpin';
  if(/\bpin\b|star|закреп|избран/.test(value))return 'pin';
  if(/menu|more|overflow|ellipsis|option|action|conversation|действ|меню|дополн|ещё|еще|параметр/.test(value))return 'menu_or_more';
  if(!value.trim())return 'no_accessible_label';
  return 'other';
 };
 const rowButtons=row=>[...(row?.querySelectorAll?.('button,[role="button"]')||[])].filter(buttonLike);
 const elementRect=el=>{const r=rectOf(el);return r||{x:0,y:0,width:0,height:0};};
 const buttonShape=(el,row)=>{
  const text=String(el?.textContent||'').trim(),svg=!!el?.querySelector?.('svg');
  const popup=el?.getAttribute?.('aria-haspopup');
  return {role:roleOf(el),ariaLabelClass:controlLabelClass(el),titleClass:controlLabelClass({getAttribute:name=>name==='title'?el?.getAttribute?.('title'):null}),visible:isVisible(el),rect:elementRect(el),insideRow:!!row?.contains?.(el),
   ariaHaspopup:popup?(/menu|dialog|listbox/i.test(popup)?'semantic_popup': 'other_popup'):'absent',dataStatePresent:el?.getAttribute?.('data-state')!=null,svgPresent:svg,iconOnly:!text&&svg,
   dataAttributeNames:[...(el?.attributes||[])].map(attribute=>String(attribute.name||'').toLowerCase()).filter(name=>name.startsWith('data-')).slice(0,12)};
 };
 const rowShape=row=>{
  const buttons=rowButtons(row).slice(0,5),tag=String(row?.tagName||'unknown').toLowerCase();
  return {tag,role:row?.getAttribute?.('role')||'none',buttonDescendants:rowButtons(row).length,buttons:buttons.map(button=>buttonShape(button,row)),
   ariaHaspopupCount:[...(row?.querySelectorAll?.('[aria-haspopup]')||[])].length,
   dataStateCount:[...(row?.querySelectorAll?.('[data-state]')||[])].length,svgControlCount:rowButtons(row).filter(button=>!!button.querySelector?.('svg')).length,
   iconOnlyControlCount:rowButtons(row).filter(button=>!String(button.textContent||'').trim()&&!!button.querySelector?.('svg')).length,
   visibleIconControlCount:rowButtons(row).filter(button=>isVisible(button)&&!!button.querySelector?.('svg')).length,
   dataAttributeNames:[...(row?.attributes||[])].map(attribute=>String(attribute.name||'').toLowerCase()).filter(name=>name.startsWith('data-')).slice(0,20)};
 };
 const dispatchRowHover=row=>{
  const init={bubbles:true,cancelable:true,view:window};
  for(const type of ['pointerover','mouseover','pointerenter','mouseenter','pointermove','mousemove']){
   try{const C=type.startsWith('pointer')&&typeof PointerEvent==='function'?PointerEvent:MouseEvent;row.dispatchEvent(new C(type,init));}catch{}
  }
 };
 const openPopupCandidates=()=>[...(document.querySelectorAll?.('[role="menu"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="dialog"],[role="listbox"],[popover],[data-radix-popper-content-wrapper],[data-radix-menu-content],[data-state="open"]')||[])]
  .filter(isVisible).filter(el=>{
   const role=el.getAttribute?.('role')||'',hasItem=!!el.querySelector?.('[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]');
   return ['menu','dialog','listbox'].includes(role)||el.hasAttribute?.('popover')||el.hasAttribute?.('data-radix-popper-content-wrapper')||el.hasAttribute?.('data-radix-menu-content')||hasItem;
  }).map(el=>{
   const role=el.getAttribute?.('role')||'';
   if(/^menuitem/.test(role))return el.closest?.('[role="menu"],[role="dialog"],[role="listbox"],[popover],[data-radix-popper-content-wrapper]')||el.parentElement||el;
   return el;
  }).filter((el,index,all)=>all.indexOf(el)===index);
 const popupKind=el=>{
  const role=el?.getAttribute?.('role')||'none';
  if(role==='menu'||el?.querySelector?.('[role="menuitem"]'))return {role:'menu',containerType:el?.hasAttribute?.('data-radix-popper-content-wrapper')?'portal_popover':el?.hasAttribute?.('popover')?'popover':'menu'};
  if(role==='dialog')return {role:'dialog',containerType:'dialog'};
  if(role==='listbox')return {role:'listbox',containerType:'listbox'};
  return {role,containerType:el?.hasAttribute?.('popover')?'popover':el?.hasAttribute?.('data-radix-popper-content-wrapper')?'portal_popover':'other_open_state'};
 };
 const safeActionClass=el=>{
  const label=[safeLabel(el),el?.getAttribute?.('data-testid')||'',String(el?.textContent||'')].join(' ').toLowerCase();
  if(/unpin|unstar|remove[^\n]{0,30}(pin|star|favorite)|откреп|убрать[^\n]{0,30}(закреп|избран)/i.test(label))return 'unpin';
  if(/\bpin\b|\bstar\b|add[^\n]{0,30}(favorite|star)|закреп|добавить[^\n]{0,30}избран/i.test(label))return 'pin';
  return 'other';
 };
 const structureDiagnosticControlLike=el=>{
  if(!el)return false;
  const tag=String(el.tagName||'').toLowerCase(),role=el.getAttribute?.('role')||'';
  const attrs=[...(el.attributes||[])].map(attribute=>String(attribute.name||'').toLowerCase());
  return tag==='button'||role==='button'||role==='menuitem'||el.getAttribute?.('aria-haspopup')!=null||el.getAttribute?.('data-state')!=null||
   attrs.some(name=>name.startsWith('data-radix-'))||el.hasAttribute?.('popover')||typeof el.onclick==='function'||el.getAttribute?.('tabindex')!=null||
   (!!el.querySelector?.('svg')&&['div','span','a'].includes(tag));
 };
 const structureDiagnosticControls=node=>{
  const nodes=[];if(structureDiagnosticControlLike(node))nodes.push(node);
  for(const child of [...(node?.querySelectorAll?.('*')||[])])if(structureDiagnosticControlLike(child))nodes.push(child);
  return [...new Set(nodes)];
 };
 const structureDiagnosticStyle=el=>{
  try{const style=getComputedStyle(el);return {display:String(style.display||'unknown'),visibility:String(style.visibility||'unknown'),opacity:String(style.opacity||'unknown'),pointerEvents:String(style.pointerEvents||style['pointer-events']||'unknown')};}
  catch{return {display:'unknown',visibility:'unknown',opacity:'unknown',pointerEvents:'unknown'};}
 };
 const structureDiagnosticDataNames=el=>[...(el?.attributes||[])].map(attribute=>String(attribute.name||'').toLowerCase()).filter(name=>name.startsWith('data-')).slice(0,20);
 const structureDiagnosticMetrics=(node,root,level)=>{
  const parent=node?.parentElement,rect=elementRect(node),rootRect=elementRect(root);
  const directSiblings=[...(parent?.children||[])].filter(item=>item!==node);
  const buttons=items=>items.reduce((total,item)=>total+[...(item?.querySelectorAll?.('button,[role="button"]')||[])].length+(buttonLike(item)?1:0),0);
  const links=[...(node?.querySelectorAll?.('a[href]')||[])].filter(item=>routeKind(item)==='conversation').length+(String(node?.tagName||'').toLowerCase()==='a'&&routeKind(node)==='conversation'?1:0);
  const style=structureDiagnosticStyle(node);
  return {level,tag:String(node?.tagName||'unknown').toLowerCase(),role:node?.getAttribute?.('role')||'none',dataAttributeNames:structureDiagnosticDataNames(node),
   childCount:[...(node?.children||[])].length,descendantButtons:[...(node?.querySelectorAll?.('button,[role="button"]')||[])].length+(buttonLike(node)?1:0),
   siblingButtons:buttons(directSiblings),conversationLinks:links,rect,style,
   sidebarRoot:node===root,rootRelativeHeight:rootRect.height?Math.round(rect.height/rootRect.height*100):0};
 };
 const structureDiagnosticControl=(el,row,source)=>{
  const style=structureDiagnosticStyle(el),rect=elementRect(el),rowRect=elementRect(row),popup=el.getAttribute?.('aria-haspopup');
  const svg=String(el.tagName||'').toLowerCase()==='svg'||!!el.querySelector?.('svg');
  const childElements=[...(el.children||[])];
  const iconOnly=svg&&childElements.every(child=>String(child.tagName||'').toLowerCase()==='svg'||child.getAttribute?.('aria-hidden')==='true');
  const left=Math.max(rect.x,rowRect.x),top=Math.max(rect.y,rowRect.y),right=Math.min(rect.x+rect.width,rowRect.x+rowRect.width),bottom=Math.min(rect.y+rect.height,rowRect.y+rowRect.height);
  const center=rect.x+rect.width/2,rowCenter=rowRect.x+rowRect.width/2;
  const label=controlLabelClass(el),tag=String(el.tagName||'unknown').toLowerCase(),role=el.getAttribute?.('role')||'none';
  const radixNames=structureDiagnosticDataNames(el).filter(name=>name.startsWith('data-radix-'));
  return {source,tag,role,labelClass:label,clickableSemantics:buttonLike(el)||typeof el.onclick==='function'||el.getAttribute?.('tabindex')!=null||el.getAttribute?.('aria-haspopup')!=null,
   dataAttributeNames:structureDiagnosticDataNames(el),ariaHaspopup:popup?(/menu|dialog|listbox/i.test(popup)?'menu_or_popup':'other_popup'):'absent',
   hasDataState:el.getAttribute?.('data-state')!=null,radixAttributeNames:radixNames,hasPopover:el.hasAttribute?.('popover')||false,svgPresent:svg,iconOnly,
   rect,style,relativeSide:center>rowCenter?'right':center<rowCenter?'left':'center',overlapsRow:right>left&&bottom>top,width:rect.width,height:rect.height};
 };
 window.gptInspectFirstRowStructure=async()=>{
  const started=Date.now(),deadline=started+9000,run={cancelled:false};let reason='completed',hovered=false;
  const bounded=(predicate,ms)=>waitForBounded(predicate,Math.min(ms,Math.max(0,deadline-Date.now())),run);
  let anchor=null,root=null,chain=[],candidates=[],selected=null,beforeControls=[],afterControls=[],hoverChanges=[];
  try{
   const sidebar=sidebarSnapshot();root=sidebar.root;
   if(!root||!isVisible(root))reason='sidebar_unavailable';
   else{
    anchor=[...(root.querySelectorAll?.('a[href]')||[])].find(link=>isVisible(link)&&routeKind(link)==='conversation')||null;
    if(!anchor)reason='no_visible_conversation_link';
    else{
     let node=anchor.parentElement;
     for(let level=1;node&&node!==root&&level<=6;level++,node=node.parentElement)chain.push({node,metrics:structureDiagnosticMetrics(node,root,level)});
     const rootRect=elementRect(root);
     candidates=chain.filter(({node:item,metrics})=>{
      const rowSized=metrics.rect.height>=22&&metrics.rect.height<=110&&metrics.rect.height<Math.max(120,rootRect.height*.28);
      const widthPlausible=metrics.rect.width>=Math.min(100,rootRect.width*.35)&&metrics.rect.width<=rootRect.width+40;
      return !metrics.sidebarRoot&&metrics.conversationLinks===1&&rowSized&&widthPlausible;
     }).map(({node:item,metrics})=>{
      const siblings=[...(item.parentElement?.children||[])].filter(sibling=>sibling!==item);
      const controls=structureDiagnosticControls(item).length;
      const siblingControls=siblings.reduce((total,sibling)=>total+structureDiagnosticControls(sibling).length,0);
      const score=(metrics.descendantButtons?50:0)+(controls?20:0)+(metrics.siblingButtons?25:0)+(siblingControls?10:0)+(metrics.rect.height>=28&&metrics.rect.height<=72?12:0)+(structureDiagnosticDataNames(item).includes('data-thread-title-trigger')?2:0)-Math.abs(metrics.rect.height-44)/20;
      return {node:item,metrics,controls,siblingControls,score};
     }).sort((a,b)=>b.score-a.score).slice(0,3);
     selected=candidates[0]||null;
     if(!selected)reason='row_container_candidate_not_found';
     else{
      const siblingNodes=()=>[...(selected.node.parentElement?.children||[])].filter(sibling=>sibling!==selected.node);
      const rowElements=()=>[...new Set([...structureDiagnosticControls(selected.node),...siblingNodes().flatMap(structureDiagnosticControls)])].slice(0,24);
      const snapshot=()=>rowElements().map(el=>structureDiagnosticControl(el,selected.node,selected.node.contains?.(el)?'row_descendant':'row_sibling'));
      const beforeElements=rowElements();beforeControls=snapshot();
      const beforeByElement=new Map();
      beforeElements.forEach((el,index)=>beforeByElement.set(el,beforeControls[index]));
      dispatchRowHover(selected.node);await bounded(()=>false,180);afterControls=snapshot();
      const afterElements=rowElements(),afterByElement=new Map(afterElements.map((el,index)=>[el,afterControls[index]]));
      const sameElements=new Set([...beforeByElement.keys()].filter(el=>afterByElement.has(el)));
      hoverChanges=[...sameElements].map(el=>{
       const before=beforeByElement.get(el),after=afterByElement.get(el);
       return {before,after,styleChanged:JSON.stringify(before?.style)!==JSON.stringify(after?.style),geometryChanged:JSON.stringify(before?.rect)!==JSON.stringify(after?.rect)};
      }).filter(item=>item.styleChanged||item.geometryChanged).slice(0,12);
      const added=[...afterByElement.keys()].filter(el=>!beforeByElement.has(el)).length;
      reason=added?'hover_added_dom_controls':hoverChanges.length?'hover_changed_control_state':'no_control_change_on_hover';
      selected.newDomControlCount=added;
     }
    }
   }
  }catch{reason=Date.now()>=deadline?'hard_timeout':'structural_inspection_error';}
  const summarizeCandidate=item=>({level:item.metrics.level,tag:item.metrics.tag,role:item.metrics.role,dataAttributeNames:item.metrics.dataAttributeNames,
   childCount:item.metrics.childCount,descendantButtons:item.metrics.descendantButtons,siblingButtons:item.metrics.siblingButtons,rect:item.metrics.rect,
   rowRelativeHeightPercent:item.metrics.rootRelativeHeight,controlCount:item.controls,siblingControlCount:item.siblingControls,score:Math.round(item.score)});
  return {version:PINNED_DIAGNOSTIC_VERSION,reason,linkFound:!!anchor,ancestorChain:chain.map(item=>item.metrics),rowCandidates:candidates.map(summarizeCandidate),
   selectedRowLevel:selected?.metrics.level??null,controlsBeforeHover:beforeControls,controlsAfterHover:afterControls,hoverChanges,
   newDomControlCount:selected?.newDomControlCount??0,clicksPerformed:0,elapsedMs:Math.min(Date.now()-started,9000)};
 };
 window.gptInspectFirstRowMenuTrigger=async()=>{
  const started=Date.now(),deadline=started+9000,run={cancelled:false};let sequenceStarted=false,menu=null,menuOpened=false,menuClosed=false,menuLeftOpen=false,reason='completed';
  let row=null,trigger=null,menuLocation='none',triggerCount=0,actionClasses=[],levelsChecked=0,ancestorSummary=[],rowSummary=null,triggerSummary=null;
  let triggerStateBefore=null,triggerStateAfterPointerdown=null,triggerStateAfterSequence=null,baselineCounts=null,afterPointerdownCounts=null,afterSequenceCounts=null;
  let eventSequenceDelivered=false,pointerdownDelivered=false;
  const mutations={observerInstalled:false,menuLikeNodesAdded:0,menuLikeAttributesChanged:0};
  const sidebarMetrics={rootsFound:0,visibleRoots:0,visibleConversationRows:0};
  const bounded=(predicate,ms)=>waitForBounded(predicate,Math.min(ms,Math.max(0,deadline-Date.now())),run);
  const state=el=>({ariaExpanded:el?.getAttribute?.('aria-expanded')||'absent',dataState:el?.getAttribute?.('data-state')||'absent',ariaControlsPresent:el?.getAttribute?.('aria-controls')!=null,focused:document.activeElement===el,disabled:!!el?.disabled||el?.getAttribute?.('aria-disabled')==='true'});
  const counts=()=>{
   const all=[...(document.querySelectorAll?.('[role="menu"],[role^="menuitem"]')||[])],popoverNodes=[...(document.querySelectorAll?.('[popover],[data-radix-popper-content-wrapper],[data-radix-menu-content],[data-state="open"]')||[])];
   return {menus:all.filter(el=>el.getAttribute?.('role')==='menu').length,menuItems:all.filter(el=>/^menuitem/.test(el.getAttribute?.('role')||'')).length,
    visiblePopoverLike:popoverNodes.filter(isVisible).filter(el=>el.hasAttribute?.('popover')||el.hasAttribute?.('data-radix-popper-content-wrapper')||el.hasAttribute?.('data-radix-menu-content')||((el.getAttribute?.('data-state')||'')==='open'&&!!el.querySelector?.('[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]'))).length,
    visibleStructuralPopups:openPopupCandidates().length};
  };
  const collectMutations=records=>{for(const record of records||[]){
   if(record.type==='attributes'&&['aria-expanded','data-state','aria-controls'].includes(record.attributeName))mutations.menuLikeAttributesChanged++;
   for(const node of record.addedNodes||[]){if(node?.nodeType!==1)continue;
    const found=[node,...(node.querySelectorAll?.('[role="menu"],[role^="menuitem"],[data-radix-menu-content],[data-radix-popper-content-wrapper],[popover],[data-state="open"]')||[])];
    mutations.menuLikeNodesAdded+=found.filter(el=>el.getAttribute?.('role')==='menu'||/^menuitem/.test(el.getAttribute?.('role')||'')||el.hasAttribute?.('data-radix-menu-content')||el.hasAttribute?.('data-radix-popper-content-wrapper')||el.hasAttribute?.('popover')||el.getAttribute?.('data-state')==='open').length;
   }
  }};
  const dispatch=(target,type,pointer,buttons)=>{try{
   const rect=rectOf(target),init={bubbles:true,cancelable:true,view:window,button:0,buttons,clientX:rect?.x||0,clientY:rect?.y||0};
   if(pointer)Object.assign(init,{pointerType:'mouse',isPrimary:true,pointerId:1});
   const C=pointer&&typeof PointerEvent==='function'?PointerEvent:(typeof MouseEvent==='function'?MouseEvent:Event);
   target.dispatchEvent(new C(type,init));return true;
  }catch{return false;}};
  let observer=null;
  try{
   const roots=sidebarRoots().filter(isVisible);sidebarMetrics.rootsFound=sidebarRoots().length;sidebarMetrics.visibleRoots=roots.length;
   const anchors=roots.flatMap(root=>[...(root.querySelectorAll?.('a[href]')||[])].filter(a=>isVisible(a)&&routeKind(a)==='conversation').map(anchor=>({root,anchor})));
   sidebarMetrics.visibleConversationRows=anchors.length;
   const first=anchors[0]||null;
   if(!first)reason='no_visible_conversation_row';
   else{
    let node=first.anchor.parentElement;
    const sidebarRect=rectOf(first.root);
    for(let level=1;node&&node!==first.root&&level<=6;level++,node=node.parentElement){
     levelsChecked=level;
     const conversationLinks=[...(node.querySelectorAll?.('a[href]')||[])].filter(link=>isVisible(link)&&routeKind(link)==='conversation').length+
      (String(node.tagName||'').toLowerCase()==='a'&&isVisible(node)&&routeKind(node)==='conversation'?1:0);
     const menuButtons=[...new Set([...(node.querySelectorAll?.('button[aria-haspopup="menu"]')||[])])].filter(button=>buttonLike(button)&&isVisible(button));
     const rect=rectOf(node),sidebarSized=!!sidebarRect&&!!rect&&rect.height>=sidebarRect.height*.8;
     ancestorSummary.push({level,conversationLinks,menuButtons:menuButtons.length,rect:rect?{width:rect.width,height:rect.height}:null,sidebarSized});
     if(conversationLinks>1||menuButtons.length>1){reason='ambiguous_ancestor_counts';break;}
     if(conversationLinks===1&&menuButtons.length===1&&!sidebarSized){row=node;trigger=menuButtons[0];triggerCount=1;break;}
    }
    if(!row&&reason==='completed')reason='matching_row_container_not_found';
    if(row&&trigger){
     const rect=rectOf(trigger),rowRect=rectOf(row);
     const triggerInside=!!row.contains?.(trigger),triggerNear=!!rect&&!!rowRect&&rect.x<=rowRect.x+rowRect.width+24&&rect.x+rect.width>=rowRect.x-24&&rect.y<=rowRect.y+rowRect.height+12&&rect.y+rect.height>=rowRect.y-12;
     triggerSummary={tag:String(trigger.tagName||'unknown').toLowerCase(),ariaHaspopup:trigger.getAttribute?.('aria-haspopup')||'unknown',width:rect?.width||0,height:rect?.height||0,insideRow:triggerInside,nearRow:triggerNear};
     rowSummary={conversationLinks:1,menuButtons:1,rect:rowRect?{width:rowRect.width,height:rowRect.height}:null};
     if(openPopupCandidates().length)reason='preexisting_popup_open';
     else if(triggerSummary.ariaHaspopup!=='menu'||!triggerSummary.insideRow||triggerSummary.width<14||triggerSummary.width>28||triggerSummary.height<14||triggerSummary.height>28||!triggerSummary.nearRow)reason='trigger_geometry_or_semantics_invalid';
     else{
      triggerStateBefore=state(trigger);baselineCounts=counts();
      try{if(typeof MutationObserver==='function'&&document.body){observer=new MutationObserver(collectMutations);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-expanded','data-state','aria-controls']});mutations.observerInstalled=true;}}catch{}
      sequenceStarted=true;
      pointerdownDelivered=dispatch(trigger,'pointerdown',true,1);
      const delivered=[pointerdownDelivered];
      triggerStateAfterPointerdown=state(trigger);afterPointerdownCounts=counts();
      delivered.push(dispatch(trigger,'mousedown',false,1),dispatch(trigger,'pointerup',true,0),dispatch(trigger,'mouseup',false,0),dispatch(trigger,'click',false,0));
      triggerStateAfterSequence=state(trigger);afterSequenceCounts=counts();
      eventSequenceDelivered=delivered.every(Boolean);
      try{observer?.takeRecords&&collectMutations(observer.takeRecords());observer?.disconnect();}catch{}
      if(!eventSequenceDelivered)reason='event_sequence_delivery_failed';
      await bounded(()=>openPopupCandidates().length>0,1500);
      menu=openPopupCandidates()[0]||null;menuOpened=!!menu;
      if(menu){menuLocation=row.contains?.(menu)?'row_subtree':(menu.hasAttribute?.('data-radix-popper-content-wrapper')||menu.hasAttribute?.('data-radix-menu-content')||menu.hasAttribute?.('popover')?'portal':'other_global');reason='menu_opened';
       const actionNodes=[...(menu.querySelectorAll?.('[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],button')||[])];actionClasses=actionNodes.map(safeActionClass);
      }else reason=Date.now()>=deadline?'hard_timeout':'menu_not_found';
     }
    }
   }
  }catch{reason=Date.now()>=deadline?'hard_timeout':'inspection_error';}
  finally{
   try{observer?.takeRecords&&collectMutations(observer.takeRecords());observer?.disconnect();}catch{}
   if(sequenceStarted){sendEscape();try{menuClosed=await bounded(()=>openPopupCandidates().length===0,1000);menuLeftOpen=!menuClosed;}catch{menuClosed=false;menuLeftOpen=true;}}
   else{menuLeftOpen=openPopupCandidates().length>0;menuClosed=!menuLeftOpen;}
  }
  if(menuOpened&&!menuClosed)menuLeftOpen=true;
  const pin=actionClasses.includes('pin'),unpin=actionClasses.includes('unpin');
  return {version:PINNED_DIAGNOSTIC_VERSION,sidebar:sidebarMetrics,rowFound:!!row,ancestorLevelsChecked:levelsChecked,ancestorSummary,
   rowContainer:rowSummary,trigger:triggerSummary,triggerFound:!!trigger,triggerCount,
   triggerStateBefore,triggerStateAfterPointerdown,triggerStateAfterSequence,baselineCounts,afterPointerdownCounts,afterSequenceCounts,mutations,
   clickDelivered:eventSequenceDelivered,pointerdownDelivered,menuOpened,menuClosed,menuLeftOpen,menuFound:menuOpened,menuLocation,
   menu:menu?{...popupKind(menu),actionCount:actionClasses.length,pinActionPresent:pin,unpinActionPresent:unpin,otherActionsCount:actionClasses.filter(kind=>kind==='other').length}:null,
   rowStatus:pin===unpin?'unknown':unpin?'pinned':'not pinned',cleanupSuccessful:menuClosed&&!menuLeftOpen,reason,elapsedMs:Math.min(Date.now()-started,9500)};
 };
 const findSidebarScroller=(root,anchor)=>{
  let node=anchor,nearest=null,level=0;
  while(node&&level<=12){
   let style={};try{style=getComputedStyle(node);}catch{}
   if(/auto|scroll|overlay/.test(String(style.overflowY||''))&&Number(node.scrollHeight)>Number(node.clientHeight)+2&&Number(node.clientHeight)>40){nearest=node;break;}
   if(node===root||node===document.body||node===document.documentElement)break;node=node.parentElement;level++;
  }
  return nearest;
 };
 const sidebarScrollNodeSummary=node=>{
  let style={},rect=null;try{style=getComputedStyle(node);rect=node.getBoundingClientRect?.();}catch{}
  const tag=String(node?.tagName||'unknown').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,16)||'unknown';
  const transform=String(style?.transform||'none');let transformKind='none',translateX=0,translateY=0;
  if(transform!=='none'){const match=transform.match(/^matrix\(([^)]+)\)$/);const values=match?.[1].split(',').map(Number);if(values?.length===6&&values.every(Number.isFinite)){transformKind='matrix';translateX=Math.round(values[4]);translateY=Math.round(values[5]);}else if(/^matrix3d\(/.test(transform)){transformKind='matrix3d';const values3=transform.match(/^matrix3d\(([^)]+)\)$/)?.[1].split(',').map(Number);if(values3?.length===16&&values3.every(Number.isFinite)){translateX=Math.round(values3[12]);translateY=Math.round(values3[13]);}}else transformKind='other';}
  return {tag,clientHeight:Math.round(Number(node?.clientHeight)||0),scrollHeight:Math.round(Number(node?.scrollHeight)||0),scrollTop:Math.round(Number(node?.scrollTop)||0),rect:rect?{x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)}:null,overflowY:String(style?.overflowY||'unknown').slice(0,12),position:String(style?.position||'unknown').slice(0,16),transform:transformKind,translateX,translateY,contain:String(style?.contain||'none').slice(0,40),connected:node?.isConnected!==false};
 };
 window.gptSampleSidebarScrollReadiness=(options={})=>{
  const token=typeof options.operationToken==='string'?options.operationToken:'diagnostic';let sidebar=null;try{sidebar=activeSidebarSnapshot();}catch{}
  const root=sidebar?.root||null,rows=[...(root?.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation'&&actuallyRendered(anchor)),rowIds=rows.map(conversationIdFromAnchor),validIds=rowIds.filter(id=>typeof id==='string'&&id.length>0),ids=new Set(validIds);
  const compactFingerprint=values=>{let hash=2166136261;const text=values.map(value=>value===null?'~missing~':String(value)).join('\u0000');for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16).padStart(8,'0');};
  const states=window.__gptSidebarScrollReadinessState||(window.__gptSidebarScrollReadinessState={}),prior=states[token],identitySet=[...ids].sort();
  const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>value===b[index]);
  const identitySetChanged=!!prior&&!same(prior.identitySet,identitySet),identityOrderChanged=!!prior&&!same(prior.identityOrder,rowIds),rootChanged=!!prior&&prior.root!==root;
  states[token]={identitySet,identityOrder:rowIds,root};
  const context=location.hostname==='chatgpt.com'?'chatgpt.com':'wrong_route_or_context';
  return {sidebarRootPresent:!!root,rowCount:rows.length,identityCount:ids.size,missingIdentityCount:rowIds.filter(id=>typeof id!=='string'||!id.length).length,duplicateIdentityCount:validIds.length-ids.size,identitySetFingerprint:compactFingerprint(identitySet),identityOrderFingerprint:compactFingerprint(rowIds),identitySetChanged,identityOrderChanged,rootChanged,context,routeTemplate:safePathTemplate(),sidebarVisible:sidebar?.visible===true};
 };
 window.gptClearSidebarScrollReadiness=(operationToken)=>{const states=window.__gptSidebarScrollReadinessState;if(states&&typeof operationToken==='string')delete states[operationToken];};
 window.gptInspectSidebarScrollMechanics=async(options={})=>{
  const started=Date.now(),initialPath=String(location.pathname||'/'),operationToken=typeof options.operationToken==='string'?options.operationToken:'diagnostic',stageTimings=[],readiness=options.readiness&&typeof options.readiness==='object'?options.readiness:null,partial={ancestorCount:0,candidateCount:0,probeAttempted:false,rootChain:[],rowChain:[],candidateSummaries:[],pollCount:Number(readiness?.pollCount)||0,firstPollTimestampMs:readiness?.firstPollTimestampMs??null,lastPollTimestampMs:readiness?.lastPollTimestampMs??null,readinessDurationMs:Number(readiness?.waitDurationMs)||0,firstPositiveCount:Number(readiness?.firstPositiveCount)||0,finalCount:Number(readiness?.finalCount)||0,identityCount:Number(readiness?.identityCount)||0,sidebarRootPresent:readiness?.sidebarRootPresent===true,context:readiness?.context||'unknown',nativeGuardFired:readiness?.nativeGuardFired===true};
  const emit=(stage,extra={})=>{const event={operationToken,sidebarScrollMechanicsStage:stage,elapsedMs:Date.now()-started,partial:{...partial}};try{window.webkit?.messageHandlers?.starredDiagnostic?.postMessage(event);}catch{}stageTimings.push({stage,elapsedMs:event.elapsedMs,...extra});};
  emit('bridge_entered');emit('readiness_completed',{readiness:readiness?.status||'missing_native_readiness'});
  if(!readiness||readiness.ready!==true){window.gptClearSidebarScrollReadiness?.(operationToken);return {status:'readiness_sample_required',terminalStatus:'probe_failed',readiness:readiness?.status||'missing_native_readiness',readinessReason:'native_readiness_required',rowCount:partial.finalCount,uniqueIdentityCount:partial.identityCount,sidebarRootPresent:partial.sidebarRootPresent,context:partial.context,ancestorCount:0,candidateCount:0,candidates:[],movement:{attempted:false,reason:'not_run'},stageTimings,lastCompletedStage:'readiness_completed',elapsedMs:Date.now()-started};}
  window.gptClearSidebarScrollReadiness?.(operationToken);
  const selection=activeSidebarSnapshot(),root=readiness.root||selection.root||null;
  const empty={status:'sidebar_root_missing',routeBefore:safePathTemplate(),routeAfter:safePathTemplate(),readiness:readiness.status||'unknown',rowCount:0,uniqueIdentityCount:0,rootChain:[],rowChain:[],ancestorCount:0,candidateCount:0,candidates:[],movement:{attempted:false,reason:'not_run'},virtualizedTransformEvidence:false,rowsAfterMovement:0,newIdentityCount:0,routeUnchanged:true,stageTimings,elapsedMs:Date.now()-started};
  if(!root||!readiness.ready){empty.status=readiness.status||(!root?'sidebar_root_missing':'rows_not_ready');empty.readiness=readiness.status||'rows_not_ready';empty.readinessReason=readiness.reason||empty.readiness;empty.readinessDurationMs=readiness.waitDurationMs||0;empty.pollCount=readiness.pollCount||0;empty.firstPollTimestampMs=readiness.firstPollTimestampMs??null;empty.lastPollTimestampMs=readiness.lastPollTimestampMs??null;empty.nativeGuardFired=readiness.nativeGuardFired===true;empty.firstPositiveCount=readiness.firstPositiveCount||0;empty.finalCount=readiness.finalCount||0;empty.identityCount=readiness.identityCount||0;empty.sidebarRootPresent=readiness.sidebarRootPresent===true;empty.context=readiness.context||'unknown';empty.routeBefore=safePathTemplate();empty.routeAfter=safePathTemplate();empty.routeUnchanged=location.pathname===initialPath;empty.rowCount=empty.finalCount;empty.uniqueIdentityCount=empty.identityCount;emit('result_ready');empty.terminalStatus=empty.status;empty.lastCompletedStage='result_ready';empty.stageTimings=stageTimings;return empty;}
  const links=()=>[...(root.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation'&&actuallyRendered(anchor));
  const initialLinks=links(),anchor=initialLinks.find(item=>isVisible(item))||initialLinks[0]||null;
  if(!anchor){emit('result_ready');return {...empty,status:'conversation_rows_missing',terminalStatus:'no_candidate',lastCompletedStage:'result_ready',stageTimings,rowCount:0,elapsedMs:Date.now()-started};}
  const chain=(start,limit=16)=>{const out=[],seen=new Set();let node=start;while(node&&out.length<limit&&!seen.has(node)){seen.add(node);out.push(node);if(node===document.body||node===document.documentElement)break;node=node.parentElement;}return out;};
  const rootNodes=chain(root),rowNodes=chain(anchor);
  const scrollingElement=document.scrollingElement||document.documentElement||document.body;
  const candidateEntries=collectSidebarScrollCandidates(root,anchor).map(node=>({node,summary:sidebarScrollNodeSummary(node),withinRoot:containsNode(root,node),containsRoot:containsNode(node,root),containsRow:containsNode(node,anchor),window:node===scrollingElement}));
  const rootChain=rootNodes.map(sidebarScrollNodeSummary),rowChain=rowNodes.map(sidebarScrollNodeSummary),virtualizedTransformEvidence=[...new Set([...rootNodes,...rowNodes])].some(node=>sidebarScrollNodeSummary(node).transform!=='none');
  partial.rootChain=rootChain;partial.rowChain=rowChain;
  partial.ancestorCount=rootChain.length+rowChain.length;
  partial.candidateCount=candidateEntries.length;partial.candidateSummaries=candidateEntries.map(({summary,withinRoot,containsRoot,containsRow,window:isWindow})=>({...summary,withinRoot,containsRoot,containsRow,kind:isWindow?'document':'element'}));
  emit('ancestor_snapshot_completed');emit('candidate_analysis_completed');
  const beforeIds=new Set(initialLinks.map(conversationIdFromAnchor).filter(id=>typeof id==='string')),routeBefore=safePathTemplate(),windowBefore=Math.round(Number(window.scrollY??window.pageYOffset)||0),docBefore=Math.round(Number(scrollingElement?.scrollTop)||0);
  const movement={attempted:false,reason:candidateEntries.length===0?'scroll_mechanism_not_found':candidateEntries.length>1?'multiple_scroll_candidates':'not_run',candidateType:'none',beforeScrollTop:null,afterScrollTop:null,delta:0,windowYBefore:windowBefore,windowYAfter:windowBefore,documentTopBefore:docBefore,documentTopAfter:docBefore,rowCountBefore:initialLinks.length,rowCountAfter:initialLinks.length,uniqueIdentityCountBefore:beforeIds.size,uniqueIdentityCountAfter:beforeIds.size,newIdentityCount:0,geometryChanged:false,restored:true};
  if(candidateEntries.length===1){
   const entry=candidateEntries[0],node=entry.node,oldTop=Math.round(Number(node.scrollTop)||0),maxTop=Math.max(0,(Number(node.scrollHeight)||0)-(Number(node.clientHeight)||0)),delta=oldTop<maxTop?1:(oldTop>0?-1:0);
   movement.attempted=delta!==0;movement.reason=delta!==0?'unique_scroll_owner_probe':'unique_owner_at_fixed_extent';movement.candidateType=entry.window?'document':'element_scrollTop';movement.beforeScrollTop=oldTop;movement.windowYBefore=windowBefore;movement.documentTopBefore=docBefore;movement.rowCountBefore=initialLinks.length;movement.uniqueIdentityCountBefore=beforeIds.size;
   const beforeRect=rectOf(anchor),anchorId=conversationIdFromAnchor(anchor);if(delta!==0){partial.probeAttempted=true;emit('probe_started');try{node.scrollTop=oldTop+delta;void node.getBoundingClientRect?.();void anchor.getBoundingClientRect?.();void document.documentElement?.getBoundingClientRect?.();}catch{movement.reason='scroll_assignment_failed';}}
   const movedTop=Math.round(Number(node.scrollTop)||0),afterLinks=links(),afterIds=new Set(afterLinks.map(conversationIdFromAnchor).filter(id=>typeof id==='string')),afterRect=afterLinks.find(item=>conversationIdFromAnchor(item)===anchorId)||afterLinks[0]||null,afterRectValue=afterRect?rectOf(afterRect):null;
   movement.afterScrollTop=movedTop;movement.delta=movedTop-oldTop;movement.windowYAfter=Math.round(Number(window.scrollY??window.pageYOffset)||0);movement.documentTopAfter=Math.round(Number(scrollingElement?.scrollTop)||0);movement.rowCountAfter=afterLinks.length;movement.uniqueIdentityCountAfter=afterIds.size;movement.newIdentityCount=[...afterIds].filter(id=>!beforeIds.has(id)).length;movement.geometryChanged=!!beforeRect&&!!afterRectValue&&(Math.abs(beforeRect.y-afterRectValue.y)>0.5||Math.abs(beforeRect.x-afterRectValue.x)>0.5);
   movement.rowElementReplaced=!!afterRect&&afterRect!==anchor;
   try{node.scrollTop=oldTop;void node.getBoundingClientRect?.();void document.documentElement?.getBoundingClientRect?.();}catch{movement.reason='scroll_restore_failed';}
   movement.restored=Math.abs((Number(node.scrollTop)||0)-oldTop)<=1;
   if(movement.attempted&&movement.delta===0&&movement.reason==='unique_scroll_owner_probe')movement.reason='scroll_did_not_move';
   emit('probe_completed',{movementReason:movement.reason,restored:movement.restored});
  }
  const routeAfter=safePathTemplate(),finalLinks=links(),finalIds=new Set(finalLinks.map(conversationIdFromAnchor).filter(id=>typeof id==='string'));
  const result={status:movement.attempted&&movement.delta!==0?'movement_observed':candidateEntries.length===1?'mechanism_found_no_movement':candidateEntries.length>1?'multiple_scroll_candidates':'scroll_mechanism_not_found',readiness:readiness.status,readinessReason:readiness.reason,readinessDurationMs:readiness.waitDurationMs,pollCount:readiness.pollCount,firstPollTimestampMs:readiness.firstPollTimestampMs??null,lastPollTimestampMs:readiness.lastPollTimestampMs??null,nativeGuardFired:readiness.nativeGuardFired===true,firstPositiveCount:readiness.firstPositiveCount,finalCount:readiness.finalCount,identityCount:readiness.identityCount,sidebarRootPresent:readiness.sidebarRootPresent,context:readiness.context,routeBefore,routeAfter,routeUnchanged:location.pathname===initialPath,rowCount:initialLinks.length,uniqueIdentityCount:beforeIds.size,rootChain,rowChain,ancestorCount:partial.ancestorCount,candidateCount:candidateEntries.length,candidates:candidateEntries.map(({summary,withinRoot,containsRoot,containsRow,window:isWindow})=>({...summary,withinRoot,containsRoot,containsRow,kind:isWindow?'document':'element'})),movement:{...movement,rowCountAfter:finalLinks.length,uniqueIdentityCountAfter:finalIds.size,newIdentityCount:[...finalIds].filter(id=>!beforeIds.has(id)).length},virtualizedTransformEvidence,virtualizedRowReplacementObserved:movement.rowElementReplaced===true,elapsedMs:Date.now()-started};
  result.nativeReadinessSamples=Array.isArray(readiness.samples)?readiness.samples:[];result.nativePollTelemetry={scheduledCount:readiness.scheduledCount||0,startedCount:readiness.startedCount||0,evaluateCalledCount:readiness.evaluateCalledCount||0,callbackCount:readiness.callbackCount||0,parsedCount:readiness.parsedCount||0,inFlight:readiness.inFlight===true,lastCompletedPollIndex:readiness.lastCompletedPollIndex||0,maxCallbackLatencyMs:readiness.maxCallbackLatencyMs||0,maxEventGapMs:readiness.maxEventGapMs||0,maxEventGapFrom:readiness.maxEventGapFrom||'none',maxEventGapTo:readiness.maxEventGapTo||'none',timeline:Array.isArray(readiness.nativePollTimeline)?readiness.nativePollTimeline:[]};result.requiredStableSamples=Number(readiness.requiredStableSamples)||4;result.requiredStableDurationMs=Number(readiness.requiredStableDurationMs)||320;result.stablePolls=Number(readiness.stablePolls)||0;result.stableElapsedMs=Number(readiness.stableElapsedMs)||0;result.stableCountCondition=readiness.stableCountCondition===true;result.stableDurationCondition=readiness.stableDurationCondition===true;result.stableSnapshotAccepted=readiness.stableSnapshotAccepted===true;result.phaseABudgetMs=Number(readiness.phaseABudgetMs)||4000;result.stabilizationGraceMs=Number(readiness.stabilizationGraceMs)||1200;result.absoluteReadinessCapMs=Number(readiness.absoluteReadinessCapMs)||6000;result.firstPositiveTimestampMs=readiness.firstPositiveTimestampMs??null;result.lastSemanticChangeTimestampMs=readiness.lastSemanticChangeTimestampMs??null;result.extensionActivated=readiness.extensionActivated===true;result.phaseABudgetMs=Number(readiness.phaseABudgetMs)||4000;result.stabilizationGraceMs=Number(readiness.stabilizationGraceMs)||1200;result.absoluteReadinessCapMs=Number(readiness.absoluteReadinessCapMs)||6000;result.firstPositiveTimestampMs=readiness.firstPositiveTimestampMs??null;result.lastSemanticChangeTimestampMs=readiness.lastSemanticChangeTimestampMs??null;result.extensionActivated=readiness.extensionActivated===true;
  emit('result_serialization_completed');result.terminalStatus=result.status==='movement_observed'||result.status==='mechanism_found_no_movement'?'success':candidateEntries.length===0?'no_candidate':candidateEntries.length>1?'multiple_candidates':result.status;result.lastCompletedStage='result_serialization_completed';result.stageTimings=stageTimings;return result;
 };
 const intersects=(a,b)=>!!a&&!!b&&a.width>0&&a.height>0&&a.right>b.left&&a.left<b.right&&a.bottom>b.top&&a.top<b.bottom;
 const containsNode=(container,node)=>{if(!container||!node)return false;if(container===node)return true;try{if(typeof container.contains==='function')return container.contains(node);}catch{}let current=node,depth=0;while(current&&depth++<32){if(current===container)return true;current=current.parentElement;}return false;};
 const inspectConversationListTopState=async(inputRoot,{normalizeFirstRow=false}={})=>{
  const tolerance=2,viewportWidth=Number(window.innerWidth)||Number(document.documentElement?.clientWidth)||1024,viewportHeight=Number(window.innerHeight)||Number(document.documentElement?.clientHeight)||768;
  let root=activeSidebarSnapshot().root||inputRoot||null;
  const scrollValue=node=>{const value=Number(node?.scrollTop);return Number.isFinite(value)?Math.round(value):0;};
  const viewportBounds=(context,scroll)=>{const cr=(scroll||context)?.getBoundingClientRect?.(),rr=context?.getBoundingClientRect?.();return {
   top:Math.max(0,Number(cr?.top)||0,Number(rr?.top)||0),bottom:Math.min(viewportHeight,Number(cr?.bottom)||viewportHeight,Number(rr?.bottom)||viewportHeight)};};
  const scrollWindowState=()=>({windowY:Math.round(Number(window.scrollY??window.pageYOffset)||0),documentTop:Math.round(Number(document.documentElement?.scrollTop)||0),bodyTop:Math.round(Number(document.body?.scrollTop)||0)});
  const normalization={invoked:false,firstRowGeometryBefore:null,firstRowGeometryAfter:null,totalRowsBefore:0,visibleRowsBefore:0,rowsBeforeFirstVisible:0,
   totalRowsAfter:0,visibleRowsAfter:0,rowsBeforeFirstVisibleAfter:0,viewportTopBefore:null,viewportBottomBefore:null,viewportTopAfter:null,viewportBottomAfter:null,
   windowScrollChanged:false,documentScrollChanged:false,bodyScrollChanged:false,changedScrollAncestors:0,firstRowGeometryChanged:false,firstRowVisibleAfter:false,
   activeContextChanged:false,reason:'not_needed',scrollStateBefore:null,scrollStateAfter:null};
  const initialLinks=[...(root?.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation'&&actuallyRendered(anchor));
  const firstDOMRow=initialLinks[0]||null,initialVisible=visibleConversationRows(root,null),initialFirstVisible=initialVisible[0]||null;
  const initialScroller=firstDOMRow?findSidebarScroller(root,firstDOMRow):null;
  const initialScrollTop=initialScroller?scrollValue(initialScroller):0;
  const needsNormalization=normalizeFirstRow&&!!firstDOMRow&&(!initialVisible.includes(firstDOMRow)||initialFirstVisible!==firstDOMRow||initialScrollTop>tolerance);
  let normalizationFailure=false;
  if(needsNormalization){
   normalization.invoked=true;normalization.reason='first_row_scroll_normalization_failed';
   normalization.totalRowsBefore=initialLinks.length;normalization.visibleRowsBefore=initialVisible.length;
   normalization.rowsBeforeFirstVisible=initialFirstVisible?Math.max(0,initialLinks.indexOf(initialFirstVisible)):initialLinks.length;
   normalization.firstRowGeometryBefore=rectOf(firstDOMRow);normalization.scrollStateBefore=scrollWindowState();
   const beforeBounds=viewportBounds(root,initialScroller);normalization.viewportTopBefore=Math.round(beforeBounds.top);normalization.viewportBottomBefore=Math.round(beforeBounds.bottom);
   const ancestorScrolls=[];let ancestor=firstDOMRow,ancestorDepth=0;
   while(ancestor&&ancestorDepth++<16){ancestorScrolls.push({node:ancestor,top:scrollValue(ancestor)});if(ancestor===root)break;ancestor=ancestor.parentElement;}
   const expectedFirstKey=`${routeType(firstDOMRow)||'unknown'}:${conversationIdFromAnchor(firstDOMRow)||'missing'}`;
   try{
    if(typeof firstDOMRow.scrollIntoView!=='function')throw new Error('unsupported');
    firstDOMRow.scrollIntoView({block:'start',inline:'nearest',behavior:'auto'});
    if(typeof window.requestAnimationFrame==='function')await waitForFramesBounded(2,400);else await new Promise(resolve=>setTimeout(resolve,40));
    let previous='',stable=0;const deadline=Date.now()+900;let selectionAfter=null,afterLinks=[],afterFirst=null;
    while(Date.now()<deadline&&stable<3){
     selectionAfter=activeSidebarSnapshot();const candidateRoot=selectionAfter.root;
     if(candidateRoot)root=candidateRoot;
     afterLinks=[...(root?.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation'&&actuallyRendered(anchor));
     afterFirst=afterLinks[0]||null;
     const rect=rectOf(afterFirst),signature=`${routeType(afterFirst)||'unknown'}:${conversationIdFromAnchor(afterFirst)||'missing'}:${rect?.x}:${rect?.y}:${rect?.width}:${rect?.height}:${afterLinks.length}`;
     if(signature===previous)stable++;else stable=0;previous=signature;
     if(stable<3)await new Promise(resolve=>setTimeout(resolve,50));
    }
    selectionAfter=activeSidebarSnapshot();if(selectionAfter.root)root=selectionAfter.root;
    afterLinks=[...(root?.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation'&&actuallyRendered(anchor));
    afterFirst=afterLinks[0]||null;
    const afterScroller=afterFirst?findSidebarScroller(root,afterFirst):null,afterVisible=visibleConversationRows(root,afterScroller),afterFirstVisible=afterFirst&&afterVisible.includes(afterFirst);
    const afterBounds=viewportBounds(root,afterScroller),afterRect=rectOf(afterFirst),afterScrollState=scrollWindowState();
    normalization.firstRowGeometryAfter=afterRect;normalization.totalRowsAfter=afterLinks.length;normalization.visibleRowsAfter=afterVisible.length;
    normalization.rowsBeforeFirstVisibleAfter=afterVisible[0]?Math.max(0,afterLinks.indexOf(afterVisible[0])):afterLinks.length;
    normalization.viewportTopAfter=Math.round(afterBounds.top);normalization.viewportBottomAfter=Math.round(afterBounds.bottom);
    normalization.scrollStateAfter=afterScrollState;normalization.windowScrollChanged=normalization.scrollStateBefore.windowY!==afterScrollState.windowY;
    normalization.documentScrollChanged=normalization.scrollStateBefore.documentTop!==afterScrollState.documentTop;
    normalization.bodyScrollChanged=normalization.scrollStateBefore.bodyTop!==afterScrollState.bodyTop;
    normalization.changedScrollAncestors=ancestorScrolls.filter(item=>scrollValue(item.node)!==item.top).length;
    normalization.firstRowGeometryChanged=JSON.stringify(normalization.firstRowGeometryBefore)!==JSON.stringify(afterRect);
    normalization.firstRowVisibleAfter=!!afterFirstVisible;
    const afterKey=afterFirst?`${routeType(afterFirst)||'unknown'}:${conversationIdFromAnchor(afterFirst)||'missing'}`:'missing';
    normalization.activeContextChanged=!root||afterLinks.length===0||afterKey!==expectedFirstKey;
    if(normalization.activeContextChanged){normalization.reason='active_context_changed_after_scroll';normalizationFailure=true;}
    else if(!normalization.firstRowVisibleAfter){normalization.reason='first_row_scroll_normalization_failed';normalizationFailure=true;}
    else normalization.reason='normalized';
   }catch{normalization.reason='first_row_scroll_normalization_failed';normalizationFailure=true;}
  }
  const candidateLinks=[...(root?.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation');
  const rootVisible=visibleConversationRows(root,null),scrollerGroups=new Map();
  for(const anchor of rootVisible){const candidate=findSidebarScroller(root,anchor);if(candidate)scrollerGroups.set(candidate,(scrollerGroups.get(candidate)||0)+1);}
  const selectedScroller=[...scrollerGroups.entries()].sort((a,b)=>b[1]-a[1]||
   ((Number(a[0].clientHeight)||0)*(Number(a[0].clientWidth)||0))-((Number(b[0].clientHeight)||0)*(Number(b[0].clientWidth)||0)))[0]?.[0]||null;
  const activeContext=selectedScroller||root;
  let links=candidateLinks.filter(anchor=>containsNode(activeContext,anchor)&&actuallyRendered(anchor));
  const rowsOutsideActiveContext=candidateLinks.filter(anchor=>actuallyRendered(anchor)&&!containsNode(activeContext,anchor)).length;
  const inactiveRowsExcluded=candidateLinks.filter(anchor=>!actuallyRendered(anchor)).length;
  let scroller=selectedScroller,visible=visibleConversationRows(activeContext,scroller),first=visible[0]||null,index=first?links.indexOf(first):-1;
  let scrollTopBefore=scroller?Math.round(Number(scroller.scrollTop)||0):null,scrollTopAfter=null,node=first,levels=0,transformPresent=false,transformOffset=false,spacerPresent=false,spacerBefore=false,indexAttributesPresent=false,positiveRowIndex=false;
  const number=value=>{const m=String(value??'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null;};
  const ancestry=[];
  while(node&&levels<8){
   let style={};try{style=getComputedStyle(node);}catch{}
   const oy=String(style.overflowY||'unknown'),ch=Number(node.clientHeight)||0,sh=Number(node.scrollHeight)||0,st=Number(node.scrollTop)||0;
   const canScroll=/^(auto|scroll|overlay)$/.test(oy)&&sh>ch+tolerance&&ch>0;
   if(canScroll&&!scroller){scroller=node;scrollTopBefore=Math.round(st);}
   const r=rectOf(node);ancestry.push({level:levels+1,tag:String(node.tagName||'unknown').toLowerCase().slice(0,12),clientHeight:ch,scrollHeight:sh,scrollTop:Math.round(st),overflowY:oy.slice(0,12),rectHeight:Math.round(r?.height||0),canScroll});
   const transform=String(style.transform||'none');if(transform!=='none'){
    transformPresent=true;
    const m2=transform.match(/^matrix\(([^)]+)\)$/),m3=transform.match(/^matrix3d\(([^)]+)\)$/);let y=0;
    if(m2)y=Number(m2[1].split(',')[5])||0;else if(m3)y=Number(m3[1].split(',')[13])||0;else y=number(transform.match(/translateY\(([^)]+)\)/)?.[1])||number(transform.match(/translate3d\([^,]+,\s*([^,]+)/)?.[1])||0;
    if(Math.abs(y)>tolerance)transformOffset=true;
   }
   for(const attr of [...(node.attributes||[])]){
    const name=String(attr.name||'').toLowerCase(),value=String(attr.value||'');
    if(/(spacer|virtual|sentinel)/.test(name))spacerPresent=true;
    if((/(spacer|sentinel)/.test(name)||(/virtual/.test(name)&&!/index/.test(name)))&&node!==first)spacerBefore=true;
    if(/(^data-(index|virtual-index|row-index)$|^aria-posinset$)/.test(name)){indexAttributesPresent=true;if((number(value)||0)>0)positiveRowIndex=true;}
   }
   const parent=node.parentElement;if(parent){for(const sibling of [...(parent.children||[])]){if(sibling===node)break;const names=[...(sibling.attributes||[])].map(attr=>String(attr.name||'').toLowerCase());if(names.some(name=>/(spacer|virtual|sentinel)/.test(name)))spacerBefore=true;}}
   if(String(style.position||'')==='absolute'&&Math.abs(number(style.top)||0)>tolerance)transformOffset=true;
   if(node===root)break;node=node.parentElement;levels++;
  }
  if(scroller)scrollTopAfter=Math.round(Number(scroller.scrollTop)||0);
  const prior=first&&index>0?links.slice(0,index):[],hiddenRowsBefore=prior.filter(anchor=>!visibleConversationRows(activeContext,scroller).includes(anchor)).length;
  const contextRect=(scroller||activeContext)?.getBoundingClientRect?.(),rootRect=root?.getBoundingClientRect?.();
  const viewportTop=Math.max(0,Number(contextRect?.top)||0,Number(rootRect?.top)||0),viewportBottom=Math.min(viewportHeight,Number(contextRect?.bottom)||viewportHeight,Number(rootRect?.bottom)||viewportHeight);
  const rowFlags=prior.map(anchor=>{
   const r=anchor.getBoundingClientRect?.(),style=getComputedStyle(anchor),ariaHidden=(()=>{let n=anchor;while(n){if(n.getAttribute?.('aria-hidden')==='true')return true;if(n===activeContext||n===root)break;n=n.parentElement;}return false;})();
   const displayNone=style.display==='none',visibilityHidden=style.visibility==='hidden',zeroSize=!r||r.width<=0||r.height<=0;
   const fullyAbove=!!r&&r.height>0&&r.bottom<=viewportTop,intersectsViewport=!!r&&r.width>0&&r.height>0&&r.right>0&&r.left<viewportWidth&&r.bottom>viewportTop&&r.top<viewportBottom;
   let sameScrollContainer=!!scroller&&containsNode(scroller,anchor),positiveIndex=false,translated=false,spacer=false,walk=anchor,steps=0;
   while(walk&&steps++<12){const attrs=[...(walk.attributes||[])];for(const attr of attrs){const name=String(attr.name||'').toLowerCase(),value=Number(String(attr.value||'').match(/-?\d+(?:\.\d+)?/)?.[0]||0);if(/(^data-(index|virtual-index|row-index)$|^aria-posinset$)/.test(name)&&value>0)positiveIndex=true;if(/(spacer|virtual|sentinel)/.test(name))spacer=true;}
    let ancestorStyle={};try{ancestorStyle=getComputedStyle(walk);}catch{}if(ancestorStyle.transform&&ancestorStyle.transform!=='none')translated=true;
    if(walk===scroller||walk===activeContext||walk===root)break;walk=walk.parentElement;
   }
   if(positiveIndex)positiveRowIndex=true;if(translated)transformPresent=true;if(spacer)spacerPresent=true;
   return {fullyAbove,intersectsViewport,displayNone,visibilityHidden,ariaHidden,zeroSize,sameScrollContainer,activeSidebarCandidate:containsNode(root,anchor),positiveIndex,translated,spacer,aboveDeltaPx:fullyAbove?Math.max(0,Math.round(viewportTop-r.bottom)):0};
  });
  const countFlag=key=>rowFlags.filter(row=>row[key]).length;
  const precedingGeometry={count:prior.length,fullyAboveViewport:countFlag('fullyAbove'),intersectsViewport:countFlag('intersectsViewport'),displayNone:countFlag('displayNone'),visibilityHidden:countFlag('visibilityHidden'),ariaHidden:countFlag('ariaHidden'),zeroSize:countFlag('zeroSize'),sameScrollContainer:countFlag('sameScrollContainer'),activeSidebarCandidate:countFlag('activeSidebarCandidate'),maxAboveViewportDeltaPx:Math.max(0,...rowFlags.map(row=>row.aboveDeltaPx)),positiveVirtualIndex:countFlag('positiveIndex'),transformed:countFlag('translated'),spacerEvidence:countFlag('spacer')};
  const virtualization={transformPresent,transformOffset,spacerPresent,spacerBefore,indexAttributesPresent,positiveRowIndex,largeVirtualHeight:false,detected:transformOffset||spacerBefore||positiveRowIndex||precedingGeometry.positiveVirtualIndex>0||precedingGeometry.transformed>0||precedingGeometry.spacerEvidence>0};
  const atOrigin=!!scroller&&scrollTopAfter!==null&&scrollTopAfter<=tolerance;
  const reason=!root?'no_list_root':!links.length?'no_conversation_rows':normalizationFailure?normalization.reason:!first?'no_visible_conversation_row':index!==0?(atOrigin&&precedingGeometry.fullyAboveViewport>0?'preceding_row_above_viewport_at_scroll_origin':virtualization.detected?'virtualized_preceding_rows':'conversation_rows_before_first_visible'):virtualization.detected?'virtualized_position_unproven':'top_proven';
  return {status:reason==='top_proven'?'top_proven':'top_unproven',proven:reason==='top_proven',reason,totalConversationLinks:links.length,visibleConversationLinks:visible.length,
   firstVisibleIndex:index,conversationRowsBefore:Math.max(0,index),hiddenRowsBefore,scrollableAncestorFound:!!scroller,scrollTop:scrollTopAfter,scrollTopBefore,scrollTopAfter,
   activeContextType:scroller?'scroll_container':'active_sidebar',rowsOutsideActiveContext,inactiveRowsExcluded,viewportTop,viewportBottom,precedingGeometry,
   virtualOffsetEvidence:virtualization.detected,virtualization,normalization,links,visible,first,index,scroller,levels,scrollAncestry:ancestry};
 };
 const failedConversationListTopState=(reason,readiness)=>({status:'top_unproven',proven:false,reason,totalConversationLinks:readiness?.rowsAtStabilizedSnapshot||0,visibleConversationLinks:0,firstVisibleIndex:-1,conversationRowsBefore:0,hiddenRowsBefore:0,scrollableAncestorFound:false,scrollTop:null,scrollTopBefore:null,scrollTopAfter:null,virtualOffsetEvidence:false,virtualization:{transformPresent:false,transformOffset:false,spacerPresent:false,spacerBefore:false,indexAttributesPresent:false,positiveRowIndex:false,largeVirtualHeight:false,detected:false},links:[],visible:[],first:null,index:-1,scroller:null,levels:0,scrollAncestry:[]});
 window.gptInspectConversationListTopState=async root=>{const top=await inspectConversationListTopState(root||activeSidebarSnapshot().root,{normalizeFirstRow:true});return {status:top.status,reason:top.reason,totalConversationLinks:top.totalConversationLinks,visibleConversationLinks:top.visibleConversationLinks,firstVisibleIndex:top.firstVisibleIndex,conversationRowsBefore:top.conversationRowsBefore,hiddenRowsBefore:top.hiddenRowsBefore,scrollableAncestorFound:top.scrollableAncestorFound,scrollTop:top.scrollTop,viewportTop:top.viewportTop,viewportBottom:top.viewportBottom,activeContextType:top.activeContextType,rowsOutsideActiveContext:top.rowsOutsideActiveContext,inactiveRowsExcluded:top.inactiveRowsExcluded,precedingGeometry:top.precedingGeometry,normalization:top.normalization,virtualOffsetEvidence:top.virtualOffsetEvidence,virtualization:top.virtualization};};
 let rootSidebarPreviousOrder=null;
 const inspectRenderedRootSidebarMetadata=()=>{
  const selection=activeSidebarSnapshot(),root=selection.root;
  if(!root)return {activeSidebarFound:false,renderedRows:0,visibleRows:0,domOrderStable:false,topProofPossible:false,
   exactActivityMetadataAvailable:false,timestampFields:[],timeElementRows:0,datetimeRows:0,numericEpochRows:0,dataTimestampAttributeNames:[],
   sectionGroups:[],pinnedStarred:{available:false,rowsWithPositiveMarker:0,rowsWithNegativeMarker:0,fieldNames:[]},
   archived:{available:false,rowsWithPositiveMarker:0,rowsWithNegativeMarker:0,fieldNames:[]},
   locked:{available:false,rowsWithPositiveMarker:0,rowsWithNegativeMarker:0,fieldNames:[]},
   orderIndexAttributeNames:[],rowsWithOrderIndex:0,firstVisibleIndex:null,rowsBeforeFirstVisible:0,virtualOffsetEvidence:false,
   rowsWithInternalIdentity:0,rowsWithoutInternalIdentity:0,scrollGeometry:null,endOfListProof:'unavailable'};
  const links=[...(root.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation'&&actuallyRendered(anchor));
  const rows=links.map(anchor=>({anchor,row:rowForAnchor(anchor,root)}));
  const rowsWithInternalIdentity=rows.filter(item=>typeof conversationIdFromAnchor(item.anchor)==='string').length;
  const visible=rows.filter(item=>viewportVisibleInSidebar(item.anchor,root,null));
  const scrollerVotes=new Map();for(const item of visible){const candidate=findSidebarScroller(root,item.anchor);if(candidate)scrollerVotes.set(candidate,(scrollerVotes.get(candidate)||0)+1);}
  const scroller=[...scrollerVotes.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  const firstVisibleIndex=visible.length?rows.findIndex(item=>item.anchor===visible[0].anchor):-1;
  const attrName=/^[a-z][a-z0-9_-]{0,63}$/;
  const timestampName=/(^datetime$|time|date|timestamp|activity|updated|created|epoch)/i;
  const activityName=/(update_time|updated_at|last_activity|activity_time|activity_at|last_message_(time|at)|latest_message_(time|at))/i;
  const parseTimestamp=value=>{
   const text=String(value??'').trim();let milliseconds=null,type=null;
   if(/^\d{9,16}(?:\.\d+)?$/.test(text)){const numeric=Number(text);if(Number.isFinite(numeric)&&numeric>0){milliseconds=numeric<1e12?numeric*1000:numeric;type=numeric<1e12?'numeric_epoch_seconds':'numeric_epoch_milliseconds';}}
   else if(/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(text)){const parsed=Date.parse(text);if(Number.isFinite(parsed)&&parsed>0){milliseconds=parsed;type=text.includes('T')?'iso_datetime':'date';}}
   if(milliseconds===null)return null;
   try{return {value:new Date(milliseconds).toISOString(),type};}catch{return null;}
  };
  const fieldRows=new Map(),dataTimestampNames=new Set(),orderNames=new Set();
  const flagStats={pinnedStarred:{rowsWithPositiveMarker:0,rowsWithNegativeMarker:0,fieldNames:new Set()},archived:{rowsWithPositiveMarker:0,rowsWithNegativeMarker:0,fieldNames:new Set()},locked:{rowsWithPositiveMarker:0,rowsWithNegativeMarker:0,fieldNames:new Set()}};
  let timeElementRows=0,datetimeRows=0,numericEpochRows=0,rowsWithOrderIndex=0,virtualOffsetEvidence=false;
  const groups=new Map();
  for(const item of rows){
   const nodes=[item.row,item.anchor,...(item.row?.querySelectorAll?.('*')||[])].filter(Boolean).slice(0,80),rowFields=new Map(),rowDataNames=new Set(),rowOrderNames=new Set();
   let hasTime=false,hasDatetime=false,hasNumericEpoch=false,hasOrderIndex=false;
   for(const node of nodes){
    const tag=String(node.tagName||'').toLowerCase();
    if(tag==='time'){hasTime=true;const value=node.getAttribute?.('datetime')??node.dateTime;
     if(value!==undefined&&value!==null&&String(value)!==''){hasDatetime=true;const parsed=parseTimestamp(value);if(parsed){const field='time[datetime]';rowFields.set(field,parsed);}}
    }
    for(const attribute of [...(node.attributes||[])]){
     const name=String(attribute.name||'').toLowerCase();if(!attrName.test(name))continue;
     const value=String(attribute.value??'');
     if(name==='datetime'){hasDatetime=true;const parsed=parseTimestamp(value);if(parsed)rowFields.set('datetime',parsed);}
     if(name.startsWith('data-')&&timestampName.test(name)){rowDataNames.add(name);dataTimestampNames.add(name);}
     if(timestampName.test(name)){const parsed=parseTimestamp(value);if(parsed){rowFields.set(name,parsed);if(parsed.type.startsWith('numeric_epoch'))hasNumericEpoch=true;}}
     if(/^(data-index|data-row-index|data-virtual-index|aria-posinset|aria-setsize)$/.test(name)){
      rowOrderNames.add(name);orderNames.add(name);const numeric=Number(value);if(value!==''&&Number.isFinite(numeric)){hasOrderIndex=true;if(/(index|posinset)/.test(name)&&numeric>0)virtualOffsetEvidence=true;}
     }
     const flagKey=/(pinned|starred|favorite|favourite)/i.test(name)?'pinnedStarred':(/archived/i.test(name)?'archived':(/locked|lock_state/i.test(name)?'locked':null));
     if(flagKey){flagStats[flagKey].fieldNames.add(name);let flags=flagStats[flagKey].rowFlags;if(!flags){flags=new Set();flagStats[flagKey].rowFlags=flags;}
      if(/^(true|1|yes)$/i.test(value))flags.add(true);else if(/^(false|0|no)$/i.test(value))flags.add(false);else flags.add(null);
     }
    }
    if(tag==='time'&&Number.isFinite(Number(node.valueAsNumber))&&Number(node.valueAsNumber)>0){hasNumericEpoch=true;const parsed=parseTimestamp(node.valueAsNumber);if(parsed)rowFields.set('time.valueAsNumber',parsed);}
    let classText='';try{classText=typeof node.className==='string'?node.className:String(node.className?.baseVal||'');}catch{}
    if(/(^|[\s_-])(pinned|starred|favorite|favourite)([\s_-]|$)/i.test(classText)){flagStats.pinnedStarred.fieldNames.add('rendered_class_marker');let flags=flagStats.pinnedStarred.rowFlags;if(!flags)flags=new Set();flags.add(true);flagStats.pinnedStarred.rowFlags=flags;}
    if(/(^|[\s_-])archived([\s_-]|$)/i.test(classText)){flagStats.archived.fieldNames.add('rendered_class_marker');let flags=flagStats.archived.rowFlags;if(!flags)flags=new Set();flags.add(true);flagStats.archived.rowFlags=flags;}
    if(/(^|[\s_-])locked([\s_-]|$)/i.test(classText)){flagStats.locked.fieldNames.add('rendered_class_marker');let flags=flagStats.locked.rowFlags;if(!flags)flags=new Set();flags.add(true);flagStats.locked.rowFlags=flags;}
   for(const [field,value] of rowFields){const entry=fieldRows.get(field)||{type:value.type,rows:new Set(),values:new Set(),activityRelevant:activityName.test(field.replace(/-/g,'_'))};entry.rows.add(item.anchor);entry.values.add(value.value);fieldRows.set(field,entry);}
   }
   let ancestor=item.anchor,depth=0;while(ancestor&&depth++<16){let style={};try{style=getComputedStyle(ancestor);}catch{}if(style.transform&&style.transform!=='none')virtualOffsetEvidence=true;
    for(const attribute of [...(ancestor.attributes||[])]){const name=String(attribute.name||'').toLowerCase(),value=String(attribute.value??'');
     if(/(spacer|virtual|sentinel)/.test(name))virtualOffsetEvidence=true;
     if(/^(data-index|data-row-index|data-virtual-index|aria-posinset)$/.test(name)&&Number(value)>0)virtualOffsetEvidence=true;
    }
    const parent=ancestor.parentElement;if(parent){for(const sibling of [...(parent.children||[])]){if(sibling===ancestor)break;const names=[...(sibling.attributes||[])].map(attribute=>String(attribute.name||'').toLowerCase());if(names.some(name=>/(spacer|virtual|sentinel)/.test(name)))virtualOffsetEvidence=true;}}
    if(ancestor===root)break;ancestor=parent;
   }
   if(hasTime)timeElementRows++;if(hasDatetime)datetimeRows++;if(hasNumericEpoch)numericEpochRows++;if(rowOrderNames.size)rowsWithOrderIndex++;
   for(const key of Object.keys(flagStats)){
    const rowFlag=flagStats[key].rowFlags;
    if(rowFlag?.has(true))flagStats[key].rowsWithPositiveMarker++;
    if(rowFlag?.has(false))flagStats[key].rowsWithNegativeMarker++;
    if(rowFlag)delete flagStats[key].rowFlags;
   }
   let node=item.anchor,ancestorDepth=0;while(node&&node!==root&&ancestorDepth++<10){const parent=node.parentElement;if(!parent)break;
    const siblings=[...(parent.children||[])];for(const sibling of siblings){if(sibling===node)break;const tag=String(sibling.tagName||'').toLowerCase(),role=sibling.getAttribute?.('role')||'';
     if(!(/^h[1-6]$/.test(tag)||role==='heading'))continue;let text='';try{text=String(sibling.innerText||sibling.textContent||'').trim().toLowerCase().replace(/\s+/g,' ');}catch{}
     let category=null;if(/\b(today|сегодня)\b/.test(text))category='today';else if(/\b(yesterday|вчера)\b/.test(text))category='yesterday';
     else if(/(previous|last|past)\s+7\s+days|последн.{0,8}7\s+дн|предыдущ.{0,8}7\s+дн/.test(text))category='previous_7_days';
     else if(/(previous|last|past)\s+30\s+days|последн.{0,8}30\s+дн|предыдущ.{0,8}30\s+дн/.test(text))category='previous_30_days';
     else if(/\b(older|earlier|previous conversations)\b|старш|ранее|предыдущие диалог/.test(text))category='older';
     if(category)groups.set(category,(groups.get(category)||new Set()).add(item.anchor));
    }
    node=parent;
   }
  }
  const timestampFields=[...fieldRows.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([field,entry])=>({field,valueType:entry.type,activityRelevant:entry.activityRelevant,
   normalizedTimestamps:[...entry.values].sort().slice(0,20),rowsWithValue:entry.rows.size}));
  const flagResult=key=>({available:flagStats[key].fieldNames.size>0,rowsWithPositiveMarker:flagStats[key].rowsWithPositiveMarker,
   rowsWithNegativeMarker:flagStats[key].rowsWithNegativeMarker,fieldNames:[...flagStats[key].fieldNames].sort()});
  const headingCategories=[...groups.entries()].map(([category,set])=>({category,rows:rows.filter(row=>set.has(row.anchor)).length})).sort((a,b)=>a.category.localeCompare(b.category));
  const orderSignature=`${selection.activeCandidateOrdinal||0}|${rows.map(item=>`${routeType(item.anchor)||'unknown'}:${conversationIdFromAnchor(item.anchor)||'missing'}`).join('|')}`;
  const domOrderStable=rootSidebarPreviousOrder!==null&&rootSidebarPreviousOrder===orderSignature;rootSidebarPreviousOrder=orderSignature;
  const first=visible.length?rows[firstVisibleIndex]:null,scrollTop=scroller?Number(scroller.scrollTop)||0:0;
  const scrollHeight=scroller&&Number.isFinite(Number(scroller.scrollHeight))?Math.max(0,Number(scroller.scrollHeight)):null;
  const clientHeight=scroller&&Number.isFinite(Number(scroller.clientHeight))?Math.max(0,Number(scroller.clientHeight)):null;
  const scrollRangePx=scrollHeight!==null&&clientHeight!==null?Math.max(0,scrollHeight-clientHeight):null;
  const scrollAtExtent=scrollRangePx!==null&&(scrollTop<=2||scrollTop>=scrollRangePx-2);
  const topProofPossible=!!first&&domOrderStable&&firstVisibleIndex===0&&(!scroller||scrollTop<=2)&&!virtualOffsetEvidence;
  const exactActivityMetadataAvailable=timestampFields.some(field=>field.activityRelevant&&field.rowsWithValue>0);
  return {activeSidebarFound:true,activeCandidateOrdinal:selection.activeCandidateOrdinal,renderedRows:rows.length,visibleRows:visible.length,
   domOrderStable,exactActivityMetadataAvailable,timestampFields,timeElementRows,datetimeRows,numericEpochRows,
   dataTimestampAttributeNames:[...dataTimestampNames].sort(),sectionGroups:headingCategories,
   pinnedStarred:flagResult('pinnedStarred'),archived:flagResult('archived'),locked:flagResult('locked'),
   orderIndexAttributeNames:[...orderNames].sort(),rowsWithOrderIndex,firstVisibleIndex:firstVisibleIndex<0?null:firstVisibleIndex,
   rowsBeforeFirstVisible:firstVisibleIndex<0?rows.length:firstVisibleIndex,topProofPossible,topProofReason:topProofPossible?'top_proof_possible':'current_geometry_does_not_prove_top',
   scrollableAncestorFound:!!scroller,scrollTop:scroller?Math.round(scrollTop):null,virtualOffsetEvidence,
   rowsWithInternalIdentity,rowsWithoutInternalIdentity:Math.max(0,rows.length-rowsWithInternalIdentity),
   scrollGeometry:scroller?{scrollTop:Math.round(scrollTop),scrollHeight,clientHeight,scrollRangePx,atScrollExtent:scrollAtExtent}:null,
   endOfListProof:'unavailable'};
 };
 window.gptDiagnoseRootSidebarScroll=async({operationToken='',maxSteps=8,settleMs=250}={})=>{
  const initialPath=location.pathname,selection=activeSidebarSnapshot(),root=selection.root;
  const empty={operationToken,status:'sidebar_unavailable',scrollOwnerFound:false,steps:[],virtualized:false,lazyLoadingObserved:false,
   boundedEndCandidate:false,endOfListProof:'unavailable',rootUniverseComplete:false,scrollRestoreSuccessful:false};
  if(!root)return empty;
  const linksNow=()=>[...(root.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation'&&actuallyRendered(anchor));
  const initialLinks=linksNow(),initialVisible=initialLinks.filter(anchor=>viewportVisibleInSidebar(anchor,root,null));
  const votes=new Map();for(const anchor of initialVisible){const candidate=findSidebarScroller(root,anchor);if(candidate)votes.set(candidate,(votes.get(candidate)||0)+1);}
  const scroller=[...votes.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||null;
  const initialScrollTop=scroller?Number(scroller.scrollTop)||0:null,seen=new Set(),previousCurrent=new Set(),steps=[];
  let virtualized=false,lazyLoadingObserved=false,quietBottomSamples=0,loadingIndicatorEverSeen=false,status=scroller?'traversal_bounded':'scroll_owner_unavailable';
  const max=Math.max(1,Math.min(8,Number(maxSteps)||8)),settle=Math.max(0,Math.min(350,Number(settleMs)||0));
  const sample=(step)=>{
   const currentLinks=linksNow(),ids=currentLinks.map(conversationIdFromAnchor).filter(id=>typeof id==='string'),current=new Set(ids),visible=currentLinks.filter(anchor=>viewportVisibleInSidebar(anchor,root,scroller));
   let newIdentityCount=0;for(const id of current)if(!seen.has(id)){seen.add(id);newIdentityCount++;}
   let missingFromDOM=0;for(const id of previousCurrent)if(!current.has(id))missingFromDOM++;
   if(missingFromDOM>0)virtualized=true;
   const scrollTop=scroller?Math.round(Number(scroller.scrollTop)||0):null,scrollHeight=scroller&&Number.isFinite(Number(scroller.scrollHeight))?Math.round(Number(scroller.scrollHeight)):null;
   const clientHeight=scroller&&Number.isFinite(Number(scroller.clientHeight))?Math.round(Number(scroller.clientHeight)):null,range=scrollHeight!==null&&clientHeight!==null?Math.max(0,scrollHeight-clientHeight):null;
   const style=scroller?getComputedStyle(scroller):{},overflowY=String(style?.overflowY||'unknown').slice(0,12),atBottom=range!==null&&scrollTop!==null&&scrollTop>=range-2;
   let loadingIndicators=0;try{loadingIndicators=(root.querySelectorAll?.('[aria-busy="true"],[role="progressbar"],[data-testid*="spinner"]')||[]).length;}catch{}
   if(loadingIndicators>0)loadingIndicatorEverSeen=true;
   if(step>0&&(newIdentityCount>0||missingFromDOM>0||currentLinks.length!==steps.at(-1)?.renderedRows||scrollHeight!==steps.at(-1)?.scrollHeight))lazyLoadingObserved=true;
   const prior=steps.at(-1),quiet=atBottom&&newIdentityCount===0&&missingFromDOM===0&&loadingIndicators===0&&prior&&currentLinks.length===prior.renderedRows&&scrollHeight===prior.scrollHeight;
   quietBottomSamples=quiet?quietBottomSamples+1:0;
   steps.push({step,renderedRows:currentLinks.length,visibleRows:visible.length,rowsWithInternalIdentity:ids.length,uniqueIdentitiesSeen:seen.size,
    newIdentities:newIdentityCount,previousIdentitiesMissingFromDOM:missingFromDOM,scrollTop,clientHeight,scrollHeight,scrollRangePx:range,overflowY,atBottom,loadingIndicators,
    quietBottomSamples});
   previousCurrent.clear();for(const id of current)previousCurrent.add(id);
   return {current};
  };
  try{
   sample(0);
   for(let step=1;step<=max;step++){
    if(location.pathname!==initialPath){status='route_changed';break;}
    const fresh=activeSidebarSnapshot();if(fresh.root!==root){status='sidebar_replaced';break;}
    const maxScroll=Math.max(0,(Number(scroller.scrollHeight)||0)-(Number(scroller.clientHeight)||0));
    scroller.scrollTop=maxScroll;
    await new Promise(resolve=>setTimeout(resolve,settle));
    if(location.pathname!==initialPath){status='route_changed';break;}
    sample(step);
    if(quietBottomSamples>=2){status='bounded_bottom_quiescent';break;}
    const last=steps.at(-1),prior=steps.at(-2);
    if(last.scrollTop===prior.scrollTop&&!last.atBottom&&last.newIdentities===0){status='scroll_stalled';break;}
   }
   if(status==='traversal_bounded'&&steps.length>=max+1)status='bounded_attempts_exhausted';
  }catch{status='diagnostic_error';}
  finally{try{if(scroller&&initialScrollTop!==null&&root.isConnected!==false)scroller.scrollTop=initialScrollTop;}catch{}}
  const restoreOK=!scroller||initialScrollTop===null||Math.abs((Number(scroller.scrollTop)||0)-initialScrollTop)<=2;
  return {operationToken,status,scrollOwnerFound:!!scroller,scrollOwnerTag:scroller?String(scroller.tagName||'unknown').toLowerCase().slice(0,12):null,
   scrollOwnerOverflowY:scroller?String(getComputedStyle(scroller)?.overflowY||'unknown').slice(0,12):null,initialRenderedRows:initialLinks.length,
   initialUniqueIdentities:new Set(initialLinks.map(conversationIdFromAnchor).filter(id=>typeof id==='string')).size,steps,
   virtualized,lazyLoadingObserved,loadingIndicatorEverSeen,boundedEndCandidate:status==='bounded_bottom_quiescent',
   endOfListProof:'unavailable',rootUniverseComplete:false,proofGap:'no explicit terminal marker or authoritative final-page signal',scrollRestoreSuccessful:restoreOK};
 };
 window.gptInspectRootSidebarMetadata=inspectRenderedRootSidebarMetadata;
 window.gptRootSidebarConversationIds=()=>{const root=activeSidebarSnapshot().root;if(!root)return [];
  return [...(root.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation'&&actuallyRendered(anchor)).map(conversationIdFromAnchor).filter(id=>typeof id==='string').slice(0,200);};
 const viewportVisibleInSidebar=(anchor,root,scroller)=>{
  let r;try{r=anchor.getBoundingClientRect();}catch{return false;}
  const rootRect=root?.getBoundingClientRect?.(),scrollRect=scroller?.getBoundingClientRect?.();
  const viewport={left:0,top:0,right:Number(window.innerWidth)||Number(document.documentElement?.clientWidth)||1024,bottom:Number(window.innerHeight)||Number(document.documentElement?.clientHeight)||768};
  return isVisible(anchor)&&(!rootRect||intersects(r,rootRect))&&(!scrollRect||intersects(r,scrollRect))&&intersects(r,viewport);
 };
 window.gptCollectVisibleSidebarDOMFallback=()=>{
  const empty={status:'sidebar_unavailable',candidateCount:0,acceptedConversationRowCount:0,rejectedNavigationRowCount:0,duplicateRowCount:0,conversationIds:[]};
  try{
   if(String(location.pathname||'/')!=='/')return {...empty,status:'wrong_route'};
   const root=activeSidebarSnapshot().root;if(!root)return empty;
   const anchors=[...(root.querySelectorAll?.('a[data-octane-navigation-item][href]')||[])].filter(anchor=>viewportVisibleInSidebar(anchor,root,null));
   const ids=new Set();let rejectedNavigationRowCount=0,duplicateRowCount=0;
   for(const anchor of anchors){
    const route=octaneNavigationRoute(anchor),id=route?.identity;
    if(!route||route.kind!=='conversation'||typeof id!=='string'||! /^[A-Za-z0-9-]{1,128}$/.test(id)){rejectedNavigationRowCount++;continue;}
    if(ids.has(id)){duplicateRowCount++;continue;}
    ids.add(id);
   }
   return {status:'ok',candidateCount:anchors.length,acceptedConversationRowCount:ids.size,
    rejectedNavigationRowCount,duplicateRowCount,conversationIds:[...ids].slice(0,200)};
  }catch{return {...empty,status:'diagnostic_error'};}
 };
 const hasSidebarScrollGeometry=node=>{if(!node)return false;let overflow='';try{overflow=String(getComputedStyle(node).overflowY||'');}catch{}return /^(auto|scroll|overlay)$/.test(overflow)&&Number(node.scrollHeight)>Number(node.clientHeight)+1&&Number(node.clientHeight)>0;};
 const collectSidebarScrollCandidates=(root,anchor=null)=>{
  if(!root)return [];
  const nodes=new Set(),addChain=start=>{let node=start,depth=0;while(node&&depth<16&&!nodes.has(node)){nodes.add(node);if(node===document.body||node===document.documentElement)break;node=node.parentElement;depth++;}};
  addChain(root);addChain(anchor);
  // Include a bounded descendant walk for layouts where the sidebar viewport and rows have separate containers.
  try{const pending=[...(root.children||[])];let visited=0;while(pending.length&&visited<700){const node=pending.shift();visited++;nodes.add(node);for(const child of node.children||[])if(pending.length+visited<700)pending.push(child);}}catch{}
  const scrollingElement=document.scrollingElement||document.documentElement||document.body;
  let documentCanScroll=false;try{documentCanScroll=Number(scrollingElement?.scrollHeight)>Number(scrollingElement?.clientHeight)+1&&Number(scrollingElement?.clientHeight)>0;}catch{}
  if(documentCanScroll)nodes.add(scrollingElement);
  return [...nodes].filter(node=>node?.isConnected!==false&&(hasSidebarScrollGeometry(node)||node===scrollingElement&&documentCanScroll));
 };
 const resolveUniqueSidebarScrollOwner=(root,anchor=null)=>{const candidates=collectSidebarScrollCandidates(root,anchor);return {owner:candidates.length===1?candidates[0]:null,candidates,reason:candidates.length===0?'scroll_owner_missing':candidates.length===1?null:'scroll_owner_ambiguous'};};
 const canSidebarScroll=node=>node?.isConnected!==false&&hasSidebarScrollGeometry(node);
 const findSidebarScrollOwner=(root,preferred=null)=>{
  if(!root)return null;
  if(preferred&&hasSidebarScrollGeometry(preferred)&&(preferred.isConnected===false||containsNode(root,preferred)||containsNode(preferred,root)))return preferred;
  let node=root,levels=0;
  while(node&&levels<=12){if(hasSidebarScrollGeometry(node))return node;node=node.parentElement;levels++;}
  return null;
 };
 const findConversationScrollContainer=(anchor,root,preferred)=>{
  if(preferred&&canSidebarScroll(preferred)&&(containsNode(root,preferred)||containsNode(preferred,root)))return preferred;
  const stableOwner=findSidebarScrollOwner(root);if(stableOwner)return stableOwner;
  const canScroll=node=>{if(!node)return false;let overflow='';try{overflow=String(getComputedStyle(node).overflowY||'');}catch{}return /^(auto|scroll|overlay)$/.test(overflow)&&Number(node.scrollHeight)>Number(node.clientHeight)+1&&Number(node.clientHeight)>0;};
  if(canScroll(preferred))return preferred;
  let node=anchor?.parentElement||null,levels=0;
  while(node&&levels<10){if(canScroll(node))return node;if(node===root)break;node=node.parentElement;levels++;}
  return null;
 };
 const scrollConversationRowIntoView=async(anchor,root,preferred,resolveCurrent=()=>anchor,{strictDiagnosticOwner=false,validateSnapshot=null,rowIndex=null}={})=>{
  if(!anchor||viewportVisibleInSidebar(anchor,root,preferred))return {used:false,container:preferred||null,visible:!!anchor&&viewportVisibleInSidebar(anchor,root,preferred),reason:null,attempts:[]};
  const ownerResult=strictDiagnosticOwner?resolveUniqueSidebarScrollOwner(root,anchor):null;
  const container=strictDiagnosticOwner?(preferred&&canSidebarScroll(preferred)&&ownerResult?.owner===preferred?preferred:null):findConversationScrollContainer(anchor,root,preferred);
  if(!container)return {used:false,container:preferred||null,visible:false,reason:strictDiagnosticOwner?(preferred?.isConnected===false?'scroll_owner_detached':ownerResult?.owner&&ownerResult.owner!==preferred?'scroll_owner_changed':ownerResult?.reason||'scroll_owner_missing'):'scroll_owner_missing',ownerCandidateCount:ownerResult?.candidates.length??null};
  if(container.isConnected===false)return {used:false,container,visible:false,reason:'scroll_owner_detached'};
   let used=false,initialScrollTop=Number(container.scrollTop)||0,scrollTopAfter=initialScrollTop,expectedScroll=false;
  const attempts=[];let current=anchor,maximumReached=initialScrollTop;
  try{
   const max=Math.max(0,Number(container.scrollHeight)-Number(container.clientHeight));
   const takeRect=node=>{try{const rect=node?.getBoundingClientRect?.();return rect?{top:Number(rect.top)||0,bottom:Number(rect.bottom)||0}:null;}catch{return null;}};
   const ownerViewport=()=>{const rect=takeRect(container);if(!rect)return null;const top=rect.top+(strictDiagnosticOwner?(Number(container.clientTop)||0):0),bottom=strictDiagnosticOwner?top+(Number(container.clientHeight)||0):rect.bottom;return {top,bottom};};
   const intersectsOwner=(rect,viewport)=>!!rect&&!!viewport&&rect.bottom>viewport.top&&rect.top<viewport.bottom;
   const settle=async()=>{if(typeof window.requestAnimationFrame==='function')await waitForFramesBounded(2,400);else await new Promise(resolve=>setTimeout(resolve,80));};
   const makeAttempt=async(attemptIndex,node)=>{
    const before=Number(container.scrollTop)||0,clientHeight=Number(container.clientHeight)||0,scrollHeight=Number(container.scrollHeight)||0,maximum=Math.max(0,scrollHeight-clientHeight);
    const ownerRect=takeRect(container),viewport=ownerViewport(),rowBefore=takeRect(node);
    if(!ownerRect||!viewport||!rowBefore)return {ok:false,reason:'row_scroll_into_view_failed'};
    let delta=0;
    if(rowBefore.bottom>viewport.bottom)delta=rowBefore.bottom-viewport.bottom;
    else if(rowBefore.top<viewport.top)delta=rowBefore.top-viewport.top;
    const requested=before+delta,clamped=Math.max(0,Math.min(maximum,requested));
    expectedScroll=expectedScroll||Math.abs(delta)>1;
    if(Math.abs(clamped-before)>1)container.scrollTop=clamped;
    await settle();
    if(container.isConnected===false)return {ok:false,reason:'scroll_owner_detached'};
    const resolved=resolveCurrent?.()||null;
    if(!resolved)return {ok:false,reason:'row_missing_after_scroll'};
    const topologyReason=validateSnapshot?.();
    if(topologyReason)return {ok:false,reason:topologyReason,anchor:resolved,rowReplaced:resolved!==node};
    const rowAfter=takeRect(resolved),actual=Number(container.scrollTop)||0,liveViewport=ownerViewport();
    const visible=viewportVisibleInSidebar(resolved,root,container),intersects=intersectsOwner(rowAfter,liveViewport);
    const moved=Math.abs(actual-before)>1;used=used||moved;scrollTopAfter=actual;maximumReached=Math.max(maximumReached,actual);
    attempts.push({rowIndex,attempt:attemptIndex,ownerScrollTopBefore:before,clientHeight,scrollHeight,ownerRectTop:ownerRect.top,ownerRectBottom:ownerRect.bottom,
     rowRectTopBefore:rowBefore.top,rowRectBottomBefore:rowBefore.bottom,calculatedDelta:delta,requestedTargetScrollTop:requested,clampedTargetScrollTop:clamped,
     actualScrollTopAfter:actual,rowRectTopAfter:rowAfter?.top??null,rowRectBottomAfter:rowAfter?.bottom??null,intersectsViewport:intersects,maximumPossibleScrollTop:maximum,
     correctiveAttempt:attemptIndex===2,rowReResolved:true,rowReplaced:resolved!==node});
    return {ok:true,anchor:resolved,visible,intersects,moved,rowReplaced:resolved!==node,actualScrollTop:actual,maximum};
   };
   let first=await makeAttempt(1,current);
   if(!first.ok)return {used,container,initialScrollTop,scrollTopAfter:Number(container.scrollTop)||scrollTopAfter,maximumReached,visible:false,reason:first.reason,anchor:first.anchor||null,rowReplaced:first.rowReplaced===true,attempts};
   current=first.anchor;
   if(strictDiagnosticOwner&&!first.visible&&first.moved){
    const correction=await makeAttempt(2,current);
    if(!correction.ok)return {used,container,initialScrollTop,scrollTopAfter:Number(container.scrollTop)||scrollTopAfter,maximumReached,visible:false,reason:correction.reason,anchor:correction.anchor||current,rowReplaced:correction.rowReplaced===true,attempts};
    current=correction.anchor;
   }
   const visible=viewportVisibleInSidebar(current,root,container),moved=Math.abs((Number(container.scrollTop)||0)-initialScrollTop)>1;
   const reason=visible?null:expectedScroll&&!moved?'scroll_did_not_move':'row_not_reached_after_scroll';
   return {used,container,initialScrollTop,scrollTopAfter:Number(container.scrollTop)||scrollTopAfter,maximumReached,visible,anchor:current,rowReplaced:current!==anchor,reason,attempts};
  }catch{return {used,container,initialScrollTop,scrollTopAfter:Number(container.scrollTop)||scrollTopAfter,maximumReached,visible:false,reason:container.isConnected===false?'scroll_owner_detached':'row_not_reached_after_scroll',attempts};}
 };
 const conversationIdFromAnchor=anchor=>{try{const href=anchor?.getAttribute?.('href');if(typeof href!=='string'||!href.trim())return null;const path=new URL(href,location.href).pathname,legacy=path.match(/^\/c\/([A-Za-z0-9-]+)\/?$/)?.[1]||path.match(/^\/g\/[^/]+\/c\/([A-Za-z0-9-]+)\/?$/)?.[1];return legacy||octaneNavigationRoute(anchor)?.identity||null;}catch{return null;}};
 const exactConversationRouteFromAnchor=anchor=>{try{const href=anchor?.getAttribute?.('href');if(typeof href!=='string'||!href.trim())return null;const path=new URL(href,location.href).pathname;if(/^\/c\/[A-Za-z0-9-]+\/?$/.test(path)||/^\/g\/[A-Za-z0-9-]+\/c\/[A-Za-z0-9-]+\/?$/.test(path))return path;return octaneNavigationRoute(anchor)?.path||null;}catch{return null;}};
 const sidebarRouteStartByGeneration=new Map();
 window.gptPinnedConversationRouteState=(expectedId,generation)=>{
  const path=String(location.pathname||'/'),id=path.match(/\/c\/([A-Za-z0-9-]+)(?:\/|$)/)?.[1]||null;
  const start=typeof generation==='string'?sidebarRouteStartByGeneration.get(generation):null;
  return {matches:typeof expectedId==='string'&&id===expectedId,routeChanged:!!start&&path!==start,routeTemplate:safePathTemplate()};
 };
 const postSidebarNavigation=(generation,stage,details={})=>{
  try{window.webkit?.messageHandlers?.sidebarNavigation?.postMessage({operationGeneration:generation,stage,...details});}catch{}
 };
 const lookupSidebarRow=(expectedId,generation)=>{
  postSidebarNavigation(generation,'sidebar_row_lookup_started');
  let anchors;try{anchors=Array.from(document.querySelectorAll('a[href]'));}
  catch(error){const name=String(error?.name||'Error'),errorCategory=['TypeError','SyntaxError','SecurityError'].includes(name)?name:'Error';postSidebarNavigation(generation,'sidebar_row_lookup_error',{errorCategory});return {status:'row_lookup_error',errorCategory,scanComplete:false,totalAnchors:0,conversationAnchors:0,matchingAnchors:0};}
  const conversations=[],matches=[];
  for(const anchor of anchors){try{const raw=anchor.getAttribute('href');if(typeof raw!=='string'||!raw)continue;const path=new URL(raw,location.href).pathname,direct=path.match(/^\/c\/([A-Za-z0-9-]+)\/?$/),group=path.match(/^\/g\/[A-Za-z0-9-]+\/c\/([A-Za-z0-9-]+)\/?$/),id=direct?.[1]||group?.[1];if(!id)continue;conversations.push(anchor);if(id===expectedId)matches.push(anchor);}catch{/* Ignore malformed href without retaining it. */}}
  const counts={scanComplete:true,totalAnchors:anchors.length,conversationAnchors:conversations.length,matchingAnchors:matches.length};
  postSidebarNavigation(generation,'sidebar_row_anchor_scan_complete',counts);
  if(matches.length===0)return {status:'row_missing',...counts};
  if(matches.length===1)return {status:'row_resolved',anchor:matches[0],root:null,...counts};
  try{const root=sidebarSnapshot().root||null,inside=root?matches.filter(anchor=>root.contains?.(anchor)):[];if(inside.length===1)return {status:'row_resolved',anchor:inside[0],root,...counts};}
  catch{}
  return {status:'row_ambiguous',...counts};
 };
 const dispatchSidebarClick=(anchor,generation,scrollRequired,expectedId)=>{
  try{
   const raw=anchor.getAttribute('href'),path=new URL(raw||'',location.href).pathname,direct=path.match(/^\/c\/([A-Za-z0-9-]+)\/?$/),group=path.match(/^\/g\/[A-Za-z0-9-]+\/c\/([A-Za-z0-9-]+)\/?$/),id=direct?.[1]||group?.[1];
   if(!id)return {status:'sidebar_navigation_error',errorCategory:'href_route_invalid'};
   const targetAttributePresent=anchor.hasAttribute?.('target')===true,downloadAttributePresent=anchor.hasAttribute?.('download')===true,routeBefore=String(location.pathname||'/'),hrefMatchesExpected=id===expectedId;
   postSidebarNavigation(generation,'sidebar_anchor_activation_prepared',{anchorFound:true,rowVisible:true,hrefMatchesExpected,targetAttributePresent,downloadAttributePresent,scrollRequired});
   if(!hrefMatchesExpected)return {status:'sidebar_navigation_error',errorCategory:'href_target_mismatch',anchorFound:true,rowVisible:true,hrefMatchesExpected:false,targetAttributePresent,downloadAttributePresent,scrollRequired};
   anchor.click();
   const routeAfter=String(location.pathname||'/'),routeChangedImmediately=routeAfter!==routeBefore,immediateId=routeAfter.match(/\/c\/([A-Za-z0-9-]+)(?:\/|$)/)?.[1]||null,immediateTargetMatched=immediateId===id;
   postSidebarNavigation(generation,'sidebar_anchor_click_invoked',{activationMethod:'anchor.click',clickInvoked:true,routeChangedImmediately,immediateTargetMatched,scrollRequired});
   return {status:'sidebar_anchor_click_invoked',activationMethod:'anchor.click',anchorFound:true,clickInvoked:true,routeChangedImmediately,immediateTargetMatched,immediateRouteTemplate:safePathTemplate(),hrefMatchesExpected,targetAttributePresent,downloadAttributePresent,rowVisible:true,scrollRequired};
  }catch{return {status:'sidebar_navigation_error',errorCategory:'click_dispatch_exception'};}
 };
 const sidebarFailure=(generation,status,extra={})=>{const stage=({row_missing:'sidebar_row_missing',row_ambiguous:'sidebar_row_ambiguous',row_lookup_error:'sidebar_row_lookup_error',sidebar_row_scroll_failed:'sidebar_row_scroll_failed'})[status]||'sidebar_navigation_error';postSidebarNavigation(generation,stage,extra);return {status,...extra};};
 window.gptSidebarNavigateSync=(expectedId,generation)=>{
  postSidebarNavigation(generation,'sidebar_navigation_command_received');
  const routeStart=String(location.pathname||'/');if(typeof generation==='string'){sidebarRouteStartByGeneration.set(generation,routeStart);if(sidebarRouteStartByGeneration.size>8)sidebarRouteStartByGeneration.delete(sidebarRouteStartByGeneration.keys().next().value);}
  if(typeof expectedId!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(expectedId)||typeof generation!=='string'||generation.length<1)return sidebarFailure(generation,'row_lookup_error',{errorCategory:'invalid_arguments',totalAnchors:0,conversationAnchors:0,matchingAnchors:0});
  let row;try{row=lookupSidebarRow(expectedId,generation);}catch(error){const name=String(error?.name||'Error');return sidebarFailure(generation,'row_lookup_error',{errorCategory:['TypeError','SyntaxError','SecurityError'].includes(name)?name:'Error',totalAnchors:0,conversationAnchors:0,matchingAnchors:0});}
  if(row.status!=='row_resolved')return row.status==='row_lookup_error'?sidebarFailure(generation,row.status,row):sidebarFailure(generation,row.status,row);
  try{const visible=viewportVisibleInSidebar(row.anchor,row.root,null);postSidebarNavigation(generation,'sidebar_row_resolved',{rowVisible:visible,scrollRequired:!visible});
   const counts={scanComplete:true,totalAnchors:row.totalAnchors,conversationAnchors:row.conversationAnchors,matchingAnchors:row.matchingAnchors};
   if(!visible)return {status:'row_resolved_needs_scroll',...counts,rowVisible:false,scrollRequired:true};
   return {...dispatchSidebarClick(row.anchor,generation,false,expectedId),...counts,rowVisible:true,scrollRequired:false};
  }catch(error){const name=String(error?.name||'Error');return sidebarFailure(generation,'row_lookup_error',{errorCategory:['TypeError','SyntaxError','SecurityError'].includes(name)?name:'Error',...{totalAnchors:row.totalAnchors,conversationAnchors:row.conversationAnchors,matchingAnchors:row.matchingAnchors}});}
 };
 window.gptContinueSidebarScroll=async(expectedId,generation)=>{
  const fail=(reason,extra={})=>sidebarFailure(generation,reason,extra);
  try{postSidebarNavigation(generation,'sidebar_scroll_started',{scrollRequired:true});let row=lookupSidebarRow(expectedId,generation);if(row.status!=='row_resolved')return row.status==='row_lookup_error'?row:fail(row.status==='row_ambiguous'?'row_ambiguous':'sidebar_row_scroll_failed',{scrollReason:'row_not_resolved'});
   let sidebar=sidebarSnapshot(),scroller=findConversationScrollContainer(row.anchor,row.root,sidebar.scroller||null);if(!scroller)return fail('sidebar_row_scroll_failed',{scrollReason:'row_scroll_container_unavailable'});
   try{row.anchor.scrollIntoView({block:'nearest',inline:'nearest'});}catch{return fail('sidebar_row_scroll_failed',{scrollReason:'scroll_into_view_exception'});}
   if(typeof window.requestAnimationFrame==='function')await waitForFramesBounded(2,450);else await new Promise(resolve=>setTimeout(resolve,80));
   row=lookupSidebarRow(expectedId,generation);if(row.status!=='row_resolved')return row.status==='row_lookup_error'?row:fail(row.status==='row_ambiguous'?'row_ambiguous':'sidebar_row_scroll_failed',{scrollReason:'row_missing_after_scroll'});
   sidebar=sidebarSnapshot();scroller=findConversationScrollContainer(row.anchor,row.root,scroller||sidebar.scroller||null);
   if(!viewportVisibleInSidebar(row.anchor,row.root,scroller))return fail('sidebar_row_scroll_failed',{scrollReason:'row_scroll_into_view_failed'});
   postSidebarNavigation(generation,'sidebar_row_resolved',{rowVisible:true,scrollRequired:true});return {...dispatchSidebarClick(row.anchor,generation,true,expectedId),scanComplete:true,totalAnchors:row.totalAnchors,conversationAnchors:row.conversationAnchors,matchingAnchors:row.matchingAnchors,rowVisible:true,scrollRequired:true};
  }catch(error){const name=String(error?.name||'Error');return fail('row_lookup_error',{errorCategory:['TypeError','SyntaxError','SecurityError'].includes(name)?name:'Error'});}
 };
 window.gptWaitForSidebarRoute=async(expectedId,generation,timeoutMs=4000,clickInfo={})=>{
  const routeBefore=safePathTemplate(),maxWait=Math.max(100,Math.min(5000,Number(timeoutMs)||4000)),deadline=Date.now()+maxWait;
  try{postSidebarNavigation(generation,'sidebar_route_wait_started');while(Date.now()<deadline){const path=String(location.pathname||'/'),id=path.match(/\/c\/([A-Za-z0-9-]+)(?:\/|$)/)?.[1]||null;if(id===expectedId){const result={status:'sidebar_route_reached',routeTemplate:safePathTemplate()};postSidebarNavigation(generation,'sidebar_route_reached',{rowResolved:true,clickDelivered:true,defaultPrevented:clickInfo.defaultPrevented,routeTemplate:result.routeTemplate});return result;}await new Promise(resolve=>setTimeout(resolve,50));}
   const result={status:'sidebar_navigation_no_effect',routeBefore,routeAfter:safePathTemplate()};postSidebarNavigation(generation,result.status,{rowResolved:true,clickDelivered:true,defaultPrevented:clickInfo.defaultPrevented,routeBefore,routeAfter:result.routeAfter});return result;
  }catch(error){const name=String(error?.name||'Error'),errorCategory=['TypeError','SyntaxError','SecurityError'].includes(name)?name:'Error';postSidebarNavigation(generation,'sidebar_navigation_error',{errorCategory});return {status:'sidebar_navigation_error',errorCategory};}
 };
 window.gptSidebarNavigate=window.gptSidebarNavigateSync;
 const visibleConversationRows=(root,scroller)=>[...(root?.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation'&&viewportVisibleInSidebar(anchor,root,scroller));
 const waitForConversationRowsReady=(timeoutMs=4000,overallDeadline=Infinity,options={})=>new Promise(resolve=>{
  const started=Date.now(),requestedPhaseA=Number(options.phaseABudgetMs)||Number(timeoutMs)||4000,requestedGrace=Number(options.stabilizationGraceMs),
   phaseABudgetMs=Math.max(1,Math.min(4000,requestedPhaseA)),stabilizationGraceMs=Math.max(0,Math.min(1200,Number.isFinite(requestedGrace)?requestedGrace:1200)),
   absoluteReadinessCapMs=Math.max(phaseABudgetMs,Math.min(6000,Number(options.absoluteReadinessCapMs)||6000)),
   acquireDeadline=Math.min(started+phaseABudgetMs,overallDeadline),absoluteDeadline=Math.min(started+absoluteReadinessCapMs,overallDeadline),quietWindowMs=320,pollMs=70;
  const snapshot=()=>{let sidebar=null;try{sidebar=activeSidebarSnapshot();}catch{}const root=sidebar?.root||null,rows=[...(root?.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation'&&actuallyRendered(anchor)),rowIds=rows.map(conversationIdFromAnchor),validIds=rowIds.filter(id=>typeof id==='string'&&id.length>0),identityCount=new Set(validIds).size;
   const signature=rows.map(anchor=>exactConversationRouteFromAnchor(anchor)||`${routeType(anchor)||'unknown'}:${conversationIdFromAnchor(anchor)||'missing'}`).join('|');return {root,rows,sidebarVisible:sidebar?.visible===true,signature,identityCount,duplicateIdentityCount:validIds.length-identityCount,missingIdentityCount:rowIds.length-validIds.length};};
  let timer=null,finished=false,current=snapshot(),firstPositiveCount=0,stableCount=0,finalSnapshotCount=0,firstPositiveAt=null,lastChangeAt=null,lastSemanticChangeAt=null,lastSignature=current.signature,lastRoot=current.root,stableChecks=0,stabilizationDeadline=null,
   conversationSignatureChanges=0,mutationChecks=0,unrelatedMutationChecks=0,observer=null,extensionActivated=false,semanticChangeObserved=false;
  const finishOnce=(terminalReason,snap)=>{
   if(finished)return;finished=true;if(timer!==null)clearTimeout(timer);try{observer?.disconnect();}catch{}
   finalSnapshotCount=snap.rows.length;stableCount=snap.rows.length;
   const now=Date.now(),timeToFirstPositiveMs=firstPositiveAt===null?null:Math.max(0,firstPositiveAt-started),timeToStableMs=terminalReason==='ready'&&firstPositiveAt!==null?Math.max(0,now-firstPositiveAt):null,stableDurationMs=lastChangeAt===null?0:Math.max(0,now-lastChangeAt);
   const diagnosticStatus=terminalReason==='ready'?'snapshot_ready':firstPositiveAt===null?(snap.root?'rows_never_appeared':'sidebar_root_missing'):'rows_appeared_but_never_stabilized';
   resolve({status:terminalReason,diagnosticStatus,terminalReason,readinessTerminalReason:terminalReason,ready:terminalReason==='ready',waitStarted:true,waitStartedAtMs:started,waitDurationMs:Math.max(0,now-started),
    rowsAtFirstDetection:firstPositiveCount,rowsAtStabilizedSnapshot:stableCount,firstPositiveCount,finalStableCount:stableCount,stableCount,finalSnapshotCount,identityCount:snap.identityCount,duplicateIdentityCount:snap.duplicateIdentityCount,missingIdentityCount:snap.missingIdentityCount,
    conversationSignatureChanges,mutationChecks,unrelatedMutationChecks,timeToFirstPositiveMs,timeToStableMs,stableDurationMs,
    phaseABudgetMs,stabilizationGraceMs,absoluteReadinessCapMs,firstPositiveTimestampMs:firstPositiveAt===null?null:Math.max(0,firstPositiveAt-started),
    lastSemanticChangeTimestampMs:lastSemanticChangeAt===null?null:Math.max(0,lastSemanticChangeAt-started),extensionActivated,
    sidebarRegionFound:!!snap.root,firstDetectionAtMs:timeToFirstPositiveMs,root:snap.root,rows:snap.rows});
  };
  const sample=fromMutation=>{
   if(finished)return;
   const now=Date.now();current=snapshot();if(fromMutation)mutationChecks++;
   if(firstPositiveAt!==null&&fromMutation&&current.signature===lastSignature)unrelatedMutationChecks++;
   if(current.rows.length>0){
    if(firstPositiveAt===null){firstPositiveAt=now;firstPositiveCount=current.rows.length;lastChangeAt=now;if(current.signature!==lastSignature||current.root!==lastRoot){conversationSignatureChanges++;lastSemanticChangeAt=now;semanticChangeObserved=true;}lastSignature=current.signature;lastRoot=current.root;stableChecks=1;stabilizationDeadline=absoluteDeadline;if(now>=acquireDeadline){lastSemanticChangeAt=now;semanticChangeObserved=true;}}
    else if(current.signature!==lastSignature||current.root!==lastRoot){conversationSignatureChanges++;lastSignature=current.signature;lastRoot=current.root;lastChangeAt=now;lastSemanticChangeAt=now;semanticChangeObserved=true;stableChecks=1;}
    else if(current.duplicateIdentityCount>0||current.missingIdentityCount>0){stableChecks=0;lastChangeAt=now;}
    else stableChecks++;
    stableCount=current.rows.length;
    if(stableChecks>=4&&now-lastChangeAt>=quietWindowMs&&current.root&&current.duplicateIdentityCount===0&&current.missingIdentityCount===0&&supportedConversationContext()){finishOnce('ready',current);return;}
   }else if(firstPositiveAt!==null){
    if(current.signature!==lastSignature||current.root!==lastRoot){conversationSignatureChanges++;lastSignature=current.signature;lastRoot=current.root;lastChangeAt=now;lastSemanticChangeAt=now;semanticChangeObserved=true;stableChecks=1;}
    stableCount=0;
   }else if(now>=acquireDeadline){
    // Atomic deadline recheck: late rows start their own bounded stabilization window.
    finalSnapshotCount=current.rows.length;
    if(finalSnapshotCount>0){sample(false);return;}
    finishOnce(current.root?'conversation_rows_timeout':'sidebar_unavailable',current);return;
   }
   if(firstPositiveAt!==null&&now>=acquireDeadline&&!semanticChangeObserved){finishOnce('conversation_rows_unstable',current);return;}
   if(firstPositiveAt!==null&&now>=acquireDeadline&&semanticChangeObserved&&!extensionActivated){extensionActivated=true;stabilizationDeadline=Math.min(Math.max(acquireDeadline,lastSemanticChangeAt??now)+stabilizationGraceMs,absoluteDeadline);}
   if(firstPositiveAt!==null&&now>=Math.min(stabilizationDeadline??absoluteDeadline,absoluteDeadline)){finishOnce('conversation_rows_unstable',current);return;}
   const nextDeadline=firstPositiveAt===null?acquireDeadline:Math.min(stabilizationDeadline??absoluteDeadline,absoluteDeadline);
   timer=setTimeout(()=>sample(false),Math.max(1,Math.min(pollMs,nextDeadline-now)));
  };
  try{observer=new MutationObserver(records=>{if(records?.length)sample(true);});observer.observe(document.documentElement||document,{childList:true,subtree:true,attributes:true});}catch{}
  sample(false);
 });
 window.gptWaitForConversationRowsReady=async(options={})=>{const r=await waitForConversationRowsReady(options.timeoutMs,Infinity,options);return {status:r.status,diagnosticStatus:r.diagnosticStatus,terminalReason:r.terminalReason,readinessTerminalReason:r.readinessTerminalReason,ready:r.ready,waitStarted:r.waitStarted,waitStartedAtMs:r.waitStartedAtMs,waitDurationMs:r.waitDurationMs,rowsAtFirstDetection:r.rowsAtFirstDetection,rowsAtStabilizedSnapshot:r.rowsAtStabilizedSnapshot,firstPositiveCount:r.firstPositiveCount,finalStableCount:r.finalStableCount,stableCount:r.stableCount,finalSnapshotCount:r.finalSnapshotCount,identityCount:r.identityCount,duplicateIdentityCount:r.duplicateIdentityCount,missingIdentityCount:r.missingIdentityCount,conversationSignatureChanges:r.conversationSignatureChanges,mutationChecks:r.mutationChecks,unrelatedMutationChecks:r.unrelatedMutationChecks,timeToFirstPositiveMs:r.timeToFirstPositiveMs,timeToStableMs:r.timeToStableMs,stableDurationMs:r.stableDurationMs,phaseABudgetMs:r.phaseABudgetMs,stabilizationGraceMs:r.stabilizationGraceMs,absoluteReadinessCapMs:r.absoluteReadinessCapMs,firstPositiveTimestampMs:r.firstPositiveTimestampMs,lastSemanticChangeTimestampMs:r.lastSemanticChangeTimestampMs,extensionActivated:r.extensionActivated,sidebarRegionFound:r.sidebarRegionFound};};
 const minimalMenuRow=(anchor,root)=>{
  let node=anchor,levels=0;
  while(node&&node!==root&&levels<8){
   node=node.parentElement;levels++;if(!node||node===root)break;
   const links=[...(node.querySelectorAll?.('a[href]')||[])].filter(link=>routeKind(link)==='conversation'&&isVisible(link));
   const menus=[...(node.querySelectorAll?.('button[aria-haspopup="menu"]')||[])].filter(button=>buttonLike(button)&&isVisible(button));
   if(links.length===1&&menus.length===1){
    const rr=rectOf(node),sr=rectOf(root);if(rr&&sr&&rr.height<sr.height*.8)return {row:node,trigger:menus[0],level:levels};
   }
   if(links.length>1||menus.length>1)return {row:null,trigger:null,level:levels,ambiguous:true,conversationLinks:links.length,menuButtons:menus.length};
  }
  return {row:null,trigger:null,level:levels,ambiguous:false,conversationLinks:0,menuButtons:0};
 };
 const dispatchMenuSequence=trigger=>{
  const dispatch=(type,pointer,buttons)=>{try{
   const r=trigger.getBoundingClientRect(),init={bubbles:true,cancelable:true,view:window,button:0,buttons,clientX:r.x+r.width/2,clientY:r.y+r.height/2};
   if(pointer)Object.assign(init,{pointerType:'mouse',isPrimary:true,pointerId:1});
   const C=pointer&&typeof PointerEvent==='function'?PointerEvent:(typeof MouseEvent==='function'?MouseEvent:Event);
   return trigger.dispatchEvent(new C(type,init))!==false;
  }catch{return false;}};
  return [dispatch('pointerdown',true,1),dispatch('mousedown',false,1),dispatch('pointerup',true,0),dispatch('mouseup',false,0),dispatch('click',false,0)].every(Boolean);
 };
 const ensureUnknownRowReasons=rows=>(Array.isArray(rows)?rows:[]).map(row=>row?.status==='unknown'?{...row,unknownReason:typeof row.unknownReason==='string'&&row.unknownReason?row.unknownReason:(typeof row.reason==='string'&&row.reason?row.reason:'unclassified_row')}:row);
 window.gptEnsureUnknownRowReasons=ensureUnknownRowReasons;
 const pinnedPrefixSummary=rows=>{
  const statuses=rows.map(row=>row.status),pinnedCount=statuses.filter(status=>status==='pinned').length,
   notPinnedCount=statuses.filter(status=>status==='not pinned').length,unknownCount=statuses.filter(status=>status==='unknown').length;
  let sawOrdinary=false,noncontiguous=false;
  for(const status of statuses){if(status==='not pinned')sawOrdinary=true;else if(status==='pinned'&&sawOrdinary)noncontiguous=true;}
  return {pinnedCount,notPinnedCount,unknownCount,contiguousPinnedPrefix:noncontiguous?'no':unknownCount?'unknown':pinnedCount?'yes':'unknown',
   hasNormalAfterPinned:notPinnedCount>0&&!noncontiguous&&!unknownCount};
 };
 window.gptSummarizePinnedPrefix=statuses=>pinnedPrefixSummary((Array.isArray(statuses)?statuses:[]).map(status=>({status})));
 window.gptInspectSidebarTopPosition=async(options={})=>{
  const started=Date.now(),readiness=await waitForConversationRowsReady(options.readinessTimeoutMs),selection=activeSidebarSnapshot(),root=readiness.root||null,top=readiness.ready?await inspectConversationListTopState(root,{normalizeFirstRow:true}):failedConversationListTopState(readiness.status,readiness),first=top.first;
  const r=first?rectOf(first):null;
  return {status:top.status,proven:top.proven,reason:top.reason,readiness:{status:readiness.status,terminalReason:readiness.terminalReason,ready:readiness.ready,waitStarted:readiness.waitStarted,waitStartedAtMs:readiness.waitStartedAtMs,waitDurationMs:readiness.waitDurationMs,rowsAtFirstDetection:readiness.rowsAtFirstDetection,rowsAtStabilizedSnapshot:readiness.rowsAtStabilizedSnapshot,firstPositiveCount:readiness.firstPositiveCount,stableCount:readiness.stableCount,finalSnapshotCount:readiness.finalSnapshotCount,timeToFirstPositiveMs:readiness.timeToFirstPositiveMs,timeToStableMs:readiness.timeToStableMs,stableDurationMs:readiness.stableDurationMs,phaseABudgetMs:readiness.phaseABudgetMs,stabilizationGraceMs:readiness.stabilizationGraceMs,absoluteReadinessCapMs:readiness.absoluteReadinessCapMs,firstPositiveTimestampMs:readiness.firstPositiveTimestampMs,lastSemanticChangeTimestampMs:readiness.lastSemanticChangeTimestampMs,extensionActivated:readiness.extensionActivated,sidebarRegionFound:readiness.sidebarRegionFound},activeSidebarSelection:{candidateCount:selection.rootCount,activeCandidateOrdinal:selection.activeCandidateOrdinal,renderedIntersectingCandidates:selection.renderedIntersectingCandidateCount,inactiveCandidates:selection.inactiveCandidateCount,activeConversationLinks:selection.activeCandidateLinkCount,activeVisibleConversationLinks:selection.visibleConversationLinkCount,duplicateConversationRows:selection.duplicateConversationRows},activeContextType:top.activeContextType,rowsOutsideActiveContext:top.rowsOutsideActiveContext,inactiveRowsExcluded:top.inactiveRowsExcluded,totalConversationLinks:top.totalConversationLinks,visibleConversationLinks:top.visibleConversationLinks,firstVisibleIndex:top.firstVisibleIndex,conversationRowsBefore:top.conversationRowsBefore,hiddenRowsBefore:top.hiddenRowsBefore,scrollableAncestorFound:top.scrollableAncestorFound,scrollAncestorFound:top.scrollableAncestorFound,scrollTop:top.scrollTop,scrollTopBefore:top.scrollTopBefore,scrollTopAfter:top.scrollTopAfter,viewportTop:top.viewportTop,viewportBottom:top.viewportBottom,precedingGeometry:top.precedingGeometry,normalization:top.normalization,virtualOffsetEvidence:top.virtualOffsetEvidence,virtualization:top.virtualization,version:PINNED_DIAGNOSTIC_VERSION,visibleRows:top.visibleConversationLinks,
   domConversationRowsBefore:top.conversationRowsBefore,hiddenOrOffscreenRowsBefore:top.hiddenRowsBefore,
   firstRow:{rect:r?{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}:null,index:top.firstVisibleIndex,rowsAbove:top.conversationRowsBefore},
   initial:{index:top.firstVisibleIndex,rowsAbove:top.conversationRowsBefore},scrollAncestorFound:top.scrollableAncestorFound,
   scrollAncestry:top.scrollAncestry,menuClicks:0,elapsedMs:Date.now()-started};
 };
 window.gptInspectVisiblePinnedRows=async(options={})=>{
  const started=Date.now(),initialRoute=String(location.pathname||'/'),hardMs=Math.max(1000,Math.min(600000,Number(options.hardTimeoutMs)||40000)),deadline=started+hardMs;
  const manualDiagnosticRun=typeof options.sidebarDiagnosticRunID==='string'&&options.sidebarDiagnosticRunID.length>0,manualDiagnosticReserveMs=Math.min(1000,Math.max(100,Math.floor(hardMs*.1)));let operationExceptionCategory='none';
  const safeExceptionCategory=error=>{const name=String(error?.name||'Error');return ['TypeError','RangeError','SyntaxError','SecurityError','TimeoutError'].includes(name)?name:'Error';};
  const emitSidebarDiagnosticStage=(stage,exceptionCategory='none')=>{if(!manualDiagnosticRun)return;try{window.webkit?.messageHandlers?.starredDiagnostic?.postMessage({sidebarDiagnosticRunID:options.sidebarDiagnosticRunID,visiblePinnedRowsStage:{stage,elapsedMs:Math.max(0,Math.min(hardMs,Date.now()-started)),exceptionCategory}});}catch{}};
  emitSidebarDiagnosticStage('operation_started');
  const cycleInternal=options.cycleToken&&options.cycleToken===window.gptListCycleConfig?.token;
  const activityInternal=options.includePinnedRecords===true&&typeof options.activityDiagnosticToken==='string'&&options.activityDiagnosticToken===window.gptPinnedActivityDiagnosticToken;
  const activeOperationToken=activityInternal?options.activityDiagnosticToken:null;
  if(activityInternal)emitPinnedActivityStage(options,'probe_started');
  const startingRateLimitSequence=window.gptRateLimitEvents?.reduce((max,event)=>Math.max(max,Number(event?.sequence)||0),0)||0;
  const setRateLimitStage=stage=>{if(activityInternal)window.gptSetRateLimitContext?.('isolated_prefix_diagnostic',activeOperationToken,stage);else if(cycleInternal)window.gptSetRateLimitContext?.('scheduler_discovery',options.cycleToken,stage);};
  const operationRateLimits=()=>((activityInternal||cycleInternal)?(window.gptRateLimitEvents||[]).filter(event=>event&&event.sequence>startingRateLimitSequence&&event.status===429):[]);
  const relevantPrefix429=()=>operationRateLimits().find(event=>{
   if(!['root_conversation_list','project_conversation_list'].includes(event.family)||!['sidebar_readiness','sidebar_top','prefix_classification','snapshot_reconciliation'].includes(event.occurredAtStage))return false;
   return activityInternal?event.owner==='isolated_prefix_diagnostic'&&event.generation===activeOperationToken:
    cycleInternal?event.owner==='scheduler_discovery'&&event.generation===options.cycleToken:false;
  })||null;
  const absoluteSnapshotSafetyCap=32,requestedRows=Number.isInteger(options.maxRows)?options.maxRows:20;
  const requestedTraversalBudget=Math.max(1,Math.min((activityInternal||cycleInternal)?absoluteSnapshotSafetyCap:20,requestedRows));
  let maxRows=requestedTraversalBudget,diagnosticFirstOrdinaryRow=null,diagnosticUnknownSeen=false,initialOverflow=false;
  const rows=[],pinnedIds=[],pinnedRoutes=new Map();let menuLeftOpen=false,stopReason='completed',prefixReason='unknown',root=null,scroller=null,atTop=false,scrollTop=null,topProof='not_run',topReason='not_run',top=null,readiness=null,preflight=null,currentStage='invoke_started',stageFailure=null,prefixStageEntered=false,prefixSnapshot=[],initialSnapshotCount=0,snapshotExpansionCount=0,finalSnapshotCount=0;
  let acceptedSemanticSnapshot=null,firstSemanticSnapshotChange=null;const semanticSnapshotStages=[];
  let traversalTerminalStage='not_terminal',traversalTerminalRowIndex=null,currentTraversalRowIndex=null,currentRowMenuCleanupResult='not_run',lastCompletedTraversalStage='not_started';
  const markTraversalTerminal=(stage,reason,rowIndex=currentTraversalRowIndex)=>{if(traversalTerminalStage==='not_terminal'){traversalTerminalStage=stage;traversalTerminalRowIndex=Number.isInteger(rowIndex)?rowIndex:null;}stopReason=reason;prefixReason=reason;};
  const semanticFingerprint=value=>{let hash=0x811c9dc5;for(let index=0;index<value.length;index++){hash^=value.charCodeAt(index);hash=Math.imul(hash,0x01000193);}return `fnv1a:${(hash>>>0).toString(16).padStart(8,'0')}`;};
  const readSemanticSnapshot=()=>{const source=[...(root?.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation').map(anchor=>({conversationId:conversationIdFromAnchor(anchor),routeType:routeType(anchor)})).filter(item=>item.conversationId&&item.routeType),unique=[],keys=new Set();for(const item of source){const key=`${item.routeType}:${item.conversationId}`;if(!keys.has(key)){keys.add(key);unique.push(key);}}const ordered=unique.join('\n'),sorted=[...unique].sort().join('\n');return {rowCount:source.length,identityCount:unique.length,duplicateIdentityCount:source.length-unique.length,keys:unique,setFingerprint:semanticFingerprint(sorted),orderFingerprint:semanticFingerprint(ordered)};};
  const traceSemanticSnapshot=cycleInternal||activityInternal;
  const recordSemanticSnapshotStage=(stage,precedingAction)=>{if(!traceSemanticSnapshot)return true;const current=readSemanticSnapshot();if(!acceptedSemanticSnapshot){acceptedSemanticSnapshot=current;initialSnapshotCount=current.identityCount;finalSnapshotCount=current.identityCount;semanticSnapshotStages.push({stage:'snapshot_ready',precedingAction:'readiness_accepted',baseline:true,rowCount:current.rowCount,identityCount:current.identityCount,duplicateIdentityCount:current.duplicateIdentityCount,setFingerprint:current.setFingerprint,orderFingerprint:current.orderFingerprint});lastCompletedTraversalStage='snapshot_ready';return true;}const prior=acceptedSemanticSnapshot,priorKeys=prior.keys,currentSet=new Set(current.keys),priorSet=new Set(priorKeys),addedCount=current.keys.filter(key=>!priorSet.has(key)).length,removedCount=priorKeys.filter(key=>!currentSet.has(key)).length,setChanged=addedCount>0||removedCount>0,orderChanged=current.orderFingerprint!==prior.orderFingerprint,entry={stage,precedingAction,baseline:false,rowCount:current.rowCount,identityCount:current.identityCount,duplicateIdentityCount:current.duplicateIdentityCount,setFingerprint:current.setFingerprint,orderFingerprint:current.orderFingerprint,previousRowCount:prior.rowCount,currentRowCount:current.rowCount,previousIdentityCount:prior.identityCount,currentIdentityCount:current.identityCount,setChanged,orderChanged,addedCount,removedCount,reordered:!setChanged&&orderChanged};semanticSnapshotStages.push(entry);if((setChanged||orderChanged)&&!firstSemanticSnapshotChange){firstSemanticSnapshotChange={...entry};if(cycleInternal){stopReason='sidebar_snapshot_unstable';prefixReason=stopReason;return false;}}lastCompletedTraversalStage=stage;return true;};
  let scrollUsed=false,scrollRestoreSuccessful=true,scrollContainer=null,initialScrollPosition=null,maximumScrollTopReached=null,maximumScrollTopCapacity=null,restoredScrollPosition=null,scrollOwnerCandidateCount=0,scrollOwnerReason='not_checked',scrolledRowIndex=null,rowVisibleAfterScroll=null,scrollAttempts=[],traversalBudgetMs=15000;
  const bounded=(predicate,ms)=>waitForBounded(predicate,Math.max(0,Math.min(ms,deadline-Date.now())),{cancelled:false});
  const stageRun=async(stage,fn,timeoutMs)=>{
   setRateLimitStage(stage==='readiness_started'?'sidebar_readiness':stage==='top_started'?'sidebar_top':stage==='prefix_started'?'prefix_classification':stage==='cleanup_started'?'prefix_cleanup':stage);
   if(manualDiagnosticRun){currentStage=stage;emitSidebarDiagnosticStage(stage);const boundedMs=Math.max(0,Math.min(timeoutMs,deadline-Date.now()-manualDiagnosticReserveMs));const result=await boundedDiagnosticAwait(stage,fn,boundedMs);if(result.status==='timeout'||result.status==='error'){stageFailure=result.reason;stopReason=result.reason;emitSidebarDiagnosticStage(stage,result.status==='timeout'?'TimeoutError':'Error');return null;}return result.value;}
   if(!activityInternal)return await fn();
   currentStage=stage;emitPinnedActivityStage(options,stage);
   const result=await boundedDiagnosticAwait(stage,fn,timeoutMs);
   if(result.status==='timeout'||result.status==='error'){stageFailure=result.reason;stopReason=result.reason;return null;}
   return result.value;
  };
  try{
   currentStage='readiness_started';emitPinnedActivityStage(options,currentStage);if(manualDiagnosticRun)emitSidebarDiagnosticStage('sidebar_lookup_started');
   const readinessBudget=18500;
   const readinessResult=await stageRun('readiness_started',()=>waitForPinnedReadinessPreflight({preflightTimeoutMs:Math.min(18000,Math.max(0,deadline-Date.now())),webViewVisible:options.webViewVisible,navigationActive:options.navigationActive,renderActivationElapsedMs:options.renderActivationElapsedMs,renderLeaseTimeToFirstConversationLinkMs:options.renderLeaseTimeToFirstConversationLinkMs}),readinessBudget);
   if(!readinessResult){readiness={status:stageFailure,terminalReason:stageFailure,ready:false,waitStarted:true,waitDurationMs:Math.min(readinessBudget,Date.now()-started),rowsAtFirstDetection:0,rowsAtStabilizedSnapshot:0,sidebarRegionFound:false};throw new Error(stageFailure);}
   preflight=readinessResult.preflight;readiness=readinessResult.readiness;
   if(manualDiagnosticRun)emitSidebarDiagnosticStage('document_ready');
   if(activityInternal)emitPinnedActivityStage(options,'readiness_preflight',{preflight});
   if(relevantPrefix429()){stopReason='http_429_relevant';prefixReason=stopReason;stageFailure=stopReason;throw new Error(stopReason);}
   if(!readiness){readiness={status:'error',terminalReason:'error',ready:false,waitStarted:true,waitDurationMs:Date.now()-started,rowsAtFirstDetection:0,rowsAtStabilizedSnapshot:0,sidebarRegionFound:false};}
   root=readiness.root||(preflight&&preflight.sidebarAvailable?activeSidebarSnapshot().root:null);
   if(manualDiagnosticRun)emitSidebarDiagnosticStage(root?'sidebar_found':'sidebar_not_found');
   emitPinnedActivityStage(options,'readiness_completed',{status:readiness.status,diagnosticStatus:readiness.diagnosticStatus,terminalReason:readiness.terminalReason,readinessTerminalReason:readiness.readinessTerminalReason,waitDurationMs:readiness.waitDurationMs,rowsAtFirstDetection:readiness.rowsAtFirstDetection,rowsAtStabilizedSnapshot:readiness.rowsAtStabilizedSnapshot,firstPositiveCount:readiness.firstPositiveCount,finalStableCount:readiness.finalStableCount,stableCount:readiness.stableCount,finalSnapshotCount:readiness.finalSnapshotCount,identityCount:readiness.identityCount,duplicateIdentityCount:readiness.duplicateIdentityCount,missingIdentityCount:readiness.missingIdentityCount,conversationSignatureChanges:readiness.conversationSignatureChanges,mutationChecks:readiness.mutationChecks,unrelatedMutationChecks:readiness.unrelatedMutationChecks,timeToFirstPositiveMs:readiness.timeToFirstPositiveMs,timeToStableMs:readiness.timeToStableMs,preflight});
   if(!readiness.ready){stopReason=readiness.status;prefixReason=readiness.status;topReason=readiness.status;top=failedConversationListTopState(readiness.status,readiness);}
   else {
    const sidebar=activeSidebarSnapshot();root=sidebar.root||root;
    if(!sidebar.visible||!root){stopReason='sidebar_unavailable';prefixReason='sidebar_unavailable';topReason='sidebar_unavailable';top=failedConversationListTopState('sidebar_unavailable',readiness);}
    else {
    if(activityInternal)emitPinnedActivityStage(options,'snapshot_ready',{snapshotCount:readiness.finalSnapshotCount||readiness.rowsAtStabilizedSnapshot||0});
    if(traceSemanticSnapshot)recordSemanticSnapshotStage('snapshot_ready','readiness_accepted');
    // Production discovery paginates by scrolling the sidebar. Both production
    // and isolated prefix flows therefore normalize the same list to its top.
    if(activityInternal){
     const ownerAnchor=[...(root.querySelectorAll?.('a[href]')||[])].find(item=>routeKind(item)==='conversation'&&actuallyRendered(item))||null;
     const ownerResolution=resolveUniqueSidebarScrollOwner(root,ownerAnchor);scrollOwnerCandidateCount=ownerResolution.candidates.length;scrollOwnerReason=ownerResolution.reason||'unique_owner';
     if(ownerResolution.owner){scrollContainer=ownerResolution.owner;initialScrollPosition=Number(scrollContainer.scrollTop)||0;maximumScrollTopReached=initialScrollPosition;maximumScrollTopCapacity=Math.max(0,(Number(scrollContainer.scrollHeight)||0)-(Number(scrollContainer.clientHeight)||0));}
     emitPinnedActivityStage(options,'scroll_owner_resolved',{found:!!ownerResolution.owner,candidateCount:scrollOwnerCandidateCount,reason:scrollOwnerReason,initialScrollTop:initialScrollPosition,maximumScrollTopCapacity});
    }
    if(traceSemanticSnapshot&&!recordSemanticSnapshotStage('before_top_proof','readiness_accepted')){stageFailure='sidebar_snapshot_unstable';throw new Error(stageFailure);}
    top=await stageRun('top_started',()=>inspectConversationListTopState(root,{normalizeFirstRow:true}),5000);if(!top){top=failedConversationListTopState(stageFailure,readiness);throw new Error(stageFailure);}emitPinnedActivityStage(options,'top_completed',{status:top.status,reason:top.reason,normalization:top.normalization});
    if(traceSemanticSnapshot&&!recordSemanticSnapshotStage('after_top_proof','top_proof')){stageFailure='sidebar_snapshot_unstable';throw new Error(stageFailure);}
    if(relevantPrefix429()){stopReason='http_429_relevant';prefixReason=stopReason;stageFailure=stopReason;throw new Error(stopReason);}
    if(activityInternal){
     const ownerAnchor=[...(root.querySelectorAll?.('a[href]')||[])].find(item=>routeKind(item)==='conversation'&&actuallyRendered(item))||null;
     const ownerResolution=resolveUniqueSidebarScrollOwner(root,ownerAnchor);scrollOwnerCandidateCount=ownerResolution.candidates.length;scrollOwnerReason=ownerResolution.reason||'unique_owner';
     if(scrollContainer&&ownerResolution.owner!==scrollContainer){scrollOwnerReason='scroll_owner_changed';}
     else if(!scrollContainer&&ownerResolution.owner){scrollContainer=ownerResolution.owner;initialScrollPosition=Number(scrollContainer.scrollTop)||0;maximumScrollTopReached=initialScrollPosition;maximumScrollTopCapacity=Math.max(0,(Number(scrollContainer.scrollHeight)||0)-(Number(scrollContainer.clientHeight)||0));}
     scroller=scrollOwnerReason==='unique_owner'?ownerResolution.owner:null;
    }else scroller=findSidebarScrollOwner(root,top.scroller);
    scrollTop=top.scrollTop;atTop=top.proven;
    const hasConversationRows=Number(top.totalConversationLinks)>0;
    topProof=atTop?'top_proven':hasConversationRows?'top_unproven':'not_run';topReason=top.reason;
    if(scroller){scrollContainer=scroller;if(initialScrollPosition===null)initialScrollPosition=Number.isFinite(Number(top.scrollTopBefore))?Number(top.scrollTopBefore):(Number(scroller.scrollTop)||0);}
    if(!atTop){stopReason=hasConversationRows?'top_unproven':(top.reason||'no_conversation_rows');prefixReason=top.reason||stopReason;}
    else {
     currentStage='prefix_started';
     const scrollOwner=scroller?{found:true,tag:String(scroller.tagName||'unknown').toLowerCase().slice(0,12),scrollTop:Math.round(Number(scroller.scrollTop)||0),scrollHeight:Math.round(Number(scroller.scrollHeight)||0),clientHeight:Math.round(Number(scroller.clientHeight)||0),overflowY:String(getComputedStyle(scroller)?.overflowY||'unknown').slice(0,12),connected:scroller.isConnected!==false}:{found:false,tag:'none',scrollTop:null,scrollHeight:null,clientHeight:null,overflowY:'unknown',connected:false};
     emitPinnedActivityStage(options,currentStage,{scrollOwner});
     prefixStageEntered=true;
     if(manualDiagnosticRun)emitSidebarDiagnosticStage('row_scan_started');
     const seenSnapshotKeys=new Set(),classified=new Map(),processed=new Set();
     const snapshotKey=item=>`${item.routeType}:${item.conversationId}`;
     const readCurrentSnapshot=()=>{const source=[...(root?.querySelectorAll?.('a[href]')||[])].filter(anchor=>routeKind(anchor)==='conversation').map(anchor=>({conversationId:conversationIdFromAnchor(anchor),routeType:routeType(anchor)})).filter(item=>item.conversationId&&item.routeType);const unique=[];const keys=new Set();for(const item of source){const key=snapshotKey(item);if(!keys.has(key)){keys.add(key);unique.push(item);}}return unique;};
     const initialSnapshot=readCurrentSnapshot();initialSnapshotCount=initialSnapshot.length;finalSnapshotCount=initialSnapshotCount;
     if((activityInternal||cycleInternal)&&initialSnapshotCount>absoluteSnapshotSafetyCap){
      prefixSnapshot=[];maxRows=absoluteSnapshotSafetyCap;initialOverflow=true;stopReason='snapshot_exceeds_traversal_cap';prefixReason=stopReason;
      markTraversalTerminal('snapshot_preflight',stopReason,0);
     }else{
      if(activityInternal||cycleInternal){
       const snapshotMargin=Math.max(2,Math.ceil(initialSnapshotCount*.1));
       maxRows=Math.min(absoluteSnapshotSafetyCap,Math.max(requestedTraversalBudget,initialSnapshotCount+snapshotMargin));
      }
      initialOverflow=initialSnapshotCount>maxRows;
      prefixSnapshot=(activityInternal||cycleInternal)?initialSnapshot:initialSnapshot.slice(0,maxRows);
     }
     traversalBudgetMs=(activityInternal||cycleInternal)?Math.min(90000,Math.max(15000,5000+Math.min(absoluteSnapshotSafetyCap,prefixSnapshot.length)*2500)):15000;
     const prefixDeadline=Date.now()+Math.min(traversalBudgetMs,Math.max(0,deadline-Date.now()-(manualDiagnosticRun?manualDiagnosticReserveMs:10000)));
     if(activityInternal||cycleInternal)emitPinnedActivityStage(options,'traversal_started',{snapshotCount:initialSnapshotCount,requiredTraversalRows:initialSnapshotCount,traversalBudget:maxRows,absoluteTraversalCap:absoluteSnapshotSafetyCap,budgetSufficient:initialSnapshotCount<=absoluteSnapshotSafetyCap,traversalBudgetMs});
     if(activityInternal)emitPinnedActivityStage(options,'prefix_started',{snapshotCount:initialSnapshotCount,traversalBudget:maxRows,traversalBudgetMs,cleanupReserveMs:10000});
     for(const item of prefixSnapshot)seenSnapshotKeys.add(snapshotKey(item));
     const domCount=()=>readCurrentSnapshot().length;
     const resolveSnapshotRow=item=>[...(root?.querySelectorAll?.('a[href]')||[])].find(anchor=>routeKind(anchor)==='conversation'&&routeType(anchor)===item.routeType&&conversationIdFromAnchor(anchor)===item.conversationId)||null;
     const validateSnapshotAfterScroll=()=>{
      if(String(location.pathname||'/')!==initialRoute)return 'sidebar_route_changed';
      const expected=prefixSnapshot.map(snapshotKey),live=readCurrentSnapshot().map(snapshotKey);
      const expectedSet=new Set(expected),liveSet=new Set(live);
      if(expected.length!==live.length||expected.some(key=>!liveSet.has(key)))return 'sidebar_snapshot_identity_set_changed';
      if(live.length!==expected.length||live.some((key,index)=>key!==expected[index]))return 'sidebar_snapshot_identity_order_changed';
      return null;
     };
     const reconcileSnapshot=()=>{
      const live=readCurrentSnapshot();finalSnapshotCount=live.length;
      const added=live.filter(item=>!seenSnapshotKeys.has(snapshotKey(item)));
      if(!added.length)return true;
      const liveKeys=new Set(live.map(snapshotKey));
      const expanded=[...live,...prefixSnapshot.filter(item=>!liveKeys.has(snapshotKey(item)))];
      if(live.length>maxRows||expanded.length>maxRows){markTraversalTerminal('snapshot_reconciliation',live.length>absoluteSnapshotSafetyCap||expanded.length>absoluteSnapshotSafetyCap?'snapshot_exceeds_traversal_cap':'snapshot_exceeds_traversal_budget',rows.length);return false;}
      if(snapshotExpansionCount>=3){markTraversalTerminal('snapshot_reconciliation','sidebar_snapshot_unstable',rows.length);return false;}
      snapshotExpansionCount++;
      for(const item of added)seenSnapshotKeys.add(snapshotKey(item));
      prefixSnapshot=expanded;
      return true;
     };
    if(!prefixSnapshot.length&&stopReason==='completed'){stopReason='no_conversation_rows';prefixReason=stopReason;}
     while(stopReason==='completed'){
      setRateLimitStage('prefix_classification');
      if(activityInternal&&window.gptPinnedActivityDiagnosticCancelled===options.activityDiagnosticToken){stopReason='cancelled';prefixReason=stopReason;break;}
      if(Date.now()>=deadline||(activityInternal||manualDiagnosticRun)&&Date.now()>=prefixDeadline){stopReason='traversal_timeout';prefixReason=stopReason;stageFailure=stopReason;break;}
      if(relevantPrefix429()){stopReason='http_429_relevant';prefixReason=stopReason;stageFailure=stopReason;break;}
      const nextIndex=prefixSnapshot.findIndex(item=>!processed.has(snapshotKey(item)));
      if(nextIndex<0){stopReason=activityInternal&&diagnosticFirstOrdinaryRow!==null?'first_not_pinned':initialOverflow||finalSnapshotCount>maxRows?'snapshot_exceeds_traversal_budget':'rows_exhausted_before_not_pinned';prefixReason=stopReason;if(stopReason==='snapshot_exceeds_traversal_budget')markTraversalTerminal('snapshot_reconciliation',stopReason,rows[rows.length-1]?.row??null);break;}
      const snapshotRow=prefixSnapshot[nextIndex],key=snapshotKey(snapshotRow),rowNumber=nextIndex+1,id=snapshotRow.conversationId;
      currentTraversalRowIndex=rowNumber;currentRowMenuCleanupResult='not_run';
      if(traceSemanticSnapshot&&!recordSemanticSnapshotStage(`before_row_${rowNumber}`,'previous_row_processing')){stageFailure='sidebar_snapshot_unstable';break;}
      processed.add(key);
      if(classified.has(key)){
       const prior=classified.get(key);if(prior.status==='not pinned'&&diagnosticFirstOrdinaryRow===null)diagnosticFirstOrdinaryRow=rowNumber;if(prior.status==='unknown')diagnosticUnknownSeen=true;continue;
      }
      let anchor=resolveSnapshotRow(snapshotRow);const beforeMenuCount=domCount();let status='unknown',reason='unclassified',opened=false,closed=true,menu=null,trigger=null,afterCleanupCount=beforeMenuCount,scrolledIntoView=false,menuItemCount=0,hasPinAction=false,hasUnpinAction=false,cleanupAttempts=[],cleanupTerminalReason='none',rowReplacedDuringScroll=false,scrollFailureReason='none';
      if(!anchor){reason='row_missing_after_snapshot';stopReason=reason;prefixReason=reason;rows.push({row:rowNumber,status,reason,menuOpened:false,menuClosed:true,domConversationsBeforeMenu:beforeMenuCount,domConversationsAfterCleanup:afterCleanupCount});if(activityInternal)emitPinnedActivityStage(options,'row_classified',{processedRows:rows.length,pinnedCount:rows.filter(row=>row.status==='pinned').length,ordinaryCount:rows.filter(row=>row.status==='not pinned').length,unknownCount:rows.filter(row=>row.status==='unknown').length,firstOrdinaryFound:rows.some(row=>row.status==='not pinned')});break;}
      let candidate=minimalMenuRow(anchor,root);trigger=candidate.trigger;
      if(relevantPrefix429()){stopReason='http_429_relevant';prefixReason=stopReason;stageFailure=stopReason;break;}
      if(openPopupCandidates().length){reason='preexisting_popup_open';stopReason=reason;prefixReason=reason;menuLeftOpen=true;rows.push({row:rowNumber,status,reason,menuOpened:false,menuClosed:false,domConversationsBeforeMenu:beforeMenuCount,domConversationsAfterCleanup:afterCleanupCount});break;}
      if(!candidate.row||!trigger||candidate.ambiguous)reason=candidate.ambiguous?'ambiguous_row_structure':'row_trigger_unavailable';
      else if(trigger.getAttribute?.('aria-haspopup')!=='menu')reason='menu_semantics_unconfirmed';
      else if(!viewportVisibleInSidebar(anchor,root,scroller)){
       if(traceSemanticSnapshot&&!recordSemanticSnapshotStage(`before_scroll_row_${rowNumber}`,'row_visibility_check')){stageFailure='sidebar_snapshot_unstable';break;}
       const positioned=await scrollConversationRowIntoView(anchor,root,scroller,()=>resolveSnapshotRow(snapshotRow),{strictDiagnosticOwner:activityInternal,validateSnapshot:activityInternal?validateSnapshotAfterScroll:null,rowIndex:rowNumber});
       if(traceSemanticSnapshot&&!recordSemanticSnapshotStage(`after_scroll_settlement_row_${rowNumber}`,'bounded_scroll')){stageFailure='sidebar_snapshot_unstable';break;}
       if(activityInternal&&Array.isArray(positioned.attempts))scrollAttempts.push(...positioned.attempts);
       if(positioned.container){scrollContainer=positioned.container;if(initialScrollPosition===null)initialScrollPosition=positioned.initialScrollTop;}
       if(positioned.ownerCandidateCount!==null&&positioned.ownerCandidateCount!==undefined)scrollOwnerCandidateCount=positioned.ownerCandidateCount;
       if(positioned.container)maximumScrollTopReached=Math.max(Number(maximumScrollTopReached)||0,Number(positioned.maximumReached??positioned.scrollTopAfter)||0);
       if(positioned.used){scrollUsed=true;scrolledRowIndex=rowNumber;scrolledIntoView=true;}
       rowReplacedDuringScroll=positioned.rowReplaced===true;scrollFailureReason=positioned.reason||'none';
       rowVisibleAfterScroll=positioned.visible;
       if(positioned.reason){reason=positioned.reason;if(activityInternal){stopReason=positioned.reason;prefixReason=positioned.reason;}}
       else{
        anchor=positioned.anchor||resolveSnapshotRow(snapshotRow);
        if(traceSemanticSnapshot&&!recordSemanticSnapshotStage(`after_row_reresolve_${rowNumber}`,'scroll_settlement')){stageFailure='sidebar_snapshot_unstable';break;}
        if(!anchor)reason='row_missing_after_snapshot';
        else{candidate=minimalMenuRow(anchor,root);trigger=candidate.trigger;
         if(!candidate.row||!trigger||candidate.ambiguous)reason=candidate.ambiguous?'ambiguous_row_structure':'row_trigger_unavailable';
         else if(trigger.getAttribute?.('aria-haspopup')!=='menu')reason='menu_semantics_unconfirmed';
        }
       }
       if(reason==='unclassified'){
        // Continue through the existing menu flow after the fresh row/trigger resolution.
       }
      }
      if(reason==='unclassified'){
       if(!candidate.row||!trigger||candidate.ambiguous)reason=candidate.ambiguous?'ambiguous_row_structure':'row_trigger_unavailable';
       else if(trigger.getAttribute?.('aria-haspopup')!=='menu')reason='menu_semantics_unconfirmed';
       else if(!viewportVisibleInSidebar(anchor,root,scroller||scrollContainer))reason='row_not_reached_after_scroll';
       else {
       try{
        dispatchMenuSequence(trigger);
        await bounded(()=>openPopupCandidates().length>0,Math.min(1500,activityInternal?Math.max(0,prefixDeadline-Date.now()):Infinity));
        if(activityInternal&&window.gptPinnedActivityDiagnosticCancelled===options.activityDiagnosticToken){stopReason='cancelled';prefixReason=stopReason;break;}
        menu=openPopupCandidates()[0]||null;opened=!!menu;
        if(menu){const actions=[...(menu.querySelectorAll?.('[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],button')||[])].map(safeActionClass);menuItemCount=actions.length;hasPinAction=actions.includes('pin');hasUnpinAction=actions.includes('unpin');if(hasPinAction!==hasUnpinAction)status=hasUnpinAction?'pinned':'not pinned';reason=hasPinAction===hasUnpinAction?'pin_action_unproven':hasUnpinAction?'unpin_action_available':'pin_action_available';if((cycleInternal||activityInternal)&&status==='pinned'&&id){pinnedIds.push(id);const exactRoute=exactConversationRouteFromAnchor(anchor);if(exactRoute)pinnedRoutes.set(id,exactRoute);}}
        else reason=Date.now()>=deadline?'row_timeout':'menu_not_found';
       }catch{reason='row_inspection_error';}
       finally{
        sendEscape();
        if(activityInternal){
         const progressRows=[...rows,{status}],counts={pinnedCount:progressRows.filter(row=>row.status==='pinned').length,
          ordinaryCount:progressRows.filter(row=>row.status==='not pinned').length,unknownCount:progressRows.filter(row=>row.status==='unknown').length};
         emitPinnedActivityStage(options,'menu_cleanup_started',{row:rowNumber,processedRows:progressRows.length,...counts,firstOrdinaryFound:progressRows.some(row=>row.status==='not pinned')});
        }
        else{currentStage='cleanup_started';emitPinnedActivityStage(options,currentStage);}
        const targetMenuVisible=()=>!!menu&&menu.isConnected!==false&&isVisible(menu)&&openPopupCandidates().includes(menu);
        const otherMenuVisible=()=>openPopupCandidates().some(candidate=>candidate!==menu);
        const cleanupAttempt=async(method,retry,attempt,triggerReplaced=false)=>{
         const triggerConnected=!!trigger&&trigger.isConnected!==false&&!!anchor&&anchor.isConnected!==false;
         const menuVisibleBefore=targetMenuVisible(),attemptStarted=Date.now();
         if(attempt)try{await attempt();}catch{}
         const immediate=!targetMenuVisible();
         const settled=immediate||await bounded(()=>!targetMenuVisible(),method==='Escape'?350:350);
         const menuVisibleAfter=targetMenuVisible();
         const terminalReason=menuVisibleAfter?(method==='Escape'?'escape_ignored':'trigger_click_ignored'):
          otherMenuVisible()?'different_menu_remained_open':!triggerConnected&&menuVisibleBefore?'row_replaced_during_cleanup':'none';
         const event={row:rowNumber,method,triggerConnected,triggerReplaced,menuVisibleBefore,menuVisibleAfter,elapsedMs:Date.now()-attemptStarted,retry,terminalReason};
         cleanupAttempts.push(event);
         if(activityInternal)emitPinnedActivityStage(options,'menu_cleanup_attempt',event);
         return {settled,terminalReason};
        };
        const escapeAttempt=await cleanupAttempt('Escape',1,()=>sendEscape());
        if(escapeAttempt.terminalReason==='different_menu_remained_open'){
         closed=false;cleanupTerminalReason=escapeAttempt.terminalReason;
        }else if(!targetMenuVisible()){
         closed=!otherMenuVisible();if(!closed)cleanupTerminalReason='different_menu_remained_open';
        }else{
         const originalTrigger=trigger,liveAnchor=resolveSnapshotRow(snapshotRow);
         const liveTrigger=liveAnchor?minimalMenuRow(liveAnchor,root).trigger:null;
         const triggerWasReplaced=!liveAnchor||!liveTrigger;
         if(triggerWasReplaced){closed=false;cleanupTerminalReason='row_replaced_during_cleanup';}
         else{
          anchor=liveAnchor;trigger=liveTrigger;
          const fallback=await cleanupAttempt('trigger_toggle',2,()=>trigger.click?.(),liveTrigger!==originalTrigger);
          closed=!targetMenuVisible()&&!otherMenuVisible();
          cleanupTerminalReason=closed?'none':fallback.terminalReason;
         }
        }
        afterCleanupCount=domCount();menuLeftOpen=!closed;
        if(activityInternal)emitPinnedActivityStage(options,'menu_cleanup_completed',{successful:closed,row:rowNumber,terminalReason:cleanupTerminalReason,attempts:cleanupAttempts});
       }
      }
      }
      currentRowMenuCleanupResult=opened?(closed?'success':'failed'):'not_run';
      if(!closed){
       if(activityInternal){stopReason=Date.now()>=deadline?'menu_cleanup_timeout':'menu_cleanup_failed';prefixReason=stopReason;stageFailure=stopReason==='menu_cleanup_timeout'?stopReason:null;}
       else{status='unknown';reason='cleanup_failed';stopReason=Date.now()>=deadline?'stage_timeout:cleanup_started':'cleanup_failed';prefixReason=reason;stageFailure=stopReason.startsWith('stage_timeout:')?stopReason:null;}
      }
      const unknownReason=status!=='unknown'?null:reason==='row_trigger_unavailable'?'menu_trigger_missing':reason==='menu_not_found'?'menu_failed_to_open':reason==='pin_action_unproven'?(menuItemCount===0?'menu_items_missing':hasPinAction&&hasUnpinAction?'ambiguous_actions':'pin_and_unpin_action_missing'):reason==='row_missing_after_snapshot'?'snapshot_changed':reason==='ambiguous_row_structure'?'unsupported_row_shape':reason;
      const rowResult={row:rowNumber,status,reason,unknownReason,triggerPresent:!!trigger,menuOpened:opened,menuItemCount,hasPinAction,hasUnpinAction,rowStillConnected:!!anchor&&anchor.isConnected!==false,menuClosed:closed,cleanupAttempts,cleanupTerminalReason,scrolledIntoView,rowReplacedDuringScroll,scrollFailureReason,domConversationsBeforeMenu:beforeMenuCount,domConversationsAfterCleanup:afterCleanupCount};rows.push(rowResult);classified.set(key,rowResult);
      if(traceSemanticSnapshot&&(!recordSemanticSnapshotStage(`after_menu_cleanup_row_${rowNumber}`,'menu_classification_and_cleanup')||!recordSemanticSnapshotStage(`after_row_classification_${rowNumber}`,'row_result_recorded'))){if(cycleInternal){stageFailure='sidebar_snapshot_unstable';break;}}
      if(activityInternal)emitPinnedActivityStage(options,'row_classified',{processedRows:rows.length,pinnedCount:rows.filter(row=>row.status==='pinned').length,ordinaryCount:rows.filter(row=>row.status==='not pinned').length,unknownCount:rows.filter(row=>row.status==='unknown').length,firstOrdinaryFound:rows.some(row=>row.status==='not pinned')});
      if(closed&&!reconcileSnapshot())break;
      setRateLimitStage('snapshot_reconciliation');
      if(relevantPrefix429()){stopReason='http_429_relevant';prefixReason=stopReason;stageFailure=stopReason;break;}
      if(!closed)break;
      if((activityInternal||manualDiagnosticRun)&&Date.now()>=prefixDeadline){stopReason='traversal_timeout';prefixReason=stopReason;stageFailure=stopReason;break;}
      if(status==='not pinned'){
       if(activityInternal){if(diagnosticFirstOrdinaryRow===null)diagnosticFirstOrdinaryRow=rowNumber;}
       else{stopReason='first_not_pinned';prefixReason='first_not_pinned';break;}
      }
      if(status==='unknown'){
       if(activityInternal)diagnosticUnknownSeen=true;
       else{stopReason=reason||'unknown_row';prefixReason=stopReason;break;}
      }
     }
    }
    }
   }
   if(manualDiagnosticRun)emitSidebarDiagnosticStage('row_scan_finished');
  }catch(error){if(!stageFailure){stopReason=Date.now()>=deadline?'hard_timeout':'internal_traversal_error';stageFailure=stopReason;}if(prefixReason==='unknown')prefixReason=stageFailure||stopReason;if(manualDiagnosticRun){operationExceptionCategory=String(stageFailure||'').startsWith('stage_timeout')?'TimeoutError':safeExceptionCategory(error);emitSidebarDiagnosticStage('row_scan_finished',operationExceptionCategory);}}
  if(scrollContainer&&initialScrollPosition!==null){try{if(activityInternal&&scrollContainer.isConnected===false)scrollRestoreSuccessful=false;else{scrollContainer.scrollTop=initialScrollPosition;if(typeof window.requestAnimationFrame==='function')await waitForFramesBounded(2,400);else await new Promise(resolve=>setTimeout(resolve,60));scrollRestoreSuccessful=Math.abs((Number(scrollContainer.scrollTop)||0)-initialScrollPosition)<=1;}restoredScrollPosition=Number(scrollContainer.scrollTop)||0;}catch{scrollRestoreSuccessful=false;}}
  if(traceSemanticSnapshot&&['completed','first_not_pinned'].includes(stopReason)&&!recordSemanticSnapshotStage('before_activity_resolution','prefix_traversal')&&cycleInternal)stageFailure='sidebar_snapshot_unstable';
  const relevantRateLimit=relevantPrefix429(),rateLimitEvent=relevantRateLimit||operationRateLimits()[0]||null,rateLimitRelevant=!!relevantRateLimit;
  if(activityInternal)window.gptSetRateLimitContext?.('unrelated_passive_traffic',null,'page_idle');
  const prefix=pinnedPrefixSummary(rows),firstNotPinnedFound=rows.some(row=>row.status==='not pinned');
  if(activityInternal&&diagnosticFirstOrdinaryRow!==null&&!['menu_cleanup_timeout','menu_cleanup_failed'].includes(stopReason)){
   if(diagnosticUnknownSeen||prefix.unknownCount>0){stopReason='unknown_row_in_stable_snapshot';prefixReason=stopReason;}
   else if(prefix.contiguousPinnedPrefix==='no'){stopReason='pinned_after_first_ordinary';prefixReason=stopReason;}
   else{stopReason='first_not_pinned';prefixReason='first_not_pinned';}
  }
  if(traversalTerminalStage==='not_terminal'&&stopReason!=='completed'){
   traversalTerminalStage=firstSemanticSnapshotChange?firstSemanticSnapshotChange.stage:
   stopReason==='snapshot_exceeds_traversal_cap'?'snapshot_preflight':stopReason==='snapshot_exceeds_traversal_budget'||stopReason==='sidebar_snapshot_unstable'?'snapshot_reconciliation':
    stopReason.startsWith('scroll_')||stopReason==='row_not_reached_after_scroll'?'scroll_target':
    stopReason.includes('menu')||stopReason.includes('cleanup')?'menu_cleanup':
    stopReason==='cancelled'?'cancellation':stopReason.includes('timeout')?'timeout':stopReason==='internal_traversal_error'?'internal_traversal':
    stopReason==='http_429_relevant'?'rate_limit':stopReason==='bridge_result_missing'?'bridge_promise':'prefix_traversal';
   traversalTerminalRowIndex=currentTraversalRowIndex??rows[rows.length-1]?.row??null;
  }
  const complete=atTop&&!(cycleInternal&&firstSemanticSnapshotChange)&&rows.length>0&&rows.every(row=>row.status!=='unknown'&&(!activityInternal||row.menuClosed))&&firstNotPinnedFound&&prefix.hasNormalAfterPinned&&prefix.contiguousPinnedPrefix!=='no';
  const timestampEligible=activityInternal&&complete&&pinnedIds.length>0;
  let timestampRecords=null;
  if(timestampEligible){
   try{
    const captured=window.gptResolvePinnedRecords?.(pinnedIds)||[],byId=new Map(captured.filter(record=>record&&typeof record.conversationId==='string').map(record=>[record.conversationId,record]));
    timestampRecords=pinnedIds.map(conversationId=>({...byId.get(conversationId),conversationId,frontendRoute:pinnedRoutes.get(conversationId)||null}));
   }catch{timestampRecords=pinnedIds.map(conversationId=>({conversationId,frontendRoute:pinnedRoutes.get(conversationId)||null}));}
  }
  if(activityInternal&&prefixStageEntered)emitPinnedActivityStage(options,'prefix_completed',{status:stageFailure||stopReason,prefixComplete:complete,snapshotCount:prefixSnapshot.length,finalSnapshotCount,processedRows:rows.length,pinnedCount:prefix.pinnedCount,ordinaryCount:prefix.notPinnedCount,unknownCount:prefix.unknownCount,firstOrdinaryFound:rows.some(row=>row.status==='not pinned'),traversalBudgetMs,cleanupReserveMs:10000});
  const timestampDispatchReason=!activityInternal?'not_isolated_activity_operation':!complete?'prefix_incomplete':pinnedIds.length===0?'pinned_ids_empty':null;
  if(activityInternal)emitPinnedActivityStage(options,'timestamp_dispatch_evaluated',{allowed:timestampEligible,prefixComplete:complete,pinnedCount:pinnedIds.length,reason:timestampDispatchReason||'none'});
  if(activityInternal&&timestampEligible)emitPinnedActivityStage(options,'timestamp_dispatch_allowed',{pinnedCount:pinnedIds.length});
  else if(activityInternal)emitPinnedActivityStage(options,'timestamp_dispatch_blocked',{reason:timestampDispatchReason||'timestamp_dispatch_blocked'});
  if(activityInternal){
   emitPinnedActivityStage(options,'cleanup_started');emitPinnedActivityStage(options,'cleanup_completed',{successful:!menuLeftOpen});
   if(timestampEligible)currentStage='timestamp_dispatch_allowed';
   else{currentStage='finished';emitPinnedActivityStage(options,'finished',{status:stageFailure||stopReason});}
  }
  let source=null;if(options.cycleToken){try{source=window.gptSummarizePinnedLinkSources?.(pinnedIds)||null;}catch{}}
  const safeSource=source?{matched:source.networkMatchedCount>0,networkMatchedCount:source.networkMatchedCount||0,pinnedLinkCount:source.pinnedLinkCount||0,
   updatedAtCount:source.updatedAtCount||0,starredTrueSourceAvailable:source.starredTrueSourceAvailable===true,
   starredTrueOverlapCount:source.starredTrueOverlapCount||0,baseOverlapCount:source.baseOverlapCount||0,sources:source.sources||[],observedStreams:source.observedStreams||[]}:null;
 const summaryRoot=root||readiness?.root||null;
  if(manualDiagnosticRun)emitSidebarDiagnosticStage('route_template_scan_started');
  const recognizedRouteTemplates=new Set(),routeScanDeadline=Math.min(deadline,Date.now()+250);
  for(const row of prefixSnapshot.slice(0,256)){if(Date.now()>=routeScanDeadline)break;if(row.routeType==='conversation')recognizedRouteTemplates.add('/c/:id');else if(row.routeType==='g_conversation')recognizedRouteTemplates.add('/g/:id/c/:id');}
  const scrollContainerCount=(top?.scrollAncestry||[]).filter(item=>item?.canScroll===true).length||(scroller?1:0);
  let navPresent=false,asidePresent=false;try{navPresent=!!document.querySelector?.('nav,[role="navigation"]');asidePresent=!!document.querySelector?.('aside');}catch(error){operationExceptionCategory=safeExceptionCategory(error);}
  if(manualDiagnosticRun)emitSidebarDiagnosticStage('route_template_scan_finished',operationExceptionCategory);
  const sidebarDiagnosticSummary={result:complete&&operationExceptionCategory==='none'?'success':'failure',detectedRowCount:Math.max(rows.length,finalSnapshotCount,readiness?.finalSnapshotCount||0),pinnedRowCandidateCount:prefix.pinnedCount,recognizedRouteTemplateCount:recognizedRouteTemplates.size,sidebarPresent:!!summaryRoot,navPresent,asidePresent,scrollContainerCount,reason:String(complete?'none':prefixReason||stopReason).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80),exceptionCategory:operationExceptionCategory};
  const internal=cycleInternal?{pinnedRecords:(window.gptResolvePinnedRecords?.(pinnedIds)||pinnedIds.map(conversationId=>({conversationId}))).map(record=>({...record,frontendRoute:pinnedRoutes.get(record.conversationId)||null}))}:timestampRecords?{pinnedRecords:timestampRecords}:{};
  const safeUnknownRowDiagnostic=(rowResult,index)=>{
   const snapshotRow=prefixSnapshot[index];
   const anchor=snapshotRow?[...(root?.querySelectorAll?.('a[href]')||[])].find(item=>routeKind(item)==='conversation'&&routeType(item)===snapshotRow.routeType&&conversationIdFromAnchor(item)===snapshotRow.conversationId)||null:null;
   const route=anchor?routeKind(anchor):'unknown',template=anchor?safeRouteTemplate(anchor).replace(/<id>/g,':id'):'/unknown';
   const attributes=[...(anchor?.attributes||[])].map(attribute=>String(attribute?.name||'').toLowerCase()).filter(name=>/^(data|aria)-[a-z0-9_-]{1,48}$/.test(name));
   const dataAttributeNames=[...new Set(attributes.filter(name=>name.startsWith('data-')))].slice(0,16);
   const ariaAttributeNames=[...new Set(attributes.filter(name=>name.startsWith('aria-')))].slice(0,16);
   const octane=!!anchor?.hasAttribute?.('data-octane-navigation-item');
   let visible=false;try{visible=!!anchor&&isVisible(anchor);}catch{}
   const navigationClassification=route==='conversation'?'conversation_row':route==='project'?'project_navigation_row':route==='unknown'?'unclassified_navigation_row':'navigation_action_row';
   const structuralClassification=route==='conversation'?(octane?'octane_conversation_row_variant':'conversation_row_variant'):route==='project'?'project_navigation_row':navigationClassification==='navigation_action_row'?'navigation_action_row':'unclassified_sidebar_row';
   const safeReason=['menu_trigger_missing','menu_failed_to_open','menu_items_missing','ambiguous_actions','pin_and_unpin_action_missing','snapshot_changed','unsupported_row_shape','cleanup_failed','row_missing_after_snapshot'].includes(rowResult.unknownReason)?rowResult.unknownReason:'unknown_pin_state';
   return {positionIndex:Math.max(1,Math.min(256,Number(rowResult.row)||index+1)),tag:String(anchor?.tagName||'unknown').toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,16)||'unknown',routeTemplate:template.slice(0,80),hasHref:!!anchor?.getAttribute?.('href'),hasOctaneNavigationItem:octane,dataAttributeNames,ariaAttributeNames,visible,conversationRouteClassification:route,navigationRowClassification:navigationClassification,pinnedStarredClassification:'unknown',structuralClassification,rejectionReason:safeReason};
  };
  const unknownRowDiagnostics=rows.filter(row=>row.status==='unknown').slice(0,20).map(row=>safeUnknownRowDiagnostic(row,Math.max(0,(row.row||1)-1)));
  return {...internal,sidebarDiagnosticSummary,version:PINNED_DIAGNOSTIC_VERSION,diagnosticStage:currentStage,timestampStage:timestampEligible?'started':complete?'skipped_no_pinned_chats':'skipped_prefix_incomplete',timestampDispatch:{evaluated:activityInternal,allowed:timestampEligible,reason:timestampDispatchReason||'none',itemsExpected:timestampEligible?timestampRecords?.length||0:0},stageFailure,snapshotTrace:traceSemanticSnapshot?{baseline:acceptedSemanticSnapshot?{rowCount:acceptedSemanticSnapshot.rowCount,identityCount:acceptedSemanticSnapshot.identityCount,duplicateIdentityCount:acceptedSemanticSnapshot.duplicateIdentityCount,setFingerprint:acceptedSemanticSnapshot.setFingerprint,orderFingerprint:acceptedSemanticSnapshot.orderFingerprint}:null,stages:semanticSnapshotStages,firstChange:firstSemanticSnapshotChange}:null,http429:{observed:!!rateLimitEvent,family:rateLimitEvent?.family||'unknown',owner:rateLimitEvent?.owner||'none',status:rateLimitEvent?.status||null,occurredAtStage:rateLimitEvent?.occurredAtStage||'none',relevant:rateLimitRelevant},preflight:preflight?{...preflight,final:undefined}:null,rowsAttempted:rows.length,rowsInspected:rows.length,rowsCompleted:rows.filter(row=>row.menuClosed).length,rows:ensureUnknownRowReasons(rows),
   readiness:readiness?{status:readiness.status,diagnosticStatus:readiness.diagnosticStatus,rawStatus:readiness.rawStatus||readiness.status,terminalReason:readiness.terminalReason,ready:readiness.ready,waitStarted:readiness.waitStarted,waitStartedAtMs:readiness.waitStartedAtMs,waitDurationMs:readiness.waitDurationMs,rowsAtFirstDetection:readiness.rowsAtFirstDetection,rowsAtStabilizedSnapshot:readiness.rowsAtStabilizedSnapshot,firstPositiveCount:readiness.firstPositiveCount,finalStableCount:readiness.finalStableCount,stableCount:readiness.stableCount,finalSnapshotCount:readiness.finalSnapshotCount,identityCount:readiness.identityCount,duplicateIdentityCount:readiness.duplicateIdentityCount,missingIdentityCount:readiness.missingIdentityCount,conversationSignatureChanges:readiness.conversationSignatureChanges,mutationChecks:readiness.mutationChecks,unrelatedMutationChecks:readiness.unrelatedMutationChecks,timeToFirstPositiveMs:readiness.timeToFirstPositiveMs,timeToStableMs:readiness.timeToStableMs,stableDurationMs:readiness.stableDurationMs,phaseABudgetMs:readiness.phaseABudgetMs,stabilizationGraceMs:readiness.stabilizationGraceMs,absoluteReadinessCapMs:readiness.absoluteReadinessCapMs,firstPositiveTimestampMs:readiness.firstPositiveTimestampMs,lastSemanticChangeTimestampMs:readiness.lastSemanticChangeTimestampMs,extensionActivated:readiness.extensionActivated,sidebarRegionFound:readiness.sidebarRegionFound}:{status:'not_run',diagnosticStatus:'not_run',rawStatus:'not_run',terminalReason:'not_run',ready:false,waitStarted:false,waitDurationMs:0,rowsAtFirstDetection:0,rowsAtStabilizedSnapshot:0,firstPositiveCount:0,finalStableCount:0,stableCount:0,finalSnapshotCount:0,conversationSignatureChanges:0,mutationChecks:0,unrelatedMutationChecks:0,timeToFirstPositiveMs:null,timeToStableMs:null,stableDurationMs:0,phaseABudgetMs:4000,stabilizationGraceMs:1200,absoluteReadinessCapMs:6000,firstPositiveTimestampMs:null,lastSemanticChangeTimestampMs:null,extensionActivated:false,sidebarRegionFound:false},
   sidebarTop:{checked:!!top,atTop,scrollTop,proof:topProof,reason:topReason,totalConversationLinks:top?.totalConversationLinks??0,visibleConversationLinks:top?.visibleConversationLinks??0,firstVisibleIndex:top?.firstVisibleIndex??null,domConversationRowsBefore:top?.conversationRowsBefore??null,hiddenRowsBefore:top?.hiddenRowsBefore??null,scrollableAncestorFound:top?.scrollableAncestorFound??false,viewportTop:top?.viewportTop??null,viewportBottom:top?.viewportBottom??null,activeContextType:top?.activeContextType??'unknown',rowsOutsideActiveContext:top?.rowsOutsideActiveContext??0,inactiveRowsExcluded:top?.inactiveRowsExcluded??0,precedingGeometry:top?.precedingGeometry??null,virtualOffsetEvidence:top?.virtualization?.detected??top?.virtualOffsetEvidence??false,virtualization:top?.virtualization||null},
   scrollContainerFound:!!scroller,scrollOwner:scroller?{found:true,tag:String(scroller.tagName||'unknown').toLowerCase().slice(0,12),scrollTop:Math.round(Number(scroller.scrollTop)||0),scrollHeight:Math.round(Number(scroller.scrollHeight)||0),clientHeight:Math.round(Number(scroller.clientHeight)||0),overflowY:String(getComputedStyle(scroller)?.overflowY||'unknown').slice(0,12),connected:scroller.isConnected!==false}:null,scrollOwnerCandidateCount,scrollOwnerReason,scrollPosition:{initial:initialScrollPosition===null?null:Math.round(initialScrollPosition),maximumReached:maximumScrollTopReached===null?null:Math.round(maximumScrollTopReached),maximumCapacity:maximumScrollTopCapacity===null?null:Math.round(maximumScrollTopCapacity),restored:restoredScrollPosition===null?null:Math.round(restoredScrollPosition)},scrollAttempts,scrollUsed,scrolledRowIndex,rowVisibleAfterScroll,scrollRestoreSuccessful,menuLeftOpen,cleanupSuccessful:!menuLeftOpen&&rows.every(row=>row.menuClosed)&&scrollRestoreSuccessful,stopReason,
   pinnedCount:prefix.pinnedCount,notPinnedCount:prefix.notPinnedCount,unknownCount:prefix.unknownCount,unknownRowDiagnostics,firstNotPinnedFound,
   contiguousPinnedPrefix:prefix.contiguousPinnedPrefix,pinnedStructureComplete:complete?'complete':'unproven',pinnedPrefixStatus:complete?'pinned_prefix_complete':'pinned_prefix_unproven',
   pinnedPrefixReason:complete?'first_not_pinned':prefixReason||stopReason,traversalTerminal:{lastCompletedStage:lastCompletedTraversalStage,stage:traversalTerminalStage,internalReason:stopReason,rowIndex:traversalTerminalRowIndex,processedCount:rows.length,semanticSnapshotValid:acceptedSemanticSnapshot? !firstSemanticSnapshotChange:null,scrollAttempted:scrollUsed||scrollAttempts.length>0,menuCleanupResult:currentRowMenuCleanupResult,leaseValid:cycleInternal?true:null,timeout:stopReason.includes('timeout'),cancelled:stopReason==='cancelled'},traversalCapacity:{snapshotRows:initialSnapshotCount,requiredTraversalRows:initialSnapshotCount,selectedBudget:maxRows,absoluteCap:absoluteSnapshotSafetyCap,budgetSufficient:initialSnapshotCount<=absoluteSnapshotSafetyCap,processedRows:rows.length},source:safeSource,initialSnapshotCount,finalSnapshotCount,snapshotExpansionCount,prefixSnapshotCount:prefixSnapshot.length,traversalBudget:maxRows,traversalBudgetMs:(activityInternal||cycleInternal)?Math.min(90000,Math.max(15000,5000+Math.min(absoluteSnapshotSafetyCap,prefixSnapshot.length)*2500)):null,cleanupReserveMs:activityInternal||cycleInternal?10000:null,absoluteSnapshotSafetyCap,totalConversationLinksAtPrefixStart:top?.totalConversationLinks??0,visibleConversationLinksAtPrefixStart:top?.visibleConversationLinks??0,elapsedMs:Math.min(Date.now()-started,hardMs)};
 };
 window.gptInspectSidebarElementStructure=async(options={})=>{
  const started=Date.now(),hardMs=Math.max(1000,Math.min(5000,Number(options.hardTimeoutMs)||4000)),deadline=started+hardMs;
  const result={status:'partial',reason:'not_started',elapsedMs:0,nodeCount:0,rootCount:0,navCount:0,asideCount:0,
   counts:{hrefAnchors:0,buttons:0,roleLinks:0,roleButtons:0,dataTestID:0,dataState:0,ariaAttributeCount:0,ariaAttributeNames:[]},
   routeTemplates:[],rowCandidates:[],pinnedMarkerAttributeNames:[],scanTruncated:false};
  const safeTag=node=>{const tag=String(node?.tagName||'other').toLowerCase();return /^[a-z][a-z0-9-]{0,15}$/.test(tag)?tag:'other';};
  const safeRole=node=>{const role=String(node?.getAttribute?.('role')||'').toLowerCase();return ['link','button','listitem','list','tree','group','navigation','heading','menuitem','none','presentation'].includes(role)?role:(role?'other':'none');};
  const safeDataNames=node=>[...(node?.attributes||[])].map(attr=>String(attr.name||'').toLowerCase()).filter(name=>/^data-[a-z0-9_-]{1,64}$/.test(name)).sort().slice(0,24);
  const normalizePath=href=>{
   try{
    const path=new URL(String(href||''),location.href).pathname.replace(/\/{2,}/g,'/');
    if(path==='/')return '/';
    if(/^\/c\/[^/]+\/?$/.test(path))return '/c/:id';
    if(/^\/g\/[^/]+\/c\/[^/]+\/?$/.test(path))return '/g/:id/c/:id';
    if(/^\/g\/[^/]+\/?$/.test(path))return '/g/:id';
    if(/^\/project\/[^/]+\/?$/i.test(path))return '/project/:id';
    const stable=new Set(['settings','auth','login','logout','share','library','explore','search','workspace','account','help','new','home','recent','archived','projects','project','features','about']);
    return '/'+path.split('/').filter(Boolean).map((segment,index)=>{const token=segment.toLowerCase();return index===0&&stable.has(token)||stable.has(token)?token:':id';}).join('/');
   }catch{return 'invalid';}
  };
  try{
   const roots=[...(document.querySelectorAll?.('nav,aside,[role="navigation"]')||[])].slice(0,16);
   const uniqueRoots=[...new Set(roots)];result.rootCount=uniqueRoots.length;
   result.navCount=uniqueRoots.filter(node=>safeTag(node)==='nav').length;
   result.asideCount=uniqueRoots.filter(node=>safeTag(node)==='aside').length;
   const routeCounts=new Map(),candidateCounts=new Map(),ariaNames=new Set(),pinnedNames=new Set(),seenNodes=new Set();
   const recordCandidate=(node,depth,template,hasHref)=>{
    const tag=safeTag(node),role=safeRole(node),dataAttributeNames=safeDataNames(node),signature=[tag,role,dataAttributeNames.join(','),hasHref?'yes':'no',template,depth].join('|');
    const prior=candidateCounts.get(signature);if(prior)prior.count++;else candidateCounts.set(signature,{tag,role,dataAttributeNames,hasHref,hrefTemplate:template,depth,count:1});
   };
   for(const root of uniqueRoots){
    if(Date.now()>=deadline){result.scanTruncated=true;result.reason='time_budget_exceeded';break;}
    const stack=[{node:root,depth:0}];
    while(stack.length){
     if(Date.now()>=deadline||result.nodeCount>=1200){result.scanTruncated=true;result.reason=Date.now()>=deadline?'time_budget_exceeded':'node_cap';break;}
     const {node,depth}=stack.pop();
     if(seenNodes.has(node))continue;seenNodes.add(node);result.nodeCount++;
     const tag=safeTag(node),role=safeRole(node),attrs=[...(node.attributes||[])].map(attr=>String(attr.name||'').toLowerCase());
     const href=tag==='a'?node.getAttribute?.('href'):null,hasHref=typeof href==='string'&&href.length>0,template=hasHref?normalizePath(href):'none';
     if(hasHref){result.counts.hrefAnchors++;routeCounts.set(template,(routeCounts.get(template)||0)+1);}
     if(tag==='button')result.counts.buttons++;
     if(role==='link')result.counts.roleLinks++;
     if(role==='button')result.counts.roleButtons++;
     if(attrs.includes('data-testid'))result.counts.dataTestID++;
     if(attrs.includes('data-state'))result.counts.dataState++;
     for(const name of attrs.filter(name=>name.startsWith('aria-'))){result.counts.ariaAttributeCount++;ariaNames.add(name);}
     for(const name of attrs.filter(name=>/pinned|starred/i.test(name)))pinnedNames.add(name);
     if(hasHref||role==='link'||role==='listitem'||tag==='li'||attrs.includes('data-testid')||attrs.includes('data-state')||attrs.some(name=>/pinned|starred/i.test(name))){
      recordCandidate(node,depth,template,hasHref);
     }
     const children=node.children||[],childLimit=Math.max(0,Math.min(children.length,1200-result.nodeCount));
     if(childLimit<children.length){result.scanTruncated=true;result.reason='node_cap';}
     for(let index=childLimit-1;index>=0;index--)stack.push({node:children[index],depth:Math.min(depth+1,32)});
    }
    if(result.scanTruncated)break;
   }
   result.counts.ariaAttributeNames=[...ariaNames].sort().slice(0,64);
   result.routeTemplates=[...routeCounts.entries()].sort(([a],[b])=>a.localeCompare(b)).slice(0,64).map(([template,count])=>({template,count}));
   result.rowCandidates=[...candidateCounts.values()].sort((a,b)=>b.count-a.count||a.depth-b.depth).slice(0,80);
   result.pinnedMarkerAttributeNames=[...pinnedNames].sort().slice(0,32);
   result.status=result.rootCount>0?(result.scanTruncated?'partial':'success'):'partial';
   if(!result.rootCount)result.reason='sidebar_not_found';else if(!result.scanTruncated)result.reason='none';
  }catch(error){const name=String(error?.name||'Error');result.status='failure';result.reason=['TypeError','RangeError','SyntaxError','SecurityError','TimeoutError'].includes(name)?name:'Error';}
  result.elapsedMs=Math.max(0,Math.min(hardMs,Date.now()-started));
  return result;
 };
 window.gptRunPinnedSidebarDiagnostic=async()=>{
  const sidebar=sidebarSnapshot(),structure=pinnedSidebarSnapshot(sidebar.root);
  const source=await window.gptSummarizePinnedLinkSources?.(structure.pinnedIds||[])||null;
  const safeStructure={...structure};delete safeStructure.pinnedIds;delete safeStructure.allVisibleConversationIds;
  let sourceType='unknown';
  if(structure.pinnedGroupFound){
   if(source?.pinnedLinkCount>0&&source.networkMatchedCount===source.pinnedLinkCount)sourceType='network';
   else if(source?.networkMatchedCount>0)sourceType='network_partial';
   else sourceType='preloaded_or_other_unconfirmed';
  }
  return {sidebar:{found:sidebar.found,visible:sidebar.visible,rect:sidebar.rect,visibleConversationLinkCount:sidebar.visibleConversationLinkCount},
   structure:safeStructure,sourceType,source:source?{baseSourceAvailable:source.baseSourceAvailable,baseOverlapCount:source.baseOverlapCount,
    starredTrueSourceAvailable:source.starredTrueSourceAvailable,starredTrueOverlapCount:source.starredTrueOverlapCount,networkMatchedCount:source.networkMatchedCount,
    updatedAtCount:source.updatedAtCount,recentCount:source.recentCount,sources:source.sources,observedStreams:source.observedStreams}:null};
 };
 window.gptInspectStarredControl=starredSnapshot;
 window.gptInspectSidebar=()=>{const s=sidebarSnapshot();return {found:s.found,visible:s.visible,rect:s.rect,rootCount:s.rootCount};};
 window.gptToggleStarredSectionOnce=async()=>{
  const root=sidebarSnapshot().root,before=starredSnapshot(root),c=starredControl(root);
  if(c.status!=='found')return {before,clicked:false,after:before,verified:false};
  c.el.click();
  await new Promise(resolve=>setTimeout(resolve,250));
  const after=starredSnapshot(sidebarSnapshot().root);
  return {before,clicked:true,after,verified:before.expandedAvailable&&after.expandedAvailable&&before.expanded!==after.expanded};
 };
 window.gptRunStarredTriggerDiagnostic=async()=>{
  const sidebarBefore=sidebarSnapshot();let sidebarToggle={status:'not_needed',clicked:false,expandedBefore:'absent',expandedAfter:'absent',stateChanged:false};
  let sidebarAfter=sidebarBefore;
  if(!sidebarBefore.visible){
   const candidate=findSidebarToggle();sidebarToggle={status:candidate.status,role:candidate.role||'unknown',labelClass:candidate.status==='unique'?'sidebar-toggle':null,
    candidates:candidate.candidates||[],clicked:false,expandedBefore:candidate.expanded==='true'?'true':candidate.expanded==='false'?'false':'absent',
    expandedAfter:candidate.expanded==='true'?'true':candidate.expanded==='false'?'false':'absent',stateChanged:false};
   if(candidate.status==='unique'){
    candidate.el.click();sidebarToggle.clicked=true;await new Promise(resolve=>setTimeout(resolve,250));
    sidebarAfter=sidebarSnapshot();const expanded=candidate.el.getAttribute?.('aria-expanded');
    sidebarToggle.expandedAfter=expanded==='true'?'true':expanded==='false'?'false':'absent';
    sidebarToggle.stateChanged=sidebarToggle.expandedBefore!==sidebarToggle.expandedAfter||sidebarAfter.visible!==sidebarBefore.visible;
   }
  }
  const before=starredSnapshot(sidebarAfter.root);let toggle={before,after:before,verified:false,clicked:false};
  const networkStarted=window.gptBeginStarredNetworkWindow?.()===true;
  const control=starredControl(sidebarAfter.root);
  if(sidebarAfter.visible&&control.status==='found'){
   const c=control,expandedBefore=c.el.getAttribute?.('aria-expanded');c.el.click();toggle.clicked=true;
   await new Promise(resolve=>setTimeout(resolve,250));const afterSidebar=sidebarSnapshot();const after=starredSnapshot(afterSidebar.root);
   toggle.after=after;toggle.verified=expandedBefore!==c.el.getAttribute?.('aria-expanded');
   sidebarAfter=afterSidebar;
  }
  await new Promise(resolve=>setTimeout(resolve,900));
  const network=window.gptEndStarredNetworkWindow?.()||[];
  return {sidebar:{before:{found:sidebarBefore.found,visible:sidebarBefore.visible,rect:sidebarBefore.rect,rootCount:sidebarBefore.rootCount,visibleConversationLinkCount:sidebarBefore.visibleConversationLinkCount},after:{found:sidebarAfter.found,visible:sidebarAfter.visible,rect:sidebarAfter.rect,rootCount:sidebarAfter.rootCount,visibleConversationLinkCount:sidebarAfter.visibleConversationLinkCount},toggle:sidebarToggle},before,result:toggle,networkStarted,network};
 };
 // Scheduled discovery only needs to open the section; never toggle an
 // already-open section closed. The isolated diagnostic above verifies state.
 window.gptOpenStarredSection=()=>{
  const sidebar=sidebarSnapshot();if(!sidebar.visible)return false;
  const c=starredControl(sidebar.root);if(c.status!=='found')return false;
  if(c.el.getAttribute('aria-expanded')==='true')return true;
  c.el.click();return true;
 };
})();

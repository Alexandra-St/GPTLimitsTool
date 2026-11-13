import Foundation

@main struct RootTriggerTimelineRunnerTests {
 static func fail(_ message:String)->Never {fputs("FAIL: \(message)\n",stderr);exit(1)}
 static func assert(_ condition:Bool,_ message:String){if !condition{fail(message)}}
 static func snapshot(_ id:String,_ second:Double,transport:[RootTransportEventSnapshot]=[],source:RootRequestMilestoneSourceSnapshot?=nil,pagination:[RootPaginationProgressSnapshot]?=nil,shape:[RootResponseShapeRejectionSnapshot]?=nil)->RootTriggerTimelineSnapshot {
  let scopedTransport=transport.map{event in RootTransportEventSnapshot(cycleID:id,requestSequence:event.requestSequence,
   documentGeneration:event.documentGeneration,source:event.source,observationSource:event.observationSource,kind:event.kind,
   matchingResponseObserved:event.matchingResponseObserved,requestElapsedMs:event.requestElapsedMs,terminalElapsedMs:event.terminalElapsedMs,
   status:event.status,correlationOutcome:event.correlationOutcome,requestToTerminalMs:event.requestToTerminalMs,rejectionClass:event.rejectionClass,
   navigationStartedBeforeError:event.navigationStartedBeforeError,navigationFinishedBeforeError:event.navigationFinishedBeforeError,
   currentDocumentGeneration:event.currentDocumentGeneration,generationChangedSinceRequest:event.generationChangedSinceRequest)}
  return RootTriggerTimelineSnapshot(cycleID:id,buildID:"test-build",finalReason:"no_list_response",routeBefore:"/",routeAfter:"/",
   actualNavigationReload:RootTriggerBooleanSnapshot(status:"not observed",value:nil,elapsedMs:nil),
   documentGenerationChanged:RootTriggerBooleanSnapshot(status:"observed",value:false,elapsedMs:210),
   milestones:[RootTriggerMilestoneSnapshot(name:"navigation_requested",status:"observed",elapsedMs:100),
    RootTriggerMilestoneSnapshot(name:"navigation_started",status:"not observed",elapsedMs:nil),
    RootTriggerMilestoneSnapshot(name:"first_root_list_request",status:"not observed",elapsedMs:nil)],
   initialScroll:RootTriggerScrollSnapshot(
    requested:RootTriggerBooleanSnapshot(status:"observed",value:true,elapsedMs:300),
    executed:RootTriggerBooleanSnapshot(status:"observed",value:true,elapsedMs:302),
    ownerFound:RootTriggerBooleanSnapshot(status:"observed",value:true,elapsedMs:302),
    scrollTopBefore:RootTriggerIntegerSnapshot(status:"observed",value:4,elapsedMs:300),
    scrollTopAfter:RootTriggerIntegerSnapshot(status:"observed",value:44,elapsedMs:302),
    moved:RootTriggerBooleanSnapshot(status:"observed",value:true,elapsedMs:302),
    visibleConversationLinksBefore:RootTriggerIntegerSnapshot(status:"observed",value:8,elapsedMs:300),
    visibleConversationLinksAfter:RootTriggerIntegerSnapshot(status:"observed",value:10,elapsedMs:302),
    documentGeneration:"1000",cycleSequence:9,ownerClassification:"scrollable_owner",
    scrollHeightBefore:RootTriggerIntegerSnapshot(status:"observed",value:900,elapsedMs:300),
    scrollHeightAfter:RootTriggerIntegerSnapshot(status:"observed",value:940,elapsedMs:302),
    clientHeightBefore:RootTriggerIntegerSnapshot(status:"observed",value:300,elapsedMs:300),
    clientHeightAfter:RootTriggerIntegerSnapshot(status:"observed",value:300,elapsedMs:302)),
   finishedAt:Date(timeIntervalSince1970:second),transportEvents:scopedTransport,
   transportHooks:[RootTransportHookSnapshot(name:"fetch_completion_hook",status:"ready"),RootTransportHookSnapshot(name:"xhr_completion_hook",status:"not observed")],
   transportCaptureBoundary:"cycle_completion",firstRootListRequestSource:source,paginationProgress:pagination,rootResponseShapeRejections:shape)
 }
 static func main() {
  let args=Array(CommandLine.arguments.dropFirst())
  if args.count==2,args[0]=="--inspect-at" {
   print(inspectRootTriggerTimelineSnapshots(applicationSupportDirectory:URL(fileURLWithPath:args[1],isDirectory:true)));return
  }
  let base=FileManager.default.temporaryDirectory.appendingPathComponent("root-trigger-timeline-tests-\(UUID().uuidString)",isDirectory:true)
  defer {try? FileManager.default.removeItem(at:base)}
  var state=CycleState();state.lastStatus="monitoring-result";state.lastCoverageDetail="pagination_stall";state.lastDiscoveredListResponses=2
  let beforeStatus=state.lastStatus,beforeDetail=state.lastCoverageDetail,beforeResponses=state.lastDiscoveredListResponses
  assert(persistRootTriggerTimelineSnapshot(snapshot("cycle-1",1),applicationSupportDirectory:base),"first snapshot write")
  assert(persistRootTriggerTimelineSnapshot(snapshot("cycle-2",2),applicationSupportDirectory:base),"second snapshot write")
  assert(persistRootTriggerTimelineSnapshot(snapshot("cycle-3",3),applicationSupportDirectory:base),"third snapshot write")
  guard let saved=readRootTriggerTimelineSnapshots(applicationSupportDirectory:base) else{fail("snapshot reload")}
  assert(saved.count==2,"bounded count")
  assert(saved.map(\.cycleID)==["cycle-2","cycle-3"],"two latest cycles and eviction")
  assert(saved[0].milestones.first{$0.name=="navigation_started"}?.status=="not observed","not-observed status retained")
  assert(saved[0].milestones.first{$0.name=="navigation_started"}?.elapsedMs==nil,"missing timestamp retained")
  assert(saved[0].documentGenerationChanged.elapsedMs==210,"monotonic elapsed time retained")
  assert(saved[0].initialScroll.ownerFound.value==true && saved[0].initialScroll.moved.value==true && saved[0].initialScroll.scrollTopBefore.value==4 && saved[0].initialScroll.scrollTopAfter.value==44,"initial scroll owner and movement persisted")
  assert(saved[0].initialScroll.scrollHeightBefore?.value==900 && saved[0].initialScroll.scrollHeightAfter?.value==940 && saved[0].initialScroll.clientHeightBefore?.value==300 && saved[0].initialScroll.visibleConversationLinksAfter.value==10,"initial scroll geometry and row counts persisted")
  assert(saved[0].initialScroll.requested.elapsedMs==300 && saved[0].initialScroll.executed.elapsedMs==302,"initial scroll monotonic timestamps persisted")
  assert(state.lastStatus==beforeStatus && state.lastCoverageDetail==beforeDetail && state.lastDiscoveredListResponses==beforeResponses,"monitoring state unchanged")
  let validMilestone:[String:Any] = ["stage":"request_observed","sequence":11,"method":"GET","category":"root_conversation_list","endpointClass":"root_conversations","cycleSequence":UInt64(9),"documentGeneration":"1000","observationSource":"fetch_hook"]
  let acceptedSource=rootRequestMilestoneSource(validMilestone,activeCycleSequence:9,activeDocumentGeneration:"1000",elapsedMs:720)
  assert(acceptedSource != nil && acceptedSource?.elapsedMs==720,"exact current root request accepted")
  var projectMilestone=validMilestone;projectMilestone["category"]="project_conversation_list";projectMilestone["endpointClass"]="project_conversation_list"
  assert(rootRequestMilestoneSource(projectMilestone,activeCycleSequence:9,activeDocumentGeneration:"1000",elapsedMs:721)==nil,"project-list request rejected")
  var staleDocumentMilestone=validMilestone;staleDocumentMilestone["documentGeneration"]="999"
  assert(rootRequestMilestoneSource(staleDocumentMilestone,activeCycleSequence:9,activeDocumentGeneration:"1000",elapsedMs:722)==nil,"stale document rejected")
  var wrongCycleMilestone=validMilestone;wrongCycleMilestone["cycleSequence"]=UInt64(8)
  assert(rootRequestMilestoneSource(wrongCycleMilestone,activeCycleSequence:9,activeDocumentGeneration:"1000",elapsedMs:723)==nil,"wrong cycle rejected")
  var wrongMethodMilestone=validMilestone;wrongMethodMilestone["method"]="POST"
  assert(rootRequestMilestoneSource(wrongMethodMilestone,activeCycleSequence:9,activeDocumentGeneration:"1000",elapsedMs:724)==nil,"non-GET root request rejected")
  var transport=[RootTransportEventSnapshot]()
  transport=appendRootTransportEvent(transport,sequence:1,generation:"100",source:"fetch",stage:"request",elapsedMs:10,status:nil)
  transport=appendRootTransportEvent(transport,sequence:1,generation:"100",source:"fetch",stage:"response",elapsedMs:25,status:200)
  assert(transport.last?.kind=="http_200" && transport.last?.matchingResponseObserved==true && transport.last?.requestToTerminalMs==15 && transport.last?.correlationOutcome=="matched_http_200","request to HTTP 200")
  for (sequence,stage,status,expected) in [(2,"response",503,"http_non_200"),(3,"error",0,"explicit_error"),(4,"cancellation",0,"cancellation"),(8,"timeout",0,"timeout")] {
   var pair=[RootTransportEventSnapshot]();pair=appendRootTransportEvent(pair,sequence:sequence,generation:"100",source:"xhr",stage:"request",elapsedMs:30,status:nil)
   pair=appendRootTransportEvent(pair,sequence:sequence,generation:"100",source:"xhr",stage:stage,elapsedMs:39,status:status)
   assert(pair.last?.kind==expected,"terminal kind \(expected)")
  }
  var pending=[RootTransportEventSnapshot]();pending=appendRootTransportEvent(pending,sequence:5,generation:"100",source:"fetch",stage:"request",elapsedMs:40,status:nil)
  assert(finalizeRootTransportEvents(pending).first?.kind=="no_terminal_event_by_cycle_end" && finalizeRootTransportEvents(pending).first?.matchingResponseObserved==false,"missing terminal event remains explicitly unknown")
  let unmatched=appendRootTransportEvent([],sequence:6,generation:"100",source:"hook",stage:"response",elapsedMs:50,status:200)
  assert(unmatched.first?.correlationOutcome=="response_unmatched","unmatched response classified")
  var boundary=[RootTransportEventSnapshot]();boundary=appendRootTransportEvent(boundary,sequence:7,generation:"100",source:"fetch",stage:"request",elapsedMs:60,status:nil)
  boundary=appendRootTransportEvent(boundary,sequence:7,generation:"200",source:"fetch",stage:"response",elapsedMs:70,status:200)
  assert(boundary.count==2 && boundary[1].correlationOutcome=="response_unmatched" && boundary[0].kind=="request_observed","document generation bounds correlation")
  assert(appendRootTransportEvent([],sequence:1,generation:"100",source:"fetch",stage:"request",elapsedMs:0,status:nil,limit:1).count==1,"bounded event retention")
  var sixteen=[RootTransportEventSnapshot]()
  for sequence in 1...16 {sixteen=appendRootTransportEvent(sixteen,sequence:sequence,generation:"100",source:"fetch",stage:"request",elapsedMs:sequence,status:nil)}
  sixteen=appendRootTransportEvent(sixteen,sequence:17,generation:"100",source:"fetch",stage:"request",elapsedMs:17,status:nil)
  assert(sixteen.count==16,"maximum request retention")
  let transportBase=base.appendingPathComponent("transport-persistence",isDirectory:true)
  assert(persistRootTriggerTimelineSnapshot(snapshot("cycle-transport",4,transport:finalizeRootTransportEvents(transport),source:acceptedSource),applicationSupportDirectory:transportBase),"transport snapshot write")
  guard let transportSaved=readRootTriggerTimelineSnapshots(applicationSupportDirectory:transportBase)?.last else{fail("transport snapshot reload")}
  assert(transportSaved.transportEvents?.first?.kind=="http_200" && transportSaved.transportEvents?.first?.cycleID=="cycle-transport" && transportSaved.transportEvents?.first?.matchingResponseObserved==true && transportSaved.transportHooks?.first?.status=="ready" && transportSaved.transportCaptureBoundary=="cycle_completion","transport timeline, hooks, and boundary persist")
  assert(transportSaved.firstRootListRequestSource==acceptedSource,"sanitized first-root milestone source persists")
  let resourceEvent:[String:Any] = ["event":"resource","source":"resource_timing","evidenceSource":"both","category":"root_conversation_list","pathname":"/backend-api/conversations","transport":"fetch","relativeMs":900,"responseRelativeMs":950,"status":200,"documentGeneration":"1000","cycleSequence":UInt64(9),"rawURL":"https://chatgpt.com/backend-api/conversations?cursor=secret"]
  let rootDocument:[String:Any] = ["cycleSequence":UInt64(9),"routeTemplate":"/","rootListHookInstalled":true,"fetchHookInstalled":true,"xhrOpenHookInstalled":true,"xhrSendHookInstalled":true,"generationAttached":true,"rootResourceTimingAPIAvailable":true,"rootResourceTimingObserverAvailable":true,"rootResourceEvents":[resourceEvent]]
  let movedScroll=transportSaved.initialScroll
  let passiveOnly=rootRequestOriginSnapshots(cycleID:"cycle-origin",cycleSequence:9,documentSnapshots:["1000":rootDocument],transportEvents:[],firstRootRequest:nil,initialScroll:movedScroll)
  assert(passiveOnly.count==1 && passiveOnly[0].passiveExactRootResourceObserved && passiveOnly[0].resourceTimingEntries.count==1 && passiveOnly[0].conclusion=="ROOT_NETWORK_HOOK_MISSED_REQUEST","passive resource without hook request is distinguished")
  assert(passiveOnly[0].resourceTimingEntries[0].exactRootEndpointClassMatched && passiveOnly[0].resourceTimingEntries[0].initiatorType=="fetch" && passiveOnly[0].resourceTimingEntries[0].responseStatus==200 && passiveOnly[0].resourceTimingEntries[0].evidenceSource=="both","passive evidence is sanitized, sourced, and timed")
  assert(passiveOnly[0].resourceTimingPositiveControlPassed==false && passiveOnly[0].resourceTimingNegativeEvidenceUsable==false,"passive-only evidence is not a validated negative channel")
  var hookEvent:[String:Any] = ["source":"hook","event":"request","category":"root_conversation_list","pathname":"/backend-api/conversations","method":"GET","transport":"fetch","cycleSequence":UInt64(9),"documentGeneration":"1000"]
  var controlDocument=rootDocument;controlDocument["rootHookEvents"]=[hookEvent]
  let positiveControl=rootRequestOriginSnapshots(cycleID:"cycle-origin",cycleSequence:9,documentSnapshots:["1000":controlDocument],transportEvents:[],firstRootRequest:nil,initialScroll:movedScroll)
  assert(positiveControl.first?.hookRequestObserved==true && positiveControl.first?.passiveExactRootResourceObserved==true && positiveControl.first?.resourceTimingPositiveControlPassed==true && positiveControl.first?.resourceTimingNegativeEvidenceUsable==true,"same-document exact-root positive control passes without shared request IDs")
  hookEvent["documentGeneration"]="2000";controlDocument["rootHookEvents"]=[hookEvent]
  let wrongHookGeneration=rootRequestOriginSnapshots(cycleID:"cycle-origin",cycleSequence:9,documentSnapshots:["1000":controlDocument],transportEvents:[],firstRootRequest:nil,initialScroll:movedScroll)
  assert(wrongHookGeneration.first?.hookRequestObserved==false && wrongHookGeneration.first?.resourceTimingPositiveControlPassed==false,"wrong-generation hook event cannot pass positive control")
  let wrongGenerationDocument:[String:Any] = ["cycleSequence":UInt64(9),"routeTemplate":"/","rootListHookInstalled":true,"fetchHookInstalled":true,"xhrOpenHookInstalled":true,"xhrSendHookInstalled":true,"generationAttached":true,"rootResourceTimingAPIAvailable":true,"rootResourceTimingObserverAvailable":true,"rootResourceEvents":[{var e=resourceEvent;e["documentGeneration"]="2000";return e}()]]
  let wrongGeneration=rootRequestOriginSnapshots(cycleID:"cycle-origin",cycleSequence:9,documentSnapshots:["1000":wrongGenerationDocument],transportEvents:[],firstRootRequest:nil,initialScroll:movedScroll)
  assert(wrongGeneration.first?.resourceTimingEntries.isEmpty==true && wrongGeneration.first?.conclusion=="ROOT_REQUEST_EVIDENCE_UNAVAILABLE","wrong-generation passive evidence cannot become negative proof")
  let unavailable=rootRequestOriginConclusion(scroll:movedScroll,hookObservationReady:true,hookRequestObserved:false,resourceTimingAvailable:false,passiveRootRequestObserved:false)
  assert(unavailable=="ROOT_REQUEST_EVIDENCE_UNAVAILABLE","unavailable passive observation is explicit")
  let ownerMissingScroll=RootTriggerScrollSnapshot(requested:RootTriggerBooleanSnapshot(status:"observed",value:true,elapsedMs:10),executed:RootTriggerBooleanSnapshot(status:"observed",value:true,elapsedMs:11),ownerFound:RootTriggerBooleanSnapshot(status:"observed",value:false,elapsedMs:11),scrollTopBefore:RootTriggerIntegerSnapshot(status:"not observed",value:nil,elapsedMs:nil),scrollTopAfter:RootTriggerIntegerSnapshot(status:"not observed",value:nil,elapsedMs:nil),moved:RootTriggerBooleanSnapshot(status:"not observed",value:nil,elapsedMs:nil),visibleConversationLinksBefore:RootTriggerIntegerSnapshot(status:"observed",value:0,elapsedMs:10),visibleConversationLinksAfter:RootTriggerIntegerSnapshot(status:"observed",value:0,elapsedMs:11),documentGeneration:"1000",cycleSequence:9,ownerClassification:"owner_not_found")
  let noMovementScroll=RootTriggerScrollSnapshot(requested:movedScroll.requested,executed:movedScroll.executed,ownerFound:RootTriggerBooleanSnapshot(status:"observed",value:true,elapsedMs:11),scrollTopBefore:RootTriggerIntegerSnapshot(status:"observed",value:4,elapsedMs:10),scrollTopAfter:RootTriggerIntegerSnapshot(status:"observed",value:4,elapsedMs:11),moved:RootTriggerBooleanSnapshot(status:"observed",value:false,elapsedMs:11),visibleConversationLinksBefore:movedScroll.visibleConversationLinksBefore,visibleConversationLinksAfter:movedScroll.visibleConversationLinksAfter,documentGeneration:"1000",cycleSequence:9,ownerClassification:"scrollable_owner")
  assert(rootRequestOriginConclusion(scroll:ownerMissingScroll,hookObservationReady:true,hookRequestObserved:false,resourceTimingAvailable:true,passiveRootRequestObserved:false)=="ROOT_INITIAL_SCROLL_NO_OWNER","owner-not-found classification")
  assert(rootRequestOriginConclusion(scroll:noMovementScroll,hookObservationReady:true,hookRequestObserved:false,resourceTimingAvailable:true,passiveRootRequestObserved:false)=="ROOT_INITIAL_SCROLL_NO_MOVEMENT","owner-found without movement classification")
  let hookRequest=appendRootTransportEvent([],sequence:41,generation:"1000",source:"fetch",stage:"request",elapsedMs:910,status:nil)
  let hookedAndPassive=rootRequestOriginSnapshots(cycleID:"cycle-origin",cycleSequence:9,documentSnapshots:["1000":rootDocument],transportEvents:hookRequest,firstRootRequest:nil,initialScroll:movedScroll)
  assert(hookedAndPassive.first?.hookRequestObserved==true && hookedAndPassive.first?.passiveExactRootResourceObserved==true && hookedAndPassive.first?.conclusion=="ROOT_TRIGGER_STILL_UNRESOLVED","hook and passive evidence are both retained")
  let cleanDocument:[String:Any] = ["cycleSequence":UInt64(9),"routeTemplate":"/","rootListHookInstalled":true,"fetchHookInstalled":true,"xhrOpenHookInstalled":true,"xhrSendHookInstalled":true,"generationAttached":true,"rootResourceTimingAPIAvailable":true,"rootResourceTimingObserverAvailable":true,"rootResourceEvents":[]]
  let noEvidence=rootRequestOriginSnapshots(cycleID:"cycle-origin",cycleSequence:9,documentSnapshots:["1000":cleanDocument],transportEvents:[],firstRootRequest:nil,initialScroll:movedScroll)
  assert(noEvidence.first?.hookRequestObserved==false && noEvidence.first?.passiveExactRootResourceObserved==false && noEvidence.first?.conclusion=="ROOT_REQUEST_EVIDENCE_UNAVAILABLE" && noEvidence.first?.resourceTimingNegativeEvidenceUsable==false,"no hook and no passive evidence is not classified as frontend no-request before positive control")
  assert(rootRequestOriginConclusion(scroll:movedScroll,hookObservationReady:true,hookRequestObserved:false,resourceTimingAvailable:true,passiveRootRequestObserved:false,passiveNegativeEvidenceUsable:true)=="ROOT_FRONTEND_DID_NOT_REQUEST_LIST","validated passive negative can classify no request")
  let page:[String:Any] = ["cycleID":"cycle-pagination","cycleSequence":UInt64(11),"requestSequence":31,"documentGeneration":"1000","offset":20,"cursorPresent":false,"cursorType":"null","parsedRecordCount":20,"consumeResult":"consume_new","acceptedElapsedMs":1000,"pageRelativeMs":100,"identityProgress":true]
  let repeated:[String:Any] = ["cycleID":"cycle-pagination","cycleSequence":UInt64(11),"requestSequence":32,"documentGeneration":"1000","offset":20,"cursorPresent":false,"cursorType":"null","parsedRecordCount":20,"consumeResult":"consume_repeated","acceptedElapsedMs":1200,"pageRelativeMs":300,"identityProgress":false]
  let scroll:[String:Any] = ["cycleSequence":UInt64(11),"documentGeneration":"1000","sequence":2,"reason":"post_progress","requestedAtMs":150,"scrollRequested":true,"selectedOwner":["tag":"div"],"ownerBefore":["scrollTop":20],"ownerSettled":["scrollTop":120],"rowsBefore":["visible":5],"rowsSettled":["visible":8]]
  let request:[String:Any] = ["cycleSequence":UInt64(11),"documentGeneration":"1000","rootRequestSequence":33,"category":"root_conversation_list","event":"request","method":"GET","pathname":"/backend-api/conversations","relativeMs":190,"partition":["offset":40]]
  let pageTerminal=RootTransportEventSnapshot(cycleID:"cycle-pagination",requestSequence:33,documentGeneration:"1000",source:"fetch",observationSource:"page_hook",kind:"http_200",matchingResponseObserved:true,requestElapsedMs:1050,terminalElapsedMs:1100,status:200,correlationOutcome:"matched_http_200",requestToTerminalMs:50)
  let progress=rootPaginationProgressSnapshots(cycleID:"cycle-pagination",cycleSequence:11,pageEvents:[page,repeated],scrollEvents:[scroll],hookEvents:[request],transportEvents:[pageTerminal])
  assert(progress.count==2,"accepted root page rows retained")
  assert(progress[0].acceptedRequestSequence==31 && progress[0].consumeResult=="consume_new" && progress[0].parsedRecordCount==20 && progress[0].offset==20,"accepted page metadata recorded")
  assert(progress[0].postProgressScrollRequested==true && progress[0].postProgressScrollExecuted==true && progress[0].scrollOwnerFound==true && progress[0].scrollTopBefore==20 && progress[0].scrollTopAfter==120 && progress[0].scrollMoved==true,"post-progress scroll owner and movement recorded")
  assert(progress[0].visibleLinksBefore==5 && progress[0].visibleLinksAfter==8 && progress[0].postProgressScrollElapsedMs==1050,"scroll rows and monotonic elapsed time recorded")
  assert(progress[0].nextRootRequestObserved && progress[0].nextRequestSequence==33 && progress[0].nextRequestOffset==40 && progress[0].nextRequestElapsedMs==1090 && progress[0].nextRequestTerminalResult=="http_200" && progress[0].nextRequestHTTPStatus==200,"first subsequent exact-root request and terminal recorded")
  assert(progress[1].consumeResult=="consume_repeated" && progress[1].postProgressScrollRequested==false,"repeated page does not steal the preceding progress scroll")
  let noOwnerScroll:[String:Any] = ["cycleSequence":UInt64(11),"documentGeneration":"1000","reason":"post_progress","requestedAtMs":350,"scrollRequested":true,"ownerBefore":NSNull(),"ownerImmediate":NSNull(),"rowsBefore":["visible":0]]
  let ownerMissing=rootPaginationProgressSnapshots(cycleID:"cycle-pagination",cycleSequence:11,pageEvents:[page],scrollEvents:[noOwnerScroll],hookEvents:[],transportEvents:[])
  assert(ownerMissing.first?.postProgressScrollRequested==true && ownerMissing.first?.postProgressScrollExecuted==true && ownerMissing.first?.scrollOwnerFound==false && ownerMissing.first?.nextRootRequestObserved==false,"owner-missing and no-next-request states recorded")
  var noMoveScroll=scroll;noMoveScroll["requestedAtMs"]=155;noMoveScroll["ownerSettled"]=["scrollTop":20]
  let noMove=rootPaginationProgressSnapshots(cycleID:"cycle-pagination",cycleSequence:11,pageEvents:[page],scrollEvents:[noMoveScroll],hookEvents:[],transportEvents:[])
  assert(noMove.first?.scrollOwnerFound==true && noMove.first?.scrollMoved==false,"no-movement scroll recorded")
  var wrongCyclePage=page;wrongCyclePage["cycleID"]="cycle-other"
  var wrongDocumentScroll=scroll;wrongDocumentScroll["documentGeneration"]="2000"
  var wrongCycleRequest=request;wrongCycleRequest["cycleSequence"]=UInt64(12)
  let isolated=rootPaginationProgressSnapshots(cycleID:"cycle-pagination",cycleSequence:11,pageEvents:[wrongCyclePage,page],scrollEvents:[wrongDocumentScroll],hookEvents:[wrongCycleRequest],transportEvents:[])
  assert(isolated.count==1 && isolated[0].postProgressScrollRequested==false && isolated[0].nextRootRequestObserved==false,"wrong cycle and document events are not associated")
  var wrongDocumentRequest=request;wrongDocumentRequest["documentGeneration"]="2000"
  let wrongDocument=rootPaginationProgressSnapshots(cycleID:"cycle-pagination",cycleSequence:11,pageEvents:[page],scrollEvents:[scroll],hookEvents:[wrongDocumentRequest],transportEvents:[])
  assert(wrongDocument.first?.postProgressScrollRequested==true && wrongDocument.first?.nextRootRequestObserved==false,"next request from a different document is not associated")
  let boundedPages=(1...8).map{index -> [String:Any] in ["cycleID":"cycle-pagination","cycleSequence":UInt64(11),"requestSequence":index,"documentGeneration":"1000","parsedRecordCount":1,"consumeResult":"consume_new","acceptedElapsedMs":index,"pageRelativeMs":index,"identityProgress":false]}
  let bounded=rootPaginationProgressSnapshots(cycleID:"cycle-pagination",cycleSequence:11,pageEvents:boundedPages,scrollEvents:[],hookEvents:[],transportEvents:[])
  assert(bounded.count==6 && bounded.first?.acceptedRequestSequence==3,"pagination progress retention is bounded to latest six")
  let progressSnapshot=snapshot("cycle-pagination",6,pagination:progress)
  let progressBase=base.appendingPathComponent("pagination-persistence",isDirectory:true)
  assert(persistRootTriggerTimelineSnapshot(progressSnapshot,applicationSupportDirectory:progressBase),"pagination snapshot persistence")
  let persistedProgress=readRootTriggerTimelineSnapshots(applicationSupportDirectory:progressBase)?.last?.paginationProgress
  assert(persistedProgress==progress,"pagination progress survives reload")
  let progressData=try! JSONEncoder().encode(progressSnapshot),progressJSON=String(data:progressData,encoding:.utf8)!
  for forbidden in ["conversationId","conversationID","title","messages","cookies","tokens","rawURL","headers","authorization","rawDOM"] {assert(!progressJSON.localizedCaseInsensitiveContains(forbidden),"pagination privacy key \(forbidden)")}
  let startedState=rootTransportErrorNavigationState(requestGeneration:"100",currentGeneration:"200",errorElapsedMs:50,latestNavigationStartedElapsedMs:30,latestNavigationFinishedElapsedMs:nil)
  assert(startedState.navigationStartedBeforeError && !startedState.navigationFinishedBeforeError && startedState.generationChangedSinceRequest==true && startedState.currentDocumentGeneration=="200","navigation started and generation changed before rejection")
  let noNavigation=rootTransportErrorNavigationState(requestGeneration:"100",currentGeneration:"100",errorElapsedMs:50,latestNavigationStartedElapsedMs:nil,latestNavigationFinishedElapsedMs:nil)
  assert(!noNavigation.navigationStartedBeforeError && !noNavigation.navigationFinishedBeforeError && noNavigation.generationChangedSinceRequest==false,"rejection without prior navigation")
  let completedNavigation=rootTransportErrorNavigationState(requestGeneration:"100",currentGeneration:"100",errorElapsedMs:50,latestNavigationStartedElapsedMs:20,latestNavigationFinishedElapsedMs:40)
  assert(completedNavigation.navigationStartedBeforeError && completedNavigation.navigationFinishedBeforeError,"navigation completed before rejection")
  let unavailableGeneration=rootTransportErrorNavigationState(requestGeneration:"bad",currentGeneration:nil,errorElapsedMs:50,latestNavigationStartedElapsedMs:nil,latestNavigationFinishedElapsedMs:nil)
  assert(unavailableGeneration.currentDocumentGeneration==nil && unavailableGeneration.generationChangedSinceRequest==nil,"unavailable generation remains unknown")
  var rejected=[RootTransportEventSnapshot]()
  rejected=appendRootTransportEvent(rejected,sequence:9,generation:"100",source:"fetch",stage:"request",elapsedMs:10,status:nil)
  rejected=appendRootTransportEvent(rejected,sequence:9,generation:"100",source:"fetch",stage:"error",elapsedMs:50,status:nil,rejectionClass:"TypeError",navigationState:startedState)
  let unknownRejected=appendRootTransportEvent([],sequence:10,generation:"100",source:"fetch",stage:"error",elapsedMs:51,status:nil,rejectionClass:"private exception text")
  assert(unknownRejected.last?.rejectionClass=="unknown_error","unrecognized class uses safe fallback")
  let rejectionSnapshot=snapshot("cycle-rejection",5,transport:finalizeRootTransportEvents(rejected))
  assert(rejectionSnapshot.transportEvents?.last?.rejectionClass=="TypeError" && rejectionSnapshot.transportEvents?.last?.navigationStartedBeforeError==true && rejectionSnapshot.transportEvents?.last?.generationChangedSinceRequest==true,"safe rejection and navigation fields persist")
  let rejectionData=try! JSONEncoder().encode(rejectionSnapshot);let rejectionJSON=String(data:rejectionData,encoding:.utf8)!
  assert(!rejectionJSON.contains("secret error") && !rejectionJSON.contains("stackTrace") && !rejectionJSON.contains("rawMessage"),"raw error and stack data are not persisted")
  assert(persistRootTriggerTimelineSnapshot(rejectionSnapshot,applicationSupportDirectory:transportBase),"rejection snapshot write")
  let persistedRejection=readRootTriggerTimelineSnapshots(applicationSupportDirectory:transportBase)?.last?.transportEvents?.last
  assert(persistedRejection?.rejectionClass=="TypeError" && persistedRejection?.navigationStartedBeforeError==true && persistedRejection?.navigationFinishedBeforeError==false && persistedRejection?.currentDocumentGeneration=="200" && persistedRejection?.generationChangedSinceRequest==true,"rejection and navigation evidence survives persistence/reload")
  let file=transportBase.appendingPathComponent("GPTLimitsTool",isDirectory:true).appendingPathComponent(rootTriggerTimelineSnapshotFilename)
  guard let data=try? Data(contentsOf:file),let json=String(data:data,encoding:.utf8) else{fail("snapshot file readable")}
  for forbidden in ["conversationId","conversationID","title","messages","contents","cookies","tokens","rawURL","headers","authorization","cycleToken","url","errorMessage","stackTrace","rawMessage"] {assert(!json.localizedCaseInsensitiveContains(forbidden),"privacy key \(forbidden)")}
  let blocker=base.appendingPathComponent("not-a-directory");try? Data("x".utf8).write(to:blocker)
  assert(!persistRootTriggerTimelineSnapshot(snapshot("cycle-fail",4),applicationSupportDirectory:blocker),"persistence failure returned safely")
  assert(state.lastStatus==beforeStatus && state.lastCoverageDetail==beforeDetail && state.lastDiscoveredListResponses==beforeResponses,"failed diagnostics persistence does not alter monitoring state")
  let child=Process(),pipe=Pipe();child.executableURL=URL(fileURLWithPath:CommandLine.arguments[0]);child.arguments=["--inspect-at",base.path];child.standardOutput=pipe;child.standardError=pipe
  do {try child.run()} catch {fail("inspector child process launch")}
  let childOutput=pipe.fileHandleForReading.readDataToEndOfFile();child.waitUntilExit()
  guard child.terminationStatus==0,let output=String(data:childOutput,encoding:.utf8) else{fail("inspector child process")}
  assert(output.contains("cycle-2") && output.contains("cycle-3") && !output.contains("cycle-1"),"snapshots available from a fresh process")
  let originSnapshot=snapshot("cycle-origin",7)
  let originCopy=RootTriggerTimelineSnapshot(cycleID:originSnapshot.cycleID,buildID:originSnapshot.buildID,finalReason:originSnapshot.finalReason,routeBefore:originSnapshot.routeBefore,routeAfter:originSnapshot.routeAfter,actualNavigationReload:originSnapshot.actualNavigationReload,documentGenerationChanged:originSnapshot.documentGenerationChanged,milestones:originSnapshot.milestones,initialScroll:originSnapshot.initialScroll,finishedAt:originSnapshot.finishedAt,rootRequestOrigin:passiveOnly)
  let originJSON=String(data:try! JSONEncoder().encode(originCopy),encoding:.utf8)!
  assert(!originJSON.localizedCaseInsensitiveContains("rawURL") && !originJSON.contains("cursor=secret") && !originJSON.contains("https://chatgpt.com"),"passive request evidence omits raw URL/query")
  let originBase=base.appendingPathComponent("origin-persistence",isDirectory:true)
  assert(persistRootTriggerTimelineSnapshot(originCopy,applicationSupportDirectory:originBase),"origin snapshot write")
  let originSaved=readRootTriggerTimelineSnapshots(applicationSupportDirectory:originBase)?.last
  assert(originSaved?.rootRequestOrigin==passiveOnly && originSaved?.rootRequestOrigin?.count==1,"origin evidence persists with bounded document count")
  let schemaInput:[String:Any]=["requestSequence":4,"documentGeneration":"3000","relativeMs":720,"status":200,
   "schema":["topLevelType":"object","topLevelKeys":["items","offset","title","private-id"],
    "arrays":[["field":"items","itemCount":3,"samples":[[["key":"id","type":"string"],["key":"title","type":"string"],["key":"update_time","type":"string"]],[["key":"id","type":"string"],["key":"created_at","type":"number"]],[["key":"id","type":"string"]]]]],
    "nestedObjects":[["field":"data","fields":[["key":"id","type":"string"],["key":"update_time","type":"string"],["key":"title","type":"string"]]]],
    "paginationFields":[["key":"offset","type":"number"]],"candidateIDFields":[["key":"id","type":"string"]],
    "candidateTimestampFields":[["key":"update_time","type":"string"]],"selectedContainer":"items","totalCandidateItems":3,
    "itemsAccepted":0,"itemsRejected":3,"rejectedMissingID":1,"rejectedMissingOrInvalidTime":1,"rejectedInvalidShape":1,"rejectedOther":0]]
  guard let shape=RootResponseShapeRejectionSnapshot.make(schemaInput,cycleID:"cycle-1000-8") else{fail("safe root response schema accepted")}
  assert(shape.schema.arrays.first?.samples.count==2 && shape.schema.itemsRejected==3 && shape.schema.rejectedMissingID==1,"schema sample and rejection counters bounded")
  var shapeEntries=[RootResponseShapeRejectionSnapshot]()
  for (sequence,elapsed) in [(1,100),(2,200),(3,300)] {
   var event=schemaInput;event["requestSequence"]=sequence;event["relativeMs"]=elapsed
   guard let next=RootResponseShapeRejectionSnapshot.make(event,cycleID:"cycle-1000-8") else{fail("bounded schema event")}
   shapeEntries=boundedRootResponseShapeRejections(shapeEntries,adding:next)
  }
  assert(shapeEntries.map(\.requestSequence)==[2,3],"schema rejection events retain only the latest two")
  let schemaCycle=snapshot("cycle-1000-8",8,shape:[shape]),schemaData=try! JSONEncoder().encode(schemaCycle),schemaJSON=String(data:schemaData,encoding:.utf8)!
  for forbidden in ["title","private-id","PRIVATE TITLE","message","PRIVATE CONTENT","url"] {assert(!schemaJSON.localizedCaseInsensitiveContains(forbidden),"response schema omits sensitive field/value \(forbidden)")}
  assert(schemaJSON.contains("rejected_missing_id") && schemaJSON.contains("selectedContainer") && schemaJSON.contains("nestedObjects"),"safe schema and parser rejection counters serialize")
  let schemaBase=base.appendingPathComponent("schema-persistence",isDirectory:true)
  assert(persistRootTriggerTimelineSnapshot(schemaCycle,applicationSupportDirectory:schemaBase),"response schema snapshot write")
  let savedSchema=readRootTriggerTimelineSnapshots(applicationSupportDirectory:schemaBase)?.last?.rootResponseShapeRejections?.first
  assert(savedSchema==shape && savedSchema?.documentGeneration=="3000" && savedSchema?.elapsedMs==720,"response schema survives persistence/reload")
  print("PASS: root milestone admission, transport correlation, pagination progress, initial scroll outcome, passive exact-root evidence, generation isolation, bounded persistence, privacy, and monitoring isolation")
 }
}

import Foundation
func fallbackProofState(_ proof:PinnedCoverageProof,explicitStarredObserved:Bool=false)->StarredCoverageProofState {
 var state=StarredCoverageProofState(explicitStarredObserved:explicitStarredObserved,explicitPartitionComplete:false)
 state.beginFallback();state.finishFallback(proof);return state
}
final class TestLockedCounter:@unchecked Sendable {
 private let lock=NSLock();private var stored=0
 func increment(){lock.lock();stored+=1;lock.unlock()}
 var value:Int {lock.lock();defer{lock.unlock()};return stored}
}
@main struct ModelTests {
 static func chatCheckTraceTests() throws {
  let started=Date(timeIntervalSince1970:1_800_000_000)
  let privateURL=URL(string:"https://chatgpt.com/c/private-chat-id?token=private-query")!
  let route=sanitizedChatCheckRoute(privateURL)
  assert(route.template=="/c/:id" && route.category == .chat)
  assert(sanitizedChatCheckRoute(URL(string:"https://chatgpt.com/project-id/chat-id?secret=private")!).template=="/:id/:id")
  assert(sanitizedChatCheckRoute(URL(string:"https://chatgpt.com/")!).template=="home")

  // Successful navigation followed by ready document and a history response/page.
  var state=CycleState();state.beginChatCheckTrace(route:sanitizedChatCheckRoute(URL(string:"https://chatgpt.com/")!),at:started)
  state.appendChatCheckTrace(stage:.navigationRequested,result:.success,route:route,reason:.navigationRequested,at:started.addingTimeInterval(0.1))
  state.appendChatCheckTrace(stage:.navigationFinished,result:.success,route:route,reason:.navigationFinished,at:started.addingTimeInterval(0.2))
  state.appendChatCheckTrace(stage:.conversationRouteObserved,result:.success,route:route,reason:.expectedRoute,at:started.addingTimeInterval(0.2))
  state.appendChatCheckTrace(stage:.documentReady,result:.success,route:route,reason:.documentComplete,at:started.addingTimeInterval(0.3))
  state.appendChatCheckTrace(stage:.historyWaitStarted,result:.success,route:route,reason:.historyWaiting,at:started.addingTimeInterval(0.4))
  state.appendChatCheckTrace(stage:.historyResponseObserved,result:.success,route:route,reason:.historyResponse2xx,at:started.addingTimeInterval(0.5))
  state.appendChatCheckTrace(stage:.historyRowsObserved,result:.success,route:route,reason:.historyRowsObserved,at:started.addingTimeInterval(0.6))
  state.appendChatCheckTrace(stage:.terminalResult,result:.success,route:route,reason:.terminalComplete,at:started.addingTimeInterval(0.7))
  assert(state.lastChatCheckTrace?.events.map{$0.stage}.contains(.terminalResult)==true)

  // Home remains after navigation: retain the observed Home route, then a waiting_history terminal.
  var home=CycleState();home.beginChatCheckTrace(route:sanitizedChatCheckRoute(URL(string:"https://chatgpt.com/")!),at:started)
  home.appendChatCheckTrace(stage:.navigationRequested,result:.success,route:sanitizedChatCheckRoute(URL(string:"https://chatgpt.com/")!),reason:.navigationRequested,at:started.addingTimeInterval(0.1))
  home.appendChatCheckTrace(stage:.navigationFinished,result:.success,route:sanitizedChatCheckRoute(URL(string:"https://chatgpt.com/")!),reason:.navigationFinished,at:started.addingTimeInterval(0.2))
  home.appendChatCheckTrace(stage:.conversationRouteObserved,result:.failure,route:sanitizedChatCheckRoute(URL(string:"https://chatgpt.com/")!),reason:.unexpectedRoute,at:started.addingTimeInterval(0.2))
  home.appendChatCheckTrace(stage:.terminalResult,result:.failure,route:sanitizedChatCheckRoute(URL(string:"https://chatgpt.com/")!),reason:.terminalNoProgressWaitingHistory,at:started.addingTimeInterval(1))

  // Navigation failure and document-ready/no-response or response/no-rows paths are represented explicitly.
  var failed=CycleState();failed.beginChatCheckTrace(route:sanitizedChatCheckRoute(nil),at:started)
  failed.appendChatCheckTrace(stage:.navigationRequested,result:.success,route:route,reason:.navigationRequested,at:started.addingTimeInterval(0.1))
  failed.appendChatCheckTrace(stage:.navigationFinished,result:.failure,route:route,reason:.navigationFailed,at:started.addingTimeInterval(0.2))
  failed.appendChatCheckTrace(stage:.terminalResult,result:.failure,route:route,reason:.terminalNavigationFailure,at:started.addingTimeInterval(0.3))
  var noResponse=CycleState();noResponse.beginChatCheckTrace(route:route,at:started)
  noResponse.appendChatCheckTrace(stage:.documentReady,result:.success,route:route,reason:.documentComplete,at:started.addingTimeInterval(0.2))
  noResponse.appendChatCheckTrace(stage:.historyWaitStarted,result:.success,route:route,reason:.historyWaiting,at:started.addingTimeInterval(0.3))
  noResponse.appendChatCheckTrace(stage:.historyResponseObserved,result:.failure,route:route,reason:.historyResponseNotObserved,at:started.addingTimeInterval(2))
  noResponse.appendChatCheckTrace(stage:.historyRowsObserved,result:.failure,route:route,reason:.historyRowsNotObserved,at:started.addingTimeInterval(2))
  var noRows=CycleState();noRows.beginChatCheckTrace(route:route,at:started)
  noRows.appendChatCheckTrace(stage:.historyResponseObserved,result:.success,route:route,reason:.historyResponse2xx,at:started.addingTimeInterval(0.5))
  noRows.appendChatCheckTrace(stage:.historyRowsObserved,result:.failure,route:route,reason:.historyRowsEmpty,at:started.addingTimeInterval(1))

  // The latest trace and its terminal failure survive CycleState persistence/reload.
  let persisted=try JSONDecoder().decode(CycleState.self,from:JSONEncoder().encode(home))
  assert(persisted.lastChatCheckTrace?.events.last?.reason == .terminalNoProgressWaitingHistory)
  let encoded=String(data:try JSONEncoder().encode(state),encoding:.utf8)!
  for secret in ["private-chat-id","private-query","secret=private","conversation title","raw URL"] {assert(!encoded.contains(secret))}
  assert(state.lastChatCheckTrace?.events.allSatisfy{$0.elapsedMs>=0 && $0.elapsedMs<=600000}==true)
  assert(state.lastChatCheckTrace?.events.last?.routeTemplate=="/c/:id")
  assert(chatCheckTraceHistoryResponseReason(status:200).0 == .success)
  assert(chatCheckTraceHistoryResponseReason(status:429).1 == .historyResponse429)
  assert(chatCheckTraceHistoryResponseReason(status:nil).1 == .historyResponseUnknown)
  var parsing=CycleState();parsing.beginHistoryResponseParsing();parsing.beginChatCheckTrace(route:route,at:started);parsing.recordObservedHistoryResponse()
  let responseDiagnostic:[String:Any]=["generation":"safe-generation","sequence":7,"pageAcceptanceReason":"none","pageUpdateCallbackFired":true,
   "responseParseDiagnostic":["endpointTemplate":"/backend-api/conversations/:id/messages","transport":"fetch","status":200,"contentTypeCategory":"json","topLevelType":"object",
    "topLevelKeyNames":["conversation_id","messages","page_info"],"topLevelArrayCounts":[["key":"messages","count":2]],
    "expectedStructure":["conversationId":true,"messagesArray":true,"mappingObject":false,"pageInfoObject":true,"hasPreviousPageBoolean":true],
    "parserAttempted":true,"parserAccepted":true,"rejectionReason":"accepted","extractedPageCount":1,"extractedMessageCount":2,"hasPreviousPage":true]]
  parsing.recordHistoryResponseParsing(responseDiagnostic,at:started.addingTimeInterval(0.8))
  parsing.appendChatCheckTrace(stage:.terminalResult,result:.failure,route:route,reason:.terminalNoProgressWaitingHistory,at:started.addingTimeInterval(1))
  assert(parsing.lastHistoryResponseParsing?.summary.contains("observed 1 · parser attempted/accepted/rejected 1/1/0") == true)
  assert(parsing.lastHistoryResponseParsing?.entries.first?.pageUpdateCallbackFired == true)
  let unsafeDiagnostic:[String:Any]=["sequence":8,"responseParseDiagnostic":["endpointTemplate":"/backend-api/conversations/private-id/messages?token=secret","transport":"fetch","status":200,"topLevelType":"object","topLevelKeyNames":["messages","private title"],"topLevelArrayCounts":[["key":"messages","count":3],["key":"private title","count":4]],"parserAttempted":true,"parserAccepted":false,"rejectionReason":"unexpected raw private value","extractedMessageCount":3]]
  parsing.recordHistoryResponseParsing(unsafeDiagnostic)
  for index in 0..<25 {var extra=unsafeDiagnostic;extra["sequence"]=100+index;parsing.recordHistoryResponseParsing(extra)}
  assert(parsing.lastHistoryResponseParsing?.entries.count == 20)
  let parsingRoundTrip=try JSONDecoder().decode(CycleState.self,from:JSONEncoder().encode(parsing))
  let parsingJSON=String(data:try JSONEncoder().encode(parsingRoundTrip),encoding:.utf8)!
  assert(parsingRoundTrip.lastHistoryResponseParsing?.observedHistoryResponses == 1)
  assert(parsingRoundTrip.lastHistoryResponseParsing?.summary.contains("top rejection unknown") == true)
  assert(parsingRoundTrip.lastChatCheckTrace?.events.last?.reason == .terminalNoProgressWaitingHistory)
  for secret in ["private-id","token=secret","private title","unexpected raw private value","safe-generation"] {assert(!parsingJSON.contains(secret))}
  _=failed;_=noResponse;_=noRows
 }
 static func perChatHistoryDiagnosticsTests() throws {
  func agg(_ messages:Int,_ complete:Bool,_ previous:Bool?)->SafeAggregate {
   SafeAggregate(conversationId:"private-id",title:"private title",processedMessageIds:[],messagesCollected:messages,userMessages:messages,assistantMessages:0,otherMessages:0,estimatedTextTokens:messages*10,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:complete,hasPreviousPage:previous,hasNextPage:nil,responsesCaptured:1,updatedAt:nil)
  }
  // A detail response with a non-empty aggregate and terminal false-page proof is accepted.
  var decisionState=CycleState();decisionState.beginPerChatHistoryDiagnostic(ordinal:1)
  let terminalDetail:[String:Any] = ["responseParseDiagnostic":["endpointTemplate":"/backend-api/conversations/:id","transport":"fetch","status":200,"contentTypeCategory":"json","topLevelType":"object","topLevelKeyNames":["messages","has_previous_page"],"topLevelArrayCounts":[],"expectedStructure":["conversationId":true,"messagesArray":true,"hasPreviousPageBoolean":true],"parserAttempted":true,"parserAccepted":true,"rejectionReason":"accepted","extractedPageCount":1,"extractedMessageCount":3,"hasPreviousPage":false]]
  let terminalEntry=HistoryResponseParseEntry.make(terminalDetail)
  decisionState.recordHistoryResponseParsing(terminalEntry)
  let complete=agg(3,true,false)
  let behaviorBefore=complete
  decisionState.recordPerChatCompletionDecision(candidate:true,accepted:true,reason:"none",aggregate:complete,hasPreviousPage:false,historyComplete:true)
  decisionState.recordPerChatPersistedAggregate(complete)
  assert(complete.messagesCollected==behaviorBefore.messagesCollected && complete.historyComplete==behaviorBefore.historyComplete && complete.hasPreviousPage==behaviorBefore.hasPreviousPage)
  assert(decisionState.perChatHistoryDiagnostics?.chats[0].completionDecision?.accepted==true)
  assert(decisionState.perChatHistoryDiagnostics?.chats[0].completionDecision?.persistedHistoryComplete==true)
  assert(decisionState.perChatHistoryDiagnostics?.chats[0].completionDecision?.persistedHasPreviousPage==false)
  assert(decisionState.perChatHistoryDiagnostics?.chats[0].completionSummary.contains("completion accepted")==true)
  decisionState.finishPerChatHistoryDiagnostic(terminal:"Complete",telemetry:nil)
  let persistedAccepted=try JSONDecoder().decode(CycleState.self,from:JSONEncoder().encode(decisionState))
  assert(persistedAccepted.perChatHistoryDiagnostics?.chats[0].completionDetail.contains("endpoint categories [conversation_detail]")==true)
  // Explicit rejection gates remain distinguishable, and a later partial persistence is called out.
  var rejectedState=CycleState();rejectedState.beginPerChatHistoryDiagnostic(ordinal:2)
  var partial=agg(3,false,true)
  rejectedState.recordPerChatCompletionDecision(candidate:true,accepted:false,reason:"has_previous_page_true",aggregate:partial,hasPreviousPage:true,historyComplete:false)
  rejectedState.recordPerChatPersistedAggregate(partial)
  assert(rejectedState.perChatHistoryDiagnostics?.chats[0].completionDecision?.reason=="has_previous_page_true")
  partial=agg(0,false,nil)
  rejectedState.beginPerChatHistoryDiagnostic(ordinal:3)
  rejectedState.recordPerChatCompletionDecision(candidate:true,accepted:false,reason:"aggregate_empty",aggregate:partial,hasPreviousPage:nil,historyComplete:false)
  assert(rejectedState.perChatHistoryDiagnostics?.chats[1].completionDecision?.reason=="aggregate_empty")
  rejectedState.beginPerChatHistoryDiagnostic(ordinal:4)
  rejectedState.recordPerChatCompletionDecision(candidate:true,accepted:true,reason:"none",aggregate:complete,hasPreviousPage:false,historyComplete:true)
  rejectedState.recordPerChatPersistedAggregate(agg(3,false,true))
  assert(rejectedState.perChatHistoryDiagnostics?.chats[2].completionDecision?.reason=="completion_set_but_lost_before_persist")
  rejectedState.beginPerChatHistoryDiagnostic(ordinal:5)
  rejectedState.recordPerChatCompletionDecision(candidate:false,accepted:false,reason:"no_accepted_history_response",aggregate:agg(0,false,nil),hasPreviousPage:nil,historyComplete:false)
  assert(rejectedState.perChatHistoryDiagnostics?.chats[3].completionDecision?.reason=="no_accepted_history_response")
  rejectedState.beginPerChatHistoryDiagnostic(ordinal:6)
  rejectedState.recordPerChatCompletionDecision(candidate:false,accepted:false,reason:"has_previous_page_unknown",aggregate:agg(1,false,nil),hasPreviousPage:nil,historyComplete:false)
  assert(rejectedState.perChatHistoryDiagnostics?.chats[4].completionDecision?.reason=="has_previous_page_unknown")
  var state=CycleState()
  state.beginPerChatHistoryDiagnostic(ordinal:1)
  state.recordObservedHistoryRequest();state.recordObservedHistoryResponse()
  let accepted:[String:Any]=[
   "sequence":1,"pageUpdateCallbackFired":true,
   "responseParseDiagnostic":["endpointTemplate":"/backend-api/conversations/:id/messages","transport":"fetch","status":200,"contentTypeCategory":"json","topLevelType":"object","topLevelKeyNames":["messages","page_info"],"topLevelArrayCounts":[["key":"messages","count":2]],"expectedStructure":["messagesArray":true,"pageInfoObject":true,"hasPreviousPageBoolean":true],"parserAttempted":true,"parserAccepted":true,"rejectionReason":"accepted","extractedPageCount":1,"extractedMessageCount":2,"hasPreviousPage":true]
  ]
  state.recordHistoryResponseParsing(accepted)
  var completeTelemetry=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:1))
  completeTelemetry.checkProgress.observeParsedResponse(HistoryResponseParseEntry.make(accepted))
  completeTelemetry.renderedDOMTurnCount=2;completeTelemetry.hasPreviousPage=false
  _=completeTelemetry.pagination.observe(messageIDs:["one","two"],messageCount:2,pageNumber:1,hasPreviousPage:true)
  state.finishPerChatHistoryDiagnostic(terminal:"Complete",telemetry:completeTelemetry)

  state.beginPerChatHistoryDiagnostic(ordinal:2)
  assert(state.perChatHistoryDiagnostics?.chats.count==2 && state.perChatHistoryDiagnostics?.chats.first?.parserAccepted==1)
  state.recordObservedHistoryRequest();state.recordObservedHistoryResponse();state.recordHistoryResponseParsing(accepted)
  // A continuation for the same checked chat must append to Chat 2, not create Chat 3.
  state.beginPerChatHistoryDiagnostic(ordinal:2);assert(state.perChatHistoryDiagnostics?.chats.count==2);state.recordObservedHistoryRequest();state.recordObservedHistoryResponse();state.recordHistoryResponseParsing(accepted)
  state.finishPerChatHistoryDiagnostic(terminal:"Partial · pagination_no_progress",telemetry:nil)

  state.beginPerChatHistoryDiagnostic(ordinal:3)
  state.recordObservedHistoryRequest();state.recordObservedHistoryResponse()
  var failedEvent=accepted;failedEvent["pageUpdateCallbackFired"]=false
  var rejectedShape=accepted["responseParseDiagnostic"] as! [String:Any]
  rejectedShape["parserAccepted"]=false;rejectedShape["rejectionReason"]="messages_array_missing"
  rejectedShape["topLevelKeyNames"]=["mapping"]
  failedEvent["responseParseDiagnostic"]=rejectedShape
  state.recordHistoryResponseParsing(failedEvent)
  var unrecognizedEvent=accepted
  var unrecognizedShape=accepted["responseParseDiagnostic"] as! [String:Any]
  unrecognizedShape["endpointTemplate"]="/backend-api/:other";unrecognizedShape["parserAttempted"]=false;unrecognizedShape["parserAccepted"]=false;unrecognizedShape["rejectionReason"]="endpoint_not_recognized"
  unrecognizedEvent["responseParseDiagnostic"]=unrecognizedShape
  state.recordHistoryResponseParsing(unrecognizedEvent)
  state.finishPerChatHistoryDiagnostic(terminal:"Failed · no_progress · waiting_history",telemetry:nil)

  state.beginPerChatHistoryDiagnostic(ordinal:4)
  state.recordObservedHistoryRequest();state.recordObservedHistoryResponse()
  state.recordHistoryResponseParsing(accepted)
  var timeoutTelemetry=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:2))
  timeoutTelemetry.hasPreviousPage=true
  _=timeoutTelemetry.pagination.observe(messageIDs:["older"],messageCount:1,pageNumber:1,hasPreviousPage:true)
  state.finishPerChatHistoryDiagnostic(terminal:"Timed out · per_chat_timeout · pagination_progressing · timeout_absolute_cap",telemetry:timeoutTelemetry)

  let diagnostics=state.perChatHistoryDiagnostics!
  assert(diagnostics.chats.count==4)
  let chats=diagnostics.chats
  assert(chats[0].ordinal==1 && chats[0].terminalReason=="complete" && chats[0].parserAccepted==1 && chats[0].pageUpdateCallbacks==1)
  assert(chats[1].ordinal==2 && chats[1].historyRequestsObserved==2 && chats[1].parserAccepted==2)
  assert(chats[2].terminalReason=="waiting_history" && chats[2].parserRejected==1 && chats[2].endpointNotRecognized==1 && chats[2].topRejectionReason=="endpoint_not_recognized")
  assert(chats[3].timeoutState=="timed_out" && chats[3].timeoutReason=="timeout_absolute_cap" && chats[3].paginationProgressObserved)
  assert(diagnostics.summary.contains("Chat 4") && diagnostics.summary.contains("completion not evaluated"))
  let persistedFour=try JSONDecoder().decode(CycleState.self,from:JSONEncoder().encode(state))
  assert(persistedFour.perChatHistoryDiagnostics?.chats.count==4)
  assert(persistedFour.perChatHistoryDiagnostics?.chats[2].terminalReason=="waiting_history")
  assert(persistedFour.perChatHistoryDiagnostics?.chats[3].timeoutReason=="timeout_absolute_cap")

  state.beginPerChatHistoryDiagnostic(ordinal:5)
  for index in 0..<24 {var event=accepted;event["sequence"]=index;state.recordHistoryResponseParsing(event)}
  assert(state.perChatHistoryDiagnostics?.chats.last?.parserAccepted==24)
  assert(state.perChatHistoryDiagnostics?.chats.last?.responseEntries.count==20)

  var privateEvent=accepted;privateEvent["rawURL"]="https://chatgpt.com/c/private-id?token=secret";privateEvent["title"]="private title";privateEvent["body"]="private message text"
  var unsafeShape=privateEvent["responseParseDiagnostic"] as! [String:Any]
  unsafeShape["topLevelKeyNames"]=["messages","private title","private-id"]
  privateEvent["responseParseDiagnostic"]=unsafeShape
  state.recordHistoryResponseParsing(privateEvent)
  let encoded=String(decoding:try JSONEncoder().encode(state),as:UTF8.self)
  for value in ["private-id","private title","private message text","https://chatgpt.com","token=secret","conversationId","rawURL","responseBody"] {assert(!encoded.contains(value))}
  state.perChatHistoryDiagnostics?.reset()
  assert(state.perChatHistoryDiagnostics?.chats.isEmpty == true && state.perChatHistoryDiagnostics?.activeOrdinal==nil)
  let roundTrip=try JSONDecoder().decode(CycleState.self,from:JSONEncoder().encode(state))
  assert(roundTrip.perChatHistoryDiagnostics?.chats.isEmpty == true)
 }
 static func pinnedUnknownRowDiagnosticTests() throws {
  var state=CycleState()
  let raw:[String:Any]=["positionIndex":27,"tag":"A","routeTemplate":"/g/:id/c/:id","hasHref":true,"hasOctaneNavigationItem":true,
   "dataAttributeNames":["data-octane-navigation-item","data-status","data-secret-private-value"],"ariaAttributeNames":["aria-label","aria-current"],"visible":true,
   "conversationRouteClassification":"conversation","navigationRowClassification":"conversation_row","pinnedStarredClassification":"unknown",
   "structuralClassification":"octane_conversation_row_variant","rejectionReason":"menu_items_missing",
   "title":"PRIVATE CHAT TITLE","conversationId":"PRIVATE-CHAT-ID","rawHref":"/g/PRIVATE-PROJECT/c/PRIVATE-CHAT?token=PRIVATE-TOKEN","ariaLabel":"PRIVATE ARIA"]
  let diagnostic=PinnedUnknownRowDiagnostic.make(raw)!
  assert(diagnostic.positionIndex==27 && diagnostic.routeTemplate=="/g/:id/c/:id")
  assert(diagnostic.dataAttributeNames==["data-octane-navigation-item","data-secret-private-value","data-status"])
  state.lastPinnedUnknownRows=[diagnostic]
  let encoded=try JSONEncoder().encode(state),json=String(data:encoded,encoding:.utf8)!
  for secret in ["PRIVATE CHAT TITLE","PRIVATE-CHAT-ID","PRIVATE-PROJECT","PRIVATE-TOKEN","PRIVATE ARIA"] {assert(!json.contains(secret))}
  let restored=try JSONDecoder().decode(CycleState.self,from:encoded)
  assert(restored.lastPinnedUnknownRows==[diagnostic])
  assert(diagnostic.compactLine=="row 27 · octane_conversation_row_variant · reason menu_items_missing")
  let malicious=PinnedUnknownRowDiagnostic.make(["positionIndex":999,"tag":"<script>","routeTemplate":"/c/private-id?token=secret","conversationRouteClassification":"private text","rejectionReason":"secret title"])!
  assert(malicious.positionIndex==256 && malicious.tag=="unknown" && malicious.routeTemplate=="/unknown")
  assert(malicious.conversationRouteClassification=="unknown" && malicious.rejectionReason=="unknown_pin_state")
  assert(PinnedUnknownRowDiagnostic.make(["dataAttributeNames":Array(repeating:"data-x",count:40)] )!.dataAttributeNames==["data-x"])
 }
 static func diagnosticGenerationGateTests() {
  var gate=DiagnosticOperationGenerationGate()
  let pinnedRows=gate.tryBegin()!
  assert(gate.isActive && gate.tryBegin()==nil) // live owner blocks a concurrent diagnostic
  assert(gate.finish(pinnedRows)) // pinned_prefix_complete terminal cleanup
  let hiddenRender=gate.tryBegin()!
  assert(gate.owns(hiddenRender) && !gate.owns(pinnedRows)) // next diagnostic starts
  assert(!gate.finish(pinnedRows) && gate.owns(hiddenRender)) // stale owner cannot clear successor
  assert(gate.finish(hiddenRender) && !gate.isActive)
  for terminal in ["success","timeout","cancelled"] {
   let generation=gate.tryBegin()!
   assert(gate.finish(generation), "\(terminal) must release diagnostic ownership")
   assert(!gate.isActive && gate.tryBegin() != nil)
   let cleanup=gate.activeGeneration!
   assert(gate.finish(cleanup))
  }
 }
 static func rescueGenerationGateTests() {
  var diagnostics=DiagnosticOperationGenerationGate()
  var rescue=RescueOperationGenerationGate()
  let previousDiagnostic=diagnostics.tryBegin()!
  assert(diagnostics.finish(previousDiagnostic))
  let generation=rescue.begin()!
  assert(rescue.owns(generation) && rescue.isActive)
  assert(rescue.begin()==nil) // duplicate Rescue is rejected while its owner is live
  assert(!rescue.finish(previousDiagnostic)) // stale diagnostic cannot release Rescue
  assert(rescue.owns(generation))
  assert(rescue.finish(generation) && !rescue.isActive)
  assert(diagnostics.tryBegin() != nil) // Rescue cleanup did not clear diagnostic state
 }
 static func nativeRescueStatusTests() {
  let complete=nativeRescueSummary(complete:true,messageCount:8,reason:"top_and_end_reached",scrollRestored:true)
  assert(complete.contains("Complete") && !complete.contains("\\(summary)"))
  assert(nativeRescueSavedStatus(summary:complete,textSaved:true)=="Native Rescue: Complete · 8 messages · top_and_end_reached · scroll restore yes · HTML/TXT saved locally")
  let partial=nativeRescueSummary(complete:false,messageCount:3,reason:"capture_timeout",scrollRestored:false)
  assert(partial.contains("Partial") && partial.contains("capture_timeout"))
  assert(nativeRescueSavedStatus(summary:partial,textSaved:false).hasSuffix("HTML saved; TXT skipped"))
  assert(!"Native Rescue: export_cancelled".contains("saved locally"))
 }
 static func activityObservationWindowTests() {
  let window=ActivityObservationWindow(generation:"op-1",expectedConversationID:"expected",startedAtMs:1000)
  assert(!window.accepts(generation:"op-1",receivedAtMs:999,conversationID:"expected"))
  assert(!window.accepts(generation:"op-1",receivedAtMs:1000,conversationID:"other"))
  assert(!window.accepts(generation:"old",receivedAtMs:1001,conversationID:"expected"))
  assert(window.accepts(generation:"op-1",receivedAtMs:1001,conversationID:"expected"))
 }
 static func riskModelTests() {
  let beta=buildRiskModel(samples:[])
  assert(beta==RiskModel.beta && beta.source == .betaBaseline)
  assert(beta.safeCeiling==210640 && beta.limitFloor==539543)
  assert(beta.watch==309311 && beta.near==407982 && beta.critical==473762)
  assert(beta.normalSamples==5 && beta.limitSamples==3)
  let insufficient=[RiskCalibrationSample(label:"normal",estimatedTextTokens:100,complete:true),RiskCalibrationSample(label:"limit_reached",estimatedTextTokens:1000,complete:true)]
  assert(buildRiskModel(samples:insufficient).source == .betaBaseline)
  let valid=[RiskCalibrationSample(label:"normal",estimatedTextTokens:100,complete:true),RiskCalibrationSample(label:"normal",estimatedTextTokens:200,complete:true),RiskCalibrationSample(label:"limit_reached",estimatedTextTokens:1000,complete:true),RiskCalibrationSample(label:"limit_reached",estimatedTextTokens:1100,complete:true)]
  let personal=buildRiskModel(samples:valid)
  assert(personal.source == .personalCalibration && personal.safeCeiling==200 && personal.limitFloor==1000)
  assert(personal.watch==440 && personal.near==680 && personal.critical==840)
  assert(buildRiskModel(samples:valid+[RiskCalibrationSample(label:"normal",estimatedTextTokens:1000,complete:true)]).source == .betaBaseline)
  assert(buildRiskModel(samples:valid.map{RiskCalibrationSample(label:$0.label,estimatedTextTokens:$0.estimatedTextTokens,complete:false)}).source == .betaBaseline)
  assert(assessRisk(model:beta,estimatedTextTokens:beta.watch-1,measurement:.complete).level=="Normal")
  assert(assessRisk(model:beta,estimatedTextTokens:beta.watch,measurement:.complete).level=="Watch")
  assert(assessRisk(model:beta,estimatedTextTokens:beta.near,measurement:.complete).level=="Near")
  assert(assessRisk(model:beta,estimatedTextTokens:beta.critical,measurement:.complete).level=="Critical")
  assert(assessRisk(model:beta,estimatedTextTokens:beta.limitFloor-1,measurement:.complete).level=="Critical")
  assert(assessRisk(model:beta,estimatedTextTokens:beta.limitFloor,measurement:.complete).level=="Limit floor")
  assert(assessRisk(model:personal,estimatedTextTokens:personal.limitFloor,measurement:.complete).level=="Limit floor")
  assert(assessRisk(model:beta,estimatedTextTokens:beta.limitFloor,measurement:.partial).level=="At least Limit floor")
  assert(riskNotificationNeeded(previousObservedRank:3,lastAcceptedRank:3,next:assessRisk(model:beta,estimatedTextTokens:beta.limitFloor,measurement:.complete))=="Limit floor")
  assert(riskNotificationNeeded(previousObservedRank:4,lastAcceptedRank:4,next:assessRisk(model:beta,estimatedTextTokens:beta.critical,measurement:.complete))==nil)
  assert(partialRiskNotificationNeeded(lastAcceptedRank:3,lowerBoundTokens:beta.limitFloor,model:beta)=="Limit floor")
  let cutoff=1_800_000_000_000.0
  func maintenanceRecord(_ id:String,checked:Double,tokens:Int=131_546,result:String="Partial · pagination_progressing")->ChatRecord {
   let aggregate=SafeAggregate(conversationId:id,title:"private",processedMessageIds:[],messagesCollected:1282,userMessages:641,assistantMessages:641,otherMessages:0,estimatedTextTokens:tokens,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:false,hasPreviousPage:true,hasNextPage:nil,responsesCaptured:2,updatedAt:nil)
   return ChatRecord(conversationId:id,title:"private",lastSeenUpdatedAt:cutoff-2*86400000,lastCheckAt:checked,lastCheckResult:result,aggregate:aggregate)
  }
  let caseRecord=maintenanceRecord("vikkey-series",checked:cutoff-13*3600000)
  let admitted=selectStaleIncompleteMaintenanceCandidates(records:[caseRecord],discoveredIDs:["vikkey-series"],recentIDs:[],nowMs:cutoff)
  assert(admitted.eligibleCount==1 && admitted.admitted.map(\.conversationId)==["vikkey-series"])
  assert(CycleState().queue(admitted.admitted).count==1)
  assert(staleIncompleteMaintenanceEligibilityReason(admitted:true)=="stale_incomplete_maintenance")
  assert(staleIncompleteMaintenanceEligibilityReason(admitted:false)==nil)
  let tooFresh=maintenanceRecord("fresh",checked:cutoff-11*3600000)
  assert(selectStaleIncompleteMaintenanceCandidates(records:[tooFresh],discoveredIDs:["fresh"],recentIDs:[],nowMs:cutoff).admitted.isEmpty)
  var completeRecord=maintenanceRecord("complete",checked:cutoff-13*3600000,result:"Complete")
  completeRecord.aggregate=SafeAggregate(conversationId:"complete",title:"private",processedMessageIds:[],messagesCollected:1282,userMessages:641,assistantMessages:641,otherMessages:0,estimatedTextTokens:131546,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:true,hasPreviousPage:false,hasNextPage:false,responsesCaptured:2,updatedAt:nil)
  assert(selectStaleIncompleteMaintenanceCandidates(records:[completeRecord],discoveredIDs:["complete"],recentIDs:[],nowMs:cutoff).admitted.isEmpty)
  assert(selectStaleIncompleteMaintenanceCandidates(records:[caseRecord],discoveredIDs:[],recentIDs:[],nowMs:cutoff).admitted.isEmpty)
  assert(selectStaleIncompleteMaintenanceCandidates(records:[caseRecord],discoveredIDs:["vikkey-series"],recentIDs:["vikkey-series"],nowMs:cutoff).admitted.isEmpty)
  let many=(0..<5).map{maintenanceRecord("id\($0)",checked:cutoff-Double(20-$0)*3600000,tokens:131546+$0)}
  let capped=selectStaleIncompleteMaintenanceCandidates(records:many,discoveredIDs:Set(many.map(\.conversationId)),recentIDs:[],nowMs:cutoff)
  assert(capped.eligibleCount==5 && capped.admitted.count==3 && capped.deferredCount==2)
  assert(capped.admitted.compactMap(\.lastCheckAt)==many.prefix(3).compactMap(\.lastCheckAt))
  let tie=selectStaleIncompleteMaintenanceCandidates(records:[maintenanceRecord("b",checked:cutoff-13*3600000,tokens:200),maintenanceRecord("a",checked:cutoff-13*3600000,tokens:300)],discoveredIDs:["a","b"],recentIDs:[],nowMs:cutoff,cap:1)
  assert(tie.admitted.first?.aggregate?.estimatedTextTokens==300)
  let deterministicTie=selectStaleIncompleteMaintenanceCandidates(records:[maintenanceRecord("z",checked:cutoff-13*3600000,tokens:300),maintenanceRecord("a",checked:cutoff-13*3600000,tokens:300)],discoveredIDs:["a","z"],recentIDs:[],nowMs:cutoff,cap:1)
  assert(deterministicTie.admitted.first?.conversationId=="a")
  let regression=maintenanceRecord("regression-vikkey-series",checked:cutoff-13*3600000)
  assert(regression.aggregate?.estimatedTextTokens==131546 && regression.lastSeenUpdatedAt<cutoff-21600000)
  assert(selectStaleIncompleteMaintenanceCandidates(records:[regression],discoveredIDs:["regression-vikkey-series"],recentIDs:[],nowMs:cutoff).admitted.count==1)
  let skippedUnchangedRecord=ChatRecord(conversationId:"unchanged",title:"private",lastSeenUpdatedAt:cutoff-10_000,lastCheckedUpdatedAt:cutoff-10_000,lastCheckResult:"Complete",aggregate:SafeAggregate(conversationId:"unchanged",title:"",processedMessageIds:[],messagesCollected:2,userMessages:1,assistantMessages:1,otherMessages:0,estimatedTextTokens:100,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:true,hasPreviousPage:false,hasNextPage:false,responsesCaptured:1,updatedAt:nil))
  let excludedForCooldown=maintenanceRecord("cooldown",checked:cutoff-11*3600000)
  let unchangedQueue=CycleState().queue([skippedUnchangedRecord]+selectStaleIncompleteMaintenanceCandidates(records:[excludedForCooldown],discoveredIDs:["cooldown"],recentIDs:[],nowMs:cutoff).admitted)
  assert(unchangedQueue.isEmpty) // excluded maintenance records never enter candidate count or alter Skipped unchanged
  var diagnosticState=CycleState()
  var matchedRecord=ChatRecord(conversationId:"route-secret-id",title:"PRIVATE TITLE",lastSeenUpdatedAt:2_000,lastCheckAt:1_500,lastCheckResult:"Partial · pagination_progressing",lastRiskRank:2,lastNotifiedRiskRank:2)
  matchedRecord.aggregate=SafeAggregate(conversationId:"route-secret-id",title:"PRIVATE TITLE",processedMessageIds:["PRIVATE MESSAGE ID"],messagesCollected:17,userMessages:8,assistantMessages:9,otherMessages:0,estimatedTextTokens:420_000,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:false,hasPreviousPage:true,hasNextPage:nil,responsesCaptured:2,updatedAt:nil)
  matchedRecord.pendingActivityNeedsAttention=true
  var decoyRecord=ChatRecord(conversationId:"other-secret-id",title:"OTHER PRIVATE TITLE",lastSeenUpdatedAt:3_000,lastCheckResult:"Complete")
  decoyRecord.aggregate=SafeAggregate(conversationId:"other-secret-id",title:"OTHER PRIVATE TITLE",processedMessageIds:[],messagesCollected:4,userMessages:2,assistantMessages:2,otherMessages:0,estimatedTextTokens:beta.critical,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:true,hasPreviousPage:false,hasNextPage:false,responsesCaptured:1,updatedAt:nil)
  diagnosticState.records[matchedRecord.conversationId]=matchedRecord;diagnosticState.records[decoyRecord.conversationId]=decoyRecord
  diagnosticState.notificationAudit=[NotificationAuditRecord(auditId:"audit-secret",kind:"risk",conversationId:"route-secret-id",level:"Near",createdAt:1_550,dispatchAttemptedAt:1_551,outcome:"accepted",dedupKey:"PRIVATE DEDUP KEY",userVisibleDelivery:"unknown")]
  let beforeDiagnostic=try! JSONSerialization.jsonObject(with:JSONEncoder().encode(diagnosticState)) as! NSDictionary
  let matchedDiagnostic=persistedChatRecordDiagnostic(routeConversationID:"route-secret-id",state:diagnosticState)
  let afterDiagnostic=try! JSONSerialization.jsonObject(with:JSONEncoder().encode(diagnosticState)) as! NSDictionary
  assert(matchedDiagnostic.matched && matchedDiagnostic.lastCheckResult=="Partial · pagination_progressing")
  assert(matchedDiagnostic.measurement=="Partial" && matchedDiagnostic.riskCategory=="At least Near" && matchedDiagnostic.betaRiskCategory=="At least Near", "\(matchedDiagnostic.measurement) / \(matchedDiagnostic.riskCategory) / \(matchedDiagnostic.betaRiskCategory)")
  assert(matchedDiagnostic.tokenLowerBound==420_000 && matchedDiagnostic.messageLowerBound==17 && matchedDiagnostic.historyComplete=="no" && matchedDiagnostic.hasPreviousPage=="yes")
  assert(matchedDiagnostic.activityState=="new_activity_pending" && matchedDiagnostic.notificationGenerated=="yes" && matchedDiagnostic.notificationOutcome=="accepted" && matchedDiagnostic.notificationLevel=="Near")
  assert(matchedDiagnostic.priorWatchNearCritical=="yes · Near")
  for secret in ["route-secret-id","other-secret-id","PRIVATE TITLE","OTHER PRIVATE TITLE","PRIVATE MESSAGE ID","PRIVATE DEDUP KEY","https://"] {assert(!matchedDiagnostic.displayText.contains(secret))}
  assert(beforeDiagnostic==afterDiagnostic)
  assert(persistedChatRecordDiagnostic(routeConversationID:"missing-secret-id",state:diagnosticState).displayText=="matched: no · reason record_not_present")
  assert(persistedChatRecordDiagnostic(routeConversationID:nil,state:diagnosticState).displayText=="matched: no · reason route_id_unavailable")
  assert(persistedChatRecordDiagnostic(routeConversationID:"route-secret-id",state:nil).displayText=="matched: no · reason state_not_loaded")
  // Token thresholds never label a chat Limit reached.
  assert(assessRisk(model:beta,estimatedTextTokens:900000,measurement:.complete).level=="Limit floor")
  assert(assessRisk(model:beta,estimatedTextTokens:beta.watch-1,measurement:.partial).level=="Unknown")
  let timedOutMeasurement=riskMeasurementStatus(result:"Timed out · per_chat_timeout · pagination · timeout_during_cached_replay",aggregate:nil)
  assert(assessRisk(model:beta,estimatedTextTokens:nil,measurement:timedOutMeasurement).level=="Unknown")
  assert(assessRisk(model:beta,estimatedTextTokens:beta.watch,measurement:.partial).level=="At least Watch")
  assert(assessRisk(model:beta,estimatedTextTokens:beta.near,measurement:.partial).level=="At least Near")
  assert(assessRisk(model:beta,estimatedTextTokens:nil,measurement:.unknown).level=="Unknown")
  let watch=RiskAssessment(level:"Watch",rank:1,measurement:.complete)
  let near=RiskAssessment(level:"Near",rank:2,measurement:.complete)
  let critical=RiskAssessment(level:"Critical",rank:3,measurement:.complete)
  assert(riskUpwardCrossing(previousRank:0,next:watch)=="Watch")
  assert(riskUpwardCrossing(previousRank:1,next:near)=="Near")
  assert(riskUpwardCrossing(previousRank:2,next:critical)=="Critical")
  assert(riskUpwardCrossing(previousRank:0,next:critical)=="Critical") // one notification for a multi-level jump
  assert(riskUpwardCrossing(previousRank:1,next:watch)==nil) // same level on next cycle
  assert(riskUpwardCrossing(previousRank:nil,next:watch)=="Watch")
  assert(riskUpwardCrossing(previousRank:nil,next:near)=="Near")
  assert(riskUpwardCrossing(previousRank:nil,next:critical)=="Critical")
  assert(riskUpwardCrossing(previousRank:nil,next:RiskAssessment(level:"Normal",rank:0,measurement:.complete))==nil)
  assert(riskNotificationNeeded(previousObservedRank:nil,lastAcceptedRank:nil,next:critical)=="Critical")
  assert(riskNotificationNeeded(previousObservedRank:nil,lastAcceptedRank:nil,next:watch)=="Watch")
  assert(riskNotificationNeeded(previousObservedRank:nil,lastAcceptedRank:nil,next:near)=="Near")
  assert(riskNotificationNeeded(previousObservedRank:1,lastAcceptedRank:1,next:watch)==nil)
  assert(riskNotificationNeeded(previousObservedRank:1,lastAcceptedRank:1,next:near)=="Near")
  assert(riskNotificationNeeded(previousObservedRank:2,lastAcceptedRank:2,next:critical)=="Critical")
  assert(riskNotificationNeeded(previousObservedRank:0,lastAcceptedRank:1,next:watch)=="Watch") // re-cross after a real decline
  assert(partialRiskNotificationNeeded(lastAcceptedRank:nil,lowerBoundTokens:beta.watch-1,model:beta)==nil)
  assert(partialRiskNotificationNeeded(lastAcceptedRank:nil,lowerBoundTokens:beta.watch,model:beta)==nil)
  assert(partialRiskNotificationNeeded(lastAcceptedRank:nil,lowerBoundTokens:beta.near,model:beta)=="Near")
  assert(partialRiskNotificationNeeded(lastAcceptedRank:nil,lowerBoundTokens:beta.critical,model:beta)=="Critical")
  assert(partialRiskNotificationNeeded(lastAcceptedRank:2,lowerBoundTokens:beta.near,model:beta)==nil) // no repeat at the accepted level
  assert(partialRiskNotificationNeeded(lastAcceptedRank:2,lowerBoundTokens:beta.critical,model:beta)=="Critical") // upward confirmed minimum-risk change
  assert(incompleteRiskNotificationNeeded(measurement:.partial,lastAcceptedRank:nil,lowerBoundTokens:beta.near,model:beta)=="Near")
  assert(incompleteRiskNotificationNeeded(measurement:.partial,lastAcceptedRank:nil,lowerBoundTokens:beta.critical,model:beta)=="Critical")
  assert(incompleteRiskNotificationNeeded(measurement:.partial,lastAcceptedRank:nil,lowerBoundTokens:483_894,model:beta)=="Critical")
  assert(incompleteRiskNotificationNeeded(measurement:.unknown,lastAcceptedRank:nil,lowerBoundTokens:483_894,model:beta)=="Critical")
  assert(riskRank("Critical")==3) // accepted runtime-case notification persists the Critical dedupe rank
  assert(incompleteRiskNotificationNeeded(measurement:.unknown,lastAcceptedRank:nil,lowerBoundTokens:beta.near,model:beta)=="Near")
  assert(incompleteRiskNotificationNeeded(measurement:.unknown,lastAcceptedRank:nil,lowerBoundTokens:beta.watch,model:beta)==nil)
  assert(incompleteRiskNotificationNeeded(measurement:.unknown,lastAcceptedRank:nil,lowerBoundTokens:beta.watch-1,model:beta)==nil)
  assert(incompleteRiskNotificationNeeded(measurement:.unknown,lastAcceptedRank:nil,lowerBoundTokens:nil,model:beta)==nil)
  assert(incompleteRiskNotificationNeeded(measurement:.partial,lastAcceptedRank:3,lowerBoundTokens:beta.critical,model:beta)==nil)
  assert(incompleteRiskNotificationNeeded(measurement:.unknown,lastAcceptedRank:2,lowerBoundTokens:beta.critical,model:beta)=="Critical")
  assert(incompleteRiskNotificationNeeded(measurement:.complete,lastAcceptedRank:nil,lowerBoundTokens:beta.critical,model:beta)==nil)
  let terminalBeforeNotification="Timed out · per_chat_timeout"
  _=incompleteRiskNotificationNeeded(measurement:.unknown,lastAcceptedRank:nil,lowerBoundTokens:483_894,model:beta)
  assert(terminalBeforeNotification=="Timed out · per_chat_timeout") // classification does not rewrite terminal state
  assert(partialRiskNotificationContent(level:"Near")?.body=="This chat is at least Near limit. Full history couldn't be verified, so the actual size may be higher.")
  assert(partialRiskNotificationContent(level:"Critical")?.body=="This chat is at least Critical. Full history couldn't be verified, so the actual size may be higher.")
  assert(partialRiskNotificationContent(level:"Watch")==nil)
  assert(riskNotificationNeeded(previousObservedRank:1,lastAcceptedRank:1,next:near)=="Near") // complete path unchanged
  assert(shouldDispatchSystemRiskNotification(kind:"risk",level:"Watch"))
  assert(shouldDispatchSystemRiskNotification(kind:"risk",level:"Near"))
  assert(shouldDispatchSystemRiskNotification(kind:"risk",level:"Critical"))
  assert(!shouldDispatchSystemRiskNotification(kind:"uncertain",level:"Uncertain"))
  assert(!shouldDispatchSystemRiskNotification(kind:"monitoring",level:"degraded"))
  assert(!shouldDispatchSystemRiskNotification(kind:"risk",level:"Normal"))
  assert(riskNotificationNeeded(previousObservedRank:3,lastAcceptedRank:nil,next:critical)=="Critical") // failed dispatch retries
  assert(riskNotificationNeeded(previousObservedRank:3,lastAcceptedRank:3,next:critical)==nil)
  assert(retryRiskNotificationLevel(lastOutcome:"add_error",previousObservedRank:3,lastAcceptedRank:nil,next:critical)=="Critical")
  assert(retryRiskNotificationLevel(lastOutcome:"interrupted",previousObservedRank:3,lastAcceptedRank:nil,next:critical)=="Critical")
  assert(retryRiskNotificationLevel(lastOutcome:"accepted",previousObservedRank:3,lastAcceptedRank:nil,next:critical)==nil)
  assert(shouldRetryRootDiscovery(stallDetail:"no_list_response",rateLimited:false,retriesUsed:0))
  assert(!shouldRetryRootDiscovery(stallDetail:"no_list_response",rateLimited:false,retriesUsed:1))
  assert(!shouldRetryRootDiscovery(stallDetail:"no_list_response",rateLimited:true,retriesUsed:0))
  assert(monitoringDiscoveryDegraded(baseDiscoveryComplete:false,rootResponseReceived:false,stallDetail:"no_list_response",rateLimited:false,safetyLimitExceeded:false))
  assert(monitoringDiscoveryDegraded(baseDiscoveryComplete:true,rootResponseReceived:true,stallDetail:nil,rateLimited:true,safetyLimitExceeded:false)) // root_http_429
  assert(!monitoringDiscoveryDegraded(baseDiscoveryComplete:true,rootResponseReceived:true,stallDetail:nil,rateLimited:false,safetyLimitExceeded:false))
  assert(isMonitoringDiscoveryFailure("no_list_response") && isMonitoringDiscoveryFailure("dom_fallback_visible_sidebar_rows_only") && isMonitoringDiscoveryFailure("root_http_429"))
  assert(isMonitoringDiscoveryFailure("root_request_without_response") && !isMonitoringDiscoveryFailure("incomplete_partitions"))
  assert(riskUpwardCrossing(previousRank:2,next:watch)==nil) // decline updates local rank; later upward crossing is allowed
  assert(riskUpwardCrossing(previousRank:1,next:near)=="Near")
  assert(riskUpwardCrossing(previousRank:0,next:RiskAssessment(level:"At least Watch",rank:1,measurement:.partial))==nil)
  assert(userFacingRiskLabel(RiskAssessment(level:"Normal",rank:0,measurement:.complete))==nil)
  assert(userFacingRiskLabel(RiskAssessment(level:"Watch",rank:1,measurement:.complete))=="Watch")
  assert(userFacingRiskLabel(RiskAssessment(level:"At least Near",rank:2,measurement:.partial))=="At least Near")
  assert(userFacingRiskChatTitle("Example",showTitles:true)=="Example")
  assert(userFacingRiskChatTitle("Example",showTitles:false)=="A recent chat")
  assert(userFacingRiskChatTitle(" \n ",showTitles:true)=="A recent chat")
  let notification=riskNotificationContent(level:"Near")
  assert(notification.title=="GPT Limits Tool" && notification.body.contains("Risk: Near"))
  for secret in ["private-title","private-id","private-message"] {assert(!notification.title.contains(secret) && !notification.body.contains(secret))}
  assert(showChatTitlesInNotifications(storedValue:nil))
  assert(showChatTitlesInNotifications(storedValue:true) && !showChatTitlesInNotifications(storedValue:false))
  let titled=riskNotificationContent(level:"Watch",chatTitle:"Chat 3D-модели",showChatTitle:true)
  assert(titled.body.contains("“Chat 3D-модели” is approaching") && titled.body.contains("Risk: Watch"))
  let noTitle=riskNotificationContent(level:"Critical",chatTitle:nil,showChatTitle:true)
  assert(noTitle.body=="A recent chat is approaching the conversation length limit.\nRisk: Critical")
  let privateMode=riskNotificationContent(level:"Near",chatTitle:"Private title",showChatTitle:false)
  assert(!privateMode.body.contains("Private title") && privateMode.body.contains("Risk: Near"))
  assert(!titled.body.contains("private-id") && !titled.body.contains("private-message"))
  assert(riskNotificationRoute(conversationID:"chat-123")=="/c/chat-123")
  assert(riskNotificationRoute(conversationID:"bad/id")==nil)
  assert(validatedRiskNotificationRoute("/g/project-1/c/chat-123")=="/g/project-1/c/chat-123")
  assert(validatedRiskNotificationRoute("https://chatgpt.com/c/chat-123")==nil)
  let chatA=ChatRecord(conversationId:"a",title:"A",lastSeenUpdatedAt:1,lastRiskRank:0)
  let chatB=ChatRecord(conversationId:"b",title:"B",lastSeenUpdatedAt:1,lastRiskRank:0)
  assert(riskUpwardCrossing(previousRank:chatA.lastRiskRank,next:watch)=="Watch")
  assert(riskUpwardCrossing(previousRank:chatB.lastRiskRank,next:watch)=="Watch")
  let aggregate=SafeAggregate(conversationId:"private-id",title:"private-title",processedMessageIds:[],messagesCollected:1,userMessages:1,assistantMessages:0,otherMessages:0,estimatedTextTokens:beta.watch,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:true,hasPreviousPage:false,hasNextPage:false,responsesCaptured:1,updatedAt:nil)
  assert(riskMeasurementStatus(result:"Complete",aggregate:aggregate) == .complete)
  assert(riskMeasurementStatus(result:"Partial",aggregate:aggregate) == .partial)
  assert(riskMeasurementStatus(result:"Failed",aggregate:aggregate) == .unknown)
  // A short conversation is complete only when the accepted terminal page proves it.
  let shortComplete=SafeAggregate(conversationId:"short",title:"Short",processedMessageIds:["u","a"],messagesCollected:2,userMessages:1,assistantMessages:1,otherMessages:0,estimatedTextTokens:120,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:true,hasPreviousPage:false,hasNextPage:false,responsesCaptured:1,updatedAt:nil)
  let stalePartial=SafeAggregate(conversationId:"short",title:"Short",processedMessageIds:["u","a"],messagesCollected:2,userMessages:1,assistantMessages:1,otherMessages:0,estimatedTextTokens:100,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:false,hasPreviousPage:true,hasNextPage:false,responsesCaptured:1,updatedAt:nil)
  var staleShort=ChatRecord(conversationId:"short",title:"Short",lastSeenUpdatedAt:2000,lastCheckedUpdatedAt:1000,lastCheckResult:"Partial · pagination_no_progress",aggregate:stalePartial,consecutiveIncompleteChecks:2,uncertainSince:900,uncertainAcknowledgedAt:1100,partialObservedActivityAt:2000,paginationBoundaryMessageCount:2)
  staleShort.aggregate=shortComplete;staleShort.lastCheckResult="Complete";staleShort.lastCheckedUpdatedAt=staleShort.lastSeenUpdatedAt
  staleShort.consecutiveIncompleteChecks=0;staleShort.partialObservedActivityAt=nil;staleShort.paginationBoundaryMessageCount=nil;staleShort.uncertainSince=nil;staleShort.uncertainAcknowledgedAt=nil
  assert(riskMeasurementStatus(result:staleShort.lastCheckResult,aggregate:staleShort.aggregate) == .complete)
  assert(monitoringState(record:staleShort,model:beta,nowMs:3000) == .normal)
  assert(!warningBadgeVisible(record:staleShort,model:beta,nowMs:3000))
  func partialRecord(lastSeen:Double,lastCheck:Double?,tokens:Int,activityFlag:Bool=false)->ChatRecord {
   let partialAggregate=SafeAggregate(conversationId:"attention",title:"private",processedMessageIds:[],messagesCollected:2,userMessages:1,assistantMessages:1,otherMessages:0,estimatedTextTokens:tokens,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:false,hasPreviousPage:true,hasNextPage:nil,responsesCaptured:1,updatedAt:nil)
   var value=ChatRecord(conversationId:"attention",title:"private",lastSeenUpdatedAt:lastSeen,lastCheckedUpdatedAt:nil,lastCheckAt:lastCheck,lastCheckResult:"Partial · pagination_no_progress",aggregate:partialAggregate)
   value.pendingActivityNeedsAttention=activityFlag
   return value
  }
  let stalePartialRecord=partialRecord(lastSeen:1000,lastCheck:1001,tokens:beta.watch-1)
  assert(monitoringState(record:stalePartialRecord,model:beta,nowMs:3000) == .uncertain)
  assert(!needsAttentionActionable(record:stalePartialRecord,model:beta,nowMs:3000)) // old partial, no activity delta and below Watch
  let noTimestampGate=partialRecord(lastSeen:1000,lastCheck:nil,tokens:beta.watch-1)
  assert(!hasUnprocessedChatActivity(noTimestampGate) && !needsAttentionActionable(record:noTimestampGate,model:beta,nowMs:3000))
  let activePartial=partialRecord(lastSeen:1002,lastCheck:1001,tokens:beta.watch-1)
  assert(needsAttentionActionable(record:activePartial,model:beta,nowMs:3000))
  let currentCyclePartial=partialRecord(lastSeen:1000,lastCheck:1001,tokens:beta.watch-1,activityFlag:true)
  assert(needsAttentionActionable(record:currentCyclePartial,model:beta,nowMs:3000))
  let pendingRoundTrip=try! JSONDecoder().decode(ChatRecord.self,from:JSONEncoder().encode(currentCyclePartial))
  assert(pendingRoundTrip.pendingActivityNeedsAttention)
  for (tokens,expected) in [(beta.watch,RiskMonitoringState.watch),(beta.near,.near),(beta.critical,.critical)] {
   let riskPartial=partialRecord(lastSeen:1000,lastCheck:1001,tokens:tokens)
   assert(confirmedRiskFromLowerBound(tokens,model:beta)==expected)
   assert(needsAttentionActionable(record:riskPartial,model:beta,nowMs:3000))
  }
  var staleThenActive=stalePartialRecord;assert(!needsAttentionActionable(record:staleThenActive,model:beta,nowMs:3000))
  staleThenActive.lastSeenUpdatedAt=1002 // new activity makes the same preserved Partial actionable again
  assert(needsAttentionActionable(record:staleThenActive,model:beta,nowMs:3000))
  assert(!needsAttentionActionable(record:staleShort,model:beta,nowMs:3000)) // Complete below Watch
  var shortWithoutProof=staleShort;shortWithoutProof.lastCheckResult="Partial · no_progress · waiting_history";shortWithoutProof.aggregate?.historyComplete=false;shortWithoutProof.aggregate?.hasPreviousPage=nil;shortWithoutProof.uncertainSince=2000
  assert(riskMeasurementStatus(result:shortWithoutProof.lastCheckResult,aggregate:shortWithoutProof.aggregate) == .partial)
  assert(monitoringState(record:shortWithoutProof,model:beta,nowMs:3000) == .uncertain)
  var largePartial=staleShort;largePartial.lastCheckResult="Partial · pagination_no_progress";largePartial.aggregate?.historyComplete=false;largePartial.aggregate?.hasPreviousPage=true;largePartial.aggregate?.estimatedTextTokens=250_000;largePartial.uncertainSince=2000
  assert(warningBadgeVisible(record:largePartial,model:beta,nowMs:3000))
  let completeBelowWatch=staleShort
  assert(monitoringState(record:completeBelowWatch,model:beta,nowMs:3000) == .normal)
  for (tokens,expected) in [(beta.watch,"Watch"),(beta.near,"Near"),(beta.critical,"Critical")] {
   var atRisk=staleShort;atRisk.aggregate?.estimatedTextTokens=tokens
   let state=monitoringState(record:atRisk,model:beta,nowMs:3000)
   assert(state.rawValue==expected)
   assert(warningBadgeVisible(record:atRisk,model:beta,nowMs:3000))
  }
  assert(confirmedRiskFromLowerBound(200_000,model:beta) == .normal)
  assert(confirmedRiskFromLowerBound(330_000,model:beta) == .watch)
  assert(confirmedRiskFromLowerBound(420_000,model:beta) == .near)
  assert(confirmedRiskFromLowerBound(480_000,model:beta) == .critical)
  assert(confirmedRiskFromLowerBound(471_797,model:beta) == .near)
  assert(confirmedRiskFromLowerBound(nil,model:beta) == .normal)
  let persisted=ChatRecord(conversationId:"private-id",title:"private-title",lastSeenUpdatedAt:1,lastCheckedUpdatedAt:1,lastCheckAt:1,lastCheckResult:"Complete",aggregate:aggregate,calibrationLabel:"normal",lastRiskRank:2)
  let roundTrip=try! JSONDecoder().decode(ChatRecord.self,from:JSONEncoder().encode(persisted))
  assert(roundTrip.calibrationLabel=="normal" && roundTrip.lastRiskRank==2)
  let oldRecordData=try! JSONSerialization.data(withJSONObject:["conversationId":"old","title":"old","lastSeenUpdatedAt":1.0])
  let oldRecord=try! JSONDecoder().decode(ChatRecord.self,from:oldRecordData)
  assert(oldRecord.calibrationLabel==nil && oldRecord.lastRiskRank==nil)
  assert(oldRecord.lastNotifiedRiskRank==nil && oldRecord.consecutiveIncompleteChecks==0)
  assert(oldRecord.uncertainSince==nil && oldRecord.uncertainAcknowledgedAt==nil)
  assert(oldRecord.pendingActivityNeedsAttention==false)
  var active=ChatRecord(conversationId:"private-id",title:"private-title",lastSeenUpdatedAt:1000,lastCheckResult:"Partial · pagination_no_progress",aggregate:aggregate)
  active.aggregate?.historyComplete=false;active.aggregate?.hasPreviousPage=true
  assert(monitoringState(record:active,model:beta,nowMs:2000) == .uncertain)
  assert(confirmedRiskFromLowerBound(active.aggregate?.estimatedTextTokens,model:beta) == .watch)
  assert(monitoringState(record:active,model:beta,nowMs:2000) == .uncertain) // confirmed Watch minimum does not imply complete history
  active.aggregate?.estimatedTextTokens=471_797
  assert(monitoringState(record:active,model:beta,nowMs:2000) == .uncertain)
  assert(confirmedRiskFromLowerBound(active.aggregate?.estimatedTextTokens,model:beta) == .near)
  active.aggregate?.estimatedTextTokens=480_000
  assert(monitoringState(record:active,model:beta,nowMs:2000) == .uncertain)
  assert(confirmedRiskFromLowerBound(active.aggregate?.estimatedTextTokens,model:beta) == .critical)
  active.aggregate?.estimatedTextTokens=beta.watch-1
  assert(confirmedRiskFromLowerBound(active.aggregate?.estimatedTextTokens,model:beta) == .normal)
  assert(monitoringState(record:active,model:beta,nowMs:2000) == .uncertain)
  active.aggregate?.estimatedTextTokens=beta.near
  active.uncertainAcknowledgedAt=2000
  assert(!warningBadgeVisible(record:active,model:beta,nowMs:2000))
  assert(monitoringState(record:active,model:beta,nowMs:2000) == .uncertain)
  assert(confirmedRiskFromLowerBound(active.aggregate?.estimatedTextTokens,model:beta) == .near)
  active.uncertainAcknowledgedAt=nil;active.aggregate?.estimatedTextTokens=beta.watch
  assert(monitoringState(record:active,model:beta,nowMs:1000+7*60*60*1000) == .uncertain) // unresolved warning survives six-hour activity window
  active.uncertainSince=1001
  active.uncertainAcknowledgedAt=1500
  assert(monitoringState(record:active,model:beta,nowMs:1000+7*60*60*1000) == .uncertain) // acknowledgement is not a successful check
  assert(!warningBadgeVisible(record:active,model:beta,nowMs:1000+7*60*60*1000))
  let persistentRoundTrip=try! JSONDecoder().decode(ChatRecord.self,from:JSONEncoder().encode(active))
  assert(persistentRoundTrip.uncertainSince==1001 && persistentRoundTrip.uncertainAcknowledgedAt==1500)
  var refreshed=CycleState();refreshed.records[active.conversationId]=active
  refreshed.merge([["conversationId":"private-id","title":"private-title","updatedAt":2000.0]],source:.projectConversationUpdateTime,observedAt:2001)
  assert(refreshed.records["private-id"]?.uncertainAcknowledgedAt==nil) // new activity resurfaces the badge
  assert(warningBadgeVisible(record:refreshed.records["private-id"]!,model:beta,nowMs:1000+7*60*60*1000))
  var failedNoProgress=ChatRecord(conversationId:"other",title:"Other",lastSeenUpdatedAt:1000,lastCheckResult:"Failed · no_progress · waiting_history")
  assert(monitoringState(record:failedNoProgress,model:beta,nowMs:2000) == .uncertain)
  failedNoProgress.lastCheckResult="Failed · check_error";failedNoProgress.consecutiveIncompleteChecks=2
  assert(monitoringState(record:failedNoProgress,model:beta,nowMs:2000) == .uncertain)
  assert(warningBadgeVisible(record:failedNoProgress,model:beta,nowMs:2000)) // Uncertain remains a persistent UI warning
  assert(notificationAuditStatus(outcome:"pending",userVisibleDelivery:"unknown").contains("warning_decided"))
  assert(notificationAuditStatus(outcome:"attempted",userVisibleDelivery:"unknown").contains("dispatch requested"))
  let acceptedAudit=notificationAuditStatus(outcome:"accepted",userVisibleDelivery:nil)
  assert(acceptedAudit.contains("accepted by macOS") && acceptedAudit.contains("user-visible delivery unknown") && !acceptedAudit.lowercased().contains("delivered"))
  assert(notificationAuditStatus(outcome:"add_error",userVisibleDelivery:nil).contains("dispatch failed"))
  let oldAuditJSON=try! JSONSerialization.data(withJSONObject:["auditId":"audit","kind":"uncertain","level":"Uncertain","createdAt":1.0,"outcome":"accepted","dedupKey":"uncertain:internal:Uncertain"])
  let oldAudit=try! JSONDecoder().decode(NotificationAuditRecord.self,from:oldAuditJSON)
  assert(oldAudit.userVisibleDelivery==nil && notificationAuditStatus(outcome:oldAudit.outcome,userVisibleDelivery:oldAudit.userVisibleDelivery).contains("user-visible delivery unknown"))
  var incompleteState=CycleState();incompleteState.records[active.conversationId]=active
  assert(incompleteState.queue(incompleteState.recent(2000,ids:[active.conversationId])).count==1)
  active.lastCheckResult="Complete";active.aggregate?.historyComplete=true;active.aggregate?.hasPreviousPage=false;active.lastCheckedUpdatedAt=active.lastSeenUpdatedAt
  active.uncertainSince=nil;active.uncertainAcknowledgedAt=nil
  assert(monitoringState(record:active,model:beta,nowMs:2000) == .watch)
  active.aggregate?.estimatedTextTokens=beta.near
  assert(monitoringState(record:active,model:beta,nowMs:2000) == .near)
  active.aggregate?.estimatedTextTokens=beta.critical
  assert(monitoringState(record:active,model:beta,nowMs:2000) == .critical)
  active.aggregate?.estimatedTextTokens=beta.watch-1
  assert(monitoringState(record:active,model:beta,nowMs:2000) == .normal)
  assert(monitoringState(record:active,model:beta,nowMs:1000+7*60*60*1000) == .normal)
  active.lastSeenUpdatedAt+=1
  assert(monitoringState(record:active,model:beta,nowMs:2000) == .uncertain) // stale Complete and fresh activity
  var replay=ChatPaginationProgressTracker(initialMessageIDs:["old-1","old-2"],initialMessageCount:2)
  _=replay.observe(messageIDs:["old-1","old-2"],messageCount:2,pageNumber:1,hasPreviousPage:true)
  _=replay.observe(messageIDs:["old-1","old-2"],messageCount:2,pageNumber:2,hasPreviousPage:true)
  assert(replay.replayingSavedBoundary && !replay.shouldStopForNoProgress)
  _=replay.observe(messageIDs:["old-1","old-2","new-3"],messageCount:3,pageNumber:3,hasPreviousPage:true)
  assert(!replay.replayingSavedBoundary && replay.uniqueProgressingPages==1)
  print("Risk model: beta fallback, personal validity, thresholds, partial lower bounds, titled/private notifications, routes and per-chat crossing dedup passed")
 }
 static func timerTest() {
  let scheduler=NativeCycleScheduler();var fired=0
  scheduler.schedule(at:Date().addingTimeInterval(1800)){fired+=1}
  RunLoop.current.run(until:Date().addingTimeInterval(0.02));assert(fired==0)
  scheduler.schedule(at:Date().addingTimeInterval(0.01)){fired+=1}
  RunLoop.current.run(until:Date().addingTimeInterval(0.05));assert(fired==1)
  scheduler.cancel()
 }
 static func partitionTests() throws {
  let tokenA=String(repeating:"a",count:64),tokenB=String(repeating:"b",count:64)
  var registry=OriginLabelRegistry()
  assert(registry.label(tokenA)=="origin#1" && registry.label(tokenA)=="origin#1")
  assert(registry.label(tokenB)=="origin#2")
  registry.reset();assert(registry.label(tokenB)=="origin#1" && registry.label(tokenA)=="origin#2")
  assert(registry.label("RAW_ORIGIN")==nil)
  let raw:[String:Any]=["archived":false,"starred":false,"includeOrigin":tokenA,"excludeOrigin":NSNull(),"unknownScopeKeys":[],"valid":true]
  let decoded=PartitionDescriptor.decode(raw,registry:&registry)!
  assert(decoded.includeOrigin=="origin#2" && decoded.archived==false && decoded.starred==false)
  let included=PartitionDescriptor(archived:false,starred:false,includeOrigin:"origin#1")
  let excluded=PartitionDescriptor(archived:false,starred:false,excludeOrigin:"origin#1")
  assert(complementaryOrigins(included,excluded))
  assert(!complementaryOrigins(included,PartitionDescriptor(archived:false,excludeOrigin:"origin#2")))
  assert(!complementaryOrigins(included,PartitionDescriptor(archived:true,excludeOrigin:"origin#1")))
  assert(complementaryOrigins(included,PartitionDescriptor(archived:false,starred:false,excludeOrigin:"origin#1")))
  assert(!complementaryOrigins(PartitionDescriptor(archived:false,starred:true),PartitionDescriptor(archived:false,starred:false)))
  let cutoff=1000.0
  func page(_ offset:Int,_ times:[Double],sort:String="updated")->CoveragePage {
   var result=CoveragePage(scope:.filtered,streamId:0,sequence:offset+1,paginationKind:.offset,offset:offset,limit:2,itemCount:times.count,timestampsValid:true,times:times)
   result.sortOrder=sort;return result
  }
  func observation(_ descriptor:PartitionDescriptor,_ times:[Double],id:String)->PartitionObservation {
   var result=PartitionObservation(descriptor:descriptor)
   _=result.append(page(0,times),records:times.isEmpty ? []:[["conversationId":id,"updatedAt":times.first ?? 0]])
   return result
  }
  let a=observation(included,[1100,900],id:"same-id")
  let b=observation(excluded,[],id:"empty-id")
  assert(a.status(cutoff:cutoff) == .completeCutoff && b.status(cutoff:cutoff) == .completeEnd)
  assert(compositeCoverage([a,b],cutoff:cutoff).status == .incompletePartitions)
  assert(compositeCoverage([a,b],cutoff:cutoff).proofs.first?.contains("base complete")==true)
  let starredProbe=observation(PartitionDescriptor(archived:false,starred:true,includeOrigin:"origin#1"),[1100,900],id:"same-id")
  let starredProbeOther=observation(PartitionDescriptor(archived:false,starred:true,excludeOrigin:"origin#1"),[],id:"empty-starred-origin")
  let complete=compositeCoverage([a,b,starredProbe,starredProbeOther],cutoff:cutoff)
  assert(complete.status == .completeNonArchived && complete.status != .completeAccount)
  assert(complete.starredCoverageSource=="explicit_partition")
  assert(complete.scope=="non-archived conversations" && complete.proofs.count==2)
  assert(coverageDisplayLabel(complete)=="Complete — non-archived, unlocked chats")
  // A proven non-archived base plus starred coverage is complete for that scope;
  // archive coverage is not required and the label must not imply account-wide.
  assert(compositeCoverage([a,b,starredProbe,starredProbeOther],cutoff:cutoff).status == .completeNonArchived)
  var middle=observation(excluded,[1200,1100],id:"middle")
  assert(compositeCoverage([a,middle,starredProbe,starredProbeOther],cutoff:cutoff).status == .incompleteStall)
  _=middle.append(page(2,[1000,800]),records:[["conversationId":"same-id","updatedAt":1000]])
  assert(middle.status(cutoff:cutoff) == .completeCutoff)
  assert(compositeCoverage([a,middle,starredProbe,starredProbeOther],cutoff:cutoff).status == .completeNonArchived)
  let mainIncluded=PartitionDescriptor(archived:false,starred:false,includeOrigin:"origin#1")
  let mainExcluded=PartitionDescriptor(archived:false,starred:false,excludeOrigin:"origin#1")
  let mainA=observation(mainIncluded,[1100,900],id:"starred-actual-id")
  let mainB=observation(mainExcluded,[],id:"empty")
  assert(compositeCoverage([mainA,mainB],cutoff:cutoff).status == .incompletePartitions)
  assert(compositeCoverage([mainA,mainB],cutoff:cutoff).detail.contains("starred"))
  // Explicit is_starred=false excludes starred chats and needs a separate source.
  let actualStarred=observation(PartitionDescriptor(archived:false,starred:true,includeOrigin:"origin#1"),[1100,900],id:"starred-actual-id")
  let actualStarredOther=observation(PartitionDescriptor(archived:false,starred:true,excludeOrigin:"origin#1"),[],id:"starred-empty-other")
  assert(compositeCoverage([mainA,mainB,actualStarred,actualStarredOther],cutoff:cutoff).status == .completeNonArchived)
  assert(mainA.ids.union(actualStarred.ids).count==1) // overlapping IDs are counted once in the combined set
  let emptyStarred=observation(PartitionDescriptor(archived:false,starred:true,includeOrigin:"origin#1"),[],id:"empty-starred")
  let emptyStarredOther=observation(PartitionDescriptor(archived:false,starred:true,excludeOrigin:"origin#1"),[],id:"empty-starred-other")
  assert(emptyStarred.status(cutoff:cutoff) == .completeEnd)
  assert(compositeCoverage([mainA,mainB,emptyStarred,emptyStarredOther],cutoff:cutoff).status == .completeNonArchived)
  let incompleteStarred=observation(PartitionDescriptor(archived:false,starred:true,includeOrigin:"origin#1"),[1200,1100],id:"starred-incomplete")
  assert(compositeCoverage([mainA,mainB,incompleteStarred,actualStarredOther],cutoff:cutoff).status == .incompletePartitions)
  let differentStarred=observation(PartitionDescriptor(archived:false,starred:true,includeOrigin:"origin#1"),[1100,900],id:"different-starred")
  assert(compositeCoverage([mainA,mainB,differentStarred,actualStarredOther],cutoff:cutoff).status == .completeNonArchived)
  let otherOriginStarredA=observation(PartitionDescriptor(archived:false,starred:true,includeOrigin:"origin#2"),[1100,900],id:"other-origin")
  let otherOriginStarredB=observation(PartitionDescriptor(archived:false,starred:true,excludeOrigin:"origin#2"),[],id:"other-origin-empty")
  assert(compositeCoverage([mainA,mainB,otherOriginStarredA,otherOriginStarredB],cutoff:cutoff).status == .incompletePartitions)
  let account=observation(PartitionDescriptor(),[1100,900],id:"account")
  assert(compositeCoverage([account],cutoff:cutoff).status == .incompletePartitions)
  // Missing is_starred is not inclusion proof. Explicit manual evidence of a
  // known starred member in an unfiltered non-archived base can establish it.
  let omittedStarIncluded=observation(PartitionDescriptor(archived:false,includeOrigin:"origin#1"),[1100,900],id:"known-starred")
  let omittedStarExcluded=observation(PartitionDescriptor(archived:false,excludeOrigin:"origin#1"),[],id:"empty")
  assert(compositeCoverage([omittedStarIncluded,omittedStarExcluded],cutoff:cutoff).status == .incompletePartitions)
  let empiricalNonArchived=compositeCoverage([omittedStarIncluded,omittedStarExcluded],cutoff:cutoff,empiricallyConfirmedStarredMembership:true)
  assert(empiricalNonArchived.status == .completeNonArchived)
  assert(empiricalNonArchived.scope=="non-archived conversations")
  assert(coverageDisplayLabel(empiricalNonArchived)=="Complete — non-archived, unlocked chats")
  // Archived absence blocks account-wide completeness, but not the proven
  // non-archived scope above.
  assert(empiricalNonArchived.status != .completeAccount)
  let archivedOnlyMissing=compositeCoverage([omittedStarIncluded,omittedStarExcluded],cutoff:cutoff)
  assert(archivedOnlyMissing.status != .completeAccount)
  let samePage=logicalDiscoveryPageSignature(endpointClass:"root-conversations",partition:"archived=false",offset:0,cursorPresent:false,
    records:[["conversationId":"private-chat-id","title":"Private title","updatedAt":1200.0]])!
  let samePageAgain=logicalDiscoveryPageSignature(endpointClass:"root-conversations",partition:"archived=false",offset:0,cursorPresent:false,
    records:[["conversationId":"private-chat-id","title":"Private title","updatedAt":1200.0]])!
  assert(samePage==samePageAgain && !samePage.contains("private-chat-id") && !samePage.contains("Private title"))
  assert(samePage != logicalDiscoveryPageSignature(endpointClass:"root-conversations",partition:"archived=false",offset:20,cursorPresent:false,
    records:[["conversationId":"private-chat-id","title":"Private title","updatedAt":1200.0]])!)
  assert(samePage != logicalDiscoveryPageSignature(endpointClass:"project-conversations",partition:"",offset:0,cursorPresent:false,
    records:[["conversationId":"private-chat-id","title":"Private title","updatedAt":1200.0]])!)
  assert(samePage != logicalDiscoveryPageSignature(endpointClass:"root-conversations",partition:"archived=false",offset:0,cursorPresent:false,
    records:[["conversationId":"private-chat-id","title":"Renamed","updatedAt":1200.0]])!)
  let rejected429=coverageAfterListStatus(CompositeCoverage(status:.completeAccount,detail:"synthetic",scope:"account",proofs:[]),statusCodes:[200,429])
  assert(rejected429.status == .incompleteStall && rejected429.detail=="root_http_429")
  let archivedMain=observation(PartitionDescriptor(archived:true,starred:false),[1100,900],id:"archive-star")
  let archivedStarred=observation(PartitionDescriptor(archived:true,starred:true),[1100,900],id:"archive-star")
  var empiricalAccount=PartitionObservation(descriptor:PartitionDescriptor())
  _=empiricalAccount.append(page(0,[1200,1100,900]),records:[["conversationId":"same-id","updatedAt":1200.0],["conversationId":"archive-star","updatedAt":1100.0],["conversationId":"old","updatedAt":900.0]])
  assert(compositeCoverage([a,b,starredProbe,starredProbeOther,archivedMain,archivedStarred,empiricalAccount],cutoff:cutoff).status == .completeAccount)
  assert(!compositeCoverage([],cutoff:cutoff).isComplete) // project pages never enter root proof
  let pinnedProof=PinnedCoverageProof(top:true,statuses:["pinned","pinned","not pinned"],pinnedCount:2,timestampsResolved:2)
  assert(pinnedProof.complete)
  let notAttemptedState=StarredCoverageProofState(explicitStarredObserved:false,explicitPartitionComplete:false)
  let notAttemptedCoverage=compositeCoverage([a,b],cutoff:cutoff,starredProofState:notAttemptedState)
  assert(notAttemptedState.fallbackStatus == .notAttempted && notAttemptedCoverage.detail.contains("pinned_prefix_not_attempted"))
  assert(notAttemptedState.diagnosticsLine.contains("fallback not_attempted"))
  let union=compositeCoverage([a,b],cutoff:cutoff,starredProofState:fallbackProofState(pinnedProof))
  assert(union.status == .completeNonArchived && union.status != .completeAccount)
  assert(union.starredCoverageSource=="pinned_prefix" && union.detail.contains("complete via pinned_prefix"))
  assert(coverageDisplayLabel(union)=="Complete — non-archived, unlocked chats")
  // A complete base and a structurally complete pinned prefix are not enough:
  // every pinned chat whose recency is required must have fresh activity proof.
  let unresolvedPinned=PinnedCoverageProof(top:true,statuses:["pinned","not pinned"],pinnedCount:1,timestampsResolved:0,unresolvedReason:"activity_timeout")
  let unresolvedPinnedCoverage=compositeCoverage([a,b],cutoff:cutoff,starredProofState:fallbackProofState(unresolvedPinned))
  assert(unresolvedPinned.prefixComplete && !unresolvedPinned.complete && !unresolvedPinnedCoverage.isComplete)
  assert(unresolvedPinnedCoverage.status != .completeNonArchived && unresolvedPinnedCoverage.status != .completeAccount)
  assert(unresolvedPinnedCoverage.starredCoverageSource=="unresolved" && unresolvedPinnedCoverage.detail.contains("activity_timeout"))
  let resolvedPinned=PinnedCoverageProof(top:true,statuses:["pinned","not pinned"],pinnedCount:1,timestampsResolved:1,recentCount:0)
  let resolvedPinnedCoverage=compositeCoverage([a,b],cutoff:cutoff,starredProofState:fallbackProofState(resolvedPinned))
  assert(resolvedPinned.prefixComplete && resolvedPinned.complete && resolvedPinnedCoverage.status == .completeNonArchived)
  assert(resolvedPinnedCoverage.starredCoverageSource=="pinned_prefix" && resolvedPinned.recentCount==0) // old pinned chat adds no recent candidate
  let recentPinned=PinnedCoverageProof(top:true,statuses:["pinned","not pinned"],pinnedCount:1,timestampsResolved:1,recentCount:1)
  let recentPinnedCoverage=compositeCoverage([a,b],cutoff:cutoff,starredProofState:fallbackProofState(recentPinned))
  assert(recentPinned.complete && recentPinnedCoverage.starredCoverageSource=="pinned_prefix" && recentPinned.recentCount==1)
  var fallbackState=StarredCoverageProofState(explicitStarredObserved:false,explicitPartitionComplete:false)
  assert(fallbackState.fallbackStatus == .notAttempted && fallbackState.isConsistent && fallbackState.source=="unresolved")
  fallbackState.beginFallback()
  assert(fallbackState.fallbackStatus == .attempted && fallbackState.isConsistent)
  fallbackState.finishFallback(unresolvedPinned)
  assert(fallbackState.fallbackStatus == .failed && fallbackState.isConsistent && fallbackState.failureReason=="activity_timeout")
  let explicitState=StarredCoverageProofState(explicitStarredObserved:true,explicitPartitionComplete:true)
  assert(explicitState.fallbackStatus == .notAttempted && explicitState.isConsistent && explicitState.source=="explicit_partition")
  var completedFallback=StarredCoverageProofState(explicitStarredObserved:false,explicitPartitionComplete:false)
  completedFallback.beginFallback();completedFallback.finishFallback(resolvedPinned)
  assert(completedFallback.fallbackStatus == .completed && completedFallback.isConsistent && completedFallback.source=="pinned_prefix")
  assert(completedFallback.proof?.completionReason=="first_not_pinned" && completedFallback.proof?.unresolvedReason=="none" && completedFallback.failureReason==nil)
  assert(completedFallback.diagnosticsLine.contains("completion reason first_not_pinned") && completedFallback.diagnosticsLine.contains("failure none"))
  var noPinnedRows=StarredCoverageProofState(explicitStarredObserved:false,explicitPartitionComplete:false)
  noPinnedRows.beginFallback();noPinnedRows.finishFallback(PinnedCoverageProof(top:true,statuses:["not pinned"],pinnedCount:0,timestampsResolved:0))
  assert(noPinnedRows.fallbackStatus == .completed && noPinnedRows.proof?.completionReason=="first_not_pinned" && noPinnedRows.failureReason==nil && noPinnedRows.isConsistent)
  let failureAfterCompletion=StarredCoverageProofState(explicitStarredObserved:false,explicitPartitionComplete:false,fallbackStatus:.completed,proof:resolvedPinned,failureReason:"stale_failure")
  assert(!failureAfterCompletion.isConsistent)
  let impossibleFallback=StarredCoverageProofState(explicitStarredObserved:false,explicitPartitionComplete:false,fallbackStatus:.attempted,proof:resolvedPinned,failureReason:nil)
  assert(!impossibleFallback.isConsistent)
  let impossibleExplicit=StarredCoverageProofState(explicitStarredObserved:false,explicitPartitionComplete:true)
  assert(!impossibleExplicit.isConsistent)
  let unstablePinned=PinnedCoverageProof(top:false,statuses:[],pinnedCount:0,timestampsResolved:0,unresolvedReason:"sidebar_snapshot_unstable",readinessStatus:"unstable",readinessReason:"sidebar_snapshot_unstable")
  let unstableState=fallbackProofState(unstablePinned)
  let unstableCoverage=compositeCoverage([a,b],cutoff:cutoff,starredProofState:unstableState)
  assert(unstableState.fallbackStatus == .failed && unstableState.isConsistent)
  assert(unstableCoverage.detail.contains("sidebar_snapshot_unstable"))
  assert(unstableState.diagnosticsLine.contains("fallback failed") && unstableState.diagnosticsLine.contains("failure sidebar_snapshot_unstable"))
  assert(unstableCoverage.detail.hasSuffix("sidebar_snapshot_unstable"))
  let prefixFailure=PinnedCoverageProof(top:true,statuses:["pinned","unknown"],pinnedCount:1,timestampsResolved:0,unresolvedReason:"unknown_row_in_stable_snapshot")
  let prefixFailureState=fallbackProofState(prefixFailure)
  assert(prefixFailureState.fallbackStatus == .failed && prefixFailureState.diagnosticsLine.contains("unknown_row_in_stable_snapshot"))
  let completedState=fallbackProofState(resolvedPinned)
  assert(completedState.fallbackStatus == .completed && completedState.diagnosticsLine.contains("source pinned_prefix"))
  var priorCycle=CycleState();priorCycle.lastStarredCoverageProofState=unstableState
  var nextCycle=CycleState();nextCycle.lastStarredCoverageProofState=nil
  assert(nextCycle.lastStarredCoverageProofState == nil) // a new cycle does not inherit the previous proof
  nextCycle.lastStarredCoverageProofState=unstableState
  let persistedState=try JSONDecoder().decode(CycleState.self,from:JSONEncoder().encode(nextCycle))
  let refreshedCoverage=compositeCoverage([a,b],cutoff:cutoff,starredProofState:persistedState.lastStarredCoverageProofState)
  let summaryLine="Coverage: \(coverageDisplayLabel(refreshedCoverage)) · \(refreshedCoverage.detail)"
  assert(summaryLine.contains("sidebar_snapshot_unstable"))
  assert(persistedState.lastStarredCoverageProofState?.diagnosticsLine.contains("failure sidebar_snapshot_unstable")==true)
  let impossibleUnstable=StarredCoverageProofState(explicitStarredObserved:false,explicitPartitionComplete:false,fallbackStatus:.attempted,proof:nil,failureReason:"sidebar_snapshot_unstable")
  assert(!impossibleUnstable.isConsistent) // failure after entering fallback cannot be reported as not attempted/attempted
  let runtimeWins=fallbackProofState(unstablePinned)
  let refreshedAgain=compositeCoverage([a,b],cutoff:cutoff,starredProofState:runtimeWins)
  assert(refreshedAgain.detail==refreshedCoverage.detail) // live refresh and detailed telemetry share canonical proof state
  // Any observed explicit starred stream takes precedence: an incomplete stream cannot be hidden by a valid UI proof.
  let pinnedCannotMaskStream=compositeCoverage([a,b,incompleteStarred],cutoff:cutoff,starredProofState:fallbackProofState(recentPinned,explicitStarredObserved:true))
  assert(!pinnedCannotMaskStream.isComplete && pinnedCannotMaskStream.starredCoverageSource=="unresolved")
  assert(pinnedCannotMaskStream.detail.contains("explicit_starred_partition_incomplete"))
  assert(!PinnedCoverageProof(top:false,statuses:[],pinnedCount:0,timestampsResolved:0).prefixComplete) // zero is not proof of an empty pinned universe
  for statuses in [["pinned","unknown"],["pinned","pinned"]] {
   assert(!PinnedCoverageProof(top:true,statuses:statuses,pinnedCount:2,timestampsResolved:2).complete)
  }
  assert(!PinnedCoverageProof(top:false,statuses:["pinned","not pinned"],pinnedCount:1,timestampsResolved:1).complete)
  assert(!PinnedCoverageProof(top:true,statuses:["pinned","not pinned"],pinnedCount:1,timestampsResolved:0).complete)
  assert(coverageAfterListStatus(union,statusCodes:[429]).status == .incompleteStall)
  let attemptedOnly=[PartitionObservation(descriptor:included),PartitionObservation(descriptor:excluded)]
  assert(attemptedOnly.allSatisfy{$0.status(cutoff:cutoff) == .incompleteStall})
  assert(compositeCoverage(attemptedOnly,cutoff:cutoff).status == .incompleteStall)
  var gap=observation(included,[1200,1100],id:"first")
  _=gap.append(page(4,[900,800]),records:[["conversationId":"second","updatedAt":900]])
  assert(gap.status(cutoff:cutoff) == .incompleteOrdering)
  var backwards=PartitionObservation(descriptor:included)
  _=backwards.append(page(2,[900,800]),records:[]);_=backwards.append(page(0,[1200,1100]),records:[])
  assert(backwards.status(cutoff:cutoff) == .incompleteOrdering)
  var duplicate=a;_=duplicate.append(page(0,[1100,900]),records:[["conversationId":"same-id","updatedAt":1100]])
  assert(duplicate.ids.count==1 && duplicate.pages.count==1)
  _=duplicate.append(page(0,[1200,900]),records:[["conversationId":"same-id","updatedAt":1200]])
  assert(duplicate.status(cutoff:cutoff) == .incompleteOrdering)
  var changedIDs=a;_=changedIDs.append(page(0,[1100,900]),records:[["conversationId":"different-id","updatedAt":1100]])
  assert(changedIDs.status(cutoff:cutoff) == .incompleteOrdering)
  var httpFailure=PartitionObservation(descriptor:included)
  var failedEmpty=page(0,[]);failedEmpty.httpStatus=503
  _=httpFailure.append(failedEmpty,records:[])
  assert(httpFailure.status(cutoff:cutoff) == .incompleteOrdering)
  var missingRecords=PartitionObservation(descriptor:included)
  var missing=page(0,[1100,900]);missing.recordCountMatches=false
  _=missingRecords.append(missing,records:[])
  assert(missingRecords.status(cutoff:cutoff) == .incompleteOrdering)
  var records=CycleState()
  for _ in 0..<3 {records.merge([["conversationId":"same-id","title":"A","updatedAt":1100.0]],source:.rootConversationUpdateTime,observedAt:1200)}
  assert(records.records.count==1) // duplicate root partitions + project source
  let stored=String(data:try JSONEncoder().encode(records),encoding:.utf8)!
  for secret in ["origin#",tokenA,tokenB,"includeOrigin","excludeOrigin"] {assert(!stored.contains(secret))}
  print("Partition model: complement, selectors, completeness, starred, ordering, dedup and ephemeral privacy passed")
 }
 static func bundleIdentityMigrationTests() throws {
  var prior=CycleState();prior.enabled=true;prior.lastStatus="Partial · preserved";prior.lastCycleNotificationsAccepted=2
  var near=ChatRecord(conversationId:"near-chat",title:"Near",lastSeenUpdatedAt:10)
  near.lastNotifiedRiskRank=2;near.lastRiskRank=2;near.uncertainAcknowledgedAt=9
  near.aggregate=SafeAggregate(conversationId:"near-chat",title:"Near",processedMessageIds:["known"],messagesCollected:4,userMessages:2,assistantMessages:2,otherMessages:0,estimatedTextTokens:420000,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:false,hasPreviousPage:true,responsesCaptured:4)
  var critical=ChatRecord(conversationId:"critical-chat",title:"Critical",lastSeenUpdatedAt:11);critical.lastNotifiedRiskRank=3
  prior.records[near.conversationId]=near;prior.records[critical.conversationId]=critical
  let priorData=try JSONEncoder().encode(prior)
  let legacy:[String:Any]=[nativeCycleStateDefaultsKey:priorData,showChatTitlesInNotificationsDefaultsKey:false]
  let migrated=bundleIdentityMigrationPlan(legacy:legacy,current:[:])
  assert(migrated.status == .migrated && migrated.shouldSetCompletionMarker && migrated.failureReason == nil)
  assert((migrated.valuesToWrite[nativeCycleStateDefaultsKey] as? Data)==priorData)
  assert(migrated.valuesToWrite[showChatTitlesInNotificationsDefaultsKey] as? Bool == false)
  let migratedData=migrated.valuesToWrite[nativeCycleStateDefaultsKey] as! Data
  let decoded=try JSONDecoder().decode(CycleState.self,from:migratedData)
  assert(decoded.enabled && decoded.lastStatus==prior.lastStatus && decoded.lastCycleNotificationsAccepted==2)
  assert(decoded.records["near-chat"]?.aggregate?.estimatedTextTokens==420000)
  assert(decoded.records["near-chat"]?.uncertainAcknowledgedAt==9)
  assert(decoded.records["near-chat"]?.lastNotifiedRiskRank==2 && decoded.records["critical-chat"]?.lastNotifiedRiskRank==3)
  assert(incompleteRiskNotificationNeeded(measurement:.partial,lastAcceptedRank:decoded.records["near-chat"]?.lastNotifiedRiskRank,lowerBoundTokens:420000,model:.beta)==nil)
  assert(incompleteRiskNotificationNeeded(measurement:.partial,lastAcceptedRank:decoded.records["critical-chat"]?.lastNotifiedRiskRank,lowerBoundTokens:480000,model:.beta)==nil)

  var nextDomain=migrated.valuesToWrite;nextDomain[bundleIdentityMigrationMarkerKey]=true
  let secondLaunch=bundleIdentityMigrationPlan(legacy:legacy,current:nextDomain)
  assert(secondLaunch.status == .notNeeded && secondLaunch.valuesToWrite.isEmpty && !secondLaunch.shouldSetCompletionMarker)

  let existingState=try JSONEncoder().encode(CycleState())
  let existing=bundleIdentityMigrationPlan(legacy:legacy,current:[nativeCycleStateDefaultsKey:existingState])
  assert(existing.status == .notNeeded && existing.shouldSetCompletionMarker)
  assert(existing.valuesToWrite[nativeCycleStateDefaultsKey] as? Data == nil)
  assert(existing.valuesToWrite[showChatTitlesInNotificationsDefaultsKey] as? Bool == false)

  let clean=bundleIdentityMigrationPlan(legacy:[showChatTitlesInNotificationsDefaultsKey:true],current:[:])
  assert(clean.status == .cleanInstall && clean.shouldSetCompletionMarker)
  assert(clean.valuesToWrite[showChatTitlesInNotificationsDefaultsKey] as? Bool == true)

  let corrupt=Data("not-json".utf8)
  let corruptLegacy:[String:Any]=[nativeCycleStateDefaultsKey:corrupt,showChatTitlesInNotificationsDefaultsKey:false]
  let failed=bundleIdentityMigrationPlan(legacy:corruptLegacy,current:[:])
  assert(failed.status == .failed && !failed.shouldSetCompletionMarker && failed.failureReason=="legacy_state_invalid")
  assert(failed.valuesToWrite.isEmpty && corrupt==corruptLegacy[nativeCycleStateDefaultsKey] as? Data)
 }
 static func renderReadinessPersistenceTests() throws {
  let reasons=["wrong_route_or_context","document_not_ready","sidebar_root_missing","rows_never_appeared","rows_appeared_but_never_stabilized","timeout","navigation_failed","bridge_result_missing"]
  var state=CycleState()
  for reason in reasons {
   state.recordRenderReadiness(phase:"preflight",result:.failure,reason:reason,routeCategory:.home,timestamp:Date(timeIntervalSince1970:1_800_000_000))
   assert(state.lastRenderReadiness?.reason==reason,"readiness reason must persist exactly: \(reason)")
  }
  state.recordRenderReadiness(phase:"rows",result:.failure,reason:"rows_never_appeared",routeCategory:.chat,timestamp:Date(timeIntervalSince1970:1_800_000_001))
  state.recordRenderReadiness(phase:"rows",result:.success,reason:"snapshot_ready",routeCategory:.chat,timestamp:Date(timeIntervalSince1970:1_800_000_002))
  assert(state.lastRenderReadiness?.result == .success && state.lastRenderReadiness?.reason=="snapshot_ready")
  let saved=try JSONEncoder().encode(state)
  let restored=try JSONDecoder().decode(CycleState.self,from:saved)
  assert(restored.lastRenderReadiness==state.lastRenderReadiness,"readiness diagnostic must survive persisted-state reload")
  let legacy=try JSONDecoder().decode(CycleState.self,from:JSONEncoder().encode(CycleState()))
  assert(legacy.lastRenderReadiness==nil,"older cycle state without the field remains readable")

  var safety=CycleState()
  var record=ChatRecord(conversationId:"opaque-test-record",title:"test",lastSeenUpdatedAt:1)
  record.lastRiskRank=2;record.lastNotifiedRiskRank=1;record.paginationBoundaryMessageCount=42
  record.aggregate=SafeAggregate(conversationId:"opaque-test-record",title:"test",processedMessageIds:["private-message-id"],messagesCollected:42,userMessages:20,assistantMessages:22,otherMessages:0,estimatedTextTokens:12345,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:false,hasPreviousPage:true,hasNextPage:false,responsesCaptured:3,updatedAt:1)
  safety.records[record.conversationId]=record
  safety.recordRenderReadiness(phase:"readiness",result:.failure,reason:"sidebar_root_missing",routeCategory:.home)
  assert(safety.records[record.conversationId]?.paginationBoundaryMessageCount==42)
  assert(safety.records[record.conversationId]?.aggregate?.estimatedTextTokens==12345)
  assert(safety.records[record.conversationId]?.lastRiskRank==2 && safety.records[record.conversationId]?.lastNotifiedRiskRank==1)

  assert(renderReadinessRouteCategory(URL(string:"https://chatgpt.com/")!) == .home)
  assert(renderReadinessRouteCategory(URL(string:"https://auth.openai.com/log-in")!) == .loginAuth)
  assert(renderReadinessRouteCategory(URL(string:"https://example.invalid/private")!) == .other)
  let privateURL=URL(string:"https://chatgpt.com/c/private-chat-id?token=private-token")!
  var privacy=CycleState()
  privacy.recordRenderReadiness(phase:"rows",result:.failure,reason:"sidebar_root_missing?chat_id=private-chat-id",routeCategory:renderReadinessRouteCategory(privateURL),timestamp:Date(timeIntervalSince1970:1_800_000_003))
  let encoded=String(decoding:try JSONEncoder().encode(privacy),as:UTF8.self)
  assert(!encoded.contains("private-chat-id") && !encoded.contains("private-token"))
  assert(privacy.lastRenderReadiness?.routeCategory == .chat)
  assert(privacy.lastRenderReadiness?.reason == "unclassified")
  assert(renderReadinessDiagnosticSummary(privacy.lastRenderReadiness!).contains("route chat"))
 }
 static func forensicHistoryTests() throws {
  let id="private-chat-id",cycle=1_800_000_000_000.0
  var state=CycleState();state.records[id]=ChatRecord(conversationId:id,title:"Private title",lastSeenUpdatedAt:cycle)
  state.updateForensicEvent(chatID:id,cycleTimestamp:cycle,now:cycle) {$0.admissionSource = .recent;$0.queued=true}
  assert(state.records[id]?.forensicHistory.count==1)
  assert(state.records[id]?.forensicHistory[0].queued==true)
  var updated=state.records[id]!
  updated.title="Updated title"
  mergingForensicHistory(from:state.records[id],into:&updated)
  state.records[id]=updated
  let reloaded=try JSONDecoder().decode(CycleState.self,from:JSONEncoder().encode(state))
  let event=reloaded.records[id]!.forensicHistory[0]
  assert(event.admissionSource == .recent && event.queued)
  var legacy=try JSONSerialization.jsonObject(with:JSONEncoder().encode(state)) as! [String:Any]
  var records=legacy["records"] as! [String:Any],record=records[id] as! [String:Any]
  record.removeValue(forKey:"forensicHistory");records[id]=record;legacy["records"]=records
  let old=try JSONSerialization.data(withJSONObject:legacy)
  let decodedOld=try JSONDecoder().decode(CycleState.self,from:old)
  assert(decodedOld.records[id]?.forensicHistory.isEmpty==true)
  var merged=decodedOld
  merged.records[id]?.forensicHistory=[event]
  merged.merge([["conversationId":id,"title":"Updated title","updatedAt":cycle+10]],source:.rootConversationUpdateTime,observedAt:cycle+10)
  assert(merged.records[id]?.forensicHistory==[event])
 }
 static func main() async throws {
  try forensicHistoryTests()
  try renderReadinessPersistenceTests()
  try perChatHistoryDiagnosticsTests()
  try pinnedUnknownRowDiagnosticTests()
  diagnosticGenerationGateTests()
  rescueGenerationGateTests()
  nativeRescueStatusTests()
  try bundleIdentityMigrationTests()
  assert(rootDiscoveryTerminalReason(RootDiscoveryEvidence())=="root_trigger_not_started")
  var rootEvidence=RootDiscoveryEvidence();rootEvidence.triggerStarted=true;rootEvidence.loadReturnedNavigation=true
  assert(rootDiscoveryTerminalReason(rootEvidence)=="root_navigation_not_observed")
  rootEvidence.navigationObserved=true;rootEvidence.hookHealthAvailable=true;rootEvidence.hookObjectPresent=true
  rootEvidence.fetchHookActive=true;rootEvidence.xhrOpenHookActive=true;rootEvidence.xhrSendHookActive=true;rootEvidence.generationAttached=true
  assert(rootDiscoveryTerminalReason(rootEvidence)=="root_trigger_no_network_activity")
  rootEvidence.hookRequests=1
  assert(rootDiscoveryTerminalReason(rootEvidence)=="root_request_without_response")
  rootEvidence.hookResponses=1
  assert(rootDiscoveryTerminalReason(rootEvidence)=="root_response_unclassified")
  rootEvidence.recognizedResponses=1
  assert(rootDiscoveryTerminalReason(rootEvidence)=="root_discovery_observed")
  rootEvidence=RootDiscoveryEvidence();rootEvidence.triggerStarted=true;rootEvidence.loadReturnedNavigation=true;rootEvidence.navigationObserved=true
  rootEvidence.hookHealthAvailable=true;rootEvidence.hookObjectPresent=true;rootEvidence.fetchHookActive=true;rootEvidence.xhrOpenHookActive=true;rootEvidence.xhrSendHookActive=true
  rootEvidence.generationAttached=true;rootEvidence.resourceRequests=1
  assert(rootDiscoveryTerminalReason(rootEvidence)=="root_list_hook_missed_request")
  rootEvidence.resourceResponses=1
  assert(rootDiscoveryTerminalReason(rootEvidence)=="root_response_unobserved_by_hook")
  rootEvidence=RootDiscoveryEvidence();rootEvidence.triggerStarted=true;rootEvidence.loadReturnedNavigation=true;rootEvidence.navigationObserved=true
  rootEvidence.hookHealthAvailable=true;rootEvidence.hookObjectPresent=true;rootEvidence.fetchHookActive=true;rootEvidence.xhrOpenHookActive=true;rootEvidence.xhrSendHookActive=true;rootEvidence.generationAttached=true;rootEvidence.postTriggerConversationLinks=4
  assert(rootDiscoveryTerminalReason(rootEvidence)=="root_ui_data_without_network_response")
  rootEvidence.xhrSendHookActive=false
  assert(rootDiscoveryTerminalReason(rootEvidence)=="root_list_hook_detached")
  activityObservationWindowTests()
  riskModelTests()
  try chatCheckTraceTests()
  let activityEvent:[String:Any]=["conversationId":"internal-id","timestamp":1700000000000.0,"timestampSource":"conversation_update_time","endpointFamily":"conversation_messages","httpStatus":200,"operationOwner":"isolated_timestamp_fallback","operationGeneration":"operation-1"]
  assert(pinnedActivityEventMatches(activityEvent,expectedConversationID:"internal-id",expectedOwner:"isolated_timestamp_fallback",expectedGeneration:"operation-1"))
  assert(!pinnedActivityEventMatches(activityEvent,expectedConversationID:"other-id",expectedOwner:"isolated_timestamp_fallback",expectedGeneration:"operation-1"))
  assert(!pinnedActivityEventMatches(activityEvent,expectedConversationID:"internal-id",expectedOwner:"isolated_timestamp_fallback",expectedGeneration:"operation-2"))
  var unrelatedActivityEvent=activityEvent;unrelatedActivityEvent["operationOwner"]="unrelated_passive_traffic"
  assert(!pinnedActivityEventMatches(unrelatedActivityEvent,expectedConversationID:"internal-id",expectedOwner:"isolated_timestamp_fallback",expectedGeneration:"operation-1"))
  var rateLimitedActivityEvent=activityEvent;rateLimitedActivityEvent["httpStatus"]=429;rateLimitedActivityEvent["timestamp"]=NSNull();rateLimitedActivityEvent["timestampSource"]=NSNull()
  assert(pinnedActivityEventMatches(rateLimitedActivityEvent,expectedConversationID:"internal-id",expectedOwner:"isolated_timestamp_fallback",expectedGeneration:"operation-1"))
  assert(pinnedNavigationNoEffect(urlChanged:false,isLoading:false,progressChanged:false,elapsed:2.1))
  assert(!pinnedNavigationNoEffect(urlChanged:true,isLoading:false,progressChanged:false,elapsed:3))
  assert(!pinnedNavigationNoEffect(urlChanged:false,isLoading:true,progressChanged:false,elapsed:3))
  assert(pinnedNavigationTargetAlreadyLoaded(currentConversationID:"expected",expectedConversationID:"expected"))
  assert(!pinnedNavigationTargetAlreadyLoaded(currentConversationID:"other",expectedConversationID:"expected"))
  assert(!pinnedNavigationTargetAlreadyLoaded(currentConversationID:nil,expectedConversationID:"expected"))
  assert(pinnedNavigationStalled(isLoading:true,progressChanged:true,targetReached:false,elapsed:10,deadline:10))
  assert(!pinnedNavigationStalled(isLoading:false,progressChanged:false,targetReached:false,elapsed:10,deadline:10))
  assert(pinnedNavigationObservationClassification(urlMatchesTarget:true,urlChanged:true,isLoading:true,progressChanged:true,elapsed:0)=="navigation_route_reached")
  assert(pinnedNavigationObservationClassification(urlMatchesTarget:false,urlChanged:false,isLoading:false,progressChanged:false,elapsed:2)=="navigation_load_no_effect")
  assert(pinnedNavigationObservationClassification(urlMatchesTarget:false,urlChanged:true,isLoading:false,progressChanged:false,elapsed:4.9,finalAfter:4.5)=="navigation_started_but_stalled")
  assert(pinnedNavigationObservationClassification(urlMatchesTarget:false,urlChanged:false,isLoading:true,progressChanged:false,elapsed:2)==nil)
  try partitionTests()
  timerTest()
  let renderHidden=RenderSurfaceControlState(webViewHidden:true,windowVisible:false,ignoresMouseEvents:false,appActive:false,keyWindow:false,mainWindow:false)
  let renderActive=RenderSurfaceControlState(webViewHidden:false,windowVisible:true,ignoresMouseEvents:true,appActive:false,keyWindow:false,mainWindow:false)
  let renderRestored=RenderSurfaceControlState(webViewHidden:true,windowVisible:false,ignoresMouseEvents:false,appActive:false,keyWindow:false,mainWindow:false)
  assert(renderSurfaceActivationPreservesFocus(original:renderHidden,current:renderActive))
  assert(renderSurfaceRestored(original:renderHidden,current:renderRestored)) // same restoration path is used for success and timeout/error
  assert(!renderSurfaceRestored(original:renderHidden,current:renderActive)) // render-active window state must never be mistaken for restored input
  assert(!renderLeaseMayRestoreKeyMain(original:renderHidden,current:renderRestored)) // hidden session never becomes key during cleanup
  assert(renderLeaseApplicationActivationPreserved(original:renderHidden,current:renderRestored))
  let activeVisible=RenderSurfaceControlState(webViewHidden:false,windowVisible:true,ignoresMouseEvents:false,appActive:true,keyWindow:true,mainWindow:true)
  assert(renderLeaseMayRestoreKeyMain(original:activeVisible,current:RenderSurfaceControlState(webViewHidden:false,windowVisible:true,ignoresMouseEvents:true,appActive:true,keyWindow:false,mainWindow:false)))
  assert(!renderLeaseMayRestoreKeyMain(original:activeVisible,current:RenderSurfaceControlState(webViewHidden:false,windowVisible:true,ignoresMouseEvents:true,appActive:false,keyWindow:false,mainWindow:false))) // do not steal focus after the user changes apps
  assert(hiddenRenderOutcome(hiddenList:0,hiddenLinks:0,activeList:2,activeLinks:5) == .suspensionConfirmed)
  assert(hiddenRenderOutcome(hiddenList:0,hiddenLinks:0,activeList:0,activeLinks:0) == .activationNoEffect)
  assert(hiddenRenderOutcome(hiddenList:1,hiddenLinks:2,activeList:0,activeLinks:0) == .hiddenAvailable)
  var leaseGate=BackgroundRenderLeaseGate()
  assert(leaseGate.acquire("scheduler"))
  assert(!leaseGate.acquire("diagnostic"))
  assert(!leaseGate.release("diagnostic"))
  assert(leaseGate.release("scheduler"))
  assert(leaseGate.acquire("diagnostic")) // ownership is available again after timeout/cancel cleanup
  assert(leaseGate.release("diagnostic"))
  assert(pinnedNavigationPreflightDecision(operationCurrent:false,routeAvailable:true,webViewAvailable:true,renderLeaseVerified:true) == .staleOperation)
  assert(pinnedNavigationPreflightDecision(operationCurrent:true,routeAvailable:false,webViewAvailable:true,renderLeaseVerified:true) == .frontendRouteMissing)
  assert(pinnedNavigationPreflightDecision(operationCurrent:true,routeAvailable:true,webViewAvailable:false,renderLeaseVerified:true) == .webViewUnavailable)
  assert(pinnedNavigationPreflightDecision(operationCurrent:true,routeAvailable:true,webViewAvailable:true,renderLeaseVerified:false) == .renderLeaseUnavailable)
  assert(pinnedNavigationPreflightDecision(operationCurrent:true,routeAvailable:true,webViewAvailable:true,renderLeaseVerified:true) == .ready)
  assert(pinnedNavigationDeadlineReason(commandSent:false)=="pre_navigation_timeout")
  assert(pinnedNavigationDeadlineReason(commandSent:true)=="navigation_timeout")
  assert(pinnedTimestampFailureReason(childReason:"none",fallbackReason:"timestamp_timeout")=="timestamp_timeout")
  assert(pinnedTimestampFailureReason(childReason:"activity_response_timeout",fallbackReason:"timestamp_timeout")=="activity_response_timeout")
  assert(pinnedActivityLiveWaitCanFinish(state:"waiting"))
  assert(!pinnedActivityLiveWaitCanFinish(state:"response_received")) // a late timeout cannot replace a response
  assert(!pinnedActivityLiveWaitCanFinish(state:"timeout")) // a late response cannot replace the timeout
  assert(!pinnedActivityLiveWaitCanFinish(state:"error"))
  let now=100_000_000.0
  var s=CycleState();s.merge([["conversationId":"a","title":"A","updatedAt":now],["conversationId":"b","title":"B","updatedAt":now-100]],source:.rootConversationUpdateTime,observedAt:now+10)
  s.merge([["conversationId":"a","title":"Old","updatedAt":now-500],["conversationId":"c","title":"C","updatedAt":now-21600001]],source:.projectConversationUpdateTime,observedAt:now+20)
  assert(s.records["a"]!.lastSeenUpdatedAtSource == .rootConversationUpdateTime && s.records["a"]!.lastSeenUpdatedAtObservedAt==now+10)
  assert(s.records["c"]!.lastSeenUpdatedAtSource == .projectConversationUpdateTime && s.records["c"]!.lastSeenUpdatedAtObservedAt==now+20)
  assert(s.records.count==3 && s.records["a"]!.title=="A")
  let recent=s.recent(now,ids:["a","b","c"]);assert(recent.count==2)
  assert(s.queue(recent).count==2)
  s.records["a"]!.lastCheckedUpdatedAt=now
  s.records["a"]!.lastCheckResult="Complete"
  s.records["a"]!.aggregate=SafeAggregate(conversationId:"a",title:"A",processedMessageIds:[],messagesCollected:1,userMessages:1,assistantMessages:0,otherMessages:0,estimatedTextTokens:1,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:true,hasPreviousPage:false,hasNextPage:false,responsesCaptured:1,updatedAt:nil)
  assert(s.queue(s.recent(now,ids:["a","b"])).map{$0.conversationId}==["b"])
  s.merge([["conversationId":"a","title":"Renamed","updatedAt":now+100]],source:.rootConversationUpdateTime,observedAt:now+30)
  let queue=s.queue(s.recent(now+100,ids:["a","b"]));assert(queue.map{$0.conversationId}==["a","b"])
  var gate=CycleGate();assert(gate.begin());assert(!gate.begin());gate.end();assert(gate.begin())
  s.enabled=true;s.nextRun=Date(timeIntervalSince1970:20000);s.records["a"]!.lastCheckResult="Complete"
  let data=try JSONEncoder().encode(s);let restored=try JSONDecoder().decode(CycleState.self,from:data)
  assert(restored.enabled && restored.nextRun==s.nextRun && restored.records.count==3)
  let preCoverageState=try JSONDecoder().decode(CycleState.self,from:#"{"enabled":true,"records":{},"lastStatus":"older state"}"#.data(using:.utf8)!)
  assert(preCoverageState.enabled && preCoverageState.lastCoverageStatus==nil && preCoverageState.lastDiscoveredPages==nil && preCoverageState.lastCoverageDetail==nil && preCoverageState.lastSeenProvenanceSchemaVersion==nil)
  let preProvenanceCycleData=#"{"enabled":false,"records":{"legacy":{"conversationId":"legacy","title":"private-title","lastSeenUpdatedAt":4321.0}},"lastStatus":"old"}"#.data(using:.utf8)!
  var migratedCycle=try JSONDecoder().decode(CycleState.self,from:preProvenanceCycleData)
  assert(migratedCycle.records["legacy"]?.lastSeenUpdatedAt==4321 && migratedCycle.records["legacy"]?.lastSeenUpdatedAtSource == .legacyUnknown)
  migratedCycle.lastSeenProvenanceSchemaVersion=1
  let persistedMigration=try JSONDecoder().decode(CycleState.self,from:JSONEncoder().encode(migratedCycle))
  assert(persistedMigration.lastSeenProvenanceSchemaVersion==1 && persistedMigration.records["legacy"]?.lastSeenUpdatedAt==4321 && persistedMigration.records["legacy"]?.lastSeenUpdatedAtSource == .legacyUnknown)
  assert(preCoverageState.discoveryStatus==nil && preCoverageState.lastSuccessfulDiscoveryAt==nil)
  var explicitRateLimit=CycleState();explicitRateLimit.discoveryStatus = .rateLimited
  explicitRateLimit.lastSuccessfulDiscoveryAt=Date(timeIntervalSince1970:1234)
  let rateLimitCopy=try JSONDecoder().decode(CycleState.self,from:JSONEncoder().encode(explicitRateLimit))
  assert(rateLimitCopy.discoveryStatus == .rateLimited && rateLimitCopy.lastSuccessfulDiscoveryAt==explicitRateLimit.lastSuccessfulDiscoveryAt)
  assert(!discoveryRateLimited([200]) && discoveryRateLimited([200,429]))
  let legacyData=#"{"conversationId":"legacy","title":"legacy-title","lastSeenUpdatedAt":1234.0}"#.data(using:.utf8)!
  let legacy=try JSONDecoder().decode(ChatRecord.self,from:legacyData)
  assert(legacy.lastSeenUpdatedAt==1234 && legacy.lastSeenUpdatedAtSource == .legacyUnknown && legacy.lastSeenUpdatedAtObservedAt==nil)
  let migrated=try JSONDecoder().decode(ChatRecord.self,from:JSONEncoder().encode(legacy))
  assert(migrated.lastSeenUpdatedAt==1234 && migrated.lastSeenUpdatedAtSource == .legacyUnknown && migrated.lastSeenUpdatedAtObservedAt==nil)
  let unrecognizedSource=try JSONDecoder().decode(ChatRecord.self,from:#"{"conversationId":"future","title":"future","lastSeenUpdatedAt":5678.0,"lastSeenUpdatedAtSource":"future_source"}"#.data(using:.utf8)!)
  assert(unrecognizedSource.lastSeenUpdatedAt==5678 && unrecognizedSource.lastSeenUpdatedAtSource == .legacyUnknown)
  assert(LastSeenUpdatedAtSource.rootConversationUpdateTime.isTrustedForRecentCoverage)
  assert(LastSeenUpdatedAtSource.projectConversationUpdateTime.isTrustedForRecentCoverage)
  assert(LastSeenUpdatedAtSource.completeHistory.isTrustedForRecentCoverage)
  assert(!LastSeenUpdatedAtSource.legacyUnknown.isTrustedForRecentCoverage && !LastSeenUpdatedAtSource.conversationActivityMetadata.isTrustedForRecentCoverage)
  assert(LastSeenUpdatedAtSource.fromActivitySource("root_conversation_list.update_time") == .rootConversationUpdateTime)
  assert(LastSeenUpdatedAtSource.fromActivitySource("project_conversation_list.update_time") == .projectConversationUpdateTime)
  assert(LastSeenUpdatedAtSource.fromActivitySource("conversation_messages.latest_message.create_time") == .conversationActivityMetadata)
  let provenance=cachedActivityProvenanceSummary([legacy,s.records["a"]!,s.records["c"]!],now:now+21600000)
  assert(provenance.records==3 && provenance.timestamps==3 && provenance.trusted==2 && provenance.legacyOrUnknown==1 && provenance.freshObservations==2 && provenance.staleObservations==1)
  assert(classifyListDiagnostic(requests:0,responses:0,failures:0,statusCodes:[],recognized:false) == .requestNotObserved)
  assert(classifyListDiagnostic(requests:1,responses:0,failures:0,statusCodes:[],recognized:false) == .requestFailed)
  assert(classifyListDiagnostic(requests:0,resourceObserved:true,responses:0,failures:0,statusCodes:[],recognized:false) == .requestFailed)
  assert(classifyListDiagnostic(requests:1,responses:1,failures:0,statusCodes:[401],recognized:false) == .requestFailed)
  assert(classifyListDiagnostic(requests:1,responses:1,failures:0,statusCodes:[200],recognized:false) == .responseNotRecognized)
  assert(classifyListDiagnostic(requests:8,responses:6,failures:2,statusCodes:[503,200,200],recognized:true) == .recognized)
  assert(classifyListDiagnostic(requests:8,responses:6,failures:2,statusCodes:[503,200,200],recognized:false) == .responseNotRecognized)
  assert(classifyListDiagnostic(requests:1,responses:1,failures:0,statusCodes:[200],recognized:true) == .recognized)
  assert(!String(data:data,encoding:.utf8)!.contains("content"))
  let cutoff=now-21600000
  let justBefore=CoveragePage(offset:0,limit:2,itemCount:2,timestampsValid:true,times:[cutoff+1,cutoff-1])
  assert(pageCrossesRecentCutoff(justBefore,cutoff:cutoff))
  assert(!pageCrossesRecentCutoff(CoveragePage(offset:0,limit:1,itemCount:1,timestampsValid:true,times:[cutoff]),cutoff:cutoff))
  assert(!pageCrossesRecentCutoff(CoveragePage(offset:0,limit:2,itemCount:2,timestampsValid:false,times:[cutoff+1]),cutoff:cutoff))
  assert(pageOrderingIsValid([30,20,10],previousOldest:40))
  assert(!pageOrderingIsValid([20,30],previousOldest:nil))
  assert(!pageOrderingIsValid([30,20],previousOldest:10))
  assert(!pageOrderingIsValid([30,.nan],previousOldest:nil))
  let observedGood=[CoveragePage(offset:0,limit:2,itemCount:2,timestampsValid:true,times:[100,90]),CoveragePage(offset:2,limit:2,itemCount:2,timestampsValid:true,times:[80,70])]
  assert(observedListOrderingIssue(observedGood)==nil)
  assert(observedListOrderingIssue([CoveragePage(offset:0,limit:2,itemCount:2,timestampsValid:true,times:[90,100])])=="within_page_order")
  assert(observedListOrderingIssue([observedGood[0],CoveragePage(offset:2,limit:2,itemCount:2,timestampsValid:true,times:[95,70])])=="between_page_order")
  assert(observedListOrderingIssue([observedGood[0],CoveragePage(offset:4,limit:2,itemCount:2,timestampsValid:true,times:[80,70])])=="offset_gap")
  assert(observedListOrderingIssue([CoveragePage(offset:0,limit:2,itemCount:2,timestampsValid:false,times:[100])])=="invalid_timestamp")
  assert(observedListOrderingIssue([CoveragePage(offset:20,limit:2,itemCount:2,timestampsValid:true,times:[80,70])])=="starting_offset_missing")
  assert(coverageFromDiscovery(cutoffCrossed:true,naturalEnd:false,orderingValid:true,safetyLimit:false) == .completeCutoff)
  assert(coverageFromDiscovery(cutoffCrossed:true,naturalEnd:false,orderingValid:false,safetyLimit:false) == .incompleteOrdering)
  assert(coverageFromDiscovery(cutoffCrossed:false,naturalEnd:true,orderingValid:false,safetyLimit:false) == .incompleteOrdering)
  assert(coverageFromDiscovery(cutoffCrossed:false,naturalEnd:false,orderingValid:true,safetyLimit:true) == .incompleteSafetyLimit)
  assert(coverageFromDiscovery(cutoffCrossed:true,naturalEnd:false,orderingValid:false,safetyLimit:true) == .incompleteSafetyLimit)
  assert(coverageFromDiscovery(cutoffCrossed:false,naturalEnd:false,orderingValid:true,safetyLimit:false) == .incompleteStall)
  let projectOldPage=CoveragePage(scope:.project,streamId:77,sequence:1,paginationKind:.cursor,cursorPresent:true,cursorNull:true,cursorType:"null",itemCount:1,timestampsValid:true,times:[cutoff-100])
  assert(!pageCrossesRecentCutoff(projectOldPage,cutoff:cutoff))
  let filteredOldPage=CoveragePage(scope:.filtered,streamId:2,sequence:1,paginationKind:.offset,offset:20,limit:20,queryKeys:["is_archived","is_starred","limit","offset","order"],itemCount:1,timestampsValid:true,times:[cutoff-100])
  assert(!pageCrossesRecentCutoff(filteredOldPage,cutoff:cutoff))
  assert(coverageFromDiscovery(globalObserved:false,cutoffCrossed:true,naturalEnd:true,orderingValid:true,safetyLimit:false) == .incompleteGlobalNotObserved)
  let globalCursorFirst=CoveragePage(scope:.global,streamId:0,sequence:1,paginationKind:.cursor,cursorPresent:true,cursorNull:false,cursorType:"object",itemCount:2,timestampsValid:true,times:[cutoff+1000,cutoff+500])
  let globalCursorCross=CoveragePage(scope:.global,streamId:0,sequence:2,paginationKind:.cursor,cursorPresent:true,cursorNull:false,cursorType:"object",itemCount:2,timestampsValid:true,times:[cutoff-1,cutoff-100])
  assert(paginationKind(offset:nil,cursorPresent:true) == .cursor)
  assert(paginationKind(offset:20,cursorPresent:true) == .offset)
  assert(pageCrossesRecentCutoff(globalCursorCross,cutoff:cutoff))
  assert(observedListOrderingIssue([globalCursorFirst,globalCursorCross],scope:.global)==nil)
  assert(coverageFromDiscovery(globalObserved:true,cutoffCrossed:true,naturalEnd:false,orderingValid:true,safetyLimit:false) == .completeCutoff)
  let outOfOrderCursorFirst=CoveragePage(scope:.global,streamId:0,sequence:2,paginationKind:.cursor,cursorPresent:true,cursorNull:false,cursorType:"object",itemCount:2,timestampsValid:true,times:[cutoff+1000,cutoff+500])
  let outOfOrderCursorCross=CoveragePage(scope:.global,streamId:0,sequence:1,paginationKind:.cursor,cursorPresent:true,cursorNull:false,cursorType:"object",itemCount:2,timestampsValid:true,times:[cutoff-1,cutoff-100])
  assert(observedListOrderingIssue([outOfOrderCursorCross,outOfOrderCursorFirst],scope:.global)=="between_page_order")
  let opaqueCursorJson=try JSONSerialization.data(withJSONObject:["scope":"global","paginationKind":"cursor","cursorPresent":true,"cursorNull":false,"cursorType":"object"])
  let opaqueCursorString=String(data:opaqueCursorJson,encoding:.utf8)!
  assert(!opaqueCursorString.contains("opaque-cursor"))
  let projectOnly=[projectOldPage]
  assert(!naturalEndObserved(projectOnly,scope:.global))
  let globalOffsetPage=CoveragePage(scope:.global,streamId:0,sequence:1,paginationKind:.offset,offset:0,limit:nil,itemCount:2,timestampsValid:true,times:[100,90])
  let globalOffsetNext=CoveragePage(scope:.global,streamId:0,sequence:2,paginationKind:.offset,offset:2,limit:nil,queryKeys:["limit","offset","order"],itemCount:2,timestampsValid:true,times:[80,70])
  assert(observedListOrderingIssue([globalOffsetPage,globalOffsetNext],scope:.global)==nil)
  let queryGlobalFirst=CoveragePage(scope:.global,streamId:0,sequence:1,paginationKind:.offset,offset:0,limit:20,queryKeys:["limit","offset","order"],itemCount:2,timestampsValid:true,times:[cutoff+1000,cutoff+500])
  let queryGlobalCross=CoveragePage(scope:.global,streamId:0,sequence:2,paginationKind:.offset,offset:2,limit:20,queryKeys:["limit","offset","order"],itemCount:2,timestampsValid:true,times:[cutoff-1,cutoff-100])
  assert(observedListOrderingIssue([queryGlobalFirst,queryGlobalCross],scope:.global)==nil)
  assert(pageCrossesRecentCutoff(queryGlobalCross,cutoff:cutoff))
  assert(coverageFromDiscovery(globalObserved:true,cutoffCrossed:true,naturalEnd:false,orderingValid:true,safetyLimit:false) == .completeCutoff)
  assert(observedListOrderingIssue([globalOffsetPage,CoveragePage(scope:.global,streamId:0,sequence:2,paginationKind:.offset,offset:5,itemCount:1,timestampsValid:true,times:[80])],scope:.global)=="offset_gap")
  let cursorNullPage=CoveragePage(scope:.global,streamId:0,sequence:3,paginationKind:.cursor,cursorPresent:true,cursorNull:true,cursorType:"null",itemCount:1,timestampsValid:true,times:[cutoff-100])
  assert(!naturalEndObserved([globalCursorFirst,cursorNullPage],scope:.global))
  let cursorEmptyPage=CoveragePage(scope:.global,streamId:0,sequence:2,paginationKind:.cursor,cursorPresent:true,cursorNull:true,cursorType:"null",itemCount:0,timestampsValid:true,times:[])
  assert(naturalEndObserved([globalCursorFirst,cursorEmptyPage],scope:.global))
  assert(coverageFromDiscovery(globalObserved:true,cutoffCrossed:false,naturalEnd:true,orderingValid:true,safetyLimit:false) == .completeEndOfList)
  assert(isNaturalEndListPage(path:"/backend-api/conversations",offset:40,itemCount:0,expectedNextOffset:40,hasLaterOffset:false))
  assert(isNaturalEndListPage(path:"/backend-api/conversations",offset:0,itemCount:0,expectedNextOffset:nil,hasLaterOffset:false))
  assert(!isNaturalEndListPage(path:"/backend-api/conversations",offset:40,itemCount:0,expectedNextOffset:20,hasLaterOffset:false))
  assert(!isNaturalEndListPage(path:"/backend-api/conversation/batch",offset:40,itemCount:0,expectedNextOffset:40,hasLaterOffset:false))
  let fixedCycleStart=now;let fixedCutoff=fixedCycleStart-21600000
  assert(pageCrossesRecentCutoff(CoveragePage(offset:0,limit:1,itemCount:1,timestampsValid:true,times:[fixedCutoff-1]),cutoff:fixedCutoff))
  assert(!pageCrossesRecentCutoff(CoveragePage(scope:.global,streamId:0,sequence:1,paginationKind:.unknown,itemCount:1,timestampsValid:true,times:[fixedCutoff-1]),cutoff:fixedCutoff))
  // An incomplete coverage result does not change queue eligibility for discovered chats.
  let previousKnownChats=s.records.count
  let failedCoverage=coverageAfterListStatus(CompositeCoverage(status:.completeAccount,detail:"synthetic",scope:"account",proofs:[]),statusCodes:[429])
  let queueWithIncompleteCoverage=s.queue(s.recent(now,ids:["a","b"]))
  assert(queueWithIncompleteCoverage.count==1 && queueWithIncompleteCoverage[0].conversationId=="b")
  assert(s.records.count==previousKnownChats && failedCoverage.status == .incompleteStall && !failedCoverage.isComplete)
  assert(CoverageStatus.incompleteStall != .completeCutoff)
  var schedule=CycleState();schedule.enabled=true;schedule.nextRun=Date(timeIntervalSince1970:1)
  assert(scheduledDiscoveryInterval==1800 && nextDiscoveryRun(after:Date(timeIntervalSince1970:100))==Date(timeIntervalSince1970:1900))
  let fixedNow=1_800_000_000_000.0,activityCutoff=fixedNow-21_600_000
  assert(pinnedActivityRecency(times:[],expectedCount:1,cutoff:activityCutoff,now:fixedNow)=="Unknown")
  assert(pinnedActivityRecency(times:[activityCutoff-1],expectedCount:1,cutoff:activityCutoff,now:fixedNow)=="No")
  assert(pinnedActivityRecency(times:[activityCutoff],expectedCount:1,cutoff:activityCutoff,now:fixedNow)=="Yes")
  assert(pinnedActivityRecency(times:[activityCutoff-1,fixedNow],expectedCount:2,cutoff:activityCutoff,now:fixedNow)=="Mixed")
  assert(pinnedActivityRecency(times:[fixedNow+1],expectedCount:1,cutoff:activityCutoff,now:fixedNow)=="Unknown")
  assert(!pinnedDiagnosticCanFinish(timestampExpected:true,timestampState:.resolving))
  assert(!pinnedDiagnosticCanFinish(timestampExpected:true,timestampState:.resolved,itemStates:["pending"])) // no finished with a pending item
  assert(pinnedDiagnosticCanFinish(timestampExpected:true,timestampState:.resolved,itemStates:["resolved"]))
  assert(!pinnedDiagnosticCanFinish(timestampExpected:true,timestampState:.notStarted))
  for terminal in [PinnedTimestampState.resolved,.partial,.timeout,.error,.skipped] {
   assert(terminal.isTerminal && pinnedDiagnosticCanFinish(timestampExpected:true,timestampState:terminal))
  }
  assert(pinnedTimestampAggregateState(resolved:1,total:1,timeouts:0,errors:0) == .resolved)
  assert(pinnedTimestampAggregateState(resolved:1,total:2,timeouts:1,errors:0) == .partial)
  assert(pinnedTimestampAggregateState(resolved:0,total:1,timeouts:1,errors:0) == .timeout)
  assert(pinnedTimestampAggregateState(resolved:0,total:1,timeouts:0,errors:1) == .error)
  assert(pinnedTimestampAggregateState(resolved:0,total:0,timeouts:0,errors:0) == .skipped)
  assert(pinnedTimestampItemCanTransition(from:"pending",to:.resolved))
  assert(pinnedTimestampItemCanTransition(from:"pending",to:.timeout))
  assert(!pinnedTimestampItemCanTransition(from:"timeout",to:.resolved)) // late success after timeout is ignored
  assert(!pinnedTimestampItemCanTransition(from:"resolved",to:.timeout)) // timeout after success is cancelled
  assert(!pinnedTimestampItemCanTransition(from:"pending",to:.partial)) // partial is aggregate-only
  assert(pinnedTimestampAggregateState(resolved:0,total:2,timeouts:1,errors:1) == .error)
  schedule.recoverSchedule(now:Date(timeIntervalSince1970:100));assert(schedule.nextRun==Date(timeIntervalSince1970:1900))
  let future=schedule.nextRun;schedule.recoverSchedule(now:Date(timeIntervalSince1970:101));assert(schedule.nextRun==future)
  // Navigation, passive-response and history waits all share the per-chat deadline.
  for stage in ["navigation","passive_response","history_continuation"] {
   let started=Date()
   let result=try await isolateCheck(timeoutSeconds:0.02) {
    try await Task.sleep(nanoseconds:60_000_000_000)
    return stage
   }
   guard case .failure(let error)=result,error is IsolatedCheckError else {assertionFailure("\(stage) did not time out");continue}
   assert(Date().timeIntervalSince(started)<1)
  }
  let nextAfterTimedOutChat=try await isolateCheck(timeoutSeconds:0.1) {"next-chat"}
  guard case .success("next-chat")=nextAfterTimedOutChat else {assertionFailure("timed-out chat blocked the next chat")}
  var timeoutGate=CycleGate();assert(timeoutGate.begin())
  let finalChat=try await isolateCheck(timeoutSeconds:0.02) {try await Task.sleep(nanoseconds:60_000_000_000);return "last"}
  guard case .failure(let finalError)=finalChat,finalError is IsolatedCheckError else {assertionFailure("last chat did not time out")}
  timeoutGate.end();assert(!timeoutGate.running && timeoutGate.begin());timeoutGate.end()
  let nextCycle=try await isolateCheck(timeoutSeconds:0.1) {"next-cycle"}
  guard case .success("next-cycle")=nextCycle else {assertionFailure("next scheduled cycle remained blocked")}
  var chatStages=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:100),renderLeaseActive:true)
  chatStages.enter("navigation_started",now:Date(timeIntervalSince1970:101));assert(chatStages.timeoutSubtype=="navigation")
  chatStages.enter("route_reached",now:Date(timeIntervalSince1970:102));chatStages.enter("history_wait_started",now:Date(timeIntervalSince1970:103));assert(chatStages.timeoutSubtype=="waiting_history")
  assert(chatStages.historyResponses==0 && chatStages.pagesObserved==0 && chatStages.automationPageUpdateCallbacks==0 && chatStages.messagesAccumulated==0)
  chatStages.historyResponses=64;chatStages.pagesObserved=19;chatStages.automationPageUpdateCallbacks=19;chatStages.messagesAccumulated=371
  chatStages.hasPreviousPage=true
  assert(chatStages.timeoutSubtype=="history_response_received") // response counters alone are not progress proof
  chatStages.checkProgress.observeNativePage(newlyAddedMessages:371,hasPreviousPage:true,paginationProgressObserved:true)
  assert(chatStages.timeoutSubtype=="pagination_progressing")
  assert(!(chatStages.timeoutSubtype=="waiting_history" && (chatStages.pagesObserved>0 || chatStages.automationPageUpdateCallbacks>0 || chatStages.messagesAccumulated>0)))
  var responseOnly=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:100));responseOnly.enter("history_wait_started",now:Date(timeIntervalSince1970:101));responseOnly.historyResponses=1
  assert(responseOnly.timeoutSubtype=="history_response_received")
  chatStages.enter("pagination_started",now:Date(timeIntervalSince1970:104));assert(chatStages.timeoutSubtype=="pagination")
  chatStages.enter("aggregation_started",now:Date(timeIntervalSince1970:105));assert(chatStages.timeoutSubtype=="aggregation")
  let timeoutReport=chatStages.report(ordinal:1,terminal:"per_chat_timeout",now:Date(timeIntervalSince1970:106))
  assert(timeoutReport.contains("render lease active") && timeoutReport.contains("stage 1000 ms") && !timeoutReport.contains("conversationId") && !timeoutReport.contains("title"))
  func aggregateFixture(messages:Int,tokens:Int,complete:Bool,previous:Bool?)->SafeAggregate {
   SafeAggregate(conversationId:"private-id",title:"private-title",processedMessageIds:[],messagesCollected:messages,userMessages:messages,assistantMessages:0,otherMessages:0,estimatedTextTokens:tokens,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:complete,hasPreviousPage:previous,hasNextPage:nil,responsesCaptured:1,updatedAt:100)
  }
  let savedReplay=aggregateFixture(messages:150,tokens:40000,complete:false,previous:true)
  let replayTimeoutCandidate=aggregateFixture(messages:150,tokens:40000,complete:false,previous:true)
  let replayPartial=timeoutProgressPartialAggregate(existing:savedReplay,candidate:replayTimeoutCandidate,hasPreviousPage:true,acceptedPages:9,pageUpdateCallbacks:9,producedMessages:150)
  assert(replayPartial?.estimatedTextTokens==40000 && replayPartial?.messagesCollected==150)
  assert(replayPartial?.historyComplete==false && replayPartial?.hasPreviousPage==true)
  assert(timeoutProgressPartialAggregate(existing:savedReplay,candidate:aggregateFixture(messages:149,tokens:39999,complete:false,previous:true),hasPreviousPage:true,acceptedPages:1,pageUpdateCallbacks:1,producedMessages:149)?.estimatedTextTokens==40000)
  assert(timeoutProgressPartialAggregate(existing:savedReplay,candidate:replayTimeoutCandidate,hasPreviousPage:true,acceptedPages:0,pageUpdateCallbacks:0,producedMessages:0)==nil)
  let completeAggregate=timeoutProgressPartialAggregate(existing:nil,candidate:aggregateFixture(messages:10,tokens:100,complete:true,previous:false),hasPreviousPage:false,acceptedPages:1,pageUpdateCallbacks:1,producedMessages:10)
  assert(completeAggregate==nil) // no timeout partial when the history is proven complete
  assert(isHistoryProgressProven(acceptedPages:1,pageUpdateCallbacks:0,producedMessages:0,paginationProgressObserved:false))
  let matchingUpdateDecision=noProgressTerminalDecision(existing:savedReplay,candidate:replayTimeoutCandidate,hasProvenHistoryProgress:true,hasPreviousPage:true,completionProven:false,subtype:"pagination")
  assert(matchingUpdateDecision.terminal.hasPrefix("Partial") && matchingUpdateDecision.aggregate?.estimatedTextTokens==40000)
  assert(matchingUpdateDecision.aggregate?.historyComplete==false && matchingUpdateDecision.aggregate?.hasPreviousPage==true)
  let missingUpdatePages=noProgressTerminalDecision(existing:savedReplay,candidate:nil,hasProvenHistoryProgress:isHistoryProgressProven(acceptedPages:10,pageUpdateCallbacks:0,producedMessages:0,paginationProgressObserved:false),hasPreviousPage:true,completionProven:false,subtype:"history_response_received")
  assert(missingUpdatePages.terminal.hasPrefix("Partial") && missingUpdatePages.aggregate?.estimatedTextTokens==40000)
  let missingUpdateCallbacks=noProgressTerminalDecision(existing:savedReplay,candidate:nil,hasProvenHistoryProgress:isHistoryProgressProven(acceptedPages:0,pageUpdateCallbacks:2,producedMessages:192,paginationProgressObserved:false),hasPreviousPage:true,completionProven:false,subtype:"history_response_received")
  assert(missingUpdateCallbacks.terminal.hasPrefix("Partial") && missingUpdateCallbacks.aggregate?.estimatedTextTokens==40000)
  assert(missingUpdateCallbacks.aggregate?.historyComplete==false && missingUpdateCallbacks.aggregate?.hasPreviousPage==true)
  let responseOnlyProgress=isHistoryProgressProven(acceptedPages:0,pageUpdateCallbacks:0,producedMessages:0,paginationProgressObserved:false)
  assert(!responseOnlyProgress) // HTTP/history responses alone are not accepted page progress
  let responseOnlyDecision=noProgressTerminalDecision(existing:savedReplay,candidate:nil,hasProvenHistoryProgress:responseOnlyProgress,hasPreviousPage:true,completionProven:false,subtype:"history_response_received")
  assert(responseOnlyDecision.terminal.hasPrefix("Failed"))
  let zeroProgressDecision=noProgressTerminalDecision(existing:nil,candidate:nil,hasProvenHistoryProgress:false,hasPreviousPage:nil,completionProven:false,subtype:"waiting_history")
  assert(zeroProgressDecision.terminal=="Failed · no_progress · waiting_history")

  func parserEntry(accepted:Bool,pages:Int=0,messages:Int?=nil,callback:Bool=false,previous:Bool?=nil)->HistoryResponseParseEntry {
   let payload:[String:Any]=["generation":"safe-generation","pageUpdateCallbackFired":callback,
    "responseParseDiagnostic":["endpointTemplate":"/backend-api/conversations/:id/messages","transport":"fetch","status":200,"contentTypeCategory":"json","topLevelType":"object","topLevelKeyNames":["messages","page_info"],"topLevelArrayCounts":[["key":"messages","count":messages ?? 0]],"expectedStructure":["messagesArray":accepted,"pageInfoObject":true,"hasPreviousPageBoolean":previous != nil],"parserAttempted":true,"parserAccepted":accepted,"rejectionReason":accepted ? "accepted":"parsed_but_empty","extractedPageCount":pages,"extractedMessageCount":messages as Any? ?? NSNull(),"hasPreviousPage":previous as Any? ?? NSNull()]]
   return HistoryResponseParseEntry.make(payload)
  }
  // Runtime-shaped regression: 40 observed responses, of which 10 parsed pages
  // produced 191 messages and callbacks. No matching live automationUpdate exists.
  var runtimeProgress=ChatCheckProgressAccumulator()
  for index in 0..<40 {
   let accepted=index<10
   let messageCount=accepted ? (index==9 ? 20:19):nil
   runtimeProgress.observeParsedResponse(parserEntry(accepted:accepted,pages:accepted ? 1:0,messages:messageCount,callback:accepted,previous:true))
  }
  assert(runtimeProgress.parserAttempted==40 && runtimeProgress.parserAccepted==10)
  assert(runtimeProgress.acceptedParsedPages==10 && runtimeProgress.producedMessages==191)
  assert(runtimeProgress.pageUpdateCallbacks==10 && runtimeProgress.hasPreviousPage==true)
  assert(runtimeProgress.hasProvenHistoryProgress)
  let runtimeFailure=noProgressTerminalDecision(existing:aggregateFixture(messages:1135,tokens:307138,complete:false,previous:true),candidate:nil,
   hasProvenHistoryProgress:runtimeProgress.hasProvenHistoryProgress,hasPreviousPage:runtimeProgress.hasPreviousPage,
   completionProven:runtimeProgress.historyCompleteProven,subtype:"history_response_received")
  assert(runtimeFailure.terminal.hasPrefix("Partial") && runtimeFailure.aggregate?.messagesCollected==1135)
  assert(runtimeFailure.aggregate?.estimatedTextTokens==307138 && runtimeFailure.aggregate?.historyComplete==false)
  assert(runtimeFailure.aggregate?.hasPreviousPage==true)
  // Any canonical progress signal is sufficient even if a live update is absent.
  var acceptedPageOnly=ChatCheckProgressAccumulator();acceptedPageOnly.observeParsedResponse(parserEntry(accepted:true,pages:1,messages:0,previous:true))
  assert(noProgressTerminalDecision(existing:savedReplay,candidate:nil,hasProvenHistoryProgress:acceptedPageOnly.hasProvenHistoryProgress,hasPreviousPage:acceptedPageOnly.hasPreviousPage,completionProven:false,subtype:"pagination").terminal.hasPrefix("Partial"))
  var callbackOnly=ChatCheckProgressAccumulator();callbackOnly.observeParsedResponse(parserEntry(accepted:false,callback:true,previous:true))
  assert(callbackOnly.hasProvenHistoryProgress)
  assert(noProgressTerminalDecision(existing:savedReplay,candidate:nil,hasProvenHistoryProgress:callbackOnly.hasProvenHistoryProgress,hasPreviousPage:callbackOnly.hasPreviousPage,completionProven:false,subtype:"pagination").terminal.hasPrefix("Partial"))
  var uniqueMessagesOnly=ChatCheckProgressAccumulator();uniqueMessagesOnly.uniqueMessagesProduced=3;uniqueMessagesOnly.hasPreviousPage=true
  assert(uniqueMessagesOnly.hasProvenHistoryProgress)
  assert(noProgressTerminalDecision(existing:savedReplay,candidate:nil,hasProvenHistoryProgress:uniqueMessagesOnly.hasProvenHistoryProgress,hasPreviousPage:uniqueMessagesOnly.hasPreviousPage,completionProven:false,subtype:"pagination").terminal.hasPrefix("Partial"))
  assert(isHistoryProgressProven(acceptedPages:0,pageUpdateCallbacks:0,producedMessages:3,paginationProgressObserved:false))
  var responseOnlyAccumulator=ChatCheckProgressAccumulator()
  for _ in 0..<40 {responseOnlyAccumulator.observeParsedResponse(parserEntry(accepted:false,previous:true))}
  assert(!responseOnlyAccumulator.hasProvenHistoryProgress)
  let responseOnlyCanonical=noProgressTerminalDecision(existing:savedReplay,candidate:nil,hasProvenHistoryProgress:responseOnlyAccumulator.hasProvenHistoryProgress,hasPreviousPage:responseOnlyAccumulator.hasPreviousPage,completionProven:false,subtype:"history_response_received")
  assert(responseOnlyCanonical.terminal.hasPrefix("Failed"))
  var completedProgress=runtimeProgress;completedProgress.recordCompletionProof()
  let provenComplete=aggregateFixture(messages:120,tokens:41000,complete:true,previous:false)
  let completionProofDecision=noProgressTerminalDecision(existing:savedReplay,candidate:provenComplete,hasProvenHistoryProgress:completedProgress.hasProvenHistoryProgress,hasPreviousPage:false,completionProven:completedProgress.historyCompleteProven,subtype:"pagination")
  assert(completionProofDecision.terminal=="Complete" && completionProofDecision.aggregate?.historyComplete==true)
  // The diagnostic view is a snapshot of the production accumulator.
  var summaryTelemetry=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:100))
  summaryTelemetry.checkProgress=runtimeProgress
  var summaryState=CycleState();summaryState.beginPerChatHistoryDiagnostic(ordinal:1);summaryState.observePerChatHistoryDiagnostic(summaryTelemetry)
  let canonicalSummary=summaryState.perChatHistoryDiagnostics?.chats.first
  assert(canonicalSummary?.parserAttempted==40 && canonicalSummary?.parserAccepted==10 && canonicalSummary?.pagesProduced==10)
  assert(canonicalSummary?.messagesProduced==191 && canonicalSummary?.pageUpdateCallbacks==10 && canonicalSummary?.hasPreviousPage==true)

  // Same-document continuation must inherit the first attempt's canonical progress.
  // The response entries remain attached to the same Chat ordinal across both attempts.
  var firstAttemptProgress=ChatCheckProgressAccumulator()
  var continuationCycleState=CycleState()
  continuationCycleState.beginPerChatHistoryDiagnostic(ordinal:2)
  for index in 0..<11 {
   let messages=index==10 ? 20:16
   let entry=parserEntry(accepted:true,pages:1,messages:messages,callback:true,previous:true)
   firstAttemptProgress.observeParsedResponse(entry)
   continuationCycleState.recordHistoryResponseParsing(entry)
  }
  assert(firstAttemptProgress.acceptedParsedPages==11 && firstAttemptProgress.producedMessages==180)
  assert(firstAttemptProgress.pageUpdateCallbacks==11 && firstAttemptProgress.hasPreviousPage==true)
  var continuedAttemptTelemetry=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:110))
  continuedAttemptTelemetry.checkProgress=firstAttemptProgress
  continuedAttemptTelemetry.hasPreviousPage=firstAttemptProgress.hasPreviousPage
  continuedAttemptTelemetry.historyComplete=firstAttemptProgress.historyCompleteProven
  continuationCycleState.observePerChatHistoryDiagnostic(continuedAttemptTelemetry)
  let continuationSummary=continuationCycleState.perChatHistoryDiagnostics?.chats.first
  assert(continuationSummary?.ordinal==2 && continuationSummary?.parserAccepted==11)
  assert(continuationSummary?.pagesProduced==11 && continuationSummary?.messagesProduced==180)
  assert(continuationSummary?.pageUpdateCallbacks==11 && continuationSummary?.hasPreviousPage==true)
  let continuationTerminal=noProgressTerminalDecision(existing:aggregateFixture(messages:200,tokens:42000,complete:false,previous:true),candidate:nil,
   hasProvenHistoryProgress:continuedAttemptTelemetry.checkProgress.hasProvenHistoryProgress,
   hasPreviousPage:continuedAttemptTelemetry.checkProgress.hasPreviousPage,
   completionProven:continuedAttemptTelemetry.checkProgress.historyCompleteProven,subtype:"history_response_received")
  assert(continuationTerminal.terminal.hasPrefix("Partial"))
  assert(continuationTerminal.aggregate?.messagesCollected==200 && continuationTerminal.aggregate?.estimatedTextTokens==42000)
  assert(continuationTerminal.aggregate?.historyComplete==false && continuationTerminal.aggregate?.hasPreviousPage==true)

  let staleGenerationReason=historyProgressEventRejectionReason(eventGeneration:"old-generation",activeGeneration:"new-generation",telemetryGeneration:"new-generation")
  assert(staleGenerationReason=="stale_generation")
  assert(historyProgressEventRejectionReason(eventGeneration:"new-generation",activeGeneration:"new-generation",telemetryGeneration:"new-generation")==nil)
  var rejectedEventState=HistoryProgressEventRejectionState();rejectedEventState.record(staleGenerationReason!)
  assert(rejectedEventState.counts==["stale_generation":1] && rejectedEventState.summary.contains("stale_generation"))
  assert(continuationCycleState.perChatHistoryDiagnostics?.chats.count==1) // stale event rejection does not create a new Chat ordinal
  assert(riskMeasurementStatus(result:"Complete",aggregate:aggregateFixture(messages:10,tokens:100,complete:true,previous:false)) == .complete)
  var continuationTrace=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:1000))
  continuationTrace.continuationSelected=true;continuationTrace.continuationStartedAt=Date(timeIntervalSince1970:1000)
  continuationTrace.continuationFrontierPresent=true;continuationTrace.continuationHasPreviousPage=true
  continuationTrace.continuationReplayProgressEligible=true;continuationTrace.continuationNewHistoryProgressEligible=false
  continuationTrace.recordContinuationStage("continuation_selected",now:Date(timeIntervalSince1970:1000))
  continuationTrace.recordContinuationStage("bridge_command_sent",now:Date(timeIntervalSince1970:1001))
  continuationTrace.recordContinuationStage("bridge_command_received",routeUnchanged:true,documentSame:true,bridgeResult:"received",now:Date(timeIntervalSince1970:1002))
  continuationTrace.recordContinuationStage("bridge_command_accepted",routeUnchanged:true,documentSame:true,bridgeResult:"accepted",now:Date(timeIntervalSince1970:1003))
  continuationTrace.continuationBridgeSuccess="yes"
  continuationTrace.continuationBridgeCallbackResult="accepted"
  continuationTrace.continuationTriggerAttempted=true;continuationTrace.continuationTriggerResult="yes"
  continuationTrace.recordContinuationStage("pagination_trigger_attempted",now:Date(timeIntervalSince1970:1004))
  continuationTrace.recordContinuationStage("pagination_trigger_attempted",source:"native",now:Date(timeIntervalSince1970:1004))
  continuationTrace.recordContinuationStage("pagination_trigger_attempted",source:"js",now:Date(timeIntervalSince1970:1004))
  continuationTrace.recordContinuationStage("pagination_trigger_result",bridgeResult:"success",now:Date(timeIntervalSince1970:1005))
  continuationTrace.historyRequests=15;continuationTrace.historyResponses=15 // first pass totals must not mask continuation no-request
  continuationTrace.continuationBaselineHistoryRequests=15;continuationTrace.continuationBaselineHistoryResponses=15
  continuationTrace.continuationBaselinePages=12;continuationTrace.continuationBaselineMessages=743
  continuationTrace.observeContinuationPage(sequence:13,messageCount:753,olderUniqueMessages:10,now:Date(timeIntervalSince1970:1006))
  continuationTrace.observeContinuationPage(sequence:13,messageCount:753,olderUniqueMessages:10,now:Date(timeIntervalSince1970:1007)) // duplicate delivery is one page
  continuationTrace.observeContinuationPage(sequence:17,messageCount:840,olderUniqueMessages:97,now:Date(timeIntervalSince1970:1008))
  continuationTrace.diagnoseContinuationAtTerminal()
  assert(continuationTrace.continuationDiagnosis=="continuation_request_observer_missed_progress")
  assert(continuationTrace.continuationPageResponses==2 && continuationTrace.continuationAggregateGrowth==97 && continuationTrace.continuationOlderUniqueMessages==97)
  assert(continuationTrace.continuationTriggerSources==["native","js"]) // two observers, one logical trigger
  let continuationReport=continuationTrace.report(ordinal:2,terminal:"Partial · no_progress · pagination_progressing",now:Date(timeIntervalSince1970:1009))
  assert(continuationReport.contains("continuation_request_observer_missed_progress") && continuationReport.contains("continuation hook delta 0/0") && continuationReport.contains("trigger telemetry sources [native,js] (one logical attempt)"))
  var responsePipeline=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:3000));responsePipeline.continuationSelected=true;responsePipeline.continuationStartedAt=Date(timeIntervalSince1970:3000)
  responsePipeline.recordContinuationResponse(["sequence":1,"elapsedMs":47,"requestClass":"conversation_messages","transport":"fetch","status":200,"requestCursorFingerprint":"deadbeef","responseCursorFingerprint":"cafebabe","pageFingerprint":"4:01020304","itemCount":4,"hasPreviousPage":true,"payloadRecognized":true,"generationPassed":true,"routePassed":true,"documentPassed":true,"duplicatePage":false,"duplicateCursor":false,"duplicateFirstPassPage":false,"duplicateFirstPassCursor":false,"pageDirection":"older","accepted":true,"rejectionReason":"none"],now:Date(timeIntervalSince1970:3001))
  responsePipeline.recordContinuationResponse(["sequence":2,"elapsedMs":58,"requestClass":"conversation_messages","transport":"XHR","status":200,"requestCursorFingerprint":"private-cursor-value","pageFingerprint":"private-message-id","payloadRecognized":true,"generationPassed":true,"routePassed":true,"documentPassed":true,"accepted":false,"rejectionReason":"private-title-and-body"],now:Date(timeIntervalSince1970:3002))
  let responsePipelineReport=responsePipeline.report(ordinal:2,terminal:"Partial · no_progress · waiting_history",now:Date(timeIntervalSince1970:3003))
  assert(responsePipelineReport.contains("hook +47ms") && responsePipelineReport.contains("older · accepted yes"))
  assert(responsePipelineReport.contains("unknown_rejection") && !responsePipelineReport.contains("private-cursor-value") && !responsePipelineReport.contains("private-message-id") && !responsePipelineReport.contains("private-title-and-body"))
  var resumeBoundary=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:3200));resumeBoundary.continuationSelected=true;resumeBoundary.continuationStartedAt=Date(timeIntervalSince1970:3200)
  resumeBoundary.recordFirstPassBoundary(["requestCount":3,"responseCount":2,"requestInFlightCount":1,"responseInFlightCount":1,"aggregateBaselineSource":"first_pass_aggregate","aggregateBaselineIdentityCount":30,"aggregateBaselineIdentitySetTruncated":false,"firstPassAcceptedPageCount":9,"firstPassRequestTrackedPageCount":8,"firstPassPreConfigurationPendingAcceptedPageCount":1,"firstPassOtherAcceptedPageCount":0,"firstPassPreConfigurationPendingPageCount":1,"firstPassPreConfigurationPendingItemCount":3,"routeTemplate":"/g/<id>/c/<id>","documentIdentityPresent":true,"documentGenerationFingerprint":"abcdef12","firstPassGenerationMatches":true,"lastRequestCursorFingerprint":"deadbeef","lastResponsePageFingerprint":"2:01020304","lastAcceptedPageFingerprint":"2:01020304","pendingRequestOrdinal":3,"lastHasPreviousPage":true,"pages":[["ordinal":1,"requestCursorFingerprint":"deadbeef","responseCursorFingerprint":"cafebabe","pageFingerprint":"2:01020304","itemSetFingerprint":"2:01020304","accepted":true,"temporalRelation":"older","hasPreviousPage":true],["ordinal":2,"requestCursorFingerprint":"RAW_CURSOR_SECRET","responseCursorFingerprint":"bad","pageFingerprint":"raw-id","itemSetFingerprint":"raw-id","accepted":false,"temporalRelation":"unknown","hasPreviousPage":true]]])
  resumeBoundary.recordContinuationResponse(["sequence":9,"requestOrdinal":4,"requestOrigin":"continuation","requestCursorFingerprint":"deadbeef","requestCursorSeenFirstPass":true,"requestCursorFirstPassMatchOrdinal":1,"requestCursorMatchesLastFirstPass":true,"exactFirstPassPageMatch":true,"baselineIdentityOverlapCount":2,"baselineIdentitySetCount":30,"baselineMembershipTelemetryMismatch":true,"baselineMembershipReason":"baseline_membership_telemetry_mismatch","allItemsAlreadyKnownBaseline":true,"newIdentityCount":0,"responseCursorFingerprint":"cafebabe","pageFingerprint":"2:01020304","itemCount":2,"payloadRecognized":true,"generationPassed":true,"routePassed":true,"documentPassed":true,"accepted":false,"rejectionReason":"no_older_items"],now:Date(timeIntervalSince1970:3201))
  let resumeBoundaryReport=resumeBoundary.report(ordinal:2,terminal:"Partial · no_progress · waiting_history",now:Date(timeIntervalSince1970:3202))
  assert(resumeBoundary.continuationFirstPassRequestInFlight==1 && resumeBoundary.continuationFirstPassResponseInFlight==1)
  assert(resumeBoundary.continuationContinuationCursorSeenFirstPass==1 && resumeBoundary.continuationExactFirstPassPageMatches==1 && resumeBoundary.continuationKnownBaselineOnlyPages==1)
  assert(resumeBoundaryReport.contains("first-pass boundary") && resumeBoundaryReport.contains("request/response in-flight 1/1") && resumeBoundaryReport.contains("origin continuation") && resumeBoundaryReport.contains("all baseline-known yes") && resumeBoundaryReport.contains("aggregate baseline identities 30") && resumeBoundaryReport.contains("accepted pages tracked/pending/other 8/1/0 total 9") && resumeBoundaryReport.contains("pre-config pending pages/items 1/3") && resumeBoundaryReport.contains("baseline_membership_telemetry_mismatch"))
  assert(resumeBoundary.continuationBaselineMembershipMismatchCount==1)
  assert(!resumeBoundaryReport.contains("RAW_CURSOR_SECRET") && !resumeBoundaryReport.contains("raw-id"))
  var provenanceReport=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:3250))
  provenanceReport.recordFirstPassIdentityProvenance(["counts":["checkpoint_cache":1,"conversation_detail":2,"conversation_messages_request_tracked":3,"conversation_messages_untracked":0],"aggregateIdentityCount":6,"attributedIdentityCount":6,"gapCount":0,"aggregateProvenanceGap":false,"identitySetTruncated":false])
  provenanceReport.continuationSelected=true;provenanceReport.continuationStartedAt=Date(timeIntervalSince1970:3250)
  provenanceReport.recordContinuationResponse(["sequence":55,"requestOrigin":"continuation","requestClass":"conversation_messages","payloadRecognized":true,"accepted":false,"identityProvenanceCounts":["known_from_initial_dom":0,"known_from_bootstrap":0,"known_from_conversation_detail":2,"known_from_tracked_messages":1,"known_from_untracked_messages":0,"known_from_checkpoint_cache":1,"known_from_other":0,"genuinely_new":0]],now:Date(timeIntervalSince1970:3251))
  let provenanceText=provenanceReport.report(ordinal:3,terminal:"Partial",now:Date(timeIntervalSince1970:3252))
  assert(provenanceText.contains("first-seen [conversation_detail=2,conversation_messages_request_tracked=3,checkpoint_cache=1] · attributed/aggregate 6/6 · invariant_ok"))
  assert(provenanceText.contains("first-pass identity sources [known_from_conversation_detail=2,known_from_tracked_messages=1,known_from_checkpoint_cache=1]"))
  assert(!provenanceText.contains("private-id") && !provenanceText.contains("conversationId"))
  var provenanceGap=ChatCheckStageTelemetry()
  provenanceGap.recordFirstPassIdentityProvenance(["counts":["conversation_detail":2],"aggregateIdentityCount":3,"attributedIdentityCount":2,"gapCount":1,"aggregateProvenanceGap":true,"identitySetTruncated":true])
  assert(provenanceGap.firstPassIdentityProvenanceSummary.contains("aggregate_provenance_gap (1)"))
  var originTelemetry=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:3300));originTelemetry.continuationSelected=true;originTelemetry.continuationStartedAt=Date(timeIntervalSince1970:3300);originTelemetry.continuationBaselinePages=17;originTelemetry.continuationBaselinePageUpdateCallbacks=17
  originTelemetry.recordFirstPassBoundary(["requestCount":8,"responseCount":8,"firstPassAcceptedPageCount":18,"firstPassRequestTrackedPageCount":8,"firstPassPreConfigurationPendingAcceptedPageCount":0,"firstPassOtherAcceptedPageCount":10,"firstPassSourcePageCounts":["page_hook_preexisting":6,"conversation_messages_untracked":4],"firstPassTrackedIdentitySetCount":2100,"firstPassOtherOriginIdentitySetCount":800,"firstPassAcceptedPageTrace":[],"firstPassOtherOriginPageTrace":[["pageOrdinal":9,"elapsedMs":150,"sourceCategory":"page_hook_preexisting","pageOrigin":"untracked_response","endpointClass":"conversation_messages","requestObserved":false,"requestOrigin":"unknown","generationPresent":false,"generationMatchesFirstPass":false,"responseObserved":true,"pageHookSource":"fetch","captureSequence":12,"replayRequestIdPresent":true,"pageFingerprint":"2:abcdef12","requestCursorFingerprint":"RAW_CURSOR","itemCount":2,"addedNewIdentityCount":2,"temporalPosition":"after_last_tracked_page_8"]],"aggregateBaselineIdentityCount":2494,"aggregateBaselineIdentitySetTruncated":false,"identitySetTruncated":false,"routeTemplate":"/c/<id>","documentIdentityPresent":true,"firstPassGenerationMatches":true,"pages":[]])
  originTelemetry.recordContinuationResponse(["sequence":1,"elapsedMs":200,"requestClass":"conversation_messages","transport":"fetch","status":200,"requestOrigin":"continuation","requestOrdinal":9,"payloadRecognized":true,"generationPassed":true,"routePassed":true,"documentPassed":true,"accepted":false,"baselineIdentityOverlapCount":3,"baselineIdentitySetCount":2494,"trackedFirstPassIdentityOverlapCount":1,"otherOriginFirstPassIdentityOverlapCount":2,"baselineMembershipReason":"baseline_membership_consistent","allItemsAlreadyKnownBaseline":true,"newIdentityCount":0,"trackedFirstPassIdentitySetTruncated":false,"otherOriginFirstPassIdentitySetTruncated":false],now:Date(timeIntervalSince1970:3301))
  let originReport=originTelemetry.report(ordinal:1,terminal:"Partial · no_progress",now:Date(timeIntervalSince1970:3302))
  assert(originReport.contains("accepted pages tracked/pending/other 8/0/10 total 18 · native first-pass page summary 17 · bridge-native page gap 1"))
  assert(originReport.contains("native update callbacks 17"))
  assert(originReport.contains("conversation_messages_untracked=4,page_hook_preexisting=6"))
  assert(originReport.contains("source=page_hook_preexisting/conversation_messages"))
  assert(originReport.contains("tracked/other-origin first-pass overlap 1/2"))
  assert(!originReport.contains("RAW_CURSOR") && !originReport.contains("private-id"))
  assert(responsePipeline.continuationPayloadRecognizedCount==responsePipeline.continuationRecognizedResponseSequences.count)
  assert(responsePipelineReport.contains("parser recognized 2/2 shown (event-level payloadRecognized yes)"))
  assert(responsePipelineReport.contains("no-older exact reasons [none]"))
  var breakdownPipeline=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:3100));breakdownPipeline.continuationSelected=true;breakdownPipeline.continuationStartedAt=Date(timeIntervalSince1970:3100)
  breakdownPipeline.recordContinuationResponse(["sequence":1,"itemCount":4,"payloadRecognized":true,"generationPassed":true,"routePassed":true,"documentPassed":true,"dominantReason":"no_older_items_all_already_known","itemBreakdown":["totalItems":4,"alreadyKnownIdentity":4,"duplicateWithinPage":0,"missingIdentity":0,"missingTimestamp":0,"invalidTimestamp":0,"notOlderThanFrontier":0,"olderThanFrontierButRejectedOther":0,"eligibleOlder":0,"accepted":0,"older":2,"equal":1,"newer":1,"timestampUnknown":0],"frontier":["exists":true,"source":"first_pass_pagination_frontier","timestampValid":true,"identityPresent":false,"comparisonMode":"activity_timestamp_and_message_identity","older":2,"equal":1,"newer":1,"timestampUnknown":0],"accepted":false,"rejectionReason":"no_older_items"],now:Date(timeIntervalSince1970:3101))
  let breakdownReport=breakdownPipeline.report(ordinal:1,terminal:"Partial · no_progress · waiting_history",now:Date(timeIntervalSince1970:3102))
  assert(breakdownReport.contains("no_older_items_all_already_known=1"))
  assert(breakdownReport.contains("items baselineKnown/withinDuplicate/missingID/missingTime/invalidTime/notOlder/olderOther/eligible/accepted [4/0/0/0/0/0/0/0/0]"))
  assert(breakdownReport.contains("identity_not_retained") && breakdownReport.contains("first_pass_pagination_frontier"))
  var callbackMissing=ChatCheckStageTelemetry();callbackMissing.continuationSelected=true;callbackMissing.continuationBridgeSuccess="yes";callbackMissing.diagnoseContinuationAtTerminal()
  assert(callbackMissing.continuationDiagnosis=="continuation_bridge_callback_missing")
  var bridgeFailed=ChatCheckStageTelemetry();bridgeFailed.continuationSelected=true;bridgeFailed.continuationBridgeCallbackResult="rejected";bridgeFailed.diagnoseContinuationAtTerminal()
  assert(bridgeFailed.continuationDiagnosis=="continuation_bridge_failed")
  var ackMissing=ChatCheckStageTelemetry();ackMissing.continuationSelected=true;ackMissing.continuationBridgeCallbackResult="accepted";ackMissing.diagnoseContinuationAtTerminal()
  assert(ackMissing.continuationDiagnosis=="continuation_bridge_ack_missing")
  var triggerNotReached=ChatCheckStageTelemetry();triggerNotReached.continuationSelected=true;triggerNotReached.continuationBridgeCallbackResult="accepted";triggerNotReached.continuationBridgeSuccess="yes";triggerNotReached.diagnoseContinuationAtTerminal()
  assert(triggerNotReached.continuationDiagnosis=="continuation_trigger_not_reached")
  var responseMissing=ChatCheckStageTelemetry();responseMissing.continuationSelected=true;responseMissing.continuationBridgeCallbackResult="accepted";responseMissing.continuationBridgeSuccess="yes";responseMissing.continuationTriggerAttempted=true;responseMissing.continuationTriggerResult="yes";responseMissing.continuationHistoryRequests=1;responseMissing.diagnoseContinuationAtTerminal()
  assert(responseMissing.continuationDiagnosis=="continuation_history_response_missing")
  var responseObserverMissed=ChatCheckStageTelemetry();responseObserverMissed.continuationSelected=true;responseObserverMissed.continuationBridgeCallbackResult="accepted";responseObserverMissed.continuationBridgeSuccess="yes";responseObserverMissed.continuationTriggerAttempted=true;responseObserverMissed.continuationTriggerResult="yes";responseObserverMissed.continuationHistoryRequests=1
  responseObserverMissed.continuationBaselinePages=12;responseObserverMissed.continuationBaselineMessages=743
  responseObserverMissed.observeContinuationPage(sequence:13,messageCount:800,olderUniqueMessages:57,now:Date(timeIntervalSince1970:2000))
  responseObserverMissed.diagnoseContinuationAtTerminal()
  assert(responseObserverMissed.continuationDiagnosis=="continuation_response_observer_missed_progress")
  var noNetworkNoPage=ChatCheckStageTelemetry();noNetworkNoPage.continuationSelected=true;noNetworkNoPage.continuationBridgeCallbackResult="accepted";noNetworkNoPage.continuationBridgeSuccess="yes";noNetworkNoPage.continuationTriggerAttempted=true;noNetworkNoPage.continuationTriggerResult="yes";noNetworkNoPage.diagnoseContinuationAtTerminal()
  assert(noNetworkNoPage.continuationDiagnosis=="continuation_trigger_no_history_request")
  var noProgressStages=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:300))
  noProgressStages.enter("navigation_started",now:Date(timeIntervalSince1970:301))
  noProgressStages.stageBeforeFinish="chat_check_no_progress"
  noProgressStages.enter("chat_check_finished",now:Date(timeIntervalSince1970:302))
  let noProgressReport=noProgressStages.report(ordinal:2,terminal:"Failed · no_progress · navigation",now:Date(timeIntervalSince1970:303))
  assert(noProgressReport.contains("last stage chat_check_no_progress") && noProgressReport.contains("hooks unobserved"))
  var replayOnlyTiming=ChatCheckTimingTelemetry(now:Date(timeIntervalSince1970:1000))
  replayOnlyTiming.initialAggregateMessages=759
  replayOnlyTiming.recordHistoryRequest(at:Date(timeIntervalSince1970:1001))
  replayOnlyTiming.recordHistoryResponse(at:Date(timeIntervalSince1970:1002))
  for offset in 0..<10 {
   replayOnlyTiming.recordContinuationResponse(["pageDirection":"older","itemCount":12,"newIdentityCount":0,
    "identityProvenanceCounts":["known_from_checkpoint_cache":12],"accepted":true],at:Date(timeIntervalSince1970:1010+Double(offset)))
  }
  replayOnlyTiming.beginContinuation(at:Date(timeIntervalSince1970:1008))
  replayOnlyTiming.markTimeout(at:Date(timeIntervalSince1970:1068),hasPreviousPage:true,aggregateMessages:759)
  let replayOnlyReport=replayOnlyTiming.report(now:Date(timeIntervalSince1970:1068))
  assert(replayOnlyTiming.continuationCachedReplayPages==10 && replayOnlyTiming.continuationCachedReplayItems==120)
  assert(replayOnlyTiming.timeoutPhase=="cached_replay" && !replayOnlyTiming.timeoutPaginationActiveWithin10Seconds)
  assert(replayOnlyReport.contains("cached replay corridor 10 pages · 120 items"))
  assert(replayOnlyReport.contains("per_chat_timeout_fired=68000ms") && !replayOnlyReport.contains("technical-id"))

  var replayThenProgressTiming=ChatCheckTimingTelemetry(now:Date(timeIntervalSince1970:2000))
  replayThenProgressTiming.initialAggregateMessages=759
  replayThenProgressTiming.recordFirstPassPage(replay:true,knownItems:753,newIdentityTotal:0,progress:false,at:Date(timeIntervalSince1970:2001))
  replayThenProgressTiming.markFirstPassEnded(at:Date(timeIntervalSince1970:2005))
  replayThenProgressTiming.beginContinuation(at:Date(timeIntervalSince1970:2010))
  replayThenProgressTiming.continuationBaselineMessages=759
  for offset in 0..<10 {
   replayThenProgressTiming.recordContinuationResponse(["pageDirection":"older","itemCount":12,"newIdentityCount":0,
    "identityProvenanceCounts":["known_from_checkpoint_cache":12],"accepted":true],at:Date(timeIntervalSince1970:2011+Double(offset)))
  }
  replayThenProgressTiming.recordContinuationResponse(["pageDirection":"older","itemCount":20,"newIdentityCount":20,
   "identityProvenanceCounts":["genuinely_new":20],"accepted":true],at:Date(timeIntervalSince1970:2022))
  replayThenProgressTiming.recordContinuationAggregateProgress(olderUniqueMessages:20,at:Date(timeIntervalSince1970:2023))
  replayThenProgressTiming.recordContinuationResponse(["pageDirection":"older","itemCount":12,"newIdentityCount":0,
   "identityProvenanceCounts":["known_from_checkpoint_cache":12],"accepted":true],at:Date(timeIntervalSince1970:2024))
  replayThenProgressTiming.recordContinuationAggregateProgress(olderUniqueMessages:20,at:Date(timeIntervalSince1970:2025))
  replayThenProgressTiming.markTimeout(at:Date(timeIntervalSince1970:2026),hasPreviousPage:true,aggregateMessages:779)
  let progressTimingReport=replayThenProgressTiming.report(now:Date(timeIntervalSince1970:2026))
  assert(replayThenProgressTiming.firstPassCachedReplayPages==1 && replayThenProgressTiming.firstPassCachedReplayItems==753)
  assert(replayThenProgressTiming.continuationCachedReplayPages==10 && replayThenProgressTiming.continuationNewHistoryPages==1 && replayThenProgressTiming.continuationNewIdentities==20)
  assert(replayThenProgressTiming.timeoutPhase=="genuine_history_progress" && replayThenProgressTiming.timeoutAggregateDelta==20)
  assert(replayThenProgressTiming.lastProgressAt==Date(timeIntervalSince1970:2024))
  assert(progressTimingReport.contains("first pass elapsed 5000 ms") && progressTimingReport.contains("continuation available/elapsed 60000/16000 ms"))
  assert(progressTimingReport.contains("20.0% of 60000 ms budget") && progressTimingReport.contains("pagination active in last 5/10 s yes/yes"))
  assert(replayThenProgressTiming.timeoutProgressWithin5Seconds && replayThenProgressTiming.timeoutProgressWithin10Seconds)
  assert(replayThenProgressTiming.timeoutPhase != "cached_replay")

  var boundedTiming=ChatCheckTimingTelemetry(now:Date(timeIntervalSince1970:3000))
  boundedTiming.recordHistoryRequest(at:Date(timeIntervalSince1970:4000))
  boundedTiming.markTimeout(at:Date(timeIntervalSince1970:4000),hasPreviousPage:false,aggregateMessages:0)
  assert(boundedTiming.report(now:Date(timeIntervalSince1970:4000)).contains("check_started=0ms"))
  assert(!boundedTiming.report(now:Date(timeIntervalSince1970:4000)).contains("check_started=1000000ms"))

  var pagination=ChatPaginationProgressTracker()
  pagination.begin(at:Date(timeIntervalSince1970:500))
  let page1=pagination.observe(messageIDs:["private-message-a","private-message-b"],messageCount:2,pageNumber:1,hasPreviousPage:true,now:Date(timeIntervalSince1970:501))
  let page2=pagination.observe(messageIDs:["private-message-a","private-message-b","private-message-c"],messageCount:3,pageNumber:2,hasPreviousPage:true,now:Date(timeIntervalSince1970:502))
  assert(page1.progressTokenUnique && page1.newlyAddedMessages==2 && page1.messagesBefore==0 && page1.messagesAfter==2)
  assert(page2.progressTokenUnique && page2.newlyAddedMessages==1 && page2.responseDurationMs==1000)
  assert(pagination.uniqueProgressingPages==2 && pagination.progressing && !pagination.shouldStopForNoProgress)
  var repeatedPagination=ChatPaginationProgressTracker()
  repeatedPagination.begin(at:Date(timeIntervalSince1970:600))
  _=repeatedPagination.observe(messageIDs:["private-message-a"],messageCount:1,pageNumber:1,hasPreviousPage:true,now:Date(timeIntervalSince1970:601))
  let repeatedPage2=repeatedPagination.observe(messageIDs:["private-message-a"],messageCount:1,pageNumber:2,hasPreviousPage:true,now:Date(timeIntervalSince1970:602))
  assert(!repeatedPagination.shouldStopForNoProgress)
  let repeatedPage3=repeatedPagination.observe(messageIDs:["private-message-a"],messageCount:1,pageNumber:3,hasPreviousPage:true,now:Date(timeIntervalSince1970:603))
  let shouldStopAfterPage3=repeatedPagination.shouldStopForNoProgress
  let repeatedPage4=repeatedPagination.observe(messageIDs:["private-message-a"],messageCount:1,pageNumber:4,hasPreviousPage:true,now:Date(timeIntervalSince1970:604))
  assert(!repeatedPage2.progressTokenUnique && !repeatedPage2.repeatedProgressToken && !repeatedPage2.repeatedPage && repeatedPage2.noProgress)
  assert(repeatedPage3.repeatedProgressToken && !shouldStopAfterPage3)
  assert(repeatedPage4.repeatedProgressToken && repeatedPagination.shouldStopForNoProgress)
  assert(!repeatedPage4.safeSummary().contains("private-message"))
  assert(repeatedPagination.uniqueProgressingPages==1)
  var oldHistoryPagination=ChatPaginationProgressTracker(initialMessageIDs:["saved"],initialMessageCount:1)
  _=oldHistoryPagination.observe(messageIDs:["saved","old-a"],messageCount:2,pageNumber:1,hasPreviousPage:true,activityMinimum:200,activityMaximum:300,pageDirection:"first_page",uniqueBaselineMessages:1,now:Date(timeIntervalSince1970:700))
  _=oldHistoryPagination.observe(messageIDs:["saved","old-a","old-b"],messageCount:3,pageNumber:2,hasPreviousPage:true,activityMinimum:100,activityMaximum:190,pageDirection:"older",uniqueBaselineMessages:2,olderHistoryProgressObserved:true,now:Date(timeIntervalSince1970:701))
  assert(oldHistoryPagination.olderHistoryProgressObserved && oldHistoryPagination.olderUniqueBaselineMessageCount==2)
  _=oldHistoryPagination.observe(messageIDs:["saved","old-a","old-b"],messageCount:3,pageNumber:3,hasPreviousPage:true,activityMinimum:100,activityMaximum:190,pageDirection:"not_older",uniqueBaselineMessages:2,pageFingerprint:"repeat-a",pageReplay:true,now:Date(timeIntervalSince1970:702))
  _=oldHistoryPagination.observe(messageIDs:["saved","old-a","old-b"],messageCount:3,pageNumber:4,hasPreviousPage:true,activityMinimum:100,activityMaximum:190,pageDirection:"not_older",uniqueBaselineMessages:2,pageFingerprint:"repeat-a",pageReplay:true,now:Date(timeIntervalSince1970:703))
  _=oldHistoryPagination.observe(messageIDs:["saved","old-a","old-b"],messageCount:3,pageNumber:5,hasPreviousPage:true,activityMinimum:100,activityMaximum:190,pageDirection:"not_older",uniqueBaselineMessages:2,pageFingerprint:"repeat-a",pageReplay:true,now:Date(timeIntervalSince1970:704))
  assert(oldHistoryPagination.shouldStopForNoProgress && !oldHistoryPagination.currentlyProgressing && oldHistoryPagination.olderHistoryProgressObserved)
  assert(chatCheckContinuationEligible(terminal:"Partial · pagination_no_progress",replayProgressObserved:true,newHistoryProgressObserved:false,uniqueMessagesBeyondBaseline:0,hasPreviousPage:true,historyComplete:false,routeUnchanged:true,documentIdentityValid:true,frontierTimestamp:100,continuationAlreadyUsed:false,renderLeaseAvailable:true))
  assert(chatCheckContinuationEligible(terminal:"Timed out · per_chat_timeout · pagination",replayProgressObserved:false,newHistoryProgressObserved:true,uniqueMessagesBeyondBaseline:4,hasPreviousPage:true,historyComplete:false,routeUnchanged:true,documentIdentityValid:true,frontierTimestamp:100,continuationAlreadyUsed:false,renderLeaseAvailable:true))
  assert(!chatCheckContinuationEligible(terminal:"Partial · pagination_no_progress",replayProgressObserved:false,newHistoryProgressObserved:false,uniqueMessagesBeyondBaseline:4,hasPreviousPage:true,historyComplete:false,routeUnchanged:true,documentIdentityValid:true,frontierTimestamp:100,continuationAlreadyUsed:false,renderLeaseAvailable:true))
  assert(!chatCheckContinuationEligible(terminal:"Partial · pagination_no_progress",replayProgressObserved:false,newHistoryProgressObserved:true,uniqueMessagesBeyondBaseline:0,hasPreviousPage:true,historyComplete:false,routeUnchanged:true,documentIdentityValid:true,frontierTimestamp:100,continuationAlreadyUsed:false,renderLeaseAvailable:true))
  assert(!chatCheckContinuationEligible(terminal:"Partial · pagination_no_progress",replayProgressObserved:true,newHistoryProgressObserved:false,uniqueMessagesBeyondBaseline:0,hasPreviousPage:false,historyComplete:false,routeUnchanged:true,documentIdentityValid:true,frontierTimestamp:100,continuationAlreadyUsed:false,renderLeaseAvailable:true))
  assert(!chatCheckContinuationEligible(terminal:"Complete",replayProgressObserved:true,newHistoryProgressObserved:true,uniqueMessagesBeyondBaseline:4,hasPreviousPage:true,historyComplete:true,routeUnchanged:true,documentIdentityValid:true,frontierTimestamp:100,continuationAlreadyUsed:false,renderLeaseAvailable:true))
  assert(!chatCheckContinuationEligible(terminal:"Partial · pagination_no_progress",replayProgressObserved:true,newHistoryProgressObserved:false,uniqueMessagesBeyondBaseline:0,hasPreviousPage:true,historyComplete:false,routeUnchanged:false,documentIdentityValid:true,frontierTimestamp:100,continuationAlreadyUsed:false,renderLeaseAvailable:true))
  assert(!chatCheckContinuationEligible(terminal:"Partial · pagination_no_progress",replayProgressObserved:true,newHistoryProgressObserved:false,uniqueMessagesBeyondBaseline:0,hasPreviousPage:true,historyComplete:false,routeUnchanged:true,documentIdentityValid:false,frontierTimestamp:100,continuationAlreadyUsed:false,renderLeaseAvailable:true))
  assert(!chatCheckContinuationEligible(terminal:"Partial · pagination_no_progress",replayProgressObserved:true,newHistoryProgressObserved:false,uniqueMessagesBeyondBaseline:0,hasPreviousPage:true,historyComplete:false,routeUnchanged:true,documentIdentityValid:true,frontierTimestamp:100,continuationAlreadyUsed:true,renderLeaseAvailable:true))
  assert(!chatCheckContinuationEligible(terminal:"Partial · pagination_no_progress",replayProgressObserved:true,newHistoryProgressObserved:false,uniqueMessagesBeyondBaseline:0,hasPreviousPage:true,historyComplete:false,routeUnchanged:true,documentIdentityValid:true,frontierTimestamp:nil,continuationAlreadyUsed:false,renderLeaseAvailable:true))
  var replayPagination=ChatPaginationProgressTracker(initialMessageIDs:["p1a","p1b","p2a","p2b","p3a","p3b"],initialMessageCount:6)
  _=replayPagination.observe(messageIDs:["p1a","p1b","p2a","p2b","p3a","p3b"],messageCount:6,pageNumber:1,hasPreviousPage:true,activityMinimum:100,activityMaximum:200,pageFingerprint:"page-1",pageReplay:true,now:Date(timeIntervalSince1970:800))
  let replay2=replayPagination.observe(messageIDs:["p1a","p1b","p2a","p2b","p3a","p3b"],messageCount:6,pageNumber:2,hasPreviousPage:true,activityMinimum:70,activityMaximum:90,pageDirection:"older",pageFingerprint:"page-2",pageReplay:true,now:Date(timeIntervalSince1970:801))
  let replay3=replayPagination.observe(messageIDs:["p1a","p1b","p2a","p2b","p3a","p3b"],messageCount:6,pageNumber:3,hasPreviousPage:true,activityMinimum:40,activityMaximum:60,pageDirection:"older",pageFingerprint:"page-3",pageReplay:true,now:Date(timeIntervalSince1970:802))
  assert(replay2.replayProgressObserved && replay3.replayProgressObserved && replayPagination.replayPagesProgressed==2)
  assert(!replayPagination.shouldStopForNoProgress && replayPagination.replayingSavedBoundary)
  _=replayPagination.observe(messageIDs:["p1a","p1b","p2a","p2b","p3a","p3b"],messageCount:6,pageNumber:4,hasPreviousPage:true,activityMinimum:40,activityMaximum:60,pageFingerprint:"page-3",pageReplay:true,now:Date(timeIntervalSince1970:803))
  _=replayPagination.observe(messageIDs:["p1a","p1b","p2a","p2b","p3a","p3b"],messageCount:6,pageNumber:5,hasPreviousPage:true,activityMinimum:40,activityMaximum:60,pageFingerprint:"page-3",pageReplay:true,now:Date(timeIntervalSince1970:804))
  _=replayPagination.observe(messageIDs:["p1a","p1b","p2a","p2b","p3a","p3b"],messageCount:6,pageNumber:6,hasPreviousPage:true,activityMinimum:40,activityMaximum:60,pageFingerprint:"page-3",pageReplay:true,now:Date(timeIntervalSince1970:805))
  assert(replayPagination.shouldStopForNoProgress && replayPagination.replayProgressObserved)
  let budgetStart=Date(timeIntervalSince1970:100)
  let budgetCycleDeadline=Date(timeIntervalSince1970:1000)
  func budgetDecision(genuine:Bool=true,genuineAge:Int?=1000,replayAge:Int?=nil,hasPrevious:Bool?=true,
                      pool:Int=60000,absolute:Int=60000,cycle:Int=60000,cap:Bool=false,terminal:Bool=false)->BudgetExtensionDecision {
   decideBudgetExtension(BudgetExtensionDecisionInput(elapsedMs:60000,phase:"genuine_history",hasPreviousPage:hasPrevious,
    genuineProgressEver:genuine,genuineProgressAgeMs:genuineAge,replayProgressAgeMs:replayAge,
    extensionPoolRemainingMs:pool,absoluteTimeRemainingMs:absolute,cycleBudgetRemainingMs:cycle,absoluteCapReached:cap,checkAlreadyTerminal:terminal))
  }
  let freshGenuineDecision=budgetDecision()
  assert(freshGenuineDecision.state == .granted && freshGenuineDecision.grantedAmountMs==30000)
  assert(freshGenuineDecision.reason=="fresh_genuine_progress_with_previous_page")
  assert(freshGenuineDecision.progressLast5Seconds && freshGenuineDecision.progressLast10Seconds)
  let replayOnlyDecision=budgetDecision(genuine:false,genuineAge:nil,replayAge:1000)
  assert(replayOnlyDecision.state == .denied && replayOnlyDecision.reason=="no_genuine_history_progress")
  assert(replayOnlyDecision.replayProgressRecent && replayOnlyDecision.anyPaginationProgressRecent)
  let staleDecision=budgetDecision(genuineAge:10001)
  assert(staleDecision.state == .denied && staleDecision.reason=="genuine_progress_stale")
  let noPreviousDecision=budgetDecision(hasPrevious:false)
  assert(noPreviousDecision.state == .denied && noPreviousDecision.reason=="has_previous_page_false")
  let poolExhaustedDecision=budgetDecision(pool:0)
  assert(poolExhaustedDecision.state == .denied && poolExhaustedDecision.reason=="extension_pool_exhausted")
  let absoluteCapDecision=budgetDecision(absolute:0,cap:true)
  assert(absoluteCapDecision.state == .denied && absoluteCapDecision.reason=="absolute_cap_reached")
  let cycleBudgetDecision=budgetDecision(cycle:0)
  assert(cycleBudgetDecision.state == .denied && cycleBudgetDecision.reason=="cycle_budget_insufficient")
  let terminalDecision=budgetDecision(terminal:true)
  assert(terminalDecision.state == .denied && terminalDecision.reason=="check_already_terminal")
  assert([freshGenuineDecision,replayOnlyDecision,staleDecision,noPreviousDecision,poolExhaustedDecision,absoluteCapDecision,cycleBudgetDecision,terminalDecision].allSatisfy{$0.isInternallyConsistent})
  assert(BudgetExtensionDecisionState.notEvaluated.rawValue=="not_evaluated")
  let replayBudget=ChatCheckBudgetController(checkStartedAt:budgetStart,cycleDeadline:budgetCycleDeadline)
  assert(replayBudget.snapshot(at:Date(timeIntervalSince1970:159)).decisions.isEmpty)
  replayBudget.observe(hasPreviousPage:true,genuineOlderProgress:false,cachedReplay:true,at:Date(timeIntervalSince1970:159.9))
  if case .timeout(let reason)=replayBudget.evaluate(at:Date(timeIntervalSince1970:160)) {assert(reason=="timeout_during_cached_replay")}
  else {assertionFailure("cached replay must not extend the base budget")}
  assert(replayBudget.snapshot(at:Date(timeIntervalSince1970:160)).extensionAmountMs==0)

  let progressingBudget=ChatCheckBudgetController(checkStartedAt:budgetStart,cycleDeadline:budgetCycleDeadline)
  progressingBudget.observe(hasPreviousPage:true,genuineOlderProgress:true,cachedReplay:false,at:Date(timeIntervalSince1970:159.9))
  if case .extended=progressingBudget.evaluate(at:Date(timeIntervalSince1970:160)) {} else {assertionFailure("fresh older progress should grant a bounded extension")}
  assert(progressingBudget.snapshot(at:Date(timeIntervalSince1970:160)).extensionAmountMs==30000)
  assert(progressingBudget.snapshot(at:Date(timeIntervalSince1970:160)).decisions.first?.state == .granted)
  progressingBudget.observe(hasPreviousPage:true,genuineOlderProgress:true,cachedReplay:false,at:Date(timeIntervalSince1970:189.9))
  if case .extended=progressingBudget.evaluate(at:Date(timeIntervalSince1970:190)) {} else {assertionFailure("fresh progress should grant the remaining shared extension")}
  assert(progressingBudget.snapshot(at:Date(timeIntervalSince1970:190)).extensionAmountMs==60000)
  if case .timeout(let reason)=progressingBudget.evaluate(at:Date(timeIntervalSince1970:220)) {assert(reason=="timeout_absolute_cap")}
  else {assertionFailure("per-pass hard cap must terminate even during progress")}

  let staleProgressBudget=ChatCheckBudgetController(checkStartedAt:budgetStart,cycleDeadline:budgetCycleDeadline)
  staleProgressBudget.observe(hasPreviousPage:true,genuineOlderProgress:true,cachedReplay:false,at:Date(timeIntervalSince1970:149))
  if case .timeout(let reason)=staleProgressBudget.evaluate(at:Date(timeIntervalSince1970:160)) {assert(reason=="timeout_no_recent_progress")}
  else {assertionFailure("stale progress must not extend the budget")}
  let noPreviousPageBudget=ChatCheckBudgetController(checkStartedAt:budgetStart,cycleDeadline:budgetCycleDeadline)
  noPreviousPageBudget.observe(hasPreviousPage:false,genuineOlderProgress:true,cachedReplay:false,at:Date(timeIntervalSince1970:159.9))
  if case .timeout(let reason)=noPreviousPageBudget.evaluate(at:Date(timeIntervalSince1970:160)) {assert(reason=="timeout_during_genuine_history_progress")}
  else {assertionFailure("no previous page must prevent extension while preserving the active-progress reason")}

  let sharedChatBudget=ChatCheckBudgetController(checkStartedAt:budgetStart,cycleDeadline:budgetCycleDeadline)
  sharedChatBudget.observe(hasPreviousPage:true,genuineOlderProgress:true,cachedReplay:false,at:Date(timeIntervalSince1970:159.9))
  _=sharedChatBudget.evaluate(at:Date(timeIntervalSince1970:160))
  sharedChatBudget.observe(hasPreviousPage:true,genuineOlderProgress:true,cachedReplay:false,at:Date(timeIntervalSince1970:189.9))
  _=sharedChatBudget.evaluate(at:Date(timeIntervalSince1970:190))
  _=sharedChatBudget.evaluate(at:Date(timeIntervalSince1970:220))
  sharedChatBudget.beginContinuation(at:Date(timeIntervalSince1970:220),baseBudgetMs:60000)
  let sharedContinuation=sharedChatBudget.snapshot(at:Date(timeIntervalSince1970:220))
  assert(sharedContinuation.absoluteDeadline==Date(timeIntervalSince1970:280))
  assert(sharedContinuation.absoluteDeadline<=budgetStart.addingTimeInterval(180))
  assert(sharedContinuation.extensionAmountMs==60000)

  assert(chatCheckContinuationEligible(terminal:"Partial · pagination_no_progress",replayProgressObserved:replayPagination.replayProgressObserved,newHistoryProgressObserved:false,uniqueMessagesBeyondBaseline:0,hasPreviousPage:true,historyComplete:false,routeUnchanged:true,documentIdentityValid:true,frontierTimestamp:40,continuationAlreadyUsed:false,renderLeaseAvailable:true))
  var topOnlyPagination=ChatPaginationProgressTracker(initialMessageIDs:["saved-a","saved-b"],initialMessageCount:2)
  let topOnlyPage=topOnlyPagination.observe(messageIDs:["saved-a","saved-b","current-new"],messageCount:3,pageNumber:1,hasPreviousPage:true,activityMinimum:300,activityMaximum:400,pageDirection:"first_page",pageFingerprint:"top-only",pageReplay:false,now:Date(timeIntervalSince1970:900))
  assert(!topOnlyPage.replayProgressObserved && !topOnlyPage.olderHistoryProgressObserved)
  assert(!chatCheckContinuationEligible(terminal:"Partial · pagination_no_progress",replayProgressObserved:topOnlyPagination.replayProgressObserved,newHistoryProgressObserved:topOnlyPagination.olderHistoryProgressObserved,uniqueMessagesBeyondBaseline:1,hasPreviousPage:true,historyComplete:false,routeUnchanged:true,documentIdentityValid:true,frontierTimestamp:300,continuationAlreadyUsed:false,renderLeaseAvailable:true))
  var observedHookStages=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:400))
  observedHookStages.hookHealthRecorded=true
  observedHookStages.hookInstalled=true;observedHookStages.fetchHookActive=true
  observedHookStages.xhrHookActive=true;observedHookStages.generationAttached=true
  assert(observedHookStages.report(ordinal:3,terminal:"Complete",now:Date(timeIntervalSince1970:401)).contains("hooks activity yes, fetch yes, XHR yes, generation yes"))
  let freshChatStages=ChatCheckStageTelemetry(now:Date(timeIntervalSince1970:200))
  assert(freshChatStages.historyRequests==0 && freshChatStages.historyResponses==0 && freshChatStages.pagesObserved==0 && !freshChatStages.routeReached && !freshChatStages.rateLimitSeen)
  enum Failure: Error {case simulated}
  var outcomes=[String]()
  let terminalFixture=[String](repeating:"Complete",count:7)+["Partial · pagination_no_progress","Partial · no_progress · waiting_history","Partial · pagination_no_progress"]+["per_chat_timeout · pagination_progressing","per_chat_timeout · pagination_progressing"]
  let summaryFixture=CycleChatOutcomeCounts(finalPerChatResults:terminalFixture,freshRiskCounts:["Normal":6,"Watch":1,"Near":0,"Critical":0,"Unknown":5])
  assert(summaryFixture.checked==12 && summaryFixture.complete==7 && summaryFixture.partial==3 && summaryFixture.failed==2)
  assert(summaryFixture.freshRiskUnknown==5)
  for id in ["first","failed","last"] {
   let result=try await isolateCheck {if id=="failed" {throw Failure.simulated};return id}
   switch result {case .success(let value):outcomes.append(value);case .failure:outcomes.append("Failed")}
  }
  assert(outcomes==["first","Failed","last"])
  let rawAggregate = """
  {"conversationId":"a","title":"A","processedMessageIds":["technical-id"],"messagesCollected":1,"userMessages":1,"assistantMessages":0,"otherMessages":0,"estimatedTextTokens":5,"attachments":{"images":1,"audio":0,"video":0,"files":0,"url":"PRIVATE"},"historyComplete":true,"responsesCaptured":1,"content":"PRIVATE","snippet":"PRIVATE","asset_pointer":"PRIVATE"}
  """.data(using:.utf8)!
  let safe=try JSONDecoder().decode(SafeAggregate.self,from:rawAggregate)
  let stored=String(data:try JSONEncoder().encode(safe),encoding:.utf8)!
  assert(!stored.contains("PRIVATE") && stored.contains("technical-id"))
  do {let _:Result<Int,Error>=try await isolateCheck {throw CancellationError()};assertionFailure("cancellation swallowed")} catch is CancellationError {} 
  print("Cycle model: ordering, fixed cutoff, coverage states, queue, gate and persistence passed")
 }
}

import CryptoKit
import Foundation

struct DiagnosticOperationGenerationGate {
 private(set) var activeGeneration:UUID?
 var isActive:Bool { activeGeneration != nil }
 mutating func begin()->UUID {
  let generation=UUID()
  activeGeneration=generation
  return generation
 }
 mutating func tryBegin()->UUID? {
  guard activeGeneration==nil else{return nil}
  return begin()
 }
 func owns(_ generation:UUID)->Bool { activeGeneration==generation }
 mutating func finish(_ generation:UUID)->Bool {
  guard owns(generation) else{return false}
  activeGeneration=nil
  return true
 }
}

struct RescueOperationGenerationGate {
 private(set) var activeGeneration:UUID?
 var isActive:Bool { activeGeneration != nil }
 mutating func begin()->UUID? {
  guard activeGeneration==nil else{return nil}
  let generation=UUID();activeGeneration=generation;return generation
 }
 func owns(_ generation:UUID)->Bool { activeGeneration==generation }
 mutating func finish(_ generation:UUID)->Bool {
  guard owns(generation) else{return false}
  activeGeneration=nil;return true
 }
}

let showChatTitlesInNotificationsDefaultsKey="showChatTitlesInNotifications"
func showChatTitlesInNotifications(storedValue:Bool?)->Bool { storedValue ?? true }
func nativeRescueSummary(complete:Bool,messageCount:Int,reason:String,scrollRestored:Bool)->String {
 let outcome=complete ? "Complete":"Partial"
 return "\(outcome) · \(max(0,messageCount)) messages · \(reason) · scroll restore \(scrollRestored ? "yes":"no")"
}
func nativeRescueSavedStatus(summary:String,textSaved:Bool)->String {
 "Native Rescue: \(summary) · \(textSaved ? "HTML/TXT saved locally":"HTML saved; TXT skipped")"
}
struct CycleChatOutcomeCounts {
 var complete=0
 var partial=0
 var failed=0
 let freshRiskUnknown:Int
 init(finalPerChatResults:[String],freshRiskCounts:[String:Int]) {
  for result in finalPerChatResults {
   if result=="Complete" || result.hasPrefix("Complete ·") {complete+=1}
   else if result=="Partial" || result.hasPrefix("Partial ·") {partial+=1}
   else {failed+=1}
  }
  freshRiskUnknown=freshRiskCounts["Unknown",default:0]
 }
 var checked:Int {complete+partial+failed}
}

struct RootDiscoveryEvidence {
 var triggerStarted=false
 var loadReturnedNavigation=false
 var navigationObserved=false
 var triggerFailed=false
 var hookHealthAvailable=false
 var hookObjectPresent=false
 var fetchHookActive=false
 var xhrOpenHookActive=false
 var xhrSendHookActive=false
 var generationAttached=false
 var hookRequests=0
 var hookResponses=0
 var recognizedResponses=0
 var resourceRequests=0
 var resourceResponses=0
 var postTriggerConversationLinks=0
}
func rootDiscoveryTerminalReason(_ e:RootDiscoveryEvidence)->String {
 guard e.triggerStarted else{return "root_trigger_not_started"}
 guard !e.triggerFailed,e.loadReturnedNavigation else{return "root_trigger_failed"}
 guard e.navigationObserved else{return "root_navigation_not_observed"}
 if e.hookHealthAvailable && (!e.hookObjectPresent || !e.fetchHookActive || !e.xhrOpenHookActive || !e.xhrSendHookActive) {return "root_list_hook_detached"}
 if e.hookRequests==0 && e.resourceRequests>0 {
  return e.resourceResponses>0 ? "root_response_unobserved_by_hook":"root_list_hook_missed_request"
 }
 if e.hookRequests>0 && e.hookResponses==0 && e.resourceResponses>0 {return "root_response_unobserved_by_hook"}
 if e.hookRequests>0 && e.hookResponses==0 {return "root_request_without_response"}
 if e.hookResponses>0 {return e.recognizedResponses>0 ? "root_discovery_observed":"root_response_unclassified"}
 if e.hookRequests==0 && e.resourceRequests==0 && e.hookResponses==0 && e.resourceResponses==0 {
  if e.postTriggerConversationLinks>0{return "root_ui_data_without_network_response"}
  guard e.hookHealthAvailable else{return "root_list_hook_health_unavailable"}
  guard e.generationAttached else{return "root_list_operation_not_attached"}
  return "root_trigger_no_network_activity"
 }
 return "root_trigger_no_network_activity"
}
func pinnedActivityEventMatches(_ event:[String:Any],expectedConversationID:String,expectedOwner:String,expectedGeneration:String)->Bool {
 guard let conversationID=event["conversationId"] as? String,conversationID==expectedConversationID,
       let family=event["endpointFamily"] as? String,["conversation_messages","conversation_detail","root_conversation_list","project_conversation_list","conversation_related_other"].contains(family),
       let owner=event["operationOwner"] as? String,owner==expectedOwner,
       let generation=event["operationGeneration"] as? String,generation==expectedGeneration,
       let status=event["httpStatus"] as? Int,(200...299).contains(status) || status==429 else{return false}
 return true
}
func pinnedNavigationNoEffect(urlChanged:Bool,isLoading:Bool,progressChanged:Bool,elapsed:TimeInterval,minimumObservation:TimeInterval=2)->Bool {
 !urlChanged && !isLoading && !progressChanged && elapsed>=minimumObservation
}
func pinnedNavigationTargetAlreadyLoaded(currentConversationID:String?,expectedConversationID:String)->Bool {
 currentConversationID != nil && currentConversationID==expectedConversationID
}
func pinnedNavigationStalled(isLoading:Bool,progressChanged:Bool,targetReached:Bool,elapsed:TimeInterval,deadline:TimeInterval)->Bool {
 !targetReached && (isLoading || progressChanged) && elapsed>=deadline
}
func pinnedNavigationObservationClassification(urlMatchesTarget:Bool,urlChanged:Bool,isLoading:Bool,progressChanged:Bool,elapsed:TimeInterval,noEffectAfter:TimeInterval=2,finalAfter:TimeInterval=5)->String? {
 if urlMatchesTarget {return "navigation_route_reached"}
 if !urlChanged && !isLoading && !progressChanged && elapsed>=noEffectAfter {return "navigation_load_no_effect"}
 if (urlChanged || isLoading || progressChanged) && elapsed>=finalAfter {return "navigation_started_but_stalled"}
 return nil
}

struct ActivityObservationWindow {
 let generation:String
 let expectedConversationID:String
 let startedAtMs:Double
 func accepts(generation:String,receivedAtMs:Double,conversationID:String?)->Bool {
  generation==self.generation && receivedAtMs.isFinite && receivedAtMs>=startedAtMs && conversationID==expectedConversationID
 }
}

enum LastSeenUpdatedAtSource:String,Codable {
 case rootConversationUpdateTime="root_conversation_update_time"
 case projectConversationUpdateTime="project_conversation_update_time"
 case completeHistory="complete_history"
 case conversationActivityMetadata="conversation_activity_metadata"
 case legacyUnknown="legacy_unknown"
 static func fromActivitySource(_ value:String?)->LastSeenUpdatedAtSource {
  guard let value else{return .conversationActivityMetadata}
  if value=="root_conversation_update_time" || value=="root_conversation_list.update_time" {return .rootConversationUpdateTime}
  if value=="project_conversation_update_time" || value=="project_conversation_list.update_time" {return .projectConversationUpdateTime}
  if value=="complete_history" {return .completeHistory}
  return .conversationActivityMetadata
 }
 var isTrustedForRecentCoverage:Bool {
  switch self {case .rootConversationUpdateTime,.projectConversationUpdateTime,.completeHistory:return true
  case .conversationActivityMetadata,.legacyUnknown:return false}
 }
}
struct ChatRecord: Codable {
 var conversationId: String
 var title: String
 var lastSeenUpdatedAt: Double
 var lastSeenUpdatedAtSource:LastSeenUpdatedAtSource = .legacyUnknown
 var lastSeenUpdatedAtObservedAt:Double? = nil
 var lastCheckedUpdatedAt: Double? = nil
 var lastCheckAt: Double? = nil
 var lastCheckResult: String? = nil
 var aggregate: SafeAggregate? = nil
 // Manual labels stay local with the existing cycle record; no chat data enters the beta model.
 var calibrationLabel: String? = nil
 var lastRiskRank: Int? = nil
 var lastNotifiedRiskRank: Int? = nil
 var consecutiveIncompleteChecks = 0
 var lastUncertainNotificationAt: Double? = nil
 var uncertainSince:Double? = nil
 var uncertainAcknowledgedAt:Double? = nil
 var partialObservedActivityAt:Double? = nil
 var pendingActivityNeedsAttention=false
 var paginationBoundaryMessageCount:Int? = nil
 var forensicHistory:[ForensicHistoryEvent] = []
}
extension ChatRecord {
 private enum CodingKeys:String,CodingKey {case conversationId,title,lastSeenUpdatedAt,lastSeenUpdatedAtSource,lastSeenUpdatedAtObservedAt,lastCheckedUpdatedAt,lastCheckAt,lastCheckResult,aggregate,calibrationLabel,lastRiskRank,lastNotifiedRiskRank,consecutiveIncompleteChecks,lastUncertainNotificationAt,uncertainSince,uncertainAcknowledgedAt,partialObservedActivityAt,pendingActivityNeedsAttention,paginationBoundaryMessageCount,forensicHistory}
 init(from decoder:Decoder)throws {
  let c=try decoder.container(keyedBy:CodingKeys.self)
  conversationId=try c.decode(String.self,forKey:.conversationId);title=try c.decode(String.self,forKey:.title)
  lastSeenUpdatedAt=try c.decode(Double.self,forKey:.lastSeenUpdatedAt)
  let rawSource=try c.decodeIfPresent(String.self,forKey:.lastSeenUpdatedAtSource)
  lastSeenUpdatedAtSource=rawSource.flatMap(LastSeenUpdatedAtSource.init(rawValue:)) ?? .legacyUnknown
  lastSeenUpdatedAtObservedAt=try c.decodeIfPresent(Double.self,forKey:.lastSeenUpdatedAtObservedAt)
  lastCheckedUpdatedAt=try c.decodeIfPresent(Double.self,forKey:.lastCheckedUpdatedAt);lastCheckAt=try c.decodeIfPresent(Double.self,forKey:.lastCheckAt)
  lastCheckResult=try c.decodeIfPresent(String.self,forKey:.lastCheckResult);aggregate=try c.decodeIfPresent(SafeAggregate.self,forKey:.aggregate)
  calibrationLabel=try c.decodeIfPresent(String.self,forKey:.calibrationLabel);lastRiskRank=try c.decodeIfPresent(Int.self,forKey:.lastRiskRank)
  lastNotifiedRiskRank=try c.decodeIfPresent(Int.self,forKey:.lastNotifiedRiskRank)
  consecutiveIncompleteChecks=try c.decodeIfPresent(Int.self,forKey:.consecutiveIncompleteChecks) ?? 0
  lastUncertainNotificationAt=try c.decodeIfPresent(Double.self,forKey:.lastUncertainNotificationAt)
  uncertainSince=try c.decodeIfPresent(Double.self,forKey:.uncertainSince)
  uncertainAcknowledgedAt=try c.decodeIfPresent(Double.self,forKey:.uncertainAcknowledgedAt)
  partialObservedActivityAt=try c.decodeIfPresent(Double.self,forKey:.partialObservedActivityAt)
  pendingActivityNeedsAttention=try c.decodeIfPresent(Bool.self,forKey:.pendingActivityNeedsAttention) ?? false
  paginationBoundaryMessageCount=try c.decodeIfPresent(Int.self,forKey:.paginationBoundaryMessageCount)
  forensicHistory=try c.decodeIfPresent([ForensicHistoryEvent].self,forKey:.forensicHistory) ?? []
 }
}

enum ForensicAdmissionSource:String,Codable { case recent,staleIncompleteMaintenance="stale_incomplete_maintenance",excluded }
enum ForensicResult:String,Codable { case complete="Complete",partial="Partial",failed="Failed",skipped }
struct ForensicHistoryEvent:Codable,Equatable {
 var timestamp:Double
 let cycleTimestamp:Double
 var admissionSource:ForensicAdmissionSource
 var exclusionReason:String?
 var queued:Bool
 var checked:Bool
 var result:ForensicResult?
 mutating func refreshTimestamp(_ value:Double){timestamp=value}
}
func boundedForensicHistory(_ records:[String:ChatRecord],perChatLimit:Int=8,globalLimit:Int=500)->[String:ChatRecord] {
 var result=records
 for key in Array(result.keys) {if var record=result[key],record.forensicHistory.count>perChatLimit {record.forensicHistory=Array(record.forensicHistory.sorted{$0.timestamp<$1.timestamp}.suffix(perChatLimit));result[key]=record}}
 let all=result.flatMap{key,record in record.forensicHistory.map{(key,$0.timestamp)}}.sorted{$0.1<$1.1}
 if all.count>globalLimit {let removed=Set(all.prefix(all.count-globalLimit).map{"\($0.0)|\($0.1)"});for key in Array(result.keys) {if var record=result[key] {record.forensicHistory.removeAll{removed.contains("\(key)|\($0.timestamp)")};result[key]=record}}}
 return result
}
extension CycleState {
 mutating func updateForensicEvent(chatID:String,cycleTimestamp:Double,now:Double=Date().timeIntervalSince1970*1000,_ update:(inout ForensicHistoryEvent)->Void) {
  guard var record=records[chatID] else{return}
  if let index=record.forensicHistory.firstIndex(where:{$0.cycleTimestamp==cycleTimestamp}) {update(&record.forensicHistory[index]);record.forensicHistory[index].refreshTimestamp(now)}
  else {var event=ForensicHistoryEvent(timestamp:now,cycleTimestamp:cycleTimestamp,admissionSource:.excluded,exclusionReason:nil,queued:false,checked:false,result:nil);update(&event);if event.queued || event.checked || event.admissionSource == .excluded && event.exclusionReason != nil {record.forensicHistory.append(event)}else{return}}
  records[chatID]=record;records=boundedForensicHistory(records)
 }
}
func mergingForensicHistory(from current:ChatRecord?,into saved:inout ChatRecord) {
 guard let current else{return};saved.forensicHistory=current.forensicHistory
}

struct CachedActivityProvenanceSummary {
 let records:Int;let timestamps:Int;let trusted:Int;let legacyOrUnknown:Int;let freshObservations:Int;let staleObservations:Int
}
func cachedActivityProvenanceSummary(_ records:[ChatRecord],now:Double)->CachedActivityProvenanceSummary {
 let valid=records.filter{$0.lastSeenUpdatedAt.isFinite && $0.lastSeenUpdatedAt>0}
 let fresh=valid.filter{record in guard let observed=record.lastSeenUpdatedAtObservedAt,observed.isFinite else{return false};return observed<=now && observed>=now-21600000}
 return CachedActivityProvenanceSummary(records:records.count,timestamps:valid.count,
  trusted:valid.filter{$0.lastSeenUpdatedAtSource.isTrustedForRecentCoverage}.count,
  legacyOrUnknown:valid.filter{!$0.lastSeenUpdatedAtSource.isTrustedForRecentCoverage}.count,
  freshObservations:fresh.count,staleObservations:valid.count-fresh.count)
}
struct SafeAggregate: Codable {
 var conversationId: String
 var title: String
 var processedMessageIds: [String]
 var messagesCollected: Int
 var userMessages: Int
 var assistantMessages: Int
 var otherMessages: Int
 var estimatedTextTokens: Int
 struct Attachments: Codable { var images: Int; var audio: Int; var video: Int; var files: Int }
 var attachments: Attachments
 var historyComplete: Bool
 var hasPreviousPage: Bool?
 var hasNextPage: Bool?
 var responsesCaptured: Int
 var updatedAt: Double?
}
struct ChatCheckProgressAccumulator {
 var parserAttempted=0
 var parserAccepted=0
 var acceptedParsedPages=0
 var parserRejected=0
 var pagesProduced=0
 var producedMessages=0
 var uniqueMessagesProduced=0
 var parserPageUpdateCallbacks=0
 var nativePageUpdateCallbacks=0
 var paginationProgressObserved=false
 var hasPreviousPage:Bool?
 var historyCompleteProven=false
 var pageUpdateCallbacks:Int {max(parserPageUpdateCallbacks,nativePageUpdateCallbacks)}
 var hasProvenHistoryProgress:Bool {
  isHistoryProgressProven(acceptedPages:acceptedParsedPages,pageUpdateCallbacks:pageUpdateCallbacks,
   producedMessages:max(producedMessages,uniqueMessagesProduced),paginationProgressObserved:paginationProgressObserved)
 }
 mutating func observeParsedResponse(_ entry:HistoryResponseParseEntry) {
  if entry.parserAttempted {
   parserAttempted=min(100000,parserAttempted+1)
   if entry.parserAccepted {
    parserAccepted=min(100000,parserAccepted+1)
    acceptedParsedPages=min(100000,acceptedParsedPages+entry.extractedPageCount)
    pagesProduced=min(100000,pagesProduced+entry.extractedPageCount)
   }
   else {parserRejected=min(100000,parserRejected+1)}
  }
  if entry.parserAccepted,let count=entry.extractedMessageCount {producedMessages=min(100000,producedMessages+count)}
  if entry.pageUpdateCallbackFired {parserPageUpdateCallbacks=min(100000,parserPageUpdateCallbacks+1)}
  if let value=entry.hasPreviousPage {hasPreviousPage=value}
 }
 mutating func observeNativePage(newlyAddedMessages:Int,hasPreviousPage:Bool?,paginationProgressObserved:Bool) {
  nativePageUpdateCallbacks=min(100000,nativePageUpdateCallbacks+1)
  uniqueMessagesProduced=min(100000,uniqueMessagesProduced+max(0,newlyAddedMessages))
  if let value=hasPreviousPage {self.hasPreviousPage=value}
  self.paginationProgressObserved = self.paginationProgressObserved || paginationProgressObserved
 }
 mutating func recordCompletionProof(){historyCompleteProven=true}
}
func isHistoryProgressProven(acceptedPages:Int,pageUpdateCallbacks:Int,producedMessages:Int,paginationProgressObserved:Bool)->Bool {
 acceptedPages>0 || pageUpdateCallbacks>0 || producedMessages>0 || paginationProgressObserved
}
func historyProgressEventRejectionReason(eventGeneration:String?,activeGeneration:String?,telemetryGeneration:String?)->String? {
 guard let eventGeneration,!eventGeneration.isEmpty else{return "missing_generation"}
 guard let activeGeneration,!activeGeneration.isEmpty,eventGeneration==activeGeneration else{return "stale_generation"}
 guard let telemetryGeneration,!telemetryGeneration.isEmpty else{return "no_active_check"}
 guard telemetryGeneration==activeGeneration else{return "owner_mismatch"}
 return nil
}
struct HistoryProgressEventRejectionState:Codable,Equatable {
 var counts:[String:Int]=[:]
 var lastReason="none"
 var total:Int {counts.values.reduce(0,+)}
 mutating func record(_ reason:String) {
  guard ["missing_generation","stale_generation","no_active_check","owner_mismatch"].contains(reason) else{return}
  counts[reason]=min(100000,(counts[reason] ?? 0)+1);lastReason=reason
 }
 var summary:String {
  let details=counts.keys.sorted().map{"\($0)=\(counts[$0] ?? 0)"}.joined(separator:", ")
  return details.isEmpty ? "none":"\(details) · last \(lastReason)"
 }
}
struct NoProgressTerminalDecision {
 let terminal:String
 let aggregate:SafeAggregate?
}
func noProgressTerminalDecision(existing:SafeAggregate?,candidate:SafeAggregate?,hasProvenHistoryProgress:Bool,hasPreviousPage:Bool?,completionProven:Bool,subtype:String)->NoProgressTerminalDecision {
 if completionProven,let candidate,candidate.historyComplete,candidate.hasPreviousPage==false {
  return NoProgressTerminalDecision(terminal:"Complete",aggregate:candidate)
 }
 guard hasProvenHistoryProgress,hasPreviousPage==true,!completionProven else {
  return NoProgressTerminalDecision(terminal:"Failed · no_progress · \(subtype)",aggregate:existing)
 }
 let usableCandidate=candidate.flatMap{$0.historyComplete && $0.hasPreviousPage==false ? nil:$0}
 var selected:SafeAggregate?
 if let existing,let usableCandidate {
  selected = usableCandidate.messagesCollected>=existing.messagesCollected && usableCandidate.estimatedTextTokens>=existing.estimatedTextTokens ? usableCandidate:existing
 } else {selected=usableCandidate ?? existing}
 if var partial=selected {
  partial.historyComplete=false;partial.hasPreviousPage=true
  return NoProgressTerminalDecision(terminal:"Partial · no_progress · \(subtype)",aggregate:partial)
 }
 return NoProgressTerminalDecision(terminal:"Partial · no_progress · \(subtype)",aggregate:nil)
}
func timeoutProgressPartialAggregate(existing:SafeAggregate?,candidate:SafeAggregate?,hasPreviousPage:Bool?,acceptedPages:Int,pageUpdateCallbacks:Int,producedMessages:Int,paginationProgressObserved:Bool=false,completionProven:Bool=false)->SafeAggregate? {
 guard hasPreviousPage==true,!completionProven,isHistoryProgressProven(acceptedPages:acceptedPages,pageUpdateCallbacks:pageUpdateCallbacks,producedMessages:producedMessages,paginationProgressObserved:paginationProgressObserved),
       let candidate,!(candidate.historyComplete && candidate.hasPreviousPage==false) else{return nil}
 if let existing,
    candidate.messagesCollected<existing.messagesCollected || candidate.estimatedTextTokens<existing.estimatedTextTokens {
  var preserved=existing
  preserved.historyComplete=false
  preserved.hasPreviousPage=true
  return preserved
 }
 var partial=candidate
 partial.historyComplete=false
 partial.hasPreviousPage=true
 return partial
}
enum RiskModelSource: String { case betaBaseline = "Beta baseline", personalCalibration = "Personal calibration" }
enum RiskMeasurementStatus: String { case complete = "Complete", partial = "Partial", unknown = "Unknown" }
struct RiskCalibrationSample {
 let label: String
 let estimatedTextTokens: Int
 let complete: Bool
}
struct RiskModel: Equatable {
 let source: RiskModelSource
 let safeCeiling: Int
 let limitFloor: Int
 let watch: Int
 let near: Int
 let critical: Int
 let normalSamples: Int
 let limitSamples: Int
 static let beta = RiskModel(source:.betaBaseline,safeCeiling:210640,limitFloor:539543,watch:309311,near:407982,critical:473762,normalSamples:5,limitSamples:3)
}
struct RiskAssessment: Equatable {
 let level: String
 let rank: Int?
 let measurement: RiskMeasurementStatus
}
func chatCheckContinuationEligible(terminal:String,replayProgressObserved:Bool,newHistoryProgressObserved:Bool,uniqueMessagesBeyondBaseline:Int,
                                   hasPreviousPage:Bool,historyComplete:Bool,routeUnchanged:Bool,documentIdentityValid:Bool,
                                   frontierTimestamp:Double?,continuationAlreadyUsed:Bool,renderLeaseAvailable:Bool)->Bool {
 let eligibleTerminal=terminal=="Partial · pagination_no_progress" || terminal.hasPrefix("Timed out · per_chat_timeout") || terminal.hasPrefix("per_chat_timeout ·")
 guard eligibleTerminal,(replayProgressObserved || (newHistoryProgressObserved && uniqueMessagesBeyondBaseline>0)),hasPreviousPage,!historyComplete,
       routeUnchanged,documentIdentityValid,!continuationAlreadyUsed,renderLeaseAvailable,
       let frontierTimestamp,frontierTimestamp.isFinite,frontierTimestamp>0 else{return false}
 return true
}
func buildRiskModel(samples:[RiskCalibrationSample]) -> RiskModel {
 let valid=samples.filter{$0.complete && $0.estimatedTextTokens>=0 && ($0.label=="normal" || $0.label=="limit_reached")}
 let normals=valid.filter{$0.label=="normal"}.map{$0.estimatedTextTokens}
 let limits=valid.filter{$0.label=="limit_reached"}.map{$0.estimatedTextTokens}
 guard normals.count>=2,limits.count>=2,let safe=normals.max(),let floor=limits.min(),safe<floor else{return .beta}
 let gap=floor-safe
 let watch=Int((Double(safe)+Double(gap)*0.3).rounded())
 let near=Int((Double(safe)+Double(gap)*0.6).rounded())
 let critical=Int((Double(safe)+Double(gap)*0.8).rounded())
 guard safe<watch,watch<near,near<critical,critical<floor else{return .beta}
 return RiskModel(source:.personalCalibration,safeCeiling:safe,limitFloor:floor,watch:watch,near:near,critical:critical,normalSamples:normals.count,limitSamples:limits.count)
}
func assessRisk(model:RiskModel,estimatedTextTokens:Int?,measurement:RiskMeasurementStatus)->RiskAssessment {
 guard let tokens=estimatedTextTokens,tokens>=0,measurement != .unknown else{return RiskAssessment(level:"Unknown",rank:nil,measurement:measurement)}
 let rank=tokens>=model.critical ? 3 : tokens>=model.near ? 2 : tokens>=model.watch ? 1 : 0
 if measurement == .partial {
  guard rank>0 else{return RiskAssessment(level:"Unknown",rank:nil,measurement:.partial)}
  return RiskAssessment(level:["","At least Watch","At least Near","At least Critical"][rank],rank:rank,measurement:.partial)
 }
 return RiskAssessment(level:["Normal","Watch","Near","Critical"][rank],rank:rank,measurement:.complete)
}
func riskMeasurementStatus(result:String?,aggregate:SafeAggregate?)->RiskMeasurementStatus {
 guard let aggregate,result != nil else{return .unknown}
 if result=="Complete" && aggregate.historyComplete && aggregate.hasPreviousPage==false {return .complete}
 if result=="Partial" || aggregate.hasPreviousPage==true || !aggregate.historyComplete {return .partial}
 return .unknown
}
func riskUpwardCrossing(previousRank:Int?,next:RiskAssessment)->String? {
 guard next.measurement == .complete,let rank=next.rank,(1...3).contains(rank),rank>(previousRank ?? 0) else{return nil}
 return ["Normal","Watch","Near","Critical"][rank]
}
func riskNotificationNeeded(previousObservedRank:Int?,lastAcceptedRank:Int?,next:RiskAssessment)->String? {
 guard next.measurement == .complete,let rank=next.rank,(1...3).contains(rank) else{return nil}
 if lastAcceptedRank == nil || rank>lastAcceptedRank! {return ["Normal","Watch","Near","Critical"][rank]}
 if let previousObservedRank,rank>previousObservedRank {return ["Normal","Watch","Near","Critical"][rank]}
 return nil
}
func partialRiskNotificationNeeded(lastAcceptedRank:Int?,lowerBoundTokens:Int?,model:RiskModel)->String? {
 let confirmed=confirmedRiskFromLowerBound(lowerBoundTokens,model:model)
 let rank:Int
 switch confirmed {case .near:rank=2;case .critical:rank=3;case .normal,.uncertain,.watch:return nil}
 guard lastAcceptedRank == nil || rank>lastAcceptedRank! else{return nil}
 return rank==2 ? "Near":"Critical"
}
func incompleteRiskNotificationNeeded(measurement:RiskMeasurementStatus,lastAcceptedRank:Int?,lowerBoundTokens:Int?,model:RiskModel)->String? {
 guard measurement != .complete else{return nil}
 return partialRiskNotificationNeeded(lastAcceptedRank:lastAcceptedRank,lowerBoundTokens:lowerBoundTokens,model:model)
}
func retryRiskNotificationLevel(lastOutcome:String?,previousObservedRank:Int?,lastAcceptedRank:Int?,next:RiskAssessment)->String? {
 guard ["add_error","permission_denied","interrupted"].contains(lastOutcome ?? "") else{return nil}
 return riskNotificationNeeded(previousObservedRank:previousObservedRank,lastAcceptedRank:lastAcceptedRank,next:next)
}
func shouldDispatchSystemRiskNotification(kind:String,level:String)->Bool {
 kind=="risk" && ["Watch","Near","Critical"].contains(level)
}
func shouldRetryRootDiscovery(stallDetail:String?,rateLimited:Bool,retriesUsed:Int)->Bool {
 stallDetail=="no_list_response" && !rateLimited && retriesUsed==0
}
func monitoringDiscoveryDegraded(baseDiscoveryComplete:Bool,rootResponseReceived:Bool,stallDetail:String?,rateLimited:Bool,safetyLimitExceeded:Bool)->Bool {
 !(baseDiscoveryComplete && rootResponseReceived && stallDetail==nil && !rateLimited && !safetyLimitExceeded)
}
func isMonitoringDiscoveryFailure(_ detail:String?)->Bool {
 guard let detail=detail?.lowercased() else{return false}
 return detail=="no_list_response" || detail=="dom_fallback_visible_sidebar_rows_only" || detail=="root_http_429" || detail.hasPrefix("root_request_without_response") || detail.hasPrefix("root_response_unclassified") || detail.hasPrefix("root_trigger_") || detail=="render_surface_readiness_failed" || detail=="hard_safety_timeout_600s"
}
enum RiskMonitoringState:String {case normal="Normal",uncertain="Uncertain",watch="Watch",near="Near",critical="Critical"}
func confirmedRiskFromLowerBound(_ lowerBoundTokens:Int?,model:RiskModel)->RiskMonitoringState {
 guard let tokens=lowerBoundTokens,tokens>=0 else{return .normal}
 if tokens>=model.critical {return .critical}
 if tokens>=model.near {return .near}
 if tokens>=model.watch {return .watch}
 return .normal
}
func hasUnprocessedChatActivity(_ record:ChatRecord)->Bool {
 guard record.lastSeenUpdatedAt.isFinite,record.lastSeenUpdatedAt>0 else{return false}
 if let checkedAt=record.lastCheckAt,checkedAt.isFinite,checkedAt>0 {return record.lastSeenUpdatedAt>checkedAt}
 if let checkedActivity=record.lastCheckedUpdatedAt,checkedActivity.isFinite,checkedActivity>0 {return record.lastSeenUpdatedAt>checkedActivity}
 return false
}
struct StaleIncompleteMaintenanceSelection {
 let eligibleCount:Int
 let admitted:[ChatRecord]
 var deferredCount:Int {max(0,eligibleCount-admitted.count)}
}
func staleIncompleteMaintenanceEligibilityReason(admitted:Bool)->String? {admitted ? "stale_incomplete_maintenance":nil}
let staleIncompleteMaintenanceCooldownMs:Double=12*60*60*1000
let staleIncompleteMaintenanceCap=3
func selectStaleIncompleteMaintenanceCandidates(records:[ChatRecord],discoveredIDs:Set<String>,recentIDs:Set<String>,nowMs:Double,cap:Int=staleIncompleteMaintenanceCap)->StaleIncompleteMaintenanceSelection {
 let unique=Dictionary(records.map{($0.conversationId,$0)},uniquingKeysWith:{_,newer in newer})
 let eligible=unique.values.filter { record in
  guard discoveredIDs.contains(record.conversationId),!recentIDs.contains(record.conversationId),
        riskMeasurementStatus(result:record.lastCheckResult,aggregate:record.aggregate) != .complete,
        let checked=record.lastCheckAt,checked.isFinite,checked>0 else{return false}
  return nowMs.isFinite && nowMs>=checked && nowMs-checked>=staleIncompleteMaintenanceCooldownMs
 }.sorted {
  let a=$0.lastCheckAt ?? 0,b=$1.lastCheckAt ?? 0
  if a != b {return a<b}
  let at=$0.aggregate?.estimatedTextTokens ?? -1,bt=$1.aggregate?.estimatedTextTokens ?? -1
  if at != bt {return at>bt}
  return $0.conversationId<$1.conversationId
 }
 return StaleIncompleteMaintenanceSelection(eligibleCount:eligible.count,admitted:Array(eligible.prefix(max(0,cap))))
}
func needsAttentionActionable(record:ChatRecord,model:RiskModel,nowMs:Double)->Bool {
 guard monitoringState(record:record,model:model,nowMs:nowMs) == .uncertain else{return false}
 return hasUnprocessedChatActivity(record) || record.pendingActivityNeedsAttention || confirmedRiskFromLowerBound(record.aggregate?.estimatedTextTokens,model:model) != .normal
}
func monitoringState(record:ChatRecord,model:RiskModel,nowMs:Double)->RiskMonitoringState {
 let measurement=riskMeasurementStatus(result:record.lastCheckResult,aggregate:record.aggregate)
 if measurement == .complete,let aggregate=record.aggregate,record.lastCheckedUpdatedAt != nil,
    record.lastSeenUpdatedAt<=record.lastCheckedUpdatedAt! {
  switch assessRisk(model:model,estimatedTextTokens:aggregate.estimatedTextTokens,measurement:.complete).rank {
  case 1:return .watch
  case 2:return .near
  case 3:return .critical
  default:return .normal
  }
 }
 let incomplete=measurement == .partial || record.lastCheckResult?.hasPrefix("Timed out") == true || record.lastCheckResult?.contains("no_progress") == true
 let staleComplete=measurement == .complete && (record.lastCheckedUpdatedAt == nil || record.lastSeenUpdatedAt>record.lastCheckedUpdatedAt!)
 let highLowerBound=(record.aggregate?.estimatedTextTokens ?? 0)>=model.safeCeiling
 let recentUnmeasuredFailure=record.lastSeenUpdatedAt.isFinite && record.lastSeenUpdatedAt<=nowMs && record.lastSeenUpdatedAt>=nowMs-21600000 && record.lastCheckResult?.hasPrefix("Failed") == true
 if record.uncertainSince != nil || incomplete || staleComplete || (highLowerBound && measurement != .complete) || record.consecutiveIncompleteChecks>=2 || recentUnmeasuredFailure {return .uncertain}
 return .normal
}
func warningBadgeVisible(record:ChatRecord,model:RiskModel,nowMs:Double)->Bool {
 let state=monitoringState(record:record,model:model,nowMs:nowMs)
 if state == .uncertain,let ack=record.uncertainAcknowledgedAt,ack>=record.lastSeenUpdatedAt {return false}
 return state != .normal
}
func monitoringWarningReason(record:ChatRecord,model:RiskModel,nowMs:Double)->String? {
 switch monitoringState(record:record,model:model,nowMs:nowMs) {
 case .normal:return nil
 case .watch:return "Complete history confirms Watch risk."
 case .near:return "Complete history confirms Near risk."
 case .critical:return "Complete history confirms Critical risk."
 case .uncertain:
  let result=record.lastCheckResult ?? ""
  if result.contains("pagination_progressing") {return "History is incomplete; pagination was still progressing when the check timed out."}
  if result.contains("pagination_no_progress") {return "History is incomplete; pagination stopped before the oldest messages were reached."}
  if result.contains("waiting_history") {return "History is incomplete; the app did not receive a complete history response."}
  if result.hasPrefix("Timed out") {return "History is incomplete; the chat check timed out."}
  if riskMeasurementStatus(result:result,aggregate:record.aggregate) == .partial {return "Full chat history could not be verified; this chat may be approaching its limit."}
  if let checked=record.lastCheckedUpdatedAt,record.lastSeenUpdatedAt>checked {return "New chat activity has not been included in a complete check."}
  return "This active chat could not be fully checked; it may be approaching its limit."
 }
}
struct NotificationAuditRecord:Codable {
 var auditId:String
 var kind:String
 var conversationId:String?
 var level:String
 var createdAt:Double
 var dispatchAttemptedAt:Double?
 var outcome:String
 var dedupKey:String
 var userVisibleDelivery:String? = "unknown"
}
struct PersistedChatRecordDiagnostic:Equatable {
 let matched:Bool
 let reason:String?
 let lastCheckResult:String
 let measurement:String
 let riskCategory:String
 let tokenLowerBound:Int?
 let messageLowerBound:Int?
 let historyComplete:String
 let hasPreviousPage:String
 let lastCheckAt:Double?
 let activityState:String
 let betaRiskCategory:String
 let notificationGenerated:String
 let notificationOutcome:String
 let notificationLevel:String
 let notificationSuppressionReason:String
 let lastAcceptedNotifiedRisk:String
 let priorWatchNearCritical:String
 var displayText:String {
  guard matched else{return "matched: no · reason \(reason ?? "record_not_present")"}
  func number(_ value:Int?)->String {value.map(String.init) ?? "unknown"}
  func timestamp(_ value:Double?)->String {guard let value,value.isFinite,value>0 else{return "unknown"};return ISO8601DateFormatter().string(from:Date(timeIntervalSince1970:value/1000))}
  return "matched: yes\nlastCheckResult: \(lastCheckResult)\nrisk measurement: \(measurement)\nrisk category: \(riskCategory)\ntoken lower bound: \(number(tokenLowerBound)) · message lower bound: \(number(messageLowerBound))\nhistoryComplete: \(historyComplete) · hasPreviousPage: \(hasPreviousPage)\nlastCheckAt: \(timestamp(lastCheckAt))\nactivity/new activity: \(activityState)\nBeta-baseline risk classification: \(betaRiskCategory)\nnotification: generated \(notificationGenerated) · \(notificationOutcome) · level \(notificationLevel) · reason \(notificationSuppressionReason) · last accepted rank \(lastAcceptedNotifiedRisk)\nwas Watch/Near/Critical before last check: \(priorWatchNearCritical)"
 }
}
func persistedChatRecordDiagnostic(routeConversationID:String?,state:CycleState?,model:RiskModel = .beta)->PersistedChatRecordDiagnostic {
 func unavailable(_ reason:String)->PersistedChatRecordDiagnostic {PersistedChatRecordDiagnostic(matched:false,reason:reason,lastCheckResult:"unknown",measurement:"unknown",riskCategory:"unknown",tokenLowerBound:nil,messageLowerBound:nil,historyComplete:"unknown",hasPreviousPage:"unknown",lastCheckAt:nil,activityState:"unknown",betaRiskCategory:"unknown",notificationGenerated:"no",notificationOutcome:"not_recorded",notificationLevel:"unknown",notificationSuppressionReason:reason,lastAcceptedNotifiedRisk:"unknown",priorWatchNearCritical:"unknown")}
 guard let routeConversationID,routeConversationID.range(of:#"^[A-Za-z0-9_-]{1,128}$"#,options:.regularExpression) != nil else{return unavailable("route_id_unavailable")}
 guard let state else{return unavailable("state_not_loaded")}
 guard let record=state.records[routeConversationID],record.conversationId==routeConversationID else{return unavailable("record_not_present")}
 let aggregate=record.aggregate
 let measurement=riskMeasurementStatus(result:record.lastCheckResult,aggregate:aggregate)
 let assessment=assessRisk(model:model,estimatedTextTokens:aggregate?.estimatedTextTokens,measurement:measurement)
 let betaAssessment=assessRisk(model:.beta,estimatedTextTokens:aggregate?.estimatedTextTokens,measurement:measurement)
 let previousAudit=(state.notificationAudit ?? []).filter{$0.conversationId==routeConversationID && $0.kind=="risk"}.max{$0.createdAt < $1.createdAt}
 let outcome=previousAudit?.outcome ?? "not_recorded"
 let auditLevel=previousAudit?.level
 let suppression:String
 if let previousAudit {
  switch previousAudit.outcome {case "accepted":suppression="none";case "add_error","permission_denied","interrupted":suppression=previousAudit.outcome;case "pending","attempted":suppression="dispatch_\(previousAudit.outcome)";default:suppression="audit_\(previousAudit.outcome)"}
 } else {suppression="notification_decision_not_persisted"}
 let completeAndCurrent=measurement == .complete && record.lastCheckedUpdatedAt != nil && record.lastSeenUpdatedAt<=record.lastCheckedUpdatedAt!
 let activity=hasUnprocessedChatActivity(record) ? "new_activity_pending":(record.pendingActivityNeedsAttention ? "pending_activity_flagged":(completeAndCurrent ? "no_new_activity":"not_proven"))
 let riskLevel=assessment.level
 let betaRisk=betaAssessment.rank.map{betaAssessment.measurement == .partial ? "At least \(["Normal","Watch","Near","Critical"][max(0,min(3,$0))])":"\(["Normal","Watch","Near","Critical"][max(0,min(3,$0))])"} ?? "Unknown"
 let priorRisk=record.lastRiskRank.map{$0>=3 ? "yes · Critical":($0==2 ? "yes · Near":($0==1 ? "yes · Watch":"no"))} ?? "unknown"
 let acceptedRisk=record.lastNotifiedRiskRank.map{$0>=3 ? "Critical":($0==2 ? "Near":($0==1 ? "Watch":"Normal"))} ?? "none recorded"
 let generated=previousAudit == nil ? "unknown · no retained per-record audit":"yes"
 return PersistedChatRecordDiagnostic(matched:true,reason:nil,lastCheckResult:record.lastCheckResult ?? "unknown",measurement:measurement.rawValue,riskCategory:riskLevel,tokenLowerBound:aggregate?.estimatedTextTokens,messageLowerBound:aggregate?.messagesCollected,historyComplete:aggregate.map{$0.historyComplete ? "yes":"no"} ?? "unknown",hasPreviousPage:aggregate?.hasPreviousPage.map{$0 ? "yes":"no"} ?? "unknown",lastCheckAt:record.lastCheckAt,activityState:activity,betaRiskCategory:betaRisk,notificationGenerated:generated,notificationOutcome:outcome,notificationLevel:auditLevel ?? "unknown",notificationSuppressionReason:suppression,lastAcceptedNotifiedRisk:acceptedRisk,priorWatchNearCritical:priorRisk)
}
func notificationAuditStatus(outcome:String,userVisibleDelivery:String?)->String {
 let visibility=(userVisibleDelivery ?? "unknown") == "unknown" ? "user-visible delivery unknown":"user-visible delivery (userVisibleDelivery!)"
 switch outcome {
 case "pending":return "warning_decided · dispatch pending · \(visibility)"
 case "attempted":return "warning_decided · dispatch requested · \(visibility)"
 case "accepted":return "warning_decided · accepted by macOS · \(visibility)"
 case "add_error","permission_denied","interrupted":return "warning_decided · dispatch failed (\(outcome)) · \(visibility)"
 default:return "warning_decided · \(outcome) · \(visibility)"
 }
}
func riskNotificationContent(level:String,chatTitle:String?=nil,showChatTitle:Bool=true)->(title:String,body:String) {
 let generic="A recent chat is approaching the conversation length limit."
 let cleanTitle=chatTitle.map { value -> String in
  let filtered=value.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }
  return String(String.UnicodeScalarView(filtered)).trimmingCharacters(in:.whitespacesAndNewlines)
 }.flatMap{$0.isEmpty ? nil:$0}
 let context=showChatTitle ? cleanTitle.map{"“\($0)” is approaching the conversation length limit."} ?? generic : generic
 return ("GPT Limits Tool","\(context)\nRisk: \(level)")
}
func partialRiskNotificationContent(level:String)->(title:String,body:String)? {
 let body:String
 switch level {
 case "Near":body="This chat is at least Near limit. Full history couldn't be verified, so the actual size may be higher."
 case "Critical":body="This chat is at least Critical. Full history couldn't be verified, so the actual size may be higher."
 default:return nil
 }
 return ("GPT Limits Tool",body)
}
func riskNotificationRoute(conversationID:String)->String? {
 guard conversationID.range(of:"^[A-Za-z0-9-]{1,128}$",options:.regularExpression) != nil else{return nil}
 return "/c/\(conversationID)"
}
func validatedRiskNotificationRoute(_ route:String)->String? {
 guard route.range(of:"^/(?:c/[A-Za-z0-9-]{1,128}|g/[A-Za-z0-9-]{1,128}/c/[A-Za-z0-9-]{1,128})/?$",options:.regularExpression) != nil else{return nil}
 return route
}
func riskRank(_ level:String)->Int? { ["Normal":0,"Watch":1,"Near":2,"Critical":3][level] }
func userFacingRiskLabel(_ assessment:RiskAssessment)->String? {
 let normalized=assessment.level.replacingOccurrences(of:"At least ",with:"")
 guard ["Watch","Near","Critical"].contains(normalized) else{return nil}
 return assessment.level
}
func userFacingRiskChatTitle(_ title:String,showTitles:Bool)->String {
 guard showTitles else{return "A recent chat"}
 let cleaned=title.unicodeScalars.filter{!CharacterSet.controlCharacters.contains($0)}
 let value=String(String.UnicodeScalarView(cleaned)).trimmingCharacters(in:.whitespacesAndNewlines)
 return value.isEmpty ? "A recent chat":value
}

enum RenderReadinessResult:String,Codable {case success,failure}
enum RenderReadinessRouteCategory:String,Codable {case chat,home,loginAuth="login/auth",other}

func sanitizedRenderReadinessCode(_ value:String?,fallback:String)->String {
 guard let value,value.count<=64,value.range(of:"^[A-Za-z][A-Za-z0-9_]*$",options:.regularExpression) != nil else{return fallback}
 return value
}

func renderReadinessRouteCategory(_ url:URL?)->RenderReadinessRouteCategory {
 guard let url else{return .other}
 let host=url.host?.lowercased() ?? ""
 let path=url.path.lowercased()
 if host=="auth.openai.com" || host.hasSuffix(".auth.openai.com") || path.contains("/auth/") || path.contains("/login") {return .loginAuth}
 if host=="chatgpt.com" {
  if path=="/" || path.isEmpty{return .home}
  if path.range(of:#"^/(?:c/[^/]+|g/[^/]+/c/[^/]+)(?:/.*)?$"#,options:.regularExpression) != nil{return .chat}
 }
 return .other
}

struct RenderReadinessDiagnostic:Codable,Equatable {
 var phase:String
 var result:RenderReadinessResult
 var reason:String
 var routeCategory:RenderReadinessRouteCategory
 var timestamp:Date
 init(phase:String,result:RenderReadinessResult,reason:String,routeCategory:RenderReadinessRouteCategory,timestamp:Date=Date()) {
  self.phase=sanitizedRenderReadinessCode(phase,fallback:"unknown")
  self.result=result
  self.reason=sanitizedRenderReadinessCode(reason,fallback:"unclassified")
  self.routeCategory=routeCategory
  self.timestamp=timestamp
 }
}

func renderReadinessDiagnosticSummary(_ diagnostic:RenderReadinessDiagnostic)->String {
 let timestamp=ISO8601DateFormatter().string(from:diagnostic.timestamp)
 return "phase \(diagnostic.phase) · result \(diagnostic.result.rawValue) · reason \(diagnostic.reason) · route \(diagnostic.routeCategory.rawValue) · timestamp \(timestamp)"
}

enum ChatCheckTraceStage:String,Codable,CaseIterable {
 case checkStarted="check_started",navigationRequested="navigation_requested",navigationFinished="navigation_finished"
 case conversationRouteObserved="conversation_route_observed",documentReady="document_ready",historyWaitStarted="history_wait_started"
 case historyResponseObserved="history_response_observed",historyRowsObserved="history_rows_observed",terminalResult="terminal_result"
}
enum ChatCheckTraceResult:String,Codable {case success,failure}
enum ChatCheckTraceReason:String,Codable {
 case started="started",continuationStarted="continuation_started",navigationRequested="navigation_requested",navigationFinished="navigation_finished",navigationNotStarted="navigation_not_started",navigationFailed="navigation_failed",navigationNotFinished="navigation_not_finished",expectedRoute="expected_route",unexpectedRoute="unexpected_route",conversationRouteNotObserved="conversation_route_not_observed"
 case documentComplete="document_complete",documentNotReady="document_not_ready",documentEvaluationFailed="document_evaluation_failed",documentReadyNotObserved="document_ready_not_observed",historyWaiting="history_waiting",historyWaitNotStarted="history_wait_not_started",historyResponse2xx="history_response_2xx",historyResponseError="history_response_error",historyResponseNotObserved="history_response_not_observed"
 case historyResponse429="history_response_429",historyResponseUnknown="history_response_unknown",historyRowsObserved="history_rows_observed",historyRowsEmpty="history_rows_empty",historyRowsNotObserved="history_rows_not_observed",terminalComplete="terminal_complete",terminalPartial="terminal_partial"
 case terminalTimeout="terminal_timeout",terminalNoProgressWaitingHistory="terminal_no_progress_waiting_history",terminalNavigationFailure="terminal_navigation_failure",terminalFailure="terminal_failure",unclassified="unclassified"
}
struct SanitizedChatCheckRoute:Equatable {
 let template:String
 let category:RenderReadinessRouteCategory
}
func sanitizedChatCheckRoute(_ url:URL?)->SanitizedChatCheckRoute {
 guard let url else{return SanitizedChatCheckRoute(template:"other",category:.other)}
 let category=renderReadinessRouteCategory(url)
 guard url.host?.lowercased()=="chatgpt.com" else{return SanitizedChatCheckRoute(template:"other",category:category)}
 if url.path.isEmpty || url.path=="/" {return SanitizedChatCheckRoute(template:"home",category:.home)}
 let parts=url.path.split(separator:"/").map(String.init)
 if parts.count==2,parts[0]=="c",parts[1].range(of:#"^[A-Za-z0-9_-]{1,128}$"#,options:.regularExpression) != nil {
  return SanitizedChatCheckRoute(template:"/c/:id",category:.chat)
 }
 if parts.count==4,parts[0]=="g",parts[2]=="c",
    parts[1].range(of:#"^[A-Za-z0-9_-]{1,128}$"#,options:.regularExpression) != nil,
    parts[3].range(of:#"^[A-Za-z0-9_-]{1,128}$"#,options:.regularExpression) != nil {
  return SanitizedChatCheckRoute(template:"/g/:id/c/:id",category:.chat)
 }
 if parts.count==1,parts[0].range(of:#"^[A-Za-z0-9_-]{1,128}$"#,options:.regularExpression) != nil {
  return SanitizedChatCheckRoute(template:"/:id",category:.chat)
 }
 if parts.count==2,parts.allSatisfy({$0.range(of:#"^[A-Za-z0-9_-]{1,128}$"#,options:.regularExpression) != nil}) {
  return SanitizedChatCheckRoute(template:"/:id/:id",category:.chat)
 }
 return SanitizedChatCheckRoute(template:"other",category:category)
}
struct ChatCheckTraceEvent:Codable,Equatable {
 let stage:ChatCheckTraceStage
 let result:ChatCheckTraceResult
 let elapsedMs:Int
 let routeTemplate:String
 let routeCategory:RenderReadinessRouteCategory
 let reason:ChatCheckTraceReason
 let timestamp:Date
}
struct PersistedChatCheckTrace:Codable,Equatable {
 let startedAt:Date
 private(set) var events:[ChatCheckTraceEvent]=[]
 mutating func append(stage:ChatCheckTraceStage,result:ChatCheckTraceResult,route:SanitizedChatCheckRoute,reason:ChatCheckTraceReason,at:Date=Date()) {
  let elapsed=max(0,min(600000,Int(at.timeIntervalSince(startedAt)*1000)))
  events.append(ChatCheckTraceEvent(stage:stage,result:result,elapsedMs:elapsed,routeTemplate:route.template,routeCategory:route.category,reason:reason,timestamp:at))
  if events.count>40 {events.remove(at:events.count>1 ? 1:0)}
 }
 var displayText:String {
  guard !events.isEmpty else{return "Last standard chat check trace: not recorded"}
  let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
  let lines=events.enumerated().map{index,event in
   "#\(index+1) \(event.stage.rawValue) \(event.result.rawValue) +\(event.elapsedMs)ms · route \(event.routeTemplate) / \(event.routeCategory.rawValue) · reason \(event.reason.rawValue) · \(formatter.string(from:event.timestamp))"
  }
  return "Last standard chat check trace (sanitized):\n"+lines.joined(separator:"\n")
 }
}

struct HistoryResponseParseEntry:Codable,Equatable {
 let sequence:Int?
 let endpointTemplate:String
 let transport:String
 let status:Int
 let contentTypeCategory:String
 let topLevelType:String
 let topLevelKeyNames:[String]
 let topLevelArrayCounts:[String:Int]
 let expectedConversationId:Bool
 let expectedMessagesArray:Bool
 let mappingObjectPresent:Bool
 let pageInfoObjectPresent:Bool
 let hasPreviousPageField:Bool
 let parserAttempted:Bool
 let parserAccepted:Bool
 let rejectionReason:String
 let pageAcceptanceReason:String
 let extractedPageCount:Int
 let extractedMessageCount:Int?
 let hasPreviousPage:Bool?
 let pageUpdateCallbackFired:Bool
 let timestamp:Date

 static func make(_ data:[String:Any],at:Date=Date())->HistoryResponseParseEntry {
  let raw=data["responseParseDiagnostic"] as? [String:Any] ?? data
  func safeName(_ value:Any)->String? {
   guard let value=value as? String,value.range(of:"^[A-Za-z][A-Za-z0-9_]{0,47}$",options:.regularExpression) != nil else{return nil}
   return value
  }
  let rawArrays=raw["topLevelArrayCounts"] as? [[String:Any]] ?? []
  var arrayCounts:[String:Int]=[:]
  for item in rawArrays.prefix(32) {guard let key=safeName(item["key"] as Any),let count=(item["count"] as? NSNumber)?.intValue,count>=0 else{continue};arrayCounts[key]=min(100000,count)}
  let expected=raw["expectedStructure"] as? [String:Any] ?? [:]
  let endpoint=raw["endpointTemplate"] as? String ?? ""
  let safeEndpoint=["/backend-api/conversations/:id/messages","/backend-api/conversations/:id","/backend-api/:other","/other"].contains(endpoint) ? endpoint:"/other"
  let rejection=raw["rejectionReason"] as? String ?? "unknown"
  let allowedReasons=Set(["endpoint_not_recognized","top_level_shape_changed","conversation_mapping_missing","messages_array_missing","pagination_field_changed","parser_exception","parsed_but_empty","accepted","http_error","route_mismatch","not_history_payload","unknown"])
  let keys=(raw["topLevelKeyNames"] as? [String] ?? []).prefix(32).compactMap{safeName($0)}
  let status=(raw["status"] as? NSNumber)?.intValue ?? 0
  let sequence=(data["sequence"] as? NSNumber)?.intValue
  let arrayCount=(raw["extractedPageCount"] as? NSNumber)?.intValue ?? 0
  let messageCount=(raw["extractedMessageCount"] as? NSNumber)?.intValue
  let topType=raw["topLevelType"] as? String ?? "unknown"
  return HistoryResponseParseEntry(sequence:sequence.flatMap{$0>=0 ? $0:nil},endpointTemplate:safeEndpoint,
   transport:["fetch","XHR"].contains(raw["transport"] as? String ?? "") ? raw["transport"] as! String:"unknown",
   status:min(599,max(0,status)),contentTypeCategory:["json","text","other","unknown"].contains(raw["contentTypeCategory"] as? String ?? "") ? raw["contentTypeCategory"] as! String:"unknown",
   topLevelType:["object","array","string","number","boolean","null","unknown"].contains(topType) ? topType:"unknown",
   topLevelKeyNames:keys,topLevelArrayCounts:arrayCounts,
   expectedConversationId:expected["conversationId"] as? Bool == true,
   expectedMessagesArray:expected["messagesArray"] as? Bool == true,
   mappingObjectPresent:expected["mappingObject"] as? Bool == true,
   pageInfoObjectPresent:expected["pageInfoObject"] as? Bool == true,
   hasPreviousPageField:expected["hasPreviousPageBoolean"] as? Bool == true,
   parserAttempted:raw["parserAttempted"] as? Bool == true,
   parserAccepted:raw["parserAccepted"] as? Bool == true,
   rejectionReason:allowedReasons.contains(rejection) ? rejection:"unknown",
   pageAcceptanceReason:["none","route_mismatch","generation_mismatch","document_mismatch","page_handoff_missing","empty_page","no_older_items"].contains(data["pageAcceptanceReason"] as? String ?? "") ? data["pageAcceptanceReason"] as! String:"none",
   extractedPageCount:min(1,max(0,arrayCount)),extractedMessageCount:messageCount.map{min(100000,max(0,$0))},
   hasPreviousPage:raw["hasPreviousPage"] as? Bool,
   pageUpdateCallbackFired:data["pageUpdateCallbackFired"] as? Bool == true,timestamp:at)
 }
}

struct HistoryResponseParsingState:Codable,Equatable {
 var observedHistoryResponses=0
 var parserDiagnosticResponseCount=0
 var parserAttemptedCount=0
 var parserAcceptedCount=0
 var parserRejectedCount=0
 var pageUpdateCallbackCount=0
 var extractedPageCount=0
 var extractedMessageCount=0
 var rejectionCounts:[String:Int]=[:]
 var entries:[HistoryResponseParseEntry]=[]
 mutating func recordObservedResponse(){observedHistoryResponses=min(100000,observedHistoryResponses+1)}
 mutating func append(_ entry:HistoryResponseParseEntry){
  parserDiagnosticResponseCount=min(100000,parserDiagnosticResponseCount+1)
  if entry.parserAttempted {
   parserAttemptedCount=min(100000,parserAttemptedCount+1)
   if entry.parserAccepted {parserAcceptedCount=min(100000,parserAcceptedCount+1)}
   else {parserRejectedCount=min(100000,parserRejectedCount+1)}
  }
  if !entry.parserAccepted && entry.rejectionReason != "accepted" {rejectionCounts[entry.rejectionReason]=min(100000,(rejectionCounts[entry.rejectionReason] ?? 0)+1)}
  if entry.pageUpdateCallbackFired {pageUpdateCallbackCount=min(100000,pageUpdateCallbackCount+1)}
  extractedPageCount=min(100000,extractedPageCount+entry.extractedPageCount)
  extractedMessageCount=min(100000,extractedMessageCount+(entry.extractedMessageCount ?? 0))
  entries.append(entry);if entries.count>20{entries.removeFirst(entries.count-20)}
 }
 var summary:String {
  let top=rejectionCounts.sorted{lhs,rhs in lhs.value==rhs.value ? lhs.key<rhs.key:lhs.value>rhs.value}.first?.key ?? "none"
  return "History response parsing: observed \(max(observedHistoryResponses,parserDiagnosticResponseCount)) · parser attempted/accepted/rejected \(parserAttemptedCount)/\(parserAcceptedCount)/\(parserRejectedCount) (last \(entries.count)) · top rejection \(top) · page callbacks \(pageUpdateCallbackCount) · rows/pages produced \(extractedMessageCount)/\(extractedPageCount)"
 }
}

struct PerChatHistoryDiagnostic:Codable,Equatable {
 let ordinal:Int
 var terminalResult="in_progress"
 var terminalReason="not_terminal"
 var historyRequestsObserved=0
 var historyResponsesObserved=0
 var parserAttempted=0
 var parserAccepted=0
 var parserRejected=0
 var endpointNotRecognized=0
 var rejectionCounts:[String:Int]=[:]
 var pagesProduced=0
 var messagesProduced=0
 var uniqueMessagesProduced=0
 var pageUpdateCallbacks=0
 var domTurnsObserved:Int?
 var hasPreviousPage:Bool?
 var historyCompleteProven=false
 var paginationProgressObserved=false
 var finalPaginationState="unknown"
 var timeoutState="not_timed_out"
 var timeoutReason="none"
 var responseEntries:[HistoryResponseParseEntry]=[]
 var completionDecision:ChatCompletionDecisionDiagnostic?

 init(ordinal:Int){self.ordinal=max(1,ordinal)}
 mutating func recordHistoryRequest(){historyRequestsObserved=min(100000,historyRequestsObserved+1)}
 mutating func recordHistoryResponse(){historyResponsesObserved=min(100000,historyResponsesObserved+1)}
 mutating func recordCompletionDecision(candidate:Bool,accepted:Bool,reason:String,aggregate:SafeAggregate,hasPreviousPage:Bool?,historyComplete:Bool) {
  guard completionDecision?.accepted != true else{return}
  let allowed=Set(["none","no_accepted_history_response","aggregate_empty","has_previous_page_true","has_previous_page_unknown","terminal_false_page_observed","completion_set_but_lost_before_persist","completion_proof_not_set","completion_candidate_not_present","previously_complete_unchanged"])
  completionDecision=ChatCompletionDecisionDiagnostic(candidate:candidate,accepted:accepted,reason:allowed.contains(reason) ? reason:"completion_proof_not_set",aggregateMessages:min(100000,max(0,aggregate.messagesCollected)),hasPreviousPage:hasPreviousPage,historyComplete:historyComplete)
 }
 mutating func recordPersistedAggregate(_ aggregate:SafeAggregate?) {
  guard var decision=completionDecision else{return}
  decision.persistedHistoryComplete=aggregate?.historyComplete;decision.persistedHasPreviousPage=aggregate?.hasPreviousPage;decision.persistedMessages=aggregate?.messagesCollected
  if decision.accepted && !(aggregate?.historyComplete == true && aggregate?.hasPreviousPage == false) {decision.reason="completion_set_but_lost_before_persist"}
  completionDecision=decision
 }
 mutating func append(_ entry:HistoryResponseParseEntry){
  if entry.parserAttempted {
   parserAttempted=min(100000,parserAttempted+1)
   if entry.parserAccepted {parserAccepted=min(100000,parserAccepted+1)} else {parserRejected=min(100000,parserRejected+1)}
  }
  if entry.rejectionReason=="endpoint_not_recognized" {endpointNotRecognized=min(100000,endpointNotRecognized+1)}
  if !entry.parserAccepted && entry.rejectionReason != "accepted" {rejectionCounts[entry.rejectionReason]=min(100000,(rejectionCounts[entry.rejectionReason] ?? 0)+1)}
  pagesProduced=min(100000,pagesProduced+entry.extractedPageCount)
  messagesProduced=min(100000,messagesProduced+(entry.extractedMessageCount ?? 0))
  if entry.pageUpdateCallbackFired {pageUpdateCallbacks=min(100000,pageUpdateCallbacks+1)}
  if let value=entry.hasPreviousPage {hasPreviousPage=value}
  responseEntries.append(entry);if responseEntries.count>20 {responseEntries.removeFirst(responseEntries.count-20)}
 }
 mutating func observe(telemetry:ChatCheckStageTelemetry){
  parserAttempted=telemetry.checkProgress.parserAttempted
  parserAccepted=telemetry.checkProgress.parserAccepted
  parserRejected=telemetry.checkProgress.parserRejected
  pagesProduced=telemetry.checkProgress.pagesProduced
  messagesProduced=telemetry.checkProgress.producedMessages
  uniqueMessagesProduced=telemetry.checkProgress.uniqueMessagesProduced
  pageUpdateCallbacks=telemetry.checkProgress.pageUpdateCallbacks
  domTurnsObserved=telemetry.renderedDOMTurnCount
  if let value=telemetry.checkProgress.hasPreviousPage {hasPreviousPage=value}
  historyCompleteProven=telemetry.checkProgress.historyCompleteProven
  paginationProgressObserved = telemetry.checkProgress.paginationProgressObserved || telemetry.pagination.currentlyProgressing || telemetry.pagination.replayProgressObserved || telemetry.pagination.olderHistoryProgressObserved
  if timeoutState=="timed_out" {finalPaginationState=timeoutReason}
  else if telemetry.paginationNoProgressTriggered {finalPaginationState="pagination_no_progress"}
  else if telemetry.pagination.currentlyProgressing {finalPaginationState="progressing"}
  else if telemetry.hasPreviousPage==false {finalPaginationState="history_complete"}
  else if telemetry.historyResponses>0 {finalPaginationState="history_received"}
  else if telemetry.historyRequests>0 {finalPaginationState="waiting_history"}
 }
 mutating func finish(terminal:String,telemetry:ChatCheckStageTelemetry?){
  let allowedTerminal=terminal.range(of:"^[A-Za-z0-9_ ·.-]{1,96}$",options:.regularExpression) != nil ? terminal:"unknown_terminal"
  terminalResult=allowedTerminal
  if allowedTerminal.hasPrefix("Complete"){terminalReason="complete"}
  else if allowedTerminal.contains("pagination_no_progress"){terminalReason="pagination_no_progress"}
  else if allowedTerminal.contains("no_progress") && allowedTerminal.contains("waiting_history"){terminalReason="waiting_history"}
  else if allowedTerminal.contains("timeout_absolute_cap"){terminalReason="timeout_absolute_cap"}
  else if allowedTerminal.contains("per_chat_timeout"){terminalReason="per_chat_timeout"}
  else if allowedTerminal.hasPrefix("Partial"){terminalReason="partial"}
  else if allowedTerminal.hasPrefix("Failed"){terminalReason="failed"}
  else {terminalReason="other"}
  if allowedTerminal.contains("per_chat_timeout") || allowedTerminal.contains("timeout_absolute_cap") {
   timeoutState="timed_out"
   timeoutReason=allowedTerminal.contains("timeout_absolute_cap") ? "timeout_absolute_cap":"per_chat_timeout"
  }
  if let telemetry {observe(telemetry:telemetry)}
  if timeoutState=="timed_out" {finalPaginationState=timeoutReason}
 }
 var compactSummary:String {
  return "Chat \(ordinal) · \(terminalResult) · reason \(terminalReason) · requests/responses \(historyRequestsObserved)/\(historyResponsesObserved) · parser attempted/accepted/rejected \(parserAttempted)/\(parserAccepted)/\(parserRejected) · endpoint_unrecognized \(endpointNotRecognized) · top reason \(topRejectionReason) · pages/messages \(pagesProduced)/\(messagesProduced) · callbacks \(pageUpdateCallbacks) · DOM turns \(domTurnsObserved.map(String.init) ?? "unknown") · hasPreviousPage \(hasPreviousPage.map{$0 ? "yes":"no"} ?? "unknown") · progress \(paginationProgressObserved ? "yes":"no") · pagination \(finalPaginationState) · timeout \(timeoutState)/\(timeoutReason)"
 }
 var topRejectionReason:String {rejectionCounts.sorted{a,b in a.value==b.value ? a.key<b.key:a.value>b.value}.first?.key ?? "none"}
 var detailedResponseSummary:String {
  guard !responseEntries.isEmpty else{return "Chat \(ordinal): no sanitized history response details"}
  return responseEntries.enumerated().map {index,e in
   let keys=e.topLevelKeyNames.sorted().joined(separator:",")
   let arrays=e.topLevelArrayCounts.keys.sorted().map{"\($0)=\(e.topLevelArrayCounts[$0] ?? 0)"}.joined(separator:",")
   let category=e.endpointTemplate.contains("/messages") ? "conversation_messages":(e.endpointTemplate.contains("/conversations/:id") ? "conversation_detail":"other")
   return "Chat \(ordinal) response \(index+1) · endpoint_category \(category) · \(e.transport) HTTP \(e.status) \(e.contentTypeCategory) · shape \(e.topLevelType) keys [\(keys)] arrays [\(arrays)] · expected conversation/messages/mapping/pageInfo/hasPrevious \(e.expectedConversationId)/\(e.expectedMessagesArray)/\(e.mappingObjectPresent)/\(e.pageInfoObjectPresent)/\(e.hasPreviousPageField) · parser attempted/accepted \(e.parserAttempted)/\(e.parserAccepted) · rejection \(e.rejectionReason) · extracted \(e.extractedMessageCount.map(String.init) ?? "unknown") messages / \(e.extractedPageCount) pages · hasPreviousPage \(e.hasPreviousPage.map{$0 ? "yes":"no"} ?? "unknown") · callback \(e.pageUpdateCallbackFired ? "yes":"no")"
  }.joined(separator:"\n")
 }
 var completionSummary:String {
  guard let d=completionDecision else{return "Chat \(ordinal) · completion not evaluated"}
  return "Chat \(ordinal) · messages \(d.aggregateMessages) · hasPreviousPage \(d.hasPreviousPage.map{$0 ? "yes":"no"} ?? "unknown") · completion \(d.accepted ? "accepted":"rejected") · reason \(d.reason)"
 }
 var completionDetail:String {
  guard let d=completionDecision else{return "Chat \(ordinal) completion decision: not evaluated"}
  let endpoints=responseEntries.filter{$0.parserAccepted}.map{$0.endpointTemplate.contains("/messages") ? "conversation_messages":($0.endpointTemplate.contains("/conversations/:id") ? "conversation_detail":"other")}.suffix(20).joined(separator:",")
  let falsePage=responseEntries.contains{$0.parserAccepted && $0.hasPreviousPage==false} ? "yes":"no"
  return "Chat \(ordinal) completion trace · accepted history responses \(parserAccepted) · endpoint categories [\(endpoints.isEmpty ? "none":endpoints)] · aggregate messages at decision \(d.aggregateMessages) · latest hasPreviousPage \(d.hasPreviousPage.map{$0 ? "yes":"no"} ?? "unknown") · false page observed \(falsePage) · aggregate non-empty then \(d.aggregateMessages>0 ? "yes":"no") · historyComplete set \(d.historyComplete ? "yes":"no") · completion candidate \(d.candidate ? "yes":"no") · completion proof \(d.accepted ? "accepted":"rejected") · rejection reason \(d.reason) · terminal result \(terminalResult) · persisted messages \(d.persistedMessages.map(String.init) ?? "unknown") · persisted historyComplete \(d.persistedHistoryComplete.map{$0 ? "true":"false"} ?? "unknown") · persisted hasPreviousPage \(d.persistedHasPreviousPage.map{$0 ? "true":"false"} ?? "unknown")"
 }
}

struct ChatCompletionDecisionDiagnostic:Codable,Equatable {
 let candidate:Bool;let accepted:Bool;var reason:String;let aggregateMessages:Int;let hasPreviousPage:Bool?;let historyComplete:Bool
 var persistedHistoryComplete:Bool?;var persistedHasPreviousPage:Bool?;var persistedMessages:Int?
}

struct PerChatHistoryDiagnostics:Codable,Equatable {
 var chats:[PerChatHistoryDiagnostic]=[]
 var activeOrdinal:Int?
 mutating func reset(){chats=[];activeOrdinal=nil}
 mutating func begin(ordinal:Int){
  let safe=max(1,ordinal)
  if chats.contains(where:{$0.ordinal==safe}) {activeOrdinal=safe;return}
  chats.append(PerChatHistoryDiagnostic(ordinal:safe));activeOrdinal=safe
 }
 private mutating func updateActive(_ body:(inout PerChatHistoryDiagnostic)->Void){
  guard let activeOrdinal,let index=chats.firstIndex(where:{$0.ordinal==activeOrdinal}) else{return}
  body(&chats[index])
 }
 mutating func recordRequest(){updateActive{$0.recordHistoryRequest()}}
 mutating func recordObservedResponse(){updateActive{$0.recordHistoryResponse()}}
 mutating func append(_ entry:HistoryResponseParseEntry){updateActive{$0.append(entry)}}
 mutating func finish(terminal:String,telemetry:ChatCheckStageTelemetry?){updateActive{$0.finish(terminal:terminal,telemetry:telemetry)};activeOrdinal=nil}
 mutating func observe(telemetry:ChatCheckStageTelemetry){updateActive{$0.observe(telemetry:telemetry)}}
 mutating func recordCompletionDecision(candidate:Bool,accepted:Bool,reason:String,aggregate:SafeAggregate,hasPreviousPage:Bool?,historyComplete:Bool){updateActive{$0.recordCompletionDecision(candidate:candidate,accepted:accepted,reason:reason,aggregate:aggregate,hasPreviousPage:hasPreviousPage,historyComplete:historyComplete)}}
 mutating func recordPersistedAggregate(_ aggregate:SafeAggregate?){updateActive{$0.recordPersistedAggregate(aggregate)}}
 var summary:String {chats.map{$0.completionSummary}.joined(separator:"\n")}
 var detailedResponseSummary:String {chats.flatMap{[$0.compactSummary,$0.detailedResponseSummary,$0.completionDetail]}.joined(separator:"\n")}
}
func chatCheckTraceTerminalReason(_ result:String)->ChatCheckTraceReason {
 let value=result.lowercased()
 if value.contains("no_progress") && value.contains("waiting_history") {return .terminalNoProgressWaitingHistory}
 if value.contains("navigation_provisional_failed") || value.contains("navigation_failed") || value.contains("navigation_not_started") {return .terminalNavigationFailure}
 if value.hasPrefix("complete") {return .terminalComplete}
 if value.hasPrefix("partial") {return .terminalPartial}
 if value.hasPrefix("timed out") || value.contains("timeout") {return .terminalTimeout}
 return .terminalFailure
}
func chatCheckTraceHistoryResponseReason(status:Int?)->(ChatCheckTraceResult,ChatCheckTraceReason) {
 guard let status else{return (.failure,.historyResponseUnknown)}
 if status==429 {return (.failure,.historyResponse429)}
 if (200...299).contains(status) {return (.success,.historyResponse2xx)}
 return (.failure,.historyResponseError)
}

struct CycleState: Codable {
 var enabled = false
 var lastSeenProvenanceSchemaVersion:Int? = 1
 var nextRun: Date? = nil
 var records: [String: ChatRecord] = [:]
 var lastStatus = "No cycle yet"
 var lastCycleAt: Date? = nil
 var lastCycleTrigger: String? = nil
 var lastCycleStartedHidden: Bool? = nil
 var lastCoverageStatus: CoverageStatus? = nil
 var lastOrderingIssue: String? = nil
 var lastCoverageDetail: String? = nil
 var lastCoverageCutoff: Double? = nil
 var lastOldestObservedAt: Double? = nil
 var lastDiscoveredPages: Int? = nil
 var lastDiscoveredListResponses: Int? = nil
 var lastDiscoveredConversations: Int? = nil
 var discoveryStatus: DiscoveryStatus? = nil
 var monitoringDegraded:Bool? = nil
 var lastMonitoringNotificationAt:Double? = nil
 var notificationAudit:[NotificationAuditRecord]? = nil
 var lastCycleGeneration:String? = nil
 var lastStarredCoverageProofState:StarredCoverageProofState? = nil
 var lastCycleNotificationsAccepted:Int? = nil
 var lastCycleNotificationsSuppressed:Int? = nil
 var lastSuccessfulDiscoveryAt: Date? = nil
 var lastRenderReadiness:RenderReadinessDiagnostic? = nil
 var lastChatCheckTrace:PersistedChatCheckTrace? = nil
 var lastHistoryResponseParsing:HistoryResponseParsingState? = nil
 var perChatHistoryDiagnostics:PerChatHistoryDiagnostics? = nil
 var historyProgressEventRejections:HistoryProgressEventRejectionState? = nil
 var lastPinnedUnknownRows:[PinnedUnknownRowDiagnostic]? = nil
 var lastRootRequestCorrelation:RootRequestCorrelationState? = nil
 mutating func beginHistoryResponseParsing(){lastHistoryResponseParsing=HistoryResponseParsingState()}
 mutating func beginPerChatHistoryDiagnostic(ordinal:Int){if perChatHistoryDiagnostics==nil{perChatHistoryDiagnostics=PerChatHistoryDiagnostics()};perChatHistoryDiagnostics?.begin(ordinal:ordinal)}
 mutating func recordHistoryResponseParsing(_ data:[String:Any],at:Date=Date()) {
  recordHistoryResponseParsing(HistoryResponseParseEntry.make(data,at:at))
 }
 mutating func recordHistoryResponseParsing(_ entry:HistoryResponseParseEntry) {
  if lastHistoryResponseParsing==nil {lastHistoryResponseParsing=HistoryResponseParsingState()}
  lastHistoryResponseParsing?.append(entry);perChatHistoryDiagnostics?.append(entry)
 }
 mutating func recordObservedHistoryResponse(){if lastHistoryResponseParsing==nil {lastHistoryResponseParsing=HistoryResponseParsingState()};lastHistoryResponseParsing?.recordObservedResponse();perChatHistoryDiagnostics?.recordObservedResponse()}
 mutating func recordObservedHistoryRequest(){perChatHistoryDiagnostics?.recordRequest()}
 mutating func observePerChatHistoryDiagnostic(_ telemetry:ChatCheckStageTelemetry){perChatHistoryDiagnostics?.observe(telemetry:telemetry)}
 mutating func recordPerChatCompletionDecision(candidate:Bool,accepted:Bool,reason:String,aggregate:SafeAggregate,hasPreviousPage:Bool?,historyComplete:Bool){perChatHistoryDiagnostics?.recordCompletionDecision(candidate:candidate,accepted:accepted,reason:reason,aggregate:aggregate,hasPreviousPage:hasPreviousPage,historyComplete:historyComplete)}
 mutating func recordPerChatPersistedAggregate(_ aggregate:SafeAggregate?){perChatHistoryDiagnostics?.recordPersistedAggregate(aggregate)}
 mutating func finishPerChatHistoryDiagnostic(terminal:String,telemetry:ChatCheckStageTelemetry?){perChatHistoryDiagnostics?.finish(terminal:terminal,telemetry:telemetry)}
 mutating func recordHistoryProgressEventRejection(_ reason:String){if historyProgressEventRejections==nil{historyProgressEventRejections=HistoryProgressEventRejectionState()};historyProgressEventRejections?.record(reason)}
 mutating func recordRenderReadiness(phase:String,result:RenderReadinessResult,reason:String,routeCategory:RenderReadinessRouteCategory,timestamp:Date=Date()) {
  lastRenderReadiness=RenderReadinessDiagnostic(phase:phase,result:result,reason:reason,routeCategory:routeCategory,timestamp:timestamp)
 }
 mutating func beginChatCheckTrace(route:SanitizedChatCheckRoute,at:Date=Date()) {
  var trace=PersistedChatCheckTrace(startedAt:at)
  trace.append(stage:.checkStarted,result:.success,route:route,reason:.started,at:at)
  lastChatCheckTrace=trace
 }
 mutating func appendChatCheckTrace(stage:ChatCheckTraceStage,result:ChatCheckTraceResult,route:SanitizedChatCheckRoute,reason:ChatCheckTraceReason,at:Date=Date()) {
  guard var trace=lastChatCheckTrace else{return}
  trace.append(stage:stage,result:result,route:route,reason:reason,at:at)
  lastChatCheckTrace=trace
 }
 mutating func merge(_ rows: [[String: Any]],source:LastSeenUpdatedAtSource,observedAt:Double=Date().timeIntervalSince1970*1000) {
  for r in rows {
   guard let id=r["conversationId"] as? String, id.range(of: "^[A-Za-z0-9-]+$",options:.regularExpression) != nil,
    let title=r["title"] as? String, let time=r["updatedAt"] as? Double,time.isFinite else {continue}
   if var record=records[id] {
    if time>record.lastSeenUpdatedAt || (time==record.lastSeenUpdatedAt && source.isTrustedForRecentCoverage && !record.lastSeenUpdatedAtSource.isTrustedForRecentCoverage) {
     record.title=title;record.lastSeenUpdatedAt=time;record.lastSeenUpdatedAtSource=source;record.lastSeenUpdatedAtObservedAt=observedAt
     if let acknowledged=record.uncertainAcknowledgedAt,time>acknowledged {record.uncertainAcknowledgedAt=nil}
     records[id]=record
    } else if time==record.lastSeenUpdatedAt && source==record.lastSeenUpdatedAtSource {
     record.title=title;record.lastSeenUpdatedAtObservedAt=observedAt;records[id]=record
    }
   } else {
    records[id]=ChatRecord(conversationId:id,title:title,lastSeenUpdatedAt:time,lastSeenUpdatedAtSource:source,lastSeenUpdatedAtObservedAt:observedAt)
   }
  }
 }
 func recent(_ now: Double, ids: Set<String>) -> [ChatRecord] {
  records.values.filter {ids.contains($0.conversationId) && $0.lastSeenUpdatedAt>=now-21600000 && $0.lastSeenUpdatedAt<=now}.sorted {$0.lastSeenUpdatedAt>$1.lastSeenUpdatedAt}
 }
 func queue(_ recent: [ChatRecord]) -> [ChatRecord] {
  recent.filter {riskMeasurementStatus(result:$0.lastCheckResult,aggregate:$0.aggregate) != .complete || $0.lastCheckedUpdatedAt == nil || $0.lastSeenUpdatedAt > $0.lastCheckedUpdatedAt!}.sorted {a,b in
   if (a.lastCheckedUpdatedAt != nil) != (b.lastCheckedUpdatedAt != nil) {return a.lastCheckedUpdatedAt != nil}
   return a.lastSeenUpdatedAt>b.lastSeenUpdatedAt
  }
 }
}

struct PinnedUnknownRowDiagnostic:Codable,Equatable {
 let positionIndex:Int
 let tag:String
 let routeTemplate:String
 let hasHref:Bool
 let hasOctaneNavigationItem:Bool
 let dataAttributeNames:[String]
 let ariaAttributeNames:[String]
 let visible:Bool
 let conversationRouteClassification:String
 let navigationRowClassification:String
 let pinnedStarredClassification:String
 let structuralClassification:String
 let rejectionReason:String

 static let maxRows=20
 private static func safeName(_ value:Any?,prefix:String)->String? {
  guard let name=value as? String,name.range(of:"^\(prefix)-[a-z0-9_-]{1,48}$",options:.regularExpression) != nil else{return nil}
  return name
 }
 private static func safeToken(_ value:Any?,allowed:Set<String>,fallback:String)->String {
  guard let value=value as? String,allowed.contains(value) else{return fallback};return value
 }
 static func make(_ raw:[String:Any])->PinnedUnknownRowDiagnostic? {
  let index=max(1,min(256,(raw["positionIndex"] as? NSNumber)?.intValue ?? 1))
  let tagRaw=(raw["tag"] as? String ?? "unknown").lowercased()
  let tag=tagRaw.range(of:"^[a-z][a-z0-9-]{0,15}$",options:.regularExpression) != nil ? tagRaw:"unknown"
  let templateRaw=raw["routeTemplate"] as? String ?? "/unknown"
  let routeTemplate=templateRaw.range(of:"^/(?:[a-z0-9_-]{1,24}|:id)(?:/(?:[a-z0-9_-]{1,24}|:id)){0,3}$",options:.regularExpression) != nil ? templateRaw:"/unknown"
  func names(_ key:String,_ prefix:String)->[String] {
   let values=(raw[key] as? [String] ?? []).compactMap{safeName($0,prefix:prefix)}
   return Array(Set(values)).sorted().prefix(16).map{$0}
  }
  let route=safeToken(raw["conversationRouteClassification"],allowed:["conversation","project","other","unknown"],fallback:"unknown")
  let navigation=safeToken(raw["navigationRowClassification"],allowed:["conversation_row","project_navigation_row","navigation_action_row","unclassified_navigation_row"],fallback:"unclassified_navigation_row")
  let pin=safeToken(raw["pinnedStarredClassification"],allowed:["unknown","pinned","not_pinned"],fallback:"unknown")
  let structural=safeToken(raw["structuralClassification"],allowed:["octane_conversation_row_variant","conversation_row_variant","project_navigation_row","navigation_action_row","unclassified_sidebar_row"],fallback:"unclassified_sidebar_row")
  let reason=safeToken(raw["rejectionReason"],allowed:["menu_trigger_missing","menu_failed_to_open","menu_items_missing","ambiguous_actions","pin_and_unpin_action_missing","snapshot_changed","unsupported_row_shape","cleanup_failed","row_missing_after_snapshot","unknown_pin_state"],fallback:"unknown_pin_state")
  return PinnedUnknownRowDiagnostic(positionIndex:index,tag:tag,routeTemplate:routeTemplate,hasHref:raw["hasHref"] as? Bool ?? false,hasOctaneNavigationItem:raw["hasOctaneNavigationItem"] as? Bool ?? false,dataAttributeNames:names("dataAttributeNames","data"),ariaAttributeNames:names("ariaAttributeNames","aria"),visible:raw["visible"] as? Bool ?? false,conversationRouteClassification:route,navigationRowClassification:navigation,pinnedStarredClassification:pin,structuralClassification:structural,rejectionReason:reason)
 }
 var compactLine:String {"row \(positionIndex) · \(structuralClassification) · reason \(rejectionReason)"}
 var detailLine:String {"\(compactLine) · tag \(tag) · route \(routeTemplate) · href \(hasHref ? "yes":"no") · octane \(hasOctaneNavigationItem ? "yes":"no") · visible \(visible ? "yes":"no") · conversation \(conversationRouteClassification) · navigation \(navigationRowClassification) · pinned/starred \(pinnedStarredClassification) · data [\(dataAttributeNames.joined(separator:", "))] · aria [\(ariaAttributeNames.joined(separator:", "))]"}
}

enum BundleIdentityMigrationStatus:String {
 case notNeeded="not needed"
 case migrated="migrated"
 case cleanInstall="clean install"
 case failed="failed"
}
struct BundleIdentityMigrationPlan {
 let status:BundleIdentityMigrationStatus
 let valuesToWrite:[String:Any]
 let shouldSetCompletionMarker:Bool
 let failureReason:String?
}
let legacyBundleIdentityDefaultsDomain="local.GPTLimitsTool.Feasibility"
let bundleIdentityMigrationMarkerKey="bundleIdentityMigrationV1Completed"
let bundleIdentityMigrationFailureKey="bundleIdentityMigrationV1Failure"
let nativeCycleStateDefaultsKey="nativeCycleStateV1"
func bundleIdentityMigrationPlan(legacy:[String:Any],current:[String:Any])->BundleIdentityMigrationPlan {
 if current[bundleIdentityMigrationMarkerKey] as? Bool == true {
  return BundleIdentityMigrationPlan(status:.notNeeded,valuesToWrite:[:],shouldSetCompletionMarker:false,failureReason:nil)
 }
 var writes=[String:Any]()
 if current[nativeCycleStateDefaultsKey] != nil {
  if current[showChatTitlesInNotificationsDefaultsKey] == nil,
     let legacySetting=legacy[showChatTitlesInNotificationsDefaultsKey] as? Bool {
   writes[showChatTitlesInNotificationsDefaultsKey]=legacySetting
  }
  return BundleIdentityMigrationPlan(status:.notNeeded,valuesToWrite:writes,shouldSetCompletionMarker:true,failureReason:nil)
 }
 if let legacyState=legacy[nativeCycleStateDefaultsKey] {
  guard let data=legacyState as? Data,
        (try? JSONDecoder().decode(CycleState.self,from:data)) != nil else {
   return BundleIdentityMigrationPlan(status:.failed,valuesToWrite:[:],shouldSetCompletionMarker:false,failureReason:"legacy_state_invalid")
  }
  writes[nativeCycleStateDefaultsKey]=data
  if current[showChatTitlesInNotificationsDefaultsKey] == nil,
     let legacySetting=legacy[showChatTitlesInNotificationsDefaultsKey] as? Bool {
   writes[showChatTitlesInNotificationsDefaultsKey]=legacySetting
  }
  return BundleIdentityMigrationPlan(status:.migrated,valuesToWrite:writes,shouldSetCompletionMarker:true,failureReason:nil)
 }
 if current[showChatTitlesInNotificationsDefaultsKey] == nil,
    let legacySetting=legacy[showChatTitlesInNotificationsDefaultsKey] as? Bool {
  writes[showChatTitlesInNotificationsDefaultsKey]=legacySetting
 }
 return BundleIdentityMigrationPlan(status:.cleanInstall,valuesToWrite:writes,shouldSetCompletionMarker:true,failureReason:nil)
}

enum DiscoveryStatus: String, Codable {case notRun="not_run",inProgress="in_progress",success,rateLimited="rate_limited",incomplete}

enum HiddenRenderOutcome: String {case suspensionConfirmed="hidden_render_suspension_confirmed",activationNoEffect="render_activation_no_effect",hiddenAvailable="hidden_render_available"}
func hiddenRenderOutcome(hiddenList:Int,hiddenLinks:Int,activeList:Int,activeLinks:Int)->HiddenRenderOutcome {
 if hiddenLinks>0{return .hiddenAvailable}
 if hiddenList==0&&hiddenLinks==0&&activeList>0&&activeLinks>0{return .suspensionConfirmed}
 return .activationNoEffect
}
struct RenderSurfaceControlState: Equatable {
 var webViewHidden:Bool
 var windowVisible:Bool
 var ignoresMouseEvents:Bool
 var appActive:Bool
 var keyWindow:Bool
 var mainWindow:Bool
}
enum BackgroundRenderLeaseError: Error {
 case busy
 case pageUnavailable
 case activationFailed
 case readinessTimeout
 case readinessUnavailable
 case readinessFailed(String)
}
enum PinnedNavigationPreflightDecision: Equatable {
 case staleOperation, frontendRouteMissing, webViewUnavailable, renderLeaseUnavailable, ready
 var reason:String? {
  switch self {
  case .staleOperation:return "stale_operation"
  case .frontendRouteMissing:return "frontend_route_missing"
  case .webViewUnavailable:return "webview_unavailable"
  case .renderLeaseUnavailable:return "render_lease_unavailable"
  case .ready:return nil
  }
 }
}
func pinnedNavigationPreflightDecision(operationCurrent:Bool,routeAvailable:Bool,webViewAvailable:Bool,renderLeaseVerified:Bool)->PinnedNavigationPreflightDecision {
 if !operationCurrent{return .staleOperation}
 if !routeAvailable{return .frontendRouteMissing}
 if !webViewAvailable{return .webViewUnavailable}
 if !renderLeaseVerified{return .renderLeaseUnavailable}
 return .ready
}
func pinnedNavigationDeadlineReason(commandSent:Bool)->String {commandSent ? "navigation_timeout":"pre_navigation_timeout"}
func pinnedTimestampFailureReason(childReason:String,fallbackReason:String)->String {childReason == "none" ? fallbackReason:childReason}

func pinnedActivityLiveWaitCanFinish(state:String)->Bool {state == "waiting"}
struct BackgroundRenderLeaseGate {
 private(set) var owner:String?
 mutating func acquire(_ candidate:String)->Bool {
  guard owner==nil,!candidate.isEmpty else{return false}
  owner=candidate;return true
 }
 @discardableResult mutating func release(_ candidate:String)->Bool {
  guard owner==candidate else{return false}
  owner=nil;return true
 }
}
func renderSurfaceRestored(original:RenderSurfaceControlState,current:RenderSurfaceControlState)->Bool {original==current}
func renderSurfaceActivationPreservesFocus(original:RenderSurfaceControlState,current:RenderSurfaceControlState)->Bool {
 original.appActive==current.appActive&&original.keyWindow==current.keyWindow&&original.mainWindow==current.mainWindow
}
func renderLeaseMayRestoreKeyMain(original:RenderSurfaceControlState,current:RenderSurfaceControlState)->Bool {
 original.appActive && current.appActive && original.windowVisible
}
func renderLeaseApplicationActivationPreserved(original:RenderSurfaceControlState,current:RenderSurfaceControlState)->Bool {
 original.appActive == current.appActive
}

func logicalDiscoveryPageSignature(endpointClass: String, partition: String, offset: Int?, cursorPresent: Bool,
                                   records: [[String:Any]]) -> String? {
 let rows=records.map { record -> [String:Any] in
  ["id":record["conversationId"] as? String ?? "", "title":record["title"] as? String ?? "",
   "updatedAt":record["updatedAt"] as? Double ?? 0]
 }
 let position=offset.map { "offset:\($0)" } ?? (cursorPresent ? "cursor" : "unknown")
 guard let data=try? JSONSerialization.data(withJSONObject:["endpoint":endpointClass,"partition":partition,"position":position,"rows":rows],options:[.sortedKeys]) else{return nil}
 return SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined()
}

enum CoverageStatus: String, Codable {
 case completeAccount = "complete_account"
 case completeNonArchived = "complete_non_archived"
 case incompletePartitions = "incomplete_partitions"
 case completeCutoff = "complete_cutoff"
 case completeEndOfList = "complete_end_of_list"
 case incompleteGlobalNotObserved = "incomplete_global_not_observed"
 case incompleteSafetyLimit = "incomplete_safety_limit"
 case incompleteStall = "incomplete_stall"
 case incompleteOrdering = "incomplete_ordering"
}

let scheduledDiscoveryInterval: TimeInterval = 30 * 60
func discoveryRateLimited(_ statusCodes:[Int])->Bool {statusCodes.contains(429)}
func nextDiscoveryRun(after date:Date)->Date {date.addingTimeInterval(scheduledDiscoveryInterval)}
enum PinnedTimestampState: String {
 case notStarted = "not_started"
 case resolving = "resolving"
 case resolved = "resolved"
 case partial = "partial"
 case timeout = "timeout"
 case error = "error"
 case skipped = "skipped"
 var isTerminal:Bool {self == .resolved || self == .partial || self == .timeout || self == .error || self == .skipped}
}
func pinnedTimestampAggregateState(resolved:Int,total:Int,timeouts:Int,errors:Int)->PinnedTimestampState {
 if total<=0{return .skipped}
 if resolved>=total{return .resolved}
 if resolved>0{return .partial}
 if errors>0{return .error}
 if timeouts>0{return .timeout}
 return .error
}
func pinnedTimestampItemCanTransition(from current:String,to next:PinnedTimestampState)->Bool {
 current=="pending" && (next == .resolved || next == .timeout || next == .error)
}
func pinnedDiagnosticCanFinish(timestampExpected:Bool,timestampState:PinnedTimestampState,itemStates:[String]=[])->Bool {
 timestampState.isTerminal && (!timestampExpected || !itemStates.contains("pending"))
}

func pinnedActivityRecency(times:[Double],expectedCount:Int,cutoff:Double,now:Double)->String {
 guard expectedCount>0,times.count==expectedCount,times.allSatisfy({$0.isFinite && $0>0 && $0<=now}) else{return "Unknown"}
 let recent=times.filter{$0>=cutoff}.count
 if recent==expectedCount{return "Yes"}
 if recent==0{return "No"}
 return "Mixed"
}

enum ListDiagnosticReason: String {
 case requestNotObserved = "list_request_not_observed"
 case requestFailed = "list_request_failed"
 case responseNotRecognized = "list_response_not_recognized"
 case recognized = "recognized"
}

func classifyListDiagnostic(requests: Int, resourceObserved: Bool = false, responses: Int, failures: Int, statusCodes: [Int], recognized: Bool) -> ListDiagnosticReason {
 if requests == 0 && !resourceObserved {return .requestNotObserved}
 if responses == 0 {return .requestFailed}
 let hasSuccessfulResponse=statusCodes.contains(where:{$0 >= 200 && $0 < 300})
 if !statusCodes.isEmpty && !hasSuccessfulResponse && statusCodes.allSatisfy({$0 < 200 || $0 >= 300}) {return .requestFailed}
 if failures > 0 && !hasSuccessfulResponse && statusCodes.isEmpty {return .requestFailed}
 return recognized ? .recognized : .responseNotRecognized
}

struct CycleGate {
 private(set) var running=false
 mutating func begin() -> Bool {if running{return false};running=true;return true}
 mutating func end(){running=false}
}
func pageOrderingIsValid(_ current: [Double], previousOldest: Double?) -> Bool {
 guard !current.isEmpty,current.allSatisfy({$0.isFinite}),zip(current,current.dropFirst()).allSatisfy({$0 >= $1}) else{return false}
 guard let previousOldest else{return true}
 return previousOldest >= current[0]
}

enum ListScope: String, Equatable { case global, project, filtered, unclassified }
enum PaginationKind: String, Equatable { case offset, cursor, unknown }

struct CoveragePage {
 var scope: ListScope
 var streamId: Int
 var sequence: Int
 var paginationKind: PaginationKind
 var offset: Int?
 var limit: Int?
 var queryKeys: [String]
 var requestCursorPresent = false
 var sortOrder: String? = nil
 var httpStatus: Int? = 200
 var recordCountMatches = true
 var cursorPresent: Bool
 var cursorNull: Bool
 var cursorType: String
 var itemCount: Int
 var timestampsValid: Bool
 var times: [Double]
 init(scope: ListScope = .global, streamId: Int = 0, sequence: Int = 0, paginationKind: PaginationKind = .offset,
      offset: Int? = nil, limit: Int? = nil, queryKeys: [String] = [], cursorPresent: Bool = false, cursorNull: Bool = false, cursorType: String = "undefined",
      itemCount: Int, timestampsValid: Bool, times: [Double]) {
  self.scope=scope;self.streamId=streamId;self.sequence=sequence;self.paginationKind=paginationKind
  self.offset=offset;self.limit=limit;self.queryKeys=queryKeys;self.cursorPresent=cursorPresent;self.cursorNull=cursorNull;self.cursorType=cursorType
  self.itemCount=itemCount;self.timestampsValid=timestampsValid;self.times=times
 }
}

// Only HMAC equality tokens enter this registry. It is never encoded in CycleState.
struct OriginLabelRegistry {
 private var labels: [String:String] = [:]
 mutating func label(_ token: String?) -> String? {
  guard let token,token.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil else{return nil}
  if let existing=labels[token]{return existing}
  let next="origin#\(labels.count+1)";labels[token]=next;return next
 }
 mutating func reset(){labels=[:]}
}
struct RawPartitionDescriptor: Decodable {
 var archived:Bool?;var starred:Bool?;var includeOrigin:String?;var excludeOrigin:String?
 var unknownScopeKeys:[String];var valid:Bool
}
struct PartitionDescriptor: Hashable {
 var archived:Bool? = nil
 var starred:Bool? = nil
 var includeOrigin:String? = nil
 var excludeOrigin:String? = nil
 var unknownScopeKeys:[String] = []
 var valid=true
 var base: PartitionDescriptor {var copy=self;copy.includeOrigin=nil;copy.excludeOrigin=nil;return copy}
 var text:String {
  func flag(_ value:Bool?)->String {value.map{$0 ? "true":"false"} ?? "omitted"}
  return "archived=\(flag(archived)), starred=\(flag(starred)), include=\(includeOrigin ?? "—"), exclude=\(excludeOrigin ?? "—")" + (unknownScopeKeys.isEmpty ? "":" · unknown keys \(unknownScopeKeys.joined(separator:","))") + (valid ? "":" · invalid descriptor")
 }
 static func decode(_ data:[String:Any], registry:inout OriginLabelRegistry)->PartitionDescriptor? {
  guard let encoded=try? JSONSerialization.data(withJSONObject:data),let raw=try? JSONDecoder().decode(RawPartitionDescriptor.self,from:encoded) else{return nil}
  let included=registry.label(raw.includeOrigin),excluded=registry.label(raw.excludeOrigin)
  return PartitionDescriptor(archived:raw.archived,starred:raw.starred,includeOrigin:included,excludeOrigin:excluded,unknownScopeKeys:raw.unknownScopeKeys.filter{$0.range(of:"^[A-Za-z][A-Za-z0-9_-]{0,39}$",options:.regularExpression) != nil},valid:raw.valid && raw.unknownScopeKeys.isEmpty && (raw.includeOrigin==nil || included != nil) && (raw.excludeOrigin==nil || excluded != nil) && !(included != nil && excluded != nil))
 }
}
func complementaryOrigins(_ a:PartitionDescriptor,_ b:PartitionDescriptor)->Bool {
 guard a.valid,b.valid,a.unknownScopeKeys.isEmpty,b.unknownScopeKeys.isEmpty,a.base==b.base else{return false}
 return (a.includeOrigin != nil && a.excludeOrigin==nil && b.includeOrigin==nil && a.includeOrigin==b.excludeOrigin) ||
        (b.includeOrigin != nil && b.excludeOrigin==nil && a.includeOrigin==nil && b.includeOrigin==a.excludeOrigin)
}
func hasCompletePartitionSet(_ observations:[PartitionObservation],base:PartitionDescriptor,cutoff:Double)->Bool {
 let rows=observations.filter{$0.descriptor.valid && $0.descriptor.unknownScopeKeys.isEmpty && $0.descriptor.base==base}
 let completeStatuses:Set<PartitionStatus>=[.completeCutoff,.completeEnd]
 if rows.contains(where:{$0.descriptor.includeOrigin==nil && $0.descriptor.excludeOrigin==nil && completeStatuses.contains($0.status(cutoff:cutoff))}) {return true}
 for (index,a) in rows.enumerated() {
  for b in rows.dropFirst(index+1) where complementaryOrigins(a.descriptor,b.descriptor) {
   if completeStatuses.contains(a.status(cutoff:cutoff)) && completeStatuses.contains(b.status(cutoff:cutoff)){return true}
  }
 }
 return false
}
func samePartitionSelectorsIgnoringStarred(_ a:[PartitionObservation],_ b:[PartitionObservation])->Bool {
 guard a.count==b.count else{return false}
 func normalized(_ rows:[PartitionObservation])->Set<PartitionDescriptor> {
  Set(rows.map{row in var descriptor=row.descriptor;descriptor.starred=nil;return descriptor})
 }
 return normalized(a)==normalized(b)
}
enum PartitionStatus:String {case completeCutoff="complete_cutoff",completeEnd="complete_end",incompleteStall="incomplete_stall",incompleteOrdering="incomplete_ordering"}
struct PartitionObservation {
 var descriptor:PartitionDescriptor
 var pages:[CoveragePage]=[]
 var ids=Set<String>()
 var updatedTimes:[String:Double]=[:]
 var repeatedPageChanged=false
 private var pageIDs:[Int:Set<String>]=[:]
 init(descriptor:PartitionDescriptor){self.descriptor=descriptor}
 mutating func append(_ page:CoveragePage,records:[[String:Any]])->Bool {
  let prior=ids
  for record in records {if let id=record["conversationId"] as? String,let time=record["updatedAt"] as? Double,time.isFinite {ids.insert(id);updatedTimes[id]=max(time,updatedTimes[id] ?? time)}}
  if page.paginationKind == .offset,let old=pages.first(where:{$0.offset==page.offset}) {
   if old.times != page.times || old.itemCount != page.itemCount || pageIDs[page.offset ?? -1] != Set(records.compactMap{$0["conversationId"] as? String}) {repeatedPageChanged=true}
   return ids != prior
  }
  // A repeated cursor page is not pagination progress.
  if page.paginationKind == .cursor,let old=pages.last,old.times==page.times,old.itemCount==page.itemCount,ids==prior{return false}
  if let offset=page.offset {pageIDs[offset]=Set(records.compactMap{$0["conversationId"] as? String})}
  pages.append(page);return true
 }
 var orderingIssue:String? {
  guard descriptor.valid,!pages.isEmpty else{return "descriptor_or_start_missing"}
  if repeatedPageChanged{return "repeated_page_changed"}
  if pages.contains(where:{!((200..<300).contains($0.httpStatus ?? 0))}){return "http_status_not_successful"}
  if pages.contains(where:{!$0.recordCountMatches}){return "missing_or_duplicate_records"}
  if pages.contains(where:{$0.sortOrder != "updated"}){return "updated_sort_unconfirmed"}
  if pages.contains(where:{$0.paginationKind == .unknown}){return "pagination_unknown"}
  if pages.first?.paginationKind == .cursor && pages.first?.requestCursorPresent == true {return "cursor_start_missing"}
  if pages.first?.paginationKind == .offset {
   let offsets=pages.compactMap{$0.offset};if zip(offsets,offsets.dropFirst()).contains(where:{$0 >= $1}){return "natural_offset_order"}
  }
  return observedListOrderingIssue(pages)
 }
 func status(cutoff:Double)->PartitionStatus {
  if descriptor.valid && pages.isEmpty {return .incompleteStall}
  guard orderingIssue==nil else{return .incompleteOrdering}
  if let last=pages.last,last.itemCount==0{return .completeEnd}
  if pages.contains(where:{$0.timestampsValid && $0.itemCount>0 && $0.times.count==$0.itemCount && ($0.times.last ?? .infinity)<cutoff}){return .completeCutoff}
  return .incompleteStall
 }
 func recentIDs(cutoff:Double)->Set<String>{Set(updatedTimes.filter{$0.value>=cutoff}.map{$0.key})}
}
struct BaseCoverage {
 var descriptor:PartitionDescriptor
 var partitions:[PartitionObservation]
 var complete:Bool
}
struct CompositeCoverage {
 var status:CoverageStatus
 var detail:String
 var scope:String
 var proofs:[String]
 var starredCoverageSource:String = "unresolved"
 var isComplete:Bool {status == .completeAccount || status == .completeNonArchived}
}
func coverageDisplayLabel(_ coverage:CompositeCoverage)->String {
 switch coverage.status {
 case .completeNonArchived: return "Complete — non-archived, unlocked chats"
 case .completeAccount: return "Complete — all account chats"
 default: return coverage.status.rawValue
 }
}
func coverageAfterListStatus(_ composite:CompositeCoverage,statusCodes:[Int])->CompositeCoverage {
 guard statusCodes.contains(429) else{return composite}
 return CompositeCoverage(status:.incompleteStall,detail:"root_http_429",scope:"unproven",proofs:composite.proofs,starredCoverageSource:composite.starredCoverageSource)
}
func compositeCoverage(_ observations:[PartitionObservation],cutoff:Double,empiricallyConfirmedStarredMembership:Bool = false,starredProofState:StarredCoverageProofState? = nil)->CompositeCoverage {
 let valid=observations.filter{$0.descriptor.valid && $0.descriptor.unknownScopeKeys.isEmpty}
 var bases:[BaseCoverage]=[];var proofs:[String]=[]
 func complete(_ rows:[PartitionObservation])->Bool {rows.allSatisfy{[PartitionStatus.completeCutoff,.completeEnd].contains($0.status(cutoff:cutoff))}}
 for (index,a) in valid.enumerated() {
  if a.descriptor.includeOrigin==nil && a.descriptor.excludeOrigin==nil {bases.append(BaseCoverage(descriptor:a.descriptor,partitions:[a],complete:complete([a])))}
  for b in valid.dropFirst(index+1) where complementaryOrigins(a.descriptor,b.descriptor) {
   let done=complete([a,b]);bases.append(BaseCoverage(descriptor:a.descriptor.base,partitions:[a,b],complete:done))
   proofs.append("\(a.descriptor.includeOrigin ?? a.descriptor.excludeOrigin ?? "?"): include + exclude · \(a.descriptor.base.text) · \(done ? "base complete":"base incomplete")")
  }
 }
 let explicitStarredObserved=starredProofState?.explicitStarredObserved ?? valid.contains{$0.descriptor.archived==false && $0.descriptor.starred==true && !$0.pages.isEmpty}
 let pinnedProof=starredProofState?.proof
 let completed=bases.filter{$0.complete}
 func recentIDs(_ base:BaseCoverage)->Set<String> {base.partitions.reduce(into:Set<String>()){$0.formUnion($1.recentIDs(cutoff:cutoff))}}
 func starredIncluded(_ main:BaseCoverage)->Bool {
  guard main.descriptor.starred != true else{return false}
  if empiricallyConfirmedStarredMembership && main.descriptor.archived==false && main.descriptor.starred==nil {return true}
  guard main.descriptor.starred==false else{return false}
  return completed.contains { starred in
   guard starred.descriptor.archived==main.descriptor.archived,starred.descriptor.starred==true else{return false}
   return samePartitionSelectorsIgnoringStarred(main.partitions,starred.partitions)
  }
 }
 // Omitted flags have undocumented defaults. Explicit archived/starred selector
 // values establish their own scopes; omitted starred can only use explicit
 // empirical membership evidence supplied by a caller.
 if !explicitStarredObserved,let pinned=pinnedProof,pinned.complete,completed.contains(where:{$0.descriptor.archived==false&&$0.descriptor.starred==false}) {
  return CompositeCoverage(status:.completeNonArchived,detail:"base complete; starred coverage complete via pinned_prefix; archived/locked excluded",scope:"non-archived, unlocked chats",proofs:proofs,starredCoverageSource:"pinned_prefix")
 }
 let nonArchived=completed.filter{$0.descriptor.archived==false && starredIncluded($0)}
 let archived=completed.filter{$0.descriptor.archived==true && starredIncluded($0)}
 for main in completed where main.descriptor.archived==nil && main.descriptor.starred != true {
  let mainIDs=recentIDs(main)
  if nonArchived.contains(where:{recentIDs($0).isSubset(of:mainIDs)}) && archived.contains(where:{!recentIDs($0).isEmpty && recentIDs($0).isSubset(of:mainIDs)}) {
   return CompositeCoverage(status:.completeAccount,detail:"completed archived/non-archived selector sources included in complete root base",scope:"account conversations",proofs:proofs,starredCoverageSource:"explicit_partition")
  }
 }
 if !nonArchived.isEmpty {
  return CompositeCoverage(status:.completeNonArchived,detail:"starred coverage complete via explicit_partition; archived not covered",scope:"non-archived conversations",proofs:proofs,starredCoverageSource:"explicit_partition")
 }
 let missingStarred=completed.contains{$0.descriptor.archived==false && $0.descriptor.starred != true}
 if missingStarred {
  let reason:String
  if explicitStarredObserved {reason="explicit_starred_partition_incomplete"}
  else if let pinned=pinnedProof {reason=pinned.unresolvedReason}
  else if starredProofState?.fallbackStatus == .attempted {reason="pinned_prefix_in_progress"}
  else {reason="pinned_prefix_not_attempted"}
  return CompositeCoverage(status:.incompletePartitions,detail:"base complete; starred coverage unresolved · \(reason)",scope:"non-archived base selector; starred universe unproven",proofs:proofs,starredCoverageSource:"unresolved")
 }
 if completed.contains(where:{$0.descriptor.archived==nil}) {return CompositeCoverage(status:.incompletePartitions,detail:"base complete; omitted archive/starred defaults unproven",scope:"base selector only",proofs:proofs)}
 let required=bases.flatMap{$0.partitions}
 if required.contains(where:{$0.status(cutoff:cutoff) == .incompleteOrdering}) {return CompositeCoverage(status:.incompleteOrdering,detail:"required partition ordering unverified",scope:"observed partitions only",proofs:proofs)}
 if !bases.isEmpty {return CompositeCoverage(status:.incompleteStall,detail:"required partition did not cross cutoff or prove end",scope:"observed partitions only",proofs:proofs)}
 return CompositeCoverage(status:.incompletePartitions,detail:observations.isEmpty ? "no_list_response":"complementary required partition set unproven",scope:"observed partitions only",proofs:proofs)
}

func paginationKind(offset: Int?, cursorPresent: Bool) -> PaginationKind {
 if offset != nil { return .offset }; if cursorPresent { return .cursor }; return .unknown
}

func pageCrossesRecentCutoff(_ page: CoveragePage, cutoff: Double) -> Bool {
 page.scope == .global && page.paginationKind != .unknown && page.itemCount>0 && page.timestampsValid && page.times.count==page.itemCount &&
 pageOrderingIsValid(page.times,previousOldest:nil) && page.times.last!<cutoff
}

func observedListOrderingIssue(_ source: [CoveragePage], scope: ListScope? = nil) -> String? {
 let groups=Dictionary(grouping:source.filter{scope == nil || $0.scope == scope!},by:{"\($0.scope.rawValue):\($0.streamId)"})
 for pagesUnsorted in groups.values {
  let kinds=Set(pagesUnsorted.map{$0.paginationKind})
  if kinds.count>1{return "pagination_kind_changed"}
  let kind=pagesUnsorted.first?.paginationKind ?? .unknown
  let pages=kind == .offset ? pagesUnsorted.sorted{($0.offset ?? Int.max)<($1.offset ?? Int.max)} : pagesUnsorted.sorted{$0.sequence<$1.sequence}
  if kind == .offset,let first=pages.first,first.offset != 0{return "starting_offset_missing"}
  for (index,page) in pages.enumerated() {
   if page.itemCount==0 {
    if kind == .offset,index>0 {
     let previous=pages[index-1]
     guard let previousOffset=previous.offset,let currentOffset=page.offset,previousOffset+previous.itemCount==currentOffset else{return "offset_gap"}
    }
    continue
   }
   guard page.timestampsValid,page.times.count==page.itemCount else{return "invalid_timestamp"}
   guard pageOrderingIsValid(page.times,previousOldest:nil) else{return "within_page_order"}
   if index>0 {
    let previous=pages[index-1]
    if previous.itemCount>0 {
     if kind == .offset,let offset=previous.offset,let next=page.offset,offset+previous.itemCount != next {return "offset_gap"}
     guard let priorOldest=previous.times.last,priorOldest>=page.times[0] else{return "between_page_order"}
    }
   }
  }
 }
 return nil
}

func naturalEndObserved(_ pages: [CoveragePage], scope: ListScope) -> Bool {
 let candidates=pages.filter{$0.scope == scope}
 guard scope == .global,let exemplar=candidates.first else{return false}
 let last=exemplar.paginationKind == .offset ? candidates.max{($0.offset ?? Int.min)<($1.offset ?? Int.min)} : candidates.max{$0.sequence<$1.sequence}
 guard let last else{return false}
 guard last.itemCount == 0 else{return false}
 if last.paginationKind == .offset,let previous=pages.filter({$0.scope == scope && $0.streamId == last.streamId && $0.itemCount>0}).max(by:{$0.sequence<$1.sequence}) {
  guard let previousOffset=previous.offset,let endOffset=last.offset,previousOffset+previous.itemCount==endOffset else{return false}
 }
 return true
}

func coverageFromDiscovery(globalObserved: Bool = true, cutoffCrossed: Bool, naturalEnd: Bool, orderingValid: Bool, safetyLimit: Bool) -> CoverageStatus {
 if !globalObserved { return .incompleteGlobalNotObserved }
 if naturalEnd && orderingValid { return .completeEndOfList }
 if cutoffCrossed && orderingValid { return .completeCutoff }
 if safetyLimit { return .incompleteSafetyLimit }
 if !orderingValid { return .incompleteOrdering }
 return .incompleteStall
}

func isNaturalEndListPage(path: String, offset: Int, itemCount: Int, expectedNextOffset: Int?, hasLaterOffset: Bool) -> Bool {
 guard path == "/backend-api/conversations",itemCount==0,!hasLaterOffset else{return false}
 if offset==0{return expectedNextOffset==nil}
 return expectedNextOffset==offset
}
extension CycleState {
 mutating func recoverSchedule(now: Date) {
  if enabled, nextRun == nil || nextRun! <= now {nextRun=nextDiscoveryRun(after:now)}
 }
}
enum ChatCheckBudgetDeadlineAction {case reschedule,extended,timeout(String)}
enum BudgetExtensionDecisionState:String {case notEvaluated="not_evaluated",granted="evaluated_granted",denied="evaluated_denied"}
struct BudgetExtensionDecisionInput {
 let elapsedMs:Int
 let phase:String
 let hasPreviousPage:Bool?
 let genuineProgressEver:Bool
 let genuineProgressAgeMs:Int?
 let replayProgressAgeMs:Int?
 let extensionPoolRemainingMs:Int
 let absoluteTimeRemainingMs:Int
 let cycleBudgetRemainingMs:Int
 let absoluteCapReached:Bool
 let checkAlreadyTerminal:Bool
}
struct BudgetExtensionDecision {
 let state:BudgetExtensionDecisionState
 let elapsedMs:Int
 let phase:String
 let hasPreviousPage:Bool?
 let genuineProgressEver:Bool
 let genuineProgressAgeMs:Int?
 let progressLast5Seconds:Bool
 let progressLast10Seconds:Bool
 let replayProgressRecent:Bool
 let anyPaginationProgressRecent:Bool
 let extensionPoolRemainingMs:Int
 let absoluteTimeRemainingMs:Int
 let cycleBudgetRemainingMs:Int
 let reason:String?
 let grantedAmountMs:Int
 var isInternallyConsistent:Bool {
  switch state {
  case .notEvaluated:return reason==nil && grantedAmountMs==0
  case .granted:return reason != nil && grantedAmountMs>0
  case .denied:return reason != nil && !reason!.isEmpty && grantedAmountMs==0
  }
 }
}
func decideBudgetExtension(_ input:BudgetExtensionDecisionInput)->BudgetExtensionDecision {
 let genuineRecent=input.genuineProgressAgeMs.map{$0>=0 && $0<=10000} ?? false
 let replayRecent=input.replayProgressAgeMs.map{$0>=0 && $0<=10000} ?? false
 let anyRecent=genuineRecent || replayRecent
 func denied(_ reason:String)->BudgetExtensionDecision {
  BudgetExtensionDecision(state:.denied,elapsedMs:input.elapsedMs,phase:input.phase,hasPreviousPage:input.hasPreviousPage,
   genuineProgressEver:input.genuineProgressEver,genuineProgressAgeMs:input.genuineProgressAgeMs,
   progressLast5Seconds:input.genuineProgressAgeMs.map{$0>=0 && $0<=5000} ?? false,
   progressLast10Seconds:genuineRecent,replayProgressRecent:replayRecent,anyPaginationProgressRecent:anyRecent,
   extensionPoolRemainingMs:max(0,input.extensionPoolRemainingMs),absoluteTimeRemainingMs:max(0,input.absoluteTimeRemainingMs),
   cycleBudgetRemainingMs:max(0,input.cycleBudgetRemainingMs),reason:reason,grantedAmountMs:0)
 }
 if input.checkAlreadyTerminal {return denied("check_already_terminal")}
 if input.absoluteCapReached || input.absoluteTimeRemainingMs<=0 {return denied("absolute_cap_reached")}
 if input.cycleBudgetRemainingMs<=0 {return denied("cycle_budget_insufficient")}
 if !input.genuineProgressEver {return denied("no_genuine_history_progress")}
 guard let age=input.genuineProgressAgeMs,age>=0,age<=10000 else{return denied("genuine_progress_stale")}
 if input.hasPreviousPage==false {return denied("has_previous_page_false")}
 if input.hasPreviousPage==nil {return denied("has_previous_page_unknown")}
 if input.extensionPoolRemainingMs<=0 {return denied("extension_pool_exhausted")}
 let amount=min(30000,input.extensionPoolRemainingMs,input.absoluteTimeRemainingMs,input.cycleBudgetRemainingMs)
 guard amount>0 else{return denied(input.cycleBudgetRemainingMs<=0 ? "cycle_budget_insufficient":"absolute_cap_reached")}
 return BudgetExtensionDecision(state:.granted,elapsedMs:input.elapsedMs,phase:input.phase,hasPreviousPage:input.hasPreviousPage,
  genuineProgressEver:input.genuineProgressEver,genuineProgressAgeMs:input.genuineProgressAgeMs,
  progressLast5Seconds:age<=5000,progressLast10Seconds:true,replayProgressRecent:replayRecent,
  anyPaginationProgressRecent:anyRecent,extensionPoolRemainingMs:max(0,input.extensionPoolRemainingMs),
  absoluteTimeRemainingMs:max(0,input.absoluteTimeRemainingMs),cycleBudgetRemainingMs:max(0,input.cycleBudgetRemainingMs),
  reason:"fresh_genuine_progress_with_previous_page",grantedAmountMs:amount)
}
struct ChatCheckBudgetSnapshot {
 let baseBudgetMs:Int
 let baseDeadline:Date
 let extensionGranted:Bool
 let extensionReason:String
 let extensionAmountMs:Int
 let absoluteDeadline:Date
 let genuineProgressAgeMs:Int?
 let finalTimeoutType:String
 let timeoutPhase:String
 let hasPreviousPage:Bool?
 let extensionPoolRemainingMs:Int
 let decisions:[BudgetExtensionDecision]
}
final class ChatCheckBudgetController:@unchecked Sendable {
 private let lock=NSLock()
 private let checkStartedAt:Date
 private let cycleDeadline:Date
 private let chatDeadline:Date
 private var passStartedAt:Date
 private var passBaseBudgetMs:Int
 private var passBaseDeadline:Date
 private var passAbsoluteDeadline:Date
 private var activeDeadline:Date
 private var extensionPoolRemainingMs=60000
 private var extensionAmountMs=0
 private var extensionReason="none"
 private var hasPreviousPage:Bool?
 private var genuineProgressAt:Date?
 private var cachedReplayAt:Date?
 private var decisions=[BudgetExtensionDecision]()
 private var finalTimeoutType="none"
 private var timeoutPhase="other"
 init(checkStartedAt:Date=Date(),cycleDeadline:Date) {
  self.checkStartedAt=checkStartedAt;self.cycleDeadline=cycleDeadline
  chatDeadline=min(checkStartedAt.addingTimeInterval(180),cycleDeadline)
  passStartedAt=checkStartedAt;passBaseBudgetMs=60000
  passBaseDeadline=min(checkStartedAt.addingTimeInterval(60),chatDeadline)
  passAbsoluteDeadline=min(checkStartedAt.addingTimeInterval(120),chatDeadline)
  activeDeadline=passBaseDeadline
 }
 func beginContinuation(at now:Date,baseBudgetMs:Int) {
  lock.lock();defer{lock.unlock()}
  passStartedAt=now;passBaseBudgetMs=min(60000,max(0,baseBudgetMs))
  passBaseDeadline=min(now.addingTimeInterval(Double(passBaseBudgetMs)/1000),chatDeadline)
  passAbsoluteDeadline=min(now.addingTimeInterval(120),chatDeadline)
  activeDeadline=passBaseDeadline;finalTimeoutType="none";timeoutPhase="other"
 }
 func observe(hasPreviousPage:Bool?,genuineOlderProgress:Bool,cachedReplay:Bool,at now:Date) {
  lock.lock();defer{lock.unlock()}
  self.hasPreviousPage=hasPreviousPage
  if genuineOlderProgress {genuineProgressAt=now;timeoutPhase="genuine_history_progress"}
  else if cachedReplay {cachedReplayAt=now;if genuineProgressAt==nil {timeoutPhase="cached_replay"}}
  else if timeoutPhase != "genuine_history_progress" {timeoutPhase="waiting_history"}
 }
 func secondsUntilDecision(now:Date=Date())->TimeInterval {
  lock.lock();let deadline=activeDeadline;let done=finalTimeoutType != "none";lock.unlock()
  return done ? 0.05:max(0.05,deadline.timeIntervalSince(now))
 }
 func evaluate(at now:Date=Date())->ChatCheckBudgetDeadlineAction {
  lock.lock();defer{lock.unlock()}
  if finalTimeoutType != "none" {return .timeout(finalTimeoutType)}
  if now<activeDeadline {return .reschedule}
  let passRemaining=max(0,Int(passAbsoluteDeadline.timeIntervalSince(now)*1000))
  let chatRemaining=max(0,Int(chatDeadline.timeIntervalSince(now)*1000))
  let cycleRemaining=max(0,Int(cycleDeadline.timeIntervalSince(now)*1000))
  let absoluteRemaining=min(passRemaining,chatRemaining)
  let genuineAge=genuineProgressAt.map{Int(now.timeIntervalSince($0)*1000)}
  let replayAge=cachedReplayAt.map{Int(now.timeIntervalSince($0)*1000)}
  let genuineRecent=genuineAge.map{$0>=0 && $0<=10000} ?? false
  let replayRecent=replayAge.map{$0>=0 && $0<=10000} ?? false
  let phase=genuineRecent ? "genuine_history" : (replayRecent ? "cached_replay" : (hasPreviousPage==true ? "waiting" : "other"))
  let hitAbsoluteCap=now>=passAbsoluteDeadline || now>=chatDeadline
  let decision=decideBudgetExtension(BudgetExtensionDecisionInput(elapsedMs:max(0,Int(now.timeIntervalSince(checkStartedAt)*1000)),
   phase:phase,hasPreviousPage:hasPreviousPage,genuineProgressEver:genuineProgressAt != nil,
   genuineProgressAgeMs:genuineAge,replayProgressAgeMs:replayAge,extensionPoolRemainingMs:extensionPoolRemainingMs,
   absoluteTimeRemainingMs:absoluteRemaining,cycleBudgetRemainingMs:cycleRemaining,absoluteCapReached:hitAbsoluteCap,checkAlreadyTerminal:false))
  assert(decision.isInternallyConsistent)
  decisions.append(decision)
  if decision.state == .granted {
   extensionPoolRemainingMs=max(0,extensionPoolRemainingMs-decision.grantedAmountMs)
   extensionAmountMs+=decision.grantedAmountMs;extensionReason=decision.reason ?? "none"
   activeDeadline=min(now.addingTimeInterval(Double(decision.grantedAmountMs)/1000),passAbsoluteDeadline,chatDeadline,cycleDeadline)
   timeoutPhase="genuine_history_progress"
   return .extended
  }
  if hitAbsoluteCap || now>=cycleDeadline {finalTimeoutType="timeout_absolute_cap"}
  else if genuineRecent {finalTimeoutType="timeout_during_genuine_history_progress"}
  else if replayRecent {finalTimeoutType="timeout_during_cached_replay"}
  else {finalTimeoutType="timeout_no_recent_progress"}
  if finalTimeoutType=="timeout_during_cached_replay" {timeoutPhase="cached_replay"}
  else if genuineProgressAt != nil {timeoutPhase="genuine_history_progress"}
  else {timeoutPhase=hasPreviousPage==true ? "waiting_history":"other"}
  return .timeout(finalTimeoutType)
 }
 func snapshot(at now:Date=Date())->ChatCheckBudgetSnapshot {
  lock.lock();defer{lock.unlock()}
  let age=genuineProgressAt.map{max(0,min(600000,Int(now.timeIntervalSince($0)*1000)))}
  return ChatCheckBudgetSnapshot(baseBudgetMs:passBaseBudgetMs,baseDeadline:passBaseDeadline,
   extensionGranted:extensionAmountMs>0,extensionReason:extensionReason,extensionAmountMs:extensionAmountMs,
   absoluteDeadline:min(passAbsoluteDeadline,chatDeadline,cycleDeadline),genuineProgressAgeMs:age,
   finalTimeoutType:finalTimeoutType,timeoutPhase:timeoutPhase,hasPreviousPage:hasPreviousPage,
   extensionPoolRemainingMs:extensionPoolRemainingMs,decisions:decisions)
 }
}

enum IsolatedCheckError: Error { case timeout }
private final class IsolatedCheckRace<Value>: @unchecked Sendable {
 private let lock=NSLock()
 private var resolution:Result<Result<Value,Error>,Error>?
 private var continuation:CheckedContinuation<Result<Value,Error>,Error>?
 private var worker:Task<Void,Never>?
 private var timeout:DispatchWorkItem?
 func install(_ continuation:CheckedContinuation<Result<Value,Error>,Error>) {
  lock.lock();let result=resolution
  if result == nil {self.continuation=continuation}
  lock.unlock()
  if let result {continuation.resume(with:result)}
 }
 func install(worker:Task<Void,Never>) {
  lock.lock();let shouldCancel=resolution != nil
  if !shouldCancel {self.worker=worker}
  lock.unlock()
  if shouldCancel {worker.cancel()}
 }
 func install(timeout:DispatchWorkItem) {
  lock.lock();let shouldCancel=resolution != nil
  if !shouldCancel {self.timeout=timeout}
  lock.unlock()
  if shouldCancel {timeout.cancel()}
 }
 func install(budget:ChatCheckBudgetController) {scheduleBudgetDeadline(budget)}
 private func scheduleBudgetDeadline(_ budget:ChatCheckBudgetController) {
  let item=DispatchWorkItem { [weak self] in
   guard let self else{return}
   switch budget.evaluate(at:Date()) {
   case .reschedule:self.scheduleBudgetDeadline(budget)
   case .extended:self.scheduleBudgetDeadline(budget)
   case .timeout:self.finish(.success(.failure(IsolatedCheckError.timeout)))
   }
  }
  install(timeout:item)
  DispatchQueue.global().asyncAfter(deadline:.now()+budget.secondsUntilDecision(),execute:item)
 }
 func finish(_ result:Result<Result<Value,Error>,Error>) {
  lock.lock()
  guard resolution == nil else {lock.unlock();return}
  resolution=result
  let continuation=self.continuation,worker=self.worker,timeout=self.timeout
  self.continuation=nil;self.worker=nil;self.timeout=nil
  lock.unlock()
  timeout?.cancel();worker?.cancel();continuation?.resume(with:result)
 }
 func cancel(){finish(.failure(CancellationError()))}
}
func isolateCheck<T>(timeoutSeconds:TimeInterval=60,_ work:@escaping () async throws -> T) async throws -> Result<T,Error> {
 let race=IsolatedCheckRace<T>()
 return try await withTaskCancellationHandler {
  try await withCheckedThrowingContinuation { continuation in
   race.install(continuation)
   let worker=Task {
    do {race.finish(.success(.success(try await work())))}
    catch is CancellationError {race.finish(.failure(CancellationError()))}
    catch {race.finish(.success(.failure(error)))}
   }
   race.install(worker:worker)
   let timeout=DispatchWorkItem {race.finish(.success(.failure(IsolatedCheckError.timeout)))}
   race.install(timeout:timeout)
   DispatchQueue.global().asyncAfter(deadline:.now()+max(0,timeoutSeconds),execute:timeout)
  }
 } onCancel:{race.cancel()}
}
func isolateCheck<T>(budget:ChatCheckBudgetController,_ work:@escaping () async throws -> T) async throws -> Result<T,Error> {
 let race=IsolatedCheckRace<T>()
 return try await withTaskCancellationHandler {
  try await withCheckedThrowingContinuation { continuation in
   race.install(continuation)
   let worker=Task {
    do {race.finish(.success(.success(try await work())))}
    catch is CancellationError {race.finish(.failure(CancellationError()))}
    catch {race.finish(.success(.failure(error)))}
   }
   race.install(worker:worker);race.install(budget:budget)
  }
 } onCancel:{race.cancel()}
}

struct ChatPaginationPageTelemetry {
 let pageNumber:Int
 let progressTokenUnique:Bool
 let messagesBefore:Int
 let messagesAfter:Int
 let newlyAddedMessages:Int
 let responseDurationMs:Int
 let hasPreviousPage:Bool?
 let repeatedProgressToken:Bool
 let repeatedPage:Bool
 let noProgress:Bool
 let activityMinimum:Double?
 let activityMaximum:Double?
 let direction:String
 let uniqueBaselineMessages:Int
 let knownPageMessageCount:Int
 let olderHistoryProgressObserved:Bool
 let pageFingerprint:String?
 let pageReplay:Bool
 let replayProgressObserved:Bool
 func safeSummary()->String {
  let previous=hasPreviousPage.map{$0 ? "yes":"no"} ?? "unknown"
  let minimum=activityMinimum.map{String($0)} ?? "unknown",maximum=activityMaximum.map{String($0)} ?? "unknown"
  return [
   "p\(pageNumber):token_unique \(progressTokenUnique ? "yes":"no"), messages \(messagesBefore)→\(messagesAfter) (+\(newlyAddedMessages)), response \(responseDurationMs) ms",
   "has_previous_page \(previous), repeated_token \(repeatedProgressToken ? "yes":"no"), repeated_page \(repeatedPage ? "yes":"no"), no_progress \(noProgress ? "yes":"no")",
   "page_bounds \(minimum)…\(maximum), direction \(direction), fingerprint \(pageFingerprint ?? "unavailable"), new_baseline_ids \(uniqueBaselineMessages), known_page_ids \(knownPageMessageCount), replay_page \(pageReplay ? "yes":"no"), replay_progress \(replayProgressObserved ? "yes":"no"), new_history_progress \(olderHistoryProgressObserved ? "yes":"no")"
  ].joined(separator:", ")
 }
}

struct ChatPaginationProgressTracker {
 private(set) var previousMessageIDs:Set<String>
 private let savedBaselineMessageIDs:Set<String>
 private(set) var previousMessageCount:Int
 private(set) var previousProgressToken:String?
 private(set) var seenProgressTokens=Set<String>()
 private(set) var seenPageTokens=Set<String>()
 private(set) var seenPageFingerprints=Set<String>()
 private(set) var previousActivityBounds:(minimum:Double,maximum:Double)?
 private(set) var pages=[ChatPaginationPageTelemetry]()
 private(set) var consecutiveNoProgressPages=0
 private(set) var replayingSavedBoundary:Bool
 private(set) var replayPagesObserved=0
 private(set) var olderHistoryProgressObserved=false
 private(set) var replayProgressObserved=false
 private(set) var replayPagesProgressed=0
 private(set) var olderUniqueBaselineMessageCount=0
 private(set) var currentlyProgressing=false
 private(set) var firstResponseAt:Date?
 private(set) var previousResponseAt:Date?
 let noProgressThreshold:Int

 init(initialMessageIDs:Set<String>=[],initialMessageCount:Int=0,noProgressThreshold:Int=3) {
  previousMessageIDs=initialMessageIDs;savedBaselineMessageIDs=initialMessageIDs;previousMessageCount=max(0,initialMessageCount)
  replayingSavedBoundary = !initialMessageIDs.isEmpty
  self.noProgressThreshold=max(2,noProgressThreshold)
 }
 mutating func begin(at now:Date=Date()) {
  if firstResponseAt==nil {firstResponseAt=now}
  if previousResponseAt==nil {previousResponseAt=now}
 }
 mutating func observe(messageIDs:[String],messageCount:Int,pageNumber:Int,hasPreviousPage:Bool?,activityMinimum:Double?=nil,activityMaximum:Double?=nil,pageDirection:String?=nil,uniqueBaselineMessages:Int=0,knownPageMessageCount:Int=0,olderHistoryProgressObserved:Bool=false,pageFingerprint:String?=nil,pageReplay:Bool?=nil,now:Date=Date())->ChatPaginationPageTelemetry {
  let currentIDs=Set(messageIDs),newIDs=currentIDs.subtracting(previousMessageIDs)
  let after=max(0,messageCount),before=previousMessageCount
  let added=max(0,max(after-before,newIDs.count))
  if replayingSavedBoundary {
   if added>0 {replayingSavedBoundary=false}
   else {replayPagesObserved+=1}
  }
  let previousMarker=hasPreviousPage.map{$0 ? "yes":"no"} ?? "unknown"
  let material=newIDs.isEmpty ? "count:\(after)|previous:\(previousMarker)" : newIDs.sorted().joined(separator:"\u{1f}")
  let token=SHA256.hash(data:Data(material.utf8)).map{String(format:"%02x",$0)}.joined()
  let repeatedToken=seenProgressTokens.contains(token)
  let tokenUnique=added>0 && !repeatedToken
  let pageMaterial="\(token)|\(after)|\(previousMarker)"
  let pageToken=SHA256.hash(data:Data(pageMaterial.utf8)).map{String(format:"%02x",$0)}.joined()
  let started=previousResponseAt ?? firstResponseAt ?? now
  let duration=max(0,Int(now.timeIntervalSince(started)*1000))
  if firstResponseAt==nil {firstResponseAt=now}
  let fingerprint=pageFingerprint ?? token
  let repeatedFingerprint=seenPageFingerprints.contains(fingerprint)
  let repeatedPage=repeatedFingerprint
  let olderBounds:Bool={
   guard let previousActivityBounds,let activityMinimum,let activityMaximum,activityMinimum>0,activityMaximum>0 else{return false}
   return activityMaximum<previousActivityBounds.minimum || (activityMinimum<previousActivityBounds.minimum && activityMaximum<=previousActivityBounds.maximum)
  }()
  let isReplay=pageReplay ?? (!savedBaselineMessageIDs.isEmpty && !currentIDs.isEmpty && currentIDs.isSubset(of:savedBaselineMessageIDs))
  let validReplayProgress=isReplay && pageDirection=="older" && olderBounds && !repeatedFingerprint && hasPreviousPage==true
  let validNewHistoryProgress=olderHistoryProgressObserved && pageDirection=="older" && olderBounds && hasPreviousPage==true
  if validReplayProgress {replayProgressObserved=true;replayPagesProgressed+=1}
  let pageProgress=validReplayProgress || validNewHistoryProgress || (tokenUnique && hasPreviousPage==true)
  let noProgress = !pageProgress
  consecutiveNoProgressPages = pageProgress ? 0:(noProgress ? consecutiveNoProgressPages+1:0)
  self.olderHistoryProgressObserved = self.olderHistoryProgressObserved || validNewHistoryProgress
  olderUniqueBaselineMessageCount=max(olderUniqueBaselineMessageCount,uniqueBaselineMessages)
  currentlyProgressing = pageProgress
  if let activityMinimum,let activityMaximum,activityMinimum>0,activityMaximum>0 {previousActivityBounds=(activityMinimum,activityMaximum)}
  seenPageFingerprints.insert(fingerprint)
  seenProgressTokens.insert(token);seenPageTokens.insert(pageToken)
  previousProgressToken=token;previousMessageIDs=currentIDs;previousMessageCount=after;previousResponseAt=now
  let page=ChatPaginationPageTelemetry(pageNumber:pageNumber,progressTokenUnique:tokenUnique,messagesBefore:before,messagesAfter:after,
   newlyAddedMessages:added,responseDurationMs:duration,hasPreviousPage:hasPreviousPage,
   repeatedProgressToken:repeatedToken,repeatedPage:repeatedPage,noProgress:noProgress,
   activityMinimum:activityMinimum,activityMaximum:activityMaximum,direction:pageDirection ?? "unobserved",
   uniqueBaselineMessages:max(0,uniqueBaselineMessages),knownPageMessageCount:max(0,knownPageMessageCount),olderHistoryProgressObserved:validNewHistoryProgress,
   pageFingerprint:pageFingerprint,pageReplay:isReplay,replayProgressObserved:validReplayProgress)
  pages.append(page);return page
 }
 var shouldStopForNoProgress:Bool {
  consecutiveNoProgressPages>=noProgressThreshold && pages.last?.hasPreviousPage==true
 }
 var uniqueProgressingPages:Int {pages.filter{($0.progressTokenUnique && !$0.repeatedPage)||$0.replayProgressObserved}.count}
 var averageResponseDurationMs:Int? {
  let values=pages.map{$0.responseDurationMs};guard !values.isEmpty else{return nil}
  return values.reduce(0,+)/values.count
 }
 var pagesPerMinute:Double? {
  guard let firstResponseAt,let previousResponseAt,previousResponseAt>firstResponseAt else{return nil}
  return Double(uniqueProgressingPages)/(previousResponseAt.timeIntervalSince(firstResponseAt)/60)
 }
 var progressing:Bool {uniqueProgressingPages>=2 && consecutiveNoProgressPages==0}
}

struct ChatCheckTimingTelemetry {
 let checkStartedAt:Date
 var initialAggregateMessages=0
 var firstHistoryRequestAt:Date?
 var firstHistoryResponseAt:Date?
 var firstCachedReplayPageAt:Date?
 var lastCachedReplayPageAt:Date?
 var firstPassFirstNewIdentityAt:Date?
 var firstGenuinelyNewOlderPageAt:Date?
 var firstNewIdentityAddedAt:Date?
 var lastProgressAt:Date?
 var lastProgressEvent="none"
 var firstPassStartedAt:Date
 var firstPassEndedAt:Date?
 var firstPassFirstHistoryRequestAt:Date?
 var firstPassFirstHistoryResponseAt:Date?
 var firstPassCachedReplayPages=0
 var firstPassCachedReplayItems=0
 var firstPassNewIdentities=0
 var continuationFirstCachedReplayPageAt:Date?
 var continuationLastCachedReplayPageBeforeNewAt:Date?
 var continuationFirstNewIdentityAt:Date?
 var continuationBaselineMessages=0
 var firstPassLastProgressAt:Date?
 var continuationBudgetStartedAt:Date?
 var continuationStartedAt:Date?
 var continuationEndedAt:Date?
 var continuationAvailableBudgetMs=60000
 var continuationCachedReplayPages=0
 var continuationCachedReplayItems=0
 var continuationNewHistoryPages=0
 var continuationNewIdentities=0
 var lastContinuationOlderUniqueMessages=0
 var continuationLastProgressAt:Date?
 var perChatTimeoutFiredAt:Date?
 var timeoutPhase="not_timed_out"
 var timeoutHasPreviousPage:Bool?
 var timeoutAggregateDelta=0
 var timeoutProgressWithin5Seconds=false
 var timeoutProgressWithin10Seconds=false
 var timeoutPaginationActiveWithin5Seconds=false
 var timeoutPaginationActiveWithin10Seconds=false
 var budgetBaseMs=60000
 var budgetExtensionGranted=false
 var budgetExtensionReason="none"
 var budgetExtensionAmountMs=0
 var budgetExtensionDecisionState=BudgetExtensionDecisionState.notEvaluated.rawValue
 var budgetExtensionDecisionReason="none"
 var budgetExtensionPoolRemainingMs=60000
 var budgetExtensionDecisions=[BudgetExtensionDecision]()
 var budgetAbsoluteDeadlineAt:Date?
 var budgetProgressAgeAtDecisionMs:Int?
 var finalTimeoutType="none"
 var budgetTimeoutPhase="other"

 init(now:Date=Date()) {checkStartedAt=now;firstPassStartedAt=now}

 private func elapsed(_ date:Date?,from origin:Date?=nil)->Int? {
  guard let date else{return nil}
  return min(600000,max(0,Int(date.timeIntervalSince(origin ?? checkStartedAt)*1000)))
 }

 mutating func recordHistoryRequest(at now:Date) {
  if firstHistoryRequestAt==nil {firstHistoryRequestAt=now}
  if firstPassFirstHistoryRequestAt==nil && continuationBudgetStartedAt==nil {firstPassFirstHistoryRequestAt=now}
 }

 mutating func recordHistoryResponse(at now:Date) {
  if firstHistoryResponseAt==nil {firstHistoryResponseAt=now}
  if firstPassFirstHistoryResponseAt==nil && continuationBudgetStartedAt==nil {firstPassFirstHistoryResponseAt=now}
 }

 mutating func recordFirstPassPage(replay:Bool,knownItems:Int,newIdentityTotal:Int,progress:Bool,at now:Date) {
  if replay {
   if firstCachedReplayPageAt==nil {firstCachedReplayPageAt=now}
   lastCachedReplayPageAt=now
   firstPassCachedReplayPages+=1
   firstPassCachedReplayItems+=max(0,knownItems)
  }
  let newTotal=max(firstPassNewIdentities,max(0,newIdentityTotal))
  if newTotal>firstPassNewIdentities {
   if firstPassFirstNewIdentityAt==nil {firstPassFirstNewIdentityAt=now}
   if firstNewIdentityAddedAt==nil {firstNewIdentityAddedAt=now}
  }
  firstPassNewIdentities=newTotal
  if progress {
   lastProgressAt=now;firstPassLastProgressAt=now;lastProgressEvent="first_pass_page_progress"
  }
 }

 mutating func recordContinuationResponse(_ data:[String:Any],at now:Date) {
  let direction=data["pageDirection"] as? String ?? "unknown"
  let itemCount=max(0,(data["itemCount"] as? NSNumber)?.intValue ?? 0)
  let newItems=max(0,(data["newIdentityCount"] as? NSNumber)?.intValue ?? 0)
  let provenance=data["identityProvenanceCounts"] as? [String:Any] ?? [:]
  let cachedItems=max(0,(provenance["known_from_checkpoint_cache"] as? NSNumber)?.intValue ?? 0)
  let accepted=data["accepted"] as? Bool == true
  if direction=="older",itemCount>0,cachedItems>0,newItems==0 {
   if firstCachedReplayPageAt==nil {firstCachedReplayPageAt=now}
   lastCachedReplayPageAt=now
   if continuationFirstNewIdentityAt==nil {
    if continuationFirstCachedReplayPageAt==nil {continuationFirstCachedReplayPageAt=now}
    continuationLastCachedReplayPageBeforeNewAt=now
    continuationCachedReplayPages+=1
    continuationCachedReplayItems+=cachedItems
   }
   continuationLastProgressAt=now
   lastProgressAt=now;lastProgressEvent="continuation_cached_replay_page"
  }
  if direction=="older",accepted,newItems>0 {
   if firstGenuinelyNewOlderPageAt==nil {firstGenuinelyNewOlderPageAt=now}
   continuationNewHistoryPages+=1
   continuationNewIdentities+=newItems
   if continuationFirstNewIdentityAt==nil {continuationFirstNewIdentityAt=now}
   if firstNewIdentityAddedAt==nil {firstNewIdentityAddedAt=now}
   continuationLastProgressAt=now
   lastProgressAt=now;lastProgressEvent="genuine_older_history_page"
  }
 }

 mutating func recordContinuationAggregateProgress(olderUniqueMessages:Int,at now:Date) {
  let current=max(0,olderUniqueMessages)
  guard current>lastContinuationOlderUniqueMessages else{return}
  lastContinuationOlderUniqueMessages=current
  if continuationFirstNewIdentityAt==nil {continuationFirstNewIdentityAt=now}
  if firstNewIdentityAddedAt==nil {firstNewIdentityAddedAt=now}
  continuationLastProgressAt=now;lastProgressAt=now;lastProgressEvent="genuine_older_identity_added"
 }

 mutating func markFirstPassEnded(at now:Date) {if firstPassEndedAt==nil {firstPassEndedAt=now}}

 mutating func beginContinuation(at now:Date) {
  if continuationBudgetStartedAt==nil {continuationBudgetStartedAt=now}
  if continuationStartedAt==nil {continuationStartedAt=now}
 }

 mutating func markContinuationEnded(at now:Date) {if continuationEndedAt==nil {continuationEndedAt=now}}

 mutating func markTimeout(at now:Date,hasPreviousPage:Bool?,aggregateMessages:Int) {
  perChatTimeoutFiredAt=now
  timeoutHasPreviousPage=hasPreviousPage
  let baseline=continuationBudgetStartedAt == nil ? initialAggregateMessages:continuationBaselineMessages
  timeoutAggregateDelta=max(0,aggregateMessages-baseline)
  let last=lastProgressAt
  let elapsed=last.map{now.timeIntervalSince($0)}
  timeoutProgressWithin5Seconds=elapsed.map{$0>=0 && $0<=5} ?? false
  timeoutProgressWithin10Seconds=elapsed.map{$0>=0 && $0<=10} ?? false
  timeoutPaginationActiveWithin5Seconds=hasPreviousPage==true && timeoutProgressWithin5Seconds
  timeoutPaginationActiveWithin10Seconds=hasPreviousPage==true && timeoutProgressWithin10Seconds
  if (continuationBudgetStartedAt != nil ? continuationFirstNewIdentityAt:firstPassFirstNewIdentityAt) != nil {timeoutPhase="genuine_history_progress"}
  else if continuationCachedReplayPages>0 || firstPassCachedReplayPages>0 {timeoutPhase="cached_replay"}
  else if firstHistoryRequestAt != nil && (lastProgressAt == nil || lastProgressAt!.timeIntervalSince(now)<0) {timeoutPhase="waiting_history"}
  else {timeoutPhase="other"}
 }

 mutating func recordBudget(_ snapshot:ChatCheckBudgetSnapshot) {
  budgetBaseMs=snapshot.baseBudgetMs;budgetExtensionGranted=snapshot.extensionGranted
  budgetExtensionReason=snapshot.extensionReason;budgetExtensionAmountMs=snapshot.extensionAmountMs
  budgetExtensionPoolRemainingMs=snapshot.extensionPoolRemainingMs;budgetExtensionDecisions=snapshot.decisions
  if let decision=snapshot.decisions.last {
   budgetExtensionDecisionState=decision.state.rawValue;budgetExtensionDecisionReason=decision.reason ?? "none"
  } else {budgetExtensionDecisionState=BudgetExtensionDecisionState.notEvaluated.rawValue;budgetExtensionDecisionReason="none"}
  budgetAbsoluteDeadlineAt=snapshot.absoluteDeadline;budgetProgressAgeAtDecisionMs=snapshot.genuineProgressAgeMs
  if snapshot.finalTimeoutType != "none" {finalTimeoutType=snapshot.finalTimeoutType}
  budgetTimeoutPhase=snapshot.timeoutPhase
 }

 func report(now:Date=Date())->String {
  let lastReplayBeforeNew=continuationLastCachedReplayPageBeforeNewAt ?? lastCachedReplayPageAt
  let milestone:[(String,Date?)]=[("check_started",checkStartedAt),("first_history_request",firstHistoryRequestAt),("first_history_response",firstHistoryResponseAt),("first_cached_replay_page",firstCachedReplayPageAt),("last_cached_replay_page_before_new_history",lastReplayBeforeNew),("first_genuinely_new_older_page",firstGenuinelyNewOlderPageAt),("first_new_identity_added",firstNewIdentityAddedAt),("last_progress_event",lastProgressAt),("per_chat_timeout_fired",perChatTimeoutFiredAt)]
  let timeline=milestone.map{name,date in "\(name)=\(elapsed(date).map(String.init) ?? "none")ms"}.joined(separator:", ")
  let firstPassMs=elapsed(firstPassEndedAt,from:firstPassStartedAt)
  let contElapsed=elapsed(continuationEndedAt ?? now,from:continuationBudgetStartedAt)
  let toNew=elapsed(continuationFirstNewIdentityAt,from:continuationBudgetStartedAt)
  let spentPct=toNew.map{min(100,Double($0)/60000*100)}
  let corridorMs: Int? = {
   guard let first=continuationFirstCachedReplayPageAt,let new=firstGenuinelyNewOlderPageAt ?? continuationFirstNewIdentityAt else{return nil}
   return min(600000,max(0,Int(new.timeIntervalSince(first)*1000)))
  }()
  let remaining=toNew.map{max(0,60000-$0)}
  let afterNewMs: Int? = {
   guard let first=continuationFirstNewIdentityAt else{return nil}
   let end=perChatTimeoutFiredAt ?? continuationEndedAt ?? now
   return min(600000,max(0,Int(end.timeIntervalSince(first)*1000)))
  }()
  let seconds=Double(max(1,afterNewMs ?? 0))/1000
  let pagesRate=Double(continuationNewHistoryPages)/seconds
  let identitiesRate=Double(continuationNewIdentities)/seconds
  let phaseMetrics="first pass elapsed \(firstPassMs.map(String.init) ?? "unknown") ms · cached replay \(firstPassCachedReplayPages) pages/\(firstPassCachedReplayItems) items · new identities \(firstPassNewIdentities) · continuation available/elapsed \(continuationBudgetStartedAt == nil ? "none":String(continuationAvailableBudgetMs))/\(contElapsed.map(String.init) ?? "none") ms · cached replay \(continuationCachedReplayPages) pages/\(continuationCachedReplayItems) items · new-history \(continuationNewHistoryPages) pages/\(continuationNewIdentities) identities"
  let corridor="cached replay corridor \(continuationCachedReplayPages) pages · \(continuationCachedReplayItems) items · \(corridorMs.map(String.init) ?? "unknown") ms to first new older page"
  let budget="first new identity at \(toNew.map(String.init) ?? "none") ms · \(spentPct.map{String(format:"%.1f",$0)} ?? "unknown")% of 60000 ms budget · remaining after frontier \(remaining.map(String.init) ?? "unknown") ms"
  let rates="after first new identity until timeout/end \(afterNewMs.map(String.init) ?? "unknown") ms · pages/sec \(String(format:"%.2f",pagesRate)) · new identities/sec \(String(format:"%.2f",identitiesRate))"
  let hardDeadline=elapsed(budgetAbsoluteDeadlineAt).map(String.init) ?? "none"
  let decisionLines=budgetExtensionDecisions.map{decision in
   "#\(decision.elapsedMs)ms \(decision.state.rawValue) phase \(decision.phase) hasPreviousPage \(decision.hasPreviousPage.map{$0 ? "yes":"no"} ?? "unknown") genuine ever \(decision.genuineProgressEver ? "yes":"no") genuine age \(decision.genuineProgressAgeMs.map(String.init) ?? "none")ms genuine progress last5/10 \(decision.progressLast5Seconds ? "yes":"no")/\(decision.progressLast10Seconds ? "yes":"no") recent_genuine_history_progress \(decision.progressLast10Seconds ? "yes":"no") recent_cached_replay_progress \(decision.replayProgressRecent ? "yes":"no") recent_any_pagination_progress \(decision.anyPaginationProgressRecent ? "yes":"no") pool \(decision.extensionPoolRemainingMs)ms absolute remaining \(decision.absoluteTimeRemainingMs)ms cycle remaining \(decision.cycleBudgetRemainingMs)ms result \(decision.reason ?? "none") granted \(decision.grantedAmountMs)ms"
  }.joined(separator:" | ")
  let budgetPolicy="budget base \(budgetBaseMs) ms · extension decision \(budgetExtensionDecisionState) · reason \(budgetExtensionDecisionReason) · granted total \(budgetExtensionAmountMs) ms · pool remaining \(budgetExtensionPoolRemainingMs) ms · previous extension reason \(budgetExtensionReason) · absolute deadline \(hardDeadline) ms from check start · genuine progress age at final report \(budgetProgressAgeAtDecisionMs.map(String.init) ?? "unknown") ms · final timeout type \(finalTimeoutType) · decisions [\(decisionLines.isEmpty ? "not_evaluated":decisionLines)]"
  let timeout="timeout phase \(timeoutPhase) · budget phase \(budgetTimeoutPhase) · progress in last 5/10 s \(timeoutProgressWithin5Seconds ? "yes":"no")/\(timeoutProgressWithin10Seconds ? "yes":"no") · pagination active in last 5/10 s \(timeoutPaginationActiveWithin5Seconds ? "yes":"no")/\(timeoutPaginationActiveWithin10Seconds ? "yes":"no") · hasPreviousPage \(timeoutHasPreviousPage.map{$0 ? "yes":"no"} ?? "unknown") · aggregate delta \(timeoutAggregateDelta)"
  return "Timing milestones [\(timeline)] · phase costs [\(phaseMetrics)] · \(corridor) · \(budget) · \(rates) · \(budgetPolicy) · \(timeout)"
 }
}

struct ChatCheckStageTelemetry {
 var stage="chat_check_started"
 var stages=["chat_check_started"]
 var stageBeforeFinish:String?
 var terminalStageDurationMs:Int?
 var stageStartedAt:Date
 let startedAt:Date
 var routeReached=false
 var navigationObjectReturned=false
 var navigationProvisionalStarted=false
 var generationCreated=false
 var operationGeneration:String? // internal correlation only; never included in report()
 var navigationOwnerGenerationMatches=false
 var cleanupOwnershipResult="pending"
 var navigationTerminalReason="none"
 var pagination=ChatPaginationProgressTracker()
 var checkProgress=ChatCheckProgressAccumulator()
 var paginationNoProgressTriggered=false
 var historyRequests=0
 var historyResponses=0
 var renderedDOMTurnCount:Int?
 var renderedDOMUserTurnCount=0
 var renderedDOMAssistantTurnCount=0
 var renderedDOMUnknownRoleTurnCount=0
 var pagesObserved=0
 var automationPageUpdateCallbacks=0
 var firstPassIdentityProvenanceSummary="not_reported"
 var messagesAccumulated=0
 var hasPreviousPage:Bool?
 var historyComplete=false
 var documentIdentity:String?
 var paginationFrontierTimestamp:Double?
 var olderUniqueMessageCount=0
 var continuationAttempted=false
 var continuationTerminalReason="not_attempted"
 var continuationFirstPassPages=0
 var continuationStartingMessages=0
 var httpStatuses=Set<Int>()
 var rateLimitSeen=false
 var aggregationStarted=false
 var aggregationCompleted=false
 var hookInstalled=false
 var fetchHookActive=false
 var xhrHookActive=false
 var generationAttached=false
 var hookHealthRecorded=false
 var renderLeaseActive=false
 var continuationSelected=false
 var continuationStartedAt:Date?
 var continuationRouteUnchanged:Bool?
 var continuationDocumentSame:Bool?
 var continuationFrontierPresent:Bool?
 var continuationHasPreviousPage:Bool?
 var continuationReplayProgressEligible:Bool?
 var continuationNewHistoryProgressEligible:Bool?
 var continuationBridgeSuccess="not_run"
 var continuationBridgeCallbackResult="not_run"
 var continuationTriggerAttempted=false
 var continuationTriggerResult="not_run"
 var continuationTriggerSources:[String]=[]
 var continuationFirstHistoryRequestMs:Int?
 var continuationFirstHistoryResponseMs:Int?
 var continuationHistoryRequests=0
 var continuationHistoryResponses=0
 var continuationBaselineHistoryRequests=0
 var continuationBaselineHistoryResponses=0
 var continuationBaselinePages=0
 var continuationBaselinePageUpdateCallbacks=0
 var continuationBaselineMessages=0
 var continuationPageSequences=Set<Int>()
 var continuationPageResponses=0
 var continuationAggregateGrowth=0
 var continuationOlderUniqueMessages=0
 var continuationDiagnosis="none"
 var continuationStages:[String]=[]
 var continuationResponseSequences=Set<Int>()
 var continuationResponseEvents:[String]=[]
 var continuationPayloadRecognizedCount=0
 var continuationRecognizedResponseSequences=Set<Int>()
 var continuationAcceptedPageCount=0
 var continuationRejectedPageCount=0
 var continuationRequestCursorFingerprints=Set<String>()
 var continuationResponseCursorFingerprints=Set<String>()
 var continuationPageFingerprints=Set<String>()
 var continuationDuplicatePageCount=0
 var continuationDuplicateCursorCount=0
 var continuationDuplicateFirstPassPageCount=0
 var continuationDuplicateFirstPassCursorCount=0
 var continuationOlderDirectionCount=0
 var continuationNotOlderDirectionCount=0
 var continuationDominantReasonCounts:[String:Int]=[:]
 var continuationFirstPassBoundarySummary="unobserved"
 var continuationFirstPassRequestInFlight=0
 var continuationFirstPassResponseInFlight=0
 var continuationFirstPassIdentitySetTruncated=false
 var continuationAggregateBaselineIdentityCount=0
 var continuationAggregateBaselineTruncated=false
 var continuationFirstPassAcceptedPageCount=0
 var continuationFirstPassRequestTrackedPageCount=0
 var continuationFirstPassPreConfigurationPendingAcceptedPageCount=0
 var continuationFirstPassOtherAcceptedPageCount=0
 var continuationFirstPassNativePageCount=0
 var continuationFirstPassNativePageUpdateCallbacks=0
 var continuationFirstPassPageCountGap=0
 var continuationFirstPassSourceSummary="unobserved"
 var continuationFirstPassOtherOriginTrace="none"
 var continuationTrackedIdentitySetCount=0
 var continuationTrackedIdentitySetTruncated=false
 var continuationOtherOriginIdentitySetCount=0
 var continuationOtherOriginIdentitySetTruncated=false
 var continuationTrackedBaselineOverlapTotal=0
 var continuationOtherOriginBaselineOverlapTotal=0
 var continuationPreConfigurationPendingPageCount=0
 var continuationPreConfigurationPendingItemCount=0
 var continuationBaselineMembershipMismatchCount=0
 var continuationResponseOriginFirstPass=0
 var continuationResponseOriginContinuation=0
 var continuationResponseOriginUnknown=0
 var continuationContinuationCursorSeenFirstPass=0
 var continuationContinuationCursorNew=0
 var continuationExactFirstPassPageMatches=0
 var continuationKnownBaselineOnlyPages=0
 var continuationPagesWithNewIdentity=0
 var continuationFirstContinuationRequestSummary="none"
 var timing:ChatCheckTimingTelemetry

 init(now:Date=Date(),renderLeaseActive:Bool=false) {
  startedAt=now;stageStartedAt=now;timing=ChatCheckTimingTelemetry(now:now);self.renderLeaseActive=renderLeaseActive
 }

 mutating func enter(_ next:String,now:Date=Date()) {
  guard stage != next else{return}
  stage=next;stageStartedAt=now;stages.append(next)
 }

 mutating func recordContinuationStage(_ stage:String,routeUnchanged:Bool?=nil,documentSame:Bool?=nil,bridgeResult:String?=nil,source:String?=nil,now:Date=Date()) {
  if continuationStartedAt == nil {continuationStartedAt=now}
  if let routeUnchanged {continuationRouteUnchanged=routeUnchanged}
  if let documentSame {continuationDocumentSame=documentSame}
  if bridgeResult == "accepted" {continuationBridgeSuccess="yes"}
  else if ["rejected","route_mismatch","frontier_missing","error","no_result","invalid"].contains(bridgeResult ?? "") {continuationBridgeSuccess="no"}
  if stage=="pagination_trigger_attempted",let source,!continuationTriggerSources.contains(source){continuationTriggerSources.append(source)}
  let elapsed=max(0,Int(now.timeIntervalSince(continuationStartedAt!)*1000))
  continuationStages.append("\(stage)\(source.map{"[\($0)]"} ?? "") +\(elapsed)ms route \(continuationRouteUnchanged.map{$0 ? "yes":"no"} ?? "?") document \(continuationDocumentSame.map{$0 ? "yes":"no"} ?? "?") frontier \(continuationFrontierPresent.map{$0 ? "yes":"no"} ?? "?") hasPreviousPage \(continuationHasPreviousPage.map{$0 ? "yes":"no"} ?? "?") replayEligible \(continuationReplayProgressEligible.map{$0 ? "yes":"no"} ?? "?") newHistoryEligible \(continuationNewHistoryProgressEligible.map{$0 ? "yes":"no"} ?? "?") bridge \(continuationBridgeSuccess)")
 }

 mutating func recordFirstPassBoundary(_ data:[String:Any]) {
  let nonnegative: (Any?)->Int = { value in max(0,(value as? NSNumber)?.intValue ?? 0) }
  let safeFP: (Any?)->String = { value in
   guard let value=value as? String,value.range(of:"^(?:[0-9]{1,6}:)?[a-f0-9]{8}$",options:.regularExpression) != nil else{return "none"}
   return value
  }
  continuationFirstPassRequestInFlight=nonnegative(data["requestInFlightCount"])
  continuationFirstPassResponseInFlight=nonnegative(data["responseInFlightCount"])
  continuationFirstPassIdentitySetTruncated=data["identitySetTruncated"] as? Bool == true
  continuationAggregateBaselineIdentityCount=nonnegative(data["aggregateBaselineIdentityCount"])
  continuationAggregateBaselineTruncated=data["aggregateBaselineIdentitySetTruncated"] as? Bool == true
  continuationFirstPassAcceptedPageCount=nonnegative(data["firstPassAcceptedPageCount"])
  continuationFirstPassRequestTrackedPageCount=nonnegative(data["firstPassRequestTrackedPageCount"])
  continuationFirstPassPreConfigurationPendingAcceptedPageCount=nonnegative(data["firstPassPreConfigurationPendingAcceptedPageCount"])
  continuationFirstPassOtherAcceptedPageCount=nonnegative(data["firstPassOtherAcceptedPageCount"])
  continuationFirstPassNativePageCount=continuationBaselinePages
  continuationFirstPassNativePageUpdateCallbacks=continuationBaselinePageUpdateCallbacks
  continuationFirstPassPageCountGap=continuationFirstPassAcceptedPageCount-continuationFirstPassNativePageCount
  continuationPreConfigurationPendingPageCount=nonnegative(data["firstPassPreConfigurationPendingPageCount"])
  continuationPreConfigurationPendingItemCount=nonnegative(data["firstPassPreConfigurationPendingItemCount"])
  let allowedSources=Set(["conversation_messages_request_tracked","conversation_messages_untracked","conversation_detail","page_hook_preexisting","initial_document_payload","ui/bootstrap_prefetch","page_hook_event_without_request_record","response_origin_unknown"])
  let sourceCounts=data["firstPassSourcePageCounts"] as? [String:Int] ?? [:]
  continuationFirstPassSourceSummary=allowedSources.sorted().compactMap{key in guard let value=sourceCounts[key],value>0 else{return nil};return "\(key)=\(value)"}.joined(separator:",")
  if continuationFirstPassSourceSummary.isEmpty {continuationFirstPassSourceSummary="none"}
  let traceRows=data["firstPassOtherOriginPageTrace"] as? [[String:Any]] ?? []
  let allowedTemporal=Set(["before_first_tracked_page","concurrent_or_prefetched"])
  continuationFirstPassOtherOriginTrace=traceRows.suffix(64).compactMap{row -> String? in
   guard let ordinal=(row["pageOrdinal"] as? NSNumber)?.intValue,ordinal>0,
         let category=row["sourceCategory"] as? String,allowedSources.contains(category),row["pageOrigin"] as? String != "request_tracked" else{return nil}
   let elapsed=nonnegative(row["elapsedMs"]),sourceElapsed=row["sourceElapsedMs"].map{nonnegative($0)},endpoint=["conversation_messages","conversation_detail","other"].contains(row["endpointClass"] as? String ?? "") ? row["endpointClass"] as! String:"unknown"
   let request=row["requestObserved"] as? Bool == true ? "yes":"no",origin=["first_pass","continuation","unknown"].contains(row["requestOrigin"] as? String ?? "") ? row["requestOrigin"] as! String:"unknown"
   let generation=row["generationMatchesFirstPass"] as? Bool == true ? "matches":(row["generationPresent"] as? Bool == true ? "mismatch":"absent")
   let response=row["responseObserved"] as? Bool == true ? "yes":"no",hook=["fetch","XHR"].contains(row["pageHookSource"] as? String ?? "") ? row["pageHookSource"] as! String:"unknown"
   let fp=safeFP(row["pageFingerprint"]),cursor=safeFP(row["requestCursorFingerprint"]),items=nonnegative(row["itemCount"]),added=nonnegative(row["addedNewIdentityCount"]),seq=nonnegative(row["requestSequence"])
   let temporalRaw=row["temporalPosition"] as? String ?? "unknown"
   let temporal=allowedTemporal.contains(temporalRaw) || temporalRaw.range(of:"^(?:between_tracked_pages_[0-9]+_and_[0-9]+|after_last_tracked_page_[0-9]+)$",options:.regularExpression) != nil ? temporalRaw:"unknown"
   return "page\(ordinal) +\(elapsed)ms source=\(category)/\(endpoint) captureElapsed=\(sourceElapsed.map(String.init) ?? "unknown")ms request=\(request):\(origin)#\(seq) cursor=\(cursor) generation=\(generation) response=\(response)/\(hook) page=\(fp) items=\(items) added=\(added) hookCapture=\(nonnegative(row["captureSequence"])) replay=\(row["replayRequestIdPresent"] as? Bool == true ? "yes":"no") trackedAt=\(nonnegative(row["trackedAcceptedCountAtPage"])) inFlight=\(nonnegative(row["trackedRequestsInFlight"])) position=\(temporal)"
  }.joined(separator:"; ")
  continuationTrackedIdentitySetCount=nonnegative(data["firstPassTrackedIdentitySetCount"]);continuationTrackedIdentitySetTruncated=data["firstPassTrackedIdentitySetTruncated"] as? Bool == true
  continuationOtherOriginIdentitySetCount=nonnegative(data["firstPassOtherOriginIdentitySetCount"]);continuationOtherOriginIdentitySetTruncated=data["firstPassOtherOriginIdentitySetTruncated"] as? Bool == true
  let pages=(data["pages"] as? [[String:Any]] ?? []).suffix(24).compactMap { page -> String? in
   guard let ordinal=(page["ordinal"] as? NSNumber)?.intValue,ordinal>0 else{return nil}
   let cursor=safeFP(page["requestCursorFingerprint"]),response=safeFP(page["responseCursorFingerprint"])
   let pageFP=safeFP(page["pageFingerprint"]),itemSet=safeFP(page["itemSetFingerprint"])
   let accepted=page["accepted"] as? Bool
   let relation=["first","older","not_older","unknown"].contains(page["temporalRelation"] as? String ?? "") ? page["temporalRelation"] as! String:"unknown"
   let previous=(page["hasPreviousPage"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"
   return "#\(ordinal) req=\(cursor) resp=\(response) page=\(pageFP) items=\(itemSet) accepted=\(accepted.map{$0 ? "yes":"no"} ?? "unknown") relation=\(relation) hasPreviousPage=\(previous)"
  }
  let route=["/c/<id>","/g/<id>/c/<id>"].contains(data["routeTemplate"] as? String ?? "") ? data["routeTemplate"] as! String:"unknown"
  let doc=data["documentIdentityPresent"] as? Bool == true ? "yes":"no"
  let docGeneration=safeFP(data["documentGenerationFingerprint"])
  let generation=data["firstPassGenerationMatches"] as? Bool == true ? "matches":"present_but_mismatch"
  let cursor=safeFP(data["lastRequestCursorFingerprint"]),response=safeFP(data["lastResponsePageFingerprint"])
  let accepted=safeFP(data["lastAcceptedPageFingerprint"])
  let previous=(data["lastHasPreviousPage"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"
  let requestCount=nonnegative(data["requestCount"]),responseCount=nonnegative(data["responseCount"])
  continuationFirstPassBoundarySummary="requests/responses \(requestCount)/\(responseCount) · aggregate baseline identities \(continuationAggregateBaselineIdentityCount) source \(data["aggregateBaselineSource"] as? String == "first_pass_aggregate" ? "first_pass_aggregate":"unavailable") truncated \(continuationAggregateBaselineTruncated ? "yes":"no") · accepted pages tracked/pending/other \(continuationFirstPassRequestTrackedPageCount)/\(continuationFirstPassPreConfigurationPendingAcceptedPageCount)/\(continuationFirstPassOtherAcceptedPageCount) total \(continuationFirstPassAcceptedPageCount) · native first-pass page summary \(continuationFirstPassNativePageCount) · bridge-native page gap \(continuationFirstPassPageCountGap) · native update callbacks \(continuationFirstPassNativePageUpdateCallbacks) · source categories [\(continuationFirstPassSourceSummary)] · other-origin identities tracked/other \(continuationTrackedIdentitySetCount)/\(continuationOtherOriginIdentitySetCount) truncated \(continuationTrackedIdentitySetTruncated ? "yes":"no")/\(continuationOtherOriginIdentitySetTruncated ? "yes":"no") · other-origin pages [\(continuationFirstPassOtherOriginTrace)] · pre-config pending pages/items \(continuationPreConfigurationPendingPageCount)/\(continuationPreConfigurationPendingItemCount) · route=\(route) · document identity present \(doc) · document generation \(docGeneration) · first-pass generation \(generation) · request/response in-flight \(continuationFirstPassRequestInFlight)/\(continuationFirstPassResponseInFlight) · identity set truncated \(continuationFirstPassIdentitySetTruncated ? "yes":"no") · last request cursor \(cursor) · last response page \(response) · last accepted page \(accepted) · pending ordinal \(nonnegative(data["pendingRequestOrdinal"])) · hasPreviousPage \(previous) · pages [\(pages.isEmpty ? "none":pages.joined(separator:"; "))]"
  if let provenance=data["firstPassIdentityProvenance"] as? [String:Any] {recordFirstPassIdentityProvenance(provenance)}
 }

 mutating func recordFirstPassIdentityProvenance(_ data:[String:Any]) {
  let allowed=["initial_dom","initial_document_payload","ui/bootstrap_prefetch","conversation_detail","conversation_messages_request_tracked","conversation_messages_untracked","page_hook_preexisting","page_hook_event_without_request_record","checkpoint_cache","response_origin_unknown"]
  let raw=data["counts"] as? [String:Any] ?? [:]
  let counts=allowed.compactMap{key -> (String,Int)? in guard let value=(raw[key] as? NSNumber)?.intValue,value>=0 else{return nil};return(key,value)}
  let attributed=counts.reduce(0){$0+$1.1},aggregate=max(0,(data["aggregateIdentityCount"] as? NSNumber)?.intValue ?? 0)
  let gap=max(0,(data["gapCount"] as? NSNumber)?.intValue ?? abs(aggregate-attributed))
  let hasGap=data["aggregateProvenanceGap"] as? Bool == true || attributed != aggregate || gap>0
  let summary=counts.filter{$0.1>0}.map{"\($0.0)=\($0.1)"}.joined(separator:",")
  firstPassIdentityProvenanceSummary="first-seen [\(summary.isEmpty ? "none":summary)] · attributed/aggregate \(attributed)/\(aggregate) · \(hasGap ? "aggregate_provenance_gap (\(gap))":"invariant_ok") · truncated \(data["identitySetTruncated"] as? Bool == true ? "yes":"no")"
 }

 mutating func recordContinuationResponse(_ data:[String:Any],now:Date=Date()) {
  guard continuationSelected,let sequence=(data["sequence"] as? NSNumber)?.intValue,sequence>=0,
        continuationResponseSequences.insert(sequence).inserted else{return}
  let safeFingerprint={(value:Any?,page:Bool)->String? in
   guard let value=value as? String else{return nil}
   let pattern=page ? "^(?:[0-9]{1,6}:)?[a-f0-9]{8}$":"^[a-f0-9]{8}$"
   return value.range(of:pattern,options:.regularExpression) != nil ? value:nil
  }
  let requestClass=["conversation_messages","conversation_detail","other"].contains(data["requestClass"] as? String ?? "") ? data["requestClass"] as! String:"unknown"
  let transport=["fetch","XHR"].contains(data["transport"] as? String ?? "") ? data["transport"] as! String:"unknown"
  let status=(data["status"] as? NSNumber)?.intValue ?? 0
  let responseElapsed=(data["elapsedMs"] as? NSNumber)?.intValue
  let requestCursor=safeFingerprint(data["requestCursorFingerprint"],false)
  let responseCursor=safeFingerprint(data["responseCursorFingerprint"],false)
  let page=safeFingerprint(data["pageFingerprint"],true)
  let itemCount=(data["itemCount"] as? NSNumber)?.intValue
  let hasPrevious=data["hasPreviousPage"] as? Bool
  let recognized=data["payloadRecognized"] as? Bool == true
  let generation=data["generationPassed"] as? Bool == true
  let route=data["routePassed"] as? Bool == true
  let document=data["documentPassed"] as? Bool == true
  let duplicatePage=data["duplicatePage"] as? Bool == true
  let duplicateCursor=data["duplicateCursor"] as? Bool == true || data["duplicateResponseCursor"] as? Bool == true
  let duplicateFirstPage=data["duplicateFirstPassPage"] as? Bool == true
  let duplicateFirstCursor=data["duplicateFirstPassCursor"] as? Bool == true
  let accepted=data["accepted"] as? Bool == true
  let requestOrigin=["first_pass","continuation"].contains(data["requestOrigin"] as? String ?? "") ? data["requestOrigin"] as! String:"unknown"
  let cursorSeenFirstPass=data["requestCursorSeenFirstPass"] as? Bool == true
  let exactFirstPassPage=data["exactFirstPassPageMatch"] as? Bool == true
  let allKnown=data["allItemsAlreadyKnownBaseline"] as? Bool
  let cursorOrdinal=(data["requestCursorFirstPassMatchOrdinal"] as? NSNumber)?.intValue
  let baselineOverlap=max(0,(data["baselineIdentityOverlapCount"] as? NSNumber)?.intValue ?? 0)
  let baselineIdentityCount=max(0,(data["baselineIdentitySetCount"] as? NSNumber)?.intValue ?? 0)
  let trackedOverlap=(data["trackedFirstPassIdentityOverlapCount"] as? NSNumber)?.intValue
  let otherOverlap=(data["otherOriginFirstPassIdentityOverlapCount"] as? NSNumber)?.intValue
  if requestOrigin=="continuation" {continuationTrackedBaselineOverlapTotal += max(0,trackedOverlap ?? 0);continuationOtherOriginBaselineOverlapTotal += max(0,otherOverlap ?? 0)}
  let membershipMismatch=data["baselineMembershipTelemetryMismatch"] as? Bool == true
  let membershipReason=["baseline_membership_telemetry_mismatch","baseline_membership_consistent","baseline_membership_not_comparable"].contains(data["baselineMembershipReason"] as? String ?? "") ? data["baselineMembershipReason"] as! String:"baseline_membership_not_comparable"
  if membershipMismatch {continuationBaselineMembershipMismatchCount+=1}
  let newIdentityCount=(data["newIdentityCount"] as? NSNumber)?.intValue
  if requestOrigin=="first_pass" {continuationResponseOriginFirstPass+=1}
  else if requestOrigin=="continuation" {continuationResponseOriginContinuation+=1}
  else {continuationResponseOriginUnknown+=1}
  if requestOrigin=="continuation" {
   if cursorSeenFirstPass {continuationContinuationCursorSeenFirstPass+=1}
   else if requestCursor != nil {continuationContinuationCursorNew+=1}
   if exactFirstPassPage {continuationExactFirstPassPageMatches+=1}
   if allKnown==true {continuationKnownBaselineOnlyPages+=1}
   if let newIdentityCount,newIdentityCount>0 {continuationPagesWithNewIdentity+=1}
   if continuationFirstContinuationRequestSummary=="none" && requestClass=="conversation_messages" {
    let cursor=requestCursor ?? "none",ordinal=cursorSeenFirstPass ? (cursorOrdinal.map(String.init) ?? "yes"):"no"
    let requestOrdinal=(data["requestOrdinal"] as? NSNumber)?.intValue ?? 0
    let lastCursor=data["requestCursorMatchesLastFirstPass"] as? Bool == true ? "yes":"no"
    let pageMatch=exactFirstPassPage ? "yes":"no",known=allKnown.map{$0 ? "yes":"no"} ?? "unknown"
    continuationFirstContinuationRequestSummary="request ordinal \(requestOrdinal) · cursor \(cursor) · first-pass match \(ordinal) · last cursor match \(lastCursor) · exact page match \(pageMatch) · full aggregate baseline overlap \(baselineOverlap)/\(baselineIdentityCount) · membership telemetry \(membershipReason) · all items baseline-known \(known)"
   }
  }
  let dominantAllowed=Set(["none","no_older_items_empty_page","no_older_items_all_already_known","no_older_items_missing_identity","no_older_items_missing_timestamps","no_older_items_not_before_frontier","no_older_items_mixed_rejections","no_older_items_other_filter"])
  let dominant=dominantAllowed.contains(data["dominantReason"] as? String ?? "") ? data["dominantReason"] as! String:"none"
  let itemBreakdown=data["itemBreakdown"] as? [String:Any] ?? [:]
  let provenanceKeys=["known_from_initial_dom","known_from_bootstrap","known_from_conversation_detail","known_from_tracked_messages","known_from_untracked_messages","known_from_checkpoint_cache","known_from_other","genuinely_new"]
  let provenanceRaw=data["identityProvenanceCounts"] as? [String:Any] ?? [:]
  let provenanceCounts=provenanceKeys.compactMap{key -> (String,Int)? in guard let value=(provenanceRaw[key] as? NSNumber)?.intValue,value>=0 else{return nil};return(key,value)}
  let provenanceSummary=provenanceCounts.filter{$0.1>0}.map{"\($0.0)=\($0.1)"}.joined(separator:",")
  let itemCounts=["totalItems","alreadyKnownIdentity","duplicateWithinPage","missingIdentity","missingTimestamp","invalidTimestamp","notOlderThanFrontier","olderThanFrontierButRejectedOther","eligibleOlder","accepted","older","equal","newer","timestampUnknown","uniqueValidIdentities","alreadyKnownUniqueIdentities"].map { key in
   (key,(itemBreakdown[key] as? NSNumber)?.intValue)
  }
  let frontier=data["frontier"] as? [String:Any] ?? [:]
  let frontierExists=frontier["exists"] as? Bool == true
  let frontierTimestampValid=frontier["timestampValid"] as? Bool == true
  let frontierIdentityPresent=frontier["identityPresent"] as? Bool == true
  let frontierSource=["first_pass_pagination_frontier"].contains(frontier["source"] as? String ?? "") ? frontier["source"] as! String:"unknown"
  let comparisonMode=["activity_timestamp_and_message_identity"].contains(frontier["comparisonMode"] as? String ?? "") ? frontier["comparisonMode"] as! String:"unknown"
  let direction=["first_page","older","not_older"].contains(data["pageDirection"] as? String ?? "") ? data["pageDirection"] as! String:"unknown"
  let allowedReasons=Set(["not_history_payload","payload_parse_failed","generation_mismatch","route_mismatch","document_mismatch","duplicate_page","duplicate_cursor","empty_page","no_older_items","page_handoff_missing","http_error","request_failed"])
  let rawReason=data["rejectionReason"] as? String ?? ""
  let reason=accepted ? "none":(allowedReasons.contains(rawReason) ? rawReason:"unknown_rejection")
  if recognized { continuationRecognizedResponseSequences.insert(sequence) }
  continuationPayloadRecognizedCount=continuationRecognizedResponseSequences.count
  if dominant != "none" { continuationDominantReasonCounts[dominant,default:0]+=1 }
  continuationAcceptedPageCount += accepted ? 1:0
  continuationRejectedPageCount += accepted ? 0:1
  if let requestCursor {continuationRequestCursorFingerprints.insert(requestCursor)}
  if let responseCursor {continuationResponseCursorFingerprints.insert(responseCursor)}
  if let page {continuationPageFingerprints.insert(page)}
  continuationDuplicatePageCount += duplicatePage ? 1:0
  continuationDuplicateCursorCount += duplicateCursor ? 1:0
  continuationDuplicateFirstPassPageCount += duplicateFirstPage ? 1:0
  continuationDuplicateFirstPassCursorCount += duplicateFirstCursor ? 1:0
  continuationOlderDirectionCount += direction=="older" ? 1:0
  continuationNotOlderDirectionCount += direction=="not_older" ? 1:0
  let elapsed=continuationStartedAt.map{max(0,Int(now.timeIntervalSince($0)*1000))} ?? 0
  let breakdownLine=itemCounts.contains(where:{$0.1 != nil}) ? " · items baselineKnown/withinDuplicate/missingID/missingTime/invalidTime/notOlder/olderOther/eligible/accepted [\(itemCounts[1].1.map(String.init) ?? "?")/\(itemCounts[2].1.map(String.init) ?? "?")/\(itemCounts[3].1.map(String.init) ?? "?")/\(itemCounts[4].1.map(String.init) ?? "?")/\(itemCounts[5].1.map(String.init) ?? "?")/\(itemCounts[6].1.map(String.init) ?? "?")/\(itemCounts[7].1.map(String.init) ?? "?")/\(itemCounts[8].1.map(String.init) ?? "?")/\(itemCounts[9].1.map(String.init) ?? "?")] · dominant \(dominant) · frontier \(frontierExists ? "present":"missing")/\(frontierTimestampValid ? "timestamp_valid":"timestamp_invalid")/\(frontierIdentityPresent ? "identity_present":"identity_not_retained") · source \(frontierSource) · compare \(comparisonMode) · temporal older/equal/newer/unknown [\((frontier["older"] as? NSNumber)?.intValue ?? 0)/\((frontier["equal"] as? NSNumber)?.intValue ?? 0)/\((frontier["newer"] as? NSNumber)?.intValue ?? 0)/\((frontier["timestampUnknown"] as? NSNumber)?.intValue ?? 0)]":""
  let sourceOverlap="tracked/other-origin first-pass overlap \(trackedOverlap.map(String.init) ?? "unknown")/\(otherOverlap.map(String.init) ?? "unknown") (identity sets truncated \(data["trackedFirstPassIdentitySetTruncated"] as? Bool == true ? "yes":"no")/\(data["otherOriginFirstPassIdentitySetTruncated"] as? Bool == true ? "yes":"no"))"
  let originLine="origin \(requestOrigin) · request #\((data["requestOrdinal"] as? NSNumber)?.intValue ?? 0) · cursor first-pass match \(cursorSeenFirstPass ? (cursorOrdinal.map(String.init) ?? "yes"):"no") · exact first-pass page \(exactFirstPassPage ? "yes":"no") · full aggregate baseline overlap \(baselineOverlap)/\(baselineIdentityCount) · \(sourceOverlap) · membership telemetry \(membershipReason) · all baseline-known \(allKnown.map{$0 ? "yes":"no"} ?? "unknown") · new identities \(newIdentityCount.map(String.init) ?? "unknown")"
  let provenanceLine=provenanceCounts.isEmpty ? "" : " · first-pass identity sources [\(provenanceSummary.isEmpty ? "none":provenanceSummary)]"
  let line="response #\(sequence) +\(elapsed)ms hook +\(responseElapsed.map(String.init) ?? "unknown")ms [\(transport) \(requestClass)] HTTP \(status) · request cursor \(requestCursor ?? "none") · response cursor \(responseCursor ?? "none") · page \(page ?? "none") · items \(itemCount.map(String.init) ?? "unknown") · hasPreviousPage \(hasPrevious.map{$0 ? "yes":"no"} ?? "unknown") · \(originLine) · parser \(recognized ? "yes":"no") · filters generation/route/document \(generation ? "yes":"no")/\(route ? "yes":"no")/\(document ? "yes":"no") · duplicate page/cursor \(duplicatePage ? "yes":"no")/\(duplicateCursor ? "yes":"no") · first-pass duplicate page/cursor \(duplicateFirstPage ? "yes":"no")/\(duplicateFirstCursor ? "yes":"no") · direction \(direction) · accepted \(accepted ? "yes":"no") · rejection \(reason)\(breakdownLine)\(provenanceLine)"
  continuationResponseEvents.append(line)
  if continuationResponseEvents.count>40{continuationResponseEvents.removeFirst(continuationResponseEvents.count-40)}
 }

 mutating func recordAcceptedPageUpdate(_ received:Int) {
  automationPageUpdateCallbacks+=1
  pagesObserved=max(pagesObserved,received)
 }

 mutating func diagnoseContinuationAtTerminal() {
  guard continuationSelected,continuationDiagnosis=="none" else{return}
  if continuationBridgeCallbackResult == "missing" || continuationBridgeCallbackResult == "not_run" {continuationDiagnosis="continuation_bridge_callback_missing"}
  else if continuationBridgeCallbackResult == "rejected" {continuationDiagnosis="continuation_bridge_failed"}
  else if continuationBridgeSuccess != "yes" {continuationDiagnosis="continuation_bridge_ack_missing"}
  else if !continuationTriggerAttempted || continuationTriggerResult != "yes" {continuationDiagnosis="continuation_trigger_not_reached"}
  else if continuationHistoryRequests==0 {
   if continuationPageResponses>0 || continuationAggregateGrowth>0 || continuationOlderUniqueMessages>0 {continuationDiagnosis="continuation_request_observer_missed_progress"}
   else {continuationDiagnosis="continuation_trigger_no_history_request"}
  }
  else if continuationHistoryResponses==0 {
   if continuationPageResponses>0 || continuationAggregateGrowth>0 || continuationOlderUniqueMessages>0 {continuationDiagnosis="continuation_response_observer_missed_progress"}
   else {continuationDiagnosis="continuation_history_response_missing"}
  }
  else {continuationDiagnosis="none"}
 }

 mutating func observeContinuationPage(sequence:Int,messageCount:Int,olderUniqueMessages:Int,now:Date=Date()) {
  guard continuationSelected,sequence>continuationBaselinePages,continuationPageSequences.insert(sequence).inserted else{return}
  continuationPageResponses=continuationPageSequences.count
  continuationAggregateGrowth=max(continuationAggregateGrowth,max(0,messageCount-continuationBaselineMessages))
  continuationOlderUniqueMessages=max(continuationOlderUniqueMessages,olderUniqueMessages)
  if continuationFirstHistoryResponseMs==nil {
   continuationFirstHistoryResponseMs=continuationStartedAt.map{max(0,Int(now.timeIntervalSince($0)*1000))}
   recordContinuationStage("first_history_response_seen",source:"page_observer",now:now)
  }
 }

 var timeoutSubtype:String {
  if (stage=="route_reached" || stage=="history_wait_started" || stage=="history_response_seen"),
     let renderedDOMTurnCount,renderedDOMTurnCount>0,historyResponses==0 {return "rendered_dom_history_without_network"}
  if stage=="route_reached" || stage=="history_wait_started" || stage=="history_response_seen" {
   if checkProgress.hasProvenHistoryProgress {
    return checkProgress.paginationProgressObserved ? "pagination_progressing":"pagination"
   }
   if historyResponses>0 {return "history_response_received"}
  }
  switch stage {
  case "navigation_started","navigation_committed","navigation_provisional_failed","navigation_failed","navigation_load_rejected": return "navigation"
  case "route_reached","history_wait_started","history_response_seen": return "waiting_history"
  case "pagination_started","pagination_page_seen": return pagination.currentlyProgressing ? "pagination_progressing":"pagination"
  case "chat_check_no_progress": return navigationTerminalReason != "none" ? navigationTerminalReason:"unknown_stage"
  case "aggregation_started","aggregation_complete": return "aggregation"
  case "history_complete": return hasPreviousPage == true ? "pagination":"waiting_history"
  default: return "unknown_stage"
  }
 }

 func report(ordinal:Int,terminal:String,now:Date=Date(),eligibilityReason:String?=nil)->String {
  let total=Int(now.timeIntervalSince(startedAt)*1000),current=terminalStageDurationMs ?? Int(now.timeIntervalSince(stageStartedAt)*1000)
  let status=httpStatuses.sorted().map(String.init).joined(separator:",")
  var compactStages=[String]();for value in stages where compactStages.last != value {compactStages.append(value)}
  let hookHealth=hookHealthRecorded ? "activity \(hookInstalled ? "yes":"no"), fetch \(fetchHookActive ? "yes":"no"), XHR \(xhrHookActive ? "yes":"no"), generation \(generationAttached ? "yes":"no")" : "unobserved"
  let pageDetails=pagination.pages.map{$0.safeSummary()}.joined(separator:"; ")
  let average=pagination.averageResponseDurationMs.map(String.init) ?? "unknown"
  let rate=pagination.pagesPerMinute.map{String(format:"%.1f",$0)} ?? "unknown"
  let lifecycle="generation created \(generationCreated ? "yes":"no") · navigation owner matches \(navigationOwnerGenerationMatches ? "yes":"no") · cleanup \(cleanupOwnershipResult)"
  let paginationSummary="pages observed \(pagesObserved) · saved-boundary replay pages \(pagination.replayPagesObserved) · boundary reached \(!pagination.replayingSavedBoundary ? "yes":"no") · replay progress pages \(pagination.replayPagesProgressed) · replay progress observed \(pagination.replayProgressObserved ? "yes":"no") · currently progressing \(pagination.currentlyProgressing ? "yes":"no") · new-history progress observed \(pagination.olderHistoryProgressObserved ? "yes":"no") · unique messages beyond saved baseline \(pagination.olderUniqueBaselineMessageCount) · messages \(messagesAccumulated) · avg response \(average) ms · pages/min \(rate) · older unique continuation messages \(olderUniqueMessageCount) · frontier \(paginationFrontierTimestamp == nil ? "unproven":"observed") · no-progress \(paginationNoProgressTriggered ? "triggered":"no")"
  let dominantReasons=continuationDominantReasonCounts.keys.sorted().map{"\($0)=\(continuationDominantReasonCounts[$0] ?? 0)"}.joined(separator:",")
  let responseEventsShownRecognized=continuationResponseEvents.filter{$0.contains(" · parser yes ·")}.count
  let responsePipelineSummary=continuationSelected ? " · first-pass boundary {\(continuationFirstPassBoundarySummary)} · request-origin first-pass/continuation/unknown \(continuationResponseOriginFirstPass)/\(continuationResponseOriginContinuation)/\(continuationResponseOriginUnknown) · continuation source-overlap totals tracked/other-origin \(continuationTrackedBaselineOverlapTotal)/\(continuationOtherOriginBaselineOverlapTotal) · continuation cursors seen/new \(continuationContinuationCursorSeenFirstPass)/\(continuationContinuationCursorNew) · exact first-pass page matches \(continuationExactFirstPassPageMatches) · baseline-known-only/new-identity pages \(continuationKnownBaselineOnlyPages)/\(continuationPagesWithNewIdentity) · baseline membership telemetry mismatches \(continuationBaselineMembershipMismatchCount) · first continuation request {\(continuationFirstContinuationRequestSummary)} · response→page pipeline \(continuationResponseSequences.count) responses · parser recognized \(responseEventsShownRecognized)/\(continuationResponseEvents.count) shown (event-level payloadRecognized yes) · total recognized \(continuationRecognizedResponseSequences.count) · page accepted \(continuationAcceptedPageCount) · page rejected \(continuationRejectedPageCount) · no-older exact reasons [\(dominantReasons.isEmpty ? "none":dominantReasons)] · unique request cursors \(continuationRequestCursorFingerprints.count) · unique response cursors \(continuationResponseCursorFingerprints.count) · unique page fingerprints \(continuationPageFingerprints.count) · duplicate pages/cursors \(continuationDuplicatePageCount)/\(continuationDuplicateCursorCount) · exact first-pass duplicate pages/cursors \(continuationDuplicateFirstPassPageCount)/\(continuationDuplicateFirstPassCursorCount) · older/not-older responses \(continuationOlderDirectionCount)/\(continuationNotOlderDirectionCount) · events [\(continuationResponseEvents.isEmpty ? "none":continuationResponseEvents.joined(separator:"; "))]":""
  let continuationTrace=continuationSelected ? " · continuation diagnostics [\(continuationStages.joined(separator:" → "))] · trigger telemetry sources [\(continuationTriggerSources.joined(separator:","))] (one logical attempt) · first-pass hook baseline \(continuationBaselineHistoryRequests)/\(continuationBaselineHistoryResponses) · continuation hook delta \(continuationHistoryRequests)/\(continuationHistoryResponses) · continuation page responses \(continuationPageResponses) · aggregate growth \(continuationAggregateGrowth) · unique older messages \(continuationOlderUniqueMessages) · first request \(continuationFirstHistoryRequestMs.map(String.init) ?? "none") ms · first response \(continuationFirstHistoryResponseMs.map(String.init) ?? "none") ms · diagnosis \(continuationDiagnosis)\(responsePipelineSummary)":""
  let domTurns=renderedDOMTurnCount.map{String($0)} ?? "unobserved"
  let domRoles="rendered DOM turns \(domTurns) (user/assistant/unknown \(renderedDOMUserTurnCount)/\(renderedDOMAssistantTurnCount)/\(renderedDOMUnknownRoleTurnCount))"
  return "Chat \(ordinal): \(terminal) · last stage \(stageBeforeFinish ?? stage) · stages [\(compactStages.joined(separator:" → "))] · stage \(current) ms / total \(total) ms · \(lifecycle) · navigation object/provisional \(navigationObjectReturned ? "yes":"no")/\(navigationProvisionalStarted ? "yes":"no") · navigation reason \(navigationTerminalReason) · route \(routeReached ? "yes":"no") · history requests/responses \(historyRequests)/\(historyResponses) · \(domRoles) · \(paginationSummary) · first-pass provenance {\(firstPassIdentityProvenanceSummary)} · continuation \(continuationAttempted ? continuationTerminalReason:"not_attempted") · pass 1 pages/messages \(continuationFirstPassPages)/\(continuationStartingMessages) · page update callbacks \(automationPageUpdateCallbacks) · same document \(documentIdentity == nil ? "unverified":"verified")\(continuationTrace) · timing {\(timing.report(now:now))} · page progression [\(pageDetails.isEmpty ? "none":pageDetails)] · has_previous_page \(hasPreviousPage.map{ $0 ? "yes":"no" } ?? "unknown") · HTTP [\(status.isEmpty ? "none":status)] · 429 \(rateLimitSeen ? "yes":"no") · aggregation \(aggregationStarted ? "started":"not_started")/\(aggregationCompleted ? "complete":"incomplete") · hooks \(hookHealth) · render lease \(renderLeaseActive ? "active":"inactive")\(eligibilityReason.map { " · eligibility reason \($0)" } ?? "")"
 }
}
struct ChatCheckReportSnapshot {
 var telemetry:ChatCheckStageTelemetry
 let ordinal:Int
 let terminal:String
 let eligibilityReason:String?
}
struct ChatCheckContinuationCheckpoint {
 let documentIdentity:String
 let frontierTimestamp:Double
 let aggregate:SafeAggregate
 let firstPassPages:Int
 let firstPassPageUpdateCallbacks:Int
 let firstPassMessages:Int
 let firstPassHistoryRequests:Int
 let firstPassHistoryResponses:Int
 let replayProgressObserved:Bool
 let newHistoryProgressObserved:Bool
 let hasPreviousPage:Bool
 let historyProgress:ChatCheckProgressAccumulator
 var timing:ChatCheckTimingTelemetry
}
final class NativeCycleScheduler {
 private var timer: Timer?
 func cancel(){timer?.invalidate();timer=nil}
 func schedule(at date: Date, fire: @escaping () -> Void) {
  cancel()
  timer=Timer.scheduledTimer(withTimeInterval:max(0.001,date.timeIntervalSinceNow),repeats:false){_ in fire()}
 }
}

struct PinnedCoverageProof:Codable {
 var top:Bool
 var statuses:[String]
 var pinnedCount:Int
 var timestampsResolved:Int
 var recentCount:Int = 0
 var unresolvedReason:String = "pinned_prefix_unproven"
 var completionReason:String? = nil
 var readinessStatus:String = "not_run"
 var readinessReason:String = "not_run"
 var topProven:Bool? = nil
 var prefixCompleteReported:Bool? = nil
 var prefixComplete:Bool {
  guard top,let firstOrdinary=statuses.firstIndex(of:"not pinned"),statuses.count==firstOrdinary+1 else{return false}
  return statuses.prefix(firstOrdinary).allSatisfy{$0=="pinned"}&&pinnedCount==firstOrdinary
 }
 var complete:Bool {prefixComplete&&timestampsResolved==pinnedCount&&recentCount>=0&&recentCount<=timestampsResolved}
}

enum PinnedFallbackStatus:String,Codable {case notAttempted="not_attempted",attempted,completed,failed}
struct StarredCoverageProofState:Codable {
 var explicitStarredObserved:Bool
 var explicitPartitionComplete:Bool
 var fallbackStatus:PinnedFallbackStatus = .notAttempted
 var proof:PinnedCoverageProof?
 var failureReason:String?
 var source:String {
  if explicitPartitionComplete{return "explicit_partition"}
  if fallbackStatus == .completed,proof?.complete == true{return "pinned_prefix"}
  return "unresolved"
 }
 var diagnosticsLine:String {
  let readiness=proof?.readinessStatus ?? "not_run"
  let top=proof?.topProven.map{$0 ? "yes":"no"} ?? "unknown"
  let prefix=proof?.prefixCompleteReported.map{$0 ? "yes":"no"} ?? (proof.map{$0.prefixComplete ? "yes":"no"} ?? "unknown")
  let pinned=proof?.pinnedCount.description ?? "unknown"
  let activity="\(proof?.timestampsResolved.description ?? "unknown")/\(pinned)"
  let recent=proof?.recentCount.description ?? "unknown"
  let failure=(fallbackStatus == .completed && proof?.complete == true) ? "none" : (failureReason ?? proof?.unresolvedReason ?? "none")
  let completion=(fallbackStatus == .completed && proof?.complete == true) ? (proof?.completionReason ?? "unknown") : "none"
  return "Starred proof state: explicit starred observed \(explicitStarredObserved ? "yes":"no") · fallback \(fallbackStatus.rawValue) · readiness \(readiness) · top \(top) · prefix complete \(prefix) · pinned \(pinned) · activity resolved \(activity) · recent pinned \(recent) · source \(source) · completion reason \(completion) · failure \(failure)"
 }
 var isConsistent:Bool {
  guard !explicitPartitionComplete || explicitStarredObserved else{return false}
  switch fallbackStatus {
  case .notAttempted:return proof == nil && failureReason == nil
  case .attempted:return !explicitStarredObserved && proof == nil && failureReason == nil
  case .completed:return !explicitStarredObserved && proof?.complete == true && proof?.unresolvedReason == "none" && proof?.completionReason != nil && failureReason == nil
  case .failed:
   guard !explicitStarredObserved,let proof, !proof.complete, failureReason != nil else{return false}
   if failureReason == "sidebar_snapshot_unstable" {return fallbackStatus == .failed}
   return true
  }
 }
 mutating func beginFallback(){fallbackStatus = .attempted}
 mutating func finishFallback(_ proof:PinnedCoverageProof){var canonical=proof;if canonical.complete{canonical.unresolvedReason="none";if canonical.completionReason == nil{canonical.completionReason="first_not_pinned"};self.proof=canonical;failureReason=nil;fallbackStatus = .completed}else{canonical.completionReason=nil;self.proof=canonical;fallbackStatus = .failed;failureReason=canonical.unresolvedReason}}
 mutating func failFallback(_ reason:String){let failure=PinnedCoverageProof(top:false,statuses:[],pinnedCount:0,timestampsResolved:0,unresolvedReason:reason);proof=failure;failureReason=reason;fallbackStatus = .failed}
}
import Foundation

enum RootRequestCorrelationStage:String,Codable { case request_observed,response_observed,list_message_sent,native_handoff,consume_attempt,consume_new,consume_repeated,consume_rejected }
struct RootRequestCorrelationEvent:Codable,Equatable {
 let sequence:Int;let stage:RootRequestCorrelationStage;let timestamp:Date;let transport:String;let method:String;let offset:Int?;let status:Int?;let itemCount:Int?;let queryParameterNames:[String];let paginationParameterNames:[String];let bodyPresent:Bool;let signalPresent:Bool;let credentialsMode:String;let customHeadersPresent:Bool;let customHeaderCount:Int
 static func make(_ d:[String:Any],at:Date=Date())->RootRequestCorrelationEvent? {
  guard let n=(d["sequence"] as? NSNumber)?.intValue,n>0,let raw=d["stage"] as? String,let stage=RootRequestCorrelationStage(rawValue:raw) else{return nil}
  func names(_ key:String,_ max:Int)->[String]{Array(Set((d[key] as? [String] ?? []).filter{$0.range(of:"^[A-Za-z][A-Za-z0-9_-]{0,39}$",options:.regularExpression) != nil})).sorted().prefix(max).map{$0}}
  let method=d["method"] as? String ?? "UNKNOWN",transport=d["transport"] as? String ?? "unknown",credentials=d["credentialsMode"] as? String ?? "unknown"
  return RootRequestCorrelationEvent(sequence:n,stage:stage,timestamp:at,transport:["fetch","xhr"].contains(transport) ? transport:"unknown",method:["GET","POST","PUT","PATCH","DELETE","OPTIONS","HEAD"].contains(method) ? method:"UNKNOWN",offset:(d["offset"] as? NSNumber)?.intValue,status:(d["status"] as? NSNumber)?.intValue,itemCount:(d["itemCount"] as? NSNumber)?.intValue,queryParameterNames:names("queryParameterNames",30),paginationParameterNames:names("paginationParameterNames",12),bodyPresent:d["bodyPresent"] as? Bool == true,signalPresent:d["signalPresent"] as? Bool == true,credentialsMode:["omit","same-origin","include"].contains(credentials) ? credentials:"unknown",customHeadersPresent:d["customHeadersPresent"] as? Bool == true,customHeaderCount:min(100,max(0,(d["customHeaderCount"] as? NSNumber)?.intValue ?? 0)))
 }
}
struct RootRequestCorrelationState:Codable,Equatable {
 private(set) var events:[RootRequestCorrelationEvent]=[]
 mutating func append(_ e:RootRequestCorrelationEvent){events.append(e);if events.count>1000{events.removeFirst(events.count-1000)}}
 func count(_ sequence:Int,_ stage:RootRequestCorrelationStage)->Int{events.filter{$0.sequence==sequence && $0.stage==stage}.count}
 var privacySchemaIsSafe:Bool {let keys:Set<String>=["sequence","stage","timestamp","transport","method","offset","status","itemCount","queryParameterNames","paginationParameterNames","bodyPresent","signalPresent","credentialsMode","customHeadersPresent","customHeaderCount"];return keys.isDisjoint(with:["records","conversationId","projectId","diagnosticRequestId","url","body","headers","headerValues"])}
}

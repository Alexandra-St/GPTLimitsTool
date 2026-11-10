import Foundation

@main struct RecentSafetyProbeRunnerTests {
 @MainActor static func main() async {
  let app=Prototype()
  app.cycleToken="synthetic-cycle"
  app.cycleDiscovering=true
  app.cycleRootTriggerStarted=true
  app.originalNormalDiscoveryFailureReason="no_list_response"
  precondition(app.web == nil)
  var calls=0
  app.recentSafetyProbeJavaScriptOverride={ _,token in
   precondition(token=="synthetic-probe")
   calls+=1
   return "response_dispatched"
  }
  let outcome=await app.runRecentSafetyProbe("synthetic-probe")
  precondition(outcome=="response_dispatched" && calls==1)
  precondition(app.recentSafetyProbe?.jsOutcome=="response_dispatched")
  precondition(app.recentSafetyProbe?.terminalCompleted==false)
  precondition(app.recentSafetyProbe?.listMessageReceived==false)
  let record:[String:Any]=["conversationId":"synthetic-probe-chat-33bh","title":"Synthetic fixture","updatedAt":Date().timeIntervalSince1970*1000]
  let payload:[String:Any]=["cycleToken":"synthetic-cycle","probeToken":"synthetic-probe","provenance":"recent_safety_probe","scope":"root","offset":0,"cursorPresent":false,"records":[record]]
  var wrong=payload;wrong["probeToken"]="wrong-probe"
  app.consumeValidatedListMessage(wrong)
  precondition(app.recentSafetyProbe?.terminalCompleted==false && app.recentSafetyProbe?.listMessageReceived==false)
  var ordinary=payload;ordinary["provenance"]="normal_discovery";ordinary["scope"]="project";ordinary["offset"]=19;ordinary["records"]=[[String:Any]]()
  app.consumeValidatedListMessage(ordinary)
  precondition(app.recentSafetyProbe?.terminalCompleted==false && app.recentSafetyProbe?.listMessageReceived==false)
  let rootBefore=app.cycleRootResponseReceived
  let partitionsBefore=app.cyclePartitions.count
  let coverageBefore=compositeCoverage(Array(app.cyclePartitions.values),cutoff:Date().timeIntervalSince1970*1000-21600000).isComplete
  app.consumeValidatedListMessage(payload)
  precondition(app.cycleRootResponseReceived==rootBefore && !app.cycleRootResponseReceived)
  precondition(app.cyclePartitions.count==partitionsBefore && partitionsBefore==0)
  precondition(!coverageBefore && !compositeCoverage(Array(app.cyclePartitions.values),cutoff:Date().timeIntervalSince1970*1000-21600000).isComplete)
  precondition(app.recentSafetyProbe?.listMessageReceived==true)
  precondition(app.recentSafetyProbe?.consumeResult == .accepted_new || app.recentSafetyProbe?.consumeResult == .accepted_repeated)
  precondition(app.recentSafetyProbe?.terminalCompleted==true && app.recentSafetyProbe?.terminalResult == .consume_terminal)
  precondition(app.cycleState.records["synthetic-probe-chat-33bh"] != nil && app.cycleIds.contains("synthetic-probe-chat-33bh"))
  let terminal=await app.awaitRecentSafetyProbeTerminal(probeToken:"synthetic-probe",cycleGeneration:"synthetic-cycle")
  precondition(terminal == .consume_terminal)
  app.cycleCutoffTimestamp=Date().timeIntervalSince1970*1000-21600000
  app.cycleRootResponseReceived=false
  app.cycleRootStatuses=[]
  app.cycleState.lastCycleAt=Date()
  app.cycleState.discoveryStatus = .inProgress
  var evidence=CycleTerminalEvidence(cycleSequence:app.cycleSequence)
  evidence.originalNormalDiscoveryFailureReason=app.originalNormalDiscoveryFailureReason
  evidence.normalDiscoveryOutcome="no_list_response"
  let observations=Array(app.cyclePartitions.values)
  let baseComplete=hasCompletePartitionSet(observations,base:PartitionDescriptor(archived:false,starred:false),cutoff:app.cycleCutoffTimestamp)
  let proof=StarredCoverageProofState(explicitStarredObserved:false,explicitPartitionComplete:false)
  let composite=compositeCoverage(observations,cutoff:app.cycleCutoffTimestamp)
  guard let result=app.finalizeDiscoveryAndBuildCandidates(cycleGeneration:"synthetic-cycle",started:Date(),stallDetail:"no_list_response",baseDiscoveryComplete:baseComplete,starredProofState:proof,terminalResult:terminal,composite:composite,terminalEvidence:&evidence) else {fatalError("production candidate construction was rejected")}
  let recent=result.recent
  precondition(recent.contains{$0.conversationId=="synthetic-probe-chat-33bh"})
  let candidates=result.checkCandidates
  precondition(candidates.contains{$0.conversationId=="synthetic-probe-chat-33bh"})
  let queue=app.cycleState.queue(candidates)
  precondition(queue.contains{$0.conversationId=="synthetic-probe-chat-33bh"})
  let forensicTimestamp=result.cycleForensicTimestamp
  let queuedIDs=app.recordCandidateAdmission(queue:queue,checkCandidates:candidates,recent:recent,maintenanceCandidateIDs:result.maintenanceCandidateIDs,cycleForensicTimestamp:forensicTimestamp,observedNow:result.observedNow,terminalEvidence:&evidence)
  precondition(queuedIDs.contains("synthetic-probe-chat-33bh"))
  precondition(evidence.admittedCandidateCount==1 && evidence.candidatesBuiltAfterProbe==true)
  precondition(evidence.discoveryFinalizedAfterProbe==true)
  precondition(evidence.originalNormalDiscoveryFailureReason=="no_list_response")
  precondition(evidence.coverageComplete==false && evidence.cycleRootResponseReceived==false)
  precondition(evidence.probeContributedPartition==false)
  precondition(app.recentSafetyProbeTerminalResult == .consume_terminal && !app.recentSafetyProbePending)
  precondition(app.cycleState.records["synthetic-probe-chat-33bh"]?.forensicHistory.contains{ $0.cycleTimestamp==forensicTimestamp && $0.queued }==true)
  precondition(app.cycleState.records["synthetic-probe-chat-33bh"]?.forensicHistory.contains{ $0.cycleTimestamp==forensicTimestamp && $0.queued && !$0.checked }==true)
  precondition(!app.cycleRootResponseReceived && app.cyclePartitions.isEmpty)
  precondition(!compositeCoverage(Array(app.cyclePartitions.values),cutoff:forensicTimestamp-21600000).isComplete)
  let events=app.recentSafetyProbe!.events
  app.consumeValidatedListMessage(payload)
  precondition(app.recentSafetyProbe?.terminalResult == .consume_terminal)
  precondition(app.recentSafetyProbe!.events.filter{$0.hasPrefix("probe_terminal_result:")}.count==1)
  precondition(app.recentSafetyProbe!.events.filter{$0.hasPrefix("probe_consume_result:")}.count==events.filter{$0.hasPrefix("probe_consume_result:")}.count)
  let repeated=await app.runRecentSafetyProbe("synthetic-probe")
  precondition(repeated=="stale_or_mismatched_probe_token" && calls==1)
  app.recentSafetyProbeJavaScriptOverride=nil
  precondition(app.recentSafetyProbeJavaScriptOverride==nil)

  app.cycleToken="synthetic-cycle-error"
  app.cycleDiscovering=true
  app.recentSafetyProbeJavaScriptOverride={ _,token in
   precondition(token=="synthetic-error")
   calls+=1
   throw NSError(domain:"fixture",code:1)
  }
  let failure=await app.runRecentSafetyProbe("synthetic-error")
  precondition(failure=="request_failed" && calls==2)
  precondition(app.recentSafetyProbe?.jsOutcome=="request_failed")
  precondition(app.recentSafetyProbe?.terminalCompleted==true)
  precondition(app.recentSafetyProbe?.terminalResult == .js_terminal)
  app.recentSafetyProbeJavaScriptOverride=nil
  precondition(app.recentSafetyProbeJavaScriptOverride==nil)
  print("PASS: executor override through production runner (success, one-shot, error)")
 }
}

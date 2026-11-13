import AppKit
import Darwin
import WebKit
import UserNotifications

func formatMaintenanceDiagnostics(lastStatus:String,chatCheckReports:[String])->(counters:String,admission:String) {
 let counters:String
 if let line=lastStatus.components(separatedBy:"\n").first(where:{$0.hasPrefix("Stale incomplete maintenance:")}) {
  func value(_ label:String)->String {
   let boundary = label == "eligible" ? "^Stale incomplete maintenance: " : "(?:^| · )"
   let pattern=boundary+NSRegularExpression.escapedPattern(for:label)+" ([0-9]+)(?= · |$)"
   guard let regex=try? NSRegularExpression(pattern:pattern),let match=regex.firstMatch(in:line,range:NSRange(line.startIndex...,in:line)),let range=Range(match.range(at:1),in:line) else{return "unavailable"}
   return String(line[range])
  }
  let eligible=value("eligible"),admitted=value("admitted"),deferred=value("deferred by cap")
  counters="Stale incomplete eligible: \(eligible) · admitted: \(admitted) · deferred by cap: \(deferred)"
 } else { counters="Stale incomplete eligible: unavailable · admitted: unavailable · deferred by cap: unavailable" }
 let admission=chatCheckReports.isEmpty ? "Per-chat admission provenance: unavailable" : "Per-chat admission provenance:\n"+chatCheckReports.map{report in
  if let range=report.range(of:"eligibility reason ([^ ·]+)",options:.regularExpression){return String(report[range].dropFirst("eligibility reason ".count))}
  return "admission provenance: unavailable"
 }.joined(separator:"\n")
 return(counters,admission)
}
import UniformTypeIdentifiers
import CoreGraphics

final class WeakResponderReference {
    weak var value:NSResponder?
    init(_ value:NSResponder?) { self.value=value }
}

final class DiagnosticsDocumentView:NSView {
    override var isFlipped:Bool {true}
}

final class DiagnosticsStackView:NSStackView {
    override var isFlipped:Bool {true}
}

enum PinnedActivityWaitResult {
    case response([String:Any])
    case timeout
    case error(String)
}

enum WindowPresentationIntent: Equatable {
    case userInitiated
    case background
}

struct SidebarDiagnosticSummary: Equatable {
    let result:String
    let detectedRowCount:Int
    let pinnedRowCandidateCount:Int
    let recognizedRouteTemplateCount:Int
    let sidebarPresent:Bool?
    let navPresent:Bool?
    let asidePresent:Bool?
    let scrollContainerCount:Int
    let reason:String
    let timestamp:String
    let stage:String
    let elapsedMs:Int
    let exceptionCategory:String

    static func sanitizedReason(_ value:String)->String {
        let allowed=CharacterSet(charactersIn:"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
        let scalars=value.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : "_" }
        let normalized=String(scalars).prefix(80)
        return normalized.isEmpty ? "unknown":String(normalized)
    }
    static func make(result:String,detectedRowCount:Int,pinnedRowCandidateCount:Int,recognizedRouteTemplateCount:Int,sidebarPresent:Bool?,navPresent:Bool?,asidePresent:Bool?,scrollContainerCount:Int,reason:String,stage:String="not_run",elapsedMs:Int=0,exceptionCategory:String="none",date:Date=Date())->SidebarDiagnosticSummary {
        let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        return SidebarDiagnosticSummary(result:result=="success" ? "success":"failure",detectedRowCount:max(0,detectedRowCount),pinnedRowCandidateCount:max(0,pinnedRowCandidateCount),recognizedRouteTemplateCount:max(0,recognizedRouteTemplateCount),sidebarPresent:sidebarPresent,navPresent:navPresent,asidePresent:asidePresent,scrollContainerCount:max(0,scrollContainerCount),reason:sanitizedReason(reason),timestamp:formatter.string(from:date),stage:sanitizedReason(stage),elapsedMs:max(0,min(600000,elapsedMs)),exceptionCategory:sanitizedReason(exceptionCategory))
    }
    var displayText:String {
        "Last sidebar diagnostic: \(result) · rows \(detectedRowCount) · pinned candidates \(pinnedRowCandidateCount) · route templates \(recognizedRouteTemplateCount) · sidebar/nav/aside \(sidebarPresent.map{$0 ? "yes":"no"} ?? "unknown")/\(navPresent.map{$0 ? "yes":"no"} ?? "unknown")/\(asidePresent.map{$0 ? "yes":"no"} ?? "unknown") · scroll containers \(scrollContainerCount) · reason \(reason) · stage \(stage) at \(elapsedMs) ms · exception \(exceptionCategory) · \(timestamp)"
    }
}

enum DiscoveryPageConsumeResult:String { case accepted_new,accepted_repeated,rejected_stale_cycle,rejected_rate_limited,rejected_invalid_page }
enum RecentSafetyProbeTerminalResult:String { case js_terminal,consume_terminal,bridge_failure,cancelled_or_stale }
struct CycleTerminalEvidence {
    enum TerminalKind:String,Codable { case success,error,cancelled_or_stale }
    let cycleSequence:UInt64
    var normalDiscoveryOutcome:String?=nil
    var originalNormalDiscoveryFailureReason:String?=nil
    var recentSafetyProbeAttempted:Bool?=nil
    var probeJSOutcome:String?=nil
    var probeListReceived:Bool?=nil
    var probeConsumeResult:String?=nil
    var probeTerminalResult:String?=nil
    var discoveryFinalizedAfterProbe:Bool?=nil
    var candidatesBuiltAfterProbe:Bool?=nil
    var coverageComplete:Bool?=nil
    var cycleRootResponseReceived:Bool?=nil
    var probeContributedPartition:Bool?=nil
    var admittedCandidateCount:Int?=nil
    var terminalKind:TerminalKind?
}
struct LastCycleTerminalSnapshot:Codable,Equatable {
    let buildID:String
    let cycleSequence:UInt64
    let terminalKind:CycleTerminalEvidence.TerminalKind
    let normalDiscoveryOutcome:String?
    let originalNormalDiscoveryFailureReason:String?
    let recentSafetyProbeAttempted:Bool?
    let probeJSOutcome:String?
    let probeListReceived:Bool?
    let probeConsumeResult:String?
    let probeTerminalResult:String?
    let discoveryFinalizedAfterProbe:Bool?
    let candidatesBuiltAfterProbe:Bool?
    let coverageComplete:Bool?
    let cycleRootResponseReceived:Bool?
    let probeContributedPartition:Bool?
    let admittedCandidateCount:Int?
    let cycleFinished:Bool
    let finishedAt:Date
}
enum TerminalSnapshotPersistenceStage:String,Codable {
    case directoryCreate="directory_create"
    case existingSnapshotRead="existing_snapshot_read"
    case existingSnapshotDecode="existing_snapshot_decode"
    case snapshotEncode="snapshot_encode"
    case snapshotWrite="snapshot_write"
}
struct TerminalSnapshotPersistenceFailure:Codable,Equatable {
    let stage:TerminalSnapshotPersistenceStage
    let errorDomain:String
    let errorCode:Int
    let cycleSequence:UInt64
    let buildID:String
    init(stage:TerminalSnapshotPersistenceStage,error:NSError,snapshot:LastCycleTerminalSnapshot) {
        let allowed=CharacterSet(charactersIn:"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-")
        func sanitized(_ value:String)->String {
            let result=String(String.UnicodeScalarView(value.unicodeScalars.map{allowed.contains($0) ? $0:UnicodeScalar(95)}.prefix(80)))
            return result.isEmpty ? "unknown":result
        }
        self.stage=stage;self.errorDomain=sanitized(error.domain);self.errorCode=error.code
        self.cycleSequence=snapshot.cycleSequence;self.buildID=sanitized(snapshot.buildID)
    }
    var diagnosticText:String {
        "snapshot_status=persist_failed\npersistence_stage=\(stage.rawValue)\nerror_domain=\(errorDomain)\nerror_code=\(errorCode)\ncycle_sequence=\(cycleSequence)\nbuild_id=\(buildID)"
    }
}
enum TerminalSnapshotPersistenceResult:Equatable {
    case persisted
    case skippedOlderExistingSequence
    case failed(TerminalSnapshotPersistenceFailure)
}
let terminalSnapshotPersistenceFailureDefaultsKey="lastCycleTerminalSnapshotPersistenceFailureV1"
func makeLastCycleTerminalSnapshot(from evidence:CycleTerminalEvidence,buildID:String,finishedAt:Date=Date())->LastCycleTerminalSnapshot? {
    guard let terminalKind=evidence.terminalKind else{return nil}
    return LastCycleTerminalSnapshot(buildID:buildID,cycleSequence:evidence.cycleSequence,terminalKind:terminalKind,
        normalDiscoveryOutcome:evidence.normalDiscoveryOutcome,originalNormalDiscoveryFailureReason:evidence.originalNormalDiscoveryFailureReason,
        recentSafetyProbeAttempted:evidence.recentSafetyProbeAttempted,probeJSOutcome:evidence.probeJSOutcome,
        probeListReceived:evidence.probeListReceived,probeConsumeResult:evidence.probeConsumeResult,probeTerminalResult:evidence.probeTerminalResult,
        discoveryFinalizedAfterProbe:evidence.discoveryFinalizedAfterProbe,candidatesBuiltAfterProbe:evidence.candidatesBuiltAfterProbe,
        coverageComplete:evidence.coverageComplete,cycleRootResponseReceived:evidence.cycleRootResponseReceived,
        probeContributedPartition:evidence.probeContributedPartition,admittedCandidateCount:evidence.admittedCandidateCount,
        cycleFinished:true,finishedAt:finishedAt)
}
func persistLastCycleTerminalSnapshot(_ snapshot:LastCycleTerminalSnapshot,applicationSupportDirectory:URL?=nil)->TerminalSnapshotPersistenceResult {
    guard let base=applicationSupportDirectory ?? FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask).first else {
        let error=NSError(domain:"GPTLimitsTool",code:1)
        return .failed(TerminalSnapshotPersistenceFailure(stage:.directoryCreate,error:error,snapshot:snapshot))
    }
    let directory=base.appendingPathComponent("GPTLimitsTool",isDirectory:true)
    let file=directory.appendingPathComponent("last-cycle-terminal.json",isDirectory:false)
    do {try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)}
    catch {return .failed(TerminalSnapshotPersistenceFailure(stage:.directoryCreate,error:error as NSError,snapshot:snapshot))}
    if FileManager.default.fileExists(atPath:file.path) {
        let existingData:Data
        do {existingData=try Data(contentsOf:file)}
        catch {return .failed(TerminalSnapshotPersistenceFailure(stage:.existingSnapshotRead,error:error as NSError,snapshot:snapshot))}
        let existing:LastCycleTerminalSnapshot
        do {
            let decoder=JSONDecoder();decoder.dateDecodingStrategy = .iso8601
            existing=try decoder.decode(LastCycleTerminalSnapshot.self,from:existingData)
        } catch {return .failed(TerminalSnapshotPersistenceFailure(stage:.existingSnapshotDecode,error:error as NSError,snapshot:snapshot))}
        if existing.cycleSequence>snapshot.cycleSequence{return .skippedOlderExistingSequence}
    }
    let data:Data
    do {let encoder=JSONEncoder();encoder.dateEncodingStrategy = .iso8601;data=try encoder.encode(snapshot)}
    catch {return .failed(TerminalSnapshotPersistenceFailure(stage:.snapshotEncode,error:error as NSError,snapshot:snapshot))}
    do {try data.write(to:file,options:.atomic);return .persisted}
    catch {return .failed(TerminalSnapshotPersistenceFailure(stage:.snapshotWrite,error:error as NSError,snapshot:snapshot))}
}
func recordTerminalSnapshotPersistenceResult(_ result:TerminalSnapshotPersistenceResult,defaults:UserDefaults = .standard) {
    switch result {
    case .persisted:defaults.removeObject(forKey:terminalSnapshotPersistenceFailureDefaultsKey)
    case .skippedOlderExistingSequence:break
    case .failed(let failure):
        let encoder=JSONEncoder()
        if let data=try? encoder.encode(failure){defaults.set(data,forKey:terminalSnapshotPersistenceFailureDefaultsKey)}
    }
}
func terminalSnapshotPersistenceFailureDiagnostic(defaults:UserDefaults = .standard)->String? {
    guard let data=defaults.data(forKey:terminalSnapshotPersistenceFailureDefaultsKey),
          let failure=try? JSONDecoder().decode(TerminalSnapshotPersistenceFailure.self,from:data) else{return nil}
    return failure.diagnosticText
}
func inspectLastCycleTerminalSnapshot(applicationSupportDirectory:URL?=nil)->String {
    guard let base=applicationSupportDirectory ?? FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask).first else{return terminalSnapshotPersistenceFailureDiagnostic() ?? "no_completed_cycle_snapshot"}
    let file=base.appendingPathComponent("GPTLimitsTool",isDirectory:true).appendingPathComponent("last-cycle-terminal.json",isDirectory:false)
    guard FileManager.default.fileExists(atPath:file.path) else{return terminalSnapshotPersistenceFailureDiagnostic() ?? "no_completed_cycle_snapshot"}
    guard let data=try? Data(contentsOf:file) else{return "invalid_completed_cycle_snapshot"}
    let decoder=JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    guard let snapshot=try? decoder.decode(LastCycleTerminalSnapshot.self,from:data) else{return "invalid_completed_cycle_snapshot"}
    func value(_ raw:String?)->String {
        guard let raw,!raw.isEmpty,raw.unicodeScalars.allSatisfy({CharacterSet(charactersIn:"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-").contains($0)}) else{return "unknown"}
        return String(raw.prefix(128))
    }
    func optionalBool(_ raw:Bool?)->String {raw.map{$0 ? "true":"false"} ?? "unknown"}
    func optionalInt(_ raw:Int?)->String {raw.map{String(max(0,$0))} ?? "unknown"}
    let formatter=ISO8601DateFormatter()
    formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
    return [
        "build_id=\(value(snapshot.buildID))",
        "cycle_sequence=\(snapshot.cycleSequence)",
        "terminal_kind=\(value(snapshot.terminalKind.rawValue))",
        "normal_discovery_outcome=\(value(snapshot.normalDiscoveryOutcome))",
        "original_normal_discovery_failure=\(value(snapshot.originalNormalDiscoveryFailureReason))",
        "recent_safety_probe_attempted=\(optionalBool(snapshot.recentSafetyProbeAttempted))",
        "probe_js_outcome=\(value(snapshot.probeJSOutcome))",
        "probe_list_received=\(optionalBool(snapshot.probeListReceived))",
        "probe_consume_result=\(value(snapshot.probeConsumeResult))",
        "probe_terminal_result=\(value(snapshot.probeTerminalResult))",
        "discovery_finalized_after_probe=\(optionalBool(snapshot.discoveryFinalizedAfterProbe))",
        "candidates_built_after_probe=\(optionalBool(snapshot.candidatesBuiltAfterProbe))",
        "coverage_complete=\(optionalBool(snapshot.coverageComplete))",
        "cycle_root_response_received=\(optionalBool(snapshot.cycleRootResponseReceived))",
        "probe_contributed_partition=\(optionalBool(snapshot.probeContributedPartition))",
        "admitted_candidate_count=\(optionalInt(snapshot.admittedCandidateCount))",
        "cycle_finished=\(snapshot.cycleFinished ? "true":"false")",
        "finished_at=\(formatter.string(from:snapshot.finishedAt))"
    ].joined(separator:"\n")
}

struct ContinuationSourceMessage:Equatable {let id:String;let role:String;let text:String;let createdAt:Double?}
func continuationTextTokenEstimate(_ text:String)->Int {
    guard let regex=try? NSRegularExpression(pattern:"[\\p{L}\\p{N}_]+|[^\\s\\p{L}\\p{N}_]") else{return Int.max}
    let ns=text as NSString
    return regex.matches(in:text,range:NSRange(location:0,length:ns.length)).reduce(0){total,match in
        let piece=ns.substring(with:match.range)
        return total+(piece.unicodeScalars.allSatisfy{$0.properties.isAlphabetic || CharacterSet.decimalDigits.contains($0) || $0=="_"} ? max(1,(piece.unicodeScalars.count+3)/4):1)
    }
}
func continuationRiskDisplayLabel(record:ChatRecord,model:RiskModel,nowMs:Double)->String? {
    switch monitoringState(record:record,model:model,nowMs:nowMs) {
    case .near:return "Near"
    case .critical:return "Critical"
    case .limitFloor:return "Limit floor"
    default:break
    }
    switch confirmedRiskFromLowerBound(record.aggregate?.estimatedTextTokens,model:model) {
    case .near:return "At least Near"
    case .critical:return "At least Critical"
    case .limitFloor:return "At least Limit floor"
    case .normal,.uncertain,.watch:return nil
    }
}
func buildContinuationHandoff(sourceTitle:String,riskDisplayLabel:String,measurementComplete:Bool,truncated:Bool,messages:[ContinuationSourceMessage])->String {
    let selected=Array(messages.prefix(160)).filter{["user","assistant"].contains($0.role) && !$0.text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty}
    guard !selected.isEmpty else{return ""}
    let chronological:[ContinuationSourceMessage]
    if selected.allSatisfy({$0.createdAt?.isFinite == true}) {
        chronological=selected.enumerated().sorted{left,right in
            let a=left.element.createdAt!,b=right.element.createdAt!
            return a == b ? left.offset<right.offset:a<b
        }.map(\.element)
    } else {chronological=selected}
    var bounded=[ContinuationSourceMessage](),totalUnits=0
    for message in chronological {
        let available=min(30000,max(0,32000-totalUnits));guard available>0 else{break}
        let value=message.text as NSString
        var end=min(value.length,available)
        if end>0,end<value.length,(0xD800...0xDBFF).contains(value.character(at:end-1)){end-=1}
        let text=value.substring(to:end)
        guard !text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else{continue}
        totalUnits+=(text as NSString).length
        bounded.append(ContinuationSourceMessage(id:"",role:message.role,text:text,createdAt:message.createdAt))
    }
    guard !bounded.isEmpty else{return ""}
    let title=sourceTitle.components(separatedBy:.newlines).joined(separator:" ").trimmingCharacters(in:.whitespacesAndNewlines)
    let risk=riskDisplayLabel.components(separatedBy:.newlines).joined(separator:" ").trimmingCharacters(in:.whitespacesAndNewlines)
    let coverage:String
    if measurementComplete {coverage=truncated ? "Bounded excerpt; the captured context was truncated to fit the limits.":"Bounded excerpt; only the captured context is included."}
    else {coverage=truncated ? "Partial measurement and truncated bounded excerpt; context may be incomplete.":"Partial measurement; bounded excerpt may be incomplete."}
    let excerpts=bounded.map{"\($0.role == "user" ? "User":"Assistant"):\n\($0.text)"}.joined(separator:"\n\n")
    return [
        "# Conversation continuation",
        "",
        "Source: \(title.isEmpty ? "Untitled conversation":title)",
        "Risk: \(risk)",
        "Context coverage: \(coverage)",
        "",
        "This handoff was prepared from a bounded excerpt and may omit important context.",
        "",
        "## Context excerpts",
        "",
        excerpts,
        "",
        "## Continuation instruction",
        "",
        "Continue from the context above. Preserve established constraints and decisions that are explicitly present in the excerpts. If an important detail is missing or ambiguous, ask instead of inventing it."
    ].joined(separator:"\n")
}
struct ContinuationSourcePreview {
    enum Status {case loading,ready,failed}
    let conversationID:String
    let title:String
    let riskDisplayLabel:String
    let measurementComplete:Bool
    var generation:String?
    var ownerGeneration:String?
    var status:Status
    var messages=[ContinuationSourceMessage]()
    var estimatedTextTokens=0
    var truncated=false
    var earlyMessageCount=0
    var recentMessageCount=0
    var handoffText=""
    var copyFeedback:String?
    var statusText:String {switch status {case .loading:return "Preparing source context…";case .ready:return "Source captured";case .failed:return "Couldn’t prepare source context."}}
    var metadataText:String? {status == .ready ? "\(messages.count) messages · ~\(estimatedTextTokens) tokens":nil}
}

final class Prototype: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, UNUserNotificationCenterDelegate, NSWindowDelegate {
    struct AutomationUpdate: Decodable {
        var token: String;var state: SafeAggregate;var overlap: Bool;var oldest: Bool;var received: Int
        var documentIdentity:String?;var paginationFrontierTimestamp:Double?;var olderUniqueMessageCount:Int?;var continuationProgress:Bool?
        var pageActivityMinimum:Double?;var pageActivityMaximum:Double?;var pageDirection:String?
        var pageFingerprint:String?;var pageKnownMessageCount:Int?;var pageReplay:Bool?
        var newHistoryProgress:Bool?;var replayProgressObserved:Bool?;var replayPagesProgressed:Int?
        var olderUniqueBaselineMessageCount:Int?;var olderHistoryProgressObserved:Bool?;var hasEarlierPages:Bool?
    }
    var cycleState=CycleState()
    let cycleScheduler=NativeCycleScheduler()
    var cycleTask: Task<Void,Never>?
    var runtimeScripts=""
    var runtimeUserScript:WKUserScript?
    var pinnedActivityContextUserScriptInstalled=false
    var cycleSequence:UInt64=0
    var cycleToken="" {
        didSet {
            guard oldValue != cycleToken else{return}
            if !cycleToken.isEmpty {cycleSequence &+= 1}
            recentSafetyProbeAttempted=false
            recentSafetyProbeToken=nil
            recentSafetyProbeTerminalResult=nil
            recentSafetyProbePending=false
        }
    }
    var recentSafetyProbeAttempted=false
    var recentSafetyProbeToken:String?
    var recentSafetyProbeTerminalResult:RecentSafetyProbeTerminalResult?
    var recentSafetyProbePending=false
    struct RecentSafetyProbeState {
        let probeToken:String
        let cycleGeneration:String
        var terminalCompleted=false
        var terminalResult:RecentSafetyProbeTerminalResult?
        var waiter:((RecentSafetyProbeTerminalResult)->Void)?
        var jsOutcome:String?
        var listMessageReceived=false
        var consumeResult:DiscoveryPageConsumeResult?
        var bridgeFailureReason:String?
        var events:[String]=[]
    }
    var recentSafetyProbe:RecentSafetyProbeState?
    func finalizeTerminalEvidence(_ evidence:CycleTerminalEvidence) {
        let buildID=RuntimeIdentity.make(buildMarker:gptLimitsExecutableBuildIDMarker,bundle:Bundle.main).buildID
        guard let snapshot=makeLastCycleTerminalSnapshot(from:evidence,buildID:buildID,finishedAt:Date()) else{return}
        let result=persistLastCycleTerminalSnapshot(snapshot)
        recordTerminalSnapshotPersistenceResult(result)
    }
    @discardableResult func completeRecentSafetyProbe(probeToken:String,cycleGeneration:String,result:RecentSafetyProbeTerminalResult)->Bool {
        guard var probe=recentSafetyProbe,probe.probeToken==probeToken,probe.cycleGeneration==cycleGeneration,
              !probe.terminalCompleted else{return false}
        probe.terminalCompleted=true
        probe.terminalResult=result
        probe.events.append("probe_terminal_result:\(result.rawValue)")
        let completion=probe.waiter
        probe.waiter=nil
        recentSafetyProbe=probe
        completion?(result)
        return true
    }
    @MainActor func awaitRecentSafetyProbeTerminal(probeToken:String,cycleGeneration:String) async -> RecentSafetyProbeTerminalResult {
        guard let probe=recentSafetyProbe,probe.probeToken==probeToken,probe.cycleGeneration==cycleGeneration else{return .cancelled_or_stale}
        if probe.terminalCompleted {return probe.terminalResult ?? .cancelled_or_stale}
        guard probe.waiter==nil else{return .cancelled_or_stale}
        return await withCheckedContinuation { continuation in
            // MainActor serialization keeps this registration atomic with the terminal check above.
            guard var current=recentSafetyProbe,current.probeToken==probeToken,current.cycleGeneration==cycleGeneration,
                  !current.terminalCompleted,current.waiter==nil else {
                continuation.resume(returning:currentTerminalResult(probeToken:probeToken,cycleGeneration:cycleGeneration))
                return
            }
            current.waiter={ result in continuation.resume(returning:result) }
            recentSafetyProbe=current
        }
    }
    @MainActor private func currentTerminalResult(probeToken:String,cycleGeneration:String)->RecentSafetyProbeTerminalResult {
        guard let probe=recentSafetyProbe,probe.probeToken==probeToken,probe.cycleGeneration==cycleGeneration else{return .cancelled_or_stale}
        return probe.terminalCompleted ? (probe.terminalResult ?? .cancelled_or_stale):.cancelled_or_stale
    }
    func installRecentSafetyProbeWaiterForTesting(probeToken:String,cycleGeneration:String,completion:@escaping (RecentSafetyProbeTerminalResult)->Void)->Bool {
        guard var probe=recentSafetyProbe,probe.probeToken==probeToken,probe.cycleGeneration==cycleGeneration,
              !probe.terminalCompleted,probe.waiter==nil else{return false}
        probe.waiter=completion
        recentSafetyProbe=probe
        return true
    }
    @discardableResult func cancelRecentSafetyProbe(probeToken:String,cycleGeneration:String)->Bool {
        completeRecentSafetyProbe(probeToken:probeToken,cycleGeneration:cycleGeneration,result:.cancelled_or_stale)
    }
    #if RECENT_SAFETY_PROBE_TESTING
    var recentSafetyProbeJavaScriptOverride: ((String,String) async throws -> Any?)?
    #endif
    @MainActor func executeRecentSafetyProbeJavaScript(_ script:String,token:String) async throws -> Any? {
        #if RECENT_SAFETY_PROBE_TESTING
        if let execute=recentSafetyProbeJavaScriptOverride {return try await execute(script,token)}
        #endif
        return try await web.callAsyncJavaScript(script,arguments:["token":token],in:nil,contentWorld:.page)
    }
    @MainActor func runRecentSafetyProbe(_ probeToken:String) async -> String {
        guard cycleDiscovering,cycleRootTriggerStarted,!cycleToken.isEmpty,
              probeToken.range(of:"^[A-Za-z0-9_-]{1,128}$",options:.regularExpression) != nil else {return "stale_or_mismatched_probe_token"}
        let generation=cycleToken
        if let existing=recentSafetyProbe,existing.cycleGeneration==generation {return "stale_or_mismatched_probe_token"}
        recentSafetyProbe=RecentSafetyProbeState(probeToken:probeToken,cycleGeneration:generation,events:["probe_js_invoked"])
        let script="const r=await window.gptRunRecentSafetyProbe?.(token); const allowed=['template_invalid','request_failed','http_429','http_non_2xx','parse_failed','response_dispatched']; return allowed.includes(r?.outcome) ? r.outcome : 'request_failed';"
        let value=(try? await executeRecentSafetyProbeJavaScript(script,token:probeToken)) as? String
        let allowed:Set<String>=["template_invalid","request_failed","http_429","http_non_2xx","parse_failed","response_dispatched"]
        let outcome=value.flatMap{allowed.contains($0) ? $0:nil} ?? "request_failed"
        guard cycleDiscovering,cycleToken==generation,recentSafetyProbe?.probeToken==probeToken else{return "stale_or_mismatched_probe_token"}
        recentSafetyProbe?.jsOutcome=outcome
        recentSafetyProbe?.events.append("probe_js_outcome:\(outcome)")
        if outcome != "response_dispatched" {_ = completeRecentSafetyProbe(probeToken:probeToken,cycleGeneration:generation,result:.js_terminal)}
        return outcome
    }
    var cycleOrigins=OriginLabelRegistry()
    var cyclePartitions:[PartitionDescriptor:PartitionObservation]=[:]
    var cycleCoverageReport=""
    var cycleGate=CycleGate()
    var cycleRunning: Bool {cycleGate.running}
    var cycleIds=Set<String>()
    var cyclePhase=""
    var cycleDiscovering=false
    var cycleListVersion=0
    var cycleRootStallDetail:String?
    var originalNormalDiscoveryFailureReason:String?
    var cycleRootLastPageRelativeMs:Int?
    var cycleRootLastPageOffset:Int?
    var cycleRootLastPageNewIdentities=0
    var cycleRootLastIdentityProgressRelativeMs:Int?
    var cycleRootLastIdentityProgressOffset:Int?
    var cycleRootAcceptedPageEvents:[[String:Any]]=[]
    var cycleValidListResponses=0
    var cycleRootResponseReceived=false
    var cycleDiscoverySource="network"
    var cycleDOMCandidateCount=0
    var cycleDOMAcceptedRowCount=0
    var cycleDOMRejectedNavigationRowCount=0
    var cycleDOMDuplicateRowCount=0
    var cycleDOMFallbackIds=Set<String>()
    var chatCheckTraceGeneration:String?
    let lastChatCheckTraceOutput=NSTextField(wrappingLabelWithString:"Last standard chat check trace: not recorded")
    let currentCycleSummaryOutput=NSTextField(wrappingLabelWithString:"Cycle summary: not checked")
    let perChatHistoryRawOutput=NSTextField(wrappingLabelWithString:"Per-chat history response details: not recorded")
    let conversationHistoryDiagnosticOutput=NSTextField(wrappingLabelWithString:"Current chat history source: not inspected")
    let persistedChatRecordDiagnosticOutput=NSTextField(wrappingLabelWithString:"Current chat persisted record: not inspected")
    let messageDOMStructureDiagnosticOutput=NSTextField(wrappingLabelWithString:"Current message DOM structure: not inspected")
    var rawDiagnosticsStack:NSStackView?
    var rawDiagnosticsToggleButton:NSButton?
    var rawDiagnosticsVisible=false
    var conversationHistoryDiagnosticGeneration:String?
    var conversationHistoryDiagnosticTask:Task<Void,Never>?
    let conversationHistoryDiagnosticTimeoutMs=9000
    var messageDOMStructureDiagnosticGeneration:String?
    var messageDOMStructureDiagnosticTask:Task<Void,Never>?
    var cycleRootRequests=0,cycleRootResponses=0,cycleRootRecognized=0,cycleRootResources=0,cycleRootResourceResponses=0
    var cycleRootResourceStatuses=Set<Int>()
    var cycleRootStatuses=Set<Int>()
    var cycleScriptSecret=""
    var cycleRootStageStarted=false
    var cycleRootPreflight:[String:Any]=[:]
    var cycleRootPostflight:[String:Any]=[:]
    var cycleRootHookHealth:[String:Any]=[:]
    var cycleRootDocumentSnapshots:[String:[String:Any]]=[:]
    var cycleRootTriggerStarted=false
    var cycleRootLoadReturnedNavigation=false
    var cycleRootTriggerFailed=false
    var cycleRootTriggerMethod="not_run"
    var cycleRootTriggerResult="not_run"
    var cycleRootTriggerStage="not_started"
    var cycleRootNavigation:WKNavigation?
    var cycleRootRouteBefore="unknown"
    var cycleRootRouteImmediatelyAfter="unknown"
    var cycleRootLatestRoute="unknown"
    var cycleRootLoadingImmediatelyAfter=false
    var cycleRootProgressImmediatelyAfter=0.0
    var cycleRootLatestLoading=false
    var cycleRootLatestProgress=0.0
    var cycleRootInitialProgress=0.0
    var cycleRootNavigationObserved=false
    var cycleRootDelegateEvents=[String]()
    var cycleRootTerminalReason="not_run"
    var cycleRootRepeatedFullPageNoProgress=false
    var cycleProjectIds=Set<String>()
    var cycleProjectStreams=Set<Int>()
    var cyclePageKeys=Set<String>()
    func recordRootRequestCorrelation(sequence:Int,stage:RootRequestCorrelationStage) {
        let payload:[String:Any] = ["sequence":sequence,"stage":stage.rawValue,"timestamp":Date().timeIntervalSince1970*1000,"transport":"unknown","method":"UNKNOWN"]
        guard let event=RootRequestCorrelationEvent.make(payload) else{return}
        if cycleState.lastRootRequestCorrelation==nil {cycleState.lastRootRequestCorrelation=RootRequestCorrelationState()}
        cycleState.lastRootRequestCorrelation?.append(event)
    }
    var cycleProjectPages=0
    var cyclePinnedResult:[String:Any]?
    var cycleActivity:[String:Any]?
    var pinnedActivityDiagnosticToken:String?
    var pinnedActivityLaunchStage="not_run"
    var pinnedActivityLaunchReason="none"
    var pinnedActivityLastLaunchRejection="none"
    var pinnedActivityLaunchAckTask:Task<Void,Never>?
    var pinnedActivityLaunchPending=false
    var pinnedActivityExpectedConversationID:String?
    var pinnedActivityTimeoutTask:Task<Void,Never>?
    var pinnedActivityStartedAt:Date?
    var pinnedActivityTotalBudgetMs=120_000
    var pinnedActivityTraversalBudgetMs=15_000
    let pinnedActivityCleanupReserveMs=10_000
    var pinnedActivityTraversalDeadline:Date?
    var pinnedActivityTraversalActive=false
    var pinnedActivityProcessedRows=0
    var pinnedActivityOrdinaryCount=0
    var pinnedActivityUnknownCount=0
    var pinnedActivityFirstOrdinaryFound=false
    var pinnedActivityAttemptedCount=0
    var pinnedActivityDispatchTimeoutTask:Task<Void,Never>?
    var pinnedActivityItemTimeoutTask:Task<Void,Never>?
    var pinnedActivityResolverTask:Task<Void,Never>?
    var pinnedActivityChildTerminalReason="none"
    var pinnedActivityStageTimeoutTask:Task<Void,Never>?
    var pinnedActivityMenuCleanupTimeoutTask:Task<Void,Never>?
    var pinnedActivityStage="not_run"
    var pinnedActivityLifecycleStages:[String]=[]
    var pinnedActivityLeaseStages:[String]=[]
    var pinnedActivityLeaseFailureReason="none"
    var pinnedActivityTimestampStage=PinnedTimestampState.notStarted.rawValue
    var pinnedActivityTimestampExpected=false
    var pinnedActivityTimestampDispatchStage="not_evaluated"
    var pinnedActivityTimestampDispatchReason="none"
    var pinnedActivityTimestampItemsCreated=0
    var pinnedActivityTimestampResolverInvoked=false
    var pinnedActivityTimestampResolverEntered=false
    var pinnedActivityTimestampItemStates:[String]=[]
    var pinnedActivityTimestampErrors=0
    var pinnedActivityTimestampTimeouts=0
    var pinnedActivityTimestampReason="none"
    var pinnedActivity429Observed=false
    var pinnedActivity429Family="unknown"
    var pinnedActivity429Owner="none"
    var pinnedActivity429Stage="none"
    var pinnedActivity429Relevant=false
    var pinnedActivityJSPromiseStatus="not_started"
    var pinnedActivitySwiftCompletion="not_started"
    var pinnedActivityCutoffTimestamp:Double=0
    var pinnedActivityRecords:[[String:Any]]=[]
    var pinnedActivityPinnedCount=0
    var pinnedActivityIndex=0
    var pinnedActivityResolved=0
    var pinnedActivityTimes:[Double]=[]
    var pinnedActivitySources:[String]=[]
    var pinnedActivityOrdinals:[Int]=[]
    var pinnedActivityExpectedOrdinal:Int?
    var pinnedActivityTimestampSubstage="not_started"
    var pinnedActivityTimestampProvenance:[String]=[]
    var pinnedActivityPassiveLookup="not_run"
    var pinnedActivityPassiveSummaries:[String]=[]
    var pinnedActivityPassiveMatchingRecords=0
    var pinnedActivityPassiveUpdateTimePresent=false
    var pinnedActivityFallbackStarted=false
    var pinnedActivityRouteLoaded=false
    var pinnedActivityNavigationCompleted=false
    var pinnedActivityActivityResponseSeen=false
    var pinnedActivityTimestampFieldSeen=false
    var pinnedActivityTimestampFieldType="unknown"
    var pinnedActivityFrontendRoute:String?
    var pinnedActivityNavigationTemplate="unknown"
    var pinnedActivityNavigationStage="not_started"
    var pinnedActivityNavigationOperationToken:String?
    var pinnedActivityNavigation:WKNavigation?
    var pinnedActivityNavigationCommandSent=false
    var pinnedActivityNavigationCommandAccepted=false
    var pinnedActivityProvisionalStarted=false
    var pinnedActivityNavigationCommitted=false
    var pinnedActivityNavigationFinished=false
    var pinnedActivityRouteConfirmed=false
    var pinnedActivityNavigationError="none"
    var pinnedActivityNavigationURLObservation:NSKeyValueObservation?
    var pinnedActivityNavigationObservationTask:Task<Void,Never>?
    var pinnedActivityNavigationSnapshotSummary="not_run"
    var pinnedActivityNavigationSnapshotCount=0
    var pinnedActivityCurrentRouteBefore="unknown"
    var pinnedActivityTargetDiffersFromCurrent=false
    var pinnedActivityNavigationObjectReturned=false
    var pinnedActivityNavigationDelegateExists=false
    var pinnedActivityNavigationDelegateCorrect=false
    var pinnedActivityNavigationURLChanged=false
    var pinnedActivityNavigationTargetURLObserved=false
    var pinnedActivityNavigationProgressChanged=false
    var pinnedActivityNavigationInitialProgress=0.0
    var pinnedActivityNavigationStartedAt:Date?
    var pinnedActivityNavigationDiagnosticReason="none"
    var pinnedSidebarNavigationContinuation:CheckedContinuation<Bool,Never>?
    var pinnedSidebarNavigationTimeoutTask:Task<Void,Never>?
    var pinnedSidebarNavigationDispatchTimeoutTask:Task<Void,Never>?
    var pinnedSidebarNavigationAckTimeoutTask:Task<Void,Never>?
    var pinnedSidebarRowLookupTimeoutTask:Task<Void,Never>?
    var pinnedSidebarRouteWaitTimeoutTask:Task<Void,Never>?
    var pinnedSidebarNavigationToken:String?
    var pinnedActivityAutomationBridgePresent=false
    var pinnedActivitySidebarHandlerPresent=false
    var pinnedActivitySidebarDispatchPrimitive="not_run"
    var pinnedActivitySidebarCommandAckState="not_started"
    var pinnedActivitySidebarAnchorScanComplete=false
    var pinnedActivitySidebarTotalAnchors=0
    var pinnedActivitySidebarConversationAnchors=0
    var pinnedActivitySidebarMatchingAnchors=0
    var pinnedActivitySidebarRowLookupTerminal=false
    var pinnedActivitySidebarLookupErrorCategory="none"
    var pinnedActivitySidebarActivationMethod="not_run"
    var pinnedActivitySidebarAnchorFound=false
    var pinnedActivitySidebarHrefMatchesExpected=false
    var pinnedActivitySidebarTargetAttributePresent=false
    var pinnedActivitySidebarDownloadAttributePresent=false
    var pinnedActivitySidebarAnchorClickInvoked=false
    var pinnedActivitySidebarRouteChangedImmediately="unknown"
    var pinnedActivitySidebarRouteChangedDuringWait=false
    var pinnedActivityNavigationMethod="not_run"
    var pinnedActivitySidebarRowReresolved=false
    var pinnedActivitySidebarCommandReceived=false
    var pinnedActivitySidebarScrollRequired=false
    var pinnedActivitySidebarRowVisible="unknown"
    var pinnedActivitySidebarClickDelivered=false
    var pinnedActivitySidebarClickDefaultPrevented:String="unknown"
    var pinnedActivitySidebarRouteAfter="not_run"
    var pinnedActivityNavigationCleanup="not_attempted"
    var pinnedActivityNavigationOriginURL:URL?
    var pinnedActivityPreNavigationStage="not_started"
    var pinnedActivityPreNavigationReason="none"
    var pinnedActivityPreNavigationStages:[String]=[]
    var pinnedActivityWebViewAvailable=false
    var pinnedActivityWebViewAttached=false
    var pinnedActivityRenderLeaseVerified=false
    var pinnedActivityMainActorEntered=false
    var pinnedActivityLateNavigationReason="none"
    var pinnedActivityPendingResponse:[String:Any]?
    var pinnedActivityResponseBufferedBeforeRoute=false
    var pinnedActivityWaiterArmed=false
    var pinnedActivityWaiterWasArmedBeforeLoad=false
    var pinnedActivityWaiterToken:String?
    var pinnedActivityWaiterConversationID:String?
    var pinnedActivityWaiterOrdinal:Int?
    var pinnedActivityUnrelatedActivityEvents=0
    var pinnedActivityBufferHit=false
    var pinnedActivityLiveWaitStarted=false
    var pinnedActivityLiveWaitState="not_started"
    var pinnedActivityLiveWaitStartedAt:Date?
    var pinnedActivityLiveWaitDurationMs="not_run"
    var pinnedActivityLiveWaitResult:PinnedActivityWaitResult?
    var pinnedActivityLiveWaitContinuation:CheckedContinuation<PinnedActivityWaitResult,Never>?
    var pinnedActivityLiveWaitTimeoutTask:Task<Void,Never>?
    var pinnedActivityLiveWaitDeadlineActive=false
    var pinnedActivityLiveWaitDeadlineElapsed=false
    var pinnedActivityGenericTimeoutActivityState="not_started"
    var pinnedActivityGenericTimeoutDeadlineActive=false
    var pinnedActivityGenericTimeoutDeadlineElapsed=false
    var pinnedActivityActivityEndpointFamily="unknown"
    var pinnedActivityBackendObservationActive=false
    var pinnedActivityObservationWindow:ActivityObservationWindow?
    var pinnedActivityObservationWindowStarted=false
    var pinnedActivityJSObserverArmCallExecuted=false
    var pinnedActivityObservedResponseSequences:Set<Int>=[]
    var pinnedActivityBackendResponsesObserved=0
    var pinnedActivityBackendConversationRelated=0
    var pinnedActivityBackendExpectedMatches=0
    var pinnedActivityBackendTimestampFieldMatches=0
    var pinnedActivityBackendTimestampBearingMatches=0
    var pinnedActivityBackendItemExpectedMatches=0
    var pinnedActivityBackendItemTimestampFieldMatches=0
    var pinnedActivityBackendItemTimestampBearingMatches=0
    var pinnedActivityBackendFamilies:[String:Int]=[:]
    var pinnedActivityBackendResponseSummaries:[String]=[]
    var pinnedActivityCacheRecheck="not used"
    var pinnedActivityNavigationMenuCleanup="unknown"
    var pinnedActivityRenderLeaseCleanup="unknown"
    var pinnedActivityOverallCleanup="unknown"
    var backgroundRenderLeaseRestoreDetails="not attempted"
    var pinnedActivityReadiness="not_run"
    var pinnedActivityPreflightSummary="not_run"
    var pinnedActivityRowsAtFirstDetection=0
    var pinnedActivityRowsAtStabilizedSnapshot=0
    var pinnedActivityFirstPositiveCount=0
    var pinnedActivityConversationSignatureChanges=0
    var pinnedActivityMutationChecks=0
    var pinnedActivityUnrelatedMutationChecks=0
    var pinnedActivityStableCount=0
    var pinnedActivityFinalSnapshotCount=0
    var pinnedActivityTimeToFirstPositiveMs="unknown"
    var pinnedActivityTimeToStableMs="unknown"
    var pinnedActivityTerminalReason="not_run"
    var pinnedActivityPrimaryFailureReason="none"
    var pinnedActivityCleanupFailureReason="none"
    var pinnedActivityPrefixSnapshotCount=0
    var pinnedActivityInitialSnapshotCount=0
    var pinnedActivityFinalPrefixSnapshotCount=0
    var pinnedActivitySnapshotExpansionCount=0
    var pinnedActivityFirstNotPinnedFound=false
    var pinnedActivitySequence="not recorded"
    var pinnedActivityPrefixReason="not_run"
    var pinnedActivityDOMCounts="not recorded"
    var pinnedActivityScrollOwnerSummary="not sampled"
    var pinnedActivityScrollAttemptsSummary="none"
    var pinnedActivityTop="unproven"
    var pinnedActivityTopReason="not_run"
    var pinnedActivityPrefix="not_run"
    var pinnedActivityReason="not_run"
    var pinnedActivityRowsInspected=0
    var pinnedActivityCleanup="unknown"
    var cyclePinnedReport=""
    var cycleDiscoveryDeadline=Date.distantFuture
    var cycleStarredTriggerStatus="not attempted"
    var cycleCutoffTimestamp: Double=0
    var cyclePinnedNavigation:WKNavigation?
    var cyclePinnedNavigationFinished=false
    var cyclePinnedNavigationError:Error?
    var automationToken=""
    var automationUpdate: AutomationUpdate?
    var chatCheckTerminalUpdate:AutomationUpdate?
    var activeChatCheckWorkers=Set<String>()
    var navigationFinished=false
    var chatCheckNavigation:WKNavigation?
    var chatCheckExpectedConversationID:String?
    var continuationSourcePreview:ContinuationSourcePreview?
    var continuationPreviewWindow:NSWindow?
    var continuationPreviewTitleLabel:NSTextField?
    var continuationPreviewRiskLabel:NSTextField?
    var continuationPreviewStatusLabel:NSTextField?
    var continuationPreviewMetadataLabel:NSTextField?
    var continuationPreviewNeutralLabel:NSTextField?
    var continuationPreviewFeedbackLabel:NSTextField?
    var continuationHandoffTextView:NSTextView?
    var continuationCopyButton:NSButton?
    var continuationOpenButton:NSButton?
    var continuationPrepareTagToConversationID=[Int:String]()
    var nextContinuationPrepareTag=5100
    var chatCheckTelemetry:ChatCheckStageTelemetry?
    var chatCheckBudgetController:ChatCheckBudgetController?
    var chatCheckLastCheckpointAt:Date?
    var chatCheckReports=[String]()
    var cycleChatTerminalResults=[String]()
    var chatCheckReportSnapshots:[String:ChatCheckReportSnapshot]=[:]
    var cycleCurrentChatCheckOrdinal=0
    var cycleFreshRiskCounts:[String:Int]=["Normal":0,"Watch":0,"Near":0,"Critical":0,"Unknown":0]
    var cycleProvenanceBefore="not_recorded"
    var listDiagnosticMode=""
    var listDiagnosticGenerationGate=DiagnosticOperationGenerationGate()
    var listDiagnosticTask: Task<Void,Never>?
    var listDiagnosticRequests=0
    var listDiagnosticRequestIDs=Set<Int>()
    var listDiagnosticResponses=0
    var listDiagnosticFailures=0
    var listDiagnosticRecognized=false
    var listDiagnosticResourceObserved=false
    var listDiagnosticResourceCompleted=false
    var listDiagnosticResourceInitiator="Unknown"
    var listDiagnosticResourceStart:Int?
    var listDiagnosticResourceStatus:Int?
    var listDiagnosticStatusCodes:[Int]=[]
    var listDiagnosticLastTransport="Unknown"
    var listDiagnosticLastMethod="Unknown"
    var listDiagnosticLastPath="Unknown"
    var listDiagnosticLastStatus:Int?
    var listDiagnosticKeys:[String]=[]
    var listDiagnosticFieldTypes=""
    var listDiagnosticItemsType="Unknown"
    var listDiagnosticItemCount:Int?
    var listDiagnosticPage="Unknown"
    var listDiagnosticViewport="Unknown"
    var listDiagnosticSidebar="Unknown"
    var listDiagnosticFetchHookActive="Unknown"
    var listDiagnosticXHRHookActive="Unknown"
    var listDiagnosticHookAssignments="Unknown"
    var listDiagnosticBackendResources:[String]=[]
    var listDiagnosticTimestamp=""
    var listDiagnosticTrafficLines=[String]()
    var pinDiagnosticRunID:UUID?
    var pinDiagnosticTimeoutTask:Task<Void,Never>?
    var pinDiagnosticRows:[Int:String]=[:]
    var pinDiagnosticRowsAttempted=0
    var pinDiagnosticRowsCompleted=0
    var pinDiagnosticCurrentRow:Int?
    var pinDiagnosticStage="starting"
    var pinDiagnosticMenuLeftOpen:Bool?
    var sidebarScrollDiagnosticStartedAt:Date?
    var sidebarScrollReadinessTimeoutTask:Task<Void,Never>?
    var sidebarScrollReadinessStartedAt:Date?
    var sidebarScrollReadinessStartUptime:UInt64=0
    var sidebarScrollReadinessPollCount=0
    var sidebarScrollReadinessFirstPollMs:Int?
    var sidebarScrollReadinessLastPollMs:Int?
    var sidebarScrollReadinessFirstPositiveCount=0
    var sidebarScrollReadinessFirstPositiveUptime:UInt64?
    var sidebarScrollReadinessStablePolls=0
    var sidebarScrollReadinessLastChangeUptime:UInt64=0
    var sidebarScrollReadinessLastSemanticChangeUptime:UInt64?
    var sidebarScrollReadinessHadSemanticChange=false
    var sidebarScrollReadinessGraceActivated=false
    var sidebarScrollReadinessGraceDeadlineUptime:UInt64?
    let sidebarScrollReadinessPhaseABudgetNs:UInt64=4_000_000_000
    let sidebarScrollReadinessGraceBudgetNs:UInt64=1_200_000_000
    let sidebarScrollReadinessAbsoluteBudgetNs:UInt64=6_000_000_000
    var sidebarScrollReadinessLastSample:[String:Any]=[:]
    var sidebarScrollReadinessPreviousSample:[String:Any]?
    var sidebarScrollReadinessSamples:[[String:Any]]=[]
    var sidebarScrollReadinessLastComparison="not_started"
    var sidebarScrollReadinessScheduledCount=0
    var sidebarScrollReadinessStartedCount=0
    var sidebarScrollReadinessEvaluateCalledCount=0
    var sidebarScrollReadinessCallbackCount=0
    var sidebarScrollReadinessParsedCount=0
    var sidebarScrollReadinessLastCompletedPollIndex=0
    var sidebarScrollReadinessCurrentPollIndex:Int?
    var sidebarScrollReadinessCurrentEvaluateUptime:UInt64=0
    var sidebarScrollReadinessInFlight=false
    var sidebarScrollReadinessMaxCallbackLatencyMs=0
    var sidebarScrollReadinessTimeline=[String]()
    var sidebarScrollReadinessLastEventUptime:UInt64=0
    var sidebarScrollReadinessLastEventName="native_readiness_started"
    var sidebarScrollReadinessMaxEventGapMs=0
    var sidebarScrollReadinessMaxEventGapFrom="none"
    var sidebarScrollReadinessMaxEventGapTo="none"
    var sidebarScrollDiagnosticNativeGuardFired=false
    var sidebarScrollDiagnosticLastStage="not_started"
    var sidebarScrollDiagnosticStageEvents:[String]=[]
    var sidebarScrollDiagnosticPartial="no_result"
    var renderDiagnosticToken:String?
    var renderDiagnosticTimeoutTask:Task<Void,Never>?
    var renderDiagnosticRestore:(()->Bool)?
    var renderDiagnosticHiddenSummary="not_run"
    var renderDiagnosticHiddenWindowSummary="not_run"
    var renderDiagnosticHiddenDOM:[String:Int]=[:]
    var liveResumeDiagnosticGeneration:String?
    var liveResumeDiagnosticTimeoutTask:Task<Void,Never>?
    var liveResumeDiagnosticOutput=NSTextField(wrappingLabelWithString:"Same-document resume proof: not run")
    var liveResumeDiagnosticCancelButton:NSButton?
    struct BackgroundRenderLeaseState {
        let owner:String
        let original:RenderSurfaceControlState
        let windowFrame:NSRect
        let webViewFrame:NSRect
        let windowLevel:NSWindow.Level
        let windowAboveNumber:Int?
        let windowBelowNumber:Int?
        let firstResponder:WeakResponderReference
    }
    struct BackgroundFocusSnapshot {
        let frontmostPID:Int32?
        let frontmostCategory:String
        let appActive:Bool
        let appKeyWindow:Bool
        let appMainWindow:Bool
        let sessionVisible:Bool
        let sessionKey:Bool
        let sessionMain:Bool
        let sessionOrderIndex:Int?
        let sessionLevel:Int
    }
    var backgroundFocusCycleBaseline:BackgroundFocusSnapshot?
    var backgroundFocusCycleSamples:[String]=[]
    var backgroundFocusCycleSawGPTFrontmost=false
    var backgroundFocusCycleFrontmostPreserved="unknown"
    var backgroundFocusCycleActivationUnchanged="unknown"
    var backgroundFocusCycleKeyMainPreserved="unknown"
    var backgroundFocusCycleWindowOrderingPreserved="unknown"
    var globalWindowOrderMonitor:DispatchSourceTimer?
    var globalWindowOrderSampleCount=0
    var globalWindowOrderViolationCount=0
    var globalWindowOrderBaselinePID:Int32?
    var globalWindowOrderCheckpointSamples:[String]=[]
    var globalWindowOrderViolationSamples:[String]=[]
    var globalWindowOrderLastSample="not sampled"
    var globalWindowOrderSummary="not sampled"
    var backgroundRenderLease:BackgroundRenderLeaseState?
    var backgroundRenderLeaseGate=BackgroundRenderLeaseGate()
    var backgroundRenderLeaseOwner:String? { backgroundRenderLease?.owner }
    var backgroundRenderLeaseReport="not acquired"
    var backgroundRenderLeaseFocusSnapshotCaptured=false
    var backgroundRenderLeaseWindowOrderingRestored="unknown"
    var backgroundRenderLeaseKeyMainRestored="unknown"
    var backgroundRenderLeaseApplicationActivationRestored="unknown"
    var backgroundRenderLeaseOwnershipReleased="unknown"
    var backgroundRenderLeaseActivatedAt:Date?
    var backgroundRenderLeaseTimeToFirstConversationLinkMs:Int?
    var backgroundRenderLeaseReadiness:[String:Any]=[:]
    var visibleSessionPaintWatchGeneration:String?
    var visibleSessionPaintSyncGeneration:String?
    var sessionLayoutEvidence:[[String:Any]]=[]
    let sessionLayoutOutput=NSTextField(wrappingLabelWithString:"Conversation viewport investigation: not sampled")
    var renderLeaseReadinessOwner:String?
    var renderLeaseReadinessContinuation:CheckedContinuation<[String:Any],Error>?
    var renderLeaseReadinessTimeout:DispatchWorkItem?
    // App version and injected diagnostic compatibility version are tracked separately.
let gptLimitsAppVersion="6.2.3"
let pinnedDiagnosticVersion="6.1.0"
    let runtimeIdentityOutput=NSTextField(wrappingLabelWithString: "Runtime identity unavailable")
    let mainWindowLifecycleOutput=NSTextField(wrappingLabelWithString:"Main window lifecycle A/B/C: not sampled")
    var mainWindowLifecycleSnapshots=[String]()
    weak var mainWindowLifecycleBaselineWindow:NSWindow?
    weak var mainWindowLifecycleBaselineContentView:NSView?
    weak var mainWindowLifecycleBaselineRootView:NSView?
    weak var mainWindowLifecycleBaselineRootLayer:CALayer?
    var mainWindowLifecycleBaselineRootSubviewIDs:[ObjectIdentifier]?
    let windowOrderingProbeOutput=NSTextField(wrappingLabelWithString:"Window ordering probe: not run")
    var windowOrderingProbeTimer:DispatchSourceTimer?
    var windowOrderingProbeSamples=[String]()
    var windowOrderingProbeDeadline:Date?
    let starredDiagnosticOutput=NSTextField(wrappingLabelWithString: "Starred UI diagnostic: not run")
    let pinnedUnknownRowsRawOutput=NSTextField(wrappingLabelWithString:"Pinned proof unknown rows: not recorded")
    let lastIsolatedDiagnosticOutput=NSTextField(wrappingLabelWithString: "Last isolated diagnostic: not run")
    let lastSidebarDiagnosticOutput=NSTextField(wrappingLabelWithString:"Last sidebar diagnostic: not run")
    let sidebarElementStructureOutput=NSTextField(wrappingLabelWithString:"Last sidebar element structure: not run")
    var lastSidebarDiagnosticSummary:SidebarDiagnosticSummary?
    var sidebarDiagnosticStartedAt:Date?
    var sidebarDiagnosticLastStage="not_run"
    var sidebarDiagnosticLastElapsedMs=0
    var sidebarDiagnosticExceptionCategory="none"
    var latestIsolatedDiagnosticText="Last isolated diagnostic: not run"
    let cycleOutput=NSTextField(wrappingLabelWithString: "Automatic checks: Off")
    let riskOutput=NSTextField(wrappingLabelWithString: "Risk model: Beta baseline")
    var cycleRiskNotificationsGenerated=0
    var cycleRiskNotificationsSuppressed=0
    var riskNotificationsAuthorized=false
    var lastNotificationPermissionRequest="requested=no · granted=unknown · error=none · resulting authorization=not checked"
    var statusItem: NSStatusItem!
    var warningOpenMenuItem:NSMenuItem?
    var warningSummaryMenuItem:NSMenuItem?
    var warningAcknowledgeTagToConversationID=[Int:String]()
    var nextWarningAcknowledgeTag=4100
    var panel: NSWindow!
    var diagnosticsScrollView:NSScrollView?
    var diagnosticsDocumentView:NSView?
    var diagnosticsStack:NSStackView?
    var diagnosticsTextObservers:[NSKeyValueObservation]=[]
    var diagnosticsScrollObserver:NSObjectProtocol?
    var diagnosticsLayoutTelemetry="not measured"
    var mainWindow: NSWindow!
    var settingsWindow: NSWindow!
    var mainMonitoringLabel:NSTextField!
    var mainLastCheckLabel:NSTextField!
    var mainNextCheckLabel:NSTextField!
    var mainCoverageLabel:NSTextField!
    var mainRiskModelLabel:NSTextField!
    var mainRecentResultLabel:NSTextField!
    var mainRecentResultHeading:NSTextField!
    var mainUILayoutSnapshotOutput:NSTextField!
    var mainUILayoutRefreshCount=0
    var mainUILayoutSnapshots=[String]()
    var mainRescueStatusLabel:NSTextField!
    var mainRiskList:NSStackView!
    var mainRiskRows:NSStackView!
    var mainUncertaintySection:NSStackView!
    var mainUncertaintyRows:NSStackView!
    var mainUncertaintySummary:NSTextField!
    var mainUncertaintyExpandButton:NSButton!
    var mainUncertaintyDismissAllButton:NSButton!
    var mainDismissedUncertaintyButton:NSButton!
    var mainRiskScrollView:NSScrollView!
    var mainUncertaintyExpanded=false
    var mainDismissedUncertaintyExpanded=false
    var mainCheckNowButton:NSButton!
    var mainRescueButton:NSButton!
    var settingsNotificationTitles:NSButton!
    var settingsNotificationStatus:NSTextField!
    var settingsAutomaticChecks:NSButton!
    var diagnosticsButton:NSButton!
    var session: NSWindow!
    var web: WKWebView!
    var visibleSessionPresentationPending=false
    var visibleSessionPresentationReport="not requested"
    weak var pendingForegroundWindow:NSWindow?
    var pendingForegroundCallSite=""
    var pendingForegroundValidation:(()->Bool)?
    var pendingForegroundCompletion:(()->Void)?
    var backgroundPresentationTrace=[String]()
    var backgroundActivationObservers:[NSObjectProtocol]=[]
    let route = NSTextField(string: "")
    let output = NSTextField(wrappingLabelWithString: "Open ChatGPT session and sign in manually. Session persistence is not yet verified.")
    let listOutput = NSTextField(wrappingLabelWithString: "List response: waiting")
    let listDiagnosticOutput = NSTextField(wrappingLabelWithString: "List network diagnostics: not run")
    let notificationOutput = NSTextField(wrappingLabelWithString: "Native notification: not tested")
    let notificationIdentityOutput = NSTextField(wrappingLabelWithString: "Notification identity: not checked")
    let nativeRescueOutput = NSTextField(wrappingLabelWithString: "Native Rescue: ready when a ChatGPT conversation is open")
    var nativeRescueOperationID:String?
    var nativeRescueGeneration:UUID?
    var nativeRescueOwnershipGate=RescueOperationGenerationGate()
    var nativeRescueStages=[String]()
    var nativeRescueLaunchReason="none"
    var nativeRescueHTML:String?
    var nativeRescueText:String?
    var nativeRescueProgressPanel:NSPanel?
    var nativeRescueProgressLabel:NSTextField?
    var nativeRescueProgress:NSProgressIndicator?
    var nativeRescueCancelButton:NSButton?
    var nativeRescueCount=0
    var nativeRescueState="idle"
    var nativeRescueStartupTimeoutTask:Task<Void,Never>?
    var discovered: [String: [String: Any]] = [:]
    var authWindows: [NSWindow] = []
    var bundleIdentityMigrationStatus="not needed"

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        return true
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        bundleIdentityMigrationStatus=migrateBundleIdentityDefaultsAtStartup()
        UserDefaults.standard.register(defaults:[showChatTitlesInNotificationsDefaultsKey:true])
        installBackgroundActivationTraceObservers()
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem.button?.title = "GL"
        let menu = NSMenu()
        warningOpenMenuItem=NSMenuItem(title:"Open GPT Limits Tool",action:#selector(showMainWindow),keyEquivalent:"")
        warningOpenMenuItem?.target=self
        menu.addItem(warningOpenMenuItem!)
        warningSummaryMenuItem=NSMenuItem(title:"No active warnings",action:nil,keyEquivalent:"")
        warningSummaryMenuItem?.isEnabled=false
        menu.addItem(warningSummaryMenuItem!)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Settings…", action: #selector(showSettings), keyEquivalent: ",").target=self
        menu.addItem(withTitle: "Diagnostics…", action: #selector(showPanel), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Open ChatGPT session", action: #selector(showSession), keyEquivalent: "").target = self
        menu.addItem(withTitle: "Quit", action: #selector(quit), keyEquivalent: "q").target = self
        statusItem.menu = menu
    let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(self, name: "summary")
        config.userContentController.add(self, name: "list")
        config.userContentController.add(self, name: "diagnostics")
        config.userContentController.add(self, name: "automation")
        config.userContentController.add(self, name: "starredDiagnostic")
        config.userContentController.add(self, name: "activity")
        config.userContentController.add(self, name: "backendTraffic")
        config.userContentController.add(self, name: "chatCheck")
        config.userContentController.add(self, name: "conversationHistoryDiagnostic")
        config.userContentController.add(self, name: "messageDOMStructureDiagnostic")
        config.userContentController.add(self, name: "liveResumeDiagnostic")
        config.userContentController.add(self, name: "sidebarNavigation")
        config.userContentController.add(self, name: "nativeRescue")
        do {
            let resources = Bundle.main.resourceURL!
            var scripts = ""
            for name in ["aggregator.js", "history-collector.js", "rescue.js", "native-rescue-bridge.js", "automation-bridge.js", "conversation-history-diagnostic.js", "bridge.js", "page-hook.js", "conversation-list.js", "list-hook.js", "activity-hook.js"] {
                var source=try String(contentsOf: resources.appendingPathComponent(name), encoding: .utf8)
                source=source.replacingOccurrences(of:"__PINNED_DIAGNOSTIC_VERSION__",with:pinnedDiagnosticVersion)
                scripts += source + "\n;\n"
            }
            // Page world is necessary to wrap the page's own fetch/XHR before its scripts run.
            let guarded = "if (location.origin === 'https://chatgpt.com') {\n" + scripts + "\n}"
            runtimeScripts=guarded
            let runtimeUserScript=WKUserScript(source:guarded,injectionTime:.atDocumentStart,forMainFrameOnly:true)
            self.runtimeUserScript=runtimeUserScript
            config.userContentController.addUserScript(runtimeUserScript)
        } catch { output.stringValue = "Missing prototype runtime resources" }
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1100, height: 760), configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        session = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        session.title = "GPT Limits Tool — ChatGPT session"
        session.isReleasedWhenClosed = false
        session.contentView = web
        web.autoresizingMask=[.width,.height]
        web.frame=session.contentView?.bounds ?? web.frame
        panel = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 820), styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        panel.title = "GPT Limits Tool — Diagnostics"
        panel.acceptsMouseMovedEvents=true
        panel.ignoresMouseEvents=false
        panel.isReleasedWhenClosed = false
        route.placeholderString = "https://chatgpt.com/c/<conversation-id>"
        let riskNotificationTitlesCheckbox=NSButton(checkboxWithTitle:"Show chat titles in notifications",target:self,action:#selector(toggleRiskNotificationTitles(_:)))
        riskNotificationTitlesCheckbox.state=showChatTitlesInNotifications(storedValue:UserDefaults.standard.object(forKey:showChatTitlesInNotificationsDefaultsKey) as? Bool) ? .on:.off
        let stack=DiagnosticsStackView();stack.orientation = .vertical;stack.alignment = .leading;stack.spacing=18
        stack.translatesAutoresizingMaskIntoConstraints=false
        func group(_ title:String,_ views:[NSView])->NSStackView {
            let section=DiagnosticsStackView();section.orientation = .vertical;section.alignment = .leading;section.spacing=8
            section.addArrangedSubview(uiLabel(title,size:15,bold:true))
            for view in views {
                if let label=view as? NSTextField {label.widthAnchor.constraint(lessThanOrEqualToConstant:680).isActive=true}
                section.addArrangedSubview(view)
            }
            return section
        }
        let rawStack=DiagnosticsStackView();rawStack.orientation = .vertical;rawStack.alignment = .leading;rawStack.spacing=18
        rawStack.translatesAutoresizingMaskIntoConstraints=false
        rawStack.addArrangedSubview(uiLabel("Raw diagnostics",size:15,bold:true))
        rawStack.addArrangedSubview(group("Session and chat checks",[route,button("Inspect current chat persisted record",#selector(inspectCurrentChatPersistedRecord)),persistedChatRecordDiagnosticOutput,button("Open ChatGPT session",#selector(showSession)),button("Check chat (hidden WebView)",#selector(check)),button("Hide session",#selector(hideSession)),output,nativeRescueOutput,perChatHistoryRawOutput]))
        rawStack.addArrangedSubview(group("Notifications and identity",[button("Send test notification",#selector(testNotification)),riskNotificationTitlesCheckbox,notificationOutput,notificationIdentityOutput]))
        rawStack.addArrangedSubview(group("Recent chats",[button("Refresh recent chats",#selector(refreshRecent)),button("Check first recent chat",#selector(checkFirstRecent)),listOutput]))
        rawStack.addArrangedSubview(group("Discovery diagnostics",[button("Diagnose visible home",#selector(diagnoseVisibleHome)),button("Diagnose hidden home",#selector(diagnoseHiddenHome)),button("Inspect sidebar route templates",#selector(diagnoseSidebarRoutes)),button("Inspect sidebar top position",#selector(diagnoseSidebarTopPosition)),button("Inspect sidebar scroll mechanics",#selector(inspectSidebarScrollMechanics)),button("Diagnose root sidebar scrolling",#selector(diagnoseRootSidebarScroll)),button("Inspect pinned rows at sidebar top",#selector(diagnoseVisiblePinnedRows)),lastSidebarDiagnosticOutput]))
        mainUILayoutSnapshotOutput=uiLabel("Main content layout: not sampled")
        rawStack.addArrangedSubview(group("Runtime and pinned coverage",[runtimeIdentityOutput,mainWindowLifecycleOutput,mainUILayoutSnapshotOutput,button("Inspect standard window ordering",#selector(startWindowOrderingProbe)),windowOrderingProbeOutput,button("Inspect visible session rendering",#selector(inspectVisibleSessionRendering)),button("Inspect hidden WebView rendering",#selector(inspectHiddenWebViewRendering)),button("Inspect pinned prefix + activity",#selector(diagnosePinnedActivityTimestamp)),lastIsolatedDiagnosticOutput,starredDiagnosticOutput,pinnedUnknownRowsRawOutput]))
        rawStack.addArrangedSubview(group("Conversation viewport investigation",[button("Capture conversation layout",#selector(captureConversationLayoutNow)),sessionLayoutOutput]))
        let resumeCancel=button("Cancel same-document resume proof",#selector(cancelLiveDocumentResumeProof))
        resumeCancel.isEnabled=false;liveResumeDiagnosticCancelButton=resumeCancel
        rawStack.addArrangedSubview(group("P0 same-document resume proof",[button("Run two-pass live-document proof",#selector(startLiveDocumentResumeProof)),resumeCancel,liveResumeDiagnosticOutput]))
        rawStack.addArrangedSubview(group("Scheduler",[button("Automatic checks: On / Off",#selector(toggleAutomatic)),button("Run cycle now",#selector(runCycle)),cycleOutput,lastChatCheckTraceOutput,riskOutput]))
        rawStack.addArrangedSubview(group("Personal calibration",[button("Use latest complete chat as Normal sample",#selector(markLatestNormalCalibration)),button("Use latest complete chat as Limit reached sample",#selector(markLatestLimitCalibration)),button("Clear latest calibration sample",#selector(clearLatestCalibration))]))
        stack.addArrangedSubview(group("Current cycle summary",[currentCycleSummaryOutput]))
        let rawToggle=button("Show raw diagnostics",#selector(toggleRawDiagnostics));rawDiagnosticsToggleButton=rawToggle
        rawStack.isHidden = !rawDiagnosticsVisible;rawDiagnosticsStack=rawStack
        stack.addArrangedSubview(rawToggle);stack.addArrangedSubview(rawStack)
        let scroll=NSScrollView(frame:panel.contentView!.bounds);scroll.autoresizingMask=[.width,.height];scroll.hasVerticalScroller=true;scroll.autohidesScrollers=true
        let document=DiagnosticsDocumentView(frame:NSRect(x:0,y:0,width:scroll.contentView.bounds.width,height:panel.contentView!.bounds.height))
        document.autoresizingMask=[]
        document.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo:document.leadingAnchor,constant:20),stack.trailingAnchor.constraint(equalTo:document.trailingAnchor,constant:-20),stack.topAnchor.constraint(equalTo:document.topAnchor,constant:20)])
        stack.setContentHuggingPriority(.defaultHigh,for:.vertical)
        stack.setContentCompressionResistancePriority(.required,for:.vertical)
        panel.contentView?.layoutSubtreeIfNeeded()
        scroll.documentView=document;panel.contentView?.addSubview(scroll)
        diagnosticsScrollView=scroll;diagnosticsDocumentView=document;diagnosticsStack=stack
        scroll.contentView.postsBoundsChangedNotifications=true
        diagnosticsScrollObserver=NotificationCenter.default.addObserver(forName:NSView.boundsDidChangeNotification,object:scroll.contentView,queue:.main) { [weak self] _ in
            self?.updateDiagnosticsGeometryTelemetry()
        }
        diagnosticsTextObservers=diagnosticTextFields(in:document).map { field in
            field.observe(\.stringValue,options:[.new]) { [weak self] _,_ in
                DispatchQueue.main.async { self?.layoutDiagnosticsDocument() }
            }
        }
        panel.delegate=self
        layoutDiagnosticsDocument()
        scroll.verticalScroller?.doubleValue=0
        scroll.reflectScrolledClipView(scroll.contentView)
        panel.minSize=NSSize(width:640,height:520)
        buildUserWindows()
        restoreCycle()
        UNUserNotificationCenter.current().delegate=self
        updateRuntimeIdentity()
        panel.center(); session.center(); mainWindow.center()
        web.load(URLRequest(url: URL(string: "https://chatgpt.com/")!))
    }
    func button(_ title: String, _ action: Selector) -> NSButton { NSButton(title: title, target: self, action: action) }
    func diagnosticTextFields(in root:NSView)->[NSTextField] {
        var result:[NSTextField]=[]
        for view in root.subviews {
            if let field=view as? NSTextField {result.append(field)}
            result.append(contentsOf:diagnosticTextFields(in:view))
        }
        return result
    }
    func updateCurrentCycleSummary() {
        func line(_ prefix:String)->String {
            cycleState.lastStatus.components(separatedBy:"\n").first(where:{$0.hasPrefix(prefix)}) ?? "\(prefix) not recorded"
        }
        let checkedLine=line("Checked:")
        let maintenancePresentation=formatMaintenanceDiagnostics(lastStatus:cycleState.lastStatus,chatCheckReports:chatCheckReports)
        let latest=cycleState.records.values.filter{$0.lastCheckAt != nil}.max{($0.lastCheckAt ?? 0)<($1.lastCheckAt ?? 0)}
        let result=latest?.lastCheckResult ?? "Not checked"
        let readiness=cycleState.lastRenderReadiness.map(renderReadinessDiagnosticSummary) ?? "not recorded"
        let stages=cycleState.lastChatCheckTrace?.events.map{$0.stage.rawValue}.joined(separator:" → ") ?? "not recorded"
        let historyParsing=cycleState.lastHistoryResponseParsing?.summary ?? "History response parsing: not recorded"
        let perChatDiagnostics=cycleState.perChatHistoryDiagnostics
        let perChatSummary=perChatDiagnostics?.summary ?? ""
        let perChatDetails=perChatDiagnostics?.detailedResponseSummary ?? ""
        perChatHistoryRawOutput.stringValue=perChatDetails.isEmpty ? "Per-chat history response details: not recorded" : perChatDetails
        let pinnedUnknownRows=Array((cycleState.lastPinnedUnknownRows ?? []).prefix(PinnedUnknownRowDiagnostic.maxRows))
        pinnedUnknownRowsRawOutput.stringValue=pinnedUnknownRows.isEmpty ? "Pinned proof unknown rows: none" : "Pinned proof unknown rows: \(pinnedUnknownRows.count)\n"+pinnedUnknownRows.map(\.detailLine).joined(separator:"\n")
        let pinnedUnknownCompact=pinnedUnknownRows.prefix(3).map(\.compactLine).joined(separator:"\n")
        let eventRejections=cycleState.historyProgressEventRejections?.summary ?? "none"
        currentCycleSummaryOutput.stringValue="Build: v\(gptLimitsAppVersion) · \(gptLimitsExecutableBuildIDMarker)\n\(line("Discovery source:"))\n\(line("Coverage:"))\n\(checkedLine)\n\(maintenancePresentation.counters)\n\(maintenancePresentation.admission)\nPinned proof unknown rows: \(pinnedUnknownRows.count)\(pinnedUnknownCompact.isEmpty ? "":"\n\(pinnedUnknownCompact)")\nLast render readiness: \(readiness)\nLast chat check result: \(result)\nLast chat check trace stages: \(stages)\n\(historyParsing)\nHistory parser event rejections: \(eventRejections)\nPer-chat history diagnostics:\n\(perChatSummary.isEmpty ? "not recorded":perChatSummary)"
    }
    @objc func toggleRawDiagnostics() {
        rawDiagnosticsVisible.toggle();rawDiagnosticsStack?.isHidden = !rawDiagnosticsVisible
        rawDiagnosticsToggleButton?.title=rawDiagnosticsVisible ? "Hide raw diagnostics":"Show raw diagnostics"
        layoutDiagnosticsDocument()
    }
    @objc func inspectCurrentChatHistorySource() {
        guard !cycleRunning else {conversationHistoryDiagnosticOutput.stringValue="Current chat history source: unavailable · a cycle is running";return}
        guard manualDiagnosticOwnerLabel()==nil else {conversationHistoryDiagnosticOutput.stringValue="Current chat history source: unavailable · another diagnostic is running";return}
        guard sanitizedChatCheckRoute(web.url).category == .chat else {conversationHistoryDiagnosticOutput.stringValue="Current chat history source: unavailable · current route is not a chat";return}
        let generation=UUID().uuidString;conversationHistoryDiagnosticGeneration=generation
        conversationHistoryDiagnosticOutput.stringValue="Current chat history source: inspecting DOM and network for up to 6 seconds…"
        let generationData=try? JSONSerialization.data(withJSONObject:[generation]),generationJSON=generationData.flatMap{String(data:$0,encoding:.utf8)} ?? "[]"
        let script="window.gptInspectCurrentChatHistorySource?.({durationMs:5000,maxNodes:3000}).then(result=>window.webkit.messageHandlers.conversationHistoryDiagnostic.postMessage({...result,operationGeneration:\(generationJSON)[0]})).catch(()=>window.webkit.messageHandlers.conversationHistoryDiagnostic.postMessage({result:'failure',reason:'diagnostic_failed',operationGeneration:\(generationJSON)[0]})); true;"
        web.evaluateJavaScript(script,completionHandler:nil)
        conversationHistoryDiagnosticTask?.cancel()
        conversationHistoryDiagnosticTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:UInt64(self?.conversationHistoryDiagnosticTimeoutMs ?? 9000)*1_000_000)
            guard let self,self.conversationHistoryDiagnosticGeneration==generation else{return}
            self.conversationHistoryDiagnosticGeneration=nil
            self.conversationHistoryDiagnosticOutput.stringValue="Current chat history source: failure · diagnostic_timeout"
            self.updateCurrentCycleSummary();self.conversationHistoryDiagnosticTask=nil
        }
    }
    @objc func inspectCurrentChatPersistedRecord() {
        let safeRoute=sanitizedChatCheckRoute(web.url)
        guard safeRoute.category == .chat else {
            persistedChatRecordDiagnosticOutput.stringValue="Current chat persisted record: matched: no · reason route_id_unavailable"
            updateCurrentCycleSummary();return
        }
        let routeID=conversationID(in:web.url)
        let snapshot=persistedChatRecordDiagnostic(routeConversationID:routeID,state:cycleState,model:currentRiskModel())
        persistedChatRecordDiagnosticOutput.stringValue="Current chat persisted record:\n"+snapshot.displayText
        updateCurrentCycleSummary()
    }
    @objc func inspectCurrentMessageDOMStructure() {
        guard !cycleRunning else {messageDOMStructureDiagnosticOutput.stringValue="Current message DOM structure: unavailable · a cycle is running";return}
        guard manualDiagnosticOwnerLabel()==nil else {messageDOMStructureDiagnosticOutput.stringValue="Current message DOM structure: unavailable · another diagnostic is running";return}
        guard sanitizedChatCheckRoute(web.url).category == .chat else {messageDOMStructureDiagnosticOutput.stringValue="Current message DOM structure: unavailable · current route is not a chat";return}
        let generation=UUID().uuidString;messageDOMStructureDiagnosticGeneration=generation
        messageDOMStructureDiagnosticOutput.stringValue="Current message DOM structure: inspecting bounded conversation subtree…"
        let generationData=try? JSONSerialization.data(withJSONObject:[generation]),generationJSON=generationData.flatMap{String(data:$0,encoding:.utf8)} ?? "[]"
        let script="const r=window.gptInspectCurrentMessageDOMStructure?.({maxNodes:2500,maxDepth:24,maxMs:1800})||{result:'failure',reason:'operation_missing'};window.webkit.messageHandlers.messageDOMStructureDiagnostic.postMessage({...r,operationGeneration:\(generationJSON)[0]}); true;"
        web.evaluateJavaScript(script,completionHandler:nil)
        messageDOMStructureDiagnosticTask?.cancel()
        messageDOMStructureDiagnosticTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:5_000_000_000)
            guard let self,self.messageDOMStructureDiagnosticGeneration==generation else{return}
            self.messageDOMStructureDiagnosticGeneration=nil
            self.messageDOMStructureDiagnosticOutput.stringValue="Current message DOM structure: failure · diagnostic_timeout"
            self.updateCurrentCycleSummary();self.messageDOMStructureDiagnosticTask=nil
        }
    }
    func renderCurrentMessageDOMStructureDiagnostic(_ data:[String:Any]) {
        guard let token=data["operationGeneration"] as? String,token==messageDOMStructureDiagnosticGeneration else{return}
        messageDOMStructureDiagnosticTask?.cancel();messageDOMStructureDiagnosticTask=nil;messageDOMStructureDiagnosticGeneration=nil
        let result=(data["result"] as? String).flatMap{["success","failure"].contains($0) ? $0:nil} ?? "failure"
        let reason=(data["reason"] as? String).flatMap{$0.range(of:"^[a-z0-9_]{1,48}$",options:.regularExpression) != nil ? $0:nil} ?? "snapshot_failed"
        func count(_ key:String)->Int {max(0,min(3000,(data[key] as? NSNumber)?.intValue ?? 0))}
        func list(_ key:String,limit:Int)->String {((data[key] as? [[String:Any]]) ?? []).prefix(limit).compactMap{item -> String? in
            guard let name=item["name"] as? String,name.range(of:"^[a-z][a-z0-9_-]{0,20}$",options:.regularExpression) != nil else{return nil}
            return "\(name)=\(max(0,min(3000,(item["count"] as? NSNumber)?.intValue ?? 0)))"
        }.joined(separator:",")}
        func names(_ key:String,limit:Int)->String {((data[key] as? [String]) ?? []).filter{$0.range(of:"^(data|aria)-[a-z0-9_-]{1,60}$",options:.regularExpression) != nil}.prefix(limit).joined(separator:",")}
        let markers=data["markerCounts"] as? [String:Any] ?? [:]
        func marker(_ key:String)->Int {max(0,min(3000,(markers[key] as? NSNumber)?.intValue ?? 0))}
        let allowedRoles=Set(["article","listitem","row","group","generic","main","region","other"])
        let signatures=((data["signatures"] as? [[String:Any]]) ?? []).prefix(12).compactMap{item -> String? in
            let tag=(item["tag"] as? String).flatMap{$0.range(of:"^[a-z][a-z0-9-]{0,15}$",options:.regularExpression) != nil ? $0:nil} ?? "unknown"
            let role=(item["role"] as? String).flatMap{allowedRoles.contains($0) ? $0:nil} ?? "other"
            let dataNames=((item["dataAttributeNames"] as? [String]) ?? []).filter{$0.range(of:"^data-[a-z0-9_-]{1,60}$",options:.regularExpression) != nil}.prefix(5).joined(separator:",")
            let ariaNames=((item["ariaAttributeNames"] as? [String]) ?? []).filter{$0.range(of:"^aria-[a-z0-9_-]{1,60}$",options:.regularExpression) != nil}.prefix(4).joined(separator:",")
            let depth=max(0,min(24,(item["depth"] as? NSNumber)?.intValue ?? 0)),n=max(0,min(3000,(item["count"] as? NSNumber)?.intValue ?? 0)),visible=max(0,min(3000,(item["visibleCount"] as? NSNumber)?.intValue ?? 0)),tall=max(0,min(3000,(item["substantialHeightCount"] as? NSNumber)?.intValue ?? 0)),candidate=max(0,min(3000,(item["candidateCount"] as? NSNumber)?.intValue ?? 0)),vertical=max(0,min(3000,(item["verticalRepeatCount"] as? NSNumber)?.intValue ?? 0))
            return "\(tag)/\(role) depth \(depth) data[\(dataNames.isEmpty ? "—":dataNames)] aria[\(ariaNames.isEmpty ? "—":ariaNames)] ×\(n) visible \(visible) tall \(tall) candidates \(candidate) vertical-repeat \(vertical)"
        }.joined(separator:"; ")
        messageDOMStructureDiagnosticOutput.stringValue="Current message DOM structure: \(result) · \(reason)\nScanned \(count("scannedNodeCount")) nodes · truncated \((data["truncated"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown") · open shadow roots \(count("openShadowRootCount"))\nTags [\(list("tagCounts",limit:16))] · roles [\(list("roleCounts",limit:12))]\nMarkers: testid \(marker("testId")), message \(marker("message")), turn \(marker("turn")), author \(marker("author")), data-role \(marker("role"))\nData names [\(names("dataAttributeNames",limit:20))] · aria names [\(names("ariaAttributeNames",limit:16))]\nVisible \(count("visibleElementCount")) · substantial-height \(count("substantialHeightCount")) · scroll containers \(count("scrollContainerCount")) · nested virtualization candidates \(count("nestedVirtualizationContainerCount"))\nRepeated sibling groups \(count("repeatGroupCount")) · vertically repeated groups \(count("verticalRepeatGroupCount")) · structural row candidates \(count("candidateElementCount")) / signatures \(count("candidateSignatureCount"))\nSignatures: \(signatures.isEmpty ? "none":signatures)"
        updateCurrentCycleSummary()
    }
    func renderCurrentChatHistoryDiagnostic(_ data:[String:Any]) {
        guard let token=data["operationGeneration"] as? String,token==conversationHistoryDiagnosticGeneration else{return}
        conversationHistoryDiagnosticTask?.cancel();conversationHistoryDiagnosticTask=nil;conversationHistoryDiagnosticGeneration=nil
        let allowedReasons=Set(["history_source_observed","history_present_in_dom_without_network","history_network_endpoint_changed","history_response_shape_changed","history_not_loaded","not_chat_route","diagnostic_timeout","diagnostic_failed"])
        let reason=(data["reason"] as? String).flatMap{allowedReasons.contains($0) ? $0:nil} ?? "diagnostic_failed"
        let dom=data["dom"] as? [String:Any] ?? [:],network=data["network"] as? [[String:Any]] ?? []
        func count(_ key:String)->Int {max(0,min(5000,(dom[key] as? NSNumber)?.intValue ?? 0))}
        func yes(_ key:String)->String {(dom[key] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"}
        let shapes=(dom["shapes"] as? [[String:Any]] ?? []).prefix(16).map { item -> String in
            let tag=(item["tag"] as? String).flatMap{$0.range(of:"^[a-z][a-z0-9-]{0,15}$",options:.regularExpression) != nil ? $0:nil} ?? "unknown"
            let role=(item["role"] as? String).flatMap{["article","listitem","row","group","generic","main","region","other"].contains($0) ? $0:nil} ?? "other"
            let attrs=(item["dataAttributeNames"] as? [String] ?? []).filter{$0.range(of:"^data-[a-z0-9_-]{1,60}$",options:.regularExpression) != nil}.prefix(12).joined(separator:",")
            let n=max(0,min(5000,(item["count"] as? NSNumber)?.intValue ?? 0))
            return "\(tag)/\(role) data[\(attrs.isEmpty ? "—":attrs)] ×\(n)"
        }.joined(separator:"; ")
        let markers=(dom["markerAttributeNames"] as? [String] ?? []).filter{$0.range(of:"^(data-[a-z0-9_-]{1,60}|aria-[a-z0-9_-]{1,60}|role)$",options:.regularExpression) != nil}.prefix(20).joined(separator:",")
        let pagination=(dom["paginationAttributeNames"] as? [String] ?? []).filter{$0.range(of:"^(data|aria)-[a-z0-9_-]{1,60}$",options:.regularExpression) != nil}.prefix(16).joined(separator:",")
        let route=(data["route"] as? [String:Any])?["template"] as? String
        let safeRoute=route.flatMap{["/c/:id","/g/:id/c/:id","/:id","/:id/:id","home","other"].contains($0) ? $0:nil} ?? "other"
        let events=network.prefix(12).map { item -> String in
            let rawPath=item["endpointTemplate"] as? String ?? ""
            let safePath=sanitizedHistoryEndpointTemplate(rawPath)
            let transport=(item["transport"] as? String).flatMap{["fetch","XHR","resource"].contains($0) ? $0:nil} ?? "unknown"
            let status=max(0,min(599,(item["status"] as? NSNumber)?.intValue ?? 0))
            let keys=(item["topLevelKeys"] as? [String] ?? []).filter{$0.range(of:"^[A-Za-z][A-Za-z0-9_-]{0,63}$",options:.regularExpression) != nil}.prefix(16).joined(separator:",")
            let arrays=(item["arrayCounts"] as? [[String:Any]] ?? []).prefix(8).compactMap{value -> String? in guard let key=value["key"] as? String,key.range(of:"^[A-Za-z][A-Za-z0-9_-]{0,63}$",options:.regularExpression) != nil else{return nil};let n=max(0,min(1000000,(value["count"] as? NSNumber)?.intValue ?? 0));return "\(key)=\(n)"}.joined(separator:",")
            let recognized=(item["recognizedHistory"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"
            let rejection=(item["parserRejectionReason"] as? String).flatMap{$0.range(of:"^[a-z0-9_]{1,48}$",options:.regularExpression) != nil ? $0:nil} ?? "unclassified"
            return "\(safePath) · \(transport) · HTTP \(status) · keys [\(keys.isEmpty ? "—":keys)] · arrays [\(arrays.isEmpty ? "—":arrays)] · recognized \(recognized) · \(rejection)"
        }.joined(separator:"\n")
        conversationHistoryDiagnosticOutput.stringValue="Current chat history source: \(data["result"] as? String == "success" ? reason:"failure · \(reason)") · route \(safeRoute)\nDOM turns \(count("candidateCount")) · visible \(count("visibleCandidateCount")) · scroll containers \(count("scrollableContainerCount")) · lazy/virtualized \(yes("lazyVirtualized")) · pagination elements \(count("paginationElementCount")) · scanned \(count("scannedNodeCount"))\nMarkers [\(markers.isEmpty ? "—":markers)] · pagination attributes [\(pagination.isEmpty ? "—":pagination)]\nTurn structures: \(shapes.isEmpty ? "none":shapes)\nNetwork requests/responses: \(max(0,min(32,(data["requestCount"] as? NSNumber)?.intValue ?? 0)))/\(max(0,min(32,(data["responseCount"] as? NSNumber)?.intValue ?? 0))) · \(max(0,min(7000,(data["durationMs"] as? NSNumber)?.intValue ?? 0))) ms\n\(events.isEmpty ? "No normalized history-network events observed.":events)"
        updateCurrentCycleSummary()
    }
    func sanitizedHistoryEndpointTemplate(_ value:String)->String {
        guard value.hasPrefix("/backend-api/"),!value.contains("?"),!value.contains("#"),value.count<=180 else{return "/backend-api/:path"}
        let known=Set(["backend-api","conversation","conversations","messages","message","history","threads","thread","chat","f","gizmos","list","items","search","page","read","slice","completion","completions"])
        let segments=value.split(separator:"/").map(String.init)
        let safe=segments.enumerated().map{index,segment -> String in
            if segment==":id" || segment==":segment" {return segment}
            if known.contains(segment.lowercased()) {return segment}
            return ":segment"
        }
        return "/"+safe.prefix(10).joined(separator:"/")
    }
    func layoutDiagnosticsDocument() {
        guard let scroll=diagnosticsScrollView,let document=diagnosticsDocumentView,let stack=diagnosticsStack else{return}
        let width=max(1,scroll.contentView.bounds.width)
        if abs(document.frame.width-width)>0.5 {document.setFrameSize(NSSize(width:width,height:document.frame.height))}
        document.layoutSubtreeIfNeeded();stack.layoutSubtreeIfNeeded()
        var contentHeight:CGFloat=0
        for section in stack.arrangedSubviews {
            section.layoutSubtreeIfNeeded()
            contentHeight += max(section.fittingSize.height,section.frame.height)
        }
        contentHeight += CGFloat(max(0,stack.arrangedSubviews.count-1))*stack.spacing
        guard contentHeight.isFinite,contentHeight>0 else{return}
        stack.setFrameSize(NSSize(width:max(1,width-40),height:contentHeight))
        document.layoutSubtreeIfNeeded();stack.layoutSubtreeIfNeeded()
        var sectionBounds=diagnosticsSectionBounds(in:document,stack:stack)
        let measuredHeight=sectionBounds.map(\.height) ?? contentHeight
        let resolvedStackHeight=max(contentHeight,measuredHeight)
        if abs(stack.frame.height-resolvedStackHeight)>0.5 {
            stack.setFrameSize(NSSize(width:max(1,width-40),height:resolvedStackHeight))
            document.layoutSubtreeIfNeeded();stack.layoutSubtreeIfNeeded()
            sectionBounds=diagnosticsSectionBounds(in:document,stack:stack)
        }
        let actualContentHeight=sectionBounds?.height ?? resolvedStackHeight
        let height=max(scroll.contentView.bounds.height,actualContentHeight+40)
        if abs(document.frame.height-height)>0.5 {document.setFrameSize(NSSize(width:width,height:height))}
        document.layoutSubtreeIfNeeded();stack.layoutSubtreeIfNeeded()
        let maximumOriginY=max(0,document.frame.height-scroll.contentView.bounds.height)
        let retainedOriginY=min(maximumOriginY,max(0,scroll.contentView.bounds.origin.y))
        scroll.contentView.scroll(to:NSPoint(x:0,y:retainedOriginY))
        scroll.reflectScrolledClipView(scroll.contentView)
        updateDiagnosticsGeometryTelemetry(sectionFitSum:contentHeight)
    }
    func diagnosticsSectionBounds(in document:NSView,stack:NSStackView)->CGRect? {
        let frames=stack.arrangedSubviews.map{$0.convert($0.bounds,to:document)}
        guard let minX=frames.map(\.minX).min(),let minY=frames.map(\.minY).min(),let maxX=frames.map(\.maxX).max(),let maxY=frames.map(\.maxY).max() else{return nil}
        return CGRect(x:minX,y:minY,width:maxX-minX,height:maxY-minY)
    }
    func updateDiagnosticsGeometryTelemetry(sectionFitSum:CGFloat?=nil) {
        guard let scroll=diagnosticsScrollView,let document=diagnosticsDocumentView,let stack=diagnosticsStack else{return}
        let lastControl=diagnosticButtons(in:stack).last
        let lastRect=lastControl.map{$0.convert($0.bounds,to:document)} ?? .zero
        let visible=scroll.documentVisibleRect
        let actualSectionBottom=diagnosticsSectionBounds(in:document,stack:stack)?.maxY ?? 0
        let sectionExtent=stack.arrangedSubviews.reduce(CGFloat.zero){$0+$1.frame.height}
        let fitSum=sectionFitSum ?? stack.arrangedSubviews.reduce(CGFloat.zero){$0+max($1.fittingSize.height,$1.frame.height)}+CGFloat(max(0,stack.arrangedSubviews.count-1))*stack.spacing
        diagnosticsLayoutTelemetry="viewport \(Int(scroll.contentView.bounds.width))×\(Int(scroll.contentView.bounds.height)) · document \(Int(document.frame.width))×\(Int(document.frame.height)) · section fit/frame \(Int(fitSum))/\(Int(sectionExtent)) · stack frame \(Int(stack.frame.width))×\(Int(stack.frame.height)) · last control y \(Int(lastRect.minY))…\(Int(lastRect.maxY)) · doc bounds \(Int(document.bounds.minY))…\(Int(document.bounds.maxY)) · visible y \(Int(visible.minY))…\(Int(visible.maxY)) · flipped document/stack \(document.isFlipped ? "yes":"no")/\(stack.isFlipped ? "yes":"no") · inside \(document.bounds.contains(lastRect) ? "yes":"no") · visible now \(visible.intersects(lastRect) ? "yes":"no") · arranged bottom \(Int(actualSectionBottom))"
        let oldRuntime=runtimeIdentityOutput.stringValue
        if !oldRuntime.isEmpty {
            let base=oldRuntime.components(separatedBy:"\nDiagnostics geometry:").first ?? oldRuntime
            let updated="\(base)\nDiagnostics geometry: \(diagnosticsLayoutTelemetry)"
            if updated != oldRuntime {runtimeIdentityOutput.stringValue=updated}
        }
    }
    func diagnosticButtons(in root:NSView)->[NSButton] {
        var result:[NSButton]=[]
        for view in root.subviews {
            if let button=view as? NSButton {result.append(button)}
            result.append(contentsOf:diagnosticButtons(in:view))
        }
        return result
    }
    func windowDidResize(_ notification:Notification) {
        guard let window=notification.object as? NSWindow,window===panel else{return}
        DispatchQueue.main.async { self.layoutDiagnosticsDocument() }
    }
    func windowDidBecomeKey(_ notification:Notification) {
        guard let window=notification.object as? NSWindow else{return}
        if window===panel { recordMainWindowLifecycleSnapshot("B diagnostics became key") }
        else if window===mainWindow { recordMainWindowLifecycleSnapshot("C main became key") }
    }
    func windowDidResignKey(_ notification:Notification) {
        guard let window=notification.object as? NSWindow,window===mainWindow,panel.isVisible else{return}
        recordMainWindowLifecycleSnapshot("B main resigned key")
    }
    func windowWillClose(_ notification:Notification) {
        guard let window=notification.object as? NSWindow else{return}
        if window===continuationPreviewWindow {closeContinuationSourcePreview();return}
        guard window===panel else{return}
        recordMainWindowLifecycleSnapshot("C diagnostics will close")
        DispatchQueue.main.async { self.recordMainWindowLifecycleSnapshot("C after diagnostics close") }
    }
    func windowShouldClose(_ window:NSWindow)->Bool {
        guard window===mainWindow else{return true}
        window.orderOut(nil)
        return false
    }
    func mainWindowViewNodes(_ root:NSView?)->[NSView] {
        guard let root else{return []}
        return [root]+root.subviews.flatMap{mainWindowViewNodes($0)}
    }
    func mainWindowLifecycleRect(_ rect:CGRect)->String {
        "\(Int(rect.origin.x)),\(Int(rect.origin.y)),\(Int(rect.width)),\(Int(rect.height))"
    }
    func recordMainWindowLifecycleSnapshot(_ stage:String) {
        guard let window=mainWindow else{return}
        let content=window.contentView,root=content?.subviews.first
        let nodes=mainWindowViewNodes(content),diagnosticNodes=mainWindowViewNodes(panel?.contentView)
        let nodeIDs=Set(nodes.map(ObjectIdentifier.init)),diagnosticNodeIDs=Set(diagnosticNodes.map(ObjectIdentifier.init))
        let layerIDs=Set(nodes.compactMap(\.layer).map(ObjectIdentifier.init))
        let diagnosticLayerIDs=Set(diagnosticNodes.compactMap(\.layer).map(ObjectIdentifier.init))
        let rootSubviewIDs=root?.subviews.map(ObjectIdentifier.init)
        if mainWindowLifecycleBaselineWindow==nil {
            mainWindowLifecycleBaselineWindow=window
            mainWindowLifecycleBaselineContentView=content
            mainWindowLifecycleBaselineRootView=root
            mainWindowLifecycleBaselineRootLayer=root?.layer
            mainWindowLifecycleBaselineRootSubviewIDs=rootSubviewIDs
        }
        let controller=window.contentViewController
        let controllerState=controller == nil ? "none":"present"
        let rootLayer=root?.layer
        let directSubviews=(content?.subviews ?? []).enumerated().map { index,view in
            "\(index):\(String(describing:type(of:view)))@\(mainWindowLifecycleRect(view.frame)) hidden:\(view.isHidden ? "yes":"no") alpha:\(String(format:"%.2f",view.alphaValue))"
        }.joined(separator:";")
        let contentFrame=content.map{mainWindowLifecycleRect($0.frame)} ?? "none"
        let contentBounds=content.map{mainWindowLifecycleRect($0.bounds)} ?? "none"
        let rootFrame=root.map{mainWindowLifecycleRect($0.frame)} ?? "none"
        let rootBounds=root.map{mainWindowLifecycleRect($0.bounds)} ?? "none"
        let line=[
            "\(stage)",
            "window stable:\(mainWindowLifecycleBaselineWindow===window ? "yes":"no") visible:\(window.isVisible ? "yes":"no") frame:\(mainWindowLifecycleRect(window.frame)) occlusion:\(window.occlusionState.rawValue) key/main:\(window.isKeyWindow ? "yes":"no")/\(window.isMainWindow ? "yes":"no") appActive:\(NSApp.isActive)",
            "content stable:\(mainWindowLifecycleBaselineContentView===content ? "yes":"no") controller:\(controllerState) frame/bounds:\(contentFrame)/\(contentBounds) hidden:\(content?.isHidden == true ? "yes":"no") alpha:\(String(format:"%.2f",content?.alphaValue ?? -1)) attached:\(content?.window===window) superview:\(content?.superview != nil) subviews:\(content?.subviews.count ?? 0) needsLayout/display:\(content?.needsLayout == true)/\(content?.needsDisplay == true)",
            "root stable:\(mainWindowLifecycleBaselineRootView===root ? "yes":"no") frame/bounds:\(rootFrame)/\(rootBounds) hidden:\(root?.isHidden == true ? "yes":"no") alpha:\(String(format:"%.2f",root?.alphaValue ?? -1)) attached:\(root?.window===window) subviews:\(root?.subviews.count ?? 0) childrenChanged:\(mainWindowLifecycleBaselineRootSubviewIDs != rootSubviewIDs)",
            "layer backed:\(root?.wantsLayer == true) identityStable:\(mainWindowLifecycleBaselineRootLayer===rootLayer ? "yes":"no") hidden:\(rootLayer?.isHidden == true ? "yes":"no") opacity:\(String(format:"%.2f",rootLayer?.opacity ?? -1)) shared main/Diagnostics views/layers:\(nodeIDs.intersection(diagnosticNodeIDs).count)/\(layerIDs.intersection(diagnosticLayerIDs).count)",
            "direct subviews [\(directSubviews)]"
        ].joined(separator:" · ")
        mainWindowLifecycleSnapshots.append(line)
        if mainWindowLifecycleSnapshots.count>12 {mainWindowLifecycleSnapshots.removeFirst(mainWindowLifecycleSnapshots.count-12)}
        mainWindowLifecycleOutput.stringValue="Main window lifecycle (sanitized):\n"+mainWindowLifecycleSnapshots.joined(separator:"\n")
        NSLog("Main window lifecycle snapshot (sanitized): %@",line)
    }
    func uiLabel(_ text:String,size:CGFloat=13,bold:Bool=false)->NSTextField {
        let label=NSTextField(wrappingLabelWithString:text)
        label.font=bold ? .boldSystemFont(ofSize:size):.systemFont(ofSize:size)
        label.lineBreakMode = .byWordWrapping
        return label
    }
    func buildUserWindows() {
        mainWindow=NSWindow(contentRect:NSRect(x:0,y:0,width:560,height:760),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false)
        mainWindow.title="GPT Limits Tool"
        mainWindow.isReleasedWhenClosed=false
        mainWindow.delegate=self
        mainMonitoringLabel=uiLabel("Monitoring: Off",size:15,bold:true)
        mainLastCheckLabel=uiLabel("Last check: Never")
        mainNextCheckLabel=uiLabel("Next check: Off")
        mainCoverageLabel=uiLabel("Coverage: Not checked")
        mainRiskModelLabel=uiLabel("Risk model: Beta baseline")
        mainRecentResultLabel=uiLabel("No completed check yet")
        mainRecentResultHeading=uiLabel("Recent result",size:15,bold:true)
        mainRiskRows=NSStackView();mainRiskRows.orientation = .vertical;mainRiskRows.alignment = .leading;mainRiskRows.spacing=9
        mainUncertaintyRows=NSStackView();mainUncertaintyRows.orientation = .vertical;mainUncertaintyRows.alignment = .leading;mainUncertaintyRows.spacing=8
        mainUncertaintySummary=uiLabel("No chats need a history check.")
        mainUncertaintySummary.maximumNumberOfLines=0
        mainUncertaintySummary.cell?.wraps=true
        mainUncertaintySummary.cell?.isScrollable=false
        mainUncertaintySummary.setContentCompressionResistancePriority(.defaultLow,for:.horizontal)
        mainUncertaintyExpandButton=button("Show more",#selector(toggleUncertaintyExpansion))
        mainUncertaintyDismissAllButton=button("Hide all until new activity",#selector(dismissAllUnchangedUncertainty))
        mainDismissedUncertaintyButton=button("Show dismissed",#selector(toggleDismissedUncertaintyExpansion))
        mainUncertaintySection=NSStackView(views:[uiLabel("Needs attention",size:15,bold:true),mainUncertaintySummary,mainUncertaintyDismissAllButton,mainUncertaintyRows,mainUncertaintyExpandButton,mainDismissedUncertaintyButton])
        mainUncertaintySection.orientation = .vertical;mainUncertaintySection.alignment = .leading;mainUncertaintySection.spacing=7
        mainRiskList=NSStackView(views:[uiLabel("Confirmed conversation risks",size:15,bold:true),mainRiskRows,mainUncertaintySection,mainRecentResultHeading,mainRecentResultLabel])
        mainRiskList.orientation = .vertical;mainRiskList.alignment = .leading;mainRiskList.spacing=10
        mainRiskList.translatesAutoresizingMaskIntoConstraints=false
        mainRiskScrollView=NSScrollView();mainRiskScrollView.hasVerticalScroller=true;mainRiskScrollView.autohidesScrollers=true;mainRiskScrollView.drawsBackground=false
        mainRiskScrollView.translatesAutoresizingMaskIntoConstraints=false;mainRiskScrollView.documentView=mainRiskList
        mainRiskScrollView.setContentHuggingPriority(.defaultLow,for:.vertical)
        mainRiskScrollView.setContentCompressionResistancePriority(.defaultLow,for:.vertical)
        mainRiskScrollView.heightAnchor.constraint(greaterThanOrEqualToConstant:260).isActive=true
        mainRiskList.frame=NSRect(x:0,y:0,width:500,height:260)
        mainCheckNowButton=button("Check now",#selector(runCycle))
        let openChatGPT=button("Open ChatGPT",#selector(showSession))
        mainRescueButton=button("Rescue current chat…",#selector(beginNativeRescue))
        let settings=button("Settings…",#selector(showSettings))
        diagnosticsButton=button("Diagnostics…",#selector(showPanel))
        let primaryActions=NSStackView(views:[mainCheckNowButton,openChatGPT,mainRescueButton])
        primaryActions.orientation = .horizontal;primaryActions.alignment = .centerY;primaryActions.spacing=8
        let secondaryActions=NSStackView(views:[settings,diagnosticsButton])
        secondaryActions.orientation = .horizontal;secondaryActions.alignment = .centerY;secondaryActions.spacing=8
        mainRescueStatusLabel=uiLabel("Rescue: ready when a conversation is open")
        let content=NSStackView(views:[uiLabel("GPT Limits Tool",size:24,bold:true),mainMonitoringLabel,mainLastCheckLabel,mainNextCheckLabel,mainCoverageLabel,mainRiskModelLabel,mainRiskScrollView,primaryActions,mainRescueStatusLabel,secondaryActions])
        content.orientation = .vertical;content.alignment = .leading;content.spacing=16
        content.translatesAutoresizingMaskIntoConstraints=false
        let mainContainer=NSView();mainContainer.addSubview(content);mainWindow.contentView=mainContainer
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo:mainContainer.leadingAnchor,constant:24),
            content.trailingAnchor.constraint(equalTo:mainContainer.trailingAnchor,constant:-24),
            content.topAnchor.constraint(equalTo:mainContainer.topAnchor,constant:24),
            content.bottomAnchor.constraint(equalTo:mainContainer.bottomAnchor,constant:-20),
            mainRiskList.widthAnchor.constraint(equalTo:mainRiskScrollView.contentView.widthAnchor),
            mainRiskRows.widthAnchor.constraint(equalTo:mainRiskList.widthAnchor),
            mainUncertaintySection.widthAnchor.constraint(equalTo:mainRiskList.widthAnchor),
            mainUncertaintyRows.widthAnchor.constraint(equalTo:mainUncertaintySection.widthAnchor),
            mainUncertaintySummary.widthAnchor.constraint(equalTo:mainUncertaintySection.widthAnchor),
            mainRecentResultLabel.widthAnchor.constraint(equalTo:mainRiskList.widthAnchor)
        ])
        settingsWindow=NSWindow(contentRect:NSRect(x:0,y:0,width:420,height:360),styleMask:[.titled,.closable],backing:.buffered,defer:false)
        settingsWindow.title="GPT Limits Tool — Settings"
        settingsWindow.isReleasedWhenClosed=false
        settingsAutomaticChecks=NSButton(checkboxWithTitle:"Automatic checks",target:self,action:#selector(setAutomaticChecks(_:)))
        settingsAutomaticChecks.state=cycleState.enabled ? .on:.off
        settingsNotificationTitles=NSButton(checkboxWithTitle:"Show chat titles in notifications",target:self,action:#selector(toggleRiskNotificationTitles(_:)))
        settingsNotificationTitles.state=showChatTitlesInNotifications(storedValue:UserDefaults.standard.object(forKey:showChatTitlesInNotificationsDefaultsKey) as? Bool) ? .on:.off
        settingsNotificationStatus=uiLabel("Notifications: Checking…")
        let advanced=NSStackView(views:[uiLabel("Advanced",size:15,bold:true),button("Diagnostics…",#selector(showPanel)),uiLabel("Calibration tools are in Diagnostics.")])
        advanced.orientation = .vertical;advanced.alignment = .leading;advanced.spacing=8
        let settingsContent=NSStackView(views:[settingsAutomaticChecks,uiLabel("Interval: 30 minutes"),settingsNotificationTitles,settingsNotificationStatus,button("Request notification permission",#selector(requestNotificationPermission)),button("Open ChatGPT session",#selector(showSession)),advanced])
        settingsContent.orientation = .vertical;settingsContent.alignment = .leading;settingsContent.spacing=15;settingsContent.translatesAutoresizingMaskIntoConstraints=false
        let settingsContainer=NSView();settingsContainer.addSubview(settingsContent);settingsWindow.contentView=settingsContainer
        NSLayoutConstraint.activate([settingsContent.leadingAnchor.constraint(equalTo:settingsContainer.leadingAnchor,constant:24),settingsContent.trailingAnchor.constraint(equalTo:settingsContainer.trailingAnchor,constant:-24),settingsContent.topAnchor.constraint(equalTo:settingsContainer.topAnchor,constant:24)])
    }
    func beginContinuationSourcePreview(conversationID:String,title:String,riskDisplayLabel:String,measurementComplete:Bool,generation:String) {
        continuationSourcePreview=ContinuationSourcePreview(conversationID:conversationID,title:title,riskDisplayLabel:riskDisplayLabel,measurementComplete:measurementComplete,generation:generation,ownerGeneration:nil,status:.loading)
    }
    func bindContinuationSourceCheckOwner(conversationID:String,generation:String,ownerGeneration:String)->Bool {
        guard var preview=continuationSourcePreview,preview.status == .loading,preview.conversationID==conversationID,preview.generation==generation else{return false}
        preview.generation=generation;preview.ownerGeneration=ownerGeneration;continuationSourcePreview=preview;return true
    }
    @objc func prepareContinuation(_ sender:NSButton) {
        guard let id=continuationPrepareTagToConversationID[sender.tag],let record=cycleState.records[id],!cycleRunning,
              backgroundRenderLease==nil,manualDiagnosticOwnerLabel()==nil,
              let risk=continuationRiskDisplayLabel(record:record,model:currentRiskModel(),nowMs:Date().timeIntervalSince1970*1000) else{return}
        let generation=UUID().uuidString
        beginContinuationSourcePreview(conversationID:id,title:record.title,riskDisplayLabel:risk,
            measurementComplete:riskMeasurementStatus(result:record.lastCheckResult,aggregate:record.aggregate) == .complete,generation:generation)
        presentContinuationPreview()
        guard cycleGate.begin() else{if var preview=continuationSourcePreview{preview.status = .failed;continuationSourcePreview=preview;renderContinuationPreview()};return}
        cyclePhase="Preparing source context";renderCycle()
        cycleTask=Task { @MainActor [weak self] in
            guard let self else{return}
            defer {self.cyclePhase="";self.cycleGate.end();self.cycleTask=nil;self.flushPendingForegroundPresentationIfIdle();self.renderCycle()}
            let budget=ChatCheckBudgetController(checkStartedAt:Date(),cycleDeadline:Date().addingTimeInterval(180))
            self.cycleCurrentChatCheckOrdinal=1
            let result:Result<(SafeAggregate?,String),Error>
            do {result=try await isolateCheck(budget:budget) {try await self.checkRecord(record,budget:budget,captureContinuationSource:true,captureGeneration:generation)}}
            catch {result = .failure(error)}
            if case .failure=result,var preview=self.continuationSourcePreview,preview.generation==generation,preview.status == .loading {
                preview.status = .failed;self.continuationSourcePreview=preview;self.renderContinuationPreview()
            }
        }
    }
    func closeContinuationSourcePreview() {
        continuationSourcePreview=nil
        continuationPreviewWindow?.orderOut(nil);continuationPreviewWindow=nil
        continuationPreviewTitleLabel=nil;continuationPreviewRiskLabel=nil;continuationPreviewStatusLabel=nil
        continuationPreviewMetadataLabel=nil;continuationPreviewNeutralLabel=nil;continuationPreviewFeedbackLabel=nil
        continuationHandoffTextView=nil;continuationCopyButton=nil;continuationOpenButton=nil
    }
    func presentContinuationPreview() {
        guard let preview=continuationSourcePreview else{return}
        if continuationPreviewWindow==nil {
            let window=NSWindow(contentRect:NSRect(x:0,y:0,width:680,height:620),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false)
            window.title="Prepare continuation";window.isReleasedWhenClosed=false;window.delegate=self
            let titleLabel=uiLabel("Source: \(preview.title)",size:16,bold:true)
            let riskLabel=uiLabel("Risk: \(preview.riskDisplayLabel)")
            let statusLabel=uiLabel(preview.statusText)
            let metadataLabel=uiLabel("")
            let neutralLabel=uiLabel("Continuation handoff will be prepared from this conversation.")
            let feedbackLabel=uiLabel("")
            let textView=NSTextView();textView.isEditable=false;textView.isSelectable=true;textView.isRichText=false;textView.font = .systemFont(ofSize:13);textView.string=""
            let scroll=NSScrollView();scroll.hasVerticalScroller=true;scroll.autohidesScrollers=true;scroll.documentView=textView;scroll.heightAnchor.constraint(equalToConstant:330).isActive=true
            let copy=button("Copy handoff",#selector(copyContinuationHandoff));let open=button("Open new chat",#selector(openContinuationNewChat))
            let close=button("Close",#selector(closeContinuationPreviewWindow))
            let actions=NSStackView(views:[copy,open,close]);actions.orientation = .horizontal;actions.alignment = .centerY;actions.spacing=10
            let stack=NSStackView(views:[titleLabel,riskLabel,statusLabel,metadataLabel,neutralLabel,scroll,feedbackLabel,actions]);stack.orientation = .vertical;stack.alignment = .leading;stack.spacing=10;stack.translatesAutoresizingMaskIntoConstraints=false
            let container=NSView();container.addSubview(stack);window.contentView=container
            NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo:container.leadingAnchor,constant:22),stack.trailingAnchor.constraint(equalTo:container.trailingAnchor,constant:-22),stack.topAnchor.constraint(equalTo:container.topAnchor,constant:20),stack.bottomAnchor.constraint(equalTo:container.bottomAnchor,constant:-20),scroll.widthAnchor.constraint(equalTo:stack.widthAnchor)])
            continuationPreviewWindow=window;continuationPreviewTitleLabel=titleLabel;continuationPreviewRiskLabel=riskLabel
            continuationPreviewStatusLabel=statusLabel;continuationPreviewMetadataLabel=metadataLabel;continuationPreviewNeutralLabel=neutralLabel
            continuationPreviewFeedbackLabel=feedbackLabel;continuationHandoffTextView=textView;continuationCopyButton=copy;continuationOpenButton=open
        }
        renderContinuationPreview()
        if let window=continuationPreviewWindow {_=presentWindow(window,intent:.userInitiated,callSite:"prepare_continuation_preview")}
    }
    func renderContinuationPreview() {
        guard let preview=continuationSourcePreview else{return}
        continuationPreviewTitleLabel?.stringValue="Source: \(preview.title)"
        continuationPreviewRiskLabel?.stringValue="Risk: \(preview.riskDisplayLabel)"
        continuationPreviewStatusLabel?.stringValue=preview.statusText
        continuationPreviewMetadataLabel?.stringValue=preview.metadataText ?? ""
        continuationPreviewMetadataLabel?.isHidden=preview.metadataText==nil
        continuationPreviewNeutralLabel?.isHidden=preview.status != .loading
        continuationHandoffTextView?.string=preview.handoffText
        let ready=preview.status == .ready && !preview.handoffText.isEmpty
        continuationCopyButton?.isHidden = !ready;continuationOpenButton?.isHidden = !ready
        continuationPreviewFeedbackLabel?.stringValue=preview.copyFeedback ?? ""
    }
    @objc func closeContinuationPreviewWindow() {continuationPreviewWindow?.close()}
    @objc func copyContinuationHandoff() {
        guard var preview=continuationSourcePreview,preview.status == .ready,!preview.handoffText.isEmpty else{return}
        let exact=preview.handoffText
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.setString(exact,forType:.string) else{return}
        preview.copyFeedback="Copied";continuationSourcePreview=preview;renderContinuationPreview()
    }
    @objc func openContinuationNewChat() {
        guard let preview=continuationSourcePreview,preview.status == .ready,!preview.handoffText.isEmpty,
              let url=URL(string:"https://chatgpt.com/") else{return}
        NSWorkspace.shared.open(url)
    }
    func receiveContinuationSourceEvent(_ data:[String:Any]) {
        guard data["event"] as? String=="continuation_source",var preview=continuationSourcePreview,
              preview.status == .loading,let id=data["conversationID"] as? String,id==preview.conversationID,
              let generation=data["generation"] as? String,generation==preview.generation,
              let owner=data["ownerGeneration"] as? String,owner==preview.ownerGeneration,
              automationToken==owner,chatCheckExpectedConversationID==id else{return}
        let incoming=data["messages"] as? [[String:Any]] ?? []
        var result=[ContinuationSourceMessage](),seen=Set<String>(),totalUnits=0,totalTokens=0
        for item in incoming.prefix(160) {
            guard let messageID=item["id"] as? String,!messageID.isEmpty,seen.insert(messageID).inserted,
                  let role=item["role"] as? String,["user","assistant"].contains(role),let raw=item["text"] as? String else{continue}
            let available=min(30000,max(0,32000-totalUnits));guard available>0 else{break}
            let source=raw as NSString
            var end=min(source.length,available)
            if end>0,end<source.length,(0xD800...0xDBFF).contains(source.character(at:end-1)){end-=1}
            let text=source.substring(to:end)
            let estimate=continuationTextTokenEstimate(text)
            if totalTokens+estimate>4000 {break}
            totalUnits+=(text as NSString).length;totalTokens+=estimate
            let created=(item["createdAt"] as? NSNumber)?.doubleValue
            result.append(ContinuationSourceMessage(id:String(messageID.prefix(256)),role:role,text:text,createdAt:created?.isFinite == true ? created:nil))
        }
        guard !result.isEmpty else{preview.status = .failed;continuationSourcePreview=preview;renderContinuationPreview();return}
        preview.messages=result;preview.estimatedTextTokens=min(4000,totalTokens);preview.truncated=(data["truncated"] as? Bool)==true || result.count<incoming.count
        preview.earlyMessageCount=min(result.count,max(0,(data["earlyMessageCount"] as? Int) ?? 0))
        preview.recentMessageCount=min(result.count-preview.earlyMessageCount,max(0,(data["recentMessageCount"] as? Int) ?? 0))
        preview.handoffText=buildContinuationHandoff(sourceTitle:preview.title,riskDisplayLabel:preview.riskDisplayLabel,measurementComplete:preview.measurementComplete,truncated:preview.truncated,messages:result)
        guard !preview.handoffText.isEmpty else{preview.status = .failed;continuationSourcePreview=preview;renderContinuationPreview();return}
        preview.status = .ready;preview.copyFeedback=nil;continuationSourcePreview=preview;renderContinuationPreview()
    }
    func renderUserUI() {
        guard mainWindow != nil else{return}
        let formatter=DateFormatter();formatter.timeStyle = .short
        mainMonitoringLabel.stringValue="Monitoring: \(cycleState.enabled ? "On":"Off")"
        mainCheckNowButton.isEnabled = !cycleRunning
        mainLastCheckLabel.stringValue="Last check: \(cycleState.lastCycleAt.map{formatter.string(from:$0)} ?? "Never")"
        mainNextCheckLabel.stringValue=cycleRunning ? "Next check: after current cycle + 30 min" : "Next check: \(cycleState.nextRun.map{formatter.string(from:$0)} ?? "Off")"
        if cycleState.monitoringDegraded == true {
            mainCoverageLabel.stringValue="⚠ Monitoring degraded · \(monitoringDegradedReason())\nRecent chat coverage is incomplete; no listed warning does not mean all chats are safe."
        } else {
            mainCoverageLabel.stringValue="Coverage: \(cycleState.lastCoverageStatus.map{coverageStatusUserLabel($0)} ?? "Not checked")"
        }
        let model=currentRiskModel();mainRiskModelLabel.stringValue="Risk model: \(model.source.rawValue)"
        let nowMs=Date().timeIntervalSince1970*1000
        let relevant=cycleState.records.values.compactMap { record -> (ChatRecord,RiskMonitoringState,RiskMonitoringState,RiskMonitoringState)? in
            let completeness=monitoringState(record:record,model:model,nowMs:nowMs)
            let lowerBoundRisk=confirmedRiskFromLowerBound(record.aggregate?.estimatedTextTokens,model:model)
            let riskStates:[RiskMonitoringState]=[.watch,.near,.critical,.limitFloor]
            let riskState=riskStates.contains(completeness) ? completeness:lowerBoundRisk
            let displayState=riskState == .normal ? completeness:riskState
            return completeness == .normal && lowerBoundRisk == .normal ? nil:(record,completeness,lowerBoundRisk,displayState)
        }.sorted { a,b in
            func rank(_ state:RiskMonitoringState)->Int {switch state {case .limitFloor:return 5;case .critical:return 4;case .near:return 3;case .watch:return 2;case .uncertain:return 1;case .normal:return 0}}
            if rank(a.3) != rank(b.3) {return rank(a.3)>rank(b.3)}
            return a.0.lastSeenUpdatedAt>b.0.lastSeenUpdatedAt
        }
        mainRiskRows.setViews([],in:.leading);mainUncertaintyRows.setViews([],in:.leading)
        warningAcknowledgeTagToConversationID=[:];nextWarningAcknowledgeTag=4100
        continuationPrepareTagToConversationID=[:];nextContinuationPrepareTag=5100
        let confirmed=relevant.filter{$0.3 != .uncertain}
        let uncertainWithoutConfirmedRisk=relevant.filter{$0.1 == .uncertain && $0.2 == .normal && needsAttentionActionable(record:$0.0,model:model,nowMs:nowMs)}
        let activeUncertain=uncertainWithoutConfirmedRisk.filter{warningBadgeVisible(record:$0.0,model:model,nowMs:nowMs)}
        let dismissedUncertain=uncertainWithoutConfirmedRisk.filter{!warningBadgeVisible(record:$0.0,model:model,nowMs:nowMs)}
        if confirmed.isEmpty {mainRiskRows.addArrangedSubview(uiLabel("No confirmed conversation risks."))}
        if activeUncertain.isEmpty {
            mainUncertaintySummary.stringValue="No chats need a history check."
        } else {
            mainUncertaintySummary.stringValue="Couldn't fully check \(activeUncertain.count) \(activeUncertain.count == 1 ? "chat":"chats").\nNo confirmed limit risk was detected for these chats, but GPT Limits Tool couldn't verify their complete history."
        }
        mainUncertaintyDismissAllButton.isHidden=activeUncertain.isEmpty
        mainUncertaintyExpandButton.isHidden=activeUncertain.count<=3
        mainUncertaintyExpandButton.title=mainUncertaintyExpanded ? "Show less":"Show \(max(0,activeUncertain.count-3)) more"
        mainDismissedUncertaintyButton.isHidden=dismissedUncertain.isEmpty
        mainDismissedUncertaintyButton.title=mainDismissedUncertaintyExpanded ? "Hide dismissed (\(dismissedUncertain.count))":"Show dismissed (\(dismissedUncertain.count))"
        let visibleActive=mainUncertaintyExpanded ? activeUncertain:Array(activeUncertain.prefix(3))
        for (record,completeness,_,state) in confirmed + visibleActive + (mainDismissedUncertaintyExpanded ? dismissedUncertain:[]) {
            let title=record.title.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty ? "Unnamed chat":record.title
            if completeness == .uncertain && state == .uncertain {
                let acknowledged = !warningBadgeVisible(record:record,model:model,nowMs:nowMs)
                let hasUnprocessedActivity=record.pendingActivityNeedsAttention || hasUnprocessedChatActivity(record)
                let status=hasUnprocessedActivity ? "New activity hasn’t been fully checked yet":"Couldn’t verify full history"
                let titleRow=uiLabel("\(title)",size:13,bold:true)
                let lowerBound=record.aggregate.map{$0.estimatedTextTokens}.flatMap{$0>0 ? lowerBoundUserLabel($0):nil}
                let checked=record.lastCheckAt.map{Date(timeIntervalSince1970:$0/1000).formatted(date:.abbreviated,time:.shortened)} ?? "Not checked yet"
                let details=uiLabel(([status]+(lowerBound.map{[$0]} ?? [])+["Last checked: \(checked)"]).joined(separator:" · "))
                let row=NSStackView(views:[titleRow,details]);row.orientation = .vertical;row.alignment = .leading;row.spacing=3
                let button=NSButton(title:acknowledged ? "Restore to Needs attention":"Hide until new activity",target:self,action:#selector(toggleWarningAcknowledgement(_:)))
                button.bezelStyle = .rounded;button.tag=nextWarningAcknowledgeTag
                warningAcknowledgeTagToConversationID[nextWarningAcknowledgeTag]=record.conversationId;nextWarningAcknowledgeTag+=1
                row.addArrangedSubview(button)
                mainUncertaintyRows.addArrangedSubview(row)
                continue
            }
            let label:String
            switch state {case .watch:label="Watch";case .near:label="Near";case .critical:label="Critical";case .limitFloor:label="Limit floor";case .uncertain,.normal:continue}
            let titleRow=uiLabel("⚠ \(label) · \(title)",size:13,bold:true)
            let reason:String
            if completeness == .uncertain {
                reason="Full history not verified · \(lowerBoundUserLabel(record.aggregate?.estimatedTextTokens ?? 0))"
            } else {
                reason=monitoringWarningReason(record:record,model:model,nowMs:nowMs) ?? "Chat monitoring requires attention."
            }
            let checked=record.lastCheckAt.map{Date(timeIntervalSince1970:$0/1000).formatted(date:.abbreviated,time:.shortened)} ?? "Never"
            let detailText=completeness == .uncertain ? "\(reason)\nLast checked: \(checked)":"\(reason)\nLast check: \(checked) · \(record.lastCheckResult ?? "Not checked")"
            let details=uiLabel(detailText)
            let row=NSStackView(views:[titleRow,details]);row.orientation = .vertical;row.alignment = .leading;row.spacing=4
            if continuationRiskDisplayLabel(record:record,model:model,nowMs:nowMs) != nil {
                let prepare=button("Prepare continuation",#selector(prepareContinuation(_:)))
                prepare.tag=nextContinuationPrepareTag;prepare.isEnabled = !cycleRunning
                continuationPrepareTagToConversationID[nextContinuationPrepareTag]=record.conversationId;nextContinuationPrepareTag+=1
                row.addArrangedSubview(prepare)
            }
            mainRiskRows.addArrangedSubview(row)
        }
        updateWarningIndicator(records:relevant.map{$0.0},model:model,nowMs:nowMs)
        let checkedLine=cycleState.lastStatus.components(separatedBy:"\n").first(where:{$0.hasPrefix("Checked:")})
        mainRecentResultLabel.stringValue=cycleRunning ? "Cycle in progress · \(cyclePhase)" : (checkedLine ?? (cycleState.lastCycleAt == nil ? "No completed check yet":"Last cycle did not produce a chat summary"))
        mainRiskScrollView.layoutSubtreeIfNeeded()
        let warningWidth=max(1,mainRiskScrollView.contentView.bounds.width)
        mainRiskList.frame=NSRect(x:0,y:0,width:warningWidth,height:max(1,mainRiskList.frame.height))
        mainUncertaintySummary.invalidateIntrinsicContentSize()
        mainRecentResultLabel.invalidateIntrinsicContentSize()
        mainRiskRows.invalidateIntrinsicContentSize()
        mainUncertaintyRows.invalidateIntrinsicContentSize()
        mainUncertaintySection.invalidateIntrinsicContentSize()
        mainRiskList.invalidateIntrinsicContentSize();mainRiskList.needsLayout=true
        mainUncertaintyRows.needsLayout=true;mainUncertaintySection.needsLayout=true;mainRiskRows.needsLayout=true
        mainUncertaintyRows.layoutSubtreeIfNeeded();mainRiskRows.layoutSubtreeIfNeeded();mainUncertaintySection.layoutSubtreeIfNeeded()
        mainRiskList.layoutSubtreeIfNeeded()
        let warningHeight=max(mainRiskScrollView.contentView.bounds.height,mainRiskList.fittingSize.height)
        mainRiskList.setFrameSize(NSSize(width:warningWidth,height:warningHeight))
        mainRiskList.needsLayout=true;mainRiskList.layoutSubtreeIfNeeded();mainRiskScrollView.layoutSubtreeIfNeeded()
        recordMainUILayoutSnapshot(activeCount:activeUncertain.count,selectedCount:visibleActive.count)
        let privacyTitles=showChatTitlesInNotifications(storedValue:UserDefaults.standard.object(forKey:showChatTitlesInNotificationsDefaultsKey) as? Bool)
        if settingsNotificationTitles != nil {settingsNotificationTitles.state=privacyTitles ? .on:.off}
        if settingsAutomaticChecks != nil {settingsAutomaticChecks.state=cycleState.enabled ? .on:.off}
    }
    func mainUILayoutRect(_ rect:NSRect)->String {
        "(\(Int(rect.origin.x)),\(Int(rect.origin.y)),\(Int(rect.width)),\(Int(rect.height)))"
    }
    func mainUILayoutViewState(_ name:String,view:NSView,arrangedIn:NSStackView?=nil)->String {
        let attached=view.window===mainWindow
        let inMainHierarchy=mainWindow.contentView.map{view === $0 || view.isDescendant(of:$0)} ?? false
        let fitting=view.fittingSize
        var ancestors=[String](),ancestor=view.superview
        while let current=ancestor {
            ancestors.append("\(String(describing:type(of:current))):hidden=\(current.isHidden ? "yes":"no"),alpha=\(String(format:"%.2f",current.alphaValue)),frame=\(mainUILayoutRect(current.frame))")
            if current===mainWindow.contentView {break}
            ancestor=current.superview
        }
        let arrangedIndex=arrangedIn?.arrangedSubviews.firstIndex(where:{$0===view}).map(String.init) ?? "none"
        let state="\(name){present=\(inMainHierarchy ? "yes":"no"),attached=\(attached ? "yes":"no"),hidden=\(view.isHidden ? "yes":"no"),frame=\(mainUILayoutRect(view.frame)),bounds=\(mainUILayoutRect(view.bounds)),fitting=(\(Int(fitting.width)),\(Int(fitting.height))),alpha=\(String(format:"%.2f",view.alphaValue)),arrangedIndex=\(arrangedIndex),ancestors=[\(ancestors.joined(separator:" > "))]}"
        return state
    }
    func recordMainUILayoutSnapshot(activeCount:Int,selectedCount:Int) {
        guard mainUILayoutSnapshotOutput != nil,mainRiskList != nil,mainUncertaintyRows != nil else{return}
        mainUILayoutRefreshCount+=1
        let rows=mainUncertaintyRows.arrangedSubviews
        let rowStates=rows.prefix(3).enumerated().map{index,row in mainUILayoutViewState("uncertainty_row_\(index+1)",view:row,arrangedIn:mainUncertaintyRows)}
        func index(_ view:NSView)->String {mainRiskList.arrangedSubviews.firstIndex(where:{$0===view}).map(String.init) ?? "missing"}
        let listItems=mainRiskList.arrangedSubviews.enumerated().map{idx,view -> String in
            if view===mainUncertaintySection{return "\(idx):needs_attention"}
            if view===mainRecentResultHeading{return "\(idx):recent_result_heading"}
            if view===mainRecentResultLabel{return "\(idx):recent_result_value"}
            if view===mainRiskRows{return "\(idx):confirmed_rows"}
            return "\(idx):other"
        }
        let listOrder="risk_list_arranged_order=[\(listItems.joined(separator:","))]"
        let sectionItems=mainUncertaintySection.arrangedSubviews.enumerated().map{idx,view -> String in
            if view===mainUncertaintySummary{return "\(idx):summary"}
            if view===mainUncertaintyDismissAllButton{return "\(idx):hide_all"}
            if view===mainUncertaintyRows{return "\(idx):rows"}
            if view===mainUncertaintyExpandButton{return "\(idx):show_more"}
            if view===mainDismissedUncertaintyButton{return "\(idx):dismissed"}
            return "\(idx):heading"
        }
        let sectionOrder="needs_attention_arranged_order=[\(sectionItems.joined(separator:","))]"
        let lines=[
            "refresh=\(mainUILayoutRefreshCount) active=\(activeCount) collapsed_selected=\(selectedCount) row_views=\(rows.count)",
            mainUILayoutViewState("rows_stack",view:mainUncertaintyRows,arrangedIn:mainUncertaintySection),
            rowStates.isEmpty ? "first_rows=none":rowStates.joined(separator:"\n"),
            "show_more{hidden=\(mainUncertaintyExpandButton.isHidden ? "yes":"no"),title=\(mainUncertaintyExpandButton.title),arrangedIndex=\(mainUncertaintySection.arrangedSubviews.firstIndex(where:{$0===mainUncertaintyExpandButton}).map(String.init) ?? "none"),frame=\(mainUILayoutRect(mainUncertaintyExpandButton.frame)),alpha=\(String(format:"%.2f",mainUncertaintyExpandButton.alphaValue))}",
            "recent_result{heading=\(index(mainRecentResultHeading)),headingHidden=\(mainRecentResultHeading.isHidden ? "yes":"no"),headingFrame=\(mainUILayoutRect(mainRecentResultHeading.frame)),value=\(index(mainRecentResultLabel)),valueHidden=\(mainRecentResultLabel.isHidden ? "yes":"no"),valueFrame=\(mainUILayoutRect(mainRecentResultLabel.frame))}",
            listOrder,sectionOrder
        ]
        mainUILayoutSnapshots.append(lines.joined(separator:"\n"))
        if mainUILayoutSnapshots.count>8 {mainUILayoutSnapshots.removeFirst(mainUILayoutSnapshots.count-8)}
        mainUILayoutSnapshotOutput.stringValue="Main UI layout snapshots (sanitized):\n"+mainUILayoutSnapshots.joined(separator:"\n--- refresh ---\n")
    }
    @objc func toggleUncertaintyExpansion() {mainUncertaintyExpanded.toggle();renderCycle()}
    @objc func toggleDismissedUncertaintyExpansion() {mainDismissedUncertaintyExpanded.toggle();renderCycle()}
    func lowerBoundUserLabel(_ tokens:Int)->String {
        guard tokens>0 else{return "No counted token lower bound"}
        if tokens>=1000 {return "At least ~\(Int((Double(tokens)/1000).rounded()))k tokens counted"}
        return "At least \(tokens.formatted()) tokens counted"
    }
    @objc func dismissAllUnchangedUncertainty() {
        let model=currentRiskModel(),nowMs=Date().timeIntervalSince1970*1000
        for id in Array(cycleState.records.keys) {
            guard var record=cycleState.records[id] else{continue}
            guard monitoringState(record:record,model:model,nowMs:nowMs) == .uncertain,
                  needsAttentionActionable(record:record,model:model,nowMs:nowMs),
                  confirmedRiskFromLowerBound(record.aggregate?.estimatedTextTokens,model:model) == .normal,
                  warningBadgeVisible(record:record,model:model,nowMs:nowMs) else{continue}
            record.uncertainAcknowledgedAt=max(nowMs,record.lastSeenUpdatedAt)
            cycleState.records[id]=record
        }
        saveCycle();renderCycle()
    }
    func monitoringDegradedReason()->String {
        switch cycleState.lastCoverageDetail ?? "" {
        case "no_list_response":return "No recent chat list response."
        case "root_http_429":return "ChatGPT rate-limited recent-chat discovery (HTTP 429)."
        case "root_request_without_response":return "The recent-chat request received no response."
        case "pagination_repeated_page_no_progress":return "Recent-chat pagination repeated a full page without new chats; coverage is incomplete."
        case "render_surface_readiness_failed":return "The ChatGPT page could not be prepared for monitoring."
        default:return "Recent chats could not be fully scanned."
        }
    }
    func updateWarningIndicator(records:[ChatRecord],model:RiskModel,nowMs:Double) {
        var counts:[RiskMonitoringState:Int]=[:]
        for record in records {
            let completeness=monitoringState(record:record,model:model,nowMs:nowMs)
            let lowerBoundRisk=confirmedRiskFromLowerBound(record.aggregate?.estimatedTextTokens,model:model)
            let confirmedStates:[RiskMonitoringState]=[.watch,.near,.critical,.limitFloor]
            let risk=confirmedStates.contains(completeness) ? completeness:lowerBoundRisk
            if risk != .normal {counts[risk,default:0]+=1}
            else if completeness == .uncertain && needsAttentionActionable(record:record,model:model,nowMs:nowMs) && warningBadgeVisible(record:record,model:model,nowMs:nowMs) {counts[.uncertain,default:0]+=1}
        }
        let degraded=cycleState.monitoringDegraded == true
        var parts=[String]()
        if counts[.critical,default:0]>0 {parts.append("Critical confirmed: \(counts[.critical]!)")}
        if counts[.limitFloor,default:0]>0 {parts.append("Limit floor confirmed: \(counts[.limitFloor]!)")}
        if counts[.near,default:0]>0 {parts.append("Near confirmed: \(counts[.near]!)")}
        if counts[.watch,default:0]>0 {parts.append("Watch confirmed: \(counts[.watch]!)")}
        let uncertaintyCount=counts[.uncertain,default:0]
        if uncertaintyCount>0 {parts.append("Needs attention: \(uncertaintyCount) chat histories couldn't be fully checked")}
        if degraded {parts.append("Recent chat coverage needs attention")}
        let confirmedCount=counts[.critical,default:0]+counts[.limitFloor,default:0]+counts[.near,default:0]+counts[.watch,default:0]
        let summary=parts.isEmpty ? "No confirmed risks or checks needing attention":parts.joined(separator:" · ")
        statusItem.button?.title=confirmedCount>0 ? "GL ⚠":"GL"
        statusItem.button?.toolTip="GPT Limits Tool · \(summary)"
        statusItem.button?.setAccessibilityLabel("GPT Limits Tool · \(summary)")
        warningOpenMenuItem?.title=confirmedCount>0 ? "⚠ Open GPT Limits Tool · \(confirmedCount) confirmed risks":"Open GPT Limits Tool"
        warningSummaryMenuItem?.title=summary
    }
    @objc func toggleWarningAcknowledgement(_ sender:NSButton) {
        guard let id=warningAcknowledgeTagToConversationID[sender.tag],var record=cycleState.records[id] else{return}
        if let acknowledged=record.uncertainAcknowledgedAt,acknowledged>=record.lastSeenUpdatedAt {record.uncertainAcknowledgedAt=nil}
        else {record.uncertainAcknowledgedAt=max(Date().timeIntervalSince1970*1000,record.lastSeenUpdatedAt)}
        cycleState.records[id]=record;saveCycle();renderCycle()
    }
    func coverageStatusUserLabel(_ status:CoverageStatus)->String {
        switch status {case .completeNonArchived:return "Complete";case .completeAccount:return "Complete";default:return "Incomplete"}
    }
    @objc func setAutomaticChecks(_ sender:NSButton) {
        let enabled=sender.state == .on
        guard cycleState.enabled != enabled else{return}
        cycleState.enabled=enabled;cycleState.nextRun=enabled ? nextDiscoveryRun(after:Date()):nil
        if !enabled {cycleTask?.cancel()}
        scheduleCycle();renderCycle()
    }
    @objc func requestNotificationPermission() {
        lastNotificationPermissionRequest="requested=yes · granted=unknown · error=none · resulting authorization=pending"
        settingsNotificationStatus.stringValue="Notifications: Requesting permission…"
        refreshNotificationIdentityDiagnostics()
        UNUserNotificationCenter.current().requestAuthorization(options:[.alert,.sound]) { [weak self] granted,error in
            DispatchQueue.main.async {
                guard let self else{return}
                self.riskNotificationsAuthorized=granted && error==nil
                let grantValue=error == nil ? (granted ? "yes":"no") : "unknown"
                let errorValue:String
                if let error {
                    let nsError=error as NSError
                    errorValue="\(nsError.domain == "UNErrorDomain" ? "UNErrorDomain":"other_error") code \(nsError.code)"
                } else {errorValue="none"}
                self.lastNotificationPermissionRequest="requested=yes · granted=\(grantValue) · error=\(errorValue) · resulting authorization=checking"
                self.refreshNotificationAuthorization { status in
                    self.lastNotificationPermissionRequest="requested=yes · granted=\(grantValue) · error=\(errorValue) · resulting authorization=\(self.notificationAuthorizationLabel(status))"
                    self.refreshNotificationIdentityDiagnostics()
                }
            }
        }
    }
    func notificationAuthorizationLabel(_ status:UNAuthorizationStatus)->String {
        switch status {case .authorized:return "allowed";case .denied:return "denied";case .provisional:return "provisional";case .notDetermined:return "not_determined";@unknown default:return "unavailable"}
    }
    func refreshNotificationAuthorization(completion:((UNAuthorizationStatus)->Void)?=nil) {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            DispatchQueue.main.async {
                guard let self else{return}
                let status=settings.authorizationStatus
                let label:String
                switch status {case .authorized:label="Allowed";case .denied:label="Denied — enable in System Settings";case .provisional:label="Allowed quietly";case .notDetermined:label="Not requested";@unknown default:label="Unavailable"}
                self.settingsNotificationStatus.stringValue="Notifications: \(label)"
                completion?(status)
            }
        }
    }
    func refreshNotificationIdentityDiagnostics() {
        let info=Bundle.main.infoDictionary ?? [:]
        let bundleID=Bundle.main.bundleIdentifier ?? "unavailable"
        let runtimeBundlePath=Bundle.main.bundleURL.path
        let runtimeVersion=info["CFBundleShortVersionString"] as? String ?? "unavailable"
        let runtimeBuild=info["GPTLimitsBuildID"] as? String ?? "unavailable"
        let currentPath=Bundle.main.bundleURL.standardizedFileURL.path
        let resolvedPath=NSWorkspace.shared.urlForApplication(withBundleIdentifier:bundleID)?.standardizedFileURL.path ?? "unresolved"
        let iconName=(info["CFBundleIconFile"] as? String) ?? "unavailable"
        let iconPath=Bundle.main.resourceURL?.appendingPathComponent(iconName).path ?? "unavailable"
        let iconExists=FileManager.default.fileExists(atPath:iconPath)
        let appIcon=NSWorkspace.shared.icon(forFile:currentPath)
        let maxIcon=appIcon.representations.map{max($0.pixelsWide,$0.pixelsHigh)}.max() ?? 0
        let launchServicesMatch=resolvedPath==currentPath
        notificationIdentityOutput.stringValue="Running bundle path: \(runtimeBundlePath)\nRunning bundle ID: \(bundleID)\nRunning version: \(runtimeVersion)\nRunning build: \(runtimeBuild)\nNotification identity: \(bundleID) · LaunchServices resolves installed bundle: \(launchServicesMatch ? "yes":"no") · CFBundleIconFile \(iconName), asset \(iconExists ? "present":"missing"), largest NSWorkspace icon rep \(maxIcon) px · UNUserNotificationCenter belongs to this running identity; macOS exposes no supported API to list older notification registrations.\nPermission request: \(lastNotificationPermissionRequest)"
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            DispatchQueue.main.async {
                guard let self else{return}
                let permission:String
                switch settings.authorizationStatus {case .authorized:permission="allowed";case .denied:permission="denied";case .provisional:permission="provisional";case .notDetermined:permission="not_determined";@unknown default:permission="unknown"}
                self.notificationIdentityOutput.stringValue += " · permission \(permission)"
            }
        }
    }
    func runtimeSourceClassification() -> String {
        let executable=Bundle.main.executableURL?.standardizedFileURL.path ?? "unavailable"
        let info=Bundle.main.infoDictionary ?? [:]
        let bundleBuildVersion=info["GPTLimitsBuildVersion"] as? String ?? "unavailable"
        let bundleBuildID=info["GPTLimitsBuildID"] as? String ?? "unavailable"
        guard bundleBuildVersion==gptLimitsAppVersion,
              gptLimitsExecutableBuildVersionMarker==gptLimitsAppVersion,
              bundleBuildID==gptLimitsExecutableBuildIDMarker else { return "unexpected" }
        let installedRoot="/Applications/GPT Limits Tool.app/Contents/MacOS/"
        if executable.hasPrefix(installedRoot) { return "installed/local release" }
        if executable.contains("/native-prototype/build/GPTLimitsNativePrototype.app/Contents/MacOS/") { return "stable build" }
        return "unexpected"
    }
    func appWindowType(_ number:Int)->String {
        guard let window=NSApp.windows.first(where:{$0.windowNumber==number}) else{return "other"}
        if window===session{return "session"}
        if window===mainWindow{return "main"}
        if window===panel{return "diagnostics"}
        if window===settingsWindow{return "settings"}
        if authWindows.contains(where:{$0===window}){return "auth"}
        if window is NSPanel{return "panel"}
        return "app-window"
    }
    func cgWindowSummary(_ entry:[String:Any],order:Int,kind:String)->String {
        let number=(entry[kCGWindowNumber as String] as? NSNumber)?.intValue ?? -1
        let ownerPID=(entry[kCGWindowOwnerPID as String] as? NSNumber)?.intValue ?? -1
        let layer=(entry[kCGWindowLayer as String] as? NSNumber)?.intValue ?? -1
        let alpha=(entry[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? -1
        let bounds=entry[kCGWindowBounds as String] as? [String:Any] ?? [:]
        func coordinate(_ key:String)->Int {(bounds[key] as? NSNumber)?.intValue ?? 0}
        let type=kind == "GPT" ? appWindowType(number):"external"
        return "\(kind) PID \(ownerPID) \(type) #\(number) level \(layer) z \(order) bounds \(coordinate("X")),\(coordinate("Y")) \(coordinate("Width"))×\(coordinate("Height")) alpha \(String(format:"%.2f",alpha))"
    }
    func windowOrderingProbeSnapshot()->String {
        let ownPID=Int(ProcessInfo.processInfo.processIdentifier)
        let frontmost=NSWorkspace.shared.frontmostApplication
        let frontmostPID=frontmost?.processIdentifier
        guard let entries=CGWindowListCopyWindowInfo(.optionOnScreenOnly,kCGNullWindowID) as? [[String:Any]] else{return "window list unavailable"}
        let externalTarget=entries.enumerated().first { _,entry in
            (entry[kCGWindowOwnerPID as String] as? NSNumber)?.intValue==Int(frontmostPID ?? -1) &&
            ((entry[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 0)>0
        }
        func rect(_ entry:[String:Any])->CGRect {
            let bounds=entry[kCGWindowBounds as String] as? [String:Any] ?? [:]
            func value(_ key:String)->CGFloat {(bounds[key] as? NSNumber)?.doubleValue ?? 0}
            return CGRect(x:value("X"),y:value("Y"),width:value("Width"),height:value("Height"))
        }
        let targetRect=externalTarget.map{rect($0.element)}
        let targetOrder=externalTarget?.offset
        let ownWindows=entries.enumerated().compactMap { index,entry -> String? in
            guard (entry[kCGWindowOwnerPID as String] as? NSNumber)?.intValue==ownPID,
                  ((entry[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 0)>0 else{return nil}
            let number=(entry[kCGWindowNumber as String] as? NSNumber)?.intValue ?? -1
            let window=NSApp.windows.first{$0.windowNumber==number}
            let ownRect=rect(entry)
            let intersects=targetRect.map{$0.intersects(ownRect)} ?? false
            let isAbove=targetOrder.map{index<$0} ?? false
            let state:String
            if let window {
                let parent=window.parent.map{String($0.windowNumber)} ?? "none"
                let children=window.childWindows?.count ?? 0
                let panelState=(window as? NSPanel).map{" · floating \($0.isFloatingPanel ? "yes":"no") · keyOnlyIfNeeded \($0.becomesKeyOnlyIfNeeded ? "yes":"no")"} ?? ""
                state="level \(window.level.rawValue) · collection \(window.collectionBehavior.rawValue) · parent \(parent) · children \(children) · visible \(window.isVisible ? "yes":"no") · key/main \(window.isKeyWindow ? "yes":"no")/\(window.isMainWindow ? "yes":"no") · hidesOnDeactivate \(window.hidesOnDeactivate ? "yes":"no")\(panelState)"
            } else {state="NSWindow unavailable"}
            return "\(appWindowType(number)) #\(number) z \(index) bounds \(Int(ownRect.minX)),\(Int(ownRect.minY)) \(Int(ownRect.width))×\(Int(ownRect.height)) · intersects foreground \(intersects ? "yes":"no") · above foreground \(isAbove ? "yes":"no") · \(state)"
        }
        let target=externalTarget.map{"external #\(((($0.element[kCGWindowNumber as String] as? NSNumber)?.intValue) ?? -1)) z \($0.offset) bounds \(Int(targetRect?.minX ?? 0)),\(Int(targetRect?.minY ?? 0)) \(Int(targetRect?.width ?? 0))×\(Int(targetRect?.height ?? 0))"} ?? "no visible window for frontmost process"
        return "frontmost \(Int(frontmostPID ?? -1)==ownPID ? "GPT Limits Tool":"external") · target [\(target)] · GPT windows [\(ownWindows.isEmpty ? "none":ownWindows.joined(separator:" | "))]"
    }
    @objc func startWindowOrderingProbe() {
        guard !cycleRunning,backgroundRenderLease==nil,windowOrderingProbeTimer==nil else {
            windowOrderingProbeOutput.stringValue="Window ordering probe unavailable · background operation or another probe is active."
            return
        }
        windowOrderingProbeSamples=[];windowOrderingProbeDeadline=Date().addingTimeInterval(15)
        windowOrderingProbeOutput.stringValue="Window ordering probe running for 15 seconds. Switch to Notes and another app, then return to Diagnostics."
        let timer=DispatchSource.makeTimerSource(queue:.main)
        timer.schedule(deadline:.now(),repeating:.milliseconds(100),leeway:.milliseconds(20))
        timer.setEventHandler { [weak self] in
            guard let self else{return}
            let sample=self.windowOrderingProbeSnapshot()
            if self.windowOrderingProbeSamples.last != sample {self.windowOrderingProbeSamples.append(sample)}
            if self.windowOrderingProbeSamples.count>32 {self.windowOrderingProbeSamples.removeFirst(self.windowOrderingProbeSamples.count-32)}
            guard let deadline=self.windowOrderingProbeDeadline,Date()>=deadline else{return}
            self.windowOrderingProbeTimer?.cancel();self.windowOrderingProbeTimer=nil;self.windowOrderingProbeDeadline=nil
            self.windowOrderingProbeOutput.stringValue="Window ordering probe complete · changed samples \(self.windowOrderingProbeSamples.count) · \(self.windowOrderingProbeSamples.joined(separator:" → "))"
            self.updateRuntimeIdentity()
        }
        windowOrderingProbeTimer=timer;timer.resume()
    }
    func captureGlobalWindowOrder(stage:String)->String {
        let ownPID=Int(ProcessInfo.processInfo.processIdentifier)
        guard let entries=CGWindowListCopyWindowInfo(.optionOnScreenOnly,kCGNullWindowID) as? [[String:Any]] else {
            globalWindowOrderLastSample="\(stage): system window list unavailable"
            return globalWindowOrderLastSample
        }
        let frontmostPID=NSWorkspace.shared.frontmostApplication?.processIdentifier
        let targetPID=globalWindowOrderBaselinePID ?? frontmostPID
        let target=entries.enumerated().first { index,entry in
            (entry[kCGWindowOwnerPID as String] as? NSNumber)?.intValue == Int(targetPID ?? -1)
                && ((entry[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 0) > 0
        }
        let own=entries.enumerated().filter { _,entry in
            (entry[kCGWindowOwnerPID as String] as? NSNumber)?.intValue == ownPID
                && ((entry[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 0) > 0
        }
        func windowRect(_ entry:[String:Any])->CGRect {
            let bounds=entry[kCGWindowBounds as String] as? [String:Any] ?? [:]
            func value(_ key:String)->CGFloat {(bounds[key] as? NSNumber)?.doubleValue ?? 0}
            return CGRect(x:value("X"),y:value("Y"),width:value("Width"),height:value("Height"))
        }
        let targetIndex=target?.offset
        let targetRect=target.map{windowRect($0.element)}
        let above=own.filter { index,entry in
            guard targetIndex.map({index<$0}) == true,let targetRect else{return false}
            return windowRect(entry).intersects(targetRect)
        }
        globalWindowOrderSampleCount += 1
        if !above.isEmpty {
            globalWindowOrderViolationCount += 1
            let ownDetail=above.map{index,entry in cgWindowSummary(entry,order:index,kind:"GPT")}.joined(separator:"; ")
            let targetDetail=target.map{cgWindowSummary($0.element,order:$0.offset,kind:"foreground")} ?? "foreground window unavailable"
            let violation="\(stage): \(ownDetail) above \(targetDetail)"
            if globalWindowOrderViolationSamples.last != violation,globalWindowOrderViolationSamples.count<20 {globalWindowOrderViolationSamples.append(violation)}
        }
        let ownDetails=own.prefix(8).map{cgWindowSummary($0.element,order:$0.offset,kind:"GPT")}.joined(separator:"; ")
        let targetDetails=target.map{cgWindowSummary($0.element,order:$0.offset,kind:"foreground")} ?? "foreground app window unavailable"
        let baseline=globalWindowOrderBaselinePID.map(String.init) ?? "unknown"
        globalWindowOrderLastSample="\(stage): baseline PID \(baseline) · current frontmost \(frontmostPID.map(String.init) ?? "unknown") · \(above.isEmpty ? "no GPT window above target":"GPT window above target") · own [\(ownDetails.isEmpty ? "none":ownDetails)] · target [\(targetDetails)]"
        if globalWindowOrderCheckpointSamples.count>=16 {globalWindowOrderCheckpointSamples.removeFirst()}
        globalWindowOrderCheckpointSamples.append(globalWindowOrderLastSample)
        return globalWindowOrderLastSample
    }
    func beginGlobalWindowOrderMonitoring() {
        globalWindowOrderMonitor?.cancel()
        globalWindowOrderSampleCount=0;globalWindowOrderViolationCount=0;globalWindowOrderCheckpointSamples=[];globalWindowOrderViolationSamples=[]
        globalWindowOrderBaselinePID=NSWorkspace.shared.frontmostApplication?.processIdentifier
        _=captureGlobalWindowOrder(stage:"cycle start")
        let monitor=DispatchSource.makeTimerSource(queue:.main)
        monitor.schedule(deadline:.now() + .milliseconds(100),repeating:.milliseconds(100),leeway:.milliseconds(20))
        monitor.setEventHandler { [weak self] in guard let self,self.cycleRunning || self.backgroundRenderLease != nil else{return};_=self.captureGlobalWindowOrder(stage:"continuous sample") }
        globalWindowOrderMonitor=monitor;monitor.resume()
    }
    func finishGlobalWindowOrderMonitoring() {
        _=captureGlobalWindowOrder(stage:"cycle end")
        globalWindowOrderMonitor?.cancel();globalWindowOrderMonitor=nil
        let violations=globalWindowOrderViolationSamples.isEmpty ? "none":globalWindowOrderViolationSamples.joined(separator:" | ")
        globalWindowOrderSummary="samples \(globalWindowOrderSampleCount) · GPT windows above baseline foreground observed \(globalWindowOrderViolationCount>0 ? "yes":"no") · violating samples \(globalWindowOrderViolationCount) · checkpoints [\(globalWindowOrderCheckpointSamples.joined(separator:" | "))] · first violations [\(violations)]"
        globalWindowOrderBaselinePID=nil
    }
    func captureBackgroundFocusSnapshot()->BackgroundFocusSnapshot {
        let frontmost=NSWorkspace.shared.frontmostApplication
        let pid=frontmost?.processIdentifier
        let ownPID=ProcessInfo.processInfo.processIdentifier
        let category:String
        if pid==nil {category="unknown"} else if pid==ownPID {category="GPT Limits Tool"} else {category="external"}
        let windows=NSApp.orderedWindows
        return BackgroundFocusSnapshot(frontmostPID:pid,frontmostCategory:category,appActive:NSApp.isActive,
            appKeyWindow:NSApp.keyWindow != nil,appMainWindow:NSApp.mainWindow != nil,
            sessionVisible:session.isVisible,sessionKey:session.isKeyWindow,sessionMain:session.isMainWindow,
            sessionOrderIndex:windows.firstIndex(of:session),sessionLevel:session.level.rawValue)
    }
    func focusSnapshotSummary(_ snapshot:BackgroundFocusSnapshot)->String {
        "frontmost \(snapshot.frontmostCategory) · NSApp.isActive \(snapshot.appActive ? "yes":"no") · app key/main \(snapshot.appKeyWindow ? "yes":"no")/\(snapshot.appMainWindow ? "yes":"no") · session visible/key/main \(snapshot.sessionVisible ? "yes":"no")/\(snapshot.sessionKey ? "yes":"no")/\(snapshot.sessionMain ? "yes":"no") · order \(snapshot.sessionOrderIndex.map(String.init) ?? "none") · level \(snapshot.sessionLevel)"
    }
    func beginBackgroundFocusObservation() {
        let baseline=captureBackgroundFocusSnapshot()
        beginGlobalWindowOrderMonitoring()
        backgroundFocusCycleBaseline=baseline;backgroundFocusCycleSamples=[];backgroundFocusCycleSawGPTFrontmost=baseline.frontmostCategory=="GPT Limits Tool"
        backgroundFocusCycleFrontmostPreserved="unknown";backgroundFocusCycleActivationUnchanged="unknown"
        backgroundFocusCycleKeyMainPreserved="unknown";backgroundFocusCycleWindowOrderingPreserved="unknown"
        recordBackgroundFocusSample("cycle start")
    }
    func recordBackgroundFocusSample(_ stage:String) {
        let globalOrder=captureGlobalWindowOrder(stage:stage)
        let sample=captureBackgroundFocusSnapshot()
        if sample.frontmostCategory=="GPT Limits Tool" {backgroundFocusCycleSawGPTFrontmost=true}
        backgroundFocusCycleSamples.append("\(stage): \(focusSnapshotSummary(sample)) · global order [\(globalOrder)]")
        if backgroundFocusCycleSamples.count>16 {backgroundFocusCycleSamples.removeFirst(backgroundFocusCycleSamples.count-16)}
    }
    func finalizeBackgroundFocusObservation(_ final:BackgroundFocusSnapshot) {
        guard let baseline=backgroundFocusCycleBaseline else{return}
        if let initial=baseline.frontmostPID,let current=final.frontmostPID {
            backgroundFocusCycleFrontmostPreserved=(initial==current && !backgroundFocusCycleSawGPTFrontmost) ? "yes":"no"
        } else {backgroundFocusCycleFrontmostPreserved="unknown"}
        backgroundFocusCycleActivationUnchanged=baseline.appActive==final.appActive ? "yes":"no"
        backgroundFocusCycleKeyMainPreserved=(baseline.appKeyWindow==final.appKeyWindow && baseline.appMainWindow==final.appMainWindow && baseline.sessionKey==final.sessionKey && baseline.sessionMain==final.sessionMain) ? "yes":"no"
        backgroundFocusCycleWindowOrderingPreserved=(baseline.sessionVisible==final.sessionVisible && baseline.sessionOrderIndex==final.sessionOrderIndex && baseline.sessionLevel==final.sessionLevel) ? "yes":"no"
    }
    func backgroundPresentationOperationLabel()->String? {
        if cycleRunning {return cyclePhase.isEmpty ? "scheduler_cycle":cyclePhase}
        if let owner=backgroundRenderLeaseOwner {return "render_lease · owner \(owner)"}
        return nil
    }
    func recordBackgroundPresentationTrace(_ callSite:String,intent:WindowPresentationIntent,phase:String,window:NSWindow?,event:String?=nil) {
        guard let operation=backgroundPresentationOperationLabel() else{return}
        let snapshot=captureBackgroundFocusSnapshot()
        let type=window.map{appWindowType($0.windowNumber)} ?? "none"
        let number=window.map{String($0.windowNumber)} ?? "none"
        let label=event ?? callSite
        backgroundPresentationTrace.append("\(label) · call \(callSite) · intent \(intent == .userInitiated ? "userInitiated":"background") · phase \(phase) · operation \(operation) · affected \(type)#\(number) · \(focusSnapshotSummary(snapshot))")
        if backgroundPresentationTrace.count>48 {backgroundPresentationTrace.removeFirst(backgroundPresentationTrace.count-48)}
    }
    func installBackgroundActivationTraceObservers() {
        guard backgroundActivationObservers.isEmpty else{return}
        let center=NotificationCenter.default
        for (name,label) in [(NSApplication.willBecomeActiveNotification,"NSApplication.willBecomeActive"),(NSApplication.didBecomeActiveNotification,"NSApplication.didBecomeActive")] {
            backgroundActivationObservers.append(center.addObserver(forName:name,object:NSApp,queue:.main) { [weak self] _ in
                guard let self,self.backgroundPresentationOperationLabel() != nil else{return}
                self.recordBackgroundPresentationTrace(label,intent:.background,phase:"AppKit event",window:NSApp.keyWindow,event:label)
            })
        }
        for (name,label) in [(NSWindow.didBecomeKeyNotification,"NSWindow.didBecomeKey"),(NSWindow.didBecomeMainNotification,"NSWindow.didBecomeMain")] {
            backgroundActivationObservers.append(center.addObserver(forName:name,object:nil,queue:.main) { [weak self] note in
                guard let self,self.backgroundPresentationOperationLabel() != nil else{return}
                self.recordBackgroundPresentationTrace(label,intent:.background,phase:"AppKit event",window:note.object as? NSWindow,event:label)
            })
        }
    }
    func flushPendingForegroundPresentationIfIdle() {
        guard !cycleRunning,backgroundRenderLease==nil else{return}
        if visibleSessionPresentationPending {restoreVisibleSessionPresentation();return}
        guard let window=pendingForegroundWindow else{return}
        let callSite=pendingForegroundCallSite.isEmpty ? "deferred_user_action":pendingForegroundCallSite
        let validation=pendingForegroundValidation ?? {true}
        let completion=pendingForegroundCompletion
        pendingForegroundWindow=nil;pendingForegroundCallSite="";pendingForegroundValidation=nil;pendingForegroundCompletion=nil
        _=presentWindow(window,intent:.userInitiated,callSite:callSite,isStillValid:validation,onPresented:completion)
    }
    func updateRuntimeIdentity() {
        let executable=Bundle.main.executableURL?.standardizedFileURL.path ?? "unavailable"
        let bundle=Bundle.main.bundleURL.standardizedFileURL.path
        let info=Bundle.main.infoDictionary ?? [:]
        let bundleBuildVersion=info["GPTLimitsBuildVersion"] as? String ?? "unavailable"
        let bundleBuildID=info["GPTLimitsBuildID"] as? String ?? "unavailable"
        let buildTimestamp=info["GPTLimitsBuildTimestampUTC"] as? String ?? "unavailable"
        let executableBuildID=gptLimitsExecutableBuildIDMarker
        let source=runtimeSourceClassification()
        let diagnosticOwner=manualDiagnosticOwnerLabel()
        let renderReadinessLine=cycleState.lastRenderReadiness.map(renderReadinessDiagnosticSummary) ?? "not recorded"
        runtimeIdentityOutput.stringValue="Runtime diagnostic version: v\(pinnedDiagnosticVersion)\nRuntime build version: v\(bundleBuildVersion)\nRuntime build ID: \(bundleBuildID)\nExecutable build ID: \(executableBuildID)\nBuild timestamp UTC: \(buildTimestamp)\nCurrent bundle ID: \(Bundle.main.bundleIdentifier ?? "unavailable") · bundle identity migration: \(bundleIdentityMigrationStatus)\nRuntime executable: \(executable)\nRuntime bundle: \(bundle)\nPID: \(ProcessInfo.processInfo.processIdentifier)\nRuntime source: \(source)\nScheduler running: \(cycleRunning ? "Yes":"No")\nDiagnostic running: \(diagnosticOwner == nil ? "No":"Yes") · owner \(diagnosticOwner ?? "none")\nRender lease: \(backgroundRenderLeaseReport)\nLast render readiness:\n\(renderReadinessLine)\nRender lease restore: focus snapshot captured \(backgroundRenderLeaseFocusSnapshotCaptured ? "yes":"no") · window ordering preserved \(backgroundRenderLeaseWindowOrderingRestored) · key/main preserved \(backgroundRenderLeaseKeyMainRestored) · GPT Limits Tool activation unchanged \(backgroundRenderLeaseApplicationActivationRestored) · ownership released \(backgroundRenderLeaseOwnershipReleased)\nBackground focus: frontmost preserved \(backgroundFocusCycleFrontmostPreserved) · GPT Limits Tool was frontmost during samples \(backgroundFocusCycleSawGPTFrontmost ? "yes":"no") · activation unchanged \(backgroundFocusCycleActivationUnchanged) · key/main preserved \(backgroundFocusCycleKeyMainPreserved) · window ordering preserved \(backgroundFocusCycleWindowOrderingPreserved)\nBackground focus stages: \(backgroundFocusCycleSamples.isEmpty ? "not sampled":backgroundFocusCycleSamples.joined(separator:" | "))\nBackground presentation trace: \(backgroundPresentationTrace.isEmpty ? "none":backgroundPresentationTrace.joined(separator:" | "))\nGlobal window order: \(globalWindowOrderSummary) · live \(globalWindowOrderLastSample)\nWindow ordering probe: \(windowOrderingProbeOutput.stringValue)\nVisible session presentation: \(visibleSessionPresentationReport)\nDiagnostics geometry: \(diagnosticsLayoutTelemetry)"
    }
    func manualDiagnosticOwnerLabel()->String? {
        reconcileStaleListDiagnosticGeneration()
        if conversationHistoryDiagnosticGeneration != nil {return "conversation history diagnostic"}
        if messageDOMStructureDiagnosticGeneration != nil {return "message DOM structure diagnostic"}
        if liveResumeDiagnosticGeneration != nil {return "same-document resume proof"}
        if pinnedActivityDiagnosticToken != nil || pinnedActivityLaunchPending {return "pinned prefix + activity"}
        if renderDiagnosticToken != nil {return "hidden WebView rendering"}
        if pinDiagnosticRunID != nil {return "sidebar diagnostic"}
        if listDiagnosticGenerationGate.isActive {return listDiagnosticMode.isEmpty ? "root-list diagnostic":"\(listDiagnosticMode.lowercased()) home diagnostic"}
        if !cycleRunning,backgroundRenderLeaseOwner != nil {return "render lease"}
        return nil
    }
    func reconcileStaleListDiagnosticGeneration() {
        guard listDiagnosticGenerationGate.isActive,
              listDiagnosticTask == nil || listDiagnosticTask?.isCancelled == true,
              listDiagnosticMode.isEmpty || listDiagnosticTask?.isCancelled == true,
              let generation=listDiagnosticGenerationGate.activeGeneration else {return}
        _ = listDiagnosticGenerationGate.finish(generation)
        listDiagnosticTask=nil
        listDiagnosticMode=""
    }
    func restoreInteractiveWindowState() {
        for window in [mainWindow,panel,settingsWindow].compactMap({$0}) {
            window.ignoresMouseEvents=false
        }
    }
    @discardableResult
    func presentWindow(_ window:NSWindow,intent:WindowPresentationIntent,callSite:String,isStillValid:@escaping ()->Bool = {true},onPresented:(()->Void)?=nil)->Bool {
        recordBackgroundPresentationTrace(callSite,intent:intent,phase:"before presentation decision",window:window)
        guard intent == .userInitiated else {
            recordBackgroundPresentationTrace(callSite,intent:intent,phase:"rejected background intent",window:window)
            return false
        }
        guard isStillValid() else {
            recordBackgroundPresentationTrace(callSite,intent:intent,phase:"rejected stale user action",window:window)
            return false
        }
        if cycleRunning || backgroundRenderLease != nil {
            pendingForegroundWindow=window
            pendingForegroundCallSite=callSite
            pendingForegroundValidation=isStillValid
            pendingForegroundCompletion=onPresented
            recordBackgroundPresentationTrace(callSite,intent:intent,phase:"queued until background operation ends",window:window)
            return false
        }
        recordBackgroundPresentationTrace(callSite,intent:intent,phase:"before activation",window:window)
        NSApp.activate(ignoringOtherApps:true)
        window.makeKeyAndOrderFront(nil)
        recordBackgroundPresentationTrace(callSite,intent:intent,phase:"after activation and key/order",window:window)
        onPresented?()
        return true
    }
    @objc func showPanel() {
        recordMainWindowLifecycleSnapshot("A before diagnostics")
        restoreInteractiveWindowState();presentWindow(panel,intent:.userInitiated,callSite:"menu_diagnostics")
        recordMainWindowLifecycleSnapshot("B diagnostics presentation returned")
        DispatchQueue.main.async { self.recordMainWindowLifecycleSnapshot("B diagnostics next runloop") }
        updateRuntimeIdentity()
        refreshNotificationIdentityDiagnostics()
    }
    @objc func showMainWindow() { restoreInteractiveWindowState();presentWindow(mainWindow,intent:.userInitiated,callSite:"menu_main_window");renderUserUI() }
    @objc func showSettings() { presentWindow(settingsWindow,intent:.userInitiated,callSite:"menu_settings");refreshNotificationAuthorization() }
    @objc func showSession() { restoreVisibleSessionPresentation() }
    func sessionRouteTemplate()->String {
        let path=web.url?.path ?? ""
        if path=="/" || path.isEmpty{return "/"}
        if path.range(of:"^/c/[^/]+/?$",options:.regularExpression) != nil{return "/c/<id>"}
        if path.range(of:"^/g/[^/]+/c/[^/]+/?$",options:.regularExpression) != nil{return "/g/<id>/c/<id>"}
        return "/<other>"
    }
    func sessionPresentationSnapshot()->String {
        let content=session.contentView
        let frame=session.frame,contentFrame=content?.frame ?? .zero,webFrame=web.frame
        let bounds=web.bounds,layer=web.layer
        let hit=content?.hitTest(NSPoint(x:contentFrame.width/2,y:contentFrame.height/2))
        var hitIsInsideWeb=false,current=hit
        while let view=current {if view===web {hitIsInsideWeb=true;break};current=view.superview}
        let hitClass=hit.map{String(describing:type(of:$0))} ?? "none"
        var higherWindowCoversCenter=false
        if let content,let index=NSApp.orderedWindows.firstIndex(of:session) {
            let localCenter=content.convert(NSPoint(x:content.bounds.midX,y:content.bounds.midY),to:nil)
            let screenCenter=session.convertToScreen(NSRect(origin:localCenter,size:.zero)).origin
            higherWindowCoversCenter=NSApp.orderedWindows.prefix(index).contains{$0.isVisible && $0.frame.contains(screenCenter)}
        }
        let scale=session.backingScaleFactor
        let visibleOcclusion=session.occlusionState.contains(.visible)
        let responder=(session.firstResponder.map{String(describing:type(of:$0))} ?? "none")+" · minimized \(session.isMiniaturized ? "yes":"no")"
        return "visible \(session.isVisible ? "yes":"no") · key/main \(session.isKeyWindow ? "yes":"no")/\(session.isMainWindow ? "yes":"no") · occlusion visible \(visibleOcclusion ? "yes":"no") · backing scale \(String(format:"%.2f",scale)) · first responder \(responder) · window \(Int(frame.width))×\(Int(frame.height)) · content \(Int(contentFrame.width))×\(Int(contentFrame.height)) · WebView frame/bounds \(Int(webFrame.width))×\(Int(webFrame.height))/\(Int(bounds.width))×\(Int(bounds.height)) · hidden \(web.isHidden ? "yes":"no") · alpha \(String(format:"%.2f",web.alphaValue)) · attached \(web.window===session && content===web && web.superview != nil ? "yes":"no") · layer \(web.wantsLayer ? "backed":"unbacked") opacity \(String(format:"%.2f",layer?.opacity ?? -1)) hidden \(layer?.isHidden == true ? "yes":"no") clips \(layer?.masksToBounds == true ? "yes":"no") · layout/display pending \(web.needsLayout ? "yes":"no")/\(web.needsDisplay ? "yes":"no") · center hit \(hitClass) inside WebView \(hitIsInsideWeb ? "yes":"no") · higher window covers center \(higherWindowCoversCenter ? "yes":"no") · ignoresMouseEvents \(session.ignoresMouseEvents ? "yes":"no") · loading \(web.isLoading ? "yes":"no") · progress \(String(format:"%.2f",web.estimatedProgress)) · route \(sessionRouteTemplate())"
    }
    func sessionRenderDOMSummary(_ data:[String:Any])->String {
        let viewport=data["viewport"] as? [String:Any] ?? [:],html=data["html"] as? [String:Any] ?? [:],body=data["body"] as? [String:Any] ?? [:]
        let samples=data["messageSamples"] as? [[String:Any]] ?? []
        let sampleSummary=samples.map { sample -> String in
            let rect=sample["rect"] as? [String:Any] ?? [:]
            let x=(rect["x"] as? NSNumber)?.intValue ?? 0,y=(rect["y"] as? NSNumber)?.intValue ?? 0
            let width=(rect["width"] as? NSNumber)?.intValue ?? 0,height=(rect["height"] as? NSNumber)?.intValue ?? 0
            let display=sample["display"] as? String ?? "unknown",visibility=sample["visibility"] as? String ?? "unknown"
            let opacity=(sample["opacity"] as? NSNumber)?.doubleValue ?? -1
            return "\(x),\(y) \(width)×\(height) \(display)/\(visibility)/\(String(format:"%.2f",opacity))"
        }.joined(separator:"; ")
        let selectors=data["selectorCounts"] as? [String:Any] ?? [:]
        let selectorSummary=[("author", "dataMessageAuthorRole"),("conversation", "dataConversationRole"),("user", "dataUserMessageBubble"),("assistant", "dataChatgptAgentTurnStart"),("article", "article"),("turn", "conversationTurn"),("data-turn", "dataTurn")]
            .map{"\($0.0) \((selectors[$0.1] as? NSNumber)?.intValue ?? 0)"}.joined(separator:", ")
        let targetSamples=data["renderTargetSamples"] as? [[String:Any]] ?? []
        let targetSummary=targetSamples.prefix(3).map { sample -> String in
            let rect=sample["rect"] as? [String:Any] ?? [:]
            return "\((rect["x"] as? NSNumber)?.intValue ?? 0),\((rect["y"] as? NSNumber)?.intValue ?? 0) \((rect["width"] as? NSNumber)?.intValue ?? 0)×\((rect["height"] as? NSNumber)?.intValue ?? 0) \(sample["display"] as? String ?? "unknown")/\(sample["visibility"] as? String ?? "unknown")"
        }.joined(separator:"; ")
        return "DOM \(data["documentReadyState"] as? String ?? "unknown") · viewport \((viewport["width"] as? NSNumber)?.intValue ?? 0)×\((viewport["height"] as? NSNumber)?.intValue ?? 0) · html/body client \((html["clientWidth"] as? NSNumber)?.intValue ?? 0)×\((html["clientHeight"] as? NSNumber)?.intValue ?? 0)/\((body["clientWidth"] as? NSNumber)?.intValue ?? 0)×\((body["clientHeight"] as? NSNumber)?.intValue ?? 0) · scroll \((html["scrollHeight"] as? NSNumber)?.intValue ?? 0)/\((body["scrollHeight"] as? NSNumber)?.intValue ?? 0) · selector counts [\(selectorSummary)] · DOM markers \((data["fallbackCandidateCount"] as? NSNumber)?.intValue ?? 0) · render targets \((data["renderTargetCount"] as? NSNumber)?.intValue ?? 0), visible \((data["visibleRenderTargetCount"] as? NSNumber)?.intValue ?? 0) · marker rect/style [\(sampleSummary)] · target rect/style [\(targetSummary)] · viewport center hit \((data["viewportCenterHit"] as? [String:Any])?["tag"] as? String ?? "none")"
    }
    func sessionPaintWatchSummary(_ data:[String:Any])->String {
        let samples=data["firstCandidateRects"] as? [[String:Any]] ?? []
        let summarized=samples.prefix(3).map { sample -> String in
            let rect=sample["rect"] as? [String:Any] ?? [:]
            return "\((rect["x"] as? NSNumber)?.intValue ?? 0),\((rect["y"] as? NSNumber)?.intValue ?? 0) \((rect["width"] as? NSNumber)?.intValue ?? 0)×\((rect["height"] as? NSNumber)?.intValue ?? 0) \(sample["display"] as? String ?? "unknown")/\(sample["visibility"] as? String ?? "unknown")/\(String(format:"%.2f",(sample["opacity"] as? NSNumber)?.doubleValue ?? -1))"
        }.joined(separator:"; ")
        let counts=data["selectorCounts"] as? [String:Any] ?? [:]
        let selectorSummary=["dataConversationRole","dataUserMessageBubble","dataChatgptAgentTurnStart"].map{"\($0):\((counts[$0] as? NSNumber)?.intValue ?? 0)"}.joined(separator:", ")
        let targetSamples=data["renderTargetSamples"] as? [[String:Any]] ?? []
        let targetSummary=targetSamples.prefix(3).map { sample -> String in
            let rect=sample["rect"] as? [String:Any] ?? [:]
            return "\((rect["x"] as? NSNumber)?.intValue ?? 0),\((rect["y"] as? NSNumber)?.intValue ?? 0) \((rect["width"] as? NSNumber)?.intValue ?? 0)×\((rect["height"] as? NSNumber)?.intValue ?? 0) \(sample["display"] as? String ?? "unknown")/\(sample["visibility"] as? String ?? "unknown")"
        }.joined(separator:"; ")
        return "paint watch \(data["status"] as? String ?? "unknown") · first render target after \((data["elapsedMs"] as? NSNumber)?.intValue ?? -1) ms · targets \((data["firstRenderTargetCount"] as? NSNumber)?.intValue ?? 0), visible \((data["firstVisibleRenderTargetCount"] as? NSNumber)?.intValue ?? 0) · selectors [\(selectorSummary)] · marker count \((data["firstCandidateCount"] as? NSNumber)?.intValue ?? 0) · marker rects [\(summarized)] · target rects [\(targetSummary)] · frame visible targets \((data["afterFirstFrameVisibleRenderTargets"] as? NSNumber)?.intValue ?? 0)/\((data["afterSecondFrameVisibleRenderTargets"] as? NSNumber)?.intValue ?? 0) · center hit \((data["viewportCenterHit"] as? [String:Any])?["tag"] as? String ?? "none")"
    }
    @objc func inspectVisibleSessionRendering() {
        guard session.isVisible,web.window===session,session.contentView===web else {
            visibleSessionPresentationReport="visible render snapshot unavailable · session window or WebView is detached"
            updateRuntimeIdentity();return
        }
        let native=sessionPresentationSnapshot()
        web.evaluateJavaScript("window.gptSessionRenderSnapshot?.() || null") { [weak self] value,error in
            DispatchQueue.main.async {
                guard let self else{return}
                if error != nil || !(value is [String:Any]) {
                    self.visibleSessionPresentationReport="native [\(native)] · DOM snapshot unavailable"
                } else if let data=value as? [String:Any] {
                    self.visibleSessionPresentationReport="native [\(native)] · \(self.sessionRenderDOMSummary(data))"
                }
                self.updateRuntimeIdentity()
            }
        }
    }
    func recordConversationLayout(_ label:String,_ data:[String:Any],native:String) {
        sessionLayoutEvidence.append(["sample":label,"recordedAt":Date().timeIntervalSince1970,"native":native,"layout":data])
        if sessionLayoutEvidence.count>50 {sessionLayoutEvidence.removeFirst(sessionLayoutEvidence.count-50)}
        if let json=try? JSONSerialization.data(withJSONObject:sessionLayoutEvidence,options:[.prettyPrinted,.sortedKeys]) {
            try? json.write(to:URL(fileURLWithPath:"/private/tmp/GPTLimitsConversationLayout.json"),options:.atomic)
        }
        sessionLayoutOutput.stringValue="\(label) · candidates \((data["candidateCount"] as? NSNumber)?.intValue ?? 0) · actual text candidates \((data["actualTextLayoutCandidates"] as? NSNumber)?.intValue ?? 0) · text rects \((data["textRectCount"] as? NSNumber)?.intValue ?? 0) · viewport text rects \((data["viewportTextRectCount"] as? NSNumber)?.intValue ?? 0) · sanitized comparison saved locally"
    }
    func captureConversationLayout(_ label:String) {
        let native=sessionPresentationSnapshot()
        web.evaluateJavaScript("window.gptConversationLayoutSnapshot?.() || null") { [weak self] value,_ in
            guard let self else{return}
            if let data=value as? [String:Any] {self.recordConversationLayout(label,data,native:native)}
            else {self.sessionLayoutOutput.stringValue="\(label) · conversation layout snapshot unavailable"}
        }
    }
    @objc func captureConversationLayoutNow() {captureConversationLayout("manual_snapshot")}
    func restoreVisibleSessionPresentation() {
        guard backgroundRenderLease==nil,!cycleRunning else {
            visibleSessionPresentationPending=true
            visibleSessionPresentationReport="presentation queued until background operation ends"
            updateRuntimeIdentity()
            return
        }
        visibleSessionPresentationPending=false
        let before=sessionPresentationSnapshot()
        session.ignoresMouseEvents=false
        session.acceptsMouseMovedEvents=true
        session.alphaValue=1
        session.level = .normal
        web.alphaValue=1
        web.isHidden=false
        if session.frame.width<640 || session.frame.height<480 {
            session.setContentSize(NSSize(width:1100,height:760))
        }
        if session.contentView !== web { session.contentView=web }
        web.autoresizingMask=[.width,.height]
        web.frame=session.contentView?.bounds ?? NSRect(origin:.zero,size:session.contentLayoutRect.size)
        web.layoutSubtreeIfNeeded()
        _=presentWindow(session,intent:.userInitiated,callSite:"open_chatgpt_session")
        web.setNeedsDisplay(web.bounds)
        web.layer?.setNeedsDisplay()
        session.contentView?.setNeedsDisplay(session.contentView?.bounds ?? .zero)
        session.displayIfNeeded()
        web.displayIfNeeded()
        let paintGeneration=UUID().uuidString.lowercased()
        visibleSessionPaintWatchGeneration=paintGeneration
        visibleSessionPaintSyncGeneration=nil
        let encoded=String(data:try! JSONSerialization.data(withJSONObject:[paintGeneration]),encoding:.utf8)!
        let paintWatchScript="void window.gptWatchConversationPaint?.({timeoutMs:20000}).then(result=>window.webkit?.messageHandlers?.diagnostics?.postMessage({event:'session_paint_watch',generation:\(encoded)[0],result})).catch(()=>window.webkit?.messageHandlers?.diagnostics?.postMessage({event:'session_paint_watch',generation:\(encoded)[0],result:{status:'watch_error'}})); true;"
        web.evaluateJavaScript(paintWatchScript,completionHandler:nil)
        visibleSessionPresentationReport="before [\(before)] · after [\(sessionPresentationSnapshot())] · document state pending"
        updateRuntimeIdentity()
        if web.url?.host != "chatgpt.com" {
            web.load(URLRequest(url:URL(string:"https://chatgpt.com/")!))
        }
        web.evaluateJavaScript("window.gptSessionRenderSnapshot?.() || null") { [weak self] value,_ in
            guard let self else{return}
            let result=value as? [String:Any]
            self.visibleSessionPresentationReport="before [\(before)] · after [\(self.sessionPresentationSnapshot())] · \(result.map{self.sessionRenderDOMSummary($0)} ?? "DOM snapshot unavailable")"
            self.updateRuntimeIdentity()
        }
    }
    @objc func hideSession() { session.orderOut(nil) }
    @objc func testNotification() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound]) { [weak self] granted, error in
            guard granted, error == nil else {
                DispatchQueue.main.async { self?.notificationOutput.stringValue = "Native notifications unavailable — permission not granted." }
                return
            }
            let content = UNMutableNotificationContent()
            content.title = "GPT Limits Tool"
            content.body = "Native notifications are working."
            let request = UNNotificationRequest(identifier: "gpt-limits-native-test", content: content, trigger: nil)
            center.add(request) { error in
                DispatchQueue.main.async { self?.notificationOutput.stringValue = error == nil
                    ? "Native test notification submitted; verify banner or Notification Center."
                    : "Native test notification could not be submitted." }
            }
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list])
    }
    func userNotificationCenter(_ center:UNUserNotificationCenter,didReceive response:UNNotificationResponse,
                                withCompletionHandler completionHandler:@escaping ()->Void) {
        let routeValue=response.notification.request.content.userInfo["conversationRoute"] as? String
        DispatchQueue.main.async { [weak self] in
            defer {completionHandler()}
            guard let self,let routeValue,let safeRoute=validatedRiskNotificationRoute(routeValue),
                  let url=URL(string:"https://chatgpt.com\(safeRoute)"),url.host=="chatgpt.com" else{return}
            _=self.presentWindow(self.session,intent:.userInitiated,callSite:"risk_notification_click",onPresented:{[weak self] in
                self?.web.load(URLRequest(url:url))
            })
        }
    }

    @objc func beginNativeRescue() {
        nativeRescueStages=[];nativeRescueLaunchReason="none"
        recordNativeRescueStage("rescue_action_received")
        guard nativeRescueOperationID==nil else {rejectNativeRescueStart("rescue_already_running");return}
        let template=sessionRouteTemplate()
        guard web.url?.host=="chatgpt.com",template=="/c/<id>" || template=="/g/<id>/c/<id>" else {
            rejectNativeRescueStart("session_unavailable")
            return
        }
        let alert=NSAlert()
        alert.messageText="Rescue this conversation?"
        alert.informativeText="Rescue scrolls through the visible conversation to collect rendered messages. It can take time, and very long or changing conversations may finish as Partial. You can cancel. The page will try to restore its starting scroll position. HTML and TXT are saved locally only when you choose a location."
        alert.addButton(withTitle:"Start rescue");alert.addButton(withTitle:"Cancel")
        alert.beginSheetModal(for:mainWindow) { [weak self] response in
            guard let self else{return}
            guard response == .alertFirstButtonReturn else {self.rejectNativeRescueStart("user_cancelled");return}
            self.startNativeRescue()
        }
    }

    func recordNativeRescueStage(_ stage:String) {
        nativeRescueStages.append(stage)
        let timeline=nativeRescueStages.joined(separator:" → ")
        mainRescueStatusLabel?.stringValue="Rescue: \(stage)"
        nativeRescueOutput.stringValue="Native Rescue: \(stage) · stages [\(timeline)]"
    }
    func rejectNativeRescueStart(_ reason:String) {
        nativeRescueLaunchReason=reason
        mainRescueStatusLabel?.stringValue="Rescue: Unable to start · \(reason)"
        nativeRescueOutput.stringValue="Native Rescue: Unable to start · \(reason) · last stage \(nativeRescueStages.last ?? "none") · stages [\(nativeRescueStages.joined(separator:" → "))]"
    }
    func startNativeRescue() {
        guard nativeRescueOperationID==nil,let generation=nativeRescueOwnershipGate.begin() else{rejectNativeRescueStart("rescue_already_running");return}
        let operationID=generation.uuidString.lowercased()
        nativeRescueGeneration=generation;nativeRescueOperationID=operationID;nativeRescueHTML=nil;nativeRescueText=nil;nativeRescueCount=0;nativeRescueState="starting"
        nativeRescueLaunchReason="none"
        recordNativeRescueStage("rescue_operation_created")
        recordNativeRescueStage("rescue_generation_assigned")
        guard web.window === session,session.contentView === web,web.url?.host=="chatgpt.com",
              validatedRiskNotificationRoute(web.url?.path ?? "") != nil else {
            finishNativeRescueLocally(reason:"session_unavailable",generation:generation);return
        }
        recordNativeRescueStage("rescue_session_resolved")
        showNativeRescueProgress(operationID:operationID)
        mainRescueStatusLabel.stringValue="Rescue: Starting…"
        nativeRescueOutput.stringValue="Native Rescue: Starting… · stages [\(nativeRescueStages.joined(separator:" → "))]"
        let encodedOperationID:String
        do {let data=try JSONEncoder().encode(operationID);encodedOperationID=String(decoding:data,as:UTF8.self)}
        catch {finishNativeRescueLocally(reason:"operation_id_encoding_failed",generation:generation);return}
        recordNativeRescueStage("rescue_bridge_dispatch_started")
        nativeRescueStartupTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:3_000_000_000)
            guard let self,!Task.isCancelled,self.nativeRescueOperationID==operationID,self.nativeRescueGeneration==generation else{return}
            self.finishNativeRescueLocally(reason:"bridge_dispatch_timeout",generation:generation)
        }
        let script="(() => { const bridge=window.GptNativeRescue; if (!bridge) return 'bridge_missing'; if (typeof bridge.start !== 'function') return 'handler_missing'; const id=\(encodedOperationID); if (typeof id !== 'string') return 'operation_id_not_string'; if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return 'operation_id_invalid_format'; const result=bridge.start(id); return result === 'started' ? 'bridge_dispatch_accepted' : result; })()"
        web.evaluateJavaScript(script) { [weak self] value,error in
            DispatchQueue.main.async {
                guard let self,self.nativeRescueOperationID==operationID,self.nativeRescueGeneration==generation else{return}
                self.nativeRescueStartupTimeoutTask?.cancel();self.nativeRescueStartupTimeoutTask=nil
                let result=value as? String ?? ""
                if error != nil || result != "bridge_dispatch_accepted" {
                    self.finishNativeRescueLocally(reason:error == nil ? (result.isEmpty ? "bridge_result_invalid":result):"bridge_eval_failed",generation:generation)
                } else {
                    if !self.nativeRescueStages.contains("rescue_bridge_dispatch_accepted") {self.recordNativeRescueStage("rescue_bridge_dispatch_accepted")}
                    self.nativeRescueState="running"
                    self.mainRescueStatusLabel.stringValue="Rescue: capturing · 0 messages"
                }
            }
        }
    }

    func showNativeRescueProgress(operationID:String) {
        let progressPanel=NSPanel(contentRect:NSRect(x:0,y:0,width:380,height:150),styleMask:[.titled],backing:.buffered,defer:false)
        progressPanel.title="GPT Limits Tool — Rescue";progressPanel.isReleasedWhenClosed=false
        let label=uiLabel("Preparing conversation capture…")
        let progress=NSProgressIndicator();progress.style = .bar;progress.isIndeterminate=true;progress.startAnimation(nil)
        let cancel=button("Cancel rescue",#selector(cancelNativeRescue))
        let stack=NSStackView(views:[label,progress,cancel]);stack.orientation = .vertical;stack.alignment = .leading;stack.spacing=14;stack.translatesAutoresizingMaskIntoConstraints=false
        let content=NSView();content.addSubview(stack);progressPanel.contentView=content
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo:content.leadingAnchor,constant:20),stack.trailingAnchor.constraint(equalTo:content.trailingAnchor,constant:-20),stack.topAnchor.constraint(equalTo:content.topAnchor,constant:20),progress.widthAnchor.constraint(equalTo:stack.widthAnchor)])
        progressPanel.center()
        nativeRescueProgressPanel=progressPanel;nativeRescueProgressLabel=label;nativeRescueProgress=progress;nativeRescueCancelButton=cancel
        _=presentWindow(progressPanel,intent:.userInitiated,callSite:"native_rescue_progress",isStillValid:{[weak self] in self?.nativeRescueOperationID==operationID})
    }

    @objc func cancelNativeRescue() {
        guard let operationID=nativeRescueOperationID,let generation=nativeRescueGeneration else{return}
        nativeRescueState="cancelling";nativeRescueCancelButton?.isEnabled=false
        nativeRescueProgressLabel?.stringValue="Cancellation requested; restoring the starting scroll position…"
        mainRescueStatusLabel.stringValue="Rescue: cancelling…"
        web.evaluateJavaScript("window.GptNativeRescue?.cancel('\\(operationID)') || 'bridge_missing'") { [weak self] value,_ in
            DispatchQueue.main.async {
                guard let self,self.nativeRescueOperationID==operationID,self.nativeRescueGeneration==generation else{return}
                if (value as? String)=="bridge_missing" {self.finishNativeRescueLocally(reason:"bridge_missing",generation:generation)}
            }
        }
    }

    func handleNativeRescueMessage(_ data:[String:Any]) {
        guard let operationID=data["operationId"] as? String,operationID==nativeRescueOperationID,nativeRescueGeneration?.uuidString.lowercased()==operationID,
              let type=data["type"] as? String else{return}
        if type=="started" {
            nativeRescueStartupTimeoutTask?.cancel();nativeRescueStartupTimeoutTask=nil
            if !nativeRescueStages.contains("rescue_bridge_dispatch_accepted") {recordNativeRescueStage("rescue_bridge_dispatch_accepted")}
            recordNativeRescueStage("rescue_capture_started")
            nativeRescueState="running";nativeRescueProgressLabel?.stringValue="Capturing rendered messages…"
            mainRescueStatusLabel.stringValue="Rescue: capturing · \(nativeRescueCount) messages"
        } else if type=="progress" {
            nativeRescueCount=max(nativeRescueCount,(data["capturedUniqueMessages"] as? NSNumber)?.intValue ?? 0)
            let percent=(data["scrollPercent"] as? NSNumber)?.doubleValue ?? 0
            let step=(data["step"] as? NSNumber)?.intValue ?? 0
            let elapsed=(data["elapsedMs"] as? NSNumber)?.doubleValue ?? 0
            nativeRescueProgress?.isIndeterminate=false;nativeRescueProgress?.doubleValue=min(100,max(0,percent))
            nativeRescueProgressLabel?.stringValue="\(nativeRescueCount) unique messages · step \(step) · \(Int(elapsed/1000)) sec"
            mainRescueStatusLabel.stringValue="Rescue: \(Int(percent))% · \(nativeRescueCount) messages"
        } else if type=="finished" {
            let status=data["status"] as? String ?? "rescue_unsupported_layout"
            let complete=status=="rescue_complete",count=(data["messageCount"] as? NSNumber)?.intValue ?? nativeRescueCount
            let restore=(data["restoreSuccess"] as? Bool)==true
            nativeRescueCount=count;nativeRescueHTML=data["html"] as? String;nativeRescueText=data["text"] as? String;nativeRescueState=status
            let reason=data["reason"] as? String ?? "none"
            let summary=nativeRescueSummary(complete:complete,messageCount:count,reason:reason,scrollRestored:restore)
            nativeRescueOutput.stringValue="Native Rescue: \(summary)";mainRescueStatusLabel.stringValue="Rescue: \(summary)"
            nativeRescueProgressLabel?.stringValue=summary;nativeRescueProgress?.stopAnimation(nil);nativeRescueCancelButton?.isEnabled=false
            guard let generation=nativeRescueGeneration else{return}
            if count == 0 {
                let dom=data["domDiagnostics"] as? [String:Any] ?? [:]
                let number:([String:Any],String)->Int = { value,key in (value[key] as? NSNumber)?.intValue ?? 0 }
                let detail="DOM: ready \(dom["readyState"] as? String ?? "unknown") · main \(number(dom,"mainCount")) · article \(number(dom,"articleLikeCount")) · author-role \(number(dom,"explicitAuthorRoleCount")) · conversation-turn \(number(dom,"conversationTurnCount")) · role/aria \(number(dom,"roleAriaMetadataCount")) · visible candidates \(number(dom,"visibleTextBearingCandidateBlocks")) · validated \(number(dom,"validatedMessageCandidateCount"))"
                let mainShape=(dom["mainDirectChildShape"] as? [[String:Any]] ?? []).prefix(10).map { "\($0["tag"] as? String ?? "?")/classes:\(($0["classTokenCount"] as? NSNumber)?.intValue ?? 0)" }.joined(separator:", ")
                let attributes=(dom["semanticAttributeNames"] as? [String] ?? []).joined(separator:",")
                let candidates=(dom["semanticCandidateShape"] as? [[String:Any]] ?? []).prefix(10).map { item in
                    let tag=item["tag"] as? String ?? "?",classCount=(item["classTokenCount"] as? NSNumber)?.intValue ?? 0
                    let names=(item["attributes"] as? [String] ?? []).joined(separator:",")
                    return "\(tag)/classes:\(classCount)/attrs:\(names)/role:\(item["inferredRole"] as? String ?? "unknown")"
                }.joined(separator:"; ")
                let selectorCounts="Schema: data-testid \(number(dom,"dataTestIdCount")) · conversation-like testid \(number(dom,"conversationLikeTestIdCount")) · data-turn \(number(dom,"dataTurnCount")) · conversation-role \(number(dom,"dataConversationRoleCount")) · user-bubble \(number(dom,"userMessageBubbleCount")) · assistant-start \(number(dom,"assistantTurnStartCount")) · attrs [\(attributes)]"
                let context="Context: visible session WebView yes · main frame \((data["mainFrame"] as? Bool)==true ? "yes":"no") · ChatGPT document \((data["chatgptDocument"] as? Bool)==true ? "yes":"no")"
                finishNativeRescueLocally(reason:nil,generation:generation)
                let diagnostic="Native Rescue: Partial · 0 messages · \(reason) · scroll restore \(restore ? "yes":"no")\n\(context)\n\(detail)\n\(selectorCounts)\nMain children: \(mainShape.isEmpty ? "none":mainShape)\nCandidate shape: \(candidates.isEmpty ? "none":candidates) · no empty export saved"
                nativeRescueOutput.stringValue=diagnostic;mainRescueStatusLabel.stringValue=diagnostic
                return
            }
            saveNativeRescueExports(operationID:operationID,generation:generation,summary:summary)
        } else if type=="failed" {
            finishNativeRescueLocally(reason:data["reason"] as? String ?? "unexpected_ui_structure",generation:nativeRescueGeneration)
        }
    }

    func saveNativeRescueExports(operationID:String,generation:UUID,summary:String) {
        guard nativeRescueOperationID==operationID,nativeRescueGeneration==generation,let html=nativeRescueHTML,let text=nativeRescueText else {
            finishNativeRescueLocally(reason:"export_data_unavailable",generation:generation);return
        }
        let date=DateFormatter();date.dateFormat="yyyy-MM-dd-HHmm";let base="chat-rescue-\(date.string(from:Date()))"
        let htmlPanel=NSSavePanel();htmlPanel.allowedContentTypes=[.html];htmlPanel.nameFieldStringValue=base+".html";htmlPanel.canCreateDirectories=true
        htmlPanel.begin { [weak self] response in
            guard let self,self.nativeRescueOperationID==operationID,self.nativeRescueGeneration==generation else{return}
            guard response == .OK,let url=htmlPanel.url else{self.finishNativeRescueLocally(reason:"export_cancelled",generation:generation);return}
            do {try Data(html.utf8).write(to:url,options:.atomic)} catch {self.finishNativeRescueLocally(reason:"html_export_failed",generation:generation);return}
            let textPanel=NSSavePanel();textPanel.allowedContentTypes=[.plainText];textPanel.nameFieldStringValue=base+".txt";textPanel.canCreateDirectories=true
            textPanel.begin { [weak self] textResponse in
                guard let self,self.nativeRescueOperationID==operationID,self.nativeRescueGeneration==generation else{return}
                if textResponse == .OK,let textURL=textPanel.url {
                    do {try Data(text.utf8).write(to:textURL,options:.atomic)} catch {self.finishNativeRescueLocally(reason:"txt_export_failed",generation:generation);return}
                }
                self.nativeRescueOutput.stringValue=nativeRescueSavedStatus(summary:summary,textSaved:textResponse == .OK)
                self.mainRescueStatusLabel.stringValue=self.nativeRescueOutput.stringValue
                self.finishNativeRescueLocally(reason:nil,generation:generation)
            }
        }
    }

    func finishNativeRescueLocally(reason:String?,generation:UUID?=nil) {
        guard let owner=generation ?? nativeRescueGeneration,nativeRescueOwnershipGate.owns(owner),nativeRescueGeneration==owner else{return}
        nativeRescueStartupTimeoutTask?.cancel();nativeRescueStartupTimeoutTask=nil
        if let reason {nativeRescueState=reason;nativeRescueLaunchReason=reason;nativeRescueOutput.stringValue="Native Rescue: \(reason) · last stage \(nativeRescueStages.last ?? "none") · stages [\(nativeRescueStages.joined(separator:" → "))]";mainRescueStatusLabel.stringValue="Rescue: \(reason)"}
        nativeRescueProgress?.stopAnimation(nil);nativeRescueProgressPanel?.orderOut(nil)
        nativeRescueProgressPanel=nil;nativeRescueProgressLabel=nil;nativeRescueProgress=nil;nativeRescueCancelButton=nil
        guard nativeRescueOwnershipGate.finish(owner) else{return}
        nativeRescueOperationID=nil;nativeRescueGeneration=nil;nativeRescueHTML=nil;nativeRescueText=nil;mainRescueButton?.isEnabled=true
    }
    @objc func toggleRiskNotificationTitles(_ sender:NSButton) {
        UserDefaults.standard.set(sender.state == .on,forKey:showChatTitlesInNotificationsDefaultsKey)
        renderUserUI()
    }
    func recentRecords() -> [[String: Any]] {
        let now = Date().timeIntervalSince1970 * 1000
        return discovered.values.filter { r in
            guard let time = r["updatedAt"] as? Double else { return false }
            return time >= now - 6 * 3600000 && time <= now
        }.sorted { ($0["updatedAt"] as? Double ?? 0) > ($1["updatedAt"] as? Double ?? 0) }
    }
    @objc func refreshRecent() {
        guard !cycleRunning,backgroundRenderLease==nil else {return}
        listOutput.stringValue = "Refreshing recent chats through ChatGPT home…"
        let owner="refresh-recent-\(UUID().uuidString)"
        Task { @MainActor [weak self] in
            guard let self else{return}
            do {
                try await self.withBackgroundRenderSurface(owner:owner) {
                    self.web.load(URLRequest(url:URL(string:"https://chatgpt.com/")!))
                    try await Task.sleep(nanoseconds:8_000_000_000)
                }
                self.listOutput.stringValue="Recent chats refreshed · \(self.discovered.count) conversations seen · render lease cleanup completed."
            } catch {
                self.listOutput.stringValue="Recent chat refresh unavailable · \(self.backgroundRenderLeaseReport)"
            }
        }
    }
    @objc func diagnoseVisibleHome(){startListDiagnostic(visible:true)}
    @objc func diagnoseHiddenHome(){startListDiagnostic(visible:false)}
    @objc func inspectRecentChatListTraffic(){startListDiagnostic(visible:false,inspectRecentTraffic:true)}
    @objc func diagnoseStarredControl() {
        guard !cycleRunning else {starredDiagnosticOutput.stringValue="Starred UI diagnostic unavailable while a cycle is running.";return}
        guard web.url?.host == "chatgpt.com" else {starredDiagnosticOutput.stringValue="Diagnostic hook available: No · current target is not the ChatGPT session page.";return}
        starredDiagnosticOutput.stringValue="Starred UI diagnostic: checking hook in authenticated ChatGPT WKWebView."
        // The status panel has no WKWebView. This handshake and command both target
        // `web`, the same persistent authenticated instance used by passive capture.
        web.evaluateJavaScript("typeof window.gptRunPinnedSidebarDiagnostic === 'function'") { [weak self] value,error in
            DispatchQueue.main.async {
                guard let self else{return}
                guard error == nil else {self.starredDiagnosticOutput.stringValue="Diagnostic hook handshake failed safely.";return}
                guard (value as? Bool)==true else {self.starredDiagnosticOutput.stringValue="Diagnostic hook available: No · hook_missing on current page.";return}
                self.starredDiagnosticOutput.stringValue="Diagnostic hook available: Yes · running one isolated test…"
                let invocation="""
                void window.gptRunPinnedSidebarDiagnostic().then(result => {
                  window.webkit.messageHandlers.starredDiagnostic.postMessage({result});
                }).catch(() => {
                  window.webkit.messageHandlers.starredDiagnostic.postMessage({error:'hook_execution_failed'});
                }); true;
                """
                self.web.evaluateJavaScript(invocation) { _,invokeError in
                    if invokeError != nil {DispatchQueue.main.async {self.starredDiagnosticOutput.stringValue="Diagnostic hook available: Yes · command delivery failed safely."}}
                }
            }
        }
    }
    @objc func diagnoseTopChatPinStatus() {
        guard !cycleRunning else {starredDiagnosticOutput.stringValue="Pin-status diagnostic unavailable while a cycle is running.";return}
        guard web.url?.host == "chatgpt.com" else {starredDiagnosticOutput.stringValue="Pin-status diagnostic unavailable · ChatGPT session page is not active.";return}
        pinDiagnosticTimeoutTask?.cancel()
        let runID=UUID();pinDiagnosticRunID=runID;pinDiagnosticRows=[:];pinDiagnosticRowsAttempted=0;pinDiagnosticRowsCompleted=0;pinDiagnosticCurrentRow=nil;pinDiagnosticStage="starting";pinDiagnosticMenuLeftOpen=false
        updateRuntimeIdentity()
        starredDiagnosticOutput.stringValue="Pin-status diagnostic v\(pinnedDiagnosticVersion) · starting on visible ChatGPT sidebar · max 3 rows."
        pinDiagnosticTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:10_000_000_000)
            guard let self,self.pinDiagnosticRunID==runID else{return}
            _ = try? await self.web.evaluateJavaScript("window.gptCancelTopChatPinStatus?.()")
            self.finishPinDiagnosticTimeout()
        }
        web.evaluateJavaScript("window.pinnedDiagnosticVersion || null") { [weak self] value,error in
            DispatchQueue.main.async {
                guard let self else{return}
                guard self.pinDiagnosticRunID==runID else{return}
                guard error == nil,(value as? String)==self.pinnedDiagnosticVersion else {self.finishPinDiagnostic("Pin-status diagnostic unavailable · hook version mismatch or missing.");return}
                let invocation="""
                void window.gptInspectTopChatPinStatus({maxRows:3,hardTimeoutMs:8500}).then(result => {
                  window.webkit.messageHandlers.starredDiagnostic.postMessage({topChatPinResult:result});
                }).catch(() => {
                  window.webkit.messageHandlers.starredDiagnostic.postMessage({error:'top_chat_pin_diagnostic_failed'});
                }); true;
                """
                self.web.evaluateJavaScript(invocation) { _,invokeError in
                    if invokeError != nil {DispatchQueue.main.async {self.finishPinDiagnostic("Pin-status diagnostic failed safely · command delivery error.")}}
                }
            }
        }
    }
    @objc func diagnoseFirstRowMenuTrigger() {
        guard !cycleRunning else {setLastIsolatedDiagnostic("Last isolated diagnostic: unavailable · a cycle is running.");return}
        guard web.url?.host == "chatgpt.com" else {setLastIsolatedDiagnostic("Last isolated diagnostic: unavailable · ChatGPT session page is not active.");return}
        pinDiagnosticTimeoutTask?.cancel()
        let runID=UUID();pinDiagnosticRunID=runID
        updateRuntimeIdentity()
        setLastIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · inspecting first confirmed conversation row.")
        pinDiagnosticTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:10_000_000_000)
            guard let self,self.pinDiagnosticRunID==runID else{return}
            self.finishIsolatedDiagnostic("Last isolated diagnostic: v\(self.pinnedDiagnosticVersion) · stopped at the 10 s safety deadline.")
        }
        DispatchQueue.main.asyncAfter(deadline:.now()+0.3) { [weak self] in
            guard let self,self.pinDiagnosticRunID==runID else{return}
            self.web.evaluateJavaScript("window.pinnedDiagnosticVersion || null") { value,error in
                DispatchQueue.main.async {
                    guard self.pinDiagnosticRunID==runID else{return}
                    guard error == nil,(value as? String)==self.pinnedDiagnosticVersion else {self.finishIsolatedDiagnostic("Last isolated diagnostic: unavailable · hook version mismatch or missing.");return}
                    let invocation="""
                    void window.gptInspectFirstRowMenuTrigger().then(result => {
                      window.webkit.messageHandlers.starredDiagnostic.postMessage({firstRowMenuResult:result});
                    }).catch(() => {
                      window.webkit.messageHandlers.starredDiagnostic.postMessage({firstRowMenuError:'first_row_menu_diagnostic_failed'});
                    }); true;
                    """
                    self.web.evaluateJavaScript(invocation) { _,invokeError in
                        if invokeError != nil {DispatchQueue.main.async {self.finishIsolatedDiagnostic("Last isolated diagnostic: failed safely · command delivery error.")}}
                    }
                }
            }
        }
    }
    @objc func diagnoseSidebarTopPosition() {
        guard !cycleRunning else {storeSidebarDiagnosticFailure("cycle_running");setLastIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · unavailable · a cycle is running.");return}
        guard web.url?.host == "chatgpt.com" else {storeSidebarDiagnosticFailure("chatgpt_session_not_active");setLastIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · unavailable · ChatGPT session page is not active.");return}
        pinDiagnosticTimeoutTask?.cancel();let runID=UUID();pinDiagnosticRunID=runID
        updateRuntimeIdentity()
        setLastIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · measuring sidebar top position.")
        pinDiagnosticTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:8_000_000_000)
            guard let self,self.pinDiagnosticRunID==runID else{return}
            self.finishIsolatedDiagnostic("Last isolated diagnostic: v\(self.pinnedDiagnosticVersion) · unavailable · diagnostic timed out.")
        }
        web.evaluateJavaScript("window.pinnedDiagnosticVersion || null") { [weak self] value,error in
            DispatchQueue.main.async { guard let self,self.pinDiagnosticRunID==runID else{return}
                guard error==nil,(value as? String)==self.pinnedDiagnosticVersion else {self.finishIsolatedDiagnostic("Last isolated diagnostic: unavailable · hook version mismatch or missing.");return}
                let script="void window.gptInspectSidebarTopPosition?.().then(result=>window.webkit.messageHandlers.starredDiagnostic.postMessage({sidebarTopPositionResult:result})).catch(()=>window.webkit.messageHandlers.starredDiagnostic.postMessage({sidebarTopPositionError:'failed'})); true;"
                self.web.evaluateJavaScript(script) { _,invokeError in if invokeError != nil {DispatchQueue.main.async {self.finishSidebarDiagnosticFailure("command_delivery_failed","Last isolated diagnostic: v\(self.pinnedDiagnosticVersion) · failed safely · command delivery error.")}} }
            }
        }
    }
    @objc func diagnoseRootSidebarScroll() {
        guard !cycleRunning else {starredDiagnosticOutput.stringValue="Root sidebar scroll diagnostic unavailable while a cycle is running.";return}
        guard manualDiagnosticOwnerLabel()==nil else {starredDiagnosticOutput.stringValue="Root sidebar scroll diagnostic unavailable · another diagnostic is active.";return}
        guard web.url?.host=="chatgpt.com" else {starredDiagnosticOutput.stringValue="Root sidebar scroll diagnostic unavailable · ChatGPT session page is not active.";return}
        pinDiagnosticTimeoutTask?.cancel();let runID=UUID();pinDiagnosticRunID=runID
        starredDiagnosticOutput.stringValue="Root sidebar scroll diagnostic: traversing the current sidebar once; scroll will be restored."
        updateRuntimeIdentity()
        pinDiagnosticTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:12_000_000_000)
            guard let self,self.pinDiagnosticRunID==runID else{return}
            self.finishIsolatedDiagnostic("Last isolated diagnostic: v\(self.pinnedDiagnosticVersion) · root sidebar scroll traversal timed out safely.")
        }
        let token=runID.uuidString
        let encoded=(try? JSONSerialization.data(withJSONObject:[token])).flatMap{String(data:$0,encoding:.utf8)} ?? "[]"
        web.evaluateJavaScript("window.pinnedDiagnosticVersion || null") { [weak self] value,error in
            DispatchQueue.main.async { guard let self,self.pinDiagnosticRunID==runID else{return}
                guard error==nil,(value as? String)==self.pinnedDiagnosticVersion else {self.finishIsolatedDiagnostic("Last isolated diagnostic: unavailable · hook version mismatch or missing.");return}
                let script="void window.gptDiagnoseRootSidebarScroll?.({operationToken:\(encoded)[0],maxSteps:8,settleMs:250}).then(result=>window.webkit.messageHandlers.starredDiagnostic.postMessage({rootSidebarScrollResult:result})).catch(()=>window.webkit.messageHandlers.starredDiagnostic.postMessage({rootSidebarScrollError:\(encoded)[0]})); true;"
                self.web.evaluateJavaScript(script) { _,invokeError in if invokeError != nil {DispatchQueue.main.async {self.finishIsolatedDiagnostic("Last isolated diagnostic: v\(self.pinnedDiagnosticVersion) · root sidebar scroll command failed safely.")}} }
            }
        }
    }
    @objc func inspectSidebarScrollMechanics() {
        guard !cycleRunning else {setLastIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · unavailable · a cycle is running.");return}
        guard manualDiagnosticOwnerLabel()==nil else {setLastIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · unavailable · another diagnostic is active.");return}
        guard web.url?.host=="chatgpt.com" else {setLastIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · unavailable · ChatGPT session page is not active.");return}
        pinDiagnosticTimeoutTask?.cancel();let runID=UUID();pinDiagnosticRunID=runID
        sidebarScrollDiagnosticStartedAt=Date();sidebarScrollDiagnosticLastStage="native_started";sidebarScrollDiagnosticStageEvents=[];sidebarScrollDiagnosticPartial="no_result"
        sidebarScrollDiagnosticNativeGuardFired=false
        sidebarScrollReadinessScheduledCount=0;sidebarScrollReadinessStartedCount=0;sidebarScrollReadinessEvaluateCalledCount=0;sidebarScrollReadinessCallbackCount=0;sidebarScrollReadinessParsedCount=0;sidebarScrollReadinessLastCompletedPollIndex=0;sidebarScrollReadinessCurrentPollIndex=nil;sidebarScrollReadinessInFlight=false;sidebarScrollReadinessMaxCallbackLatencyMs=0;sidebarScrollReadinessTimeline=[];sidebarScrollReadinessMaxEventGapMs=0;sidebarScrollReadinessMaxEventGapFrom="none";sidebarScrollReadinessMaxEventGapTo="none"
        recordSidebarScrollDiagnosticStage("native_started",partial:"no_result")
        setLastIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · reading sidebar scroll structure; one 1 px probe only if a unique mechanism is found.")
        pinDiagnosticTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:7_000_000_000)
            guard let self,self.pinDiagnosticRunID==runID else{return}
            self.sidebarScrollDiagnosticNativeGuardFired=true
            let events=self.sidebarScrollDiagnosticStageEvents.suffix(12).joined(separator:" → ")
            let lifecycle="scheduled/started/evaluate/callback/parsed \(self.sidebarScrollReadinessScheduledCount)/\(self.sidebarScrollReadinessStartedCount)/\(self.sidebarScrollReadinessEvaluateCalledCount)/\(self.sidebarScrollReadinessCallbackCount)/\(self.sidebarScrollReadinessParsedCount) · in flight \(self.sidebarScrollReadinessInFlight ? "yes":"no") · last completed poll \(self.sidebarScrollReadinessLastCompletedPollIndex) · max callback latency \(self.sidebarScrollReadinessMaxCallbackLatencyMs)ms · timeline \(self.sidebarScrollReadinessTimeline.joined(separator:" | "))"
            self.finishIsolatedDiagnostic("Last isolated diagnostic: v\(self.pinnedDiagnosticVersion) · timeout:\(self.sidebarScrollDiagnosticLastStage) · native emergency guard fired yes · readiness polls \(self.sidebarScrollReadinessPollCount) · partial \(self.sidebarScrollDiagnosticPartial) · stages \(events.isEmpty ? "none":events) · \(lifecycle) · cleanup not required")
        }
        web.evaluateJavaScript("window.pinnedDiagnosticVersion || null") { [weak self] value,error in
            DispatchQueue.main.async { guard let self,self.pinDiagnosticRunID==runID else{return}
                guard error==nil,(value as? String)==self.pinnedDiagnosticVersion else {self.finishIsolatedDiagnostic("Last isolated diagnostic: unavailable · hook version mismatch or missing.");return}
                self.recordSidebarScrollDiagnosticStage("native_configured",partial:"hook_version_ok")
                self.startSidebarScrollReadiness(runID:runID)
            }
        }
    }
    func startSidebarScrollReadiness(runID:UUID) {
        sidebarScrollReadinessStartedAt=Date();sidebarScrollReadinessStartUptime=DispatchTime.now().uptimeNanoseconds
        sidebarScrollReadinessPollCount=0;sidebarScrollReadinessFirstPollMs=nil;sidebarScrollReadinessLastPollMs=nil
        sidebarScrollReadinessFirstPositiveCount=0;sidebarScrollReadinessFirstPositiveUptime=nil;sidebarScrollReadinessStablePolls=0
        sidebarScrollReadinessLastChangeUptime=sidebarScrollReadinessStartUptime;sidebarScrollReadinessLastSemanticChangeUptime=nil;sidebarScrollReadinessHadSemanticChange=false
        sidebarScrollReadinessGraceActivated=false;sidebarScrollReadinessGraceDeadlineUptime=nil;sidebarScrollReadinessLastSample=[:]
        sidebarScrollReadinessPreviousSample=nil;sidebarScrollReadinessSamples=[];sidebarScrollReadinessLastComparison="not_started"
        sidebarScrollReadinessScheduledCount=0;sidebarScrollReadinessStartedCount=0;sidebarScrollReadinessEvaluateCalledCount=0
        sidebarScrollReadinessCallbackCount=0;sidebarScrollReadinessParsedCount=0;sidebarScrollReadinessLastCompletedPollIndex=0
        sidebarScrollReadinessCurrentPollIndex=nil;sidebarScrollReadinessCurrentEvaluateUptime=0;sidebarScrollReadinessInFlight=false
        sidebarScrollReadinessMaxCallbackLatencyMs=0;sidebarScrollReadinessTimeline=[]
        sidebarScrollReadinessLastEventUptime=sidebarScrollReadinessStartUptime;sidebarScrollReadinessLastEventName="native_readiness_started"
        sidebarScrollReadinessMaxEventGapMs=0;sidebarScrollReadinessMaxEventGapFrom="none";sidebarScrollReadinessMaxEventGapTo="none"
        recordSidebarScrollDiagnosticStage("native_readiness_started",partial:"phase A 4000ms · stabilization grace 1200ms · absolute cap 6000ms")
        sidebarScrollReadinessTimeoutTask?.cancel()
        let started=sidebarScrollReadinessStartUptime
        sidebarScrollReadinessTimeoutTask=Task { @MainActor [weak self] in
            guard let self else{return}
            try? await Task.sleep(nanoseconds:self.sidebarScrollReadinessPhaseABudgetNs)
            guard self.pinDiagnosticRunID==runID else{return}
            if let terminal=self.advanceSidebarScrollReadinessPhase(now:DispatchTime.now().uptimeNanoseconds,startedUptime:started) {
                self.finishSidebarScrollReadiness(runID:runID,reason:terminal,startedUptime:started);return
            }
            while self.pinDiagnosticRunID==runID {
                let deadline=self.sidebarScrollReadinessCurrentDeadline(startedUptime:started)
                let current=DispatchTime.now().uptimeNanoseconds
                if current>=deadline {
                    if let terminal=self.advanceSidebarScrollReadinessPhase(now:current,startedUptime:started) {
                        self.finishSidebarScrollReadiness(runID:runID,reason:terminal,startedUptime:started);return
                    }
                } else {try? await Task.sleep(nanoseconds:deadline-current)}
            }
        }
        requestSidebarScrollReadinessPoll(runID:runID,startedUptime:started)
    }
    func recordSidebarReadinessPollEvent(_ event:String,poll:Int,uptime:UInt64,startedUptime:UInt64,callbackLatencyMs:Int?=nil,mainThread:Bool=Thread.isMainThread) {
        let elapsed=Int((uptime>=startedUptime ? uptime-startedUptime:0)/1_000_000)
        let gapMs=Int((uptime>=sidebarScrollReadinessLastEventUptime ? uptime-sidebarScrollReadinessLastEventUptime:0)/1_000_000)
        if gapMs>sidebarScrollReadinessMaxEventGapMs {sidebarScrollReadinessMaxEventGapMs=gapMs;sidebarScrollReadinessMaxEventGapFrom=sidebarScrollReadinessLastEventName;sidebarScrollReadinessMaxEventGapTo=event}
        let line="#\(poll) \(event) @\(elapsed)ms · callback \(callbackLatencyMs.map(String.init) ?? "—")ms · main \(mainThread ? "yes":"no") · in_flight \(sidebarScrollReadinessInFlight ? "yes":"no")"
        sidebarScrollReadinessTimeline.append(line)
        if sidebarScrollReadinessTimeline.count>280 {sidebarScrollReadinessTimeline.removeFirst(sidebarScrollReadinessTimeline.count-280)}
        sidebarScrollReadinessLastEventUptime=uptime;sidebarScrollReadinessLastEventName=event
    }
    func requestSidebarScrollReadinessPoll(runID:UUID,startedUptime:UInt64,delayNanoseconds:UInt64=0,isNext:Bool=false) {
        guard pinDiagnosticRunID==runID else{return}
        let now=DispatchTime.now().uptimeNanoseconds
        if let terminal=advanceSidebarScrollReadinessPhase(now:now,startedUptime:startedUptime) {finishSidebarScrollReadiness(runID:runID,reason:terminal,startedUptime:startedUptime);return}
        if now>=sidebarScrollReadinessCurrentDeadline(startedUptime:startedUptime) {finishSidebarScrollReadiness(runID:runID,reason:nil,startedUptime:startedUptime);return}
        if sidebarScrollReadinessInFlight {
            let index=sidebarScrollReadinessScheduledCount+1
            recordSidebarReadinessPollEvent("schedule_blocked_previous_in_flight",poll:index,uptime:now,startedUptime:startedUptime)
            return
        }
        sidebarScrollReadinessScheduledCount+=1
        let index=sidebarScrollReadinessScheduledCount
        recordSidebarReadinessPollEvent("poll_scheduled",poll:index,uptime:now,startedUptime:startedUptime)
        if isNext {recordSidebarReadinessPollEvent("next_poll_scheduled",poll:index,uptime:now,startedUptime:startedUptime)}
        if delayNanoseconds>0 {
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds:delayNanoseconds)
                guard let self,self.pinDiagnosticRunID==runID else{return}
                let now=DispatchTime.now().uptimeNanoseconds
                if let terminal=self.advanceSidebarScrollReadinessPhase(now:now,startedUptime:startedUptime) {self.finishSidebarScrollReadiness(runID:runID,reason:terminal,startedUptime:startedUptime)}
                else if now>=self.sidebarScrollReadinessCurrentDeadline(startedUptime:startedUptime) {self.finishSidebarScrollReadiness(runID:runID,reason:nil,startedUptime:startedUptime)}
                else {self.startSidebarScrollReadinessPoll(runID:runID,startedUptime:startedUptime,pollIndex:index)}
            }
        } else {startSidebarScrollReadinessPoll(runID:runID,startedUptime:startedUptime,pollIndex:index)}
    }
    func startSidebarScrollReadinessPoll(runID:UUID,startedUptime:UInt64,pollIndex:Int) {
        guard pinDiagnosticRunID==runID else{return}
        let now=DispatchTime.now().uptimeNanoseconds
        if let terminal=advanceSidebarScrollReadinessPhase(now:now,startedUptime:startedUptime) {finishSidebarScrollReadiness(runID:runID,reason:terminal,startedUptime:startedUptime);return}
        if now>=sidebarScrollReadinessCurrentDeadline(startedUptime:startedUptime) {finishSidebarScrollReadiness(runID:runID,reason:nil,startedUptime:startedUptime);return}
        sidebarScrollReadinessStartedCount+=1;sidebarScrollReadinessCurrentPollIndex=pollIndex
        recordSidebarReadinessPollEvent("poll_started_native",poll:pollIndex,uptime:now,startedUptime:startedUptime)
        let token=runID.uuidString
        sidebarScrollReadinessEvaluateCalledCount+=1;sidebarScrollReadinessCurrentEvaluateUptime=DispatchTime.now().uptimeNanoseconds;sidebarScrollReadinessInFlight=true
        recordSidebarReadinessPollEvent("evaluate_js_called",poll:pollIndex,uptime:sidebarScrollReadinessCurrentEvaluateUptime,startedUptime:startedUptime)
        let evaluateUptime=sidebarScrollReadinessCurrentEvaluateUptime
        web.evaluateJavaScript("window.gptSampleSidebarScrollReadiness?.({operationToken:'\(token)'}) || null") { [weak self] value,error in
            let callbackUptime=DispatchTime.now().uptimeNanoseconds,callbackLatency=Int((callbackUptime>=evaluateUptime ? callbackUptime-evaluateUptime:0)/1_000_000),callbackMain=Thread.isMainThread
            DispatchQueue.main.async { guard let self,self.pinDiagnosticRunID==runID else{return}
                self.sidebarScrollReadinessCallbackCount+=1
                self.sidebarScrollReadinessMaxCallbackLatencyMs=max(self.sidebarScrollReadinessMaxCallbackLatencyMs,callbackLatency)
                self.recordSidebarReadinessPollEvent("evaluate_js_callback_received",poll:pollIndex,uptime:callbackUptime,startedUptime:startedUptime,callbackLatencyMs:callbackLatency,mainThread:callbackMain)
                let sample=value as? [String:Any] ?? [:]
                self.sidebarScrollReadinessParsedCount+=1
                self.recordSidebarReadinessPollEvent("sample_parsed",poll:pollIndex,uptime:DispatchTime.now().uptimeNanoseconds,startedUptime:startedUptime,callbackLatencyMs:callbackLatency)
                self.sidebarScrollReadinessInFlight=false
                guard error==nil,!sample.isEmpty else {self.finishSidebarScrollReadiness(runID:runID,reason:"sample_failed",startedUptime:startedUptime);return}
                self.sidebarScrollReadinessLastCompletedPollIndex=pollIndex
                self.processSidebarScrollReadinessSample(sample,runID:runID,startedUptime:startedUptime)
            }
        }
    }
    func sidebarScrollReadinessPhaseADeadline(startedUptime:UInt64)->UInt64 {startedUptime+sidebarScrollReadinessPhaseABudgetNs}
    func sidebarScrollReadinessAbsoluteDeadline(startedUptime:UInt64)->UInt64 {startedUptime+sidebarScrollReadinessAbsoluteBudgetNs}
    func advanceSidebarScrollReadinessPhase(now:UInt64,startedUptime:UInt64)->String? {
        guard now>=sidebarScrollReadinessPhaseADeadline(startedUptime:startedUptime) else{return nil}
        if sidebarScrollReadinessAcceptance(now:now).accepted {return "snapshot_ready"}
        guard sidebarScrollReadinessFirstPositiveCount>0 else{return "rows_never_appeared"}
        guard sidebarScrollReadinessHadSemanticChange else{return "rows_appeared_but_never_stabilized"}
        activateSidebarScrollReadinessGrace(now:now,startedUptime:startedUptime)
        return now>=sidebarScrollReadinessCurrentDeadline(startedUptime:startedUptime) ? "rows_appeared_but_never_stabilized":nil
    }
    func sidebarScrollReadinessCurrentDeadline(startedUptime:UInt64)->UInt64 {
        if sidebarScrollReadinessGraceActivated {return min(sidebarScrollReadinessGraceDeadlineUptime ?? sidebarScrollReadinessAbsoluteDeadline(startedUptime:startedUptime),sidebarScrollReadinessAbsoluteDeadline(startedUptime:startedUptime))}
        return sidebarScrollReadinessPhaseADeadline(startedUptime:startedUptime)
    }
    func activateSidebarScrollReadinessGrace(now:UInt64,startedUptime:UInt64) {
        guard !sidebarScrollReadinessGraceActivated,sidebarScrollReadinessFirstPositiveCount>0,sidebarScrollReadinessHadSemanticChange else{return}
        sidebarScrollReadinessGraceActivated=true
        let lastChange=sidebarScrollReadinessLastSemanticChangeUptime ?? now
        let graceBase=max(sidebarScrollReadinessPhaseADeadline(startedUptime:startedUptime),lastChange)
        sidebarScrollReadinessGraceDeadlineUptime=min(graceBase+sidebarScrollReadinessGraceBudgetNs,sidebarScrollReadinessAbsoluteDeadline(startedUptime:startedUptime))
        recordSidebarScrollDiagnosticStage("readiness_grace_activated",partial:"last semantic change; bounded deadline")
    }
    func sidebarScrollReadinessAcceptance(now:UInt64)->(accepted:Bool,stableElapsedMs:Int,countCondition:Bool,durationCondition:Bool) {
        let last=sidebarScrollReadinessLastSample
        let rows=(last["rowCount"] as? NSNumber)?.intValue ?? 0
        let identities=(last["identityCount"] as? NSNumber)?.intValue ?? 0
        let duplicates=(last["duplicateIdentityCount"] as? NSNumber)?.intValue ?? 0
        let missing=(last["missingIdentityCount"] as? NSNumber)?.intValue ?? max(0,rows-identities)
        let root=(last["sidebarRootPresent"] as? Bool)==true
        let context=last["context"] as? String ?? "unknown"
        let elapsedNs=now>=sidebarScrollReadinessLastChangeUptime ? now-sidebarScrollReadinessLastChangeUptime:0
        let elapsedMs=Int(elapsedNs/1_000_000)
        let countCondition=sidebarScrollReadinessStablePolls>=4
        let durationCondition=elapsedNs>=320_000_000
        let accepted=sidebarScrollReadinessFirstPositiveCount>0 && rows>0 && duplicates==0 && missing==0 && root && context=="chatgpt.com" && countCondition && durationCondition
        return (accepted,elapsedMs,countCondition,durationCondition)
    }
    func processSidebarScrollReadinessSample(_ sample:[String:Any],runID:UUID,startedUptime:UInt64) {
        guard pinDiagnosticRunID==runID else{return}
        let now=DispatchTime.now().uptimeNanoseconds,elapsedMs=Int((now-startedUptime)/1_000_000)
        sidebarScrollReadinessPollCount+=1
        if sidebarScrollReadinessFirstPollMs==nil {sidebarScrollReadinessFirstPollMs=elapsedMs}
        sidebarScrollReadinessLastPollMs=elapsedMs;sidebarScrollReadinessLastSample=sample
        let rows=(sample["rowCount"] as? NSNumber)?.intValue ?? 0,identities=(sample["identityCount"] as? NSNumber)?.intValue ?? 0
        let root=(sample["sidebarRootPresent"] as? Bool)==true,context=sample["context"] as? String ?? "unknown"
        let duplicates=(sample["duplicateIdentityCount"] as? NSNumber)?.intValue ?? 0,missing=(sample["missingIdentityCount"] as? NSNumber)?.intValue ?? max(0,rows-identities)
        var comparisonReasons=[String]()
        if let previous=sidebarScrollReadinessPreviousSample {
            let previousRows=(previous["rowCount"] as? NSNumber)?.intValue ?? 0
            let previousRoot=(previous["sidebarRootPresent"] as? Bool)==true
            if rows != previousRows {comparisonReasons.append("row_count_changed")}
            if (sample["identitySetChanged"] as? Bool)==true {comparisonReasons.append("identity_set_changed")}
            if (sample["identityOrderChanged"] as? Bool)==true {comparisonReasons.append("identity_order_changed")}
            if root != previousRoot || (sample["rootChanged"] as? Bool)==true {comparisonReasons.append("root_changed")}
        } else {comparisonReasons.append("initial_sample")}
        if duplicates>0 {comparisonReasons.append("duplicate_identity")}
        if missing>0 {comparisonReasons.append("identity_missing")}
        let semanticStable=comparisonReasons.isEmpty
        let comparison=semanticStable ? "stable" : comparisonReasons.joined(separator:",")
        let semanticChange=comparisonReasons.contains("row_count_changed") || comparisonReasons.contains("identity_set_changed") || comparisonReasons.contains("identity_order_changed") || comparisonReasons.contains("root_changed")
        if semanticChange {sidebarScrollReadinessHadSemanticChange=true;sidebarScrollReadinessLastSemanticChangeUptime=now}
        if rows>0 {
            if sidebarScrollReadinessFirstPositiveUptime==nil {sidebarScrollReadinessFirstPositiveUptime=now}
            sidebarScrollReadinessFirstPositiveCount=max(sidebarScrollReadinessFirstPositiveCount,rows)
            if duplicates>0 || missing>0 {sidebarScrollReadinessStablePolls=0;sidebarScrollReadinessLastChangeUptime=now}
            else if semanticStable {sidebarScrollReadinessStablePolls+=1}
            else {sidebarScrollReadinessStablePolls=1;sidebarScrollReadinessLastChangeUptime=now}
        } else {sidebarScrollReadinessStablePolls=0;sidebarScrollReadinessLastChangeUptime=now}
        if semanticChange,sidebarScrollReadinessGraceActivated {
            sidebarScrollReadinessGraceDeadlineUptime=min(now+sidebarScrollReadinessGraceBudgetNs,sidebarScrollReadinessAbsoluteDeadline(startedUptime:startedUptime))
        }
        sidebarScrollReadinessLastComparison=comparison
        let sampleSummary:[String:Any]=["poll":sidebarScrollReadinessPollCount,"elapsedMs":elapsedMs,"rowCount":rows,"identityCount":identities,"identitySetFingerprint":sample["identitySetFingerprint"] as? String ?? "missing","identityOrderFingerprint":sample["identityOrderFingerprint"] as? String ?? "missing","rootPresent":root,"comparison":comparison,"stablePolls":sidebarScrollReadinessStablePolls]
        sidebarScrollReadinessSamples.append(sampleSummary);sidebarScrollReadinessPreviousSample=sample
        let partial="poll \(sidebarScrollReadinessPollCount), t=\(elapsedMs)ms, rows/ids \(rows)/\(identities), set/order \(sample["identitySetFingerprint"] as? String ?? "?")/\(sample["identityOrderFingerprint"] as? String ?? "?"), compare \(comparison), stable \(sidebarScrollReadinessStablePolls), root \(root ? "yes":"no"), context \(context)"
        recordSidebarScrollDiagnosticStage("native_readiness_sample",partial:partial)
        if context != "chatgpt.com" {finishSidebarScrollReadiness(runID:runID,reason:"wrong_route_or_context",startedUptime:startedUptime);return}
        let acceptance=sidebarScrollReadinessAcceptance(now:now)
        if acceptance.accepted {
            finishSidebarScrollReadiness(runID:runID,reason:"snapshot_ready",startedUptime:startedUptime);return
        }
        if let terminal=advanceSidebarScrollReadinessPhase(now:now,startedUptime:startedUptime) {finishSidebarScrollReadiness(runID:runID,reason:terminal,startedUptime:startedUptime);return}
        let currentDeadline=sidebarScrollReadinessCurrentDeadline(startedUptime:startedUptime)
        if now>=currentDeadline {finishSidebarScrollReadiness(runID:runID,reason:nil,startedUptime:startedUptime);return}
        let remaining=currentDeadline-now,delay=min(100_000_000,remaining)
        requestSidebarScrollReadinessPoll(runID:runID,startedUptime:startedUptime,delayNanoseconds:delay,isNext:true)
    }
    func finishSidebarScrollReadiness(runID:UUID,reason:String?,startedUptime:UInt64) {
        guard pinDiagnosticRunID==runID else{return}
        sidebarScrollReadinessTimeoutTask?.cancel();sidebarScrollReadinessTimeoutTask=nil
        let elapsedMs=Int((DispatchTime.now().uptimeNanoseconds-startedUptime)/1_000_000),sample=sidebarScrollReadinessLastSample
        let rows=(sample["rowCount"] as? NSNumber)?.intValue ?? 0,identities=(sample["identityCount"] as? NSNumber)?.intValue ?? 0
        let root=(sample["sidebarRootPresent"] as? Bool)==true,context=sample["context"] as? String ?? "unknown"
        let acceptance=sidebarScrollReadinessAcceptance(now:DispatchTime.now().uptimeNanoseconds)
        let terminal=reason ?? (acceptance.accepted ? "snapshot_ready":context != "chatgpt.com" ? "wrong_route_or_context":!root ? "sidebar_root_missing":sidebarScrollReadinessFirstPositiveCount==0 ? "rows_never_appeared":"rows_appeared_but_never_stabilized")
        let lifecycle="scheduled/started/evaluate/callback/parsed \(sidebarScrollReadinessScheduledCount)/\(sidebarScrollReadinessStartedCount)/\(sidebarScrollReadinessEvaluateCalledCount)/\(sidebarScrollReadinessCallbackCount)/\(sidebarScrollReadinessParsedCount) · in flight \(sidebarScrollReadinessInFlight ? "yes":"no") · last completed poll \(sidebarScrollReadinessLastCompletedPollIndex) · max callback latency \(sidebarScrollReadinessMaxCallbackLatencyMs)ms · max event gap \(sidebarScrollReadinessMaxEventGapMs)ms (\(sidebarScrollReadinessMaxEventGapFrom) → \(sidebarScrollReadinessMaxEventGapTo) )\nPoll lifecycle:\n\(sidebarScrollReadinessTimeline.isEmpty ? "none":sidebarScrollReadinessTimeline.joined(separator:"\n"))"
        let payload:[String:Any]=["status":terminal,"ready":terminal=="snapshot_ready","reason":terminal,"pollCount":sidebarScrollReadinessPollCount,"firstPollTimestampMs":sidebarScrollReadinessFirstPollMs as Any? ?? NSNull(),"lastPollTimestampMs":sidebarScrollReadinessLastPollMs as Any? ?? NSNull(),"waitDurationMs":elapsedMs,"firstPositiveCount":sidebarScrollReadinessFirstPositiveCount,"finalCount":rows,"identityCount":identities,"sidebarRootPresent":root,"context":context,"nativeGuardFired":false,"requiredStableSamples":4,"requiredStableDurationMs":320,"stablePolls":sidebarScrollReadinessStablePolls,"stableElapsedMs":acceptance.stableElapsedMs,"stableCountCondition":acceptance.countCondition,"stableDurationCondition":acceptance.durationCondition,"stableSnapshotAccepted":acceptance.accepted,"phaseABudgetMs":4000,"stabilizationGraceMs":1200,"absoluteReadinessCapMs":6000,"firstPositiveTimestampMs":sidebarScrollReadinessFirstPositiveUptime.map{Int(($0>=startedUptime ? $0-startedUptime:0)/1_000_000)} as Any? ?? NSNull(),"lastSemanticChangeTimestampMs":sidebarScrollReadinessLastSemanticChangeUptime.map{Int(($0>=startedUptime ? $0-startedUptime:0)/1_000_000)} as Any? ?? NSNull(),"extensionActivated":sidebarScrollReadinessGraceActivated,"samples":sidebarScrollReadinessSamples,"scheduledCount":sidebarScrollReadinessScheduledCount,"startedCount":sidebarScrollReadinessStartedCount,"evaluateCalledCount":sidebarScrollReadinessEvaluateCalledCount,"callbackCount":sidebarScrollReadinessCallbackCount,"parsedCount":sidebarScrollReadinessParsedCount,"inFlight":sidebarScrollReadinessInFlight,"lastCompletedPollIndex":sidebarScrollReadinessLastCompletedPollIndex,"maxCallbackLatencyMs":sidebarScrollReadinessMaxCallbackLatencyMs,"maxEventGapMs":sidebarScrollReadinessMaxEventGapMs,"maxEventGapFrom":sidebarScrollReadinessMaxEventGapFrom,"maxEventGapTo":sidebarScrollReadinessMaxEventGapTo,"nativePollTimeline":sidebarScrollReadinessTimeline]
        let sampleText=sidebarScrollReadinessSamples.map { item in
            "#\((item["poll"] as? NSNumber)?.intValue ?? 0) @\((item["elapsedMs"] as? NSNumber)?.intValue ?? 0)ms rows/ids \((item["rowCount"] as? NSNumber)?.intValue ?? 0)/\((item["identityCount"] as? NSNumber)?.intValue ?? 0) set \(item["identitySetFingerprint"] as? String ?? "?") order \(item["identityOrderFingerprint"] as? String ?? "?") root \((item["rootPresent"] as? Bool)==true ? "yes":"no") · \(item["comparison"] as? String ?? "unknown") · stable \((item["stablePolls"] as? NSNumber)?.intValue ?? 0)"
        }.joined(separator:"\n")
        let firstPositiveMs=sidebarScrollReadinessFirstPositiveUptime.map{Int(($0>=startedUptime ? $0-startedUptime:0)/1_000_000)}
        let lastSemanticChangeMs=sidebarScrollReadinessLastSemanticChangeUptime.map{Int(($0>=startedUptime ? $0-startedUptime:0)/1_000_000)}
        let summary="reason \(terminal), phase A 4000ms, grace 1200ms, absolute cap 6000ms, actual \(elapsedMs)ms, extension \(sidebarScrollReadinessGraceActivated ? "yes":"no"), first positive \(firstPositiveMs.map(String.init) ?? "none")ms, last semantic change \(lastSemanticChangeMs.map(String.init) ?? "none")ms, polls \(sidebarScrollReadinessPollCount), first/last \(sidebarScrollReadinessFirstPollMs.map(String.init) ?? "unknown")/\(sidebarScrollReadinessLastPollMs.map(String.init) ?? "unknown")ms, root \(root ? "yes":"no"), rows \(rows), identities \(identities), context \(context), guard no\nRequired stable samples 4 · stable duration 320ms · reached \(sidebarScrollReadinessStablePolls) · elapsed \(acceptance.stableElapsedMs)ms · count \(acceptance.countCondition ? "yes":"no") · duration \(acceptance.durationCondition ? "yes":"no") · accepted \(acceptance.accepted ? "yes":"no")\nSamples:\n\(sampleText.isEmpty ? "none":sampleText)\n\(lifecycle)"
        recordSidebarScrollDiagnosticStage("native_readiness_terminal",partial:summary)
        guard terminal=="snapshot_ready" else {
            let token=runID.uuidString
            web.evaluateJavaScript("window.gptClearSidebarScrollReadiness?.('\(token)')",completionHandler:nil)
            finishIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · readiness \(terminal) · \(summary) · cleanup owner released")
            return
        }
        guard JSONSerialization.isValidJSONObject(payload),let data=try? JSONSerialization.data(withJSONObject:payload,options:[.fragmentsAllowed]),let json=String(data:data,encoding:.utf8) else {
            finishIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · probe_failed · readiness result serialization failed · \(summary)");return
        }
        let token=runID.uuidString
        let script="void window.gptInspectSidebarScrollMechanics?.({operationToken:'\(token)',readiness:\(json)}).then(result=>window.webkit.messageHandlers.starredDiagnostic.postMessage({sidebarScrollMechanicsResult:result,operationToken:'\(token)'})).catch(error=>window.webkit.messageHandlers.starredDiagnostic.postMessage({sidebarScrollMechanicsResult:{status:'probe_failed',terminalStatus:'probe_failed',lastCompletedStage:'bridge_rejection',errorCategory:'javascript_exception',movement:{attempted:false,reason:'bridge_rejection'}},operationToken:'\(token)'})); true;"
        recordSidebarScrollDiagnosticStage("native_readiness_ready",partial:summary)
        web.evaluateJavaScript(script) { _,error in if error != nil {DispatchQueue.main.async {guard self.pinDiagnosticRunID==runID else{return};self.finishIsolatedDiagnostic("Last isolated diagnostic: v\(self.pinnedDiagnosticVersion) · probe_failed · ready result dispatch failed · \(summary)")}} }
    }
    @objc func diagnoseVisiblePinnedRows() {
        guard !cycleRunning else {setLastIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · unavailable · a cycle is running.");return}
        guard web.url?.host == "chatgpt.com" else {setLastIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · unavailable · ChatGPT session page is not active.");return}
        pinDiagnosticTimeoutTask?.cancel()
        let runID=UUID();pinDiagnosticRunID=runID
        sidebarDiagnosticStartedAt=Date();sidebarDiagnosticLastStage="operation_started";sidebarDiagnosticLastElapsedMs=0;sidebarDiagnosticExceptionCategory="none";lastSidebarDiagnosticSummary=nil
        lastSidebarDiagnosticOutput.stringValue="Last sidebar diagnostic: running · stage operation_started · elapsed 0 ms"
        updateRuntimeIdentity()
        setLastIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · checking sidebar top and visible conversation rows.")
        pinDiagnosticTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:45_000_000_000)
            guard let self,self.pinDiagnosticRunID==runID else{return}
            self.finishSidebarDiagnosticFailure("hard_timeout","Last isolated diagnostic: v\(self.pinnedDiagnosticVersion) · stopped at the 45 s safety deadline.")
        }
        web.evaluateJavaScript("window.pinnedDiagnosticVersion || null") { [weak self] value,error in
            DispatchQueue.main.async {
                guard let self,self.pinDiagnosticRunID==runID else{return}
                guard error == nil,(value as? String)==self.pinnedDiagnosticVersion else {self.finishSidebarDiagnosticFailure("bridge_hook_missing_or_mismatch","Last isolated diagnostic: unavailable · hook version mismatch or missing.");return}
                let invocation="""
                void window.gptInspectVisiblePinnedRows({maxRows:13,hardTimeoutMs:40000,sidebarDiagnosticRunID:'\(runID.uuidString)'}).then(result => {
                  window.webkit.messageHandlers.starredDiagnostic.postMessage({visiblePinnedRowsResult:result,sidebarDiagnosticRunID:'\(runID.uuidString)'});
                }).catch(() => {
                  window.webkit.messageHandlers.starredDiagnostic.postMessage({visiblePinnedRowsError:'visible_pinned_rows_failed',sidebarDiagnosticRunID:'\(runID.uuidString)'});
                }); true;
                """
                self.web.evaluateJavaScript(invocation) { _,invokeError in
                    if invokeError != nil {DispatchQueue.main.async {self.finishSidebarDiagnosticFailure("command_delivery_failed","Last isolated diagnostic: v\(self.pinnedDiagnosticVersion) · failed safely · command delivery error.")}}
                }
            }
        }
    }
    @objc func inspectSidebarElementStructure() {
        guard !cycleRunning else {sidebarElementStructureOutput.stringValue="Last sidebar element structure: unavailable · a cycle is running.";return}
        guard pinDiagnosticRunID == nil else {sidebarElementStructureOutput.stringValue="Last sidebar element structure: unavailable · another diagnostic is running.";return}
        guard web.url?.host == "chatgpt.com" else {sidebarElementStructureOutput.stringValue="Last sidebar element structure: unavailable · ChatGPT session page is not active.";return}
        let runID=UUID();pinDiagnosticRunID=runID
        sidebarElementStructureOutput.stringValue="Last sidebar element structure: running · bounded sidebar-only scan"
        updateRuntimeIdentity()
        pinDiagnosticTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:8_000_000_000)
            guard let self,self.pinDiagnosticRunID==runID else{return}
            self.pinDiagnosticRunID=nil;self.pinDiagnosticTimeoutTask=nil
            self.sidebarElementStructureOutput.stringValue="Last sidebar element structure: failure · native_timeout"
            self.updateRuntimeIdentity()
        }
        let token=runID.uuidString
        let script="""
        void window.gptInspectSidebarElementStructure?.({hardTimeoutMs:5000}).then(result => {
          window.webkit.messageHandlers.starredDiagnostic.postMessage({sidebarElementStructureResult:result,sidebarStructureDiagnosticRunID:'\(token)'});
        }).catch(error => {
          window.webkit.messageHandlers.starredDiagnostic.postMessage({sidebarElementStructureError:error?.name==='TimeoutError'?'TimeoutError':'Error',sidebarStructureDiagnosticRunID:'\(token)'});
        }); true;
        """
        web.evaluateJavaScript(script) { [weak self] _,error in
            guard error != nil else{return}
            DispatchQueue.main.async {
                guard let self,self.pinDiagnosticRunID==runID else{return}
                self.pinDiagnosticTimeoutTask?.cancel();self.pinDiagnosticTimeoutTask=nil;self.pinDiagnosticRunID=nil
                self.sidebarElementStructureOutput.stringValue="Last sidebar element structure: failure · bridge_unavailable"
                self.updateRuntimeIdentity()
            }
        }
    }
    func renderSidebarElementStructure(_ raw:[String:Any])->String {
        func boundedCount(_ value:Any?,_ cap:Int)->Int { min(Swift.max(0,(value as? NSNumber)?.intValue ?? 0),cap) }
        func safeToken(_ value:Any?,pattern:String)->String? {
            guard let value=value as? String,value.range(of:pattern,options:.regularExpression) != nil else{return nil};return value
        }
        let counts=raw["counts"] as? [String:Any] ?? [:]
        let stableRouteSegments=Set(["settings","auth","login","logout","share","library","explore","search","workspace","account","help","new","home","recent","archived","projects","project","features","about"])
        func safeRoute(_ value:String)->String? {
            guard value=="/" || value.hasPrefix("/"),value.utf8.count<=240 else{return nil}
            let segments=value.split(separator:"/").map(String.init)
            guard segments.allSatisfy({$0==":id" || stableRouteSegments.contains($0)}) else{return nil}
            return value
        }
        let routes=(raw["routeTemplates"] as? [[String:Any]] ?? []).prefix(40).compactMap { item -> String? in
            guard let route=(item["template"] as? String).flatMap(safeRoute) else{return nil}
            return "\(route)×\(boundedCount(item["count"],1200))"
        }
        let candidates=(raw["rowCandidates"] as? [[String:Any]] ?? []).prefix(30).compactMap { item -> String? in
            guard let tag=safeToken(item["tag"],pattern:"^[a-z][a-z0-9-]{0,15}$") else{return nil}
            let roleSet=Set(["none","link","button","listitem","list","tree","group","navigation","heading","menuitem","other","presentation"])
            let role=(item["role"] as? String).flatMap{roleSet.contains($0) ? $0:nil} ?? "other"
            let data=(item["dataAttributeNames"] as? [String] ?? []).prefix(24).compactMap{safeToken($0,pattern:"^data-[a-z0-9_-]{1,64}$")}.joined(separator:",")
            let template=(item["hrefTemplate"] as? String).flatMap(safeRoute) ?? "none"
            return "\(tag)/\(role) · data [\(data)] · href \((item["hasHref"] as? Bool)==true ? "yes":"no") \(template) · depth \(boundedCount(item["depth"],32)) · matches \(boundedCount(item["count"],1200))"
        }
        let aria=(counts["ariaAttributeNames"] as? [String] ?? []).prefix(64).compactMap{safeToken($0,pattern:"^aria-[a-z0-9_-]{1,64}$")}.joined(separator:",")
        let pinned=(raw["pinnedMarkerAttributeNames"] as? [String] ?? []).prefix(32).compactMap{safeToken($0,pattern:"^data-[a-z0-9_-]{1,64}$")}.joined(separator:",")
        let status=(raw["status"] as? String).flatMap{["success","partial","failure"].contains($0) ? $0:nil} ?? "failure"
        let reason=safeToken(raw["reason"],pattern:"^[A-Za-z0-9_-]{1,48}$") ?? "invalid_result"
        let elapsed=boundedCount(raw["elapsedMs"],5000),nodes=boundedCount(raw["nodeCount"],1200)
        return "Last sidebar element structure: \(status) · \(reason) · \(elapsed) ms · nodes \(nodes) · roots \(boundedCount(raw["rootCount"],16)) (nav \(boundedCount(raw["navCount"],16)), aside \(boundedCount(raw["asideCount"],16)))\nCounts: a[href] \(boundedCount(counts["hrefAnchors"],1200)) · button \(boundedCount(counts["buttons"],1200)) · role=link \(boundedCount(counts["roleLinks"],1200)) · role=button \(boundedCount(counts["roleButtons"],1200)) · data-testid \(boundedCount(counts["dataTestID"],1200)) · data-state \(boundedCount(counts["dataState"],1200)) · aria attributes \(boundedCount(counts["ariaAttributeCount"],24000))\nARIA names: \(aria.isEmpty ? "none":aria)\nRoutes: \(routes.isEmpty ? "none":routes.joined(separator:", "))\nRow candidates (tag/role · data names · href template · depth · matches):\n\(candidates.isEmpty ? "none":candidates.joined(separator:"\n"))\nPossible pinned-marker attribute names: \(pinned.isEmpty ? "none":pinned)"
    }
    func renderDOMSummary(_ data:[String:Any])->String {
        let ready=data["documentReadyState"] as? String ?? "unknown"
        let path=data["pathTemplate"] as? String ?? "unknown"
        let sidebar=(data["sidebarCandidates"] as? NSNumber)?.intValue ?? 0
        let list=(data["conversationListCandidates"] as? NSNumber)?.intValue ?? 0
        let links=(data["conversationLinks"] as? NSNumber)?.intValue ?? 0
        return "document \(ready) · path \(path) · sidebar \(sidebar) · list \(list) · conversation links \(links)"
    }
    func renderControlState()->RenderSurfaceControlState {
        RenderSurfaceControlState(webViewHidden:web.isHidden,windowVisible:session.isVisible,ignoresMouseEvents:session.ignoresMouseEvents,
                                  appActive:NSApp.isActive,keyWindow:session.isKeyWindow,mainWindow:session.isMainWindow)
    }
    func restoreBackgroundRenderSurface(owner:String)->Bool {
        guard let lease=backgroundRenderLease,lease.owner==owner,backgroundRenderLeaseGate.owner==owner else {
            backgroundRenderLeaseRestoreDetails="stale or mismatched owner · no window state changed"
            return false
        }
        recordBackgroundFocusSample("before render lease cleanup")
        session.ignoresMouseEvents=lease.original.ignoresMouseEvents
        web.isHidden=lease.original.webViewHidden
        let frameRestored=session.frame.equalTo(lease.windowFrame) && web.frame.equalTo(lease.webViewFrame)
        let orderingRestored=session.isVisible==lease.original.windowVisible && session.level==lease.windowLevel
        let ignoresMouseEventsRestored=session.ignoresMouseEvents==lease.original.ignoresMouseEvents
        let webViewVisibilityRestored=web.isHidden==lease.original.webViewHidden
        let keyMainRestored=session.isKeyWindow==lease.original.keyWindow && session.isMainWindow==lease.original.mainWindow
        let applicationActivationRestored=NSApp.isActive==lease.original.appActive
        let responderRestored = !lease.original.keyWindow || session.firstResponder === lease.firstResponder.value
        // NSApp.isActive can differ while the same external process remains frontmost;
        // report it separately, but do not fail cleanup on that AppKit-only signal.
        let stateRestored=keyMainRestored && responderRestored
        let ownershipReleased=backgroundRenderLeaseGate.release(owner)
        let restored=frameRestored && orderingRestored && keyMainRestored && ignoresMouseEventsRestored && webViewVisibilityRestored && stateRestored && ownershipReleased
        backgroundRenderLeaseWindowOrderingRestored=orderingRestored ? "yes":"no"
        backgroundRenderLeaseKeyMainRestored=keyMainRestored ? "yes":"no"
        backgroundRenderLeaseApplicationActivationRestored=applicationActivationRestored ? "yes":"no"
        backgroundRenderLeaseOwnershipReleased=ownershipReleased ? "yes":"no"
        backgroundRenderLeaseRestoreDetails="focus snapshot captured \(backgroundRenderLeaseFocusSnapshotCaptured ? "yes":"no") · window ordering preserved \(backgroundRenderLeaseWindowOrderingRestored) · key/main preserved \(backgroundRenderLeaseKeyMainRestored) · GPT Limits Tool activation unchanged \(backgroundRenderLeaseApplicationActivationRestored) · first responder preserved \(responderRestored ? "yes":"no") · frame \(frameRestored ? "yes":"no") · ignoresMouseEvents \(ignoresMouseEventsRestored ? "yes":"no") · WebView visibility \(webViewVisibilityRestored ? "yes":"no") · ownership released \(backgroundRenderLeaseOwnershipReleased)"
        backgroundRenderLease=nil
        backgroundRenderLeaseActivatedAt=nil
        recordBackgroundFocusSample("after render lease cleanup")
        if !cycleRunning {finishGlobalWindowOrderMonitoring()}
        finalizeBackgroundFocusObservation(captureBackgroundFocusSnapshot())
        pinnedActivityRenderLeaseCleanup=restored ? "success":"failed"
        flushPendingForegroundPresentationIfIdle()
        return restored
    }
    func withBackgroundRenderSurface<T>(owner:String,operation:() async throws -> T) async throws -> T {
        try await acquireBackgroundRenderSurface(owner:owner)
        do {
            let result=try await operation()
            let restored=restoreBackgroundRenderSurface(owner:owner)
            backgroundRenderLeaseReport += " · cleanup \(restored ? "completed":"failed")"
            return result
        } catch {
            let restored=restoreBackgroundRenderSurface(owner:owner)
            backgroundRenderLeaseReport += " · cleanup \(restored ? "completed":"failed")"
            throw error
        }
    }
    func renderLeaseFailureReason(_ error:Error)->String {
        guard let error=error as? BackgroundRenderLeaseError else{return "render_readiness_bridge_error"}
        switch error {
        case .busy,.activationFailed:return "render_lease_unavailable"
        case .pageUnavailable:return "page_unavailable"
        case .readinessTimeout:return "render_readiness_timeout"
        case .readinessUnavailable:return "render_readiness_unavailable"
        case .readinessFailed(let reason):return reason
        }
    }
    func recordRenderReadiness(phase:String,result:RenderReadinessResult,reason:String) {
        cycleState.recordRenderReadiness(phase:phase,result:result,reason:reason,routeCategory:renderReadinessRouteCategory(web.url))
        saveCycle()
        updateRuntimeIdentity()
    }
    func renderReadinessFailureCode(_ error:Error)->String {
        let nsError=error as NSError
        if nsError.domain==NSURLErrorDomain {return "navigation_failed"}
        let reason=renderLeaseFailureReason(error)
        switch reason {
        case "render_readiness_timeout":return "timeout"
        case "render_readiness_unavailable":return "bridge_result_missing"
        case "page_unavailable":return "unexpected_page"
        case "render_lease_unavailable":return "render_lease_unavailable"
        default:return sanitizedRenderReadinessCode(reason,fallback:"readiness_failed")
        }
    }
    func recordRenderReadinessNavigationFailure(_ error:Error) {
        guard cycleRunning,backgroundRenderLease != nil else{return}
        let nsError=error as NSError
        let reason=nsError.domain==NSURLErrorDomain ? "navigation_failed":"navigation_error"
        recordRenderReadiness(phase:"navigation",result:.failure,reason:reason)
    }
    func acquireBackgroundRenderSurface(owner:String) async throws {
        try await acquireBackgroundRenderSurface(owner:owner,waitForConversationLinks:true)
    }
    func acquireBackgroundRenderSurfaceForPinnedDiagnostic(owner:String) async throws {
        try await acquireBackgroundRenderSurface(owner:owner,waitForConversationLinks:false)
    }
    func acquireBackgroundRenderSurface(owner:String,waitForConversationLinks:Bool) async throws {
        guard web.url?.host=="chatgpt.com" else {
            recordRenderReadiness(phase:"route",result:.failure,reason:"unexpected_page")
            throw BackgroundRenderLeaseError.pageUnavailable
        }
        if globalWindowOrderMonitor==nil {beginGlobalWindowOrderMonitoring()}
        guard backgroundRenderLease==nil,backgroundRenderLeaseGate.acquire(owner) else { throw BackgroundRenderLeaseError.busy }
        recordBackgroundFocusSample("before background render lease")
        _=presentWindow(session,intent:.background,callSite:"scheduler_render_surface")
        recordBackgroundFocusSample("after background presentation intent")
        let original=renderControlState(),windowFrame=session.frame,webViewFrame=web.frame,level=session.level
        let ordered=NSApp.orderedWindows
        let windowIndex=ordered.firstIndex(of:session)
        let aboveNumber=windowIndex.flatMap{index in index>0 ? ordered[index-1].windowNumber:nil}
        let belowNumber=windowIndex.flatMap{index in index+1<ordered.count ? ordered[index+1].windowNumber:nil}
        backgroundRenderLeaseFocusSnapshotCaptured=true
        backgroundRenderLease=BackgroundRenderLeaseState(owner:owner,original:original,windowFrame:windowFrame,webViewFrame:webViewFrame,windowLevel:level,
                                                         windowAboveNumber:aboveNumber,windowBelowNumber:belowNumber,firstResponder:WeakResponderReference(original.keyWindow ? session.firstResponder:nil))
        web.isHidden=false
        session.ignoresMouseEvents=true
        recordBackgroundFocusSample("after render surface acquisition")
        let activated=web.window===session && !web.isHidden && web.bounds.width>0 && web.bounds.height>0 &&
            session.ignoresMouseEvents && NSApp.isActive==original.appActive && session.isKeyWindow==original.keyWindow && session.isMainWindow==original.mainWindow
        guard activated else {
            recordRenderReadiness(phase:"surface",result:.failure,reason:"render_surface_unavailable")
            _=restoreBackgroundRenderSurface(owner:owner)
            backgroundRenderLeaseReport="acquired no · render surface inactive · restored yes"
            throw BackgroundRenderLeaseError.activationFailed
        }
        backgroundRenderLeaseActivatedAt=Date()
        backgroundRenderLeaseTimeToFirstConversationLinkMs=nil
        backgroundRenderLeaseReadiness=[:]
        guard waitForConversationLinks else {
            backgroundRenderLeaseReport="acquired yes · render surface active yes · conversation-link wait delegated to isolated diagnostic"
            try Task.checkCancellation()
            return
        }
        let before=Date()
        do {
            backgroundRenderLeaseReport="acquired yes · render surface active yes · waiting for conversation links"
            let value=try await evaluateRenderReadiness(owner:owner,timeoutSeconds:19)
            let readiness=value["readiness"] as? [String:Any] ?? [:]
            let preflight=value["preflight"] as? [String:Any] ?? [:]
            backgroundRenderLeaseReadiness=readiness
            let links=(readiness["finalSnapshotCount"] as? NSNumber)?.intValue ?? 0
            let status=readiness["status"] as? String ?? "unknown"
            let ready=(readiness["ready"] as? Bool)==true
            let signatureChanges=(readiness["conversationSignatureChanges"] as? NSNumber)?.intValue ?? 0
            let unrelatedMutations=(readiness["unrelatedMutationChecks"] as? NSNumber)?.intValue ?? 0
            let stableMs=(readiness["timeToStableMs"] as? NSNumber).map{String(format:"%.0f",$0.doubleValue)} ?? "unknown"
            let firstPositive=(readiness["firstPositiveCount"] as? NSNumber)?.intValue ?? 0
            let firstLinkMs=(readiness["timeToFirstPositiveMs"] as? NSNumber)?.intValue
            backgroundRenderLeaseTimeToFirstConversationLinkMs=firstLinkMs
            let readinessSuccess=ready && links>0
            let readinessReason=readinessSuccess ? "snapshot_ready" : (status=="snapshot_ready" ? "no_conversation_links":status)
            recordRenderReadiness(phase:preflight["stage"] as? String ?? "readiness",result:readinessSuccess ? .success:.failure,reason:readinessReason)
            let elapsed=Int(Date().timeIntervalSince(before)*1000)
            let firstLinkText=firstLinkMs.map(String.init) ?? "unknown"
            backgroundRenderLeaseReport="acquired yes · render surface active yes · conversation links \(links) · firstPositive \(firstPositive) · timeToFirstLinks \(firstLinkText) ms · readiness \(status) · signature changes \(signatureChanges) · unrelated mutation checks \(unrelatedMutations) · timeToStable \(stableMs) ms · \(elapsed) ms"
            guard ready,links>0 else {
                let restored=restoreBackgroundRenderSurface(owner:owner)
                backgroundRenderLeaseReport += " · primaryFailureReason \(status) · cleanupFailureReason \(restored ? "none":"render_surface_restore_failed") · restored \(restored ? "yes":"no")"
                throw BackgroundRenderLeaseError.readinessFailed(status)
            }
            try Task.checkCancellation()
        } catch {
            if backgroundRenderLease?.owner==owner {
                recordRenderReadiness(phase:"readiness",result:.failure,reason:renderReadinessFailureCode(error))
                let restored=restoreBackgroundRenderSurface(owner:owner)
                let nsError=error as NSError
                backgroundRenderLeaseReport += " · primaryFailureReason render_readiness_bridge_error · readiness bridge error \(nsError.domain):\(nsError.code) · cleanupFailureReason \(restored ? "none":"render_surface_restore_failed") · cleanup \(restored ? "completed":"failed")"
            }
            throw error
        }
    }
    func evaluateRenderReadiness(owner:String,timeoutSeconds:Double) async throws -> [String:Any] {
        try await withCheckedThrowingContinuation { continuation in
            guard renderLeaseReadinessContinuation==nil else {
                continuation.resume(throwing:BackgroundRenderLeaseError.busy);return
            }
            renderLeaseReadinessOwner=owner
            renderLeaseReadinessContinuation=continuation
            let timeout=DispatchWorkItem {
                self.finishRenderLeaseReadiness(owner:owner,result:nil,error:BackgroundRenderLeaseError.readinessTimeout)
            }
            renderLeaseReadinessTimeout=timeout
            DispatchQueue.main.asyncAfter(deadline:.now()+timeoutSeconds,execute:timeout)
            let token=String(data:(try? JSONSerialization.data(withJSONObject:[owner])) ?? Data("[]".utf8),encoding:.utf8) ?? "[]"
            let script="void window.gptWaitForPinnedReadinessPreflight?.({preflightTimeoutMs:18000,webViewVisible:true,navigationActive:window.__gptNativeNavigationActive===true}).then(r=>{const q=r?.readiness||{},p=r?.preflight||{};window.webkit.messageHandlers.starredDiagnostic.postMessage({renderLeaseReadinessToken:\(token)[0],renderLeaseReadiness:{preflight:{stage:p.stage||'unknown',reason:p.reason||null,durationMs:Number(p.durationMs)||0,pathTemplate:p.pathTemplate||'unknown',sidebarContainerCandidates:Number(p.sidebarContainerCandidates)||0},readiness:{status:q.status||'unknown',rawStatus:q.rawStatus||q.status||'unknown',ready:q.ready===true,rowsAtFirstDetection:Number(q.rowsAtFirstDetection)||0,firstPositiveCount:Number(q.firstPositiveCount)||0,rowsAtStabilizedSnapshot:Number(q.rowsAtStabilizedSnapshot)||0,finalStableCount:Number(q.finalStableCount)||Number(q.stableCount)||0,finalSnapshotCount:Number(q.finalSnapshotCount)||0,sidebarRegionFound:q.sidebarRegionFound===true,timeToFirstPositiveMs:q.timeToFirstPositiveMs??null}}})}).catch(()=>window.webkit.messageHandlers.starredDiagnostic.postMessage({renderLeaseReadinessToken:\(token)[0],renderLeaseReadinessError:'preflight_failed'})); true;"
            web.evaluateJavaScript(script) { _,error in
                if let error {DispatchQueue.main.async {self.finishRenderLeaseReadiness(owner:owner,result:nil,error:error)}}
            }
        }
    }
    func finishRenderLeaseReadiness(owner:String,result:[String:Any]?,error:Error?) {
        guard renderLeaseReadinessOwner==owner,let continuation=renderLeaseReadinessContinuation else{return}
        renderLeaseReadinessTimeout?.cancel();renderLeaseReadinessTimeout=nil
        renderLeaseReadinessOwner=nil;renderLeaseReadinessContinuation=nil
        if let error {continuation.resume(throwing:error)}
        else if let result {continuation.resume(returning:result)}
        else {continuation.resume(throwing:BackgroundRenderLeaseError.readinessUnavailable)}
    }
    @objc func inspectHiddenWebViewRendering() {
        if cycleRunning {setLastIsolatedDiagnostic("Last isolated diagnostic: unavailable · scheduler is running.");return}
        if let owner=manualDiagnosticOwnerLabel() {setLastIsolatedDiagnostic("Last isolated diagnostic: unavailable · \(owner) diagnostic is active.");return}
        let runtimeSource=runtimeSourceClassification()
        guard pinnedDiagnosticVersion=="6.1.0", runtimeSource != "unexpected" else {setLastIsolatedDiagnostic("Last isolated diagnostic: unavailable · runtime identity gate failed.");return}
        guard web.url?.host=="chatgpt.com" else {setLastIsolatedDiagnostic("Last isolated diagnostic: unavailable · ChatGPT session page is not active.");return}
        let token=UUID().uuidString;renderDiagnosticToken=token;renderDiagnosticHiddenDOM=[:]
        let original=renderControlState(),originalLevel=session.level,originalFrame=web.frame,originalWindowFrame=session.frame
        let originalResponder=WeakResponderReference(original.keyWindow ? session.firstResponder:nil)
        renderDiagnosticRestore={ [weak self] in
            guard let self else{return false}
            let current=self.renderControlState()
            let focusUnchanged=NSApp.isActive==original.appActive && current.keyWindow==original.keyWindow && current.mainWindow==original.mainWindow
            let responderUnchanged = !original.keyWindow || self.session.firstResponder === originalResponder.value
            return focusUnchanged && responderUnchanged && current.windowVisible==original.windowVisible &&
                current.webViewHidden==original.webViewHidden && current.ignoresMouseEvents==original.ignoresMouseEvents &&
                self.web.frame.equalTo(originalFrame) && self.session.frame.equalTo(originalWindowFrame) && self.session.level==originalLevel
        }
        setLastIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · Snapshot A · hidden rendering state…")
        renderDiagnosticTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:8_000_000_000)
            guard let self,self.renderDiagnosticToken==token else{return}
            self.finishHiddenRenderDiagnostic(token:token,result:nil,error:"render_diagnostic_timeout")
        }
        web.evaluateJavaScript("window.gptRenderStateSnapshot?.() || null") { [weak self] value,error in
            DispatchQueue.main.async {
                guard let self,self.renderDiagnosticToken==token else{return}
                guard error==nil,let hiddenDOM=value as? [String:Any] else {self.finishHiddenRenderDiagnostic(token:token,result:nil,error:"render_snapshot_unavailable");return}
                let hiddenCounts:[String:Int]=[
                    "sidebarCandidates":(hiddenDOM["sidebarCandidates"] as? NSNumber)?.intValue ?? 0,
                    "conversationListCandidates":(hiddenDOM["conversationListCandidates"] as? NSNumber)?.intValue ?? 0,
                    "conversationLinks":(hiddenDOM["conversationLinks"] as? NSNumber)?.intValue ?? 0
                ]
                self.renderDiagnosticHiddenDOM=hiddenCounts
                self.renderDiagnosticHiddenSummary=self.renderDOMSummary(hiddenDOM)
                self.renderDiagnosticHiddenWindowSummary="window exists yes · WebView hidden \(original.webViewHidden ? "yes":"no") · window visible \(original.windowVisible ? "yes":"no") · ignoresMouseEvents \(original.ignoresMouseEvents ? "yes":"no") · key/main \(original.keyWindow ? "yes":"no")/\(original.mainWindow ? "yes":"no") · app active \(original.appActive ? "yes":"no")"
                guard let jsonData=try? JSONSerialization.data(withJSONObject:hiddenDOM),let json=String(data:jsonData,encoding:.utf8) else {
                    self.finishHiddenRenderDiagnostic(token:token,result:nil,error:"render_snapshot_encoding_error");return
                }
                self.setLastIsolatedDiagnostic("Last isolated diagnostic: v\(self.pinnedDiagnosticVersion) · read-only hidden WebView inspection…")
                let current=self.renderControlState(),focusPreserved=NSApp.isActive==original.appActive && current.keyWindow==original.keyWindow && current.mainWindow==original.mainWindow
                let script="void window.gptInspectRenderDOM({before:\(json),timeoutMs:5000,renderSurfaceActive:false,nativeWindowVisible:\(self.session.isVisible),nativeWebViewHidden:\(self.web.isHidden),nativeKeyWindow:\(self.session.isKeyWindow),nativeMainWindow:\(self.session.isMainWindow),focusPreserved:\(focusPreserved)}).then(result=>window.webkit.messageHandlers.starredDiagnostic.postMessage({renderStateResult:result,renderDiagnosticToken:'\(token)'})).catch(()=>window.webkit.messageHandlers.starredDiagnostic.postMessage({renderStateError:'render_dom_probe_failed',renderDiagnosticToken:'\(token)'})); true;"
                self.web.evaluateJavaScript(script) { _,invokeError in
                    if invokeError != nil {DispatchQueue.main.async {self.finishHiddenRenderDiagnostic(token:token,result:nil,error:"render_probe_invocation_failed")}}
                }
            }
        }
    }
    func finishHiddenRenderDiagnostic(token:String,result:[String:Any]?,error:String?) {
        guard renderDiagnosticToken==token else{return}
        renderDiagnosticTimeoutTask?.cancel();renderDiagnosticTimeoutTask=nil
        let restored=renderDiagnosticRestore?() ?? false
        renderDiagnosticRestore=nil;renderDiagnosticToken=nil
        guard let result,error==nil else {
            let outcome="Last isolated diagnostic: v\(pinnedDiagnosticVersion) · hidden snapshot: \(renderDiagnosticHiddenWindowSummary) · \(renderDiagnosticHiddenSummary) · result: \(error ?? "render_probe_failed") · render state restored: \(restored ? "yes":"no")"
            setLastIsolatedDiagnostic(outcome);return
        }
        let after=result["after"] as? [String:Any] ?? [:]
        let hiddenList=renderDiagnosticHiddenDOM["conversationListCandidates"] ?? 0,hiddenLinks=renderDiagnosticHiddenDOM["conversationLinks"] ?? 0
        let activeList=(after["conversationListCandidates"] as? NSNumber)?.intValue ?? 0,activeLinks=(after["conversationLinks"] as? NSNumber)?.intValue ?? 0
        let outcome=hiddenRenderOutcome(hiddenList:hiddenList,hiddenLinks:hiddenLinks,activeList:activeList,activeLinks:activeLinks).rawValue
        let activeSummary=renderDOMSummary(after)
        let firstList=(result["firstListRegionChangeMs"] as? NSNumber).map{"\($0.intValue) ms"} ?? "not observed"
        let firstLink=(result["firstConversationLinkChangeMs"] as? NSNumber).map{"\($0.intValue) ms"} ?? "not observed"
        let elapsed=(result["elapsedMs"] as? NSNumber)?.intValue ?? 0
        let message="Last isolated diagnostic: v\(pinnedDiagnosticVersion) · \(outcome)\nSnapshot A: \(renderDiagnosticHiddenWindowSummary) · \(renderDiagnosticHiddenSummary)\nPresentation: unchanged · native window visible \((result["nativeWindowVisible"] as? Bool)==true ? "yes":"no") · WebView hidden \((result["nativeWebViewHidden"] as? Bool)==true ? "yes":"no") · focus preserved \((result["focusPreserved"] as? Bool)==true ? "yes":"no")\nSnapshot B: \(activeSummary) · time to first list-region change \(firstList) · first conversation-link change \(firstLink) · observed \(elapsed) ms / max 5000 ms\nWindow/focus state unchanged: \(restored ? "yes":"no")"
        setLastIsolatedDiagnostic(message)
    }
    @objc func diagnosePinnedActivityTimestamp() {
        if pinnedActivityDiagnosticToken != nil || pinnedActivityLaunchPending {
            pinnedActivityLastLaunchRejection="probe_already_running"
            setLastIsolatedDiagnostic(pinnedActivityDiagnosticToken != nil ? pinnedActivityStatusText() : "Last isolated diagnostic: State: rejected\nStage: action_received\nReason: probe_already_running\nOperation active: No")
            return
        }
        if let owner=manualDiagnosticOwnerLabel() {
            pinnedActivityLaunchStage="rejected";pinnedActivityLaunchReason="diagnostic_running";pinnedActivityLastLaunchRejection="diagnostic_running"
            setLastIsolatedDiagnostic("Last isolated diagnostic: State: rejected\nStage: gate_check_started\nReason: diagnostic_running · \(owner)\nOperation active: No");return
        }
        pinnedActivityLaunchPending=true
        pinnedActivityLaunchStage="action_received"
        pinnedActivityLaunchReason="none"
        pinnedActivityLastLaunchRejection="none"
        setLastIsolatedDiagnostic("Last isolated diagnostic: State: starting\nStage: action_received\nOperation active: No")
        DispatchQueue.main.async { [weak self] in self?.continuePinnedActivityLaunch() }
    }
    func continuePinnedActivityLaunch() {
        guard pinnedActivityDiagnosticToken==nil else {rejectPinnedActivityLaunch("probe_already_running");return}
        guard pinnedActivityLaunchPending else {rejectPinnedActivityLaunch("launch_not_pending");return}
        pinnedActivityLaunchStage="gate_check_started"
        setLastIsolatedDiagnostic("Last isolated diagnostic: State: starting\nStage: gate_check_started\nOperation active: \(pinnedActivityDiagnosticToken == nil ? "No":"Yes")")
        guard !cycleRunning else {rejectPinnedActivityLaunch("scheduler_running");return}
        guard renderDiagnosticToken==nil,pinDiagnosticRunID==nil,!listDiagnosticGenerationGate.isActive else {rejectPinnedActivityLaunch("diagnostic_running");return}
        guard backgroundRenderLease==nil else {rejectPinnedActivityLaunch("render_lease_unavailable");return}
        let runtimeSource=runtimeSourceClassification()
        guard pinnedDiagnosticVersion=="6.1.0", runtimeSource != "unexpected" else {rejectPinnedActivityLaunch("runtime_gate_failed");return}
        guard web.url?.host == "chatgpt.com" else {rejectPinnedActivityLaunch("page_unavailable");return}
        pinnedActivityLaunchStage="gate_passed"
        setLastIsolatedDiagnostic("Last isolated diagnostic: State: starting\nStage: gate_passed\nOperation active: No")
        pinnedActivityTimeoutTask?.cancel();pinnedActivityItemTimeoutTask?.cancel()
        let token=UUID().uuidString;pinnedActivityDiagnosticToken=token;pinnedActivityExpectedConversationID=nil
        pinnedActivityLaunchPending=false
        pinnedActivityLaunchStage="operation_created"
        pinnedActivityLaunchReason="none"
        pinnedActivityStartedAt=Date();pinnedActivityTotalBudgetMs=120_000;pinnedActivityTraversalBudgetMs=15_000;pinnedActivityTraversalDeadline=nil;pinnedActivityTraversalActive=false
        pinnedActivityProcessedRows=0;pinnedActivityOrdinaryCount=0;pinnedActivityUnknownCount=0;pinnedActivityFirstOrdinaryFound=false;pinnedActivityAttemptedCount=0
        pinnedActivityRecords=[];pinnedActivityPinnedCount=0;pinnedActivityIndex=0;pinnedActivityResolved=0;pinnedActivityTimes=[];pinnedActivitySources=[];pinnedActivityOrdinals=[];pinnedActivityExpectedOrdinal=nil
        pinnedActivityScrollOwnerSummary="not sampled";pinnedActivityScrollAttemptsSummary="none"
        pinnedActivityReadiness="waiting";pinnedActivityPreflightSummary="waiting";pinnedActivityRowsAtFirstDetection=0;pinnedActivityRowsAtStabilizedSnapshot=0;pinnedActivityFirstPositiveCount=0;pinnedActivityConversationSignatureChanges=0;pinnedActivityUnrelatedMutationChecks=0;pinnedActivityStableCount=0;pinnedActivityFinalSnapshotCount=0;pinnedActivityTimeToFirstPositiveMs="unknown";pinnedActivityTimeToStableMs="unknown";pinnedActivityTerminalReason="not_run";pinnedActivityPrimaryFailureReason="none";pinnedActivityCleanupFailureReason="none";pinnedActivityPrefixSnapshotCount=0;pinnedActivityInitialSnapshotCount=0;pinnedActivityFinalPrefixSnapshotCount=0;pinnedActivitySnapshotExpansionCount=0;pinnedActivityFirstNotPinnedFound=false;pinnedActivitySequence="not recorded";pinnedActivityPrefixReason="not_run";pinnedActivityDOMCounts="not recorded";pinnedActivityTimestampStage=PinnedTimestampState.notStarted.rawValue;pinnedActivityTimestampExpected=false;pinnedActivityTimestampDispatchStage="not_evaluated";pinnedActivityTimestampDispatchReason="none";pinnedActivityTimestampItemsCreated=0;pinnedActivityTimestampResolverInvoked=false;pinnedActivityTimestampResolverEntered=false;pinnedActivityDispatchTimeoutTask?.cancel();pinnedActivityDispatchTimeoutTask=nil;pinnedActivityTimestampItemStates=[];pinnedActivityTimestampErrors=0;pinnedActivityTimestampTimeouts=0;pinnedActivityTimestampReason="none";pinnedActivityChildTerminalReason="none";pinnedActivityResolverTask?.cancel();pinnedActivityResolverTask=nil;pinnedActivityTop="not_run";pinnedActivityTopReason="not_run";pinnedActivityPrefix="not_run";pinnedActivityReason="not_run";pinnedActivityRowsInspected=0;pinnedActivityCleanup="not_run"
        pinnedActivity429Observed=false;pinnedActivity429Family="unknown";pinnedActivity429Owner="none";pinnedActivity429Stage="none";pinnedActivity429Relevant=false
        pinnedActivityTimestampSubstage="not_started";pinnedActivityTimestampProvenance=[];pinnedActivityPassiveLookup="not_run";pinnedActivityPassiveSummaries=[];pinnedActivityPassiveMatchingRecords=0;pinnedActivityPassiveUpdateTimePresent=false;pinnedActivityFallbackStarted=false;pinnedActivityRouteLoaded=false;pinnedActivityNavigationCompleted=false;pinnedActivityActivityResponseSeen=false;pinnedActivityTimestampFieldSeen=false;pinnedActivityTimestampFieldType="unknown";pinnedActivityActivityEndpointFamily="unknown";pinnedActivityBackendObservationActive=false;pinnedActivityObservationWindow=nil;pinnedActivityObservationWindowStarted=false;pinnedActivityJSObserverArmCallExecuted=false;pinnedActivityObservedResponseSequences=[];pinnedActivityBackendResponsesObserved=0;pinnedActivityBackendConversationRelated=0;pinnedActivityBackendExpectedMatches=0;pinnedActivityBackendTimestampFieldMatches=0;pinnedActivityBackendTimestampBearingMatches=0;pinnedActivityBackendItemExpectedMatches=0;pinnedActivityBackendItemTimestampFieldMatches=0;pinnedActivityBackendItemTimestampBearingMatches=0;pinnedActivityBackendFamilies=[:];pinnedActivityBackendResponseSummaries=[];pinnedActivityFrontendRoute=nil;pinnedActivityNavigationTemplate="unknown";pinnedActivityNavigationStage="not_started";pinnedActivityNavigationOperationToken=nil;pinnedActivityNavigation=nil;pinnedActivityNavigationCommandSent=false;pinnedActivityNavigationCommandAccepted=false;pinnedActivityProvisionalStarted=false;pinnedActivityNavigationCommitted=false;pinnedActivityNavigationFinished=false;pinnedActivityRouteConfirmed=false;pinnedActivityNavigationError="none";pinnedActivityPreNavigationStage="not_started";pinnedActivityPreNavigationReason="none";pinnedActivityPreNavigationStages=[];pinnedActivityWebViewAvailable=false;pinnedActivityWebViewAttached=false;pinnedActivityRenderLeaseVerified=false;pinnedActivityMainActorEntered=false;pinnedActivityLateNavigationReason="none";pinnedActivityPendingResponse=nil;pinnedActivityBufferHit=false;pinnedActivityLiveWaitStarted=false;pinnedActivityWaiterArmed=false;pinnedActivityWaiterWasArmedBeforeLoad=false;pinnedActivityWaiterToken=nil;pinnedActivityWaiterConversationID=nil;pinnedActivityWaiterOrdinal=nil;pinnedActivityUnrelatedActivityEvents=0;pinnedActivityCacheRecheck="not used";pinnedActivityNavigationMenuCleanup="unknown";pinnedActivityRenderLeaseCleanup="not_required";pinnedActivityOverallCleanup="unknown";backgroundRenderLeaseRestoreDetails="not attempted"
        pinnedActivityLiveWaitTimeoutTask?.cancel();pinnedActivityLiveWaitTimeoutTask=nil;pinnedActivityLiveWaitState="not_started";pinnedActivityLiveWaitStartedAt=nil;pinnedActivityLiveWaitDurationMs="not_run";pinnedActivityLiveWaitResult=nil;pinnedActivityLiveWaitContinuation=nil;pinnedActivityLiveWaitDeadlineActive=false;pinnedActivityLiveWaitDeadlineElapsed=false;pinnedActivityGenericTimeoutActivityState="not_started";pinnedActivityGenericTimeoutDeadlineActive=false;pinnedActivityGenericTimeoutDeadlineElapsed=false
        pinnedActivityNavigationURLObservation?.invalidate();pinnedActivityNavigationURLObservation=nil;pinnedActivityNavigationObservationTask?.cancel();pinnedActivityNavigationObservationTask=nil;pinnedActivityNavigationSnapshotSummary="not_run";pinnedActivityCurrentRouteBefore="unknown";pinnedActivityNavigationMethod="not_run";pinnedActivitySidebarRowReresolved=false;pinnedActivitySidebarCommandReceived=false;pinnedActivitySidebarScrollRequired=false;pinnedActivitySidebarRowVisible="unknown";pinnedActivitySidebarClickDelivered=false;pinnedActivitySidebarClickDefaultPrevented="unknown";pinnedActivitySidebarRouteAfter="not_run";pinnedActivityNavigationCleanup="not_attempted";pinnedActivityNavigationOriginURL=nil;pinnedActivityTargetDiffersFromCurrent=false;pinnedActivityNavigationObjectReturned=false;pinnedActivityNavigationDelegateExists=false;pinnedActivityNavigationDelegateCorrect=false;pinnedActivityNavigationURLChanged=false;pinnedActivityNavigationTargetURLObserved=false;pinnedActivityNavigationProgressChanged=false;pinnedActivityNavigationInitialProgress=0;pinnedActivityNavigationStartedAt=nil;pinnedActivityNavigationDiagnosticReason="none";pinnedSidebarRowLookupTimeoutTask?.cancel();pinnedSidebarRowLookupTimeoutTask=nil;pinnedSidebarRouteWaitTimeoutTask?.cancel();pinnedSidebarRouteWaitTimeoutTask=nil;pinnedActivitySidebarAnchorScanComplete=false;pinnedActivitySidebarTotalAnchors=0;pinnedActivitySidebarConversationAnchors=0;pinnedActivitySidebarMatchingAnchors=0;pinnedActivitySidebarRowLookupTerminal=false;pinnedActivitySidebarLookupErrorCategory="none";pinnedActivitySidebarActivationMethod="not_run";pinnedActivitySidebarAnchorFound=false;pinnedActivitySidebarHrefMatchesExpected=false;pinnedActivitySidebarTargetAttributePresent=false;pinnedActivitySidebarDownloadAttributePresent=false;pinnedActivitySidebarAnchorClickInvoked=false;pinnedActivitySidebarRouteChangedImmediately="unknown";pinnedActivitySidebarRouteChangedDuringWait=false
        pinnedSidebarNavigationDispatchTimeoutTask?.cancel();pinnedSidebarNavigationDispatchTimeoutTask=nil
        pinnedSidebarNavigationAckTimeoutTask?.cancel();pinnedSidebarNavigationAckTimeoutTask=nil
        pinnedActivityAutomationBridgePresent=false;pinnedActivitySidebarHandlerPresent=false
        pinnedActivitySidebarDispatchPrimitive="not_run";pinnedActivitySidebarCommandAckState="not_started"
        pinnedActivityJSPromiseStatus="pending";pinnedActivitySwiftCompletion="pending"
        pinnedActivityLifecycleStages=[]
        pinnedActivityLeaseStages=[];pinnedActivityLeaseFailureReason="none"
        backgroundRenderLeaseReport="acquiring · exclusive non-key render lease"
        pinnedActivityCutoffTimestamp=Date().timeIntervalSince1970*1000-6*60*60*1000
        setLastIsolatedDiagnostic(pinnedActivityStatusText())
        updatePinnedActivityStage("render_lease_started",token:token,timeoutSeconds:14)
        armPinnedActivityOverallDeadline(token:token,budgetMs:120_000,reason:"diagnostic_timeout")
        Task { @MainActor [weak self] in
            guard let self else{return}
            do {
                try await self.acquireBackgroundRenderSurfaceForPinnedDiagnostic(owner:token)
                guard self.pinnedActivityDiagnosticToken==token else {
                    _=self.restoreBackgroundRenderSurface(owner:token);return
                }
                self.pinnedActivityPreflightSummary="render lease · \(self.backgroundRenderLeaseReport)"
                self.updatePinnedActivityStage("render_lease_acquired",token:token,timeoutSeconds:nil)
                self.startPinnedActivityProbe(token:token)
            } catch {
                guard self.pinnedActivityDiagnosticToken==token else{return}
                let primary=self.renderLeaseFailureReason(error)
                let cleanupFailed=self.backgroundRenderLeaseReport.contains("cleanupFailureReason render_surface_restore_failed") || self.backgroundRenderLeaseReport.contains("cleanup failed") || self.backgroundRenderLeaseReport.contains("restored no")
                self.pinnedActivityPrimaryFailureReason=primary
                self.pinnedActivityCleanupFailureReason=cleanupFailed ? "render_surface_restore_failed":"none"
                self.pinnedActivityLaunchStage="rejected"
                self.pinnedActivityLaunchReason=primary
                self.pinnedActivityReason=primary
                let readiness=self.backgroundRenderLeaseReadiness
                self.pinnedActivityReadiness=readiness["status"] as? String ?? (primary == "render_surface_unavailable" ? primary:"render_surface_unavailable")
                self.pinnedActivityRowsAtFirstDetection=(readiness["rowsAtFirstDetection"] as? NSNumber)?.intValue ?? 0
                self.pinnedActivityFirstPositiveCount=(readiness["firstPositiveCount"] as? NSNumber)?.intValue ?? 0
                self.pinnedActivityRowsAtStabilizedSnapshot=(readiness["rowsAtStabilizedSnapshot"] as? NSNumber)?.intValue ?? 0
                self.pinnedActivityStableCount=(readiness["finalStableCount"] as? NSNumber)?.intValue ?? 0
                self.pinnedActivityFinalSnapshotCount=(readiness["finalSnapshotCount"] as? NSNumber)?.intValue ?? 0
                self.pinnedActivityConversationSignatureChanges=(readiness["conversationSignatureChanges"] as? NSNumber)?.intValue ?? 0
                self.pinnedActivityTerminalReason=readiness["rawStatus"] as? String ?? primary
                self.pinnedActivityTopReason=self.pinnedActivityReadiness
                self.pinnedActivityPrefixReason=self.pinnedActivityReadiness
                self.pinnedActivityTimestampStage=PinnedTimestampState.skipped.rawValue
                self.pinnedActivityTimestampReason="prefix_incomplete"
                self.pinnedActivityCleanup=cleanupFailed ? "incomplete":"successful"
                self.finishPinnedActivityDiagnostic()
            }
        }
    }
    func rejectPinnedActivityLaunch(_ reason:String) {
        pinnedActivityLaunchPending=false
        pinnedActivityLaunchStage="rejected"
        pinnedActivityLaunchReason=reason
        pinnedActivityLastLaunchRejection=reason
        setLastIsolatedDiagnostic("Last isolated diagnostic: State: rejected\nStage: gate_check_started\nReason: \(reason)\nOperation active: \(pinnedActivityDiagnosticToken == nil ? "No":"Yes")")
    }
    func armPinnedActivityBridgeAckDeadline(token:String) {
        pinnedActivityLaunchAckTask?.cancel()
        pinnedActivityLaunchAckTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:3_000_000_000)
            guard !Task.isCancelled,let self,self.pinnedActivityDiagnosticToken==token,
                  self.pinnedActivityLaunchStage=="bridge_invocation_started" else{return}
            self.failPinnedActivityStage("bridge_start_timeout",token:token)
        }
    }
    func startPinnedActivityProbe(token:String) {
        guard pinnedActivityDiagnosticToken==token else{return}
        pinnedActivityLaunchStage="bridge_invocation_started"
        updatePinnedActivityStage("diagnostic_readiness_started",token:token,timeoutSeconds:20)
        setLastIsolatedDiagnostic(pinnedActivityStatusText())
        armPinnedActivityBridgeAckDeadline(token:token)
        web.evaluateJavaScript("window.pinnedDiagnosticVersion || null") { [weak self] value,error in
            DispatchQueue.main.async {
                guard let self,self.pinnedActivityDiagnosticToken==token else{return}
                guard error==nil,(value as? String)==self.pinnedDiagnosticVersion else {
                    self.pinnedActivityLaunchStage="failed";self.pinnedActivityLaunchReason="bridge_start_failed";self.pinnedActivityReason="bridge_start_failed";self.pinnedActivityTimestampStage=PinnedTimestampState.skipped.rawValue
                    self.pinnedActivityTimestampReason="prefix_incomplete";self.finishPinnedActivityDiagnostic();return
                }
                let encoded=String(data:try! JSONSerialization.data(withJSONObject:[token]),encoding:.utf8)!
                let webViewVisible = !self.web.isHidden && self.web.window?.isVisible == true
                let navigationActive = self.web.isLoading
                self.pinnedActivityLaunchStage="bridge_invocation_started"
                self.setLastIsolatedDiagnostic(self.pinnedActivityStatusText())
                self.armPinnedActivityBridgeAckDeadline(token:token)
                let activationElapsed=self.backgroundRenderLeaseActivatedAt.map{Int(Date().timeIntervalSince($0)*1000)}
                let firstLinksLatency=self.backgroundRenderLeaseTimeToFirstConversationLinkMs
                let activationElapsedArgument=activationElapsed.map(String.init) ?? "null"
                let firstLinksLatencyArgument=firstLinksLatency.map(String.init) ?? "null"
                let script="window.gptPinnedActivityDiagnosticToken=\(encoded)[0]; window.gptSetRateLimitContext?.('isolated_prefix_diagnostic',\(encoded)[0],'sidebar_readiness'); void window.gptInspectVisiblePinnedRows({maxRows:20,hardTimeoutMs:600000,preflightTimeoutMs:18000,normalizeTop:true,webViewVisible:\(webViewVisible),navigationActive:\(navigationActive),renderActivationElapsedMs:\(activationElapsedArgument),renderLeaseTimeToFirstConversationLinkMs:\(firstLinksLatencyArgument),includePinnedRecords:true,activityDiagnosticToken:\(encoded)[0]}).then(result=>window.webkit.messageHandlers.starredDiagnostic.postMessage({pinnedActivityResult:result,activityDiagnosticToken:\(encoded)[0],jsPromiseStatus:'resolved'})).catch(()=>window.webkit.messageHandlers.starredDiagnostic.postMessage({pinnedActivityError:'probe_failed',activityDiagnosticToken:\(encoded)[0],jsPromiseStatus:'rejected'})); true;"
                self.web.evaluateJavaScript(script) { _,invokeError in
                    DispatchQueue.main.async {
                        guard self.pinnedActivityDiagnosticToken==token else{return}
                        self.pinnedActivitySwiftCompletion=invokeError == nil ? "received" : "error"
                        if invokeError != nil {self.pinnedActivityLaunchReason="bridge_start_failed";self.pinnedActivityPrefix="invocation_failed";self.pinnedActivityTopReason="bridge_delivery_failed";self.pinnedActivityReason="bridge_start_failed";self.failPinnedActivityStage("bridge_start_failed",token:token)}
                        else {self.setLastIsolatedDiagnostic(self.pinnedActivityStatusText())}
                    }
                }
            }
        }
    }
    func pinnedActivityStatusText()->String {
        return pinnedActivityStatusTextBase()+"\nDiagnostic lifecycle: \(pinnedActivityLifecycleStages.isEmpty ? "not started":pinnedActivityLifecycleStages.joined(separator:" → "))\nActivity lease stages: \(pinnedActivityLeaseStages.isEmpty ? "not started":pinnedActivityLeaseStages.joined(separator:" → ")) · failure \(pinnedActivityLeaseFailureReason)\nScroll owner: \(pinnedActivityScrollOwnerSummary)\nScroll attempts: \(pinnedActivityScrollAttemptsSummary)\nBudget: total \(pinnedActivityTotalBudgetMs) ms · traversal \(pinnedActivityTraversalBudgetMs) ms · cleanup reserve \(pinnedActivityCleanupReserveMs) ms\nRows: processed \(pinnedActivityProcessedRows) · pinned \(pinnedActivityPinnedCount) · ordinary \(pinnedActivityOrdinaryCount) · unknown \(pinnedActivityUnknownCount) · first ordinary \(pinnedActivityFirstOrdinaryFound ? "Yes":"No")\nActivity: attempted \(pinnedActivityAttemptedCount) · resolved \(pinnedActivityResolved)"
    }
    func pinnedActivityStatusTextBase()->String {
        let provenance=pinnedActivityTimestampProvenance.suffix(8).joined(separator:" → ")
        let active=pinnedActivityDiagnosticToken == nil ? "No":"Yes"
        return "Last isolated diagnostic: v\(pinnedDiagnosticVersion) · launch stage: \(pinnedActivityLaunchStage) · operation active: \(active) · launch reason: \(pinnedActivityLaunchReason) · last rejection: \(pinnedActivityLastLaunchRejection)\nDiagnostic stage: \(pinnedActivityStage) · timestamp: \(pinnedActivityTimestampStage)/\(pinnedActivityTimestampSubstage) · JS promise: \(pinnedActivityJSPromiseStatus) · Swift completion: \(pinnedActivitySwiftCompletion)\nTimestamp dispatch: \(pinnedActivityTimestampDispatchStage) · allowed \(["allowed","items_created","resolver_invoked","resolver_entered","passive_lookup_started","fallback_started"].contains(pinnedActivityTimestampDispatchStage) ? "Yes":"No") · reason \(pinnedActivityTimestampDispatchReason) · items created \(pinnedActivityTimestampItemsCreated) · resolver invoked \(pinnedActivityTimestampResolverInvoked ? "Yes":"No") · entered \(pinnedActivityTimestampResolverEntered ? "Yes":"No")\nReadiness: \(pinnedActivityReadiness) · firstPositiveCount \(pinnedActivityFirstPositiveCount) · finalStableCount \(pinnedActivityStableCount) · signature changes \(pinnedActivityConversationSignatureChanges) · unrelated mutation checks \(pinnedActivityUnrelatedMutationChecks) · timeToStable \(pinnedActivityTimeToStableMs) ms · terminalReason \(pinnedActivityTerminalReason)\nFailure reasons: primary \(pinnedActivityPrimaryFailureReason) · cleanup \(pinnedActivityCleanupFailureReason)\nPre-navigation: \(pinnedNavigationPreflightSummary())\nHTTP 429: \(pinnedActivity429Observed ? "Yes":"No") · family \(pinnedActivity429Family) · owner \(pinnedActivity429Owner) · stage \(pinnedActivity429Stage) · relevant \(pinnedActivity429Relevant ? "Yes":"No")\nBridge dispatch: automation bridge \(pinnedActivityAutomationBridgePresent ? "Yes":"No") · sidebar handler \(pinnedActivitySidebarHandlerPresent ? "Yes":"No") · primitive result \(pinnedActivitySidebarDispatchPrimitive) · command acknowledgement \(pinnedActivitySidebarCommandAckState)\nSidebar bridge: command received \(pinnedActivitySidebarCommandReceived ? "Yes":"No") · lookup started \(pinnedActivityPreNavigationStages.contains("sidebar_row_lookup_started") ? "Yes":"No") · row re-resolved \(pinnedActivitySidebarRowReresolved ? "Yes":"No") · row visible \(pinnedActivitySidebarRowVisible) · scroll required \(pinnedActivitySidebarScrollRequired ? "Yes":"No") · terminal \(pinnedActivityNavigationDiagnosticReason)\nSidebar activation: method \(pinnedActivitySidebarActivationMethod) · anchor found \(pinnedActivitySidebarAnchorFound ? "Yes":"No") · href matches expected \(pinnedActivitySidebarHrefMatchesExpected ? "Yes":"No") · target attr \(pinnedActivitySidebarTargetAttributePresent ? "Yes":"No") · download attr \(pinnedActivitySidebarDownloadAttributePresent ? "Yes":"No") · anchor.click invoked \(pinnedActivitySidebarAnchorClickInvoked ? "Yes":"No") · route changed immediately \(pinnedActivitySidebarRouteChangedImmediately) · route changed during wait \(pinnedActivitySidebarRouteChangedDuringWait ? "Yes":"No")\nNavigation: method \(pinnedActivityNavigationMethod) · sidebar row re-resolved \(pinnedActivitySidebarRowReresolved ? "Yes":"No") · click delivered \(pinnedActivitySidebarClickDelivered ? "Yes":"No") · defaultPrevented \(pinnedActivitySidebarClickDefaultPrevented) · route before/after \(pinnedActivityCurrentRouteBefore)/\(pinnedActivitySidebarRouteAfter) · command sent \(pinnedActivityNavigationCommandSent ? "Yes":"No")/accepted \(pinnedActivityNavigationCommandAccepted ? "Yes":"No") · object returned \(pinnedActivityNavigationObjectReturned ? "Yes":"No") · provisional \(pinnedActivityProvisionalStarted ? "Yes":"No") · committed \(pinnedActivityNavigationCommitted ? "Yes":"No") · finished \(pinnedActivityNavigationFinished ? "Yes":"No") · route confirmed \(pinnedActivityRouteConfirmed ? "Yes":"No") (\(pinnedActivityNavigationTemplate)) · error \(pinnedActivityNavigationError)\nNavigation observation: current \(pinnedActivityCurrentRouteBefore) · target differs \(pinnedActivityTargetDiffersFromCurrent ? "Yes":"No") · delegate exists/correct \(pinnedActivityNavigationDelegateExists ? "Yes":"No")/\(pinnedActivityNavigationDelegateCorrect ? "Yes":"No") · URL changed \(pinnedActivityNavigationURLChanged ? "Yes":"No") · target URL observed \(pinnedActivityNavigationTargetURLObserved ? "Yes":"No") · diagnostic \(pinnedActivityNavigationDiagnosticReason)\nNavigation snapshots: \(pinnedActivityNavigationSnapshotSummary)\nActivity observation window: native started \(pinnedActivityObservationWindowStarted ? "Yes":"No") · extra WebKit observer-arm call \(pinnedActivityJSObserverArmCallExecuted ? "Yes":"No")\nActivity waiter: armed before load \(pinnedActivityWaiterWasArmedBeforeLoad ? "Yes":"No") · buffer hit \(pinnedActivityBufferHit ? "Yes":"No") · live wait started \(pinnedActivityLiveWaitStarted ? "Yes":"No") · response \(pinnedActivityActivityResponseSeen ? "Yes":"No") · endpoint family \(pinnedActivityActivityEndpointFamily) · unrelated events \(pinnedActivityUnrelatedActivityEvents)\nPassive lookup: \(pinnedActivityPassiveLookup) · records \(pinnedActivityPassiveMatchingRecords) · update_time \(pinnedActivityPassiveUpdateTimePresent ? "Yes":"No") · fallback \(pinnedActivityFallbackStarted ? "Yes":"No") · response \(pinnedActivityActivityResponseSeen ? "Yes":"No") · timestamp field \(pinnedActivityTimestampFieldSeen ? "Yes":"No") (\(pinnedActivityTimestampFieldType))\n\(pinnedActivityBackendTrafficSummary())\nTimestamp provenance: \(provenance.isEmpty ? "none":provenance)\nPreflight: \(pinnedActivityPreflightSummary)"
    }
    func pinnedActivityBackendTrafficSummary()->String {
        let families=pinnedActivityBackendFamilies.keys.sorted().map{"\($0): \(pinnedActivityBackendFamilies[$0] ?? 0)"}.joined(separator:", ")
        return "Backend responses observed: \(pinnedActivityBackendResponsesObserved) · conversation-related: \(pinnedActivityBackendConversationRelated) · expected conversation matched: \(pinnedActivityBackendExpectedMatches) · timestamp-bearing matched: \(pinnedActivityBackendTimestampBearingMatches)\nEndpoint families: \(families.isEmpty ? "none":families)\nMatching response metadata: \(pinnedActivityBackendResponseSummaries.isEmpty ? "none":pinnedActivityBackendResponseSummaries.joined(separator:"; "))"
    }
    func pinnedNavigationPreflightSummary()->String {
        let routeAvailable=pinnedActivityPreNavigationStages.contains("route_available")
        let stages=pinnedActivityPreNavigationStages.isEmpty ? "none":pinnedActivityPreNavigationStages.joined(separator:" → ")
        return "last \(pinnedActivityPreNavigationStage) · reason \(pinnedActivityPreNavigationReason) · route available \(routeAvailable ? "yes":"no") · WebView \(pinnedActivityWebViewAvailable ? "yes":"no") / attached \(pinnedActivityWebViewAttached ? "yes":"no") · render lease verified \(pinnedActivityRenderLeaseVerified ? "yes":"no") · MainActor entered \(pinnedActivityMainActorEntered ? "yes":"no") · context user script installed \(pinnedActivityContextUserScriptInstalled ? "yes":"no") · stages [\(stages)] · late callback \(pinnedActivityLateNavigationReason) · anchor scan \(pinnedActivitySidebarAnchorScanComplete ? "complete":"not run") · anchors \(pinnedActivitySidebarTotalAnchors) / conversations \(pinnedActivitySidebarConversationAnchors) / matches \(pinnedActivitySidebarMatchingAnchors) · lookup error \(pinnedActivitySidebarLookupErrorCategory)"
    }
    func preflightSummary(_ data:[String:Any])->String {
        let state=data["documentReadyState"] as? String ?? "unknown"
        let path=data["pathTemplate"] as? String ?? "unknown"
        let body=(data["bodyPresent"] as? Bool)==true ? "yes":"no"
        let sidebar=(data["sidebarAvailable"] as? Bool)==true ? "yes":"no"
        let sidebarCandidates=(data["sidebarContainerCandidates"] as? NSNumber)?.intValue ?? 0
        let list=(data["listRegionAvailable"] as? Bool)==true ? "yes":"no"
        let listCandidates=(data["listRegionCandidates"] as? NSNumber)?.intValue ?? 0
        let links=(data["totalConversationRouteLinks"] as? NSNumber)?.intValue ?? 0
        let visible=(data["webViewVisible"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"
        let navigation=(data["navigationActive"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"
        let stage=data["stage"] as? String ?? "unknown"
        let reason=data["reason"] as? String ?? "none"
        let duration=(data["durationMs"] as? NSNumber)?.intValue ?? 0
        let firstLinks=data["renderLeaseTimeToFirstConversationLinkMs"] as? NSNumber
            ?? data["timeToFirstPositiveMs"] as? NSNumber
        let activationLatency=firstLinks.map { "first links \($0.intValue) ms after render activation" }
            ?? "first links latency unavailable"
        return "document \(state) · path \(path) · body \(body) · sidebar \(sidebar)(\(sidebarCandidates)) · list telemetry \(list)(\(listCandidates)) · route links \(links) · \(activationLatency) · WebView visible \(visible) · navigation active \(navigation) · stage \(stage) · reason \(reason) · \(duration) ms"
    }
    func pinnedActivityStageTimeout(_ stage:String)->Double? {
        switch stage {
        case "invoke_started": return 5
        case "render_lease_started": return 20
        case "readiness_started","diagnostic_readiness_started": return 20
        case "top_started": return 3
        case "prefix_started": return Double(pinnedActivityTraversalBudgetMs+pinnedActivityCleanupReserveMs)/1000
        case "timestamp_started": return nil
        case "cleanup_started": return Double(pinnedActivityCleanupReserveMs)/1000
        default: return nil
        }
    }
    func pinnedActivityBudget(rowCount:Int,pinnedCount:Int?=nil)->(totalMs:Int,traversalMs:Int,activityMs:Int) {
        let rows=min(32,max(1,rowCount))
        let traversal=min(90_000,max(15_000,5_000+rows*2_500))
        let activityRows=min(rows,max(0,pinnedCount ?? rows))
        let activity=max(120_000,45_000+activityRows*20_000)
        let total=min(600_000,20_000+5_000+traversal+activity+pinnedActivityCleanupReserveMs)
        return(total,traversal,activity)
    }
    func armPinnedActivityOverallDeadline(token:String,budgetMs:Int,reason:String) {
        guard pinnedActivityDiagnosticToken==token else{return}
        pinnedActivityTimeoutTask?.cancel()
        pinnedActivityTotalBudgetMs=max(1,budgetMs)
        let elapsed=Int(max(0,Date().timeIntervalSince(pinnedActivityStartedAt ?? Date())*1000))
        let remaining=max(1,pinnedActivityTotalBudgetMs-elapsed)
        pinnedActivityTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:UInt64(remaining)*1_000_000)
            guard !Task.isCancelled,let self,self.pinnedActivityDiagnosticToken==token else{return}
            let current=self.pinnedActivityStage
            let timeoutReason=current.hasPrefix("timestamp") || self.pinnedActivityTimestampResolverEntered ? "activity_resolution_timeout" : (current=="prefix_started" ? "traversal_timeout":reason)
            self.failPinnedActivityStage(timeoutReason,token:token)
        }
    }
    func handlePinnedActivityProgress(_ progress:[String:Any],token:String) {
        guard pinnedActivityDiagnosticToken==token,let stage=progress["stage"] as? String else{return}
        if stage=="probe_started" {
            pinnedActivityLaunchAckTask?.cancel();pinnedActivityLaunchAckTask=nil
            pinnedActivityLaunchStage="probe_started";pinnedActivityLaunchReason="none"
            updatePinnedActivityStage("probe_started",token:token,timeoutSeconds:nil)
            setLastIsolatedDiagnostic(pinnedActivityStatusText());return
        }
        // JS's "finished" is only a prefix-operation marker. Swift owns the
        // overall completion after timestamp state has reached a terminal value.
        if stage=="finished" {return}
        if stage=="timestamp_started" {
            pinnedActivityTimestampExpected=true
            let count=(progress["pinnedCount"] as? NSNumber)?.intValue ?? 0
            if pinnedActivityTimestampItemStates.isEmpty,count>0 {pinnedActivityPinnedCount=count;pinnedActivityTimestampItemStates=Array(repeating:"pending",count:count)}
            if !(PinnedTimestampState(rawValue:pinnedActivityTimestampStage) ?? .notStarted).isTerminal {pinnedActivityTimestampStage=PinnedTimestampState.resolving.rawValue}
        }
        if stage=="timestamp_dispatch_evaluated" {
            pinnedActivityTimestampDispatchStage="evaluated"
            pinnedActivityTimestampDispatchReason=progress["reason"] as? String ?? "none"
        } else if stage=="timestamp_dispatch_allowed" {
            pinnedActivityTimestampDispatchStage="allowed"
            pinnedActivityTimestampDispatchReason="none"
        } else if stage=="timestamp_dispatch_blocked" {
            pinnedActivityTimestampDispatchStage="blocked"
            pinnedActivityTimestampDispatchReason=progress["reason"] as? String ?? "timestamp_dispatch_blocked"
        }
        if let status=progress["status"] as? String,stage=="readiness_completed" {pinnedActivityReadiness=status}
        if stage=="readiness_preflight",let preflight=progress["preflight"] as? [String:Any] {
            pinnedActivityPreflightSummary=preflightSummary(preflight)
            setLastIsolatedDiagnostic(pinnedActivityStatusText())
        }
        if stage=="readiness_preflight",let preflight=progress["preflight"] as? [String:Any] {
            pinnedActivityPreflightSummary=preflightSummary(preflight)
            setLastIsolatedDiagnostic(pinnedActivityStatusText())
        }
        if stage=="readiness_completed" {
            pinnedActivityRowsAtFirstDetection=(progress["rowsAtFirstDetection"] as? NSNumber)?.intValue ?? pinnedActivityRowsAtFirstDetection
            pinnedActivityRowsAtStabilizedSnapshot=(progress["rowsAtStabilizedSnapshot"] as? NSNumber)?.intValue ?? pinnedActivityRowsAtStabilizedSnapshot
            pinnedActivityFirstPositiveCount=(progress["firstPositiveCount"] as? NSNumber)?.intValue ?? 0
            pinnedActivityConversationSignatureChanges=(progress["conversationSignatureChanges"] as? NSNumber)?.intValue ?? 0
            pinnedActivityMutationChecks=(progress["mutationChecks"] as? NSNumber)?.intValue ?? 0
            pinnedActivityUnrelatedMutationChecks=(progress["unrelatedMutationChecks"] as? NSNumber)?.intValue ?? 0
            pinnedActivityStableCount=(progress["finalStableCount"] as? NSNumber)?.intValue ?? (progress["stableCount"] as? NSNumber)?.intValue ?? 0
            pinnedActivityFinalSnapshotCount=(progress["finalSnapshotCount"] as? NSNumber)?.intValue ?? 0
            pinnedActivityTimeToFirstPositiveMs=(progress["timeToFirstPositiveMs"] as? NSNumber).map{String(format:"%.0f",$0.doubleValue)} ?? "unknown"
            pinnedActivityTimeToStableMs=(progress["timeToStableMs"] as? NSNumber).map{String(format:"%.0f",$0.doubleValue)} ?? "unknown"
            pinnedActivityTerminalReason=progress["terminalReason"] as? String ?? "unknown"
            let stableRows=pinnedActivityStableCount>0 ? pinnedActivityStableCount:pinnedActivityFirstPositiveCount
            if stableRows>0 {
                let budget=pinnedActivityBudget(rowCount:stableRows)
                pinnedActivityTraversalBudgetMs=budget.traversalMs
                armPinnedActivityOverallDeadline(token:token,budgetMs:budget.totalMs,reason:"diagnostic_timeout")
            }
        }
        if stage=="prefix_started",let owner=progress["scrollOwner"] as? [String:Any] {
            let found=(owner["found"] as? Bool)==true ? "yes":"no"
            let connected=(owner["connected"] as? Bool)==true ? "yes":"no"
            let tag=owner["tag"] as? String ?? "unknown",overflow=owner["overflowY"] as? String ?? "unknown"
            func metric(_ key:String)->String {(owner[key] as? NSNumber).map{String($0.intValue)} ?? "unknown"}
            pinnedActivityScrollOwnerSummary="found \(found) · tag \(tag) · scrollTop \(metric("scrollTop")) · scrollHeight \(metric("scrollHeight")) · clientHeight \(metric("clientHeight")) · overflow-y \(overflow) · connected \(connected)"
        }
        if stage=="prefix_started",let traversalMs=(progress["traversalBudgetMs"] as? NSNumber)?.intValue {
            pinnedActivityTraversalBudgetMs=min(90_000,max(15_000,traversalMs))
            pinnedActivityTraversalActive=true
            pinnedActivityTraversalDeadline=Date().addingTimeInterval(Double(pinnedActivityTraversalBudgetMs+pinnedActivityCleanupReserveMs)/1000)
            if let snapshotRows=(progress["snapshotCount"] as? NSNumber)?.intValue,snapshotRows>0 {
                pinnedActivityInitialSnapshotCount=snapshotRows;pinnedActivityPrefixSnapshotCount=snapshotRows
                let budget=pinnedActivityBudget(rowCount:snapshotRows)
                armPinnedActivityOverallDeadline(token:token,budgetMs:budget.totalMs,reason:"diagnostic_timeout")
            }
        }
        if stage=="row_classified" || stage=="prefix_completed" || stage=="menu_cleanup_started" {
            if let snapshotRows=(progress["snapshotCount"] as? NSNumber)?.intValue {pinnedActivityPrefixSnapshotCount=snapshotRows;if pinnedActivityInitialSnapshotCount==0 {pinnedActivityInitialSnapshotCount=snapshotRows}}
            if let finalRows=(progress["finalSnapshotCount"] as? NSNumber)?.intValue {pinnedActivityFinalPrefixSnapshotCount=finalRows}
            pinnedActivityProcessedRows=(progress["processedRows"] as? NSNumber)?.intValue ?? pinnedActivityProcessedRows
            pinnedActivityPinnedCount=(progress["pinnedCount"] as? NSNumber)?.intValue ?? pinnedActivityPinnedCount
            pinnedActivityOrdinaryCount=(progress["ordinaryCount"] as? NSNumber)?.intValue ?? pinnedActivityOrdinaryCount
            pinnedActivityUnknownCount=(progress["unknownCount"] as? NSNumber)?.intValue ?? pinnedActivityUnknownCount
            pinnedActivityFirstOrdinaryFound=(progress["firstOrdinaryFound"] as? Bool) ?? pinnedActivityFirstOrdinaryFound
            if stage=="prefix_completed" {
                pinnedActivityTraversalActive=false;pinnedActivityTraversalDeadline=nil
                let budget=pinnedActivityBudget(rowCount:max(1,pinnedActivityStableCount),pinnedCount:pinnedActivityPinnedCount)
                armPinnedActivityOverallDeadline(token:token,budgetMs:budget.totalMs,reason:"diagnostic_timeout")
            }
        }
        if stage=="row_classified" {
            resumePinnedActivityTraversalWatchdog(token:token)
            setLastIsolatedDiagnostic(pinnedActivityStatusText())
            return
        }
        if stage=="menu_cleanup_started" {
            pinnedActivityProcessedRows=(progress["processedRows"] as? NSNumber)?.intValue ?? pinnedActivityProcessedRows
            pinnedActivityPinnedCount=(progress["pinnedCount"] as? NSNumber)?.intValue ?? pinnedActivityPinnedCount
            pinnedActivityOrdinaryCount=(progress["ordinaryCount"] as? NSNumber)?.intValue ?? pinnedActivityOrdinaryCount
            pinnedActivityUnknownCount=(progress["unknownCount"] as? NSNumber)?.intValue ?? pinnedActivityUnknownCount
            pinnedActivityFirstOrdinaryFound=(progress["firstOrdinaryFound"] as? Bool) ?? pinnedActivityFirstOrdinaryFound
            // Per-row menu dismissal is part of traversal, not the final
            // diagnostic cleanup stage. Keep its own short watchdog so it
            // cannot replace the traversal deadline or become cleanup_timeout.
            pinnedActivityMenuCleanupTimeoutTask?.cancel()
            pinnedActivityMenuCleanupTimeoutTask=Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds:2_000_000_000)
                guard !Task.isCancelled,let self,self.pinnedActivityDiagnosticToken==token else{return}
                self.failPinnedActivityStage("menu_cleanup_timeout",token:token)
            }
            setLastIsolatedDiagnostic(pinnedActivityStatusText())
            return
        }
        if stage=="menu_cleanup_completed" {
            pinnedActivityMenuCleanupTimeoutTask?.cancel();pinnedActivityMenuCleanupTimeoutTask=nil
            if let successful=progress["successful"] as? Bool,!successful {
                pinnedActivityCleanup="incomplete";pinnedActivityNavigationMenuCleanup="failed"
                if pinnedActivityCleanupFailureReason=="none" {pinnedActivityCleanupFailureReason="menu_cleanup_failed"}
            }
            setLastIsolatedDiagnostic(pinnedActivityStatusText())
            return
        }
        if stage=="timestamp_started",let ordinal=(progress["ordinal"] as? NSNumber)?.intValue {pinnedActivityAttemptedCount=max(pinnedActivityAttemptedCount,ordinal)}
        if let status=progress["status"] as? String,stage=="top_completed" {pinnedActivityTop=status}
        if let successful=progress["successful"] as? Bool,stage=="cleanup_completed" {pinnedActivityCleanup=successful ? "successful":"incomplete";pinnedActivityNavigationMenuCleanup=successful ? "success":"failed"}
        if stage=="cleanup_completed",pinnedActivityTraversalActive {resumePinnedActivityTraversalWatchdog(token:token);return}
        if let promise=progress["jsPromiseStatus"] as? String {pinnedActivityJSPromiseStatus=promise}
        updatePinnedActivityStage(stage,token:token,timeoutSeconds:pinnedActivityStageTimeout(stage))
        if stage=="readiness_completed" || stage=="top_completed" || stage=="prefix_completed" || stage=="cleanup_completed" || stage=="finished" {
            pinnedActivityStageTimeoutTask?.cancel();pinnedActivityStageTimeoutTask=nil
            setLastIsolatedDiagnostic(pinnedActivityStatusText())
        }
    }
    func resumePinnedActivityTraversalWatchdog(token:String) {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityTraversalActive,let deadline=pinnedActivityTraversalDeadline else{return}
        let remaining=deadline.timeIntervalSinceNow
        guard remaining>0 else {failPinnedActivityStage("traversal_timeout",token:token);return}
        updatePinnedActivityStage("prefix_started",token:token,timeoutSeconds:remaining)
    }
    func updatePinnedActivityStage(_ stage:String,token:String,timeoutSeconds:Double?) {
        guard pinnedActivityDiagnosticToken==token else{return}
        if stage=="finished",!pinnedDiagnosticCanFinish(timestampExpected:pinnedActivityTimestampExpected,timestampState:PinnedTimestampState(rawValue:pinnedActivityTimestampStage) ?? .notStarted,itemStates:pinnedActivityTimestampItemStates) {return}
        if ["render_lease_acquired","diagnostic_readiness_started","snapshot_ready","traversal_started"].contains(stage),pinnedActivityLifecycleStages.last != stage {pinnedActivityLifecycleStages.append(stage)}
        pinnedActivityStage=stage;pinnedActivityStageTimeoutTask?.cancel();pinnedActivityStageTimeoutTask=nil
        if let timeoutSeconds {
            pinnedActivityStageTimeoutTask=Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds:UInt64(timeoutSeconds*1_000_000_000))
                guard !Task.isCancelled else{return}
                guard let self,self.pinnedActivityDiagnosticToken==token,self.pinnedActivityStage==stage else{return}
                let reason=stage=="prefix_started" ? "traversal_timeout" : stage=="cleanup_started" ? "menu_cleanup_timeout" : "stage_timeout:\(stage)"
                self.failPinnedActivityStage(reason,token:token)
            }
        }
        setLastIsolatedDiagnostic(pinnedActivityStatusText())
    }
    func failPinnedActivityStage(_ reason:String,token:String) {
        guard pinnedActivityDiagnosticToken==token else{return}
        // If the activity child is live, even the outer diagnostic safety
        // deadline must complete that child first. Its awaited parent owns
        // the timestamp item and preserves the activity-specific reason.
        if pinnedActivityLiveWaitState=="waiting",
           let id=pinnedActivityExpectedConversationID,let ordinal=pinnedActivityExpectedOrdinal {
            pinnedActivityGenericTimeoutActivityState=pinnedActivityLiveWaitState
            pinnedActivityGenericTimeoutDeadlineActive=pinnedActivityLiveWaitDeadlineActive
            pinnedActivityGenericTimeoutDeadlineElapsed=true
            pinnedActivityLiveWaitDeadlineElapsed=true
            finishPinnedActivityLiveWait(token:token,id:id,ordinal:ordinal,result:.timeout)
            return
        }
        clearPinnedNavigationObservers()
        if reason=="bridge_start_timeout" || reason=="bridge_start_failed" {
            pinnedActivityLaunchStage="failed";pinnedActivityLaunchReason=reason
        }
        pinnedActivityReason=reason
        if pinnedActivityTimestampExpected && !((PinnedTimestampState(rawValue:pinnedActivityTimestampStage) ?? .notStarted).isTerminal) {
            let target:PinnedTimestampState=reason.hasPrefix("stage_timeout:") || reason=="diagnostic_timeout" || reason=="activity_resolution_timeout" ? .timeout : .error
            for index in pinnedActivityTimestampItemStates.indices where pinnedActivityTimestampItemStates[index]=="pending" {pinnedActivityTimestampItemStates[index]=target.rawValue}
            pinnedActivityTimestampTimeouts=pinnedActivityTimestampItemStates.filter{$0==PinnedTimestampState.timeout.rawValue}.count
            pinnedActivityTimestampErrors=pinnedActivityTimestampItemStates.filter{$0==PinnedTimestampState.error.rawValue}.count
            let aggregate=pinnedTimestampAggregateState(resolved:pinnedActivityResolved,total:pinnedActivityPinnedCount,timeouts:pinnedActivityTimestampTimeouts,errors:pinnedActivityTimestampErrors)
            pinnedActivityTimestampStage=pinnedActivityPinnedCount==0 ? target.rawValue:aggregate.rawValue
            pinnedActivityTimestampReason=pinnedTimestampFailureReason(childReason:pinnedActivityChildTerminalReason,fallbackReason:target == .timeout ? "timestamp_timeout":"timestamp_error")
        } else if !pinnedActivityTimestampExpected && !((PinnedTimestampState(rawValue:pinnedActivityTimestampStage) ?? .notStarted).isTerminal) {
            pinnedActivityTimestampStage=PinnedTimestampState.skipped.rawValue
        }
        if pinnedActivityExpectedConversationID != nil {
            web.stopLoading()
            web.evaluateJavaScript("window.gptSetRateLimitContext?.('unrelated_passive_traffic',null,'page_idle')",completionHandler:nil)
        }
        if reason.contains("readiness") {pinnedActivityReadiness=reason}
        if reason.contains("top_started") {pinnedActivityTop="unproven";pinnedActivityTopReason=reason}
        if reason.contains("prefix_started") || reason=="traversal_timeout" {pinnedActivityPrefix="pinned_prefix_unproven"}
        if reason=="menu_cleanup_timeout" || reason=="menu_cleanup_failed" {
            pinnedActivityCleanup="incomplete";pinnedActivityNavigationMenuCleanup="failed"
            if pinnedActivityCleanupFailureReason=="none" {pinnedActivityCleanupFailureReason=reason}
            pinnedActivityPrefixReason=reason
        }
        if reason=="render_cleanup_timeout" {
            pinnedActivityRenderLeaseCleanup="failed"
            if pinnedActivityCleanupFailureReason=="none" {pinnedActivityCleanupFailureReason=reason}
        }
        if reason.contains("cleanup_started") || reason=="cleanup_timeout" || reason=="menu_cleanup_timeout" || reason=="menu_cleanup_failed" {
            pinnedActivityCleanup="incomplete";pinnedActivityNavigationMenuCleanup="failed"
            if pinnedActivityCleanupFailureReason=="none" {pinnedActivityCleanupFailureReason=reason}
        }
        pinnedActivityJSPromiseStatus = (reason.hasPrefix("stage_timeout:") || reason=="traversal_timeout" || reason=="activity_resolution_timeout") ? "pending (timed out)" : pinnedActivityJSPromiseStatus
        // Best-effort cancellation marker prevents a timed-out diagnostic from continuing row interactions.
        let tokenJSON=(try? JSONSerialization.data(withJSONObject:[token])).flatMap{String(data:$0,encoding:.utf8)} ?? "[]"
        web.evaluateJavaScript("window.gptPinnedActivityDiagnosticCancelled=\(tokenJSON)[0]") { _,_ in }
        if backgroundRenderLeaseOwner==token {
            let restored=restoreBackgroundRenderSurface(owner:token)
            backgroundRenderLeaseReport += " · cleanup \(restored ? "completed":"failed")"
        }
        updatePinnedActivityStage(reason,token:token,timeoutSeconds:nil)
        finishPinnedActivityDiagnostic()
    }
    func finishPinnedActivityDiagnostic() {
        guard pinnedActivityDiagnosticToken != nil else{return}
        let timestampState=PinnedTimestampState(rawValue:pinnedActivityTimestampStage) ?? .notStarted
        guard pinnedDiagnosticCanFinish(timestampExpected:pinnedActivityTimestampExpected,timestampState:timestampState) else {
            // Preserve the active operation and its child timer; never publish a false finished state.
            pinnedActivityStage="timestamp_started"
            setLastIsolatedDiagnostic(pinnedActivityStatusText())
            return
        }
        if pinnedActivityLeaseStages.last != "activity_completed" {pinnedActivityLeaseStages.append("activity_completed")}
        if let token=pinnedActivityDiagnosticToken {endPinnedBackendTrafficObservation(token:token)}
        pinnedActivityTraversalActive=false;pinnedActivityTraversalDeadline=nil
        if !pinnedActivityReason.hasPrefix("stage_timeout:") && !pinnedActivityReason.hasPrefix("stage_error:") {pinnedActivityStage="finished"}
        pinnedActivityTimeoutTask?.cancel();pinnedActivityTimeoutTask=nil;pinnedActivityItemTimeoutTask?.cancel();pinnedActivityItemTimeoutTask=nil;pinnedActivityStageTimeoutTask?.cancel();pinnedActivityStageTimeoutTask=nil;pinnedActivityMenuCleanupTimeoutTask?.cancel();pinnedActivityMenuCleanupTimeoutTask=nil;pinnedActivityLaunchAckTask?.cancel();pinnedActivityLaunchAckTask=nil
        pinnedActivityLiveWaitTimeoutTask?.cancel();pinnedActivityLiveWaitTimeoutTask=nil;pinnedActivityLiveWaitDeadlineActive=false
        pinnedActivityDispatchTimeoutTask?.cancel();pinnedActivityDispatchTimeoutTask=nil
        pinnedActivityResolverTask?.cancel();pinnedActivityResolverTask=nil
        clearPinnedNavigationObservers()
        restoreRuntimeUserScripts()
        if let owner=backgroundRenderLeaseOwner,pinnedActivityDiagnosticToken==owner {
            let restored=restoreBackgroundRenderSurface(owner:owner)
            backgroundRenderLeaseReport += " · cleanup \(restored ? "completed":"failed")"
        }
        if pinnedActivityNavigationMenuCleanup=="unknown" {
            pinnedActivityNavigationMenuCleanup=pinnedActivityCleanup=="successful" ? "success":(pinnedActivityCleanup=="incomplete" ? "failed":"unknown")
        }
        let menuClean=pinnedActivityNavigationMenuCleanup=="success"
        let leaseClean=pinnedActivityRenderLeaseCleanup=="success" || pinnedActivityRenderLeaseCleanup=="not_required"
        pinnedActivityOverallCleanup=menuClean && leaseClean ? "success":(pinnedActivityNavigationMenuCleanup=="failed" || pinnedActivityRenderLeaseCleanup=="failed" ? "failed":"partial")
        pinnedActivityExpectedConversationID=nil;pinnedActivityExpectedOrdinal=nil;pinnedActivityDiagnosticToken=nil
        pinnedActivityWaiterArmed=false;pinnedActivityWaiterToken=nil;pinnedActivityWaiterConversationID=nil;pinnedActivityWaiterOrdinal=nil
        web.evaluateJavaScript("window.gptSetRateLimitContext?.('unrelated_passive_traffic',null,'page_idle')",completionHandler:nil)
        let count=pinnedActivityPinnedCount,now=Date().timeIntervalSince1970*1000
        let recency=pinnedActivityRecency(times:pinnedActivityTimes,expectedCount:count,cutoff:pinnedActivityCutoffTimestamp,now:now)
        let source=pinnedActivitySources.isEmpty ? "unresolved" : Set(pinnedActivitySources).count==1 ? (pinnedActivitySources.first ?? "unresolved") : "mixed sources"
        let iso=ISO8601DateFormatter()
        let cutoffText=iso.string(from:Date(timeIntervalSince1970:pinnedActivityCutoffTimestamp/1000))
        let timestampDetails=zip(zip(pinnedActivityOrdinals,pinnedActivityTimes),pinnedActivitySources).map { item in
            let ordinal=item.0.0,time=item.0.1,source=item.1
            let recent=time>=pinnedActivityCutoffTimestamp && time<=now ? "Yes":"No"
            return "Pinned \(ordinal): \(source) · \(iso.string(from:Date(timeIntervalSince1970:time/1000))) · Recent \(recent)"
        }.joined(separator:"; ")
        let itemStates=pinnedActivityTimestampItemStates.enumerated().map { item in "Pinned \(item.offset+1): \(item.element)" }.joined(separator:", ")
        let provenance=pinnedActivityTimestampProvenance.isEmpty ? "none":pinnedActivityTimestampProvenance.suffix(16).joined(separator:" → ")
        let passiveSummaries=pinnedActivityPassiveSummaries.isEmpty ? "none":pinnedActivityPassiveSummaries.joined(separator:", ")
        let message="Last isolated diagnostic: v\(pinnedDiagnosticVersion) · stage: \(pinnedActivityStage) · JS promise: \(pinnedActivityJSPromiseStatus) · Swift completion: \(pinnedActivitySwiftCompletion)\nLaunch stage: \(pinnedActivityLaunchStage) · launch reason: \(pinnedActivityLaunchReason) · last rejection: \(pinnedActivityLastLaunchRejection) · operation active: No\nFailure reasons: primary \(pinnedActivityPrimaryFailureReason) · cleanup \(pinnedActivityCleanupFailureReason)\nRender lease: \(backgroundRenderLeaseReport)\nPreflight: \(pinnedActivityPreflightSummary)\nReadiness: \(pinnedActivityReadiness) · firstPositiveCount \(pinnedActivityFirstPositiveCount) · finalStableCount \(pinnedActivityStableCount) · signature changes \(pinnedActivityConversationSignatureChanges) · unrelated mutation checks \(pinnedActivityUnrelatedMutationChecks) · finalSnapshotCount \(pinnedActivityFinalSnapshotCount) · timeToFirstPositive \(pinnedActivityTimeToFirstPositiveMs) ms · timeToStable \(pinnedActivityTimeToStableMs) ms · terminalReason \(pinnedActivityTerminalReason)\nTop: \(pinnedActivityTop) · Top reason: \(pinnedActivityTopReason)\nPrefix snapshot: initial \(pinnedActivityInitialSnapshotCount) · final \(pinnedActivityFinalPrefixSnapshotCount) · expansions \(pinnedActivitySnapshotExpansionCount) · pinned prefix \(pinnedActivityPrefix)\nRows classified: \(pinnedActivityRowsInspected) · sequence: \(pinnedActivitySequence)\nFirst not-pinned found: \(pinnedActivityFirstNotPinnedFound ? "Yes":"No") · exact prefix reason: \(pinnedActivityPrefixReason)\nDOM conversations before/after cleanup per row: \(pinnedActivityDOMCounts)\nPinned chats: \(count)\nHTTP 429 observed: \(pinnedActivity429Observed ? "Yes":"No") · family \(pinnedActivity429Family) · owner \(pinnedActivity429Owner) · stage \(pinnedActivity429Stage) · relevant \(pinnedActivity429Relevant ? "Yes":"No")\nNavigation: \(pinnedActivityNavigationStage) · command sent \(pinnedActivityNavigationCommandSent ? "Yes":"No")/accepted \(pinnedActivityNavigationCommandAccepted ? "Yes":"No") · provisional started \(pinnedActivityProvisionalStarted ? "Yes":"No") · committed \(pinnedActivityNavigationCommitted ? "Yes":"No") · finished \(pinnedActivityNavigationFinished ? "Yes":"No") · route confirmed \(pinnedActivityRouteConfirmed ? "Yes":"No") · route template \(pinnedActivityNavigationTemplate) · error \(pinnedActivityNavigationError)\nActivity observation window: native started \(pinnedActivityObservationWindowStarted ? "Yes":"No") · extra WebKit observer-arm call \(pinnedActivityJSObserverArmCallExecuted ? "Yes":"No")\nActivity waiter: armed before load \(pinnedActivityWaiterToken != nil ? "Yes":"No") · buffer checked \(pinnedActivityTimestampProvenance.contains(where:{$0.contains("activity_buffer_checked")}) ? "Yes":"No") · cache recheck \(pinnedActivityCacheRecheck) · unrelated activity events \(pinnedActivityUnrelatedActivityEvents)\nTimestamp stage: \(pinnedActivityTimestampStage) · substage \(pinnedActivityTimestampSubstage) · resolved: \(pinnedActivityResolved)/\(count) · reason: \(pinnedActivityTimestampReason)\nPassive lookup: \(pinnedActivityPassiveLookup) · matching records \(pinnedActivityPassiveMatchingRecords) · usable update_time \(pinnedActivityPassiveUpdateTimePresent ? "Yes":"No") · per pinned [\(passiveSummaries)]\nFallback: started \(pinnedActivityFallbackStarted ? "Yes":"No") · activity response seen \(pinnedActivityActivityResponseSeen ? "Yes":"No") · timestamp field seen \(pinnedActivityTimestampFieldSeen ? "Yes":"No") (\(pinnedActivityTimestampFieldType))\nTimestamp provenance: \(provenance)\nTimestamp items: \(itemStates.isEmpty ? "none":itemStates)\nActivity timestamps (UTC): \(timestampDetails.isEmpty ? "unresolved":timestampDetails)\nCutoff (UTC): \(cutoffText)\nSource: \(source)\nRecent: \(recency)\nFull history triggered: No\nNavigation/menu cleanup: \(pinnedActivityNavigationMenuCleanup) · route restoration \(pinnedActivityNavigationCleanup)\nRender lease cleanup: \(pinnedActivityRenderLeaseCleanup) · \(backgroundRenderLeaseRestoreDetails)\nOverall cleanup: \(pinnedActivityOverallCleanup)"
        let withObservation=message.replacingOccurrences(of:"\nTimestamp stage:",with:"\nNavigation observation: current route \(pinnedActivityCurrentRouteBefore) · target differs \(pinnedActivityTargetDiffersFromCurrent ? "Yes":"No") · navigation object returned \(pinnedActivityNavigationObjectReturned ? "Yes":"No") · delegate exists/correct \(pinnedActivityNavigationDelegateExists ? "Yes":"No")/\(pinnedActivityNavigationDelegateCorrect ? "Yes":"No") · URL changed \(pinnedActivityNavigationURLChanged ? "Yes":"No") · target URL observed \(pinnedActivityNavigationTargetURLObserved ? "Yes":"No") · reason \(pinnedActivityNavigationDiagnosticReason)\nNavigation snapshots: \(pinnedActivityNavigationSnapshotSummary)\nTimestamp stage:")
        let withCounts=withObservation.replacingOccurrences(of:"\nPinned chats:",with:"\nReadiness telemetry: firstPositiveCount \(pinnedActivityFirstPositiveCount) · finalStableCount \(pinnedActivityStableCount) · signatureChanges \(pinnedActivityConversationSignatureChanges) · mutationChecks \(pinnedActivityMutationChecks) · unrelatedMutationChecks \(pinnedActivityUnrelatedMutationChecks)\nPinned chats:")
        let withDispatch=withCounts.replacingOccurrences(of:"\nPinned chats:",with:"\nTimestamp dispatch: \(pinnedActivityTimestampDispatchStage) · allowed \(["allowed","items_created","resolver_invoked","resolver_entered","passive_lookup_started","fallback_started"].contains(pinnedActivityTimestampDispatchStage) ? "Yes":"No") · reason \(pinnedActivityTimestampDispatchReason) · items created \(pinnedActivityTimestampItemsCreated) · resolver invoked \(pinnedActivityTimestampResolverInvoked ? "Yes":"No") · entered \(pinnedActivityTimestampResolverEntered ? "Yes":"No")\nPinned chats:")
        let withV521Cleanup=withDispatch.replacingOccurrences(of:"\nCleanup: \(pinnedActivityCleanup)",with:"\nActivity waiter: armed before load \(pinnedActivityWaiterWasArmedBeforeLoad ? "Yes":"No") · response buffered before route \(pinnedActivityResponseBufferedBeforeRoute ? "Yes":"No") · post-route cache recheck \(pinnedActivityCacheRecheck) · unrelated events \(pinnedActivityUnrelatedActivityEvents)\nNavigation/menu cleanup: \(pinnedActivityNavigationMenuCleanup)\nRender lease cleanup: \(pinnedActivityRenderLeaseCleanup) · \(backgroundRenderLeaseRestoreDetails)\nOverall cleanup: \(pinnedActivityOverallCleanup)")
        let withWaiterHistory=withV521Cleanup.replacingOccurrences(of:"\nOverall cleanup:",with:"\nWaiter history: armed before load \(pinnedActivityWaiterWasArmedBeforeLoad ? "Yes":"No") · response buffered before route \(pinnedActivityResponseBufferedBeforeRoute ? "Yes":"No") · post-route cache recheck \(pinnedActivityCacheRecheck) · unrelated activity events \(pinnedActivityUnrelatedActivityEvents)\nOverall cleanup:")
        let withWaiterResult=withWaiterHistory
            .replacingOccurrences(of:"armed before load \(pinnedActivityWaiterToken != nil ? "Yes":"No")",with:"armed before load \(pinnedActivityWaiterWasArmedBeforeLoad ? "Yes":"No")")
            .replacingOccurrences(of:"post-route cache recheck not used",with:"post-route cache recheck: not used")
            .replacingOccurrences(of:"\nOverall cleanup:",with:"\nActivity waiter result: buffer hit \(pinnedActivityBufferHit ? "Yes":"No") · live wait started \(pinnedActivityLiveWaitStarted ? "Yes":"No") · matching response \(pinnedActivityActivityResponseSeen ? "Yes":"No") · endpoint family \(pinnedActivityActivityEndpointFamily) · timestamp field \(pinnedActivityTimestampFieldSeen ? "Yes":"No")\nOverall cleanup:")
        let withWaitState=withWaiterResult.replacingOccurrences(of:"\nActivity waiter result:",with:"\nActivity wait state: \(pinnedActivityLiveWaitState) · duration \(pinnedActivityLiveWaitDurationMs) ms · deadline active \(pinnedActivityLiveWaitDeadlineActive ? "Yes":"No") · deadline elapsed \(pinnedActivityLiveWaitDeadlineElapsed ? "Yes":"No")\nGeneric timeout snapshot: activity state \(pinnedActivityGenericTimeoutActivityState) · deadline active \(pinnedActivityGenericTimeoutDeadlineActive ? "Yes":"No") · deadline elapsed \(pinnedActivityGenericTimeoutDeadlineElapsed ? "Yes":"No")\nActivity waiter result:")
        let finalTelemetry="\nDiagnostic terminal reason: \(pinnedActivityReason)\nActivity lease stages: \(pinnedActivityLeaseStages.isEmpty ? "not recorded":pinnedActivityLeaseStages.joined(separator:" → ")) · failure \(pinnedActivityLeaseFailureReason)\nBudget: total \(pinnedActivityTotalBudgetMs) ms · traversal \(pinnedActivityTraversalBudgetMs) ms · cleanup reserve \(pinnedActivityCleanupReserveMs) ms\nRows: processed \(pinnedActivityProcessedRows) · pinned \(pinnedActivityPinnedCount) · ordinary \(pinnedActivityOrdinaryCount) · unknown \(pinnedActivityUnknownCount) · first ordinary \(pinnedActivityFirstOrdinaryFound ? "Yes":"No")\nActivity: attempted \(pinnedActivityAttemptedCount) · resolved \(pinnedActivityResolved)"
        let withScrollDiagnostics=withWaitState.replacingOccurrences(of:"\nRender lease:",with:"\nScroll owner and position: \(pinnedActivityScrollOwnerSummary)\nScroll attempts: \(pinnedActivityScrollAttemptsSummary)\nRender lease:")
        setLastIsolatedDiagnostic(withScrollDiagnostics.replacingOccurrences(of:"\nRender lease:",with:"\n\(pinnedActivityBackendTrafficSummary())\nPre-navigation: \(pinnedNavigationPreflightSummary())\nRender lease:")+finalTelemetry)
    }
    @discardableResult func completePinnedActivityItem(ordinal:Int,state:PinnedTimestampState,token:String,time:Double?=nil,source:String?=nil,reason:String?=nil)->Bool {
        guard pinnedActivityDiagnosticToken==token,ordinal>0,ordinal<=pinnedActivityTimestampItemStates.count,
              pinnedTimestampItemCanTransition(from:pinnedActivityTimestampItemStates[ordinal-1],to:state) else{return false}
        pinnedActivityTimestampItemStates[ordinal-1]=state.rawValue
        if state == .resolved,let time,time.isFinite,time>0 {pinnedActivityResolved+=1;pinnedActivityTimes.append(time);pinnedActivitySources.append(source ?? "unknown");pinnedActivityOrdinals.append(ordinal)}
        else if state == .timeout {pinnedActivityTimestampTimeouts+=1}
        else if state == .error {pinnedActivityTimestampErrors+=1}
        if let reason,reason != "none",pinnedActivityTimestampReason=="none" {pinnedActivityTimestampReason=reason}
        return true
    }
    func recordPinnedActivityTimestampStage(_ stage:String,token:String) {
        guard pinnedActivityDiagnosticToken==token else{return}
        pinnedActivityTimestampSubstage=stage
        let ordinal=pinnedActivityExpectedOrdinal ?? max(1,pinnedActivityIndex)
        pinnedActivityTimestampProvenance.append("Pinned \(ordinal): \(stage)")
        if pinnedActivityTimestampProvenance.count>40 {pinnedActivityTimestampProvenance.removeFirst(pinnedActivityTimestampProvenance.count-40)}
        setLastIsolatedDiagnostic(pinnedActivityStatusText())
    }
    func clearPinnedNavigationObservers() {
        pinnedActivityNavigationObservationTask?.cancel();pinnedActivityNavigationObservationTask=nil
        pinnedActivityNavigationURLObservation?.invalidate();pinnedActivityNavigationURLObservation=nil
    }
    func armPinnedActivityItemDeadline(seconds:Double,reason:String,token:String,id:String,ordinal:Int) {
        pinnedActivityItemTimeoutTask?.cancel()
        pinnedActivityItemTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:UInt64(seconds*1_000_000_000))
            guard !Task.isCancelled,let self,self.pinnedActivityDiagnosticToken==token,
                  self.pinnedActivityExpectedConversationID==id,self.pinnedActivityExpectedOrdinal==ordinal,
                  self.pinnedActivityNavigationOperationToken==token else{return}
            var terminalReason=self.pinnedActivityNavigationCommandSent ? reason : pinnedNavigationDeadlineReason(commandSent:false)
            if reason=="navigation_timeout" {
                let elapsed=Date().timeIntervalSince(self.pinnedActivityNavigationStartedAt ?? Date())
                if self.pinnedActivityNavigationURLChanged && !self.pinnedActivityNavigationTargetURLObserved {
                    terminalReason="route_mismatch"
                } else if self.pinnedActivityNavigationTargetURLObserved && !self.pinnedActivityProvisionalStarted && !self.pinnedActivityNavigationCommitted && !self.pinnedActivityNavigationFinished {
                    self.pinnedActivityNavigationDiagnosticReason="navigation_delegate_callbacks_missing"
                    terminalReason="navigation_delegate_callbacks_missing"
                } else if pinnedNavigationNoEffect(urlChanged:self.pinnedActivityNavigationURLChanged,isLoading:self.web.isLoading,
                                                   progressChanged:self.pinnedActivityNavigationProgressChanged,elapsed:elapsed) {
                    terminalReason="navigation_load_no_effect"
                } else if pinnedNavigationStalled(isLoading:self.web.isLoading,progressChanged:self.pinnedActivityNavigationProgressChanged,
                                                   targetReached:self.pinnedActivityNavigationTargetURLObserved,elapsed:elapsed,deadline:seconds) {
                    terminalReason="navigation_started_but_stalled"
                }
            }
            if terminalReason=="pre_navigation_timeout" {self.recordPinnedActivityPreNavigationStage(terminalReason,token:token,reason:terminalReason)}
            if terminalReason.hasPrefix("navigation_") || terminalReason=="route_mismatch" {
                self.pinnedActivityNavigationDiagnosticReason=terminalReason
                self.recordPinnedActivityNavigationStage(terminalReason,token:token)
            }
            self.finishPinnedActivityFallback(state:.timeout,reason:terminalReason,token:token,id:id,ordinal:ordinal)
        }
    }
    func finishPinnedActivityFallback(state:PinnedTimestampState,reason:String,token:String,id:String,ordinal:Int) {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityExpectedConversationID==id,pinnedActivityExpectedOrdinal==ordinal else{return}
        if pinnedSidebarNavigationToken==token {finishPinnedSidebarNavigation(token:token,result:false)}
        endPinnedBackendTrafficObservation(token:token)
        clearPinnedNavigationObservers()
        restoreRuntimeUserScripts()
        pinnedActivityChildTerminalReason=reason
        if reason.hasPrefix("sidebar_") {
            pinnedActivityNavigationDiagnosticReason=reason
            recordPinnedActivityPreNavigationStage(reason,token:token,reason:reason)
        }
        let shouldStopNavigation=pinnedActivityNavigationCommandSent && ["navigation_timeout","navigation_provisional_failed","navigation_failed","navigation_command_failed","navigation_load_no_effect","navigation_started_but_stalled","navigation_delegate_callbacks_missing","route_mismatch"].contains(reason)
        if pinnedActivityPreNavigationReason=="none",reason != "navigation_timeout" {pinnedActivityPreNavigationReason=reason}
        if shouldStopNavigation {recordPinnedActivityNavigationStage(reason,token:token)}
        pinnedActivityItemTimeoutTask?.cancel();pinnedActivityItemTimeoutTask=nil
        pinnedActivityLiveWaitTimeoutTask?.cancel();pinnedActivityLiveWaitTimeoutTask=nil;pinnedActivityLiveWaitDeadlineActive=false
        pinnedActivityExpectedConversationID=nil;pinnedActivityExpectedOrdinal=nil
        pinnedActivityWaiterArmed=false;pinnedActivityWaiterToken=nil;pinnedActivityWaiterConversationID=nil;pinnedActivityWaiterOrdinal=nil
        pinnedActivityNavigation=nil;pinnedActivityNavigationOperationToken=nil
        web.evaluateJavaScript("window.gptSetRateLimitContext?.('unrelated_passive_traffic',null,'page_idle')",completionHandler:nil)
        if shouldStopNavigation {web.stopLoading()}
        pinnedActivityTimestampReason=reason;recordPinnedActivityTimestampStage(reason,token:token)
        if reason=="timestamp_timeout" {recordPinnedActivityTimestampStage("timestamp_timeout",token:token)}
        if completePinnedActivityItem(ordinal:ordinal,state:state,token:token,reason:reason),pinnedActivityResolverTask==nil {schedulePinnedActivityResolver(token:token)}
    }
    func handleConfirmedPinnedActivityResponse(_ data:[String:Any],token:String,id:String,ordinal:Int) {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityExpectedConversationID==id,
              pinnedActivityExpectedOrdinal==ordinal,pinnedActivityRouteConfirmed,
              pinnedActivityEventMatches(data,expectedConversationID:id,expectedOwner:"isolated_timestamp_fallback",expectedGeneration:token),
              let status=(data["httpStatus"] as? NSNumber)?.intValue,(200...299).contains(status) else{return}
        if pinnedActivityLiveWaitState=="waiting" {
            finishPinnedActivityLiveWait(token:token,id:id,ordinal:ordinal,result:.response(data))
            return
        }
        guard pinnedActivityLiveWaitState=="not_started" else{return}
        applyConfirmedPinnedActivityResponse(data,token:token,id:id,ordinal:ordinal)
    }
    func applyConfirmedPinnedActivityResponse(_ data:[String:Any],token:String,id:String,ordinal:Int) {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityExpectedConversationID==id,
              pinnedActivityExpectedOrdinal==ordinal,pinnedActivityRouteConfirmed,
              pinnedActivityEventMatches(data,expectedConversationID:id,expectedOwner:"isolated_timestamp_fallback",expectedGeneration:token),
              let status=(data["httpStatus"] as? NSNumber)?.intValue,(200...299).contains(status) else{return}
        if pinnedActivityLiveWaitState=="not_started" {pinnedActivityLiveWaitState="response_received";pinnedActivityLiveWaitDurationMs="not started"}
        pinnedActivityWaiterArmed=false;pinnedActivityWaiterToken=nil;pinnedActivityWaiterConversationID=nil;pinnedActivityWaiterOrdinal=nil
        pinnedActivityActivityResponseSeen=true
        pinnedActivityActivityEndpointFamily=data["endpointFamily"] as? String ?? "unknown"
        recordPinnedActivityTimestampStage("activity_response_seen",token:token)
        pinnedActivityTimestampFieldSeen=(data["timestampFieldPresent"] as? Bool)==true
        pinnedActivityTimestampFieldType=data["timestampFieldType"] as? String ?? "unknown"
        if validPinnedActivity(data),let time=data["timestamp"] as? Double {
            recordPinnedActivityTimestampStage("activity_timestamp_seen",token:token)
            recordPinnedActivityTimestampStage("timestamp_resolved",token:token)
            pinnedActivityTimestampReason="fallback_timestamp_resolved"
            pinnedActivityItemTimeoutTask?.cancel();pinnedActivityItemTimeoutTask=nil
            if completePinnedActivityItem(ordinal:ordinal,state:.resolved,token:token,time:time,source:data["timestampSource"] as? String),pinnedActivityResolverTask==nil {schedulePinnedActivityResolver(token:token)}
        } else {
            let reason=pinnedActivityTimestampFieldSeen ? "timestamp_parse_failed":"activity_timestamp_missing"
            recordPinnedActivityTimestampStage(reason,token:token)
            finishPinnedActivityFallback(state:.error,reason:reason,token:token,id:id,ordinal:ordinal)
        }
    }
    func handlePinnedBackendTraffic(_ data:[String:Any],token:String) {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityBackendObservationActive,
              let window=pinnedActivityObservationWindow,window.generation==token,
              let expected=pinnedActivityExpectedConversationID,let ordinal=pinnedActivityExpectedOrdinal else{return}
        let family=data["endpointFamily"] as? String ?? "unrelated_backend"
        let allowedFamilies:Set<String>=["conversation_messages","conversation_detail","root_conversation_list","project_conversation_list","conversation_related_other","unrelated_backend","non_chatgpt"]
        guard allowedFamilies.contains(family) else{return}
        let receivedAt=(data["capturedAtMs"] as? NSNumber)?.doubleValue ?? .nan
        let responseSequence=(data["responseSequence"] as? NSNumber)?.intValue
        let conversationID=data["conversationId"] as? String
        guard receivedAt.isFinite,receivedAt>=window.startedAtMs else{return}
        let status=(data["httpStatus"] as? NSNumber)?.intValue ?? 0
        let idPresent=(data["conversationIdPresent"] as? Bool)==true
        let matched=window.accepts(generation:token,receivedAtMs:receivedAt,conversationID:conversationID)
        let related=(data["conversationRelated"] as? Bool)==true
        let fieldPresent=(data["timestampFieldPresent"] as? Bool)==true
        let rawField=data["timestampField"] as? String ?? "none"
        let field=rawField.range(of:#"^[A-Za-z][A-Za-z0-9_]{0,48}$"#,options:.regularExpression) != nil ? rawField:"unknown"
        let rawType=data["timestampFieldType"] as? String ?? "none"
        let fieldType=["number","string","null","boolean","object","array","none"].contains(rawType) ? rawType:"unknown"
        let timestamp=(data["timestampValue"] as? NSNumber)?.doubleValue
        let validTimestamp=timestamp.map{$0.isFinite && $0>0 && $0<=Date().timeIntervalSince1970*1000} ?? false
        let firstForResponse=responseSequence.map{pinnedActivityObservedResponseSequences.insert($0).inserted} ?? true
        if firstForResponse {
            pinnedActivityBackendResponsesObserved+=1
            pinnedActivityBackendFamilies[family,default:0]+=1
            if related {pinnedActivityBackendConversationRelated+=1}
            let iso=ISO8601DateFormatter()
            let timeText=matched&&validTimestamp ? iso.string(from:Date(timeIntervalSince1970:timestamp!/1000)) : "none"
            let summary="\(family) · HTTP \(status) · conversation ID \(idPresent ? "yes":"no") · expected match \(matched ? "yes":"no") · timestamp \(field) (\(fieldType)) · value \(timeText)"
            if pinnedActivityBackendResponseSummaries.count<30 {pinnedActivityBackendResponseSummaries.append(summary)}
        }
        if matched {pinnedActivityBackendExpectedMatches+=1;pinnedActivityBackendItemExpectedMatches+=1}
        if matched&&fieldPresent {pinnedActivityBackendTimestampFieldMatches+=1;pinnedActivityBackendItemTimestampFieldMatches+=1}
        if matched&&validTimestamp {pinnedActivityBackendTimestampBearingMatches+=1;pinnedActivityBackendItemTimestampBearingMatches+=1}
        guard matched else {pinnedActivityUnrelatedActivityEvents+=1;setLastIsolatedDiagnostic(pinnedActivityStatusText());return}
        if status==429 {
            pinnedActivity429Observed=true;pinnedActivity429Family=family;pinnedActivity429Owner="isolated_timestamp_fallback";pinnedActivity429Stage="sidebar_navigation";pinnedActivity429Relevant=true
            if pinnedActivityRouteConfirmed&&pinnedActivityLiveWaitState=="waiting" {finishPinnedActivityLiveWait(token:token,id:expected,ordinal:ordinal,result:.error("activity_http_429"))}
            else {finishPinnedActivityFallback(state:.error,reason:"activity_http_429",token:token,id:expected,ordinal:ordinal)}
            return
        }
        guard (200...299).contains(status) else {setLastIsolatedDiagnostic(pinnedActivityStatusText());return}
        let source=data["timestampSource"] as? String
        let safeSource=source?.range(of:#"^[a-z][a-z0-9_.-]{0,80}$"#,options:.regularExpression) != nil ? source! : (validTimestamp ? "\(family).\(field)":"")
        let normalized:[String:Any]=["conversationId":expected,"timestamp":validTimestamp ? (timestamp as Any):NSNull(),"timestampSource":safeSource,
         "endpointFamily":family,"httpStatus":status,"operationOwner":"isolated_timestamp_fallback","operationGeneration":token,
         "timestampFieldPresent":fieldPresent,"timestampFieldType":fieldType]
        if validTimestamp {recordPinnedActivityTimestampStage("backend_activity_timestamp_candidate",token:token)}
        if pinnedActivityRouteConfirmed {
            if pinnedActivityLiveWaitState=="waiting" {finishPinnedActivityLiveWait(token:token,id:expected,ordinal:ordinal,result:.response(normalized))}
            else if pinnedActivityLiveWaitState=="not_started" {applyConfirmedPinnedActivityResponse(normalized,token:token,id:expected,ordinal:ordinal)}
        } else {pinnedActivityPendingResponse=normalized;pinnedActivityResponseBufferedBeforeRoute=true}
        setLastIsolatedDiagnostic(pinnedActivityStatusText())
    }
    func recordPinnedActivityNavigationStage(_ stage:String,token:String) {
        guard pinnedActivityDiagnosticToken==token else{return}
        pinnedActivityNavigationStage=stage
        if !pinnedActivityPreNavigationStages.contains(stage) {pinnedActivityPreNavigationStages.append(stage)}
        setLastIsolatedDiagnostic(pinnedActivityStatusText())
    }
    func recordPinnedActivityPreNavigationStage(_ stage:String,token:String,reason:String?=nil) {
        guard pinnedActivityDiagnosticToken==token else{return}
        pinnedActivityPreNavigationStage=stage
        if let reason {pinnedActivityPreNavigationReason=reason}
        if !pinnedActivityPreNavigationStages.contains(stage) {pinnedActivityPreNavigationStages.append(stage)}
        recordPinnedActivityNavigationStage(stage,token:token)
    }
    func noteStalePinnedNavigationCallback() {
        pinnedActivityLateNavigationReason="stale_operation"
        if pinnedActivityDiagnosticToken != nil {setLastIsolatedDiagnostic(pinnedActivityStatusText())}
    }
    func conversationRouteTemplate(_ path:String)->String? {
        let parts=path.split(separator:"/").map(String.init)
        if parts.count==2,parts[0]=="c",parts[1].range(of:#"^[A-Za-z0-9-]+$"#,options:.regularExpression) != nil{return "/c/<id>"}
        if parts.count==4,parts[0]=="g",parts[2]=="c",parts[1].range(of:#"^[A-Za-z0-9-]+$"#,options:.regularExpression) != nil,parts[3].range(of:#"^[A-Za-z0-9-]+$"#,options:.regularExpression) != nil{return "/g/<id>/c/<id>"}
        return nil
    }
    func installPinnedActivityContextUserScript(owner:String,generation:String,stage:String,expectedConversationID:String?=nil)->Bool {
        guard !pinnedActivityContextUserScriptInstalled,
              ["scheduler_conversation_check","isolated_timestamp_fallback"].contains(owner),
              generation.range(of:#"^[A-Za-z0-9-]{1,128}$"#,options:.regularExpression) != nil,
              (expectedConversationID == nil || expectedConversationID!.range(of:#"^[A-Za-z0-9-]{1,128}$"#,options:.regularExpression) != nil) else{return false}
        func json(_ value:String)->String? {
            guard let data=try? JSONSerialization.data(withJSONObject:[value]),let encoded=String(data:data,encoding:.utf8) else{return nil}
            return encoded
        }
        guard let ownerJSON=json(owner),let generationJSON=json(generation),let stageJSON=json(stage) else{return false}
        let observerInstall:String
        if let expectedConversationID,let expectedJSON=json(expectedConversationID) {
            observerInstall="window.gptBeginBackendTrafficObservation?.(\(generationJSON)[0],\(expectedJSON)[0]);"
        } else {observerInstall=""}
        let source="if(location.origin==='https://chatgpt.com'){window.gptSetRateLimitContext?.(\(ownerJSON)[0],\(generationJSON)[0],\(stageJSON)[0]);\(observerInstall)}"
        web.configuration.userContentController.addUserScript(WKUserScript(source:source,injectionTime:.atDocumentStart,forMainFrameOnly:true))
        pinnedActivityContextUserScriptInstalled=true
        return true
    }
    func endPinnedBackendTrafficObservation(token:String) {
        guard pinnedActivityObservationWindow?.generation==token else{return}
        pinnedActivityBackendObservationActive=false
        pinnedActivityObservationWindow=nil
    }
    func restoreRuntimeUserScripts() {
        guard pinnedActivityContextUserScriptInstalled else{return}
        let controller=web.configuration.userContentController
        controller.removeAllUserScripts()
        if let runtimeUserScript {controller.addUserScript(runtimeUserScript)}
        pinnedActivityContextUserScriptInstalled=false
    }
    func navigationErrorSummary(_ error:Error)->String {
        let ns=error as NSError
        let category=ns.domain==NSURLErrorDomain ? "network" : (ns.domain.localizedCaseInsensitiveContains("webkit") ? "webkit":"other")
        let domain=ns.domain.range(of:#"^[A-Za-z0-9._-]{1,80}$"#,options:.regularExpression) != nil ? ns.domain:"UnknownDomain"
        return "\(category) · \(domain) · \(ns.code)"
    }
    func conversationID(in url:URL?)->String? {
        guard let parts=url?.path.split(separator:"/").map(String.init),parts.count>=2,parts.contains("c"),
              let index=parts.lastIndex(of:"c"),index+1<parts.count else{return nil}
        let value=parts[index+1]
        return value.range(of:#"^[A-Za-z0-9-]{1,128}$"#,options:.regularExpression) != nil ? value:nil
    }
    func safeNavigationRouteTemplate(_ url:URL?)->String {
        guard let url,url.host=="chatgpt.com" else{return "unknown"}
        if url.path=="/" {return "/"}
        return conversationRouteTemplate(url.path) ?? "other"
    }
    func recordPinnedNavigationSnapshot(_ label:String,webView:WKWebView,token:String,id:String,ordinal:Int)->Bool {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityExpectedConversationID==id,pinnedActivityExpectedOrdinal==ordinal else{return false}
        let route=safeNavigationRouteTemplate(webView.url),loading=webView.isLoading,progress=webView.estimatedProgress
        if route != pinnedActivityCurrentRouteBefore {pinnedActivityNavigationURLChanged=true}
        if abs(progress-pinnedActivityNavigationInitialProgress)>0.005 {pinnedActivityNavigationProgressChanged=true}
        let targetMatched=conversationID(in:webView.url)==id
        if targetMatched {
            pinnedActivityNavigationTargetURLObserved=true
            let template=route=="other" ? pinnedActivityNavigationTemplate:route
            recordPinnedActivityNavigationStage("navigation_route_reached",token:token)
            confirmPinnedActivityRoute(token:token,id:id,ordinal:ordinal,template:template,source:"url_observation")
            pinnedActivityNavigationDiagnosticReason="navigation_route_reached"
        }
        let progressText=String(format:"%.2f",progress)
        let row="\(label): route \(route) · target \(targetMatched ? "yes":"no") · isLoading \(loading ? "yes":"no") · progress \(progressText)"
        if pinnedActivityNavigationSnapshotSummary=="not_run" {pinnedActivityNavigationSnapshotSummary=row}
        else {pinnedActivityNavigationSnapshotSummary += " · \(row)"}
        pinnedActivityNavigationSnapshotCount += 1
        setLastIsolatedDiagnostic(pinnedActivityStatusText())
        return targetMatched
    }
    @MainActor func observePinnedNavigationInline(webView:WKWebView,token:String,id:String,ordinal:Int) async -> Bool {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityExpectedConversationID==id,
              pinnedActivityExpectedOrdinal==ordinal else {
            pinnedActivityNavigationDiagnosticReason="navigation_observation_not_started"
            if pinnedActivityDiagnosticToken==token {
                finishPinnedActivityFallback(state:.error,reason:"navigation_observation_not_started",token:token,id:id,ordinal:ordinal)
            }
            return false
        }
        pinnedActivityNavigationSnapshotSummary="not_run"
        pinnedActivityNavigationSnapshotCount=0
        let checkpoints:[(UInt64,String)]=[(0,"0 ms"),(100,"100 ms"),(400,"500 ms"),(500,"1 s"),(1000,"2 s"),(3000,"5 s")]
        for (delay,label) in checkpoints {
            if delay>0 {
                do { try await Task.sleep(nanoseconds:delay*1_000_000) }
                catch {
                    pinnedActivityNavigationDiagnosticReason="navigation_observation_cancelled"
                    finishPinnedActivityFallback(state:.error,reason:"navigation_observation_cancelled",token:token,id:id,ordinal:ordinal)
                    return false
                }
            }
            guard pinnedActivityDiagnosticToken==token,pinnedActivityExpectedConversationID==id,
                  pinnedActivityExpectedOrdinal==ordinal else { return pinnedActivityRouteConfirmed }
            if pinnedActivityChildTerminalReason != "none" { return false }
            let targetMatched=recordPinnedNavigationSnapshot(label,webView:webView,token:token,id:id,ordinal:ordinal)
            if targetMatched { return true }
            let elapsed=Date().timeIntervalSince(pinnedActivityNavigationStartedAt ?? Date())
            if elapsed>=2,
               pinnedNavigationObservationClassification(urlMatchesTarget:false,urlChanged:pinnedActivityNavigationURLChanged,
                 isLoading:webView.isLoading,progressChanged:pinnedActivityNavigationProgressChanged,elapsed:elapsed)=="navigation_load_no_effect" {
                pinnedActivityNavigationDiagnosticReason="navigation_load_no_effect"
                finishPinnedActivityFallback(state:.error,reason:"navigation_load_no_effect",token:token,id:id,ordinal:ordinal)
                return false
            }
            if elapsed>=5,let classification=pinnedNavigationObservationClassification(urlMatchesTarget:false,urlChanged:pinnedActivityNavigationURLChanged,
                 isLoading:webView.isLoading,progressChanged:pinnedActivityNavigationProgressChanged,elapsed:elapsed,finalAfter:4.5) {
                pinnedActivityNavigationDiagnosticReason=classification
                finishPinnedActivityFallback(state:.error,reason:classification,token:token,id:id,ordinal:ordinal)
                return false
            }
        }
        if pinnedActivityNavigationSnapshotCount==0 {
            pinnedActivityNavigationDiagnosticReason="navigation_observation_not_started"
            finishPinnedActivityFallback(state:.error,reason:"navigation_observation_not_started",token:token,id:id,ordinal:ordinal)
            return false
        }
        if pinnedActivityRouteConfirmed { return true }
        pinnedActivityNavigationDiagnosticReason="navigation_observation_not_started"
        finishPinnedActivityFallback(state:.error,reason:"navigation_observation_not_started",token:token,id:id,ordinal:ordinal)
        return false
    }
    @MainActor func confirmPinnedActivityRoute(token:String,id:String,ordinal:Int,template:String,source:String) {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityExpectedConversationID==id,
              pinnedActivityExpectedOrdinal==ordinal,!pinnedActivityRouteConfirmed,
              ["/c/<id>","/g/<id>/c/<id>"].contains(template) else{return}
        pinnedActivityNavigationTemplate=template;pinnedActivityRouteConfirmed=true
        pinnedActivityNavigationDiagnosticReason="navigation_route_reached"
        pinnedActivityRouteLoaded=true;pinnedActivityNavigationCompleted=true;pinnedActivityNavigationTargetURLObserved=true
        pinnedActivityItemTimeoutTask?.cancel();pinnedActivityItemTimeoutTask=nil
        restoreRuntimeUserScripts()
        recordPinnedActivityNavigationStage("route_confirmed",token:token)
        recordPinnedActivityTimestampStage("route_confirmed",token:token)
        if source=="current_route" {pinnedActivityNavigationDiagnosticReason="target_route_already_loaded"}
        recordPinnedActivityTimestampStage("activity_buffer_checked",token:token)
        if let pending=pinnedActivityPendingResponse {
            pinnedActivityPendingResponse=nil
            pinnedActivityBufferHit=true
            recordPinnedActivityTimestampStage("activity_buffer_hit",token:token)
            handleConfirmedPinnedActivityResponse(pending,token:token,id:id,ordinal:ordinal)
            return
        }
        pinnedActivityBufferHit=false
        recordPinnedActivityTimestampStage("activity_buffer_miss",token:token)
        beginPinnedActivityLiveWait(token:token,id:id,ordinal:ordinal)
    }
    @MainActor func beginPinnedActivityLiveWait(token:String,id:String,ordinal:Int) {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityExpectedConversationID==id,
              pinnedActivityExpectedOrdinal==ordinal,pinnedActivityRouteConfirmed,
              pinnedActivityLiveWaitState=="not_started" else{return}
        pinnedActivityNavigationStage="activity_response_waiting"
        pinnedActivityLiveWaitStarted=true
        pinnedActivityLiveWaitState="waiting"
        pinnedActivityLiveWaitStartedAt=Date()
        pinnedActivityLiveWaitDurationMs="pending"
        pinnedActivityLiveWaitDeadlineActive=true
        recordPinnedActivityTimestampStage("activity_live_wait_started",token:token)
        recordPinnedActivityTimestampStage("activity_live_wait_deadline_started",token:token)
        pinnedActivityLiveWaitTimeoutTask=Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds:8_000_000_000) }
            catch { return }
            guard let self,self.pinnedActivityDiagnosticToken==token,
                  self.pinnedActivityExpectedConversationID==id,self.pinnedActivityExpectedOrdinal==ordinal,
                  self.pinnedActivityLiveWaitState=="waiting" else{return}
            self.pinnedActivityLiveWaitDeadlineElapsed=true
            self.finishPinnedActivityLiveWait(token:token,id:id,ordinal:ordinal,result:.timeout)
        }
        let generationJSON=(try? JSONSerialization.data(withJSONObject:[token])).flatMap{String(data:$0,encoding:.utf8)} ?? "[]"
        web.evaluateJavaScript("window.gptSetRateLimitContext?.('isolated_timestamp_fallback',\(generationJSON)[0],'activity_response_waiting')",completionHandler:nil)
        setLastIsolatedDiagnostic(pinnedActivityStatusText())
    }
    @MainActor func finishPinnedActivityLiveWait(token:String,id:String,ordinal:Int,result:PinnedActivityWaitResult) {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityExpectedConversationID==id,
              pinnedActivityExpectedOrdinal==ordinal,pinnedActivityLiveWaitCanFinish(state:pinnedActivityLiveWaitState) else{return}
        switch result {
        case .response(let data):
            pinnedActivityLiveWaitState="response_received"
            pinnedActivityActivityResponseSeen=true
            pinnedActivityActivityEndpointFamily=data["endpointFamily"] as? String ?? "unknown"
            recordPinnedActivityTimestampStage("activity_response_seen",token:token)
        case .timeout:
            pinnedActivityLiveWaitState="timeout"
            pinnedActivityChildTerminalReason="activity_response_timeout"
            recordPinnedActivityTimestampStage("activity_live_wait_timeout",token:token)
        case .error(let reason):
            pinnedActivityLiveWaitState="error"
            pinnedActivityChildTerminalReason=reason
            recordPinnedActivityTimestampStage(reason,token:token)
        }
        pinnedActivityLiveWaitDeadlineActive=false
        if let started=pinnedActivityLiveWaitStartedAt {
            pinnedActivityLiveWaitDurationMs=String(format:"%.0f",Date().timeIntervalSince(started)*1000)
        }
        pinnedActivityLiveWaitTimeoutTask?.cancel();pinnedActivityLiveWaitTimeoutTask=nil
        pinnedActivityLiveWaitResult=result
        if let continuation=pinnedActivityLiveWaitContinuation {
            pinnedActivityLiveWaitContinuation=nil
            continuation.resume(returning:result)
        }
        setLastIsolatedDiagnostic(pinnedActivityStatusText())
    }
    @MainActor func awaitPinnedActivityLiveWait(token:String,id:String,ordinal:Int) async -> PinnedActivityWaitResult {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityExpectedConversationID==id,
              pinnedActivityExpectedOrdinal==ordinal else{return .error("activity_wait_operation_stale")}
        if let result=pinnedActivityLiveWaitResult {return result}
        return await withCheckedContinuation { continuation in
            if let result=pinnedActivityLiveWaitResult {continuation.resume(returning:result)}
            else if pinnedActivityLiveWaitState=="waiting" {pinnedActivityLiveWaitContinuation=continuation}
            else {continuation.resume(returning:.error("activity_wait_not_started"))}
        }
    }
    @MainActor func recordPinnedActivityLeaseStage(_ stage:String,token:String)->Bool {
        guard pinnedActivityDiagnosticToken==token else {return false}
        let ownerMatches=backgroundRenderLease?.owner==token && backgroundRenderLeaseOwner==token
        let gateMatches=backgroundRenderLeaseGate.owner==token
        let attached=session.contentView === web && web.window === session
        let surfaceReady = !web.isHidden && session.ignoresMouseEvents
        let visible=session.isVisible
        let valid=ownerMatches && gateMatches && attached && surfaceReady
        pinnedActivityLeaseStages.append("\(stage): owner \(ownerMatches ? "yes":"no") · gate \(gateMatches ? "yes":"no") · attached \(attached ? "yes":"no") · surface \(surfaceReady ? "ready":"inactive") · window visible \(visible ? "yes":"no")")
        if !valid {
            let failedComponent = !ownerMatches ? "owner" : !gateMatches ? "gate" : !attached ? "surface_detached" : "surface_inactive"
            pinnedActivityLeaseFailureReason="\(failedComponent)_at_\(stage)"
            pinnedActivityLeaseStages.append("lease_lost_at:\(stage)")
        }
        setLastIsolatedDiagnostic(pinnedActivityStatusText())
        return valid
    }
    @MainActor func beginPinnedSidebarNavigation(id:String,route:String,token:String,ordinal:Int) async -> Bool {
        pinnedActivityMainActorEntered=true
        pinnedActivityNavigationMethod="sidebar_ui"
        recordPinnedActivityPreNavigationStage("main_actor_entered",token:token)
        guard !Task.isCancelled else {finishPinnedActivityFallback(state:.error,reason:"operation_cancelled",token:token,id:id,ordinal:ordinal);return false}
        guard pinnedActivityDiagnosticToken==token,pinnedActivityExpectedConversationID==id,
              pinnedActivityExpectedOrdinal==ordinal,pinnedActivityNavigationOperationToken==token else {
            finishPinnedActivityFallback(state:.error,reason:"stale_operation",token:token,id:id,ordinal:ordinal);return false
        }
        guard let webView=web,let session=session,session.contentView === webView,webView.url?.host=="chatgpt.com" else {
            finishPinnedActivityFallback(state:.error,reason:"webview_unavailable",token:token,id:id,ordinal:ordinal);return false
        }
        guard recordPinnedActivityLeaseStage("fallback_navigation_entered",token:token) else {
            finishPinnedActivityFallback(state:.error,reason:"render_lease_lost_during_fallback",token:token,id:id,ordinal:ordinal);return false
        }
        guard !route.hasPrefix("//"),route.hasPrefix("/"),let routeURL=URL(string:"https://chatgpt.com"+route),
              routeURL.host=="chatgpt.com",routeURL.query==nil,routeURL.fragment==nil,
              conversationRouteTemplate(routeURL.path) != nil,conversationID(in:routeURL)==id else {
            finishPinnedActivityFallback(state:.error,reason:"frontend_route_invalid",token:token,id:id,ordinal:ordinal);return false
        }
        pinnedActivityFrontendRoute=route
        pinnedActivityNavigationTemplate=conversationRouteTemplate(routeURL.path) ?? "unknown"
        pinnedActivityCurrentRouteBefore=safeNavigationRouteTemplate(webView.url)
        pinnedActivityNavigationOriginURL=webView.url
        pinnedActivitySidebarRouteAfter=pinnedActivityCurrentRouteBefore
        pinnedActivityTargetDiffersFromCurrent=conversationID(in:webView.url) != id
        pinnedActivityNavigationStartedAt=Date()
        pinnedActivityNavigationObjectReturned=false;pinnedActivityNavigationDelegateExists=webView.navigationDelegate != nil
        pinnedActivityNavigationDelegateCorrect=webView.navigationDelegate === self
        pinnedActivityNavigationURLChanged=false;pinnedActivityNavigationTargetURLObserved=false
        pinnedActivityWaiterToken=token;pinnedActivityWaiterConversationID=id;pinnedActivityWaiterOrdinal=ordinal
        pinnedActivityWaiterArmed=true;pinnedActivityWaiterWasArmedBeforeLoad=true
        recordPinnedActivityTimestampStage("activity_wait_armed",token:token)
        recordPinnedActivityPreNavigationStage("activity_wait_armed",token:token)
        pinnedActivityObservationWindow=ActivityObservationWindow(generation:token,expectedConversationID:id,startedAtMs:Date().timeIntervalSince1970*1000)
        pinnedActivityBackendObservationActive=true;pinnedActivityObservationWindowStarted=true;pinnedActivityJSObserverArmCallExecuted=false
        recordPinnedActivityTimestampStage("activity_observation_window_started",token:token)
        recordPinnedActivityPreNavigationStage("activity_observation_window_started",token:token)
    let encoded=(try? JSONSerialization.data(withJSONObject:[id,token])).flatMap{String(data:$0,encoding:.utf8)} ?? "[]"
        recordPinnedActivityTimestampStage("sidebar_navigation_started",token:token)
        recordPinnedActivityPreNavigationStage("sidebar_navigation_started",token:token)
        pinnedSidebarNavigationToken=token
        pinnedActivityAutomationBridgePresent=false;pinnedActivitySidebarHandlerPresent=false
        pinnedActivitySidebarDispatchPrimitive="dispatching";pinnedActivitySidebarCommandAckState="not observed"
        let invocation="(()=>{if(typeof window.gptInspectVisiblePinnedRows!=='function'||typeof window.pinnedDiagnosticVersion!=='string')return {status:'bridge_missing'};if(typeof window.gptSidebarNavigateSync!=='function')return {status:'handler_missing'};return window.gptSidebarNavigateSync(\(encoded)[0],\(encoded)[1]);})()"
        return await withCheckedContinuation { continuation in
            pinnedSidebarNavigationContinuation=continuation
            pinnedSidebarNavigationTimeoutTask=Task { @MainActor [weak self] in
                do { try await Task.sleep(nanoseconds:5_500_000_000) } catch { return }
                guard let self,self.pinnedSidebarNavigationToken==token,self.pinnedSidebarNavigationContinuation != nil else{return}
                let reason=self.pinnedActivityPreNavigationStages.contains("sidebar_row_lookup_started") && !self.pinnedActivitySidebarRowLookupTerminal ? "sidebar_sync_dispatch_timeout":"sidebar_navigation_bridge_timeout"
                self.finishPinnedActivityFallback(state:.timeout,reason:reason,token:token,id:id,ordinal:ordinal)
                self.finishPinnedSidebarNavigation(token:token,result:false)
            }
            pinnedSidebarNavigationDispatchTimeoutTask=Task { @MainActor [weak self] in
                do { try await Task.sleep(nanoseconds:2_000_000_000) } catch { return }
                guard let self,self.pinnedSidebarNavigationToken==token,self.pinnedSidebarNavigationContinuation != nil,
                      self.pinnedActivitySidebarDispatchPrimitive=="dispatching" else{return}
                self.pinnedActivitySidebarDispatchPrimitive="timeout"
                self.finishPinnedActivityFallback(state:.timeout,reason:"sidebar_sync_dispatch_timeout",token:token,id:id,ordinal:ordinal)
                self.finishPinnedSidebarNavigation(token:token,result:false)
            }
            webView.evaluateJavaScript(invocation) { [weak self] value,error in
                guard let self else{return}
                Task { @MainActor in
                    guard self.pinnedSidebarNavigationToken==token,self.pinnedSidebarNavigationContinuation != nil else{return}
                    self.pinnedSidebarNavigationDispatchTimeoutTask?.cancel();self.pinnedSidebarNavigationDispatchTimeoutTask=nil
                    if error != nil {
                        self.pinnedActivitySidebarDispatchPrimitive="evaluation_error"
                        self.finishPinnedActivityFallback(state:.error,reason:"sidebar_sync_dispatch_error",token:token,id:id,ordinal:ordinal)
                        self.finishPinnedSidebarNavigation(token:token,result:false);return
                    }
                    guard let result=value as? [String:Any],let status=result["status"] as? String else {
                        self.pinnedActivitySidebarDispatchPrimitive="invalid_result"
                        self.finishPinnedActivityFallback(state:.error,reason:"sidebar_sync_result_invalid",token:token,id:id,ordinal:ordinal)
                        self.finishPinnedSidebarNavigation(token:token,result:false);return
                    }
                    self.pinnedActivityAutomationBridgePresent=status != "bridge_missing"
                    self.pinnedActivitySidebarHandlerPresent = !["bridge_missing","handler_missing"].contains(status)
                    self.pinnedActivitySidebarDispatchPrimitive=status
                    self.pinnedActivityNavigationCommandAccepted=self.pinnedActivitySidebarHandlerPresent
                    self.pinnedActivitySidebarCommandAckState=self.pinnedActivitySidebarCommandReceived ? "observed":"not observed"
                    self.pinnedActivitySidebarTotalAnchors=(result["totalAnchors"] as? NSNumber)?.intValue ?? 0
                    self.pinnedActivitySidebarConversationAnchors=(result["conversationAnchors"] as? NSNumber)?.intValue ?? 0
                    self.pinnedActivitySidebarMatchingAnchors=(result["matchingAnchors"] as? NSNumber)?.intValue ?? 0
                    self.pinnedActivitySidebarAnchorScanComplete=(result["scanComplete"] as? Bool)==true
                    self.pinnedActivityNavigationDiagnosticReason=status
                    self.recordPinnedActivityPreNavigationStage("sidebar_row_lookup_started",token:token)
                    if self.pinnedActivitySidebarAnchorScanComplete {self.recordPinnedActivityPreNavigationStage("sidebar_row_anchor_scan_complete",token:token)}
                    self.handlePinnedSidebarSyncResult(result,token:token,id:id,ordinal:ordinal)
                    self.setLastIsolatedDiagnostic(self.pinnedActivityStatusText())
                }
            }
        }
    }
    @MainActor func handlePinnedSidebarSyncResult(_ result:[String:Any],token:String,id:String,ordinal:Int) {
        guard pinnedSidebarNavigationToken==token,pinnedSidebarNavigationContinuation != nil else{return}
        let status=result["status"] as? String ?? "sidebar_sync_result_invalid"
        switch status {
        case "bridge_missing":
            finishPinnedActivityFallback(state:.error,reason:"sidebar_bridge_missing",token:token,id:id,ordinal:ordinal);finishPinnedSidebarNavigation(token:token,result:false)
        case "handler_missing":
            finishPinnedActivityFallback(state:.error,reason:"sidebar_handler_missing",token:token,id:id,ordinal:ordinal);finishPinnedSidebarNavigation(token:token,result:false)
        case "row_missing":
            pinnedActivitySidebarRowLookupTerminal=true;pinnedActivityNavigationDiagnosticReason="sidebar_row_missing"
            finishPinnedActivityFallback(state:.error,reason:"sidebar_row_missing",token:token,id:id,ordinal:ordinal);finishPinnedSidebarNavigation(token:token,result:false)
        case "row_ambiguous":
            pinnedActivitySidebarRowLookupTerminal=true;pinnedActivityNavigationDiagnosticReason="sidebar_row_ambiguous"
            finishPinnedActivityFallback(state:.error,reason:"sidebar_row_ambiguous",token:token,id:id,ordinal:ordinal);finishPinnedSidebarNavigation(token:token,result:false)
        case "row_lookup_error":
            pinnedActivitySidebarRowLookupTerminal=true
            let category=result["errorCategory"] as? String ?? "Error"
            pinnedActivitySidebarLookupErrorCategory=["TypeError","SyntaxError","SecurityError"].contains(category) ? category:"Error"
            pinnedActivityNavigationDiagnosticReason="sidebar_row_lookup_error"
            finishPinnedActivityFallback(state:.error,reason:"sidebar_row_lookup_error",token:token,id:id,ordinal:ordinal);finishPinnedSidebarNavigation(token:token,result:false)
        case "sidebar_navigation_error":
            pinnedActivityNavigationDiagnosticReason="sidebar_navigation_error"
            finishPinnedActivityFallback(state:.error,reason:"sidebar_navigation_error",token:token,id:id,ordinal:ordinal);finishPinnedSidebarNavigation(token:token,result:false)
        case "row_resolved_needs_scroll":
            pinnedActivitySidebarRowLookupTerminal=true;pinnedActivitySidebarRowReresolved=true;pinnedActivitySidebarRowVisible="No";pinnedActivitySidebarScrollRequired=true
            recordPinnedActivityPreNavigationStage("sidebar_row_resolved",token:token);recordPinnedActivityPreNavigationStage("sidebar_scroll_started",token:token)
            continuePinnedSidebarScroll(token:token,id:id,ordinal:ordinal)
        case "sidebar_anchor_click_invoked":
            pinnedActivitySidebarRowLookupTerminal=true;pinnedActivitySidebarRowReresolved=true;pinnedActivitySidebarRowVisible="Yes"
            applyPinnedSidebarActivationTelemetry(result)
            pinnedActivityNavigationDiagnosticReason="sidebar_anchor_click_invoked";recordPinnedActivityPreNavigationStage("sidebar_row_resolved",token:token)
            guard pinnedActivitySidebarAnchorClickInvoked else {finishPinnedActivityFallback(state:.error,reason:"sidebar_click_failed",token:token,id:id,ordinal:ordinal);finishPinnedSidebarNavigation(token:token,result:false);return}
            recordPinnedActivityPreNavigationStage("sidebar_click_delivered",token:token)
            beginPinnedSidebarRouteWait(token:token,id:id,ordinal:ordinal,activationResult:result)
        default:
            pinnedActivityNavigationDiagnosticReason="sidebar_sync_result_invalid"
            finishPinnedActivityFallback(state:.error,reason:"sidebar_sync_result_invalid",token:token,id:id,ordinal:ordinal);finishPinnedSidebarNavigation(token:token,result:false)
        }
    }
    @MainActor func continuePinnedSidebarScroll(token:String,id:String,ordinal:Int) {
        let encoded=(try? JSONSerialization.data(withJSONObject:[id,token])).flatMap{String(data:$0,encoding:.utf8)} ?? "[]"
        web.evaluateJavaScript("window.gptContinueSidebarScroll(\(encoded)[0],\(encoded)[1])") { [weak self] value,error in
            Task { @MainActor in
                guard let self,self.pinnedSidebarNavigationToken==token,self.pinnedSidebarNavigationContinuation != nil else{return}
                if error != nil {self.finishPinnedActivityFallback(state:.error,reason:"sidebar_row_scroll_failed",token:token,id:id,ordinal:ordinal);self.finishPinnedSidebarNavigation(token:token,result:false);return}
                guard let result=value as? [String:Any] else {self.finishPinnedActivityFallback(state:.error,reason:"sidebar_row_scroll_failed",token:token,id:id,ordinal:ordinal);self.finishPinnedSidebarNavigation(token:token,result:false);return}
                if result["status"] as? String == "sidebar_anchor_click_invoked" {
                    self.pinnedActivitySidebarScrollRequired=true;self.pinnedActivitySidebarRowVisible="Yes";self.pinnedActivitySidebarRowReresolved=true
                    self.applyPinnedSidebarActivationTelemetry(result)
                    self.pinnedActivityNavigationDiagnosticReason="sidebar_anchor_click_invoked";self.recordPinnedActivityPreNavigationStage("sidebar_row_resolved",token:token);self.recordPinnedActivityPreNavigationStage("sidebar_click_delivered",token:token)
                    self.beginPinnedSidebarRouteWait(token:token,id:id,ordinal:ordinal,activationResult:result)
                } else {
                    let status=result["status"] as? String ?? "sidebar_row_scroll_failed"
                    let reason=status=="row_lookup_error" ? "sidebar_row_lookup_error":(status=="row_ambiguous" ? "sidebar_row_ambiguous":"sidebar_row_scroll_failed")
                    self.pinnedActivityNavigationDiagnosticReason=reason
                    self.finishPinnedActivityFallback(state:.error,reason:reason,token:token,id:id,ordinal:ordinal);self.finishPinnedSidebarNavigation(token:token,result:false)
                }
                self.setLastIsolatedDiagnostic(self.pinnedActivityStatusText())
            }
        }
    }
    @MainActor func applyPinnedSidebarActivationTelemetry(_ result:[String:Any]) {
        pinnedActivitySidebarActivationMethod=result["activationMethod"] as? String ?? "unknown"
        pinnedActivitySidebarAnchorFound=(result["anchorFound"] as? Bool)==true
        pinnedActivitySidebarHrefMatchesExpected=(result["hrefMatchesExpected"] as? Bool)==true
        pinnedActivitySidebarTargetAttributePresent=(result["targetAttributePresent"] as? Bool)==true
        pinnedActivitySidebarDownloadAttributePresent=(result["downloadAttributePresent"] as? Bool)==true
        pinnedActivitySidebarAnchorClickInvoked=(result["clickInvoked"] as? Bool)==true
        pinnedActivitySidebarRouteChangedImmediately=((result["routeChangedImmediately"] as? Bool).map{$0 ? "Yes":"No"}) ?? "unknown"
        if let template=result["immediateRouteTemplate"] as? String,["/c/<id>","/g/<id>/c/<id>"].contains(template){pinnedActivitySidebarRouteAfter=template}
        pinnedActivitySidebarRouteChangedDuringWait=(result["routeChangedImmediately"] as? Bool)==true
        pinnedActivitySidebarClickDelivered=pinnedActivitySidebarAnchorClickInvoked
        pinnedActivityNavigationCommandSent=pinnedActivitySidebarAnchorClickInvoked
        pinnedActivitySidebarClickDefaultPrevented="unknown"
    }
    @MainActor func finishPinnedSidebarRouteWait(token:String,id:String,ordinal:Int,reason:String,routeTemplate:String?=nil) {
        guard pinnedSidebarNavigationToken==token,pinnedSidebarNavigationContinuation != nil else{return}
        pinnedSidebarRouteWaitTimeoutTask?.cancel();pinnedSidebarRouteWaitTimeoutTask=nil
        if reason=="sidebar_route_reached",let template=routeTemplate,["/c/<id>","/g/<id>/c/<id>"].contains(template) {
            pinnedActivitySidebarRouteAfter=template;pinnedActivityNavigationURLChanged=true;pinnedActivityNavigationTargetURLObserved=true;pinnedActivityNavigationDiagnosticReason=reason
            confirmPinnedActivityRoute(token:token,id:id,ordinal:ordinal,template:template,source:"sidebar_ui")
            finishPinnedSidebarNavigation(token:token,result:true)
        } else {
            let terminal=["sidebar_navigation_no_effect","sidebar_navigation_wrong_route","sidebar_navigation_error"].contains(reason) ? reason:"sidebar_navigation_error"
            pinnedActivityNavigationDiagnosticReason=terminal
            finishPinnedActivityFallback(state:.error,reason:terminal,token:token,id:id,ordinal:ordinal)
            finishPinnedSidebarNavigation(token:token,result:false)
        }
        setLastIsolatedDiagnostic(pinnedActivityStatusText())
    }
    @MainActor func pollPinnedSidebarRoute(token:String,id:String,ordinal:Int) {
        guard pinnedSidebarNavigationToken==token,pinnedSidebarNavigationContinuation != nil else{return}
        let encoded=(try? JSONSerialization.data(withJSONObject:[id,token])).flatMap{String(data:$0,encoding:.utf8)} ?? "[]"
        web.evaluateJavaScript("window.gptPinnedConversationRouteState(\(encoded)[0],\(encoded)[1])") { [weak self] value,error in
            Task { @MainActor in
                guard let self,self.pinnedSidebarNavigationToken==token,self.pinnedSidebarNavigationContinuation != nil else{return}
                guard error==nil,let state=value as? [String:Any] else {self.finishPinnedSidebarRouteWait(token:token,id:id,ordinal:ordinal,reason:"sidebar_navigation_error");return}
                let changed=(state["routeChanged"] as? Bool)==true
                self.pinnedActivitySidebarRouteChangedDuringWait = self.pinnedActivitySidebarRouteChangedDuringWait || changed
                if let template=state["routeTemplate"] as? String,["/c/<id>","/g/<id>/c/<id>"].contains(template),changed {self.pinnedActivitySidebarRouteAfter=template}
                if (state["matches"] as? Bool)==true {
                    let template=state["routeTemplate"] as? String ?? "unknown"
                    self.finishPinnedSidebarRouteWait(token:token,id:id,ordinal:ordinal,reason:"sidebar_route_reached",routeTemplate:template);return
                }
                self.setLastIsolatedDiagnostic(self.pinnedActivityStatusText())
                Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds:150_000_000)
                    guard let self,self.pinnedSidebarNavigationToken==token,self.pinnedSidebarNavigationContinuation != nil else{return}
                    self.pollPinnedSidebarRoute(token:token,id:id,ordinal:ordinal)
                }
            }
        }
    }
    @MainActor func beginPinnedSidebarRouteWait(token:String,id:String,ordinal:Int,activationResult:[String:Any]) {
        pinnedActivityNavigationDiagnosticReason="sidebar_route_wait_started";recordPinnedActivityNavigationStage("sidebar_route_wait_started",token:token)
        let immediateMatched=(activationResult["immediateTargetMatched"] as? Bool)==true
        if immediateMatched,let template=activationResult["immediateRouteTemplate"] as? String {
            finishPinnedSidebarRouteWait(token:token,id:id,ordinal:ordinal,reason:"sidebar_route_reached",routeTemplate:template);return
        }
        pinnedSidebarRouteWaitTimeoutTask?.cancel()
        pinnedSidebarRouteWaitTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:4_500_000_000)
            guard let self,self.pinnedSidebarNavigationToken==token,self.pinnedSidebarNavigationContinuation != nil else{return}
            let reason=self.pinnedActivitySidebarRouteChangedDuringWait ? "sidebar_navigation_wrong_route":"sidebar_navigation_no_effect"
            self.finishPinnedSidebarRouteWait(token:token,id:id,ordinal:ordinal,reason:reason)
        }
        setLastIsolatedDiagnostic(pinnedActivityStatusText())
        pollPinnedSidebarRoute(token:token,id:id,ordinal:ordinal)
    }
    @MainActor func finishPinnedSidebarNavigation(token:String,result:Bool) {
        guard pinnedSidebarNavigationToken==token,let continuation=pinnedSidebarNavigationContinuation else{return}
        pinnedSidebarNavigationContinuation=nil;pinnedSidebarNavigationToken=nil
        pinnedSidebarNavigationTimeoutTask?.cancel();pinnedSidebarNavigationTimeoutTask=nil
        pinnedSidebarNavigationDispatchTimeoutTask?.cancel();pinnedSidebarNavigationDispatchTimeoutTask=nil
        pinnedSidebarNavigationAckTimeoutTask?.cancel();pinnedSidebarNavigationAckTimeoutTask=nil
        pinnedSidebarRowLookupTimeoutTask?.cancel();pinnedSidebarRowLookupTimeoutTask=nil
        pinnedSidebarRouteWaitTimeoutTask?.cancel();pinnedSidebarRouteWaitTimeoutTask=nil
        continuation.resume(returning:result)
    }
    @MainActor func restorePinnedActivityOriginRoute(token:String,targetID:String) async {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityTargetDiffersFromCurrent,
              conversationID(in:web.url)==targetID else {pinnedActivityNavigationCleanup="not_required";return}
        guard let origin=pinnedActivityNavigationOriginURL,origin.host=="chatgpt.com",web.canGoBack,
              web.goBack() != nil else {pinnedActivityNavigationCleanup="not_restored";return}
        let deadline=Date().addingTimeInterval(3)
        while Date()<deadline {
            if safeNavigationRouteTemplate(web.url)==safeNavigationRouteTemplate(origin),
               conversationID(in:web.url)==conversationID(in:origin) {pinnedActivityNavigationCleanup="restored";return}
            do {try await Task.sleep(nanoseconds:100_000_000)} catch {break}
        }
        pinnedActivityNavigationCleanup="not_restored"
    }
    @MainActor func beginPinnedActivityNavigation(id:String,route:String,token:String,ordinal:Int) async -> Bool {
        pinnedActivityMainActorEntered=true
        recordPinnedActivityPreNavigationStage("main_actor_entered",token:token)
        guard !Task.isCancelled else {
            recordPinnedActivityPreNavigationStage("operation_cancelled",token:token,reason:"operation_cancelled")
            finishPinnedActivityFallback(state:.error,reason:"operation_cancelled",token:token,id:id,ordinal:ordinal);return false
        }
        guard pinnedActivityDiagnosticToken==token else {noteStalePinnedNavigationCallback();return false}
        guard pinnedActivityExpectedConversationID==id,pinnedActivityExpectedOrdinal==ordinal,
              pinnedActivityNavigationOperationToken==token else {
            recordPinnedActivityPreNavigationStage("stale_operation",token:token,reason:"stale_operation")
            if pinnedActivityExpectedConversationID==id,pinnedActivityExpectedOrdinal==ordinal {
                finishPinnedActivityFallback(state:.error,reason:"stale_operation",token:token,id:id,ordinal:ordinal)
            }
            return false
        }
        let timestampState=PinnedTimestampState(rawValue:pinnedActivityTimestampStage) ?? .notStarted
        guard timestampState == .resolving,ordinal>0,ordinal<=pinnedActivityTimestampItemStates.count,
              pinnedActivityTimestampItemStates[ordinal-1]=="pending" else {
            recordPinnedActivityPreNavigationStage("timestamp_already_terminal",token:token,reason:"timestamp_already_terminal")
            finishPinnedActivityFallback(state:.error,reason:"timestamp_already_terminal",token:token,id:id,ordinal:ordinal);return false
        }
        let webView:WKWebView?=web
        let webViewAvailable=webView != nil
        let webViewAttached=webViewAvailable && session != nil && session.contentView === webView
        pinnedActivityWebViewAvailable=webViewAvailable;pinnedActivityWebViewAttached=webViewAttached
        guard let resolvedWebView=webView,webViewAttached else {
            recordPinnedActivityPreNavigationStage("webview_unavailable",token:token,reason:"webview_unavailable")
            finishPinnedActivityFallback(state:.error,reason:"webview_unavailable",token:token,id:id,ordinal:ordinal);return false
        }
        recordPinnedActivityPreNavigationStage("webview_resolved",token:token)
        let leaseVerified=backgroundRenderLeaseOwner==token && session.isVisible && !resolvedWebView.isHidden && session.ignoresMouseEvents
        pinnedActivityRenderLeaseVerified=leaseVerified
        guard leaseVerified else {
            recordPinnedActivityPreNavigationStage("render_lease_lost",token:token,reason:"render_lease_lost")
            finishPinnedActivityFallback(state:.error,reason:"render_lease_lost",token:token,id:id,ordinal:ordinal);return false
        }
        recordPinnedActivityPreNavigationStage("render_lease_verified",token:token)
        guard !route.hasPrefix("//"),route.hasPrefix("/"),
              let routeURL=URL(string:"https://chatgpt.com"+route),
              let components=URLComponents(url:routeURL,resolvingAgainstBaseURL:false),
              components.host=="chatgpt.com",components.query==nil,components.fragment==nil,
              conversationRouteTemplate(components.path) != nil,conversationID(in:components.url)==id,
              resolvedWebView.url?.host=="chatgpt.com",pinnedActivityNavigation==nil,!pinnedActivityNavigationCommandSent else {
            recordPinnedActivityPreNavigationStage("navigation_context_invalid",token:token,reason:"navigation_context_invalid")
            finishPinnedActivityFallback(state:.error,reason:"navigation_context_invalid",token:token,id:id,ordinal:ordinal);return false
        }
        pinnedActivityFrontendRoute=route
        pinnedActivityNavigationTemplate=conversationRouteTemplate(components.path) ?? "unknown"
        pinnedActivityCurrentRouteBefore=safeNavigationRouteTemplate(resolvedWebView.url)
        pinnedActivityTargetDiffersFromCurrent=conversationID(in:resolvedWebView.url) != id
        pinnedActivityNavigationObjectReturned=false
        pinnedActivityNavigationDelegateExists=resolvedWebView.navigationDelegate != nil
        pinnedActivityNavigationDelegateCorrect=resolvedWebView.navigationDelegate === self
        pinnedActivityNavigationURLChanged=false;pinnedActivityNavigationTargetURLObserved=false;pinnedActivityNavigationProgressChanged=false
        pinnedActivityNavigationInitialProgress=resolvedWebView.estimatedProgress;pinnedActivityNavigationStartedAt=Date()
        pinnedActivityNavigationSnapshotSummary="not_run";pinnedActivityNavigationDiagnosticReason="none"
        if pinnedNavigationTargetAlreadyLoaded(currentConversationID:conversationID(in:resolvedWebView.url),expectedConversationID:id) {
            pinnedActivityNavigationObjectReturned=false;pinnedActivityNavigationCommandSent=false;pinnedActivityNavigationCommandAccepted=false
            recordPinnedActivityNavigationStage("target_route_already_loaded",token:token)
            confirmPinnedActivityRoute(token:token,id:id,ordinal:ordinal,template:conversationRouteTemplate(resolvedWebView.url?.path ?? "") ?? pinnedActivityNavigationTemplate,source:"current_route")
            return true
        }
        guard installPinnedActivityContextUserScript(owner:"isolated_timestamp_fallback",generation:token,stage:"timestamp_navigation",expectedConversationID:id) else {
            recordPinnedActivityPreNavigationStage("activity_context_injection_failed",token:token,reason:"activity_context_injection_failed")
            finishPinnedActivityFallback(state:.error,reason:"activity_context_injection_failed",token:token,id:id,ordinal:ordinal);return false
        }
        pinnedActivityBackendObservationActive=true
        recordPinnedActivityTimestampStage("backend_traffic_observation_armed",token:token)
        pinnedActivityPendingResponse=nil;pinnedActivityResponseBufferedBeforeRoute=false
        pinnedActivityWaiterToken=token;pinnedActivityWaiterConversationID=id;pinnedActivityWaiterOrdinal=ordinal
        pinnedActivityWaiterArmed=true
        pinnedActivityWaiterWasArmedBeforeLoad=true
        recordPinnedActivityTimestampStage("activity_waiter_armed_before_navigation",token:token)
        recordPinnedActivityPreNavigationStage("navigation_command_about_to_send",token:token)
        pinnedActivityNavigationCommandSent=true
        guard let navigation=resolvedWebView.load(URLRequest(url:components.url!)) else {
            pinnedActivityNavigationObjectReturned=false;pinnedActivityNavigationCommandAccepted=false
            restoreRuntimeUserScripts()
            recordPinnedActivityPreNavigationStage("navigation_command_rejected",token:token,reason:"navigation_command_rejected")
            finishPinnedActivityFallback(state:.error,reason:"navigation_command_rejected",token:token,id:id,ordinal:ordinal);return false
        }
        pinnedActivityNavigation=navigation
        pinnedActivityNavigationObjectReturned=true;pinnedActivityNavigationCommandAccepted=true
        recordPinnedActivityPreNavigationStage("navigation_command_sent",token:token)
        recordPinnedActivityNavigationStage("navigation_command_accepted",token:token)
        pinnedActivityNavigationSnapshotCount=0
        return await observePinnedNavigationInline(webView:resolvedWebView,token:token,id:id,ordinal:ordinal)
    }
    func isCurrentPinnedNavigation(_ navigation:WKNavigation?,webView:WKWebView)->(String,String,Int)? {
        guard webView===web,let navigation,let active=pinnedActivityNavigation,navigation===active,
              let token=pinnedActivityNavigationOperationToken,token==pinnedActivityDiagnosticToken,
              let id=pinnedActivityExpectedConversationID,let ordinal=pinnedActivityExpectedOrdinal else{return nil}
        return(token,id,ordinal)
    }
    func finishPinnedActivityTimestamps(token:String) {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityTimestampExpected else{return}
        for index in pinnedActivityTimestampItemStates.indices where pinnedActivityTimestampItemStates[index]=="pending" {
            _=completePinnedActivityItem(ordinal:index+1,state:.error,token:token,reason:"timestamp_item_unresolved")
        }
        let state=pinnedTimestampAggregateState(resolved:pinnedActivityResolved,total:pinnedActivityPinnedCount,timeouts:pinnedActivityTimestampTimeouts,errors:pinnedActivityTimestampErrors)
        pinnedActivityTimestampStage=state.rawValue
        if state == .timeout && pinnedActivityTimestampReason=="none" {pinnedActivityTimestampReason="timestamp_timeout"}
        else if state == .error && pinnedActivityTimestampReason=="none" {pinnedActivityTimestampReason="timestamp_error"}
        else if state == .partial && pinnedActivityTimestampReason=="none" {pinnedActivityTimestampReason="timestamp_partial"}
        else if state == .resolved && pinnedActivityTimestampReason=="none" {pinnedActivityTimestampReason="none"}
        if pinnedActivityLeaseStages.last != "activity_completed" {pinnedActivityLeaseStages.append("activity_completed")}
        pinnedActivityItemTimeoutTask?.cancel();pinnedActivityItemTimeoutTask=nil;pinnedActivityExpectedConversationID=nil;pinnedActivityExpectedOrdinal=nil
        web.evaluateJavaScript("window.gptSetRateLimitContext?.('unrelated_passive_traffic',null,'page_idle')",completionHandler:nil)
        updatePinnedActivityStage("timestamp_completed",token:token,timeoutSeconds:nil)
        finishPinnedActivityDiagnostic()
    }
    func schedulePinnedActivityResolver(token:String) {
        guard pinnedActivityDiagnosticToken==token else { return }
        guard pinnedActivityTimestampExpected else { failPinnedTimestampDispatch("timestamp_dispatch_blocked",token:token);return }
        guard pinnedActivityResolverTask==nil else { failPinnedTimestampDispatch("timestamp_resolver_already_active",token:token);return }
        pinnedActivityTimestampResolverInvoked=true;pinnedActivityTimestampDispatchStage="resolver_invoked"
        updatePinnedActivityStage("timestamp_resolver_invoked",token:token,timeoutSeconds:nil)
        pinnedActivityDispatchTimeoutTask?.cancel()
        pinnedActivityDispatchTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:3_000_000_000)
            guard let self,self.pinnedActivityDiagnosticToken==token,!self.pinnedActivityTimestampResolverEntered,
                  self.pinnedActivityTimestampExpected,!((PinnedTimestampState(rawValue:self.pinnedActivityTimestampStage) ?? .notStarted).isTerminal) else{return}
            self.failPinnedTimestampDispatch("timestamp_resolver_not_entered",token:token)
        }
        pinnedActivityResolverTask=Task { @MainActor [weak self] in
            guard let self else{return}
            guard self.pinnedActivityDiagnosticToken==token,self.pinnedActivityTimestampExpected else{return}
            self.pinnedActivityDispatchTimeoutTask?.cancel();self.pinnedActivityDispatchTimeoutTask=nil
            self.pinnedActivityTimestampResolverEntered=true;self.pinnedActivityTimestampDispatchStage="resolver_entered"
            self.recordPinnedActivityTimestampStage("timestamp_resolver_entered",token:token)
            self.updatePinnedActivityStage("timestamp_resolver_entered",token:token,timeoutSeconds:nil)
            let budget=max(120,45+self.pinnedActivityPinnedCount*20)
            let elapsed=Int(max(0,Date().timeIntervalSince(self.pinnedActivityStartedAt ?? Date())))
            let overallRemaining=max(1,self.pinnedActivityTotalBudgetMs/1000-elapsed)
            let boundedBudget=min(budget,overallRemaining)
            self.pinnedActivityTimeoutTask?.cancel()
            self.pinnedActivityTimeoutTask=Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds:UInt64(boundedBudget)*1_000_000_000)
                guard let self,self.pinnedActivityDiagnosticToken==token,self.pinnedActivityTimestampResolverEntered,
                      self.pinnedActivityTimestampExpected,!((PinnedTimestampState(rawValue:self.pinnedActivityTimestampStage) ?? .notStarted).isTerminal) else{return}
                self.pinnedActivityGenericTimeoutActivityState=self.pinnedActivityLiveWaitState
                self.pinnedActivityGenericTimeoutDeadlineActive=self.pinnedActivityLiveWaitDeadlineActive
                self.pinnedActivityGenericTimeoutDeadlineElapsed=self.pinnedActivityLiveWaitDeadlineElapsed
                if self.pinnedActivityLiveWaitState=="waiting" {
                    self.pinnedActivityLiveWaitDeadlineElapsed=true
                    self.finishPinnedActivityLiveWait(token:token,id:self.pinnedActivityExpectedConversationID ?? "",ordinal:self.pinnedActivityExpectedOrdinal ?? 0,result:.timeout)
                    return
                }
                if ["response_received","timeout","error"].contains(self.pinnedActivityLiveWaitState) || self.pinnedActivityChildTerminalReason != "none" {
                    return
                }
                if self.pinnedSidebarNavigationToken==token,
                   let id=self.pinnedActivityExpectedConversationID,let ordinal=self.pinnedActivityExpectedOrdinal {
                    self.finishPinnedActivityFallback(state:.timeout,reason:"sidebar_navigation_bridge_timeout",token:token,id:id,ordinal:ordinal)
                    return
                }
                for index in self.pinnedActivityTimestampItemStates.indices where self.pinnedActivityTimestampItemStates[index]=="pending" {
                    _=self.completePinnedActivityItem(ordinal:index+1,state:.timeout,token:token,reason:"timestamp_timeout")
                }
                self.pinnedActivityTimestampStage=PinnedTimestampState.timeout.rawValue
                self.pinnedActivityTimestampReason=pinnedTimestampFailureReason(childReason:self.pinnedActivityChildTerminalReason,fallbackReason:boundedBudget<budget ? "activity_resolution_timeout":"timestamp_timeout")
                self.recordPinnedActivityTimestampStage("timestamp_timeout",token:token)
                self.updatePinnedActivityStage("timestamp_completed",token:token,timeoutSeconds:nil)
                self.finishPinnedActivityDiagnostic()
            }
            await self.resolveNextPinnedActivity(token:token)
            self.pinnedActivityResolverTask=nil
        }
    }
    func failPinnedTimestampDispatch(_ reason:String,token:String) {
        guard pinnedActivityDiagnosticToken==token else{return}
        pinnedActivityTimestampDispatchStage="blocked";pinnedActivityTimestampDispatchReason=reason
        pinnedActivityTimestampReason=reason;pinnedActivityTimestampExpected=pinnedActivityTimestampItemsCreated>0
        for index in pinnedActivityTimestampItemStates.indices where pinnedActivityTimestampItemStates[index]=="pending" {
            _=completePinnedActivityItem(ordinal:index+1,state:.error,token:token,reason:reason)
        }
        pinnedActivityTimestampStage=pinnedActivityTimestampItemsCreated>0 ? PinnedTimestampState.error.rawValue:PinnedTimestampState.skipped.rawValue
        recordPinnedActivityTimestampStage(reason,token:token)
        updatePinnedActivityStage("timestamp_completed",token:token,timeoutSeconds:nil)
        finishPinnedActivityDiagnostic()
    }
    @MainActor func resolveNextPinnedActivity(token:String) async {
        guard pinnedActivityDiagnosticToken==token,pinnedActivityTimestampExpected else{return}
        pinnedActivityItemTimeoutTask?.cancel();pinnedActivityItemTimeoutTask=nil;pinnedActivityExpectedConversationID=nil;pinnedActivityExpectedOrdinal=nil
        while pinnedActivityIndex<pinnedActivityPinnedCount {
            guard !Task.isCancelled,pinnedActivityDiagnosticToken==token,pinnedActivityTimestampExpected else{return}
            let ordinal=pinnedActivityIndex+1;pinnedActivityIndex+=1
            pinnedActivityAttemptedCount=pinnedActivityIndex
            let record=pinnedActivityIndex<=pinnedActivityRecords.count ? pinnedActivityRecords[pinnedActivityIndex-1] : [:]
            guard recordPinnedActivityLeaseStage("lease_present_before_primary",token:token) else {
                let reason="render_lease_lost_during_primary"
                pinnedActivityTimestampReason=reason;recordPinnedActivityTimestampStage(reason,token:token)
                _=completePinnedActivityItem(ordinal:ordinal,state:.error,token:token,reason:reason)
                continue
            }
            pinnedActivityLeaseStages.append("activity_primary_attempt")
            recordPinnedActivityTimestampStage("timestamp_started",token:token)
            recordPinnedActivityTimestampStage("passive_lookup_started",token:token)
            let passiveMatch=(record["passiveMatch"] as? Bool)==true
            let matchingRecords=(record["matchingMetadataRecords"] as? NSNumber)?.intValue ?? (passiveMatch ? 1:0)
            pinnedActivityPassiveMatchingRecords += matchingRecords
            pinnedActivityPassiveUpdateTimePresent = pinnedActivityPassiveUpdateTimePresent || (record["updateTimePresent"] as? Bool)==true
            pinnedActivityPassiveLookup = pinnedActivityPassiveMatchingRecords>0 ? "hit":"miss"
            pinnedActivityPassiveSummaries.append("Pinned \(ordinal): \(passiveMatch ? "hit":"miss") · records \(matchingRecords) · update_time \((record["updateTimePresent"] as? Bool)==true ? "Yes":"No")")
            if validPinnedActivity(record),let time=record["lastActivityAt"] as? Double {
                recordPinnedActivityTimestampStage("passive_lookup_hit",token:token)
                recordPinnedActivityTimestampStage("timestamp_resolved",token:token)
                pinnedActivityTimestampReason="passive_timestamp_resolved"
                _=completePinnedActivityItem(ordinal:ordinal,state:.resolved,token:token,time:time,source:record["activitySource"] as? String)
                continue
            }
            recordPinnedActivityTimestampStage("passive_lookup_miss",token:token)
            guard let id=record["conversationId"] as? String,id.range(of:#"^[A-Za-z0-9-]{1,128}$"#,options:.regularExpression) != nil else {
                pinnedActivityTimestampReason="timestamp_error";recordPinnedActivityTimestampStage("timestamp_error",token:token)
                _=completePinnedActivityItem(ordinal:ordinal,state:.error,token:token,reason:"invalid_timestamp_record")
                continue
            }
            pinnedActivityExpectedConversationID=id;pinnedActivityExpectedOrdinal=ordinal;cycleActivity=nil
            pinnedActivityBackendItemExpectedMatches=0;pinnedActivityBackendItemTimestampFieldMatches=0;pinnedActivityBackendItemTimestampBearingMatches=0
            pinnedActivityLiveWaitTimeoutTask?.cancel();pinnedActivityLiveWaitTimeoutTask=nil;pinnedActivityLiveWaitState="not_started";pinnedActivityLiveWaitStartedAt=nil;pinnedActivityLiveWaitDurationMs="not_run";pinnedActivityLiveWaitResult=nil;pinnedActivityLiveWaitContinuation=nil;pinnedActivityLiveWaitDeadlineActive=false;pinnedActivityLiveWaitDeadlineElapsed=false
            pinnedActivityFallbackStarted=true;pinnedActivityRouteLoaded=false;pinnedActivityNavigationCompleted=false;pinnedActivityActivityResponseSeen=false;pinnedActivityTimestampFieldSeen=false;pinnedActivityTimestampFieldType="unknown"
            pinnedActivityNavigation=nil;pinnedActivityNavigationOperationToken=token;pinnedActivityNavigationCommandSent=false;pinnedActivityNavigationCommandAccepted=false
            pinnedActivityProvisionalStarted=false;pinnedActivityNavigationCommitted=false;pinnedActivityNavigationFinished=false;pinnedActivityRouteConfirmed=false
            pinnedActivityNavigationError="none";pinnedActivityNavigationTemplate="unknown"
            recordPinnedActivityTimestampStage("fallback_started",token:token)
            recordPinnedActivityTimestampStage("fallback_navigation_started",token:token)
            recordPinnedActivityPreNavigationStage("fallback_started",token:token)
            _=recordPinnedActivityLeaseStage("activity_fallback_started",token:token)
            guard recordPinnedActivityLeaseStage("lease_present_before_fallback",token:token) else {
                let reason="render_lease_lost_during_fallback"
                pinnedActivityTimestampReason=reason;recordPinnedActivityTimestampStage(reason,token:token)
                _=completePinnedActivityItem(ordinal:ordinal,state:.error,token:token,reason:reason)
                continue
            }
            guard let exactRoute=record["frontendRoute"] as? String,!exactRoute.isEmpty else {
                recordPinnedActivityPreNavigationStage("frontend_route_missing",token:token,reason:"frontend_route_missing")
                finishPinnedActivityFallback(state:.error,reason:"frontend_route_missing",token:token,id:id,ordinal:ordinal)
                continue
            }
            recordPinnedActivityPreNavigationStage("route_available",token:token)
            recordPinnedActivityPreNavigationStage("navigation_request_created",token:token)
            let navigationSent=await beginPinnedSidebarNavigation(id:id,route:exactRoute,token:token,ordinal:ordinal)
            if navigationSent {
                if pinnedActivityBufferHit {
                    await restorePinnedActivityOriginRoute(token:token,targetID:id)
                    continue
                }
                let liveResult=await awaitPinnedActivityLiveWait(token:token,id:id,ordinal:ordinal)
                switch liveResult {
                case .response(let data):
                    applyConfirmedPinnedActivityResponse(data,token:token,id:id,ordinal:ordinal)
                case .timeout:
                    let reason=pinnedActivityBackendItemExpectedMatches==0 ? "activity_response_timeout":
                        (pinnedActivityBackendItemTimestampFieldMatches==0 ? "activity_timestamp_missing":
                         (pinnedActivityBackendItemTimestampBearingMatches==0 ? "timestamp_parse_failed":"activity_response_timeout"))
                    pinnedActivityChildTerminalReason=reason
                    finishPinnedActivityFallback(state:.timeout,reason:reason,token:token,id:id,ordinal:ordinal)
                case .error(let reason):
                    finishPinnedActivityFallback(state:.error,reason:reason,token:token,id:id,ordinal:ordinal)
                }
                await restorePinnedActivityOriginRoute(token:token,targetID:id)
                continue
            }
            continue
        }
        finishPinnedActivityTimestamps(token:token)
    }
    func handlePinnedActivityProbe(_ result:[String:Any],token:String) {
        guard pinnedActivityDiagnosticToken==token else{return}
        pinnedActivityJSPromiseStatus="resolved";pinnedActivitySwiftCompletion="received"
        pinnedActivityStageTimeoutTask?.cancel();pinnedActivityStageTimeoutTask=nil
        let readiness=result["readiness"] as? [String:Any] ?? [:],top=result["sidebarTop"] as? [String:Any] ?? [:]
        if let preflight=result["preflight"] as? [String:Any] {pinnedActivityPreflightSummary=preflightSummary(preflight)}
        pinnedActivityReadiness=readiness["status"] as? String ?? "unknown"
        pinnedActivityRowsAtFirstDetection=(readiness["rowsAtFirstDetection"] as? NSNumber)?.intValue ?? 0
        pinnedActivityRowsAtStabilizedSnapshot=(readiness["rowsAtStabilizedSnapshot"] as? NSNumber)?.intValue ?? 0
        pinnedActivityFirstPositiveCount=(readiness["firstPositiveCount"] as? NSNumber)?.intValue ?? 0
        pinnedActivityConversationSignatureChanges=(readiness["conversationSignatureChanges"] as? NSNumber)?.intValue ?? pinnedActivityConversationSignatureChanges
        pinnedActivityMutationChecks=(readiness["mutationChecks"] as? NSNumber)?.intValue ?? pinnedActivityMutationChecks
        pinnedActivityUnrelatedMutationChecks=(readiness["unrelatedMutationChecks"] as? NSNumber)?.intValue ?? pinnedActivityUnrelatedMutationChecks
        pinnedActivityStableCount=(readiness["finalStableCount"] as? NSNumber)?.intValue ?? (readiness["stableCount"] as? NSNumber)?.intValue ?? pinnedActivityStableCount
        pinnedActivityFinalSnapshotCount=(readiness["finalSnapshotCount"] as? NSNumber)?.intValue ?? 0
        pinnedActivityTimeToFirstPositiveMs=(readiness["timeToFirstPositiveMs"] as? NSNumber).map{String(format:"%.0f",$0.doubleValue)} ?? "unknown"
        pinnedActivityTimeToStableMs=(readiness["timeToStableMs"] as? NSNumber).map{String(format:"%.0f",$0.doubleValue)} ?? "unknown"
        pinnedActivityTerminalReason=readiness["terminalReason"] as? String ?? "unknown"
        pinnedActivityPrefixSnapshotCount=(result["prefixSnapshotCount"] as? NSNumber)?.intValue ?? 0
        pinnedActivityInitialSnapshotCount=(result["initialSnapshotCount"] as? NSNumber)?.intValue ?? pinnedActivityPrefixSnapshotCount
        pinnedActivityFinalPrefixSnapshotCount=(result["finalSnapshotCount"] as? NSNumber)?.intValue ?? pinnedActivityPrefixSnapshotCount
        pinnedActivitySnapshotExpansionCount=(result["snapshotExpansionCount"] as? NSNumber)?.intValue ?? 0
        pinnedActivityFirstNotPinnedFound=(result["firstNotPinnedFound"] as? Bool)==true
        pinnedActivityPrefixReason=result["pinnedPrefixReason"] as? String ?? result["stopReason"] as? String ?? "unknown"
        pinnedActivityTop=top["proof"] as? String ?? "unproven"
        pinnedActivityTopReason=top["reason"] as? String ?? result["stopReason"] as? String ?? "unknown"
        pinnedActivityPrefix=result["pinnedPrefixStatus"] as? String ?? "pinned_prefix_unproven"
        pinnedActivityReason=result["stopReason"] as? String ?? "unknown"
        if let rate=result["http429"] as? [String:Any],(rate["observed"] as? Bool)==true {
            pinnedActivity429Observed=true;pinnedActivity429Family=rate["family"] as? String ?? "unknown"
            pinnedActivity429Owner=rate["owner"] as? String ?? "unknown";pinnedActivity429Stage=rate["occurredAtStage"] as? String ?? "unknown"
            pinnedActivity429Relevant=(rate["relevant"] as? Bool)==true
        }
        pinnedActivityRowsInspected=max(pinnedActivityProcessedRows,(result["rowsInspected"] as? NSNumber)?.intValue ?? 0)
        pinnedActivityProcessedRows=pinnedActivityRowsInspected
        pinnedActivityPinnedCount=(result["pinnedCount"] as? NSNumber)?.intValue ?? pinnedActivityPinnedCount
        pinnedActivityOrdinaryCount=(result["notPinnedCount"] as? NSNumber)?.intValue ?? pinnedActivityOrdinaryCount
        pinnedActivityUnknownCount=(result["unknownCount"] as? NSNumber)?.intValue ?? pinnedActivityUnknownCount
        pinnedActivityFirstOrdinaryFound=(result["firstNotPinnedFound"] as? Bool) ?? pinnedActivityFirstOrdinaryFound
        pinnedActivityCleanup=(result["cleanupSuccessful"] as? Bool)==true ? "successful" : "incomplete"
        pinnedActivityNavigationMenuCleanup=pinnedActivityCleanup=="successful" ? "success":"failed"
        let scrollPosition=result["scrollPosition"] as? [String:Any] ?? [:]
        func scrollValue(_ key:String)->String {(scrollPosition[key] as? NSNumber).map{String($0.intValue)} ?? "n/a"}
        pinnedActivityScrollOwnerSummary="found \((result["scrollContainerFound"] as? Bool)==true ? "yes":"no") · owner \((result["scrollOwner"] as? [String:Any])?["tag"] as? String ?? "unknown") · initial/max/restored \(scrollValue("initial"))/\(scrollValue("maximumReached"))/\(scrollValue("restored")) · capacity \(scrollValue("maximumCapacity")) · restored \((result["scrollRestoreSuccessful"] as? Bool)==true ? "yes":"no")"
        let scrollAttempts=result["scrollAttempts"] as? [[String:Any]] ?? []
        pinnedActivityScrollAttemptsSummary=scrollAttempts.enumerated().map { index,attempt in
            func number(_ key:String)->String {(attempt[key] as? NSNumber).map{String(format:"%.1f",$0.doubleValue)} ?? "n/a"}
            let row=(attempt["rowIndex"] as? NSNumber)?.intValue ?? 0,ordinal=(attempt["attempt"] as? NSNumber)?.intValue ?? index+1
            let intersects=(attempt["intersectsViewport"] as? Bool)==true ? "yes":"no"
            return "row \(row) attempt \(ordinal): owner top/client/scroll \(number("ownerScrollTopBefore"))/\(number("clientHeight"))/\(number("scrollHeight")) · owner rect \(number("ownerRectTop"))…\(number("ownerRectBottom")) · row before \(number("rowRectTopBefore"))…\(number("rowRectBottomBefore")) · delta \(number("calculatedDelta")) · requested/clamped/actual \(number("requestedTargetScrollTop"))/\(number("clampedTargetScrollTop"))/\(number("actualScrollTopAfter")) · row after \(number("rowRectTopAfter"))…\(number("rowRectBottomAfter")) · intersects \(intersects) · max \(number("maximumPossibleScrollTop")) · re-resolved \((attempt["rowReResolved"] as? Bool)==true ? "yes":"no")"
        }.joined(separator:"; ")
        if pinnedActivityScrollAttemptsSummary.isEmpty {pinnedActivityScrollAttemptsSummary="none"}
        let rowResults=result["rows"] as? [[String:Any]] ?? []
        pinnedActivitySequence=rowResults.map { row in
            let status=row["status"] as? String ?? "unknown"
            let reason=row["unknownReason"] as? String
            return "Row \((row["row"] as? NSNumber)?.intValue ?? 0): \(status)\(status == "unknown" ? " (\(reason ?? "unknown_reason"))":"")"
        }.joined(separator:" · ")
        if pinnedActivitySequence.isEmpty {pinnedActivitySequence="none"}
        pinnedActivityDOMCounts=rowResults.enumerated().map { index,row in
            let before=(row["domConversationsBeforeMenu"] as? NSNumber)?.intValue ?? 0
            let after=(row["domConversationsAfterCleanup"] as? NSNumber)?.intValue ?? before
            return "\(index+1): \(before)→\(after)"
        }.joined(separator:", ")
        if pinnedActivityDOMCounts.isEmpty {pinnedActivityDOMCounts="no menu interaction"}
        let jsTimestampStage=result["timestampStage"] as? String ?? "skipped_prefix_incomplete"
        let dispatch=result["timestampDispatch"] as? [String:Any] ?? [:]
        pinnedActivityTimestampDispatchStage="evaluated"
        pinnedActivityTimestampDispatchReason=dispatch["reason"] as? String ?? "none"
        pinnedActivityRecords=result["pinnedRecords"] as? [[String:Any]] ?? []
        pinnedActivityResolved=0;pinnedActivityTimes=[];pinnedActivitySources=[];pinnedActivityOrdinals=[];pinnedActivityExpectedOrdinal=nil
        pinnedActivityTimestampTimeouts=0;pinnedActivityTimestampErrors=0;pinnedActivityTimestampReason="none"
        pinnedActivityStage=result["diagnosticStage"] as? String ?? "prefix_completed"
        let prefixComplete=pinnedActivityPrefix=="pinned_prefix_complete"
        guard prefixComplete else {
            pinnedActivityTimestampExpected=false;pinnedActivityTimestampStage=PinnedTimestampState.skipped.rawValue
            pinnedActivityTimestampDispatchStage="blocked"
            pinnedActivityTimestampDispatchReason=dispatch["reason"] as? String ?? "prefix_incomplete"
            pinnedActivityTimestampReason=pinnedActivityTimestampDispatchReason
            finishPinnedActivityDiagnostic();return
        }
        guard pinnedActivityPinnedCount>0 else {
            pinnedActivityTimestampExpected=false;pinnedActivityTimestampStage=PinnedTimestampState.skipped.rawValue
            pinnedActivityTimestampDispatchStage="blocked";pinnedActivityTimestampDispatchReason="pinned_ids_empty"
            pinnedActivityTimestampReason="pinned_ids_empty";finishPinnedActivityDiagnostic();return
        }
        pinnedActivityLeaseStages.append("activity_started")
        guard recordPinnedActivityLeaseStage("lease_present_before_activity",token:token) else {
            pinnedActivityTimestampExpected=false;pinnedActivityTimestampStage=PinnedTimestampState.error.rawValue
            pinnedActivityTimestampDispatchStage="blocked";pinnedActivityTimestampReason="render_lease_lost_before_activity"
            pinnedActivityLeaseFailureReason="render_lease_lost_before_activity"
            pinnedActivityLeaseStages.append("activity_completed")
            finishPinnedActivityDiagnostic();return
        }
        pinnedActivityTimestampItemStates=Array(repeating:"pending",count:pinnedActivityPinnedCount)
        pinnedActivityTimestampItemsCreated=pinnedActivityTimestampItemStates.count
        pinnedActivityTimestampExpected=true;pinnedActivityTimestampStage=PinnedTimestampState.resolving.rawValue
        pinnedActivityTimestampDispatchStage="items_created"
        recordPinnedActivityTimestampStage("timestamp_items_created",token:token)
        setLastIsolatedDiagnostic(pinnedActivityStatusText())
        guard jsTimestampStage=="started",(dispatch["allowed"] as? Bool) != false else {
            failPinnedTimestampDispatch(dispatch["reason"] as? String ?? "timestamp_dispatch_blocked",token:token);return
        }
        guard pinnedActivityRecords.count==pinnedActivityPinnedCount else {
            failPinnedTimestampDispatch("timestamp_items_mismatch",token:token);return
        }
        guard !cycleRunning else {failPinnedTimestampDispatch("scheduler_running",token:token);return}
        guard pinnedActivityDiagnosticToken==token else {failPinnedTimestampDispatch("timestamp_operation_stale",token:token);return}
        guard pinnedActivityStage != "finished" else {failPinnedTimestampDispatch("diagnostic_already_terminal",token:token);return}
        pinnedActivityTimestampDispatchStage="allowed";pinnedActivityTimestampDispatchReason="none"
        updatePinnedActivityStage("timestamp_dispatch_allowed",token:token,timeoutSeconds:nil)
        schedulePinnedActivityResolver(token:token)
    }
    @objc func diagnoseSidebarRoutes() {
        guard !cycleRunning else {starredDiagnosticOutput.stringValue="Route diagnostic unavailable while a cycle is running.";return}
        guard web.url?.host == "chatgpt.com" else {starredDiagnosticOutput.stringValue="Route diagnostic unavailable · ChatGPT session page is not active.";return}
        pinDiagnosticTimeoutTask?.cancel()
        let runID=UUID();pinDiagnosticRunID=runID
        starredDiagnosticOutput.stringValue="Sidebar route diagnostic v\(pinnedDiagnosticVersion) · reading up to 20 visible links; no clicks."
        pinDiagnosticTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:3_000_000_000)
            guard let self,self.pinDiagnosticRunID==runID else{return}
            self.finishPinDiagnostic("Sidebar route diagnostic v\(self.pinnedDiagnosticVersion) · timed out safely.")
        }
        web.evaluateJavaScript("window.pinnedDiagnosticVersion || null") { [weak self] value,error in
            DispatchQueue.main.async {
                guard let self,self.pinDiagnosticRunID==runID else{return}
                guard error == nil,(value as? String)==self.pinnedDiagnosticVersion else {self.finishPinDiagnostic("Sidebar route diagnostic unavailable · hook version mismatch or missing.");return}
                self.web.evaluateJavaScript("window.gptInspectSidebarRoutes?.() || null") { result,routeError in
                    DispatchQueue.main.async {
                        guard self.pinDiagnosticRunID==runID else{return}
                        guard routeError == nil,let result=result as? [String:Any] else {self.finishPinDiagnostic("Sidebar route diagnostic failed safely.");return}
                        let routes=result["routes"] as? [[String:Any]] ?? []
                        let lines=routes.map { item in
                            let names=(item["dataAttributeNames"] as? [String] ?? []).joined(separator:",")
                            return "Row \(item["row"] as? Int ?? 0): \(item["template"] as? String ?? "/<unknown>") · classifier \(item["kind"] as? String ?? "unknown") · \(item["tag"] as? String ?? "a") / \(item["role"] as? String ?? "link") · data [\(names)] · aria-current \((item["hasAriaCurrent"] as? Bool)==true ? "Yes":"No") · ancestors \(item["ancestorLevels"] as? Int ?? 0) · row control \((item["hasButtonOrMenuControl"] as? Bool)==true ? "Yes":"No")"
                        }.joined(separator:"\n")
                        let count=result["linksInspected"] as? Int ?? 0
                        let first=result["firstConversation"] as? [String:Any] ?? [:]
                        let firstSummary=first.isEmpty ? "First conversation row: not recognized." : "First conversation row: found · \(first["template"] as? String ?? "unknown") · \(first["rowTag"] as? String ?? "?") / \(first["rowRole"] as? String ?? "none") · row data [\((first["rowDataAttributeNames"] as? [String] ?? []).joined(separator:","))] · aria-current \((first["rowHasAriaCurrent"] as? Bool)==true ? "Yes":"No") · control \((first["rowHasButtonOrMenuControl"] as? Bool)==true ? "Yes":"No") · ancestors \(first["ancestorLevels"] as? Int ?? 0)"
                        self.finishPinDiagnostic("Sidebar route diagnostic v\(result["version"] as? String ?? self.pinnedDiagnosticVersion) · links inspected \(count)\nCurrent accepted: /c/<id>, /g/<id>/c/<id>; project: /g/<id>\n\(firstSummary)\n\(lines.isEmpty ? "No visible links found in sidebar.":lines)")
                    }
                }
            }
        }
    }
    func finishPinDiagnostic(_ message:String) {
        pinDiagnosticTimeoutTask?.cancel();pinDiagnosticTimeoutTask=nil;pinDiagnosticRunID=nil;starredDiagnosticOutput.stringValue=message;updateRuntimeIdentity()
    }
    func sidebarDiagnosticElapsedNow()->Int {
        guard let started=sidebarDiagnosticStartedAt else{return sidebarDiagnosticLastElapsedMs}
        return max(sidebarDiagnosticLastElapsedMs,min(45000,Int(Date().timeIntervalSince(started)*1000)))
    }
    func recordSidebarDiagnosticStage(_ payload:[String:Any]) {
        let allowedStages:Set<String>=["operation_started","document_ready","sidebar_lookup_started","sidebar_found","sidebar_not_found","row_scan_started","row_scan_finished","route_template_scan_started","route_template_scan_finished","callback_returned","readiness_started","top_started","prefix_started"]
        guard let stage=payload["stage"] as? String,allowedStages.contains(stage) else{return}
        sidebarDiagnosticLastStage=stage
        if let elapsed=(payload["elapsedMs"] as? NSNumber)?.intValue {sidebarDiagnosticLastElapsedMs=max(0,min(45000,elapsed))}
        let allowedExceptions:Set<String>=["none","Error","TypeError","RangeError","SyntaxError","SecurityError","TimeoutError","javascript_exception","external_timeout"]
        if let exception=payload["exceptionCategory"] as? String,exception != "none",allowedExceptions.contains(exception){sidebarDiagnosticExceptionCategory=exception}
        let exceptionText=sidebarDiagnosticExceptionCategory=="none" ? "":" · exception \(sidebarDiagnosticExceptionCategory)"
        lastSidebarDiagnosticOutput.stringValue="Last sidebar diagnostic: running · stage \(sidebarDiagnosticLastStage) · elapsed \(sidebarDiagnosticElapsedNow()) ms\(exceptionText)"
    }
    func storeSidebarDiagnosticSummary(_ summary:SidebarDiagnosticSummary) {
        lastSidebarDiagnosticSummary=summary
        lastSidebarDiagnosticOutput.stringValue=summary.displayText
        updateCurrentCycleSummary()
    }
    func storeSidebarDiagnosticFailure(_ reason:String) {
        storeSidebarDiagnosticSummary(.make(result:"failure",detectedRowCount:0,pinnedRowCandidateCount:0,recognizedRouteTemplateCount:0,sidebarPresent:nil,navPresent:nil,asidePresent:nil,scrollContainerCount:0,reason:reason,stage:sidebarDiagnosticLastStage,elapsedMs:sidebarDiagnosticElapsedNow(),exceptionCategory:reason=="hard_timeout" ? "TimeoutError":sidebarDiagnosticExceptionCategory))
    }
    func storeSidebarDiagnosticResult(_ result:[String:Any]) {
        let raw=result["sidebarDiagnosticSummary"] as? [String:Any] ?? [:]
        let number:([String:Any],String)->Int={ object,key in (object[key] as? NSNumber)?.intValue ?? 0 }
        let flag:([String:Any],String)->Bool?={ object,key in object[key] as? Bool }
        let summary=SidebarDiagnosticSummary.make(result:raw["result"] as? String ?? "failure",
            detectedRowCount:number(raw,"detectedRowCount"),pinnedRowCandidateCount:number(raw,"pinnedRowCandidateCount"),
            recognizedRouteTemplateCount:number(raw,"recognizedRouteTemplateCount"),sidebarPresent:flag(raw,"sidebarPresent"),
            navPresent:flag(raw,"navPresent"),asidePresent:flag(raw,"asidePresent"),scrollContainerCount:number(raw,"scrollContainerCount"),
            reason:raw["reason"] as? String ?? result["stopReason"] as? String ?? "result_summary_missing",stage:sidebarDiagnosticLastStage,elapsedMs:sidebarDiagnosticElapsedNow(),exceptionCategory:raw["exceptionCategory"] as? String ?? sidebarDiagnosticExceptionCategory)
        storeSidebarDiagnosticSummary(summary)
    }
    func finishSidebarDiagnosticFailure(_ reason:String,_ message:String) {
        storeSidebarDiagnosticFailure(reason)
        finishIsolatedDiagnostic(message)
    }
    func setLastIsolatedDiagnostic(_ message:String) {
        latestIsolatedDiagnosticText=message
        lastIsolatedDiagnosticOutput.stringValue=message
        updateRuntimeIdentity()
    }
    func finishIsolatedDiagnostic(_ message:String) {
        if sidebarScrollReadinessPollCount>0,let token=pinDiagnosticRunID?.uuidString {web.evaluateJavaScript("window.gptClearSidebarScrollReadiness?.('\(token)')",completionHandler:nil)}
        pinDiagnosticTimeoutTask?.cancel();pinDiagnosticTimeoutTask=nil;sidebarScrollReadinessTimeoutTask?.cancel();sidebarScrollReadinessTimeoutTask=nil;pinDiagnosticRunID=nil
        setLastIsolatedDiagnostic(message)
        updateRuntimeIdentity()
    }
    func recordSidebarScrollDiagnosticStage(_ stage:String,partial:String) {
        sidebarScrollDiagnosticLastStage=stage
        sidebarScrollDiagnosticPartial=partial
        let elapsed=sidebarScrollDiagnosticStartedAt.map{Int(Date().timeIntervalSince($0)*1000)} ?? 0
        sidebarScrollDiagnosticStageEvents.append("\(stage)=\(elapsed)ms")
        if sidebarScrollDiagnosticStageEvents.count>24 {sidebarScrollDiagnosticStageEvents.removeFirst(sidebarScrollDiagnosticStageEvents.count-24)}
    }
    func finishPinDiagnosticTimeout() {
        let rows=pinDiagnosticRows.keys.sorted().map { "Row \($0): \(pinDiagnosticRows[$0] ?? "unknown")" }.joined(separator:"\n")
        let timeoutRow=pinDiagnosticCurrentRow.map(String.init) ?? "unknown"
        let menu=pinDiagnosticMenuLeftOpen.map{$0 ? "Yes":"No"} ?? "Unknown"
        finishPinDiagnostic("Pin-status diagnostic v\(pinnedDiagnosticVersion) · timed out at 10 s\nRows attempted: \(pinDiagnosticRowsAttempted) · completed: \(pinDiagnosticRowsCompleted) · timeout row: \(timeoutRow) · menu left open: \(menu)\n\(rows.isEmpty ? "No completed rows; current row is unknown.":rows)")
    }
    func displayStarredDiagnostic(_ payload:[String:Any]) {
        if payload["sidebarScrollMechanicsStage"] != nil,let token=payload["operationToken"] as? String,token==pinDiagnosticRunID?.uuidString {
            let stage=payload["sidebarScrollMechanicsStage"] as? String ?? "unknown_stage"
            let partial=payload["partial"] as? [String:Any] ?? [:]
            let ancestors=(partial["ancestorCount"] as? NSNumber)?.intValue ?? 0
            let candidates=(partial["candidateCount"] as? NSNumber)?.intValue ?? 0
            let probe=(partial["probeAttempted"] as? Bool)==true
            let poll=partial["pollCount"] as? NSNumber
            let rows=(partial["finalCount"] as? NSNumber)?.intValue ?? (partial["rowsSeen"] as? NSNumber)?.intValue ?? 0
            let identities=(partial["identityCount"] as? NSNumber)?.intValue ?? 0
            let rootPresent=(partial["sidebarRootPresent"] as? Bool)==true
            let context=partial["context"] as? String ?? "unknown"
            let geometryKeys=["rootChain","rowChain","candidateSummaries"]
            let geometry=geometryKeys.compactMap { key -> String? in
                guard let values=partial[key] as? [[String:Any]],!values.isEmpty else{return nil}
                let rows=values.prefix(8).map { item in
                    let rect=item["rect"] as? [String:Any] ?? [:]
                    return "\(item["tag"] as? String ?? "?") client/scroll \((item["clientHeight"] as? NSNumber)?.intValue ?? 0)/\((item["scrollHeight"] as? NSNumber)?.intValue ?? 0) top \((item["scrollTop"] as? NSNumber)?.intValue ?? 0) rect \((rect["x"] as? NSNumber)?.intValue ?? 0),\((rect["y"] as? NSNumber)?.intValue ?? 0) \((rect["width"] as? NSNumber)?.intValue ?? 0)x\((rect["height"] as? NSNumber)?.intValue ?? 0)"
                }.joined(separator:"; ")
                return "\(key) [\(rows)]"
            }.joined(separator:" · ")
            let summary="poll \(poll?.intValue ?? 0), rows \(rows), identities \(identities), sidebar root \(rootPresent ? "yes":"no"), context \(context), ancestors \(ancestors), candidates \(candidates), probe \(probe ? "yes":"no")\(geometry.isEmpty ? "":" · \(geometry)")"
            recordSidebarScrollDiagnosticStage(stage,partial:summary)
            if stage=="readiness_completed" {sidebarScrollReadinessTimeoutTask?.cancel();sidebarScrollReadinessTimeoutTask=nil}
            return
        }
        if let result=payload["sidebarScrollMechanicsResult"] as? [String:Any],let token=payload["operationToken"] as? String,token==pinDiagnosticRunID?.uuidString {
            pinDiagnosticTimeoutTask?.cancel();pinDiagnosticTimeoutTask=nil
            recordSidebarScrollDiagnosticStage("native_result_received",partial:"status \(result["status"] as? String ?? "unknown"), ancestors \((result["ancestorCount"] as? NSNumber)?.intValue ?? 0), candidates \((result["candidateCount"] as? NSNumber)?.intValue ?? 0), probe \(((result["movement"] as? [String:Any])?["attempted"] as? Bool)==true ? "yes":"no")")
            func n(_ value:Any?)->String {(value as? NSNumber).map{String($0.intValue)} ?? "0"}
            func yes(_ value:Any?)->String {(value as? Bool)==true ? "Yes":"No"}
            func chain(_ value:Any?)->String {(value as? [[String:Any]] ?? []).enumerated().map { index,item in
                let rect=item["rect"] as? [String:Any] ?? [:]
                return "L\(index) \(item["tag"] as? String ?? "?") · client/scroll \(n(item["clientHeight"]))/\(n(item["scrollHeight"])) · top \(n(item["scrollTop"]) ) · rect \(n(rect["x"])),\(n(rect["y"])) \(n(rect["width"]))×\(n(rect["height"])) · overflowY \(item["overflowY"] as? String ?? "?") · pos \(item["position"] as? String ?? "?") · transform \(item["transform"] as? String ?? "?") (\(n(item["translateX"])),\(n(item["translateY"])) ) · contain \(item["contain"] as? String ?? "?") · connected \(yes(item["connected"]))"
            }.joined(separator:"\n")}
            let candidates=(result["candidates"] as? [[String:Any]] ?? []).map { item in
                "\(item["kind"] as? String ?? "element") \(item["tag"] as? String ?? "?") · \(n(item["scrollTop"]) ) / \(n(item["clientHeight"]))/\(n(item["scrollHeight"])) · overflowY \(item["overflowY"] as? String ?? "?") · withinRoot \(yes(item["withinRoot"])) · containsRoot \(yes(item["containsRoot"])) · containsRow \(yes(item["containsRow"]))"
            }.joined(separator:"\n")
            let move=result["movement"] as? [String:Any] ?? [:]
            let jsTimingEvents=result["stageTimings"] as? [[String:Any]] ?? []
            let pollEvents=jsTimingEvents.filter { ($0["stage"] as? String)=="readiness_dom_poll" || ($0["stage"] as? String)=="readiness_first_dom_sample" }
            let pollSummary=pollEvents.isEmpty ? "" : "readiness samples ×\(pollEvents.count) (\(n(pollEvents.first?["elapsedMs"]))…\(n(pollEvents.last?["elapsedMs"]))ms)"
            let jsStages=(jsTimingEvents.filter { ($0["stage"] as? String) != "readiness_dom_poll" && ($0["stage"] as? String) != "readiness_first_dom_sample" }.map { "\($0["stage"] as? String ?? "?")=\(n($0["elapsedMs"]))ms" } + (pollSummary.isEmpty ? []:[pollSummary])).joined(separator:" → ")
            let nativeStages=sidebarScrollDiagnosticStageEvents.suffix(12).joined(separator:" → ")
            let pollTelemetry=result["nativePollTelemetry"] as? [String:Any] ?? [:]
            let pollTimeline=(pollTelemetry["timeline"] as? [String] ?? []).joined(separator:"\n")
            let lifecycleText="Native polls scheduled/started/evaluate/callback/parsed \(n(pollTelemetry["scheduledCount"])) / \(n(pollTelemetry["startedCount"])) / \(n(pollTelemetry["evaluateCalledCount"])) / \(n(pollTelemetry["callbackCount"])) / \(n(pollTelemetry["parsedCount"])) · in flight \(yes(pollTelemetry["inFlight"])) · last completed \(n(pollTelemetry["lastCompletedPollIndex"])) · max callback latency \(n(pollTelemetry["maxCallbackLatencyMs"]))ms · max event gap \(n(pollTelemetry["maxEventGapMs"]))ms (\(pollTelemetry["maxEventGapFrom"] as? String ?? "none") → \(pollTelemetry["maxEventGapTo"] as? String ?? "none") )\n\(pollTimeline.isEmpty ? "No native poll timeline.":pollTimeline)"
            let readinessSamples=(result["nativeReadinessSamples"] as? [[String:Any]] ?? []).map { item in
                "#\(n(item["poll"])) @\(n(item["elapsedMs"]))ms rows/ids \(n(item["rowCount"])) / \(n(item["identityCount"])) · set \(item["identitySetFingerprint"] as? String ?? "?") · order \(item["identityOrderFingerprint"] as? String ?? "?") · root \(yes(item["rootPresent"])) · \(item["comparison"] as? String ?? "unknown") · stable \(n(item["stablePolls"]) )"
            }.joined(separator:"\n")
            let readinessText="Readiness: \(result["readiness"] as? String ?? "unknown") · reason \(result["readinessReason"] as? String ?? "unknown") · configured 4000ms · actual \(n(result["readinessDurationMs"]))ms · native polls \(n(result["pollCount"])) · first/last sample \(result["firstPollTimestampMs"].map{n($0)} ?? "unknown")/\(result["lastPollTimestampMs"].map{n($0)} ?? "unknown")ms · guard fired \(yes(result["nativeGuardFired"])) · root \(yes(result["sidebarRootPresent"])) · first rows \(n(result["firstPositiveCount"])) · final rows/identities \(n(result["finalCount"])) / \(n(result["identityCount"])) · context \(result["context"] as? String ?? "unknown")\n\(lifecycleText)\nReadiness phases: A \(n(result["phaseABudgetMs"]))ms · grace \(n(result["stabilizationGraceMs"]))ms · absolute cap \(n(result["absoluteReadinessCapMs"]))ms · extension \(yes(result["extensionActivated"])) · first positive \(result["firstPositiveTimestampMs"].map{n($0)} ?? "none")ms · last semantic change \(result["lastSemanticChangeTimestampMs"].map{n($0)} ?? "none")ms\nStable criterion: \(n(result["requiredStableSamples"])) samples and \(n(result["requiredStableDurationMs"]))ms unchanged · reached \(n(result["stablePolls"]) ) / elapsed \(n(result["stableElapsedMs"]))ms · count \(yes(result["stableCountCondition"])) · duration \(yes(result["stableDurationCondition"])) · accepted \(yes(result["stableSnapshotAccepted"]))\nSamples:\n\(readinessSamples.isEmpty ? "none":readinessSamples)\n"
            let message="Last isolated diagnostic: v\(pinnedDiagnosticVersion) · terminal \(result["terminalStatus"] as? String ?? result["status"] as? String ?? "unknown") · last stage \(result["lastCompletedStage"] as? String ?? "unknown") · native receive \(sidebarScrollDiagnosticStartedAt.map{Int(Date().timeIntervalSince($0)*1000)} ?? 0)ms · stages \(jsStages.isEmpty ? "none":jsStages)\n\(readinessText)Sidebar scroll mechanism \(result["status"] as? String ?? "unknown") · route unchanged \(yes(result["routeUnchanged"])) · rows \(n(result["rowCount"])) · unique identities \(n(result["uniqueIdentityCount"])) · virtualized transform evidence \(yes(result["virtualizedTransformEvidence"]))\nCandidates: \(n(result["candidateCount"]))\n\(candidates.isEmpty ? "none":candidates)\nProbe: \(yes(move["attempted"])) · \(move["candidateType"] as? String ?? "none") · reason \(move["reason"] as? String ?? "unknown") · scrollTop \(n(move["beforeScrollTop"]) ) → \(n(move["afterScrollTop"])) (Δ\(n(move["delta"])) ) · windowY \(n(move["windowYBefore"])) → \(n(move["windowYAfter"])) · documentTop \(n(move["documentTopBefore"])) → \(n(move["documentTopAfter"])) · rows \(n(move["rowCountBefore"])) → \(n(move["rowCountAfter"])) · new identities \(n(move["newIdentityCount"])) · geometry changed \(yes(move["geometryChanged"])) · row element replaced \(yes(move["rowElementReplaced"])) · restored \(yes(move["restored"]))\nRoot ancestors:\n\(chain(result["rootChain"]))\nRow ancestors:\n\(chain(result["rowChain"]))\nVirtualized row replacement observed \(yes(result["virtualizedRowReplacementObserved"])) · elapsed \(n(result["elapsedMs"])) ms · native stages \(nativeStages)"
            pinDiagnosticRunID=nil;setLastIsolatedDiagnostic(message);updateRuntimeIdentity();return
        }
        if payload["sidebarScrollMechanicsError"] != nil,let token=payload["operationToken"] as? String,token==pinDiagnosticRunID?.uuidString {recordSidebarScrollDiagnosticStage("native_js_rejected",partial:sidebarScrollDiagnosticPartial);finishIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · probe_failed · stage \(sidebarScrollDiagnosticLastStage) · \(sidebarScrollDiagnosticPartial)");return}
        if let result=payload["rootSidebarScrollResult"] as? [String:Any],result["operationToken"] as? String==pinDiagnosticRunID?.uuidString {
            pinDiagnosticTimeoutTask?.cancel();pinDiagnosticTimeoutTask=nil
            func n(_ value:Any?)->String {(value as? NSNumber).map{String($0.intValue)} ?? "0"}
            func yes(_ value:Any?)->String {(value as? Bool)==true ? "Yes":"No"}
            let samples=(result["steps"] as? [[String:Any]] ?? []).map { step in
                "#\(n(step["step"])) rows \(n(step["renderedRows"])) · visible \(n(step["visibleRows"])) · unique seen \(n(step["uniqueIdentitiesSeen"])) · new \(n(step["newIdentities"])) · missing from DOM \(n(step["previousIdentitiesMissingFromDOM"])) · scroll \(n(step["scrollTop"])) / range \(n(step["scrollRangePx"])) (\(n(step["clientHeight"]) + "/" + n(step["scrollHeight"]))) · bottom \(yes(step["atBottom"]) ) · busy \(n(step["loadingIndicators"]))"
            }.joined(separator:"\n")
            let message="Last isolated diagnostic: v\(pinnedDiagnosticVersion) · root sidebar traversal \(result["status"] as? String ?? "unknown") · scroll owner \(yes(result["scrollOwnerFound"])) \(result["scrollOwnerTag"] as? String ?? "unknown") overflowY \(result["scrollOwnerOverflowY"] as? String ?? "unknown")\nRows initially \(n(result["initialRenderedRows"])) · unique identities initially \(n(result["initialUniqueIdentities"])) · virtualized \(yes(result["virtualized"])) · lazy loading observed \(yes(result["lazyLoadingObserved"])) · loading indicator seen \(yes(result["loadingIndicatorEverSeen"]))\nBounded bottom candidate \(yes(result["boundedEndCandidate"])) · end-of-list proof \(result["endOfListProof"] as? String ?? "unavailable") · root universe complete \(yes(result["rootUniverseComplete"]))\nScroll restored \(yes(result["scrollRestoreSuccessful"])) · proof gap: \(result["proofGap"] as? String ?? "unknown")\n\(samples.isEmpty ? "No scroll samples.":samples)"
            pinDiagnosticRunID=nil;setLastIsolatedDiagnostic(message);updateRuntimeIdentity();return
        }
        if let token=payload["rootSidebarScrollError"] as? String,token==pinDiagnosticRunID?.uuidString {
            finishIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · root sidebar scroll diagnostic failed safely.");return
        }
        if let result=payload["sidebarTopPositionResult"] as? [String:Any] {
            pinDiagnosticTimeoutTask?.cancel();pinDiagnosticTimeoutTask=nil;pinDiagnosticRunID=nil
            func n(_ x:Any?)->String {(x as? NSNumber).map{String($0.intValue)} ?? "0"}
            func yes(_ x:Any?)->String {(x as? Bool)==true ? "Yes":"No"}
            let first=result["firstRow"] as? [String:Any] ?? [:],rect=first["rect"] as? [String:Any] ?? [:]
            let initial=result["initial"] as? [String:Any] ?? [:],ancestry=(result["scrollAncestry"] as? [[String:Any]] ?? []).map { item in
                "L\(n(item["level"])) \(item["tag"] as? String ?? "?"): client \(n(item["clientHeight"]) ), scroll \(n(item["scrollHeight"]) ), top \(n(item["scrollTop"]) ), overflowY \(item["overflowY"] as? String ?? "?"), rectH \(n(item["rectHeight"]) ), canScroll \(yes(item["canScroll"]))"
            }.joined(separator:"\n")
            let virt=result["virtualization"] as? [String:Any] ?? [:]
            let readiness=result["readiness"] as? [String:Any] ?? [:]
            let message="Last isolated diagnostic: v\(result["version"] as? String ?? pinnedDiagnosticVersion) · \(result["status"] as? String ?? "top_unproven") · reason \(result["reason"] as? String ?? "unknown")\nReadiness: \(readiness["status"] as? String ?? "unknown") · waited \(n(readiness["waitDurationMs"]) ) ms · rows first \(n(readiness["rowsAtFirstDetection"])) → stable \(n(readiness["rowsAtStabilizedSnapshot"]))\nConversation links: total \(n(result["totalConversationLinks"])) · visible \(n(result["visibleConversationLinks"])) · first visible index \(n(result["firstVisibleIndex"])) · DOM before \(n(result["domConversationRowsBefore"])) · hidden/offscreen before \(n(result["hiddenOrOffscreenRowsBefore"]))\nFirst row rect \(n(rect["x"])),\(n(rect["y"])) \(n(rect["width"]))×\(n(rect["height"])) · scroll ancestor \(yes(result["scrollAncestorFound"])) · scrollTop \(n(result["scrollTopBefore"])) → \(n(result["scrollTopAfter"]))\nInitial index \(n(initial["index"])) · initial rows before \(n(initial["rowsAbove"]))\nScroll ancestry (max 8):\n\(ancestry.isEmpty ? "none":ancestry)\nVirtualization: transform \(yes(virt["transformPresent"])) · transform offset \(yes(virt["transformOffset"])) · spacer before \(yes(virt["spacerBefore"])) · spacer present \(yes(virt["spacerPresent"])) · large virtual height \(yes(virt["largeVirtualHeight"])) · row index > 0 \(yes(virt["positiveRowIndex"])) · detected \(yes(virt["detected"])) · menu clicks \(n(result["menuClicks"]))"
            finishIsolatedDiagnostic(message);return
        }
        if payload["sidebarTopPositionError"] != nil {finishIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · top_unproven · reason diagnostic_error.");return}
        if let result=payload["sidebarElementStructureResult"] as? [String:Any],let token=payload["sidebarStructureDiagnosticRunID"] as? String,token==pinDiagnosticRunID?.uuidString {
            pinDiagnosticTimeoutTask?.cancel();pinDiagnosticTimeoutTask=nil;pinDiagnosticRunID=nil
            sidebarElementStructureOutput.stringValue=renderSidebarElementStructure(result)
            updateRuntimeIdentity();return
        }
        if payload["sidebarElementStructureError"] != nil,let token=payload["sidebarStructureDiagnosticRunID"] as? String,token==pinDiagnosticRunID?.uuidString {
            pinDiagnosticTimeoutTask?.cancel();pinDiagnosticTimeoutTask=nil;pinDiagnosticRunID=nil
            sidebarElementStructureOutput.stringValue="Last sidebar element structure: failure · sanitized_exception"
            updateRuntimeIdentity();return
        }
        if let stage=payload["visiblePinnedRowsStage"] as? [String:Any],let token=payload["sidebarDiagnosticRunID"] as? String,token==pinDiagnosticRunID?.uuidString {recordSidebarDiagnosticStage(stage);return}
            if let result=payload["visiblePinnedRowsResult"] as? [String:Any],let token=payload["sidebarDiagnosticRunID"] as? String,token==pinDiagnosticRunID?.uuidString {
            sidebarDiagnosticLastStage="callback_returned";sidebarDiagnosticLastElapsedMs=sidebarDiagnosticElapsedNow()
            if let exception=(result["sidebarDiagnosticSummary"] as? [String:Any])?["exceptionCategory"] as? String {sidebarDiagnosticExceptionCategory=exception}
            storeSidebarDiagnosticResult(result)
            pinDiagnosticTimeoutTask?.cancel();pinDiagnosticTimeoutTask=nil;pinDiagnosticRunID=nil
            func yes(_ value:Any?)->String {(value as? Bool)==true ? "Yes":"No"}
            func count(_ value:Any?)->String {(value as? NSNumber).map{String($0.intValue)} ?? "0"}
            let rows=(result["rows"] as? [[String:Any]] ?? []).map { row in
                let status=row["status"] as? String ?? "unknown"
                let detail=status == "unknown" ? " · reason \(row["unknownReason"] as? String ?? "unknown_reason") · trigger \(yes(row["triggerPresent"])) · menu items \(count(row["menuItemCount"])) · Pin/Unpin \(yes(row["hasPinAction"])) / \(yes(row["hasUnpinAction"])) · row connected \(yes(row["rowStillConnected"]))":""
                let attempts=(row["cleanupAttempts"] as? [[String:Any]] ?? []).map { attempt in
                    "\(attempt["method"] as? String ?? "unknown")#\(count(attempt["retry"])) \(yes(attempt["menuVisibleBefore"]))→\(yes(attempt["menuVisibleAfter"])) \(count(attempt["elapsedMs"]))ms trigger \(yes(attempt["triggerConnected"])) replaced \(yes(attempt["triggerReplaced"])) reason \(attempt["terminalReason"] as? String ?? "unknown")"
                }.joined(separator:"; ")
                let cleanup=attempts.isEmpty ? "none":attempts
                return "Row \(count(row["row"])): \(status)\(detail) · menu opened \(yes(row["menuOpened"])) / closed \(yes(row["menuClosed"])) · cleanup [\(cleanup)] · terminal \(row["cleanupTerminalReason"] as? String ?? "none") · DOM conversations \(count(row["domConversationsBeforeMenu"]) ) → \(count(row["domConversationsAfterCleanup"]))"
            }.joined(separator:"\n")
            let top=result["sidebarTop"] as? [String:Any] ?? [:]
            let readiness=result["readiness"] as? [String:Any] ?? [:]
            let scrollPosition=result["scrollPosition"] as? [String:Any] ?? [:]
            let firstNotPinned=(result["firstNotPinnedFound"] as? Bool)==true
            let scrollText="owner \(yes(result["scrollContainerFound"])) · candidates \(count(result["scrollOwnerCandidateCount"])) · reason \(result["scrollOwnerReason"] as? String ?? "unknown") · scrollTop initial \(scrollPosition["initial"].map{count($0)} ?? "n/a") / maximum reached \(scrollPosition["maximumReached"].map{count($0)} ?? "n/a") (capacity \(scrollPosition["maximumCapacity"].map{count($0)} ?? "n/a")) / restored \(scrollPosition["restored"].map{count($0)} ?? "n/a") · restore \(yes(result["scrollRestoreSuccessful"]))"
            let message="Last isolated diagnostic: v\(result["version"] as? String ?? pinnedDiagnosticVersion)\nReadiness: \(readiness["status"] as? String ?? "unknown") · waited \(count(readiness["waitDurationMs"]) ) ms · rows first \(count(readiness["rowsAtFirstDetection"])) → stable \(count(readiness["rowsAtStabilizedSnapshot"]))\nReadiness telemetry: firstPositiveCount \(count(readiness["firstPositiveCount"])) · stableCount \(count(readiness["stableCount"])) · finalSnapshotCount \(count(readiness["finalSnapshotCount"])) · timeToFirstPositive \(readiness["timeToFirstPositiveMs"].map{count($0)} ?? "Unknown") ms · timeToStable \(readiness["timeToStableMs"].map{count($0)} ?? "Unknown") ms · terminalReason \(readiness["terminalReason"] as? String ?? "unknown")\nPrefix snapshot: \(count(result["prefixSnapshotCount"])) · conversation links at start: total \(count(result["totalConversationLinksAtPrefixStart"])) / visible \(count(result["visibleConversationLinksAtPrefixStart"]))\nTop: \(top["proof"] as? String ?? "unproven") · Reason: \(top["reason"] as? String ?? "unknown") · rows inspected \(count(result["rowsInspected"]))\n\(rows.isEmpty ? "No rows inspected.":rows)\nPinned prefix: \(result["pinnedPrefixStatus"] as? String ?? "pinned_prefix_unproven") · pinned count \(count(result["pinnedCount"])) · unknown \(count(result["unknownCount"])) · first not pinned found \(firstNotPinned ? "Yes":"No")\nTimestamp stage: skipped intentionally\nCleanup: \(yes(result["cleanupSuccessful"])) · reason \(result["stopReason"] as? String ?? "unknown")"
            setLastIsolatedDiagnostic(message.replacingOccurrences(of:"\nTop:",with:"\nScroll: \(scrollText)\nTop:"))
            return
        }
        if payload["visiblePinnedRowsError"] != nil,let token=payload["sidebarDiagnosticRunID"] as? String,token==pinDiagnosticRunID?.uuidString {sidebarDiagnosticExceptionCategory="javascript_exception";finishSidebarDiagnosticFailure("javascript_operation_failed","Last isolated diagnostic: v\(pinnedDiagnosticVersion) · failed safely · result contained no row data.");return}
        if let result=payload["firstRowStructureResult"] as? [String:Any] {
            pinDiagnosticTimeoutTask?.cancel();pinDiagnosticTimeoutTask=nil;pinDiagnosticRunID=nil
            func yes(_ value:Any?) -> String {(value as? Bool)==true ? "Yes":"No"}
            func count(_ value:Any?) -> String {(value as? NSNumber).map{String($0.intValue)} ?? "0"}
            func rectText(_ value:Any?) -> String {
                let rect=value as? [String:Int] ?? [:]
                return "x \(rect["x"] ?? 0), y \(rect["y"] ?? 0), \(rect["width"] ?? 0)×\(rect["height"] ?? 0)"
            }
            func styleText(_ value:Any?) -> String {
                let style=value as? [String:String] ?? [:]
                return "display \(style["display"] ?? "?") · visibility \(style["visibility"] ?? "?") · opacity \(style["opacity"] ?? "?") · pointer-events \(style["pointerEvents"] ?? "?")"
            }
            let chain=(result["ancestorChain"] as? [[String:Any]] ?? []).map { item in
                "L\(count(item["level"])) \(item["tag"] as? String ?? "?") / \(item["role"] as? String ?? "none") · data [\((item["dataAttributeNames"] as? [String] ?? []).joined(separator:", "))] · children \(count(item["childCount"]) ) · descendant buttons \(count(item["descendantButtons"])) · sibling buttons \(count(item["siblingButtons"])) · rect \(rectText(item["rect"])) · \(styleText(item["style"]))"
            }.joined(separator:"\n")
            let candidates=(result["rowCandidates"] as? [[String:Any]] ?? []).enumerated().map { index,item in
                "Candidate \(index+1) (L\(count(item["level"]))): \(item["tag"] as? String ?? "?") / \(item["role"] as? String ?? "none") · child \(count(item["childCount"]) ), descendant buttons \(count(item["descendantButtons"])) · sibling buttons \(count(item["siblingButtons"])) · controls \(count(item["controlCount"])) + sibling controls \(count(item["siblingControlCount"])) · rect \(rectText(item["rect"])) · row-height \(count(item["rowRelativeHeightPercent"]) )%"
            }.joined(separator:"\n")
            func controls(_ key:String)->String {
                (result[key] as? [[String:Any]] ?? []).prefix(24).enumerated().map { index,item in
                    "\(index+1). \(item["source"] as? String ?? "?") · \(item["tag"] as? String ?? "?") / \(item["role"] as? String ?? "none") · label class \(item["labelClass"] as? String ?? "other") · clickable \(yes(item["clickableSemantics"])) · aria-haspopup \(item["ariaHaspopup"] as? String ?? "absent") · data [\((item["dataAttributeNames"] as? [String] ?? []).joined(separator:", "))] · radix [\((item["radixAttributeNames"] as? [String] ?? []).joined(separator:", "))] · data-state \(yes(item["hasDataState"])) · popover \(yes(item["hasPopover"])) · SVG \(yes(item["svgPresent"])) · icon-only \(yes(item["iconOnly"])) · \(styleText(item["style"])) · \(rectText(item["rect"])) · relative \(item["relativeSide"] as? String ?? "?") · overlaps row \(yes(item["overlapsRow"]))"
                }.joined(separator:"\n")
            }
            let changes=(result["hoverChanges"] as? [[String:Any]] ?? []).map { item in
                let before=item["before"] as? [String:Any] ?? [:],after=item["after"] as? [String:Any] ?? [:]
                return "\(before["source"] as? String ?? "control") \(before["tag"] as? String ?? "?")/\(before["role"] as? String ?? "none"): style changed \(yes(item["styleChanged"])) · geometry changed \(yes(item["geometryChanged"])) · before opacity \((before["style"] as? [String:String])?["opacity"] ?? "?") / pointer-events \((before["style"] as? [String:String])?["pointerEvents"] ?? "?") · after opacity \((after["style"] as? [String:String])?["opacity"] ?? "?") / pointer-events \((after["style"] as? [String:String])?["pointerEvents"] ?? "?")"
            }.joined(separator:"\n")
            setLastIsolatedDiagnostic("Last isolated diagnostic: v\(result["version"] as? String ?? pinnedDiagnosticVersion) · link found \(yes(result["linkFound"])) · most likely row candidate L\(count(result["selectedRowLevel"])) · clicks \(count(result["clicksPerformed"]) )\nAncestor chain (max 6):\n\(chain.isEmpty ? "none":chain)\nRow candidates (max 3):\n\(candidates.isEmpty ? "none":candidates)\nControls before hover:\n\(controls("controlsBeforeHover").isEmpty ? "none":controls("controlsBeforeHover"))\nControls after hover:\n\(controls("controlsAfterHover").isEmpty ? "none":controls("controlsAfterHover"))\nNew DOM controls: \(count(result["newDomControlCount"])) · changed controls:\n\(changes.isEmpty ? "none":changes)\nReason: \(result["reason"] as? String ?? "unknown") · elapsed \(count(result["elapsedMs"])) ms")
            return
        }
        if payload["firstRowStructureError"] != nil {
            finishIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · structural diagnostic failed safely.")
            return
        }
        if let result=payload["firstRowMenuResult"] as? [String:Any] {
            pinDiagnosticTimeoutTask?.cancel();pinDiagnosticTimeoutTask=nil;pinDiagnosticRunID=nil
            func yes(_ value:Any?) -> String {(value as? Bool)==true ? "Yes":"No"}
            func count(_ value:Any?) -> String {(value as? NSNumber).map{String($0.intValue)} ?? "0"}
            let menu=result["menu"] as? [String:Any] ?? [:]
            let container=result["rowContainer"] as? [String:Any] ?? [:],trigger=result["trigger"] as? [String:Any] ?? [:]
            func triggerState(_ value:Any?) -> String {
                let state=value as? [String:Any] ?? [:]
                return "expanded \(state["ariaExpanded"] as? String ?? "?") · data-state \(state["dataState"] as? String ?? "?") · controls \(yes(state["ariaControlsPresent"])) · focused \(yes(state["focused"])) · disabled \(yes(state["disabled"]))"
            }
            func countSummary(_ value:Any?) -> String {
                let counts=value as? [String:Any] ?? [:]
                return "menus \(count(counts["menus"])) · items \(count(counts["menuItems"])) · popovers \(count(counts["visiblePopoverLike"])) · structural \(count(counts["visibleStructuralPopups"]))"
            }
            let mutations=result["mutations"] as? [String:Any] ?? [:]
            let rect=container["rect"] as? [String:Int] ?? [:]
            let levels=(result["ancestorSummary"] as? [[String:Any]] ?? []).map { item in
                "L\(count(item["level"])) links \(count(item["conversationLinks"]) ) · menus \(count(item["menuButtons"])) · rect \((item["rect"] as? [String:Int])?["width"] ?? 0)×\((item["rect"] as? [String:Int])?["height"] ?? 0) · sidebar-sized \(yes(item["sidebarSized"]))"
            }.joined(separator:"; ")
            let message="Last isolated diagnostic: v\(result["version"] as? String ?? pinnedDiagnosticVersion) · row found \(yes(result["rowFound"])) · ancestors checked \(count(result["ancestorLevelsChecked"]))\nAncestors: \(levels.isEmpty ? "none":levels)\nContainer links \(count(container["conversationLinks"])) / menu buttons \(count(container["menuButtons"])) · rect \(rect["width"] ?? 0)×\(rect["height"] ?? 0)\nTrigger \(yes(result["triggerFound"])) · candidates \(count(result["triggerCount"])) · \(trigger["tag"] as? String ?? "none") · aria-haspopup \(trigger["ariaHaspopup"] as? String ?? "none") · \(count(trigger["width"]))×\(count(trigger["height"])) · inside/near row \(yes(trigger["insideRow"])) / \(yes(trigger["nearRow"]))\nBefore: \(triggerState(result["triggerStateBefore"]) ) · counts [\(countSummary(result["baselineCounts"]))]\nAfter pointerdown: \(triggerState(result["triggerStateAfterPointerdown"])) · counts [\(countSummary(result["afterPointerdownCounts"]))]\nAfter sequence: \(triggerState(result["triggerStateAfterSequence"])) · counts [\(countSummary(result["afterSequenceCounts"]))]\nMutations: observer installed \(yes(mutations["observerInstalled"])) · menu-like nodes \(count(mutations["menuLikeNodesAdded"])) · relevant attribute changes \(count(mutations["menuLikeAttributesChanged"]))\nEvent sequence delivered \(yes(result["clickDelivered"])) · menu opened \(yes(result["menuOpened"])) · container \(result["menuLocation"] as? String ?? "none") · actions \(count(menu["actionCount"])) · Pin \(yes(menu["pinActionPresent"])) · Unpin \(yes(menu["unpinActionPresent"])) · other \(count(menu["otherActionsCount"]))\nRow status: \(result["rowStatus"] as? String ?? "unknown") · menu closed \(yes(result["menuClosed"])) · menu left open \(yes(result["menuLeftOpen"])) · cleanup successful \(yes(result["cleanupSuccessful"])) · reason \(result["reason"] as? String ?? "unknown")"
            setLastIsolatedDiagnostic(message)
            return
        }
        if payload["firstRowMenuError"] != nil {
            finishIsolatedDiagnostic("Last isolated diagnostic: v\(pinnedDiagnosticVersion) · failed safely · diagnostic command rejected.")
            return
        }
        if let progress=payload["topChatPinProgress"] as? [String:Any] {
            guard pinDiagnosticRunID != nil else{return}
            pinDiagnosticRowsAttempted=(progress["rowsAttempted"] as? NSNumber)?.intValue ?? pinDiagnosticRowsAttempted
            pinDiagnosticRowsCompleted=(progress["rowsCompleted"] as? NSNumber)?.intValue ?? pinDiagnosticRowsCompleted
            pinDiagnosticCurrentRow=(progress["row"] as? NSNumber)?.intValue
            pinDiagnosticStage=progress["stage"] as? String ?? "working"
            pinDiagnosticMenuLeftOpen=progress["menuLeftOpen"] as? Bool
            for item in progress["statuses"] as? [[String:Any]] ?? [] {
                if let row=(item["row"] as? NSNumber)?.intValue {pinDiagnosticRows[row]=item["status"] as? String ?? "unknown"}
            }
            let rows=pinDiagnosticRows.keys.sorted().map { "Row \($0): \(pinDiagnosticRows[$0] ?? "unknown")" }.joined(separator:"\n")
            let menu=pinDiagnosticMenuLeftOpen.map{$0 ? "Yes":"No"} ?? "Unknown"
            starredDiagnosticOutput.stringValue="Pin-status diagnostic v\(pinnedDiagnosticVersion) · rows attempted \(pinDiagnosticRowsAttempted), completed \(pinDiagnosticRowsCompleted) · row \(pinDiagnosticCurrentRow.map(String.init) ?? "—"): \(pinDiagnosticStage) · menu left open \(menu)\n\(rows)"
            return
        }
        if let result=payload["topChatPinResult"] as? [String:Any] {
            pinDiagnosticTimeoutTask?.cancel();pinDiagnosticTimeoutTask=nil;pinDiagnosticRunID=nil
            func count(_ value:Any?) -> String { (value as? NSNumber).map{String($0.intValue)} ?? "0" }
            let rows=(result["rows"] as? [[String:Any]] ?? []).map { row in
                "Row \(count(row["row"])): \(row["status"] as? String ?? "unknown") · \(row["reason"] as? String ?? "unknown")"
            }.joined(separator:"\n")
            let source=result["source"] as? [String:Any] ?? [:]
            let sources=(source["sources"] as? [[String:Any]] ?? []).map { item in
                "\(item["pathname"] as? String ?? "/backend-api/:path") · HTTP \((item["status"] as? NSNumber).map{String($0.intValue)} ?? "?") · query keys [\((item["queryKeys"] as? [String] ?? []).joined(separator:","))] · update_time \((item["containsUpdateTime"] as? Bool)==true ? "Yes":"No")"
            }.joined(separator:"\n")
            let timeout=result["timeoutRowIndex"].map{count($0)} ?? "none",menu=(result["menuLeftOpen"] as? Bool)==true ? "Yes":"No"
            starredDiagnosticOutput.stringValue="Pin-status diagnostic v\(result["version"] as? String ?? pinnedDiagnosticVersion) · rows attempted \(count(result["rowsAttempted"])) · completed \(count(result["rowsCompleted"])) · timeout row \(timeout) · menu left open \(menu)\n\(rows.isEmpty ? "No visible conversation rows found.":rows)\nPinned: \(count(result["pinnedCount"])) · not pinned: \(count(result["notPinnedCount"])) · unknown: \(count(result["unknownCount"]))\nContiguous pinned prefix: \(result["contiguousTopBlock"] as? String ?? "unknown") · reason \(result["reason"] as? String ?? "unknown")\nPassive source matched: \((source["matched"] as? Bool)==true ? "Yes":"No") · update_time available \(count(source["updatedAtCount"]))\n\(sources.isEmpty ? "No matched passive source.":sources)"
            return
        }
        if payload["error"] != nil {finishPinDiagnostic("Pin-status diagnostic v\(pinnedDiagnosticVersion) failed safely.");return}
        guard let result=payload["result"] as? [String:Any],let sidebar=result["sidebar"] as? [String:Any],
              let structure=result["structure"] as? [String:Any] else {
            starredDiagnosticOutput.stringValue="Diagnostic hook available: Yes · isolated test failed safely."
            return
        }
        func yes(_ value:Any?) -> String { (value as? Bool)==true ? "Yes":"No" }
        func count(_ value:Any?) -> String { (value as? NSNumber).map{String($0.intValue)} ?? "Unknown" }
        let rect=(sidebar["rect"] as? [String:Int]).map{"x \($0["x"] ?? 0), y \($0["y"] ?? 0), w \($0["width"] ?? 0), h \($0["height"] ?? 0)"} ?? "unknown"
        let groups=(structure["groups"] as? [[String:Any]] ?? []).prefix(12).enumerated().map { index,group in
            "group \(index+1): \(group["tag"] as? String ?? "?") / \(group["role"] as? String ?? "none"), class \(group["labelClass"] as? String ?? "other"), links \(count(group["linkCount"])), first order \(count(group["firstOrder"])), visible \(yes(group["visible"])), expanded \(group["ariaExpanded"] as? String ?? "absent"), own scroll \(yes(group["hasOwnScroll"]))"
        }.joined(separator:"\n")
        let order=(structure["orderedLinks"] as? [[String:Any]] ?? []).prefix(20).map { link in
            "\(count(link["order"])): \(link["groupClass"] as? String ?? "other") · \(link["containerTag"] as? String ?? "?") / \(link["containerRole"] as? String ?? "none")"
        }.joined(separator:"; ")
        let controls=(structure["disclosures"] as? [[String:Any]] ?? []).prefix(5).enumerated().map { index,item in
            "#\(index+1) \(item["role"] as? String ?? "?") · aria-expanded \(item["expanded"] as? String ?? "absent") · container \(yes(item["hasContainer"])) · class \(item["labelClass"] as? String ?? "other")"
        }.joined(separator:"\n")
        let candidate=structure["candidate"] as? [String:Any] ?? [:]
        let ariaAttrs=(candidate["ariaAttributes"] as? [String] ?? []).joined(separator:", ")
        let dataAttrs=(candidate["dataAttributes"] as? [String] ?? []).joined(separator:", ")
        let parentChain=(structure["parentChain"] as? [[String:Any]] ?? []).prefix(5).enumerated().map { index,node in
            let kinds=node["siblingKinds"] as? [String:Int] ?? [:]
            return "\(index+1): \(node["tag"] as? String ?? "?") / \(node["role"] as? String ?? "none") · sibling count \(count(node["siblingCount"])) · buttons \(kinds["button"] ?? 0), conversations \(kinds["conversation_link"] ?? 0), projects \(kinds["project_link"] ?? 0), groups \(kinds["div_group"] ?? 0), headings \(kinds["heading"] ?? 0), other links \(kinds["link"] ?? 0), other \(kinds["other"] ?? 0) · aria [\((node["ariaAttributes"] as? [String] ?? []).joined(separator:", "))] · data [\((node["dataAttributes"] as? [String] ?? []).joined(separator:", "))]"
        }.joined(separator:"\n")
        let relations=structure["relationships"] as? [String:Any] ?? [:]
        func relation(_ name:String)->String {let item=relations[name] as? [String:Any] ?? [:];let roles=(item["targetRoles"] as? [String] ?? []).joined(separator:", ");return "\(name): present \(yes(item["present"])) · target \(yes(item["targetFound"])) · role \(roles.isEmpty ? "none":roles)"}
        let region=structure["region"] as? [String:Any] ?? [:],regionCounts=region["counts"] as? [String:Int] ?? [:]
        let source=result["source"] as? [String:Any] ?? [:]
        let sources=(source["sources"] as? [[String:Any]] ?? []).prefix(10).map { item in
            "\(item["method"] as? String ?? "UNKNOWN") \(item["pathname"] as? String ?? "/backend-api/:path") · HTTP \((item["status"] as? NSNumber).map{String($0.intValue)} ?? "?") · keys [\((item["queryKeys"] as? [String] ?? []).joined(separator:","))] · items \(count(item["itemCount"]))"
        }.joined(separator:"\n")
        let observed=(source["observedStreams"] as? [[String:Any]] ?? []).prefix(20).map { item in
            let archived=item["archived"] as? Bool;let starred=item["starred"] as? Bool
            return "\(item["method"] as? String ?? "UNKNOWN") \(item["pathname"] as? String ?? "/backend-api/:path") · HTTP \((item["status"] as? NSNumber).map{String($0.intValue)} ?? "?") · keys [\((item["queryKeys"] as? [String] ?? []).joined(separator:","))] · items \(count(item["itemCount"])) · archived \(archived.map{String($0)} ?? "unknown") · starred \(starred.map{String($0)} ?? "unknown") · update_time \(yes(item["containsUpdateTime"]))"
        }.joined(separator:"\n")
        starredDiagnosticOutput.stringValue="Diagnostic hook available: Yes · authenticated ChatGPT WKWebView\nSidebar: found \(yes(sidebar["found"])) · visible \(yes(sidebar["visible"])) · rect \(rect) · visible chat links \(count(sidebar["visibleConversationLinkCount"]))\nPinned structural group: \(yes(structure["pinnedGroupFound"])) · pinned links \(count(structure["pinnedLinkCount"])) · visible pinned links \(count(structure["visiblePinnedLinkCount"]) ) · fullness \(structure["fullness"] as? String ?? "unknown") · scrollable ancestor \(yes(structure["scrollableAncestor"])) · load-more controls \(count(structure["loadMoreCount"]))\nGroups:\n\(groups.isEmpty ? "none":groups)\nTop link order (no titles/IDs): \(order.isEmpty ? "none":order)\nDisclosure controls: \(count(structure["disclosureCount"]))\n\(controls.isEmpty ? "none":controls)\nSource: \(result["sourceType"] as? String ?? "unknown") · base starred=false source observed \(yes(source["baseSourceAvailable"])) · pinned/base overlap \(count(source["baseOverlapCount"])) · network matched \(count(source["networkMatchedCount"]) ) · updatedAt available \(count(source["updatedAtCount"])) · recent pinned \(count(source["recentCount"]))\n\(sources.isEmpty ? "No matching passive list response in this page session.":sources)\nLocked chats: excluded from this proof; no access attempted."
        starredDiagnosticOutput.stringValue += "\nPinned candidate: \(candidate["tag"] as? String ?? "none") / \(candidate["role"] as? String ?? "none") · expanded \(candidate["ariaExpanded"] as? String ?? "absent") · aria attributes [\(ariaAttrs)] · data attributes [\(dataAttrs)] · ID present \(yes(candidate["idPresent"]))\nARIA: \(relation("ariaControls")) · \(relation("ariaLabelledby")) · \(relation("ariaOwns"))\nCandidate parent chain (max 5):\n\(parentChain.isEmpty ? "none":parentChain)\nPinned flat region: found \(yes(region["found"])) · non-nested/virtualized \(yes(region["nonNested"])) · sibling nodes \(count(region["siblingCount"])) · conversations \(regionCounts["conversationLinks"] ?? 0) · projects \(regionCounts["projectLinks"] ?? 0) · unknown \(regionCounts["unknownLinks"] ?? 0)"
        starredDiagnosticOutput.stringValue += "\nObserved passive list responses (includes initial page load):\n\(observed.isEmpty ? "none":observed)\nStarred=true source observed: \(yes(source["starredTrueSourceAvailable"])) · pinned matches \(count(source["starredTrueOverlapCount"])) · update_time available: \(yes((source["observedStreams"] as? [[String:Any]])?.contains(where: { ($0["starred"] as? Bool)==true && ($0["containsUpdateTime"] as? Bool)==true })))"
    }
    func startListDiagnostic(visible:Bool,inspectRecentTraffic:Bool=false) {
        guard !cycleRunning else {listDiagnosticOutput.stringValue="List diagnostics unavailable while a cycle is running.";return}
        if let owner=manualDiagnosticOwnerLabel() {listDiagnosticOutput.stringValue="List diagnostics unavailable · \(owner) diagnostic is active.";updateRuntimeIdentity();return}
        guard let generation=listDiagnosticGenerationGate.tryBegin() else {listDiagnosticOutput.stringValue="List diagnostics unavailable · another diagnostic is active.";return}
        listDiagnosticTask?.cancel();listDiagnosticMode=inspectRecentTraffic ? "Recent-chat list traffic":(visible ? "Visible home":"Hidden home")
        listDiagnosticRequests=0;listDiagnosticRequestIDs=[];listDiagnosticResponses=0;listDiagnosticFailures=0;listDiagnosticRecognized=false;listDiagnosticStatusCodes=[]
        listDiagnosticResourceObserved=false;listDiagnosticResourceCompleted=false;listDiagnosticResourceInitiator="Unknown";listDiagnosticResourceStart=nil;listDiagnosticResourceStatus=nil
        listDiagnosticLastTransport="Unknown";listDiagnosticLastMethod="Unknown";listDiagnosticLastPath="Unknown";listDiagnosticLastStatus=nil
        listDiagnosticKeys=[];listDiagnosticFieldTypes="";listDiagnosticItemsType="Unknown";listDiagnosticItemCount=nil
        listDiagnosticPage="Pending";listDiagnosticViewport="Pending";listDiagnosticSidebar="Pending";listDiagnosticFetchHookActive="Unknown";listDiagnosticXHRHookActive="Unknown";listDiagnosticHookAssignments="Unknown";listDiagnosticBackendResources=[];listDiagnosticTimestamp="";listDiagnosticTrafficLines=[]
        listDiagnosticOutput.stringValue="\(listDiagnosticMode): loading ChatGPT home; capturing only sanitized backend traffic for at most 45 seconds."
        updateRuntimeIdentity()
        _=presentWindow(session,intent:.background,callSite:"manual_background_home_diagnostic")
        let home=URL(string:"https://chatgpt.com/")!
        let loadHome={ [weak self] in guard let self,self.listDiagnosticGenerationGate.owns(generation) else{return};self.web.load(URLRequest(url:home)) }
        if inspectRecentTraffic {
            web.evaluateJavaScript("sessionStorage.setItem('gpt-limits-inspect-recent-list-traffic','1'); true") { [weak self] _,error in
                DispatchQueue.main.async { [weak self] in
                    guard let self,self.listDiagnosticGenerationGate.owns(generation) else{return}
                    if error != nil {self.finishListDiagnosticCancellation(generation:generation);self.listDiagnosticOutput.stringValue="Recent-chat list traffic diagnostic unavailable · could not arm a one-navigation in-memory capture.";return}
                    loadHome()
                }
            }
        } else {loadHome()}
        listDiagnosticTask=Task { @MainActor [weak self] in
            do {try await Task.sleep(nanoseconds:45_000_000_000)} catch {
                guard let self=self,self.listDiagnosticGenerationGate.owns(generation) else{return}
                self.finishListDiagnosticCancellation(generation:generation)
                return
            }
            guard let self=self,self.listDiagnosticGenerationGate.owns(generation) else{return}
            self.finishListDiagnostic(generation:generation)
        }
    }
    func finishListDiagnosticCancellation(generation:UUID) {
        guard listDiagnosticGenerationGate.owns(generation) else{return}
        listDiagnosticOutput.stringValue="List diagnostic cancelled · ownership released."
        listDiagnosticTask=nil;listDiagnosticMode=""
        guard listDiagnosticGenerationGate.finish(generation) else{return}
        updateRuntimeIdentity()
    }
    func finishListDiagnostic(generation:UUID) {
        guard listDiagnosticGenerationGate.owns(generation) else{return}
        if listDiagnosticMode=="Recent-chat list traffic" {
            web.evaluateJavaScript("window.gptEndRecentListTrafficCapture?.()") { [weak self] result,_ in
                DispatchQueue.main.async {
                    guard let self,self.listDiagnosticGenerationGate.owns(generation) else{return}
                    if let events=result as? [[String:Any]] {self.listDiagnosticTrafficLines=self.formatRecentListTraffic(events)}
                    self.finishListDiagnosticNow(generation:generation)
                }
            }
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds:1_000_000_000)
                guard let self,self.listDiagnosticGenerationGate.owns(generation) else{return}
                self.finishListDiagnosticNow(generation:generation)
            }
            return
        }
        finishListDiagnosticNow(generation:generation)
    }
    func formatRecentListTraffic(_ events:[[String:Any]])->[String] {
        events.suffix(50).compactMap { item in
            guard let path=item["pathname"] as? String,path.hasPrefix("/backend-api/"),path.range(of:"^/backend-api/[A-Za-z0-9_:/.-]{1,180}$",options:.regularExpression) != nil else{return nil}
            let kind=(item["event"] as? String).flatMap{["request","response","failure","shape","resource"].contains($0) ? $0:nil} ?? "unknown"
            let transport=(item["transport"] as? String).flatMap{["fetch","XHR","resource","unknown"].contains($0) ? $0:nil} ?? "unknown"
            let status=(item["status"] as? NSNumber).map{String(max(100,min(599,$0.intValue)))} ?? "—"
            let keys=(item["topLevelKeys"] as? [String] ?? []).filter{$0.range(of:"^[A-Za-z0-9_]{1,64}$",options:.regularExpression) != nil}.prefix(40).joined(separator:",")
            let arrays=(item["arrayCounts"] as? [[String:Any]] ?? []).prefix(8).compactMap{array -> String? in guard let key=array["key"] as? String,key.range(of:"^[A-Za-z0-9_]{1,64}$",options:.regularExpression) != nil,let count=(array["count"] as? NSNumber)?.intValue,count>=0 else{return nil};return "\(key)=\(min(count,1_000_000))"}.joined(separator:",")
            let recognized=(item["recognized"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"
            let rejection=(item["parserRejectionReason"] as? String).flatMap{$0.range(of:"^[a-z0-9_]{1,48}$",options:.regularExpression) != nil ? $0:nil} ?? "not_evaluated"
            return "\(kind) · \(transport) · \(path) · HTTP \(status) · keys [\(keys.isEmpty ? "—":keys)] · arrays [\(arrays.isEmpty ? "—":arrays)] · recognized \(recognized) · parser reason \(rejection)"
        }
    }
    func finishListDiagnosticNow(generation:UUID) {
        guard listDiagnosticGenerationGate.owns(generation) else{return}
        let completedMode=listDiagnosticMode
        let timingResponse=listDiagnosticResourceObserved && listDiagnosticResourceCompleted
        let effectiveResponses=listDiagnosticResponses+(timingResponse && listDiagnosticResponses==0 ? 1:0)
        var statuses=listDiagnosticStatusCodes;if let code=listDiagnosticResourceStatus,statuses.isEmpty {statuses.append(code)}
        let reason=classifyListDiagnostic(requests:listDiagnosticRequests,resourceObserved:listDiagnosticResourceObserved,responses:effectiveResponses,failures:listDiagnosticFailures,
          statusCodes:statuses,recognized:listDiagnosticRecognized)
        let status=listDiagnosticLastStatus.map(String.init) ?? listDiagnosticResourceStatus.map(String.init) ?? "not received"
        let parser=listDiagnosticRecognized ? "recognized" : (effectiveResponses>0 ? "not recognized":"not observed")
        let keys=listDiagnosticKeys.isEmpty ? "—":listDiagnosticKeys.joined(separator:", ")
        let items=listDiagnosticItemCount.map(String.init) ?? "unknown"
        let resourceStart=listDiagnosticResourceStart.map{String($0)+" ms"} ?? "—"
        let otherResources=listDiagnosticBackendResources.isEmpty ? "—" : listDiagnosticBackendResources.joined(separator:"; ")
        let traffic=listDiagnosticTrafficLines.isEmpty ? "none observed":"\(listDiagnosticTrafficLines.count) sanitized events\n"+listDiagnosticTrafficLines.suffix(24).joined(separator:"\n")
        listDiagnosticOutput.stringValue="\(completedMode) · \(reason.rawValue)\nRequest: \(listDiagnosticRequests>0 || listDiagnosticResourceObserved ? "Yes":"No") · fetch/XHR: \(listDiagnosticRequests) · resource timing: \(listDiagnosticResourceObserved ? "Yes":"No") · Response: \(effectiveResponses>0 ? "Yes":"No") · Parser: \(parser)\n\(listDiagnosticLastMethod) \(listDiagnosticLastPath) · \(listDiagnosticLastTransport) · HTTP \(status) · \(listDiagnosticTimestamp) · resource start \(resourceStart)\nResponse keys: \(keys) · items: \(listDiagnosticItemsType) / \(items) · types: \(listDiagnosticFieldTypes)\nPage: \(listDiagnosticPage) · viewport: \(listDiagnosticViewport) · sidebar: \(listDiagnosticSidebar) · fetch hook active: \(listDiagnosticFetchHookActive) · XHR hook active: \(listDiagnosticXHRHookActive) · wrapper reassignments: \(listDiagnosticHookAssignments)\nRecent-chat list traffic:\n\(traffic)\nBackend API resources: \(otherResources)"
        updateCurrentCycleSummary()
        listDiagnosticTask=nil
        listDiagnosticMode=""
        guard listDiagnosticGenerationGate.finish(generation) else{return}
        updateRuntimeIdentity()
    }
    @objc func checkFirstRecent() {
        guard !cycleRunning else {return}
        guard let first = recentRecords().first, let id = first["conversationId"] as? String,
              id.range(of: #"^[A-Za-z0-9-]+$"#, options: .regularExpression) != nil else {
            output.stringValue = "No recent chats available. Refresh recent chats first."; return
        }
        route.stringValue = "https://chatgpt.com/c/" + id
        check()
        route.stringValue = ""
    }
    @objc func quit() { NSApp.terminate(nil) }
    @objc func check() {
        guard !cycleRunning else {return}
        guard let url = URL(string: route.stringValue), url.scheme == "https", url.host == "chatgpt.com",
              let match = url.path.range(of: #"/c/([A-Za-z0-9-]+)$"#, options: .regularExpression) else {
            output.stringValue = "Enter a ChatGPT conversation URL (/c/id or /g/…/c/id)."; return
        }
        let identifier = String(url.path[match]).components(separatedBy: "/").last!
        // Only local control state; never invokes an API endpoint.
        let encoded = String(data: try! JSONSerialization.data(withJSONObject: [identifier]), encoding: .utf8)!
        web.evaluateJavaScript("sessionStorage.setItem('gpt-limits-prototype-check', \(encoded)[0])") { [weak self] _, error in
            guard let self = self else { return }
            if error != nil { self.output.stringValue = "Open ChatGPT session first; local check initialization failed."; return }
            self.output.stringValue = "Loading conversation in hidden WebView; waiting for passive capture…"
            self.session.orderOut(nil)
            self.web.load(URLRequest(url: URL(string: "https://chatgpt.com" + url.path)!))
        }
    }
    @objc func startLiveDocumentResumeProof() {
        guard !cycleRunning,backgroundRenderLeaseOwner == nil else {liveResumeDiagnosticOutput.stringValue="Unavailable · scheduler/render lease is active.";return}
        guard manualDiagnosticOwnerLabel() == nil else {liveResumeDiagnosticOutput.stringValue="Unavailable · another diagnostic is active.";return}
        guard !web.isLoading,let url=web.url,url.host=="chatgpt.com",let id=conversationID(in:url),conversationRouteTemplate(url.path) != nil else {
            liveResumeDiagnosticOutput.stringValue="Unavailable · open a loaded ChatGPT conversation first.";return
        }
        let generation=UUID().uuidString;liveResumeDiagnosticGeneration=generation
        liveResumeDiagnosticCancelButton?.isEnabled=true
        liveResumeDiagnosticOutput.stringValue="Starting · same visible WebView/document · two passes, at most 60 seconds each. No route load or production record writes."
        updateRuntimeIdentity()
        let payload:[String:Any]=["conversationId":id,"operationGeneration":generation,"passDurationMs":60000]
        guard let data=try? JSONSerialization.data(withJSONObject:payload),let json=String(data:data,encoding:.utf8) else {finishLiveDocumentResumeProof(generation:generation,result:nil,reason:"command_encode_failed");return}
        let script="if(typeof window.gptRunLiveDocumentResumeProof!=='function'){window.webkit.messageHandlers.liveResumeDiagnostic.postMessage({operationGeneration:'\(generation)',passGeneration:'\(generation):0',stage:'terminal',status:'hook_missing'});true;}else{void window.gptRunLiveDocumentResumeProof(\(json)).catch(()=>window.webkit.messageHandlers.liveResumeDiagnostic.postMessage({operationGeneration:'\(generation)',passGeneration:'\(generation):0',stage:'terminal',status:'bridge_error'}));true;}"
        liveResumeDiagnosticTimeoutTask=Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds:125_000_000_000)
            guard let self,self.liveResumeDiagnosticGeneration==generation else{return}
            self.web.evaluateJavaScript("window.gptCancelLiveDocumentResumeProof?.('\(generation)')",completionHandler:nil)
            self.finishLiveDocumentResumeProof(generation:generation,result:nil,reason:"bounded_bridge_timeout")
        }
        web.evaluateJavaScript(script) { [weak self] _,error in
            guard let self,error != nil else{return}
            DispatchQueue.main.async {self.finishLiveDocumentResumeProof(generation:generation,result:nil,reason:"command_dispatch_failed")}
        }
    }
    @objc func cancelLiveDocumentResumeProof() {
        guard let generation=liveResumeDiagnosticGeneration else{return}
        liveResumeDiagnosticOutput.stringValue="Cancelling · waiting for the current bounded UI step to finish."
        web.evaluateJavaScript("window.gptCancelLiveDocumentResumeProof?.('\(generation)')",completionHandler:nil)
    }
    func finishLiveDocumentResumeProof(generation:String,result:[String:Any]?,reason:String?) {
        guard liveResumeDiagnosticGeneration==generation else{return}
        liveResumeDiagnosticTimeoutTask?.cancel();liveResumeDiagnosticTimeoutTask=nil
        liveResumeDiagnosticGeneration=nil;liveResumeDiagnosticCancelButton?.isEnabled=false
        guard let result else {
            liveResumeDiagnosticOutput.stringValue="Same-document resume proof: NOT PROVEN · \(reason ?? "diagnostic_failed")"
            updateRuntimeIdentity();return
        }
        func count(_ object:Any?,_ key:String)->Int {(object as? [String:Any])?[key] as? Int ?? ((object as? [String:Any])?[key] as? NSNumber)?.intValue ?? 0}
        let pass1=result["pass1"] as? [String:Any] ?? [:],pass2=result["pass2"] as? [String:Any] ?? [:]
        let frontier=(pass1["frontier"] as? NSNumber).map{Date(timeIntervalSince1970:$0.doubleValue).formatted(date:.numeric,time:.standard)} ?? "unavailable"
        let proven=result["status"] as? String == "older_frontier_advanced"
        let same=result["sameDocument"] as? Bool == true,routeUnchanged=result["routeUnchanged"] as? Bool == true
        let noReload=result["reloadBetweenPasses"] as? Bool == false
        let stale=count(result,"staleRepliesRejected")
        let order=(pass2["orderPreserved"] as? Bool)==true
        func label(_ object:[String:Any],_ key:String,_ fallback:String="insufficient")->String {object[key] as? String ?? fallback}
        let pass1Order=pass1["ordering"] as? [String:Any] ?? [:],pass2Order=pass2["ordering"] as? [String:Any] ?? [:],dom=result["domOrder"] as? [String:Any] ?? [:]
        liveResumeDiagnosticOutput.stringValue="Same-document resume proof: \(proven && same && routeUnchanged && noReload && order ? "PROVEN":"NOT PROVEN")\nPass 1: pages \(count(pass1,"pages")) · unique messages \(count(pass1,"uniqueMessages")) · oldest activity frontier \(frontier)\nPass 1 order: payload \(label(pass1Order,"payloadOrder")) · page arrival \(label(pass1Order,"pageArrival")) · repeated ID occurrences \(count(pass1,"duplicateOccurrences"))\nPass 2: pages \(count(pass2,"pages")) · new unique messages \(count(pass2,"newUniqueMessages")) · new messages older than frontier \(count(pass2,"newOlderMessages"))\nPass 2 order: payload \(label(pass2Order,"payloadOrder")) · page arrival \(label(pass2Order,"pageArrival")) · chronology \(label(pass2Order,"chronologicalSequence","not_proven")) · repeated ID occurrences \(count(pass2,"duplicateOccurrences")) · conflicting duplicate times \(count(pass2,"conflictingDuplicateTimes"))\nDOM order: \(count(dom,"candidateCount")) candidates · \(count(dom,"matchedTimestamps")) timestamp matches · \(label(dom,"direction")) · equal adjacent \(count(dom,"equalAdjacentTimes")) · inversions \(count(dom,"decreasingTransitions"))\nSame document \(same ? "yes":"no") · route unchanged \(routeUnchanged ? "yes":"no") · reload between passes \(noReload ? "no":"yes") · chronological order \(order ? "preserved":"not proven") · stale prior-pass replies rejected \(stale)"
        updateRuntimeIdentity()
    }
    func handleLiveDocumentResumeDiagnostic(_ data:[String:Any]) {
        guard let generation=liveResumeDiagnosticGeneration,data["operationGeneration"] as? String==generation,
              let passGeneration=data["passGeneration"] as? String,passGeneration.hasPrefix(generation+":"),
              let stage=data["stage"] as? String else{return}
        if stage=="terminal" {finishLiveDocumentResumeProof(generation:generation,result:data,reason:nil);return}
        if stage=="pass_started" {
            let pass=(data["passIndex"] as? NSNumber)?.intValue ?? 0
            liveResumeDiagnosticOutput.stringValue="Same-document proof running · pass \(pass)/2 · live document retained; no navigation."
        } else if stage=="page_observed" {
            let pass=(data["passIndex"] as? NSNumber)?.intValue ?? 0
            let pages=(data["pages"] as? NSNumber)?.intValue ?? 0
            let unique=(data["uniqueMessageCount"] as? NSNumber)?.intValue ?? 0
            liveResumeDiagnosticOutput.stringValue="Same-document proof running · pass \(pass)/2 · pages \(pages) · unique messages \(unique)."
        }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.host=="chatgpt.com" {
            if message.name=="conversationHistoryDiagnostic",let data=message.body as? [String:Any] {renderCurrentChatHistoryDiagnostic(data);return}
            if message.name=="messageDOMStructureDiagnostic",let data=message.body as? [String:Any] {renderCurrentMessageDOMStructureDiagnostic(data);return}
            if message.name=="liveResumeDiagnostic",let data=message.body as? [String:Any] {handleLiveDocumentResumeDiagnostic(data);return}
            if message.name=="nativeRescue",let data=message.body as? [String:Any] {
                handleNativeRescueMessage(data);return
            }
            if message.name=="sidebarNavigation",let data=message.body as? [String:Any],
               let token=data["operationGeneration"] as? String,token==pinnedSidebarNavigationToken,
               token==pinnedActivityDiagnosticToken,
               let id=pinnedActivityExpectedConversationID,let ordinal=pinnedActivityExpectedOrdinal,
               let stage=data["stage"] as? String {
                if stage=="sidebar_navigation_command_received" {
                    pinnedActivitySidebarCommandReceived=true;pinnedActivityNavigationCommandAccepted=true
                    pinnedActivityAutomationBridgePresent=true;pinnedActivitySidebarHandlerPresent=true
                    pinnedActivitySidebarCommandAckState="received"
                    pinnedSidebarNavigationAckTimeoutTask?.cancel();pinnedSidebarNavigationAckTimeoutTask=nil
                    pinnedActivityNavigationDiagnosticReason=stage
                    recordPinnedActivityPreNavigationStage(stage,token:token)
                } else if stage=="sidebar_row_lookup_started" {
                    recordPinnedActivityPreNavigationStage(stage,token:token)
                } else if stage=="sidebar_row_anchor_scan_complete" {
                    pinnedActivitySidebarAnchorScanComplete=true
                    pinnedActivitySidebarTotalAnchors=(data["totalAnchors"] as? NSNumber)?.intValue ?? 0
                    pinnedActivitySidebarConversationAnchors=(data["conversationAnchors"] as? NSNumber)?.intValue ?? 0
                    pinnedActivitySidebarMatchingAnchors=(data["matchingAnchors"] as? NSNumber)?.intValue ?? 0
                    recordPinnedActivityPreNavigationStage(stage,token:token)
                } else if stage=="sidebar_row_resolved" {
                    pinnedActivitySidebarRowLookupTerminal=true
                    pinnedSidebarRowLookupTimeoutTask?.cancel();pinnedSidebarRowLookupTimeoutTask=nil
                    pinnedActivitySidebarRowReresolved=true
                    pinnedActivitySidebarScrollRequired=(data["scrollRequired"] as? Bool)==true
                    pinnedActivitySidebarRowVisible=(data["rowVisible"] as? Bool).map{$0 ? "Yes":"No"} ?? "unknown"
                    recordPinnedActivityPreNavigationStage(stage,token:token)
                } else if stage=="sidebar_anchor_activation_prepared" {
                    pinnedActivitySidebarAnchorFound=(data["anchorFound"] as? Bool)==true
                    pinnedActivitySidebarHrefMatchesExpected=(data["hrefMatchesExpected"] as? Bool)==true
                    pinnedActivitySidebarTargetAttributePresent=(data["targetAttributePresent"] as? Bool)==true
                    pinnedActivitySidebarDownloadAttributePresent=(data["downloadAttributePresent"] as? Bool)==true
                    pinnedActivitySidebarRowVisible=(data["rowVisible"] as? Bool).map{$0 ? "Yes":"No"} ?? pinnedActivitySidebarRowVisible
                } else if stage=="sidebar_anchor_click_invoked" {
                    pinnedActivitySidebarActivationMethod=data["activationMethod"] as? String ?? "anchor.click"
                    pinnedActivitySidebarAnchorClickInvoked=(data["clickInvoked"] as? Bool)==true
                    pinnedActivitySidebarRouteChangedImmediately=((data["routeChangedImmediately"] as? Bool).map{$0 ? "Yes":"No"}) ?? "unknown"
                    pinnedActivitySidebarRouteChangedDuringWait=pinnedActivitySidebarRouteChangedDuringWait || (data["routeChangedImmediately"] as? Bool)==true
                    pinnedActivitySidebarClickDelivered=pinnedActivitySidebarAnchorClickInvoked
                    pinnedActivityNavigationCommandSent=pinnedActivitySidebarAnchorClickInvoked
                    if let template=data["immediateRouteTemplate"] as? String,["/c/<id>","/g/<id>/c/<id>"].contains(template){pinnedActivitySidebarRouteAfter=template}
                } else if stage=="sidebar_scroll_started" || stage=="sidebar_row_scroll_started" {
                    pinnedActivitySidebarScrollRequired=true
                    recordPinnedActivityPreNavigationStage(stage,token:token)
                } else if stage=="sidebar_click_delivered" {
                    pinnedActivitySidebarRowReresolved=(data["rowResolved"] as? Bool)==true
                    pinnedActivitySidebarClickDelivered=(data["clickDelivered"] as? Bool)==true
                    pinnedActivitySidebarClickDefaultPrevented=(data["defaultPrevented"] as? Bool).map{$0 ? "Yes":"No"} ?? "unknown"
                    pinnedActivityNavigationCommandSent=pinnedActivitySidebarClickDelivered
                    pinnedActivityNavigationDiagnosticReason=stage
                    recordPinnedActivityPreNavigationStage(stage,token:token)
                } else if stage=="sidebar_route_reached" {
                    let template=data["routeTemplate"] as? String ?? "unknown"
                    guard ["/c/<id>","/g/<id>/c/<id>"].contains(template) else {
                        finishPinnedActivityFallback(state:.error,reason:"sidebar_navigation_error",token:token,id:id,ordinal:ordinal)
                        finishPinnedSidebarNavigation(token:token,result:false);return
                    }
                    pinnedActivitySidebarRouteAfter=template;pinnedActivityNavigationTargetURLObserved=true
                    pinnedActivityNavigationURLChanged=true;pinnedActivityNavigationDiagnosticReason=stage
                    recordPinnedActivityNavigationStage(stage,token:token)
                    confirmPinnedActivityRoute(token:token,id:id,ordinal:ordinal,template:template,source:"sidebar_ui")
                    finishPinnedSidebarNavigation(token:token,result:true)
                } else if ["sidebar_row_missing","sidebar_row_ambiguous","sidebar_row_lookup_error","sidebar_row_lookup_timeout","sidebar_row_scroll_failed","sidebar_navigation_no_effect","sidebar_navigation_error"].contains(stage) {
                    pinnedActivitySidebarRowLookupTerminal=true
                    pinnedSidebarRowLookupTimeoutTask?.cancel();pinnedSidebarRowLookupTimeoutTask=nil
                    if stage=="sidebar_row_lookup_error" {let category=data["errorCategory"] as? String ?? "Error";pinnedActivitySidebarLookupErrorCategory=["TypeError","SyntaxError","SecurityError"].contains(category) ? category:"Error"}
                    if let resolved=data["rowResolved"] as? Bool {pinnedActivitySidebarRowReresolved=resolved}
                    if let delivered=data["clickDelivered"] as? Bool {pinnedActivitySidebarClickDelivered=delivered;pinnedActivityNavigationCommandSent=delivered}
                    if let scroll=data["scrollRequired"] as? Bool {pinnedActivitySidebarScrollRequired=scroll}
                    if let visible=data["rowVisible"] as? Bool {pinnedActivitySidebarRowVisible=visible ? "Yes":"No"}
                    pinnedActivityNavigationDiagnosticReason=stage
                    finishPinnedActivityFallback(state:.error,reason:stage,token:token,id:id,ordinal:ordinal)
                    finishPinnedSidebarNavigation(token:token,result:false)
                }
                setLastIsolatedDiagnostic(pinnedActivityStatusText());return
            }
            if message.name=="backendTraffic",let data=message.body as? [String:Any],
               let token=pinnedActivityDiagnosticToken {
                handlePinnedBackendTraffic(data,token:token);return
            }
            if message.name=="chatCheck",message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.host=="chatgpt.com",let data=message.body as? [String:Any] {
                if data["event"] as? String=="continuation_source" {receiveContinuationSourceEvent(data)}
                else if data["event"] as? String=="history_request" {recordChatCheckHistoryRequest(data)}
                else if data["event"] as? String=="stage" {recordChatCheckScriptStage(data)}
                else if data["event"] as? String=="continuation_stage" {recordChatCheckContinuationStage(data)}
                else if data["event"] as? String=="continuation_response_pipeline" {recordChatCheckContinuationResponse(data)}
                else if data["event"] as? String=="first_pass_identity_provenance" {recordChatCheckIdentityProvenance(data)}
                else if data["event"] as? String=="history_response_parse_diagnostic" {recordChatCheckHistoryResponseParsing(data)}
                return
            }
            if message.name=="activity",let data=message.body as? [String:Any] {
                cycleActivity=data
                recordChatCheckActivity(data)
                if pinnedActivityWaiterArmed,
                   pinnedActivityEventMatches(data,expectedConversationID:pinnedActivityWaiterConversationID ?? "",expectedOwner:"isolated_timestamp_fallback",expectedGeneration:pinnedActivityWaiterToken ?? "") {
                    pinnedActivityActivityEndpointFamily=data["endpointFamily"] as? String ?? "unknown"
                }
                if pinnedActivityWaiterArmed,let token=pinnedActivityWaiterToken,
                   let expected=pinnedActivityWaiterConversationID,let ordinal=pinnedActivityWaiterOrdinal,
                   token==pinnedActivityDiagnosticToken,
                   pinnedActivityEventMatches(data,expectedConversationID:expected,expectedOwner:"isolated_timestamp_fallback",expectedGeneration:token) {
                    let status=(data["httpStatus"] as? NSNumber)?.intValue ?? 0
                    if status==429 {
                        pinnedActivity429Observed=true;pinnedActivity429Family=data["endpointFamily"] as? String ?? "unknown"
                        pinnedActivity429Owner="isolated_timestamp_fallback";pinnedActivity429Stage=data["occurredAtStage"] as? String ?? "timestamp_navigation"
                        pinnedActivity429Relevant=true
                        if pinnedActivityRouteConfirmed && pinnedActivityLiveWaitState=="waiting" {
                            finishPinnedActivityLiveWait(token:token,id:expected,ordinal:ordinal,result:.error("activity_http_429"))
                        } else {
                            finishPinnedActivityFallback(state:.error,reason:"activity_http_429",token:token,id:expected,ordinal:ordinal)
                        }
                        return
                    }
                    if (200...299).contains(status) {
                        if pinnedActivityRouteConfirmed {handleConfirmedPinnedActivityResponse(data,token:token,id:expected,ordinal:ordinal)}
                        else {pinnedActivityPendingResponse=data;pinnedActivityResponseBufferedBeforeRoute=true}
                    }
                } else if pinnedActivityWaiterArmed {
                    pinnedActivityUnrelatedActivityEvents+=1
                    setLastIsolatedDiagnostic(pinnedActivityStatusText())
                }
                return
            }
            if message.name=="starredDiagnostic",let payload=message.body as? [String:Any],
               let token=payload["cycleToken"] as? String,token==cycleToken,!token.isEmpty {
                if let result=payload["cyclePinnedResult"] as? [String:Any],!result.isEmpty {cyclePinnedResult=result}
                else {cyclePinnedResult=["stopReason":"bridge_result_invalid","pinnedPrefixReason":"bridge_result_invalid","pinnedPrefixStatus":"pinned_prefix_unproven","traversalTerminal":["stage":"native_decode","internalReason":"bridge_result_invalid","rowIndex":NSNull(),"processedCount":0,"semanticSnapshotValid":NSNull(),"scrollAttempted":false,"menuCleanupResult":"not_run","leaseValid":backgroundRenderLeaseOwner != nil,"timeout":false,"cancelled":false]]}
                return
            }
        }
        if message.name=="starredDiagnostic",message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.host=="chatgpt.com",
           let payload=message.body as? [String:Any] {
            if let owner=payload["renderLeaseReadinessToken"] as? String,owner==renderLeaseReadinessOwner {
                if let result=payload["renderLeaseReadiness"] as? [String:Any] {
                    finishRenderLeaseReadiness(owner:owner,result:result,error:nil)
                } else {
                    finishRenderLeaseReadiness(owner:owner,result:nil,error:BackgroundRenderLeaseError.readinessUnavailable)
                }
                return
            }
            if let token=payload["renderDiagnosticToken"] as? String,token==renderDiagnosticToken {
                finishHiddenRenderDiagnostic(token:token,result:payload["renderStateResult"] as? [String:Any],error:payload["renderStateError"] as? String)
                return
            }
            if let token=payload["activityDiagnosticToken"] as? String,token==pinnedActivityDiagnosticToken {
                if let progress=payload["pinnedActivityProgress"] as? [String:Any] {handlePinnedActivityProgress(progress,token:token);return}
                if let promise=payload["jsPromiseStatus"] as? String {pinnedActivityJSPromiseStatus=promise}
                if let result=payload["pinnedActivityResult"] as? [String:Any] {handlePinnedActivityProbe(result,token:token)}
                else {pinnedActivityJSPromiseStatus="rejected";pinnedActivityPrefix="probe_failed";pinnedActivityTopReason="bridge_probe_failed";pinnedActivityReason="stage_error:\(pinnedActivityStage)";pinnedActivityTimestampExpected=false;pinnedActivityTimestampStage=PinnedTimestampState.error.rawValue;pinnedActivityTimestampReason="timestamp_bridge_error";finishPinnedActivityDiagnostic()}
                return
            }
            displayStarredDiagnostic(payload)
            return
        }
        if message.name=="diagnostics",message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.host=="chatgpt.com",
           let data=message.body as? [String:Any] {
            let event=data["event"] as? String ?? ""
            if event=="root_request_correlation",cycleDiscovering,cycleRootTriggerStarted,
               let correlation=RootRequestCorrelationEvent.make(data) {
                if cycleState.lastRootRequestCorrelation==nil {cycleState.lastRootRequestCorrelation=RootRequestCorrelationState()}
                cycleState.lastRootRequestCorrelation?.append(correlation)
                saveCycle()
                return
            }
            if event=="session_paint_watch",data["generation"] as? String==visibleSessionPaintWatchGeneration,
               let result=data["result"] as? [String:Any] {
                visibleSessionPresentationReport="\(visibleSessionPresentationReport) · post-restore \(sessionPaintWatchSummary(result)) · native [\(sessionPresentationSnapshot())]"
                updateRuntimeIdentity()
                let generation=data["generation"] as? String ?? ""
                if result["status"] as? String=="render_target_observed",generation != visibleSessionPaintSyncGeneration {
                    DispatchQueue.main.async { [weak self] in
                        guard let self else{return}
                        guard self.visibleSessionPaintWatchGeneration==generation,
                              self.backgroundRenderLease==nil,
                              self.session.isVisible,
                              self.web.window===self.session,
                              self.session.contentView===self.web else {
                            self.visibleSessionPresentationReport += " · hydration display sync skipped: presentation ownership changed"
                            self.updateRuntimeIdentity()
                            return
                        }
                        self.visibleSessionPaintSyncGeneration=generation
                        self.web.layoutSubtreeIfNeeded()
                        self.web.setNeedsDisplay(self.web.bounds)
                        self.web.layer?.setNeedsDisplay()
                        self.session.contentView?.setNeedsDisplay(self.session.contentView?.bounds ?? .zero)
                        self.session.displayIfNeeded()
                        self.web.displayIfNeeded()
                        self.visibleSessionPresentationReport += " · hydration display sync performed once after two frames"
                        self.updateRuntimeIdentity()
                    }
                }
                return
            }
            if event=="root_hook_health",data["cycleToken"] as? String==cycleToken,!cycleToken.isEmpty {
                let keys=["routeTemplate","documentReadyState","bodyPresent","sidebarAvailable","sidebarCandidates","conversationLinks",
                          "rootListHookInstalled","fetchHookInstalled","xhrOpenHookInstalled","xhrSendHookInstalled","generationAttached","sidebarMetadata","documentLifecycle","rootBackendTraffic","rootHookEvents","rootResourceEvents","rootSidebarTimeline"]
                cycleRootHookHealth=Dictionary(uniqueKeysWithValues:keys.compactMap{key in data[key].map{(key,$0)}})
                recordRootDocumentSnapshot(cycleRootHookHealth)
                updatePartitionReport();renderCycle()
            }
            if event=="rate_limit",(data["status"] as? NSNumber)?.intValue==429 {
                let family=data["family"] as? String ?? "unknown",owner=data["owner"] as? String ?? "unknown"
                let generation=data["generation"] as? String
                let occurredAtStage=data["occurredAtStage"] as? String ?? "unknown"
                if owner=="scheduler_discovery",generation==cycleToken,cycleDiscovering,
                   ["root_conversation_list","project_conversation_list"].contains(family) {
                    cycleRootStatuses.insert(429);renderCycle()
                }
                if ["isolated_prefix_diagnostic","isolated_timestamp_fallback"].contains(owner),generation==pinnedActivityDiagnosticToken,generation != nil {
                    pinnedActivity429Observed=true;pinnedActivity429Family=family;pinnedActivity429Owner=owner;pinnedActivity429Stage=occurredAtStage
                    pinnedActivity429Relevant=owner=="isolated_timestamp_fallback"
                        ? ["conversation_messages","conversation_detail"].contains(family)
                        : ["root_conversation_list","project_conversation_list"].contains(family) && ["sidebar_readiness","sidebar_top","prefix_classification","snapshot_reconciliation"].contains(occurredAtStage)
                    setLastIsolatedDiagnostic(pinnedActivityStatusText())
                }
            }
            if cycleDiscovering,cycleRootTriggerStarted,data["cycleToken"] as? String==cycleToken,data["pathname"] as? String=="/backend-api/conversations" {
                if event=="request" {cycleRootRequests+=1}
                if event=="response" {cycleRootResponses+=1;if let status=(data["status"] as? NSNumber)?.intValue,status != 429{cycleRootStatuses.insert(status)}}
                if event=="parsed",data["recognized"] as? Bool==true {cycleRootRecognized+=1}
                if event=="resource" {
                    cycleRootResources+=1
                    if (data["completed"] as? Bool)==true {cycleRootResourceResponses+=1}
                    if let status=(data["status"] as? NSNumber)?.intValue {cycleRootResourceStatuses.insert(status)}
                }
                if event=="partition_request",let raw=data["partitionDescriptor"] as? [String:Any],let descriptor=PartitionDescriptor.decode(raw,registry:&cycleOrigins),cyclePartitions[descriptor]==nil {cyclePartitions[descriptor]=PartitionObservation(descriptor:descriptor)}
                updatePartitionReport();renderCycle()
            }
            let requestID=(data["requestId"] as? NSNumber)?.intValue
            if event=="request" {
                guard listDiagnosticTask != nil,let requestID else{return}
                listDiagnosticRequestIDs.insert(requestID);listDiagnosticRequests+=1
            } else if event=="response" || event=="failure" || event=="parsed" {
                guard listDiagnosticTask != nil,let requestID,listDiagnosticRequestIDs.contains(requestID) else{return}
            } else if event=="page" || event=="resource" {
                guard listDiagnosticTask != nil else{return}
            }
            if let milliseconds=(data["timestamp"] as? NSNumber)?.doubleValue {
                let f=DateFormatter();f.timeStyle = .medium;listDiagnosticTimestamp=f.string(from:Date(timeIntervalSince1970:milliseconds/1000))
            }
            if event != "page" && (event != "resource" || (data["isConversationList"] as? Bool)==true) {
                if let method=data["method"] as? String {listDiagnosticLastMethod=method}
                if let path=data["pathname"] as? String {listDiagnosticLastPath=path}
                if let transport=data["transport"] as? String {listDiagnosticLastTransport=transport}
            }
            switch event {
            case "request":break
            case "response":
                listDiagnosticResponses+=1
                if let status=(data["status"] as? NSNumber)?.intValue {listDiagnosticLastStatus=status;listDiagnosticStatusCodes.append(status)}
            case "failure":listDiagnosticFailures+=1
            case "parsed":
                listDiagnosticRecognized=(data["recognized"] as? Bool)==true
                listDiagnosticKeys=(data["topLevelKeys"] as? [String] ?? []).filter{$0.range(of:"^[A-Za-z0-9_]{1,64}$",options:.regularExpression) != nil}
                let types=data["fieldTypes"] as? [String:String] ?? [:]
                listDiagnosticFieldTypes=types.keys.sorted().map{"\($0)=\(types[$0]!)"}.joined(separator:", ")
                listDiagnosticItemsType=data["itemsType"] as? String ?? "unknown"
                listDiagnosticItemCount=(data["itemCount"] as? NSNumber)?.intValue
            case "resource":
                if (data["isConversationList"] as? Bool)==true {
                    listDiagnosticResourceObserved=true
                    listDiagnosticLastMethod="Unknown"
                    listDiagnosticLastTransport=data["initiatorType"] as? String ?? "other"
                    listDiagnosticResourceInitiator=listDiagnosticLastTransport
                    listDiagnosticResourceStart=(data["relativeStartMs"] as? NSNumber)?.intValue
                    listDiagnosticResourceCompleted=(data["completed"] as? Bool)==true
                    listDiagnosticResourceStatus=(data["status"] as? NSNumber)?.intValue
                }
            case "page":
                listDiagnosticPage=data["pathname"] as? String ?? "unknown"
                let width=(data["width"] as? NSNumber)?.intValue ?? 0,height=(data["height"] as? NSNumber)?.intValue ?? 0
                listDiagnosticViewport="\(width)×\(height) · \(data["visibility"] as? String ?? "unknown")"
                let nav=(data["hasNav"] as? Bool)==true,aside=(data["hasAside"] as? Bool)==true
                let scroll=(data["scrollableContainers"] as? NSNumber)?.intValue ?? 0
                listDiagnosticSidebar="nav \(nav ? "yes":"no"), aside \(aside ? "yes":"no"), scrollable containers \(scroll)"
                listDiagnosticFetchHookActive=(data["fetchHookActive"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"
                listDiagnosticXHRHookActive=(data["xhrHookActive"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"
                let fetchAssignments=(data["fetchAssignments"] as? NSNumber)?.intValue ?? 0
                let xhrOpenAssignments=(data["xhrOpenAssignments"] as? NSNumber)?.intValue ?? 0
                let xhrSendAssignments=(data["xhrSendAssignments"] as? NSNumber)?.intValue ?? 0
                listDiagnosticHookAssignments="fetch \(fetchAssignments), XHR open \(xhrOpenAssignments), send \(xhrSendAssignments)"
                let resources=data["backendResources"] as? [[String:Any]] ?? []
                listDiagnosticBackendResources=resources.suffix(30).compactMap { resource in
                    guard let path=resource["pathname"] as? String,path.hasPrefix("/backend-api/"),!path.contains("?"),
                          let transport=resource["initiatorType"] as? String else{return nil}
                    let status=(resource["status"] as? NSNumber).map{String($0.intValue)} ?? "?"
                    return "\(transport) \(path) [\(status)]"
                }
            default:break
            }
            return
        }
        if message.name == "automation",message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.host == "chatgpt.com",
           let data=try? JSONSerialization.data(withJSONObject:message.body),let update=try? JSONDecoder().decode(AutomationUpdate.self,from:data),update.token==automationToken {
            recordChatCheckPage(update)
            automationUpdate=update
            let a=update.state
            if var telemetry=chatCheckTelemetry {
                telemetry.pagesObserved=max(telemetry.pagesObserved,update.received)
                telemetry.messagesAccumulated=a.messagesCollected
                telemetry.hasPreviousPage=a.hasPreviousPage
                telemetry.enter("history_response_seen")
                telemetry.enter("pagination_page_seen")
                if a.hasPreviousPage==true {telemetry.enter("pagination_started")} else {telemetry.enter("history_wait_started")}
                if a.historyComplete {telemetry.enter("history_complete")}
                chatCheckTelemetry=telemetry
                renderCycle()
            }
            output.stringValue="Production chat check in progress\nMessages: \(a.messagesCollected) · User: \(a.userMessages) · Assistant: \(a.assistantMessages) · Other: \(a.otherMessages)\nEstimated text tokens: \(a.estimatedTextTokens) · Images: \(a.attachments.images) · Audio: \(a.attachments.audio) · Video: \(a.attachments.video) · Files: \(a.attachments.files)\nHistory: \(a.historyComplete && (update.overlap || update.oldest) ? "Complete":"Partial") · Baseline overlap: \(update.overlap ? "Yes":"No")"
            return
        }
        if message.name == "list", message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == "chatgpt.com", let data = message.body as? [String: Any] {
            consumeValidatedListMessage(data)
            return
        }
        if cycleRunning {return}
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == "chatgpt.com",
              let summary = message.body as? [String: Any], let status = summary["status"] as? String else { return }
        let numeric = ["messages", "user", "assistant", "other", "tokens", "images", "audio", "video", "files"]
        let counts = numeric.map { "\($0): \((summary[$0] as? NSNumber)?.intValue ?? 0)" }.joined(separator: " · ")
        output.stringValue = "\(status)\nChat: \((summary["title"] as? String ?? "").prefix(200))\n\(counts)\nHistory: \(summary["history"] as? String ?? "Unknown")\nEndpoint: \(summary["endpoint"] as? String ?? "Unknown")"
    }
    func consumeValidatedListMessage(_ data:[String:Any]) {
        let isProbe=(data["provenance"] as? String)=="recent_safety_probe"
        if isProbe {
            guard let probe=recentSafetyProbe,cycleDiscovering,cycleRootTriggerStarted,!cycleToken.isEmpty,probe.cycleGeneration==cycleToken,
                  data["cycleToken"] as? String==cycleToken,data["probeToken"] as? String==probe.probeToken,!probe.terminalCompleted else {
                if recentSafetyProbe?.cycleGeneration==cycleToken {recentSafetyProbe?.events.append("stale_or_mismatched_probe_token")};return
            }
            recentSafetyProbe?.listMessageReceived=true
            recentSafetyProbe?.events.append(contentsOf:["probe_list_message_received","probe_native_handoff"])
        }
        if cycleDiscovering,cycleRootTriggerStarted,let sequence=(data["rootRequestSequence"] as? NSNumber)?.intValue,sequence>0 {
            recordRootRequestCorrelation(sequence:sequence,stage:.list_message_sent)
            recordRootRequestCorrelation(sequence:sequence,stage:.native_handoff)
        }
        if let records = data["records"] as? [[String: Any]] {
            if cycleDiscovering,cycleRootTriggerStarted {if let sequence=(data["rootRequestSequence"] as? NSNumber)?.intValue,sequence>0 {recordRootRequestCorrelation(sequence:sequence,stage:.consume_attempt)};if isProbe {recentSafetyProbe?.events.append("probe_consume_attempt")};let result=consumeDiscoveryPage(data,records:records,source:isProbe ? .recent_safety_probe:.normal_discovery);if isProbe {recentSafetyProbe?.consumeResult=result;recentSafetyProbe?.events.append("probe_consume_result:\(result.rawValue)");if result == .accepted_new || result == .accepted_repeated,let probe=recentSafetyProbe {_ = completeRecentSafetyProbe(probeToken:probe.probeToken,cycleGeneration:probe.cycleGeneration,result:.consume_terminal)}else if let probe=recentSafetyProbe {_ = completeRecentSafetyProbe(probeToken:probe.probeToken,cycleGeneration:probe.cycleGeneration,result:.bridge_failure)}}}
            for r in records {
                guard let id = r["conversationId"] as? String, let title = r["title"] as? String, let time = r["updatedAt"] as? Double, time.isFinite else { continue }
                if time >= (discovered[id]?["updatedAt"] as? Double ?? 0) { discovered[id] = ["conversationId": id, "title": title, "updatedAt": time] }
            }
        } else if isProbe {
            recentSafetyProbe?.bridgeFailureReason="invalid_probe_list_payload"
            if let probe=recentSafetyProbe {_ = completeRecentSafetyProbe(probeToken:probe.probeToken,cycleGeneration:probe.cycleGeneration,result:.bridge_failure)}
        }
        let now = Date().timeIntervalSince1970 * 1000
        let recent = recentRecords()
        let lines = recent.prefix(10).map { r -> String in
            let minutes = max(0, Int((now - (r["updatedAt"] as? Double ?? now)) / 60000))
            return "\(r["title"] as? String ?? "") — \(minutes < 60 ? "\(minutes) min" : "\(minutes / 60) h") ago"
        }.joined(separator: "\n")
        listOutput.stringValue = "Recent activity window: 6 h\nReceived conversations: \(discovered.count)\nRecently active chats: \(recent.count)\n\(lines)\nList endpoints: root /backend-api/conversations; project /backend-api/gizmos/:id/conversations\nFields: id / title / update_time"
    }
    func recordRootDocumentSnapshot(_ snapshot:[String:Any]) {
        guard let lifecycle=snapshot["documentLifecycle"] as? [String:Any],
              let origin=(lifecycle["timeOrigin"] as? NSNumber)?.int64Value else{return}
        let key=String(origin)
        cycleRootDocumentSnapshots[key]=snapshot
        if cycleRootDocumentSnapshots.count>4 {
            for oldKey in cycleRootDocumentSnapshots.keys.sorted().prefix(cycleRootDocumentSnapshots.count-4) {
                cycleRootDocumentSnapshots.removeValue(forKey:oldKey)
            }
        }
    }
    func recordRootTriggerDelegate(_ stage:String,navigation:WKNavigation!,failed:Bool=false) {
        guard cycleRootTriggerStarted,let active=cycleRootNavigation,navigation===active else{return}
        cycleRootDelegateEvents.append(stage)
        cycleRootLatestRoute=safeNavigationRouteTemplate(web.url)
        cycleRootLatestLoading=web.isLoading;cycleRootLatestProgress=web.estimatedProgress
        if cycleRootLatestRoute != cycleRootRouteBefore || web.isLoading || abs(web.estimatedProgress-cycleRootInitialProgress)>0.005 {cycleRootNavigationObserved=true}
        cycleRootTriggerStage=failed ? "failed":stage
        cycleRootTriggerResult=failed ? stage:"delegate_\(stage)"
        if failed {cycleRootTriggerFailed=true}
        renderCycle()
    }
    func webView(_ webView:WKWebView,didStartProvisionalNavigation navigation:WKNavigation!) {
        if webView===web {recordRootTriggerDelegate("provisional_started",navigation:navigation)}
        if webView===web,let active=chatCheckNavigation,navigation===active {
            if var telemetry=chatCheckTelemetry {telemetry.navigationProvisionalStarted=true;chatCheckTelemetry=telemetry}
            recordChatCheckStage("navigation_started")
        }
        guard let (token,_,_)=isCurrentPinnedNavigation(navigation,webView:webView) else{return}
        pinnedActivityProvisionalStarted=true
        recordPinnedActivityNavigationStage("provisional_navigation_started",token:token)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView===web,let active=chatCheckNavigation,navigation===active,
           let expected=chatCheckExpectedConversationID,
           let generation=chatCheckTelemetry?.operationGeneration {
            let observedURL=webView.url
            recordPersistedChatCheckTrace(stage:.navigationFinished,result:.success,reason:.navigationFinished,
                                          generation:generation,url:observedURL)
            let routeMatches=conversationID(in:webView.url)==expected
            recordPersistedChatCheckTrace(stage:.conversationRouteObserved,result:routeMatches ? .success:.failure,
                                          reason:routeMatches ? .expectedRoute:(sanitizedChatCheckRoute(observedURL).template=="home" ? .unexpectedRoute:.conversationRouteNotObserved),
                                          generation:generation,url:observedURL)
            webView.evaluateJavaScript("document.readyState") { [weak self] value,error in
                DispatchQueue.main.async {
                    guard let self else{return}
                    let ready=error==nil && (value as? String)=="complete"
                    self.recordPersistedChatCheckTrace(stage:.documentReady,result:ready ? .success:.failure,
                        reason:error != nil ? .documentEvaluationFailed:(ready ? .documentComplete:.documentNotReady),
                        generation:generation,url:observedURL)
                }
            }
            if routeMatches {
                navigationFinished=true
                if var telemetry=chatCheckTelemetry {telemetry.routeReached=true;chatCheckTelemetry=telemetry}
                recordChatCheckStage("route_reached")
            }
        }
        if webView===web {recordRootTriggerDelegate("finished",navigation:navigation)}
        if webView===web,let active=cyclePinnedNavigation,navigation===active {cyclePinnedNavigationFinished=true}
        if let (token,id,ordinal)=isCurrentPinnedNavigation(navigation,webView:webView) {
            pinnedActivityNavigationFinished=true
            recordPinnedActivityNavigationStage("navigation_finished",token:token)
            guard let template=conversationRouteTemplate(webView.url?.path ?? ""),conversationID(in:webView.url)==id else {
                finishPinnedActivityFallback(state:.error,reason:"route_mismatch",token:token,id:id,ordinal:ordinal);return
            }
            confirmPinnedActivityRoute(token:token,id:id,ordinal:ordinal,template:template,source:"navigation_finished")
        }
        if !listDiagnosticMode.isEmpty {webView.evaluateJavaScript("window.gptListDiagnosticSnapshot?.()",completionHandler:nil)}
        if let path = webView.url?.path, path.contains("/auth/") || webView.url?.host == "auth.openai.com" {
            output.stringValue = "Authentication page detected; sign in manually. Session expiry/logout suspected."
        }
    }
    func webView(_ webView:WKWebView,didCommit navigation:WKNavigation!) {
        if webView===web {recordRootTriggerDelegate("committed",navigation:navigation)}
        if webView===web,let active=chatCheckNavigation,navigation===active {recordChatCheckStage("navigation_committed")}
        guard let (token,_,_)=isCurrentPinnedNavigation(navigation,webView:webView) else{return}
        pinnedActivityNavigationCommitted=true
        pinnedActivityRouteLoaded=true
        recordPinnedActivityNavigationStage("navigation_committed",token:token)
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView===web {recordRenderReadinessNavigationFailure(error)}
        if webView===web {recordRootTriggerDelegate("provisional_failed",navigation:navigation,failed:true)}
        if webView===web,let active=chatCheckNavigation,navigation===active {
            if let generation=chatCheckTelemetry?.operationGeneration {
                recordPersistedChatCheckTrace(stage:.navigationFinished,result:.failure,reason:.navigationFailed,generation:generation)
            }
            recordChatCheckStage("navigation_provisional_failed")
        }
        if let (token,id,ordinal)=isCurrentPinnedNavigation(navigation,webView:webView) {
            pinnedActivityNavigationError=navigationErrorSummary(error)
            recordPinnedActivityNavigationStage("navigation_provisional_failed",token:token)
            finishPinnedActivityFallback(state:.error,reason:"navigation_provisional_failed",token:token,id:id,ordinal:ordinal);return
        }
        if webView===web,let active=cyclePinnedNavigation,navigation===active {cyclePinnedNavigationError=error}
        output.stringValue = "Navigation failed (code \((error as NSError).code)); session/capture unconfirmed."
    }
    func webView(_ webView:WKWebView,didFail navigation:WKNavigation!,withError error:Error) {
        if webView===web {recordRenderReadinessNavigationFailure(error)}
        if webView===web {recordRootTriggerDelegate("failed",navigation:navigation,failed:true)}
        if webView===web,let active=chatCheckNavigation,navigation===active {
            if let generation=chatCheckTelemetry?.operationGeneration {
                recordPersistedChatCheckTrace(stage:.navigationFinished,result:.failure,reason:.navigationFailed,generation:generation)
            }
            recordChatCheckStage("navigation_failed")
        }
        if let (token,id,ordinal)=isCurrentPinnedNavigation(navigation,webView:webView) {
            pinnedActivityNavigationError=navigationErrorSummary(error)
            recordPinnedActivityNavigationStage("navigation_failed",token:token)
            finishPinnedActivityFallback(state:.error,reason:"navigation_failed",token:token,id:id,ordinal:ordinal)
        }
        if webView===web,let active=cyclePinnedNavigation,navigation===active {cyclePinnedNavigationError=error}
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // Authentication providers may require a user-initiated secondary window.
        let child = WKWebView(frame: NSRect(x: 0, y: 0, width: 900, height: 700), configuration: configuration)
        child.uiDelegate = self
        let window = NSWindow(contentRect: child.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        window.title = "ChatGPT sign-in"; window.contentView = child; window.isReleasedWhenClosed = false
        authWindows.append(window)
        let userInitiated = NSApp.isActive && session.isKeyWindow && !cycleRunning && backgroundRenderLease==nil && manualDiagnosticOwnerLabel()==nil
        if userInitiated {_=presentWindow(window,intent:.userInitiated,callSite:"user_opened_webkit_child_window")}
        return child
    }
    func webViewDidClose(_ webView: WKWebView) { webView.window?.orderOut(nil) }
}
@main struct PrototypeMain {
 static func main() {
  if CommandLine.arguments.dropFirst().contains("--inspect-last-cycle") {print(inspectLastCycleTerminalSnapshot());return}
  if CommandLine.arguments.dropFirst().contains("--inspect-single-instance") {print(SingleInstanceLock.inspect(bundleIdentifier:"com.alexandrast.gptlimitstool").output);return}
  let id=RuntimeIdentity.make(buildMarker:gptLimitsExecutableBuildIDMarker,bundle:.main)
  let ownerMetadata=SingleInstanceOwnerMetadata(buildID:id.buildID,bundlePath:id.bundlePath,executablePath:id.executablePath,bundleID:id.bundleID,version:id.version,launchTimestamp:ISO8601DateFormatter().string(from:Date()))
  let acquire=SingleInstanceLock.acquire(bundleIdentifier:"com.alexandrast.gptlimitstool",ownerMetadata:ownerMetadata)
  switch acquire {
  case .acquired(let lock):
   let didBootstrap=SingleInstanceStartup.run(lock:lock,activateExisting:{}) {
    let app=NSApplication.shared
    let delegate=Prototype()
    app.setActivationPolicy(.accessory)
    app.delegate=delegate
    withExtendedLifetime((lock,delegate)){app.run()}
   }
   if !didBootstrap {exit(EXIT_SUCCESS)}
  case .contended:
   let existing=NSRunningApplication.runningApplications(withBundleIdentifier:"com.alexandrast.gptlimitstool").first
   let diagnostic=SecondaryInstanceDiagnostic(requestedBundlePath:Bundle.main.bundleURL.path,bundleID:Bundle.main.bundleIdentifier,existingBundleURL:existing?.bundleURL)
   NSLog("GPT Limits Tool startup diagnostic: %@",diagnostic.diagnosticsText)
   existing?.activate(options:[])
   exit(EXIT_SUCCESS)
  case .failed(let error):
   let name:[Int32:String]=[EPERM:"EPERM",EACCES:"EACCES",EINVAL:"EINVAL",EBADF:"EBADF"]
   fputs("single_instance_lock_failed\nerrno=\(error)\nerrno_name=\(name[error] ?? "UNKNOWN")\n",stderr)
   exit(EXIT_FAILURE)
  }
 }
}

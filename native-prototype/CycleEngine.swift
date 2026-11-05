import AppKit
import WebKit
import UserNotifications
extension Prototype {
 func migrateBundleIdentityDefaultsAtStartup()->String {
  let defaults=UserDefaults.standard
  guard let currentDomainName=Bundle.main.bundleIdentifier,!currentDomainName.isEmpty else {
   return "failed · current_bundle_id_unavailable"
  }
  let current=defaults.persistentDomain(forName:currentDomainName) ?? [:]
  let legacy=defaults.persistentDomain(forName:legacyBundleIdentityDefaultsDomain) ?? [:]
  let plan=bundleIdentityMigrationPlan(legacy:legacy,current:current)
  if let failure=plan.failureReason {
   defaults.set(failure,forKey:bundleIdentityMigrationFailureKey)
   _=defaults.synchronize()
   return "failed · \(failure)"
  }
  for (key,value) in plan.valuesToWrite {defaults.set(value,forKey:key)}
  _=defaults.synchronize()
  let saved=defaults.persistentDomain(forName:currentDomainName) ?? [:]
  let writesVerified=plan.valuesToWrite.allSatisfy {key,value in
   guard let persisted=saved[key] else{return false}
   if let expected=value as? Data,let actual=persisted as? Data {return expected==actual}
   return (persisted as? NSObject)?.isEqual(value) ?? false
  }
  guard writesVerified else {
   let failure="destination_write_verification_failed"
   defaults.set(failure,forKey:bundleIdentityMigrationFailureKey);_=defaults.synchronize()
   return "failed · \(failure)"
  }
  defaults.removeObject(forKey:bundleIdentityMigrationFailureKey)
  if plan.shouldSetCompletionMarker {
   defaults.set(true,forKey:bundleIdentityMigrationMarkerKey)
   _=defaults.synchronize()
   guard defaults.persistentDomain(forName:currentDomainName)?[bundleIdentityMigrationMarkerKey] as? Bool == true else {
    let failure="completion_marker_write_failed"
    defaults.set(failure,forKey:bundleIdentityMigrationFailureKey);_=defaults.synchronize()
    return "failed · \(failure)"
   }
  }
  return plan.status.rawValue
 }
 func saveCycle() { if let data=try? JSONEncoder().encode(cycleState) {UserDefaults.standard.set(data,forKey:nativeCycleStateDefaultsKey)} }
 func restoreCycle() {
  if let data=UserDefaults.standard.data(forKey:nativeCycleStateDefaultsKey),let saved=try? JSONDecoder().decode(CycleState.self,from:data){cycleState=saved}
  let nowMs=Date().timeIntervalSince1970*1000
  _=reconcilePersistentUncertainState(nowMs:nowMs)
  let previousCoverageComplete=cycleState.lastCoverageStatus == .completeAccount || cycleState.lastCoverageStatus == .completeNonArchived
  if !previousCoverageComplete && isMonitoringDiscoveryFailure(cycleState.lastCoverageDetail) {
   cycleState.monitoringDegraded=true
   saveCycle()
  }
  var interruptedDispatch=false
  if var audit=cycleState.notificationAudit {
   for index in audit.indices where ["pending","attempted"].contains(audit[index].outcome) && nowMs-audit[index].createdAt>120000 {
    audit[index].outcome="interrupted"
    interruptedDispatch=true
   }
   cycleState.notificationAudit=audit
  }
  if cycleState.lastCycleNotificationsAccepted == nil,let started=cycleState.lastCycleAt,cycleState.notificationAudit?.isEmpty == false {
   let latest=(cycleState.notificationAudit ?? []).filter{$0.createdAt>=started.timeIntervalSince1970*1000}
   cycleState.lastCycleNotificationsAccepted=latest.filter{$0.outcome=="accepted"}.count
   cycleState.lastCycleNotificationsSuppressed=latest.filter{["add_error","permission_denied","interrupted"].contains($0.outcome)}.count
   if let range=cycleState.lastStatus.range(of:"Notifications generated/suppressed: [0-9]+/[0-9]+",options:.regularExpression) {
    cycleState.lastStatus.replaceSubrange(range,with:"Notifications generated/suppressed: \(cycleState.lastCycleNotificationsAccepted ?? 0)/\(cycleState.lastCycleNotificationsSuppressed ?? 0)")
   }
   interruptedDispatch=true
  }
  let needsProvenanceMigration=(cycleState.lastSeenProvenanceSchemaVersion ?? 0) < 1
  if needsProvenanceMigration {cycleState.lastSeenProvenanceSchemaVersion=1}
  // A past deadline is advanced, never executed as a startup side effect.
  cycleState.recoverSchedule(now:Date())
  scheduleCycle();if needsProvenanceMigration || interruptedDispatch {saveCycle()};renderCycle()
 }
 func scheduleCycle() {
  cycleScheduler.cancel()
  guard cycleState.enabled, let next=cycleState.nextRun else{return}
  cycleScheduler.schedule(at:next){[weak self] in self?.startCycle(trigger:"automatic")}
  saveCycle()
 }
 func reconcilePersistentUncertainState(nowMs:Double)->Bool {
  let model=currentRiskModel();var changed=false
  for id in Array(cycleState.records.keys) {
   guard var record=cycleState.records[id] else{continue}
   let completeAndCurrent=riskMeasurementStatus(result:record.lastCheckResult,aggregate:record.aggregate) == .complete && record.lastCheckedUpdatedAt != nil && record.lastSeenUpdatedAt<=record.lastCheckedUpdatedAt!
   if completeAndCurrent {
    if record.uncertainSince != nil {record.uncertainSince=nil;changed=true}
    if record.uncertainAcknowledgedAt != nil {record.uncertainAcknowledgedAt=nil;changed=true}
   } else if monitoringState(record:record,model:model,nowMs:nowMs) == .uncertain,record.uncertainSince == nil {
    record.uncertainSince=record.lastCheckAt ?? record.lastUncertainNotificationAt ?? record.lastSeenUpdatedAt
    changed=true
   }
   if let acknowledged=record.uncertainAcknowledgedAt,record.lastSeenUpdatedAt>acknowledged {
    record.uncertainAcknowledgedAt=nil;changed=true
   }
   cycleState.records[id]=record
  }
  if changed {saveCycle()}
  return changed
 }
 @objc func toggleAutomatic() {
  cycleState.enabled.toggle();cycleState.nextRun=cycleState.enabled ? nextDiscoveryRun(after:Date()):nil
  if !cycleState.enabled {cycleTask?.cancel()}
  scheduleCycle();renderCycle()
 }
 func renderCycle() {
  updateRiskReport()
  let fmt=DateFormatter();fmt.timeStyle = .short
  let nextLabel = cycleRunning && cycleState.enabled ? "After current cycle +30 min" : (cycleState.nextRun.map{fmt.string(from:$0)} ?? "Off")
  let rateLimited=cycleRootStatuses.contains(429) || (!cycleRunning && (cycleState.discoveryStatus == .rateLimited || cycleState.lastStatus.contains("root_http_429")))
  let discoveryLabel=rateLimited ? "Rate limited (HTTP 429)" : (cycleState.discoveryStatus?.rawValue ?? "not_run")
  let successfulDiscovery=cycleState.lastSuccessfulDiscoveryAt.map{fmt.string(from:$0)} ?? "Never"
  let visibleDiscoveryLabel = rateLimited ? "Rate limited (HTTP 429)" : (cycleRunning && cycleDiscovering ? "in_progress" : discoveryLabel)
  let discoveryLine="Discovery: \(visibleDiscoveryLabel)\nLast successful discovery: \(successfulDiscovery)\nHTTP 429 stops this cycle; the next normal tick performs fresh discovery"
  let activeCheck=cycleRunning ? chatCheckTelemetry?.report(ordinal:cycleCurrentChatCheckOrdinal,terminal:"in_progress") : nil
  let checkDetails=(activeCheck.map{"\nActive per-chat check:\n"+$0} ?? "")+(chatCheckReports.isEmpty ? "" : "\nPer-chat checks:\n"+chatCheckReports.joined(separator:"\n"))
  lastChatCheckTraceOutput.stringValue=cycleState.lastChatCheckTrace?.displayText ?? "Last standard chat check trace: not recorded"
  updateCurrentCycleSummary()
  cycleOutput.stringValue="Automatic checks: \(cycleState.enabled ? "On":"Off") · Interval: 30 min\n\(cycleRunning ? "Cycle running… \(cyclePhase)":cycleState.lastStatus)\n\(discoveryLine)\nNext cycle: \(nextLabel)\n"+cycleCoverageReport+checkDetails
  updateRuntimeIdentity()
  renderUserUI()
 }
 func setCycleScripts(token:String?,secret:String? = nil) {
  let controller=web.configuration.userContentController
  controller.removeAllUserScripts()
  var prefix=""
  if let token,let secret,let data=try? JSONSerialization.data(withJSONObject:["token":token,"secret":secret]),let json=String(data:data,encoding:.utf8) {
   let tokenData=try? JSONSerialization.data(withJSONObject:[token]),tokenJSON=tokenData.flatMap{String(data:$0,encoding:.utf8)} ?? "[]"
   prefix="if(location.origin==='https://chatgpt.com'){window.gptListCycleConfig=\(json);window.gptRateLimitContext={owner:'scheduler_discovery',generation:\(tokenJSON)[0],stage:'scheduler_discovery'};};\n"
  }
  controller.addUserScript(WKUserScript(source:prefix+runtimeScripts,injectionTime:.atDocumentStart,forMainFrameOnly:true))
 }
 func consumeDiscoveryPage(_ data:[String:Any],records:[[String:Any]]) {
  guard data["cycleToken"] as? String == cycleToken,!cycleToken.isEmpty,!discoveryRateLimited(Array(cycleRootStatuses)) else{return}
  let scope=ListScope(rawValue:data["scope"] as? String ?? "") ?? .unclassified
  let offset=(data["offset"] as? NSNumber)?.intValue
  var descriptorLabel=""
  var decodedDescriptor:PartitionDescriptor?
  if scope != .project,let raw=data["partitionDescriptor"] as? [String:Any] {
   decodedDescriptor=PartitionDescriptor.decode(raw,registry:&cycleOrigins)
   descriptorLabel=decodedDescriptor?.text ?? "invalid"
  } else if scope != .project {descriptorLabel="invalid"}
  let endpointClass=scope == .project ? "project-conversations" : "root-conversations"
  guard let signature=logicalDiscoveryPageSignature(endpointClass:endpointClass,partition:descriptorLabel,offset:offset,
    cursorPresent:(data["cursorPresent"] as? Bool)==true,records:records),cyclePageKeys.insert(signature).inserted else{return}
  cycleValidListResponses+=1
  cycleState.merge(records,source:scope == .project ? .projectConversationUpdateTime:.rootConversationUpdateTime)
  let ids=Set(records.compactMap{$0["conversationId"] as? String})
  let newIdentityCount=ids.subtracting(cycleIds).count
  cycleIds.formUnion(ids);cycleListVersion+=1
  if scope == .project {
   cycleProjectIds.formUnion(ids)
   let stream=(data["streamId"] as? NSNumber)?.intValue ?? 0
   cycleProjectStreams.insert(stream)
   cycleProjectPages+=1
  } else {
   cycleRootResponseReceived=true
   cycleRootLastPageRelativeMs=(data["relativeMs"] as? NSNumber)?.intValue
   cycleRootLastPageOffset=offset
   cycleRootLastPageNewIdentities=newIdentityCount
   if newIdentityCount>0 {cycleRootLastIdentityProgressRelativeMs=cycleRootLastPageRelativeMs;cycleRootLastIdentityProgressOffset=offset}
   guard let descriptor=decodedDescriptor else {
    cyclePhase="Invalid sanitized partition descriptor";renderCycle();return
   }
   var observation=cyclePartitions[descriptor] ?? PartitionObservation(descriptor:descriptor)
   var page=CoveragePage(scope:.filtered,streamId:0,sequence:observation.pages.count+1,
     paginationKind:paginationKind(offset:offset,cursorPresent:(data["cursorPresent"] as? Bool)==true),offset:offset,
     limit:(data["limit"] as? NSNumber)?.intValue,
     cursorPresent:(data["cursorPresent"] as? Bool)==true,cursorNull:(data["cursorNull"] as? Bool)==true,
     cursorType:data["cursorType"] as? String ?? "undefined",itemCount:(data["itemCount"] as? NSNumber)?.intValue ?? -1,
     timestampsValid:(data["timestampsValid"] as? Bool)==true,times:data["pageTimes"] as? [Double] ?? [])
   page.requestCursorPresent=(data["requestCursorPresent"] as? Bool)==true
   page.sortOrder=data["sortOrder"] as? String
   page.httpStatus=(data["httpStatus"] as? NSNumber)?.intValue
   page.recordCountMatches=records.count==page.itemCount && ids.count==records.count && ids.allSatisfy{$0.range(of:"^[A-Za-z0-9-]+$",options:.regularExpression) != nil}
   _=observation.append(page,records:records)
   cyclePartitions[descriptor]=observation
   let pageRelativeMs=(data["relativeMs"] as? NSNumber)?.intValue ?? -1
   let responseOffset=(data["responseOffset"] as? NSNumber)?.intValue ?? offset
   let expectedNextOffset=(data["expectedNextOffset"] as? NSNumber)?.intValue
   let baseCompleteNow=hasCompletePartitionSet(Array(cyclePartitions.values),base:PartitionDescriptor(archived:false,starred:false),cutoff:cycleCutoffTimestamp)
   let nativeDecision=baseCompleteNow ? "stop_coverage_complete":"waiting_frontend"
   let pageEvent:[String:Any]=["relativeMs":pageRelativeMs,"partitionShape":data["partitionShape"] as? String ?? "unknown",
   "requestOffset":offset.map{$0 as Any} ?? NSNull(),"responseOffset":responseOffset as Any,"expectedNextOffset":expectedNextOffset.map{$0 as Any} ?? NSNull(),
    "itemCount":(data["itemCount"] as? NSNumber)?.intValue ?? -1,"httpStatus":(data["httpStatus"] as? NSNumber)?.intValue ?? -1,
    "newIdentityCount":newIdentityCount,"frontendHint":(data["paginationHint"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown",
    "frontendDecision":data["frontendPageDecision"] as? String ?? "unknown","nativeDecision":nativeDecision]
   cycleRootAcceptedPageEvents.append(pageEvent);if cycleRootAcceptedPageEvents.count>40{cycleRootAcceptedPageEvents.removeFirst()}
  }
  updatePartitionReport();renderCycle()
 }
 func rootDiscoverySnapshotScript(attachContext:Bool)->String? {
  guard let tokenData=try? JSONSerialization.data(withJSONObject:[cycleToken]),let tokenJSON=String(data:tokenData,encoding:.utf8),
        let configData=try? JSONSerialization.data(withJSONObject:["token":cycleToken,"secret":cycleScriptSecret]),
        let configJSON=String(data:configData,encoding:.utf8) else{return nil}
  let attach=attachContext ? "if(location.origin==='https://chatgpt.com'){window.gptListCycleConfig=\(configJSON);window.gptRateLimitContext={owner:'scheduler_discovery',generation:\(tokenJSON)[0],stage:'scheduler_discovery'};}" : ""
  return """
  (()=>{const expected=\(tokenJSON)[0];\(attach)
   const hookState=window.gptListRootDiscoveryState?.(expected);if(hookState)return hookState;
   let pathname='/';try{pathname=location.pathname||'/';}catch{}
   const routeTemplate=/^\\/c\\/[^/]+\\/?$/.test(pathname)?'/c/<id>':(/^\\/g\\/[^/]+\\/c\\/[^/]+\\/?$/.test(pathname)?'/g/<id>/c/<id>':(pathname==='/'?'/':'other'));
   let conversationLinks=0,sidebarCandidates=0;try{conversationLinks=[...document.querySelectorAll('a[href]')].filter(a=>{try{const u=new URL(a.href,location.href);return u.origin===location.origin&&(/^\\/c\\/[^/]+\\/?$/.test(u.pathname)||/^\\/g\\/[^/]+\\/c\\/[^/]+\\/?$/.test(u.pathname));}catch{return false;}}).length;sidebarCandidates=document.querySelectorAll('nav,aside,[role="navigation"]').length;}catch{}
   const navigation=performance.getEntriesByType?.('navigation')?.[0];
   return {routeTemplate,documentReadyState:document.readyState||'unknown',bodyPresent:!!document.body,sidebarAvailable:sidebarCandidates>0,sidebarCandidates,conversationLinks,
    documentLifecycle:{timeOrigin:Number.isFinite(performance.timeOrigin)?Math.round(performance.timeOrigin):null,navigationType:['navigate','reload','back_forward'].includes(navigation?.type)?navigation.type:'unknown',navigationResponseStatus:Number.isInteger(navigation?.responseStatus)&&navigation.responseStatus>=100&&navigation.responseStatus<=599?navigation.responseStatus:null,pageshowPersisted:null,documentAgeMs:Number.isFinite(performance.now?.())?Math.max(0,Math.round(performance.now())):null},
    rootBackendTraffic:null,
    rootListHookInstalled:false,fetchHookInstalled:window.fetch?.__gptListDiagnosticWrapper===true,
    xhrOpenHookInstalled:XMLHttpRequest.prototype.open?.__gptListDiagnosticWrapper===true,xhrSendHookInstalled:XMLHttpRequest.prototype.send?.__gptListDiagnosticWrapper===true,
    generationAttached:window.gptListCycleConfig?.token===expected};})()
  """
 }
 func enrichNativeRootSidebarCacheSummary() async {
  guard let raw=try? await evaluateForCycle("window.gptRootSidebarConversationIds?.()||[]"),
        let ids=raw as? [String],!ids.isEmpty else {
   cycleRootPostflight["nativeCachedMetadata"]=["matchedRows":0,"timestampAvailable":0,"freshWithinSixHours":0,
    "trustedProvenance":0,"legacyUnknownProvenance":0,"freshMetadataObservations":0,"staleMetadataObservations":0,
    "source":"ChatRecord.lastSeenUpdatedAt","sourceProvenanceAvailable":true]
   return
  }
  let now=Date().timeIntervalSince1970*1000,unique=Set(ids)
  let matched=unique.compactMap{cycleState.records[$0]}
  let timestamps=matched.map(\.lastSeenUpdatedAt).filter{$0.isFinite&&$0>0&&$0<=now}
  let provenance=cachedActivityProvenanceSummary(matched,now:now)
  let ages=timestamps.map{max(0,now-$0)/60000}
  cycleRootPostflight["nativeCachedMetadata"]=[
   "matchedRows":matched.count,"timestampAvailable":timestamps.count,
   "freshWithinSixHours":timestamps.filter{now-$0<=21600000}.count,
   "trustedProvenance":provenance.trusted,"legacyUnknownProvenance":provenance.legacyOrUnknown,
   "freshMetadataObservations":provenance.freshObservations,"staleMetadataObservations":provenance.staleObservations,
   "ageMinMinutes":ages.min().map{Int($0.rounded())} as Any? ?? NSNull(),
   "ageMaxMinutes":ages.max().map{Int($0.rounded())} as Any? ?? NSNull(),
   "source":"ChatRecord.lastSeenUpdatedAt","sourceProvenanceAvailable":true]
 }
 func collectVisibleSidebarDOMFallbackIfNeeded() async -> Bool {
  guard cycleValidListResponses==0,!cycleRootResponseReceived,!discoveryRateLimited(Array(cycleRootStatuses)),
        cycleRootPostflight["routeTemplate"] as? String == "/",
        backgroundRenderLeaseReadiness["ready"] as? Bool == true,
        ((backgroundRenderLeaseReadiness["firstPositiveCount"] as? NSNumber)?.intValue ?? 0) > 0,
        ((backgroundRenderLeaseReadiness["finalStableCount"] as? NSNumber)?.intValue ?? 0) > 0,
        backgroundRenderLeaseReadiness["sidebarRegionFound"] as? Bool == true else {return false}
  guard let raw=try? await evaluateForCycle("window.gptCollectVisibleSidebarDOMFallback?.()||null"),
        let result=raw as? [String:Any],result["status"] as? String == "ok" else {return false}
  func count(_ key:String)->Int {max(0,min(10_000,(result[key] as? NSNumber)?.intValue ?? 0))}
  let rawIDs=result["conversationIds"] as? [String] ?? []
  let ids=Array(Set(rawIDs.filter{$0.range(of:"^[A-Za-z0-9-]{1,128}$",options:.regularExpression) != nil})).sorted().prefix(200)
  cycleDOMCandidateCount=count("candidateCount")
  cycleDOMAcceptedRowCount=ids.count
  cycleDOMRejectedNavigationRowCount=count("rejectedNavigationRowCount")
  cycleDOMDuplicateRowCount=count("duplicateRowCount")
  guard !ids.isEmpty else{return false}
  cycleDOMFallbackIds=Set(ids)
  cycleDiscoverySource="dom_fallback"
  cycleIds.formUnion(ids)
  cycleRootStallDetail="dom_fallback_visible_sidebar_rows_only"
  return true
 }
 func rootSidebarMetadataLine()->String {
  let metadata=cycleRootPostflight["sidebarMetadata"] as? [String:Any] ?? [:]
  let cache=cycleRootPostflight["nativeCachedMetadata"] as? [String:Any] ?? [:]
  func count(_ source:[String:Any],_ key:String)->Int{(source[key] as? NSNumber)?.intValue ?? 0}
  func yes(_ source:[String:Any],_ key:String)->String{(source[key] as? Bool)==true ? "yes":"no"}
  guard !metadata.isEmpty else{return "Root sidebar metadata: not_observed"}
  let rows=count(metadata,"renderedRows"),visible=count(metadata,"visibleRows")
  let fields=(metadata["timestampFields"] as? [[String:Any]] ?? []).prefix(20).map{field -> String in
   let name=field["field"] as? String ?? "unknown",type=field["valueType"] as? String ?? "unknown"
   let values=(field["normalizedTimestamps"] as? [String] ?? []).filter{ISO8601DateFormatter().date(from:$0) != nil}.prefix(6).joined(separator:",")
   return "\(name) · \(type) · rows \(count(field,"rowsWithValue"))/\(rows) · activity \(yes(field,"activityRelevant"))"+(values.isEmpty ? "":" · \(values)")
  }.joined(separator:"; ")
  let groups=(metadata["sectionGroups"] as? [[String:Any]] ?? []).compactMap{item -> String? in
   guard let category=item["category"] as? String,["today","yesterday","previous_7_days","previous_30_days","older"].contains(category) else{return nil}
   return "\(category):\(count(item,"rows"))"
  }.joined(separator:",")
  func flag(_ key:String)->String {
   let value=metadata[key] as? [String:Any] ?? [:]
   return "\(yes(value,"available")) (positive \(count(value,"rowsWithPositiveMarker")), negative \(count(value,"rowsWithNegativeMarker")), fields \((value["fieldNames"] as? [String] ?? []).joined(separator:",")))"
  }
  let age="\(cache["ageMinMinutes"] ?? "—")–\(cache["ageMaxMinutes"] ?? "—") min"
  let scroll=metadata["scrollGeometry"] as? [String:Any] ?? [:]
  let scrollSummary=scroll.isEmpty ? "unavailable":"top \(scroll["scrollTop"] ?? "?") · height \(scroll["scrollHeight"] ?? "?") · viewport \(scroll["clientHeight"] ?? "?") · range \(scroll["scrollRangePx"] ?? "?") · at extent \(yes(scroll,"atScrollExtent"))"
  return "Root sidebar metadata: active rendered rows \(rows) · visible \(visible) · internal identity rows \(count(metadata,"rowsWithInternalIdentity"))/\(rows) · identity missing \(count(metadata,"rowsWithoutInternalIdentity")) · DOM order stable \(yes(metadata,"domOrderStable")) · top proof possible \(yes(metadata,"topProofPossible")) (\(metadata["topProofReason"] as? String ?? "unknown")) · exact activity timestamp available \(yes(metadata,"exactActivityMetadataAvailable")) · time rows \(count(metadata,"timeElementRows")) · datetime rows \(count(metadata,"datetimeRows")) · numeric epoch rows \(count(metadata,"numericEpochRows")) · fields [\(fields.isEmpty ? "none":fields)] · data timestamp attrs [\((metadata["dataTimestampAttributeNames"] as? [String] ?? []).joined(separator:","))] · groups [\(groups.isEmpty ? "none":groups)] · pinned/starred \(flag("pinnedStarred")) · archived \(flag("archived")) · locked \(flag("locked")) · order attrs [\((metadata["orderIndexAttributeNames"] as? [String] ?? []).joined(separator:","))] · rows with order index \(count(metadata,"rowsWithOrderIndex")) · before first visible \(count(metadata,"rowsBeforeFirstVisible")) · virtual offset \(yes(metadata,"virtualOffsetEvidence")) · scroll owner \(yes(metadata,"scrollableAncestorFound")) · scroll geometry [\(scrollSummary)] · end-of-list proof \(metadata["endOfListProof"] as? String ?? "unavailable")\nNative cached metadata for same rows: matched \(count(cache,"matchedRows")) · timestamps \(count(cache,"timestampAvailable")) · fresh within 6 h \(count(cache,"freshWithinSixHours")) · trusted provenance \(count(cache,"trustedProvenance")) · legacy/unknown provenance \(count(cache,"legacyUnknownProvenance")) · fresh observations \(count(cache,"freshMetadataObservations")) · stale observations \(count(cache,"staleMetadataObservations")) · age \(age) · source \(cache["source"] as? String ?? "unavailable") · source provenance recorded \(yes(cache,"sourceProvenanceAvailable"))"
 }
 func refreshCycleRootNavigationSnapshot() {
  guard cycleRootTriggerStarted else{return}
  cycleRootLatestRoute=safeNavigationRouteTemplate(web.url)
  cycleRootLatestLoading=web.isLoading;cycleRootLatestProgress=web.estimatedProgress
  if cycleRootLatestRoute != cycleRootRouteBefore || cycleRootLatestLoading || abs(cycleRootLatestProgress-cycleRootInitialProgress)>0.005 {
   cycleRootNavigationObserved=true
  }
 }
 func cycleRootTerminalReasonForCurrentState()->String {
  let hook = !cycleRootHookHealth.isEmpty ? cycleRootHookHealth:cycleRootPostflight
  return rootDiscoveryTerminalReason(RootDiscoveryEvidence(
   triggerStarted:cycleRootTriggerStarted,loadReturnedNavigation:cycleRootLoadReturnedNavigation,
   navigationObserved:cycleRootNavigationObserved || cycleRootRequests>0 || cycleRootResources>0,triggerFailed:cycleRootTriggerFailed,
   hookHealthAvailable:!hook.isEmpty,hookObjectPresent:(hook["rootListHookInstalled"] as? Bool)==true,
   fetchHookActive:(hook["fetchHookInstalled"] as? Bool)==true,
   xhrOpenHookActive:(hook["xhrOpenHookInstalled"] as? Bool)==true,
   xhrSendHookActive:(hook["xhrSendHookInstalled"] as? Bool)==true,
   generationAttached:(hook["generationAttached"] as? Bool)==true,
   hookRequests:cycleRootRequests,hookResponses:cycleRootResponses,recognizedResponses:cycleRootRecognized,
   resourceRequests:cycleRootResources,resourceResponses:cycleRootResourceResponses,
   postTriggerConversationLinks:(cycleRootPostflight["conversationLinks"] as? NSNumber)?.intValue ?? 0))
 }
 func rootDocumentTelemetryLine()->String {
  let families=["root_conversation_list","project_conversation_list","conversation_messages","conversation_detail","other_chatgpt_backend"]
  let documents=cycleRootDocumentSnapshots.keys.sorted().compactMap{cycleRootDocumentSnapshots[$0]}
  guard !documents.isEmpty else{return "Root document telemetry: unavailable"}
  let summaries=documents.enumerated().map{index,state -> String in
   let lifecycle=state["documentLifecycle"] as? [String:Any] ?? [:]
   let navigation=lifecycle["navigationType"] as? String ?? "unknown"
   let navStatus=(lifecycle["navigationResponseStatus"] as? NSNumber).map{String($0.intValue)} ?? "unknown"
   let persisted=(lifecycle["pageshowPersisted"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"
   let age=(lifecycle["documentAgeMs"] as? NSNumber).map{"\($0.intValue/1000)s"} ?? "unknown"
   let traffic=state["rootBackendTraffic"] as? [String:Any] ?? [:]
   let details=families.compactMap{family -> String? in
    guard let channels=traffic[family] as? [String:Any] else{return nil}
    let channelLines=["fetch","XHR","resource"].compactMap{channel -> String? in
     guard let counts=channels[channel] as? [String:Any] else{return nil}
     let requests=(counts["requests"] as? NSNumber)?.intValue ?? 0
     let responses=(counts["responses"] as? NSNumber)?.intValue ?? 0
     let failures=(counts["failures"] as? NSNumber)?.intValue ?? 0
     let zero=(counts["zeroTransfer"] as? NSNumber)?.intValue ?? 0
     let statuses=(counts["statuses"] as? [String:Any] ?? [:]).keys.sorted().compactMap{key -> String? in
      guard let value=(counts["statuses"] as? [String:Any])?[key] as? NSNumber else{return nil};return "\(key)x\(value.intValue)"
     }.joined(separator:",")
     guard requests+responses+failures>0 else{return nil}
     return "\(channel) \(requests)/\(responses)/\(failures)"+(statuses.isEmpty ? "":" [\(statuses)]")+(zero>0 ? " zero-transfer \(zero)":"")
    }
    return channelLines.isEmpty ? nil:"\(family): "+channelLines.joined(separator:",")
   }.joined(separator:"; ")
   let eventText:([[String:Any]])->[String] = { events in events.suffix(80).map{event -> String in
    let rawPath=event["pathname"] as? String ?? "/unknown"
    let path=rawPath.range(of:"^/[A-Za-z0-9_:/.-]{1,180}$",options:.regularExpression) != nil ? rawPath:"/redacted"
    let rawMethod=event["method"] as? String ?? "UNKNOWN",method=["GET","POST","PUT","PATCH","DELETE","OPTIONS","HEAD","UNKNOWN"].contains(rawMethod) ? rawMethod:"UNKNOWN"
    let rawTransport=event["transport"] as? String ?? "unknown",transport=String(rawTransport.filter{$0.isLetter || $0.isNumber || $0==":" || $0=="_" || $0=="-"}.prefix(24))
    let time=(event["relativeMs"] as? NSNumber)?.intValue ?? -1
    let status=(event["status"] as? NSNumber)?.intValue
    let itemCount=(event["itemCount"] as? NSNumber)?.intValue
    let partition=event["partition"] as? [String:Any] ?? [:]
    let archived=(partition["archived"] as? Bool).map{String($0)} ?? "?"
    let starred=(partition["starred"] as? Bool).map{String($0)} ?? "?"
    let offset=(partition["offset"] as? NSNumber).map{String($0.intValue)} ?? "?"
    let responseOffset=(event["responseOffset"] as? NSNumber).map{String($0.intValue)}
    let expectedOffset=(event["expectedNextOffset"] as? NSNumber).map{String($0.intValue)}
    let hint=(event["paginationHint"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"
    let decision=String((event["pageDecision"] as? String ?? "").prefix(32))
    let category=String((event["category"] as? String ?? "unknown").prefix(40))
    let kind=String((event["event"] as? String ?? "unknown").prefix(12))
    let sequence=(event["sequence"] as? NSNumber)?.intValue ?? 0
    let generation=String((event["generation"] as? String ?? "unknown").prefix(16))
    let newIdentities=(event["newIdentityCount"] as? NSNumber).map{String($0.intValue)} ?? "—"
    let pagination=category=="root_conversation_list" ? " reqOffset:\(offset) responseOffset:\(responseOffset ?? "—") items:\(itemCount.map{String($0)} ?? "—") newIDs:\(newIdentities) expectedNext:\(expectedOffset ?? "—") hint:\(hint) decision:\(decision.isEmpty ? "request_observed":decision)":""
    return "#\(sequence) \(kind) \(category) \(method)/\(transport) \(path) +\(time)ms"+(status.map{" HTTP \($0)"} ?? "")+(itemCount.map{" items \($0)"} ?? "")+" partition a:\(archived),s:\(starred),offset:\(offset)\(pagination) gen:\(generation)"
   }}
   let hookEvents=eventText(state["rootHookEvents"] as? [[String:Any]] ?? [])
   let resourceEvents=eventText(state["rootResourceEvents"] as? [[String:Any]] ?? [])
   let sidebarTimeline=(state["rootSidebarTimeline"] as? [[String:Any]] ?? []).suffix(40).compactMap{sample -> String? in
    guard let ms=(sample["relativeMs"] as? NSNumber)?.intValue,let rows=(sample["renderedRows"] as? NSNumber)?.intValue else{return nil}
    let visible=(sample["visibleRows"] as? NSNumber).map{String($0.intValue)} ?? "?"
    let top=(sample["scrollTop"] as? NSNumber).map{String($0.intValue)} ?? "?"
    let range=(sample["scrollRangePx"] as? NSNumber).map{String($0.intValue)} ?? "?"
    let identified=(sample["rowsWithInternalIdentity"] as? NSNumber).map{String($0.intValue)} ?? "?"
    let missing=(sample["rowsWithoutInternalIdentity"] as? NSNumber).map{String($0.intValue)} ?? "?"
    let hidden=(sample["hiddenScrollRangePossible"] as? Bool)==true ? "yes":"no"
    let end=String((sample["endOfListProof"] as? String ?? "unavailable").prefix(32))
    return "+\(ms)ms rows \(rows)/visible \(visible)/identity \(identified) present, \(missing) missing/scroll \(top) of \(range)/hidden-range \(hidden)/end \(end)"
   }.joined(separator:" → ")
   let hookDetail=hookEvents.isEmpty ? "":" · hook events [\(hookEvents.joined(separator:"; "))]"
   let resourceDetail=resourceEvents.isEmpty ? "":" · resource-timing [\(resourceEvents.joined(separator:"; "))]"
   let sidebarDetail=sidebarTimeline.isEmpty ? "":" · sidebar row changes [\(sidebarTimeline)]"
   return "d\(index+1) \(navigation)/http \(navStatus)/pageshow.persisted \(persisted)/age \(age)"+(details.isEmpty ? "":" · \(details)")+hookDetail+resourceDetail+sidebarDetail
  }.joined(separator:" | ")
  return "Root document telemetry (separate hook events and resource timing; resource timing is not response-body proof): \(summaries)"
 }
 func rootDiscoveryProvenanceLine()->String {
  let pre=cycleRootPreflight,post=cycleRootPostflight
  let health=cycleRootHookHealth.isEmpty ? cycleRootPostflight:cycleRootHookHealth
  func yes(_ source:[String:Any],_ key:String)->String {(source[key] as? Bool)==true ? "yes":"no"}
  func count(_ source:[String:Any],_ key:String)->Int {(source[key] as? NSNumber)?.intValue ?? 0}
  func state(_ source:[String:Any])->String {
   guard !source.isEmpty else{return "not_observed"}
   return "route \(source["routeTemplate"] as? String ?? "unknown") · document \(source["documentReadyState"] as? String ?? "unknown") · sidebar \(yes(source,"sidebarAvailable")) (\(count(source,"sidebarCandidates"))) · conversation links \(count(source,"conversationLinks"))"
  }
  let triggerCompleted=cycleRootTriggerStage=="finished"
  let statusCodes=cycleRootStatuses.union(cycleRootResourceStatuses).sorted().map(String.init).joined(separator:",")
  let delegate=cycleRootDelegateEvents.isEmpty ? "none":cycleRootDelegateEvents.joined(separator:",")
  let terminal=cycleRootTerminalReason=="not_run" ? "pending":cycleRootTerminalReason
  let noNetwork=cycleRootRequests==0 && cycleRootResponses==0 && cycleRootResources==0 && cycleRootResourceResponses==0
  let uiWithoutNetwork=noNetwork && count(post,"conversationLinks")>0
  return "Root discovery provenance: root_discovery_stage_started \(cycleRootStageStarted ? "yes":"no") · pre-trigger UI \(state(pre)) · pre-trigger hooks object/fetch/XHR open/send/generation \(yes(pre,"rootListHookInstalled"))/\(yes(pre,"fetchHookInstalled"))/\(yes(pre,"xhrOpenHookInstalled"))/\(yes(pre,"xhrSendHookInstalled"))/\(yes(pre,"generationAttached")) · root_trigger_started \(cycleRootTriggerStarted ? "yes":"no") · method \(cycleRootTriggerMethod) · load returned navigation \(cycleRootLoadReturnedNavigation ? "yes":"no") · trigger result \(cycleRootTriggerResult) · trigger completed/failed \(triggerCompleted ? "yes":"no")/\(cycleRootTriggerFailed ? "yes":"no") · route \(cycleRootRouteBefore) → \(cycleRootRouteImmediatelyAfter) · immediate loading/progress \(cycleRootLoadingImmediatelyAfter ? "yes":"no")/\(String(format:"%.2f",cycleRootProgressImmediatelyAfter)) · latest route/loading/progress \(cycleRootLatestRoute)/\(cycleRootLatestLoading ? "yes":"no")/\(String(format:"%.2f",cycleRootLatestProgress)) · navigation observed \(cycleRootNavigationObserved ? "yes":"no") · delegate \(delegate) · post-trigger UI \(state(post)) · root_ui_data_without_network_response \(uiWithoutNetwork ? "yes":"no") · post-trigger hooks object/fetch/XHR open/send/generation \(yes(health,"rootListHookInstalled"))/\(yes(health,"fetchHookInstalled"))/\(yes(health,"xhrOpenHookInstalled"))/\(yes(health,"xhrSendHookInstalled"))/\(yes(health,"generationAttached")) · requests hook/resource \(cycleRootRequests)/\(cycleRootResources) · responses hook/completed-resource \(cycleRootResponses)/\(cycleRootResourceResponses) · recognized \(cycleRootRecognized) · HTTP [\(statusCodes)] · terminal reason \(terminal)"
 }
 func rootPaginationStallLine()->String {
  let events=(cycleRootPostflight["rootHookEvents"] as? [[String:Any]] ?? []).filter{($0["category"] as? String)=="root_conversation_list"}
  func int(_ event:[String:Any]?,_ key:String)->Int?{(event?[key] as? NSNumber)?.intValue}
  func partitionKey(_ event:[String:Any])->String {
   let partition=event["partition"] as? [String:Any] ?? [:]
   func bool(_ key:String)->String { guard let raw=partition[key],!(raw is NSNull) else{return "omitted"};guard let value=raw as? NSNumber else{return "?"};return value.boolValue ? "true":"false" }
   let include=(partition["includeOriginPresent"] as? Bool)==true,exclude=(partition["excludeOriginPresent"] as? Bool)==true
   return "archived:\(bool("archived")),starred:\(bool("starred")),origin:\(include ? "include":exclude ? "exclude":"omitted")"
  }
  let timeline=events.compactMap{event->String? in
   let kind=event["event"] as? String ?? "unknown",time=int(event,"relativeMs").map(String.init) ?? "?"
   let partition=event["partition"] as? [String:Any] ?? [:],requestOffset=(partition["offset"] as? NSNumber).map{$0.intValue}
   let shape=partitionKey(event)
   if kind=="request" {return "request +\(time)ms [\(shape)] offset \(requestOffset.map(String.init) ?? "—")"}
   guard kind=="response" || kind=="failure" else{return nil}
   let status=int(event,"status").map(String.init) ?? "—",responseOffset=int(event,"responseOffset"),items=int(event,"itemCount")
   let expected=int(event,"expectedNextOffset"),hint=(event["paginationHint"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"
   let decision=event["pageDecision"] as? String ?? "unknown"
   return "\(kind) +\(time)ms [\(shape)] HTTP \(status) offset \(responseOffset.map(String.init) ?? requestOffset.map(String.init) ?? "—") items \(items.map(String.init) ?? "—") expected \(expected.map(String.init) ?? "—") hint \(hint) decision \(decision)"
  }
  let acceptedPages=cycleRootAcceptedPageEvents
  let acceptedPageLines=acceptedPages.map{page in
   let time=int(page,"relativeMs").map(String.init) ?? "?",shape=page["partitionShape"] as? String ?? "unknown"
   let request=int(page,"requestOffset").map(String.init) ?? "—",response=int(page,"responseOffset").map(String.init) ?? "—"
   let items=int(page,"itemCount").map(String.init) ?? "—",expected=int(page,"expectedNextOffset").map(String.init) ?? "—"
   let status=int(page,"httpStatus").map(String.init) ?? "—",newIds=int(page,"newIdentityCount").map(String.init) ?? "—"
   let hint=page["frontendHint"] as? String ?? "unknown",frontend=page["frontendDecision"] as? String ?? "unknown",native=page["nativeDecision"] as? String ?? "unknown"
   return "+\(time)ms [\(shape)] request/response \(request)/\(response) HTTP \(status) items \(items) new IDs \(newIds) expected \(expected) hint \(hint) frontend \(frontend) native \(native)"
  }
  let lastAccepted=acceptedPages.last
  let expected=int(lastAccepted,"expectedNextOffset")
  let lastShape=lastAccepted?["partitionShape"] as? String
  let lastAcceptedTime=int(lastAccepted,"relativeMs") ?? -1
  let matchingNextRequest=events.first{event in
   let requestTime=int(event,"relativeMs") ?? -1
   return (event["event"] as? String)=="request" && requestTime>lastAcceptedTime && partitionKey(event)==(lastShape ?? "")
  }
  let nextOffset=(matchingNextRequest?["partition"] as? [String:Any]).flatMap{$0["offset"] as? NSNumber}?.intValue
  let nativeDecision=lastAccepted?["nativeDecision"] as? String ?? "unknown"
  let requestState:String
  if nativeDecision=="stop_coverage_complete" {requestState="stop_coverage_complete"}
  else if let nextOffset {requestState=expected==nil ? "observed_unexpected_or_unknown_offset":expected==nextOffset ? "expected_next_request_observed":"unexpected_offset_observed"}
  else {requestState=cycleRootStallDetail=="pagination_stall" ? "no_next_request_observed":"waiting_frontend"}
  let lastRequest=events.last{($0["event"] as? String)=="request"}
  let lastResponse=events.last{["response","failure"].contains($0["event"] as? String ?? "")}
  let lastNonempty=acceptedPages.last{(int($0,"itemCount") ?? 0)>0}
  let lastSuccessfulOffset=int(lastAccepted,"responseOffset").map(String.init) ?? "—"
  let identityTime=cycleRootLastIdentityProgressRelativeMs.map(String.init) ?? "none"
  let pageTime=cycleRootLastPageRelativeMs.map(String.init) ?? "none"
  let pageOffset=cycleRootLastPageOffset.map(String.init) ?? "—"
  let identityOffset=cycleRootLastIdentityProgressOffset.map(String.init) ?? "—"
  let stall=cycleRootStallDetail=="pagination_stall" ? "45-second cycleListVersion inactivity watchdog elapsed":"none"
  return "Root pagination sequence: \(timeline.isEmpty ? "no hook events":timeline.joined(separator:" → "))\nAccepted root pages: \(acceptedPageLines.isEmpty ? "none":acceptedPageLines.joined(separator:" → "))\nRoot pagination stall detail: \(stall) · last successful offset \(lastSuccessfulOffset) · expected next offset \(expected.map(String.init) ?? "—") · next request state \(requestState) · last request +\(int(lastRequest,"relativeMs").map(String.init) ?? "—") ms [\(lastRequest.map(partitionKey) ?? "—")] · last response/failure +\(int(lastResponse,"relativeMs").map(String.init) ?? "—") ms [\(lastResponse.map(partitionKey) ?? "—")] · last non-empty accepted page +\(int(lastNonempty,"relativeMs").map(String.init) ?? "—") ms · last accepted page +\(pageTime) ms offset \(pageOffset) new identities \(cycleRootLastPageNewIdentities) · last new-identity progress +\(identityTime) ms offset \(identityOffset)"
 }
 func updatePartitionReport(_ override:CompositeCoverage? = nil) {
  let observations=cyclePartitions.values.sorted{$0.descriptor.text<$1.descriptor.text}
  let validRootPages=observations.reduce(0){$0+$1.pages.count}
  let composite=override ?? compositeCoverage(observations,cutoff:cycleCutoffTimestamp,starredProofState:cycleState.lastStarredCoverageProofState)
  let iso=ISO8601DateFormatter()
  func time(_ value:Double?)->String {value.map{iso.string(from:Date(timeIntervalSince1970:$0/1000))} ?? "—"}
  var lines=["Coverage: \(coverageDisplayLabel(composite)) · \(composite.detail)","Coverage scope: \(composite.scope)","Cutoff: \(time(cycleCutoffTimestamp))"]
  lines.append(rootDiscoveryProvenanceLine())
  lines.append(rootDocumentTelemetryLine())
  lines.append(rootSidebarMetadataLine())
  lines.append("Discovery source: \(cycleDiscoverySource) · DOM candidates \(cycleDOMCandidateCount) · accepted conversation rows \(cycleDOMAcceptedRowCount) · rejected navigation rows \(cycleDOMRejectedNavigationRowCount) · duplicate rows \(cycleDOMDuplicateRowCount) · coverage reason \(cycleRootStallDetail ?? "network_coverage")")
  lines.append("Root diagnostics: requests \(cycleRootRequests) · responses \(cycleRootResponses) · recognized \(cycleRootRecognized) · valid root pages before rate limit \(validRootPages) · resource timing \(cycleRootResources) · HTTP [\(cycleRootStatuses.sorted().map(String.init).joined(separator:","))]")
  lines.append(rootPaginationStallLine())
  for (index,observation) in observations.enumerated() {
   let offsets=observation.pages.map{$0.offset.map(String.init) ?? "cursor"}.joined(separator:" → ")
   let ordering=observation.pages.isEmpty ? "not observed" : (observation.orderingIssue ?? "valid")
   lines.append("Stream \(index+1): \(observation.descriptor.text)\nPages \(observation.pages.count) [\(offsets)] · unique \(observation.ids.count) · oldest \(time(observation.pages.flatMap{$0.times}.min())) · newest \(time(observation.pages.flatMap{$0.times}.max()))\nOrdering: \(ordering) · \(observation.status(cutoff:cycleCutoffTimestamp).rawValue)")
  }
  let rootIDs=observations.reduce(into:Set<String>()){$0.formUnion($1.ids)}
  let starred=observations.filter{$0.descriptor.archived==false && $0.descriptor.starred==true}.reduce(into:Set<String>()){$0.formUnion($1.ids)}
  let main=observations.filter{$0.descriptor.archived==false && $0.descriptor.starred==false}.reduce(into:Set<String>()){$0.formUnion($1.ids)}
  let archived=observations.filter{$0.descriptor.archived==true}.reduce(into:Set<String>()){$0.formUnion($1.ids)}
  let recent=cycleState.records.values.filter{cycleIds.contains($0.conversationId) && $0.lastSeenUpdatedAt>=cycleCutoffTimestamp && $0.lastSeenUpdatedAt<=Date().timeIntervalSince1970*1000}.count
  lines.append(contentsOf:composite.proofs)
  if let proofState=cycleState.lastStarredCoverageProofState {
   lines.append(proofState.diagnosticsLine)
  }
  if !cyclePinnedReport.isEmpty {lines.append(cyclePinnedReport)}
  lines.append("Starred UI trigger: \(cycleStarredTriggerStatus)\nCombined unique: \(cycleIds.count) · recent ≥ cutoff: \(recent) · root/project overlap: \(rootIDs.intersection(cycleProjectIds).count)\nProject discovery: \(cycleProjectPages) pages · \(cycleProjectIds.count) chats (not coverage proof)\nStarred unique: \(starred.count) · overlap with explicit starred=false: \(starred.intersection(main).count) · starred=true stream: \(observations.contains{$0.descriptor.starred==true} ? "observed":"not observed")\nArchived unique: \(archived.count) · archived=true stream: \(observations.contains{$0.descriptor.archived==true} ? "observed":"not observed / uncovered")")
  cycleCoverageReport=lines.joined(separator:"\n")
 }
 enum EvaluationFailure: Error {case timeout}
 func evaluateForCycle(_ script: String) async throws -> Any? {
  try await withCheckedThrowingContinuation { continuation in
   var finished=false
   let timeout=DispatchWorkItem {
    guard !finished else{return};finished=true
    continuation.resume(throwing:EvaluationFailure.timeout)
   }
   DispatchQueue.main.asyncAfter(deadline:.now()+8,execute:timeout)
   web.evaluateJavaScript(script) { result,error in
    guard !finished else{return};finished=true;timeout.cancel()
    if let error=error {continuation.resume(throwing:error)} else {continuation.resume(returning:result)}
   }
  }
 }
 func pauseCycle(_ seconds: Double) async throws {try await Task.sleep(nanoseconds:UInt64(seconds*1_000_000_000));try Task.checkCancellation()}
 func recordChatCheckStage(_ stage:String) {
  guard var telemetry=chatCheckTelemetry else{return}
  if ["chat_check_no_progress","pagination_no_progress"].contains(stage) {
   telemetry.terminalStageDurationMs=max(0,Int(Date().timeIntervalSince(telemetry.stageStartedAt)*1000))
  }
  if stage=="navigation_load_rejected" {telemetry.navigationTerminalReason="navigation_not_started"}
  if stage=="navigation_provisional_failed" {telemetry.navigationTerminalReason="navigation_provisional_failed"}
  if stage=="navigation_failed" {telemetry.navigationTerminalReason="navigation_failed"}
  telemetry.enter(stage);chatCheckTelemetry=telemetry
  cyclePhase="Chat \(cycleCurrentChatCheckOrdinal): \(stage)"
  renderCycle()
 }
 func recordPersistedChatCheckTrace(stage:ChatCheckTraceStage,result:ChatCheckTraceResult,reason:ChatCheckTraceReason,generation:String?=nil,url:URL?=nil,at:Date=Date()) {
  if let generation,chatCheckTraceGeneration != generation {return}
  cycleState.appendChatCheckTrace(stage:stage,result:result,route:sanitizedChatCheckRoute(url ?? web.url),reason:reason,at:at)
  saveCycle();lastChatCheckTraceOutput.stringValue=cycleState.lastChatCheckTrace?.displayText ?? "Last standard chat check trace: not recorded"
 }
 func finishPersistedChatCheckTrace(terminalResult:String,expectedConversationID:String,generation:String) {
  guard chatCheckTraceGeneration==generation else{return}
  let trace=cycleState.lastChatCheckTrace
  let stages=Set(trace?.events.map{$0.stage} ?? [])
  let now=Date(),route=sanitizedChatCheckRoute(web.url)
  if !stages.contains(.navigationFinished) {
   recordPersistedChatCheckTrace(stage:.navigationFinished,result:.failure,reason:.navigationNotFinished,generation:generation,at:now)
  }
  if !stages.contains(.conversationRouteObserved) {
   let matched=conversationID(in:web.url)==expectedConversationID
   recordPersistedChatCheckTrace(stage:.conversationRouteObserved,result:matched ? .success:.failure,
    reason:matched ? .expectedRoute:(route.template=="home" ? .unexpectedRoute:.conversationRouteNotObserved),generation:generation,at:now)
  }
  if !stages.contains(.documentReady) {
   recordPersistedChatCheckTrace(stage:.documentReady,result:.failure,reason:.documentReadyNotObserved,generation:generation,at:now)
  }
  if !stages.contains(.historyWaitStarted) {
   recordPersistedChatCheckTrace(stage:.historyWaitStarted,result:.failure,reason:.historyWaitNotStarted,generation:generation,at:now)
  }
  if !stages.contains(.historyResponseObserved) {
   recordPersistedChatCheckTrace(stage:.historyResponseObserved,result:.failure,reason:.historyResponseNotObserved,generation:generation,at:now)
  }
  if !stages.contains(.historyRowsObserved) {
   recordPersistedChatCheckTrace(stage:.historyRowsObserved,result:.failure,reason:.historyRowsNotObserved,generation:generation,at:now)
  }
  recordPersistedChatCheckTrace(stage:.terminalResult,
   result:chatCheckTraceTerminalReason(terminalResult) == .terminalComplete || chatCheckTraceTerminalReason(terminalResult) == .terminalPartial ? .success:.failure,
   reason:chatCheckTraceTerminalReason(terminalResult),generation:generation,at:Date())
  chatCheckTraceGeneration=nil
 }
 func recordChatCheckHistoryRequest(_ data:[String:Any]) {
  guard var telemetry=chatCheckTelemetry,
        data["generation"] as? String == automationToken,
        data["owner"] as? String == "scheduler_conversation_check" else{return}
  telemetry.historyRequests += 1
  cycleState.recordObservedHistoryRequest()
  telemetry.timing.recordHistoryRequest(at:Date())
  if telemetry.continuationSelected {
   telemetry.continuationHistoryRequests += 1
   if telemetry.continuationFirstHistoryRequestMs == nil {
    telemetry.continuationFirstHistoryRequestMs=telemetry.continuationStartedAt.map{max(0,Int(Date().timeIntervalSince($0)*1000))}
    telemetry.recordContinuationStage("first_history_request_seen")
   }
  }
  if telemetry.historyRequests==1 {telemetry.pagination.begin()}
  chatCheckTelemetry=telemetry
  cycleState.observePerChatHistoryDiagnostic(telemetry)
  saveCycle()
  renderCycle()
 }
 func recordChatCheckDOMTurnEvidence(_ data:[String:Any]) {
  guard var telemetry=chatCheckTelemetry,data["routeCategory"] as? String=="chat",
        telemetry.operationGeneration==automationToken else{return}
  func safeCount(_ key:String)->Int {max(0,min(5000,(data[key] as? NSNumber)?.intValue ?? 0))}
  let turns=safeCount("turnCount"),users=safeCount("userTurnCount"),assistants=safeCount("assistantTurnCount"),unknown=safeCount("unknownRoleTurnCount")
  guard users+assistants+unknown<=turns else{return}
  let changed=telemetry.renderedDOMTurnCount != turns || telemetry.renderedDOMUserTurnCount != users || telemetry.renderedDOMAssistantTurnCount != assistants || telemetry.renderedDOMUnknownRoleTurnCount != unknown
  telemetry.renderedDOMTurnCount=turns;telemetry.renderedDOMUserTurnCount=users;telemetry.renderedDOMAssistantTurnCount=assistants;telemetry.renderedDOMUnknownRoleTurnCount=unknown
  chatCheckTelemetry=telemetry
  cycleState.observePerChatHistoryDiagnostic(telemetry)
  if changed {renderCycle()}
 }
 func recordChatCheckContinuationResponse(_ data:[String:Any]) {
  guard var telemetry=chatCheckTelemetry,telemetry.continuationSelected,
        data["event"] as? String=="continuation_response_pipeline",
        data["generation"] as? String==automationToken,
        telemetry.operationGeneration==automationToken,
        data["source"] as? String=="page_pipeline" else{return}
  let now=Date()
  telemetry.recordContinuationResponse(data,now:now)
  telemetry.timing.recordContinuationResponse(data,at:now)
  let direction=data["pageDirection"] as? String ?? "unknown"
  let accepted=data["accepted"] as? Bool == true
  let newItems=(data["newIdentityCount"] as? NSNumber)?.intValue ?? 0
  let replayItems=((data["identityProvenanceCounts"] as? [String:Any])?["known_from_checkpoint_cache"] as? NSNumber)?.intValue ?? 0
  chatCheckBudgetController?.observe(hasPreviousPage:(data["hasPreviousPage"] as? Bool) ?? telemetry.hasPreviousPage,
   genuineOlderProgress:direction=="older" && accepted && newItems>0,
   cachedReplay:direction=="older" && replayItems>0 && newItems==0,at:now)
  chatCheckTelemetry=telemetry
  renderCycle()
 }
 func recordChatCheckIdentityProvenance(_ data:[String:Any]) {
  guard var telemetry=chatCheckTelemetry,
        data["event"] as? String=="first_pass_identity_provenance",
        data["generation"] as? String==automationToken,
        telemetry.operationGeneration==automationToken,
        let provenance=data["provenance"] as? [String:Any] else{return}
  telemetry.recordFirstPassIdentityProvenance(provenance)
  chatCheckTelemetry=telemetry
  renderCycle()
 }
 func recordChatCheckContinuationStage(_ data:[String:Any]) {
  guard var telemetry=chatCheckTelemetry,telemetry.continuationSelected,
        data["generation"] as? String==automationToken,
        telemetry.operationGeneration==automationToken,
        let stage=data["stage"] as? String else{return}
  let route=data["routeUnchanged"] as? Bool,document=data["documentSame"] as? Bool
  let bridge=data["bridgeResult"] as? String
  let source=data["source"] as? String
  if stage=="first_pass_boundary_captured" {
   if let boundary=data["boundary"] as? [String:Any] {telemetry.recordFirstPassBoundary(boundary)}
   telemetry.recordContinuationStage(stage,routeUnchanged:route,documentSame:document,bridgeResult:bridge,source:source)
  } else if stage=="pagination_trigger_attempted",telemetry.continuationTriggerResult=="not_run" {
   telemetry.continuationTriggerAttempted=true
   telemetry.recordContinuationStage(stage,routeUnchanged:route,documentSame:document,bridgeResult:bridge,source:source)
  } else if stage=="pagination_trigger_result",telemetry.continuationTriggerResult=="not_run" {
   telemetry.continuationTriggerResult=bridge=="success" ? "yes":"no"
   telemetry.recordContinuationStage(stage,routeUnchanged:route,documentSame:document,bridgeResult:bridge,source:source)
   if bridge=="document_changed" || bridge=="route_changed" {telemetry.continuationDiagnosis=bridge=="document_changed" ? "continuation_document_changed":"continuation_route_changed"}
  } else if stage=="bridge_command_received" || stage=="bridge_command_rejected" || stage=="bridge_command_accepted" {
   telemetry.recordContinuationStage(stage,routeUnchanged:route,documentSame:document,bridgeResult:bridge,source:source)
   if stage=="bridge_command_rejected" {telemetry.continuationBridgeSuccess="no";telemetry.continuationDiagnosis="continuation_bridge_failed"}
   if stage=="bridge_command_accepted" {telemetry.continuationBridgeSuccess="yes"}
  }
  chatCheckTelemetry=telemetry;renderCycle()
 }
 func recordChatCheckPage(_ update:AutomationUpdate,now:Date=Date()) {
  guard update.token==automationToken,var telemetry=chatCheckTelemetry,
        telemetry.operationGeneration==update.token else{return}
  let page=telemetry.pagination.observe(messageIDs:update.state.processedMessageIds,messageCount:update.state.messagesCollected,
                                        pageNumber:update.received,hasPreviousPage:update.state.hasPreviousPage,
                                        activityMinimum:update.pageActivityMinimum,activityMaximum:update.pageActivityMaximum,
                                        pageDirection:update.pageDirection,uniqueBaselineMessages:update.olderUniqueBaselineMessageCount ?? 0,
                                        knownPageMessageCount:update.pageKnownMessageCount ?? 0,
                                        olderHistoryProgressObserved:update.newHistoryProgress==true,
                                        pageFingerprint:update.pageFingerprint,pageReplay:update.pageReplay,now:now)
  recordPersistedChatCheckTrace(stage:.historyRowsObserved,result:update.state.messagesCollected>0 ? .success:.failure,
   reason:update.state.messagesCollected>0 ? .historyRowsObserved:.historyRowsEmpty,generation:update.token,at:now)
  if telemetry.continuationSelected {
   telemetry.timing.recordContinuationAggregateProgress(olderUniqueMessages:update.olderUniqueMessageCount ?? 0,at:now)
  } else {
   telemetry.timing.recordFirstPassPage(replay:page.pageReplay,knownItems:page.knownPageMessageCount,
    newIdentityTotal:update.olderUniqueBaselineMessageCount ?? 0,
    progress:page.newlyAddedMessages>0 || page.replayProgressObserved || page.olderHistoryProgressObserved,at:now)
  }
  chatCheckBudgetController?.observe(hasPreviousPage:update.state.hasPreviousPage,
   genuineOlderProgress:update.pageDirection=="older" && update.newHistoryProgress==true,
   cachedReplay:update.pageDirection=="older" && page.pageReplay,at:now)
  telemetry.recordAcceptedPageUpdate(update.received)
  telemetry.messagesAccumulated=update.state.messagesCollected
  telemetry.hasPreviousPage=update.state.hasPreviousPage
  telemetry.historyComplete=update.state.historyComplete
  telemetry.documentIdentity=update.documentIdentity ?? telemetry.documentIdentity
  telemetry.paginationFrontierTimestamp=update.paginationFrontierTimestamp ?? telemetry.paginationFrontierTimestamp
  telemetry.olderUniqueMessageCount=max(telemetry.olderUniqueMessageCount,update.olderUniqueMessageCount ?? 0)
  telemetry.observeContinuationPage(sequence:update.received,messageCount:update.state.messagesCollected,olderUniqueMessages:update.olderUniqueMessageCount ?? 0,now:now)
  if telemetry.continuationSelected,update.received>telemetry.continuationBaselinePages,
     telemetry.continuationPageSequences.insert(update.received).inserted {
   telemetry.continuationPageResponses=telemetry.continuationPageSequences.count
   telemetry.continuationAggregateGrowth=max(telemetry.continuationAggregateGrowth,max(0,update.state.messagesCollected-telemetry.continuationBaselineMessages))
   telemetry.continuationOlderUniqueMessages=max(telemetry.continuationOlderUniqueMessages,update.olderUniqueMessageCount ?? 0)
   if telemetry.continuationFirstHistoryResponseMs==nil {
    telemetry.continuationFirstHistoryResponseMs=telemetry.continuationStartedAt.map{max(0,Int(now.timeIntervalSince($0)*1000))}
    telemetry.recordContinuationStage("first_history_response_seen",source:"page_observer",now:now)
   }
  }
  telemetry.paginationNoProgressTriggered=telemetry.pagination.shouldStopForNoProgress
  telemetry.checkProgress.observeNativePage(newlyAddedMessages:page.newlyAddedMessages,
   hasPreviousPage:update.state.hasPreviousPage,
   paginationProgressObserved:telemetry.pagination.currentlyProgressing || page.replayProgressObserved || page.olderHistoryProgressObserved)
  chatCheckTelemetry=telemetry
  cycleState.observePerChatHistoryDiagnostic(telemetry)
  if cycleRunning,let id=chatCheckExpectedConversationID,id==update.state.conversationId,
     update.state.hasPreviousPage==true,
     update.state.messagesCollected > (cycleState.records[id]?.aggregate?.messagesCollected ?? 0),
     chatCheckLastCheckpointAt == nil || now.timeIntervalSince(chatCheckLastCheckpointAt!)>=5 {
   if var saved=cycleState.records[id] {
    saved.aggregate=update.state
    saved.lastCheckResult="Partial · pagination_checkpoint"
    saved.partialObservedActivityAt=saved.lastSeenUpdatedAt
    saved.paginationBoundaryMessageCount=update.state.messagesCollected
    cycleState.records[id]=saved
    chatCheckLastCheckpointAt=now;saveCycle()
   }
  }
  _=page
  renderCycle()
 }
 func recordChatCheckScriptStage(_ data:[String:Any]) {
  guard var telemetry=chatCheckTelemetry,data["generation"] as? String==automationToken,
        let stage=data["stage"] as? String,["aggregation_started","aggregation_complete"].contains(stage) else{return}
  if stage=="aggregation_started" {telemetry.aggregationStarted=true}
  if stage=="aggregation_complete" {telemetry.aggregationCompleted=true}
  telemetry.enter(stage);chatCheckTelemetry=telemetry;renderCycle()
 }
 func recordChatCheckActivity(_ data:[String:Any]) {
  guard var telemetry=chatCheckTelemetry,
        data["operationOwner"] as? String == "scheduler_conversation_check",
        data["operationGeneration"] as? String == automationToken,
        data["conversationId"] as? String == chatCheckExpectedConversationID,
        let family=data["endpointFamily"] as? String,
        ["conversation_messages","conversation_detail"].contains(family) else{return}
  telemetry.historyResponses += 1
  cycleState.recordObservedHistoryResponse()
  let traceResponse=chatCheckTraceHistoryResponseReason(status:(data["httpStatus"] as? NSNumber)?.intValue)
  recordPersistedChatCheckTrace(stage:.historyResponseObserved,result:traceResponse.0,reason:traceResponse.1,generation:automationToken)
  telemetry.timing.recordHistoryResponse(at:Date())
  if telemetry.continuationSelected {
   telemetry.continuationHistoryResponses += 1
   if telemetry.continuationFirstHistoryResponseMs == nil {
    telemetry.continuationFirstHistoryResponseMs=telemetry.continuationStartedAt.map{max(0,Int(Date().timeIntervalSince($0)*1000))}
    telemetry.recordContinuationStage("first_history_response_seen")
   }
  }
  telemetry.enter("history_response_seen")
  let status=(data["httpStatus"] as? NSNumber)?.intValue ?? 0
  if status>0 {telemetry.httpStatuses.insert(status)}
  if status==429 {telemetry.rateLimitSeen=true}
  chatCheckTelemetry=telemetry
  cycleState.observePerChatHistoryDiagnostic(telemetry)
  saveCycle()
  renderCycle()
 }
 func recordChatCheckHistoryResponseParsing(_ data:[String:Any]) {
  let eventGeneration=data["generation"] as? String
  let telemetryGeneration=chatCheckTelemetry?.operationGeneration
  if let rejection=historyProgressEventRejectionReason(eventGeneration:eventGeneration,activeGeneration:automationToken,telemetryGeneration:telemetryGeneration) {
   cycleState.recordHistoryProgressEventRejection(rejection)
   saveCycle();updateCurrentCycleSummary()
   return
  }
  guard var telemetry=chatCheckTelemetry else{return}
  let entry=HistoryResponseParseEntry.make(data)
  telemetry.checkProgress.observeParsedResponse(entry)
  if let hasPreviousPage=entry.hasPreviousPage {telemetry.hasPreviousPage=hasPreviousPage}
  chatCheckTelemetry=telemetry
  cycleState.recordHistoryResponseParsing(entry)
  cycleState.observePerChatHistoryDiagnostic(telemetry)
  saveCycle();updateCurrentCycleSummary()
 }
 func cycleProvenanceSummary(now:Double=Date().timeIntervalSince1970*1000)->String {
  let records=Array(cycleState.records.values),summary=cachedActivityProvenanceSummary(records,now:now)
  let root=records.filter{$0.lastSeenUpdatedAtSource == .rootConversationUpdateTime}.count
  let project=records.filter{$0.lastSeenUpdatedAtSource == .projectConversationUpdateTime}.count
  let history=records.filter{$0.lastSeenUpdatedAtSource == .completeHistory}.count
  let activity=records.filter{$0.lastSeenUpdatedAtSource == .conversationActivityMetadata}.count
  let legacy=records.filter{$0.lastSeenUpdatedAtSource == .legacyUnknown}.count
  return "records \(summary.records) · timestamps \(summary.timestamps) · trusted \(summary.trusted) (root \(root), project \(project), history \(history)) · activity metadata \(activity) · legacy/unknown \(legacy) · fresh observedAt \(summary.freshObservations) · stale/missing observedAt \(summary.staleObservations)"
 }
 func finishChatCheckReport(terminal:String,ordinal:Int,eligibilityReason:String?=nil) {
  guard var telemetry=chatCheckTelemetry else{return}
  if let budget=chatCheckBudgetController {telemetry.timing.recordBudget(budget.snapshot())}
  if telemetry.continuationSelected {telemetry.timing.markContinuationEnded(at:Date())}
  else {telemetry.timing.markFirstPassEnded(at:Date())}
  if telemetry.continuationSelected {telemetry.diagnoseContinuationAtTerminal();telemetry.recordContinuationStage("continuation_terminal")}
  if !terminal.hasPrefix("per_chat_timeout") {
   telemetry.stageBeforeFinish=telemetry.stage
   telemetry.enter("chat_check_finished")
  }
  telemetry.renderLeaseActive=backgroundRenderLeaseOwner != nil
  chatCheckTelemetry=telemetry
  if let generation=telemetry.operationGeneration {
   chatCheckReportSnapshots[generation]=ChatCheckReportSnapshot(telemetry:telemetry,ordinal:ordinal,terminal:terminal,eligibilityReason:eligibilityReason)
  }
  chatCheckReports.append(telemetry.report(ordinal:ordinal,terminal:terminal,eligibilityReason:eligibilityReason))
  cycleChatTerminalResults.append(terminal)
  if chatCheckReports.count>12 {chatCheckReports.removeFirst(chatCheckReports.count-12)}
  renderCycle()
 }
 @discardableResult func clearChatCheckState(ownerGeneration:String,caller:String)->Bool {
  guard !ownerGeneration.isEmpty else{return false}
  guard automationToken==ownerGeneration else {
   if var snapshot=chatCheckReportSnapshots[ownerGeneration] {
    if snapshot.telemetry.cleanupOwnershipResult.hasPrefix("accepted") {
     snapshot.telemetry.cleanupOwnershipResult += " · late worker cleanup rejected by generation guard"
    } else {snapshot.telemetry.cleanupOwnershipResult="rejected · stale generation did not own current WebKit state"}
    chatCheckReportSnapshots[ownerGeneration]=snapshot
    let prefix="Chat \(snapshot.ordinal):"
    if let index=chatCheckReports.firstIndex(where:{$0.hasPrefix(prefix)}) {
     chatCheckReports[index]=snapshot.telemetry.report(ordinal:snapshot.ordinal,terminal:snapshot.terminal,eligibilityReason:snapshot.eligibilityReason)
     renderCycle()
    }
   }
   return false
  }
  if var telemetry=chatCheckTelemetry,telemetry.operationGeneration==ownerGeneration {
   telemetry.cleanupOwnershipResult=caller=="timeout handler"
    ? "accepted · timeout handler matched generation; late worker defer fenced"
    : "accepted · \(caller) matched current generation"
   chatCheckTelemetry=telemetry
  }
  if automationUpdate?.token==ownerGeneration {chatCheckTerminalUpdate=automationUpdate}
  if let data=try? JSONSerialization.data(withJSONObject:[ownerGeneration]),let token=String(data:data,encoding:.utf8) {
   web.evaluateJavaScript("window.gptClearCheckGeneration?.(\(token)[0])",completionHandler:nil)
  }
  restoreRuntimeUserScripts()
  automationToken="";automationUpdate=nil;navigationFinished=false
  chatCheckLastCheckpointAt=nil
  chatCheckNavigation=nil;chatCheckExpectedConversationID=nil
  return true
 }
 @objc func runCycle() {startCycle(trigger:"manual")}
 func startCycle(trigger:String) {
  guard cycleGate.begin() else{return}
  backgroundPresentationTrace=[]
  beginBackgroundFocusObservation()
  cycleRiskNotificationsGenerated=0;cycleRiskNotificationsSuppressed=0
  chatCheckReports=[];chatCheckReportSnapshots=[:];cycleChatTerminalResults=[];chatCheckTelemetry=nil;cycleFreshRiskCounts=["Normal":0,"Watch":0,"Near":0,"Critical":0,"Unknown":0]
  cycleState.perChatHistoryDiagnostics=PerChatHistoryDiagnostics()
  cycleState.lastPinnedUnknownRows=[]
  cycleState.historyProgressEventRejections=HistoryProgressEventRejectionState()
  cycleProvenanceBefore=cycleProvenanceSummary()
  cycleToken=UUID().uuidString;cycleScriptSecret=UUID().uuidString+UUID().uuidString
  cycleState.lastCycleGeneration=cycleToken;cycleState.lastCycleNotificationsAccepted=0;cycleState.lastCycleNotificationsSuppressed=0
  cycleOrigins.reset();cyclePartitions=[:];cycleCoverageReport="";cycleStarredTriggerStatus="not required; using pinned prefix";cyclePinnedResult=nil;cyclePinnedReport="";cycleState.lastStarredCoverageProofState=nil
  cycleRootStageStarted=false;cycleRootPreflight=[:];cycleRootPostflight=[:];cycleRootHookHealth=[:];cycleRootDocumentSnapshots=[:]
  cycleRootTriggerStarted=false;cycleRootLoadReturnedNavigation=false;cycleRootTriggerFailed=false
  cycleRootTriggerMethod="not_run";cycleRootTriggerResult="not_run";cycleRootTriggerStage="not_started";cycleRootNavigation=nil
  cycleRootRouteBefore="unknown";cycleRootRouteImmediatelyAfter="unknown";cycleRootLatestRoute="unknown"
  cycleRootLoadingImmediatelyAfter=false;cycleRootProgressImmediatelyAfter=0;cycleRootLatestLoading=false;cycleRootLatestProgress=0
  cycleRootInitialProgress=0;cycleRootNavigationObserved=false;cycleRootDelegateEvents=[];cycleRootTerminalReason="not_run"
  setCycleScripts(token:cycleToken,secret:cycleScriptSecret)
  cyclePhase="Discovering recent chats"
  recordBackgroundFocusSample("before scheduler session orderOut")
  session.orderOut(nil)
  recordBackgroundFocusSample("after scheduler session orderOut")
  cycleState.lastCycleAt=Date();cycleState.lastCycleTrigger=trigger
  cycleState.lastCycleStartedHidden = !panel.isVisible && !session.isVisible
  cycleTask=Task { @MainActor in
   defer {
    recordBackgroundFocusSample("cycle cleanup")
    finishGlobalWindowOrderMonitoring()
    finalizeBackgroundFocusObservation(captureBackgroundFocusSnapshot())
    cycleDiscovering=false;automationToken="";automationUpdate=nil;cycleToken="";cycleScriptSecret="";cycleRootNavigation=nil
    setCycleScripts(token:nil);web.evaluateJavaScript("delete window.gptListCycleConfig;window.gptSetRateLimitContext?.('unrelated_passive_traffic',null,'page_idle')",completionHandler:nil)
    // Do not persist the origin registry, descriptors, equality tokens or labels.
    cycleOrigins.reset();cyclePartitions=[:]
    cycleGate.end();cycleTask=nil
    flushPendingForegroundPresentationIfIdle()
    if cycleState.enabled {cycleState.nextRun=nextDiscoveryRun(after:Date())}
    saveCycle();scheduleCycle();renderCycle()
   }
   do {
    cycleState.discoveryStatus = .inProgress
    cycleDiscovering=true;cycleIds=[];cycleListVersion=0;cycleValidListResponses=0;cycleRootResponseReceived=false
    cycleDiscoverySource="network";cycleDOMCandidateCount=0;cycleDOMAcceptedRowCount=0;cycleDOMRejectedNavigationRowCount=0;cycleDOMDuplicateRowCount=0;cycleDOMFallbackIds=[]
    cycleRootStallDetail=nil;cycleRootLastPageRelativeMs=nil;cycleRootLastPageOffset=nil;cycleRootLastPageNewIdentities=0;cycleRootAcceptedPageEvents=[]
    cycleRootLastIdentityProgressRelativeMs=nil;cycleRootLastIdentityProgressOffset=nil
    cycleRootRequests=0;cycleRootResponses=0;cycleRootRecognized=0;cycleRootResources=0;cycleRootResourceResponses=0;cycleRootStatuses=[];cycleRootResourceStatuses=[]
    cycleProjectIds=[];cycleProjectStreams=[];cyclePageKeys=[];cycleProjectPages=0
    let started=Date(),cycleHardDeadline=started.addingTimeInterval(600);cycleDiscoveryDeadline=cycleHardDeadline;cycleCutoffTimestamp=started.timeIntervalSince1970*1000-21600000
    saveCycle();updatePartitionReport();renderCycle()
    let home=URL(string:"https://chatgpt.com/")!
    let renderLeaseOwner="scheduler-discovery-\(cycleToken)"
    try await acquireBackgroundRenderSurface(owner:renderLeaseOwner)
    defer {
     if backgroundRenderLeaseOwner==renderLeaseOwner {
      let restored=restoreBackgroundRenderSurface(owner:renderLeaseOwner)
      backgroundRenderLeaseReport += " · deferred cleanup \(restored ? "completed":"failed")"
     }
    }
    cycleRootStageStarted=true;cyclePhase="Capturing root discovery pre-trigger state";renderCycle()
    cycleRootRouteBefore=safeNavigationRouteTemplate(web.url);cycleRootInitialProgress=web.estimatedProgress
    if let script=rootDiscoverySnapshotScript(attachContext:true) {
    do {cycleRootPreflight=try await evaluateForCycle(script) as? [String:Any] ?? [:];recordRootDocumentSnapshot(cycleRootPreflight)}
     catch {cycleRootPreflight=["preflightError":"evaluation_failed"]}
    } else {cycleRootPreflight=["preflightError":"snapshot_script_unavailable"]}
    if let route=cycleRootPreflight["routeTemplate"] as? String {cycleRootRouteBefore=route}
    cycleRootInitialProgress=web.estimatedProgress
    cyclePhase="Triggering root home discovery";cycleRootTriggerStarted=true
    cycleRootTriggerMethod="WKWebView.load(homeRequest)";cycleRootTriggerStage="load_about_to_call";cycleRootTriggerResult="pending"
    renderCycle()
    cycleRootNavigation=web.load(URLRequest(url:home))
    cycleRootLoadReturnedNavigation=cycleRootNavigation != nil
    cycleRootTriggerFailed=cycleRootNavigation==nil
    cycleRootTriggerStage=cycleRootNavigation == nil ? "load_returned_nil":"load_returned_navigation"
    cycleRootTriggerResult=cycleRootNavigation == nil ? "navigation_object_missing":"navigation_object_returned"
    cycleRootRouteImmediatelyAfter=safeNavigationRouteTemplate(web.url)
    cycleRootLoadingImmediatelyAfter=web.isLoading;cycleRootProgressImmediatelyAfter=web.estimatedProgress
    cycleRootLatestRoute=cycleRootRouteImmediatelyAfter;cycleRootLatestLoading=cycleRootLoadingImmediatelyAfter
    cycleRootLatestProgress=cycleRootProgressImmediatelyAfter
    if cycleRootRouteImmediatelyAfter != cycleRootRouteBefore || cycleRootLoadingImmediatelyAfter || abs(cycleRootProgressImmediatelyAfter-cycleRootInitialProgress)>0.005 {
     cycleRootNavigationObserved=true
    }
    renderCycle()
    var changedAt=Date(),version=0,scrolledVersion = -1
    var stallDetail:String?
    if cycleRootNavigation==nil {stallDetail="root_trigger_failed"}
    while cycleRootNavigation != nil && Date().timeIntervalSince(started)<600 {
     // Poll briefly so a 429 halts this cycle before any further recovery or scrolling.
     try await pauseCycle(0.25)
     refreshCycleRootNavigationSnapshot()
     if discoveryRateLimited(Array(cycleRootStatuses)) {break}
     if version != cycleListVersion {version=cycleListVersion;changedAt=Date()}
     if hasCompletePartitionSet(Array(cyclePartitions.values),base:PartitionDescriptor(archived:false,starred:false),cutoff:cycleCutoffTimestamp) {break}
     if Date().timeIntervalSince(changedAt)>45 {
      stallDetail=cycleRootResponseReceived ? "pagination_stall":"no_list_response"
      break
     }
     if version != scrolledVersion {
      scrolledVersion=version
      _ = try? await evaluateForCycle("window.gptScrollSidebar?.()")
     }
    }
    // One bounded retry of the existing home navigation. No direct backend request is made.
    if shouldRetryRootDiscovery(stallDetail:stallDetail,rateLimited:discoveryRateLimited(Array(cycleRootStatuses)),retriesUsed:0) {
     cyclePhase="Retrying root discovery once";renderCycle()
     cycleRootNavigation=web.load(URLRequest(url:home))
     cycleRootLoadReturnedNavigation=cycleRootNavigation != nil
     if cycleRootNavigation != nil {
      changedAt=Date();let retryStarted=Date();stallDetail=nil
      while Date().timeIntervalSince(retryStarted)<45 {
       try await pauseCycle(0.25)
       refreshCycleRootNavigationSnapshot()
       if discoveryRateLimited(Array(cycleRootStatuses)) {break}
       if version != cycleListVersion {version=cycleListVersion;changedAt=Date()}
       if hasCompletePartitionSet(Array(cyclePartitions.values),base:PartitionDescriptor(archived:false,starred:false),cutoff:cycleCutoffTimestamp) {break}
      }
      if !cycleRootResponseReceived {stallDetail=cycleRootRequests>0 ? "root_request_without_response":"no_list_response"}
     } else {stallDetail="root_trigger_failed"}
    }
    if let script=rootDiscoverySnapshotScript(attachContext:false) {
     do {
      _=try await evaluateForCycle(script)
      try await pauseCycle(0.35)
      cycleRootPostflight=try await evaluateForCycle(script) as? [String:Any] ?? [:];recordRootDocumentSnapshot(cycleRootPostflight)
     } catch {cycleRootPostflight=["postflightError":"evaluation_failed"]}
    } else {cycleRootPostflight=["postflightError":"snapshot_script_unavailable"]}
    await enrichNativeRootSidebarCacheSummary()
    if await collectVisibleSidebarDOMFallbackIfNeeded() {
     stallDetail="dom_fallback_visible_sidebar_rows_only"
    }
    refreshCycleRootNavigationSnapshot()
    cycleRootTerminalReason=cycleRootTerminalReasonForCurrentState()
    updatePartitionReport()
    let observations=Array(cyclePartitions.values)
    let baseDiscoveryComplete=hasCompletePartitionSet(observations,base:PartitionDescriptor(archived:false,starred:false),cutoff:cycleCutoffTimestamp)
    let explicitStarredObserved=observations.contains{$0.descriptor.archived==false && $0.descriptor.starred==true && !$0.pages.isEmpty}
    let explicitStarredComplete=hasCompletePartitionSet(observations,base:PartitionDescriptor(archived:false,starred:true),cutoff:cycleCutoffTimestamp)
    var starredProofState=StarredCoverageProofState(explicitStarredObserved:explicitStarredObserved,explicitPartitionComplete:explicitStarredComplete)
    cycleState.lastStarredCoverageProofState=starredProofState
    var composite=compositeCoverage(observations,cutoff:cycleCutoffTimestamp)
    if !discoveryRateLimited(Array(cycleRootStatuses)),baseDiscoveryComplete,!explicitStarredObserved {
     starredProofState.beginFallback()
     cycleState.lastStarredCoverageProofState=starredProofState
     do {
      let proof=try await discoverPinnedPrefix(renderLeaseOwner:renderLeaseOwner)
      starredProofState.finishFallback(proof)
     } catch is CancellationError {
      starredProofState.failFallback("pinned_prefix_cancelled")
     } catch {
      starredProofState.failFallback("pinned_prefix_execution_failed")
     }
     cycleState.lastStarredCoverageProofState=starredProofState
     composite=compositeCoverage(observations,cutoff:cycleCutoffTimestamp,starredProofState:starredProofState)
    }
    if !starredProofState.isConsistent {
     starredProofState.failFallback("starred_proof_state_inconsistent")
     composite=compositeCoverage(observations,cutoff:cycleCutoffTimestamp,starredProofState:starredProofState)
    }
    cycleState.lastStarredCoverageProofState=starredProofState
    let renderLeaseOwnerMatched=backgroundRenderLeaseOwner==renderLeaseOwner
    let renderRestored=restoreBackgroundRenderSurface(owner:renderLeaseOwner)
    let renderLeaseCleanupSummary="owner generation \(renderLeaseOwnerMatched ? "matched":"mismatched") · cleanup requested yes · accepted \(renderRestored ? "yes":"no") · \(backgroundRenderLeaseRestoreDetails)"
    backgroundRenderLeaseReport += " · cleanup \(renderRestored ? "completed":"failed") · \(renderLeaseCleanupSummary)"
    cycleDiscovering=false
    cycleRootStallDetail=stallDetail
    if !cycleRootResponseReceived {composite.status = .incompleteStall;composite.detail=stallDetail ?? "no_list_response";composite.scope="unproven"}
    else if let stallDetail {composite.status = .incompleteStall;composite.detail=stallDetail}
    composite=coverageAfterListStatus(composite,statusCodes:Array(cycleRootStatuses))
    if discoveryRateLimited(Array(cycleRootStatuses)) {cycleState.discoveryStatus = .rateLimited}
    else if cycleRootResponseReceived {cycleState.discoveryStatus = .success;cycleState.lastSuccessfulDiscoveryAt=Date()}
    else {cycleState.discoveryStatus = .incomplete}
    if Date().timeIntervalSince(started)>=600 && !composite.isComplete {composite.status = .incompleteSafetyLimit;composite.detail="hard_safety_timeout_600s"}
    updatePartitionReport(composite)
    let pinnedProofForReport=starredProofState.proof
    let pinnedPrefixProven=pinnedProofForReport?.prefixComplete == true
    let pinnedTotal=pinnedPrefixProven ? pinnedProofForReport?.pinnedCount:nil
    let pinnedResolved=pinnedProofForReport?.timestampsResolved
    let pinnedUnknown=pinnedTotal.flatMap{total in pinnedResolved.map{max(0,total-$0)}}
    let baseDiscoveryProven=baseDiscoveryComplete && cycleRootResponseReceived && stallDetail==nil && !discoveryRateLimited(Array(cycleRootStatuses)) && Date().timeIntervalSince(started)<600
    let pinnedPrefixLabel=pinnedProofForReport.map{$0.prefixComplete ? "complete":"partial"} ?? "not_run"
    let pinnedResolvedLabel=pinnedPrefixProven ? (pinnedResolved.map(String.init) ?? "unknown") : "\(pinnedResolved ?? 0) observed; total unknown"
    let proofReadiness=pinnedProofForReport?.readinessStatus ?? "not_run"
    let proofReadinessReason=pinnedProofForReport?.readinessReason ?? starredProofState.failureReason ?? "not_attempted"
    let proofTop=pinnedProofForReport?.topProven.map{$0 ? "yes":"no"} ?? "unknown"
    let proofPrefix=pinnedProofForReport?.prefixCompleteReported.map{$0 ? "yes":"no"} ?? (pinnedProofForReport.map{$0.prefixComplete ? "yes":"no"} ?? "unknown")
    cyclePinnedReport += "\n\(starredProofState.diagnosticsLine)"
    cyclePinnedReport += "\nStarred coverage evidence: explicit starred stream observed \(starredProofState.explicitStarredObserved ? "yes":"no") · explicit partition complete \(starredProofState.explicitPartitionComplete ? "yes":"no") · fallback \(starredProofState.fallbackStatus.rawValue) · readiness \(proofReadiness) · top proven \(proofTop) · prefix complete \(proofPrefix) · pinned count \(pinnedProofForReport?.pinnedCount.description ?? "unknown") · activity resolved \(pinnedResolved.map(String.init) ?? "unknown")/\(pinnedProofForReport?.pinnedCount.description ?? "unknown") · recent pinned \(pinnedProofForReport?.recentCount.description ?? "unknown") · source \(starredProofState.source) · completion reason \(pinnedProofForReport?.completionReason ?? "none") · failure \(starredProofState.failureReason ?? (pinnedProofForReport?.complete == true ? "none":pinnedProofForReport?.unresolvedReason ?? "none"))"
    cyclePinnedReport += "\nReadiness failure reason: \(proofReadinessReason)"
    cyclePinnedReport += "\nCoverage provenance: Base discovery: \(baseDiscoveryProven ? "complete":"partial") · Pinned prefix: \(pinnedPrefixLabel) · Pinned relevant total: \(pinnedTotal.map(String.init) ?? "unknown") · Pinned activity resolved: \(pinnedResolvedLabel) · Pinned activity unknown: \(pinnedUnknown.map(String.init) ?? "unknown") · Recent pinned: \(pinnedProofForReport?.complete == true ? String(pinnedProofForReport?.recentCount ?? 0):"unknown") · Coverage decision: \(coverageDisplayLabel(composite)) · Coverage reason: \(composite.detail)"
    updatePartitionReport(composite)
    let observedNow=Date().timeIntervalSince1970*1000
    let discoveryRateLimitedForMonitoring=discoveryRateLimited(Array(cycleRootStatuses))
    cycleState.monitoringDegraded = monitoringDiscoveryDegraded(baseDiscoveryComplete:baseDiscoveryComplete,rootResponseReceived:cycleRootResponseReceived,stallDetail:stallDetail,rateLimited:discoveryRateLimitedForMonitoring,safetyLimitExceeded:Date().timeIntervalSince(started)>=600)
    if cycleState.monitoringDegraded == true {
     cycleState.discoveryStatus = .incomplete
    }
    let recent=cycleState.records.values.filter{cycleIds.contains($0.conversationId) && $0.lastSeenUpdatedAt>=cycleCutoffTimestamp && $0.lastSeenUpdatedAt<=observedNow}.sorted{$0.lastSeenUpdatedAt>$1.lastSeenUpdatedAt}
    let recentIDs=Set(recent.map(\.conversationId))
    let maintenance=selectStaleIncompleteMaintenanceCandidates(records:Array(cycleState.records.values),discoveredIDs:cycleIds,recentIDs:recentIDs,nowMs:observedNow)
    let maintenanceCandidateIDs=Set(maintenance.admitted.map(\.conversationId))
    // A failed OS submission is retried from the last Complete observation, without
    // requiring another potentially expensive full history pass.
    for record in recent {
     guard let last=(cycleState.notificationAudit ?? []).last(where:{$0.kind=="risk" && $0.conversationId==record.conversationId}),
           riskMeasurementStatus(result:record.lastCheckResult,aggregate:record.aggregate) == .complete,
           let aggregate=record.aggregate else {continue}
     let assessment=assessRisk(model:currentRiskModel(),estimatedTextTokens:aggregate.estimatedTextTokens,measurement:.complete)
     guard let level=retryRiskNotificationLevel(lastOutcome:last.outcome,previousObservedRank:record.lastRiskRank,lastAcceptedRank:record.lastNotifiedRiskRank,next:assessment) else{continue}
     let content=riskNotificationContent(level:level,chatTitle:record.title,showChatTitle:showChatTitlesInNotifications(storedValue:UserDefaults.standard.object(forKey:showChatTitlesInNotificationsDefaultsKey) as? Bool))
     submitMonitoredNotification(kind:"risk",level:level,body:content.body,conversationID:record.conversationId)
    }
    var checkCandidatesByID=Dictionary(uniqueKeysWithValues:recent.map{($0.conversationId,$0)})
    for record in maintenance.admitted {checkCandidatesByID[record.conversationId]=record}
    for id in cycleDOMFallbackIds {
     if checkCandidatesByID[id]==nil {
      checkCandidatesByID[id]=cycleState.records[id] ?? ChatRecord(conversationId:id,title:"Chat",lastSeenUpdatedAt:0,lastSeenUpdatedAtSource:.legacyUnknown)
     }
    }
    let checkCandidates=Array(checkCandidatesByID.values)
    let queue=cycleState.queue(checkCandidates);var checked=0;var continuationUsed=false,cycleBudgetSkipped=0
    for record in queue {
     try Task.checkCancellation()
     if Date()>=cycleHardDeadline {cycleBudgetSkipped=queue.count-checked;break}
     checked+=1
     cyclePhase="Checking \(checked)/\(queue.count)";renderCycle()
     cycleCurrentChatCheckOrdinal=checked
    let activityPendingAtCheckStart=hasUnprocessedChatActivity(record)
     let checkBudget=ChatCheckBudgetController(checkStartedAt:Date(),cycleDeadline:cycleHardDeadline)
     chatCheckBudgetController=checkBudget
     var attempt=try await isolateCheck(budget:checkBudget) {try await self.checkRecord(record,budget:checkBudget)}
     var saved=cycleState.records[record.conversationId] ?? record
     let timedOut:Bool={if case .failure(let failure)=attempt{return failure is IsolatedCheckError};return false}()
     if timedOut,var telemetry=chatCheckTelemetry {
      telemetry.timing.markTimeout(at:Date(),hasPreviousPage:telemetry.hasPreviousPage,
       aggregateMessages:telemetry.messagesAccumulated)
      chatCheckTelemetry=telemetry
     }
     let stoppedForNoProgress:Bool={if case .success(let result)=attempt{return result.1=="Partial · pagination_no_progress"};return false}()
     if (timedOut || stoppedForNoProgress),
        let firstTelemetry=chatCheckTelemetry,
        let firstProgress=chatCheckTerminalUpdate ?? automationUpdate,firstProgress.token==firstTelemetry.operationGeneration,
        let documentIdentity=firstProgress.documentIdentity,!documentIdentity.isEmpty,
        let frontier=firstProgress.paginationFrontierTimestamp,frontier.isFinite,frontier>0,
        chatCheckContinuationEligible(terminal:stoppedForNoProgress ? "Partial · pagination_no_progress":"Timed out · per_chat_timeout",
         replayProgressObserved:firstTelemetry.pagination.replayProgressObserved,
         newHistoryProgressObserved:firstTelemetry.pagination.olderHistoryProgressObserved,
         uniqueMessagesBeyondBaseline:firstTelemetry.pagination.olderUniqueBaselineMessageCount,
         hasPreviousPage:firstProgress.state.hasPreviousPage==true,
         historyComplete:firstProgress.state.historyComplete,
         routeUnchanged:true,documentIdentityValid:true,
         frontierTimestamp:frontier,
         continuationAlreadyUsed:continuationUsed,
         renderLeaseAvailable:backgroundRenderLeaseOwner==nil),
        firstTelemetry.hasPreviousPage==true,
        firstProgress.state.messagesCollected>(record.aggregate?.messagesCollected ?? 0) {
      continuationUsed=true
      if firstProgress.state.messagesCollected >= (saved.aggregate?.messagesCollected ?? 0) {
       saved.aggregate=firstProgress.state
       saved.lastCheckResult="Partial · pagination_checkpoint"
       saved.partialObservedActivityAt=record.lastSeenUpdatedAt
       saved.paginationBoundaryMessageCount=firstProgress.state.messagesCollected
       cycleState.records[record.conversationId]=saved;saveCycle()
      }
      let continuationStarted=Date()
      var timing=firstTelemetry.timing
      timing.markFirstPassEnded(at:continuationStarted)
      timing.beginContinuation(at:continuationStarted)
      var checkpoint=ChatCheckContinuationCheckpoint(documentIdentity:documentIdentity,frontierTimestamp:frontier,
       aggregate:saved.aggregate ?? firstProgress.state,firstPassPages:firstTelemetry.pagesObserved,firstPassPageUpdateCallbacks:firstTelemetry.automationPageUpdateCallbacks,firstPassMessages:firstProgress.state.messagesCollected,
       firstPassHistoryRequests:firstTelemetry.historyRequests,firstPassHistoryResponses:firstTelemetry.historyResponses,
       replayProgressObserved:firstTelemetry.pagination.replayProgressObserved,newHistoryProgressObserved:firstTelemetry.pagination.olderHistoryProgressObserved,
       hasPreviousPage:firstProgress.state.hasPreviousPage==true,historyProgress:firstTelemetry.checkProgress,timing:timing)
      let initialGeneration=firstTelemetry.operationGeneration ?? ""
      _=clearChatCheckState(ownerGeneration:initialGeneration,caller:"continuation handoff")
      var workerStopped=initialGeneration.isEmpty
      while !workerStopped && Date().timeIntervalSince(continuationStarted)<8 {
       try await pauseCycle(0.1)
       workerStopped = !activeChatCheckWorkers.contains(initialGeneration)
      }
      let elapsed=Date().timeIntervalSince(continuationStarted)
      let remainingBudget=max(0,60-elapsed)
      checkpoint.timing.continuationAvailableBudgetMs=min(60000,max(0,Int(remainingBudget*1000)))
      if workerStopped && remainingBudget>0 {
       checkBudget.beginContinuation(at:Date(),baseBudgetMs:Int(remainingBudget*1000))
       cyclePhase="Continuing one old-history Partial chat in the same document";renderCycle()
       let continuationLeaseOwner="scheduler-continuation-\(cycleToken)-\(checked)"
       attempt=try await isolateCheck(budget:checkBudget) {
        try await self.withBackgroundRenderSurface(owner:continuationLeaseOwner) {
         guard self.backgroundRenderLeaseOwner==continuationLeaseOwner else {throw BackgroundRenderLeaseError.busy}
         return try await self.checkRecord(saved,continuation:checkpoint,budget:checkBudget)
        }
       }
       if case .failure(let error)=attempt,error is IsolatedCheckError,var telemetry=chatCheckTelemetry {
        telemetry.timing.markTimeout(at:Date(),hasPreviousPage:telemetry.hasPreviousPage,
         aggregateMessages:telemetry.messagesAccumulated)
        chatCheckTelemetry=telemetry
       }
       if var continuedTelemetry=chatCheckTelemetry {
        continuedTelemetry.continuationAttempted=true
        continuedTelemetry.continuationFirstPassPages=checkpoint.firstPassPages
        continuedTelemetry.continuationStartingMessages=checkpoint.firstPassMessages
        continuedTelemetry.paginationFrontierTimestamp=checkpoint.frontierTimestamp
        continuedTelemetry.documentIdentity=checkpoint.documentIdentity
        switch attempt {
        case .success(let result):continuedTelemetry.continuationTerminalReason=result.1
        case .failure(let error):continuedTelemetry.continuationTerminalReason=error is IsolatedCheckError ? "additional_budget_exhausted":"cancelled_or_failed"
        }
        chatCheckTelemetry=continuedTelemetry
       }
      } else {
       if var telemetry=chatCheckTelemetry {
        telemetry=firstTelemetry;telemetry.continuationAttempted=true
        telemetry.continuationFirstPassPages=checkpoint.firstPassPages;telemetry.continuationStartingMessages=checkpoint.firstPassMessages
        telemetry.continuationTerminalReason=workerStopped ? "additional_budget_exhausted":"previous_generation_cleanup_timeout"
        chatCheckTelemetry=telemetry
       }
      }
     }
     saved.lastCheckAt=Date().timeIntervalSince1970*1000
     switch attempt {
     case .success(let result):
      finishChatCheckReport(terminal:result.1,ordinal:checked,eligibilityReason:staleIncompleteMaintenanceEligibilityReason(admitted:maintenanceCandidateIDs.contains(record.conversationId)))
      let priorAggregate=saved.aggregate
      let priorMeasurement=riskMeasurementStatus(result:saved.lastCheckResult,aggregate:priorAggregate)
      let riskModelBefore=buildRiskModel(samples:personalRiskSamples())
      let inferredPriorRank=saved.lastRiskRank ?? ((priorMeasurement == .complete) ? assessRisk(model:riskModelBefore,estimatedTextTokens:priorAggregate?.estimatedTextTokens,measurement:.complete).rank:nil)
      if let progress=result.0,progress.messagesCollected >= (saved.aggregate?.messagesCollected ?? 0) {saved.aggregate=progress}
      saved.lastCheckResult=result.1
      if let title=result.0?.title,!title.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {saved.title=title}
      if result.1=="Complete" {saved.lastCheckedUpdatedAt=record.lastSeenUpdatedAt}
      if result.1=="Complete" {saved.consecutiveIncompleteChecks=0;saved.partialObservedActivityAt=nil;saved.paginationBoundaryMessageCount=nil}
      else {
       saved.consecutiveIncompleteChecks+=1
       if let partial=result.0,partial.messagesCollected >= (priorAggregate?.messagesCollected ?? 0) {
        saved.partialObservedActivityAt=record.lastSeenUpdatedAt
        saved.paginationBoundaryMessageCount=partial.messagesCollected
       }
      }
      if let aggregate=result.0 {
       let model=buildRiskModel(samples:personalRiskSamples(replacing:saved))
       let measurement=riskMeasurementStatus(result:result.1,aggregate:aggregate)
       let assessment=assessRisk(model:model,estimatedTextTokens:aggregate.estimatedTextTokens,measurement:measurement)
       cycleFreshRiskCounts[measurement == .complete ? assessment.level : "Unknown",default:0] += 1
       if measurement == .complete {
        if let level=riskNotificationNeeded(previousObservedRank:inferredPriorRank,lastAcceptedRank:saved.lastNotifiedRiskRank,next:assessment) {
         let content=riskNotificationContent(level:level,chatTitle:saved.title,showChatTitle:showChatTitlesInNotifications(storedValue:UserDefaults.standard.object(forKey:showChatTitlesInNotificationsDefaultsKey) as? Bool))
         submitMonitoredNotification(kind:"risk",level:level,body:content.body,conversationID:saved.conversationId)
        } else if inferredPriorRank != nil {cycleRiskNotificationsSuppressed+=1}
        if let old=inferredPriorRank,let rank=assessment.rank,rank<old {saved.lastNotifiedRiskRank=nil}
        saved.lastRiskRank=assessment.rank
       }
      } else {cycleFreshRiskCounts["Unknown",default:0] += 1}
     case .failure(let error):
      if error is IsolatedCheckError {
       let subtype=chatCheckTelemetry?.timeoutSubtype ?? "unknown_stage"
       let budgetTimeout=checkBudget.snapshot().finalTimeoutType
       let telemetry=chatCheckTelemetry
       let latestUpdate=(chatCheckTerminalUpdate ?? automationUpdate).flatMap{$0.token==telemetry?.operationGeneration ? $0:nil}
       let partialAggregate=timeoutProgressPartialAggregate(existing:saved.aggregate,candidate:latestUpdate?.state,
        hasPreviousPage:telemetry?.checkProgress.hasPreviousPage,
        acceptedPages:telemetry?.checkProgress.acceptedParsedPages ?? 0,pageUpdateCallbacks:telemetry?.checkProgress.pageUpdateCallbacks ?? 0,
        producedMessages:max(telemetry?.checkProgress.producedMessages ?? 0,telemetry?.checkProgress.uniqueMessagesProduced ?? 0),
        paginationProgressObserved:telemetry?.checkProgress.paginationProgressObserved ?? false,
        completionProven:telemetry?.checkProgress.historyCompleteProven ?? false)
       let terminal:String
       if let partialAggregate {
        saved.aggregate=partialAggregate
        saved.partialObservedActivityAt=record.lastSeenUpdatedAt
        saved.paginationBoundaryMessageCount=partialAggregate.messagesCollected
        terminal="Partial · pagination_progressing · per_chat_timeout · \(budgetTimeout)"
        saved.lastCheckResult=terminal
       } else {
        terminal="Timed out · per_chat_timeout · \(subtype) · \(budgetTimeout)"
        saved.lastCheckResult=terminal
       }
       saved.consecutiveIncompleteChecks+=1
       // Detach this generation before the next chat starts; late worker cleanup
       // will be rejected by the same generation check.
       _=clearChatCheckState(ownerGeneration:chatCheckTelemetry?.operationGeneration ?? "",caller:"timeout handler")
       finishChatCheckReport(terminal:terminal,ordinal:checked,eligibilityReason:staleIncompleteMaintenanceEligibilityReason(admitted:maintenanceCandidateIDs.contains(record.conversationId)))
       cycleFreshRiskCounts["Unknown",default:0] += 1
      }
      else {
       saved.lastCheckResult="Failed · check_error"
       saved.consecutiveIncompleteChecks+=1
       finishChatCheckReport(terminal:"Failed · check_error",ordinal:checked,eligibilityReason:staleIncompleteMaintenanceEligibilityReason(admitted:maintenanceCandidateIDs.contains(record.conversationId)))
      }
     }
     if saved.lastCheckResult=="Complete" {saved.pendingActivityNeedsAttention=false}
     else if activityPendingAtCheckStart {saved.pendingActivityNeedsAttention=true}
     let finalMeasurement=riskMeasurementStatus(result:saved.lastCheckResult,aggregate:saved.aggregate)
     if let aggregate=saved.aggregate,finalMeasurement != .complete {
      let model=buildRiskModel(samples:personalRiskSamples(replacing:saved))
      if let level=incompleteRiskNotificationNeeded(measurement:finalMeasurement,lastAcceptedRank:saved.lastNotifiedRiskRank,lowerBoundTokens:aggregate.estimatedTextTokens,model:model),
         let content=partialRiskNotificationContent(level:level) {
       submitMonitoredNotification(kind:"risk",level:level,body:content.body,conversationID:saved.conversationId)
      } else {cycleRiskNotificationsSuppressed+=1}
     }
     let warningNow=Date().timeIntervalSince1970*1000
     let warningModel=buildRiskModel(samples:personalRiskSamples(replacing:saved))
     let completeAndCurrent=riskMeasurementStatus(result:saved.lastCheckResult,aggregate:saved.aggregate) == .complete && saved.lastCheckedUpdatedAt != nil && saved.lastSeenUpdatedAt<=saved.lastCheckedUpdatedAt!
     if completeAndCurrent {saved.uncertainSince=nil;saved.uncertainAcknowledgedAt=nil}
     let monitoring=monitoringState(record:saved,model:warningModel,nowMs:warningNow)
     if monitoring == .uncertain {
      if saved.uncertainSince == nil {saved.uncertainSince=saved.lastCheckAt ?? warningNow}
      if let acknowledged=saved.uncertainAcknowledgedAt,saved.lastSeenUpdatedAt>acknowledged {saved.uncertainAcknowledgedAt=nil}
     }
     let terminal=saved.lastCheckResult ?? "Failed · check_error"
     if let aggregate=saved.aggregate {
      let accepted=terminal=="Complete" && aggregate.historyComplete && aggregate.hasPreviousPage==false
      let progress=chatCheckTelemetry?.checkProgress
      let reason:String
      if accepted {reason="none"}
      else if (progress?.parserAccepted ?? 0)==0 {reason="no_accepted_history_response"}
      else if aggregate.messagesCollected==0 {reason="aggregate_empty"}
      else if (progress?.hasPreviousPage ?? aggregate.hasPreviousPage)==true {reason="has_previous_page_true"}
      else if (progress?.hasPreviousPage ?? aggregate.hasPreviousPage)==nil {reason="has_previous_page_unknown"}
      else if progress?.historyCompleteProven != true {reason="terminal_false_page_observed"}
      else {reason="completion_proof_not_set"}
      cycleState.recordPerChatCompletionDecision(candidate:progress?.historyCompleteProven ?? false,accepted:accepted,reason:reason,aggregate:aggregate,hasPreviousPage:progress?.hasPreviousPage ?? aggregate.hasPreviousPage,historyComplete:progress?.historyCompleteProven ?? false)
     } else {
      let empty=SafeAggregate(conversationId:record.conversationId,title:"",processedMessageIds:[],messagesCollected:0,userMessages:0,assistantMessages:0,otherMessages:0,estimatedTextTokens:0,attachments:.init(images:0,audio:0,video:0,files:0),historyComplete:false,hasPreviousPage:chatCheckTelemetry?.checkProgress.hasPreviousPage,hasNextPage:nil,responsesCaptured:0,updatedAt:nil)
      cycleState.recordPerChatCompletionDecision(candidate:chatCheckTelemetry?.checkProgress.historyCompleteProven ?? false,accepted:false,reason:(chatCheckTelemetry?.checkProgress.parserAccepted ?? 0)==0 ? "no_accepted_history_response":"aggregate_empty",aggregate:empty,hasPreviousPage:chatCheckTelemetry?.checkProgress.hasPreviousPage,historyComplete:chatCheckTelemetry?.checkProgress.historyCompleteProven ?? false)
     }
     cycleState.recordPerChatPersistedAggregate(saved.aggregate)
     cycleState.finishPerChatHistoryDiagnostic(terminal:terminal,telemetry:chatCheckTelemetry)
     finishPersistedChatCheckTrace(terminalResult:terminal,expectedConversationID:record.conversationId,generation:chatCheckTraceGeneration ?? "")
     cycleState.records[record.conversationId]=saved;saveCycle();updateCurrentCycleSummary();chatCheckBudgetController=nil
    }
    cycleState.lastCoverageStatus=composite.status;cycleState.lastCoverageDetail=composite.detail
    cycleState.lastCoverageCutoff=cycleCutoffTimestamp
    cycleState.lastOldestObservedAt=observations.flatMap{$0.pages}.flatMap{$0.times}.min()
    cycleState.lastDiscoveredPages=observations.reduce(0){$0+$1.pages.count}+cycleProjectPages
    cycleState.lastDiscoveredListResponses=cycleValidListResponses;cycleState.lastDiscoveredConversations=cycleIds.count
    let freshRisk=cycleFreshRiskCounts.map{"\($0.key) \($0.value)"}.sorted().joined(separator:", ")
    let summary=CycleChatOutcomeCounts(finalPerChatResults:cycleChatTerminalResults,freshRiskCounts:cycleFreshRiskCounts)
    let riskModel=currentRiskModel().source.rawValue
    cycleState.lastStatus="Last cycle: \(Date().formatted(date:.omitted,time:.shortened))\nCoverage: \(coverageDisplayLabel(composite)) · \(composite.detail)\nCoverage scope: \(composite.scope)\nDiscovery source: \(cycleDiscoverySource) · DOM candidates \(cycleDOMCandidateCount) · accepted conversation rows \(cycleDOMAcceptedRowCount) · rejected navigation rows \(cycleDOMRejectedNavigationRowCount) · coverage reason \(composite.detail)\nCombined unique: \(cycleIds.count) · recent: \(recent.count)\nStale incomplete maintenance: eligible \(maintenance.eligibleCount) · admitted \(maintenance.admitted.count) · deferred by cap \(maintenance.deferredCount)\nChecked: \(summary.checked) · Complete: \(summary.complete) · Failed: \(summary.failed) · Partial: \(summary.partial) · Skipped unchanged: \(max(0,checkCandidates.count-queue.count)) · Skipped cycle budget: \(cycleBudgetSkipped)\nFresh risk (current cycle, \(riskModel)): \(freshRisk)\nNotifications generated/suppressed: \(cycleRiskNotificationsGenerated)/\(cycleRiskNotificationsSuppressed)\nProvenance before: \(cycleProvenanceBefore)\nProvenance after: \(cycleProvenanceSummary())\nRender lease cleanup: \(renderLeaseCleanupSummary)"
   } catch {
    cycleState.discoveryStatus = .incomplete
    cycleState.lastCoverageStatus = .incompleteStall
    cycleState.lastCoverageDetail = "render_surface_readiness_failed"
    cycleState.monitoringDegraded = true
    cycleState.lastStatus="Cycle stopped · render/readiness operation unavailable"
   }
  }
 }
 // One read-only prefix pass per cycle. ID-bearing records stay internal.
 func discoverPinnedPrefix(renderLeaseOwner:String) async throws -> PinnedCoverageProof {
  cyclePhase="Inspecting pinned prefix";renderCycle();cyclePinnedResult=nil
  let tokenData=try JSONSerialization.data(withJSONObject:[cycleToken])
  let token=String(data:tokenData,encoding:.utf8)!+"[0]"
  let leaseAcquired=backgroundRenderLeaseOwner==renderLeaseOwner
  let renderSurfaceActive=leaseAcquired && session.isVisible && !web.isHidden && session.ignoresMouseEvents && web.bounds.width>0 && web.bounds.height>0
  let navigationActive=web.isLoading
  let activationElapsed=backgroundRenderLeaseActivatedAt.map{max(0,Int(Date().timeIntervalSince($0)*1000))} ?? 0
  let visibleArg=renderSurfaceActive ? "true":"false",navigationArg=navigationActive ? "true":"false"
  let script="void window.gptInspectVisiblePinnedRows({maxRows:20,hardTimeoutMs:40000,preflightTimeoutMs:18000,webViewVisible:\(visibleArg),navigationActive:\(navigationArg),renderActivationElapsedMs:\(activationElapsed),renderLeaseTimeToFirstConversationLinkMs:\(backgroundRenderLeaseTimeToFirstConversationLinkMs ?? -1),cycleToken:\(token)}).then(result=>window.webkit.messageHandlers.starredDiagnostic.postMessage({cycleToken:\(token),cyclePinnedResult:result})).catch(()=>window.webkit.messageHandlers.starredDiagnostic.postMessage({cycleToken:\(token),cyclePinnedResult:{stopReason:'bridge_result_missing',pinnedPrefixReason:'bridge_result_missing',pinnedPrefixStatus:'pinned_prefix_unproven',traversalTerminal:{stage:'bridge_promise',internalReason:'bridge_result_missing',rowIndex:null,processedCount:0,semanticSnapshotValid:null,scrollAttempted:false,menuCleanupResult:'not_run',leaseValid:true,timeout:false,cancelled:false}}})); true;"
  _ = try await evaluateForCycle(script)
  let started=Date()
  while cyclePinnedResult==nil && Date().timeIntervalSince(started)<43 {
   try await pauseCycle(0.1)
   if discoveryRateLimited(Array(cycleRootStatuses)) {break}
  }
  let result:[String:Any]=cyclePinnedResult ?? ["stopReason":"pinned_prefix_result_timeout","pinnedPrefixReason":"pinned_prefix_result_timeout","readiness":["status":"timeout","terminalReason":"pinned_prefix_result_timeout"],"traversalTerminal":["stage":"native_result_wait","internalReason":"pinned_prefix_result_timeout","rowIndex":NSNull(),"processedCount":0,"semanticSnapshotValid":NSNull(),"scrollAttempted":false,"menuCleanupResult":"not_run","leaseValid":backgroundRenderLeaseOwner==renderLeaseOwner,"timeout":true,"cancelled":false]],top=result["sidebarTop"] as? [String:Any] ?? [:]
  let readiness=result["readiness"] as? [String:Any] ?? [:],preflight=result["preflight"] as? [String:Any] ?? [:]
  let rows=result["rows"] as? [[String:Any]] ?? [],statuses=rows.compactMap{$0["status"] as? String}
  cycleState.lastPinnedUnknownRows=Array((result["unknownRowDiagnostics"] as? [[String:Any]] ?? []).prefix(PinnedUnknownRowDiagnostic.maxRows)).compactMap(PinnedUnknownRowDiagnostic.make)
  let records=result["pinnedRecords"] as? [[String:Any]] ?? []
  var resolved=0,recent=0,sources=[String](),activityFailures=[String]()
  let pinnedCount=result["pinnedCount"] as? Int ?? 0
  let structureComplete=result["pinnedStructureComplete"] as? String == "complete" && result["menuLeftOpen"] as? Bool == false
  if structureComplete {
   for record in records {
    try Task.checkCancellation()
    if discoveryRateLimited(Array(cycleRootStatuses)) || Date()>=cycleDiscoveryDeadline {break}
    guard let id=record["conversationId"] as? String,id.range(of:"^[A-Za-z0-9-]+$",options:.regularExpression) != nil else {continue}
    var activity=record
    if !validPinnedActivity(activity) {activity=try await loadPinnedActivity(record)}
    if let failure=activity["timestampError"] as? String {activityFailures.append(failure);continue}
    guard validPinnedActivity(activity),let time=activity["lastActivityAt"] as? Double else {continue}
    resolved+=1;sources.append(activity["activitySource"] as? String ?? "unknown")
    cycleState.merge([["conversationId":id,"title":cycleState.records[id]?.title ?? "Chat","updatedAt":time]],source:LastSeenUpdatedAtSource.fromActivitySource(activity["activitySource"] as? String))
    cycleIds.insert(id)
    if time>=cycleCutoffTimestamp {recent+=1}
   }
  }
  let topLabel=top["proof"] as? String ?? "not_run",topReason=top["reason"] as? String ?? "unknown"
  let geometry=top["precedingGeometry"] as? [String:Any] ?? [:],virtualization=top["virtualization"] as? [String:Any] ?? [:]
  let normalization=top["normalization"] as? [String:Any] ?? [:]
  let readinessLabel=readiness["status"] as? String ?? "not_run",readinessReason=readiness["terminalReason"] as? String ?? "unknown"
  let firstRows=readiness["firstPositiveCount"] as? Int ?? 0,stableRows=readiness["finalStableCount"] as? Int ?? 0
  let sidebarCandidates=preflight["sidebarContainerCandidates"] as? Int ?? 0,listCandidates=preflight["listRegionCandidates"] as? Int ?? 0
  let activeSidebarOrdinal=preflight["activeSidebarCandidateOrdinal"] as? Int
  let renderedSidebarCandidates=preflight["renderedIntersectingSidebarCandidates"] as? Int ?? 0
  let activeSidebarLinks=preflight["activeSidebarConversationLinks"] as? Int ?? 0,activeSidebarVisibleLinks=preflight["activeSidebarVisibleConversationLinks"] as? Int ?? 0
  let inactiveSidebarCandidates=preflight["inactiveSidebarCandidates"] as? Int ?? 0,duplicateRows=preflight["duplicateConversationRows"] as? Int ?? 0
  let activeContext=top["activeContextType"] as? String ?? "unknown",rowsOutsideContext=top["rowsOutsideActiveContext"] as? Int ?? 0
  let inactiveRowsExcluded=top["inactiveRowsExcluded"] as? Int ?? 0
  let totalTopRows=top["totalConversationLinks"] as? Int ?? 0,visibleTopRows=top["visibleConversationLinks"] as? Int ?? 0,rowsBefore=top["domConversationRowsBefore"] as? Int ?? 0
  let scrollTopText=(top["scrollTop"] as? Int).map(String.init) ?? "none"
  let viewportTopText=(top["viewportTop"] as? Int).map(String.init) ?? "unknown",viewportBottomText=(top["viewportBottom"] as? Int).map(String.init) ?? "unknown"
  let geometryCount={ (key:String)->Int in geometry[key] as? Int ?? 0 }
  let transformEvidence=virtualization["transformOffset"] as? Bool == true,spacerEvidence=virtualization["spacerBefore"] as? Bool == true,indexEvidence=virtualization["positiveRowIndex"] as? Bool == true
  let leaseActiveAfter=backgroundRenderLeaseOwner==renderLeaseOwner && session.isVisible && !web.isHidden && session.ignoresMouseEvents && web.bounds.width>0 && web.bounds.height>0
  let prefixResult=result["pinnedPrefixStatus"] as? String ?? "pinned_prefix_unproven",prefixReason=result["pinnedPrefixReason"] as? String ?? result["stopReason"] as? String ?? "unknown"
  let proofFailureReason:String
  if !leaseAcquired {proofFailureReason="render_lease_not_acquired"}
  else if readinessLabel != "snapshot_ready" {proofFailureReason=readinessReason}
  else if top["atTop"] as? Bool != true {proofFailureReason=topReason}
  else if statuses.contains("unknown") {proofFailureReason="unknown_row_in_stable_snapshot"}
  else if !structureComplete {proofFailureReason=prefixReason}
  else if resolved != pinnedCount {proofFailureReason=activityFailures.first ?? "pinned_activity_unresolved"}
  else {proofFailureReason="none"}
  var proof=PinnedCoverageProof(top:top["atTop"] as? Bool == true && structureComplete,statuses:statuses,pinnedCount:pinnedCount,timestampsResolved:resolved,recentCount:recent,unresolvedReason:proofFailureReason)
  proof.completionReason=proof.complete ? prefixReason : nil
  proof.readinessStatus=readinessLabel
  proof.readinessReason=readinessReason
  proof.topProven=top["atTop"] as? Bool
  proof.prefixCompleteReported=prefixResult=="pinned_prefix_complete"
  let pinnedTotalLabel=proof.prefixComplete ? String(pinnedCount):"unknown"
  let activityResolutionLabel=proof.prefixComplete ? "\(resolved)/\(pinnedCount)":"unknown/unknown"
  let pinnedUnknownLabel=proof.prefixComplete ? String(max(0,pinnedCount-resolved)):"unknown"
  let snapshotTrace=result["snapshotTrace"] as? [String:Any] ?? [:]
  let snapshotBaseline=snapshotTrace["baseline"] as? [String:Any] ?? [:]
  let snapshotStages=snapshotTrace["stages"] as? [[String:Any]] ?? []
  let firstSnapshotChange=snapshotTrace["firstChange"] as? [String:Any] ?? [:]
  let traversalTerminal=result["traversalTerminal"] as? [String:Any] ?? [:]
  let terminalLastCompleted=traversalTerminal["lastCompletedStage"] as? String ?? "not_reported"
  let terminalStage=traversalTerminal["stage"] as? String ?? "result_telemetry_missing"
  let terminalReason=traversalTerminal["internalReason"] as? String ?? result["stopReason"] as? String ?? "bridge_result_invalid"
  let terminalRow=(traversalTerminal["rowIndex"] as? Int).map(String.init) ?? "none"
  let terminalProcessed=traversalTerminal["processedCount"] as? Int ?? rows.count
  let terminalSnapshotValid=(traversalTerminal["semanticSnapshotValid"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"
  let terminalScroll=(traversalTerminal["scrollAttempted"] as? Bool)==true ? "yes":"no"
  let terminalMenu=traversalTerminal["menuCleanupResult"] as? String ?? "unknown"
  let terminalLease=leaseAcquired && backgroundRenderLeaseOwner==renderLeaseOwner ? "yes":"no"
  let terminalTimeout=(traversalTerminal["timeout"] as? Bool)==true ? "yes":"no",terminalCancelled=(traversalTerminal["cancelled"] as? Bool)==true ? "yes":"no"
  let traversalCapacity=result["traversalCapacity"] as? [String:Any] ?? [:]
  let capacityNumber={ (key:String)->String in (traversalCapacity[key] as? NSNumber).map{String($0.intValue)} ?? "unknown" }
  let capacitySufficient=(traversalCapacity["budgetSufficient"] as? Bool).map{$0 ? "yes":"no"} ?? "unknown"
  let snapshotBaselineText=snapshotBaseline.isEmpty ? "unavailable" : "rows \(snapshotBaseline["rowCount"] ?? "?") · identities \(snapshotBaseline["identityCount"] ?? "?") · set \(snapshotBaseline["setFingerprint"] ?? "?") · order \(snapshotBaseline["orderFingerprint"] ?? "?")"
  let snapshotStageText=snapshotStages.map{stage in "\(stage["stage"] ?? "unknown") rows \(stage["rowCount"] ?? "?") identities \(stage["identityCount"] ?? "?") set \(stage["setFingerprint"] ?? "?") order \(stage["orderFingerprint"] ?? "?")"}.joined(separator:" → ")
  let snapshotChangeText=firstSnapshotChange.isEmpty ? "none" : "\(firstSnapshotChange["stage"] ?? "unknown") · before \(firstSnapshotChange["previousRowCount"] ?? "?") rows/\(firstSnapshotChange["previousIdentityCount"] ?? "?") identities · after \(firstSnapshotChange["currentRowCount"] ?? "?") rows/\(firstSnapshotChange["currentIdentityCount"] ?? "?") identities · set changed \(firstSnapshotChange["setChanged"] as? Bool == true ? "yes":"no") · order changed \(firstSnapshotChange["orderChanged"] as? Bool == true ? "yes":"no") · added \(firstSnapshotChange["addedCount"] ?? "?") · removed \(firstSnapshotChange["removedCount"] ?? "?") · reordered \(firstSnapshotChange["reordered"] as? Bool == true ? "yes":"no") · preceding action \(firstSnapshotChange["precedingAction"] ?? "unknown")"
  cyclePinnedReport="Production pinned-prefix telemetry: render lease acquired \(leaseAcquired ? "yes":"no") · render surface active \(renderSurfaceActive ? "yes":"no") · lease held through result \(leaseActiveAfter ? "yes":"no")\nSidebar candidates \(sidebarCandidates) · active candidate \(activeSidebarOrdinal.map(String.init) ?? "none") · inactive candidates \(inactiveSidebarCandidates) · duplicate conversation rows across candidates \(duplicateRows) · list-region candidates \(listCandidates)\nActive list context \(activeContext) · rows outside active context \(rowsOutsideContext) · first conversation links \(firstRows) · stable conversation links \(stableRows)\nReadiness \(readinessLabel) · reason \(readinessReason) · Phase A \(readiness["phaseABudgetMs"] as? Int ?? 4000)ms · grace \(readiness["stabilizationGraceMs"] as? Int ?? 1200)ms · absolute cap \(readiness["absoluteReadinessCapMs"] as? Int ?? 6000)ms · stable samples \(readiness["stableCount"] as? Int ?? 0)/4 · stable duration \(readiness["timeToStableMs"] as? Int ?? 0)/320ms · grace activated \(readiness["extensionActivated"] as? Bool == true ? "yes":"no")\nTop proof \(topLabel) · reason \(topReason) · scroll container \(top["scrollableAncestorFound"] as? Bool == true ? "yes":"no") · scrollTop \(scrollTopText) · viewport \(viewportTopText)…\(viewportBottomText)\nActive context rows total/visible \(totalTopRows)/\(visibleTopRows) · rows before first visible \(rowsBefore) · rows inspected \(rows.count)\nPreceding rows: fully above \(geometryCount("fullyAboveViewport")) · intersects viewport \(geometryCount("intersectsViewport")) · display:none \(geometryCount("displayNone")) · visibility:hidden \(geometryCount("visibilityHidden")) · aria-hidden \(geometryCount("ariaHidden")) · zero-size \(geometryCount("zeroSize")) · same scroll container \(geometryCount("sameScrollContainer")) · in active sidebar \(geometryCount("activeSidebarCandidate")) · max above delta \(geometryCount("maxAboveViewportDeltaPx")) px\nVirtualization evidence: transformOffset \(transformEvidence ? "yes":"no") · spacerBefore \(spacerEvidence ? "yes":"no") · positiveRowIndex \(indexEvidence ? "yes":"no")\nPrefix \(prefixResult) · reason \(prefixReason)\nPinned top proof: \(topLabel)\nRows inspected: \(rows.count) · \(statuses.joined(separator:" → "))\nPinned total \(pinnedTotalLabel) · unknown rows \(statuses.filter{$0=="unknown"}.count) · activity resolved \(activityResolutionLabel) · activity unknown \(pinnedUnknownLabel) · recent pinned \(proof.prefixComplete ? String(recent):"unknown")\nActivity sources: \(sources.joined(separator:", ")) · activity errors: \(activityFailures.isEmpty ? "none":activityFailures.joined(separator:", ")) · pinned proof \(proof.complete ? "complete":"unproven")"
  if !cycleState.lastPinnedUnknownRows!.isEmpty {cyclePinnedReport += "\nPinned proof unknown rows: \(cycleState.lastPinnedUnknownRows!.count)\n"+cycleState.lastPinnedUnknownRows!.map(\.detailLine).joined(separator:"\n")}
  cyclePinnedReport += "\nSemantic snapshot baseline: \(snapshotBaselineText)\nSemantic snapshot stages: \(snapshotStageText.isEmpty ? "none":snapshotStageText)\nFirst semantic change: \(snapshotChangeText)"
  cyclePinnedReport += "\nTraversal terminal: last successful stage \(terminalLastCompleted) · failure stage \(terminalStage) · low-level reason \(terminalReason) · row \(terminalRow) · processed \(terminalProcessed) · semantic snapshot valid \(terminalSnapshotValid) · scroll attempted \(terminalScroll) · menu cleanup \(terminalMenu) · render lease valid \(terminalLease) · timeout/cancel \(terminalTimeout)/\(terminalCancelled) · canonical fallback reason \(proof.complete ? "none":proofFailureReason)"
  cyclePinnedReport += "\nTraversal capacity: snapshot rows \(capacityNumber("snapshotRows")) · required rows \(capacityNumber("requiredTraversalRows")) · selected budget \(capacityNumber("selectedBudget")) · absolute cap \(capacityNumber("absoluteCap")) · budget sufficient \(capacitySufficient) · processed rows \(capacityNumber("processedRows"))"
  cyclePinnedReport += "\nActive candidate geometry: rendered/intersecting candidates \(renderedSidebarCandidates) · active links/visible links \(activeSidebarLinks)/\(activeSidebarVisibleLinks) · inactive rows excluded \(inactiveRowsExcluded)"
  let normalizedRect={ (value:Any?)->String in
   guard let rect=value as? [String:Any] else{return "unknown"}
   return "\(rect["x"] ?? "?")/\(rect["y"] ?? "?") · \(rect["width"] ?? "?")×\(rect["height"] ?? "?")"
  }
  let normalizedViewport={ (suffix:String)->String in "\(normalization["viewportTop\(suffix)"] ?? "?")…\(normalization["viewportBottom\(suffix)"] ?? "?")" }
  let normalizedScroll={ (key:String)->String in
   let state=normalization[key] as? [String:Any] ?? [:]
   return "\(state["windowY"] ?? "?")/\(state["documentTop"] ?? "?")/\(state["bodyTop"] ?? "?")"
  }
  let normalizeBool={ (key:String)->String in (normalization[key] as? Bool)==true ? "yes":"no" }
  cyclePinnedReport += "\nFirst-row normalization: invoked \(normalizeBool("invoked")) · rows before \(normalization["totalRowsBefore"] ?? "unknown")/\(normalization["visibleRowsBefore"] ?? "unknown") · rows after \(normalization["totalRowsAfter"] ?? "unknown")/\(normalization["visibleRowsAfter"] ?? "unknown") · before-first-visible \(normalization["rowsBeforeFirstVisible"] ?? "unknown")→\(normalization["rowsBeforeFirstVisibleAfter"] ?? "unknown") · rect \(normalizedRect(normalization["firstRowGeometryBefore"]))→\(normalizedRect(normalization["firstRowGeometryAfter"])) · viewport \(normalizedViewport("Before"))→\(normalizedViewport("After")) · window/document/body scroll Y \(normalizedScroll("scrollStateBefore"))→\(normalizedScroll("scrollStateAfter")) · changed \(normalizeBool("windowScrollChanged"))/\(normalizeBool("documentScrollChanged"))/\(normalizeBool("bodyScrollChanged")) · geometry changed \(normalizeBool("firstRowGeometryChanged")) · changed ancestors \(normalization["changedScrollAncestors"] ?? "unknown") · first row visible after \(normalizeBool("firstRowVisibleAfter")) · reason \(normalization["reason"] as? String ?? "not_run")"
  return proof
 }
 func validPinnedActivity(_ data:[String:Any])->Bool {
  let time=(data["timestamp"] as? Double) ?? (data["lastActivityAt"] as? Double)
  let source=(data["timestampSource"] as? String) ?? (data["activitySource"] as? String)
  let backendSource=source?.range(of:#"^(conversation_messages|conversation_detail|root_conversation_list|project_conversation_list|conversation_related_other)\.(update_time|last_activity_at|updated_at|lastActivityAt|activity_at|activity_time|last_message_at|last_message_time|latest_message\.(update_time|create_time))$"#,options:.regularExpression) != nil
  guard let time,time.isFinite,time>0,time<=Date().timeIntervalSince1970*1000,
   let source,(["conversation_update_time","conversation_activity_timestamp","latest_message_timestamp"].contains(source)||backendSource) else{return false}
  return true
 }
 func loadPinnedActivity(_ record:[String:Any]) async throws -> [String:Any] {
  cyclePhase="Resolving pinned activity timestamp";renderCycle()
  guard let id=record["conversationId"] as? String,id.range(of:"^[A-Za-z0-9-]{1,128}$",options:.regularExpression) != nil,
        let route=record["frontendRoute"] as? String,route.hasPrefix("/"),!route.hasPrefix("//"),
        let url=URL(string:"https://chatgpt.com"+route),url.host=="chatgpt.com",url.query==nil,url.fragment==nil,
        let routeConversation=conversationID(in:url),routeConversation==id else{return [:]}
  cycleActivity=nil;cyclePinnedNavigation=nil;cyclePinnedNavigationFinished=false;cyclePinnedNavigationError=nil
  // Native in-memory ownership is injected at document start; no target or rate context is stored in sessionStorage.
  guard installPinnedActivityContextUserScript(owner:"scheduler_conversation_check",generation:cycleToken,stage:"conversation_check"),
        let navigation=web.load(URLRequest(url:url)) else {restoreRuntimeUserScripts();return [:]}
  cyclePinnedNavigation=navigation
  defer {restoreRuntimeUserScripts();if let active=cyclePinnedNavigation,active===navigation {cyclePinnedNavigation=nil};cyclePinnedNavigationFinished=false;cyclePinnedNavigationError=nil}
  let navigationStarted=Date()
  while !cyclePinnedNavigationFinished && cyclePinnedNavigationError==nil && Date().timeIntervalSince(navigationStarted)<10 && Date()<cycleDiscoveryDeadline {
   try await pauseCycle(0.1)
   if discoveryRateLimited(Array(cycleRootStatuses)) {return [:]}
  }
  guard cyclePinnedNavigationFinished,cyclePinnedNavigationError==nil else {cyclePinnedNavigation=nil;return [:]}
  let expected=try JSONSerialization.data(withJSONObject:[id])
  guard let expectedJSON=String(data:expected,encoding:.utf8),
        let routeResult=try await evaluateForCycle("(()=>{const expected=\(expectedJSON)[0],p=location.pathname;let m=p.match(/^\\/c\\/([^/]+)\\/?$/);if(m)return {template:'/c/<id>',matches:m[1]===expected};m=p.match(/^\\/g\\/([^/]+)\\/c\\/([^/]+)\\/?$/);return m?{template:'/g/<id>/c/<id>',matches:m[2]===expected}:{template:'unknown',matches:false};})()") as? [String:Any],
        (routeResult["matches"] as? Bool)==true,(routeResult["template"] as? String) != "unknown" else {cyclePinnedNavigation=nil;return [:]}
  let started=Date()
  while Date().timeIntervalSince(started)<30 && Date()<cycleDiscoveryDeadline {
   try await pauseCycle(0.25)
   if discoveryRateLimited(Array(cycleRootStatuses)) {return [:]}
   if let activity=cycleActivity,pinnedActivityEventMatches(activity,expectedConversationID:id,expectedOwner:"scheduler_conversation_check",expectedGeneration:cycleToken) {
    let status=(activity["httpStatus"] as? NSNumber)?.intValue ?? 0
    if status==429 {return ["timestampError":"activity_http_429"]}
    if (200...299).contains(status),validPinnedActivity(activity),let time=activity["timestamp"] as? Double,let source=activity["timestampSource"] as? String {
     let family=activity["endpointFamily"] as? String,field=activity["timestampField"] as? String
     let provenance=(family != nil && field != nil) ? "\(family!).\(field!)":source
     return ["lastActivityAt":time,"activitySource":provenance]
    }
   }
  }
  cyclePinnedNavigation=nil
  return [:]
 }
 func conversationID(in url:URL)->String? {
  let parts=url.path.split(separator:"/").map(String.init)
  guard let index=parts.lastIndex(of:"c"),index+1<parts.count else{return nil}
  let id=parts[index+1]
  return id.range(of:"^[A-Za-z0-9-]{1,128}$",options:.regularExpression) != nil ? id:nil
 }
 func checkRecord(_ record: ChatRecord,continuation:ChatCheckContinuationCheckpoint?=nil,budget:ChatCheckBudgetController) async throws -> (SafeAggregate?,String) {
  let token=UUID().uuidString;automationToken=token;automationUpdate=nil;chatCheckTerminalUpdate=nil;navigationFinished=false
  chatCheckTraceGeneration=token
  cycleState.beginPerChatHistoryDiagnostic(ordinal:cycleCurrentChatCheckOrdinal)
  cycleState.beginHistoryResponseParsing()
  cycleState.beginChatCheckTrace(route:sanitizedChatCheckRoute(web.url))
  saveCycle();lastChatCheckTraceOutput.stringValue=cycleState.lastChatCheckTrace?.displayText ?? "Last standard chat check trace: not recorded"
  activeChatCheckWorkers.insert(token)
  chatCheckLastCheckpointAt=nil
  chatCheckExpectedConversationID=record.conversationId
  chatCheckTelemetry=ChatCheckStageTelemetry(renderLeaseActive:backgroundRenderLeaseOwner != nil)
  chatCheckBudgetController=budget
  if var telemetry=chatCheckTelemetry {
   if let continuation {
    telemetry.timing=continuation.timing
    telemetry.timing.continuationBaselineMessages=continuation.firstPassMessages
    if telemetry.timing.continuationStartedAt==nil {telemetry.timing.beginContinuation(at:Date())}
        telemetry.checkProgress=continuation.historyProgress
        telemetry.hasPreviousPage=continuation.historyProgress.hasPreviousPage ?? continuation.aggregate.hasPreviousPage
        telemetry.historyComplete=continuation.historyProgress.historyCompleteProven
   } else {
    telemetry.timing.initialAggregateMessages=record.aggregate?.messagesCollected ?? 0
   }
   telemetry.generationCreated=true;telemetry.operationGeneration=token
   telemetry.pagination=ChatPaginationProgressTracker(initialMessageIDs:Set(record.aggregate?.processedMessageIds ?? []),initialMessageCount:record.aggregate?.messagesCollected ?? 0)
   chatCheckTelemetry=telemetry
  }
  recordChatCheckStage("chat_check_started")
  if !installPinnedActivityContextUserScript(owner:"scheduler_conversation_check",generation:token,stage:"conversation_check") {
   recordChatCheckStage("hook_context_install_failed")
  }
  defer {_=clearChatCheckState(ownerGeneration:token,caller:"worker defer");activeChatCheckWorkers.remove(token)}
  recordChatCheckStage("navigation_started")
  if let continuation {
   if var telemetry=chatCheckTelemetry {
    telemetry.continuationAttempted=true;telemetry.continuationTerminalReason="running";telemetry.continuationSelected=true
    telemetry.continuationStartedAt=Date();telemetry.continuationFrontierPresent=continuation.frontierTimestamp.isFinite && continuation.frontierTimestamp>0
    telemetry.continuationHasPreviousPage=continuation.hasPreviousPage;telemetry.continuationReplayProgressEligible=continuation.replayProgressObserved
    telemetry.continuationNewHistoryProgressEligible=continuation.newHistoryProgressObserved
    telemetry.continuationBaselinePages=continuation.firstPassPages;telemetry.continuationBaselinePageUpdateCallbacks=continuation.firstPassPageUpdateCallbacks;telemetry.continuationBaselineMessages=continuation.firstPassMessages
    telemetry.continuationBaselineHistoryRequests=continuation.firstPassHistoryRequests;telemetry.continuationBaselineHistoryResponses=continuation.firstPassHistoryResponses
    telemetry.recordContinuationStage("continuation_selected",source:"native");telemetry.recordContinuationStage("same_document_preflight",source:"native")
    chatCheckTelemetry=telemetry
   }
   let expectedData=try JSONSerialization.data(withJSONObject:[record.conversationId])
   let expectedJSON=String(data:expectedData,encoding:.utf8) ?? "[]"
   let context=try? await evaluateForCycle("window.gptCheckDocumentIdentity?.(\(expectedJSON)[0])") as? [String:Any]
   let routeUnchanged=context?["routeMatches"] as? Bool==true
   let documentSame=context?["documentIdentity"] as? String==continuation.documentIdentity
   if var telemetry=chatCheckTelemetry {telemetry.recordContinuationStage("same_document_preflight_result",routeUnchanged:routeUnchanged,documentSame:documentSame,source:"native");chatCheckTelemetry=telemetry}
   guard routeUnchanged,documentSame else {
    recordChatCheckStage("continuation_document_identity_rejected")
    if var telemetry=chatCheckTelemetry {telemetry.continuationTerminalReason="document_or_route_changed";telemetry.continuationDiagnosis = routeUnchanged ? "same_document_preflight_failed":"continuation_route_changed";telemetry.recordContinuationStage("continuation_terminal",routeUnchanged:routeUnchanged,documentSame:documentSame,source:"native");chatCheckTelemetry=telemetry}
    _=clearChatCheckState(ownerGeneration:token,caller:"continuation identity rejection")
    activeChatCheckWorkers.remove(token)
    return(continuation.aggregate,"Partial · continuation_document_changed")
   }
   let contextData=try JSONSerialization.data(withJSONObject:["scheduler_conversation_check",token,"continuation"])
   let contextJSON=String(data:contextData,encoding:.utf8) ?? "[]"
   let contextResult=try? await evaluateForCycle("(()=>{window.gptSetRateLimitContext?.(\(contextJSON)[0],\(contextJSON)[1],\(contextJSON)[2]);return window.gptCaptureRateLimitContext?.()})()") as? [String:Any]
   let contextAttached=contextResult?["owner"] as? String=="scheduler_conversation_check" && contextResult?["generation"] as? String==token
   if var telemetry=chatCheckTelemetry {telemetry.recordContinuationStage("same_document_context_attached",routeUnchanged:true,documentSame:true,bridgeResult:contextAttached ? "accepted":"no_result",source:"native");chatCheckTelemetry=telemetry}
   navigationFinished=true
   if var telemetry=chatCheckTelemetry {telemetry.routeReached=true;telemetry.documentIdentity=continuation.documentIdentity;telemetry.paginationFrontierTimestamp=continuation.frontierTimestamp;chatCheckTelemetry=telemetry}
   recordChatCheckStage("continuation_same_document")
  } else {
   let navigation=web.load(URLRequest(url:URL(string:"https://chatgpt.com/c/"+record.conversationId)!))
   recordPersistedChatCheckTrace(stage:.navigationRequested,result:navigation != nil ? .success:.failure,
    reason:navigation != nil ? .navigationRequested:.navigationNotStarted,generation:token)
   guard let navigation else {
    recordChatCheckStage("navigation_load_rejected")
    activeChatCheckWorkers.remove(token)
    return(nil,"Failed · navigation_not_started")
   }
   if var telemetry=chatCheckTelemetry {telemetry.navigationObjectReturned=true;chatCheckTelemetry=telemetry}
   chatCheckNavigation=navigation
   if var telemetry=chatCheckTelemetry {
    telemetry.navigationOwnerGenerationMatches=chatCheckExpectedConversationID==record.conversationId && telemetry.operationGeneration==automationToken
    chatCheckTelemetry=telemetry
   }
  }
  let start=Date();var configured=false;var lastVersion=0;var progress=Date();var lastDOMTurnEvidenceSample=Date.distantPast
  while Date().timeIntervalSince(start)<180 {
   try await pauseCycle(3)
   if !navigationFinished,let reason=chatCheckTelemetry?.navigationTerminalReason,
      ["navigation_provisional_failed","navigation_failed"].contains(reason) {
    return(nil,"Failed · \(reason)")
   }
   if navigationFinished && !configured {
    let tokenData=try JSONSerialization.data(withJSONObject:[token])
    let tokenJSON=String(data:tokenData,encoding:.utf8) ?? "[]"
    if let health=try? await evaluateForCycle("window.gptChatCheckHookHealth?.(\(tokenJSON)[0])") as? [String:Any] {
     if var t=chatCheckTelemetry {
      t.hookInstalled=(health["activityHookInstalled"] as? Bool)==true
      t.fetchHookActive=(health["fetchHookActive"] as? Bool)==true
      t.xhrHookActive=(health["xhrHookActive"] as? Bool)==true
      t.generationAttached=(health["generationAttached"] as? Bool)==true
      t.hookHealthRecorded=true
      chatCheckTelemetry=t
     }
    }
    var config:[String:Any]=["id":record.conversationId,"token":token]
    if let continuation {
     config["continuation"]=true;config["expectedFrontier"]=continuation.frontierTimestamp
     config["replayProgressObserved"]=continuation.replayProgressObserved;config["newHistoryProgressObserved"]=continuation.newHistoryProgressObserved
     config["hasPreviousPage"]=continuation.hasPreviousPage
     if var telemetry=chatCheckTelemetry {telemetry.recordContinuationStage("bridge_command_sent",routeUnchanged:true,documentSame:true,source:"native");chatCheckTelemetry=telemetry}
    }
    config["requireOverlapForComplete"]=record.aggregate?.historyComplete == true && record.lastCheckedUpdatedAt != nil && record.lastSeenUpdatedAt>record.lastCheckedUpdatedAt!
    if let baseline=record.aggregate,let data=try? JSONEncoder().encode(baseline){config["baseline"]=try? JSONSerialization.jsonObject(with:data)}
    let data=try JSONSerialization.data(withJSONObject:config)
    let configureResult=try? await evaluateForCycle("window.gptConfigureCheck?.(\(String(data:data,encoding:.utf8)!))")
    configured=configureResult as? Bool ?? false
    if continuation != nil,var telemetry=chatCheckTelemetry {telemetry.continuationBridgeCallbackResult=configureResult == nil ? "missing":(configured ? "accepted":"rejected");telemetry.recordContinuationStage("bridge_command_result",routeUnchanged:true,documentSame:true,bridgeResult:configured ? "accepted":(configureResult == nil ? "no_result":"rejected"),source:"native");chatCheckTelemetry=telemetry}
    try Task.checkCancellation()
    if configured {
     recordPersistedChatCheckTrace(stage:.historyWaitStarted,result:.success,reason:.historyWaiting,generation:token)
     if continuation != nil,var telemetry=chatCheckTelemetry {telemetry.recordContinuationStage("history_wait_started",routeUnchanged:true,documentSame:true,bridgeResult:telemetry.continuationBridgeSuccess,source:"native");chatCheckTelemetry=telemetry}
     recordChatCheckStage("history_wait_started")
    }
   }
   if let update=automationUpdate,update.token==token {
    if update.received != lastVersion {
     lastVersion=update.received;progress=Date()
     if var t=chatCheckTelemetry {
      t.pagesObserved=max(t.pagesObserved,update.received)
      t.messagesAccumulated=update.state.messagesCollected
      t.hasPreviousPage=update.state.hasPreviousPage
      t.historyComplete=update.state.historyComplete
      chatCheckTelemetry=t
     }
     renderCycle()
    }
    if update.state.historyComplete {
     if record.aggregate?.historyComplete != true || update.overlap || update.oldest {
      if var telemetry=chatCheckTelemetry {telemetry.checkProgress.recordCompletionProof();chatCheckTelemetry=telemetry}
      cycleState.recordPerChatCompletionDecision(candidate:true,accepted:true,reason:"none",aggregate:update.state,hasPreviousPage:update.state.hasPreviousPage,historyComplete:update.state.historyComplete)
      recordChatCheckStage("chat_check_finished");return(update.state,"Complete")
     }
     let rejectedReason:String
     if update.state.messagesCollected==0 {rejectedReason="aggregate_empty"}
     else if update.state.hasPreviousPage==true {rejectedReason="has_previous_page_true"}
     else if update.state.hasPreviousPage==nil {rejectedReason="has_previous_page_unknown"}
     else {rejectedReason="previously_complete_unchanged"}
     cycleState.recordPerChatCompletionDecision(candidate:true,accepted:false,reason:rejectedReason,aggregate:update.state,hasPreviousPage:update.state.hasPreviousPage,historyComplete:update.state.historyComplete)
     if update.state.hasPreviousPage==true {recordChatCheckStage("pagination_started")} else {recordChatCheckStage("history_wait_started")}
    }
   }
   if let update=automationUpdate,update.token==token,
      chatCheckTelemetry?.paginationNoProgressTriggered==true,update.state.hasPreviousPage==true {
    recordChatCheckStage("pagination_no_progress")
    return(update.state,"Partial · pagination_no_progress")
   }
   if configured,Date().timeIntervalSince(lastDOMTurnEvidenceSample)>=3 {
    lastDOMTurnEvidenceSample=Date()
    if let evidence=try? await evaluateForCycle("window.gptConversationTurnReadiness?.()") as? [String:Any] {
     recordChatCheckDOMTurnEvidence(evidence)
    }
   }
   if Date().timeIntervalSince(progress)>45 {
    let subtype=chatCheckTelemetry?.timeoutSubtype ?? "unknown_stage"
    if subtype=="navigation" {if var telemetry=chatCheckTelemetry {telemetry.navigationTerminalReason="navigation_no_progress";chatCheckTelemetry=telemetry}}
    recordChatCheckStage("chat_check_no_progress")
    let matchingUpdate=automationUpdate.flatMap{$0.token==token ? $0:nil}
    let telemetry=chatCheckTelemetry
    let progressState=telemetry?.checkProgress ?? ChatCheckProgressAccumulator()
    let decision=noProgressTerminalDecision(existing:record.aggregate,candidate:matchingUpdate?.state,
     hasProvenHistoryProgress:progressState.hasProvenHistoryProgress,
     hasPreviousPage:progressState.hasPreviousPage,
     completionProven:progressState.historyCompleteProven,subtype:subtype)
    if decision.terminal.hasPrefix("Partial") {return(decision.aggregate,decision.terminal)}
    if (chatCheckTelemetry?.renderedDOMTurnCount ?? 0)>0,chatCheckTelemetry?.historyResponses==0 {
     return(record.aggregate,"Partial · rendered_history_without_network")
    }
    return(nil,decision.terminal)
   }
   if configured {
    let identityArgument=continuation.map { value -> String in
     let data=(try? JSONSerialization.data(withJSONObject:[value.documentIdentity])) ?? Data("[]".utf8)
     return String(data:data,encoding:.utf8) ?? "[]"
    }
    let scrollScript="window.gptScrollHistory?.(\(identityArgument.map{$0+"[0]"} ?? "undefined"))"
    if continuation != nil,var telemetry=chatCheckTelemetry,!telemetry.continuationTriggerAttempted {telemetry.continuationTriggerAttempted=true;telemetry.recordContinuationStage("pagination_trigger_attempted",routeUnchanged:true,documentSame:true,source:"native");chatCheckTelemetry=telemetry}
    let scrollResult=try? await evaluateForCycle(scrollScript)
    if continuation != nil,var telemetry=chatCheckTelemetry,telemetry.continuationTriggerResult=="not_run" {
     telemetry.continuationTriggerResult=(scrollResult as? Bool)==true ? "yes":"no"
     telemetry.recordContinuationStage("pagination_trigger_result",routeUnchanged:true,documentSame:true,bridgeResult:(scrollResult as? String) ?? ((scrollResult as? Bool)==true ? "success":"no_effect"),source:"native");chatCheckTelemetry=telemetry
    }
    if continuation != nil,let reason=scrollResult as? String,reason=="document_changed" || reason=="route_changed" {
     if var telemetry=chatCheckTelemetry {telemetry.continuationTerminalReason=reason;chatCheckTelemetry=telemetry}
     recordChatCheckStage("continuation_\(reason)")
     return(automationUpdate?.state ?? continuation?.aggregate,"Partial · continuation_\(reason)")
    }
    try Task.checkCancellation()
   }
  }
  if automationUpdate != nil {recordChatCheckStage("chat_check_finished");return(automationUpdate?.state,"Partial")}
  let terminal=chatCheckTelemetry?.navigationTerminalReason=="navigation_no_progress" ? "Failed · navigation_no_progress":"Failed · check_timeout_unknown_stage"
  recordChatCheckStage("chat_check_finished");return(nil,terminal)
 }

 func personalRiskSamples(replacing replacement:ChatRecord? = nil) -> [RiskCalibrationSample] {
  var values=cycleState.records.values.map{$0}
  if let replacement,let index=values.firstIndex(where:{$0.conversationId==replacement.conversationId}) {values[index]=replacement}
  return values.compactMap { record in
   guard let label=record.calibrationLabel,let aggregate=record.aggregate,
         riskMeasurementStatus(result:record.lastCheckResult,aggregate:aggregate) == .complete else{return nil}
   return RiskCalibrationSample(label:label,estimatedTextTokens:aggregate.estimatedTextTokens,complete:true)
  }
 }
 func currentRiskModel() -> RiskModel {buildRiskModel(samples:personalRiskSamples())}
 func updateRiskReport() {
  let model=currentRiskModel()
  let records=cycleState.records.values.filter{$0.aggregate != nil && $0.lastCheckResult != nil}
  var counts=["Normal":0,"Watch":0,"Near":0,"Critical":0,"At least Watch":0,"At least Near":0,"At least Critical":0,"Unknown":0]
  var complete=0,partial=0,unknown=0,uncertain=0
  for record in records {
   guard let aggregate=record.aggregate else{continue}
   let measurement=riskMeasurementStatus(result:record.lastCheckResult,aggregate:aggregate)
   if measurement == .complete {complete+=1} else if measurement == .partial {partial+=1} else {unknown+=1}
   let assessment=assessRisk(model:model,estimatedTextTokens:aggregate.estimatedTextTokens,measurement:measurement)
   counts[assessment.level,default:0]+=1
   if monitoringState(record:record,model:model,nowMs:Date().timeIntervalSince1970*1000) == .uncertain {uncertain+=1}
  }
  let samples=personalRiskSamples()
  let normals=samples.filter{$0.label=="normal"}.count,limits=samples.filter{$0.label=="limit_reached"}.count
  let latest=records.max{($0.lastCheckAt ?? 0)<($1.lastCheckAt ?? 0)}
  let latestLine:String
  if let latest,let aggregate=latest.aggregate {
   let status=riskMeasurementStatus(result:latest.lastCheckResult,aggregate:aggregate)
   let assessment=assessRisk(model:model,estimatedTextTokens:aggregate.estimatedTextTokens,measurement:status)
   let label=latest.calibrationLabel == "limit_reached" ? " · empirically labeled Limit reached" : ""
   latestLine="Latest checked aggregate: \(assessment.level) · \(model.source.rawValue) · \(status.rawValue)\(label)"
  } else {latestLine="Latest checked aggregate: not available · \(model.source.rawValue)"}
  let provenance=cachedActivityProvenanceSummary(Array(cycleState.records.values),now:Date().timeIntervalSince1970*1000)
  let provenanceLine="Cached activity provenance: records \(provenance.records) · timestamps \(provenance.timestamps) · trusted \(provenance.trusted) · legacy/unknown \(provenance.legacyOrUnknown) · fresh observations \(provenance.freshObservations) · stale observations \(provenance.staleObservations)"
  let lastDispatch=(cycleState.notificationAudit ?? []).last.map{"\($0.kind) · \($0.level) · \(notificationAuditStatus(outcome:$0.outcome,userVisibleDelivery:$0.userVisibleDelivery))"} ?? "none"
  let acceptedForDisplay=cycleRunning ? cycleRiskNotificationsGenerated:(cycleState.lastCycleNotificationsAccepted ?? cycleRiskNotificationsGenerated)
  let suppressedForDisplay=cycleRunning ? cycleRiskNotificationsSuppressed:(cycleState.lastCycleNotificationsSuppressed ?? cycleRiskNotificationsSuppressed)
  riskOutput.stringValue="Risk model: \(model.source.rawValue) · thresholds Watch \(model.watch), Near \(model.near), Critical \(model.critical) · safe \(model.safeCeiling) / limit floor \(model.limitFloor)\nPersonal calibration sufficient: \(model.source == .personalCalibration ? "Yes":"No") · Complete Normal \(normals), Limit reached \(limits)\nChecked chats by risk: Normal \(counts["Normal"]!) · Watch \(counts["Watch"]!) · Near \(counts["Near"]!) · Critical \(counts["Critical"]!) · At least Watch/Near/Critical \(counts["At least Watch"]!)/\(counts["At least Near"]!)/\(counts["At least Critical"]!) · Unknown \(counts["Unknown"]!) · Uncertain active \(uncertain)\nMeasurements: Complete \(complete) · Partial \(partial) · Unknown \(unknown) · notifications accepted \(acceptedForDisplay) · suppressed \(suppressedForDisplay) · dispatch audit stored locally · latest dispatch \(lastDispatch)\n\(provenanceLine)\n\(latestLine) · Limit reached is only a manual empirical label\nCalibration buttons apply to the latest Complete checked chat; chat titles and IDs are omitted"
 }
 func submitMonitoredNotification(kind:String,level:String,body:String,conversationID:String?) {
  guard shouldDispatchSystemRiskNotification(kind:kind,level:level) else{return}
  let now=Date().timeIntervalSince1970*1000
  let dedupKey="\(kind):\(conversationID ?? "global"):\(level)"
  let auditId=UUID().uuidString
  if (cycleState.notificationAudit ?? []).contains(where:{$0.dedupKey==dedupKey && ($0.outcome=="pending" || $0.outcome=="attempted")}) {return}
  var audit=cycleState.notificationAudit ?? []
  audit.append(NotificationAuditRecord(auditId:auditId,kind:kind,conversationId:conversationID,level:level,createdAt:now,dispatchAttemptedAt:nil,outcome:"pending",dedupKey:dedupKey,userVisibleDelivery:"unknown"))
  if audit.count>500 {audit.removeFirst(audit.count-500)}
  cycleState.notificationAudit=audit
  let cycleOwner=cycleToken
  saveCycle()
  let center=UNUserNotificationCenter.current()
  center.getNotificationSettings { [weak self] settings in
   guard let self else{return}
   guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
    DispatchQueue.main.async {self.finishNotificationAudit(auditId:auditId,outcome:"permission_denied",kind:kind,level:level,conversationID:conversationID,cycleOwner:cycleOwner)};return
   }
   DispatchQueue.main.async {self.markNotificationAttempt(auditId:auditId)}
   let content=UNMutableNotificationContent();content.title="GPT Limits Tool";content.body=body;content.sound = .default
   if let conversationID {content.userInfo=["conversationID":conversationID,"conversationRoute":riskNotificationRoute(conversationID:conversationID) ?? ""]}
   let request=UNNotificationRequest(identifier:"gpt-limits-risk-\(UUID().uuidString)",content:content,trigger:nil)
   center.add(request) { error in
    DispatchQueue.main.async {
     self.finishNotificationAudit(auditId:auditId,outcome:error == nil ? "accepted":"add_error",kind:kind,level:level,conversationID:conversationID,cycleOwner:cycleOwner)
    }
   }
  }
 }
 func markNotificationAttempt(auditId:String) {
  if let index=cycleState.notificationAudit?.lastIndex(where:{$0.auditId==auditId}) {
   cycleState.notificationAudit?[index].dispatchAttemptedAt=Date().timeIntervalSince1970*1000
   cycleState.notificationAudit?[index].outcome="attempted";saveCycle()
  }
 }
 func finishNotificationAudit(auditId:String,outcome:String,kind:String,level:String,conversationID:String?,cycleOwner:String) {
  guard let index=cycleState.notificationAudit?.lastIndex(where:{$0.auditId==auditId}) else{return}
  cycleState.notificationAudit?[index].outcome=outcome
  if outcome=="accepted" {
   if let conversationID,var record=cycleState.records[conversationID] {
    if kind=="risk",let rank=riskRank(level) {record.lastNotifiedRiskRank=rank}
    cycleState.records[conversationID]=record
   }
  }
  if cycleOwner==cycleState.lastCycleGeneration {
   if outcome=="accepted" {cycleState.lastCycleNotificationsAccepted=(cycleState.lastCycleNotificationsAccepted ?? 0)+1}
   else {cycleState.lastCycleNotificationsSuppressed=(cycleState.lastCycleNotificationsSuppressed ?? 0)+1}
   if let range=cycleState.lastStatus.range(of:"Notifications generated/suppressed: [0-9]+/[0-9]+",options:.regularExpression) {
    cycleState.lastStatus.replaceSubrange(range,with:"Notifications generated/suppressed: \(cycleState.lastCycleNotificationsAccepted ?? 0)/\(cycleState.lastCycleNotificationsSuppressed ?? 0)")
   }
  }
  if cycleOwner==cycleToken {
   if outcome=="accepted" {cycleRiskNotificationsGenerated+=1} else {cycleRiskNotificationsSuppressed+=1}
  }
  saveCycle();renderCycle()
 }
 func latestCompleteCalibrationRecordID() -> String? {
  cycleState.records.values.filter{record in
   guard let aggregate=record.aggregate else{return false}
   return riskMeasurementStatus(result:record.lastCheckResult,aggregate:aggregate) == .complete && record.lastCheckAt != nil
  }.max{($0.lastCheckAt ?? 0)<($1.lastCheckAt ?? 0)}?.conversationId
 }
 func setLatestCalibrationLabel(_ label:String?) {
  guard !cycleRunning,let id=latestCompleteCalibrationRecordID(),var record=cycleState.records[id] else {riskOutput.stringValue="Calibration sample unavailable · run a Complete chat check first.";return}
  record.calibrationLabel=label;cycleState.records[id]=record;saveCycle();updateRiskReport();renderCycle()
 }
 @objc func markLatestNormalCalibration(){setLatestCalibrationLabel("normal")}
 @objc func markLatestLimitCalibration(){setLatestCalibrationLabel("limit_reached")}
 @objc func clearLatestCalibration(){setLatestCalibrationLabel(nil)}
}

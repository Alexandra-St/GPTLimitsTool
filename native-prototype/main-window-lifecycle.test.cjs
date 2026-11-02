const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
const model=fs.readFileSync(path.join(__dirname,'CycleModel.swift'),'utf8');
const section=(source,start,end)=>{
  const from=source.indexOf(start);
  const to=source.indexOf(end,from+start.length);
  assert.ok(from>=0,`missing section start: ${start}`);
  assert.ok(to>from,`missing section end: ${end}`);
  return source.slice(from,to);
};

test('main window close hides the retained view tree and reopen reuses it',()=>{
  const construction=section(main,'func buildUserWindows()','func renderUserUI()');
  assert.match(construction,/mainWindow\.isReleasedWhenClosed=false/);
  assert.match(construction,/mainWindow\.delegate=self/);
  assert.match(construction,/let mainContainer=NSView\(\);mainContainer\.addSubview\(content\);mainWindow\.contentView=mainContainer/);

  const close=section(main,'func windowShouldClose(_ window:NSWindow)->Bool','func uiLabel(');
  assert.match(close,/guard window===mainWindow else\{return true\}/);
  assert.match(close,/window\.orderOut\(nil\)/);
  assert.match(close,/return false/);
  assert.doesNotMatch(close,/contentView\s*=\s*nil|removeFromSuperview|\.close\(/);

  const reopen=section(main,'func applicationShouldHandleReopen','func applicationDidFinishLaunching');
  assert.match(reopen,/showMainWindow\(\)/);
  const show=section(main,'@objc func showMainWindow()','@objc func showSettings()');
  assert.match(show,/presentWindow\(mainWindow,intent:\.userInitiated,callSite:"menu_main_window"\)/);
  assert.match(show,/renderUserUI\(\)/);
  assert.doesNotMatch(show,/NSWindow\(|contentView\s*=|removeFromSuperview/);
});

test('main window close interception does not alter other window close behavior',()=>{
  const close=section(main,'func windowShouldClose(_ window:NSWindow)->Bool','func uiLabel(');
  assert.match(close,/guard window===mainWindow else\{return true\}/);
  assert.equal((close.match(/return true/g)||[]).length,1);
});

test('Diagnostics captures sanitized A/B/C main-window view and layer state without changing ownership',()=>{
  const capture=section(main,'func recordMainWindowLifecycleSnapshot(_ stage:String)','func uiLabel(');
  for(const field of [
    'window stable:', 'content stable:', 'controller:', 'root stable:', 'frame/bounds:',
    'hidden:', 'alpha:', 'attached:', 'needsLayout/display:', 'occlusion:',
    'key/main:', 'identityStable:', 'shared main/Diagnostics views/layers:', 'direct subviews'
  ]) assert.ok(capture.includes(field),`missing main window lifecycle field ${field}`);
  assert.match(capture,/mainWindowLifecycleSnapshots\.count>12/);
  assert.doesNotMatch(capture,/title|textContent|stringValue.*record/);

  const callbacks=main.slice(main.indexOf('func windowDidBecomeKey'),main.indexOf('func windowShouldClose'));
  assert.match(callbacks,/B diagnostics became key/);
  assert.match(callbacks,/C main became key/);
  assert.match(callbacks,/C diagnostics will close/);
  assert.match(callbacks,/C after diagnostics close/);

  const showPanel=section(main,'@objc func showPanel()','@objc func showMainWindow()');
  assert.match(showPanel,/A before diagnostics/);
  assert.match(showPanel,/B diagnostics presentation returned/);
  assert.match(showPanel,/B diagnostics next runloop/);
  assert.doesNotMatch(showPanel,/mainWindow\.contentView\s*=|removeFromSuperview|NSWindow\(/);
});

test('main window separates confirmed risks from compact plain-language uncertainty',()=>{
  const construction=section(main,'func buildUserWindows()','func renderUserUI()');
  for(const label of ['Confirmed conversation risks','Needs attention','Hide all until new activity','Show more']) assert.ok(construction.includes(label),`missing uncertainty UX element ${label}`);

  const render=section(main,'func renderUserUI()','func monitoringDegradedReason()');
  assert.match(render,/let confirmed=relevant\.filter\{\$0\.3 != \.uncertain\}/);
  assert.match(render,/let uncertainWithoutConfirmedRisk=relevant\.filter\{\$0\.1 == \.uncertain && \$0\.2 == \.normal\}/);
  assert.match(render,/let activeUncertain=uncertainWithoutConfirmedRisk\.filter\{warningBadgeVisible/);
  assert.match(render,/prefix\(3\)/);
  assert.match(section(main,'func uiLabel(','func buildUserWindows()'),/lineBreakMode = \.byWordWrapping/);
  assert.match(render,/No confirmed limit risk was detected for these chats, but GPT Limits Tool couldn't verify their complete history\./);
  const uncertainty=section(render,'if completeness == .uncertain && state == .uncertain {','mainUncertaintyRows.addArrangedSubview(row)');
  assert.match(uncertainty,/New activity hasn’t been fully checked yet/);
  assert.match(uncertainty,/Couldn’t verify full history/);
  assert.match(uncertainty,/lowerBoundUserLabel/);
  assert.match(uncertainty,/Hide until new activity/);
  assert.match(uncertainty,/Last checked:/);
  assert.doesNotMatch(uncertainty,/monitoringWarningReason|lastCheckResult|per_chat_timeout|pagination_progressing|waiting_history/);
});

test('uncertainty dismissal is UI-only, scoped to current entries, and resurfaces through existing model semantics',()=>{
  const actions=section(main,'@objc func dismissAllUnchangedUncertainty()','func monitoringDegradedReason()');
  assert.match(actions,/monitoringState\(record:record,model:model,nowMs:nowMs\) == \.uncertain/);
  assert.match(actions,/confirmedRiskFromLowerBound\(record\.aggregate\?\.estimatedTextTokens,model:model\) == \.normal/);
  assert.match(actions,/warningBadgeVisible\(record:record,model:model,nowMs:nowMs\)/);
  assert.match(actions,/record\.uncertainAcknowledgedAt=max\(nowMs,record\.lastSeenUpdatedAt\)/);
  assert.doesNotMatch(actions,/lastCheckResult\s*=|aggregate\s*=|uncertainSince\s*=/);
  assert.match(model,/if let acknowledged=record\.uncertainAcknowledgedAt,time>acknowledged \{record\.uncertainAcknowledgedAt=nil\}/);
  assert.match(model,/func warningBadgeVisible\(record:ChatRecord/);
});

test('menu-bar warning glyph is reserved for confirmed Watch/Near/Critical risk',()=>{
  const indicator=section(main,'func updateWarningIndicator(records:[ChatRecord]','@objc func toggleWarningAcknowledgement');
  assert.match(indicator,/let confirmedCount=counts\[\.critical,default:0\]\+counts\[\.near,default:0\]\+counts\[\.watch,default:0\]/);
  assert.match(indicator,/statusItem\.button\?\.title=confirmedCount>0 \? "GL ⚠":"GL"/);
  assert.match(indicator,/confirmedRiskFromLowerBound\(record\.aggregate\?\.estimatedTextTokens,model:model\)/);
  assert.ok(indicator.includes('Needs attention: \\(uncertaintyCount) chat histories couldn\'t be fully checked'));
});

test('lower-bound-confirmed risk appears only in the confirmed section and prevents a false empty state',()=>{
  const render=section(main,'func renderUserUI()','func monitoringDegradedReason()');
  assert.match(render,/let lowerBoundRisk=confirmedRiskFromLowerBound\(record\.aggregate\?\.estimatedTextTokens,model:model\)/);
  assert.match(render,/let riskState=riskStates\.contains\(completeness\) \? completeness:lowerBoundRisk/);
  assert.match(render,/if confirmed\.isEmpty \{mainRiskRows\.addArrangedSubview\(uiLabel\("No confirmed conversation risks\."\)\)\}/);
  assert.match(render,/let uncertainWithoutConfirmedRisk=relevant\.filter\{\$0\.1 == \.uncertain && \$0\.2 == \.normal\}/);
  assert.ok(render.includes('Full history not verified · \\(lowerBoundUserLabel(record.aggregate?.estimatedTextTokens ?? 0))'));
  assert.ok(main.includes('At least ~\\(Int((Double(tokens)/1000).rounded()))k tokens counted'));
});

test('Needs attention explanatory text can wrap to multiple lines without widening the window',()=>{
  const construction=section(main,'func buildUserWindows()','func renderUserUI()');
  assert.match(construction,/mainUncertaintySummary\.maximumNumberOfLines=0/);
  assert.match(construction,/mainUncertaintySummary\.cell\?\.wraps=true/);
  assert.match(construction,/mainUncertaintySummary\.cell\?\.isScrollable=false/);
  assert.match(construction,/mainUncertaintySummary\.widthAnchor\.constraint\(equalTo:mainUncertaintySection\.widthAnchor\)/);
  assert.match(construction,/mainRiskList\.widthAnchor\.constraint\(equalTo:mainRiskScrollView\.contentView\.widthAnchor\)/);
  assert.match(construction,/mainUncertaintySummary\.setContentCompressionResistancePriority\(\.defaultLow,for:\.horizontal\)/);
  assert.doesNotMatch(construction,/mainWindow\.setContentSize|mainWindow\.setFrame/);
  const sizing=section(main,'func renderUserUI()','func monitoringDegradedReason()');
  assert.ok(sizing.indexOf('mainRecentResultLabel.stringValue=') < sizing.indexOf('mainRiskList.fittingSize.height'));
  assert.ok(sizing.indexOf('mainRiskList.frame=NSRect(x:0,y:0,width:warningWidth') < sizing.indexOf('mainRiskList.fittingSize.height'));
  assert.match(sizing,/mainRiskList\.setFrameSize\(NSSize\(width:warningWidth,height:warningHeight\)\)/);
});

test('neutral uncertainty preview shows three, with a visible exact-count expand control',()=>{
  const construction=section(main,'func buildUserWindows()','func renderUserUI()');
  const render=section(main,'func renderUserUI()','func monitoringDegradedReason()');
  assert.match(main,/var mainUncertaintyExpanded=false/);
  assert.match(render,/let visibleActive=mainUncertaintyExpanded \? activeUncertain:Array\(activeUncertain\.prefix\(3\)\)/);
  assert.match(render,/mainUncertaintyExpandButton\.isHidden=activeUncertain\.count<=3/);
  assert.ok(render.includes('mainUncertaintyExpandButton.title=mainUncertaintyExpanded ? "Show less":"Show \\(max(0,activeUncertain.count-3)) more"'));
  const sectionStart=construction.indexOf('mainUncertaintySection=NSStackView');
  assert.ok(construction.indexOf('mainUncertaintyRows,mainUncertaintyExpandButton',sectionStart) < construction.indexOf('mainDismissedUncertaintyButton',sectionStart));
  const listStart=construction.indexOf('mainRiskList=NSStackView');
  assert.ok(construction.indexOf('mainUncertaintySection,mainRecentResultHeading',listStart)>sectionStart);
  assert.ok(construction.includes('mainRiskScrollView.contentView.widthAnchor'));
  assert.match(main,/@objc func toggleUncertaintyExpansion\(\) \{mainUncertaintyExpanded\.toggle\(\);renderCycle\(\)\}/);
});

test('expanding shows all active neutral entries and collapsing restores the three-row preview',()=>{
  const render=section(main,'func renderUserUI()','func monitoringDegradedReason()');
  assert.match(render,/let visibleActive=mainUncertaintyExpanded \? activeUncertain:Array\(activeUncertain\.prefix\(3\)\)/);
  assert.ok(render.includes('mainUncertaintyExpandButton.title=mainUncertaintyExpanded ? "Show less":"Show \\(max(0,activeUncertain.count-3)) more"'));
  assert.match(main,/@objc func toggleUncertaintyExpansion\(\) \{mainUncertaintyExpanded\.toggle\(\);renderCycle\(\)\}/);
});

test('uncertainty and recent-result views remain arranged and get fresh content geometry',()=>{
  const construction=section(main,'func buildUserWindows()','func renderUserUI()');
  assert.match(construction,/mainUncertaintySection=NSStackView\(views:\[.*mainUncertaintyRows,mainUncertaintyExpandButton,mainDismissedUncertaintyButton\]\)/);
  assert.match(construction,/mainRiskList=NSStackView\(views:\[.*mainUncertaintySection,mainRecentResultHeading,mainRecentResultLabel\]\)/);
  const render=section(main,'func renderUserUI()','func monitoringDegradedReason()');
  assert.match(render,/mainUncertaintyExpandButton\.isHidden=activeUncertain\.count<=3/);
  assert.match(render,/mainUncertaintyRows\.addArrangedSubview\(row\)/);
  assert.doesNotMatch(render,/mainUncertaintyRows\.isHidden\s*=/);
  for(const view of ['mainRiskRows','mainUncertaintyRows','mainUncertaintySection']) assert.match(render,new RegExp(`${view}\\.invalidateIntrinsicContentSize\\(\\)`));
  assert.ok(render.indexOf('mainUncertaintyRows.layoutSubtreeIfNeeded()') < render.indexOf('mainRiskList.fittingSize.height'));
  assert.ok(render.indexOf('mainRiskList.fittingSize.height') < render.indexOf('mainRiskList.setFrameSize'));
});

test('main risk viewport uses remaining window height so the collapsed section and recent result are visible',()=>{
  const construction=section(main,'func buildUserWindows()','func renderUserUI()');
  assert.match(construction,/mainUncertaintySection=NSStackView\(views:\[.*mainUncertaintyRows,mainUncertaintyExpandButton,mainDismissedUncertaintyButton\]\)/);
  assert.match(construction,/mainRiskList=NSStackView\(views:\[.*mainUncertaintySection,mainRecentResultHeading,mainRecentResultLabel\]\)/);
  assert.match(construction,/mainRiskScrollView\.heightAnchor\.constraint\(greaterThanOrEqualToConstant:260\)/);
  assert.match(construction,/mainRiskScrollView\.setContentHuggingPriority\(\.defaultLow,for:\.vertical\)/);
  assert.match(construction,/content\.bottomAnchor\.constraint\(equalTo:mainContainer\.bottomAnchor,constant:-20\)/);
  assert.doesNotMatch(construction,/mainRiskScrollView\.heightAnchor\.constraint\(equalToConstant:260\)/);
  const render=section(main,'func renderUserUI()','func monitoringDegradedReason()');
  assert.match(render,/let visibleActive=mainUncertaintyExpanded \? activeUncertain:Array\(activeUncertain\.prefix\(3\)\)/);
  assert.match(render,/mainUncertaintyExpandButton\.isHidden=activeUncertain\.count<=3/);
  assert.match(render,/mainUncertaintyRows\.addArrangedSubview\(row\)/);
  assert.doesNotMatch(render,/mainUncertaintyRows\.isHidden\s*=/);
});

test('post-refresh row/button/recent-result telemetry reports counts, hierarchy and order without chat data',()=>{
  const construction=section(main,'func buildUserWindows()','func renderUserUI()');
  assert.match(construction,/mainRecentResultHeading=uiLabel\(\"Recent result\"/);
  assert.match(main,/mainUILayoutSnapshotOutput=uiLabel\(\"Main content layout: not sampled\"/);
  const render=section(main,'func renderUserUI()','func monitoringDegradedReason()');
  assert.match(render,/recordMainUILayoutSnapshot\(activeCount:activeUncertain\.count,selectedCount:visibleActive\.count\)/);
  const snapshot=section(main,'func mainUILayoutViewState(','@objc func toggleUncertaintyExpansion()');
  for(const field of ['present=','attached=','hidden=','frame=','bounds=','fitting=','alpha=','arrangedIndex=','ancestors=']) assert.ok(snapshot.includes(field));
  assert.match(snapshot,/row_views=\\\(rows\.count\)/);
  assert.match(snapshot,/show_more\{hidden=/);
  assert.match(snapshot,/recent_result\{heading=/);
  assert.match(snapshot,/risk_list_arranged_order=/);
  assert.match(snapshot,/needs_attention_arranged_order=/);
  assert.match(snapshot,/mainUILayoutSnapshots\.count>8/);
  assert.doesNotMatch(snapshot,/conversationId|record\.title|chat ID/);
});

test('empty or whitespace-only chat names fall back while genuine short titles remain intact',()=>{
  const render=section(main,'func renderUserUI()','func monitoringDegradedReason()');
  assert.match(render,/record\.title\.trimmingCharacters\(in:\.whitespacesAndNewlines\)\.isEmpty \? "Unnamed chat":record\.title/);
  assert.doesNotMatch(render,/record\.title\.count\s*<|title\.count\s*<|==\s*"C\."/);
});

test('confirmed-risk rows are excluded from the neutral uncertainty preview',()=>{
  const render=section(main,'func renderUserUI()','func monitoringDegradedReason()');
  assert.match(render,/let confirmed=relevant\.filter\{\$0\.3 != \.uncertain\}/);
  assert.match(render,/let uncertainWithoutConfirmedRisk=relevant\.filter\{\$0\.1 == \.uncertain && \$0\.2 == \.normal\}/);
  assert.match(render,/let activeUncertain=uncertainWithoutConfirmedRisk\.filter\{warningBadgeVisible/);
  assert.match(render,/mainRiskRows\.addArrangedSubview\(row\)/);
  assert.match(render,/mainUncertaintyRows\.addArrangedSubview\(row\)/);
});

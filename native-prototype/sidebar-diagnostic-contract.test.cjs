const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
const bridge=fs.readFileSync(path.join(__dirname,'automation-bridge.js'),'utf8');

const section=(source,start,end)=>{
  const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
  assert.ok(from>=0,`missing section start: ${start}`);
  assert.ok(to>from,`missing section end: ${end}`);
  return source.slice(from,to);
};

test('sidebar diagnostic callback stores a sanitized success summary and replaces prior result',()=>{
  const handler=section(main,'if let result=payload["visiblePinnedRowsResult"]','if let result=payload["firstRowStructureResult"]');
  assert.match(handler,/storeSidebarDiagnosticResult\(result\)/);
  assert.match(handler,/sidebarDiagnosticLastStage="callback_returned"/);
  assert.match(main,/lastSidebarDiagnosticSummary=summary/);
  assert.match(main,/lastSidebarDiagnosticOutput\.stringValue=summary\.displayText/);
  assert.match(main,/SidebarDiagnosticSummary\.make\(result:raw\["result"\] as\? String/);
  assert.match(handler,/pinDiagnosticRunID=nil/);
  assert.ok(main.includes('Diagnostic running: \\(diagnosticOwner == nil ? "No":"Yes"'));
});

test('sidebar diagnostic failure callback and timeout retain an explicit failure result',()=>{
  const action=section(main,'@objc func diagnoseVisiblePinnedRows()','func renderDOMSummary(');
  assert.match(action,/finishSidebarDiagnosticFailure\("hard_timeout"/);
  assert.match(action,/finishSidebarDiagnosticFailure\("bridge_hook_missing_or_mismatch"/);
  assert.match(action,/finishSidebarDiagnosticFailure\("command_delivery_failed"/);
  const handler=section(main,'if let result=payload["visiblePinnedRowsResult"]','if let result=payload["firstRowStructureResult"]');
  assert.match(handler,/finishSidebarDiagnosticFailure\("javascript_operation_failed"/);
  assert.match(main,/recordSidebarDiagnosticStage\(_ payload:\[String:Any\]\)/);
  assert.match(main,/sidebarDiagnosticElapsedNow\(\)/);
});

test('sidebar diagnostic summary is visible near the action and exposes only approved fields',()=>{
  assert.match(main,/Inspect pinned rows at sidebar top".*lastSidebarDiagnosticOutput/s);
  const model=section(main,'struct SidebarDiagnosticSummary: Equatable {','final class Prototype:');
  for(const field of ['result:String','detectedRowCount:Int','pinnedRowCandidateCount:Int','recognizedRouteTemplateCount:Int','sidebarPresent:Bool','navPresent:Bool','asidePresent:Bool','scrollContainerCount:Int','reason:String','timestamp:String']) assert.ok(model.includes(field),`missing ${field}`);
  assert.match(model,/sanitizedReason/);
  assert.doesNotMatch(model,/title|conversationId|chatID|URL|DOM text/i);
  const resultBuilder=bridge.slice(bridge.indexOf('const sidebarDiagnosticSummary='),bridge.indexOf('const internal=',bridge.indexOf('const sidebarDiagnosticSummary=')));
  for(const field of ['detectedRowCount','pinnedRowCandidateCount','recognizedRouteTemplateCount','sidebarPresent','navPresent','asidePresent','scrollContainerCount','reason']) assert.ok(resultBuilder.includes(field),`bridge summary missing ${field}`);
  assert.doesNotMatch(resultBuilder,/title|conversationId|chatId|(?:^|[,\s])href\s*:|textContent|innerText/i);
});

test('a completed sidebar callback is correlated to its active run before replacing the displayed result',()=>{
  const action=section(main,'@objc func diagnoseVisiblePinnedRows()','func renderDOMSummary(');
  assert.match(action,/sidebarDiagnosticRunID:'\\\(runID\.uuidString\)'/);
  const handler=section(main,'if let result=payload["visiblePinnedRowsResult"]','if let result=payload["firstRowStructureResult"]');
  assert.match(handler,/token==pinDiagnosticRunID\?\.uuidString/);
  assert.match(handler,/storeSidebarDiagnosticResult\(result\)/);
});

test('sidebar element structure has a separate bounded diagnostic action and output',()=>{
  assert.doesNotMatch(main,/group\("Discovery diagnostics"[^\n]*Inspect sidebar element structure/);
  assert.match(main,/sidebarElementStructureOutput/); // diagnostic implementation remains available to tests, not exposed in RC UI
  const action=section(main,'@objc func inspectSidebarElementStructure()','func renderSidebarElementStructure(');
  assert.match(action,/gptInspectSidebarElementStructure/);assert.match(action,/hardTimeoutMs:5000/);assert.match(action,/nanoseconds:8_000_000_000/);
  assert.match(main,/sidebarElementStructureResult/);assert.match(main,/sidebarStructureDiagnosticRunID/);
  assert.match(action,/cycleRunning/);assert.match(action,/pinDiagnosticRunID == nil/);
});

test('native rendering allowlists structural names and normalized routes only',()=>{
  const renderer=section(main,'func renderSidebarElementStructure(_ raw:[String:Any])->String','func renderDOMSummary(');
  for(const field of ['hrefAnchors','buttons','roleLinks','roleButtons','dataTestID','dataState','ariaAttributeCount','ariaAttributeNames','rowCandidates','dataAttributeNames','hrefTemplate','depth','count'])assert.ok(renderer.includes(field),`missing ${field}`);
  assert.match(renderer,/stableRouteSegments/);assert.match(renderer,/\^data-/);assert.doesNotMatch(renderer,/textContent|innerText|ariaLabel|href\"] as\? String/);
  const operation=bridge.slice(bridge.indexOf('window.gptInspectSidebarElementStructure='),bridge.indexOf('window.gptRunPinnedSidebarDiagnostic=',bridge.indexOf('window.gptInspectSidebarElementStructure=')));
  assert.match(operation,/1200/);assert.match(operation,/hardMs/);assert.match(operation,/ariaAttributeNames/);assert.match(operation,/pinnedMarkerAttributeNames/);
  assert.doesNotMatch(operation,/textContent|innerText|aria-label.*getAttribute|outerHTML|innerHTML/);
});

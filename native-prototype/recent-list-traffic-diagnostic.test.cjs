const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
const hook=fs.readFileSync(path.join(__dirname,'list-hook.js'),'utf8');

test('recent-chat list traffic inspector is a bounded read-only diagnostics action',()=>{
 assert.doesNotMatch(main,/group\("Discovery diagnostics"[^\n]*Inspect recent-chat list traffic/);
 assert.match(main,/listDiagnosticOutput/); // retained internally, not exposed in the RC diagnostics UI
 assert.match(main,/inspectRecentChatListTraffic\(\)\{startListDiagnostic\(visible:false,inspectRecentTraffic:true\)\}/);
 assert.match(main,/sessionStorage\.setItem\('gpt-limits-inspect-recent-list-traffic','1'\)/);
 assert.match(main,/Task\.sleep\(nanoseconds:45_000_000_000\)/);
 assert.match(main,/gptEndRecentListTrafficCapture/);
 assert.doesNotMatch(main,/inspectRecentChatListTraffic\(\)[\s\S]{0,180}runCycle\(/);
});

test('traffic capture is in-memory, capped, and returns only sanitized structural fields',()=>{
 assert.match(hook,/starredNetworkWindow\.length>50\)starredNetworkWindow\.shift\(\)/);
 assert.match(hook,/sanitizedTrafficSnapshot=events=>/);
 assert.match(hook,/slice\(-50\)/);
 assert.match(hook,/topLevelKeys,arrayCounts,recognized,parserRejectionReason/);
 assert.match(hook,/window\.gptEndRecentListTrafficCapture/);
 assert.match(hook,/return \[\{event:kind,pathname,transport,status,topLevelKeys,arrayCounts,recognized,parserRejectionReason\}\]/);
});

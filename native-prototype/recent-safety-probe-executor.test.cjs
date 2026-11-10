const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');

test('probe execution uses a test-only override and the unchanged WebView default',()=>{
 const start=source.indexOf('    #if RECENT_SAFETY_PROBE_TESTING\n    var recentSafetyProbeJavaScriptOverride');
 const end=source.indexOf('    var cycleOrigins=',start);
 assert.ok(start>=0 && end>start);
 const section=source.slice(start,end);
 const executor=section.slice(0,section.indexOf('@MainActor func runRecentSafetyProbe'));
 const runner=section.slice(section.indexOf('@MainActor func runRecentSafetyProbe'));
 assert.match(executor,/#if RECENT_SAFETY_PROBE_TESTING\s*var recentSafetyProbeJavaScriptOverride: \(\(String,String\) async throws -> Any\?\)\?/);
 assert.match(executor,/#if RECENT_SAFETY_PROBE_TESTING\s*if let execute=recentSafetyProbeJavaScriptOverride \{return try await execute\(script,token\)\}\s*#endif/);
 assert.match(executor,/return try await web\.callAsyncJavaScript\(script,arguments:\["token":token\],in:nil,contentWorld:\.page\)/);
 assert.doesNotMatch(executor,/terminalCompleted|completeRecentSafetyProbe/);
 assert.match(runner,/try\? await executeRecentSafetyProbeJavaScript\(script,token:probeToken\)/);
 assert.doesNotMatch(runner,/web\.callAsyncJavaScript/);
 assert.match(runner,/if let existing=recentSafetyProbe,existing\.cycleGeneration==generation/);
 assert.match(runner,/\?\? "request_failed"/);
 assert.match(runner,/if outcome != "response_dispatched".*completeRecentSafetyProbe/);
 assert.match(source,/func consumeValidatedListMessage\(_ data:\[String:Any\]\)/);
});

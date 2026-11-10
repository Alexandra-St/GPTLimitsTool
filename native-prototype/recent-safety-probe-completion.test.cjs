const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
const helperStart=source.indexOf('func completeRecentSafetyProbe(');
const helperEnd=source.indexOf('@MainActor func awaitRecentSafetyProbeTerminal(',helperStart);
const helper=source.slice(helperStart,helperEnd);
const consumeStart=source.indexOf('if let records = data["records"] as? [[String: Any]]');
const consumeEnd=source.indexOf('let now = Date()',consumeStart);
const consume=source.slice(consumeStart,consumeEnd);
const jsStart=source.indexOf('recentSafetyProbe?.jsOutcome=outcome');
const jsEnd=source.indexOf('return outcome',jsStart);
const js=source.slice(jsStart,jsEnd);

function complete(state,result,token=state.probeToken,generation=state.cycleGeneration) {
 if(token!==state.probeToken||generation!==state.cycleGeneration||state.terminalCompleted)return false;
 state.terminalCompleted=true;state.terminalResult=result;
 const callback=state.waiter;state.waiter=null;callback?.(result);return true;
}
function state(){return{probeToken:'token',cycleGeneration:'generation',terminalCompleted:false,terminalResult:null,waiter:null};}

test('recent safety probe exactly-once terminal completion contract A-J',()=>{
 assert.ok(helper.includes('probe.probeToken==probeToken')&&helper.includes('probe.cycleGeneration==cycleGeneration'));
 assert.ok(helper.includes('!probe.terminalCompleted')&&helper.includes('probe.terminalCompleted=true'));
 assert.match(source,/enum RecentSafetyProbeTerminalResult:String \{ case js_terminal,consume_terminal,bridge_failure,cancelled_or_stale \}/);
 assert.match(source,/var waiter:\(\(RecentSafetyProbeTerminalResult\)->Void\)\?/);
 // A: terminal JS callback completes once.
 let s=state(),calls=[];s.waiter=r=>calls.push(r);assert.equal(complete(s,'js_terminal'),true);assert.deepEqual(calls,['js_terminal']);
 // B: repeated terminal JS callback is ignored.
 assert.equal(complete(s,'js_terminal'),false);assert.deepEqual(calls,['js_terminal']);
 // C: response_dispatched intentionally leaves waiter active.
 s=state();calls=[];s.waiter=r=>calls.push(r);assert.ok(js.includes('if outcome != "response_dispatched"'));assert.equal(calls.length,0);assert.equal(s.terminalCompleted,false);
 // D: matching valid list completes as consume_terminal.
 s=state();calls=[];s.waiter=r=>calls.push(r);assert.match(consume,/result == \.accepted_new \|\| result == \.accepted_repeated/);complete(s,'consume_terminal');assert.deepEqual(calls,['consume_terminal']);
 // E: repeated matching list remains exactly once.
 assert.equal(complete(s,'consume_terminal'),false);assert.deepEqual(calls,['consume_terminal']);
 // F: malformed matching payload completes as bridge_failure.
 assert.match(consume,/result:\.bridge_failure/);s=state();calls=[];s.waiter=r=>calls.push(r);complete(s,'bridge_failure');assert.deepEqual(calls,['bridge_failure']);
 // G/H: wrong token/generation cannot complete the active probe.
 s=state();calls=[];s.waiter=r=>calls.push(r);assert.equal(complete(s,'js_terminal','wrong','generation'),false);assert.equal(complete(s,'js_terminal','token','wrong'),false);assert.deepEqual(calls,[]);
 // I: cancel helper reports cancelled_or_stale once.
 assert.match(source,/func cancelRecentSafetyProbe\([\s\S]*?result:\.cancelled_or_stale/);s=state();calls=[];s.waiter=r=>calls.push(r);complete(s,'cancelled_or_stale');assert.deepEqual(calls,['cancelled_or_stale']);
 // J: terminal completion clears waiter before invoking it.
 s=state();let clearedDuringCallback=false;s.waiter=()=>{clearedDuringCallback=s.waiter===null;};complete(s,'js_terminal');assert.equal(s.waiter,null);assert.equal(clearedDuringCallback,true);
});

test('awaitable terminal API reuses the single MainActor waiter and completion helper',()=>{
 const start=source.indexOf('@MainActor func awaitRecentSafetyProbeTerminal(');
 const end=source.indexOf('@MainActor private func currentTerminalResult(',start);
 const api=source.slice(start,end);
 assert.match(api,/async -> RecentSafetyProbeTerminalResult/);
 assert.match(api,/if probe\.terminalCompleted \{return probe\.terminalResult/);
 assert.match(api,/guard probe\.waiter==nil else\{return \.cancelled_or_stale\}/);
 assert.match(api,/current\.waiter=\{ result in continuation\.resume\(returning:result\) \}/);
 assert.match(api,/MainActor serialization keeps this registration atomic/);
 assert.match(helper,/let completion=probe\.waiter[\s\S]*?completion\?\(result\)/);
 assert.match(api,/current\.waiter=\{ result in continuation\.resume\(returning:result\) \}/);
 assert.match(api,/continuation\.resume\(returning:currentTerminalResult/);
 // A-J: exercise the await contract over a model of the same single-slot state.
 const make=()=>({probeToken:'t',cycleGeneration:'g',terminalCompleted:false,terminalResult:null,waiter:null});
 const terminal=(p,r)=>{if(p.terminalCompleted)return; p.terminalCompleted=true;p.terminalResult=r;const w=p.waiter;p.waiter=null;w?.(r);};
 const awaitModel=(p,t='t',g='g')=>{if(p.probeToken!==t||p.cycleGeneration!==g)return Promise.resolve('cancelled_or_stale');if(p.terminalCompleted)return Promise.resolve(p.terminalResult||'cancelled_or_stale');if(p.waiter)return Promise.resolve('cancelled_or_stale');return new Promise(resolve=>{if(p.terminalCompleted){resolve(p.terminalResult||'cancelled_or_stale');return;}p.waiter=resolve;});};
 (async()=>{
  let p=make();terminal(p,'js_terminal');assert.equal(await awaitModel(p),'js_terminal'); // A
  p=make();let settled=false;const pending=awaitModel(p).then(v=>{settled=true;return v;});await Promise.resolve();assert.equal(settled,false); // B
  terminal(p,'js_terminal');assert.equal(await pending,'js_terminal'); // C
  for(const result of ['consume_terminal','bridge_failure','cancelled_or_stale']){p=make();const wait=awaitModel(p);await Promise.resolve();terminal(p,result);assert.equal(await wait,result);} // D/E/F
  p=make();assert.equal(await awaitModel(p,'wrong'),'cancelled_or_stale');assert.equal(p.terminalCompleted,false); // G
  assert.equal(await awaitModel(p,'t','wrong'),'cancelled_or_stale');assert.equal(p.terminalCompleted,false); // H
  // I: if terminalization wins before registration, await resolves from saved state.
  p=make();terminal(p,'consume_terminal');assert.equal(await awaitModel(p),'consume_terminal');assert.equal(p.waiter,null);
  // J: repeated completion does not resume twice and the slot is cleared.
  p=make();let count=0;p.waiter=()=>count++;terminal(p,'js_terminal');terminal(p,'bridge_failure');assert.equal(count,1);assert.equal(p.waiter,null);
 })().catch(error=>{throw error;});
});

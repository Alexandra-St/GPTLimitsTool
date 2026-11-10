const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');

test('validated list handler preserves security gate and production processing',()=>{
 const gate=source.slice(source.indexOf('if message.name == "list"'),source.indexOf('if cycleRunning {return}',source.indexOf('if message.name == "list"')));
 assert.match(gate,/if message\.name == "list", message\.frameInfo\.isMainFrame, message\.frameInfo\.securityOrigin\.host == "chatgpt\.com", let data = message\.body as\? \[String: Any\] \{\s*consumeValidatedListMessage\(data\)\s*return\s*\}/);
 assert.equal((gate.match(/consumeValidatedListMessage\(data\)/g)||[]).length,1);
 const start=source.indexOf('func consumeValidatedListMessage(');
 const end=source.indexOf('func recordRootDocumentSnapshot(',start);
 assert.ok(start>=0 && end>start);
 const helper=source.slice(start,end);
 assert.match(helper,/consumeDiscoveryPage\(data,records:records,source:isProbe \? \.recent_safety_probe:\.normal_discovery\)/);
 assert.match(helper,/probe\.cycleGeneration==cycleToken[\s\S]*data\["probeToken"\] as\? String==probe\.probeToken[\s\S]*!probe\.terminalCompleted/);
 assert.match(helper,/result:\.consume_terminal/);
 assert.match(helper,/result:\.bridge_failure/);
 assert.match(helper,/for r in records[\s\S]*discovered\[id\] =/);
 assert.match(helper,/listOutput\.stringValue =/);
});

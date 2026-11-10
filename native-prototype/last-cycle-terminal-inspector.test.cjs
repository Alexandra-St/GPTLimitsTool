const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
const inspector=main.slice(main.indexOf('func inspectLastCycleTerminalSnapshot('),main.indexOf('final class Prototype:'));
const entry=main.slice(main.indexOf('@main struct PrototypeMain'));

test('A: valid snapshot output exposes the complete stable key set',()=>{
 for(const key of ['build_id','cycle_sequence','terminal_kind','normal_discovery_outcome','original_normal_discovery_failure','recent_safety_probe_attempted','probe_js_outcome','probe_list_received','probe_consume_result','probe_terminal_result','discovery_finalized_after_probe','candidates_built_after_probe','coverage_complete','cycle_root_response_received','probe_contributed_partition','admitted_candidate_count','cycle_finished','finished_at']) assert.ok(inspector.includes(`"${key}=`),`missing ${key}`);
 assert.match(inspector,/decoder\.decode\(LastCycleTerminalSnapshot\.self,from:data\)/);
});

test('B: nil optional fields render as unknown',()=>{
 assert.match(inspector,/\?\?\s*"unknown"/);
 assert.match(inspector,/optionalBool\(_ raw:Bool\?\).*raw\.map/);
 assert.match(inspector,/optionalInt\(_ raw:Int\?\).*raw\.map/);
});

test('C-D: missing and malformed files have sanitized status output',()=>{
 assert.match(inspector,/terminalSnapshotPersistenceFailureDiagnostic\(\) \?\? "no_completed_cycle_snapshot"/);
 assert.match(inspector,/else\{return "invalid_completed_cycle_snapshot"\}/);
 assert.doesNotMatch(inspector,/print\(.*data|String\(data:|localizedDescription/);
});

test('missing snapshot reports stored persistence failure fields',()=>{
 assert.match(inspector,/terminalSnapshotPersistenceFailureDiagnostic\(\) \?\? "no_completed_cycle_snapshot"/);
 for(const key of ['snapshot_status=persist_failed','persistence_stage=','error_domain=','error_code=','cycle_sequence=','build_id=']) assert.ok(main.includes(key),`missing ${key}`);
});

test('E and H: inspector reads without creating or writing snapshot state',()=>{
 assert.match(inspector,/Data\(contentsOf:file\)/);
 assert.doesNotMatch(inspector,/createDirectory|\.write\(|replaceItemAt|removeItem|persistLastCycleTerminalSnapshot/);
});

test('F-G: CLI dispatch exits before app bootstrap, lock, and cycle sequence increment',()=>{
 const dispatch=entry.indexOf('if CommandLine.arguments.dropFirst().contains("--inspect-last-cycle")');
 assert.ok(dispatch>=0);
 for(const later of ['SingleInstanceLock.acquire','NSApplication.shared','Prototype()']) assert.ok(entry.indexOf(later)>dispatch,`${later} must follow inspector dispatch`);
 assert.match(entry,/--inspect-last-cycle"\) \{print\(inspectLastCycleTerminalSnapshot\(\)\);return\}/);
 assert.doesNotMatch(inspector,/cycleSequence\s*&\+=|cycleSequence\s*\+=/);
});

test('I: output is restricted to snapshot fields and scalar-safe strings',()=>{
 for(const forbidden of ['conversationId','title','records','messages','authorization','headers','rawProbeResponse']) assert.doesNotMatch(inspector,new RegExp(forbidden,'i'));
 assert.doesNotMatch(inspector,/"url=/i);
 assert.match(inspector,/CharacterSet\(charactersIn:"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_\.-"\)/);
});

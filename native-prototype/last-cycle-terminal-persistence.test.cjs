const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
const engine=fs.readFileSync(path.join(__dirname,'CycleEngine.swift'),'utf8');
const model=main.slice(main.indexOf('struct LastCycleTerminalSnapshot:'),main.indexOf('enum TerminalSnapshotPersistenceStage:'));
const helper=main.slice(main.indexOf('enum TerminalSnapshotPersistenceStage:'),main.indexOf('final class Prototype:'));
const finalizer=main.slice(main.indexOf('func finalizeTerminalEvidence('),main.indexOf('@discardableResult func completeRecentSafetyProbe('));

test('A: successful persistence returns persisted and keeps the snapshot format and path',()=>{
 assert.match(helper,/enum TerminalSnapshotPersistenceResult[\s\S]*case persisted[\s\S]*case skippedOlderExistingSequence[\s\S]*case failed/);
 assert.match(helper,/func persistLastCycleTerminalSnapshot\([^\n]+\)->TerminalSnapshotPersistenceResult/);
 assert.match(helper,/urls\(for:\.applicationSupportDirectory,in:\.userDomainMask\)/);
 assert.match(helper,/appendingPathComponent\("GPTLimitsTool",isDirectory:true\)/);
 assert.match(helper,/appendingPathComponent\("last-cycle-terminal\.json",isDirectory:false\)/);
 assert.match(helper,/data\.write\(to:file,options:\.atomic\);return \.persisted/);
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'last-cycle-snapshot-'));
 try {
  const file=path.join(base,'GPTLimitsTool','last-cycle-terminal.json');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const snapshot={buildID:'test-build',cycleSequence:7,terminalKind:'success',cycleFinished:true,finishedAt:'2026-11-09T00:00:00Z'};
  fs.writeFileSync(file,JSON.stringify(snapshot));
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),snapshot);
 } finally {fs.rmSync(base,{recursive:true,force:true});}
});

test('B: a newer existing sequence remains protected',()=>{
 assert.match(helper,/if existing\.cycleSequence>snapshot\.cycleSequence\{return \.skippedOlderExistingSequence\}/);
 assert.doesNotMatch(helper,/existing\.cycleSequence\s*>=\s*snapshot\.cycleSequence/);
});

test('C: directory creation failure has its own stage and NSError fields',()=>{
 assert.match(helper,/do \{try FileManager\.default\.createDirectory[\s\S]*catch \{return \.failed\(TerminalSnapshotPersistenceFailure\(stage:\.directoryCreate,error:error as NSError,snapshot:snapshot\)\)\}/);
 assert.match(helper,/let errorDomain:String[\s\S]*let errorCode:Int/);
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'last-cycle-not-dir-'));
 const blocker=path.join(base,'blocker');fs.writeFileSync(blocker,'x');
 try {assert.throws(()=>fs.mkdirSync(path.join(blocker,'GPTLimitsTool'),{recursive:true}));}
 finally {fs.rmSync(base,{recursive:true,force:true});}
});

test('D: existing snapshot read and decode failures are reported separately',()=>{
 assert.match(helper,/catch \{return \.failed\(TerminalSnapshotPersistenceFailure\(stage:\.existingSnapshotRead/);
 assert.match(helper,/catch \{return \.failed\(TerminalSnapshotPersistenceFailure\(stage:\.existingSnapshotDecode/);
});

test('E: encoding and atomic write failures have distinct stages',()=>{
 assert.match(helper,/catch \{return \.failed\(TerminalSnapshotPersistenceFailure\(stage:\.snapshotEncode/);
 assert.match(helper,/catch \{return \.failed\(TerminalSnapshotPersistenceFailure\(stage:\.snapshotWrite/);
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'last-cycle-write-fail-'));
 try {
  fs.mkdirSync(path.join(base,'GPTLimitsTool'),{recursive:true});
  fs.writeFileSync(path.join(base,'GPTLimitsTool','last-cycle-terminal.json'),'directory blocker');
  assert.throws(()=>fs.writeFileSync(path.join(base,'GPTLimitsTool','last-cycle-terminal.json','child'),'x'));
 } finally {fs.rmSync(base,{recursive:true,force:true});}
});

test('F: fallback stores only sanitized stage, domain, code, sequence and build ID',()=>{
 assert.match(helper,/let terminalSnapshotPersistenceFailureDefaultsKey="lastCycleTerminalSnapshotPersistenceFailureV1"/);
 assert.match(helper,/func recordTerminalSnapshotPersistenceResult/);
 assert.match(helper,/case \.failed\(let failure\):[\s\S]*encoder\.encode\(failure\)[\s\S]*defaults\.set\(data,forKey:terminalSnapshotPersistenceFailureDefaultsKey\)/);
 assert.match(helper,/func sanitized\(_ value:String\)/);
 assert.match(helper,/allowed=CharacterSet\(charactersIn:"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_\.-"\)/);
 for(const forbidden of ['conversationId','title','records','messages','headers','authorization','rawProbeResponse','localizedDescription']) assert.doesNotMatch(helper,new RegExp(forbidden,'i'));
});

test('G: inspector returns persisted failure metadata only when snapshot is absent',()=>{
 const inspector=helper.slice(helper.indexOf('func inspectLastCycleTerminalSnapshot('));
 const failureReader=helper.slice(helper.indexOf('func terminalSnapshotPersistenceFailureDiagnostic('),helper.indexOf('func inspectLastCycleTerminalSnapshot('));
 assert.match(inspector,/guard FileManager\.default\.fileExists\(atPath:file\.path\) else\{return terminalSnapshotPersistenceFailureDiagnostic\(\) \?\? "no_completed_cycle_snapshot"\}/);
 assert.match(inspector,/guard let snapshot=try\? decoder\.decode\(LastCycleTerminalSnapshot\.self,from:data\) else\{return "invalid_completed_cycle_snapshot"\}/);
 assert.match(failureReader,/failure\.diagnosticText/);
});

test('H: inspector retains the empty-state output without a stored diagnostic',()=>{
 assert.match(helper,/terminalSnapshotPersistenceFailureDiagnostic\(\) \?\? "no_completed_cycle_snapshot"/);
});

test('I: a later successful write clears stale failure metadata',()=>{
 assert.match(helper,/case \.persisted:defaults\.removeObject\(forKey:terminalSnapshotPersistenceFailureDefaultsKey\)/);
 assert.match(finalizer,/let result=persistLastCycleTerminalSnapshot\(snapshot\)[\s\S]*recordTerminalSnapshotPersistenceResult\(result\)/);
});

test('J: inspector is read-only',()=>{
 const inspector=helper.slice(helper.indexOf('func inspectLastCycleTerminalSnapshot('));
 assert.match(inspector,/Data\(contentsOf:file\)/);
 assert.doesNotMatch(inspector,/createDirectory|\.write\(|replaceItemAt|removeItem|persistLastCycleTerminalSnapshot|recordTerminalSnapshotPersistenceResult/);
});

test('snapshot format and lifecycle semantics remain unchanged',()=>{
 assert.match(model,/let buildID:String/);
 assert.match(model,/let cycleSequence:UInt64/);
 assert.match(model,/let terminalKind:CycleTerminalEvidence\.TerminalKind/);
 assert.match(engine,/defer \{\s*finalizeTerminalEvidence\(terminalEvidence\)/);
 assert.equal((engine.match(/finalizeTerminalEvidence\(/g)||[]).length,1);
 assert.match(finalizer,/RuntimeIdentity\.make\(buildMarker:gptLimitsExecutableBuildIDMarker,bundle:Bundle\.main\)\.buildID/);
});

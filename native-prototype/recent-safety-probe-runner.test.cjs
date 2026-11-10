const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

test('test executor runs through the production Swift probe runner',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'probe-runner-'));
 try {
  const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
  const marker='@main struct PrototypeMain';
  assert.equal(main.split(marker).length,2);
  const mainCopy=path.join(dir,'Main.swift');
  fs.writeFileSync(mainCopy,main.replace(marker,'struct PrototypeMain'));
  const metadata=path.join(dir,'metadata.swift');
  fs.writeFileSync(metadata,'let gptLimitsExecutableBuildVersionMarker = "test"\nlet gptLimitsExecutableBuildIDMarker = "test"\n');
  const binary=path.join(dir,'runner');
  const files=['CycleEngine.swift','CycleModel.swift','RuntimeIdentity.swift','SingleInstanceLock.swift','recent-safety-probe-runner-tests.swift'].map(f=>path.join(__dirname,f));
  execFileSync('swiftc',['-D','RECENT_SAFETY_PROBE_TESTING',mainCopy,...files,metadata,'-o',binary],{stdio:'pipe'});
  assert.match(execFileSync(binary,{encoding:'utf8'}),/PASS: executor override through production runner/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

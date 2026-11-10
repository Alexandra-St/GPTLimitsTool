const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const enginePath=path.join(__dirname,'CycleEngine.swift');
const modelPath=path.join(__dirname,'CycleModel.swift');
const source=fs.readFileSync(enginePath,'utf8');
const helperStart=source.indexOf(' struct RootResponseCoverageProof {');
const helperEnd=source.indexOf(' @discardableResult func consumeDiscoveryPage(',helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,'production coverage helper not found');
const predicateStart=source.indexOf(' var shouldRunRecentSafetyProbeForOriginalFailure:Bool {',helperStart);
const updateStart=source.indexOf(' func updateDiscoveryCoverage(',predicateStart);
assert.ok(predicateStart>helperStart&&updateStart>predicateStart,'coverage helper boundaries not found');
const helper=(source.slice(helperStart,predicateStart)+source.slice(updateStart,helperEnd)).trim();
const swift=`import Foundation
enum DiscoveryPageSource:Equatable { case normal_discovery,recent_safety_probe }
${helper}
@main struct CoverageUpdateHelperTests {
 static func expect(_ condition:@autoclosure ()->Bool,_ message:String) {
  if !condition(){fputs("FAIL: \\(message)\\n",stderr);exit(1)}
  print("PASS: \\(message)")
 }
 static func fixture()->(RootResponseCoverageProof,[PartitionDescriptor:PartitionObservation],PartitionDescriptor,[String:Any],[[String:Any]]) {
  let descriptor=PartitionDescriptor(archived:false,starred:false)
  let metadata:[String:Any] = ["relativeMs":120,"itemCount":1,"timestampsValid":true,"pageTimes":[10.0],"sortOrder":"updated","httpStatus":200,"cursorPresent":false]
  let records:[[String:Any]] = [["conversationId":"chat-1","updatedAt":10.0]]
  return (RootResponseCoverageProof(received:false,lastPageRelativeMs:nil,lastPageOffset:nil,lastPageNewIdentities:0,lastIdentityProgressRelativeMs:nil,lastIdentityProgressOffset:nil),[:],descriptor,metadata,records)
 }
 static func main(){
  var (proof,partitions,descriptor,metadata,records)=fixture()
  updateDiscoveryCoverage(source:.normal_discovery,rootProof:&proof,partitions:&partitions,descriptor:descriptor,metadata:metadata,records:records,newIdentityCount:1,offset:0)
  expect(proof.received && proof.lastPageRelativeMs==120,"normal_discovery updates root response proof")
  expect(partitions[descriptor]?.pages.count==1,"normal_discovery adds a partition page")
  var (probeProof,probePartitions,probeDescriptor,probeMetadata,probeRecords)=fixture()
  updateDiscoveryCoverage(source:.recent_safety_probe,rootProof:&probeProof,partitions:&probePartitions,descriptor:probeDescriptor,metadata:probeMetadata,records:probeRecords,newIdentityCount:1,offset:0)
  expect(!probeProof.received,"recent_safety_probe leaves root response proof unchanged")
  expect(probePartitions.isEmpty,"recent_safety_probe leaves partitions unchanged")
  var repeatProof=proof
  updateDiscoveryCoverage(source:.normal_discovery,rootProof:&repeatProof,partitions:&partitions,descriptor:descriptor,metadata:metadata,records:records,newIdentityCount:0,offset:0)
  expect(partitions[descriptor]?.pages.count==1 && partitions[descriptor]?.repeatedPageChanged==false,"repeated descriptor keeps offset dedup semantics")
  var existingProof=RootResponseCoverageProof(received:true,lastPageRelativeMs:80,lastPageOffset:40,lastPageNewIdentities:3,lastIdentityProgressRelativeMs:70,lastIdentityProgressOffset:20)
  var existingPartitions=[descriptor:partitions[descriptor]!]
  let beforeProof=existingProof, beforePartitions=existingPartitions
  updateDiscoveryCoverage(source:.recent_safety_probe,rootProof:&existingProof,partitions:&existingPartitions,descriptor:descriptor,metadata:metadata,records:records,newIdentityCount:99,offset:99)
  expect(existingProof.received==beforeProof.received && existingProof.lastPageRelativeMs==beforeProof.lastPageRelativeMs && existingProof.lastPageOffset==beforeProof.lastPageOffset && existingProof.lastPageNewIdentities==beforeProof.lastPageNewIdentities && existingProof.lastIdentityProgressRelativeMs==beforeProof.lastIdentityProgressRelativeMs && existingProof.lastIdentityProgressOffset==beforeProof.lastIdentityProgressOffset,"probe preserves existing root coverage state")
  expect(existingPartitions[descriptor]?.pages.count==beforePartitions[descriptor]?.pages.count && existingPartitions[descriptor]?.ids==beforePartitions[descriptor]?.ids,"probe preserves existing partition coverage state")
 }
}`;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'coverage-helper-'));
try {
 const swiftPath=path.join(temp,'CoverageUpdateHelperTests.swift');
 const binary=path.join(temp,'coverage-helper-tests');
 fs.writeFileSync(swiftPath,swift);
 let result=spawnSync('xcrun',['swiftc','-module-cache-path','/private/tmp/gpt-limits-swift-cache',modelPath,swiftPath,'-o',binary],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);
 result=spawnSync(binary,[],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);
 process.stdout.write(result.stdout);
} finally {fs.rmSync(temp,{recursive:true,force:true});}

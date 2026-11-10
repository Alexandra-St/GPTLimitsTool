import Foundation
import Dispatch

@main struct SingleInstanceLockTests {
 static func fixture(_ body:(URL,String)->Void) {
  let dir=FileManager.default.temporaryDirectory.appendingPathComponent("gpt-lock-test-\(UUID().uuidString)",isDirectory:true)
  defer{try? FileManager.default.removeItem(at:dir)}
  body(dir,"com.test.\(UUID().uuidString.replacingOccurrences(of:"-",with:""))")
 }
 static func main() {
  fixture {base,bundle in
  guard case .acquired(let owner)=SingleInstanceLock.acquire(bundleIdentifier:bundle,directory:base) else {assertionFailure("Expected lock acquisition to succeed");return}
  let second=SingleInstanceLock.acquire(bundleIdentifier:bundle,directory:base)
  guard case .contended=second else {assertionFailure("Expected lock contention");return}
  owner.releaseForTesting()
  _=owner
  guard case .acquired(let afterRelease)=SingleInstanceLock.acquire(bundleIdentifier:bundle,directory:base) else {assertionFailure("Expected acquisition after release to succeed");return}
  afterRelease.releaseForTesting()
  }
  fixture {base,bundle in
  do {
   let first=SingleInstanceLock.acquire(bundleIdentifier:bundle,directory:base)
   guard case .acquired(let firstLock)=first else {assertionFailure("Expected first acquisition to succeed");return}
   let second=SingleInstanceLock.acquire(bundleIdentifier:bundle,directory:base)
   guard case .contended=second else {assertionFailure("Expected second live acquisition to contend");return}
   firstLock.releaseForTesting()
  }
  let released=SingleInstanceLock.acquire(bundleIdentifier:bundle,directory:base)
  guard case .acquired(let reacquiredLock)=released else {assertionFailure("Expected acquisition after release to succeed");return}
  reacquiredLock.releaseForTesting()

  guard case .acquired(let afterRelease)=SingleInstanceLock.acquire(bundleIdentifier:bundle,directory:base) else {assertionFailure("Expected lock to be available after prior owner release");return}
  guard case .acquired(let independent)=SingleInstanceLock.acquire(bundleIdentifier:"com.example.other",directory:base) else {assertionFailure("Different bundle lock names must be independent");return}
  independent.releaseForTesting()
  afterRelease.releaseForTesting()

  let gate=NSLock();var winners:[SingleInstanceLock]=[];var attempts=0
  DispatchQueue.concurrentPerform(iterations:24){_ in
   let candidate=SingleInstanceLock.acquire(bundleIdentifier:bundle,directory:base)
   if case .acquired(let lock)=candidate {
    gate.lock();attempts+=1;winners.append(lock);gate.unlock()
   } else {
    gate.lock();attempts+=1;gate.unlock()
   }
  }
  assert(attempts==24 && winners.count==1,"concurrent launches must yield exactly one lock owner")
  winners.first?.releaseForTesting()
  winners.forEach{$0.releaseForTesting()}
  winners.removeAll()

  guard case .acquired(let secondaryOwner)=SingleInstanceLock.acquire(bundleIdentifier:bundle,directory:base) else {assertionFailure("Expected startup owner acquisition to succeed");return}
  let startupContention=SingleInstanceLock.acquire(bundleIdentifier:bundle,directory:base)
  guard case .contended=startupContention else {assertionFailure("Expected startup contention");return}
  var activated=0,bootstrapped=0
  let normalBootstrapped=SingleInstanceStartup.run(lock:secondaryOwner,activateExisting:{activated+=1},bootstrap:{bootstrapped+=1})
  assert(normalBootstrapped && activated==0 && bootstrapped==1,"acquired owner bootstraps exactly once")

  let identity=RuntimeIdentity.make(buildMarker:"executable-marker",bundle:.main)
  assert(identity.buildID=="executable-marker")
  let secondary=SecondaryInstanceDiagnostic(requestedBundlePath:"/Applications/Requested.app",bundleID:bundle,existingBundleURL:nil)
  assert(secondary.reason=="secondary_instance_detected" && secondary.existingBundlePath=="unavailable")
  assert(secondary.diagnosticsText.contains("requested bundle path: /Applications/Requested.app"))
  }
  fixture {inspectionBase,bundle in
  let paths=SingleInstancePaths.make(bundleIdentifier:bundle,base:inspectionBase)
  let valid=SingleInstanceOwnerMetadata(buildID:"build-a",bundlePath:"/Applications/A.app",executablePath:"/Applications/A.app/Contents/MacOS/A",bundleID:bundle,version:"6.2.3",launchTimestamp:"now")
  assert(SingleInstanceLock.writeMetadata(valid,to:paths.metadataURL))
  assert(FileManager.default.createFile(atPath:paths.lockURL.path,contents:nil,attributes:[.posixPermissions:0o600]))
  let pfd=paths.lockURL.path.withCString{open($0,O_RDWR|O_CLOEXEC|O_NOFOLLOW)}
  assert(pfd>=0 && flock(pfd,LOCK_EX|LOCK_NB)==0,"fixture_not_lock_free_before_inspection")
  _=flock(pfd,LOCK_UN);_=close(pfd)
  assert(SingleInstanceLock.inspect(bundleIdentifier:bundle,directory:inspectionBase) == .lockFree,"stale valid metadata cannot prove owner")
  let heldResult=SingleInstanceLock.acquire(bundleIdentifier:bundle,directory:inspectionBase,ownerMetadata:valid)
  guard case .acquired(let heldRelease)=heldResult else {assertionFailure("Expected metadata owner lock acquisition to succeed");return}
  if case .lockOccupied(let metadata)=SingleInstanceLock.inspect(bundleIdentifier:bundle,directory:inspectionBase){assert(metadata==valid)}else{assertionFailure("valid owner metadata should be returned")}
  try? FileManager.default.removeItem(at:paths.metadataURL)
  if case .lockOccupied(nil)=SingleInstanceLock.inspect(bundleIdentifier:bundle,directory:inspectionBase){}else{assertionFailure("missing metadata remains occupied")}
  try? Data("broken".utf8).write(to:paths.metadataURL)
  if case .lockOccupied(nil)=SingleInstanceLock.inspect(bundleIdentifier:bundle,directory:inspectionBase){}else{assertionFailure("corrupt metadata remains unavailable")}
  try? JSONEncoder().encode(SingleInstanceOwnerMetadata(buildID:"",bundlePath:"x",executablePath:"x",bundleID:bundle,version:"v",launchTimestamp:"t")).write(to:paths.metadataURL)
  if case .lockOccupied(nil)=SingleInstanceLock.inspect(bundleIdentifier:bundle,directory:inspectionBase){}else{assertionFailure("incomplete metadata remains unavailable")}
  assert(SingleInstanceLock.writeMetadata(valid,to:paths.metadataURL))
  let rechecked=SingleInstanceLock.inspect(bundleIdentifier:bundle,directory:inspectionBase,afterMetadataRead:{heldRelease.releaseForTesting()})
  assert(rechecked == .lockFreeAfterRecheck,"released owner is not evidence after recheck")
  let secondPaths=SingleInstancePaths.make(bundleIdentifier:"com.example.race",base:inspectionBase)
  let a=SingleInstanceOwnerMetadata(buildID:"old",bundlePath:"/old",executablePath:"/old/bin",bundleID:"com.example.race",version:"1",launchTimestamp:"t")
  let b=SingleInstanceOwnerMetadata(buildID:"new",bundlePath:"/new",executablePath:"/new/bin",bundleID:"com.example.race",version:"2",launchTimestamp:"t")
  assert(SingleInstanceLock.writeMetadata(a,to:secondPaths.metadataURL))
  DispatchQueue.concurrentPerform(iterations:100){i in _=SingleInstanceLock.writeMetadata(i.isMultiple(of:2) ? a:b,to:secondPaths.metadataURL)}
  if let decoded=try? JSONDecoder().decode(SingleInstanceOwnerMetadata.self,from:Data(contentsOf:secondPaths.metadataURL)){assert(decoded==a || decoded==b)}else{assertionFailure("atomic metadata must decode wholly")}
  }
  print("Single instance: explicit AcquireResult matching, release/reacquire lifetime, race inspection, atomic metadata and acquired startup passed")
 }
}

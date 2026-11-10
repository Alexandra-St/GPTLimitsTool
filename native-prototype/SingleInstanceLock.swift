import AppKit
import Darwin
import Foundation

struct SingleInstancePaths {
 let lockURL:URL
 let metadataURL:URL
 static func make(bundleIdentifier:String,base:URL)->SingleInstancePaths {
  let dir=base.appendingPathComponent("GPTLimitsTool",isDirectory:true)
  return SingleInstancePaths(lockURL:dir.appendingPathComponent("\(bundleIdentifier).lock"),metadataURL:dir.appendingPathComponent("\(bundleIdentifier).owner.json"))
 }
}

struct SingleInstanceOwnerMetadata:Codable,Equatable {
 let buildID:String;let bundlePath:String;let executablePath:String;let bundleID:String;let version:String;let launchTimestamp:String
 var isComplete:Bool {[buildID,bundlePath,executablePath,bundleID,version,launchTimestamp].allSatisfy{!$0.isEmpty}}
 var output:String {"owner build ID: \(buildID)\nowner bundle path: \(bundlePath)\nowner executable path: \(executablePath)\nowner bundle ID: \(bundleID)\nowner version: \(version)\nowner launch timestamp: \(launchTimestamp)"}
}

enum SingleInstanceInspectionResult:Equatable {
 case lockFree,lockFreeAfterRecheck,lockOccupied(SingleInstanceOwnerMetadata?),lockStateUnknown(String)
 var output:String {
  switch self {
  case .lockFree:return "lock_free"
  case .lockFreeAfterRecheck:return "lock_free_after_recheck"
  case .lockOccupied(let metadata):return "lock_occupied\n"+(metadata?.output ?? "owner_metadata_unavailable")
  case .lockStateUnknown(let error):return "lock_state_unknown\nerror class: \(error)"
  }
 }
}

final class SingleInstanceLock {
 private let descriptor:Int32
 private let metadataURL:URL
 private init(descriptor:Int32,metadataURL:URL){self.descriptor=descriptor;self.metadataURL=metadataURL}
 deinit { _=flock(descriptor,LOCK_UN);_=close(descriptor) }
 func releaseForTesting(){_=flock(descriptor,LOCK_UN)}
 static func defaultPaths(bundleIdentifier:String)->SingleInstancePaths? {
  guard bundleIdentifier.range(of:"^[A-Za-z0-9.-]{1,200}$",options:.regularExpression) != nil,
   let base=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask).first else{return nil}
  return SingleInstancePaths.make(bundleIdentifier:bundleIdentifier,base:base)
 }
 enum AcquireResult {case acquired(SingleInstanceLock),contended,failed(errno:Int32)}
 static func acquire(bundleIdentifier:String,directory:URL?=nil,ownerMetadata:SingleInstanceOwnerMetadata?=nil)->AcquireResult {
  guard bundleIdentifier.range(of:"^[A-Za-z0-9.-]{1,200}$",options:.regularExpression) != nil,
   let base=directory ?? FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask).first else{return .failed(errno:EINVAL)}
  let paths=SingleInstancePaths.make(bundleIdentifier:bundleIdentifier,base:base)
  do {try FileManager.default.createDirectory(at:paths.lockURL.deletingLastPathComponent(),withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])} catch{return .failed(errno:EACCES)}
  let fd=paths.lockURL.path.withCString{open($0,O_CREAT|O_RDWR|O_CLOEXEC|O_NOFOLLOW,mode_t(S_IRUSR|S_IWUSR))}
  guard fd>=0 else{let error=errno;return .failed(errno:error)}
  guard fchmod(fd,mode_t(S_IRUSR|S_IWUSR))==0 else{let error=errno;_=close(fd);return .failed(errno:error)}
  if flock(fd,LOCK_EX|LOCK_NB) != 0 {let error=errno;_=close(fd);return error==EWOULDBLOCK || error==EAGAIN ? .contended:.failed(errno:error)}
  if let ownerMetadata { _=writeMetadata(ownerMetadata,to:paths.metadataURL) }
  return .acquired(SingleInstanceLock(descriptor:fd,metadataURL:paths.metadataURL))
 }
 @discardableResult static func writeMetadata(_ metadata:SingleInstanceOwnerMetadata,to url:URL)->Bool {
  guard metadata.isComplete,let data=try? JSONEncoder().encode(metadata) else{return false}
  let dir=url.deletingLastPathComponent();do{try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])}catch{return false}
  let temp=dir.appendingPathComponent(".\(url.lastPathComponent).\(UUID().uuidString).tmp")
  guard FileManager.default.createFile(atPath:temp.path,contents:nil,attributes:[.posixPermissions:0o600]),let handle=try? FileHandle(forWritingTo:temp) else{return false}
  do {try handle.write(contentsOf:data);try handle.synchronize();try handle.close();try FileManager.default.replaceItemAt(url,withItemAt:temp);return true}
  catch {try? handle.close();try? FileManager.default.removeItem(at:temp);if !FileManager.default.fileExists(atPath:url.path){return rename(temp.path,url.path)==0};return false}
 }
 private static func decodeMetadata(_ url:URL)->SingleInstanceOwnerMetadata? {
  guard let data=try? Data(contentsOf:url),let value=try? JSONDecoder().decode(SingleInstanceOwnerMetadata.self,from:data),value.isComplete else{return nil};return value
 }
 static func inspect(bundleIdentifier:String,directory:URL?=nil,afterMetadataRead:(()->Void)?=nil)->SingleInstanceInspectionResult {
  guard let base=directory ?? FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask).first,
   bundleIdentifier.range(of:"^[A-Za-z0-9.-]{1,200}$",options:.regularExpression) != nil else{return .lockStateUnknown("invalid_configuration")}
  let paths=SingleInstancePaths.make(bundleIdentifier:bundleIdentifier,base:base)
  let fd=paths.lockURL.path.withCString{open($0,O_RDWR|O_CLOEXEC|O_NOFOLLOW)}
  if fd<0 {return errno==ENOENT ? .lockFree:.lockStateUnknown(errnoClass(errno))}
  defer{_=close(fd)}
  if flock(fd,LOCK_EX|LOCK_NB)==0 {_=flock(fd,LOCK_UN);return .lockFree}
  let firstError=errno
  guard isBusy(firstError) else{return .lockStateUnknown(errnoClass(firstError))}
  let metadata=decodeMetadata(paths.metadataURL)
  afterMetadataRead?()
  if flock(fd,LOCK_EX|LOCK_NB)==0 {_=flock(fd,LOCK_UN);return .lockFreeAfterRecheck}
  let secondError=errno
  guard isBusy(secondError) else{return .lockStateUnknown(errnoClass(secondError))}
  return .lockOccupied(metadata)
 }
 private static func isBusy(_ value:Int32)->Bool {value==EWOULDBLOCK || value==EAGAIN}
 private static func errnoClass(_ value:Int32)->String {switch value{case EACCES,EPERM:return "permission_denied";case EBADF:return "bad_descriptor";case EINVAL:return "invalid_lock_request";case ENOENT:return "lock_file_missing";default:return "system_error_\(value)"}}
}

enum SingleInstanceStartup {
 @discardableResult static func run(lock:SingleInstanceLock?,activateExisting:()->Void,bootstrap:()->Void)->Bool {
  guard lock != nil else{activateExisting();return false};bootstrap();return true
 }
}

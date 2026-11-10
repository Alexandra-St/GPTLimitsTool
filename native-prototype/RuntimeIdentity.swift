import Foundation

struct RuntimeIdentity:Equatable {
 let buildID:String
 let version:String
 let bundleID:String
 let bundlePath:String
 let executablePath:String
 static func make(buildMarker:String,bundle:Bundle)->RuntimeIdentity {
  RuntimeIdentity(buildID:buildMarker,version:bundle.infoDictionary?["GPTLimitsBuildVersion"] as? String ?? "unavailable",bundleID:bundle.bundleIdentifier ?? "unavailable",bundlePath:bundle.bundleURL.standardizedFileURL.path,executablePath:bundle.executableURL?.standardizedFileURL.path ?? "unavailable")
 }
 var diagnosticsText:String {"Running build ID: \(buildID)\nRunning version: \(version)\nRunning bundle ID: \(bundleID)\nRunning bundle path: \(bundlePath)\nRunning executable path: \(executablePath)"}
}

struct SecondaryInstanceDiagnostic:Equatable {
 let reason:String
 let requestedBundlePath:String
 let bundleID:String
 let existingBundlePath:String
 init(requestedBundlePath:String?,bundleID:String?,existingBundleURL:URL?) {
  reason="secondary_instance_detected"
  self.requestedBundlePath=requestedBundlePath ?? "unavailable"
  self.bundleID=bundleID ?? "unavailable"
  existingBundlePath=existingBundleURL?.standardizedFileURL.path ?? "unavailable"
 }
 var diagnosticsText:String {"\(reason) · requested bundle path: \(requestedBundlePath) · bundle ID: \(bundleID) · existing bundle path: \(existingBundlePath)"}
}

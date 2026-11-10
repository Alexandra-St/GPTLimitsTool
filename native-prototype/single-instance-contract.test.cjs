const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const main=fs.readFileSync(path.join(root,'Main.swift'),'utf8');
const build=fs.readFileSync(path.join(root,'build.sh'),'utf8');
const lock=fs.readFileSync(path.join(root,'SingleInstanceLock.swift'),'utf8');
const identity=fs.readFileSync(path.join(root,'RuntimeIdentity.swift'),'utf8');

test('single-instance lock is acquired before AppKit and Prototype bootstrap',()=>{
 const entry=main.slice(main.indexOf('@main struct PrototypeMain'));
 const acquire=entry.indexOf('SingleInstanceLock.acquire');
 const route=entry.indexOf('SingleInstanceStartup.run');
 const app=entry.indexOf('NSApplication.shared');
 const delegate=entry.indexOf('Prototype()');
 assert.ok(acquire>=0 && acquire<route && route<app && app<delegate);
 assert.match(entry,/if !didBootstrap \{exit\(EXIT_SUCCESS\)\}/);
});
test('lock uses OS flock exclusive non-blocking mode and keeps its descriptor for object lifetime',()=>{
 assert.match(lock,/flock\(fd,\s*LOCK_EX\s*\|\s*LOCK_NB\)/);
 assert.match(lock,/private let descriptor:Int32/);
 assert.match(lock,/deinit\s*\{[^}]*flock\(descriptor,\s*LOCK_UN\)[^}]*close\(descriptor\)/s);
 assert.match(lock,/static func inspect[\s\S]*open\(\$0,O_RDWR\|O_CLOEXEC\|O_NOFOLLOW\)/);
 assert.match(lock,/if fd<0 \{return errno==ENOENT \? \.lockFree/);
 const inspect=lock.slice(lock.indexOf('static func inspect'),lock.indexOf('private static func isBusy'));
 assert.ok(inspect.indexOf('flock(fd,LOCK_EX|LOCK_NB)')<inspect.indexOf('decodeMetadata(paths.metadataURL)'));
 assert.ok(inspect.indexOf('decodeMetadata(paths.metadataURL)')<inspect.lastIndexOf('flock(fd,LOCK_EX|LOCK_NB)'));
 assert.match(inspect,/return \.lockOccupied\(metadata\)/);
});
test('secondary startup activates existing app and skips bootstrap',()=>{
 const entry=main.slice(main.indexOf('@main struct PrototypeMain'));
 const dispatch=entry.slice(entry.indexOf('switch acquire'),entry.indexOf('\n }\n}',entry.indexOf('switch acquire')));
 assert.match(dispatch,/case \.acquired\(let lock\):[\s\S]*SingleInstanceStartup\.run\(lock:lock/);
 assert.match(dispatch,/case \.contended:[\s\S]*existing\?\.activate/);
 assert.match(dispatch,/case \.failed\(let error\):[\s\S]*single_instance_lock_failed/);
 assert.doesNotMatch(dispatch,/case \.failed[\s\S]*existing\?\.activate/);
 assert.match(entry,/NSRunningApplication\.runningApplications\(withBundleIdentifier:"com\.alexandrast\.gptlimitstool"\)\.first/);
 assert.match(entry,/existing\?\.activate\(options:\[\]\)/);
 assert.ok(entry.indexOf('if !didBootstrap')>entry.indexOf('SingleInstanceStartup.run'));
 assert.match(identity,/reason="secondary_instance_detected"/);
 assert.match(identity,/existingBundleURL\?\.standardizedFileURL\.path \?\? "unavailable"/);
});
test('startup helper receives an extracted acquired lock only',()=>{
 const tests=fs.readFileSync(path.join(root,'SingleInstanceLockTests.swift'),'utf8');
 assert.match(tests,/guard case \.acquired\(let secondaryOwner\)=SingleInstanceLock\.acquire/);
 assert.match(tests,/SingleInstanceStartup\.run\(lock:secondaryOwner/);
 assert.doesNotMatch(tests,/SingleInstanceStartup\.run\(lock:SingleInstanceLock\.acquire/);
});
test('production build and typecheck compile the same lock implementation',()=>{
 assert.equal((build.match(/SingleInstanceLock\.swift/g)||[]).length,3);
});

test('running identity uses executable marker and Bundle.main paths, independently of persisted cycle state',()=>{
 assert.match(identity,/buildID:buildMarker/);
 assert.match(identity,/bundle\.bundleURL\.standardizedFileURL\.path/);
 assert.match(identity,/bundle\.executableURL\?\.standardizedFileURL\.path/);
 assert.ok(main.includes('Runtime build ID: \\(bundleBuildID)'));
 assert.ok(main.includes('Executable build ID: \\(executableBuildID)'));
 assert.ok(main.includes('Current bundle ID: \\(Bundle.main.bundleIdentifier'));
 assert.doesNotMatch(identity,/lastCycle|CycleState/);
});

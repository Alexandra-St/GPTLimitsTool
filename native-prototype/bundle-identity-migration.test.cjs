const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const main = fs.readFileSync(path.join(root, 'Main.swift'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'CycleEngine.swift'), 'utf8');
const model = fs.readFileSync(path.join(root, 'CycleModel.swift'), 'utf8');
const build = fs.readFileSync(path.join(root, 'build.sh'), 'utf8');
const installer = fs.readFileSync(path.join(root, 'install-local.sh'), 'utf8');

test('bundle identity migration runs before UI, cycle restoration, and notification authorization', () => {
  const launch = main.slice(main.indexOf('func applicationDidFinishLaunching'), main.indexOf('func button('));
  const migration = launch.indexOf('migrateBundleIdentityDefaultsAtStartup()');
  assert.ok(migration >= 0);
  for (const later of ['register(defaults:', 'buildUserWindows()', 'restoreCycle()']) {
    assert.ok(launch.indexOf(later) > migration, `${later} must run after migration`);
  }
  assert.doesNotMatch(launch, /requestAuthorization\(/, 'permission prompt must wait for the explicit Settings action');
});

test('bundle identity migration is bounded to the legacy domain, two data keys, and a completion marker', () => {
  assert.match(model, /legacyBundleIdentityDefaultsDomain="local\.GPTLimitsTool\.Feasibility"/);
  assert.match(model, /bundleIdentityMigrationMarkerKey="bundleIdentityMigrationV1Completed"/);
  assert.match(model, /nativeCycleStateDefaultsKey="nativeCycleStateV1"/);
  assert.match(model, /showChatTitlesInNotificationsDefaultsKey/);
  assert.match(engine, /persistentDomain\(forName:legacyBundleIdentityDefaultsDomain\)/);
  assert.match(engine, /if let failure=plan\.failureReason/);
  assert.match(engine, /bundleIdentityMigrationFailureKey/);
  assert.match(main, /Current bundle ID:[\s\S]*bundle identity migration:/);
});

test('production build and installer use the v6 bundle identity', () => {
  for (const source of [build, installer]) assert.match(source, /com\.alexandrast\.gptlimitstool/);
  assert.match(main, /gptLimitsAppVersion="6\.2\.3"/);
});

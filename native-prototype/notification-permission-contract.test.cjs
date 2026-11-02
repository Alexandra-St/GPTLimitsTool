const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, 'Main.swift'), 'utf8');
const section = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));

test('Settings permission action directly requests alert and sound authorization', () => {
  assert.match(main, /button\("Request notification permission",#selector\(requestNotificationPermission\)\)/);
  const action = section('@objc func requestNotificationPermission()', 'func notificationAuthorizationLabel');
  assert.match(action, /UNUserNotificationCenter\.current\(\)\.requestAuthorization\(options:\[\.alert,\.sound\]\)/);
  assert.match(action, /requested=yes · granted=unknown · error=none · resulting authorization=pending/);
});

test('permission completion records granted, denied, or sanitized error then refreshes Settings and Diagnostics', () => {
  const action = section('@objc func requestNotificationPermission()', 'func notificationAuthorizationLabel');
  assert.match(action, /error == nil \? \(granted \? "yes":"no"\) : "unknown"/);
  assert.match(action, /UNErrorDomain.*other_error.*code/);
  assert.doesNotMatch(action, /localizedDescription/);
  assert.match(action, /refreshNotificationAuthorization \{ status in/);
  assert.match(action, /resulting authorization=\\\(self\.notificationAuthorizationLabel\(status\)\)/);
  const refresh = section('func refreshNotificationAuthorization(', 'func refreshNotificationIdentityDiagnostics');
  assert.match(refresh, /getNotificationSettings/);
  assert.match(refresh, /settingsNotificationStatus\.stringValue/);
  assert.match(refresh, /completion\?\(status\)/);
  assert.match(main, /Permission request: \\\(lastNotificationPermissionRequest\)/);
});

test('opening the app no longer requests permission implicitly and the test-notification path remains intact', () => {
  const launch = section('func applicationDidFinishLaunching', 'func button(');
  assert.doesNotMatch(launch, /requestAuthorization\(/);
  const testPath = section('@objc func testNotification()', 'func userNotificationCenter(');
  assert.match(testPath, /requestAuthorization\(options: \[\.alert, \.sound\]\)/);
  assert.match(testPath, /center\.add\(request\)/);
});

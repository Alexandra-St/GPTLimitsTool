const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, 'Main.swift'), 'utf8');
const start = main.indexOf('func refreshNotificationIdentityDiagnostics()');
const end = main.indexOf('\n    }', start);
const refresh = main.slice(start, end);

test('identity diagnostics displays runtime bundle metadata dynamically and preserves notification identity', () => {
  assert.ok(start >= 0, 'identity diagnostics refresh helper exists');
  assert.match(refresh, /let runtimeBundlePath=Bundle\.main\.bundleURL\.path/);
  assert.match(refresh, /let bundleID=Bundle\.main\.bundleIdentifier/);
  assert.match(refresh, /let runtimeVersion=info\["CFBundleShortVersionString"\] as\? String/);
  assert.match(refresh, /let runtimeBuild=info\["GPTLimitsBuildID"\] as\? String/);
  assert.match(refresh, /Running bundle path: \\\(runtimeBundlePath\)/);
  assert.match(refresh, /Running bundle ID: \\\(bundleID\)/);
  assert.match(refresh, /Running version: \\\(runtimeVersion\)/);
  assert.match(refresh, /Running build: \\\(runtimeBuild\)/);
  assert.match(refresh, /Notification identity: \\\(bundleID\)/);
  assert.doesNotMatch(refresh, /\/Applications\/GPT Limits Tool|com\.alexandrast\.gptlimitstool|5e097bbf05c27cba/);
});

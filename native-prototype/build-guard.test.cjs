const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const buildScript = path.join(root, 'native-prototype', 'build.sh');
const stableBundle = process.env.GPT_LIMITS_TEST_APP || path.join(root, 'native-prototype', 'build', 'GPTLimitsNativePrototype.app');

function verify(bundle) {
  return spawnSync('sh', [buildScript, '--verify', bundle], { encoding: 'utf8' });
}

test('stable bundle freshness verifier accepts the current built app', () => {
  const result = verify(stableBundle);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Freshness check passed: v6\.2\.2/);
});

test('freshness verifier rejects a stale bundled resource', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-limits-stale-resource-'));
  try {
    const copy = path.join(tempRoot, 'GPTLimitsNativePrototype.app');
    fs.cpSync(stableBundle, copy, { recursive: true });
    fs.appendFileSync(path.join(copy, 'Contents', 'Resources', 'bridge.js'), '\n// stale fixture\n');
    const result = verify(copy);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bundled resource 'bridge\.js' differs from source/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});


test('freshness verifier rejects a missing app icon asset', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-limits-missing-icon-'));
  try {
    const copy = path.join(tempRoot, 'GPTLimitsNativePrototype.app');
    fs.cpSync(stableBundle, copy, { recursive: true });
    fs.rmSync(path.join(copy, 'Contents', 'Resources', 'AppIcon.icns'));
    const result = verify(copy);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bundled AppIcon\.icns differs from source/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('freshness verifier rejects a stale app icon asset', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-limits-stale-icon-'));
  try {
    const copy = path.join(tempRoot, 'GPTLimitsNativePrototype.app');
    fs.cpSync(stableBundle, copy, { recursive: true });
    fs.appendFileSync(path.join(copy, 'Contents', 'Resources', 'AppIcon.icns'), Buffer.from([0]));
    const result = verify(copy);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bundled AppIcon\.icns differs from source/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('freshness verifier rejects a stale executable even when bundle metadata claims current build', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-limits-stale-executable-'));
  try {
    const copy = path.join(tempRoot, 'GPTLimitsNativePrototype.app');
    fs.cpSync(stableBundle, copy, { recursive: true });
    fs.writeFileSync(path.join(copy, 'Contents', 'MacOS', 'GPTLimitsNativePrototype'), 'stale executable');
    const result = verify(copy);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /executable does not contain runtime version marker|executable build ID does not match/);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

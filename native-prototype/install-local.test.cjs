const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const installer = path.join(__dirname, 'install-local.sh');
const stagingBundle = '/private/tmp/GPTLimitsTool-Step27.app';
const stableBundle = process.env.GPT_LIMITS_TEST_APP || (fs.existsSync(stagingBundle) ? stagingBundle : path.join(__dirname, 'build', 'GPTLimitsNativePrototype.app'));
const tempRoot = () => fs.mkdtempSync(path.join('/private/tmp', 'gpt-limits-install-test-'));
const installAt = (dir, build = stableBundle) => spawnSync('sh', [installer, build, '--test-root', dir], { encoding: 'utf8' });
const plist = (bundle, key) => spawnSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(bundle, 'Contents', 'Info.plist')], { encoding: 'utf8' }).stdout.trim();

 test('installer performs a fresh local install using release name and app icon metadata', () => {
  const dir = tempRoot();
  try {
    const result = installAt(dir);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const installed = path.join(dir, 'GPT Limits Tool.app');
    assert.equal(plist(installed, 'CFBundleName'), 'GPT Limits Tool');
    assert.equal(plist(installed, 'CFBundleDisplayName'), 'GPT Limits Tool');
    assert.equal(plist(installed, 'CFBundleIdentifier'), 'com.alexandrast.gptlimitstool');
    assert.equal(plist(installed, 'CFBundleIconFile'), 'AppIcon.icns');
    assert.equal(fs.readFileSync(path.join(installed, 'Contents', 'Resources', 'AppIcon.icns')).compare(fs.readFileSync(path.join(stableBundle, 'Contents', 'Resources', 'AppIcon.icns'))), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('installer replaces an older app while preserving external WebKit and preference data', () => {
  const dir = tempRoot();
  try {
    const installed = path.join(dir, 'GPT Limits Tool.app');
    fs.mkdirSync(path.join(installed, 'Contents'), { recursive: true });
    fs.writeFileSync(path.join(installed, 'old-install-marker'), 'old version');
    const webkitData = path.join(dir, 'Library', 'WebKit', 'WebsiteData', 'session-preservation-fixture');
    const preferences = path.join(dir, 'Library', 'Preferences', 'legacy-preferences.plist');
    fs.mkdirSync(path.dirname(webkitData), { recursive: true });
    fs.mkdirSync(path.dirname(preferences), { recursive: true });
    fs.writeFileSync(webkitData, 'preserve');
    fs.writeFileSync(preferences, 'preserve');
    const result = installAt(dir);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(path.join(installed, 'old-install-marker')), false);
    assert.equal(fs.readFileSync(webkitData, 'utf8'), 'preserve');
    assert.equal(fs.readFileSync(preferences, 'utf8'), 'preserve');
    assert.equal(plist(installed, 'GPTLimitsBuildVersion'), '6.2.3');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('installer rejects a stale build before touching an existing installation', () => {
  const dir = tempRoot();
  const stale = path.join(dir, 'stale.app');
  try {
    fs.cpSync(stableBundle, stale, { recursive: true });
    fs.appendFileSync(path.join(stale, 'Contents', 'Resources', 'bridge.js'), '\n// stale installer fixture\n');
    const installed = path.join(dir, 'GPT Limits Tool.app');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, 'preserve-old-install'), 'previous app');
    const result = installAt(dir, stale);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /bundled resource 'bridge\.js' differs from source/);
    assert.equal(fs.readFileSync(path.join(installed, 'preserve-old-install'), 'utf8'), 'previous app');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('explicit staging source is installed and verified independent of repository build artifact', () => {
  const dir = tempRoot();
  try {
    const result = installAt(dir, stableBundle);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const installed = path.join(dir, 'GPT Limits Tool.app');
    const sourceId = plist(stableBundle, 'GPTLimitsBuildID');
    assert.ok(sourceId);
    assert.equal(plist(installed, 'GPTLimitsBuildID'), sourceId);
    const executable = fs.readFileSync(path.join(installed, 'Contents', 'MacOS', 'GPTLimitsNativePrototype'));
    assert.ok(executable.includes(Buffer.from(sourceId)));
    const verify = spawnSync('sh', [path.join(__dirname, 'build.sh'), '--verify', installed], { encoding: 'utf8' });
    assert.equal(verify.status, 0, `${verify.stdout}\n${verify.stderr}`);
    const signature = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed], { encoding: 'utf8' });
    assert.equal(signature.status, 0, `${signature.stdout}\n${signature.stderr}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('production installer stops only matching app executables before replacing the installed bundle', () => {
  const source = fs.readFileSync(installer, 'utf8');
  assert.match(source,/build_app=\$\{1:/);
  assert.doesNotMatch(source,/build_app=\"\$root\/native-prototype\/build\/GPTLimitsNativePrototype\.app\"/);
  assert.ok(source.indexOf('process_ids=$(pgrep -x') < source.indexOf('ditto --rsrc --extattr'));
  assert.match(source, /case "\$process_executable" in[\s\S]*"\$build_executable"\|"\$installed_executable"/);
  assert.match(source, /"\$lsregister" -f "\$install_app"/);
  assert.match(source, /open -n "\$install_app"/);
});

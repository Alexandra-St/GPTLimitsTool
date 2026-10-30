const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, 'Main.swift'), 'utf8');

test('Diagnostics document height follows fitting size and laid-out section geometry', () => {
  const layout = main.slice(main.indexOf('func layoutDiagnosticsDocument()'), main.indexOf('func windowDidResize'));
  assert.match(layout, /scroll\.contentView\.bounds\.width/);
  assert.match(layout, /stack\.layoutSubtreeIfNeeded\(\)/);
  assert.match(layout, /for section in stack\.arrangedSubviews[\s\S]*section\.fittingSize\.height[\s\S]*stack\.arrangedSubviews\.count-1/);
  assert.match(layout, /diagnosticsSectionBounds\(in:document,stack:stack\)/);
  assert.match(layout, /max\(scroll\.contentView\.bounds\.height,actualContentHeight\+40\)/);
  assert.match(layout, /document\.setFrameSize\(NSSize\(width:width,height:height\)\)/);
  assert.match(layout, /scroll\.reflectScrolledClipView\(scroll\.contentView\)/);
  assert.match(layout, /maximumOriginY=max\(0,document\.frame\.height-scroll\.contentView\.bounds\.height\)/);
  assert.doesNotMatch(layout, /fixedHeight|4000/);
  assert.match(main, /func diagnosticsSectionBounds\(in document:NSView,stack:NSStackView\)/);
  assert.match(main, /final class DiagnosticsDocumentView:NSView[\s\S]*override var isFlipped:Bool \{true\}/);
  assert.match(main, /DiagnosticsDocumentView\(frame:/);
  assert.match(main, /final class DiagnosticsStackView:NSStackView[\s\S]*override var isFlipped:Bool \{true\}/);
  assert.match(main, /let stack=DiagnosticsStackView\(\)/);
  assert.match(main, /let section=DiagnosticsStackView\(\)/);
});

test('Diagnostics recalculates document bounds after text updates and window resize', () => {
  assert.match(main, /field\.observe\(\\\.stringValue,options:\[\.new\]\)/);
  assert.match(main, /DispatchQueue\.main\.async \{ self\?\.layoutDiagnosticsDocument\(\) \}/);
  assert.match(main, /func windowDidResize\(_ notification:Notification\)[\s\S]*self\.layoutDiagnosticsDocument\(\)/);
  assert.doesNotMatch(main, /stack\.bottomAnchor\.constraint\(equalTo:document\.bottomAnchor/);
  assert.match(main, /diagnosticsLayoutTelemetry=/);
  assert.match(main, /document\.bounds\.contains\(lastRect\)/);
  assert.match(main, /visible\.intersects\(lastRect\)/);
  assert.match(main, /boundsDidChangeNotification/);
  assert.match(main, /stack\.setContentCompressionResistancePriority\(\.required,for:\.vertical\)/);
});

test('Diagnostics attaches one scroll document and retains the complete control groups', () => {
  assert.match(main, /scroll\.documentView=document/);
  for (const control of [
    'Check chat (hidden WebView)', 'Send test notification', 'Refresh recent chats',
    'Diagnose visible home', 'Inspect sidebar route templates', 'Inspect pinned prefix + activity',
    'Run cycle now', 'Use latest complete chat as Normal sample'
  ]) assert.ok(main.includes(`button("${control}"`), `missing Diagnostics control ${control}`);
});

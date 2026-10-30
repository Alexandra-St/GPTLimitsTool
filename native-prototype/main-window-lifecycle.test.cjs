const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
const section=(source,start,end)=>{
  const from=source.indexOf(start);
  const to=source.indexOf(end,from+start.length);
  assert.ok(from>=0,`missing section start: ${start}`);
  assert.ok(to>from,`missing section end: ${end}`);
  return source.slice(from,to);
};

test('main window close hides the retained view tree and reopen reuses it',()=>{
  const construction=section(main,'func buildUserWindows()','func renderUserUI()');
  assert.match(construction,/mainWindow\.isReleasedWhenClosed=false/);
  assert.match(construction,/mainWindow\.delegate=self/);
  assert.match(construction,/let mainContainer=NSView\(\);mainContainer\.addSubview\(content\);mainWindow\.contentView=mainContainer/);

  const close=section(main,'func windowShouldClose(_ window:NSWindow)->Bool','func uiLabel(');
  assert.match(close,/guard window===mainWindow else\{return true\}/);
  assert.match(close,/window\.orderOut\(nil\)/);
  assert.match(close,/return false/);
  assert.doesNotMatch(close,/contentView\s*=\s*nil|removeFromSuperview|\.close\(/);

  const reopen=section(main,'func applicationShouldHandleReopen','func applicationDidFinishLaunching');
  assert.match(reopen,/showMainWindow\(\)/);
  const show=section(main,'@objc func showMainWindow()','@objc func showSettings()');
  assert.match(show,/presentWindow\(mainWindow,intent:\.userInitiated,callSite:"menu_main_window"\)/);
  assert.match(show,/renderUserUI\(\)/);
  assert.doesNotMatch(show,/NSWindow\(|contentView\s*=|removeFromSuperview/);
});

test('main window close interception does not alter other window close behavior',()=>{
  const close=section(main,'func windowShouldClose(_ window:NSWindow)->Bool','func uiLabel(');
  assert.match(close,/guard window===mainWindow else\{return true\}/);
  assert.equal((close.match(/return true/g)||[]).length,1);
});

test('Diagnostics captures sanitized A/B/C main-window view and layer state without changing ownership',()=>{
  const capture=section(main,'func recordMainWindowLifecycleSnapshot(_ stage:String)','func uiLabel(');
  for(const field of [
    'window stable:', 'content stable:', 'controller:', 'root stable:', 'frame/bounds:',
    'hidden:', 'alpha:', 'attached:', 'needsLayout/display:', 'occlusion:',
    'key/main:', 'identityStable:', 'shared main/Diagnostics views/layers:', 'direct subviews'
  ]) assert.ok(capture.includes(field),`missing main window lifecycle field ${field}`);
  assert.match(capture,/mainWindowLifecycleSnapshots\.count>12/);
  assert.doesNotMatch(capture,/title|textContent|stringValue.*record/);

  const callbacks=main.slice(main.indexOf('func windowDidBecomeKey'),main.indexOf('func windowShouldClose'));
  assert.match(callbacks,/B diagnostics became key/);
  assert.match(callbacks,/C main became key/);
  assert.match(callbacks,/C diagnostics will close/);
  assert.match(callbacks,/C after diagnostics close/);

  const showPanel=section(main,'@objc func showPanel()','@objc func showMainWindow()');
  assert.match(showPanel,/A before diagnostics/);
  assert.match(showPanel,/B diagnostics presentation returned/);
  assert.match(showPanel,/B diagnostics next runloop/);
  assert.doesNotMatch(showPanel,/mainWindow\.contentView\s*=|removeFromSuperview|NSWindow\(/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'native-rescue-bridge.js'), 'utf8');
function makeBridge(collect) {
  const messages=[];
  const window={
    GptChatRescue:{
      collect,
      renderHTML:result=>`<html>${result.status}:${result.messages.length}</html>`,
      renderText:result=>`text:${result.messages.length}`,
    },
    webkit:{messageHandlers:{nativeRescue:{postMessage:value=>messages.push(value)}}},
  };
  window.top=window;window.location={hostname:'chatgpt.com'};
  vm.runInNewContext(source,{window,document:{},Set,Promise,Number});
  return {bridge:window.GptNativeRescue,messages};
}
const id='c2b9718e-9cb8-4f46-9b32-4cba88a7c1aa';

test('native rescue bridge acknowledges synchronously and reports bounded sanitized progress and result',async()=>{
  const {bridge,messages}=makeBridge(async options=>{
    options.onProgress({capturedUniqueMessages:4,step:2,elapsedMs:900,scrollPercent:40});
    return {status:'rescue_complete',reason:'top_and_end_reached',messages:[{text:'private message'}],restoreSuccess:true,generatedAt:'2026-10-26T00:00:00Z'};
  });
  assert.equal(bridge.start(id),'started');
  assert.equal(messages[0].type,'started');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(messages[1].type,'progress');
  assert.equal(messages[1].capturedUniqueMessages,4);
  const finished=messages.find(message=>message.type==='finished');
  assert.equal(finished.status,'rescue_complete');
  assert.equal(finished.messageCount,1);
  assert.equal(finished.html,'<html>rescue_complete:1</html>');
  assert.equal(finished.text,'text:1');
  assert.equal(finished.mainFrame,true);
  assert.equal(finished.chatgptDocument,true);
  assert.equal(JSON.stringify(messages).includes('private message'),false);
  assert.equal(JSON.stringify(messages).includes('conversationId'),false);
});

test('native bridge forwards only sanitized DOM diagnostics for zero-message extraction',async()=>{
  const diagnostics={readyState:'complete',mainCount:1,articleLikeCount:4,explicitAuthorRoleCount:0,conversationTurnCount:4,roleAriaMetadataCount:8,visibleTextBearingCandidateBlocks:0,validatedMessageCandidateCount:0,mainDirectChildShape:[{tag:'div',classTokenCount:2}],isTopLevelFrame:true,chatgptDocument:true};
  const {bridge,messages}=makeBridge(async()=>({status:'rescue_unsupported_layout',reason:'message_blocks_unavailable',messages:[],restoreSuccess:true,domDiagnostics:diagnostics}));
  bridge.start(id);await new Promise(resolve=>setImmediate(resolve));
  const result=messages.find(message=>message.type==='finished');
  assert.equal(result.messageCount,0);
  assert.deepEqual(JSON.parse(JSON.stringify(result.domDiagnostics)),diagnostics);
  assert.equal(JSON.stringify(result).includes('conversationId'),false);
  assert.equal(JSON.stringify(result).includes('messageId'),false);
  assert.equal(JSON.stringify(result).includes('private-conversation-id'),false);
});

test('native rescue bridge rejects duplicate or malformed starts and cancellation is operation scoped',async()=>{
  let resolveCollection;
  const {bridge,messages}=makeBridge(()=>new Promise(resolve=>{resolveCollection=resolve;}));
  assert.equal(bridge.start('bad-id'),'operation_id_invalid_format');
  assert.equal(bridge.start(id),'started');
  assert.equal(bridge.start(id),'already_running');
  assert.equal(bridge.cancel('00000000-0000-4000-8000-000000000000'),'not_running');
  assert.equal(bridge.cancel(id),'cancel_requested');
  resolveCollection({status:'rescue_cancelled',reason:'user_cancelled',messages:[],restoreSuccess:true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(messages.at(-1).type,'finished');
  assert.equal(messages.at(-1).status,'rescue_cancelled');
});

test('installed native UI exposes confirmed local export and binds only the current ChatGPT frame',()=>{
  const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
  const build=fs.readFileSync(path.join(__dirname,'build.sh'),'utf8');
  assert.match(main,/message\.name=="nativeRescue"[\s\S]*handleNativeRescueMessage/);
  assert.match(main,/func beginNativeRescue\(\)[\s\S]*session_unavailable[\s\S]*Start rescue/);
  assert.match(main,/func cancelNativeRescue\(\)[\s\S]*GptNativeRescue\?\.cancel/);
  assert.match(main,/func saveNativeRescueExports\([\s\S]*NSSavePanel/);
  assert.match(main,/if count == 0[\s\S]*no empty export saved[\s\S]*saveNativeRescueExports/);
  assert.match(main,/let dom=data\["domDiagnostics"\] as\? \[String:Any\]/);
  assert.match(main,/visible session WebView yes/);
  assert.match(source,/domDiagnostics: result\.domDiagnostics \|\| null/);
  assert.match(main,/allowedContentTypes=\[\.html\]/);
  assert.match(main,/allowedContentTypes=\[\.plainText\]/);
  assert.match(main,/func finishNativeRescueLocally[\s\S]*nativeRescueHTML=nil;nativeRescueText=nil/);
  assert.match(build,/native-rescue-bridge\.js/);
  assert.match(build,/extension\/rescue\.js/);
  assert.match(main,/native-rescue-bridge\.js/);
  assert.doesNotMatch(main,/nativeRescue(?:HTML|Text)[^\n]{0,100}(?:print|log)/i);
  const controls=['showSession','check','hideSession','testNotification','toggleRiskNotificationTitles','refreshRecent','checkFirstRecent','diagnoseVisibleHome','diagnoseHiddenHome','diagnoseSidebarRoutes','diagnoseSidebarTopPosition','diagnoseVisiblePinnedRows','inspectHiddenWebViewRendering','diagnosePinnedActivityTimestamp'];
  for(const action of controls){
    assert.match(main,new RegExp(`@objc func ${action}\\b|@objc func ${action}\\(`),`${action} must have an Objective-C action`);
    assert.match(main,new RegExp(`#selector\\(${action}(?:\\(|\\))`),`${action} must be connected to a control`);
  }
  assert.match(main,/let scroll=NSScrollView[\s\S]*scroll\.hasVerticalScroller=true/);
  assert.match(main,/func layoutDiagnosticsDocument\(\)[\s\S]*section\.fittingSize\.height[\s\S]*document\.setFrameSize/);
  assert.match(main,/scroll\.verticalScroller\?\.doubleValue=0/);
  const leaseAcquire=main.slice(main.indexOf('func acquireBackgroundRenderSurface'),main.indexOf('func evaluateRenderReadiness'));
  assert.match(leaseAcquire,/presentWindow\(session,intent:\.background,callSite:"scheduler_render_surface"\)/);
  assert.match(leaseAcquire,/NSApp\.isActive==original\.appActive[\s\S]*session\.isKeyWindow==original\.keyWindow[\s\S]*session\.isMainWindow==original\.mainWindow/);
  assert.doesNotMatch(leaseAcquire,/orderFront|makeKey|makeMain|\.order\(|NSApp\.activate/);
  const leaseCleanup=main.slice(main.indexOf('func restoreBackgroundRenderSurface'),main.indexOf('func renderLeaseFailureReason'));
  assert.doesNotMatch(leaseCleanup,/NSApp\.activate|activate\(ignoringOtherApps/);
  assert.match(main,/guard let lease=backgroundRenderLease,lease\.owner==owner,backgroundRenderLeaseGate\.owner==owner/);
});

test('native Rescue startup tracks its generation before bridge dispatch and reports exact stages',()=>{
  const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
  const begin=main.slice(main.indexOf('@objc func beginNativeRescue()'),main.indexOf('func showNativeRescueProgress()'));
  const start=main.slice(main.indexOf('func startNativeRescue()'),main.indexOf('func showNativeRescueProgress(operationID:String)'));
  const cleanup=main.slice(main.indexOf('func finishNativeRescueLocally'),main.indexOf('@objc func toggleRiskNotificationTitles'));
  assert.ok(begin.includes('recordNativeRescueStage("rescue_action_received")'));
  for(const stage of ['rescue_operation_created','rescue_generation_assigned','rescue_session_resolved','rescue_bridge_dispatch_started','rescue_bridge_dispatch_accepted','rescue_capture_started']) assert.ok(main.includes(stage),`missing startup stage ${stage}`);
  assert.ok(start.indexOf('nativeRescueOwnershipGate.begin()')<start.indexOf('rescue_generation_assigned'));
  assert.ok(start.indexOf('rescue_generation_assigned')<start.indexOf('evaluateJavaScript(script)'));
  assert.ok(start.includes('JSONEncoder().encode(operationID)'));
  assert.ok(start.includes('web.window === session') && start.includes('session.contentView === web'));
  assert.ok(start.includes('operation_id_not_string') && start.includes('operation_id_invalid_format'));
  assert.doesNotMatch(start,/web\.load\(|URLRequest/);
  assert.match(cleanup,/nativeRescueOwnershipGate\.owns\(owner\)/);
  assert.match(cleanup,/nativeRescueOwnershipGate\.finish\(owner\)/);
});

test('native Rescue final status interpolates the real summary and gates saved-success on export completion',()=>{
  const main=fs.readFileSync(path.join(__dirname,'Main.swift'),'utf8');
  const model=fs.readFileSync(path.join(__dirname,'CycleModel.swift'),'utf8');
  assert.match(model,/func nativeRescueSummary\(complete:Bool,messageCount:Int,reason:String,scrollRestored:Bool\)/);
  assert.match(model,/func nativeRescueSavedStatus\(summary:String,textSaved:Bool\)/);
  assert.ok(main.includes('nativeRescueOutput.stringValue="Native Rescue: \\(summary)"'));
  assert.equal(main.includes('Native Rescue: \\\\(summary)'),false,'literal Swift interpolation must never reach status');
  const exportBlock=main.slice(main.indexOf('func saveNativeRescueExports'),main.indexOf('func finishNativeRescueLocally'));
  assert.match(exportBlock,/finishNativeRescueLocally\(reason:"export_cancelled"/);
  assert.match(exportBlock,/Data\(html\.utf8\)\.write[\s\S]*nativeRescueSavedStatus\(summary:summary,textSaved:textResponse == \.OK\)/);
  assert.doesNotMatch(exportBlock,/export_cancelled[\s\S]{0,100}saved locally/);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const hook=fs.readFileSync(path.join(__dirname,'list-hook.js'),'utf8');
const start=hook.indexOf('const safeRootFetchRejectionClass=');
const end=hook.indexOf('const emitRootTransportDiagnostic=',start);
assert.ok(start>=0&&end>start,'safe classifier exists');
const classifierSource=hook.slice(start,end)+'globalThis.classify=safeRootFetchRejectionClass;';
const context={};vm.runInNewContext(classifierSource,context);

test('root fetch rejection classes use only the allowlisted error name',()=>{
 for(const [error,expected] of [
  [{name:'AbortError',message:'private detail',stack:'private stack'},'AbortError'],
  [{name:'TypeError',message:'private detail'},'TypeError'],
  [{name:'NetworkError'},'NetworkError'],
  [{name:'Error',message:'private detail'},'other_known_error'],
  [{name:'SomeVendorError'},'unknown_error'],
  [{message:'private detail'},'unknown_error'],
  [null,'unknown_error']
 ]) assert.equal(context.classify(error),expected);
});

test('diagnostic emission excludes raw error text, stack, and navigation-based causal guesses',()=>{
 const emitterStart=hook.indexOf('const emitRootTransportDiagnostic=');
 const emitterEnd=hook.indexOf('const finishRootDiscoveryFailure=',emitterStart);
 const emitter=hook.slice(emitterStart,emitterEnd);
 assert.match(emitter,/rejectionClass:\['error','cancellation'\]/);
 assert.match(emitter,/\['AbortError','TypeError','NetworkError','other_known_error','unknown_error'\]/);
 assert.doesNotMatch(emitter,/error\.(?:message|stack)|navigation_abort/);
 assert.match(hook,/const finishRootDiscoveryFailure=\(entry,error\)=>\{const rejectionClass=safeRootFetchRejectionClass\(error\)/);
 assert.doesNotMatch(hook,/error\.(?:message|stack)/);
});

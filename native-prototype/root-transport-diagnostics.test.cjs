const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=__dirname;
const main=fs.readFileSync(path.join(root,'Main.swift'),'utf8');
const engine=fs.readFileSync(path.join(root,'CycleEngine.swift'),'utf8');
const hook=fs.readFileSync(path.join(root,'list-hook.js'),'utf8');

test('root transport events are cycle- and document-correlated with bounded safe persistence',()=>{
 assert.match(hook,/emitRootTransportDiagnostic\(entry,'request'\)/);
 assert.match(hook,/emitRootTransportDiagnostic\(entry,'response',status\)/);
 assert.match(hook,/event:'root_transport_diagnostic',cycleSequence:Number\.isSafeInteger\(config\.cycleSequence\)/);
 assert.match(hook,/entry\.pathname!=='\/backend-api\/conversations'/);
 assert.match(hook,/event==='abort'\?'cancellation':event==='timeout'\?'timeout':'error'/);
 assert.match(hook,/rejectionClass==='AbortError'\?'cancellation':'error'/);
 assert.match(hook,/const safeRootFetchRejectionClass=error=>/);
 assert.match(hook,/rejectionClass:\['error','cancellation'\]/);
 assert.doesNotMatch(hook,/error\.(?:message|stack)/);
 assert.match(main,/if event=="root_transport_diagnostic" \{recordRootTransportDiagnostic\(data\);return\}/);
 assert.match(engine,/data\["cycleSequence"\] as\? NSNumber\)\?\.uint64Value==cycleSequence/);
 assert.match(engine,/appendRootTransportEvent\(cycleRootTransportEvents/);
 assert.match(engine,/finalizeRootTransportEvents\(cycleRootTransportEvents\)/);
 assert.match(main,/no_terminal_event_by_cycle_end/);
 assert.match(main,/var transportEvents:\[RootTransportEventSnapshot\]\? = nil/);
 assert.match(main,/var transportHooks:\[RootTransportHookSnapshot\]\? = nil/);
 assert.match(main,/matchingResponseObserved:Bool/);
 assert.match(main,/observationSource:String/);
 assert.match(main,/var transportEventsTruncated:Bool\? = nil/);
 assert.match(main,/var transportCaptureBoundary:String\? = nil/);
 assert.match(engine,/cycleRootTransportOmittedSequences/);
 for(const field of ['rejectionClass:String?','navigationStartedBeforeError:Bool?','navigationFinishedBeforeError:Bool?','currentDocumentGeneration:String?','generationChangedSinceRequest:Bool?']) assert.ok(main.includes(field),`missing ${field}`);
 assert.match(engine,/rootTransportErrorNavigationState\(requestGeneration:generationKey,currentGeneration:currentGeneration,errorElapsedMs:elapsed/);
 for(const forbidden of ['conversationId','conversationID','title','contents','cookies','authorization','rawURL'])
  assert.ok(!hook.includes(`:${forbidden}`),`list hook must not persist ${forbidden}`);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'page-hook.js'), 'utf8');
function fixture(fetchImpl) {
  const messages = [];
  const location = { href: 'https://chatgpt.com/c/chat-secret', origin: 'https://chatgpt.com', pathname: '/c/chat-secret' };
  const window = {
    location,
    performance: { now: () => 100 },
    fetch: fetchImpl,
    postMessage: (data) => messages.push(data),
    addEventListener: () => {},
  };
  class FakeRequest { constructor(url) { this.url = url; } }
  class FakeXHR { open() {} send() {} addEventListener() {} }
  const context = vm.createContext({ window, location, URL, Request: FakeRequest, XMLHttpRequest: FakeXHR, setTimeout, clearTimeout, console, Date, Math, JSON, Object, Array, Number, String, Boolean, Set, Map, RegExp, Promise });
  vm.runInContext(source, context);
  return { window, messages };
}
function payload(id, time = 100) {
  return { conversation_id: 'chat-secret', title: 'private title', page_info: { has_previous_page: true, next_cursor: 'response-cursor-secret' }, messages: [{ id, author: { role: 'user' }, content: { content_type: 'text', parts: ['private body'] }, create_time: time }] };
}
function response(body, url) {
  return { ok: true, status: 200, url, headers: { get: () => 'application/json' }, clone: () => ({ json: async () => body }) };
}
async function drain() { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); }
const sourceEvent = f => f.messages.find(item => item.source === 'gpt-limits-tool-continuation-source-v1')?.continuationSource;

test('continuation source capture is disabled by default and requires exact ID and generation', async()=>{
 const f=fixture(url=>Promise.resolve(response(payload('ordinary'),url)));
 f.window.gptLiveResumeCaptureGeneration='generation-1';
 await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages');await drain();
 assert.equal(sourceEvent(f),undefined);
 f.window.gptContinuationSourceConfig={captureContinuationSource:true,conversationID:'other-chat',generation:'generation-1'};
 await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages');await drain();assert.equal(sourceEvent(f),undefined);
 f.window.gptContinuationSourceConfig={captureContinuationSource:true,conversationID:'chat-secret',generation:'stale'};
 await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages');await drain();assert.equal(sourceEvent(f),undefined);
 f.window.gptContinuationSourceConfig={captureContinuationSource:true,conversationID:'chat-secret',generation:'generation-1'};
 await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages');await drain();
 assert.equal(sourceEvent(f).conversationID,'chat-secret');assert.equal(sourceEvent(f).generation,'generation-1');
});

test('continuation source includes normal user and assistant text only, excluding internal and attachment content', async()=>{
 const f=fixture(url=>Promise.resolve(response({conversation_id:'chat-secret',messages:[
  {id:'u',author:{role:'user'},content:{content_type:'text',parts:['hello user']}},
  {id:'a',author:{role:'assistant'},content:{content_type:'text',parts:['hello assistant']}},
  {id:'s',author:{role:'system'},content:{parts:['system secret']}},
  {id:'d',author:{role:'developer'},content:{parts:['developer secret']}},
  {id:'t',author:{role:'tool'},content:{parts:['tool secret']}},
  {id:'i',author:{role:'assistant'},metadata:{channel:'analysis'},content:{parts:['internal secret']}},
  {id:'x',author:{role:'user'},content:{parts:[{content_type:'image',text:'attachment secret'}]}}
 ]},url)));
 f.window.gptLiveResumeCaptureGeneration='g';f.window.gptContinuationSourceConfig={captureContinuationSource:true,conversationID:'chat-secret',generation:'g'};
 await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages');await drain();
 const source=sourceEvent(f);assert.deepEqual(Array.from(source.messages,x=>x.role),['user','assistant']);
 assert.match(JSON.stringify(source),/hello user/);assert.match(JSON.stringify(source),/hello assistant/);
 for(const secret of ['system secret','developer secret','tool secret','internal secret','attachment secret'])assert.equal(JSON.stringify(source).includes(secret),false);
});

test('continuation source deduplicates and selects bounded chronological early and recent excerpts',async()=>{
 const messages=Array.from({length:165},(_,i)=>({id:`m${i}`,author:{role:i%2?'assistant':'user'},content:{content_type:'text',parts:[`message ${i} `+'x'.repeat(180)]},create_time:i+1}));
 messages.push({...messages[10]});
 const f=fixture(url=>Promise.resolve(response({conversation_id:'chat-secret',messages},url)));
 f.window.gptLiveResumeCaptureGeneration='g';f.window.gptContinuationSourceConfig={captureContinuationSource:true,conversationID:'chat-secret',generation:'g'};
 await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages');await drain();
 const source=sourceEvent(f);assert.ok(source);assert.equal(source.truncated,true);assert.ok(source.messages.length<=160);assert.ok(source.estimatedTextTokens<=4000);
 assert.equal(new Set(source.messages.map(x=>x.id)).size,source.messages.length);
 assert.ok(source.earlyMessageCount>0&&source.recentMessageCount>0);
 assert.deepEqual(source.messages.map(x=>x.id),source.messages.map(x=>x.id).slice().sort((a,b)=>Number(a.slice(1))-Number(b.slice(1))));
 assert.equal(source.messages[0].id,'m0');assert.equal(source.messages.at(-1).id,'m164');
});

test('first-pass cursor chain is bounded and continuation comparisons use sanitized fingerprints', async () => {
  const f = fixture(url => Promise.resolve(response(payload('message-secret'), url)));
  f.window.gptLiveResumeFirstPassGeneration = 'first-generation';
  f.window.gptLiveResumeCaptureGeneration = 'first-generation';
  await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages?cursor=cursor-secret');
  await drain();
  const firstPipeline = f.messages.find(item => item.responsePipeline)?.responsePipeline;
  assert.equal(firstPipeline.requestOrigin, 'first_pass');
  assert.equal(firstPipeline.requestOrdinal, 1);
  assert.equal(firstPipeline.requestObserved, true);
  assert.equal(firstPipeline.captureSource, 'fetch');
  assert.equal(firstPipeline.responseObserved, true);
  const capturedSummary = f.messages.find(item => item.summary)?.summary;
  assert.equal(capturedSummary.sourceLineage.endpointClass, 'conversation_messages');
  assert.equal(capturedSummary.sourceLineage.requestOrigin, 'first_pass');
  assert.equal(capturedSummary.sourceLineage.requestOrdinal, 1);
  assert.equal(capturedSummary.sourceLineage.generationMatchesFirstPass, true);
  assert.ok(!JSON.stringify(capturedSummary.sourceLineage).includes('cursor-secret'));
  assert.ok(!JSON.stringify(capturedSummary.sourceLineage).includes('first-generation'));
  assert.match(firstPipeline.requestCursorFingerprint, /^[a-f0-9]{8}$/);
  assert.match(firstPipeline.responsePageFingerprint, /^1:[a-f0-9]{8}$/);
  assert.equal(f.window.gptRecordHistoryRequestAcceptance(1, true, true, 'first'), true);
  const boundary = f.window.gptCaptureHistoryRequestBoundary();
  assert.equal(boundary.requestCount, 1);
  assert.equal(boundary.responseCount, 1);
  assert.equal(boundary.requestInFlightCount, 0);
  assert.equal(boundary.responseInFlightCount, 0);
  assert.equal(boundary.pages[0].accepted, true);
  assert.equal(boundary.pages[0].temporalRelation, 'first');
  assert.equal(boundary.pages[0].hasPreviousPage, true);
  assert.equal(JSON.stringify([boundary, firstPipeline]).includes('cursor-secret'), false);
  assert.equal(JSON.stringify([boundary, firstPipeline]).includes('message-secret'), false);
  assert.equal(JSON.stringify([boundary, firstPipeline]).includes('private title'), false);
  assert.equal(JSON.stringify([boundary, firstPipeline]).includes('private body'), false);

  f.window.gptLiveResumeContinuationGeneration = 'continuation-generation';
  f.window.gptLiveResumeCaptureGeneration = 'continuation-generation';
  await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages?cursor=cursor-secret');
  await drain();
  const continuation = f.messages.filter(item => item.responsePipeline).at(-1).responsePipeline;
  assert.equal(continuation.requestOrigin, 'continuation');
  assert.equal(continuation.requestCursorSeenFirstPass, true);
  assert.equal(continuation.requestCursorFirstPassMatchOrdinal, 1);
  assert.equal(continuation.requestCursorMatchesLastFirstPass, true);
  assert.equal(continuation.exactFirstPassPageMatch, true);
  assert.equal(continuation.baselineIdentityOverlapCount, 1);
  assert.equal(continuation.allItemsAlreadyKnownBaseline, true);
  assert.equal(continuation.newIdentityCount, 0);
  assert.equal(JSON.stringify(continuation).includes('cursor-secret'), false);
  assert.equal(JSON.stringify(continuation).includes('message-secret'), false);
});

test('request origin stays first_pass when its response arrives after the handoff', async () => {
  let resolveFetch;
  const f = fixture(url => new Promise(resolve => { resolveFetch = () => resolve(response(payload('pending-message-secret'), url)); }));
  f.window.gptLiveResumeFirstPassGeneration = 'first-generation';
  f.window.gptLiveResumeCaptureGeneration = 'first-generation';
  const request = f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages?cursor=pending-cursor-secret');
  const boundary = f.window.gptCaptureHistoryRequestBoundary();
  assert.equal(boundary.requestInFlightCount, 1);
  assert.equal(boundary.responseInFlightCount, 0);
  assert.equal(boundary.pendingRequestOrdinal, 1);
  f.window.gptLiveResumeContinuationGeneration = 'continuation-generation';
  f.window.gptLiveResumeCaptureGeneration = 'continuation-generation';
  resolveFetch();
  await request;
  await drain();
  const pipeline = f.messages.find(item => item.responsePipeline)?.responsePipeline;
  assert.equal(pipeline.requestOrigin, 'first_pass');
  assert.equal(pipeline.requestOrdinal, 1);
  assert.equal(JSON.stringify(pipeline).includes('pending-cursor-secret'), false);
  assert.equal(JSON.stringify(pipeline).includes('pending-message-secret'), false);
});

test('conversation detail captures expose endpoint class without inventing a tracked history request', async () => {
  const f = fixture(url => Promise.resolve(response(payload('detail-message-secret'), url)));
  const path = 'https://chatgpt.com/backend-api/conversation/chat-secret';
  await f.window.fetch(path);
  await drain();
  const pipeline = f.messages.find(item => item.responsePipeline)?.responsePipeline;
  assert.equal(pipeline.requestClass, 'conversation_detail');
  assert.equal(pipeline.requestObserved, false);
  assert.equal(pipeline.requestOrigin, 'unknown');
  assert.equal(pipeline.responseObserved, true);
  assert.equal(pipeline.captureSource, 'fetch');
  assert.ok(!JSON.stringify(pipeline).includes('detail-message-secret'));
});

test('continuation identity telemetry uses the complete first-pass aggregate, including identities outside saved page entries', async () => {
  const f = fixture(url => Promise.resolve(response(payload('page-only-message'), url)));
  f.window.gptLiveResumeFirstPassGeneration = 'first-generation';
  f.window.gptLiveResumeCaptureGeneration = 'first-generation';
  await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages?cursor=private-cursor');
  await drain();
  const pipeline = f.messages.find(item => item.responsePipeline).responsePipeline;
  f.window.gptRecordHistoryRequestAcceptance(pipeline.requestOrdinal, true, true, 'first');
  const boundary = f.window.gptCaptureHistoryRequestBoundary(['page-only-message', 'aggregate-only-message', 'another-aggregate-message']);
  assert.equal(boundary.aggregateBaselineSource, 'first_pass_aggregate');
  assert.equal(boundary.aggregateBaselineIdentityCount, 3);
  assert.equal(boundary.savedPageEntryCount, 1);
  f.window.gptLiveResumeContinuationGeneration = 'continuation-generation';
  f.window.gptLiveResumeCaptureGeneration = 'continuation-generation';
  await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages?cursor=continuation-cursor');
  await drain();
  const continuation = f.messages.filter(item => item.responsePipeline).at(-1).responsePipeline;
  assert.equal(continuation.baselineIdentitySetCount, 3);
  assert.equal(continuation.baselineIdentityOverlapCount, 1);
  assert.equal(continuation.allItemsAlreadyKnownBaseline, true);
  assert.equal(continuation.newIdentityCount, 0);
  const serialized = JSON.stringify([boundary, continuation]);
  for (const secret of ['aggregate-only-message', 'another-aggregate-message', 'page-only-message', 'private-cursor']) assert.equal(serialized.includes(secret), false);
});

test('truncated full aggregate identity telemetry is explicitly not comparable', async () => {
  const f = fixture(url => Promise.resolve(response(payload('late-baseline-message'), url)));
  const aggregate = Array.from({length: 50001}, (_, index) => `baseline-private-${index}`);
  aggregate.push('late-baseline-message');
  const boundary = f.window.gptCaptureHistoryRequestBoundary(aggregate);
  assert.equal(boundary.aggregateBaselineIdentitySetTruncated, true);
  assert.equal(boundary.aggregateBaselineIdentityCount, 50000);
  f.window.gptLiveResumeContinuationGeneration = 'continuation-generation';
  f.window.gptLiveResumeCaptureGeneration = 'continuation-generation';
  await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages?cursor=continuation-cursor');
  await drain();
  const continuation = f.messages.filter(item => item.responsePipeline).at(-1).responsePipeline;
  assert.equal(continuation.baselineIdentityOverlapCount, null);
  assert.equal(continuation.allItemsAlreadyKnownBaseline, null);
  assert.equal(JSON.stringify([boundary, continuation]).includes('late-baseline-message'), false);
});

test('history response parsing telemetry records accepted legacy shape with sanitized schema only', async () => {
  const f = fixture(url => Promise.resolve(response(payload('message-private'), url)));
  f.window.gptLiveResumeFirstPassGeneration = 'generation-private';
  f.window.gptLiveResumeCaptureGeneration = 'generation-private';
  await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages?cursor=private-query');
  await drain();
  const diagnostic = f.messages.find(item => item.responsePipeline)?.responsePipeline.responseParseDiagnostic;
  assert.equal(diagnostic.endpointTemplate, '/backend-api/conversations/:id/messages');
  assert.equal(diagnostic.transport, 'fetch');
  assert.equal(diagnostic.status, 200);
  assert.equal(diagnostic.contentTypeCategory, 'json');
  assert.equal(diagnostic.topLevelType, 'object');
  assert.deepEqual(Array.from(diagnostic.topLevelKeyNames), ['conversation_id', 'title', 'page_info', 'messages']);
  assert.equal(diagnostic.expectedStructure.messagesArray, true);
  assert.equal(diagnostic.parserAttempted, true);
  assert.equal(diagnostic.parserAccepted, true);
  assert.equal(diagnostic.rejectionReason, 'accepted');
  assert.equal(diagnostic.extractedPageCount, 1);
  assert.equal(diagnostic.extractedMessageCount, 1);
  const serialized = JSON.stringify(diagnostic);
  for (const secret of ['chat-secret', 'message-private', 'private-query', 'private title', 'private body', 'https://', 'generation-private']) assert.equal(serialized.includes(secret), false);
});

test('history response diagnostics distinguish changed shape and an unrecognized endpoint safely', async () => {
  const f = fixture(url => Promise.resolve(response({ conversation_id: 'chat-secret', mapping: { private: true } }, url)));
  f.window.gptLiveResumeFirstPassGeneration = 'generation';
  f.window.gptLiveResumeCaptureGeneration = 'generation';
  await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages');
  await drain();
  const changed = f.messages.find(item => item.responsePipeline)?.responsePipeline.responseParseDiagnostic;
  assert.equal(changed.parserAttempted, true);
  assert.equal(changed.parserAccepted, false);
  assert.equal(changed.rejectionReason, 'conversation_mapping_missing');
  const unknown = f.window.gptSanitizeHistoryResponseDiagnostic('https://chatgpt.com/backend-api/private-route/private-id?token=secret', 'XHR', 200, 'application/json', { private: ['value'] }, { parserAttempted: true });
  assert.equal(unknown.endpointTemplate, '/backend-api/:other');
  assert.equal(unknown.rejectionReason, 'endpoint_not_recognized');
  const encoded = JSON.stringify([changed, unknown]);
  for (const secret of ['chat-secret', 'private-id', 'token=secret', 'value', 'https://']) assert.equal(encoded.includes(secret), false);
});

test('history-like endpoint outside the current parser contract is observed without invoking the parser', async () => {
  const f = fixture(url => Promise.resolve(response({ conversations: [{ title: 'private title', id: 'private-id' }] }, url)));
  await f.window.fetch('https://chatgpt.com/backend-api/conversation-history/private-id?cursor=secret');
  await drain();
  const diagnostic = f.messages.find(item => item.responsePipeline)?.responsePipeline.responseParseDiagnostic;
  assert.equal(diagnostic.endpointTemplate, '/backend-api/:other');
  assert.equal(diagnostic.status, 200);
  assert.equal(diagnostic.topLevelType, 'object');
  assert.deepEqual(Array.from(diagnostic.topLevelKeyNames), ['conversations']);
  assert.equal(diagnostic.topLevelArrayCounts[0].count, 1);
  assert.equal(diagnostic.parserAttempted, false);
  assert.equal(diagnostic.parserAccepted, false);
  assert.equal(diagnostic.rejectionReason, 'endpoint_not_recognized');
  const serialized = JSON.stringify(diagnostic);
  for (const secret of ['private-id', 'private title', 'cursor=secret', 'https://']) assert.equal(serialized.includes(secret), false);
});

test('history response parser exceptions are sanitized', async () => {
  const f = fixture(url => Promise.resolve({ ok: true, status: 200, url, headers: { get: () => 'application/json' }, clone: () => ({ json: async () => { throw new Error('PRIVATE BODY AND URL'); } }) }));
  f.window.gptLiveResumeFirstPassGeneration = 'generation';
  f.window.gptLiveResumeCaptureGeneration = 'generation';
  await f.window.fetch('https://chatgpt.com/backend-api/conversations/chat-secret/messages?token=private');
  await drain();
  const diagnostic = f.messages.find(item => item.responsePipeline)?.responsePipeline.responseParseDiagnostic;
  assert.equal(diagnostic.parserAttempted, true);
  assert.equal(diagnostic.parserAccepted, false);
  assert.equal(diagnostic.rejectionReason, 'parser_exception');
  assert.equal(diagnostic.topLevelType, 'null');
  assert.equal(JSON.stringify(diagnostic).includes('PRIVATE'), false);
});

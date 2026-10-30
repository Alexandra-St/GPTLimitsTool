const {test}=require('node:test');const assert=require('node:assert/strict');
const {sanitizeList}=require('./conversation-list');const {recentConversations}=require('./recent');
const now=Date.parse('2026-10-23T17:00:00Z');
const fixture=(id,time,title=id)=>({id,title,update_time:time,snippet:'PRIVATE TEXT',mapping:{secret:'PRIVATE MESSAGE'},asset_pointer:'PRIVATE ASSET'});
const recent=items=>recentConversations(sanitizeList({items,total:items.length,limit:20,offset:0}).map(r=>({id:r.conversationId,title:r.title,updatedAt:r.updatedAt})),now);
test('observed items/id/title/update_time schema produces only safe metadata',()=>{
 const rows=sanitizeList({items:[fixture('chat-id','2026-10-23T16:00:00Z')],total:1,limit:20,offset:0});
 assert.deepEqual(rows,[{conversationId:'chat-id',title:'chat-id',updatedAt:now-3600000}]);assert.ok(!JSON.stringify(rows).includes('PRIVATE'));assert.equal(sanitizeList({status:'ok'}),null);
});
test('six-hour boundary, invalid timestamps, dedup and latest-first work on list fixture',()=>{
 const rows=recent([fixture('boundary','2026-10-23T11:00:00Z'),fixture('old','2026-10-23T10:59:59Z'),fixture('dup','2026-10-23T12:00:00Z'),fixture('dup','2026-10-23T16:59:00Z','new title'),fixture('invalid',null),fixture('numeric',123),fixture('future','2026-10-23T18:00:00Z')]);
 assert.deepEqual(rows.map(x=>x.id),['dup','boundary']);assert.equal(rows[0].title,'new title');assert.equal(rows[0].updatedAt,now-60000);assert.ok(!JSON.stringify(rows).includes('monitored'));
});
test('passive fetch pipeline does not forward conversation rows without an active cycle',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');const sent=[];let calls=0;
 function XHR(){}XHR.prototype.open=function(){};XHR.prototype.send=function(){};
 const payload={items:[fixture('test-id','2026-10-23T16:00:00Z')],total:1,limit:20,offset:0};
 const response={clone:()=>({json:async()=>payload})};
 const window={fetch:async()=>{calls++;return response;},webkit:{messageHandlers:{list:{postMessage:x=>sent.push(x)}}}};
 const ctx=vm.createContext({window,XMLHttpRequest:XHR,location:{href:'https://chatgpt.com/',origin:'https://chatgpt.com'},URL});
 for(const file of ['conversation-list.js','list-hook.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),ctx);
 assert.equal(await window.fetch('/backend-api/conversations?private=query'),response);await new Promise(setImmediate);
 assert.equal(calls,1);assert.equal(sent.length,0);
});

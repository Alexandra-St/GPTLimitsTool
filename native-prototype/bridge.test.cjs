const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
test('bridge aggregates pages and sends only allowlisted totals to native',()=>{
 const sent=[], listeners={};
 const window={addEventListener:(n,f)=>listeners[n]=f,webkit:{messageHandlers:{summary:{postMessage:x=>sent.push(x)}}}};
 const context=vm.createContext({window,location:{origin:'https://chatgpt.com',pathname:'/c/example'},sessionStorage:{getItem:()=>null},setInterval:()=>{throw Error('unexpected collection')},clearInterval:()=>{}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/aggregator.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'bridge.js'),'utf8'),context);
 const receive=(summary, diagnostic)=>listeners.message({source:window,origin:'https://chatgpt.com',data:{source:'gpt-limits-tool-capture-v1',summary,diagnostic}});
 const item={id:'private-message-id',role:'user',textTokens:5,attachments:{images:2},content:'secret',asset_pointer:'secret-pointer'};
 receive({conversationId:'other',items:[item]}); assert.equal(sent.length,0);
 receive({conversationId:'example',title:'Example',items:[item],hasPreviousPage:true},{candidatePath:'/backend-api/conversations/example?token=private',captureSource:'fetch'});
 receive({conversationId:'example',items:[item],hasPreviousPage:false,isPaginationResponse:true});
 assert.equal(sent.at(-1).messages,1);assert.equal(sent.at(-1).images,2);assert.equal(sent.at(-1).tokens,5);assert.equal(sent.at(-1).history,'Complete');assert.equal(sent.at(-1).endpoint,'/backend-api/conversations/<id>');
 const text=JSON.stringify(sent); for(const forbidden of ['private-message-id','secret','asset_pointer','conversationId','processedMessageIds','private','example?token']) assert.ok(!text.includes(forbidden));
});

test('accepted terminal detail response proves complete history without a small-chat heuristic',()=>{
 const context=vm.createContext({});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/aggregator.js'),'utf8'),context);
 const item=(id)=>({id,role:'user',textTokens:5,attachments:{images:0}});
 const state=context.GptLimitsAggregator.mergePage(null,{conversationId:'example',items:[item('u'),item('a')],hasPreviousPage:false,isPaginationResponse:false});
 assert.equal(state.messagesCollected,2);
 assert.equal(state.hasPreviousPage,false);
 assert.equal(state.historyComplete,true);
 const unknown=context.GptLimitsAggregator.mergePage(null,{conversationId:'another',items:[item('only')],isPaginationResponse:false});
 assert.equal(unknown.historyComplete,false,'message count alone is never completion proof');
 assert.equal(unknown.hasPreviousPage,null);
});

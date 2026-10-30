const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recentConversations}=require('./recent.js');
const now=Date.UTC(2026,9,23,12);
const chat=(id,age)=>({id,title:id,updatedAt:now-age*3600000});
test('six-hour window includes boundary and sorts recent first without Monitor',()=>{
 assert.deepEqual(recentConversations([chat('boundary',6),chat('latest',0),chat('old',6.01)],now).map(x=>x.id),['latest','boundary']);
});
test('missing, invalid and future timestamps excluded safely',()=>{
 assert.deepEqual(recentConversations([{},null,{id:'a',title:'a'},chat('future',-1),{id:'b',title:'b',updatedAt:'2026-10-23'},chat('nan',NaN)],now),[]);
});
test('metadata deduplication and whitelist exclude extraneous content',()=>{
 const result=recentConversations([{...chat('a',1),content:'secret'},chat('a',2)],now);
 assert.equal(result.length,1); assert.deepEqual(Object.keys(result[0]),['id','title','updatedAt']);
});

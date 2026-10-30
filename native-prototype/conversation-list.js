(() => {
 'use strict';
 function sanitizeList(payload) {
  if(!payload || !Array.isArray(payload.items))return null;
  return payload.items.flatMap(item=>{
   if(!item || typeof item.id!=='string'||!item.id||typeof item.title!=='string')return [];
   // Only confirmed ISO timestamps; numeric units are deliberately not guessed.
   const value=item.update_time;
   const updatedAt=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(value)?Date.parse(value):NaN;
   return Number.isFinite(updatedAt)?[{conversationId:item.id,title:item.title,updatedAt}]:[];
  });
 }
 globalThis.GptConversationList={sanitizeList};
 if(typeof module!=='undefined')module.exports=globalThis.GptConversationList;
})();

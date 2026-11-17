import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';
const source=readFileSync(new URL('../../trial-ui/app.js',import.meta.url),'utf8');
const save=source.slice(source.indexOf('let quoteCarePrompt;'),source.indexOf("qf.addEventListener('submit'",source.indexOf('let quoteCarePrompt;')));
function harness(){
 const elements:Record<string,any>={},requests:any[]=[],offers:any[]=[],toasts:string[]=[];
 const el=(key:string)=>elements[key]||=( {textContent:'',hidden:key==='#conflict-banner',disabled:false,scrollIntoView(){}} );
 const data={quoteNo:'BG-TEST',customerId:'c1',customer:'Khách kiểm thử',rows:[{name:'Ly',price:100,qty:1}]};
 const ctx:any={$:el,$$:()=>[],editorLoadSequence:1,location:{hash:'#/quotes/q1'},editor:{id:'q1',revision:1,base:data,approval:{status:'draft'},dirty:true},
  isManager:()=>true,can:()=>true,collectQuote:()=>data,validateQuote:()=>'',qf:{querySelector:()=>null},
  api:async(p:string,m:string,b:any)=>{requests.push({p,m,b});return{id:'q1',revision:2,data,approvalStatus:'draft'};},
  fillEditor:(id:string,rev:number,doc:any)=>Object.assign(ctx.editor,{id,revision:rev,base:doc,dirty:false}),
  setMobileQuoteStep(){},quoteDeviceDraft:{saved(){}},loadQuotes(){},loadCustomers(){},loadBadges:async()=>{},toast:(m:string)=>toasts.push(m),updateQuoteActions(){},
  initQuoteCarePrompt:()=>({offer:async(saved:any,options:any)=>{offers.push(saved);assert.equal(options.isCurrent(),true);return false;}}),
 };
 runInNewContext(save+'\nglobalThis.saveForTest=saveQuote;',ctx);return{ctx,requests,offers,toasts,el};
}
test('Manual save offers follow-up only after a successful persisted quote; skipping does not undo the save',async()=>{
 const h=harness();assert.equal(await h.ctx.saveForTest({promptCare:true}),true);assert.equal(h.requests.length,1);assert.equal(h.requests[0].p,'/quotes/q1');assert.deepEqual({...h.offers[0]},{id:'q1',revision:2});assert.equal(h.ctx.editor.dirty,false);
});
test('Internal saves and missing care permission do not interrupt the calling workflow',async()=>{
 for(const mode of ['internal','no-permission']){const h=harness();if(mode==='no-permission')h.ctx.can=()=>false;assert.equal(await h.ctx.saveForTest(mode==='internal'?{}:{promptCare:true}),true);assert.equal(h.offers.length,0);}
});
test('Reminder failure never reports a saved quote as failed or opens quote-conflict banner',async()=>{
 const h=harness();h.ctx.initQuoteCarePrompt=()=>({offer:async()=>{throw Object.assign(Error('Care unavailable'),{status:409});}});
 assert.equal(await h.ctx.saveForTest({promptCare:true}),true);assert.equal(h.ctx.editor.revision,2);assert.equal(h.ctx.editor.dirty,false);assert.equal(h.el('#conflict-banner').hidden,true);assert.ok(h.toasts.some(t=>t.includes('Báo giá đã lưu. Chưa mở được lịch')));
});
test('Failed validation/save or response belonging to an abandoned editor never opens a care popup',async()=>{
 for(const mode of ['validation','save','navigation']){const h=harness();if(mode==='validation')h.ctx.validateQuote=()=> 'Thiếu thông tin';if(mode==='save')h.ctx.api=async()=>{throw Error('Save failed');};if(mode==='navigation')h.ctx.api=async()=>{h.ctx.location.hash='#/customers';return{id:'q1',revision:2,data:{quoteNo:'BG-TEST'}};};await h.ctx.saveForTest({promptCare:true});assert.equal(h.offers.length,0,mode);}
});

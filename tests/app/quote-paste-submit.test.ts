import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const {parseSkuQuantities,pasteRows}:any=await import(new URL('../../trial-ui/quote-paste.js',import.meta.url).href);
const source=readFileSync(new URL('../../trial-ui/app.js',import.meta.url),'utf8');
const paste=source.slice(source.indexOf('// ----- dán từ Excel:'),source.indexOf('// ----- lưu'));
const add=source.slice(source.indexOf('function addRowsToQuote('),source.indexOf("$('#pick-products').addEventListener"));
function harness(){
 const elements:Record<string,any>={};
 for(const id of ['paste-lines','paste-text','paste-preview','paste-dialog','paste-form','paste-apply'])elements['#'+id]={value:'',textContent:'',disabled:false,open:true,events:{} as Record<string,Function>,addEventListener(name:string,fn:Function){this.events[name]=fn;},showModal(){this.open=true;},close(){this.open=false;}};
 const requests:string[]=[],toasts:string[]=[];let dirty=0;
 const ctx:any={parseSkuQuantities,pasteRows,$:(id:string)=>elements[id],parseNum:(s:string)=>Number(s),
  editor:{id:'q1',customerId:'c1',defaultDiscount:15,discountMode:'percent',rows:[]},preferredPolicy:'retail',editorLoadSequence:1,catalog:{items:[]},state:{policies:[{id:'retail',name:'Retail'}]},
  loadBrandDiscounts:async(options:any)=>{assert.equal(options.strict,true);},
  rowFromProduct:(p:any)=>({sku:p.sku,name:p.name,qty:1,price:100,discount:15}),blankRow:()=>({name:'',price:0,discount:15}),
  api:async(path:string)=>{requests.push(path);return {products:[{sku:'00123',name:'Bộ trà'}]};},
  markDirty(){dirty++;},renderLines(){},toast:(message:string)=>toasts.push(message),
 };
 runInNewContext(add+paste,ctx);
 return{ctx,elements,requests,toasts,dirty:()=>dirty,submit:async(text:string)=>{elements['#paste-text'].value=text;await elements['#paste-form'].events.submit({preventDefault(){}});}};
}
test('missing SKUs are deduplicated into one lookup, cached rows remain first and quote rows are appended in paste order',async()=>{
 const h=harness();h.ctx.catalog.items=[{sku:'CACHE',name:'Đĩa'}];
 await h.submit('00123\t10\nCACHE\t2\n00123\t3');assert.equal(h.requests.length,1);assert.equal(new URL('https://test'+h.requests[0]).searchParams.get('skus'),'00123');
 assert.deepEqual(Array.from(h.ctx.editor.rows,(r:any)=>[r.sku,r.qty]),[['00123',10],['CACHE',2],['00123',3]]);assert.equal(h.dirty(),1);assert.equal(h.elements['#paste-dialog'].open,false);
});
test('double submit while lookup is pending adds the lines once',async()=>{
 const h=harness();let resolve:(v:any)=>void=()=>{};h.ctx.api=(path:string)=>{h.requests.push(path);return new Promise(r=>{resolve=r;});};
 const first=h.submit('00123\t10');await h.submit('00123\t10');assert.equal(h.requests.length,1);assert.equal(h.elements['#paste-apply'].disabled,true);
 resolve({products:[{sku:'00123',name:'Bộ trà'}]});await first;assert.equal(h.ctx.editor.rows.length,1);assert.equal(h.dirty(),1);assert.equal(h.elements['#paste-apply'].disabled,false);
});
test('closing and reopening permits a new paste and ignores both the old response and its finalizer',async()=>{
 const h=harness(),resolve:((value:any)=>void)[]=[];h.ctx.api=()=>new Promise(r=>resolve.push(r));
 const old=h.submit('OLD\t10');h.elements['#paste-dialog'].close();h.elements['#paste-dialog'].events.close();h.elements['#paste-lines'].events.click();
 assert.equal(h.elements['#paste-text'].value,'');assert.equal(h.elements['#paste-preview'].textContent,'');assert.equal(h.elements['#paste-apply'].disabled,false);
 const next=h.submit('NEW\t20');resolve[0]!({products:[{sku:'OLD',name:'Old'}]});await old;
 assert.equal(h.elements['#paste-apply'].disabled,true,'old finalizer cannot enable the new pending submit');assert.equal(h.ctx.editor.rows.length,0);
 resolve[1]!({products:[{sku:'NEW',name:'New'}]});await next;assert.deepEqual(Array.from(h.ctx.editor.rows,(r:any)=>[r.sku,r.qty]),[['NEW',20]]);
});
test('cancelled dialog and changed pricing context cannot apply an old response',async()=>{
 for(const change of ['close','policy','customer','quote']){
  const h=harness();let resolve:(v:any)=>void=()=>{};h.ctx.api=()=>new Promise(r=>{resolve=r;});const pending=h.submit('00123\t10');
  if(change==='close')h.elements['#paste-dialog'].open=false;
  if(change==='policy')h.ctx.preferredPolicy='vip';if(change==='customer')h.ctx.editor.customerId='c2';if(change==='quote')h.ctx.editorLoadSequence++;
  resolve({products:[{sku:'00123',name:'Bộ trà'}]});await pending;assert.equal(h.ctx.editor.rows.length,0,change);assert.equal(h.dirty(),0,change);
 }
});
test('failed lookup or discount fetch preserves the quote and keeps the pasted text for retry',async()=>{
 for(const fail of ['lookup','discount']){
  const h=harness();if(fail==='lookup')h.ctx.api=async()=>{throw Error('Read failed');};else h.ctx.loadBrandDiscounts=async()=>{throw Error('Discount failed');};
  await h.submit('00123\t10');assert.equal(h.ctx.editor.rows.length,0);assert.equal(h.elements['#paste-dialog'].open,true);assert.equal(h.elements['#paste-text'].value,'00123\t10');assert.match(h.elements['#paste-preview'].textContent,/failed/);
 }
});
test('cached products need no product lookup; line limit never partially appends',async()=>{
 const h=harness();h.ctx.catalog.items=[{sku:'00123',name:'Bộ trà'}];h.ctx.editor.rows=Array.from({length:300},()=>({name:'Existing',price:100}));await h.submit('00123\t10');
 assert.equal(h.requests.length,0);assert.equal(h.ctx.editor.rows.length,300);assert.equal(h.dirty(),0);assert.equal(h.elements['#paste-dialog'].open,true);assert.match(h.elements['#paste-preview'].textContent,/300/);
});

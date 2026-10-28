import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

class Node {
 children:Node[]=[];events:Record<string,Function>={};attrs:Record<string,string>={};dataset:Record<string,string>={};
 textContent='';value='';type='';disabled=false;isConnected=true;parent:Node|null=null;
 constructor(public tag:string,public className='',text=''){this.textContent=text;}
 append(...nodes:Node[]){for(const n of nodes){n.parent=this;this.children.push(n);}}
 setAttribute(k:string,v:string){this.attrs[k]=v;}
 addEventListener(k:string,fn:Function){this.events[k]=fn;}
 focus(){}
 remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 querySelector(selector:string):Node|null {
  if(missingSelector&&selector.startsWith('[data-receipt-'))return null;
  return all(this).slice(1).find(n=>selector.startsWith('.')?n.className===selector.slice(1):
   selector.startsWith('[')?selector.slice(1,-1) in n.attrs || selector.slice(6,-1).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()) in n.dataset:false)??null;
 }
}
let missingSelector=false;
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(api:Function){
 missingSelector=false;const messages:string[]=[];
 const source=readFileSync(new URL('../../trial-ui/purchases.js',import.meta.url),'utf8');
 const run=source.slice(source.indexOf('  async function run('),source.indexOf('  // ---------------------------------------------------------------- chi tiết'));
 const render=source.slice(source.indexOf('  function receiptCard('),source.indexOf('  function paymentRow('));
 const ctx:any={URL,encodeURIComponent,api,opts:{canReceive:true,isManager:true},current:null,
  el:(tag:string,cls='',text='')=>new Node(tag,cls,text),input:(type:string,value:string)=>Object.assign(new Node('input'),{type,value}),field:(_label:string,n:Node)=>n,
  btn:(text:string,cls:string,click:Function)=>{const n=new Node('button',cls,text);n.events.click=click;return n;},
  errorBox:()=>Object.assign(new Node('p','error'),{attrs:{role:'alert'}}),confirmBox:async()=>true,
  toast:(message:string)=>messages.push(message),load(){},renderDetail(){},dmy:String,num:String,SAPO_LABEL:{failed:['Lỗi','danger']}};
 runInNewContext(run+render+';globalThis.render=receiptCard;globalThis.runAction=run;',ctx);
 const card:Node=ctx.render({id:'c9a0ef98-c742-42de-b00c-629702dab458',shipmentId:'po',receiptNo:'PNH',receivedDate:'2026-10-24',sapoStatus:'failed',lines:[],job:{status:'failed'}});
 const click=async(action:string)=>{
  const button=all(card).find(n=>n.tag==='button'&&n.textContent===(action==='retry'?'Gửi lại yêu cầu n8n':'Đối soát phiếu Sapo đã có'))!;
  await button.events.click!({currentTarget:button});
  if(action==='reconcile'){
   const form=all(card).find(n=>n.tag==='form')!;
   all(form).find(n=>n.tag==='input')!.value='Xác minh phiếu đã có';
   form.events.submit!({preventDefault(){}});await settle();
  }
 };
 return{ctx,card,click,messages,error:()=>all(card).find(n=>n.className==='error')!.textContent};
}

for(const action of ['retry','reconcile']){
 test(`Nút ${action}: selector không thấy button vẫn hiện lỗi backend, không có JS exception`,async()=>{
  const paths:string[]=[],f=fixture(async(path:string)=>{paths.push(path);throw Error('HTTP 409: Phiếu đang được xử lý; cần đối soát.');});
  missingSelector=true;await f.click(action);
  assert.equal(paths.length,1);assert.ok(paths[0]!.endsWith(action==='retry'?'/retry-sapo':'/reconcile-sapo'));
  assert.match(f.error(),/HTTP 409: Phiếu đang được xử lý/);
 });
 test(`Nút ${action}: HTTP 200 nhưng n8n từ chối vẫn báo lỗi rõ`,async()=>{
  const f=fixture(async()=>({sent:false,skipped:false}));await f.click(action);assert.match(f.error(),/Chưa gửi được yêu cầu.*n8n/);
 });
}
test('Nút retry được giữ trước await; reconcile dùng đúng data-attribute trên nút submit',async()=>{
 const f=fixture(async()=>({sent:true}));
 assert.equal(all(f.card).find(n=>n.dataset.receiptRetry)?.dataset.receiptRetry,'c9a0ef98-c742-42de-b00c-629702dab458');
 await f.click('retry');await f.click('reconcile');
 assert.ok(all(f.card).some(n=>'data-receipt-reconcile' in n.attrs));assert.equal(f.error(),'');
});
test('run: không phục hồi nút đã rời DOM; lỗi vẫn hiện toast nếu thẻ phiếu bị thay thế',async()=>{
 const f=fixture(async()=>({})),button=new Node('button'),err=new Node('p');
 let writes=0,disabled=false;
 Object.defineProperty(button,'disabled',{get:()=>disabled,set:(v:boolean)=>{if(!button.isConnected)throw Error('Detached button touched');writes++;disabled=v;}});
 await f.ctx.runAction(button,err,async()=>{button.isConnected=false;err.isConnected=false;throw Error('Backend không phản hồi');});
 assert.equal(writes,1);assert.equal(err.textContent,'Backend không phản hồi');assert.deepEqual(f.messages,['Backend không phản hồi']);
});

test('undo preview names every SKU and quantity before any cancellation is sent',async()=>{
 const calls:any[]=[],f=fixture(async(...args:any[])=>{calls.push(args);return {}}),previews:string[]=[];
 f.ctx.confirmBox=async(message:string)=>{previews.push(message);return false;};
 const card:Node=f.ctx.render({id:'receipt-multi',shipmentId:'po',receiptNo:'PNH-MULTI',receivedDate:'2026-10-28',sapoStatus:'not_needed',createSapo:false,lines:[{sku:'SKU-A',goodQty:50,damagedQty:0},{sku:'SKU-B',goodQty:30,damagedQty:0}]});
 const button=all(card).find(n=>n.textContent==='Hoàn tác phiếu nhập…')!;assert.ok(button);await button.events.click!();assert.match(previews[0]!,/SKU-A: đạt 50/);assert.match(previews[0]!,/SKU-B: đạt 30/);assert.match(previews[0]!,/TOÀN BỘ/);assert.equal(calls.length,0);
});

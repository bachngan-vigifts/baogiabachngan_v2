import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
class Node {
 children:Node[]=[];events:Record<string,Function>={};text='';value:any='';className='';type='';disabled=false;hidden=false;dataset:Record<string,string>={};open=false;removed=false;classList={toggle(){}};max:any;
 showModal(){this.open=true;}close(){this.open=false;this.events.close?.();}remove(){this.removed=true;}
 constructor(public tag:string,cls='',text=''){this.className=cls;this.text=text;}
 append(...n:Node[]){this.children.push(...n);}setAttribute(k:string,v:any){(this as any)[k]=v;}addEventListener(k:string,f:Function){this.events[k]=f;}focus(){}replaceChildren(...n:Node[]){this.children=n;}
 set textContent(v:string){this.text=v;}get textContent():string{return this.text+this.children.map(c=>c.textContent).join('');}
}
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];
const flush=()=>new Promise<void>(r=>setImmediate(r));
async function fixture(early=true,createSapo=true){
 const root=new Node('div'),posts:any[]=[];
 const el=(tag:string,cls='',text='')=>new Node(tag,cls,text);
 const input=(type:string,value:any='',attrs:any={})=>Object.assign(el('input'),{type,value},attrs);
 const btn=(text:string,cls:string,fn:Function)=>{const b=el('button',cls,text);b.addEventListener('click',fn);return b;};
 const source=readFileSync(new URL('../../trial-ui/purchases.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('  function receiveForm('),source.indexOf('  function payForm('));
 const ctx:any={current:{id:'po',ticketNumber:'PO',lines:[{id:'a',sku:'ACCEPTED',name:'Ly đã đồng ý',missing:100},{id:'b',sku:'PENDING',name:'Chưa đồng ý',missing:50}]},
  el,input,btn,qtyInput:(value:any,max:any)=>input('number',value,{max}),field:(label:string,n:Node)=>{const l=el('label','',label);l.append(n);return l;},
  frame:()=>root,back(){},errorBox:()=>el('p','error'),foot:(n:Node)=>n,today:()=> '2026-10-24',key:()=> 'stable-receipt-key',num:String,toast(){},
  api:async(path:string,method?:string,body?:any)=>{if(method){posts.push({path,body});return{};}return{warehouses:[{id:'w',name:'Kho nhận'}]};},
  localStorage:{getItem(){return null;}},run:async(_b:any,_e:any,fn:Function)=>fn()};
 vm.createContext(ctx);vm.runInContext(fn,ctx);
 ctx.receiveForm(early?{requestId:'early-1',lines:[{lineId:'a',remaining:7}]}:null,createSapo);await flush();
 return {root,posts,nodes:()=>all(root)};
}
test('receive form shows only accepted allocated items, caps full quantity and submits original request with stable receipt key',async()=>{
 const f=await fixture();assert.match(f.root.textContent,/ACCEPTED/);assert.doesNotMatch(f.root.textContent,/PENDING/);
 const fill=f.nodes().find(n=>n.tag==='button'&&n.textContent==='Đủ 7')!;assert.ok(fill);fill.events.click!();
 const form=f.nodes().find(n=>n.tag==='form')!;form.events.submit!({preventDefault(){}});await flush();
 assert.equal(f.posts.length,1);assert.equal(f.posts[0].path,'/purchase-orders/po/receipts');assert.equal(f.posts[0].body.earlyRequestId,'early-1');
 assert.equal(f.posts[0].body.lines.length,1);assert.equal(f.posts[0].body.lines[0].lineId,'a');assert.equal(f.posts[0].body.lines[0].goodQty,7);
 assert.equal(f.posts[0].body.warehouse,'Kho nhận');form.events.submit!({preventDefault(){}});await flush();assert.equal(f.posts[1].body.clientKey,f.posts[0].body.clientKey);
});
test('normal purchase receiving form keeps all remaining purchase lines',async()=>{const f=await fixture(false);assert.match(f.root.textContent,/ACCEPTED/);assert.match(f.root.textContent,/PENDING/);assert.ok(f.nodes().find(n=>n.textContent==='Đủ 100'));});
test('Sapo choice opens the same scoped form with true/false; closing does not open a form',async()=>{
 const source=readFileSync(new URL('../../trial-ui/purchases.js',import.meta.url),'utf8');
 const helper=source.slice(source.indexOf('async function confirmAndOpenReceiveForm'),source.indexOf('async function openDetail'));
 for(const choice of [true,false,null]){
  const body=new Node('body'),forms:any[]=[];
  const el=(tag:string,cls='',text='')=>new Node(tag,cls,text);
  const btn=(text:string,cls:string,fn:Function)=>{const b=el('button',cls,text);b.addEventListener('click',fn);return b;};
  const ctx:any={el,btn,document:{body,createElement:el},receiveForm:(...args:any[])=>forms.push(args)};
  vm.createContext(ctx);vm.runInContext(helper,ctx);
  const context={requestId:'early-1',lines:[{lineId:'a',remaining:7}]};
  const pending=ctx.confirmAndOpenReceiveForm(context);
  const modal=body.children[0]!;assert.equal(modal.open,true);assert.equal(forms.length,0);
  const name=choice===true?'Có — tạo đơn nhập Sapo':choice===false?'Không — chỉ nhập CRM':'Đóng';
  all(body).find(n=>n.tag==='button'&&n.textContent===name)!.events.click!();await pending;
  assert.equal(forms.length,choice===null?0:1);
  if(choice!==null){assert.equal(forms[0][0],context);assert.equal(forms[0][1],choice);}
  assert.equal(modal.open,false);assert.equal(modal.removed,true);
 }
});
test('CRM-only form submits false without another prompt, default form submits true',async()=>{
 for(const createSapo of [true,false]){
  const f=await fixture(true,createSapo);
  f.nodes().find(n=>n.tag==='button'&&n.textContent==='Đủ 7')!.events.click!();
  f.nodes().find(n=>n.tag==='form')!.events.submit!({preventDefault(){}});await flush();
  assert.equal(f.posts.length,1);assert.equal(f.posts[0].body.createSapo,createSapo);assert.equal(f.posts[0].body.earlyRequestId,'early-1');
 }
});
test('reopening receive refreshes the selected request scope and does not fall back on lookup failure',async()=>{
 const source=readFileSync(new URL('../../trial-ui/purchases.js',import.meta.url),'utf8');
 const action=source.slice(source.indexOf('    receive: async'),source.indexOf('    pay: () => payForm'));
 for(const fail of [false,true]){
  const forms:any[]=[],errors:any[]=[],reads:string[]=[],fresh={requestId:'early-1',lines:[{lineId:'a',remaining:2}]};
  const ctx:any={activeEarlyContext:{requestId:'early-1',lines:[]},current:{id:'po'},encodeURIComponent,
   api:async(path:string)=>{reads.push(path);if(fail)throw Error('No quantity left');return fresh;},
   confirmAndOpenReceiveForm:async(context:any)=>forms.push(context),toast:(error:any)=>errors.push(error)};
  vm.createContext(ctx);vm.runInContext('this.action=({'+action+'}).receive',ctx);await ctx.action();
  assert.equal(reads[0],'/purchase-early-requests/early-1/receiving?orderId=po');
  assert.equal(forms.length,fail?0:1);assert.equal(errors.length,fail?1:0);if(!fail)assert.equal(forms[0],fresh);
 }
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
class Node {
 children:Node[]=[];events:Record<string,Function>={};text='';value:any='';className='';type='';disabled=false;hidden=false;classList={toggle(){}};max:any;
 constructor(public tag:string,cls='',text=''){this.className=cls;this.text=text;}
 append(...n:Node[]){this.children.push(...n);}setAttribute(k:string,v:any){(this as any)[k]=v;}addEventListener(k:string,f:Function){this.events[k]=f;}focus(){}replaceChildren(...n:Node[]){this.children=n;}
 set textContent(v:string){this.text=v;}get textContent():string{return this.text+this.children.map(c=>c.textContent).join('');}
}
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];
const flush=()=>new Promise<void>(r=>setImmediate(r));
async function fixture(early=true,confirm=true){
 const root=new Node('div'),posts:any[]=[],confirmations:any[]=[];
 const el=(tag:string,cls='',text='')=>new Node(tag,cls,text);
 const input=(type:string,value:any='',attrs:any={})=>Object.assign(el('input'),{type,value},attrs);
 const btn=(text:string,cls:string,fn:Function)=>{const b=el('button',cls,text);b.addEventListener('click',fn);return b;};
 const source=readFileSync(new URL('../../trial-ui/purchases.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('  function receiveForm('),source.indexOf('  function payForm('));
 const ctx:any={current:{id:'po',ticketNumber:'PO',lines:[{id:'a',sku:'ACCEPTED',name:'Ly đã đồng ý',missing:100},{id:'b',sku:'PENDING',name:'Chưa đồng ý',missing:50}]},
  el,input,btn,qtyInput:(value:any,max:any)=>input('number',value,{max}),field:(label:string,n:Node)=>{const l=el('label','',label);l.append(n);return l;},
  frame:()=>root,back(){},errorBox:()=>el('p','error'),foot:(n:Node)=>n,today:()=> '2026-10-24',key:()=> 'stable-receipt-key',num:String,toast(){},
  confirmBox:async(message:string,options:any)=>{confirmations.push({message,options});return confirm;},
  api:async(path:string,method?:string,body?:any)=>{if(method){posts.push({path,body});return{};}return{warehouses:[{id:'w',name:'Kho nhận'}]};},
  localStorage:{getItem(){return null;}},run:async(_b:any,_e:any,fn:Function)=>fn()};
 vm.createContext(ctx);vm.runInContext(fn,ctx);
 ctx.receiveForm(early?{requestId:'early-1',lines:[{lineId:'a',remaining:7}]}:null);await flush();
 return {root,posts,confirmations,nodes:()=>all(root)};
}
test('receive form shows only accepted allocated items, caps full quantity and submits original request with stable receipt key',async()=>{
 const f=await fixture();assert.match(f.root.textContent,/ACCEPTED/);assert.doesNotMatch(f.root.textContent,/PENDING/);
 const fill=f.nodes().find(n=>n.tag==='button'&&n.textContent==='Đủ 7')!;assert.ok(fill);fill.events.click!();
 const form=f.nodes().find(n=>n.tag==='form')!;form.events.submit!({preventDefault(){}});await flush();
 assert.equal(f.confirmations.length,1);assert.match(f.confirmations[0].message,/tạo đơn nhập hàng trên Sapo/i);
 assert.equal(f.confirmations[0].options.ok,'Nhận hàng & tạo đơn Sapo');
 assert.equal(f.posts.length,1);assert.equal(f.posts[0].path,'/purchase-orders/po/receipts');assert.equal(f.posts[0].body.earlyRequestId,'early-1');
 assert.equal(f.posts[0].body.lines.length,1);assert.equal(f.posts[0].body.lines[0].lineId,'a');assert.equal(f.posts[0].body.lines[0].goodQty,7);
 assert.equal(f.posts[0].body.warehouse,'Kho nhận');form.events.submit!({preventDefault(){}});await flush();assert.equal(f.posts[1].body.clientKey,f.posts[0].body.clientKey);
});
test('normal purchase receiving form keeps all remaining purchase lines',async()=>{const f=await fixture(false);assert.match(f.root.textContent,/ACCEPTED/);assert.match(f.root.textContent,/PENDING/);assert.ok(f.nodes().find(n=>n.textContent==='Đủ 100'));});
test('cancel Sapo confirmation leaves the receipt unsaved and sends no webhook request',async()=>{
 const f=await fixture(false,false),form=f.nodes().find(n=>n.tag==='form')!;
 f.nodes().find(n=>n.tag==='button'&&n.textContent==='Đủ 100')!.events.click!();
 form.events.submit!({preventDefault(){}});await flush();
 assert.equal(f.confirmations.length,1);assert.equal(f.posts.length,0);
});

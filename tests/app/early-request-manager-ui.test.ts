import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
class Node {
  [key:string]:any;
  setCustomValidity(message:string){this.validationMessage=message;}
  getAttribute(key:string){return this.attrs[key]??this[key];}
  children:Node[]=[];parent:Node|null=null;attrs:Record<string,string>={};events:Record<string,Function>={};style={};dataset:Record<string,string>={};
  type='';value:any='';className='';own='';hidden=false;disabled=false;tag:string;
  classList={toggle:()=>{}};
  constructor(tag='div'){this.tag=tag;}
  set textContent(v:string){this.own=String(v);this.children=[];}get textContent():string{return this.own+this.children.map(c=>c.textContent).join('');}
  append(...nodes:Node[]){for(const n of nodes){n.parent=this;this.children.push(n);}}
  replaceChildren(...nodes:Node[]){this.children=[];this.own='';this.append(...nodes);}
  setAttribute(k:string,v:string){this.attrs[k]=v;}removeAttribute(k:string){delete this.attrs[k];}
  addEventListener(k:string,fn:Function){this.events[k]=fn;}
  querySelectorAll(selector:string):Node[]{return this.children.flatMap(c=>[...(selector==='button'?c.tag==='button':selector==='.chip'?c.className.includes('chip'):selector==='input[type=text]'?c.tag==='input'&&c.type==='text':selector==='input[type=number]'?c.tag==='input'&&c.type==='number':false)?[c]:[],...c.querySelectorAll(selector)]);}
  querySelector(selector:string){return this.querySelectorAll(selector)[0]!;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  focus(){}
  async click(){if(!this.disabled)await this.events.click?.();}
}
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];

async function setup({manager=true,portal=false,status='submitted',receive=false,remaining=20}={}) {
  const host=new Node(),body=new Node('body'),calls:any[]=[],quick:any[]=[];let accepted=false,fail=false,saved=0;
  Node.prototype.showModal=function(){this.open=true;};
  Node.prototype.close=function(){this.open=false;this.events.close?.();};
  const context:any={openEarlyQuickReceipt:async({request}:any)=>{quick.push(request);},document:{createElement:(tag:string)=>new Node(tag),body},URLSearchParams,Intl,Date};
  runInNewContext(readFileSync(new URL('../../trial-ui/purchase-early-requests.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export function initEarlyRequests','globalThis.initEarlyRequests = function'),context);
  const api=async(path:string,method?:string,data?:any)=>{
    if(method){calls.push({path,data});if(fail)throw Error('Phiếu đã thay đổi');accepted=true;return{ok:true};}
    return{canViewPortal:manager,canReceive:receive,requests:[{id:'r1',createdAt:'2026-10-23T01:00:00Z',pickupDate:'2026-10-24',requestStatus:status,status:accepted?'accepted':'pending',lines:[{id:'l1',sku:'SKU1',name:'Ly',quantity:20,unit:'Cái',status:accepted?'accepted':'pending',allocations:[{id:'a1',supplierId:'s1',supplierName:'NCC A',quantity:20,remainingToReceive:accepted?remaining:0,status:accepted?'accepted':'pending',orderId:'o1',ticketNumber:'PO1'}]}]}]};
  };
  const ui=context.initEarlyRequests({api,host,portal,onSaved:async()=>saved++});await ui.load();
  return{host,body,calls,get saved(){return saved;},fail:()=>fail=true,quick,quickButton:()=>all(host).find(n=>n.tag==='button'&&n.textContent==='Nhận hàng nhanh'),button:(text:string)=>all(body).concat(all(host)).find(n=>n.tag==='button'&&n.textContent===text)};
}
test('Manager xác nhận từ cạnh trạng thái: đúng mã/NCC, tải lại và không gửi trùng',async()=>{
  const s=await setup();await s.button('Manager xác nhận thay NCC')!.click();
  assert.match(s.body.textContent,/NCC A · SKU1 · 20 Cái/);assert.match(s.body.textContent,/không nhận hàng hoặc cộng tồn/);
  const action=s.button('Xác nhận 1 phiếu')!;await Promise.all([action.click(),action.click()]);
  assert.equal(s.calls.length,1);assert.equal(s.calls[0].path,'/purchase-early-requests/manager-confirm-batch');assert.equal(JSON.stringify(s.calls[0].data.allocationIds),JSON.stringify(['a1']));assert.equal(s.saved,1);
  assert.match(s.host.textContent,/NCC đồng ý/);assert.equal(s.button('Manager xác nhận thay NCC'),undefined);
});
test('không hiện xác nhận thay cho nhân viên, cổng NCC hoặc phiếu nháp',async()=>{
  for(const options of [{manager:false},{portal:true},{status:'draft'}])assert.equal((await setup(options)).button('Manager xác nhận thay NCC'),undefined);
});
test('xác nhận lỗi hiện thông báo server và cho thử lại',async()=>{
  const s=await setup();s.fail();await s.button('Manager xác nhận thay NCC')!.click();await s.button('Xác nhận 1 phiếu')!.click();
  assert.match(s.body.textContent,/Phiếu đã thay đổi/);assert.equal(s.button('Xác nhận 1 phiếu')!.disabled,false);assert.equal(s.saved,0);
});

test('quick receipt appears after acceptance only for receiving staff and passes the exact displayed request scope',async()=>{
 const s=await setup({receive:true});assert.equal(s.quickButton(),undefined);
 await s.button('Manager xác nhận thay NCC')!.click();await s.button('Xác nhận 1 phiếu')!.click();
 await s.quickButton()!.click();assert.equal(s.quick.length,1);assert.equal(s.quick[0].id,'r1');assert.equal(s.quick[0].lines[0].allocations[0].orderId,'o1');assert.equal(s.quick[0].lines[0].sku,'SKU1');
 for(const opts of [{receive:false},{receive:true,portal:true},{receive:true,remaining:0}]){
  const blocked=await setup(opts);if(!opts.portal){await blocked.button('Manager xác nhận thay NCC')!.click();await blocked.button('Xác nhận 1 phiếu')!.click();}assert.equal(blocked.quickButton(),undefined);
 }
});

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

async function setup(){
  const host=new Node(),calls:string[]=[],navigation:string[]=[];let historyLoads=0,savedOptions:any,accepted=false,drafts=0;
  const request={id:'request-1',lineId:'line-1',createdAt:'2026-10-23T10:34:00Z',pickupDate:'2026-10-24',requestStatus:'submitted',status:'pending',quantity:300,supplierName:'NCC A',orders:[]};
  const context:any={initEarlyRequests:(opts:any)=>{savedOptions=opts;return{load:async()=>historyLoads++,open:async()=>{},newDraft:()=>drafts++};},document:{createElement:(tag:string)=>new Node(tag)},URLSearchParams};
  const source=readFileSync(new URL('../../trial-ui/purchase-incoming.js',import.meta.url),'utf8').replace(/^import .*;\n/,'').replace('export function initPurchaseIncoming','globalThis.initPurchaseIncoming = function');
  runInNewContext(source,context);
  const api=async(path:string,method?:string)=>{
    assert.equal(method,undefined);calls.push(path);const type=new URLSearchParams(path.split('?')[1]).get('type');
    const early=type==='purchase'?[]:[{...request,status:accepted?'accepted':'pending'}];
    return{canRequest:true,canSend:true,documentType:type,canViewStock:false,total:1,offset:0,limit:50,suppliers:[{id:'a',name:'NCC A'}],kpis:{skus:1,quantity:20000,suppliers:1,overdueOrders:0,earlyRequests:early.length,earlyQuantity:early.length?300:0},
      rows:[{sku:'X',name:'Ly sứ',unit:'Cái',quantity:20000,unitConflict:false,orderCount:1,supplierNames:['NCC A'],earliestDue:'2026-10-24',late:false,confirmed:false,earlyRequests:early,earlyQuantity:early.length?300:0,
        orders:[{id:'po-1',ticketNumber:'PO-1',quantity:20000,supplierId:'a',supplierName:'NCC A',unit:'Cái',due:'2026-10-24'}]}]};
  };
  const ui=context.initPurchaseIncoming({api,host,go:(hash:string)=>navigation.push(hash)});await ui.show();
  return{host,ui,calls,navigation,get historyLoads(){return historyLoads;},get drafts(){return drafts;},accept:()=>{accepted=true;},onSaved:()=>savedOptions.onSaved(),label:(text:string)=>all(host).find(n=>n.attrs['aria-label']===text)!,button:(text:string)=>all(host).find(n=>n.tag==='button'&&n.textContent===text)!};
}
test('hàng đang về UI: lọc mua/lấy trước, hiện link phiếu và không tạo phiếu thứ hai trong chế độ lấy trước',async()=>{
  const s=await setup();assert.match(s.host.textContent,/Phiếu lấy trước/);assert.match(s.host.textContent,/20.000/);assert.match(s.host.textContent,/SL đã xin 300/);
  const type=s.label('Loại phiếu');type.value='early';await type.events.change!();
  assert.equal(new URLSearchParams(s.calls.at(-1)!.split('?')[1]).get('type'),'early');
  assert.equal(s.label('SL cần lấy trước mã X').disabled,true);assert.equal(s.label('Chọn mã X').disabled,true);assert.equal(s.button('Lưu và gửi NCC').disabled,true);assert.equal(s.drafts,0);
  const link=all(s.host).find(n=>n.tag==='a'&&String(n.href).includes('request=request-1'))!;
  await link.events.click!({ctrlKey:false,metaKey:false,button:0,preventDefault(){}});assert.equal(s.navigation[0],'#/purchases?mode=incoming&request=request-1');
  type.value='purchase';await type.events.change!();assert.equal(new URLSearchParams(s.calls.at(-1)!.split('?')[1]).get('type'),'purchase');assert.equal(s.label('SL cần lấy trước mã X').disabled,false);
  assert.equal(all(s.host).some(n=>n.tag==='a'&&String(n.href).includes('request=request-1')),false);
});
test('hàng đang về UI: Làm mới nạp cả phiếu đã lưu; lưu phiếu xong cập nhật bảng ngay',async()=>{
  const s=await setup(),before=s.historyLoads;s.accept();await s.button('Làm mới').click();assert.equal(s.historyLoads,before+1);assert.match(s.host.textContent,/NCC đồng ý/);
  const count=s.calls.length;await s.onSaved();await new Promise(resolve=>setImmediate(resolve));assert.equal(s.calls.length,count+1);
  assert.equal(s.host.textContent.includes('20.300'),false,'lượng xin không cộng lại vào tồn đang về');
});

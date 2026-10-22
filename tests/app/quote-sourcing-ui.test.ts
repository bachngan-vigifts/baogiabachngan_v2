import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
class Node {
  children:Node[]=[];parent:Node|null=null;attrs:Record<string,string>={};events:Record<string,Function>={};tag:string;
  hidden=false;disabled=false;type='';className='';own='';val:string|undefined;href='';target='';rel='';min='';step='';readOnly=false;
  constructor(tag='div'){this.tag=tag;}
  set textContent(v:string){this.own=String(v);this.children=[];}get textContent():string{return this.own+this.children.map(n=>n.textContent).join('');}
  set value(v:any){this.val=String(v);}get value():string{return this.val??(this.tag==='select'?this.children[0]?.value:'')??'';}
  get selectedOptions(){return this.children.filter(c=>c.value===this.value);}
  setAttribute(k:string,v:string){this.attrs[k]=v;}
  append(...nodes:Node[]){for(const n of nodes){n.parent=this;this.children.push(n);}}
  replaceChildren(...nodes:Node[]){this.children=[];this.own='';this.append(...nodes);}
  addEventListener(k:string,fn:Function){this.events[k]=fn;}
  async fire(k='click'){if(!this.disabled)await this.events[k]?.();}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
}
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];
async function setup(fail=false){
  const host=new Node(),posts:any[]=[];let current=true;
  const ctx:any={document:{createElement:(tag:string)=>new Node(tag)},crypto:{randomUUID:()=> 'safe-client-key'}};
  runInNewContext(readFileSync(new URL('../../trial-ui/quote-sourcing.js',import.meta.url),'utf8').replace('export async function initQuoteSourcing','globalThis.initQuoteSourcing = async function'),ctx);
  const api=async(path:string,method?:string,body?:any)=>{
    if(method){posts.push({path,body});if(fail)throw Error('Mất kết nối');if(path==='/stock-transfers')return{id:'t1'};if(path==='/purchase-orders')return{ids:['p1']};return{request:{id:'e1'}};}
    if(path==='/purchase-options')return{suppliers:[{id:'s1',name:'NCC Một'}]};
    return{quoteNo:'BG1',customerName:'Khách',canPurchase:true,canRequestEarly:true,warehouses:[{id:'a',name:'Kho bán',opened:true,canSell:true},{id:'b',name:'Kho xin',opened:true,canSell:false}],lines:[{sku:'X',name:'Sản phẩm',unit:'cái',qty:3,stock:{a:2,b:1},incoming:1}]};
  };
  const ui=await ctx.initQuoteSourcing({api,host,quoteId:'q',confirmBox:async()=>true,isCurrent:()=>current});
  const label=(name:string)=>all(host).find(n=>n.attrs['aria-label']===name)!;
  const button=(name:string)=>all(host).find(n=>n.tag==='button'&&n.textContent===name)!;
  return{host,ui,posts,label,button,close:()=>{current=false;}};
}
test('nguồn hàng UI: lập kế hoạch 2+1, chỉ xin hàng khi bấm, giữ tham chiếu và không gửi trùng',async()=>{
  const s=await setup();assert.equal(s.posts.length,0);assert.match(s.host.textContent,/Có hàng đang chờ về: 1/);
  assert.throws(()=>s.ui.read(),/chọn kho xin hàng/);
  s.label('Kho xin hàng X').value='b';const plan=s.ui.read();
  assert.equal(plan.warehouseId,'a');assert.deepEqual(JSON.parse(JSON.stringify(plan.stockPlan)).map((p:any)=>[p.type,p.qty]),[['stock',2],['transfer',1]]);
  await s.button('Xin hàng').fire();assert.equal(s.posts.length,1);assert.equal(s.posts[0].path,'/stock-transfers');assert.equal(s.posts[0].body.toWarehouseId,'a');
  await s.button('Xin hàng').fire();assert.equal(s.posts.length,1);assert.match(s.ui.read().note,/#\/transfers\/t1/);
  s.label('Lấy từ kho X').value=3;assert.throws(()=>s.ui.read(),/tổng lấy từ kho/);
});
test('nguồn hàng UI: đặt NCC nháp đúng nguồn báo giá; xin giao trước giữ clientKey',async()=>{
  const s=await setup(),type=s.label('Nguồn hàng X');type.value='purchase';await type.fire('change');
  s.label('Nhà cung cấp X').value='s1';await s.button('Lập đơn mua nháp').fire();
  assert.equal(s.posts[0].path,'/purchase-orders');assert.equal(s.posts[0].body.orders[0].lines[0].sources[0].id,'q');assert.match(s.ui.read().note,/NCC Một/);
  const e=await setup();e.label('Nguồn hàng X').value='incoming';await e.label('Nguồn hàng X').fire('change');await e.button('Xin giao trước').fire();
  assert.equal(e.posts[0].path,'/purchase-early-requests');assert.equal(e.posts[0].body.clientKey,'safe-client-key');assert.match(e.ui.read().note,/#\/purchases/);
});
test('nguồn hàng UI: mất kết nối sau gửi không cho bấm lặp mù; đóng form không tạo yêu cầu',async()=>{
  const s=await setup(true);s.label('Kho xin hàng X').value='b';await s.button('Xin hàng').fire();await s.button('Xin hàng').fire();
  assert.equal(s.posts.length,1);assert.match(s.host.textContent,/Kiểm tra danh sách/);
  const closed=await setup();closed.label('Kho xin hàng X').value='b';closed.close();await closed.button('Xin hàng').fire();assert.equal(closed.posts.length,0);
});

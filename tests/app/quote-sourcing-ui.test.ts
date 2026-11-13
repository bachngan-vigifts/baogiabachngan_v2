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
async function setup(fail=false,overrides:any={},confirm=true,choice:string|null='create',chooseWarehouse=true){
  const host=new Node(),posts:any[]=[];let current=true,failWrites=fail;
  const ctx:any={URLSearchParams,document:{createElement:(tag:string)=>new Node(tag)},crypto:{randomUUID:()=> 'safe-client-key'}};
  runInNewContext(readFileSync(new URL('../../trial-ui/quote-sourcing.js',import.meta.url),'utf8').replace('export function chooseSourcePurchase','function chooseSourcePurchase').replace('export async function initQuoteSourcing','globalThis.initQuoteSourcing = async function'),ctx);
  const api=async(path:string,method?:string,body?:any)=>{
    if(method){posts.push({path,body});if(failWrites)throw Error('Mất kết nối');if(path==='/stock-transfers')return{id:'t1'};if(path==='/purchase-orders')return{ids:body.orders.map((_:any,i:number)=>'p'+(i+1))};return{request:{id:'e1'}};}
    if(path.startsWith('/purchase-incoming?'))return {rows:overrides.incomingRows||[{sku:'X',orders:[{id:'p1',ticketNumber:'DMH_001',supplierName:'NCC Một',quantity:1,due:'2026-11-01'},{id:'p2',ticketNumber:'DMH_002',supplierName:'NCC Hai',internalNo:'00042',quantity:2,due:'2026-11-03'}]}]};
    if(path==='/purchase-options')return{suppliers:[{id:'s1',name:'NCC Một'}]};
    return{quoteNo:'BG1',customerName:'Khách',canPurchase:true,canRequestEarly:true,warehouses:[{id:'a',name:'Kho bán',opened:true,canSell:true},{id:'b',name:'Kho xin',opened:true,canSell:false}],lines:[{sku:'X',name:'Sản phẩm',unit:'cái',qty:3,stock:{a:2,b:1},incoming:1}],...overrides};
  };
  const ui=await ctx.initQuoteSourcing({api,host,quoteId:'q',confirmBox:async()=>confirm,choosePurchase:async()=>choice,isCurrent:()=>current});
  const label=(name:string)=>all(host).find(n=>n.attrs['aria-label']===name)!;
  const button=(name:string)=>all(host).find(n=>n.tag==='button'&&n.textContent===name)!;
  if(chooseWarehouse){label('Kho bán / kho xuất').value='a';await label('Kho bán / kho xuất').fire('change');}
  return{host,ui,posts,label,button,recover:()=>{failWrites=false;},close:()=>{current=false;}};
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
  const e=await setup();e.label('Nguồn hàng X').value='incoming';await e.label('Nguồn hàng X').fire('change');assert.equal(e.button('Xin giao trước').disabled,true);e.label('Đơn mua lấy hàng X').value='p2';await e.label('Đơn mua lấy hàng X').fire('change');assert.equal(e.button('Xin giao trước').hidden,true);await e.ui.prepare();
  assert.equal(e.posts[0].path,'/purchase-early-requests');assert.equal(e.posts[0].body.clientKey,'safe-client-key');assert.deepEqual(JSON.parse(JSON.stringify(e.posts[0].body.lines)),[{sku:'X',quantity:1,sourceOrders:[{orderNo:'DMH_002',supplierOrderNo:'00042',quantity:1}]}]);assert.match(e.ui.read().note,/DMH_002.*03\/11\/2026/);assert.match(e.ui.read().note,/#\/purchases/);
});
test('nguồn hàng UI: mất kết nối sau gửi không cho bấm lặp mù; đóng form không tạo yêu cầu',async()=>{
  const s=await setup(true);s.label('Kho xin hàng X').value='b';await s.button('Xin hàng').fire();await s.button('Xin hàng').fire();
  assert.equal(s.posts.length,1);assert.match(s.host.textContent,/Kiểm tra danh sách/);
  const closed=await setup();closed.label('Kho xin hàng X').value='b';closed.close();await closed.button('Xin hàng').fire();assert.equal(closed.posts.length,0);
});

test('sinh đơn: tự gộp nguồn đặt NCC chưa bấm tạo theo NCC; lưu liên kết và không tạo lại khi gửi tiếp',async()=>{
  const lines=['X','Y'].map(sku=>({sku,name:sku,unit:'bộ',qty:3,stock:{a:2},incoming:0}));
  const s=await setup(false,{lines});
  for(const sku of ['X','Y']){s.label('Nguồn hàng '+sku).value='purchase';await s.label('Nguồn hàng '+sku).fire('change');s.label('Nhà cung cấp '+sku).value='s1';}
  assert.equal(s.posts.length,0);
  const plan=await s.ui.prepare();assert.equal(s.posts.length,1);assert.equal(s.posts[0].path,'/purchase-orders');assert.equal(s.posts[0].body.orders.length,1);assert.equal(s.posts[0].body.orders[0].lines.length,2);
  assert.equal(s.posts[0].body.orders[0].lines[0].sources[0].id,'q');assert.match(plan.note,/#\/purchases\/p1/);assert.doesNotMatch(plan.note,/Chưa tạo yêu cầu/);
  await s.ui.prepare();assert.equal(s.posts.length,1);assert.equal(s.label('Nguồn hàng X').disabled,true);
});
test('sinh đơn: xin hàng kho khác chưa bấm "Xin hàng" tự lập phiếu điều chuyển (gộp theo kho xin), không tạo lại',async()=>{
  const lines=['X','Y'].map(sku=>({sku,name:sku,unit:'bộ',qty:3,stock:{a:2,b:5},incoming:0}));
  const s=await setup(false,{lines});
  for(const sku of ['X','Y'])s.label('Kho xin hàng '+sku).value='b';
  assert.equal(s.posts.length,0);
  const plan=await s.ui.prepare();
  assert.equal(s.posts.length,1);assert.equal(s.posts[0].path,'/stock-transfers');
  assert.deepEqual(JSON.parse(JSON.stringify(s.posts[0].body)),{fromWarehouseId:'b',toWarehouseId:'a',reason:'Báo giá BG1 · Khách',lines:[{sku:'X',qty:1},{sku:'Y',qty:1}]});
  assert.match(plan.note,/#\/transfers\/t1/);assert.doesNotMatch(plan.note,/Chưa tạo yêu cầu/);
  await s.ui.prepare();assert.equal(s.posts.length,1,'gửi lại không tạo phiếu thứ hai');
  const lost=await setup(true);lost.label('Kho xin hàng X').value='b';
  await assert.rejects(()=>lost.ui.prepare(),/Chưa xác định phiếu xin hàng/);await assert.rejects(()=>lost.ui.prepare(),/chưa xác định/);assert.equal(lost.posts.length,1);
});
test('sinh đơn: từ chối/không quyền/số lượng sai không tạo đơn mua; lỗi mạng chặn tạo lặp và không trả kế hoạch thành công',async()=>{
  const cancelled=await setup(false,{},true,null);cancelled.label('Nguồn hàng X').value='purchase';await cancelled.label('Nguồn hàng X').fire('change');cancelled.label('Nhà cung cấp X').value='s1';
  await assert.rejects(()=>cancelled.ui.prepare(),/Đã quay lại/);assert.equal(cancelled.posts.length,0);
  const no=await setup(false,{canPurchase:false});no.label('Nguồn hàng X').value='purchase';await no.label('Nguồn hàng X').fire('change');no.label('Nhà cung cấp X').value='s1';await assert.rejects(()=>no.ui.prepare(),/không có quyền/);assert.equal(no.posts.length,0);
  const bad=await setup();bad.label('Nguồn hàng X').value='purchase';await bad.label('Nguồn hàng X').fire('change');bad.label('Nhà cung cấp X').value='s1';bad.label('Số lượng nguồn hàng X').value=2;await assert.rejects(()=>bad.ui.prepare(),/tổng lấy từ kho/);assert.equal(bad.posts.length,0);
  const lost=await setup(true);lost.label('Nguồn hàng X').value='purchase';await lost.label('Nguồn hàng X').fire('change');lost.label('Nhà cung cấp X').value='s1';
  await assert.rejects(()=>lost.ui.prepare(),/Chưa xác định/);await assert.rejects(()=>lost.ui.prepare(),/chưa xác định/);assert.equal(lost.posts.length,1);
});

test('sinh đơn: đặt NCC sau vẫn trả kế hoạch đầy đủ, không tạo đơn mua và ghi rõ chưa tạo yêu cầu',async()=>{
  const s=await setup(false,{},true,'later');
  s.label('Nguồn hàng X').value='purchase';await s.label('Nguồn hàng X').fire('change');s.label('Nhà cung cấp X').value='s1';
  const plan=await s.ui.prepare();
  assert.equal(s.posts.length,0);assert.equal(plan.warehouseId,'a');
  assert.match(plan.note,/NCC Một · Chưa tạo yêu cầu/);
  assert.equal(plan.stockPlan.find((p:any)=>p.type==='purchase').qty,1);
  assert.equal(s.label('Nguồn hàng X').disabled,false);
});
test('sinh đơn: chưa có quyền mua vẫn được lưu kế hoạch và đặt NCC sau',async()=>{
  const s=await setup(false,{canPurchase:false},true,'later');
  s.label('Nguồn hàng X').value='purchase';await s.label('Nguồn hàng X').fire('change');s.label('Nhà cung cấp X').value='s1';
  assert.match((await s.ui.prepare()).note,/Chưa tạo yêu cầu/);assert.equal(s.posts.length,0);
});

test('hộp chọn mua NCC: tạo ngay, đặt sau và Escape trả kết quả riêng, luôn dọn hộp thoại',async()=>{
  const body=new Node();let shown=0;
  class DialogNode extends Node {showModal(){shown++;}close(){}focus(){}}
  const context:any={document:{body,createElement:(tag:string)=>new DialogNode(tag)}};
  const code=readFileSync(new URL('../../trial-ui/quote-sourcing.js',import.meta.url),'utf8').split('/** Source allocations')[0]!.replace('export function chooseSourcePurchase','globalThis.chooseSourcePurchase = function');
  runInNewContext(code,context);
  for(const choice of ['create','later',null]){
    const promise=context.chooseSourcePurchase({count:2,skuCount:9,quoteNo:'BG1',canPurchase:true});
    assert.match(body.textContent,/9 mã cần đặt từ 2 NCC/);
    const dialog=body.children[0]!;
    if(choice===null)dialog.events.cancel!({preventDefault(){}});
    else await all(dialog).find(n=>n.tag==='button'&&n.textContent.startsWith(choice==='create'?'Tạo đơn mua':'Đặt NCC sau'))!.fire();
    assert.equal(await promise,choice);assert.equal(body.children.length,0);
  }
  assert.equal(shown,3);
});

test('xin giao trước: chọn đơn và ngày hẹn, chặn vượt nguồn; đổi loại nguồn không mất đơn đã chọn',async()=>{
  const s=await setup(false,{lines:[{sku:'X',name:'Sản phẩm',unit:'cái',qty:3,stock:{a:0},incoming:3}]}),type=s.label('Nguồn hàng X');
  type.value='incoming';await type.fire('change');assert.throws(()=>s.ui.read(),/chọn đơn mua NCC/);
  const order=s.label('Đơn mua lấy hàng X');assert.match(order.textContent,/DMH_002.*03\/11\/2026/);order.value='p2';await order.fire('change');
  assert.throws(()=>s.ui.read(),/DMH_002.*tối đa 2/);await s.button('Xin giao trước').fire();assert.equal(s.posts.length,0);
  type.value='transfer';await type.fire('change');assert.equal(order.hidden,true);
  type.value='incoming';await type.fire('change');assert.equal(order.value,'p2');assert.equal(order.hidden,false);
});

test('sinh đơn gom nhiều mã và nhiều nguồn cùng SKU vào một phiếu, bỏ dòng 0 và không tạo lại',async()=>{
  const lines=['X','Y','Z'].map(sku=>({sku,name:sku,unit:'cái',qty:sku==='X'?4:2,stock:{a:sku==='Z'?2:0},incoming:10}));
  const incomingRows=lines.map(l=>({sku:l.sku,orders:[{id:'p1',ticketNumber:'DMH_001',supplierName:'NCC Một',quantity:2,due:'2026-11-01'},{id:'p2',ticketNumber:'DMH_002',supplierName:'NCC Hai',internalNo:'00042',quantity:5,due:'2026-11-03'}]}));
  const s=await setup(false,{lines,incomingRows});
  for(const sku of ['X','Y']){const type=s.label('Nguồn hàng '+sku);type.value='incoming';await type.fire('change');s.label('Đơn mua lấy hàng '+sku).value='p2';}
  // Split X across two purchases. Y remains a separate SKU in the same request.
  s.label('Số lượng nguồn hàng X').value=2;
  const add=all(s.host).find(n=>n.tag==='button'&&n.textContent==='＋ Thêm nguồn hàng')!;await add.fire();
  const types=all(s.host).filter(n=>n.attrs['aria-label']==='Nguồn hàng X'),orders=all(s.host).filter(n=>n.attrs['aria-label']==='Đơn mua lấy hàng X');
  types[1]!.value='incoming';await types[1]!.fire('change');orders[1]!.value='p1';
  await all(s.host).filter(n=>n.tag==='button'&&n.textContent==='＋ Thêm nguồn hàng')[2]!.fire();
  s.label('Nguồn hàng Z').value='incoming';await s.label('Nguồn hàng Z').fire('change');
  assert.equal(s.label('Số lượng nguồn hàng Z').value,'0');
  assert.equal(s.posts.length,0);
  const plan=await s.ui.prepare();assert.equal(s.posts.length,1);assert.equal(s.posts[0].path,'/purchase-early-requests');
  assert.deepEqual(JSON.parse(JSON.stringify(s.posts[0].body.lines)),[
    {sku:'X',quantity:4,sourceOrders:[{orderNo:'DMH_002',supplierOrderNo:'00042',quantity:2},{orderNo:'DMH_001',supplierOrderNo:'',quantity:2}]},
    {sku:'Y',quantity:2,sourceOrders:[{orderNo:'DMH_002',supplierOrderNo:'00042',quantity:2}]}
  ]);
  assert.equal(plan.stockPlan.filter((p:any)=>p.type==='incoming').length,3);
  assert.ok(plan.stockPlan.filter((p:any)=>p.type==='incoming').every((p:any)=>p.note.includes('request=e1')));
  await s.ui.prepare();assert.equal(s.posts.length,1);
});
test('gom phiếu: mất phản hồi giữ nguyên mã gửi và toàn bộ dòng; retry không sinh phiếu riêng từng mã',async()=>{
  const lines=['X','Y'].map(sku=>({sku,name:sku,unit:'cái',qty:1,stock:{a:0},incoming:2})),incomingRows=lines.map(l=>({sku:l.sku,orders:[{id:'p1',ticketNumber:'DMH_001',supplierName:'NCC',quantity:2}]}));
  const s=await setup(true,{lines,incomingRows});for(const l of lines){s.label('Nguồn hàng '+l.sku).value='incoming';await s.label('Nguồn hàng '+l.sku).fire('change');s.label('Đơn mua lấy hàng '+l.sku).value='p1';}
  await assert.rejects(()=>s.ui.prepare(),/Mất kết nối/);assert.equal(s.posts.length,1);assert.throws(()=>s.ui.read(),/chưa xác định/);
  assert.equal(s.button('Tiếp tục lưu phiếu xin giao trước').hidden,false);assert.equal(s.label('Số lượng nguồn hàng X').disabled,true);
  s.recover();await s.button('Tiếp tục lưu phiếu xin giao trước').fire();
  assert.equal(s.posts.length,2);assert.deepEqual(s.posts[0].body,s.posts[1].body);
  await s.ui.prepare();assert.equal(s.posts.length,2);
});

test('gom phiếu: hai dòng cùng SKU cùng đơn mua không được vượt tổng số còn về',async()=>{
  const s=await setup(false,{lines:[{sku:'X',name:'Sản phẩm',unit:'cái',qty:4,stock:{a:0},incoming:4}]});
  s.label('Số lượng nguồn hàng X').value=2;s.label('Nguồn hàng X').value='incoming';await s.label('Nguồn hàng X').fire('change');s.label('Đơn mua lấy hàng X').value='p2';
  await s.button('＋ Thêm nguồn hàng').fire();
  const types=all(s.host).filter(n=>n.attrs['aria-label']==='Nguồn hàng X'),orders=all(s.host).filter(n=>n.attrs['aria-label']==='Đơn mua lấy hàng X');
  types[1]!.value='incoming';await types[1]!.fire('change');orders[1]!.value='p2';
  await assert.rejects(()=>s.ui.prepare(),/tổng xin mã X vượt số còn về 2/);assert.equal(s.posts.length,0);
});


test('must explicitly select a selling warehouse before goods exist, even with a single selling warehouse',async()=>{
 const s=await setup(false,{},true,'create',false),list=all(s.host).find(n=>n.className==='quote-source-list')!;
 assert.equal(s.label('Kho bán / kho xuất').value,'');assert.equal(list.hidden,true);assert.equal(list.children.length,0);assert.equal(s.label('Lấy từ kho X'),undefined);assert.match(s.host.textContent,/Chọn kho bán \/ kho xuất để xem hàng hoá/);
 assert.throws(()=>s.ui.read(),/Chọn kho bán/);await assert.rejects(()=>s.ui.prepare(),/Chọn kho bán/);assert.equal(s.posts.length,0);
 s.label('Kho bán / kho xuất').value='a';await s.label('Kho bán / kho xuất').fire('change');assert.equal(list.hidden,false);assert.equal(s.label('Lấy từ kho X').value,'2');
 s.label('Kho bán / kho xuất').value='';await s.label('Kho bán / kho xuất').fire('change');assert.equal(list.hidden,true);assert.equal(list.children.length,0);assert.throws(()=>s.ui.read(),/Chọn kho bán/);
});
test('switching selling warehouses redraws quantities from the chosen stock, non-selling warehouse cannot reveal goods',async()=>{
 const s=await setup(false,{warehouses:[{id:'a',canSell:true,name:'Kho A'},{id:'b',canSell:true,name:'Kho B'},{id:'c',canSell:false,name:'Kho C'}]},true,'create',false);
 for(const [id,qty] of [['a','2'],['b','1']]){s.label('Kho bán / kho xuất').value=id;await s.label('Kho bán / kho xuất').fire('change');assert.equal(s.label('Lấy từ kho X').value,qty);}
 s.label('Kho bán / kho xuất').value='c';await s.label('Kho bán / kho xuất').fire('change');assert.equal(s.label('Lấy từ kho X'),undefined);assert.throws(()=>s.ui.read(),/Chọn kho bán/);assert.equal(s.posts.length,0);
});
test('nguồn hàng UI: chỉ rà mã Minh Long / Lock&Lock; ghi chú mã bỏ qua; đơn toàn mã khác thì bỏ qua cả bước',async()=>{
  const mixed=await setup(false,{scopeLabel:'Minh Long / Lock&Lock',skipped:[{sku:'VG1',name:'Hộp quà',unit:'cái',qty:3}]});
  assert.match(mixed.host.textContent,/1 mã Minh Long \/ Lock&Lock · Rà số lượng/);
  assert.match(mixed.host.textContent,/1 mã ngoài Minh Long \/ Lock&Lock không cần rà nguồn: VG1\./);
  const none=await setup(false,{lines:[],scopeLabel:'Minh Long / Lock&Lock',skipped:[{sku:'VG1',name:'Hộp quà',unit:'cái',qty:3}]},true,'create',false);
  assert.match(none.host.textContent,/Đơn không có mã Minh Long \/ Lock&Lock – bỏ qua bước rà nguồn hàng\./);
  assert.equal(all(none.host).some(n=>n.attrs['aria-label']==='Kho bán / kho xuất'),false,'không bắt chọn kho');
  assert.deepEqual(JSON.parse(JSON.stringify(none.ui.read())),{});assert.deepEqual(JSON.parse(JSON.stringify(await none.ui.prepare())),{});assert.equal(none.posts.length,0);
});

test('source dates remain distinct for stock and incoming allocations; blank supplemental date stays unscheduled metadata',async()=>{
 const s=await setup();s.label('Kho xin hàng X').value='b';
 s.label('Ngày giao khách từ kho X').value='2026-11-16';s.label('Ngày giao khách nguồn bổ sung X 1').value='2026-11-19';
 let plan=s.ui.read();assert.deepEqual(JSON.parse(JSON.stringify(plan.stockPlan)).map((p:any)=>[p.qty,p.plannedDate]),[[2,'2026-11-16'],[1,'2026-11-19']]);
 s.label('Ngày giao khách nguồn bổ sung X 1').value='';plan=s.ui.read();assert.equal('plannedDate' in plan.stockPlan[1],false);
 s.label('Ngày giao khách nguồn bổ sung X 1').value='2026-02-31';assert.throws(()=>s.ui.read(),/Ngày giao khách/);
});

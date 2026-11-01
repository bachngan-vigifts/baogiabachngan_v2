import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from '../helpers/pos-fixture.ts';
import {webStoreOrders,posRegisters} from '../../src/modules/sales/pos-schema.ts';
import {readWebBridgeResult} from '../../src/modules/sales/api/web-order-bridge-result.ts';

const address={addressLine:'Đường kiểm thử',provinceId:211,provinceName:'Long An',districtId:1929,districtName:'Huyện Đức Hòa',wardCode:'490707',wardName:'Xã Đức Hòa Hạ'};
test('Bridge: phân biệt handler thiếu, địa chỉ lỗi, GHN từ chối; không ghi message/credential vào log',async t=>{
 const log=t.mock.method(console,'warn',()=>{}),token='fake-private-token';
 for(const code of ['ghn_handler_unavailable','address_invalid','ghn_rejected','ghn_response_missing_order_code','ghn_reconcile_failed','ghn_metadata_persist_failed','ghn_create_failed','ghn_empty_response']){
  await assert.rejects(()=>readWebBridgeResult(Response.json({code,message:`<b>Lỗi GHN</b> Bearer ${token}`,code_message_value:`Lý do đã làm sạch; token=${token}`},{status:503}),
   'confirm',{orderId:'21496',source:'lock'},[token]),(e:any)=>e.code===code&&e.message.includes('Lý do')&&!e.message.includes(token));
 }
 const logged=JSON.stringify(log.mock.calls.map(c=>c.arguments));assert.doesNotMatch(logged,/fake-private-token|Lý do đã làm sạch|Đường kiểm thử/);
 assert.match(logged,/hasOrderCode/);assert.match(logged,/ghn_handler_unavailable/);
 await assert.rejects(()=>readWebBridgeResult(Response.json({code:'ghn_create_failed',message:'Dịch vụ không hỗ trợ',code_message_value:' '},{status:400}),
  'confirm',{orderId:'21496',source:'lock'},[]),(e:any)=>e.message==='Dịch vụ không hỗ trợ');
});
test('Bridge: HTTP 200 rỗng/sai JSON/không có mã hợp lệ không được báo tạo thành công',async t=>{
 t.mock.method(console,'warn',()=>{});
 for(const body of ['', 'not JSON', '{}', '{"status":"processing"}', '{"ghnOrderCode":"<invalid>"}'])
  await assert.rejects(()=>readWebBridgeResult(new Response(body),'confirm',{orderId:'21496',source:'lock'},[]),(e:any)=>e.code==='ghn_response_missing_order_code');
 await assert.rejects(()=>readWebBridgeResult(Response.json({success:false,message:'Không hỗ trợ dịch vụ' }),'confirm',{orderId:'21496',source:'lock'},[]),(e:any)=>e.code==='ghn_reconcile_failed'&&e.message==='Không hỗ trợ dịch vụ');
});
test('Bridge: website lỗi 5xx/HTML không kèm lý do → báo kèm mã HTTP, không lộ nội dung phản hồi',async t=>{
 const log=t.mock.method(console,'warn',()=>{});
 await assert.rejects(()=>readWebBridgeResult(new Response('<html><body>Bad Gateway fake-secret-body</body></html>',{status:502,statusText:'Bad Gateway'}),'confirm',{orderId:'21547',source:'lock'},['fake-secret-body']),
  (e:any)=>e.code==='ghn_reconcile_failed'&&e.status===502&&e.message.includes('Chưa đối soát được kết quả GHN')&&e.message.includes('HTTP 502')&&e.message.includes('không phải JSON')&&!e.message.includes('fake-secret-body'));
 await assert.rejects(()=>readWebBridgeResult(Response.json({ok:false},{status:500}),'confirm',{orderId:'21547',source:'lock'},[]),
  (e:any)=>e.message.includes('HTTP 500')&&e.message.includes('JSON không kèm lý do'));
 // A real reason from the website is still shown as-is, without the HTTP hint.
 await assert.rejects(()=>readWebBridgeResult(Response.json({code:'ghn_rejected',message:'GHN: sai quận'},{status:409}),'confirm',{orderId:'21547',source:'lock'},[]),(e:any)=>e.message==='GHN: sai quận');
 assert.doesNotMatch(JSON.stringify(log.mock.calls.map(c=>c.arguments)),/fake-secret-body|Bad Gateway/);
});
async function fixture(){
 const f=await setup();let calls=0;const wire:any[]=[];
 await f.db.update(posRegisters).set({name:'CỬA HÀNG LOCKNLOCK CẦN THƠ'}).where(eq(posRegisters.id,f.registerId));
 const imported=await f.call('/integrations/woocommerce/lock/order?token=test-lock-token','', 'POST',{id:21496,number:'21496',status:'pending',total:'100000',billing:{first_name:'Khách kiểm thử',phone:'0901234567'},line_items:[{sku:'00123',name:'Ly',quantity:1,total:'100000'}]});
 assert.equal(imported.status,200,JSON.stringify(imported.data));
 const [order]=await f.db.select().from(webStoreOrders);
 const reply={next:()=>Response.json({status:'processing',ghnOrderCode:'GHN21496',ghnSortCode:'SORT',ghnFee:22000})};
 f.env.webOrderAction={token:'fake-bridge-token',lockUrl:'https://lock.test/bridge',minhlongUrl:'',fetch:(async(_url,init)=>{calls++;wire.push(JSON.parse(String(init?.body)));return reply.next();}) as typeof fetch};
 const act=(body:Record<string,unknown>)=>f.call(`/pos/web-orders/${order!.id}/action`,f.mgr,'POST',body);
 const row=async()=>(await f.db.select().from(webStoreOrders).where(eq(webStoreOrders.id,order!.id)))[0]!;
 return{...f,order:order!,reply,act,row,wire,get calls(){return calls;}};
}
test('CRM: mã lỗi GHN giữ nguyên; lỗi không đổi dữ liệu khách/COD/sản phẩm/địa chỉ; thành công lưu mã và replay không gọi bridge',async t=>{
 t.mock.method(console,'warn',()=>{});const f=await fixture(),before=await f.row();
 for(const code of ['ghn_handler_unavailable','address_invalid','ghn_rejected','ghn_response_missing_order_code','ghn_reconcile_failed','ghn_metadata_persist_failed','ghn_create_failed']){
  f.reply.next=()=>Response.json({code,message:'Lý do cụ thể từ website'},{status:400});
  const res=await f.act({action:'confirm',...address});assert.equal(res.data.code,code);assert.equal(res.data.error,'Lý do cụ thể từ website');assert.deepEqual(await f.row(),before);
 }
 f.reply.next=()=>Response.json({status:'processing'});
 assert.equal((await f.act({action:'confirm',...address})).data.code,'ghn_response_missing_order_code');assert.deepEqual(await f.row(),before);
 // A carrier code is not confirmation success when Woo could not persist/verify it.
 f.reply.next=()=>Response.json({ok:true,code:'ghn_metadata_persist_failed',ghnOrderCode:'GHN21496'});
 const unsaved=await f.act({action:'confirm',...address});assert.equal(unsaved.data.code,'ghn_metadata_persist_failed');assert.match(unsaved.data.error,/không tạo vận đơn mới/);assert.deepEqual(await f.row(),before);
 f.reply.next=()=>Response.json({status:'processing',ghnOrderCode:'GHN21496',ghnSortCode:'SORT',ghnFee:22000});
 const made=await f.act({action:'confirm',...address});assert.equal(made.status,200,JSON.stringify(made.data));assert.equal((await f.row()).ghnOrderCode,'GHN21496');
 const count=f.calls,replay=await f.act({action:'confirm',...address});assert.equal(replay.data.existing,true);assert.equal(replay.data.ghnOrderCode,'GHN21496');assert.equal(f.calls,count);
 const after=await f.row();for(const field of ['customerName','phone','total','lines','financialSnapshot'] as const)assert.equal(after[field],before[field]);
 await f.db.update(webStoreOrders).set({ghnOrderCode:'invalid stored code'}).where(eq(webStoreOrders.id,f.order.id));
 assert.equal((await f.act({action:'confirm',...address})).status,409);assert.equal(f.calls,count,'mã lưu sai cũng không được tạo lại');
});
test('CRM: ward sai district hoặc district sai province bị chặn trước bridge; GHN live được ưu tiên bản đóng gói',async()=>{
 const f=await fixture();
 for(const bad of [{...address,wardCode:'not-in-district'},{...address,provinceId:220}]){
  const r=await f.act({action:'confirm',...bad});assert.equal(r.data.code,'address_invalid');assert.equal(f.calls,0);
 }
 const lookups:string[]=[];f.env.ghnToken='fake-ghn-token';
 f.env.ghnFetch=(async(url)=>{lookups.push(String(url));return Response.json({code:200,data:String(url).includes('/district')?[{DistrictID:1929,DistrictName:'Huyện Đức Hòa'}]:[{WardCode:'NEW-WARD',WardName:'Xã mới'}]});}) as typeof fetch;
 assert.equal((await f.act({action:'confirm',...address})).data.code,'address_invalid');assert.equal(f.calls,0);
 assert.equal(lookups.length,2);
 assert.equal((await f.act({action:'confirm',...address,wardCode:'NEW-WARD'})).status,200);assert.equal(f.calls,1);
});
test('CRM: lỗi master-data và timeout bridge không bị gán thành lỗi địa chỉ; không ghi thành công giả',async()=>{
 const f=await fixture(),before=await f.row();f.env.ghnToken='fake-ghn';
 f.env.ghnFetch=(async()=>{throw Error('network');}) as typeof fetch;
 assert.equal((await f.act({action:'confirm',...address})).data.code,'ghn_reconcile_failed');assert.equal(f.calls,0);
 f.env.ghnToken=undefined;f.reply.next=()=>{throw Error('timeout');};
 const r=await f.act({action:'confirm',...address});assert.equal(r.data.code,'ghn_reconcile_failed');assert.match(r.data.error,/Tra cứu vận đơn/);
 assert.deepEqual(await f.row(),before);assert.equal(f.calls,1);
});

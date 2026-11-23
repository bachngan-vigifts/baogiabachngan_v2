// CHỐNG TẠO TRÙNG ĐƠN MUA NCC KHI GỬI LẠI (kiểm toán CRM 21/11 – ưu tiên 3).
// Mã thao tác (clientKey) ổn định theo người dùng + băm nội dung, máy chủ lưu kết quả:
// - mất phản hồi rồi gửi lại cùng mã + cùng nội dung → trả đúng bộ ID cũ, không tạo thêm;
// - cùng mã nhưng nội dung khác → 409;
// - hai lần tạo chủ động (hai mã khác nhau) cùng nội dung vẫn được hai đơn;
// - mã của người khác không đọc được kết quả của mình; vẫn giữ kiểm tra quyền, khoá nguồn và giới hạn số lượng.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {incomingShipments} from '../../src/modules/suppliers/schema.ts';
import {products} from '../../src/modules/catalog/schema.ts';

const order=(qty=5,supplierId='a')=>({supplierId,warehouse:'Kho nhận',note:'Mua bù kho',lines:[{sku:'0001',name:'Ly',unit:'Cái',quantity:qty}]});
const created=async(f:Awaited<ReturnType<typeof setupEarly>>)=>(await f.db.select({id:incomingShipments.id}).from(incomingShipments).where(eq(incomingShipments.source,'supplier-order'))).length;

test('gửi lại cùng mã + cùng nội dung (mất phản hồi) → cùng bộ ID, không tạo đơn thứ hai',async()=>{
 const f=await setupEarly(),c=f.cookies,before=await created(f),clientKey=crypto.randomUUID();
 const body={clientKey,orders:[order(5,'a'),order(3,'b')]};
 const first=await f.call('/purchase-orders',c.sa,'POST',body);assert.equal(first.status,201,JSON.stringify(first.data));assert.equal(first.data.ids.length,2);
 const again=await f.call('/purchase-orders',c.sa,'POST',body);assert.ok([200,201].includes(again.status),JSON.stringify(again.data));
 assert.deepEqual(again.data.ids,first.data.ids,'cùng bộ ID');assert.equal(again.data.replayed,true);
 assert.equal(await created(f),before+2,'chỉ 2 đơn');
});

test('cùng mã nhưng khác nội dung → 409, không tạo gì thêm',async()=>{
 const f=await setupEarly(),c=f.cookies,clientKey=crypto.randomUUID();
 assert.equal((await f.call('/purchase-orders',c.sa,'POST',{clientKey,orders:[order(5)]})).status,201);
 const n=await created(f);
 for(const changed of [[order(6)],[order(5,'b')],[{...order(5),note:'Khác'}],[order(5),order(1,'b')]]){
  const r=await f.call('/purchase-orders',c.sa,'POST',{clientKey,orders:changed});
  assert.equal(r.status,409,JSON.stringify(r.data));assert.equal(r.data.code,'INTENT_MISMATCH');
 }
 assert.equal(await created(f),n);
});

test('hai lần tạo mới chủ động (hai mã khác nhau) cùng nội dung → hai đơn; không gửi mã vẫn chạy như cũ',async()=>{
 const f=await setupEarly(),c=f.cookies,before=await created(f);
 const a=await f.call('/purchase-orders',c.sa,'POST',{clientKey:crypto.randomUUID(),orders:[order()]});
 const b=await f.call('/purchase-orders',c.sa,'POST',{clientKey:crypto.randomUUID(),orders:[order()]});
 assert.equal(a.status,201);assert.equal(b.status,201);assert.notDeepEqual(a.data.ids,b.data.ids);
 const legacy=await f.call('/purchase-orders',c.sa,'POST',{orders:[order()]});assert.equal(legacy.status,201,'giao diện cũ (chưa gửi mã) vẫn dùng được trong lúc triển khai');
 assert.equal(await created(f),before+3);
});

test('mã thuộc về từng người: người khác dùng lại mã không nhận được đơn của mình; mã sai định dạng bị từ chối',async()=>{
 const f=await setupEarly(),c=f.cookies,clientKey=crypto.randomUUID();
 const mine=await f.call('/purchase-orders',c.sa,'POST',{clientKey,orders:[order()]});assert.equal(mine.status,201);
 const other=await f.call('/purchase-orders',c.mgr,'POST',{clientKey,orders:[order()]});assert.equal(other.status,201);
 assert.notDeepEqual(other.data.ids,mine.data.ids,'Manager dùng cùng chuỗi mã → đơn riêng, không lộ ID của nhân viên');
 for(const bad of ['short',123,'x'.repeat(201)])assert.equal((await f.call('/purchase-orders',c.sa,'POST',{clientKey:bad,orders:[order()]})).status,400);
});

test('vẫn giữ kiểm tra quyền và dữ liệu: không quyền → 403, dòng sai → 400, kể cả khi gửi lại mã cũ',async()=>{
 const f=await setupEarly(),c=f.cookies,clientKey=crypto.randomUUID();
 assert.equal((await f.call('/purchase-orders',c.ncc,'POST',{clientKey,orders:[order()]})).status,403);
 assert.equal((await f.call('/purchase-orders',c.sa,'POST',{clientKey,orders:[{...order(),lines:[]}]})).status,400);
 // Lỗi kiểm tra không "đốt" mã: sửa lại nội dung đúng với cùng mã vẫn tạo được.
 assert.equal((await f.call('/purchase-orders',c.sa,'POST',{clientKey,orders:[order()]})).status,201);
});

test('gửi lại đơn có nguồn báo giá sau khi đã lưu → trả ID cũ (không báo vượt số cần đặt); mã mới thì vẫn bị chặn vượt số',async()=>{
 const f=await setupEarly(),c=f.cookies;
 await f.db.insert(products).values({sku:'LY1',name:'Ly sứ',unit:'cái',updatedAt:'2026-10-01T00:00:00Z'}).onConflictDoNothing();
 const q=await f.call('/quotes',c.sa,'POST',{type:'B2B',quoteNo:'BG_INTENT',customer:'Khách intent',vat:8,rows:[{name:'Ly sứ',sku:'LY1',unit:'cái',qty:10,price:1000}]});assert.equal(q.status,201,JSON.stringify(q.data));
 assert.equal((await f.call(`/quotes/${q.data.id}/approve`,c.mgr,'POST',{revision:1})).status,200);
 const sourced={supplierId:'a',warehouse:'Kho nhận',lines:[{sku:'LY1',quantity:10,sources:[{type:'quote',id:q.data.id,quantity:10}]}]};
 const clientKey=crypto.randomUUID(),first=await f.call('/purchase-orders',c.sa,'POST',{clientKey,orders:[sourced]});assert.equal(first.status,201,JSON.stringify(first.data));
 const again=await f.call('/purchase-orders',c.sa,'POST',{clientKey,orders:[sourced]});assert.deepEqual(again.data.ids,first.data.ids,JSON.stringify(again.data));
 const fresh=await f.call('/purchase-orders',c.sa,'POST',{clientKey:crypto.randomUUID(),orders:[sourced]});assert.equal(fresh.status,409,'giới hạn số cần đặt vẫn giữ');
});

test('hai lần gửi cùng mã chạy song song → một bộ đơn (PGlite chạy tuần tự; PostgreSQL nhiều kết nối dùng TEST_PG_URL)',async()=>{
 const f=await setupEarly(),c=f.cookies,before=await created(f),body={clientKey:crypto.randomUUID(),orders:[order()]};
 const [x,y]=await Promise.all([f.call('/purchase-orders',c.sa,'POST',body),f.call('/purchase-orders',c.sa,'POST',body)]);
 assert.ok([x,y].every(r=>[200,201].includes(r.status)),JSON.stringify([x.data,y.data]));assert.deepEqual(x.data.ids,y.data.ids);
 assert.equal(await created(f),before+1);
});

test('giao diện: createPurchaseOrders giữ mã khi chưa rõ kết quả (đóng/mở lại form nhập y hệt), đổi mã sau khi máy chủ xác nhận',async()=>{
 // @ts-ignore – module giao diện thuần JS
 const {createPurchaseOrders}=await import('../../trial-ui/purchase-order-create.js');
 // @ts-ignore
 const {resetRequestKeys}=await import('../../trial-ui/request-keys.js');resetRequestKeys();
 const store=new Map<string,string>(),storage=()=>({getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>void store.set(k,v)});
 const sent:any[]=[],orders=[order()];let fail=true;
 const api=async(path:string,method:string,body:any)=>{sent.push([path,method,body]);if(fail)throw Object.assign(Error('mạng'),{status:0,code:'OUTCOME_UNKNOWN'});return {ids:['po-1']};};
 await assert.rejects(createPurchaseOrders(api,orders,storage));
 fail=false;assert.deepEqual(await createPurchaseOrders(api,structuredClone(orders),storage),{ids:['po-1']});
 assert.equal(sent[0][0],'/purchase-orders');assert.equal(sent[0][1],'POST');assert.deepEqual(sent[0][2].orders,orders);
 assert.equal(sent[1][2].clientKey,sent[0][2].clientKey,'gửi lại cùng mã');
 await createPurchaseOrders(api,orders,storage);assert.notEqual(sent[2][2].clientKey,sent[0][2].clientKey,'lập lần mới chủ động → mã mới');
});

test('giao diện: mọi nơi lập đơn mua NCC đều gửi mã thao tác',async()=>{
 const {readFileSync,readdirSync}=await import('node:fs');
 const dir=new URL('../../trial-ui/',import.meta.url);
 for(const f of readdirSync(dir).filter(f=>f.endsWith('.js')&&f!=='purchase-order-create.js')){
  const src=readFileSync(new URL(f,dir),'utf8');
  assert.doesNotMatch(src,/api\(\s*'\/purchase-orders'\s*,\s*'POST'\s*,\s*\{\s*orders/,f+': gọi POST /purchase-orders thiếu mã thao tác');
 }
 assert.match(readFileSync(new URL('quote-sourcing.js',dir),'utf8'),/api\('\/purchase-orders','POST',\{clientKey:purchaseKeys\.get\(k\),orders\}\)/);
});

test('replay trước khi kiểm NCC: ngừng NCC sau tạo không làm mất kết quả; nội dung khác vẫn 409',async()=>{
 const f=await setupEarly(),clientKey=crypto.randomUUID(),body={clientKey,orders:[order()]};
 const first=await f.call('/purchase-orders',f.cookies.sa,'POST',body);assert.equal(first.status,201);
 const {suppliers}=await import('../../src/modules/suppliers/schema.ts');await f.db.update(suppliers).set({active:false}).where(eq(suppliers.id,'a'));
 const replay=await f.call('/purchase-orders',f.cookies.sa,'POST',body);assert.equal(replay.status,200,JSON.stringify(replay.data));assert.deepEqual(replay.data.ids,first.data.ids);
 assert.equal((await f.call('/purchase-orders',f.cookies.sa,'POST',{...body,orders:[order(6)]})).status,409);
 assert.equal((await f.call('/purchase-orders',f.cookies.sa,'POST',{...body,clientKey:crypto.randomUUID()})).status,409,'lập mới vẫn kiểm NCC');
});

test('thiếu supplierId báo Chọn nhà cung cấp trước lỗi trùng NCC; không tạo đơn',async()=>{
 const f=await setupEarly(),before=await created(f);
 for(const ids of [[null,null],[undefined,undefined],['',''],[' ',' '],[42,null],[{id:'a'},null],['a',null]]){
  const r=await f.call('/purchase-orders',f.cookies.sa,'POST',{clientKey:crypto.randomUUID(),orders:ids.map(supplierId=>({...order(),supplierId}))});
  assert.equal(r.status,400,JSON.stringify(r.data));assert.equal(r.data.error,'Chọn nhà cung cấp.',JSON.stringify(ids));assert.equal(await created(f),before);
 }
 const duplicate=await f.call('/purchase-orders',f.cookies.sa,'POST',{clientKey:crypto.randomUUID(),orders:[order(),order(3)]});
 assert.equal(duplicate.status,400);assert.match(duplicate.data.error,/Mỗi nhà cung cấp chỉ một đơn/);assert.equal(await created(f),before);
});

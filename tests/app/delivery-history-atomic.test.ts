import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq,sql} from 'drizzle-orm';
import {fixture,ok,photo} from '../helpers/warehouse-lifecycle-fixture.ts';
import {setup as posSetup} from '../helpers/pos-fixture.ts';
import {deliveries,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {productMovements} from '../../src/modules/catalog/schema.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';

/** Lịch sử "Giao hàng" ghi cùng giao dịch với "Đã giao": lỗi ghi lịch sử thì cả bước giao huỷ theo; GHN báo đã giao cũng có lịch sử. */
test('ghi lịch sử lỗi → "Đã giao" rollback toàn bộ (chuyến, số đã giao, sổ kho); bình thường thì có lịch sử ngay',async()=>{
 const f=await fixture(),c=f.cookies;
 ok(await f.call('/purchase-orders/a1/receipts',c.kho,'POST',{clientKey:crypto.randomUUID(),warehouse:'KHO VIGIFTS',createSapo:false,lines:[{lineId:'line-a1',goodQty:5}]}),201);
 for(const i of [0,1]){const p=await f.pack(i);ok(await f.call('/packing/'+p.id+'/confirm',c.kho,'POST',{warehouseId:'vig',photos:[photo]}));}
 ok(await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'in_transit'}));
 const moves=(await f.db.select().from(stockMoves)).length;
 // Giả lập ghi lịch sử thất bại: chặn ghi bảng lịch sử sản phẩm.
 await f.db.execute(sql`create or replace function block_history() returns trigger language plpgsql as $$ begin raise exception 'history down'; end $$`);
 await f.db.execute(sql`create trigger block_history before insert on product_movements for each row execute function block_history()`);
 const failed=await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'delivered'});
 assert.ok(failed.status>=500,JSON.stringify(failed.data));
 assert.equal((await f.db.select().from(deliveries).where(eq(deliveries.id,f.trip.id)))[0]!.status,'in_transit','chuyến chưa thành đã giao');
 assert.ok((await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,f.order.id))).every(l=>l.deliveredQty===0),'số đã giao không đổi');
 assert.equal((await f.db.select().from(stockMoves)).length,moves);
 await f.db.execute(sql`drop trigger block_history on product_movements`);
 ok(await f.call(`/deliveries/${f.trip.id}/status`,c.emp,'PUT',{status:'delivered'}));
 const hist=(await f.db.select().from(productMovements)).filter(m=>m.kind==='delivery');
 assert.deepEqual(hist.map(h=>h.qty).sort(),[2,3],'mỗi dòng đơn một dòng lịch sử giao');
});

test('POS Ship COD: GHN báo đã giao → có lịch sử "Giao hàng"; GHN gửi lặp không nhân đôi',async()=>{
 const f=await posSetup(),shift=await f.open();
 const made=await f.call('/pos/checkout',f.emp,'POST',f.cart(shift.id,{fulfillmentMode:'cod',delivery:{address:'123 Test',receiverName:'Khách',receiverPhone:'0901234567',plannedDate:'2026-10-22'},note:'GHN-HISTORY1',depositAmount:0}));
 assert.equal(made.status,201,JSON.stringify(made.data));
 f.env.ghnWebhookToken='w'.repeat(40);
 const send=(Status:string)=>f.call('/integrations/ghn/pos-lock/webhook?token='+'w'.repeat(40),'','POST',{OrderCode:'HISTORY1',Status,ShopID:6096731,Time:new Date().toISOString()});
 assert.equal((await send('picked')).status,200);
 assert.equal((await send('delivered')).status,200);assert.equal((await send('delivered')).status,200);
 const hist=(await f.db.select().from(productMovements)).filter(m=>m.kind==='delivery');
 assert.equal(hist.length,1);assert.equal(hist[0]!.status,'Đã giao');
});

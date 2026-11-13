import test from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {readFileSync} from 'node:fs';
import {promotionFixture,PROGRAM,GIFT} from '../helpers/pos-promotion-fixture.ts';
import {calculateCart,reservedBySku} from '../../src/modules/sales/api/pos-store.ts';
import {productPrices} from '../../src/modules/catalog/schema.ts';
import {posPromotionPrograms} from '../../src/modules/sales/promotion-schema.ts';
import {salesOrders,salesOrderLines,customerPayments,deliveries} from '../../src/modules/sales/schema.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {cashDrawers} from '../../src/modules/sales/cash-schema.ts';
import {posRegisters,posPaymentRequests} from '../../src/modules/sales/pos-schema.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};

test('gift eligibility uses strictly greater post-discount/VAT goods; fees cannot qualify; register scoping and manager versioned configuration',async()=>{
 const f=await promotionFixture();
 const preview=async(extra={})=>ok(await f.call('/pos/preview',f.emp,'POST',f.body(extra)));
 const p=await preview();assert.equal(p.total,1080000);assert.equal(p.promotion.applied,true);assert.equal(p.lines[1].sku,GIFT);assert.equal(p.lines[1].total,0);
 assert.equal((await f.call('/pos/promotions?registerId='+f.registerId,f.other)).status,403,'Lock cashier cannot read Minh Long program');
 assert.equal((await f.call('/pos/promotions?registerId='+f.registerId)).status,401);
 assert.equal((await preview({rows:[{sku:'00123',qty:9}],shippingFee:200000})).promotion.applied,false);
 assert.equal((await preview({voucher:{code:'TEST',type:'amount',value:100000}})).promotion.applied,false);
 assert.equal((await preview({promotionOptOutReason:'Khách từ chối nhận quà'})).lines.length,1);
 assert.equal((await f.call('/pos/preview',f.emp,'POST',f.body({promotionOptOutReason:'x'}))).status,400);
 await f.db.update(productPrices).set({price:1000000}).where(and(eq(productPrices.sku,'00123'),eq(productPrices.policyId,'retail-vat')));
 assert.equal((await preview({rows:[{sku:'00123',qty:1}]})).promotion.applied,false,'equal threshold is not eligible');
 await f.db.update(productPrices).set({price:1000001}).where(and(eq(productPrices.sku,'00123'),eq(productPrices.policyId,'retail-vat')));
 assert.equal((await preview({rows:[{sku:'00123',qty:1}]})).promotion.applied,true);
 await f.db.insert(cashDrawers).values({id:'other-store-drawer',name:'Két Lock kiểm thử',updatedAt:new Date().toISOString()});
 const other=ok(await f.call('/pos/registers',f.mgr,'POST',{name:'CỬA HÀNG LOCKNLOCK CẦN THƠ',cashDrawerId:'other-store-drawer',warehouseId:'pos-wh',pricePolicyId:'retail-vat',secondPricePolicyId:'retail',taxRate:8}));
 await f.db.update(posRegisters).set({cashDrawerId:'other-store-drawer'}).where(eq(posRegisters.id,other.id));
 const unrelated=await calculateCart(f.db,f.body({registerId:other.id,rows:[{sku:'00123',qty:1}]}));assert.equal(unrelated.promotion,null);assert.equal(unrelated.lines.length,1);
 assert.equal((await f.call('/pos/promotions/'+f.registerId,f.emp,'PUT',{...PROGRAM,revision:1})).status,403);
 assert.equal((await f.call('/pos/promotions/'+f.registerId,f.ncc,'PUT',{...PROGRAM,revision:1})).status,403);
 assert.equal((await f.call('/pos/promotions/'+f.registerId,f.mgr,'PUT',PROGRAM)).status,409);
 assert.equal((await f.call('/pos/promotions/'+f.registerId,f.mgr,'PUT',{...PROGRAM,revision:1,giftSku:'BAD'})).status,400);
 const next=ok(await f.call('/pos/promotions/'+f.registerId,f.mgr,'PUT',{...PROGRAM,revision:1,enabled:false}));assert.equal(next.program.revision,2);assert.equal((await preview()).promotion.applied,false);
 assert.equal((await f.call('/pos/checkout',f.emp,'POST',f.body({rows:[{sku:'00123',qty:1}]}))).data.code,'POS_PROMOTION_CHANGED');
 // Re-run only the seed statement on synthetic data: default applies to the exact verified showroom, never Lock.
 await f.db.delete(posPromotionPrograms);
 const migration=readFileSync('migrations/postgres/20261113054030_pos_promotion_programs.sql','utf8');await f.client.exec(migration.slice(migration.indexOf('INSERT INTO')));
 const seeded=await f.db.select().from(posPromotionPrograms);assert.equal(seeded.length,1);assert.equal(seeded[0]!.registerId,f.registerId);assert.equal(seeded[0]!.giftSku,GIFT);
 const declined=ok(await f.call('/pos/checkout',f.emp,'POST',f.body({rows:[{sku:'00123',qty:1}],promotionOptOutReason:'Khách từ chối nhận quà'})),201);
 assert.equal(declined.promotion.applied,false);assert.equal(declined.promotion.optOutReason,'Khách từ chối nhận quà');assert.equal(declined.lines.length,1);
 assert.equal((await f.db.select().from(stockBalances)).find(b=>b.sku===GIFT)!.qty,10,'declined gift does not issue stock');
});

test('COD reserves and dispatches both paid/gift quantities once; only monetary lines affect COD and manager edits preserve the gift snapshot',async()=>{
 const f=await promotionFixture();
 const body=f.body({fulfillmentMode:'cod',rows:[{sku:'00123',qty:9},{sku:GIFT,qty:1}],delivery:{address:'123 Đường kiểm thử',receiverName:'Khách kiểm thử',receiverPhone:'0901234567',plannedDate:'2026-11-13'}});
 const done=ok(await f.call('/pos/checkout',f.emp,'POST',body),201);assert.equal(done.total,1080000);
 assert.equal((await reservedBySku(f.db,[GIFT],'pos-wh')).get(GIFT),2);
 assert.equal((await f.db.select().from(stockBalances)).find(b=>b.sku===GIFT)!.qty,10,'COD has not issued yet');
 const order=(await f.db.select().from(salesOrders).where(eq(salesOrders.id,done.id)))[0]!;
 ok(await f.call('/orders/'+done.id+'/pos',f.mgr,'PUT',{revision:order.revision,reason:'Cập nhật ghi chú đơn có quà',note:'Giao cùng quà khuyến mãi'}));
 const detail=ok(await f.call('/orders/'+done.id,f.mgr));
 const edited=await f.call('/orders/'+done.id+'/pos',f.mgr,'PUT',{revision:detail.order.revision,reason:'Thử thay đổi hàng khuyến mãi',lines:detail.lines.map((l:any)=>({id:l.id,qty:l.qty+1,price:l.listUnitPrice??l.unitPrice,discountType:l.discountType,discountValue:l.discountValue}))});assert.equal(edited.data.code,'POS_PROMOTION_LOCKED');
 const [ship]=await f.db.select().from(deliveries).where(eq(deliveries.orderId,done.id));assert.equal(ship!.codAmount,1080000);
 ok(await f.call('/deliveries/'+ship!.id+'/status',f.mgr,'PUT',{status:'delivered'}));
 assert.equal((await f.db.select().from(stockBalances)).find(b=>b.sku===GIFT)!.qty,8);
 const after=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,done.id));assert.ok(after.every(l=>l.deliveredQty===l.qty));
});

test('checkout includes the free gift atomically, aggregates sold+gift same SKU stock, preserves QR fingerprint and replays without a second issue',async()=>{
 const f=await promotionFixture(),body=f.body({rows:[{sku:'00123',qty:9},{sku:GIFT,qty:1}]});
 const before=ok(await f.call('/pos/preview',f.emp,'POST',body));assert.equal(before.lines.filter((l:any)=>l.sku===GIFT).length,2);assert.equal(before.total,1080000);
 const done=ok(await f.call('/pos/checkout',f.emp,'POST',body),201);assert.equal(done.total,before.total);assert.equal(done.lines.at(-1).isPromotionGift,true);assert.equal(done.promotion.revision,1);
 const balances=await f.db.select().from(stockBalances);assert.equal(balances.find(b=>b.sku===GIFT)!.qty,8);
 const lines=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,done.id));assert.equal(lines.length,3);assert.equal(lines.at(-1)!.amount,0);assert.equal(lines.at(-1)!.deliveredQty,1);
 const replay=ok(await f.call('/pos/checkout',f.emp,'POST',body),201);assert.equal(replay.replayed,true);
 assert.equal((await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,done.id))).length,1);
 assert.equal((await f.db.select().from(stockMoves).where(and(eq(stockMoves.refId,done.id),eq(stockMoves.sku,GIFT)))).length,1);
 const bill=ok(await f.call('/pos/bills/'+done.id,f.emp));assert.equal(bill.promotion.giftSku,GIFT);
 // Full cancellation returns both paid and gifted quantities but only refunds money actually paid.
 const path='/pos/orders/'+done.id+'/quick-cancel',cancelPreview=ok(await f.call(path,f.mgr));
 ok(await f.call(path,f.mgr,'POST',{key:crypto.randomUUID(),revision:cancelPreview.revision,shiftId:f.shift.id,reason:'Kiểm thử hủy bill có quà, nhận lại đủ hàng',confirmed:true,reference:''}));
 assert.equal((await f.db.select().from(stockBalances)).find(b=>b.sku===GIFT)!.qty,10);
});

test('gift shortages roll back the entire sale; return below threshold requires gift and gift has zero refund',async()=>{
 const f=await promotionFixture();await f.db.update(stockBalances).set({qty:0}).where(eq(stockBalances.sku,GIFT));
 const failed=await f.call('/pos/checkout',f.emp,'POST',f.body());assert.equal(failed.status,409);assert.equal(failed.data.code,'POS_STOCK_SHORT');assert.equal((await f.db.select().from(salesOrders)).length,0);
 await f.db.update(stockBalances).set({qty:10}).where(eq(stockBalances.sku,GIFT));
 const done=ok(await f.call('/pos/checkout',f.emp,'POST',f.body()),201),lines=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,done.id));
 const paid=lines.find(l=>l.sku==='00123')!,gift=lines.find(l=>l.sku===GIFT)!;
 const request={key:crypto.randomUUID(),orderId:done.id,shiftId:f.shift.id,reason:'Khách trả hàng có quà tặng',lines:[{orderLineId:paid.id,qty:1}]};
 const denied=await f.call('/pos/returns',f.emp,'POST',request);assert.equal(denied.data.code,'POS_GIFT_RETURN_REQUIRED');
 const returned=ok(await f.call('/pos/returns',f.emp,'POST',{...request,lines:[...request.lines,{orderLineId:gift.id,qty:1}]}),201);
 ok(await f.call('/pos/returns/'+returned.id+'/approve',f.mgr,'POST',{}));
 const detail=ok(await f.call('/pos/returns?orderId='+done.id,f.emp));assert.ok(detail);
 ok(await f.call('/pos/returns/'+returned.id+'/receive',f.emp,'POST',{shiftId:f.shift.id,confirmed:true}));
 assert.equal(returned.total,108000,'gift does not increase refund');
});

test('QR amount excludes the gift and configuration changes invalidate stale checkout without issuing stock or duplicating receipts',async()=>{
 const f=await promotionFixture(),body=f.body();
 const preview=ok(await f.call('/pos/preview',f.emp,'POST',body)),qr=ok(await f.call('/pos/qr',f.emp,'POST',body));
 const [request]=await f.db.select().from(posPaymentRequests).where(eq(posPaymentRequests.id,qr.id));assert.equal(request!.amount,preview.total);assert.equal(request!.fingerprint,preview.fingerprint);
 const paid=ok(await f.call('/pos/checkout',f.emp,'POST',{...body,method:'transfer',confirmed:true,paymentRequestId:qr.id}),201);
 assert.equal(paid.promotion.applied,true);assert.equal(paid.total,1080000);
 assert.equal((await f.db.select().from(customerPayments).where(eq(customerPayments.orderId,paid.id)))[0]!.paymentSource,'vietqr');
 ok(await f.call('/pos/promotions/'+f.registerId,f.mgr,'PUT',{...PROGRAM,revision:1,giftQty:2}));
 assert.equal((await f.call('/pos/checkout',f.emp,'POST',f.body())).data.code,'POS_PROMOTION_CHANGED');
 const replay=ok(await f.call('/pos/checkout',f.emp,'POST',{...body,method:'transfer',confirmed:true,paymentRequestId:qr.id}),201);assert.equal(replay.replayed,true);assert.equal(replay.promotion.giftQty,1,'saved bill retains original program');
});

test('a paid QR remains detectable after changing the free program; cash checkout cannot collect the same cart again',async()=>{
 const f=await promotionFixture(),body=f.body(),qr=ok(await f.call('/pos/qr',f.emp,'POST',body));
 const original=(await f.db.select().from(posPaymentRequests).where(eq(posPaymentRequests.id,qr.id)))[0]!;
 await f.db.update(posPaymentRequests).set({confirmedAt:new Date().toISOString()}).where(eq(posPaymentRequests.id,qr.id));
 ok(await f.call('/pos/promotions/'+f.registerId,f.mgr,'PUT',{...PROGRAM,revision:1,giftQty:2}));
 const next=ok(await f.call('/pos/preview',f.emp,'POST',{...body,promotionRevision:2}));assert.equal(next.fingerprint,original.fingerprint);
 const refused=await f.call('/pos/checkout',f.emp,'POST',{...body,promotionRevision:2});assert.equal(refused.data.code,'POS_QR_ALREADY_PAID');assert.equal((await f.db.select().from(salesOrders)).length,0);
 const paid=ok(await f.call('/pos/checkout',f.emp,'POST',{...body,promotionRevision:2,method:'transfer',confirmed:true}),201);assert.equal(paid.promotion.giftQty,2);
 assert.equal((await f.db.select().from(customerPayments))[0]!.amount,1080000);assert.equal((await f.db.select().from(stockBalances)).find(b=>b.sku===GIFT)!.qty,8);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {eq,inArray} from 'drizzle-orm';
import {splitDeliveryFixture} from '../helpers/split-delivery-fixture.ts';
import {deliveries,deliveryLines,packingSlips,salesOrders} from '../../src/modules/sales/schema.ts';
import {ensurePackingSchedule} from '../../src/modules/sales/api/delivery-store.ts';

test('multiple legacy undated slips never guess a combined trip; an explicit trip remains unchanged',async()=>{
 const f=await splitDeliveryFixture(),trips=await f.db.select().from(deliveries).where(eq(deliveries.orderId,f.id));
 await f.db.delete(deliveryLines).where(inArray(deliveryLines.deliveryId,trips.map(t=>t.id)));await f.db.delete(deliveries).where(eq(deliveries.orderId,f.id));
 await f.db.update(packingSlips).set({planSource:null,plannedDeliveryDate:null}).where(eq(packingSlips.orderId,f.id));
 await f.db.transaction(tx=>ensurePackingSchedule(tx,f.id,'emp'));assert.equal((await f.db.select().from(deliveries).where(eq(deliveries.orderId,f.id))).length,0);
 const made=await f.call('/deliveries',f.emp,'POST',{orderId:f.id,plannedDate:'2026-11-16',lines:[{orderLineId:'split-line',qty:170}],clientKey:crypto.randomUUID()});assert.equal(made.status,201,JSON.stringify(made.data));
 await f.db.transaction(tx=>ensurePackingSchedule(tx,f.id,'emp'));
 const kept=await f.db.select().from(deliveryLines).where(eq(deliveryLines.deliveryId,made.data.id));assert.equal(kept[0]!.qty,170);
});

test('explicit source dates override stale overall estimate and are sorted before numbering/scheduling',async()=>{
 const f=await splitDeliveryFixture(),trips=await f.db.select().from(deliveries).where(eq(deliveries.orderId,f.id));
 await f.db.delete(deliveryLines).where(inArray(deliveryLines.deliveryId,trips.map(t=>t.id)));await f.db.delete(deliveries).where(eq(deliveries.orderId,f.id));
 await f.db.update(packingSlips).set({plannedDeliveryDate:'2026-11-20'}).where(eq(packingSlips.orderId,f.id));
 const first=await f.db.transaction(tx=>ensurePackingSchedule(tx,f.id,'emp'));assert.equal(first!.plannedDate,'2026-11-20');
 assert.equal((await f.db.select().from(salesOrders).where(eq(salesOrders.id,f.id)))[0]!.expectedDeliveryDate,'2026-11-20');
 assert.equal((await f.db.select().from(deliveries).where(eq(deliveries.orderId,f.id))).length,1);
});

test('approval uses the first actual source trip date for stock-hold expiry, not the stale overall estimate',async()=>{
 const f=await splitDeliveryFixture({stockDate:'2026-11-20',incomingDate:'2026-11-24',overallDate:'2026-11-16'});
 const {orderStockHolds}=await import('../../src/modules/sales/schema.ts');
 const {autoHoldExpiry}=await import('../../src/modules/sales/api/order-hold-store.ts');
 const holds=await f.db.select().from(orderStockHolds).where(eq(orderStockHolds.orderId,f.id));assert.ok(holds.length>0);assert.ok(holds.every(h=>h.expiresAt===autoHoldExpiry('2026-11-20')));
 assert.equal((await f.db.select().from(salesOrders).where(eq(salesOrders.id,f.id)))[0]!.expectedDeliveryDate,'2026-11-20');
});

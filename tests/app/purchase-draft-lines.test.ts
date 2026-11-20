import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {incomingShipmentLines,supplierOrderEvents} from '../../src/modules/suppliers/schema.ts';
test('add/remove draft products preserves saved price, VAT and discount for both Manager and employee edits',async()=>{
 const f=await setupEarly(),c=f.cookies;
 const made=await f.call('/purchase-orders',c.emp,'POST',{orders:[{supplierId:'a',warehouse:'Kho nhận',lines:[{sku:'0001',name:'Cũ',unit:'Cái',quantity:5},{sku:'DROP',name:'Bỏ',quantity:1}]}]});
 assert.equal(made.status,201,JSON.stringify(made.data));const id=made.data.ids[0],path='/purchase-orders/'+id;let detail=(await f.call(path,c.mgr)).data;
 const priced=await f.call(path+'/prices',c.mgr,'POST',{revision:detail.revision,lines:detail.lines.map((l:any)=>({lineId:l.id,price:125000,taxRate:8,purchaseDiscount:25}))});assert.equal(priced.status,200,JSON.stringify(priced.data));detail=(await f.call(path,c.mgr)).data;
 const body={supplierId:'a',warehouse:'Kho nhận',revision:detail.revision,lines:[{sku:'0001',name:'Cũ',unit:'Cái',quantity:3,sources:[]},{sku:'0002',name:'Mới',unit:'Bộ',quantity:2,sources:[]}]};
 let updated=await f.call(path,c.mgr,'PUT',body);assert.equal(updated.status,200,JSON.stringify(updated.data));
 let rows=await f.db.select().from(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId,id));let old=rows.find(l=>l.sku==='0001')!;
 assert.deepEqual([old.quantity,old.price,old.taxRate,old.purchaseDiscount],[3,125000,8,25]);assert.equal(rows.some(l=>l.sku==='DROP'),false);assert.equal(rows.find(l=>l.sku==='0002')!.price,null);
 updated=await f.call(path,c.emp,'PUT',{...body,revision:updated.data.revision,lines:body.lines.map(l=>({...l,price:1,taxRate:0,purchaseDiscount:99}))});assert.equal(updated.status,200,JSON.stringify(updated.data));
 rows=await f.db.select().from(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId,id));old=rows.find(l=>l.sku==='0001')!;assert.deepEqual([old.price,old.taxRate,old.purchaseDiscount],[125000,8,25]);
 const notes=await f.db.select().from(supplierOrderEvents).where(eq(supplierOrderEvents.shipmentId,id));assert.ok(notes.some(n=>n.action==='update'&&n.summary.includes('DROP: 1 → 0')&&n.summary.includes('0002: 0 → 2')));
});
test('draft mutations reject stale revisions, other owners, invalid/empty lines and already approved orders',async()=>{
 const f=await setupEarly(),c=f.cookies;const made=await f.call('/purchase-orders',c.emp,'POST',{orders:[{supplierId:'a',warehouse:'Kho nhận',lines:[{sku:'0001',quantity:5}]}]});const id=made.data.ids[0],path='/purchase-orders/'+id,view=(await f.call(path,c.emp)).data;
 const body={supplierId:'a',warehouse:'Kho nhận',revision:view.revision,lines:[{sku:'0002',quantity:2}]};
 assert.equal((await f.call(path,c.sa,'PUT',body)).status,403);
 for(const lines of [[],[{sku:'0002',quantity:1.5}],[{sku:'same',quantity:1},{sku:'SAME',quantity:1}]])assert.equal((await f.call(path,c.emp,'PUT',{...body,lines})).status,400);
 const update=await f.call(path,c.emp,'PUT',body);assert.equal(update.status,200);assert.equal((await f.call(path,c.emp,'PUT',body)).status,409);
 assert.equal((await f.call('/purchase-orders/a1',c.mgr,'PUT',body)).status,409);
 const rows=await f.db.select().from(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId,id));assert.deepEqual(rows.map(r=>[r.sku,r.quantity]),[['0002',2]]);
});

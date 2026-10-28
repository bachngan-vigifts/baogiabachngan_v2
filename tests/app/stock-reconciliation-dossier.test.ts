import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq, sql} from 'drizzle-orm';
import {fixture,ok,sku} from '../helpers/warehouse-lifecycle-fixture.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {stockMoves} from '../../src/modules/inventory/schema.ts';
import {deliveries,salesOrderLines,salesOrders} from '../../src/modules/sales/schema.ts';
import {buildReconciliationDossier,renderDossierMarkdown} from '../../src/app/stock-reconciliation.ts';

/** Hồ sơ đối soát lịch sử: chỉ đọc, phân loại từng dòng (đã bù / giao trước chốt / cần xác minh), không ghi gì. */
test('phân loại đơn cũ đã giao thiếu xuất; chạy được trong giao dịch READ ONLY và không đổi dữ liệu',async()=>{
 const f=await fixture(),c=f.cookies;
 const lines=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,f.order.id)).orderBy(salesOrderLines.lineNo);
 // Đơn cũ: giao 2+3 không có phiếu xuất (như DH_20261020_005). Dòng 1 đã bù bằng phiếu điều chỉnh nhắc số chuyến; dòng 2 chưa bù.
 for(const l of lines)await f.db.update(salesOrderLines).set({deliveredQty:l.qty}).where(eq(salesOrderLines.id,l.id));
 await f.db.update(deliveries).set({status:'delivered',deliveredAt:'2999-01-01'}).where(eq(deliveries.id,f.trip.id));
 await f.db.update(salesOrders).set({status:'delivered',warehouseId:null}).where(eq(salesOrders.id,f.order.id));
 await postMoves(f.db,'mgr',[{sku,warehouseId:'vig',qty:2,kind:'opening',refType:'opening',refId:'dossier-open'}]);
 const [trip]=await f.db.select().from(deliveries).where(eq(deliveries.id,f.trip.id));
 ok(await f.call('/inventory/adjustments',c.mgr,'POST',{clientKey:'dossier-adj-0001',warehouseId:'vig',reason:'Đối soát bù xuất thiếu của '+trip!.deliveryNo,lines:[{sku,qty:-2}]}),201);
 const before=await f.db.select().from(stockMoves);
 const dossier=await f.db.transaction(async tx=>{await tx.execute(sql`set transaction read only`);return buildReconciliationDossier(tx as never,'2026-10-28T12:00:00.000Z');});
 assert.deepEqual(await f.db.select().from(stockMoves),before,'không ghi sổ kho');
 const order=dossier.orders.find(o=>o.orderId===f.order.id)!;
 assert.deepEqual(order.lines.map(l=>[l.qty,l.missing,l.cls]),[[2,2,'adjusted'],[3,3,'needs_review']]);
 assert.match(order.lines[0]!.evidence,/ĐC-/);assert.equal(order.adjustments.length,1);
 // Giao trước ngày chốt tồn: không cần bù.
 await f.db.update(deliveries).set({deliveredAt:'2000-01-01'}).where(eq(deliveries.id,f.trip.id));
 const early=(await buildReconciliationDossier(f.db)).orders.find(o=>o.orderId===f.order.id)!;
 assert.deepEqual(early.lines.map(l=>l.cls),['adjusted','pre_opening']);
 const md=renderDossierMarkdown(early?{...dossier,orders:[early]}:dossier);
 assert.match(md,/Giao trước chốt tồn/);assert.match(md,/Duyệt:/);
});
test('ghi trong giao dịch READ ONLY bị cơ sở dữ liệu từ chối',async()=>{
 const f=await fixture();
 await assert.rejects(f.db.transaction(async tx=>{await tx.execute(sql`set transaction read only`);await postMoves(tx as never,'mgr',[{sku,warehouseId:'other',qty:1,kind:'adjust',refType:'adjustment',refId:'x'}]);}),(e:any)=>/read-only|read only/i.test(String(e?.cause?.message??'')+String(e?.message??'')));
});

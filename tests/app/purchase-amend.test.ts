import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {incomingShipments} from '../../src/modules/suppliers/schema.ts';
test('Manager điều chỉnh đơn NCC chưa phát sinh: giữ ID dòng và yêu cầu NCC xác nhận lại',async()=>{
 const f=await setupEarly();await f.db.update(incomingShipments).set({supplierStatus:'confirmed'}).where(eq(incomingShipments.id,'a1'));
 const before=(await f.call('/purchase-orders/a1',f.cookies.mgr)).data;
 const r=await f.call('/purchase-orders/a1/amend',f.cookies.mgr,'POST',{revision:before.revision,reason:'Điều chỉnh theo thoả thuận mới',lines:[{lineId:'line-a1',sku:'031106000',name:'Ly',unit:'Cái',quantity:10,price:123456.5,taxRate:8,purchaseDiscount:25,printFee:0,sources:[]}]});
 assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.lines[0].id,'line-a1');assert.equal(r.data.lines[0].quantity,10);assert.equal(r.data.lines[0].price,123456.5);assert.equal(r.data.state,'awaiting_confirmation');assert.ok(r.data.revision>before.revision);
});

import {and,sql} from 'drizzle-orm';
import {auditLogs} from '../../src/core/db/schema.ts';
import {incomingShipmentLines,supplierOrderEvents,supplierOrderSources,supplierReceipts,supplierReceiptLines,supplierPayments,supplierRefunds,incomingShipmentFiles,supplierPaymentSchedules} from '../../src/modules/suppliers/schema.ts';
import {supplierPortalDeliveries} from '../../src/modules/suppliers/workspace-schema.ts';
import {stockMoves,stockBalances} from '../../src/modules/inventory/schema.ts';
import {warehouses,products} from '../../src/modules/catalog/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
async function prepared(){const f=await setupEarly();await f.db.update(incomingShipments).set({supplierStatus:'confirmed'}).where(eq(incomingShipments.id,'a1'));await f.db.update(incomingShipmentLines).set({quantity:10,price:100,taxRate:8,purchaseDiscount:10,confirmedPurchaseDiscount:5,supplierConfirmed:true}).where(eq(incomingShipmentLines.id,'line-a1'));const get=async()=>{const r=await f.call('/purchase-orders/a1',f.cookies.mgr);assert.equal(r.status,200);return r.data;};const amend=async(body:Record<string,unknown>,actor=f.cookies.mgr)=>f.call('/purchase-orders/a1/amend',actor,'POST',{revision:(await get()).revision,reason:'Đối chiếu thoả thuận mới',...body});return{...f,get,amend};}
const line=(extra:Record<string,unknown>={})=>({lineId:'line-a1',sku:'031106000',name:'Hàng 031106000',unit:'Cái',quantity:10,price:100,taxRate:8,purchaseDiscount:5,printFee:0,promisedDate:'2026-10-20',sources:[],...extra});

test('Quyền/revision/lý do/NCC và dữ liệu sai đều bị chặn; retry stale không nhân audit',async()=>{
 const f=await prepared(),original=await f.get();for(const actor of [f.cookies.emp,f.cookies.sa,f.cookies.kt,f.cookies.kho,f.cookies.ncc])assert.equal((await f.amend({note:'không được sửa'},actor)).status,403);
 for(const body of [{reason:''},{revision:null},{revision:'1'},{lines:[]},{lines:[line({lineId:'foreign'})]},{lines:[line({quantity:-1})]},{lines:[line({purchaseDiscount:101})]},{lines:[line({taxRate:101})]},{lines:[line({price:-1})]},{approvedAt:'fake'}])assert.equal((await f.amend(body)).status,400,JSON.stringify(body));
 assert.equal((await f.amend({supplierId:'b'})).status,409);
 assert.equal((await f.amend({note:'Ghi chú lần đầu'})).status,200);
 const stale=await f.amend({revision:original.revision,note:'Gửi lại sau mất phản hồi'});assert.equal(stale.status,409);assert.equal(stale.data.code,'PURCHASE_AMEND_STALE');assert.equal((await f.db.select().from(auditLogs).where(eq(auditLogs.action,'amend'))).length,1);
});

test('Đã nhận8/đặt10 không hạ7; giữ tiền/tồn và chỉ cho ghi chú, không yêu cầu NCC xác nhận lại',async()=>{
 const f=await prepared(),now=new Date().toISOString();await f.db.insert(products).values({sku:'031106000',name:'Ly',unit:'Cái',updatedAt:now});await f.db.insert(warehouses).values({id:'amend-wh',name:'Kho thử amend',kind:'stock'});await postMoves(f.db,'mgr',[{sku:'031106000',warehouseId:'amend-wh',qty:1,kind:'opening',refType:'opening',refId:'amend-opening'}]);
 const receipt=await f.call('/purchase-orders/a1/receipts',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),receivedDate:'2026-11-23',warehouse:'Kho thử amend',createSapo:false,lines:[{lineId:'line-a1',goodQty:8}]});assert.equal(receipt.status,201,JSON.stringify(receipt.data));
 const before=await f.get(),moves=await f.db.select().from(stockMoves),balance=await f.db.select().from(stockBalances);
 const rejected=await f.amend({lines:[line({quantity:7})]});assert.equal(rejected.status,409);assert.equal(rejected.data.code,'PURCHASE_AMEND_PROTECTED');assert.match(rejected.data.error,/Phiếu nhận hàng.*Trả hàng/);
 const note=await f.amend({note:'Ghi chú nội bộ sau nhận'});assert.equal(note.status,200);assert.equal(note.data.confirmedAt,before.confirmedAt);assert.equal(note.data.lines[0].quantity,10);assert.equal(note.data.progress.good,8);assert.deepEqual(await f.db.select().from(stockMoves),moves);assert.deepEqual(await f.db.select().from(stockBalances),balance);
});

test('Tiền đã huỷ, hoàn tiền, chữ ký, phiếu giao NCC và early allocation đều bảo vệ lịch sử',async()=>{
 for(const kind of ['payment','refund','signature','delivery','early'] as const){const f=await prepared(),now=new Date().toISOString();
  if(kind==='payment')await f.db.insert(supplierPayments).values({id:'old-pay',shipmentId:'a1',amount:100,paidDate:'2026-11-23',clientKey:'old-pay',createdBy:'mgr',createdAt:now,voidedAt:now});
  if(kind==='refund')await f.db.insert(supplierRefunds).values({id:'old-refund',shipmentId:'a1',amount:10,receivedDate:'2026-11-23',method:'transfer',reference:'BANK-TEST',clientKey:'old-refund',requestHash:'test',createdBy:'mgr',createdAt:now});
  if(kind==='signature')await f.db.insert(incomingShipmentFiles).values({id:'old-signature',shipmentId:'a1',r2Key:'fixture-only',fileName:'signed.pdf',mimeType:'application/pdf',sizeBytes:10,uploadedBy:'mgr',uploadedAt:now});
  if(kind==='delivery')await f.db.insert(supplierPortalDeliveries).values({id:'old-delivery',supplierId:'a',shipmentId:'a1',deliveryNo:'TEST-GH',deliveryDate:'2026-11-23',clientKey:'old-delivery',requestHash:'test',createdBy:'mgr',createdAt:now});
  if(kind==='early'){const made=await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-11-24',scope:{supplierId:'a'},lines:[{sku:'031106000',quantity:1}]});assert.equal(made.status,201,JSON.stringify(made.data));}
  const context=await f.call('/purchase-orders/a1/amend',f.cookies.mgr);assert.equal(context.status,200);assert.equal(context.data.noteOnly,true,kind);
  const r=await f.amend({lines:[line({price:90})]});assert.equal(r.status,409,kind);assert.equal(r.data.code,'PURCHASE_AMEND_PROTECTED');assert.equal((await f.get()).lines[0].price,100);
  assert.equal((await f.amend({note:'Ghi chú vẫn được phép '+kind})).status,200,kind);
 }
});

test('Sửa giữ source ID/line ID, kiểm ngân sách toàn cục, NCC màn hình cũ bị409 và portal đánh dấu điều chỉnh',async()=>{
 const f=await prepared(),now=new Date().toISOString();
 const quote=await f.call('/quotes',f.cookies.emp,'POST',{type:'B2B',quoteNo:'BG-AMEND',customer:'Khách',vat:8,rows:[{sku:'031106000',name:'Ly',unit:'Cái',qty:10,price:100}]});assert.equal(quote.status,201,JSON.stringify(quote.data));
 await f.db.insert(supplierOrderSources).values([{id:'retained-source',shipmentId:'a1',lineId:'line-a1',sourceType:'quote',sourceId:quote.data.id,sourceNo:'BG-AMEND',sku:'031106000',quantity:8,createdAt:now},{id:'other-source',shipmentId:'b1',lineId:'line-b1',sourceType:'quote',sourceId:quote.data.id,sourceNo:'BG-AMEND',sku:'031106000',quantity:3,createdAt:now}]);
 assert.equal((await f.amend({lines:[line({sources:[{type:'quote',id:quote.data.id,quantity:8}]})]})).status,409,'3+8 vượt10 kể cả NCC khác');
 const before=await f.get();const success=await f.amend({lines:[line({quantity:9,sources:[{type:'quote',id:quote.data.id,quantity:7}]})]});assert.equal(success.status,200,JSON.stringify(success.data));assert.equal(success.data.lines[0].id,'line-a1');const saved=(await f.db.select().from(supplierOrderSources).where(eq(supplierOrderSources.id,'retained-source')))[0]!;assert.equal(saved.quantity,7);
 const raw=(await f.db.select().from(incomingShipmentLines).where(eq(incomingShipmentLines.id,'line-a1')))[0]!;assert.equal(raw.confirmedPurchaseDiscount,null);assert.equal(raw.purchaseDiscount,5,'giữ đơn giá hiệu lực cũ khi bỏ override, không nhảyCK về10');
 const stale=await f.call('/supplier-portal/workspace/orders/a1/confirm',f.cookies.ncc,'POST',{revision:before.revision});assert.equal(stale.status,409);assert.match(stale.data.error,/thay đổi/);
 const portal=await f.call('/supplier-portal/workspace/orders',f.cookies.ncc);assert.equal(portal.status,200,JSON.stringify(portal.data));assert.equal(portal.data.items.find((r:any)=>r.id==='a1').amended,true);
 const events=await f.db.select().from(supplierOrderEvents).where(and(eq(supplierOrderEvents.shipmentId,'a1'),eq(supplierOrderEvents.action,'amend')));assert.equal(events.length,1);const event=JSON.parse(events[0]!.data),audit=(await f.db.select().from(auditLogs).where(eq(auditLogs.id,event.auditId)))[0]!;const data=JSON.parse(audit.data);assert.equal(data.before.lines[0].id,'line-a1');assert.equal(data.after.lines[0].id,'line-a1');assert.equal(data.after.sources.find((s:any)=>s.id==='retained-source').quantity,7);
});

test('Audit lỗi rollback đầy đủ; thay dòng chỉ xoá dòng chưa tham chiếu, snapshot trên8k không bị cắt',async()=>{
 const f=await prepared(),before=await f.get();
 await f.client.exec("CREATE FUNCTION reject_amend_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='amend' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_amend_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_amend_audit();");
 assert.equal((await f.amend({lines:[line({price:250})]})).status,500);assert.equal((await f.get()).revision,before.revision);assert.equal((await f.get()).lines[0].price,100);assert.equal((await f.db.select().from(supplierOrderEvents).where(eq(supplierOrderEvents.action,'amend'))).length,0);
 await f.client.exec('DROP TRIGGER reject_amend_audit ON audit_logs');
 await f.db.insert(incomingShipmentLines).values({id:'unused-drop',shipmentId:'a1',lineNo:2,sku:'DROP',name:'Bỏ dòng',unit:'Cái',quantity:1,price:1,taxRate:0});
 const extra=Array.from({length:30},(_,i)=>({sku:'NEW-'+i,name:'Tên dài '+String(i)+' '+ 'mô tả '.repeat(35),unit:'Cái',quantity:1,price:100,taxRate:8,purchaseDiscount:0,printFee:0,sources:[]}));
 const changed=await f.amend({lines:[line(),...extra]});assert.equal(changed.status,200,JSON.stringify(changed.data));assert.equal(changed.data.lines.find((l:any)=>l.sku==='031106000').id,'line-a1');assert.equal(changed.data.lines.some((l:any)=>l.id==='unused-drop'),false);
 const [audit]=await f.db.select().from(auditLogs).where(eq(auditLogs.action,'amend'));assert.ok(audit!.data.length>8000);const parsed=JSON.parse(audit!.data);assert.equal(parsed.before.lines.length,2);assert.equal(parsed.after.lines.length,31);
});

test('Chỉ ghi chú/giá trị hiệu lực không đổi không mất override hoặc đòi NCC xác nhận lại',async()=>{
 const f=await prepared(),before=await f.get();const unchanged=await f.amend({lines:[line()],note:before.note});assert.equal(unchanged.status,200,JSON.stringify(unchanged.data));assert.equal(unchanged.data.revision,before.revision);const raw=(await f.db.select().from(incomingShipmentLines).where(eq(incomingShipmentLines.id,'line-a1')))[0]!;assert.equal(raw.purchaseDiscount,10);assert.equal(raw.confirmedPurchaseDiscount,5);assert.equal((await f.db.select().from(auditLogs).where(eq(auditLogs.action,'amend'))).length,0);
});

test('Lịch trả dùng builder hiện có: chặn tổng mới dưới cọc hẹn, Manager đổi kế hoạch rõ ràng; concurrent revision chỉ một lần',async()=>{
 const f=await prepared(),now=new Date().toISOString();await f.db.insert(supplierPaymentSchedules).values({id:'fixed-deposit',shipmentId:'a1',kind:'deposit',amount:50,dueDate:'2026-11-25',createdAt:now});
 const reduced={lines:[line({quantity:1,price:10,taxRate:0,purchaseDiscount:0})]};assert.equal((await f.amend(reduced)).status,409);
 const before=await f.get(),body={...reduced,revision:before.revision,payment:{deposit:{mode:'none'},balanceDueDate:'2026-11-30'}};
 const result=await Promise.all([f.amend(body),f.amend(body)]);assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);const saved=await f.get();assert.equal(saved.totals.total,10);assert.deepEqual(saved.schedules.map((s:any)=>[s.kind,s.amount,s.dueDate]),[['balance',10,'2026-11-30']]);assert.equal((await f.db.select().from(auditLogs).where(eq(auditLogs.action,'amend'))).length,1);
});

test('Nhật ký đầy đủ chỉ Manager đọc; người thiếu quyền giá không thấy lý do tài chính qua events',async()=>{
 const f=await prepared();await f.db.execute(sql`delete from staff_position_permissions where position_id='accounting' and permission='purchases.prices'`);
 assert.equal((await f.amend({reason:'Giá bí mật được thoả thuận',lines:[line({price:110})]})).status,200);
 const hidden=await f.call('/purchase-orders/a1',f.cookies.kt);assert.equal(hidden.status,200);assert.equal(hidden.data.priceHidden,true);assert.ok(hidden.data.events.every((e:any)=>!e.summary.includes('Giá bí mật')));
 assert.equal((await f.call('/audit?entityType=purchase-order&entityId=a1',f.cookies.kt)).status,403);const audit=await f.call('/audit?entityType=purchase-order&entityId=a1',f.cookies.mgr);assert.equal(audit.status,200);assert.ok(audit.data.entries.some((e:any)=>e.action==='amend'&&e.data.before&&e.data.after));
});

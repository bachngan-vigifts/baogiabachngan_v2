import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {eq} from 'drizzle-orm';
import {createTestDb} from '../helpers/postgres.ts';
import {seedStaff} from '../helpers/staff-fixture.ts';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {salesLineCosts,salesLineCostHistory} from '../../src/modules/sales/line-cost-schema.ts';
import {products,productPrices,pricePolicies} from '../../src/modules/catalog/schema.ts';
import {computeOrderTotals,purchaseUnitCost} from '../../src/modules/suppliers/domain/order-totals.ts';
import {recoveryPlan,recoverySql,recoveryInputSql,type RecoveryInput} from '../../scripts/maintenance/recover-legacy-profit-costs.ts';
import {setup} from '../helpers/pos-fixture.ts';
import {incomingShipments,incomingShipmentLines,suppliers} from '../../src/modules/suppliers/schema.ts';
import {productMovements} from '../../src/modules/catalog/schema.ts';
import {quotations,quoteRevisions} from '../../src/modules/quotes/schema.ts';
import {purchaseCostAt,quoteLineCost} from '../../src/modules/sales/domain/line-cost.ts';

const line={id:'line',orderId:'order',sku:'A',name:'Ly A',lineNo:1,qty:2,amount:200000,day:'2026-10-20',createdAt:'2026-10-20T08:00:00Z',quoteRef:null,quoteAt:null,quoteRows:null};
const point={sku:'A',ref:'purchase:p:line:l',at:'2026-10-19T08:00:00Z',price:100000,discount:25,printFee:1000};
const product={sku:'A',name:'Ly',brand:'LocknLock',pattern:'',taxable:true,taxOut:8,taxBasis:'Giá chưa thuế',at:'2026-11-01T00:00:00Z',prices:[{id:'retail',name:'Giá bán lẻ + VAT',price:108000}]};
const empty=():RecoveryInput=>({lines:[{...line}],movements:[],purchaseOrders:[],products:[]});

test('giá mua khớp tiền NCC: CK xác nhận ghi đè CK dự kiến, cộng phí in, không cộng VAT; thiếu giá không thành 0',()=>{
 const row={price:100000,purchaseDiscount:20,confirmedPurchaseDiscount:25,printFee:1000,taxRate:8};
 const total=computeOrderTotals({rows:[{...row,quantity:2}],depositRate:null,paidAmount:null});
 assert.equal(purchaseUnitCost(row),76000);assert.equal(purchaseUnitCost(row)!*2,total.subtotal);
 assert.equal(purchaseUnitCost({...row,price:null}),null);
 assert.equal(purchaseUnitCost({...row,price:0,printFee:0}),0);
});
test('khôi phục ưu tiên giá thực nhận trước ngày bán; bỏ phiếu huỷ; dùng snapshot phiếu nhập, không lấy giá đơn mua đã thay sau',()=>{
 const i=empty();i.movements=[{...point,id:'m',ref:'receipt:r:l',storedPrice:100000,note:'',receiptId:'r',cancelled:false,approved:true,
   price:999999,discount:0,printFee:0,item:{sku:'A',unit_price:100000,purchase_discount_percent:25}}];
 i.purchaseOrders=[{...point,price:200000}];
 const p=recoveryPlan(i);assert.equal(p.costs[0]!.unitCost,75000);assert.equal(p.costs[0]!.source,'purchase');assert.equal(p.costs[0]!.confidence,'estimate');
 assert.deepEqual(p.repairs.map(x=>[x.previous,x.price]),[[100000,75000]]);
 i.movements[0]!.cancelled=true;assert.equal(recoveryPlan(i).costs[0]!.unitCost,151000);
});
test('ngày bán theo giờ Việt Nam; giá sau ngày bán không bị coi là chính xác, giá cùng thời điểm mâu thuẫn không được chọn đoán',()=>{
 const i=empty();i.purchaseOrders=[{...point,at:'2026-10-20T18:00:00Z'}];
 const p=recoveryPlan(i);assert.equal(p.costs[0]!.confidence,'backfill');assert.match(p.costs[0]!.note,/sau ngày bán/);
 i.purchaseOrders.push({...point,at:'2026-10-20T18:00:00Z',ref:'other',price:300000});
 assert.equal(recoveryPlan(i).costs.length,0);assert.match(recoveryPlan(i).unresolved[0]!.reason,/cùng thời điểm/);
 assert.equal(purchaseCostAt([{at:'2026-10-20T18:00:00Z',price:100}],line.day)!.source,'purchase_later');
 assert.equal(purchaseCostAt([{at:'not-a-date',price:100}],line.day),null);
});
test('công thức thương hiệu dùng đúng chính sách bán lẻ và VAT, không dùng giá sỉ bất kỳ; thương hiệu lạ giữ thiếu',()=>{
 const i=empty();i.products=[{...product,prices:[{id:'wholesale',name:'Giá sỉ',price:1},...product.prices]}];
 const p=recoveryPlan(i).costs[0]!;assert.equal(p.unitCost,42000);assert.equal(p.source,'catalog_rule');assert.equal(p.confidence,'estimate');assert.match(p.note,/CK 58%/);
 i.products[0]!.brand='Không rõ';assert.equal(recoveryPlan(i).costs.length,0);
 i.products=[{...product,taxOut:null}];assert.equal(recoveryPlan(i).costs.length,0);
});
test('giá 0 do báo giá thiếu giá niêm yết không được dùng làm giá vốn miễn phí; chỉ giữ số 0 nhập tay rõ ràng',()=>{
 const i=empty();i.lines[0]!.quoteRows=[{sku:'A',name:'Ly A',qty:2,costPrice:0,costMode:'discount',purchaseDiscount:25}];
 assert.equal(recoveryPlan(i).costs.length,0);
 assert.equal(quoteLineCost(i.lines[0]!.quoteRows[0]!,null),null);
 i.lines[0]!.quoteRows[0]!.costMode='manual';assert.equal(recoveryPlan(i).costs[0]!.unitCost,0);
});
test('cùng SKU nhưng khác đơn vị mua/bán không tự ghép giá thùng vào giá từng cái',()=>{
 const i=empty();i.lines[0]!.unit='Cái';i.purchaseOrders=[{...point,unit:'Thùng'}];i.products=[{...product,unit:'Thùng'}];
 assert.equal(recoveryPlan(i).costs.length,0);
 i.purchaseOrders[0]!.unit='cái';assert.equal(recoveryPlan(i).costs[0]!.unitCost,76000);
});
test('nhận hàng NCC mới lưu đúng giá sau CK trước VAT và đúng ngày nhận để báo cáo không tiếp tục dùng giá niêm yết',async()=>{
 const f=await setup(),stamp=new Date().toISOString();
 await f.db.insert(suppliers).values({id:'cost-ncc',name:'NCC kiểm thử',nameKey:'cost-ncc',createdBy:'mgr',createdAt:stamp,updatedAt:stamp});
 await f.db.insert(incomingShipments).values({id:'purchase-cost',ticketNumber:'DMH-COST',source:'supplier-order',warehouse:'Kho POS',supplierId:'cost-ncc',supplierName:'NCC kiểm thử',approvalStatus:'approved',supplierStatus:'confirmed',createdBy:'mgr',createdAt:stamp,updatedAt:stamp});
 await f.db.insert(incomingShipmentLines).values({id:'purchase-line',shipmentId:'purchase-cost',lineNo:1,sku:'00123',name:'Ly',unit:'Cái',quantity:20,price:100000,purchaseDiscount:20,confirmedPurchaseDiscount:25,printFee:1000,taxRate:8});
 const result=await f.call('/purchase-orders/purchase-cost/receipts',f.mgr,'POST',{clientKey:crypto.randomUUID(),createSapo:false,receivedDate:'2026-11-01',warehouse:'Kho POS',lines:[{lineId:'purchase-line',goodQty:2}]});
 assert.equal(result.status,201,JSON.stringify(result.data));
 const movement=(await f.db.select().from(productMovements).where(eq(productMovements.kind,'purchase')))[0]!;
 assert.equal(movement.unitPrice,76000);assert.equal(movement.occurredAt,'2026-11-01T00:00:00+07:00');assert.match(movement.note,/net-cost-v1/);
 // Reproduce the legacy gross-price history, then exercise the same guarded repair used in production.
 await f.db.update(productMovements).set({unitPrice:100000,note:''}).where(eq(productMovements.id,movement.id));
 await f.db.insert(salesOrders).values({id:'legacy-cost-order',orderNo:'DH-LEGACY-COST',quoteType:'HRC',customerName:'Khách kiểm thử',ownerId:'emp',createdBy:'emp',orderDate:'2026-11-05',status:'confirmed',subtotal:200000,total:200000,createdAt:'2026-11-05T08:00:00Z',updatedAt:stamp});
 await f.db.insert(salesOrderLines).values({id:'legacy-cost-line',orderId:'legacy-cost-order',lineNo:1,sku:'00123',name:'Ly',unit:'Cái',qty:2,unitPrice:100000,amount:200000});
 const exported=(await f.client.query(recoveryInputSql)).rows[0] as {payload:RecoveryInput;fingerprint:string};
 const plan=recoveryPlan(exported.payload);assert.equal(plan.repairs.length,1);assert.equal(plan.costs[0]!.unitCost,76000);
 const query=recoverySql(plan,exported.fingerprint);await f.client.exec(query);await f.client.exec(query);
 const repaired=(await f.db.select().from(productMovements).where(eq(productMovements.id,movement.id)))[0]!;
 assert.equal(repaired.unitPrice,76000);assert.equal(repaired.note.match(/net-cost-v1/g)?.length,1,'gửi lặp không chiết khấu lần hai');
 assert.equal((await f.db.select().from(salesLineCostHistory)).filter(x=>x.reason==='recover').length,1);
});
test('SQL khôi phục ghi snapshot + lịch sử nguyên tử, gửi lặp không nhân đôi, giữ giá Manager; kiểm tra lại nguồn trước ghi',async()=>{
 const {db,client,d1}=await createTestDb();await seedStaff(d1);
 await db.insert(salesOrders).values({id:'order',orderNo:'DH-RECOVERY',quoteType:'HRC',customerName:'Khách kiểm thử',ownerId:'emp',createdBy:'emp',orderDate:'2026-10-20',status:'confirmed',subtotal:200000,total:200000,createdAt:line.createdAt,updatedAt:line.createdAt});
 await db.insert(salesOrderLines).values([{id:'line',orderId:'order',lineNo:1,sku:'A',name:'Ly A',qty:2,unitPrice:100000,amount:200000},
 {id:'manual',orderId:'order',lineNo:2,sku:'A',name:'Ly A',qty:1,unitPrice:100000,amount:100000}]);
 await db.insert(salesLineCosts).values({orderLineId:'manual',orderId:'order',sku:'A',unitCost:123,source:'manual',confidence:'confirmed',capturedAt:line.createdAt,note:'Manager đã đối soát'});
 await db.insert(products).values({sku:'A',name:'Ly',brand:'LocknLock',taxable:true,taxOut:8,updatedAt:product.at});
 await db.insert(pricePolicies).values({id:'retail',name:'Giá bán lẻ + VAT'});
 await db.insert(productPrices).values({sku:'A',policyId:'retail',price:108000});
 const input=async()=>(await client.query<{payload:RecoveryInput;fingerprint:string}>(recoveryInputSql)).rows[0]!;
 const first=await input();assert.equal(first.payload.lines.length,1);
 const plan=recoveryPlan(first.payload),query=recoverySql(plan,first.fingerprint);
 await db.update(productPrices).set({price:216000}).where(eq(productPrices.sku,'A'));
 await assert.rejects(client.exec(query),/input changed/);await client.exec('ROLLBACK');
 assert.equal((await db.select().from(salesLineCosts)).length,1,'nguồn đổi không ghi nửa chừng');
 const fresh=await input(),final=recoverySql(recoveryPlan(fresh.payload),fresh.fingerprint);
 await client.exec(final);await client.exec(final);
 const costs=await db.select().from(salesLineCosts);assert.equal(costs.length,2);
 assert.equal(costs.find(x=>x.orderLineId==='manual')!.unitCost,123);
 assert.equal(costs.find(x=>x.orderLineId==='line')!.unitCost,84000);
 const history=await db.select().from(salesLineCostHistory);assert.equal(history.length,1);assert.equal(history[0]!.reason,'recover');assert.equal(history[0]!.actorId,null);
 const orders=await db.select().from(salesOrders);assert.equal(orders[0]!.subtotal,200000,'không thay doanh thu hay tiền đơn');
});
test('nguồn báo giá cũ lấy phiên bản có hiệu lực khi lập đơn, không lấy giá đã sửa sau ngày bán',async()=>{
 const {db,client,d1}=await createTestDb();await seedStaff(d1);
 const row=(costPrice:number)=>JSON.stringify({type:'HRC',rows:[{sku:'A',name:'Ly A',qty:2,costPrice,costMode:'manual'}]});
 await db.insert(quotations).values({id:'q-cost',creatorId:'emp',quoteNo:'Q-COST',quoteType:'HRC',customer:'Khách kiểm thử',data:row(900),createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z'});
 await db.insert(quoteRevisions).values({id:'q-old',quoteId:'q-cost',revision:1,data:row(500),changedBy:'emp',createdAt:'2026-10-21T00:00:00Z'});
 await db.insert(salesOrders).values({id:'order',orderNo:'DH-HISTORY',quoteId:'q-cost',quoteType:'HRC',customerName:'Khách kiểm thử',ownerId:'emp',createdBy:'emp',orderDate:line.day,status:'confirmed',subtotal:200000,total:200000,createdAt:line.createdAt,updatedAt:line.createdAt});
 await db.insert(salesOrderLines).values({id:'line',orderId:'order',lineNo:1,sku:'A',name:'Ly A',qty:2,unitPrice:100000,amount:200000});
 const input=async()=>(await client.query<{payload:RecoveryInput}>(recoveryInputSql)).rows[0]!.payload;
 const first=await input();assert.equal(first.lines[0]!.quoteRows![0]!.costPrice,500);assert.equal(recoveryPlan(first).costs[0]!.unitCost,500);
 await db.delete(quoteRevisions);assert.equal(recoveryPlan(await input()).costs.length,0,'không mượn giá 900 sửa sau thời điểm bán');
});

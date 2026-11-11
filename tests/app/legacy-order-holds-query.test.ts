import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff } from '../helpers/staff-fixture.ts';
import { referenceLegacyHolds } from '../helpers/legacy-order-holds-reference.ts';
import { legacyOrderHoldsQuery } from '../../src/modules/sales/api/legacy-order-holds.ts';
import { products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { stockMoves } from '../../src/modules/inventory/schema.ts';
import { salesOrders, salesOrderLines, salesContracts, deliveries, packingSlips } from '../../src/modules/sales/schema.ts';
const now='2026-11-01T00:00:00.000Z';
test('preaggregated holds equal the original query across SKU, warehouse, owner scope, reversals and source exclusions',async()=>{
 const {db,d1,client}=await createTestDb();await seedStaff(d1);
 await db.insert(warehouses).values([{id:'a',name:'A',kind:'stock'},{id:'b',name:'B',kind:'stock'},{id:'incoming',name:'Incoming',kind:'incoming'}]);
 await db.insert(products).values(['A','B','C'].map(sku=>({sku,name:sku,updatedAt:now})));
 await db.insert(productStock).values([{sku:'A',warehouseId:'a',quantity:100,updatedAt:'2026-11-03'},{sku:'B',warehouseId:'incoming',quantity:100,updatedAt:'2026-11-03'}]);
 await db.insert(stockMoves).values({id:'opening',sku:'A',warehouseId:'a',qty:100,kind:'opening',refType:'opening',refId:'opening',createdBy:'mgr',createdAt:now});
 // Deliberately mix cancelled/delivered/inactive, modern CRM and legacy orders.
 for(let i=0;i<48;i++){
  const id='o'+i,warehouseId=i%3===0?null:i%3===1?'a':'b',status=(['draft','confirmed','delivering','delivered','cancelled'] as const)[i%5];
  await db.insert(salesOrders).values({id,orderNo:id,channel:i%2?'crm':'pos',holdMode:i%7?'legacy':'capped',quoteType:'HRC',customerName:'Fixture',ownerId:i%2?'emp':'mgr',createdBy:'mgr',orderDate:'2026-11-01',warehouseId,status,holdsStock:i%11!==0,sapoOrderId:i%4===0?String(i):null,sapoPushedAt:i%8===0?null:'2026-11-02',createdAt:now,updatedAt:now});
  await db.insert(salesOrderLines).values([{id:id+'-1',orderId:id,lineNo:1,sku:'A',name:'A',qty:5,deliveredQty:i%4},{id:id+'-2',orderId:id,lineNo:2,sku:'A',name:'A duplicate',qty:4,deliveredQty:i%3},{id:id+'-3',orderId:id,lineNo:3,sku:'B',name:'B',qty:3,deliveredQty:i%4},{id:id+'-4',orderId:id,lineNo:4,sku:'',name:'No SKU',qty:1}]);
  await db.insert(deliveries).values({id:id+'-delivery',deliveryNo:id+'-GH',orderId:id,plannedDate:'2026-11-01',createdBy:'mgr',createdAt:now,updatedAt:now});
  await db.insert(packingSlips).values({id:id+'-pack',slipNo:id+'-DG',orderId:id,source:'warehouse',sourceNote:'fixture',status:i%2?'packed':'cancelled',createdBy:'mgr',createdAt:now,updatedAt:now});
  const move=(suffix:string,refType:typeof stockMoves.$inferInsert.refType,refId:string,sku:string,qty:number,wh:string,kind:typeof stockMoves.$inferInsert.kind)=>({id:id+suffix,sku,warehouseId:wh,qty,kind,refType,refId,createdBy:'mgr',createdAt:now});
  await db.insert(stockMoves).values([
   move('-out','packing_slip',id+'-pack','A',-4,'a','issue'),
   move('-reverse','packing_slip',id+'-pack','A',i%5,'a','reverse'),
   move('-delivery','pos_delivery',id+'-delivery','A',-2,'b','issue'),
   move('-b','pos_delivery',id+'-delivery','B',-1,'a','issue'),
   move('-wrong','adjustment',id+'-pack','A',-100,'a','issue'),
   move('-orphan','packing_slip',id+'-missing','A',-100,'a','issue'),
  ].filter(m=>m.qty!==0));
  if(i%6===0)await db.insert(salesContracts).values({id:id+'-contract',contractNo:id+'-HD',orderId:id,legalEntity:'BN',status:i%12===0?'cancelled':'signed',createdBy:'mgr',createdAt:now,updatedAt:now});
  if(i%9===0)await db.insert(stockMoves).values(move('-ledger','sales_order',id+(i%18===0?'#partial':''),'A',-1,i%18===0?'a':'b','issue'));
 }
 const ledgerCount=(await db.select().from(stockMoves)).length;
 let checks=0;
 for(const skus of [undefined,['A'],['B'],['C'],['A','B']])for(const wh of [undefined,'a','b'])for(const scope of [undefined,eq(salesOrders.ownerId,'emp')]){
  const before=await referenceLegacyHolds(db,skus,wh,scope,true),after=await legacyOrderHoldsQuery(db,skus,wh,scope,true);
  assert.deepEqual(after,before,`skus=${skus} warehouse=${wh} ownerScope=${!!scope}`);checks++;
 }
 assert.equal(checks,30);
 assert.deepEqual(await legacyOrderHoldsQuery(db,['A'],undefined,eq(salesOrders.id,'does-not-exist')),[]);
 // Read paths must never mutate the ledger or orders.
 assert.equal((await db.select().from(salesOrders)).length,48);
 assert.equal((await db.select().from(stockMoves)).length,ledgerCount);
 const plan=await client.query<any>('EXPLAIN (ANALYZE, FORMAT JSON) '+legacyOrderHoldsQuery(db,undefined,'a',undefined,true).toSQL().sql,
  legacyOrderHoldsQuery(db,undefined,'a',undefined,true).toSQL().params);
 const root=plan.rows[0]['QUERY PLAN'][0].Plan;const ctes:any[]=[];
 const walk=(n:any)=>{if(n['Subplan Name']==='CTE hold_net_issues'||n['Subplan Name']==='CTE hold_ledger_refs')ctes.push(n);for(const c of n.Plans||[])walk(c);};walk(root);
 assert.equal(ctes.length,2);assert.ok(ctes.every(n=>n['Actual Loops']<=1),'net issues and ledger refs are computed once per query');
});

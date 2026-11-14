import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {PASSWORD} from '../helpers/staff-fixture.ts';
import {profitDateFixture} from '../helpers/profit-date-fixture.ts';
import {salesOrders,salesOrderLines,salesContracts} from '../../src/modules/sales/schema.ts';
import {salesLineCosts} from '../../src/modules/sales/line-cost-schema.ts';
import {posReturns,posReturnLines} from '../../src/modules/sales/return-schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';
const good=(r:{status:number;data:any})=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
const sum=(rows:any[],key:string)=>rows.reduce((n,r)=>n+r[key],0);

test('month table is a monthly total while daily chart, all dimensions, orders and detail reconcile',async()=>{
 const f=await profitDateFixture();
 const d=good(await f.call('/profit?from=2026-11-01&to=2026-11-07&grain=month&chartGrain=day&compare=0',f.mgr));
 assert.deepEqual(d.series.map((r:any)=>[r.key,r.revenue]),[['2026-11',7e6]]);
 assert.deepEqual(d.chartSeries.map((r:any)=>r.revenue),[4e6,2e6,1e6]);
 for(const group of ['series','chartSeries','owners','branches','customers','products','orders'])for(const key of ['revenue','cost','gross'])assert.equal(sum(d[group],key),d.summary[key],group+':'+key);
 for(const o of d.orders){const detail=good(await f.call('/profit/orders/'+o.id,f.mgr));assert.equal(detail.revenue,o.revenue);assert.equal(detail.cost,o.cost);assert.equal(detail.gross,o.gross);assert.equal(o.coveredRevenue,detail.coveredRevenue);}
 const only=good(await f.call('/profit?from=2026-11-01&to=2026-11-07&grain=month&owner=emp&branch=crm&customer=absent&compare=0',f.mgr));assert.equal(only.summary.revenue,0);assert.equal(only.branchCosts.company,null);
 for(const query of ['from=2026-02-30&to=2026-03-01','from=2026-11-01&to=2026-11-07&chartGrain=hour'])assert.equal((await f.call('/profit?'+query,f.mgr)).status,400);
});

test('partial confirmed costs and order drilldown preserve the selected confidence filter',async()=>{
 const f=await profitDateFixture();
 await f.db.update(salesLineCosts).set({confidence:'estimate'}).where(eq(salesLineCosts.orderId,'week'));
 await f.db.insert(salesOrderLines).values({id:'today-est',orderId:'today',lineNo:2,sku:'00123',name:'Ước tính',unit:'cái',qty:1,unitPrice:2e6,amount:2e6});
 await f.db.insert(salesLineCosts).values({orderLineId:'today-est',orderId:'today',sku:'00123',unitCost:1e6,source:'manual',confidence:'estimate',capturedAt:'2026-11-07T03:00:00Z'});
 const d=good(await f.call('/profit?from=2026-11-01&to=2026-11-07&costs=confirmed&compare=0',f.mgr));
 assert.equal(d.products[0].orders,3,'two lines of the same SKU in one order count as one order');
 const mixed=d.orders.find((o:any)=>o.id==='today');assert.equal(mixed.coveredRevenue,1e6);assert.equal(mixed.cost,5e5);assert.equal(mixed.unconfirmedLines,1);
 const detail=good(await f.call('/profit/orders/today?costs=confirmed',f.mgr));assert.equal(detail.cost,mixed.cost);assert.equal(detail.gross,mixed.gross);assert.equal(detail.lines.find((l:any)=>l.id==='today-est').unitCost,null);
 const all=good(await f.call('/profit/orders/today?costs=all',f.mgr));assert.equal(all.cost,1.5e6);assert.equal(all.revenue,detail.revenue);
 const absent=d.orders.find((o:any)=>o.id==='week');assert.equal(absent.coveredRevenue,0);assert.equal(absent.cost,0);
});

test('draft eligibility follows signed/completed contract and excludes cancellation without duplicating revenue',async()=>{
 const f=await profitDateFixture();await f.db.update(salesOrders).set({status:'draft'}).where(eq(salesOrders.id,'today'));
 const stamp='2026-11-07T03:00:00Z';
 await f.db.insert(salesContracts).values({id:'contract',orderId:'today',contractNo:'CONTRACT',status:'draft',signedDate:'2026-11-07',legalEntity:'BN',createdBy:'mgr',createdAt:stamp,updatedAt:stamp});
 for(const status of ['draft','signed','completed','cancelled'] as const){
  await f.db.update(salesContracts).set({status}).where(eq(salesContracts.id,'contract'));
  const d=good(await f.call('/profit?from=2026-11-07&to=2026-11-07&compare=0&refresh=1',f.mgr));assert.equal(d.summary.orders,status==='signed'||status==='completed'?1:0);assert.equal(d.summary.revenue,status==='signed'||status==='completed'?1e6:0);
 }
});

test('all profit endpoints remain Manager only even with a warm shared cache and forged filters',async()=>{
 const f=await profitDateFixture(),q='/profit?from=2026-11-01&to=2026-11-07';good(await f.call(q,f.mgr));
 const routes:[string,string,unknown?][]=[[q,'GET'],[q+'&view=overview&owner=emp','GET'],['/profit/orders/today?costs=all','GET'],['/profit/missing-costs?from=2026-11-01&to=2026-11-07','GET'],['/profit/line-costs/line-today','PUT',{unitCost:1,reason:'unauthorised'}],['/profit/missing-costs','POST',{}],['/profit/cash-classes/missing','PUT',{}]];
 for(const positionId of ['sale','sale-admin','accounting','warehouse','sales-lock','sales-ml']){
  await f.db.update(employees).set({positionId}).where(eq(employees.id,'emp'));
  for(const[path,method,body]of routes){const r=await f.call(path,f.emp,method,body);assert.equal(r.status,403,positionId+':'+path);assert.equal(r.data.summary,undefined);assert.equal(r.data.lines,undefined);}
 }
 const supplier=(await f.call('/login','','POST',{email:'ncc@x.vn',password:PASSWORD})).cookie;
 for(const[path,method,body]of routes)assert.equal((await f.call(path,supplier,method,body)).status,403,'supplier:'+path);
 for(const[path,method,body]of routes)assert.equal((await f.call(path,'',method,body)).status,401,path);
 await f.db.update(employees).set({role:'employee',positionId:'sale'}).where(eq(employees.id,'mgr'));assert.equal((await f.call(q,f.mgr)).status,403,'cached Manager report cannot survive role downgrade');
});


test('only effective returns reduce original order period, quantity and COGS; pending/rejected returns do not',async()=>{
 const f=await profitDateFixture(),stamp='2026-12-01T03:00:00Z';
 await f.db.update(salesOrderLines).set({qty:10,unitPrice:100000}).where(eq(salesOrderLines.id,'line-today'));
 await f.db.update(salesLineCosts).set({unitCost:50000}).where(eq(salesLineCosts.orderLineId,'line-today'));
 for(const [id,status,effective,qty]of [['pending','pending',null,4],['rejected','rejected',null,4],['partial','completed',stamp,2]] as const){
  await f.db.insert(posReturns).values({id,returnNo:id,source:'crm',orderId:'today',warehouseId:'pos-wh',kind:'return',status,reason:'test return',sourceSnapshot:'{}',requestKey:id,createdBy:'mgr',createdAt:stamp,updatedAt:stamp,creditEffectiveAt:effective,subtotal:qty*100000,total:qty*100000});
  await f.db.insert(posReturnLines).values({id:'ret-'+id,returnId:id,orderLineId:'line-today',sku:'00123',name:'Hàng test',unit:'cái',requestedQty:qty,disposition:'restock',subtotal:qty*100000,tax:0,total:qty*100000});
 }
 const q='/profit?from=2026-11-07&to=2026-11-07&compare=0&refresh=1';
 const d=good(await f.call(q,f.mgr));assert.equal(d.summary.revenue,800000);assert.equal(d.summary.cost,400000);assert.equal(d.products[0].qty,8);
 assert.equal(good(await f.call('/profit?from=2026-12-01&to=2026-12-01&compare=0',f.mgr)).summary.revenue,0,'returns follow original order date per existing report contract');
 await f.db.update(posReturnLines).set({requestedQty:10,subtotal:1000000,total:1000000}).where(eq(posReturnLines.id,'ret-partial'));
 const full=good(await f.call(q,f.mgr));assert.equal(full.summary.revenue,0);assert.equal(full.summary.cost,0);assert.equal(full.summary.gross,0);
});

test('product/customer pagination preserves full totals and reuses one cached calculation across pages',async()=>{
 const f=await profitDateFixture(),stamp='2026-11-07T03:00:00Z';
 const ids=Array.from({length:301},(_,i)=>'page-'+i);
 await f.db.insert(salesOrders).values(ids.map(id=>({id,orderNo:id,quoteType:'HRC' as const,customerName:id,ownerId:'emp',createdBy:'emp',orderDate:'2026-11-07',status:'confirmed' as const,subtotal:1000,total:1000,createdAt:stamp,updatedAt:stamp})));
 await f.db.insert(salesOrderLines).values(ids.map(id=>({id:'l-'+id,orderId:id,lineNo:1,sku:id,name:id,qty:1,unitPrice:1000,amount:1000})));
 await f.db.insert(salesLineCosts).values(ids.map(id=>({orderLineId:'l-'+id,orderId:id,sku:id,unitCost:500,source:'manual' as const,confidence:'confirmed' as const,capturedAt:stamp})));
 const q='/profit?from=2026-11-01&to=2026-11-07&grain=month&chartGrain=day&compare=0';
 const first=good(await f.call(q,f.mgr)),next=good(await f.call(q+'&productsOffset=300&customersOffset=300',f.mgr));
 assert.equal(first.products.length,300);assert.equal(first.productsTotal,302);assert.equal(first.customersTotal,302);assert.equal(next.products.length,2);assert.equal(next.customers.length,2);
 assert.equal(next.cache.hit,true);assert.equal(next.cache.computedAt,first.cache.computedAt);assert.equal(next.summary.revenue,first.summary.revenue);assert.equal(first.summary.revenue,7_301_000);
 for(const key of ['products','customers'])assert.equal(sum(first[key],'revenue')+sum(next[key],'revenue'),first.summary.revenue);
 const clamped=good(await f.call(q+'&productsOffset=999&customersOffset=999',f.mgr));assert.equal(clamped.productsOffset,300);assert.equal(clamped.customersOffset,300);assert.equal(clamped.products.length,2);
 for(const key of ['productsOffset=-1','customersOffset=1.5','productsOffset=1000001'])assert.equal((await f.call(q+'&'+key,f.mgr)).status,400);
});


test('employee/customer-filtered branch view cannot substitute whole-branch net for selected orders',async()=>{
 const f=await profitDateFixture();await f.db.update(salesOrders).set({ownerId:'mgr'}).where(eq(salesOrders.id,'today'));
 const q='/profit?from=2026-11-01&to=2026-11-07&compare=0';
 const all=good(await f.call(q,f.mgr)),only=good(await f.call(q+'&owner=mgr',f.mgr));
 assert.equal(all.branchCosts.rows[0].net,3500000);assert.equal(only.branches[0].net,500000);assert.equal(only.summary.net,500000);assert.equal(only.branchCosts.filtered,true);assert.deepEqual(only.branchCosts.rows,[]);assert.equal(only.branchCosts.company,null);
});

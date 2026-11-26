import {eq} from 'drizzle-orm';
import {setupSalesPayroll} from './sales-payroll-fixture.ts';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
/** Synthetic equivalents of the three reported amounts; no customer data or production calls. */
export async function setupNoCommissionKpi(month='2026-10'){
 const f=await setupSalesPayroll();
 const [order]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,'liq-order'));
 const [line]=await f.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId,'liq-order'));
 await f.db.update(salesOrders).set({status:'cancelled'}).where(eq(salesOrders.id,order!.id));
 const amounts=[3250000,30200000,8500000];
 for(const [i,subtotal]of amounts.entries()){
  const id='no-commission-'+i,rows=i===1?[{sku:'CUP',name:'Cốc thử',qty:80,price:362500},{sku:'BAG',name:'Túi thử',qty:80,price:15000}]:[{sku:'TEST-'+i,name:'Hàng thử '+i,qty:1,price:subtotal}];
  await f.db.insert(quotations).values({id,creatorId:'emp',quoteNo:'BG-TEST-'+i,quoteType:'B2B',customer:'Khách thử',data:JSON.stringify({rows}),createdAt:f.stamp,updatedAt:f.stamp});
  await f.db.insert(salesOrders).values({...order!,id,orderNo:'DH-TEST-'+i,quoteId:id,quoteNo:'BG-TEST-'+i,orderDate:month+'-15',subtotal,tax:subtotal*.08,total:subtotal*1.08,status:'confirmed'});
  await f.db.insert(salesOrderLines).values(rows.map((r,j)=>({...line!,id:id+'-'+j,orderId:id,lineNo:j+1,sku:r.sku,name:r.name,qty:r.qty,unitPrice:r.price,amount:r.qty*r.price})));
 }
 await f.setPolicy(1,month,{appsheetKpiFrom:Number(month.replace('-','')),saleKpiNetFrom:Number(month.replace('-',''))});await f.salary();
 return {...f,amounts,total:amounts.reduce((a,b)=>a+b,0),detailUrl:'/dashboard/kpi/detail?from='+month+'&to='+month+'&month='+month+'&member=emp&metric=revenue'};
}

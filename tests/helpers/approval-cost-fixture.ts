import {eq} from 'drizzle-orm';
import type {AnyDb} from '../../src/core/db/client.ts';
import {salesOrders} from '../../src/modules/sales/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {quoteLineCost} from '../../src/modules/sales/domain/line-cost.ts';
import {requiresPrinting} from '../../src/modules/quotes/domain/quote-math.ts';

/** Synthetic expense prerequisites for unrelated stock/debt/lifecycle tests.
 * Deliberately called at the approval site: does NOT bypass the real approval handler.
 * Cost validation tests use raw f.call and never this fixture helper.
 */
export async function approveFixtureOrder(f:{db:AnyDb;call:(...args:any[])=>Promise<any>},path:string,cookie:string|undefined,_method:string,body:any){
 const id=/^\/orders\/([^/]+)\/status$/.exec(path)?.[1];
 if(id){
  const [order]=await f.db.select().from(salesOrders).where(eq(salesOrders.id,id));
  const [quote]=order?.quoteId?await f.db.select().from(quotations).where(eq(quotations.id,order.quoteId)):[];
  if(quote){
   const doc=JSON.parse(quote.data);
   for(const row of doc.rows||[]){
    if(!quoteLineCost(row,null)){row.costPrice=500;row.costMode='manual';delete row.purchaseDiscount;}
    if(requiresPrinting(row)&&!Number.isFinite(row.printing?.unitPrice)&&!Number.isFinite(doc.printing?.totalCost))row.printing={...row.printing,unitPrice:10};
   }
   doc.shipping={...doc.shipping,payer:doc.shipping?.payer||'receiver'};
   if(doc.shipping.payer==='sender'&&!(doc.shipping.cost>0))doc.shipping.cost=25000;
   // Fixture setup only: leave business revisions and audit expectations intact.
   await f.db.update(quotations).set({data:JSON.stringify(doc)}).where(eq(quotations.id,quote.id));
  }
 }
 return f.call(path,cookie,_method,body);
}

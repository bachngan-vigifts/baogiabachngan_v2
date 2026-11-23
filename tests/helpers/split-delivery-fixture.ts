import {approveFixtureOrder} from './approval-cost-fixture.ts';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setup} from './pos-fixture.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {warehouses,products} from '../../src/modules/catalog/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';
import {saveQuoteStockPlan} from '../../src/modules/sales/api/quote-sourcing-routes.ts';
export async function splitDeliveryFixture(dates:{stockDate?:string;incomingDate?:string;overallDate?:string}={}){
 const f=await setup(),id='split-delivery-order',quoteId='split-source-quote',now=new Date().toISOString();
 await f.db.update(employees).set({positionId:'sale'}).where(eq(employees.id,'emp'));
 await f.db.update(products).set({brand:'Minh Long'}).where(eq(products.sku,'00123'));
 await f.db.insert(warehouses).values({id:'source-other',name:'Kho bổ sung kiểm thử',kind:'stock'});
 await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:160,kind:'receipt',refType:'supplier_receipt',refId:'fixture-source-stock'}]);
 await f.db.insert(quotations).values({id:quoteId,creatorId:'emp',assigneeId:'emp',quoteNo:'BG_FIXTURE_SPLIT',quoteType:'B2B',customer:'Khách kiểm thử',data:JSON.stringify({type:'B2B',vat:0,rows:[{sku:'00123',name:'Ly sứ kiểm thử',qty:250,price:100000}]}),approvalStatus:'approved',createdAt:now,updatedAt:now});
 await f.db.insert(salesOrders).values({id,quoteId,orderNo:'DH_FIXTURE_SPLIT',quoteType:'B2B',customerId:f.customerId,customerName:'Khách chia đợt kiểm thử',ownerId:'emp',createdBy:'emp',warehouseId:'pos-wh',orderDate:'2026-11-13',expectedDeliveryDate:dates.overallDate||'2026-11-16',status:'draft',subtotal:25000000,total:25000000,createdAt:now,updatedAt:now});
 await f.db.insert(salesOrderLines).values({id:'split-line',orderId:id,lineNo:1,sku:'00123',name:'Ly sứ kiểm thử',unit:'Cái',qty:250,unitPrice:100000,amount:25000000});
 await f.db.transaction(tx=>saveQuoteStockPlan(tx,id,'emp',[{sku:'00123',qty:170,type:'stock',plannedDate:dates.stockDate||'2026-11-16'},{sku:'00123',qty:80,type:'incoming',note:'Nguồn bổ sung kiểm thử',plannedDate:dates.incomingDate||'2026-11-19'}]));
 const approved=await approveFixtureOrder(f,'/orders/'+id+'/status',f.mgr,'PUT',{status:'confirmed',verified:true,costWarningsReviewed:true});assert.equal(approved.status,200,JSON.stringify(approved.data));
 return {...f,id,quoteId};
}

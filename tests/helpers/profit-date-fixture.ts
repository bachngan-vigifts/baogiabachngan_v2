import {setup} from './pos-fixture.ts';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {salesLineCosts} from '../../src/modules/sales/line-cost-schema.ts';
export async function profitDateFixture(){
 const f=await setup(),stamp='2026-11-07T03:00:00Z';
 const rows=[['today','2026-11-07',1],['week','2026-11-02',2],['month','2026-11-01',4],['oct','2026-10-31',8],['jan','2026-01-01',16],['previous','2025-12-31',32],['future','2026-11-08',64]] as const;
 await f.db.insert(salesOrders).values(rows.map(([id,orderDate,m])=>({id,orderNo:'FILTER-'+id,quoteType:'HRC' as const,customerName:'Khách kiểm thử',ownerId:'emp',createdBy:'emp',orderDate,status:'confirmed' as const,subtotal:m*1e6,total:m*1e6,createdAt:stamp,updatedAt:stamp})));
 await f.db.insert(salesOrderLines).values(rows.map(([id,,m])=>({id:'line-'+id,orderId:id,lineNo:1,sku:'00123',name:'Ly kiểm thử',qty:1,unitPrice:m*1e6,amount:m*1e6})));
 await f.db.insert(salesLineCosts).values(rows.map(([id,,m])=>({orderLineId:'line-'+id,orderId:id,sku:'00123',unitCost:m*5e5,source:'manual' as const,confidence:'confirmed' as const,capturedAt:stamp,capturedBy:'mgr'})));
 return f;
}

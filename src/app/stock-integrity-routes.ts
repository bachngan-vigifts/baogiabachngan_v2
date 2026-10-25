import {and,desc,eq,inArray,sql} from 'drizzle-orm';
import {AppError} from '../core/errors.ts';
import {json,type Router} from '../core/http/router.ts';
import type {StaffEnv,SessionState} from '../modules/staff/api/auth-routes.ts';
import {salesOrders,salesOrderLines} from '../modules/sales/schema.ts';
import {crmStockFulfilment} from '../modules/sales/api/crm-stock-lifecycle.ts';
/** Read-only report. Never repairs a balance, assumes a source warehouse, or fabricates an export. */
export function registerStockIntegrityRoutes(router:Router<StaffEnv>){
 router.get('/warehouse-workflow-audit',async c=>{
  const member=(c.state.session as SessionState).member;
  if(member.role!=='manager')throw new AppError(403,'Chỉ Manager được đối soát quy trình kho.');
  const offset=Number(c.url.searchParams.get('offset')||0),limit=100;
  if(!Number.isSafeInteger(offset)||offset<0)throw new AppError(400,'Trang đối soát không hợp lệ.');
  const db=c.env.db;
  const [balances,receipts,orders,[total]]=await Promise.all([
   db.execute(sql`with ledger as (select sku,warehouse_id,sum(qty) qty from stock_moves group by sku,warehouse_id), mismatches as (
    select coalesce(b.sku,l.sku) sku,coalesce(b.warehouse_id,l.warehouse_id) warehouse_id,
     coalesce(b.qty,0) balance_qty,coalesce(l.qty,0) ledger_qty
    from stock_balances b full join ledger l using(sku,warehouse_id)
    where abs(coalesce(b.qty,0)-coalesce(l.qty,0))>0.0005)
    select (select count(*)::int from mismatches) total,coalesce((select jsonb_agg(to_jsonb(r)) from (select * from mismatches order by warehouse_id,sku limit 100 offset ${offset}) r),'[]'::jsonb) rows`),
   db.execute(sql`with expected as (
    select r.id receipt_id,r.receipt_no,r.shipment_id,r.warehouse,r.cancelled_at,l.sku,bool_or(r.client_key like 'import:%') legacy_import,
     case when r.cancelled_at is null then sum(l.good_qty) else 0 end expected_qty
    from supplier_receipts r join supplier_receipt_lines l on l.receipt_id=r.id
    group by r.id,r.receipt_no,r.shipment_id,r.warehouse,r.cancelled_at,l.sku), compared as (
    select e.*,w.id warehouse_id,coalesce((select sum(m.qty) from stock_moves m where m.ref_type='supplier_receipt' and m.ref_id=e.receipt_id and m.sku=e.sku and m.warehouse_id=w.id),0) posted_qty,
     exists(select 1 from stock_moves m where m.ref_type='supplier_receipt' and m.ref_id=e.receipt_id and m.sku=e.sku and m.warehouse_id is distinct from w.id group by m.warehouse_id having abs(sum(m.qty))>0.0005) wrong_warehouse
    from expected e left join warehouses w on w.kind='stock' and lower(trim(w.name))=lower(trim(e.warehouse)))
    select (select count(*)::int from compared where abs(expected_qty-posted_qty)>0.0005 or wrong_warehouse) total,
    coalesce((select jsonb_agg(to_jsonb(r)) from (select * from compared where abs(expected_qty-posted_qty)>0.0005 or wrong_warehouse order by receipt_id,sku limit 100 offset ${offset}) r),'[]'::jsonb) rows`),
   db.select({id:salesOrders.id}).from(salesOrders).where(and(eq(salesOrders.channel,'crm'),inArray(salesOrders.status,['delivering','delivered']),sql`exists(select 1 from ${salesOrderLines} where ${salesOrderLines.orderId}=${salesOrders.id} and ${salesOrderLines.sku}<>'')`))
    .orderBy(desc(salesOrders.createdAt),salesOrders.id).limit(limit).offset(offset),
   db.select({n:sql<number>`count(*)`.mapWith(Number)}).from(salesOrders).where(and(eq(salesOrders.channel,'crm'),inArray(salesOrders.status,['delivering','delivered']),sql`exists(select 1 from ${salesOrderLines} where ${salesOrderLines.orderId}=${salesOrders.id} and ${salesOrderLines.sku}<>'')`)),
  ]);
  const rows=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value:(value as {rows?:Record<string,unknown>[]}).rows??[];
  const balanceResult=rows(balances)[0],receiptResult=rows(receipts)[0];
  const balanceRows=(balanceResult?.rows??[]) as Record<string,unknown>[],receiptRows=(receiptResult?.rows??[]) as Record<string,unknown>[];
  const fulfilment=await crmStockFulfilment(db,orders.map(o=>o.id));
  const missing=[...fulfilment.values()].filter(o=>!o.complete).map(o=>({orderId:o.orderId,orderNo:o.orderNo,warehouseMissing:!o.warehouseId,
   lines:o.lines.filter(l=>l.missing>0.0005),link:'#/orders/'+encodeURIComponent(o.orderId)}));
  return json({readOnly:true,checkedAt:new Date().toISOString(),offset,limit,
   balances:{total:Number(balanceResult?.total??0),rows:balanceRows},
   receipts:{total:Number(receiptResult?.total??0),rows:receiptRows.map(r=>({...r,reason:r.legacy_import&&!r.warehouse_id?'LEGACY_IMPORT_MISSING_WAREHOUSE':'RECEIPT_LEDGER_MISMATCH',link:'#/purchases/'+encodeURIComponent(String(r.shipment_id))}))},
   dispatchedOrders:{scanned:orders.length,candidateTotal:total?.n??0,missingCountOnPage:missing.length,rows:missing,hasMore:offset+orders.length<(total?.n??0)},
   message:'Báo cáo chỉ đọc. Phiếu lịch sử nhập file thiếu kho và chứng từ cũ thiếu xác nhận xuất cần đối soát; không tự trừ bù hoặc đổi lịch sử.'});
 },'business');
}

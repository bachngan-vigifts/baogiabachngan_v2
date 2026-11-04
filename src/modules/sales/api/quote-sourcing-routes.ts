import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, type Router } from '../../../core/http/router.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { can } from '../../staff/domain/permissions.ts';
import { employees } from '../../staff/schema.ts';
import { warehouses } from '../../catalog/schema.ts';
import { readCatalogStock } from '../../catalog/api/stock-source.ts';
import { quoteStockSku } from '../../quotes/domain/quote-math.ts';
import { quotations } from '../../quotes/schema.ts';
import { quotationPredicate } from '../../quotes/api/department-access.ts';
import { hiddenWarehouseIds, sellableWarehouses, sellersConfigured } from '../../inventory/api/warehouse-access.ts';
import { documentNumberPatterns } from '../../../core/document-number.ts';
import { nextDocNo, vietnamDate } from '../domain/sales.ts';
import { packingSlips, packingSlipLines, salesOrders, salesOrderLines } from '../schema.ts';
import { incomingLookup } from '../../inventory/api/routes.ts';
import { stockMoves } from '../../inventory/schema.ts';

/** Planning only: expose quantities, never supplier costs or another department's quote. */
export function registerQuoteSourcingRoutes(router: Router<StaffEnv>) {
  router.get('/quotes/:id/stock-plan', async c => {
    const db=c.env.db, member=(c.state.session as SessionState).member;
    const [quote]=await db.select().from(quotations).where(and(eq(quotations.id,c.params.id!),quotationPredicate(member))).limit(1);
    if(!quote) throw new AppError(404,'Không tìm thấy báo giá.');
    const data=JSON.parse(quote.data), needs=new Map<string,{sku:string;name:string;unit:string;qty:number}>();
    for(const row of data.rows||[]) {const sku=quoteStockSku(row),qty=Number(row.qty);if(!sku||!(qty>0))continue;
      const prior=needs.get(sku);needs.set(sku,{sku,name:String(row.name||sku),unit:String(row.unit||''),qty:(prior?.qty||0)+qty});}
    const hidden=await hiddenWarehouseIds(db,member),configured=await sellersConfigured(db);
    const [owner]=await db.select({role:employees.role,positionId:employees.positionId}).from(employees).where(eq(employees.id,quote.assigneeId??quote.creatorId));
    const selling=await sellableWarehouses(db,!configured||member.role==='manager'?{role:'manager'}:owner??{role:''});
    const visible=(await db.select({id:warehouses.id,name:warehouses.name,kind:warehouses.kind}).from(warehouses).where(eq(warehouses.active,true)).orderBy(asc(warehouses.sortOrder),asc(warehouses.name))).filter(w=>!hidden.has(w.id));
    const opened=new Set((await db.selectDistinct({id:stockMoves.warehouseId}).from(stockMoves).where(eq(stockMoves.refType,'opening'))).map(w=>w.id));
    const stock=needs.size?await readCatalogStock(db,[...needs.keys()]):[];
    const incoming=needs.size&&incomingLookup.read?await incomingLookup.read(db,[...needs.keys()]):[];
    return json({quoteId:quote.id,quoteNo:quote.quoteNo,customerName:quote.customer,
      warehouses:visible.filter(w=>w.kind==='stock').map(w=>({id:w.id,name:w.name,opened:opened.has(w.id),canSell:selling.some(s=>s.id===w.id)})),
      canPurchase:can(member,'page.purchases'),canRequestEarly:can(member,'page.purchases')&&can(member,'purchases.early-request'),
      lines:[...needs.values()].map(line=>({...line,stock:Object.fromEntries(visible.filter(w=>w.kind==='stock').map(w=>[w.id,stock.find(s=>s.sku===line.sku&&s.warehouseId===w.id)?.quantity??0])),
        incoming:incoming.filter(s=>s.sku===line.sku).reduce((n,s)=>n+s.left,0)}))});
  },'business');
}


type Tx = Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
/** Persist the plan as separate packing drafts. Nothing is issued or sent to the warehouse here. */
export async function saveQuoteStockPlan(tx: Tx, orderId: string, by: string, raw: unknown) {
  if (raw === undefined) return;
  if (!Array.isArray(raw) || !raw.length || raw.length > 500) throw new AppError(400, 'Kế hoạch nguồn hàng không hợp lệ.');
  const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, orderId));
  if (!order?.warehouseId) throw new AppError(400, 'Chọn kho bán / kho xuất cho kế hoạch nguồn hàng.');
  const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, orderId)).orderBy(asc(salesOrderLines.lineNo));
  const needs = new Map<string, number>();
  for (const l of lines) if (l.sku) needs.set(l.sku, (needs.get(l.sku) || 0) + l.qty);
  const allocated = new Map<string, number>();
  const groups = new Map<string, {sku:string;qty:number;note:string}[]>();
  for (const x of raw) {
    if (!x || typeof x !== 'object') throw new AppError(400, 'Nguồn hàng không hợp lệ.');
    const sku = typeof x.sku === 'string' ? x.sku.trim() : '', qty = x.qty;
    if (!needs.has(sku) || typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0 || Math.abs(qty * 1000 - Math.round(qty * 1000)) > 0.00001 || !['stock','transfer','purchase','incoming'].includes(x.type))
      throw new AppError(400, 'Mã hàng, nguồn hoặc số lượng trong kế hoạch không hợp lệ.');
    const description = typeof x.note === 'string' ? x.note.trim().slice(0, 170) : '';
    if (x.type !== 'stock' && !description) throw new AppError(400, 'Ghi rõ nguồn cho phần hàng cần bổ sung.');
    const note = ({stock:'Hàng có sẵn',transfer:'Xin hàng',purchase:'Đặt hàng NCC',incoming:'Hàng đang chờ về'} as Record<string,string>)[x.type]! + (description ? ' · ' + description : '');
    allocated.set(sku, (allocated.get(sku) || 0) + qty);
    const key = x.type + ':' + note;
    groups.set(key, [...(groups.get(key) || []), {sku, qty, note}]);
  }
  for (const [sku, qty] of needs) if (Math.abs((allocated.get(sku) || 0) - qty) > 0.0005)
    throw new AppError(400, `${sku}: tổng nguồn hàng phải bằng số lượng đơn (${qty}).`, 'STOCK_PLAN_INVALID');
  const today = vietnamDate().iso, now = new Date().toISOString();
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'packing-number:' + today}))`);
  const used = (await tx.select({no:packingSlips.slipNo}).from(packingSlips).where(or(...documentNumberPatterns('DG',today).map(p=>sql`${packingSlips.slipNo} LIKE ${p}`)))).map(r=>r.no);
  const remaining = new Map(lines.map(l=>[l.id,l.qty]));
  for (const items of groups.values()) {
    const id = crypto.randomUUID(), slipNo = nextDocNo('DG',today,used); used.push(slipNo);
    await tx.insert(packingSlips).values({id,slipNo,orderId,source:'warehouse',sourceNote:items[0]!.note.slice(0,200),stockWarehouseId:order.warehouseId,
      status:'draft',totalQty:items.reduce((n,i)=>n+i.qty,0),note:'Kế hoạch từ báo giá: duyệt trước, xuất từng phần khi hàng thực có tại kho bán.',
      shipName:order.receiverName||order.customerName,shipAddress:order.address,shipPhone:order.receiverPhone||order.phone,createdBy:by,createdAt:now,updatedAt:now});
    for (const item of items) {
      let left = item.qty;
      for (const l of lines.filter(l=>l.sku===item.sku)) {
        const take = Math.min(left,remaining.get(l.id)||0); if (take <= 0) continue;
        await tx.insert(packingSlipLines).values({id:crypto.randomUUID(),slipId:id,orderLineId:l.id,sku:l.sku,name:l.name,unit:l.unit,qty:take});
        remaining.set(l.id,(remaining.get(l.id)||0)-take);left-=take;
      }
    }
  }
}


/** All CRM orders, including old orders without a warehouse/plan, use the same dispatch gate. */
export { assertCrmDispatch as assertPlannedDispatch } from './crm-stock-lifecycle.ts';

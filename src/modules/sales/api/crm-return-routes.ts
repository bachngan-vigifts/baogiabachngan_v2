import type {CrmReturnRestockSnapshot,CrmReturnRefundPreview} from '../../../core/contracts/crm-return.ts';
import {restockPortion} from '../domain/crm-return-restock.ts';
import {returnPurpose, requestedReturnPurpose} from '../domain/crm-return-purpose.ts';
import {redeliveryByLine} from './crm-redelivery.ts';
import {crmStockFulfilment} from './crm-stock-lifecycle.ts';
import {lockHolds} from './order-hold-store.ts';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { canApprove } from '../../staff/domain/permissions.ts';
import { employees } from '../../staff/schema.ts';
import { warehouses } from '../../catalog/schema.ts';
import { postMoves, assertWarehousesOpened } from '../../inventory/api/ledger.ts';
import { recordMovements } from '../../catalog/api/product-history.ts';
import { notifyMany } from '../../notifications/api/routes.ts';
import { salesOrders, salesOrderLines, packingSlips, packingSlipLines } from '../schema.ts';
import { posReturns, posReturnLines, posRefunds, posExchangeAllocations } from '../return-schema.ts';
import { posShifts } from '../pos-schema.ts';
import { cashDrawers, cashEntries } from '../cash-schema.ts';
import { cashAccess, cashAudit, cashLock, type CashDb } from './cash-store.ts';
import { posStoreScopeFor } from './pos-access.ts';
import { posKey, posText } from './pos-store.ts';
import { returnAccount, activeReservations } from './pos-return-credit.ts';
import { basisCovers, basisSkus, describeUnproven, unprovenRestock, verifyStockBasis, type StockBasis } from './crm-return-stock.ts';
import { returnPortion, returnBalance } from '../domain/pos-return-money.ts';
import { posMoney } from '../domain/pos-money.ts';
import { crmReturnAmounts } from '../domain/crm-return-money.ts';

type Ctx = RouteContext<StaffEnv>;
type Order = typeof salesOrders.$inferSelect;
type LoadOrder = (c: Ctx, id: string, db?: CashDb) => Promise<Order>;
const who = (c: Ctx) => (c.state.session as SessionState).member;
const now = () => new Date().toISOString();
const active = (status: string) => !['rejected', 'cancelled'].includes(status);
const lineSnapshot = (lines: (typeof salesOrderLines.$inferSelect)[]) => JSON.stringify(lines.map(l => ({ id: l.id, sku: l.sku, qty: l.qty, amount: l.amount, taxRate: l.taxRate })));
function approver(c: Ctx) { if (!canApprove(who(c))) throw new AppError(403, 'Cần Manager hoặc người được chỉ định duyệt.'); }
function refundAccess(c: Ctx) { approver(c); cashAccess(who(c)); }

export function registerCrmReturnRoutes(router: Router<StaffEnv>, loadOrder: LoadOrder) {
  async function source(c: Ctx, db: CashDb, lock = false) {
    const o = await loadOrder(c, c.params.id!, db);
    if (o.channel !== 'crm') throw new AppError(409, 'Đơn POS dùng chức năng trả hàng tại Bán hàng nhanh.');
    if (lock) await db.select({ id: salesOrders.id }).from(salesOrders).where(eq(salesOrders.id, o.id)).for('update');
    // Re-read through the same permission scope after obtaining the lock.
    const fresh = lock ? await loadOrder(c, o.id, db) : o;
    return fresh;
  }
  async function request(c: Ctx, db: CashDb) {
    const o = await source(c, db, true);
    const [r] = await db.select().from(posReturns).where(and(eq(posReturns.id, c.params.returnId!), eq(posReturns.orderId, o.id), eq(posReturns.source, 'crm'))).for('update');
    if (!r) throw new AppError(404, 'Không tìm thấy phiếu trả của đơn này.');
    return { o, r };
  }
  async function linesOf(db: CashDb, id: string) {
    return db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, id)).orderBy(asc(salesOrderLines.lineNo));
  }
  async function checkUnchanged(db: CashDb, o: Order, r: typeof posReturns.$inferSelect) {
    if (['draft', 'cancelled'].includes(o.status)) throw new AppError(409, 'Đơn không còn ở trạng thái được trả hàng.');
    const lines = await linesOf(db, o.id), snapshot = JSON.parse(r.sourceSnapshot);
    if (snapshot.lines !== lineSnapshot(lines) || snapshot.total !== o.total || snapshot.subtotal !== o.subtotal || snapshot.tax !== o.tax)
      throw new AppError(409, 'Dòng hàng/giá trị đơn đã thay đổi; cần huỷ phiếu chưa nhận và lập lại.');
    const all = await db.select().from(posReturns).where(eq(posReturns.orderId, o.id));
    const claims = all.filter(x => active(x.status) && !(x.receivedAt && returnPurpose(x.sourceSnapshot)==='redelivery'));
    const claimed = claims.length ? await db.select().from(posReturnLines).where(inArray(posReturnLines.returnId, claims.map(x => x.id))) : [];
    if (lines.some(l => claimed.filter(x => x.orderLineId === l.id).reduce((n, x) => n + x.requestedQty, 0) > l.deliveredQty + 1e-9))
      throw new AppError(409, 'Số trả đang giữ vượt lượng đã giao của đơn.');
    return lines;
  }
  async function checkWarehouse(c: Ctx, db: CashDb, id: string) {
    const scope = await posStoreScopeFor(db, who(c));
    if (scope && !scope.rows.some(x => scope.scope.registers.includes(x.r.id) && x.r.warehouseId === id)) throw new AppError(403, 'Kho không thuộc cửa hàng của bạn.');
    await assertWarehousesOpened(db, [id]);
  }
  /** Phần nhập lại vượt lượng đã xuất: bắt buộc Manager chọn căn cứ kiểm được (crm-return-stock.ts); lưu vào phiếu + nhật ký. */
  async function withStockBasis(db: CashDb, o: Order, r: typeof posReturns.$inferSelect, raw: unknown, by: string, required = false) {
    const snapshot = JSON.parse(r.sourceSnapshot), unproven = await unprovenRestock(db, o.id, r.id);
    if (!unproven.length) { if (required) throw new AppError(409, 'Phiếu không có phần nhập lại vượt lượng đã xuất, không cần căn cứ.'); return r.sourceSnapshot; }
    if (raw === undefined || raw === null) throw new AppError(409, 'Nhập lại vượt lượng đã xuất có chứng từ (' + describeUnproven(unproven) + '). Chọn căn cứ: giao trước ngày chốt tồn, hoặc phiếu điều chỉnh đã trừ bù; không có căn cứ thì từ chối phiếu và lập lại với tình trạng hàng hỏng (không nhập kho).', 'RETURN_STOCK_UNPROVEN');
    if (by && (await db.select({ role: employees.role }).from(employees).where(eq(employees.id, by)))[0]?.role !== 'manager') throw new AppError(403, 'Chỉ Manager xác nhận căn cứ nhập lại kho.');
    const basis = await verifyStockBasis(db, o, r, unproven, raw, by);
    await cashAudit(db, by, 'crm-return-stock-basis', 'pos-returns', r.id, { orderId: o.id, basis, unproven });
    return JSON.stringify({ ...snapshot, stockBasis: basis, stockBasisSkus: basisSkus(unproven) });
  }
  async function reopenForRedelivery(db: CashDb, o: Order, r: typeof posReturns.$inferSelect, lines: (typeof posReturnLines.$inferSelect)[]) {
    const [state,previous,packed]=await Promise.all([
      crmStockFulfilment(db,[o.id]),redeliveryByLine(db,[o.id]),
      db.select({lineId:packingSlipLines.orderLineId,qty:sql<number>`sum(${packingSlipLines.qty})`.mapWith(Number)}).from(packingSlipLines)
        .innerJoin(packingSlips,eq(packingSlips.id,packingSlipLines.slipId)).where(and(eq(packingSlips.orderId,o.id),eq(packingSlips.status,'packed'))).groupBy(packingSlipLines.orderLineId),
    ]);
    const issuedByLine:Record<string,number>={},packedByLine:Record<string,number>={};
    for(const line of lines){
      const qty=r.receivedAt?line.receivedQty:line.requestedQty;
      if(!(qty>0))throw new AppError(409,'Phiếu chưa có lượng hàng thực nhận hợp lệ.');
      issuedByLine[line.orderLineId]=Math.min(qty,state.get(o.id)?.lines.find(l=>l.lineId===line.orderLineId)?.issued??0);
      packedByLine[line.orderLineId]=Math.min(qty,Math.max(0,(packed.find(l=>l.lineId===line.orderLineId)?.qty??0)-(previous.get(line.orderLineId)?.packed??0)));
      const changed=await db.update(salesOrderLines).set({deliveredQty:sql`greatest(0,${salesOrderLines.deliveredQty}-${qty})`})
        .where(and(eq(salesOrderLines.id,line.orderLineId),eq(salesOrderLines.orderId,o.id),sql`${salesOrderLines.deliveredQty}+1e-9>=${qty}`)).returning({id:salesOrderLines.id});
      if(!changed.length)throw new AppError(409,'Số hàng đã giao vừa thay đổi, không mở giao lại vượt lượng thực nhận.');
    }
    const fresh=await linesOf(db,o.id),at=now();
    await db.update(salesOrders).set({status:fresh.some(l=>l.deliveredQty>0)?'delivering':'confirmed',revision:sql`${salesOrders.revision}+1`,updatedAt:at}).where(eq(salesOrders.id,o.id));
    return JSON.stringify({...JSON.parse(r.sourceSnapshot),returnPurpose:'redelivery',redeliveryIssuedByLine:issuedByLine,redeliveryPackedByLine:packedByLine});
  }
  // The GET preview and locked refund use the same account/per-return limits, including exchange reservations.
  function refundCap(o:Order,r:typeof posReturns.$inferSelect,a:Awaited<ReturnType<typeof returnAccount>>,reserved:number,afterReceive=false){
    if(returnPurpose(r.sourceSnapshot)==='redelivery'||!active(r.status))return 0;
    const extra=afterReceive&&!r.creditEffectiveAt?r.total:0;
    const available=returnBalance(o.total,a.paid,a.credit+extra,a.refunded,a.exchanged).available-reserved;
    const used=a.refunds.filter(x=>x.returnId===r.id).reduce((n,x)=>n+x.amount,0)+a.allocations.filter(x=>x.returnId===r.id&&x.status==='applied').reduce((n,x)=>n+x.amount,0);
    return Math.max(0,Math.min(available,r.total-used));
  }
  const base = '/orders/:id/returns';
  router.get(base, async c => {
    const db = c.env.db, o = await source(c, db), account = await returnAccount(db, o.id), lines = await linesOf(db, o.id);
    const scope = await posStoreScopeFor(db, who(c));
    const people = await db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, [...new Set(account.returns.flatMap(r => [r.createdBy, r.approvedBy, r.receivedBy].filter((x): x is string => !!x)) .concat(account.refunds.map(r => r.confirmedBy)))]));
    const names = new Map(people.map(x => [x.id, x.name]));
    const reserved=await activeReservations(db,account.allocations);
    const returns = await Promise.all(account.returns.map(async r => {
      const snapshot=JSON.parse(r.sourceSnapshot) as CrmReturnRestockSnapshot & {stockBasis?:StockBasis;refundRequest?:unknown};
      const lines=(await db.select().from(posReturnLines).where(eq(posReturnLines.returnId,r.id))).map(l=>{
        try{return {...l,plannedRestockQty:restockPortion(l,snapshot.unprovenDamagedByLine?.[l.orderLineId]),restockWarning:null};}
        catch(error){
          // A broken split must not hide the list (or the cancel action). Write paths still validate strictly.
          if(!(error instanceof AppError)||error.code!=='RETURN_STOCK_SPLIT_INVALID')throw error;
          return {...l,plannedRestockQty:null,restockWarning:error.message};
        }
      });
      const warning=lines.find(l=>l.restockWarning)?.restockWarning??null;
      return {...r,...({refundableAfterReceive:refundCap(o,r,account,reserved,true)} satisfies CrmReturnRefundPreview),purpose:returnPurpose(r.sourceSnapshot),refundRequest:snapshot.refundRequest??null,
        createdByName:names.get(r.createdBy),approvedByName:names.get(r.approvedBy||''),receivedByName:names.get(r.receivedBy||''),
        stockCheck:active(r.status)&&!r.receivedAt?{unproven:warning?[]:await unprovenRestock(db,o.id,r.id),basis:snapshot.stockBasis??null,warning}:null,
        lines,refunds:account.refunds.filter(x=>x.returnId===r.id).map(x=>({...x,confirmedByName:names.get(x.confirmedBy)}))};
    }));
    let canRefund = true; try { refundAccess(c); } catch { canRefund = false; }
    const whs = (await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.kind, 'stock'))).filter(w => !scope || scope.rows.some(x => scope.scope.registers.includes(x.r.id) && x.r.warehouseId === w.id));
    const drawers = canRefund ? (await db.select({ id: cashDrawers.id, name: cashDrawers.name }).from(cashDrawers)).filter(d => !scope || scope.scope.drawers.includes(d.id)) : [];
    return json({ order: { id: o.id, orderNo: o.orderNo, status: o.status, customerName: o.customerName, total: o.total, invoiceIssued: !!o.invoiceNo || o.invoiceStatus === 'issued' },
      lines: lines.map(l => ({ ...l, returnableQty: Math.max(0, l.deliveredQty - returns.filter(r => active(r.status) && !(r.receivedAt && r.purpose==='redelivery')).flatMap(r => r.lines).filter(x => x.orderLineId === l.id).reduce((n, x) => n + x.requestedQty, 0)) })),
      returns, account: { paid: account.paid, credit: account.credit, refunded: account.refunded, balance: account.balance, available: account.available }, warehouses: whs, drawers,
      canApprove: canApprove(who(c)), canRefund, viewerId: who(c).id, manager: who(c).role === 'manager' });
  }, 'business');

  router.post(base, async c => {
    const b = await readJson(c.req, 32000), key = posKey(b.key), reason = posText(b.reason, 2000), warehouseId = posText(b.warehouseId), purpose=requestedReturnPurpose(b.purpose);
    if (!reason || !warehouseId) throw new AppError(400, 'Chọn kho nhận và nhập lý do trả hàng.');
    // Đề nghị hoàn tiền nhân viên ghi lúc lập phiếu: chỉ là đề nghị, người duyệt xác nhận ở bước Duyệt & hoàn tất (không chi tiền ở đây).
    const ask: any = b.refundRequest, refundRequest = purpose === 'credit' && ask && Number(ask.amount) > 0 ? { amount: posMoney(ask.amount), method: ['cash', 'transfer'].includes(ask.method) ? ask.method as string : 'transfer', reference: posText(ask.reference, 200), note: posText(ask.note, 1000), by: who(c).id } : null;
    let created = false;
    const result = await c.env.db.transaction(async tx => {
      await cashLock(tx); const o = await source(c, tx, true);
      const [prior] = await tx.select().from(posReturns).where(eq(posReturns.requestKey, key));
      if (prior) { if (prior.source !== 'crm' || prior.orderId !== o.id || prior.createdBy !== who(c).id || JSON.parse(prior.sourceSnapshot).request !== JSON.stringify(b)) throw new AppError(409, 'Mã yêu cầu đã dùng cho nội dung khác.'); return prior; }
      if (['draft', 'cancelled'].includes(o.status)) throw new AppError(409, 'Chỉ trả phần hàng đã giao của đơn đang hiệu lực.');
      await checkWarehouse(c, tx, warehouseId);
      const old = await linesOf(tx, o.id), amounts = crmReturnAmounts(o, old);
      const rs = await tx.select().from(posReturns).where(eq(posReturns.orderId, o.id));
      const ids = rs.filter(r => active(r.status) && !(r.receivedAt && returnPurpose(r.sourceSnapshot)==='redelivery')).map(r => r.id);
      const claimed = ids.length ? await tx.select().from(posReturnLines).where(inArray(posReturnLines.returnId, ids)) : [];
      if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > old.length || new Set(b.lines.map((x: any) => x?.orderLineId)).size !== b.lines.length) throw new AppError(400, 'Chọn dòng hàng cần trả, không trùng.');
      const id = crypto.randomUUID(), at = now();
      const lines = b.lines.map((x: any) => {
        const l = old.find(l => l.id === x?.orderLineId);
        if (!l || !l.sku.trim() || !(l.deliveredQty > 0) || !['restock', 'damaged'].includes(x.disposition)) throw new AppError(400, 'Chọn mã đã giao và tình trạng hàng hợp lệ.');
        const prev = claimed.filter(p => p.orderLineId === l.id), qty = prev.reduce((n, p) => n + p.requestedQty, 0);
        returnPortion(0, l.deliveredQty, qty, x.qty, 0);
        const amount = amounts.get(l.id)!;
        const financial=purpose==='credit'?prev.filter(p=>returnPurpose(rs.find(r=>r.id===p.returnId)!.sourceSnapshot)==='credit'):[];
        const creditedQty=financial.reduce((n,p)=>n+p.requestedQty,0);
        const subtotal = returnPortion(amount.subtotal, l.qty, creditedQty, x.qty, financial.reduce((n,p)=>n+p.subtotal,0));
        const tax = returnPortion(amount.tax, l.qty, creditedQty, x.qty, financial.reduce((n,p)=>n+p.tax,0));
        return { id: crypto.randomUUID(), returnId: id, orderLineId: l.id, sku: l.sku, name: l.name, unit: l.unit, requestedQty: Number(x.qty), disposition: x.disposition, conditionNote: posText(x.conditionNote, 1000), subtotal, tax, total: subtotal + tax };
      });
      const [r] = await tx.insert(posReturns).values({ id, source: 'crm', returnNo: 'TH-CRM-' + id.slice(0, 8).toUpperCase(), orderId: o.id, warehouseId, registerId: null, createdShiftId: null, kind: 'return', requestContext: 'after_delivery', status: 'pending', reason,
        subtotal: lines.reduce((n: number, l: any) => n + l.subtotal, 0), tax: lines.reduce((n: number, l: any) => n + l.tax, 0), total: lines.reduce((n: number, l: any) => n + l.total, 0),
        sourceSnapshot: JSON.stringify({ returnPurpose:purpose, ...(refundRequest ? { refundRequest: { ...refundRequest, at } } : {}), lines: lineSnapshot(old), total: o.total, subtotal: o.subtotal, tax: o.tax, request: JSON.stringify(b) }), requestKey: key, createdBy: who(c).id, createdAt: at, updatedAt: at }).returning();
      await tx.insert(posReturnLines).values(lines); await cashAudit(tx, who(c).id, 'crm-request-return', 'pos-returns', id, { orderId: o.id, warehouseId, lines, reason }); created = true; return r!;
    });
    if (created) { const managers = await c.env.db.select({ id: employees.id }).from(employees).where(and(eq(employees.role, 'manager'), eq(employees.active, true), isNull(employees.deletedAt)));
      await notifyMany(c.env, managers.map(m => m.id).filter(id => id !== who(c).id), { eventType: 'crm_return_pending', title: 'Trả hàng CRM chờ duyệt', body: `${result.returnNo} · ${reason.slice(0, 120)}`, url: `/index.html#/orders/${result.orderId}?returns=1`, actorId: who(c).id, data: { returnId: result.id, orderId: result.orderId } }).catch(() => {}); }
    return json(result, 201);
  }, 'business');

  type Ret = typeof posReturns.$inferSelect;
  const reload = async (db: CashDb, id: string) => (await db.select().from(posReturns).where(eq(posReturns.id, id)).for('update'))[0]!;
  async function approveIn(c: Ctx, tx: CashDb, o: Order, r: Ret, stockBasis: unknown, note: string) {
    if (r.createdBy === who(c).id && who(c).role !== 'manager') throw new AppError(403, 'Người được chỉ định không tự duyệt phiếu của mình.');
    await checkUnchanged(tx, o, r); const at = now();
    const snapshot = await withStockBasis(tx, o, r, stockBasis, who(c).id);
    await tx.update(posReturns).set({ status: 'approved', approvedBy: who(c).id, approvedAt: at, approvalNote: note, updatedAt: at, sourceSnapshot: snapshot }).where(eq(posReturns.id, r.id));
    await cashAudit(tx, who(c).id, 'crm-approve-return', 'pos-returns', r.id, { orderId: o.id, note });
  }
  async function receiveIn(c: Ctx, tx: CashDb, o: Order, r: Ret, note: string) {
    if (r.status !== 'approved') throw new AppError(409, 'Phiếu chưa được duyệt.');
    await checkUnchanged(tx, o, r); await checkWarehouse(c, tx, r.warehouseId);
    // Kiểm lại lúc nhập kho: phiếu xuất / phiếu trả khác có thể đổi sau khi duyệt.
    const unproven = await unprovenRestock(tx, o.id, r.id);
    if (unproven.length && !basisCovers((JSON.parse(r.sourceSnapshot) as { stockBasis?: StockBasis }).stockBasis, unproven))
      throw new AppError(409, 'Nhập lại vượt lượng đã xuất có chứng từ (' + describeUnproven(unproven) + '). Manager cần chọn căn cứ trên phiếu trước khi nhận hàng.', 'RETURN_STOCK_UNPROVEN');
    const lines = await tx.select().from(posReturnLines).where(eq(posReturnLines.returnId, r.id)), at = now();
    const damaged=(JSON.parse(r.sourceSnapshot) as CrmReturnRestockSnapshot).unprovenDamagedByLine??{};
    const quantities=lines.map(l=>({line:l,restock:restockPortion(l,damaged[l.orderLineId])}));
    await postMoves(tx,who(c).id,quantities.filter(x=>x.restock>0).map(({line:l,restock})=>({sku:l.sku,warehouseId:r.warehouseId,qty:restock,kind:'customer_return' as const,refType:'pos_return' as const,refId:r.id,refNo:r.returnNo,note:r.reason})),at);
    await recordMovements(tx,quantities.flatMap(({line:l,restock})=>[
      {qty:restock,status:'Đã nhập lại kho',suffix:'restock'},
      {qty:l.requestedQty-restock,status:'Hàng hỏng, không nhập tồn bán',suffix:'damaged'},
    ].filter(x=>x.qty>0).map(x=>({refKey:`return:${r.id}:${l.id}:${x.suffix}`,sku:l.sku,name:l.name,qty:x.qty,unit:l.unit,unitPrice:l.subtotal/l.requestedQty,kind:'customer_return',partner:o.customerName,refCode:r.returnNo,link:'#/orders/'+o.id,status:x.status,occurredAt:at}))));
    for(const {line:l,restock} of quantities)await tx.update(posReturnLines).set({receivedQty:l.requestedQty,restockQty:restock}).where(eq(posReturnLines.id,l.id));
    const logistics=returnPurpose(r.sourceSnapshot)==='redelivery',snapshot=logistics?await reopenForRedelivery(tx,o,r,lines):r.sourceSnapshot;
    await tx.update(posReturns).set({ status: logistics?'completed':'processing', receivedBy: who(c).id, receivedAt: at, creditEffectiveAt: logistics?null:at, sourceSnapshot:snapshot, updatedAt: at }).where(eq(posReturns.id, r.id));
    await tx.update(salesOrders).set({ revision: sql`${salesOrders.revision}+1`, updatedAt: at }).where(eq(salesOrders.id, o.id));
    await cashAudit(tx, who(c).id, 'crm-receive-return', 'pos-returns', r.id, { orderId: o.id, warehouseId: r.warehouseId, lines, note });
  }
  type RefundInput = { key: string; amount: number; method: string; reference: string; drawerId: string; note: string };
  function refundInput(b: any): RefundInput {
    const x = { key: posKey(b.key), amount: posMoney(b.amount), method: posText(b.method), reference: posText(b.reference, 200), drawerId: posText(b.drawerId), note: posText(b.note, 2000) };
    if (b.confirmed !== true || x.amount <= 0 || !['cash', 'transfer'].includes(x.method) || x.method === 'transfer' && !x.reference || !x.drawerId) throw new AppError(400, 'Xác nhận số tiền thực hoàn, két và tham chiếu chuyển khoản.');
    return x;
  }
  async function refundIn(c: Ctx, tx: CashDb, o: Order, r: Ret, x: RefundInput) {
    const { key, amount, method, reference, drawerId } = x;
    const [prior] = await tx.select().from(posRefunds).where(eq(posRefunds.requestKey, key));
    if (prior) { if (prior.returnId !== r.id || prior.confirmedBy !== who(c).id || prior.amount !== amount || prior.method !== method || prior.reference !== reference || prior.drawerId !== drawerId) throw new AppError(409, 'Mã hoàn tiền đã dùng cho giao dịch khác.'); return { ...prior, replayed: true }; }
    const scope = await posStoreScopeFor(tx, who(c));
    if (scope && !scope.scope.drawers.includes(drawerId)) throw new AppError(403, 'Két không thuộc cửa hàng của bạn.');
    const [drawer] = await tx.select().from(cashDrawers).where(eq(cashDrawers.id, drawerId)); if (!drawer) throw new AppError(400, 'Chọn két hợp lệ.');
    if (!r.receivedAt || !r.approvedBy || !r.creditEffectiveAt || r.status !== 'processing') throw new AppError(409, 'Cần duyệt và thực nhận hàng trước khi hoàn tiền.');
    await checkUnchanged(tx, o, r);
    const a = await returnAccount(tx, o.id), reserved=await activeReservations(tx,a.allocations);
    if (amount > refundCap(o,r,a,reserved)) throw new AppError(409, 'Số hoàn vượt phần thực thu dư sau đối trừ công nợ.');
    const id = crypto.randomUUID(), at = now(), refundNo = 'HT-CRM-' + id.slice(0, 8).toUpperCase(); let shiftId: string | null = null, cashEntryId: string | null = null;
    if (method === 'cash') {
      const [s] = await tx.select().from(posShifts).where(and(eq(posShifts.memberId, who(c).id), eq(posShifts.cashDrawerId, drawerId), isNull(posShifts.closedAt))).for('update');
      if (!s) throw new AppError(409, 'Hoàn tiền mặt cần ca két của bạn đang mở ở két đã chọn. Mở ca trong POS, hoặc chọn hoàn chuyển khoản.', 'REFUND_SHIFT_REQUIRED');
      shiftId = s.id; cashEntryId = crypto.randomUUID();
        await tx.insert(cashEntries).values({ id: cashEntryId, entryNo: refundNo, drawerId, shiftId, kind: 'customer_refund', direction: 'out', amount, reason: `Hoàn ${r.returnNo}: ${r.reason}`, status: 'posted', approvalThresholdSnapshot: drawer.approvalThreshold, createdBy: who(c).id, createdAt: at, approvedBy: r.approvedBy, approvedAt: r.approvedAt, requestKey: key, updatedAt: at });
    }
    const [refund] = await tx.insert(posRefunds).values({ id, refundNo, returnId: r.id, shiftId, drawerId, method, amount, cashEntryId, reference, confirmationNote: x.note, confirmedBy: who(c).id, confirmedAt: at, requestKey: key, createdAt: at }).returning();
    await cashAudit(tx, who(c).id, 'crm-refund', 'pos-returns', r.id, { orderId: o.id, refundId: id, amount, method, reference, drawerId, shiftId }); return refund!;
  }
  /** Hoàn tất khi không còn tiền dư phải hoàn; trả về false nếu còn tiền phải xử lý. */
  async function completeIn(c: Ctx, tx: CashDb, o: Order, r: Ret, strict = true) {
    if (r.status !== 'processing' || !r.receivedAt) { if (strict) throw new AppError(409, 'Chưa nhận hàng trả.'); return false; }
    const a = await returnAccount(tx, o.id);
    // Applied exchange credit settles this return too. An active reservation alone is not settlement.
    if (refundCap(o,r,a,0)>0) { if (strict) throw new AppError(409, 'Còn tiền dư phải đối soát/hoàn trước khi hoàn tất.'); return false; }
    await tx.update(posReturns).set({ status: 'completed', updatedAt: now() }).where(eq(posReturns.id, r.id)); await cashAudit(tx, who(c).id, 'crm-complete-return', 'pos-returns', r.id, { orderId: o.id }); return true;
  }
  router.post(base + '/:returnId/approve', async c => {
    approver(c); const b = await readJson(c.req, 4000), note = posText(b.note, 2000);
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx); const { o, r } = await request(c, tx);
      if (r.status !== 'pending') { if (r.approvedBy === who(c).id && r.approvalNote === note && active(r.status)) return { id: r.id, replayed: true }; throw new AppError(409, 'Phiếu không còn chờ duyệt.'); }
      await approveIn(c, tx, o, r, b.stockBasis, note); return { id: r.id };
    }));
  }, 'business');
  /**
   * Một bước duy nhất cho người duyệt: duyệt → nhận hàng về kho → hoàn tiền (nếu có) → hoàn tất, trong cùng một giao dịch.
   * Làm tiếp từ bước phiếu đang dừng; lỗi ở bất kỳ bước nào thì không bước nào được ghi. Bấm lại an toàn (mã hoàn tiền chống lặp).
   * Phần nhập lại vượt lượng đã xuất có chứng từ: Manager chọn căn cứ, hoặc chọn "không cộng tồn" cho các dòng đó (ghi hàng hỏng).
   */
  router.post(base + '/:returnId/finalize', async c => {
    approver(c); const b: any = await readJson(c.req, 8000), note = posText(b.note, 2000);
    if (b.confirmed !== true) throw new AppError(400, 'Xác nhận đã nhận đủ hàng thực tế trên phiếu trước khi xử lý.');
    const refund = b.refund && Number(b.refund.amount) > 0 ? (refundAccess(c), refundInput({ ...b.refund, confirmed: true })) : null;
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx); await lockHolds(tx); const req = await request(c, tx), o = req.o; let r = req.r;
      if (r.status === 'completed') return { id: r.id, status: r.status, steps: [], replayed: true };
      if (!active(r.status)) throw new AppError(409, 'Phiếu đã huỷ/từ chối.');
      const steps: string[] = [];
      if (!r.receivedAt) {
        const unproven = await unprovenRestock(tx, o.id, r.id), basis = (JSON.parse(r.sourceSnapshot) as { stockBasis?: StockBasis }).stockBasis;
        if (unproven.length && !basisCovers(basis, unproven)) {
          if (b.unprovenAsDamaged === true) {
            const snapshot=JSON.parse(r.sourceSnapshot),damaged:Record<string,number>={...snapshot.unprovenDamagedByLine};
            const lines=await tx.select().from(posReturnLines).where(eq(posReturnLines.returnId,r.id));
            for(const x of unproven){
              const line=lines.find(l=>l.orderLineId===x.lineId)!;
              damaged[x.lineId]=Math.round(((damaged[x.lineId]??0)+Math.max(0,x.qty-(basis?.covered[x.lineId]??0)))*1000)/1000;
              if(restockPortion(line,damaged[x.lineId])===0)await tx.update(posReturnLines).set({disposition:'damaged'}).where(eq(posReturnLines.id,line.id));
            }
            await tx.update(posReturns).set({sourceSnapshot:JSON.stringify({...snapshot,unprovenDamagedByLine:damaged}),updatedAt:now()}).where(eq(posReturns.id,r.id));
            r=await reload(tx,r.id);
            await cashAudit(tx, who(c).id, 'crm-return-unproven-damaged', 'pos-returns', r.id, { orderId: o.id, unproven }); steps.push('no-restock');
          } else if (b.stockBasis != null) {
            if (r.status === 'approved') { const snapshot = await withStockBasis(tx, o, r, b.stockBasis, who(c).id, true); await tx.update(posReturns).set({ sourceSnapshot: snapshot, updatedAt: now() }).where(eq(posReturns.id, r.id)); r = await reload(tx, r.id); }
          } else throw new AppError(409, 'Nhập lại vượt lượng đã xuất có chứng từ (' + describeUnproven(unproven) + '). Chọn căn cứ nhập kho, hoặc chọn không cộng tồn cho các dòng này.', 'RETURN_STOCK_UNPROVEN');
        }
        if (r.status === 'pending') { await approveIn(c, tx, o, r, b.unprovenAsDamaged === true ? undefined : b.stockBasis, note); steps.push('approved'); r = await reload(tx, r.id); }
        await receiveIn(c, tx, o, r, note); steps.push('received'); r = await reload(tx, r.id);
      }
      if (r.status === 'processing') {
        if (refund) { await refundIn(c, tx, o, r, refund); steps.push('refunded'); }
        if (await completeIn(c, tx, o, r, false)) steps.push('completed');
      }
      r = await reload(tx, r.id); const a = await returnAccount(tx, o.id);
      return { id: r.id, status: r.status, steps, available: a.available };
    }));
  }, 'business');
  /** Manager bổ sung / đổi căn cứ nhập lại kho cho phiếu đã duyệt, chưa nhận hàng. */
  router.post(base + '/:returnId/stock-basis', async c => {
    approver(c); if (who(c).role !== 'manager') throw new AppError(403, 'Chỉ Manager xác nhận căn cứ nhập lại kho.');
    const b = await readJson(c.req, 4000);
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx); const { o, r } = await request(c, tx);
      if (r.status !== 'approved' || r.receivedAt) throw new AppError(409, 'Chỉ bổ sung căn cứ cho phiếu đã duyệt, chưa nhận hàng.');
      await checkUnchanged(tx, o, r);
      const snapshot = await withStockBasis(tx, o, r, b.stockBasis, who(c).id, true);
      await tx.update(posReturns).set({ sourceSnapshot: snapshot, updatedAt: now() }).where(eq(posReturns.id, r.id));
      return { id: r.id };
    }));
  }, 'business');
  router.post(base + '/:returnId/cancel', async c => {
    const b = await readJson(c.req, 4000), reason = posText(b.reason, 2000); if (!reason) throw new AppError(400, 'Nhập lý do huỷ/từ chối.');
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx); const { o, r } = await request(c, tx);
      if (r.createdBy !== who(c).id && !canApprove(who(c))) throw new AppError(403, 'Chỉ người lập hoặc người duyệt được huỷ phiếu chưa nhận.');
      if (!active(r.status)) return { id: r.id, replayed: true };
      if (r.receivedAt || !['pending', 'approved'].includes(r.status)) throw new AppError(409, 'Đã nhận hàng: không huỷ hoặc xoá lịch sử nhập kho.');
      await tx.update(posReturns).set({ status: r.createdBy === who(c).id ? 'cancelled' : 'rejected', updatedAt: now() }).where(eq(posReturns.id, r.id));
      await cashAudit(tx, who(c).id, 'crm-cancel-return', 'pos-returns', r.id, { orderId: o.id, reason }); return { id: r.id };
    }));
  }, 'business');
  router.post(base + '/:returnId/receive', async c => {
    const b = await readJson(c.req, 4000); if (b.confirmed !== true) throw new AppError(400, 'Chỉ xác nhận khi đã nhận đủ hàng thực tế trên phiếu.');
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx); await lockHolds(tx); const { o, r } = await request(c, tx);
      if (r.receivedAt) return { id: r.id, replayed: true };
      await receiveIn(c, tx, o, r, posText(b.note, 2000)); return { id: r.id };
    }));
  }, 'business');
  router.post(base+'/:returnId/redelivery',async c=>{
    if(who(c).role!=='manager')throw new AppError(403,'Chỉ Manager được chuyển phiếu trả sang nhận để giao lại.');
    const body=await readJson(c.req,4000),reason=posText(body.reason,2000);
    if(body.confirmed!==true||reason.length<5)throw new AppError(400,'Xác nhận nhận hàng để giao lại và ghi rõ lý do (ít nhất 5 ký tự).');
    return json(await c.env.db.transaction(async tx=>{
      await cashLock(tx);await lockHolds(tx);const {o,r}=await request(c,tx);
      if(returnPurpose(r.sourceSnapshot)==='redelivery')return{id:r.id,replayed:true};
      if(!active(r.status))throw new AppError(409,'Phiếu đã huỷ/từ chối.');
      const [refunds,allocations]=await Promise.all([
        tx.select({id:posRefunds.id}).from(posRefunds).where(eq(posRefunds.returnId,r.id)).limit(1),
        tx.select({id:posExchangeAllocations.id}).from(posExchangeAllocations).where(and(eq(posExchangeAllocations.returnId,r.id),inArray(posExchangeAllocations.status,['reserved','applied']))).limit(1),
      ]);
      if(refunds.length||allocations.length)throw new AppError(409,'Phiếu đã hoàn tiền hoặc dùng đổi hàng; cần kế toán đối soát, không tự chuyển sang giao lại.');
      await checkUnchanged(tx,o,r);
      const lines=await tx.select().from(posReturnLines).where(eq(posReturnLines.returnId,r.id));
      const snapshot=r.receivedAt?await reopenForRedelivery(tx,o,r,lines):JSON.stringify({...JSON.parse(r.sourceSnapshot),returnPurpose:'redelivery'}),at=now();
      await tx.update(posReturns).set({sourceSnapshot:snapshot,creditEffectiveAt:null,status:r.receivedAt?'completed':r.status,updatedAt:at}).where(eq(posReturns.id,r.id));
      await cashAudit(tx,who(c).id,'crm-return-to-redelivery','pos-returns',r.id,{orderId:o.id,reason,previousCreditEffectiveAt:r.creditEffectiveAt,restoredCredit:r.creditEffectiveAt?r.total:0,stockReplayed:false});
      return{id:r.id};
    }));
  },'business');
  router.post(base + '/:returnId/refund', async c => {
    refundAccess(c); const x = refundInput(await readJson(c.req, 6000));
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx); const { o, r } = await request(c, tx);
      return refundIn(c, tx, o, r, x);
    }), 201);
  }, 'business');
  router.post(base + '/:returnId/complete', async c => {
    await readJson(c.req, 1000);
    return json(await c.env.db.transaction(async tx => {
      await cashLock(tx); const { o, r } = await request(c, tx);
      if (r.status === 'completed') return { id: r.id, replayed: true };
      await completeIn(c, tx, o, r); return { id: r.id };
    }));
  }, 'business');
}

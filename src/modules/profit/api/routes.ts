/**
 * PHÂN TÍCH LỢI NHUẬN – khu vực `business`, CHỈ MANAGER (có giá vốn). Xem domain/profit.ts cho công thức.
 *  GET /profit?from&to&grain&branch&owner&customer   tổng quan + theo kỳ / chi nhánh / nhân viên / khách / sản phẩm / đơn
 *  GET /profit/orders/:id                            từng dòng của một đơn: giá bán, giá vốn (nguồn), in, hoa hồng
 * Chỉ đọc. Đơn tính như công nợ / doanh số: bỏ đơn huỷ; đơn nháp chỉ tính khi HĐKT đã ký.
 */
import { and, asc, eq, gte, inArray, isNotNull, lte, ne } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { deliveries, salesContracts, salesOrderLines, salesOrders } from '../../sales/schema.ts';
import { posRegisters, posShifts } from '../../sales/pos-schema.ts';
import { posReturnLines, posReturns } from '../../sales/return-schema.ts';
import { debtCounts } from '../../sales/domain/sales.ts';
import { quotations } from '../../quotes/schema.ts';
import { commissionOf, printingInfo, quoteStockSku, type QuoteDoc, type QuoteRow } from '../../quotes/domain/quote-math.ts';
import { productMovements } from '../../catalog/schema.ts';
import { salesLineCosts } from '../../sales/line-cost-schema.ts';
import { adjustLineCost } from '../../sales/api/line-costs.ts';
import { salesLineCostHistory } from '../../sales/line-cost-schema.ts';
import { LINE_COST_CONFIDENCE_LABEL } from '../../sales/domain/line-cost.ts';
import { posFeeFacts } from '../domain/pos-fees.ts';
import {
  COST_SOURCE_LABEL, GRAINS, applyOrderFees, emptyRow, bucketLabel, bucketOf, groupBy, groupByProduct, orderProfit, purchaseCostAt, type Grain, type LineInput, type OrderProfit,
} from '../domain/profit.ts';

type Ctx = Parameters<Parameters<Router<StaffEnv>['get']>[1]>[0];
const member = (c: Ctx) => (c.state.session as SessionState).member;
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const MAX_DAYS = 3 * 366;
const CRM_BRANCH = 'crm';
const parseDoc = (s: string | null): QuoteDoc | null => { try { const d = JSON.parse(s || 'null'); return d && Array.isArray(d.rows) ? d : null; } catch { return null; } };

function requireManager(c: Ctx) {
  if (member(c).role !== 'manager') throw new AppError(403, 'Chỉ Manager xem phân tích lợi nhuận (có giá vốn).');
}

/** Lợi nhuận từng đơn trong khoảng ngày đơn [from, to]. `orderIds` để lấy riêng một đơn. */
async function profitOrders(db: AnyDb, from: string, to: string, orderIds?: string[], onlyConfirmed = false) {
  const orders = await db.select({
    id: salesOrders.id, orderNo: salesOrders.orderNo, orderDate: salesOrders.orderDate, status: salesOrders.status, channel: salesOrders.channel,
    shiftId: salesOrders.shiftId, ownerId: salesOrders.ownerId, customerId: salesOrders.customerId, customerName: salesOrders.customerName,
    quoteType: salesOrders.quoteType, quoteData: quotations.data, posSnapshot: salesOrders.posSnapshot,
  }).from(salesOrders).leftJoin(quotations, eq(quotations.id, salesOrders.quoteId))
    .where(and(ne(salesOrders.status, 'cancelled'), orderIds ? inArray(salesOrders.id, orderIds) : and(gte(salesOrders.orderDate, from), lte(salesOrders.orderDate, to))));
  const ids = orders.map(o => o.id);
  if (!ids.length) return [];
  const shiftIds = [...new Set(orders.map(o => o.shiftId).filter((x): x is string => !!x))];
  const [lines, contracts, ships, returned, shifts, snaps, feeRefunds] = await Promise.all([
    db.select().from(salesOrderLines).where(inArray(salesOrderLines.orderId, ids)).orderBy(asc(salesOrderLines.lineNo)),
    db.select({ orderId: salesContracts.orderId, status: salesContracts.status }).from(salesContracts).where(and(inArray(salesContracts.orderId, ids), ne(salesContracts.status, 'cancelled'))),
    db.select({ orderId: deliveries.orderId, fee: deliveries.shippingFee }).from(deliveries).where(and(inArray(deliveries.orderId, ids), ne(deliveries.status, 'cancelled'))),
    // Hàng trả đã ghi nhận công nợ (creditEffectiveAt) mới trừ doanh thu / giá vốn.
    db.select({ orderLineId: posReturnLines.orderLineId, qty: posReturnLines.requestedQty, subtotal: posReturnLines.subtotal })
      .from(posReturnLines).innerJoin(posReturns, eq(posReturns.id, posReturnLines.returnId))
      .where(and(inArray(posReturns.orderId, ids), isNotNull(posReturns.creditEffectiveAt))),
    shiftIds.length ? db.select({ id: posShifts.id, registerId: posShifts.registerId }).from(posShifts).where(inArray(posShifts.id, shiftIds)) : [],
    db.select({ lineId: salesLineCosts.orderLineId, sku: salesLineCosts.sku, unitCost: salesLineCosts.unitCost, source: salesLineCosts.source, confidence: salesLineCosts.confidence })
      .from(salesLineCosts).where(inArray(salesLineCosts.orderId, ids)),
    // Phí dịch vụ / ship đã hoàn khi trả hàng (gồm VAT) – chỉ phiếu có hiệu lực công nợ.
    db.select({ orderId: posReturns.orderId, service: posReturns.approvedServiceFee, shipping: posReturns.approvedShippingFee }).from(posReturns)
      .where(and(inArray(posReturns.orderId, ids), isNotNull(posReturns.creditEffectiveAt))),
  ]);
  const snapOf = new Map(snaps.map(x => [x.lineId, x]));
  const skus = [...new Set(lines.map(l => l.sku).filter(Boolean))];
  const buys = skus.length ? await db.select({ sku: productMovements.sku, at: productMovements.occurredAt, price: productMovements.unitPrice }).from(productMovements)
    .where(and(inArray(productMovements.sku, skus), eq(productMovements.kind, 'purchase'), isNotNull(productMovements.unitPrice))) : [];
  const history = new Map<string, { at: string; price: number }[]>();
  for (const b of buys) (history.get(b.sku) ?? history.set(b.sku, []).get(b.sku)!).push({ at: b.at, price: Number(b.price) });
  const registerOf = new Map(shifts.map(s => [s.id, s.registerId]));
  const out: OrderProfit[] = [];
  for (const o of orders) {
    if (!debtCounts(o.status, contracts.find(k => k.orderId === o.id)?.status)) continue;
    const doc = parseDoc(o.quoteData), rows = (doc?.rows ?? []).filter(r => String(r.name || '').trim() && Number(r.qty) > 0);
    const mine = lines.filter(l => l.orderId === o.id);
    const printRows = rows.filter(r => doc && printingInfo({ type: doc.type, rows: [r] }).enabled);
    const docPrint = doc && !printRows.some(r => Number.isFinite(r.printing?.unitPrice)) ? Math.max(0, Number(doc.printing?.totalCost) || 0) : 0;
    const printQty = printRows.reduce((n, r) => n + Number(r.qty || 0), 0);
    const inputs: LineInput[] = mine.map(l => {
      // Dòng báo giá cùng vị trí, cùng mã + tên (như doanh số net KPI) – lệch thì không dùng số liệu báo giá cho dòng đó.
      const r: QuoteRow | undefined = rows[l.lineNo - 1];
      const match = !!r && quoteStockSku(r) === l.sku && String(r.name || '').trim() === l.name.trim();
      const ret = returned.filter(x => x.orderLineId === l.id);
      const snap = snapOf.get(l.id);
      const base: LineInput = { id: l.id, sku: l.sku, name: l.name, qty: l.qty, revenue: l.amount,
        snapshot: snap && snap.sku === l.sku ? { unitCost: snap.unitCost, source: snap.source, confidence: snap.confidence } : null,
        returnedQty: ret.reduce((n, x) => n + x.qty, 0), returnedRevenue: ret.reduce((n, x) => n + x.subtotal, 0) };
      if (!match || !doc) return base;
      const printing = printingInfo({ type: doc.type, rows: [r] }).enabled
        ? (Number.isFinite(r.printing?.unitPrice) ? Math.max(0, Number(r.printing!.unitPrice)) * l.qty : printQty > 0 ? docPrint * Number(r.qty || 0) / printQty * (l.qty / Math.max(1, Number(r.qty || 0))) : 0) : 0;
      const commission = commissionOf({ ...r, price: Math.max(0, l.unitPrice - (o.quoteType === 'HRC' ? 0 : Number(r.printFee || 0))), discount: 0, qty: l.qty });
      const cost = r.costPrice === undefined || r.costPrice === null ? undefined : Number(r.costPrice);
      return { ...base, quoteCost: cost, printingCost: Math.round(printing), commission };
    });
    const shippingCost = doc?.shipping?.payer === 'sender' ? ships.filter(s => s.orderId === o.id).reduce((n, s) => n + Math.max(0, s.fee || 0), 0) : 0;
    const branchId = o.channel === 'pos' && o.shiftId ? registerOf.get(o.shiftId) ?? 'pos' : CRM_BRANCH;
    const profit = orderProfit({ id: o.id, orderNo: o.orderNo, orderDate: o.orderDate, ownerId: o.ownerId, customerId: o.customerId, customerName: o.customerName, branchId, shippingCost },
      inputs, sku => purchaseCostAt(history.get(sku), o.orderDate), onlyConfirmed);
    if (o.channel === 'pos') {
      const refunded = feeRefunds.filter(r => r.orderId === o.id).reduce((n, r) => n + (r.service || 0) + (r.shipping || 0), 0);
      const f = posFeeFacts(o.posSnapshot, refunded);
      let ghnShipped = false; try { ghnShipped = !!JSON.parse(o.posSnapshot || '{}')?.ghn?.orderCode; } catch { /* bill lỗi dữ liệu */ }
      applyOrderFees(profit, { feeRevenue: f.feeRevenue, carrierFee: f.carrierFee, carrierUnknown: ghnShipped && !f.carrierKnown });
    }
    out.push(profit);
  }
  return out;
}

async function names(db: AnyDb, orders: readonly OrderProfit[]) {
  const ownerIds = [...new Set(orders.map(o => o.ownerId))], regIds = [...new Set(orders.map(o => o.branchId).filter(b => b !== CRM_BRANCH && b !== 'pos'))];
  const [people, regs] = await Promise.all([
    ownerIds.length ? db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, ownerIds)) : [],
    regIds.length ? db.select({ id: posRegisters.id, name: posRegisters.name }).from(posRegisters).where(inArray(posRegisters.id, regIds)) : [],
  ]);
  const owner = new Map(people.map(p => [p.id, p.name])), reg = new Map(regs.map(r => [r.id, r.name]));
  return { owner: (id: string) => owner.get(id) ?? id, branch: (id: string) => id === CRM_BRANCH ? 'Văn phòng / CRM' : id === 'pos' ? 'Quầy POS (không rõ quầy)' : reg.get(id) ?? id };
}

export function registerProfitRoutes(router: Router<StaffEnv>) {
  router.get('/profit', async c => {
    requireManager(c);
    const q = c.url.searchParams, from = q.get('from'), to = q.get('to'), grain = (q.get('grain') || 'month') as Grain;
    if (!isDay(from) || !isDay(to) || from > to) throw new AppError(400, 'Khoảng ngày không hợp lệ.');
    if ((Date.parse(to) - Date.parse(from)) / 86400_000 > MAX_DAYS) throw new AppError(400, 'Khoảng ngày tối đa 3 năm.');
    if (!GRAINS.includes(grain)) throw new AppError(400, 'Kỳ không hợp lệ (ngày / tuần / tháng / năm).');
    const costs = q.get('costs') === 'confirmed' ? 'confirmed' : 'all';
    const all = await profitOrders(c.env.db, from, to, undefined, costs === 'confirmed'), n = await names(c.env.db, all);
    const branch = q.get('branch') || '', owner = q.get('owner') || '', customer = q.get('customer') || '';
    const orders = all.filter(o => (!branch || o.branchId === branch) && (!owner || o.ownerId === owner) && (!customer || o.customerId === customer));
    const [summary] = groupBy(orders, () => 'all', () => 'Tổng');
    const customerKey = (o: OrderProfit) => o.customerId ?? `name:${o.customerName}`;
    const customerName = new Map(orders.map(o => [customerKey(o), o.customerName]));
    return json({
      from, to, grain, costs, costSources: COST_SOURCE_LABEL, confidenceLabels: LINE_COST_CONFIDENCE_LABEL,
      summary: summary ?? emptyRow('all', 'Tổng'),
      direct: { printing: orders.reduce((s, o) => s + o.printing, 0), commission: orders.reduce((s, o) => s + o.commission, 0), shipping: orders.reduce((s, o) => s + o.shipping, 0) },
      cardFees: { available: false, note: 'CRM chưa ghi nhận thanh toán thẻ / phí cổng thanh toán – chưa tính.' },
      series: groupBy(orders, o => bucketOf(o.orderDate, grain), k => bucketLabel(k, grain), 'key'),
      branches: groupBy(orders, o => o.branchId, n.branch),
      owners: groupBy(orders, o => o.ownerId, n.owner),
      customers: groupBy(orders, customerKey, k => customerName.get(k) ?? k).slice(0, 300),
      products: groupByProduct(orders).slice(0, 300),
      orders: [...orders].sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.revenue - a.revenue).slice(0, 500)
        .map(o => ({ id: o.id, orderNo: o.orderNo, orderDate: o.orderDate, customerName: o.customerName, ownerName: n.owner(o.ownerId), branch: n.branch(o.branchId),
          revenue: o.revenue, cost: o.cost, direct: o.printing + o.commission + o.shipping, gross: o.gross, margin: o.coveredRevenue > 0 ? o.gross / o.coveredRevenue : null, missingLines: o.missingLines,
          feeRevenue: o.feeRevenue, carrierFee: o.carrierFee, net: o.net, carrierUnknown: o.carrierUnknown })),
      ordersTotal: orders.length,
      filterOptions: { branches: groupBy(all, o => o.branchId, n.branch).map(r => ({ id: r.key, name: r.label })), owners: groupBy(all, o => o.ownerId, n.owner).map(r => ({ id: r.key, name: r.label })) },
    });
  }, 'business');

  router.get('/profit/orders/:id', async c => {
    requireManager(c);
    const [o] = await profitOrders(c.env.db, '', '', [String(c.params.id)]);
    if (!o) throw new AppError(404, 'Không tìm thấy đơn (hoặc đơn không tính doanh số).');
    const n = await names(c.env.db, [o]);
    const [snaps, history] = await Promise.all([
      c.env.db.select({ lineId: salesLineCosts.orderLineId, revision: salesLineCosts.revision, costAt: salesLineCosts.costAt, capturedAt: salesLineCosts.capturedAt, note: salesLineCosts.note })
        .from(salesLineCosts).where(eq(salesLineCosts.orderId, o.id)),
      c.env.db.select().from(salesLineCostHistory).where(eq(salesLineCostHistory.orderId, o.id)).orderBy(asc(salesLineCostHistory.at)),
    ]);
    const actors = await names(c.env.db, history.filter(h => h.actorId).map(h => ({ ownerId: h.actorId!, branchId: CRM_BRANCH } as OrderProfit)));
    return json({ ...o, ownerName: n.owner(o.ownerId), branch: n.branch(o.branchId), margin: o.coveredRevenue > 0 ? o.gross / o.coveredRevenue : null,
      lines: o.lines.map(l => { const s = snaps.find(x => x.lineId === l.id);
        return { ...l, costSourceLabel: COST_SOURCE_LABEL[l.costSource], confidenceLabel: l.confidence ? LINE_COST_CONFIDENCE_LABEL[l.confidence] : 'Thiếu',
          snapshot: s ? { revision: s.revision, costAt: s.costAt, capturedAt: s.capturedAt, note: s.note } : null,
          history: history.filter(h => h.orderLineId === l.id).map(h => ({ at: h.at, reason: h.reason, unitCost: h.unitCost, previousUnitCost: h.previousUnitCost, source: h.source,
            confidence: h.confidence, note: h.note, actor: h.actorId ? actors.owner(h.actorId) : 'Hệ thống' })) }; }) });
  }, 'business');

  // Manager điều chỉnh giá vốn một dòng (bắt buộc lý do; kiểm tra phiên bản); ghi lịch sử, mức tin cậy "chính xác".
  router.put('/profit/line-costs/:lineId', async c => {
    requireManager(c);
    const b = await readJson(c.req, 4_000);
    const r = await adjustLineCost(c.env.db, String(c.params.lineId), { unitCost: Number(String(b.unitCost ?? '').replace(/[^\d.]/g, '')), reason: String(b.reason ?? ''),
      revision: b.revision === null || b.revision === undefined ? null : Number(b.revision) }, member(c).id);
    return json({ ok: true, ...r });
  }, 'business');
}

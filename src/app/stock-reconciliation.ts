import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { AnyDb } from '../core/db/client.ts';
import { warehouses } from '../modules/catalog/schema.ts';
import { inventoryAdjustments, stockBalances, stockMoves } from '../modules/inventory/schema.ts';
import { deliveries, deliveryLines, salesContracts, salesOrderLines, salesOrders } from '../modules/sales/schema.ts';
import { posRegisters, webStoreOrders } from '../modules/sales/pos-schema.ts';
import { posReturns } from '../modules/sales/return-schema.ts';
import { crmStockFulfilment } from '../modules/sales/api/crm-stock-lifecycle.ts';

/**
 * HỒ SƠ ĐỐI SOÁT KHO LỊCH SỬ – CHỈ ĐỌC (docs/DOI-SOAT-KHO-LICH-SU.md).
 * Từng đơn CRM đang / đã giao thiếu bằng chứng xuất, đơn web đã hoàn thành chưa có liên kết xuất kho, tồn âm.
 * Mỗi dòng có phân loại + đề xuất để Manager duyệt riêng. Không ghi, không bù tồn, không đổi trạng thái chứng từ.
 */
export type LineClass = 'adjusted' | 'pre_opening' | 'needs_review';
export interface DossierLine { sku: string; name: string; qty: number; delivered: number; issued: number; missing: number; cls: LineClass; evidence: string }
export interface DossierOrder {
  orderId: string; orderNo: string; contractNo: string | null; customer: string; status: string; orderDate: string | null; warehouse: string | null;
  trips: { no: string; status: string; deliveredAt: string | null }[]; adjustments: { refNo: string; warehouse: string; reason: string; lines: { sku: string; qty: number }[] }[];
  returns: number; lines: DossierLine[];
}
export interface Dossier {
  generatedAt: string; openings: { warehouse: string; openedAt: string }[];
  orders: DossierOrder[]; web: { source: string; orderNo: string; status: string; ghnStatus: string; warehouse: string; updatedAt: string; lines: { sku: string; name: string; qty: number }[] }[];
  negative: { sku: string; warehouse: string; qty: number }[];
}

const vnDate = (iso: string | null | undefined) => !iso ? null : /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10);
const round = (n: number) => Math.round(n * 1000) / 1000;

export async function buildReconciliationDossier(db: AnyDb, now = new Date().toISOString()): Promise<Dossier> {
  const whs = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses);
  const whName = (id: string | null) => (id ? whs.find(w => w.id === id)?.name ?? id : null);
  const openingRows = await db.select({ id: stockMoves.warehouseId, at: sql<string>`min(${stockMoves.createdAt})` }).from(stockMoves)
    .where(eq(stockMoves.refType, 'opening')).groupBy(stockMoves.warehouseId);
  const openedOn = new Map(openingRows.map(o => [o.id, vnDate(o.at)!]));
  const firstOpening = [...openedOn.values()].sort()[0] ?? null;

  const candidates = await db.select({ id: salesOrders.id }).from(salesOrders)
    .where(and(eq(salesOrders.channel, 'crm'), inArray(salesOrders.status, ['delivering', 'delivered']),
      sql`exists(select 1 from ${salesOrderLines} l where l.order_id=${salesOrders.id} and l.sku<>'')`))
    .orderBy(asc(salesOrders.orderNo));
  const fulfil = await crmStockFulfilment(db, candidates.map(c => c.id));
  const gaps = [...fulfil.values()].filter(f => !f.complete);
  const ids = gaps.map(g => g.orderId);
  const [orders, lines, trips, tripLines, contracts, returns, adjustments] = ids.length ? await Promise.all([
    db.select().from(salesOrders).where(inArray(salesOrders.id, ids)),
    db.select().from(salesOrderLines).where(inArray(salesOrderLines.orderId, ids)),
    db.select().from(deliveries).where(inArray(deliveries.orderId, ids)),
    db.select({ deliveryId: deliveryLines.deliveryId, lineId: deliveryLines.orderLineId, qty: deliveryLines.qty }).from(deliveryLines)
      .innerJoin(deliveries, eq(deliveries.id, deliveryLines.deliveryId)).where(inArray(deliveries.orderId, ids)),
    db.select({ orderId: salesContracts.orderId, no: salesContracts.contractNo }).from(salesContracts).where(and(inArray(salesContracts.orderId, ids), ne(salesContracts.status, 'cancelled'))),
    db.select({ orderId: posReturns.orderId, n: sql<number>`count(*)`.mapWith(Number) }).from(posReturns).where(inArray(posReturns.orderId, ids)).groupBy(posReturns.orderId),
    db.select().from(inventoryAdjustments).where(eq(inventoryAdjustments.status, 'approved')),
  ]) : [[], [], [], [], [], [], []];

  const out: DossierOrder[] = [];
  for (const g of gaps) {
    const o = orders.find(x => x.id === g.orderId)!, myTrips = trips.filter(t => t.orderId === o.id);
    // Phiếu điều chỉnh nhắc đúng số đơn / số chuyến giao trong lý do hoặc số phiếu (căn cứ do người đối soát ghi khi bù).
    const keys = [o.orderNo, ...myTrips.map(t => t.deliveryNo)].filter(k => k && k.length >= 6);
    const adj = adjustments.filter(a => keys.some(k => a.reason.includes(k) || a.refNo.includes(k)))
      .map(a => ({ refNo: a.refNo, warehouse: whName(a.warehouseId)!, reason: a.reason, lines: JSON.parse(a.lines) as { sku: string; qty: number }[] }));
    const opening = (o.warehouseId && openedOn.get(o.warehouseId)) || firstOpening;
    const used = new Map<string, number>();
    const dl: DossierLine[] = g.lines.filter(l => l.missing > 0.0005).map(l => {
      const line = lines.find(x => x.id === l.lineId)!;
      const debit = adj.flatMap(a => a.lines).filter(a => a.sku === l.sku && a.qty < 0).reduce((n, a) => n - a.qty, 0) - (used.get(l.sku) ?? 0);
      if (debit + 0.0005 >= l.missing) {
        used.set(l.sku, (used.get(l.sku) ?? 0) + l.missing);
        return { sku: l.sku, name: line.name, qty: line.qty, delivered: line.deliveredQty, issued: l.issued, missing: l.missing, cls: 'adjusted' as const,
          evidence: 'Đã trừ bù bằng ' + adj.filter(a => a.lines.some(x => x.sku === l.sku && x.qty < 0)).map(a => `${a.refNo} (${a.warehouse})`).join(', ') };
      }
      const shipped = tripLines.filter(t => t.lineId === l.lineId).map(t => ({ ...t, trip: myTrips.find(x => x.id === t.deliveryId) }))
        .filter(t => t.trip?.status === 'delivered');
      const before = shipped.length ? shipped.every(t => (vnDate(t.trip!.deliveredAt) ?? '9999') < (opening ?? '0000'))
        : !!(o.orderDate && opening && o.orderDate < opening);
      if (before) return { sku: l.sku, name: line.name, qty: line.qty, delivered: line.deliveredQty, issued: l.issued, missing: l.missing, cls: 'pre_opening' as const,
        evidence: `Giao ${shipped.length ? shipped.map(t => vnDate(t.trip!.deliveredAt)).join(', ') : '(không có chuyến, đơn lập ' + o.orderDate + ')'} trước chốt tồn ${opening}` };
      return { sku: l.sku, name: line.name, qty: line.qty, delivered: line.deliveredQty, issued: l.issued, missing: l.missing, cls: 'needs_review' as const,
        evidence: shipped.length ? 'Giao ' + shipped.map(t => vnDate(t.trip!.deliveredAt)).join(', ') + (opening ? ` (sau chốt tồn ${opening})` : '') : 'Chưa có chuyến giao đã giao' };
    });
    out.push({ orderId: o.id, orderNo: o.orderNo, contractNo: contracts.find(c => c.orderId === o.id)?.no ?? null, customer: o.customerName, status: o.status,
      orderDate: o.orderDate, warehouse: whName(o.warehouseId), trips: myTrips.map(t => ({ no: t.deliveryNo, status: t.status, deliveredAt: t.deliveredAt })),
      adjustments: adj, returns: returns.find(r => r.orderId === o.id)?.n ?? 0, lines: dl });
  }

  const web = (await db.select({ w: webStoreOrders, warehouseId: posRegisters.warehouseId }).from(webStoreOrders)
    .innerJoin(posRegisters, eq(posRegisters.id, webStoreOrders.registerId)).where(eq(webStoreOrders.status, 'completed')).orderBy(asc(webStoreOrders.orderNo)))
    .filter(r => { const opened = openedOn.get(r.warehouseId); return !!opened && (vnDate(r.w.updatedAt) ?? '') >= opened; })
    .map(r => ({ source: r.w.source, orderNo: r.w.orderNo, status: r.w.status, ghnStatus: r.w.ghnStatus, warehouse: whName(r.warehouseId)!, updatedAt: r.w.updatedAt,
      lines: (() => { try { return (JSON.parse(r.w.lines) as { sku?: string; name?: string; quantity?: number }[]).map(l => ({ sku: String(l.sku ?? ''), name: String(l.name ?? ''), qty: Number(l.quantity) || 0 })); } catch { return []; } })() }));

  const negative = (await db.select().from(stockBalances).where(sql`${stockBalances.qty} < -0.0005`).orderBy(asc(stockBalances.warehouseId), asc(stockBalances.sku)))
    .map(b => ({ sku: b.sku, warehouse: whName(b.warehouseId)!, qty: round(b.qty) }));
  return { generatedAt: now, openings: [...openedOn].map(([id, at]) => ({ warehouse: whName(id)!, openedAt: at })), orders: out, web, negative };
}

const PROPOSAL: Record<LineClass, string> = {
  adjusted: 'Đã bù bằng phiếu điều chỉnh – không bù thêm. Khi khách trả: chọn căn cứ "phiếu điều chỉnh" này.',
  pre_opening: 'Giao trước chốt tồn – tồn chốt đã phản ánh, không bù. Khi khách trả: chọn căn cứ "giao trước chốt tồn".',
  needs_review: 'Cần xác minh kho thực xuất + chứng từ. Nếu xác nhận hàng đã ra khỏi kho sau chốt: Manager lập phiếu điều chỉnh (ghi rõ số đơn / chuyến) và duyệt. Không tự bù.',
};
const LABEL: Record<LineClass, string> = { adjusted: 'Đã bù (điều chỉnh)', pre_opening: 'Giao trước chốt tồn', needs_review: 'Cần xác minh' };
const cell = (v: unknown) => String(v ?? '').replaceAll('|', '/').replaceAll('\n', ' ');

/** Hồ sơ dạng Markdown: mỗi đơn một mục có ô duyệt riêng. */
export function renderDossierMarkdown(d: Dossier) {
  const out: string[] = [];
  const counts = (cls: LineClass) => d.orders.filter(o => o.lines.some(l => l.cls === cls)).length;
  out.push('# Hồ sơ đối soát kho lịch sử', '', `Lập lúc ${d.generatedAt} (chỉ đọc, không thay đổi dữ liệu). Mỗi đơn cần anh duyệt riêng trước khi xử lý qua chứng từ trong ứng dụng.`, '',
    '## Tóm tắt', '', '| Nhóm | Số lượng |', '|---|---|',
    `| Đơn CRM thiếu bằng chứng xuất | ${d.orders.length} |`, `| – có dòng đã bù bằng điều chỉnh | ${counts('adjusted')} |`,
    `| – có dòng giao trước chốt tồn | ${counts('pre_opening')} |`, `| – có dòng cần xác minh | ${counts('needs_review')} |`,
    `| Đơn web hoàn thành sau chốt tồn chưa có xuất kho | ${d.web.length} |`, `| Cặp mã × kho tồn âm | ${d.negative.length} |`, '',
    'Mốc chốt tồn đầu kỳ: ' + (d.openings.map(o => `${o.warehouse} ${o.openedAt}`).join('; ') || 'chưa có'), '');
  out.push('## A. Đơn CRM thiếu bằng chứng xuất', '');
  d.orders.forEach((o, i) => {
    out.push(`### A${i + 1}. ${o.contractNo ? o.contractNo + ' / ' : ''}${o.orderNo} · ${cell(o.customer)}`, '',
      `- Trạng thái: ${o.status} · ngày đơn ${o.orderDate ?? '—'} · kho bán: ${o.warehouse ?? 'chưa chọn'} · phiếu trả: ${o.returns}`,
      `- Chuyến giao: ${o.trips.map(t => `${t.no} (${t.status}${t.deliveredAt ? ' ' + vnDate(t.deliveredAt) : ''})`).join(', ') || 'không có'}`,
      `- Phiếu điều chỉnh liên quan: ${o.adjustments.map(a => `${a.refNo} (${a.warehouse}): ${a.lines.map(l => l.sku + ' ' + l.qty).join(', ')}`).join('; ') || 'không tìm thấy'}`, '',
      '| Mã | Tên | SL đơn | Đã giao | Đã xuất có chứng từ | Thiếu | Phân loại | Căn cứ | Đề xuất |', '|---|---|---|---|---|---|---|---|---|',
      ...o.lines.map(l => `| ${cell(l.sku)} | ${cell(l.name)} | ${l.qty} | ${l.delivered} | ${round(l.issued)} | ${round(l.missing)} | ${LABEL[l.cls]} | ${cell(l.evidence)} | ${PROPOSAL[l.cls]} |`), '',
      '**Duyệt:** ☐ Đồng ý đề xuất · ☐ Xử lý khác: ____________ · Người duyệt / ngày: ____________', '');
  });
  out.push('## B. Đơn web hoàn thành sau chốt tồn, chưa có xuất kho CRM', '',
    'Đề xuất chung: chờ phiếu xuất cho đơn web (việc 6). Trước đó, đối chiếu kiểm kê tại kho quầy; nếu xác nhận hàng đã ra khỏi kho, Manager lập phiếu điều chỉnh ghi rõ số đơn web và duyệt. Không tự trừ.', '',
    '| Nguồn | Đơn web | GHN | Kho | Cập nhật | Mã × SL | Duyệt |', '|---|---|---|---|---|---|---|',
    ...d.web.map(w => `| ${cell(w.source)} | ${cell(w.orderNo)} | ${cell(w.ghnStatus || '—')} | ${cell(w.warehouse)} | ${vnDate(w.updatedAt)} | ${w.lines.map(l => cell(l.sku) + ' × ' + l.qty).join(', ')} | ☐ |`), '');
  out.push('## C. Tồn âm', '', 'Sổ kho và số dư khớp nhưng âm: cần kiểm kê thực tế và chứng từ nguồn. Không tự nâng về 0.', '',
    '| Kho | Mã | Tồn | Duyệt |', '|---|---|---|---|', ...d.negative.map(n => `| ${cell(n.warehouse)} | ${cell(n.sku)} | ${n.qty} | ☐ |`), '');
  return out.join('\n');
}

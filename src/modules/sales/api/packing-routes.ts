import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { products } from '../../catalog/schema.ts';
import { notify } from '../../notifications/api/routes.ts';
import { packingSlipLines, packingSlipPhotos, packingSlips, salesOrderLines, salesOrders } from '../schema.ts';
import { PACKING_SOURCES, PACKING_STATUSES } from '../domain/statuses.ts';
import { PACKING_SOURCE_LABEL, packingSuggestion, type PackingSource } from '../domain/packing.ts';
import { nextDocNo, vietnamDate } from '../domain/sales.ts';
import { orderScopeFor } from './routes.ts';

/*
 * Phiếu đóng gói (xuất kho):
 *  - Nhân viên phụ trách đơn bấm "Yêu cầu đóng gói" và chia số lượng từng dòng theo nguồn hàng (kho / cửa hàng / NCC / đại lý…).
 *    Mỗi nguồn sinh một phiếu nháp, kèm gợi ý quy cách thùng + cân nặng từ danh mục sản phẩm.
 *  - "Gửi kho": phiếu chuyển sang `sent` → việc tự sinh cho nhóm Kho (tasks/api/auto-tasks.ts) + thông báo cho nhóm Kho.
 *  - Kho đóng xong bấm xác nhận kèm 1–3 ảnh (nén ở trình duyệt) → `packed`, việc tự hoàn thành, người lập phiếu được báo.
 * Kho (chức vụ `warehouse`) xem / xác nhận được mọi phiếu nhưng không xem được đơn; Manager làm được mọi việc.
 */
type Ctx = RouteContext<StaffEnv>;
type Member = SessionState['member'];
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();
const text = (v: unknown, max = 500) => { if (v !== undefined && v !== null && typeof v !== 'string') throw new AppError(400, 'Dữ liệu không hợp lệ.'); return String(v ?? '').trim().slice(0, max); };
export const isWarehouse = (m: { role: string; positionId?: string | null }) => m.role === 'employee' && m.positionId === 'warehouse';
const EPS = 1e-9;
/** Ảnh xác nhận: 1–3 ảnh JPEG / WebP / PNG dạng data URL, mỗi ảnh tối đa ~600 KB (đã nén ở trình duyệt). */
export const PHOTO_MIN = 1, PHOTO_MAX = 3, PHOTO_MAX_CHARS = 800_000;
const PHOTO_RE = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+=*$/;

async function loadOrder(c: Ctx, id: string) {
  const [order] = await c.env.db.select().from(salesOrders).where(and(eq(salesOrders.id, id), orderScopeFor(viewer(c)))).limit(1);
  if (!order) throw new AppError(404, 'Không tìm thấy đơn đặt hàng.');
  return order;
}
/** Phiếu + đơn của phiếu. Ai xem được: Manager, nhóm Kho, người xem được đơn. */
async function loadSlip(c: Ctx, id: string) {
  const m = viewer(c);
  const [row] = await c.env.db.select({ slip: packingSlips, order: salesOrders }).from(packingSlips).innerJoin(salesOrders, eq(salesOrders.id, packingSlips.orderId))
    .where(and(eq(packingSlips.id, id), m.role === 'manager' || isWarehouse(m) ? undefined : orderScopeFor(m))).limit(1);
  if (!row) throw new AppError(404, 'Không tìm thấy phiếu đóng gói.');
  return row;
}
/** Người lập / gửi / huỷ phiếu: Manager hoặc người xem được đơn (nhân viên phụ trách). Kho chỉ xác nhận. */
async function canManageOrder(c: Ctx, orderId: string) {
  const m = viewer(c);
  if (m.role === 'manager') return true;
  const [o] = await c.env.db.select({ id: salesOrders.id }).from(salesOrders).where(and(eq(salesOrders.id, orderId), orderScopeFor(m))).limit(1);
  return !!o;
}
const canConfirm = (m: Member, status: string) => status === 'sent' && (m.role === 'manager' || isWarehouse(m));

/** Số lượng đã đưa vào phiếu (chưa huỷ) theo từng dòng đơn. */
async function allocatedByLine(db: StaffEnv['db'], orderId: string) {
  const rows = await db.select({ lineId: packingSlipLines.orderLineId, qty: sql<number>`sum(${packingSlipLines.qty})` }).from(packingSlipLines)
    .innerJoin(packingSlips, eq(packingSlips.id, packingSlipLines.slipId))
    .where(and(eq(packingSlips.orderId, orderId), ne(packingSlips.status, 'cancelled'))).groupBy(packingSlipLines.orderLineId);
  return new Map(rows.map(r => [r.lineId, Number(r.qty) || 0]));
}
async function notifyWarehouse(c: Ctx, title: string, body: string, url: string) {
  const team = await c.env.db.select({ id: employees.id }).from(employees).where(and(eq(employees.positionId, 'warehouse'), eq(employees.active, true)));
  for (const t of team) await notify(c.env, { eventType: 'packing', title, body, url, targetMemberId: t.id, actorId: viewer(c).id });
}

export function registerPackingRoutes(router: Router<StaffEnv>) {
  /** Phiếu đóng gói của đơn + số lượng còn lại chưa đưa vào phiếu của từng dòng (cho hộp "Yêu cầu đóng gói"). */
  router.get('/orders/:id/packing', async c => {
    const db = c.env.db, order = await loadOrder(c, c.params.id!);
    const [slips, lines, allocated] = await Promise.all([
      db.select().from(packingSlips).where(eq(packingSlips.orderId, order.id)).orderBy(asc(packingSlips.createdAt)),
      db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id)).orderBy(asc(salesOrderLines.lineNo)),
      allocatedByLine(db, order.id),
    ]);
    const ids = slips.map(s => s.id);
    const [slipLines, photos, cartons] = await Promise.all([
      ids.length ? db.select().from(packingSlipLines).where(inArray(packingSlipLines.slipId, ids)) : [],
      ids.length ? db.select({ slipId: packingSlipPhotos.slipId, n: sql<number>`count(*)` }).from(packingSlipPhotos).where(inArray(packingSlipPhotos.slipId, ids)).groupBy(packingSlipPhotos.slipId) : [],
      lines.some(l => l.sku) ? db.select({ sku: products.sku, perCarton: products.perCarton, cartonWeight: products.cartonWeight, cartonLength: products.cartonLength,
        cartonWidth: products.cartonWidth, cartonHeight: products.cartonHeight }).from(products).where(inArray(products.sku, [...new Set(lines.map(l => l.sku).filter(Boolean))])) : [],
    ]);
    return json({
      slips: slips.map(s => ({ ...s, sourceLabel: PACKING_SOURCE_LABEL[s.source], lines: slipLines.filter(l => l.slipId === s.id), photoCount: Number(photos.find(p => p.slipId === s.id)?.n ?? 0) })),
      lines: lines.map(l => { const packed = allocated.get(l.id) ?? 0, c = cartons.find(x => x.sku === l.sku);
        return { id: l.id, sku: l.sku, name: l.name, unit: l.unit, qty: l.qty, delivered: l.deliveredQty, packed, left: Math.max(0, Math.round((l.qty - packed) * 1000) / 1000),
          perCarton: c?.perCarton ?? null, cartonWeight: c?.cartonWeight ?? null }; }),
      canRequest: order.status !== 'cancelled' && order.status !== 'draft',
    });
  }, 'business');

  /**
   * Lập phiếu đóng gói: `allocations` = [{orderLineId, qty, source, sourceNote}] – mỗi (nguồn, ghi chú nguồn) thành một phiếu nháp.
   * Tổng số lượng mỗi dòng không vượt phần chưa đưa vào phiếu.
   */
  router.post('/orders/:id/packing', async c => {
    const body = await readJson(c.req, 64_000), me = viewer(c), order = await loadOrder(c, c.params.id!);
    if (order.status === 'cancelled' || order.status === 'draft') throw new AppError(409, 'Đơn chưa xác nhận hoặc đã huỷ, chưa yêu cầu đóng gói được.');
    if (!Array.isArray(body.allocations) || !body.allocations.length || body.allocations.length > 500) throw new AppError(400, 'Chưa có dòng hàng nào để đóng gói.');
    const lines = await c.env.db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id));
    const allocated = await allocatedByLine(c.env.db, order.id);
    const want = new Map<string, number>();
    const items = (body.allocations as unknown[]).map(a => {
      const x = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>, line = lines.find(l => l.id === x.orderLineId), qty = Number(x.qty);
      if (!line) throw new AppError(400, 'Dòng hàng không thuộc đơn này.');
      if (!Number.isFinite(qty) || qty <= 0 || qty > 1e9) throw new AppError(400, `Số lượng của "${line.name}" không hợp lệ.`);
      if (!(PACKING_SOURCES as readonly string[]).includes(String(x.source))) throw new AppError(400, `Chọn nguồn hàng cho "${line.name}".`);
      const source = x.source as PackingSource, sourceNote = text(x.sourceNote, 200);
      if (source !== 'warehouse' && !sourceNote) throw new AppError(400, `Ghi rõ lấy "${line.name}" từ ${PACKING_SOURCE_LABEL[source].toLowerCase()} nào.`);
      want.set(line.id, (want.get(line.id) ?? 0) + qty);
      return { line, qty, source, sourceNote };
    });
    for (const [id, qty] of want) {
      const line = lines.find(l => l.id === id)!, left = line.qty - (allocated.get(id) ?? 0);
      if (qty > left + EPS) throw new AppError(400, `"${line.name}" chỉ còn ${left} ${line.unit} chưa đóng gói.`);
    }
    const skus = [...new Set(items.map(i => i.line.sku).filter(Boolean))];
    const cartons = skus.length ? await c.env.db.select({ sku: products.sku, perCarton: products.perCarton, cartonWeight: products.cartonWeight, cartonLength: products.cartonLength,
      cartonWidth: products.cartonWidth, cartonHeight: products.cartonHeight }).from(products).where(inArray(products.sku, skus)) : [];
    const groups = new Map<string, typeof items>();
    for (const i of items) { const k = `${i.source}\u0000${i.sourceNote.toLowerCase()}`; groups.set(k, [...(groups.get(k) ?? []), i]); }
    const today = vietnamDate().iso, now = nowIso(), note = text(body.note, 1000), created: { id: string; slipNo: string }[] = [];
    await c.env.db.transaction(async tx => {
      const used = (await tx.select({ n: packingSlips.slipNo }).from(packingSlips).where(sql`${packingSlips.slipNo} LIKE ${'DG_' + today.replaceAll('-', '') + '_%'}`)).map(r => r.n);
      for (const group of groups.values()) {
        const id = crypto.randomUUID(), slipNo = nextDocNo('DG', today, [...used, ...created.map(x => x.slipNo)]);
        const rows = group.map(i => { const s = packingSuggestion(i.qty, i.line.unit, cartons.find(x => x.sku === i.line.sku));
          return { id: crypto.randomUUID(), slipId: id, orderLineId: i.line.id, sku: i.line.sku, name: i.line.name, unit: i.line.unit, qty: i.qty,
            perCarton: s.perCarton, cartonWeight: s.cartonWeight, cartonSize: s.cartonSize, weight: s.weight }; });
        const weights = rows.map(r => r.weight);
        await tx.insert(packingSlips).values({ id, slipNo, orderId: order.id, source: group[0]!.source, sourceNote: group[0]!.sourceNote, status: 'draft', note,
          totalQty: rows.reduce((s, r) => s + r.qty, 0), totalWeight: weights.every(w => w !== null) ? Math.round(weights.reduce((s, w) => s + w!, 0) * 10) / 10 : null,
          createdBy: me.id, createdAt: now, updatedAt: now });
        await tx.insert(packingSlipLines).values(rows);
        created.push({ id, slipNo });
      }
    });
    return json({ slips: created }, 201);
  }, 'business');

  /** Chi tiết phiếu (trang #/packing/<id>): kho xem để đóng hàng; kèm ảnh xác nhận. */
  router.get('/packing/:id', async c => {
    const m = viewer(c), { slip, order } = await loadSlip(c, c.params.id!);
    const [lines, photos, people] = await Promise.all([
      c.env.db.select().from(packingSlipLines).where(eq(packingSlipLines.slipId, slip.id)),
      c.env.db.select({ id: packingSlipPhotos.id, dataUrl: packingSlipPhotos.dataUrl, createdAt: packingSlipPhotos.createdAt }).from(packingSlipPhotos).where(eq(packingSlipPhotos.slipId, slip.id)).orderBy(asc(packingSlipPhotos.createdAt)),
      c.env.db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, [slip.createdBy, slip.sentBy, slip.packedBy].filter((x): x is string => !!x))),
    ]);
    const name = (id: string | null) => (id ? people.find(p => p.id === id)?.name ?? '' : '');
    const manage = await canManageOrder(c, order.id);
    return json({
      slip: { ...slip, sourceLabel: PACKING_SOURCE_LABEL[slip.source], createdByName: name(slip.createdBy), sentByName: name(slip.sentBy), packedByName: name(slip.packedBy) },
      lines: lines.map(l => ({ ...l, suggestion: packingSuggestion(l.qty, l.unit, { perCarton: l.perCarton, cartonWeight: l.cartonWeight }).text })), photos,
      // Kho không xem được đơn: chỉ đưa thông tin cần để đóng & giao.
      order: { id: order.id, orderNo: order.orderNo, customerName: order.customerName, contact: order.contact, phone: order.phone, address: order.address, expectedDeliveryDate: order.expectedDeliveryDate },
      canOpenOrder: manage, canSend: manage && slip.status === 'draft', canCancel: manage && (slip.status === 'draft' || slip.status === 'sent'), canConfirm: canConfirm(m, slip.status),
    });
  }, 'business');

  /** Phiếu đang chờ kho đóng (nhóm Kho / Manager). */
  router.get('/packing', async c => {
    const m = viewer(c);
    if (m.role !== 'manager' && !isWarehouse(m)) throw new AppError(403, 'Chỉ nhóm Kho hoặc Manager xem được danh sách phiếu đóng gói.');
    const status = c.url.searchParams.get('status') || 'sent';
    const rows = await c.env.db.select({ slip: packingSlips, orderNo: salesOrders.orderNo, customerName: salesOrders.customerName, expectedDeliveryDate: salesOrders.expectedDeliveryDate })
      .from(packingSlips).innerJoin(salesOrders, eq(salesOrders.id, packingSlips.orderId))
      .where((PACKING_STATUSES as readonly string[]).includes(status) ? eq(packingSlips.status, status as typeof PACKING_STATUSES[number]) : undefined).orderBy(desc(packingSlips.updatedAt)).limit(200);
    return json({ slips: rows.map(r => ({ ...r.slip, sourceLabel: PACKING_SOURCE_LABEL[r.slip.source], orderNo: r.orderNo, customerName: r.customerName, expectedDeliveryDate: r.expectedDeliveryDate })) });
  }, 'business');

  /** Gửi phiếu nháp cho kho → việc "Đóng gói" cho nhóm Kho (tự sinh) + thông báo. */
  router.post('/packing/:id/send', async c => {
    const { slip, order } = await loadSlip(c, c.params.id!);
    if (!(await canManageOrder(c, order.id))) throw new AppError(403, 'Chỉ nhân viên phụ trách đơn hoặc Manager gửi được phiếu.');
    if (slip.status !== 'draft') throw new AppError(409, 'Phiếu đã gửi kho hoặc đã huỷ.');
    const now = nowIso();
    await c.env.db.update(packingSlips).set({ status: 'sent', sentAt: now, sentBy: viewer(c).id, updatedAt: now, revision: sql`${packingSlips.revision} + 1` })
      .where(and(eq(packingSlips.id, slip.id), eq(packingSlips.status, 'draft')));
    await notifyWarehouse(c, 'Kho: yêu cầu đóng gói', `${slip.slipNo} · ${order.customerName} (${PACKING_SOURCE_LABEL[slip.source]}${slip.sourceNote ? ': ' + slip.sourceNote : ''})`, `/index.html#/packing/${slip.id}`);
    return json({ ok: true });
  }, 'business');

  router.post('/packing/:id/cancel', async c => {
    const { slip, order } = await loadSlip(c, c.params.id!);
    if (!(await canManageOrder(c, order.id))) throw new AppError(403, 'Chỉ nhân viên phụ trách đơn hoặc Manager huỷ được phiếu.');
    if (slip.status !== 'draft' && slip.status !== 'sent') throw new AppError(409, 'Phiếu đã đóng hàng hoặc đã huỷ, không huỷ được.');
    await c.env.db.update(packingSlips).set({ status: 'cancelled', updatedAt: nowIso(), revision: sql`${packingSlips.revision} + 1` }).where(eq(packingSlips.id, slip.id));
    return json({ ok: true });
  }, 'business');

  /** Kho xác nhận đã đóng hàng: bắt buộc 1–3 ảnh. Người lập phiếu được báo; việc của kho tự hoàn thành. */
  router.post('/packing/:id/confirm', async c => {
    const m = viewer(c), body = await readJson(c.req, PHOTO_MAX * PHOTO_MAX_CHARS + 8_000), { slip, order } = await loadSlip(c, c.params.id!);
    if (!canConfirm(m, slip.status)) throw new AppError(slip.status === 'sent' ? 403 : 409, slip.status === 'sent' ? 'Chỉ nhóm Kho hoặc Manager xác nhận đóng hàng.' : 'Phiếu chưa gửi kho hoặc đã xác nhận.');
    const photos = Array.isArray(body.photos) ? body.photos : [];
    if (photos.length < PHOTO_MIN || photos.length > PHOTO_MAX) throw new AppError(400, `Chụp ${PHOTO_MIN}–${PHOTO_MAX} ảnh hàng đã đóng trước khi xác nhận.`);
    for (const p of photos) if (typeof p !== 'string' || p.length > PHOTO_MAX_CHARS || !PHOTO_RE.test(p)) throw new AppError(400, 'Ảnh không hợp lệ hoặc quá lớn. Chụp lại rồi thử lại.');
    const now = nowIso();
    await c.env.db.transaction(async tx => {
      const done = await tx.update(packingSlips).set({ status: 'packed', packedAt: now, packedBy: m.id, packedNote: text(body.note, 1000), updatedAt: now, revision: sql`${packingSlips.revision} + 1` })
        .where(and(eq(packingSlips.id, slip.id), eq(packingSlips.status, 'sent'))).returning({ id: packingSlips.id });
      if (!done.length) throw new AppError(409, 'Phiếu vừa được người khác xác nhận.');
      await tx.insert(packingSlipPhotos).values((photos as string[]).map(dataUrl => ({ id: crypto.randomUUID(), slipId: slip.id, dataUrl, bytes: Math.floor(dataUrl.length * 3 / 4), createdBy: m.id, createdAt: now })));
    });
    const to = slip.sentBy ?? slip.createdBy;
    if (to !== m.id) await notify(c.env, { eventType: 'packing_done', title: 'Kho đã đóng hàng', body: `${slip.slipNo} · ${order.orderNo} – ${order.customerName}`,
      url: `/index.html#/packing/${slip.id}`, targetMemberId: to, actorId: m.id });
    return json({ ok: true });
  }, 'business');
}

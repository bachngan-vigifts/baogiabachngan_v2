import { createScheduledDelivery } from './delivery-store.ts';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { can } from '../../staff/domain/permissions.ts';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import { foldSql, matchAllWords } from '../../../core/text/fold.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees } from '../../staff/schema.ts';
import { products, warehouses } from '../../catalog/schema.ts';
import { postMoves } from '../../inventory/api/ledger.ts';
import { customers } from '../../customers/schema.ts';
import { notify } from '../../notifications/api/routes.ts';
import { deliveries, packingSlipLines, packingSlipPhotos, packingSlips, salesOrderLines, salesOrders, salesContracts, shippingCarriers } from '../schema.ts';
import { quotations } from '../../quotes/schema.ts';
import { printingWorkshops as DEFAULT_WORKSHOPS } from '../../quotes/domain/quote-math.ts';
import { printingWorkshops } from '../../printing/schema.ts';
import { PACKING_SOURCES, PACKING_STATUSES } from '../domain/statuses.ts';
import { PACKING_SOURCE_LABEL, packingSuggestion, type PackingSource } from '../domain/packing.ts';
import { nextDocNo, vietnamDate } from '../domain/sales.ts';
import { docRef } from '../domain/doc-ref.ts';
import { orderScopeFor, setExpectedDeliveryDate } from './routes.ts';
import { closeSlipsOfDeliveredOrders } from './packing-close.ts';

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
type Tx = Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
const viewer = (c: Ctx) => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();
const text = (v: unknown, max = 500) => { if (v !== undefined && v !== null && typeof v !== 'string') throw new AppError(400, 'Dữ liệu không hợp lệ.'); return String(v ?? '').trim().slice(0, max); };
export const isWarehouse = (m: { role: string; positionId?: string | null }) => m.role === 'employee' && m.positionId === 'warehouse';
/** Kho đóng gói (quyền "Phiếu đóng gói" – trang Phân quyền): xem mọi phiếu, xác nhận đóng xong. */
const isPacker = (m: Member) => can(m, 'page.packing');
const EPS = 1e-9;
/** Ảnh xác nhận: 1–3 ảnh JPEG / WebP / PNG dạng data URL, mỗi ảnh tối đa ~600 KB (đã nén ở trình duyệt). */
export const PHOTO_MIN = 1, PHOTO_MAX = 3, PHOTO_MAX_CHARS = 800_000;
const PHOTO_RE = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+=*$/;

async function loadOrder(c: Ctx, id: string) {
  const [order] = await c.env.db.select().from(salesOrders).where(and(eq(salesOrders.id, id), orderScopeFor(viewer(c)))).limit(1);
  if (!order) throw new AppError(404, 'Không tìm thấy đơn hàng / HĐKT.');
  return order;
}
/** Phiếu + đơn của phiếu. Ai xem được: Manager, nhóm Kho, người xem được đơn. */
async function loadSlip(c: Ctx, id: string) {
  const m = viewer(c);
  const [row] = await c.env.db.select({ slip: packingSlips, order: salesOrders }).from(packingSlips).innerJoin(salesOrders, eq(salesOrders.id, packingSlips.orderId))
    .where(and(eq(packingSlips.id, id), isPacker(m) ? undefined : orderScopeFor(m))).limit(1);
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
const canConfirm = (m: Member, status: string) => status === 'sent' && isPacker(m);

/** Số lượng đã đưa vào phiếu (chưa huỷ) theo từng dòng đơn. */
async function allocatedByLine(db: StaffEnv['db'] | Tx, orderId: string) {
  const rows = await db.select({ lineId: packingSlipLines.orderLineId, qty: sql<number>`sum(${packingSlipLines.qty})` }).from(packingSlipLines)
    .innerJoin(packingSlips, eq(packingSlips.id, packingSlipLines.slipId))
    .where(and(eq(packingSlips.orderId, orderId), ne(packingSlips.status, 'cancelled'))).groupBy(packingSlipLines.orderLineId);
  return new Map(rows.map(r => [r.lineId, Number(r.qty) || 0]));
}
async function notifyWarehouse(c: Ctx, title: string, body: string, url: string) {
  const team = await c.env.db.select({ id: employees.id }).from(employees).where(and(eq(employees.positionId, 'warehouse'), eq(employees.active, true)));
  for (const t of team) await notify(c.env, { eventType: 'packing', title, body, url, targetMemberId: t.id, actorId: viewer(c).id });
}

/** Khoá so trùng tên (không dấu, chữ thường, gộp khoảng trắng) – như xưởng in. */
const nameKey = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim().replace(/\s+/g, ' ');
/** Đơn có phí in logo (dòng báo giá có printFee > 0) → mặc định giao về xưởng in. */
async function hasPrintFee(db: StaffEnv['db'], quoteId: string | null) {
  if (!quoteId) return false;
  const [q] = await db.select({ data: quotations.data }).from(quotations).where(eq(quotations.id, quoteId)).limit(1);
  try { return (JSON.parse(q?.data ?? '{}').rows ?? []).some((r: { printFee?: unknown }) => Number(r?.printFee) > 0); } catch { return false; }
}
async function workshopList(db: StaffEnv['db']) {
  const rows = await db.select({ name: printingWorkshops.name, address: printingWorkshops.address, phone: printingWorkshops.phone }).from(printingWorkshops).orderBy(asc(printingWorkshops.name));
  const keys = new Set(rows.map(r => nameKey(r.name)));
  return [...DEFAULT_WORKSHOPS.filter(n => !keys.has(nameKey(n))).map(name => ({ name, address: '', phone: '' })), ...rows];
}
/**
 * Thông tin giao hàng của phiếu: giao thẳng cho khách (địa chỉ giao của đơn) hoặc về xưởng in; gửi xe nào (tuỳ chọn).
 * Tên xưởng / nhà xe mới gõ trong ô → tự thêm vào danh sách (cập nhật địa chỉ / SĐT nếu đã có mà còn trống).
 */
async function readDelivery(c: Ctx, raw: unknown, order: typeof salesOrders.$inferSelect, db: StaffEnv['db'] | Tx = c.env.db) {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, me = viewer(c), now = nowIso();
  const shipTo = d.to === 'workshop' ? 'workshop' as const : 'customer' as const;
  const carrierName = text(d.carrierName, 120), carrierPhone = text(d.carrierPhone, 40);
  let shipName = text(d.name, 180), shipAddress = text(d.address, 1000), shipPhone = text(d.phone, 40);
  if (shipTo === 'workshop') {
    if (!shipName) throw new AppError(400, 'Chọn hoặc nhập xưởng in nhận hàng.');
    const key = nameKey(shipName), [old] = await db.select().from(printingWorkshops).where(eq(printingWorkshops.nameKey, key)).limit(1);
    if (!old) await db.insert(printingWorkshops).values({ id: crypto.randomUUID(), name: shipName, nameKey: key, address: shipAddress, phone: shipPhone, createdAt: now, createdBy: me.id }).onConflictDoNothing();
    else if ((!old.address && shipAddress) || (!old.phone && shipPhone)) await db.update(printingWorkshops).set({ address: old.address || shipAddress, phone: old.phone || shipPhone }).where(eq(printingWorkshops.id, old.id));
  } else {
    shipName = shipName || order.customerName; shipAddress = shipAddress || order.address; shipPhone = shipPhone || [order.contact, order.phone].filter(Boolean).join(' · ');
  }
  if (carrierName) {
    const key = nameKey(carrierName), [old] = await db.select().from(shippingCarriers).where(eq(shippingCarriers.nameKey, key)).limit(1);
    if (!old) await db.insert(shippingCarriers).values({ id: crypto.randomUUID(), name: carrierName, nameKey: key, phone: carrierPhone, createdBy: me.id, createdAt: now }).onConflictDoNothing();
    else if (carrierPhone && carrierPhone !== old.phone) await db.update(shippingCarriers).set({ phone: carrierPhone }).where(eq(shippingCarriers.id, old.id));
  }
  return { shipTo, shipName, shipAddress, shipPhone, carrierName, carrierPhone };
}

/** Đơn đã lên lịch giao (có chuyến chưa huỷ) mới yêu cầu đóng gói / in phiếu đóng gói, phiếu giao hàng được. */
export async function hasDeliverySchedule(db: StaffEnv['db'] | Tx, orderId: string) {
  return (await db.select({ id: deliveries.id }).from(deliveries).where(and(eq(deliveries.orderId, orderId), ne(deliveries.status, 'cancelled'))).limit(1)).length > 0;
}
export const NO_SCHEDULE = 'Lên lịch giao trước rồi mới yêu cầu đóng gói / in phiếu đóng gói, phiếu giao hàng.';

export function registerPackingRoutes(router: Router<StaffEnv>) {
  /** Danh sách nhà xe (chọn nhanh khi lập phiếu giao). */
  router.get('/shipping-carriers', async c => json({ carriers: await c.env.db.select({ name: shippingCarriers.name, phone: shippingCarriers.phone }).from(shippingCarriers).orderBy(asc(shippingCarriers.name)) }), 'business');

  /** Phiếu đóng gói của đơn + số lượng còn lại chưa đưa vào phiếu của từng dòng (cho hộp "Yêu cầu đóng gói"). */
  router.get('/orders/:id/packing', async c => {
    const db = c.env.db, order = await loadOrder(c, c.params.id!);
    const [slips, lines, allocated, schedules] = await Promise.all([
      db.select().from(packingSlips).where(eq(packingSlips.orderId, order.id)).orderBy(asc(packingSlips.createdAt)),
      db.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id)).orderBy(asc(salesOrderLines.lineNo)),
      allocatedByLine(db, order.id),
      db.select({ id: deliveries.id, deliveryNo: deliveries.deliveryNo, plannedDate: deliveries.plannedDate, timeSlot: deliveries.timeSlot, receiverName: deliveries.receiverName })
        .from(deliveries).where(and(eq(deliveries.orderId, order.id), inArray(deliveries.status, ['planned', 'in_transit']))).orderBy(asc(deliveries.plannedDate)),
    ]);
    const ids = slips.map(s => s.id);
    const [slipLines, photos, cartons] = await Promise.all([
      ids.length ? db.select().from(packingSlipLines).where(inArray(packingSlipLines.slipId, ids)) : [],
      ids.length ? db.select({ slipId: packingSlipPhotos.slipId, n: sql<number>`count(*)` }).from(packingSlipPhotos).where(inArray(packingSlipPhotos.slipId, ids)).groupBy(packingSlipPhotos.slipId) : [],
      lines.some(l => l.sku) ? db.select({ sku: products.sku, perCarton: products.perCarton, cartonWeight: products.cartonWeight, cartonLength: products.cartonLength,
        cartonWidth: products.cartonWidth, cartonHeight: products.cartonHeight }).from(products).where(inArray(products.sku, [...new Set(lines.map(l => l.sku).filter(Boolean))])) : [],
    ]);
    return json({
      slips: slips.map(s => ({ ...s, sourceLabel: PACKING_SOURCE_LABEL[s.source], photoCount: Number(photos.find(p => p.slipId === s.id)?.n ?? 0),
        lines: slipLines.filter(l => l.slipId === s.id).map(l => ({ ...l, suggestion: packingSuggestion(l.qty, l.unit, { perCarton: l.perCarton, cartonWeight: l.cartonWeight }).text })) })),
      // suggestion / cartonSize / weight: cho bản in phiếu đóng gói cả đơn (chưa chia phiếu).
      lines: lines.map(l => { const packed = allocated.get(l.id) ?? 0, c = cartons.find(x => x.sku === l.sku), s = packingSuggestion(l.qty, l.unit, c);
        return { id: l.id, sku: l.sku, name: l.name, unit: l.unit, qty: l.qty, delivered: l.deliveredQty, packed, left: Math.max(0, Math.round((l.qty - packed) * 1000) / 1000),
          perCarton: c?.perCarton ?? null, cartonWeight: c?.cartonWeight ?? null, suggestion: s.text, cartonSize: s.cartonSize, weight: s.weight }; }),
      schedules, scheduled: await hasDeliverySchedule(db, order.id),
      canRequest: !['cancelled', 'draft', 'delivered'].includes(order.status),
      // Hộp "Yêu cầu đóng gói - Giao hàng": có phí in → mặc định giao về xưởng in; không thì giao thẳng cho khách.
      delivery: { hasPrintFee: await hasPrintFee(db, order.quoteId), customer: { name: order.customerName, address: order.address, phone: [order.contact, order.phone].filter(Boolean).join(' · ') },
        workshops: await workshopList(db), carriers: await db.select({ name: shippingCarriers.name, phone: shippingCarriers.phone }).from(shippingCarriers).orderBy(asc(shippingCarriers.name)) },
    });
  }, 'business');

  /**
   * Lập phiếu đóng gói: `allocations` = [{orderLineId, qty, source, sourceNote}] – mỗi (nguồn, ghi chú nguồn) thành một phiếu nháp.
   * Tổng số lượng mỗi dòng không vượt phần chưa đưa vào phiếu.
   */
  router.post('/orders/:id/packing', async c => {
    const body = await readJson(c.req, 64_000), me = viewer(c), order = await loadOrder(c, c.params.id!);
    if (order.status === 'cancelled' || order.status === 'draft') throw new AppError(409, 'Đơn chưa xác nhận hoặc đã huỷ, chưa yêu cầu đóng gói được.');
    if (body.schedule !== undefined && (!body.schedule || typeof body.schedule !== 'object' || Array.isArray(body.schedule))) throw new AppError(400, 'Lịch giao hàng không hợp lệ.');
    if (body.sendToWarehouse !== undefined && typeof body.sendToWarehouse !== 'boolean') throw new AppError(400, 'Lựa chọn gửi kho không hợp lệ.');
    if (!body.schedule && !await hasDeliverySchedule(c.env.db, order.id)) throw new AppError(409, NO_SCHEDULE, 'NO_DELIVERY_SCHEDULE');
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
    const sentToWarehouse = body.sendToWarehouse === true && groups.size === 1;
    let deliveryId: string | null = null;
    await c.env.db.transaction(async tx => {
      const [locked] = await tx.select().from(salesOrders).where(eq(salesOrders.id, order.id)).limit(1).for('update');
      if (!locked || ['draft', 'cancelled', 'delivered'].includes(locked.status)) throw new AppError(409, 'Đơn chưa xác nhận, đã huỷ hoặc đã giao xong.');
      const allocatedNow = await allocatedByLine(tx, order.id);
      const freshLines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.orderId, order.id));
      for (const [id, qty] of want) {
        const line = freshLines.find(l => l.id === id);
        if (!line || qty > line.qty - (allocatedNow.get(id) ?? 0) + EPS) throw new AppError(409, 'Số lượng đóng gói vừa thay đổi. Tải lại đơn rồi thử lại.');
      }
      if (body.schedule) {
        const schedule = body.schedule as Record<string, unknown>;
        const made = await createScheduledDelivery(tx, order.id, { ...schedule, lines: [...want].map(([orderLineId, qty]) => ({ orderLineId, qty })) }, me.id);
        deliveryId = made.id;
      } else if (!await hasDeliverySchedule(tx, order.id)) throw new AppError(409, NO_SCHEDULE, 'NO_DELIVERY_SCHEDULE');
      const ship = await readDelivery(c, body.delivery, order, tx);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'packing-number:' + today}))`);
      const used = (await tx.select({ n: packingSlips.slipNo }).from(packingSlips).where(sql`${packingSlips.slipNo} LIKE ${'DG_' + today.replaceAll('-', '') + '_%'}`)).map(r => r.n);
      for (const group of groups.values()) {
        const id = crypto.randomUUID(), slipNo = nextDocNo('DG', today, [...used, ...created.map(x => x.slipNo)]);
        const rows = group.map(i => { const s = packingSuggestion(i.qty, i.line.unit, cartons.find(x => x.sku === i.line.sku));
          return { id: crypto.randomUUID(), slipId: id, orderLineId: i.line.id, sku: i.line.sku, name: i.line.name, unit: i.line.unit, qty: i.qty,
            perCarton: s.perCarton, cartonWeight: s.cartonWeight, cartonSize: s.cartonSize, weight: s.weight }; });
        const weights = rows.map(r => r.weight);
        await tx.insert(packingSlips).values({ id, slipNo, orderId: order.id, source: group[0]!.source, sourceNote: group[0]!.sourceNote, status: sentToWarehouse ? 'sent' : 'draft', sentAt: sentToWarehouse ? now : null, sentBy: sentToWarehouse ? me.id : null, note, ...ship,
          totalQty: rows.reduce((s, r) => s + r.qty, 0), totalWeight: weights.every(w => w !== null) ? Math.round(weights.reduce((s, w) => s + w!, 0) * 10) / 10 : null,
          createdBy: me.id, createdAt: now, updatedAt: now });
        await tx.insert(packingSlipLines).values(rows);
        created.push({ id, slipNo });
      }
    });
    if (deliveryId && body.schedule) await setExpectedDeliveryDate(c, order, (body.schedule as Record<string, unknown>).plannedDate as string);
    if (sentToWarehouse) for (const slip of created) await notifyWarehouse(c, 'Kho: yêu cầu đóng gói', `${slip.slipNo} · ${order.customerName}`, `/index.html#/packing/${slip.id}`);
    return json({ slips: created, sentToWarehouse, deliveryId }, 201);
  }, 'business');

  /** Chi tiết phiếu (trang #/packing/<id>): kho xem để đóng hàng; kèm ảnh xác nhận. */
  router.get('/packing/:id', async c => {
    const m = viewer(c), { slip, order } = await loadSlip(c, c.params.id!);
    const [lines, photos, people, contracts] = await Promise.all([
      c.env.db.select().from(packingSlipLines).where(eq(packingSlipLines.slipId, slip.id)),
      c.env.db.select({ id: packingSlipPhotos.id, dataUrl: packingSlipPhotos.dataUrl, createdAt: packingSlipPhotos.createdAt }).from(packingSlipPhotos).where(eq(packingSlipPhotos.slipId, slip.id)).orderBy(asc(packingSlipPhotos.createdAt)),
      c.env.db.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, [slip.createdBy, slip.sentBy, slip.packedBy].filter((x): x is string => !!x))),
      c.env.db.select({ contractNo: salesContracts.contractNo, legalEntity: salesContracts.legalEntity }).from(salesContracts).where(eq(salesContracts.orderId, order.id)).limit(1),
    ]);
    const [cust] = order.customerId ? await c.env.db.select({ code: customers.customerCode }).from(customers).where(eq(customers.id, order.customerId)).limit(1) : [];
    const name = (id: string | null) => (id ? people.find(p => p.id === id)?.name ?? '' : '');
    const manage = await canManageOrder(c, order.id);
    return json({
      slip: { ...slip, sourceLabel: PACKING_SOURCE_LABEL[slip.source], createdByName: name(slip.createdBy), sentByName: name(slip.sentBy), packedByName: name(slip.packedBy) },
      lines: lines.map(l => ({ ...l, suggestion: packingSuggestion(l.qty, l.unit, { perCarton: l.perCarton, cartonWeight: l.cartonWeight }).text })), photos,
      // Kho không xem được đơn: chỉ đưa thông tin cần để đóng & giao.
      order: { id: order.id, orderNo: order.orderNo, contractNo: contracts[0]?.contractNo ?? '', legalEntity: contracts[0]?.legalEntity ?? null, quoteType: order.quoteType, customerName: order.customerName, contact: order.contact, phone: order.phone, email: order.email, address: order.address,
        taxCode: order.taxCode, customerCode: cust?.code ?? '', note: order.note, expectedDeliveryDate: order.expectedDeliveryDate },
      canOpenOrder: manage, canSend: manage && slip.status === 'draft', canCancel: manage && (slip.status === 'draft' || slip.status === 'sent'), canConfirm: canConfirm(m, slip.status),
    });
  }, 'business');

  /**
   * Danh sách phiếu: nhóm Kho / Manager thấy mọi phiếu (mặc định phiếu chờ đóng); nhân viên khác thấy phiếu của đơn mình xem được
   * (dùng cho nút gửi phiếu trong tin nhắn). `status=all` = mọi trạng thái; `q` tìm số phiếu / số đơn / khách.
   */
  router.get('/packing', async c => {
    const m = viewer(c), all = isPacker(m), p = c.url.searchParams;
    const status = p.get('status') || (all ? 'sent' : 'all');
    // Dọn phiếu còn treo của đơn đã giao (kể cả dữ liệu cũ trước khi có tự hoàn tất).
    if (all) await closeSlipsOfDeliveredOrders(c.env.db);
    const rows = await c.env.db.select({ slip: packingSlips, orderNo: salesOrders.orderNo, contractNo: salesContracts.contractNo, customerName: salesOrders.customerName, expectedDeliveryDate: salesOrders.expectedDeliveryDate })
      .from(packingSlips).innerJoin(salesOrders, eq(salesOrders.id, packingSlips.orderId)).leftJoin(salesContracts, eq(salesContracts.orderId, packingSlips.orderId))
      .where(and(all ? undefined : orderScopeFor(m),
        (PACKING_STATUSES as readonly string[]).includes(status) ? eq(packingSlips.status, status as typeof PACKING_STATUSES[number]) : undefined,
        matchAllWords(foldSql(packingSlips.slipNo, salesOrders.orderNo, salesContracts.contractNo, salesOrders.customerName), p.get('q'))))
      .orderBy(desc(packingSlips.updatedAt)).limit(200);
    return json({ slips: rows.map(r => ({ ...r.slip, sourceLabel: PACKING_SOURCE_LABEL[r.slip.source], orderNo: r.orderNo, contractNo: r.contractNo ?? null, customerName: r.customerName, expectedDeliveryDate: r.expectedDeliveryDate })) });
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
    // Nguồn = Kho: bắt buộc chọn kho xuất → ghi phiếu xuất vào sổ kho (Sapo vẫn là nguồn tồn chính, sổ kho để đối chiếu).
    let stockWarehouseId: string | null = null;
    if (slip.source === 'warehouse') {
      const [w] = typeof body.warehouseId === 'string' ? await c.env.db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.id, body.warehouseId), eq(warehouses.kind, 'stock'), eq(warehouses.active, true))).limit(1) : [];
      if (!w) throw new AppError(400, 'Chọn kho xuất hàng.');
      stockWarehouseId = w.id;
    }
    const now = nowIso();
    await c.env.db.transaction(async tx => {
      const done = await tx.update(packingSlips).set({ status: 'packed', packedAt: now, packedBy: m.id, packedNote: text(body.note, 1000), stockWarehouseId, updatedAt: now, revision: sql`${packingSlips.revision} + 1` })
        .where(and(eq(packingSlips.id, slip.id), eq(packingSlips.status, 'sent'))).returning({ id: packingSlips.id });
      if (!done.length) throw new AppError(409, 'Phiếu vừa được người khác xác nhận.');
      await tx.insert(packingSlipPhotos).values((photos as string[]).map(dataUrl => ({ id: crypto.randomUUID(), slipId: slip.id, dataUrl, bytes: Math.floor(dataUrl.length * 3 / 4), createdBy: m.id, createdAt: now })));
      if (stockWarehouseId) {
        const lines = await tx.select({ sku: packingSlipLines.sku, qty: packingSlipLines.qty }).from(packingSlipLines).where(eq(packingSlipLines.slipId, slip.id));
        await postMoves(tx, m.id, lines.map(l => ({ sku: l.sku, warehouseId: stockWarehouseId!, qty: -l.qty, kind: 'issue' as const, refType: 'packing_slip' as const, refId: slip.id, refNo: slip.slipNo, note: `${order.orderNo} · ${order.customerName}` })), now);
      }
    });
    const to = slip.sentBy ?? slip.createdBy;
    const [k] = await c.env.db.select({ no: salesContracts.contractNo }).from(salesContracts).where(eq(salesContracts.orderId, order.id)).limit(1);
    if (to !== m.id) await notify(c.env, { eventType: 'packing_done', title: 'Kho đã đóng hàng', body: `${slip.slipNo} · ${docRef(order.id, order.orderNo, k?.no).Label} – ${order.customerName}`,
      url: `/index.html#/packing/${slip.id}`, targetMemberId: to, actorId: m.id });
    return json({ ok: true });
  }, 'business');
}

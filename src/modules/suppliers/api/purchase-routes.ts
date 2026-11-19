import { registerGoodsReturnRoutes } from './goods-return-routes.ts';
import { supplierOrderNumberProblem } from '../domain/order-number.ts';
import { lockReceiptForWrite } from './receipt-outbox.ts';
import {registerPurchaseSupplierSearch} from './purchase-supplier-search.ts';
import { earlyReceiptContext } from './early-receiving.ts';
import { queueReceiptJob, dispatchReceiptJob, registerReceiptJobRoutes } from './receipt-outbox.ts';
import { incomingBySkuView } from './incoming-view.ts';
import { receivingCalendar } from './receiving-calendar.ts';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { sha256Hex } from '../../staff/domain/session.ts';
import { AppError } from '../../../core/errors.ts';
import { sendMail } from '../../../core/mail/send-mail.ts';
import { postMoves, assertWarehousesOpened, lockLedger, reverseRef, stockWarehouseByName } from '../../inventory/api/ledger.ts';
import { discardPhotos, parsePhotos, photoUrls, recordPhotos, uploadPhotos, WH_PHOTO_MAX, WH_PHOTO_MAX_CHARS } from '../../inventory/api/photos.ts';
import { outstandingLines, syncIncomingStock } from './incoming-stock.ts';
import { purchaseProducts } from './purchase-products.ts';
import { can } from '../../staff/domain/permissions.ts';
import { incomingLookup } from '../../inventory/api/routes.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { products } from '../../catalog/schema.ts';
import { recordMovements, removeMovements } from '../../catalog/api/product-history.ts';
import { vietnamDate } from '../../sales/domain/sales.ts';
import { notify, notifyMany } from '../../notifications/api/routes.ts';
import {
  incomingShipmentLines, incomingShipments, supplierContacts, receiptJobs, supplierOrderEvents, supplierOrderSources, supplierPaymentSchedules, supplierPayments,
  supplierReceiptLines, supplierReceipts, suppliers,
} from '../schema.ts';
import { computeOrderTotals, purchaseUnitCost } from '../domain/order-totals.ts';
import { isIsoDate } from '../domain/quantity.ts';
import { canEditSuppliers, defaultRecipients } from '../domain/directory.ts';
import { canSendEarlyRequest, buildSchedules, canPay, canReceive, canSeePrices, canSeePurchasePrices, canUsePurchasing, checkPurchase, validateReceipt, type PurchaseAction } from '../domain/purchasing.ts';
import { asActor, listPurchases, purchaseCounts, supplierPayables, loadPurchase, responsibleEmails, loadSourceNeed, nextNumber, orderedBySource, sourceFamilies, ensureReceiptSourceBudget, sourceCandidates, sourceWithRemaining, type Db, type Member } from './purchase-store.ts';

/**
 * ĐƠN MUA HÀNG NCC (đợt 2) – khu vực 'business', quyền chi tiết kiểm trong domain/purchasing.ts.
 *  GET  /purchase-orders                 danh sách (?q, ?supplierId, ?state=draft|…|late|sapo|debt)
 *  GET  /purchase-orders/:id             chi tiết (giá ẩn với người không được xem)
 *  GET  /purchase-options                NCC đang hoạt động (để chọn)
 *  GET  /purchase-sources?q=             tìm báo giá / đơn-HĐKT / khách hỏi tồn để lập đơn mua
 *  GET  /purchase-sources/:type/:id      các mã của chứng từ + đã đặt + còn cần đặt (chống mua trùng)
 *  GET  /purchase-products?q=|skus=      sản phẩm + tồn Kho SR / Kho VIGIFTS / Hàng đang về (lập đơn mua bổ sung)
 *  POST /purchase-orders                 tạo 1..n đơn nháp (chia nhiều NCC) { orders: [...] }
 *  PUT  /purchase-orders/:id             sửa nháp (người tạo / Manager) – `revision`
 *  POST /purchase-orders/:id/send-email  gửi email đơn đặt hàng kèm PDF tới NCC từ máy chủ (Resend) – Manager / Kế toán, đơn đã duyệt
 *  POST /purchase-orders/:id/submit      người lập (hoặc Manager) gửi đơn nháp vào hàng chờ duyệt – `revision`
 *  POST /purchase-orders/:id/prices      Manager lưu giá nhập / CK / VAT khi chưa duyệt (đơn vẫn nháp) – `revision`
 *  POST /purchase-orders/:id/approve     Manager duyệt giá / chiết khấu / lịch trả
 *  POST /purchase-orders/:id/confirm     Manager ghi nhận xác nhận + ngày hẹn THAY NCC
 *  POST /purchase-orders/:id/cancel      huỷ (lý do bắt buộc)
 *  POST /purchase-orders/:id/receipts    kho / Manager ghi nhận hàng về từng đợt (`clientKey` chống bấm lặp)
 *  PUT  /supplier-receipts/:id/sapo      trạng thái nhập kho Sapo của phiếu nhận (đã nhập + mã phiếu / lỗi / không cần)
 *  POST /supplier-receipts/:id/cancel    Manager huỷ phiếu nhận (chưa nhập Sapo)
 *  PUT  /purchase-orders/:id/schedules   lịch trả (Manager / Kế toán)
 *  POST /purchase-orders/:id/payments    ghi một lần trả NCC + chứng từ (Manager / Kế toán, `clientKey`)
 *  POST /supplier-payments/:id/void      Manager huỷ khoản trả (giữ lịch sử)
 *  GET  /supplier-payments/:id/attachment  link tải chứng từ
 */
type Ctx = RouteContext<StaffEnv>;
const me = (c: Ctx): Member => (c.state.session as SessionState).member;
const nowIso = () => new Date().toISOString();
const today = () => vietnamDate().iso;
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim() : '').slice(0, max);
const fail = (status: number, message: string): never => { throw new AppError(status, message); };
function internalOrderNumber(value: unknown, supplierName = '', required = false): string {
  const problem = supplierOrderNumberProblem(supplierName, value, required);
  if (problem) fail(400, problem);
  return typeof value === 'string' ? value.trim() : '';
}
function deliveryAddress(value: unknown): string {
  const address = typeof value === 'string' ? value.trim() : '';
  if (!address) fail(400, 'Vui lòng nhập địa chỉ giao hàng.');
  if (address.length > 120) fail(400, 'Địa chỉ giao hàng tối đa 120 ký tự.');
  return address;
}
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function event(tx: Tx | Db, shipmentId: string, actorId: string, action: string, summary: string, data: Record<string, unknown> = {}) {
  await tx.insert(supplierOrderEvents).values({ id: crypto.randomUUID(), shipmentId, at: nowIso(), actorId, action, summary, data: JSON.stringify(data).slice(0, 8000) });
}

/** Khoá dòng đơn mua trong giao dịch rồi kiểm quyền thao tác trên dữ liệu MỚI NHẤT (chống hai người bấm cùng lúc). */
async function lockAndCheck(c: Ctx, tx: Tx, id: string, action: PurchaseAction, revision?: unknown) {
  const [locked] = await tx.select({ id: incomingShipments.id, revision: incomingShipments.revision }).from(incomingShipments).where(eq(incomingShipments.id, id)).limit(1).for('update');
  if (!locked) fail(404, 'Không tìm thấy đơn mua hàng.');
  const p = await loadPurchase(tx as unknown as Db, me(c), id, today());
  const flags = { approvalStatus: p.raw.order.approvalStatus, supplierStatus: p.raw.order.supplierStatus, cancelledAt: p.raw.order.cancelledAt, createdBy: p.raw.order.createdBy, submittedAt: p.raw.order.submittedAt };
  const ck = checkPurchase(action, asActor(me(c)), flags, { anyReceived: p.raw.progress.anyReceived, fullyReceived: p.raw.progress.fullyReceived, paid: p.raw.debt.paid });
  if (!ck.ok) fail(ck.status, ck.message);
  if (revision !== undefined && Number(revision) !== p.raw.order.revision) fail(409, 'Đơn mua vừa được người khác sửa. Tải lại rồi thử lại.');
  return p;
}
const bump = (tx: Tx, id: string, by: string, set: Partial<typeof incomingShipments.$inferInsert> = {}) =>
  tx.update(incomingShipments).set({ ...set, revision: sql`${incomingShipments.revision} + 1`, updatedAt: nowIso(), updatedBy: by }).where(eq(incomingShipments.id, id));
/** Chi tiết đơn mua cho trình duyệt: kèm link ảnh hàng hỏng của từng phiếu nhận. */
const poLabel = (v: { ticketNumber: string; supplier: { name: string } }) => `${v.ticketNumber} · ${v.supplier.name}`;

async function viewOf(c: Ctx, id: string) {
  // Mọi thao tác ghi trả về qua đây: cập nhật tồn "Hàng chờ về" theo số còn thiếu của các đơn mua (chỉ ghi phần đổi).
  await syncIncomingStock(c.env.db).catch(() => {});
  const v = (await loadPurchase(c.env.db, me(c), id, today())).view;
  const urls = await photoUrls(c.env.db, c.env.files, 'supplier_receipt', v.receipts.map(r => r.id));
  return { ...v, canReturn:v.canReturn&&!c.env.supplierReturnsDisabled,canRefund:v.canRefund&&!c.env.supplierReturnsDisabled, receipts: v.receipts.map(r => ({ ...r, photos: urls.get(r.id) ?? [] })) };
}
/** Dấu nội dung yêu cầu nhận hàng (không gồm ảnh: gửi lại có thể nén ảnh khác). */
function receiptRequestHash(body: Record<string, unknown>, createSapo: boolean) {
  const lines = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]).map(l => [String(l?.lineId ?? ''), Number(l?.goodQty ?? 0), Number(l?.damagedQty ?? 0), String(l?.note ?? '').trim()] as const)
    .sort(([a], [b]) => a.localeCompare(b)) : [];
  return sha256Hex(JSON.stringify([String(body.warehouse ?? '').trim().toLowerCase(), String(body.receivedDate ?? ''), createSapo, typeof body.earlyRequestId === 'string' ? body.earlyRequestId : null,
    String(body.note ?? '').trim(), lines]));
}
const lockSources = (tx: Tx) => tx.execute(sql`select pg_advisory_xact_lock(hashtext('supplier_order_sources'))`);

// ---------------------------------------------------------------- dòng hàng + nguồn
interface LineIn { sku: string; name: string; unit: string; quantity: number; price: number | null; taxRate: number | null; sources: { type: string; id: string; quantity: number }[] }
function cleanLines(raw: unknown, prices: boolean): LineIn[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 300) fail(400, 'Đơn mua cần từ 1 đến 300 mã hàng.');
  const seen = new Set<string>();
  return (raw as Record<string, unknown>[]).map(r => {
    const sku = str(r?.sku, 200), quantity = Number(r?.quantity);
    if (!sku) fail(400, 'Có dòng chưa có mã hàng (SKU).');
    if (seen.has(sku.toLowerCase())) fail(400, `Mã ${sku} bị lặp trong cùng đơn mua – gộp số lượng vào một dòng.`);
    seen.add(sku.toLowerCase());
    if (!(Number.isInteger(quantity) && quantity > 0 && quantity <= 1e7)) fail(400, `Số lượng của ${sku} không hợp lệ.`);
    const num = (v: unknown, max: number) => v === undefined || v === null || v === '' ? null : (Number(v) >= 0 && Number(v) <= max ? Number(v) : fail(400, `Giá / thuế của ${sku} không hợp lệ.`));
    const sources = (Array.isArray(r.sources) ? r.sources as Record<string, unknown>[] : []).map(s => ({ type: str(s?.type, 20), id: str(s?.id, 80), quantity: Number(s?.quantity) }));
    for (const s of sources) if (!['quote', 'order', 'stock_request'].includes(s.type) || !s.id || !(s.quantity > 0)) fail(400, `Nguồn của ${sku} không hợp lệ.`);
    if (sources.reduce((t, s) => t + s.quantity, 0) > quantity) fail(400, `${sku}: tổng số lấy từ các chứng từ vượt số đặt.`);
    // Nhân viên không thấy / không nhập giá mua (giá vốn): Manager / kế toán nhập khi duyệt.
    return { sku, name: str(r.name, 300), unit: str(r.unit, 40), quantity, price: prices ? num(r.price, 1e12) : null, taxRate: prices ? num(r.taxRate, 100) : null, sources };
  });
}

/** Chống mua trùng: số lấy từ mỗi chứng từ nguồn không vượt phần còn cần đặt (tính cả các đơn trong cùng lần lập). */
async function checkSources(db: Db, m: Member, orders: LineIn[][], exceptShipmentId?: string) {
  const keys = new Map<string, { type: string; id: string }>();
  for (const lines of orders) for (const l of lines) for (const s of l.sources) keys.set(s.type + ':' + s.id, { type: s.type, id: s.id });
  const needs = new Map<string, Awaited<ReturnType<typeof loadSourceNeed>>>();
  for (const [k, v] of keys) needs.set(k, await loadSourceNeed(db, m, v.type, v.id)); // 404 nếu không có quyền xem
  const families=await sourceFamilies(db,[...keys.values()]);
  const ordered = await orderedBySource(db, [...keys.values()], exceptShipmentId,families);
  const want = new Map<string, {qty:number;sku:string;sourceKeys:Set<string>}>();
  for (const lines of orders) for (const l of lines) for (const s of l.sources) {
    const sourceKey=s.type+':'+s.id,sku=l.sku.toLowerCase(),k=(families.byKey.get(sourceKey)??sourceKey)+':'+sku;
    const entry=want.get(k)??{qty:0,sku,sourceKeys:new Set<string>()};entry.qty+=s.quantity;entry.sourceKeys.add(sourceKey);want.set(k,entry);
  }
  for (const {qty,sku,sourceKeys} of want.values()) {
    const sourceKey=[...sourceKeys][0]!,need=needs.get(sourceKey)!;
    const quantities=[...sourceKeys].map(key=>needs.get(key)!.lines.filter(x=>x.sku.toLowerCase()===sku).reduce((t,x)=>t+x.quantity,0));
    if(quantities.some(n=>!n))fail(400,`Mã ${sku.toUpperCase()} không có trong chứng từ nguồn.`);
    const needQty=Math.min(...quantities),done=ordered.get(sourceKey)?.get(sku)??0;
    if (done + qty > needQty) fail(409, `${need.no} – ${sku.toUpperCase()}: cần ${needQty}, đã đặt ${done}, lần này ${qty} → vượt ${done + qty - needQty}. Báo giá và đơn hàng/HĐKT chuyển đổi dùng chung số đã đặt; kiểm tra đơn mua có sẵn.`);
  }
  return needs;
}

async function insertLines(tx: Tx, shipmentId: string, lines: LineIn[], needs: Map<string, { no: string; customerName: string; lines: { sku: string; name: string; unit: string }[] }>) {
  const names = new Map((lines.length ? await tx.select({ sku: products.sku, name: products.name, unit: products.unit }).from(products)
    .where(inArray(products.sku, lines.map(l => l.sku))) : []).map(p => [p.sku, p]));
  const now = nowIso();
  for (const [i, l] of lines.entries()) {
    // Tên: luôn theo danh mục (dòng báo giá có thể gõ gọn, vd "Bộ trà 0.5"); mã ngoài danh mục giữ tên gửi lên / của chứng từ nguồn.
    // ĐVT trống: lấy theo danh mục, không có thì theo chứng từ nguồn.
    const lineId = crypto.randomUUID(), p = names.get(l.sku), src = l.sources.map(s => needs.get(s.type + ':' + s.id)!.lines.find(x => x.sku.toLowerCase() === l.sku.toLowerCase())).find(Boolean);
    await tx.insert(incomingShipmentLines).values({ id: lineId, shipmentId, lineNo: i + 1, sku: l.sku, name: p?.name || l.name || src?.name || '', unit: l.unit || p?.unit || src?.unit || '', quantity: l.quantity, price: l.price, taxRate: l.taxRate });
    for (const s of l.sources) {
      const n = needs.get(s.type + ':' + s.id)!;
      await tx.insert(supplierOrderSources).values({ id: crypto.randomUUID(), shipmentId, lineId, sourceType: s.type as 'quote', sourceId: s.id, sourceNo: n.no, customerName: n.customerName, sku: l.sku, quantity: s.quantity, createdAt: now });
    }
  }
}

async function activeSupplier(db: Db | Tx, id: unknown) {
  const [s] = typeof id === 'string' && id ? await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1) : [];
  if (!s) fail(400, 'Chọn nhà cung cấp.');
  if (!s!.active) fail(409, `${s!.name} đã ngừng hoạt động.`);
  return s!;
}

export function registerPurchaseRoutes(router: Router<StaffEnv>) {
  registerGoodsReturnRoutes(router);
  registerReceiptJobRoutes(router);
  // Trang Tra tồn (sổ kho) đọc hàng đang về từ đơn mua NCC.
  incomingLookup.read = (db, skus) => outstandingLines(db, skus);
  const guard = (c: Ctx) => { if (!canUsePurchasing(asActor(me(c)))) fail(403, 'Bạn không có quyền với đơn mua hàng.'); };
  registerPurchaseSupplierSearch(router,guard);

  router.get('/purchase-incoming', async c => {
    guard(c);
    return json({ ...await incomingBySkuView(c.env.db, c.url.searchParams, today()),
      canRequest: canSendEarlyRequest(asActor(me(c))), canSend: canSendEarlyRequest(asActor(me(c))),
      canViewSuppliers:canEditSuppliers(me(c)),canViewStock:can(me(c),'page.stock-lookup') });
  }, 'business');

  router.get('/purchase-receiving-calendar', async c => {
    guard(c);
    return json({...await receivingCalendar(c.env.db, c.url.searchParams, today(),{reminderOnly:c.url.searchParams.get('workOnly')==='1'}),canConfirmEarly:me(c).role==='manager',canReceiveEarly:canReceive(asActor(me(c)))});
  }, 'business');

  let lastIncomingSync = 0;
  router.get('/purchase-orders', async c => {
    guard(c); const p = c.url.searchParams;
    // Tồn "Hàng chờ về" đồng bộ tối đa mỗi phút một lần: bấm lọc / gõ tìm liên tục không chạy lại phép tính nặng mỗi lượt.
    if (Date.now() - lastIncomingSync > 60_000) { lastIncomingSync = Date.now(); await syncIncomingStock(c.env.db).catch(() => { lastIncomingSync = 0; }); }
    const filter = { q: p.get('q') ?? '', supplierId: p.get('supplierId') ?? '', state: p.get('state') ?? '' }, day = today();
    const [orders, counts] = await Promise.all([listPurchases(c.env.db, me(c), filter, day), purchaseCounts(c.env.db, me(c), filter, day)]);
    return json({ orders, counts, canSeePrices: canSeePrices(asActor(me(c))), today: day });
  }, 'business');
  router.get('/supplier-payables', async c => { guard(c); return json({ ...(await supplierPayables(c.env.db, me(c), today())), today: today() }); }, 'business');
  router.get('/purchase-orders/:id', async c => { guard(c); return json(await viewOf(c, c.params.id!)); }, 'business');
  router.get('/purchase-options', async c => {
    guard(c);
    const rows = await c.env.db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.active, true)).orderBy(suppliers.name);
    const a = asActor(me(c));
    return json({ suppliers: rows, canSeePrices: canSeePrices(a), canReceive: canReceive(a), canPay: canPay(a), isManager: a.role === 'manager', canEditSuppliers: canEditSuppliers(me(c)), canRequestEarly: canSendEarlyRequest(me(c)) });
  }, 'business');
  router.get('/purchase-sources', async c => {
    guard(c);
    const offset = Number(c.url.searchParams.get('offset') ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) fail(400, 'Trang chứng từ không hợp lệ.');
    const sources = await sourceCandidates(c.env.db, me(c), c.url.searchParams.get('q') ?? '', offset);
    const hasMore = ['quote', 'order', 'stock_request'].some(type => sources.filter(s => s.type === type).length === 8);
    return json({ sources, nextOffset: hasMore ? offset + 8 : null });
  }, 'business');
  // Lập đơn mua bổ sung: tìm sản phẩm (?q=&offset=) hoặc theo mã (?skus=a,b – nhập Excel), kèm tồn Kho SR / Kho VIGIFTS / Hàng đang về.
  router.get('/purchase-products', async c => {
    guard(c);
    const p = c.url.searchParams, skus = p.has('skus') ? (p.get('skus') || '').split(',').map(s => s.trim()).filter(Boolean) : undefined;
    return json(await purchaseProducts(c.env.db, me(c), { q: (p.get('q') || '').slice(0, 100), skus, offset: Number(p.get('offset')) || 0, limit: Number(p.get('limit')) || 20 }));
  }, 'business');
  router.get('/purchase-sources/:type/:id', async c => { guard(c); return json(await sourceWithRemaining(c.env.db, me(c), c.params.type!, c.params.id!)); }, 'business');

  // ---- Tạo 1..n đơn nháp (mỗi NCC một đơn)
  router.post('/purchase-orders', async c => {
    guard(c);
    const db = c.env.db, m = me(c), body = await readJson(c.req, 400_000), prices = canSeePrices(asActor(m));
    const list = Array.isArray(body.orders) ? body.orders as Record<string, unknown>[] : [];
    if (!list.length || list.length > 20) fail(400, 'Cần từ 1 đến 20 đơn mua (mỗi nhà cung cấp một đơn).');
    const prepared = await Promise.all(list.map(async o => {
      const arrivalDate = o.arrivalDate ? (isIsoDate(o.arrivalDate) ? o.arrivalDate : fail(400, 'Ngày hàng về dự kiến không hợp lệ.')) : null;
      return { supplier: await activeSupplier(db, o.supplierId), lines: cleanLines(o.lines, prices), internalNo: internalOrderNumber(o.internalNo), arrivalDate, note: str(o.note, 2000), warehouse: deliveryAddress(o.warehouse) };
    }));
    if (new Set(prepared.map(p => p.supplier.id)).size !== prepared.length) fail(400, 'Mỗi nhà cung cấp chỉ một đơn trong một lần lập – gộp các mã cùng NCC.');
    const needs = await checkSources(db, m, prepared.map(p => p.lines));
    const ids: string[] = [];
    await db.transaction(async tx => {
      // Khoá theo bảng nguồn để hai người lập đơn cùng lúc không cùng vượt phần còn cần đặt.
      await lockSources(tx);
      await checkSources(tx as unknown as Db, m, prepared.map(p => p.lines));
      for (const p of prepared) {
        const id = crypto.randomUUID(), now = nowIso(), ticket = await nextNumber(tx as unknown as Db, 'DMH', today());
        // Nhân viên lập = nháp (chưa vào hàng chờ duyệt, bấm "Gửi duyệt" khi xong); Manager lập thì coi như đã gửi.
        await tx.insert(incomingShipments).values({ id, ticketNumber: ticket, source: 'supplier-order', approvalStatus: 'pending', submittedAt: m.role === 'manager' ? now : null, warehouse: p.warehouse, arrivalDate: p.arrivalDate,
          supplierId: p.supplier.id, supplierName: p.supplier.name, supplierInternalOrderNumber: p.internalNo, note: p.note, createdAt: now, createdBy: m.id, updatedAt: now, updatedBy: m.id });
        await insertLines(tx, id, p.lines, needs);
        await event(tx, id, m.id, 'create', `Tạo đơn mua ${m.role === 'manager' ? '' : 'nháp '}${ticket} (${p.lines.length} mã)`, { sources: [...new Set(p.lines.flatMap(l => l.sources.map(s => needs.get(s.type + ':' + s.id)!.no)))] });
        ids.push(id);
      }
    });
    return json({ ids }, 201);
  }, 'business');

  // ---- Nhập đơn mua từ file Excel tổng đơn của NCC (Manager): đơn đã đặt thật với NCC → tạo thẳng "đã duyệt + NCC đã xác nhận".
  //  Mỗi đơn = một số đơn phía NCC; số đơn đã có (cùng NCC, chưa huỷ) thì bỏ qua – nhập lại file không tạo trùng.
  //  Số đã giao trong file → phiếu nhận "không cần nhập Sapo" (hàng đã nhập Sapo từ trước), không ghi sổ kho.
  router.post('/purchase-orders/import', async c => {
    guard(c);
    const db = c.env.db, m = me(c), body = await readJson(c.req, 1_000_000);
    if (m.role !== 'manager') fail(403, 'Chỉ Manager nhập đơn mua từ file.');
    const supplier = await activeSupplier(db, body.supplierId), warehouse = deliveryAddress(body.warehouse);
    const taxRate = Number(body.taxRate ?? 0);
    if (!(taxRate >= 0 && taxRate <= 100)) fail(400, 'Thuế VAT không hợp lệ.');
    const list = Array.isArray(body.orders) ? body.orders as Record<string, unknown>[] : [];
    if (!list.length || list.length > 50) fail(400, 'Mỗi lần gửi từ 1 đến 50 đơn.');
    const orders = list.map(o => {
      const internalNo = str(o.internalNo, 100);
      if (!internalNo) fail(400, 'Có đơn thiếu số đơn phía NCC.');
      const arrivalDate = o.arrivalDate ? (isIsoDate(o.arrivalDate) ? String(o.arrivalDate) : fail(400, `${internalNo}: ngày giao không hợp lệ.`)) : null;
      const lines = cleanLines(o.lines, true).map((l, i) => {
        const r = (o.lines as Record<string, unknown>[])[i]!, discount = Number(r.discount ?? 0), received = Number(r.received ?? 0);
        const promised = r.promisedDate ? (isIsoDate(r.promisedDate) ? String(r.promisedDate) : fail(400, `${internalNo} – ${l.sku}: ngày giao không hợp lệ.`)) : (arrivalDate ?? '');
        if (l.price === null) fail(400, `${internalNo} – ${l.sku}: thiếu đơn giá.`);
        if (!(discount >= 0 && discount <= 100)) fail(400, `${internalNo} – ${l.sku}: chiết khấu không hợp lệ.`);
        if (!(Number.isInteger(received) && received >= 0 && received <= l.quantity)) fail(400, `${internalNo} – ${l.sku}: số đã giao không hợp lệ.`);
        return { ...l, taxRate, sources: [], discount, received, promised };
      });
      return { internalNo, arrivalDate, lines };
    });
    if (new Set(orders.map(o => o.internalNo.toLowerCase())).size !== orders.length) fail(400, 'Số đơn phía NCC bị lặp trong file gửi lên.');
    const created: { id: string; ticketNumber: string; internalNo: string }[] = [], skipped: { internalNo: string; ticketNumber: string }[] = [];
    for (const o of orders) {
      await db.transaction(async tx => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'purchase-import:' + supplier.id}))`);
        const [dup] = await tx.select({ ticketNumber: incomingShipments.ticketNumber }).from(incomingShipments)
          .where(and(eq(incomingShipments.supplierId, supplier.id), isNull(incomingShipments.cancelledAt), sql`lower(${incomingShipments.supplierInternalOrderNumber}) = ${o.internalNo.toLowerCase()}`)).limit(1);
        if (dup) { skipped.push({ internalNo: o.internalNo, ticketNumber: dup.ticketNumber }); return; }
        const id = crypto.randomUUID(), now = nowIso(), ticket = await nextNumber(tx as unknown as Db, 'DMH', today());
        await tx.insert(incomingShipments).values({ id, ticketNumber: ticket, source: 'supplier-order', approvalStatus: 'approved', approvedAt: now, approvedBy: m.id, submittedAt: now,
          supplierStatus: 'confirmed', supplierConfirmedAt: now, supplierConfirmedBy: m.id, confirmedOnBehalf: true, supplierInternalOrderNumber: o.internalNo,
          warehouse, arrivalDate: o.arrivalDate, supplierId: supplier.id, supplierName: supplier.name, note: str(body.note, 2000), depositRate: 0,
          createdAt: now, createdBy: m.id, updatedAt: now, updatedBy: m.id });
        await insertLines(tx, id, o.lines, new Map());
        const lineRows = await tx.select({ id: incomingShipmentLines.id, sku: incomingShipmentLines.sku }).from(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId, id));
        for (const l of o.lines) await tx.update(incomingShipmentLines).set({ purchaseDiscount: l.discount, promisedDate: l.promised, supplierConfirmed: true })
          .where(and(eq(incomingShipmentLines.shipmentId, id), eq(incomingShipmentLines.sku, l.sku)));
        // Lịch trả mặc định như khi Manager duyệt không chọn cọc: một kỳ "còn lại" chưa đặt hạn.
        const total = computeOrderTotals({ rows: o.lines.map(l => ({ quantity: l.quantity, price: l.price, taxRate, purchaseDiscount: l.discount, confirmedPurchaseDiscount: null, printFee: 0 })), depositRate: null, paidAmount: 0 }).total;
        const schedules = buildSchedules(total, {});
        if (schedules.length) await tx.insert(supplierPaymentSchedules).values(schedules.map(x => ({ id: crypto.randomUUID(), shipmentId: id, ...x, createdAt: now })));
        await event(tx, id, m.id, 'import', `Nhập từ file đơn NCC: số đơn ${o.internalNo}, ${o.lines.length} mã, tổng ${Math.round(total).toLocaleString('vi-VN')} đ – tạo sẵn "đã duyệt + NCC đã xác nhận"`);
        const got = o.lines.filter(l => l.received > 0);
        if (got.length) {
          const receiptId = crypto.randomUUID(), no = await nextNumber(tx as unknown as Db, 'PNH', today());
          await tx.insert(supplierReceipts).values({ id: receiptId, receiptNo: no, shipmentId: id, receivedDate: today(), receivedBy: m.id, warehouse: '', note: 'Đã giao trước khi nhập đơn từ file NCC',
            clientKey: 'import:' + id, sapoStatus: 'not_needed', sapoNote: 'Hàng đã nhập Sapo từ trước', sapoUpdatedAt: now, sapoUpdatedBy: m.id, createdAt: now });
          await tx.insert(supplierReceiptLines).values(got.map(l => ({ receiptId, lineId: lineRows.find(r => r.sku === l.sku)!.id, sku: l.sku, goodQty: l.received, damagedQty: 0, note: '' })));
          const missing = o.lines.reduce((t, l) => t + l.quantity - l.received, 0);
          if (missing <= 0) await tx.update(incomingShipments).set({ receivedAt: now, receivedBy: m.id }).where(eq(incomingShipments.id, id));
          await event(tx, id, m.id, 'receive', `Phiếu ${no}: ghi nhận số đã giao theo file NCC – ` + got.map(l => `${l.sku} ${l.received}`).slice(0, 8).join('; ') + (missing > 0 ? ` · còn thiếu ${missing}` : ' · đã nhận đủ'));
        }
        created.push({ id, ticketNumber: ticket, internalNo: o.internalNo });
      });
    }
    await syncIncomingStock(db);
    return json({ created, skipped }, 201);
  }, 'business');

  // ---- Email cho NCC (soạn ở máy người dùng qua mailto): máy chủ trả người nhận theo danh bạ NCC + ghi lịch sử.
  //  kind 'stock' = hỏi tồn / ngày giao (ai xem được đơn cũng gửi được, không kèm giá);
  //  kind 'order' = gửi đơn đặt hàng kèm PDF (chỉ người xem được giá, đơn đã duyệt).
  /** Người nhận + kiểm quyền cho email NCC. Đơn đã duyệt: dùng người nhận Manager chốt lúc duyệt (nếu có). */
  async function mailTarget(c: Ctx, kind: 'order' | 'stock') {
    const db = c.env.db, m = me(c), id = c.params.id!;
    const p = await loadPurchase(db, m, id, today());
    if (p.raw.order.cancelledAt) fail(409, 'Đơn mua đã huỷ.');
    if (kind === 'order') {
      if (!canSeePurchasePrices(asActor(m), p.raw.order)) fail(403, 'Bạn không có quyền gửi đơn đặt hàng có giá cho NCC.');
      if (p.raw.order.approvalStatus !== 'approved') fail(409, 'Manager duyệt giá trước khi gửi đơn cho NCC.');
    }
    const contacts = p.raw.order.supplierId ? await db.select({ kind: supplierContacts.kind, email: supplierContacts.email }).from(supplierContacts).where(eq(supplierContacts.supplierId, p.raw.order.supplierId)) : [];
    const rec = defaultRecipients(contacts);
    const to = (kind === 'order' && p.raw.order.supplierEmail) || rec.to;
    const cc = kind === 'order' && p.raw.order.ccEmail ? p.raw.order.ccEmail.split(',').map(x => x.trim()).filter(Boolean) : rec.cc;
    if (!to) fail(400, 'NCC chưa có email nhận đơn – thêm ở trang Nhà cung cấp.');
    return { db, m, id, p, to, cc };
  }

  router.post('/purchase-orders/:id/mail', async c => {
    guard(c);
    const body = await readJson(c.req, 4_000), kind = body.kind === 'order' ? 'order' : 'stock';
    const { db, m, id, p, to, cc } = await mailTarget(c, kind);
    await event(db, id, m.id, 'mail', (kind === 'order' ? 'Gửi email đơn đặt hàng tới ' : 'Gửi email hỏi tồn tới ') + to + (cc.length ? ` (CC ${cc.join(', ')})` : ''), { kind, to, cc });
    return json({ to, cc, ticketNumber: p.raw.order.ticketNumber });
  }, 'business');

  // ---- Gửi email đơn đặt hàng từ máy chủ, đính kèm PDF do trình duyệt tạo (cùng file với nút "PDF gửi NCC").
  //  Người nhận / tiêu đề / nội dung do máy chủ quyết theo đơn (không nhận từ trình duyệt); trả lời email về người bấm gửi.
  router.post('/purchase-orders/:id/send-email', async c => {
    guard(c);
    const body = await readJson(c.req, 6_000_000);
    const pdf = typeof body.pdf === 'string' ? body.pdf : '';
    if (!pdf || pdf.length > 5_500_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(pdf) || !pdf.startsWith('JVBERi0')) fail(400, 'File PDF đơn đặt hàng không hợp lệ.'); // "%PDF-"
    const { db, m, id, p, to, cc: baseCc } = await mailTarget(c, 'order');
    const lower = (x: string) => x.toLowerCase();
    // CC: người nhận theo danh bạ / Manager chốt + nhân viên phụ trách (người lập đơn mua, người phụ trách chứng từ nguồn) + CC chung (MAIL_CC).
    const staff = await responsibleEmails(db, id, p.raw.order.createdBy);
    const cc = [...baseCc, ...staff, ...(c.env.mailer?.alwaysCc ?? [])].filter((x, i, a) => lower(x) !== lower(to) && a.findIndex(y => lower(y) === lower(x)) === i);
    const o = p.raw.order, sup = o.supplierName || 'Quý nhà cung cấp';
    const unit = (u: string | null) => (u ? ' ' + u : '');
    const list = p.raw.lines.slice(0, 60).map((l, i) => `${i + 1}. ${l.sku} - ${l.name}: ${l.quantity.toLocaleString('vi-VN')}${unit(l.unit)}`).join('\n')
      + (p.raw.lines.length > 60 ? `\n... và ${p.raw.lines.length - 60} mã khác (xem file đính kèm)` : '');
    const due = o.arrivalDate ? `, đề nghị giao trước ngày ${o.arrivalDate.split('-').reverse().join('/')}` : '';
    const text = `Kính gửi ${sup},\n\nBách Ngân gửi đơn đặt hàng ${o.ticketNumber} (file PDF đính kèm)${due}:\n${list}\n\n`
      + `Đề nghị Quý NCC xác nhận đơn hàng, ngày giao và số đơn nội bộ (nếu có) bằng cách trả lời email này.\n\nTrân trọng,\n${m.name || 'Bách Ngân'}`;
    const filename = 'Don-dat-hang-' + o.ticketNumber.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) + '.pdf';
    const mailId = await sendMail(c.env.mailer, { to: [to], cc, replyTo: m.email, subject: `Đơn đặt hàng ${o.ticketNumber} – Bách Ngân`, text, attachments: [{ filename, content: pdf }] });
    await event(db, id, m.id, 'mail', 'Đã gửi email đơn đặt hàng (kèm PDF) tới ' + to + (cc.length ? ` (CC ${cc.join(', ')})` : ''), { kind: 'order', to, cc, sent: true, mailId });
    return json({ to, cc, sent: true });
  }, 'business');

  // ---- Sửa nháp
  // Update supplier reference only; never reopen approval, confirmation or receiving.
  router.put('/purchase-orders/:id/supplier-reference', async c => {
    const body = await readJson(c.req, 2000), id = c.params.id!, m = me(c);
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0) fail(400, 'Thiếu phiên bản đơn mua hợp lệ. Tải lại đơn rồi thử lại.');
    const internalNo = internalOrderNumber(body.internalNo);
    if (!internalNo) fail(400, 'Nhập số đơn phía NCC cần bổ sung.');
    await c.env.db.transaction(async tx => {
      const p = await lockAndCheck(c, tx, id, 'reference', body.revision);
      const before = p.raw.order.supplierInternalOrderNumber || '';
      if (before === internalNo) return;
      await bump(tx, id, m.id, { supplierInternalOrderNumber: internalNo });
      await event(tx, id, m.id, 'supplier-reference', `Cập nhật số đơn phía NCC: ${before || '(trống)'} → ${internalNo}`, { before, after: internalNo });
    });
    return json((await loadPurchase(c.env.db, m, id, today())).view);
  }, 'business');

  router.put('/purchase-orders/:id', async c => {
    guard(c);
    const db = c.env.db, m = me(c), id = c.params.id!, body = await readJson(c.req, 400_000), prices = canSeePrices(asActor(m));
    const lines = cleanLines(body.lines, prices), supplier = await activeSupplier(db, body.supplierId);
    const arrivalDate = body.arrivalDate ? (isIsoDate(body.arrivalDate) ? body.arrivalDate : fail(400, 'Ngày hàng về dự kiến không hợp lệ.')) : null;
    await db.transaction(async tx => {
      await lockSources(tx);
      const p = await lockAndCheck(c, tx, id, 'edit', body.revision);
      // A number belongs to its supplier; omitted values survive same-supplier edits only.
      const internalNo = internalOrderNumber(body.internalNo === undefined ? (p.raw.order.supplierId === supplier.id ? p.raw.order.supplierInternalOrderNumber : '') : body.internalNo);
      const warehouse = deliveryAddress(body.warehouse);
      const needs = await checkSources(tx as unknown as Db, m, [lines], id);
      // Nhân viên sửa nháp: giữ giá Manager đã nhập (không thấy, không xoá được).
      if (!prices) for (const l of lines) { const old = p.raw.lines.find(x => x.sku.toLowerCase() === l.sku.toLowerCase()); l.price = old?.price ?? null; l.taxRate = old?.taxRate ?? null; }
      await tx.delete(supplierOrderSources).where(eq(supplierOrderSources.shipmentId, id));
      await tx.delete(incomingShipmentLines).where(eq(incomingShipmentLines.shipmentId, id));
      await insertLines(tx, id, lines, needs);
      await bump(tx, id, m.id, { supplierId: supplier.id, supplierName: supplier.name, supplierInternalOrderNumber: internalNo, arrivalDate, note: str(body.note, 2000), warehouse });
      const before = new Map(p.raw.lines.map(l => [l.sku, l.quantity])), after = new Map(lines.map(l => [l.sku, l.quantity]));
      const diff = [...new Set([...before.keys(), ...after.keys()])].filter(k => before.get(k) !== after.get(k)).map(k => `${k}: ${before.get(k) ?? 0} → ${after.get(k) ?? 0}`);
      await event(tx, id, m.id, 'update', 'Sửa đơn nháp' + (diff.length ? ' – ' + diff.slice(0, 8).join('; ') : '') + (p.raw.order.supplierId !== supplier.id ? ` · đổi NCC sang ${supplier.name}` : ''), { diff });
    });
    return json(await viewOf(c, id));
  }, 'business');

  // ---- Manager duyệt giá / chiết khấu / lịch trả
  router.post('/purchase-orders/:id/approve', async c => {
    guard(c);
    const db = c.env.db, m = me(c), id = c.params.id!, body = await readJson(c.req, 100_000);
    await db.transaction(async tx => {
      const p = await lockAndCheck(c, tx, id, 'approve', body.revision);
      const internalNo = internalOrderNumber(body.internalNo === undefined ? p.raw.order.supplierInternalOrderNumber : body.internalNo, p.view.supplier?.name, true);
      const input = new Map((Array.isArray(body.lines) ? body.lines as Record<string, unknown>[] : []).map(l => [String(l.lineId), l]));
      const rows = p.raw.lines.map(l => {
        const r = input.get(l.id), rawPrice = r?.price ?? l.price, price = rawPrice === null || rawPrice === undefined || rawPrice === '' ? NaN : Number(rawPrice), taxRate = Number(r?.taxRate ?? l.taxRate ?? 0), discount = Number(r?.purchaseDiscount ?? l.purchaseDiscount ?? 0);
        if (!(price >= 0 && Number.isFinite(price))) fail(400, `Nhập giá mua cho ${l.sku}.`);
        if (!(taxRate >= 0 && taxRate <= 100) || !(discount >= 0 && discount <= 100)) fail(400, `Thuế / chiết khấu của ${l.sku} không hợp lệ.`);
        return { id: l.id, price, taxRate, purchaseDiscount: discount };
      });
      for (const r of rows) await tx.update(incomingShipmentLines).set({ price: r.price, taxRate: r.taxRate, purchaseDiscount: r.purchaseDiscount }).where(eq(incomingShipmentLines.id, r.id));
      const total = computeOrderTotals({ rows: p.raw.lines.map(l => ({ ...l, ...rows.find(r => r.id === l.id)! })), depositRate: null, paidAmount: 0 }).total;
      const schedules = buildSchedules(total, (body.payment ?? {}) as Parameters<typeof buildSchedules>[1]);
      const contacts = await tx.select({ kind: supplierContacts.kind, email: supplierContacts.email }).from(supplierContacts).where(eq(supplierContacts.supplierId, p.raw.order.supplierId!));
      const rec = defaultRecipients(contacts);
      const deposit = (body.payment as { deposit?: { mode?: string; value?: number } } | undefined)?.deposit;
      await tx.delete(supplierPaymentSchedules).where(eq(supplierPaymentSchedules.shipmentId, id));
      if (schedules.length) await tx.insert(supplierPaymentSchedules).values(schedules.map(s => ({ id: crypto.randomUUID(), shipmentId: id, ...s, createdAt: nowIso() })));
      await bump(tx, id, m.id, { approvalStatus: 'approved', supplierInternalOrderNumber: internalNo, approvedAt: nowIso(), approvedBy: m.id, supplierEmail: str(body.supplierEmail, 254) || rec.to, ccEmail: (Array.isArray(body.cc) ? body.cc.join(',') : rec.cc.join(',')).slice(0, 2000),
        depositRate: deposit?.mode === 'percent' ? Number(deposit.value) : deposit?.mode === 'none' || !deposit ? 0 : null });
      await event(tx, id, m.id, 'approve', `Manager duyệt đơn – tổng ${Math.round(total).toLocaleString('vi-VN')} đ, ${schedules.length} kỳ trả`, { rows, schedules });
    });
    const v = await viewOf(c, id);
    if (v.createdBy !== m.id) await notify(c.env, { eventType: 'purchase_approved', title: 'Đơn mua NCC đã được duyệt', body: poLabel(v), url: `/index.html#/purchases/${id}`, targetMemberId: v.createdBy, actorId: m.id, data: { purchaseId: id } }).catch(() => {});
    return json(v);
  }, 'business');

  // ---- Gửi duyệt: nháp của nhân viên → vào hàng chờ duyệt của Manager
  router.post('/purchase-orders/:id/submit', async c => {
    guard(c);
    const db = c.env.db, m = me(c), id = c.params.id!, body = await readJson(c.req, 4_000);
    await db.transaction(async tx => {
      await lockAndCheck(c, tx, id, 'submit', body.revision);
      await bump(tx, id, m.id, { submittedAt: nowIso() });
      await event(tx, id, m.id, 'submit', 'Gửi Manager duyệt đơn mua');
    });
    const v = await viewOf(c, id);
    await notifyMany(c.env, 'approvers', { eventType: 'purchase_pending', title: 'Đơn mua NCC chờ duyệt', body: `${m.name}: ${poLabel(v)}`, url: `/index.html#/purchases/${id}`, actorId: m.id, data: { purchaseId: id } }).catch(() => 0);
    return json(v);
  }, 'business');

  // ---- Lưu giá nhập khi chưa duyệt (Manager): giá / CK / VAT từng dòng, đơn vẫn là nháp. Ô giá để trống = chưa có giá.
  router.post('/purchase-orders/:id/prices', async c => {
    guard(c);
    const db = c.env.db, m = me(c), id = c.params.id!, body = await readJson(c.req, 100_000);
    await db.transaction(async tx => {
      const p = await lockAndCheck(c, tx, id, 'approve', body.revision);
      const input = new Map((Array.isArray(body.lines) ? body.lines as Record<string, unknown>[] : []).map(l => [String(l.lineId), l]));
      const rows = p.raw.lines.filter(l => input.has(l.id)).map(l => {
        const r = input.get(l.id)!, price = r.price === null || r.price === undefined || r.price === '' ? null : Number(r.price);
        const taxRate = Number(r.taxRate ?? l.taxRate ?? 0), discount = Number(r.purchaseDiscount ?? 0);
        if (price !== null && !(price >= 0 && Number.isFinite(price))) fail(400, `Giá mua của ${l.sku} không hợp lệ.`);
        if (!(taxRate >= 0 && taxRate <= 100) || !(discount >= 0 && discount <= 100)) fail(400, `Thuế / chiết khấu của ${l.sku} không hợp lệ.`);
        return { id: l.id, price, taxRate, purchaseDiscount: discount };
      });
      if (!rows.length) fail(400, 'Chưa có dòng giá nào để lưu.');
      for (const r of rows) await tx.update(incomingShipmentLines).set({ price: r.price, taxRate: r.taxRate, purchaseDiscount: r.purchaseDiscount }).where(eq(incomingShipmentLines.id, r.id));
      await bump(tx, id, m.id);
      await event(tx, id, m.id, 'prices', `Lưu giá nhập ${rows.filter(r => r.price !== null).length}/${rows.length} dòng (chưa duyệt)`, { rows });
    });
    return json(await viewOf(c, id));
  }, 'business');

  // ---- Manager ghi nhận xác nhận / ngày hẹn thay NCC
  router.post('/purchase-orders/:id/confirm', async c => {
    guard(c);
    const db = c.env.db, m = me(c), id = c.params.id!, body = await readJson(c.req, 100_000);
    await db.transaction(async tx => {
      const p = await lockAndCheck(c, tx, id, 'confirm', body.revision);
      const internalNo = internalOrderNumber(body.internalNo === undefined ? p.raw.order.supplierInternalOrderNumber : body.internalNo, p.view.supplier?.name, true);
      const arrival = body.arrivalDate ? (isIsoDate(body.arrivalDate) ? body.arrivalDate : fail(400, 'Ngày hẹn giao không hợp lệ.')) : p.raw.order.arrivalDate;
      const input = new Map((Array.isArray(body.lines) ? body.lines as Record<string, unknown>[] : []).map(l => [String(l.lineId), l]));
      const changes: string[] = [];
      for (const l of p.raw.lines) {
        const r = input.get(l.id); if (!r) continue;
        const promised = r.promisedDate ? (isIsoDate(r.promisedDate) ? r.promisedDate : fail(400, `Ngày hẹn của ${l.sku} không hợp lệ.`)) : '';
        if (promised !== l.promisedDate) changes.push(`${l.sku}: ${l.promisedDate || '—'} → ${promised || '—'}`);
        await tx.update(incomingShipmentLines).set({ promisedDate: promised, supplierNote: str(r.note, 500), supplierConfirmed: true }).where(eq(incomingShipmentLines.id, l.id));
      }
      const first = p.raw.order.supplierStatus !== 'confirmed';
      await bump(tx, id, m.id, { supplierStatus: 'confirmed', supplierConfirmedAt: first ? nowIso() : p.raw.order.supplierConfirmedAt, supplierConfirmedBy: first ? m.id : p.raw.order.supplierConfirmedBy,
        confirmedOnBehalf: true, arrivalDate: arrival, supplierInternalOrderNumber: internalNo });
      await event(tx, id, m.id, 'confirm', (first ? 'Ghi nhận NCC đã xác nhận đơn' : 'Cập nhật ngày hẹn') + (arrival ? ` – hẹn giao ${arrival.split('-').reverse().join('/')}` : '') + (changes.length ? ' · ' + changes.slice(0, 6).join('; ') : '') + (str(body.note, 300) ? ` · ${str(body.note, 300)}` : ''), { changes });
    });
    return json(await viewOf(c, id));
  }, 'business');

  router.post('/purchase-orders/:id/cancel', async c => {
    guard(c);
    const db = c.env.db, m = me(c), id = c.params.id!, body = await readJson(c.req, 8_000), reason = str(body.reason, 500);
    if (reason.length < 3) fail(400, 'Nhập lý do huỷ đơn mua.');
    await db.transaction(async tx => {
      await lockAndCheck(c, tx, id, 'cancel', body.revision);
      await bump(tx, id, m.id, { cancelledAt: nowIso(), cancelledBy: m.id, cancelReason: reason });
      await event(tx, id, m.id, 'cancel', 'Huỷ đơn mua – ' + reason);
    });
    const v = await viewOf(c, id);
    if (v.createdBy !== m.id) await notify(c.env, { eventType: 'purchase_cancelled', title: 'Đơn mua NCC đã bị huỷ', body: `${poLabel(v)} – ${reason}`, url: `/index.html#/purchases/${id}`, targetMemberId: v.createdBy, actorId: m.id }).catch(() => {});
    return json(v);
  }, 'business');

  // ---- Nhận hàng từng đợt (kho / Manager)
  router.post('/purchase-orders/:id/receipts', async c => {
    guard(c);
    const db = c.env.db, m = me(c), id = c.params.id!, body = await readJson(c.req, 100_000 + WH_PHOTO_MAX * WH_PHOTO_MAX_CHARS), clientKey = str(body.clientKey, 80);
    const createSapo=body.createSapo!==false;
    if(body.createSapo!==undefined&&typeof body.createSapo!=='boolean')fail(400,'Lựa chọn tạo đơn Sapo không hợp lệ.');
    if (clientKey.length < 8) fail(400, 'Thiếu mã chống bấm lặp – tải lại trang rồi thử lại.');
    // Dấu nội dung: gửi lại cùng mã chống bấm lặp phải đúng kho, ngày, dòng hàng, phiếu xin lấy trước; khác thì từ chối (không trả phiếu cũ).
    const requestHash = receiptRequestHash(body, createSapo);
    const sameRequest = (r: { shipmentId: string; createSapo: boolean; requestHash: string | null }) => {
      if (r.shipmentId !== id) fail(409, 'Mã chống bấm lặp đã dùng cho đơn khác.');
      if (r.createSapo !== createSapo) fail(409, 'Phiếu đã lưu với lựa chọn Sapo khác. Không tạo lại.');
      if (r.requestHash && r.requestHash !== requestHash) throw new AppError(409, 'Mã chống bấm lặp đã dùng cho phiếu nhận khác (số lượng / kho / ngày / phiếu xin hàng). Tải lại trang rồi nhập lại.', 'IDEMPOTENCY_CONFLICT');
    };
    const [dup] = await db.select({ id: supplierReceipts.id, shipmentId: supplierReceipts.shipmentId,createSapo:supplierReceipts.createSapo, requestHash: supplierReceipts.requestHash }).from(supplierReceipts).where(eq(supplierReceipts.clientKey, clientKey)).limit(1);
    if (dup) { sameRequest(dup); return json({ ...await viewOf(c, id), receiptId: dup.id, duplicate: true }); }
    const photos = parsePhotos(body.photos);
    let receiptId = '', duplicate = false;
    // Ảnh tải lên kho file trước giao dịch: không giữ khoá nguồn hàng toàn hệ thống / sổ kho trong lúc tải.
    const plannedId = crypto.randomUUID(), uploaded = await uploadPhotos(c.env.files, m.id, 'supplier_receipt', plannedId, photos);
    try { await db.transaction(async tx => {
      // Same lock order as purchase editing: source budget first, then parent order.
      await lockSources(tx);
      // Recheck replay after the parent lock: simultaneous retries must not create another receipt.
      await tx.select({id:incomingShipments.id}).from(incomingShipments).where(eq(incomingShipments.id,id)).for('update');
      const [existing]=await tx.select({id:supplierReceipts.id,shipmentId:supplierReceipts.shipmentId,createSapo:supplierReceipts.createSapo,requestHash:supplierReceipts.requestHash}).from(supplierReceipts).where(eq(supplierReceipts.clientKey,clientKey)).limit(1);
      if(existing){sameRequest(existing);receiptId=existing.id;duplicate=true;return;}
      const p = await lockAndCheck(c, tx, id, 'receive');
      const v = validateReceipt(p.raw.progress, { receivedDate: body.receivedDate, lines: body.lines }, today());
      await ensureReceiptSourceBudget(tx,id,v.lines.map(l=>l.sku));
      const earlyRequestId=typeof body.earlyRequestId==='string'?body.earlyRequestId:undefined;
      if(body.earlyRequestId!==undefined&&(!earlyRequestId?.trim()||earlyRequestId.length>100))fail(400,'Mã phiếu xin lấy trước không hợp lệ.');
      if(earlyRequestId!==undefined){
        const context=await earlyReceiptContext(tx,earlyRequestId,id);
        for(const l of v.lines){const allowed=context.lines.find(r=>r.lineId===l.lineId);
          if(!allowed||l.goodQty+l.damagedQty>allowed.remaining+0.0005)fail(409,`${l.sku}: vượt lượng còn được nhận của phiếu xin lấy trước.`);
        }
      }
      // Có hàng hỏng: bắt buộc 1–3 ảnh làm bằng chứng đòi NCC bù (Manager xem trên đơn mua).
      if (!photos.length && v.lines.some(l => l.damagedQty > 0)) fail(400, 'Có hàng hỏng: chụp 1–3 ảnh hàng hỏng trước khi lưu.');
      receiptId = plannedId;
      const no = await nextNumber(tx as unknown as Db, 'PNH', today());
      const whName = str(body.warehouse, 120);
      const whId = await stockWarehouseByName(tx as unknown as Db, whName);
      if (!whId) throw new AppError(400, 'Chọn kho nhận hàng là kho thật đang hoạt động trong danh sách kho.');
      await lockLedger(tx);
      await assertWarehousesOpened(tx, [whId]);
      await tx.insert(supplierReceipts).values({ id: receiptId, receiptNo: no, shipmentId: id, receivedDate: v.receivedDate, receivedBy: m.id, warehouse: whName,
        note: str(body.note, 1000), createSapo,clientKey, requestHash, createdAt: nowIso() });
      await tx.insert(supplierReceiptLines).values(v.lines.map(l => ({ receiptId, lineId: l.lineId, sku: l.sku, goodQty: l.goodQty, damagedQty: l.damagedQty, note: l.note })));
      await recordPhotos(tx as unknown as Db, uploaded);
      // Sổ kho: hàng đạt cộng vào kho nhận (Sapo vẫn là nguồn chính – sổ kho chạy song song để đối chiếu).
      await postMoves(tx as unknown as Db, m.id, v.lines.map(l => ({ sku: l.sku, warehouseId: whId, qty: l.goodQty, kind: 'receipt' as const, refType: 'supplier_receipt' as const, refId: receiptId, refNo: no, note: `${p.raw.order.ticketNumber} · ${p.raw.order.supplierName ?? ''}` })));

      const after = p.raw.progress.missing - v.lines.reduce((s, l) => s + l.goodQty, 0);
      // Nhận đủ: đánh dấu đơn đã nhận (cột cũ dùng cho cổng NCC / luật đóng băng).
      if (after <= 0) await tx.update(incomingShipments).set({ receivedAt: nowIso(), receivedBy: m.id, receivedWarehouse: whName }).where(eq(incomingShipments.id, id));
      // Lịch sử sản phẩm: mỗi mã một dòng "Nhập hàng" (giá nhập chỉ Manager xem – lọc ở GET /products/:sku/history).
      await recordMovements(tx, v.lines.map(l => {
        const line = p.raw.lines.find(x => x.id === l.lineId);
        return { refKey: `receipt:${receiptId}:${l.lineId}`, sku: l.sku, kind: 'purchase' as const, name: line?.name, qty: l.goodQty, unit: line?.unit, unitPrice: line ? purchaseUnitCost(line) : null,
          partner: p.raw.order.supplierName ?? '', location: whName, refCode: `${no} · ${p.raw.order.ticketNumber}`, link: `#/purchases/${id}`,
          status: l.damagedQty ? `Đạt ${l.goodQty} · hỏng ${l.damagedQty} (NCC giao bù)` : 'Đã nhận', note: `${l.note}${l.note?' · ':''}[net-cost-v1] Giá mua sau CK, trước VAT`, occurredAt: `${v.receivedDate}T00:00:00+07:00` };
      }));
      // Keep provenance compact: the event size cap must never truncate the request/receipt link. Lines already live in supplier_receipt_lines.
      await event(tx, id, m.id, 'receive', `Nhận hàng ${no}${earlyRequestId?' theo phiếu xin lấy trước':''}: ` + v.lines.map(l => `${l.sku} đạt ${l.goodQty}${l.damagedQty ? `, hỏng ${l.damagedQty}` : ''}`).slice(0, 8).join('; ') + (after > 0 ? ` · còn thiếu ${after}` : ' · đã nhận đủ'), { receiptId,createSapo, ...(earlyRequestId?{earlyRequestId}:{lines:v.lines}) });
      const [supplier] = p.raw.order.supplierId ? await tx.select().from(suppliers).where(eq(suppliers.id,p.raw.order.supplierId)).limit(1) : [];
      const payload = {
        schema_version: 1, action: 'create_purchase_receipt', source: 'crm_supplier_receipt', idempotency_key: receiptId,
        crm_order: { id, code:p.raw.order.ticketNumber, note:p.raw.order.note },
        crm_receipt: { id:receiptId, code:no, received_date:v.receivedDate, note:str(body.note,1000) },
        supplier: {id:supplier?.id ?? '',name:supplier?.name ?? '',tax_code:supplier?.taxCode ?? ''},
        warehouse: {name:whName}, employee: {id:m.id,name:m.name},
        items: v.lines.filter(l=>l.goodQty>0).map(l=>{
          const source=p.raw.lines.find(x=>x.id===l.lineId);
          return {crm_line_id:l.lineId,sku:l.sku,name:source?.name ?? '',unit:source?.unit ?? '',good_quantity:l.goodQty,unit_price:source?.price ?? null,
            purchase_discount_percent:source?.confirmedPurchaseDiscount ?? source?.purchaseDiscount ?? null,vat_percent:source?.taxRate ?? null,note:l.note};
        }),
      };
      const missing:string[]=[];
      if(!supplier?.id || !supplier.name.trim())missing.push('supplier');
      if(!whName)missing.push('warehouse');
      for(const line of payload.items){
        if(!line.sku.trim())missing.push(`${line.crm_line_id}:sku`);
        for(const key of ['unit_price','purchase_discount_percent','vat_percent'] as const) if(line[key]===null || !Number.isFinite(line[key]) || line[key]!<0 || (key!=='unit_price'&&line[key]!>100))missing.push(`${line.sku}:${key}`);
      }
      if(createSapo&&payload.items.length)await queueReceiptJob(tx,receiptId,payload,missing.length?'Thiếu dữ liệu: '+missing.join(', '):'');
      else await tx.update(supplierReceipts).set({sapoStatus:'not_needed',sapoNote:createSapo?'Không có hàng đạt để nhập Sapo.':'Người nhận chọn chỉ nhập CRM, không tạo đơn Sapo.',sapoUpdatedAt:nowIso(),sapoUpdatedBy:m.id}).where(eq(supplierReceipts.id,receiptId));
    }); } catch (e) { await discardPhotos(c.env.files, uploaded); throw e; }
    if(duplicate){await discardPhotos(c.env.files, uploaded);return json({...await viewOf(c,id),receiptId,duplicate:true});}
    if(createSapo){const delivery = dispatchReceiptJob(c.env,receiptId).catch(() => ({sent:false,skipped:false}));
    if(c.env.waitUntil)c.env.waitUntil(delivery);else await delivery;}
    return json({ ...await viewOf(c, id), receiptId }, 201);
  }, 'business');

  // ---- Trạng thái nhập kho Sapo của một phiếu nhận (Sapo là nguồn tồn chính, CRM không tự cộng tồn)
  router.put('/supplier-receipts/:id/sapo', async c => {
    guard(c);
    const db = c.env.db, m = me(c), a = asActor(m), body = await readJson(c.req, 8_000);
    if (!canReceive(a)) fail(403, 'Chỉ người được nhận hàng cập nhật trạng thái nhập kho Sapo.');
    const status = String(body.status), code = str(body.code, 100), note = str(body.note, 500);
    if (!['pending', 'done', 'failed', 'not_needed'].includes(status)) fail(400, 'Trạng thái nhập Sapo không hợp lệ.');
    if (status === 'done') fail(409, 'Không đánh dấu nhập Sapo thủ công. Manager cần yêu cầu đối soát phiếu đã có.');
    if (status === 'failed' && !note) fail(400, 'Ghi lại lỗi Sapo để xử lý tiếp.');
    let shipmentId = '';
    await db.transaction(async tx => {
      const r = await lockReceiptForWrite(tx,c.params.id!);
      if (!r) fail(404, 'Không tìm thấy phiếu nhận.');
      shipmentId = r!.shipmentId;
      await loadPurchase(tx as unknown as Db, m, shipmentId, today()); // kiểm phạm vi xem
      if (r!.cancelledAt) fail(409, 'Phiếu nhận đã huỷ.');
      // Đã nhập Sapo rồi: không cho "nhập lại" (tránh cộng tồn hai lần); chỉ Manager được mở lại khi nhập nhầm.
      if (r!.sapoVerifiedAt) fail(409, 'Phiếu đã xác minh Sapo; dùng luồng đối soát để sửa liên kết.');
      if (r!.sapoStatus === 'done') fail(409, 'Phiếu ghi nhận thủ công cần đối soát, không mở lại để tạo phiếu mới.');
      await tx.update(supplierReceipts).set({ sapoStatus: status as 'done', sapoReceiptCode: status === 'done' ? code : r!.sapoReceiptCode, sapoNote: note, sapoUpdatedAt: nowIso(), sapoUpdatedBy: m.id }).where(eq(supplierReceipts.id, r!.id));
      const label = { pending: 'chờ nhập Sapo', done: `đã nhập Sapo (mã ${code})`, failed: `nhập Sapo lỗi: ${note}`, not_needed: 'không cần nhập Sapo' }[status as 'done'];
      await event(tx, shipmentId, m.id, 'sapo', `Phiếu ${r!.receiptNo}: ${label}`);
    });
    return json(await viewOf(c, shipmentId));
  }, 'business');

  router.post('/supplier-receipts/:id/cancel', async c => {
    guard(c);
    const db = c.env.db, m = me(c), body = await readJson(c.req, 8_000), reason = str(body.reason, 500);
    if (m.role !== 'manager') fail(403, 'Chỉ Manager được huỷ phiếu nhận.');
    if (reason.length < 3) fail(400, 'Nhập lý do huỷ phiếu nhận.');
    let shipmentId = '';
    await db.transaction(async tx => {
      const r = await lockReceiptForWrite(tx,c.params.id!);
      if (!r) fail(404, 'Không tìm thấy phiếu nhận.');
      shipmentId = r!.shipmentId;
      if (r!.cancelledAt) return;
      const returned = await tx.select({qty:supplierReceiptLines.returnedGoodQty}).from(supplierReceiptLines).where(eq(supplierReceiptLines.receiptId,r!.id));
      if(returned.some(l=>l.qty>0))fail(409,'Phiếu đã có trả hàng NCC. Không hoàn tác phiếu gốc để tránh trừ kho lần hai.');
      if (r!.sapoStatus === 'done' || r!.sapoVerifiedAt || r!.sapoReceiptId || r!.sapoPurchaseOrderId || r!.sapoReceiptCode || r!.sapoReceiptUrl)
        fail(409, 'Phiếu đã có liên kết Sapo – hoàn tác trên Sapo và đối soát trước.');
      const [job]=await tx.select().from(receiptJobs).where(eq(receiptJobs.receiptId,r!.id)).for('update');
      const expected=body.expected as Record<string,unknown>|undefined;
      if(expected && (expected.sapoUpdatedAt!==(r!.sapoUpdatedAt??null)||expected.jobUpdatedAt!==(job?.updatedAt??null)))
        throw new AppError(409,'Phiếu hoặc tiến trình Sapo vừa thay đổi. Tải lại trước khi hoàn tác.','RECEIPT_CHANGED');
      // A delivery failure is not proof that the external write failed: n8n/Sapo may
      // have accepted the request before the response was lost (including HTTP 530).
      // Preserve the same review/lease/CAS requirements after ANY dispatch attempt.
      if(job&&(job.attempts>0||job.dispatchToken||job.leaseToken||['processing','callback_pending','needs_review'].includes(job.status))){
        const now=Date.now(),resolved=body.confirmNoSapo===true&&expected&&job.status==='needs_review'&&!job.dispatchToken&&
          (!job.leaseUntil||Date.parse(job.leaseUntil)<=now)&&(!job.dispatchUntil||Date.parse(job.dispatchUntil)<=now);
        if(!resolved)throw new AppError(409,'Phiếu đang/chờ xử lý nhập Sapo. Dừng và xác minh kết quả luồng n8n/OpenClaw trước khi huỷ để tránh lệch kho.','RECEIPT_SYNC_IN_PROGRESS');
        await tx.update(receiptJobs).set({leaseToken:null,leaseUntil:null,dispatchToken:null,dispatchUntil:null,status:'needs_review',lastError:'Manager xác nhận chưa nhập Sapo; đã hoàn tác phiếu CRM. Không gửi lại.',updatedAt:nowIso()}).where(eq(receiptJobs.receiptId,r!.id));
        await event(tx,shipmentId,m.id,'resolve_no_sapo_before_cancel',`Manager xác nhận chưa nhập Sapo trước khi hoàn tác ${r!.receiptNo}`,{receiptId:r!.id,reason,expected});
      }
      await tx.update(supplierReceipts).set({ cancelledAt: nowIso(), cancelledBy: m.id, cancelReason: reason }).where(eq(supplierReceipts.id, r!.id));
      await reverseRef(tx as unknown as Db, m.id, 'supplier_receipt', r!.id, `Huỷ phiếu nhận ${r!.receiptNo}: ${reason}`);
      await removeMovements(tx, `receipt:${r!.id}:`);
      await tx.update(incomingShipments).set({ receivedAt: null, receivedBy: null }).where(eq(incomingShipments.id, shipmentId));
      await event(tx, shipmentId, m.id, 'cancel_receipt', `Huỷ phiếu nhận ${r!.receiptNo} – ${reason}`);
    });
    return json(await viewOf(c, shipmentId));
  }, 'business');

  // ---- Thanh toán NCC (Manager / Kế toán)
  router.put('/purchase-orders/:id/schedules', async c => {
    guard(c);
    const db = c.env.db, m = me(c), id = c.params.id!, body = await readJson(c.req, 40_000);
    await db.transaction(async tx => {
      const p = await lockAndCheck(c, tx, id, 'schedule');
      const schedules = buildSchedules(p.raw.totals.total, (body.payment ?? {}) as Parameters<typeof buildSchedules>[1]);
      await tx.delete(supplierPaymentSchedules).where(eq(supplierPaymentSchedules.shipmentId, id));
      if (schedules.length) await tx.insert(supplierPaymentSchedules).values(schedules.map(s => ({ id: crypto.randomUUID(), shipmentId: id, ...s, createdAt: nowIso() })));
      await event(tx, id, m.id, 'schedule', 'Sửa lịch trả NCC: ' + schedules.map(s => `${Math.round(s.amount).toLocaleString('vi-VN')} đ${s.dueDate ? ' hạn ' + s.dueDate.split('-').reverse().join('/') : ''}`).join('; '), { schedules });
    });
    return json(await viewOf(c, id));
  }, 'business');

  router.post('/purchase-orders/:id/payments', async c => {
    guard(c);
    const db = c.env.db, m = me(c), id = c.params.id!, body = await readJson(c.req, 9_000_000), clientKey = str(body.clientKey, 80);
    if (clientKey.length < 8) fail(400, 'Thiếu mã chống bấm lặp – tải lại trang rồi thử lại.');
    const [dup] = await db.select({ id: supplierPayments.id, shipmentId: supplierPayments.shipmentId }).from(supplierPayments).where(eq(supplierPayments.clientKey, clientKey)).limit(1);
    if (dup) { if (dup.shipmentId !== id) fail(409, 'Mã chống bấm lặp đã dùng cho đơn khác.'); return json({ ...await viewOf(c, id), duplicate: true }); }
    const amount = Math.round(Number(body.amount)), paidDate = body.paidDate ? String(body.paidDate) : today();
    if (!(amount > 0 && amount <= 1e13)) fail(400, 'Số tiền trả không hợp lệ.');
    if (!isIsoDate(paidDate) || paidDate > today()) fail(400, 'Ngày trả không hợp lệ.');
    const method = ['transfer', 'cash', 'other'].includes(String(body.method)) ? String(body.method) as 'transfer' : 'transfer';
    // Chứng từ (ảnh / PDF ≤ 6 MB) lưu kho file private.
    const file = body.attachment as { name?: unknown; mime?: unknown; data?: unknown } | undefined;
    let attachmentKey = '', attachmentName = '', bytes: Uint8Array | null = null, mime = '';
    if (file && file.data) {
      mime = String(file.mime); if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mime)) fail(400, 'Chứng từ phải là ảnh hoặc PDF.');
      bytes = Uint8Array.from(atob(String(file.data).replace(/^data:[^,]*,/, '')), ch => ch.charCodeAt(0));
      if (!bytes.length || bytes.length > 6 * 1024 * 1024) fail(400, 'Chứng từ tối đa 6 MB.');
      if (!c.env.files) fail(503, 'Chưa cấu hình kho file, tạm thời chưa đính kèm được chứng từ.');
      attachmentName = str(file.name, 200) || 'chung-tu'; attachmentKey = `supplier-payments/${id}/${crypto.randomUUID()}.${mime === 'application/pdf' ? 'pdf' : mime.split('/')[1]}`;
    }
    await db.transaction(async tx => {
      const p = await lockAndCheck(c, tx, id, 'pay');
      if (amount > p.raw.debt.balance + 1) fail(409, `Số tiền vượt công nợ còn lại ${Math.round(p.raw.debt.balance).toLocaleString('vi-VN')} đ.`);
      if (bytes) await c.env.files!.put(attachmentKey, bytes, mime);
      await tx.insert(supplierPayments).values({ id: crypto.randomUUID(), shipmentId: id, amount, paidDate, method, reference: str(body.reference, 120), note: str(body.note, 1000),
        attachmentKey, attachmentName, clientKey, createdBy: m.id, createdAt: nowIso() });
      await tx.update(incomingShipments).set({ paidAmount: p.raw.debt.paid + amount, ...(p.raw.order.depositPaidAt ? {} : { depositPaidAt: nowIso(), depositPaidBy: m.id }) }).where(eq(incomingShipments.id, id));
      await event(tx, id, m.id, 'pay', `Trả NCC ${amount.toLocaleString('vi-VN')} đ ngày ${paidDate.split('-').reverse().join('/')}` + (str(body.reference, 120) ? ` (CT ${str(body.reference, 120)})` : ''));
    });
    return json(await viewOf(c, id), 201);
  }, 'business');

  router.post('/supplier-payments/:id/void', async c => {
    guard(c);
    const db = c.env.db, m = me(c), body = await readJson(c.req, 8_000), reason = str(body.reason, 500);
    if (m.role !== 'manager') fail(403, 'Chỉ Manager được huỷ khoản trả NCC.');
    if (reason.length < 3) fail(400, 'Nhập lý do huỷ khoản trả.');
    let shipmentId = '';
    await db.transaction(async tx => {
      const [hint]=await tx.select({shipmentId:supplierPayments.shipmentId}).from(supplierPayments).where(eq(supplierPayments.id,c.params.id!));
      if(!hint)fail(404,'Không tìm thấy khoản trả.');
      const [parent]=await tx.select({refundedAmount:incomingShipments.refundedAmount}).from(incomingShipments).where(eq(incomingShipments.id,hint!.shipmentId)).for('update');
      const [pay] = await tx.select().from(supplierPayments).where(eq(supplierPayments.id, c.params.id!)).limit(1).for('update');
      if (!pay) fail(404, 'Không tìm thấy khoản trả.');
      if(pay!.shipmentId!==hint!.shipmentId)fail(409,'Khoản trả vừa đổi đơn nguồn. Tải lại trước khi xử lý.');
      shipmentId = pay!.shipmentId;
      if (pay!.voidedAt) return;
      const active=await tx.select({amount:supplierPayments.amount}).from(supplierPayments).where(and(eq(supplierPayments.shipmentId,shipmentId),isNull(supplierPayments.voidedAt)));
      if(parent && active.reduce((s,p)=>s+p.amount,0)-pay!.amount<parent.refundedAmount)fail(409,'Khoản chi đã liên quan tiền hoàn thực nhận. Không huỷ; cần kế toán đối soát chứng từ điều chỉnh.');
      await tx.update(supplierPayments).set({ voidedAt: nowIso(), voidedBy: m.id, voidReason: reason }).where(eq(supplierPayments.id, pay!.id));
      const left = await tx.select({ amount: supplierPayments.amount }).from(supplierPayments).where(and(eq(supplierPayments.shipmentId, shipmentId), isNull(supplierPayments.voidedAt)));
      await tx.update(incomingShipments).set({ paidAmount: left.reduce((s, r) => s + r.amount, 0) }).where(eq(incomingShipments.id, shipmentId));
      await event(tx, shipmentId, m.id, 'void_payment', `Huỷ khoản trả ${pay!.amount.toLocaleString('vi-VN')} đ – ${reason}`);
    });
    return json(await viewOf(c, shipmentId));
  }, 'business');

  router.get('/supplier-payments/:id/attachment', async c => {
    guard(c);
    const db = c.env.db, m = me(c);
    const [pay] = await db.select().from(supplierPayments).where(eq(supplierPayments.id, c.params.id!)).limit(1);
    if (!pay?.attachmentKey) fail(404, 'Khoản trả không có chứng từ.');
    const purchase = await loadPurchase(db, m, pay!.shipmentId, today());
    if (!canSeePurchasePrices(asActor(m), purchase.raw.order)) fail(403, 'Bạn không có quyền xem chứng từ thanh toán của đơn này.');
    if (!c.env.files) fail(503, 'Chưa cấu hình kho file.');
    const url = (await c.env.files!.signedUrls([pay!.attachmentKey], 600)).get(pay!.attachmentKey);
    if (!url) fail(404, 'Không tạo được link chứng từ.');
    return json({ url, name: pay!.attachmentName });
  }, 'business');
}

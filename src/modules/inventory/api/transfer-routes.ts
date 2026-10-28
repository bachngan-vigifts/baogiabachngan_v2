import { transferTasksChanged } from './transfer-task-hooks.ts';
import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, positionPermissions } from '../../staff/schema.ts';
import { can, canApprove } from '../../staff/domain/permissions.ts';
import { products, warehouses } from '../../catalog/schema.ts';
import { readCatalogStock } from '../../catalog/api/stock-source.ts';
import { notify, notifyMany } from '../../notifications/api/routes.ts';
import { webNotifications } from '../../notifications/schema.ts';
import { stockBalances, stockMoves, stockTransferLines, stockTransfers, warehouseSellers } from '../schema.ts';
import { TRANSFER_STATUS_LABEL, type TransferStatus } from '../domain/kinds.ts';
import { postMoves, lockLedger, assertWarehousesOpened } from './ledger.ts';
import { hiddenWarehouseIds } from './warehouse-access.ts';

/**
 * ĐIỀU CHUYỂN KHO (docs/SO-KHO.md "Điều chuyển kho"): nhân viên bán kho này thiếu hàng → xin chuyển từ kho khác.
 *  POST /stock-transfers                 mọi nhân viên: kho đi, kho đến, lý do, các mã + số lượng → Chờ duyệt (báo nhân viên kho được xin + người duyệt)
 *  POST /stock-transfers/:id/approve      nhân viên KHO ĐƯỢC XIN (chức vụ bán kho đi, không phải người xin) hoặc Manager / người được chỉ định
 *                                          → Đã duyệt (báo người xin + nhóm Kho + nhân viên kho được xin)
 *  POST /stock-transfers/:id/reject       như duyệt, bắt buộc lý do
 *  Chờ duyệt quá 1 giờ: nhắc lại mỗi giờ (remindPendingTransfers, chạy theo nhịp GET /pulse).
 *  POST /stock-transfers/:id/cancel       người xin hoặc Manager, khi chưa chuyển
 *  POST /stock-transfers/:id/done         quyền "Điều chuyển kho" (Kho) hoặc nhân viên kho được xin: trừ kho đi, cộng kho đến trong sổ kho – một lần
 *  GET  /stock-transfers, /stock-transfers/:id
 * Kho riêng (Hoá đơn) chỉ người bán kho đó / Manager thấy và chọn được. Tồn kho đi (đã chốt đầu kỳ) không đủ thì không cho chuyển.
 */
type Ctx = RouteContext<StaffEnv>;
type ReadDb = StaffEnv['db'] | Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
const me = (c: Ctx) => (c.state.session as SessionState).member;
const fail = (status: number, message: string, code?: string): never => { throw new AppError(status, message, code); };
const num = (v: unknown) => Math.round(Number(v) * 1000) / 1000;
const nowIso = () => new Date().toISOString();
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim() : '').slice(0, max);
const canMove = (m: ReturnType<typeof me>) => can(m, 'stock.transfer');
type Member = ReturnType<typeof me>;

/** Chức vụ bán của kho (Phân quyền kho bán) = nhân viên của kho đó: kho được xin duyệt / từ chối phiếu xin hàng của mình. */
async function sellerPositions(db: ReadDb, warehouseId: string) {
  return (await db.select({ p: warehouseSellers.positionId }).from(warehouseSellers).where(eq(warehouseSellers.warehouseId, warehouseId))).map(r => r.p);
}
/** Nhân viên đang làm của kho (theo chức vụ bán kho) – nhận thông báo / việc duyệt phiếu xin hàng từ kho này. */
export async function warehouseStaff(db: ReadDb, warehouseId: string) {
  const positions = await sellerPositions(db, warehouseId);
  return positions.length ? (await db.select({ id: employees.id }).from(employees).where(and(eq(employees.role, 'employee'), eq(employees.active, true),
    sql`${employees.deletedAt} IS NULL`, inArray(employees.positionId, positions)))).map(r => r.id) : [];
}
/** Người được Cho / Từ chối phiếu: Manager / người được chỉ định duyệt, hoặc nhân viên kho được xin (không tự duyệt phiếu mình xin). */
async function canDecide(db: ReadDb, m: Member, t: { fromWarehouseId: string; requestedBy: string }) {
  if (canApprove(m)) return true;
  const pos = (m as { positionId?: string | null }).positionId;
  return m.role === 'employee' && !!pos && t.requestedBy !== m.id && (await sellerPositions(db, t.fromWarehouseId)).includes(pos);
}
/** Kho được xin tự chuyển hàng (cửa hàng không có nhóm Kho riêng). */
async function canShip(db: ReadDb, m: Member, t: { fromWarehouseId: string }) {
  if (canMove(m)) return true;
  const pos = (m as { positionId?: string | null }).positionId;
  return m.role === 'employee' && !!pos && (await sellerPositions(db, t.fromWarehouseId)).includes(pos);
}

async function visibleWarehouses(c: Ctx, db: ReadDb = c.env.db) {
  const hidden = await hiddenWarehouseIds(db, me(c));
  return (await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(and(eq(warehouses.kind, 'stock'), eq(warehouses.active, true)))
    .orderBy(asc(warehouses.sortOrder), asc(warehouses.name))).filter(w => !hidden.has(w.id));
}

async function viewOf(c: Ctx, id: string) {
  const db = c.env.db, m = me(c);
  const [t] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, id)).limit(1);
  if (!t) fail(404, 'Không tìm thấy phiếu điều chuyển.');
  const hidden = await hiddenWarehouseIds(db, m);
  if (hidden.has(t!.fromWarehouseId) || hidden.has(t!.toWarehouseId)) fail(404, 'Không tìm thấy phiếu điều chuyển.');
  const [lines, whs, people] = await Promise.all([
    db.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, id)).orderBy(asc(stockTransferLines.sku)),
    db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(inArray(warehouses.id, [t!.fromWarehouseId, t!.toWarehouseId])),
    db.select({ id: employees.id, name: employees.name }).from(employees)
      .where(inArray(employees.id, [t!.requestedBy, t!.approvedBy, t!.doneBy, t!.cancelledBy].filter((x): x is string => !!x))),
  ]);
  const [stock, decide, ship] = await Promise.all([readCatalogStock(db, lines.map(l => l.sku)), canDecide(db, m, t!), canShip(db, m, t!)]);
  const at = (sku: string, wh: string) => num(stock.find(s => s.sku === sku && s.warehouseId === wh)?.quantity ?? 0);
  const name = (id: string | null) => id ? people.find(p => p.id === id)?.name ?? '' : '';
  const status = t!.status as TransferStatus;
  return {
    ...t!, statusLabel: TRANSFER_STATUS_LABEL[status],
    fromName: whs.find(w => w.id === t!.fromWarehouseId)?.name ?? '', toName: whs.find(w => w.id === t!.toWarehouseId)?.name ?? '',
    requestedByName: name(t!.requestedBy), approvedByName: name(t!.approvedBy), doneByName: name(t!.doneBy), cancelledByName: name(t!.cancelledBy),
    lines: lines.map(l => ({ sku: l.sku, name: l.name, unit: l.unit, qty: l.qty, fromStock: at(l.sku, t!.fromWarehouseId), toStock: at(l.sku, t!.toWarehouseId) })),
    actions: {
      edit: status === 'pending' && (m.role === 'manager' || t!.requestedBy === m.id),
      approve: status === 'pending' && decide, reject: status === 'pending' && decide,
      cancel: (status === 'pending' || status === 'approved') && (m.role === 'manager' || t!.requestedBy === m.id),
      done: status === 'approved' && ship,
    },
  };
}

/** Khoá phiếu + kiểm trạng thái / phiên bản trong giao dịch (hai người bấm cùng lúc chỉ một người được). */
async function lock(tx: Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0], id: string, want: TransferStatus[], revision: unknown) {
  const [t] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id)).limit(1).for('update');
  if (!t) fail(404, 'Không tìm thấy phiếu điều chuyển.');
  if (!want.includes(t!.status as TransferStatus)) fail(409, `Phiếu đang ở trạng thái "${TRANSFER_STATUS_LABEL[t!.status as TransferStatus]}". Tải lại trang.`, 'TRANSFER_CHANGED');
  if (revision !== undefined && Number(revision) !== t!.revision) fail(409, 'Phiếu vừa được người khác cập nhật. Tải lại trang.', 'TRANSFER_CHANGED');
  return t!;
}
const bump = { revision: sql`${stockTransfers.revision} + 1` };

/** Nhóm Kho = chức vụ Kho + chức vụ có quyền "Điều chuyển kho". */
async function moveTeam(db: StaffEnv['db']) {
  return (await db.select({ id: employees.id }).from(employees).where(and(eq(employees.role, 'employee'), eq(employees.active, true), sql`${employees.deletedAt} IS NULL`,
    or(eq(employees.positionId, 'warehouse'), sql`${employees.positionId} IN (SELECT ${positionPermissions.positionId} FROM ${positionPermissions} WHERE ${positionPermissions.permission} = 'stock.transfer')`)))).map(r => r.id);
}

/** Thông báo (chuông + Web Push) chạy nền sau khi trả lời: nút Duyệt / Từ chối / Đã chuyển không phải chờ gửi push. Lỗi gửi không ảnh hưởng phiếu. */
function background(env: StaffEnv, job: Promise<unknown>) {
  const safe = job.catch(e => console.error('transfer notification failed', e instanceof Error ? e.message : e));
  if (env.waitUntil) env.waitUntil(safe); else return safe;
}

async function transferInput(c: Ctx, body: Record<string, unknown>, db: ReadDb = c.env.db) {
    const from = str(body.fromWarehouseId, 80), to = str(body.toWarehouseId, 80), reason = str(body.reason, 500);
    const whs = await visibleWarehouses(c,db);
    if (!whs.some(w => w.id === from) || !whs.some(w => w.id === to)) fail(400, 'Chọn kho đi và kho đến.');
    if (from === to) fail(400, 'Kho đi và kho đến phải khác nhau.');
    if (reason.length < 3) fail(400, 'Nhập lý do điều chuyển (VD: đơn của khách X cần hàng ở kho này).');
    const want = new Map<string, number>();
    for (const l of (Array.isArray(body.lines) ? body.lines as Record<string, unknown>[] : []).slice(0, 200)) {
      const sku = str(l.sku, 200), qty = num(l.qty);
      if (!sku) continue;
      if (!(qty > 0 && qty <= 1e7)) fail(400, `Số lượng của ${sku} không hợp lệ.`);
      want.set(sku, num((want.get(sku) ?? 0) + qty));
    }
    if (!want.size) fail(400, 'Thêm ít nhất một mã hàng cần chuyển.');
    const found = await db.select({ sku: products.sku, name: products.name, unit: products.unit }).from(products).where(inArray(products.sku, [...want.keys()]));
    const unknown = [...want.keys()].filter(s => !found.some(p => p.sku === s));
    if (unknown.length) fail(400, 'Mã không có trong danh mục: ' + unknown.slice(0, 10).join(', '));
  return { from,to,reason,whs,want,found };
}

/** Kiểm hàng đang giữ ở kho đi trước khi "Đã chuyển" – lắp ráp ở app (sales/api/stock-free.ts). */
export const stockHoldHooks: {
  assertFree?: (tx: Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0], warehouseId: string, lines: readonly { sku: string; qty: number }[],
    opts: { override?: unknown; actor: { id: string; role: string }; context: { module: string; entityType: string; entityId: string; refNo: string } }) => Promise<unknown>;
} = {};
export function registerTransferRoutes(router: Router<StaffEnv>) {
  router.get('/stock-transfers', async c => {
    const db = c.env.db, m = me(c), status = c.url.searchParams.get('status') || '', q = str(c.url.searchParams.get('q'), 80);
    const whs = await visibleWarehouses(c), ids = whs.map(w => w.id);
    if (!ids.length) return json({ transfers: [], warehouses: [] });
    const rows = await db.select({ t: stockTransfers, by: employees.name }).from(stockTransfers).leftJoin(employees, eq(employees.id, stockTransfers.requestedBy))
      .where(and(inArray(stockTransfers.fromWarehouseId, ids), inArray(stockTransfers.toWarehouseId, ids),
        status === 'open' ? inArray(stockTransfers.status, ['pending', 'approved']) : status ? eq(stockTransfers.status, status as TransferStatus) : undefined,
        q ? or(like(stockTransfers.transferNo, `%${q.replace(/[\\%_]/g, '')}%`), sql`EXISTS (SELECT 1 FROM ${stockTransferLines} WHERE ${stockTransferLines.transferId} = ${stockTransfers.id} AND ${stockTransferLines.sku} ILIKE ${'%' + q.replace(/[\\%_]/g, '') + '%'})`) : undefined))
      .orderBy(desc(stockTransfers.createdAt)).limit(300);
    const counts = rows.length ? await db.select({ id: stockTransferLines.transferId, n: sql<number>`count(*)`.mapWith(Number), qty: sql<number>`sum(${stockTransferLines.qty})`.mapWith(Number) })
      .from(stockTransferLines).where(inArray(stockTransferLines.transferId, rows.map(r => r.t.id))).groupBy(stockTransferLines.transferId) : [];
    const wName = (id: string) => whs.find(w => w.id === id)?.name ?? '';
    return json({ warehouses: whs, canApprove: canApprove(m), canMove: canMove(m), transfers: rows.map(({ t, by }) => ({ id: t.id, transferNo: t.transferNo, status: t.status,
      statusLabel: TRANSFER_STATUS_LABEL[t.status as TransferStatus], fromName: wName(t.fromWarehouseId), toName: wName(t.toWarehouseId), reason: t.reason,
      requestedByName: by ?? '', createdAt: t.createdAt, doneAt: t.doneAt, lineCount: counts.find(x => x.id === t.id)?.n ?? 0, qty: num(counts.find(x => x.id === t.id)?.qty ?? 0) })) });
  }, 'business');

  router.get('/stock-transfers/:id', async c => json(await viewOf(c, c.params.id!)), 'business');

  router.post('/stock-transfers', async c => {
    const db = c.env.db, m = me(c), body = await readJson(c.req, 100_000);
    const {from,to,reason,whs,want,found}=await transferInput(c,body);
    const clientKey=body.clientKey;
    if(clientKey!==undefined&&(typeof clientKey!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientKey)))fail(400,'Khóa tạo phiếu không hợp lệ.');
    const id = typeof clientKey==='string'?clientKey:crypto.randomUUID(), now = nowIso(), day = now.slice(0, 10).replaceAll('-', '');
    let transferNo = '',replayed=false;
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stock_transfer_client:'+id}))`);
      const [old]=await tx.select().from(stockTransfers).where(eq(stockTransfers.id,id));
      if(old){
        const previous=await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId,id));
        if(old.requestedBy!==m.id||old.fromWarehouseId!==from||old.toWarehouseId!==to||old.reason!==reason||previous.length!==want.size||previous.some(l=>want.get(l.sku)!==l.qty))fail(409,'Khóa tạo phiếu đã dùng cho nội dung khác. Mở phiếu mới để gửi lại.','IDEMPOTENCY_CONFLICT');
        replayed=true;transferNo=old.transferNo;return;
      }
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_transfer_no'))`);
      const [n] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(stockTransfers).where(like(stockTransfers.transferNo, `PCK${day}-%`));
      transferNo = `PCK${day}-${String((n?.n ?? 0) + 1).padStart(3, '0')}`;
      await tx.insert(stockTransfers).values({ id, transferNo, fromWarehouseId: from, toWarehouseId: to, status: 'pending', reason, requestedBy: m.id, createdAt: now, updatedAt: now });
      await tx.insert(stockTransferLines).values(found.map(p => ({ id: crypto.randomUUID(), transferId: id, sku: p.sku, name: p.name, unit: p.unit, qty: want.get(p.sku)! })));
    });
    await transferTasksChanged(c.env, id, m.id);
    if(replayed)return json({...await viewOf(c,id),replayed:true});
    const wName = (x: string) => whs.find(w => w.id === x)?.name ?? '';
    const pending = { eventType: 'transfer_pending', title: 'Phiếu xin hàng chờ duyệt', body: `${m.name}: ${transferNo} · ${wName(from)} → ${wName(to)} – ${reason}`,
      url: `/index.html#/transfers/${id}`, actorId: m.id, data: { transferId: id } };
    // Nhân viên kho được xin quyết Cho / Từ chối; Manager / người được chỉ định vẫn nhận để duyệt thay.
    await background(c.env, warehouseStaff(db, from).then(async staff => {
      await notifyMany(c.env, staff, { ...pending, title: `Kho ${wName(from)}: có phiếu xin hàng`, body: `${pending.body}. Bấm Cho hoặc Từ chối trên phiếu.` });
      await notifyMany(c.env, 'approvers', pending, staff);
    }));
    return json(await viewOf(c, id), 201);
  }, 'business');

  router.put('/stock-transfers/:id', async c => {
    const m=me(c),id=c.params.id!,body=await readJson(c.req,100_000);
    await viewOf(c,id);
    if(!Number.isSafeInteger(body.revision)||Number(body.revision)<1)fail(400,'Thiếu phiên bản phiếu. Vui lòng tải lại.');
    await c.env.db.transaction(async tx=>{
      const t=await lock(tx,id,['pending'],body.revision);
      if(m.role!=='manager'&&t.requestedBy!==m.id)fail(403,'Chỉ người xin hoặc Manager được sửa phiếu chờ duyệt.');
      const {from,to,reason,want,found}=await transferInput(c,body,tx);
      await tx.update(stockTransfers).set({fromWarehouseId:from,toWarehouseId:to,reason,updatedAt:nowIso(),...bump}).where(eq(stockTransfers.id,id));
      await tx.delete(stockTransferLines).where(eq(stockTransferLines.transferId,id));
      await tx.insert(stockTransferLines).values(found.map(p=>({id:crypto.randomUUID(),transferId:id,sku:p.sku,name:p.name,unit:p.unit,qty:want.get(p.sku)!})));
    });
    await transferTasksChanged(c.env, id, m.id);
    return json(await viewOf(c,id));
  },'business');

  router.post('/stock-transfers/:id/approve', async c => {
    const m = me(c), id = c.params.id!, body = await readJson(c.req, 2_000);
    await viewOf(c, id);
    const t = await c.env.db.transaction(async tx => {
      const t = await lock(tx, id, ['pending'], body.revision), now = nowIso();
      if (!await canDecide(tx, m, t)) fail(403, 'Chỉ nhân viên kho được xin, Manager hoặc người được chỉ định duyệt phiếu xin hàng (không tự duyệt phiếu mình xin).', 'APPROVER_ONLY');
      await tx.update(stockTransfers).set({ status: 'approved', approvedBy: m.id, approvedAt: now, updatedAt: now, ...bump }).where(eq(stockTransfers.id, id));
      return t;
    });
    await transferTasksChanged(c.env, id, m.id);
    const v = await viewOf(c, id);
    await background(c.env, notify(c.env, { eventType: 'transfer_approved', title: 'Điều chuyển kho đã được duyệt', body: `${v.transferNo} · ${v.fromName} → ${v.toName}`, url: `/index.html#/transfers/${id}`, targetMemberId: t.requestedBy, actorId: m.id }));
    await background(c.env, Promise.all([moveTeam(c.env.db), warehouseStaff(c.env.db, t.fromWarehouseId)]).then(([team, staff]) => notifyMany(c.env, [...team, ...staff], { eventType: 'transfer_move', title: 'Kho: chuyển hàng giữa các kho', body: `${v.transferNo} · ${v.fromName} → ${v.toName} · ${v.lines.length} mã`,
      url: `/index.html#/transfers/${id}`, actorId: m.id }, [t.requestedBy])));
    return json(v);
  }, 'business');

  router.post('/stock-transfers/:id/reject', async c => {
    const m = me(c), id = c.params.id!, body = await readJson(c.req, 4_000), reason = str(body.reason, 500);
    if (reason.length < 3) fail(400, 'Nhập lý do từ chối.');
    await viewOf(c, id);
    const t = await c.env.db.transaction(async tx => {
      const t = await lock(tx, id, ['pending'], body.revision), now = nowIso();
      if (!await canDecide(tx, m, t)) fail(403, 'Chỉ nhân viên kho được xin, Manager hoặc người được chỉ định từ chối phiếu xin hàng.', 'APPROVER_ONLY');
      await tx.update(stockTransfers).set({ status: 'rejected', approvedBy: m.id, approvedAt: now, rejectReason: reason, updatedAt: now, ...bump }).where(eq(stockTransfers.id, id));
      return t;
    });
    await background(c.env, notify(c.env, { eventType: 'transfer_rejected', title: 'Điều chuyển kho bị từ chối', body: `${t.transferNo}: ${reason}. Chọn nguồn hàng khác (kho khác / đặt NCC) cho đơn.`, url: `/index.html#/transfers/${id}`, targetMemberId: t.requestedBy, actorId: m.id }));
    await transferTasksChanged(c.env, id, m.id);
    return json(await viewOf(c, id));
  }, 'business');

  router.post('/stock-transfers/:id/cancel', async c => {
    const m = me(c), id = c.params.id!, body = await readJson(c.req, 2_000);
    await viewOf(c, id);
    await c.env.db.transaction(async tx => {
      const t = await lock(tx, id, ['pending', 'approved'], body.revision);
      if (m.role !== 'manager' && t.requestedBy !== m.id) fail(403, 'Chỉ người xin hoặc Manager huỷ được phiếu điều chuyển.');
      const now = nowIso();
      await tx.update(stockTransfers).set({ status: 'cancelled', cancelledBy: m.id, cancelledAt: now, updatedAt: now, ...bump }).where(eq(stockTransfers.id, id));
    });
    await transferTasksChanged(c.env, id, m.id);
    return json(await viewOf(c, id));
  }, 'business');

  /** Kho bấm "Đã chuyển": trừ kho đi, cộng kho đến (một chứng từ, ghi một lần). Kho đi đã chốt đầu kỳ mà tồn không đủ → không cho chuyển. */
  router.post('/stock-transfers/:id/done', async c => {
    const m = me(c), id = c.params.id!, body = await readJson(c.req, 4_000);
    await viewOf(c, id);
    const t = await c.env.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_holds'))`);
      const t = await lock(tx, id, ['approved'], body.revision), now = nowIso();
      if (!await canShip(tx, m, t)) fail(403, 'Chỉ nhóm Kho (quyền "Điều chuyển kho") hoặc nhân viên kho được xin bấm "Đã chuyển".');
      const lines = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, id));
      await lockLedger(tx);
      await assertWarehousesOpened(tx, [t.fromWarehouseId, t.toWarehouseId]);
      const [opened] = await tx.select({ id: stockMoves.id }).from(stockMoves).where(and(eq(stockMoves.warehouseId, t.fromWarehouseId), eq(stockMoves.refType, 'opening'))).limit(1);
      if (opened) {
        const bal = await tx.select({ sku: stockBalances.sku, qty: stockBalances.qty }).from(stockBalances)
          .where(and(eq(stockBalances.warehouseId, t.fromWarehouseId), inArray(stockBalances.sku, lines.map(l => l.sku)))).orderBy(asc(stockBalances.sku), asc(stockBalances.warehouseId)).for('update');
        const short = lines.filter(l => (bal.find(b => b.sku === l.sku)?.qty ?? 0) < l.qty);
        if (short.length) fail(409, 'Tồn kho đi không đủ: ' + short.slice(0, 5).map(l => `${l.sku} (còn ${num(bal.find(b => b.sku === l.sku)?.qty ?? 0)}, cần ${l.qty})`).join('; '), 'TRANSFER_SHORT');
      }
      // Không chuyển đi phần đang giữ cho đơn / báo giá ở kho đi (kiểm do module bán hàng gắn vào – inventory không import sales).
      await stockHoldHooks.assertFree?.(tx, t.fromWarehouseId, lines, { override: body.overrideHolds, actor: m,
        context: { module: 'inventory', entityType: 'stock_transfers', entityId: id, refNo: t.transferNo } });
      const note = `${t.transferNo}: ${t.reason}`.slice(0, 500);
      await postMoves(tx, m.id, lines.flatMap(l => [
        { sku: l.sku, warehouseId: t.fromWarehouseId, qty: -l.qty, kind: 'transfer_out' as const, refType: 'stock_transfer' as const, refId: id, refNo: t.transferNo, note },
        { sku: l.sku, warehouseId: t.toWarehouseId, qty: l.qty, kind: 'transfer_in' as const, refType: 'stock_transfer' as const, refId: id, refNo: t.transferNo, note },
      ]), now);
      await tx.update(stockTransfers).set({ status: 'done', doneBy: m.id, doneAt: now, doneNote: str(body.note, 500), updatedAt: now, ...bump }).where(eq(stockTransfers.id, id));
      return t;
    });
    await transferTasksChanged(c.env, id, m.id);
    const v = await viewOf(c, id);
    await background(c.env, notify(c.env, { eventType: 'transfer_done', title: 'Hàng đã chuyển kho', body: `${v.transferNo} · ${v.fromName} → ${v.toName}`, url: `/index.html#/transfers/${id}`, targetMemberId: t.requestedBy, actorId: m.id }));
    return json(v);
  }, 'business');
}

const REMIND_MS = 60 * 60 * 1000;
let lastRemindCheck = 0;
/**
 * NHẮC PHIẾU XIN HÀNG CHỜ DUYỆT QUÁ 1 GIỜ: báo lại nhân viên kho được xin + Manager / người được chỉ định, sau đó mỗi giờ một lần
 * tới khi Cho / Từ chối / huỷ. Chạy theo nhịp GET /pulse (khi có người đang dùng hệ thống, tối đa mỗi phút một lần);
 * khoá tư vấn + thông báo nhắc gần nhất trong bảng thông báo giữ mỗi phiếu chỉ được nhắc một lần mỗi giờ dù nhiều máy chủ chạy song song.
 */
export async function remindPendingTransfers(env: StaffEnv, now = new Date()) {
  if (now.getTime() - lastRemindCheck < 60_000) return 0;
  lastRemindCheck = now.getTime();
  const cutoff = new Date(now.getTime() - REMIND_MS).toISOString();
  const due = await env.db.transaction(async tx => {
    const lockResult = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext('stock_transfer_remind')) as ok`) as unknown;
    const got = (Array.isArray(lockResult) ? lockResult : (lockResult as { rows?: { ok: boolean }[] }).rows ?? [])[0] as { ok: boolean } | undefined;
    if (!got?.ok) return [];
    const rows = await tx.select({ t: stockTransfers, from: warehouses.name, last: sql<string | null>`(select max(${webNotifications.createdAt}) from ${webNotifications}
        where ${webNotifications.eventType} = 'transfer_remind' and ${webNotifications.dataJson} like '%' || ${stockTransfers.id} || '%')` })
      .from(stockTransfers).innerJoin(warehouses, eq(warehouses.id, stockTransfers.fromWarehouseId))
      .where(and(eq(stockTransfers.status, 'pending'), sql`${stockTransfers.createdAt} <= ${cutoff}`)).orderBy(asc(stockTransfers.createdAt)).limit(50);
    const list = rows.filter(r => !r.last || r.last <= cutoff);
    // Ghi mốc nhắc ngay trong khoá: lượt khác (máy chủ khác) thấy đã nhắc giờ này.
    for (const { t } of list) await tx.insert(webNotifications).values({ id: crypto.randomUUID(), eventType: 'transfer_remind', title: 'Mốc nhắc phiếu xin hàng', body: t.transferNo,
      url: `/index.html#/transfers/${t.id}`, targetRole: 'system', targetMemberId: null, dataJson: JSON.stringify({ transferId: t.id }), createdAt: now.toISOString() });
    return list;
  });
  for (const { t, from } of due) {
    const hours = Math.max(1, Math.floor((now.getTime() - Date.parse(t.createdAt)) / REMIND_MS));
    const n = { eventType: 'transfer_pending_reminder', title: `Phiếu xin hàng chờ duyệt ${hours} giờ`, body: `${t.transferNo} · kho ${from}: ${t.reason}. Bấm Cho hoặc Từ chối.`,
      url: `/index.html#/transfers/${t.id}`, data: { transferId: t.id } };
    const staff = await warehouseStaff(env.db, t.fromWarehouseId).catch(() => [] as string[]);
    await notifyMany(env, staff.filter(id => id !== t.requestedBy), n).catch(() => 0);
    await notifyMany(env, 'approvers', n, staff).catch(() => 0);
  }
  return due.length;
}

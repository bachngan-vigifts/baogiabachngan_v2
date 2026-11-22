import { loadTransferApprovalDirectory } from './transfer-approvers.ts';
import { transferCanApprove, transferApprovalLabel } from '../domain/transfer-approval.ts';
import { transferTasksChanged } from './transfer-task-hooks.ts';
import { and, asc, desc, eq, inArray, like, ilike, gte, lt, or, sql } from 'drizzle-orm';
import type { Router, RouteContext } from '../../../core/http/router.ts';
import { json, readJson } from '../../../core/http/router.ts';
import { AppError } from '../../../core/errors.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { employees, positionPermissions } from '../../staff/schema.ts';
import { can } from '../../staff/domain/permissions.ts';
import { products, warehouses } from '../../catalog/schema.ts';
import { readCatalogStock } from '../../catalog/api/stock-source.ts';
import { notify, notifyMany } from '../../notifications/api/routes.ts';
import { webNotifications } from '../../notifications/schema.ts';
import { stockBalances, stockMoves, stockTransferLines, stockTransfers, warehouseSellers } from '../schema.ts';
import { TRANSFER_STATUS_LABEL, type TransferStatus } from '../domain/kinds.ts';
import { postMoves, lockLedger, assertWarehousesOpened } from './ledger.ts';
import { hiddenWarehouseIds } from './warehouse-access.ts';
import { queueTransferReceived, dispatchTransferJob, transferCommandKey, transferIntegrationView } from './transfer-outbox.ts';

/**
 * ĐIỀU CHUYỂN KHO (docs/SO-KHO.md "Điều chuyển kho"): nhân viên bán kho này thiếu hàng → xin chuyển từ kho khác.
 *  POST /stock-transfers                 mọi nhân viên: kho đi, kho đến, lý do, các mã + số lượng → Chờ duyệt (báo nhân viên kho được xin + người duyệt)
 *  POST /stock-transfers/:id/approve      chức vụ đối ứng của người xin (Sale Admin ↔ NVBH Lock/Minh Long), hoặc Manager
 *                                          → Đã duyệt (báo người xin + nhóm Kho + nhân viên kho được xin)
 *  POST /stock-transfers/:id/reject       như duyệt, bắt buộc lý do
 *  Chờ duyệt quá 1 giờ: nhắc lại mỗi giờ (remindPendingTransfers, chạy theo nhịp GET /pulse).
 *  POST /stock-transfers/:id/cancel       người xin hoặc Manager, khi chưa chuyển
 *  POST /stock-transfers/:id/ship         quyền "Điều chuyển kho" (Kho) hoặc nhân viên kho được xin: "Đã chuyển" → trừ kho đi trong sổ kho, phiếu "Đang chuyển" – một lần
 *  POST /stock-transfers/:id/receive      nhân viên được phân kho đến / Manager: nhập SL thực nhận TỪNG mã → cộng kho đến; phần thiếu chờ đối soát
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
/** Manager bypasses the position matrix; a generic approval flag does not. */
async function canDecide(db: ReadDb, m: Member, t: { requestedBy: string }) {
  if(m.role==='manager')return true;
  const [requester]=await db.select({id:employees.id,role:employees.role,positionId:employees.positionId,active:employees.active,deletedAt:employees.deletedAt}).from(employees).where(eq(employees.id,t.requestedBy)).limit(1);
  return transferCanApprove(m,requester);
}
/** Kho được xin tự chuyển hàng (cửa hàng không có nhóm Kho riêng). */
async function canShip(db: ReadDb, m: Member, t: { fromWarehouseId: string }) {
  if (canMove(m)) return true;
  const pos = (m as { positionId?: string | null }).positionId;
  return m.role === 'employee' && !!pos && (await sellerPositions(db, t.fromWarehouseId)).includes(pos);
}
/** Only Manager or staff assigned to the destination warehouse may confirm receipt. */
async function canReceive(db: ReadDb, m: Member, t: { toWarehouseId: string; requestedBy: string }) {
  if (m.role === 'manager') return true;
  const pos = (m as { positionId?: string | null }).positionId;
  return m.role === 'employee' && !!pos && (await sellerPositions(db, t.toWarehouseId)).includes(pos);
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
    db.select({ id: employees.id, name: employees.name,role:employees.role,positionId:employees.positionId,active:employees.active,deletedAt:employees.deletedAt }).from(employees)
      .where(inArray(employees.id, [t!.requestedBy, t!.approvedBy, t!.shippedBy, t!.doneBy, t!.cancelledBy].filter((x): x is string => !!x))),
  ]);
  const requester=people.find(p=>p.id===t!.requestedBy),decide=transferCanApprove(m,requester);
  const [stock, ship, receive] = await Promise.all([readCatalogStock(db, lines.map(l => l.sku)), canShip(db, m, t!), canReceive(db, m, t!)]);
  const at = (sku: string, wh: string) => num(stock.find(s => s.sku === sku && s.warehouseId === wh)?.quantity ?? 0);
  const name = (id: string | null) => id ? people.find(p => p.id === id)?.name ?? '' : '';
  const status = t!.status as TransferStatus;
  return {
    ...t!, statusLabel: TRANSFER_STATUS_LABEL[status], approvalBy:transferApprovalLabel(requester?.role==='employee'&&requester.active&&!requester.deletedAt?requester.positionId:null),
    fromName: whs.find(w => w.id === t!.fromWarehouseId)?.name ?? '', toName: whs.find(w => w.id === t!.toWarehouseId)?.name ?? '',
    requestedByName: name(t!.requestedBy), approvedByName: name(t!.approvedBy), shippedByName: name(t!.shippedBy), doneByName: name(t!.doneBy), cancelledByName: name(t!.cancelledBy),
    integration: await transferIntegrationView(c.env,id),
    lines: lines.map(l => ({ sku: l.sku, name: l.name, unit: l.unit, qty: l.qty, shippedQty: l.shippedQty ?? (['shipped','done'].includes(status) ? l.qty : null), receivedQty: l.receivedQty ?? (status === 'done' ? l.qty : null), fromStock: at(l.sku, t!.fromWarehouseId), toStock: at(l.sku, t!.toWarehouseId) })),
    actions: {
      adjustBalance: can(m, 'inventory.view') && can(m, 'inventory.manage'),
      edit: status === 'pending' && (m.role === 'manager' || t!.requestedBy === m.id),
      approve: status === 'pending' && decide, reject: status === 'pending' && decide,
      cancel: (status === 'pending' || status === 'approved') && (m.role === 'manager' || t!.requestedBy === m.id),
      ship: status === 'approved' && ship, receive: status === 'shipped' && receive,
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
/** Notify only authorized destination staff and Managers about receipt. */
async function loadReceivers(db: StaffEnv['db'], t: { requestedBy: string; toWarehouseId: string }) {
  const [managers, staff] = await Promise.all([db.select({id:employees.id}).from(employees).where(and(eq(employees.role,'manager'),eq(employees.active,true),sql`${employees.deletedAt} IS NULL`)), warehouseStaff(db, t.toWarehouseId)]);
  return [...new Set([...staff, ...managers.map(m=>m.id)])];
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
    if (status && status !== 'open' && !Object.hasOwn(TRANSFER_STATUS_LABEL, status)) fail(400, 'Trạng thái điều chuyển không hợp lệ.');
    const fromWarehouseId = str(c.url.searchParams.get('fromWarehouseId'), 80), toWarehouseId = str(c.url.searchParams.get('toWarehouseId'), 80), requestedBy = str(c.url.searchParams.get('requestedBy'), 80);
    // Date inputs represent Vietnam calendar days; the upper bound is the next midnight.
    const day = (key: string) => {
      const value = c.url.searchParams.get(key) || '';
      if (!value) return null;
      const time = Date.parse(value + 'T00:00:00+07:00');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time + 7 * 3600000).toISOString().slice(0, 10) !== value) fail(400, 'Ngày lọc không hợp lệ.');
      return time;
    };
    const from = day('from'), to = day('to');
    if (from !== null && to !== null && from > to) fail(400, 'Từ ngày phải trước hoặc bằng đến ngày.');
    const whs = await visibleWarehouses(c), ids = whs.map(w => w.id);
    if (!ids.length) return json({ transfers: [], warehouses: [], filterOptions: { requesters: [] } });
    const visible = and(inArray(stockTransfers.fromWarehouseId, ids), inArray(stockTransfers.toWarehouseId, ids));
    const requesters = await db.selectDistinct({ id: stockTransfers.requestedBy, name: employees.name }).from(stockTransfers)
      .leftJoin(employees, eq(employees.id, stockTransfers.requestedBy)).where(visible).orderBy(asc(employees.name), asc(stockTransfers.requestedBy));
    const rows = await db.select({ t: stockTransfers, by: employees.name }).from(stockTransfers).leftJoin(employees, eq(employees.id, stockTransfers.requestedBy))
      .where(and(visible,
        fromWarehouseId ? eq(stockTransfers.fromWarehouseId, fromWarehouseId) : undefined,
        toWarehouseId ? eq(stockTransfers.toWarehouseId, toWarehouseId) : undefined,
        requestedBy ? eq(stockTransfers.requestedBy, requestedBy) : undefined,
        from !== null ? gte(stockTransfers.createdAt, new Date(from).toISOString()) : undefined,
        to !== null ? lt(stockTransfers.createdAt, new Date(to + 86400000).toISOString()) : undefined,
        status === 'open' ? inArray(stockTransfers.status, ['pending', 'approved', 'shipped']) : status ? eq(stockTransfers.status, status as TransferStatus) : undefined,
        q ? or(ilike(stockTransfers.transferNo, `%${q.replace(/[\\%_]/g, '')}%`), sql`EXISTS (SELECT 1 FROM ${stockTransferLines} WHERE ${stockTransferLines.transferId} = ${stockTransfers.id} AND ${stockTransferLines.sku} ILIKE ${'%' + q.replace(/[\\%_]/g, '') + '%'})`) : undefined))
      .orderBy(desc(stockTransfers.createdAt)).limit(300);
    const counts = rows.length ? await db.select({ id: stockTransferLines.transferId, n: sql<number>`count(*)`.mapWith(Number), qty: sql<number>`sum(${stockTransferLines.qty})`.mapWith(Number) })
      .from(stockTransferLines).where(inArray(stockTransferLines.transferId, rows.map(r => r.t.id))).groupBy(stockTransferLines.transferId) : [];
    const wName = (id: string) => whs.find(w => w.id === id)?.name ?? '';
    return json({ warehouses: whs, filterOptions: { requesters: requesters.map(r => ({ id: r.id, name: r.name || r.id })) }, canApprove: m.role==='manager'||(m.role==='employee'&&['sale-admin','sales-lock','sales-ml'].includes(m.positionId||'')), canMove: canMove(m), transfers: rows.map(({ t, by }) => ({ id: t.id, transferNo: t.transferNo, status: t.status,
      statusLabel: TRANSFER_STATUS_LABEL[t.status as TransferStatus], fromName: wName(t.fromWarehouseId), toName: wName(t.toWarehouseId), reason: t.reason,
      requestedByName: by ?? '', createdAt: t.createdAt, doneAt: t.doneAt, lineCount: counts.find(x => x.id === t.id)?.n ?? 0, qty: num(counts.find(x => x.id === t.id)?.qty ?? 0) })) });
  }, 'business');

  router.get('/stock-transfers/:id', async c => json(await viewOf(c, c.params.id!)), 'business');

  type Tx = Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0];
  type View = Awaited<ReturnType<typeof viewOf>>;
  async function approveIn(tx: Tx, m: Member, id: string, revision: unknown) {
    const t = await lock(tx, id, ['pending'], revision), now = nowIso();
    if (!await canDecide(tx, m, t)) fail(403, 'Sale Admin xin: chỉ NVBH Lock/Minh Long hoặc Manager duyệt; NVBH xin: chỉ Sale Admin hoặc Manager duyệt. Không tự duyệt phiếu mình xin.', 'APPROVER_ONLY');
    await tx.update(stockTransfers).set({ status: 'approved', approvedBy: m.id, approvedAt: now, updatedAt: now, ...bump }).where(eq(stockTransfers.id, id));
    return t;
  }
  async function shipIn(tx: Tx, m: Member, id: string, body: Record<string, unknown>) {
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
    await postMoves(tx, m.id, lines.map(l => ({ sku: l.sku, warehouseId: t.fromWarehouseId, qty: -l.qty, kind: 'transfer_out' as const, refType: 'stock_transfer' as const, refId: id, refNo: t.transferNo, note })), now);
    await tx.update(stockTransferLines).set({shippedQty:sql`${stockTransferLines.qty}`}).where(eq(stockTransferLines.transferId,id));
    await tx.update(stockTransfers).set({ status: 'shipped', shippedBy: m.id, shippedAt: now, shippedNote: str(body.note, 500), updatedAt: now, ...bump }).where(eq(stockTransfers.id, id));
    return t;
  }
  const notifyMove = (env: StaffEnv, v: View, t: { requestedBy: string; fromWarehouseId: string }, actorId: string) => Promise.all([moveTeam(env.db), warehouseStaff(env.db, t.fromWarehouseId)]).then(([team, staff]) => notifyMany(env, [...team, ...staff], { eventType: 'transfer_move', title: 'Kho: chuyển hàng giữa các kho', body: `${v.transferNo} · ${v.fromName} → ${v.toName} · ${v.lines.length} mã`,
    url: `/index.html#/transfers/${v.id}`, actorId }, [t.requestedBy]));
  const notifyShipped = (env: StaffEnv, v: View, t: { requestedBy: string; toWarehouseId: string }, actorId: string) => loadReceivers(env.db, t).then(ids => notifyMany(env, ids, { eventType: 'transfer_shipped', title: 'Hàng điều chuyển đang tới – nhận hàng',
    body: `${v.transferNo} · ${v.fromName} → ${v.toName}. Kiểm hàng và nhập số lượng thực nhận trên phiếu.`, url: `/index.html#/transfers/${v.id}`, actorId }));
  router.post('/stock-transfers', async c => {
    const db = c.env.db, m = me(c), body = await readJson(c.req, 100_000);
    const {from,to,reason,whs,want,found}=await transferInput(c,body);
    const mode = body.mode === 'approve' || body.mode === 'ship' ? body.mode : 'request';
    if (mode !== 'request' && m.role !== 'manager') fail(403, 'Chỉ Manager được tạo phiếu đã duyệt / xuất kho ngay.');
    const clientKey=body.clientKey;
    if(clientKey!==undefined&&(typeof clientKey!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientKey)))fail(400,'Khóa tạo phiếu không hợp lệ.');
    const id = typeof clientKey==='string'?clientKey:crypto.randomUUID(), now = nowIso(), day = now.slice(0, 10).replaceAll('-', '');
    let transferNo = '',replayed=false;
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'stock_transfer_client:'+id}))`);
      const [old]=await tx.select().from(stockTransfers).where(eq(stockTransfers.id,id));
      if(old){
        const previous=await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId,id));
        if(old.createMode!==mode||old.requestedBy!==m.id||old.fromWarehouseId!==from||old.toWarehouseId!==to||old.reason!==reason||previous.length!==want.size||previous.some(l=>want.get(l.sku)!==l.qty))fail(409,'Khóa tạo phiếu đã dùng cho nội dung khác. Mở phiếu mới để gửi lại.','IDEMPOTENCY_CONFLICT');
        replayed=true;transferNo=old.transferNo;return;
      }
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_transfer_no'))`);
      const [n] = await tx.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(stockTransfers).where(like(stockTransfers.transferNo, `PCK${day}-%`));
      transferNo = `PCK${day}-${String((n?.n ?? 0) + 1).padStart(3, '0')}`;
      await tx.insert(stockTransfers).values({ id, transferNo, createMode:mode, fromWarehouseId: from, toWarehouseId: to, status: 'pending', reason, requestedBy: m.id, createdAt: now, updatedAt: now });
      await tx.insert(stockTransferLines).values(found.map(p => ({ id: crypto.randomUUID(), transferId: id, sku: p.sku, name: p.name, unit: p.unit, qty: want.get(p.sku)! })));
      // Manager lập phiếu: duyệt luôn, hoặc duyệt + xuất kho đi trong cùng giao dịch (lỗi xuất thì không tạo phiếu).
      if (mode !== 'request') { await approveIn(tx, m, id, undefined); if (mode === 'ship') await shipIn(tx, m, id, { overrideHolds: body.overrideHolds, note: body.note }); }
    });
    await transferTasksChanged(c.env, id, m.id);
    if(replayed)return json({...await viewOf(c,id),replayed:true});
    if (mode !== 'request') {
      const v = await viewOf(c, id), t = { requestedBy: m.id, fromWarehouseId: from, toWarehouseId: to };
      await background(c.env, mode === 'ship' ? notifyShipped(c.env, v, t, m.id) : notifyMove(c.env, v, t, m.id));
      return json(v, 201);
    }
    const wName = (x: string) => whs.find(w => w.id === x)?.name ?? '';
    const pending = { eventType: 'transfer_pending', title: 'Phiếu xin hàng chờ duyệt', body: `${m.name}: ${transferNo} · ${wName(from)} → ${wName(to)} – ${reason}`,
      url: `/index.html#/transfers/${id}`, actorId: m.id, data: { transferId: id } };
    await background(c.env, loadTransferApprovalDirectory(db).then(directory => notifyMany(c.env,directory({requestedBy:m.id,fromWarehouseId:from,toWarehouseId:to},true).filter(memberId=>memberId!==m.id),pending)));
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
    const t = await c.env.db.transaction(tx => approveIn(tx, m, id, body.revision));
    await transferTasksChanged(c.env, id, m.id);
    const v = await viewOf(c, id);
    await background(c.env, notify(c.env, { eventType: 'transfer_approved', title: 'Điều chuyển kho đã được duyệt', body: `${v.transferNo} · ${v.fromName} → ${v.toName}`, url: `/index.html#/transfers/${id}`, targetMemberId: t.requestedBy, actorId: m.id }));
    await background(c.env, notifyMove(c.env, v, t, m.id));
    return json(v);
  }, 'business');

  router.post('/stock-transfers/:id/reject', async c => {
    const m = me(c), id = c.params.id!, body = await readJson(c.req, 4_000), reason = str(body.reason, 500);
    if (reason.length < 3) fail(400, 'Nhập lý do từ chối.');
    await viewOf(c, id);
    const t = await c.env.db.transaction(async tx => {
      const t = await lock(tx, id, ['pending'], body.revision), now = nowIso();
      if (!await canDecide(tx, m, t)) fail(403, 'Chỉ chức vụ đối ứng được cho hàng hoặc Manager được từ chối phiếu này.', 'APPROVER_ONLY');
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

  /**
   * Kho đi bấm "Đã chuyển": trừ kho đi (một chứng từ, ghi một lần), phiếu sang "Đang chuyển" – hàng đang trên đường, CHƯA cộng kho đến.
   * Kho đi đã chốt đầu kỳ mà không đủ tồn → không cho chuyển.
   */
  router.post('/stock-transfers/:id/ship', async c => {
    const m = me(c), id = c.params.id!, body = await readJson(c.req, 4_000);
    await viewOf(c, id);
    const t = await c.env.db.transaction(tx => shipIn(tx, m, id, body));
    await transferTasksChanged(c.env, id, m.id);
    const v = await viewOf(c, id);
    await background(c.env, notifyShipped(c.env, v, t, m.id));
    return json(v);
  }, 'business');

  /**
   * Kho đến bấm "Nhận hàng" và nhập SỐ LƯỢNG THỰC NHẬN của TỪNG mã (0 ≤ nhận ≤ số chuyển): cộng kho đến đúng số nhận,
   * phần thiếu giữ chênh lệch để đối soát, không tự hoàn tồn kho đi. Nhận thiếu phải ghi lý do và báo Manager.
   */
  router.post('/stock-transfers/:id/receive', async c => {
    const m = me(c), id = c.params.id!, body = await readJson(c.req, 40_000), note = str(body.note, 500);
    await viewOf(c, id);
    const result = await c.env.db.transaction(async tx => {
      const t = await lock(tx, id, ['shipped'], body.revision), now = nowIso();
      if (!await canReceive(tx, m, t)) fail(403, 'Chỉ nhân viên được phân kho đến hoặc Manager được nhận hàng điều chuyển.');
      const lines = await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, id)).orderBy(asc(stockTransferLines.sku));
      const got = new Map<string, number>();
      for (const raw of (Array.isArray(body.lines) ? body.lines as Record<string, unknown>[] : []).slice(0, 500)) {
        const sku = str(raw?.sku, 200), value = raw?.qty;
        if (!lines.some(l => l.sku === sku)) fail(400, `Mã ${sku || '(trống)'} không thuộc phiếu này.`);
        if (got.has(sku)) fail(400, `Mã ${sku} bị nhập hai lần.`);
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          throw new AppError(400, `Nhập số lượng nhận hợp lệ cho ${sku} (nhận 0 nếu chưa tới).`);
        }
        const line = lines.find(l => l.sku === sku)!;
        if (value > (line.shippedQty ?? line.qty)) fail(400, `Số nhận vượt số chuyển của ${sku}.`, 'RECEIVE_OVER');
        if (num(value) !== value) fail(400, `Số lượng nhận của ${sku} chỉ được có tối đa 3 chữ số thập phân.`, 'RECEIVE_PRECISION');
        got.set(sku, value);
      }
      const missing = lines.filter(l => !got.has(l.sku));
      if (missing.length) fail(400, 'Nhập số lượng nhận cho từng mã. Còn thiếu: ' + missing.slice(0, 8).map(l => l.sku).join(', '), 'RECEIVE_LINES_REQUIRED');
      const over = lines.filter(l => got.get(l.sku)! > (l.shippedQty??l.qty));
      if (over.length) fail(400, 'Số nhận vượt số chuyển: ' + over.slice(0, 5).map(l => `${l.sku} (chuyển ${l.qty}, nhận ${got.get(l.sku)})`).join('; ') + '. Hàng thừa lập phiếu điều chuyển / điều chỉnh riêng.', 'RECEIVE_OVER');
      const short = lines.filter(l => got.get(l.sku)! < (l.shippedQty??l.qty));
      if (short.length && note.length < 3) fail(400, 'Nhận thiếu hàng: nhập lý do (VD: hàng chưa tới, giao thiếu, hỏng).', 'RECEIVE_NOTE_REQUIRED');
      await lockLedger(tx);
      await assertWarehousesOpened(tx, [t.fromWarehouseId, t.toWarehouseId]);
      const ledgerNote = `${t.transferNo}: ${t.reason}`.slice(0, 500);
      await postMoves(tx, m.id, lines.map(l => ({ sku:l.sku,warehouseId:t.toWarehouseId,qty:got.get(l.sku)!,kind:'transfer_in' as const,refType:'stock_transfer' as const,refId:id,refNo:t.transferNo,note:ledgerNote })),now);
      for (const l of lines) await tx.update(stockTransferLines).set({ receivedQty: got.get(l.sku)! }).where(eq(stockTransferLines.id, l.id));
      await tx.update(stockTransfers).set({ status: 'done', doneBy: m.id, doneAt: now, doneNote: note, updatedAt: now, ...bump }).where(eq(stockTransfers.id, id));
      await queueTransferReceived(tx,t,lines.map(l=>({...l,receivedQty:got.get(l.sku)!})),m.id,now,note);
      return { t, short: short.map(l => `${l.sku} thiếu ${num((l.shippedQty??l.qty) - got.get(l.sku)!)}`) };
    });
    // Durable event already committed. HTTP/worker failures cannot repeat stock writes or undo receipt.
    if(c.env.transferIntegration)await background(c.env,dispatchTransferJob(c.env,transferCommandKey(id)).catch(()=>undefined));
    await transferTasksChanged(c.env, id, m.id);
    const v = await viewOf(c, id), t = result.t;
    await background(c.env, Promise.all([moveTeam(c.env.db), warehouseStaff(c.env.db, t.fromWarehouseId)]).then(([team, staff]) => notifyMany(c.env, [t.requestedBy, ...team, ...staff],
      { eventType: 'transfer_done', title: result.short.length ? 'Điều chuyển kho: nhận thiếu hàng' : 'Hàng đã chuyển kho', url: `/index.html#/transfers/${id}`, actorId: m.id,
        body: `${v.transferNo} · ${v.fromName} → ${v.toName}` + (result.short.length ? ` · ${result.short.slice(0, 5).join('; ')} (chờ đối soát, chưa hoàn kho)` : '') })));
    if (result.short.length) await background(c.env, notifyMany(c.env, 'managers', { eventType: 'transfer_short', title: 'Điều chuyển kho nhận thiếu hàng', url: `/index.html#/transfers/${id}`, actorId: m.id,
      body: `${v.transferNo} · ${v.fromName} → ${v.toName}: ${result.short.slice(0, 5).join('; ')}. Lý do: ${note}` }));
    return json(v);
  }, 'business');
}

const REMIND_MS = 60 * 60 * 1000;
let lastRemindCheck = 0;
/**
 * NHẮC PHIẾU XIN HÀNG CHỜ DUYỆT QUÁ 1 GIỜ: báo lại chức vụ đối ứng được cho hàng + Manager, sau đó mỗi giờ một lần
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
  const directory=due.length?await loadTransferApprovalDirectory(env.db):null;
  for (const { t, from } of due) {
    const hours = Math.max(1, Math.floor((now.getTime() - Date.parse(t.createdAt)) / REMIND_MS));
    const n = { eventType: 'transfer_pending_reminder', title: `Phiếu xin hàng chờ duyệt ${hours} giờ`, body: `${t.transferNo} · kho ${from}: ${t.reason}. Bấm Cho hoặc Từ chối.`,
      url: `/index.html#/transfers/${t.id}`, data: { transferId: t.id } };
    await notifyMany(env,directory!(t,true).filter(id=>id!==t.requestedBy),n).catch(()=>0);
  }
  return due.length;
}

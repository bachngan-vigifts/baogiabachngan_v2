import { and,eq,ne,or,sql,type SQL } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { RouteContext } from '../../../core/http/router.ts';
import { readJson } from '../../../core/http/router.ts';
import { fold,foldSql } from '../../../core/text/fold.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { positions } from '../../staff/schema.ts';
import { warehouses } from '../../catalog/schema.ts';
import { posRegisters, posShifts, posPaymentRequests, webStoreOrders } from '../pos-schema.ts';
import { cashEntries, cashReconciliations } from '../cash-schema.ts';
import { salesOrders, deliveries } from '../schema.ts';
type Ctx = RouteContext<StaffEnv>;
type Scope = { registers: string[]; drawers: string[] };
export const posScope = (c: Ctx) => c.state.posScope as Scope | undefined;
export const allowedRegister = (c: Ctx, id: string) => !posScope(c) || posScope(c)!.registers.includes(id);
export const allowedDrawer = (c: Ctx, id: string) => !posScope(c) || posScope(c)!.drawers.includes(id);
/** A business permission or delegated approval never widens a store employee's counter scope. */
export async function authorizePosStore(c: Ctx) {
  const path = c.url.pathname.replace(/^\/api\/staff/, '');
  if (!/^\/(pos|cash)(\/|$)/.test(path)) return;
  const m = (c.state.session as SessionState).member;
  const access = await posStoreScopeFor(c.env.db, m);
  if (!access) return;
  const { rows, scope } = access;
  c.state.posScope = scope;
  const denied = () => { throw new AppError(403, 'Bạn chỉ được truy cập quầy và két thuộc cửa hàng của mình.'); };
  const register = (id: unknown) => { if (typeof id === 'string' && id && !allowedRegister(c, id)) denied(); };
  const drawer = (id: unknown) => { if (typeof id === 'string' && id && !allowedDrawer(c, id)) denied(); };
  const shift = async (id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    const [s] = await c.env.db.select().from(posShifts).where(eq(posShifts.id, id));
    if (s) { register(s.registerId); drawer(s.cashDrawerId); }
  };
  register(c.url.searchParams.get('registerId')); drawer(c.url.searchParams.get('drawerId'));
  await shift(c.url.searchParams.get('shiftId'));
  if (c.req.method !== 'GET') {
    const b = await readJson(c.req.clone());
    register(b.registerId); drawer(b.drawerId); await shift(b.shiftId);
    if (path === '/pos/shifts/open' && typeof b.registerId === 'string') {
      const r = rows.find(x => x.r.id === b.registerId)?.r;
      if (r) drawer(r.cashDrawerId);
    }
    // Store staff cannot rename/reassign counters or drawers, even with an accidental config grant.
    if (['/pos/registers', '/cash/drawers'].includes(path)) denied();
  }
  const id = c.params.id;
  if (!id) return;
  if (/^\/(pos|cash)\/shifts\//.test(path)) await shift(id);
  if (path.startsWith('/cash/entries/')) {
    const [e] = await c.env.db.select().from(cashEntries).where(eq(cashEntries.id, id));
    if (e) { drawer(e.drawerId); await shift(e.shiftId); }
  }
  if (path.startsWith('/cash/reconciliations/')) {
    const [r] = await c.env.db.select().from(cashReconciliations).where(eq(cashReconciliations.id, id));
    if (r) { drawer(r.drawerId); await shift(r.shiftId); }
  }
  if (path.startsWith('/pos/qr/')) {
    const [r] = await c.env.db.select().from(posPaymentRequests).where(eq(posPaymentRequests.id, id));
    if (r) await shift(r.shiftId);
  }
  if (path.startsWith('/pos/bills/')) {
    const [r] = await c.env.db.select().from(salesOrders).where(eq(salesOrders.id, id));
    if (r) await shift(r.shiftId);
  }
  if (path.startsWith('/pos/cod/')) {
    const [r] = await c.env.db.select({ shiftId: salesOrders.shiftId }).from(deliveries)
      .innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId)).where(eq(deliveries.id, id));
    if (r) await shift(r.shiftId);
  }
}

export async function posStoreScopeFor(db: StaffEnv['db'] | Parameters<Parameters<StaffEnv['db']['transaction']>[0]>[0], m: { role: string; positionId?: string | null }) {
  if (m.role === 'manager') return;
  const [position] = await db.select().from(positions).where(eq(positions.id, m.positionId ?? '')).limit(1);
  const name = fold(position?.name);
  const lock = m.positionId === 'sales-lock' || /^(nvbh|cht|cua hang truong) lock$/.test(name);
  const ml = m.positionId === 'sales-ml' || /^(nvbh|cht|cua hang truong) (ml|minh long)$/.test(name);
  if (!lock && !ml) return;
  const rows = await db.select({ r: posRegisters, warehouse: warehouses.name }).from(posRegisters)
    .innerJoin(warehouses, eq(warehouses.id, posRegisters.warehouseId));
  // Warehouse identifies the store even when the display name of its counter changes.
  const belongs = (value: string) => {
    const s = fold(value);
    return lock ? /lock/.test(s) : /minh long/.test(s) && !/lock/.test(s);
  };
  const visible = rows.filter(x => {
    const warehouse = fold(x.warehouse), register = fold(x.r.name);
    const ambiguousWarehouse = /lock/.test(warehouse) && /minh long/.test(warehouse);
    return ambiguousWarehouse
      ? belongs(register)
      : belongs(warehouse) || (!/lock|minh long/.test(warehouse) && belongs(register));
  });
  const foreignDrawers = new Set(rows.filter(x => !visible.includes(x)).map(x => x.r.cashDrawerId));
  const scope = {
    registers: visible.map(x => x.r.id),
    // A mistakenly shared drawer must not expose the other store's balances. Manager must split it first.
    drawers: visible.map(x => x.r.cashDrawerId).filter(id => !foreignDrawers.has(id)),
  } satisfies Scope;
  return { rows, scope };
}

/** Store assignment is a hard boundary even if customer sharing/department ownership grants document access. */
function registerStoreMatch(m: {
  role: string;
  positionId?: string | null;
  positionName?: string | null;
}): SQL | undefined {
  if (m.role === 'manager') return;
  const name = fold(m.positionName);
  const lock =
    m.positionId === 'sales-lock' ||
    /^(nvbh|cht|cua hang truong) lock$/.test(name);
  const ml =
    m.positionId === 'sales-ml' ||
    /^(nvbh|cht|cua hang truong) (ml|minh long)$/.test(name);
  if (!lock && !ml) return;
  const w = sql`regexp_replace(${foldSql(warehouses.name)},'[[:space:]]+',' ','g')`,
    r = sql`regexp_replace(${foldSql(posRegisters.name)},'[[:space:]]+',' ','g')`;
  const belongs = (v: SQL) =>
    lock
      ? sql`${v} like '%lock%'`
      : sql`${v} like '%minh long%' and ${v} not like '%lock%'`;
  const ambiguous = sql`${w} like '%lock%' and ${w} like '%minh long%'`;
  return or(
    and(ambiguous, belongs(r)),
    and(
      sql`not (${ambiguous})`,
      or(
        belongs(w),
        and(
          sql`${w} not like '%lock%' and ${w} not like '%minh long%'`,
          belongs(r),
        ),
      ),
    ),
  );
}
/** Same store boundary for order documents and accounting web-data diagnostics. */
export function posOrderStoreScope(m: Parameters<typeof registerStoreMatch>[0]): SQL | undefined {
  const matching = registerStoreMatch(m); if (!matching) return;
  return or(
    ne(salesOrders.channel, 'pos'),
    sql`exists(select 1 from ${posShifts} inner join ${posRegisters} on ${posRegisters.id}=${posShifts.registerId} inner join ${warehouses} on ${warehouses.id}=${posRegisters.warehouseId} where ${posShifts.id}=${salesOrders.shiftId} and ${matching})`,
  );
}

export function posWebOrderStoreScope(m: Parameters<typeof registerStoreMatch>[0]): SQL | undefined {
  const matching = registerStoreMatch(m); if (!matching) return;
  return sql`exists(select 1 from ${posRegisters} inner join ${warehouses} on ${warehouses.id}=${posRegisters.warehouseId} where ${posRegisters.id}=${webStoreOrders.registerId} and ${matching})`;
}

/** Only store-assigned employees share sales shifts; an unscoped role must not mean every store. */
export function posSharedShiftStoreScope(m: Parameters<typeof registerStoreMatch>[0]): SQL | undefined {
  if (m.role !== 'employee') return;
  const matching = registerStoreMatch(m); if (!matching) return;
  return sql`exists(select 1 from ${posRegisters} inner join ${warehouses} on ${warehouses.id}=${posRegisters.warehouseId} where ${posRegisters.id}=${posShifts.registerId} and ${matching})`;
}

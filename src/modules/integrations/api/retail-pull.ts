import { rollbackImportedRetail } from './retail-correction.ts';
import { and, eq, lt, inArray } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { AnyDb } from '../../../core/db/client.ts';
import type { SapoApi } from './sapo-pull.ts';
import { sapoHealthMonitorState } from '../schema.ts';
import { customers } from '../../customers/schema.ts';
import { retailCandidate } from '../domain/retail-customer.ts';
import { addRetailCustomers } from './retail-customers.ts';
const STATE = 'retail-customer-import', LOCK = STATE + '-lock';
export async function pullRetailCustomers(db: AnyDb, api: SapoApi) {
  const token = crypto.randomUUID(), now = new Date().toISOString();
  const acquired = await db.insert(sapoHealthMonitorState).values({ id: LOCK, data: token, updatedAt: now }).onConflictDoUpdate({
    target: sapoHealthMonitorState.id, set: { data: token, updatedAt: now }, setWhere: lt(sapoHealthMonitorState.updatedAt, new Date(Date.now() - 300000).toISOString()),
  }).returning({ id: sapoHealthMonitorState.id });
  if (!acquired.length) throw new AppError(409, 'Đợt nhập khách lẻ đang chạy, thử lại sau.');
  try {
    const [old] = await db.select().from(sapoHealthMonitorState).where(eq(sapoHealthMonitorState.id, STATE));
    const state = old ? JSON.parse(old.data) : { page: 1, completed: false, totals: { received: 0, eligible: 0, added: 0, existing: 0, duplicate: 0, excluded: 0 } };
    if (state.completed) return state;
    const groups = new Map<string, string>();
    let groupWarning = '';
    try {
      const response = await api.list('/customer_groups.json', 'customer_groups', 1, 4);
      for (const raw of response.items as any[]) if (raw?.id != null && raw?.name) groups.set(String(raw.id), String(raw.name));
      if (response.nextPage) groupWarning = 'Danh sách nhóm vượt giới hạn đọc; cần đối chiếu trước khi chốt.';
    } catch (e) {
      if (e instanceof AppError && /^SAPO_HTTP_4/.test(e.code ?? '')) groupWarning = 'Sapo chưa trả danh mục nhóm; đã nhận nhóm nhúng trong khách và khách cá nhân không MST. Cần đối chiếu nhóm.';
      else throw e;
    }
    if (state.totals.added > 0 && !state.initialBatchChecked) {
      const initial = await api.list('/customers.json', 'customers', 1, 2);
      const imported = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.isRetail, true), inArray(customers.id, initial.items.map((x: any) => String(x.id)))));
      const ids = new Set(imported.map(x => x.id));
      const outside = initial.items.filter((x: any) => ids.has(String(x.id)) && !retailCandidate(x, groups));
      if (outside.length) {
        await rollbackImportedRetail(db, outside.map((x: any) => String(x.id)), state);
      }
      state.initialBatchChecked = true;
    }
    const page = await api.list('/customers.json', 'customers', state.page, 2);
    state.sourceFields = page.items[0] ? Object.keys(page.items[0]).sort() : [];
    const result = await addRetailCustomers(db, page.items, groups);
    for (const [key, n] of Object.entries(result)) state.totals[key] = (state.totals[key] ?? 0) + n;
    state.page = page.nextPage ?? state.page;
    state.completed = page.nextPage === null;
    state.warning = groupWarning;
    state.updatedAt = new Date().toISOString();
    await db.insert(sapoHealthMonitorState).values({ id: STATE, data: JSON.stringify(state), updatedAt: state.updatedAt }).onConflictDoUpdate({ target: sapoHealthMonitorState.id, set: { data: JSON.stringify(state), updatedAt: state.updatedAt } });
    return state;
  } finally { await db.delete(sapoHealthMonitorState).where(and(eq(sapoHealthMonitorState.id, LOCK), eq(sapoHealthMonitorState.data, token))); }
}

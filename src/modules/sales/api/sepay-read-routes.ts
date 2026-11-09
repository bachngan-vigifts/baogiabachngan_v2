import { inArray, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import type { StaffEnv, SessionState } from '../../staff/api/auth-routes.ts';
import { sepayTransactions as bank } from '../../integrations/schema.ts';
import { readSepayDay } from '../../integrations/api/sepay-read.ts';
import { canViewSepay } from '../domain/sepay-page.ts';
import { vietnamDate } from '../domain/sales.ts';
import { cashAudit } from './cash-store.ts';

export async function pullSepayToday(env: StaffEnv, actorId: string) {
  const day = vietnamDate(new Date((env.nowSec?.() ?? Date.now()/1000)*1000)).iso;
  const result = await readSepayDay(env.sepayApiToken || '', day, env.sepayApiFetch);
  const totals = await env.db.transaction(async tx => {
    // All writers use the same provider-ID locks. Sort batch locks before any row read.
    const ids = [...new Set(result.payments.map(p => p.providerId))].sort();
    if (ids.length) await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sepay:' || id)) from (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) as id order by id) keys`);
    const existing = ids.length ? await tx.select().from(bank).where(inArray(bank.providerId, ids)) : [];
    const known = new Map(existing.map(p => [p.providerId, p]));
    const at = new Date().toISOString(), additions: (typeof bank.$inferInsert)[] = [];
    let duplicate = 0;
    for (const p of result.payments) {
      const old = known.get(p.providerId);
      if (old) {
        if (old.amount !== p.amount || old.accountNumber !== p.accountNumber || old.content !== p.content || old.transactionAt !== p.transactionAt)
          throw new AppError(409, 'ID SePay đã có nhưng số tiền, tài khoản, nội dung hoặc thời điểm khác. Chưa nhập đợt này; cần đối soát.');
        duplicate++; continue;
      }
      const row = { id: crypto.randomUUID(), providerId: p.providerId, transferType: p.transferType,
        amount: p.amount, accountNumber: p.accountNumber, transactionAt: p.transactionAt, content: p.content,
        payload: p.payload, status: 'review' as const, reason: 'Đã tải từ API SePay; chờ đối soát, chưa ghi thu.',
        orderId: null, paymentId: null, receivedAt: at };
      additions.push(row); known.set(p.providerId, row);
    }
    if (additions.length) await tx.insert(bank).values(additions);
    await cashAudit(tx, actorId, 'sepay.pull-today', 'sepay_import', day,
      { day, read: result.read, imported: additions.length, duplicate, outgoing: result.outgoing });
    return { imported: additions.length, duplicate };
  });
  return { day, read: result.read, outgoing: result.outgoing, ...totals, receiptsCreated: 0 };
}

export function registerSepayReadRoutes(router: Router<StaffEnv>) {
  router.post('/sepay/pull-today', async c => {
    const actor = (c.state.session as SessionState).member;
    if (!canViewSepay(actor)) throw new AppError(403, 'Chỉ Manager và Kế toán được lấy giao dịch SePay.');
    const body = await readJson(c.req, 1000);
    if (Object.keys(body).length) throw new AppError(400, 'Thao tác chỉ lấy giao dịch hôm nay; không nhận token hoặc ngày từ trình duyệt.');
    return json(await pullSepayToday(c.env, actor.id));
  }, 'business');
  // Same server-only scheduler token used by the existing scheduled integrations.
  router.post('/integrations/sepay/pull', async c => {
    const body = await readJson(c.req, 1000);
    if (Object.keys(body).length) throw new AppError(400, 'Đồng bộ tự động không nhận ngày hoặc token trong nội dung.');
    return json(await pullSepayToday(c.env, 'integration:sepay'));
  }, 'sapo-sync');
}

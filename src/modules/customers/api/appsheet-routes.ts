import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { json, readJson, type Router } from '../../../core/http/router.ts';
import type { SessionState, StaffEnv } from '../../staff/api/auth-routes.ts';
import { customers, customerContacts } from '../schema.ts';
import { appsheetCustomerLinks, appsheetContactLinks, appsheetSyncRuns } from '../appsheet-schema.ts';
import { parseAppsheetInput } from '../domain/appsheet-input.ts';
import { customerIdentityLock } from './identity.ts';
import { planAppsheet } from './appsheet-plan.ts';

export function registerAppsheetCustomerRoutes(router: Router<StaffEnv>) {
  const manager = (session: unknown) => {
    const member = (session as SessionState).member;
    if (member.role !== 'manager') throw new AppError(403, 'Chỉ Manager được đối soát và nhập dữ liệu AppSheet.');
    return member;
  };
  router.get('/appsheet-customers/runs', async c => {
    manager(c.state.session);
    const runs = await c.env.db.select().from(appsheetSyncRuns).orderBy(desc(appsheetSyncRuns.createdAt), desc(appsheetSyncRuns.id)).limit(20);
    return json({ runs: runs.map(({ summaryJson, ...r }) => ({ ...r, summary: JSON.parse(summaryJson) })) });
  }, 'business');
  for (const mode of ['preview', 'apply'] as const) router.post('/appsheet-customers/' + mode, async c => {
    const member = manager(c.state.session), body = await readJson(c.req, 2_000_000);
    if (Object.keys(body).some(k => !['input', 'planHash'].includes(k))) throw new AppError(400, 'Tham số nhập AppSheet không hợp lệ.');
    const input = parseAppsheetInput(body.input);
    if (mode === 'apply' && (typeof body.planHash !== 'string' || !/^[0-9a-f]{64}$/.test(body.planHash)))
      throw new AppError(400, 'Cần xem trước và xác nhận kế hoạch nhập.');
    const result = await c.env.db.transaction(async tx => {
      // Same identity lock as CRM/POS/Sapo. Table locks also protect against contact edits,
      // primary-contact races and merge/delete operations that do not use that advisory lock.
      if (mode === 'apply') {
        await customerIdentityLock(tx);
        await tx.execute(sql`lock table sapo_customers, customer_contacts, appsheet_customer_links, appsheet_contact_links in share row exclusive mode`);
      } else await tx.execute(sql`set transaction isolation level repeatable read`);
      const customerRows = await tx.select().from(customers).orderBy(asc(customers.id));
      const contacts = await tx.select().from(customerContacts).orderBy(asc(customerContacts.id));
      const customerLinks = await tx.select().from(appsheetCustomerLinks).where(and(eq(appsheetCustomerLinks.appId, input.appId), eq(appsheetCustomerLinks.tableName, input.customersTable))).orderBy(asc(appsheetCustomerLinks.rowId));
      const contactLinks = await tx.select().from(appsheetContactLinks).where(and(eq(appsheetContactLinks.appId, input.appId), eq(appsheetContactLinks.tableName, input.contactsTable))).orderBy(asc(appsheetContactLinks.rowId));
      const now = new Date().toISOString();
      const plan = planAppsheet(input, { customers: customerRows, contacts, customerLinks, contactLinks }, now, member.id);
      if (mode === 'preview') return { mode, planHash: plan.planHash, summary: plan.summary, reports: plan.reports };
      if (body.planHash !== plan.planHash) throw new AppError(409, 'Dữ liệu hoặc lựa chọn đã thay đổi. Xem trước lại trước khi nhập.', 'APPSHEET_PREVIEW_STALE');
      // The approved batch is atomic, including its log. Problem rows are explicitly reported,
      // not silently merged; successful rows commit together and failed imports roll back fully.
      for (const row of plan.customerWrites) await tx.insert(customers).values(row).onConflictDoUpdate({ target: customers.id, set: row });
      for (const row of plan.contactWrites) await tx.insert(customerContacts).values(row).onConflictDoUpdate({ target: customerContacts.id, set: row });
      for (const row of plan.customerLinkWrites) await tx.insert(appsheetCustomerLinks).values(row)
        .onConflictDoUpdate({ target: [appsheetCustomerLinks.appId, appsheetCustomerLinks.tableName, appsheetCustomerLinks.rowId], set: row });
      for (const row of plan.contactLinkWrites) await tx.insert(appsheetContactLinks).values(row)
        .onConflictDoUpdate({ target: [appsheetContactLinks.appId, appsheetContactLinks.tableName, appsheetContactLinks.rowId], set: row });
      const runId = crypto.randomUUID();
      await tx.insert(appsheetSyncRuns).values({ id: runId, actorId: member.id, appId: input.appId, planHash: plan.planHash, summaryJson: JSON.stringify(plan.summary), createdAt: now });
      return { mode, runId, planHash: plan.planHash, summary: plan.summary, reports: plan.reports };
    }).catch((error: unknown) => {
      if (error instanceof AppError) throw error;
      // Drizzle errors include SQL parameters. Do not let the generic router log customer PII.
      console.error('appsheet_customer_sync_failed', mode);
      throw new AppError(500, 'Không hoàn tất nhập AppSheet. Lô đã được hủy; xem trước lại trước khi thử tiếp.', 'APPSHEET_TRANSACTION_FAILED');
    });
    return json(result);
  }, 'business');
}

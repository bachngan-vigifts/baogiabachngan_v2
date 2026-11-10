import {defaultSepayCrmAccount} from '../domain/sepay-crm-account.ts';
import {and,eq,sql} from 'drizzle-orm';
import type {StaffEnv} from '../../staff/api/auth-routes.ts';
import {posRegisters} from '../pos-schema.ts';
import type {CashDb} from './cash-store.ts';

/** Explicit Manager reconciliation uses the company accounts already configured in CRM.
 * Automatic CRM receipts still require SEPAY_RECEIPT_ACCOUNTS; never use this fallback there.
 */
export async function sepayManualAccountApproved(db: CashDb, env: Pick<StaffEnv,'sepayReceiptAccounts'>, account: string, contractNo?: string | null): Promise<boolean> {
  if (!account.trim()) return false;
  const expected = defaultSepayCrmAccount(contractNo);
  if (expected && account === expected) return true;
  if ((env.sepayReceiptAccounts || []).includes(account)) return true;
  const [register] = await db.select({id:posRegisters.id}).from(posRegisters).where(and(
    eq(posRegisters.active,true),
    eq(sql`regexp_replace(${posRegisters.bankAccount},'[[:space:]]','','g')`,account),
  )).limit(1);
  return !!register;
}

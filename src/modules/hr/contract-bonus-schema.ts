import {sql} from 'drizzle-orm';
import {pgTable,text,bigint,index,uniqueIndex,check} from 'drizzle-orm/pg-core';
import {employees} from '../staff/schema.ts';
export const hrContractBonusAccounts=pgTable('hr_contract_bonus_accounts',{
 id:text('id').primaryKey(),contractId:text('contract_id').notNull(),kind:text('kind',{enum:['star','liquidation']}).notNull(),memberId:text('member_id').notNull().references(()=>employees.id),originMonth:text('origin_month').notNull(),policy:text('policy').notNull(),source:text('source').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('uq_hr_contract_award').on(t.contractId,t.kind),index('idx_hr_contract_award_member').on(t.memberId),check('chk_hr_contract_award_kind',sql`${t.kind} in ('star','liquidation')`)]).enableRLS();
export const hrContractBonusEntries=pgTable('hr_contract_bonus_entries',{
 id:text('id').primaryKey(),accountId:text('account_id').notNull().references(()=>hrContractBonusAccounts.id),memberId:text('member_id').notNull().references(()=>employees.id),month:text('month').notNull(),runId:text('run_id').notNull(),amount:bigint('amount',{mode:'number'}).notNull(),status:text('status',{enum:['reserved','paid','released']}).notNull().default('reserved'),reason:text('reason').notNull(),detail:text('detail').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('uq_hr_award_run').on(t.accountId,t.runId),index('idx_hr_award_entry_month').on(t.memberId,t.month),index('idx_hr_award_entry_account').on(t.accountId,t.status),check('chk_hr_award_entry_status',sql`${t.status} in ('reserved','paid','released')`)]).enableRLS();

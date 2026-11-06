import {sql} from 'drizzle-orm';
import {pgTable,text,check,index} from 'drizzle-orm/pg-core';
import {posRegisters} from './pos-schema.ts';
import {employees} from '../staff/schema.ts';
/** Versioned store routing and monthly target policy. Revenue itself is always computed. */
export const salesPayrollTeamSources=pgTable('sales_payroll_team_sources',{
 effectiveMonth:text('effective_month').primaryKey(),
 bnRegisterId:text('bn_register_id').notNull().references(()=>posRegisters.id),
 lockRegisterId:text('lock_register_id').notNull().references(()=>posRegisters.id),
 bonusMode:text('bonus_mode',{enum:['threshold','tiers']}).notNull(),
 updatedBy:text('updated_by').notNull().references(()=>employees.id),
 updatedAt:text('updated_at').notNull(),
},t=>[
 check('chk_sales_payroll_sources_month',sql`${t.effectiveMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
 check('chk_sales_payroll_sources_distinct',sql`${t.bnRegisterId}<>${t.lockRegisterId}`),
 check('chk_sales_payroll_sources_mode',sql`${t.bonusMode} in ('threshold','tiers')`),
 index('idx_sales_payroll_sources_bn').on(t.bnRegisterId),
 index('idx_sales_payroll_sources_lock').on(t.lockRegisterId),
 index('idx_sales_payroll_sources_editor').on(t.updatedBy),
]).enableRLS();

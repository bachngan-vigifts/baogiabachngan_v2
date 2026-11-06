import {sql} from 'drizzle-orm';
import {pgTable,text,integer,jsonb,index,uniqueIndex,check} from 'drizzle-orm/pg-core';
import {employees} from '../staff/schema.ts';

export interface RevenueTargetChange {month:string;from:number|null;to:number|null}
export const hrRevenueTargetRequests=pgTable('hr_revenue_target_requests',{
 id:text('id').primaryKey(),
 memberId:text('member_id').notNull().references(()=>employees.id),
 year:text('year').notNull(),
 changes:jsonb('changes').$type<RevenueTargetChange[]>().notNull(),
 reason:text('reason').notNull(),
 status:text('status',{enum:['pending','approved','rejected','withdrawn']}).notNull().default('pending'),
 revision:integer('revision').notNull().default(1),
 submittedAt:text('submitted_at').notNull(),
 resolvedBy:text('resolved_by').references(()=>employees.id),
 resolvedAt:text('resolved_at'),
 resolutionNote:text('resolution_note').notNull().default(''),
},t=>[
 uniqueIndex('uq_hr_revenue_request_pending').on(t.memberId,t.year).where(sql`${t.status}='pending'`),
 index('idx_hr_revenue_requests_member_year').on(t.memberId,t.year,t.submittedAt),
 index('idx_hr_revenue_requests_queue').on(t.year,t.status,t.submittedAt),
 index('idx_hr_revenue_requests_resolver').on(t.resolvedBy),
 check('chk_hr_revenue_request_year',sql`${t.year} ~ '^[0-9]{4}$' and ${t.year}>='2000' and ${t.year}<='2100'`),
 check('chk_hr_revenue_request_changes',sql`jsonb_typeof(${t.changes})='array' and jsonb_array_length(${t.changes}) between 1 and 12`),
 check('chk_hr_revenue_request_reason',sql`length(btrim(${t.reason})) between 3 and 500`),
 check('chk_hr_revenue_request_revision',sql`${t.revision}>0`),
 check('chk_hr_revenue_request_status',sql`${t.status} in ('pending','approved','rejected','withdrawn')`),
 check('chk_hr_revenue_request_resolution',sql`(${t.status}='pending' and ${t.resolvedBy} is null and ${t.resolvedAt} is null) or (${t.status}<>'pending' and ${t.resolvedBy} is not null and ${t.resolvedAt} is not null)`),
 check('chk_hr_revenue_request_note',sql`length(${t.resolutionNote})<=500 and (${t.status}<>'rejected' or length(btrim(${t.resolutionNote}))>=3)`),
]).enableRLS();

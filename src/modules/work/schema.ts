import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { employees } from '../staff/schema.ts';

export const workBranches = sqliteTable('work_branches', {
 id: text('id').primaryKey(), name: text('name').notNull(), keeperId: text('keeper_id'), updatedAt:text('updated_at').notNull(),
});
export const workAssignments = sqliteTable('work_assignments', {
 memberId:text('member_id').notNull().references(()=>employees.id), branchId:text('branch_id').notNull().references(()=>workBranches.id),
 sapoAccountId:text('sapo_account_id').notNull(), updatedAt:text('updated_at').notNull(),
},t=>[primaryKey({columns:[t.memberId,t.branchId]}),uniqueIndex('idx_work_branch_account').on(t.branchId,t.sapoAccountId)]);
export const workShifts = sqliteTable('work_shifts', {
 id:text('id').primaryKey(), branchId:text('branch_id').notNull().references(()=>workBranches.id), workDate:text('work_date').notNull(),
 startsAt:text('starts_at').notNull(),endsAt:text('ends_at').notNull(),label:text('label').notNull(),keeperId:text('keeper_id'),
 opening:integer('opening'),actual:integer('actual'),expected:integer('expected'),difference:integer('difference'),
 cashStatus:text('cash_status').notNull().default('not_opened'),data:text('data').notNull().default('{}'),
 revision:integer('revision').notNull().default(1),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('idx_work_shift_period').on(t.branchId,t.startsAt,t.endsAt),index('idx_work_branch_time').on(t.branchId,t.endsAt)]);
export const workReports = sqliteTable('work_reports', {
 id:text('id').primaryKey(),shiftId:text('shift_id').notNull().references(()=>workShifts.id),memberId:text('member_id').notNull().references(()=>employees.id),
 positionId:text('position_id').notNull(),phase:text('phase').notNull(),status:text('status').notNull().default('draft'),
 data:text('data').notNull(),snapshot:text('snapshot').notNull().default('{}'),revision:integer('revision').notNull().default(1),
 updatedAt:text('updated_at').notNull(),submittedAt:text('submitted_at'),reviewedBy:text('reviewed_by'),reviewNote:text('review_note').notNull().default(''),
},t=>[uniqueIndex('idx_work_report_once').on(t.shiftId,t.memberId,t.phase),index('idx_work_reports_member').on(t.memberId,t.updatedAt),index('idx_work_reports_status').on(t.status,t.updatedAt)]);
export const workAudit = sqliteTable('work_audit', {
 id:text('id').primaryKey(),entityId:text('entity_id').notNull(),actorId:text('actor_id').notNull(),action:text('action').notNull(),
 data:text('data').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_work_audit_entity').on(t.entityId,t.createdAt)]);
export const workSnapshots = sqliteTable('work_snapshots', {
 id:text('id').primaryKey(),shiftId:text('shift_id').notNull(),memberId:text('member_id').notNull(),data:text('data').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_work_snapshot_owner').on(t.memberId,t.shiftId,t.createdAt)]);
export const workCashRequests = sqliteTable('work_cash_requests', {
 id:text('id').primaryKey(),shiftId:text('shift_id').notNull().references(()=>workShifts.id),memberId:text('member_id').notNull().references(()=>employees.id),
 kind:text('kind').notNull(),amount:integer('amount').notNull(),note:text('note').notNull(),status:text('status').notNull().default('pending'),
 reviewedBy:text('reviewed_by'),reviewNote:text('review_note').notNull().default(''),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[index('idx_work_cash_requests_shift').on(t.shiftId,t.status)]);

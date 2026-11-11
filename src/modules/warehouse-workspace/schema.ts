import {pgTable,text,integer,doublePrecision,index,primaryKey,boolean,uniqueIndex} from 'drizzle-orm/pg-core';
import {tasks} from '../tasks/schema.ts';
import {employees} from '../staff/schema.ts';
import {enumCheck} from '../../core/db/enum-check.ts';
import {KINDS,STAGES} from './domain.ts';
export const warehouseWorkSettings=pgTable('warehouse_work_settings',{
 id:text('id').primaryKey(),createdAt:text('created_at').notNull(),calendar:text('calendar').notNull(),bonusBudget:doublePrecision('bonus_budget'),autoDispatch:boolean('auto_dispatch').notNull().default(true),revision:integer('revision').notNull().default(1),updatedBy:text('updated_by').references(()=>employees.id),updatedAt:text('updated_at').notNull(),
}).enableRLS();
export const warehouseWorkRuns=pgTable('warehouse_work_runs',{
 taskId:text('task_id').primaryKey().references(()=>tasks.id),memberId:text('member_id').references(()=>employees.id),
 kind:text('kind',{enum:KINDS}).notNull(),stage:text('stage',{enum:STAGES}).notNull().default('todo'),weight:doublePrecision('weight').notNull(),standardMinutes:doublePrecision('standard_minutes').notNull(),calendar:text('calendar').notNull(),dueAt:text('due_at').notNull(),
 creationHash:text('creation_hash'),queuedAt:text('queued_at'),offeredAt:text('offered_at'),startedAt:text('started_at'),submittedAt:text('submitted_at'),confirmedAt:text('confirmed_at'),confirmedBy:text('confirmed_by').references(()=>employees.id),quality:text('quality'),waits:text('waits').notNull().default('[]'),evidence:text('evidence').notNull().default(''),reviewNote:text('review_note').notNull().default(''),revision:integer('revision').notNull().default(1),updatedAt:text('updated_at').notNull(),
},t=>[index('idx_warehouse_work_member_due').on(t.memberId,t.dueAt),enumCheck('chk_warehouse_work_kind',t.kind,KINDS),enumCheck('chk_warehouse_work_stage',t.stage,STAGES)]).enableRLS();
export const warehouseWorkMonths=pgTable('warehouse_work_months',{
 memberId:text('member_id').notNull().references(()=>employees.id),month:text('month').notNull(),snapshot:text('snapshot').notNull(),approvedBy:text('approved_by').notNull().references(()=>employees.id),approvedAt:text('approved_at').notNull(),
},t=>[primaryKey({columns:[t.memberId,t.month]})]).enableRLS();

/** One assignment per source operation; per-recipient reminder tasks link to the same assignment. */
export const warehouseWorkAssignments=pgTable('warehouse_work_assignments',{
 taskId:text('task_id').primaryKey().references(()=>tasks.id),operationKey:text('operation_key').notNull().unique(),
 mode:text('mode',{enum:['single','team']}).notNull(),leadId:text('lead_id').notNull().references(()=>employees.id),warehouseId:text('warehouse_id').notNull(),
 prepared:boolean('prepared').notNull().default(false),requestHash:text('request_hash').notNull().default(''),reason:text('reason').notNull().default(''),revision:integer('revision').notNull().default(1),createdBy:text('created_by').references(()=>employees.id),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
}).enableRLS();
export const warehouseWorkSourceLinks=pgTable('warehouse_work_source_links',{
 taskId:text('task_id').primaryKey().references(()=>tasks.id),assignmentId:text('assignment_id').notNull().references(()=>warehouseWorkAssignments.taskId),
},t=>[index('idx_warehouse_source_assignment').on(t.assignmentId)]).enableRLS();
export const warehouseWorkParts=pgTable('warehouse_work_parts',{
 taskId:text('task_id').primaryKey().references(()=>tasks.id),assignmentId:text('assignment_id').notNull().references(()=>warehouseWorkAssignments.taskId),memberId:text('member_id').notNull().references(()=>employees.id),part:text('part').notNull(),share:doublePrecision('share').notNull(),
},t=>[index('idx_warehouse_parts_assignment').on(t.assignmentId),index('idx_warehouse_parts_member').on(t.memberId),uniqueIndex('warehouse_work_parts_assignment_id_member_id_key').on(t.assignmentId,t.memberId)]).enableRLS();

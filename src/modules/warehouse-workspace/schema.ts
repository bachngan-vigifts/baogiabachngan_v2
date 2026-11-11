import {pgTable,text,integer,doublePrecision,index,primaryKey,boolean} from 'drizzle-orm/pg-core';
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

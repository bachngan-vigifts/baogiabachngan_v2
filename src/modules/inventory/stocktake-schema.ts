import {sql} from 'drizzle-orm';
import {pgTable,text,bigint,index,uniqueIndex,check} from 'drizzle-orm/pg-core';
import {employees} from '../staff/schema.ts';
import {inventoryAdjustments} from './schema.ts';
export const stocktakeStates=pgTable('inventory_stocktake_states',{
 adjustmentId:text('adjustment_id').primaryKey().references(()=>inventoryAdjustments.id),
 revision:bigint('revision',{mode:'number'}).notNull().default(0),
 balancedAt:text('balanced_at'),balancedBy:text('balanced_by').references(()=>employees.id),
 cancelledAt:text('cancelled_at'),cancelledBy:text('cancelled_by').references(()=>employees.id),
 mergedInto:text('merged_into').references(()=>inventoryAdjustments.id),costs:text('costs').notNull().default('{}'),
},t=>[index('idx_stocktake_states_balanced_by').on(t.balancedBy),index('idx_stocktake_states_cancelled_by').on(t.cancelledBy),index('idx_stocktake_states_merged_into').on(t.mergedInto),check('stocktake_revision_nonnegative',sql`${t.revision}>=0`),check('stocktake_cancelled_actor_pair',sql`(${t.cancelledAt} is null)=(${t.cancelledBy} is null)`),check('stocktake_balanced_actor_pair',sql`(${t.balancedAt} is null)=(${t.balancedBy} is null)`)]).enableRLS();
export const stocktakeCommands=pgTable('inventory_stocktake_commands',{
 id:text('id').primaryKey(),actorId:text('actor_id').notNull().references(()=>employees.id),clientKey:text('client_key').notNull(),requestHash:text('request_hash').notNull(),
 adjustmentId:text('adjustment_id').notNull().references(()=>inventoryAdjustments.id),result:text('result').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('uq_stocktake_command_actor_key').on(t.actorId,t.clientKey),index('idx_stocktake_commands_document').on(t.adjustmentId),check('stocktake_command_key_hash',sql`length(${t.clientKey}) between 8 and 100 and ${t.requestHash} ~ '^[0-9a-f]{64}$'`)]).enableRLS();

import {sql} from 'drizzle-orm';
import {pgTable,text,bigint,boolean,index,uniqueIndex,check} from 'drizzle-orm/pg-core';
import {salesContracts} from './schema.ts';
import {employees} from '../staff/schema.ts';
export const contractLiquidations=pgTable('contract_liquidation_requests',{
 id:text('id').primaryKey(),contractId:text('contract_id').notNull().references(()=>salesContracts.id),
 clientKey:text('client_key').notNull(),payloadHash:text('payload_hash').notNull(),
 status:text('status',{enum:['pending','approved','rejected','superseded']}).notNull().default('pending'),
 originalsReceived:boolean('originals_received').notNull(),servicesCompleted:boolean('services_completed').notNull(),
 photoFileKey:text('photo_file_key').notNull(),snapshotHash:text('snapshot_hash').notNull(),snapshot:text('snapshot').notNull(),
 requestedBy:text('requested_by').notNull().references(()=>employees.id),requestedAt:text('requested_at').notNull(),
 reviewedBy:text('reviewed_by').references(()=>employees.id),reviewedAt:text('reviewed_at'),reviewNote:text('review_note').notNull().default(''),
 revision:bigint('revision',{mode:'number'}).notNull().default(1),
},t=>[
 uniqueIndex('uq_contract_liquidation_intent').on(t.requestedBy,t.clientKey),
 uniqueIndex('uq_contract_liquidation_active').on(t.contractId).where(sql`${t.status} in ('pending','approved')`),
 index('idx_contract_liquidation_history').on(t.contractId,t.requestedAt),
 index('idx_contract_liquidation_pending').on(t.status,t.requestedAt),
 index('idx_contract_liquidation_requester').on(t.requestedBy),index('idx_contract_liquidation_reviewer').on(t.reviewedBy),
 check('chk_contract_liquidation_status',sql`${t.status} in ('pending','approved','rejected','superseded')`),
 check('chk_contract_liquidation_evidence',sql`${t.originalsReceived} and ${t.servicesCompleted} and length(${t.photoFileKey})>0`),
 check('chk_contract_liquidation_review',sql`(${t.status}='pending' and ${t.reviewedBy} is null and ${t.reviewedAt} is null) or (${t.status}<>'pending' and ${t.reviewedBy} is not null and ${t.reviewedAt} is not null)`),
]).enableRLS();

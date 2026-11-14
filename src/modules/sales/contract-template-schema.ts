import {sql} from 'drizzle-orm';
import {pgTable,text,integer,primaryKey,check} from 'drizzle-orm/pg-core';
/** Immutable revisions: inserts with the same brand/revision race safely at the primary key. */
export const contractTemplateVersions=pgTable('sales_contract_template_versions',{
 brand:text('brand').notNull(),revision:integer('revision').notNull(),sourceHash:text('source_hash').notNull(),
 edits:text('edits').notNull(),createdBy:text('created_by').notNull(),createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.brand,t.revision]}),
 check('chk_contract_template_brand',sql`${t.brand} in ('BN','VG')`),
 check('chk_contract_template_revision',sql`${t.revision}>0`),
 check('chk_contract_template_payload',sql`length(${t.edits})<=300000 and ${t.sourceHash} ~ '^[a-f0-9]{64}$'`),
]).enableRLS();

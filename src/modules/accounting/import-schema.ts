import {sql} from 'drizzle-orm';
import {pgTable,text,integer,numeric,doublePrecision,bigint,primaryKey,index,check} from 'drizzle-orm/pg-core';
import {accountingBooks,accountingEntities,accountingDocuments} from './schema.ts';
import {employees} from '../staff/schema.ts';
export const accountingImportJobs=pgTable('accounting_import_jobs',{
 id:text('id').primaryKey(), ownerId:text('owner_id').notNull().references(()=>employees.id),
 bookId:text('book_id').notNull().references(()=>accountingBooks.id), entityId:text('entity_id').notNull().references(()=>accountingEntities.id),
 fileHash:text('file_hash').notNull(), filename:text('filename').notNull(), totalRows:integer('total_rows').notNull(),
 kind:text('kind',{enum:['opening','purchase','sale']}).notNull(), date:text('date').notNull(), reference:text('reference').notNull(), note:text('note').notNull(),
 policyId:text('policy_id').notNull(), policyName:text('policy_name').notNull(), state:text('state').notNull().default('uploading'),
 documentId:text('document_id').references(()=>accountingDocuments.id), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
},t=>[index('idx_accounting_import_owner_book').on(t.ownerId,t.bookId),
 check('ck_accounting_import_job',sql`${t.totalRows} between 1 and 30000 and ${t.kind} in ('opening','purchase','sale') and ${t.state} in ('uploading','completed','cancelled') and ${t.fileHash} ~ '^[a-f0-9]{64}$' and ((${t.state}='completed')=(${t.documentId} is not null))`)]).enableRLS();
export const accountingImportChunks=pgTable('accounting_import_chunks',{
 jobId:text('job_id').notNull().references(()=>accountingImportJobs.id), chunkNo:integer('chunk_no').notNull(),
 hash:text('hash').notNull(), rowCount:integer('row_count').notNull(), errorCount:integer('error_count').notNull(),
 createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.jobId,t.chunkNo]}),check('ck_accounting_import_chunk',sql`${t.chunkNo} between 0 and 59 and ${t.rowCount} between 1 and 500 and ${t.errorCount} between 0 and ${t.rowCount}`)]).enableRLS();
export const accountingImportRows=pgTable('accounting_import_rows',{
 jobId:text('job_id').notNull().references(()=>accountingImportJobs.id), lineNo:integer('line_no').notNull(), sourceRow:integer('source_row').notNull(),
 sku:text('sku').notNull(),rawQuantity:text('raw_quantity').notNull(),quantity:numeric('quantity',{precision:18,scale:3}),
 name:text('name').notNull().default(''), unit:text('unit').notNull().default(''), unitPrice:doublePrecision('unit_price'),
 netValue:bigint('net_value',{mode:'number'}),error:text('error').notNull().default(''),pricedAt:text('priced_at').notNull(),
},t=>[primaryKey({columns:[t.jobId,t.lineNo]}),index('idx_accounting_import_sku').on(t.jobId,t.sku),
 check('ck_accounting_import_row',sql`${t.lineNo} between 1 and 30000 and ${t.sourceRow}>1`)]).enableRLS();

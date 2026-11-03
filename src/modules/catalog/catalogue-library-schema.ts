import { pgTable, text, bigint, index, uniqueIndex, check, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { employees } from '../staff/schema.ts';
/** Shared source facts only; quote quantities/discounts/overrides and stock never live here. */
export const catalogueLibrary=pgTable('catalogue_library_products',{
 id:text('id').primaryKey(),sourceKey:text('source_key').notNull(),name:text('name').notNull(),sku:text('sku').notNull().default(''),
 brand:text('brand').notNull(),category:text('category').notNull(),collection:text('collection').notNull().default(''),
 pattern:text('pattern').notNull().default(''),color:text('color').notNull().default(''),search:text('search').notNull(),
 data:text('data').notNull(),revision:bigint('revision',{mode:'number'}).notNull().default(1),
 lastKey:text('last_key'),lastHash:text('last_hash'),lastActor:text('last_actor'),
 createdBy:text('created_by').notNull().references(()=>employees.id),updatedBy:text('updated_by').notNull().references(()=>employees.id),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[check('chk_catalogue_library_revision',sql`${t.revision}>0`),uniqueIndex('uq_catalogue_library_source').on(t.sourceKey),index('idx_catalogue_library_brand_category').on(t.brand,t.category),
 index('idx_catalogue_library_collection').on(t.collection),index('idx_catalogue_library_pattern').on(t.pattern),index('idx_catalogue_library_color').on(t.color),index('idx_catalogue_library_updated').on(t.updatedAt,t.id)]).enableRLS();

/** Catalogue documents are separate from CRM orders/approved quotations. A save updates one row. */
export const catalogueQuotes=pgTable('catalogue_saved_quotes',{
 id:text('id').primaryKey(),quoteNo:text('quote_no').notNull(),title:text('title').notNull(),customer:text('customer').notNull(),
 productCount:bigint('product_count',{mode:'number'}).notNull(),search:text('search').notNull(),data:text('data').notNull(),
 revision:bigint('revision',{mode:'number'}).notNull().default(1),createdBy:text('created_by').notNull().references(()=>employees.id),updatedBy:text('updated_by').notNull().references(()=>employees.id),
 createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),deletedAt:text('deleted_at'),deletedBy:text('deleted_by').references(()=>employees.id),
},t=>[check('chk_catalogue_quotes_revision',sql`${t.revision}>0`),index('idx_catalogue_quotes_updated').on(t.updatedAt,t.id)]).enableRLS();
/** Immutable command receipts permit replay even after another employee edits the same document. */
export const catalogueQuoteCommands=pgTable('catalogue_quote_commands',{
 memberId:text('member_id').notNull().references(()=>employees.id),clientKey:text('client_key').notNull(),quoteId:text('quote_id').notNull(),payloadHash:text('payload_hash').notNull(),
 result:text('result'),createdAt:text('created_at').notNull(),
},t=>[primaryKey({columns:[t.memberId,t.clientKey]}),index('idx_catalogue_quote_commands_quote').on(t.quoteId,t.createdAt)]).enableRLS();

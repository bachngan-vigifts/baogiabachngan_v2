import {pgTable,text,boolean,doublePrecision,integer,check} from 'drizzle-orm/pg-core';
import {sql} from 'drizzle-orm';
import {posRegisters} from './pos-schema.ts';
import {products} from '../catalog/schema.ts';
import {employees} from '../staff/schema.ts';
/** One current gift program per register; immutable bill snapshots preserve previous programs. */
export const posPromotionPrograms=pgTable('pos_promotion_programs',{
 registerId:text('register_id').primaryKey().references(()=>posRegisters.id),
 title:text('title').notNull(),enabled:boolean('enabled').notNull().default(false),
 threshold:doublePrecision('threshold').notNull(),giftSku:text('gift_sku').notNull().references(()=>products.sku),
 giftQty:integer('gift_qty').notNull().default(1),revision:integer('revision').notNull().default(1),
 updatedAt:text('updated_at').notNull(),updatedBy:text('updated_by').references(()=>employees.id),
},t=>[check('chk_pos_promotion_values',sql`${t.threshold}>=0 and ${t.threshold}<=100000000000 and ${t.threshold}=trunc(${t.threshold}) and ${t.giftQty}>0 and ${t.giftQty}<=100 and ${t.revision}>0 and length(trim(${t.title})) between 1 and 200`)]).enableRLS();

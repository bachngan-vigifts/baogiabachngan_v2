import {pgTable,text,integer,doublePrecision,index,uniqueIndex,check} from 'drizzle-orm/pg-core';
import {sql} from 'drizzle-orm';
import {enumCheck} from '../../core/db/enum-check.ts';
import {CUSTODY_KINDS,CUSTODY_STATUSES} from '../../core/contracts/product-custody.ts';
import {employees} from '../staff/schema.ts';
import {products} from '../catalog/schema.ts';
import {customers} from '../customers/schema.ts';
import {suppliers} from '../suppliers/schema.ts';
export const custodyTickets=pgTable('product_custody_tickets',{
 id:text('id').primaryKey(),ticketNumber:text('ticket_number').notNull(),kind:text('kind',{enum:CUSTODY_KINDS}).notNull(),status:text('status',{enum:CUSTODY_STATUSES}).notNull(),
 customerId:text('customer_id').references(()=>customers.id),supplierId:text('supplier_id').references(()=>suppliers.id),partyName:text('party_name').notNull(),
 responsibleId:text('responsible_id').notNull().references(()=>employees.id),createdBy:text('created_by').notNull().references(()=>employees.id),
 startDate:text('start_date').notNull(),dueDate:text('due_date').notNull(),sentDate:text('sent_date'),returnedDate:text('returned_date'),deliveredDate:text('delivered_date'),
 issue:text('issue').notNull().default(''),result:text('result').notNull().default(''),note:text('note').notNull().default(''),revision:integer('revision').notNull().default(1),
 clientKey:text('client_key').notNull(),fingerprint:text('fingerprint').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},t=>[uniqueIndex('uq_custody_number').on(t.ticketNumber),uniqueIndex('uq_custody_client').on(t.createdBy,t.clientKey),index('idx_custody_responsible_due').on(t.responsibleId,t.dueDate),index('idx_custody_creator').on(t.createdBy),index('idx_custody_status_due').on(t.status,t.dueDate),enumCheck('chk_custody_kind',t.kind,CUSTODY_KINDS),enumCheck('chk_custody_status',t.status,CUSTODY_STATUSES),check('chk_custody_revision',sql`${t.revision}>0`),check('chk_custody_party',sql`(${t.kind}='sample' and ${t.customerId} is not null and ${t.supplierId} is null and ${t.status} in ('borrowed','returned','completed')) or (${t.kind}='warranty' and ${t.supplierId} is not null and ${t.status} in ('pending','sent','processing','returned','delivered','completed'))`),check('chk_custody_dates',sql`${t.startDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and ${t.dueDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and ${t.startDate}::date::text=${t.startDate} and ${t.dueDate}::date::text=${t.dueDate} and ${t.dueDate}>=${t.startDate}`)]).enableRLS();
export const custodyLines=pgTable('product_custody_lines',{
 id:text('id').primaryKey(),ticketId:text('ticket_id').notNull().references(()=>custodyTickets.id,{onDelete:'cascade'}),sku:text('sku').notNull().references(()=>products.sku),name:text('name').notNull(),unit:text('unit').notNull(),qty:doublePrecision('qty').notNull(),returnedQty:doublePrecision('returned_qty').notNull().default(0),conditionOut:text('condition_out').notNull(),
},t=>[uniqueIndex('uq_custody_line_sku').on(t.ticketId,t.sku),index('idx_custody_lines_ticket').on(t.ticketId),index('idx_custody_lines_sku').on(t.sku,t.ticketId),check('chk_custody_qty',sql`${t.qty}>0 and ${t.qty}<='1000000000'::double precision and ${t.returnedQty}>=0 and ${t.returnedQty}<=${t.qty}`)]).enableRLS();
export const custodyEvents=pgTable('product_custody_events',{
 id:text('id').primaryKey(),ticketId:text('ticket_id').notNull().references(()=>custodyTickets.id,{onDelete:'cascade'}),actorId:text('actor_id').notNull().references(()=>employees.id),action:text('action').notNull(),date:text('date').notNull(),at:text('at').notNull(),note:text('note').notNull(),data:text('data').notNull(),clientKey:text('client_key').notNull(),fingerprint:text('fingerprint').notNull(),
},t=>[index('idx_custody_events_ticket').on(t.ticketId,t.at),uniqueIndex('uq_custody_event_client').on(t.actorId,t.clientKey)]).enableRLS();
export const custodyPhotos=pgTable('product_custody_photos',{
 id:text('id').primaryKey(),ticketId:text('ticket_id').notNull().references(()=>custodyTickets.id,{onDelete:'cascade'}),storageKey:text('storage_key').notNull(),createdBy:text('created_by').notNull().references(()=>employees.id),createdAt:text('created_at').notNull(),
},t=>[index('idx_custody_photos_ticket').on(t.ticketId)]).enableRLS();

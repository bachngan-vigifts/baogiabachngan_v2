import {sql} from 'drizzle-orm';
import {pgTable,text,doublePrecision,bigint,index,uniqueIndex,primaryKey,check} from 'drizzle-orm/pg-core';
import {suppliers,incomingShipments,incomingShipmentLines} from './schema.ts';
import {stockTransfers} from '../inventory/schema.ts';
import {enumCheck} from '../../core/db/enum-check.ts';

/** Stock published by this supplier only. Never feeds the company's inventory ledger. */
export const supplierPublishedStock=pgTable('supplier_published_stock',{
 supplierId:text('supplier_id').notNull().references(()=>suppliers.id),sku:text('sku').notNull(),warehouse:text('warehouse').notNull(),
 onHand:doublePrecision('on_hand').notNull(),reserved:doublePrecision('reserved').notNull().default(0),incoming:doublePrecision('incoming').notNull().default(0),
 revision:bigint('revision',{mode:'number'}).notNull().default(1),publishedAt:text('published_at').notNull(),publishedBy:text('published_by').notNull(),
},t=>[primaryKey({columns:[t.supplierId,t.sku,t.warehouse]}),check('chk_supplier_published_qty',sql`${t.onHand}>=0 and ${t.reserved}>=0 and ${t.reserved}<=${t.onHand} and ${t.incoming}>=0`)]).enableRLS();
export const supplierPortalInvoices=pgTable('supplier_portal_invoices',{
 id:text('id').primaryKey(),supplierId:text('supplier_id').notNull().references(()=>suppliers.id),shipmentId:text('shipment_id').notNull().references(()=>incomingShipments.id),
 invoiceNo:text('invoice_no').notNull(),series:text('series').notNull().default(''),invoiceDate:text('invoice_date').notNull(),
 subtotal:doublePrecision('subtotal').notNull(),tax:doublePrecision('tax').notNull(),total:doublePrecision('total').notNull(),
 status:text('status',{enum:['submitted','verified','rejected']}).notNull().default('submitted'),note:text('note').notNull().default(''),
 clientKey:text('client_key').notNull(),requestHash:text('request_hash').notNull(),createdAt:text('created_at').notNull(),createdBy:text('created_by').notNull(),verifiedAt:text('verified_at'),verifiedBy:text('verified_by'),
},t=>[uniqueIndex('uq_supplier_portal_invoice_key').on(t.supplierId,t.clientKey),uniqueIndex('uq_supplier_portal_invoice_number').on(t.supplierId,t.series,t.invoiceNo),index('idx_supplier_portal_invoice_order').on(t.shipmentId),enumCheck('chk_supplier_portal_invoice_status',t.status,['submitted','verified','rejected']),check('chk_supplier_portal_invoice_amount',sql`${t.subtotal}>=0 and ${t.tax}>=0 and ${t.total}>0 and abs(${t.total}-${t.subtotal}-${t.tax})<0.01`)]).enableRLS();
/** A supplier's declared dispatch. Receiving and stock movements remain separate internal documents. */
export const supplierPortalDeliveries=pgTable('supplier_portal_deliveries',{
 id:text('id').primaryKey(),supplierId:text('supplier_id').notNull().references(()=>suppliers.id),shipmentId:text('shipment_id').notNull().references(()=>incomingShipments.id),
 deliveryNo:text('delivery_no').notNull(),deliveryDate:text('delivery_date').notNull(),note:text('note').notNull().default(''),
 clientKey:text('client_key').notNull(),requestHash:text('request_hash').notNull(),createdAt:text('created_at').notNull(),createdBy:text('created_by').notNull(),
},t=>[uniqueIndex('uq_supplier_portal_delivery_key').on(t.supplierId,t.clientKey),uniqueIndex('uq_supplier_portal_delivery_number').on(t.supplierId,t.deliveryNo),index('idx_supplier_portal_delivery_order').on(t.shipmentId)]).enableRLS();
export const supplierPortalDeliveryLines=pgTable('supplier_portal_delivery_lines',{
 deliveryId:text('delivery_id').notNull().references(()=>supplierPortalDeliveries.id,{onDelete:'cascade'}),purchaseLineId:text('purchase_line_id').notNull().references(()=>incomingShipmentLines.id),quantity:doublePrecision('quantity').notNull(),
},t=>[primaryKey({columns:[t.deliveryId,t.purchaseLineId]}),check('chk_supplier_portal_delivery_qty',sql`${t.quantity}>0`)]).enableRLS();
/** Explicit Manager share, not an inference that all transfers for the same SKU belong to a supplier. */
export const supplierTransferShares=pgTable('supplier_transfer_shares',{
 id:text('id').primaryKey(),supplierId:text('supplier_id').notNull().references(()=>suppliers.id),shipmentId:text('shipment_id').notNull().references(()=>incomingShipments.id),transferId:text('transfer_id').notNull().references(()=>stockTransfers.id),
 sharedAt:text('shared_at').notNull(),sharedBy:text('shared_by').notNull(),acknowledgedAt:text('acknowledged_at'),acknowledgedBy:text('acknowledged_by'),
},t=>[uniqueIndex('uq_supplier_transfer_share').on(t.supplierId,t.transferId),index('idx_supplier_transfer_share_order').on(t.shipmentId)]).enableRLS();

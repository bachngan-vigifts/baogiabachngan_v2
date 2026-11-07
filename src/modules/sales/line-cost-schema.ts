import { pgTable, text, doublePrecision, integer, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { enumCheck } from '../../core/db/enum-check.ts';
import { salesOrderLines, salesOrders } from './schema.ts';
import { employees } from '../staff/schema.ts';
import { LINE_COST_CONFIDENCES, LINE_COST_REASONS, LINE_COST_SOURCES } from './domain/line-cost.ts';

/**
 * Giá vốn dòng đơn lưu lúc bán (snapshot) – một dòng / dòng đơn. Chỉ Manager xem (giá vốn).
 * Dòng không có giá vốn lúc bán: KHÔNG có bản ghi (báo cáo ghi "thiếu giá vốn" / tính backfill, không coi là 0).
 * `revision` tăng mỗi lần đổi; mọi lần đổi ghi `sales_line_cost_history` (giữ cả khi dòng đơn bị xoá).
 */
export const salesLineCosts = pgTable('sales_line_costs', {
  orderLineId: text('order_line_id').primaryKey().references(() => salesOrderLines.id, { onDelete: 'cascade' }),
  orderId: text('order_id').notNull().references(() => salesOrders.id),
  sku: text('sku').notNull(),
  unitCost: doublePrecision('unit_cost').notNull(),
  source: text('source', { enum: LINE_COST_SOURCES }).notNull(),
  confidence: text('confidence', { enum: LINE_COST_CONFIDENCES }).notNull(),
  /** Thời điểm của giá gốc (ngày nhập hàng / lần sửa báo giá); null = không rõ. */
  costAt: text('cost_at'),
  capturedAt: text('captured_at').notNull(),
  /** null = hệ thống tự ghi. */
  capturedBy: text('captured_by').references(() => employees.id),
  revision: integer('revision').notNull().default(1),
  note: text('note').notNull().default(''),
}, t => [
  index('idx_sales_line_costs_order').on(t.orderId),
  enumCheck('chk_sales_line_costs_source', t.source, LINE_COST_SOURCES),
  enumCheck('chk_sales_line_costs_confidence', t.confidence, LINE_COST_CONFIDENCES),
  check('chk_sales_line_costs_unit_cost', sql`${t.unitCost} >= 0`),
]).enableRLS();

export const salesLineCostHistory = pgTable('sales_line_cost_history', {
  id: text('id').primaryKey(),
  orderLineId: text('order_line_id').notNull(),
  orderId: text('order_id').notNull(),
  sku: text('sku').notNull(),
  /** null = gỡ giá vốn (dòng đổi mã, không còn nguồn giá). */
  unitCost: doublePrecision('unit_cost'),
  previousUnitCost: doublePrecision('previous_unit_cost'),
  source: text('source').notNull(),
  confidence: text('confidence').notNull(),
  reason: text('reason', { enum: LINE_COST_REASONS }).notNull(),
  note: text('note').notNull().default(''),
  actorId: text('actor_id'),
  at: text('at').notNull(),
}, t => [
  index('idx_sales_line_cost_history_line').on(t.orderLineId, t.at),
  index('idx_sales_line_cost_history_order').on(t.orderId),
  enumCheck('chk_sales_line_cost_history_reason', t.reason, LINE_COST_REASONS),
]).enableRLS();

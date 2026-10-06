import { sql } from 'drizzle-orm';
import { pgTable, text, bigint, boolean, doublePrecision, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/pg-core';
import { enumCheck } from '../../core/db/enum-check.ts';

export const stockImports = pgTable('stock_imports', {
  revision: bigint('revision', { mode: 'number' }).primaryKey(),
  key: text('key').notNull(),
  filename: text('filename').notNull(),
  observedAt: text('observed_at').notNull(),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
  count: bigint('count', { mode: 'number' }).notNull(),
}).enableRLS();
export const productEdits = pgTable('product_edits', {
  sku: text('sku').primaryKey(),
  data: text('data').notNull(),
  revision: bigint('revision', { mode: 'number' }).notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
}).enableRLS();

/*
 * Catalog sản phẩm. Bản cũ lưu toàn bộ catalog thành một file JSON trên R2
 * (`catalogs/current.json`, định dạng 'sapo-catalog-v1') và chồng thêm
 * `product_edits` + file tồn kho. Bản mới đưa về bảng quan hệ.
 * `product_edits` giữ nguyên làm lớp chỉnh sửa tay phủ lên dữ liệu đồng bộ Sapo.
 */

/** Kho. `kind`: stock = kho thật, supplier = tồn NCC, incoming = hàng chờ về. */
export const warehouses = pgTable('warehouses', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['stock', 'supplier', 'incoming'] }).notNull().default('stock'),
  sortOrder: bigint('sort_order', { mode: 'number' }).notNull().default(0),
  active: boolean('active').notNull().default(true),
}, t => [uniqueIndex('idx_warehouses_name').on(t.name), enumCheck('chk_warehouses_kind', t.kind, ['stock', 'supplier', 'incoming'])]).enableRLS();

/** Chính sách giá (cột giá trong Sapo: giá bán lẻ, giá sỉ, ...). */
export const pricePolicies = pgTable('price_policies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sortOrder: bigint('sort_order', { mode: 'number' }).notNull().default(0),
}, t => [uniqueIndex('idx_price_policies_name').on(t.name)]).enableRLS();

export const products = pgTable('products', {
  sku: text('sku').primaryKey(),
  name: text('name').notNull(),
  brand: text('brand').notNull().default(''),
  pattern: text('pattern').notNull().default(''),
  unit: text('unit').notNull().default(''),
  imageUrl: text('image_url').notNull().default(''),
  taxBasis: text('tax_basis').notNull().default(''),
  taxIn: doublePrecision('tax_in'),
  taxOut: doublePrecision('tax_out'),
  taxable: boolean('taxable').notNull().default(false),
  perCarton: doublePrecision('per_carton'),
  cartonWeight: doublePrecision('carton_weight'),
  cartonLength: doublePrecision('carton_length'),
  cartonWidth: doublePrecision('carton_width'),
  cartonHeight: doublePrecision('carton_height'),
  sapoProductId: text('sapo_product_id'),
  active: boolean('active').notNull().default(true),
  updatedAt: text('updated_at').notNull(),
}, t => [
  index('idx_products_brand').on(t.brand),
  index('idx_products_name').on(t.name),
  check('chk_products_tax_in', sql`${t.taxIn} IS NULL OR (${t.taxIn} >= 0 AND ${t.taxIn} <= 100)`),
  check('chk_products_tax_out', sql`${t.taxOut} IS NULL OR (${t.taxOut} >= 0 AND ${t.taxOut} <= 100)`),
]).enableRLS();

export const productPrices = pgTable('product_prices', {
  sku: text('sku').notNull().references(() => products.sku, { onDelete: 'cascade' }),
  policyId: text('policy_id').notNull().references(() => pricePolicies.id, { onDelete: 'cascade' }),
  /** null = chưa có giá cho chính sách này. */
  price: doublePrecision('price'),
}, t => [primaryKey({ columns: [t.sku, t.policyId] }), check('chk_product_prices', sql`${t.price} IS NULL OR ${t.price} >= 0`)]).enableRLS();

export const productStock = pgTable('product_stock', {
  sku: text('sku').notNull().references(() => products.sku, { onDelete: 'cascade' }),
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  /** Có thể âm (Sapo cho phép bán âm kho). */
  quantity: doublePrecision('quantity').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.sku, t.warehouseId] }), index('idx_product_stock_warehouse').on(t.warehouseId)]).enableRLS();

/** Dòng của từng lần nhập file tồn kho (thay cho file JSON trên R2). */
export const stockImportLines = pgTable('stock_import_lines', {
  importRevision: bigint('import_revision', { mode: 'number' }).notNull().references(() => stockImports.revision, { onDelete: 'cascade' }),
  sku: text('sku').notNull(),
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  quantity: doublePrecision('quantity').notNull(),
}, t => [primaryKey({ columns: [t.importRevision, t.sku, t.warehouseId] }), index('idx_stock_import_lines_sku').on(t.sku)]).enableRLS();

/** Mỗi lần thay catalog từ Sapo. Chỉ một phiên bản được đánh dấu hiện hành. */
export const catalogVersions = pgTable('catalog_versions', {
  id: text('id').primaryKey(),
  format: text('format').notNull().default('sapo-catalog-v1'),
  observedAt: text('observed_at').notNull(),
  productCount: bigint('product_count', { mode: 'number' }).notNull(),
  isCurrent: boolean('is_current').notNull().default(false),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('idx_catalog_versions_current').on(t.isCurrent).where(sql`${t.isCurrent} = true`),
  check('chk_catalog_versions_count', sql`${t.productCount} >= 0`),
]).enableRLS();

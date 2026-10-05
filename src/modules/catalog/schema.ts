import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { enumCheck } from '../../core/db/enum-check.ts';

export const stockImports = sqliteTable('stock_imports', {
  revision: integer('revision').primaryKey(),
  key: text('key').notNull(),
  filename: text('filename').notNull(),
  observedAt: text('observed_at').notNull(),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
  count: integer('count').notNull(),
});
export const productEdits = sqliteTable('product_edits', {
  sku: text('sku').primaryKey(),
  data: text('data').notNull(),
  revision: integer('revision').notNull(),
  updatedAt: text('updated_at').notNull(),
  updatedBy: text('updated_by').notNull(),
});

/*
 * Catalog sản phẩm. Bản cũ lưu toàn bộ catalog thành một file JSON trên R2
 * (`catalogs/current.json`, định dạng 'sapo-catalog-v1') và chồng thêm
 * `product_edits` + file tồn kho. Bản mới đưa về bảng quan hệ.
 * `product_edits` giữ nguyên làm lớp chỉnh sửa tay phủ lên dữ liệu đồng bộ Sapo.
 */

/** Kho. `kind`: stock = kho thật, supplier = tồn NCC, incoming = hàng chờ về. */
export const warehouses = sqliteTable('warehouses', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['stock', 'supplier', 'incoming'] }).notNull().default('stock'),
  sortOrder: integer('sort_order').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
}, t => [uniqueIndex('idx_warehouses_name').on(t.name), enumCheck('chk_warehouses_kind', t.kind, ['stock', 'supplier', 'incoming'])]);

/** Chính sách giá (cột giá trong Sapo: giá bán lẻ, giá sỉ, ...). */
export const pricePolicies = sqliteTable('price_policies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
}, t => [uniqueIndex('idx_price_policies_name').on(t.name)]);

export const products = sqliteTable('products', {
  sku: text('sku').primaryKey(),
  name: text('name').notNull(),
  brand: text('brand').notNull().default(''),
  pattern: text('pattern').notNull().default(''),
  unit: text('unit').notNull().default(''),
  imageUrl: text('image_url').notNull().default(''),
  taxBasis: text('tax_basis').notNull().default(''),
  taxIn: real('tax_in'),
  taxOut: real('tax_out'),
  taxable: integer('taxable', { mode: 'boolean' }).notNull().default(false),
  perCarton: real('per_carton'),
  cartonWeight: real('carton_weight'),
  cartonLength: real('carton_length'),
  cartonWidth: real('carton_width'),
  cartonHeight: real('carton_height'),
  sapoProductId: text('sapo_product_id'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull(),
}, t => [
  index('idx_products_brand').on(t.brand),
  index('idx_products_name').on(t.name),
  check('chk_products_tax_in', sql`${t.taxIn} IS NULL OR (${t.taxIn} >= 0 AND ${t.taxIn} <= 100)`),
  check('chk_products_tax_out', sql`${t.taxOut} IS NULL OR (${t.taxOut} >= 0 AND ${t.taxOut} <= 100)`),
]);

export const productPrices = sqliteTable('product_prices', {
  sku: text('sku').notNull().references(() => products.sku, { onDelete: 'cascade' }),
  policyId: text('policy_id').notNull().references(() => pricePolicies.id, { onDelete: 'cascade' }),
  /** null = chưa có giá cho chính sách này. */
  price: integer('price'),
}, t => [primaryKey({ columns: [t.sku, t.policyId] }), check('chk_product_prices', sql`${t.price} IS NULL OR ${t.price} >= 0`)]);

export const productStock = sqliteTable('product_stock', {
  sku: text('sku').notNull().references(() => products.sku, { onDelete: 'cascade' }),
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  /** Có thể âm (Sapo cho phép bán âm kho). */
  quantity: real('quantity').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.sku, t.warehouseId] }), index('idx_product_stock_warehouse').on(t.warehouseId)]);

/** Dòng của từng lần nhập file tồn kho (thay cho file JSON trên R2). */
export const stockImportLines = sqliteTable('stock_import_lines', {
  importRevision: integer('import_revision').notNull().references(() => stockImports.revision, { onDelete: 'cascade' }),
  sku: text('sku').notNull(),
  warehouseId: text('warehouse_id').notNull().references(() => warehouses.id),
  quantity: real('quantity').notNull(),
}, t => [primaryKey({ columns: [t.importRevision, t.sku, t.warehouseId] }), index('idx_stock_import_lines_sku').on(t.sku)]);

/** Mỗi lần thay catalog từ Sapo. Chỉ một phiên bản được đánh dấu hiện hành. */
export const catalogVersions = sqliteTable('catalog_versions', {
  id: text('id').primaryKey(),
  format: text('format').notNull().default('sapo-catalog-v1'),
  observedAt: text('observed_at').notNull(),
  productCount: integer('product_count').notNull(),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(false),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [
  uniqueIndex('idx_catalog_versions_current').on(t.isCurrent).where(sql`${t.isCurrent} = 1`),
  check('chk_catalog_versions_count', sql`${t.productCount} >= 0`),
]);

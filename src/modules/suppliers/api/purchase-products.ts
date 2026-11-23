import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import { products, warehouses } from '../../catalog/schema.ts';
import { matchProductWords, productOrder } from '../../catalog/api/product-query.ts';
import { hiddenStockWarehouses, readCatalogStock } from '../../catalog/api/stock-source.ts';
import { outstandingLines } from './incoming-stock.ts';
import {purchaseScope,type Db,type Member} from './purchase-store.ts';

/**
 * SẢN PHẨM + TỒN CHO LẬP ĐƠN MUA BỔ SUNG (`GET /purchase-products`): tìm nhanh (cùng thuật toán trang Sản phẩm) hoặc theo danh sách mã
 * (`skus=`, nhập từ file Excel), mỗi mã kèm tồn **Kho SR** (kho tên bắt đầu "SR" / showroom), **Kho VIGIFTS** và **Hàng đang về**
 * (đơn mua NCC đã duyệt chưa nhận đủ). Tồn đọc như trang Sản phẩm (sổ kho CRM nếu kho đã chốt đầu kỳ); kho riêng người xem không được thấy thì bỏ.
 */
export const isSrWarehouse = (name: string) => /^\s*sr\b|showroom/i.test(name);
export const isVigiftsWarehouse = (name: string) => /vigifts/i.test(name);
const round = (n: number) => Math.round(n * 1000) / 1000;

export interface PurchaseProduct {
  sku: string; name: string; unit: string; brand: string; imageUrl: string;
  sr: number; vigifts: number; incoming: number;
  /** Tồn từng kho (tên kho → số) để xem chi tiết khi rê chuột. */
  warehouses: { name: string; qty: number; group: 'sr' | 'vigifts' | 'other' }[];
}

export async function purchaseProducts(db: Db, m: Member, o: { q?: string; skus?: string[]; offset?: number; limit?: number }) {
  const skus = o.skus?.map(s => s.trim()).filter(Boolean);
  if (skus && skus.length > 500) throw new AppError(400, 'Tối đa 500 mã mỗi lần.');
  const limit = Math.max(1, Math.min(50, o.limit ?? 20)), offset = Math.max(0, Math.min(100_000, o.offset ?? 0));
  const where = and(eq(products.active, true), eq(products.approvalStatus, 'approved'),
    // Theo mã (file Excel): không phân biệt hoa thường – "ly01" vẫn ra "LY01".
    skus ? inArray(sql`lower(${products.sku})`, skus.length ? skus.map(s => s.toLowerCase()) : ['']) : matchProductWords(o.q ?? ''));
  const rows = await db.select({ sku: products.sku, name: products.name, unit: products.unit, brand: products.brand, imageUrl: products.imageUrl }).from(products).where(where)
    .orderBy(...productOrder(skus ? null : o.q ?? '')).limit(skus ? 500 : limit + 1).offset(skus ? 0 : offset);
  const page = skus ? rows : rows.slice(0, limit);
  const codes = page.map(p => p.sku);
  const [stock, hidden, stores, incoming] = await Promise.all([
    readCatalogStock(db, codes), hiddenStockWarehouses(db, m),
    db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(and(eq(warehouses.active, true), eq(warehouses.kind, 'stock'))).orderBy(asc(warehouses.sortOrder), asc(warehouses.name)),
    codes.length ? outstandingLines(db, codes,false,{predicate:purchaseScope(m)}) : [],
  ]);
  const visible = stores.filter(w => !hidden.has(w.id)), qty = new Map<string, number>();
  for (const s of stock) qty.set(s.sku + '\u0000' + s.warehouseId, s.quantity);
  const items: PurchaseProduct[] = page.map(p => {
    const list = visible.map(w => ({ name: w.name, qty: round(qty.get(p.sku + '\u0000' + w.id) ?? 0), group: isSrWarehouse(w.name) ? 'sr' as const : isVigiftsWarehouse(w.name) ? 'vigifts' as const : 'other' as const }));
    const sum = (g: string) => round(list.filter(w => w.group === g).reduce((n, w) => n + w.qty, 0));
    return { ...p, unit: p.unit ?? '', brand: p.brand ?? '', sr: sum('sr'), vigifts: sum('vigifts'),
      incoming: round(incoming.filter(i => i.sku === p.sku).reduce((n, i) => n + i.left, 0)), warehouses: list.filter(w => w.qty) };
  });
  // Theo mã: giữ thứ tự gửi lên, báo các mã không có trong danh mục (đang bán, đã duyệt).
  if (skus) {
    const byKey = new Map(items.map(i => [i.sku.toLowerCase(), i]));
    return { products: skus.map(s => byKey.get(s.toLowerCase())).filter((x): x is PurchaseProduct => !!x),
      missing: [...new Set(skus.filter(s => !byKey.has(s.toLowerCase())))], nextOffset: null };
  }
  return { products: items, missing: [], nextOffset: rows.length > limit ? offset + limit : null };
}

import { and, eq, inArray, isNull, gt } from 'drizzle-orm';
import type { AnyDb } from '../core/db/client.ts';
import type { CostPoint, LineCostFallbackOf, SkuFallbackCosts } from '../core/contracts/line-cost-fallback.ts';
import { defaultCostDiscount, netPrice, normalize } from '../modules/quotes/domain/quote-math.ts';
import { purchaseUnitCost } from '../modules/suppliers/domain/order-totals.ts';
import { incomingShipmentLines, incomingShipments } from '../modules/suppliers/schema.ts';
import { pricePolicies, productPrices, products } from '../modules/catalog/schema.ts';

const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12;
/** Giá mua sau CK, trước VAT của một dòng đơn NCC (đơn giá + CK đã xác nhận / CK đặt + phí in). */
export function purchaseOrderCost(p: { price: number | null; discount: number | null; printFee: number | null }) {
  if (!valid(p.price) || (p.discount !== null && (!valid(p.discount) || p.discount > 100)) || (p.printFee !== null && !valid(p.printFee))) return null;
  const v = purchaseUnitCost({ price: p.price, purchaseDiscount: p.discount, confirmedPurchaseDiscount: null, printFee: p.printFee ?? 0, taxRate: 0 });
  return valid(v) ? v : null;
}
export interface CatalogProduct { sku: string; unit?: string; name: string; brand: string; pattern: string; taxable: boolean; taxOut: number | null; taxBasis: string; at: string; prices: { id: string; name: string; price: number | null }[] | null }
const RETAIL = ['gia ban le', 'gia le', 'gia ban le vat', 'gia le vat'];
/**
 * Công thức gợi ý đơn mua NCC theo thương hiệu: giá bán lẻ (đúng chính sách "Giá bán lẻ") quy trước VAT, trừ CK mặc định của thương hiệu.
 * Giống hệt purchases.js prefillCosts và script khôi phục đơn cũ. Trả `reason` khi không áp được (để báo, không đoán).
 */
export function catalogRuleCost(p: CatalogProduct | undefined): { cost: number; note: string; at: string; unit?: string } | { reason: string } | null {
  if (!p) return null;
  const discount = defaultCostDiscount(p);
  const retail = p.prices?.filter(x => RETAIL.includes(normalize(x.name).replace(/\+/g, ' ').replace(/\s+/g, ' ').trim()) && valid(x.price) && (x.price as number) > 0)
    .sort((a, b) => Number(/vat/i.test(a.name)) - Number(/vat/i.test(b.name)) || a.id.localeCompare(b.id))[0];
  if (!retail || discount === null || !valid(retail.price)) return null;
  const included = /vat/i.test(retail.name) || p.taxBasis === 'Giá đã bao gồm thuế';
  if (included && p.taxable && (!valid(p.taxOut) || p.taxOut > 100)) return { reason: 'Chưa rõ VAT của giá tham chiếu' };
  const listPrice = Math.round(netPrice(retail.price, p.taxable ? (p.taxOut ?? 0) : 0, included));
  const cost = purchaseUnitCost({ price: listPrice, purchaseDiscount: discount, confirmedPurchaseDiscount: null, printFee: 0, taxRate: 0 })!;
  return { cost, at: p.at, unit: p.unit,
    note: `Công thức gợi ý đơn mua NCC: ${retail.name} (${retail.id}), CK ${discount}%, trước VAT; bảng giá tham chiếu tại ${p.at}. Chưa phải giá mua lịch sử hay giá vốn xuất kho đã đối soát.` };
}

/** Nguồn giá bổ sung theo mã: đơn NCC đã duyệt (chưa huỷ, SL > 0) + công thức thương hiệu (sản phẩm đã duyệt). Chỉ đọc. */
export const lineCostFallbackOf: LineCostFallbackOf = async (db: AnyDb, skus) => {
  const list = [...new Set(skus.filter(Boolean))], out = new Map<string, SkuFallbackCosts>();
  if (!list.length) return out;
  const [orderLines, prods, prices] = await Promise.all([
    db.select({ sku: incomingShipmentLines.sku, unit: incomingShipmentLines.unit, lineId: incomingShipmentLines.id, price: incomingShipmentLines.price,
      discount: incomingShipmentLines.purchaseDiscount, confirmed: incomingShipmentLines.confirmedPurchaseDiscount, printFee: incomingShipmentLines.printFee,
      id: incomingShipments.id, ticket: incomingShipments.ticketNumber, approvedAt: incomingShipments.approvedAt, createdAt: incomingShipments.createdAt })
      .from(incomingShipmentLines).innerJoin(incomingShipments, eq(incomingShipments.id, incomingShipmentLines.shipmentId))
      .where(and(inArray(incomingShipmentLines.sku, list), eq(incomingShipments.source, 'supplier-order'), eq(incomingShipments.approvalStatus, 'approved'),
        isNull(incomingShipments.cancelledAt), gt(incomingShipmentLines.quantity, 0))),
    db.select({ sku: products.sku, unit: products.unit, name: products.name, brand: products.brand, pattern: products.pattern, taxable: products.taxable,
      taxOut: products.taxOut, taxBasis: products.taxBasis, at: products.updatedAt }).from(products).where(and(inArray(products.sku, list), eq(products.approvalStatus, 'approved'))),
    db.select({ sku: productPrices.sku, id: productPrices.policyId, name: pricePolicies.name, price: productPrices.price })
      .from(productPrices).innerJoin(pricePolicies, eq(pricePolicies.id, productPrices.policyId)).where(inArray(productPrices.sku, list)),
  ]);
  const entry = (sku: string) => out.get(sku) ?? out.set(sku, { orders: [], catalog: null }).get(sku)!;
  for (const l of orderLines) {
    const cost = purchaseOrderCost({ price: l.price, discount: l.confirmed ?? l.discount, printFee: l.printFee });
    const at = l.approvedAt || l.createdAt;
    if (cost === null || !at) continue;
    const point: CostPoint = { at, cost, unit: l.unit, ref: `purchase:${l.id}:line:${l.lineId} [${l.ticket ?? ''}]` };
    entry(l.sku).orders.push(point);
  }
  for (const p of prods) {
    const rule = catalogRuleCost({ ...p, unit: p.unit, prices: prices.filter(x => x.sku === p.sku).map(x => ({ id: x.id, name: x.name, price: x.price })) } as CatalogProduct);
    if (rule && 'cost' in rule) entry(p.sku).catalog = { at: rule.at, cost: rule.cost, unit: rule.unit, ref: 'catalog:' + p.sku, note: rule.note };
  }
  return out;
};

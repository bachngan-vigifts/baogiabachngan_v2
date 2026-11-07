import { setupLiquidation } from './liquidation-fixture.ts';
import { products, pricePolicies, productPrices } from '../../src/modules/catalog/schema.ts';
import { salesOrders, salesOrderLines } from '../../src/modules/sales/schema.ts';

/** Isolated Postgres fixture. No production connections or product data. */
export async function profitCostReviewFixture() {
  const f = await setupLiquidation(), at = '2026-11-01T02:00:00Z';
  await f.db.insert(products).values([
    { sku: 'LOCK', name: 'Bình Lock', brand: 'Lock&Lock', unit: 'Cái', updatedAt: at },
    { sku: 'PLAIN', name: 'Bình không CK', brand: 'Thermos', unit: 'Cái', taxable: true, taxOut: 8, updatedAt: at },
    { sku: 'NONE', name: 'Mã chưa có niêm yết', brand: 'Khác', unit: 'Cái', updatedAt: at },
  ] as never);
  await f.db.insert(pricePolicies).values([{ id: 'retail', name: 'Giá bán lẻ VAT' }, { id: 'whole', name: 'Giá sỉ' }]);
  await f.db.insert(productPrices).values([{ sku: 'LOCK', policyId: 'retail', price: 100000 }, { sku: 'PLAIN', policyId: 'retail', price: 108000 }, { sku: 'NONE', policyId: 'whole', price: 100 }]);
  await f.db.insert(salesOrders).values({ id: 'review-order', orderNo: 'DH-REVIEW', quoteType: 'HRC', customerName: 'Khách kiểm thử', ownerId: 'emp', createdBy: 'emp', orderDate: '2026-11-07', status: 'confirmed', total: 0, subtotal: 0, createdAt: at, updatedAt: at } as never);
  await f.db.insert(salesOrderLines).values(['LOCK', 'PLAIN', 'NONE', 'BOX'].map((id, i) => ({ id: 'review-' + id, orderId: 'review-order', lineNo: i + 1, sku: id === 'BOX' ? 'PLAIN' : id, name: id, unit: id === 'BOX' ? 'Thùng' : 'Cái', qty: 2, unitPrice: 200000, amount: 400000 })) as never);
  return f;
}

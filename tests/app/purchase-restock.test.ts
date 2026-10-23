import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createTestDb } from '../helpers/postgres.ts';
import { seedStaff, PASSWORD } from '../helpers/staff-fixture.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { products, productStock, warehouses } from '../../src/modules/catalog/schema.ts';
import { incomingShipments, incomingShipmentLines, suppliers } from '../../src/modules/suppliers/schema.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';

/** Lập đơn mua bổ sung: GET /purchase-products (tìm nhanh / theo mã) kèm tồn Kho SR, Kho VIGIFTS, Hàng đang về; đọc file Excel cập nhật danh sách. */
const origin = 'https://trial.test', now = '2026-10-23T00:00:00.000Z';
test('GET /purchase-products: tìm như trang Sản phẩm, tồn Kho SR / VIGIFTS (sổ kho) / đang về; theo mã giữ thứ tự, báo mã thiếu; cần quyền đơn mua', async () => {
  const { db, d1 } = await createTestDb(); await seedStaff(d1);
  const router = createAppRouter(), env = { db, passwordIterations: 1000, sapoOrderPush: 'off' as const };
  const call = async (path: string, cookie = '') => {
    const res = await router.handle(new Request(origin + '/api/staff' + path, { headers: { origin, cookie } }), env as never);
    return { status: res.status, data: await res.json() as any, cookie: res.headers.get('set-cookie')?.split(';')[0] ?? '' };
  };
  const login = async (email: string) => (await router.handle(new Request(origin + '/api/staff/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }), env as never)).headers.get('set-cookie')!.split(';')[0]!;
  const mgr = await login('mgr@x.vn'), ncc = await login('ncc@x.vn');
  await db.insert(warehouses).values([{ id: 'vig', name: 'KHO VIGIFTS', kind: 'stock', sortOrder: 1 }, { id: 'sr', name: 'SR Minh Long - Lock', kind: 'stock', sortOrder: 2 },
    { id: 'other', name: 'Kho Quận 1', kind: 'stock', sortOrder: 3 }]);
  await db.insert(products).values([{ sku: 'BT07', name: 'Bộ trà 0.7 L Chim Lạc', unit: 'bộ', updatedAt: now }, { sku: 'LY01', name: 'Ly sứ trắng', unit: 'cái', updatedAt: now },
    { sku: 'OFF', name: 'Bộ trà ngừng bán', unit: 'bộ', active: false, updatedAt: now }]);
  await db.insert(productStock).values([{ sku: 'BT07', warehouseId: 'vig', quantity: 999, updatedAt: now }, { sku: 'BT07', warehouseId: 'sr', quantity: 3, updatedAt: now }]);
  // Kho VIGIFTS đã chốt đầu kỳ: tồn lấy sổ kho (40), không lấy số Sapo (999).
  await postMoves(db, 'mgr', [{ sku: 'BT07', warehouseId: 'vig', qty: 40, kind: 'opening', refType: 'opening', refId: 'vig-open' }]);
  await db.insert(suppliers).values({ id: 'ncc1', name: 'Minh Long', nameKey: 'minh long', createdAt: now, updatedAt: now, createdBy: 'mgr' } as never);
  await db.insert(incomingShipments).values({ id: 'PO1', ticketNumber: 'PO1', source: 'supplier-order', approvalStatus: 'approved', supplierId: 'ncc1', supplierName: 'Minh Long', warehouse: 'Kho', createdAt: now, createdBy: 'mgr', updatedAt: now });
  await db.insert(incomingShipmentLines).values({ id: 'PO1-1', shipmentId: 'PO1', lineNo: 1, sku: 'BT07', quantity: 12, price: 0, taxRate: 0, printFee: 0 });

  const found = await call('/purchase-products?q=' + encodeURIComponent('bo tra chim lac'), mgr);
  assert.equal(found.status, 200, JSON.stringify(found.data));
  assert.deepEqual(found.data.products.map((p: any) => [p.sku, p.sr, p.vigifts, p.incoming]), [['BT07', 3, 40, 12]], 'không dấu, nhiều từ; bỏ mã ngừng bán');
  assert.deepEqual(found.data.products[0].warehouses.map((w: any) => [w.name, w.qty, w.group]), [['KHO VIGIFTS', 40, 'vigifts'], ['SR Minh Long - Lock', 3, 'sr']]);

  const bySku = await call('/purchase-products?skus=' + encodeURIComponent('ly01,KHONG-CO,BT07'), mgr);
  assert.deepEqual(bySku.data.products.map((p: any) => p.sku), ['LY01', 'BT07'], 'giữ thứ tự gửi lên (không phân biệt hoa thường)');
  assert.deepEqual(bySku.data.missing, ['KHONG-CO']);
  assert.deepEqual([bySku.data.products[0].sr, bySku.data.products[0].vigifts, bySku.data.products[0].incoming], [0, 0, 0]);

  assert.equal((await call('/purchase-products?q=ly', ncc)).status, 403, 'tài khoản NCC không dùng được');
});

test('đọc file Excel cập nhật danh sách: theo tiêu đề hoặc cột A/B/C, cộng dồn mã trùng, báo dòng lỗi', () => {
  const src = readFileSync(new URL('../../trial-ui/purchase-restock.js', import.meta.url), 'utf8');
  const ctx: any = {};
  runInNewContext(src.replace(/export function initRestockPage[\s\S]*$/, '').replaceAll('export ', '') + '\nglobalThis.parse = parseRestockSheet; globalThis.HEAD = RESTOCK_TEMPLATE_HEAD;', ctx);
  const withHead = ctx.parse([['Đơn mua bổ sung'], ctx.HEAD, ['BT07', 'Bộ trà', '5'], ['LY01', '', '1.200'], ['bt07', '', '2'], ['', '', ''], ['X1', '', '0'], ['', 'thiếu mã', '3']]);
  assert.deepEqual(JSON.parse(JSON.stringify(withHead.lines)), [{ row: 3, sku: 'BT07', name: 'Bộ trà', qty: 7 }, { row: 4, sku: 'LY01', name: '', qty: 1200 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(withHead.errors.map((e: any) => [e.row, e.sku]))), [[7, 'X1'], [8, '']]);
  const noHead = ctx.parse([['A1', 'Tên', '3'], ['A2', 'Tên 2', 'abc']]);
  assert.deepEqual(JSON.parse(JSON.stringify(noHead.lines)), [{ row: 1, sku: 'A1', name: 'Tên', qty: 3 }]);
  assert.equal(noHead.errors.length, 1);
});

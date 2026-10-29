import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { employees } from '../../src/modules/staff/schema.ts';
import { warehouses } from '../../src/modules/catalog/schema.ts';
import { warehouseSellers } from '../../src/modules/inventory/schema.ts';
import { postMoves } from '../../src/modules/inventory/api/ledger.ts';

/** Sale Admin bán Bán hàng nhanh CHỈ ở quầy thuộc kho bán của chức vụ (Phân quyền › Kho bán – mặc định KHO VIGIFTS). */
test('Sale Admin: chỉ thấy và mở ca ở quầy KHO VIGIFTS; quầy kho khác bị chặn ở máy chủ; bỏ kho bán thì không còn quầy', async () => {
  const f = await setup();
  await f.db.insert(warehouses).values({ id: 'vigifts', name: 'KHO VIGIFTS', kind: 'stock' });
  await f.db.insert(warehouseSellers).values({ warehouseId: 'vigifts', positionId: 'sale-admin' });
  await f.db.transaction(tx => postMoves(tx, 'mgr', [{ sku: '00123', warehouseId: 'vigifts', qty: 5, kind: 'opening', refType: 'opening', refId: 'opening-vigifts' }]));
  const vg = await f.call('/pos/registers', f.mgr, 'POST', { name: 'Quầy VIGIFTS', warehouseId: 'vigifts', pricePolicyId: 'retail-vat', secondPricePolicyId: 'retail', taxRate: 8, bankCode: 'VCB', bankAccount: '123456', bankAccountName: 'BACH NGAN' });
  assert.equal(vg.status, 200, JSON.stringify(vg.data));
  await f.db.update(employees).set({ positionId: 'sale-admin' }).where(eq(employees.id, 'cashier2'));
  const opt = await f.call('/pos/options', f.other); assert.equal(opt.status, 200, JSON.stringify(opt.data));
  assert.deepEqual(opt.data.registers.map((r: any) => r.id), [vg.data.id], 'chỉ quầy KHO VIGIFTS');
  const openAt = async (registerId: string) => f.call('/pos/shifts/open', f.other, 'POST', { key: crypto.randomUUID(), registerId, openingCash: (await f.call('/cash', f.other)).data.nextOpeningCash });
  const lock = await openAt(f.registerId); assert.equal(lock.status, 403, 'quầy Kho POS (cửa hàng) bị chặn'); assert.equal(lock.data.code, 'POS_REGISTER_NOT_ALLOWED');
  const ok = await openAt(vg.data.id); assert.equal(ok.status, 201, JSON.stringify(ok.data));
  await f.db.delete(warehouseSellers).where(eq(warehouseSellers.positionId, 'sale-admin'));
  assert.equal((await f.call('/pos/options', f.other)).data.registers.length, 0, 'bỏ kho bán: không còn quầy nào');
});

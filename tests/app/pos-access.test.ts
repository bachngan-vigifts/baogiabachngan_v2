import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { employees, positions, positionPermissions } from '../../src/modules/staff/schema.ts';
import { warehouses } from '../../src/modules/catalog/schema.ts';

test('NVBH Lock/Minh Long: scope options, catalog, drawer, shifts, bill, QR and approval in both directions', async () => {
  const f = await setup();
  await f.db.update(employees).set({ positionId: 'sales-ml' }).where(eq(employees.id, 'emp'));
  // Real warehouse names: Lock includes the words Minh Long too. Counter labels may be renamed.
  await f.db.update(warehouses).set({ name: 'MINH LONG - LOCKNLOCK CẦN THƠ' }).where(eq(warehouses.id, 'pos-wh'));
  await f.db.insert(warehouses).values({ id: 'ml-wh', name: 'Showroom Gốm Sứ Minh Long Cần Thơ', kind: 'stock' });
  const ml = await f.call('/pos/registers', f.mgr, 'POST', {
    name: 'Showroom mới', warehouseId: 'ml-wh', pricePolicyId: 'retail-vat', secondPricePolicyId: 'retail',
  });
  assert.equal(ml.status, 200);
  const lockDrawer = crypto.randomUUID(), mlDrawer = crypto.randomUUID();
  for (const [key, registerId] of [[lockDrawer, f.registerId], [mlDrawer, ml.data.id]]) {
    assert.equal((await f.call('/cash/drawers', f.mgr, 'POST', { key, registerId, name: key })).status, 201);
    assert.equal((await f.call('/cash/config?drawerId=' + key, f.mgr, 'POST', { openingAmount: 500000, reason: 'Đầu kỳ' })).status, 200);
  }
  for (const [cookie, own, forbidden, ownDrawer, forbiddenDrawer] of [
    [f.other, f.registerId, ml.data.id, lockDrawer, mlDrawer],
    [f.emp, ml.data.id, f.registerId, mlDrawer, lockDrawer],
  ]) {
    const options = await f.call('/pos/options', cookie);
    assert.equal(options.status, 200);
    assert.deepEqual(options.data.registers.map((r: any) => r.id), [own]);
    const orders = await f.call('/pos/orders', cookie);
    assert.equal(orders.status, 200);
    assert.deepEqual(orders.data.registers.map((r: any) => r.id), [own]);
    const cash = await f.call('/cash', cookie);
    assert.equal(cash.status, 200);
    assert.equal(cash.data.drawer.id, ownDrawer);
    assert.deepEqual(cash.data.drawers.map((d: any) => d.id), [ownDrawer]);
    assert.deepEqual(cash.data.registers.map((r: any) => r.id), [own]);
    for (const path of [
      '/pos/catalog?registerId=' + forbidden,
      '/pos/orders?registerId=' + forbidden,
      '/pos/opening-counts?registerId=' + forbidden,
      '/cash?registerId=' + forbidden,
      '/cash?drawerId=' + forbiddenDrawer,
      '/cash/entries?from=2026-01-01&to=2027-01-01&drawerId=' + forbiddenDrawer,
      '/cash/shifts?drawerId=' + forbiddenDrawer,
      '/cash/reconciliations?drawerId=' + forbiddenDrawer,
    ]) assert.equal((await f.call(path, cookie)).status, 403, path);
    assert.equal((await f.call('/pos/shifts/open', cookie, 'POST', {
      key: crypto.randomUUID(), registerId: forbidden, openingCash: 500000,
    })).status, 403);
    assert.equal((await f.call('/pos/checkout', cookie, 'POST', { registerId: forbidden })).status, 403);
    assert.equal((await f.call('/pos/preview', cookie, 'POST', { registerId: forbidden })).status, 403);
  }
  const s = await f.open(f.other);
  const qr = await f.call('/pos/qr', f.other, 'POST', f.cart(s.id));
  assert.equal(qr.status, 200, JSON.stringify(qr.data));
  const sale = await f.call('/pos/checkout', f.other, 'POST', f.cart(s.id));
  assert.equal(sale.status, 201);
  const pending = await f.call('/cash/entries?drawerId=' + lockDrawer, f.other, 'POST', {
    key: crypto.randomUUID(), kind: 'other_income', amount: 1000000, reason: 'Thu kiểm thử',
  });
  assert.equal(pending.status, 201, JSON.stringify(pending.data));
  await f.db.update(employees).set({ canApprove: true }).where(eq(employees.id, 'emp'));
  assert.equal((await f.call('/pos/qr/' + qr.data.id + '/status', f.emp)).status, 403);
  assert.equal((await f.call('/cash/entries/' + pending.data.id + '/photo', f.emp)).status, 403);
  for (const path of ['/pos/shifts/' + s.id, '/cash/shifts/' + s.id, '/pos/bills/' + sale.data.id])
    assert.equal((await f.call(path, f.emp)).status, 403, path);
  for (const path of ['/pos/shifts/' + s.id + '/close', '/cash/shifts/' + s.id + '/close', '/cash/entries/' + pending.data.id + '/approve'])
    assert.equal((await f.call(path, f.emp, 'POST', { countedCash: 0 })).status, 403, path);
  assert.equal((await f.call('/pos/options', f.mgr)).data.registers.length, 2);
  assert.equal((await f.call('/cash?drawerId=' + lockDrawer, f.mgr)).status, 200);
  assert.equal((await f.call('/cash?drawerId=' + mlDrawer, f.mgr)).status, 200);
  // CHT has the same store boundary, even when granted a broad business permission set.
  await f.db.insert(positions).values({ id: 'custom-cht', name: 'CHT MINH LONG' });
  await f.db.insert(positionPermissions).values(['pos.sell', 'pos.configure', 'page.cashbook', 'approval.approve'].map(permission => ({ positionId: 'custom-cht', permission })));
  await f.db.update(employees).set({ positionId: 'custom-cht' }).where(eq(employees.id, 'emp'));
  assert.equal((await f.call('/pos/catalog?registerId=' + f.registerId, f.emp)).status, 403);
  assert.deepEqual((await f.call('/pos/orders', f.emp)).data.registers.map((r: any) => r.id), [ml.data.id]);
});

test('Không tự chuyển sang cửa hàng khác khi thiếu cấu hình; két gắn nhầm hai cửa hàng không lộ số dư', async () => {
  const f = await setup();
  const ml = await f.call('/pos/registers', f.mgr, 'POST', {
    name: 'Quầy Minh Long', warehouseId: 'pos-wh', pricePolicyId: 'retail-vat', secondPricePolicyId: 'retail',
  });
  assert.equal(ml.status, 200);
  assert.equal((await f.call('/cash', f.other)).status, 403);
  assert.equal((await f.call('/cash?registerId=' + f.registerId, f.other)).status, 403);
  assert.equal((await f.call('/pos/shifts/open', f.other, 'POST', {
    key: crypto.randomUUID(), registerId: f.registerId, openingCash: 500000,
  })).status, 403);
  // Renaming an unclassified generic warehouse/counter must fail closed, not pick Minh Long.
  const { posRegisters } = await import('../../src/modules/sales/pos-schema.ts');
  await f.db.update(posRegisters).set({ name: 'Quầy chưa phân cửa hàng' }).where(eq(posRegisters.id, f.registerId));
  assert.deepEqual((await f.call('/pos/options', f.other)).data.registers, []);
  assert.equal((await f.call('/cash', f.other)).status, 403);
  assert.equal((await f.call('/pos/catalog?registerId=' + ml.data.id, f.other)).status, 403);
  assert.equal((await f.call('/pos/options', f.mgr)).data.registers.length, 2);
});

test('Kho dùng tên chung Minh Long - LocknLock: phân cửa hàng theo tên quầy', async () => {
  const f = await setup();
  const { posRegisters } = await import('../../src/modules/sales/pos-schema.ts');
  await f.db.update(warehouses).set({ name: 'MINH LONG - LOCKNLOCK CẦN THƠ' }).where(eq(warehouses.id, 'pos-wh'));
  await f.db.update(posRegisters).set({ name: 'CỬA HÀNG LOCKNLOCK CẦN THƠ' }).where(eq(posRegisters.id, f.registerId));
  const ml = await f.call('/pos/registers', f.mgr, 'POST', {
    name: 'Showroom Gốm Sứ Minh Long Cần Thơ', warehouseId: 'pos-wh', pricePolicyId: 'retail-vat', secondPricePolicyId: 'retail',
  });
  assert.equal(ml.status, 200);
  await f.db.update(employees).set({ positionId: 'sales-ml' }).where(eq(employees.id, 'emp'));
  assert.deepEqual((await f.call('/pos/options', f.emp)).data.registers.map((r: any) => r.id), [ml.data.id]);
  assert.deepEqual((await f.call('/pos/options', f.other)).data.registers.map((r: any) => r.id), [f.registerId]);
});

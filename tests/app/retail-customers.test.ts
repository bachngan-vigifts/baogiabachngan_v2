import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { customers } from '../../src/modules/customers/schema.ts';
import { employees } from '../../src/modules/staff/schema.ts';
import { retailCandidate, retailPhone } from '../../src/modules/integrations/domain/retail-customer.ts';
import { addRetailCustomers } from '../../src/modules/integrations/api/retail-customers.ts';
import { pullRetailCustomers } from '../../src/modules/integrations/api/retail-pull.ts';
import { syncCustomers } from '../../src/modules/integrations/api/sapo-sync-routes.ts';
test('Khách lẻ: nhóm Sapo hoặc cá nhân không MST; tổ chức thiếu MST không bị suy diễn, chuẩn hoá điện thoại', () => {
  assert.ok(retailCandidate({ id: 1, name: 'Nguyễn A' }));
  assert.equal(retailCandidate({ id: 2, name: 'Công ty A' }), null);
  assert.equal(retailCandidate({ id: 3, name: 'A', company: 'Doanh nghiệp A' }), null);
  assert.equal(retailCandidate({ id: 4, name: 'A', tax_code: '123456' }), null);
  assert.ok(retailCandidate({ id: 5, name: 'A', tax_code: '123456', group_id: 7 }, new Map([['7', 'Khách lẻ']])));
  assert.equal(retailPhone('+84 901 234 567'), '0901234567');
  assert.equal(retailPhone(''), '');
  assert.equal(retailCandidate({ id: 8, name: 'A', tax_number: '12345678' }), null);
  assert.equal(retailCandidate({ id: 9, name: 'A', is_company: true }), null);
});
test('Bổ sung khách: chỉ insert, bỏ ID/mã/điện thoại có sẵn, không ghi đè; danh sách lọc server theo chức vụ', async () => {
  const f = await setup();
  await f.db.insert(customers).values({ id: '111', name: 'Giữ nguyên', contact: '', phone: '0901111111', email: '', address: '', search: '', sourceVersion: 1, syncedAt: '', customerCode: 'KH001' });
  const raw = [
    { id: 111, name: 'Không ghi đè' }, { id: 112, name: 'Trùng phone', phone: '+84901111111' }, { id: 113, name: 'Trùng mã', code: 'kh001' },
    { id: 114, name: 'Khách mới', phone: '0902222222' }, { id: 115, name: 'Công ty B', tax_code: '123' },
    { id: 116, name: 'Khách cùng tên', phone: '0903333333' }, { id: 117, name: 'Khách cùng tên', phone: '0904444444' },
  ];
  const r = await addRetailCustomers(f.db, raw);
  assert.deepEqual(r, { received: 7, eligible: 6, added: 3, existing: 1, duplicate: 2, excluded: 1 });
  assert.equal((await addRetailCustomers(f.db, raw)).added, 0);
  assert.equal((await f.db.select().from(customers).where(eq(customers.id, '111')))[0]!.name, 'Giữ nguyên');
  await syncCustomers(f.db, { customers: [{ id: 114, name: 'Không được ghi đè khách retail' }] });
  assert.equal((await f.db.select().from(customers).where(eq(customers.id, '114')))[0]!.name, 'Khách mới');
  for (const pos of ['sales-lock', 'sales-ml', 'sale']) {
    await f.db.update(employees).set({ positionId: pos }).where(eq(employees.id, 'emp'));
    const allowed = pos !== 'sale';
    const list = await f.call('/customers?kind=retail', f.emp);
    assert.equal(list.status, 200);
    assert.equal(list.data.canListRetail, allowed);
    assert.equal(list.data.customers.some((c: any) => c.id === '114'), allowed);
    assert.equal((await f.call('/pos/customers?q=Khách&kind=retail', f.emp)).data.customers.some((c: any) => c.id === '114'), allowed);
  }
  assert.equal((await f.call('/customers?kind=retail', f.mgr)).data.total, 3);
});
test('Quét đủ trang khách riêng, tiếp tục đúng con trỏ, gọi lặp không thêm; không gọi sản phẩm/nhân viên', async () => {
  const f = await setup(), paths: string[] = [];
  const api = { list: async (path: string, key: string, from: number) => {
    paths.push(path);
    if (key === 'customer_groups') return { items: [{ id: 9, name: 'Khách lẻ' }], nextPage: null };
    return { items: [{ id: from === 1 ? 201 : 202, name: 'Khách ' + from, tax_code: String(123000 + from), group_id: 9 }], nextPage: from === 1 ? 3 : null };
  } } as any;
  const a = await pullRetailCustomers(f.db, api);
  assert.equal(a.completed, false); assert.equal(a.page, 3);
  const b = await pullRetailCustomers(f.db, api);
  assert.equal(b.completed, true); assert.equal(b.totals.added, 2);
  assert.deepEqual(await pullRetailCustomers(f.db, api), b);
  assert.ok(paths.every(p => ['/customers.json', '/customer_groups.json'].includes(p)));
});

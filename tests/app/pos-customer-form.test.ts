import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { setup } from '../helpers/pos-fixture.ts';
import { customers } from '../../src/modules/customers/schema.ts';

test('POS saves complete customer fields and terms, rejects invalid input and duplicate tax codes', async () => {
  const { db, call, emp, ncc } = await setup();
  const body = { name: 'Công ty mới', contact: 'Chị Hoa', phone: '0901234567', email: 'hoa@example.vn',
    taxCode: '0123456789', customerCode: 'KH-MOI', address: '12 Nguyễn Trãi',
    depositRate: '25', paymentTerm: '15 ngày', creditLimit: '50.000.000' };
  const response = await call('/pos/customers', emp, 'POST', body);
  assert.equal(response.status, 201, JSON.stringify(response.data));
  const [saved] = await db.select().from(customers).where(eq(customers.id, response.data.id));
  for (const field of ['name', 'contact', 'phone', 'email', 'taxCode', 'customerCode', 'address', 'paymentTerm'] as const)
    assert.equal(saved![field], body[field]);
  assert.equal(saved!.depositRate, 25); assert.equal(saved!.creditLimit, 50000000);
  assert.equal(saved!.approvalStatus, 'approved');
  assert.equal((await call('/pos/customers', emp, 'POST', body)).status, 409);
  for (const invalid of [{ email: 'bad' }, { depositRate: '101' }, { paymentTerm: '3651 ngày' }, { phone: '' }]) {
    assert.equal((await call('/pos/customers', emp, 'POST', { ...body, ...invalid, taxCode: '' })).status, 400);
  }
  assert.equal((await call('/pos/customers', ncc, 'POST', { ...body, taxCode: '' })).status, 403);
});

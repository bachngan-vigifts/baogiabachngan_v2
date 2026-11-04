import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canEditWebAccounting,
  parseWebBilling,
  parseWebInvoice,
  parseWebInvoiceRequest,
  readWebAccounting,
} from '../../src/modules/sales/domain/web-order-accounting.ts';

test('Invoice validation preserves leading zeroes and accepts an explicit valid date', () => {
  assert.deepEqual(
    parseWebInvoice(
      { invoiceNo: ' 0000123 ', invoiceDate: '2026-11-04' },
      '2026-11-03',
    ),
    { invoiceNo: '0000123', invoiceDate: '2026-11-04' },
  );
  assert.equal(
    parseWebInvoice({ invoiceNo: 'HD-1' }, '2026-11-04').invoiceDate,
    '2026-11-04',
  );
  for (const input of [
    { invoiceNo: '' },
    { invoiceNo: 123 },
    { invoiceNo: 'x'.repeat(201) },
    { invoiceNo: 'HD', invoiceDate: '2026-02-30' },
    { invoiceNo: 'HD', invoiceDate: '2026-13-01' },
  ])
    assert.throws(() => parseWebInvoice(input, '2026-11-04'), { status: 400 });
});

test('Billing validation permits Vietnamese text and rejects oversized or malformed values without truncation', () => {
  const billing = {
    name: ' Công ty thử ',
    taxCode: '1800123456',
    address: 'Địa chỉ tiếng Việt',
    email: 'invoice@example.test',
  };
  assert.equal(parseWebBilling(billing).name, 'Công ty thử');
  assert.throws(() => parseWebBilling({ ...billing, email: 'bad' }), {
    status: 400,
  });
  assert.throws(
    () => parseWebBilling({ ...billing, address: 'x'.repeat(2001) }),
    { status: 400 },
  );
});

test('Invoice request validates mode, email count and notes', () => {
  assert.deepEqual(
    parseWebInvoiceRequest({
      email: 'a@example.test; b@example.test',
      note: ' Ghi chú ',
      mode: 'draft',
    }),
    { email: 'a@example.test, b@example.test', note: 'Ghi chú', mode: 'draft' },
  );
  for (const input of [
    { mode: 'unknown' },
    { email: 'bad' },
    { email: Array(6).fill('a@example.test').join(',') },
    { note: 'x'.repeat(1001) },
  ])
    assert.throws(() => parseWebInvoiceRequest(input), { status: 400 });
});

test('Missing accounting metadata is empty; corrupt stored data fails closed', () => {
  assert.deepEqual(readWebAccounting('{}'), { revision: 0 });
  assert.deepEqual(readWebAccounting('{"cart":{"lines":[]}}'), { revision: 0 });
  for (const raw of ['broken', '[]', 'null', '{"accounting":{"revision":-1}}'])
    assert.throws(() => readWebAccounting(raw), { status: 409 });
});

test('Accounting permission mirrors invoice entry roles without granting warehouse or supplier accounts', () => {
  assert.equal(canEditWebAccounting({ role: 'manager' }), true);
  assert.equal(
    canEditWebAccounting({ role: 'employee', positionId: 'accounting' }),
    true,
  );
  assert.equal(
    canEditWebAccounting({ role: 'employee', positionId: 'warehouse' }),
    false,
  );
  assert.equal(canEditWebAccounting({ role: 'supplier' }), false);
});

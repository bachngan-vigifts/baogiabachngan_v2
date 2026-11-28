import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { contractTermsFromQuote, quoteWithContractTerms } from '../../src/modules/sales/domain/contract-quote-terms.ts';
import { syncContractQuoteTerms } from '../../src/modules/sales/api/contract-quote-terms.ts';

const quote = () => ({ paymentTerms: { depositRate: 40, balanceTerm: '12 ngày' }, deliveryDate: '2026-11-06', customerAddress: 'Địa chỉ công ty',
  notes: '- Thời gian giao hàng: Ngày cũ\n- Địa chỉ giao hàng: Kho khách\nTầng 2\n- Thanh toán: Điều khoản cũ\n- Phương thức thanh toán: Chuyển khoản\n- Ghi chú: Đóng gói riêng\nTrân trọng!',
  rows: [{ sku: 'A', qty: 5, price: 100000, costPrice: 50000, discount: 10 }], vat: 8 });
test('resolve source terms, including zero; keep a textual deadline distinct from zero days', () => {
  assert.deepEqual(contractTermsFromQuote(quote()), { depositRate: 40, paymentDays: 12, deliveryTime: 'Giao hàng ngày 06/11/2026', deliveryAddress: 'Kho khách Tầng 2' });
  assert.equal(contractTermsFromQuote({ paymentTerms: { depositRate: 0, balanceTerm: '0' } }).paymentDays, 0);
  assert.equal(contractTermsFromQuote({ paymentTerms: { depositRate: 0, balanceTerm: 'Thanh toán trước khi giao hàng' } }).paymentDays, undefined);
});
test('explicit quotation document fields take precedence, including zero', () => {
  const details = { signedDate: '2026-11-01', depositRate: 0, paymentDays: 0, deliveryTime: 'Sau duyệt mẫu', deliveryAddress: 'Kho B' };
  assert.deepEqual(contractTermsFromQuote({ ...quote(), contractDocument: { details } }), details);
});
test('historical quote reads explicit deposit and days from payment notes without guessing a vague agreement', () => {
  const legacy = contractTermsFromQuote({ notes: '- Thanh toán: Bên A thanh toán 30% giá trị hợp đồng ngay sau khi ký hợp đồng. Thanh toán 70% giá trị còn lại trong vòng 15 ngày kể từ ngày giao hàng.' });
  assert.equal(legacy.depositRate, 30); assert.equal(legacy.paymentDays, 15);
  assert.equal(contractTermsFromQuote({ notes: '- Thanh toán: Theo thỏa thuận' }).depositRate, undefined);
});
test('four fields round trip without changing products, VAT, billing address or other notes', () => {
  const old = quote(), changes = { depositRate: 50, paymentDays: 15, deliveryTime: 'Giao hàng ngày 10/11/2026', deliveryAddress: 'Kho mới' };
  const next = quoteWithContractTerms(old, changes);
  assert.deepEqual(contractTermsFromQuote(next), changes);
  assert.deepEqual(next.rows, old.rows); assert.equal(next.vat, 8); assert.equal(next.customerAddress, old.customerAddress);
  assert.match(next.notes, /Chuyển khoản/); assert.match(next.notes, /Đóng gói riêng/); assert.match(next.notes, /Trân trọng!/);
  assert.doesNotMatch(next.notes, /Tầng 2|Điều khoản cũ/); assert.equal(next.deliveryDate, '2026-11-10');
  assert.deepEqual(quoteWithContractTerms(next, changes), next);
  assert.equal(old.paymentTerms.depositRate, 40);
});
test('editing delivery does not replace textual payment conditions; flexible delivery clears stale date', () => {
  const old = { ...quote(), paymentTerms: { depositRate: 40, balanceTerm: 'Trước khi giao hàng' }, paymentNotesManual: true };
  const next = quoteWithContractTerms(old, { deliveryTime: 'Giao sau khi duyệt mẫu' });
  assert.deepEqual(next.paymentTerms, old.paymentTerms); assert.equal(next.paymentNotesManual, true);
  assert.match(next.notes, /Thanh toán: Điều khoản cũ/); assert.equal(next.deliveryDate, undefined);
  assert.equal(contractTermsFromQuote(next).deliveryTime, 'Giao sau khi duyệt mẫu');
});
test('editor uses live quote terms over stale document details and keeps representative/signing fields', () => {
  const source = readFileSync(new URL('../../trial-ui/contract-ui.js', import.meta.url), 'utf8');
  const ctx: any = {};
  runInNewContext(source.slice(0, source.indexOf('/** Đổi đơn +')).replace(/^import .*;\n/gm,'').replaceAll('export ', '') + '\nthis.resolve = contractDetails', ctx);
  const actual = ctx.resolve({ order: { contact: 'Bà Mai' }, contract: { depositRate: 30, paymentDays: 5, data: { details: { deliveryAddress: 'Cũ', representativeTitle: 'Giám đốc' } }, sourceTerms: contractTermsFromQuote(quote()) } });
  assert.equal(actual.depositRate, 40); assert.equal(actual.paymentDays, 12); assert.equal(actual.deliveryAddress, 'Kho khách Tầng 2');
  assert.equal(actual.representativeName, 'Mai'); assert.equal(actual.representativeTitle, 'Giám đốc');
});
const member = { id: 'manager', role: 'manager', name: 'Manager' } as any;
function store(revision = 3, status = 'approved', race = false) {
  const writes: any[] = [], data = JSON.stringify(quote());
  const q: any = { then: (resolve: any) => Promise.resolve([{ id: 'q', revision, approvalStatus: status, data }]).then(resolve) };
  for (const key of ['from', 'where', 'limit']) q[key] = () => q;
  const tx: any = { select: () => q,
    update: (table: any) => ({ set: (value: any) => { writes.push({ table, value }); return { where: () => ({ returning: async () => race ? [] : [{ id: 'q' }] }) }; } }),
    insert: (table: any) => ({ values: async (value: any) => { writes.push({ table, value }); } }) };
  return { tx, writes };
}
test('reverse sync records quote revision and audit; repeated identical terms do not add history', async () => {
  const s = store();
  assert.equal(await syncContractQuoteTerms(s.tx, 'q', 'k', 3, { depositRate: 60 }, member), 4);
  assert.equal(s.writes.length, 3);
  assert.equal(s.writes[1].value.revision, 3); assert.equal(s.writes[1].value.changedBy, 'manager');
  assert.equal(JSON.parse(s.writes[0].value.data).paymentTerms.depositRate, 60);
  const nochange = store();
  assert.equal(await syncContractQuoteTerms(nochange.tx, 'q', 'k', 3, { depositRate: 40 }, member), 3);
  assert.equal(nochange.writes.length, 0);
});
test('stale/missing revision and unauthorized approved quote edits are rejected; CAS catches racing writer', async () => {
  for (const revision of [undefined, 2]) {
    const s = store();
    await assert.rejects(syncContractQuoteTerms(s.tx, 'q', 'k', revision, { paymentDays: 15 }, member), (e: any) => e.status === 409);
    assert.equal(s.writes.length, 0);
  }
  const denied = store();
  await assert.rejects(syncContractQuoteTerms(denied.tx, 'q', 'k', 3, { paymentDays: 15 }, { ...member, role: 'employee' }), (e: any) => e.status === 403);
  assert.equal(denied.writes.length, 0);
  const race = store(3, 'approved', true);
  await assert.rejects(syncContractQuoteTerms(race.tx, 'q', 'k', 3, { paymentDays: 15 }, member), (e: any) => e.status === 409);
  assert.equal(race.writes.length, 1); // failed CAS; no revision/audit inserted
});

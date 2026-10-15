import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { cleanQuotation } from '../../src/modules/quotes/domain/quotation-schema.ts';
import { publicQuote } from '../../src/modules/portal/domain/portal.ts';
const raw = (extra: object = {}) => ({ type: 'HRC', quoteNo: 'BG-TEST', date: '2026-10-15', customer: 'Khách thử', vat: 8,
  notes: 'Thanh toán trước khi giao hàng', rows: [{ name: 'Ly', qty: 1, price: 100 }], ...extra });
test('quote note survives cleaning and save/reopen; portal omits it while retaining printed terms', () => {
  const data = cleanQuotation(raw({ internalNote: 'Gọi khách trước\n<script>text</script>' }));
  const reopened = cleanQuotation(JSON.parse(JSON.stringify(data)));
  assert.equal(reopened.internalNote, data.internalNote);
  assert.equal(reopened.notes, 'Thanh toán trước khi giao hàng');
  assert.equal(publicQuote(reopened).internalNote, undefined); assert.equal(publicQuote(reopened).notes, reopened.notes);
  assert.equal(data.internalNote, 'Gọi khách trước\n<script>text</script>');
  assert.equal(cleanQuotation(raw()).internalNote, undefined);
  for (const internalNote of ['x'.repeat(3001), 123, null]) assert.throws(() => cleanQuotation(raw({ internalNote })), /không hợp lệ/);
});
test('editor collects internal note separately from printable notes and retains owner phone data', () => {
  const source = readFileSync(new URL('../../trial-ui/app.js', import.meta.url), 'utf8');
  const values: Record<string, string> = { internalNote: 'Nhắn nội bộ', notes: 'Điều kiện thanh toán', owner: 'Người phụ trách', ownerPhone: '0901234567', quoteNo: 'BG-TEST', vat: '8' };
  const ctx: any = { editor: { base: {}, type: 'HRC', rows: [] }, syncPaymentNotes() {}, syncDeliveryNotes() {}, field: (key: string) => ({ value: values[key] || '' }), parseNum: Number };
  runInNewContext(source.slice(source.indexOf('function collectQuote()'), source.indexOf('function validateQuote(')) + '\nglobalThis.collected = collectQuote();', ctx);
  assert.equal(ctx.collected.internalNote, values.internalNote); assert.equal(ctx.collected.notes, values.notes); assert.equal(ctx.collected.ownerPhone, values.ownerPhone);
});

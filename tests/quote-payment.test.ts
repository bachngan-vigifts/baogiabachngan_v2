import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { cleanQuotation } from '../src/modules/quotes/domain/quotation-schema.ts';

const source = readFileSync(new URL('../trial-ui/quote-payment.js', import.meta.url), 'utf8');
const context = vm.createContext({ Intl });
vm.runInContext(source.replace(/export /g, '') + '\nglobalThis.terms = {paymentClause, withPaymentNotes, defaultPaymentTerms};', context);
const terms = context.terms as { paymentClause: (t: object, total: number, words: (v: number) => string) => string;
  withPaymentNotes: (notes: string, t: object, total: number, words: (v: number) => string) => string; defaultPaymentTerms: (type: string) => object };
const words = (v: number) => 'words-' + v;

test('quote payment clause matches existing contract wording for numeric deadlines and 0/100% deposits', () => {
  const docSource = readFileSync(new URL('../trial-ui/contract-document.js', import.meta.url), 'utf8');
  const doc = vm.createContext({ Intl, globalThis: { HrcPdf: { amountInWords: words } } });
  vm.runInContext(docSource.replace('return {build, buildPack, download, paymentDetails,', 'return {paymentClause, build, buildPack, download, paymentDetails,'), doc);
  for (const rate of [0, 30, 50, 100]) for (const days of [0, 15, 30]) {
    const total = 1234567, deposit = Math.round(total * rate / 100);
    const contract = doc.globalThis.ContractDocument.paymentClause({ depositRate: rate, days, deposit, remaining: total - deposit });
    assert.equal(terms.paymentClause({ depositRate: rate, balanceTerm: String(days) }, total, words), contract);
  }
});

test('remaining balance supports pre-delivery and entered text; amounts update without losing unrelated notes', () => {
  const t = { depositRate: 30, balanceTerm: 'Thanh toán trước khi giao hàng' };
  let notes = terms.withPaymentNotes('- Giá có hiệu lực 30 ngày.\n- Bên Mua sẽ tiến hành tạm ứng 30% trị giá hợp đồng.\n- 70% trị giá còn lại của hợp đồng sẽ thanh toán trước khi nhận hàng.\nTrân trọng.', t, 1000000, words);
  assert.ok(notes.includes('30%')); assert.ok(notes.includes('70%'));
  assert.ok(notes.includes('300.000 đồng')); assert.ok(notes.includes('700.000 đồng'));
  assert.ok(notes.includes('trước khi giao hàng.'));
  assert.ok(!notes.includes('Bên Mua'));
  notes = terms.withPaymentNotes(notes, t, 2000000, words);
  assert.ok(notes.includes('600.000 đồng')); assert.ok(notes.includes('1.400.000 đồng'));
  assert.equal(notes.match(/- Thanh toán:/g)?.length, 1);
  assert.ok(notes.startsWith('- Giá có hiệu lực 30 ngày.'));
  assert.ok(notes.endsWith('Trân trọng.'));
  assert.ok(terms.paymentClause({ depositRate: 0, balanceTerm: 'Thanh toán trước khi giao hàng' }, 1000, words).endsWith('trước khi giao hàng.'));
  assert.ok(terms.paymentClause({ depositRate: 50, balanceTerm: 'trong vòng 7 ngày sau khi nghiệm thu' }, 1000, words).endsWith('trong vòng 7 ngày sau khi nghiệm thu.'));
  assert.ok(terms.paymentClause({ depositRate: 30.5, balanceTerm: '15' }, 1000, words).includes('30,5%'));
});

const quote = { type: 'HRC', quoteNo: 'TEST-1', vat: 8, rows: [{ name: 'Ly', qty: 1, price: 1000 }] };
test('quote payment terms persist through validation; invalid rates/days are rejected and old quotes stay unchanged', () => {
  for (const type of ['HRC', 'B2B', 'VIGIFTS']) {
    const paymentTerms = terms.defaultPaymentTerms(type);
    assert.deepEqual(cleanQuotation({ ...quote, type, paymentTerms }).paymentTerms, { ...paymentTerms });
  }
  for (const t of [{ depositRate: -1, balanceTerm: '30' }, { depositRate: 101, balanceTerm: '30' },
    { depositRate: 30, balanceTerm: '' }, { depositRate: 30, balanceTerm: '-1' }, { depositRate: 30, balanceTerm: '3651' }, { depositRate: 30, balanceTerm: '1.5' }]) {
    assert.throws(() => cleanQuotation({ ...quote, paymentTerms: t }));
  }
  const before = { depositRate: 50, balanceTerm: 'Thanh toán trước khi giao hàng' };
  assert.deepEqual(cleanQuotation({ ...quote, paymentTerms: before }).paymentTerms, before);
  assert.equal(cleanQuotation(quote).paymentTerms, undefined);
});

test('new quote popup accepts pre-delivery text, preserves chosen terms, rejects invalid inputs', () => {
  const app = readFileSync(new URL('../trial-ui/app.js', import.meta.url), 'utf8');
  const begin = app.indexOf("$('#new-quote-form').addEventListener('submit',");
  const end = app.indexOf('// ----- đóng thùng', begin);
  for (const type of ['HRC', 'B2B', 'VIGIFTS']) {
    let submit: (e: object) => void = () => {};
    const inputs: Record<string, any> = {
      '#nq-error': { textContent: '' }, '#nq-date': { value: '2026-10-09' }, '#nq-no': { value: 'TEST' },
      '#nq-discount': { value: '' }, '#nq-discount-field': { hidden: false }, '#nq-deposit-rate': { value: '40' },
      '#nq-payment-term': { value: 'Thanh toán trước khi giao hàng' }, '#nq-customer': { value: 'Khách' },
      '#new-quote-form': { addEventListener: (_: string, fn: typeof submit) => { submit = fn; } },
      '#new-quote-dialog': { close() {} },
    };
    const editor: any = {};
    const ctx = vm.createContext({ $: (id: string) => inputs[id], nq: { type, customer: null }, editor,
      parseNum: Number, newQuoteData: (extra: object) => extra, location: { hash: '' }, go() {}, route() {} });
    vm.runInContext(app.slice(begin, end), ctx);
    submit({ preventDefault() {} });
    assert.equal(editor.pending.type, type);
    assert.deepEqual(JSON.parse(JSON.stringify(editor.pending.paymentTerms)), { depositRate: 40, balanceTerm: 'Thanh toán trước khi giao hàng' });
    for (const [rate, deadline] of [['101', '30'], ['', '30'], ['30', ''], ['30', '-1 ngày'], ['30', '3651 ngày']] as const) {
      delete editor.pending;
      inputs['#nq-deposit-rate'].value = rate; inputs['#nq-payment-term'].value = deadline;
      submit({ preventDefault() {} });
      assert.equal(editor.pending, undefined); assert.ok(inputs['#nq-error'].textContent);
    }
  }
});

test('manual payment notes survive editing totals, saving and reopening; automatic notes still recalculate', () => {
  const app = readFileSync(new URL('../trial-ui/app.js', import.meta.url), 'utf8');
  const fields: Record<string, any> = Object.fromEntries(['notes', 'quoteNo', 'date', 'vat', 'customer', 'contact', 'phone', 'email', 'customerTaxCode', 'customerAddress', 'owner', 'ownerPhone', 'deliveryDate', 'internalNote'].map(k => [k, { value: '' }]));
  Object.assign(fields.quoteNo, { value: 'TEST-1' }); fields.vat.value = '8';
  const manual = '- Thanh toán: Cọc 20%, còn lại sau khi nghiệm thu.\n- Gói riêng từng bộ.';
  fields.notes.value = manual;
  const editor: any = { base: { paymentTerms: { depositRate: 30, balanceTerm: '5' } }, type: 'B2B', rows: [{ name: 'Ly', qty: 1, price: 1000 }] };
  let onInput: Function = () => {};
  const ctx = vm.createContext({ editor, field: (k: string) => fields[k], totals: () => ({ total: 2000 }), currentDoc: () => ({}), moneyWords: words,
    withPaymentNotes: terms.withPaymentNotes, parseNum: Number, syncDeliveryNotes() {}, markDirty() {},
    qf: { addEventListener: (_: string, fn: Function) => { onInput = fn; } } });
  const syncStart = app.indexOf('function syncPaymentNotes(');
  vm.runInContext(app.slice(syncStart, app.indexOf('/** Ngày giao', syncStart)), ctx);
  const inputStart = app.indexOf("qf.addEventListener('input',");
  vm.runInContext(app.slice(inputStart, app.indexOf("field('vat').addEventListener", inputStart)), ctx);
  onInput({ target: { name: 'notes' } });
  const collectStart = app.indexOf('function collectQuote()');
  vm.runInContext(app.slice(collectStart, app.indexOf('function validateQuote', collectStart)), ctx);
  const saved = cleanQuotation(vm.runInContext('collectQuote()', ctx));
  assert.equal(saved.notes, manual); assert.equal(saved.paymentNotesManual, true);
  editor.base = JSON.parse(JSON.stringify(saved)); fields.notes.value = saved.notes;
  vm.runInContext('syncPaymentNotes(9000)', ctx);
  assert.equal(fields.notes.value, manual);
  editor.base.paymentNotesManual = false;
  vm.runInContext('syncPaymentNotes(9000)', ctx);
  assert.match(fields.notes.value, /2\.700 đồng/);
  assert.match(fields.notes.value, /Gói riêng từng bộ/);
});

test('manual payment-note preference validates type and preserves legacy quote behavior', () => {
  assert.equal(cleanQuotation({ ...quote, paymentNotesManual: true }).paymentNotesManual, true);
  assert.equal(cleanQuotation({ ...quote, paymentNotesManual: false }).paymentNotesManual, false);
  assert.equal(cleanQuotation(quote).paymentNotesManual, undefined);
  assert.throws(() => cleanQuotation({ ...quote, paymentNotesManual: 'true' }));
});

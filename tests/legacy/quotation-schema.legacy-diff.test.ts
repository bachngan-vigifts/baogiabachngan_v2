/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyAvailable, skipReason, loadLegacyQuotation, loadLegacyDeliveryDate, rng, picker } from './harness.ts';
import { cleanQuotation, validDeliveryDate } from '../../src/modules/quotes/domain/quotation-schema.ts';
import { AppError } from '../../src/core/errors.ts';

const L: any = legacyAvailable ? await loadLegacyQuotation() : null;
const D: any = legacyAvailable ? await loadLegacyDeliveryDate() : null;
const opts = { skip: skipReason, timeout: 120000 };
const UNDEF = Symbol('undefined');

const goodRow = (): any => ({ sku: 'A1', name: 'Nồi', unit: 'cái', brand: 'Minh Long', qty: 2, price: 100000, discount: 10, discountType: 'percent', printFee: 0, taxRate: 8, costPrice: 50000 });
const wordEdit = (i = 1) => ({ index: i, hash: 'a'.repeat(64), text: 'Điều khoản' });
const goodContract = (): any => ({ contractNumber: 'HD-1', quoteNo: 'BG-1', generatedAt: '2026-10-05', details: { name: 'Cty A', taxCode: '0101', depositRate: 30, paymentDays: 15, deliveryDate: '2026-10-30', signedDate: '05/10/2026' } });

function base(r: () => number): any {
  const q: any = { type: 'B2B', quoteNo: 'BG-1', date: '2026-10-05', customer: 'Khách A', customerId: 'c1', vat: 8, notes: 'ghi chú', rows: [goodRow(), { ...goodRow(), sku: 'B2', qty: 1, price: 200000, discount: 0 }] };
  if (r() < 0.4) Object.assign(q, { careStatus: 'active', careDueDate: '2026-10-20', careAssigneeId: 'm1', careNote: 'gọi lại' });
  if (r() < 0.3) q.discountMode = 'amount';
  if (r() < 0.3) q.customerDiscounts = { lock: 58, lys: 10, minhLong: 20 };
  if (r() < 0.3) q.contractDocument = goodContract();
  if (r() < 0.3) q.printing = { workshop: 'Minh Long', totalCost: 60000, workshopExplicit: true };
  if (r() < 0.3) q.shipping = { divisor: 5000, rate: 100, extra: 0, payer: 'sender' };
  if (r() < 0.2) q.deliveryDate = '2026-10-25';
  if (r() < 0.2) q.notesVersion = 2;
  return q;
}

const strs = ['ok', '', '   ', 5, null, true, {}, [], 'x'.repeat(501), 'x'.repeat(4001), 'x'.repeat(20001), UNDEF];
const nums = [0, 1, 99.5, 100, 101, -1, 1e12, 1e12 + 1, '8', '', NaN, Infinity, -Infinity, null, true, [], UNDEF];
const dates = ['2026-10-20', '20/10/2026', '5.1.2026', '2026-10-20T10:00:00Z', '2026-02-31', '31/02/2026', 'abc', '2026-1-5', '', 20261020, null, UNDEF];
const images = ['https://x.vn/a.png', 'HTTPS://X.VN/A', 'http://x.vn/a.png', 'data:image/png;base64,iVBORw0KGgo=', 'data:image/gif;base64,AAAA', 'data:image/png;base64,@@@', 'ftp://x', 'x', '', 'https://' + 'a'.repeat(250001)];
const contractVariants = (): any[] => [
  goodContract(), null, [], 'x', {}, { ...goodContract(), contractNumber: '' }, { ...goodContract(), contractNumber: '  ' }, { ...goodContract(), contractNumber: 5 },
  { ...goodContract(), details: null }, { ...goodContract(), details: [] }, { ...goodContract(), details: { ...goodContract().details, depositRate: 101 } },
  { ...goodContract(), details: { ...goodContract().details, depositRate: '40' } }, { ...goodContract(), details: { ...goodContract().details, paymentDays: 1.5 } },
  { ...goodContract(), details: { ...goodContract().details, paymentDays: 3651 } }, { ...goodContract(), details: { ...goodContract().details, signedDate: '2026-02-31' } },
  { ...goodContract(), details: { ...goodContract().details, deliveryDate: 'abc' } }, { ...goodContract(), details: { ...goodContract().details, name: 'x'.repeat(501) } },
  { ...goodContract(), details: { ...goodContract().details, representativeName: 5 } }, { contractNumber: 'HD', details: { depositRate: 0, paymentDays: 0 } }, { contractNumber: 'HD' },
  { ...goodContract(), wordEdits: [wordEdit()] }, { ...goodContract(), wordEdits: [wordEdit(1), wordEdit(1)] }, { ...goodContract(), wordEdits: [{ ...wordEdit(), hash: 'zz' }] },
  { ...goodContract(), wordEdits: [{ ...wordEdit(), bold: 'yes' }] }, { ...goodContract(), wordEdits: [{ ...wordEdit(), align: 'middle' }] }, { ...goodContract(), wordEdits: [{ ...wordEdit(), align: 'both', bold: true, italic: false, underline: true }] },
  { ...goodContract(), wordEdits: [{ ...wordEdit(), index: -1 }] }, { ...goodContract(), wordEdits: [{ ...wordEdit(), index: 20001 }] }, { ...goodContract(), wordEdits: [{ ...wordEdit(), index: 1.5 }] }, { ...goodContract(), wordEdits: 'x' },
  { ...goodContract(), wordEdits: Array.from({ length: 1001 }, (_, i) => wordEdit(i)) }, { ...goodContract(), wordEdits: [{ ...wordEdit(), text: 'x'.repeat(20001) }] },
  { ...goodContract(), documentEdits: { TAM_UNG: [wordEdit()], BBNT: [] } }, { ...goodContract(), documentEdits: { OTHER: [] } }, { ...goodContract(), documentEdits: [] }, { ...goodContract(), documentEdits: { TAM_UNG: 'x' } }, { ...goodContract(), documentEdits: null },
];
const mutations: [(string | number)[], () => unknown[]][] = [
  [['type'], () => ['HRC', 'B2B', 'VIGIFTS', 'OTHER', 5, null, UNDEF]],
  [['quoteNo'], () => ['BG-2', '', '  ', 5, null, 'x'.repeat(501), UNDEF]],
  [['customer'], () => strs], [['date'], () => strs], [['customerId'], () => strs], [['customerTaxCode'], () => strs], [['customerCode'], () => strs], [['customerAddress'], () => strs],
  [['contact'], () => strs], [['phone'], () => strs], [['email'], () => strs], [['owner'], () => strs], [['ownerPhone'], () => strs], [['notes'], () => strs],
  [['vat'], () => nums], [['deliveryDate'], () => dates], [['delivery_date'], () => dates], [['notesVersion'], () => [2, 1, '2', null, UNDEF]],
  [['careStatus'], () => ['', 'active', 'closed', 'lost', 'x', 5, null, UNDEF]], [['careDueDate'], () => ['2026-10-20', 'x', '2026-1-5', '', 5, null, UNDEF]],
  [['careAssigneeId'], () => ['m1', 5, 'x'.repeat(81), null, UNDEF]], [['careNote'], () => ['ok', 5, 'x'.repeat(3001), null, UNDEF]], [['careClosedAt'], () => ['2026-10-01T00:00:00Z', 5, 'x'.repeat(81), UNDEF]],
  [['discountMode'], () => ['percent', 'amount', 'x', 5, null, UNDEF]],
  [['customerDiscounts'], () => [{ lock: 58 }, { lock: 101 }, { lys: '5' }, { minhLong: null }, { minhLong: -1, lys: 1 }, [], null, 'x', {}, UNDEF]],
  [['contractDocument'], contractVariants],
  [['printing'], () => [{ workshop: 'A', totalCost: 5, workshopExplicit: true }, { totalCost: -1 }, { workshop: 5 }, { workshop: 'x'.repeat(181) }, { totalCost: 1e12 + 1 }, {}, [], null, 'x', UNDEF]],
  [['shipping'], () => [{ divisor: 5000, rate: 1, extra: 2, payer: 'sender' }, { divisor: 0 }, { divisor: 0.5 }, { divisor: 'x' }, { payer: 'x' }, { payer: 'receiver' }, { rate: -1 }, { extra: NaN }, {}, [], null, 'x', UNDEF]],
  [['rows'], () => [[], [goodRow()], Array.from({ length: 300 }, goodRow), Array.from({ length: 301 }, goodRow), [null], [5], ['x'], [goodRow(), null], 'x', {}, null, UNDEF]],
  ...(['qty', 'price', 'discount', 'printFee', 'perCarton', 'cartonWeight', 'cartonLength', 'cartonWidth', 'cartonHeight', 'purchaseDiscount', 'costPrice', 'taxRate'] as const).map(f => [['rows', 0, f], () => nums] as [(string | number)[], () => unknown[]]),
  ...(['sku', 'name', 'unit', 'brand', 'pattern', 'bundleContents', 'packagingDescription', 'printDescription', 'pricePolicy', 'status', 'productStatus'] as const).map(f => [['rows', 0, f], () => strs] as [(string | number)[], () => unknown[]]),
  [['rows', 0, 'image'], () => images], [['rows', 1, 'image'], () => images],
  [['rows', 0, 'discountType'], () => ['percent', 'amount', 'x', 5, null, '', UNDEF]],
  [['rows', 0, 'deliveryDate'], () => dates], [['rows', 0, 'delivery_date'], () => dates],
  [['rows', 0, 'printing'], () => [{ workshop: 'A', unitPrice: 5 }, { unitPrice: -1 }, { workshop: 5 }, { unitPrice: NaN }, {}, [], null, 'x', UNDEF]],
  [['rows', 1, 'qty'], () => nums], [['rows', 1, 'price'], () => nums], [['rows', 1, 'discount'], () => nums],
];

function setPath(root: any, path: (string | number)[], value: unknown) {
  let o = root;
  for (let i = 0; i < path.length - 1; i++) { if (o == null || typeof o !== 'object') return; o = o[path[i]!]; }
  if (o == null || typeof o !== 'object') return;
  if (value === UNDEF) delete o[path.at(-1)!]; else o[path.at(-1)!] = value;
}

const norm = (v: any, inputHadClosedAt: boolean) => {
  const c = JSON.parse(JSON.stringify(v)); // bỏ undefined như khi lưu
  for (const r of c.rows ?? []) r.id = '<ID>';
  if (!inputHadClosedAt && typeof c.careClosedAt === 'string') c.careClosedAt = '<NOW>';
  return c;
};
const run = (fn: () => any) => { try { return { ok: true as const, value: fn() }; } catch (e: any) { return { ok: false as const, status: e.status, message: e.message, isApp: e instanceof AppError || e?.constructor?.name === 'QuotationError' }; } };

test('KIỂM TRA BÁO GIÁ ↔ bản cũ: cùng nhận/từ chối, cùng mã lỗi và thông báo, cùng dữ liệu đã làm sạch (6.000 báo giá ngẫu nhiên)', opts, () => {
  const r = rng(808), pick = picker(r);
  let accepted = 0; const messages = new Set<string>();
  for (let i = 0; i < 6000; i++) {
    const input = base(r);
    for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k++) { const [path, values] = pick(mutations); setPath(input, path, pick(values())); }
    const maxBytes = r() < 0.05 ? 3000 : 800000;
    const hadClosed = input.careClosedAt !== undefined;
    const legacy = run(() => L.validateQuotation(structuredClone(input), maxBytes));
    const mine = run(() => cleanQuotation(structuredClone(input), { maxBytes }));
    const ctx = `#${i} ${JSON.stringify(input).slice(0, 400)}`;
    assert.equal(mine.ok, legacy.ok, `${ctx}: ${mine.ok ? 'bản mới nhận, bản cũ từ chối: ' + (legacy as any).message : 'bản mới từ chối: ' + (mine as any).message}`);
    // Intentional safety change: missing expense/payer stays missing in drafts, never auto-filled as zero/customer-paid.
    if(legacy.ok&&mine.ok){
      if(input.shipping?.payer==null&&legacy.value.shipping)delete legacy.value.shipping.payer;
      if(input.printing?.totalCost==null&&legacy.value.printing)delete legacy.value.printing.totalCost;
      for(let j=0;j<(input.rows||[]).length;j++)if(input.rows[j]?.printing?.unitPrice==null&&legacy.value.rows[j]?.printing)delete legacy.value.rows[j].printing.unitPrice;
    }
    if (legacy.ok && mine.ok) { accepted++; assert.deepStrictEqual(norm(mine.value, hadClosed), norm(legacy.value, hadClosed), ctx); }
    else if (!legacy.ok && !mine.ok) { messages.add(legacy.message); assert.deepStrictEqual({ status: mine.status, message: mine.message }, { status: legacy.status, message: legacy.message }, ctx); }
  }
  assert.ok(accepted > 600 && accepted < 5400, `phân bố nhận/từ chối lệch: nhận ${accepted}/6000`);
  assert.ok(messages.size >= 25, `chỉ chạm ${messages.size} loại lỗi khác nhau: ${[...messages].join(' | ')}`);
});

test('NGÀY GIAO ↔ bản cũ: cùng kết quả trên mọi định dạng (hợp lệ, lịch sai, rác)', opts, () => {
  const r = rng(909), pick = picker(r);
  const parts = () => [String(1990 + Math.floor(r() * 80)), String(Math.floor(r() * 14)).padStart(2, '0'), String(Math.floor(r() * 34)).padStart(2, '0')];
  const samples: unknown[] = ['2024-02-29', '2023-02-29', '2026-04-31', '31/12/2026', '1/1/2026', '01.02.2026', '2026-10-20T10:00:00Z', ' 2026-10-20 ', '2026/10/20', '20-10-2026', '', null, undefined, 0, 20261020, 'abc', '0000-00-00', '9999-12-31', '2026-13-01'];
  for (let i = 0; i < 4000; i++) { const [y, m, d] = parts(); samples.push(pick([`${y}-${m}-${d}`, `${d}/${m}/${y}`, `${Number(d)}.${Number(m)}.${y}`, `${y}-${m}-${d}T00:00`])); }
  for (const s of samples) assert.equal(validDeliveryDate(s), D.validDeliveryDate(s), JSON.stringify(s));
});

test('GIỚI HẠN KÍCH THƯỚC ↔ bản cũ: đúng ngưỡng từng byte (dưới/bằng/trên) cho cùng một báo giá', opts, () => {
  const input = { ...base(rng(1)), notes: 'ghi chú ' + 'x'.repeat(3000) };
  const size = new TextEncoder().encode(JSON.stringify(L.validateQuotation(structuredClone(input), 1e9))).length;
  for (const maxBytes of [size - 100, size - 1, size, size + 1, size + 100]) {
    const legacy = run(() => L.validateQuotation(structuredClone(input), maxBytes)), mine = run(() => cleanQuotation(structuredClone(input), { maxBytes }));
    assert.equal(mine.ok, legacy.ok, `maxBytes=${maxBytes} (kích thước thật ${size})`);
    if (!legacy.ok && !mine.ok) assert.deepStrictEqual({ status: mine.status, message: mine.message }, { status: legacy.status, message: legacy.message });
  }
  assert.equal(run(() => cleanQuotation(structuredClone(input), { maxBytes: size })).ok, true);   // bằng ngưỡng: được
  const over = run(() => cleanQuotation(structuredClone(input), { maxBytes: size - 1 }));          // vượt 1 byte: bị từ chối 413
  assert.deepEqual([over.ok, (over as any).status], [false, 413]);
  // chữ Việt nhiều byte: giới hạn tính theo BYTE chứ không theo số ký tự
  const vn = { ...base(rng(2)), notes: 'đ'.repeat(3000) }; const vnSize = new TextEncoder().encode(JSON.stringify(L.validateQuotation(structuredClone(vn), 1e9))).length;
  assert.equal(run(() => cleanQuotation(structuredClone(vn), { maxBytes: vnSize })).ok, true);
  assert.equal(run(() => cleanQuotation(structuredClone(vn), { maxBytes: vnSize - 1 })).ok, false);
});

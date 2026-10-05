import { AppError } from '../../../core/errors.ts';

/*
 * Kiểm tra và làm sạch báo giá trước khi lưu. Port NGUYÊN VĂN logic của `validateQuotation` bản cũ
 * (lib/quotation-store.mjs): cùng thứ tự kiểm tra, cùng mã lỗi và thông báo – `tests/legacy/quotation-schema.legacy-diff.test.ts`
 * chạy hàm cũ và hàm này trên hàng nghìn dữ liệu ngẫu nhiên. Hàm thuần: không đọc DB.
 * Đây là hàng rào chặn dữ liệu rác (NaN, chuỗi thay số, âm, quá lớn) TRƯỚC khi vào `quote-math`, vốn không tự làm sạch.
 */
const bad = (message: string, status = 400) => new AppError(status, message);
type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Ngày giao hợp lệ THẬT, nhận ISO (có thể kèm giờ) hoặc d/m/yyyy, d.m.yyyy; trả ISO hoặc '' nếu sai. */
export function validDeliveryDate(value: unknown): string {
  const s = String(value || '').trim();
  const iso8601 = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  const vn = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  const m = iso8601 ?? (vn ? [vn[0], vn[3]!, vn[2]!, vn[1]!] : null);
  if (!m) return '';
  const iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0, 10) === iso ? iso : '';
}

export interface WordEdit { index: number; hash: string; text: string; bold?: boolean; italic?: boolean; underline?: boolean; align?: 'left' | 'center' | 'right' | 'both' }
export function cleanWordEdits(value: unknown = []): WordEdit[] {
  if (!Array.isArray(value) || value.length > 1000 || JSON.stringify(value).length > 300000) throw bad('Nội dung chỉnh Word quá lớn.');
  const seen = new Set<number>();
  return value.map((e: Obj) => {
    if (!e || !Number.isInteger(e.index) || e.index < 0 || e.index > 20000 || seen.has(e.index) || !/^[a-f0-9]{64}$/.test(e.hash) || typeof e.text !== 'string' || e.text.length > 20000) throw bad('Đoạn chỉnh Word không hợp lệ.');
    seen.add(e.index);
    const result: Obj = { index: e.index, hash: e.hash, text: e.text };
    for (const k of ['bold', 'italic', 'underline']) if (e[k] !== undefined) { if (typeof e[k] !== 'boolean') throw bad('Định dạng Word không hợp lệ.'); result[k] = e[k]; }
    if (e.align !== undefined) { if (!['left', 'center', 'right', 'both'].includes(e.align)) throw bad('Căn lề Word không hợp lệ.'); result.align = e.align; }
    return result as WordEdit;
  });
}
export function cleanDocumentEdits(value: unknown = {}): Record<string, WordEdit[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['TAM_UNG', 'BBNT'].includes(k))) throw bad('Loại hồ sơ chỉnh sửa không hợp lệ.');
  return Object.fromEntries(Object.entries(value).map(([key, edits]) => [key, cleanWordEdits(edits)]));
}

const CARE_STATUSES = new Set(['', 'active', 'closed', 'lost']);

export interface CleanOptions { maxBytes?: number; newId?: () => string; nowIso?: () => string }

/** Trả về báo giá đã làm sạch (mỗi dòng có `id` mới). Ném AppError(400/413) với thông báo tiếng Việt như bản cũ. */
export function cleanQuotation(input: unknown, opts: CleanOptions = {}): Obj {
  const maxBytes = opts.maxBytes ?? 800000, newId = opts.newId ?? (() => crypto.randomUUID()), nowIso = opts.nowIso ?? (() => new Date().toISOString());
  const inp = input as Obj;
  if (!inp || typeof inp !== 'object' || !['HRC', 'B2B', 'VIGIFTS'].includes(inp.type) || !Array.isArray(inp.rows) || inp.rows.length > 300) throw bad('Báo giá không hợp lệ hoặc quá 300 dòng.');
  if (inp.rows.length < 1) throw bad('Vui lòng chọn ít nhất 1 sản phẩm trước khi lưu báo giá.');
  const text = (value: unknown, max: number): string => { if (typeof value !== 'string' || value.length > max) throw bad('Nội dung báo giá không hợp lệ.'); return value; };
  const number = (value: unknown, max: number): number => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw bad('Số liệu báo giá không hợp lệ.'); return value; };
  const result: Obj = { type: inp.type };
  for (const key of ['quoteNo', 'date', 'customer', 'customerId', 'customerTaxCode', 'customerCode', 'customerAddress', 'contact', 'phone', 'email', 'owner', 'ownerPhone', 'notes']) result[key] = text(inp[key] ?? '', key === 'notes' ? 20000 : 500);
  if (!result.quoteNo.trim()) throw bad('Vui lòng nhập số báo giá.');
  for (const key of ['deliveryDate', 'delivery_date']) if (inp[key]) { const d = validDeliveryDate(inp[key]); if (!d) throw bad('Ngày giao không hợp lệ.'); result[key] = d; }
  if (inp.notesVersion === 2) result.notesVersion = 2;
  if (inp.careStatus !== undefined || inp.careDueDate !== undefined || inp.careAssigneeId !== undefined || inp.careNote !== undefined) {
    const careStatus = text(inp.careStatus ?? '', 20);
    if (!CARE_STATUSES.has(careStatus)) throw bad('Trạng thái chăm sóc khách hàng không hợp lệ.');
    const careDueDate = text(inp.careDueDate ?? '', 20);
    if (careDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(careDueDate)) throw bad('Ngày nhắc chăm sóc không hợp lệ.');
    if (careStatus) result.careStatus = careStatus;
    if (careDueDate && careStatus === 'active') result.careDueDate = careDueDate;
    if (inp.careAssigneeId !== undefined) result.careAssigneeId = text(inp.careAssigneeId ?? '', 80);
    if (inp.careNote !== undefined) result.careNote = text(inp.careNote ?? '', 3000);
    if (['closed', 'lost'].includes(careStatus)) { result.careClosedAt = text(inp.careClosedAt ?? nowIso(), 80); result.careDueDate = ''; }
  }
  if (inp.discountMode !== undefined) { if (!['percent', 'amount'].includes(inp.discountMode)) throw bad('Loại chiết khấu không hợp lệ.'); result.discountMode = inp.discountMode; }
  if (inp.customerDiscounts !== undefined) {
    if (!isObj(inp.customerDiscounts)) throw bad('Chiết khấu khách hàng không hợp lệ.');
    result.customerDiscounts = {};
    for (const key of ['minhLong', 'lys', 'lock']) if (inp.customerDiscounts[key] !== undefined && inp.customerDiscounts[key] !== null) result.customerDiscounts[key] = number(inp.customerDiscounts[key], 100);
  }
  if (inp.contractDocument !== undefined) {
    if (!isObj(inp.contractDocument)) throw bad('Dữ liệu HĐKT không hợp lệ.');
    const detailsIn = inp.contractDocument.details || {}, details: Obj = {};
    if (!detailsIn || typeof detailsIn !== 'object' || Array.isArray(detailsIn)) throw bad('Thông tin HĐKT không hợp lệ.');
    for (const [key, max] of Object.entries({ name: 500, customerCode: 100, taxCode: 100, representativeName: 500, representativeTitle: 300, address: 2000, deliveryAddress: 2000, deliveryTime: 2000, paymentMethod: 1000, legalEntity: 100, collectionAccountName: 300 })) details[key] = text(detailsIn[key] ?? '', max);
    const depositRate = Number(detailsIn.depositRate), paymentDays = Number(detailsIn.paymentDays);
    if (!Number.isFinite(depositRate) || depositRate < 0 || depositRate > 100) throw bad('Tỷ lệ thanh toán HĐKT không hợp lệ.');
    if (!Number.isInteger(paymentDays) || paymentDays < 0 || paymentDays > 3650) throw bad('Hạn thanh toán HĐKT không hợp lệ.');
    for (const key of ['deliveryDate', 'signedDate', 'depositReceivedDate']) if (detailsIn[key]) { const d = validDeliveryDate(detailsIn[key]); if (!d) throw bad('Ngày hợp đồng không hợp lệ.'); details[key] = d; }
    details.depositRate = depositRate; details.paymentDays = paymentDays;
    result.contractDocument = { contractNumber: text(inp.contractDocument.contractNumber ?? '', 200), quoteNo: text(inp.contractDocument.quoteNo ?? inp.quoteNo ?? '', 200), generatedAt: text(inp.contractDocument.generatedAt ?? '', 80), details };
    if (inp.contractDocument.wordEdits !== undefined) result.contractDocument.wordEdits = cleanWordEdits(inp.contractDocument.wordEdits);
    if (inp.contractDocument.documentEdits !== undefined) result.contractDocument.documentEdits = cleanDocumentEdits(inp.contractDocument.documentEdits);
    if (!result.contractDocument.contractNumber.trim()) throw bad('Thiếu số HĐKT.');
  }
  if (inp.printing !== undefined) {
    if (!isObj(inp.printing)) throw bad('Chi phí in gia công không hợp lệ.');
    result.printing = { workshop: text(inp.printing.workshop ?? '', 180), totalCost: number(inp.printing.totalCost ?? 0, 1e12), workshopExplicit: inp.printing.workshopExplicit === true };
  }
  result.vat = number(inp.vat, 100);
  if (inp.shipping !== undefined) {
    result.shipping = {};
    for (const k of ['divisor', 'rate', 'extra']) result.shipping[k] = number(inp.shipping?.[k] ?? (k === 'divisor' ? 5000 : 0), 1e12);
    const payer = inp.shipping?.payer ?? 'receiver';
    if (!['sender', 'receiver'].includes(payer)) throw bad('Bên thanh toán cước không hợp lệ.');
    result.shipping.payer = payer;
    if (result.shipping.divisor < 1) throw bad('Hệ số quy đổi phải từ 1 trở lên.');
  }
  result.rows = inp.rows.map((row: Obj) => {
    if (!row || typeof row !== 'object') throw bad('Dòng sản phẩm không hợp lệ.');
    const clean: Obj = { id: newId() };
    for (const key of ['sku', 'name', 'unit', 'brand', 'pattern', 'image']) clean[key] = text(row[key] ?? '', key === 'image' ? 250000 : 4000);
    if (clean.image && !/^https:\/\//i.test(clean.image) && !/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(clean.image)) throw bad('Hình ảnh phải dùng HTTPS hoặc ảnh JPEG, PNG, WebP.');
    for (const key of ['qty', 'price', 'discount', 'printFee', 'perCarton', 'cartonWeight', 'cartonLength', 'cartonWidth', 'cartonHeight']) clean[key] = number(row[key] ?? 0, key === 'discount' ? (row.discountType === 'amount' ? Number(row.price || 0) : 100) : 1e12);
    if (row.purchaseDiscount !== undefined && row.purchaseDiscount !== null) clean.purchaseDiscount = number(row.purchaseDiscount, 100);
    if (row.costPrice !== undefined) clean.costPrice = number(row.costPrice, 1e12);
    if (row.printing !== undefined) {
      if (!row.printing || typeof row.printing !== 'object' || Array.isArray(row.printing)) throw bad('Phí in gia công không hợp lệ.');
      clean.printing = { workshop: text(row.printing.workshop ?? '', 180), unitPrice: number(row.printing.unitPrice ?? 0, 1e12), workshopExplicit: row.printing.workshopExplicit === true };
    }
    if (row.discountType !== undefined && !['percent', 'amount'].includes(row.discountType)) throw bad('Loại chiết khấu không hợp lệ.');
    clean.discountType = row.discountType || 'percent';
    if (row.taxRate !== undefined && row.taxRate !== null) clean.taxRate = number(row.taxRate, 100);
    if (row.bundleContents !== undefined) clean.bundleContents = text(row.bundleContents, 2000);
    if (row.packagingDescription !== undefined) clean.packagingDescription = text(row.packagingDescription, 2000);
    if (row.printDescription !== undefined) clean.printDescription = text(row.printDescription, 2000);
    if (row.pricePolicy !== undefined) clean.pricePolicy = text(row.pricePolicy, 200);
    for (const key of ['deliveryDate', 'delivery_date']) if (row[key]) { const d = validDeliveryDate(row[key]); if (!d) throw bad('Ngày giao sản phẩm không hợp lệ.'); clean[key] = d; }
    for (const key of ['status', 'productStatus']) if (row[key] !== undefined) clean[key] = text(row[key], 120);
    return clean;
  });
  // Tài liệu JSON có giới hạn kích thước để dòng D1 không phình to; ảnh tải lên lớn phải dùng R2/Drive.
  if (new TextEncoder().encode(JSON.stringify(result)).length > maxBytes) throw bad('Báo giá có quá nhiều ảnh tải lên. Vui lòng dùng đường dẫn ảnh Drive.', 413);
  return result;
}

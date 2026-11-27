import { AppError } from '../../../core/errors.ts';
import { purchasePrice } from './quote-math.ts';
import { assertSaleTemplate } from './sale-template.ts';

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

export interface WordRun { text:string;bold?:boolean;italic?:boolean;underline?:boolean;strike?:boolean;fontFamily?:string;fontSize?:number;color?:string }
export interface WordEdit extends WordRun { index:number;hash:string;align?:'left'|'center'|'right'|'both';runs?:WordRun[];lineSpacing?:number;indent?:number;list?:'none'|'bullet'|'decimal' }
function cleanWordFormat(e:Obj):Obj{
  const result:Obj={};
  for(const k of ['bold','italic','underline','strike'])if(e[k]!==undefined){if(typeof e[k]!=='boolean')throw bad('Định dạng Word không hợp lệ.');result[k]=e[k];}
  if(e.fontFamily!==undefined){if(!['Times New Roman','Arial','Calibri','Tahoma'].includes(e.fontFamily))throw bad('Phông chữ Word không hợp lệ.');result.fontFamily=e.fontFamily;}
  if(e.fontSize!==undefined){if(typeof e.fontSize!=='number'||!Number.isFinite(e.fontSize)||e.fontSize<6||e.fontSize>72||!Number.isInteger(e.fontSize*2))throw bad('Cỡ chữ Word phải từ 6 đến 72 pt.');result.fontSize=e.fontSize;}
  if(e.color!==undefined){if(typeof e.color!=='string'||!/^([A-Fa-f0-9]{6})$/.test(e.color))throw bad('Màu chữ Word không hợp lệ.');result.color=e.color.toUpperCase();}
  return result;
}
export function cleanWordEdits(value: unknown = []): WordEdit[] {
  if (!Array.isArray(value) || value.length > 1000 || JSON.stringify(value).length > 300000) throw bad('Nội dung chỉnh Word quá lớn.');
  const seen = new Set<number>();
  return value.map((e: Obj) => {
    if (!e || !Number.isInteger(e.index) || e.index < 0 || e.index > 20000 || seen.has(e.index) || !/^[a-f0-9]{64}$/.test(e.hash) || typeof e.text !== 'string' || e.text.length > 20000) throw bad('Đoạn chỉnh Word không hợp lệ.');
    seen.add(e.index);
    const result: Obj = { index: e.index, hash: e.hash, text: e.text,...cleanWordFormat(e) };
    if(e.runs!==undefined){
      if(!Array.isArray(e.runs)||e.runs.length>2000)throw bad('Quá nhiều phần định dạng trong đoạn Word.');
      const runs=e.runs.map((r:unknown)=>{if(!isObj(r)||typeof r.text!=='string'||r.text.length>20000)throw bad('Nội dung chữ Word không hợp lệ.');return {text:r.text,...cleanWordFormat(r)};});
      if(runs.map((r:Obj)=>r.text).join('')!==e.text)throw bad('Định dạng chữ không khớp nội dung đoạn Word.');result.runs=runs;
    }
    for(const [key,values]of [['lineSpacing',[1,1.15,1.5,2]],['indent',[0,360,720,1080,1440]],['list',['none','bullet','decimal']]] as const)if(e[key]!==undefined){if(!(values as readonly unknown[]).includes(e[key]))throw bad('Định dạng đoạn Word không hợp lệ.');result[key]=e[key];}
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
  if (inp.template !== undefined) {
    if (inp.template !== 'sale') throw bad('Mẫu báo giá không hợp lệ.');
    result.template = 'sale';
  }
  for (const key of ['quoteNo', 'date', 'customer', 'customerId', 'customerTaxCode', 'customerCode', 'customerAddress', 'contact', 'phone', 'email', 'owner', 'ownerPhone', 'notes']) result[key] = text(inp[key] ?? '', key === 'notes' ? 20000 : 500);
  if (inp.internalNote !== undefined) result.internalNote = text(inp.internalNote, 3000);
  if (!result.quoteNo.trim()) throw bad('Vui lòng nhập số báo giá.');
  for (const key of ['deliveryDate', 'delivery_date']) if (inp[key]) { const d = validDeliveryDate(inp[key]); if (!d) throw bad('Ngày giao không hợp lệ.'); result[key] = d; }
  if (inp.paymentTerms !== undefined) {
    if (!isObj(inp.paymentTerms)) throw bad('Điều khoản thanh toán báo giá không hợp lệ.');
    const depositRate = number(inp.paymentTerms.depositRate, 100);
    const balanceTerm = text(inp.paymentTerms.balanceTerm ?? '', 500).trim();
    if (depositRate < 100 && !balanceTerm) throw bad('Thiếu thời hạn thanh toán phần còn lại.');
    if (/^[+-]?\d+(?:[.,]\d+)?\s*(?:ngày)?$/i.test(balanceTerm) && (!/^\d+\s*(?:ngày)?$/i.test(balanceTerm) || parseInt(balanceTerm, 10) > 3650)) throw bad('Số ngày thanh toán phải từ 0 đến 3650.');
    result.paymentTerms = { depositRate, balanceTerm };
  }
  if (inp.paymentNotesManual !== undefined) {
    if (typeof inp.paymentNotesManual !== 'boolean') throw bad('Chế độ ghi chú thanh toán không hợp lệ.');
    result.paymentNotesManual = inp.paymentNotesManual;
  }
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
    result.printing = { workshop: text(inp.printing.workshop ?? '', 180), ...(inp.printing.totalCost!=null?{totalCost:number(inp.printing.totalCost,1e12)}:{}), workshopExplicit: inp.printing.workshopExplicit === true };
  }
  result.vat = number(inp.vat, 100);
  if (inp.shipping !== undefined) {
    result.shipping = {};
    for (const k of ['divisor', 'rate', 'extra']) result.shipping[k] = number(inp.shipping?.[k] ?? (k === 'divisor' ? 5000 : 0), 1e12);
    const payer = inp.shipping?.payer;
    if (payer!=null&&!['sender', 'receiver'].includes(payer)) throw bad('Bên thanh toán cước không hợp lệ.');
    if(payer!=null)result.shipping.payer=payer;
    if(inp.shipping?.cost!==undefined)result.shipping.cost=number(inp.shipping.cost,1e12);
    if (result.shipping.divisor < 1) throw bad('Hệ số quy đổi phải từ 1 trở lên.');
  }
  result.rows = inp.rows.map((row: Obj) => {
    if (!row || typeof row !== 'object') throw bad('Dòng sản phẩm không hợp lệ.');
    const clean: Obj = { id: newId() };
    if (row.manualLine === true) clean.manualLine = true;
    if (row.manualDescription !== undefined) clean.manualDescription = text(row.manualDescription, 2000);
    for (const key of ['sku', 'name', 'unit', 'brand', 'pattern', 'image']) clean[key] = text(row[key] ?? '', key === 'image' ? 250000 : 4000);
    if (clean.image && !/^https:\/\//i.test(clean.image) && !/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(clean.image)) throw bad('Hình ảnh phải dùng HTTPS hoặc ảnh JPEG, PNG, WebP.');
    if (row.designImage === true) clean.designImage = true;
    if (row.designImageKey !== undefined) {
      clean.designImageKey = text(row.designImageKey, 250);
      if (!/^quote-designs\/[\w-]+\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/.test(clean.designImageKey)) throw bad('Khoá ảnh thiết kế không hợp lệ.');
      clean.image = ''; // Signed URLs are response-only and must never be persisted.
    }
    for (const key of ['qty', 'price', 'discount', 'printFee', 'perCarton', 'cartonWeight', 'cartonLength', 'cartonWidth', 'cartonHeight']) clean[key] = number(row[key] ?? 0, key === 'discount' ? (row.discountType === 'amount' ? Number(row.price || 0) : 100) : 1e12);
    if (row.purchaseDiscount !== undefined && row.purchaseDiscount !== null) clean.purchaseDiscount = number(row.purchaseDiscount, 100);
    if (row.supplierInfo !== undefined) clean.supplierInfo = text(row.supplierInfo, 2000);
    if (row.costPrice !== undefined) clean.costPrice = number(row.costPrice, 1e12);
    if (row.costMode !== undefined) {
      if (row.costMode !== 'manual' && row.costMode !== 'discount') throw bad('Cách nhập giá vốn không hợp lệ.');
      clean.costMode = row.costMode;
      if (row.costMode === 'manual') delete clean.purchaseDiscount;
      else if (clean.purchaseDiscount !== undefined) clean.costPrice = purchasePrice(clean.price, clean.purchaseDiscount);
      else delete clean.costPrice;
    }
    if (row.printing !== undefined) {
      if (!row.printing || typeof row.printing !== 'object' || Array.isArray(row.printing)) throw bad('Phí in gia công không hợp lệ.');
      clean.printing = { workshop: text(row.printing.workshop ?? '', 180), ...(row.printing.unitPrice!=null?{unitPrice:number(row.printing.unitPrice,1e12)}:{}), workshopExplicit: row.printing.workshopExplicit === true };
    }
    if (row.commission !== undefined && row.commission !== null) {
      const c = row.commission;
      if (typeof c !== 'object' || Array.isArray(c) || (c.mode !== undefined && !['percent', 'amount'].includes(c.mode))) throw bad('CK cho khách không hợp lệ.');
      if(c.value == null || c.value === '' || typeof c.value !== 'number' || !Number.isFinite(c.value)) throw bad('Nhập CK cho khách; không có CK thì nhập 0.');
      const mode = c.mode === 'amount' ? 'amount' : 'percent';
      clean.commission = { mode, value: number(c.value ?? 0, mode === 'percent' ? 100 : 1e12), excluded: c.excluded === true };
    }
    if (row.discountType !== undefined && !['percent', 'amount'].includes(row.discountType)) throw bad('Loại chiết khấu không hợp lệ.');
    clean.discountType = row.discountType || 'percent';
    if (row.taxRate !== undefined && row.taxRate !== null) clean.taxRate = number(row.taxRate, 100);
    for (const key of ['materialDescription','brandDescription','volumeDescription']) if (row[key] !== undefined) clean[key] = text(row[key], 2000);
    if (row.bundleContents !== undefined) clean.bundleContents = text(row.bundleContents, 2000);
    if (row.packagingDescription !== undefined) clean.packagingDescription = text(row.packagingDescription, 2000);
    if (row.printDescription !== undefined) clean.printDescription = text(row.printDescription, 2000);
    if (row.pricePolicy !== undefined) clean.pricePolicy = text(row.pricePolicy, 200);
    for (const key of ['deliveryDate', 'delivery_date']) if (row[key]) { const d = validDeliveryDate(row[key]); if (!d) throw bad('Ngày giao sản phẩm không hợp lệ.'); clean[key] = d; }
    for (const key of ['status', 'productStatus']) if (row[key] !== undefined) clean[key] = text(row[key], 120);
    return clean;
  });
  assertSaleTemplate(result, false); // Incomplete designs may be saved as drafts; submit/approve enforce completeness.
  // Tài liệu JSON có giới hạn kích thước để dòng D1 không phình to; ảnh tải lên lớn phải dùng R2/Drive.
  if (new TextEncoder().encode(JSON.stringify(result)).length > maxBytes) throw bad('Báo giá có quá nhiều ảnh tải lên. Vui lòng dùng đường dẫn ảnh Drive.', 413);
  return result;
}

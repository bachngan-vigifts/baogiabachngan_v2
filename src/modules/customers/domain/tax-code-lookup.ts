/**
 * Mã số thuế (MST) Việt Nam – hàm thuần:
 *  - 10 số (doanh nghiệp / cá nhân) hoặc 10 số + "-" + 3 số (chi nhánh, VPĐD); số thứ 10 là số kiểm tra
 *    (trọng số 31,29,23,19,17,13,7,5,3; số kiểm tra = 10 − tổng mod 11). Bắt lỗi gõ nhầm trước khi tra cứu.
 *  - Lấy MST từ chữ / link trang tra cứu (masothue.com/0101243150-cong-ty-…, …/0101243150-001, ?mst=…).
 */
const WEIGHTS = [31, 29, 23, 19, 17, 13, 7, 5, 3];

export function taxCodeCheckDigitOk(ten: string): boolean {
  if (!/^\d{10}$/.test(ten)) return false;
  const sum = WEIGHTS.reduce((n, w, i) => n + w * Number(ten[i]), 0), check = 10 - (sum % 11);
  return check < 10 && check === Number(ten[9]);
}

/** Chuẩn hoá: bỏ khoảng trắng / dấu chấm, giữ "-" chi nhánh. Trả '' nếu không đúng dạng. */
export function normalizeTaxCode(raw: string): string {
  const s = String(raw ?? '').replace(/[\s.]/g, '');
  const m = /^(\d{10})(?:-?(\d{3}))?$/.exec(s);
  return m ? m[1]! + (m[2] ? '-' + m[2] : '') : '';
}

export type TaxCodeInput = { taxCode: string } | { error: string };

/** Lấy MST từ chữ hoặc link. Link: tìm trong đường dẫn và tham số; chi nhánh chỉ nhận khi 3 số đứng riêng sau "-". */
export function extractTaxCode(input: string): TaxCodeInput {
  const text = String(input ?? '').trim().slice(0, 2500);
  if (!text) return { error: 'Nhập mã số thuế hoặc dán link trang tra cứu MST.' };
  // Chữ gõ tay: "0101 243 150" / "0101.243.150" → bỏ khoảng trắng, dấu chấm giữa các số.
  let haystack = text.replace(/(\d)[\s.]+(?=\d)/g, '$1');
  if (/^https?:\/\//i.test(text)) {
    try { const u = new URL(text); haystack = decodeURIComponent(u.pathname) + ' ' + [...u.searchParams.values()].join(' '); }
    catch { return { error: 'Link chưa đúng.' }; }
  }
  const found = [...haystack.matchAll(/(?<!\d)(\d{10})(?:-(\d{3})(?![\d]))?(?!\d)/g)].map(m => m[1]! + (m[2] ? '-' + m[2] : ''));
  const unique = [...new Set(found)];
  if (!unique.length) return { error: 'Không thấy mã số thuế (10 số hoặc 10 số-3 số) trong nội dung / link.' };
  if (unique.length > 1) return { error: 'Có nhiều mã số thuế trong nội dung. Chỉ dán một mã hoặc một link.' };
  const taxCode = unique[0]!;
  if (!taxCodeCheckDigitOk(taxCode.slice(0, 10))) return { error: `Mã số thuế ${taxCode} sai số kiểm tra – kiểm tra lại từng chữ số.` };
  return { taxCode };
}

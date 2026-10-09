/**
 * SỐ BÁO GIÁ TỰ SINH: `<loại>_BG<yyyymmdd>_<nnn>` – HRC_BG20261009_001, B2B_BG…, VG_BG… Đếm theo loại + ngày trên TOÀN BỘ
 * báo giá của công ty (máy chủ cấp lúc lưu). Trước đây giao diện tự đếm trên các báo giá người dùng nhìn thấy – nhân viên chỉ
 * thấy báo giá của mình nên ai cũng ra `_001`, trùng số.
 */
export const QUOTE_NO_PREFIX = { HRC: 'HRC', B2B: 'B2B', VIGIFTS: 'VG' } as const;
const AUTO_RE = /^((?:HRC|B2B|VG)_BG\d{8}_)(\d{3,})$/;

/** Phần đầu `HRC_BG20261009_` nếu là số theo mẫu tự sinh, ngược lại null (số gõ tay). */
export const autoQuoteHead = (quoteNo: string) => AUTO_RE.exec(quoteNo.trim())?.[1] ?? null;

/** Số kế tiếp sau số lớn nhất đang dùng có cùng phần đầu. */
export function nextQuoteNoAfter(head: string, used: readonly string[]) {
  const max = Math.max(0, ...used.filter(n => n.startsWith(head)).map(n => parseInt(n.slice(head.length), 10) || 0));
  return head + String(max + 1).padStart(3, '0');
}

/** Phần đầu theo loại + ngày (yyyy-mm-dd). */
export const quoteHeadFor = (type: string, date: string) =>
  `${QUOTE_NO_PREFIX[type as keyof typeof QUOTE_NO_PREFIX] ?? 'B2B'}_BG${date.replaceAll('-', '')}_`;

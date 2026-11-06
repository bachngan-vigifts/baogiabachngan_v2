/**
 * TỆP ĐÍNH KÈM BÁO CÁO CHT – hàm thuần (không I/O): kiểm tra byte thực tế, loại tệp, nội dung, giới hạn số lượng / dung lượng.
 * Ảnh JPEG / PNG / WebP (nhận dạng theo chữ ký byte, không tin MIME client khai) và PDF (đầu %PDF-, có %%EOF, không có nội dung chủ động).
 */
import type { StoreReportKind } from './reports.ts';

export const STORE_FILE_MAX_BYTES = 6 * 1024 * 1024;
/** Tối đa 6 tệp / báo cáo, tổng 24 MB / báo cáo. */
export const STORE_FILE_MAX_COUNT = 6;
export const STORE_FILE_MAX_TOTAL = 24 * 1024 * 1024;
export const STORE_FILE_PURPOSES = ['bank_deposit', 'stocktake_record', 'other'] as const;
export type StoreFilePurpose = typeof STORE_FILE_PURPOSES[number];
export const STORE_FILE_PURPOSE_LABEL: Record<StoreFilePurpose, string> = { bank_deposit: 'Chứng từ nộp tiền', stocktake_record: 'Biên bản / ảnh kiểm kê', other: 'Tệp khác' };
/** Loại tệp được đính kèm theo báo cáo. */
export const PURPOSES_FOR: Record<StoreReportKind, readonly StoreFilePurpose[]> = {
  daily: ['bank_deposit', 'other'], weekly: ['other'], monthly: ['other'], stocktake: ['stocktake_record', 'other'],
};
export const STORE_FILE_STATUSES = ['uploading', 'ready', 'deleted'] as const;
export type StoreFileStatus = typeof STORE_FILE_STATUSES[number];
export const STORE_FILE_MIMES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' } as const;
export type StoreFileMime = keyof typeof STORE_FILE_MIMES;

const ascii = (b: Uint8Array, from: number, to: number) => { let s = ''; for (let i = from; i < Math.min(to, b.length); i++) s += String.fromCharCode(b[i]!); return s; };
/** Loại tệp theo byte thực tế; không hỗ trợ → null. */
export function sniffStoreFile(b: Uint8Array): StoreFileMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 5 && ascii(b, 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}
/** PDF có nội dung chủ động (JavaScript, tự chạy, mở chương trình, tệp nhúng) → từ chối. */
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|OpenAction|AA|EmbeddedFile|RichMedia|XFA|SubmitForm)\b/;

export type FileCheck = { ok: true; mime: StoreFileMime; ext: string } | { ok: false; reason: string };
/**
 * Kiểm tra một tệp: kích thước 1 byte – 6 MB, MIME khai báo phải khớp byte thực tế, nội dung hợp lệ.
 * `declared`: MIME client khai (từ data URL) – chỉ để đối chiếu.
 */
export function checkStoreFile(bytes: Uint8Array, declared: string): FileCheck {
  if (!bytes.length) return { ok: false, reason: 'Tệp rỗng.' };
  if (bytes.length > STORE_FILE_MAX_BYTES) return { ok: false, reason: 'Tệp quá lớn (tối đa 6 MB).' };
  const mime = sniffStoreFile(bytes);
  if (!mime) return { ok: false, reason: 'Chỉ nhận ảnh JPEG, PNG, WebP hoặc PDF.' };
  if (mime !== declared) return { ok: false, reason: 'Loại tệp không khớp nội dung tệp.' };
  if (mime === 'application/pdf') {
    const tail = ascii(bytes, Math.max(0, bytes.length - 1024), bytes.length);
    if (!tail.includes('%%EOF')) return { ok: false, reason: 'Tệp PDF không hoàn chỉnh.' };
    // Đọc dạng latin1 để tìm từ khoá (đủ cho cấu trúc PDF; luồng nén không chứa từ khoá đối tượng).
    let text = ''; for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    if (PDF_ACTIVE.test(text)) return { ok: false, reason: 'PDF có nội dung tự chạy / tệp nhúng – không nhận. Xuất lại PDF thường hoặc chụp ảnh.' };
  }
  return { ok: true, mime, ext: STORE_FILE_MIMES[mime] };
}
/** Còn chỗ cho thêm một tệp `size` byte không (tính cả tệp đang tải dở). */
export function fileQuota(existing: readonly { bytes: number }[], size: number) {
  if (existing.length >= STORE_FILE_MAX_COUNT) return `Tối đa ${STORE_FILE_MAX_COUNT} tệp cho một báo cáo.`;
  if (existing.reduce((n, f) => n + f.bytes, 0) + size > STORE_FILE_MAX_TOTAL) return 'Tổng dung lượng tệp của báo cáo vượt 24 MB.';
  return null;
}
/** Tên hiển thị an toàn (không dùng làm đường dẫn lưu). */
export const safeFileName = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\\/<>:"|?*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'tep';

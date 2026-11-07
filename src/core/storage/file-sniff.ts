/**
 * KIỂM TRA FILE THẬT (07/11/2026): nội dung phải đúng loại file đã khai báo (chữ ký đầu file), không chỉ đuôi tên.
 * Chặn file độc đổi đuôi (vd. .exe → .pdf). Chỉ nhận đúng các loại dưới đây; ZIP không còn được nhận (không kiểm được bên trong).
 * Dùng ở lớp lưu trữ (file-store.ts) nên mọi đường tải lên (chat, góp ý, ảnh kho, báo cáo CHT, phiếu két…) đều đi qua.
 */
import { AppError } from '../errors.ts';

const starts = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));
const contains = (b: Uint8Array, s: string, limit = b.length) => {
  const needle = ascii(s), end = Math.min(b.length, limit) - needle.length;
  outer: for (let i = 0; i <= end; i++) { for (let j = 0; j < needle.length; j++) if (b[i + j] !== needle[j]) continue outer; return true; }
  return false;
};
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const isText = (b: Uint8Array) => {
  const head = b.subarray(0, 65536);
  if (head.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(head.length < b.length ? head.subarray(0, Math.max(0, head.length - 4)) : head); return true; } catch { return false; }
};
const CHECKS: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': b => starts(b, [0xff, 0xd8, 0xff]),
  'image/png': b => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/webp': b => starts(b, ascii('RIFF')) && starts(b, ascii('WEBP'), 8),
  'image/gif': b => starts(b, ascii('GIF87a')) || starts(b, ascii('GIF89a')),
  'application/pdf': b => contains(b, '%PDF-', 1024),
  // Word / Excel mới là gói ZIP có [Content_Types].xml; bản cũ (.doc / .xls) là OLE.
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': b => starts(b, ZIP) && contains(b, '[Content_Types].xml') && contains(b, 'xl/'),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': b => starts(b, ZIP) && contains(b, '[Content_Types].xml') && contains(b, 'word/'),
  'application/vnd.ms-excel': b => starts(b, OLE),
  'application/msword': b => starts(b, OLE),
  'text/csv': isText, 'text/plain': isText,
};
/** Các loại file được phép lưu. */
export const ALLOWED_FILE_MIMES = Object.keys(CHECKS);
/** true nếu nội dung đúng loại khai báo; loại không nằm trong danh sách → false. */
export function fileMatchesMime(bytes: Uint8Array, mime: string): boolean {
  const check = CHECKS[String(mime).toLowerCase().split(';')[0]!.trim()];
  return !!check && bytes.length > 0 && check(bytes);
}
export class FileTypeError extends AppError {
  constructor() { super(400, 'Nội dung file không đúng loại file (hoặc loại file không được phép). Chỉ nhận ảnh JPEG / PNG / WebP / GIF, PDF, Word, Excel, CSV, TXT.', 'FILE_TYPE_MISMATCH'); }
}
export function assertFileMatchesMime(bytes: Uint8Array, mime: string) { if (!fileMatchesMime(bytes, mime)) throw new FileTypeError(); }

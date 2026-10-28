import { and, asc, eq, inArray } from 'drizzle-orm';
import { AppError } from '../../../core/errors.ts';
import type { FileStore } from '../../../core/storage/file-store.ts';
import { warehousePhotos } from '../schema.ts';
import type { WarehousePhotoRef } from '../domain/kinds.ts';
import type { LedgerDb } from './ledger.ts';

/**
 * Ảnh nghiệp vụ kho (ảnh hàng NCC bị hỏng, ảnh xác nhận đã giao): trình duyệt nén thành data URL JPEG / WebP / PNG,
 * máy chủ lưu vào kho file private (không làm phình CSDL), bảng `warehouse_photos` giữ khoá file.
 */
export const WH_PHOTO_MAX = 3, WH_PHOTO_MAX_CHARS = 800_000;
const PHOTO_RE = /^data:image\/(jpeg|webp|png);base64,([A-Za-z0-9+/]+=*)$/;

/** Kiểm tra mảng ảnh gửi lên (0–3 ảnh). Lỗi → 400. Trả về bytes + mime để lưu sau khi chứng từ ghi xong. */
export function parsePhotos(raw: unknown, { min = 0, required = 'Chụp ít nhất 1 ảnh.' } = {}) {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > WH_PHOTO_MAX) throw new AppError(400, `Tối đa ${WH_PHOTO_MAX} ảnh.`);
  if (list.length < min) throw new AppError(400, required);
  return list.map(p => {
    const m = typeof p === 'string' && p.length <= WH_PHOTO_MAX_CHARS ? PHOTO_RE.exec(p) : null;
    if (!m) throw new AppError(400, 'Ảnh không hợp lệ hoặc quá lớn. Chụp lại rồi thử lại.');
    return { mime: 'image/' + m[1], ext: m[1] === 'jpeg' ? 'jpg' : m[1]!, bytes: Uint8Array.from(atob(m[2]!), ch => ch.charCodeAt(0)) };
  });
}
export type ParsedPhoto = ReturnType<typeof parsePhotos>[number];

/**
 * Tải ảnh lên kho file TRƯỚC khi mở giao dịch (I/O chậm không giữ khoá sổ kho / khoá chứng từ); trả các dòng để ghi trong giao dịch.
 * Giao dịch lỗi / gửi lặp: gọi `discardPhotos` để dọn file vừa tải.
 */
export async function uploadPhotos(files: FileStore | undefined, by: string, refType: WarehousePhotoRef, refId: string, photos: readonly ParsedPhoto[], now = new Date().toISOString()) {
  if (!photos.length) return [];
  if (!files) throw new AppError(503, 'Chưa cấu hình kho file, tạm thời chưa lưu được ảnh.');
  const rows: (typeof warehousePhotos.$inferInsert)[] = [];
  try {
    for (const p of photos) {
      const id = crypto.randomUUID(), fileKey = `warehouse-photos/${refType}/${refId}/${id}.${p.ext}`;
      await files.put(fileKey, p.bytes, p.mime);
      rows.push({ id, refType, refId, fileKey, bytes: p.bytes.length, createdBy: by, createdAt: now });
    }
  } catch (e) { await discardPhotos(files, rows); throw e; }
  return rows;
}
/** Ghi khoá ảnh đã tải (trong giao dịch của chứng từ). */
export async function recordPhotos(db: LedgerDb, rows: readonly (typeof warehousePhotos.$inferInsert)[]) {
  if (rows.length) await db.insert(warehousePhotos).values([...rows]);
}
export async function discardPhotos(files: FileStore | undefined, rows: readonly { fileKey: string }[]) {
  if (!files || !rows.length) return;
  try { await files.remove(rows.map(r => r.fileKey)); } catch { console.warn('warehouse photo cleanup skipped'); }
}
/** Lưu ảnh lên kho file + ghi bảng. Gọi trong giao dịch của chứng từ (lỗi kho file → huỷ cả chứng từ). */
export async function savePhotos(db: LedgerDb, files: FileStore | undefined, by: string, refType: WarehousePhotoRef, refId: string, photos: readonly ParsedPhoto[], now = new Date().toISOString()) {
  if (!photos.length) return;
  if (!files) throw new AppError(503, 'Chưa cấu hình kho file, tạm thời chưa lưu được ảnh.');
  const rows = [];
  for (const p of photos) {
    const id = crypto.randomUUID(), fileKey = `warehouse-photos/${refType}/${refId}/${id}.${p.ext}`;
    await files.put(fileKey, p.bytes, p.mime);
    rows.push({ id, refType, refId, fileKey, bytes: p.bytes.length, createdBy: by, createdAt: now });
  }
  await db.insert(warehousePhotos).values(rows);
}

/** Link xem ảnh (hết hạn sau 1 giờ) theo từng chứng từ. Không cấu hình kho file → không có ảnh. */
export async function photoUrls(db: LedgerDb, files: FileStore | undefined, refType: WarehousePhotoRef, refIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!refIds.length || !files) return out;
  const rows = await db.select({ refId: warehousePhotos.refId, key: warehousePhotos.fileKey }).from(warehousePhotos)
    .where(and(eq(warehousePhotos.refType, refType), inArray(warehousePhotos.refId, [...new Set(refIds)]))).orderBy(asc(warehousePhotos.createdAt), asc(warehousePhotos.id));
  if (!rows.length) return out;
  const urls = await files.signedUrls(rows.map(r => r.key), 3600);
  for (const r of rows) { const u = urls.get(r.key); if (u) out.set(r.refId, [...(out.get(r.refId) ?? []), u]); }
  return out;
}

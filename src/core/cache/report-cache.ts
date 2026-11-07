import { and, eq, lt } from 'drizzle-orm';
import type { AnyDb } from '../db/client.ts';
import { reportCache } from '../db/schema.ts';

/** Bản tính sẵn còn dùng trong 30 phút; quá hạn thì lượt xem kế tiếp tự tính lại. */
export const REPORT_CACHE_TTL_MS = 30 * 60_000;
/** Bản quá hạn giữ thêm 1 ngày rồi dọn (khi ghi bản mới). */
const PRUNE_AFTER_MS = 24 * 60 * 60_000;
const nextVnMidnight = (ms: number) => Date.parse(vnDay(ms) + 'T00:00:00+07:00') + 86400_000;
const vnDay = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);

export interface ReportCacheMeta {
  /** Thời điểm bắt đầu tính số liệu (ISO). */
  computedAt: string;
  /** Hết hạn lúc (ISO). */
  expiresAt: string;
  /** true: lấy từ bản tính sẵn; false: vừa tính. */
  hit: boolean;
  /** false: bảng cache chưa có (chưa chạy migration) – vẫn tính và trả số liệu như cũ. */
  available: boolean;
}

/** Khoá ổn định: thứ tự tham số không đổi kết quả; bỏ `refresh`. */
export function reportCacheKey(scope: string, viewer: string, params: URLSearchParams | Record<string, string>) {
  const entries = (params instanceof URLSearchParams ? [...params] : Object.entries(params))
    .filter(([k]) => k !== 'refresh').sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  return `${scope}|${viewer}|${new URLSearchParams(entries).toString()}`;
}

/**
 * Trả bản tính sẵn nếu còn hạn, không thì tính (`compute`) rồi lưu. `refresh` = bấm "Cập nhật": luôn tính lại.
 * Lỗi đọc / ghi cache (vd chưa chạy migration) không làm hỏng trang: tính trực tiếp như trước.
 * Quyền xem phải kiểm tra TRƯỚC khi gọi; `viewer` phải phân biệt mọi người xem có thể thấy số liệu khác nhau.
 */
export async function cachedReport<T extends object>(db: AnyDb, o: { scope: string; viewer: string; params: URLSearchParams | Record<string, string>; refresh?: boolean; now?: () => number; ttlMs?: number },
  compute: () => Promise<T>): Promise<T & { cache: ReportCacheMeta }> {
  const now = o.now ?? Date.now, ttl = o.ttlMs ?? REPORT_CACHE_TTL_MS, key = reportCacheKey(o.scope, o.viewer, o.params);
  let available = true;
  if (!o.refresh) {
    try {
      const [row] = await db.select({ data: reportCache.data, computedAt: reportCache.computedAt }).from(reportCache).where(eq(reportCache.key, key));
      const at = row ? Date.parse(row.computedAt) : NaN, t = now();
      // Qua nửa đêm giờ VN cũng tính lại: báo cáo dùng "hôm nay" (khách lâu chưa chăm sóc, tháng hiện tại…).
      if (row && Number.isFinite(at) && at <= t && t - at < ttl && vnDay(at) === vnDay(t))
        return { ...(JSON.parse(row.data) as T), cache: { computedAt: row.computedAt, expiresAt: new Date(Math.min(at + ttl, nextVnMidnight(at))).toISOString(), hit: true, available } };
    } catch (e) { available = false; console.warn('report cache read failed', String((e as Error)?.message ?? e).slice(0, 200)); }
  }
  const started = now(), data = await compute(), computedAt = new Date(started).toISOString();
  if (available) {
    try {
      const text = JSON.stringify(data);
      await db.insert(reportCache).values({ key, scope: o.scope, data: text, computedAt, computedBy: o.viewer })
        .onConflictDoUpdate({ target: reportCache.key, set: { data: text, computedAt, computedBy: o.viewer } });
      await db.delete(reportCache).where(and(eq(reportCache.scope, o.scope), lt(reportCache.computedAt, new Date(started - PRUNE_AFTER_MS).toISOString())));
    } catch (e) { available = false; console.warn('report cache write failed', String((e as Error)?.message ?? e).slice(0, 200)); }
  }
  return { ...data, cache: { computedAt, expiresAt: new Date(Math.min(started + ttl, nextVnMidnight(started))).toISOString(), hit: false, available } };
}

/** Bỏ mọi bản tính sẵn của một loại báo cáo (sau khi sửa dữ liệu nguồn, vd giá vốn). Lỗi thì bỏ qua – bản cũ tự hết hạn. */
export async function dropReportCache(db: AnyDb, scope: string) {
  try { await db.delete(reportCache).where(eq(reportCache.scope, scope)); } catch (e) { console.warn('report cache drop failed', String((e as Error)?.message ?? e).slice(0, 200)); }
}

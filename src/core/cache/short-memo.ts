/**
 * Bộ nhớ đệm rất ngắn trong một bản chạy Edge (isolate): nhiều máy hỏi cùng một dữ liệu nặng trong vài giây
 * (POS mở cùng lúc, kiểm tra phiên bản danh mục) thì chỉ đọc CSDL một lần và dùng chung kết quả.
 * - Gộp cả các lượt đang chờ (single-flight): lượt sau dùng chung Promise của lượt đang đọc.
 * - Mọi lệnh ghi đi qua router của isolate này gọi `invalidateShortMemos()` → lần đọc sau luôn lấy mới.
 *   Isolate khác chỉ còn cũ tối đa `ttlMs`.
 * - Lỗi không được giữ lại. ttlMs <= 0 thì tắt hẳn (môi trường test).
 */
const all = new Set<{ clear(): void }>();
// Bật 5 giây khi chạy trên Edge (Deno); Node (test, script) giữ 0 để mỗi lượt đọc đều thấy dữ liệu vừa ghi.
let defaultTtl = typeof (globalThis as { Deno?: unknown }).Deno !== 'undefined' ? 5000 : 0;
/** Đổi thời gian giữ mặc định (vd test cần bật). */
export function setShortMemoTtl(ms: number) { defaultTtl = Math.max(0, Math.floor(ms)); }
export function invalidateShortMemos() { for (const m of all) m.clear(); }

export function shortMemo<T>(opts: { ttlMs?: number; max?: number; now?: () => number } = {}) {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  const now = opts.now ?? Date.now, max = opts.max ?? 200;
  const memo = {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const ttl = opts.ttlMs ?? defaultTtl;
      if (ttl <= 0) return load();
      const t = now(), hit = entries.get(key);
      if (hit && t - hit.at < ttl) return hit.value;
      const value = load();
      entries.set(key, { at: t, value });
      value.catch(() => { if (entries.get(key)?.value === value) entries.delete(key); });
      if (entries.size > max) for (const [k, e] of entries) if (t - e.at >= ttl || entries.size > max) entries.delete(k);
      return value;
    },
    clear() { entries.clear(); },
    get size() { return entries.size; },
  };
  all.add(memo);
  return memo;
}

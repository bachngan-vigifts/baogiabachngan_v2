/**
 * TÌM KHÁCH NHANH cho ô chọn khách (lập báo giá, khách trong báo giá).
 *  - Nhớ kết quả từng từ khoá trong 5 phút: gõ lùi / gõ lại hiện ngay, không gọi máy chủ.
 *  - Gõ thêm chữ khi kết quả của từ khoá ngắn hơn đã đủ (ít hơn `limit` khách): lọc ngay trên máy, không gọi máy chủ
 *    (cùng quy tắc với máy chủ: bỏ dấu, mọi từ đều phải có, từ có số / ký hiệu so cả khi bỏ khoảng trắng, dấu câu).
 *  - Còn lại mới gọi `/customers?limit=8&usable=1&q=` (máy chủ có đường tìm nhanh riêng cho ô chọn khách).
 */
const MARKS = /[̀-ͯ]/g;
export const fold = value => String(value ?? '').normalize('NFD').replace(MARKS, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().trim().replace(/\s+/g, ' ');
const compact = text => text.replace(/[^a-z0-9]/g, '');
const needsCompact = word => /[0-9]/.test(word) || /[a-z0-9][^a-z0-9]+[a-z0-9]/.test(word);
const words = query => fold(query).split(' ').filter(Boolean).slice(0, 10);
const haystack = c => fold([c.name, c.contact, c.phone, c.email, c.address, c.taxCode, c.customerCode].filter(Boolean).join(' '));
/** Khách có khớp mọi từ khoá không (giống matchAllWords trên máy chủ). */
export function matchesCustomer(customer, query) {
  const text = haystack(customer), flat = compact(text);
  return words(query).every(w => text.includes(w) || (needsCompact(w) && compact(w) && flat.includes(compact(w))));
}

export function createCustomerSearch({ api, limit = 8, ttl = 5 * 60_000, now = () => Date.now() }) {
  const cache = new Map(); // từ khoá đã bỏ dấu → { items, at }
  const fresh = key => { const hit = cache.get(key); if (hit && now() - hit.at < ttl) return hit; cache.delete(key); return null; };
  /** Kết quả có ngay trên máy (đúng từ khoá, hoặc lọc từ từ khoá ngắn hơn đã đủ); null = phải hỏi máy chủ. */
  function local(query) {
    const key = words(query).join(' ');
    if (!key) return null;
    const exact = fresh(key);
    if (exact) return exact.items;
    let best = null;
    for (const k of [...cache.keys()]) {
      const hit = fresh(k);
      if (hit && hit.items.length < limit && key.startsWith(k) && (!best || k.length > best.length)) best = k;
    }
    return best === null ? null : cache.get(best).items.filter(c => matchesCustomer(c, query));
  }
  async function remote(query) {
    const key = words(query).join(' ');
    const items = (await api(`/customers?limit=${limit}&usable=1&q=${encodeURIComponent(query)}`)).customers || [];
    if (key) { cache.set(key, { items, at: now() }); if (cache.size > 200) cache.delete(cache.keys().next().value); }
    return items;
  }
  return { local, remote, clear: () => cache.clear() };
}

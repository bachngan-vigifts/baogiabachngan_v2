// BẢN TÍNH SẴN (Tổng quan, Phân tích lợi nhuận): máy chủ giữ kết quả 30 phút (core/cache/report-cache.ts).
// Hiện "Số liệu lúc HH:mm" + nút "Cập nhật" (gửi refresh=1 để tính lại ngay).
const hhmm = iso => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(11, 16);
const day = iso => new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 10);

/** "Số liệu lúc 14:05 (tính sẵn, tự làm mới sau 30 phút)" – rỗng nếu máy chủ chưa gửi thông tin cache. */
export function cacheText(cache, now = Date.now()) {
  if (!cache?.computedAt || !Number.isFinite(Date.parse(cache.computedAt))) return '';
  const at = hhmm(cache.computedAt) + (day(cache.computedAt) === day(new Date(now).toISOString()) ? '' : ` ${day(cache.computedAt).split('-').reverse().join('/')}`);
  if (cache.available === false) return `Số liệu lúc ${at}`;
  const left = Math.max(0, Math.ceil((Date.parse(cache.expiresAt) - now) / 60_000));
  return `Số liệu lúc ${at} · ${cache.hit ? `tính sẵn, tự làm mới sau ${left} phút` : 'vừa tính'}`;
}

/** Dòng HTML (trang dựng bằng chuỗi): chữ + nút có `id`. `esc` của trang. */
export const cacheLineHtml = (cache, id, esc) => {
  const t = cacheText(cache);
  return t ? `<p class="report-cache"><span>${esc(t)}</span> <button type="button" class="btn secondary btn-sm" id="${esc(id)}" title="Tính lại ngay với dữ liệu mới nhất">⟳ Cập nhật</button></p>` : '';
};

/** Dòng DOM (trang dựng bằng node): trả phần tử, gọi `onRefresh` khi bấm. */
export function cacheLineNode(doc, cache, onRefresh) {
  const t = cacheText(cache), p = doc.createElement('p');
  p.className = 'report-cache'; p.hidden = !t;
  const span = doc.createElement('span'); span.textContent = t;
  const b = doc.createElement('button'); b.type = 'button'; b.className = 'btn secondary btn-sm'; b.textContent = '⟳ Cập nhật'; b.title = 'Tính lại ngay với dữ liệu mới nhất';
  b.addEventListener('click', () => { b.disabled = true; span.textContent = 'Đang tính lại…'; onRefresh(); });
  p.append(span, ' ', b);
  return p;
}

/**
 * Thanh phân trang kiểu số trang (thay nút "Xem thêm"):
 *   Hiển thị [100 ▾] kết quả · Từ 1 đến 100 trên tổng 45.423 · ‹ 1 2 3 4 5 … 455 ›
 * Mỗi danh sách giữ trang + cỡ trang riêng; cỡ trang nhớ theo trình duyệt (chỉ là tiện ích, mất cũng không sao).
 */
export const PAGE_SIZES = [20, 50, 100, 200];

/** Các ô số trang cần hiện (số = trang, null = "…"). Hàm thuần. */
export function pageItems(page, last) {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, null, last];
  if (page >= last - 3) return [1, null, last - 4, last - 3, last - 2, last - 1, last];
  return [1, null, page - 1, page, page + 1, null, last];
}

/**
 * Gắn thanh phân trang vào phần tử `el`. `onChange()` được gọi khi người dùng đổi trang / cỡ trang – nơi gọi tải lại danh sách
 * với `pager.offset` / `pager.limit`, rồi gọi `pager.render(total)`.
 */
export function createPager(el, key, onChange, defaultSize = 50) {
  const storeKey = 'pageSize:' + key;
  let size = defaultSize;
  try { const v = Number(localStorage.getItem(storeKey)); if (PAGE_SIZES.includes(v)) size = v; } catch { /* không có localStorage */ }
  const p = {
    page: 1, total: 0,
    get limit() { return size; },
    get offset() { return (p.page - 1) * size; },
    /** Về trang 1 (khi đổi từ khoá / bộ lọc). */
    reset() { p.page = 1; },
    render(total) {
      p.total = Math.max(0, Number(total) || 0);
      const last = Math.max(1, Math.ceil(p.total / size));
      if (p.page > last) p.page = last;
      const from = p.total ? p.offset + 1 : 0, to = Math.min(p.offset + size, p.total), n = v => v.toLocaleString('vi-VN');
      el.hidden = p.total === 0;
      el.innerHTML = `<label class="pager-size">Hiển thị <select aria-label="Số dòng mỗi trang">${PAGE_SIZES.map(s => `<option value="${s}"${s === size ? ' selected' : ''}>${s}</option>`).join('')}</select> kết quả</label>
        <span class="pager-info">Từ ${n(from)} đến ${n(to)} trên tổng ${n(p.total)}</span>
        <nav class="pager-pages" aria-label="Chuyển trang">
          <button type="button" data-page="${p.page - 1}" aria-label="Trang trước"${p.page <= 1 ? ' disabled' : ''}>‹</button>
          ${pageItems(p.page, last).map(i => i === null ? '<span class="pager-gap">…</span>'
            : `<button type="button" data-page="${i}"${i === p.page ? ' class="active" aria-current="page"' : ''}>${i}</button>`).join('')}
          <button type="button" data-page="${p.page + 1}" aria-label="Trang sau"${p.page >= last ? ' disabled' : ''}>›</button>
        </nav>`;
    },
  };
  // Đổi trang: về đầu bảng nếu đầu bảng đã cuộn khuất.
  const go = () => { onChange(); const top = el.closest('.panel'); if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' }); };
  el.addEventListener('click', e => {
    const b = e.target.closest('button[data-page]'); if (!b || b.disabled) return;
    const n = Number(b.dataset.page), last = Math.max(1, Math.ceil(p.total / size));
    if (n < 1 || n > last || n === p.page) return;
    p.page = n; go();
  });
  el.addEventListener('change', e => {
    if (!e.target.matches('select')) return;
    const first = p.offset; size = Number(e.target.value);
    try { localStorage.setItem(storeKey, String(size)); } catch { /* bỏ qua */ }
    p.page = Math.floor(first / size) + 1; go();
  });
  return p;
}

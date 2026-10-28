/**
 * In vùng #print-sheet qua trình duyệt – dùng chung cho báo giá, đơn hàng, phiếu đóng gói / giao hàng, phiếu lương.
 *
 * Hai điểm để in đúng trên iPhone / iPad (Safari):
 *  - Safari KHÔNG chờ in xong: window.print() trả về ngay khi hộp in còn mở. Vì vậy chỉ dọn bản in (bỏ lớp CSS, xoá nội dung,
 *    trả lại tên trang) sau sự kiện `afterprint`, không dọn ngay sau lệnh in.
 *  - Safari bỏ qua trang có tên (`page: ...` + `@page tên {}`): khổ giấy / lề được gắn bằng một quy tắc `@page` chung tạm thời.
 *
 * `page` = { size: 'A4' | 'A4 landscape', margin: '14mm 12mm' }; `cls` = lớp thêm cho #print-sheet trong lúc in; `title` = tên file PDF gợi ý.
 */
let cleanup = null;
export function resetPrintSheet(){ cleanup?.(); }
export function printSheet({ page = {}, cls = '', title = '', clear = false } = {}) {
  cleanup?.(); // lần in trước chưa dọn (vd. Safari không báo afterprint)
  const out = document.getElementById('print-sheet'), oldTitle = document.title;
  const style = document.createElement('style'); style.dataset.printPage = '';
  style.textContent = `@page { size: ${page.size || 'A4'}; margin: ${page.margin || '14mm 12mm'}; }`;
  document.head.append(style);
  if (cls) out.classList.add(...cls.split(' ').filter(Boolean));
  if (title) document.title = title;
  let done = false;
  cleanup = () => {
    if (done) return; done = true; cleanup = null;
    window.removeEventListener('afterprint', onAfter);
    style.remove(); if (cls) out.classList.remove(...cls.split(' ').filter(Boolean));
    if (clear) out.innerHTML = '';
    document.title = oldTitle;
  };
  // Chờ một nhịp sau afterprint: Safari có thể còn đọc bản in ngay lúc hộp in đóng.
  const onAfter = () => setTimeout(() => cleanup?.(), 500);
  window.addEventListener('afterprint', onAfter);
  window.print();
}

/**
 * Trang dành cho tài khoản Kho (chức vụ "warehouse") – chữ to, nút to, ít lựa chọn.
 *  #/kho          Trang chủ kho: 3 thẻ lớn – Cần đóng gói · Hàng NCC về cần nhận · Giao hàng hôm nay / mai.
 *  #/stock-lookup Tra tồn: gõ / quét mã → tồn từng kho (chỉ số lượng, không có giá).
 * DOM dựng bằng createElement / textContent.
 */
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const num = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const dmy = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
/** Đơn mua NCC kho cần nhận: đã duyệt, chưa nhận đủ, chưa huỷ. */
export const RECEIVABLE_STATES = new Set(['awaiting_confirmation', 'confirmed', 'partially_received']);

export function initKhoHome({ api, root, today }) {
  const page = el('div', 'kho-page');
  const head = el('div', 'page-head'), titles = el('div');
  const hello = el('h1', '', 'Việc của kho hôm nay');
  titles.append(el('span', 'eyebrow', 'Kho hàng'), hello);
  head.append(titles);
  const cards = el('div', 'kho-cards'), lists = el('div', 'kho-lists');
  page.append(head, cards, lists);
  root.append(page);
  let req = 0;

  const card = (icon, title, href, count, note, tone) => {
    const a = el('a', 'kho-card' + (tone ? ' ' + tone : '')); a.href = href;
    const n = el('strong', 'kho-count', count === null ? '…' : count);
    a.append(el('span', 'kho-icon', icon), el('span', 'kho-card-title', title), n, el('small', 'muted', note));
    return a;
  };
  const section = (title, href, items, empty) => {
    const box = el('section', 'card kho-list');
    const h = el('div', 'kho-list-head'); h.append(el('h2', 'card-title', title));
    const all = el('a', 'btn ghost small', 'Xem tất cả ›'); all.href = href; h.append(all);
    box.append(h);
    if (!items.length) { box.append(el('p', 'muted', empty)); return box; }
    const ul = el('ul', 'kho-items');
    for (const it of items.slice(0, 6)) {
      const li = el('li'), a = el('a'); a.href = it.href;
      const t = el('span', 'kho-item-main'); t.append(el('b', '', it.title), el('small', 'muted', it.sub));
      a.append(t, el('span', 'kho-item-go', '›')); li.append(a); ul.append(li);
    }
    box.append(ul);
    return box;
  };

  async function load() {
    const my = ++req, t = today(), tomorrow = addDays(t, 1);
    cards.replaceChildren(card('📦', 'Cần đóng gói', '#/packing', null, 'Đang tải…'), card('🚚', 'Hàng NCC về – cần nhận', '#/purchases', null, 'Đang tải…'), card('🛻', 'Giao hôm nay & trễ', '#/deliveries', null, 'Đang tải…'));
    lists.replaceChildren();
    const [packing, purchases, deliveries] = await Promise.all([
      api('/packing?status=sent').then(r => r.slips).catch(() => null),
      api('/purchase-orders').then(r => r.orders.filter(o => RECEIVABLE_STATES.has(o.state))).catch(() => null),
      // Gồm cả chuyến trễ (lịch từ 7 ngày trước mà chưa giao) – không để chuyến quá hạn biến mất khỏi trang kho.
      api(`/deliveries?from=${addDays(t, -7)}&to=${tomorrow}`).then(r => r.deliveries.filter(d => d.status === 'planned' || d.status === 'in_transit')).catch(() => null),
    ]);
    if (my !== req) return;
    const todayShips = deliveries?.filter(d => d.plannedDate <= t) ?? null;
    const dueIn = purchases?.filter(o => o.arrivalDate && o.arrivalDate <= tomorrow) ?? null;
    cards.replaceChildren(
      card('📦', 'Cần đóng gói', '#/packing', packing?.length ?? '–', packing ? (packing.length ? 'phiếu chờ đóng' : 'Không có phiếu chờ') : 'Chưa tải được', packing?.length ? 'warn' : ''),
      card('🚚', 'Hàng NCC về – cần nhận', '#/purchases', purchases?.length ?? '–', purchases ? (dueIn?.length ? `${dueIn.length} đơn hẹn về đến mai` : 'đơn chờ nhận') : 'Chưa tải được', dueIn?.length ? 'warn' : ''),
      card('🛻', 'Giao hôm nay & trễ', '#/deliveries', todayShips?.length ?? '–', deliveries ? `${deliveries.length - (todayShips?.length ?? 0)} chuyến ngày mai` : 'Chưa tải được', todayShips?.length ? 'warn' : ''),
    );
    if (packing) lists.append(section('📦 Phiếu chờ đóng gói', '#/packing', packing.map(x => ({ href: '#/packing/' + encodeURIComponent(x.id), title: `${x.slipNo} · ${x.customerName}`,
      sub: [x.sourceLabel + (x.sourceNote ? ': ' + x.sourceNote : ''), x.expectedDeliveryDate ? 'giao ' + dmy(x.expectedDeliveryDate) : ''].filter(Boolean).join(' · ') })), 'Không có phiếu nào chờ đóng.'));
    if (deliveries) lists.append(section('🛻 Giao hôm nay & ngày mai', '#/deliveries', deliveries.map(d => ({ href: '#/deliveries', title: `${d.plannedDate <= t ? 'Hôm nay' : 'Ngày mai'}${d.timeSlot ? ' ' + d.timeSlot : ''} · ${d.customerName}`,
      sub: [d.deliveryNo, d.address || d.customerAddress].filter(Boolean).join(' · ') })), 'Không có chuyến giao nào.'));
    if (purchases) lists.append(section('🚚 Hàng NCC sắp về', '#/purchases', [...purchases].sort((a, b) => (a.arrivalDate || '9') < (b.arrivalDate || '9') ? -1 : 1).map(o => ({ href: '#/purchases/' + encodeURIComponent(o.id), title: `${o.supplierName || 'NCC'} · ${o.ticketNumber}`,
      sub: [o.arrivalDate ? (o.late ? 'Trễ hẹn – ' : 'Hẹn ') + dmy(o.arrivalDate) : 'Chưa có ngày hẹn', `${o.lineCount} mã`, o.good ? `còn thiếu ${num(o.missing)}` : `${num(o.ordered)} sp`].join(' · ') })), 'Không có hàng NCC nào chờ nhận.'));
  }
  return { load };
}

export function initStockLookup({ api, root }) {
  const page = el('div', 'kho-page');
  const head = el('div', 'page-head'), titles = el('div');
  titles.append(el('span', 'eyebrow', 'Kho hàng'), el('h1', '', 'Tra tồn'), el('p', 'muted', 'Gõ mã hoặc tên hàng (hoặc quét mã vạch) để xem còn bao nhiêu ở từng kho.'));
  head.append(titles);
  const bar = el('form', 'lookup-bar');
  const q = el('input'); q.type = 'search'; q.placeholder = 'Mã hoặc tên hàng…'; q.setAttribute('aria-label', 'Mã hoặc tên hàng'); q.autocomplete = 'off'; q.enterKeyHint = 'search';
  const go = el('button', 'btn primary', 'Tìm'); go.type = 'submit';
  bar.append(q, go);
  // Quét mã bằng camera (trình duyệt hỗ trợ BarcodeDetector – Chrome Android). Máy quét cầm tay gõ thẳng vào ô tìm.
  let scanBtn = null;
  if ('BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia) { scanBtn = el('button', 'btn secondary', '📷 Quét'); scanBtn.type = 'button'; bar.append(scanBtn); }
  const note = el('p', 'muted small'), out = el('div', 'lookup-results');
  page.append(head, bar, note, out);
  root.append(page);
  let req = 0;

  async function search() {
    const text = q.value.trim(), my = ++req;
    if (text.length < 2) { out.replaceChildren(); note.textContent = 'Nhập ít nhất 2 ký tự.'; return; }
    note.textContent = 'Đang tìm…';
    try {
      const r = await api('/inventory/lookup?q=' + encodeURIComponent(text));
      if (my !== req) return;
      note.textContent = r.products.length ? `${r.products.length} mã · tồn theo ${r.source === 'ledger' ? 'sổ kho' : 'Sapo (đồng bộ gần nhất)'}` : 'Không tìm thấy mã nào.';
      out.replaceChildren(...r.products.map(p => {
        const c = el('article', 'card lookup-item');
        const top = el('div', 'lookup-top');
        if (/^(https?:|data:image\/)/.test(p.imageUrl || '')) { const img = el('img'); img.src = p.imageUrl; img.alt = ''; img.loading = 'lazy'; top.append(img); }
        const name = el('div'); name.append(el('b', 'lookup-sku', p.sku), el('span', 'lookup-name', p.name));
        const total = el('div', 'lookup-total'); total.append(el('strong', p.total > 0 ? '' : 'danger-text', num(p.total)), el('small', 'muted', p.unit || 'tổng'));
        top.append(name, total);
        const rows = el('ul', 'lookup-stock');
        for (const s of p.stock) { const li = el('li', s.qty > 0 ? '' : 'muted'); li.append(el('span', '', s.warehouse), el('b', '', num(s.qty))); rows.append(li); }
        c.append(top, rows);
        // Hàng đang về: đơn mua NCC đã duyệt còn chờ nhận (không cộng vào tổng tồn) – từng đơn: số đơn, NCC, ngày hẹn.
        const inc = p.incoming;
        if (inc?.qty > 0) {
          const box = el('div', 'lookup-incoming'), head = el('div', 'lookup-incoming-head');
          head.append(el('span', '', '🚚 Hàng đang về'), el('b', '', num(inc.qty)));
          const ul = el('ul');
          for (const o of inc.orders) {
            const li = el('li'), a = el('a', '', [o.ticketNumber, o.internalNo && 'NCC ' + o.internalNo].filter(Boolean).join(' · ')); a.href = '#/purchases/' + encodeURIComponent(o.orderId);
            li.append(a, el('span', 'muted', [o.supplierName, o.arrivalDate ? 'hẹn ' + dmy(o.arrivalDate) : 'chưa có ngày hẹn'].filter(Boolean).join(' · ')), el('b', '', num(o.qty)));
            ul.append(li);
          }
          box.append(head, ul); c.append(box);
        }
        return c;
      }));
    } catch (e) { if (my === req) { note.textContent = ''; out.replaceChildren(el('p', 'error card', e.message)); } }
  }
  bar.addEventListener('submit', e => { e.preventDefault(); search(); });
  let timer = 0;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 350); });

  scanBtn?.addEventListener('click', async () => {
    const dlg = el('dialog', 'scan-dialog'), video = el('video'), stop = el('button', 'btn secondary', 'Đóng');
    video.playsInline = true; video.muted = true; stop.type = 'button';
    dlg.append(el('p', '', 'Đưa mã vạch vào giữa khung hình'), video, stop); document.body.append(dlg); dlg.showModal();
    let stream = null, done = false;
    const close = () => { done = true; stream?.getTracks().forEach(t => t.stop()); dlg.close(); dlg.remove(); };
    stop.addEventListener('click', close); dlg.addEventListener('cancel', close);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play();
      const detector = new window.BarcodeDetector();
      const tick = async () => {
        if (done) return;
        const [code] = await detector.detect(video).catch(() => []);
        if (code?.rawValue) { q.value = code.rawValue; close(); search(); return; }
        setTimeout(tick, 250);
      };
      tick();
    } catch { close(); note.textContent = 'Không mở được camera. Gõ mã vào ô tìm.'; }
  });

  return { load: (sku='') => { if(sku)q.value=sku;setTimeout(() => q.focus(), 0); if (q.value.trim().length >= 2) search(); } };
}

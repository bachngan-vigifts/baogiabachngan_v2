/**
 * Trang dành cho tài khoản Kho (chức vụ "warehouse") – chữ to, nút to, ít lựa chọn.
 *  #/kho          Việc cần làm: đóng gói, nhận NCC, giao hàng, điều chuyển, lấy trước và chứng từ nhập Sapo.
 *  #/stock-lookup Tra tồn: gõ / quét mã → tồn từng kho (chỉ số lượng, không có giá).
 * DOM dựng bằng createElement / textContent.
 */
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const num = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const dmy = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
/** Đơn mua NCC kho cần nhận: đã duyệt, chưa nhận đủ, chưa huỷ. */
export const RECEIVABLE_STATES = new Set(['awaiting_confirmation', 'confirmed', 'partially_received']);

export function initKhoHome({ api, root, today }) {
  const page = el('div', 'kho-page');
  const head = el('div', 'page-head'), titles = el('div');
  const hello = el('h1', '', 'Việc cần làm');
  titles.append(el('span', 'eyebrow', 'Kho hàng'), hello);
  const reload=el('button','btn secondary','Làm mới');reload.type='button';reload.dataset.mobileInline='';reload.dataset.noBusy='';reload.onclick=()=>load();head.append(titles,reload);
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
    const my=++req;reload.disabled=true;
    cards.replaceChildren(card('📦','Việc đang chờ','#/kho',null,'Đang tải…'));lists.replaceChildren();
    try {
      const d=await api('/warehouse-work');if(my!==req)return;cards.replaceChildren();
      const t=d.today;
      if(d.packing){cards.append(card('📦','Cần đóng gói','#/packing',d.packing.count,'phiếu chờ đóng',d.packing.count?'warn':''));lists.append(section('📦 Phiếu chờ đóng gói','#/packing',d.packing.rows.map(x=>({href:'#/packing/'+encodeURIComponent(x.id),title:x.slipNo+' · '+x.customerName,sub:x.date?'Giao '+dmy(x.date):'Chưa hẹn giao'})),'Không có phiếu chờ đóng.'));}
      if(d.incoming){cards.append(card('🚚','Hàng NCC về – cần nhận','#/receiving?type=purchase',d.incoming.count,'đơn còn hàng chờ nhận',d.incoming.count?'warn':''));lists.append(section('🚚 Hàng NCC chờ nhận','#/receiving?type=purchase',d.incoming.rows.map(x=>({href:'#/purchases/'+encodeURIComponent(x.orderId),title:x.ticketNumber+' · '+x.supplierName,sub:(x.date?(x.date<t?'Trễ hẹn · ':'Hẹn ')+dmy(x.date):'Chưa hẹn ngày')+' · '+x.lines.length+' mã còn thiếu'})),'Không có đơn mua chờ nhận.'));}
      if(d.shipping){cards.append(card('🛻','Giao hôm nay & trễ','#/deliveries',d.shipping.due,d.shipping.tomorrow+' chuyến ngày mai · '+d.shipping.failed+' giao lỗi',d.shipping.due?'warn':''));lists.append(section('🛻 Giao hàng & giao lỗi cần xử lý','#/deliveries',d.shipping.rows.map(x=>({href:'#/deliveries?deliveryId='+encodeURIComponent(x.id),title:x.deliveryNo+' · '+x.customerName,sub:[x.status==='failed'?'Giao lỗi':x.plannedDate<t?'Trễ hẹn':x.plannedDate===t?'Hôm nay':'Ngày mai',dmy(x.plannedDate),x.address].filter(Boolean).join(' · ')})),'Không có chuyến giao chờ xử lý đến ngày mai.'));}
      cards.append(card('⇄','Điều chuyển kho','#/transfers',d.transfers.count,d.transfers.pending+' chờ duyệt · '+d.transfers.approved+' chờ chuyển',d.transfers.count?'warn':''));
      lists.append(section('⇄ Phiếu điều chuyển đang mở','#/transfers',d.transfers.rows.map(x=>({href:'#/transfers/'+encodeURIComponent(x.id),title:x.transferNo,sub:x.fromName+' → '+x.toName+' · '+(x.status==='approved'?'Đã duyệt – chờ kho chuyển':'Chờ duyệt')})),'Không có phiếu điều chuyển chờ xử lý.'));
      if(d.early){cards.append(card('📝','Phiếu xin hàng trước','#/receiving?type=early&workOnly=1',d.early.count,'phiếu đã gửi, còn chờ NCC hoặc nhận hàng',d.early.count?'warn':''));lists.append(section('📝 Phiếu xin hàng trước cần theo dõi','#/receiving?type=early&workOnly=1',d.early.rows.map(x=>({href:'#/early-requests/'+encodeURIComponent(x.requestId),title:'Phiếu '+x.requestId.slice(0,8).toUpperCase()+' · '+x.supplierName,sub:[x.date?'Ngày lấy '+dmy(x.date):'Chưa hẹn ngày',x.lines.some(l=>l.receiptOptions?.length)?'NCC đồng ý – còn hàng chờ nhận':'Chờ NCC phản hồi',x.lines.length+' mã'].join(' · ')})),'Không có phiếu xin hàng trước chờ xử lý.'));}
      if(d.sapo){cards.append(card('📥','Chờ nhập kho Sapo','#/purchases?state=sapo',d.sapo.count,'đơn có phiếu nhận chờ xử lý Sapo',d.sapo.count?'warn':''));lists.append(section('📥 Phiếu nhận chờ nhập Sapo','#/purchases?state=sapo',d.sapo.rows.map(x=>({href:'#/purchases/'+encodeURIComponent(x.id),title:x.ticketNumber+' · '+x.supplierName,sub:x.pending+' phiếu nhận chờ nhập Sapo hoặc cần kiểm tra lỗi'})),'Không có phiếu nhận chờ nhập Sapo.'));}
    }catch(e){if(my===req){cards.replaceChildren();lists.replaceChildren(el('p','error card',e.message||'Không tải được việc cần làm. Bấm Làm mới để thử lại.'));}}
    finally{if(my===req)reload.disabled=false;}
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
      // Nguồn tồn theo TỪNG kho (kho đã chốt = sổ kho, chưa chốt = Sapo) – không lấy một kho báo cho mọi kho.
      const SRC = { ledger: 'sổ kho', sapo: 'Sapo (đồng bộ gần nhất)' };
      note.textContent = r.products.length ? `${r.products.length} mã · tồn theo ${r.source === 'mixed' ? 'từng kho (ghi bên cạnh tên kho)' : SRC[r.source] || SRC.sapo}` : 'Không tìm thấy mã nào.';
      out.replaceChildren(...r.products.map(p => {
        const c = el('article', 'card lookup-item');
        const top = el('div', 'lookup-top');
        if (/^(https?:|data:image\/)/.test(p.imageUrl || '')) { const img = el('img'); img.src = p.imageUrl; img.alt = ''; img.loading = 'lazy'; top.append(img); }
        const name = el('div'); name.append(el('b', 'lookup-sku', p.sku), el('span', 'lookup-name', p.name));
        const total = el('div', 'lookup-total'); total.append(el('strong', p.total > 0 ? '' : 'danger-text', num(p.total)), el('small', 'muted', p.unit || 'tổng'));
        top.append(name, total);
        const rows = el('ul', 'lookup-stock');
        for (const s of p.stock) {
          const li = el('li', s.qty > 0 ? '' : 'muted'), w = el('span', '', s.warehouse);
          if (r.source === 'mixed') w.append(el('small', 'muted', ' · ' + (SRC[s.source] || SRC.sapo)));
          li.append(w, el('b', '', num(s.qty))); rows.append(li);
        }
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

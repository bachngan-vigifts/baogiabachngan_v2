const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
export function initReceivingCalendar({ api, root, confirmBox = async () => false }) {
  const page = el('div', 'sup-page'), head = el('div', 'page-head'), title = el('div');
  title.append(el('span', 'eyebrow', 'Kho & giao hàng'), el('h1', '', 'Lịch nhận hàng'), el('p', 'muted', 'Đơn mua và phiếu xin lấy trước còn hàng chờ nhận. Phiếu mới tạo nằm trên cùng.'));
  const reload = el('button', 'btn secondary', 'Làm mới'); reload.type = 'button'; head.append(title, reload);
  const panel = el('div', 'panel'), bar = el('div', 'toolbar'), summary = el('p', 'muted');
  const from = el('input'), to = el('input'), q = el('input'), supplier = el('select'), state = el('select'), type = el('select'), sku = el('input');
  from.type = to.type = 'date'; sku.type = 'search'; sku.placeholder = 'Nhập mã SKU…'; q.type = 'search'; q.placeholder = 'Số đơn, NCC, mã / tên hàng…';
  const field = (name, control) => { const label = el('label', '', name); label.append(control); return label; };
  for (const [value, text] of [['', 'Tất cả'], ['late', 'Quá hẹn'], ['scheduled', 'Hôm nay / sắp tới'], ['undated', 'Chưa hẹn ngày']]) state.append(Object.assign(el('option', '', text), { value }));
  for(const [value,text] of [['','Tất cả loại phiếu'],['purchase','Đơn mua hàng'],['early','Phiếu xin lấy trước']])type.append(Object.assign(el('option','',text),{value}));
  supplier.append(Object.assign(el('option', '', 'Tất cả NCC'), { value: '' }));
  bar.append(field('Từ ngày', from), field('Đến ngày', to), field('Nhà cung cấp', supplier), field('Trạng thái', state), field('Loại phiếu',type), field('Mã hàng',sku), field('Tìm kiếm', q));
  const hint = el('p', 'muted small', 'Hàng chưa hẹn ngày vẫn hiển thị khi lọc khoảng ngày. Đơn mua hiển thị phần còn thiếu; phiếu xin hiển thị lượng xin lấy trước, theo đơn vị từng mã.');
  const wrap = el('div', 'table-wrap'), table = el('table', 'data-table'), th = el('tr'), body = el('tbody');
  for (const text of ['Ngày hẹn nhận', 'Loại phiếu / Chứng từ', 'Nhà cung cấp', 'Hàng chờ nhận / xin lấy']) th.append(el('th', '', text));
  const thead = el('thead'); thead.append(th); table.append(thead, body); wrap.append(table);
  const foot = el('div', 'row-gap'), prev = el('button', 'btn secondary small', '‹ Trước'), next = el('button', 'btn secondary small', 'Sau ›'), range = el('span', 'muted small');
  prev.type = next.type = 'button'; foot.append(prev, range, next); panel.append(bar, hint, summary, wrap, foot); page.append(head, panel); root.append(page);
  let offset = 0, request = 0, timer;
  const reset = () => { offset = 0; return load(); };
  for (const control of [from, to, supplier, state, type]) control.addEventListener('change', reset);
  sku.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(reset, 250); });
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(reset, 250); }); reload.addEventListener('click', reset);
  prev.addEventListener('click', () => { offset = Math.max(0, offset - 50); load(); }); next.addEventListener('click', () => { offset += 50; load(); });
  async function load() {
    const id = ++request; prev.disabled = next.disabled = true; summary.textContent = 'Đang tải lịch nhận hàng…';
    body.replaceChildren();
    try {
      const d = await api('/purchase-receiving-calendar?' + new URLSearchParams({ from: from.value, to: to.value, supplierId: supplier.value, state: state.value, type:type.value,sku:sku.value,q: q.value, offset: String(offset) }));
      if (id !== request) return;
      if (offset && !d.rows.length) { offset = 0; return load(); }
      const keep = supplier.value; supplier.replaceChildren(Object.assign(el('option', '', 'Tất cả NCC'), { value: '' }));
      for (const s of d.suppliers) supplier.append(Object.assign(el('option', '', s.name), { value: s.id }));
      supplier.value = keep;
      summary.textContent = `${d.orderCount} chứng từ · ${d.total} lượt hẹn · ${d.overdue} quá hẹn · ${d.undated} chưa hẹn ngày`;
      for (const r of d.rows) {
        const tr = el('tr'), date = el('td', r.date && r.date < d.today ? 'pur-late' : '');
        date.textContent = r.date ? r.date.split('-').reverse().join('/') : 'Chưa hẹn ngày';
        const order = el('td'), link = el('a', 'data-link', r.ticketNumber);
        link.href = r.type==='early' ? '#/purchases?mode=incoming&request='+encodeURIComponent(r.requestId) : '#/purchases/'+encodeURIComponent(r.orderId);
        order.append(link,el('small','muted',r.type==='early'?'Phiếu xin lấy trước':'Đơn mua hàng'));
        if(r.createdAt)order.append(el('small','muted',new Date(r.createdAt).toLocaleString('vi-VN')));
        const lines = el('td');
        for (const l of r.lines) {
          const row=el('div','receiving-line');
          row.append(el('span','',`${l.sku} · ${l.name} — ${r.type==='early'?'Xin ':''}${Number(l.requestedQty??l.left).toLocaleString('vi-VN')} ${l.unit||''}`));
          if(r.type==='early'){
            row.append(el('small','muted',({draft:'Nháp · chưa gửi NCC',pending:'Chờ NCC xác nhận',accepted:'Đã xác nhận',rejected:'NCC từ chối',mixed:'Đã phản hồi một phần'})[l.status]||''));
            if(d.canConfirmEarly&&l.canConfirm){
              const b=el('button','btn secondary small','Manager xác nhận thay NCC');b.type='button';
              b.addEventListener('click',async()=>{
                if(b.disabled)return;b.disabled=true;
                try{
                  if(!await confirmBox(`Xác nhận thay ${r.supplierName} đồng ý giao trước ${l.sku}: ${Number(l.requestedQty??l.left).toLocaleString('vi-VN')} ${l.unit||''}? Đây là xác nhận NCC; chưa ghi nhận hàng vào kho.`,{title:'Manager xác nhận thay NCC',ok:'Xác nhận đã trao đổi NCC'}))return;
                  await api('/purchase-early-request-lines/'+encodeURIComponent(l.lineId)+'/manager-confirm','POST',{supplierId:r.supplierId});
                  await load();
                }catch(e){summary.textContent=e.message||'Không xác nhận được phiếu.';}finally{b.disabled=false;}
              });row.append(b);
            }
          }
          lines.append(row);
        }
        tr.append(date, order, el('td', '', r.supplierName), lines); body.append(tr);
      }
      if (!d.rows.length) { const tr = el('tr'), td = el('td', 'muted', 'Không có hàng chờ nhận theo bộ lọc.'); td.colSpan = 4; tr.append(td); body.append(tr); }
      range.textContent = d.total ? `${offset + 1}–${offset + d.rows.length} / ${d.total} lượt hẹn` : '0 lượt hẹn';
      prev.disabled = offset === 0; next.disabled = offset + d.limit >= d.total;
    } catch (e) { if (id === request) summary.textContent = e.message || 'Không tải được lịch nhận hàng.'; }
  }
  return { load };
}

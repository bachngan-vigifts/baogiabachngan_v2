/**
 * KHO BÁN THEO CHỨC VỤ – giao diện (docs/SO-KHO.md):
 *  - Điều chuyển kho (#/transfers, #/transfers/<id>): xin chuyển → nhân viên kho được xin (hoặc Manager) Cho / Từ chối → Kho bấm "Đã chuyển".
 *  - Sổ kho (#/stock-moves, như Sổ kho Sapo): mọi giao dịch nhập / xuất, tồn sau giao dịch, lọc chi nhánh / ngày / giao dịch / nhãn hiệu / trạng thái, phân trang, xuất file.
 *  - Kho bán theo chức vụ (gắn dưới trang Phân quyền): kho ↔ chức vụ được bán + kho riêng (chỉ người bán kho đó thấy tồn).
 * API: src/modules/inventory/api/{transfer-routes,history-routes}.ts. DOM dựng bằng createElement / textContent.
 */
import { downloadExcel } from './sheet-export.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const btn = (text, cls = 'btn secondary small', onClick) => { const b = el('button', cls, text); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); return b; };
const input = (type, value = '', attrs = {}) => { const i = el('input'); i.type = type; i.value = value ?? ''; Object.assign(i, attrs); return i; };
const field = (label, control, cls = '') => { const l = el('label', cls); l.append(document.createTextNode(label), control); return l; };
const select = (options, value = '', label = '') => { const s = el('select'); if (label) s.setAttribute('aria-label', label); for (const [v, t] of options) { const o = el('option', '', t); o.value = v; s.append(o); } s.value = value; return s; };
const num = v => Number(v || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const signed = v => (v > 0 ? '+' : '') + num(v);
const dt = iso => iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const PILL = { pending: 'warn', approved: 'blue', done: 'ok', rejected: 'danger', cancelled: '' };

/** Hộp nhập: trả chuỗi (≥ 3 ký tự) hoặc null. */
function ask(title, placeholder) {
  return new Promise(resolve => {
    const dlg = el('dialog', 'modal narrow'), form = el('form'), area = el('textarea');
    area.rows = 3; area.required = true; area.minLength = 3; area.placeholder = placeholder; area.style.width = '100%';
    const foot = el('div', 'modal-foot'), ok = el('button', 'btn primary', 'Gửi'), no = btn('Huỷ', 'btn secondary');
    foot.append(no, ok); const body = el('div', 'modal-body'); body.append(area);
    const head = el('div', 'modal-head'); head.append(el('h2', '', title));
    form.append(head, body, foot); dlg.append(form); document.body.append(dlg);
    const done = v => { dlg.close(); dlg.remove(); resolve(v); };
    form.addEventListener('submit', e => { e.preventDefault(); const v = area.value.trim(); if (v.length >= 3) done(v); else area.reportValidity(); });
    no.addEventListener('click', () => done(null)); dlg.addEventListener('cancel', e => { e.preventDefault(); done(null); });
    dlg.showModal(); area.focus();
  });
}

export function initTransfers({ api, root, toast, go, isManager = () => false }) {
  let data = null, filter = 'open', listRun = 0, detailRun = 0, showing = '', rendered = '', inFlight = null, formOpen = false, posting = false, updating = false, openedAt = 0;
  const page = el('div', 'sup-page'), head = el('div', 'page-head'), titles = el('div');
  titles.append(el('span', 'eyebrow', 'Kho hàng'), el('h1', '', 'Điều chuyển kho'),
    el('p', 'muted', 'Kho của mình thiếu hàng: xin chuyển từ kho khác. Sale Admin và NVBH Lock/Minh Long duyệt đối ứng theo người xin (Manager duyệt thay); bấm "Đã chuyển" thì sổ kho trừ kho đi, cộng kho đến. Chờ quá 1 giờ hệ thống nhắc lại.'));
  const tools = el('div', 'row-gap'), add = btn('＋ Xin điều chuyển', 'btn primary', () => openForm());
  tools.append(add); head.append(titles, tools);
  const panel = el('div', 'panel'), bar = el('div', 'toolbar chips');
  for (const [k, t] of [['open', 'Đang mở'], ['done', 'Đã chuyển'], ['', 'Tất cả']]) {
    const c = btn(t, 'chip' + (k === filter ? ' active' : ''), () => { if(updating)return; filter = k; statusFilter.value=k; syncChips(); load(); });
    bar.append(c);
  }
  const filters = el('form', 'transfer-filter-grid'), search = input('search', '', {placeholder:'Số phiếu hoặc mã sản phẩm…',maxLength:80});
  search.setAttribute('aria-label','Tìm số phiếu hoặc mã sản phẩm');
  const fromFilter = select([['','Tất cả kho đi']], '', 'Lọc kho đi'), toFilter = select([['','Tất cả kho đến']], '', 'Lọc kho đến');
  const requesterFilter = select([['','Tất cả người xin']], '', 'Lọc người xin');
  const statusFilter = select([['open','Đang mở'],['pending','Chờ duyệt'],['approved','Đã duyệt – chờ kho chuyển'],['done','Đã chuyển'],['rejected','Đã từ chối'],['cancelled','Đã huỷ'],['','Tất cả trạng thái']], filter, 'Lọc trạng thái');
  const fromDate = input('date'), toDate = input('date');
  fromDate.setAttribute('aria-label','Từ ngày lập');toDate.setAttribute('aria-label','Đến ngày lập');
  const apply = el('button','btn primary small','Lọc');apply.type='submit';
  const reset = btn('Xoá bộ lọc','btn secondary small',()=>{
    if(updating)return;
    search.value='';fromFilter.value='';toFilter.value='';requesterFilter.value='';fromDate.value='';toDate.value='';statusFilter.value='open';filter='open';syncChips();load();
  });
  const syncChips=()=>{[...bar.querySelectorAll('.chip')].forEach((node,i)=>node.classList.toggle('active',['open','done',''][i]===filter));};
  const query=()=>{
    const params=new URLSearchParams();filter=statusFilter.value;
    for(const [key,value] of [['status',filter],['q',search.value.trim()],['fromWarehouseId',fromFilter.value],['toWarehouseId',toFilter.value],['requestedBy',requesterFilter.value],['from',fromDate.value],['to',toDate.value]])if(value)params.set(key,value);
    return params.toString();
  };
  filters.append(field('Tìm phiếu / mã hàng',search),field('Kho đi',fromFilter),field('Kho đến',toFilter),field('Người xin',requesterFilter),field('Trạng thái',statusFilter),field('Từ ngày lập',fromDate),field('Đến ngày lập',toDate),apply,reset);
  filters.addEventListener('submit',event=>{event.preventDefault();if(updating)return;if(fromDate.value&&toDate.value&&fromDate.value>toDate.value){toast('Từ ngày phải trước hoặc bằng đến ngày.','err');return;}filter=statusFilter.value;syncChips();return load();});
  const fillFilter=(control,options,placeholder)=>{const value=control.value;control.replaceChildren(...[[ '',placeholder],...options].map(([id,name])=>{const option=el('option','',name);option.value=id;return option;}));control.value=value;};
  const resultNote=el('p','muted transfer-filter-note');resultNote.setAttribute('role','status');
  const wrap = el('div', 'table-wrap'), table = el('table', 'data-table'), tbody = el('tbody');
  const thead = el('thead'), hr = el('tr');
  for (const h of ['Số phiếu', 'Kho đi → kho đến', 'Mã / SL', 'Người xin', 'Trạng thái']) hr.append(el('th', '', h));
  thead.append(hr); table.append(thead, tbody); wrap.append(table); panel.append(bar, filters, resultNote, wrap); page.append(head, panel);
  const shade = el('div', 'sup-shade'); shade.hidden = true;
  const drawer = el('aside', 'sup-drawer'); drawer.hidden = true; drawer.setAttribute('role', 'dialog');
  root.append(page, shade, drawer);
  const setUpdating=(button,busyText)=>{
      if(updating)return null;
      updating=true;detailRun++;listRun++;drawer.setAttribute('aria-busy','true');
      const controls=[...drawer.querySelectorAll('button'),...drawer.querySelectorAll('input'),...drawer.querySelectorAll('select'),...drawer.querySelectorAll('textarea')],before=controls.map(node=>({node,hidden:node.hidden,disabled:node.disabled}));
      const label=button.textContent;
      for(const node of controls){node.disabled=true;if(node!==button&&node.tagName==='BUTTON')node.hidden=true;}
      button.textContent=busyText;button.className+=' is-busy';button.setAttribute('aria-busy','true');
      return()=>{updating=false;drawer.removeAttribute('aria-busy');for(const {node,hidden,disabled} of before){node.hidden=hidden;node.disabled=disabled;}button.textContent=label;button.className=button.className.replace(' is-busy','');button.removeAttribute('aria-busy');};
    };
  const close = () => { if(posting||updating)return;detailRun++;showing='';rendered='';inFlight=null;formOpen=false;drawer.hidden = true; shade.hidden = true; if (/^#\/transfers\//.test(location.hash)) history.replaceState(null, '', '#/transfers'); };
  shade.addEventListener('click', () => { if(Date.now()-openedAt>=400)close(); });

  async function load(openId, afterUpdate = false) {
    if(updating&&!afterUpdate)return;
    const seq=++listRun;
    if(openId&&showing!==openId){detailRun++;showing=openId;inFlight=null;}
    if(!openId&&!formOpen){detailRun++;showing='';rendered='';inFlight=null;drawer.hidden=true;shade.hidden=true;}
    if(!data)tbody.replaceChildren(el('tr'));
    try { const next=await api('/stock-transfers' + (query() ? '?' + query() : ''));if(seq!==listRun)return;data=next; }
    catch (e) { if(seq!==listRun)return;tbody.replaceChildren(); toast(e.message, 'err'); return; }
    fillFilter(fromFilter,data.warehouses.map(w=>[w.id,w.name]),'Tất cả kho đi');
    fillFilter(toFilter,data.warehouses.map(w=>[w.id,w.name]),'Tất cả kho đến');
    fillFilter(requesterFilter,(data.filterOptions?.requesters||[]).map(m=>[m.id,m.name]),'Tất cả người xin');
    resultNote.textContent=`${data.transfers.length} phiếu${data.transfers.length>=300?' · Hiển thị tối đa 300 phiếu, hãy thu hẹp bộ lọc.':''}`;
    tbody.replaceChildren(...(data.transfers.length ? data.transfers.map(t => {
      const tr = el('tr', 'clickable'); tr.tabIndex = 0;
      const no = el('td', 'first'); no.append(el('b', '', t.transferNo), el('small', '', dt(t.createdAt)));
      const pill = el('span', 'pill ' + (PILL[t.status] || ''), t.statusLabel);
      const st = el('td'); st.append(pill);
      tr.append(no, el('td', '', `${t.fromName} → ${t.toName}`), el('td', '', `${t.lineCount} mã · ${num(t.qty)}`), el('td', '', t.requestedByName), st);
      tr.addEventListener('click', () => go('#/transfers/' + t.id)); tr.addEventListener('keydown', e => { if (e.key === 'Enter') go('#/transfers/' + t.id); });
      return tr;
    }) : [(() => { const tr = el('tr'), td = el('td', 'muted', 'Không có phiếu điều chuyển phù hợp bộ lọc.'); td.colSpan = 5; tr.append(td); return tr; })()]));
    if (openId && !formOpen) await show(openId, afterUpdate);
  }

  function show(id, afterUpdate = false) {
    if(updating&&!afterUpdate)return Promise.resolve();
    if(formOpen)return Promise.resolve();
    if(inFlight&&showing===id)return inFlight;
    const seq=++detailRun;showing=id;
    const pending=drawDetail(id,seq,afterUpdate).finally(()=>{if(inFlight===pending)inFlight=null;});inFlight=pending;return pending;
  }
  async function drawDetail(id,seq,afterUpdate=false) {
    let t;
    try { t = await api('/stock-transfers/' + encodeURIComponent(id)); } catch (e) { if(seq===detailRun)toast(e.message, 'err');return; }
    if(seq!==detailRun||formOpen||(updating&&!afterUpdate))return;
    const key=JSON.stringify(t);if(rendered===key&&!drawer.hidden)return;rendered=key;
    drawer.replaceChildren();
    const h = el('div', 'sup-drawer-head transfer-detail-head'),title=el('div');
    title.append(el('span','eyebrow','Điều chuyển kho'),el('h2','','Phiếu '+t.transferNo),el('span','pill '+(PILL[t.status]||''),t.statusLabel));
    h.append(title,btn('✕','icon-btn',close));
    const meta=el('section','transfer-summary');meta.setAttribute('aria-label','Thông tin phiếu điều chuyển');
    const route=el('div','transfer-route');
    for(const [label,value] of [['Kho đi · lấy hàng',t.fromName],['Kho đến · nhận hàng',t.toName]]){
      const box=el('div','transfer-route-stop');box.append(el('span','muted small',label),el('b','',value));route.append(box);
    }
    const info=el('div','transfer-summary-grid');
    for(const [label,value] of [['Người xin',t.requestedByName],['Ngày xin',dt(t.createdAt)],...(t.approvedByName?[[t.status==='rejected'?'Người từ chối':'Người duyệt',`${t.approvedByName} · ${dt(t.approvedAt)}`]]:[]),...(t.doneByName?[['Đã chuyển',`${t.doneByName} · ${dt(t.doneAt)}`]]:[])]){
      const box=el('div');box.append(el('span','muted small',label),el('span','',value));info.append(box);
    }
    const reason=el('div','transfer-summary-reason');reason.append(el('span','muted small','Lý do xin hàng'),el('p','',t.reason||'—'));
    meta.append(route,info,reason);
    if(t.status==='pending'&&t.approvalBy)meta.append(el('p','small muted transfer-approval-note','Người được cho hàng: '+t.approvalBy));
    if (t.rejectReason) meta.append(el('p', 'danger-text', 'Lý do từ chối: ' + t.rejectReason));
    const tbl = el('table', 'data-table transfer-detail-table'), th = el('tr');
    for (const x of ['Sản phẩm', 'SL chuyển', 'Tồn kho đi', 'Tồn kho đến']) th.append(el('th', '', x));
    const tb = el('tbody');
    for(const l of t.lines){
      const row=el('tr'),product=el('td','first');product.append(el('b','',l.name),el('small','',l.sku));product.dataset.label='Sản phẩm';
      const qty=el('td','num',num(l.qty)+' '+(l.unit||'')),fromStock=el('td','num'+(l.fromStock<l.qty&&t.status!=='done'?' danger-text':''),num(l.fromStock)),toStock=el('td','num',num(l.toStock));
      qty.dataset.label='SL chuyển';fromStock.dataset.label='Tồn kho đi';toStock.dataset.label='Tồn kho đến';row.append(product,qty,fromStock,toStock);tb.append(row);
    }
    const thd = el('thead'); thd.append(th); tbl.append(thd, tb);
    const tw = el('div', 'table-wrap'); tw.append(tbl);
    const acts = el('div', 'row-gap');
    const run = async (path, body, msg) => {
      try { await api(`/stock-transfers/${t.id}/${path}`, 'POST', { revision: t.revision, ...body }); }
      catch (e) {
        if (path !== 'done' || e.code !== 'HELD_FOR_OTHER_ORDER' || !isManager()) throw e;
        const reason = await ask('Lấy hàng đang giữ cho đơn khác', e.message + ' – nhập lý do (ít nhất 5 ký tự)');
        if (!reason) return false;
        await api(`/stock-transfers/${t.id}/${path}`, 'POST', { revision: t.revision, ...body, overrideHolds: { reason } });
      }
      toast(msg);return true;
    };
    const act = (text, cls, busyText, fn) => {
      const b = btn(text, cls, async () => {
        const release=setUpdating(b,busyText);if(!release)return;
        let refresh=false;
        try{refresh=await fn();if(refresh&&showing===t.id)await load(t.id,true);}catch(e){toast(e.message,'err');}
        finally{release();}
      });
      acts.append(b);
    };
    if (t.actions.edit) acts.append(btn('Chỉnh sửa', 'btn secondary', () => openForm(t,true)));
    if (t.actions.approve) act('Cho xin hàng', 'btn ok', 'Đang duyệt…', () => run('approve', {}, 'Đã cho – chuyển hàng rồi bấm "Đã chuyển".'));
    if (t.actions.reject) act('Từ chối…', 'btn danger-outline', 'Đang từ chối…', async () => { const r = await ask('Từ chối phiếu xin hàng', 'Lý do từ chối (người xin sẽ nhận được)'); return r ? run('reject', { reason: r }, 'Đã từ chối.') : false; });
    if (t.actions.done) act('Đã chuyển', 'btn primary', 'Đang ghi sổ kho…', () => run('done', {}, 'Đã ghi sổ kho: trừ kho đi, cộng kho đến.'));
    if (t.actions.cancel) act('Huỷ phiếu', 'btn ghost', 'Đang huỷ…', () => run('cancel', {}, 'Đã huỷ phiếu.'));
    if (t.status === 'cancelled') acts.append(btn('Sao chép phiếu', 'btn primary', () => openForm(t)));
    drawer.append(h, meta, tw, acts);
    drawer.hidden = false; shade.hidden = false; openedAt=Date.now();
  }

  async function openForm(source = null, editing = false) {
    if(posting||updating)return;detailRun++;inFlight=null;rendered='';formOpen=true;
    if (!data) await load();
    const whs = data?.warehouses || [];
    drawer.replaceChildren();
    const h = el('div', 'sup-drawer-head'); h.append(el('h2', '', source ? (editing?'Chỉnh sửa phiếu ':'Sao chép phiếu ') + source.transferNo : 'Xin điều chuyển kho'), btn('✕', 'icon-btn', close));
    const opts = [['', 'Chọn kho'], ...whs.map(w => [w.id, w.name])];
    const from = select(opts, whs.some(w => w.id === source?.fromWarehouseId) ? source.fromWarehouseId : '', 'Kho đi'), to = select(opts, whs.some(w => w.id === source?.toWarehouseId) ? source.toWarehouseId : '', 'Kho đến');
    const reason = input('text', source ? (editing?source.reason:('Sao chép từ ' + source.transferNo + ' · ' + source.reason).slice(0, 500)) : '', { placeholder: 'VD: đơn của khách Kim Trần Gia cần hàng ở kho VIGIFTS', maxLength: 500 });
    const lines = el('div', 'transfer-lines');
    const find = input('search', '', { placeholder: 'Tìm mã / tên sản phẩm…' });
    find.setAttribute('aria-label', 'Tìm sản phẩm điều chuyển');
    const results = el('div', 'transfer-search-results');
    const status = el('p', 'muted small'); status.setAttribute('role', 'status');
    let timer = 0, searchRun = 0;
    const active = () => formOpen && !posting && !updating && drawer.children[0] === h;
    const setProduct = (row, product) => {
      row.dataset.sku = product.sku;
      row.querySelector('input[type=text]').value = product.name || product.sku;
      row.querySelector('input[type=text]').title = product.name || product.sku;
      row.children[0].children[1].textContent = product.sku + (product.unit ? ' · ' + product.unit : '');
    };
    const lineRow = (sku = '', qty = '', name = '', unit = '') => {
      const row = el('div', 'row-gap'), product = el('div', 'transfer-line-product');
      const nameInput = input('text', '', { placeholder: 'Chọn tên sản phẩm ở ô tìm phía trên', readOnly: true });
      nameInput.setAttribute('aria-label', 'Tên sản phẩm');
      nameInput.addEventListener('click', () => find.focus());
      product.append(nameInput, el('small', 'muted'));
      const quantity = input('number', qty, { placeholder: 'SL', min: '0', step: 'any' });
      quantity.setAttribute('aria-label', 'Số lượng chuyển');
      row.append(product, quantity, btn('✕', 'icon-btn', () => row.remove())); lines.append(row);
      setProduct(row, { sku, name, unit }); return row;
    };
    const choose = product => {
      if (!active() || posting) return;
      let row = [...lines.children].find(r => r.dataset.sku === product.sku);
      if (!row) {
        row = [...lines.children].find(r => !r.dataset.sku) || lineRow();
        setProduct(row, product);
        const quantity = row.querySelector('input[type=number]'); if (!quantity.value) quantity.value = '1';
      }
      searchRun++; clearTimeout(timer); find.value = ''; results.replaceChildren(); status.textContent = '';
      row.querySelector('input[type=number]').focus();
    };
    const search = async () => {
      if (!active()) return;
      clearTimeout(timer);
      const query = find.value.trim(), run = ++searchRun;
      results.replaceChildren();
      if (query.length < 2) { status.textContent = 'Nhập ít nhất 2 ký tự để tìm sản phẩm.'; return; }
      status.textContent = 'Đang tìm sản phẩm…';
      try {
        const response = await api('/inventory/lookup?q=' + encodeURIComponent(query));
        if (!active() || run !== searchRun || find.value.trim() !== query) return;
        const products = response.products || [];
        results.replaceChildren(...products.map(product => {
          const result = btn('', 'transfer-search-result', () => choose(product));
          result.append(el('strong', '', product.name || product.sku), el('small', 'muted', product.sku + ' · ' + (product.stock || []).map(s => s.warehouse + ': ' + num(s.qty)).join(' · ')));
          return result;
        }));
        status.textContent = products.length ? products.length + ' sản phẩm · Bấm để thêm vào danh sách chuyển.' : 'Không tìm thấy sản phẩm.';
      } catch (error) {
        if (active() && run === searchRun) status.textContent = 'Không tìm được sản phẩm: ' + error.message + '. Bấm Tìm để thử lại.';
      }
    };
    find.addEventListener('input', () => {
      clearTimeout(timer); searchRun++; results.replaceChildren(); status.textContent = '';
      if (find.value.trim().length >= 2) timer = setTimeout(search, 250);
    });
    find.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); search(); } });
    const searchBox = el('div', 'transfer-search-box'); searchBox.append(find, btn('Tìm', 'btn secondary', search));
    const picker = el('div', 'transfer-picker'); picker.append(searchBox, status, results);
    if (source?.lines?.length) for (const line of source.lines) lineRow(line.sku, line.qty, line.name, line.unit); else lineRow();
    const clientKey=crypto.randomUUID();
    const send = btn(editing?'Lưu thay đổi':'Gửi duyệt', 'btn primary', async () => {
      if(posting)return;posting=true;
      const body = { ...(editing?{revision:source.revision}:{clientKey}),fromWarehouseId: from.value, toWarehouseId: to.value, reason: reason.value,
        lines: [...lines.children].map(r => ({ sku: r.dataset.sku, qty: Number(r.querySelector('input[type=number]').value) })).filter(l => l.sku) };
      const release=setUpdating(send,editing?'Đang cập nhật…':'Đang gửi duyệt…');if(!release){posting=false;return;}let target='';
      try { const t = await api(editing?'/stock-transfers/'+encodeURIComponent(source.id):'/stock-transfers', editing?'PUT':'POST', body); toast((editing?'Đã cập nhật phiếu ':'Đã gửi phiếu ') + t.transferNo + ' – chờ duyệt.'); formOpen=false;filter = 'open';statusFilter.value='open';syncChips();target=t.id; }
      catch (e) { toast(e.message, 'err'); } finally { posting=false;release(); }
      if(target)go('#/transfers/' + target);
    });
    const form = el('div', 'form-grid');
    form.append(field('Kho đi (lấy hàng)', from), field('Kho đến (cần hàng)', to), field('Lý do', reason, 'wide'), field('Tìm sản phẩm', picker, 'wide'));
    const foot = el('div', 'sup-drawer-foot-sticky'); foot.append(btn('Huỷ', 'btn secondary', close), send);
    if (source) drawer.append(h, el('p', 'muted small', editing?'Chỉ sửa phiếu chờ duyệt. Lưu thay đổi không ghi sổ kho; phiếu vẫn cần duyệt.':'Phiếu gốc giữ trạng thái đã huỷ. Kiểm tra kho, mã và số lượng rồi bấm Gửi duyệt để tạo phiếu mới; chưa có phát sinh sổ kho.')); else drawer.append(h);
    drawer.append(form, el('h3', '', 'Sản phẩm cần chuyển'), lines, btn('＋ Thêm dòng', 'btn ghost small', () => { lineRow(); find.focus(); }), foot);
    drawer.hidden = false; shade.hidden = false;openedAt=Date.now();
  }

  return { load: id => load(id), show };
}

const GROUPS = [['', 'Tất cả giao dịch'], ['sale', 'Bán hàng'], ['in', 'Nhập kho'], ['out', 'Xuất kho'], ['transfer', 'Điều chuyển'], ['adjust', 'Điều chỉnh / đầu kỳ'], ['reverse', 'Huỷ chứng từ']];
const STATUSES = [['', 'Mọi trạng thái'], ['active', 'Đang giao dịch'], ['inactive', 'Ngừng giao dịch']];
const day = iso => iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const time = iso => iso ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
const isoDay = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const dash = v => v ? num(v) : '-';
/** Nhãn ô khi bảng thành thẻ trên điện thoại (style.css: td[data-label]::before). */
const labeled = (td, label) => { td.dataset.label = label; return td; };
/** Bộ lọc trang Sổ kho ↔ query của link (#/stock-moves?q=…&warehouseId=…&from=…&to=…&group=…&brand=…&status=…): link mở đúng bộ lọc. */
const FILTER_KEYS = ['q', 'warehouseId', 'from', 'to', 'group', 'brand', 'status'];

/**
 * SỔ KHO (#/stock-moves) – như "Sổ kho" của Sapo: mỗi dòng một giao dịch, cột Nhập kho / Xuất kho / Tồn kho sau giao dịch / Chi nhánh,
 * dòng "Tổng N giao dịch" theo cả bộ lọc, phân trang, xuất file. Dữ liệu: GET /stock-moves (history-routes.ts).
 * `linkAllowed(hash)`: chỉ hiện link chứng từ khi người xem mở được trang đó (không thì hiện chữ).
 */
export function initStockMoves({ api, root, toast, createPager, linkAllowed = () => true }) {
  let rows = [], req = 0;
  const f = Object.fromEntries(FILTER_KEYS.map(k => [k, '']));
  const page = el('div', 'sup-page'), head = el('div', 'page-head'), titles = el('div');
  titles.append(el('span', 'eyebrow', 'Kho hàng'), el('h1', '', 'Sổ kho'),
    el('p', 'muted', 'Mọi giao dịch nhập / xuất của kho thật: bán hàng (duyệt đơn / HĐKT, bán quầy), nhập NCC, đóng gói, giao COD, khách trả, điều chuyển, điều chỉnh. Tự ghi theo chứng từ – không sửa tay.'));
  const tools = el('div', 'row-gap');
  const exp = btn('⬇ Xuất file', 'btn secondary', exportFile);
  const help = el('details', 'ledger-help'), sum = el('summary', '', 'Giải thích thuật ngữ'), dl = el('dl');
  for (const [t, d] of [['Ngày ghi nhận', 'Lúc chứng từ ghi vào sổ kho (duyệt đơn, nhận hàng, xác nhận đóng gói / giao, điều chuyển xong…).'],
    ['Giao dịch', 'Số chứng từ gốc (bấm để mở) và loại giao dịch.'], ['Nhập kho / Xuất kho', 'Số lượng cộng vào / trừ khỏi kho của dòng đó.'],
    ['Tồn kho sau giao dịch', 'Tồn của mã đó tại chi nhánh ngay sau giao dịch (cộng dồn toàn bộ sổ kho, không phụ thuộc bộ lọc). Số âm = đã xuất nhiều hơn tồn ghi nhận.'],
    ['Chi nhánh', 'Kho thật ghi nhận giao dịch. Kho riêng chỉ người được bán kho đó thấy.'], ['Huỷ chứng từ', 'Huỷ / sửa chứng từ không xoá dòng cũ mà ghi thêm dòng ngược lại.']]) dl.append(el('dt', '', t), el('dd', '', d));
  help.append(sum, dl); tools.append(exp); head.append(titles, tools);

  const panel = el('div', 'panel'), bar = el('div', 'toolbar ledger-bar');
  const wh = select([['', 'Tất cả chi nhánh']], '', 'Chi nhánh'), from = input('date'), to = input('date');
  const q = input('search', '', { placeholder: 'Tìm theo mã SKU, tên sản phẩm, số chứng từ…' }); q.setAttribute('aria-label', 'Tìm sổ kho');
  const group = select(GROUPS, '', 'Giao dịch'), brand = select([['', 'Mọi nhãn hiệu']], '', 'Nhãn hiệu'), status = select(STATUSES, '', 'Trạng thái sản phẩm');
  const controls = { warehouseId: wh, from, to, q, group, brand, status };
  for (const [k, c] of Object.entries(controls)) c.addEventListener(k === 'q' ? 'input' : 'change', () => { if (k === 'q') { clearTimeout(timer); timer = setTimeout(() => apply(k, c.value.trim()), 300); } else apply(k, c.value); });
  let timer = 0;
  bar.append(field('Chi nhánh', wh), field('Từ ngày', from), field('Đến ngày', to), field('Giao dịch', group), field('Nhãn hiệu', brand), field('Trạng thái', status), el('label', 'ledger-search'));
  bar.lastChild.append(q);
  const chips = el('div', 'chips ledger-chips');
  const wrap = el('div', 'table-wrap'), table = el('table', 'data-table ledger-table'), thead = el('thead'), tbody = el('tbody'), hr = el('tr');
  for (const [h, c] of [['#', 'num'], ['Ngày ghi nhận', ''], ['Giao dịch', ''], ['Phiên bản sản phẩm', ''], ['Nhập kho', 'num'], ['Xuất kho', 'num'], ['Tồn kho sau giao dịch', 'num'], ['Chi nhánh', '']]) hr.append(el('th', c, h));
  thead.append(hr); table.append(thead, tbody); wrap.append(table);
  const pagerEl = el('div', 'pager'), pager = createPager(pagerEl, 'stock-moves', () => load(), 20);
  panel.append(bar, chips, help, wrap, pagerEl); page.append(head, panel); root.append(page);

  /** Mặc định 30 ngày gần nhất (như Sapo). */
  function defaults() { const now = new Date(), past = new Date(now.getTime() - 29 * 86400000); return { from: isoDay(past), to: isoDay(now) }; }
  function apply(k, v) { f[k] = v; pager.reset(); syncHash(); load(); }
  function syncHash() {
    const p = new URLSearchParams(); for (const k of FILTER_KEYS) if (f[k]) p.set(k, f[k]);
    const hash = '#/stock-moves' + (p.size ? '?' + p : '');
    if (location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash);
  }
  function params(extra = {}) {
    const p = new URLSearchParams(); for (const k of FILTER_KEYS) if (f[k]) p.set(k, f[k]);
    p.set('page', String(pager.page)); p.set('size', String(pager.limit)); for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return p;
  }
  function renderChips() {
    const label = { warehouseId: 'Chi nhánh', from: 'Từ ngày', to: 'Đến ngày', q: 'Tìm', group: 'Giao dịch', brand: 'Nhãn hiệu', status: 'Trạng thái' };
    const text = k => k === 'warehouseId' ? wh.selectedOptions[0]?.textContent : k === 'group' ? GROUPS.find(g => g[0] === f.group)?.[1] : k === 'status' ? STATUSES.find(x => x[0] === f.status)?.[1] : k === 'from' || k === 'to' ? day(f[k]) : f[k];
    const active = FILTER_KEYS.filter(k => f[k] && k !== 'from' && k !== 'to');
    chips.replaceChildren(...active.map(k => btn(`${label[k]}: ${text(k)} ×`, 'chip active', () => { f[k] = ''; controls[k].value = ''; pager.reset(); syncHash(); load(); })));
    if (active.length > 1) chips.append(btn('Xoá bộ lọc', 'chip', () => { for (const k of active) { f[k] = ''; controls[k].value = ''; } pager.reset(); syncHash(); load(); }));
    chips.hidden = !active.length;
  }
  /** Đổ danh sách chi nhánh / nhãn hiệu một lần (giữ giá trị đang lọc, kể cả giá trị lấy từ link). */
  function fillOptions(sel, list, keep) {
    if (sel.dataset.filled) return;
    while (sel.options.length > 1) sel.lastChild.remove();
    for (const [v, t] of list) { const o = el('option', '', t); o.value = v; sel.append(o); }
    if (keep && !list.some(([v]) => v === keep)) { const o = el('option', '', keep); o.value = keep; sel.append(o); }
    sel.value = keep; sel.dataset.filled = '1';
  }
  function itemCell(m) {
    const td = el('td', 'ledger-item'), a = el('a', '', m.sku); a.href = '#/products?sku=' + encodeURIComponent(m.sku); a.title = 'Mở thẻ sản phẩm (tồn từng kho, lịch sử)';
    td.append(a, el('small', '', m.name || 'Mã chưa có trong danh mục'));
    if (!m.active) td.append(el('span', 'pill', 'Ngừng giao dịch'));
    return td;
  }
  function refCell(m) {
    const td = el('td', 'ledger-ref');
    if (m.link && linkAllowed(m.link)) { const a = el('a', '', m.refNo || 'Mở chứng từ'); a.href = m.link; td.append(a); } else td.append(el('b', '', m.refNo || '—'));
    td.append(el('small', '', m.description));
    if (m.note || m.by) td.title = [m.note, m.by && 'Người làm: ' + m.by].filter(Boolean).join('\n');
    return td;
  }
  async function load() {
    const my = ++req;
    let d; try { d = await api('/stock-moves?' + params()); } catch (e) { if (my === req) toast(e.message, 'err'); return; }
    if (my !== req) return;
    fillOptions(wh, d.warehouses.map(w => [w.id, w.name]), f.warehouseId); fillOptions(brand, d.brands.map(b => [b, b]), f.brand);
    renderChips();
    rows = d.moves; pager.render(d.total);
    const total = el('tr', 'ledger-total'), lbl = el('td', '', `Tổng ${num(d.total)} giao dịch`); lbl.colSpan = 4;
    total.append(lbl, labeled(el('td', 'num', num(d.totals.inQty)), 'Nhập'), labeled(el('td', 'num', num(d.totals.outQty)), 'Xuất'), el('td', 'ledger-empty'), el('td', 'ledger-empty'));
    if (!rows.length) { const tr = el('tr'), td = el('td', 'muted', 'Không có giao dịch nào khớp bộ lọc.'); td.colSpan = 8; tr.append(td); tbody.replaceChildren(total, tr); return; }
    tbody.replaceChildren(total, ...rows.map((m, i) => {
      const tr = el('tr'), when = el('td', 'nowrap'); when.append(document.createTextNode(day(m.at)), el('small', '', time(m.at)));
      tr.append(el('td', 'num muted ledger-no', pager.offset + i + 1), when, refCell(m), itemCell(m), labeled(el('td', 'num', dash(m.inQty)), 'Nhập'), labeled(el('td', 'num', dash(m.outQty)), 'Xuất'),
        labeled(el('td', 'num' + (m.balanceAfter < 0 ? ' danger-text' : ''), num(m.balanceAfter)), 'Tồn sau'), labeled(el('td', 'ledger-wh', m.warehouse), 'Chi nhánh'));
      return tr;
    }));
  }
  async function exportFile() {
    let d; try { d = await api('/stock-moves?' + params({ export: '1' })); } catch (e) { toast(e.message, 'err'); return; }
    if (d.total > d.moves.length) toast(`Bộ lọc có ${num(d.total)} giao dịch – file lấy ${num(d.moves.length)} dòng mới nhất. Thu hẹp ngày để lấy đủ.`);
    await downloadExcel(`so-kho_${f.from || 'tu-dau'}_den_${f.to || isoDay(new Date())}`, [{ name: 'Sổ kho', autoFilter: true,
      header: ['Ngày ghi nhận', 'Giờ', 'Số chứng từ', 'Giao dịch', 'Mã SKU', 'Tên sản phẩm', 'Nhãn hiệu', 'ĐVT', 'Nhập kho', 'Xuất kho', 'Tồn sau giao dịch', 'Chi nhánh', 'Ghi chú', 'Người làm'],
      rows: d.moves.map(m => [day(m.at), time(m.at), m.refNo, m.description, m.sku, m.name, m.brand, m.unit, m.inQty || null, m.outQty || null, m.balanceAfter, m.warehouse, m.note, m.by]) }]).catch(e => toast(e.message, 'err'));
  }
  /** Mở trang: lấy bộ lọc từ link (#/stock-moves?…); không có ngày thì 30 ngày gần nhất. */
  function show(query = '') {
    const p = new URLSearchParams(query), dflt = defaults();
    for (const k of FILTER_KEYS) f[k] = (p.get(k) || '').trim();
    if (!p.has('from') && !p.has('to')) Object.assign(f, dflt);
    for (const [k, c] of Object.entries(controls)) { if (c.tagName === 'SELECT' && f[k] && ![...c.options].some(o => o.value === f[k])) { const o = el('option', '', f[k]); o.value = f[k]; c.append(o); } c.value = f[k]; }
    pager.reset(); syncHash(); return load();
  }
  return { load, show };
}

/** Bảng kho ↔ chức vụ được bán (dưới trang Phân quyền). */
export function initSellerConfig({ api, root, toast }) {
  const panel = el('div', 'panel seller-config');
  panel.append(el('h2', '', 'Kho bán theo chức vụ'), el('p', 'muted', 'Nhân viên chỉ lập đơn / HĐKT từ kho chức vụ mình được bán (Manager bán mọi kho). "Kho riêng": chỉ chức vụ bán kho đó thấy tồn (VD kho Hoá đơn).'));
  const body = el('div'); panel.append(body); root.append(panel);
  async function load() {
    let d; try { d = await api('/warehouse-sellers'); } catch (e) { panel.hidden = true; return; }
    panel.hidden = false;
    const table = el('table', 'data-table'), thr = el('tr'); thr.append(el('th', '', 'Kho'), ...d.positions.map(p => el('th', '', p.name)), el('th', '', 'Kho riêng'));
    const thead = el('thead'); thead.append(thr); const tbody = el('tbody');
    for (const w of d.warehouses) {
      const tr = el('tr'); tr.dataset.id = w.id; tr.append(el('td', 'first', w.name));
      for (const p of d.positions) { const td = el('td'), c = input('checkbox'); c.checked = w.positions.includes(p.id); c.dataset.pos = p.id; c.setAttribute('aria-label', `${w.name} – ${p.name}`); td.append(c); tr.append(td); }
      const td = el('td'), c = input('checkbox'); c.checked = w.stockPrivate; c.dataset.private = '1'; c.setAttribute('aria-label', `${w.name} – kho riêng`); td.append(c); tr.append(td);
      tbody.append(tr);
    }
    table.append(thead, tbody);
    const wrap = el('div', 'table-wrap'); wrap.append(table);
    const save = btn('Lưu kho bán', 'btn primary', async () => {
      const warehouses = [...tbody.children].map(tr => ({ id: tr.dataset.id, positions: [...tr.querySelectorAll('input[data-pos]:checked')].map(c => c.dataset.pos), stockPrivate: tr.querySelector('input[data-private]').checked }));
      try { await api('/warehouse-sellers', 'PUT', { warehouses }); toast('Đã lưu kho bán theo chức vụ.'); } catch (e) { toast(e.message, 'err'); }
    });
    body.replaceChildren(wrap, save);
  }
  return { load };
}

import { initEarlyRequests } from './purchase-early-requests.js';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const button = (text, cls, action) => { const n = el('button', cls, text); n.type = 'button'; n.addEventListener('click', action); return n; };
const number = n => Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const date = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : 'Chưa hẹn';
const labelled = (text, node) => { const label = el('label', 'incoming-field'); label.append(el('span', 'muted small', text), node); return label; };

/** Incoming quantities and persisted draft → explicit supplier submission. */
export function initPurchaseIncoming({ api, host, go, onCreate = null }) {
  let data = null, offset = 0, pending = 0, mode = 'all', visible = false, timer, canRequest = false;
  const selected = new Map(), expanded = new Set();
  const kpis = el('div', 'incoming-kpis'), filters = el('div', 'incoming-filters');
  const search = el('input'); search.type = 'search'; search.placeholder = 'Tìm mã hàng hoặc tên sản phẩm'; search.setAttribute('aria-label', 'Tìm hàng đang về');
  const documentType = el('select'); documentType.setAttribute('aria-label','Loại phiếu');
  for(const [value,text] of [['all','Tất cả loại phiếu'],['purchase','Mua hàng'],['early','Lấy hàng trước']]){const option=el('option','',text);option.value=value;documentType.append(option);}
  documentType.value=onCreate?'purchase':'all';
  const supplier = el('select'); supplier.setAttribute('aria-label', 'Nhà cung cấp');
  const from = el('input'), to = el('input'); from.type = to.type = 'date';
  const chips = el('div', 'chips incoming-chips');
  for (const [key, title] of [['all', 'Tất cả'], ['late', 'Quá hẹn'], ['week', 'Hẹn trong 7 ngày'], ['selected', 'Đã chọn']]) {
    const b = button(title, 'chip', () => { mode = key; offset = 0; load(); }); b.dataset.mode = key; chips.append(b);
  }
  const documentField=labelled('Loại phiếu',documentType);documentField.hidden=!!onCreate;
  filters.append(labelled('Sản phẩm', search), documentField, labelled('NCC', supplier), labelled('Hẹn từ', from), labelled('Đến', to), chips);
  filters.append(button('Làm mới','btn secondary',()=>refresh()));
  const documentHint=el('p','muted small');
  const error = el('p', 'error incoming-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  const wrap = el('div', 'table-wrap'), table = el('table', 'data-table incoming-table'), thead = el('thead'), tbody = el('tbody'), hr = el('tr');
  for (const title of ['', 'Mã hàng', 'Tên sản phẩm', 'Đang về', 'Đơn mua / Phiếu lấy trước', 'Hẹn sớm nhất', 'Trạng thái', 'SL cần lấy trước']) hr.append(el('th', '', title));
  thead.append(hr); table.append(thead, tbody); wrap.append(table);
  const pagination = el('div', 'incoming-pagination'), pageLabel = el('span', 'muted small');
  const prev = button('← Trước', 'btn secondary small', () => { offset = Math.max(0, offset - 50); load(); });
  const next = button('Sau →', 'btn secondary small', () => { offset += 50; load(); }); pagination.append(pageLabel, prev, next);
  const footer = el('div', 'incoming-selection'), summary = el('div'), clear = button('Bỏ chọn', 'btn secondary', () => { selected.clear(); render(); if (mode === 'selected') load(); });
  const save = button(onCreate?'Tạo phiếu nháp':'Lưu và gửi NCC', 'btn primary', () => {
    if(documentType.value==='early'||!selectionSummary())return;
    const orderSources=Object.fromEntries([...selected].filter(([,r])=>r.sourceOrders?.length).map(([sku,r])=>[sku,r.sourceOrders.map(({orderNo,supplierOrderNo,quantity})=>({orderNo,supplierOrderNo,quantity}))]));
    const initial = {lines:[...selected].map(([sku,r])=>({sku,quantity:r.quantity,name:r.name,unit:r.unit})),scope:{supplierId:supplier.value,from:from.value,to:to.value,status:mode==='selected'?'all':mode,...(Object.keys(orderSources).length?{orderSources:JSON.stringify(orderSources)}:{})}};
    if(onCreate){void onCreate(initial);return;}
    history.newDraft(initial);
  }); save.disabled = true;
  const note = el('p', 'muted small', 'Các lựa chọn chưa được lưu hoặc gửi NCC.');
  note.setAttribute('role', 'alert');
  footer.append(summary, clear, save); host.append(kpis, filters, documentHint,error, wrap, pagination, footer, note);
  const historyHost=el('section','early-request-history');historyHost.hidden=!!onCreate;host.append(historyHost);
  const history=initEarlyRequests({api,host:historyHost,canWrite:()=>canRequest,onSaved:()=>{selected.clear();load();}});
  documentType.addEventListener('change',()=>{offset=0;if(mode==='selected')mode='all';expanded.clear();render();return load();});
  for (const node of [supplier, from, to]) node.addEventListener('change', () => { offset = 0; load(); });
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { offset = 0; load(); }, 200); });
  function fail(message) { error.textContent = message; error.hidden = !message; }
  function invalidSelection(r) {
    return !Number.isSafeInteger(r.quantity) || r.quantity <= 0 || r.quantity > r.max || !!r.sourceOrders?.some(s=>!Number.isSafeInteger(s.quantity)||s.quantity<=0||s.quantity>s.max)
      || !!r.sourceOrders?.length && r.sourceOrders.reduce((sum,s)=>sum+s.quantity,0)!==r.quantity;
  }
  function selectionSummary() {
    const values = [...selected.values()], invalid = values.some(invalidSelection);
    summary.textContent = `Đã chọn ${number(values.length)} mã · Tổng SL cần lấy trước ${number(values.reduce((sum,r) => sum + (Number(r.quantity) || 0), 0))}`;
    const problems = [...selected].filter(([,r]) => invalidSelection(r));
    note.classList.toggle('incoming-validation', problems.length > 0);
    note.textContent = problems.length ? 'Chưa thể lưu: ' + problems.slice(0,3).map(([sku,r]) => `${sku}: kiểm tra SL và số còn về của từng đơn đã chọn.`).join('; ') : 'Các lựa chọn chưa được lưu hoặc gửi NCC. Đã chọn đơn mua thì chỉ lấy hàng từ đúng các đơn đó; không tự chuyển sang đơn khác.';
    clear.disabled = !values.length; save.disabled = documentType.value==='early' || !canRequest || !data?.canSend || invalid || !values.length;
    return !invalid && values.length > 0;
  }
  const requestLabels={draft:'Nháp — chưa gửi NCC',pending:'Chờ NCC xác nhận',accepted:'NCC đồng ý',rejected:'NCC từ chối',mixed:'NCC phản hồi khác nhau'};
  function requestNode(request){
    const row=el('div','incoming-order incoming-early-order'),link=el('a','data-link',(request.ticketNumber||'Phiếu lấy trước')+' · '+new Date(request.createdAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}));
    link.href='#/purchases?mode=incoming&request='+encodeURIComponent(request.id);
    link.addEventListener('click',e=>{if(!e.ctrlKey&&!e.metaKey&&e.button===0){e.preventDefault();go(link.getAttribute('href'));}});
    row.append(link,el('span','',request.supplierName),el('span','',number(request.quantity)+' · '+requestLabels[request.status]),el('span','','Ngày lấy: '+date(request.pickupDate)));
    return row;
  }
  function render() {
    if (!data) return;
    documentHint.textContent=`${number(data.kpis.earlyRequests||0)} phiếu lấy trước · SL đã xin ${number(data.kpis.earlyQuantity||0)} (không cộng thêm vào Đang về). Bộ lọc ngày áp dụng ngày hẹn đơn mua nguồn; ngày lấy hiển thị trên từng phiếu.`;
    hr.children[7].textContent=documentType.value==='early'?'SL đã xin lấy trước':'SL cần lấy trước';
    kpis.replaceChildren();
    for (const [title, value] of [['Mã đang về', data.kpis.skus], ['Tổng SL đang về', data.kpis.quantity], ['Số NCC', data.kpis.suppliers], ['Số đơn quá hẹn', data.kpis.overdueOrders]]) {
      const card = el('div', 'card incoming-kpi'); card.append(el('span', 'muted small', title), el('strong', '', number(value))); kpis.append(card);
    }
    chips.querySelectorAll('button').forEach(b => { b.classList.toggle('active', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
    tbody.replaceChildren();
    if (!data.rows.length) { const tr = el('tr'), td = el('td', 'muted', 'Không có hàng đang về phù hợp bộ lọc.'); td.colSpan = 8; tr.append(td); tbody.append(tr); }
    for (const row of data.rows) {
      const tr = el('tr'), chosen = selected.get(row.sku); if (chosen) chosen.max = row.quantity;
      tr.classList.toggle('incoming-selected', !!chosen);
      const check = el('input'); check.type = 'checkbox'; check.checked = !!chosen; check.disabled = documentType.value==='early' || !canRequest || row.unitConflict || selected.size >= 300 && !chosen;
      check.setAttribute('aria-label', 'Chọn mã ' + row.sku);
      const checkCell = el('td'); checkCell.append(check);
      const code = el('td'), toggle = button(row.sku, 'incoming-code', () => { expanded.has(row.sku) ? expanded.delete(row.sku) : expanded.add(row.sku); render(); });
      toggle.setAttribute('aria-expanded', String(expanded.has(row.sku))); code.append(toggle);
      if(data.canViewStock){const lookup=el('a','small sup-sub','Tra tồn');lookup.href='#/stock-lookup?q='+encodeURIComponent(row.sku);code.append(lookup);}
      const name = el('td'); name.append(el('span', '', row.name || 'Chưa có tên'), el('small', 'muted sup-sub', 'ĐVT: ' + (row.unit || 'Chưa có dữ liệu')));
      if (row.importedMissingSource) name.append(el('small', 'sup-pill warn', 'Nhập Excel, thiếu chứng từ'));
      if (row.unitConflict) name.append(el('small', 'sup-pill warn', 'ĐVT không thống nhất; chưa thể xin lấy trước'));
      const orders = el('td');
      if(data.documentType!=='early')orders.append(el('span', '', `${number(row.orderCount)} đơn mua · ${row.supplierNames.join(', ')}`));
      const saved=row.earlyRequests||[];
      if(saved.length){orders.append(el('b','small',`${number(new Set(saved.map(r=>r.id)).size)} phiếu lấy trước · SL đã xin ${number(row.earlyQuantity)}`));for(const r of saved.slice(0,3))orders.append(requestNode(r));
        if(saved.length>3)orders.append(button(`Xem đủ ${number(saved.length)} phần phiếu lấy trước`,'btn ghost small',()=>{expanded.add(row.sku);render();}));}
      const due = el('td', row.late ? 'pur-late' : '', date(row.earliestDue) + (row.late ? ' · quá hẹn' : ''));
      const status = el('td'); status.append(el('span', 'sup-pill ' + (row.late ? 'warn' : ''), data.documentType==='early' ? (saved.every(r=>r.status===saved[0]?.status)?requestLabels[saved[0]?.status]:'NCC phản hồi khác nhau') : row.late ? 'Quá hẹn' : row.confirmed ? 'Đã xác nhận' : 'Chờ NCC xác nhận'));
      const qtyCell = el('td'), qty = el('input'); qty.type = 'number'; qty.min = '1'; qty.max = String(Math.floor(row.quantity)); qty.step = '1'; qty.placeholder = 'Nhập SL'; qty.value = chosen?.quantity ?? ''; qty.disabled = documentType.value==='early' || !canRequest || row.unitConflict;qty.hidden=documentType.value==='early';
      qty.setAttribute('aria-label', 'SL cần lấy trước mã ' + row.sku);
      const quantityError = el('small', 'error sup-sub'); quantityError.hidden = true; quantityError.id = 'incoming-error-' + encodeURIComponent(row.sku);
      quantityError.setAttribute('role', 'alert'); qty.setAttribute('aria-describedby',quantityError.id); qtyCell.append(qty, quantityError);if(documentType.value==='early')qtyCell.append(el('b','',number(row.earlyQuantity)));
      const validateQuantity = amount => {
        const valid = Number.isSafeInteger(amount) && amount > 0 && amount <= row.quantity;
        quantityError.textContent = valid || amount === null ? '' : amount > row.quantity ? `SL ${number(amount)} vượt số còn về ${number(row.quantity)}.` : `Nhập số nguyên từ 1 đến ${number(Math.floor(row.quantity))}.`;
        quantityError.hidden = !quantityError.textContent; qty.setCustomValidity(quantityError.textContent); qty.setAttribute('aria-invalid',String(!!quantityError.textContent));
      };
      if(data.documentType!=='early') {
        // A purchase may contain multiple lines of the same SKU; select the order once.
        const sources=new Map();
        for(const order of row.orders){const source=sources.get(order.id);if(source)source.quantity+=order.quantity;else sources.set(order.id,{...order});}
        if(chosen?.sourceOrders)for(const source of chosen.sourceOrders)source.max=sources.get(source.orderId)?.quantity||0;
        for(const order of sources.values()) {
          const sourceLine=el('div','incoming-source'),label=el('label','incoming-source-choice'),pick=el('input');pick.type='checkbox';
          const pinned=chosen?.sourceOrders?.find(s=>s.orderId===order.id);
          pick.checked=!!pinned;pick.disabled=check.disabled;pick.setAttribute('aria-label',`Lấy mã ${row.sku} từ ${order.ticketNumber}`);
          label.append(pick,el('span','',`${order.ticketNumber}${order.internalNo?' · NCC: '+order.internalNo:''} · còn ${number(order.quantity)} · hẹn ${date(order.due)}`));sourceLine.append(label);
          pick.addEventListener('change',()=>{
            const current=selected.get(row.sku),list=[...(current?.sourceOrders||[])].filter(s=>s.orderId!==order.id);
            if(pick.checked)list.push({orderId:order.id,orderNo:order.ticketNumber,supplierOrderNo:order.internalNo||'',quantity:Math.min(order.quantity,current?.sourceOrders?.length?1:current?.quantity||1),max:order.quantity});
            if(list.length)selected.set(row.sku,{quantity:list.reduce((sum,s)=>sum+s.quantity,0),max:row.quantity,name:row.name,unit:row.unit,sourceOrders:list});else selected.delete(row.sku);
            render();
          });
          if(pinned) {
            const sourceQty=el('input');sourceQty.type='number';sourceQty.min='1';sourceQty.max=String(Math.floor(order.quantity));sourceQty.step='1';sourceQty.value=pinned.quantity;sourceQty.disabled=pick.disabled;
            sourceQty.setAttribute('aria-label',`SL mã ${row.sku} lấy từ ${order.ticketNumber}`);
            const message=el('small','error sup-sub');message.setAttribute('role','alert');
            const validate=()=>{const valid=Number.isSafeInteger(pinned.quantity)&&pinned.quantity>0&&pinned.quantity<=order.quantity;message.textContent=valid?'':`Nhập số nguyên từ 1 đến ${number(Math.floor(order.quantity))}.`;message.hidden=valid;sourceQty.setCustomValidity(message.textContent);sourceQty.setAttribute('aria-invalid',String(!valid));};
            sourceQty.addEventListener('input',()=>{pinned.quantity=sourceQty.value===''?0:Number(sourceQty.value);const current=selected.get(row.sku);current.quantity=current.sourceOrders.reduce((sum,s)=>sum+s.quantity,0);qty.value=current.quantity;validate();validateQuantity(current.quantity);selectionSummary();});
            validate();sourceLine.append(sourceQty,message);
          }
          orders.append(sourceLine);
        }
        qty.readOnly=!!chosen?.sourceOrders?.length;
        if(qty.readOnly)qtyCell.append(el('small','muted sup-sub','Tổng SL từ các đơn đã chọn'));
        else orders.append(el('small','muted sup-sub','Chọn đơn để lấy đúng nguồn; chưa chọn sẽ tự phân bổ.'));
      }
      const update = () => {
        const amount = qty.value === '' ? null : Number(qty.value);
        if (!selected.has(row.sku) && selected.size >= 300 && amount !== null) { fail('Mỗi phiếu chọn tối đa 300 mã hàng.'); qty.value = ''; return; }
        if (amount === null) selected.delete(row.sku);
        else selected.set(row.sku, { quantity: amount, max: row.quantity, name:row.name,unit:row.unit });
        check.checked = amount !== null; tr.classList.toggle('incoming-selected', amount !== null);
        validateQuantity(amount); selectionSummary();
      };
      qty.addEventListener('input', update);
      validateQuantity(chosen?.quantity ?? null);
      check.addEventListener('change', () => { qty.value = check.checked ? (chosen?.quantity || 1) : ''; update(); });
      tr.append(checkCell, code, name, el('td', 'num', number(row.quantity)), orders, due, status, qtyCell); if(onCreate)[...tr.children].forEach((cell,i)=>cell.setAttribute('data-label',hr.children[i].textContent)); tbody.append(tr);
      if (expanded.has(row.sku)) {
        const detail = el('tr', 'incoming-details'), td = el('td'); td.colSpan = 8;
        const list = el('div', 'incoming-orders');
        for (const order of data.documentType==='early'?[]:row.orders) {
          const line = el('div', 'incoming-order'), link = el('a', '', order.ticketNumber); link.href = '#/purchases/' + encodeURIComponent(order.id) + '?mode=incoming';
          link.addEventListener('click', e => { if (!e.ctrlKey && !e.metaKey && e.button === 0) { e.preventDefault(); go(link.getAttribute('href')); } });
          const supplierNode=el(data.canViewSuppliers&&order.supplierId?'a':'span','',order.supplierName);
          if(supplierNode.tagName==='A')supplierNode.href='#/suppliers/'+encodeURIComponent(order.supplierId);
          line.append(link, supplierNode, el('span', '', number(order.quantity) + ' ' + (order.unit || '')), el('span', '', date(order.due)));
          if (order.importedMissingSource) line.append(el('small', 'sup-pill warn', 'Nhập Excel, thiếu chứng từ'));
          list.append(line);
        }
        for(const request of saved)list.append(requestNode(request));
        td.append(list); detail.append(td); tbody.append(detail);
      }
    }
    footer.hidden = note.hidden = !canRequest || documentType.value==='early';
    pageLabel.textContent = data.total ? `${number(data.offset + 1)}–${number(data.offset + data.rows.length)} / ${number(data.total)} mã` : '0 mã';
    prev.disabled = offset === 0; next.disabled = offset + 50 >= data.total; selectionSummary();
  }
  async function load() {
    if (!visible) return;
    const request = ++pending; fail(''); host.setAttribute('aria-busy', 'true');
    const params = new URLSearchParams({ type:documentType.value,q: search.value.trim(), supplierId: supplier.value, from: from.value, to: to.value, status: mode === 'selected' ? 'all' : mode, limit: '50', offset: String(offset) });
    if (mode === 'selected') { params.set('selected', '1'); for (const sku of selected.keys()) params.append('sku', sku); }
    try {
      const result = await api('/purchase-incoming?' + params);
      if (request !== pending || !visible) return;
      if(documentType.value!=='all'&&result.documentType!==documentType.value)throw Error('Máy chủ chưa hỗ trợ bộ lọc loại phiếu. Vui lòng tải lại sau khi API cập nhật.');
      data = result; canRequest = !!result.canRequest;
      const id = supplier.value; supplier.replaceChildren(); const all = el('option', '', 'Tất cả NCC'); all.value = ''; supplier.append(all);
      for (const s of result.suppliers) { const option = el('option', '', s.name); option.value = s.id; supplier.append(option); } supplier.value = id;
      render();
    } catch (e) { if (request === pending && visible) fail(e.message || 'Không tải được hàng đang về.'); }
    finally { if (request === pending) host.setAttribute('aria-busy', 'false'); }
  }
  async function refresh(){if(!visible)return;await load();if(!onCreate)await history.load();}
  return {refresh, async show(id='') { visible = true; host.hidden = false; await load();if(!onCreate){if(id)await history.open(id);else await history.load();} }, hide() { visible = false; ++pending; clearTimeout(timer); host.hidden = true; } };
}

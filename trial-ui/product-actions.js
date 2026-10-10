import { normalizeHeader, findHeader, parseProductFile } from './product-file.js';

let excelPromise;
function excel() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  return excelPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = new URL('./xlsx.full.min.js', import.meta.url).href;
    script.onload = () => resolve(globalThis.XLSX);
    script.onerror = () => { excelPromise = null; script.remove(); reject(Error('Không tải được bộ đọc Excel. Tải lại trang rồi thử lại.')); };
    document.head.append(script);
  });
}

export function initProductActions(deps) {
  const { api, esc, money, toast, isManager } = deps;
  const number = n => Number(n || 0).toLocaleString('vi-VN');
  function modal(title, body) {
    const dlg = document.createElement('dialog'); dlg.className = 'modal';
    dlg.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">×</button></div><div class="modal-body" data-body>${body}</div><div class="modal-foot" data-foot><button type="button" class="btn secondary" data-close>Đóng</button></div>`;
    dlg.querySelectorAll('[data-close]').forEach(b => b.onclick = () => dlg.close());
    dlg.addEventListener('close', () => dlg.remove()); document.body.append(dlg); dlg.showModal(); return dlg;
  }
  const table = (headers, rows) => `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(v => `<td>${esc(v ?? '—')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}">Không có dữ liệu.</td></tr>`}</tbody></table></div>`;

  async function report(kind) {
    if (!isManager()) return;
    const dlg = modal(kind === 'value' ? 'Giá trị tồn kho' : 'Kiểm tra dữ liệu', '<p role="status">Đang tải…</p>'), body = dlg.querySelector('[data-body]');
    let request = 0;
    async function draw(policy = deps.policy()) {
      const ticket = ++request;
      try {
        const d = await api('/admin/products/report?policy=' + encodeURIComponent(policy || ''));
        if (!dlg.isConnected || ticket !== request) return;
        const selector = `<label>Chính sách giá<select data-policy>${d.policies.map(p => `<option value="${esc(p.id)}" ${p.id === d.policy?.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`;
        if (kind === 'value') body.innerHTML = selector + `<p>Dùng giá từng SKU × tồn dương tại các kho thực, chưa cộng thêm VAT. Tồn NCC và hàng chờ về không tính vào tổng.</p><h3>Tổng: ${money(d.summary.totalValue)}</h3>` + table(['Kho', 'Số lượng', 'SKU có giá', 'SKU thiếu giá', 'Giá trị'], d.inventory.map(w => [w.warehouse, number(w.units), number(w.priced), number(w.missingPrice), money(w.value)])) + '<p class="muted small">Mã có tồn nhưng thiếu giá được bỏ khỏi tổng. Giá bằng 0 vẫn là giá hợp lệ.</p>';
        else body.innerHTML = selector + `<p>${number(d.summary.products)} sản phẩm · thiếu quy cách: ${number(d.summary.missingPackaging)} · thiếu giá: ${number(d.summary.missingPrice)} · mã tồn âm: ${number(d.summary.negativeStock)} · chưa có tồn dương ở kho thực: ${number(d.summary.zeroStock)}.</p><p class="muted small">File tồn gần nhất: ${esc(d.lastImport?.filename || 'Chưa nhập file')}${d.lastImport ? ' · ' + esc(new Date(d.lastImport.observedAt).toLocaleString('vi-VN')) : ''}. Mỗi nhóm dưới đây hiển thị tối đa 50 dòng.</p><h3>Thiếu quy cách đóng thùng</h3>` + table(['SKU', 'Tên', 'Thương hiệu'], d.samples.missingPackaging.map(p => [p.sku, p.name, p.brand])) + '<h3>Thiếu giá theo bảng giá đang chọn</h3>' + table(['SKU', 'Tên', 'Thương hiệu'], d.samples.missingPrice.map(p => [p.sku, p.name, p.brand])) + '<h3>Tồn âm</h3>' + table(['SKU', 'Tên', 'Kho', 'Tồn'], d.samples.negativeStock.map(p => [p.sku, p.name, p.warehouse, number(p.quantity)])) + '<form data-sku-form><label>Tra SKU và lịch sử<input name="sku" required maxlength="500" placeholder="Nhập mã sản phẩm"></label><button class="btn secondary">Tra cứu</button></form><div data-sku-result></div>';
        body.querySelector('[data-policy]').onchange = e => draw(e.target.value);
        body.querySelector('[data-sku-form]')?.addEventListener('submit', async e => {
          e.preventDefault(); const box = body.querySelector('[data-sku-result]'), sku = e.target.elements.sku.value.trim(); box.textContent = 'Đang tra cứu…';
          try { const [p, h] = await Promise.all([api('/products/' + encodeURIComponent(sku)), api('/products/' + encodeURIComponent(sku) + '/history')]);
            box.innerHTML = `<h3>${esc(p.product.sku)} · ${esc(p.product.name)}</h3>` + table(['Ngày', 'Loại', 'Số lượng', 'Chứng từ'], h.history.map(r => [new Date(r.occurredAt).toLocaleString('vi-VN'), r.kind, number(r.qty), r.refCode]));
          } catch (ex) { box.textContent = ex.message; }
        });
      } catch (ex) { if (ticket === request && dlg.isConnected) body.textContent = ex.message; }
    }
    draw();
  }

  async function openImport(kind) {
    if (!isManager()) return;
    let book, rows = [], hiddenRows = [], preview = null, busy = false;
    const stock = kind === 'stock', stores = deps.warehouses().length ? deps.warehouses() : (await api('/products?limit=1')).warehouses;
    const dlg = modal(stock ? 'Cập nhật tồn kho từ file' : 'Cập nhật quy cách Lock từ file', `<p>${stock ? 'Chỉ cập nhật mã hàng và tồn; ô trống giữ nguyên, số 0 cập nhật về 0. Bỏ qua dòng ẩn; mã trùng lấy tồn lớn nhất, làm tròn số nguyên.' : 'Khớp SKU thuộc Lock. Lấy SP/thùng từ QTY/BOX, kg/thùng từ G.W và đổi kích thước mm sang cm. Ô trống hoặc 0 giữ nguyên.'} Tối đa 5.000 mã và 20 MB mỗi lượt.</p><button class="btn secondary small" type="button" data-template>Tải file mẫu Excel</button><div class="form-grid cols-2"><label>File Excel / CSV<input type="file" data-file accept=".xlsx,.xls,.csv"></label><label>Trang tính<select data-sheet></select></label><label>Dòng tiêu đề<input type="number" data-header min="1" max="200" value="1"></label>${stock ? `<label>Thời điểm số liệu tồn<input type="datetime-local" data-date required></label><label>Kho nhận cột Tồn<select data-target>${stores.map(w => `<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('')}</select></label>` : '<label>Đơn vị kích thước trong file<select data-unit><option value="mm">mm → cm</option><option value="cm">cm</option></select></label>'}</div><div class="form-grid cols-2" data-mapping></div><p class="error" role="alert" data-status></p><div data-preview></div>`);
    const $ = s => dlg.querySelector(s);
    $('[data-foot]').insertAdjacentHTML('beforeend', '<button type="button" class="btn secondary" data-review disabled>Xem trước</button><button type="button" class="btn primary" data-apply disabled>Xác nhận cập nhật</button>');
    function invalidate() { preview = null; $('[data-apply]').disabled = true; $('[data-preview]').innerHTML = ''; }
    function lock(value) { busy = value; dlg.querySelectorAll('input, select, button').forEach(el => el.disabled = value); if (!value) { $('[data-review]').disabled = !rows.length; $('[data-apply]').disabled = !preview; } }
    dlg.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    if (stock) { const now = new Date(); $('[data-date]').value = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16); $('[data-target]').value = stores.find(w => w.kind === 'supplier')?.id || stores[0]?.id || ''; }
    const packingFields = [['perCarton', 'SP/thùng', ['qtybox', 'qtyperbox', 'spthung']], ['cartonWeight', 'Kg/thùng', ['gw', 'kgthung']], ['cartonLength', 'Dài', ['daimm', 'dai', 'length']], ['cartonWidth', 'Rộng', ['rongmm', 'rong', 'width']], ['cartonHeight', 'Cao', ['caomm', 'cao', 'height']]];
    function mapping() {
      invalidate(); const h = rows[Number($('[data-header]').value) - 1] || [], labels = h.map(normalizeHeader);
      const find = names => labels.findIndex(l => names.includes(l));
      const cols = [['sku', 'Mã SKU', find(['sku', 'masku', 'mahang', 'masanpham', 'itemname'])]];
      if (stock) {
        const quantity = find(['ton', 'tonkho', 'soluongton', 'toncuoiky', 'toncuoi', 'stock', 'quantity', 'qty']);
        for (const w of stores) cols.push([w.id, w.name, w.id === $('[data-target]').value && quantity >= 0 ? quantity : labels.indexOf(normalizeHeader(w.name))]);
      } else {
        const parent = (rows[Number($('[data-header]').value) - 2] || []).map(normalizeHeader), dimStart = parent.findIndex(l => l.includes('sizedimensionmm'));
        for (const [name, label, aliases] of packingFields) {
          let index = find(aliases);
          if (index < 0 && dimStart >= 0 && ['cartonLength', 'cartonWidth', 'cartonHeight'].includes(name)) index = dimStart + ['cartonLength', 'cartonWidth', 'cartonHeight'].indexOf(name);
          cols.push([name, label, index]);
        }
      }
      $('[data-mapping]').innerHTML = cols.map(([name, label, selected]) => `<label>${esc(label)}<select data-column="${esc(name)}"><option value="">Không cập nhật</option>${h.map((value, i) => `<option value="${i}" ${i === selected ? 'selected' : ''}>${i + 1} · ${esc(value || 'Cột ' + (i + 1))}</option>`).join('')}</select></label>`).join('');
      $('[data-mapping]').querySelectorAll('select').forEach(s => s.onchange = invalidate);
    }
    function sheet() {
      const ws = book.Sheets[$('[data-sheet]').value];
      const ref = ws['!fullref'] || ws['!ref']; if (ref && globalThis.XLSX.utils.decode_range(ref).e.r > 50040) throw Error('Trang tính quá lớn. Chia nhỏ file trước khi nhập.');
      rows = globalThis.XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: true, range: 0 }); hiddenRows = ws['!rows'] || [];
      if (stock) {
        const date = rows.slice(0, 6).flat().map(String).find(v => /Ngày lập báo cáo:/i.test(v))?.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
        if (date) $('[data-date]').value = `${date[3]}-${date[2]}-${date[1]}T${date[4]}:${date[5]}`;
      }
      const header = findHeader(rows); if (header < 0) { rows = []; throw Error('Không tìm thấy tiêu đề SKU / Mã hàng / Item name trong 200 dòng đầu.'); }
      $('[data-header]').value = header + 1; mapping();
    }
    $('[data-file]').onchange = async e => {
      invalidate(); rows = []; book = null; $('[data-review]').disabled = true; const file = e.target.files[0]; if (!file) return;
      lock(true); try { if (file.size > 20000000) throw Error('Chọn file dưới 20 MB.'); const x = await excel(); book = x.read(await file.arrayBuffer(), { type: 'array', raw: true, cellStyles: true, cellDates: false, sheetRows: 50041 });
        $('[data-sheet]').innerHTML = book.SheetNames.filter((name, i) => !book.Workbook?.Sheets?.[i]?.Hidden).map(name => `<option>${esc(name)}</option>`).join('');
        const detected = [...$('[data-sheet]').options].find(o => findHeader(x.utils.sheet_to_json(book.Sheets[o.value], { header: 1, defval: null, raw: true, blankrows: true, range: 0 }).slice(0, 200)) >= 0);
        if (detected) $('[data-sheet]').value = detected.value;
        if (!$('[data-sheet]').options.length) throw Error('File không có trang tính hiển thị.'); sheet(); $('[data-status]').textContent = 'Đã đọc file. Kiểm tra các cột, rồi bấm Xem trước.';
      } catch (ex) { rows = []; $('[data-status]').textContent = ex.message; } finally { lock(false); }
    };
    $('[data-sheet]').onchange = () => { try { sheet(); } catch (ex) { invalidate(); rows = []; $('[data-status]').textContent = ex.message; } $('[data-review]').disabled = !rows.length; };
    $('[data-header]').onchange = mapping;
    if (stock) { $('[data-target]').onchange = mapping; $('[data-date]').onchange = invalidate; } else $('[data-unit]').onchange = invalidate;
    $('[data-template]').onclick = async () => {
      try { const x = await excel(), ws = x.utils.aoa_to_sheet(stock ? [['Mã hàng', 'Tồn']] : [['Item name', 'QTY/BOX', 'G.W', 'Dài (mm)', 'Rộng (mm)', 'Cao (mm)']]), b = x.utils.book_new(); x.utils.book_append_sheet(b, ws, 'Du lieu'); x.writeFile(b, stock ? 'Mau-ton-kho.xlsx' : 'Mau-quy-cach-Lock.xlsx'); } catch (ex) { $('[data-status]').textContent = ex.message; }
    };
    $('[data-review]').onclick = async () => {
      if (busy) return; invalidate(); lock(true);
      try {
        const selected = Object.fromEntries([...dlg.querySelectorAll('[data-column]')].map(el => [el.dataset.column, el.value === '' ? null : Number(el.value)]));
        const parsed = parseProductFile(rows, Number($('[data-header]').value) - 1, selected, kind, hiddenRows, $('[data-unit]')?.value);
        const input = { rows: parsed.rows, filename: $('[data-file]').files[0].name };
        if (stock) { const date = new Date($('[data-date]').value); if (!Number.isFinite(date.getTime())) throw Error('Nhập thời điểm số liệu tồn.'); input.observedAt = date.toISOString(); }
        const p = await api('/admin/products/import/' + kind + '/preview', 'POST', input);
        preview = p.matched ? { ...input, version: p.version } : null;
        $('[data-status]').textContent = `${number(p.matched)} mã sẽ cập nhật · ${number(p.unknownCount)} mã không có · ${number(p.notLockCount)} mã không thuộc Lock · ${number(p.ambiguousCount)} mã không xác định · ${number(parsed.blanks)} ô trống/0 quy cách giữ nguyên · ${number(parsed.hidden)} dòng ẩn bỏ qua · ${number(parsed.duplicates)} mã trùng.`;
        $('[data-preview]').innerHTML = table(stock ? ['SKU', 'Kho', 'Tồn cũ', 'Tồn mới'] : ['SKU', 'Quy cách cũ', 'Quy cách mới'], p.samples.map(s => stock ? [s.sku, s.warehouse, s.before, s.after] : [s.sku, JSON.stringify(s.before), JSON.stringify(s.after)])) + (p.unknown.length ? `<p>Mã không tìm thấy (tối đa 100): ${p.unknown.map(esc).join(', ')}</p>` : '');
      } catch (ex) { $('[data-status]').textContent = ex.message; } finally { lock(false); }
    };
    $('[data-apply]').onclick = async () => {
      if (!preview || busy) return; lock(true);
      try { const p = await api('/admin/products/import/' + kind + '/apply', 'POST', preview); invalidate(); $('[data-status]').textContent = `Đã cập nhật ${number(p.matched)} mã lúc ${new Date(p.updatedAt).toLocaleString('vi-VN')}.`; toast('Đã cập nhật ' + (stock ? 'tồn kho.' : 'quy cách Lock.')); deps.onChanged(); }
      catch (ex) { invalidate(); $('[data-status]').textContent = ex.message + ' Xem trước lại trước khi gửi tiếp.'; } finally { lock(false); }
    };
  }
  return { report, openImport };
}

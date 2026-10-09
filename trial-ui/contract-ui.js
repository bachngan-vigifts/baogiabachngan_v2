// HĐKT theo mẫu Word của web báo giá cũ: xem trước + chỉnh sửa rồi tải.
// Bộ tải về là 1 file .zip gồm 3 file Word: HDKT.docx (hợp đồng), TAM_UNG.docx (đề nghị tạm ứng), BBNT.docx (biên bản nghiệm thu).
// Dựng file: contract-document.js (chép web cũ, mẫu .docx + thay <<[Trường]>>). Chỉnh trực tiếp: contract-word-edit.js (lưu theo đoạn văn).
// Xem trước: docx-preview (+ jszip) chạy trong khung iframe cùng nguồn. Thông tin điền mẫu và các đoạn đã sửa lưu vào HĐKT (`data`).
const esc = v => String(v ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const loaded = new Map();
const script = src => loaded.get(src) || loaded.set(src, new Promise((resolve, reject) => {
  const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => { loaded.delete(src); reject(Error('Không tải được ' + src + '. Vui lòng tải lại trang.')); }; document.head.append(s);
})).get(src);
const loadBuilder = async () => { await script('fflate.min.js'); await script('contract-word-edit.js'); await script('contract-document.js'); };
const loadPreview = async () => { await script('jszip.min.js'); await script('docx-preview.min.js'); };

export const DOCS = [['HDKT', 'Hợp đồng kinh tế'], ['TAM_UNG', 'Đề nghị tạm ứng'], ['BBNT', 'Biên bản bàn giao & nghiệm thu']];
const FIELDS = [['representativeName', 'Người đại diện bên A'], ['representativeTitle', 'Chức vụ'], ['signedDate', 'Ngày ký', 'date'], ['depositRate', 'Tỷ lệ tạm ứng / đặt cọc (%)', 'number'],
  ['paymentDays', 'Số ngày thanh toán phần còn lại', 'number'], ['deliveryTime', 'Thời gian giao hàng', 'area'], ['deliveryAddress', 'Địa điểm giao hàng', 'area'], ['paymentMethod', 'Phương thức thanh toán', 'area']];

const dmy = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

/** Thông tin điền mẫu mặc định: lấy từ HĐKT + đơn; phần đã lưu trước (data.details) được giữ. */
export function contractDetails(detail) {
  const o = detail.order, k = detail.contract, saved = k?.data?.details || {};
  return {
    representativeName: o.contact || '', representativeTitle: '', signedDate: k?.signedDate || todayIso(), depositRate: k?.depositRate ?? 0, paymentDays: k?.paymentDays ?? 0,
    deliveryTime: o.expectedDeliveryDate ? 'Giao hàng ngày ' + dmy(o.expectedDeliveryDate) : 'Theo thỏa thuận của hai bên.', deliveryAddress: k?.deliveryAddress || o.address || '',
    paymentMethod: k?.paymentMethod || 'Chuyển khoản.', ...saved,
    // Tỉ lệ cọc và số ngày thanh toán phần còn lại luôn theo HĐKT đã lập (khớp kỳ công nợ), không lấy bản lưu cũ.
    depositRate: k?.depositRate ?? 0, paymentDays: k?.paymentDays ?? 0,
  };
}

/** Đổi đơn + HĐKT (+ dòng báo giá để lấy Bộ gồm / In ấn / Đóng gói) sang dạng báo giá mà bộ dựng của web cũ dùng. */
function legacyQuote(detail, quoteRows, edits) {
  const o = detail.order, k = detail.contract;
  const rows = (quoteRows || []).filter(r => String(r.name || '').trim() && Number(r.qty) > 0);
  return {
    quote_type: k?.legalEntity === 'VG' ? 'VIGIFTS' : o.quoteType === 'VIGIFTS' ? 'B2B' : o.quoteType, quote_number: o.quoteNo, quote_date: k?.signedDate || todayIso(), notes: '',
    subtotal: o.subtotal, vat_amount: o.tax, total: o.total,
    customer: { name: o.customerName, address: o.address, tax_code: o.taxCode, contact_name: o.contact, customer_code: o.customerCode },
    items: detail.lines.map((l, i) => ({ name: l.name, unit: l.unit, quantity: l.qty, price_after_discount: l.unitPrice, line_total: l.amount, tax_percent: l.taxRate,
      bundle_contents: rows[i]?.bundleContents || '', print_description: rows[i]?.printDescription || '', packaging_description: rows[i]?.packagingDescription || '' })),
    contract_word_edits: edits.HDKT || [], contract_document_edits: { TAM_UNG: edits.TAM_UNG || [], BBNT: edits.BBNT || [] },
  };
}

const templateBytes = new Map();
async function templatesFor(quote) {
  return Promise.all(globalThis.ContractDocument.templatesFor(quote).map(async t => {
    if (!templateBytes.has(t.path)) {
      const res = await fetch(t.path); if (!res.ok) throw Error('Không tải được mẫu biểu HĐKT.');
      templateBytes.set(t.path, await res.arrayBuffer());
    }
    return { ...t, templateBytes: templateBytes.get(t.path) };
  }));
}
const saveBlob = (bytes, name, type) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
const cleanDetails = d => ({ ...d, depositRate: Number(d.depositRate), paymentDays: Number(d.paymentDays) });

/**
 * Mở hộp xem / sửa / tải HĐKT. `api(path, method, body)` gọi máy chủ; `onSaved()` tải lại đơn sau khi lưu.
 */
export async function openContractDocs({ detail, api, toast, onSaved }) {
  const k = detail.contract; if (!k) return;
  const canEdit = k.canEdit === true, canEditFinancial = k.canEditFinancial === true;
  const dlg = document.createElement('dialog'); dlg.className = 'modal xwide contract-docs';
  dlg.innerHTML = `<div class="modal-head"><div><span class="eyebrow">HĐKT ${esc(k.contractNo)}</span><h2>${canEdit ? 'Xem, chỉnh sửa và tải hồ sơ HĐKT' : 'Xem và tải hồ sơ HĐKT'}</h2></div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
    <div class="modal-body cd-body">
      <aside class="cd-form"><h3>Thông tin điền mẫu</h3><p class="muted small">Dùng chung cho cả 3 hồ sơ. ${canEditFinancial ? 'Manager được sửa tỷ lệ cọc và số ngày thanh toán; khi lưu, kỳ công nợ sẽ cập nhật theo.' : 'Tỷ lệ cọc và số ngày thanh toán lấy theo HĐKT đã lập.'} Đổi thông tin rồi bấm <b>Cập nhật bản xem</b>. Khi đã sửa chữ trực tiếp trên trang, cần <b>Dựng lại</b> hồ sơ đó để nhận thông tin mới.</p>
        ${FIELDS.map(([f, label, type]) => `<label><span>${label}</span>${type === 'area' ? `<textarea rows="2" data-d="${f}"></textarea>` : `<input data-d="${f}" type="${type || 'text'}" ${type === 'number' ? 'min="0"' : ''}>`}</label>`).join('')}
        <button type="button" class="btn secondary small" data-refresh>Cập nhật bản xem</button></aside>
      <section class="cd-preview"><div class="cd-tabs chips" role="tablist">${DOCS.map(([t, label], i) => `<button type="button" class="chip" role="tab" data-doc="${t}" aria-selected="${i === 0}">${label}</button>`).join('')}</div>
        <p class="muted small" data-status>Đang dựng bản xem…</p>
        <div class="row-gap cd-tools"><button type="button" class="btn ghost small" data-rebuild title="Bỏ các chỗ sửa trực tiếp của hồ sơ này, dựng lại từ thông tin điền mẫu">Dựng lại hồ sơ này</button><button type="button" class="btn ghost small" data-print>In hồ sơ này</button><button type="button" class="btn ghost small" data-one>Tải file Word này</button></div>
        <iframe class="cd-frame" title="Bản xem HĐKT"></iframe></section>
    </div>
    <div class="modal-foot"><span class="muted small" data-dirty></span><button type="button" class="btn secondary" data-x>Đóng</button><button type="button" class="btn secondary" data-save>Lưu chỉnh sửa</button><button type="button" class="btn primary" data-zip>Tải bộ 3 file (.zip)</button></div>`;
  document.body.append(dlg); dlg.showModal();
  const $d = s => dlg.querySelector(s), status = t => { $d('[data-status]').textContent = t; };
  const details = contractDetails(detail), edits = { HDKT: [], TAM_UNG: [], BBNT: [], ...(k.data?.edits || {}) };
  let current = 'HDKT', dirty = false, quoteRows = null, renderSeq = 0;
  for (const el of dlg.querySelectorAll('[data-d]')) {
    el.value = details[el.dataset.d] ?? '';
    if (!canEdit || (['depositRate', 'paymentDays'].includes(el.dataset.d) && !canEditFinancial)) { el.readOnly = true; el.title = 'Theo HĐKT đã lập (khớp kỳ công nợ)'; continue; }
    el.addEventListener('input', () => { details[el.dataset.d] = el.value; markDirty(); });
  }
  for (const selector of ['[data-save]', '[data-refresh]', '[data-rebuild]']) $d(selector).hidden = !canEdit;
  const markDirty = () => { dirty = true; $d('[data-dirty]').textContent = 'Có thay đổi chưa lưu'; };
  const close = () => { if (dirty && !confirm('Đóng mà không lưu các chỉnh sửa?')) return; dlg.close(); dlg.remove(); };
  dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close)); dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });

  const quote = () => legacyQuote(detail, quoteRows, edits);
  async function buildDoc(type, withEdits = true) {
    const q = quote(); if (!withEdits) { q.contract_word_edits = []; q.contract_document_edits = {}; }
    const t = (await templatesFor(q)).find(x => x.file === type);
    return globalThis.ContractDocument.build({ quote: q, contractNumber: k.contractNo, details: cleanDetails(details), templateBytes: t.templateBytes, documentType: type });
  }
  async function render() {
    const seq = ++renderSeq; status('Đang dựng bản xem từ file Word…');
    try {
      await Promise.all([loadBuilder(), loadPreview()]);
      if (!quoteRows) quoteRows = detail.order.quoteId ? (await api('/quotes/' + encodeURIComponent(detail.order.quoteId)).catch(() => null))?.data?.rows || [] : [];
      const base = await buildDoc(current, false), prepared = await globalThis.ContractWordEdit.prepare(base, edits[current]);
      if (seq !== renderSeq) return;
      const frame = $d('.cd-frame'), doc = frame.contentDocument;
      doc.open(); doc.write('<!doctype html><html lang="vi"><head><meta charset="utf-8"><style>body{margin:0;background:#edf0f5}.docx-wrapper{padding:16px!important}[data-word-index]{outline:1px dashed transparent;outline-offset:3px;cursor:text}[data-word-index]:hover{outline-color:#9db8e0}[data-word-index]:focus{outline-color:#2459a9;background:#f3f7fd}[data-word-index].edited{background:#fff8e6}@media print{@page{size:A4;margin:0}body{background:#fff}.docx-wrapper{padding:0!important;background:#fff!important;zoom:1!important}section.docx{box-shadow:none!important;margin:0!important;break-after:page}section.docx:last-child{break-after:auto}}</style></head><body><main></main></body></html>'); doc.close();
      await globalThis.docx.renderAsync(prepared.preview, doc.querySelector('main'), undefined, { inWrapper: true, hideWrapperOnPrint: true, breakPages: true, ignoreLastRenderedPageBreak: false, renderAltChunks: false, useBase64URL: true });
      if (seq !== renderSeq) return;
      const wrapper = doc.querySelector('.docx-wrapper'); if (wrapper) wrapper.style.zoom = String(Math.min(1, Math.max(0.35, (frame.clientWidth - 32) / 794)));
      for (const info of prepared.paragraphs) {
        const p = doc.getElementById('bnword_' + info.index)?.closest('p'); if (!p) continue;
        if (!canEdit) continue;
        p.contentEditable = 'plaintext-only'; p.dataset.wordIndex = String(info.index);
        if (edits[current].some(e => e.index === info.index)) p.classList.add('edited');
        const record = () => {
          edits[current] = [...edits[current].filter(e => e.index !== info.index), { index: info.index, hash: info.hash, text: p.innerText }].sort((a, b) => a.index - b.index);
          p.classList.add('edited'); markDirty();
        };
        p.addEventListener('input', record);
        // Xoá hết chữ của một dòng (không nằm trong ô bảng) = xoá hẳn dòng đó: ẩn ngay, file Word bỏ đoạn này (ContractWordEdit).
        const dropIfEmpty = () => { if (p.innerText.trim() || p.closest('td')) return false; p.textContent = ''; record(); p.style.display = 'none'; return true; };
        p.addEventListener('keydown', e => { if ((e.key === 'Backspace' || e.key === 'Delete') && !p.innerText.trim() && dropIfEmpty()) e.preventDefault(); });
        p.addEventListener('blur', () => { if (p.classList.contains('edited')) dropIfEmpty(); });
        if (!p.innerText.trim() && p.classList.contains('edited') && !p.closest('td')) p.style.display = 'none';
      }
      if (!canEdit) { status('HĐKT đã duyệt: nhân viên chỉ được xem và tải. Chỉ Manager được chỉnh sửa.'); return; }
      status('Bấm vào đoạn văn hoặc ô bảng để sửa trực tiếp; xoá hết chữ một dòng rồi bấm Backspace để bỏ hẳn dòng đó. Sửa chữ không tự tính lại giá / thuế. Ngắt trang có thể khác Microsoft Word.' + (edits[current].length ? ` · Hồ sơ này có ${edits[current].length} đoạn đã sửa.` : ''));
    } catch (e) { if (seq === renderSeq) status(e.message); }
  }
  dlg.querySelectorAll('[data-doc]').forEach(b => b.addEventListener('click', () => {
    current = b.dataset.doc; dlg.querySelectorAll('[data-doc]').forEach(x => x.setAttribute('aria-selected', String(x === b))); render();
  }));
  $d('[data-refresh]').addEventListener('click', render);
  $d('[data-rebuild]').addEventListener('click', () => { if (!edits[current].length || confirm('Bỏ các chỗ đã sửa trực tiếp của hồ sơ này?')) { edits[current] = []; markDirty(); render(); } });
  $d('[data-print]').addEventListener('click', () => $d('.cd-frame').contentWindow.print());
  $d('[data-save]').addEventListener('click', async e => {
    if (!canEdit) return;
    e.target.disabled = true;
    try { await api('/contracts/' + encodeURIComponent(k.id), 'PUT', { revision: k.revision, signedDate: details.signedDate, paymentMethod: details.paymentMethod, deliveryAddress: details.deliveryAddress, ...(canEditFinancial ? { depositRate: Number(details.depositRate), paymentDays: Number(details.paymentDays) } : {}), details: { ...(k.data || {}), details: cleanDetails(details), edits } }); k.revision += 1; dirty = false; $d('[data-dirty]').textContent = 'Đã lưu'; toast('Đã lưu hồ sơ HĐKT.'); onSaved?.(); }
    catch (ex) { toast(ex.message, 'err'); } finally { e.target.disabled = false; }
  });
  const wordName = type => `${type}_${String(k.contractNo).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^a-zA-Z0-9]+/g, '-')}.docx`;
  $d('[data-one]').addEventListener('click', async e => {
    e.target.disabled = true;
    try { await loadBuilder(); saveBlob(await buildDoc(current), wordName(current), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); }
    catch (ex) { toast(ex.message, 'err'); } finally { e.target.disabled = false; }
  });
  $d('[data-zip]').addEventListener('click', async e => {
    e.target.disabled = true;
    try {
      await loadBuilder(); const q = quote();
      const pack = await globalThis.ContractDocument.buildPack({ quote: q, contractNumber: k.contractNo, details: cleanDetails(details), templateFiles: await templatesFor(q) });
      saveBlob(pack.bytes, `${pack.folder}.zip`, 'application/zip');
    } catch (ex) { toast(ex.message, 'err'); } finally { e.target.disabled = false; }
  });
  render();
}



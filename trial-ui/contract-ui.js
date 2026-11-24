import {customerProvince} from './customer-province.js';
import {MAX_TEMPLATE_BYTES} from './contract-source-policy.js';
import {printingInfo} from './quote-math.js';
import {initContractFormatting,paragraphRuns} from './contract-format.js';
// HĐKT theo mẫu Word của web báo giá cũ: xem trước + chỉnh sửa rồi tải.
// Bộ tải về là 1 file .zip gồm 3 file Word: HDKT.docx (hợp đồng), TAM_UNG.docx (đề nghị tạm ứng), BBNT.docx (biên bản nghiệm thu).
// Dựng file: contract-document.js (chép web cũ, mẫu .docx + thay <<[Trường]>>). Chỉnh trực tiếp: contract-word-edit.js (lưu theo đoạn văn).
// Xem trước: docx-preview (+ jszip) chạy trong khung iframe cùng nguồn. Thông tin điền mẫu và các đoạn đã sửa lưu vào HĐKT (`data`).
const esc = v => String(v ?? '').normalize('NFC').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const loaded = new Map();
const script = (src, refresh = false) => {
  if (!refresh && loaded.has(src)) return loaded.get(src);
  const task = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src + (refresh ? (src.includes('?') ? '&' : '?') + '_reload=' + Date.now() : '');
    const failed=()=>{clearTimeout(timer);if(loaded.get(src)===task)loaded.delete(src);s.remove();reject(Error('Không tải được '+src+'. Vui lòng thử Cập nhật bản xem.'));};
    const timer=setTimeout(failed,30000);s.onload=()=>{clearTimeout(timer);resolve();};s.onerror=failed;
    document.head.append(s);
  });
  loaded.set(src, task); return task;
};
const builderReady = () => globalThis.ContractDocument?.printingClauseVersion===1 && globalThis.ContractWordEdit?.formatVersion===1 && typeof globalThis.fflate?.unzipSync === 'function'
  && ['prepare', 'apply'].every(k => typeof globalThis.ContractWordEdit?.[k] === 'function')
  && ['prepareDocument', 'build', 'buildPack', 'templatesFor', 'formatProductTable'].every(k => typeof globalThis.ContractDocument?.[k] === 'function');
let builderTask;
const loadBuilder = () => builderTask ||= (async () => {
  await script('fflate.min.js'); await script('contract-word-edit.js'); await script('contract-document.js');
  if (!builderReady()) {
    // One bounded recovery for a stale cached global. All preview/download paths
    // share this promise so switching tabs cannot trigger duplicate reloads.
    await script('fflate.min.js', true); await script('contract-word-edit.js', true); await script('contract-document.js', true);
    if (!builderReady()) throw Error('Bộ dựng hồ sơ HĐKT chưa cập nhật đầy đủ. Vui lòng tải lại trang rồi mở hồ sơ.');
  }
})().catch(e => { builderTask = null; throw e; });
const loadPreview = async () => { await script('jszip.min.js'); await script('docx-preview.min.js'); };

export const DOCS = [['HDKT', 'Hợp đồng kinh tế'], ['TAM_UNG', 'Đề nghị tạm ứng'], ['BBNT', 'Biên bản bàn giao & nghiệm thu']];
const FIELDS = [['representativeHonorific', 'Danh xưng người đại diện bên A', 'honorific'], ['representativeName', 'Người đại diện bên A'], ['representativeTitle', 'Chức vụ'], ['signedDate', 'Ngày ký', 'date'], ['depositRate', 'Tỷ lệ tạm ứng / đặt cọc (%)', 'number'],
  ['paymentDays', 'Số ngày thanh toán phần còn lại', 'number'], ['deliveryTime', 'Thời gian giao hàng', 'area'], ['deliveryAddress', 'Địa điểm giao hàng', 'area'], ['paymentMethod', 'Phương thức thanh toán', 'area']];

const dmy = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

// Tách dữ liệu cũ có Ông/Bà trong tên; lưu hai trường riêng và không đoán danh xưng từ tên.
function representativeDetails(details) {
  const raw = String(details.representativeName || '').trim();
  const prefix = /^(ông|bà)\s+/i.exec(raw);
  const chosen = ['', 'Ông', 'Bà'].includes(details.representativeHonorific) ? details.representativeHonorific : undefined;
  return { ...details, representativeName: prefix ? raw.slice(prefix[0].length).trim() : raw,
    representativeHonorific: chosen ?? (prefix ? (/^ông$/i.test(prefix[1]) ? 'Ông' : 'Bà') : '') };
}

/** Thông tin điền mẫu mặc định: lấy từ HĐKT + đơn; phần đã lưu trước (data.details) được giữ. */
export function contractDetails(detail) {
  const o = detail.order, k = detail.contract, saved = k?.data?.details || {};
  return representativeDetails({
    representativeName: o.contact || '', representativeTitle: '', signedDate: k?.signedDate || todayIso(), depositRate: k?.depositRate ?? 0, paymentDays: k?.paymentDays ?? 0,
    deliveryTime: o.expectedDeliveryDate ? 'Giao hàng ngày ' + dmy(o.expectedDeliveryDate) : 'Theo thỏa thuận của hai bên.', deliveryAddress: k?.deliveryAddress || o.address || '',
    paymentMethod: k?.paymentMethod || 'Chuyển khoản.', ...saved,
    // Báo giá nguồn ưu tiên; HĐKT là giá trị dự phòng cho hồ sơ cũ không có điều khoản nguồn.
    depositRate: k?.depositRate ?? 0, paymentDays: k?.paymentDays ?? 0,
    ...Object.fromEntries(Object.entries(k?.sourceTerms || {}).filter(([, value]) => value !== undefined)),
  });
}

export const contractPrinting = (detail,rows=[]) => typeof detail.submissionReview?.printing==='boolean'?detail.submissionReview.printing:printingInfo({type:detail.order.quoteType,rows}).enabled;

/** Đổi đơn + HĐKT (+ dòng báo giá để lấy Bộ gồm / In ấn / Đóng gói) sang dạng báo giá mà bộ dựng của web cũ dùng. */
function legacyQuote(detail, quoteRows, edits, clauseState) {
  const o = detail.order, k = detail.contract;
  const rows = (quoteRows || []).filter(r => String(r.name || '').trim() && Number(r.qty) > 0);
  return {
    quote_type: k?.legalEntity === 'VG' ? 'VIGIFTS' : o.quoteType === 'VIGIFTS' ? 'B2B' : o.quoteType, quote_number: o.quoteNo, quote_date: k?.signedDate || todayIso(), notes: '',
    printing_enabled: contractPrinting(detail,quoteRows||[]),
    contract_print_clause: clauseState,
    subtotal: o.subtotal, vat_amount: o.tax, total: o.total,
    customer: { name: o.customerName, address: o.address, tax_code: o.taxCode, contact_name: o.contact, customer_code: o.customerCode },
    items: detail.lines.map((l, i) => ({ name: l.name, unit: l.unit, quantity: l.qty, price_after_discount: l.unitPrice, line_total: l.amount, tax_percent: l.taxRate,
      bundle_contents: rows[i]?.bundleContents || '', print_description: rows[i]?.printDescription || '', packaging_description: rows[i]?.packagingDescription || '' })),
    contract_word_edits: edits.HDKT || [], contract_document_edits: { TAM_UNG: edits.TAM_UNG || [], BBNT: edits.BBNT || [] },
  };
}

async function templateEdits(bytes,edits){
  const prepared=await globalThis.ContractWordEdit.prepare(bytes);
  return edits.map(edit=>{
    const original=prepared.paragraphs.find(p=>p.index===edit.index);
    if(!original)throw Error('Đoạn chỉnh sửa không còn thuộc mẫu gốc.');
    return {...edit,hash:original.hash};
  });
}
const templateBytes = new Map();
async function templatesFor(quote, snapshot, sources = {}) {
  return Promise.all(globalThis.ContractDocument.templatesFor(quote).map(async t => {
    if (!templateBytes.has(t.path)) {
      const res = await fetch(t.path,{signal:AbortSignal.timeout(30000)}); if (!res.ok) throw Error('Không tải được mẫu biểu HĐKT.');
      templateBytes.set(t.path, await res.arrayBuffer());
    }
    let bytes=templateBytes.get(t.path);
    const source=sources[t.file];
    if(source){
      if(source.bytes)bytes=source.bytes;else{
      const response=await fetch(source.url,{signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error('Không tải được đúng file mẫu đã gắn với hồ sơ. Mở lại bảng và thử lại.');
      bytes=await response.arrayBuffer();
      source.bytes=bytes;}
      if(bytes.byteLength>MAX_TEMPLATE_BYTES)throw Error('File mẫu vượt giới hạn.');
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      if(digest!==source.sourceHash)throw Error('File mẫu không khớp phiên bản của hồ sơ. Liên hệ Manager.');
    }
    if(t.file==='HDKT'&&snapshot&&!source){
      const brand=quote.quote_type==='VIGIFTS'?'VG':'BN';
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      if(snapshot.brand!==brand||(snapshot.baseSourceHash||snapshot.sourceHash)!==hash)throw Error('File mẫu không khớp phiên bản của hồ sơ. Liên hệ Manager.');
      bytes=await globalThis.ContractWordEdit.apply(bytes,await templateEdits(bytes,snapshot.edits));
    }
    return { ...t, templateBytes: bytes };
  }));
}
const saveBlob = (bytes, name, type) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
const cleanDetails = d => representativeDetails({ ...d, depositRate: Number(d.depositRate), paymentDays: Number(d.paymentDays) });

// Đọc lại giá trị thật khi thao tác: select/autofill có thể chỉ phát change, không phát input.
function readContractForm(form, details) {
  for (const el of form.querySelectorAll('[data-d]')) {
    if (!el.disabled && !el.readOnly) details[el.dataset.d] = el.value;
  }
  return cleanDetails(details);
}

/**
 * Mở hộp xem / sửa / tải HĐKT. `api(path, method, body)` gọi máy chủ; `onSaved()` tải lại đơn sau khi lưu.
 */
export async function openContractDocs({ detail, api, toast, onSaved }) {
  const k = detail.contract; if (!k) return;
  const canEdit = k.canEdit === true, canEditFinancial = k.canEditFinancial === true;
  const dlg = document.createElement('dialog'); dlg.className = 'modal xwide contract-docs';
  dlg.innerHTML = `<div class="modal-head"><div><span class="eyebrow">HĐKT ${esc(k.contractNo)}</span><h2>${canEdit ? 'Xem, chỉnh sửa và tải hồ sơ HĐKT' : 'Xem và tải hồ sơ HĐKT'}</h2></div><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
    <div class="modal-body cd-body">
      <aside class="cd-form"><h3>Thông tin điền mẫu</h3>
        ${FIELDS.map(([f, label, type]) => `<label><span>${label}</span>${type === 'honorific' ? `<select data-d="${f}"><option value="">Chọn danh xưng</option><option value="Ông">Ông</option><option value="Bà">Bà</option></select>` : type === 'area' ? `<textarea rows="2" data-d="${f}"></textarea>` : `<input data-d="${f}" type="${type || 'text'}" ${type === 'number' ? 'min="0"' : ''}>`}</label>`).join('')}
        <button type="button" class="btn secondary small" data-refresh>Cập nhật bản xem</button></aside>
      <section class="cd-preview"><div class="cd-tabs chips" role="tablist">${DOCS.map(([t, label], i) => `<button type="button" class="chip" role="tab" data-doc="${t}" aria-selected="${i === 0}">${label}</button>`).join('')}</div>
        <p class="muted small" data-printing hidden></p><p class="muted small" data-status role="status" aria-live="polite">Đang dựng bản xem…</p>
        <div class="cd-tools" role="group" aria-label="Thao tác với hồ sơ đang xem"><span class="small cd-current" data-current></span><div class="row-gap"><button type="button" class="btn secondary" data-template hidden>Mẫu HĐKT gốc</button><button type="button" class="btn secondary" data-source-download hidden>Tải file mẫu gốc</button><button type="button" class="btn secondary" data-source-upload hidden>Upload file mẫu (.docx)</button><input type="file" data-source-file accept=".docx" hidden><button type="button" class="btn secondary" data-format-toggle aria-expanded="false" aria-controls="contract-format-panel">Định dạng văn bản</button><button type="button" class="btn secondary" data-print>In / Lưu PDF</button><button type="button" class="btn primary" data-one>Tải Word (.docx)</button><button type="button" class="btn ghost small" data-rebuild title="Bỏ các chỗ sửa trực tiếp của hồ sơ này, dựng lại từ thông tin điền mẫu">Đặt lại theo mẫu</button></div></div><div class="cd-format" id="contract-format-panel" data-format hidden></div>
        <iframe class="cd-frame" title="Bản xem HĐKT"></iframe></section>
    </div>
    <div class="modal-foot"><span class="muted small" data-dirty></span><button type="button" class="btn secondary" data-x>Đóng</button><button type="button" class="btn secondary" data-save>Lưu chỉnh sửa</button><button type="button" class="btn primary" data-zip>Tải 3 file Word (.zip)</button></div>`;
  document.body.append(dlg); dlg.showModal();
  const $d = s => dlg.querySelector(s), status = t => { $d('[data-status]').textContent = t; $d('[data-status]').hidden = !t; };
  const details = contractDetails(detail), edits = { HDKT: [], TAM_UNG: [], BBNT: [], ...(k.data?.edits || {}) };
  let busy=false,previewReady=false,disposeFormat=null,formatExpanded=false;
  let master=null,pendingSource=null,sourceUncertain=false,templateMode=false,templateDirty=false,clauseState=k.data?.printingClause||null;
  const canManageTemplates=k.canManageTemplates===true;
  $d('[data-template]').hidden=!canManageTemplates;
  $d('[data-source-download]').hidden=!canManageTemplates;
  const masters=new Map();let contractSourcesPromise;
  const contractSources=()=>contractSourcesPromise||=(k.data?.templateSnapshot?.sources?api('/contracts/'+encodeURIComponent(k.id)+'/template-sources').then(r=>r.sources):Promise.resolve({}));
  const inlineMaster=()=>canManageTemplates&&current==='HDKT'&&!master?.source&&!pendingSource;
  const docLabel=()=>DOCS.find(([type])=>type===current)[1];
  const sourceBrand=k.legalEntity==='VG'?'VG':'BN';
  async function loadMaster(){const meta=await api('/contract-template-sources/'+sourceBrand+'/'+current);const legacy=current==='HDKT'&&!meta.source?await api('/contract-templates/'+sourceBrand):{edits:[],locked:[]};return {...meta,edits:legacy.edits,locked:legacy.locked,legacy};}
  let current = 'HDKT', dirty = false, quoteRows = null, quoteRowsPromise = null, renderSeq = 0;
  const ensureQuoteRows = () => quoteRowsPromise ||= (detail.order.quoteId ? api('/quotes/' + encodeURIComponent(detail.order.quoteId)).catch(e=>{quoteRowsPromise=null;throw Error('Chưa tải được báo giá nguồn để xác định điều khoản có in/không in. '+e.message);}) : Promise.resolve(null)).then(result => { quoteRows = result?.data?.rows || []; });
  for (const el of dlg.querySelectorAll('[data-d]')) {
    el.value = details[el.dataset.d] ?? '';
    if (!canEdit || (['depositRate', 'paymentDays'].includes(el.dataset.d) && !canEditFinancial)) { el.readOnly = true; if (el.tagName === 'SELECT') el.disabled = true; el.title = 'Theo HĐKT đã lập (khớp kỳ công nợ)'; continue; }
    const changed = () => { details[el.dataset.d] = el.value; markDirty(); };
    el.addEventListener('input', changed);
    el.addEventListener('change', changed);
  }
  for (const selector of ['[data-save]', '[data-refresh]', '[data-rebuild]', '[data-format-toggle]']) $d(selector).hidden = !canEdit;
  const markDirty = () => { if(templateMode)templateDirty=true;else dirty=true; $d('[data-dirty]').textContent = 'Có thay đổi chưa lưu'; };
  const close = () => { if(busy)return; if ((dirty||templateDirty) && !confirm('Đóng mà không lưu các chỉnh sửa?')) return; disposeFormat?.(); dlg.close(); dlg.remove(); };
  dlg.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', close)); dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });

  const currentDetails = () => {const d=canEdit?readContractForm(dlg,details):cleanDetails(details);return {...d,deliveryProvince:customerProvince(d.deliveryAddress)?.name||''};};
  const quote = () => legacyQuote(detail, quoteRows, edits, clauseState);
  async function prepareDoc(type){
    if(templateMode){
      const templates=await templatesFor(quote(),null,master.source?{[current]:master.source}:{});
      const base=pendingSource?.bytes||templates.find(t=>t.file===current).templateBytes;
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',base))].map(n=>n.toString(16).padStart(2,'0')).join('');
      if(hash!==(pendingSource?.sourceHash||master.sourceHash))throw Error('Mẫu gốc đã thay đổi. Tải lại trang trước khi chỉnh sửa.');
      return {base,edits:inlineMaster()?await templateEdits(base,master.edits):[],locked:master.locked};
    }
    await ensureQuoteRows();
    const selectedDetails=currentDetails(),q=quote(),templates=await templatesFor(q,k.data?.templateSnapshot,await contractSources());
    const hdkt=templates.find(t=>t.file==='HDKT'),t=templates.find(t=>t.file===type);
    const contractBytes=type==='BBNT'?await globalThis.ContractDocument.build({quote:q,contractNumber:k.contractNo,details:selectedDetails,templateBytes:hdkt.templateBytes}):undefined;
    const prepared=await globalThis.ContractDocument.prepareDocument({quote:q,contractNumber:k.contractNo,details:selectedDetails,templateBytes:t.templateBytes,documentType:type,contractBytes});
    if(type==='HDKT'){edits.HDKT=prepared.edits;clauseState={version:1,printing:q.printing_enabled};$d('[data-printing]').textContent='Điều 2.1 tự điền theo đơn '+(q.printing_enabled?'có in.':'không in.');}
    $d('[data-printing]').hidden=type!=='HDKT'||templateMode;
    return prepared;
  }
  async function buildDoc(type){
    const {base,edits:normalized}=await prepareDoc(type);
    const bytes=await globalThis.ContractWordEdit.apply(base,normalized);
    return globalThis.ContractDocument.formatProductTable(bytes,templateMode?[]:quote().items);
  }
  function lockUi(on,button,label){
    busy=on;dlg.setAttribute('aria-busy',String(on));$d('.cd-body').inert=on;
    for(const b of dlg.querySelectorAll('button')){if(on){b.dataset.wasDisabled=String(b.disabled);b.disabled=true;}else{b.disabled=b.dataset.wasDisabled==='true';delete b.dataset.wasDisabled;}}
    $d('[data-print]').disabled=on||!previewReady;
    if(button){if(on){button.dataset.idleLabel=button.textContent;button.textContent=label;}else{button.textContent=button.dataset.idleLabel;delete button.dataset.idleLabel;}}
  }
  async function action(button,label,run){
    if(busy)return;lockUi(true,button,label);try{await run();}catch(e){toast(e.message,'err');}finally{lockUi(false,button);}
  }
  function recordParagraph(p){
    const index=Number(p.dataset.wordIndex),info=p._wordInfo;if(!(templateMode?inlineMaster():canEdit)||!info)return;
    const runs=paragraphRuns(p),text=runs.map(r=>r.text).join('');
    const format={};for(const key of ['align','list','lineSpacing','indent'])if(p.dataset[key]!==undefined)format[key]=['lineSpacing','indent'].includes(key)?Number(p.dataset[key]):p.dataset[key];
    const changed=[...(templateMode?master.edits:edits[current]).filter(e=>e.index!==index),{index,hash:info.hash,text,runs,...format}].sort((a,b)=>a.index-b.index);
    if(templateMode)master.edits=changed;else edits[current]=changed;
    p.classList.add('edited');markDirty();
  }
  async function render() {
    if(busy)return;const seq = ++renderSeq;previewReady=false;disposeFormat?.();disposeFormat=null;lockUi(true);status('Đang dựng bản xem từ file Word…');$d('[data-template]').textContent=templateMode?'Quay lại hồ sơ':'Mẫu '+docLabel()+' gốc';$d('[data-current]').textContent=templateMode?'Mẫu '+docLabel()+' · '+(k.legalEntity==='VG'?'Vigifts':'Bách Ngân')+' · Áp dụng cho HĐKT tạo mới':'Đang xem: '+DOCS.find(([type])=>type===current)[1];
    const empty=$d('.cd-frame').contentDocument;empty.open();empty.write('<!doctype html><html><body></body></html>');empty.close();
    try {
      await Promise.all([loadBuilder(), loadPreview()]);
      await ensureQuoteRows();
      const type=current,{base,edits:normalized,locked}=await prepareDoc(type),prepared=await globalThis.ContractWordEdit.prepare(base,normalized);
      if (seq !== renderSeq) return;
      if(templateMode)master.edits=normalized;else edits[type]=normalized;
      const frame = $d('.cd-frame'), doc = frame.contentDocument;
      doc.open(); doc.write('<!doctype html><html lang="vi"><head><meta charset="utf-8"><style>body{margin:0;background:#edf0f5}.docx-wrapper{padding:16px!important}[data-word-index]{outline:1px dashed transparent;outline-offset:3px;cursor:text}[data-word-index]:hover{outline-color:#9db8e0}[data-word-index]:focus{outline-color:#2459a9;background:#f3f7fd}[data-word-index].edited{background:#fff8e6}body{counter-reset:bn-editor}[data-list="none"]::before{content:none!important}.cd-list-bullet::before{content:"• "!important;white-space:pre}.cd-list-decimal{counter-increment:bn-editor}.cd-list-decimal::before{content:counter(bn-editor) ". "!important;white-space:pre}@media print{[data-word-index].edited,[data-word-index]:focus{background:transparent!important;outline:none!important}@page{size:A4;margin:0}body{background:#fff}.docx-wrapper{padding:0!important;background:#fff!important;zoom:1!important}section.docx{box-shadow:none!important;margin:0!important;break-after:page}section.docx:last-child{break-after:auto}}</style></head><body><main></main></body></html>'); doc.close();
      const preview=await globalThis.ContractDocument.formatProductTable(prepared.preview,templateMode?[]:quote().items);
      if(seq!==renderSeq)return;
      await globalThis.docx.renderAsync(preview, doc.querySelector('main'), undefined, { inWrapper: true, hideWrapperOnPrint: true, breakPages: true, ignoreLastRenderedPageBreak: false, renderAltChunks: false, useBase64URL: true });
      if (seq !== renderSeq) return;
      const wrapper = doc.querySelector('.docx-wrapper'); if (wrapper) wrapper.style.zoom = String(Math.min(1, Math.max(0.35, (frame.clientWidth - 32) / 794)));
      for (const info of prepared.paragraphs) {
        const p = doc.getElementById('bnword_' + info.index)?.closest('p'); if (!p) continue;
        if(templateMode&&locked.includes(info.index))p.title='Phần tự điền từ dữ liệu HĐKT; chỉnh tại thông tin hồ sơ.';
        if (!(templateMode?inlineMaster():canEdit) || locked.includes(info.index)) continue;
        p.contentEditable = 'true'; p.dataset.wordIndex = String(info.index);p._wordInfo=info;
        const saved=(templateMode?master.edits:edits[type]).find(e=>e.index===info.index);for(const key of ['align','list','lineSpacing','indent'])if(saved?.[key]!==undefined)p.dataset[key]=String(saved[key]);
        p.classList.toggle('cd-list-bullet',saved?.list==='bullet');p.classList.toggle('cd-list-decimal',saved?.list==='decimal');
        if ((templateMode?master.edits:edits[current]).some(e => e.index === info.index)) p.classList.add('edited');
        const record = () => recordParagraph(p);
        p.addEventListener('input', record);
        // Xoá hết chữ của một dòng (không nằm trong ô bảng) = xoá hẳn dòng đó: ẩn ngay, file Word bỏ đoạn này (ContractWordEdit).
        const dropIfEmpty = () => { if (p.innerText.trim() || p.closest('td')) return false; p.textContent = ''; record(); p.style.display = 'none'; return true; };
        p.addEventListener('keydown', e => {
          if ((e.key === 'Backspace' || e.key === 'Delete') && !p.innerText.trim() && dropIfEmpty()) e.preventDefault();
          // Mỗi đoạn Word là một dòng: Enter không tạo dòng mới (tránh dòng trắng trong file tải về) mà chuyển sang đoạn kế tiếp.
          if (e.key === 'Enter') { e.preventDefault(); const all = [...doc.querySelectorAll('[data-word-index]')].filter(x => x.style.display !== 'none'); all[all.indexOf(p) + 1]?.focus(); }
        });
        p.addEventListener('blur', () => { if (p.classList.contains('edited')) dropIfEmpty(); });
        if (!p.innerText.trim() && p.classList.contains('edited') && !p.closest('td')) p.style.display = 'none';
      }
      previewReady=true;
      if(templateMode?inlineMaster():canEdit){$d('[data-format]').hidden=!formatExpanded;disposeFormat=initContractFormatting({host:$d('[data-format]'),doc,record:recordParagraph,onError:m=>toast(m,'err')});}
      status('');
    } catch (e) { if (seq === renderSeq) status(e.message); }finally{if(seq===renderSeq)lockUi(false);}
  }
  dlg.querySelectorAll('[data-doc]').forEach(b => b.addEventListener('click', () => {
    if(busy)return;current = b.dataset.doc; dlg.querySelectorAll('[data-doc]').forEach(x => x.setAttribute('aria-selected', String(x === b))); render();
  }));
  $d('[data-format-toggle]').addEventListener('click', () => {
    if (!(templateMode?inlineMaster():canEdit) || busy) return;
    formatExpanded = !formatExpanded;
    $d('[data-format]').hidden = !formatExpanded;
    $d('[data-format-toggle]').setAttribute('aria-expanded', String(formatExpanded));
  });
  function masterControls(){
    $d('[data-source-upload]').hidden=!templateMode||!canManageTemplates;
    $d('[data-save]').hidden=templateMode?!(inlineMaster()||pendingSource):!canEdit;
    $d('[data-format-toggle]').hidden=templateMode?!inlineMaster():!canEdit;
    $d('[data-rebuild]').hidden=templateMode?!(inlineMaster()||pendingSource):!canEdit;
    $d('[data-rebuild]').textContent=pendingSource?'Bỏ file vừa chọn':'Đặt lại theo mẫu';
  }
  $d('[data-template]').addEventListener('click',async()=>{
    if(busy||!canManageTemplates)return;
    if(templateMode&&templateDirty){if(!confirm('Bỏ thay đổi mẫu chưa lưu?'))return;masters.delete(current);master=null;pendingSource=null;templateDirty=false;sourceUncertain=false;}
    if(!templateMode){let opened=false;await action($d('[data-template]'),'Đang mở mẫu…',async()=>{master=masters.get(current)||await loadMaster();masters.set(current,master);opened=true;});if(!opened)return;}
    templateMode=!templateMode;
    $d('[data-template]').textContent=templateMode?'Quay lại hồ sơ':'Mẫu '+docLabel()+' gốc';
    for(const selector of ['.cd-form','.cd-tabs','[data-zip]'])$d(selector).hidden=templateMode;
    $d('.cd-body').classList.toggle('cd-template-mode',templateMode);masterControls();
    $d('[data-save]').textContent=templateMode?'Lưu mẫu chung':'Lưu chỉnh sửa';
    $d('[data-dirty]').textContent=(templateMode?templateDirty:dirty)?'Có thay đổi chưa lưu':'';
    formatExpanded=false;$d('[data-format-toggle]').setAttribute('aria-expanded','false');await render();
  });
  $d('[data-source-download]').addEventListener('click',e=>action(e.currentTarget,'Đang tải mẫu…',async()=>{
    const m=templateMode?master:await loadMaster(),templates=await templatesFor(quote(),null,m.source?{[current]:m.source}:{});
    saveBlob(pendingSource?.bytes||templates.find(t=>t.file===current).templateBytes,'Mau_'+current+'_'+sourceBrand+'.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }));
  $d('[data-source-upload]').addEventListener('click',()=>{if(busy)return;if(sourceUncertain){toast('Chưa rõ kết quả lưu. Bấm Lưu mẫu chung để kiểm tra lại cùng file trước.','err');return;}$d('[data-source-file]').click();});
  $d('[data-source-file]').addEventListener('change',async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file||busy||!templateMode||!canManageTemplates||sourceUncertain)return;
    await action($d('[data-source-upload]'),'Đang kiểm tra file…',async()=>{
      if(!/\.docx$/i.test(file.name)||file.name.length>160||file.size>MAX_TEMPLATE_BYTES)throw Error('Chọn file .docx tối đa 3 MB, tên tối đa 160 ký tự.');
      const bytes=new Uint8Array(await file.arrayBuffer());const {validateTemplateSource}=await import('./contract-source-file.js');validateTemplateSource(bytes,master.requiredFields,master.requiresGoodsTable);
      const sourceHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      pendingSource={bytes,fileName:file.name,sourceHash,clientKey:crypto.randomUUID(),beforeDirty:pendingSource?.beforeDirty??templateDirty};templateDirty=true;$d('[data-dirty]').textContent='Đang xem file '+file.name+' · Bấm Lưu mẫu chung để áp dụng cho hồ sơ tạo mới.';masterControls();
    });await render();
  });
  $d('[data-refresh]').addEventListener('click', render);
  $d('[data-rebuild]').addEventListener('click', () => { if (templateMode) { if(pendingSource){if(confirm('Bỏ file vừa chọn? Mẫu đã lưu vẫn giữ nguyên.')){templateDirty=pendingSource.beforeDirty;pendingSource=null;masterControls();$d('[data-dirty]').textContent=templateDirty?'Có thay đổi chưa lưu':'';render();}return;}if(confirm('Đặt lại mẫu chung về file gốc? Thay đổi chỉ có hiệu lực sau khi lưu mẫu.')){master.edits=[];markDirty();render();}return; } if (!edits[current].length || confirm('Đặt lại hồ sơ đang xem theo mẫu? Các thay đổi chữ và định dạng trong tab này sẽ bị bỏ. Hai hồ sơ còn lại được giữ nguyên.')) { edits[current] = []; markDirty(); render(); } });
  $d('[data-print]').addEventListener('click', () => $d('.cd-frame').contentWindow.print());
  $d('[data-save]').addEventListener('click', e => {
    if(templateMode){
      if(!canManageTemplates)return;
      return action(e.currentTarget,'Đang lưu mẫu…',async()=>{
        if(pendingSource){
          let binary='';for(let i=0;i<pendingSource.bytes.length;i+=8192)binary+=String.fromCharCode(...pendingSource.bytes.subarray(i,i+8192));
          try{await api('/contract-template-sources/'+sourceBrand+'/'+current,'POST',{revision:master.revision,clientKey:pendingSource.clientKey,fileName:pendingSource.fileName,base64:btoa(binary)});}catch(error){sourceUncertain=!error.status||error.status>=500;throw error;}
          sourceUncertain=true;master=await loadMaster();sourceUncertain=false;masters.set(current,master);pendingSource=null;
        }else{
          await buildDoc(current);
          const saved=await api('/contract-templates/'+master.brand,'PUT',{revision:master.legacy.revision,sourceHash:master.legacy.sourceHash,edits:master.edits});master.legacy={...master.legacy,...saved};
        }
        templateDirty=false;$d('[data-dirty]').textContent='Đã lưu mẫu '+docLabel()+' cho hồ sơ tạo mới';toast('Đã lưu mẫu chung. Hồ sơ đã tạo vẫn giữ mẫu cũ.');masterControls();
      });
    }
    if (!canEdit) return;
    return action(e.currentTarget,'Đang lưu chỉnh sửa…',async()=>{
      const selectedDetails = currentDetails();
      const saved = await api('/contracts/' + encodeURIComponent(k.id), 'PUT', {
        revision: k.revision, syncQuoteTerms: !!detail.order.quoteId, quoteRevision: k.quoteRevision,
        deliveryTime: selectedDetails.deliveryTime, signedDate: selectedDetails.signedDate,
        paymentMethod: selectedDetails.paymentMethod, deliveryAddress: selectedDetails.deliveryAddress,
        // Do not convert a quotation's free-text deadline to zero days when editing another field.
        ...(canEditFinancial && selectedDetails.depositRate !== k.depositRate ? { depositRate: selectedDetails.depositRate } : {}),
        ...(canEditFinancial && selectedDetails.paymentDays !== k.paymentDays ? { paymentDays: selectedDetails.paymentDays } : {}),
        details: { ...(k.data || {}), details: selectedDetails, edits, printingClause:clauseState },
      });
      k.revision += 1;
      if (saved.quoteRevision != null) k.quoteRevision = saved.quoteRevision;
      k.data = { ...(k.data || {}), details: selectedDetails, edits };
      k.depositRate = selectedDetails.depositRate; k.paymentDays = selectedDetails.paymentDays;
      dirty = false; $d('[data-dirty]').textContent = 'Đã lưu'; toast('Đã lưu hồ sơ HĐKT.'); onSaved?.();
    });
  });
  const wordName = type => `${type}_${String(k.contractNo).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^a-zA-Z0-9]+/g, '-')}.docx`;
  $d('[data-one]').addEventListener('click', e => action(e.currentTarget,'Đang tạo Word (.docx)…',async()=>{
    await loadBuilder();saveBlob(await buildDoc(current),templateMode?'Mau_'+current+'_'+master.brand+'.docx':wordName(current),'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }));
  $d('[data-zip]').addEventListener('click', e => action(e.currentTarget,'Đang tạo bộ 3 file Word…',async()=>{
    const selectedDetails=currentDetails();await Promise.all([loadBuilder(),ensureQuoteRows()]);const q=quote();
    const pack=await globalThis.ContractDocument.buildPack({quote:q,contractNumber:k.contractNo,details:selectedDetails,templateFiles:await templatesFor(q,k.data?.templateSnapshot,await contractSources())});
    saveBlob(pack.bytes,`${pack.folder}.zip`,'application/zip');
  }));
  render();
}

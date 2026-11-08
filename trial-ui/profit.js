/**
 * PHÂN TÍCH LỢI NHUẬN – trang #/profit (chỉ Manager; máy chủ kiểm tra lại quyền).
 * Lợi nhuận gộp = Doanh thu thuần − Giá vốn − Chi phí trực tiếp; ghi nhận theo ngày đơn; dòng thiếu giá vốn không tính 0.
 */
import { cacheLineHtml } from './report-cache.js';
import { purchasePrice } from './quote-math.js';

const GRAIN_LABEL = { day: 'Ngày', week: 'Tuần', month: 'Tháng', year: 'Năm' };
const TABS = { series: 'Thời gian', branches: 'Chi nhánh', owners: 'Nhân viên', customers: 'Khách hàng', orders: 'Đơn hàng', products: 'Sản phẩm' };
const vnToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
/** Presets select an actual reporting range, independently of chart grouping. */
export function profitPeriod(grain, today = vnToday()) {
  if (grain === 'day') return { from: today, to: today };
  if (grain === 'week') {
    const date = new Date(today + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return { from: date.toISOString().slice(0, 10), to: today };
  }
  if (grain === 'month') return { from: today.slice(0, 8) + '01', to: today };
  if (grain === 'year') return { from: today.slice(0, 4) + '-01-01', to: today };
  throw new RangeError('Kỳ không hợp lệ.');
}
export const profitHasCoverage = r => !(r.revenue > 0 && r.coveredRevenue === 0 && ((r.missingOrders ?? r.missingLines ?? 0) > 0 || (r.unconfirmedOrders ?? r.unconfirmedLines ?? 0) > 0));
const pct = x => x === null || x === undefined ? '—' : (Math.round(x * 1000) / 10).toLocaleString('vi-VN') + '%';
const short = v => { const a = Math.abs(v), s = v < 0 ? '−' : '';
  return a >= 1e9 ? s + (Math.round(a / 1e7) / 100).toLocaleString('vi-VN') + ' tỷ' : a >= 1e6 ? s + Math.round(a / 1e6).toLocaleString('vi-VN') + ' tr' : s + Math.round(a).toLocaleString('vi-VN'); };
const csvCell = v => /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);

const CONF_TONE = { confirmed: 'ok', estimate: 'warn', backfill: 'muted' };
const REASON = { create: 'Tạo đơn', amend: 'Sửa đơn', confirm: 'Duyệt đơn', pos: 'Bán POS', pos_edit: 'Sửa đơn POS', adjust: 'Manager điều chỉnh', recover: 'Hệ thống khôi phục giá tham chiếu' };
export function initProfit({ api, root, toast, esc, money }) {
  const pill = (tone, text) => `<span class="pill ${tone}">${esc(text)}</span>`;
  const when = v => new Date(v).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });
  // Hiển thị cả giá tham chiếu để theo dõi đơn cũ; mức tin cậy luôn ghi rõ. Manager vẫn lọc chỉ giá đã xác nhận được.
  const st = { costs: 'all', grain: 'month', from: vnToday().slice(0, 8) + '01', to: vnToday(), compare: true, branch: '', owner: '', tab: 'owners', missingOnly: false, data: null };
  const num = v => (Math.round(v) || 0).toLocaleString('vi-VN'); // -0 → 0
  const amount = (r, v) => profitHasCoverage(r) ? num(v) : '<span class="muted" title="Chưa đủ giá vốn theo bộ lọc để tính lợi nhuận">—</span>';
  const marginCell = r => { const w = r.margin === null ? 0 : Math.max(0, Math.min(1, r.margin / 0.4)) * 80;
    return `<span class="pf-mbar" style="width:${w}px"></span> ${pct(r.margin)}`; };
  const flag = r => r.gross < 0 ? '<span class="pill danger">Lỗ</span>' : r.margin !== null && r.margin < 0.15 ? '<span class="pill warn">Biên thấp</span>' : '';
  const miss = r => (r.missingOrders ? `<span class="pill muted" title="Doanh thu thiếu giá vốn: ${esc(money(r.missingRevenue))}">${r.missingOrders} thiếu giá vốn</span> ` : '')
    + (r.unconfirmedOrders ? `<span class="pill warn" title="Doanh thu dùng giá ước tính chưa xác nhận: ${esc(money(r.unconfirmedRevenue))}">${r.unconfirmedOrders} chưa xác nhận</span>` : '');
  /** Tỉ lệ doanh thu có giá vốn chính xác của một nhóm – nhãn "Giá vốn" ở các bảng. */
  const trust = r => { if (!r.revenue) return '—'; const p = r.revenueBy.confirmed / r.revenue;
    return `<span class="pill ${p >= 0.95 ? 'ok' : p >= 0.7 ? 'warn' : 'muted'}">${pct(p)} chính xác</span>`; };
  const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  const delta = (cur, prev) => { if (!prev) return ''; const p = (cur - prev) / Math.abs(prev); return `<span class="${p < 0 ? 'neg' : 'pos'}">${p < 0 ? '▼' : '▲'} ${pct(Math.abs(p))}</span> so kỳ trước`; };
  /** Presets reset to today / this week / this month / this year; inputs can select older periods. */
  const seriesGrain = () => st.grain === 'month' ? 'day' : st.grain === 'year' ? 'month' : st.grain;
  function setGrain(g) {
    Object.assign(st, { grain: g }, profitPeriod(g));
  }

  let loadRequest = 0;
  function loadingStatus(message, error = false) {
    if (!st.data) { root.innerHTML = `<p data-pf-status role="status" class="${error ? 'error' : 'muted'}">${esc(message)}</p>`; return; }
    const status = root.querySelector('[data-pf-status]');
    status.hidden = false; status.textContent = message; status.classList.toggle('error', error);
    root.querySelector('#pf-csv').disabled = true;
  }
  /** `refresh`: nút "Cập nhật" – máy chủ bỏ bản tính sẵn (30 phút) và tính lại ngay. */
  async function load(refresh = false) {
    const request = ++loadRequest;
    root.setAttribute('data-pf-stale', '');
    if (st.from > st.to) {
      root.removeAttribute('aria-busy'); loadingStatus('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.', true); return;
    }
    root.setAttribute('aria-busy', 'true'); loadingStatus(refresh === true ? 'Đang tính lại lợi nhuận với dữ liệu mới nhất…' : 'Đang tính lợi nhuận theo bộ lọc…');
    const q = new URLSearchParams({ from: st.from, to: st.to, grain: seriesGrain(), ...(st.branch ? { branch: st.branch } : {}), ...(st.owner ? { owner: st.owner } : {}),
      ...(st.costs === 'confirmed' ? { costs: 'confirmed' } : {}), ...(st.compare ? {} : { compare: '0' }), ...(refresh === true ? { refresh: '1' } : {}) });
    try {
      const data = await api('/profit?' + q);
      if (request !== loadRequest) return;
      st.data = data; root.removeAttribute('data-pf-stale'); render();
    } catch (e) { if (request === loadRequest) loadingStatus(e.message, true); }
    finally { if (request === loadRequest) root.removeAttribute('aria-busy'); }
  }
  function periodControl() {
    if (st.grain === 'month') return `<input type="month" id="pf-month" aria-label="Tháng" value="${esc(st.from.slice(0, 7))}" max="${esc(vnToday().slice(0, 7))}">`;
    if (st.grain === 'year') { const y = Number(vnToday().slice(0, 4)); return `<select id="pf-year" aria-label="Năm">${[0, 1, 2, 3].map(i => `<option value="${y - i}" ${String(y - i) === st.from.slice(0, 4) ? 'selected' : ''}>Năm ${y - i}</option>`).join('')}</select>`; }
    return `<input type="date" id="pf-from" aria-label="Từ ngày" value="${esc(st.from)}"><span class="muted">→</span><input type="date" id="pf-to" aria-label="Đến ngày" value="${esc(st.to)}">`;
  }
  function render() {
    const d = st.data, s = d.summary, co = d.branchCosts?.company, cmp = d.compare;
    const opt = (list, val, all, pre) => `<option value="">${pre}: ${all}</option>` + list.map(o => `<option value="${esc(o.id)}" ${o.id === val ? 'selected' : ''}>${pre}: ${esc(o.name)}</option>`).join('');
    const net = co ? co.net : s.net, netBase = s.coveredRevenue + s.feeRevenue, unalloc = co ? co.overhead + co.saleUnallocated : null;
    const share = k => s.revenue ? pct(s.revenueBy[k] / s.revenue) : '—';
    root.innerHTML = `<div class="card pf-head">
        <div class="pf-title"><h1>Phân tích lợi nhuận</h1><span class="pill info">Sau chi phí</span></div>
        <p class="muted">Chỉ Manager · chưa VAT · ghi nhận theo ngày đơn · chi phí kỳ lương / sổ quỹ ghi nhận theo kỳ phát sinh</p>
        ${cacheLineHtml(d.cache, 'pf-refresh', esc)}
        <div class="pf-filters"><div class="seg" role="group" aria-label="Kỳ">${Object.entries(GRAIN_LABEL).map(([k, v]) => `<button type="button" data-grain="${k}" class="${k === st.grain ? 'on' : ''}" aria-pressed="${k === st.grain}">${v}</button>`).join('')}</div>
          ${periodControl()}
          <label class="pf-check-inline"><input type="checkbox" id="pf-compare" ${st.compare ? 'checked' : ''}> So với kỳ trước</label>
          <select id="pf-branch" aria-label="Chi nhánh">${opt(d.filterOptions.branches, st.branch, 'Tất cả', 'Chi nhánh')}</select>
          <select id="pf-owner" aria-label="Nhân viên">${opt(d.filterOptions.owners, st.owner, 'Tất cả', 'Nhân viên')}</select>
          <select id="pf-costs" aria-label="Giá vốn"><option value="confirmed" ${st.costs === 'confirmed' ? 'selected' : ''}>Giá vốn: chỉ chính xác</option><option value="all" ${st.costs === 'all' ? 'selected' : ''}>Giá vốn: gồm ước tính</option></select>
          <button type="button" class="btn secondary" id="pf-csv">⬇ Xuất Excel</button></div>
        <p class="muted small">Số liệu đơn hàng: ${esc((d.from || st.from).split('-').reverse().join('/'))} – ${esc((d.to || st.to).split('-').reverse().join('/'))}</p>
        <p data-pf-status role="status" class="muted" hidden></p></div><div class="pf-results">
      <div class="card pf-analysis" data-pf-analysis><div class="pf-tabs" role="tablist">${Object.entries(TABS).map(([k, v]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === st.tab}" class="${k === st.tab ? 'on' : ''}">${v}</button>`).join('')}</div>
        <div id="pf-tab">${tabBody()}</div>
        <p class="muted small">Thưởng / lương Sale chia về đơn theo tỉ lệ doanh thu đủ giá vốn của người đó trong tháng trọn; tổng khớp bảng lương. Bấm một nhân viên → các đơn của người đó; bấm một đơn → giá vốn từng dòng.</p></div>
      ${warnings(d)}
      <div class="pf-kpis">
        <div class="card"><small>Doanh thu thuần</small><b class="num">${short(s.revenue)}</b><span>${s.orders} đơn${st.compare && cmp ? ' · ' + delta(s.revenue, cmp.revenue) : ''}</span></div>
        <div class="card"><small>LN gộp</small><b class="num ${s.gross < 0 ? 'neg' : ''}">${profitHasCoverage(s) ? short(s.gross) : '—'}</b><span>biên ${pct(s.margin)}${st.compare && cmp && cmp.margin !== null && s.margin !== null ? ` · <span class="${s.margin < cmp.margin ? 'neg' : 'pos'}">${s.margin < cmp.margin ? '▼' : '▲'} ${(Math.abs(s.margin - cmp.margin) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} điểm</span>` : ''}</span></div>
        <div class="card"><small>LN sau chi phí</small><b class="num ${net < 0 ? 'neg' : ''}">${profitHasCoverage(s) ? short(net) : '—'}</b><span>biên ${netBase > 0 ? pct(net / netBase) : '—'}${co ? ' · toàn công ty' : ' · theo bộ lọc'}</span></div>
        <div class="card"><small>Chưa phân bổ</small><b class="num">${unalloc === null ? '—' : short(unalloc)}</b><span>${unalloc === null ? 'chỉ xem khi không lọc' : 'chi phí chung văn phòng + lương Sale chưa phân bổ'}</span></div>
        <div class="card"><small>Độ tin cậy giá vốn</small><b class="num">${share('confirmed')}</b><span>chính xác · ${share('estimate')} ước tính · ${share('backfill')} backfill · ${share('missing')} thiếu</span></div></div>
      ${co ? `<p class="pf-check ${co.reconcile.ok && co.reconcile.payrollOk ? '' : 'bad'}">${co.reconcile.ok && co.reconcile.payrollOk ? '✔ <b>Đối soát khớp:</b>' : '⚠ <b>Đối soát lệch:</b>'} Σ theo chi nhánh ${esc(short(co.reconcile.branches))} − lương Sale chưa phân bổ ${esc(short(co.saleUnallocated))} − chi phí chung ${esc(short(co.overhead))} = LN sau chi phí công ty ${esc(short(co.net))} · bảng lương ${esc(short(co.reconcile.payroll))} = Sale ${esc(short(co.reconcile.payrollParts.sale))} + quầy ${esc(short(co.reconcile.payrollParts.store))} + chung ${esc(short(co.reconcile.payrollParts.overhead))}${co.reconcile.ok && co.reconcile.payrollOk ? '' : ' – báo kỹ thuật kiểm tra'}</p>` : ''}
      <div class="pf-two">${bridgeCard(d)}${cashCard(d)}</div>
      <div class="pf-two">${costCard()}${rulesCard(d)}</div></div>`;
    root.querySelector('#pf-refresh')?.addEventListener('click', () => load(true));
    root.querySelectorAll('[data-grain]').forEach(b => b.onclick = () => { setGrain(b.dataset.grain); load(); });
    root.querySelector('#pf-month')?.addEventListener('change', e => { const m = e.target.value; if (!m) return; st.from = m + '-01'; st.to = monthEnd(m) < vnToday() ? monthEnd(m) : vnToday(); load(); });
    root.querySelector('#pf-year')?.addEventListener('change', e => { const y = e.target.value; st.from = y + '-01-01'; st.to = y + '-12-31' < vnToday() ? y + '-12-31' : vnToday(); load(); });
    root.querySelector('#pf-from')?.addEventListener('change', e => { if (e.target.value) { st.from = e.target.value; load(); } });
    root.querySelector('#pf-to')?.addEventListener('change', e => { if (e.target.value) { st.to = e.target.value; load(); } });
    root.querySelector('#pf-compare').onchange = e => { st.compare = e.target.checked; load(); };
    root.querySelector('#pf-branch').onchange = e => { st.branch = e.target.value; load(); };
    root.querySelector('#pf-owner').onchange = e => { st.owner = e.target.value; load(); };
    root.querySelector('#pf-costs').onchange = e => { st.costs = e.target.value; load(); };
    root.querySelector('#pf-missing')?.addEventListener('click', () => { st.missingOnly = !st.missingOnly; st.tab = 'orders'; render(); });
    root.querySelector('#pf-fill')?.addEventListener('click', () => reviewCosts('missing'));
    root.querySelector('#pf-confirm')?.addEventListener('click', () => reviewCosts('unconfirmed'));
    root.querySelectorAll('[data-cash-entry]').forEach(sel => sel.addEventListener('change', () => setCashClass(sel)));
    root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; render(); });
    root.querySelector('#pf-csv').onclick = exportCsv;
    bindTab();
  }
  /** Cảnh báo nguồn số liệu ở đầu trang (ngắn, mỗi dòng một việc cần làm). */
  function warnings(d) {
    const s = d.summary, estimate = s.revenueBy.estimate + s.revenueBy.backfill;
    return [
      s.unconfirmedOrders ? `<div class="pf-warn" role="status"><span>ℹ ${s.unconfirmedOrders} đơn (${esc(money(s.unconfirmedRevenue))} doanh thu) dùng <b>giá vốn ước tính / tham chiếu</b> chưa được xác nhận – chưa tính vào lợi nhuận.</span>
        <button type="button" class="btn secondary small" id="pf-confirm">Xác nhận giá vốn</button></div>` : '',
      st.costs === 'all' && estimate > 0 ? `<div class="pf-warn" role="status"><span>ℹ Đang gồm ${esc(money(estimate))} doanh thu dùng giá ước tính / tham chiếu (giá mua gần nhất, đơn NCC, công thức thương hiệu) – chưa phải giá vốn đã đối soát.</span></div>` : '',
      s.missingOrders ? `<div class="pf-warn" role="status"><span>⚠ ${s.missingOrders} đơn (${esc(money(s.missingRevenue))} doanh thu) có dòng thiếu giá vốn – không tính vào lợi nhuận, không coi là 0.</span>
        <button type="button" class="btn ghost small" id="pf-missing">${st.missingOnly ? 'Xem tất cả đơn' : 'Xem các đơn cần bổ sung'}</button>
        <button type="button" class="btn secondary small" id="pf-fill">Nhập giá vốn cho mã thiếu</button></div>` : '',
      s.carrierUnknownOrders ? `<div class="pf-warn" role="status">⚠ ${s.carrierUnknownOrders} đơn POS có vận đơn GHN nhưng chưa có phí GHN – chưa trừ (không coi là 0).</div>` : '',
    ].join('');
  }
  /** Từ doanh thu đến lợi nhuận sau chi phí: từng khoản, tỉ lệ trên doanh thu và nguồn chuẩn của khoản đó. */
  function bridgeCard(d) {
    const s = d.summary, co = d.branchCosts?.company, base = Math.max(1, s.coveredRevenue);
    const rows = [
      ['Doanh thu thuần (đủ giá vốn)', s.coveredRevenue, 'Đơn hàng − trả hàng', 'tot'],
      ['− Giá vốn', -s.cost, 'Giá vốn dòng đơn'],
      ['− In · hoa hồng · ship bên bán trả', -s.direct, 'Báo giá / giao hàng'],
      ['= Lợi nhuận gộp', s.gross, '', 'tot'],
      ['+ Thu phí của khách (POS)', s.feeRevenue, 'Bill POS'],
      ['− Phí GHN', -s.carrierFee, 'POS / GHN'],
      ['− Thưởng Sale (KPI · HĐKT · doanh số)', -s.staffBonus, 'Bảng lương'],
      ['− Lương cố định + phụ cấp Sale', -s.staffSalary, 'Bảng lương'],
      ...(co ? [['− Lương Sale chưa phân bổ', -co.saleUnallocated, 'Bảng lương'], ['− Chi vặt chi nhánh', -co.petty, 'Sổ quỹ (đã phân loại)'],
        ['− Lương NVBH / CHT', -co.storeStaff, 'Bảng lương + ca POS'], ['− Chi phí chung chưa phân bổ', -co.overhead, 'Chưa có căn cứ phân bổ', 'warn']] : []),
      [co ? '= Lợi nhuận sau chi phí (công ty)' : '= Lợi nhuận sau chi phí (theo bộ lọc)', co ? co.net : s.net, '', 'tot'],
    ];
    const excluded = s.revenue - s.coveredRevenue;
    return `<div class="card"><h3 class="pf-h">Từ doanh thu đến lợi nhuận sau chi phí</h3>
      <div class="table-wrap"><table class="data-table pf-bridge"><thead><tr><th>Khoản</th><th class="right">Số tiền</th><th></th><th>Nguồn chuẩn</th></tr></thead><tbody>
        ${rows.map(([label, v, src, cls]) => `<tr class="${cls === 'tot' ? 'tot' : ''}"><td>${esc(label)}</td><td class="right num ${v < 0 ? 'neg' : ''}">${num(v)}</td>
          <td><span class="pf-bar-h ${v < 0 ? 'neg' : ''}" style="width:${Math.min(100, Math.abs(v) / base * 100)}%"></span></td><td>${src ? `<span class="pill ${cls === 'warn' ? 'warn' : 'muted'}">${esc(src)}</span>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
      ${excluded > 0 ? `<p class="muted small">Chưa tính ${esc(money(excluded))} doanh thu (thiếu giá vốn / chưa xác nhận) – xem cảnh báo đầu trang.</p>` : ''}
      ${co ? '' : '<p class="muted small">Đang lọc theo chi nhánh / nhân viên: không trừ chi phí chung và lương chưa phân bổ (không thuộc riêng nhóm nào).</p>'}</div>`;
  }
  /** Phân loại phiếu chi sổ quỹ: phiếu nào tính vào chi phí; phiếu cần xem lại có ô chọn loại (Manager xác nhận / sửa). */
  function cashCard(d) {
    const bc = d.branchCosts;
    if (!bc) return '';
    const options = bc.classOptions || [];
    return `<div class="card"><h3 class="pf-h">Phân loại phiếu chi sổ quỹ</h3>
      ${table(['Loại phiếu', '>Số phiếu', '>Số tiền', 'Tính vào chi phí?'], bc.cash.map(x => [esc(x.label), num(x.count), num(x.amount), x.counted ? pill('ok', 'Có') : `<span class="pill muted">${esc(x.why)}</span>`]))}
      ${bc.review.length ? `<details class="small" ${bc.review.some(r => !r.manual) ? 'open' : ''}><summary>Phiếu cần xem lại (${bc.review.filter(r => !r.manual).length} chưa xác nhận · ${bc.review.filter(r => r.manual).length} Manager đã chọn)</summary>
        ${table(['Ngày', 'Phiếu', 'Chi nhánh', '>Số tiền', 'Nội dung', 'Loại'], bc.review.map(r => [esc(r.day.split('-').reverse().join('/')), esc(r.entryNo), esc(r.branch), num(r.amount), esc(r.reason),
          `<select data-cash-entry="${esc(r.id)}" aria-label="Loại phiếu ${esc(r.entryNo)}">${options.map(o => `<option value="${esc(o.cls)}" ${o.cls === r.cls ? 'selected' : ''}>${esc(o.label)}${o.counted ? ' – tính' : ''}</option>`).join('')}
            ${r.manual ? '<option value="">↺ Về tự phân loại</option>' : ''}</select> ${r.manual ? pill('ok', 'Manager') : pill('muted', 'Tự động')}`]))}</details>` : ''}
      <p class="muted small">Tự phân loại theo loại phiếu và từ khoá (lương, GHN / ship, NCC, hoàn tiền). Phiếu nào sai, chọn lại loại – lựa chọn của Manager được lưu và thay cho phân loại tự động.</p></div>`;
  }
  async function setCashClass(sel) {
    sel.disabled = true;
    try { await api(`/profit/cash-classes/${encodeURIComponent(sel.dataset.cashEntry)}`, 'PUT', { cls: sel.value }); toast('Đã lưu loại phiếu.'); load(); }
    catch (e) { toast(e.message, 'err'); sel.disabled = false; }
  }
  function costCard() {
    return `<div class="card"><h3 class="pf-h">Giá vốn dòng đơn</h3>
      <p class="muted small">Mở tab <b>Đơn hàng</b> rồi bấm một đơn để xem từng dòng: giá vốn / đơn vị, nguồn (báo giá, giá nhập, đơn NCC, công thức thương hiệu, Manager), thời điểm lấy giá, mức tin cậy và lịch sử điều chỉnh. Manager điều chỉnh được từng dòng (bắt buộc lý do).</p>
      <p class="muted small">Theo mã: <b>Xác nhận giá vốn</b> (giá ước tính / tham chiếu) và <b>Nhập giá vốn cho mã thiếu</b> ở dòng cảnh báo đầu trang.</p></div>`;
  }
  function rulesCard(d) {
    const t = d.staff, r = t?.reconcile;
    const rules = [['Đơn nháp / sửa đơn trước duyệt', 'Cập nhật giá vốn theo báo giá / giá nhập mới'], ['Duyệt đơn / bán POS', 'Chốt giá vốn của dòng (snapshot)'],
      ['Sau duyệt', 'Khoá; chỉ Manager điều chỉnh, bắt buộc lý do, lưu lịch sử'], ['Huỷ đơn', 'Giữ lịch sử, loại khỏi báo cáo'], ['Đổi / trả hàng', 'Trừ theo giá vốn của dòng gốc'],
      ['Thiếu giá vốn', 'Không tính vào lợi nhuận, không coi là 0'], ['Chỉ giá vốn chính xác (mặc định)', 'Giá ước tính / tham chiếu tách riêng đến khi Manager xác nhận']];
    return `<div class="card"><h3 class="pf-h">Quy tắc & cảnh báo</h3>
      ${table(['Sự kiện', 'Giá vốn'], rules.map(([a, b]) => [esc(a), esc(b)]))}
      <ul class="pf-notes small">
        <li>Phí quẹt thẻ / cổng thanh toán: ${esc(d.cardFees?.note || '')}</li>
        ${d.branchCosts?.officeExpenses?.note ? `<li>${esc(d.branchCosts.officeExpenses.note)}</li>` : ''}
        ${t?.available && t.partial ? `<li>Kỳ lọc có tháng lẻ: lương / thưởng chỉ tính cho tháng trọn${t.months.length ? ' (' + t.months.map(esc).join(', ') + ')' : ' – kỳ này chưa có tháng trọn nên chưa trừ'}.</li>` : ''}
        ${t?.available && r?.payroll ? `<li>${r.ok ? '✔' : '⚠'} Lương Sale: phân bổ vào đơn ${esc(money(r.allocated))} + chưa phân bổ ${esc(money(r.unallocated))} = bảng lương ${esc(money(r.payroll))}${t.payroll.estimateMembers ? ' (có phiếu tạm tính)' : ''}.</li>` : ''}
      </ul>
      ${t?.unallocated?.length ? `<details class="small"><summary>Lương Sale chưa phân bổ (${t.unallocated.length})</summary>${table(['Tháng', 'Nhân viên', '>Lương + phụ cấp', '>Thưởng', 'Lý do'], t.unallocated.map(u => [esc(u.month.split('-').reverse().join('/')), esc(u.name), num(u.salary), num(u.bonus), esc(u.reason)]))}</details>` : ''}
      ${d.branchCosts?.company?.overheadItems?.length ? `<details class="small"><summary>Chi phí chung chưa phân bổ (${d.branchCosts.company.overheadItems.length} phiếu lương)</summary>${table(['Tháng', 'Nhân viên', '>Tổng thu nhập', 'Phiếu'], d.branchCosts.company.overheadItems.map(x => [esc(x.month.split('-').reverse().join('/')), esc(x.name), num(x.amount), x.status === 'estimate' ? pill('warn', 'Tạm tính') : pill('ok', 'Đã chốt')]))}</details>` : ''}</div>`;
  }
  function table(heads, rows, attrs = []) {
    return `<div class="table-wrap"><table class="data-table pf-table"><thead><tr>${heads.map(h => `<th${h.startsWith('>') ? ' class="right"' : ''}>${esc(h.replace(/^>/, ''))}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr ${attrs[i] || ''}>${r.map((c, j) => `<td data-label="${esc(heads[j].replace(/^>/, ''))}"${heads[j].startsWith('>') ? ' class="right num"' : ''}>${c}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${heads.length}" class="muted">Không có dữ liệu trong khoảng đã chọn.</td></tr>`}</tbody></table></div>`;
  }
  const H = ['>DT thuần', '>Giá vốn hàng bán', '>CP trực tiếp', '>LN gộp', '>Phí POS / GHN', '>Thưởng', '>Lương cố định', '>LN sau CP', 'Biên', 'Độ tin cậy', ''];
  const rowCells = r => [num(r.revenue), amount(r,r.cost), amount(r,r.direct), `<b class="${r.gross < 0 ? 'neg' : ''}">${amount(r,r.gross)}</b>`,
    r.feeRevenue || r.carrierFee ? `+${num(r.feeRevenue)} / −${num(r.carrierFee)}` : '0', r.staffBonus ? num(r.staffBonus) : '—', r.staffSalary ? num(r.staffSalary) : '—',
    `<b class="${r.net < 0 ? 'neg' : ''}">${amount(r,r.net)}</b>`, pct(r.netMargin), trust(r), `${flag(r)} ${miss(r)}`];
  /** Rà giá vốn theo mã: `missing` = nhập giá cho mã không có nguồn · `unconfirmed` = xác nhận / sửa giá ước tính / tham chiếu. */
  async function reviewCosts(scope) {
    const q = new URLSearchParams({ from: st.from, to: st.to, scope });
    let d; try { d = await api('/profit/missing-costs?' + q); } catch (e) { toast(e.message, 'err'); return; }
    const initialDiscount = it => it.reference?.discount > 0 && it.suggested === purchasePrice(it.reference.listPrice, it.reference.discount) && it.lines.every(l => l.source === 'catalog_rule') ? it.reference.discount : '';
    const confirm = scope === 'unconfirmed', dlg = document.createElement('dialog'); dlg.className = 'modal pf-dialog pf-fill';
    dlg.innerHTML = `<form><div class="modal-head"><h2>${confirm ? 'Xác nhận giá vốn ước tính / tham chiếu' : 'Nhập giá vốn cho mã thiếu'}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body"><p class="small muted">${esc(st.from.split('-').reverse().join('/'))} – ${esc(st.to.split('-').reverse().join('/'))} · ${d.items.length} mã / ${d.lines} dòng.
        ${confirm ? 'Giá gợi ý lấy từ nguồn ước tính (giá nhập, đơn NCC, công thức thương hiệu) – kiểm tra, sửa nếu cần rồi xác nhận. Để trống = chưa xác nhận mã đó.' : 'Các mã này không có báo giá, giá nhập, đơn NCC hay công thức thương hiệu. Giá nhập ở đây là giá vốn trước VAT / 1 đơn vị, áp cho mọi dòng thiếu của mã trong kỳ.'}</p>
      <p class="small muted">Giá niêm yết hiện tại được quy về trước VAT / 1 đơn vị, không phải giá mua lịch sử. CK &gt; 0: giá vốn = niêm yết × (100 − CK) / 100, làm tròn đồng. Để CK trống hoặc 0 để chỉnh giá vốn trực tiếp. Chưa có niêm yết thì nhập giá vốn, không đoán giá.</p>
      ${d.items.length ? `<div class="table-wrap"><table class="data-table pf-cost-table"><thead><tr><th>Sản phẩm</th><th class="num">Dòng / Doanh thu</th><th class="num">Niêm yết trước VAT</th><th class="num">CK (%)</th><th class="num">Giá vốn / ĐV trước VAT</th></tr></thead><tbody>
        ${d.items.map((it, i) => `<tr data-cost-row="${i}"><td data-label="Sản phẩm"><b>${esc(it.sku)}</b><span class="pf-cost-name">${esc(it.name)}</span><small>${esc(it.unit)}${confirm ? ' · ' + esc((it.sources || []).join(' · ')) : ''}</small></td>
          <td data-label="Dòng / Doanh thu" class="num">${it.lines.length} dòng<span class="pf-cost-name">${num(it.revenue)} ₫</span></td>
          <td data-label="Niêm yết trước VAT" class="num">${it.reference ? `${num(it.reference.listPrice)} ₫<small class="pf-cost-name">${esc(it.reference.policy)} · ${esc(it.reference.at?.slice(0,10).split('-').reverse().join('/') || '')}</small>` : '<span class="muted">Chưa có / khác ĐVT</span>'}</td>
          <td data-label="CK (%)" class="num"><input type="number" min="0" max="100" step="0.01" inputmode="decimal" data-discount="${i}" aria-label="CK ${esc(it.sku)}" value="${initialDiscount(it)}" placeholder="Không CK" ${it.reference ? '' : 'disabled'}></td>
          <td data-label="Giá vốn / ĐV trước VAT" class="num"><input type="number" min="0" max="1000000000000" step="any" inputmode="decimal" data-i="${i}" aria-label="Giá vốn ${esc(it.sku)}" ${confirm && it.suggested !== null ? `value="${it.suggested}"` : 'placeholder="Để trống = chưa nhập"'} ${initialDiscount(it) !== '' ? 'readonly' : ''}></td></tr>`).join('')}</tbody></table></div>
      <label>Lý do / căn cứ giá vốn *<input name="reason" required minlength="3" maxlength="300" placeholder="VD: theo hoá đơn mua NCC tháng 10, bảng giá nhập 2026"></label>`
      : `<p class="empty">${confirm ? 'Không còn giá vốn nào chờ xác nhận trong kỳ.' : 'Không còn mã nào thiếu giá vốn trong kỳ.'}</p>`}<p class="error" data-err role="alert"></p></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-x>Đóng</button>${d.items.length ? `<button class="btn primary">${confirm ? 'Xác nhận giá vốn' : 'Lưu giá vốn'}</button>` : ''}</div></form>`;
    document.body.append(dlg); dlg.showModal();
    dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    dlg.addEventListener('close', () => dlg.remove());
    dlg.querySelectorAll('[data-discount]').forEach(input => input.addEventListener('input', () => {
      const i = Number(input.dataset.discount), cost = dlg.querySelector(`[data-i="${i}"]`), discount = Number(input.value);
      cost.readOnly = input.value.trim() !== '' && discount > 0;
      if (cost.readOnly && input.validity.valid) cost.value = purchasePrice(d.items[i].reference.listPrice, discount);
    }));
    dlg.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const items = [...dlg.querySelectorAll('input[data-i]')].filter(x => x.value.trim() !== '').map(x => {
        const i = Number(x.dataset.i), it = d.items[i], discountPercent = Number(dlg.querySelector(`[data-discount="${i}"]`).value);
        return { sku: it.sku, unit: it.unit, unitCost: Number(x.value), discountPercent, ...(discountPercent > 0 ? { listPrice: it.reference.listPrice } : {}) };
      });
      const err = dlg.querySelector('[data-err]'), btn = dlg.querySelector('.modal-foot .btn.primary');
      if (!items.length) { err.textContent = 'Nhập giá vốn cho ít nhất một mã.'; return; }
      if (items.some(x => !Number.isFinite(x.unitCost) || x.unitCost < 0)) { err.textContent = 'Giá vốn phải là số ≥ 0.'; return; }
      btn.disabled = true;
      try {
        const r = await api('/profit/missing-costs', 'POST', { from: st.from, to: st.to, scope, reason: dlg.querySelector('[name=reason]').value, items });
        dlg.close(); toast(`${confirm ? 'Đã xác nhận' : 'Đã nhập'} giá vốn cho ${r.written} dòng.`); load();
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    };
  }
  function tabBody() {
    const d = st.data;
    if (st.tab === 'orders') {
      const list = st.missingOnly ? d.orders.filter(o => o.missingLines || o.unconfirmedLines) : d.orders;
      return table(['Ngày', 'Đơn', 'Khách hàng', 'Nhân viên', '>DT thuần', '>Giá vốn', '>CP trực tiếp', '>LN gộp', '>Phí POS / GHN', '>Lương + thưởng', '>LN sau CP', 'Biên LN', ''],
        // Đơn chưa có dòng nào đủ giá vốn: hiện "—" thay vì 0 (chưa tính được, không phải lãi 0).
        list.map(o => { const none = (o.missingLines || o.unconfirmedLines) && !o.coveredRevenue, dash = v => none ? '<span class="muted" title="Chưa có giá vốn – chưa tính được">—</span>' : v; return [esc(o.orderDate.split('-').reverse().join('/')), esc(o.orderNo), esc(o.customerName), esc(o.ownerName), num(o.revenue), dash(num(o.cost)), num(o.direct),
          dash(`<b class="${o.gross < 0 ? 'neg' : ''}">${num(o.gross)}</b>`), o.feeRevenue || o.carrierFee ? `+${num(o.feeRevenue)} / −${num(o.carrierFee)}` : '—', o.staffCost ? num(o.staffCost) : '—', dash(`<b class="${o.net < 0 ? 'neg' : ''}">${num(o.net)}</b>`), marginCell(o), `${flag(o)}${o.missingLines ? ` <span class="pill muted">${o.missingLines} dòng thiếu giá vốn</span>` : ''}${o.unconfirmedLines ? ` <span class="pill warn">${o.unconfirmedLines} dòng chưa xác nhận</span>` : ''}`]; }),
        list.map(o => `class="pf-click" data-order="${esc(o.id)}" tabindex="0"`)) + (d.ordersTotal > d.orders.length ? `<p class="muted small">Hiện ${d.orders.length}/${d.ordersTotal} đơn mới nhất – lọc theo nhân viên / chi nhánh để xem đủ.</p>` : '');
    }
    if (st.tab === 'products') return table(['Mã', 'Sản phẩm', '>SL', ...H], d.products.map(r => [esc(r.key.startsWith('(không mã)') ? '—' : r.key), esc(r.label), num(r.qty), ...rowCells(r)]));
    if (st.tab === 'series') return `<h3 class="pf-h">Lợi nhuận gộp theo ${GRAIN_LABEL[seriesGrain()].toLowerCase()}</h3>${chart(d.series)}`
      + table(['Kỳ', ...H], [...d.series].reverse().map(r => [esc(r.label), ...rowCells(r)]));
    if (st.tab === 'branches') {
      // Chi nhánh = LN đơn sau chi phí đơn − chi vặt két − lương NVBH / CHT (chi phí cấp chi nhánh, không chia xuống đơn).
      const bc = new Map((d.branchCosts?.rows || []).map(r => [r.id, r]));
      return table(['Chi nhánh', '>DT thuần', '>Giá vốn hàng bán', '>CP trực tiếp', '>LN gộp', '>LN đơn', '>Chi vặt', '>Lương quầy', '>LN chi nhánh', 'Độ tin cậy', ''], d.branches.map(r => { const b = bc.get(r.key);
        return [esc(r.label), num(r.revenue), amount(r,r.cost), amount(r,r.direct), `<b class="${r.gross < 0 ? 'neg' : ''}">${amount(r,r.gross)}</b>`, amount(r,r.net), b ? num(b.petty) : '0', b ? num(b.staff) : '0',
          `<b class="${(b ? b.net : r.net) < 0 ? 'neg' : ''}">${amount(r,b ? b.net : r.net)}</b>`, trust(r), `${flag(r)} ${miss(r)}`]; })
        .concat((d.branchCosts?.rows || []).filter(b => !d.branches.some(r => r.key === b.id)).map(b => [esc(b.name), '0', '0', '0', '0', '0', num(b.petty), num(b.staff), `<b class="${b.net < 0 ? 'neg' : ''}">${num(b.net)}</b>`, '—', ''])))
        + '<p class="muted small">Lương NVBH / CHT chia theo số ca mở ở từng quầy trong tháng trọn; chi vặt két chỉ tính phiếu "chi phí hoạt động".</p>';
    }
    const label = { owners: 'Nhân viên', customers: 'Khách hàng' }[st.tab];
    const list = d[st.tab];
    return table([label, ...H], list.map(r => [esc(r.label), ...rowCells(r)]), st.tab === 'owners' ? list.map(r => `class="pf-click" data-owner="${esc(r.key)}" tabindex="0" title="Lọc theo nhân viên này"`) : []);
  }
  function bindTab() {
    const on = (el, fn) => { el.onclick = fn; el.onkeydown = e => { if (e.key === 'Enter') fn(); }; };
    root.querySelectorAll('[data-order]').forEach(tr => on(tr, () => openOrder(tr.dataset.order)));
    root.querySelectorAll('[data-owner]').forEach(tr => on(tr, () => { st.owner = tr.dataset.owner; st.tab = 'orders'; load(); }));
  }
  function chart(series) {
    if (series.length && !series.some(profitHasCoverage)) return `<p class="muted">Chưa đủ giá vốn theo bộ lọc để tính lợi nhuận. ${st.costs === 'confirmed' ? 'Chọn gồm giá vốn ước tính hoặc xác nhận giá vốn để xem kết quả.' : 'Bổ sung giá vốn cho các dòng còn thiếu để xem kết quả.'}</p>`;
    series = series.filter(profitHasCoverage);
    if (!series.length) return '<p class="muted">Không có dữ liệu.</p>';
    const W = 640, Hh = 220, top = 14, base = 186, left = 52, max = Math.max(1, ...series.map(r => r.gross)), min = Math.min(0, ...series.map(r => r.gross));
    const span = max - min, y = v => top + (max - v) / span * (base - top), zero = y(0), slot = (W - left - 8) / series.length, bw = Math.max(2, Math.min(28, slot * 0.62));
    const ticks = [max, max / 2, 0, ...(min < 0 ? [min] : [])];
    const every = Math.ceil(series.length / 12);
    return `<svg class="pf-chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Lợi nhuận gộp theo kỳ">
      ${ticks.map(t => `<line x1="${left}" x2="${W - 4}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? 'pf-base' : 'pf-grid'}"/><text x="${left - 6}" y="${y(t) + 3}" text-anchor="end" class="pf-axis">${esc(short(t))}</text>`).join('')}
      ${series.map((r, i) => { const x = left + i * slot + (slot - bw) / 2, h = Math.abs(y(r.gross) - zero), neg = r.gross < 0, rr = Math.min(4, bw / 2, h);
        const path = neg ? `M${x} ${zero} V${zero + h - rr} q0 ${rr} ${rr} ${rr} h${bw - 2 * rr} q${rr} 0 ${rr} ${-rr} V${zero} z`
          : `M${x} ${zero} V${zero - h + rr} q0 ${-rr} ${rr} ${-rr} h${bw - 2 * rr} q${rr} 0 ${rr} ${rr} V${zero} z`;
        return `<g class="pf-bar"><rect x="${left + i * slot}" y="${top}" width="${slot}" height="${base - top}" fill="transparent"/><path d="${path}" class="${neg ? 'neg' : ''}"/>
          <title>${esc(r.label)}: LN gộp ${esc(money(r.gross))} · DT ${esc(money(r.revenue))} · biên ${pct(r.margin)}</title>
          ${i % every === 0 ? `<text x="${x + bw / 2}" y="${Hh - 18}" text-anchor="middle" class="pf-axis">${esc(r.label.length > 7 ? r.label.slice(0, 5) : r.label)}</text>` : ''}</g>`; }).join('')}
    </svg>`;
  }
  async function openOrder(id) {
    let o; try { o = await api('/profit/orders/' + encodeURIComponent(id)); } catch (e) { toast(e.message, 'err'); return; }
    const dlg = document.createElement('dialog'); dlg.className = 'modal pf-dialog';
    dlg.innerHTML = `<div class="modal-head"><h2>Lợi nhuận đơn ${esc(o.orderNo)}</h2><button type="button" class="icon-btn" data-x aria-label="Đóng">×</button></div>
      <div class="modal-body"><p class="small">${esc(o.orderDate.split('-').reverse().join('/'))} · ${esc(o.customerName)} · ${esc(o.ownerName)} · ${esc(o.branch)}</p>
      ${table(['Sản phẩm', '>SL', '>DT thuần', '>Giá vốn / đv', 'Nguồn · tin cậy', '>In', '>Hoa hồng', '>LN gộp', ''], o.lines.map(l => [`${esc(l.name)}<br><small class="muted">${esc(l.sku || '—')}</small>`,
        num(l.qty), num(l.revenue), l.unitCost === null ? '—' : num(l.unitCost),
        l.costSource === 'missing' ? `<span class="pill danger">${esc(l.costSourceLabel)}</span>` : `<small>${esc(l.costSourceLabel)}</small><br>${pill(CONF_TONE[l.confidence], l.confidenceLabel)}${l.snapshot?.costAt ? `<br><small class="muted">giá lúc ${esc(when(l.snapshot.costAt))}</small>` : ''}${l.snapshot?.note ? `<br><small class="muted">${esc(l.snapshot.note)}</small>` : ''}`,
        num(l.printing), num(l.commission), l.gross === null ? '—' : `<b class="${l.gross < 0 ? 'neg' : ''}">${num(l.gross)}</b>`,
        `<button type="button" class="btn ghost small" data-adjust="${esc(l.id)}">Điều chỉnh</button>`]))}
      <div class="pf-adjust" hidden><h3 class="pf-h">Điều chỉnh giá vốn: <span data-adj-name></span></h3>
        <div class="form-grid cols-2"><label>Giá vốn / đơn vị (chưa VAT)<input data-adj-cost inputmode="numeric"></label><label>Lý do (bắt buộc)<input data-adj-reason maxlength="500" placeholder="VD: giá NCC theo HĐ số…"></label></div>
        <p class="muted small">Ghi lịch sử (giá cũ / mới, người, thời điểm); giá vốn dòng này thành "Chính xác".</p><p class="error" data-adj-err role="alert"></p>
        <button type="button" class="btn primary small" data-adj-save>Lưu điều chỉnh</button></div>
      ${o.lines.some(l => l.history?.length) ? `<details class="small"><summary>Lịch sử giá vốn</summary><ol class="pf-hist">${o.lines.flatMap(l => (l.history || []).map(h =>
        `<li><b>${esc(when(h.at))}</b> · ${esc(l.sku || l.name)} · ${esc(REASON[h.reason] || h.reason)}: ${h.previousUnitCost === null ? '' : esc(num(h.previousUnitCost)) + ' → '}${h.unitCost === null ? 'thiếu giá vốn' : esc(num(h.unitCost))}${h.note ? ` – ${esc(h.note)}` : ''} <small class="muted">· ${esc(h.actor)}</small></li>`)).join('')}</ol></details>` : ''}
      <p class="small">Ship mình trả: <b>${esc(money(o.shipping))}</b> · LN gộp đơn: <b>${esc(money(o.gross))}</b> · biên ${pct(o.margin)}${o.missingLines ? ` · <span class="warn-text">${o.missingLines} dòng thiếu giá vốn – bổ sung giá vốn trên báo giá hoặc nhập hàng để tính</span>` : ''}</p></div>
      <div class="modal-foot"><a class="btn secondary" href="#/orders/${encodeURIComponent(o.id)}">Mở đơn</a><button type="button" class="btn primary" data-x>Đóng</button></div>`;
    document.body.append(dlg); dlg.showModal();
    dlg.addEventListener('close', () => dlg.remove()); dlg.querySelectorAll('[data-x]').forEach(b => b.onclick = () => dlg.close());
    dlg.querySelector('a.btn').addEventListener('click', () => dlg.close());
    let editing = null; const box = dlg.querySelector('.pf-adjust');
    dlg.querySelectorAll('[data-adjust]').forEach(b => b.onclick = () => { editing = o.lines.find(l => l.id === b.dataset.adjust); box.hidden = false;
      box.querySelector('[data-adj-name]').textContent = editing.name; box.querySelector('[data-adj-cost]').value = editing.unitCost === null ? '' : num(editing.unitCost);
      box.querySelector('[data-adj-reason]').value = ''; box.querySelector('[data-adj-err]').textContent = ''; box.querySelector('[data-adj-cost]').focus(); });
    dlg.querySelector('[data-adj-save]').onclick = async () => {
      const err = box.querySelector('[data-adj-err]');
      try { await api('/profit/line-costs/' + encodeURIComponent(editing.id), 'PUT', { unitCost: box.querySelector('[data-adj-cost]').value.replace(/\./g, '').replace(',', '.'),
        reason: box.querySelector('[data-adj-reason]').value, revision: editing.snapshot ? editing.snapshot.revision : null });
        toast('Đã điều chỉnh giá vốn.'); dlg.close(); load(); openOrder(id); } catch (e) { err.textContent = e.message; }
    };
  }
  function exportCsv() {
    const d = st.data, heads = ['Nhóm', 'Số đơn', 'Doanh thu thuần', 'Giá vốn', 'Chi phí trực tiếp', 'LN gộp', 'Biên LN (%)', 'Đơn thiếu giá vốn', 'DT thiếu giá vốn'];
    const rows = st.tab === 'orders'
      ? [['Ngày', 'Đơn', 'Khách hàng', 'Nhân viên', 'Chi nhánh', 'Doanh thu thuần', 'Giá vốn', 'Chi phí trực tiếp', 'LN gộp', 'Biên LN (%)', 'Dòng thiếu giá vốn'],
        ...d.orders.map(o => [o.orderDate, o.orderNo, o.customerName, o.ownerName, o.branch, o.revenue, o.cost, o.direct, o.gross, o.margin === null ? '' : Math.round(o.margin * 1000) / 10, o.missingLines])]
      : [heads, ...(st.tab === 'series' ? d.series : d[st.tab]).map(r => [r.label, r.orders, r.revenue, profitHasCoverage(r) ? r.cost : '', profitHasCoverage(r) ? r.direct : '', profitHasCoverage(r) ? r.gross : '', r.margin === null ? '' : Math.round(r.margin * 1000) / 10, r.missingOrders, r.missingRevenue])];
    const blob = new Blob(['﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `loi-nhuan-${TABS[st.tab]}-${st.from}-${st.to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  return { show: load };
}

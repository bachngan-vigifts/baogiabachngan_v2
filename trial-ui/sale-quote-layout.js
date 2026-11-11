/** The Sale editor contains eight business columns; delete remains an action inside the STT cell. */
export const SALE_LAYOUT_COLUMNS = ['STT', 'Hình ảnh', 'Tên sản phẩm', 'SL', 'Giá bán trung bình (đề xuất)', 'Giá bán', 'Phí in', 'Thành tiền'];
export function saleDesignProblem(data) {
  if (data.template !== 'sale') return '';
  const i = (data.rows || []).findIndex(r => !String(r.image || '').trim() || r.designImage !== true);
  return i < 0 ? '' : `Đính kèm ảnh thiết kế cho sản phẩm dòng ${i + 1} trước khi gửi duyệt, duyệt hoặc xuất file Sale.`;
}
export function saleLineHead() {
  const classes = ['col-idx', 'col-img', 'col-product', 'col-qty', 'col-average', 'col-price', 'col-print', 'col-total'];
  return '<tr>' + SALE_LAYOUT_COLUMNS.map((s, i) => `<th class="${classes[i]}">${s}</th>`).join('') + '</tr>';
}
export function saleLineCell(r, i, {esc, fmtNum, image, average}) {
  const input = (k, label) => `<input class="num-input" inputmode="decimal" data-k="${k}" value="${r[k] === '' ? '' : fmtNum(Number(r[k] || 0), k === 'qty' ? 4 : 2)}" aria-label="${label} dòng ${i + 1}">`;
  return `<tr data-i="${i}"><td class="col-idx">${i + 1}<button type="button" class="icon-btn danger" data-del aria-label="Xoá dòng ${i + 1}">×</button></td>
    <td class="col-img" data-label="Hình ảnh"><button type="button" class="img-btn${r.image && r.designImage === true ? '' : ' sale-design-missing'}" data-image aria-label="Ảnh thiết kế dòng ${i + 1}">${r.image && r.designImage === true ? image(r.image) : '<span class="thumb add"><small>Đính kèm ảnh *</small></span>'}</button></td>
    <td class="col-product" data-label="Tên sản phẩm"><input class="name-input" data-k="name" value="${esc(r.name || '')}" maxlength="4000" placeholder="Tên sản phẩm…" aria-label="Tên sản phẩm dòng ${i + 1}"></td>
    <td class="col-qty" data-label="SL">${input('qty', 'Số lượng')}</td>
    <td class="col-average" data-label="Giá trung bình đề xuất">${average(r.sku)}</td>
    <td class="col-price" data-label="Giá bán">${input('price', 'Giá bán')}</td>
    <td class="col-print" data-label="Phí in">${input('printFee', 'Phí in')}</td>
    <td class="line-total col-total" data-label="Thành tiền"></td></tr>`;
}

/** Keep URLs below proxy/header limits even for a 300-line quote; never issue one request per product. */
export function saleSuggestionBatches(skus) {
  const batches=[];let batch=[],length=0;
  for(const sku of [...new Set(skus.filter(Boolean))]) {
    const size=encodeURIComponent(sku).length+5;
    if(batch.length&&(batch.length>=100||length+size>6000)){batches.push(batch);batch=[];length=0;}
    batch.push(sku);length+=size;
  }
  if(batch.length)batches.push(batch);return batches;
}
const suggestionPath = skus => '/products/quote-tools/sale-price-suggestions?' + skus.map(s => 'sku=' + encodeURIComponent(s)).join('&');
export async function fetchSaleSuggestions(api, skus) {
  const prices=[];for(const batch of saleSuggestionBatches(skus))prices.push(...(await api(suggestionPath(batch))).prices);return prices;
}

/** At most one request in flight, bounded batches, no retry loop or requests on ordinary quote templates. */
export function createSalePriceSuggestions({api, changed}) {
  let owner = '', generation = 0, busy = false, pending = new Set(), values = new Map(), timer;
  const view = (sku, {esc, money}) => {
    const v = values.get(sku);
    if (!sku) return '<span class="muted small">Không có mã SP</span>';
    if (!v || v.loading) return '<span class="muted small">Đang tải…</span>';
    if (v.error) return '<span class="muted small">Chưa xác minh</span>';
    if (v.average == null) return '<span class="muted small">Chưa đủ lịch sử</span>';
    const note = `Bình quân theo SL · ${v.from} → ${v.to} · ${v.orders} đơn trong phạm vi được xem · chưa VAT, chưa phí in`;
    return `<span title="${esc(note)}">${money(v.average)}</span><small class="muted sale-average-note">6 tháng · ${v.orders} đơn</small>`;
  };
  async function run() {
    if (busy || !pending.size) return;
    const stamp = generation, skus = saleSuggestionBatches([...pending])[0]; skus.forEach(s => pending.delete(s)); busy = true;
    try {
      const data = await api(suggestionPath(skus));
      if (stamp !== generation) return;
      const bySku = new Map(data.prices.map(p => [p.sku, p]));
      for (const sku of skus) values.set(sku, {...(bySku.get(sku) || {average: null}), from: data.from, to: data.to});
    } catch { if (stamp === generation) skus.forEach(s => values.set(s, {error: true})); }
    finally { busy = false; if (stamp === generation) changed(); if (pending.size) timer = setTimeout(run, 150); }
  }
  return {
    view,
    request(user, rows) {
      if (owner !== user) { owner = user; generation++; values = new Map(); pending.clear(); clearTimeout(timer); }
      for (const row of rows) if (row.sku && !values.has(row.sku)) { values.set(row.sku, {loading: true}); pending.add(row.sku); }
      if (pending.size && !busy) { clearTimeout(timer); timer = setTimeout(run, 150); }
    },
  };
}

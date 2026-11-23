/** Pure presentation: never adds warehouse balances or changes order/stock data. */
export function approvalProductTable({lines,warehouses=[],label,total},{esc,fmtNum,money}) {
 const key=v=>String(v??'').trim().toUpperCase();
 const stock=(line,w)=>{
  const matches=line.sku?(w.lines||[]).filter(l=>key(l.sku)===key(line.sku)):[];
  const item=matches[0];
  if(!item||!Number.isFinite(item.stock)||matches.some(l=>!Number.isFinite(l.need)))return '<span class="muted">Chưa có dữ liệu</span>';
  // Demand can have several order lines for one SKU; the warehouse balance must be counted once.
  const need=matches.reduce((sum,l)=>sum+l.need,0),short=item.stock<need;
  return `<strong>${fmtNum(item.stock)}</strong><small>Cần ${fmtNum(need)} · <span class="${short?'danger-text':''}">${short?'Thiếu hàng':'Đủ hàng'}</span></small>`;
 };
 return `<section class="verify-page-card verify-products"><div class="verify-section-head"><h3>Sản phẩm trong ${esc(label)}</h3><span class="muted small">${fmtNum(lines.length)} dòng sản phẩm</span></div>
  <div class="table-wrap"><table class="data-table approval-product-table"><thead><tr><th>Mã hàng</th><th>Sản phẩm</th><th class="num">SL</th><th>ĐVT</th><th class="num">Đơn giá</th><th class="num">VAT</th>${warehouses.length?warehouses.map(w=>`<th>Tồn · ${esc(w.name)}</th>`).join(''):'<th>Tồn tại kho bán</th>'}</tr></thead><tbody>
  ${lines.map((l,i)=>`<tr data-approval-product="${i}"><td data-label="Mã hàng">${l.sku?esc(l.sku):'—'}</td><td data-label="Sản phẩm">${esc(l.name)}</td><td class="num" data-label="SL">${fmtNum(l.qty)}</td><td data-label="ĐVT">${esc(l.unit||'—')}</td><td class="num" data-label="Đơn giá">${money(l.unitPrice)}</td><td class="num" data-label="VAT">${fmtNum(l.taxRate)}%</td>${warehouses.length?warehouses.map(w=>`<td data-label="Tồn · ${esc(w.name)}">${stock(l,w)}</td>`).join(''):'<td data-label="Tồn tại kho bán"><span class="muted">Chưa cấu hình kho bán</span></td>'}</tr>`).join('')}
  </tbody></table></div><div class="verify-contract-total"><span>Giá trị ${esc(label)} (gồm VAT)</span><strong>${money(total)}</strong></div></section>`;
}

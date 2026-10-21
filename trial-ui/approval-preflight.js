const money = n => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(n) + ' đ';
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

/** Customer-facing card deliberately contains only receivable information, never internal costs. */
export function showApprovalDebt(review, { continueLabel } = {}) {
  const dlg = el('dialog', 'modal approval-debt-dialog');
  const card = el('section', 'approval-debt-card');
  card.append(el('span', 'eyebrow', 'THÔNG BÁO CÔNG NỢ'), el('h2', '', 'Quý khách có khoản thanh toán quá hạn'), el('p', 'approval-debt-customer', review.customerName));
  const date = String(review.asOf || '').split('-').reverse().join('/');
  card.append(el('p', 'muted', 'Đối chiếu đến ngày ' + date));
  const total = el('div', 'approval-debt-total'); total.append(el('span', '', 'Tổng tiền quá hạn'), el('strong', '', money(review.debt.total))); card.append(total);
  const table = el('table');
  const head = el('tr'); head.append(el('th', '', 'Chứng từ'), el('th', 'num-cell', 'Số tiền quá hạn')); table.append(head);
  for (const order of review.debt.orders) { const row=el('tr'); row.append(el('td','',order.no),el('td','num-cell',money(order.overdue))); table.append(row); }
  card.append(table, el('p', 'approval-debt-message', 'Kính mong Quý khách thanh toán khoản công nợ quá hạn để chúng tôi tiếp tục xử lý đơn hàng mới. Xin cảm ơn Quý khách!'));
  const footer=el('div','modal-foot'),close=el('button',continueLabel?'btn secondary':'btn primary','Đóng');close.type='button';
  let settle;dlg.result=new Promise(resolve=>{settle=resolve;});
  const done=accepted=>{settle(accepted);dlg.close();};
  close.addEventListener('click',()=>done(false));footer.append(close);
  if(continueLabel){const proceed=el('button','btn primary',continueLabel);proceed.type='button';proceed.addEventListener('click',()=>done(true));footer.append(proceed);}
  dlg.append(card,footer);dlg.addEventListener('close',()=>{settle(false);dlg.remove();});
  document.body.append(dlg);dlg.showModal();return dlg;
}

export function confirmApprovalDebt(review, continueLabel) { return showApprovalDebt(review, {continueLabel}).result; }

export async function reviewOrderCosts({ review, api, isManager, verifyBox, esc, toast }) {
  const costs=review.costs;if(!costs)return true;
  if(costs.missingPrinting && (!isManager || !review.quoteId)) {toast('Thiếu chi phí in/khắc. Vui lòng nhờ Manager cập nhật báo giá trước khi duyệt.','err');return false;}
  let quote, printed=[];
  if(costs.missingPrinting) {
    quote=await api('/quotes/'+encodeURIComponent(review.quoteId));
    printed=quote.data.rows.map((r,index)=>({r,index})).filter(({r})=>Number(r.printFee)>0&&Number(r.qty)>0);
  }
  const fields=printed.map(({r,index})=>`<label class="verify-field"><span>Chi phí in/khắc mỗi sản phẩm · ${esc(r.name||r.sku||'Sản phẩm')}</span><input type="number" name="printing-${index}" min="0" max="1000000000000" step="any" required value="${Number.isFinite(r.printing?.unitPrice)?r.printing.unitPrice:''}"></label>`).join('');
  const result=await verifyBox({title:'Kiểm tra chi phí trước khi duyệt',eyebrow:'Đơn hàng / HĐKT',
    intro:'Chi phí in/khắc là giá mua dịch vụ, không phải phí in thu của khách. Số 0 được chấp nhận khi đã xác nhận không phát sinh.',fields,
    checks:[...(printed.length?['Đã nhập đúng chi phí in/khắc cho các sản phẩm cần in']:[]),
      costs.missingCommission?'Chưa có CK khách (tiền cà phê): xác nhận không phát sinh hoặc quay lại cập nhật báo giá':'Đã kiểm tra CK khách (tiền cà phê)',
      costs.missingShipping?'Chưa có cước vận chuyển: xác nhận không phát sinh hoặc quay lại cập nhật báo giá':'Đã kiểm tra cước vận chuyển và bên thanh toán'],
    validate:v=>printed.some(({index})=>v['printing-'+index]===''||!Number.isFinite(Number(v['printing-'+index]))||Number(v['printing-'+index])<0)?'Nhập chi phí in/khắc hợp lệ cho từng dòng.':'',ok:'Tiếp tục kiểm tra đơn'});
  if(!result)return false;
  if(quote) {
    for(const {r,index} of printed)r.printing={...r.printing,unitPrice:Number(result['printing-'+index])};
    await api('/quotes/'+encodeURIComponent(review.quoteId),'PUT',{revision:quote.revision,data:quote.data});
  }
  return true;
}

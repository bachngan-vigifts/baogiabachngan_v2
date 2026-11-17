import {printingInfo,requiresPrinting} from './quote-math.js';
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

export async function reviewOrderCosts({review,api,isManager,verifyBox,esc,toast,onReviewed=()=>{}}){
 const costs=review.costs;
 if(!costs||costs.missingSource){toast('Chưa có báo giá nguồn để kiểm tra đủ chi phí. Nhờ Manager bổ sung nguồn trước khi duyệt.','err');return false;}
 if(costs.sourceMismatch){toast('Dòng đơn/HĐKT không khớp báo giá nguồn. Đối chiếu lại mã và tên sản phẩm trước khi duyệt.','err');return false;}
 const incomplete=costs.missingPurchase||costs.missingPrinting||costs.missingShipping;
 if(!isManager||!review.quoteId){
  if(incomplete){toast('Thiếu giá nhập, chi phí in hoặc bên chịu vận chuyển. Nhờ Manager nhập đầy đủ trước khi duyệt.','err');return false;}
  const accepted=await verifyBox({title:'Kiểm tra chi phí trước khi duyệt',eyebrow:'Đơn hàng / HĐKT',intro:'Chi phí nội bộ đã được Manager nhập. Quyền duyệt không mở quyền xem hoặc sửa giá vốn.',checks:['Đã kiểm tra nguồn giá nhập và chi phí in (nếu có)','Đã kiểm tra bên chịu vận chuyển và chi phí công ty chịu','Đã kiểm tra CK khách (tiền cà phê)'],ok:'Tiếp tục kiểm tra đơn'});
  if(!accepted)return false;onReviewed({quoteRevision:review.quoteRevision});return true;
 }
 const quote=await api('/quotes/'+encodeURIComponent(review.quoteId));
 if(review.quoteRevision!=null&&quote.revision!==review.quoteRevision){toast('Báo giá vừa thay đổi. Mở lại kiểm tra chi phí để lấy số mới.','err');return false;}
 const doc=quote.data,rows=doc.rows||[];
 if(review.shippingPayer)doc.shipping={...doc.shipping,payer:review.shippingPayer};
 const printed=printingInfo(doc).enabled?rows.map((r,index)=>({r,index})).filter(({r})=>Number(r.qty)>0&&requiresPrinting(r)):[];
 const totalMode=printed.length>0&&!rows.some(r=>Number.isFinite(r.printing?.unitPrice))&&Number.isFinite(doc.printing?.totalCost);
 const field=(name,label,value,attrs='')=>`<label class="verify-field"><span>${esc(label)}</span><input type="number" name="${name}" min="0" max="1000000000000" step="any" ${attrs} value="${Number.isFinite(value)?value:''}"></label>`;
 const purchase=rows.map((r,index)=>({r,index})).filter(({r})=>Number(r.qty)>0);
 const purchaseFields=purchase.map(({r,index})=>{
  const known=review.purchaseCosts?.find(c=>c.index===index),locked=known?.source==='manual';
  const quoteCost=Number.isFinite(r.costPrice)&&!(r.costPrice===0&&r.costMode!=='manual'&&r.purchaseDiscount!==100)?r.costPrice:undefined;
  return field('purchase-'+index,`${r.name||r.sku||'Sản phẩm'} · ${r.qty} ${r.unit||''} · giá nhập / ${r.unit||'sản phẩm'}${locked?' (đã điều chỉnh)':''}`,locked?known.unitCost:quoteCost??known?.unitCost,`required${locked?' readonly':''}`);
 }).join('');
 let fields='<section class="approval-cost-section"><h3>Giá nhập từng sản phẩm (chưa VAT)</h3>'+purchaseFields+(review.purchaseCosts?.some(c=>c.source==='manual')?'<p class="muted small">Giá vốn đã điều chỉnh được giữ nguyên. Muốn đổi khoản này, Manager điều chỉnh tại Phân tích lợi nhuận.</p>':'')+'</section>';
 if(printed.length)fields+='<section class="approval-cost-section"><h3>Chi phí mua dịch vụ in / khắc</h3>'+(totalMode?field('printing-total','Tổng chi phí in / khắc cả đơn',doc.printing.totalCost,'required'):printed.map(({r,index})=>field('printing-'+index,'Chi phí in / khắc mỗi sản phẩm · '+(r.name||r.sku||'Sản phẩm'),r.printing?.unitPrice,'required')).join(''))+'</section>';
 const payer=doc.shipping?.payer;
 fields+=`<section class="approval-cost-section"><h3>Vận chuyển</h3><label class="verify-field"><span>Bên chịu phí vận chuyển *</span><select name="shipping-payer" required><option value="">Chọn rõ bên thanh toán</option><option value="receiver" ${payer==='receiver'?'selected':''}>Khách trả / khách tự nhận (công ty không chịu)</option><option value="sender" ${payer==='sender'?'selected':''}>Công ty chịu phí</option></select></label><div data-company-shipping>${field('shipping-cost','Tổng chi phí vận chuyển công ty chịu (chưa VAT) *',doc.shipping?.cost)}</div></section>`;
 const valid=v=>typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1e12;
 const result=await verifyBox({title:'Nhập đủ chi phí trước khi duyệt',eyebrow:'Đơn hàng / HĐKT',intro:'Giá nhập và chi phí in là chi phí công ty bỏ ra, không phải giá bán hoặc phí in thu khách. Không dùng ô xác nhận để bỏ qua số còn thiếu. Giá 0 chỉ dành cho khoản đã xác nhận không phát sinh.',fields,
  checks:['Đã kiểm tra giá nhập từng sản phẩm; các giá 0 (nếu có) là không phát sinh thực tế','Đã nhập đủ chi phí in / khắc cho phần có in; đã đối chiếu phí thu của khách','Đã xác nhận bên chịu vận chuyển và chi phí công ty chịu','Đã kiểm tra CK khách (tiền cà phê)'],
  onMount:dlg=>{const select=dlg.querySelector('[name="shipping-payer"]'),box=dlg.querySelector('[data-company-shipping]'),input=dlg.querySelector('[name="shipping-cost"]');const sync=()=>{const sender=select.value==='sender';box.hidden=!sender;input.disabled=!sender;input.required=sender;input.min=sender?'0.01':'0';};select.addEventListener('change',sync);sync();},
  validate:v=>{
   if(purchase.some(({index})=>!valid(v['purchase-'+index])))return 'Nhập giá nhập hợp lệ cho từng sản phẩm, không để trống.';
   if(totalMode&&!valid(v['printing-total'])||!totalMode&&printed.some(({index})=>!valid(v['printing-'+index])))return 'Nhập chi phí in/khắc hợp lệ cho từng dòng.';
   if(!['sender','receiver'].includes(v['shipping-payer']))return 'Chọn rõ bên chịu phí vận chuyển.';
   if(v['shipping-payer']==='sender'&&(!valid(v['shipping-cost'])||Number(v['shipping-cost'])<=0))return 'Công ty chịu vận chuyển: nhập tổng chi phí lớn hơn 0.';
   return '';
  },ok:'Lưu chi phí và tiếp tục'});
 if(!result)return false;
 for(const {r,index}of purchase){const cost=Number(result['purchase-'+index]);if(r.costPrice!==cost||cost===0&&r.costMode!=='manual'&&r.purchaseDiscount!==100){r.costMode='manual';delete r.purchaseDiscount;}r.costPrice=cost;}
 if(totalMode)doc.printing={...doc.printing,totalCost:Number(result['printing-total'])};else for(const {r,index}of printed)r.printing={...r.printing,unitPrice:Number(result['printing-'+index])};
 doc.shipping={...(doc.shipping||{}),payer:result['shipping-payer']};if(doc.shipping.payer==='sender')doc.shipping.cost=Number(result['shipping-cost']);else delete doc.shipping.cost;
 const saved=await api('/quotes/'+encodeURIComponent(review.quoteId),'PUT',{revision:quote.revision,data:doc});
 onReviewed({quoteRevision:saved.revision??quote.revision+1});return true;
}

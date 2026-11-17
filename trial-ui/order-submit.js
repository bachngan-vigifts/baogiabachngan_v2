import {submissionReviewProblem,SUBMISSION_PAYMENT_METHODS,SUBMISSION_PRINT_MODES,submissionPaymentLabel} from './submission-review-domain.js';
const read=(v,printing)=>({...v,bulkConfirmed:v.bulkConfirmed==='true',confirmations:{products:true,delivery:true,payment:true,printing}});
/** Does not write until every field and checkbox is complete. Staff never load quote costs. */
export async function requestOrderApproval({id,api,verifyBox,esc}){
 const path='/orders/'+encodeURIComponent(id),review=await api(path+'/submission-review');
 if(review.submittedAt)return false;
 const d=review.defaults,printing=review.printing;
 const field=(name,label,value,type='text',max=2000)=>`<label class="verify-field"><span>${label} *</span><input name="${name}" type="${type}" value="${esc(value||'')}" maxlength="${max}" required></label>`;
 const options=(values,selected)=>'<option value="">— Chọn —</option>'+Object.entries(values).map(([v,t])=>`<option value="${v}" ${v===selected?'selected':''}>${esc(t)}</option>`).join('');
 let fields=`<section class="approval-cost-section"><h3>Giao hàng</h3>${field('deliveryDate','Ngày giao hàng',d.deliveryDate,'date')}${field('deliveryAddress','Địa chỉ giao hàng cụ thể',d.deliveryAddress)}${field('receiverName','Người nhận hàng',d.receiverName,'text',500)}${field('receiverPhone','Điện thoại người nhận',d.receiverPhone,'tel',100)}</section>`;
 fields+=`<section class="approval-cost-section"><h3>Vận chuyển & thanh toán</h3><label class="verify-field"><span>Bên trả phí giao hàng *</span><select name="shippingPayer" required>${options({sender:'Công ty chịu phí',receiver:'Khách hàng trả phí / tự nhận'},d.shippingPayer)}</select></label><p class="muted small">Nếu công ty chịu phí, Manager phải khai báo chi phí trước khi duyệt.</p><label class="verify-field"><span>Hình thức thanh toán *</span><select name="paymentMethod" required>${options(SUBMISSION_PAYMENT_METHODS,d.paymentMethod)}</select></label>${d.paymentHint?`<p class="muted small">Điều khoản đang lưu: ${esc(d.paymentHint)}</p>`:''}<div data-payment-other>${field('paymentOther','Ghi rõ hình thức khác',d.paymentOther,'text',1000)}</div></section>`;
 if(printing)fields+=`<section class="approval-cost-section"><h3>Đơn in logo</h3><label class="verify-field"><span>Yêu cầu thực hiện *</span><select name="printMode" required>${options(SUBMISSION_PRINT_MODES,d.printMode)}</select></label>${field('printInstructions','Nội dung / yêu cầu in (logo, màu, vị trí...)',d.printInstructions)}<div data-sample-date>${field('sampleDate','Ngày dự kiến duyệt mẫu',d.sampleDate,'date')}</div><label data-bulk-confirm class="submit-bulk-confirm"><input type="checkbox" name="bulkConfirmed"><span>Khách đã duyệt nội dung/mẫu và cho phép sản xuất hàng loạt *</span></label><p class="muted small">Không tự đánh dấu xong bước In mẫu/Sản xuất. Manager đối chiếu file và xác nhận theo quy trình.</p></section>`;
 const result=await verifyBox({title:'Xác nhận trước khi gửi duyệt',eyebrow:review.kind+' · '+review.documentNo,intro:'Kiểm tra đầy đủ thông tin thực hiện đơn. Chỉ mở nút Gửi yêu cầu phê duyệt khi đã điền đủ và xác nhận tất cả mục.',
  rows:[['Sản phẩm / số lượng / giá bán',review.products.map(p=>`${esc(p.name)} · ${esc(String(p.qty))} ${esc(p.unit||'')}${Number.isFinite(p.unitPrice)?' · '+new Intl.NumberFormat('vi-VN').format(p.unitPrice)+' đ/SP (chưa VAT)':''}`).join('<br>')]],fields,requireValidFields:true,
  checks:['Đã đối chiếu đúng sản phẩm, số lượng và giá bán với khách','Đã xác nhận ngày, địa chỉ và người nhận hàng','Đã thống nhất bên trả phí giao hàng và hình thức thanh toán',...(printing?['Đã kiểm tra nội dung in, file sản xuất và yêu cầu duyệt mẫu / sản xuất']:[])],
  onMount:dlg=>{
   const select=name=>dlg.querySelector(`[name="${name}"]`);
   const show=(selector,enabled)=>{const box=dlg.querySelector(selector);if(!box)return;box.hidden=!enabled;box.querySelectorAll('input').forEach(input=>{input.disabled=!enabled;input.required=enabled;});};
   const sync=()=>{show('[data-payment-other]',select('paymentMethod').value==='other');if(printing){show('[data-sample-date]',select('printMode').value==='sample');show('[data-bulk-confirm]',select('printMode').value==='bulk');}};
   for(const name of ['paymentMethod',...(printing?['printMode']:[])])select(name).addEventListener('change',sync);sync();
  },validate:v=>submissionReviewProblem(read(v,printing),printing),ok:'Gửi yêu cầu phê duyệt'});
 if(!result)return false;
 await api(path+'/submit','POST',{revision:review.revision,quoteRevision:review.quoteRevision,review:read(result,printing)});return true;
}
export function submissionSummary(r,esc){
 if(!r)return '';
 const row=(k,v)=>`<dt>${k}</dt><dd>${esc(v||'—')}</dd>`;
 return `<section class="submission-summary"><h4>Thông tin nhân viên đã xác nhận khi gửi duyệt</h4><dl class="kv">${row('Ngày giao',r.deliveryDate.split('-').reverse().join('/'))}${row('Địa chỉ giao',r.deliveryAddress)}${row('Người nhận',r.receiverName+' · '+r.receiverPhone)}${row('Phí giao hàng',r.shippingPayer==='sender'?'Công ty chịu phí':'Khách hàng trả phí / tự nhận')}${row('Thanh toán',submissionPaymentLabel(r))}${r.printing?row('In logo',SUBMISSION_PRINT_MODES[r.printMode])+row('Nội dung in',r.printInstructions)+(r.printMode==='sample'?row('Ngày duyệt mẫu',r.sampleDate.split('-').reverse().join('/')):''):''}</dl></section>`;
}

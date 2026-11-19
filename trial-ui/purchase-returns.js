const el=(tag,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
const money=n=>n==null?'Chưa đủ dữ liệu':Number(n).toLocaleString('vi-VN')+' đ';
const qty=n=>Number(n||0).toLocaleString('vi-VN',{maximumFractionDigits:3});
const field=(label,n)=>{const l=el('label','pgr-field',label);l.append(n);return l;};
const input=(type,value='')=>{const n=el('input');n.type=type;n.value=value;return n;};
const button=(label,fn,primary=false)=>{const b=el('button',primary?'btn primary':'btn secondary',label);b.type='button';b.addEventListener('click',fn);return b;};
const localDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function dialog(title,onClose){
 const d=el('dialog','modal supplier-return-dialog'),head=el('header','pgr-head'),body=el('div','pgr-body'),foot=el('footer','pgr-foot');
 const close=()=>{if(d.dataset.busy==='true')return;d.close();d.remove();onClose?.();};
 const heading=el('h2','',title);heading.id='pgr-'+crypto.randomUUID();d.setAttribute('aria-labelledby',heading.id);head.append(heading,button('Đóng',close));d.append(head,body,foot);document.body.append(d);
 d.addEventListener('cancel',e=>{e.preventDefault();close();});d.showModal();return{d,body,foot,close};
}
export function openGoodsReturn({api,order,onChanged}){
 const {d,body,foot,close}=dialog('Trả hàng / Huỷ phần chưa nhận',()=>{if(attempted)onChanged?.();});
 let attempted=false,previewPayload=null,previewResult=null,rows=[];
 const key=crypto.randomUUID(),mode=el('select'),receipt=el('select'),reason=el('textarea'),date=input('date',localDate()),sapoId=input('text'),sapoCode=input('text'),evidence=el('textarea'),checked=input('checkbox'),confirmation=input('text'),confirm=input('checkbox');
 for(const [value,label] of [['credit','Trả giảm công nợ / yêu cầu hoàn tiền'],['replacement','Trả để NCC giao bù'],['close','Huỷ toàn bộ phần chưa nhận']]){const o=el('option','',label);o.value=value;mode.append(o);}
 for(const r of order.receipts.filter(r=>!r.cancelledAt&&r.lines.some(l=>l.goodQty-(l.returnedGoodQty||0)>0))){const o=el('option','',`${r.receiptNo} · ${r.warehouse}`);o.value=r.id;receipt.append(o);}
 const grid=el('div','pgr-grid'),lines=el('div','pgr-lines'),sapo=el('div','pgr-sapo'),result=el('div','pgr-preview'),error=el('p','error');error.setAttribute('role','alert');
 const receiptField=field('Phiếu nhận hàng gốc',receipt),hint=el('p','muted small');
 grid.append(field('Cách xử lý',mode),receiptField,field('Ngày trả / huỷ',date),field('Lý do bắt buộc',reason));
 const checkLabel=field('Tôi đã đối soát trên Sapo đúng phiếu gốc, kho, mã và số lượng trả',checked);
 sapo.append(el('p','pur-note','Đã nhập Sapo: lập/kiểm tra phiếu trả trên Sapo trước. CRM chỉ ghi nhận kết quả đối soát thủ công; không tự gửi thêm lệnh trả.'),field('ID phiếu trả Sapo',sapoId),field('Mã phiếu trả Sapo',sapoCode),field('Ghi chú / số chứng từ đối soát',evidence),checkLabel);
 const verification=el('div','pgr-verification');verification.append(field('Nhập đúng số phiếu trong bản xem trước',confirmation),field('Tôi xác nhận hàng trả / phần huỷ và NCC đã đồng ý cách xử lý, số tiền đối soát',confirm));
 const post=button('Ghi sổ',async()=>{
  if(!previewPayload||!previewResult)return;
  if(!attempted && (!confirm.checked||confirmation.value.trim()!==previewResult.confirmation)){error.textContent='Xác nhận và nhập đúng số phiếu trong bản xem trước.';return;}
  if(!attempted){previewPayload={...previewPayload,previewToken:previewResult.previewToken,confirmation:confirmation.value.trim(),confirm:confirm.checked};}
  attempted=true;setBusy(true);error.textContent='';
  try{await api(`/purchase-orders/${encodeURIComponent(order.id)}/returns`,'POST',previewPayload);attempted=false;d.dataset.busy='false';close();await onChanged?.();}
  catch(e){error.textContent=(e.message||'Chưa xác định kết quả.')+' Giữ nguyên phiếu để thử lại cùng mã chống trùng, hoặc đóng và kiểm tra lịch sử trước khi lập phiếu khác.';post.textContent='Thử lại đúng phiếu này';error.scrollIntoView({block:'nearest'});}
  finally{setBusy(false);}
 },true);
 const preview=button('Xem trước đối soát',async()=>{
  error.textContent='';setBusy(true);
  try{
   const linked=order.receipts.find(r=>r.id===receipt.value)?.sapoVerifiedAt;
   const payload={clientKey:key,revision:order.revision,mode:mode.value,receiptId:mode.value==='close'?null:receipt.value,returnedDate:date.value,reason:reason.value,
    lines:mode.value==='close'?[]:rows.filter(r=>Number(r.input.value)>0).map(r=>({lineId:r.lineId,quantity:Number(r.input.value)})),
    ...(linked&&mode.value!=='close'?{sapoReturnId:sapoId.value,sapoReturnCode:sapoCode.value,evidenceNote:evidence.value,sapoChecked:checked.checked}:{})};
   const r=await api(`/purchase-orders/${encodeURIComponent(order.id)}/returns/preview`,'POST',payload);previewPayload=payload;previewResult=r;
   result.replaceChildren(el('h3','','Bản đối soát trước khi ghi sổ'));
   for(const l of r.items)result.append(el('p','',`${l.sku} · ${qty(l.quantity)} ${l.unit||''}${r.mode==='replacement'?' · NCC cần giao bù':` · giảm ${money(l.creditAmount)}`}`));
   for(const l of r.items)for(const source of l.releasedSources||[])result.append(el('small','sup-sub',`Giải phóng phần đã đặt: ${source.no||'Nguồn thủ công'} · ${qty(source.quantity)} ${l.sku}`));
   result.append(el('p','',`Xuất trả kho: ${qty(r.stockOut)} · Giảm công nợ: ${money(r.creditAmount)}`),el('p','',`Tổng đơn sau xử lý (gồm VAT): ${money(r.totalAfter)} · Còn phải trả: ${money(r.balanceAfter)}`),el('p','',`Đã trả NCC: ${money(r.paid)} · Đã nhận hoàn: ${money(r.refunded)} · NCC còn phải hoàn: ${money(r.supplierCreditAfter)}`),el('b','',`Xác nhận số phiếu: ${r.confirmation}`));
   result.append(el('p','muted small','Giá, CK, VAT và phí in theo đơn đã duyệt. Tiền hoàn không được ghi nhận tự động; kế toán xác nhận khi thực nhận.'));
   verification.hidden=false;post.disabled=false;
  }catch(e){error.textContent=e.message||'Không xem trước được.';previewResult=null;post.disabled=true;}
  finally{setBusy(false);}
 });
 function setBusy(busy){d.dataset.busy=String(busy);for(const n of d.querySelectorAll('input,textarea,select,button'))n.disabled=busy||(attempted&&n!==post&&!n.closest('.pgr-head'));post.disabled=busy||!previewResult;}
 function invalidate(){if(attempted)return;confirm.checked=false;confirmation.value='';previewResult=null;previewPayload=null;result.replaceChildren();post.disabled=true;verification.hidden=true;}
 function renderLines(){
  invalidate();lines.replaceChildren();rows=[];const isClose=mode.value==='close',r=order.receipts.find(r=>r.id===receipt.value);receiptField.hidden=isClose;sapo.hidden=isClose||!r?.sapoVerifiedAt;
  hint.textContent=isClose?'Chỉ huỷ phần chưa nhận, giữ nguyên hàng đã nhận và các khoản thanh toán. Khoản trả trước dư trở thành tiền NCC còn phải hoàn.':'Số lượng trả chỉ lấy từ hàng đạt còn lại trên phiếu nhận. Hàng đã dùng hoặc đang giữ cho đơn khác sẽ bị chặn.';
  const pending=isClose?order.lines.filter(l=>l.missing>0):r?.lines.filter(l=>l.goodQty-(l.returnedGoodQty||0)>0)||[];
  for(const l of pending){const n=input('number','0');n.min='0';n.step='0.001';n.max=String(l.goodQty-(l.returnedGoodQty||0));const row=el('div','pgr-line');row.append(el('span','',`${l.sku} · ${order.lines.find(x=>x.id===(l.lineId||l.id))?.name||''}`));
   if(isClose)row.append(el('b','',`${qty(l.missing)} ${l.unit||''}`));else{row.append(field(`Còn có thể trả ${qty(n.max)}`,n));rows.push({lineId:l.lineId,input:n});}lines.append(row);}
 }
 body.append(el('p','muted small','Chỉ Manager ghi sổ. Phiếu gốc và lịch sử thanh toán được giữ nguyên.'),grid,hint,lines,sapo,result,verification,error);foot.append(preview,post);post.disabled=true;verification.hidden=true;
 mode.addEventListener('change',renderLines);receipt.addEventListener('change',renderLines);body.addEventListener('input',e=>{if(!verification.contains(e.target))invalidate();});renderLines();
}
export function openSupplierRefund({api,order,onChanged}){
 let attempted=false,payload=null;const {d,body,foot,close}=dialog('Xác nhận tiền NCC đã hoàn',()=>{if(attempted)onChanged?.();}),key=crypto.randomUUID();
 const amount=input('number',String(order.debt.supplierCredit)),date=input('date',localDate()),method=el('select'),reference=input('text'),note=el('textarea'),received=input('checkbox'),error=el('p','error');amount.min='1';amount.max=String(order.debt.supplierCredit);amount.step='1';error.setAttribute('role','alert');
 for(const [value,label]of[['transfer','Chuyển khoản'],['cash','Tiền mặt'],['other','Khác']]){const o=el('option','',label);o.value=value;method.append(o);}
 body.append(el('p','',`NCC còn phải hoàn: ${money(order.debt.supplierCredit)}`),field('Số tiền thực nhận',amount),field('Ngày thực nhận',date),field('Phương thức',method),field('Số chứng từ / tham chiếu bắt buộc',reference),field('Ghi chú',note),field('Tôi đã kiểm tra và xác nhận thực nhận tiền hoàn',received),error);
 const save=button('Ghi nhận đã nhận hoàn',async()=>{
  if(!attempted&&(!received.checked||reference.value.trim().length<3||!amount.checkValidity()||!Number.isSafeInteger(Number(amount.value))||!date.value||date.value>localDate())){error.textContent='Kiểm tra số tiền, ngày, số chứng từ và xác nhận thực nhận.';return;}
  if(!attempted)payload={clientKey:key,amount:Number(amount.value),receivedDate:date.value,method:method.value,reference:reference.value,note:note.value,confirmReceived:received.checked};attempted=true;d.dataset.busy='true';for(const n of d.querySelectorAll('input,select,textarea,button'))n.disabled=true;
  try{await api(`/purchase-orders/${encodeURIComponent(order.id)}/refunds`,'POST',payload);attempted=false;d.dataset.busy='false';close();await onChanged?.();}
  catch(e){error.textContent=(e.message||'Chưa xác định kết quả.')+' Đóng và đối soát hoặc thử lại đúng chứng từ này.';save.textContent='Thử lại đúng chứng từ này';}
  finally{d.dataset.busy='false';save.disabled=false;for(const n of d.querySelectorAll('.pgr-head button'))n.disabled=false;}
 },true);foot.append(save);
}

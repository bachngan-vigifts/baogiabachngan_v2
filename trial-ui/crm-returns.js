const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const money=n=>Number(n||0).toLocaleString('vi-VN')+' đ';
const qty=n=>Number(n||0).toLocaleString('vi-VN',{maximumFractionDigits:3});
const stockText=l=>l.restockWarning?'Cần đối soát: '+l.restockWarning:l.plannedRestockQty!=null&&l.plannedRestockQty<l.requestedQty-1e-9?`Nhập tồn ${qty(l.plannedRestockQty)}; hàng hỏng ${qty(Math.round((l.requestedQty-l.plannedRestockQty)*1000)/1000)}`:l.disposition==='restock'?'Nhập lại tồn bán':'Hàng hỏng, không cộng tồn bán';
const dates=v=>v?new Date(v).toLocaleString('vi-VN'):'';
const states={pending:'Chờ duyệt',approved:'Đã duyệt · Chờ nhận hàng',processing:'Đã nhận · Đang đối trừ/hoàn tiền',completed:'Hoàn tất',cancelled:'Đã huỷ',rejected:'Đã từ chối'};
function field(label,type='text'){const box=el('label','pos-field'),input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;box.append(el('span','',label),input);return{box,input};}
function select(label,rows){const box=el('label','pos-field'),input=el('select');for(const [value,text]of rows){const option=el('option','',text);option.value=value;input.append(option);}box.append(el('span','',label),input);return{box,input};}
const CHANNELS={cash:'Tiền mặt',transfer:'Chuyển khoản',carrier:'GHN đang giữ',credit:'Tín dụng đổi hàng',other:'Khác'};
/** Default refund channel = how the customer paid; a different channel is a Manager override with reason + evidence (server enforces). */
export function refundMethodControls(info,manager,amountInput,methodInput){
 const box=el('div','pos-refund-method'),reason=field('Lý do hoàn khác phương thức thu (Manager, ít nhất 10 ký tự)','textarea'),evidence=field('Bằng chứng (mã giao dịch, ảnh, xác nhận của khách)'),warn=el('p','error'),impact=el('p','pos-note');
 const paid=info?Object.entries(info.paid).filter(([,n])=>n>0).map(([k,n])=>CHANNELS[k]+' '+money(n)).join(' · '):'';
 box.append(el('p','pos-note','Khách đã trả: '+(paid||'chưa có khoản thu')+(info?` · Còn hoàn cùng phương thức: tiền mặt ${money(info.remaining.cash)}, chuyển khoản ${money(info.remaining.transfer)}`:'')));
 for(const p of info?.payments||[])box.append(el('p','pos-note',`· ${dates(p.paidAt)} ${CHANNELS[p.channel]||p.channel} ${money(p.amount)}${p.reference?' · '+p.reference:''}`));
 box.append(impact,warn,reason.box,evidence.box);
 const crossed=()=>!!info&&Number(amountInput.value||0)>0&&Number(amountInput.value||0)>(info.remaining[methodInput.value]||0);
 const update=()=>{const c=crossed(),v=Number(amountInput.value||0);reason.box.hidden=evidence.box.hidden=!c||!manager;
  warn.textContent=c?(manager?'Khác phương thức khách đã trả: bắt buộc ghi lý do và bằng chứng.':'Khác phương thức khách đã trả: cần Manager xác nhận.'):'';
  impact.textContent=v>0?(methodInput.value==='cash'?'Ảnh hưởng két: két giảm '+money(v)+' ở ca đang mở của bạn.':'Ảnh hưởng két: không đổi tiền mặt; ghi Sổ thu/chi hình thức chuyển khoản.'):'';};
 if(info?.defaultMethod)methodInput.value=info.defaultMethod;
 amountInput.addEventListener('input',update);methodInput.addEventListener('change',update);update();
 return{box,update,values:()=>crossed()?{overrideReason:reason.input.value.trim(),overrideEvidence:evidence.input.value.trim()}:{},check(){if(crossed()&&manager&&(reason.input.value.trim().length<10||!evidence.input.value.trim()))throw Error('Hoàn khác phương thức thu: nhập lý do (ít nhất 10 ký tự) và bằng chứng.');}};
}
/** Manager-only correction form for one refund: void, or replace with the right method. Server re-checks everything. */
export function refundCorrectionForm(refund,{api,onDone,onBack}){
 const form=el('section','pos-return-card'),action=select('Cách sửa',[['change_method','Đổi phương thức hoàn (tiền mặt ↔ chuyển khoản)'],['void','Huỷ phiếu hoàn (khách chưa nhận tiền)']]),
  method=select('Phương thức đúng',[['transfer','Chuyển khoản'],['cash','Tiền mặt (trừ két ca đang mở)']]),reference=field('Mã giao dịch chuyển khoản'),evidence=field('Bằng chứng (nếu khác phương thức khách đã trả)'),reason=field('Lý do sửa (ít nhất 10 ký tự)','textarea'),key=crypto.randomUUID();
 method.input.value=refund.method==='cash'?'transfer':'cash';
 const sync=()=>{const change=action.input.value==='change_method';method.box.hidden=evidence.box.hidden=!change;reference.box.hidden=!change||method.input.value!=='transfer';};action.input.onchange=method.input.onchange=sync;sync();
 const back=el('button','btn secondary','Quay lại');back.type='button';back.onclick=onBack;
 const save=el('button','btn primary','Xác nhận sửa phiếu');save.type='button';
 const err=el('p','error');err.setAttribute('role','alert');
 save.onclick=async()=>{err.textContent='';if(reason.input.value.trim().length<10){err.textContent='Nhập lý do (ít nhất 10 ký tự).';return;}save.disabled=true;
  try{await api('/refunds/'+encodeURIComponent(refund.id)+'/correct','POST',{key,action:action.input.value,method:method.input.value,reference:reference.input.value,evidence:evidence.input.value,reason:reason.input.value});await onDone();}catch(e){err.textContent=e.message||'Chưa sửa được phiếu.';}finally{save.disabled=false;}};
 form.append(el('h3','','Sửa '+refund.refundNo+' · '+money(refund.amount)+' · '+(refund.method==='cash'?'Tiền mặt':'Chuyển khoản')),
  el('p','pos-note','Phiếu sai được huỷ cùng phiếu chi két (nếu có); két và báo cáo ca cập nhật ngay, ca đã kết sẽ mở tra soát. Không lập phiếu thu/chi bù.'),action.box,method.box,reference.box,evidence.box,reason.box,err,back,save);
 return form;
}
/** The order's existing scope and server-computed quantities/money authorize every transition. */
export async function openCrmReturns({api,toast,orderId,onChanged=()=>{}}){
 const dlg=el('dialog','pos-modal pos-return-modal'),body=el('div','pos-modal-content'),head=el('div','pos-return-head'),content=el('div');dlg.dataset.mobileActions='off';
 const close=el('button','btn secondary','Đóng');close.type='button';close.onclick=()=>dlg.close();head.append(el('h2','','Nhận hàng về / Giao lại / Hoàn tiền'),close);body.append(head,content);dlg.append(body);document.body.append(dlg);dlg.addEventListener('close',()=>dlg.remove(),{once:true});dlg.addEventListener('cancel',e=>{if(dlg.dataset.busy)e.preventDefault();});dlg.showModal();
 const base='/orders/'+encodeURIComponent(orderId)+'/returns';
 const button=(text,fn,primary=false)=>{const b=el('button',primary?'btn primary':'btn secondary',text);b.type='button';b.dataset.mobileInline='';b.onclick=async()=>{if(dlg.dataset.busy)return;dlg.dataset.busy='1';dlg.querySelectorAll('button').forEach(n=>n.disabled=true);try{await fn();}catch(e){toast(e.message,'err');}finally{delete dlg.dataset.busy;dlg.querySelectorAll('button').forEach(n=>n.disabled=false);}};return b;};
 async function confirm(title,text,ok,fn){
  const section=el('section','pos-return-card'),actions=el('div','pos-return-actions');section.append(el('h3','',title),el('p','',text));actions.append(button('Quay lại',show),button(ok,async()=>{await fn();await show();await onChanged();},true));section.append(actions);content.replaceChildren(section);
 }
 async function show(){
  const d=await api(base);if(!dlg.open)return;content.replaceChildren();
  content.append(el('h3','',d.order.orderNo+' · '+d.order.customerName),el('p','pos-note',`Đã thu ${money(d.account.paid)} · Giá trị đã trả ${money(d.account.credit)} · Đã hoàn ${money(d.account.refunded)}`),el('p','',d.account.balance>0?'Còn phải thu: '+money(d.account.balance):d.account.available>0?'Tiền dư còn có thể hoàn: '+money(d.account.available):'Đã đối trừ đủ, không còn tiền dư phải hoàn.'));
  if(d.order.invoiceIssued)content.append(el('p','pos-note','Đơn đã xuất hoá đơn. Phiếu trả giữ lịch sử hoá đơn gốc; cần chuyển kế toán xử lý chứng từ hoá đơn liên quan.'));
  /** Nhập lại vượt lượng đã xuất có chứng từ (đơn cũ): Manager chọn căn cứ kiểm được; không có căn cứ thì từ chối và lập lại với tình trạng hàng hỏng. */
  const basisForm=(r,path,done)=>{
   const form=el('section','pos-return-card'),kind=select('Căn cứ nhập lại kho',[['pre_opening','Hàng đã giao trước ngày chốt tồn đầu kỳ của kho nhận'],['adjustment','Đã trừ bù bằng phiếu điều chỉnh']]),refNo=field('Số phiếu điều chỉnh đã trừ bù (ĐC-…)'),note=field('Ghi rõ căn cứ đã kiểm (ngày giao, chứng từ…)','textarea');
   const sync=()=>{refNo.box.hidden=kind.input.value!=='adjustment';};kind.input.onchange=sync;sync();
   form.append(el('h3','','Căn cứ nhập lại kho · '+r.returnNo),el('p','pos-note','Vượt lượng đã xuất có chứng từ: '+r.stockCheck.unproven.map(l=>`${l.sku} ${l.qty}`).join('; ')+'. Không có căn cứ thì quay lại, từ chối phiếu và lập lại với tình trạng "Hàng hỏng" để không cộng tồn.'),kind.box,refNo.box,note.box,
    button('Quay lại',show),button(done,async()=>{const stockBasis={kind:kind.input.value,note:note.input.value,...(kind.input.value==='adjustment'?{adjustmentRefNo:refNo.input.value}:{})};await api(path,'POST',{stockBasis});await show();await onChanged();},true));
   content.replaceChildren(form);
  };
  /** Một bước cho người duyệt: duyệt + nhận hàng + hoàn tiền (nếu có) + hoàn tất. Máy chủ làm tất cả hoặc không làm gì. */
  const finalizeForm=r=>{
   const logistics=r.purpose==='redelivery',form=el('section','pos-return-card'),refunded=r.refunds.reduce((n,x)=>n+x.amount,0);
   const unproven=r.stockCheck?.unproven||[],covered=!!r.stockCheck?.basis&&unproven.every(l=>(r.stockCheck.basis.covered[l.lineId]||0)>=l.qty),needBasis=!r.receivedAt&&unproven.length&&!covered;
   // Tiền dư sau khi trừ công nợ: chưa nhận hàng thì giá trị phiếu sẽ giảm công nợ ở bước nhận.
   const refundable=logistics?0:Math.max(0,Number(r.refundableAfterReceive)||0);
   form.append(el('h3','','Duyệt & hoàn tất '+r.returnNo),el('p','pos-note',[!r.approvedBy&&'Duyệt',!r.receivedAt&&'nhận hàng về kho',refundable>0&&'hoàn tiền','hoàn tất'].filter(Boolean).join(' → ')+' trong một lần bấm. Lỗi ở bước nào thì không bước nào được ghi.'));
   for(const l of r.lines)form.append(el('p',l.restockWarning?'error':'',`${l.name} (${l.sku}) · ${qty(l.requestedQty)} ${l.unit} · ${stockText(l)}`));
   let basisChoice=null,kind,refNo,bnote;
   if(needBasis){
    form.append(el('p','error','Vượt lượng đã xuất có chứng từ: '+unproven.map(l=>`${l.sku} ${l.qty}`).join('; ')));
    basisChoice=select('Xử lý phần vượt',[['damaged','Không cộng tồn (ghi hàng hỏng)'],...(d.manager?[['basis','Có căn cứ nhập lại kho']]:[])]);
    kind=select('Căn cứ',[['pre_opening','Hàng đã giao trước ngày chốt tồn đầu kỳ'],['adjustment','Đã trừ bù bằng phiếu điều chỉnh']]);refNo=field('Số phiếu điều chỉnh (ĐC-…)');bnote=field('Ghi rõ căn cứ đã kiểm','textarea');
    const sync=()=>{const on=basisChoice.input.value==='basis';kind.box.hidden=bnote.box.hidden=!on;refNo.box.hidden=!on||kind.input.value!=='adjustment';};basisChoice.input.onchange=kind.input.onchange=sync;sync();
    form.append(basisChoice.box,kind.box,refNo.box,bnote.box);
   }
   let amount,method,drawer,reference;
   if(refundable>0&&d.canRefund){
    amount=field('Số tiền hoàn cho khách (tối đa '+money(refundable)+'; 0 = không hoàn)','number');amount.input.min='0';amount.input.max=String(refundable);amount.input.step='1';const ask=r.refundRequest;amount.input.value=String(ask&&!refunded?Math.min(ask.amount,refundable):refundable);
    method=select('Hình thức hoàn',[['transfer','Chuyển khoản'],['cash','Tiền mặt (cần ca két của bạn đang mở)']]);
    drawer=select('Két ghi nhận',d.drawers.map(x=>[x.id,x.name]));reference=field('Mã giao dịch chuyển khoản');
    method.input.onchange=()=>{reference.box.hidden=method.input.value!=='transfer';};var methodUi=refundMethodControls(d.refundMethods,d.manager,amount.input,method.input);method.input.onchange();if(ask&&!refunded){method.input.value=ask.method;reference.input.value=ask.reference||'';method.input.onchange();methodUi.update();form.append(el('p','pos-note',`Nhân viên đề nghị hoàn ${money(ask.amount)} · ${ask.method==='cash'?'Tiền mặt':'Chuyển khoản'}${ask.reference?' · '+ask.reference:''}${ask.note?' · '+ask.note:''}${ask.amount>refundable?' (vượt tiền dư '+money(refundable)+', đã điền mức tối đa)':''}`));}
    form.append(el('p','',`Tiền dư có thể hoàn: ${money(refundable)}`),amount.box,method.box,methodUi.box,drawer.box,reference.box);
   }else if(refundable>0)form.append(el('p','pos-note',`Còn ${money(refundable)} tiền dư: cần người có quyền thu chi hoàn tiền, phiếu sẽ dừng ở bước đối soát.`));
   const check=el('label','pos-transfer-confirm'),box=el('input');box.type='checkbox';check.append(box,el('span','',r.receivedAt?'Tôi xác nhận thông tin hoàn tiền là đúng.':'Tôi xác nhận kho đã nhận đủ đúng số hàng trên phiếu.'));form.append(check);
   const key=crypto.randomUUID();
   form.append(button('Quay lại',show),button('Duyệt & hoàn tất',async()=>{
    if(!box.checked)throw Error('Tích xác nhận trước khi xử lý.');
    const body={confirmed:true};
    if(needBasis){if(basisChoice.input.value==='damaged')body.unprovenAsDamaged=true;else body.stockBasis={kind:kind.input.value,note:bnote.input.value,...(kind.input.value==='adjustment'?{adjustmentRefNo:refNo.input.value}:{})};}
    if(amount){const value=Number(amount.input.value);if(!Number.isSafeInteger(value)||value<0||value>refundable)throw Error('Số tiền hoàn từ 0 đến '+money(refundable)+'.');
     if(value>0){if(!drawer.input.value)throw Error('Chọn két ghi nhận.');if(method.input.value==='transfer'&&!reference.input.value.trim())throw Error('Nhập mã giao dịch chuyển khoản đã hoàn cho khách.');methodUi.check();body.refund={key,amount:value,method:method.input.value,drawerId:drawer.input.value,reference:reference.input.value,...methodUi.values()};}}
    const res=await api(base+'/'+r.id+'/finalize','POST',body);
    toast(res.status==='completed'?'Đã xử lý xong '+r.returnNo+'.':'Đã duyệt và nhận hàng '+r.returnNo+'; còn '+money(res.available)+' tiền dư chờ hoàn.','ok');
    await show();await onChanged();
   },true));
   content.replaceChildren(form);
  };
  for(const r of d.returns){
   const logistics=r.purpose==='redelivery';const card=el('section','pos-return-card'),actions=el('div','pos-return-actions');card.append(el('h3','',r.returnNo+' · '+(states[r.status]||r.status)),el('p','pos-note',logistics?'Nhận để giao lại — không giảm công nợ, không hoàn tiền':'Trả hàng giảm công nợ — chi tiền hoàn là bước riêng'),el('p','',`Giá trị hàng ${money(r.total)} · Kho: ${d.warehouses.find(w=>w.id===r.warehouseId)?.name||r.warehouseId}`),el('p','pos-note',r.reason));
   if(r.refundRequest)card.append(el('p','pos-note',`Đề nghị hoàn: ${money(r.refundRequest.amount)} · ${r.refundRequest.method==='cash'?'Tiền mặt':'Chuyển khoản'}${r.refundRequest.reference?' · '+r.refundRequest.reference:''}${r.refundRequest.note?' · '+r.refundRequest.note:''}`));
   for(const l of r.lines)card.append(el('p',l.restockWarning?'error':'',`${l.name} (${l.sku}) · ${qty(l.requestedQty)} ${l.unit} · ${money(l.total)} · ${stockText(l)}`));
   for(const [label,name,at]of [['Người lập',r.createdByName,r.createdAt],['Người duyệt',r.approvedByName,r.approvedAt],['Người nhận',r.receivedByName,r.receivedAt]])if(at)card.append(el('p','pos-note',label+': '+(name||'—')+' · '+dates(at)));
   const unproven=r.stockCheck?.unproven||[],covered=!!r.stockCheck?.basis&&unproven.every(l=>(r.stockCheck.basis.covered[l.lineId]||0)>=l.qty);
   if(unproven.length)card.append(el('p',covered?'pos-note':'error',(covered?'Căn cứ nhập lại: '+(r.stockCheck.basis.kind==='adjustment'?'phiếu '+r.stockCheck.basis.refNo:'giao trước ngày chốt tồn')+' · '+r.stockCheck.basis.note:'Nhập lại vượt lượng đã xuất có chứng từ – cần Manager chọn căn cứ: ')+(covered?'':unproven.map(l=>`${l.sku} ${l.qty}`).join('; '))));
   const canFinalize=d.canApprove&&['pending','approved','processing'].includes(r.status)&&(r.status!=='pending'||d.manager||r.createdBy!==d.viewerId);
   if(canFinalize)actions.append(button('Duyệt & hoàn tất',()=>finalizeForm(r),true));
   else if(r.status==='pending'&&d.canApprove&&(d.manager||r.createdBy!==d.viewerId)&&unproven.length&&!covered)actions.append(button(d.manager?'Chọn căn cứ và duyệt':'Cần Manager duyệt',()=>{if(!d.manager)throw Error('Phiếu nhập lại vượt lượng đã xuất: chỉ Manager duyệt với căn cứ.');basisForm(r,base+'/'+r.id+'/approve','Duyệt với căn cứ này');},true));
   else if(r.status==='pending'&&d.canApprove&&(d.manager||r.createdBy!==d.viewerId))actions.append(button('Duyệt phiếu trả',()=>confirm('Duyệt '+r.returnNo,`Duyệt trả ${money(r.total)} cho đúng các mã và số lượng trên phiếu. Chưa nhập kho hoặc hoàn tiền ở bước này.`,'Duyệt',()=>api(base+'/'+r.id+'/approve','POST',{})),true));
   if(['pending','approved'].includes(r.status)&&(r.createdBy===d.viewerId||d.canApprove))actions.append(button(r.createdBy===d.viewerId?'Huỷ yêu cầu':'Từ chối',async()=>{const reason=field('Lý do huỷ / từ chối','textarea');const card=el('section','pos-return-card');card.append(reason.box,button('Quay lại',show),button('Xác nhận huỷ / từ chối',async()=>{if(!reason.input.value.trim())throw Error('Nhập lý do.');await api(base+'/'+r.id+'/cancel','POST',{reason:reason.input.value});await show();await onChanged();}));content.replaceChildren(card);}));
   if(canFinalize){}
   else if(r.status==='approved'&&unproven.length&&!covered){if(d.manager)actions.append(button('Chọn căn cứ nhập kho',()=>basisForm(r,base+'/'+r.id+'/stock-basis','Lưu căn cứ'),true));}
   else if(r.status==='approved')actions.append(button('Nhận hàng trả về kho',()=>confirm('Xác nhận thực nhận '+r.returnNo,`Chỉ bấm khi đã nhận đủ đúng ${r.lines.map(l=>l.sku+': '+l.requestedQty+' '+l.unit).join('; ')} tại ${d.warehouses.find(w=>w.id===r.warehouseId)?.name||r.warehouseId}. ${logistics?'Nhập tồn bán các dòng đủ điều kiện, mở lại số lượng để lập phiếu giao mới. Giữ nguyên tiền đã thu và công nợ.':'Nhập tồn bán các dòng đủ điều kiện và giảm công nợ '+money(r.total)+'. Chưa chi tiền hoàn.'}`,'Đã nhận đủ hàng',()=>api(base+'/'+r.id+'/receive','POST',{confirmed:true})),true));
   if(d.manager&&!logistics&&!r.refunds.length&&!['cancelled','rejected'].includes(r.status))actions.append(button('Chuyển sang nhận để giao lại',async()=>{
    const reason=field('Lý do chuyển sang giao lại','textarea'),form=el('section','pos-return-card');reason.input.value='Nhận hàng về để giao lại, không giảm công nợ hoặc hoàn tiền';
    form.append(el('h3','','Chuyển '+r.returnNo+' sang giao lại'),el('p','','Khôi phục phần công nợ đã giảm, mở lại lượng hàng thực nhận để giao. Giữ nguyên phiếu giao cũ, phiếu thu và lịch sử nhập kho; không nhập kho lần nữa. Phiếu đã hoàn tiền/đổi hàng sẽ bị chặn.'),reason.box,button('Quay lại',show),button('Xác nhận chuyển sang giao lại',async()=>{await api(base+'/'+r.id+'/redelivery','POST',{confirmed:true,reason:reason.input.value});await show();await onChanged();},true));content.replaceChildren(form);
   }));
   if(r.status==='processing'&&!logistics&&!canFinalize){
    const refunded=r.refunds.reduce((n,x)=>n+x.amount,0),available=Math.min(d.account.available,Math.max(0,r.total-refunded));
    if(d.canRefund&&available>0)actions.append(button('Hoàn tiền',async()=>{
     const form=el('section','pos-return-card'),amount=field('Số tiền thực hoàn (tối đa '+money(available)+')','number'),method=select('Hình thức',[['transfer','Chuyển khoản'],['cash','Tiền mặt']]),drawer=select('Két ghi nhận',[['','Chọn két'],...d.drawers.map(x=>[x.id,x.name])]),reference=field('Mã giao dịch chuyển khoản'),note=field('Ghi chú xác nhận','textarea');amount.input.min='1';amount.input.max=String(available);amount.input.step='1';amount.input.value=String(available);const key=crypto.randomUUID(),methodUi=refundMethodControls(d.refundMethods,d.manager,amount.input,method.input);reference.box.hidden=method.input.value!=='transfer';method.input.addEventListener('change',()=>{reference.box.hidden=method.input.value!=='transfer';});
     form.append(el('h3','','Hoàn tiền '+r.returnNo),amount.box,method.box,methodUi.box,drawer.box,reference.box,note.box,button('Quay lại',show),button('Kiểm tra hoàn tiền',async()=>{
      methodUi.check();const value=Number(amount.input.value),payload={key,amount:value,method:method.input.value,drawerId:drawer.input.value,reference:reference.input.value,note:note.input.value,confirmed:true,...methodUi.values()};if(!Number.isSafeInteger(value)||value<=0||value>available||!payload.drawerId||payload.method==='transfer'&&!payload.reference.trim())throw Error('Kiểm tra số tiền, két và mã giao dịch chuyển khoản.');
      await confirm('Xác nhận đã hoàn tiền thực tế',`${money(value)} · ${method.input.selectedOptions[0].textContent} · ${drawer.input.selectedOptions[0].textContent}${payload.reference?' · '+payload.reference:''}. Chỉ xác nhận khi khách đã nhận tiền.`, 'Đã hoàn tiền',()=>api(base+'/'+r.id+'/refund','POST',payload));
     },true));content.replaceChildren(form);
    }));
    if(d.account.available<=0||refunded>=r.total)actions.append(button('Hoàn tất phiếu trả',()=>confirm('Hoàn tất '+r.returnNo,'Hàng trả đã được nhận và phần công nợ/hoàn tiền đã xử lý. Không phát sinh chi tiền ở bước này.','Hoàn tất',()=>api(base+'/'+r.id+'/complete','POST',{})),true));
   }
   for(const f of r.refunds){if(d.manager)actions.append(button('Sửa '+f.refundNo,()=>{content.replaceChildren(refundCorrectionForm(f,{api,onDone:async()=>{toast('Đã sửa '+f.refundNo+'.','ok');await show();await onChanged();},onBack:show}));}));card.append(el('p','pos-note',`${f.refundNo} · ${money(f.amount)} · ${f.method==='cash'?'Tiền mặt':'Chuyển khoản'} · ${f.reference||''} · ${f.confirmedByName||f.confirmedBy} · ${dates(f.confirmedAt)}${f.overrideBy?' · Khác phương thức thu: '+f.overrideReason+' ('+f.overrideEvidence+')':''}`));}
   card.append(actions);content.append(card);
  }
  if(!['draft','cancelled'].includes(d.order.status)&&d.lines.some(l=>l.returnableQty>0&&l.sku)){
   const form=el('form','pos-return-card');form.append(el('h3','','Lập phiếu trả hàng'),el('p','pos-note','Chọn đúng mã và số lượng khách thực trả. Phiếu mới chờ duyệt, chưa cộng tồn hoặc hoàn tiền.'));
   const rows=[];
   for(const l of d.lines.filter(l=>l.returnableQty>0&&l.sku)){const row=el('div','pos-return-line'),qty=field('Số lượng trả (còn '+l.returnableQty+' '+l.unit+')','number'),disposition=select('Tình trạng',[['restock','Nhập lại tồn bán'],['damaged','Hàng hỏng, không nhập tồn bán']]);qty.input.min='0';qty.input.max=String(l.returnableQty);qty.input.step='0.001';qty.input.value='0';row.append(el('strong','',l.name+' ('+l.sku+')'),el('p','pos-note','Đã giao '+l.deliveredQty+' '+l.unit),qty.box,disposition.box);form.append(row);rows.push({l,qty:qty.input,disposition:disposition.input});}
   const purpose=select('Mục đích nhận hàng',[['redelivery','Nhận để giao lại — giữ nguyên tiền và công nợ'],['credit','Trả hàng giảm công nợ — hoàn tiền xử lý riêng']]);
   const askBox=el('div','pos-return-refund-ask'),askAmount=field('Số tiền đề nghị hoàn cho khách (để trống nếu không hoàn)','number'),askMethod=select('Hình thức hoàn',[['transfer','Chuyển khoản'],['cash','Tiền mặt']]),askRef=field('Tài khoản nhận / mã giao dịch (nếu có)'),askNote=field('Ghi chú hoàn tiền','textarea');askAmount.input.min='0';askAmount.input.step='1';askBox.append(el('p','pos-note','Đề nghị hoàn tiền: lưu cùng phiếu, người duyệt xác nhận khi Duyệt & hoàn tất.'),askAmount.box,askMethod.box,askRef.box,askNote.box);const syncAsk=()=>{askBox.hidden=purpose.input.value!=='credit';};purpose.input.addEventListener('change',syncAsk);syncAsk();
   const warehouse=select('Kho thực nhận',[['','Chọn kho'],...d.warehouses.map(w=>[w.id,w.name])]),reason=field('Lý do trả hàng','textarea');warehouse.input.required=reason.input.required=true;const key=crypto.randomUUID();const save=button('Gửi yêu cầu trả hàng',async()=>{const lines=rows.filter(x=>Number(x.qty.value)>0).map(x=>({orderLineId:x.l.id,qty:Number(x.qty.value),disposition:x.disposition.value}));if(!lines.length||rows.some(x=>!Number.isFinite(Number(x.qty.value))||Number(x.qty.value)<0||Number(x.qty.value)>x.l.returnableQty)||!warehouse.input.value||!reason.input.value.trim())throw Error('Chọn mã, số lượng hợp lệ, kho và lý do trả hàng.');const ask=Number(askAmount.input.value||0);if(purpose.input.value==='credit'&&(!Number.isSafeInteger(ask)||ask<0))throw Error('Số tiền đề nghị hoàn không hợp lệ.');await api(base,'POST',{key,purpose:purpose.input.value,warehouseId:warehouse.input.value,reason:reason.input.value,lines,...(purpose.input.value==='credit'&&ask>0?{refundRequest:{amount:ask,method:askMethod.input.value,reference:askRef.input.value,note:askNote.input.value}}:{})});await show();await onChanged();},true);form.onsubmit=e=>{e.preventDefault();save.click();};form.append(purpose.box,warehouse.box,reason.box,askBox,save);content.append(form);
  }
 }
 try{await show();}catch(e){content.replaceChildren(el('p','error',e.message),button('Thử lại',show));}
}

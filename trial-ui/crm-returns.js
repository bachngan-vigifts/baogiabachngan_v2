const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const money=n=>Number(n||0).toLocaleString('vi-VN')+' đ';
const dates=v=>v?new Date(v).toLocaleString('vi-VN'):'';
const states={pending:'Chờ duyệt',approved:'Đã duyệt · Chờ nhận hàng',processing:'Đã nhận · Đang đối trừ/hoàn tiền',completed:'Hoàn tất',cancelled:'Đã huỷ',rejected:'Đã từ chối'};
function field(label,type='text'){const box=el('label','pos-field'),input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;box.append(el('span','',label),input);return{box,input};}
function select(label,rows){const box=el('label','pos-field'),input=el('select');for(const [value,text]of rows){const option=el('option','',text);option.value=value;input.append(option);}box.append(el('span','',label),input);return{box,input};}
/** The order's existing scope and server-computed quantities/money authorize every transition. */
export async function openCrmReturns({api,toast,orderId,onChanged=()=>{}}){
 const dlg=el('dialog','pos-modal pos-return-modal'),body=el('div','pos-modal-content'),head=el('div','pos-return-head'),content=el('div');dlg.dataset.mobileActions='off';
 const close=el('button','btn secondary','Đóng');close.type='button';close.onclick=()=>dlg.close();head.append(el('h2','','Trả hàng / Hoàn tiền'),close);body.append(head,content);dlg.append(body);document.body.append(dlg);dlg.addEventListener('close',()=>dlg.remove(),{once:true});dlg.addEventListener('cancel',e=>{if(dlg.dataset.busy)e.preventDefault();});dlg.showModal();
 const base='/orders/'+encodeURIComponent(orderId)+'/returns';
 const button=(text,fn,primary=false)=>{const b=el('button',primary?'btn primary':'btn secondary',text);b.type='button';b.dataset.mobileInline='';b.onclick=async()=>{if(dlg.dataset.busy)return;dlg.dataset.busy='1';dlg.querySelectorAll('button').forEach(n=>n.disabled=true);try{await fn();}catch(e){toast(e.message,'err');}finally{delete dlg.dataset.busy;dlg.querySelectorAll('button').forEach(n=>n.disabled=false);}};return b;};
 async function confirm(title,text,ok,fn){
  const section=el('section','pos-return-card'),actions=el('div','pos-return-actions');section.append(el('h3','',title),el('p','',text));actions.append(button('Quay lại',show),button(ok,async()=>{await fn();await show();await onChanged();},true));section.append(actions);content.replaceChildren(section);
 }
 async function show(){
  const d=await api(base);if(!dlg.open)return;content.replaceChildren();
  content.append(el('h3','',d.order.orderNo+' · '+d.order.customerName),el('p','pos-note',`Đã thu ${money(d.account.paid)} · Giá trị đã trả ${money(d.account.credit)} · Đã hoàn ${money(d.account.refunded)}`),el('p','',d.account.balance>0?'Còn phải thu: '+money(d.account.balance):d.account.available>0?'Tiền dư còn có thể hoàn: '+money(d.account.available):'Đã đối trừ đủ, không còn tiền dư phải hoàn.'));
  if(d.order.invoiceIssued)content.append(el('p','pos-note','Đơn đã xuất hoá đơn. Phiếu trả giữ lịch sử hoá đơn gốc; cần chuyển kế toán xử lý chứng từ hoá đơn liên quan.'));
  for(const r of d.returns){
   const card=el('section','pos-return-card'),actions=el('div','pos-return-actions');card.append(el('h3','',r.returnNo+' · '+(states[r.status]||r.status)),el('p','',`Giá trị trả ${money(r.total)} · Kho: ${d.warehouses.find(w=>w.id===r.warehouseId)?.name||r.warehouseId}`),el('p','pos-note',r.reason));
   for(const l of r.lines)card.append(el('p','',`${l.name} (${l.sku}) · ${l.requestedQty} ${l.unit} · ${money(l.total)} · ${l.disposition==='restock'?'Nhập lại tồn bán':'Hàng hỏng, không cộng tồn bán'}`));
   for(const [label,name,at]of [['Người lập',r.createdByName,r.createdAt],['Người duyệt',r.approvedByName,r.approvedAt],['Người nhận',r.receivedByName,r.receivedAt]])if(at)card.append(el('p','pos-note',label+': '+(name||'—')+' · '+dates(at)));
   if(r.status==='pending'&&d.canApprove&&(d.manager||r.createdBy!==d.viewerId))actions.append(button('Duyệt phiếu trả',()=>confirm('Duyệt '+r.returnNo,`Duyệt trả ${money(r.total)} cho đúng các mã và số lượng trên phiếu. Chưa nhập kho hoặc hoàn tiền ở bước này.`,'Duyệt',()=>api(base+'/'+r.id+'/approve','POST',{})),true));
   if(['pending','approved'].includes(r.status)&&(r.createdBy===d.viewerId||d.canApprove))actions.append(button(r.createdBy===d.viewerId?'Huỷ yêu cầu':'Từ chối',async()=>{const reason=field('Lý do huỷ / từ chối','textarea');const card=el('section','pos-return-card');card.append(reason.box,button('Quay lại',show),button('Xác nhận huỷ / từ chối',async()=>{if(!reason.input.value.trim())throw Error('Nhập lý do.');await api(base+'/'+r.id+'/cancel','POST',{reason:reason.input.value});await show();await onChanged();}));content.replaceChildren(card);}));
   if(r.status==='approved')actions.append(button('Nhận hàng trả về kho',()=>confirm('Xác nhận thực nhận '+r.returnNo,`Chỉ bấm khi đã nhận đủ đúng ${r.lines.map(l=>l.sku+': '+l.requestedQty+' '+l.unit).join('; ')} tại ${d.warehouses.find(w=>w.id===r.warehouseId)?.name||r.warehouseId}. Nhập tồn bán các dòng đủ điều kiện và giảm công nợ ${money(r.total)}. Chưa chi tiền hoàn.`,'Đã nhận đủ hàng',()=>api(base+'/'+r.id+'/receive','POST',{confirmed:true})),true));
   if(r.status==='processing'){
    const refunded=r.refunds.reduce((n,x)=>n+x.amount,0),available=Math.min(d.account.available,Math.max(0,r.total-refunded));
    if(d.canRefund&&available>0)actions.append(button('Hoàn tiền',async()=>{
     const form=el('section','pos-return-card'),amount=field('Số tiền thực hoàn (tối đa '+money(available)+')','number'),method=select('Hình thức',[['transfer','Chuyển khoản'],['cash','Tiền mặt']]),drawer=select('Két ghi nhận',[['','Chọn két'],...d.drawers.map(x=>[x.id,x.name])]),reference=field('Mã giao dịch chuyển khoản'),note=field('Ghi chú xác nhận','textarea');amount.input.min='1';amount.input.max=String(available);amount.input.step='1';amount.input.value=String(available);const key=crypto.randomUUID();
     form.append(el('h3','','Hoàn tiền '+r.returnNo),amount.box,method.box,drawer.box,reference.box,note.box,button('Quay lại',show),button('Kiểm tra hoàn tiền',async()=>{
      const value=Number(amount.input.value),payload={key,amount:value,method:method.input.value,drawerId:drawer.input.value,reference:reference.input.value,note:note.input.value,confirmed:true};if(!Number.isSafeInteger(value)||value<=0||value>available||!payload.drawerId||payload.method==='transfer'&&!payload.reference.trim())throw Error('Kiểm tra số tiền, két và mã giao dịch chuyển khoản.');
      await confirm('Xác nhận đã hoàn tiền thực tế',`${money(value)} · ${method.input.selectedOptions[0].textContent} · ${drawer.input.selectedOptions[0].textContent}${payload.reference?' · '+payload.reference:''}. Chỉ xác nhận khi khách đã nhận tiền.`, 'Đã hoàn tiền',()=>api(base+'/'+r.id+'/refund','POST',payload));
     },true));content.replaceChildren(form);
    }));
    if(d.account.available<=0||refunded>=r.total)actions.append(button('Hoàn tất phiếu trả',()=>confirm('Hoàn tất '+r.returnNo,'Hàng trả đã được nhận và phần công nợ/hoàn tiền đã xử lý. Không phát sinh chi tiền ở bước này.','Hoàn tất',()=>api(base+'/'+r.id+'/complete','POST',{})),true));
   }
   for(const f of r.refunds)card.append(el('p','pos-note',`${f.refundNo} · ${money(f.amount)} · ${f.method==='cash'?'Tiền mặt':'Chuyển khoản'} · ${f.reference||''} · ${f.confirmedByName||f.confirmedBy} · ${dates(f.confirmedAt)}`));
   card.append(actions);content.append(card);
  }
  if(!['draft','cancelled'].includes(d.order.status)&&d.lines.some(l=>l.returnableQty>0&&l.sku)){
   const form=el('form','pos-return-card');form.append(el('h3','','Lập phiếu trả hàng'),el('p','pos-note','Chọn đúng mã và số lượng khách thực trả. Phiếu mới chờ duyệt, chưa cộng tồn hoặc hoàn tiền.'));
   const rows=[];
   for(const l of d.lines.filter(l=>l.returnableQty>0&&l.sku)){const row=el('div','pos-return-line'),qty=field('Số lượng trả (còn '+l.returnableQty+' '+l.unit+')','number'),disposition=select('Tình trạng',[['restock','Nhập lại tồn bán'],['damaged','Hàng hỏng, không nhập tồn bán']]);qty.input.min='0';qty.input.max=String(l.returnableQty);qty.input.step='0.001';qty.input.value='0';row.append(el('strong','',l.name+' ('+l.sku+')'),el('p','pos-note','Đã giao '+l.deliveredQty+' '+l.unit),qty.box,disposition.box);form.append(row);rows.push({l,qty:qty.input,disposition:disposition.input});}
   const warehouse=select('Kho thực nhận',[['','Chọn kho'],...d.warehouses.map(w=>[w.id,w.name])]),reason=field('Lý do trả hàng','textarea');warehouse.input.required=reason.input.required=true;const key=crypto.randomUUID();const save=button('Gửi yêu cầu trả hàng',async()=>{const lines=rows.filter(x=>Number(x.qty.value)>0).map(x=>({orderLineId:x.l.id,qty:Number(x.qty.value),disposition:x.disposition.value}));if(!lines.length||rows.some(x=>!Number.isFinite(Number(x.qty.value))||Number(x.qty.value)<0||Number(x.qty.value)>x.l.returnableQty)||!warehouse.input.value||!reason.input.value.trim())throw Error('Chọn mã, số lượng hợp lệ, kho và lý do trả hàng.');await api(base,'POST',{key,warehouseId:warehouse.input.value,reason:reason.input.value,lines});await show();await onChanged();},true);form.onsubmit=e=>{e.preventDefault();save.click();};form.append(warehouse.box,reason.box,save);content.append(form);
  }
 }
 try{await show();}catch(e){content.replaceChildren(el('p','error',e.message),button('Thử lại',show));}
}

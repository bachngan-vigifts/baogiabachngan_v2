/** Held cash is deliberately separate from effective customer payments. */
export function mountCashCollections({host,rows=[],canConfirm=false,api,confirmBox,onChanged}) {
 if(!rows.length)return;
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
 const money=n=>Number(n).toLocaleString('vi-VN')+' đ';
 const when=s=>s?new Date(s).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—';
 const section=el('section','cash-collections'),list=el('ul','plain-list');section.setAttribute('aria-label','Tiền mặt nhân viên giữ');
 section.append(el('h3','','Bàn giao tiền mặt'),list);host.append(section);
 for(const r of rows){
  const row=el('li',''),info=el('span'),held=r.status==='held',status=held?'Tiền mặt nhân viên còn giữ':r.status==='cancelled'?'Đã huỷ ghi nhận':r.paymentVoidedAt?'Đã nhận tiền · phiếu thu đã huỷ':'Manager đã nhận tiền';
  info.append(el('b',held?'warn-text':'',status),el('small','',r.collectedByName+' · Ngày thu khách: '+r.paidAt));
  if(r.confirmedAt)info.append(el('small','',r.confirmedByName+' xác nhận: '+when(r.confirmedAt)));
  if(r.cancelReason)info.append(el('small','',r.cancelledByName+' · '+r.cancelReason));
  if(r.reference)info.append(el('small','',r.reference));
  row.append(info,el('b','',money(r.amount)));list.append(row);
  if(!held)continue;
  info.append(el('small','','Chờ Manager thực nhận và xác nhận; chưa hoàn tất thanh toán.'));
  if(!canConfirm)continue;
  const actions=el('div','row-gap'),error=el('small','error');error.setAttribute('role','alert');let busy=false;
  const act=(label,fn,cls='btn secondary small')=>{const b=el('button',cls,label);b.type='button';b.addEventListener('click',fn);actions.append(b);return b;};
  const lock=value=>{busy=value;for(const b of actions.querySelectorAll('button'))b.disabled=value;};
  const confirm=act('Xác nhận đã nhận tiền',async()=>{
   if(busy)return;lock(true);error.textContent='';
   try{
    if(!await confirmBox(`Anh/chị đã thực nhận ${money(r.amount)} từ ${r.collectedByName}? Xác nhận sẽ ghi phiếu thu và giảm công nợ.`,{title:'Nhận tiền nhân viên bàn giao',ok:'Đã thực nhận tiền'}))return;
    await api('/payments/cash-collections/'+encodeURIComponent(r.id)+'/confirm','POST',{confirmed:true});await onChanged();
   }catch(e){error.textContent=e.message;}finally{lock(false);}
  },'btn primary small');confirm.dataset.mobilePrimary='';
  act('Huỷ ghi nhận…',()=>{
   if(busy||row.querySelector('form'))return;
   const form=el('form','void-form'),reason=el('input');reason.required=true;reason.minLength=3;reason.maxLength=500;reason.placeholder='Lý do thu nhầm / đã trả tiền lại khách';reason.setAttribute('aria-label','Lý do huỷ ghi nhận tiền mặt');
   const submit=el('button','btn danger-outline small','Xác nhận huỷ ghi nhận');submit.type='submit';form.append(reason,submit);row.append(form);reason.focus();
   form.addEventListener('submit',async e=>{e.preventDefault();if(busy||reason.value.trim().length<3)return;lock(true);submit.disabled=true;error.textContent='';
    try{if(!await confirmBox('Chỉ huỷ khi ghi nhận thu nhầm hoặc tiền đã trả lại khách. Đây không phải thao tác hoàn tiền tự động.',{title:'Huỷ ghi nhận tiền mặt',ok:'Xác nhận huỷ',danger:true}))return;
     await api('/payments/cash-collections/'+encodeURIComponent(r.id)+'/cancel','POST',{confirmed:true,reason:reason.value.trim()});await onChanged();
    }catch(ex){error.textContent=ex.message;}finally{lock(false);submit.disabled=false;}
   });
  });row.append(actions,error);
 }
}

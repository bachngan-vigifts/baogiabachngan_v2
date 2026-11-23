const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
export function bindQuoteEditRequests({button,getContext,api,reload}){
 let busy=false;
 const render=()=>{
  const c=getContext(),mine=c.editRequest?.mine,pending=c.editRequest?.pending||[];
  button.hidden=!c.id||!c.approved||(c.manager?!pending.length:!c.canRequest);
  button.disabled=busy||(!c.manager&&['pending','approved'].includes(mine?.status));
  button.textContent=c.manager?`Duyệt yêu cầu sửa (${pending.length})`:mine?.status==='pending'?'Đang chờ cho phép sửa':mine?.status==='approved'?'Được phép sửa':'Sửa báo giá';
  button.title=c.manager?'Xem lý do và cho phép hoặc từ chối yêu cầu sửa':mine?.status==='approved'?'Được lưu một lần cho phiên bản này; sau khi lưu phải gửi duyệt lại.':mine?.status==='rejected'?`Bị từ chối: ${mine.decisionReason}`:'Gửi yêu cầu cho Manager cho phép sửa báo giá đã duyệt';
 };
 button.addEventListener('click',()=>{
  const c=getContext();if(busy||!c.id||!c.approved)return;
  const dlg=el('dialog','modal quote-edit-request-dialog'),form=el('form','quote-edit-request-form');
  const head=el('div','modal-head'),title=el('h3','',c.manager?'Duyệt yêu cầu sửa báo giá':'Xin phép sửa báo giá');
  title.id='quote-edit-dialog-title';dlg.setAttribute('aria-labelledby',title.id);
  head.append(title);const body=el('div','modal-body'),foot=el('div','modal-foot'),close=el('button','btn secondary','Đóng');close.type='button';
  const error=el('p','error');error.setAttribute('role','alert');
  body.append(el('p','',c.manager?'Cho phép sửa chỉ áp dụng cho đúng nhân viên và phiên bản này. Sau khi nhân viên lưu, báo giá về nháp và phải gửi duyệt lại.':'Nhập lý do cần sửa. Báo giá giữ nguyên cho tới khi Manager cho phép và anh/chị lưu bản sửa. Lưu xong phải gửi duyệt lại.'));
  const selected=el('select'),reason=el('textarea');reason.maxLength=500;reason.rows=3;
  reason.setAttribute('aria-label',c.manager?'Lý do quyết định':'Lý do sửa báo giá');
  if(c.manager){
   selected.setAttribute('aria-label','Yêu cầu cần xử lý');
   for(const r of c.editRequest?.pending||[]){const o=el('option','',`${r.requesterName} · ${r.reason}`);o.value=r.id;selected.append(o);}
   const explanation=el('p','quote-edit-request-reason');
   const showReason=()=>{explanation.textContent=(c.editRequest?.pending||[]).find(r=>r.id===selected.value)?.reason||'';};
   selected.addEventListener('change',showReason);showReason();
   body.append(selected,explanation,el('label','', 'Ghi chú quyết định (bắt buộc khi từ chối)'));
  }else{reason.required=true;reason.minLength=5;body.append(el('label','','Lý do sửa (5–500 ký tự)'));}
  body.append(reason,error);foot.append(close);
  const submit=el('button','btn primary',c.manager?'Cho phép sửa':'Gửi yêu cầu');submit.type='submit';foot.append(submit);
  const reject=el('button','btn danger-outline','Từ chối');reject.type='button';if(c.manager)foot.append(reject);
  form.append(head,body,foot);dlg.append(form);document.body.append(dlg);
  const dismiss=()=>{if(!busy){dlg.close();dlg.remove();}};
  close.addEventListener('click',dismiss);dlg.addEventListener('cancel',e=>{e.preventDefault();dismiss();});
  dlg.addEventListener('close',()=>{if(!busy)dlg.remove();});
  const send=async(decision)=>{
   if(busy)return;const text=reason.value.trim();
   if((!c.manager||decision==='rejected')&&text.length<5){error.textContent='Nhập lý do ít nhất 5 ký tự.';reason.focus();return;}
   busy=true;render();for(const n of [submit,reject,close,selected,reason])n.disabled=true;error.textContent='';
   try{
    const path=`/quotes/${encodeURIComponent(c.id)}/edit-request`;
    await api(c.manager?`${path}/${encodeURIComponent(selected.value)}/decision`:path,'POST',{revision:c.revision,reason:text,...(c.manager?{decision}:{})});
    busy=false;dlg.close();dlg.remove();await reload(c.id);
   }catch(e){error.textContent=e.message||'Không gửi được yêu cầu. Thử lại.';}
   finally{busy=false;for(const n of [submit,reject,close,selected,reason])n.disabled=false;render();}
  };
  form.addEventListener('submit',e=>{e.preventDefault();send('approved');});reject.addEventListener('click',()=>send('rejected'));
  dlg.showModal();reason.focus();
 });
 return{render};
}

/** Assignment is a separate write after document creation; never resubmit /orders or /contracts on failure. */
export async function openSaleAdminHandoff({api,orderId,documentNo='',created=false,isCurrent=()=>true}){
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const d=el('dialog','modal sale-admin-handoff'),form=el('form','sup-form'),head=el('div','modal-head'),title=el('h2','',created?'Đã tạo '+documentNo:'Giao hồ sơ cho Sale Admin'),close=el('button','icon-btn','×');
 close.type='button';close.setAttribute('aria-label','Đóng bảng giao hồ sơ');head.append(title,close);
 const note=el('p','muted','Chọn Sale Admin nhận xử lý báo giá và Đơn hàng/HĐKT liên kết. Người bán và doanh số được giữ nguyên.'),status=el('p','muted','Đang tải người nhận…'),label=el('label','', 'Sale Admin nhận xử lý'),select=el('select'),none=el('option','','Không giao');none.value='';select.append(none);select.disabled=true;select.setAttribute('aria-label','Sale Admin nhận xử lý');label.append(select);
 const error=el('p','error'),foot=el('div','modal-foot'),later=el('button','btn secondary','Để sau'),save=el('button','btn primary','Xác nhận giao hồ sơ');later.type='button';save.type='submit';save.disabled=true;foot.append(later,save);form.append(head,note,status,label,error,foot);d.append(form);document.body.append(d);
 let busy=false,model=null,uncertain=null,result=null;
 const finish=new Promise(resolve=>d.addEventListener('close',()=>{d.remove();resolve(result);},{once:true}));
 close.onclick=later.onclick=()=>{if(!busy)d.close();};d.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 d.showModal();
 async function load(){
  try{const m=await api('/orders/'+encodeURIComponent(orderId)+'/sale-admin-assignment');if(!d.open||!isCurrent()){if(d.open)d.close();return;}
   model=m;status.textContent=m.assigneeId?'Đang giao: '+m.assigneeName:'Hồ sơ chưa giao Sale Admin.';
   for(const p of m.candidates){const o=el('option','',p.name+(p.eligible?'':' · '+p.reason));o.value=p.id;o.disabled=!p.eligible;select.append(o);}
   if(m.assigneeId&&!m.candidates.some(p=>p.id===m.assigneeId)){const o=el('option','',m.assigneeName+' · không còn đủ điều kiện nhận mới');o.value=m.assigneeId;o.disabled=true;select.append(o);}select.value=m.assigneeId||'';select.disabled=!m.canAssign;save.disabled=!m.canAssign;
   if(!m.canAssign)status.textContent+=' Chỉ Manager hoặc người tạo/phụ trách hồ sơ được thay đổi người nhận.';
  }catch(e){error.textContent='Chứng từ đã được giữ nguyên. '+(e.message||'Chưa tải được người nhận.')+' Đóng bảng rồi mở lại để thử.';}
 }
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!model?.canAssign||!isCurrent())return;
  const body=uncertain||{assigneeId:select.value||null,revision:model.revision};busy=true;save.disabled=true;select.disabled=true;close.disabled=later.disabled=true;error.textContent='';
  try{const r=await api('/orders/'+encodeURIComponent(orderId)+'/sale-admin-assignment','POST',body);if(!isCurrent()){d.close();return;}result=r;d.close();}
  catch(ex){uncertain=!ex.status||ex.status>=500?body:null;error.textContent=(ex.message||'Chưa giao được hồ sơ.')+(uncertain?' Chưa rõ kết quả giao. Bấm kiểm tra lại cùng lựa chọn; không sinh lại chứng từ.':'');save.textContent=uncertain?'Kiểm tra lại việc giao':'Xác nhận giao hồ sơ';select.disabled=!!uncertain;}
  finally{busy=false;save.disabled=false;close.disabled=later.disabled=false;}
 });
 await load();return finish;
}

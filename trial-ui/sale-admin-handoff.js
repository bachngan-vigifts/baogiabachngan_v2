/** Assignment is a separate write after document creation; never resubmit /orders or /contracts on failure. */
export async function openSaleAdminHandoff({api,orderId,documentNo='',created=false,isCurrent=()=>true}){
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const d=el('dialog','modal sale-admin-handoff'),form=el('form','sup-form'),head=el('div','modal-head'),title=el('h2','',created?'Đã tạo '+documentNo:'Giao hồ sơ cho Sale Admin'),close=el('button','icon-btn','×');
 close.type='button';close.setAttribute('aria-label','Đóng bảng giao hồ sơ');head.append(title,close);
 const note=el('p','muted','Chọn Sale Admin nhận xử lý báo giá và Đơn hàng/HĐKT liên kết. Người bán và doanh số được giữ nguyên.'),status=el('p','muted','Đang tải người nhận…'),label=el('label','', 'Sale Admin nhận xử lý'),select=el('select'),none=el('option','','Không giao');none.value='';select.append(none);select.disabled=true;select.setAttribute('aria-label','Sale Admin nhận xử lý');label.append(select);
 const searchLabel=el('label','','Tìm Sale Admin theo tên'),search=el('input'),searchButton=el('button','btn secondary','Tìm Sale Admin'),more=el('button','btn secondary','Tải thêm Sale Admin');
 search.type='search';search.maxLength=100;search.setAttribute('aria-label','Tìm Sale Admin theo tên');searchLabel.append(search);searchButton.type=more.type='button';more.hidden=true;
 const error=el('p','error'),foot=el('div','modal-foot'),later=el('button','btn secondary','Để sau'),save=el('button','btn primary','Xác nhận giao hồ sơ');later.type='button';save.type='submit';save.disabled=true;foot.append(later,save);form.append(head,note,status,searchLabel,searchButton,label,more,error,foot);d.append(form);document.body.append(d);
 let busy=false,loading=false,loadId=0,model=null,uncertain=null,result=null,query='',nextOffset=null;
 const finish=new Promise(resolve=>d.addEventListener('close',()=>{d.remove();resolve(result);},{once:true}));
 close.onclick=later.onclick=()=>{if(!busy)d.close();};d.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
 d.showModal();
 const syncControls=()=>{select.disabled=busy||loading||!!uncertain||!model?.canAssign;save.disabled=busy||loading||!model?.canAssign;search.disabled=searchButton.disabled=more.disabled=busy||loading||!!uncertain;};
 async function load({term='',offset=0,append=false}={}){
  if(busy||uncertain)return;
  const hadModel=!!model,request=++loadId,selected=select.value,selectedOption=select.selectedOptions[0]?.cloneNode(true);
  loading=true;syncControls();error.textContent='';
  try{
   const params=new URLSearchParams();if(term)params.set('candidateSearch',term);if(offset)params.set('candidateOffset',String(offset));
   const m=await api('/orders/'+encodeURIComponent(orderId)+'/sale-admin-assignment'+(params.size?'?'+params:''));
   if(request!==loadId||!d.open||!isCurrent()){if(d.open&&!isCurrent())d.close();return;}
   if(model&&m.revision!==model.revision){error.textContent='Hồ sơ vừa được giao lại. Đóng bảng và mở lại để kiểm tra người nhận mới.';model={...model,canAssign:false};return;}
   model=m;query=term;nextOffset=m.candidatePage?.nextOffset??null;
   status.textContent=m.assigneeId?'Đang giao: '+m.assigneeName:'Hồ sơ chưa giao Sale Admin.';
   if(!append){select.replaceChildren(none);}
   const existing=new Set([...select.options].map(o=>o.value));
   for(const p of m.candidates){let o=[...select.options].find(o=>o.value===p.id);if(!o){o=el('option');o.value=p.id;select.append(o);}o.textContent=p.name+(p.eligible?'':' · '+p.reason);o.disabled=!p.eligible;existing.add(p.id);}
   const wanted=hadModel?selected:(m.assigneeId||'');
   if(wanted&&!existing.has(wanted)){
    const o=selectedOption?.value===wanted?selectedOption:el('option','',m.assigneeName+' · đang giao (ngoài kết quả)');o.value=wanted;if(!selectedOption||selectedOption.value!==wanted)o.disabled=true;select.append(o);
   }
   select.value=wanted;more.hidden=nextOffset===null;
   if(!m.canAssign)status.textContent+=' Chỉ Manager hoặc người tạo/phụ trách hồ sơ được thay đổi người nhận.';
  }catch(e){if(request===loadId)error.textContent='Chứng từ đã được giữ nguyên. '+(e.message||'Chưa tải được người nhận.')+' Có thể thử tìm/tải lại; không sinh lại chứng từ.';}
  finally{if(request===loadId){loading=false;syncControls();}}
 }
 searchButton.onclick=()=>load({term:search.value.trim()});more.onclick=()=>load({term:query,offset:nextOffset,append:true});
 search.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();load({term:search.value.trim()});}});
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||loading||!model?.canAssign||!isCurrent())return;
  const body=uncertain||{assigneeId:select.value||null,revision:model.revision};busy=true;syncControls();close.disabled=later.disabled=true;error.textContent='';
  try{const r=await api('/orders/'+encodeURIComponent(orderId)+'/sale-admin-assignment','POST',body);if(!isCurrent()){d.close();return;}result=r;d.close();}
  catch(ex){uncertain=!ex.status||ex.status>=500?body:null;error.textContent=(ex.message||'Chưa giao được hồ sơ.')+(uncertain?' Chưa rõ kết quả giao. Bấm kiểm tra lại cùng lựa chọn; không sinh lại chứng từ.':'');save.textContent=uncertain?'Kiểm tra lại việc giao':'Xác nhận giao hồ sơ';select.disabled=!!uncertain;}
  finally{busy=false;syncControls();close.disabled=later.disabled=false;}
 });
 await load();return finish;
}

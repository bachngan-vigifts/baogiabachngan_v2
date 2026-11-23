/** Explicit manager amendment; the server rechecks historical documents at commit time. */
export async function openPurchaseAmend({api,id,onSaved=()=>{}}){
 const context=await api('/purchase-orders/'+encodeURIComponent(id)+'/amend'),order=context.order;
 const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const dialog=el('dialog');dialog.className='modal';dialog.style.cssText='width:min(1000px,calc(100vw - 24px));max-height:calc(100dvh - 24px);padding:16px;overflow:auto';
 const form=el('form');form.className='sup-form';const h=el('h2','Điều chỉnh đơn '+order.ticketNumber),info=el('p',context.noteOnly?'Đã có chứng từ: chỉ sửa ghi chú nội bộ. Hàng/tiền cần qua Trả hàng hoặc Huỷ phần chưa nhận.':'Điều chỉnh hàng/giá sẽ yêu cầu NCC xác nhận lại. Giữ nguyên NCC và ID các dòng cũ.');
 form.append(h,info);if(context.blockers.length)form.append(el('p',context.blockers.map(b=>b.kind+' ('+b.count+')').join(' · ')));
 const field=(title,input)=>{const label=el('label',title);label.append(input);return label;},input=(value,type='text')=>{const n=el('input');n.type=type;n.value=value??'';return n;};
 const reason=el('textarea'),note=el('textarea');reason.required=true;reason.maxLength=2000;note.maxLength=2000;note.value=order.note||'';form.append(field('Lý do điều chỉnh *',reason),field('Ghi chú nội bộ',note));
 const list=el('div'),rows=[];let changed=false;
 const number=(value,step='0.01')=>{const n=input(value,'number');n.min='0';n.step=step;n.required=true;return n;};
 function addLine(line={}){
  const row=el('fieldset');row.className='panel';row.style.cssText='padding:12px;margin:10px 0';const controls={sku:input(line.sku||''),name:input(line.name||''),unit:input(line.unit||''),quantity:number(line.quantity??1,'1'),price:number(line.price??''),taxRate:number(line.taxRate??0),purchaseDiscount:number(line.purchaseDiscount??0),printFee:number(line.printFee??0),promisedDate:input(line.promisedDate||'','date')};
  controls.sku.required=true;controls.sku.readOnly=!!line.id;controls.quantity.min='1';controls.purchaseDiscount.max='100';controls.taxRate.max='100';const grid=el('div');grid.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px';
  const labels={sku:'SKU',name:'Tên hàng',unit:'ĐVT',quantity:'SL đặt',price:'Giá mua',taxRate:'VAT %',purchaseDiscount:'CK %',printFee:'Phí in / SP',promisedDate:'Ngày hẹn dòng'};for(const [key,n]of Object.entries(controls))grid.append(field(labels[key],n));row.append(grid);
  const sourceInputs=(line.sources||[]).map(s=>{const qty=number(s.quantity,'any');qty.required=false;row.append(field('Nguồn '+s.no+' · SL phân bổ (0 để bỏ nguồn)',qty));return{s,qty};});
  const remove=el('button','Bỏ dòng');remove.type='button';remove.className='btn secondary';const state={line,controls,sourceInputs,row,removed:false};remove.onclick=()=>{state.removed=true;changed=true;row.remove();};row.append(remove);row.addEventListener('input',()=>changed=true);rows.push(state);list.append(row);
 }
 if(!context.noteOnly){for(const line of order.lines)addLine(line);const add=el('button','+ Thêm mã hàng');add.type='button';add.className='btn secondary';add.onclick=()=>{changed=true;addLine();};form.append(list,add);}
 const error=el('p');error.className='error';error.setAttribute('role','alert');const footer=el('div');footer.style.cssText='position:sticky;bottom:-16px;background:white;padding:12px 0;display:flex;flex-wrap:wrap;gap:10px';
 const close=el('button','Đóng');close.type='button';close.className='btn secondary';const save=el('button','Lưu điều chỉnh');save.type='submit';save.className='btn primary';footer.append(close,save);form.append(error,footer);dialog.append(form);document.body.append(dialog);const dispose=()=>{dialog.close();dialog.remove();};close.onclick=dispose;dialog.addEventListener('cancel',e=>{e.preventDefault();dispose();});
 form.onsubmit=async e=>{e.preventDefault();if(save.disabled)return;const controls=[...form.querySelectorAll('input,textarea,button')],disabled=controls.map(n=>n.disabled);controls.forEach(n=>n.disabled=true);error.textContent='';try{
  const payload={revision:context.revision,reason:reason.value,note:note.value};
  if(changed&&!context.noteOnly)payload.lines=rows.filter(r=>!r.removed).map(({line,controls,sourceInputs})=>({...(line.id?{lineId:line.id}:{}),sku:controls.sku.value,name:controls.name.value,unit:controls.unit.value,quantity:Number(controls.quantity.value),price:Number(controls.price.value),taxRate:Number(controls.taxRate.value),purchaseDiscount:Number(controls.purchaseDiscount.value),printFee:Number(controls.printFee.value),promisedDate:controls.promisedDate.value,sources:sourceInputs.filter(({qty})=>Number(qty.value)>0).map(({s,qty})=>({type:s.type,id:s.id,quantity:Number(qty.value)}))}));
  const saved=await api('/purchase-orders/'+encodeURIComponent(id)+'/amend','POST',payload);dispose();await onSaved(saved);
 }catch(e){error.textContent=e.message||'Chưa lưu được. Giữ nội dung hiện tại và kiểm tra lại trước khi gửi.';error.scrollIntoView({block:'center'});}finally{controls.forEach((n,i)=>n.disabled=disabled[i]);}};
 dialog.showModal();return{dialog};
}

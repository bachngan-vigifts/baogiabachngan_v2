/** Lazy dialog: no requests until a Manager explicitly saves an adjustment. */
export function showPackingAdjustment({data,api,toast,onSaved,esc}){
 if(!data.canAdjustQuantities||document.querySelector('.packed-adjust-modal[open]'))return;
 const dialog=document.createElement('dialog');dialog.className='modal packed-adjust-modal';
 dialog.setAttribute('aria-label','Điều chỉnh số lượng đã đóng');
 dialog.innerHTML=`<form class="modal-body"><h2>Điều chỉnh ${esc(data.slip.slipNo)}</h2>
 <p class="muted">Giữ trạng thái Kho đã đóng. Tăng số lượng sẽ xuất thêm; giảm sẽ hoàn phần chênh lệch về đúng kho. Không tự đổi số đã giao hoặc số lượng đặt hàng.</p>
 <div class="packed-adjust-lines">${data.lines.map((l,i)=>`<section class="packed-adjust-row"><div><b>${esc(l.name)}</b><small class="muted">${esc(l.sku)} · Hiện tại: ${esc(l.qty)} ${esc(l.unit)}</small><small data-delta="${i}"></small></div><label>SL mới<input type="number" min="0.001" max="1000000000" step="0.001" required name="qty-${i}" value="${esc(l.qty)}" aria-label="Số lượng mới ${esc(l.name)}"></label></section>`).join('')}</div>
 <label>Lý do điều chỉnh<textarea name="reason" required minlength="5" maxlength="1000" rows="2" placeholder="Ghi rõ số thực tế và lý do tăng/giảm"></textarea></label>
 <p role="status" class="error" data-error></p><div class="row-gap"><button type="button" class="btn secondary" data-close>Huỷ</button><button type="submit" class="btn primary">Lưu & cập nhật kho</button></div></form>`;
 const form=dialog.querySelector('form'),close=dialog.querySelector('[data-close]'),error=dialog.querySelector('[data-error]');let busy=false,key=crypto.randomUUID(),payloadStamp='';
 form.addEventListener('input',()=>{data.lines.forEach((l,i)=>{const n=Number(form.elements.namedItem('qty-'+i).value),delta=Math.round((n-l.qty)*1000)/1000;dialog.querySelector(`[data-delta="${i}"]`).textContent=!Number.isFinite(n)||n<=0?'':delta>0?`Xuất thêm ${delta} ${l.unit}`:delta<0?`Hoàn về kho ${-delta} ${l.unit}`:'Không đổi';});});
 close.addEventListener('click',()=>{if(!busy)dialog.close();});
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!form.reportValidity())return;
  const lines=data.lines.map((l,i)=>({id:l.id,qty:Number(form.elements.namedItem('qty-'+i).value)})),reason=form.elements.namedItem('reason').value.trim();
  const stamp=JSON.stringify({lines,reason});if(payloadStamp&&payloadStamp!==stamp)key=crypto.randomUUID();payloadStamp=stamp;
  busy=true;error.textContent='Đang đối soát số lượng và cập nhật kho…';for(const el of form.elements)el.disabled=true;
  try{await api('/packing/'+encodeURIComponent(data.slip.id)+'/adjust-quantities','POST',{revision:data.slip.revision,clientKey:key,reason,lines});dialog.close();toast('Đã điều chỉnh số lượng và ghi sổ kho phần chênh lệch.');await onSaved();}
  catch(ex){error.textContent=ex.message||'Chưa xác nhận được kết quả. Giữ nguyên nội dung và thử lại.';}
  finally{busy=false;for(const el of form.elements)el.disabled=false;}
 });
 document.body.append(dialog);dialog.showModal();form.elements.namedItem('reason').focus();
}

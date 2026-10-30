/** Manager confirms physical return/refund; this dialog only records CRM documents. */
export async function openPosQuickCancel({api,toast,orderId,money,onChanged,ghn=false}){
 const path='/pos/orders/'+encodeURIComponent(orderId)+(ghn?'/ghn-quick-cancel':'/quick-cancel'),d=await api(path);
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const dialog=el('dialog',null,'modal'),form=el('form'),head=el('div',null,'modal-head'),body=el('div',null,'modal-body form-grid'),foot=el('div',null,'modal-foot');
 dialog.setAttribute('aria-label','Huỷ nhanh bill POS');form.dataset.mobileActions='off';
 head.append(el('h2','Huỷ nhanh '+d.orderNo));
 body.append(el('p',ghn?`Huỷ đơn, bỏ giữ hàng và nhập lại số đã xuất vào ${d.warehouse}. ${d.amount>0?'Ghi hoàn đúng số đã thu: '+money(d.amount)+'.':'Đơn chưa thu tiền, không lập khoản hoàn tiền.'}`:`Nhập lại toàn bộ hàng vào ${d.warehouse} và ghi hoàn ${money(d.amount)} bằng ${d.method==='cash'?'tiền mặt':'chuyển khoản'}.`));
 if(ghn){for(const state of d.ghn)body.append(el('p',state.code+' · '+(state.status==='returned'?'GHN đã hoàn hàng thành công':'GHN đã huỷ vận đơn'),'muted small'));if(!d.lines.length)body.append(el('p','Không có hàng đã xuất cần cộng lại kho.','muted small'));}
 const list=el('ul');for(const l of d.lines)list.append(el('li',`${l.sku} · ${l.name}: ${l.qty} ${l.unit}`));body.append(list);
 body.append(el('p',ghn?'CRM kiểm tra lại GHN khi xác nhận. Không gửi huỷ hay chuyển tiền qua GHN/ngân hàng; Sapo xử lý thủ công nếu có.':'Chỉ xử lý sổ CRM. Sapo/GHN anh xử lý thủ công.','muted small'));
 const field=(caption,node)=>{const label=el('label',caption);node.setAttribute('aria-label',caption);label.append(node);body.append(label);return node;};
 const shift=field('Ca ghi nhận hoàn tiền',el('select'));shift.required=!ghn||d.amount>0;shift.parentElement.hidden=ghn&&d.amount===0;
 let method=null;if(ghn&&d.amount>0){method=field('Cách đã hoàn tiền cho khách',el('select'));for(const [value,label]of[['transfer','Chuyển khoản'],['cash','Tiền mặt']]){const option=el('option',label);option.value=value;method.append(option);}}
 for(const s of d.shifts){const option=el('option',s.memberName+' · '+new Date(s.openedAt).toLocaleString('vi-VN'));option.value=s.id;shift.append(option);}
 const reason=field('Lý do huỷ',el('textarea'));reason.required=true;reason.maxLength=2000;
 let reference=null;if((ghn||d.method==='transfer')&&d.amount>0){reference=field('Mã giao dịch đã chuyển hoàn tiền',el('input'));reference.required=true;reference.maxLength=200;}
 if(method&&reference)method.addEventListener('change',()=>{reference.parentElement.hidden=method.value!=='transfer';reference.required=method.value==='transfer';});
 const accepted=el('input');accepted.type='checkbox';accepted.required=true;
 const check=el('label');check.append(accepted,document.createTextNode(ghn?' Tôi xác nhận huỷ đơn này'+(d.lines.length?', đã nhận lại số hàng nêu trên':'')+(d.amount>0?' và đã hoàn đúng tiền thực tế cho khách.':'.'):' Tôi xác nhận đã nhận lại đủ hàng nguyên vẹn và đã hoàn tiền thực tế cho khách.'));body.append(check);
 const error=el('p',null,'error');error.setAttribute('role','alert');body.append(error);
 const cancel=el('button','Đóng','btn secondary'),save=el('button',ghn?'Xác nhận huỷ nhanh':'Huỷ đơn · hoàn tiền · nhập kho','btn primary');cancel.type='button';save.type='submit';
 foot.append(cancel,save);form.append(head,body,foot);dialog.append(form);document.body.append(dialog);
 if((!ghn||d.amount>0)&&!d.shifts.length){save.disabled=true;error.textContent='Cần mở ca đúng quầy/két gốc để ghi nhận khoản hoàn.';}
 let busy=false;const key=crypto.randomUUID();cancel.onclick=()=>{if(!busy)dialog.close();};
 dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 form.addEventListener('submit',async e=>{e.preventDefault();if(busy||!form.reportValidity())return;
  const input={key,revision:d.revision,shiftId:shift.value,reason:reason.value.trim(),reference:method?.value==='cash'?'':reference?.value.trim()||'',confirmed:accepted.checked,...(ghn?{method:method?.value||'',shiftId:d.amount>0?shift.value:''}:{})};
  busy=true;form.inert=true;save.disabled=cancel.disabled=true;error.textContent='';
  try{await api(path,'POST',input);busy=false;dialog.close();toast(ghn?'Đã huỷ đơn, giải phóng hàng giữ và ghi kho/hoàn tiền theo xác nhận.':'Đã huỷ trong CRM, nhập lại kho và ghi hoàn tiền. Sapo/GHN xử lý thủ công.');await onChanged();}
  catch(ex){error.textContent=ex.message;}finally{busy=false;form.inert=false;save.disabled=cancel.disabled=false;}
 });
 dialog.showModal();reason.focus();
}

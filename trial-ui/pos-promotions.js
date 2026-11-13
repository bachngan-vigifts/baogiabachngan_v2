const money=n=>Number(n||0).toLocaleString('vi-VN')+' đ';
export function promotionPanel({root,program,manager,onConfigure,reason,onReason}){
 const doc=root.ownerDocument||document,el=(tag,text,cls)=>{const n=doc.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 root.replaceChildren();const head=el('div','','pos-promotion-head');head.append(el('strong','Khuyến mãi'));
 if(manager){const edit=el('button','Cấu hình','btn ghost small');edit.type='button';edit.onclick=onConfigure;head.append(edit);}root.append(head);
 if(!program){root.append(el('p','Chưa có chương trình áp dụng tại quầy này.','muted small'));return;}
 root.append(el('p',program.title),el('p',`Tiền hàng sau giảm giá và VAT trên ${money(program.threshold)} · không tính phí dịch vụ/ship. Tặng ${program.giftQty} ${program.giftUnit||''} ${program.giftName} (${program.giftSku}).`,'small'));
 root.append(el('p',!program.enabled?'Chương trình đang tắt.':!program.eligible?'Chưa đạt mức nhận quà.':program.applied?`Được tặng ${program.giftQty} ${program.giftUnit||''} · Quà 0 đ, có trừ tồn.`:'Không nhận quà · '+program.optOutReason,program.applied?'paid-text small':'muted small'));
 if(program.eligible){const label=el('label','','pos-field'),input=el('input');input.type='text';input.value=reason||'';input.maxLength=500;input.placeholder='Chỉ nhập khi khách từ chối quà (ít nhất 5 ký tự)';input.setAttribute('aria-label','Lý do không nhận quà');input.addEventListener('change',()=>onReason(input.value.trim()));label.append(el('span','Lý do không nhận quà (nếu có)'),input);root.append(label);}
}
export async function configurePromotion({api,register,document:doc=document,toast}){
 const {program}=await api('/pos/promotions?registerId='+encodeURIComponent(register.id));
 const dlg=doc.createElement('dialog');dlg.className='pos-modal pos-promotion-dialog';const form=doc.createElement('form');
 const make=(tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
 const title=make('h2','Khuyến mãi · '+register.name);const fields=make('div');fields.className='pos-promotion-fields';const controls={};
 const defaults=program||{title:'Quà tặng tại quầy',enabled:false,threshold:1000000,giftSku:'031059000B2',giftQty:1,revision:0};
 for(const [key,label,type]of [['title','Tên chương trình','text'],['enabled','Bật chương trình','checkbox'],['threshold','Tiền hàng sau VAT phải lớn hơn (đ)','number'],['giftSku','Mã SKU sản phẩm quà tặng','text'],['giftQty','Số lượng quà mỗi đơn','number']]){
  const row=make('label'),input=make('input');row.className='pos-field';input.type=type;input.name=key;input.setAttribute('aria-label',label);if(type==='checkbox')input.checked=defaults[key];else input.value=defaults[key];
  if(type==='number'){input.min=key==='giftQty'?'1':'0';input.max=key==='giftQty'?'100':'100000000000';input.step='1';}if(type!=='checkbox')input.required=true;controls[key]=input;row.append(make('span',label),input);fields.append(row);
 }
 const info=make('p','Chỉ áp dụng tại quầy đang chọn, 1 suất mỗi đơn. Đổi cấu hình không sửa quà của bill đã lưu. Mã quà phải đang hoạt động, đã duyệt; quà 0đ vẫn trừ tồn.');info.className='muted small';
 const error=make('p');error.setAttribute('role','alert');error.className='error';const footer=make('div');footer.className='pos-promotion-actions';const cancel=make('button','Hủy'),save=make('button','Lưu chương trình');cancel.type='button';cancel.className='btn secondary';save.type='submit';save.className='btn primary';footer.append(cancel,save);form.append(title,fields,info,error,footer);dlg.append(form);doc.body.append(dlg);
 return new Promise(resolve=>{dlg.addEventListener('close',()=>{dlg.remove();resolve();},{once:true});cancel.onclick=()=>dlg.close();let busy=false;
  dlg.addEventListener('cancel',e=>{if(busy)e.preventDefault();});form.onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;save.disabled=cancel.disabled=true;error.textContent='';
   try{await api('/pos/promotions/'+encodeURIComponent(register.id),'PUT',{revision:defaults.revision,title:controls.title.value.trim(),enabled:controls.enabled.checked,threshold:Number(controls.threshold.value),giftSku:controls.giftSku.value.trim(),giftQty:Number(controls.giftQty.value)});toast('Đã lưu chương trình khuyến mãi.');dlg.close();}catch(e){error.textContent=e.message;}finally{busy=false;save.disabled=cancel.disabled=false;}
  };dlg.showModal();
 });
}

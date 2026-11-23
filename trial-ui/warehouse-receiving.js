/** Operational warehouse queue: no purchase prices or commercial document links. */
export function initWarehouseReceiving({api,root}){
 const host=document.createElement('section');host.className='sup-page';root.append(host);let generation=0;
 const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
 const button=(label,fn)=>{const n=el('button',label);n.type='button';n.className='btn secondary';n.onclick=fn;return n;};
 async function load(offset=0){
  const run=++generation;host.replaceChildren(el('h1','Nhận hàng được giao'));const status=el('p','Đang tải…');host.append(status);
  try{const d=await api('/warehouse-receiving?offset='+offset);if(run!==generation)return;status.textContent=d.items.length?'Chỉ hiện hàng được nhận tại kho hoặc nhiệm vụ của bạn.':'Chưa có hàng được phân công tại kho của bạn.';
   for(const item of d.items){const card=el('section');card.className='panel';card.append(el('h2',item.warehouse),el('p',item.lines.map(l=>l.sku+' · '+l.name+' · còn '+l.missing+' '+l.unit).join('\n')));if(item.actions.includes('receive'))card.append(button('Nhận hàng',()=>open(item.id)));host.append(card);}
   if(offset)host.append(button('Trang trước',()=>load(Math.max(0,offset-20))));if(d.nextOffset!==null)host.append(button('Trang sau',()=>load(d.nextOffset)));
  }catch(e){if(run===generation)status.textContent=e.message;}
 }
 async function open(id){
  const run=generation;let d;try{d=await api('/warehouse-receiving/'+encodeURIComponent(id));}catch(e){host.append(el('p',e.message));return;}if(run!==generation)return;
  const form=el('form'),error=el('p'),day=el('input'),note=el('textarea'),photos=el('input'),sapo=el('input');
  day.type='date';day.required=true;day.value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());photos.type='file';photos.accept='image/jpeg,image/png,image/webp';photos.multiple=true;sapo.type='checkbox';sapo.checked=true;
  const label=(name,input)=>{const l=el('label',name);l.append(input);return l;};form.className='sup-form panel';form.append(el('h2','Ghi nhận hàng · '+d.warehouse),label('Ngày nhận',day),label('Ghi chú nhận hàng',note));
  const inputs=d.lines.filter(l=>l.missing>0).map(l=>{const good=el('input'),bad=el('input');for(const n of [good,bad]){n.type='number';n.min='0';n.step='0.001';n.required=true;}good.value=String(l.missing);bad.value='0';form.append(el('h3',l.sku+' · '+l.name),label('SL đạt',good),label('SL hỏng',bad));return{l,good,bad};});
  form.append(label('Ảnh hàng hỏng (1–3 ảnh nếu có)',photos),label('Tạo phiếu Sapo sau khi lưu',sapo));const save=el('button','Lưu phiếu nhận');save.type='submit';save.className='btn primary';form.append(error,button('Đóng',()=>form.remove()),save);host.append(form);
  const clientKey=crypto.randomUUID();let busy=false;
  form.onsubmit=async e=>{e.preventDefault();if(busy||run!==generation)return;busy=true;const controls=[...form.querySelectorAll('input,textarea,button')];const disabled=controls.map(n=>n.disabled);controls.forEach(n=>n.disabled=true);error.textContent='';
   try{if(photos.files.length>3)throw Error('Tối đa 3 ảnh.');const images=await Promise.all([...photos.files].map(file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);})));const result=await api('/purchase-orders/'+encodeURIComponent(id)+'/receipts','POST',{clientKey,warehouse:d.warehouse,receivedDate:day.value,note:note.value,createSapo:sapo.checked,photos:images,lines:inputs.map(({l,good,bad})=>({lineId:l.id,goodQty:Number(good.value),damagedQty:Number(bad.value),note:''}))});if(run!==generation)return;await load();host.append(el('p','Đã lưu phiếu nhận.'));}
   catch(e){error.textContent=e.message;}
   finally{busy=false;controls.forEach((n,i)=>n.disabled=disabled[i]);}
  };
 }
 return{load};
}

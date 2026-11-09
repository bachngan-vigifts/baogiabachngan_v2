/** Small, paginated ledger preview. Loaded only by the stocktake row action. */
export function openStocktakeLedger({api,sku,name,warehouseId,warehouses,isCurrent,onClose}) {
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
 const number=n=>n==null?'—':Number(n).toLocaleString('vi-VN',{maximumFractionDigits:3});
 const dlg=el('dialog');dlg.className='modal stocktake-ledger';dlg.setAttribute('aria-label','Sổ kho '+sku);
 const head=el('div'),body=el('div'),foot=el('div');head.className='modal-head';body.className='modal-body';foot.className='modal-foot';
 let closed=false,sequence=0,page=1;
 const close=()=>{if(closed)return;closed=true;sequence++;if(dlg.open)dlg.close();dlg.remove();onClose?.();};
 const button=(text,fn)=>{const b=el('button',text);b.type='button';b.className='btn secondary small';b.onclick=fn;return b;};
 const picker=el('select');picker.setAttribute('aria-label','Kho xem sổ');
 for(const w of warehouses){const o=el('option',w.name);o.value=w.id;picker.append(o);}picker.value=warehouseId;
 const title=el('h2','Sổ kho · '+sku);head.append(title,button('Đóng',close));
 const note=el('p',name),status=el('p'),content=el('div');note.className='muted small';status.setAttribute('role','status');content.className='table-wrap';
 const prev=button('‹ Trước',()=>{page--;load();}),next=button('Sau ›',()=>{page++;load();}),retry=button('Tải lại',()=>load());
 body.append(note,picker,status,content);foot.append(prev,next,retry);dlg.append(head,body,foot);document.body.append(dlg);
 dlg.addEventListener('cancel',e=>{e.preventDefault();close();});dlg.addEventListener('close',close);
 picker.onchange=()=>{page=1;load();};
 async function load(){
  const run=++sequence;status.textContent='Đang tải sổ kho…';prev.disabled=next.disabled=true;picker.disabled=retry.disabled=true;
  try{
   const d=await api('/stock-moves?'+new URLSearchParams({sku,warehouseId:picker.value,page:String(page),size:'20'}));
   if(closed||run!==sequence||!isCurrent())return;
   status.textContent=`${d.total} phát sinh · trang ${page}`;content.replaceChildren();
   if(!d.moves.length)content.append(el('p','Không có phát sinh trong kho này.'));
   else{
    const table=el('table'),thead=el('thead'),hr=el('tr'),tbody=el('tbody');table.className='data-table';
    const labels=['Thời điểm','Loại / chứng từ','Nhập','Xuất','Tồn sau','Người thực hiện'];for(const label of labels)hr.append(el('th',label));thead.append(hr);
    for(const m of d.moves){const tr=el('tr');const values=[new Date(m.at).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}),[m.kindLabel,m.refNo].filter(Boolean).join(' · '),number(m.inQty),number(m.outQty),number(m.balanceAfter),m.by||'—'];values.forEach((v,i)=>{const td=el('td',v);td.dataset.label=labels[i];tr.append(td);});tbody.append(tr);}
    table.append(thead,tbody);content.append(table);
   }
   prev.disabled=page<=1;next.disabled=page*20>=d.total;
  }catch(e){if(!closed&&run===sequence&&isCurrent()){status.textContent='Không tải được sổ kho: '+e.message;content.replaceChildren();}}
  finally{if(!closed&&run===sequence&&isCurrent())picker.disabled=retry.disabled=false;}
 }
 dlg.showModal();load();return close;
}

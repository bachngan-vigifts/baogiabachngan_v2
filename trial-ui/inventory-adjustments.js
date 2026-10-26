const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const number=n=>Number(n||0).toLocaleString('vi-VN',{maximumFractionDigits:3});
const when=s=>s?new Date(s).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—';
const states={pending:'Chờ Manager duyệt',approved:'Đã duyệt · đã ghi kho',rejected:'Đã từ chối'};
const btn=(text,fn,cls='btn secondary small')=>{const b=el('button',cls,text);b.type='button';b.onclick=fn;return b;};
export function initAdjustmentQueue({api,host,toast,onChanged}){
 let config=null,sequence=0,offset=0,next=null,deepOpened='';
 const head=el('div','card-title-row'),filter=el('select'),list=el('div','inv-adjust-queue'),feedback=el('p','small muted'),error=el('p','error');
 filter.setAttribute('aria-label','Trạng thái phiếu điều chỉnh');for(const [value,text] of [['pending','Chờ duyệt'],['approved','Đã duyệt'],['rejected','Từ chối'],['','Tất cả phiếu']])filter.append(Object.assign(el('option','',text),{value}));
 head.append(el('h2','card-title','Phiếu điều chỉnh kho'),filter,btn('Làm mới phiếu',()=>load(config)));
 const pager=el('div','row-gap'),prev=btn('‹ Trang trước',()=>{offset=Math.max(0,offset-20);load(config);}),more=btn('Trang tiếp ›',()=>{if(next!==null){offset=next;load(config);}});pager.append(prev,more);host.append(head,feedback,error,list,pager);
 filter.onchange=()=>{offset=0;load(config);};
 async function load(value){
  if(!value)return;config=value;const mine=++sequence;error.textContent='';prev.disabled=more.disabled=true;feedback.textContent='Đang tải phiếu điều chỉnh…';
  try{const p=new URLSearchParams({status:filter.value,offset:String(offset)}),data=await api('/inventory/adjustments?'+p);if(mine!==sequence)return;
   next=data.nextOffset;list.replaceChildren();
   for(const r of data.adjustments){const row=el('article','inv-adjust-queue-row'),text=el('div');text.append(el('b','',r.refNo+' · '+states[r.status]),el('p','small muted',`${r.warehouseName} · ${r.createdByName} · ${when(r.createdAt)} · ${r.lines.length} mã`),el('p','small',r.reason));row.append(text,btn('Xem phiếu '+r.refNo,()=>open(r.id)));list.append(row);}
   feedback.textContent=data.adjustments.length?`Phiếu ${offset+1}–${offset+data.adjustments.length}`:'Không có phiếu trong trạng thái này.';prev.disabled=!offset;more.disabled=next===null;
   const id=new URLSearchParams(location.hash.split('?')[1]||'').get('adjustment');if(id&&id!==deepOpened){deepOpened=id;await open(id);}
  }catch(e){if(mine===sequence){error.textContent=e.message;feedback.textContent='Chưa tải được danh sách phiếu.';}}
 }
 async function open(id){
  let data;try{data=await api('/inventory/adjustments/'+encodeURIComponent(id));}catch(e){toast(e.message,'err');return;}
  const r=data.adjustment,dialog=el('dialog','modal inv-adjust-review'),head=el('div','modal-head'),body=el('div','modal-body'),foot=el('div','modal-foot');
  let busy=false;const close=()=>{if(!busy)dialog.close();};head.append(el('h2','',r.refNo),btn('Đóng',close));
  body.append(el('p','',states[r.status]),el('p','muted small',`${r.warehouseName} · Người lập: ${r.createdByName} · ${when(r.createdAt)}`),el('p','',r.reason));
  if(r.reviewedAt)body.append(el('p','small',`Xử lý bởi ${r.reviewedByName} · ${when(r.reviewedAt)}${r.reviewNote?' · '+r.reviewNote:''}`));
  const table=el('table','data-table'),thead=el('thead'),tr=el('tr'),tbody=el('tbody');for(const text of ['Mã hàng','Tồn lúc mở','Điều chỉnh','Sau điều chỉnh'])tr.append(el('th','',text));thead.append(tr);
  for(const l of r.lines){const row=el('tr'),before=data.balances[l.sku]||0;for(const value of [l.sku,number(before),(l.qty>0?'+':'')+number(l.qty),r.status==='pending'?number(before+l.qty):'Đã xử lý'])row.append(el('td','',value));tbody.append(row);}
  table.append(thead,tbody);const wrap=el('div','table-wrap');wrap.append(table);body.append(wrap);
  if(r.status==='pending')body.append(el('p','muted small','Phiếu chờ duyệt chưa làm thay đổi tồn. Chỉ Manager duyệt mới ghi tăng/giảm vào sổ kho.'));
  const error=el('p','error');error.setAttribute('role','alert');body.append(error);
  if(r.status==='pending'&&data.canApprove){
   const note=el('textarea');note.maxLength=500;note.placeholder='Ghi chú duyệt / lý do từ chối';note.setAttribute('aria-label','Ghi chú xét duyệt');body.append(note);
   const review=async decision=>{if(busy)return;if(decision==='rejected'&&note.value.trim().length<3){error.textContent='Nhập lý do từ chối.';return;}busy=true;error.textContent='';approve.disabled=reject.disabled=true;
    try{await api('/inventory/adjustments/'+encodeURIComponent(id)+'/review','POST',{decision,note:note.value.trim()});busy=false;dialog.close();toast(decision==='approved'?'Đã duyệt và ghi tồn kho.':'Đã từ chối phiếu, không đổi tồn.');await onChanged();}
    catch(e){error.textContent=e.message;busy=false;approve.disabled=reject.disabled=false;}
   };
   const approve=btn('Duyệt và ghi kho',()=>review('approved'),'btn primary'),reject=btn('Từ chối phiếu',()=>review('rejected'));approve.dataset.mobilePrimary='';foot.append(reject,approve);
  }
  foot.append(btn('Đóng',close));dialog.append(head,body,foot);document.body.append(dialog);dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();
 }
 return {load,open};
}

import {esc,money} from './core.js';
const label=p=>p.priceOnRequest?'Liên hệ':money(p.regular);
/** Explicit account-scoped review queue. Never rewrites quotation snapshots. */
export function createLibraryPriceReview({api,identity,getMember,getPending,putPending,refresh,toast}){
 let account='',session='',items=[],busy=false,notify=()=>{},dialog=null;
 const same=(owner=account,who=session)=>session===who&&who===identity()&&account===owner&&owner===getMember();
 function close(){dialog?.close();dialog?.remove();dialog=null;}
 function reset(){close();account='';session='';items=[];busy=false;}
 async function load(member){
  if(account===member&&session===identity())return;
  const who=identity(),saved=await getPending(member);
  if(who!==identity()||member!==getMember()||(account===member&&session===who))return;
  account=member;session=who;items=Array.isArray(saved)?saved.filter(x=>/^[a-f0-9]{64}$/.test(x?.id)&&x.product&&x.incoming):[];
 }
 async function record(rows){
  if(!same())return;let next=[...items];
  for(const row of rows){if(!row.priceConflict)continue;const value={id:row.id,revision:row.revision,product:row.product,incoming:row.priceConflict.incoming,clientKey:crypto.randomUUID()};next=next.filter(x=>x.id!==row.id);next.push(value);}
  if(JSON.stringify(next)===JSON.stringify(items))return;
  const owner=account,who=session;await putPending(owner,next);if(same(owner,who)){items=next;notify();}
 }
 async function remove(id){const next=items.filter(x=>x.id!==id),owner=account,who=session;await putPending(owner,next);if(same(owner,who))items=next;}
 function html(){return items.length?`<div class="library-price-conflicts" role="status"><strong>${items.length} sản phẩm có giá dữ liệu nhập khác thư viện.</strong> Giá thư viện chưa bị thay đổi. <button class="btn small" data-price-review>Đối chiếu giá</button></div>`:'';}
 function open(id=items[0]?.id){
  close();if(!same())return;const item=items.find(x=>x.id===id);if(!item)return;
  dialog=document.createElement('dialog');dialog.className='shared-library-dialog';dialog.setAttribute('aria-label','Đối chiếu giá dữ liệu nhập');
  dialog.innerHTML=`<form><div class="modal-head"><h2>Đối chiếu giá dữ liệu nhập</h2><button type="button" class="btn" data-close>Đóng</button></div><div class="modal-body shared-edit"><label>Sản phẩm<select class="input" data-item>${items.map(x=>`<option value="${esc(x.id)}" ${x.id===id?'selected':''}>${esc(x.product.name)}</option>`).join('')}</select></label><p>${esc(item.product.sku||'Không có mã')}</p><p>Giá thư viện đang lưu: <b>${esc(label(item.product))}</b></p><p>Giá của dữ liệu vừa nhập: <b>${esc(label(item.incoming))}</b></p><p>Chỉ cập nhật giá niêm yết / trạng thái Liên hệ của thư viện sau khi xác nhận. Báo giá đang chọn và báo giá đã lưu giữ nguyên. Dữ liệu nhập không tự được coi là giá mới nhất từ website.</p><p class="error" role="alert"></p></div><div class="modal-foot"><button class="btn" type="button" data-keep>Giữ giá thư viện</button><button class="btn" type="button" data-reload>Đọc lại để đối chiếu</button><button class="btn primary" type="submit">Xác nhận cập nhật giá thư viện</button></div></form>`;
  const current=dialog,form=current.querySelector('form'),err=current.querySelector('.error'),owner=account,who=session,isCurrent=()=>same(owner,who);
  const run=async fn=>{if(busy||!isCurrent())return;busy=true;for(const b of form.querySelectorAll('button,select'))b.disabled=true;err.textContent='';try{await fn();}catch(e){if(isCurrent()&&dialog===current)err.textContent=e.message;}finally{if(isCurrent())busy=false;if(dialog===current)for(const b of form.querySelectorAll('button,select'))b.disabled=false;}};
  current.querySelector('[data-close]').onclick=()=>{if(!busy)close();};current.addEventListener('cancel',e=>{if(busy)e.preventDefault();else close();});
  current.querySelector('[data-item]').onchange=e=>open(e.target.value);
  current.querySelector('[data-keep]').onclick=()=>run(async()=>{await remove(id);if(isCurrent()&&dialog===current){close();notify();open();}});
  current.querySelector('[data-reload]').onclick=()=>run(async()=>{
   const row=await api('api/library?id='+encodeURIComponent(id));if(!isCurrent())return;
   const differs=row.product.priceOnRequest!==item.incoming.priceOnRequest||(!item.incoming.priceOnRequest&&row.product.regular!==item.incoming.regular);
   if(differs)await record([{...row,priceConflict:{incoming:item.incoming}}]);else await remove(id);
   if(isCurrent()&&dialog===current){close();notify();open(id);}
  });
  form.onsubmit=e=>{e.preventDefault();run(async()=>{
   const product={...item.product,...item.incoming};if(product.priceOnRequest)product.override=null;
   await api('api/library?id='+encodeURIComponent(id),'PUT',{revision:item.revision,clientKey:item.clientKey,product});
   if(!isCurrent())return;await remove(id);if(!isCurrent())return;const visible=dialog===current;if(visible)close();await refresh();if(visible&&isCurrent()){notify();toast('Đã cập nhật giá thư viện. Báo giá đã lưu giữ nguyên.');open();}
  });};document.body.append(current);current.showModal();
 }
 return{load,record,html,reset,close,mount:redraw=>{notify=redraw;},click:e=>{if(!e.target.closest('[data-price-review]'))return false;open();return true;}};
}

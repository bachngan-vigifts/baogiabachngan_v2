import {createLibraryBulk} from './library-bulk.js';
import{esc,money}from'./core.js';
import{imageSource}from'./render.js';
const keys=['brand','category','collection','pattern','color'];
const labels={brand:'Thương hiệu',category:'Danh mục',collection:'Bộ sưu tập',pattern:'Hoa văn',color:'Màu sắc'};
const q=n=>Number(n).toLocaleString('vi-VN',{maximumFractionDigits:3});
const factsOf=p=>({name:p.name,sku:p.sku||'',brand:p.brand,category:p.category,collection:p.collection||'',pattern:p.pattern||'',color:p.color||'',unit:p.unit||'',url:p.url||'',image:p.image||'',regular:Number(p.regular),priceOnRequest:!!p.priceOnRequest,fromPrice:!!p.fromPrice,createdAt:p.createdAt||null,createdAtSource:p.createdAtSource||null});
export function createSharedLibrary({api,identity,getProducts,getSelected,priceOf,onPick,onPickMany,onPublished,pin,pending,savePending,removePending,getBulkPending,putBulkPending,toast}){
 let root=null,data=null,error='',loading=false,run=0,offset=0,query='',filters=Object.fromEntries(keys.map(k=>[k,''])),session='',member='',publishing=false,publishTimer,searchTimer,loadedAt=0,archived=false,inFlight=null,stockRun=0;
 const facetCache=new Map();
 const dialog=document.createElement('dialog');dialog.className='shared-library-dialog';document.body.append(dialog);
 const bulk=createLibraryBulk({api,identity,getMember:()=>member,getRows:()=>[...(data?.products||[]),...localRows()],isArchived:()=>archived,onAdd:onPickMany,refresh:()=>{facetCache.clear();return load(true);},getPending:getBulkPending,putPending:putBulkPending,toast});
 function reset(){bulk.reset();run++;stockRun=0;facetCache.clear();inFlight=null;data=null;error='';member='';loadedAt=0;session=identity();dialog.close();}
 function check(){if(identity()!==session)reset();return!!session;}
 function localRows(){if(archived)return[];const selected=new Set(getSelected());return getProducts().filter(p=>!p.sharedId&&(!p.sharedPendingFor||!member||p.sharedPendingFor===member)).filter(p=>keys.every(k=>!filters[k]||p[k]===filters[k])).filter(p=>[p.name,p.sku,p.category,p.collection,p.pattern,p.color].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase().includes(query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase())).map(p=>({id:'local:'+p.id,localId:p.id,revision:0,product:p,selected:selected.has(p.id)}));}
 function chosen(row){return row.localId?getSelected().includes(row.localId):getProducts().some(p=>p.sharedId===row.id&&getSelected().includes(p.id));}
 function stockHtml(sku){
  const f=data?.stock?.find(s=>s.sku===sku);if(!f)return`<div class="library-stock unknown">${data?.stockLoading?'Đang cập nhật tồn CRM…':esc(data?.stockError||'Chưa có dữ liệu tồn CRM cho mã này.')}</div>`;
  const available=f.available===null?'Chưa có dữ liệu':q(f.available),incoming=f.incoming===null?'Chưa có dữ liệu':q(f.incoming.qty),supplier=f.supplier===null?'Chưa có dữ liệu':q(f.supplier.qty);
  return `<div class="library-stock"><b class="${f.available>0?'in-stock':f.available===0?'zero-stock':'unknown'}">Có thể bán: ${available} ${esc(f.unit||'')}</b><span>Đang về: ${incoming}</span><span>Nguồn NCC: ${supplier}</span><small>Đọc lúc ${esc(new Date(f.checkedAt).toLocaleString('vi-VN'))}</small><details><summary>Kho và nguồn hàng</summary>${f.reason?`<p>${esc(f.reason)}</p>`:''}<p>Đã giữ trên CRM: ${f.heldTotal===null||f.heldTotal===undefined?'Chưa có dữ liệu':q(f.heldTotal)}. Tổng có thể bán đã trừ giữ hàng; khả dụng từng kho được xét riêng.</p>${f.warehouses.map(w=>`<p><b>${esc(w.name)}</b> (${w.source==='ledger'?'sổ kho CRM':'Sapo'}): tồn ${w.onHand===null?'?':q(w.onHand)} · giữ ${w.held===null?'?':q(w.held)} · có thể bán ${w.available===null?'?':q(w.available)}${w.updatedAt?`<br><small>Cập nhật tồn ${esc(new Date(w.updatedAt).toLocaleString('vi-VN'))}</small>`:''}</p>`).join('')}${f.incoming?.orders.map(o=>`<p>Đang về ${q(o.qty)} · ${esc(o.orderNo)} · ${esc(o.supplierName)} · ${o.arrivalDate?esc(o.arrivalDate):'Chưa có ngày hẹn'}</p>`).join('')||''}${f.supplier?.warehouses.map(w=>`<p>NCC ${esc(w.name)}: ${q(w.qty)}${w.updatedAt?` · ${esc(new Date(w.updatedAt).toLocaleString('vi-VN'))}`:''}</p>`).join('')||''}</details></div>`;
 }
 function draw(){
  if(!root?.isConnected)return;const focused=root.querySelector('#library-search')===document.activeElement,position=focused?document.activeElement.selectionStart:0;const local=localRows(),rows=[...(data?.products||[]),...local],total=data?.total||0;
  root.innerHTML=`<div class="page-head"><div><div class="eyebrow">THƯ VIỆN DÙNG CHUNG</div><h1>Sản phẩm cho mọi báo giá.</h1><p>Nhân viên cùng xem, thêm và sửa. Tồn được đọc theo quyền CRM của người đang đăng nhập.</p></div><button class="btn" data-lib="refresh" ${loading?'disabled':''}>${loading?'Đang tải…':'Làm mới'}</button></div><div class="library-shared-status" role="status">${error?esc(error):publishing?'Đang lưu sản phẩm dùng chung…':member?'Đã kết nối thư viện chung.':'Đăng nhập CRM để dùng thư viện chung.'}${local.length?` · ${local.length} sản phẩm trên máy đang chờ chia sẻ.`:''}${loadedAt?` · Đọc lúc ${esc(new Date(loadedAt).toLocaleTimeString('vi-VN'))}`:''}</div><div class="filterbar shared-filters"><label class="search"><span>Tìm tên, SKU, thuộc tính</span><input class="input" id="library-search" type="search" value="${esc(query)}" placeholder="Tìm không dấu…" maxlength="100"></label>${keys.map(k=>`<label>${labels[k]}<select class="input" data-lib-filter="${k}" aria-label="Lọc ${labels[k].toLowerCase()}"><option value="">Tất cả</option>${[...new Set([...(filters[k]?[filters[k]]:[]),...(data?.facets?.[k]||[]),...getProducts().filter(p=>!p.sharedId&&(!p.sharedPendingFor||!member||p.sharedPendingFor===member)&&keys.slice(0,keys.indexOf(k)).every(parent=>!filters[parent]||p[parent]===filters[parent])).map(p=>p[k]).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,'vi',{numeric:true})).map(v=>`<option value="${esc(v)}" ${filters[k]===v?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`).join('')}<button class="btn small" data-lib="reset">Xoá lọc</button><label class="library-archive-toggle"><input type="checkbox" data-lib-archived ${archived?'checked':''}>Đã xoá</label></div><p class="hint">${total} sản phẩm chung${local.length?' · thêm '+local.length+' sản phẩm trên máy':''}. Giá chào theo thiết lập báo giá hiện tại. Hàng đang về/NCC chưa tính vào có thể bán.</p>${bulk.toolbar(rows)}<div class="library-grid">${rows.map(row=>{const p=row.product,selected=chosen(row);return`<article class="product-card ${selected?'chosen':''}" data-library-id="${esc(row.id)}">${bulk.card(row)}<button type="button" class="library-picture" ${bulk.busy?'disabled':''} data-lib="mark" data-id="${esc(row.id)}" aria-label="Tick ${esc(p.name)}" aria-pressed="${bulk.selected.has(row.id)}">${p.image?`<img class="card-image" src="${esc(imageSource(p.image))}" alt="${esc(p.name)}" loading="lazy">`:'<div class="card-image library-no-photo">Chưa có ảnh</div>'}</button><div class="card-body"><div class="card-kicker">${esc(p.brand)} / ${esc(p.category)}</div><div class="card-name">${esc(p.name)}</div><small>${[p.collection,p.pattern,p.color].filter(Boolean).map(esc).join(' · ')}</small><div class="card-price">${p.priceOnRequest?'Liên hệ':money(priceOf(p,row))}</div><p class="hint">${esc(p.sku||'Chưa có SKU')} · ${row.localId?'Chỉ trên máy – chờ chia sẻ':'Dùng chung · phiên bản '+row.revision}</p>${archived?'<p class="hint">Đã xoá khỏi thư viện chung</p>':`<div data-stock-sku="${esc(p.sku||'')}">${stockHtml(p.sku)}</div>`}<div class="card-bottom">${!archived?`<button class="btn small" data-lib="pick" data-id="${esc(row.id)}">${selected?'Đã chọn':'Chọn báo giá'}</button>`:''}${!row.localId&&!archived?`<button class="btn small" data-lib="edit" data-id="${esc(row.id)}" aria-label="Sửa thư viện chung: ${esc(p.name)}">Sửa chung</button>`:''}</div></div></article>`}).join('')}</div>${!rows.length?`<div class="full-empty"><h2>${loading?'Đang đọc thư viện…':'Chưa có sản phẩm phù hợp.'}</h2><p>Thêm sản phẩm hoặc đổi bộ lọc. Sản phẩm đã lưu trên máy vẫn được giữ.</p></div>`:''}<div class="library-pagination"><button class="btn" data-lib="prev" ${offset===0||loading?'disabled':''}>Trang trước</button><span>${total?offset+1:0}–${Math.min(offset+60,total)} / ${total}</span><button class="btn" data-lib="next" ${offset+60>=total||loading?'disabled':''}>Trang sau</button></div>`;
  const marks=rows.filter(r=>bulk.selected.has(r.id)).length,all=root.querySelector('[data-lib-all]');if(all)all.indeterminate=marks>0&&marks<rows.length;
  if(focused){const field=root.querySelector('#library-search');field.focus();field.setSelectionRange(position,position);}
 }
 function drawStock(){if(!root?.isConnected)return;for(const el of root.querySelectorAll('[data-stock-sku]'))el.innerHTML=stockHtml(el.dataset.stockSku);}
 async function loadStock(seq=run){
  if(!root?.isConnected||archived||!data||data.stock!==null||stockRun===seq)return;
  const current=data,who=session,skus=[...new Set(current.products.map(r=>r.product.sku).filter(Boolean))];stockRun=seq;current.stockLoading=true;drawStock();
  try{const result=skus.length?await api('api/library-stock?'+new URLSearchParams({skus:skus.join(',')})):{stock:[]};if(seq!==run||who!==identity()||data!==current)return;current.stock=result.stock;current.stockError='';}
  catch{if(seq!==run||who!==identity()||data!==current)return;current.stockError='Chưa đọc được tồn CRM. Bấm Làm mới để thử lại.';}
  finally{if(seq===run&&who===identity()&&data===current){current.stockLoading=false;drawStock();}}
 }
 async function load(force=false){
  if(!check()){error='Đăng nhập CRM để đọc thư viện/tồn và chia sẻ sản phẩm. Dữ liệu trên máy vẫn được giữ.';draw();return;}
  const visibility=archived?'1':'0',p=new URLSearchParams({q:query,offset:String(offset),limit:'60',archived:visibility,...filters}),key=p.toString(),who=session,facetKey=JSON.stringify([visibility,...keys.slice(0,-1).map(k=>filters[k])]);
  if(inFlight?.key===key&&inFlight.who===who)return inFlight.task;
  if(!force&&data&&Date.now()-loadedAt<15000){draw();loadStock();return;}
  const seq=++run;loading=true;error='';if(data)data={...data,facets:facetCache.get(facetKey)||{}};draw();p.set('includeStock','0');p.set('facets',facetCache.has(facetKey)?'0':'1');
  const task=(async()=>{try{
   const next=await api('api/library?'+p);if(seq!==run)return;if(who!==identity()){reset();draw();return;}
   if(next.facets){facetCache.set(facetKey,next.facets);if(facetCache.size>20)facetCache.delete(facetCache.keys().next().value);}
   data={...next,facets:next.facets||facetCache.get(facetKey)||{},stock:archived?[]:null,stockLoading:!archived};member=next.memberId;loadedAt=Date.now();error='';loading=false;draw();loadStock(seq);
   await bulk.loadPending(member);
  }catch(e){if(seq!==run)return;if(who!==identity()){reset();draw();return;}error=e.message;}
  finally{if(seq===run){loading=false;inFlight=null;draw();}}})();
  inFlight={key,who,task};return task;
 }
 async function publish(){
  if(publishing||!check())return;if(!member){await load();if(!member)return;}
  const owner=member,who=session;const same=()=>{if(who===identity())return true;if(session===who){reset();draw();}return false;};publishing=true;draw();
  try{
   let jobs=await pending(owner);const queued=new Set(jobs.map(j=>j.clientId));const candidates=getProducts().filter(p=>!p.sharedId&&(!p.sharedPendingFor||p.sharedPendingFor===owner));
   if(!candidates.length&&!jobs.length)return;
   for(const p of candidates){if(queued.has(p.id))continue;pin(p.id,owner);await savePending(owner,p.id,{clientId:p.id,product:factsOf(p)});}
   jobs=await pending(owner);let failures=[];for(let i=0;i<jobs.length;i+=25){
    if(!same())return;const candidates=jobs.slice(i,i+25),batch=[];
    for(const j of candidates){try{if(j.product.image?.startsWith('data:')){const r=await api('api/library-image','POST',{image:j.product.image});if(!same())return;j.product.image=r.imageUrl;await savePending(owner,j.clientId,j);}batch.push(j);}catch(e){failures.push(e.message);}}if(!batch.length)continue;
    const result=await api('api/library','POST',{products:batch});if(!same())return;failures.push(...(result.errors||[]).map(e=>e.error));
    for(const row of result.products){onPublished(row);await removePending(owner,row.clientId);}
   }
   data=null;loadedAt=0;facetCache.clear();if(root?.isConnected)await load(true);error=failures.length?failures.length+' sản phẩm chưa chia sẻ: '+failures[0]:'';
  }catch(e){if(who===identity())error='Chưa lưu dùng chung: '+e.message+' Sản phẩm vẫn trên máy; bấm Làm mới để thử lại.';}
  finally{publishing=false;draw();if(member&&session===identity()&&getProducts().some(p=>!p.sharedId&&!p.sharedPendingFor))schedulePublish();}
 }
 function schedulePublish(){clearTimeout(publishTimer);publishTimer=setTimeout(()=>publish(),500);}
 function edit(row){
  if(!check())return;const owner=session,p=row.product,command=crypto.randomUUID();
  const field=(key,label,type='text')=>`<label>${label}<input class="input" name="${key}" type="${type}" value="${esc(p[key]??'')}" ${['name','category'].includes(key)?'required':''} ${type==='number'?'min="0" max="10000000000" step="1"':''} maxlength="${key==='image'?2500:key==='name'?220:100}"></label>`;
  dialog.innerHTML=`<form><div class="modal-head"><div><h2>Sửa sản phẩm dùng chung</h2><p>Phiên bản ${row.revision} · thay đổi áp dụng cho thư viện mọi nhân viên.</p></div><button type="button" class="btn" data-close>Đóng</button></div><div class="modal-body shared-edit"><p>${esc(p.brand)} · ${esc(p.sku)}<br>${esc(p.url)}<br>Báo giá đã chọn giữ bản sao riêng.</p>${field('name','Tên sản phẩm')}${field('category','Danh mục')}${field('collection','Bộ sưu tập')}${field('pattern','Hoa văn')}${field('color','Màu sắc')}<label class="switch-row">Giá Liên hệ<input type="checkbox" name="contactPrice" ${p.priceOnRequest?'checked':''}></label>${field('regular','Giá niêm yết','number')}${field('image','Link ảnh HTTPS')}<p class="error" role="alert"></p></div><div class="modal-foot"><button class="btn" type="button" data-close>Huỷ</button><button type="submit" class="btn primary">Lưu dùng chung</button></div></form>`;
  const form=dialog.querySelector('form');const syncPrice=()=>{if(!form.elements.contactPrice)return;form.elements.regular.disabled=form.elements.contactPrice.checked;form.elements.regular.required=!form.elements.contactPrice.checked;};syncPrice();form.onchange=syncPrice;for(const b of dialog.querySelectorAll('[data-close]'))b.onclick=()=>dialog.close();let sending=false;
  form.onsubmit=async event=>{event.preventDefault();if(sending)return;if(owner!==identity()){form.querySelector('.error').textContent='Tài khoản đã đổi. Đóng và mở lại sản phẩm.';return;}
   const product={...p};for(const [k,value]of new FormData(form))if(k!=='contactPrice')product[k]=k==='regular'?Number(value):String(value).trim();product.priceOnRequest=form.elements.contactPrice.checked;if(product.priceOnRequest){product.regular=0;product.fromPrice=false;}
   sending=true;const button=form.querySelector('[type="submit"]');button.disabled=true;button.textContent='Đang lưu…';
   try{await api('api/library?id='+row.id,'PUT',{revision:row.revision,clientKey:command,product});if(owner!==identity())return;dialog.close();toast('Đã lưu sản phẩm dùng chung.');facetCache.clear();await load(true);}catch(e){form.querySelector('.error').textContent=e.message;}finally{sending=false;button.disabled=false;button.textContent='Lưu dùng chung';}
  };dialog.showModal();
 }
 function mount(node){root=node;bulk.mount(node,draw);check();draw();load();schedulePublish();}
 function action(event){const before=session;if(!check()||session!==before){draw();load(true);return;}if(bulk.click(event))return;const b=event.target.closest('[data-lib]');if(!b||b.disabled)return;const a=b.dataset.lib;
  if(a==='refresh'){facetCache.clear();load(true).then(()=>publish());return;}if(a==='reset'){query='';offset=0;filters=Object.fromEntries(keys.map(k=>[k,'']));load(true);return;}
  if(a==='prev'||a==='next'){offset=Math.max(0,offset+(a==='next'?60:-60));load(true);return;}
  const row=[...(data?.products||[]),...localRows()].find(r=>r.id===b.dataset.id);if(!row)return;
  if(a==='mark'){bulk.mark(row,!bulk.selected.has(row.id));return;}if(a==='pick'){onPick(row);draw();}else if(a==='edit')edit(row);
 }
 document.addEventListener('click',event=>{if(root?.contains(event.target))action(event);});
 document.addEventListener('input',event=>{if(!root?.contains(event.target)||event.target.id!=='library-search')return;query=event.target.value;offset=0;clearTimeout(searchTimer);searchTimer=setTimeout(()=>load(true),250);});
 document.addEventListener('change',event=>{if(root?.contains(event.target)){if(bulk.change(event))return;if(event.target.matches('[data-lib-archived]')){archived=event.target.checked;bulk.selected.clear();offset=0;load(true);return;}}const key=event.target.dataset.libFilter;if(root?.contains(event.target)&&keys.includes(key)){filters[key]=event.target.value;for(const downstream of keys.slice(keys.indexOf(key)+1))filters[downstream]='';offset=0;load(true);}});
 window.addEventListener('storage',event=>{if(event.key==='bn-v2-session'){reset();if(root?.isConnected)load(true).then(()=>publish());}});
 window.addEventListener('focus',()=>{if(identity()!==session){reset();if(root?.isConnected)load(true).then(()=>publish());}else if(root?.isConnected)load();});
 setInterval(()=>{if(root?.isConnected&&!document.hidden&&!loading&&!publishing&&Date.now()-loadedAt>30000)load(true);},30000);
 return{mount,schedulePublish,bootstrap:()=>load().then(()=>publish()),refresh:()=>load(true),getStatus:()=>({member,error,publishing}),unmount:()=>{root=null;}};
}

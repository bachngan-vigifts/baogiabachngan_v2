const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number(v).toLocaleString('vi-VN',{maximumFractionDigits:0})+' đ';
const time=s=>s?new Date(s).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Chưa có mốc cập nhật';
const defaults=()=>({priceBasis:'list',stockType:'physical',warehouseId:'',supplierId:'',confirmation:'all',due:'all'});
const isPurchase=f=>['incoming','ordered'].includes(f.stockType);
const groupNames={physical:'Tồn tại kho',incoming:'Hàng đang về (đã duyệt)',ordered:'Đặt NCC chờ duyệt',supplier:'Tồn NCC'};
const sources={ledger:'Sổ kho CRM',sapo:'Đồng bộ Sapo',purchase:'Đơn đặt NCC',supplier:'Số liệu tồn NCC'};
export function renderHomeStockValue(data){
 const f=data.filters||defaults(),list=f.priceBasis==='list',purchasing=isPurchase(f),missing=list?'giá niêm yết':'giá nhập';
 const partial=data.missingSkus>0||data.unknownWarehouses>0;
 const total=data.inventory.length?(!data.inventory.some(w=>w.hasStockData)?'Chưa có dữ liệu':data.pricedRows||!data.missingSkus?money(data.totalValue):`Chưa đủ ${missing}`):(purchasing?money(0):'—');
 const priceLabel=list?`Giá niêm yết${data.pricePolicy?' · '+data.pricePolicy.name:''}`:purchasing?(f.stockType==='ordered'?'Giá nhập dự kiến · chưa duyệt':'Giá nhập theo đơn NCC'):'Ước tính theo giá nhập';
 const stockNote=f.stockType==='physical'?'Chỉ tồn dương tại kho. Hàng đang giữ vẫn thuộc tồn kho; tồn âm báo riêng.':f.stockType==='supplier'?'Chỉ số liệu tồn tại NCC, không phải tồn thực tại kho công ty.':f.stockType==='incoming'?'Đơn NCC đã duyệt: còn thiếu = số đặt − đã nhận đạt từ phiếu chưa huỷ. Không phải tồn thực tại kho.':'Chỉ đơn đã gửi chờ duyệt; không gồm nháp chưa gửi, đơn đã duyệt hoặc đã huỷ.';
 const priceNote=list?'Tính theo giá bán lẻ niêm yết đang lưu, giữ nguyên cơ sở VAT của bảng giá, chưa trừ chiết khấu.':purchasing?'Giá dòng đơn sau chiết khấu và phí in, trước VAT; thiếu giá thì dùng giá tham chiếu phù hợp đơn vị.':'Tồn dương × giá nhập gần nhất; thiếu giá nhập thì tham chiếu đơn NCC đã duyệt hoặc công thức mua NCC.';
 return `<div class="home-stock-summary"><div><strong>${esc(groupNames[f.stockType])}</strong><small class="muted">${esc(priceLabel)} · ${esc(time(data.asOf))}</small></div><div class="home-stock-total"><small>${partial?'Giá trị đã xác định':'Tổng theo bộ lọc'}</small><strong>${total}</strong></div></div>
 ${list&&!data.pricePolicy?'<p class="home-stock-warning" role="status">Chưa có bảng giá bán lẻ niêm yết phù hợp; không dùng giá sỉ thay thế.</p>':''}
 <div class="home-stock-grid">${data.inventory.length?data.inventory.map(w=>`<article class="home-stock-card"><h3>${esc(w.name)}</h3><strong>${!w.hasStockData||(!w.pricedSkus&&w.missingSkus)?'—':money(w.value)}</strong><small>${esc(sources[w.source]||'Số liệu tồn')} · ${esc(time(w.updatedAt))}</small>${!w.hasStockData?'<p class="home-stock-warning">Chưa có dữ liệu tồn.</p>':w.missingSkus?`<p class="home-stock-warning">${w.missingSkus} mã thiếu ${missing} hoặc khác đơn vị; chưa tính phần này.</p>`:''}${w.referenceValue?`<small>Gồm ${money(w.referenceValue)} theo giá tham chiếu.</small>`:''}${w.negativeSkus?`<p class="home-stock-warning">${w.negativeSkus} mã tồn âm cần đối soát.</p>`:''}</article>`).join(''):'<p class="muted">Không có hàng phù hợp với bộ lọc.</p>'}</div>
 <p class="home-stock-note">${esc(stockNote)} ${esc(priceNote)} Các nhóm hàng được xem riêng, không cộng trùng vào tổng tồn kho.</p><button type="button" class="link-btn" data-stock-refresh data-mobile-inline>Làm mới giá trị tồn</button>`;
}
const selectOptions=(items,value,all)=>`<option value="">${all}</option>`+items.map(w=>`<option value="${esc(w.id)}"${w.id===value?' selected':''}>${esc(w.name)}</option>`).join('');
export function initHomeStockValue({root,api,identity}){
 let active=true,sequence=0,filters=defaults();
 root.innerHTML=`<h2 id="home-stock-title">Giá trị tồn kho</h2><div class="home-stock-filters"><label>Định giá<select data-stock-filter="priceBasis"><option value="list">Giá niêm yết</option><option value="purchase">Giá nhập</option></select></label><label>Nhóm hàng<select data-stock-filter="stockType">${Object.entries(groupNames).map(([id,name])=>`<option value="${id}">${name}</option>`).join('')}</select></label></div>
 <details class="home-stock-details"><summary>Bộ lọc chi tiết</summary><div class="home-stock-filters"><label>Kho<select data-stock-filter="warehouseId"><option value="">Tất cả kho</option></select></label><label data-stock-purchasing hidden>Nhà cung cấp<select data-stock-filter="supplierId"><option value="">Tất cả NCC</option></select></label><label data-stock-purchasing hidden>Xác nhận NCC<select data-stock-filter="confirmation"><option value="all">Tất cả</option><option value="pending">Chưa xác nhận</option><option value="confirmed">Đã xác nhận</option></select></label><label data-stock-purchasing hidden>Hạn giao<select data-stock-filter="due"><option value="all">Tất cả</option><option value="late">Quá hẹn</option><option value="week">Trong 7 ngày tới</option></select></label></div><button type="button" class="link-btn" data-stock-reset data-mobile-inline>Xoá bộ lọc chi tiết</button></details><div data-stock-results><p class="muted" role="status">Đang tải giá trị các kho…</p></div>`;
 const results=root.querySelector('[data-stock-results]');
 function controls(data){
  for(const el of root.querySelectorAll('[data-stock-filter]')){
   const key=el.dataset.stockFilter;
   if(data&&['warehouseId','supplierId'].includes(key))el.innerHTML=selectOptions(data.options?.[key==='warehouseId'?'warehouses':'suppliers']||[],filters[key],key==='warehouseId'?'Tất cả kho':'Tất cả NCC');
   el.value=filters[key];
  }
  for(const el of root.querySelectorAll('[data-stock-purchasing]'))el.hidden=!isPurchase(filters);
 }
 async function load(){if(!active)return;const n=++sequence,who=identity(),selected={...filters};root.setAttribute('aria-busy','true');
  results.innerHTML='<p class="muted" role="status">Đang tính theo bộ lọc…</p>';root.dataset.stockState='loading';
  try{const q=new URLSearchParams(selected),data=await api('/admin/home-stock-value?'+q);if(!active||sequence!==n||who!==identity())return;results.innerHTML=renderHomeStockValue(data);controls(data);root.dataset.stockState='ready';}
  catch(e){if(!active||sequence!==n||who!==identity())return;results.innerHTML=`<p class="error" role="alert">${esc(e.message||'Chưa tải được giá trị tồn kho.')} <button class="link-btn" type="button" data-stock-refresh data-mobile-inline>Thử lại</button></p>`;root.dataset.stockState='error';}
  finally{if(active&&sequence===n&&who===identity())root.setAttribute('aria-busy','false');}}
 root.addEventListener('change',e=>{const key=e.target.dataset.stockFilter;if(!active||!Object.hasOwn(filters,key))return;
  filters[key]=e.target.value;
  if(key==='stockType'){const priceBasis=filters.priceBasis,stockType=filters.stockType;filters={...defaults(),priceBasis,stockType};root.querySelector('[data-stock-filter=warehouseId]').innerHTML='<option value="">Tất cả kho</option>';root.querySelector('[data-stock-filter=supplierId]').innerHTML='<option value="">Tất cả NCC</option>';}
  controls();void load();});
 root.addEventListener('click',e=>{if(e.target.closest('[data-stock-reset]')){const {priceBasis,stockType}=filters;filters={...defaults(),priceBasis,stockType};controls();void load();}else if(e.target.closest('[data-stock-refresh]'))void load();});
 return {load,close(){active=false;sequence++;root.replaceChildren();}};
}

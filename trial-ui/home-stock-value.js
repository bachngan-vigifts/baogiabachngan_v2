const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number(v).toLocaleString('vi-VN',{maximumFractionDigits:0})+' đ';
const time=s=>s?new Date(s).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Chưa có mốc cập nhật';
export function renderHomeStockValue(data){
 const partial=data.missingSkus>0||data.unknownWarehouses>0;
 const total=data.inventory.length?(!data.inventory.some(w=>w.hasStockData)?'Chưa có dữ liệu':data.pricedRows||!data.missingSkus?money(data.totalValue):'Chưa đủ giá mua'):'—';
 return `<header class="home-section-head"><div><h2 id="home-stock-title">Giá trị tồn kho</h2><small class="muted">Ước tính theo giá nhập · ${esc(time(data.asOf))}</small></div><div class="home-stock-total"><small>${partial?'Giá trị đã xác định':'Tổng các kho'}</small><strong>${total}</strong></div></header>
 <div class="home-stock-grid">${data.inventory.length?data.inventory.map(w=>`<article class="home-stock-card"><h3>${esc(w.name)}</h3><strong>${!w.hasStockData||(!w.pricedSkus&&w.missingSkus)?'—':money(w.value)}</strong><small>${w.source==='ledger'?'Sổ kho CRM':'Đồng bộ Sapo'} · ${esc(time(w.updatedAt))}</small>${!w.hasStockData?'<p class="home-stock-warning">Chưa có dữ liệu tồn.</p>':w.missingSkus?`<p class="home-stock-warning">${w.missingSkus} mã chưa có giá mua; chưa tính phần này.</p>`:''}${w.referenceValue?`<small>Gồm ${money(w.referenceValue)} theo giá tham chiếu.</small>`:''}${w.negativeSkus?`<p class="home-stock-warning">${w.negativeSkus} mã tồn âm cần đối soát.</p>`:''}</article>`).join(''):'<p class="muted">Chưa có kho thực đang hoạt động.</p>'}</div>
 <p class="home-stock-note">Tồn dương × giá nhập gần nhất; thiếu giá nhập thì tham chiếu đơn NCC đã duyệt hoặc công thức mua NCC. Tồn NCC và hàng đang về không nằm trong tổng. Hàng đang giữ vẫn thuộc tồn kho. Tồn âm được báo riêng.</p><button type="button" class="link-btn" data-stock-refresh data-mobile-inline>Làm mới giá trị tồn</button>`;
}
export function initHomeStockValue({root,api,identity}){
 let active=true,sequence=0;
 root.innerHTML='<h2 id="home-stock-title">Giá trị tồn kho</h2><p class="muted" role="status">Đang tải giá trị các kho…</p>';
 async function load(){if(!active)return;const n=++sequence,who=identity();root.setAttribute('aria-busy','true');
  try{const data=await api('/admin/home-stock-value');if(!active||sequence!==n||who!==identity())return;root.innerHTML=renderHomeStockValue(data);root.dataset.stockState='ready';}
  catch(e){if(!active||sequence!==n||who!==identity())return;root.innerHTML=`<h2 id="home-stock-title">Giá trị tồn kho</h2><p class="error" role="alert">${esc(e.message||'Chưa tải được giá trị tồn kho.')} <button class="link-btn" type="button" data-stock-refresh data-mobile-inline>Thử lại</button></p>`;root.dataset.stockState='error';}
  finally{if(active&&sequence===n&&who===identity())root.setAttribute('aria-busy','false');}}
 root.addEventListener('click',e=>{if(e.target.closest('[data-stock-refresh]'))load();});
 return {load,close(){active=false;sequence++;root.replaceChildren();}};
}

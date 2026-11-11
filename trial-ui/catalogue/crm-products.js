import {crmProductFacts,crmCatalogueProduct,defaultCrmPolicy,crmCataloguePricing} from './crm-product-data.js';
import {esc,money,price} from './core.js';
import {catalogueThumbnailTag,hydrateCatalogueThumbnails,releaseCatalogueThumbnails} from './product-images.js';

export function createCrmProducts({api,identity,getSettings,getProducts,getSelected,onPick,toast}){
 let root=null,session='',run=0,data=null,brands=[],query='',brand='',offset=0,policy='',category='Sản phẩm CRM',loading=false,error='',timer,picking=false;
 const marked=new Set();
 function reset(){run++;data=null;brands=[];query='';brand='';offset=0;policy='';loading=false;error='';marked.clear();session=identity();}
 const selected=p=>getProducts().some(x=>(x.crmSku===p.sku||x.sku===p.sku&&x.brand===(p.brand||'Chưa phân thương hiệu'))&&getSelected().includes(x.id));
 function draw(){
  if(!root?.isConnected)return;
  releaseCatalogueThumbnails(root);const focused=root.querySelector('[data-crm-search]')===document.activeElement,pos=focused?document.activeElement.selectionStart:0;
  const rows=data?.products||[],policies=data?.policies||[],canPick=!!policy&&!loading&&!picking;
  root.innerHTML=`<section class="panel crm-products"><div class="panel-body"><h1>Sản phẩm CRM</h1><p>Chọn sản phẩm trong danh mục CRM để tạo catalogue. Giá theo bảng giá đang chọn; CK/phụ phí theo thiết lập catalogue. Mã chưa có giá được chào “Liên hệ”.</p><div class="crm-product-filters"><label>Tìm tên / SKU<input class="input" data-crm-search type="search" value="${esc(query)}" placeholder="Gõ không dấu để tìm…"></label><label>Thương hiệu<select class="input" data-crm-brand><option value="">Mọi thương hiệu</option>${brands.map(b=>`<option value="${esc(b.name)}" ${b.name===brand?'selected':''}>${esc(b.name)} (${b.count})</option>`).join('')}</select></label><label>Bảng giá CRM<select class="input" data-crm-policy><option value="">Chọn bảng giá…</option>${policies.map(p=>`<option value="${esc(p.id)}" ${p.id===policy?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>Danh mục trên catalogue<input class="input" data-crm-category maxlength="70" value="${esc(category)}"></label></div><p class="hint">Sản phẩm đã chọn giữ nguyên giá, số lượng và chỉnh sửa trên bản chào. Không tự đồng bộ ngược về CRM. Ảnh thiếu vẫn có thể bổ sung trên catalogue.</p><div class="crm-product-actions"><button class="btn" data-crm-refresh ${loading?'disabled':''}>Làm mới</button><label><input type="checkbox" data-crm-all ${!rows.length||!canPick?'disabled':''}> Tick trang này</label><button class="btn primary" data-crm-add ${!marked.size||!canPick?'disabled':''}>Thêm ${marked.size||''} sản phẩm vào catalogue</button><span role="status">${loading?'Đang đọc CRM…':`${data?.total||0} sản phẩm · Đã tick ${marked.size}`}</span></div>${error?`<p class="error" role="alert">${esc(error)}</p>`:''}${!policy&&rows.length?'<p class="inline-note">Chọn đúng bảng giá CRM trước khi thêm sản phẩm.</p>':''}</div><div class="library-grid crm-product-grid">${rows.map(p=>{
   let facts,issue='';try{facts=crmProductFacts(p,policy,category);}catch(e){issue=e.message;}
   const current=selected(p),amount=facts?price(crmCataloguePricing(facts,getSettings())):null;
   return `<article class="product-card" data-crm-sku="${esc(p.sku)}"><label class="crm-product-tick"><input type="checkbox" data-crm-check="${esc(p.sku)}" value="${esc(p.sku)}" ${marked.has(p.sku)?'checked':''} ${issue||!canPick?'disabled':''}> Tick sản phẩm</label>${p.imageUrl?catalogueThumbnailTag({image:p.imageUrl,name:p.name},'card-image',esc):'<div class="card-image library-no-photo">Chưa có ảnh</div>'}<div class="card-body"><div class="card-kicker">${esc(p.brand||'Chưa phân thương hiệu')}</div><div class="card-name">${esc(p.name)}</div><p class="hint">${esc(p.sku)}${p.unit?' · '+esc(p.unit):''}</p><div class="card-price">${facts?(facts.priceOnRequest?'Liên hệ':money(amount)):'Chưa chọn giá'}</div>${facts&&!facts.priceOnRequest?`<p class="hint">Giá CRM: ${money(facts.regular)}</p>`:''}<button class="btn small" data-crm-pick="${esc(p.sku)}" ${issue||!canPick?'disabled':''}>${current?'Đã có trong bản chào':'Chọn tạo catalogue'}</button>${issue?`<p class="hint">${esc(issue)}</p>`:''}</div></article>`;
  }).join('')}</div>${!loading&&!rows.length&&!error?'<div class="full-empty">Không tìm thấy sản phẩm. Thử từ khóa khác hoặc bỏ lọc thương hiệu.</div>':''}<div class="library-pagination"><button class="btn" data-crm-prev ${!offset||loading?'disabled':''}>Trang trước</button><span>${data?.total?offset+1:0}–${Math.min(offset+50,data?.total||0)} / ${data?.total||0}</span><button class="btn" data-crm-next ${offset+50>=(data?.total||0)||loading?'disabled':''}>Trang sau</button></div></section>`;
  hydrateCatalogueThumbnails(root);const all=root.querySelector('[data-crm-all]'),eligible=[...root.querySelectorAll('[data-crm-check]:not(:disabled)')];all.checked=eligible.length>0&&eligible.every(x=>x.checked);all.indeterminate=eligible.some(x=>x.checked)&&!all.checked;
  if(focused){const input=root.querySelector('[data-crm-search]');input.focus();input.setSelectionRange(pos,pos);}
 }
 async function load(){
  if(!root?.isConnected)return;if(session!==identity())reset();const who=session,seq=++run;marked.clear();data=null;loading=true;error='';draw();
  if(!who){loading=false;error='Đăng nhập CRM để đọc danh mục sản phẩm.';draw();return;}
  try{
   const params=new URLSearchParams({q:query,brand,offset:String(offset),limit:'50'});
   const [next,brandData]=await Promise.all([api('api/crm-products?'+params),brands.length?Promise.resolve({brands}):api('api/crm-brands')]);
   if(seq!==run||who!==identity()||!root?.isConnected)return;
   data=next;brands=brandData.brands||[];if(!policy)policy=defaultCrmPolicy(next.policies||[]);if(!next.policies?.some(p=>p.id===policy))policy='';
  }catch(e){if(seq!==run||who!==identity())return;error=e.message;}
  finally{if(seq===run&&who===identity()){loading=false;draw();}}
 }
 async function pick(skus){
  if(picking||loading||session!==identity())return;const who=session,seq=run;
  try{picking=true;const products=await Promise.all((data?.products||[]).filter(p=>skus.includes(p.sku)).map(p=>crmCatalogueProduct(p,policy,category,getSettings())));if(who!==identity()||seq!==run)return;if(!products.length)return;onPick(products);}
  catch(e){if(who===identity())toast(e.message);}finally{picking=false;draw();}
 }
 function onInput(e){const t=e.target;if(t.matches('[data-crm-search]')){query=t.value;offset=0;clearTimeout(timer);run++;loading=true;data=null;marked.clear();draw();timer=setTimeout(load,250);}if(t.matches('[data-crm-category]'))category=t.value;}
 function onChange(e){const t=e.target;if(t.matches('[data-crm-brand]')){brand=t.value;offset=0;load();}if(t.matches('[data-crm-policy]')){policy=t.value;marked.clear();draw();}if(t.matches('[data-crm-check]')){t.checked?marked.add(t.value):marked.delete(t.value);draw();}if(t.matches('[data-crm-all]')){for(const input of root.querySelectorAll('[data-crm-check]:not(:disabled)'))t.checked?marked.add(input.value):marked.delete(input.value);draw();}}
 function onClick(e){const b=e.target.closest('button');if(!b||b.disabled)return;if(b.hasAttribute('data-crm-pick'))pick([b.dataset.crmPick]);if(b.hasAttribute('data-crm-add'))pick([...marked]);if(b.hasAttribute('data-crm-refresh')){brands=[];load();}if(b.hasAttribute('data-crm-next')){offset+=50;load();}if(b.hasAttribute('data-crm-prev')){offset=Math.max(0,offset-50);load();}}
 function unmount(){clearTimeout(timer);run++;releaseCatalogueThumbnails(root);if(root){root.removeEventListener('input',onInput);root.removeEventListener('change',onChange);root.removeEventListener('click',onClick);}root=null;loading=false;}
 function accountChanged(){if(session!==identity()){reset();draw();if(root?.isConnected)load();}}
 window.addEventListener('storage',e=>{if(e.key==='bn-v2-session'||e.key===null)accountChanged();});window.addEventListener('focus',accountChanged);
 return{mount(node){unmount();root=node;if(session!==identity())reset();root.addEventListener('input',onInput);root.addEventListener('change',onChange);root.addEventListener('click',onClick);load();},unmount};
}

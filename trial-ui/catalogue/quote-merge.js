import {defaultState,restoreState,selectedProducts,makeSlides,slideKey,isBundle,esc} from './core.js';

export const PAGE_SORTS=[['source','Tự động theo ngân sách'],['brand','Thương hiệu → Danh mục'],['category','Danh mục → Thương hiệu'],['name','Tên sản phẩm A–Z'],['price','Giá tăng dần'],['price-desc','Giá giảm dần'],['manual','Kéo thả bằng tay']];

/** Copy saved snapshots, including distinct offers for the same SKU. Never refresh prices. */
export function mergeQuoteSnapshots(documents,{title='BÁO GIÁ TỔNG HỢP',sort='brand'}={}){
 if(documents.length<2||documents.length>20)throw Error('Chọn từ 2 đến 20 báo giá để gộp.');
 const sources=documents.map(d=>restoreState(d.state));
 const count=sources.reduce((n,s)=>n+selectedProducts(s).length,0);
 if(!count||count>1000)throw Error('Bản gộp tối đa 1.000 sản phẩm. Hãy giảm số báo giá đã chọn.');
 const result=defaultState();result.settings={...sources[0].settings,mergedQuote:true,pageSort:sort,pageOrder:[],dividers:false,bundle10:false,bundle10Ids:[]};
 if(['brand','category','name','price','price-desc'].includes(sort)){result.settings.selectionSort=sort;result.settings.sortPrice=sort==='price';}
 result.meta={...sources[0].meta,title:String(title).trim().slice(0,160)||'BÁO GIÁ TỔNG HỢP',customer:'',customerId:'',customerGroup:'',quoteNo:'BG-GOP-'+crypto.randomUUID().slice(0,8).toUpperCase()};
 for(const source of sources){
  const ids=new Map();
  for(const original of selectedProducts(source)){
   const product=structuredClone(original);product.id=crypto.randomUUID();delete product.crmStock;delete product.sharedPendingFor;
   ids.set(original.id,product.id);result.products.push(product);result.selected.push(product.id);
   if(isBundle(original,source)){result.settings.bundle10=true;result.settings.bundle10Ids.push(product.id);}
  }
  for(const slide of makeSlides(source).filter(s=>s.type==='products')){
   const text=source.pageText[slideKey(slide)];if(text){const mapped={...slide,items:slide.items.map(p=>({...p,id:ids.get(p.id)}))};result.pageText[slideKey(mapped)]=structuredClone(text);}
  }
  for(const brand of source.customBrands)if(!result.customBrands.some(b=>b.name===brand.name)&&result.customBrands.length<30)result.customBrands.push(structuredClone(brand));
 }
 for(const key of ['cover','closing'])if(sources[0].pageText[key])result.pageText[key]=structuredClone(sources[0].pageText[key]);
 return restoreState(result);
}

export function chooseMergeOptions(summaries){
 return new Promise(resolve=>{
  const dlg=document.createElement('dialog');dlg.className='shared-library-dialog quote-merge-dialog';
  dlg.innerHTML=`<form><header><h2>Gộp ${summaries.length} báo giá</h2><button type="button" class="btn" data-close>Đóng</button></header><div class="modal-body"><label>Tên báo giá mới<input class="input" name="title" maxlength="160" value="BÁO GIÁ TỔNG HỢP" required></label><label>Thứ tự trang<select class="input" name="sort">${PAGE_SORTS.filter(([v])=>v!=='manual').map(([v,t])=>`<option value="${v}" ${v==='brand'?'selected':''}>${t}</option>`).join('')}</select></label><ol>${summaries.map(s=>`<li>${esc(s.quoteNo)} · ${esc(s.title||s.customer)}</li>`).join('')}</ol><p>Giữ riêng từng dòng sản phẩm, kể cả trùng mã; giữ giá và số lượng đã lưu. Dùng bố cục, bìa và lời kết của báo giá đầu tiên. Đánh số trang liên tục; có thể kéo thả trang sau khi gộp.</p><p>Bản gộp chưa gửi lên máy chủ. Bấm “Lưu báo giá chung” sau khi kiểm tra. Các báo giá nguồn được giữ nguyên.</p></div><footer><button type="button" class="btn" data-close>Hủy</button><button class="btn primary" type="submit">Tạo báo giá gộp</button></footer></form>`;
  const finish=value=>{dlg.close();dlg.remove();resolve(value);};
  dlg.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>finish(null));dlg.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
  dlg.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);finish({title:f.get('title'),sort:f.get('sort')});};
  document.body.append(dlg);dlg.showModal();
 });
}

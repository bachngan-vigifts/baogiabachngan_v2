import {defaultState,restoreState,selectedProducts,makeSlides,slideKey,isBundle,esc} from './core.js';

export const PAGE_SORTS=[['source','Giữ thứ tự trang nguồn'],['brand','Thương hiệu → Danh mục'],['category','Danh mục → Thương hiệu'],['name','Tên sản phẩm A–Z'],['price','Giá tăng dần'],['price-desc','Giá giảm dần'],['manual','Kéo thả bằng tay']];

/** Freeze each existing page and its source rendering context. Never paginate its products again. */
export function mergeQuoteSnapshots(documents,{title='BÁO GIÁ TỔNG HỢP',sort='source'}={}){
 if(documents.length<2||documents.length>20)throw Error('Chọn từ 2 đến 20 báo giá để gộp.');
 const inputs=documents.map(d=>restoreState(d.state));
 if(inputs.reduce((n,s)=>n+selectedProducts(s).length,0)>1000)throw Error('Bản gộp tối đa 1.000 sản phẩm. Hãy giảm số báo giá đã chọn.');
 const result=defaultState();result.settings={...inputs[0].settings,mergedQuote:true,pageSort:sort,pageOrder:[]};
 result.meta={...inputs[0].meta,title:String(title).trim().slice(0,160)||'BÁO GIÁ TỔNG HỢP',customer:'',customerId:'',customerGroup:'',quoteNo:'BG-GOP-'+crypto.randomUUID().slice(0,8).toUpperCase()};
 result.pageComposition={sources:[],pages:[]};
 const descriptor=slide=>{const out={type:slide.type};for(const key of ['band','brand','category','bundle10','layout','count'])if(slide[key]!==undefined)out[key]=slide[key];if(slide.items)out.items=slide.items.map(p=>p.id);return out;};
 for(const input of inputs){
  // Flat product records serve list/search metadata only; pages use the untouched source records below.
  for(const original of selectedProducts(input)){const product=structuredClone(original);product.id=crypto.randomUUID();delete product.crmStock;delete product.sharedPendingFor;result.products.push(product);result.selected.push(product.id);}
  if(input.pageComposition){
   const sourceIds=new Map();for(const original of input.pageComposition.sources){const source=structuredClone(original);source.id=crypto.randomUUID();sourceIds.set(original.id,source.id);result.pageComposition.sources.push(source);}
   const refs=new Map(input.pageComposition.pages.map(p=>[p.id,p]));
   for(const slide of makeSlides(input)){const ref=refs.get(slide.compositionId);result.pageComposition.pages.push({id:'page:'+crypto.randomUUID(),sourceId:sourceIds.get(ref.sourceId),index:ref.index});}
  }else{
   const id=crypto.randomUUID(),snapshot=structuredClone(input);snapshot.cloudQuote=null;
   for(const p of snapshot.products){delete p.crmStock;delete p.sharedPendingFor;}
   const slides=makeSlides(input).map(descriptor);result.pageComposition.sources.push({id,state:snapshot,slides});
   slides.forEach((_,index)=>result.pageComposition.pages.push({id:'page:'+crypto.randomUUID(),sourceId:id,index}));
  }
 }
 const merged=restoreState(result);
 if(new TextEncoder().encode(JSON.stringify(merged)).length>1_850_000)throw Error('Bản gộp quá lớn để lưu an toàn. Hãy giảm số báo giá đã chọn.');
 return merged;
}

export function chooseMergeOptions(summaries){
 return new Promise(resolve=>{
  const dlg=document.createElement('dialog');dlg.className='shared-library-dialog quote-merge-dialog';
  dlg.innerHTML=`<form><header><h2>Gộp ${summaries.length} báo giá</h2><button type="button" class="btn" data-close>Đóng</button></header><div class="modal-body"><label>Tên báo giá mới<input class="input" name="title" maxlength="160" value="BÁO GIÁ TỔNG HỢP" required></label><label>Thứ tự trang<select class="input" name="sort">${PAGE_SORTS.filter(([v])=>v!=='manual').map(([v,t])=>`<option value="${v}" ${v==='source'?'selected':''}>${t}</option>`).join('')}</select></label><ol>${summaries.map(s=>`<li>${esc(s.quoteNo)} · ${esc(s.title||s.customer)}</li>`).join('')}</ol><p>Giữ nguyên mọi trang nguồn: bố cục, vị trí sản phẩm, ảnh, giá, chữ, ghi chú, bìa và lời kết. Chỉ đánh lại số trang liên tục. Sắp xếp hoặc kéo thả chỉ di chuyển nguyên trang; không phân trang lại.</p><p>Bản gộp chưa gửi lên máy chủ. Bấm “Lưu báo giá chung” sau khi kiểm tra. Các báo giá nguồn được giữ nguyên.</p></div><footer><button type="button" class="btn" data-close>Hủy</button><button class="btn primary" type="submit">Tạo báo giá gộp</button></footer></form>`;
  const finish=value=>{dlg.close();dlg.remove();resolve(value);};
  dlg.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>finish(null));dlg.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
  dlg.querySelector('form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);finish({title:f.get('title'),sort:f.get('sort')});};
  document.body.append(dlg);dlg.showModal();
 });
}

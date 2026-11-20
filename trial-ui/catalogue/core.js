import {cleanQuotePolicy,policyUnitPrice} from './quote-pricing.js';
export const BRAND='VIGIFTS - BÁCH NGÂN';
export const C={green:'#00543B',muted:'#69746F',ink:'#183B2E',red:'#C43329',frame:'#F7F9FA',line:'#E4E9E7'};
export const limits=[350000,800000,1400000,2500000];
export const ranges=['ĐẾN 350.000đ','TRÊN 350.000 – 800.000đ','TRÊN 800.000 – 1.400.000đ','TRÊN 1.400.000 – 2.500.000đ','TRÊN 2.500.000đ','GIÁ LIÊN HỆ','TRÊN 350.000 – 500.000đ','TRÊN 500.000 – 800.000đ'];
export const priceBandOrder=[0,6,7,1,2,3,4,5];
export const validPriceBand=n=>Number.isInteger(n)&&n>=0&&n<ranges.length&&n!==5;
export function priceBandField(value=null,name='priceBand',disabled=false){return `<label class="price-band-field">Khoảng giá phân trang<select class="input" name="${esc(name)}" ${disabled?'disabled':''}><option value="">Tự động theo giá đề xuất</option>${priceBandOrder.filter(n=>n!==5).map(n=>`<option value="${n}" ${value===n?'selected':''}>${ranges[n]}</option>`).join('')}</select></label>`;}
export const categories=['Bình giữ nhiệt','Bình nước nhựa','Bình nước để bàn','Ly, cốc','Chén cơm','Bộ đồ ăn','Bình hoa','Cân điện tử','Chăm sóc răng miệng','Máy sấy tóc','Bàn ủi','Máy hút bụi','Máy lọc không khí','Máy tiệt trùng','Quạt máy'];
export const money=n=>new Intl.NumberFormat('vi-VN').format(Math.round(Number(n)||0))+'đ';
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function cleanUrl(value){if(!value)return '';try{const u=new URL(value);if(u.protocol!=='https:'&&u.protocol!=='http:')return '';return u.href}catch{return ''}}
export function defaultState(){return {version:1,cloudQuote:null,customBrands:[],pageText:{},products:[],selected:[],meta:{customerId:'',customerGroup:'',title:'DANH MỤC QUÀ TẶNG DOANH NGHIỆP',customer:'',quoteNo:'BG-'+new Date().toISOString().slice(0,10).replaceAll('-',''),employee:'Châu Yến',phone:'0907 168 234',date:new Date().toLocaleDateString('en-CA'),note:'Giá đã bao gồm thuế VAT, chi phí in ấn và chi phí vận chuyển.'},settings:{productsPerPage:4,lockDiscount:40,minhDiscount:10,fee:15000,cover:true,dividers:true,closing:true,qr:true,regular:true,proposedPrice:true,sortPrice:true,selectionSort:"price",bundle10:false,bundle10Ids:[]}}}
export function validateProduct(p){
 const name=String(p.name||'').trim().slice(0,220),category=String(p.category||'').trim().slice(0,70),brand=String(p.brand||'LocknLock').trim().slice(0,50);
 const regular=Number(p.regular),discount=Number(p.discount),fee=Number(p.fee),override=p.override===''||p.override==null?null:Number(p.override);
 if(!name)throw Error('Anh/chị vui lòng nhập tên sản phẩm.');if(!category)throw Error('Anh/chị vui lòng chọn danh mục.');
 if(!Number.isFinite(regular)||(regular<=0&&!p.priceOnRequest)||regular<0||regular>1e10)throw Error('Giá niêm yết phải lớn hơn 0 và không vượt 10 tỷ đồng.');
 if(!Number.isFinite(discount)||discount<0||discount>100)throw Error('Chiết khấu phải từ 0 đến 100%.');if(!Number.isFinite(fee)||fee<0||fee>1e8)throw Error('Phụ phí chưa hợp lệ.');
 if(override!==null&&(!Number.isFinite(override)||override<0||override>1e10))throw Error('Giá tự nhập chưa hợp lệ.');
 const image=String(p.image||'');if(image&&!image.startsWith('data:image/')&&!cleanUrl(image))throw Error('Đường dẫn ảnh chưa hợp lệ.');
 const rawStock=p.crmStock,crmStock=rawStock?.source==='crm'&&Number.isFinite(Number(rawStock.available))&&Number(rawStock.available)>=0&&Number.isFinite(Date.parse(rawStock.checkedAt))?{source:'crm',sku:String(rawStock.sku||p.sku||'').slice(0,100),available:Number(rawStock.available),checkedAt:String(rawStock.checkedAt),updatedAt:rawStock.updatedAt?String(rawStock.updatedAt).slice(0,80):null}:null;
 const details={crmSku:typeof p.crmSku==='string'&&p.crmSku.length<=100?p.crmSku:'',priceBand:validPriceBand(p.priceBand)?p.priceBand:null,sharedId:/^[a-f0-9]{64}$/.test(p.sharedId||'')?p.sharedId:'',sharedRevision:Number.isSafeInteger(p.sharedRevision)?p.sharedRevision:null,sharedPendingFor:typeof p.sharedPendingFor==='string'?p.sharedPendingFor.slice(0,100):'',collection:String(p.collection||'').trim().slice(0,100),pattern:String(p.pattern||'').trim().slice(0,100),color:String(p.color||'').trim().slice(0,100),createdAt:typeof p.createdAt==='string'&&Number.isFinite(Date.parse(p.createdAt))?new Date(p.createdAt).toISOString():null,createdAtSource:['web','crm'].includes(p.createdAtSource)?p.createdAtSource:null};
 return {...details,id:String(p.id||crypto.randomUUID()).slice(0,80),name,category,brand,sku:String(p.sku||'').trim().slice(0,100),url:cleanUrl(p.url),image,regular,discount,fee,override,qty:Math.max(1,Math.min(1000000,Math.round(Number(p.qty)||1))),crmStock,priceOnRequest:!!p.priceOnRequest&&regular===0,fromPrice:!!p.fromPrice};
}
export function libraryPricing(p,settings){return {...p,discount:p.discount??(p.brand==='LocknLock'?settings.lockDiscount:p.brand==='Minh Long'?settings.minhDiscount:0),fee:p.fee??settings.fee,override:p.override??null};}
export function price(p){if(p.priceOnRequest)return 0;return p.override!==null&&p.override!==undefined&&p.override!==''?Math.round(Number(p.override)):Math.round(Number(p.regular)*(1-Number(p.discount)/100)+Number(p.fee))}
export function isBundle(p,state){return !!state.settings.bundle10&&Array.isArray(state.settings.bundle10Ids)&&state.settings.bundle10Ids.includes(p.id)}
export function quotePrice(p,state){return policyUnitPrice(p,state.settings.quotePolicy,price(p))*(isBundle(p,state)?10:1)}
export function quoteBudget(p,state){return budget({...p,override:quotePrice(p,state)})}
export function budget(p){if(p.priceOnRequest)return 5;if(validPriceBand(p.priceBand))return p.priceBand;const n=price(p);const b=limits.findIndex(l=>n<=l);return b<0?4:b}
export function selectedProducts(state){const byId=new Map(state.products.map(p=>[p.id,p]));return [...new Set(state.selected)].map(id=>byId.get(id)).filter(Boolean)}
export const SELECTION_SORTS = [['manual','Tự sắp xếp'],['newest','Sản phẩm mới'],['price','Giá tăng dần'],['price-desc','Giá giảm dần'],['brand','Thương hiệu'],['name','Tên sản phẩm A–Z'],['collection','Bộ sưu tập'],['category','Danh mục'],['pattern','Hoa văn'],['color','Màu sắc']];
const collator=new Intl.Collator('vi',{numeric:true,sensitivity:'base'});
export function sortedProducts(state){
 const products=selectedProducts(state),mode=state.settings.selectionSort==='price'&&!state.settings.sortPrice?'manual':state.settings.selectionSort||(state.settings.sortPrice?'price':'manual');
 if(mode==='manual')return products;
 return products.sort((a,b)=>{
  if(mode==='price'||mode==='price-desc')return (quotePrice(a,state)-quotePrice(b,state))*(mode==='price-desc'?-1:1);
  if(mode==='newest'){const x=Date.parse(a.createdAt),y=Date.parse(b.createdAt);return Number.isFinite(x)&&Number.isFinite(y)?y-x:Number.isFinite(x)?-1:Number.isFinite(y)?1:0;}
  const x=String(a[mode]||'').trim(),y=String(b[mode]||'').trim();return x&&y?collator.compare(x,y):x?-1:y?1:0;
 });
}
export function setSelectionSort(state,mode){
 if(!SELECTION_SORTS.some(([key])=>key===mode))return false;
 if(mode==='manual')state.selected=sortedProducts(state).map(p=>p.id);
 state.settings.selectionSort=mode;state.settings.sortPrice=mode==='price';return true;
}
export function moveSelectedProduct(state,id,targetId,after=false){
 const before=sortedProducts(state).map(p=>p.id);
 if(id===targetId||!before.includes(id)||!before.includes(targetId))return false;
 const next=before.filter(key=>key!==id);next.splice(next.indexOf(targetId)+(after?1:0),0,id);
 if(next.every((key,i)=>key===before[i]))return false;
 state.selected=next;state.settings.sortPrice=false;state.settings.selectionSort='manual';return true;
}
export function makeSlides(state){
 if(state.pageComposition){
  const sources=new Map(state.pageComposition.sources.map(source=>[source.id,source]));
  const result=state.pageComposition.pages.map(ref=>{const source=sources.get(ref.sourceId),context={...source.state,frozenSlides:source.slides};const slide=makeSlides(context)[ref.index];return {...slide,compositionId:ref.id,sourceState:context};});
  const mode=state.settings.pageSort||'source',rank=new Map((state.settings.pageOrder||[]).map((id,i)=>[id,i]));
  if(mode==='manual')result.sort((a,b)=>(rank.get(a.compositionId)??result.length)-(rank.get(b.compositionId)??result.length));
  else if(mode!=='source'){
   const key=p=>mode==='category'?p.category:mode==='name'?p.items?.[0]?.name:p.brand;
   const cost=p=>p.items?.length?Math.min(...p.items.map(item=>quotePrice(item,p.sourceState))):null;
   // Covers/dividers/closing stay as complete pages in their source slots; only product-page slots are sorted.
   const productPages=result.filter(p=>p.type==='products');productPages.sort((a,b)=>mode==='price'||mode==='price-desc'?(cost(a)-cost(b))*(mode==='price-desc'?-1:1):collator.compare(key(a)||'',key(b)||''));
   let i=0;return result.map(p=>p.type==='products'?productPages[i++]:p);
  }
  return result;
 }
 if(state.frozenSlides){const byId=new Map(state.products.map(p=>[p.id,p]));return state.frozenSlides.map(s=>({...s,...(s.items?{items:s.items.map(id=>byId.get(id))}:{})}));}

 const products=sortedProducts(state),pages=[];
 for(const band of priceBandOrder){
  const group=products.filter(p=>quoteBudget(p,state)===band),bandPages=[];
  const brands=[...new Set(group.map(p=>p.brand))].sort((a,b)=>a==='LocknLock'?-1:b==='LocknLock'?1:a==='Minh Long'?-1:b==='Minh Long'?1:a.localeCompare(b,'vi'));
  for(const brand of brands){
   const cats=[...new Set(group.filter(p=>p.brand===brand).map(p=>p.category))].sort((a,b)=>a.localeCompare(b,'vi'));
   for(const category of cats)for(const bundle10 of [false,true]){
    const items=group.filter(p=>p.brand===brand&&p.category===category&&isBundle(p,state)===bundle10);
    for(let i=0,size=[6,8].includes(state.settings.productsPerPage)?state.settings.productsPerPage:4;i<items.length;i+=size){const chunk=items.slice(i,i+size);if(chunk.length>1||state.settings.mergedQuote)bandPages.push({type:'products',band,brand,category,bundle10,layout:size,items:chunk});}
   }
  }
  if(bandPages.length){if(state.settings.dividers&&!state.settings.mergedQuote)pages.push({type:'divider',band,count:bandPages.reduce((n,p)=>n+p.items.length,0)});pages.push(...bandPages)}
 }
 if(state.settings.mergedQuote){
  const mode=state.settings.pageSort||'brand',keys=state.settings.pageOrder||[],rank=new Map(keys.map((k,i)=>[k,i]));
  pages.sort((a,b)=>{
   if(mode==='manual')return (rank.get(slideKey(a))??keys.length)-(rank.get(slideKey(b))??keys.length);
   const text=(x,y)=>collator.compare(x,y),first=p=>p.items[0]?.name||'',cost=p=>Math.min(...p.items.map(i=>quotePrice(i,state)));
   if(mode==='brand')return text(a.brand,b.brand)||text(a.category,b.category)||cost(a)-cost(b);
   if(mode==='category')return text(a.category,b.category)||text(a.brand,b.brand)||cost(a)-cost(b);
   if(mode==='name')return text(first(a),first(b));
   if(mode==='price'||mode==='price-desc')return (cost(a)-cost(b))*(mode==='price-desc'?-1:1);
   return 0;
  });
 }
 if(!pages.length)return [{type:'empty',band:0,brand:'VIGIFTS - BÁCH NGÂN',category:'CHƯA ĐỦ SẢN PHẨM',items:[]}];
 if(state.settings.cover)pages.unshift({type:'cover'});if(state.settings.closing)pages.push({type:'closing'});return pages;
}
export function restoreState(raw){
 if(!raw||raw.version!==1||!Array.isArray(raw.products)||raw.products.length>1000)throw Error('File dữ liệu không đúng định dạng hoặc vượt 1.000 sản phẩm.');
 const pageText={};if(raw.pageText&&typeof raw.pageText==='object'){for(const [key,fields] of Object.entries(raw.pageText).slice(0,1000)){if(!fields||typeof fields!=='object')continue;pageText[key.slice(0,500)]={};for(const [position,value]of Object.entries(fields).slice(0,100))if(/^\d+:\d+$/.test(position)&&typeof value==='string')pageText[key.slice(0,500)][position]=value.slice(0,2000);}}
 const d=defaultState(),products=raw.products.map(validateProduct);if(new Set(products.map(p=>p.id)).size!==products.length)throw Error('File có mã dữ liệu trùng nhau.');
 const meta={};for(const k of Object.keys(d.meta))meta[k]=String(raw.meta?.[k]??d.meta[k]).slice(0,k==='note'?500:['customerId','customerGroup'].includes(k)?200:160);
 const settings={...d.settings,productsPerPage:[6,8].includes(raw.settings?.productsPerPage)?raw.settings.productsPerPage:4};for(const k of ['cover','dividers','closing','qr','regular','proposedPrice','sortPrice','bundle10'])if(typeof raw.settings?.[k]==='boolean')settings[k]=raw.settings[k];
 settings.selectionSort=SELECTION_SORTS.some(([key])=>key===raw.settings?.selectionSort)?raw.settings.selectionSort:(settings.sortPrice?'price':'manual');if(settings.selectionSort==='price'&&!settings.sortPrice)settings.selectionSort='manual';settings.sortPrice=settings.selectionSort==='price';
 settings.bundle10Ids=Array.isArray(raw.settings?.bundle10Ids)?[...new Set(raw.settings.bundle10Ids)].filter(id=>products.some(p=>p.id===id)):[];
 for(const k of ['lockDiscount','minhDiscount','fee']){const n=Number(raw.settings?.[k]??settings[k]);if(!Number.isFinite(n)||n<0||n>(k==='fee'?1e8:100))throw Error('Thiết lập giá không hợp lệ.');settings[k]=n;}
 if(raw.settings?.quotePolicy!==undefined)settings.quotePolicy=cleanQuotePolicy(raw.settings.quotePolicy);
 settings.mergedQuote=raw.settings?.mergedQuote===true;
 settings.pageSort=['source','brand','category','name','price','price-desc','manual'].includes(raw.settings?.pageSort)?raw.settings.pageSort:'brand';
 settings.pageOrder=Array.isArray(raw.settings?.pageOrder)?[...new Set(raw.settings.pageOrder.filter(k=>typeof k==='string'&&k.length<=800))].slice(0,1000):[];
 const cloudQuote=raw.cloudQuote&&/^[A-Za-z0-9_-]{8,80}$/.test(raw.cloudQuote.id||'')&&Number.isSafeInteger(raw.cloudQuote.revision)&&raw.cloudQuote.revision>=0?{id:raw.cloudQuote.id,revision:raw.cloudQuote.revision,owner:String(raw.cloudQuote.owner||'').slice(0,100)}:null;
 const pageComposition=raw.pageComposition?restorePageComposition(raw.pageComposition):null;
 return {...(pageComposition?{pageComposition}:{}),version:1,cloudQuote,customBrands:Array.isArray(raw.customBrands)?raw.customBrands.filter(b=>b&&typeof b.name==='string'&&typeof b.origin==='string').slice(0,30):[],pageText,products,selected:Array.isArray(raw.selected)?raw.selected.filter(id=>products.some(p=>p.id===id)):[],meta,settings};
}

export function slideKey(slide){if(slide.compositionId)return slide.compositionId;return slide.type==='products'?'products:photo:'+([6,8].includes(slide.layout)?slide.layout+':':'')+slide.items.map(p=>p.id).sort().join('|'):slide.type+(slide.type==='divider'?':'+slide.band:'');}
export async function mapConcurrent(items,limit,worker){let cursor=0;const results=new Array(items.length);await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const i=cursor++;results[i]=await worker(items[i],i)}}));return results;}








export function moveQuotePage(state,id,target,after=false){
 if(!state.settings.mergedQuote||id===target)return false;
 const keys=makeSlides(state).filter(s=>state.pageComposition||s.type==='products').map(slideKey);if(!keys.includes(id)||!keys.includes(target))return false;
 const next=keys.filter(k=>k!==id);next.splice(next.indexOf(target)+(after?1:0),0,id);if(next.every((k,i)=>k===keys[i]))return false;
 state.settings.pageSort='manual';state.settings.pageOrder=next;return true;
}

export function restorePageComposition(raw){
 if(!raw||!Array.isArray(raw.sources)||!raw.sources.length||raw.sources.length>100||!Array.isArray(raw.pages)||!raw.pages.length||raw.pages.length>1500)throw Error('Cấu trúc trang gộp không hợp lệ.');
 const sources=raw.sources.map(source=>{
  if(typeof source.id!=='string'||source.id.length>80||source.state?.pageComposition||!Array.isArray(source.slides)||!source.slides.length||source.slides.length>1500)throw Error('Nguồn trang gộp không hợp lệ.');
  const state=restoreState(source.state),ids=new Set(state.selected);
  const slides=source.slides.map(p=>{
   if(!p||!['products','cover','divider','closing','empty'].includes(p.type))throw Error('Loại trang gộp không hợp lệ.');
   const clean={type:p.type};
   for(const key of ['brand','category'])if(p[key]!==undefined){if(typeof p[key]!=='string'||p[key].length>100)throw Error('Nhãn trang không hợp lệ.');clean[key]=p[key];}
   if(p.band!==undefined){if(!Number.isInteger(p.band)||p.band<0||p.band>7)throw Error('Khoảng giá trang không hợp lệ.');clean.band=p.band;}
   if(p.layout!==undefined){if(![4,6,8].includes(p.layout))throw Error('Bố cục trang không hợp lệ.');clean.layout=p.layout;}
   if(p.bundle10!==undefined){if(typeof p.bundle10!=='boolean')throw Error('Giá bộ trên trang không hợp lệ.');clean.bundle10=p.bundle10;}
   if(p.count!==undefined){if(!Number.isInteger(p.count)||p.count<0||p.count>1000)throw Error('Số sản phẩm trang không hợp lệ.');clean.count=p.count;}
   if(p.items!==undefined){if(!Array.isArray(p.items)||p.items.length>8||p.items.some(id=>!ids.has(id))||new Set(p.items).size!==p.items.length)throw Error('Sản phẩm trang không khớp nguồn.');clean.items=[...p.items];}
   if(p.type==='products'&&(!clean.items?.length||clean.band===undefined||!clean.brand||!clean.category))throw Error('Thiếu nội dung trang sản phẩm.');
   if(p.type==='divider'&&(clean.band===undefined||clean.count===undefined))throw Error('Thiếu nội dung trang ngân sách.');
   return clean;
  });
  return{id:source.id,state,slides};
 });
 if(new Set(sources.map(s=>s.id)).size!==sources.length||sources.reduce((n,s)=>n+s.state.selected.length,0)>1000)throw Error('Nguồn trang gộp trùng hoặc vượt 1.000 sản phẩm.');
 const byId=new Map(sources.map(s=>[s.id,s]));
 const pages=raw.pages.map(p=>{if(!p||typeof p.id!=='string'||!/^page:[A-Za-z0-9_-]{1,80}$/.test(p.id)||!byId.has(p.sourceId)||!Number.isInteger(p.index)||p.index<0||p.index>=byId.get(p.sourceId).slides.length)throw Error('Tham chiếu trang nguồn không hợp lệ.');return{id:p.id,sourceId:p.sourceId,index:p.index};});
 if(new Set(pages.map(p=>p.id)).size!==pages.length)throw Error('Trùng mã trang gộp.');
 return{sources,pages};
}

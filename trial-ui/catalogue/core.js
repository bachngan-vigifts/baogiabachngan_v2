export const BRAND='VIGIFTS - BÁCH NGÂN';
export const C={green:'#00543B',muted:'#69746F',ink:'#183B2E',red:'#C43329',frame:'#F7F9FA',line:'#E4E9E7'};
export const limits=[350000,800000,1400000,2500000];
export const ranges=['ĐẾN 350.000đ','TRÊN 350.000 – 800.000đ','TRÊN 800.000 – 1.400.000đ','TRÊN 1.400.000 – 2.500.000đ','TRÊN 2.500.000đ','GIÁ LIÊN HỆ'];
export const categories=['Bình giữ nhiệt','Bình nước nhựa','Bình nước để bàn','Ly, cốc','Chén cơm','Bộ đồ ăn','Bình hoa','Cân điện tử','Chăm sóc răng miệng','Máy sấy tóc','Bàn ủi','Máy hút bụi','Máy lọc không khí','Máy tiệt trùng','Quạt máy'];
export const money=n=>new Intl.NumberFormat('vi-VN').format(Math.round(Number(n)||0))+'đ';
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function cleanUrl(value){if(!value)return '';try{const u=new URL(value);if(u.protocol!=='https:'&&u.protocol!=='http:')return '';return u.href}catch{return ''}}
export function defaultState(){return {version:1,customBrands:[],pageText:{},products:[],selected:[],meta:{title:'DANH MỤC QUÀ TẶNG DOANH NGHIỆP',customer:'',quoteNo:'BG-'+new Date().toISOString().slice(0,10).replaceAll('-',''),employee:'Châu Yến',phone:'0907 168 234',date:new Date().toLocaleDateString('en-CA'),note:'Giá đã bao gồm thuế VAT, chi phí in ấn và chi phí vận chuyển.'},settings:{lockDiscount:40,minhDiscount:10,fee:15000,cover:true,dividers:true,closing:true,qr:true,regular:true,sortPrice:true,bundle10:false,bundle10Ids:[]}}}
export function validateProduct(p){
 const name=String(p.name||'').trim().slice(0,220),category=String(p.category||'').trim().slice(0,70),brand=String(p.brand||'LocknLock').trim().slice(0,50);
 const regular=Number(p.regular),discount=Number(p.discount),fee=Number(p.fee),override=p.override===''||p.override==null?null:Number(p.override);
 if(!name)throw Error('Anh/chị vui lòng nhập tên sản phẩm.');if(!category)throw Error('Anh/chị vui lòng chọn danh mục.');
 if(!Number.isFinite(regular)||(regular<=0&&!p.priceOnRequest)||regular<0||regular>1e10)throw Error('Giá niêm yết phải lớn hơn 0 và không vượt 10 tỷ đồng.');
 if(!Number.isFinite(discount)||discount<0||discount>100)throw Error('Chiết khấu phải từ 0 đến 100%.');if(!Number.isFinite(fee)||fee<0||fee>1e8)throw Error('Phụ phí chưa hợp lệ.');
 if(override!==null&&(!Number.isFinite(override)||override<0||override>1e10))throw Error('Giá tự nhập chưa hợp lệ.');
 const image=String(p.image||'');if(image&&!image.startsWith('data:image/')&&!cleanUrl(image))throw Error('Đường dẫn ảnh chưa hợp lệ.');
 const rawStock=p.crmStock,crmStock=rawStock?.source==='crm'&&Number.isFinite(Number(rawStock.available))&&Number(rawStock.available)>=0&&Number.isFinite(Date.parse(rawStock.checkedAt))?{source:'crm',sku:String(rawStock.sku||p.sku||'').slice(0,100),available:Number(rawStock.available),checkedAt:String(rawStock.checkedAt),updatedAt:rawStock.updatedAt?String(rawStock.updatedAt).slice(0,80):null}:null;
 return {id:String(p.id||crypto.randomUUID()).slice(0,80),name,category,brand,sku:String(p.sku||'').trim().slice(0,100),url:cleanUrl(p.url),image,regular,discount,fee,override,qty:Math.max(1,Math.min(1000000,Math.round(Number(p.qty)||1))),crmStock,priceOnRequest:!!p.priceOnRequest&&regular===0,fromPrice:!!p.fromPrice};
}
export function price(p){if(p.priceOnRequest)return 0;return p.override!==null&&p.override!==undefined&&p.override!==''?Math.round(Number(p.override)):Math.round(Number(p.regular)*(1-Number(p.discount)/100)+Number(p.fee))}
export function isBundle(p,state){return !!state.settings.bundle10&&Array.isArray(state.settings.bundle10Ids)&&state.settings.bundle10Ids.includes(p.id)}
export function quotePrice(p,state){return price(p)*(isBundle(p,state)?10:1)}
export function quoteBudget(p,state){return budget({...p,override:quotePrice(p,state)})}
export function budget(p){if(p.priceOnRequest)return 5;const n=price(p);const b=limits.findIndex(l=>n<=l);return b<0?4:b}
export function selectedProducts(state){const byId=new Map(state.products.map(p=>[p.id,p]));return [...new Set(state.selected)].map(id=>byId.get(id)).filter(Boolean)}
export function makeSlides(state){
 const products=selectedProducts(state),slides=[];if(!products.length)return [{type:'empty',band:0,brand:'LOCKNLOCK / MINH LONG',category:'DANH MỤC SẢN PHẨM',items:[]}];
 if(state.settings.cover)slides.push({type:'cover'});
 for(let band=0;band<6;band++){
  const group=products.filter(p=>quoteBudget(p,state)===band);if(!group.length)continue;
  if(state.settings.dividers)slides.push({type:'divider',band,count:group.length});
  const brands=[...new Set(group.map(p=>p.brand))].sort((a,b)=>a==='LocknLock'?-1:b==='LocknLock'?1:a==='Minh Long'?-1:b==='Minh Long'?1:a.localeCompare(b,'vi'));
  for(const brand of brands){
   const cats=[...new Set(group.filter(p=>p.brand===brand).map(p=>p.category))].sort((a,b)=>a.localeCompare(b,'vi'));
   for(const category of cats){for(const bundle10 of [false,true]){let items=group.filter(p=>p.brand===brand&&p.category===category&&isBundle(p,state)===bundle10);if(state.settings.sortPrice)items.sort((a,b)=>price(a)-price(b));
    for(let i=0;i<items.length;i+=4)slides.push({type:'products',band,brand,category,bundle10,items:items.slice(i,i+4)});
   }
   }
  }
 }
 if(state.settings.closing)slides.push({type:'closing'});return slides;
}
export function restoreState(raw){
 if(!raw||raw.version!==1||!Array.isArray(raw.products)||raw.products.length>1000)throw Error('File dữ liệu không đúng định dạng hoặc vượt 1.000 sản phẩm.');
 const pageText={};if(raw.pageText&&typeof raw.pageText==='object'){for(const [key,fields] of Object.entries(raw.pageText).slice(0,1000)){if(!fields||typeof fields!=='object')continue;pageText[key.slice(0,500)]={};for(const [position,value]of Object.entries(fields).slice(0,60))if(/^\d+:\d+$/.test(position)&&typeof value==='string')pageText[key.slice(0,500)][position]=value.slice(0,2000);}}
 const d=defaultState(),products=raw.products.map(validateProduct);if(new Set(products.map(p=>p.id)).size!==products.length)throw Error('File có mã dữ liệu trùng nhau.');
 const meta={};for(const k of Object.keys(d.meta))meta[k]=String(raw.meta?.[k]??d.meta[k]).slice(0,k==='note'?500:160);
 const settings={...d.settings};for(const k of ['cover','dividers','closing','qr','regular','sortPrice','bundle10'])if(typeof raw.settings?.[k]==='boolean')settings[k]=raw.settings[k];
 settings.bundle10Ids=Array.isArray(raw.settings?.bundle10Ids)?[...new Set(raw.settings.bundle10Ids)].filter(id=>products.some(p=>p.id===id)):[];
 for(const k of ['lockDiscount','minhDiscount','fee']){const n=Number(raw.settings?.[k]??settings[k]);if(!Number.isFinite(n)||n<0||n>(k==='fee'?1e8:100))throw Error('Thiết lập giá không hợp lệ.');settings[k]=n;}
 return {version:1,customBrands:Array.isArray(raw.customBrands)?raw.customBrands.filter(b=>b&&typeof b.name==='string'&&typeof b.origin==='string').slice(0,30):[],pageText,products,selected:Array.isArray(raw.selected)?raw.selected.filter(id=>products.some(p=>p.id===id)):[],meta,settings};
}

export function slideKey(slide){return slide.type==='products'?'products:'+slide.items.map(p=>p.id).sort().join('|'):slide.type+(slide.type==='divider'?':'+slide.band:'');}
export async function mapConcurrent(items,limit,worker){let cursor=0;const results=new Array(items.length);await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const i=cursor++;results[i]=await worker(items[i],i)}}));return results;}

import {loadBarcodeLibrary} from './barcode-camera.js';
import {printSheet,resetPrintSheet} from './print-page.js';
const templates={lock:{name:'LocknLock',width:70,height:35},minhlong:{name:'Minh Long',width:70,height:50}};
const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/[^a-z0-9]/g,'');
export const retailVatPolicies=policies=>policies.filter(p=>['giabanlevat','gialevat'].includes(fold(p.name)));
export function labelLayout({width,height,margin=0}){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<45||height<30||width>210||height>297||!Number.isFinite(margin)||margin<0||margin>15)throw Error('Tem cần rộng từ 45 mm, cao từ 30 mm; lề A4 từ 0–15 mm.');
 const columns=Math.floor((210-2*margin+1e-7)/width),rows=Math.floor((297-2*margin+1e-7)/height);
 if(!columns||!rows)throw Error('Kích thước tem không vừa vùng A4 đã chọn.');
 return {columns,rows,perPage:columns*rows,width,height,margin};
}
export function priceLabelRows(products,policyId,{copies=1,qrMode='sku',origin=''}={}){
 if(!products.length||!Number.isSafeInteger(copies)||copies<1||copies>100||products.length*copies>1000)throw Error('Chọn sản phẩm; mỗi mã từ 1–100 tem, tối đa 1.000 tem/lần.');
 if(!['sku','link'].includes(qrMode))throw Error('Chọn nội dung QR hợp lệ.');
 return products.flatMap(p=>{
  const price=Array.isArray(p.prices)?p.prices.find(v=>v.policyId===policyId)?.price:p.prices?.[policyId];
  if(typeof price!=='number'||!Number.isFinite(price)||price<0)throw Error(p.sku+': chưa có Giá bán lẻ + VAT. Không in giá thay thế.');
  if(p.active===false||p.approvalStatus&&p.approvalStatus!=='approved')throw Error(p.sku+': sản phẩm không còn hoạt động hoặc chưa duyệt.');
  return Array.from({length:copies},()=>({sku:String(p.sku),name:String(p.name),price:Math.round(price),qrText:qrMode==='sku'?String(p.sku):origin+'/#/products/'+encodeURIComponent(p.sku)}));
 });
}
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const money=n=>Number(n).toLocaleString('vi-VN',{maximumFractionDigits:0});
const field=(text,input)=>{const l=el('label');l.append(el('span','',text),input);return l;};
function input(label,value,min,max){const n=el('input');n.type='number';n.value=value;n.min=min;n.max=max;n.step='any';n.setAttribute('aria-label',label);return n;}
function select(label,options){const n=el('select');n.setAttribute('aria-label',label);for(const [value,name]of options){const o=el('option','',name);o.value=value;n.append(o);}return n;}
export async function loadLabelProducts(api,skus){
 if(!skus.length||skus.length>300)throw Error('Chọn từ 1 đến 300 sản phẩm để in tem.');
 const found=new Map();let policies=[];
 for(let start=0;start<skus.length;start+=50){const data=await api('/products?'+new URLSearchParams({skus:skus.slice(start,start+50).join(',')}));
  policies=data.policies||data.pricePolicies||policies;for(const p of data.products)found.set(p.sku,p);
 }
 return {products:skus.map(sku=>{const p=found.get(sku);if(!p)throw Error(sku+': không tìm thấy sản phẩm để in.');return p;}),policies};
}
function qrImage(writer,value){
 // ZXing EncodeHintType: ERROR_CORRECTION=0, CHARACTER_SET=1, MARGIN=5.
 const svg=writer.write(value,240,240,new Map([[0,'M'],[1,'UTF-8'],[5,4]]));svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
 const bg=document.createElementNS('http://www.w3.org/2000/svg','rect');bg.setAttribute('width','100%');bg.setAttribute('height','100%');bg.setAttribute('fill','#fff');svg.prepend(bg);
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg.outerHTML);
}
function label(row,template,qr){
 const item=el('article','price-tag price-tag-'+template);item.dataset.sku=row.sku;
 const brand=el('header','price-tag-brand',template==='lock'?'LocknLock':'Minh Long');
 if(template==='minhlong')brand.append(el('span','','ĐẠI LÝ CẦN THƠ'));
 const image=el('img','price-tag-qr');image.src=qr;image.alt='QR '+row.sku;image.width=image.height=240;
 const sku=el('div','price-tag-sku',row.sku),name=el('div','price-tag-name',row.name),price=el('div','price-tag-price');
 price.append(el('small','',template==='lock'?'':'Giá bán lẻ:'),el('strong','',money(row.price)),el('span','',template==='lock'?'VND':'đ'));
 price.style.setProperty('--price-font',Math.max(11,Math.min(20,140/(money(row.price).length||1)))+'pt');
 item.append(brand,image,sku,name,price,el('div','price-tag-vat','Giá đã bao gồm VAT'));return item;
}
export function buildLabelPages(rows,template,layout,qrFor){
 if(!templates[template])throw Error('Chọn mẫu tem hợp lệ.');const pages=[];
 for(let i=0;i<rows.length;i+=layout.perPage){const page=el('section','price-label-page');page.style.setProperty('--tag-width',layout.width+'mm');page.style.setProperty('--tag-height',layout.height+'mm');page.style.setProperty('--tag-margin',layout.margin+'mm');page.style.setProperty('--tag-columns',layout.columns);
  for(const row of rows.slice(i,i+layout.perPage))page.append(label(row,template,qrFor(row.qrText)));pages.push(page);
 }return pages;
}
async function readyImages(root){await Promise.all([...root.querySelectorAll('img')].map(img=>img.decode()));}
function fitLabels(root){
 const tooLong=[];
 for(const node of root.querySelectorAll('.price-tag-name,.price-tag-sku')){
  let size=node.classList.contains('price-tag-name')?9:8;
  do{node.style.fontSize=size+'pt';if(node.scrollHeight<=node.clientHeight+1&&node.scrollWidth<=node.clientWidth+1)break;size-=0.5;}while(size>=6.5);
  if(node.scrollHeight>node.clientHeight+1||node.scrollWidth>node.clientWidth+1)tooLong.push(node.closest('[data-sku]').dataset.sku);
 }
 for(const node of root.querySelectorAll('.price-tag-price,.price-tag-brand'))if(node.scrollWidth>node.clientWidth+1||node.scrollHeight>node.clientHeight+1)tooLong.push(node.closest('[data-sku]').dataset.sku);
 if(tooLong.length)throw Error('Nội dung tem quá dài tại '+[...new Set(tooLong)].join(', ')+'. Tăng kích thước tem để in đủ chữ.');
}
/** Read-only labels. No quotation, inventory, price or approval writes. */
export async function openPriceLabels({api,skus,origin=location.origin}){
 const data=await loadLabelProducts(api,skus),policies=retailVatPolicies(data.policies);
 if(!policies.length)throw Error('Chưa có bảng giá Giá bán lẻ + VAT. Cần cấu hình đúng bảng giá trước khi in.');
 const library=await loadBarcodeLibrary(),writer=new library.BrowserQRCodeSvgWriter(),qrCache=new Map(),qrFor=value=>{if(!qrCache.has(value))qrCache.set(value,qrImage(writer,value));return qrCache.get(value);};
 const modal=el('dialog','modal price-label-dialog'),form=el('form'),head=el('div','modal-head'),body=el('div','modal-body price-label-config'),foot=el('div','modal-foot');modal.setAttribute('aria-label','In tem giá');modal.dataset.mobileActions='off';
 head.append(el('h2','','In nhanh tem giá'));const close=el('button','btn secondary','Đóng');close.type='button';close.dataset.mobileInline='';close.onclick=()=>modal.close();
 const template=select('Mẫu tem',[['lock','LocknLock'],['minhlong','Minh Long']]);template.value=data.products.every(p=>/lock/i.test(p.brand||p.name))?'lock':'minhlong';
 const policy=select('Bảng giá tem',policies.map(p=>[p.id,p.name]));if(policies.length>1){policy.prepend(Object.assign(el('option','','Chọn đúng bảng giá'),{value:''}));policy.value='';}
 const width=input('Rộng tem (mm)',templates[template.value].width,45,210),height=input('Cao tem (mm)',templates[template.value].height,30,297),margin=input('Lề A4 (mm)',0,0,15),copies=input('Số tem mỗi sản phẩm',1,1,100),qr=select('Nội dung QR',[['sku','Mã SKU (quét tìm hàng tại POS)'],['link','Link chi tiết CRM (cần đăng nhập)']]);copies.step='1';
 const controls=el('div','price-label-fields');controls.append(field('Mẫu tem',template),field('Giá bán lẻ + VAT',policy),field('Rộng tem (mm)',width),field('Cao tem (mm)',height),field('Lề A4 (mm)',margin),field('Số tem mỗi sản phẩm',copies),field('Nội dung QR',qr));
 const summary=el('p','price-label-summary'),error=el('p','error');error.setAttribute('role','alert');
 const hint=el('p','muted small','Giá lấy nguyên từ bảng bán lẻ + VAT, không cộng thuế lần nữa. Lề 0 mm cần máy in hỗ trợ sát mép; chọn 3 mm nếu máy in có lề cứng. In ở tỷ lệ 100%, tắt đầu/chân trang.');
 const frame=el('div','price-label-preview-frame'),preview=el('div','price-label-preview');frame.append(preview);
 const print=el('button','btn primary','In A4');print.type='submit';print.dataset.mobilePrimary='';foot.append(close,print);body.append(controls,summary,hint,error,frame);form.append(head,body,foot);modal.append(form);document.body.append(modal);
 let job=null,busy=false,revision=0;
 function scale(){const value=frame.clientWidth/(210*96/25.4);preview.style.transform='scale('+value+')';frame.style.height=frame.clientWidth*297/210+'px';}
 async function render(){const current=++revision;error.textContent='';print.disabled=true;job=null;try{
  if(!policy.value)throw Error('Chọn bảng Giá bán lẻ + VAT dùng cho tem.');
  const layout=labelLayout({width:Number(width.value),height:Number(height.value),margin:Number(margin.value)}),rows=priceLabelRows(data.products,policy.value,{copies:Number(copies.value),qrMode:qr.value,origin});
  const pages=buildLabelPages(rows,template.value,layout,qrFor);preview.replaceChildren(pages[0]);
  await document.fonts.ready;await readyImages(preview);if(!modal.open||current!==revision)return;fitLabels(preview);scale();
  summary.textContent=rows.length+' tem · '+layout.columns+' cột × '+layout.rows+' hàng · '+layout.perPage+' tem/A4 · '+pages.length+' tờ. Xem trước trang 1.';
  job={rows,layout,template:template.value};print.disabled=false;
 }catch(e){if(current===revision)error.textContent=e.message;}}
 template.onchange=()=>{width.value=templates[template.value].width;height.value=templates[template.value].height;render();};
 for(const control of [policy,width,height,margin,copies,qr])control.addEventListener('change',render);
 form.onsubmit=async event=>{event.preventDefault();if(!job||busy)return;busy=true;print.disabled=true;const out=document.getElementById('print-sheet');try{
  resetPrintSheet();
  out.replaceChildren(...buildLabelPages(job.rows,job.template,job.layout,qrFor));await document.fonts.ready;await readyImages(out);
  // The print host is normally hidden; measure a temporary visible offscreen layout.
  out.classList.add('price-label-measure');fitLabels(out);out.classList.remove('price-label-measure');
  printSheet({page:{size:'A4',margin:'0'},cls:'price-labels-print',title:'Tem-gia-'+templates[job.template].name,clear:true});
 }catch(e){out.classList.remove('price-label-measure');error.textContent=e.message;}finally{busy=false;print.disabled=!job;}};
 const observer=new ResizeObserver(scale);observer.observe(frame);modal.addEventListener('close',()=>{observer.disconnect();modal.remove();},{once:true});modal.showModal();await render();return modal;
}

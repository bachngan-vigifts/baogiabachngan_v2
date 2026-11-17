import {BRAND,C,slideKey,money,ranges,price,quotePrice,isBundle,selectedProducts,makeSlides} from './core.js';
export const PAGE_HEIGHT=1280*210/297, PAGE_INCH_WIDTH=297/25.4, PAGE_INCH_HEIGHT=210/25.4;
const UNIT=1280/PAGE_INCH_WIDTH;
const images=new Map();
export const imageSource=source=>source?.startsWith('data:image/')?source:source?new URL((/^https?:\/\/(?:www\.)?(?:locknlockonline|minhlongonline)\.com\//.test(source)?'api/image?url=':'api/external-image?url=')+encodeURIComponent(source),import.meta.url).href:'';
export function loadImage(source){if(!source)return Promise.resolve(null);const url=imageSource(source);if(images.has(url))return images.get(url);const pending=new Promise(resolve=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>{images.delete(url);resolve(null)};im.src=url});images.set(url,pending);return pending;}
const bgPromise=new Promise(resolve=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>resolve(null);im.src=new URL('brand.png',import.meta.url).href});
function hex(h){return h.replace('#','')}
function wrap(ctx,value,width,maxLines=99){const lines=[];for(const paragraph of String(value??'').split('\n')){let current='';for(const word of paragraph.split(/\s+/)){if(!word)continue;const candidate=current?current+' '+word:word;if(ctx.measureText(candidate).width>width&&current){lines.push(current);current=word}else current=candidate}lines.push(current)}if(lines.length>maxLines){lines.length=maxLines;while(ctx.measureText(lines.at(-1)+'…').width>width&&lines.at(-1).length)lines[lines.length-1]=lines.at(-1).slice(0,-1);lines[lines.length-1]+='…'}return lines}
function contain(im,x,y,w,h){const scale=Math.min(w/im.width,h/im.height);return {x:x+(w-im.width*scale)/2,y:y+(h-im.height*scale)/2,w:im.width*scale,h:im.height*scale}}
export async function drawSlide(canvas,slide,state,number,total,pptSlide=null,scale=1,textBoxes=null){
 const composed=!!slide.sourceState;if(composed){state=slide.sourceState;slide={...slide};delete slide.compositionId;delete slide.sourceState;}
 await document.fonts.ready;const ctx=canvas.getContext('2d');canvas.width=1280*scale;canvas.height=PAGE_HEIGHT*scale;ctx.scale(scale,scale);ctx.fillStyle='white';ctx.fillRect(0,0,1280,PAGE_HEIGHT);
 function box(x,y,w,h,fill,stroke='',radius=0){ctx.beginPath();ctx.roundRect(x,y,w,h,radius);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=.8;ctx.stroke()}if(pptSlide)pptSlide.addShape(radius?'roundRect':'rect',{x:x/UNIT,y:y/UNIT,w:w/UNIT,h:h/UNIT,rectRadius:radius/UNIT,radius:radius/UNIT,fill:{color:hex(fill)},line:{color:hex(stroke||fill),width:stroke?.6:0}});}
 function text(value,x,y,w,h,size=18,color=C.ink,bold=false,align='left',maxLines=99,positionKey=null){
  const position=positionKey??(x+':'+y),original=String(value??'');value=composed&&position==='1190:'+ (Math.round(PAGE_HEIGHT)-42)?original:state.pageText?.[slideKey(slide)]?.[position]??original;if(textBoxes)textBoxes.push({position,original,value:String(value),x,y,w,h,size,color,bold,align});
  ctx.font=`${bold?700:400} ${size}px Montserrat, Arial`;ctx.fillStyle=color;ctx.textBaseline='top';ctx.textAlign=align;
  const lineHeight=size*1.23,lines=wrap(ctx,value,w,Math.min(maxLines,Math.max(1,Math.floor(h/lineHeight))));
  lines.forEach((line,i)=>ctx.fillText(line,align==='right'?x+w:align==='center'?x+w/2:x,y+i*lineHeight));ctx.textAlign='left';
  if(pptSlide)pptSlide.addText(lines.join('\n'),{x:x/UNIT,y:y/UNIT,w:w/UNIT,h:h/UNIT,fontFace:'Montserrat',fontSize:size*72/UNIT,bold,color:hex(color),margin:0,align,breakLine:false,valign:'top',transparency:0,paraSpaceAfterPt:0,lineSpacingMultiple:1.0});
 }
 function photo(im,x,y,w,h,data){if(!im)return;const r=contain(im,x,y,w,h);ctx.drawImage(im,r.x,r.y,r.w,r.h);if(pptSlide){const c=document.createElement('canvas');c.width=im.width;c.height=im.height;c.getContext('2d').drawImage(im,0,0);pptSlide.addImage({data:data||c.toDataURL('image/png'),x:r.x/UNIT,y:r.y/UNIT,w:r.w/UNIT,h:r.h/UNIT});}}
 const dark=['cover','divider','closing'].includes(slide.type),bg=await bgPromise;
 if(dark){if(bg){ctx.drawImage(bg,0,0,1280,PAGE_HEIGHT);if(pptSlide){const c=document.createElement('canvas');c.width=1280;c.height=PAGE_HEIGHT;c.getContext('2d').drawImage(bg,0,0,1280,PAGE_HEIGHT);pptSlide.addImage({data:c.toDataURL('image/png'),x:0,y:0,w:1280/UNIT,h:PAGE_HEIGHT/UNIT});}}else box(0,0,1280,PAGE_HEIGHT,C.green);}
 function footer(){const contact=`${BRAND}   Hotline / Zalo: ${state.meta.phone}${state.meta.employee?' ('+state.meta.employee+')':''}`;text(contact,44,Math.round(PAGE_HEIGHT)-38,1060,20,11,dark?'#DCE9E3':C.muted);text(String(number).padStart(2,'0'),1190,Math.round(PAGE_HEIGHT)-42,46,25,13,dark?'#DCE9E3':C.muted,false,'right')}
 if(slide.type==='cover'){
  text(BRAND,78,100,1100,54,44,'#FFFFFF',true);text(state.meta.title||'DANH MỤC QUÀ TẶNG\nDOANH NGHIỆP',78,225,1120,158,55,'#FFFFFF',true,'left',2);
  text(state.meta.customer?'KÍNH GỬI: '+state.meta.customer:[...new Set(selectedProducts(state).map(p=>p.brand))].join(' & ').toLocaleUpperCase('vi-VN'),80,414,1100,44,26,'#D7BC7D',true);
  text(`${makeSlides(state).filter(p=>p.type==='products').reduce((n,p)=>n+p.items.length,0)} sản phẩm theo danh mục và ngân sách`,80,478,1100,35,24,'#E5EEE8');text(`${state.meta.quoteNo}   /   ${state.meta.date}`,80,566,1100,26,15,'#D6E3DC');footer();return;
 }
 if(slide.type==='divider'){
  text(BRAND,70,76,1120,45,30,'#FFFFFF',true);text('NHÓM NGÂN SÁCH 0'+(slide.band+1),70,224,1120,42,22,'#D7BC7D',true);text(ranges[slide.band],70,306,1140,92,slide.band===3?43:48,'#FFFFFF',true);text(`${slide.count} sản phẩm`,70,432,1120,45,27,'#E5EEE8');text('Phân theo thương hiệu và danh mục sản phẩm',70,514,1120,30,20,'#E5EEE8');footer();return;
 }
 if(slide.type==='closing'){
  text('TRÂN TRỌNG CẢM ƠN',78,145,1125,75,45,'#FFFFFF',true);text('CÔNG TY TNHH SX TM QUẢNG CÁO VIGIFTS',78,267,1120,47,25,'#D7BC7D',true);text(`Hotline / Zalo: ${state.meta.phone}${state.meta.employee?' ('+state.meta.employee+')':''}`,78,355,1120,45,27,'#FFFFFF',true);text('Văn phòng: W36 Đường số 9, KDC Cty 8, P. Cái Răng, TP. Cần Thơ\nCửa hàng: 50 Ngô Quyền, P. Ninh Kiều, TP. Cần Thơ',78,425,1120,75,20,'#E5EEE8');text('Tư vấn lựa chọn sản phẩm, in logo và đóng gói theo yêu cầu',78,553,1120,42,21,'#E5EEE8');footer();return;
 }
 text(BRAND,44,24,650,33,25,C.green,true);text('DANH MỤC QUÀ TẶNG DOANH NGHIỆP',44,60,800,20,12.5,C.red,true);text(ranges[slide.band],730,28,505,37,20,C.green,true,'right');text(state.meta.note,730,70,505,50,12,C.muted,false,'right',3);text((slide.category+' - '+slide.brand).toLocaleUpperCase('vi-VN'),44,108,1192,62,25,C.green,true,'left',2);
 const items=slide.items;
 if(state.settings.productsPerPage===8){
 for(let i=0;i<items.length;i++){
 const item=items[i],x=44+(i%4)*304,y=180+Math.floor(i/4)*344,bundle=isBundle(item,state);
 box(x,y,280,300,C.frame,C.line,10);
 const im=await loadImage(item.image);if(im)photo(im,x+12,y+10,256,174);else text('CHƯA CÓ ẢNH',x+12,y+80,256,20,11,C.muted,false,'center');
 if(state.settings.proposedPrice!==false){
 text(bundle?'Giá / bộ 10 SP':'Giá đề xuất',x+12,y+195,90,18,10,C.ink);
 const amount=item.priceOnRequest?'Liên hệ':(item.fromPrice?'Từ ':'')+money(quotePrice(item,state));ctx.font='700 20px Montserrat';const size=Math.min(20,20*160/Math.max(160,ctx.measureText(amount).width));text(amount,x+108,y+190,160,27,size,C.green,true,'right');
 }
 text('Mã: '+(item.sku||'—')+(item.qty>1?' / SL: '+item.qty:''),x+12,y+220,256,15,10,C.muted,false,'left',1);
 if(state.settings.regular)text('Niêm yết: '+(item.priceOnRequest?'Liên hệ':money(item.regular*(bundle?10:1))),x+12,y+237,256,14,10,C.muted,false,'left',1);
 text(item.name,x+12,y+(state.settings.regular?254:242),256,state.settings.regular?44:56,12,C.ink,true,'left',3);
 }
 }else{
 const six=state.settings.productsPerPage===6;
 for(let i=0;i<(six?6:4);i++){
  const x=44+(i%(six?3:2))*(six?405:608),y=200+Math.floor(i/(six?3:2))*324,tx=x+(six?188:258),tw=six?180:310;
  const fieldKey=dy=>six?(x+160)+':'+(y+dy):null;
  if(!items[i]&&slide.type!=='empty')continue;
  box(x,y,six?382:584,230,C.frame,C.line,10);const item=items[i];if(!item)continue;const bundle=isBundle(item,state);
  const im=await loadImage(item.image);if(im)photo(im,x+(six?10:14),y+14,six?164:226,202);else{text('CHƯA CÓ ẢNH',x+(six?10:14),y+104,six?164:226,20,11,'#9BAB9F',false,'center');}
  text(item.name,tx,y+(six?36:18),tw,six?66:72,six?12.5:item.name.length>85?15:16,C.ink,true,'left',six?4:3,fieldKey(18));
  text('Mã: '+(item.sku||'—')+(item.qty>1?'  /  SL: '+item.qty:''),tx,y+(six?116:93),six?180:218,24,six?10:12.3,C.muted,false,'left',1,fieldKey(93));
  if(state.settings.regular)text((bundle?'Niêm yết / bộ: ':item.fromPrice?'Niêm yết từ: ':'Niêm yết: ')+(item.priceOnRequest?'Liên hệ':money(item.regular*(bundle?10:1))),tx,y+(six?144:125),six?180:218,25,six?10:bundle?12:14,C.muted,false,'left',1,fieldKey(125));
  if(state.settings.proposedPrice!==false){
  text(bundle?'Giá / bộ 10 SP':'Giá đề xuất',tx,y+(six?188:176),six?70:110,24,six?10:bundle?12:14,C.ink,false,'left',1,fieldKey(165));const amount=item.priceOnRequest?'Liên hệ':(item.fromPrice?'Từ ':'')+money(quotePrice(item,state)),amountWidth=six?104:200,baseSize=six?18:23;ctx.font=`700 ${baseSize}px Montserrat, Arial`;const amountSize=Math.min(baseSize,baseSize*amountWidth/Math.max(amountWidth,ctx.measureText(amount).width));text(amount,tx+(six?76:111),y+(six?188:169),amountWidth,31,amountSize,C.green,true,six?'right':'left',1,fieldKey(188));
  }

 }
 }
 footer();
 if(pptSlide)pptSlide.addNotes(items.map(item=>`${item.name}\nMã: ${item.sku}\n${item.url}\nGiá niêm yết một SP: ${item.regular}; chiết khấu ${item.discount}%; phụ phí ${item.fee}; giá đề xuất một SP ${price(item)}. Đơn vị chào: ${isBundle(item,state)?'bộ 10 SP':'một SP'}; giá chào ${quotePrice(item,state)}; số lượng ${item.qty}.`).join('\n\n'));
}












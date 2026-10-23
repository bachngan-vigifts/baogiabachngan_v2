import {totals,discounted,after} from './quote-math.js';
const money=n=>Math.round(Number(n)||0).toLocaleString('vi-VN')+' đ';
const num=n=>Number(n||0).toLocaleString('vi-VN');
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')?s.split('-').reverse().join('/'):'';
const GREEN='#168454',INK='#131b28',MUTED='#6b7280',LINE='#e5e7eb';
/** Explicit customer-facing projection. Never spread a quote/row into the exported model. */
export function quoteCaptureModel(doc){
 const rows=(doc.rows||[]).filter(r=>Number(r.qty)>0).map(r=>({name:String(r.name||r.sku||'Sản phẩm'),sku:String(r.sku||''),unit:String(r.unit||''),qty:Number(r.qty),price:Number(r.price)||0,
  discount:Math.max(0,((Number(r.price)||0)-discounted(r))*Number(r.qty)),discountLabel:Number(r.discount)>0?(r.discountType==='amount'?'−'+money(((Number(r.price)||0)-discounted(r))*Number(r.qty)):'−'+num(r.discount)+'%'):'',
  unitAfterDiscount:discounted(r),printFee:doc.type==='HRC'?0:Number(r.printFee)||0,amount:after(r,doc)*Number(r.qty)}));
 if(!rows.length)throw Error('Thêm ít nhất một sản phẩm có số lượng trước khi chụp báo giá.');
 const t=totals(doc),gross=rows.reduce((s,r)=>s+(r.price+r.printFee)*r.qty,0);
 const validity=String(doc.notes||'').match(/hiệu lực[^\n.]*?(\d+)\s*ngày/i);
 let validUntil='';
 if(validity&&date(doc.date)){const d=new Date(doc.date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+Number(validity[1]));if(Number.isFinite(d.getTime()))validUntil=date(d.toISOString().slice(0,10));}
 return{quoteNo:String(doc.quoteNo||'Báo giá'),date:date(doc.date),customer:String(doc.customer||'Chưa chọn khách hàng'),phone:String(doc.phone||''),brand:doc.type==='VIGIFTS'?'VG':'BN',validUntil,rows,subtotal:t.subtotal,gross,discount:Math.max(0,Math.round(gross-t.subtotal)),tax:t.tax,taxLabel:t.label,total:t.total};
}
/** Layout is shared by the preview and PNG. All text stays text until rasterization. */
export function quoteCapturePages(model,width,measure,maxHeight=1600){
 const pad=16,right=width-pad,content=width-pad*2,pages=[];let page,y;
 const text=(s,x,top,size=13,bold=false,color=INK,align='left')=>page.ops.push({kind:'text',text:String(s),x,y:top,size,bold,color,align});
 const rect=(x,top,w,h,color,radius=0)=>page.ops.push({kind:'rect',x,y:top,w,h,color,radius});
 const line=top=>rect(pad,top,content,1,LINE);
 const wrap=(s,size,bold,max)=>{const out=[];let current='';for(const word of String(s).split(/\s+/)){if(!word)continue;if(measure((current?current+' ':'')+word,size,bold)<=max){current+=(current?' ':'')+word;continue;}if(current){out.push(current);current='';}for(const ch of word){if(current&&measure(current+ch,size,bold)>max){out.push(current);current='';}current+=ch;}}if(current)out.push(current);return out.length?out:[''];};
 const paragraph=(s,top,size,bold,color,max=content,x=pad)=>{for(const row of wrap(s,size,bold,max)){text(row,x,top,size,bold,color);top+=size*1.5;}return top;};
 function begin(){
  page={ops:[],height:0};pages.push(page);rect(0,0,width,1600,'#fff');
  rect(pad,16,32,32,'#f0f2f4',8);text(model.brand,pad+16,25,12,true,MUTED,'center');text('Báo giá',pad+42,19,16,true);
  const headerRightWidth=Math.max(80,content-42-measure('Báo giá',16,true)-12);
  y=18;for(const row of wrap(model.quoteNo,12,true,headerRightWidth)){text(row,right,y,12,true,INK,'right');y+=17;}
  if(model.date){text(model.date,right,y+2,12,false,MUTED,'right');y+=19;}
  y=Math.max(62,y+10);line(y);y+=12;
  text('KHÁCH HÀNG',pad,y,12,true,MUTED);y=paragraph(model.customer,y+19,14,true,INK);
  if(model.phone)y=paragraph(model.phone,y+1,12,false,MUTED);
  if(model.validUntil){const label='Hiệu lực đến '+model.validUntil,w=Math.min(content,measure(label,12,true)+16);rect(pad,y+4,w,24,'#e7f5ee',12);text(label,pad+8,y+8,12,true,GREEN);y+=33;}
  y+=8;line(y);y+=12;text('SẢN PHẨM · '+model.rows.length,pad,y,12,true,MUTED);y+=23;
 }
 function finish(){page.height=Math.ceil(y+20);page.ops[0].h=page.height;}
 begin();
 for(const row of model.rows){
  const names=wrap(row.name,14,true,content),skus=row.sku?wrap('SKU '+row.sku,12,false,content):[];
  const amount=money(row.amount),detailWidth=Math.max(48,content-measure(amount,14,true)-12);
  const base=`${num(row.qty)} × ${money(row.price)}`,badgeWidth=row.discountLabel?measure(row.discountLabel,12,true)+12:0;
  const inlineBadge=!!row.discountLabel&&measure(base,12,false)+8+badgeWidth<=detailWidth;
  const details=wrap(base+(row.discountLabel&&!inlineBadge?' ('+row.discountLabel+')':''),12,false,detailWidth);
  const unitLines=wrap('Đơn giá sau CK: '+money(row.unitAfterDiscount),12,true,content);
  const printLines=row.printFee?wrap('Phí in: +'+money(row.printFee)+'/sp',12,false,content):[];
  const height=names.length*19+skus.length*16+details.length*18+unitLines.length*17+printLines.length*17+16;
  if(y+height+20>maxHeight&&y>400){finish();begin();}
  for(const name of names){text(name,pad,y,14,true);y+=19;}
  for(const sku of skus){text(sku,pad,y,12,false,MUTED);y+=16;}
  y+=3;const detailTop=y;
  for(const detail of details){text(detail,pad,y,12,false,MUTED);y+=18;}
  if(inlineBadge){const x=pad+measure(base,12,false)+8;rect(x,detailTop-2,badgeWidth,19,'#e7f5ee',9);text(row.discountLabel,x+6,detailTop+1,12,true,GREEN);}
  text(amount,right,detailTop,14,true,INK,'right');
  for(const unit of unitLines){text(unit,pad,y,12,true,GREEN);y+=17;}
  for(const printing of printLines){text(printing,pad,y,12,false,MUTED);y+=17;}
  y+=4;line(y);y+=9;
 }
 // Keep the three requested totals together on the last image, including zero VAT.
 if(y+140>maxHeight){finish();begin();}
 const totalRow=(label,value)=>{text(label,pad,y,13,false,MUTED);text(value,right,y,13,false,INK,'right');y+=25;};
 y+=4;totalRow('Tổng thành tiền',money(model.subtotal));totalRow('Tiền VAT',money(model.tax));line(y);y+=12;
 if(measure('Tổng thanh toán',14,true)+measure(money(model.total),18,true)+12>content){text('Tổng thanh toán',pad,y,14,true,INK);y+=23;text(money(model.total),right,y,18,true,GREEN,'right');y+=28;}
 else{text('Tổng thanh toán',pad,y+2,14,true,INK);text(money(model.total),right,y,18,true,GREEN,'right');y+=29;}
 if(model.tax>0)y=paragraph('Đơn giá và thành tiền dòng chưa VAT.',y+2,12,false,MUTED);
 finish();
 pages.forEach((p,i)=>{if(pages.length>1){p.ops.push({kind:'text',text:`Trang ${i+1}/${pages.length}`,x:right,y:p.height-18,size:13,bold:false,color:MUTED,align:'right'});p.height+=10;p.ops[0].h=p.height;}});
 return pages;
}
export async function openMobileQuoteCapture({doc,canExport=()=>null}){
 const model=quoteCaptureModel(doc),dialog=document.createElement('dialog');dialog.className='quote-capture-dialog';dialog.setAttribute('aria-label','Chụp báo giá');
 const gallery=document.createElement('div');gallery.className='quote-capture-gallery';const footer=document.createElement('div');footer.className='quote-capture-actions';
 const close=document.createElement('button');close.type='button';close.className='btn secondary';close.textContent='Đóng';close.onclick=()=>dialog.close();
 const share=document.createElement('button');share.type='button';share.className='btn primary';share.textContent='Chụp / Chia sẻ';share.disabled=true;
 const error=document.createElement('p');error.className='quote-capture-error';error.setAttribute('role','alert');const hint=document.createElement('p');hint.className='quote-capture-hint';hint.textContent='Đang chuẩn bị ảnh…';
 footer.append(close,share);dialog.append(hint,gallery,error,footer);document.body.append(dialog);dialog.showModal();
 const urls=[],files=[];let closed=false;
 dialog.addEventListener('close',()=>{closed=true;urls.forEach(url=>URL.revokeObjectURL(url));dialog.remove();},{once:true});
 try{
  await document.fonts.ready;if(closed)return;
  const width=Math.max(280,Math.min(390,dialog.clientWidth)),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw Error('Trình duyệt chưa hỗ trợ tạo ảnh báo giá.');
  const font=(size,bold)=>`${bold?700:400} ${size}px "Be Vietnam Pro", sans-serif`;
  const pages=quoteCapturePages(model,width,(s,size,bold)=>{ctx.font=font(size,bold);return ctx.measureText(s).width;});
  for(const [i,page] of pages.entries()){
   if(closed)return;canvas.width=width*2;canvas.height=page.height*2;ctx.setTransform(2,0,0,2,0,0);ctx.textBaseline='top';
   for(const op of page.ops){ctx.fillStyle=op.color;if(op.kind==='text'){ctx.font=font(op.size,op.bold);ctx.textAlign=op.align;ctx.fillText(op.text,op.x,op.y);}else{ctx.beginPath();if(ctx.roundRect)ctx.roundRect(op.x,op.y,op.w,op.h,op.radius);else ctx.rect(op.x,op.y,op.w,op.h);ctx.fill();}}
   const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Không tạo được ảnh. Vui lòng thử lại.')),'image/png'));
   if(closed)return;
   const name=(model.quoteNo.replace(/[^\p{L}\p{N}_-]/gu,'_')||'Bao_gia')+(pages.length>1?`_${i+1}`:'')+'.png',url=URL.createObjectURL(blob);urls.push(url);files.push(new File([blob],name,{type:'image/png'}));
   const section=document.createElement('section'),image=document.createElement('img');image.src=url;image.loading='lazy';image.alt=`${model.quoteNo} – ${model.customer} – trang ${i+1}/${pages.length}. Thành tiền ${money(model.total)}.`;image.width=width;image.height=page.height;
   const download=document.createElement('a');download.href=url;download.download=name;download.textContent=pages.length>1?`Tải ảnh ${i+1}/${pages.length}`:'Tải ảnh PNG';download.className='quote-capture-download';section.append(image,download);gallery.append(section);
  }
  canvas.width=canvas.height=1;hint.textContent=files.length>1?`${files.length} ảnh — đã giữ đủ sản phẩm. Cuộn để xem tất cả.`:'Ảnh chỉ gồm thông tin gửi khách.';share.disabled=false;
  share.onclick=async()=>{
   error.textContent='';const block=canExport();if(block){error.textContent=block;return;}
   try{if(navigator.share&&navigator.canShare?.({files})){await navigator.share({files,title:model.quoteNo});}else{gallery.querySelector('a').click();if(files.length>1)hint.textContent='Dùng các nút Tải ảnh bên dưới từng trang để lưu đủ báo giá.';}}
   catch(e){if(e.name!=='AbortError')error.textContent='Chưa chia sẻ được. Anh/chị có thể bấm Tải ảnh PNG bên dưới bản xem.';}
  };
 }catch(e){if(!closed){hint.textContent='';error.textContent=e.message||'Chưa tạo được ảnh báo giá.';}}
}

import {totals,discounted,after} from './quote-math.js';
const money=n=>Math.round(Number(n)||0).toLocaleString('vi-VN')+' đ';
const num=n=>Number(n||0).toLocaleString('vi-VN');
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')?s.split('-').reverse().join('/'):'';
const GREEN='#168454',INK='#131b28',MUTED='#6b7280',LINE='#e5e7eb';
/** Explicit customer-facing projection. Never spread a quote/row into the exported model. */
export function quoteCaptureModel(doc){
 const rows=(doc.rows||[]).filter(r=>Number(r.qty)>0).map(r=>({name:String(r.name||r.sku||'Sản phẩm'),sku:String(r.sku||''),unit:String(r.unit||''),qty:Number(r.qty),price:Number(r.price)||0,
  discount:Math.max(0,((Number(r.price)||0)-discounted(r))*Number(r.qty)),discountLabel:Number(r.discount)>0?(r.discountType==='amount'?'−'+money(((Number(r.price)||0)-discounted(r))*Number(r.qty)):'−'+num(r.discount)+'%'):'',
  printFee:doc.type==='HRC'?0:Number(r.printFee)||0,amount:after(r,doc)*Number(r.qty)}));
 if(!rows.length)throw Error('Thêm ít nhất một sản phẩm có số lượng trước khi chụp báo giá.');
 const t=totals(doc),gross=rows.reduce((s,r)=>s+(r.price+r.printFee)*r.qty,0);
 const validity=String(doc.notes||'').match(/hiệu lực[^\n.]*?(\d+)\s*ngày/i);
 let validUntil='';
 if(validity&&date(doc.date)){const d=new Date(doc.date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+Number(validity[1]));if(Number.isFinite(d.getTime()))validUntil=date(d.toISOString().slice(0,10));}
 return{quoteNo:String(doc.quoteNo||'Báo giá'),date:date(doc.date),customer:String(doc.customer||'Chưa chọn khách hàng'),phone:String(doc.phone||''),brand:doc.type==='VIGIFTS'?'VG':'BN',validUntil,rows,gross,discount:Math.max(0,Math.round(gross-t.subtotal)),tax:t.tax,taxLabel:t.label,total:t.total};
}
/** Layout is shared by the preview and PNG. All text stays text until rasterization. */
export function quoteCapturePages(model,width,measure,maxHeight=1600){
 const pad=20,right=width-pad,content=width-pad*2,pages=[];let page,y;
 const text=(s,x,top,size=13,bold=false,color=INK,align='left')=>page.ops.push({kind:'text',text:String(s),x,y:top,size,bold,color,align});
 const rect=(x,top,w,h,color,radius=0)=>page.ops.push({kind:'rect',x,y:top,w,h,color,radius});
 const line=top=>rect(pad,top,content,1,LINE);
 const wrap=(s,size,bold,max)=>{const out=[];let current='';for(const word of String(s).split(/\s+/)){if(!word)continue;if(measure((current?current+' ':'')+word,size,bold)<=max){current+=(current?' ':'')+word;continue;}if(current){out.push(current);current='';}for(const ch of word){if(current&&measure(current+ch,size,bold)>max){out.push(current);current='';}current+=ch;}}if(current)out.push(current);return out.length?out:[''];};
 const paragraph=(s,top,size,bold,color,max=content,x=pad)=>{for(const row of wrap(s,size,bold,max)){text(row,x,top,size,bold,color);top+=size*1.5;}return top;};
 function begin(){page={ops:[],height:0};pages.push(page);rect(0,0,width,1600,'#fff');rect(pad,20,40,40,'#f0f2f4',10);text(model.brand,pad+20,31,13,true,MUTED,'center');text('Báo giá',70,20,18,true);
  y=paragraph(model.quoteNo,50,13,true,INK,content-50,70);if(model.date)y=paragraph(model.date,y+2,13,false,MUTED,content-50,70);y=Math.max(82,y+12);line(y);y+=18;
  text('KHÁCH HÀNG',pad,y,13,true,MUTED);y=paragraph(model.customer,y+23,16,true,INK);if(model.phone)y=paragraph(model.phone,y+3,13,false,MUTED);
  if(model.validUntil){const label='Hiệu lực đến '+model.validUntil,w=Math.min(content,measure(label,13,true)+20);rect(pad,y+6,w,28,'#e7f5ee',14);text(label,pad+10,y+11,13,true,GREEN);y+=42;}
  y+=12;line(y);y+=20;text('SẢN PHẨM · '+model.rows.length,pad,y,13,true,MUTED);y+=27;
 }
 function finish(){page.height=Math.ceil(y+30);page.ops[0].h=page.height;}
 begin();
 for(const row of model.rows){
  const names=wrap(row.name,15,true,content),details=wrap(`${num(row.qty)} × ${money(row.price)}`,13,false,content),extra=row.printFee?23:0;
  const height=names.length*23+(row.sku?22:0)+details.length*20+(row.discountLabel?30:0)+extra+44;
  if(y+height+30>maxHeight&&y>500){finish();begin();}
  for(const name of names){text(name,pad,y,15,true);y+=23;}
  if(row.sku){y=paragraph('SKU '+row.sku,y,13,false,MUTED);y+=3;}
  for(const detail of details){text(detail,pad,y,13,false,MUTED);y+=20;}
  if(row.discountLabel){const w=Math.min(content,measure(row.discountLabel,13,true)+20);rect(pad,y+2,w,26,'#e7f5ee',13);text(row.discountLabel,pad+10,y+6,13,true,GREEN);y+=32;}
  if(row.printFee){text('Phí in: +'+money(row.printFee)+'/sp',pad,y,13,false,MUTED);y+=23;}
  text(money(row.amount),right,y,16,true,INK,'right');y+=31;line(y);y+=17;
 }
 if(y+185>maxHeight){finish();begin();}
 const totalRow=(label,value,bold=false,color=MUTED,size=13)=>{text(label,pad,y,size,bold,color);text(value,right,y,size,bold,color,'right');y+=size*1.5+10;};
 y+=5;totalRow('Tạm tính',money(model.gross));if(model.discount>0)totalRow('Chiết khấu','−'+money(model.discount));if(model.tax>0)totalRow('VAT',money(model.tax));line(y);y+=18;
 if(measure('Thành tiền',16,true)+measure(money(model.total),22,true)+14>content){text('Thành tiền',pad,y,16,true,INK);y+=29;text(money(model.total),right,y,22,true,GREEN,'right');y+=41;}else{text('Thành tiền',pad,y+4,16,true,INK);text(money(model.total),right,y,22,true,GREEN,'right');y+=41;}
 if(model.tax>0){y=paragraph('Đơn giá và thành tiền dòng chưa VAT.',y+2,13,false,MUTED);}
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

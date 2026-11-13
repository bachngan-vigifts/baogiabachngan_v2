/** Local-only OCR. All executable/model assets are pinned and served by this CRM. */
const base=new URL('./vendor/ocr-6.0.1/',import.meta.url).href;
const engineUrl=new URL('./vendor/ocr-6.0.1/tesseract.min.js',import.meta.url).href;
const workerUrl=new URL('./vendor/ocr-6.0.1/worker.min.js',import.meta.url).href;
let engine;
function loadEngine(){return engine||=(new Promise((resolve,reject)=>{
 const script=document.createElement('script');script.src=engineUrl;
 const fail=()=>{clearTimeout(timer);script.remove();engine=null;reject(Error('Không tải được bộ đọc ảnh. Kiểm tra mạng rồi thử lại.'));};const timer=setTimeout(fail,20000);script.onload=()=>{clearTimeout(timer);resolve(globalThis.Tesseract);};script.onerror=fail;document.head.append(script);
}));}
function adaptiveInk(data,w,h){
 const dark=new Uint8Array(w*h),gray=new Uint8Array(w*h),integral=new Uint32Array((w+1)*(h+1));
 for(let y=0;y<h;y++){let sum=0;for(let x=0;x<w;x++){const i=y*w+x;gray[i]=Math.round(data[i*4]*0.299+data[i*4+1]*0.587+data[i*4+2]*0.114);sum+=gray[i];integral[(y+1)*(w+1)+x+1]=integral[y*(w+1)+x+1]+sum;}}
 const radius=Math.max(12,Math.round(w/160));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const x0=Math.max(0,x-radius),x1=Math.min(w,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(h,y+radius+1);const mean=(integral[y1*(w+1)+x1]-integral[y0*(w+1)+x1]-integral[y1*(w+1)+x0]+integral[y0*(w+1)+x0])/((x1-x0)*(y1-y0));dark[y*w+x]=gray[y*w+x]<mean-12?1:0;}
 return dark;
}
/** Projection of local dark strokes estimates small camera tilt; no cloud service or document upload. */
function deskewCanvas(canvas){
 const small=document.createElement('canvas'),scale=Math.min(1,900/Math.max(canvas.width,canvas.height));small.width=Math.round(canvas.width*scale);small.height=Math.round(canvas.height*scale);const ctx=small.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0,small.width,small.height);
 const w=small.width,h=small.height,ink=adaptiveInk(ctx.getImageData(0,0,w,h).data,w,h),points=[];
 for(let y=2;y<h-2;y+=2)for(let x=2;x<w-2;x+=2)if(ink[y*w+x])points.push([x-w/2,y]);
 const score=angle=>{const bins=new Uint32Array(h+w),t=Math.tan(angle*Math.PI/180);for(const [x,y]of points){const row=Math.round(y-t*x)+Math.floor(w/2);if(row>=0&&row<bins.length)bins[row]++;}let sum=0;for(const n of bins)sum+=n*n;return sum;};
 const original=score(0);let best=0,bestScore=original;
 for(let a=-6;a<=6;a+=0.5){const s=score(a);if(s>bestScore){bestScore=s;best=a;}}
 const coarse=best;for(let a=coarse-0.4;a<=coarse+0.4;a+=0.1){const s=score(a);if(s>bestScore){bestScore=s;best=a;}}
 small.width=small.height=0;
 if(Math.abs(best)<0.15||bestScore<original*1.04)return {canvas,angle:0};
 const r=-best*Math.PI/180,out=document.createElement('canvas');out.width=Math.ceil(Math.abs(canvas.width*Math.cos(r))+Math.abs(canvas.height*Math.sin(r)));out.height=Math.ceil(Math.abs(canvas.height*Math.cos(r))+Math.abs(canvas.width*Math.sin(r)));const output=out.getContext('2d');output.fillStyle='#fff';output.fillRect(0,0,out.width,out.height);output.translate(out.width/2,out.height/2);output.rotate(r);output.drawImage(canvas,-canvas.width/2,-canvas.height/2);return {canvas:out,angle:best};
}
/** Remove long straight table rules, leaving short character strokes/underscores intact. Local pixels only. */
function removeTableRules(canvas){
 const ctx=canvas.getContext('2d',{willReadFrequently:true}),image=ctx.getImageData(0,0,canvas.width,canvas.height),{data}=image,w=canvas.width,h=canvas.height;
 const dark=adaptiveInk(data,w,h),erase=new Uint8Array(w*h);
 const horizontal=Math.max(100,Math.floor(w*0.15)),vertical=Math.max(100,Math.floor(h*0.12));
 for(let y=0;y<h;y++){let start=-1;for(let x=0;x<=w;x++){if(x<w&&dark[y*w+x]){if(start<0)start=x;}else if(start>=0){if(x-start>=horizontal)for(let k=start;k<x;k++)erase[y*w+k]=1;start=-1;}}}
 for(let x=0;x<w;x++){let start=-1;for(let y=0;y<=h;y++){if(y<h&&dark[y*w+x]){if(start<0)start=y;}else if(start>=0){if(y-start>=vertical)for(let k=start;k<y;k++)erase[k*w+x]=1;start=-1;}}}
 // Adaptive black/white conversion prevents a shaded half-sheet becoming one dark OCR blob.
 for(let i=0;i<dark.length;i++)data[i*4]=data[i*4+1]=data[i*4+2]=dark[i]?0:255;
 for(let i=0;i<erase.length;i++)if(erase[i])for(const d of [-w,0,w,-1,1]){const j=i+d;if(j>=0&&j<erase.length)data[j*4]=data[j*4+1]=data[j*4+2]=255;}
 ctx.putImageData(image,0,0);
}
export async function recognizeEarlyPhoto(file,{progress=()=>{},signal,orientation='auto'}={}){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024||!file.size)throw Error('Chọn ảnh JPG, PNG hoặc WebP tối đa 10 MB. HEIC: đổi sang JPG trước.');
 if(signal?.aborted)throw Error('Đã dừng đọc ảnh.');
 const bitmap=await createImageBitmap(file);let canvas;
 try{
  if(bitmap.width*bitmap.height>24000000||Math.min(bitmap.width,bitmap.height)<100)throw Error('Ảnh quá lớn hoặc quá nhỏ. Chọn ảnh rõ, tối đa 24 triệu điểm ảnh.');
  const scale=Math.min(3,3600/Math.max(bitmap.width,bitmap.height));canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
 }finally{bitmap.close();}
 const T=await new Promise((resolve,reject)=>{const abort=()=>reject(Error('Đã dừng đọc ảnh.'));if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});loadEngine().then(resolve,reject).finally(()=>signal?.removeEventListener('abort',abort));});if(signal?.aborted)throw Error('Đã dừng đọc ảnh.');
 let worker,stopped=false,rejectStop;const stoppedPromise=new Promise((_,reject)=>{rejectStop=reject;});const stop=()=>{stopped=true;worker?.terminate();rejectStop(Error('Đọc ảnh đã dừng hoặc quá 2 phút. Chụp phần bảng rõ hơn rồi thử lại.'));};signal?.addEventListener('abort',stop,{once:true});const timeout=setTimeout(stop,120000);
 try{
  return await Promise.race([stoppedPromise,(async()=>{
  worker=await T.createWorker('vie+eng',1,{workerPath:workerUrl,corePath:base,langPath:base,workerBlobURL:false,logger:m=>progress(m.status==='recognizing text'?'Đang đọc chữ '+Math.round(m.progress*100)+'%':'Đang chuẩn bị bộ đọc ảnh…')});
  if(stopped||signal?.aborted){await worker.terminate();throw Error('Đã dừng đọc ảnh.');}
  await worker.setParameters({preserve_interword_spaces:'1',tessedit_pageseg_mode:'11'});
  const angles=orientation==='auto'?[0,90,270,180]:[Number(orientation)];
  if(angles.some(a=>![0,90,180,270].includes(a)))throw Error('Hướng ảnh không hợp lệ.');
  let best=null,bestScore=-1;
  for(const angle of angles){
   if(stopped||signal?.aborted)throw Error('Đã dừng đọc ảnh.');progress('Đang đọc ảnh · hướng '+angle+'°…');
   const rotated=document.createElement('canvas');rotated.width=angle%180?canvas.height:canvas.width;rotated.height=angle%180?canvas.width:canvas.height;
   const ctx=rotated.getContext('2d');ctx.translate(rotated.width/2,rotated.height/2);ctx.rotate(angle*Math.PI/180);ctx.drawImage(canvas,-canvas.width/2,-canvas.height/2);
   const straight=deskewCanvas(rotated);removeTableRules(straight.canvas);
   let data;try{data=(await worker.recognize(straight.canvas,{}, {text:true,blocks:true})).data;}finally{straight.canvas.width=straight.canvas.height=0;rotated.width=rotated.height=0;}
   const extracted=extractEarlyPhotoRows(data),score=extracted.rows.filter(r=>r.quantity!=='').length;
   if(score>bestScore){best={...data,orientationDegrees:angle,deskewDegrees:straight.angle};bestScore=score;}
   if(score>0)return best;
  }
  return best;

  })()]);
 }catch(e){if(stopped)throw Error('Đọc ảnh đã dừng hoặc quá 2 phút. Chụp phần bảng rõ hơn rồi thử lại.');throw e;}
 finally{clearTimeout(timeout);signal?.removeEventListener('abort',stop);await worker?.terminate();canvas.width=canvas.height=0;}
}
const fold=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/[^a-z0-9]/g,'');
/** Sparse OCR often emits one block per table cell. Reconstruct physical rows before reading columns. */
function photoLines(data){
 const original=(data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[]));
 const words=original.flatMap(l=>l.words||[]).filter(w=>w.bbox&&String(w.text||'').trim());
 const rows=[];for(const w of words.sort((a,b)=>(a.bbox.y0+a.bbox.y1)-(b.bbox.y0+b.bbox.y1))){
  const cy=(w.bbox.y0+w.bbox.y1)/2,h=w.bbox.y1-w.bbox.y0;let row=rows.find(r=>Math.abs(r.cy-cy)<=Math.max(4,Math.min(r.h,h)*0.55));
  if(!row){row={cy,h,words:[]};rows.push(row);}row.words.push(w);
 }
 return rows.map(r=>{const words=r.words.sort((a,b)=>a.bbox.x0-b.bbox.x0);return {words,text:words.map(w=>w.text).join(' '),bbox:{y0:Math.min(...words.map(w=>w.bbox.y0)),y1:Math.max(...words.map(w=>w.bbox.y1))}};});
}
const referenceLabels={orderNo:['sodonmuacrm','sodoncrm','madoncrm','dmh'],supplierOrderNo:['donncc','sodonncc','sodoncuancc','madonncc'],pxkNo:['sopxk','pxk','sophieuxuatkho'],orderReference:['sodonhang','madonhang','sodon','madon','donhang','sodh']};
export function extractPhotoReferences(lines){
 const values=Object.fromEntries(Object.keys(referenceLabels).map(k=>[k,new Set()]));
 for(const line of lines){
  const text=(line.text||(line.words||[]).map(w=>w.text).join(' ')).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d');
  const re=/(?:^|\s)((?:So|Ma)\s+(?:don\s+mua\s+CRM|don\s+CRM|don\s+(?:cua\s+)?NCC|don\s+hang|don|PXK|phieu\s+xuat\s+kho)|PXK|DMH|Don\s+hang|So\s+DH)(?:\s*[:#]\s*|\s+)([A-Za-z0-9][A-Za-z0-9._/-]{0,199})(?=\s|$)/gi;
  for(const match of text.matchAll(re)){const key=Object.keys(referenceLabels).find(k=>referenceLabels[k].includes(fold(match[1])));if(key&&/[0-9]/.test(match[2])){const tail=text.slice(match.index+match[0].length),suffix=/^\s+([0-9]{1,6})(?=\s|$)/.exec(tail);values[key].add(match[2]+(suffix?' '+suffix[1]:''));}}
 }
 const document={},conflicts=[];for(const [key,set]of Object.entries(values)){document[key]=set.size===1?[...set][0]:'';if(set.size>1)conflicts.push(key);}
 const uncertain=Object.keys(document).filter(key=>/\s/.test(document[key]));return {document,conflicts,uncertain};
}
const columnLabels={sku:['mahang','maso','mas6','mas0','masp','mavt','sku','masanpham'],qty:['soluong','sl','slxuat','slxin','slgiao','slglao','slgia0'],ignore:['stt','tenhang','tensanpham','dvt','donvitinh','bo','hoavan','loai','dongia','thanhtien','ctxuatkho','ghichu'],...referenceLabels};
function headerCells(words){
 const cells=[];
 for(let i=0;i<words.length;i++){
  let match=null;
  for(let n=1;n<=5&&i+n<=words.length;n++){const part=words.slice(i,i+n),label=fold(part.map(w=>w.text).join(' ')),kind=Object.keys(columnLabels).find(k=>columnLabels[k].includes(label));if(kind)match={kind,label,n,x:part[0].bbox.x0,end:part.at(-1).bbox.x1};}
  if(match){cells.push(match);i+=match.n-1;}else cells.push({kind:'ignore',x:words[i].bbox.x0,end:words[i].bbox.x1});
 }
 return cells.sort((a,b)=>a.x-b.x).map((c,i,all)=>({...c,left:i?((all[i-1].x+all[i-1].end)/2+(c.x+c.end)/2)/2:-Infinity,right:i<all.length-1?((all[i+1].x+all[i+1].end)/2+(c.x+c.end)/2)/2:Infinity}));
}
const tokenText=w=>String(w.text||'').replace(/^[|¦]+|[|¦]+$/g,'');
export function photoQuantity(text){const t=String(text).trim();if(/^\d+$/.test(t))return t;if(/^\d{1,3}([,.]\d{3})+$/.test(t))return t.replace(/[,.]/g,'');return '';}
/** Header words may be centred and values right-aligned. Assign by word centre, not header's left edge. */
export function extractEarlyPhotoRows(data){
 const lines=photoLines(data);const references=extractPhotoReferences(lines);let cells=null,headerY=0;
 for(const line of lines){const possible=headerCells(line.words||[]),skus=possible.filter(c=>c.kind==='sku'),qty=possible.filter(c=>c.kind==='qty');
  if(skus.length===1&&qty.length===1){cells=possible;headerY=line.bbox?.y1||line.words?.[0]?.bbox.y1||0;break;}
 }
 if(!cells)return {rows:[],...references,message:'Không xác định chắc chắn cột Mã hàng/Mã số và Số lượng/SL giao. Thử đổi hướng ảnh hoặc chụp rõ phần bảng; có thể nhập/sửa dòng bên dưới.'};
 const at=(words,key)=>{const matching=cells.filter(c=>c.kind===key);if(matching.length!==1)return [];const c=matching[0];return words.filter(w=>{const mid=(w.bbox.x0+w.bbox.x1)/2;return mid>=c.left&&mid<c.right;}).map(w=>({...w,text:tokenText(w)})).filter(w=>w.text&&w.text!=='|'&&w.text!=='¦');};
 const rows=[];
 for(const line of lines){const words=line.words||[];if((line.bbox?.y0??words[0]?.bbox.y0??0)<=headerY)continue;if(/^(tongslgiao|tongsoluong|tongcong)/.test(fold(line.text)))break;
  const code=at(words,'sku').filter(w=>/[0-9]/.test(w.text)&&/^[A-Za-z0-9][A-Za-z0-9._/-]{1,99}$/.test(w.text)),quantities=at(words,'qty');
  if(code.length!==1)continue;
  const refs={};for(const key of Object.keys(referenceLabels)){if(!cells.some(c=>c.kind===key))continue;const tokens=at(words,key);refs[key]=tokens.length===1&&/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(tokens[0].text)?tokens[0].text:'';}
  rows.push({sku:code[0].text,quantity:quantities.length===1?photoQuantity(quantities[0].text):'',...refs,confidence:Math.min(code[0].confidence??0,quantities[0]?.confidence??0)});
  if(rows.length>300)throw Error('Ảnh vượt 300 dòng. Tách ảnh thành nhiều phiếu.');
 }
 return {rows,...references,message:(rows.length?'Đã đọc '+rows.length+' dòng đề xuất. Bắt buộc so lại ảnh, mã hàng, số lượng, số đơn và số PXK.':'Không đọc được dòng chắc chắn; thử đổi hướng ảnh hoặc nhập lại từ ảnh ở bảng bên dưới.')+(references.conflicts.length?' Có số chứng từ mâu thuẫn: cần nhập lại, không tự chọn một số.':'')+(references.uncertain.length?' Số chứng từ bị tách ký tự: cần kiểm tra và nhập lại đầy đủ.':'')};
}

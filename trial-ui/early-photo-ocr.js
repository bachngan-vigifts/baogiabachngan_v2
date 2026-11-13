/** Local-only OCR. All executable/model assets are pinned and served by this CRM. */
const base=new URL('./vendor/ocr-6.0.1/',import.meta.url).href;
let engine;
function loadEngine(){return engine||=(new Promise((resolve,reject)=>{
 const script=document.createElement('script');script.src=base+'tesseract.min.js';
 const fail=()=>{clearTimeout(timer);script.remove();engine=null;reject(Error('Không tải được bộ đọc ảnh. Kiểm tra mạng rồi thử lại.'));};const timer=setTimeout(fail,20000);script.onload=()=>{clearTimeout(timer);resolve(globalThis.Tesseract);};script.onerror=fail;document.head.append(script);
}));}
export async function recognizeEarlyPhoto(file,{progress=()=>{},signal}={}){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024||!file.size)throw Error('Chọn ảnh JPG, PNG hoặc WebP tối đa 10 MB. HEIC: đổi sang JPG trước.');
 if(signal?.aborted)throw Error('Đã dừng đọc ảnh.');
 const bitmap=await createImageBitmap(file);let canvas;
 try{
  if(bitmap.width*bitmap.height>24000000||Math.min(bitmap.width,bitmap.height)<100)throw Error('Ảnh quá lớn hoặc quá nhỏ. Chọn ảnh rõ, tối đa 24 triệu điểm ảnh.');
  const scale=Math.min(1,3000/Math.max(bitmap.width,bitmap.height));canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
 }finally{bitmap.close();}
 const T=await new Promise((resolve,reject)=>{const abort=()=>reject(Error('Đã dừng đọc ảnh.'));if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});loadEngine().then(resolve,reject).finally(()=>signal?.removeEventListener('abort',abort));});if(signal?.aborted)throw Error('Đã dừng đọc ảnh.');
 let worker,stopped=false,rejectStop;const stoppedPromise=new Promise((_,reject)=>{rejectStop=reject;});const stop=()=>{stopped=true;worker?.terminate();rejectStop(Error('Đọc ảnh đã dừng hoặc quá 2 phút. Chụp phần bảng rõ hơn rồi thử lại.'));};signal?.addEventListener('abort',stop,{once:true});const timeout=setTimeout(stop,120000);
 try{
  return await Promise.race([stoppedPromise,(async()=>{
  worker=await T.createWorker('vie+eng',1,{workerPath:base+'worker.min.js',corePath:base,langPath:base,workerBlobURL:false,logger:m=>progress(m.status==='recognizing text'?'Đang đọc chữ '+Math.round(m.progress*100)+'%':'Đang chuẩn bị bộ đọc ảnh…')});
  if(stopped||signal?.aborted){await worker.terminate();throw Error('Đã dừng đọc ảnh.');}
  await worker.setParameters({preserve_interword_spaces:'1',tessedit_pageseg_mode:'6'});
  const result=await worker.recognize(canvas,{}, {text:true,blocks:true});return result.data;
  })()]);
 }catch(e){if(stopped)throw Error('Đọc ảnh đã dừng hoặc quá 2 phút. Chụp phần bảng rõ hơn rồi thử lại.');throw e;}
 finally{clearTimeout(timeout);signal?.removeEventListener('abort',stop);await worker?.terminate();canvas.width=canvas.height=0;}
}
const fold=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase().replace(/[^a-z0-9]/g,'');
/** Read only explicitly headed SKU/quantity columns; never guess a quantity from prices/totals. */
export function extractEarlyPhotoRows(data){
 const lines=(data.blocks||[]).flatMap(b=>(b.paragraphs||[]).flatMap(p=>p.lines||[]));let columns=null,headerY=0;
 for(const line of lines){const words=line.words||[],sku=[],qty=[];
  for(let i=0;i<words.length;i++)for(let n=1;n<=3&&i+n<=words.length;n++){
   const part=words.slice(i,i+n),key=fold(part.map(w=>w.text).join(' '));
   if(['mahang','masp','mavt','sku','masanpham'].includes(key))sku.push({x:part[0].bbox.x0,end:part.at(-1).bbox.x1});
   if(['soluong','sl','slxuat','slxin'].includes(key))qty.push({x:part[0].bbox.x0,end:part.at(-1).bbox.x1});
  }
  const unique=a=>a.filter((x,i)=>!a.slice(0,i).some(v=>Math.abs(v.x-x.x)<12));const s=unique(sku),q=unique(qty);
  if(s.length===1&&q.length===1){columns={sku:s[0],qty:q[0],words};headerY=line.bbox?.y1||words[0]?.bbox.y1||0;break;}
 }
 if(!columns)return {rows:[],message:'Không xác định chắc chắn cột Mã hàng và Số lượng. Nhập/sửa dòng bên dưới; không tự lấy số tiền làm số lượng.'};
 const centers=columns.words.map(w=>({text:fold(w.text),x:w.bbox.x0}));
 const nextX=centers.filter(w=>w.x>columns.qty.x+12&& !['luong','xuat','xin'].includes(w.text)).map(w=>w.x).sort((a,b)=>a-b)[0]??Infinity;
 const skuEnd=centers.filter(w=>w.x>columns.sku.end+8).map(w=>w.x).sort((a,b)=>a-b)[0]??columns.qty.x;
 const rows=[];
 for(const line of lines){const words=line.words||[];if((line.bbox?.y0??words[0]?.bbox.y0??0)<=headerY)continue;
  const code=words.filter(w=>w.bbox.x0>=columns.sku.x-15&&w.bbox.x0<skuEnd-5);
  const quantities=words.filter(w=>w.bbox.x0>=columns.qty.x-18&&w.bbox.x0<nextX-5);
  if(code.length!==1||!/[0-9]/.test(code[0].text)||!/^[A-Za-z0-9][A-Za-z0-9._/-]{1,99}$/.test(code[0].text))continue;
  const quantity=quantities.length===1?quantities[0].text:'';
  rows.push({sku:code[0].text,quantity:/^[0-9]+$/.test(quantity)?quantity:'',confidence:Math.min(code[0].confidence??0,quantities[0]?.confidence??0)});
  if(rows.length>300)throw Error('Ảnh vượt 300 dòng. Tách ảnh thành nhiều phiếu.');
 }
 return {rows,message:rows.length?'Đã đọc '+rows.length+' dòng đề xuất. Bắt buộc so lại ảnh, đặc biệt số 0/O, 1/I và số lượng.':'Không đọc được dòng chắc chắn; nhập lại từ ảnh ở bảng bên dưới.'};
}

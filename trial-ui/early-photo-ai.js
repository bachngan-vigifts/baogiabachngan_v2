/** Đọc ảnh phiếu bằng AI qua máy chủ CRM. Trình duyệt chỉ gửi ảnh đã thu nhỏ; khoá và model nằm ở máy chủ. */
const MAX_EDGE=2576,MAX_BYTES=3_400_000;
/** Vẽ ảnh lên canvas nền trắng, thu nhỏ theo cạnh dài; xoay theo bội số 90° khi người dùng chọn hướng thủ công. */
async function photoCanvas(file,rotate){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024||!file.size)throw Error('Chọn ảnh JPG, PNG hoặc WebP tối đa 10 MB. HEIC: đổi sang JPG trước.');
 const bitmap=await createImageBitmap(file);
 try{
  if(bitmap.width*bitmap.height>24000000||Math.min(bitmap.width,bitmap.height)<100)throw Error('Ảnh quá lớn hoặc quá nhỏ. Chọn ảnh rõ, tối đa 24 triệu điểm ảnh.');
  const scale=Math.min(1,MAX_EDGE/Math.max(bitmap.width,bitmap.height)),w=Math.round(bitmap.width*scale),h=Math.round(bitmap.height*scale),turns=((Math.round(rotate/90)%4)+4)%4,canvas=document.createElement('canvas');
  canvas.width=turns%2?h:w;canvas.height=turns%2?w:h;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(turns*Math.PI/2);ctx.drawImage(bitmap,-w/2,-h/2,w,h);
  return canvas;
 }finally{bitmap.close();}
}
const blobOf=(canvas,quality)=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Không nén được ảnh. Thử ảnh khác.')),'image/jpeg',quality));
const base64Of=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=()=>reject(Error('Không đọc được ảnh. Thử ảnh khác.'));r.readAsDataURL(blob);});
/** Ảnh JPEG tối đa 2576 px cạnh dài. Hướng "auto" giữ nguyên ảnh: model tự đọc được ảnh xoay. */
export async function photoPayload(file,{orientation='auto'}={}){
 const canvas=await photoCanvas(file,orientation==='auto'?0:Number(orientation)||0);
 try{let blob;for(const quality of [0.88,0.75,0.6]){blob=await blobOf(canvas,quality);if(blob.size<=MAX_BYTES)break;}
  if(blob.size>MAX_BYTES)throw Error('Ảnh quá nặng sau khi nén. Chụp gần phần bảng hơn.');
  return {mediaType:'image/jpeg',data:await base64Of(blob)};
 }finally{canvas.width=canvas.height=0;}
}
/** Lỗi mà bộ đọc trên máy có thể thay thế ngay: AI chưa cấu hình, quá tải, mất mạng, quá giờ. */
export const aiCanFallBack=e=>!e?.status||[502,503,504].includes(e.status)||e.code==='photo_ai_unavailable';
export async function readEarlyPhotoWithAi(api,file,{orientation='auto',progress=()=>{},signal}={}){
 progress('Đang chuẩn bị ảnh…');const payload=await photoPayload(file,{orientation});
 if(signal?.aborted)throw Error('Đã dừng đọc ảnh.');
 progress('AI đang đọc phiếu, thường mất 10–40 giây…');
 const data=await api('/purchase-early-photo/read','POST',payload);
 if(signal?.aborted)throw Error('Đã dừng đọc ảnh.');
 return aiPhotoResult(data);
}
/** Đổi phản hồi máy chủ thành dòng của bảng kiểm; mỗi dòng có ghi chú cần kiểm, không dòng nào được coi là đã đúng. */
export function aiPhotoResult(data){
 const rows=(Array.isArray(data?.rows)?data.rows:[]).slice(0,300).map(r=>{
  const sku=typeof r.sku==='string'?r.sku:'',quantity=typeof r.quantity==='string'&&/^[0-9]+$/.test(r.quantity)?r.quantity:'';
  const notes=[];if(!sku)notes.push('thiếu mã');else if(!r.inCatalogue)notes.push('mã chưa có trong CRM');if(!quantity)notes.push('thiếu số lượng');if(r.uncertain&&sku&&quantity)notes.push('AI không chắc');
  return {sku,quantity,name:typeof r.name==='string'?r.name:'',review:notes.length?'⚠ '+notes.join(' · '):'AI đọc · cần so ảnh',flagged:notes.length>0};
 });
 const d=data?.document||{},document={};for(const key of ['orderNo','supplierOrderNo','pxkNo','orderReference'])document[key]=typeof d[key]==='string'?d[key]:'';
 const flagged=rows.filter(r=>r.flagged).length;let message,ok=false;
 if(!data?.readable||!rows.length)message='AI không đọc được bảng hàng trong ảnh. Chụp thẳng, đủ sáng phần bảng rồi thử lại, hoặc nhập tay bên dưới.';
 else{
  const total=data.totalCheck==='match'?'Tổng số lượng '+Number(data.rowTotal).toLocaleString('vi-VN')+' khớp tổng in trên phiếu.':data.totalCheck==='mismatch'?'⚠ Tổng các dòng '+Number(data.rowTotal).toLocaleString('vi-VN')+' KHÁC tổng in trên phiếu '+Number(data.statedTotal).toLocaleString('vi-VN')+': có dòng đọc sai hoặc sót.':'Phiếu không in tổng số lượng nên không tự đối chiếu được.';
  ok=data.totalCheck==='match'&&!flagged;
  message='AI đã đọc '+rows.length+' dòng. '+total+(flagged?' Có '+flagged+' dòng đánh dấu ⚠ cần sửa hoặc kiểm kỹ.':'')+' Vẫn bắt buộc so lại với ảnh gốc trước khi lưu.';
 }
 return {rows,document,conflicts:[],message,ok,totalCheck:data?.totalCheck||'unknown'};
}

/** Đọc ảnh phiếu bằng AI qua máy chủ CRM. Trình duyệt chỉ gửi ảnh đã thu nhỏ; khoá và model nằm ở máy chủ. */
import {photoCanvas} from './early-photo-ocr.js';
const MAX_EDGE=2576,MAX_BYTES=3_400_000;
const blobOf=(canvas,quality)=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Không nén được ảnh. Thử ảnh khác.')),'image/jpeg',quality));
const base64Of=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=()=>reject(Error('Không đọc được ảnh. Thử ảnh khác.'));r.readAsDataURL(blob);});
/** Ảnh JPEG tối đa 2576 px cạnh dài, đã xoay theo lựa chọn của người dùng. */
export async function photoPayload(file,{rotate=0}={}){
 const canvas=await photoCanvas(file,{maxEdge:MAX_EDGE,rotate});
 try{let blob;for(const quality of [0.88,0.75,0.6]){blob=await blobOf(canvas,quality);if(blob.size<=MAX_BYTES)break;}
  if(blob.size>MAX_BYTES)throw Error('Ảnh quá nặng sau khi nén. Chụp gần phần bảng hơn.');
  return {mediaType:'image/jpeg',data:await base64Of(blob)};
 }finally{canvas.width=canvas.height=0;}
}
/** Lỗi mà bộ đọc trên máy có thể thay thế ngay: AI chưa cấu hình, quá tải, mất mạng, quá giờ. */
export const aiCanFallBack=e=>!e?.status||[502,503,504].includes(e.status)||e.code==='photo_ai_unavailable';
export async function readEarlyPhotoWithAi(api,file,{rotate=0,progress=()=>{},signal}={}){
 progress('Đang chuẩn bị ảnh…');const payload=await photoPayload(file,{rotate});
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

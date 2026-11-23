export function photoRequestRows(rows,common={}){return rows.map(row=>{
 const out={...row};for(const key of ['orderNo','supplierOrderNo','pxkNo'])out[key]=row[key]||common[key]||'';
 const reference=row.orderReference||(!(row.orderNo||row.supplierOrderNo)?common.orderReference:'')||'',type=row.orderReference?row.referenceType:common.referenceType;
 if(reference){if(!['crm','supplier'].includes(type))throw Error('Số đơn '+reference+': chọn loại Đơn mua CRM hoặc Đơn NCC trước khi kiểm phiếu.');const key=type==='crm'?'orderNo':'supplierOrderNo';if(out[key]&&out[key]!==reference)throw Error('Số đơn '+reference+' khác số đã nhập. Kiểm tra lại trước khi gán.');out[key]=reference;}return out;
});}

const node=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const readDataUrl=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(Error('Không đọc được ảnh.'));r.readAsDataURL(blob);});
async function imagePayload(file){
 const bitmap=await createImageBitmap(file),canvas=document.createElement('canvas');let scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
 for(let attempt=0;attempt<6;attempt++){
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d',{alpha:false}).drawImage(bitmap,0,0,canvas.width,canvas.height);
  const quality=Math.max(.48,.82-attempt*.07),blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(!blob)throw Error('Không xử lý được ảnh.');
  const data=await readDataUrl(blob),base64=data.slice(data.indexOf(',')+1);if(base64.length<=65000||attempt===5){bitmap.close?.();return{name:(file.name||'phieu-xin-hang').replace(/\.[^.]+$/,'.jpg'),type:'image/jpeg',data_base64:base64};}
  scale*=.82;
 }
 throw Error('Không nén được ảnh để gửi.');
}

export function openEarlyRequestPhoto({api}){
 const dialog=node('dialog');dialog.className='modal early-request-dialog early-photo-dialog';
 const head=node('div'),body=node('div'),foot=node('div');head.className='modal-head';body.className='modal-body';foot.className='modal-foot';
 const close=node('button','Đóng');close.type='button';close.className='btn secondary';close.onclick=()=>dialog.close();head.append(node('h2','Xin hàng trước bằng ảnh'),close);
 const note=node('p','Chọn ảnh phiếu xin hàng. Ảnh được gửi sang Claw để nhập phiếu nháp; CRM không tự OCR trên thiết bị. Anh có thể kiểm tra và chỉnh sửa phiếu sau khi Claw nhập xong.');note.className='muted';
 const file=node('input');file.type='file';file.accept='image/jpeg,image/png,image/webp';file.setAttribute('aria-label','Ảnh phiếu xin hàng');
 const preview=node('img');preview.alt='Ảnh phiếu xin hàng';preview.hidden=true;const status=node('p');status.className='muted small';status.setAttribute('role','status');const error=node('p');error.className='error';error.setAttribute('role','alert');
 let url='';file.onchange=()=>{error.textContent=status.textContent='';if(url)URL.revokeObjectURL(url);const f=file.files?.[0];preview.hidden=true;if(!f)return;if(!['image/jpeg','image/png','image/webp'].includes(f.type)||!f.size||f.size>10485760){error.textContent='Chọn JPG, PNG hoặc WebP tối đa 10 MB.';file.value='';return;}url=URL.createObjectURL(f);preview.src=url;preview.hidden=false;};
 const send=node('button','Gửi Claw nhập phiếu nháp');send.type='button';send.className='btn primary';send.onclick=async()=>{const selected=file.files?.[0];if(!selected){error.textContent='Chọn ảnh trước khi gửi.';return;}send.disabled=file.disabled=close.disabled=true;error.textContent='';status.textContent='Đang chuẩn bị và xếp hàng xử lý…';try{
  const image=await imagePayload(selected);let result=await api('/warehouse-image-jobs','POST',{image});if(!result?.jobId)throw Error('Máy chủ chưa tạo được mã xử lý.');send.textContent='Đang xử lý';
  for(let attempt=0;attempt<120&&!['completed','needs_review','failed'].includes(result.status);attempt++){
   status.textContent=result.status==='processing'?'Madam Sen đang đọc ảnh và nhập phiếu nháp…':`Đã xếp hàng${result.position?` (vị trí ${result.position})`:''}. Đang chờ lượt…`;
   await wait(2000);result=await api('/warehouse-image-jobs/'+encodeURIComponent(result.jobId),'GET',undefined,{fresh:true});
  }
  if(result.status==='completed'){
   const label=result.result?.draftNo||result.result?.draftId||'phiếu nháp';status.textContent=`Đã tạo ${label}. Vui lòng mở phiếu để kiểm tra trước khi duyệt.`;
   if(result.result?.draftUrl){const link=node('a','Mở phiếu nháp');link.href=result.result.draftUrl;link.className='btn secondary';foot.prepend(link);}
   if(result.result?.warnings?.length)error.textContent='Lưu ý: '+result.result.warnings.join('; ');send.textContent='Đã hoàn tất';close.disabled=false;
  }else if(['needs_review','failed'].includes(result.status))throw Error(result.error||'Madam Sen chưa thể tạo phiếu; cần kiểm tra thủ công.');
  else throw Error('Việc xử lý vẫn đang chạy. Anh có thể đóng và kiểm tra lại sau.');
 }catch(e){error.textContent=e.message||'Không gửi được ảnh.';status.textContent='Chưa hoàn tất.';send.disabled=file.disabled=close.disabled=false;send.textContent='Thử lại';}};
 body.append(note,file,preview,status,error);foot.append(send);dialog.append(head,body,foot);document.body.append(dialog);dialog.addEventListener('cancel',e=>{e.preventDefault();if(!send.disabled)dialog.close();});dialog.addEventListener('close',()=>{if(url)URL.revokeObjectURL(url);preview.removeAttribute('src');dialog.remove();},{once:true});dialog.showModal();return dialog;
}

import {recognizeEarlyPhoto,extractEarlyPhotoRows} from './early-photo-ocr.js';
import {openEarlyRequestFile,parseEarlyRequestSheet,EARLY_FILE_HEADER} from './purchase-early-file.js';
const node=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
export function openEarlyRequestPhoto(options,{recognize=recognizeEarlyPhoto}={}){
 const dialog=node('dialog');dialog.className='modal early-request-dialog early-photo-dialog';
 const head=node('div'),body=node('div'),foot=node('div');head.className='modal-head';body.className='modal-body';foot.className='modal-foot';
 const button=(text,fn)=>{const b=node('button',text);b.type='button';b.className='btn secondary';b.onclick=fn;return b;};
 let busy=false,rows=[],url='',controller=null,confirmed=false;
 const close=button('Đóng',()=>{if(busy){controller?.abort();return;}if(rows.length&&!confirmed&&!confirm('Đóng và bỏ phần ảnh đang kiểm tra?'))return;dialog.close();});
 head.append(node('h2','Xin hàng trước bằng ảnh'),close);
 const file=node('input');file.type='file';file.accept='image/jpeg,image/png,image/webp';file.setAttribute('aria-label','Ảnh phiếu xin hàng');
 const photo=node('img');photo.alt='Ảnh gốc để đối chiếu mã hàng và số lượng';photo.hidden=true;
 const full=node('a','Xem ảnh gốc phóng lớn ↗');full.target='_blank';full.rel='noopener';full.className='btn secondary small';full.hidden=true;
 const status=node('p'),error=node('p');status.className='muted small';status.setAttribute('role','status');error.className='error';error.setAttribute('role','alert');
 const table=node('table');table.className='data-table';const tableHead=node('thead'),tr=node('tr'),tbody=node('tbody');for(const t of ['Mã hàng *','Số lượng *','Độ tin cậy OCR',''])tr.append(node('th',t));tableHead.append(tr);table.append(tableHead,tbody);const wrap=node('div');wrap.className='table-wrap';wrap.append(table);
 const check=node('input');check.type='checkbox';check.setAttribute('aria-label','Đã kiểm tra mã hàng và số lượng với ảnh gốc');const checked=node('label');checked.className='early-photo-confirm';checked.append(check,document.createTextNode(' Tôi đã kiểm đủ các dòng, mã hàng và số lượng với ảnh gốc.'));
 function invalidate(){check.checked=false;confirmed=false;}
 function render(){tbody.replaceChildren();for(const [i,row]of rows.entries()){
  const tr=node('tr');for(const [key,name]of [['sku','Mã hàng'],['quantity','Số lượng']]){const td=node('td'),input=node('input');input.type='text';input.value=row[key];input.maxLength=key==='sku'?100:15;if(key==='quantity')input.inputMode='numeric';input.setAttribute('aria-label',name+' dòng '+(i+1));input.oninput=()=>{row[key]=input.value.trim();invalidate();};td.dataset.label=name;td.append(input);tr.append(td);}
  const confidence=node('td',row.confidence===undefined?'Nhập tay':Math.round(row.confidence)+'% · cần kiểm tra');confidence.dataset.label='Độ tin cậy';tr.append(confidence);const td=node('td');td.append(button('Xoá dòng '+(i+1),()=>{rows.splice(i,1);invalidate();render();}));tr.append(td);tbody.append(tr);
 }}
 const add=button('＋ Thêm dòng',()=>{if(rows.length>=300){error.textContent='Tối đa 300 dòng.';return;}rows.push({sku:'',quantity:''});invalidate();render();});
 const read=button('Đọc ảnh',async()=>{
  if(busy||!file.files?.[0])return;busy=true;controller=new AbortController();file.disabled=read.disabled=add.disabled=next.disabled=true;check.disabled=true;close.textContent='Dừng đọc ảnh';error.textContent='';invalidate();rows=[];render();
  try{const data=await recognize(file.files[0],{signal:controller.signal,progress:text=>{status.textContent=text;}});if(!dialog.open)return;const result=extractEarlyPhotoRows(data);rows=result.rows;status.textContent=result.message;if(!rows.length)rows=[{sku:'',quantity:''}];render();}
  catch(e){error.textContent=e.message||'Không đọc được ảnh. Thử ảnh rõ hơn.';status.textContent='Chưa tạo hoặc gửi phiếu.';}
  finally{busy=false;file.disabled=read.disabled=add.disabled=next.disabled=check.disabled=false;close.textContent='Đóng';controller=null;}
 });read.className='btn primary';
 const next=button('Kiểm phiếu / đối chiếu đơn mua',()=>{
  if(busy)return;error.textContent='';
  if(!check.checked){error.textContent='Cần kiểm tra từng mã và số lượng với ảnh gốc rồi đánh dấu xác nhận.';return;}
  const parsed=parseEarlyRequestSheet([EARLY_FILE_HEADER,...rows.map(r=>[r.sku,r.quantity,'','',''])]);
  if(parsed.errors.length){error.textContent=parsed.errors.join('\n');return;}
  confirmed=true;dialog.close();openEarlyRequestFile({...options,initialRows:parsed.lines});
 });next.className='btn primary';
 file.onchange=()=>{invalidate();rows=[];render();error.textContent=status.textContent='';if(url)URL.revokeObjectURL(url);url='';photo.hidden=full.hidden=true;const f=file.files?.[0];if(!f)return;if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>10485760||!f.size){error.textContent='Chọn JPG, PNG hoặc WebP tối đa 10 MB. HEIC cần đổi sang JPG.';file.value='';return;}url=URL.createObjectURL(f);photo.src=full.href=url;photo.hidden=full.hidden=false;};
 body.append(node('p','Chụp thẳng, rõ phần bảng có cột Mã hàng và Số lượng. Chỉ lấy mã và số lượng; không lấy đơn giá, VAT, tổng tiền hoặc chữ ký. OCR chạy trên thiết bị, ảnh không gửi ra ngoài. Tên hàng lấy từ CRM. Lần đầu tải bộ đọc khoảng 12 MB.'),file,photo,full,read,status,error,wrap,add,checked,node('p','Bước sau chọn NCC/ngày lấy, đối chiếu đơn mua còn hàng và lưu nháp như nhập file. Chưa gửi NCC, chưa nhận hàng và chưa cộng kho.'));
 foot.append(next);dialog.append(head,body,foot);document.body.append(dialog);
 dialog.addEventListener('cancel',e=>{e.preventDefault();close.click();});dialog.addEventListener('close',()=>{controller?.abort();if(url)URL.revokeObjectURL(url);photo.removeAttribute('src');dialog.remove();},{once:true});dialog.showModal();return dialog;
}

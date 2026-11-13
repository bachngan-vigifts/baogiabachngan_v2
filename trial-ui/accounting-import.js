import {readAccountingFile} from './accounting-file.js';
import {importFileCache} from './accounting-import-cache.js';
import {sendAccountingImport} from './accounting-import-runner.js';
const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const reasons={SKU_INVALID:'SKU không hợp lệ',SKU_DUPLICATE:'SKU trùng trong file',QUANTITY_INVALID:'Số lượng không hợp lệ',SKU_NOT_FOUND:'Mã không tồn tại',PRODUCT_UNAVAILABLE:'Sản phẩm ngừng dùng/chưa duyệt',UNIT_MISSING:'Thiếu đơn vị tính',PRICE_MISSING:'Thiếu giá bán niêm yết',VALUE_INVALID:'Thành tiền vượt giới hạn'};
const hashFile=async file=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');
export async function openAccountingImport({request,root,book,valid,refresh,date}) {
 const d=el('dialog',undefined,{class:'ac-dialog','aria-label':'Nhập file kế toán có thể tiếp tục'});
 d.innerHTML='<form><header><h2>Nhập file kế toán · tối đa 30.000 dòng</h2><button type="button" data-close aria-label="Đóng">×</button></header><div class="ac-modal-body"><p data-book></p><p>File gồm SKU và SL. Máy chủ lưu từng lô 500 dòng; giá bán niêm yết CRM được chụp theo từng lô, không phải giá vốn kế toán. Chưa tạo chứng từ hoặc thay đổi tồn kho khi đang nhận file.</p><div class="ac-form"><label>Loại<select name="kind"><option value="opening">Đầu kỳ</option><option value="purchase">Nhập mua</option><option value="sale">Xuất bán</option></select></label><label>Ngày<input type="date" name="date" required></label><label>Số chứng từ<input name="reference" maxlength="120" required></label><label>Ghi chú đối soát<input name="note" maxlength="1000" required></label><label>Excel/CSV · tối đa 20 MB<input type="file" accept=".xlsx,.xls,.csv" data-file></label></div><button type="button" data-template>Tải mẫu SKU / SL</button><p role="status" data-status>Chọn file để kiểm tra. Lượt nhập chỉ thuộc tài khoản đang đăng nhập.</p><progress data-progress max="1" value="0" style="width:100%"></progress><div class="ac-actions"><button type="button" data-start>Kiểm tra và bắt đầu</button><button type="button" data-resume disabled>Tiếp tục</button><button type="button" data-pause disabled>Tạm dừng sau lô hiện tại</button><button type="button" data-errors disabled>Tải báo cáo lỗi</button><button type="button" data-cancel disabled>Hủy lượt nhập</button></div><div data-result></div><h3>Lượt nhập gần đây của tôi</h3><div data-jobs></div><p role="alert" class="ac-error"></p></div><footer><button type="button" data-close>Đóng</button><button type="button" data-finish disabled>Tạo chứng từ nháp</button></footer></form>';
 root.append(d);d.showModal();d.querySelector('[data-book]').textContent=book.name;d.querySelector('[name=date]').value=date;
 const $=s=>d.querySelector(s),controller=new AbortController();
 let job=null,running=false,paused=false,closed=false,source=null,shownId=null;
 const alive=()=>!closed&&valid()&&d.isConnected;
 const say=t=>{if(alive())$('[data-status]').textContent=t;};
 const showError=e=>{if(alive())$('.ac-error').textContent=e.message;};
 const close=()=>{closed=true;paused=true;controller.abort();d.remove();if(job?.state==='completed'&&valid())refresh();};
 d.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);d.addEventListener('cancel',e=>{e.preventDefault();close();});
 $('form').onsubmit=e=>e.preventDefault();
 function controls(){
  d.querySelectorAll('.ac-form input,.ac-form select,[data-start],[data-template],[data-jobs] button').forEach(n=>n.disabled=running||(job?.state==='uploading'&&(n.hasAttribute('name')||n.hasAttribute('data-start'))));
  $('[data-resume]').disabled=running||!job||job.state!=='uploading'||job.receivedRows===job.totalRows;
  $('[data-pause]').disabled=!running;
  $('[data-errors]').disabled=running||!job?.errorCount;
  $('[data-cancel]').disabled=running||!job||job.state!=='uploading';
  $('[data-finish]').disabled=running||!job||job.state!=='uploading'||job.receivedRows!==job.totalRows||job.errorCount>0;
 }
 function display(next){job=next;
  if(shownId!==job.id){shownId=job.id;for(const key of ['kind','date','reference','note'])$('[name='+key+']').value=job[key];}
  const p=$('[data-progress]');p.max=job.totalRows;p.value=job.receivedRows;
  say(`${job.filename} · Đã lưu máy chủ ${job.receivedRows}/${job.totalRows} dòng · ${job.errorCount} dòng lỗi · ${job.state==='completed'?'Đã tạo nháp':job.state==='cancelled'?'Đã hủy':'Chưa ghi sổ'}`);controls();
 }
 async function recent(){const result=await request('/books/'+book.id+'/imports');if(!alive())return;
  $('[data-jobs]').replaceChildren();for(const item of result.jobs){const b=el('button',`${item.filename} · ${item.reference} · ${{uploading:'Đang nhận file',completed:'Đã tạo nháp',cancelled:'Đã hủy'}[item.state]||item.state}`,{type:'button'});
   b.onclick=async()=>{try{source=null;const r=await request('/imports/'+item.id);if(alive()){display(r);$('.ac-error').textContent='';}}catch(e){showError(e);}};$('[data-jobs]').append(b);}
 }
 async function sourceFor(job){
  const cached=await importFileCache.get(job.id);
  if(cached?.hash===job.fileHash&&cached.rows?.length===job.totalRows)return cached.rows;
  const file=$('[data-file]').files?.[0];if(!file)throw Error('Chọn lại đúng file gốc để tiếp tục. Các lô đã nhận vẫn còn trên máy chủ.');
  if(await hashFile(file)!==job.fileHash)throw Error('File đã thay đổi, không khớp lượt nhập. Chọn đúng file gốc hoặc hủy lượt để nhập file đã sửa.');
  const rows=await readAccountingFile(file,{staged:true,signal:controller.signal});
  await importFileCache.set(job.id,{hash:job.fileHash,rows});return rows;
 }
 async function run(){
  if(running||!job)return;running=true;paused=false;controls();$('.ac-error').textContent='';
  try{
   source=source||await sourceFor(job);if(!alive())return;
   const result=await sendAccountingImport({request,job,rows:source,onProgress:r=>{if(alive())display(r);},stopped:()=>paused||!alive()});
   if(alive()){display(result);if(paused)say(`Đã tạm dừng. Máy chủ đã nhận ${job.receivedRows}/${job.totalRows} dòng. Bấm Tiếp tục khi sẵn sàng.`);}
  }catch(e){showError(e);if(alive())try{display(await request('/imports/'+job.id));}catch{} }
  finally{running=false;if(alive())controls();}
 }
 $('[data-pause]').onclick=()=>{paused=true;say('Sẽ dừng sau khi máy chủ xác nhận lô hiện tại.');};
 $('[data-resume]').onclick=run;
 $('[data-template]').onclick=async()=>{try{const {downloadAccountingTemplate}=await import('./accounting-template.js');if(alive())await downloadAccountingTemplate();}catch(e){showError(e);}};
 $('[data-start]').onclick=async()=>{
  if(running)return;
  if(job?.state==='uploading')return showError(Error('Lượt hiện tại chưa kết thúc. Bấm Tiếp tục hoặc hủy lượt trước khi bắt đầu file mới.'));
  if(!$('form').reportValidity())return;
  const file=$('[data-file]').files?.[0];if(!file)return showError(Error('Chọn file Excel/CSV.'));
  running=true;controls();$('.ac-error').textContent='';
  try{
   say('Đang đọc file trên thiết bị…');
   const rows=await readAccountingFile(file,{staged:true,signal:controller.signal});
   const hash=await hashFile(file),id=crypto.randomUUID();if(!alive())return;
   // Persist before the first request: an ambiguous create response is recoverable via Recent imports.
   await importFileCache.set(id,{hash,rows});
   const created=await request('/books/'+book.id+'/imports','POST',{id,fileHash:hash,filename:file.name,totalRows:rows.length,kind:$('[name=kind]').value,date:$('[name=date]').value,reference:$('[name=reference]').value,note:$('[name=note]').value});
   if(!alive())return;source=rows;display(created);
  }catch(e){showError(e);await recent().catch(()=>{});return;}
  finally{running=false;if(alive())controls();}
  await run();if(alive())await recent().catch(showError);
 };
 $('[data-errors]').onclick=async()=>{
  if(!job||running)return;running=true;controls();
  try{
   const errors=[];for(let offset=0;;offset+=500){const r=await request('/imports/'+job.id+'/errors?offset='+offset);if(!alive())return;errors.push(...r.rows);if(r.rows.length<500)break;}
   const csv=v=>{const t=String(v??'');return '"'+(/^[=+@\-]/.test(t)?"'"+t:t).replace(/"/g,'""')+'"';};
   const lines=[['Dòng Excel','SKU','SL','Lỗi'],...errors.map(r=>[r.sourceRow,r.sku,r.quantity,r.error.split(';').map(c=>reasons[c]||c).join('; ')])];
   const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.map(r=>r.map(csv).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=el('a');a.href=url;a.download='loi-nhap-ke-toan-'+job.id+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   $('[data-result]').textContent=`Báo cáo ${errors.length} dòng lỗi. Sửa file rồi hủy lượt cũ/tạo lượt mới; không tự bỏ qua dòng lỗi.`;
  }catch(e){showError(e);}finally{running=false;if(alive())controls();}
 };
 $('[data-cancel]').onclick=async()=>{if(!job||running)return;running=true;controls();try{await request('/imports/'+job.id+'/cancel','POST',{});await importFileCache.remove(job.id);if(alive())display(await request('/imports/'+job.id));}catch(e){showError(e);}finally{running=false;if(alive())controls();}};
 $('[data-finish]').onclick=async()=>{
  if(!job||running)return;running=true;controls();$('.ac-error').textContent='';
  try{const r=await request('/imports/'+job.id+'/finish','POST',{});await importFileCache.remove(job.id);if(alive()){$('[data-result]').textContent='Đã tạo chứng từ nháp '+job.reference+'. Chưa duyệt, chưa ghi sổ.';display(await request('/imports/'+job.id));}}
  catch(e){
   showError(e);
   if(alive())try{
    const latest=await request('/imports/'+job.id);display(latest);
    if(latest.state==='completed'){
     await importFileCache.remove(job.id);$('.ac-error').textContent='';
     $('[data-result]').textContent='Máy chủ đã tạo chứng từ nháp '+latest.reference+'. Đã xác minh lại sau lỗi kết nối; không tạo lần hai.';
    }
   }catch{}
  }
  finally{running=false;if(alive())controls();}
 };
 try{await recent();}catch(e){showError(e);}controls();
 return {close};
}

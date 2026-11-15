const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const field=(text,input)=>{const label=el('label');label.append(el('span','',text),input);return label;};
const option=(value,text)=>Object.assign(el('option','',text),{value});
const num=n=>Number(n||0).toLocaleString('vi-VN');
// Match receipt form's 0.001 precision; suppress subtraction noise in native max/step validation.
const quantity=n=>Math.round(n*1000)/1000;
async function receiptPhoto(file){
 if(!file.type.startsWith('image/'))throw Error('Chọn ảnh hàng lỗi.');
 const url=URL.createObjectURL(file),image=new Image();
 try{image.src=url;await image.decode();for(const [size,quality] of [[1280,.72],[1024,.68],[800,.62],[640,.6]]){
  const scale=Math.min(1,size/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);const result=canvas.toDataURL('image/jpeg',quality);if(result.length<=450000)return result;
 }throw Error('Ảnh quá lớn, chụp lại giúp.');}finally{URL.revokeObjectURL(url);}
}
let active=null;
/** Receive the displayed supplier slip, through the existing request-scoped receipt/ledger API. */
export async function openEarlyQuickReceipt({api,request,requests=request?[request]:[],onSaved=async()=>{}}){
 if(active?.isConnected){active.focus();return;}
 const modal=active=el('dialog','modal early-request-dialog early-quick-receipt'),head=el('div','modal-head'),form=el('form'),body=el('div','modal-body'),foot=el('div','modal-foot');
 modal.dataset.mobileActions='off';
 const title=el('div');title.append(el('h2','','Nhận hàng theo phiếu lấy trước'),el('p','small muted',requests.map(r=>'Phiếu '+(r.ticketNumber||r.id.slice(0,8).toUpperCase())+(r.slipLabel?' · '+r.slipLabel:'')).join(' · ')));
 const close=el('button','btn secondary','Đóng');close.type='button';close.dataset.noBusy='';head.append(title,close);
 const status=el('p','small muted','Đang tải các mã còn được nhận…'),error=el('p','error');error.setAttribute('role','alert');status.setAttribute('role','status');
 const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10),date=Object.assign(el('input'),{type:'date',value:today,max:today,required:true});date.setAttribute('aria-label','Ngày nhận');
 const warehouse=el('select');warehouse.required=true;warehouse.setAttribute('aria-label','Kho nhận');warehouse.append(option('','Chọn kho nhận'));
 const sapo=el('select');sapo.required=true;sapo.setAttribute('aria-label','Có tạo đơn nhập Sapo không?');sapo.append(option('','Chọn Có hoặc Không'),option('false','Không — chỉ nhập CRM'),option('true','Có — tạo đơn nhập Sapo'));
 const note=Object.assign(el('input'),{type:'text',maxLength:1000});note.setAttribute('aria-label','Ghi chú nhận hàng');note.placeholder='Nhập lý do khi từ chối nhận';
 const fields=el('div','early-quick-fields');fields.append(field('Ngày nhận',date),field('Kho nhận *',warehouse),field('Có tạo đơn nhập Sapo không? *',sapo),field('Ghi chú / lý do từ chối nhận',note));
 const cards=el('div','recv-cards');body.append(el('p','','Chỉ nhận phần NCC đã đồng ý và còn được nhận. Phiếu nháp, dòng chờ/từ chối hoặc đã nhận đủ sẽ bỏ qua; không tự xác nhận thay NCC.'),el('p','','Chỉ hàng đạt được nhập kho và giảm số còn phải giao. Hàng lỗi / trả NCC không cộng tồn; NCC vẫn phải giao bù. Có hàng lỗi cần 1–3 ảnh bằng chứng.'),fields,status,cards,error);
 const submit=el('button','btn primary','Xác nhận nhận hàng');submit.type='submit';submit.disabled=true;submit.dataset.noBusy='';const reject=el('button','btn secondary danger-text','Từ chối nhận');reject.type='button';reject.dataset.noBusy='';reject.disabled=true;foot.append(reject,submit);form.noValidate=true;form.append(head,body,foot);modal.append(form);document.body.append(modal);modal.showModal();
 let busy=false,frozen=false,finished=false,loaded=false,photosBusy=false,refusalRequested=false,attempts=null;const controls=[date,warehouse,sapo,note],rows=[],budgets=new Map();
 const completed=()=>attempts?.filter(a=>a.done).length||0;
 async function finish(){if(busy)return;if(frozen&&!finished&&!confirm('Lượt nhận đã gửi nhưng chưa hoàn tất. Đóng và tải lại phiếu để kiểm tra kết quả?'))return;modal.close();modal.remove();if(active===modal)active=null;if(frozen)await onSaved();}
 close.addEventListener('click',finish);modal.addEventListener('cancel',e=>{e.preventDefault();finish();});
 const photos=[],photoSection=el('section','recv-photos'),photoHint=el('p','small muted'),photoList=el('div','pack-photos'),photoInput=Object.assign(el('input'),{type:'file',accept:'image/*',multiple:true,hidden:true});photoInput.setAttribute('capture','environment');photoInput.setAttribute('aria-label','Ảnh hàng lỗi / trả NCC');
 const photoPick=el('button','btn secondary','Chọn / chụp ảnh hàng lỗi');photoPick.type='button';photoPick.dataset.noBusy='';photoPick.addEventListener('click',()=>{if(!busy&&!frozen&&!photosBusy)photoInput.click();});
 photoSection.append(el('h4','','Ảnh hàng lỗi / trả NCC'),photoHint,photoPick,photoInput,photoList);body.insertBefore(photoSection,error);controls.push(photoInput,photoPick);
 function drawPhotos(){photoList.replaceChildren();photos.forEach((url,i)=>{const box=el('span','pack-photo'),image=el('img'),remove=el('button','icon-btn','×');image.src=url;image.alt='Ảnh hàng lỗi '+(i+1);remove.type='button';remove.setAttribute('aria-label','Bỏ ảnh hàng lỗi '+(i+1));remove.disabled=frozen||busy||photosBusy;remove.addEventListener('click',()=>{if(busy||frozen||photosBusy)return;photos.splice(i,1);drawPhotos();sync();});box.append(image,remove);photoList.append(box);});}
 photoInput.addEventListener('change',async()=>{if(busy||frozen||photosBusy)return;const files=[...photoInput.files];photoInput.value='';photosBusy=true;error.textContent='';sync();
  try{for(const file of files){if(photos.length>=3)throw Error('Tối đa 3 ảnh hàng lỗi.');const image=await receiptPhoto(file);if(!modal.isConnected)return;photos.push(image);}}
  catch(e){error.textContent=e.message||'Không đọc được ảnh.';}finally{photosBusy=false;drawPhotos();sync();}
 });
 function sync(){const good=rows.reduce((n,r)=>n+Number(r.input.value||0),0),bad=rows.reduce((n,r)=>n+Number(r.bad.value||0),0);if(loaded&&!frozen)status.textContent=rows.length+' dòng hàng · '+num(good)+' đạt · '+num(bad)+' lỗi / trả NCC';photoHint.textContent=photos.length?photos.length+'/3 ảnh.':'Có hàng lỗi hoặc từ chối nhận: bắt buộc 1–3 ảnh.';submit.disabled=busy||photosBusy||!loaded||(!frozen&&!(good+bad>0));reject.disabled=busy||photosBusy||frozen||!loaded||!(good+bad>0);photoPick.disabled=busy||photosBusy||frozen;}

 try{
  const sources=requests.flatMap(request=>[...new Set(request.lines.flatMap(l=>l.allocations.filter(a=>a.status==='accepted'&&a.remainingToReceive>0).map(a=>a.orderId)))].map(orderId=>({request,orderId})));
  if(!sources.length)throw Error('Các phiếu không còn số lượng được nhận. Tải lại để kiểm tra.');
  const [wh,...contexts]=await Promise.all([api('/stock-warehouses'),...sources.map(async source=>({...source,context:await api('/purchase-early-requests/'+encodeURIComponent(source.request.id)+'/receiving?orderId='+encodeURIComponent(source.orderId))}))]);
  if(!modal.isConnected)return;
  let last='';try{last=localStorage.getItem('bn-receive-wh')||'';}catch{/* Optional preference. */}
  for(const w of wh.warehouses)warehouse.append(option(w.name,w.name));if(wh.warehouses.length===1)warehouse.value=wh.warehouses[0].name;else if(wh.warehouses.some(w=>w.name===last))warehouse.value=last;
  for(const {request,context} of contexts)for(const line of context.lines){
   const source=request.lines.find(l=>l.sku===line.sku),allocs=source?.allocations.filter(a=>a.orderId===context.orderId&&a.status==='accepted')||[];
   const limit=quantity(Math.min(line.remaining,allocs.reduce((s,a)=>s+Number(a.remainingToReceive||0),0)));if(!source||limit<=0)continue;
   const key=context.orderId+':'+line.lineId,budget=quantity(Math.min(...allocs.map(a=>Number(a.purchaseRemaining??line.remaining))));budgets.set(key,Math.min(budgets.get(key)??Infinity,budget));
   const card=el('section','recv-card'),input=Object.assign(el('input'),{type:'number',min:'0',step:'0.001',max:String(limit),value:String(limit),required:true});input.inputMode='decimal';input.setAttribute('aria-label','SL nhận '+line.sku+' · '+context.ticketNumber);input.dataset.earlyQuickQuantity=line.lineId;
   const bad=Object.assign(el('input'),{type:'number',min:'0',step:'0.001',max:String(limit),value:'0',required:true}),lineNote=Object.assign(el('input'),{type:'text',maxLength:300});bad.inputMode='decimal';bad.setAttribute('aria-label','SL lỗi / trả NCC '+line.sku+' · '+context.ticketNumber);lineNote.setAttribute('aria-label','Ghi chú lỗi '+line.sku+' · '+context.ticketNumber);
   const quantities=el('div','early-quick-quantities');quantities.append(field('Số lượng hàng đạt nhập kho',input),field('Số lượng lỗi / trả NCC',bad));
   card.append(el('b','',source.name.includes(line.sku)?source.name:source.name+' ('+line.sku+')'),el('p','small muted','Phiếu '+(request.ticketNumber||request.id.slice(0,8).toUpperCase())+' · '+context.ticketNumber+' · Còn được nhận '+num(limit)+' '+(source.unit||'')),quantities,field('Ghi chú lỗi (nếu có)',lineNote));cards.append(card);rows.push({input,bad,lineNote,limit,context,line,request,key});controls.push(input,bad,lineNote);input.addEventListener('input',sync);bad.addEventListener('input',()=>{const b=Number(bad.value||0);if(b>0&&Number(input.value||0)+b>limit)input.value=String(quantity(Math.max(0,limit-b)));sync();});
  }
  if(!rows.length)throw Error('Phiếu không còn mã được nhận. Đóng và tải lại phiếu.');
  const assigned=new Map();for(const r of rows){const value=quantity(Math.max(0,Math.min(r.limit,budgets.get(r.key)-(assigned.get(r.key)||0))));r.input.value=String(value);assigned.set(r.key,(assigned.get(r.key)||0)+value);}
  if(rows.some(r=>rows.filter(x=>x.key===r.key).length>1))body.insertBefore(el('p','small muted','Các phiếu trùng dòng đơn mua dùng chung số còn lại. Mặc định chia lần lượt theo thứ tự hiển thị; anh có thể sửa, tổng không được vượt số đơn mua còn lại.'),cards);
  loaded=true;sync();
 }catch(e){error.textContent=e.message||'Không tải được phạm vi nhận hàng.';}
 reject.addEventListener('click',()=>{if(reject.disabled)return;refusalRequested=true;try{form.requestSubmit(submit);}finally{refusalRequested=false;}});
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||photosBusy||!loaded)return;error.textContent='';const refusing=refusalRequested;
  if(!frozen){
   sapo.required=!refusing;const valid=form.reportValidity();sapo.required=true;if(!valid)return;
   const invalid=rows.find(r=>![r.input,r.bad].every(i=>i.value.trim()!==''&&Number.isFinite(Number(i.value))&&Number(i.value)>=0)||quantity(Number(r.input.value)+Number(r.bad.value))>r.limit);
   if(invalid){error.textContent='Số đạt và số lỗi phải không âm; tổng không vượt lượng còn được nhận trong phiếu.';invalid.input.focus();return;}
   const totals=new Map();for(const r of rows)totals.set(r.key,(totals.get(r.key)||0)+Number(r.input.value)+Number(r.bad.value));
   const over=rows.find(r=>totals.get(r.key)>budgets.get(r.key)+0.0000001);if(over){error.textContent='Tổng nhận các phiếu cùng dòng '+over.context.ticketNumber+' / '+over.line.sku+' không được vượt '+num(budgets.get(over.key))+'.';over.input.focus();return;}
   const selected=rows.filter(r=>Number(r.input.value)+Number(r.bad.value)>0);if(!selected.length){error.textContent='Nhập số lượng nhận cho ít nhất một mã.';return;}
   if((refusing||selected.some(r=>Number(r.bad.value)>0))&&!photos.length){error.textContent='Có hàng lỗi / từ chối nhận: chụp 1–3 ảnh bằng chứng trước khi lưu.';photoPick.focus();return;}
   if(refusing&&note.value.trim().length<3){error.textContent='Nhập lý do từ chối nhận (ít nhất 3 ký tự).';note.focus();return;}
   if(refusing&&!confirm('Ghi nhận toàn bộ số lượng đang chọn là hàng lỗi / trả NCC, không cộng tồn và NCC vẫn phải giao bù?'))return;
   const groups=new Map();for(const r of selected){const key=r.request.id+':'+r.context.orderId;let a=groups.get(key);if(!a){a={orderId:r.context.orderId,ticketNumber:r.context.ticketNumber,done:false,body:{clientKey:crypto.randomUUID(),earlyRequestId:r.request.id,createSapo:!refusing&&sapo.value==='true',receivedDate:date.value,warehouse:warehouse.value,note:(refusing?'Từ chối nhận / trả NCC: ':'')+note.value,photos:[...photos],lines:[]}};groups.set(key,a);}a.body.lines.push({lineId:r.line.lineId,goodQty:refusing?0:Number(r.input.value),damagedQty:quantity(Number(r.bad.value)+(refusing?Number(r.input.value):0)),note:r.lineNote.value||(refusing?note.value:'')});}
   attempts=[...groups.values()];if(refusing){for(const r of selected){r.bad.value=String(quantity(Number(r.input.value)+Number(r.bad.value)));r.input.value='0';}sapo.value='false';}frozen=true;controls.forEach(c=>c.disabled=true);reject.disabled=true;drawPhotos();try{localStorage.setItem('bn-receive-wh',warehouse.value);}catch{/* Optional preference. */}
  }
  busy=true;close.disabled=true;sync();
  try{
   for(const attempt of attempts){if(attempt.done)continue;status.textContent='Đang nhận theo phiếu xin · '+attempt.ticketNumber;
    await api('/purchase-orders/'+encodeURIComponent(attempt.orderId)+'/receipts','POST',attempt.body);attempt.done=true;
   }
   finished=true;busy=false;status.textContent='Đã lưu nhận hàng theo phiếu xin.';await finish();
  }catch(e){error.textContent=(e.message||'Chưa xác định kết quả lưu.')+' Đã xác nhận '+completed()+'/'+attempts.length+' đơn nguồn. Bấm Thử lại để kiểm tra và tiếp tục cùng lượt nhận, không tạo trùng.';submit.textContent='Thử lại lượt nhận';}
  finally{busy=false;close.disabled=false;sync();}
 });
}

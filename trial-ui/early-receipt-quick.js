const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const field=(text,input)=>{const label=el('label');label.append(el('span','',text),input);return label;};
const option=(value,text)=>Object.assign(el('option','',text),{value});
const num=n=>Number(n||0).toLocaleString('vi-VN');
// Match receipt form's 0.001 precision; suppress subtraction noise in native max/step validation.
const quantity=n=>Math.round(n*1000)/1000;
let active=null;
/** Receive the displayed supplier slip, through the existing request-scoped receipt/ledger API. */
export async function openEarlyQuickReceipt({api,request,requests=request?[request]:[],onSaved=async()=>{}}){
 if(active?.isConnected){active.focus();return;}
 const modal=active=el('dialog','modal early-request-dialog early-quick-receipt'),head=el('div','modal-head'),form=el('form'),body=el('div','modal-body'),foot=el('div','modal-foot');
 modal.dataset.mobileActions='off';
 const title=el('div');title.append(el('h2','','Nhận hàng nhanh theo phiếu xin'),el('p','small muted',requests.map(r=>'Phiếu '+(r.ticketNumber||r.id.slice(0,8).toUpperCase())+(r.slipLabel?' · '+r.slipLabel:'')).join(' · ')));
 const close=el('button','btn secondary','Đóng');close.type='button';close.dataset.noBusy='';head.append(title,close);
 const status=el('p','small muted','Đang tải các mã còn được nhận…'),error=el('p','error');error.setAttribute('role','alert');status.setAttribute('role','status');
 const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10),date=Object.assign(el('input'),{type:'date',value:today,max:today,required:true});date.setAttribute('aria-label','Ngày nhận');
 const warehouse=el('select');warehouse.required=true;warehouse.setAttribute('aria-label','Kho nhận');warehouse.append(option('','Chọn kho nhận'));
 const sapo=el('select');sapo.required=true;sapo.setAttribute('aria-label','Có tạo đơn nhập Sapo không?');sapo.append(option('','Chọn Có hoặc Không'),option('false','Không — chỉ nhập CRM'),option('true','Có — tạo đơn nhập Sapo'));
 const note=Object.assign(el('input'),{type:'text',maxLength:1000});note.setAttribute('aria-label','Ghi chú nhận hàng');
 const fields=el('div','early-quick-fields');fields.append(field('Ngày nhận',date),field('Kho nhận *',warehouse),field('Có tạo đơn nhập Sapo không? *',sapo),field('Ghi chú',note));
 const cards=el('div','recv-cards');body.append(el('p','','Chỉ nhận phần NCC đã đồng ý và còn được nhận. Phiếu nháp, dòng chờ/từ chối hoặc đã nhận đủ sẽ bỏ qua; không tự xác nhận thay NCC.'),el('p','','Chỉ nhập hàng đạt của các mã trong phiếu xin này. Số nhận cập nhật vào đúng đơn mua nguồn và giảm số lượng còn phải giao.'),fields,status,cards,error);
 const submit=el('button','btn primary','Xác nhận nhận hàng');submit.type='submit';submit.disabled=true;submit.dataset.noBusy='';foot.append(submit);form.append(body,foot);modal.append(head,form);document.body.append(modal);modal.showModal();
 let busy=false,frozen=false,finished=false,loaded=false,attempts=null;const controls=[date,warehouse,sapo,note],rows=[],budgets=new Map();
 const completed=()=>attempts?.filter(a=>a.done).length||0;
 async function finish(){if(busy)return;if(frozen&&!finished&&!confirm('Lượt nhận đã gửi nhưng chưa hoàn tất. Đóng và tải lại phiếu để kiểm tra kết quả?'))return;modal.close();modal.remove();if(active===modal)active=null;if(frozen)await onSaved();}
 close.addEventListener('click',finish);modal.addEventListener('cancel',e=>{e.preventDefault();finish();});
 function sync(){if(loaded&&!frozen)status.textContent=rows.length+' dòng hàng · '+num(rows.reduce((n,r)=>n+Number(r.input.value||0),0))+' đơn vị đang chọn';submit.disabled=busy||!loaded||(!frozen&&!rows.some(r=>Number(r.input.value)>0));}
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
   card.append(el('b','',source.name.includes(line.sku)?source.name:source.name+' ('+line.sku+')'),el('p','small muted','Phiếu '+(request.ticketNumber||request.id.slice(0,8).toUpperCase())+' · '+context.ticketNumber+' · Còn được nhận '+num(limit)+' '+(source.unit||'')),field('Số lượng hàng đạt nhập kho',input));cards.append(card);rows.push({input,limit,context,line,request,key});controls.push(input);input.addEventListener('input',sync);
  }
  if(!rows.length)throw Error('Phiếu không còn mã được nhận. Đóng và tải lại phiếu.');
  const assigned=new Map();for(const r of rows){const value=quantity(Math.max(0,Math.min(r.limit,budgets.get(r.key)-(assigned.get(r.key)||0))));r.input.value=String(value);assigned.set(r.key,(assigned.get(r.key)||0)+value);}
  if(rows.some(r=>rows.filter(x=>x.key===r.key).length>1))body.insertBefore(el('p','small muted','Các phiếu trùng dòng đơn mua dùng chung số còn lại. Mặc định chia lần lượt theo thứ tự hiển thị; anh có thể sửa, tổng không được vượt số đơn mua còn lại.'),cards);
  loaded=true;sync();
 }catch(e){error.textContent=e.message||'Không tải được phạm vi nhận hàng.';}
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!loaded)return;error.textContent='';
  if(!frozen){
   if(!form.reportValidity())return;
   const invalid=rows.find(r=>!Number.isFinite(Number(r.input.value))||Number(r.input.value)<0||Number(r.input.value)>r.limit);
   if(invalid){error.textContent='Số nhận phải từ 0 đến lượng còn được nhận trong phiếu.';invalid.input.focus();return;}
   const totals=new Map();for(const r of rows)totals.set(r.key,(totals.get(r.key)||0)+Number(r.input.value));
   const over=rows.find(r=>totals.get(r.key)>budgets.get(r.key)+0.0000001);if(over){error.textContent='Tổng nhận các phiếu cùng dòng '+over.context.ticketNumber+' / '+over.line.sku+' không được vượt '+num(budgets.get(over.key))+'.';over.input.focus();return;}
   const selected=rows.filter(r=>Number(r.input.value)>0);if(!selected.length){error.textContent='Nhập số lượng nhận cho ít nhất một mã.';return;}
   const groups=new Map();for(const r of selected){const key=r.request.id+':'+r.context.orderId;let a=groups.get(key);if(!a){a={orderId:r.context.orderId,ticketNumber:r.context.ticketNumber,done:false,body:{clientKey:crypto.randomUUID(),earlyRequestId:r.request.id,createSapo:sapo.value==='true',receivedDate:date.value,warehouse:warehouse.value,note:note.value,lines:[]}};groups.set(key,a);}a.body.lines.push({lineId:r.line.lineId,goodQty:Number(r.input.value),damagedQty:0});}
   attempts=[...groups.values()];frozen=true;controls.forEach(c=>c.disabled=true);try{localStorage.setItem('bn-receive-wh',warehouse.value);}catch{/* Optional preference. */}
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

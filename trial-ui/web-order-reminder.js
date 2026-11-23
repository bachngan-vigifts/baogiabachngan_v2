const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const button=(text,fn)=>{const b=el('button','btn secondary',text);b.type='button';b.addEventListener('click',fn);return b;};
/** One scoped read per minute on the visible POS page, independent of board filters/pagination. */
export function createWebOrderReminder({api,root,context,onGhn,onCancel,now=Date.now}){
 const banner=el('div','pos-contact-warning');banner.hidden=true;
 banner.setAttribute('role','status');
 let scope='',generation=0,data=null,pending=null,dialog=null,snoozeUntil=0,lastError='',loadedAt=null;
 const snoozes=new Map();
 const current=()=>{const c=context();return c.active&&c.userId&&c.registerId&&document.visibilityState==='visible'?`${c.userId}|${c.registerId}`:'';};
 const close=()=>{dialog?.close();dialog?.remove();dialog=null;};
 const syncScope=()=>{const key=current();if(key!==scope){if(scope)snoozes.set(scope,snoozeUntil);scope=key;generation++;data=null;pending=null;loadedAt=null;snoozeUntil=snoozes.get(key)||0;lastError='';close();draw();}return key;};
 function draw(){
  banner.replaceChildren();banner.hidden=!data?.count&&!lastError;
  if(data?.count)banner.append(el('strong','',`${data.count} đơn web quá 30 phút chưa xử lý`),button('Xem nhắc nhở',()=>show(true)));
  if(lastError)banner.append(el('span','pos-note','Chưa cập nhật được nhắc nhở: '+lastError),button('Thử lại',()=>void refresh({force:true})));
  const summary=dialog?.querySelector('[data-contact-summary]');if(summary&&data)summary.textContent=`Còn ${data.count} đơn cần liên hệ khách để tiếp tục xử lý. “Đã liên hệ” không hoàn thành đơn hay tạo vận đơn.`;
  const ids=new Set(data?.orders?.map(o=>o.id)||[]);
  for(const row of root.querySelectorAll('[data-web-order-id]')){
   const warning=ids.has(row.dataset.webOrderId);row.classList.toggle('pos-order-overdue',warning);
   let note=row.querySelector('.pos-order-contact-note');if(warning&&!note){note=el('small','pos-order-contact-note','Quá 30 phút · Cần liên hệ khách');row.append(note);}if(!warning)note?.remove();
  }
 }
 function show(force=false){
  if(!syncScope()||!data?.orders?.length||dialog||(!force&&context().busy)||document.querySelector('dialog[open]')||(!force&&now()<snoozeUntil))return;
  const dlg=el('dialog','modal pos-contact-reminder'),head=el('div','modal-head'),body=el('div','modal-body'),foot=el('div','modal-foot');dialog=dlg;
  const title=el('h3','','Đơn web quá 30 phút chưa xử lý');title.id='pos-contact-reminder-title';dlg.setAttribute('aria-labelledby',title.id);head.append(title);
  const summary=el('p','',`Có ${data.count} đơn cần liên hệ khách để tiếp tục xử lý. “Đã liên hệ” chỉ ghi nhận liên hệ, không hoàn thành đơn hay tạo vận đơn.`);summary.dataset.contactSummary='1';body.append(summary);
  if(data.count>data.orders.length)body.append(el('p','pos-note',`Hiện ${data.orders.length} đơn cũ nhất; xử lý xong danh sách sẽ tải tiếp.`));
  const key=scope,seq=generation;
  for(const o of data.orders){
   const card=el('section','pos-contact-reminder-row');card.dataset.attentionOrderId=o.id;
   card.append(el('strong','',o.orderNo+' · '+o.customerName),el('p','pos-note',`${o.phone||'Chưa có số điện thoại'} · Chờ ${o.ageMinutes} phút`));
   const actions=el('div','pos-contact-reminder-actions'),error=el('p','error');error.setAttribute('role','alert');
   const contact=button('Đã liên hệ',async()=>{
    if(contact.disabled)return;contact.disabled=true;error.textContent='';
    try{await api('/pos/web-orders/'+encodeURIComponent(o.id)+'/contact','POST',{});
     if(key!==current()||seq!==generation)return;
     data={...data,count:Math.max(0,data.count-1),orders:data.orders.filter(x=>x.id!==o.id)};card.remove();draw();if(!body.querySelector('[data-attention-order-id]')){close();snoozeUntil=now()+5*60_000;}void refresh({force:true});
    }catch(e){if(key===current()&&seq===generation)error.textContent=e.message||'Chưa lưu được liên hệ. Thử lại.';}
    finally{contact.disabled=false;}
   });contact.className='btn primary';
   const open=(fn)=>async()=>{if(key!==current()||seq!==generation){syncScope();return;}snoozeUntil=now()+5*60_000;close();try{await fn(o.id);}catch(e){if(key===current())banner.append(el('span','error',e.message||'Không mở được đơn.'));}};
   actions.append(contact,button('Hủy đơn',open(onCancel)),button('Xử lý giao GHN',open(onGhn)));card.append(actions,error);body.append(card);
  }
  const later=button('Nhắc lại sau 5 phút',()=>{snoozeUntil=now()+5*60_000;close();});foot.append(later);dlg.append(head,body,foot);document.body.append(dlg);
  dlg.addEventListener('cancel',e=>{e.preventDefault();snoozeUntil=now()+5*60_000;close();});
  dlg.addEventListener('close',()=>{if(dialog===dlg)dialog=null;dlg.remove();});dlg.showModal();
 }
 async function refresh({force=false}={}){
  const key=syncScope();if(!key)return;if(pending)return pending;
  if(!force&&loadedAt!==null&&now()-loadedAt<60_000){draw();show();return;}
  const seq=generation,c=context();
  const request=Promise.resolve().then(async()=>{try{
   const result=await api('/pos/web-orders/attention?registerId='+encodeURIComponent(c.registerId));
   if(key!==current()||seq!==generation){syncScope();return;}data=result;loadedAt=now();lastError='';if(!data.count)close();draw();show();
  }catch(e){if(key===current()&&seq===generation){if([401,403].includes(e.status)){data=null;lastError='';close();}else lastError=e.message||'Lỗi kết nối';draw();}}
  finally{if(pending===request)pending=null;}});pending=request;return request;
 }
 const timer=setInterval(()=>{syncScope();void refresh();},60_000);timer.unref?.();
 const changed=()=>{syncScope();if(current())void refresh();};
 globalThis.addEventListener?.('hashchange',changed);document.addEventListener?.('visibilitychange',changed);
 return{banner,refresh,paint:draw,dispose(){clearInterval(timer);globalThis.removeEventListener?.('hashchange',changed);document.removeEventListener?.('visibilitychange',changed);scope='';generation++;close();}};
}

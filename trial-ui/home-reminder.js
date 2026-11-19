import {createTaskWriteIntent} from './task-write-intent.js';
const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
/** Reuse ordinary self-assigned CRM tasks, including server-side authorization and retry identity. */
export function homeReminderContent(note,date,owner,minDate=today()){
 const description=String(note||'').trim();
 if(!owner)throw Error('Đăng nhập lại trước khi tạo nhắc việc.');
 if(!description||description.length>5000)throw Error('Nhập ghi chú từ 1 đến 5.000 ký tự.');
 const parsed=new Date(date+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date||date<minDate)throw Error('Chọn ngày nhắc từ hôm nay trở đi.');
 return {title:('Nhắc chăm sóc: '+description.split(/\r?\n/)[0]).slice(0,300),description,assigneeId:owner,priority:'normal',dueDate:date};
}
export function initHomeReminder({api,userId,toast,confirmBox,onCreated=()=>{}}){
 let active=null;
 const reset=()=>{const old=active;active=null;if(old){if(old.dialog.open)old.dialog.close();old.dialog.remove();}};
 function open(){
  const who=userId();if(!who)return;
  if(active?.owner===who){active.dialog.querySelector('textarea').focus();return;}
  reset();
  const intent=createTaskWriteIntent({owner:()=>who,scope:'home-care-reminder'}),dialog=document.createElement('dialog');
  dialog.className='modal home-reminder-dialog';dialog.setAttribute('aria-labelledby','home-reminder-title');
  dialog.innerHTML=`<form data-no-busy><header><h2 id="home-reminder-title">Nhắc chăm sóc nhanh</h2><button type="button" class="btn ghost" data-close aria-label="Đóng">×</button></header><div class="home-reminder-body"><label>Ghi chú chăm sóc<textarea name="note" rows="5" maxlength="5000" placeholder="VD: Gọi chị Lan hỏi phản hồi về mẫu quà…" required></textarea></label><label>Ngày nhắc<input type="date" name="date" required></label><p class="muted">Lưu thành công việc của tôi. Đến ngày hẹn, xem tại Trang chủ → Hôm nay hoặc Công việc. Không tự gửi tin cho khách.</p><p class="error" role="alert" data-error></p></div><footer><button type="button" class="btn ghost" data-discard hidden>Bỏ lần gửi chưa rõ kết quả</button><button type="button" class="btn secondary" data-close>Đóng</button><button type="submit" class="btn primary">Lưu nhắc việc</button></footer></form>`;
  const view={owner:who,dialog,busy:false};active=view;
  const form=dialog.querySelector('form'),f=form.elements,error=dialog.querySelector('[data-error]'),save=form.querySelector('[type=submit]'),discard=form.querySelector('[data-discard]');
  const current=()=>active===view&&userId()===who;
  const close=()=>{if(!view.busy)reset();};
  function sync(){
   const pending=intent.pending();
   if(pending){f.note.value=pending.content.description;f.date.value=pending.content.dueDate;}
   for(const el of [f.note,f.date])el.disabled=view.busy||!!pending;
   f.date.min=pending?'':today();save.disabled=view.busy;save.textContent=view.busy?'Đang lưu…':pending?'Gửi lại đúng nhắc việc':'Lưu nhắc việc';
   discard.hidden=!pending;discard.disabled=view.busy;
   for(const b of form.querySelectorAll('[data-close]'))b.disabled=view.busy;
  }
  f.date.value=today();sync();
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(view.busy||!current())return;error.textContent='';let content;
   try{content=intent.pending()?.content||homeReminderContent(f.note.value,f.date.value,who);}catch(ex){error.textContent=ex.message;return;}
   view.busy=true;sync();
   try{
    const result=await intent.send(content,(clientKey,body)=>api('/tasks','POST',{...body,clientKey}));
    if(!current())return;view.busy=false;reset();toast('Đã lưu nhắc chăm sóc. Xem lịch hẹn trong Công việc.');onCreated(result);
   }catch(ex){if(current()){error.textContent=ex.message||'Chưa rõ kết quả lưu. Gửi lại đúng nhắc việc để tránh trùng.';}}
   finally{view.busy=false;if(current())sync();}
  });
  discard.addEventListener('click',async()=>{
   if(view.busy||!await confirmBox('Nhắc việc có thể đã được tạo. Kiểm tra Công việc trước khi tạo lại. Bỏ mã gửi lại trên máy này?',{title:'Bỏ lần gửi chưa rõ kết quả',ok:'Bỏ lần gửi'}))return;
   if(current()&&intent.discard())reset();
  });
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  form.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',close));
  document.body.append(dialog);dialog.showModal();f.note.focus();
 }
 return {open,reset};
}

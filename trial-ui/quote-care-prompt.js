import {bindCareContactPicker} from './care-contacts.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const addDays=(iso,n)=>new Date(Date.parse(iso+'T00:00:00Z')+n*864e5).toISOString().slice(0,10);
const options=(list,value)=>list.map(x=>`<option value="${esc(x.key??x.id)}" ${(x.key??x.id)===value?'selected':''}>${esc(x.label??x.name)}</option>`).join('');
/** A saved quote is not an actual customer contact: this creates only a pending CRM reminder. */
export function initQuoteCarePrompt({api,toast,onChanged=()=>{}}){
 let active=null;
 function offer(saved,{isCurrent=()=>true}={}){
  if(active||!isCurrent())return Promise.resolve(false);
  const dlg=document.createElement('dialog');dlg.className='modal quote-care-dialog';dlg.setAttribute('aria-label','Nhắc lịch chăm sóc sau lưu báo giá');active=dlg;
  dlg.innerHTML=`<form><div class="modal-head"><div><span class="eyebrow">Báo giá đã lưu</span><h2>Có nhắc lịch chăm sóc khách hàng không?</h2></div><button type="button" class="icon-btn" data-close aria-label="Đóng">×</button></div><div class="modal-body"><p class="muted">Đặt lịch theo dõi nhu cầu và phản hồi của khách. Lịch nhắc không có nghĩa là đã gửi báo giá hoặc đã liên hệ khách.</p><section data-context role="status">Đang kiểm tra thông tin khách và lịch hẹn…</section><button type="button" class="btn secondary small" data-reload hidden>Thử tải lại</button><fieldset data-fields hidden><legend>Đặt lịch chăm sóc</legend></fieldset><p class="error" role="alert" data-error></p><p class="muted small" data-state></p></div><div class="modal-foot"><button type="button" class="btn secondary" data-close>Không nhắc lúc này</button><button type="button" class="btn primary" data-start disabled>Đặt lịch chăm sóc</button><button type="submit" class="btn primary" data-save hidden>Lưu lịch nhắc</button></div></form>`;
  document.body.append(dlg);
  const $=s=>dlg.querySelector(s),form=dlg.querySelector('form');let context=null,busy=false,opening=false,attempt=null,run=0,contact=null,expanded=false;
  let settle;const promise=new Promise(resolve=>{settle=resolve;});
  const finish=value=>{if(busy)return;run++;window.removeEventListener('hashchange',onRoute);if(active===dlg)active=null;dlg.close();dlg.remove();settle(value);};
  const onRoute=()=>{if(!isCurrent()&&!busy)finish(false);};
  window.addEventListener('hashchange',onRoute);
  for(const b of dlg.querySelectorAll('[data-close]'))b.addEventListener('click',()=>finish(false));
  dlg.addEventListener('cancel',e=>{e.preventDefault();finish(false);});
  dlg.showModal();
  const current=()=>dlg.isConnected&&active===dlg&&isCurrent();
  async function load(){
   const request=++run;$('[data-error]').textContent='';$('[data-reload]').hidden=true;$('[data-start]').disabled=true;
   try{
    const value=await api('/care/quote-follow-up?'+new URLSearchParams({quoteId:saved.id,revision:saved.revision}));
    if(request!==run||!current()){if(dlg.isConnected&&!isCurrent())finish(false);return;}
    context=value;
    $('[data-context]').innerHTML=`<dl class="kv"><dt>Báo giá</dt><dd><b>${esc(value.quoteNo)} · bản ${esc(value.quoteRevision)}</b></dd><dt>Khách hàng</dt><dd>${esc(value.customerName)}</dd><dt>Phụ trách</dt><dd>${esc(value.ownerName||'Chưa phân công')}</dd></dl>`;
    if(value.pending){
     const a=value.pending;$('[data-context]').insertAdjacentHTML('beforeend',`<div class="quote-care-existing"><b>Đã có lịch chăm sóc đang chờ</b><p>${esc(a.nextAt.split('-').reverse().join('/'))} · ${esc(a.ownerName)}</p><p>${esc(a.nextAction||a.content||a.subject)}</p><a class="btn secondary small" href="#/care/${encodeURIComponent(a.id)}">Xem / sửa lịch hiện tại</a></div>`);
     $('[data-start]').hidden=true;dlg.querySelector('.modal-foot [data-close]').textContent='Giữ lịch hiện tại';return;
    }
    if(!value.canSchedule){$('[data-state]').textContent=value.reason;$('[data-start]').hidden=true;return;}
    $('[data-start]').disabled=false;
   }catch(ex){if(request!==run||!current())return;$('[data-error]').textContent='Báo giá đã lưu. Chưa kiểm tra được lịch chăm sóc: '+ex.message;$('[data-reload]').hidden=false;}
  }
  $('[data-reload]').addEventListener('click',load);
  $('[data-start]').addEventListener('click',async()=>{
   if(!context||expanded||busy||opening)return;opening=true;$('[data-start]').disabled=true;$('[data-error]').textContent='';
   try{
    const [config,people]=await Promise.all([api('/care/config'),context.canAssign?api('/tasks/people'):Promise.resolve({people:[]})]);
    if(!current())return;
    const field=$('[data-fields]'),date=addDays(context.today,1),eligible=(people.people||[]).filter(p=>p.role!=='customer'&&p.role!=='supplier');
    field.innerHTML=`<label>Nhân viên nhận nhắc *${context.canAssign?`<select name="ownerId" required><option value="">Chọn nhân viên</option>${options(eligible,context.ownerId)}</select>`:`<b>${esc(context.ownerName)}</b>`}</label><label>Người liên hệ *<select name="contactChoice" required></select></label><input name="contactName" maxlength="160" placeholder="Tên – số điện thoại người liên hệ" hidden><small class="muted" data-contact-status role="status"></small><button type="button" class="btn secondary small" data-contact-retry hidden>Tải lại danh bạ</button><label>Ngày chăm sóc *<input type="date" name="nextAt" min="${esc(context.today)}" value="${date}" required></label><div class="row-gap" data-dates>${[[1,'Ngày mai'],[3,'Sau 3 ngày'],[7,'Sau 1 tuần']].map(([n,t])=>`<button type="button" class="btn ghost small" data-day="${n}">${t}</button>`).join('')}</div><label>Nhắc trước *<select name="remindBefore" required>${options(config.reminds,'1d')}</select></label><label>Hình thức dự kiến *<select name="type" required>${options(config.types,'call')}</select></label><label>Việc cần làm *<textarea name="nextAction" maxlength="300" rows="3" required>${esc('Hỏi phản hồi và nhu cầu tiếp theo về báo giá '+context.quoteNo)}</textarea></label>`;
    contact=bindCareContactPicker({select:field.querySelector('[name=contactChoice]'),input:field.querySelector('[name=contactName]'),status:field.querySelector('[data-contact-status]'),retry:field.querySelector('[data-contact-retry]'),api,getCustomerId:()=>context.customerId,isConnected:current,matchUniqueName:true});
    expanded=true;dlg.querySelector('h2').textContent='Đặt lịch chăm sóc báo giá';field.hidden=false;$('[data-start]').hidden=true;$('[data-save]').hidden=false;
    field.querySelector('[data-dates]').addEventListener('click',e=>{const b=e.target.closest('[data-day]');if(b)form.elements.nextAt.value=addDays(context.today,Number(b.dataset.day));});
    await contact.load(context.customerId,context.contactName||'');
   }catch(ex){if(current())$('[data-error]').textContent=ex.message;}finally{opening=false;if(dlg.isConnected)$('[data-start]').disabled=false;}
  });
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(busy||!expanded)return;$('[data-error]').textContent='';
   if(!attempt){
    if(contact?.isLoading()){ $('[data-error]').textContent='Đang tải người liên hệ. Vui lòng chờ.';return; }
    if(!form.reportValidity())return;
    const f=form.elements;
    attempt={quoteId:context.quoteId,quoteRevision:context.quoteRevision,ownerId:f.ownerId?.value||context.ownerId,clientKey:crypto.randomUUID(),occurredAt:context.today,contactName:f.contactName.value,type:f.type.value,nextAt:f.nextAt.value,nextAction:f.nextAction.value.trim(),remindBefore:f.remindBefore.value};
   }
   busy=true;for(const el of form.querySelectorAll('input,select,textarea,button'))el.disabled=true;
   try{
    const result=await api('/care/quote-follow-up','POST',attempt);
    busy=false;toast(result.alreadyScheduled?'Đã có lịch chăm sóc đang chờ; giữ lịch hiện tại.':'Đã đặt lịch chăm sóc. Nhắc việc sẽ hiện tại Công việc khi đến mốc nhắc.');
    try{onChanged(result.activity);}catch{}
    finish(true);
   }catch(ex){
    busy=false;if(!dlg.isConnected)return;$('[data-error]').textContent='Báo giá đã lưu. Chưa lưu được lịch nhắc: '+ex.message;
    if(!ex.status||ex.status>=500){$('[data-error]').textContent+=' Chưa rõ kết quả; thử lại sẽ giữ cùng nội dung và mã gửi.';$('[data-save]').textContent='Kiểm tra lại lần gửi';for(const b of form.querySelectorAll('[data-close],[data-save]'))b.disabled=false;}
    else{attempt=null;for(const el of form.querySelectorAll('input,select,textarea,button'))el.disabled=false;}
   }
  });
  void load();return promise;
 }
 return{offer};
}

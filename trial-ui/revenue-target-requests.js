import {parseRevenueTarget} from './revenue-targets.js';
import {formatQuickMoney} from './payroll-quick-entry.js';
const LABEL={pending:'Chờ duyệt',approved:'Đã duyệt',rejected:'Từ chối',withdrawn:'Đã rút'};
const amount=v=>v===null?'Chưa đăng ký':formatQuickMoney(v)+' đ';
const stamp=v=>v?new Date(v).toLocaleString('vi-VN'):'';

export async function openSelfRevenueTargets({api,esc,toast,confirmBox},initialYear,onSaved=()=>{}){
 const dlg=document.createElement('dialog');dlg.className='modal self-revenue-target-dialog';dlg.style.width='min(1000px,96vw)';dlg.style.maxWidth='96vw';
 dlg.innerHTML=`<div class="modal-head"><h2>Đăng ký doanh số của tôi</h2><button type="button" class="icon-btn" data-close>×</button></div><div class="modal-body"><div class="row-actions" style="justify-content:flex-start"><label>Năm<input data-year type="number" min="2000" max="2100" value="${esc(initialYear)}"></label><button type="button" class="btn secondary" data-load>Tải năm</button></div><p class="muted small">Chỉ đăng ký chỉ tiêu của chính bạn. Sau khi Manager duyệt, chỉ tiêu mới áp dụng vào KPI và lương. Ô trống là chưa đăng ký hoặc đề nghị bỏ đăng ký; khi bỏ đăng ký hệ thống dùng chỉ tiêu hồ sơ/mức chung. Tháng đã chốt chỉ xem.</p><div data-content></div><label>Lý do đăng ký/điều chỉnh<input data-reason maxlength="500" placeholder="Ví dụ: Kế hoạch doanh số năm"></label><p class="error" role="alert" data-error></p></div><div class="modal-foot"><button type="button" class="btn secondary" data-close>Đóng</button><button type="button" class="btn secondary" data-withdraw hidden>Rút đăng ký đang chờ</button><button type="button" class="btn primary" data-submit disabled>Gửi Manager duyệt</button></div>`;
 document.body.append(dlg);dlg.showModal();let data,busy=false,dirty=false;
 const content=dlg.querySelector('[data-content]'),error=dlg.querySelector('[data-error]'),yearInput=dlg.querySelector('[data-year]');
 const setBusy=v=>{busy=v;dlg.querySelectorAll('button,input').forEach(el=>el.disabled=v||el.hasAttribute('data-locked'));dlg.querySelector('[data-submit]').disabled=v||!data;};
 const discard=async()=>!dirty||await confirmBox('Có chỉ tiêu chưa gửi. Bỏ thay đổi này?',{ok:'Bỏ thay đổi'});
 const close=async()=>{if(!busy&&await discard())dlg.close();};dlg.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);dlg.addEventListener('cancel',e=>{e.preventDefault();close();});dlg.addEventListener('close',()=>dlg.remove());
 const render=()=>{
  dlg.querySelector('h2').textContent='Đăng ký doanh số '+data.year+' · '+data.member.name;
  const latest=data.history[0],pending=data.pending;
  content.innerHTML=`${latest?`<p class="approval-box" data-request-status><b>${esc(LABEL[latest.status])}</b> · ${esc(stamp(latest.submittedAt))}${latest.resolutionNote?`<br>${esc(latest.resolutionNote)}`:''}${pending?'<br>Đang chờ Manager duyệt; chỉ tiêu hiện hành chưa thay đổi.':''}</p>`:'<p class="muted" data-request-status>Chưa gửi đăng ký năm này.</p>'}<div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">${data.months.map(m=>{const change=pending?.changes.find(c=>c.month===m),value=data.lockedMonths.includes(m)?data.values[m]:change?change.to:data.values[m];return `<label>Tháng ${Number(m.slice(5))}<input data-target-month="${m}" inputmode="numeric" value="${value===null?'':formatQuickMoney(value)}" placeholder="Chưa đăng ký" ${data.lockedMonths.includes(m)?'disabled data-locked':''}><small>Hiện hành: ${esc(amount(data.values[m]))}${data.lockedMonths.includes(m)?' · Đã chốt':''}</small></label>`;}).join('')}</div><details><summary>Lịch sử đăng ký (${data.history.length})</summary>${data.history.map(r=>`<p><b>${esc(LABEL[r.status])}</b> · ${esc(stamp(r.submittedAt))}<br>${esc(r.reason)}${r.resolutionNote?`<br>${esc(r.resolutionNote)}`:''}</p>`).join('')||'<p>Chưa có lịch sử.</p>'}</details>`;
  dlg.querySelector('[data-reason]').value=pending?.reason||'';dlg.querySelector('[data-withdraw]').hidden=!pending;dlg.querySelector('[data-submit]').textContent=pending?'Cập nhật đăng ký đang chờ':'Gửi Manager duyệt';
 };
 async function load(year){
  if(busy)return;if(!/^\d{4}$/.test(String(year))||+year<2000||+year>2100){error.textContent='Năm phải từ 2000 đến 2100.';yearInput.value=data?.year||initialYear;return;}
  if(!await discard()){yearInput.value=data.year;return;}setBusy(true);content.inert=true;error.textContent='';
  try{const result=await api('/hr/revenue-target-requests/me/'+year);if(!dlg.isConnected)return;if(result.year!==String(year))throw Error('Dữ liệu không đúng năm.');data=result;dirty=false;yearInput.value=result.year;render();}catch(e){error.textContent=e.message;if(data)yearInput.value=data.year;}finally{content.inert=false;setBusy(false);}
 }
 dlg.querySelector('[data-load]').onclick=()=>load(yearInput.value);yearInput.onchange=()=>load(yearInput.value);
 dlg.addEventListener('input',e=>{if(e.target.matches('[data-target-month],[data-reason]'))dirty=true;});
 content.addEventListener('focusout',e=>{if(!e.target.matches('[data-target-month]'))return;try{const n=parseRevenueTarget(e.target.value);e.target.value=n===null?'':formatQuickMoney(n);e.target.removeAttribute('aria-invalid');error.textContent='';}catch(ex){e.target.setAttribute('aria-invalid','true');error.textContent=ex.message;}});
 dlg.querySelector('[data-submit]').onclick=async()=>{
  if(busy||!data)return;error.textContent='';
  try{const values=Object.fromEntries([...content.querySelectorAll('[data-target-month]')].map(el=>[el.dataset.targetMonth,parseRevenueTarget(el.value)])),reason=dlg.querySelector('[data-reason]').value.trim();if(reason.length<3)throw Error('Nhập lý do ít nhất 3 ký tự.');
   setBusy(true);await api('/hr/revenue-target-requests/me/'+data.year,'PUT',{version:data.version,values,reason});dirty=false;toast('Đã gửi đăng ký, chờ Manager duyệt.');setBusy(false);await load(data.year);await onSaved();
  }catch(ex){error.textContent=ex.message;}finally{setBusy(false);}
 };
 dlg.querySelector('[data-withdraw]').onclick=async()=>{
  if(busy||!data?.pending||!await confirmBox('Rút đăng ký đang chờ? Chỉ tiêu hiện hành vẫn giữ nguyên.',{ok:'Rút đăng ký'}))return;
  setBusy(true);error.textContent='';try{await api('/hr/revenue-target-requests/me/'+data.year+'/withdraw','POST',{version:data.version});dirty=false;toast('Đã rút đăng ký.');setBusy(false);await load(data.year);await onSaved();}catch(ex){error.textContent=ex.message;}finally{setBusy(false);}
 };
 await load(String(initialYear));return dlg;
}

export async function openRevenueTargetReview({api,esc,toast},onReviewed=()=>{}){
 const dlg=document.createElement('dialog');dlg.className='modal revenue-target-review-queue';dlg.style.width='min(1050px,96vw)';dlg.style.maxWidth='96vw';
 dlg.innerHTML=`<div class="modal-head"><h2>Duyệt đăng ký doanh số</h2><button type="button" class="icon-btn" data-close>×</button></div><div class="modal-body"><div class="row-actions" style="justify-content:flex-start"><label>Năm<input data-year type="number" min="2000" max="2100" placeholder="Tất cả năm"></label><label>Trạng thái<select data-status>${Object.entries(LABEL).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select></label><button type="button" class="btn secondary" data-load>Tải lại</button></div><div data-list></div><p class="error" data-error role="alert"></p></div>`;
 document.body.append(dlg);dlg.showModal();dlg.querySelector('[data-close]').onclick=()=>dlg.close();dlg.addEventListener('close',()=>dlg.remove());let loading=false;
 async function load(){
  if(loading)return;loading=true;const year=dlg.querySelector('[data-year]').value,error=dlg.querySelector('[data-error]');error.textContent='';dlg.querySelector('[data-load]').disabled=true;
  try{if(year&&(!/^\d{4}$/.test(year)||+year<2000||+year>2100))throw Error('Năm phải từ 2000 đến 2100.');const d=await api('/hr/revenue-target-requests?status='+dlg.querySelector('[data-status]').value+(year?'&year='+year:''));if(!dlg.isConnected)return;
   dlg.querySelector('[data-list]').innerHTML=d.items.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Nhân viên</th><th>Năm</th><th>Gửi lúc</th><th>Trạng thái</th><th></th></tr></thead><tbody>${d.items.map(({request:r,member:m})=>`<tr><td>${esc(m.name)}</td><td>${esc(r.year)}</td><td>${esc(stamp(r.submittedAt))}</td><td>${esc(LABEL[r.status])}</td><td><button type="button" class="btn secondary small" data-request-id="${esc(r.id)}">Xem / duyệt</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Không có đăng ký trong danh sách này.</p>';
  }catch(ex){error.textContent=ex.message;}finally{loading=false;dlg.querySelector('[data-load]').disabled=false;}
 }
 dlg.querySelector('[data-load]').onclick=load;dlg.querySelector('[data-status]').onchange=load;dlg.querySelector('[data-year]').onchange=load;
 dlg.querySelector('[data-list]').onclick=async e=>{const id=e.target.closest('[data-request-id]')?.dataset.requestId;if(!id)return;try{await detail(id);}catch(ex){dlg.querySelector('[data-error]').textContent=ex.message;}};
 async function detail(id){
  const d=await api('/hr/revenue-target-requests/'+encodeURIComponent(id)),r=d.request,box=document.createElement('dialog');box.className='modal revenue-target-review-detail';box.style.width='min(950px,96vw)';box.style.maxWidth='96vw';
  box.innerHTML=`<div class="modal-head"><h2>${esc(d.member?.name||'Nhân viên')} · ${esc(r.year)}</h2><button type="button" class="icon-btn" data-close>×</button></div><div class="modal-body"><p><b>${esc(LABEL[r.status])}</b> · ${esc(stamp(r.submittedAt))}</p><p>Đề nghị bỏ đăng ký sẽ dùng chỉ tiêu hồ sơ/mức chung của tháng.</p><p>Lý do Sale: ${esc(r.reason)}</p>${!d.canApprove&&r.status==='pending'?'<p class="error">Chưa thể duyệt: có tháng đã chốt, chỉ tiêu đã đổi hoặc nhân viên không còn là Sale. Yêu cầu nhân viên gửi lại hoặc từ chối.</p>':''}<div class="table-wrap"><table class="data-table"><thead><tr><th>Tháng</th><th>Khi gửi</th><th>Đề nghị</th><th>Hiện hành</th></tr></thead><tbody>${r.changes.map(c=>`<tr><td>${esc(c.month)}${d.lockedMonths.includes(c.month)?' · Đã chốt':''}</td><td>${esc(amount(c.from))}</td><td><b>${esc(amount(c.to))}</b></td><td>${esc(amount(d.current[c.month]))}</td></tr>`).join('')}</tbody></table></div>${r.status==='pending'?'<label>Ý kiến Manager (bắt buộc khi từ chối)<input data-reason maxlength="500"></label>':`<p>${esc(r.resolutionNote)}</p>`}<p class="error" data-error role="alert"></p></div><div class="modal-foot"><button type="button" class="btn secondary" data-close>Đóng</button>${r.status==='pending'?`<button type="button" class="btn secondary" data-decision="rejected">Từ chối</button><button type="button" class="btn primary" data-decision="approved" ${d.canApprove?'':'disabled'}>Duyệt và áp dụng</button>`:''}</div>`;
  let reviewing=false;document.body.append(box);box.showModal();box.addEventListener('cancel',e=>{if(reviewing)e.preventDefault();});box.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>box.close());box.addEventListener('close',()=>box.remove());
  box.querySelectorAll('[data-decision]').forEach(btn=>btn.onclick=async()=>{
   const decision=btn.dataset.decision,reason=box.querySelector('[data-reason]').value.trim(),error=box.querySelector('[data-error]');error.textContent='';if(decision==='rejected'&&reason.length<3){error.textContent='Nhập lý do từ chối ít nhất 3 ký tự.';return;}
   if(reviewing)return;reviewing=true;box.querySelectorAll('button,input').forEach(el=>el.disabled=true);
   try{await api('/hr/revenue-target-requests/'+encodeURIComponent(id)+'/review','POST',{revision:r.revision,decision,reason});box.close();toast(decision==='approved'?'Đã duyệt và áp dụng chỉ tiêu.':'Đã từ chối đăng ký.');await load();await onReviewed();}catch(ex){error.textContent=ex.message;}finally{reviewing=false;box.querySelectorAll('button,input').forEach(el=>el.disabled=false);if(!d.canApprove)box.querySelector('[data-decision="approved"]').disabled=true;}
  });
 }
 await load();return dlg;
}

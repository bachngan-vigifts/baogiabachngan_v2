import {vietnamToday} from './customer-anniversary.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('vi-VN').format(v)+' đ';
const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase();
const match=(row,q)=>fold(Object.values(row).filter(v=>typeof v==='string').join(' ')).includes(fold(q.trim()));
export const CENTER_DEMO=[
 {id:'sample-1',name:'Công ty Minh họa An Phú',contact:'Chị Mai (minh họa)',reason:'Chuẩn bị quà tri ân cùng kỳ',kind:'period',last:'15/11/2025',product:'Bộ quà tặng',value:24000000},
 {id:'sample-2',name:'Cửa hàng Minh họa Bình An',contact:'Anh Nam (minh họa)',reason:'Lâu chưa mua, cần hỏi lại nhu cầu',kind:'dormant',last:'10/03/2026',product:'Bình giữ nhiệt',value:8500000},
];
export function centerRows(rows,q,status,today=vietnamToday()) {
 return rows.filter(a=>match(a,q)).filter(a=>{
  if(status==='all')return true;if(status==='done')return !!a.nextDoneAt;if(a.nextDoneAt||!a.nextAt)return false;
  if(status==='due')return a.nextAt<=today;if(status==='today')return a.nextAt===today;
  return status==='overdue'?a.nextAt<today:a.nextAt>today;
 });
}
export function phoneHref(phone) {
 const value=String(phone??'').trim(),digits=value.replace(/\D/g,'');return /^\+?[\d ().-]{7,30}$/.test(value)&&digits.length>=7?'tel:'+value.replace(/[^+\d]/g,''):null;
}
export function initCustomerCenter({root,api,canCare,user,openCare,toast}) {
 let run=0,owner=null,selected='calendar',q='',status='due',page=0,activities=[],care=null,anniversaries=null,careError='',annError='',loading=false;
 let demoDone=new Set(),demoDialog=null;const busy=new Set();
 const shortcuts=[['calendar','Lịch chăm sóc'],['period','Khách mua cùng kỳ'],['dormant','Khách lâu chưa mua'],['anniversary','Kỷ niệm khách hàng'],['campaign','Chiến dịch trọng tâm']];
 const demoTag='<span class="pill warn">Dữ liệu minh họa</span>';
 const realForm=customer=>openCare(customer?{customer}: {},()=>load());
 function render() {
  const allowed=canCare(),today=care?.today||vietnamToday(),rows=centerRows(activities,q,status,today);
  const demos=CENTER_DEMO.filter(a=>match(a,q)&&(!['period','dormant'].includes(selected)||a.kind===selected));
  const cards=[['Việc đến hạn hôm nay',allowed?(care?.counts.today??'—'):'—','calendar',false],['Khách mua cùng kỳ',1,'period',true],['Khách lâu chưa mua',1,'dormant',true],['Kỷ niệm sắp tới',anniversaries?.total??'—','anniversary',false],['Chiến dịch đang chạy',1,'campaign',true]];
  root.innerHTML=`<div class="page-head"><div><span class="eyebrow">Kinh doanh</span><h1>Trung tâm khách hàng</h1><p class="muted">${user()?.name?`Xin chào, ${esc(user().name)}. `:''}Theo dõi lịch hẹn, ghi nhận kết quả và chuẩn bị lần chăm sóc tiếp theo.</p></div><button class="btn primary" data-center-record ${allowed?'':'disabled'} ${allowed?'':'title="Chưa được cấp quyền Giao dịch & chăm sóc"'}>＋ Ghi nhận chăm sóc</button></div>
   <div class="center-search"><label>Tìm khách trong các danh sách đang hiển thị<input type="search" data-center-search placeholder="Tên khách, công ty, số điện thoại…" value="${esc(q)}"></label><button class="btn secondary" data-center-reload ${loading?'disabled':''}>${loading?'Đang tải…':'Làm mới'}</button></div>
   <div class="center-stats">${cards.map(([label,value,key,mock])=>`<button class="stat" data-center-section="${key}" aria-pressed="${selected===key}"><small>${label}</small><strong>${value}</strong>${mock?demoTag:`<span class="muted small">${key==='calendar'?(allowed?'Theo phạm vi API chăm sóc':'Chưa có quyền chăm sóc'):'Theo phạm vi khách được xem'}</span>`}</button>`).join('')}</div>
   <nav class="center-shortcuts" aria-label="Nội dung trung tâm khách hàng">${shortcuts.map(([key,label])=>`<button class="chip ${selected===key?'active':''}" data-center-section="${key}" aria-pressed="${selected===key}">${label}</button>`).join('')}</nav>
   <div class="center-columns"><section class="card center-reminders" ${selected==='anniversary'||selected==='campaign'?'hidden':''} aria-labelledby="center-reminders-title"><h2 id="center-reminders-title">Nhắc việc hôm nay</h2><p class="muted small">Bao gồm lịch quá hạn. Bộ lọc áp dụng trên trang đang hiển thị; số tổng hôm nay ở thẻ trên do máy chủ trả về. Hẹn hiện có ngày, chưa có giờ hẹn.</p>
    <label class="center-status">Trạng thái<select data-center-status>${[['due','Đến hạn / quá hạn'],['today','Hôm nay'],['overdue','Quá hạn'],['upcoming','Sắp tới'],['done','Đã hoàn tất trên trang này'],['all','Tất cả trên trang này']].map(([v,t])=>`<option value="${v}" ${v===status?'selected':''}>${t}</option>`).join('')}</select></label>
    ${!allowed?'<p class="empty">Chưa được cấp quyền xem Giao dịch & chăm sóc.</p>':loading?'<p role="status">Đang tải lịch chăm sóc…</p>':careError?`<p class="error" role="alert">${esc(careError)}</p><button class="btn secondary" data-center-reload>Thử lại</button>`:rows.length?`<div class="center-list">${rows.map(a=>{
      const href=phoneHref(a.customerPhone),done=!!a.nextDoneAt;return `<article class="center-item"><div><a class="center-name" href="#/customers/${encodeURIComponent(a.customerId)}">${esc(a.customerName)}</a><p>${esc(a.contactName||'Chưa có người liên hệ')}</p><p class="muted">${esc(a.nextAction||a.subject||a.content||'Chăm sóc theo lịch hẹn')}</p><p class="muted small">Hẹn ${esc(a.nextAt)} · ${esc(a.ownerName)} · Chưa có giờ hẹn</p><span class="pill ${done?'ok':a.nextAt<today?'danger':'info'}">${done?'Đã hoàn tất':a.nextAt<today?'Quá hạn':a.nextAt===today?'Hôm nay':'Sắp tới'}</span></div><div class="center-actions">${href?`<a class="btn secondary" href="${esc(href)}">Gọi</a>`:'<button class="btn secondary" disabled>Chưa có SĐT</button>'}<button class="btn secondary" data-center-contact="${esc(a.id)}">Ghi nhận</button><button class="btn primary" data-center-done="${esc(a.id)}" ${!a.canEdit||done||busy.has(a.id)?'disabled':''}>${busy.has(a.id)?'Đang lưu…':done?'Đã hoàn tất':'Hoàn tất'}</button></div></article>`;}).join('')}</div>`:'<p class="empty">Không có lịch phù hợp trên trang này. Có thể đổi bộ lọc hoặc chuyển trang.</p>'}
    ${allowed&&!careError?`<div class="center-pager"><button class="btn secondary" data-center-page="-1" ${!page||loading?'disabled':''}>Trang trước</button><span>Trang ${page+1} · ${care?.total??0} lịch hẹn chưa hoàn tất</span><button class="btn secondary" data-center-page="1" ${loading||!care||((page+1)*100>=care.total)?'disabled':''}>Trang sau</button></div>`:''}
   </section>
   <section class="card" ${selected==='anniversary'||selected==='campaign'?'hidden':''} aria-labelledby="center-opportunities-title"><h2 id="center-opportunities-title">Cơ hội quay lại</h2>${demoTag}<p class="muted small">Ví dụ bố cục; chưa tính gợi ý mua lại từ lịch sử bán hàng thật.</p>${demos.map(a=>`<article class="center-item"><div><strong>${esc(a.name)}</strong><p>${esc(a.contact)}</p><p>${esc(a.reason)}</p><p class="muted small">Mua gần nhất: ${a.last} · ${a.product} · ${money(a.value)}</p><span class="pill ${demoDone.has(a.id)?'ok':'muted'}">${demoDone.has(a.id)?'Đã hoàn tất bản minh họa':'Chưa chăm sóc · minh họa'}</span></div><div class="center-actions"><button class="btn secondary" disabled title="Không gọi số điện thoại minh họa">Gọi</button><button class="btn secondary" disabled title="Khách mẫu không có hồ sơ thật">Hồ sơ minh họa</button><button class="btn secondary" data-center-demo-form="${a.id}">Tạo lịch minh họa</button><button class="btn secondary" data-center-demo-done="${a.id}" ${demoDone.has(a.id)?'disabled':''}>Hoàn tất minh họa</button></div></article>`).join('')||'<p class="empty">Không có khách mẫu phù hợp.</p>'}<p class="muted small">Tương tác minh họa chỉ giữ trong phiên xem, không lưu CRM.</p></section>
   </div>
   <section class="card center-anniversaries" ${selected==='anniversary'?'':'hidden'}><h2>Kỷ niệm khách hàng</h2><p class="muted small">Mốc 5, 10, 15… năm, chuẩn bị trước 60 ngày. Tổng: ${anniversaries?.total??'—'} khách; hiển thị tối đa 100.</p>${loading?'<p role="status">Đang tải kỷ niệm…</p>':annError?`<p class="error" role="alert">${esc(annError)}</p><button class="btn secondary" data-center-reload>Thử lại</button>`:(anniversaries?.reminders||[]).filter(a=>match(a,q)).map(a=>`<article class="center-item"><div><a class="center-name" href="#/customers/${encodeURIComponent(a.id)}">${esc(a.name)}</a><p>${esc(a.contact)} · ${esc(a.anniversary.years)} năm vào ${esc(a.anniversary.date)}</p><p class="muted">${esc(a.anniversary.suggestion)}</p></div><button class="btn secondary" data-center-anniversary="${esc(a.id)}" ${allowed?'':'disabled'}>Ghi nhận chăm sóc</button></article>`).join('')||'<p class="empty">Chưa có kỷ niệm phù hợp.</p>'}</section>
   <section class="card" ${selected==='campaign'?'':'hidden'}><h2>Chiến dịch trọng tâm</h2>${demoTag}<h3>Tri ân khách hàng cuối năm — minh họa</h3><p class="muted">Ví dụ: chuẩn bị danh sách và hỏi lại nhu cầu quà tặng. Chưa có API chiến dịch, chưa có phân công hay kết quả thực tế.</p><button class="btn secondary" disabled>Quản lý chiến dịch — chưa kết nối</button></section>
   <p class="center-feedback muted" data-center-feedback role="status"></p>`;
 }
 async function load() {
  const id=user()?.id;if(id!==owner){owner=id;q='';page=0;activities=[];busy.clear();demoDone=new Set();demoDialog?.close();}
  const current=++run;loading=true;care=null;anniversaries=null;careError='';annError='';render();
  const results=await Promise.allSettled([canCare()?api(`/care?view=follow-ups&limit=100&offset=${page*100}`):Promise.resolve(null),api('/customers/anniversaries')]);
  if(current!==run||id!==user()?.id)return;
  if(results[0].status==='fulfilled'){const data=results[0].value;care=data?{...data,counts:{...data.counts}}:null;activities=(data?.activities||[]).map(a=>({...a}));}else{activities=[];careError=results[0].reason.message||'Không tải được lịch hẹn.';}
  if(results[1].status==='fulfilled')anniversaries=results[1].value;else annError=results[1].reason.message||'Không tải được kỷ niệm.';
  loading=false;render();
 }
 function demoForm(id) {
  demoDialog?.close();const a=CENTER_DEMO.find(a=>a.id===id);if(!a)return;
  const dlg=document.createElement('dialog');demoDialog=dlg;dlg.className='modal center-demo-dialog';
  dlg.innerHTML=`<form><div class="modal-head"><h2>Tạo lịch — dữ liệu minh họa</h2><button type="button" class="icon-btn" data-demo-close aria-label="Đóng">×</button></div><div class="modal-body"><p class="muted">Form thử giao diện, không gửi hay lưu dữ liệu vào CRM.</p><label>Khách hàng *<input name="customer" required value="${esc(a.name)}"></label><label>Hình thức *<select name="type" required><option>Gọi điện thoại</option><option>Zalo</option><option>Email</option><option>Gặp trực tiếp</option></select></label><label>Nội dung chăm sóc *<textarea name="content" required maxlength="5000" rows="4"></textarea></label><label>Kết quả *<select name="result" required><option value="">Chọn kết quả</option><option>Đã trao đổi</option><option>Cần liên hệ lại</option></select></label><label>Ngày nhắc lại<input name="nextAt" type="date" min="${vietnamToday()}"></label><p data-demo-response role="status"></p></div><div class="modal-foot"><button type="button" class="btn secondary" data-demo-close>Đóng</button><button class="btn primary">Kiểm tra bản minh họa</button></div></form>`;
  document.body.append(dlg);dlg.querySelectorAll('[data-demo-close]').forEach(b=>b.onclick=()=>dlg.close());
  dlg.addEventListener('close',()=>{dlg.remove();if(demoDialog===dlg)demoDialog=null;});
  dlg.querySelector('form').onsubmit=e=>{e.preventDefault();const f=e.target;if(!f.reportValidity())return;const content=f.elements.content,customer=f.elements.customer;
   if(!content.value.trim()||!customer.value.trim()){content.setCustomValidity(!content.value.trim()?'Vui lòng nhập nội dung.':'');customer.setCustomValidity(!customer.value.trim()?'Vui lòng nhập khách hàng.':'');f.reportValidity();return;}
   dlg.querySelector('[data-demo-response]').textContent='Thông tin minh họa hợp lệ. Chưa lưu hoặc tạo lịch trong CRM.';};
  dlg.querySelectorAll('input,textarea').forEach(n=>n.addEventListener('input',()=>n.setCustomValidity('')));dlg.showModal();
 }
 const search=e=>{if(e.isComposing||!e.target.matches('[data-center-search]'))return;q=e.target.value;const start=e.target.selectionStart;render();const input=root.querySelector('[data-center-search]');input.focus();input.setSelectionRange(start,start);};
 root.addEventListener('input',search);root.addEventListener('compositionend',search);
 root.addEventListener('change',e=>{if(e.target.matches('[data-center-status]')){status=e.target.value;render();root.querySelector('[data-center-status]').focus();}});
 root.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.hasAttribute('data-center-section')){selected=b.dataset.centerSection;render();root.querySelector(`.center-shortcuts [data-center-section="${selected}"]`)?.focus();return;}
  if(b.hasAttribute('data-center-reload'))return load();
  if(b.hasAttribute('data-center-record')&&canCare())return realForm();
  if(b.hasAttribute('data-center-page')){page=Math.max(0,page+Number(b.dataset.centerPage));return load();}
  if(b.hasAttribute('data-center-demo-form'))return demoForm(b.dataset.centerDemoForm);
  if(b.hasAttribute('data-center-demo-done')){demoDone.add(b.dataset.centerDemoDone);render();root.querySelector('[data-center-feedback]').textContent='Đã cập nhật bản minh họa trong phiên xem; chưa lưu CRM.';return;}
  const a=activities.find(a=>a.id===(b.dataset.centerDone||b.dataset.centerContact));
  if(b.hasAttribute('data-center-contact')&&a&&canCare())return realForm({id:a.customerId,name:a.customerName,contact:a.contactName});
  if(b.hasAttribute('data-center-anniversary')&&canCare()){const a=anniversaries?.reminders.find(a=>a.id===b.dataset.centerAnniversary);if(a)return realForm(a);}
  if(b.hasAttribute('data-center-done')&&a?.canEdit&&!a.nextDoneAt&&!busy.has(a.id)&&canCare()){
    const current=run;busy.add(a.id);render();
    try{const d=await api(`/care/${encodeURIComponent(a.id)}/done`,'POST',{revision:a.revision,nextAt:a.nextAt});if(current!==run||owner!==user()?.id)return;
      Object.assign(a,d.activity);if(care){care.total=Math.max(0,care.total-1);if(a.nextAt===care.today)care.counts.today=Math.max(0,care.counts.today-1);}
      status='all';toast('Đã đánh dấu lịch hẹn hoàn tất. Ghi nhận giao dịch mới nếu cần lưu kết quả trao đổi.');
    }catch(ex){if(current===run)toast(ex.message,'err');}finally{busy.delete(a.id);if(current===run&&owner===user()?.id)render();}
  }
 });
 return {load,invalidate(){run++;demoDialog?.close();}};
}

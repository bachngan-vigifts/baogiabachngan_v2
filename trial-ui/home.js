/** Permission-filtered launchpad; the server owns task scope/counts and approval authorization. */
let style;
function loadStyle() {
  return style ||= new Promise((resolve,reject)=>{
    const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./home.css',import.meta.url).href;
    link.onload=resolve;link.onerror=()=>{style=null;link.remove();reject(Error('Chưa tải được giao diện Trang chủ.'));};document.head.append(link);
  });
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fold=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const dm=v=>v?v.split('-').reverse().join('/'):'Chưa đặt hạn';
const source={manual:'Công việc',quote:'Báo giá',order:'Đơn hàng',contract:'HĐKT',stock_request:'Khách hỏi tồn',packing:'Đóng gói',delivery:'Giao hàng',transfer:'Điều chuyển kho',purchase:'Mua hàng',invoice:'Hoá đơn',receivable:'Công nợ',cash:'Sổ quỹ',care:'Chăm sóc khách'};
const paths={work:'M9 11l3 3 8-8 M20 12v8H4V4h11',sell:'M4 5h3l2 11h10l2-8H8 M10 20h.01 M18 20h.01',customers:'M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M2 21v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3 M17 5a3 3 0 0 1 0 6 M19 15l3 5',products:'m12 3 9 5-9 5-9-5 9-5 M3 8v9l9 5 9-5V8 M12 13v9',stock:'M3 10l9-7 9 7v11H3V10 M8 21v-8h8v8',money:'M3 6h16v15H3V6 M3 6V3h13v3 M15 11h6v5h-6z',buy:'M3 6h11v12H3V6 M14 10h4l3 5v3h-7 M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4 M18 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4',admin:'M8 9a4 4 0 1 0 8 0 4 4 0 0 0-8 0 M4 22v-4a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v4',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',bell:'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 21h4',plus:'M12 5v14 M5 12h14'};
const icon=k=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[k]||paths.work}"/></svg>`;
const groupIcon={'nav-group-0':'work','nav-group-1':'sell','nav-group-2':'customers','nav-group-products':'products','nav-group-3':'stock','nav-group-4':'money','nav-group-5':'buy','nav-group-6':'admin'};
export const homeGreeting=(at=Date.now())=>{const hour=new Date(at+7*3600000).getUTCHours();return hour<12?'buổi sáng':hour<18?'buổi chiều':'buổi tối';};
export function groupHomeEntries(entries,query='') {
  const groups=new Map(),q=fold(query.trim());
  for(const e of entries){if(!/^#\/[\w-]+(?:[/?]|$)/.test(e.href)||q&&!fold(e.label+' '+e.group).includes(q))continue;const key=e.groupId||'other';if(!groups.has(key))groups.set(key,{key,label:e.group||'Chức năng khác',items:[]});groups.get(key).items.push(e);}
  return [...groups.values()];
}
export function homeTaskHref(scope,filter='priority') {
  return '#/tasks?'+new URLSearchParams({home:'1',view:scope==='all'?'all':'mine',...(filter==='overdue'||filter==='today'?{due:filter}:{})});
}
export function initHome({root,api,user,canApprove,go,entries=()=>[],actions=()=>[],approvalFeed,notifications=()=>api('/notifications'),noticeHref=()=>'',openBell=()=>{},markRead=id=>api('/notifications/read','POST',{ids:[id]}),navigationRoot}) {
  let active=false,owner='',sequence=0,taskSequence=0,filter='priority',query='',snapshot=null,approvals=null,notes=null,taskError='',approvalError='',noteError='',loading=false,midnight,navFrame;
  const signature=()=>{const u=user();return JSON.stringify([u?.id,u?.role,u?.positionId,u?.perms,u?.approver]);};
  const current=(who,version)=>active&&who===signature()&&version===sequence;
  const observer=navigationRoot?new MutationObserver(()=>{cancelAnimationFrame(navFrame);navFrame=requestAnimationFrame(()=>{if(active)drawNavigation();});}):null;
  const scope=()=>snapshot?.scope||(user()?.role==='manager'?'all':'mine');
  const row=t=>`<a class="home-task" href="#/tasks/${encodeURIComponent(t.id)}"><span class="home-task-icon ${t.due==='overdue'?'late':''}">${icon(t.due==='overdue'?'clock':t.source==='delivery'?'buy':'work')}</span><span class="home-task-title"><b>${esc(t.title)}</b><small>${esc(source[t.source]||'Công việc')} · ${esc(t.assigneeName||t.teamName||'Chưa giao')}</small></span><span class="home-task-deadline ${t.due==='overdue'?'late':''}">${esc(t.due==='overdue'?'Quá hạn':t.due==='today'?(t.dueTime||'Hôm nay'):dm(t.dueDate))}</span><span aria-hidden="true">›</span></a>`;
  function shell(){
    const u=user();
    root.innerHTML=`<header class="home-head"><div><p class="home-eyebrow">${esc(new Date().toLocaleDateString('vi-VN',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Ho_Chi_Minh'}))}</p><h1>Trang chủ</h1><p>Chào ${homeGreeting()}, ${esc(u?.name||'bạn')}. Việc cần làm và các chức năng của bạn.</p></div><div class="home-head-tools"><label class="home-search"><span class="sr-only">Tìm chức năng được cấp quyền</span><input type="search" data-home-search placeholder="Tìm chức năng…" autocomplete="off"></label><details class="home-create"><summary class="btn primary">${icon('plus')} Tạo mới</summary><div data-home-create-actions></div></details></div></header>
      <div class="home-meta"><span data-home-scope>${scope()==='all'?'Toàn bộ công việc':'Việc của tôi và nhóm'}</span><span data-home-sync role="status">Đang tải…</span><button type="button" class="link-btn" data-home-refresh>Làm mới</button></div>
      <div class="home-kpis" data-home-kpis></div>
      <div class="home-columns"><section class="card home-priority" aria-labelledby="home-work-title"><header class="home-section-head"><h2 id="home-work-title">Ưu tiên xử lý</h2><a data-home-all href="${homeTaskHref(scope())}">Xem tất cả →</a></header><div class="home-tabs" role="tablist" aria-label="Lọc công việc"><button type="button" role="tab" id="home-tab-priority" aria-controls="home-work-panel" data-home-tab="priority">Tất cả</button><button type="button" role="tab" id="home-tab-overdue" aria-controls="home-work-panel" data-home-tab="overdue">Quá hạn</button><button type="button" role="tab" id="home-tab-today" aria-controls="home-work-panel" data-home-tab="today">Hôm nay</button>${canApprove()?'<button type="button" role="tab" id="home-tab-approvals" aria-controls="home-work-panel" data-home-tab="approvals">Chờ duyệt</button>':''}</div><div data-home-work id="home-work-panel" role="tabpanel" aria-labelledby="home-tab-priority"></div></section>
      <aside class="home-aside"><section class="card"><h2>Thao tác nhanh</h2><div class="home-actions" data-home-actions></div></section><section class="card home-notices"><header class="home-section-head"><h2>Thông báo mới</h2><button type="button" class="link-btn" data-home-bell>Mở chuông</button></header><div data-home-notices><p class="muted">Đang tải thông báo…</p></div></section></aside></div>
      <section class="home-functions" aria-labelledby="home-functions-title"><header class="home-section-head"><h2 id="home-functions-title">Nhóm chức năng</h2><span class="muted small">Theo quyền của bạn</span></header><div class="home-groups" data-home-groups></div></section>`;
    root.querySelector('[data-home-search]').value=query;
    drawNavigation();drawTasks();drawApprovals();drawNotes();
  }
  function drawNavigation(){
    const groups=groupHomeEntries(entries(),query),box=root.querySelector('[data-home-groups]');if(!box)return;
    const opened=new Set([...box.querySelectorAll('details[open]')].map(d=>d.dataset.homeGroup));
    box.innerHTML=groups.length?groups.map(g=>`<details class="home-group" data-home-group="${esc(g.key)}" ${query||opened.has(g.key)?'open':''}><summary><span class="home-group-icon">${icon(groupIcon[g.key])}</span><span><b>${esc(g.label)}</b><small>${esc(g.items.slice(0,3).map(x=>x.label).join(' · '))}${g.items.length>3?'…':''}</small></span><span class="home-chevron" aria-hidden="true">›</span></summary><nav aria-label="${esc(g.label)}">${g.items.map(e=>`<a href="${esc(e.href)}">${esc(e.label)}<span aria-hidden="true">›</span></a>`).join('')}</nav></details>`).join(''):'<p class="home-empty">Không có chức năng phù hợp với quyền và từ khoá này.</p>';
    const available=actions();const buttons=available.map(a=>`<button type="button" data-home-action="${esc(a.key)}">${icon(a.icon||'plus')}<span>${esc(a.label)}</span><span aria-hidden="true">›</span></button>`).join('');
    root.querySelector('[data-home-actions]').innerHTML=buttons||'<p class="muted">Chưa có thao tác nhanh được cấp quyền.</p>';
    root.querySelector('[data-home-create-actions]').innerHTML=buttons;
  }
  function drawKpis(){
    const count=snapshot?.counts,items=[['priority','Việc đang mở',count?.open,'work','Trong phạm vi của bạn'],['today','Đến hạn hôm nay',count?.today,'clock','Cần xử lý trong ngày'],['overdue','Quá hạn',count?.overdue,'clock','Ưu tiên xử lý trước'],...(canApprove()?[['approvals','Chờ duyệt',approvals?.counts?.total,'work','Hộp Cần duyệt']]:[])];
    root.querySelector('[data-home-kpis]').innerHTML=items.map(([key,label,n,ic,sub])=>`<button type="button" class="home-kpi ${key==='overdue'?'late':''} ${key===filter?'selected':''}" data-home-stat="${key}" aria-pressed="${key===filter}"><span class="home-kpi-icon">${icon(ic)}</span><span>${label}<b>${n===undefined?'—':Number(n).toLocaleString('vi-VN')}</b><small>${sub}</small></span></button>`).join('');
  }
  function drawTasks(){
    if(!active)return;drawKpis();
    if(snapshot)root.querySelector('.home-eyebrow').textContent=new Date(snapshot.today+'T00:00:00+07:00').toLocaleDateString('vi-VN',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Ho_Chi_Minh'});
    root.querySelector('[data-home-scope]').textContent=scope()==='all'?'Toàn bộ công việc':'Việc của tôi và nhóm';
    root.querySelector('[data-home-sync]').textContent=taskError?'Chưa cập nhật được công việc':loading?'Đang cập nhật…':snapshot?'Cập nhật '+new Date(snapshot.syncedAt).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Ho_Chi_Minh'}):'Đang tải…';
    root.querySelectorAll('[data-home-tab]').forEach(b=>{const selected=b.dataset.homeTab===filter;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
    root.querySelector('[data-home-work]').setAttribute('aria-labelledby','home-tab-'+filter);
    root.querySelector('[data-home-all]').href=filter==='approvals'?'#/tasks/approvals':homeTaskHref(scope(),filter);
    const box=root.querySelector('[data-home-work]');box.setAttribute('aria-busy',String(loading));
    if(filter==='approvals'){drawApprovals();return;}
    box.innerHTML=(taskError?`<p class="error" role="alert">${esc(taskError)} <button type="button" class="link-btn" data-home-retry="tasks">Thử lại</button></p>`:'')+
      (loading?'<div class="home-loading" role="status">Đang tải công việc…</div>':snapshot&&snapshot.filter===filter?(snapshot.tasks.length?snapshot.tasks.map(row).join(''):`<p class="home-empty">${filter==='overdue'?'Không có việc quá hạn.':filter==='today'?'Không có việc đến hạn hôm nay.':'Không có việc đang mở trong phạm vi của bạn.'}</p>`)+(snapshot.hasMore?`<a class="home-more" href="${homeTaskHref(scope(),filter)}">Xem ${snapshot.total.toLocaleString('vi-VN')} việc phù hợp →</a>`:''):'');
  }
  function drawApprovals(){
    if(!active)return;drawKpis();if(filter!=='approvals')return;
    const box=root.querySelector('[data-home-work]');box.setAttribute('aria-busy','false');
    box.innerHTML=approvalError?`<p class="error" role="alert">${esc(approvalError)} <button class="link-btn" type="button" data-home-retry="approvals">Thử lại</button></p>`:approvals?(approvals.items?.length?approvals.items.slice(0,5).map(a=>`<a class="home-task" href="#/tasks/approvals"><span class="home-task-icon">${icon('work')}</span><span class="home-task-title"><b>${esc(a.title)}</b><small>${esc(a.sub||a.by||'Chờ phê duyệt')}</small></span><span class="home-task-deadline">Chờ duyệt</span><span aria-hidden="true">›</span></a>`).join(''):'<p class="home-empty">Không có hồ sơ đang chờ duyệt.</p>'):'<div class="home-loading" role="status">Đang tải hồ sơ chờ duyệt…</div>';
  }
  function drawNotes(){
    if(!active)return;const box=root.querySelector('[data-home-notices]');
    box.innerHTML=noteError?`<p class="error" role="alert">${esc(noteError)} <button type="button" class="link-btn" data-home-retry="notes">Thử lại</button></p>`:notes?notes.notifications.slice(0,3).map(n=>{const href=noticeHref(n);return `<${href?'a':'div'} ${href?`href="${esc(href)}" data-home-notice="${esc(n.id)}"`:''} class="home-notice"><span class="home-notice-icon">${icon('bell')}</span><span><b>${esc(n.title)}</b><small>${esc(n.body)}</small></span></${href?'a':'div'}>`;}).join('')||'<p class="home-empty">Chưa có thông báo.</p>':'<p class="muted">Đang tải thông báo…</p>';
  }
  function armMidnight(){clearTimeout(midnight);midnight=setTimeout(()=>{if(active&&document.visibilityState!=='hidden')refresh();},86400000-((Date.now()+7*3600000)%86400000)+200);}
  async function loadTasks(){
    const who=signature(),version=sequence,request=++taskSequence,wanted=filter==='approvals'?'priority':filter;loading=true;taskError='';drawTasks();
    try{const data=await api('/tasks/home?'+new URLSearchParams({filter:wanted}));if(!current(who,version)||request!==taskSequence)return;snapshot=data;root.dataset.ready='true';armMidnight();}
    catch(e){if(!current(who,version)||request!==taskSequence)return;taskError=e.message||'Chưa tải được công việc.';root.dataset.ready='error';}
    finally{if(current(who,version)&&request===taskSequence){loading=false;drawTasks();}}
  }
  async function loadApprovals(){
    if(!canApprove()){approvals=null;return;}const who=signature(),version=sequence;approvalError='';
    try{const data=await approvalFeed.load();if(!current(who,version)||!canApprove())return;approvals=data;}
    catch(e){if(!current(who,version))return;approvals=null;approvalError=e.message||'Chưa tải được hồ sơ chờ duyệt.';}
    if(current(who,version))drawApprovals();
  }
  async function loadNotes(){const who=signature(),version=sequence;noteError='';try{const data=await notifications();if(current(who,version))notes=data;}catch(e){if(!current(who,version))return;notes=null;noteError=e.message||'Chưa tải được thông báo.';}if(current(who,version))drawNotes();}
  async function refresh(){if(!active)return;return Promise.allSettled([loadTasks(),loadApprovals(),loadNotes()]);}
  async function show(){
    const who=signature();if(owner!==who){snapshot=approvals=notes=null;filter='priority';query='';owner=who;}
    active=true;const version=++sequence;root.dataset.ready='false';await loadStyle();if(!current(who,version))return;
    shell();observer?.observe(navigationRoot,{subtree:true,attributes:true,attributeFilter:['hidden'],childList:true});
    return refresh();
  }
  function hide(){active=false;sequence++;taskSequence++;clearTimeout(midnight);cancelAnimationFrame(navFrame);observer?.disconnect();}
  function reset(){hide();snapshot=approvals=notes=null;owner='';root.replaceChildren();root.dataset.ready='false';}
  root.addEventListener('input',e=>{if(e.target.matches('[data-home-search]')){query=e.target.value;drawNavigation();}});
  root.addEventListener('click',e=>{
    const b=e.target.closest('[data-home-action],[data-home-tab],[data-home-stat],[data-home-refresh],[data-home-retry],[data-home-bell],[data-home-notice]');if(!b||!active)return;
    if(b.dataset.homeAction){const a=actions().find(a=>a.key===b.dataset.homeAction);root.querySelector('.home-create').open=false;a?.run();}
    else if(b.hasAttribute('data-home-tab')||b.hasAttribute('data-home-stat')){const next=b.dataset.homeTab||b.dataset.homeStat;if(next==='approvals'&&!canApprove())return;filter=next;drawTasks();if(next==='approvals')loadApprovals();else loadTasks();}
    else if(b.hasAttribute('data-home-refresh'))refresh();
    else if(b.dataset.homeRetry==='tasks')loadTasks();else if(b.dataset.homeRetry==='approvals')loadApprovals();else if(b.dataset.homeRetry==='notes')loadNotes();
    else if(b.hasAttribute('data-home-bell')){e.stopPropagation();openBell();}
    else if(b.dataset.homeNotice){markRead(b.dataset.homeNotice).catch(()=>{});}
  });
  root.addEventListener('keydown',e=>{if(!e.target.matches('[data-home-tab]')||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const buttons=[...root.querySelectorAll('[data-home-tab]')],i=buttons.indexOf(e.target),next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;e.preventDefault();buttons[next].focus();buttons[next].click();});
  document.addEventListener('visibilitychange',()=>{if(active&&document.visibilityState!=='hidden'&&snapshot?.today!==today())refresh();});
  return {show,refresh,hide,reset};
}

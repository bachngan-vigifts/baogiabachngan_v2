/** Home is loaded on demand and never mounts a second app or navigation footer. */
let style;
function loadStyle() {
  return style ||= new Promise((resolve,reject)=>{
    const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./home.css',import.meta.url).href;
    link.onload=resolve;link.onerror=()=>{style=null;link.remove();reject(Error('Chưa tải được giao diện Trang chủ.'));};document.head.append(link);
  });
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function initHome({root,api,user}) {
  let active=false,sequence=0;
  async function show(){
    active=true;const request=++sequence,who=user()?.id;root.dataset.ready='false';
    await loadStyle();if(!active||request!==sequence||who!==user()?.id)return;
    root.innerHTML='<header class="home-head"><h1>Trang chủ</h1><p>Việc cần làm và các chức năng của bạn</p></header><p role="status">Đang tải công việc…</p>';
    try{
      const data=await api('/tasks/home');if(!active||request!==sequence||who!==user()?.id)return;
      root.innerHTML=`<header class="home-head"><h1>Trang chủ</h1><p>${esc(user()?.name)} · ${data.scope==='all'?'Toàn bộ công việc':'Việc của tôi và nhóm'}</p></header>
        <div class="home-stats"><div>Việc đang mở <b>${data.counts.open}</b></div><div>Hôm nay <b>${data.counts.today}</b></div><div>Quá hạn <b>${data.counts.overdue}</b></div></div>
        <section class="card"><h2>Ưu tiên xử lý</h2>${data.tasks.map(t=>`<p><a href="#/tasks/${encodeURIComponent(t.id)}">${esc(t.title)}</a> · ${esc(t.assigneeName||t.teamName||'Chưa giao')}</p>`).join('')||'<p>Không có việc đang mở.</p>'}</section>`;
      root.dataset.ready='true';
    }catch(e){if(active&&request===sequence&&who===user()?.id){root.innerHTML=`<h1>Trang chủ</h1><p class="error" role="alert">${esc(e.message)}</p>`;root.dataset.ready='error';}}
  }
  return {show,hide(){active=false;sequence++;}};
}

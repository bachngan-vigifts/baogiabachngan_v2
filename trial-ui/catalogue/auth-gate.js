/** Load the editor only after CRM confirms the same-origin employee session. */
const storageKey='bn-v2-session',root=document.querySelector('#app');
const session=()=>{try{return localStorage.getItem(storageKey)||sessionStorage.getItem(storageKey)||'';}catch{return '';}};
const initial=session();let started=false,checking=null;
function wall(message,retry=false){
 root.hidden=true;let area=document.querySelector('#catalogue-auth');if(!area){area=document.createElement('section');area.id='catalogue-auth';area.className='catalogue-auth';document.body.append(area);}
 area.replaceChildren();const title=document.createElement('h1');title.textContent='Catalogue nội bộ CRM';const text=document.createElement('p');text.textContent=message;
 const link=document.createElement('a');link.className='btn primary';link.href=new URL('../',location.href).href;link.textContent='Đăng nhập tại CRM';area.append(title,text,link);
 if(retry){const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Kiểm tra lại';button.onclick=()=>check();area.append(button);}
}
async function forget(){try{await fetch(new URL('api/session',import.meta.url),{method:'DELETE',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)});}catch{/* The next bootstrap still requires an explicit CRM token. */}}
async function check(){
 if(checking)return checking;
 checking=(async()=>{
  const token=session();
  if(token!==initial){root.hidden=true;await forget();location.reload();return;}
  if(!token){wall('Đăng nhập bằng tài khoản nhân viên CRM để mở catalogue.');await forget();return;}
  try{
   const response=await fetch(new URL('api/session',import.meta.url),{method:'POST',credentials:'same-origin',cache:'no-store',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
   const result=await response.json();if(token!==session()){await forget();location.reload();return;}
   if(!response.ok){wall(result.error||'Chưa xác minh được phiên CRM.',![401,403].includes(response.status));return;}
   window.catalogueStaff=result.user;
   if(!started){
    for(const name of ['qrcode.min.js','pptxgen.bundle.js','pdf-lib.min.js','xlsx.full.min.js'])await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('vendor/'+name,import.meta.url).href;script.onload=resolve;script.onerror=()=>reject(Error('Chưa tải được thư viện báo giá. Thử lại sau.'));document.body.append(script);});
    if(token!==session()){await forget();location.reload();return;}
    // Propagate the stamped loader version to the dynamically imported entry.
    await import('./app.js'+new URL(import.meta.url).search);started=true;
   }
   if(token!==session()){await forget();location.reload();return;}
   document.querySelector('#catalogue-auth')?.remove();root.hidden=false;
  }catch{wall('Chưa xác minh được phiên CRM hoặc tải giao diện. Bản báo giá trên máy vẫn được giữ.',true);}
 })();try{await checking;}finally{checking=null;}
}
wall('Đang xác minh phiên đăng nhập CRM…');check();
window.addEventListener('storage',e=>{if(e.key===storageKey||e.key===null)check();});
window.addEventListener('focus',check);window.addEventListener('pageshow',e=>{if(e.persisted){root.hidden=true;check();}});
setInterval(check,120000);

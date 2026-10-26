import { bindForgotPassword } from './forgot-password.js';
import { apiFetch } from './api-transport.js';
import { initEarlyRequests } from './purchase-early-requests.js';
import { installBusyButtons, withBusy } from './busy-buttons.js';
const API=document.querySelector('meta[name="bn-api"]')?.content||'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff';
const key='bn-v2-session',$=id=>document.getElementById(id);let token='';
try{token=localStorage.getItem(key)||sessionStorage.getItem(key)||'';}catch{}
const saveToken=value=>{token=value||'';try{if(token)localStorage.setItem(key,token);else localStorage.removeItem(key);sessionStorage.removeItem(key);}catch{}};
installBusyButtons();
function api(path,method='GET',body){return withBusy(method,apiRequest(path,method,body),path);}
async function apiRequest(path,method='GET',body) {
  const headers={'content-type':'application/json'};if(token)headers.authorization='Bearer '+token;
  let r;try{r=await apiFetch(API+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});}catch{throw Error('Không kết nối được máy chủ. Vui lòng thử lại.');}
  const d=await r.json();if(d.sessionToken!==undefined)saveToken(d.sessionToken);
  if(!r.ok){if(r.status===401&&!path.startsWith('/login')){$('supplier-auth').hidden=false;$('supplier-requests').hidden=true;}
    throw Object.assign(Error(d.error||'Không thực hiện được.'),{status:r.status});}return d;
}
bindForgotPassword({button:$('supplier-forgot-password'),api,email:()=>$('login-name').value,audience:'supplier'});
const list=initEarlyRequests({api,host:$('supplier-requests'),portal:true});
async function enter(){
  $('supplier-error').textContent='';
  try{const {user}=await api('/me');
    if(user.role!=='manager'&&user.role!=='supplier'&&user.positionId!=='supplier')throw Error('Trang dành cho NCC và Manager xem đối chiếu. Nhân viên dùng trang Đơn mua NCC.');
    $('supplier-auth').hidden=true;$('logout').hidden=false;$('supplier-requests').hidden=false;
    $('supplier-who').textContent=user.name+(user.role==='manager'?' · Chỉ xem, không phản hồi thay NCC':'');
    await list.load(new URLSearchParams(location.search).get('request')||'');
  }catch(e){$('supplier-error').textContent=e.message;if(e.status===401)$('supplier-auth').hidden=false;}
}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();$('login-submit').disabled=true;$('supplier-error').textContent='';
  try{await api('/login','POST',{email:$('login-name').value.trim(),password:$('login-password').value});$('login-password').value='';await enter();}
  catch(e){$('supplier-error').textContent=e.message;}finally{$('login-submit').disabled=false;}
});
$('logout').addEventListener('click',async()=>{try{await api('/logout','POST',{});saveToken('');location.reload();}catch(e){$('supplier-error').textContent=e.message;}});
enter();

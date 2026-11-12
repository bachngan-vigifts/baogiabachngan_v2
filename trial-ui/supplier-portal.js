import { bindForgotPassword } from './forgot-password.js';
import { mountTurnstile } from './turnstile.js';
import { apiFetch, writeFailureMessage, UNKNOWN_OUTCOME } from './api-transport.js';
import { initEarlyRequests } from './purchase-early-requests.js';
import { openSupplierRequestDetails } from './supplier-request-details.js';
import { installBusyButtons, withBusy } from './busy-buttons.js';
const API=document.querySelector('meta[name="bn-api"]')?.content||'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff';
const key='bn-v2-session',$=id=>document.getElementById(id);let token='';
try{token=localStorage.getItem(key)||sessionStorage.getItem(key)||'';}catch{}
const saveToken=value=>{token=value||'';try{if(token)localStorage.setItem(key,token);else localStorage.removeItem(key);sessionStorage.removeItem(key);}catch{}};
installBusyButtons();
let loginBot=null,loginBusy=false;
function showAuth(){
  $('supplier-startup').hidden=true;$('supplier-auth').hidden=false;$('supplier-workspace').hidden=true;$('supplier-requests').hidden=true;
  loginBot ||= mountTurnstile({api,before:$('login-submit'),action:'login'});
}
function api(path,method='GET',body){return withBusy(method,apiRequest(path,method,body),path);}
async function apiRequest(path,method='GET',body) {
  const headers={'content-type':'application/json'};if(token)headers.authorization='Bearer '+token;
  let r;try{r=await apiFetch(API+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});}catch{throw method==='GET'?Error('Không kết nối được máy chủ. Vui lòng thử lại.'):Object.assign(Error(writeFailureMessage(body)),{status:0,code:UNKNOWN_OUTCOME});}
  const d=await r.json();if(d.sessionToken!==undefined)saveToken(d.sessionToken);
  if(!r.ok){if(r.status===401&&!path.startsWith('/login')){document.querySelectorAll('.supplier-detail-dialog').forEach(d=>d.close());showAuth();}
    throw Object.assign(Error(d.error||'Không thực hiện được.'),{status:r.status});}return d;
}
bindForgotPassword({button:$('supplier-forgot-password'),api,email:()=>$('login-name').value,audience:'supplier'});
let canBrowse=false;
const list=initEarlyRequests({api,host:$('supplier-requests'),portal:true,portalNavigation:{canBrowse:()=>canBrowse,onDetail:request=>{if(canBrowse)openSupplierRequestDetails({api,request});}}});
async function enter(){
  $('supplier-error').textContent='';
  try{const {user}=await api('/me');
    if(user.role!=='manager'&&user.role!=='supplier'&&user.positionId!=='supplier')throw Error('Trang dành cho NCC và Manager xem đối chiếu. Nhân viên dùng trang Đơn mua NCC.');
    document.querySelectorAll('.supplier-detail-dialog').forEach(d=>d.close());
    canBrowse=user.role==='manager'&&user.positionId!=='supplier';
    const id=new URLSearchParams(location.search).get('request')||'';
    $('supplier-back').href=canBrowse?'/#/early-requests'+(id?'/'+encodeURIComponent(id):''):location.pathname;
    $('supplier-back').textContent=canBrowse?'‹ Về Lấy hàng trước':'‹ Quay lại danh sách';
    $('supplier-back').hidden=!canBrowse&&!id;
    $('supplier-startup').hidden=true;$('supplier-auth').hidden=true;$('supplier-workspace').hidden=false;$('logout').hidden=false;$('supplier-requests').hidden=false;
    $('supplier-who').textContent=user.name+(user.role==='manager'?' · Chỉ xem, không phản hồi thay NCC':'');
    await list.load(new URLSearchParams(location.search).get('request')||'');
  }catch(e){$('supplier-startup').hidden=true;$('supplier-error').textContent=e.message;if(e.status===401||$('supplier-workspace').hidden){showAuth();$('supplier-auth-error').textContent=e.message;}}
}
$('supplier-show-password').addEventListener('change',e=>{$('login-password').type=e.target.checked?'text':'password';});
$('login-form').addEventListener('submit',async e=>{e.preventDefault();if(loginBusy||!e.currentTarget.reportValidity())return;loginBusy=true;$('login-submit').disabled=true;$('supplier-auth-error').textContent='';
  try{if(loginBot)await loginBot.ready;await api('/login','POST',{email:$('login-name').value.trim(),password:$('login-password').value,turnstileToken:loginBot?.token()||''});$('login-password').value='';$('supplier-show-password').checked=false;$('login-password').type='password';await enter();}
  catch(e){loginBot?.reset();$('supplier-auth-error').textContent=e.message;}finally{loginBusy=false;$('login-submit').disabled=false;}
});
$('logout').addEventListener('click',async()=>{try{await api('/logout','POST',{});saveToken('');location.reload();}catch(e){$('supplier-error').textContent=e.message;}});
enter();

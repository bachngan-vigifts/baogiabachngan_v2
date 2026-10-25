const API=document.querySelector('meta[name="bn-api"]')?.content||'https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.hash.slice(1));
let token=params.get('token')||'',busy=false;
const portal=params.get('portal');
history.replaceState(null,'',location.pathname+location.search);
$('reset-login').href=portal==='supplier'?'supplier.html':portal==='customer'?'customer.html':'index.html';
const form=$('reset-form'),note=$('reset-note'),error=$('reset-error'),submit=$('reset-submit');
async function api(path,body){
  let r;try{r=await fetch(API+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}catch{throw Error('Không kết nối được máy chủ. Vui lòng thử lại.');}
  const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(d.error||'Không xử lý được liên kết.'),{status:r.status});return d;
}
$('reset-show').addEventListener('change',e=>{for(const name of ['password','password2'])form.elements[name].type=e.target.checked?'text':'password';});
form.addEventListener('submit',async e=>{
  e.preventDefault();if(busy||!token||!form.reportValidity())return;error.textContent='';
  if(form.elements.password.value!==form.elements.password2.value){error.textContent='Hai lần nhập mật khẩu chưa khớp.';return;}
  busy=true;submit.disabled=true;
  try{await api('/activate',{token,password:form.elements.password.value});token='';form.reset();form.hidden=true;note.textContent='Đã đặt mật khẩu mới. Vui lòng đăng nhập lại.';}
  catch(e){error.textContent=e.message;if(e.status===400&&e.message.startsWith('Liên kết')){token='';form.hidden=true;note.textContent='Liên kết không còn hiệu lực. Về đăng nhập và bấm Quên mật khẩu để nhận link mới.';}}
  finally{busy=false;submit.disabled=false;}
});
async function check(){
  if(!/^[a-f0-9]{64}$/.test(token)){note.textContent='Liên kết không hợp lệ hoặc đã hết hạn. Về đăng nhập và bấm Quên mật khẩu để nhận link mới.';return;}
  try{const info=await api('/activation-info',{token});note.textContent='Đặt mật khẩu mới cho '+info.email+' (8–128 ký tự).';form.hidden=false;}
  catch(e){if(e.status===400){token='';note.textContent='Liên kết không còn hiệu lực. Về đăng nhập và bấm Quên mật khẩu để nhận link mới.';return;}note.textContent=e.message;const retry=document.createElement('button');retry.type='button';retry.className='btn secondary';retry.textContent='Kiểm tra lại liên kết';retry.onclick=()=>{retry.remove();check();};note.after(retry);}
}
check();

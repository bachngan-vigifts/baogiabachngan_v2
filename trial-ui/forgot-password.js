/** Shared recovery dialog: account existence and recovery tokens are never returned to this form. */
export function bindForgotPassword({button,api,email=()=>'',audience}) {
  button?.addEventListener('click',()=>{
    const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
    const dialog=el('dialog','modal'),form=el('form','modal-body'),title=el('h2','','Quên mật khẩu');
    const label=el('label','','Email đã đăng ký'),input=el('input');input.type='email';input.required=true;input.maxLength=254;input.autocomplete='email';input.autocapitalize='none';input.setAttribute('aria-label','Email nhận liên kết đặt lại mật khẩu');
    const initial=email();input.value=initial.includes('@')?initial:'';label.append(input);
    const note=el('p','muted','Nhập email của tài khoản NCC hoặc khách hàng. Hệ thống sẽ gửi liên kết đặt mật khẩu mới nếu tài khoản hợp lệ.');
    const message=el('p');message.setAttribute('role','status');
    const actions=el('div','row-gap'),submit=el('button','btn primary','Gửi liên kết đặt lại'),close=el('button','btn secondary','Đóng');submit.type='submit';close.type='button';
    dialog.setAttribute('aria-label','Quên mật khẩu');
    let busy=false;
    close.addEventListener('click',()=>{if(!busy)dialog.close();});
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(busy||!form.reportValidity())return;busy=true;submit.disabled=close.disabled=input.disabled=true;message.textContent='Đang xử lý…';
      try{const result=await api('/forgot-password','POST',{email:input.value.trim(),...(audience?{audience}:{})});message.className='';message.textContent=result.message;}
      catch(e){message.className='error';message.textContent=e?.status===404?'Chức năng đặt lại mật khẩu đang được cập nhật. Vui lòng thử lại sau ít phút.':e?.message||'Không gửi được yêu cầu. Vui lòng thử lại.';}
      finally{busy=false;submit.disabled=close.disabled=input.disabled=false;}
    });
    actions.append(submit,close);form.append(title,note,label,message,actions);dialog.append(form);document.body.append(dialog);
    dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();input.focus();
  });
}

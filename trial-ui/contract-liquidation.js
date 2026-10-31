const el=(tag,cls='',text)=>{const n=document.createElement(tag);n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const button=(text,fn,cls='btn secondary small')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;};
const labels={none:'Chưa thanh lý',pending:'Chờ Manager duyệt thanh lý',approved:'Đã thanh lý',rejected:'Thanh lý bị từ chối',superseded:'Đề nghị cũ',review_required:'Cần rà soát thanh lý'};
const stamp=value=>value?new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}):'—';
/** Independent state: signing/completion alone never creates a green liquidation badge. */
export function mountContractLiquidation({api,host,contract,compressPhoto,confirmBox,toast,isCurrent}){
 const badge=host.querySelector('.contract-liquidation-status'),actions=host.querySelector('.contract-liquidation-actions');
 if(!badge||!actions)return;
 const current=()=>badge.isConnected&&isCurrent();let data=null,seq=0;
 function paint(state){badge.textContent=labels[state]||labels.none;badge.className='contract-liquidation-status pill '+(state==='approved'?'ok':state==='pending'?'warn':state==='review_required'?'danger-text':'muted');}
 async function refresh(){
  const run=++seq;try{const d=await api('/contracts/'+encodeURIComponent(contract.id)+'/liquidation');if(!current()||run!==seq)return;
   data=d;paint(d.state);actions.replaceChildren(button(d.canReview?'Xét duyệt thanh lý':d.canRequest?'Đề nghị thanh lý':'Xem hồ sơ thanh lý',()=>open()));return d;
  }catch(e){if(!current()||run!==seq)return;badge.textContent='Chưa cập nhật được thanh lý';badge.className='contract-liquidation-status pill muted';actions.replaceChildren(el('p','small muted',e.message),button('Tải lại thanh lý',refresh));}
 }
 async function open(){
  try{const fresh=await refresh();if(!current()||!fresh)return;show(fresh);}catch(e){if(current())toast(e.message,'err');}
 }
 function show(d){
  const dialog=el('dialog','modal contract-liquidation-dialog');dialog.setAttribute('aria-label','Thanh lý HĐKT '+d.contractNo);
  const head=el('div','modal-head'),body=el('div','modal-body'),foot=el('div','modal-foot');
  let busy=false,attempt=null,reviewAttempt=null,photo=null,photoRun=0;
  const close=()=>{if(busy)return;dialog.close();dialog.remove();};
  head.append(el('h2','','Thanh lý '+d.contractNo),button('×',close,'icon-btn'));
  body.append(el('p','small muted','Chỉ Manager duyệt thanh lý sau khi hoàn tất nghĩa vụ và đối chiếu hồ sơ gốc. Đánh dấu đã ký không tự thanh lý.'));
  const checks=el('ul','contract-liquidation-checks');for(const c of d.proof.checks)checks.append(el('li',c.ok?'ok-text':'danger-text',(c.ok?'✓ ':'• ')+c.label));body.append(checks);
  body.append(el('p','small muted','Còn chưa giao: '+d.proof.remainingQty+' · Chênh lệch thu/hoàn tiền: '+Number(d.proof.balance).toLocaleString('vi-VN')+' ₫'));
  if(d.state==='review_required'||d.current&&d.current.status==='pending'&&d.current.snapshotHash!==d.proof.hash)body.append(el('p','error','Nghĩa vụ/nội dung HĐKT đã đổi so với hồ sơ đề nghị. Cần kiểm tra và lập lại hồ sơ phù hợp; không duyệt theo bản cũ.'));
  if(d.current){
   const r=d.current;body.append(el('p','',(d.state==='review_required'?'Đã duyệt trước đây – cần rà soát':labels[r.status])+' · '+r.requestedByName+' · '+stamp(r.requestedAt)));
   if(r.reviewedAt)body.append(el('p','small muted',r.reviewedByName+' · '+stamp(r.reviewedAt)+(r.reviewNote?' · '+r.reviewNote:'')));
  }
  const error=el('p','error');error.setAttribute('role','alert');
  const locked=(on,primary,text)=>{busy=on;dialog.dataset.busy=on?'1':'';for(const x of dialog.querySelectorAll('button,input,textarea')){if(on){x.dataset.wasDisabled=x.disabled?'1':'';x.disabled=true;}else if(x.dataset.wasDisabled!==undefined){x.disabled=x.dataset.wasDisabled==='1';delete x.dataset.wasDisabled;}}if(primary&&text)primary.textContent=text;};
  async function saved(result){paint(result.status);close();toast(result.status==='approved'?'Manager đã duyệt thanh lý HĐKT.':result.status==='pending'?'Đã gửi Manager duyệt thanh lý.':'Đã từ chối đề nghị thanh lý.');await refresh();}
  if(d.canRequest){
   const form=el('form','contract-liquidation-form'),received=el('input'),services=el('input'),file=el('input'),preview=el('img','contract-liquidation-photo');
   for(const box of [received,services]){box.type='checkbox';box.required=true;}
   const row=(input,text)=>{const label=el('label','contract-liquidation-ack');label.append(input,document.createTextNode(text));return label;};
   form.append(row(received,'Tôi đã nhận đủ hồ sơ gốc của HĐKT về công ty'),row(services,'Toàn bộ dịch vụ/khoản phí và nghĩa vụ khác trong HĐKT đã hoàn thành'));
   file.type='file';file.accept='image/jpeg,image/png,image/webp';file.setAttribute('capture','environment');file.required=true;file.setAttribute('aria-label','Ảnh hồ sơ gốc HĐKT');
   const photoLabel=el('label','','Chụp/chọn 1 ảnh hồ sơ gốc');photoLabel.append(file);preview.alt='Ảnh hồ sơ gốc đang chọn';preview.hidden=true;
   const submit=el('button','btn primary','Gửi Manager duyệt thanh lý');submit.type='submit';submit.disabled=!d.proof.ready;
   if(!d.proof.ready)form.append(el('p','error','Hoàn tất các điều kiện còn thiếu trước khi gửi đề nghị.'));
   file.addEventListener('change',async()=>{if(attempt)return;const run=++photoRun;photo=null;preview.hidden=true;submit.disabled=true;error.textContent='';
    try{if(!file.files?.[0])return;const image=await compressPhoto(file.files[0]);if(run===photoRun&&dialog.open){photo=image;preview.src=image;preview.hidden=false;}}catch(e){error.textContent=e.message;}finally{if(run===photoRun)submit.disabled=!d.proof.ready;}
   });
   form.append(photoLabel,preview,submit);body.append(form);
   form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy||!current())return;
    if(!attempt){if(!form.reportValidity()||!photo||!d.proof.ready){error.textContent='Xác nhận đủ hồ sơ/nghĩa vụ và chọn đúng 1 ảnh trước khi gửi.';return;}
     attempt={clientKey:crypto.randomUUID(),originalsReceived:true,servicesCompleted:true,photos:[photo],expectedHash:d.proof.hash};}
    error.textContent='';locked(true,submit,'Đang gửi đề nghị…');let result;
    try{result=await api('/contracts/'+encodeURIComponent(contract.id)+'/liquidation','POST',attempt);}catch(ex){
     error.textContent=ex.message;locked(false,submit,'Gửi Manager duyệt thanh lý');
     if(!ex.status||ex.status>=500){for(const x of form.querySelectorAll('input'))x.disabled=true;submit.textContent='Kiểm tra lại lần gửi';error.textContent+=' Chưa rõ kết quả. Gửi lại giữ đúng mã và ảnh này.';}
     else{submit.disabled=true;error.textContent+=' Đóng và tải lại điều kiện trước khi gửi lại.';}return;
    }
    locked(false);if(current())await saved(result);else close();
   });
  }
  const image=d.current?.photoUrl?el('img','contract-liquidation-photo'):null;
  if(image){image.alt='Ảnh hồ sơ gốc đã gửi';image.src=d.current.photoUrl;body.append(el('h3','','Ảnh hồ sơ đã gửi'),image);}
  else if(d.canReview)body.append(el('p','error','Chưa tải được ảnh hồ sơ. Có thể từ chối để bổ sung ảnh; chưa thể duyệt.'));
  if(d.canReview){
    let loaded=false;const note=el('textarea');note.maxLength=1000;note.setAttribute('aria-label','Ý kiến xét duyệt thanh lý');note.placeholder='Ý kiến / lý do từ chối (ít nhất 3 ký tự khi từ chối)';
    const ack=el('input');ack.type='checkbox';const label=el('label','contract-liquidation-ack');label.append(ack,document.createTextNode('Tôi đã đối chiếu ảnh, hồ sơ gốc và toàn bộ nghĩa vụ HĐKT'));
    const valid=d.proof.ready&&d.current.snapshotHash===d.proof.hash;
    const approve=button('Duyệt thanh lý',()=>review('approved',approve),'btn primary'),reject=button('Từ chối thanh lý',()=>review('rejected',reject),'btn danger-outline');approve.disabled=true;
    image?.addEventListener('load',()=>{loaded=true;approve.disabled=!valid;});image?.addEventListener('error',()=>{loaded=false;approve.disabled=true;error.textContent='Chưa tải được ảnh minh chứng. Đóng và mở lại hồ sơ để thử lại.';});
    body.append(note,label);foot.append(reject,approve);
    async function review(decision,primary){
     if(busy||!current())return;if(!reviewAttempt){if(decision==='approved'&&(!ack.checked||!loaded||!valid)){error.textContent='Cần xem ảnh, kiểm tra nghĩa vụ và xác nhận hồ sơ gốc.';return;}if(decision==='rejected'&&note.value.trim().length<3){error.textContent='Nhập lý do từ chối ít nhất 3 ký tự.';return;}}
     locked(true,primary,'Đang xử lý…');error.textContent='';let result;
     try{
      if(!reviewAttempt){if(!await confirmBox((decision==='approved'?'Duyệt thanh lý ':'Từ chối thanh lý ')+d.contractNo+'?',{title:'Xét duyệt thanh lý',ok:decision==='approved'?'Duyệt thanh lý':'Từ chối',danger:decision==='rejected'})){locked(false,primary,decision==='approved'?'Duyệt thanh lý':'Từ chối thanh lý');return;}
       reviewAttempt={decision,note:note.value.trim(),revision:d.current.revision,expectedHash:d.proof.hash,confirmOriginals:ack.checked};}
      if(!current()){locked(false);close();return;}
      result=await api('/contracts/'+encodeURIComponent(contract.id)+'/liquidation/'+encodeURIComponent(d.current.id)+'/review','POST',reviewAttempt);
     }catch(ex){error.textContent=ex.message;locked(false,primary,'Thử lại quyết định này');
      if(!ex.status||ex.status>=500){note.disabled=ack.disabled=true;(reviewAttempt?.decision==='approved'?reject:approve).disabled=true;error.textContent+=' Chưa rõ kết quả; thử lại giữ nguyên quyết định.';}else{approve.disabled=reject.disabled=true;error.textContent+=' Đóng và mở lại hồ sơ để kiểm tra.';}return;
     }
     locked(false);if(current())await saved(result);else close();
    }
  }
  if(d.history.length){const history=el('details');history.append(el('summary','','Lịch sử đề nghị thanh lý'));for(const r of d.history)history.append(el('p','small',stamp(r.requestedAt)+' · '+r.requestedByName+' · '+labels[r.status]+(r.reviewNote?' · '+r.reviewNote:'')));body.append(history);}
  body.append(error);foot.append(button('Đóng',close));dialog.append(head,body,foot);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});document.body.append(dialog);dialog.showModal();
 }
 paint('none');actions.replaceChildren(el('span','small muted','Đang kiểm tra thanh lý…'));void refresh();
}

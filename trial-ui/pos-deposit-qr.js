/** Deposit QR identity survives expiry and uncertain responses; renewal never changes its reference. */
export function depositQrControls({el,button,modal,api,money,input,method,confirmed,total,payload,owner,changed,restore=null}) {
  const box=el('div','pos-deposit-controls'),presets=el('div','pos-deposit-presets'),status=el('p','pos-note');
  let request=restore?.id?{...restore,paid:false}:null,attempt=restore?.creationAttempt??null,state='unknown',creating=false,polling=false,disposed=false,qrModal=null;
  const identity=()=>JSON.stringify({owner:owner(),cart:payload(),total:total(),amount:Number(input.value)});
  let lastIdentity=identity();
  const matches=()=>request&&request.identity===identity();
  const valid=()=>input.value!==''&&Number.isSafeInteger(Number(input.value))&&Number(input.value)>0&&Number(input.value)<=total();
  const sameOwner=()=>{const known=request?.identity||attempt?.identity;try{return !known||JSON.parse(known).owner===owner();}catch{return false;}};
  for(const percent of [30,50,100])presets.append(button(percent+'%','btn secondary small',()=>{input.value=String(Math.round(total()*percent/100));input.dispatchEvent(new Event('input',{bubbles:true}));}));
  async function check(d){
    try{
      const result=await api('/pos/qr/'+d.id+'/status');
      if(disposed||request!==d||!sameOwner())return 'unknown';
      if(typeof result.paid!=='boolean'||typeof result.consumed!=='boolean')throw Error('Trạng thái chưa rõ');
      if(typeof result.expiresAt==='string')d.expiresAt=result.expiresAt;
      if(result.consumed||result.requiresReconciliation){state='blocked';confirmed.checked=false;}
      else if(result.paid){d.paid=true;state='paid';if(matches()){method.value='transfer';confirmed.checked=true;}}
      else state=Date.parse(d.expiresAt)<=Date.now()?'expired':'waiting';
      if(state!=='waiting'&&qrModal?.dlg.open)qrModal.close();
      changed();refresh();return state;
    }catch{if(request===d){state='unknown';if(qrModal?.dlg.open)qrModal.close();refresh();}return 'unknown';}
  }
  async function showQr(d){
    if(!matches()||state!=='waiting'||Date.parse(d.expiresAt)<=Date.now())return;
    const m=modal('QR thanh toán tiền cọc'),image=el('img','pos-qr');image.src=d.url;image.alt='QR chuyển khoản tiền cọc';
    const message=el('p','pos-note','SePay sẽ tự xác nhận khi tiền vào đúng tài khoản, nội dung và số tiền.'),target=el('select');target.setAttribute('aria-label','Cửa hàng nhận QR tiền cọc');
    m.body.append(el('h3','',money(d.amount)),image,el('p','',d.content),message,target);
    let options;try{options=await api('/pos/qr/'+d.id+'/share-options');for(const o of options.options)target.append(Object.assign(el('option','',o.name),{value:o.id}));if(options.chooseStore)target.prepend(Object.assign(el('option','','Chọn cửa hàng nhận QR'),{value:'',selected:true}));target.hidden=!options.chooseStore;}catch(e){message.textContent=e.message;}
    if(disposed||!matches()||request!==d||state!=='waiting'||Date.parse(d.expiresAt)<=Date.now()){m.close();return;}
    const send=button('Gửi QR sang điện thoại NVBH','btn secondary',async()=>{
      send.disabled=true;try{if(!matches()||request!==d||!target.value||await check(d)!=='waiting')return;
        await api('/pos/qr/'+d.id+'/share','POST',{targetRegisterId:target.value,key:crypto.randomUUID()});message.textContent='Đã gửi QR tiền cọc tới điện thoại NVBH.';
      }catch(e){message.textContent=e.message;}finally{send.disabled=false;}
    });send.disabled=!options?.options.length;
    m.body.append(send,button('Đóng','btn secondary',()=>m.close()));qrModal=m;m.show();
  }
  function verifyExpired(d){
    const m=modal('Kiểm tra tiền cọc trước khi dùng lại QR'),label=el('label','pos-note'),verified=el('input');verified.type='checkbox';
    label.append(verified,document.createTextNode(' Tôi đã kiểm tra tài khoản nhận và xác nhận chưa nhận khoản cọc này'));
    const note=el('p','pos-note','QR đã hết hạn. Chưa có báo tiền từ SePay không có nghĩa là khách chưa chuyển. Không yêu cầu khách trả lại nếu đã chuyển hoặc chưa kiểm tra được.');
    const renew=button('Dùng lại mã sau khi kiểm tra','btn secondary',async()=>{
      if(!verified.checked||!matches())return;renew.disabled=true;
      try{
        if(await check(d)!=='expired'){m.close();return;}
        const r=await api('/pos/qr/'+d.id+'/renew','POST',{...payload(),depositAmount:d.amount,confirmedUnpaid:true});
        if(disposed||request!==d)return;
        request={...r,identity:d.identity};changed();m.close();
        if(await check(request)==='waiting')await showQr(request);
      }catch(e){note.textContent=e.message||'Chưa xác minh được. Không yêu cầu khách chuyển lại.';await check(d);}finally{renew.disabled=!verified.checked;}
    });renew.disabled=true;verified.addEventListener('change',()=>renew.disabled=!verified.checked);
    m.body.append(note,label,renew,button('Đóng','btn secondary',()=>m.close()));m.show();
  }
  const create=button('Tạo / gửi mã thanh toán','btn secondary',async()=>{
    if(creating||!valid()||!sameOwner()||(matches()&&request.paid)||state==='blocked')return;
    creating=true;refresh();
    try{
      if(!request){
        // Persist before the request so a lost response (including reload) retries the SAME key/body.
        if(!attempt)attempt={identity:identity(),body:{...payload(),depositAmount:Number(input.value),key:crypto.randomUUID()}};
        changed();
        const d=await api('/pos/qr','POST',attempt.body);
        if(disposed)return;request={...d,identity:attempt.identity};state='unknown';changed();
      }
      const d=request,result=await check(d);
      if(!matches())return;
      if(result==='expired')verifyExpired(d);
      else if(result==='waiting')await showQr(d);
    }catch(e){state='unknown';status.textContent=e.message||'Chưa rõ kết quả tạo mã. Kiểm tra lại, không yêu cầu khách trả lần nữa.';}
    finally{creating=false;refresh();}
  });
  function refresh(){
    const current=identity();if(current!==lastIdentity){confirmed.checked=!!(matches()&&request.paid&&method.value==='transfer');lastIdentity=current;}
    create.disabled=creating||!valid()||!sameOwner()||!!(matches()&&request.paid)||state==='blocked';
    create.textContent=matches()&&request.paid?'Đã nhận tiền cọc':request&&(state!=='waiting'||Date.parse(request.expiresAt)<=Date.now())?'Kiểm tra trạng thái QR':attempt&&!request?'Kiểm tra kết quả tạo QR':'Tạo / gửi mã thanh toán';
    if(request&&!matches())status.textContent=request.paid?'QR cũ đã nhận tiền. Khôi phục giỏ cũ hoặc đối soát; không thu lại.':'Giỏ hoặc tiền cọc đã đổi. Khôi phục giỏ cũ hoặc đối soát QR trước; không tạo khoản thu thứ hai.';
    else if(state==='blocked')status.textContent='QR đã được dùng hoặc cần đối soát. Không yêu cầu khách chuyển lại.';
    else if(request&&state==='paid')status.textContent='SePay đã xác nhận tiền cọc.';
    else if(request&&state==='unknown')status.textContent='Không kiểm tra được trạng thái QR. Không yêu cầu khách chuyển thêm; kiểm tra lại khi có kết nối.';
    else if(request&&(state==='expired'||Date.parse(request.expiresAt)<=Date.now()))status.textContent='QR hết hạn. Kiểm tra trạng thái và tài khoản nhận trước khi dùng lại mã; không yêu cầu khách trả lần nữa nếu đã chuyển.';
    else if(request&&state==='waiting')status.textContent='Chờ chuyển khoản tiền cọc '+money(request.amount)+'.';
    else if(request||attempt)status.textContent='Chưa xác minh được trạng thái QR. Kiểm tra lại; không yêu cầu khách chuyển thêm.';
    else status.textContent='Chọn mức cọc hoặc nhập tiền, rồi tạo QR hoặc xác nhận đã nhận tiền.';
  }
  const timer=setInterval(async()=>{
    if(disposed||!input.isConnected){clearInterval(timer);return;}
    if(polling||creating||!request||request.paid||!sameOwner())return;
    polling=true;try{await check(request);}finally{polling=false;}
  },2000);
  box.append(presets,create,status);refresh();
  return {box,refresh,snapshot:()=>request||attempt?{...request,creationAttempt:attempt}:null,requestId:()=>matches()?request.id:undefined,dispose:()=>{disposed=true;clearInterval(timer);}};
}

/** Deposit QR stays separate from the full-payment QR and never submits a delivery. */
export function depositQrControls({el,button,modal,api,money,input,method,confirmed,total,payload,owner,changed,restore=null}) {
  const box=el('div','pos-deposit-controls'),presets=el('div','pos-deposit-presets'),status=el('p','pos-note');
  let request=restore?{...restore,paid:false}:null,creating=false,polling=false,disposed=false,attempt=null,qrModal=null;
  const identity=()=>JSON.stringify({owner:owner(),cart:payload(),total:total(),amount:Number(input.value)});
  let lastIdentity=identity();
  const matches=()=>request&&request.identity===identity();
  const valid=()=>input.value!==''&&Number.isSafeInteger(Number(input.value))&&Number(input.value)>0&&Number(input.value)<=total();
  for(const percent of [30,50,100])presets.append(button(percent+'%','btn secondary small',()=>{input.value=String(Math.round(total()*percent/100));input.dispatchEvent(new Event('input',{bubbles:true}));}));
  const create=button('Tạo / gửi mã thanh toán','btn secondary',async()=>{
    if(creating||!valid()||(matches()&&request.paid))return;
    const started=identity();creating=true;create.disabled=true;status.textContent='Đang tạo mã tiền cọc…';
    try{
      if(!matches()||(!request.paid&&Date.parse(request.expiresAt)<=Date.now())){
        if(attempt?.identity!==started)attempt={identity:started,key:crypto.randomUUID()};
        const d=await api('/pos/qr','POST',{...payload(),depositAmount:Number(input.value),key:attempt.key});
        if(disposed||identity()!==started)return;
        request={...d,identity:started};method.value='transfer';confirmed.checked=false;changed();
      }
      const d=request,m=modal('QR thanh toán tiền cọc'),image=el('img','pos-qr');image.src=d.url;image.alt='QR chuyển khoản tiền cọc';
      const message=el('p','pos-note','SePay sẽ tự xác nhận khi tiền vào đúng tài khoản, nội dung và số tiền.'),target=el('select');target.setAttribute('aria-label','Cửa hàng nhận QR tiền cọc');
      m.body.append(el('h3','',money(d.amount)),image,el('p','',d.content),message,target);
      let options;try{options=await api('/pos/qr/'+d.id+'/share-options');for(const o of options.options)target.append(Object.assign(el('option','',o.name),{value:o.id}));if(options.chooseStore)target.prepend(Object.assign(el('option','','Chọn cửa hàng nhận QR'),{value:'',selected:true}));target.hidden=!options.chooseStore;}catch(e){message.textContent=e.message;}
      if(disposed||!matches()||request!==d){m.close();return;}
      const send=button('Gửi QR sang điện thoại NVBH','btn secondary',async()=>{
        if(!matches()||request!==d||d.paid||!target.value)return;
        send.disabled=true;try{await api('/pos/qr/'+d.id+'/share','POST',{targetRegisterId:target.value,key:crypto.randomUUID()});message.textContent='Đã gửi QR tiền cọc tới điện thoại NVBH.';}catch(e){message.textContent=e.message;}finally{send.disabled=false;}
      });send.disabled=!options?.options.length||!!d.paid;
      m.body.append(send,button('Đóng','btn secondary',()=>m.close()));qrModal=m;m.show();refresh();
    }catch(e){status.textContent=e.message||'Chưa tạo được QR tiền cọc.';}finally{creating=false;create.disabled=!valid()||!!(matches()&&request.paid);}
  });
  function refresh(){
    const current=identity();if(current!==lastIdentity){confirmed.checked=!!(matches()&&request.paid&&method.value==='transfer');lastIdentity=current;}
    create.disabled=creating||!valid()||!!(matches()&&request.paid);
    create.textContent=matches()&&request.paid?'Đã nhận tiền cọc':'Tạo / gửi mã thanh toán';
    if(matches())status.textContent=request.paid?'SePay đã xác nhận tiền cọc.':'Chờ chuyển khoản tiền cọc '+money(request.amount)+'.';
    else if(request)status.textContent='Giỏ hoặc tiền cọc đã đổi. QR trước không áp dụng cho nội dung mới; kiểm tra khoản chuyển trước khi tạo mã khác.';
    else status.textContent='Chọn mức cọc hoặc nhập tiền, rồi tạo QR hoặc xác nhận đã nhận tiền.';
  }
  const timer=setInterval(async()=>{
    if(disposed||!input.isConnected){clearInterval(timer);return;}
    if(polling||!matches()||request.paid)return;
    const d=request;polling=true;
    try{const result=await api('/pos/qr/'+d.id+'/status');if(disposed||request!==d||!matches())return;
      if(result.consumed||result.requiresReconciliation){status.textContent='Khoản QR đã được dùng hoặc cần đối soát. Kiểm tra đơn trước khi tiếp tục.';return;}
      if(result.paid){d.paid=true;if(qrModal?.dlg.open)qrModal.close();method.value='transfer';confirmed.checked=true;changed();refresh();}
    }catch{/* Retry temporary network errors. */}finally{polling=false;}
  },2000);
  box.append(presets,create,status);refresh();
  return {box,refresh,snapshot:()=>request,requestId:()=>matches()?request.id:undefined,dispose:()=>{disposed=true;clearInterval(timer);}};
}

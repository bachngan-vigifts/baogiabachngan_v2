const seller = u => u?.role === 'employee' && (['sales-lock', 'sales-ml'].includes(u.positionId) || /^nvbh (lock|ml|minh long)$/.test(String(u.position || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase()));
const phone = () => /iphone|ipod|android.*mobile|mobile/i.test(navigator.userAgent) || matchMedia('(pointer: coarse) and (max-width: 900px)').matches;
function phoneDialog(doc, d, onDismiss, onReady) {
  const dlg=doc.createElement('dialog');dlg.className='pos-modal pos-step-modal pos-qr-phone';
  const head=doc.createElement('h2'),amount=doc.createElement('strong'),order=doc.createElement('p'),img=doc.createElement('img'),content=doc.createElement('p'),state=doc.createElement('p'),close=doc.createElement('button');
  head.textContent='QR thanh toán cho khách';amount.className='pos-qr-phone-amount';img.className='pos-qr';img.alt='Mã VietQR thanh toán';close.className='btn secondary';close.textContent='Đóng';
  dlg.append(head,amount,order,img,content,state,close);doc.body.append(dlg);
  let url='',closed=false;
  const end=()=>{if(closed)return;closed=true;dlg.close();dlg.remove();onDismiss();};close.addEventListener('click',end);dlg.addEventListener('cancel',e=>{e.preventDefault();end();});
  img.addEventListener('load',()=>{if(!closed){img.hidden=false;state.textContent='Đang chờ SePay xác nhận tiền vào…';onReady();}});
  img.addEventListener('error',()=>{img.hidden=true;state.textContent='Chưa tải được ảnh QR. Kiểm tra kết nối và mở lại mã.';});
  const update=x=>{
    let parsed;try{parsed=new URL(x.url);}catch{return;}
    if(parsed.protocol!=='https:'||parsed.hostname!=='img.vietqr.io')return;
    amount.textContent=Number(x.amount).toLocaleString('vi-VN')+' đ';order.textContent='Đơn: '+(x.orderNo||'');content.textContent='Nội dung: '+x.content;
    if(url!==x.url){url=x.url;img.hidden=true;state.textContent='Đang tải mã QR…';img.src=url;}else if(img.complete&&img.naturalWidth){img.hidden=false;state.textContent='Đang chờ SePay xác nhận tiền vào…';}
  };
  update(d);dlg.showModal();return {update,close:end,unavailable:()=>{img.hidden=true;state.textContent='Mất kết nối. Đang kiểm tra lại trạng thái thanh toán…';}};
}
/** One request at a time. Push wakes immediately; foreground polling is the fallback, never a payment writer. */
export function initQrPhoneReceiver({api,user,toast=()=>{},doc=document,win=window,mobile=phone,eligible=seller,render=phoneDialog,schedule=setTimeout,cancel=clearTimeout,now=()=>Date.now(),storage=null}){
  if(!storage){try{storage=win.sessionStorage;}catch{/* private browsing */}}
  let running=false,timer=null,expiry=null,busy=false,again=false,epoch=0,current=null,owner='',seen=new Set();
  const stopView=()=>{const old=current;current=null;cancel(expiry);expiry=null;old?.view.close();};
  const identity=()=>{const id=user()?.id||'';if(owner!==id){stopView();owner=id;try{seen=new Set(JSON.parse(storage?.getItem('bn-qr-phone:'+id)||'[]'));}catch{seen=new Set();}}return id;};
  const remember=id=>{seen.add(id);while(seen.size>30)seen.delete(seen.values().next().value);try{storage?.setItem('bn-qr-phone:'+owner,JSON.stringify([...seen]));}catch{/* private browsing */}};
  const visible=()=>doc.visibilityState!=='hidden';
  async function check(){
    cancel(timer);timer=null;const id=identity();
    if(!running||!id||!eligible(user())||!mobile()||!visible())return;
    if(busy){again=true;return;}busy=true;const version=epoch;
    try{
      const result=await api('/pos/qr-display/pending');
      if(!running||version!==epoch||id!==user()?.id||!visible())return;
      const d=result.display;
      if(!d){stopView();return;}
      if(d.state!=='pending'||!Number.isFinite(Date.parse(d.expiresAt))||now()>=Date.parse(d.expiresAt)){const had=!!current;stopView();if(had)toast(d.state==='paid'?'Đã xác nhận thanh toán.':'Mã QR đã hết hạn.');return;}
      if(current?.noteId===d.noteId){current.view.update(d);return;}
      if(seen.has(d.noteId))return;
      stopView();
      const ready=()=>{if(running&&id===user()?.id&&current?.noteId===d.noteId)api('/notifications/read','POST',{ids:[d.noteId]}).catch(()=>{});};
      const view=render(doc,d,()=>{if(current?.noteId===d.noteId){remember(d.noteId);cancel(expiry);current=null;}},ready);
      current={id:d.id,noteId:d.noteId,view};expiry=schedule(()=>{if(current?.noteId===d.noteId)stopView();},Math.max(0,Date.parse(d.expiresAt)-now()));
    }catch(e){current?.view.unavailable?.();if([401,403].includes(e?.status)){running=false;stopView();}}
    finally{busy=false;if(running&&visible()){const delay=again?0:2500;again=false;timer=schedule(check,delay);}}
  }
  const wake=()=>{if(running)check();};
  const visibility=()=>{if(!visible()){cancel(timer);timer=null;current?.view.unavailable?.();}else wake();};
  const message=e=>{if(e.data?.type==='bn-notification'&&e.data.note?.eventType==='pos_qr_display')wake();};
  doc.addEventListener('visibilitychange',visibility);win.addEventListener('focus',wake);win.addEventListener('online',wake);win.navigator?.serviceWorker?.addEventListener('message',message);
  return {start(){running=true;identity();check();},stop(){running=false;epoch++;cancel(timer);timer=null;again=false;stopView();owner='';},check};
}

import {initPurchaseIncoming} from './purchase-incoming.js';
/** Explicit source orders; save through the existing transactional/idempotent draft API. */
export function initEarlyQuickCreate({api,host,go,today,toast}){
 const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 let busy=false,active=true,attempt=null;
 const stillHere=()=>active&&host.isConnected&&location.hash.split('?')[0]==='#/early-requests/new';
 const info=node('section');info.className='card early-quick-info';
 const date=node('input');date.type='date';date.value=today();date.required=true;date.setAttribute('aria-label','Ngày lấy hàng');
 const label=node('label','Ngày lấy hàng *');label.className='early-page-field';label.append(date);
 info.append(label,node('p','Chọn mã hàng, đánh dấu các đơn mua nguồn và nhập số lượng từng đơn. Chỉ hiện đơn đã duyệt còn hàng đang về. Lưu nháp chưa gửi NCC, chưa nhận hàng và chưa cộng tồn.'));
 const error=node('p');error.className='error';error.setAttribute('role','alert');error.hidden=true;
 const fields=node('fieldset');fields.className='early-create-fields';
 const pickerHost=node('div');fields.append(pickerHost);host.replaceChildren(info,error,fields);
 const fail=message=>{error.textContent=message;error.hidden=!message;if(message)error.scrollIntoView({block:'nearest'});};
 date.addEventListener('input',()=>fail(''));
 const picker=initPurchaseIncoming({api,host:pickerHost,go,onCreate:async initial=>{
  if(busy||!active)return;fail('');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date.value)||!date.checkValidity()){fail('Nhập ngày lấy hàng hợp lệ.');date.focus();return;}
  const sources=JSON.parse(initial.scope.orderSources||'{}');
  if(initial.lines.some(l=>!sources[l.sku]?.length)){fail('Chọn ít nhất một đơn mua nguồn cho từng mã hàng.');return;}
  const lines=initial.lines.map(l=>({sku:l.sku,quantity:l.quantity,sourceOrders:sources[l.sku]}));
  const body={pickupDate:date.value,scope:initial.scope,lines},fingerprint=JSON.stringify(body);
  if(attempt?.fingerprint!==fingerprint)attempt={fingerprint,key:crypto.randomUUID()};
  busy=true;fields.disabled=date.disabled=true;
  try{const result=await api('/purchase-early-requests','POST',{...body,clientKey:attempt.key});if(stillHere()){toast('Đã tạo phiếu nháp. Kiểm tra phiếu trước khi gửi NCC.');go('#/early-requests/'+encodeURIComponent(result.id||result.request.id));}}
  catch(e){if(stillHere())fail(e.message||'Không lưu được phiếu. Kiểm tra lại và thử lại.');}
  finally{busy=false;if(active)fields.disabled=date.disabled=false;}
 }});
 return {show:()=>picker.show(),refresh:()=>picker.refresh(),hide(){active=false;picker.hide();}};
}

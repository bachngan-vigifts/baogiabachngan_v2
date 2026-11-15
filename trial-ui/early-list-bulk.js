import {openEarlyQuickReceipt} from './early-receipt-quick.js';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const button=(text,fn,cls='btn secondary')=>{const b=el('button',cls,text);b.type='button';b.dataset.noBusy='';b.onclick=fn;return b;};
const parts=r=>r.lines.flatMap(l=>l.allocations);
const pending=r=>r.requestStatus==='submitted'&&parts(r).some(a=>a.status==='pending');
const receivable=r=>r.requestStatus==='submitted'&&parts(r).some(a=>a.status==='accepted'&&a.remainingToReceive>0);
/** Selection is intentionally limited to the visible page and cleared on reload/filter/navigation. */
export function earlyListBulk({api,onSaved}){
 const host=el('div','early-list-bulk'),selected=new Map();let visible=[],canConfirm=false,canReceive=false,busy=false,generation=0;
 host.dataset.mobileActions='off';
 const all=el('input');all.type='checkbox';all.setAttribute('aria-label','Chọn tất cả phiếu có thể thao tác trên trang này');
 const label=el('label','early-list-select');label.append(all,el('span','','Chọn trang này'));
 const count=el('span','small'),confirm=button('Xác nhận thay NCC',()=>run('confirm'),'btn primary'),receive=button('Nhận hàng',()=>run('receive'),'btn primary'),clear=button('Bỏ chọn',()=>{selected.clear();sync();});
 const hint=el('p','small muted','Chọn phiếu trên trang này. Đổi trang hoặc bộ lọc sẽ bỏ chọn. Xác nhận NCC và nhận vào kho là hai thao tác riêng.'),error=el('p','error');error.setAttribute('role','alert');
 host.append(label,count,confirm,receive,clear,hint,error);host.hidden=true;
 const checks=new Map();
 const eligible=r=>(canConfirm&&pending(r))||(canReceive&&receivable(r));
 function sync(){count.textContent='Đã chọn '+selected.size+' phiếu';const none=!selected.size;confirm.hidden=!canConfirm||none;receive.hidden=!canReceive||none;count.hidden=clear.hidden=hint.hidden=none;host.dataset.selected=none?'0':'1';
  confirm.disabled=busy||![...selected.values()].some(pending);receive.disabled=busy||![...selected.values()].some(receivable);clear.disabled=busy||!selected.size;all.disabled=busy||!checks.size;
  for(const [id,input]of checks){input.checked=selected.has(id);input.disabled=busy;}
  all.checked=checks.size>0&&selected.size===checks.size;all.indeterminate=selected.size>0&&!all.checked;
 }
 all.onchange=()=>{selected.clear();if(all.checked)for(const r of visible)if(eligible(r))selected.set(r.id,r);sync();};
 function reset(requests=[],permissions={}){generation++;visible=requests;canConfirm=!!permissions.canViewPortal;canReceive=!!permissions.canReceive;selected.clear();checks.clear();error.textContent='';host.hidden=!canConfirm&&!canReceive;sync();}
 function checkbox(request){if(!eligible(request))return null;const input=el('input');input.type='checkbox';input.className='early-list-check';input.setAttribute('aria-label','Chọn phiếu '+(request.ticketNumber||request.id.slice(0,8).toUpperCase()));checks.set(request.id,input);input.onchange=()=>{if(input.checked)selected.set(request.id,request);else selected.delete(request.id);sync();};sync();return input;}
 async function fresh(ids){const requests=[];for(const id of ids){const data=await api('/purchase-early-requests?id='+encodeURIComponent(id));const request=data.requests.find(r=>r.id===id);if(!request)throw Error('Phiếu đã tách, huỷ hoặc thay đổi. Tải lại danh sách rồi chọn lại.');requests.push(request);}return requests;}
 async function run(action){if(busy||!selected.size)return;busy=true;const mine=generation;sync();error.textContent='';
  try{const requests=await fresh(visible.filter(r=>selected.has(r.id)).map(r=>r.id));if(mine!==generation)return;if(action==='confirm')review(requests);else await openEarlyQuickReceipt({api,requests,onSaved});}
  catch(e){if(mine===generation)error.textContent=e.message||'Không tải được các phiếu đã chọn.';}
  finally{busy=false;sync();}
 }
 function review(requests){
  const targets=requests.filter(pending),allocationIds=[...new Set(targets.flatMap(r=>parts(r).filter(a=>a.status==='pending').map(a=>a.id)))];
  const modal=el('dialog','modal early-request-dialog early-bulk-confirm'),head=el('div','modal-head'),body=el('div','modal-body'),foot=el('div','modal-foot');modal.dataset.mobileActions='off';let saving=false;
  const close=button('Đóng',()=>{if(!saving)modal.close();});head.append(el('h2','','Xác nhận thay NCC các phiếu đã chọn'),close);
  body.append(el('p','','Chỉ xác nhận các dòng đang chờ mà NCC đã đồng ý. Không nhận hàng hay cộng tồn kho. Các dòng đã phản hồi giữ nguyên.'));
  for(const r of targets)body.append(el('p','','Phiếu '+(r.ticketNumber||r.id.slice(0,8).toUpperCase())+' · '+r.lines.filter(l=>l.allocations.some(a=>a.status==='pending')).map(l=>l.sku+' · '+l.allocations.filter(a=>a.status==='pending').map(a=>a.supplierName+' / '+(a.supplierOrderNo||a.ticketNumber)+' / '+Number(a.quantity).toLocaleString('vi-VN')+' '+(l.unit||'')).join('; ')).join('; ')));
  const message=el('p','error');message.setAttribute('role','alert');body.append(message);
  const save=button('Xác nhận '+targets.length+' phiếu',async()=>{if(saving)return;saving=busy=true;close.disabled=save.disabled=true;sync();message.textContent='';
   try{await api('/purchase-early-requests/manager-confirm-batch','POST',{allocationIds});modal.close();await onSaved();}
   catch(e){message.textContent=e.message||'Không xác nhận được. Tải lại để kiểm tra.';}
   finally{saving=busy=false;close.disabled=save.disabled=false;sync();}
  },'btn primary');
  if(!allocationIds.length||allocationIds.length>300){save.disabled=true;message.textContent=allocationIds.length?'Mỗi lần tối đa 300 dòng phân bổ. Đóng và chọn ít phiếu hơn.':'Không còn dòng chờ xác nhận trong các phiếu đã chọn.';}
  foot.append(save);modal.append(head,body,foot);document.body.append(modal);modal.addEventListener('cancel',e=>{if(saving)e.preventDefault();});modal.addEventListener('close',()=>{busy=false;sync();modal.remove();},{once:true});modal.showModal();
 }
 return{host,reset,checkbox};
}

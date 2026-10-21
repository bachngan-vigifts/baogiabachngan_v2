const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;};
const btn=(text,fn,cls='btn secondary small')=>{const b=el('button',cls,text);b.type='button';b.addEventListener('click',fn);return b;};
const number=n=>Number(n||0).toLocaleString('vi-VN');
const date=d=>d?String(d).slice(0,10).split('-').reverse().join('/'):'Chưa nhập';
const time=d=>new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date(d));
const labels={draft:'Nháp — chưa gửi NCC',pending:'Chờ NCC xác nhận',accepted:'NCC đồng ý',rejected:'NCC từ chối',mixed:'NCC phản hồi khác nhau'};
export function initEarlyRequests({api,host,canWrite=()=>false,portal=false,supplierId='',onSaved=()=>{}}) {
  let requestNo=0,dialog=null;
  const title=el('h2','card-title',portal?'Yêu cầu xin lấy trước':'Phiếu xin lấy trước đã lưu'),list=el('div','early-request-list');
  host.append(title,list);
  async function load(id='') {
    const n=++requestNo;
    try {const params=new URLSearchParams();if(id)params.set('id',id);if(supplierId&&!portal)params.set('supplierId',supplierId);
      const data=await api((portal?'/supplier-portal/early-requests':'/purchase-early-requests')+(params.size?'?'+params:''));if(n!==requestNo)return;
      render(data.requests,!!data.canRespond,!!data.canViewPortal);return data.requests;
    } catch(e) {if(n===requestNo) list.replaceChildren(el('p','error',e.message||'Không tải được phiếu xin lấy trước.'));}
  }
  function render(requests,canRespond,canViewPortal) {
    list.replaceChildren();
    if(!requests.length) list.append(el('p','muted','Chưa có phiếu xin lấy trước.'));
    for(const request of requests) {
      const card=el('article','card early-request-card'),head=el('div','row-gap');card.dataset.requestId=request.id;
      head.append(el('strong','',`Phiếu lấy trước · ${time(request.createdAt)}`),el('span','sup-pill '+(request.status==='pending'?'warn':''),labels[request.status]||request.status));
      card.append(head,el('p','small','Ngày lấy: '+date(request.pickupDate)));
      if(!portal) {
        const open=el('a','small','Mở phiếu');open.href='#/purchases?mode=incoming&request='+encodeURIComponent(request.id);card.append(open);
        if(request.requestStatus==='draft'&&canWrite()) card.append(btn('Sửa phiếu nháp',()=>edit(request)));
        if(request.requestStatus==='submitted'&&canViewPortal){const link=el('a','small','Xem trên cổng NCC');link.href='supplier.html?request='+encodeURIComponent(request.id);link.target='_blank';link.rel='noopener';card.append(link);}
      }
      for(const line of request.lines) {
        const box=el('section','early-request-line');
        box.append(el('b','',`${line.sku} · ${line.name}`),el('p','',`${number(line.quantity)} ${line.unit||''} · ${labels[line.status]||line.status}`));
        for(const a of line.allocations) {
          const p=el('p','muted small');
          if(!portal) {const order=el('a','',a.ticketNumber);order.href='#/purchases/'+encodeURIComponent(a.orderId)+'?mode=incoming';p.append(order);}
          else p.append(el('span','',a.ticketNumber));
          p.append(el('span','',` · ${a.supplierName} · ${number(a.quantity)} · Hẹn ${date(a.due)} · ${labels[a.status]}`));
          if(a.respondedAt)p.append(el('span','',` · ${time(a.respondedAt)}`));if(a.responseNote)p.append(el('span','',' · '+a.responseNote));box.append(p);
        }
        if(portal&&canRespond&&line.status==='pending') {
          const note=el('input');note.type='text';note.maxLength=1000;note.placeholder='Ghi chú phản hồi (tùy chọn)';note.setAttribute('aria-label','Ghi chú mã '+line.sku);
          const error=el('p','error');error.setAttribute('role','alert');const actions=el('div','row-gap');let busy=false;
          const respond=async status=>{if(busy)return;busy=true;accept.disabled=reject.disabled=true;error.textContent='';
            try {await api('/supplier-portal/early-requests/'+encodeURIComponent(line.id)+'/respond','POST',{status,note:note.value.trim()});await load();}
            catch(e){error.textContent=e.message||'Không lưu được phản hồi.';busy=false;accept.disabled=reject.disabled=false;}
          };
          const accept=btn('Đồng ý mã '+line.sku,()=>respond('accepted'),'btn primary small'),reject=btn('Từ chối mã '+line.sku,()=>respond('rejected'));
          actions.append(accept,reject);box.append(note,actions,error);
        }
        card.append(box);
      }
      list.append(card);
    }
  }
  function edit(initial) {
    if(!canWrite()||portal)return;
    dialog?.close();dialog?.remove();
    const modal=dialog=el('dialog','modal early-request-dialog');document.body.append(modal);
    let draft=initial.id?initial:null,busy=false,dirty=!draft,lastAttempt=null;
    const form=el('form'),header=el('div','modal-head'),body=el('div','modal-body'),foot=el('div','modal-foot');
    header.append(el('h2','','Phiếu xin lấy trước — nháp'),btn('Đóng',()=>{if(!busy)dialog.close();}));
    const dateInput=el('input');dateInput.type='date';dateInput.value=initial.pickupDate||'';dateInput.setAttribute('aria-label','Ngày lấy');
    const label=el('label','','Ngày lấy');label.append(dateInput);
    const hint=el('p','muted small','Lưu nháp để chỉnh sửa. NCC chỉ thấy phiếu sau khi anh/chị bấm Gửi NCC.');
    const table=el('table','data-table'),head=el('thead'),tr=el('tr');for(const t of ['Mã hàng','Sản phẩm','SL cần lấy trước',''])tr.append(el('th','',t));head.append(tr);
    const rows=el('tbody'),fields=[];table.append(head,rows);const wrap=el('div','table-wrap');wrap.append(table);
    const error=el('p','error incoming-validation');error.hidden=true;error.setAttribute('role','alert');
    const changed=()=>{dirty=true;sync();};
    for(const line of initial.lines) {
      const row=el('tr'),qty=el('input');qty.type='number';qty.min='1';qty.step='1';qty.value=line.quantity;qty.setAttribute('aria-label','Số lượng nháp mã '+line.sku);
      const td=el('td');td.append(qty);const remove=el('td');let removed=false;
      remove.append(btn('Bỏ mã '+line.sku,()=>{removed=true;row.remove();changed();}));
      row.append(el('td','',line.sku),el('td','',line.name||''),td,remove);rows.append(row);
      fields.push({sku:line.sku,qty,removed:()=>removed});qty.addEventListener('input',changed);
    }
    const save=btn('Lưu nháp',()=>saveDraft(),'btn primary'),send=btn('Gửi NCC',()=>submit(),'btn primary'),state=el('span','muted small');
    const back=btn('Đóng',()=>{if(!busy)dialog.close();});foot.append(state,back,save,send);body.append(label,hint,wrap,error);form.append(header,body,foot);dialog.append(form);
    form.addEventListener('submit',e=>{e.preventDefault();saveDraft();});dateInput.addEventListener('input',changed);
    modal.addEventListener('cancel',e=>{if(busy)e.preventDefault();});modal.addEventListener('close',()=>modal.remove(),{once:true});
    function sync(){save.disabled=busy;send.disabled=busy||!draft||dirty||!dateInput.value;send.title=!dateInput.value?'Nhập ngày lấy và lưu nháp trước khi gửi':dirty?'Lưu nháp trước khi gửi':'';state.textContent=draft?`Đã lưu nháp · phiên bản ${draft.revision}`:'Chưa lưu';}
    function fail(message){error.textContent=message;error.hidden=!message;}
    function values(){const items=fields.filter(f=>!f.removed()).map(f=>({sku:f.sku,quantity:Number(f.qty.value)}));
      if(!items.length||items.some(l=>!Number.isSafeInteger(l.quantity)||l.quantity<=0))throw Error('Chọn ít nhất một mã, số lượng phải là số nguyên dương.');return items;}
    async function saveDraft(){if(busy)return;fail('');let items;try{items=values();}catch(e){fail(e.message);return;}
      busy=true;sync();
      try {
        const body={lines:items,pickupDate:dateInput.value,scope:initial.scope||{}};
        let result;
        if(draft) result=await api('/purchase-early-requests/'+encodeURIComponent(draft.id),'PUT',{...body,revision:draft.revision});
        else {const fingerprint=JSON.stringify(body);if(lastAttempt?.fingerprint!==fingerprint)lastAttempt={fingerprint,key:crypto.randomUUID()};
          result=await api('/purchase-early-requests','POST',{...body,clientKey:lastAttempt.key});}
        draft=result.request;dirty=false;onSaved(draft);await load();
      }catch(e){fail(e.message||'Không lưu được nháp.');}finally{busy=false;sync();}
    }
    async function submit(){if(busy||!draft||dirty)return;fail('');busy=true;sync();
      try{const result=await api('/purchase-early-requests/'+encodeURIComponent(draft.id)+'/submit','POST',{revision:draft.revision});onSaved(result.request);dialog.close();await load();}
      catch(e){fail(e.message||'Không gửi được NCC.');}finally{busy=false;sync();}
    }
    sync();dialog.showModal();
  }
  return {load,newDraft:edit,async open(id){const requests=await load(id);if(requests?.[0]?.requestStatus==='draft'&&canWrite())edit(requests[0]);else list.querySelector('[data-request-id]')?.scrollIntoView({block:'nearest'});}};
}

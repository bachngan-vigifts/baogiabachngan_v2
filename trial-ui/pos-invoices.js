/** Session-local invoice drafts, isolated by cashier/register/shift. No prices or payments are calculated here. */
export function createPosInvoiceBook(storage, scope, legacy = null) {
  const key='bn-pos-invoices:v1:'+JSON.stringify([scope.userId,scope.registerId,scope.shiftId]);
  const raw=storage?.getItem(key), data=raw?JSON.parse(raw):null;
  if(data&&(!Array.isArray(data.entries)||!data.entries.length||data.version!==1||!data.entries.some(e=>e.id===data.activeId)||new Set(data.entries.map(e=>e.id)).size!==data.entries.length||data.entries.some(e=>!e.id||!Number.isSafeInteger(e.number)||e.number<1||e.draft!=null&&!Array.isArray(e.draft.cart))))throw Error('Danh sách hóa đơn nháp không hợp lệ.');
  const entries=data?.entries||[{id:crypto.randomUUID(),number:1,draft:legacy}], state={entries,activeId:data?.activeId||entries[0].id,nextNumber:Math.max(Number.isSafeInteger(data?.nextNumber)?data.nextNumber:0,Math.max(...entries.map(e=>e.number))+1)};
  const copy=x=>x==null?null:JSON.parse(JSON.stringify(x));
  const persist=()=>storage?.setItem(key,JSON.stringify({version:1,...state}));
  const active=()=>state.entries.find(e=>e.id===state.activeId);
  const dirty=d=>!!(d?.cart?.length||d?.note||d?.customerId||d?.exchangeAllocationId||d?.serviceFees?.length||Number(d?.shippingFee)>0||d?.deliveryDraft?.address||d?.deliveryDraft?.receiver||d?.deliveryDraft?.phone||d?.deliveryDraft?.shipNote||d?.deliveryDraft?.ghnOrderCode||Number(d?.deliveryDraft?.deposit)>0);
  const edit=fn=>{const before=copy(state);try{const result=fn();persist();return result;}catch(error){Object.assign(state,before);throw error;}};
  return {
    entries:()=>state.entries.map(e=>({id:e.id,number:e.number,dirty:dirty(e.draft)})),
    current:()=>({...active(),draft:copy(active().draft)}),
    save(draft){edit(()=>active().draft=copy(draft));},
    add(){return edit(()=>{const entry={id:crypto.randomUUID(),number:state.nextNumber++,draft:null};state.entries.push(entry);return entry.id;});},
    select(id){if(!state.entries.some(e=>e.id===id))throw Error('Không tìm thấy hóa đơn nháp.');edit(()=>state.activeId=id);return this.current();},
    close(id){const i=state.entries.findIndex(e=>e.id===id);if(i<0)return;edit(()=>{state.entries.splice(i,1);if(!state.entries.length)state.entries.push({id:crypto.randomUUID(),number:state.nextNumber++,draft:null});if(state.activeId===id)state.activeId=state.entries[Math.min(i,state.entries.length-1)].id;});return this.current();},
    hasOtherDrafts(){return state.entries.some(e=>e.id!==state.activeId&&dirty(e.draft));},
  };
}

export function renderPosInvoiceTabs(doc,book,{select,close,add}) {
  const nav=doc.createElement('nav');nav.className='pos-ref-invoices';nav.setAttribute('aria-label','Các hóa đơn đang mở');
  const currentId=book.current().id;
  for(const entry of book.entries()){
    const tab=doc.createElement('div');tab.className='pos-ref-invoice';tab.dataset.invoiceId=entry.id;
    const arrow=doc.createElement('span');arrow.className='pos-ref-invoice-arrow';arrow.textContent='⇄';arrow.setAttribute('aria-hidden','true');
    const choose=doc.createElement('button');choose.type='button';choose.textContent='Hóa đơn '+entry.number;choose.className='pos-ref-invoice-select';choose.setAttribute('aria-pressed',String(entry.id===currentId));choose.addEventListener('click',()=>select(entry.id));
    const remove=doc.createElement('button');remove.type='button';remove.textContent='×';remove.className='pos-ref-invoice-close';remove.setAttribute('aria-label','Đóng hóa đơn '+entry.number);remove.addEventListener('click',()=>close(entry.id));tab.append(arrow,choose,remove);nav.append(tab);
  }
  const plus=doc.createElement('button');plus.type='button';plus.className='pos-ref-invoice-add';plus.textContent='+';plus.setAttribute('aria-label','Thêm hóa đơn');plus.addEventListener('click',add);nav.append(plus);return nav;
}

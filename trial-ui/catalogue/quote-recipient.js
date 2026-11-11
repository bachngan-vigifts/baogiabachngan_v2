import {esc} from './core.js';
import {createCatalogueCustomerLink} from './customer-link.js';

/** Stage recipient changes until explicit confirmation; cancel never changes a quote. */
export function createQuoteRecipient({api,identity,onChange=()=>{}}){
 const dialog=document.createElement('dialog');dialog.className='shared-library-dialog quote-recipient-dialog';document.body.append(dialog);
 return async function chooseRecipient(state){
  const token=identity(),draft={meta:{...state.meta}};
  const initial=draft.meta.customerId?'customer':draft.meta.customerGroup?'group':'customer';
  dialog.innerHTML=`<form><div class="modal-head"><h2>Lưu báo giá cho ai?</h2><button class="btn" type="button" data-cancel>Đóng</button></div><div class="modal-body shared-edit"><p>Bạn có muốn lưu báo giá này cho khách hàng nào hoặc nhóm khách hàng nào?</p><fieldset class="recipient-modes"><legend>Đối tượng lưu báo giá</legend>${[['customer','Khách hàng cụ thể'],['group','Nhóm khách hàng'],['none','Chưa gắn khách hàng']].map(([value,label])=>`<label><input type="radio" name="recipientMode" value="${value}" ${value===initial?'checked':''}>${label}</label>`).join('')}</fieldset><section data-recipient="customer"><label class="price-band-field">Tìm khách hàng<input class="input" id="recipient-customer" value="${esc(draft.meta.customerId?draft.meta.customer:'')}" placeholder="Tên, điện thoại hoặc mã số thuế"></label></section><section data-recipient="group"><label class="price-band-field">Nhóm khách hàng<select class="input" name="customerGroup" disabled><option value="">Đang tải nhóm…</option></select></label><p class="hint">Chỉ hiện nhóm có khách đã duyệt trong phạm vi của bạn.</p><button class="btn small" type="button" data-reload-groups>Tải lại nhóm</button></section><p class="error" role="alert"></p></div><div class="modal-foot"><button class="btn" type="button" data-cancel>Huỷ</button><button class="btn primary" type="submit">Lưu báo giá</button></div></form>`;
  const form=dialog.querySelector('form'),error=form.querySelector('.error'),input=form.querySelector('#recipient-customer');
  const customer=createCatalogueCustomerLink({api,identity,getState:()=>draft,onChange:()=>{}});customer.mount(input);
  let finished=false,groupsLoaded=false,groupRun=0;
  const mode=()=>form.elements.recipientMode.value;
  const current=()=>!finished&&token===identity()&&dialog.open;
  async function loadGroups(){
   const run=++groupRun,select=form.elements.customerGroup;select.disabled=true;error.textContent='';
   try{const data=await api('api/customers?groups=1');if(!current()||run!==groupRun)return;
    select.innerHTML='<option value="">Chọn nhóm khách hàng</option>'+data.groups.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
    select.value=draft.meta.customerGroup||'';select.disabled=false;groupsLoaded=true;
    if(!data.groups.length)error.textContent='Chưa có nhóm khách hàng trong phạm vi được phép.';
   }catch(e){if(current()&&run===groupRun){groupsLoaded=false;select.innerHTML='<option value="">Chưa tải được nhóm</option>';error.textContent=e.message;}}
  }
  function sync(){for(const area of form.querySelectorAll('[data-recipient]'))area.hidden=area.dataset.recipient!==mode();error.textContent='';if(mode()==='group'&&!groupsLoaded)loadGroups();}
  return new Promise(resolve=>{
   function finish(value){if(finished)return;finished=true;customer.mount(null);dialog.close();resolve(value);}
   for(const button of form.querySelectorAll('[data-cancel]'))button.onclick=()=>finish(false);
   dialog.oncancel=e=>{e.preventDefault();finish(false);};dialog.onclose=()=>finish(false);
   form.onchange=e=>{if(e.target.name==='recipientMode')sync();};form.querySelector('[data-reload-groups]').onclick=loadGroups;
   form.onsubmit=e=>{e.preventDefault();if(token!==identity()){error.textContent='Tài khoản đã thay đổi. Đóng và mở lại form lưu.';return;}
    if(mode()==='customer'&&!draft.meta.customerId){error.textContent='Chọn đúng hồ sơ khách hàng, hoặc chọn “Chưa gắn khách hàng”.';return;}
    if(mode()==='group'&&(!groupsLoaded||!form.elements.customerGroup.value)){error.textContent='Chọn nhóm khách hàng trước khi lưu.';return;}
    const customerId=mode()==='customer'?draft.meta.customerId:'',customerGroup=mode()==='group'?form.elements.customerGroup.value:'';
    Object.assign(state.meta,{customerId,customerGroup,customer:customerId?draft.meta.customer:customerGroup});onChange(state);finish(true);
   };
   dialog.showModal();sync();
  });
 };
}

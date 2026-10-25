/** UI-only layout coordinator. Original controls, form ownership and delegated listeners are retained. */
const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const setText=(n,text)=>{if(n.textContent!==String(text))n.textContent=String(text);};
const visible=n=>n&&!n.closest('[hidden]')&&n.style.display!=='none';
const moneyPattern=/^\s*([\d.,\s]+)\s*(?:₫|đ)\s*$/;
export function compactKpi(text){
 const match=moneyPattern.exec(text);if(!match)return null;
 const amount=Number(match[1].replace(/[.,\s]/g,''));if(!Number.isSafeInteger(amount))return null;
 const scale=amount>=1e9?1e9:amount>=1e6?1e6:0;
 return scale?new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2}).format(amount/scale)+(scale===1e9?' tỷ':' triệu'):null;
}
export function installMobileDesign(profiles){
 const media=matchMedia('(max-width: 850px)'),wide=matchMedia('(min-width: 1280px)');
 const filters=new Map(),cardRows=new WeakSet(),documentSections=new Map();let frame=0,navSignature='',ignoreClose=0,lastContracts='#/contracts';
 const nav=make('nav','crm-mobile-nav');nav.setAttribute('aria-label','Điều hướng điện thoại');
 const more=make('dialog','crm-sheet crm-more-sheet'),moreHead=make('header','crm-sheet-head'),moreTitle=make('h2','','Thêm'),moreClose=make('button','icon-btn','×'),moreBody=make('div','crm-more-grid');
 moreClose.type='button';moreClose.setAttribute('aria-label','Đóng các trang');moreClose.onclick=()=>more.close();moreHead.append(moreTitle,moreClose);more.append(moreHead,moreBody);document.body.append(nav,more);
 moreBody.addEventListener('click',e=>{if(e.target.closest('a'))more.close();});
 const doc=make('dialog','crm-sheet crm-document-sheet'),docHead=make('header','crm-sheet-head'),docTitle=make('h2','','Chi tiết HĐKT'),docClose=make('button','icon-btn','×');
 docClose.type='button';docClose.setAttribute('aria-label','Đóng chi tiết HĐKT');docHead.append(docTitle,docClose);doc.append(docHead);document.body.append(doc);
 const order=document.querySelector('#view-order'),orderSlot=document.createComment('original document view');order?.before(orderSlot);
 docClose.onclick=()=>doc.close();doc.addEventListener('close',()=>{if(ignoreClose){ignoreClose--;return;}if(/^#\/contracts\/[^?]+/.test(location.hash))location.hash=lastContracts;});
 function closeDocument(){if(doc.open){ignoreClose++;doc.close();}for(const [node,r]of documentSections){r.slot.after(node);r.slot.remove();r.details.remove();}documentSections.clear();order?.querySelector('.crm-doc-customer')?.remove();if(order&&order.parentElement===doc)orderSlot.after(order);document.querySelector('#view-contracts')?.removeAttribute('data-sheet-background');}
 function syncDocument(){
  const workspace=document.querySelector('#workspace'),detail=/^#\/contracts\/[^?]+/.test(location.hash),appReady=workspace&&!workspace.hidden;
  if(!appReady||!detail||!(media.matches||wide.matches)){closeDocument();return;}
  if(order.parentElement!==doc)doc.append(order);
  let customer=order.querySelector('.crm-doc-customer');if(!customer){customer=make('p','crm-doc-customer');order.querySelector('.editor-head').after(customer);}setText(customer,order.querySelector('#order-customer dd')?.textContent||'');
  const debt=order.querySelector('#order-debt')?.closest('.card');if(debt)debt.classList.add('crm-document-finance');
  for(const node of order.querySelectorAll(':scope > .card,:scope > .editor-grid > .card,:scope > #order-flow')){
   if(node===debt||documentSections.has(node))continue;
   const slot=document.createComment('document section'),details=make('details','crm-document-section'),summary=make('summary','',node.querySelector('.card-title')?.textContent||(node.id==='order-flow'?'Tiến trình chứng từ':'Chứng từ liên quan'));node.before(slot,details);details.append(summary,node);documentSections.set(node,{slot,details});
  }
  for(const [node,r]of documentSections)if(r.details.hidden!==node.hidden)r.details.hidden=node.hidden;
  const mainAction=order.querySelector('#order-actions [data-contract-docs]');if(mainAction&&!mainAction.hasAttribute('data-mobile-primary'))mainAction.dataset.mobilePrimary='';
  const background=document.querySelector('#view-contracts');background.hidden=false;background.dataset.sheetBackground='';
  if(!doc.open){if(media.matches)doc.showModal();else doc.show();}
 }
 function syncNav(){
  const sources=new Map();
  for(const a of document.querySelectorAll('.sidebar [data-nav],.bottom-nav [data-nav]'))if(visible(a)&&!sources.has(a.dataset.nav))sources.set(a.dataset.nav,a);
  const primary=['tasks','quotes','orders','customers'].filter(k=>sources.has(k));
  if(primary.length<4)for(const k of ['kho','packing','purchases','deliveries','stock-lookup','cash','pos',...sources.keys()])if(primary.length<4&&sources.has(k)&&!primary.includes(k))primary.push(k);
  const key=location.hash.replace(/^#\//,'').split(/[/?]/)[0],extra=[...sources.keys()].filter(k=>!primary.includes(k));
  const signature=JSON.stringify([...sources].map(([k,a])=>[k,a.getAttribute('href'),a.querySelector('span')?.textContent||a.textContent.trim()]))+key+primary.join();
  if(signature===navSignature)return;navSignature=signature;nav.replaceChildren();moreBody.replaceChildren();
  const link=k=>{const source=sources.get(k),a=make('a','',k==='orders'?'Đơn hàng':source.querySelector('span')?.textContent||source.textContent.trim());a.href=source.getAttribute('href');a.dataset.mobileNav=k;const icon=source.querySelector('svg');if(icon)a.prepend(icon.cloneNode(true));if(k===key)a.setAttribute('aria-current','page');return a;};
  for(const k of primary)nav.append(link(k));
  const moreBtn=make('button','', 'Thêm');moreBtn.type='button';moreBtn.prepend(make('span','crm-more-icon','⋯'));moreBtn.setAttribute('aria-haspopup','dialog');if(!primary.includes(key))moreBtn.setAttribute('aria-current','page');moreBtn.onclick=()=>more.showModal();nav.append(moreBtn);
  for(const k of extra)moreBody.append(link(k));
 }
 function createFilter(root,profile){
  const source=root.querySelector(profile.filters);if(!source||filters.has(source)||!('showPopover'in HTMLElement.prototype))return;
  const parts=[...source.children].filter(n=>!n.matches(profile.keep||'.search,.search-box')&&!n.matches('.crm-filter-sheet,.crm-filter-trigger'));
  if(profile.extraFilters)parts.push(...root.querySelectorAll(profile.extraFilters));
  if(!parts.length)return;
  const group=make('div','crm-filter-sheet'),head=make('header','crm-sheet-head'),title=make('h2','','Lọc '+profile.title),close=make('button','icon-btn','×');
  group.setAttribute('role','dialog');group.dataset.mobileActions='off';group.setAttribute('aria-label','Lọc '+profile.title);close.type='button';close.setAttribute('aria-label','Đóng bộ lọc');head.append(title,close);
  const body=make('div','crm-filter-fields'),foot=make('footer','crm-filter-foot'),clear=make('button','btn secondary','Xóa lọc'),apply=make('button','btn primary','Xem kết quả');clear.type=apply.type='button';foot.append(clear,apply);group.append(head,body,foot);
  const trigger=make('button','btn secondary crm-filter-trigger','Lọc');trigger.type='button';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-label','Lọc '+profile.title);
  const slots=new Map();for(const n of parts){const slot=document.createComment('filter position');n.before(slot);slots.set(n,slot);body.append(n);}
  const header=root.querySelector('.page-head');(header||source).append(trigger);source.append(group);
  const r={root,source,group,body,trigger,parts,slots,clear,apply,profile};filters.set(source,r);
  trigger.onclick=()=>{group.showPopover();trigger.setAttribute('aria-expanded','true');};close.onclick=apply.onclick=()=>group.hidePopover();group.addEventListener('toggle',e=>trigger.setAttribute('aria-expanded',String(e.newState==='open')));
  clear.onclick=()=>{
   const existing=body.querySelector('[id$="-clear"],[data-clear="all"]');if(existing){existing.click();return;}
   for(const input of body.querySelectorAll('input,select')){if(input.type==='checkbox'||input.type==='radio')input.checked=input.defaultChecked;else input.value=input.tagName==='SELECT'?(input.options[0]?.value||''):'';input.dispatchEvent(new Event(input.type==='search'?'input':'change',{bubbles:true}));}
   for(const chips of body.querySelectorAll('.chips,.task-seg'))chips.querySelector('button')?.click();
  };
 }
 function syncFilters(){
  for(const [source,r]of filters){
   if(!source.isConnected){r.trigger.remove();filters.delete(source);continue;}
   if(media.matches){r.group.setAttribute('popover','auto');for(const n of r.parts)if(n.parentElement!==r.body)r.body.append(n);}
   else{if(r.group.matches(':popover-open'))r.group.hidePopover();r.group.removeAttribute('popover');for(const n of r.parts){const slot=r.slots.get(n);if(slot.isConnected&&n.previousSibling!==slot)slot.after(n);}}
   const count=[...r.body.querySelectorAll('input,select')].filter(n=>visible(n)&&!['button','submit','hidden'].includes(n.type)&&((n.type==='checkbox'||n.type==='radio')?n.checked!==n.defaultChecked:n.value!==(n.tagName==='SELECT'?(n.options[0]?.value||''):''))).length;
   const chipCount=r.body.querySelectorAll('.chip.active[data-invoice]:not([data-invoice=""])').length;
   setText(r.trigger,'Lọc · '+(count+chipCount));const total=r.root.dataset.resultCount;setText(r.apply,total===undefined?'Xem kết quả':'Xem '+Number(total).toLocaleString('vi-VN')+' kết quả');
  }
 }
 function annotateCards(root,p){
  for(const row of root.querySelectorAll(p.rows||'tbody tr')){
   if(cardRows.has(row)||row.querySelector('.skeleton'))continue;
   const cells=[...row.children].filter(n=>n.tagName==='TD');if(cells.length<2)continue;
   row.classList.add('crm-list-card');
   cells.forEach(n=>n.classList.add('crm-card-extra'));
   for(const [kind,index]of Object.entries(p.card||{})){const n=cells[index];if(n){n.classList.remove('crm-card-extra');n.classList.add('crm-card-'+kind);}}
   for(const action of cells.filter(n=>n.matches('.row-actions,.actions-cell')||n.querySelector('button,a.btn'))){action.classList.remove('crm-card-extra');action.classList.add('crm-card-actions');}
   cardRows.add(row);
  }
 }
 function primaryControls(){
  const mark=n=>{if(n&&!n.hasAttribute('data-mobile-primary'))n.dataset.mobilePrimary='';};
  for(const el of document.querySelectorAll('.page-head .btn-add'))mark(el);
  for(const header of document.querySelectorAll('.page-head')){
   const primary=header.querySelector('.btn.primary:not(.mobile-action-trigger)');if(primary&&!/huỷ|hủy|xoá|xóa|đóng/i.test(primary.textContent))mark(primary);
  }
  for(const n of document.querySelectorAll('#orders-new,#contracts-new,#new-customer,#tasks-new,[data-care-new]'))if(!n.hasAttribute('data-mobile-create')){n.dataset.mobileCreate='';mark(n);}
  for(const foot of document.querySelectorAll('.modal-foot,.sup-drawer-foot,.sup-drawer-foot-sticky,.pos-form-actions,.cash-dialog-foot')){
   const buttons=[...foot.querySelectorAll('.btn.primary')].filter(visible);mark(buttons.at(-1));
   foot.querySelectorAll('[data-close],[data-x]').forEach(b=>{if(!b.hasAttribute('data-mobile-inline'))b.dataset.mobileInline='';});
  }
 }
 function kpis(){
  for(const n of document.querySelectorAll('.stats .stat strong')){
   if(n.dataset.kpiFull&&n.textContent===n.dataset.kpiCompact){if(!media.matches)setText(n,n.dataset.kpiFull);continue;}
   const text=n.textContent.trim(),compact=compactKpi(text);if(!compact)continue;
   n.dataset.kpiFull=text;n.dataset.kpiCompact=compact;n.title=text;if(media.matches)setText(n,compact);
  }
 }
 function quoteLines(){
  for(const row of document.querySelectorAll('#line-list tr[data-i]')){
   if(row.querySelector('[data-mobile-line-toggle]'))continue;
   const actions=row.querySelector('.line-actions,.col-act');if(!actions)continue;
   const b=make('button','btn secondary small','Chi tiết');b.type='button';b.dataset.mobileLineToggle='';b.dataset.mobileInline='';b.setAttribute('aria-expanded','false');
   b.onclick=()=>{const on=row.dataset.mobileExpanded!=='true';row.dataset.mobileExpanded=String(on);b.setAttribute('aria-expanded',String(on));};actions.prepend(b);
  }
 }
 function formLabels(){
  for(const n of document.querySelectorAll('input[required],select[required],textarea[required]')){
   const label=n.closest('label');if(label&&!label.querySelector('.crm-required')&&!label.textContent.includes('*')){const star=make('span','crm-required',' *');star.setAttribute('aria-hidden','true');const caption=label.querySelector(':scope > span');if(caption)caption.append(star);else{const text=document.createElement('span');while(label.firstChild&&label.firstChild!==n)text.append(label.firstChild);text.append(star);label.prepend(text);}}
  }
 }
 function taskModes(){
  const root=document.querySelector('#view-tasks'),tabs=root?.querySelector('#tasks-view'),r=[...filters.values()].find(x=>x.root===root);if(!tabs||!r)return;
  let modes=r.body.querySelector('[data-mobile-task-modes]');if(!modes){const label=make('label','','Chế độ xem');modes=make('select');modes.dataset.mobileTaskModes='';modes.setAttribute('aria-label','Chế độ xem công việc');label.append(modes);r.body.prepend(label);modes.onchange=()=>[...tabs.querySelectorAll('[data-v]')].find(b=>b.dataset.v===modes.value)?.click();}
  const buttons=[...tabs.querySelectorAll('button[data-v]')];const signature=buttons.map(b=>b.dataset.v+':'+b.textContent+':'+b.getAttribute('aria-selected')).join('|');
  if(modes.dataset.options!==signature){modes.dataset.options=signature;modes.replaceChildren(...buttons.map(b=>{const o=make('option','',b.textContent.trim());o.value=b.dataset.v;o.selected=b.getAttribute('aria-selected')==='true';if(!['mine','created','approvals'].includes(b.dataset.v))b.classList.add('crm-task-extra-tab');return o;}));}
 }
 let errorSequence=0;
 function fieldError(input,bad){
  const host=input.closest('label')||input.parentElement;if(!host)return;let error=host.querySelector('.crm-field-error');
  if(!bad){input.removeAttribute('aria-invalid');if(error)error.hidden=true;return;}
  if(!error){error=make('small','crm-field-error');error.id='crm-field-error-'+(++errorSequence);host.append(error);input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),error.id].filter(Boolean).join(' '));}
  error.hidden=false;error.textContent=input.validity?.valueMissing?'Vui lòng điền thông tin bắt buộc.':'Kiểm tra lại thông tin tại ô này.';input.setAttribute('aria-invalid','true');
 }
 function scan(){
  frame=0;
  const ready=document.querySelector('#workspace')&&!document.querySelector('#workspace').hidden;
  nav.hidden=!ready;if(!ready){if(more.open)more.close();closeDocument();return;}
  for(const p of profiles){const root=document.querySelector(p.root);if(!root)continue;root.classList.add('crm-designed-page');if(p.filters)createFilter(root,p);if(p.card)annotateCards(root,p);
   for(const b of root.querySelectorAll(':scope > .chips .chip.active,#type-filter .chip.active')){if(root.dataset.resultCount===undefined)continue;let count=b.querySelector('.crm-chip-count');if(!count){count=make('span','crm-chip-count');b.append(count);}setText(count,' '+Number(root.dataset.resultCount).toLocaleString('vi-VN'));}
   if(root.dataset.loadState==='error'){let retry=root.querySelector('.crm-list-retry');if(!retry){retry=make('button','btn secondary crm-list-retry','Thử lại');retry.type='button';retry.onclick=()=>window.dispatchEvent(new CustomEvent('crm-reload-current',{detail:{view:root.id.replace('view-','')}}));(root.querySelector('.empty')||root).append(retry);}retry.hidden=false;}else{const retry=root.querySelector('.crm-list-retry');if(retry&&!retry.hidden)retry.hidden=true;}
  }
  primaryControls();syncFilters();syncNav();syncDocument();kpis();quoteLines();formLabels();taskModes();
  document.body.classList.toggle('crm-form-mode',/^#\/quotes\//.test(location.hash));
 }
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(scan);};
 new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','style','disabled','data-result-count']});
 document.addEventListener('change',schedule);document.addEventListener('input',schedule);
 document.addEventListener('invalid',e=>fieldError(e.target,true),true);
 document.addEventListener('crm-field-validity',e=>fieldError(e.target,e.detail.invalid));
 document.addEventListener('input',e=>{if(e.target.matches('input,select,textarea')&&e.target.validity?.valid)fieldError(e.target,false);});
 document.addEventListener('focusin',e=>{if(e.target.matches('input:not([type=checkbox]):not([type=radio]),select,textarea'))document.body.classList.add('crm-keyboard-open');});
 document.addEventListener('focusout',()=>setTimeout(()=>{if(!document.activeElement?.matches('input,select,textarea'))document.body.classList.remove('crm-keyboard-open');},0));
 window.addEventListener('hashchange',()=>{if(/^#\/contracts(?:\?|$)/.test(location.hash))lastContracts=location.hash;for(const r of filters.values())if(r.group.matches(':popover-open'))r.group.hidePopover();if(more.open)more.close();schedule();});
 const resize=()=>{if(doc.open){ignoreClose++;doc.close();}schedule();};media.addEventListener('change',resize);wide.addEventListener('change',resize);
 scan();return {refresh:schedule};
}

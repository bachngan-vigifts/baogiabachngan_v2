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
/** V0 footer order is shared by every role; callers supply only permission-visible links. */
export function orderedMobileNavKeys(keys) {
 const visible=[...new Set(keys)];
 const order=[
  // Bán hàng: giữ nguyên năm mục đầu.
  'pos','quotes','orders','contracts','receivables',
  // Tiền.
  'cashbook','cash',
  // Khách hàng.
  'customers','care','stock-requests',
  // Công việc & báo cáo.
  'tasks','dashboard','flow',
  // Kho & giao nhận, gồm trang công việc riêng của Kho nếu được cấp quyền.
  'kho','products','stock-lookup','transfers','stock-moves','inventory','stocktake','packing','receiving','deliveries',
  // Mua hàng.
  'early-requests','purchases','suppliers',
  // Quản trị.
  'staff','payroll','permissions',
 ];
 return [...order.filter(key=>visible.includes(key)),...visible.filter(key=>!order.includes(key))];
}
export function installMobileDesign(profiles){
 const media=matchMedia('(max-width: 850px)');
 const filters=new Map(),cardRows=new WeakSet();let frame=0,navSignature='';
 const nav=make('nav','crm-mobile-nav');nav.setAttribute('aria-label','Điều hướng điện thoại');
 document.body.append(nav);
 // Contract detail uses the same permanent full-page view as an order at every viewport.
 function contractControls(){
  const order=document.querySelector('#view-order'),detail=/^#\/contracts\/[^?]+/.test(location.hash);
  order?.classList.toggle('crm-mobile-contract',media.matches&&detail);
  if(!detail)return;
  const mainAction=order?.querySelector('[data-contract-docs]');
  if(mainAction&&!mainAction.hasAttribute('data-mobile-primary'))mainAction.dataset.mobilePrimary='';
  for(const b of order?.querySelectorAll('[data-pack-print-for],[data-ship-print-for],#order-history')||[])if(!b.hasAttribute('data-mobile-inline'))b.dataset.mobileInline='';
 }
 // Use the same permission-filtered entries as the sidebar.
 const navLabels={pos:'Bán hàng nhanh',quotes:'Báo giá',orders:'Đơn hàng',contracts:'HĐKT',receivables:'Công nợ'};
 function syncNav(){
  const sources=new Map();
  for(const a of document.querySelectorAll('.sidebar [data-nav]'))if(visible(a)&&!sources.has(a.dataset.nav))sources.set(a.dataset.nav,a);
  const keys=orderedMobileNavKeys(sources.keys());
  const key=location.hash.replace(/^#\//,'').split(/[/?]/)[0];
  const label=(k,a)=>navLabels[k]||a.querySelector('span:last-of-type')?.textContent||a.textContent.trim();
  const signature=JSON.stringify(keys.map(k=>{const a=sources.get(k);return [k,a.getAttribute('href'),label(k,a)];}))+key;
  if(signature===navSignature)return;navSignature=signature;nav.replaceChildren();
  for(const k of keys){
   const source=sources.get(k),a=make('a','',label(k,source));a.href=source.getAttribute('href');a.dataset.mobileNav=k;
   const icon=source.querySelector('svg');if(icon)a.prepend(icon.cloneNode(true));
   else {const symbol=make('span','crm-nav-symbol',source.querySelector('span')?.textContent||'▣');symbol.setAttribute('aria-hidden','true');a.prepend(symbol);}
   if(k===key)a.setAttribute('aria-current','page');nav.append(a);
  }
  // Keep the current page in view without changing the page's vertical position.
  const active=nav.querySelector('[aria-current]');
  if(media.matches&&active){const left=active.offsetLeft,right=left+active.offsetWidth;
   if(left<nav.scrollLeft)nav.scrollLeft=left;
   else if(right>nav.scrollLeft+nav.clientWidth)nav.scrollLeft=right-nav.clientWidth;
  }
 }
 function homeLinks(){for(const row of document.querySelectorAll('.crm-home-row'))row.remove();}
 function createFilter(root,profile){
  const source=root.querySelector(profile.filters);if(!source||filters.has(source)||!('showPopover'in HTMLElement.prototype)||!media.matches||root.contains(document.activeElement))return;
  const parts=[...source.children].filter(n=>!n.matches(profile.keep||'.search,.search-box')&&!n.matches('.crm-filter-sheet,.crm-filter-trigger'));
  if(profile.extraFilters)parts.push(...root.querySelectorAll(profile.extraFilters));if(!parts.length)return;
  const group=make('div','crm-filter-sheet'),head=make('header','crm-sheet-head'),title=make('h2','','Lọc '+profile.title),close=make('button','icon-btn','×');
  group.setAttribute('role','dialog');group.dataset.mobileActions='off';group.setAttribute('aria-label','Lọc '+profile.title);group.setAttribute('popover','auto');close.type='button';close.setAttribute('aria-label','Đóng bộ lọc');head.append(title,close);
  const body=make('div','crm-filter-fields'),hint=make('p','muted small','Lọc chi tiết chỉ áp dụng khi bấm Xem. Xóa lọc chưa thay đổi danh sách. Tìm kiếm và trạng thái ngoài bảng lọc áp dụng ngay.'),foot=make('footer','crm-filter-foot'),clear=make('button','btn secondary','Xóa lọc'),apply=make('button','btn primary','Xem kết quả');clear.type=apply.type='button';clear.setAttribute('data-mobile-navigation','');body.append(hint);foot.append(clear,apply);group.append(head,body,foot);
  const trigger=make('button','btn secondary crm-filter-trigger','Lọc');trigger.type='button';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-label','Lọc '+profile.title);
  const slots=new Map();for(const n of parts){const slot=document.createComment('filter position');n.before(slot);slots.set(n,slot);n.classList.add('crm-filter-collapsed');}
  (root.querySelector('.page-head')||source).append(trigger);source.append(group);
  const controls=()=>parts.flatMap(n=>[...(n.matches('input,select,textarea')?[n]:[]),...n.querySelectorAll('input,select,textarea')]);
  const chips=()=>parts.flatMap(n=>[...n.querySelectorAll('.chip,.task-seg button')]);
  const capture=()=>new Map([...controls(),...chips()].map(n=>[n,{value:n.value,checked:n.checked,active:n.classList.contains('active'),pressed:n.getAttribute('aria-pressed'),selected:n.getAttribute('aria-selected')}]));
  const restore=values=>{for(const [n,v]of values){if('value'in n)n.value=v.value;if('checked'in n)n.checked=v.checked;n.classList.toggle('active',v.active);for(const [attr,value]of [['aria-pressed',v.pressed],['aria-selected',v.selected]]){if(value===null)n.removeAttribute(attr);else n.setAttribute(attr,value);}}};
  const r={root,source,group,body,trigger,parts,slots,clear,apply,profile,controls,chips,capture,restore,snapshot:null,choices:new Map(),applying:false,applied:false};filters.set(source,r);
  trigger.onclick=()=>{r.snapshot=capture();r.choices.clear();r.applied=false;for(const n of parts){n.classList.remove('crm-filter-collapsed');body.append(n);}group.showPopover();trigger.setAttribute('aria-expanded','true');};
  close.onclick=()=>{if(r.snapshot)restore(r.snapshot);group.hidePopover();};
  group.addEventListener('toggle',e=>{trigger.setAttribute('aria-expanded',String(e.newState==='open'));if(e.newState==='closed'){if(!r.applied&&r.snapshot)restore(r.snapshot);for(const n of parts){const slot=slots.get(n);if(slot?.isConnected)slot.after(n);n.classList.toggle('crm-filter-collapsed',media.matches);}}});
  clear.onclick=()=>{for(const input of controls()){if(input.type==='checkbox'||input.type==='radio')input.checked=input.defaultChecked;else input.value=input.tagName==='SELECT'?(input.options[0]?.value||''):'';}for(const button of chips()){const first=button.parentElement.querySelector('.chip,button');button.classList.toggle('active',button===first);if(button.hasAttribute('aria-pressed'))button.setAttribute('aria-pressed',String(button===first));if(button===first)r.choices.set(button.parentElement,button);}setText(apply,'Xem kết quả');};
  apply.onclick=()=>{r.applying=true;r.applied=true;try{for(const input of controls()){const old=r.snapshot?.get(input);if(!old||input.value!==old.value||input.checked!==old.checked)input.dispatchEvent(new Event(input.type==='search'?'input':'change',{bubbles:true}));}for(const button of r.choices.values())button.click();}finally{r.applying=false;group.hidePopover();}};
 }
 function syncFilters(){
  for(const [source,r]of filters){
   if(!source.isConnected){r.trigger.remove();r.group.remove();filters.delete(source);continue;}
   if(!media.matches){if(r.group.matches(':popover-open'))r.group.hidePopover();for(const n of r.parts){const slot=r.slots.get(n);if(slot?.isConnected&&n.parentElement===r.body)slot.after(n);n.classList.remove('crm-filter-collapsed');}}
   else if(!r.group.matches(':popover-open'))for(const n of r.parts)if(!n.classList.contains('crm-filter-collapsed'))n.classList.add('crm-filter-collapsed');
   const count=r.controls().filter(n=>!['button','submit','hidden'].includes(n.type)&&((n.type==='checkbox'||n.type==='radio')?n.checked!==n.defaultChecked:n.value!==(n.tagName==='SELECT'?(n.options[0]?.value||''):''))).length;
   setText(r.trigger,'Lọc · '+count);if(!r.group.matches(':popover-open')){const total=r.root.dataset.resultCount;setText(r.apply,total===undefined?'Xem kết quả':'Xem '+Number(total).toLocaleString('vi-VN')+' kết quả');}
   for(const button of r.chips())if(button.textContent.trim().startsWith('Tất cả'))button.classList.add('crm-filter-default');
  }
 }
 // Intercept original business listeners while editing a sheet; replay only on Apply.
 for(const type of ['input','change','click'])window.addEventListener(type,e=>{
  if(!media.matches)return;const r=[...filters.values()].find(r=>r.group.matches(':popover-open')&&r.body.contains(e.target));if(!r||r.applying)return;
  e.stopImmediatePropagation();setText(r.apply,'Xem kết quả');
  if(type==='click'){const button=e.target.closest('.chip,.task-seg button');if(button){e.preventDefault();for(const n of button.parentElement.querySelectorAll('.chip,button')){n.classList.toggle('active',n===button);if(n.hasAttribute('aria-pressed'))n.setAttribute('aria-pressed',String(n===button));}r.choices.set(button.parentElement,button);}}
 },true);
 function annotateCards(root,p){
  for(const row of root.querySelectorAll(p.rows||'tbody tr')){
   if(cardRows.has(row)||row.querySelector('.skeleton'))continue;
   const cells=[...row.children].filter(n=>n.tagName==='TD');if(cells.length<2)continue;
   row.classList.add('crm-list-card');
   cells.forEach(n=>n.classList.add('crm-card-extra'));
   for(const [kind,index]of Object.entries(p.card||{})){const n=cells[index];if(n){n.classList.remove('crm-card-extra');n.classList.add('crm-card-'+kind);}}
   // Ô đã có vai trò trong thẻ (vd. nút "Xem đơn hàng" ở ô trạng thái báo giá) giữ chỗ của nó, không dồn vào cột thao tác.
   for(const action of cells.filter(n=>n.matches('.row-actions,.actions-cell')||(n.classList.contains('crm-card-extra')&&n.querySelector('button,a.btn')))){action.classList.remove('crm-card-extra');action.classList.add('crm-card-actions');}
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
   const label=n.closest('label');if(label&&!label.querySelector('.crm-required')&&!label.textContent.includes('*')){const star=make('span','crm-required',' *');star.setAttribute('aria-hidden','true');const caption=label.querySelector(':scope > span');if(caption)caption.append(star);else{const text=make('span');for(const child of [...label.childNodes]){if(child.nodeType!==Node.TEXT_NODE)break;text.append(child);}text.append(star);label.prepend(text);}}
  }
 }
 function taskModes(){
  for(const label of document.querySelectorAll('[data-mobile-task-modes]'))label.closest('label')?.remove();
  for(const b of document.querySelectorAll('#tasks-view [data-v]'))b.classList.toggle('crm-task-extra-tab',!['mine','created','approvals'].includes(b.dataset.v));
 }
 function workflowPages(){
  if(!media.matches){document.body.classList.remove('crm-mobile-stock-readonly');return;}
  const readOnly=/^#\/(kho|stock-moves|stock-lookup|inventory|transfers|products|flow)(?:[/?]|$)/.test(location.hash);
  document.body.classList.toggle('crm-mobile-stock-readonly',readOnly);
  if(readOnly)for(const n of document.querySelectorAll('main .view:not([hidden]) button:not([data-mobile-navigation]),dialog[open] button:not([data-mobile-navigation]),.flow-panel:not([hidden]) button:not([data-mobile-navigation])'))if(/thêm|tạo|sửa|cập nhật|nhập file|đồng bộ|chốt|điều chỉnh|lưu|xóa|xoá|huỷ|hủy|duyệt/i.test(n.textContent||n.title||n.getAttribute('aria-label')||''))n.classList.add('mobile-desktop-only');
  for(const root of document.querySelectorAll('#view-deliveries,#view-packing,#view-receivables,#view-cashbook,#view-purchases,#view-receiving,#view-suppliers'))for(const row of root.querySelectorAll('tbody>tr')){
   if(row.closest('form,.pur-lines')||row.querySelector('input,select,textarea')||row.children.length<3)continue;
   row.classList.add('crm-simple-list-row');for(const [i,td]of [...row.children].entries()){if(i<3)td.classList.add('crm-simple-main');else if(!td.classList.contains('crm-simple-more'))td.classList.add('crm-simple-more');}
   if(!row.querySelector('[data-mobile-row-detail]')){const cell=row.lastElementChild,button=make('button','btn secondary small','Chi tiết');button.type='button';button.dataset.mobileRowDetail='';button.dataset.mobileInline='';button.setAttribute('aria-expanded','false');button.onclick=e=>{e.stopPropagation();const open=row.classList.toggle('crm-row-expanded');button.setAttribute('aria-expanded',String(open));};cell.classList.add('crm-simple-actions');cell.append(button);}
  }
  const dashboard=document.querySelector('#view-dashboard');if(dashboard&&!dashboard.querySelector('[data-mobile-dashboard-more]')){const button=make('button','btn secondary crm-dashboard-more','Xem thêm thống kê');button.type='button';button.dataset.mobileDashboardMore='';button.onclick=()=>{const open=dashboard.classList.toggle('crm-dashboard-expanded');button.textContent=open?'Thu gọn thống kê':'Xem thêm thống kê';};dashboard.querySelector('.dash-kpis')?.after(button);}
  for(const row of document.querySelectorAll('#customer-list tr')){const title=row.querySelector('.first a'),contact=row.querySelector('[data-label=\"Liên hệ\"]');if(title&&contact){const norm=n=>n.textContent.trim().replace(/\s+/g,' ').toLocaleLowerCase('vi-VN');contact.classList.toggle('crm-customer-duplicate-contact',norm(title)===norm(contact));}const tel=row.querySelector('a[href^="tel:"]');if(tel)tel.closest('td').classList.add('crm-customer-call');const quote=row.querySelector('[data-quote-for]');if(quote&&!quote.hasAttribute('data-mobile-inline'))quote.dataset.mobileInline='';}
  const quoteNav=document.querySelector('.sidebar [data-nav=quotes]');for(const n of document.querySelectorAll('.crm-customer-hero [data-act=quote]'))n.classList.toggle('crm-mobile-no-permission',!!quoteNav?.hidden);
  const tabRoot=document.querySelector('#tasks-view');if(tabRoot&&!tabRoot.querySelector('[data-v=approvals]')&&!tabRoot.querySelector('.crm-task-no-approval')){const tab=make('button','task-tab crm-task-no-approval','Cần duyệt');tab.type='button';tab.disabled=true;tab.title='Tài khoản chưa được cấp quyền duyệt';tabRoot.append(tab);}
  for(const done of document.querySelectorAll('[data-set-status="done"]')){
   const parent=done.closest('.task-kv-value,.task-kv,.seg')||done.parentElement;if(parent.querySelector('.crm-task-complete'))continue;
   const label=make('label','crm-task-complete'),input=make('input');input.type='checkbox';input.checked=done.getAttribute('aria-pressed')==='true';input.disabled=done.disabled;input.setAttribute('aria-label','Hoàn thành công việc');input.onchange=()=>{const target=input.checked?done:done.parentElement.querySelector('[data-set-status=todo]');if(target&&!target.disabled)target.click();};label.append(input,make('span','','Hoàn thành'));parent.append(label);
  }
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
  if(document.activeElement?.matches('input,select,textarea')){for(const p of profiles){const root=document.querySelector(p.root);if(root&&p.card)annotateCards(root,p);}return;}
  if(location.hash.startsWith('#/pos')){if(!nav.hidden)nav.hidden=true;document.body.classList.remove('crm-form-mode');return;}
  const ready=document.querySelector('#workspace')&&!document.querySelector('#workspace').hidden;
  nav.hidden=!ready;if(!ready){return;}
  for(const p of profiles){const root=document.querySelector(p.root);if(!root)continue;root.classList.add('crm-designed-page');if(p.filters)createFilter(root,p);if(p.card)annotateCards(root,p);
   for(const b of root.querySelectorAll(':scope > .chips .chip.active,#type-filter .chip.active')){if(root.dataset.resultCount===undefined)continue;let count=b.querySelector('.crm-chip-count');if(!count){count=make('span','crm-chip-count');b.append(count);}setText(count,' '+Number(root.dataset.resultCount).toLocaleString('vi-VN'));}
   if(root.dataset.loadState==='error'){let retry=root.querySelector('.crm-list-retry');if(!retry){retry=make('button','btn secondary crm-list-retry','Thử lại');retry.type='button';retry.onclick=()=>window.dispatchEvent(new CustomEvent('crm-reload-current',{detail:{view:root.id.replace('view-','')}}));(root.querySelector('.empty')||root).append(retry);}retry.hidden=false;}else{const retry=root.querySelector('.crm-list-retry');if(retry&&!retry.hidden)retry.hidden=true;}
  }
  primaryControls();syncFilters();syncNav();contractControls();homeLinks();kpis();quoteLines();formLabels();taskModes();workflowPages();
  document.body.classList.toggle('crm-form-mode',/^#\/quotes\//.test(location.hash));
 }
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(scan);};
 new MutationObserver(changes=>{if(!location.hash.startsWith('#/pos')&&changes.some(r=>!r.target.closest?.('#view-pos,.pos-modal')))schedule();}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','disabled','data-result-count','data-home-href']});
 document.addEventListener('focusout',schedule);document.addEventListener('change',schedule);document.addEventListener('input',schedule);
 document.addEventListener('invalid',e=>{if(!location.hash.startsWith('#/pos'))fieldError(e.target,true);},true);
 document.addEventListener('crm-field-validity',e=>fieldError(e.target,e.detail.invalid));
 document.addEventListener('input',e=>{if(e.target.matches('input,select,textarea')&&e.target.validity?.valid)fieldError(e.target,false);});
 document.addEventListener('focusin',e=>{if(location.hash.startsWith('#/pos'))return;if(e.target.matches('input:not([type=checkbox]):not([type=radio]),select,textarea'))document.body.classList.add('crm-keyboard-open');});
 document.addEventListener('focusout',()=>{if(location.hash.startsWith('#/pos'))return;setTimeout(()=>{if(!document.activeElement?.matches('input,select,textarea'))document.body.classList.remove('crm-keyboard-open');},0);});
 window.addEventListener('hashchange',()=>{for(const r of filters.values())if(r.group.matches(':popover-open'))r.group.hidePopover();schedule();});
 const resize=()=>{for(const r of filters.values())if(r.group.matches(':popover-open'))r.group.hidePopover();schedule();};media.addEventListener('change',resize);
 scan();return {refresh:schedule};
}

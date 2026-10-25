/** Mobile action sheets keep original controls in their form/delegation tree. No cloned click proxies. */
const containers=[
 '[data-mobile-actions]','.page-head','.editor-head','.card-title-row','.toolbar','.row-gap','td','form',
 '.actions','.row-actions','.editor-actions','.head-actions','.portal-actions','.profit-head-actions','.sync-actions',
 '.modal-foot','.sup-drawer-foot','.sup-drawer-foot-sticky','.task-detail-actions','.task-top-actions',
 '[class*="-actions"]','[class*="-tools"]','[class*="-footer"]','.cash-dialog-foot','.quote-capture-actions',
].join(',');
const controls='button.btn,button.icon-btn,a.btn,.btn-add,label.btn,.menu-wrap,button[data-mobile-action]';
const skip='.mobile-action-list,.mobile-action-trigger,.mobile-action-heading,.auth,#supplier-auth,nav,.pager,.chips,[role="tablist"],[role="radiogroup"],.pos-qty,.pos-cash-quick,.quote-mobile-steps,.mobile-savebar,.chat-compose,[data-mobile-actions="off"]';
const shown=n=>!n.hidden&&n.style.display!=='none';
let installed=false;
export function installMobileActions(){
 if(installed||!('showPopover' in HTMLElement.prototype))return;
 installed=true;
 const media=matchMedia('(max-width: 850px)'),records=new Map();let sequence=0,frame=0;
 const close=r=>{if(r.list.matches(':popover-open'))r.list.hidePopover();};
 function labelIcons(item){
  for(const button of [item,...item.querySelectorAll('button,a.btn')]){
   if(!button.matches('button,a')||/[\p{L}\p{N}]/u.test(button.textContent))continue;
   const name=button.getAttribute('aria-label')||button.title;
   if(name){const text=document.createElement('span');text.className='mobile-action-label';text.textContent=name;button.append(text);}
  }
 }
 function sync(r){
  for(const item of r.items)if(item.matches('[data-mobile-primary],[data-mobile-inline],.btn-add')){const slot=r.slots.get(item);if(slot?.isConnected)slot.after(item);r.slots.delete(item);slot?.remove();}
  r.items=r.items.filter(n=>!n.matches('[data-mobile-primary],[data-mobile-inline],.btn-add'));
  r.items=r.items.filter(n=>n.isConnected&&(r.list.contains(n)||n.parentElement===r.parent));
  for(const [item,slot]of r.slots)if(!r.items.includes(item)){slot.remove();r.slots.delete(item);}
  for(const item of r.items)labelIcons(item);
  const available=r.items.some(n=>shown(n)&&(!n.matches('.menu-wrap')||[...n.querySelectorAll('button,a[href]')].some(shown)));
  const hidden=!media.matches||!available;
  if(r.trigger.hidden!==hidden)r.trigger.hidden=hidden;
  if(!media.matches){
   close(r);r.list.removeAttribute('popover');
   for(const item of r.items){const slot=r.slots.get(item);if(slot.isConnected&&item.previousSibling!==slot)slot.after(item);}
  }else{
   if(!r.list.hasAttribute('popover'))r.list.setAttribute('popover','auto');
   for(const item of r.items)if(item.parentElement!==r.list)r.list.append(item);
  }
  if(!available)close(r);
 }
 function enhance(parent){
  if(parent.closest(skip))return;
  // Filters and editable values stay inline. Group only their adjacent action controls.
  const items=[...parent.children].filter(n=>n.matches(controls)&&!n.matches('.mobile-action-trigger,.crm-filter-trigger,.btn-add,[data-mobile-primary],[data-mobile-inline],.chip,[role="tab"],[role="radio"]'));
  if(!items.length)return;
  const existing=records.get(parent);
  if(existing){for(const item of items){if(existing.slots.has(item))continue;const slot=document.createComment('action position');item.before(slot);existing.slots.set(item,slot);labelIcons(item);existing.list.append(item);existing.items.push(item);}return;}
  const row=!!parent.closest('td,.row-actions,.cash-row-actions'),label=parent.dataset.mobileActions|| (row?'Thao tác dòng':'Thao tác');
  const list=document.createElement('div');list.className='mobile-action-list';list.id='mobile-actions-'+(++sequence);list.setAttribute('role','dialog');list.setAttribute('aria-label',label);
  const trigger=document.createElement('button');trigger.type='button';trigger.className='btn secondary mobile-action-trigger'+(row?' mobile-action-row':'');
  trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls',list.id);trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-label',label);
  trigger.innerHTML='<span aria-hidden="true">⋮</span>'+(row?'':'<span>Thao tác</span>');
  const heading=document.createElement('div');heading.className='mobile-action-heading';
  const title=document.createElement('strong');title.textContent=label;
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='icon-btn';dismiss.textContent='×';dismiss.setAttribute('aria-label','Đóng menu thao tác');
  heading.append(title,dismiss);list.append(heading);
  items[0].before(trigger,list);
  const slots=new Map();
  for(const item of items){
   const slot=document.createComment('action position');item.before(slot);slots.set(item,slot);
   list.append(item);
   labelIcons(item);
  }
  const r={parent,list,trigger,items,slots};records.set(parent,r);
  trigger.addEventListener('click',()=>{if(list.matches(':popover-open'))close(r);else{list.showPopover();list.querySelector('button:not(:disabled):not([hidden]),a[href]')?.focus({preventScroll:true});}});
  dismiss.addEventListener('click',()=>close(r));
  list.addEventListener('toggle',e=>{
   trigger.setAttribute('aria-expanded',String(e.newState==='open'));
   if(e.newState==='closed'&&document.activeElement===document.body&&trigger.isConnected)trigger.focus({preventScroll:true});
  });
  list.addEventListener('click',e=>{
   const action=e.target.closest('button,a[href],label.btn');
   if(!action)e.stopPropagation(); // Blank sheet space must not activate a clickable table row.
   // Existing download submenus continue to open inside the sheet.
   if(action&&!action.disabled&&action!==dismiss&&!action.hasAttribute('aria-haspopup'))setTimeout(()=>close(r),0);
  });
  sync(r);
 }
 function scan(){
  frame=0;
  for(const [parent,r]of records)if(!parent.isConnected||!r.list.isConnected){close(r);r.trigger.remove();for(const slot of r.slots.values())slot.remove();records.delete(parent);}
  // Deepest groups first, so a header never swallows a nested action group.
  for(const parent of [...document.querySelectorAll(containers)].reverse())enhance(parent);
  for(const r of records.values())sync(r);
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(scan);}
 new MutationObserver(schedule).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','style','disabled','data-mobile-primary','data-mobile-inline']});
 media.addEventListener('change',schedule);
 document.addEventListener('close',e=>{if(e.target instanceof HTMLDialogElement)for(const r of records.values())if(e.target.contains(r.list))close(r);},true);
 window.addEventListener('hashchange',()=>{for(const r of records.values())close(r);});
 scan();
}

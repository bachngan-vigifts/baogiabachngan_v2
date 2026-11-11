/** Keep the native option list for existing product forms; commit selection only on Apply. */
export function initProductBrandFilter(select){
 select.multiple=true;select.hidden=true;
 const trigger=document.createElement('button');trigger.type='button';trigger.className='btn secondary product-brand-trigger';trigger.id='product-brand-trigger';trigger.setAttribute('aria-haspopup','dialog');select.after(trigger);
 let dialog=null;
 const values=()=>[...select.selectedOptions].map(o=>o.value).filter(Boolean);
 const label=()=>{const v=values();trigger.textContent=v.length===0?'Mọi thương hiệu':v.length===1?v[0]:v.length+' thương hiệu';trigger.title=v.join(' · ')||'Mọi thương hiệu';trigger.setAttribute('aria-label','Chọn thương hiệu: '+trigger.title);};
 function setValues(names){const chosen=new Set(names);for(const name of chosen)if(![...select.options].some(o=>o.value===name))select.add(new Option(name,name));for(const o of select.options)o.selected=chosen.has(o.value);label();}
 trigger.onclick=()=>{
  if(dialog)return;const pending=new Set(values());dialog=document.createElement('dialog');dialog.className='modal product-brand-dialog';dialog.setAttribute('aria-label','Chọn nhiều thương hiệu');
  dialog.innerHTML='<form data-no-busy><header class="modal-head"><h2>Chọn thương hiệu</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">×</button></header><div class="modal-body"><label>Tìm thương hiệu<input type="search" data-search placeholder="Gõ tên thương hiệu…" autocomplete="off"></label><p class="muted small" data-summary></p><div class="product-brand-options"></div><p class="error" role="alert"></p></div><footer class="modal-foot"><button type="button" class="btn secondary" data-clear>Bỏ chọn tất cả</button><button type="submit" class="btn primary">Áp dụng</button></footer></form>';
  const list=dialog.querySelector('.product-brand-options'),summary=dialog.querySelector('[data-summary]'),error=dialog.querySelector('.error'),apply=dialog.querySelector('[type=submit]');
  const update=()=>{summary.textContent=pending.size?'Đã chọn '+pending.size+' thương hiệu. Chọn tối đa 100.':'Không chọn thương hiệu nào = Mọi thương hiệu.';apply.textContent=pending.size?'Áp dụng ('+pending.size+')':'Áp dụng · Mọi thương hiệu';};
  for(const option of select.options){if(!option.value)continue;const row=document.createElement('label'),input=document.createElement('input'),name=document.createElement('span');input.type='checkbox';input.value=option.value;input.checked=pending.has(option.value);name.textContent=option.textContent;row.append(input,name);list.append(row);input.onchange=()=>{if(input.checked&&pending.size>=100){input.checked=false;error.textContent='Chọn tối đa 100 thương hiệu mỗi lần.';return;}error.textContent='';input.checked?pending.add(input.value):pending.delete(input.value);update();};}
  const fold=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase();
  dialog.querySelector('[data-search]').oninput=e=>{const q=fold(e.target.value.trim());for(const row of list.children)row.hidden=!fold(row.textContent).includes(q);};
  const close=()=>dialog?.close();dialog.querySelector('[data-close]').onclick=close;
  dialog.querySelector('[data-clear]').onclick=()=>{pending.clear();for(const i of list.querySelectorAll('input'))i.checked=false;error.textContent='';update();};
  dialog.querySelector('form').onsubmit=e=>{e.preventDefault();setValues([...pending]);select.dispatchEvent(new Event('change',{bubbles:true}));close();};
  dialog.addEventListener('close',()=>{dialog.remove();dialog=null;trigger.focus();},{once:true});document.body.append(dialog);update();dialog.showModal();dialog.querySelector('[data-search]').focus();
 };
 label();return{setValues,close(){dialog?.close();}};
}

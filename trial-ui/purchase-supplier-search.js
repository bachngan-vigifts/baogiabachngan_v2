let sequence=0;
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
/** Bounded remote combobox; selected IDs belong to the parent purchase draft. */
export function createPurchaseSupplierSearch({api,choose,selected=()=>false,active=()=>true}){
 const root=node('div','pur-supplier-search'),label=node('label','','Tìm nhà cung cấp'),input=node('input'),list=node('div','pur-supplier-options'),status=node('small','muted'),more=node('button','btn secondary small','Xem thêm nhà cung cấp');
 const id='purchase-supplier-'+(++sequence);input.type='search';input.maxLength=200;input.autocomplete='off';input.placeholder='Tên, MST, SĐT hoặc tên người liên hệ…';input.setAttribute('role','combobox');input.setAttribute('aria-label','Tìm nhà cung cấp theo tên, MST, SĐT hoặc người liên hệ');input.setAttribute('aria-controls',id);input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');list.id=id;list.setAttribute('role','listbox');status.setAttribute('role','status');more.type='button';more.hidden=list.hidden=true;label.append(input);root.append(label,list,status,more);
 let timer,request=0,rows=[],index=-1,next=null,disposed=false,engaged=false;
 const current=ticket=>!disposed&&active()&&ticket===request&&engaged;
 function hide(){list.hidden=more.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
 function dismiss(){engaged=false;clearTimeout(timer);request++;hide();input.removeAttribute('aria-busy');}
 function reset(){engaged=false;clearTimeout(timer);request++;rows=[];index=-1;next=null;input.value='';status.textContent='';list.replaceChildren();hide();input.removeAttribute('aria-busy');}
 function pick(row){if(selected(row.id))return;reset();choose(row);}
 function paint(){
  list.replaceChildren();rows.forEach((row,i)=>{const option=node('button','pur-supplier-option');option.type='button';option.id=id+'-'+i;option.setAttribute('role','option');option.setAttribute('aria-selected',String(i===index));option.disabled=selected(row.id);
   const details=[row.taxCode&&'MST '+row.taxCode,row.phone,...(row.contacts||[]).map(c=>[c.name,c.phone].filter(Boolean).join(' · '))].filter(Boolean).join(' · ');
   option.append(node('b','',row.name),node('small','muted',details||'Chưa có MST / SĐT'));option.addEventListener('click',()=>pick(row));list.append(option);
  });list.hidden=!rows.length;more.hidden=next==null;input.setAttribute('aria-expanded',String(rows.length>0));
  if(index>=0)input.setAttribute('aria-activedescendant',id+'-'+index);else input.removeAttribute('aria-activedescendant');
 }
 async function load(append=false){
  if(disposed||!active()||!engaged)return;clearTimeout(timer);const ticket=++request,q=input.value.trim(),offset=append?next:0;if(append&&offset==null)return;
  if(!append){rows=[];index=-1;list.replaceChildren();hide();}more.disabled=true;input.setAttribute('aria-busy','true');status.textContent='Đang tìm NCC…';
  try{const result=await api('/purchase-options/suppliers?q='+encodeURIComponent(q)+'&offset='+offset);if(!current(ticket))return;
   rows=append?[...rows,...result.suppliers.filter(r=>!rows.some(x=>x.id===r.id))]:result.suppliers;next=result.nextOffset;index=-1;status.textContent=rows.length?'Chọn một NCC để thêm vào đơn.':'Không thấy NCC đang hoạt động phù hợp.';paint();
  }catch(error){if(current(ticket)){status.textContent=error.message||'Chưa tìm được NCC. Gõ lại để thử lại.';hide();}}
  finally{if(current(ticket)){more.disabled=false;input.removeAttribute('aria-busy');}}
 }
 input.addEventListener('input',()=>{engaged=true;clearTimeout(timer);request++;rows=[];index=-1;next=null;list.replaceChildren();hide();status.textContent='';timer=setTimeout(()=>load(),220);});
 input.addEventListener('focus',()=>{engaged=true;if(rows.length)paint();else load();});
 input.addEventListener('keydown',e=>{
  if(e.key==='Escape'){if(!list.hidden||input.getAttribute('aria-busy')==='true'){e.preventDefault();e.stopPropagation();dismiss();}return;}
  if(e.key==='Enter'){e.preventDefault();if(index>=0&&rows[index])pick(rows[index]);return;}
  if(!['ArrowDown','ArrowUp'].includes(e.key)||!rows.length)return;e.preventDefault();
  let nextIndex=index;for(let n=0;n<rows.length;n++){nextIndex=(nextIndex+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length;if(!selected(rows[nextIndex].id)){index=nextIndex;break;}}
  paint();list.children[index]?.scrollIntoView({block:'nearest'});
 });
 // Mobile Safari may blur the input with relatedTarget=null before an option receives click.
 // Dismiss on an actual outside interaction, never on that ambiguous touch blur.
 const outside=e=>{if(!root.contains(e.target))dismiss();else engaged=true;};
 document.addEventListener('pointerdown',outside,true);
 root.addEventListener('focusout',e=>{if(e.relatedTarget&&!root.contains(e.relatedTarget))dismiss();});
 input.addEventListener('click',()=>{engaged=true;if(list.hidden&&input.getAttribute('aria-busy')!=='true')load();});
 more.addEventListener('click',()=>{engaged=true;load(true);});
 return{root,input,load,reset,refresh:()=>{request++;rows=[];if(engaged)load();},dispose:()=>{disposed=true;document.removeEventListener('pointerdown',outside,true);dismiss();}};
}

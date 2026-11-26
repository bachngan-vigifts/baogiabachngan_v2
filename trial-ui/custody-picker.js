/** Search and choose one authorized API result; typed text is never an entity ID. */
export function custodyPicker({host,api,type,name,title,required=false,product=false,choose,isCurrent}){
 const label=document.createElement('label'),caption=document.createElement('span'),input=document.createElement('input'),value=document.createElement('input'),clear=document.createElement('button'),results=document.createElement('div'),status=document.createElement('p');
 caption.textContent=title;input.type='search';input.placeholder=product?'Tìm tên hoặc mã sản phẩm…':'Tìm tên để chọn…';input.required=required;input.autocomplete='off';value.type='hidden';value.name=name;
 clear.type='button';clear.className='btn secondary small';clear.textContent='Bỏ chọn';clear.hidden=true;
 results.className='custody-picker-results';results.id='custody-options-'+crypto.randomUUID();input.setAttribute('aria-controls',results.id);status.setAttribute('role','status');status.className='muted';label.append(caption,input);host.append(label,value,clear,status,results);host.classList.add('custody-picker');
 let serial=0,timer,opened=false;const current=()=>host.isConnected&&isCurrent();
 const invalidate=()=>{value.value='';clear.hidden=true;input.setCustomValidity(required?'Chọn bên nhận từ bảng kết quả.':'');};
 function close(){opened=false;++serial;clearTimeout(timer);results.hidden=true;status.hidden=true;input.setAttribute('aria-expanded','false');}
 async function load(){if(!opened)return;const run=++serial;results.replaceChildren();status.textContent='Đang tìm…';try{const d=await api('/product-custody/options?'+new URLSearchParams({type:type(),q:input.value}));if(run!==serial||!current()||!opened)return;
 status.textContent=d.items.length?(d.items.length===50?'Hiện tối đa 50 kết quả. Gõ thêm để thu hẹp.':'Bấm vào tên để chọn.'):'Không tìm thấy kết quả.';
 const table=document.createElement('table');table.innerHTML=product?'<thead><tr><th>Mã sản phẩm</th><th>Tên sản phẩm</th><th>ĐVT</th></tr></thead>':'<thead><tr><th>Tên bên nhận</th></tr></thead>';const body=document.createElement('tbody');
 for(const item of d.items){const row=document.createElement('tr');for(const [index,text] of (product?[item.id,item.name,item.unit]:[item.name]).entries()){
  const cell=document.createElement('td');if(index===(product?1:0)){
   const button=document.createElement('button');button.type='button';button.dataset.mobileInline='';button.className='custody-picker-option';button.textContent=item.name;button.setAttribute('aria-label',(product?'Thêm ':'Chọn ')+(product?item.id+' · ':'')+item.name);
   button.onclick=()=>{if(!current())return;close();if(product){choose(item);return;}value.value=item.id;input.value=item.name;input.setCustomValidity('');clear.hidden=false;input.focus();close();};cell.append(button);
  }else cell.textContent=text||'';row.append(cell);
 }body.append(row);}table.append(body);results.append(table);
 }catch(error){if(run===serial&&current()&&opened){status.textContent='Không tải được: '+error.message;const retry=document.createElement('button');retry.type='button';retry.className='btn secondary small';retry.textContent='Thử lại';retry.onclick=load;results.append(retry);}}}
 function open(){if(opened)return Promise.resolve();opened=true;results.hidden=false;status.hidden=false;input.setAttribute('aria-expanded','true');return load();}
 input.onfocus=()=>void open();input.onclick=()=>void open();
 input.oninput=()=>{++serial;clearTimeout(timer);invalidate();results.replaceChildren();opened=true;results.hidden=false;status.hidden=false;input.setAttribute('aria-expanded','true');timer=setTimeout(load,250);};
 input.onkeydown=event=>{if(event.key==='ArrowDown'||event.key==='Enter'&&!value.value){event.preventDefault();void open().then(()=>results.querySelector('button')?.focus());}};
 host.onkeydown=event=>{if(event.key==='Escape'&&opened){event.preventDefault();event.stopPropagation();input.focus();close();}};
 host.onfocusout=event=>{if(!host.contains(event.relatedTarget))close();};
 clear.onclick=()=>{input.value='';invalidate();close();input.focus();void open();};
 invalidate();close();
 return {reset(){input.value='';invalidate();close();results.replaceChildren();},clear(){input.value='';invalidate();close();results.replaceChildren();status.textContent='';}};
}

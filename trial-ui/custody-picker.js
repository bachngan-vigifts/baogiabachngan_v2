/** Search and choose one authorized API result; typed text is never an entity ID. */
export function custodyPicker({host,api,type,name,title,required=false,product=false,choose,isCurrent}){
 const label=document.createElement('label'),caption=document.createElement('span'),input=document.createElement('input'),value=document.createElement('input'),clear=document.createElement('button'),results=document.createElement('div'),status=document.createElement('p');
 caption.textContent=title;input.type='search';input.placeholder=product?'Tìm tên hoặc mã sản phẩm…':'Tìm tên để chọn…';input.required=required;input.autocomplete='off';value.type='hidden';value.name=name;
 clear.type='button';clear.className='btn secondary small';clear.textContent='Bỏ chọn';clear.hidden=true;
 results.className='custody-picker-results';status.setAttribute('role','status');status.className='muted';label.append(caption,input);host.append(label,value,clear,status,results);host.classList.add('custody-picker');
 let serial=0,timer;const current=()=>host.isConnected&&isCurrent();
 const invalidate=()=>{value.value='';clear.hidden=true;input.setCustomValidity(required?'Chọn bên nhận từ bảng kết quả.':'');};
 async function load(){const run=++serial;results.replaceChildren();status.textContent='Đang tìm…';try{const d=await api('/product-custody/options?'+new URLSearchParams({type:type(),q:input.value}));if(run!==serial||!current())return;
 status.textContent=d.items.length?(d.items.length===50?'Hiện tối đa 50 kết quả. Gõ thêm để thu hẹp.':'Chọn một dòng trong bảng.'):'Không tìm thấy kết quả.';
 const table=document.createElement('table');table.innerHTML=product?'<thead><tr><th>Mã sản phẩm</th><th>Tên sản phẩm</th><th>ĐVT</th><th></th></tr></thead>':'<thead><tr><th>Tên bên nhận</th><th></th></tr></thead>';const body=document.createElement('tbody');
 for(const item of d.items){const row=document.createElement('tr');for(const text of product?[item.id,item.name,item.unit]:[item.name]){const cell=document.createElement('td');cell.textContent=text||'';row.append(cell);}const cell=document.createElement('td'),button=document.createElement('button');button.type='button';button.dataset.mobileInline='';button.className='btn secondary small';button.textContent=product?'Thêm':'Chọn';button.setAttribute('aria-label',(product?'Thêm ':'Chọn ')+(product?item.id+' · ':'')+item.name);button.onclick=()=>{if(!current())return;if(product){choose(item);return;}value.value=item.id;input.value=item.name;input.setCustomValidity('');clear.hidden=false;results.replaceChildren();status.textContent='Đã chọn: '+item.name;input.focus();};cell.append(button);row.append(cell);body.append(row);}table.append(body);results.append(table);
 }catch(error){if(run===serial&&current()){status.textContent='Không tải được: '+error.message;const retry=document.createElement('button');retry.type='button';retry.className='btn secondary small';retry.textContent='Thử lại';retry.onclick=load;results.append(retry);}}}
 input.oninput=()=>{++serial;clearTimeout(timer);invalidate();results.replaceChildren();timer=setTimeout(load,250);};
 input.onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();results.querySelector('button')?.focus();}if(event.key==='Enter'&&!value.value){event.preventDefault();results.querySelector('button')?.focus();}};
 clear.onclick=()=>{input.value='';invalidate();load();input.focus();};
 invalidate();load();
 return {reset(){++serial;clearTimeout(timer);input.value='';invalidate();load();},clear(){++serial;clearTimeout(timer);input.value='';invalidate();results.replaceChildren();status.textContent='';}};
}

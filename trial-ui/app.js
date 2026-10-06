const API='https://taceqfnsorewelsbdckg.supabase.co/functions/v1/baogia-v2-api/api/staff';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:0}).format(v||0);
const date=v=>new Date(v).toLocaleDateString('vi-VN');
let token=sessionStorage.getItem('bn-v2-session')||'', user=null, quotes=[],customers=[],page='quotes',quote=null,customerId=null,rows=[];
let activation=new URLSearchParams(location.hash.slice(1)).get('token');
$('#today').textContent=new Date().toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
async function api(path,method='GET',body){
 const headers={'content-type':'application/json'};if(token)headers.authorization='Bearer '+token;
 let r;try{r=await fetch(API+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});}catch{throw new Error('Chưa thể kết nối. Vui lòng kiểm tra mạng rồi thử lại.');}
 const data=await r.json().catch(()=>({error:'Máy chủ chưa sẵn sàng. Vui lòng thử lại.'}));
 if(!r.ok){if(r.status===401&&path!=='/login')showAuth();throw new Error(data.error||'Không thực hiện được thao tác.');}
 if(data.sessionToken!==undefined){token=data.sessionToken;if(token)sessionStorage.setItem('bn-v2-session',token);else sessionStorage.removeItem('bn-v2-session');}
 return data;
}
function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';setTimeout(()=>$('#toast').style.display='none',3500);}
function showAuth(){user=null;token='';sessionStorage.removeItem('bn-v2-session');$('#auth').hidden=false;$('#workspace').hidden=true;}
async function load(){
 $('#load-error').textContent='';
 try{const [q,c]=await Promise.all([api('/quotes'),api('/customers')]);quotes=q.quotes;customers=c.customers;renderQuotes();renderCustomers();}
 catch(e){$('#load-error').textContent=e.message;}
}
async function enter(){
 user=(await api('/me')).user;
 if(user.role==='supplier'||user.positionId==='supplier')throw new Error('Bản dùng thử này dành cho nhân viên và Manager. Cổng NCC đang được hoàn thiện.');
 $('#auth').hidden=true;$('#workspace').hidden=false;$('#user-name').textContent=user.name;$('#user-role').textContent=user.role==='manager'?'Manager':'Nhân viên';
 await load();
}
$('#login-form').addEventListener('submit',async e=>{
 e.preventDefault();const b=$('#login-button');b.disabled=true;$('#auth-error').textContent='';
 try{if(activation){await api('/activate','POST',{token:activation,password:$('#password').value});activation=null;history.replaceState(null,'',location.pathname);$('#auth-title').textContent='Đăng nhập';$('#login-button').textContent='Đăng nhập';$('#email').readOnly=false;await api('/login','POST',{email:$('#email').value,password:$('#password').value});}else await api('/login','POST',{email:$('#email').value,password:$('#password').value});await enter();}
 catch(e){$('#auth-error').textContent=e.message;}finally{b.disabled=false;}
});
if(activation){$('#auth-title').textContent='Đặt mật khẩu';$('#auth-note').textContent='Đặt mật khẩu cho tài khoản dùng thử của anh (từ 8 ký tự).';$('#login-button').textContent='Kích hoạt & đăng nhập';$('#password').autocomplete='new-password';const email=new URLSearchParams(location.hash.slice(1)).get('email');if(email){$('#email').value=email;$('#email').readOnly=true;}}
else if(token)enter().catch(e=>{$('#auth-error').textContent=e.message;showAuth();});
$('#logout').onclick=async()=>{try{await api('/logout','POST',{});}finally{showAuth();}};
function switchPage(p){page=p;$$('.nav').forEach(b=>b.classList.toggle('active',b.dataset.page===p));for(const n of ['quotes','customers','sapo'])$('#'+n+'-page').hidden=n!==p;const titles={quotes:'Báo giá',customers:'Khách hàng',sapo:'Kết nối Sapo'};$('#page-title').textContent=$('#breadcrumb').textContent=titles[p];$('#page-description').textContent=p==='quotes'?'Tạo báo giá, theo dõi phiên bản và chuẩn bị gửi khách hàng.':p==='customers'?'Thông tin liên hệ để lập báo giá nhanh hơn.':'Cấu hình đồng bộ cửa hàng.';$('#new-record').hidden=p==='sapo';$('#new-record').textContent=p==='quotes'?'＋ Tạo báo giá':'＋ Thêm khách hàng';}
$$('.nav').forEach(b=>b.onclick=()=>switchPage(b.dataset.page));$('#new-record').onclick=()=>page==='quotes'?openQuote():openCustomer();$('#first-quote').onclick=()=>openQuote();
function renderQuotes(){
 const search=$('#quote-search').value.toLocaleLowerCase('vi');const list=quotes.filter(q=>(q.quoteNo+' '+q.customer).toLocaleLowerCase('vi').includes(search));
 $('#stat-count').textContent=quotes.length;$('#quote-count').textContent=quotes.length;$('#stat-value').textContent=money(quotes.reduce((s,q)=>s+q.total,0));$('#stat-customers').textContent=customers.length;
 $('#quote-list').innerHTML=list.map(q=>`<tr><td class="quote-no">${esc(q.quoteNo)}<small>Phiên bản ${esc(q.revision)}</small></td><td>${esc(q.customer)}</td><td><span class="type-tag">${esc(q.quoteType)}</span></td><td class="right"><strong>${money(q.total)}</strong></td><td>${date(q.updatedAt)}</td><td><button class="table-action" data-quote="${esc(q.id)}">Mở báo giá</button></td></tr>`).join('');
 $('#quote-empty').hidden=quotes.length>0;$$('[data-quote]').forEach(b=>b.onclick=()=>openQuote(b.dataset.quote));
 if(!list.length&&quotes.length)$('#quote-list').innerHTML='<tr><td colspan="6">Không có báo giá khớp với tìm kiếm.</td></tr>';
}
function renderCustomers(){
 const search=$('#customer-search').value.toLocaleLowerCase('vi');const list=customers.filter(c=>(c.name+' '+c.phone).toLocaleLowerCase('vi').includes(search));
 $('#customer-list').innerHTML=list.map(c=>`<tr><td><strong>${esc(c.name)}</strong><small>${esc(c.address)}</small></td><td>${esc(c.contact)||'—'}</td><td>${esc(c.phone)||'—'}</td><td>${esc(c.email)||'—'}</td><td><button class="table-action" data-customer="${esc(c.id)}">Sửa</button></td></tr>`).join('');
 $('#customer-empty').hidden=customers.length>0;$$('[data-customer]').forEach(b=>b.onclick=()=>openCustomer(b.dataset.customer));if(!list.length&&customers.length)$('#customer-list').innerHTML='<tr><td colspan="5">Không có khách hàng khớp với tìm kiếm.</td></tr>';
}
$('#quote-search').oninput=renderQuotes;$('#customer-search').oninput=renderCustomers;
$$('.close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
const qf=$('#quote-form');function field(name){return qf.elements.namedItem(name);}
function fillForm(form,data){for(const [k,v]of Object.entries(data)){const f=form.elements.namedItem(k);if(f&&['INPUT','SELECT','TEXTAREA'].includes(f.tagName))f.value=v??'';}}
async function openQuote(id){
 $('#quote-error').textContent='';
 try{quote=id?await api('/quotes/'+encodeURIComponent(id)):null;
 const data=quote?.data||{quoteNo:'BG-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+String(quotes.length+1).padStart(3,'0'),type:'B2B',date:new Date().toISOString().slice(0,10),vat:8,customer:'',notes:''};
 qf.reset();fillForm(qf,data);rows=(data.rows||[{id:crypto.randomUUID(),name:'',sku:'',qty:1,price:0,discount:0,printFee:0}]).map(r=>({...r}));
 $('#quote-dialog-title').textContent=id?'Sửa báo giá '+data.quoteNo:'Tạo báo giá';$('#customer-picker').innerHTML='<option value="">Nhập khách hàng thủ công</option>'+customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');$('#customer-picker').value=data.customerId||'';renderLines();$('#quote-dialog').showModal();
 }catch(e){toast(e.message);}
}
function renderLines(){
 $('#line-list').innerHTML=rows.map((r,i)=>`<tr data-line="${i}"><td><input data-field="name" value="${esc(r.name)}" placeholder="Tên sản phẩm" required maxlength="500" aria-label="Tên sản phẩm dòng ${i+1}"><input class="sku" data-field="sku" value="${esc(r.sku)}" placeholder="Mã SKU" maxlength="500" aria-label="SKU dòng ${i+1}"></td><td><input data-field="qty" type="number" min="0" max="1000000000" step="any" value="${r.qty??1}" required aria-label="Số lượng dòng ${i+1}"></td><td><input data-field="price" type="number" min="0" max="1000000000000" step="any" value="${r.price??0}" required aria-label="Đơn giá dòng ${i+1}"></td><td><input data-field="discount" type="number" min="0" max="${r.discountType==='amount'?1000000000000:100}" step="any" value="${r.discount??0}" required aria-label="Chiết khấu dòng ${i+1}">${r.discountType==='amount'?'<small>Giảm số tiền</small>':''}</td><td><input data-field="printFee" type="number" min="0" step="any" value="${r.printFee??0}" required aria-label="Phí in dòng ${i+1}"></td><td class="line-total"></td><td><button type="button" class="icon" data-remove="${i}" aria-label="Xóa dòng ${i+1}">×</button></td></tr>`).join('');
 $$('[data-line] input').forEach(input=>input.oninput=()=>{const i=Number(input.closest('tr').dataset.line),k=input.dataset.field;rows[i][k]=input.type==='number'?Number(input.value):input.value;calculate();});
 $$('[data-remove]').forEach(b=>b.onclick=()=>{if(rows.length===1){toast('Báo giá cần ít nhất một dòng sản phẩm.');return;}rows.splice(Number(b.dataset.remove),1);renderLines();});calculate();
}
function calculate(){let subtotal=0,tax=0;rows.forEach((r,i)=>{const unit=Math.max(0,(r.price||0)-(r.discountType==='amount'?(r.discount||0):(r.price||0)*(r.discount||0)/100))+(field('type').value!=='HRC'?(r.printFee||0):0);const line=unit*(r.qty||0);subtotal+=line;tax+=line*(Number.isFinite(r.taxRate)?r.taxRate:Number(field('vat').value||0))/100;const cell=$(`[data-line="${i}"] .line-total`);if(cell)cell.textContent=money(line);});$('#subtotal').textContent=money(subtotal);$('#tax').textContent=money(tax);$('#total').textContent=money(subtotal+tax);return{subtotal,tax,total:subtotal+tax};}
$('#add-line').onclick=()=>{if(rows.length>=300){toast('Báo giá tối đa 300 dòng.');return;}rows.push({id:crypto.randomUUID(),name:'',sku:'',qty:1,price:0,discount:0,printFee:0});renderLines();};field('vat').oninput=calculate;field('type').onchange=calculate;
$('#customer-picker').onchange=()=>{const c=customers.find(c=>c.id===$('#customer-picker').value);if(c)fillForm(qf,{customer:c.name,contact:c.contact,phone:c.phone,customerAddress:c.address});};
function quoteData(){const data={...(quote?.data||{}),...Object.fromEntries(new FormData(qf)),vat:Number(field('vat').value),customerId:$('#customer-picker').value,rows:rows.map(r=>({...r,discountType:r.discountType||'percent'}))};return data;}
qf.onsubmit=async e=>{e.preventDefault();$('#save-quote').disabled=true;$('#quote-error').textContent='';try{const data=quoteData();const saved=quote?await api('/quotes/'+encodeURIComponent(quote.id),'PUT',{revision:quote.revision,data}):await api('/quotes','POST',data);quote=saved;$('#quote-dialog').close();await load();toast('Đã lưu báo giá.');}catch(e){$('#quote-error').textContent=e.message;}finally{$('#save-quote').disabled=false;}};
$('#print-quote').onclick=()=>{if(!qf.reportValidity())return;const d=quoteData(),t=calculate();$('#print-sheet').innerHTML=`<strong>BÁCH NGÂN</strong><h1>BÁO GIÁ</h1><p>Số: ${esc(d.quoteNo)} · Ngày: ${esc(d.date)}<br>Khách hàng: ${esc(d.customer)}<br>Liên hệ: ${esc(d.contact)} · ${esc(d.phone)}<br>Địa chỉ: ${esc(d.customerAddress)}</p><table><thead><tr><th>STT</th><th>Sản phẩm</th><th>SL</th><th>Đơn giá</th><th>CK</th><th>Phí in</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.name)}<br>${esc(r.sku)}</td><td>${r.qty}</td><td>${money(r.price)}</td><td>${r.discountType==='amount'?money(r.discount):r.discount+'%'}</td><td>${money(r.printFee)}</td></tr>`).join('')}</tbody></table><p class="print-total">Trước thuế: ${money(t.subtotal)}<br>VAT: ${money(t.tax)}<br><strong>Tổng cộng: ${money(t.total)}</strong></p><p>${esc(d.notes)}</p>`;window.print();};
function openCustomer(id){customerId=id||null;$('#customer-form').reset();$('#customer-error').textContent='';if(id)fillForm($('#customer-form'),customers.find(c=>c.id===id)||{});$('#customer-dialog-title').textContent=id?'Sửa khách hàng':'Thêm khách hàng';$('#customer-dialog').showModal();}
$('#customer-form').onsubmit=async e=>{e.preventDefault();$('#save-customer').disabled=true;$('#customer-error').textContent='';try{const data=Object.fromEntries(new FormData(e.target));await api(customerId?'/customers/'+encodeURIComponent(customerId):'/customers',customerId?'PUT':'POST',data);$('#customer-dialog').close();await load();toast('Đã lưu khách hàng.');}catch(e){$('#customer-error').textContent=e.message;}finally{$('#save-customer').disabled=false;}};

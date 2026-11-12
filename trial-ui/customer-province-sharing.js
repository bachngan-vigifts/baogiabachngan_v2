/** Manager-only, additive sharing. A reviewed server snapshot is required before any write. */
export async function openProvinceSharing({api,esc,toast,provinces,province='',onSaved}){
 const {people}=await api('/customers/staff-options'),staff=people.filter(p=>p.canShare===true&&['manager','employee'].includes(p.role));
 const dlg=document.createElement('dialog');dlg.className='modal customer-province-sharing';
 dlg.innerHTML=`<form novalidate><div class="modal-head"><h2>Chia sẻ khách hàng theo tỉnh</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">×</button></div>
 <div class="modal-body"><p>Tất cả khách <b>đã duyệt</b> trong tỉnh được chọn, gồm khách doanh nghiệp và khách lẻ. Các bộ lọc tìm kiếm khác ở danh sách không áp dụng tại đây.</p>
 <p class="muted small">Chỉ thêm người được chia sẻ; giữ nguyên người phụ trách và chia sẻ hiện có. Nhân viên nhận quyền truy cập hồ sơ, báo giá, đơn, HĐKT và công nợ theo cơ chế chia sẻ hiện tại.</p>
 <fieldset class="province-share-fields"><label>Tỉnh/thành sau sáp nhập<select name="province"><option value="">Chọn tỉnh/thành…</option>${provinces.map(p=>`<option value="${esc(p.code)}">${esc(p.name)}</option>`).join('')}</select></label>
 <label>Tìm nhân viên<input type="search" name="search" placeholder="Tên nhân viên…"></label><div class="province-share-people">${staff.map(p=>`<label><input type="checkbox" name="member" value="${esc(p.id)}"> ${esc(p.name)}</label>`).join('')}</div></fieldset>
 <p class="error" data-error role="alert"></p><section data-preview aria-live="polite"></section></div>
 <div class="modal-foot"><button type="button" class="btn ghost" data-close>Đóng</button><button type="button" class="btn secondary" data-check>Xem trước</button><button type="submit" class="btn primary" data-apply disabled>Chia sẻ khách hàng</button></div></form>`;
 document.body.append(dlg);dlg.querySelector('[name=province]').value=province;
 const $=s=>dlg.querySelector(s),fields=$('fieldset'),error=$('[data-error]'),preview=$('[data-preview]'),check=$('[data-check]'),apply=$('[data-apply]');let reviewed=null,busy=false;
 const read=()=>({province:$('[name=province]').value,memberIds:[...dlg.querySelectorAll('[name=member]:checked')].map(x=>x.value).sort()});
 const invalidate=()=>{reviewed=null;apply.disabled=true;preview.replaceChildren();error.textContent='';};
 dlg.addEventListener('change',invalidate);dlg.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dlg.close());dlg.addEventListener('close',()=>dlg.remove(),{once:true});
 $('[name=search]').oninput=e=>{const q=e.target.value.toLocaleLowerCase('vi');dlg.querySelectorAll('.province-share-people label').forEach(l=>l.hidden=!l.textContent.toLocaleLowerCase('vi').includes(q));};
 const perform=async saving=>{
  if(busy)return;const body=read();if(!body.province||!body.memberIds.length){error.textContent='Chọn tỉnh/thành và ít nhất một nhân viên.';return;}
  if(saving&&!reviewed)return;
  busy=true;fields.disabled=true;check.disabled=true;apply.disabled=true;error.textContent='';
  try{
   const d=await api('/customers/province-sharing/'+(saving?'apply':'preview'),'POST',{...body,...(saving?{version:reviewed.version}:{})});
   if(!dlg.open)return;
   if(saving){dlg.close();toast(`Đã chia sẻ ${d.total} khách tại ${d.province.name}; thêm ${d.addedShares} lượt chia sẻ.`);await onSaved?.();return;}
   reviewed=d;preview.innerHTML=`<h3>Xem trước: ${esc(d.province.name)}</h3><p><b>${d.total} khách</b> · ${d.addedShares} lượt chia sẻ mới · ${d.alreadyShared} khách đã có đủ quyền.</p><p>Nhân viên nhận: ${d.staff.map(p=>esc(p.name)).join(', ')}.</p>${d.sample.length?`<p class="muted small">Một số khách: ${d.sample.map(c=>esc(c.name)).join('; ')}.</p>`:''}`;
  }catch(e){reviewed=null;preview.replaceChildren();if(dlg.open)error.textContent=e.message;}
  finally{busy=false;fields.disabled=false;check.disabled=false;apply.disabled=!reviewed?.addedShares;}
 };
 check.onclick=()=>perform(false);$('form').onsubmit=e=>{e.preventDefault();perform(true);};dlg.showModal();
 return dlg;
}

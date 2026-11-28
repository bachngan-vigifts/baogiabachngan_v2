const labels = { create:'Tạo mới', link:'Gắn khách/liên hệ có sẵn', update:'Cập nhật', unchanged:'Giữ nguyên', quarantine:'Lưu đối soát từ chối', conflict:'Cần đối soát', stale:'Nguồn cũ', blocked:'Tạm chặn' };
const fieldLabels={name:'Tên',contact:'Liên hệ chính',phone:'Điện thoại',email:'Email',address:'Địa chỉ',taxCode:'Mã số thuế',customerCode:'Mã khách',customerType:'Nhóm / loại khách',establishedDate:'Ngày thành lập',approvalStatus:'Phê duyệt',title:'Chức vụ',note:'Ghi chú liên hệ',isPrimary:'Liên hệ chính'};
const displayValue=value=>value===null||value===''?'Trống':value===true?'Có':value===false?'Không':value==='approved'?'Đã duyệt':value==='pending'?'Chờ duyệt':String(value);
export const appsheetSummary = summary => Object.entries(labels).map(([key,label])=>`${label}: ${summary[key]||0}`).join(' · ');

/** Review state is independent of the DOM so stale approvals and uncertain outcomes can be tested. */
export function createAppsheetReview(api) {
  let input=null,planHash=null,busy=false;
  const idle=()=>{if(busy)throw new Error('Đang xử lý dữ liệu AppSheet.');};
  return {
    get hasInput(){return !!input;}, get canApply(){return !busy&&!!planHash;},
    clear(){idle();input=null;planHash=null;},
    load(value){idle();if(!value||value.format!=='appsheet-customers-v1')throw new Error('File chưa đúng định dạng appsheet-customers-v1.');input=structuredClone(value);planHash=null;},
    resolve(kind,rowId,target){idle();if(!input||!['customers','contacts'].includes(kind))throw new Error('Chưa chọn dữ liệu.');
      input.resolutions||={customers:{},contacts:{}};input.resolutions[kind]||={};
      if(target)input.resolutions[kind]={...input.resolutions[kind],[rowId]:target};else delete input.resolutions[kind][rowId];planHash=null;
    },
    async preview(){idle();if(!input)throw new Error('Chưa chọn dữ liệu.');planHash=null;busy=true;
      try{const d=await api('/appsheet-customers/preview','POST',{input:structuredClone(input)});planHash=d.planHash;return d;}finally{busy=false;}
    },
    async apply(){idle();if(!planHash)throw new Error('Cần xem trước lại trước khi nhập.');const approved=planHash;planHash=null;busy=true;
      try{return await api('/appsheet-customers/apply','POST',{input:structuredClone(input),planHash:approved});}finally{busy=false;}
    },
  };
}

/** No source payload persists in localStorage; closing the dialog discards the selected file. */
export function openAppsheetCustomers({ api, esc, onSaved, document: doc = document }) {
  const dlg=doc.createElement('dialog');dlg.className='modal wide appsheet-import';
  // This dialog owns disabled state across preview/apply and background history requests.
  dlg.dataset.noBusy='';
  dlg.innerHTML=`<div class="modal-head"><h2>Nhập khách hàng AppSheet</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">×</button></div>
    <div class="modal-body"><p>Chọn file khách hàng và người liên hệ đã ánh xạ. Xem trước, đối soát rồi mới nhập. Không xóa dữ liệu CRM khi thiếu dòng trong file.</p>
    <label>File JSON (appsheet-customers-v1, tối đa 2 MB)<input type="file" accept=".json,application/json" data-file></label>
    <p class="muted small">Mỗi lô tối đa 200 khách và 200 liên hệ. Ngày thành lập dùng YYYY-MM-DD; ngày giờ nguồn phải có múi giờ. Khách nghi trùng cần chọn bản CRM tương ứng. Các trường nhân viên đã sửa được giữ lại.</p>
    <p class="error" role="alert" data-error></p><p role="status" data-summary></p><div data-report></div>
    <details><summary>Lịch sử nhập gần nhất</summary><div data-runs></div></details></div>
    <div class="modal-foot"><button type="button" class="btn secondary" data-close>Đóng</button><button type="button" class="btn secondary" data-preview disabled>Xem trước</button><button type="button" class="btn primary" data-apply disabled>Nhập theo bản xem trước</button></div>`;
  doc.body.append(dlg);
  const $=s=>dlg.querySelector(s),file=$('[data-file]'),preview=$('[data-preview]'),apply=$('[data-apply]');
  const review=createAppsheetReview(api);
  let busy=false,generation=0;
  const error=message=>{$('[data-error]').textContent=message;};
  const setBusy=value=>{busy=value;file.disabled=value;preview.disabled=value||!review.hasInput;apply.disabled=value||!review.canApply;
    dlg.querySelectorAll('select,[data-close]').forEach(el=>el.disabled=value);};
  const history=async()=>{try{const d=await api('/appsheet-customers/runs');$('[data-runs]').textContent=d.runs.map(r=>`${new Date(r.createdAt).toLocaleString('vi-VN')} · ${appsheetSummary(r.summary)}`).join('\n')||'Chưa có lần nhập.';}catch{$('[data-runs]').textContent='Chưa tải được lịch sử.';}};
  const render=d=>{
    $('[data-summary]').textContent=appsheetSummary(d.summary);
    const fieldNames=keys=>keys.map(k=>fieldLabels[k]||k).join(', ');
    $('[data-report]').innerHTML=`<div class="table-wrap"><table class="data-table"><thead><tr><th>Khách / liên hệ · khóa nguồn</th><th>Kết quả</th><th>Đối soát</th></tr></thead><tbody>${d.reports.map((r,i)=>`<tr><td>${esc(r.name||'')}<small>${r.kind==='customer'?'Khách':'Liên hệ'} · ${esc(r.rowId)}</small></td><td>${esc(labels[r.action]||r.action)}${r.reason?`<small>${esc(r.reason)}</small>`:''}${r.changed?.length?`<small>Trường nhập: ${esc(fieldNames(r.changed))}</small>`:''}${r.preserved?.length?`<small>Giữ dữ liệu CRM: ${esc(fieldNames(r.preserved))}</small>`:''}${r.changes?.length?`<details><summary>Xem thay đổi</summary>${r.changes.map(c=>`<p><b>${esc(fieldLabels[c.field]||c.field)}</b>: ${esc(displayValue(c.before))} → ${esc(displayValue(c.after))}</p>`).join('')}</details>`:''}</td><td>${r.candidates?.length?`<select data-resolution="${i}" aria-label="Chọn bản CRM cho ${esc(r.rowId)}"><option value="">Chưa chọn — bỏ qua dòng này</option>${r.candidates.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.id)}</option>`).join('')}${r.kind==='customer'&&r.candidates.every(c=>c.reasons.every(reason=>reason==='name'))?'<option value="$new">Khách khác trùng tên — tạo mới</option>':''}</select>`:'—'}</td></tr>`).join('')}</tbody></table></div>`;
    dlg.querySelectorAll('[data-resolution]').forEach(select=>select.addEventListener('change',()=>{
      const r=d.reports[Number(select.dataset.resolution)],kind=r.kind==='customer'?'customers':'contacts';
      review.resolve(kind,r.rowId,select.value);apply.disabled=true;$('[data-summary]').textContent='Lựa chọn đã đổi. Bấm Xem trước lại để kiểm tra.';
    }));
  };
  file.addEventListener('change',async()=>{
    const request=++generation;review.clear();apply.disabled=true;error('');$('[data-report]').replaceChildren();$('[data-summary]').textContent='';preview.disabled=true;
    try{const selected=file.files[0];if(!selected)return;if(selected.size>2_000_000)throw new Error('File vượt quá 2 MB. Hãy chia lô.');
      const value=JSON.parse(await selected.text());if(request!==generation||!dlg.isConnected)return;
      review.load(value);preview.disabled=false;
    }catch(e){if(request===generation)error(e.message);}
  });
  preview.addEventListener('click',async()=>{if(busy||!review.hasInput)return;setBusy(true);error('');
    try{render(await review.preview());}
    catch(e){error(e.message);}finally{setBusy(false);}
  });
  apply.addEventListener('click',async()=>{if(busy||!review.canApply)return;setBusy(true);error('');
    try{render(await review.apply());await history();onSaved?.();}
    catch(e){error(e.message+' Bấm Xem trước lại để kiểm tra kết quả trước khi thử tiếp.');}
    finally{setBusy(false);}
  });
  dlg.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>{if(!busy)dlg.close();}));
  dlg.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  dlg.addEventListener('close',()=>{++generation;if(!busy)review.clear();dlg.remove();});
  dlg.showModal();history();return dlg;
}

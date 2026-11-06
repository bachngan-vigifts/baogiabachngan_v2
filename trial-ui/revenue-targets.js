import {parseQuickNumber,formatQuickMoney} from './payroll-quick-entry.js';

export function parseRevenueTarget(raw){
  if(!String(raw??'').trim())return null;
  const value=parseQuickNumber(raw,['amount','Chỉ tiêu doanh số']);
  if(!Number.isSafeInteger(value)||value<=0||value>1e13)throw Error('Chỉ tiêu phải là số tiền nguyên lớn hơn 0, tối đa 10.000 tỷ. Để trống nếu bỏ đăng ký.');
  return value;
}

/** Chỉ Manager mở bảng. API kiểm tra quyền, tháng khóa và phiên bản một lần nữa khi lưu. */
export async function openRevenueTargets({api,esc,toast,confirmBox},year,onSaved=()=>{}){
  const dlg=document.createElement('dialog');dlg.className='modal revenue-targets-dialog';dlg.style.width='min(1320px,96vw)';dlg.style.maxWidth='96vw';
  dlg.innerHTML=`<div class="modal-head"><h2>Đăng ký doanh số năm</h2><button type="button" class="icon-btn" data-close aria-label="Đóng">×</button></div>
    <div class="modal-body"><div class="row-actions" style="justify-content:flex-start;align-items:flex-end"><label>Năm<input data-year type="number" min="2000" max="2100" step="1" value="${esc(year)}" style="width:110px"></label><button type="button" class="btn secondary" data-load>Tải năm</button><label>Tìm nhân viên<input data-search placeholder="Tên nhân viên…"></label></div>
    <p class="muted small">Chỉ áp dụng cho nhân viên có chức vụ Sale. Chỉ tiêu đăng ký, không phải doanh số thực hiện. Số liệu doanh số dùng tính KPI là chưa VAT − hoa hồng. Ô trống: chưa đăng ký, dùng chỉ tiêu hồ sơ cũ hoặc mức chung. Không kế thừa đăng ký sang tháng/năm khác. Tháng đã chốt lương chỉ xem.</p>
    <div data-grid></div><label>Lý do đăng ký / điều chỉnh<input data-reason maxlength="500" placeholder="Ví dụ: Đăng ký kế hoạch doanh số năm"></label><p class="error" role="alert" data-error></p></div>
    <div class="modal-foot"><span class="muted small" data-status></span><button type="button" class="btn secondary" data-close>Đóng</button><button type="button" class="btn primary" data-save disabled>Lưu đăng ký</button></div>`;
  document.body.append(dlg);dlg.showModal();
  const grid=dlg.querySelector('[data-grid]'),save=dlg.querySelector('[data-save]'),status=dlg.querySelector('[data-status]'),error=dlg.querySelector('[data-error]');
  let data,drafts=new Map(),rawDirty=new Set(),busy=false,seq=0;
  const pending=()=>new Set([...drafts.keys(),...rawDirty]).size;
  const setBusy=value=>{busy=value;dlg.querySelectorAll('button,input').forEach(el=>{el.disabled=value||el.hasAttribute('data-locked');});save.disabled=value||!pending();};
  const dirty=()=>{status.textContent=pending()?`${pending()} ô chưa lưu`:'Đã tải dữ liệu';save.disabled=busy||!pending();};
  const discard=async()=>!pending()||await confirmBox('Có chỉ tiêu chưa lưu. Bỏ các thay đổi này?',{ok:'Bỏ thay đổi'});
  const close=async()=>{if(busy)return;if(await discard())dlg.close();};
  dlg.addEventListener('cancel',e=>{e.preventDefault();close();});dlg.addEventListener('close',()=>dlg.remove());dlg.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);
  const applySearch=()=>{const term=dlg.querySelector('[data-search]').value.trim().toLocaleLowerCase('vi');grid.querySelectorAll('tbody tr[data-name]').forEach(tr=>{tr.hidden=!tr.dataset.name.includes(term);});};
  function render(){
    dlg.querySelector('h2').textContent='Đăng ký doanh số năm '+data.year;
    grid.innerHTML=`<div class="table-wrap" style="max-height:55vh;overflow:auto"><table class="data-table revenue-target-table"><thead><tr><th style="position:sticky;left:0;z-index:3;background:#102a56;color:white;min-width:200px">Nhân viên</th>${data.months.map(m=>`<th class="right">Tháng ${Number(m.slice(5))}</th>`).join('')}<th class="right">Tổng đăng ký</th></tr></thead><tbody>${data.rows.map((r,i)=>`<tr data-name="${esc((r.member.name+' '+r.member.id).toLocaleLowerCase('vi'))}"><td class="first" style="position:sticky;left:0;z-index:1;background:white"><b>${esc(r.member.name)}</b><small>${esc(r.member.positionId||'')}${r.member.active?'':' · Ngừng hoạt động'}</small></td>${data.months.map(m=>`<td><input data-target data-row="${i}" data-month="${m}" inputmode="numeric" style="width:130px;text-align:right" aria-label="${esc(r.member.name+' — Chỉ tiêu '+m)}" placeholder="Chưa đăng ký" value="${r.values[m]===null?'':formatQuickMoney(r.values[m])}" ${r.lockedMonths.includes(m)?'disabled data-locked title="Đã chốt lương; chỉ xem"':''}></td>`).join('')}<td class="right num" data-total-row="${i}"></td></tr>`).join('')||'<tr><td colspan="14" class="muted">Chưa có nhân viên chức vụ Sale.</td></tr>'}</tbody><tfoot><tr><th>Tổng đăng ký</th>${data.months.map(m=>`<th class="right num" data-total-month="${m}"></th>`).join('')}<th class="right num" data-total-year></th></tr></tfoot></table></div>`;
    totals();applySearch();dirty();
  }
  function totals(){
    let yearTotal=0n;const months=Object.fromEntries(data.months.map(m=>[m,0n]));
    data.rows.forEach((r,i)=>{let sum=0n;data.months.forEach(m=>{const key=i+':'+m,v=drafts.has(key)?drafts.get(key).amount:r.values[m];if(v!==null){sum+=BigInt(v);months[m]+=BigInt(v);}});yearTotal+=sum;grid.querySelector(`[data-total-row="${i}"]`).textContent=formatQuickMoney(sum);});
    for(const m of data.months)grid.querySelector(`[data-total-month="${m}"]`).textContent=formatQuickMoney(months[m]);grid.querySelector('[data-total-year]').textContent=formatQuickMoney(yearTotal);
  }
  async function load(next){
    if(busy)return;if(!/^\d{4}$/.test(String(next))||+next<2000||+next>2100){error.textContent='Năm phải từ 2000 đến 2100.';if(data)dlg.querySelector('[data-year]').value=data.year;return;}
    if(!await discard()){dlg.querySelector('[data-year]').value=data.year;return;}
    const request=++seq;setBusy(true);error.textContent='';status.textContent='Đang tải năm '+next+'…';grid.inert=true;
    try{const result=await api('/hr/revenue-targets/'+next);if(request!==seq||!dlg.isConnected)return;if(result.year!==String(next))throw Error('Dữ liệu trả về không đúng năm.');data=result;drafts=new Map();rawDirty.clear();dlg.querySelector('[data-year]').value=data.year;render();}
    catch(e){error.textContent=e.message;if(data)dlg.querySelector('[data-year]').value=data.year;}
    finally{grid.inert=false;setBusy(false);}
  }
  dlg.querySelector('[data-load]').onclick=()=>load(dlg.querySelector('[data-year]').value);
  dlg.querySelector('[data-year]').onchange=()=>load(dlg.querySelector('[data-year]').value);
  dlg.querySelector('[data-search]').oninput=applySearch;
  grid.addEventListener('input',e=>{if(e.target.matches('[data-target]')){rawDirty.add(e.target.dataset.row+':'+e.target.dataset.month);e.target.removeAttribute('aria-invalid');dirty();}});
  function capture(el){
    const i=Number(el.dataset.row),m=el.dataset.month,r=data.rows[i],amount=parseRevenueTarget(el.value),key=i+':'+m;
    if(amount===r.values[m])drafts.delete(key);else drafts.set(key,{memberId:r.member.id,month:m,amount});
    rawDirty.delete(key);
    el.value=amount===null?'':formatQuickMoney(amount);el.removeAttribute('aria-invalid');return true;
  }
  grid.addEventListener('focusout',e=>{if(!e.target.matches('[data-target]'))return;try{capture(e.target);error.textContent='';totals();dirty();}catch(ex){e.target.setAttribute('aria-invalid','true');error.textContent=ex.message;}});
  grid.addEventListener('keydown',e=>{if(e.key!=='Enter'||!e.target.matches('[data-target]'))return;e.preventDefault();const cells=[...grid.querySelectorAll('[data-target]:not([disabled])')],next=cells.indexOf(e.target)+(e.shiftKey?-1:1);cells[next]?.focus();});
  save.onclick=async()=>{
    if(busy||!data)return;error.textContent='';
    try{for(const el of grid.querySelectorAll('[data-target]:not([disabled])'))capture(el);totals();dirty();if(!drafts.size)return;
      const reason=dlg.querySelector('[data-reason]').value.trim();if(reason.length<3)throw Error('Nhập lý do đăng ký / điều chỉnh (ít nhất 3 ký tự).');
      setBusy(true);const changes=[...drafts.values()],result=await api('/hr/revenue-targets/'+data.year,'PUT',{version:data.version,reason,changes});
      for(const change of changes)data.rows.find(r=>r.member.id===change.memberId).values[change.month]=change.amount;
      data.version=result.version;drafts.clear();rawDirty.clear();render();toast(`Đã lưu ${result.changed} ô chỉ tiêu doanh số.`);
      try{await onSaved();}catch(ex){toast('Đã lưu đăng ký; tải lại hồ sơ để cập nhật chỉ tiêu.','err');}
    }catch(ex){error.textContent=ex.message;}finally{setBusy(false);}
  };
  await load(String(year));
  return dlg;
}

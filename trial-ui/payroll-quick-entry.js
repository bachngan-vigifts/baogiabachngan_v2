import {downloadPayrollTemplate,readPayrollFile,parsePayrollFile} from './payroll-file.js';
import { payrollSheetHtml } from './payroll-sheet.js';
// Excel-style entry uses the existing server payroll engine; displayed totals are saved calculations.
export const QUICK_COLUMNS = {
  inputs: [ ['workDays','Ngày công',true,true], ['overtimeHours','Giờ tăng ca',true], ['lateCount','Số lần đi trễ',true], ['leaveHours','Số giờ nghỉ trong ngày',true], ['revenue','Doanh số tháng',false,true],
    ['outputQty','Sản lượng',true], ['quarterBonus','Thưởng quý',false,true], ['healthInsurance','BHYT'], ['incomeTax','Thuế TNCN'],
    ['kpiNewCustomers','KH mới',true,true], ['kpiTransactions','Giao dịch',true,true], ['kpiContracts','Số HĐ',true,true],
    ['kpiRevenue','DS KPI',false,true], ['kpiMerchDays','Ngày làm hàng',true], ['kpiTripDays','Ngày công tác',true], ['kpiOverride','KPI chốt (1 = 100%)',true,true] ],
  profile: [ ['baseSalary','LCB / lương thỏa thuận'], ['capacityCoef','Hệ số năng lực',true], ['responsibility','Trách nhiệm / đơn giá'],
    ['phoneAllowance','PC điện thoại'], ['attendanceBonus','Chuyên cần'], ['insurance','BHXH'], ['outputRate','Đơn giá / tỷ lệ sản lượng',true], ['mealAllowance','Hưởng cơm / xăng','boolean'], ['positionLabel','Vị trí','text'] ],
  adjustments: [ ['bonus','Thưởng khác'], ['allowance','Công tác / phụ cấp khác'], ['deduction','Vi phạm'], ['phone_advance','Tạm ứng điện thoại'], ['advance','Tạm ứng'] ],
};
export const formatQuickMoney = value => new Intl.NumberFormat('en-US', {maximumFractionDigits:6}).format(value);
export function parseQuickNumber(raw, column) {
  if (column[2] === 'text') {const v=String(raw).trim().toLocaleUpperCase('vi'); if(v.length>60) throw new Error('Vị trí tối đa 60 ký tự.'); return v;}
  if (column[2] === 'boolean') {
    const value=String(raw).trim().toLocaleLowerCase('vi');
    if (['true','1','có','co'].includes(value)) return true;
    if (['false','0','không','khong',''].includes(value)) return false;
    throw new Error('Cơm/xăng: nhập Có hoặc Không.');
  }
  let value = String(raw).trim();
  if (!value) return column[3] ? null : 0;
  const invalid = () => { throw new Error('Số không hợp lệ. Dùng dấu chấm phân cách hàng nghìn và dấu phẩy cho phần thập phân (15.000; 24,5; 0,005).'); };
  // A space is a grouping separator only when each group contains three digits.
  if (/[\s\u00a0\u202f]/.test(value)) {
    if (!/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?$/.test(value)) invalid();
    value = value.replace(/[ \u00a0\u202f]/g, '');
  }
  if (value.includes('.') && value.includes(',')) {
    if (/^[1-9]\d{0,2}(?:\.\d{3})+,\d+$/.test(value)) value = value.replace(/\./g, '').replace(',', '.');
    else if (/^[1-9]\d{0,2}(?:,\d{3})+\.\d+$/.test(value)) value = value.replace(/,/g, '');
    else invalid();
  } else if (/^[1-9]\d{0,2}(?:\.\d{3})+$/.test(value)) {
    value = value.replace(/\./g, ''); // Vietnamese Excel: 15.000 means fifteen thousand, including rates/quantities.
  } else if ((column[2] ? /^[1-9]\d{0,2}(?:,\d{3}){2,}$/ : /^[1-9]\d{0,2}(?:,\d{3})+$/).test(value)) {
    value = value.replace(/,/g, ''); // Unambiguous multi-group English integer (4,758,000).
  } else if (/^\d+(?:[.,]\d+)?$/.test(value)) value = value.replace(',', '.');
  else invalid();
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) invalid();
  return n;
}
export function createPayrollQuickEntry({ root, api, esc, money, toast, onSaved, confirmBox, userId = () => null }) {
  const draftsByMonth = new Map(); let drafts = new Map(), data, mode = 'sheet', saving = false, loading = false, owner;
  const dirty = () => { if (owner !== userId()) { draftsByMonth.clear(); drafts = new Map(); owner = userId(); } return drafts.size > 0; };
  const labels = { sheet: 'Bảng tổng thể như Excel', inputs: 'Chấm công & chỉ số', profile: 'Lương & phụ cấp cố định', adjustments: 'Thưởng, phạt & tạm ứng' };
  function html(d) {
    const money = value => formatQuickMoney(value) + ' đ';
    if (owner !== userId()) { draftsByMonth.clear(); drafts = new Map(); owner = userId(); }
    data = d;
    drafts = draftsByMonth.get(d.month) || new Map();
    draftsByMonth.set(d.month, drafts);
    const cols = QUICK_COLUMNS[mode] || [];
    const field = (r,c,section=mode,scale=1) => {
      const saved = r.entry[section]?.[c[0]], value = drafts.get(r.member.id)?.[section]?.[c[0]];
      const raw = value === undefined ? saved : value;
      const v = c[2]==='text'?raw:raw == null ? raw : +Number(raw * scale).toFixed(6);
      if(c[2]==='text') return `<td class="pr-sheet-position"><input class="pr-quick-value" data-member="${esc(r.member.id)}" data-key="positionLabel" data-section="profile" maxlength="60" placeholder="${esc(r.member.positionId||'Vị trí')}" list="pr-positions" aria-label="${esc(r.member.name+' — Vị trí')}" value="${esc(v||'')}" ${r.payslip.status!=='estimate'||saving||loading?'disabled':''}></td>`;
      if (c[2] === 'boolean') return `<td><label><input type="checkbox" class="pr-quick-value" data-member="${esc(r.member.id)}" data-key="${c[0]}" data-section="${section}" data-scale="${scale}" aria-label="${esc(r.member.name+' — '+c[1])}" ${v?'checked':''} ${r.payslip.status!=='estimate'||saving||loading?'disabled':''}>Có</label></td>`;
      const extra = section === 'adjustments' && r.entry.existingAdjustments[c[0]];
      return `<td><input class="pr-quick-value" inputmode="decimal" data-money="${!c[2]}" data-member="${esc(r.member.id)}" data-key="${c[0]}" data-section="${section}" data-scale="${scale}" aria-label="${esc(r.member.name+' — '+c[1])}" value="${esc(v == null ? '' : !c[2]?formatQuickMoney(v):String(v).replace('.', ','))}" placeholder="${c[3]?'Tự động':'0'}" ${r.payslip.status!=='estimate'||saving||loading?'disabled':''}>${extra?`<small class="muted">Đã ghi riêng: ${money(extra)}</small>`:''}</td>`;
    };
    return `<section id="pr-quick" data-payroll-month="${esc(d.month)}"><datalist id="pr-positions"><option value="THỬ VIỆC">Chỉ LCB theo công</option></datalist><div class="pr-quick-tools"><div><h3>Nhập nhanh bảng lương toàn công ty</h3><p class="muted small">Nhập trực tiếp, dùng Tab/Enter hoặc dán một vùng từ Excel. Ô trống “Tự động” lấy từ hệ thống; số 0 là nhập tay bằng 0. Thực nhận cập nhật sau khi lưu.</p></div>
      <button type="button" class="btn secondary" data-quick-template>Tải file mẫu</button><button type="button" class="btn secondary" data-quick-import>Nhập file Excel</button><input type="file" data-quick-file accept=".xlsx" hidden><button type="button" class="btn secondary" data-quick-discard>Tải lại / Bỏ thay đổi</button><button type="button" class="btn primary" data-quick-save ${saving||loading?'disabled':''}>Lưu thay đổi <span data-quick-count>${drafts.size?'('+drafts.size+' người)':''}</span></button></div>
      <div class="pr-quick-tools"><label>Tìm nhân viên <input data-quick-search type="search" placeholder="Tên nhân viên…"></label>
      <label>Bảng lương <select data-quick-group><option value="">Tất cả</option>${Object.entries(d.columns.groups).map(([k,v])=>`<option value="${esc(k)}">${esc(v)}</option>`).join('')}</select></label>
      <label>Nhập số liệu <select data-quick-mode>${Object.entries(labels).map(([k,v])=>`<option value="${k}" ${mode===k?'selected':''}>${v}</option>`).join('')}</select></label></div>
      ${mode==='sheet'?'<p class="muted small">Nhóm màu theo mẫu Excel. Ô số cho phép nhập; ô nền tổng là kết quả sau lưu. KPI CV nhập theo % (115,72 = 115,72%). Các khoản bổ sung cộng với khoản đã ghi riêng; Hệ số cũ lấy từ hồ sơ gần nhất trước tháng này.</p>':''}
      ${mode==='adjustments'?'<p class="muted small">Các ô này là khoản nhập nhanh bổ sung. Khoản đã ghi riêng và lý do được giữ nguyên; tổng khấu trừ/thu nhập bao gồm cả hai.</p>':''}
      ${mode==='profile'?'<p class="muted small">Cài đặt áp dụng từ tháng đang chọn. Trách nhiệm tuỳ cách tính đã thiết lập (cố định / theo công / mỗi ngày). Nhấn tên nhân viên để xem và sửa cấu hình đầy đủ.</p>':''}
      <p data-quick-status role="status" aria-live="polite"></p>
      ${mode==='sheet'?payrollSheetHtml({data:d,esc,money,field:(r,col)=>{const c=[...QUICK_COLUMNS[col.section].find(c=>c[0]===col.key)];c[1]=col.bonus?'Thưởng khác (bổ sung)':col.label;return field(r,c,col.section,col.scale||1);},isDirty:id=>drafts.has(id)}):`      <div class="pr-quick-scroll" tabindex="0" aria-label="Bảng nhập lương, cuộn ngang để xem các cột"><table class="data-table pr-quick-table"><thead><tr><th>Nhân viên</th><th>Bảng / Trạng thái</th>${cols.map(c=>`<th>${c[1]}</th>`).join('')}<th>Tổng thu nhập</th><th>Khấu trừ</th><th>Thực nhận</th><th>Chi tiết</th></tr></thead><tbody>
      ${d.rows.map(r=>`<tr class="${drafts.has(r.member.id)?'pr-quick-dirty':''}" data-quick-row="${esc(r.member.id)}" data-group="${esc(r.profile.payrollGroup)}" data-name="${esc(r.member.name.toLocaleLowerCase('vi'))}"><td class="pr-quick-name"><a href="#/members/${encodeURIComponent(r.member.id)}?month=${d.month}&tab=payroll">${esc(r.member.name)}</a><small>${esc(r.profile.positionLabel||r.member.positionId||'')}${r.member.active?'':' · Đã nghỉ'}</small></td><td>${esc(d.columns.groups[r.profile.payrollGroup])}<small>${r.payslip.status==='estimate'?(r.profile.hasProfile?'Tạm tính':'Chưa có hồ sơ lương'):r.payslip.status==='paid'?'Đã trả · Khóa sửa':'Đã chốt · Khóa sửa'}</small></td>${cols.map(c=>field(r,c)).join('')}<td class="num">${money(r.payslip.gross)}</td><td class="num">${money(r.payslip.deductionTotal)}</td><td class="num strong">${money(r.payslip.net)}</td><td><details><summary>Các khoản lương</summary>${[...r.payslip.income,...r.payslip.deductions].map(l=>`<p>${esc(d.columns.labels[l.key]||l.key)}: <b>${money(l.amount)}</b></p>`).join('')}</details></td></tr>`).join('')}
      </tbody></table></div>`}<p class="muted small">${d.rows.length} nhân viên · Ô nền vàng cho phép nhập · Phiếu đã chốt/đã trả chỉ xem. Nhân viên chưa có hồ sơ: nhập LCB trong mục “Lương & phụ cấp cố định” rồi lưu để tạo hồ sơ.</p></section>`;
  }
  function capture(input) {
    const section=input.dataset.section, r = data.rows.find(r=>r.member.id===input.dataset.member), c = QUICK_COLUMNS[section].find(c=>c[0]===input.dataset.key);
    if (loading || saving || input.disabled || input.closest('#pr-quick')?.dataset.payrollMonth !== data.month) return;
    const parsed = parseQuickNumber(input.type==='checkbox'?input.checked:input.value,c);
    const value = parsed==null||typeof parsed==='boolean'||typeof parsed==='string'?parsed:Number(input.dataset.scale)===100?Number((parsed/100).toFixed(12)):parsed;
    let draft = drafts.get(r.member.id);
    if (!draft) draft = { memberId:r.member.id, version:r.entry.version, month:data.month };
    draft[section] ||= {};
    if (value === r.entry[section][c[0]]) delete draft[section][c[0]];
    else draft[section][c[0]] = value;
    if (['inputs','profile','adjustments'].every(k=>!Object.keys(draft[k]||{}).length)) drafts.delete(r.member.id);
    else drafts.set(r.member.id,draft);
    root.querySelector('[data-quick-count]').textContent = drafts.size?`(${drafts.size} người)`:'';
    input.removeAttribute('aria-invalid'); input.closest('tr').classList.toggle('pr-quick-dirty',drafts.has(r.member.id));
  }
  function filter() {
    const q = root.querySelector('[data-quick-search]').value.toLocaleLowerCase('vi'), group = root.querySelector('[data-quick-group]').value;
    root.querySelectorAll('[data-quick-row]').forEach(tr=>{tr.hidden=!tr.dataset.name.includes(q)||!!group&&tr.dataset.group!==group;});
  }
  root.addEventListener('focusout',e=>{if(e.target.matches('[data-money="true"]')&&e.target.value&&!e.target.hasAttribute('aria-invalid')){try{const c=QUICK_COLUMNS[e.target.dataset.section].find(c=>c[0]===e.target.dataset.key);e.target.value=formatQuickMoney(parseQuickNumber(e.target.value,c));}catch{}}});
  root.addEventListener('input',e=>{
    if(loading||saving)return;
    if(e.target.matches('[data-quick-search]')) filter();
    if(!e.target.matches('.pr-quick-value')) return;
    try { capture(e.target); root.querySelector('[data-quick-status]').textContent='Có thay đổi chưa lưu.'; }
    catch(error){e.target.setAttribute('aria-invalid','true');root.querySelector('[data-quick-status]').textContent=error.message;}
  });
  root.addEventListener('change',e=>{
    if(loading||saving)return;
    if(e.target.matches('[data-quick-group]')) filter();
    if(e.target.matches('[data-quick-file]')) importFile(e.target);
    if(e.target.matches('[data-quick-mode]')) {if(saving||root.querySelector('[aria-invalid="true"]')) {e.target.value=mode;toast('Sửa ô không hợp lệ trước khi đổi mục nhập.','err');return;} mode=e.target.value;root.querySelector('#pr-quick').outerHTML=html(data);}
  });
  root.addEventListener('keydown',e=>{
    if(loading||saving)return;
    if(e.key!=='Enter'||!e.target.matches('.pr-quick-value'))return;
    e.preventDefault();const inputs=[...root.querySelectorAll(`.pr-quick-value[data-key="${e.target.dataset.key}"]:not(:disabled)`)].filter(n=>!n.closest('tr').hidden);
    inputs[inputs.indexOf(e.target)+1]?.focus();
  });
  root.addEventListener('paste',e=>{
    if(loading||saving||e.target.disabled)return;
    if(!e.target.matches('.pr-quick-value'))return;
    const text=e.clipboardData.getData('text');if(!/[\t\r\n]/.test(text))return;
    e.preventDefault();
    const rows=[...root.querySelectorAll('[data-quick-row]')].filter(tr=>!tr.hidden&&!tr.querySelector('input').disabled);
    const start=rows.indexOf(e.target.closest('tr')), column=e.target.closest('td').cellIndex;
    const cells=text.replace(/\r?\n$/, '').split(/\r?\n/).flatMap((line,i)=>line.split('\t').map((v,j)=>{
      const input=rows[start+i]?.children[column+j]?.querySelector('input');
      return {input,value:v,column:input?QUICK_COLUMNS[input.dataset.section]?.find(c=>c[0]===input.dataset.key):null};
    }));
    try {
      if(cells.some(c=>!c.input||!c.column))throw new Error('Vùng dán vượt bảng hoặc chứa cột tự tính. Chỉ dán vào các ô nhập liền nhau.');
      cells.forEach(c=>parseQuickNumber(c.value,c.column)); // validate the whole rectangle before changing any cell
      cells.forEach(c=>{if(c.input.type==='checkbox')c.input.checked=parseQuickNumber(c.value,c.column);else c.input.value=c.value;capture(c.input);});
      root.querySelector('[data-quick-status]').textContent='Đã dán dữ liệu, bấm Lưu thay đổi để cập nhật.';
    }catch(error){toast(error.message,'err');}
  });
  async function importFile(input){
    const file=input.files?.[0];input.value='';if(!file||loading||saving)return;
    if(dirty()){toast('Lưu hoặc bỏ thay đổi hiện tại trước khi nhập file.','err');return;}
    const original=data,identity=userId();
    try{const rows=await readPayrollFile(file);
      if(data!==original||loading||saving||identity!==userId()||dirty())throw Error('Bảng đã thay đổi trong lúc đọc file. Vui lòng nhập lại.');
      const changes=parsePayrollFile(rows,data,QUICK_COLUMNS,parseQuickNumber);
      for(const draft of changes)drafts.set(draft.memberId,draft);
      root.querySelector('#pr-quick').outerHTML=html(data);toast(`Đã nhập ${changes.length} nhân viên. Kiểm tra rồi bấm Lưu thay đổi.`);
    }catch(error){toast(error.message,'err');}
  }
  root.addEventListener('click',async e=>{
    if(loading||saving)return;
    if(e.target.closest('[data-quick-template]')){try{await downloadPayrollTemplate(data,QUICK_COLUMNS);}catch(error){toast(error.message,'err');}return;}
    if(e.target.closest('[data-quick-import]')){root.querySelector('[data-quick-file]').click();return;}
    if(e.target.closest('[data-quick-discard]')) {
      if(saving)return;
      if(dirty()&&!await confirmBox('Bỏ các ô chưa lưu và tải lại bảng lương mới nhất?',{ok:'Bỏ thay đổi'}))return;
      drafts.clear();await onSaved(data.month);return;
    }
    const button=e.target.closest('[data-quick-save]');if(!button||saving)return;
    if(root.querySelector('[aria-invalid="true"]')){toast('Sửa các ô không hợp lệ trước khi lưu.','err');return;}
    if(!dirty()){toast('Chưa có thay đổi.');return;}
    if([...drafts.values()].some(d=>d.month!==data.month)){toast('Dữ liệu nhập thuộc tháng khác. Tải lại bảng lương.','err');return;}
    const month=data.month; saving=true;button.disabled=true;
    root.querySelectorAll('.pr-quick-value').forEach(n=>{n.disabled=true;});
    try {
      const rows=[...drafts.values()].map(d=>Object.fromEntries(Object.entries(d).filter(([k,v])=>!['inputs','profile','adjustments'].includes(k)||Object.keys(v).length)));
      await api(`/hr/payroll/${month}/entries`,'PUT',{rows});drafts.clear();saving=false;toast('Đã lưu bảng lương.');await onSaved(month);
    }catch(error){toast(error.message,'err');root.querySelector('[data-quick-status]').textContent=error.message+' Dữ liệu bạn nhập vẫn được giữ để đối chiếu.';}
    finally{saving=false;root.querySelectorAll('.pr-quick-value').forEach(n=>{const r=data.rows.find(r=>r.member.id===n.dataset.member);n.disabled=r.payslip.status!=='estimate';});const b=root.querySelector('[data-quick-save]');if(b)b.disabled=false;}
  });
  window.addEventListener('beforeunload',e=>{if([...draftsByMonth.values()].some(d=>d.size)){e.preventDefault();e.returnValue='';}});
  function setLoading(value) {
    loading=value;
    root.querySelectorAll('#pr-quick input, #pr-quick select, #pr-quick button').forEach(n=>{
      n.disabled = loading || saving || (n.matches('.pr-quick-value') && data.rows.find(r=>r.member.id===n.dataset.member)?.payslip.status!=='estimate');
    });
  }
  return { html, dirty, setLoading, isSaving:()=>saving, clear:()=>drafts.clear() };
}

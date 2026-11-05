// A single grouped spreadsheet, matching the company's payroll reference layout.
export const PAYROLL_SHEET_GROUPS = [
  { label:'NĂNG LỰC', tone:'capacity', columns:[{label:'Hệ số cũ',read:'previousCapacityCoef'}, {label:'Hệ số mới',section:'profile',key:'capacityCoef'}, {label:'Tiền năng lực / thâm niên',line:'capacity'}] },
  { label:'KPIs', tone:'kpi', columns:[{label:'Trách nhiệm',section:'profile',key:'responsibility'}, {label:'KPI CV (%)',section:'inputs',key:'kpiOverride',scale:100}, {label:'DS tháng',section:'inputs',key:'revenue'}, {label:'Thưởng',section:'adjustments',key:'bonus',bonus:true}] },
  { label:'PHỤ CẤP', tone:'allowance', columns:[{label:'Cơm + xăng',line:'meal'}, {label:'Điện thoại',section:'profile',key:'phoneAllowance'}, {label:'Công tác',section:'adjustments',key:'allowance'}, {label:'Giờ tăng ca',section:'inputs',key:'overtimeHours'}, {label:'Tiền tăng ca',line:'overtime'}] },
  { label:'CÁC KHOẢN TRỪ', tone:'deduction', columns:[{label:'BHXH',section:'profile',key:'insurance'}, {label:'BHYT',section:'inputs',key:'healthInsurance'}, {label:'TNCN',section:'inputs',key:'incomeTax'}, {label:'Vi phạm',section:'adjustments',key:'deduction'}, {label:'Tạm ứng điện thoại',section:'adjustments',key:'phone_advance'}, {label:'Tạm ứng',section:'adjustments',key:'advance'}] },
];
const info = [{label:'LCB / lương thỏa thuận',section:'profile',key:'baseSalary'}, {label:'Ngày làm việc',section:'inputs',key:'workDays'}, {label:'Lương theo công',line:'salaryByDays'}];
const gross = {label:'TỔNG THU NHẬP',total:'gross',tone:'gross'}, net = {label:'THỰC NHẬN',total:'net',tone:'net'}, bank = {label:'TK NHẬN LƯƠNG',bank:true}, detail = {label:'Chi tiết',detail:true};
export const PAYROLL_SHEET_COLUMNS = [...info, ...PAYROLL_SHEET_GROUPS.slice(0,3).flatMap(g=>g.columns), gross, ...PAYROLL_SHEET_GROUPS[3].columns, net, bank, detail];
export function payrollSheetHtml({data,esc,money,field,isDirty}) {
  const line=(r,key)=>[...r.payslip.income,...r.payslip.deductions].find(l=>l.key===key)?.amount??0;
  const bonus=r=>r.payslip.income.filter(l=>/Bonus|Adjustment/.test(l.key)).reduce((s,l)=>s+l.amount,0);
  const solo=(label,cls='')=>`<th rowspan="2" scope="col" class="${cls}">${label}</th>`;
  const group=g=>`<th colspan="${g.columns.length}" scope="colgroup" class="pr-sheet-${g.tone}">${g.label}</th>`;
  const rows=data.rows.map((r,i)=>{
    const status=r.payslip.status==='paid'?'Đã trả · Khóa sửa':r.payslip.status==='confirmed'?'Đã chốt · Khóa sửa':r.profile.hasProfile?'Tạm tính':'Chưa có hồ sơ';
    const bank=r.payslip.bank||{code:r.profile.bankCode,account:r.profile.bankAccount,holder:r.profile.bankHolder};
    const cells=PAYROLL_SHEET_COLUMNS.map(c=>{
      if(c.section){
        let cell=field(r,c);
        if(c.bonus)cell=cell.replace('</td>',`<small>Tổng thưởng đã tính: ${money(bonus(r))}</small></td>`);
        if(c.key==='kpiOverride')cell=cell.replace('</td>',`<small>Tự tính: ${r.payslip.kpi?.used==null?'—':new Intl.NumberFormat('vi-VN',{style:'percent',maximumFractionDigits:2}).format(r.payslip.kpi.used)}</small></td>`);
        return cell;
      }
      if(c.bank) return `<td class="pr-sheet-bank">${bank.account?`<b>${esc(bank.account)}</b><small>${esc((bank.code||'').toUpperCase())}</small>${r.qr?`<a href="${esc(r.qr)}" target="_blank" rel="noopener noreferrer" aria-label="Mở VietQR ${esc(r.member.name)}"><img src="${esc(r.qr)}" loading="lazy" width="86" height="86" alt="VietQR nhận lương"></a>`:''}`:'<span class="muted">Chưa có tài khoản</span>'}</td>`;
      if(c.detail) return `<td><details><summary>Các khoản</summary>${[...r.payslip.income,...r.payslip.deductions].map(l=>`<p>${esc(data.columns.labels[l.key]||l.key)}: <b>${money(l.amount)}</b></p>`).join('')}</details></td>`;
      const v=c.read?r[c.read]:c.total?r.payslip[c.total]:line(r,c.line);
      return `<td class="num ${c.tone?'pr-sheet-'+c.tone:''}">${v==null?'—':c.read?esc(v):money(v)}</td>`;
    }).join('');
    return `<tr class="${isDirty(r.member.id)?'pr-quick-dirty':''}" data-quick-row="${esc(r.member.id)}" data-group="${esc(r.profile.payrollGroup)}" data-name="${esc(r.member.name.toLocaleLowerCase('vi'))}"><td class="pr-sheet-index">${i+1}</td><td class="pr-quick-name"><a href="#/members/${encodeURIComponent(r.member.id)}?month=${data.month}&tab=payroll">${esc(r.member.name)}</a><small>${esc(data.columns.groups[r.profile.payrollGroup])} · ${status}</small></td><td class="pr-sheet-position">${esc(r.profile.positionLabel||r.member.positionId||'—')}</td>${cells}</tr>`;
  }).join('');
  const counted=data.rows.filter(r=>r.profile.hasProfile||r.payslip.status!=='estimate');
  const mapped={insurance:'socialInsurance',healthInsurance:'healthInsurance',incomeTax:'incomeTax',deduction:'violation',phone_advance:'phoneDeduction',advance:'advance',allowance:'trip',phoneAllowance:'phone',responsibility:'responsibility',bonus:'otherBonus'};
  const footer=PAYROLL_SHEET_COLUMNS.map(c=>{const key=c.line||mapped[c.key];return `<td class="num ${c.tone?'pr-sheet-'+c.tone:''}">${c.total||key?money(counted.reduce((s,r)=>s+(c.total?r.payslip[c.total]:line(r,key)),0)):'—'}</td>`;}).join('');
  return `<div class="pr-quick-scroll pr-sheet-scroll" tabindex="0" aria-label="Bảng lương tổng thể, cuộn ngang để xem các nhóm"><table class="data-table pr-quick-table pr-sheet"><colgroup><col style="width:44px"><col style="width:220px"><col style="width:100px">${PAYROLL_SHEET_COLUMNS.map(c=>`<col style="width:${c.bank?140:c.detail?90:114}px">`).join('')}</colgroup><thead><tr>${solo('STT','pr-sheet-index')}${solo('HỌ TÊN','pr-sheet-name')}${solo('VỊ TRÍ')}${info.map(c=>solo(c.label,'pr-sheet-base')).join('')}${PAYROLL_SHEET_GROUPS.slice(0,3).map(group).join('')}${solo(gross.label,'pr-sheet-gross')}${group(PAYROLL_SHEET_GROUPS[3])}${solo(net.label,'pr-sheet-net')}${solo(bank.label)}${solo('Chi tiết')}</tr><tr class="pr-sheet-subhead">${PAYROLL_SHEET_GROUPS.flatMap(g=>g.columns.map(c=>`<th scope="col" class="pr-sheet-${g.tone}">${c.label}</th>`)).join('')}</tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="3">TỔNG TOÀN BẢNG (${counted.length} người đã có hồ sơ / phiếu chốt)</td>${footer}</tr></tfoot></table></div>`;
}

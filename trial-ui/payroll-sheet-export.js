import {PAYROLL_SHEET_COLUMNS as columns, PAYROLL_SHEET_GROUPS as groups, payrollSheetTotals} from './payroll-sheet.js';
import {loadPayrollExcel} from './payroll-file.js';

const colors={base:'B9B6B5',capacity:'F7CFB5',gross:'F7CFB5',kpi:'CBE1B4',net:'CBE1B4',allowance:'B9CAE6',deduction:'ADBACA'};
const line=(r,key)=>[...r.payslip.income,...r.payslip.deductions].find(l=>l.key===key)?.amount??0;
const status=r=>r.payslip.status==='paid'?'Đã trả · Khóa sửa':r.payslip.status==='confirmed'?'Đã chốt · Khóa sửa':r.profile.hasProfile?'Tạm tính':'Chưa có hồ sơ';

/** Read only: use the same saved inputs, server results and footer as the web table. */
export async function buildPayrollSheet(data) {
  if(data.rows.some(r=>r.payslip.snapshotUnavailable))throw new Error('Có phiếu cũ thiếu bản chụp chi tiết. Đối soát trước khi xuất Excel.');
  const ExcelJS=await loadPayrollExcel(),wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Bảng lương'),n=columns.length+3;
  ws.mergeCells(1,1,1,n);ws.getCell(1,1).value=`BẢNG LƯƠNG THÁNG ${Number(data.month.slice(5))}/${data.month.slice(0,4)}`;
  ws.getCell(1,1).font={bold:true,size:16,color:{argb:'FF102A56'}};ws.getRow(1).height=30;
  ws.mergeCells(2,1,2,n);ws.getCell(2,1).value='Số liệu đã lưu · Ô “Tự động” lấy từ CRM · Ghi chú ô chứa chi tiết các khoản';
  const header=(col,label,tone)=>{
    const cell=ws.getCell(3,col);cell.value=label;
    cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+(colors[tone]||'EDF1F7')}};
    cell.font={bold:true};cell.alignment={wrapText:true,horizontal:'center',vertical:'middle'};
  };
  ['STT','HỌ TÊN','VỊ TRÍ'].forEach((label,i)=>{ws.mergeCells(3,i+1,4,i+1);header(i+1,label);});
  columns.forEach((c,i)=>{
    const col=i+4,g=groups.find(g=>g.columns.includes(c));
    if(g){
      if(g.columns[0]===c){ws.mergeCells(3,col,3,col+g.columns.length-1);header(col,g.label,g.tone);}
      const cell=ws.getCell(4,col);cell.value=c.label;cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+colors[g.tone]}};
      cell.font={bold:true};cell.alignment={wrapText:true,horizontal:'center',vertical:'middle'};
    }else{ws.mergeCells(3,col,4,col);header(col,c.label,c.tone||(i<3?'base':null));}
  });
  ws.getRow(3).height=32;ws.getRow(4).height=48;
  data.rows.forEach((r,i)=>{
    const row=ws.getRow(i+5);row.height=42;
    row.getCell(1).value=i+1;
    row.getCell(2).value=r.member.name;
    row.getCell(2).note=`${data.columns.groups[r.profile.payrollGroup]||''} · ${status(r)}`;
    row.getCell(3).value=r.entry.profile?.positionLabel||r.member.positionId||'';
    columns.forEach((c,j)=>{
      const cell=row.getCell(j+4);let value,notes=[];
      if(c.section){
        value=r.entry[c.section]?.[c.key];
        if(c.key==='revenue'&&r.payslip.kpi?.policy==='appsheet'&&r.payslip.kpi.basis){value=r.payslip.kpi.basis.revenue;notes.push('Tự động từ CRM · chưa VAT − hoa hồng');}
        if(value!=null)value=+Number(value*(c.scale||1)).toFixed(6);
        else value=['workDays','kpiOverride','revenue'].includes(c.key)?'Tự động':null;
        const extra=r.entry.existingAdjustments?.[c.key];
        if(c.section==='adjustments'&&extra)notes.push(`Đã ghi riêng: ${extra}`);
        if(c.bonus)notes.push(`Tổng thưởng đã tính: ${r.payslip.income.filter(l=>/Bonus|Adjustment/.test(l.key)).reduce((s,l)=>s+l.amount,0)}`);
        if(c.key==='kpiOverride')notes.push(`Tự tính: ${r.payslip.kpi?.used==null?'—':+(r.payslip.kpi.used*100).toFixed(6)+'%'}`);
      }else if(c.bank){
        const bank=r.payslip.bank||{code:r.profile.bankCode,account:r.profile.bankAccount,holder:r.profile.bankHolder};
        value=bank.account?`${bank.account}\n${(bank.code||'').toUpperCase()}`:'Chưa có tài khoản';
        if(bank.holder)notes.push(bank.holder);
      }else if(c.detail){value='Các khoản';notes.push(...[...r.payslip.income,...r.payslip.deductions].map(l=>`${data.columns.labels[l.key]||l.key}: ${l.amount}`));}
      else value=c.read?r[c.read]??'—':c.total?r.payslip[c.total]:line(r,c.line);
      cell.value=value;
      if(notes.length)cell.note=notes.join('\n');
    });
  });
  const totals=payrollSheetTotals(data),footer=ws.addRow(['',`TỔNG TOÀN BẢNG (${totals.people} người đã có hồ sơ / phiếu chốt)`,'',...totals.values.map(v=>v??'—')]);
  ws.mergeCells(footer.number,1,footer.number,3);footer.getCell(1).value=`TỔNG TOÀN BẢNG (${totals.people} người đã có hồ sơ / phiếu chốt)`;
  footer.font={bold:true};footer.height=44;
  ws.columns.forEach((col,i)=>{col.width=i===0?6:i===1?28:i===2?16:columns[i-3]?.bank?25:18;});
  ws.eachRow((row,i)=>{if(i<3)return;row.eachCell({includeEmpty:true},(cell,j)=>{
    cell.border={top:{style:'thin',color:{argb:'FFD5DBE5'}},bottom:{style:'thin',color:{argb:'FFD5DBE5'}},left:{style:'thin',color:{argb:'FFD5DBE5'}},right:{style:'thin',color:{argb:'FFD5DBE5'}}};
    if(i>=5){cell.alignment={wrapText:true,vertical:'middle',horizontal:j<=3?'left':'right'};cell.numFmt='#,##0.######';
      const tone=columns[j-4]?.tone;if(tone)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+colors[tone]}};}
  });});
  ws.views=[{state:'frozen',xSplit:3,ySplit:4}];
  ws.pageSetup={orientation:'landscape',paperSize:8,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'3:4'};
  return wb;
}

export async function downloadPayrollSheet(data) {
  const wb=await buildPayrollSheet(data),buffer=await wb.xlsx.writeBuffer();
  const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const a=document.createElement('a');a.href=url;a.download=`Bang-luong-T${Number(data.month.slice(5))}-${data.month.slice(0,4)}.xlsx`;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}

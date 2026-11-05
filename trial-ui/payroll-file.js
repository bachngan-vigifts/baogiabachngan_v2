// Import creates drafts only; the existing month/version guarded API performs the save.
export const payrollFileColumns = columns => Object.entries(columns).flatMap(([section,cols])=>cols.map(c=>({section,column:c,header:c[0]==='kpiOverride'?'KPI chốt (%)':c[1]})));
export function payrollFileRows(data, columns) {
 const fields=payrollFileColumns(columns);
 return [['Tháng','Mã nhân viên','Họ tên',...fields.map(f=>f.header)],...data.rows.filter(r=>r.payslip.status==='estimate').map(r=>[data.month,r.member.id,r.member.name,...fields.map(()=>null)])];
}
export function parsePayrollFile(rows,data,columns,parse) {
 const fields=payrollFileColumns(columns),headers=['Tháng','Mã nhân viên','Họ tên',...fields.map(f=>f.header)];
 if(!rows.length||headers.some((h,i)=>rows[0][i]!==h)||rows[0].length!==headers.length)throw Error('Sai cấu trúc file. Hãy tải file mẫu mới.');
 const seen=new Set(),changes=[];
 for(let i=1;i<rows.length;i++){
  const cells=rows[i]; if(cells.every(v=>v==null||v===''))continue;
  const fail=message=>{throw Error(`Dòng ${i+1}: ${message}`);};
  if(cells[0]!==data.month)fail('Tháng trong file khác tháng đang xem.');
  const row=data.rows.find(r=>r.member.id===cells[1]);if(!row)fail('Không tìm thấy mã nhân viên.');
  if(seen.has(row.member.id))fail('Trùng nhân viên.');seen.add(row.member.id);
  if(row.payslip.status!=='estimate')fail('Phiếu lương đã khóa.');
  const draft={memberId:row.member.id,month:data.month,version:row.entry.version};
  fields.forEach((f,j)=>{const raw=cells[j+3];if(raw==null||raw==='')return;
   if(!['string','number','boolean'].includes(typeof raw))fail('Chỉ nhập giá trị, không nhập công thức.');
   let value;
   try{value=String(raw).trim().toLocaleUpperCase('vi')==='TỰ ĐỘNG'&&f.column[3]?null:parse(raw,f.column);}catch(e){fail(`${f.column[1]}: ${e.message}`);}
   // File uses the same units as the displayed sheet: KPI is a percentage.
   if(f.column[0]==='kpiOverride'&&value!==null)value=Number((value/100).toFixed(12));
   if(value!==row.entry[f.section][f.column[0]]){draft[f.section]||={};draft[f.section][f.column[0]]=value;}
  });
  if(['profile','inputs','adjustments'].some(k=>draft[k]))changes.push(draft);
 }
 return changes;
}
let ready;
export function loadPayrollExcel(){
 if(globalThis.ExcelJS)return Promise.resolve(globalThis.ExcelJS);
 return ready ||= new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='exceljs.min.js';s.onload=()=>resolve(globalThis.ExcelJS);s.onerror=()=>{ready=null;reject(Error('Không tải được công cụ Excel.'));};document.head.append(s);});
}
export async function downloadPayrollTemplate(data,columns){
 const ExcelJS=await loadPayrollExcel(),wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Nhập lương');
 payrollFileRows(data,columns).forEach(row=>ws.addRow(row));ws.views=[{state:'frozen',ySplit:1,xSplit:3}];
 ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF102A56'}};
 ws.columns.forEach((c,i)=>{c.width=i===2?30:24;c.numFmt=i>2?'#,##0.######':'@';});
 const help=wb.addWorksheet('Hướng dẫn');[
  'Giữ nguyên tiêu đề, tháng và mã nhân viên. Ô trống: giữ dữ liệu hiện tại; 0: ghi bằng 0.',
  'Nhập Tự động ở ô ngày công / doanh số / thưởng quý / KPI để lấy từ hệ thống.',
  'KPI chốt nhập theo %: 115,72 nghĩa là 115,72%. Tiền là số, không nhập công thức.',
  'Vị trí THỬ VIỆC hoặc TV: chỉ LCB theo ngày công, không phụ cấp, thưởng hoặc khoản trừ.',
  'Sau nhập file, kiểm tra bảng và bấm Lưu thay đổi. Không đổi tháng trong lúc nhập file.',
 ].forEach(t=>help.addRow([t]));help.getColumn(1).width=120;
 const url=URL.createObjectURL(new Blob([await wb.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 const a=document.createElement('a');a.href=url;a.download=`Mau-bang-luong-${data.month}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function readPayrollFile(file){
 if(file.size>5*1024*1024)throw Error('File tối đa 5 MB.');
 if(!/\.xlsx$/i.test(file.name))throw Error('Chọn file Excel .xlsx theo mẫu.');
 const ExcelJS=await loadPayrollExcel(),wb=new ExcelJS.Workbook();await wb.xlsx.load(await file.arrayBuffer());
 const ws=wb.getWorksheet('Nhập lương');if(!ws||ws.rowCount>1001)throw Error('Thiếu sheet Nhập lương hoặc vượt 1.000 dòng.');
 return Array.from({length:ws.rowCount},(_,i)=>Array.from({length:ws.columnCount},(_,j)=>ws.getCell(i+1,j+1).value));
}

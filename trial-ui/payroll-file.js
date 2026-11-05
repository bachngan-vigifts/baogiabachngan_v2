// Only these eleven columns are visible. Month and employee IDs travel in a hidden binding sheet.
export const PAYROLL_FILE_FIELDS = [
 {header:'Ngày Công',section:'inputs',column:['workDays','Ngày công',true,true],max:31},
 {header:'Nhân viên làm bể hàng, đền hàng',section:'adjustments',column:['deduction','Bể hàng, đền hàng'],max:1e10},
 {header:'Số giờ làm thêm',section:'inputs',column:['overtimeHours','Giờ làm thêm',true],max:400},
 {header:'Phiếu file sản xuất/phiếu giao hàng/phiếu làm hàng',section:'inputs',column:['outputQty','Số phiếu',true],max:1e13},
 {header:'Số lần đi trễ',section:'inputs',column:['lateCount','Số lần đi trễ',true],max:1000,integer:true},
 {header:'Điện Thoại Sale',section:'adjustments',column:['phone_advance','Điện thoại Sale'],max:1e10},
 {header:'Số giờ nghỉ trong ngày',section:'inputs',column:['leaveHours','Số giờ nghỉ trong ngày',true],max:744},
 {header:'Bảo hiểm xã hội',section:'profile',column:['insurance','BHXH'],max:1e10},
 {header:'Tạm ứng',section:'adjustments',column:['advance','Tạm ứng'],max:1e10},
];
export const payrollFileColumns = () => PAYROLL_FILE_FIELDS;
export const PAYROLL_FILE_HEADERS = ['STT','Họ và tên',...PAYROLL_FILE_FIELDS.map(f=>f.header)];
const normal = value => String(value??'').normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('vi');
export function payrollFileRows(data) {
 return [PAYROLL_FILE_HEADERS,...data.rows.map((r,i)=>[i+1,r.member.name,...PAYROLL_FILE_FIELDS.map(()=>null)])];
}
export function payrollFileMeta(data) {
 return {month:data.month,bindings:data.rows.map((r,i)=>({stt:i+1,memberId:r.member.id,name:r.member.name}))};
}
export function parsePayrollFile(file,data,_columns,parse) {
 const {rows,meta}=file;
 if(!meta||meta.month!==data.month)throw Error('Tháng trong file khác tháng đang xem hoặc file thiếu thông tin kỳ lương. Hãy tải file mẫu mới.');
 if(!Array.isArray(meta.bindings)||!rows?.length||rows[0].length!==11||PAYROLL_FILE_HEADERS.some((h,i)=>normal(rows[0][i])!==normal(h)))throw Error('Sai cấu trúc file. Hãy tải file mẫu mới.');
 const bindings=new Map();
 for(const binding of meta.bindings){if(!Number.isInteger(binding.stt)||bindings.has(binding.stt))throw Error('Thông tin STT trong file không hợp lệ.');bindings.set(binding.stt,binding);}
 const seen=new Set(),changes=[];
 for(let i=1;i<rows.length;i++){
  const cells=rows[i];if(cells.every(v=>v==null||v===''))continue;
  const fail=message=>{throw Error(`Dòng ${i+1}: ${message}`);};
  const binding=bindings.get(Number(cells[0]));
  if(!binding||normal(cells[1])!==normal(binding.name))fail('STT và họ tên không khớp file mẫu.');
  const row=data.rows.find(r=>r.member.id===binding.memberId);
  if(!row||normal(row.member.name)!==normal(binding.name))fail('Không tìm thấy nhân viên tương ứng. Tải lại file mẫu.');
  if(seen.has(row.member.id))fail('Trùng nhân viên.');seen.add(row.member.id);
  if(row.payslip.status!=='estimate'){
   if(cells.slice(2).some(value=>value!=null&&value!==''))fail('Phiếu lương đã khóa.');
   continue;
  }
  const draft={memberId:row.member.id,month:data.month,version:row.entry.version};
  PAYROLL_FILE_FIELDS.forEach((f,j)=>{const raw=cells[j+2];if(raw==null||raw==='')return;
   if(!['string','number'].includes(typeof raw))fail('Chỉ nhập giá trị, không nhập công thức.');
   let value;
   try{value=normal(raw)==='tự động'&&f.column[3]?null:parse(raw,f.column);}catch(e){fail(`${f.header}: ${e.message}`);}
   if(value!==null&&(value>f.max||f.integer&&!Number.isInteger(value)))fail(`${f.header}: số không hợp lệ.`);
   if(value!==row.entry[f.section][f.column[0]]){draft[f.section]||={};draft[f.section][f.column[0]]=value;}
  });
  if(['profile','inputs','adjustments'].some(k=>draft[k]))changes.push(draft);
 }
 if(changes.length>100)throw Error('Mỗi lần nhập tối đa 100 nhân viên có thay đổi.');
 return changes;
}
let ready;
export function loadPayrollExcel(){
 if(globalThis.ExcelJS)return Promise.resolve(globalThis.ExcelJS);
 return ready ||= new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='exceljs.min.js';s.onload=()=>resolve(globalThis.ExcelJS);s.onerror=()=>{ready=null;reject(Error('Không tải được công cụ Excel.'));};document.head.append(s);});
}
export async function buildPayrollTemplate(data){
 const ExcelJS=await loadPayrollExcel(),wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Nhập lương');
 payrollFileRows(data).forEach(row=>ws.addRow(row));ws.views=[{state:'frozen',ySplit:1,xSplit:2}];
 ws.getRow(1).height=90;ws.getRow(1).font={bold:true};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE7E6E6'}};
 ws.columns.forEach((c,i)=>{c.width=i===0?7:i===1?32:i===5?30:20;c.numFmt=i<2?'@':'#,##0.######';});
 ws.eachRow(row=>row.eachCell({includeEmpty:true},cell=>{cell.alignment={vertical:'middle',horizontal:cell.col===2?'left':'center',wrapText:true};cell.border=Object.fromEntries(['top','bottom','left','right'].map(k=>[k,{style:'thin'}]));}));
 data.rows.forEach((row,i)=>{if(row.payslip.status!=='estimate'){
  const line=ws.getRow(i+2);line.font={color:{argb:'FF64748B'}};
  line.eachCell({includeEmpty:true},cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1F5F9'}};});
 }});
 const meta=payrollFileMeta(data),hidden=wb.addWorksheet('_KyLuong',{state:'veryHidden'});
 hidden.addRow(['payroll-simple-v1',meta.month]);meta.bindings.forEach(b=>hidden.addRow([b.stt,b.memberId,b.name]));
 const help=wb.addWorksheet('Hướng dẫn');[
  `Tháng lương: ${data.month}. Bảng Nhập lương chỉ có 11 cột như mẫu. Giữ nguyên STT và họ tên; có thể sắp xếp lại cả hàng.`,
  'File gồm toàn bộ nhân viên trong bảng lương tháng đang xem, không phụ thuộc ô tìm kiếm hay bộ lọc nhóm. Dòng màu xám đã khóa: để trống số liệu, không sửa khi nhập lại.',
  'Ô trống: giữ dữ liệu hiện tại; 0: ghi bằng 0. Ngày công có thể nhập Tự động để lấy từ chấm công.',
  'Bể/đền hàng: nhập số tiền khấu trừ. Điện thoại Sale: nhập tạm ứng điện thoại. Số phiếu: nhập sản lượng để tính theo đơn giá đã cài.',
  'Số lần đi trễ và giờ nghỉ được lưu để đối chiếu, chưa tự quy đổi thành tiền hoặc trừ thêm ngày công.',
  'BHXH cập nhật mức khấu trừ từ tháng đang xem. Bể/đền hàng, điện thoại và tạm ứng là khoản nhập nhanh, cộng với khoản đã ghi riêng.',
  'Không nhập công thức. Sau nhập file, kiểm tra bảng và bấm Lưu thay đổi. Dùng file mẫu đúng tháng; không xóa sheet ẩn.',
 ].forEach(t=>help.addRow([t]));help.getColumn(1).width=120;
 return wb;
}
export async function downloadPayrollTemplate(data){
 const wb=await buildPayrollTemplate(data);
 const url=URL.createObjectURL(new Blob([await wb.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
 const a=document.createElement('a');a.href=url;a.download=`Mau-bang-luong-${data.month}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function readPayrollFile(file){
 if(file.size>5*1024*1024)throw Error('File tối đa 5 MB.');
 if(!/\.xlsx$/i.test(file.name))throw Error('Chọn file Excel .xlsx theo mẫu.');
 const ExcelJS=await loadPayrollExcel(),wb=new ExcelJS.Workbook();await wb.xlsx.load(await file.arrayBuffer());
 const ws=wb.getWorksheet('Nhập lương'),hidden=wb.getWorksheet('_KyLuong');
 if(!ws||ws.rowCount>1001||ws.columnCount!==11||!hidden||hidden.rowCount>1001||hidden.getCell(1,1).value!=='payroll-simple-v1')throw Error('Sai file mẫu hoặc vượt 1.000 dòng. Hãy tải file mẫu mới.');
 return {rows:Array.from({length:ws.rowCount},(_,i)=>Array.from({length:11},(_,j)=>ws.getCell(i+1,j+1).value)),
 meta:{month:hidden.getCell(1,2).value,bindings:Array.from({length:hidden.rowCount-1},(_,i)=>({stt:hidden.getCell(i+2,1).value,memberId:hidden.getCell(i+2,2).value,name:hidden.getCell(i+2,3).value}))}};
}

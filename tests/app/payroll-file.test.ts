import {test} from 'node:test';
import assert from 'node:assert/strict';
const {payrollFileRows,payrollFileMeta,parsePayrollFile,payrollFileColumns,PAYROLL_FILE_HEADERS}:any=await import(new URL('../../trial-ui/payroll-file.js',import.meta.url).href);
const {QUICK_COLUMNS,parseQuickNumber,formatQuickMoney}:any=await import(new URL('../../trial-ui/payroll-quick-entry.js',import.meta.url).href);
const employee=(id:string,name:string)=>({member:{id,name},payslip:{status:'estimate'},entry:{version:'v1-'+id,profile:{insurance:0},inputs:{workDays:null,overtimeHours:0,outputQty:0,lateCount:0,leaveHours:0},adjustments:{advance:0,deduction:0,phone_advance:0}}});
const board={month:'2026-11',rows:[employee('emp','Employee'),employee('second','Second Employee')]};
const index=(key:string)=>2+payrollFileColumns().findIndex((f:any)=>f.column[0]===key);
const template=()=>({rows:payrollFileRows(board),meta:payrollFileMeta(board)});
const parse=(file:any,b:any=board)=>parsePayrollFile(file,b,QUICK_COLUMNS,parseQuickNumber);
test('money format round trips comma groups without changing decimal days and rates',()=>{
 const money=QUICK_COLUMNS.profile[0];for(const n of [15000,4758000,1500.5,0.005,0])assert.equal(parseQuickNumber(formatQuickMoney(n),money),n);
 assert.equal(formatQuickMoney(4758000),'4,758,000');assert.equal(parseQuickNumber('24,5',QUICK_COLUMNS.inputs[0]),24.5);
});
test('template has only eleven requested columns; month and employee bindings stay outside the visible data',()=>{
 const file=template();assert.equal(file.rows[0].length,11);assert.equal(file.rows[1].length,11);
 assert.deepEqual(file.rows[0],['STT','Họ và tên','Ngày Công','Nhân viên làm bể hàng, đền hàng','Số giờ làm thêm','Phiếu file sản xuất/phiếu giao hàng/phiếu làm hàng','Số lần đi trễ','Điện Thoại Sale','Số giờ nghỉ trong ngày','Bảo hiểm xã hội','Tạm ứng']);
 assert.deepEqual(parse(file),[]);assert.deepEqual(file.rows[1].slice(0,2),[1,'Employee']);
 for(const extra of ['LCB','KPI','Thưởng','Mã nhân viên','Tháng'])assert.ok(!PAYROLL_FILE_HEADERS.includes(extra));
});
test('imports nine indicators atomically and keeps the right employee when whole rows are reordered',()=>{
 const file=template(),r=file.rows[1];for(const [key,value]of Object.entries({workDays:'24,5',deduction:'100,000',overtimeHours:3.5,outputQty:24,lateCount:2,phone_advance:'308,099',leaveHours:1.5,insurance:'499,650',advance:'2,000,000'}))r[index(key)]=value;
 file.rows.reverse();file.rows.unshift(file.rows.pop()); // reorder data rows, keep header first
 assert.deepEqual(parse(file),[{memberId:'emp',month:'2026-11',version:'v1-emp',inputs:{workDays:24.5,overtimeHours:3.5,outputQty:24,lateCount:2,leaveHours:1.5},adjustments:{deduction:100000,phone_advance:308099,advance:2000000},profile:{insurance:499650}}]);
 r[index('workDays')]='Tự động';assert.equal(parse(file)[0].inputs.workDays,undefined,'null already equals saved automatic');
});
test('rejects wrong month, missing bindings, wrong names, duplicate rows, locked slips, formulas and invalid counters without mutating the board',()=>{
 const snapshot=JSON.stringify(board);
 const bad=(mutate:(f:any)=>void,pattern:RegExp,b:any=board)=>{const f=template();mutate(f);assert.throws(()=>parse(f,b),pattern);assert.equal(JSON.stringify(board),snapshot);};
 bad(f=>f.meta.month='2026-10',/Tháng/);bad(f=>delete f.meta,/Tháng/);
 bad(f=>f.rows.push([...f.rows[1]]),/Trùng/);bad(f=>f.rows[1][1]='Second Employee',/họ tên/);
 bad(f=>f.meta.bindings[0].memberId='unknown',/nhân viên/);
 bad(f=>f.rows[1][index('insurance')]={formula:'1000',result:1000},/công thức/);
 bad(f=>f.rows[1][index('lateCount')]=1.5,/không hợp lệ/);bad(f=>f.rows[1][index('leaveHours')]=745,/không hợp lệ/);
 bad(f=>f.rows[1][index('workDays')]=32,/không hợp lệ/);bad(f=>f.rows[1][index('advance')]=-1,/không hợp lệ/);
 bad(f=>f.rows[0]=[...f.rows[0],'LCB'],/cấu trúc/);
 bad(f=>f.rows[1][index('workDays')]=1,/khóa/,{...board,rows:[{...board.rows[0],payslip:{status:'confirmed'}},board.rows[1]]});
});

test('employee bindings distinguish duplicate names without adding ID columns',()=>{
 const same={...board,rows:[employee('a','Cùng tên'),employee('b','Cùng tên')]};
 const file={rows:payrollFileRows(same),meta:payrollFileMeta(same)};file.rows[2][index('advance')]=500000;
 assert.equal(parse(file,same)[0].memberId,'b');
});

test('template includes the entire month roster, including locked employees, with matching hidden bindings',()=>{
 const all={...board,rows:[employee('first','Cùng tên'),{...employee('locked','Đã chốt'),payslip:{status:'confirmed'}},{...employee('paid','Đã trả'),payslip:{status:'paid'}},employee('last','Cùng tên')]};
 const snapshot=JSON.stringify(all),rows=payrollFileRows(all),meta=payrollFileMeta(all);
 assert.deepEqual(rows.slice(1).map((r:any)=>r.slice(0,2)),[[1,'Cùng tên'],[2,'Đã chốt'],[3,'Đã trả'],[4,'Cùng tên']]);
 assert.deepEqual(meta.bindings.map((r:any)=>[r.stt,r.memberId]),[[1,'first'],[2,'locked'],[3,'paid'],[4,'last']]);
 assert.ok(rows.every((r:any)=>r.length===11));assert.deepEqual(parse({rows,meta},all),[]);
 rows[4][index('advance')]=500000;assert.equal(parse({rows,meta},all)[0].memberId,'last','locked rows do not shift employee identity');
 assert.equal(JSON.stringify(all),snapshot);
});
test('files include all-locked and empty month rosters without permitting changes to locked slips',()=>{
 const all={...board,rows:board.rows.map(r=>({...r,payslip:{status:'confirmed'}}))};
 const file={rows:payrollFileRows(all),meta:payrollFileMeta(all)};assert.equal(file.rows.length,3);assert.deepEqual(parse(file,all),[]);
 file.rows[2][index('advance')]=0;assert.throws(()=>parse(file,all),/đã khóa/,'zero is still an explicit edit');
 const empty={...board,rows:[]};assert.deepEqual(parse({rows:payrollFileRows(empty),meta:payrollFileMeta(empty)},empty),[]);
});

test('downloaded XLSX contains every employee and matching bindings, shades locked rows and imports back unchanged',async()=>{
 const scope=globalThis as any,previous=scope.ExcelJS;
 try{
  await import(new URL('../../trial-ui/exceljs.min.js',import.meta.url).href);
  const {buildPayrollTemplate,readPayrollFile}:any=await import(new URL('../../trial-ui/payroll-file.js',import.meta.url).href);
  const all={...board,rows:[employee('a','Nguyễn A'),{...employee('b','Trần B'),payslip:{status:'confirmed'}},employee('c','Nguyễn A')]};
  const wb=await buildPayrollTemplate(all),ws=wb.getWorksheet('Nhập lương');
  assert.equal(ws.rowCount,4);assert.equal(ws.columnCount,11);assert.equal(ws.getCell('B3').value,'Trần B');
  assert.equal(ws.getCell('C3').fill.fgColor.argb,'FFF1F5F9');assert.equal(wb.getWorksheet('_KyLuong').state,'veryHidden');
  const bytes=Uint8Array.from(await wb.xlsx.writeBuffer());
  const file=await readPayrollFile({name:'Mau-bang-luong-2026-11.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer});
  assert.deepEqual(file.rows.slice(1).map((r:any)=>r[1]),['Nguyễn A','Trần B','Nguyễn A']);
  assert.deepEqual(file.meta.bindings.map((b:any)=>b.memberId),['a','b','c']);assert.deepEqual(parse(file,all),[]);
 }finally{if(previous===undefined)delete scope.ExcelJS;else scope.ExcelJS=previous;}
});

import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
const {buildPayrollSheet}:any=await import(new URL('../../trial-ui/payroll-sheet-export.js',import.meta.url).href);
const {PAYROLL_SHEET_COLUMNS:columns,payrollSheetTotals}:any=await import(new URL('../../trial-ui/payroll-sheet.js',import.meta.url).href);
await import(new URL('../../trial-ui/exceljs.min.js',import.meta.url).href);
const employee=(id:string,status='estimate',hasProfile=true)=>({
 member:{id,name:id,positionId:'SALE'},profile:{hasProfile,payrollGroup:'sale',bankAccount:'999',bankCode:'new'},previousCapacityCoef:1.5,
 entry:{profile:{baseSalary:5200000,capacityCoef:2.5},inputs:{workDays:24.5,kpiOverride:1.1572,revenue:0,overtimeHours:1.5},adjustments:{bonus:0,advance:0},existingAdjustments:{advance:100}},
 payslip:{status,gross:6000000,net:5800000,bank:{account:'001234',code:'vcb',holder:'SAVED'},kpi:{used:1.1572},income:[{key:'salaryByDays',amount:4900000},{key:'otherBonus',amount:1000}],deductions:[{key:'advance',amount:100}]}
});
const board=()=>({month:'2026-11',columns:{groups:{sale:'Sale & VP'},labels:{salaryByDays:'Lương theo công'}},rows:[employee('=HYPERLINK("evil")'),employee('Locked','confirmed'),employee('Paid','paid'),employee('No profile','estimate',false)]});
const col=(key:string)=>4+columns.findIndex((c:any)=>c.key===key||c.line===key||c.total===key||c.read===key||key==='bank'&&c.bank||key==='detail'&&c.detail);

test('export round trips one sheet with the complete roster, web columns, grouped colors and saved numbers',async()=>{
 const data=board(),before=JSON.stringify(data),wb=await buildPayrollSheet(data);
 const copy=new (globalThis as any).ExcelJS.Workbook();await copy.xlsx.load(await wb.xlsx.writeBuffer());
 assert.equal(copy.worksheets.length,1);const ws=copy.worksheets[0];assert.equal(ws.name,'Bảng lương');
 assert.equal(ws.columnCount,columns.length+3);assert.equal(ws.rowCount,9);
 assert.equal(ws.getCell(3,1).value,'STT');assert.equal(ws.getCell(3,7).value,'NĂNG LỰC');
 assert.equal(ws.getCell(4,7).fill.fgColor.argb,'FFF7CFB5');
 assert.equal(ws.getCell(5,2).value,data.rows[0]!.member.name);assert.equal(ws.getCell(5,2).type,3,'formula-like names stay literal strings');
 assert.match(ws.getCell(6,2).note,/Đã chốt/);assert.match(ws.getCell(7,2).note,/Đã trả/);assert.match(ws.getCell(8,2).note,/Chưa có hồ sơ/);
 for(const [key,value]of Object.entries({baseSalary:5200000,workDays:24.5,kpiOverride:115.72,revenue:0,overtimeHours:1.5,capacityCoef:2.5,previousCapacityCoef:1.5,salaryByDays:4900000,net:5800000}))assert.equal(ws.getCell(5,col(key)).value,value,key);
 assert.equal(ws.getCell(5,col('bank')).value,'001234\nVCB');assert.equal(ws.getCell(5,col('bank')).note,'SAVED');
 assert.match(ws.getCell(5,col('detail')).note,/Lương theo công: 4900000/);
 assert.match(ws.getCell(5,col('advance')).note,/Đã ghi riêng: 100/);
 assert.equal(ws.views[0].xSplit,3);assert.equal(ws.views[0].ySplit,4);
 const totals=payrollSheetTotals(data);assert.equal(totals.people,3);
 totals.values.forEach((v:any,i:number)=>assert.equal(ws.getCell(9,i+4).value,v??'—'));
 assert.equal(ws.getCell(9,col('net')).value,17400000,'no-profile estimates excluded exactly as web footer');
 assert.equal(JSON.stringify(data),before);
});

test('automatic values, AppSheet KPI basis and missing bank follow the web without overwriting saved inputs',async()=>{
 const data:any=board();data.rows=data.rows.slice(0,1);const r=data.rows[0];
 r.entry.inputs={workDays:null,kpiOverride:null,revenue:999};r.payslip.kpi={policy:'appsheet',basis:{revenue:123456},used:0};
 delete r.payslip.bank;r.profile.bankAccount='';
 const ws=(await buildPayrollSheet(data)).worksheets[0];
 assert.equal(ws.getCell(5,col('workDays')).value,'Tự động');assert.equal(ws.getCell(5,col('kpiOverride')).value,'Tự động');
 assert.equal(ws.getCell(5,col('revenue')).value,123456);assert.equal(r.entry.inputs.revenue,999);
 assert.equal(ws.getCell(5,col('bank')).value,'Chưa có tài khoản');
});

test('empty month still exports headers and zero totals; missing historical snapshots block export',async()=>{
 const data:any=board();data.rows=[];const ws=(await buildPayrollSheet(data)).worksheets[0];
 assert.equal(ws.rowCount,5);assert.equal(ws.getCell(5,col('net')).value,0);
 data.rows=[{...employee('Old','confirmed'),payslip:{snapshotUnavailable:true}}];
 await assert.rejects(buildPayrollSheet(data),/thiếu bản chụp/);
});

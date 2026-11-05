import {test} from 'node:test';
import assert from 'node:assert/strict';
const {payrollFileRows,parsePayrollFile,payrollFileColumns}:any=await import(new URL('../../trial-ui/payroll-file.js',import.meta.url).href);
const {QUICK_COLUMNS,parseQuickNumber,formatQuickMoney}:any=await import(new URL('../../trial-ui/payroll-quick-entry.js',import.meta.url).href);
const board={month:'2026-11',rows:[{member:{id:'emp',name:'Employee'},payslip:{status:'estimate'},entry:{version:'v1',profile:{baseSalary:5200000,positionLabel:'SALE'},inputs:{workDays:null},adjustments:{advance:0}}}]};
const index=(key:string)=>3+payrollFileColumns(QUICK_COLUMNS).findIndex((f:any)=>f.column[0]===key);
test('money format round trips single/multiple comma groups without changing decimal days and rates',()=>{
 const money=QUICK_COLUMNS.profile[0];for(const n of [15000,4758000,1500.5,0.005,0])assert.equal(parseQuickNumber(formatQuickMoney(n),money),n);
 assert.equal(formatQuickMoney(4758000),'4,758,000');assert.equal(parseQuickNumber('24,5',QUICK_COLUMNS.inputs[0]),24.5);
});
test('Excel template binds employee/month, leaves blanks unchanged and imports position, days, money and percent atomically',()=>{
 const rows=payrollFileRows(board,QUICK_COLUMNS);assert.deepEqual(parsePayrollFile(rows,board,QUICK_COLUMNS,parseQuickNumber),[]);
 rows[1][index('positionLabel')]='Thử việc';rows[1][index('workDays')]='24,5';rows[1][index('baseSalary')]='4,758,000';rows[1][index('kpiOverride')]='115,72';rows[1][index('advance')]=0;
 assert.deepEqual(parsePayrollFile(rows,board,QUICK_COLUMNS,parseQuickNumber),[{memberId:'emp',month:'2026-11',version:'v1',inputs:{workDays:24.5,kpiOverride:1.1572},profile:{baseSalary:4758000,positionLabel:'THỬ VIỆC'}}]);
 const snapshot=JSON.stringify(board);rows.push([...rows[1]]);assert.throws(()=>parsePayrollFile(rows,board,QUICK_COLUMNS,parseQuickNumber),/Trùng/);assert.equal(JSON.stringify(board),snapshot);
 rows.pop();rows[1][0]='2026-10';assert.throws(()=>parsePayrollFile(rows,board,QUICK_COLUMNS,parseQuickNumber),/Tháng/);
 rows[1][0]='2026-11';rows[1][1]='unknown';assert.throws(()=>parsePayrollFile(rows,board,QUICK_COLUMNS,parseQuickNumber),/mã nhân viên/);
 rows[1][1]='emp';rows[1][index('baseSalary')]={formula:'1000',result:1000};assert.throws(()=>parsePayrollFile(rows,board,QUICK_COLUMNS,parseQuickNumber),/công thức/);
 rows[1][index('baseSalary')]=5000000;assert.throws(()=>parsePayrollFile(rows,{...board,rows:[{...board.rows[0],payslip:{status:'confirmed'}}]},QUICK_COLUMNS,parseQuickNumber),/khóa/);
 rows[0][0]='bad';assert.throws(()=>parsePayrollFile(rows,board,QUICK_COLUMNS,parseQuickNumber),/cấu trúc/);
});

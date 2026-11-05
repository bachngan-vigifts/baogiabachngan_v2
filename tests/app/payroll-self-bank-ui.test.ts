import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

/** Thẻ "Tài khoản nhận lương" ở Hồ sơ của tôi: nút điền / đổi chỉ cho chính mình; có QR khi có tài khoản và số tiền. */
const banks:any=await import(new URL('../../trial-ui/salary-banks.js',import.meta.url).href);
async function render(access:any,transfer:any,profile:any={},hidden=false){
 const root={innerHTML:'',addEventListener(){},querySelectorAll:()=>[]};
 const context:any={avAttr:()=>'',bankName:banks.bankName,bankOptions:banks.bankOptions,printPayslip(){},openContractBonusDetails(){},
  document:{getElementById:(id:string)=>id==='member-detail'?root:{textContent:''}},location:{hash:''}};
 const source=readFileSync(new URL('../../trial-ui/member-detail.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function initMemberDetail','globalThis.init = function');
 runInNewContext(source,context);
 const pr={effectiveMonth:'2026-10',payrollGroup:'sale',bankCode:'vcb',bankAccount:'0123456789',bankHolder:'NGUYEN VAN A',...profile};
 const data={member:{id:'emp',name:'Nhân viên',positionId:'sale',position:'Sale',active:true,role:'employee',email:'',phone:'',createdAt:'2026-01-01'},month:'2026-10',access,
  kpi:{revenue:0,orders:0,avgOrder:0,revenueTarget:0,targetPercent:null,quotes:0,quotesWon:0,conversion:0,collected:0,contractsSigned:0,customers:0,newCustomers:0,workedDays:26,standardDays:26,
   debt:{balance:0,overdue:0,orders:0},tasks:{done:0,open:0,overdue:0}},trend:[],customers:[],quotes:[],orders:[],contracts:[],payments:[],debts:[],
  payroll:{profile:pr,payslip:{status:'estimate',net:5_000_000,gross:5_000_000,deductionTotal:0,income:[]},transfer,adjustments:[],attendance:[],attendanceSummary:{worked:26,standardDays:26,daysInMonth:31}},today:'2026-11-05'};
 if(hidden)Object.assign(data,{payroll:null,salaryAccount:{hasProfile:true,bankCode:pr.bankCode,bankAccount:pr.bankAccount,bankHolder:pr.bankHolder}});
 const ui=context.init({api:async()=>data,toast(){},esc:String,money:(n:number)=>n.toLocaleString('vi-VN'),fmtDate:String,pill:()=>'',payCell:String,initials:()=>'NV',ORDER_STATUS:{},CONTRACT_STATUS:{}});
 await ui.open('emp','2026-10');
 return root.innerHTML;
}
const qr='https://img.vietqr.io/image/vcb-0123456789.png?amount=5000000&addInfo=Chuyen%20luong%20T10';
const transfer={bankCode:'vcb',bankAccount:'0123456789',bankHolder:'NGUYEN VAN A',amount:5_000_000,note:'Chuyen luong T10',fromSnapshot:false,qr};

test('chính mình: thấy tài khoản, QR, số tiền, nội dung và nút đổi tài khoản',async()=>{
 const h=await render({isSelf:true,canManage:false,canViewPayroll:true},transfer);
 assert.match(h,/Tài khoản nhận lương/);assert.match(h,/Vietcombank/);assert.match(h,/data-act="bank"/);assert.match(h,/Đổi tài khoản/);
 assert.ok(h.includes(qr));assert.match(h,/Chuyen luong T10/);assert.match(h,/5\.000\.000/);
});
test('chưa điền tài khoản: nút "Điền tài khoản", không có QR; Manager xem người khác không có nút',async()=>{
 const empty={...transfer,bankCode:'',bankAccount:'',bankHolder:'',qr:''};
 const h=await render({isSelf:true,canManage:false,canViewPayroll:true},empty,{bankCode:'',bankAccount:'',bankHolder:''});
 assert.match(h,/Điền tài khoản/);assert.doesNotMatch(h,/vietqr/);
 const m=await render({isSelf:false,canManage:true,canViewPayroll:true},transfer);
 assert.doesNotMatch(m,/data-act="bank"/);assert.ok(m.includes(qr));
 const none=await render({isSelf:true,canManage:false,canViewPayroll:true},null,{effectiveMonth:null,bankCode:'',bankAccount:'',bankHolder:''});
 assert.match(none,/Nhờ quản lý đặt hồ sơ lương/);assert.doesNotMatch(none,/data-act="bank"/);
});
test('danh sách ngân hàng giữ mã cũ không có trong danh sách',()=>{
 assert.match(banks.bankOptions('vietinbank',String),/<option value="vietinbank" selected>VIETINBANK<\/option>/);
 assert.match(banks.bankOptions('icb',String),/<option value="icb" selected>VietinBank<\/option>/);
 assert.equal(banks.bankName('tcb'),'Techcombank');
});
test('trước ngày 10: thẻ báo ngày mở lương, vẫn hiện tài khoản và nút đổi, không có QR',async()=>{
 const h=await render({isSelf:true,canManage:false,canViewPayroll:true,salaryOpensOn:'2026-10-10'},null,{},true);
 assert.match(h,/Lương tháng này hiện từ ngày 10\/10\/2026/);assert.match(h,/0123456789/);assert.match(h,/data-act="bank"/);assert.doesNotMatch(h,/vietqr|Thực nhận/);
});

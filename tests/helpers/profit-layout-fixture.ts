import { emptyRow } from '../../src/modules/profit/domain/profit.ts';

/** Synthetic response for layout checks only; production still uses GET /profit. */
export function profitLayoutFixture() {
  const summary = { ...emptyRow('all','Tổng'), orders:1, revenue:123456, missingOrders:0, missingRevenue:0, unconfirmedOrders:1, unconfirmedRevenue:123456,
    revenueBy:{confirmed:0,estimate:123456,backfill:0,missing:0} };
  return {
    summary, compare:null, direct:{printing:0,commission:0,shipping:0},filterOptions:{branches:[],owners:[]},
    series:[],branches:[],owners:[],customers:[],orders:[],products:[],ordersTotal:0,
    staff:{available:true,payroll:{salary:0,bonus:0,estimateMembers:0},reconcile:{payroll:0,ok:true},months:[],partial:false,unallocated:[]},
    branchCosts:{rows:[],cash:[],classOptions:[{cls:'operating',label:'Chi phí hoạt động',counted:true,why:''},{cls:'payroll',label:'Chi vặt ghi trả lương',counted:false,why:''}],officeExpenses:{available:false,note:'Chưa có chi phí văn phòng trong dữ liệu kiểm thử.'},
      company:{saleUnallocated:0,petty:0,storeStaff:0,overhead:0,net:0,overheadItems:[],reconcile:{ok:true,payrollOk:true,branches:0,payroll:0,payrollParts:{sale:0,store:0,overhead:0}}},
      review:Array.from({length:60},(_,i)=>({id:'e'+i,cls:'payroll',auto:'payroll',manual:i===0,day:'2026-11-01',entryNo:'TEST-'+i,branch:'Chi nhánh kiểm thử',amount:100,reason:'Dòng chi phí kiểm thử bố cục'}))},
    cardFees:{available:false,note:'Chưa có dữ liệu phí thẻ trong fixture.'},
  };
}

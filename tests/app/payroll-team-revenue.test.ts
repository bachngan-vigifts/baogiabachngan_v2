import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {setup} from '../helpers/pos-fixture.ts';
import {eq} from 'drizzle-orm';
import {posRegisters,posShifts} from '../../src/modules/sales/pos-schema.ts';
import {salesOrders,salesOrderLines} from '../../src/modules/sales/schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {hrSalaryProfiles} from '../../src/modules/hr/schema.ts';
import {salesPayrollTeamSources} from '../../src/modules/sales/team-payroll-schema.ts';
import {teamPayrollRevenues} from '../../src/app/team-payroll-revenues.ts';
import {monthlyStoreBonus} from '../../src/modules/hr/domain/payroll.ts';
import {mergeParams} from '../../src/modules/hr/domain/params.ts';
const month='2026-11',path='/hr/team-revenue-sources/'+month;
async function seed(){
 const f=await setup(),[register]=await f.db.select().from(posRegisters).where(eq(posRegisters.id,f.registerId));
 await f.db.insert(posRegisters).values({...register!,id:'ml-register',name:'ML cùng kho Lock'});
 const config={bnRegisterId:'ml-register',lockRegisterId:f.registerId,bonusMode:'threshold',reason:'Chọn nguồn kiểm thử',version:(await f.call(path,f.mgr)).data.version};
 assert.equal((await f.call(path,f.mgr,'PUT',config)).status,200);
 const open=await f.open(),[base]=await f.db.select().from(posShifts);
 await f.db.insert(posShifts).values({...base!,id:'ml-shift',registerId:'ml-register',openKey:'ml-test-key',closedAt:base!.openedAt,countedCash:500000,expectedCash:500000,cashDifference:0,reportSnapshot:'{}'});
 const now='2026-11-06T01:00:00Z';
 await f.db.insert(hrSalaryProfiles).values({memberId:'emp',effectiveMonth:'2026-10',payrollGroup:'bn',positionLabel:'NVBH',baseSalary:5200000,teamBonus:true,updatedBy:'mgr',updatedAt:now});
 const order=async(id:string,channel='pos',extra:Record<string,unknown>={})=>{await f.db.insert(salesOrders).values({id,orderNo:id,quoteType:'HRC',customerName:'Khách kiểm thử team',ownerId:'mgr',createdBy:'mgr',orderDate:'2026-11-06',status:'confirmed',subtotal:100_000_000,total:108_000_000,channel,shiftId:channel==='pos'?'ml-shift':null,createdAt:now,updatedAt:now,...extra});};
 return {...f,order,config,lockShift:base!.id};
}
test('team basis combines CRM employee team and POS store; net excludes VAT and commission without double counting',async()=>{
 const f=await seed();
 await f.db.insert(quotations).values({id:'team-quote',creatorId:'emp',quoteNo:'BG-TEAM',quoteType:'HRC',customer:'Khách',data:JSON.stringify({rows:[{name:'Sản phẩm',sku:'00123',qty:1,price:100_000_000,commission:{mode:'percent',value:5}}]}),createdAt:'',updatedAt:''});
 await f.order('crm','crm',{ownerId:'emp',quoteId:'team-quote'});await f.db.insert(salesOrderLines).values({id:'team-line',orderId:'crm',lineNo:1,sku:'00123',name:'Sản phẩm',qty:1,unitPrice:100_000_000,amount:100_000_000});
 await f.order('ml-pos');await f.order('lock-pos','pos',{shiftId:f.lockShift});
 await f.order('draft','pos',{status:'draft'});await f.order('cancelled','pos',{status:'cancelled'});await f.order('previous','pos',{orderDate:'2026-10-31'});await f.order('next','pos',{orderDate:'2026-12-01'});
 const x=await teamPayrollRevenues(f.db,month);assert.equal(x!.target,300_000_000);assert.equal(x!.bn.crm,95_000_000);assert.equal(x!.bn.pos,100_000_000);assert.equal(x!.bn.revenue,195_000_000);assert.equal(x!.lock.revenue,100_000_000);assert.equal(x!.bn.issues,0);
 const board=(await f.call('/hr/payroll/'+month,f.mgr)).data;assert.equal(board.groupMonth.teamRevenue.bn.revenue,195_000_000);assert.equal(board.rows.find((r:any)=>r.member.id==='emp').payslip.teamRevenueBasis.target,300_000_000);
});
test('source registration is manager-only, versioned and rejects wrong or duplicate stores',async()=>{
 const f=await seed();assert.equal((await f.call(path,f.emp)).status,403);assert.equal((await f.call(path,f.emp,'PUT',f.config)).status,403);
 assert.equal((await f.call(path,f.mgr,'PUT',f.config)).status,409);
 const version=(await f.call(path,f.mgr)).data.version;
 assert.equal((await f.call(path,f.mgr,'PUT',{...f.config,version,bnRegisterId:f.registerId})).status,400);
 assert.equal((await f.call(path,f.mgr,'PUT',{...f.config,version,bnRegisterId:'missing'})).status,400);
 assert.equal((await teamPayrollRevenues(f.db,'2026-10')),null);
 assert.equal((await teamPayrollRevenues(f.db,'2027-01'))!.bn.registerId,'ml-register');
});
test('monthly revenue is computed live, cannot be overwritten by old manual form, and confirmation detects changes',async()=>{
 const f=await seed();await f.order('ml-first','pos',{subtotal:300_000_000,total:324_000_000});
 const before=await f.call('/hr/payroll/'+month,f.mgr);assert.equal(before.status,200);
 assert.equal((await f.call('/hr/months/'+month,f.mgr,'PUT',{bnRevenue:1,lockRevenue:1})).status,409);
 assert.equal((await f.call('/hr/months/'+month,f.mgr,'PUT',{payQuarterBonus:false})).status,200);
 await f.order('late-pos');
 assert.equal((await f.call('/hr/members/emp/payslips/'+month,f.mgr,'POST',{confirmationHash:before.data.confirmationHash})).status,409);
 const own=(await f.call('/members/emp/overview?month='+month,f.mgr)).data;
 assert.equal(own.payroll.groupMonth.bnRevenue,400_000_000);
 assert.equal((await f.call('/hr/members/emp/payslips/'+month,f.mgr,'POST',{confirmationHash:own.payroll.confirmationHash})).status,201);
 await f.order('after-confirm');
 const frozen=(await f.call('/hr/payroll/'+month,f.mgr)).data.rows.find((r:any)=>r.member.id==='emp').payslip;assert.equal(frozen.teamRevenueBasis.revenue,400_000_000);
 const source=(await f.call(path,f.mgr)).data;assert.equal((await f.call(path,f.mgr,'PUT',{...f.config,version:source.version})).status,409);
});
test('unverified CRM commission blocks confirmation even below the store threshold',async()=>{
 const f=await seed();await f.order('unknown-commission','crm',{ownerId:'emp'});
 const x=await teamPayrollRevenues(f.db,month);assert.equal(x!.bn.issues,1);assert.equal(x!.bn.revenue,0);
 const result=await f.call('/hr/payroll/'+month+'/confirm',f.mgr,'POST',{});assert.equal(result.status,409);assert.equal(result.data.code,'TEAM_REVENUE_UNVERIFIED');
});
test('effective payroll team selects CRM membership; shared target is not divided by employee count',async()=>{
 const f=await seed();await f.db.insert(hrSalaryProfiles).values({memberId:'emp',effectiveMonth:'2026-12',payrollGroup:'lock',positionLabel:'NVBH',baseSalary:5200000,teamBonus:true,updatedBy:'mgr',updatedAt:''});
 await f.order('bad-crm-nov','crm',{ownerId:'emp'});await f.order('bad-crm-dec','crm',{ownerId:'emp',orderDate:'2026-12-10'});
 assert.equal((await teamPayrollRevenues(f.db,month))!.bn.issues,1);assert.equal((await teamPayrollRevenues(f.db,'2026-12'))!.lock.issues,1);
 const p=mergeParams({bnSplit:2,lockSplit:2});assert.equal(monthlyStoreBonus(p,'bn',299_999_999,'threshold'),0);assert.equal(monthlyStoreBonus(p,'bn',300_000_000,'threshold'),1_500_000);assert.equal(monthlyStoreBonus(p,'lock',300_000_000,'threshold'),1_500_000);
 assert.equal(monthlyStoreBonus(p,'bn',270_000_000,'tiers'),675_000);assert.equal(monthlyStoreBonus(p,'lock',255_000_000,'tiers'),1_275_000);assert.equal(monthlyStoreBonus(p,'lock',310_000_000,'threshold'),2_325_000);
});

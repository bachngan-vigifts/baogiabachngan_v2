import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {setup} from '../helpers/pos-fixture.ts';
import {eq} from 'drizzle-orm';
import {posRegisters,posShifts} from '../../src/modules/sales/pos-schema.ts';
import {salesOrders} from '../../src/modules/sales/schema.ts';
import {hrSalaryProfiles} from '../../src/modules/hr/schema.ts';
import {employees,credentials} from '../../src/modules/staff/schema.ts';
import {storeManagers} from '../../src/modules/store/schema.ts';
import {hashPassword} from '../../src/core/auth/password.ts';
import {PASSWORD} from '../helpers/staff-fixture.ts';
import {storeBonusTiers,storeBonusRate,monthlyStoreBonus} from '../../src/modules/hr/domain/payroll.ts';
import {mergeParams} from '../../src/modules/hr/domain/params.ts';
const month='2026-11',path='/hr/team-revenue-sources/'+month,now='2026-11-06T01:00:00Z';
/** Hai cửa hàng: ML (emp, nhóm lương bn) và Lock (cashier2, nhóm lock theo vị trí). Ca mẫu (quầy Lock) do emp mở. */
async function seed(bonusMode='threshold'){
 const f=await setup(),[register]=await f.db.select().from(posRegisters).where(eq(posRegisters.id,f.registerId));
 await f.db.insert(posRegisters).values({...register!,id:'ml-register',name:'ML cùng kho Lock'});
 const config={bnRegisterId:'ml-register',lockRegisterId:f.registerId,bonusMode,reason:'Chọn nguồn kiểm thử',version:(await f.call(path,f.mgr)).data.version};
 assert.equal((await f.call(path,f.mgr,'PUT',config)).status,200);
 await f.open();const [base]=await f.db.select().from(posShifts);
 await f.db.insert(posShifts).values({...base!,id:'ml-shift',registerId:'ml-register',openKey:'ml-test-key',closedAt:base!.openedAt,countedCash:500000,expectedCash:500000,cashDifference:0,reportSnapshot:'{}'});
 await f.db.insert(hrSalaryProfiles).values({memberId:'emp',effectiveMonth:'2026-10',payrollGroup:'bn',positionLabel:'NVBH',baseSalary:5200000,teamBonus:true,updatedBy:'mgr',updatedAt:now});
 await f.db.insert(employees).values({id:'office',name:'Sale văn phòng',email:'office@x.vn',role:'employee',positionId:'sale',createdAt:now});
 await f.db.insert(credentials).values({memberId:'office',passwordHash:await hashPassword(PASSWORD,1000),version:0});
 const office=(await f.call('/login','','POST',{email:'office@x.vn',password:PASSWORD})).cookie;
 const order=async(id:string,subtotal:number,shiftId:string,extra:Record<string,unknown>={})=>{await f.db.insert(salesOrders).values({id,orderNo:id,quoteType:'HRC',customerName:'Khách kiểm thử',ownerId:'mgr',createdBy:'mgr',orderDate:'2026-11-06',status:'confirmed',subtotal,total:subtotal*1.08,channel:'pos',shiftId,createdAt:now,updatedAt:now,...extra});};
 return {...f,office,order,lockShift:base!.id};
}
const TIERS=[{at:255_000_000,rate:0.005,strict:false},{at:300_000_000,rate:0.01,strict:false},{at:360_000_000,rate:0.015,strict:true}];
const store=(r:any,key:string)=>r.data.stores.find((s:any)=>s.key===key);
test('store staff see only their own store with target, achievement, tiers and per-person sales',async()=>{
 const f=await seed();await f.order('ml-1',120_000_000,'ml-shift');await f.order('lock-1',80_000_000,f.lockShift);
 await f.order('ml-cancel',50_000_000,'ml-shift',{status:'cancelled'});await f.order('ml-oct',50_000_000,'ml-shift',{orderDate:'2026-10-31'});
 await f.db.insert(storeManagers).values({registerId:f.registerId,memberId:'cashier2',assignedBy:'mgr',assignedAt:now});
 const lock=await f.call('/dashboard/store?month='+month,f.other);assert.equal(lock.status,200,JSON.stringify(lock.data));assert.equal(lock.data.available,true);
 assert.deepEqual(lock.data.stores.map((s:any)=>s.key),['lock']);
 const l=store(lock,'lock');assert.equal(l.revenue,80_000_000);assert.equal(l.target,300_000_000);assert.equal(l.rate,0);assert.equal(l.bonusPerPerson,0);
 assert.deepEqual(l.tiers,TIERS);
 // CHT luôn có tên trong cửa hàng; DS POS chia theo người mở ca (emp mở ca Lock).
 assert.deepEqual(l.members.map((m:any)=>[m.id,m.pos,m.storeManager]),[['emp',80_000_000,false],['cashier2',0,true]]);
 const ml=await f.call('/dashboard/store?month='+month,f.emp);assert.deepEqual(ml.data.stores.map((s:any)=>s.key),['bn','lock']);
 assert.equal(store(ml,'bn').revenue,120_000_000);assert.equal(ml.data.me,'emp');
 const office=await f.call('/dashboard/store?month='+month,f.office);assert.equal(office.status,200);assert.equal(office.data.available,false);assert.deepEqual(office.data.stores,[]);
 const all=await f.call('/dashboard/store?month='+month,f.mgr);assert.equal(all.data.scope,'company');assert.equal(all.data.stores.length,2);
 assert.equal((await f.call('/dashboard/store?month='+month,f.ncc)).status,403);
 assert.equal((await f.call('/dashboard/store?month=2026-13',f.emp)).status,400);
});
test('bonus rate and per-person estimate follow the payroll formula at each milestone',async()=>{
 const f=await seed();await f.order('ml-big',300_000_000,'ml-shift');
 const bn=store(await f.call('/dashboard/store?month='+month,f.mgr),'bn');
 assert.equal(bn.rate,0.01);assert.equal(bn.split,2);assert.equal(bn.bonusPerPerson,1_500_000);
 assert.equal(bn.bonusPerPerson,monthlyStoreBonus(mergeParams({}),'bn',300_000_000));
 // Cấu hình nguồn cũ "threshold" không còn chặn mốc 85%.
 const t=await seed('threshold');await t.order('ml-mid',260_000_000,'ml-shift');
 const tiered=store(await t.call('/dashboard/store?month='+month,t.emp),'bn');
 assert.deepEqual(tiered.tiers,TIERS);assert.equal(tiered.rate,0.005);assert.equal(tiered.bonusPerPerson,650_000);
 assert.equal((await t.call('/dashboard/store?month=2026-10',t.emp)).data.available,false);
});
test('store bonus tiers mirror monthlyStoreBonus: same scale for both stores, 120% exactly stays at 1%',()=>{
 const p=mergeParams({});
 assert.equal(storeBonusRate(p,360_000_000),0.01);assert.equal(storeBonusRate(p,360_000_001),0.015);assert.equal(storeBonusRate(p,254_999_999),0);
 for(const g of ['bn','lock'] as const){
  const {tiers,split}=storeBonusTiers(p,g);assert.deepEqual(tiers,TIERS);
  for(const revenue of [0,254_999_999,255_000_000,299_999_999,300_000_000,359_999_999,360_000_000,360_000_001,500_000_000]){
   const rate=[...tiers].reverse().find(t=>t.strict?revenue>t.at:revenue>=t.at)?.rate??0;
   assert.equal(Math.round(revenue*rate/split),Math.round(monthlyStoreBonus(p,g,revenue)),`${g}/${revenue}`);
  }
 }
 // Sửa mức trong Tham số lương → cả hai cửa hàng theo.
 assert.equal(storeBonusRate(mergeParams({storeLevel1Rate:0.007}),260_000_000),0.007);
});

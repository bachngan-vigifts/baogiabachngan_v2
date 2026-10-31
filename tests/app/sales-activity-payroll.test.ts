import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {activityKpi,activityDay,type ActivityKpiRow} from '../../src/modules/care/domain/activity-kpi.ts';
import {awardPolicy,starAward} from '../../src/modules/hr/domain/contract-bonus.ts';
import {DEFAULT_PARAMS} from '../../src/modules/hr/domain/params.ts';
import {setupSalesPayroll} from '../helpers/sales-payroll-fixture.ts';
import {salesOrders,salesContracts} from '../../src/modules/sales/schema.ts';
import {hrContractBonusEntries} from '../../src/modules/hr/contract-bonus-schema.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
const amount=(slip:any,key:string)=>slip.income.find((l:any)=>l.key===key)?.amount||0;

test('star tiers use exact lower bounds before VAT; activity dedup, retryable no-answer, Vietnam dates and quote versions',()=>{
 const p=awardPolicy(DEFAULT_PARAMS,'2026-10');
 for(const [value,stars,money]of [[1999999,0,0],[2000000,1,20000],[19999999,1,20000],[20000000,2,50000],[100000000,3,100000],[500000000,4,200000],[1000000000,5,500000]])assert.deepEqual(starAward(value!,p),{stars,amount:money});
 const a:ActivityKpiRow={id:'a',ownerId:'emp',customerId:'c',type:'call',completion:'completed',purpose:'sales',quoteId:null,quoteRevision:null,kpiExtraApproved:false,kpiReviewReason:'',occurredAt:'2026-10-30T18:00:00Z',createdAt:'2026-10-31T00:00:00Z',content:'Có trao đổi',contactName:'Khách'};
 assert.equal(activityDay(a.occurredAt),'2026-10-31');
 const marks=activityKpi([{...a,id:'b',createdAt:'2026-10-31T01:00:00Z'},a,{...a,id:'c',completion:'not_completed'},{...a,id:'legacy',completion:null},{...a,id:'extra',kpiExtraApproved:true,kpiReviewReason:'Gặp việc riêng khác',createdAt:'2026-10-31T02:00:00Z'}]);
 assert.equal(marks.get('a')?.counted,true);assert.equal(marks.get('b')?.counted,false);assert.equal(marks.get('c')?.counted,false);assert.equal(marks.get('legacy')?.counted,false);assert.equal(marks.get('extra')?.counted,true);
 const quotes=activityKpi([{...a,id:'q1',type:'quote',quoteId:'q',quoteRevision:1},{...a,id:'q2',type:'quote',quoteId:'q',quoteRevision:1,occurredAt:'2026-11-01T02:00:00Z',kpiExtraApproved:true}]);assert.equal(quotes.get('q2')?.counted,false);
});

test('care result, idempotent replay, daily duplicates, Manager review and scoped quote selection',async()=>{
 const f=await setupSalesPayroll(),key=crypto.randomUUID(),first=await f.care({clientKey:key});assert.equal(first.status,201,JSON.stringify(first.data));assert.equal(first.data.activity.kpi.counted,true);
 const replay=await f.care({clientKey:key});assert.equal(replay.status,200);assert.equal(replay.data.activity.id,first.data.activity.id);assert.equal((await f.care({clientKey:key,content:'Khác nội dung'})).status,409);
 const second=await f.care({content:'Trao đổi việc khác cùng ngày'});assert.equal(second.data.activity.kpi.counted,false);
 const review='/care/'+second.data.activity.id+'/kpi-review',body={approved:true,reason:'Một cuộc trao đổi riêng về nhu cầu mới',revision:1};assert.equal((await f.call(review,f.emp,'POST',body)).status,403);assert.equal((await f.call(review,f.mgr,'POST',body)).status,200);
 const list=(await f.call('/care?from=2026-10-01&to=2026-10-31&limit=1',f.emp)).data;assert.equal(list.total,2);assert.equal(list.activities.length,1);assert.equal(list.kpiSummary.counted,2);
 assert.equal((await f.care({completion:'not_completed',type:'meeting'})).data.activity.kpi.counted,false);
 await f.db.insert(quotations).values({id:'sales-quote',creatorId:'emp',quoteNo:'BG-KPI',quoteType:'HRC',customer:'Khách KPI',data:JSON.stringify({customerId:'sales-customer'}),revision:3,createdAt:f.stamp,updatedAt:f.stamp});
 assert.equal((await f.call('/care/quotes?customerId=sales-customer',f.emp)).data.quotes[0].revision,3);
 assert.equal((await f.care({type:'quote',quoteId:'sales-quote',quoteRevision:2})).status,409);
 assert.equal((await f.care({type:'quote',quoteId:'sales-quote',quoteRevision:3})).data.activity.kpi.counted,true);
 assert.equal((await f.call('/care/quotes?customerId=sales-customer',f.other)).status,404);
});

test('shadow calculation, null vs manual zero, fixed KPI, actual bonus booking, locked sources and unchanged paid snapshot',async()=>{
 const f=await setupSalesPayroll();assert.equal((await f.setPolicy()).status,200);assert.equal((await f.salary()).status,200);await f.care();
 let view=(await f.overview()).data.payroll;assert.deepEqual(view.systemFacts,{newCustomers:1,transactions:1,contracts:1});assert.equal(view.payslip.salesCrm.apply,false);assert.equal(amount(view.payslip,'contractBonus'),0);assert.equal(view.payslip.salesCrm.awards[0].amount,50000);
 assert.equal((await f.setPolicy(1)).status,200);view=(await f.overview()).data.payroll;assert.equal(amount(view.payslip,'contractBonus'),50000);assert.ok(view.payslip.kpi.points.transactions>0);
 await f.call('/hr/members/emp/inputs/2026-10',f.mgr,'PUT',{kpiTransactions:0,kpiMerchDays:1,kpiTripDays:0,kpiOverride:0});
 view=(await f.overview()).data.payroll;assert.equal(view.input.kpiTransactions,0);assert.equal(view.payslip.kpi.points.transactions,10/260*0.3);
 await f.salary({fixedKpi:1});view=(await f.overview()).data.payroll;assert.equal(view.payslip.kpi.used,1);
 assert.equal((await f.confirm('2026-10',{confirmationHash:'stale'})).status,409);
 assert.equal((await f.confirm()).status,201);assert.equal((await f.confirm()).status,409);assert.equal((await f.db.select().from(hrContractBonusEntries)).length,1);
 const snapshot=(await f.overview()).data.payroll.payslip;assert.equal(snapshot.status,'confirmed');assert.equal(amount(snapshot,'contractBonus'),50000);
 assert.equal((await f.care({type:'meeting'})).status,409);assert.equal((await f.call('/hr/payroll/2026-10',f.emp)).status,403);
 await f.call('/hr/members/emp/payslips/2026-10/paid',f.mgr,'POST',{});await f.db.update(salesOrders).set({subtotal:200000000}).where(eq(salesOrders.id,'liq-order'));
 view=(await f.overview()).data.payroll;assert.equal(view.payslip.net,snapshot.net);assert.equal(view.payslip.salesCrm.awards[0].fact.subtotal,20000000);
 assert.equal((await f.call('/hr/members/emp/payslips/2026-10',f.mgr,'DELETE')).status,409);
});

test('prior-period differences subtract reserved awards, survive owner changes, reopen safely, and never repeat after payment',async()=>{
 const f=await setupSalesPayroll();await f.setPolicy(1);await f.salary();assert.equal((await f.confirm()).status,201);
 // Original owner remains the beneficiary after the order is reassigned.
 await f.db.update(salesOrders).set({subtotal:150000000,ownerId:'mgr'}).where(eq(salesOrders.id,'liq-order'));
 let nov=(await f.overview(f.mgr,'2026-11')).data.payroll;assert.equal(amount(nov.payslip,'contractBonusAdjustment'),50000);
 const hidden=(await f.overview(f.emp,'2026-11')).data.payroll.payslip.salesCrm.awards[0];assert.equal(hidden.fact,undefined);
 assert.equal((await f.confirm('2026-11')).status,201);
 assert.equal((await f.call('/hr/members/emp/payslips/2026-10',f.mgr,'DELETE')).status,409,'cannot reopen a base with a downstream adjustment');
 assert.equal((await f.call('/hr/members/emp/payslips/2026-11',f.mgr,'DELETE')).status,200);assert.equal((await f.confirm('2026-11')).status,201);
 const dec=(await f.overview(f.mgr,'2026-12')).data.payroll;assert.equal(amount(dec.payslip,'contractBonusAdjustment'),0,'reserved November already counts');
 await f.db.update(salesContracts).set({status:'cancelled'}).where(eq(salesContracts.id,'liq-contract'));
 const cancelled=(await f.overview(f.mgr,'2026-12')).data.payroll;assert.equal(amount(cancelled.payslip,'contractBonusAdjustment'),-100000);
 assert.equal((await f.confirm('2026-12')).status,201);assert.equal(amount((await f.overview(f.mgr,'2027-01')).data.payroll.payslip,'contractBonusAdjustment'),0);
});

test('liquidation bonus belongs to Manager approval month, not signed/completed status alone',async()=>{
 const f=await setupSalesPayroll();await f.setPolicy(1);await f.salary();
 let view=(await f.overview()).data.payroll;assert.equal(view.payslip.salesCrm.awards.filter((a:any)=>a.kind==='liquidation').length,0);
 await f.db.update(salesContracts).set({signedDate:'2026-09-30'}).where(eq(salesContracts.id,'liq-contract'));
 assert.equal((await f.award()).status,200);
 view=(await f.overview()).data.payroll;assert.equal(view.systemFacts.contracts,0);assert.equal(amount(view.payslip,'contractBonus'),10000);assert.equal(view.payslip.salesCrm.awards[0].kind,'liquidation');
});

test('concurrent individual and batch confirmation book the entitlement once',async()=>{
 const f=await setupSalesPayroll();await f.setPolicy(1);await f.salary();
 const board=(await f.call('/hr/payroll/2026-10',f.mgr)).data,view=(await f.overview()).data.payroll;
 const results=await Promise.all([f.call('/hr/payroll/2026-10/confirm',f.mgr,'POST',{confirmationHash:board.confirmationHash}),f.call('/hr/members/emp/payslips/2026-10',f.mgr,'POST',{confirmationHash:view.confirmationHash})]);
 assert.ok(results.every(r=>[200,201,409].includes(r.status)),JSON.stringify(results));assert.equal((await f.db.select().from(hrContractBonusEntries)).length,1);
});

test('re-sent quote across month boundaries counts once, and reassigning an activity never creates another intent',async()=>{
 const f=await setupSalesPayroll();
 await f.db.insert(quotations).values({id:'same-quote',creatorId:'emp',quoteNo:'BG-ONE',quoteType:'HRC',customer:'Khách KPI',data:JSON.stringify({customerId:'sales-customer'}),revision:1,createdAt:f.stamp,updatedAt:f.stamp});
 const key=crypto.randomUUID(),original=await f.care({clientKey:key,type:'quote',quoteId:'same-quote',quoteRevision:1});assert.equal(original.status,201);
 // Backdated copies cannot steal a quote already recorded first, even if months are queried separately.
 const second=await f.care({type:'quote',quoteId:'same-quote',quoteRevision:1,occurredAt:'2026-09-30'});assert.equal(second.data.activity.kpi.counted,false);
 const september=(await f.call('/care?from=2026-09-01&to=2026-09-30',f.emp)).data;assert.equal(september.kpiSummary.counted,0);
 const updated=await f.call('/care/'+original.data.activity.id,f.mgr,'PUT',{customerId:'sales-customer',ownerId:'mgr',type:'quote',quoteId:'same-quote',quoteRevision:1,completion:'completed',purpose:'sales',contactName:'Khách kiểm thử',content:'Đã trao đổi nhu cầu và thống nhất bước tiếp theo',occurredAt:'2026-10-30',nextAt:'2026-11-15',remindBefore:'1d',result:'consulting',revision:1});assert.equal(updated.status,200);
 const replay=await f.care({clientKey:key,type:'quote',quoteId:'same-quote',quoteRevision:1});assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
 const count=await f.client.query<any>('select count(*)::int n from customer_activities');assert.equal(count.rows[0].n,2);
});

test('policy changes do not retroactively change booked reward rates; zero-star contracts remain tracked',async()=>{
 const f=await setupSalesPayroll();await f.db.update(salesOrders).set({subtotal:1999999}).where(eq(salesOrders.id,'liq-order'));await f.setPolicy(1);await f.salary();assert.equal((await f.confirm()).status,201);
 await f.db.update(salesOrders).set({subtotal:20000000}).where(eq(salesOrders.id,'liq-order'));
 await f.setPolicy(1,'2026-11',{contractStar2Amount:999999});
 const next=(await f.overview(f.mgr,'2026-11')).data.payroll.payslip;assert.equal(amount(next,'contractBonusAdjustment'),50000,'use booked October policy, not the new November rate');
});

test('lost quote-submit reply remains recoverable after quote revision changes; historical versions are selectable',async()=>{
 const f=await setupSalesPayroll(),data=JSON.stringify({customerId:'sales-customer'});
 await f.db.insert(quotations).values({id:'quote-retry',creatorId:'emp',quoteNo:'BG-RETRY',quoteType:'HRC',customer:'Khách KPI',data,revision:1,createdAt:f.stamp,updatedAt:f.stamp});
 const key=crypto.randomUUID(),first=await f.care({clientKey:key,type:'quote',quoteId:'quote-retry',quoteRevision:1});assert.equal(first.status,201);
 await f.db.update(quotations).set({revision:2}).where(eq(quotations.id,'quote-retry'));
 const replay=await f.care({clientKey:key,type:'quote',quoteId:'quote-retry',quoteRevision:1});assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
 await f.client.query("insert into quote_revisions(id,quote_id,revision,data,changed_by,created_at) values('old-quote-retry','quote-retry',1,$1,'emp',$2)",[data,f.stamp]);
 const list=(await f.call('/care/quotes?customerId=sales-customer',f.emp)).data.quotes;assert.deepEqual(list.map((r:any)=>r.revision).sort(),[1,2]);
});

test('legacy incomplete snapshot preserves stored totals without injecting current CRM bonuses',async()=>{
 const f=await setupSalesPayroll();await f.setPolicy(1);await f.salary();await f.confirm();const net=(await f.overview()).data.payroll.payslip.net;
 await f.client.query("update hr_payslips set data='{}' where member_id='emp' and month='2026-10'");
 const old=(await f.overview()).data.payroll.payslip;assert.equal(old.net,net);assert.equal(old.snapshotUnavailable,true);assert.deepEqual(old.income,[]);assert.equal(old.salesCrm,undefined);
});

test('Sale Admin has no KPI or automatic quarterly KPI bonus, but receives star and liquidation rewards',async()=>{
 const f=await setupSalesPayroll();await f.client.query("update staff_members set position_id='sale-admin' where id='emp'");
 await f.setPolicy(1);
 assert.equal((await f.salary()).status,400,'cannot turn on KPI for Sale Admin via API');
 assert.equal((await f.salary({kpiEnabled:false,fixedKpi:1})).status,400,'fixed 100% is also a KPI');
 assert.equal((await f.salary({kpiEnabled:false,fixedKpi:null})).status,200);
 // Historical profile flags must not accidentally award KPI after a position change.
 await f.client.query("update hr_salary_profiles set kpi_enabled=true,fixed_kpi=1 where member_id='emp'");
 await f.care();assert.equal((await f.award()).status,200);
 const p=(await f.overview()).data.payroll;
 assert.equal(p.profile.kpiEligible,false);assert.equal(p.profile.kpiEnabled,false);assert.equal(p.profile.fixedKpi,null);
 assert.equal(p.payslip.kpi,null);assert.equal(p.payslip.salesCrm.previewKpi,null);assert.equal(amount(p.payslip,'kpiBonus'),0);
 assert.equal(amount(p.payslip,'contractBonus'),60000,'50k for two stars + 10k liquidation');
 await f.call('/hr/months/2026-12',f.mgr,'PUT',{payQuarterBonus:true});
 const quarter=(await f.call('/hr/payroll/2026-12',f.mgr)).data;assert.equal(quarter.quarter,null,'Sale Admin must not enter the automatic Sale quarterly team');
 assert.equal((await f.confirm()).status,201);assert.equal((await f.overview()).data.payroll.payslip.kpi,null);
});

test('changing position to Sale Admin keeps a previously confirmed Sale payslip unchanged',async()=>{
 const f=await setupSalesPayroll();await f.setPolicy(1);await f.salary({fixedKpi:1});await f.confirm();
 const old=(await f.overview()).data.payroll.payslip;assert.equal(old.kpi.used,1);assert.ok(amount(old,'kpiBonus')>0);
 await f.client.query("update staff_members set position_id='sale-admin' where id='emp'");
 const same=(await f.overview()).data.payroll.payslip;assert.equal(same.net,old.net);assert.equal(same.kpi.used,1);
 const future=(await f.overview(f.mgr,'2026-11')).data.payroll.payslip;assert.equal(future.kpi,null);assert.equal(amount(future,'kpiBonus'),0);
});

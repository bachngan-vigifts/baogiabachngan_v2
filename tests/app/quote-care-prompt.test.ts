import{test}from'node:test';import assert from'node:assert/strict';import{eq}from'drizzle-orm';
import{createTestDb}from'../helpers/postgres.ts';import{seedStaff,PASSWORD}from'../helpers/staff-fixture.ts';
import{createAppRouter}from'../../src/app/router.ts';import{customers,customerStaff}from'../../src/modules/customers/schema.ts';
import{quotations}from'../../src/modules/quotes/schema.ts';
import{customerActivities}from'../../src/modules/care/schema.ts';import{dueFollowUps,vnToday}from'../../src/modules/care/api/routes.ts';
import{reconcileAutoTasks}from'../../src/modules/tasks/api/auto-tasks.ts';import{tasks}from'../../src/modules/tasks/schema.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
const day=(iso:string,n:number)=>new Date(Date.parse(iso+'T00:00:00Z')+n*864e5).toISOString().slice(0,10);
async function setup(){
 const {db,d1}=await createTestDb();await seedStaff(d1);
 await db.insert(customers).values({id:'care-customer',name:'Khách kiểm thử',contact:'Anh Liên Hệ',phone:'0901234567',email:'',address:'',taxCode:'',customerCode:'',search:'',sourceVersion:0,syncedAt:''});
 await db.insert(customerStaff).values({customerId:'care-customer',memberId:'emp',role:'owner',createdBy:'mgr',createdAt:new Date().toISOString()});
 const router=createAppRouter(),origin='https://care.test',call=async(path:string,cookie='',method='GET',body?:any)=>{const r=await router.handle(new Request(origin+'/api/staff'+path,{method,headers:{origin,cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{db,passwordIterations:1000,sapoOrderPush:'off'});return{status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};};
 const emp=(await call('/login','','POST',{email:'emp@x.vn',password:PASSWORD})).cookie,mgr=(await call('/login','','POST',{email:'mgr@x.vn',password:PASSWORD})).cookie,ncc=(await call('/login','','POST',{email:'ncc@x.vn',password:PASSWORD})).cookie;
 const quote=async(extra:any={})=>ok(await call('/quotes',emp,'POST',{type:'B2B',quoteNo:'CARE-'+crypto.randomUUID(),customer:'Khách kiểm thử',customerId:'care-customer',contact:'Anh Liên Hệ',vat:8,rows:[{name:'Ly kiểm thử',qty:1,price:100000}],...extra}),201);
 return{db,call,emp,mgr,ncc,quote};
}
const request=(q:any,today:string,extra:any={})=>({quoteId:q.id,quoteRevision:q.revision,clientKey:crypto.randomUUID(),occurredAt:today,contactName:'Anh Liên Hệ – 0901234567',type:'call',nextAt:day(today,1),nextAction:'Hỏi phản hồi về báo giá',remindBefore:'1d',...extra});

test('Saving does not create a care activity; an opted-in reminder links the exact quote/customer/owner, never a completed contact or KPI',async()=>{
 const f=await setup(),q=await f.quote(),today=vnToday();
 assert.equal((await f.db.select().from(customerActivities)).length,0);
 const context=ok(await f.call('/care/quote-follow-up?quoteId='+q.id+'&revision=1',f.emp));
 assert.equal(context.ownerId,'emp');assert.equal(context.customerId,'care-customer');assert.equal(context.canSchedule,true);assert.equal(context.pending,null);
 assert.ok(!JSON.stringify(context).includes('costPrice'));
 const data=ok(await f.call('/care/quote-follow-up',f.emp,'POST',request(q,today,{completion:'completed',result:'won',expectedRevenue:90000000,customerId:'FORGED'})),201);
 const a=data.activity;assert.equal(a.customerId,'care-customer');assert.equal(a.ownerId,'emp');assert.equal(a.quoteId,q.id);assert.equal(a.quoteRevision,1);assert.equal(a.completion,'not_completed');assert.equal(a.result,'consulting');assert.equal(a.expectedRevenue,0);assert.equal(a.kpi.counted,false);
 const due=await dueFollowUps(f.db,today);assert.equal(due.find(x=>x.id===a.id)?.ownerId,'emp');
 await reconcileAutoTasks(f.db);
 const task=(await f.db.select().from(tasks).where(eq(tasks.autoKey,'care:'+a.id+':'+a.nextAt)))[0]!;
 assert.equal(task.assigneeId,'emp');assert.ok(task.description.startsWith('Việc cần làm'));
 const pending=ok(await f.call('/care/quote-follow-up?quoteId='+q.id+'&revision=1',f.emp));assert.equal(pending.pending.id,a.id);
});

test('Retry and simultaneous prompts cannot silently add a second pending reminder; changing the same command conflicts',async()=>{
 const f=await setup(),q=await f.quote(),b=request(q,vnToday()),path='/care/quote-follow-up';
 const first=ok(await f.call(path,f.emp,'POST',b),201),replay=ok(await f.call(path,f.emp,'POST',b));
 assert.equal(replay.replayed,true);assert.equal(replay.activity.id,first.activity.id);
 assert.equal((await f.call(path,f.emp,'POST',{...b,nextAction:'Đổi nội dung cùng mã'})).status,409);
 const other=ok(await f.call(path,f.emp,'POST',{...b,clientKey:crypto.randomUUID(),nextAt:day(vnToday(),7)}));
 assert.equal(other.alreadyScheduled,true);assert.equal(other.activity.id,first.activity.id);assert.equal(other.activity.nextAt,b.nextAt);
 const q2=await f.quote(),r=request(q2,vnToday());
 const concurrent=await Promise.all([f.call(path,f.emp,'POST',r),f.call(path,f.emp,'POST',{...r,clientKey:crypto.randomUUID()})]);
 assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,201]);
 assert.equal((await f.db.select().from(customerActivities).where(eq(customerActivities.quoteId,q2.id))).length,1);
 await f.db.delete(quotations).where(eq(quotations.id,q.id));
 const afterDelete=ok(await f.call(path,f.emp,'POST',b));assert.equal(afterDelete.replayed,true);assert.equal(afterDelete.activity.id,first.activity.id);
 const a=first.activity;const edited=ok(await f.call('/care/'+a.id,f.emp,'PUT',{customerId:a.customerId,ownerId:a.ownerId,quoteId:a.quoteId,quoteRevision:a.quoteRevision,revision:a.revision,type:a.type,result:a.result,completion:a.completion,purpose:a.purpose,occurredAt:a.occurredAt,contactName:a.contactName,subject:a.subject,content:a.content,nextAction:a.nextAction,nextAt:day(vnToday(),3),remindBefore:a.remindBefore}));
 assert.equal(edited.activity.quoteId,q.id);assert.equal(ok(await f.call('/care/'+a.id,f.emp)).activity.kpi.counted,false,'rescheduling keeps the historical source link without fabricating contact');
});

test('Missing/foreign source, incomplete details and employee reassignment are rejected; Manager can schedule for the responsible employee',async()=>{
 const f=await setup(),q=await f.quote(),b=request(q,vnToday()),path='/care/quote-follow-up';
 assert.equal((await f.call(path+'?quoteId='+q.id+'&revision=1',f.ncc)).status,403);
 assert.equal((await f.call(path,f.emp,'POST',{...b,ownerId:'mgr'})).status,403);
 assert.equal((await f.call(path,f.emp,'POST',{...b,quoteId:'not-visible'})).status,404);
 assert.equal((await f.call(path,f.emp,'POST',{...b,quoteRevision:9})).status,409);
 for(const extra of [{nextAt:''},{contactName:''},{nextAction:''},{clientKey:''},{nextAt:'2026-02-31'}])assert.equal((await f.call(path,f.emp,'POST',{...b,...extra})).status,400);
 assert.equal((await f.db.select().from(customerActivities)).length,0);
 const typed=await f.quote({customerId:''}),ctx=ok(await f.call(path+'?quoteId='+typed.id+'&revision=1',f.emp));
 assert.equal(ctx.canSchedule,false);assert.ok(ctx.reason.includes('hồ sơ khách hàng'));
 assert.equal((await f.call(path,f.emp,'POST',request(typed,vnToday()))).status,409);
 const created=ok(await f.call(path,f.mgr,'POST',{...b,ownerId:'emp'}),201);assert.equal(created.activity.ownerId,'emp');assert.equal(created.activity.kpi.counted,false);
});

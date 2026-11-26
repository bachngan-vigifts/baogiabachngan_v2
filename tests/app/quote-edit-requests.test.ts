import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {createTestDb} from '../helpers/postgres.ts';
import {seedStaff,PASSWORD} from '../helpers/staff-fixture.ts';
import {createAppRouter} from '../../src/app/router.ts';
import {employees,positions} from '../../src/modules/staff/schema.ts';
import {quoteShares,quotations} from '../../src/modules/quotes/schema.ts';
import {salesOrders} from '../../src/modules/sales/schema.ts';
import {webNotifications} from '../../src/modules/notifications/schema.ts';

const doc=(price=100000)=>({type:'B2B',quoteNo:'B2B_EDIT_001',customer:'Khách kiểm thử',vat:8,rows:[{id:'line1',name:'Ly kiểm thử',qty:2,price,commission:{mode:'percent',value:0},costMode:'manual',costPrice:30000}]});
async function setup(){
 const f=await createTestDb();await seedStaff(f.d1);await f.db.update(employees).set({active:true,canApprove:true}).where(eq(employees.id,'off'));
 await f.db.update(positions).set({dataScope:'own'}).where(eq(positions.id,'sale'));
 const router=createAppRouter(),origin='https://trial.test';
 const call=async(path:string,cookie='',method='GET',body?:unknown)=>{
  const r=await router.handle(new Request(origin+'/api/staff'+path,{method,headers:{origin,cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),{db:f.db,passwordIterations:1000,sapoOrderPush:'off'});
  return{status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
 };
 const login=async(id:string)=>(await call('/login','','POST',{email:id+'@x.vn',password:PASSWORD})).cookie;
 const [mgr,emp,other,ncc]=await Promise.all(['mgr','emp','off','ncc'].map(login));
 const created=await call('/quotes',emp,'POST',doc());assert.equal(created.status,201);
 const id=created.data.id;
 const initial=(await call(`/quotes/${id}`,mgr)).data.data;initial.rows[0].costPrice=30000;initial.rows[0].costMode='manual';
 await f.db.update(quotations).set({data:JSON.stringify(initial)}).where(eq(quotations.id,id));
 assert.equal((await call(`/quotes/${id}/approve`,mgr,'POST',{revision:1})).status,200);
 const path=`/quotes/${id}`,request=(who=emp,revision=1)=>call(path+'/edit-request',who,'POST',{revision,reason:'Khách thay đổi số lượng'});
 const decide=(req:string,decision='approved',revision=1,reason='')=>call(path+`/edit-request/${req}/decision`,mgr,'POST',{revision,decision,reason});
 return{...f,call,mgr,emp,other,ncc,id,path,request,decide};
}

test('request → Manager permission → one saved revision → draft and reapproval; duplicate transport retries do not notify twice',async()=>{
 const f=await setup();
 const first=await f.request();assert.equal(first.status,200);
 const duplicate=await f.request();assert.equal(duplicate.data.id,first.data.id);assert.equal(duplicate.data.replayed,true);
 const pending=(await f.call(f.path,f.emp)).data;assert.equal(pending.approvalStatus,'approved');assert.equal(pending.editRequest.mine.status,'pending');
 assert.equal((await f.call(f.path,f.mgr)).data.editRequest.pending.length,1);
 const inbox=await f.call('/approvals',f.mgr),summary=await f.call('/approvals?summary=1',f.mgr);
 assert(inbox.data.items.some((i:any)=>i.id===first.data.id&&i.title.includes('Xin sửa')));assert.equal(summary.data.counts.quote,inbox.data.counts.quote);
 assert.equal((await f.decide(first.data.id)).status,200);assert.equal((await f.decide(first.data.id)).data.replayed,true);
 assert.equal((await f.decide(first.data.id,'rejected',1,'Đã duyệt trước')).status,409);
 assert.equal((await f.call('/approvals',f.mgr)).data.items.some((i:any)=>i.id===first.data.id),false);
 const granted=(await f.call(f.path,f.emp)).data;assert.equal(granted.editRequest.canEditApproved,true);
 const input={...granted.data,rows:granted.data.rows.map((r:any)=>({...r,price:120000,costMode:'manual',costPrice:1}))};
 const saved=await f.call(f.path,f.emp,'PUT',{revision:1,data:input});assert.equal(saved.status,200,JSON.stringify(saved.data));
 assert.equal(saved.data.revision,2);assert.equal(saved.data.approvalStatus,'draft');assert.equal(saved.data.approvalRevoked,true);
 const privateView=(await f.call(f.path,f.mgr)).data;assert.equal(privateView.data.rows[0].costPrice,30000,'staff cannot alter private costs');
 assert.equal(privateView.editRequest.pending.length,0);assert.equal((await f.call(f.path,f.emp,'PUT',{revision:1,data:input})).status,409);
 assert.equal((await f.call(f.path+'/submit',f.emp,'POST',{revision:2})).status,200);
 assert.equal((await f.call(f.path+'/approve',f.mgr,'POST',{revision:2})).status,200);
 assert.equal((await f.call(f.path,f.emp,'PUT',{revision:2,data:input})).data.code,'QUOTE_APPROVED','old grant cannot edit a newly approved revision');
 const notices=await f.db.select().from(webNotifications);
 assert.equal(notices.filter(n=>n.eventType==='quote_edit_requested').length,1);
 assert.equal(notices.filter(n=>n.eventType==='quote_edit_decided'&&n.targetMemberId==='emp').length,1);
});

test('no permission bypass: pending request, delegated approver, other employee, view-only share and supplier',async()=>{
 const f=await setup();const r=await f.request();
 assert.equal((await f.call(f.path,f.emp,'PUT',{revision:1,data:doc(120000)})).data.code,'QUOTE_APPROVED');
 for(const who of [f.emp,f.other,f.ncc])assert.equal((await f.call(f.path+`/edit-request/${r.data.id}/decision`,who,'POST',{revision:1,decision:'approved'})).status,403);
 assert.equal((await f.request(f.other)).status,404);
 await f.db.insert(quoteShares).values({id:'view',quoteId:f.id,targetType:'member',targetId:'off',permission:'view',createdBy:'mgr',createdAt:new Date().toISOString()});
 assert.equal((await f.call(f.path,f.other)).status,200);assert.equal((await f.request(f.other)).status,404);
 await f.db.update(quoteShares).set({permission:'edit'}).where(eq(quoteShares.id,'view'));
 assert.equal((await f.decide(r.data.id)).status,200);
 assert.equal((await f.call(f.path,f.other)).data.editRequest.canEditApproved,false);
 assert.equal((await f.call(f.path,f.other,'PUT',{revision:1,data:doc(120000)})).data.code,'QUOTE_APPROVED');
 assert.equal((await f.call(f.path,'','GET')).status,401);
});

test('reject requires a reason, keeps approved contents locked, and permits an explicit new request',async()=>{
 const f=await setup(),r=await f.request();
 assert.equal((await f.decide(r.data.id,'rejected')).status,400);
 assert.equal((await f.decide(r.data.id,'rejected',1,'Giữ giá đã thống nhất')).status,200);
 const after=(await f.call(f.path,f.emp)).data;assert.equal(after.editRequest.mine.status,'rejected');assert.equal(after.editRequest.canEditApproved,false);assert.equal(after.approvalStatus,'approved');
 assert.equal((await f.call(f.path,f.emp,'PUT',{revision:1,data:doc(120000)})).status,403);
 const next=await f.request();assert.notEqual(next.data.id,r.data.id);assert.equal(next.data.replayed,false);
 await f.db.update(employees).set({active:false}).where(eq(employees.id,'emp'));
 assert.equal((await f.decide(next.data.id)).status,409);
 assert.equal((await f.decide(next.data.id,'rejected',1,'Nhân viên đã ngừng làm')).status,200,'Manager can close a request after employee deactivation');
});

test('Manager save invalidates requests/grants by revision; stale decisions and cross-quote ids fail',async()=>{
 const f=await setup(),r=await f.request();
 const otherQuote=await f.call('/quotes',f.mgr,'POST',{...doc(),quoteNo:'B2B_OTHER'});
 assert.equal((await f.call(`/quotes/${otherQuote.data.id}/edit-request/${r.data.id}/decision`,f.mgr,'POST',{revision:1,decision:'approved'})).status,409);
 assert.equal((await f.decide(r.data.id)).status,200);
 assert.equal((await f.call(f.path,f.mgr,'PUT',{revision:1,data:doc(130000)})).status,200);
 assert.equal((await f.call(f.path,f.emp)).data.editRequest.canEditApproved,false);
 assert.equal((await f.decide(r.data.id,'approved',2)).status,409);
 assert.equal((await f.call(f.path,f.emp,'PUT',{revision:2,data:doc(140000)})).status,403);
 assert.equal((await f.request(f.emp,1)).status,409);assert.equal((await f.request(f.emp,2)).status,200);
});

test('approved linked order blocks requests, and a later order approval still blocks an earlier grant',async()=>{
 const f=await setup();
 await f.db.insert(salesOrders).values({id:'linked',orderNo:'DH_EDIT',quoteId:f.id,quoteType:'B2B',customerName:'Khách thử',ownerId:'emp',createdBy:'emp',orderDate:'2026-11-17',status:'draft',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 const r=await f.request();assert.equal(r.status,200);assert.equal((await f.decide(r.data.id)).status,200);
 await f.db.update(salesOrders).set({status:'confirmed'}).where(eq(salesOrders.id,'linked'));
 const save=await f.call(f.path,f.emp,'PUT',{revision:1,data:doc(120000)});assert.equal(save.status,409);assert.equal(save.data.code,'ORDER_APPROVED');
 assert.equal((await f.request()).data.code,'ORDER_APPROVED');
 assert.equal((await f.call(f.path,f.mgr)).data.revision,1,'failed save leaves quote and permission unchanged');
});

test('revoking a shared edit permission also revokes access to an already approved edit grant',async()=>{
 const f=await setup();
 await f.db.insert(quoteShares).values({id:'edit',quoteId:f.id,targetType:'member',targetId:'off',permission:'edit',createdBy:'mgr',createdAt:new Date().toISOString()});
 const r=await f.request(f.other);assert.equal(r.status,200);assert.equal((await f.decide(r.data.id)).status,200);
 await f.db.update(quoteShares).set({permission:'view'}).where(eq(quoteShares.id,'edit'));
 assert.equal((await f.call(f.path,f.other)).data.canEdit,false);
 assert.equal((await f.call(f.path,f.other,'PUT',{revision:1,data:doc(120000)})).status,409);
});

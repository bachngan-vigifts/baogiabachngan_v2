import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createTestDb} from '../helpers/postgres.ts';
import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {setupWarehouseOps} from '../helpers/warehouse-approval-fixture.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {canEditQuotation,canShareQuotation,canReassignQuotation,quotationEditScope} from '../../src/modules/quotes/domain/access.ts';
async function fixture(contract=false){
 const f=await setupWarehouseOps();
 const q=await f.call('/quotes',f.emp,'POST',{type:'HRC',quoteNo:'HANDOFF',date:'2026-11-21',customer:'Khách kiểm thử',customerTaxCode:'1800000001',vat:8,rows:[{sku:'00123',name:'Ly',unit:'Cái',qty:2,price:1000}]});assert.equal(q.status,201,JSON.stringify(q.data));
 assert.equal((await f.call('/quotes/'+q.data.id+'/approve',f.mgr,'POST',{revision:1})).status,200);
 const o=await f.call(contract?'/contracts':'/orders',f.emp,'POST',{quoteId:q.data.id,warehouseId:'pos-wh',pushSapo:false,...(contract?{legalEntity:'BN'}:{})});assert.equal(o.status,201,JSON.stringify(o.data));
 return {...f,qid:q.data.id,oid:o.data.orderId||o.data.id,path:'/orders/'+(o.data.orderId||o.data.id)+'/sale-admin-assignment'};
}
test('giao và bỏ giao là độc lập, giữ người bán; retry không ghi trùng, stale khác đích bị chặn',async()=>{
 const f=await fixture(),before=(await f.call('/orders/'+f.oid,f.mgr)).data.order;
 const metadata=await f.call(f.path,f.emp);assert.equal(metadata.status,200);assert.equal(metadata.data.canAssign,true);assert.ok(metadata.data.candidates.some((p:any)=>p.id==='ops-admin'&&p.eligible));
 assert.equal((await f.call('/orders/'+f.oid,f.sa)).data.order.canEdit,false);
 const assign=await f.call(f.path,f.emp,'POST',{assigneeId:'ops-admin',revision:0});assert.equal(assign.status,200,JSON.stringify(assign.data));assert.equal(assign.data.revision,1);
 const after=(await f.call('/orders/'+f.oid,f.sa)).data.order;assert.equal(after.canEdit,true);assert.equal(after.ownerId,before.ownerId);assert.equal(after.createdBy,before.createdBy);
 const source=await f.call('/quotes/'+f.qid,f.sa);assert.equal(source.status,200);assert.equal(source.data.editRequest.canEditApproved,true);
 const changed=await f.call('/quotes/'+f.qid,f.sa,'PUT',{revision:source.data.revision,data:{...source.data.data,note:'Sale Admin xử lý'}});assert.equal(changed.status,200,JSON.stringify(changed.data));assert.equal((await f.call('/quotes/'+f.qid,f.mgr)).data.approvalStatus,'draft');
 const q=(await f.db.select().from(quotations).where(eq(quotations.id,f.qid)))[0]!;assert.equal(q.assigneeId,'emp');assert.equal(q.creatorId,'emp');
 assert.equal((await f.call(f.path,f.emp,'POST',{assigneeId:'ops-admin',revision:0})).data.replayed,true);
 assert.equal((await f.call(f.path,f.emp,'POST',{assigneeId:null,revision:0})).status,409);
 assert.equal((await f.call(f.path,f.emp,'POST',{assigneeId:null,revision:1})).status,200);
 assert.equal((await f.call('/orders/'+f.oid,f.sa)).data.order.canEdit,false);
 assert.equal((await f.call(f.path,f.emp,'POST',{assigneeId:null,revision:2})).data.revision,3,'Không giao cũng là lựa chọn được lưu');
});
test('chặn người nhận sai vai trò, người gọi không có quyền; giao không mở quyền huỷ/duyệt',async()=>{
 const f=await fixture();
 for(const assigneeId of ['mgr','emp','ncc','missing'])assert.equal((await f.call(f.path,f.emp,'POST',{assigneeId,revision:0})).status,400);
 assert.equal((await f.call(f.path,f.sa,'POST',{assigneeId:'ops-admin',revision:0})).status,403);
 await f.db.update(employees).set({active:false}).where(eq(employees.id,'ops-admin'));assert.equal((await f.call(f.path,f.emp,'POST',{assigneeId:'ops-admin',revision:0})).status,400);
 await f.db.update(employees).set({active:true,deletedAt:new Date().toISOString()}).where(eq(employees.id,'ops-admin'));assert.equal((await f.call(f.path,f.emp,'POST',{assigneeId:'ops-admin',revision:0})).status,400);
 await f.db.update(employees).set({deletedAt:null}).where(eq(employees.id,'ops-admin'));
 assert.equal((await f.call(f.path,f.emp,'POST',{assigneeId:'ops-admin',revision:0})).status,200);
 assert.equal((await f.call('/orders/'+f.oid+'/status',f.sa,'PUT',{status:'cancelled'})).status,403);
 assert.equal((await f.call('/quotes/'+f.qid+'/approve',f.sa,'POST',{revision:1})).status,403);
 await f.db.update(employees).set({positionId:'sales-ml'}).where(eq(employees.id,'ops-admin'));
 assert.equal((await f.call('/orders/'+f.oid,f.sa)).data.order?.canEdit??false,false,'đổi chức vụ thu hồi quyền giao');
});
test('quyền giao chỉ theo đúng hồ sơ/role; không cho chia sẻ, giao lại hoặc xoá bằng scope edit hạn chế',()=>{
 const m={id:'sa',role:'employee' as const,positionId:'sale-admin',active:true},q={id:'q',creatorId:'seller',assigneeId:'seller',supportAssigneeId:'sa'};
 assert.equal(canEditQuotation(m,q),true);assert.equal(canShareQuotation(m,q),false);assert.equal(canReassignQuotation(m,q),false);
 assert.equal(canEditQuotation({...m,active:false},q),false);assert.equal(canEditQuotation({...m,positionId:'sales-lock'},q),false);assert.equal(canEditQuotation(m,{...q,supportAssigneeId:null}),false);
 assert.match(quotationEditScope(m).sql,/support_assignee_id/);assert.doesNotMatch(quotationEditScope(m,false).sql,/support_assignee_id/);
});

test('HĐKT kế thừa người xử lý từ báo giá; sửa nháp được, không tự huỷ và không đổi người bán',async()=>{
 const f=await fixture(true);
 assert.equal((await f.call(f.path,f.emp,'POST',{assigneeId:'ops-admin',revision:0})).status,200);
 const d=(await f.call('/orders/'+f.oid,f.sa)).data;assert.equal(d.contract.canEdit,true);assert.equal(d.contract.canEditFinancial,false);
 const edited=await f.call('/contracts/'+d.contract.id,f.sa,'PUT',{revision:d.contract.revision,deliveryAddress:'Địa chỉ xử lý mới'});assert.equal(edited.status,200,JSON.stringify(edited.data));
 assert.equal((await f.call('/contracts/'+d.contract.id,f.sa,'PUT',{status:'cancelled'})).status,403);
 assert.equal((await f.call('/orders/'+f.oid,f.mgr)).data.order.ownerId,'emp');
});

test('hai thao tác giao khác nhau cùng phiên bản: chỉ một thắng, không ghi đè lựa chọn mới',async()=>{
 const f=await fixture();const results=await Promise.all([f.call(f.path,f.emp,'POST',{assigneeId:'ops-admin',revision:0}),f.call(f.path,f.emp,'POST',{assigneeId:null,revision:0})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await f.call(f.path,f.emp)).data.revision,1);
});

test('schema guard chạy chỉ đọc và chặn thiếu FK mà không tự sửa schema',async()=>{
 const {client}=await createTestDb(),gate=readFileSync(new URL('../../scripts/sql/assert-sale-admin-handoff.sql',import.meta.url),'utf8');
 await client.exec('BEGIN READ ONLY;'+gate+'ROLLBACK;');
 await client.exec('ALTER TABLE staff_quotations DROP CONSTRAINT staff_quotations_support_assignee_id_fkey');
 await assert.rejects(client.exec(gate),/Missing Sale Admin handoff foreign key/);
});

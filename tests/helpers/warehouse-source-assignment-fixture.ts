import assert from 'node:assert/strict';
import {eq} from 'drizzle-orm';
import {homeFixture} from './home-fixture.ts';
import {warehouses} from '../../src/modules/catalog/schema.ts';
import {warehouseSellers} from '../../src/modules/inventory/schema.ts';
import {salesOrders,packingSlips} from '../../src/modules/sales/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {warehouseWorkRuns as runs} from '../../src/modules/warehouse-workspace/schema.ts';
const ok=(r:any,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
export async function sourceAssignmentFixture(){
 const f=await homeFixture(),at=new Date().toISOString();
 await f.db.insert(employees).values({id:'wh2',name:'Kho B',email:'wh2@test.invalid',role:'employee',positionId:'warehouse',createdAt:'2026-01-01T00:00:00Z'});
 await f.client.query("insert into staff_credentials(member_id,password_hash,version) select 'wh2',password_hash,0 from staff_credentials where member_id='wh'");
 const wh2=(await f.call('/login','','POST',{email:'wh2@test.invalid',password:'mat-khau-12345'})).cookie;
 await f.db.insert(warehouses).values({id:'source-wh',name:'Kho nguồn thử',kind:'stock'});
 await f.db.insert(warehouseSellers).values({warehouseId:'source-wh',positionId:'warehouse'});
 await f.db.update(salesOrders).set({warehouseId:'source-wh',expectedDeliveryDate:f.today}).where(eq(salesOrders.id,'liq-order'));
 await f.db.insert(packingSlips).values({id:'source-slip',slipNo:'DG_SOURCE_TEST',orderId:'liq-order',status:'sent',source:'warehouse',createdBy:'emp',createdAt:at,updatedAt:at});
 ok(await f.call('/warehouse-workspace/settings',f.cookies.mgr,'PUT',{calendar:{days:[0,1,2,3,4,5,6],start:'00:00',end:'23:59',breakStart:'',breakEnd:''},bonusBudget:1000000,revision:0,reason:'Ca thử định mức'}));
 const sync=ok(await f.call('/warehouse-workspace/source-sync',f.cookies.mgr,'POST',{type:'packing',id:'source-slip'}));
 assert.equal(sync.taskIds.length,1);const id=sync.taskIds[0];
 const options=()=>f.call('/warehouse-workspace/assignment-options?taskId='+id,f.cookies.mgr).then(ok);
 const dueAt=new Date(Date.now()+86400000).toISOString();
 const request=async(mode='single')=>{const o=await options(),members=mode==='single'?[{memberId:o.recommended,part:'Kiểm đếm và bàn giao',standardMinutes:30,units:1}]:o.people.map((p:any)=>({memberId:p.id,part:p.id==='wh'?'Soạn hàng':'Đóng gói',standardMinutes:20,units:1}));return{mode,leadId:o.recommended,members,taskRevision:o.tasks[0].taskRevision,dueAt,reason:'Định mức và hạn phần việc đã duyệt'};};
 const assign=(body:any,cookie=f.cookies.mgr)=>f.call('/warehouse-workspace/'+id+'/assign',cookie,'POST',body);
 const row=async(id:string)=>(await f.db.select().from(runs).where(eq(runs.taskId,id)))[0]!;
 const act=async(id:string,action:string,cookie:string,extra:any={})=>f.call('/warehouse-workspace/'+id+'/action',cookie,'POST',{action,revision:(await row(id))?.revision,...extra});
 return{...f,cookies:{...f.cookies,wh:f.cookies.wh!,mgr:f.cookies.mgr!,emp:f.cookies.emp!},wh2,id,options,request,assign,row,act};
}

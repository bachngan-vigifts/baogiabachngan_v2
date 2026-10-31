import {eq} from 'drizzle-orm';
import {createTestDb} from './postgres.ts';
import {seedStaff,PASSWORD} from './staff-fixture.ts';
import {createAppRouter} from '../../src/app/router.ts';
import {memoryFileStore} from '../../src/core/storage/file-store.ts';
import {salesOrders,salesContracts,salesOrderLines,customerPayments} from '../../src/modules/sales/schema.ts';
import type {StaffEnv} from '../../src/modules/staff/api/auth-routes.ts';
export const proofPhoto='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG9kAAAAASUVORK5CYII=';
export async function setupLiquidation(){
 const {db,d1,client}=await createTestDb();await seedStaff(d1);await client.query("update staff_credentials set password_hash=(select password_hash from staff_credentials where member_id='emp') where member_id='new'");await client.query("insert into staff_positions(id,name,data_scope) values('liquidation-outsider','Nhân viên riêng','own')");await client.query("insert into staff_position_permissions(position_id,permission) values('liquidation-outsider','page.contracts'),('liquidation-outsider','page.orders'),('liquidation-outsider','page.tasks')");await client.query("update staff_members set position_id='liquidation-outsider' where id='new'");const router=createAppRouter(),files=memoryFileStore(),env:StaffEnv={db,files,passwordIterations:1000,sapoOrderPush:'off'};
 const origin='https://liquidation.test';
 const call=async(path:string,cookie='',method='GET',body?:unknown)=>{const response=await router.handle(new Request(origin+'/api/staff'+path,{method,headers:{origin,cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);return{status:response.status,data:await response.json() as any,cookie:response.headers.get('set-cookie')?.split(';')[0]||''};};
 const login=async(email:string)=>(await call('/login','','POST',{email,password:PASSWORD})).cookie;
 const mgr=await login('mgr@x.vn'),emp=await login('emp@x.vn'),other=await login('new@x.vn'),ncc=await login('ncc@x.vn'),stamp='2026-10-31T01:00:00Z';
 await db.insert(salesOrders).values({id:'liq-order',orderNo:'HD-DEMO',quoteType:'HRC',customerName:'Khách thử thanh lý',ownerId:'emp',createdBy:'emp',orderDate:'2026-10-31',status:'confirmed',total:100,subtotal:100,createdAt:stamp,updatedAt:stamp});
 await db.insert(salesContracts).values({id:'liq-contract',contractNo:'HDKT-DEMO',orderId:'liq-order',legalEntity:'BN',status:'signed',signedDate:'2026-10-31',value:100,createdBy:'emp',createdAt:stamp,updatedAt:stamp});
 await db.insert(salesOrderLines).values({id:'liq-service',orderId:'liq-order',lineNo:1,sku:'',name:'Dịch vụ hoàn tất',qty:1,unitPrice:100,amount:100});
 await db.insert(customerPayments).values({id:'liq-paid',orderId:'liq-order',amount:100,paidAt:'2026-10-31',method:'transfer',createdBy:'mgr',createdAt:stamp});
 const path='/contracts/liq-contract/liquidation';
 const request=async(key=crypto.randomUUID(),who=emp,overrides:Record<string,unknown>={})=>{const view=await call(path,who);return call(path,who,'POST',{clientKey:key,originalsReceived:true,servicesCompleted:true,photos:[proofPhoto],expectedHash:view.data.proof?.hash,...overrides});};
 return{db,client,env,files,call,mgr,emp,other,ncc,path,request,stamp};
}

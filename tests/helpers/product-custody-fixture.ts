import {setupWarehouseWork} from './warehouse-work-fixture.ts';
import {customers,customerStaff} from '../../src/modules/customers/schema.ts';
import {createAppRouter} from '../../src/app/router.ts';
import {memoryFileStore} from '../../src/core/storage/file-store.ts';
export async function setupCustody(){
 const f=await setupWarehouseWork();await f.db.insert(customers).values({id:'custody-customer',name:'Khách mượn mẫu',contact:'Liên hệ',phone:'',email:'',address:'',search:'khach muon mau',approvalStatus:'approved',sourceVersion:0,syncedAt:''});await f.db.insert(customerStaff).values({customerId:'custody-customer',memberId:'emp',role:'shared',createdBy:'mgr',createdAt:new Date().toISOString()});
 const files=memoryFileStore(),router=createAppRouter(),env={db:f.db,files,passwordIterations:1000,sapoOrderPush:'off' as const};
 const call=async(path:string,cookie='',method='GET',body?:unknown)=>{const response=await router.handle(new Request('https://trial.test/api/staff'+path,{method,headers:{origin:'https://trial.test',cookie,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);return{status:response.status,data:await response.json() as any};};return{...f,call,files};
}

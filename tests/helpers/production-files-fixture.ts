import {createTestDb} from './postgres.ts';
import {seedStaff,PASSWORD} from './staff-fixture.ts';
import {createAppRouter} from '../../src/app/router.ts';
import type {StaffEnv} from '../../src/modules/staff/api/auth-routes.ts';
import {customers} from '../../src/modules/customers/schema.ts';
import {AppError} from '../../src/core/errors.ts';
import type {ProductionDrive} from '../../src/core/storage/production-drive.ts';
export const PDF=new TextEncoder().encode('%PDF-1.7\nproduction fixture\n%%EOF');
export async function productionFixture(){
 const {db,d1,client}=await createTestDb();await seedStaff(d1);const router=createAppRouter();
 await client.query("insert into staff_members(id,email,name,phone,role,position_id,active,created_at) values('other','other@x.vn','Khác','','employee','sale',true,'2026-01-01')");await client.query("insert into staff_credentials(member_id,password_hash,version) select 'other',password_hash,0 from staff_credentials where member_id='emp'");
 await client.query("insert into staff_positions(id,name,data_scope) values('isolated_sale','Sale khác chi nhánh','own')");await client.query("insert into staff_position_permissions(position_id,permission) values('isolated_sale','page.quotes'),('isolated_sale','page.orders'),('isolated_sale','page.contracts')");await client.query("update staff_members set position_id='isolated_sale' where id='other'");
 const remote=new Map<string,Uint8Array>();let seq=0,failAfterWrite=false;const calls:string[]=[];
 const drive:ProductionDrive={async reserveId(){return'fixture_drive_'+String(++seq).padStart(10,'0');},async ensureFolder(){calls.push('folder');},async put(id,_parent,_name,bytes){calls.push('put');remote.set(id,new Uint8Array(bytes));if(failAfterWrite){failAfterWrite=false;throw new AppError(503,'Chưa rõ phản hồi Drive','DRIVE_UNCERTAIN');}},async read(id){calls.push('read');return new Response(remote.get(id) as BodyInit);}};
 const env:StaffEnv={db,passwordIterations:1000,sapoOrderPush:'off',productionDrive:drive};
 const request=async(path:string,cookie='',method='GET',body?:unknown,binary=false)=>router.handle(new Request('https://fixture.test/api/staff'+path,{method,headers:{origin:'https://fixture.test',cookie,'content-type':binary?'application/octet-stream':'application/json'},body:body===undefined?undefined:binary?body as BodyInit:JSON.stringify(body)}),env);
 const call=async(path:string,cookie='',method='GET',body?:unknown)=>{const r=await request(path,cookie,method,body);return{status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};};
 const cookies:Record<string,string>={};for(const id of ['mgr','emp','other','ncc'])cookies[id]=(await call('/login','','POST',{email:id+'@x.vn',password:PASSWORD})).cookie;
 await db.insert(customers).values({id:'customer',name:'Khách thử',contact:'Khách',phone:'0900',email:'',address:'Địa chỉ thử',taxCode:'0101234567',customerCode:'TEST',sourceVersion:0,syncedAt:'',search:''});
 async function quote(options:Record<string,unknown>={}){const r=await call('/quotes',cookies.emp,'POST',{type:'B2B',quoteNo:'B2B_'+crypto.randomUUID().slice(0,8),customer:'Khách thử',customerId:'customer',vat:8,rows:[{name:'Ly thử',sku:'TEST-SKU',qty:2,price:100000,printFee:1000}],...options});if(r.status!==201)throw Error(JSON.stringify(r));let revision=1;if(options.template==='sale'){const v=await call('/quotes/'+r.data.id,cookies.mgr);v.data.data.rows.forEach((row:any)=>Object.assign(row,{costPrice:50000,supplierInfo:'NCC thử'}));const saved=await call('/quotes/'+r.data.id,cookies.mgr,'PUT',{revision,data:v.data.data});revision=saved.data.revision;}const approved=await call('/quotes/'+r.data.id+'/approve',cookies.mgr,'POST',{revision});if(approved.status!==200)throw Error(JSON.stringify(approved));const view=await call('/quotes/'+r.data.id,cookies.emp);return{id:r.data.id,revision:view.data.revision,data:view.data.data};}
 async function upload(q:{id:string;revision:number},bytes=PDF,key=crypto.randomUUID(),cookie=cookies.emp,name='san-xuat.pdf'){const r=await request('/quotes/'+q.id+'/production-files/'+key+'?'+new URLSearchParams({name,revision:String(q.revision)}),cookie,'PUT',bytes,true);return{status:r.status,data:await r.json() as any};}
 return{db,client,env,cookies,call,request,quote,upload,remote,calls,loseNextReply(){failAfterWrite=true;}};
}

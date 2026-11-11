import {createTestDb} from './postgres.ts';
import {seedStaff,PASSWORD} from './staff-fixture.ts';
import {createAppRouter} from '../../src/app/router.ts';
import {products,warehouses,productStock,pricePolicies,productPrices} from '../../src/modules/catalog/schema.ts';
export async function multiBrandFixture(){
 const {db,d1,client}=await createTestDb();await seedStaff(d1);const router=createAppRouter(),background=new Set<Promise<unknown>>(),env={db,passwordIterations:1000,sapoOrderPush:'off' as const,waitUntil(p:Promise<unknown>){background.add(p);p.catch(()=>{}).finally(()=>background.delete(p));}};
 const call=async(path:string,cookie='',method='GET',body?:unknown)=>{const r=await router.handle(new Request('https://fixture.test/api/staff'+path,{method,headers:{origin:'https://fixture.test',cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);return{status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};};
 await client.query("insert into staff_members(id,email,name,phone,role,position_id,active,created_at) values('wh','wh@x.vn','Kho thử','','employee','warehouse',true,'2026-01-01')");await client.query("insert into staff_credentials(member_id,password_hash,version) select 'wh',password_hash,0 from staff_credentials where member_id='emp'");
 const cookies:Record<string,string>={};for(const id of ['mgr','emp','ncc','wh'])cookies[id]=(await call('/login','','POST',{email:id+'@x.vn',password:PASSWORD})).cookie;
 const at=new Date().toISOString(),brands=['Minh Long','Lock&Lock','Gốm, quà & "Đẹp"'];
 await db.insert(products).values([...Array.from({length:31},(_,i)=>({sku:'A'+i,name:'Bình minh họa A'+i,brand:brands[0],unit:'Cái',updatedAt:at})),...Array.from({length:27},(_,i)=>({sku:'B'+i,name:'Bình minh họa B'+i,brand:brands[1],unit:'Cái',updatedAt:at})),...Array.from({length:3},(_,i)=>({sku:'C'+i,name:'Bộ quà minh họa C'+i,brand:brands[2],updatedAt:at})),{sku:'D',name:'Hàng khác',brand:'Khác',updatedAt:at},{sku:'U',name:'Chưa có thương hiệu',brand:'',updatedAt:at},{sku:'OLD',name:'Hàng ngừng bán',brand:brands[0],active:false,updatedAt:at}]);
 await db.insert(warehouses).values([{id:'public',name:'KHO VIGIFTS'},{id:'private',name:'Kho riêng',stockPrivate:true},{id:'supplier',name:'NCC',kind:'supplier'}]);
 await db.insert(productStock).values([{sku:'A0',warehouseId:'public',quantity:12,updatedAt:at},{sku:'B0',warehouseId:'public',quantity:4,updatedAt:at},{sku:'C0',warehouseId:'public',quantity:8,updatedAt:at},{sku:'A0',warehouseId:'private',quantity:999,updatedAt:at},{sku:'B0',warehouseId:'private',quantity:500,updatedAt:at},{sku:'A1',warehouseId:'supplier',quantity:1000,updatedAt:at}]);
 await db.insert(pricePolicies).values({id:'retail',name:'Giá niêm yết'});await db.insert(productPrices).values([{sku:'A0',policyId:'retail',price:0},{sku:'B0',policyId:'retail',price:200000}]);
 return{db,client,call,cookies,brands,background};
}

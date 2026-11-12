import { createTestDb } from './postgres.ts';
import { seedStaff, PASSWORD } from './staff-fixture.ts';
import { hashPassword } from '../../src/core/auth/password.ts';
import { createAppRouter } from '../../src/app/router.ts';
import { incomingShipments, incomingShipmentLines, suppliers, supplierAccounts, supplierOrderEvents } from '../../src/modules/suppliers/schema.ts';
import type {FileStore} from '../../src/core/storage/file-store.ts';
export async function setupEarly({files}:{files?:FileStore}={}) {
  const s=await createTestDb();await seedStaff(s.d1);const now='2026-10-21T00:00:00Z',pw=await hashPassword(PASSWORD,1000);
  for(const [id,pos,role] of [['sa','sale-admin','employee'],['kho','warehouse','employee'],['kt','accounting','employee'],['ncc2','supplier','supplier'],['unmapped','supplier','supplier']] as const) {
    await s.d1.sqlite.prepare("insert into staff_members(id,email,name,phone,role,position_id,active,created_at) values (?,?,?,'',?,?,1,?)").run(id,id+'@x.vn',id,role,pos,now);
    await s.d1.sqlite.prepare('insert into staff_credentials(member_id,password_hash,version) values(?,?,0)').run(id,pw);
  }
  await s.db.insert(suppliers).values(['a','b'].map(id=>({id,name:'NCC '+id,nameKey:id,createdAt:now,createdBy:'mgr',updatedAt:now})));
  await s.db.insert(supplierAccounts).values([{memberId:'ncc',supplierId:'a',createdAt:now,createdBy:'mgr'},{memberId:'ncc2',supplierId:'b',createdAt:now,createdBy:'mgr'}]);
  for(const [id,qty,supplierId,due,sku] of [['a1',8000,'a','2026-10-20','031106000'],['a2',7000,'a','2026-10-22','031106000'],['b1',5000,'b','2026-10-24','031106000'],['excel',10,'b','2026-10-29','01654020803']] as const) {
    await s.db.insert(incomingShipments).values({id,ticketNumber:'PO-'+id,source:'supplier-order',warehouse:'Kho',supplierId,supplierName:'NCC '+supplierId,approvalStatus:'approved',arrivalDate:due,createdAt:now,createdBy:'mgr',updatedAt:now});
    await s.db.insert(incomingShipmentLines).values({id:'line-'+id,shipmentId:id,lineNo:1,sku,name:'Hàng '+sku,unit:'Cái',quantity:qty,promisedDate:due});
  }
  await s.db.insert(supplierOrderEvents).values({id:'import',shipmentId:'excel',actorId:'mgr',at:now,action:'import',summary:'Nhập Excel'});
  const router=createAppRouter(),env={db:s.db,files,passwordIterations:1000,sapoOrderPush:'off' as const};
  const call=async(path:string,cookie='',method='GET',body?:unknown)=>{
    const r=await router.handle(new Request('https://trial.test/api/staff'+path,{method,headers:{origin:'https://trial.test',cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);
    return {status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
  };
  const cookies:Record<string,string>={};for(const id of ['mgr','sa','emp','kho','kt','ncc','ncc2','unmapped']) cookies[id]=(await call('/login','','POST',{email:id+'@x.vn',password:PASSWORD})).cookie;
  return {...s,call,cookies};
}

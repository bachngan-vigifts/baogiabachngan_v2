import { setupLiquidation } from './liquidation-fixture.ts';
import { tasks } from '../../src/modules/tasks/schema.ts';
import { webNotifications } from '../../src/modules/notifications/schema.ts';
import { vietnamDate } from '../../src/modules/sales/domain/sales.ts';
import { PASSWORD } from './staff-fixture.ts';

/** Isolated CRM fixture; no production accounts or network. */
export async function homeFixture() {
  const f = await setupLiquidation(), today = vietnamDate().iso, at = today + 'T02:00:00Z';
  const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0,10);
  for (const [id, position] of [['wh','warehouse'],['acct','accounting'],['counter','sales-lock'],['admin','sale-admin'],['restricted','liquidation-outsider']] as const) {
    await f.client.query('insert into staff_members(id,email,name,phone,role,position_id,active,created_at) values($1,$2,$3,\'\',\'employee\',$4,true,$5)', [id,id+'@x.vn','Kiểm thử '+id,position,at]);
    await f.client.query('insert into staff_credentials(member_id,password_hash,version) select $1,password_hash,0 from staff_credentials where member_id=\'emp\'', [id]);
  }
  await f.db.insert(tasks).values([
    {id:'home-late',title:'Xác nhận lịch giao hàng',assigneeId:'emp',dueDate:yesterday,source:'delivery',link:'#/deliveries',createdBy:'mgr',createdAt:at,updatedAt:at},
    {id:'home-today',title:'Gọi chăm sóc khách hàng',assigneeId:'emp',dueDate:today,dueTime:'09:30',source:'care',link:'#/care',createdBy:'mgr',createdAt:at,updatedAt:at},
    {id:'home-later',title:'Kiểm tra báo giá khách hàng',assigneeId:'emp',dueDate:today,source:'manual',createdBy:'mgr',createdAt:at,updatedAt:at},
    {id:'home-private',title:'VIỆC RIÊNG KHÔNG ĐƯỢC LỘ',description:'THÔNG TIN RIÊNG',assigneeId:'new',createdBy:'new',dueDate:yesterday,createdAt:at,updatedAt:at},
    {id:'home-team',title:'Nhận hàng cho kho',assigneePosition:'warehouse',source:'purchase',createdAt:at,updatedAt:at},
    {id:'home-manager',title:'Duyệt công việc quản lý',assigneeId:'mgr',source:'manual',createdAt:at,updatedAt:at},
    {id:'home-done',title:'Việc đã xong',status:'done',assigneeId:'emp',dueDate:yesterday,createdAt:at,updatedAt:at},
  ] as never);
  await f.db.insert(webNotifications).values({id:'home-note',title:'Có việc cần xử lý',body:'Thông báo kiểm thử',eventType:'task_assigned',url:'/index.html#/tasks/home-today',targetMemberId:'emp',createdAt:at});
  const cookies: Record<string,string>={mgr:f.mgr,emp:f.emp,ncc:f.ncc,other:f.other};
  for(const id of ['wh','acct','counter','admin','restricted'])cookies[id]=(await f.call('/login','','POST',{email:id+'@x.vn',password:PASSWORD})).cookie;
  // Match Edge waitUntil: automatic task reconciliation must not block API response measurements.
  const background=new Set<Promise<unknown>>();f.env.waitUntil=p=>{background.add(p);p.catch(()=>{}).finally(()=>background.delete(p));};
  return {...f,cookies,today,yesterday,background};
}

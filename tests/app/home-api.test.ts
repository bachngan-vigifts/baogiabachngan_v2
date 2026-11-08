import { contractTest as test, assert } from '../TEST_TEMPLATE.ts';
import { homeFixture } from '../helpers/home-fixture.ts';
import { tasks } from '../../src/modules/tasks/schema.ts';
import { sql } from 'drizzle-orm';
const ok=(r:{status:number;data:any})=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
test('Home: own/team scope reused, counts match all open rows, 5-row cap, overdue first; not based on latest 500 tasks',async()=>{
 const f=await homeFixture();
 // Background reconciliation is separate and never supplies the fixture's manually assigned rows.
 const before=await f.db.select().from(tasks),emp=ok(await f.call('/tasks/home',f.emp));
 assert.equal(emp.scope,'mine');assert.equal(emp.tasks.some((t:any)=>t.id==='home-private'),false);
 assert.equal(emp.tasks[0].id,'home-late');assert.equal(emp.counts.overdue,1);assert.equal(emp.counts.today,2);assert.equal(emp.counts.open,3);
 assert.equal(emp.tasks.some((t:any)=>t.id==='home-done'),false);assert.equal('description' in emp.tasks[0],false);assert.equal('link' in emp.tasks[0],false);
 const stamp=f.today+'T03:00:00Z';await f.db.insert(tasks).values(Array.from({length:550},(_,i)=>({id:'bulk-'+String(i).padStart(3,'0'),title:'Việc kiểm thử '+i,assigneeId:'emp',createdBy:'mgr',createdAt:stamp,updatedAt:stamp})));
 const big=ok(await f.call('/tasks/home',f.emp));assert.equal(big.counts.open,553);assert.equal(big.tasks.length,5);assert.equal(big.hasMore,true);assert.equal(big.tasks[0].id,'home-late');
 const late=ok(await f.call('/tasks/home?filter=overdue&view=all&assignee=new&limit=500',f.emp));assert.equal(late.total,1);assert.deepEqual(late.tasks.map((t:any)=>t.id),['home-late'],'client cannot widen scope');
 const today=ok(await f.call('/tasks/home?filter=today',f.emp));assert.equal(today.total,2);assert.ok(today.tasks.every((t:any)=>t.dueDate===f.today));
 const mgr=ok(await f.call('/tasks/home',f.mgr));assert.equal(mgr.scope,'all');assert.ok(mgr.tasks.some((t:any)=>t.id==='home-private'));
 for(const id of ['wh','acct','counter','admin','restricted']){const d=ok(await f.call('/tasks/home',f.cookies[id]));assert.equal(d.scope,'mine');assert.ok(d.tasks.every((t:any)=>t.id!=='home-private'&&t.id!=='home-late'));if(id==='wh')assert.ok(d.tasks.some((t:any)=>t.id==='home-team'));}
 assert.equal((await f.call('/tasks/home?filter=all%27%20OR%201%3D1',f.emp)).status,400);
 assert.equal((await f.call('/tasks/home','')).status,401);assert.equal((await f.call('/tasks/home',f.ncc)).status,403);
 assert.equal((await f.call('/approvals',f.emp)).status,403,'Home does not grant approval permission');
 await Promise.allSettled([...f.background]);
 const originals=await f.db.select().from(tasks).where(sql`${tasks.id} like 'home-%'`);assert.equal(originals.length,before.filter(t=>t.id.startsWith('home-')).length,'read does not duplicate manual work');
});

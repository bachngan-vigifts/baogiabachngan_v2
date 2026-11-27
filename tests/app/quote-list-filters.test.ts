import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestDb} from '../helpers/postgres.ts';
import {seedStaff,PASSWORD} from '../helpers/staff-fixture.ts';
import {createAppRouter} from '../../src/app/router.ts';
import {quotations} from '../../src/modules/quotes/schema.ts';

test('quote filters combine before pagination/totals and preserve viewer scope',async()=>{
 const {db,d1}=await createTestDb();await seedStaff(d1);
 const router=createAppRouter(),env={db,passwordIterations:1000};
 const call=async(path:string,cookie='',body?:object)=>{
  const r=await router.handle(new Request('https://trial.test/api/staff'+path,{method:body?'POST':'GET',headers:{origin:'https://trial.test','content-type':'application/json',cookie},body:body?JSON.stringify(body):undefined}),env);
  return{status:r.status,data:await r.json() as any,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
 };
 const mgr=(await call('/login','',{email:'mgr@x.vn',password:PASSWORD})).cookie;
 const emp=(await call('/login','',{email:'emp@x.vn',password:PASSWORD})).cookie;
 await db.insert(quotations).values([
  {id:'a',creatorId:'emp',assigneeId:'emp',approvalStatus:'draft' as const,quoteDate:'2026-11-01'},
  {id:'b',creatorId:'emp',assigneeId:'new',approvalStatus:'approved' as const,quoteDate:'2026-11-27'},
  {id:'c',creatorId:'mgr',assigneeId:null,approvalStatus:'approved' as const,quoteDate:'2026-11-27'},
  {id:'d',creatorId:'emp',assigneeId:null,approvalStatus:'pending' as const,quoteDate:'2026-11-28'},
 ].map(x=>({...x,quoteNo:'FILTER-'+x.id,quoteType:'B2B' as const,customer:'Khách thử',data:JSON.stringify({type:'B2B',vat:0,rows:[{name:'Ly',qty:1,price:100}]}),createdAt:'2026-11-27T00:00:00Z',updatedAt:'2026-11-27T00:00:00Z'})));
 const list=async(q:string,cookie=mgr)=>{const r=await call('/quotes?'+q,cookie);assert.equal(r.status,200);return r.data;};
 let r=await list('status=approved&employee=new&from=2026-11-27&to=2026-11-27&limit=1');
 assert.deepEqual(r.quotes.map((q:any)=>q.id),['b']);assert.equal(r.total,1);assert.equal(r.value,100);
 r=await list('status=approved&limit=1');assert.equal(r.quotes.length,1);assert.equal(r.total,2);assert.equal(r.value,200);
 assert.equal((await list('employee=emp')).total,2);
 assert.equal((await list('status=approved&employee=mgr',emp)).total,0);
 assert.ok(!(await list('',emp)).filterEmployees.some((e:any)=>e.id==='mgr'));
 assert.equal((await list('')).total,4);
 for(const q of ['from=2026-02-30','from=2026-11-28&to=2026-11-01','status=cancelled'])assert.equal((await call('/quotes?'+q,mgr)).status,400);
});

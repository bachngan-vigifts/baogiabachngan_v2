import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sql} from 'drizzle-orm';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';
import {purchaseEarlyRequests as requests,purchaseEarlyRequestLines as lines,purchaseEarlyRequestAllocations as allocations} from '../../src/modules/suppliers/early-request-schema.ts';

test('early request index filters all headers before stable pagination, retains whole lines and supplier isolation',async()=>{
 const f=await setupEarly();
  const headers=[],details=[],parts=[];
  for(let i=0;i<55;i++){
   const id='index-'+String(i).padStart(3,'0'),kind=i%5;
   headers.push({id,clientKey:id,payloadHash:'fixture',createdBy:'mgr',createdAt:'2026-10-25T17:30:00.000Z',pickupDate:'2026-10-'+String(21+i%7),status:kind===0?'draft' as const:'submitted' as const});
   const statuses=kind===2?['accepted','accepted']:kind===3?['rejected','rejected']:kind===4?['accepted','rejected']:['pending','accepted'];
   details.push({id:id+'-l1',requestId:id,lineNo:1,sku:'031106000',name:i===3?'Dĩa literal%_duynhat':'Hàng kiểm thử',unit:'Cái',quantity:2},{id:id+'-l2',requestId:id,lineNo:2,sku:'01654020803',name:'Mã thứ hai',unit:'Cái',quantity:1});
   for(const [suffix,line,supplier,purchase,status] of [['a','l1','a','a1',statuses[0]],['b','l1','b','b1',statuses[1]],['c','l2','b','excel',statuses[1]]])parts.push({id:id+'-'+suffix,requestLineId:id+'-'+line,supplierId:supplier!,purchaseLineId:'line-'+purchase,quantity:1,status:status as 'pending'|'accepted'|'rejected'});
  }
  await f.db.insert(requests).values(headers);await f.db.insert(lines).values(details);await f.db.insert(allocations).values(parts);
  const seen:string[]=[];let offset=0;
  do{const r=await f.call('/purchase-early-requests?limit=20&offset='+offset,f.cookies.mgr);assert.equal(r.status,200,JSON.stringify(r.data));
   assert.ok(r.data.requests.length<=20);for(const row of r.data.requests){assert.equal(row.lines.length,2);assert.equal(row.lines[0].allocations.length,2);seen.push(row.id);}
   if(r.data.nextOffset===null)break;offset=r.data.nextOffset;
  }while(offset<100);
  assert.equal(seen.length,55);assert.equal(new Set(seen).size,55);assert.equal(seen[0],'index-054');assert.equal(seen.at(-1),'index-000');
  for(const status of ['draft','pending','accepted','rejected','mixed']){const r=await f.call('/purchase-early-requests?status='+status,f.cookies.mgr);assert.equal(r.status,200);assert.equal(r.data.requests.length,11,status);assert.ok(r.data.requests.every((r:any)=>r.status===status));}
  const own=await f.call('/purchase-early-requests?supplierId=a&status=accepted',f.cookies.mgr);assert.equal(own.data.requests.length,22);assert.ok(own.data.requests.every((r:any)=>r.lines.length===1&&r.lines[0].allocations.every((a:any)=>a.supplierId==='a')));
  const literal=await f.call('/purchase-early-requests?q='+encodeURIComponent('%_'),f.cookies.mgr);assert.equal(literal.status,200);assert.deepEqual(literal.data.requests.map((r:any)=>r.id),['index-003']);
  const old=await f.call('/purchase-early-requests?q=index-003',f.cookies.mgr);assert.equal(old.data.requests[0].id,'index-003','search reaches a request beyond first page');
  assert.equal((await f.call('/purchase-early-requests?q=PO-excel',f.cookies.mgr)).data.requests.length,50);
  const dates=await f.call('/purchase-early-requests?from=2026-10-26&to=2026-10-27',f.cookies.mgr);assert.ok(dates.data.requests.length>0);assert.ok(dates.data.requests.every((r:any)=>r.pickupDate>='2026-10-26'&&r.pickupDate<='2026-10-27'));
  assert.equal((await f.call('/purchase-early-requests?dateBy=created&from=2026-10-25&to=2026-10-25',f.cookies.mgr)).data.requests.length,0,'created dates use Vietnam timezone');
  assert.equal((await f.call('/purchase-early-requests?dateBy=created&from=2026-10-26&to=2026-10-26',f.cookies.mgr)).data.requests.length,50);
  for(const q of ['status=nope','limit=51','offset=-1','offset=1.5','dateBy=unknown','from=bad','from=2026-10-27&to=2026-10-26','q='+ 'a'.repeat(201)])assert.equal((await f.call('/purchase-early-requests?'+q,f.cookies.mgr)).status,400,q);
  assert.equal((await f.call('/purchase-early-requests',f.cookies.kho)).status,200);assert.equal((await f.call('/purchase-early-requests',f.cookies.ncc)).status,403);
  await f.db.execute(sql`delete from staff_position_permissions where position_id='sale' and permission='page.purchases'`);assert.equal((await f.call('/purchase-early-requests',f.cookies.emp)).status,403);
});

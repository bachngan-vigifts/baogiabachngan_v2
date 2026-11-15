import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupEarly} from '../helpers/purchase-early-fixture.ts';

test('early-request list counts each status with the other filters applied, only on request', async () => {
  const f=await setupEarly();
  const ok=(r:any,s=200)=>{assert.equal(r.status,s,JSON.stringify(r.data));return r.data;};
  const create=async(qty:number)=>ok(await f.call('/purchase-early-requests',f.cookies.mgr,'POST',{clientKey:crypto.randomUUID(),pickupDate:'2026-10-27',lines:[{sku:'031106000',quantity:qty}]}),201);
  const submit=async(r:any)=>ok(await f.call('/purchase-early-requests/'+r.id+'/submit',f.cookies.mgr,'POST',{revision:r.request.revision})).request;
  await create(5);
  const pending=await submit(await create(6));
  const accepted=await submit(await create(7));ok(await f.call('/purchase-early-request-lines/'+accepted.lines[0].id+'/manager-confirm',f.cookies.mgr,'POST',{supplierId:'a'}));
  const rejected=await submit(await create(8));ok(await f.call('/supplier-portal/early-requests/'+rejected.lines[0].id+'/respond',f.cookies.ncc,'POST',{status:'rejected',note:'Hết hàng'}));
  assert.equal(ok(await f.call('/purchase-early-requests',f.cookies.mgr)).counts,undefined,'counts are opt-in');
  const all=ok(await f.call('/purchase-early-requests?counts=1&status=rejected',f.cookies.mgr));
  assert.equal(all.requests.length,1);
  assert.deepEqual(all.counts,{all:4,draft:1,pending:1,accepted:1,rejected:1,mixed:0},'the selected status does not change the counts');
  const searched=ok(await f.call('/purchase-early-requests?counts=1&q='+encodeURIComponent(pending.ticketNumber),f.cookies.mgr));
  assert.deepEqual(searched.counts,{all:1,draft:0,pending:1,accepted:0,rejected:0,mixed:0},'counts follow search and other filters');
  assert.equal(ok(await f.call('/purchase-early-requests?counts=1&id='+pending.id,f.cookies.mgr)).counts,undefined,'single-request reads skip counting');
});

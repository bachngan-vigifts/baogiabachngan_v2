import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupWarehouseWork} from '../helpers/warehouse-work-fixture.ts';
import {stockTransfers,stockTransferLines,stockMoves} from '../../src/modules/inventory/schema.ts';

test('transfer filters run before 300-row limit, use Vietnam dates, preserve private warehouse visibility and never write stock',async()=>{
 const f=await setupWarehouseWork(),base={fromWarehouseId:'from',toWarehouseId:'to',requestedBy:'mgr',updatedAt:'2026-10-30T00:00:00.000Z'};
 const rows=[
  {id:'target',transferNo:'PCK-Older-Target',status:'approved',createdAt:'2026-10-29T17:00:00.000Z'},
  {id:'end',transferNo:'PCK-End',status:'pending',requestedBy:'kho',fromWarehouseId:'to',toWarehouseId:'from',createdAt:'2026-10-30T16:59:59.999Z'},
  {id:'next',transferNo:'PCK-Next-Day',status:'done',createdAt:'2026-10-30T17:00:00.000Z'},
  {id:'private',transferNo:'PCK-Private',status:'approved',fromWarehouseId:'private',requestedBy:'sa',createdAt:'2026-10-30T00:00:00.000Z'},
  ...Array.from({length:305},(_,i)=>({id:'new-'+i,transferNo:'PCK-New-'+i,status:'pending',createdAt:'2026-11-01T00:00:00.000Z'})),
 ];
 await f.db.insert(stockTransfers).values(rows.map(row=>({...base,...row,status:row.status as any})));
 await f.db.insert(stockTransferLines).values({id:'target-line',transferId:'target',sku:'SKU-ABC',name:'Hàng thử',qty:2});
 const before=JSON.stringify(await f.db.select().from(stockMoves));
 const list=async(params:string,cookie=f.cookies.kho)=>f.ok(await f.call('/stock-transfers?'+params,cookie));
 let r=await list('q=pck-older-target');assert.deepEqual(r.transfers.map((t:any)=>t.id),['target']);
 r=await list('q=sku-abc&status=approved&fromWarehouseId=from&toWarehouseId=to&requestedBy=mgr&from=2026-10-30&to=2026-10-30');assert.deepEqual(r.transfers.map((t:any)=>t.id),['target']);assert.equal(r.transfers[0].qty,2);
 r=await list('from=2026-10-30&to=2026-10-30');assert.deepEqual(new Set(r.transfers.map((t:any)=>t.id)),new Set(['target','end']));
 assert.ok(!r.filterOptions.requesters.some((m:any)=>m.id==='sa'),'requester options cannot reveal private transfers');
 assert.deepEqual((await list('requestedBy=kho')).transfers.map((t:any)=>t.id),['end']);
 assert.deepEqual((await list('fromWarehouseId=to&toWarehouseId=from')).transfers.map((t:any)=>t.id),['end']);
 assert.equal((await list('status=done')).transfers[0].id,'next');
 assert.equal((await list('fromWarehouseId=private')).transfers.length,0);
 assert.equal((await list('fromWarehouseId=private',f.cookies.mgr)).transfers[0].id,'private');
 for(const query of ['status=invalid','from=2026-02-30','to=garbage','from=2026-10-31&to=2026-10-01'])assert.equal((await f.call('/stock-transfers?'+query,f.cookies.kho)).status,400,query);
 assert.equal(JSON.stringify(await f.db.select().from(stockMoves)),before);
});

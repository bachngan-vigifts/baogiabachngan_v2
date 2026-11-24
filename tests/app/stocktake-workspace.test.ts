import {test} from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {setupWarehouseOps} from '../helpers/warehouse-approval-fixture.ts';
import {stockBalances,stockMoves} from '../../src/modules/inventory/schema.ts';
import {postMoves} from '../../src/modules/inventory/api/ledger.ts';

const draft=(key:string,countedQty:number|null=7)=>({key,warehouseId:'pos-wh',note:'Kiểm kê thử',lines:[{sku:'00123',expectedQty:10,countedQty}]});
const balance=async(f:Awaited<ReturnType<typeof setupWarehouseOps>>)=>(await f.db.select().from(stockBalances).where(and(eq(stockBalances.sku,'00123'),eq(stockBalances.warehouseId,'pos-wh'))))[0]!.qty;

test('server draft preserves zero/null, revisions reject stale saves, retry is immutable and completion/cancellation post exactly once',async()=>{
 const f=await setupWarehouseOps(),create=await f.call('/inventory/stocktakes',f.emp,'POST',draft('workspace-create-01',null));
 assert.equal(create.status,201,JSON.stringify(create.data));const id=create.data.id;assert.equal(create.data.revision,1);assert.equal(await balance(f),10);
 const save={...draft('workspace-save-01',0),revision:1};
 const saved=await f.call('/inventory/stocktakes/'+id,f.emp,'PUT',save);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.revision,2);
 assert.equal((await f.call('/inventory/stocktakes/'+id,f.emp,'PUT',save)).status,200,'same command replay');
 assert.equal((await f.call('/inventory/stocktakes/'+id,f.emp,'PUT',{...save,lines:[{sku:'00123',expectedQty:10,countedQty:9}]})).status,409,'key cannot change body');
 assert.equal((await f.call('/inventory/stocktakes/'+id,f.emp,'PUT',{...save,key:'workspace-stale-01'})).status,409);
 assert.equal((await f.call('/inventory/stocktakes/'+id+'/complete',f.emp,'POST',{key:'workspace-denied-01',revision:2})).status,403);
 const complete={key:'workspace-complete-01',revision:2};
 for(let n=0;n<2;n++)assert.equal((await f.call('/inventory/stocktakes/'+id+'/complete',f.mgr,'POST',complete)).status,200);
 assert.equal(await balance(f),0);
 await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:3,kind:'adjust',refType:'adjustment',refId:'sale-after-stocktake'}]);
 const cancel={key:'workspace-cancel-01',revision:3};
 for(let n=0;n<2;n++)assert.equal((await f.call('/inventory/stocktakes/'+id+'/cancel',f.mgr,'POST',cancel)).status,200);
 assert.equal(await balance(f),13,'reverse only original delta, retain later receipt');
 const moves=await f.db.select().from(stockMoves).where(eq(stockMoves.refId,id));assert.deepEqual(moves.map(m=>m.kind).sort(),['adjust','reverse']);
 assert.equal((await f.call('/inventory/stocktakes/'+id+'/complete',f.mgr,'POST',{key:'workspace-reopen-01',revision:4})).status,409);
});

test('merge drafts sums counts, cancels sources, requires revisions/same scope; clone is a new draft without ledger movement',async()=>{
 const f=await setupWarehouseOps();
 const a=await f.call('/inventory/stocktakes',f.emp,'POST',draft('workspace-merge-a',2)),b=await f.call('/inventory/stocktakes',f.emp,'POST',draft('workspace-merge-b',3));
 assert.equal(a.status,201,JSON.stringify(a.data));assert.equal(b.status,201);
 const body={key:'workspace-merge-01',sources:[{id:a.data.id,revision:1},{id:b.data.id,revision:1}]};
 const merged=await f.call('/inventory/stocktakes/merge',f.emp,'POST',body);assert.equal(merged.status,201,JSON.stringify(merged.data));
 const d=await f.call('/inventory/stocktakes/'+merged.data.id,f.emp);assert.equal(d.data.sheet.lines[0].countedQty,5);
 assert.equal((await f.call('/inventory/stocktakes/'+a.data.id,f.emp)).data.sheet.status,'cancelled');
 assert.equal((await f.call('/inventory/stocktakes/merge',f.emp,'POST',body)).data.id,merged.data.id);
 const copy=await f.call('/inventory/stocktakes/'+merged.data.id+'/clone',f.emp,'POST',{key:'workspace-clone-01',revision:1});assert.equal(copy.status,201,JSON.stringify(copy.data));
 const copied=await f.call('/inventory/stocktakes/'+copy.data.id,f.emp);assert.equal(copied.data.sheet.status,'draft');assert.equal(copied.data.sheet.lines[0].countedQty,null,'copied goods must be counted again');
 assert.equal(await balance(f),10);
});

test('server list pages and filters multiple statuses; drift blocks completion; normal stock adjustment route cannot bypass draft version',async()=>{
 const f=await setupWarehouseOps(),a=await f.call('/inventory/stocktakes',f.emp,'POST',draft('workspace-filter-01'));
 assert.equal(a.status,201,JSON.stringify(a.data));
 await postMoves(f.db,'mgr',[{sku:'00123',warehouseId:'pos-wh',qty:2,kind:'adjust',refType:'adjustment',refId:'drift-workspace'}]);
 assert.equal((await f.call('/inventory/stocktakes/'+a.data.id+'/complete',f.mgr,'POST',{key:'workspace-drift-01',revision:1})).status,409);
 assert.equal(await balance(f),12);
 const ok=await f.call('/inventory/stocktakes/'+a.data.id+'/complete',f.mgr,'POST',{key:'workspace-drift-02',revision:1,applyDelta:true});assert.equal(ok.status,200,JSON.stringify(ok.data));assert.equal(await balance(f),9);
 const list=await f.call('/inventory/stocktakes?statuses=draft,balanced&limit=15',f.emp);assert.equal(list.status,200);assert.equal(list.data.total,1);assert.equal(list.data.sheets[0].status,'balanced');assert.equal(list.data.sheets[0].totals.valueActual,undefined,'costs stay private');
 assert.equal((await f.call('/inventory/stocktakes?statuses=bogus',f.emp)).status,400);
 assert.equal((await f.call('/inventory/stocktakes',f.emp,'POST',{...draft('workspace-scope-01'),warehouseId:'not-allowed'})).status,403);
 const draft2=await f.call('/inventory/stocktakes',f.emp,'POST',draft('workspace-bypass-01'));
 assert.equal((await f.call('/inventory/adjustments/'+draft2.data.id+'/review',f.mgr,'POST',{decision:'approved'})).status,409,'use versioned workspace API');
});

test('shared warehouse readers cannot edit another creator or see costs/command hashes; completed notes keep original balancing audit',async()=>{
 const f=await setupWarehouseOps(),r=await f.call('/inventory/stocktakes',f.emp,'POST',draft('workspace-security-01'));
 assert.equal(r.status,201,JSON.stringify(r.data));const id=r.data.id;
 const read=await f.call('/inventory/stocktakes/'+id,f.other);assert.equal(read.status,200);assert.equal(read.data.sheet.canEdit,false);assert.equal(read.data.sheet.lines[0].cost,undefined);assert.equal(read.data.adjustment.clientKey,undefined);assert.equal(read.data.adjustment.payloadHash,undefined);
 assert.equal((await f.call('/inventory/stocktakes/'+id,f.other,'PUT',{...draft('workspace-denied-update'),revision:1})).status,403);
 assert.equal((await f.call('/inventory/stocktakes/'+id+'/cancel',f.other,'POST',{key:'workspace-denied-cancel',revision:1})).status,403);
 const done=await f.call('/inventory/stocktakes/'+id+'/complete',f.mgr,'POST',{key:'workspace-audit-complete',revision:1});assert.equal(done.status,200);
 const original=(await f.call('/inventory/stocktakes/'+id,f.mgr)).data.sheet;
 const note=await f.call('/inventory/stocktakes/'+id,f.emp,'PUT',{key:'workspace-balanced-note',revision:2,note:'Ghi chú sau kiểm'});assert.equal(note.status,200,JSON.stringify(note.data));assert.equal(await balance(f),7);
 const cancelled=await f.call('/inventory/stocktakes/'+id+'/cancel',f.mgr,'POST',{key:'workspace-audit-cancel',revision:3});assert.equal(cancelled.status,200);
 const after=(await f.call('/inventory/stocktakes/'+id,f.mgr)).data.sheet;assert.equal(after.balancedAt,original.balancedAt);assert.equal(after.balancedByName,original.balancedByName);assert.equal(after.status,'cancelled');assert.equal(after.canEdit,false);assert.equal(after.canComplete,false);assert.equal(after.canCancel,false);assert.equal(await balance(f),10);
});

test('legacy submitted stocktakes remain visible and can be completed with revision0 without changing legacy create replay identity',async()=>{
 const f=await setupWarehouseOps(),body={source:'stocktake',clientKey:'workspace-legacy-key',warehouseId:'pos-wh',reason:'Phiếu giao diện cũ',lines:[{sku:'00123',expectedQty:10,countedQty:8}]};
 const r=await f.call('/inventory/adjustments',f.emp,'POST',body);assert.equal(r.status,201);
 const detail=await f.call('/inventory/stocktakes/'+r.data.id,f.emp);assert.equal(detail.data.sheet.revision,0);assert.equal(detail.data.sheet.status,'draft');
 assert.equal((await f.call('/inventory/stocktakes/'+r.data.id+'/complete',f.mgr,'POST',{key:'workspace-legacy-complete',revision:0})).status,200);assert.equal(await balance(f),8);
 const retry=await f.call('/inventory/adjustments',f.emp,'POST',body);assert.equal(retry.status,200);assert.equal(retry.data.id,r.data.id);assert.equal(await balance(f),8);
});


test('overlapping drafts cannot apply another count delta twice; explicit recount uses the current baseline',async()=>{
 const f=await setupWarehouseOps(),a=await f.call('/inventory/stocktakes',f.emp,'POST',draft('workspace-overlap-a',12)),b=await f.call('/inventory/stocktakes',f.emp,'POST',draft('workspace-overlap-b',12));
 assert.equal((await f.call('/inventory/stocktakes/'+a.data.id+'/complete',f.mgr,'POST',{key:'workspace-overlap-first',revision:1})).status,200);assert.equal(await balance(f),12);
 const blocked=await f.call('/inventory/stocktakes/'+b.data.id+'/complete',f.mgr,'POST',{key:'workspace-overlap-second',revision:1,applyDelta:true});assert.equal(blocked.status,409);assert.equal(blocked.data.code,'STOCKTAKE_COUNT_CONFLICT');assert.equal(await balance(f),12);
 assert.equal((await f.call('/inventory/stocktakes/'+b.data.id,f.emp,'PUT',{key:'workspace-overlap-recount',revision:1,lines:[{sku:'00123',expectedQty:12,countedQty:12}],note:'Đã kiểm đếm lại'})).status,200);
 assert.equal((await f.call('/inventory/stocktakes/'+b.data.id+'/complete',f.mgr,'POST',{key:'workspace-overlap-done',revision:2})).status,200);assert.equal(await balance(f),12);
});


test('legacy approval API also blocks reapplying a count after the new workspace has balanced it',async()=>{
 const f=await setupWarehouseOps(),legacy=await f.call('/inventory/adjustments',f.emp,'POST',{source:'stocktake',clientKey:'workspace-legacy-overlap',warehouseId:'pos-wh',reason:'Đếm giao diện cũ',lines:[{sku:'00123',expectedQty:10,countedQty:12}]}),current=await f.call('/inventory/stocktakes',f.emp,'POST',draft('workspace-new-overlap',12));
 assert.equal(legacy.status,201);assert.equal(current.status,201);
 assert.equal((await f.call('/inventory/stocktakes/'+current.data.id+'/complete',f.mgr,'POST',{key:'workspace-new-completed',revision:1})).status,200);
 const blocked=await f.call('/inventory/adjustments/'+legacy.data.id+'/review',f.mgr,'POST',{decision:'approved',applyDelta:true});assert.equal(blocked.status,409);assert.equal(blocked.data.code,'STOCKTAKE_COUNT_CONFLICT');assert.equal(await balance(f),12);
});

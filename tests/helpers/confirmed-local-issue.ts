import assert from 'node:assert/strict';
/** Confirm a real local issue for tests whose next step is dispatch/cancellation of dispatched goods. */
export async function confirmLocalIssue(f:any,orderId:string,warehouseId='pos-wh'){
 const view=await f.call(`/orders/${orderId}/packing`,f.mgr);assert.equal(view.status,200,JSON.stringify(view.data));
 const allocations=view.data.lines.filter((l:any)=>l.left>0).map((l:any)=>({orderLineId:l.id,qty:l.left,source:'warehouse'}));
 const made=await f.call(`/orders/${orderId}/packing`,f.mgr,'POST',{allocations});assert.equal(made.status,201,JSON.stringify(made.data));
 for(const p of made.data.slips){assert.equal((await f.call(`/packing/${p.id}/send`,f.mgr,'POST',{})).status,200);
  const result=await f.call(`/packing/${p.id}/confirm`,f.mgr,'POST',{warehouseId,photos:['data:image/jpeg;base64,'+'A'.repeat(200)]});assert.equal(result.status,200,JSON.stringify(result.data));}
}

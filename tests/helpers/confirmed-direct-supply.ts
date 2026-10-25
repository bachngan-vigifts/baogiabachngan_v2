import assert from 'node:assert/strict';
/** Financial/history tests that ship SKU goods still need a real source confirmation.
 * These fixtures use explicit direct supply, without inventing a local stock balance.
 */
export async function confirmDirectSupply(call:(path:string,cookie?:string,method?:string,body?:object)=>Promise<any>,manager:string,orderId:string){
 const view=await call(`/orders/${orderId}/packing`,manager);assert.equal(view.status,200,JSON.stringify(view.data));
 const allocations=view.data.lines.filter((l:any)=>l.left>0).map((l:any)=>({orderLineId:l.id,qty:l.left,source:'supplier',sourceNote:'NCC kiểm thử giao trực tiếp, không qua kho CRM'}));
 if(!allocations.length)return;
 const made=await call(`/orders/${orderId}/packing`,manager,'POST',{allocations});assert.equal(made.status,201,JSON.stringify(made.data));
 for(const p of made.data.slips){const sent=await call(`/packing/${p.id}/send`,manager,'POST',{});assert.equal(sent.status,200,JSON.stringify(sent.data));
  const confirmed=await call(`/packing/${p.id}/confirm`,manager,'POST',{photos:['data:image/jpeg;base64,'+'A'.repeat(200)]});assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));}
}

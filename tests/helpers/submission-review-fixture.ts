/** Complete synthetic operational facts for tests that focus on permissions/inbox/notifications. */
export async function submitFixtureOrder(call:(...args:any[])=>Promise<any>,id:string,cookie:string){
 const pre=await call('/orders/'+id+'/submission-review',cookie);
 if(pre.status!==200)return pre;
 const d=pre.data;
 return call('/orders/'+id+'/submit',cookie,'POST',{revision:d.revision,quoteRevision:d.quoteRevision,review:{deliveryDate:d.defaults.deliveryDate||'2026-12-20',deliveryAddress:d.defaults.deliveryAddress||'Địa chỉ giao hàng kiểm thử',receiverName:d.defaults.receiverName||'Người nhận kiểm thử',receiverPhone:'0901234567',shippingPayer:d.defaults.shippingPayer||'receiver',paymentMethod:'transfer',paymentOther:'',printMode:d.printing?'bulk':'',printInstructions:d.printing?'Logo kiểm thử, một màu tại một vị trí':'',sampleDate:'',bulkConfirmed:d.printing,confirmations:{products:true,delivery:true,payment:true,printing:d.printing}}});
}

/** Stable row identity shared by the customer overview and its injected supplier lookup. */
export const purchaseSupplierKey=(orderId:string,sku:string)=>JSON.stringify([orderId,sku.trim().toUpperCase()]);

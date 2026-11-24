/** Existing purchase line input, shared by creation/draft editing and guarded amendments. */
export interface PurchaseLineInput {sku:string;name:string;unit:string;quantity:number;price:number|null;taxRate:number|null;purchaseDiscount?:number;sources:{type:string;id:string;quantity:number}[]}

/** Request viewer facts only; missing authentication facts fail closed for commercial details. */
export interface PurchaseProjectionViewer {id?:string;role:string;positionId?:string|null;active?:boolean;perms?:readonly string[]|null;dataScope?:string|null}

export const SUPPLIER_WORKSPACE_PAGES=['overview','products','stock','orders','requests','transfers','advances','balances','invoices','deliveries'] as const;
export type SupplierWorkspacePage=typeof SUPPLIER_WORKSPACE_PAGES[number];
export type SupplierWorkspaceValue=string|number|boolean|null;
/** Allowlisted portal DTO, never an internal purchase view or a raw table row. */
export interface SupplierWorkspaceItem{ id:string;[key:string]:SupplierWorkspaceValue|undefined }
export interface SupplierWorkspaceMetric{label:string;value:number|null;money?:boolean;tone?:string}
export interface SupplierWorkspaceList{items:SupplierWorkspaceItem[];total:number;limit:number;offset:number;metrics:SupplierWorkspaceMetric[];options:Record<string,string[]>;asOf:string;warnings?:string[];}

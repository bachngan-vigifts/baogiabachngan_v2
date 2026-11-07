/** Custody records track physical handovers; they are never warehouse ledger entries. */
export const CUSTODY_KINDS = ['warranty', 'sample'] as const;
export const CUSTODY_STATUSES = ['pending', 'sent', 'processing', 'borrowed', 'returned', 'delivered', 'completed'] as const;
export type CustodyKind = typeof CUSTODY_KINDS[number];
export type CustodyStatus = typeof CUSTODY_STATUSES[number];
export const CUSTODY_KIND_LABEL = { warranty: 'Bảo hành', sample: 'Mượn mẫu' };
export const CUSTODY_STATUS_LABEL: Record<CustodyStatus,string> = {pending:'Chờ gửi',sent:'Đã gửi NCC',processing:'NCC đang xử lý',borrowed:'Đang mượn',returned:'Đã nhận lại',delivered:'Đã giao khách',completed:'Hoàn tất'};
export interface CustodyLine {id:string;sku:string;name:string;unit:string;qty:number;returnedQty:number;conditionOut:string}
export interface CustodyRecord {id:string;ticketNumber:string;kind:CustodyKind;status:CustodyStatus;partyName:string;customerId:string|null;supplierId:string|null;responsibleId:string;responsibleName:string;customerName?:string;createdBy:string;startDate:string;dueDate:string;sentDate:string|null;returnedDate:string|null;deliveredDate:string|null;issue:string;result:string;note:string;revision:number;createdAt:string;updatedAt:string;overdue:boolean;dueSoon:boolean;lines:CustodyLine[];canEdit:boolean}

/** Server-owned fields in the persisted return snapshot. Never accepted from a request body. */
export interface CrmReturnRestockSnapshot { unprovenDamagedByLine?: Record<string,number> }
/** Advisory preview; the same cap is checked again under the order/cash locks on submit. */
export interface CrmReturnRefundPreview { refundableAfterReceive:number }

/** Native CRM/POS order lines. Unconverted external website orders have no schedulable CRM lines. */
export interface OrderProductTrip {
  id: string; deliveryNo: string; plannedDate: string; timeSlot: string; status: string; qty: number;
}
export interface OrderProductLine {
  id: string; orderId: string; orderNo: string; contractNo: string | null;
  customerName: string; ownerId: string | null; ownerName: string; channel: string; orderStatus: string;
  sku: string; name: string; unit: string; imageUrl: string;
  qty: number; deliveredQty: number; scheduledQty: number; remainingQty: number; availableQty: number;
  nextDeliveryDate: string | null; expectedDeliveryDate: string | null; overdue: boolean;
  unitPrice?: number; taxRate?: number; amount?: number;
  canSchedule: boolean; progress: { label: string; current: string | null } | null; trips: OrderProductTrip[];
}
export interface OrderProductsResponse {
  lines: OrderProductLine[]; total: number; limit: number; offset: number; calculatedDate: string;
  counts: { all: number; work: number; partial: number; overdue: number; unscheduled: number; delivered: number };
  filterOptions: { owners: { id: string; name: string }[] }; scope: 'native-orders';
}

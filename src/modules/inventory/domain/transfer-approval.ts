/** Transfer approval follows the requester's position, independently of generic approval flags. */
export const COUNTER_SALES_POSITIONS = ['sales-lock', 'sales-ml'] as const;
export function transferApproverPositions(requesterPosition: string | null | undefined): readonly string[] {
  if (requesterPosition === 'sale-admin') return COUNTER_SALES_POSITIONS;
  if (COUNTER_SALES_POSITIONS.some(p => p === requesterPosition)) return ['sale-admin'];
  return [];
}
export function transferRequesterPositions(approverPosition: string | null | undefined): readonly string[] {
  if (approverPosition === 'sale-admin') return COUNTER_SALES_POSITIONS;
  if (COUNTER_SALES_POSITIONS.some(p => p === approverPosition)) return ['sale-admin'];
  return [];
}
export function transferCanApprove(actor: {id: string; role: string; positionId?: string | null}, requester: {id: string; role: string; positionId?: string | null; active?: boolean; deletedAt?: string | null} | undefined): boolean {
  if (actor.role === 'manager') return true;
  return actor.role === 'employee' && !!requester && requester.role === 'employee' && requester.active !== false && !requester.deletedAt && actor.id !== requester.id && transferApproverPositions(requester.positionId).includes(actor.positionId || '');
}
export function transferApprovalLabel(requesterPosition: string | null | undefined): string {
  if (requesterPosition === 'sale-admin') return 'NVBH Lock / NVBH Minh Long hoặc Manager';
  if (COUNTER_SALES_POSITIONS.some(p => p === requesterPosition)) return 'Sale Admin hoặc Manager';
  return 'Manager';
}

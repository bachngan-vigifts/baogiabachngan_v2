/** Call only after loading the order through the viewer's data/store scope. */
export function canSalesCreateSapo(
  member: { role: string; positionId?: string | null },
  order: { status: string },
): boolean {
  if (order.status === 'cancelled') return false;
  return member.role === 'manager' || (member.role === 'employee' &&
    ['sale', 'sale-admin', 'sales-ml', 'sales-lock'].includes(member.positionId ?? ''));
}

/** CRM order/contract cash receipts may be held by the sales team outside a POS drawer. */
export function canCollectCrmCashWithoutDrawer(member: {role:string;positionId?:string|null}) {
  return member.role === 'manager' || member.role === 'employee' && ['sale','sale-admin','sales-lock','sales-ml'].includes(member.positionId || '');
}

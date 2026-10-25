/** Carrier observations take precedence over website/manual shipping labels. */
export const GHN_WAITING = new Set(['ready_to_pick', 'picking', 'money_collect_picking', 'picked', 'storing', 'transporting', 'sorting', 'delivering', 'money_collect_delivering', 'delivery_fail', 'delivery_failed', 'exception']);
export const GHN_FAILED = new Set(['cancel', 'return', 'returned', 'returning', 'return_transporting', 'return_sorting', 'waiting_to_return', 'return_fail', 'damage', 'lost']);
export function webGhnOrderStatus(status: string, fallback: string) {
  // Delivery proves shipping, not a reversal of a refund/deletion in the source system.
  if (['refunded', 'trash'].includes(fallback.trim().toLowerCase())) return fallback;
  const carrier = status.trim().toLowerCase();
  if (carrier === 'delivered') return 'completed';
  if (GHN_FAILED.has(carrier)) return 'cancelled';
  if (GHN_WAITING.has(carrier)) return 'processing';
  return fallback;
}
export const isGhnTracked = (delivery: { trackingCode: string; carrier: string }) => !!delivery.trackingCode.trim() && delivery.carrier.trim().toLowerCase() === 'ghn';

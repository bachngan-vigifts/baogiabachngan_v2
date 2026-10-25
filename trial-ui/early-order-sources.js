// TỰ SINH bởi `npm run ui:build` từ src/modules/suppliers/domain/early-order-sources.ts – không sửa tay.
// src/modules/suppliers/domain/early-order-sources.ts
var EarlySourceError = class extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
};
var key = (s) => s.trim().toLocaleLowerCase("vi");
var orderKey = (o) => o.id || key(o.ticketNumber);
var lineKey = (o) => o.lineId || orderKey(o);
function resolveEarlyOrderSources(orders, sources) {
  const remaining = new Map(orders.map((o) => [lineKey(o), Math.max(0, Math.floor(o.quantity))]));
  const groups = sources.map((source) => {
    const matches = orders.filter((o) => (!source.orderNo || key(o.ticketNumber) === key(source.orderNo)) && (!source.supplierOrderNo || key(o.internalNo || "") === key(source.supplierOrderNo)));
    const label = source.orderNo || (source.supplierOrderNo ? "s\u1ED1 \u0111\u01A1n NCC " + source.supplierOrderNo : "ph\u1EA1m vi \u0111\xE3 ch\u1ECDn");
    if ((source.orderNo || source.supplierOrderNo) && new Set(matches.map(orderKey)).size > 1)
      throw new EarlySourceError(`${label}: kh\u1EDBp nhi\u1EC1u \u0111\u01A1n mua CRM. \u0110i\u1EC1n S\u1ED1 \u0111\u01A1n mua CRM ho\u1EB7c ch\u1ECDn \u0111\xFAng NCC.`, "EARLY_SOURCE_AMBIGUOUS");
    return { source, orders: matches, label, available: 0, allocations: [] };
  });
  const units = new Set(groups.flatMap((g) => g.orders.map((o) => o.unit.trim())));
  if (units.size > 1) throw new EarlySourceError("\u0110\u01A1n v\u1ECB t\xEDnh kh\xF4ng th\u1ED1ng nh\u1EA5t, c\u1EA7n ki\u1EC3m tra l\u1EA1i \u0111\u01A1n mua.", "EARLY_UNIT_CONFLICT");
  const byLine = /* @__PURE__ */ new Map(), resolved = /* @__PURE__ */ new Map();
  for (const g of [...groups].sort((a, b) => Number(!a.source.orderNo && !a.source.supplierOrderNo) - Number(!b.source.orderNo && !b.source.supplierOrderNo))) {
    g.available = g.orders.reduce((sum, o) => sum + (remaining.get(lineKey(o)) || 0), 0);
    if (!Number.isSafeInteger(g.source.quantity) || g.source.quantity <= 0 || !g.orders.length || g.source.quantity > g.available)
      throw new EarlySourceError(`Ch\u1EC9 c\xF2n ${g.available.toLocaleString("vi-VN")} \u0111ang v\u1EC1 t\u1EA1i ${g.label}. Kh\xF4ng chuy\u1EC3n sang \u0111\u01A1n kh\xE1c.`, "EARLY_QUANTITY_EXCEEDED");
    let left = g.source.quantity;
    for (const order of g.orders) {
      const k = lineKey(order), take = Math.min(left, remaining.get(k) || 0);
      if (!take) continue;
      remaining.set(k, (remaining.get(k) || 0) - take);
      left -= take;
      g.allocations.push({ order, quantity: take });
      const prior = byLine.get(k);
      byLine.set(k, { order, quantity: (prior?.quantity || 0) + take });
      const ok = orderKey(order), p = resolved.get(ok);
      resolved.set(ok, { orderNo: order.ticketNumber, supplierOrderNo: g.source.supplierOrderNo || p?.supplierOrderNo || "", quantity: (p?.quantity || 0) + take });
      if (!left) break;
    }
  }
  return { groups, allocations: [...byLine.values()], sources: [...resolved.values()].sort((a, b) => key(a.orderNo).localeCompare(key(b.orderNo))), unit: [...units][0] || "" };
}
export {
  EarlySourceError,
  resolveEarlyOrderSources
};

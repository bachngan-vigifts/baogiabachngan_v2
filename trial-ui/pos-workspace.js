const dateLabel = (value) => /^\d{4}-\d{2}-\d{2}/.test(value || "") ? value.slice(8, 10) + "/" + value.slice(5, 7) : "chưa có";
function incomingStockText(row) {
  const qty = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(Number(row.qty) || 0);
  return row.orderId ? `${row.orderNo || "Đơn mua"} · ${row.supplierName || ""}: ${qty} · hẹn ${dateLabel(row.arrivalDate)}` : `Đang về: ${qty} · dự kiến ${dateLabel(row.arrivalDate)}`;
}
function renderIncomingOrders(root, orders, onOpen) {
  const doc = root.ownerDocument || document;
  for (const order of orders || []) {
    const n = doc.createElement(order.orderId ? "button" : "p");
    if (order.orderId) {
      n.type = "button";
      n.className = "btn secondary";
      n.textContent = "Xem đơn đang về " + (order.orderNo || "");
      n.addEventListener("click", () => onOpen(order.orderId));
    } else {
      n.className = "pos-note pos-anonymous-incoming";
      n.textContent = incomingStockText(order);
    }
    root.append(n);
  }
}
function posShortcut(event, { active, typing = false } = {}) {
  if (!active || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return null;
  if (event.altKey) return !typing ? { "1": "scan", "2": "grid", "3": "delivery" }[event.key] || null : null;
  return { F2: "search", F3: "customer", F4: "discount", F6: "cash", F7: "transfer", F8: "cod", F9: "complete", F10: "temporary", F11: "scan-quantity", F12: "new" }[event.key] || null;
}
function createPosDraftStore(storage) {
  const key = (s) => s?.userId && s?.registerId && s?.shiftId ? "bn-pos-draft:v1:" + JSON.stringify([s.userId, s.registerId, s.shiftId]) : null;
  return {
    read(scope) {
      const k = key(scope);
      if (!k) return null;
      const value = JSON.parse(storage.getItem(k) || "null");
      return value?.version === 1 && value.draft && Array.isArray(value.draft.cart) ? value.draft : null;
    },
    save(scope, draft) {
      const k = key(scope);
      if (!k) return;
      const { confirmed, pending, ...safe } = draft;
      storage.setItem(k, JSON.stringify({ version: 1, draft: safe }));
    },
    clear(scope) {
      const k = key(scope);
      if (k) storage.removeItem(k);
    }
  };
}
export {
  createPosDraftStore,
  incomingStockText,
  posShortcut,
  renderIncomingOrders
};

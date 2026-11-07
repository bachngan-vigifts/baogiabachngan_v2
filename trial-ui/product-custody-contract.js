// TỰ SINH bởi `npm run ui:build` từ src/modules/product-custody/domain/custody.ts – không sửa tay.
// src/core/contracts/product-custody.ts
var CUSTODY_KINDS = ["warranty", "sample"];
var CUSTODY_STATUSES = ["pending", "sent", "processing", "borrowed", "returned", "delivered", "completed"];
var CUSTODY_KIND_LABEL = { warranty: "B\u1EA3o h\xE0nh", sample: "M\u01B0\u1EE3n m\u1EABu" };
var CUSTODY_STATUS_LABEL = { pending: "Ch\u1EDD g\u1EEDi", sent: "\u0110\xE3 g\u1EEDi NCC", processing: "NCC \u0111ang x\u1EED l\xFD", borrowed: "\u0110ang m\u01B0\u1EE3n", returned: "\u0110\xE3 nh\u1EADn l\u1EA1i", delivered: "\u0110\xE3 giao kh\xE1ch", completed: "Ho\xE0n t\u1EA5t" };

// src/modules/product-custody/domain/custody.ts
function custodyToday(now = /* @__PURE__ */ new Date()) {
  return now.toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
}
function validCustodyDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = /* @__PURE__ */ new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function custodyDeadline(status, dueDate, today = custodyToday()) {
  const waiting = !["returned", "delivered", "completed"].includes(status), end = /* @__PURE__ */ new Date(today + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 3);
  return { overdue: waiting && dueDate < today, dueSoon: waiting && dueDate >= today && dueDate <= end.toISOString().slice(0, 10) };
}
function custodyNext(kind, status, hasCustomer) {
  if (kind === "warranty") {
    if (status === "pending") return ["sent"];
    if (status === "sent") return ["processing"];
    if (status === "returned") return hasCustomer ? ["delivered", "completed"] : ["completed"];
  }
  if (kind === "sample" && status === "returned") return ["completed"];
  return [];
}
function canReceiveCustody(kind, status) {
  return kind === "sample" ? status === "borrowed" : ["sent", "processing"].includes(status);
}
function validCustodyStatus(value) {
  return CUSTODY_STATUSES.includes(value);
}
export {
  CUSTODY_KINDS,
  CUSTODY_KIND_LABEL,
  CUSTODY_STATUSES,
  CUSTODY_STATUS_LABEL,
  canReceiveCustody,
  custodyDeadline,
  custodyNext,
  custodyToday,
  validCustodyDate,
  validCustodyStatus
};

// TỰ SINH bởi `npm run ui:build` từ src/modules/suppliers/domain/order-number.ts – không sửa tay.
// src/modules/suppliers/domain/order-number.ts
function requiresSupplierOrderNumber(name) {
  const normalized = (name || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return /(?:^|[^a-z0-9])minh\s*long(?:$|[^a-z0-9])/.test(normalized);
}
function supplierOrderNumberProblem(name, value, required = false) {
  if (value !== void 0 && typeof value !== "string") return "S\u1ED1 \u0111\u01A1n ph\xEDa NCC ph\u1EA3i l\xE0 v\u0103n b\u1EA3n.";
  const number = typeof value === "string" ? value.trim() : "";
  if (number.length > 100) return "S\u1ED1 \u0111\u01A1n ph\xEDa NCC t\u1ED1i \u0111a 100 k\xFD t\u1EF1.";
  if (required && requiresSupplierOrderNumber(name) && !number) return "Nh\u1EADp s\u1ED1 \u0111\u01A1n ph\xEDa NCC Minh Long tr\u01B0\u1EDBc khi duy\u1EC7t \u0111\u01A1n.";
  return "";
}
export {
  requiresSupplierOrderNumber,
  supplierOrderNumberProblem
};

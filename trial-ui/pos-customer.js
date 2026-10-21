// TỰ SINH bởi `npm run ui:build` từ src/modules/sales/domain/pos-customer.ts – không sửa tay.
// src/modules/sales/domain/pos-customer.ts
function posCustomerIssue(customer) {
  if (!customer || typeof customer.id !== "string" || !customer.id.trim() || typeof customer.name !== "string" || !customer.name.trim())
    return "Vui l\xF2ng ch\u1ECDn ho\u1EB7c t\u1EA1o kh\xE1ch h\xE0ng c\u1EE5 th\u1EC3 tr\u01B0\u1EDBc khi thanh to\xE1n.";
  const name = customer.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().trim().replace(/\s+/g, " ");
  return ["khach le", "khach hang le", "khach vang lai"].includes(name) ? "Vui l\xF2ng nh\u1EADp kh\xE1ch h\xE0ng c\u1EE5 th\u1EC3, kh\xF4ng s\u1EED d\u1EE5ng h\u1ED3 s\u01A1 Kh\xE1ch l\u1EBB ho\u1EB7c Kh\xE1ch v\xE3ng lai." : null;
}
export {
  posCustomerIssue
};

// TỰ SINH bởi `npm run ui:build` từ src/modules/sales/domain/pos-catalog-brand.ts – không sửa tay.
// src/modules/sales/domain/pos-catalog-brand.ts
var MINH_LONG_CATALOG_PATTERN = "(^|[^a-z0-9])(minh[ _-]*long|healthy[ _-]*cook|lys|su +duong +sinh)([^a-z0-9]|$)";
var LOCK_CATALOG_PATTERN = "(^|[^a-z0-9])lock([ _&-]*(n[ _&-]*)?lock)?([^a-z0-9]|$)";
var normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
function posCatalogFamily(registerName) {
  const text = normalize(registerName), lock = new RegExp(LOCK_CATALOG_PATTERN).test(text), ml = /minh[ _-]*long/.test(text);
  return lock === ml ? null : lock ? "lock" : "minh-long";
}
function posCatalogProductVisible(registerName, product) {
  const family = posCatalogFamily(registerName);
  if (!family) return true;
  return !new RegExp(family === "lock" ? MINH_LONG_CATALOG_PATTERN : LOCK_CATALOG_PATTERN).test(normalize(`${product.brand ?? ""} ${product.name ?? ""}`));
}
export {
  LOCK_CATALOG_PATTERN,
  MINH_LONG_CATALOG_PATTERN,
  posCatalogFamily,
  posCatalogProductVisible
};

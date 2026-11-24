// TỰ SINH bởi `npm run ui:build` từ src/modules/sales/domain/pos-catalog-brand.ts – không sửa tay.
// src/modules/sales/domain/pos-catalog-brand.ts
var MINH_LONG_CATALOG_PATTERN = "(^|[^a-z0-9])(minh[ _-]*long|healthy[ _-]*cook|lys|su +duong +sinh)([^a-z0-9]|$)";
var LOCK_CATALOG_PATTERN = "(^|[^a-z0-9])lock([ _&-]*(n[ _&-]*)?lock)?([^a-z0-9]|$)";
var normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
function posCatalogFamily(registerName) {
  const text = normalize(registerName), lock = new RegExp(LOCK_CATALOG_PATTERN).test(text), ml = /minh[ _-]*long/.test(text);
  return lock === ml ? null : lock ? "lock" : "minh-long";
}
function posCatalogBrandPattern(registerName) {
  const family = posCatalogFamily(registerName);
  const ml = "(^|[^a-z0-9])(minh[ _-]*long|healthy[ _-]*cook|lys|horeca)([^a-z0-9]|$)";
  return family === "lock" ? LOCK_CATALOG_PATTERN : family === "minh-long" ? ml : `(${LOCK_CATALOG_PATTERN})|(${ml})`;
}
function posCatalogProductVisible(registerName, product) {
  return new RegExp(posCatalogBrandPattern(registerName)).test(normalize(product.brand));
}
export {
  LOCK_CATALOG_PATTERN,
  MINH_LONG_CATALOG_PATTERN,
  posCatalogBrandPattern,
  posCatalogFamily,
  posCatalogProductVisible
};

/** Display scope only: never changes permission to sell or existing cart lines. Shared by SQL catalog and browser previews. */
export const MINH_LONG_CATALOG_PATTERN = '(^|[^a-z0-9])(minh[ _-]*long|healthy[ _-]*cook|lys|su +duong +sinh)([^a-z0-9]|$)';
export const LOCK_CATALOG_PATTERN = '(^|[^a-z0-9])lock([ _&-]*(n[ _&-]*)?lock)?([^a-z0-9]|$)';
const normalize=(value:unknown)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/Đ/g,'D').toLowerCase();
export function posCatalogFamily(registerName:unknown):'lock'|'minh-long'|null {
 const text=normalize(registerName),lock=new RegExp(LOCK_CATALOG_PATTERN).test(text),ml=/minh[ _-]*long/.test(text);
 return lock===ml?null:lock?'lock':'minh-long';
}
/** Positive brand allowlist for the POS picker. Product names never grant visibility. */
export function posCatalogBrandPattern(registerName:unknown):string {
 const family=posCatalogFamily(registerName);
 const ml='(^|[^a-z0-9])(minh[ _-]*long|healthy[ _-]*cook|lys|horeca)([^a-z0-9]|$)';
 return family==='lock'?LOCK_CATALOG_PATTERN:family==='minh-long'?ml:`(${LOCK_CATALOG_PATTERN})|(${ml})`;
}
export function posCatalogProductVisible(registerName:unknown,product:{brand?:unknown;name?:unknown}):boolean {
 return new RegExp(posCatalogBrandPattern(registerName)).test(normalize(product.brand));
}

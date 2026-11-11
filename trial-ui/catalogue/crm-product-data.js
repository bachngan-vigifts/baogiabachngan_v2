import {validateProduct,libraryPricing} from './core.js';
import {posCatalogFamily} from '../pos-catalog-brand.js';

const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase().replace(/[^a-z0-9]/g,'');
/** Match the named retail/VAT policy only; never silently use a wholesale/cost column. */
export const defaultCrmPolicy=policies=>policies.find(p=>/^gia(ban)?le(vat|covat)$/.test(fold(p.name)))?.id||policies.find(p=>/^(gia)?niemyet$/.test(fold(p.name)))?.id||'';
export function crmProductFacts(p,policyId,category){
 if(p.active===false)throw Error('Sản phẩm đã ngừng bán.');
 if(!policyId)throw Error('Chọn bảng giá CRM trước khi thêm sản phẩm.');
 if(!p.sku||p.sku.length>100)throw Error('SKU vượt giới hạn 100 ký tự của catalogue.');
 const raw=Array.isArray(p.prices)?p.prices.find(x=>x.policyId===policyId)?.price:p.prices?.[policyId],regular=raw==null?0:Number(raw);
 if(!Number.isFinite(regular)||regular<0||regular>1e10)throw Error('Giá CRM chưa hợp lệ cho catalogue.');
 return {crmSku:p.sku,sku:p.sku,name:p.name,brand:p.brand||'Chưa phân thương hiệu',category:category.trim(),image:p.imageUrl||'',url:'',pattern:p.pattern||'',regular,priceOnRequest:regular===0,createdAt:p.createdAt||null,createdAtSource:p.createdAt?'crm':null};
}
export function crmCataloguePricing(p,settings){
 const family=posCatalogFamily(p.brand);
 return libraryPricing({...p,discount:family==='lock'?settings.lockDiscount:family==='minh-long'?settings.minhDiscount:0},settings);
}
export async function crmCatalogueProduct(p,policyId,category,settings){
 const facts=crmProductFacts(p,policyId,category),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(p.sku));
 const id='crm-'+[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
 return validateProduct({...crmCataloguePricing(facts,settings),id,qty:1});
}

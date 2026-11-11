import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Standalone browser module.
import {crmCatalogueProduct,crmProductFacts,defaultCrmPolicy} from '../../trial-ui/catalogue/crm-product-data.js';
// @ts-ignore Standalone catalogue modules.
import {libraryProxy} from '../../catalogue-server/library.mjs';
// @ts-ignore Standalone catalogue modules.
import {handleApi} from '../../catalogue-server/api.mjs';
// @ts-ignore Browser state.
import {defaultState,restoreState,makeSlides} from '../../trial-ui/catalogue/core.js';
import {cleanCatalogueQuote} from '../../src/modules/catalog/domain/catalogue-quote.ts';
import {multiBrandFixture} from '../helpers/product-multibrand-fixture.ts';
const token='Bearer SYNTHETIC_CRM_CATALOGUE_TOKEN_123456';
test('CRM catalogue proxy is read-only, fixed upstream, bounded and cannot request hidden SKUs or arbitrary URLs',async()=>{
 let calls=0;const fetcher=async(url:string,init:any)=>{calls++;const u=new URL(url);assert.equal(u.origin,'https://taceqfnsorewelsbdckg.supabase.co');assert.equal(u.pathname,'/functions/v1/baogia-v2-api/api/staff/products');assert.equal(u.searchParams.get('limit'),'50');assert.equal(u.searchParams.get('q'),'bình');assert.equal(u.searchParams.get('brand'),'Lock&Lock');for(const key of ['skus','url','minStock','stockWarehouse'])assert.equal(u.searchParams.has(key),false);assert.equal(init.redirect,'manual');assert.equal(new Headers(init.headers).get('cookie'),null);assert.equal(new Headers(init.headers).get('authorization'),token);return Response.json({products:[]});};
 const r=await libraryProxy(new Request('https://crm.minhlongonline.com/catalogue/api/crm-products?'+new URLSearchParams({q:'bình',brand:'Lock&Lock',limit:'50000',skus:'OLD',url:'https://bad.test',minStock:'0',stockWarehouse:'private'}),{headers:{Authorization:token,Cookie:'secret-not-forwarded'}}),fetcher);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal((await libraryProxy(new Request('https://crm.minhlongonline.com/catalogue/api/crm-products',{method:'POST',headers:{Authorization:token},body:'{}'}),fetcher)).status,405);
 assert.equal((await libraryProxy(new Request('https://crm.minhlongonline.com/catalogue/api/crm-brands'),fetcher)).status,401);assert.equal(calls,1);
 let branch=false;const original=globalThis.fetch;globalThis.fetch=(async()=>{branch=true;return Response.json({brands:[]})}) as typeof fetch;try{assert.equal((await handleApi(new Request('https://crm.minhlongonline.com/catalogue/api/crm-brands',{headers:{Authorization:token}}))).status,200);assert.equal(branch,true);}finally{globalThis.fetch=original;}
});
test('CRM catalogue uses explicit price policy, contact-price for absent/zero, stable SKU identity and existing quote math',async()=>{
 const settings=defaultState().settings,p={sku:'00123',name:'Bình thử',brand:'Minh Long',imageUrl:'',pattern:'Sen',active:true,prices:[{policyId:'vat',price:200000},{policyId:'wholesale',price:100000}]};
 assert.equal(defaultCrmPolicy([{id:'cost',name:'Giá nhập'},{id:'vat',name:'Giá lẻ +VAT'}]),'vat');assert.equal(defaultCrmPolicy([{id:'cost',name:'Giá nhập'}]),'');
 const product=await crmCatalogueProduct(p,'vat','Bình hoa',settings),again=await crmCatalogueProduct({...p,prices:[{policyId:'vat',price:300000}]},'vat','Bình hoa',settings);assert.equal(product.regular,200000);assert.equal(product.discount,10);assert.equal(product.fee,15000);assert.equal((await crmCatalogueProduct({...p,brand:'Lock&Lock'},'vat','Quà',settings)).discount,40);assert.equal(product.sku,'00123');assert.equal(product.crmSku,'00123');assert.equal(product.id,again.id);assert.equal(product.url,'');
 assert.equal(crmProductFacts(p,'absent','Quà').priceOnRequest,true);assert.equal(crmProductFacts({...p,prices:[{policyId:'vat',price:0}]},'vat','Quà').priceOnRequest,true);
 assert.throws(()=>crmProductFacts(p,'','Quà'),/Chọn bảng giá/);assert.throws(()=>crmProductFacts({...p,active:false},'vat','Quà'),/ngừng bán/);await assert.rejects(()=>crmCatalogueProduct({...p,sku:'s'.repeat(101)},'vat','Quà',settings),/100 ký tự/);
 const state=defaultState();state.products=[product,await crmCatalogueProduct({...p,sku:'00124'},'vat','Bình hoa',settings)];state.selected=state.products.map((p:any)=>p.id);const saved=cleanCatalogueQuote(state),restored=restoreState(saved);assert.equal(restored.products[0].crmSku,'00123');assert.equal(restored.products[0].regular,200000);assert.equal(restoreState({...saved,products:saved.products.map(p=>({...p,sku:'edited-'+p.sku}))}).products[0].crmSku,'00123');assert.ok(makeSlides(restored).some((s:any)=>s.type==='products'&&s.items[0].sku==='00123'));
});
test('CRM catalogue list retains API auth, active-only pages and warehouse/price visibility for staff roles',async()=>{
 const f=await multiBrandFixture();
 const call=async(id:string,path='/crm-products?brand=Minh%20Long&skus=OLD')=>libraryProxy(new Request('https://crm.minhlongonline.com/catalogue/api'+path,{headers:{Authorization:token}}),async(url:string,init:any)=>{const u=new URL(url);const r=await f.call(u.pathname.split('/api/staff')[1]+u.search,f.cookies[id]||'',init.method);return Response.json(r.data,{status:r.status});});
 const emp=await (await call('emp')).json();assert.equal(emp.total,31);assert.ok(emp.products.every((p:any)=>p.active&&p.sku!=='OLD'&&!('private' in p.stock)));assert.equal(emp.products.find((p:any)=>p.sku==='A0').prices[0].price,0);
 const wh=await (await call('wh')).json();assert.ok(wh.products.every((p:any)=>!p.prices.length&&!('private' in p.stock)));assert.equal((await call('ncc')).status,403);assert.equal((await call('invalid')).status,401);
 const brands=await (await call('emp','/crm-brands')).json();assert.ok(brands.brands.some((b:any)=>b.name==='Minh Long'&&b.count===31));
});

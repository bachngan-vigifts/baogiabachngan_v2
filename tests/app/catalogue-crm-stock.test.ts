import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Isolated catalogue modules.
import {readCrmStock,crmSkuKey} from '../../catalogue-server/crm-stock.mjs';
// @ts-ignore Isolated catalogue modules.
import {parsePlan,discoverPlan} from '../../catalogue-server/assistant.mjs';
// @ts-ignore Isolated catalogue modules.
import {sourceUrl,normalizeProduct} from '../../catalogue-server/api.mjs';
// @ts-ignore Browser state validation.
import {validateProduct,defaultState,restoreState} from '../../trial-ui/catalogue/core.js';
const request=new Request('https://crm.minhlongonline.com/catalogue/api/assistant',{headers:{Authorization:'Bearer CRM_STOCK_TEST_TOKEN_123456'}});
test('CRM stock reader uses authenticated read-only API and authoritative filteredStock rather than supplier or raw totals',async()=>{
 let called=0;const rows=await readCrmStock(request,['0012','0012'],async(url:string,options:any)=>{called++;const u=new URL(url);assert.equal(u.origin,'https://taceqfnsorewelsbdckg.supabase.co');assert.equal(u.pathname,'/functions/v1/baogia-v2-api/api/staff/products');assert.equal(u.searchParams.get('skus'),'0012');assert.equal(u.searchParams.get('minStock'),'0');assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer CRM_STOCK_TEST_TOKEN_123456');return Response.json({warehouses:[{id:'ncc',kind:'supplier'},{id:'real',kind:'stock'}],products:[{sku:'0012',filteredStock:1,stock:{ncc:999,real:3},stockUpdatedAt:'2026-11-02T06:00:00Z'}]})});assert.equal(called,1);assert.equal(rows.get('0012').available,1);assert(!rows.has('12'));assert.equal(crmSkuKey(' 00ab '),'00AB');
});
test('CRM failures never become zero stock or website fallback',async()=>{
 await assert.rejects(()=>readCrmStock(new Request('https://example.com'),['0012'],async()=>{throw Error('must not fetch')}));
 await assert.rejects(()=>readCrmStock(request,['0012'],async()=>new Response('',{status:401})),/hết hạn/);
 await assert.rejects(()=>readCrmStock(request,['0012'],async()=>Response.json({warehouses:[],products:[{sku:'0012',stock:{real:5}}]})),/chưa trả số tồn khả dụng/);
});
test('CRM mode includes website-out-of-stock items only with verified positive CRM availability and preserves stock evidence',async()=>{
 const groups=parsePlan('tạo báo giá bộ trà, bình hoa có tồn trên crm, giá từ 1tr-2tr');assert.equal(groups.length,2);assert(groups.every((g:any)=>g.stockSource==='crm'&&g.min===1000000&&g.max===2000000));
 const prices={currency_code:'VND',regular_price:'1500000',currency_minor_unit:0};const items=[{sku:'0012',slug:'bo-tra-a',name:'Bộ trà A',is_in_stock:false,prices},{sku:'0013',slug:'bo-tra-b',name:'Bộ trà B',is_in_stock:true,prices},{sku:'12',slug:'bo-tra-c',name:'Bộ trà C',is_in_stock:true,prices}];
 const checkedAt=new Date().toISOString();const evidence={source:'crm',sku:'0012',available:2,checkedAt,updatedAt:checkedAt};let stockCalls=0;
 const adapter={sourceUrl,normalize:normalizeProduct,json:async(url:string)=>{if(url.includes('/categories'))return [{id:419,name:'Bộ trà/cà phê',count:3}];assert(!new URL(url).searchParams.has('stock_status'));return items;},crmStock:async(skus:string[])=>{stockCalls++;assert.deepEqual(skus,['0012','0013','12']);return new Map([['0012',evidence],['0013',{...evidence,sku:'0013',available:0}]]);}};
 const result=await discoverPlan([groups[0]],{lockDiscount:40,minhDiscount:10,fee:15000},adapter);assert.equal(stockCalls,1);assert.equal(result.products.length,1);assert.equal(result.products[0].sku,'0012');assert.equal(result.products[0].crmStock.available,2);
 const product=validateProduct(result.products[0]),s=defaultState();s.products=[product];s.selected=[product.id];assert.equal(restoreState(s).products[0].crmStock.available,2);
});

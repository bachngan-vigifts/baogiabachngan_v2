import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Pages-only catalogue assistant.
import {parsePlan,validateCriteria,discoverPlan,assistantTypes,matchingProduct} from '../../catalogue-server/assistant.mjs';
// @ts-ignore Supplier URL allowlist and normalizer.
import {sourceUrl,normalizeProduct} from '../../catalogue-server/api.mjs';
test('assistant retains multiple explicit categories, independent budgets and shared budgets',()=>{
 const groups=parsePlan('ly sứ dưới 350k + ly dưỡng sinh từ 350–800k');assert.equal(groups.length,2);assert.equal(groups[0].type,'ly-su');assert.equal(groups[1].type,'ly-duong-sinh');assert.equal(groups[0].max,350000);assert.equal(groups[1].min,350000);assert.equal(groups[1].max,800000);assert(groups.every((g:any)=>g.brand==='Minh Long'));
 const shared=parsePlan('ly sứ + ly dưỡng sinh dưới 350k');assert(shared.every((g:any)=>g.max===350000));
 const ranges=parsePlan('bộ trà từ 350–800k + bộ trà từ 800k đến 2tr');assert.equal(ranges.length,2);assert.equal(ranges[1].min,800000);assert.equal(ranges[1].max,2000000);
 assert.throws(()=>validateCriteria({brand:'both',type:'website',categoryId:431,min:0,max:350000}));
});
test('assistant keeps porcelain and nourishing cups distinct and merges groups without duplicate URLs',async()=>{
 const pricing={lockDiscount:40,minhDiscount:10,fee:15000},base={is_in_stock:true,prices:{currency_code:'VND',regular_price:'200000',currency_minor_unit:0},images:[]};
 const cup={...base,id:1,slug:'ly-su',permalink:'https://minhlongonline.com/san-pham/ly-su/',name:'Ly Sứ Cao Minh Long 0.4L'},nourish={...base,id:2,slug:'ly-duong-sinh',permalink:'https://minhlongonline.com/san-pham/ly-duong-sinh/',name:'Ly Sứ Dưỡng Sinh Minh Long 0.48L'};
 const groups=parsePlan('ly sứ + ly dưỡng sinh dưới 350k');const regular=assistantTypes.find((t:any)=>t.key==='ly-su'),special=assistantTypes.find((t:any)=>t.key==='ly-duong-sinh');assert(matchingProduct(cup,groups[0],regular,'Minh Long',pricing));assert(!matchingProduct(nourish,groups[0],regular,'Minh Long',pricing));assert(matchingProduct(nourish,groups[1],special,'Minh Long',pricing));
 const adapter={sourceUrl,normalize:normalizeProduct,json:async(url:string)=>url.includes('/categories')?[{id:431,name:'Ly sứ dưỡng sinh',slug:'ly-su-duong-sinh',count:2}]:[cup,nourish]};
 const result=await discoverPlan([...groups,groups[0]],pricing,adapter);assert.equal(result.products.length,2);assert.equal(result.groupReports[0].count,1);assert.equal(result.groupReports[1].count,1);assert.equal(result.groupReports[2].count,0);assert.equal(new Set(result.products.map((p:any)=>p.url)).size,2);
 const website=await discoverPlan([{...groups[0],type:'website',categoryId:431}],pricing,adapter);assert.equal(website.products.length,2);assert.equal(website.products[0].category,'Ly sứ dưỡng sinh');
});

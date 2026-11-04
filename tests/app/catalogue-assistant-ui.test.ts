import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Pages-only catalogue assistant.
import {discoverPlan,parsePlan,validPricing} from '../../catalogue-server/assistant.mjs';
// @ts-ignore Supplier URL allowlist and normalizer.
import {sourceUrl,normalizeProduct} from '../../catalogue-server/api.mjs';
const helpers:any=await import(new URL('../../trial-ui/catalogue/assistant-helpers.js',import.meta.url).href);

test('trợ lý tính giá theo thiết lập báo giá, không theo số cố định',async()=>{
 const settings={lockDiscount:30,minhDiscount:5,fee:20000};
 assert.deepEqual(helpers.assistantPricing(settings),{lockDiscount:30,minhDiscount:5,fee:20000});
 assert.match(helpers.pricingHint(settings),/LocknLock: niêm yết ×70% \+ 20\.000đ\. Minh Long: niêm yết ×95% \+ 20\.000đ\./);
 // Website: niêm yết 300.000đ. Minh Long 5% + 20.000 = 305.000 → vượt "dưới 300k"; với 10% + 15.000 (mặc định cũ) = 285.000 → lọt.
 const base={is_in_stock:true,prices:{currency_code:'VND',regular_price:'300000',currency_minor_unit:0},images:[]};
 const cup={...base,id:1,slug:'ly-su',permalink:'https://minhlongonline.com/san-pham/ly-su/',name:'Ly Sứ Cao Minh Long 0.4L'};
 const adapter={sourceUrl,normalize:normalizeProduct,json:async(url:string)=>url.includes('/categories')?[{id:9,name:'Tách ly cốc',slug:'tach-ly-coc',count:1}]:[cup]};
 const groups=parsePlan('ly sứ minh long dưới 300k');
 assert.equal((await discoverPlan(groups,{lockDiscount:40,minhDiscount:10,fee:15000},adapter)).products.length,1);
 const custom=await discoverPlan(groups,settings,adapter);assert.equal(custom.products.length,0);
 const loose=await discoverPlan(parsePlan('ly sứ minh long dưới 310k'),settings,adapter);
 assert.equal(loose.products[0].discount,5);assert.equal(loose.products[0].fee,20000);assert.equal(loose.products[0].group,1,'kết quả mang số nhóm để xem trước theo nhóm');
 assert.equal(helpers.offerOf(loose.products[0]),305000);
 assert.throws(()=>validPricing({lockDiscount:100,minhDiscount:10,fee:0}));assert.throws(()=>validPricing({lockDiscount:'x'}));assert.throws(()=>validPricing({fee:-1}));
 await assert.rejects(discoverPlan(groups,{lockDiscount:-5},adapter),/chiết khấu/);
});

test('"Thêm mức giá" theo các mức ngân sách của Thư viện (kể cả mức đã chỉnh)',()=>{
 const ranges=[[0,300000],[300001,700000],[700001,null]];
 assert.deepEqual(helpers.nextBudget(null,ranges),{min:0,max:300000});
 assert.deepEqual(helpers.nextBudget({max:300000},ranges),{min:300001,max:700000});
 assert.deepEqual(helpers.nextBudget({max:'700000'},ranges),{min:700001,max:null});
 assert.deepEqual(helpers.nextBudget({max:null},ranges),{min:0,max:300000});
});

test('phản hồi lỗi không phải JSON hoặc mất mạng: báo câu dễ hiểu',async()=>{
 const html=(status:number)=>async()=>new Response('<html>Bad gateway</html>',{status});
 await assert.rejects(helpers.assistantFetch('x',{},html(502)),/chưa phản hồi/);
 await assert.rejects(helpers.assistantFetch('x',{},html(404)),/mã 404/);
 await assert.rejects(helpers.assistantFetch('x',{},async()=>{throw new TypeError('Failed to fetch')}),/Mất kết nối mạng/);
 await assert.rejects(helpers.assistantFetch('x',{},async()=>Response.json({error:'Vui lòng đăng nhập CRM.'},{status:401})),/đăng nhập CRM/);
 assert.deepEqual(await helpers.assistantFetch('x',{},async()=>Response.json({ok:1})),{ok:1});
});

test('xem trước theo nhóm: đếm theo lựa chọn, nhóm rỗng gợi ý nới tiêu chí, nút đưa vào báo giá khoá khi chưa chọn',()=>{
 const p=(url:string,group:number)=>({url,group,name:'SP '+url,brand:'Minh Long',sku:url,regular:100000,discount:10,fee:15000,override:null,packSize:1});
 const result={products:[p('a',1),p('b',1),p('c',2)],groupReports:[{index:1,count:2},{index:2,count:1},{index:3,count:0}],errors:[]};
 const html=helpers.previewHtml(result,new Set(['a','c']),(i:number)=>'Nhóm số '+i);
 assert.match(html,/2 \/ 3/);assert.match(html,/Đưa 2 sản phẩm vào báo giá/);assert.match(html,/Nhóm 3 · Nhóm số 3 · 0 SP/);assert.match(html,/Thử nới ngân sách/);assert.doesNotMatch(helpers.previewHtml({...result,errors:["Nhóm 3: không có sản phẩm mới phù hợp hoặc đã nằm trong nhóm trước.","Nhóm 2: Website chậm"]},new Set(),()=>""),/Nhóm 3: không có/);assert.match(helpers.previewHtml({...result,errors:["Nhóm 2: Website chậm"]},new Set(),()=>""),/Website chậm/);
 assert.match(html,/105\.000đ/);
 assert.match(helpers.previewHtml(result,new Set(),()=> ''),/data-action="assistant-apply" disabled/);
 assert.doesNotMatch(helpers.previewHtml({...result,products:[{...p('<x>',1),name:'<img src=x>'}]},new Set(),()=>''),/<img src=x>/);
});

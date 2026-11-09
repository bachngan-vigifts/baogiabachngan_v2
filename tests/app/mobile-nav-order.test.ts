import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {orderedMobileNavKeys}=await import(new URL('../../trial-ui/mobile-design.js',import.meta.url).href);
const sidebar=readFileSync(new URL('../../trial-ui/index.html',import.meta.url),'utf8').split('<aside')[1]!.split('</aside>')[0]!;
const keys=[...sidebar.matchAll(/data-nav="([^"]+)"/g)].map(m=>m[1]!);
const expected=[
 'pos','quotes','orders','contracts','products','product-custody','receivables','order-products','deliveries',
 'cashbook','cash','sepay',
 'customers','care','stock-requests',
 'tasks','dashboard','flow','feedback',
 'kho','stock-lookup','transfers','stock-moves','inventory','stocktake','packing','receiving',
 'early-requests','purchases','suppliers',
 'finance','profit','shift-reports','store-reports','weekly-reports','monthly-reports','staff','payroll','permissions',
];
test('mobile footer matches V0 functional order, retaining all sidebar destinations and the warehouse home',()=>{
 assert.deepEqual(orderedMobileNavKeys(keys),expected);
 assert.deepEqual(new Set(orderedMobileNavKeys(keys)),new Set(keys));
 assert.equal(orderedMobileNavKeys(keys).length,keys.length);
});
test('sidebar order does not reorder mobile groups; products follows contracts',()=>{
 assert.deepEqual(orderedMobileNavKeys([...keys].reverse()),expected);
 assert.deepEqual(orderedMobileNavKeys(keys).slice(0,7),['pos','quotes','orders','contracts','products','product-custody','receivables']);
 assert.deepEqual(orderedMobileNavKeys(keys).filter((key:string)=>key!=='product-custody').slice(0,6),['pos','quotes','orders','contracts','products','receivables'],'existing destinations retain their relative order');
});
test('employees and accountants see only allowed links in the same V0 order',()=>{
 for(const visible of [[],['tasks','receivables','purchases','cashbook','cash','customers','suppliers'],['kho','receiving','stocktake','stock-lookup'],['orders','customers','care','quotes']]){
  assert.deepEqual(orderedMobileNavKeys(visible),expected.filter(key=>visible.includes(key)));
 }
});
test('future permitted destinations remain reachable and duplicate entries are removed',()=>{
 assert.deepEqual(orderedMobileNavKeys(['future','orders','orders','cashbook','future']),['orders','cashbook','future']);
});
const {groupMobileNav,MOBILE_NAV_GROUPS}=await import(new URL('../../trial-ui/mobile-design.js',import.meta.url).href);
test('menu chân trang gom theo chức năng: đủ trang, đúng thứ tự, chỉ nhóm có quyền; trang mới vào "Khác"',()=>{
 const groups=groupMobileNav(keys);
 assert.deepEqual(groups.map((g:any)=>g.label),['Bán hàng','Tiền','Khách hàng','Công việc','Kho','Mua hàng','Quản trị']);
 assert.deepEqual(groups.flatMap((g:any)=>g.items),expected,'gom lại vẫn đủ mọi trang, theo thứ tự cũ');
 assert.deepEqual(groups[0].items,['pos','quotes','orders','contracts','products','product-custody','receivables','order-products','deliveries']);
 const sale=groupMobileNav(['orders','customers','care','quotes','tasks']);
 assert.deepEqual(sale.map((g:any)=>[g.key,g.items]),[['sell',['quotes','orders']],['customers',['customers','care']],['work',['tasks']]]);
 assert.deepEqual(groupMobileNav(['future','orders']).map((g:any)=>[g.label,g.items]),[['Bán hàng',['orders']],['Khác',['future']]]);
 assert.equal(new Set(MOBILE_NAV_GROUPS.flatMap((g:any)=>g.keys)).size,MOBILE_NAV_GROUPS.flatMap((g:any)=>g.keys).length,'mỗi trang thuộc đúng một nhóm');
});

test('shift reports is an Administration destination and only appears when permission-visible',()=>{
 const groups=groupMobileNav(['tasks','pos','orders','shift-reports']);
 assert.deepEqual(groups.find((g:any)=>g.key==='work')?.items,['tasks']);
 assert.deepEqual(groups.find((g:any)=>g.key==='admin')?.items,['shift-reports']);
 assert.deepEqual(groups.find((g:any)=>g.key==='sell')?.items,['pos','orders']);
 assert.equal(groupMobileNav(['tasks','orders']).some((g:any)=>g.items.includes('shift-reports')),false);
 assert.match(sidebar,/href="#\/shift-reports" data-nav="shift-reports"/);
});

test('finance, profit and reports belong to Administration in both menus without changing access markers',()=>{
 const group=(id:string)=>sidebar.match(new RegExp(`<section class="nav-group" aria-labelledby="${id}">([\\s\\S]*?)</section>`))?.[1]||'';
 const admin=group('nav-group-6'),work=group('nav-group-0');
 const moved=['finance','profit','shift-reports','store-reports','weekly-reports','monthly-reports'];
 assert.deepEqual(groupMobileNav(moved).map((g:any)=>[g.key,g.items]),[['admin',moved]]);
 for(const key of moved){
  assert.ok(admin.includes(`href="#/${key}" data-nav="${key}"`),key+' remains reachable in Administration');
  assert.ok(!work.includes(`data-nav="${key}"`),key+' leaves Work');
 }
 for(const key of ['finance','profit'])assert.match(admin,new RegExp(`<a class="nav manager-only" href="#/${key}" data-nav="${key}" hidden>`));
 for(const key of moved.slice(2))assert.match(admin,new RegExp(`<a class="nav" href="#/${key}" data-nav="${key}" hidden>`),'employee reports must not gain a Manager-only restriction');
 assert.deepEqual(groupMobileNav(['tasks','weekly-reports','monthly-reports']).map((g:any)=>[g.key,g.items]),[['work',['tasks']],['admin',['weekly-reports','monthly-reports']]]);
 assert.equal(groupMobileNav(['tasks','quotes']).some((g:any)=>g.key==='admin'),false,'no Administration group when no destination is permitted');
 for(const key of ['tasks','dashboard','flow','feedback'])assert.ok(work.includes(`data-nav="${key}"`));
});

test('custody stays next to products and only appears for permission-visible destinations',()=>{
 assert.deepEqual(orderedMobileNavKeys(['product-custody','products']),['products','product-custody']);
 assert.deepEqual(groupMobileNav(['products','product-custody']).map((g:any)=>[g.key,g.items]),[['sell',['products','product-custody']]]);
 assert.equal(groupMobileNav(['products','orders']).some((g:any)=>g.items.includes('product-custody')),false);
 assert.match(sidebar,/href="#\/product-custody" data-nav="product-custody"/);
});

test('SePay is only included in the money group when the destination is permission-visible',()=>{
 assert.deepEqual(groupMobileNav(['cash','sepay']).map((g:any)=>[g.key,g.items]),[['money',['cash','sepay']]]);
 assert.equal(groupMobileNav(['cash','tasks']).some((g:any)=>g.items.includes('sepay')),false);
 assert.match(sidebar,/href="#\/sepay" data-nav="sepay" hidden/);
});

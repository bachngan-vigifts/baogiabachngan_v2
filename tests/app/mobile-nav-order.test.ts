import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {orderedMobileNavKeys}=await import(new URL('../../trial-ui/mobile-design.js',import.meta.url).href);
const sidebar=readFileSync(new URL('../../trial-ui/index.html',import.meta.url),'utf8').split('<aside')[1]!.split('</aside>')[0]!;
const keys=[...sidebar.matchAll(/data-nav="([^"]+)"/g)].map(m=>m[1]!);
const expected=[
 'pos','quotes','orders','contracts','products','receivables','order-products','deliveries',
 'cashbook','cash',
 'customers','care','stock-requests',
 'tasks','dashboard','profit','flow','store-reports','weekly-reports','feedback',
 'kho','stock-lookup','transfers','stock-moves','inventory','stocktake','packing','receiving',
 'early-requests','purchases','suppliers',
 'staff','payroll','permissions',
];
test('mobile footer matches V0 functional order, retaining all sidebar destinations and the warehouse home',()=>{
 assert.deepEqual(orderedMobileNavKeys(keys),expected);
 assert.deepEqual(new Set(orderedMobileNavKeys(keys)),new Set(keys));
 assert.equal(orderedMobileNavKeys(keys).length,keys.length);
});
test('sidebar order does not reorder mobile groups; products follows contracts',()=>{
 assert.deepEqual(orderedMobileNavKeys([...keys].reverse()),expected);
 assert.deepEqual(orderedMobileNavKeys(keys).slice(0,6),['pos','quotes','orders','contracts','products','receivables']);
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
 assert.deepEqual(groups[0].items,['pos','quotes','orders','contracts','products','receivables','order-products','deliveries']);
 const sale=groupMobileNav(['orders','customers','care','quotes','tasks']);
 assert.deepEqual(sale.map((g:any)=>[g.key,g.items]),[['sell',['quotes','orders']],['customers',['customers','care']],['work',['tasks']]]);
 assert.deepEqual(groupMobileNav(['future','orders']).map((g:any)=>[g.label,g.items]),[['Bán hàng',['orders']],['Khác',['future']]]);
 assert.equal(new Set(MOBILE_NAV_GROUPS.flatMap((g:any)=>g.keys)).size,MOBILE_NAV_GROUPS.flatMap((g:any)=>g.keys).length,'mỗi trang thuộc đúng một nhóm');
});

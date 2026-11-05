import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {orderedMobileNavKeys}=await import(new URL('../../trial-ui/mobile-design.js',import.meta.url).href);
const sidebar=readFileSync(new URL('../../trial-ui/index.html',import.meta.url),'utf8').split('<aside')[1]!.split('</aside>')[0]!;
const keys=[...sidebar.matchAll(/data-nav="([^"]+)"/g)].map(m=>m[1]!);
const expected=[
 'pos','quotes','orders','contracts','receivables',
 'cashbook','cash',
 'customers','care','stock-requests',
 'tasks','dashboard','flow','feedback',
 'kho','products','stock-lookup','transfers','stock-moves','inventory','stocktake','packing','receiving','deliveries',
 'early-requests','purchases','suppliers',
 'staff','payroll','permissions',
];
test('mobile footer matches V0 functional order, retaining all sidebar destinations and the warehouse home',()=>{
 assert.deepEqual(orderedMobileNavKeys(keys),expected);
 assert.deepEqual(new Set(orderedMobileNavKeys(keys)),new Set(keys));
 assert.equal(orderedMobileNavKeys(keys).length,keys.length);
});
test('sidebar order does not reorder mobile groups or the five original selling entries',()=>{
 assert.deepEqual(orderedMobileNavKeys([...keys].reverse()),expected);
 assert.deepEqual(orderedMobileNavKeys(keys).slice(0,5),['pos','quotes','orders','contracts','receivables']);
});
test('employees and accountants see only allowed links in the same V0 order',()=>{
 for(const visible of [[],['tasks','receivables','purchases','cashbook','cash','customers','suppliers'],['kho','receiving','stocktake','stock-lookup'],['orders','customers','care','quotes']]){
  assert.deepEqual(orderedMobileNavKeys(visible),expected.filter(key=>visible.includes(key)));
 }
});
test('future permitted destinations remain reachable and duplicate entries are removed',()=>{
 assert.deepEqual(orderedMobileNavKeys(['future','orders','orders','cashbook','future']),['orders','cashbook','future']);
});

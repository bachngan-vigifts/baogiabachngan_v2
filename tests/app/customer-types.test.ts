import {contractTest as test,assert} from '../TEST_TEMPLATE.ts';
import {setup} from '../helpers/pos-fixture.ts';
import {customerCreateFixture} from '../helpers/customer-fixture.ts';
import {customers} from '../../src/modules/customers/schema.ts';
import {employees} from '../../src/modules/staff/schema.ts';
import {eq} from 'drizzle-orm';

test('customer type list is authenticated, distinct, complete across pages, and follows retail/rejected visibility',async()=>{
  const f=await setup();
  const base={contact:'',phone:'',email:'',address:'',search:'',sourceVersion:0,syncedAt:'2026-11-06'};
  await f.db.insert(customers).values([
    ...Array.from({length:110},(_,i)=>({...base,id:'type-'+i,name:'Customer '+i,customerType:'Nhóm '+String(i).padStart(3,'0')})),
    {...base,id:'case-a',name:'A',customerType:'  Đại lý  '},
    {...base,id:'case-b',name:'B',customerType:'đại lý'},
    {...base,id:'blank',name:'Blank',customerType:'   '},
    {...base,id:'null',name:'Null',customerType:null},
    {...base,id:'retail-type',name:'Retail',customerType:'Nhóm bán lẻ',isRetail:true},
    {...base,id:'pending-type',name:'Pending',customerType:'Nhóm chờ duyệt',approvalStatus:'pending'},
    {...base,id:'rejected-type',name:'Rejected',customerType:'Nhóm bị từ chối',approvalStatus:'rejected',rejectReason:'Test',rejectedBy:'mgr',rejectedAt:'2026-11-06'},
  ]);
  assert.equal((await f.call('/customers/types','')).status,401);
  const manager=await f.call('/customers/types',f.mgr);assert.equal(manager.status,200);
  const types:string[]=manager.data.types;
  assert.equal(types.filter(x=>x.toLocaleLowerCase('vi')==='đại lý').length,1);
  assert.ok(types.includes('Nhóm 109'));assert.ok(types.includes('Nhóm bán lẻ'));assert.ok(types.includes('Nhóm chờ duyệt'));
  assert.ok(!types.includes('Nhóm bị từ chối'));assert.ok(types.every(x=>x.trim()===x&&x.length>0));
  await f.db.update(employees).set({positionId:'sale'}).where(eq(employees.id,'emp'));
  const employee=await f.call('/customers/types',f.emp);assert.equal(employee.status,200);
  assert.ok(!employee.data.types.includes('Nhóm bán lẻ'));assert.ok(employee.data.types.includes('Nhóm 109'));
  await f.db.update(employees).set({positionId:null}).where(eq(employees.id,'emp'));
  assert.equal((await f.call('/customers/types',f.emp)).status,403);
});

test('new group saves through existing customer creation and becomes an option; unsaved names never create groups',async()=>{
  const f=await setup(),group='Nhóm mới <không phải HTML>';
  assert.ok(!(await f.call('/customers/types',f.mgr)).data.types.includes(group));
  const failed=await f.call('/customers',f.mgr,'POST',{name:'Thiếu hồ sơ',customerType:group});assert.equal(failed.status,400);
  assert.ok(!(await f.call('/customers/types',f.mgr)).data.types.includes(group));
  const saved=await f.call('/customers',f.mgr,'POST',customerCreateFixture({name:'Khách nhóm mới',customerType:'  '+group+'  '}));assert.equal(saved.status,201);
  assert.equal((await f.call('/customers/'+saved.data.id,f.mgr)).data.customer.customerType,group);
  assert.ok((await f.call('/customers/types',f.mgr)).data.types.includes(group));
});

class Node {
  id='';value='';textContent='';className='';placeholder='';parentElement!:Node;
  attributes:Record<string,string>={};children:Node[]=[];
  constructor(readonly tag:string){}
  append(...nodes:Node[]){this.children.push(...nodes);}
  replaceChildren(...nodes:Node[]){this.children=nodes;}
  setAttribute(key:string,value:string){this.attributes[key]=value;}
}
test('editable type list safely populates without replacing typed values and handles refresh races and API failure',async()=>{
  const previous=globalThis.document;Object.assign(globalThis,{document:{createElement:(tag:string)=>new Node(tag)}});
  try{
    const {bindCustomerTypeOptions}:any=await import(new URL('../../trial-ui/customer-type-options.js',import.meta.url).href);
    const input=new Node('input');input.parentElement=new Node('label');input.value='Tên đang gõ';
    const requests:Array<{resolve:(value:any)=>void,reject:(error:Error)=>void}>=[];
    const bound=bindCustomerTypeOptions({input,api:(url:string)=>{assert.equal(url,'/customers/types');return new Promise((resolve,reject)=>requests.push({resolve,reject}));}});
    const [list,hint]=input.parentElement.children;assert.equal(input.attributes.list,list!.id);
    const old=bound.refresh(),fresh=bound.refresh();requests[1]!.resolve({types:['Đại lý','<img onerror=evil()>']});await fresh;
    requests[0]!.resolve({types:['Stale']});await old;
    assert.deepEqual(list!.children.map(n=>n.value),['Đại lý','<img onerror=evil()>']);assert.equal(list!.children[1]!.children.length,0);
    assert.equal(input.value,'Tên đang gõ');assert.match(hint!.textContent,/lưu cùng khách hàng/);
    const fail=bound.refresh();requests[2]!.reject(new Error('Offline'));await fail;
    assert.equal(list!.children.length,0);assert.match(hint!.textContent,/vẫn có thể nhập/);assert.equal(input.value,'Tên đang gõ');
  }finally{Object.assign(globalThis,{document:previous});}
});

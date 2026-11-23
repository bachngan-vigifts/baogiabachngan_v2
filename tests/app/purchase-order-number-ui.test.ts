import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {requiresSupplierOrderNumber,supplierOrderNumberProblem} from '../../src/modules/suppliers/domain/order-number.ts';
// @ts-ignore – module giao diện thuần JS
import {createPurchaseOrders} from '../../trial-ui/purchase-order-create.js';
const src=readFileSync(new URL('../../trial-ui/purchases.js',import.meta.url),'utf8');
const section=(a:string,b:string)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
class Element{
 tag:string;children:any[]=[];value='';textContent='';hidden=false;required=false;disabled=false;events:any={};focused=false;
 constructor(tag='div'){this.tag=tag;}
 get childElementCount(){return this.children.length;}
 get tHead(){return this.children.find(n=>n.tag==='thead');}
 append(...nodes:any[]){this.children.push(...nodes);}
 replaceChildren(...nodes:any[]){this.children=nodes;}
 setAttribute(){}
 addEventListener(k:string,f:any){this.events[k]=f;}
 focus(){this.focused=true;}
 querySelectorAll(){return [];}
}
function h(name='Minh Long'){
 const made:Element[]=[],calls:any[]=[];
 const create=(tag:string)=>{const e=new Element(tag);made.push(e);return e;};
 const c:any={document:{createElement:create,createTextNode:(text:string)=>({textContent:text})},requiresSupplierOrderNumber,supplierOrderNumberProblem,
  current:{id:'one',ticketNumber:'DMH1',supplier:{name},internalNo:'',revision:3,lines:[],schedules:[]},frame:()=>create('frame'),back(){},
  errorBox:()=>create('error'),foot:(...nodes:any[])=>{const e=create('footer');e.append(...nodes);return e;},
  run:(_button:any,_error:any,fn:any)=>fn(),api:async(...args:any[])=>{calls.push(args);return{revision:4};},money:String,toast(){},load(){},prefillCosts:async()=>{}};
 runInNewContext(section('const el =','const dmy ='),c);
 return{c,made,calls,run:(s:string)=>runInNewContext(s,c)};
}
test('selected confirmation form requires only Minh Long, rejects whitespace, and sends entered number',()=>{
 for(const name of ['Minh Long','Lys Ceramics']){
  const t=h(name);t.run(section('  function confirmForm(', '  function receiveForm(')+';confirmForm();');
  const form=t.made.find(n=>n.tag==='form')!,number=t.made.find((n:any)=>n.tag==='input'&&n.maxLength===100)!;
  assert.equal(number.required,name==='Minh Long');
  number.value='   ';form.events.submit({preventDefault(){}});
  assert.equal(t.calls.length,name==='Minh Long'?0:1);
  if(name==='Minh Long')assert(number.focused);
  number.value='00123';form.events.submit({preventDefault(){}});
  assert.equal(t.calls.at(-1)[2].internalNo,'00123');
 }
});
test('manager approval exposes a required Minh Long number while save-prices remains a separate draft action',async()=>{
 const t=h();t.run(section('  async function paymentForm(', '  /**\n   * Gợi ý giá')+';paymentForm("approve");');await Promise.resolve();
 const form=t.made.find(n=>n.tag==='form')!,number=t.made.find((n:any)=>n.tag==='input'&&n.maxLength===100)!;
 assert(number.required);form.events.submit({preventDefault(){}});assert.equal(t.calls.length,0);
 const save=t.made.find(n=>n.tag==='button'&&n.textContent==='Lưu giá nhập')!;await save.events.click();assert.match(t.calls[0][0],/\/prices$/);
 number.value=' 0009 ';form.events.submit({preventDefault(){}});assert.match(t.calls.at(-1)[0],/\/approve$/);assert.equal(t.calls.at(-1)[2].internalNo,'0009');
});
test('creation has optional per-supplier number fields and preserves them through redraws',()=>{
 const t=h(),chips=new Element(),numberFields=new Element();
 Object.assign(t.c,{sups:[{id:'a',name:'Minh Long'},{id:'b',name:'Lys Ceramics'},{id:'c',name:'MINH LONG I'}],chips,numberFields,renderGrid(){}});
 t.run(section('    function renderChips()', '    renderChips();')+';renderChips();');
 assert.equal(numberFields.children.length,2);
 const first=numberFields.children[0].children[1];assert.equal(first.required,false);first.value='000-A';first.events.input();
 t.run('renderChips()');assert.equal(numberFields.children[0].children[1].value,'000-A');assert.equal(numberFields.children[1].children[1].value,'');
 assert.equal(t.c.sups[1].internalNo,undefined);
});

test('restock page preserves separate optional numbers and includes them in each created order',async()=>{
 const source=readFileSync(new URL('../../trial-ui/purchase-restock.js',import.meta.url),'utf8'),t=h();
 const supSel=new Element(),chips=new Element(),numberFields=new Element();Object.defineProperty(supSel,'firstChild',{get:()=>supSel.children[0]});
 const sups=[{id:'a',name:'Minh Long'},{id:'b',name:'Lys'}],address=new Element();address.value='Kho giao';
 let persisted=0;
 Object.assign(t.c,{sups,supSel,chips,numberFields,o:{suppliers:sups},persist:()=>persisted++,render(){},
  f:(label:string,control:any)=>{const e=new Element('label');e.append(label,control);return e;},
  err:new Element(),address,rows:[{sku:'001',want:2,name:'Ly',unit:'cái'}],perSupplier:()=>[1,1],arrival:new Element(),note:new Element(),summarize(){},submit:new Element(),store:{clear(){}},go(){},focusRow(){},busy:false});
 runInNewContext(source.slice(source.indexOf('  function fillSuppliers()'),source.indexOf("  supSel.addEventListener('change'"))+';fillSuppliers();',t.c);
 assert.equal(numberFields.children.length,1);const number=numberFields.children[0].children[1];assert(!number.required);
 number.value='001-ML';number.events.input();assert.equal(persisted,1);
 runInNewContext('fillSuppliers();',t.c);assert.equal(numberFields.children[0].children[1].value,'001-ML');
 t.c.api=async(...args:any[])=>{t.calls.push(args);return{ids:['created']};};
 // save() lập đơn qua createPurchaseOrders (mã thao tác chống tạo trùng) – nạp đúng hàm thật vào khung chạy.
 const store=new Map<string,string>();t.c.createPurchaseOrders=(api:any,orders:any)=>createPurchaseOrders(api,orders,()=>({getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>void store.set(k,v)}));
 await runInNewContext(source.slice(source.indexOf('  async function save()'),source.indexOf('  // ----- mở trang:'))+';save();',t.c);
 assert.deepEqual(t.calls[0][2].orders.map((o:any)=>[o.supplierId,o.internalNo]),[['a','001-ML'],['b','']]);
 assert.match(t.calls[0][2].clientKey,/^[0-9a-f-]{36}$/,'gửi kèm mã thao tác');
});


test('supplier reference form sends only the reference and captured revision, validates empty input',()=>{
 const t=h();t.run(section('  function supplierReferenceForm()', '  function confirmForm()')+';supplierReferenceForm();');
 const form=t.made.find(n=>n.tag==='form')!,number=t.made.find((n:any)=>n.tag==='input'&&n.maxLength===100)!;
 assert(number.required);number.value='   ';form.events.submit({preventDefault(){}});assert.equal(t.calls.length,0);assert(number.focused);
 number.value='  000-NCC  ';form.events.submit({preventDefault(){}});
 assert.deepEqual(JSON.parse(JSON.stringify(t.calls[0])),['/purchase-orders/one/supplier-reference','PUT',{revision:3,internalNo:'000-NCC'}]);
 assert.match(src,/if \(has\('reference'\)\).*Bổ sung số đơn NCC/);
});

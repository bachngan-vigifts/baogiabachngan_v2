import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
class Node {
 children:Node[]=[];parent:Node|null=null;events:Record<string,Function>={};attrs:Record<string,string>={};dataset:Record<string,string>={};className='';text='';value:any='';type='';hidden=false;disabled=false;style={};
 classList={toggle(){}};
 constructor(public tag='div'){}
 append(...nodes:Node[]){for(const n of nodes){n.parent=this;this.children.push(n);}}
 replaceChildren(...nodes:Node[]){this.children=[];this.text='';this.append(...nodes);}
 set textContent(s:string){this.text=String(s);this.children=[];}get textContent():string{return this.text+this.children.map(n=>n.textContent).join('');}
 setAttribute(k:string,v:string){this.attrs[k]=v;}
 addEventListener(k:string,f:Function){this.events[k]=f;}
 querySelectorAll(selector:string):Node[]{return this.children.flatMap(n=>[...(selector.split(',').includes(n.tag)?[n]:[]),...n.querySelectorAll(selector)]);}
 focus(){} remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 async click(){if(!this.disabled)await this.events.click?.();}
}
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];
function setup({canManage=true,canApprove=true,warehouses=[{id:'from',name:'Kho đi'},{id:'to',name:'Kho đến'},{id:'other',name:'Kho khác'}],transferRead}:{canManage?:boolean;canApprove?:boolean;warehouses?:{id:string;name:string}[];transferRead?:()=>Promise<any>}={}){
 const root=new Node(),writes:any[]=[],messages:string[]=[];
 const transfer={id:'t',transferNo:'PCK-001',fromWarehouseId:'from',toWarehouseId:'to',fromName:'Kho đi',toName:'Kho đến',lines:[{sku:'X',qty:24},{sku:'Y',qty:5},{sku:'X',qty:2}],actions:{adjustBalance:canManage}};
 const context:any={URLSearchParams,setTimeout,clearTimeout,crypto:{randomUUID:()=> 'quick-adjustment-001'},location:{hash:'#/inventory?transfer=t'},history:{replaceState(_a:any,_b:any,hash:string){context.location.hash=hash;}},window:{scrollTo(){}},localStorage:{getItem(){return null;}},document:{createElement:(tag:string)=>new Node(tag),createTextNode:(s:string)=>{const n=new Node('text');n.textContent=s;return n;},addEventListener(){}},initAdjustmentQueue:()=>({load:async()=>{}})};
 const code=readFileSync(new URL('../../trial-ui/inventory.js',import.meta.url),'utf8').replace(/^import .*;\n/m,'').replace('export function initInventory','globalThis.initInventory = function');runInNewContext(code,context);
 const ui=context.initInventory({root,toast:(m:string)=>messages.push(m),api:async(path:string,method?:string,body?:any)=>{
  if(method){writes.push({path,body:JSON.parse(JSON.stringify(body))});return{refNo:'DC-001',status:canApprove?'approved':'pending'};}
  if(path==='/inventory/status')return{warehouses,canManage,canApproveAdjustment:canApprove};
  if(path.startsWith('/inventory/compare'))return{rows:[],diffCount:0};
  if(path==='/stock-transfers/t')return transferRead?transferRead():transfer;
  throw Error('Unexpected request '+path);
 }});
 const form=()=>all(root).find(n=>n.tag==='form'&&n.className.includes('inv-adjust-form'));
 return{root,context,ui,writes,messages,form,transfer,control:(label:string)=>all(root).find(n=>n.attrs['aria-label']===label)!};
}
test('quick balance preloads unique SKUs but no quantity or warehouse; explicit submit uses existing adjustment API',async()=>{
 const s=setup();await s.ui.load();assert.equal(s.context.location.hash,'#/inventory');assert.ok(s.form());assert.equal(s.writes.length,0);
 const warehouse=s.control('Kho cân bằng');assert.equal(warehouse.value,'');assert.deepEqual(warehouse.children.map(n=>n.value),['','from','to']);
 const inputs=()=>s.form()!.querySelectorAll('input');assert.deepEqual(inputs().filter(n=>n.attrs['aria-label']==='Mã hàng').map(n=>n.value),['X','Y']);
 assert.ok(inputs().filter(n=>n.type==='number').every(n=>n.value===''),'transfer qty is never an adjustment');
 assert.match(s.root.textContent,/PCK-001.*Kho đi.*Kho đến/);
 const submit=()=>s.form()!.events.submit!({preventDefault(){}});
 await submit();assert.equal(s.writes.length,0);assert.match(s.root.textContent,/Chọn kho trước/);
 warehouse.value='other';await submit();assert.equal(s.writes.length,0,'warehouse outside transfer rejected locally');
 warehouse.value='from';inputs().find(n=>n.type==='number')!.value=4;await submit();
 assert.deepEqual(s.writes[0],{path:'/inventory/adjustments',body:{warehouseId:'from',reason:'Cân bằng kho từ phiếu điều chuyển PCK-001',lines:[{sku:'X',qty:4}],clientKey:'quick-adjustment-001'}});
});
test('restricted warehouse and employee approval remain intact; background reload does not wipe edits',async()=>{
 const s=setup({canApprove:false,warehouses:[{id:'from',name:'Kho đi'}]});await s.ui.load();
 assert.deepEqual(s.control('Kho cân bằng').children.map(n=>n.value),['','from']);
 assert.match(s.root.textContent,/chưa thay đổi tồn kho/);
 const quantity=s.form()!.querySelectorAll('input').find(n=>n.type==='number')!;quantity.value=7;await s.ui.load();assert.equal(s.form()!.querySelectorAll('input').find(n=>n.type==='number'),quantity);assert.equal(quantity.value,7);
 await all(s.root).find(n=>n.tag==='button'&&n.textContent==='Huỷ')!.click();assert.equal(s.writes.length,0);
});
test('no manage permission, inaccessible transfer or no allowed warehouse cannot open a balance form',async()=>{
 const denied=setup({canManage:false});await denied.ui.load();assert.equal(denied.form(),undefined);assert.match(denied.messages.join(),/chưa được cấp quyền/);
 const hidden=setup({transferRead:async()=>{throw Error('Không tìm thấy phiếu điều chuyển.');}});await hidden.ui.load();assert.equal(hidden.form(),undefined);assert.match(hidden.messages.join(),/Không tìm thấy/);
 const noWarehouse=setup({warehouses:[{id:'other',name:'Kho khác'}]});await noWarehouse.ui.load();assert.equal(noWarehouse.form(),undefined);assert.match(noWarehouse.messages.join(),/Không có kho/);
});
test('late transfer response after navigation never opens the editor',async()=>{
 let finish!:(value:any)=>void;const s=setup({transferRead:()=>new Promise(r=>finish=r)});const pending=s.ui.load();
 for(let i=0;i<10&&!finish;i++)await Promise.resolve();assert.ok(finish);s.context.location.hash='#/customers';finish(s.transfer);await pending;assert.equal(s.form(),undefined);assert.equal(s.writes.length,0);
});

test('opening another transfer preserves an existing unsaved adjustment and explains how to continue',async()=>{
 const s=setup();await s.ui.load();const quantity=s.form()!.querySelectorAll('input').find(n=>n.type==='number')!;quantity.value=9;
 s.context.location.hash='#/inventory?transfer=another';await s.ui.load();assert.equal(s.form()!.querySelectorAll('input').find(n=>n.type==='number'),quantity);assert.equal(quantity.value,9);assert.match(s.messages.join(),/phiếu cân bằng chưa lưu/);assert.equal(s.context.location.hash,'#/inventory');assert.equal(s.writes.length,0);
});

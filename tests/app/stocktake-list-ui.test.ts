import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
class Node{
 children:Node[]=[];attrs:Record<string,string>={};events:Record<string,Function>={};dataset:Record<string,string>={};className='';hidden=false;disabled=false;value:any='';own='';innerHTML='';type='';parent:Node|null=null;classList={toggle(){}};
 constructor(public tag:string){}
 append(...nodes:Node[]){for(const node of nodes){node.parent=this;this.children.push(node);}}
 set textContent(value:string){this.own=String(value);this.children=[];}get textContent():string{return this.own+this.children.map(n=>n.textContent).join('');}
 replaceChildren(...nodes:Node[]){this.children=[];this.own='';this.append(...nodes);}
 setAttribute(key:string,value:string){this.attrs[key]=value;}
 addEventListener(name:string,fn:Function){this.events[name]=fn;}
 focus(){}
 async click(){if(!this.disabled)await this.events.click?.();}
}
const all=(node:Node):Node[]=>[node,...node.children.flatMap(all)];
async function harness(){
 const root=new Node('main'),opened:string[]=[],reads:string[]=[],writes:any[]=[],drafts=new Map<string,string>(),timers=new Map<number,Function>();let tick=0;
 const state:any={stock:10,pending:{SKU1:[{id:'p1',refNo:'KK_001_30102026',createdAt:'2026-10-30T00:00:00Z',createdByName:'NV A'}]}};
 const product={sku:'SKU1',name:'Bộ trà',unit:'Bộ',stock:{wh:10}};
 const ctx:any={document:{createElement:(tag:string)=>new Node(tag)},localStorage:{getItem:(key:string)=>drafts.get(key)||null,setItem:(key:string,value:string)=>drafts.set(key,value)},setTimeout:(fn:Function)=>{timers.set(++tick,fn);return tick;},clearTimeout:(id:number)=>timers.delete(id),crypto:{randomUUID:()=> 'stocktake-key-001'},
 initAdjustmentQueue:()=>({load:async()=>{},open:async(id:string)=>opened.push(id)})};
 const source=readFileSync(new URL('../../trial-ui/stocktake.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function initStocktake','globalThis.initStocktake=function');runInNewContext(source,ctx);
 const ui=ctx.initStocktake({root,toast(){},confirmBox:async()=>true,userId:()=> 'employee',ensureCatalog:async()=>[],findProducts:()=>[product],api:async(path:string,method?:string,body?:any)=>{
  reads.push(path);if(path==='/inventory/status')return {canManage:true,warehouses:[{id:'wh',name:'Kho',openedAt:'2026-10-01'}]};
  if(path==='/inventory/count-stock')return {stock:{SKU1:state.stock},pendingBySku:state.pending,observedAt:'2026-10-30T01:00:00Z'};
  if(path==='/inventory/adjustments'){writes.push(body);return {refNo:'KK_NEW'};}throw Error(path);
 }});
 await ui.load();
 const label=(s:string)=>all(root).find(n=>n.attrs['aria-label']===s)!;
 const button=(s:string)=>all(root).find(n=>n.tag==='button'&&n.textContent===s)!;
 const panel=()=>all(root).find(n=>n.className==='panel stocktake-panel')!;
 const flush=async()=>{for(const [id,fn] of [...timers]){timers.delete(id);await fn();}};
 const start=async()=>{await label('Tạo phiếu kiểm kê mới').click();label('Kho kiểm kê').value='wh';await label('Kho kiểm kê').events.change!();label('Tìm sản phẩm kiểm kê').value='SKU1';await label('Tìm sản phẩm kiểm kê').events.keydown!({key:'Enter',preventDefault(){}});label('Lý do kiểm kê').value='Kiểm tra kho';label('Lý do kiểm kê').events.input!();};
 return{root,ui,label,button,panel,start,flush,state,opened,reads,writes,drafts};
}
test('list-first layout, plus opens new sheet, automatic stock/pending lookup and quick view preserve the current draft',async()=>{
 const h=await harness();assert.equal(h.panel().hidden,true);assert.equal(all(h.root).some(n=>n.textContent==='Lấy lại tồn các mã'),false);
 await h.start();const count=h.label('Thực đếm SKU1');count.value='7';count.events.input!();await h.flush();
 assert.equal(h.label('Thực đếm SKU1'),count,'stock response must not replace the input');assert.equal(count.value,'7');assert.equal(h.button('Gửi Manager duyệt').disabled,true);
 const saved=h.drafts.get('bn-stocktake-draft:employee');await h.button('KK_001_30102026').click();assert.deepEqual(h.opened,['p1']);assert.equal(h.label('Thực đếm SKU1'),count);assert.equal(h.label('Lý do kiểm kê').value,'Kiểm tra kho');assert.equal(h.drafts.get('bn-stocktake-draft:employee'),saved,'opening a quick view requires no save');
 assert.equal(h.panel().hidden,false);await h.button('‹ Danh sách phiếu').click();assert.equal(h.panel().hidden,true);await h.button('Tiếp tục phiếu đang nhập').click();assert.equal(h.label('Thực đếm SKU1').value,'7');
});
test('stock drift preserves the typed count; re-typing the count uses current stock, sending as-is applies the counted difference',async()=>{
 const h=await harness();h.state.pending={};await h.start();const count=h.label('Thực đếm SKU1');count.value='7';count.events.input!();h.state.stock=11;await h.flush();
 assert.equal(count.value,'7');assert.match(h.panel().textContent,/tồn đổi sau lúc đếm/);assert.equal(h.button('Gửi Manager duyệt').disabled,false);
 count.value='6';count.events.input!();assert.equal(h.button('Gửi Manager duyệt').disabled,false);await h.button('Gửi Manager duyệt').click();assert.equal(h.writes.length,1);assert.equal(h.writes[0].lines[0].expectedQty,11);assert.equal(h.writes[0].lines[0].countedQty,6);assert.equal(h.writes[0].applyDelta,undefined);assert.equal(h.panel().hidden,true);
});

test('stock drift sent without recount asks once and submits by difference (applyDelta)',async()=>{
 const h=await harness();h.state.pending={};await h.start();const count=h.label('Thực đếm SKU1');count.value='7';count.events.input!();h.state.stock=11;await h.flush();
 await h.button('Gửi Manager duyệt').click();assert.equal(h.writes.length,1);assert.equal(h.writes[0].lines[0].expectedQty,10);assert.equal(h.writes[0].lines[0].countedQty,7);assert.equal(h.writes[0].applyDelta,true);
});

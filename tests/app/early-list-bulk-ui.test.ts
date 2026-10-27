import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
class Node {
 [key:string]:any;children:Node[]=[];dataset:any={};attrs:any={};own='';checked=false;disabled=false;hidden=false;
 constructor(public tag:string){}
 set textContent(s:string){this.own=s;this.children=[];}get textContent():string{return this.own+this.children.map(c=>c.textContent).join('');}
 append(...nodes:Node[]){this.children.push(...nodes);}setAttribute(k:string,v:string){this.attrs[k]=v;}
 events:Record<string,Function>={};addEventListener(k:string,f:Function){this.events[k]=f;}
 showModal(){this.open=true;}close(){this.open=false;this.events.close?.();}remove(){}
 async click(){if(!this.disabled)return this.onclick?.();}
}
const all=(n:Node):Node[]=>[n,...n.children.flatMap(all)];
const request=(id:string,status='pending',n=1)=>({id,requestStatus:'submitted',lines:[{sku:'SKU',unit:'Cái',allocations:Array.from({length:n},(_,i)=>({id:id+'-a'+i,status,supplierName:'NCC',ticketNumber:'PO',quantity:1,remainingToReceive:status==='accepted'?1:0}))}]});
function setup(){const body=new Node('body'),calls:any[]=[],quick:any[]=[];let fail=false,saved=0,release:Function|undefined;
 const context:any={document:{createElement:(t:string)=>new Node(t),body},openEarlyQuickReceipt:async(args:any)=>{quick.push(args);}};
 runInNewContext(readFileSync(new URL('../../trial-ui/early-list-bulk.js',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace('export function earlyListBulk','globalThis.earlyListBulk = function'),context);
 let requests:any[]=[];const api=async(path:string,method?:string,data?:any)=>{if(method){calls.push({path,data});if(release!==undefined)await new Promise<void>(r=>{release=r;});return{};}if(fail)throw Error('Phiếu đã thay đổi');return{requests};};
 const ui=context.earlyListBulk({api,onSaved:async()=>{saved++;}}),button=(text:string)=>all(body).concat(all(ui.host)).find(n=>n.tag==='button'&&n.textContent===text)!;
 return{ui,body,calls,quick,button,set:(rs:any[],permissions={canViewPortal:true,canReceive:true})=>{requests=rs;ui.reset(rs,permissions);return rs.map(r=>ui.checkbox(r));},get saved(){return saved;},fail:()=>{fail=true;},block:()=>{release=()=>{};},release:()=>release?.()};
}
function check(input:Node){input.checked=true;input.onchange();}
test('index checkbox eligibility follows existing confirmation/receipt rights and resets on page/filter reload',()=>{
 const s=setup(),rows=[request('pending'),request('accepted','accepted'),request('rejected','rejected'),{...request('draft'),requestStatus:'draft'}];
 let checks=s.set(rows);assert.ok(checks[0]);assert.ok(checks[1]);assert.equal(checks[2],null);assert.equal(checks[3],null);check(checks[0]);assert.equal(s.button('Xác nhận thay NCC').disabled,false);assert.equal(s.button('Nhận hàng nhanh').disabled,true);
 s.ui.reset();assert.equal(s.ui.host.hidden,true);assert.equal(s.button('Xác nhận thay NCC').disabled,true);
 checks=s.set(rows,{canViewPortal:false,canReceive:true});assert.equal(checks[0],null);assert.ok(checks[1]);assert.equal(s.button('Xác nhận thay NCC').hidden,true);
 checks=s.set(rows,{canViewPortal:false,canReceive:false});assert.ok(checks.every((c:any)=>c===null));assert.equal(s.ui.host.hidden,true);
});
test('batch review includes only pending allocations; double submit sends one request and never receives stock',async()=>{
 const s=setup(),r=request('one');r.lines[0]!.allocations.push({...r.lines[0]!.allocations[0]!,id:'already',status:'accepted'});const checks=s.set([r,request('two')]);checks.forEach(check);await s.button('Xác nhận thay NCC').click();
 assert.match(s.body.textContent,/Không nhận hàng hay cộng tồn kho/);assert.equal(s.calls.length,0);s.block();const save=s.button('Xác nhận 2 phiếu'),pending=save.click();await save.click();assert.equal(s.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(s.calls[0])),{path:'/purchase-early-requests/manager-confirm-batch',data:{allocationIds:['one-a0','two-a0']}});s.release();await pending;assert.equal(s.saved,1);assert.equal(s.quick.length,0);
});
test('rejects oversized confirmation and stale selected requests without writes',async()=>{
 const s=setup();check(s.set([request('many','pending',301)])[0]);await s.button('Xác nhận thay NCC').click();assert.equal(s.button('Xác nhận 1 phiếu').disabled,true);assert.match(s.body.textContent,/300 dòng/);assert.equal(s.calls.length,0);
 const stale=setup();check(stale.set([request('stale')])[0]);stale.fail();await stale.button('Xác nhận thay NCC').click();assert.match(stale.ui.host.textContent,/Phiếu đã thay đổi/);assert.equal(stale.calls.length,0);
});
test('receiving passes freshly loaded selected headers in page order, not checkbox click order',async()=>{
 const s=setup(),checks=s.set([request('first','accepted'),request('second','accepted')]);check(checks[1]);check(checks[0]);await s.button('Nhận hàng nhanh').click();assert.equal(s.quick.length,1);assert.deepEqual(JSON.parse(JSON.stringify(s.quick[0].requests.map((r:any)=>r.id))),['first','second']);assert.equal(s.calls.length,0);
});

test('checkbox uses the persisted PXH number instead of the UUID fragment',()=>{const s=setup(),r:any=request('uuid');r.ticketNumber='PXH_001_27102026';assert.equal(s.set([r])[0].attrs['aria-label'],'Chọn phiếu PXH_001_27102026');});

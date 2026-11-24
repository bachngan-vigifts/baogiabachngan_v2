import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser presentation module
import {incomingStockText,renderIncomingOrders,createPosDraftStore,posShortcut} from '../../trial-ui/pos-workspace.js';
test('anonymous incoming buckets show only quantity/date and never open a purchase; named PO still opens',()=>{
 const buttons:any[]=[],opened:string[]=[];const doc={createElement:(tag:string)=>({tag,textContent:'',type:'',className:'',addEventListener(_event:string,fn:Function){this.click=fn;},click:null as any})};
 const root={ownerDocument:doc,append:(n:any)=>buttons.push(n)};
 const rows=[{qty:7,arrivalDate:'2026-11-25'},{qty:3,arrivalDate:'2026-11-26',orderId:'po-1',orderNo:'DMH_001',supplierName:'NCC'}];
 renderIncomingOrders(root,rows,(id:string)=>opened.push(id));assert.equal(buttons[0].tag,'p');assert.equal(buttons[0].textContent,'Đang về: 7 · dự kiến 25/11');assert.doesNotMatch(buttons[0].textContent,/undefined|NCC|DMH/);
 assert.equal(buttons[1].tag,'button');buttons[1].click();assert.deepEqual(opened,['po-1']);assert.match(incomingStockText(rows[1]),/DMH_001/);
});
test('POS draft stays isolated by user/register/shift and pending checkout is never used as editable draft',()=>{
 const memory=new Map();const storage={getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)};
 const store=createPosDraftStore(storage),scope={userId:'u1',registerId:'r1',shiftId:'s1'},draft={cart:[{sku:'001',qty:2}],voucher:{value:'1000'},method:'transfer',confirmed:true};
 store.save(scope,draft);assert.equal(store.read({...scope,userId:'u2'}),null);assert.equal(store.read({...scope,registerId:'r2'}),null);assert.equal(store.read({...scope,shiftId:'s2'}),null);assert.equal(store.read(scope).confirmed,undefined);assert.equal(store.read(scope).cart[0].qty,2);store.clear(scope);assert.equal(store.read(scope),null);
});
test('shortcuts ignore ordinary typing/browser modifiers and are scoped to active POS',()=>{
 assert.equal(posShortcut({key:'F9'},{active:true,typing:true}), 'complete');assert.equal(posShortcut({key:'1',altKey:true},{active:true,typing:true}),null);assert.equal(posShortcut({key:'F9',ctrlKey:true},{active:true}),null);assert.equal(posShortcut({key:'F9'},{active:false}),null);assert.equal(posShortcut({key:'F11'},{active:true}),'scan-quantity');
});

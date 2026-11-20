import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../../trial-ui/purchase-supplier-search.js',import.meta.url),'utf8').replace('export function createPurchaseSupplierSearch','function createPurchaseSupplierSearch');
class Element{
 children:Element[]=[];events:Record<string,Function>={};attrs:Record<string,string>={};hidden=false;disabled=false;value='';textContent='';
 append(...items:Element[]){this.children.push(...items);}replaceChildren(...items:Element[]){this.children=items;}
 setAttribute(k:string,v:string){this.attrs[k]=v;}getAttribute(k:string){return this.attrs[k];}removeAttribute(k:string){delete this.attrs[k];}
 addEventListener(k:string,fn:Function){this.events[k]=fn;}removeEventListener(k:string){delete this.events[k];}
 contains(n:Element|null):boolean{return n===this||this.children.some(c=>c.contains(n));}scrollIntoView(){}
}
const supplier={id:'minh-long',name:'Minh Long',contacts:[]};
function setup(){
 const events:Record<string,Function>={},calls:any[]=[],chosen:any[]=[],timers=new Map<number,Function>();let timer=0;
 const doc={activeElement:null as Element|null,createElement:()=>new Element(),addEventListener:(k:string,fn:Function)=>{events[k]=fn;},removeEventListener:(k:string,fn:Function)=>{if(events[k]===fn)delete events[k];}};
 const ctx:any={document:doc,setTimeout:(fn:Function)=>{timers.set(++timer,fn);return timer;},clearTimeout:(id:number)=>timers.delete(id)};
 runInNewContext(source+'\nglobalThis.make=createPurchaseSupplierSearch;',ctx);
 const picker=ctx.make({api:(path:string)=>new Promise((resolve,reject)=>calls.push({path,resolve,reject})),choose:(row:any)=>chosen.push(row)});
 const list=picker.root.children[1],more=picker.root.children[3];
 return {doc,events,calls,chosen,picker,list,more,focus(){doc.activeElement=picker.input;picker.input.events.focus();},async respond(i=0,rows=[supplier],next:number|null=12){calls[i].resolve({suppliers:rows,nextOffset:next});await Promise.resolve();await Promise.resolve();}};
}
test('mobile blur with null relatedTarget preserves supplier options until click selects the exact ID',async()=>{
 const f=setup();f.focus();await f.respond();assert.equal(f.list.hidden,false);
 f.doc.activeElement=null;f.picker.root.events.focusout({relatedTarget:null});assert.equal(f.list.hidden,false);
 f.list.children[0]!.events.click!();assert.equal(f.chosen[0].id,supplier.id);assert.equal(f.list.hidden,true);
});
test('load more works when touch has blurred the input without focusing a button',async()=>{
 const f=setup();f.focus();await f.respond();f.doc.activeElement=null;f.picker.root.events.focusout({relatedTarget:null});
 f.more.events.click!();assert.match(f.calls[1].path,/offset=12/);await f.respond(1,[{...supplier,id:'second'}],null);assert.equal(f.list.children.length,2);
});
test('outside taps and keyboard focus changes hide results and reject late responses; dispose removes the document handler',async()=>{
 const f=setup();f.focus();f.events.pointerdown!({target:new Element()});await f.respond();assert.equal(f.list.hidden,true);assert.equal(f.picker.input.getAttribute('aria-busy'),undefined);
 f.focus();await f.respond(1);assert.equal(f.list.hidden,false);f.picker.root.events.focusout({relatedTarget:new Element()});assert.equal(f.list.hidden,true);
 f.picker.dispose();assert.equal(f.events.pointerdown,undefined);
});
test('keyboard selection remains available and a focused input can reopen after choosing or Escape',async()=>{
 const f=setup();f.focus();await f.respond();const key=(k:string)=>f.picker.input.events.keydown({key:k,preventDefault(){},stopPropagation(){}});
 key('ArrowDown');key('Enter');assert.equal(f.chosen[0].id,supplier.id);assert.equal(f.list.hidden,true);
 f.picker.input.events.click();assert.equal(f.calls.length,2);await f.respond(1);key('Escape');assert.equal(f.list.hidden,true);
 f.picker.input.events.click();assert.equal(f.calls.length,3);await f.respond(2);assert.equal(f.list.hidden,false);
});

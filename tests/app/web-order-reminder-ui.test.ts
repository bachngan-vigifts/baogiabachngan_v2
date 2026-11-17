import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser module, exercised with a minimal DOM and injected APIs.
import {createWebOrderReminder} from '../../trial-ui/web-order-reminder.js';
class Element{
 children:any[]=[];text='';hidden=false;className='';dataset:any={};
 set textContent(v:string){this.text=v;this.children=[];}get textContent():string{return this.text+this.children.map(n=>n.textContent).join('');}
 append(...nodes:any[]){this.children.push(...nodes);}replaceChildren(...nodes:any[]){this.text='';this.children=nodes;}
 setAttribute(){}addEventListener(){}querySelectorAll(){return[];}
}
async function fixture(run:(f:any)=>Promise<void>){
 const old=(globalThis as any).document;
 (globalThis as any).document={visibilityState:'visible',createElement:()=>new Element(),addEventListener(){},removeEventListener(){}};
 let clock=1000,context={userId:'a',registerId:'one',active:true,busy:true};const calls:any[]=[];
 const control=createWebOrderReminder({root:new Element(),context:()=>context,now:()=>clock,onGhn(){},onCancel(){},api:(path:string)=>new Promise((resolve,reject)=>calls.push({path,resolve,reject}))});
 try{await run({control,calls,advance:(ms:number)=>clock+=ms,context,setContext:(c:any)=>{context={...context,...c};}});}finally{control.dispose();(globalThis as any).document=old;}
}
const tick=()=>Promise.resolve();
const data=(count=1)=>({count,orders:[{id:'order',orderNo:'WEB',ageMinutes:40}]});
test('background board refreshes coalesce and share the one-minute reminder cache',()=>fixture(async({control,calls,advance}:any)=>{
 const a=control.refresh(),b=control.refresh();await tick();assert.equal(calls.length,1);calls[0].resolve(data());await Promise.all([a,b]);
 for(let i=0;i<8;i++)await control.refresh();assert.equal(calls.length,1);
 advance(59999);await control.refresh();assert.equal(calls.length,1);
 advance(1);const c=control.refresh();await tick();assert.equal(calls.length,2);calls[1].resolve(data());await c;
}));
test('late replies cannot display a different store/account, and leaving POS clears reminder state',()=>fixture(async({control,calls,setContext}:any)=>{
 const a=control.refresh();await tick();setContext({userId:'b',registerId:'two'});const b=control.refresh();await tick();
 assert.match(calls[0].path,/registerId=one/);assert.match(calls[1].path,/registerId=two/);
 calls[0].resolve(data(99));await a;assert.equal(control.banner.hidden,true);
 calls[1].resolve(data(2));await b;assert.match(control.banner.textContent,/2 đơn/);assert(!control.banner.textContent.includes('99'));
 setContext({active:false});await control.refresh();assert.equal(control.banner.hidden,true);assert.equal(calls.length,2);
}));
test('network failure keeps prior warning, retry refreshes it, and permission failure clears it',()=>fixture(async({control,calls,advance}:any)=>{
 const a=control.refresh();await tick();calls[0].resolve(data());await a;
 advance(60000);const b=control.refresh();await tick();calls[1].reject(Error('offline'));await b;
 assert.match(control.banner.textContent,/1 đơn/);assert.match(control.banner.textContent,/offline/);
 const c=control.refresh({force:true});await tick();calls[2].resolve(data(2));await c;assert.match(control.banner.textContent,/2 đơn/);assert(!control.banner.textContent.includes('offline'));
 advance(60000);const d=control.refresh();await tick();calls[3].reject(Object.assign(Error('Forbidden'),{status:403}));await d;assert.equal(control.banner.hidden,true);
}));

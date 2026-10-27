import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore DOM is injected
import {createPageBack} from '../../trial-ui/page-back.js';
function fixture(initial='#/orders/order-1'){
 let who='mgr',denied='',at=0,currentHash=initial,click=()=>{};const entries:any[]=[{hash:initial,state:null}],calls:string[]=[];
 const button={textContent:'',title:'',disabled:false,setAttribute(){},addEventListener(_type:string,fn:()=>void){click=fn;}};
 const history={get state(){return entries[at].state;},replaceState(state:any){entries[at].state=state;},back(){calls.push('native-back');if(at){--at;currentHash=entries[at].hash;}}};
 const go=(hash:string)=>{entries.splice(++at);entries.push({hash,state:null});currentHash=hash;};
 const ui=createPageBack({button,history,hash:()=>currentHash,user:()=>who,home:()=>'#/quotes',canVisit:(hash:string)=>hash!==denied,label:(hash:string)=>hash,go});
 return{button,ui,calls,go,click:()=>click(),get hash(){return currentHash;},user:(value:string)=>who=value,deny:(value:string)=>denied=value,entries};
}
test('direct detail links use their list fallback; accepted history uses native Back and restores the earlier entry',()=>{
 const f=fixture();f.ui.record();assert.equal(f.button.textContent,'‹ #/orders');f.click();assert.equal(f.hash,'#/orders');f.ui.record();
 f.go('#/pos');f.ui.record();f.click();assert.equal(f.hash,'#/orders');assert.deepEqual(f.calls,['native-back']);f.ui.record();
 const length=f.entries.length;for(let i=0;i<5;i++)f.ui.record();assert.equal(f.entries.length,length);
});
test('back never targets another user or a route whose permission was removed; home has no pretend destination',()=>{
 const f=fixture('#/quotes');f.ui.record();assert.equal(f.button.disabled,true);f.go('#/inventory');f.ui.record();f.deny('#/quotes');f.ui.record();assert.equal(f.button.disabled,true);
 f.deny('');f.user('other');f.ui.record();assert.equal(f.entries.at(-1).state.crmPageBack.previous,'');
});

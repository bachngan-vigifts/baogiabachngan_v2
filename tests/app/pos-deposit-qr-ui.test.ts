// @ts-nocheck
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {depositQrControls} from '../../trial-ui/pos-deposit-qr.js';
class E{children=[];listeners={};value='';checked=false;disabled=false;isConnected=true;open=false;textContent='';append(...n){this.children.push(...n)}setAttribute(){}prepend(n){this.children.unshift(n)}addEventListener(k,f){this.listeners[k]=f}async click(){if(!this.disabled)await this.listeners.click?.()} }
function setupUi(t,{restore=null,lost=false,expired=false}={}){
 let tick; t.mock.method(globalThis,'setInterval',f=>{tick=f;return 1});t.mock.method(globalThis,'clearInterval',()=>{});
 const old=globalThis.document;globalThis.document={createTextNode:s=>s};t.after(()=>globalThis.document=old);
 const input=new E();input.value='300';const method=new E(),confirmed=new E(),dialogs=[],calls=[];
 let result={paid:false,consumed:false},fail=false,first=true;
 let d={id:'same-qr',amount:300,url:'test:qr',content:'SAME REF',expiresAt:expired?'2000-01-01':new Date(Date.now()+60000).toISOString()};
 const el=(tag,cls='',text='')=>Object.assign(new E(),{tag,className:cls,textContent:text});
 const button=(text,cls,fn)=>{const e=el('button',cls,text);e.listeners.click=fn;return e};
 const modal=()=>{const m={body:new E(),dlg:new E(),show(){m.dlg.open=true},close(){m.dlg.open=false}};dialogs.push(m);return m};
 const api=async(path,verb='GET',body)=>{calls.push({path,verb,body});if(path==='/pos/qr'){if(lost&&first){first=false;throw Error('lost ack')}return {...d};}if(path.endsWith('/status')){if(fail)throw Error('offline');return result}if(path.endsWith('/renew')){assert.equal(body.confirmedUnpaid,true);d={...d,expiresAt:new Date(Date.now()+60000).toISOString()};return d}if(path.endsWith('/share-options'))return {options:[]};throw Error(path)};
 const ui=depositQrControls({el,button,modal,api,money:String,input,method,confirmed,total:()=>1000,payload:()=>({shiftId:'s'}),owner:()=> 'u',changed:()=>{},restore});t.after(()=>ui.dispose());
 return {ui,input,confirmed,dialogs,calls,click:()=>ui.box.children[1].click(),tick:()=>tick(),setResult:r=>result=r,setFail:b=>fail=b};
}
test('lost creation ack + reload preserves key; expired QR requires verification and renews same id; late paid closes QR',async t=>{
 const a=setupUi(t,{lost:true,expired:true});await a.click();const saved=a.ui.snapshot();assert.ok(saved.creationAttempt.body.key);a.ui.dispose();
 const b=setupUi(t,{restore:saved,expired:true});await b.click();assert.equal(b.calls[0].body.key,a.calls[0].body.key);assert.equal(b.calls.filter(c=>c.path.endsWith('/renew')).length,0);
 const m=b.dialogs.at(-1),label=m.body.children[1],renew=m.body.children[2];assert.equal(renew.disabled,true);assert.equal(m.body.children.some(n=>n.tag==='img'),false);
 label.children[0].checked=true;label.children[0].listeners.change();await renew.click();assert.equal(b.ui.snapshot().id,'same-qr');assert.equal(b.calls.filter(c=>c.path==='/pos/qr').length,1);
 b.setResult({paid:true,consumed:false});await b.tick();assert.equal(b.confirmed.checked,true);assert.equal(b.ui.box.children[1].disabled,true);assert.equal(b.dialogs.at(-1).dlg.open,false);
});
test('expired unknown status never offers renewal or payment; consumed/reconciliation never shows QR',async t=>{
 const f=setupUi(t,{expired:true});f.setFail(true);await f.click();assert.equal(f.dialogs.length,0);assert.equal(f.calls.filter(c=>c.path.endsWith('/renew')).length,0);
 f.setFail(false);f.setResult({paid:true,consumed:true});await f.click();assert.equal(f.dialogs.length,0);assert.equal(f.ui.box.children[1].disabled,true);assert.equal(f.confirmed.checked,false);
});
test('payment arriving before expiry verification completes blocks renewal',async t=>{
 const f=setupUi(t,{expired:true});await f.click();const m=f.dialogs.at(-1),check=m.body.children[1].children[0],renew=m.body.children[2];check.checked=true;check.listeners.change();f.setResult({paid:true,consumed:false});await renew.click();assert.equal(f.calls.filter(c=>c.path.endsWith('/renew')).length,0);assert.equal(f.confirmed.checked,true);
});

test('reconciliation flag takes priority over paid and never confirms receipt or displays payment QR',async t=>{
 const f=setupUi(t,{expired:true});f.setResult({paid:true,consumed:false,requiresReconciliation:true});await f.click();assert.equal(f.confirmed.checked,false);assert.equal(f.dialogs.length,0);assert.equal(f.ui.box.children[1].disabled,true);assert.equal(f.calls.filter(c=>c.path.endsWith('/renew')).length,0);
});

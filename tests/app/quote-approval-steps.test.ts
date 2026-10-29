import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
// @ts-expect-error Browser module.
import {missingPurchaseCost} from '../../trial-ui/purchase-cost-review.js';
const source=readFileSync(new URL('../../trial-ui/app.js',import.meta.url),'utf8');
const approval=source.slice(source.indexOf("$('#approve-quote').addEventListener"),source.indexOf("$('#reject-quote').addEventListener"));
function fixture({manager=true,ready=true,rows=[{name:'Known',sku:'A',qty:1,costPrice:100}],reviewed=true,saveWorks=true}:any={}){
 let click:any;const calls:any[]=[],confirmations:any[]=[],reviews:any[]=[],messages:string[]=[];
 const editor:any={id:'q',revision:4,rows,dirty:false,approval:{canApprove:true,status:'pending'}};
 const context:any={editor,missingPurchaseCost,isManager:()=>manager,$:()=>({disabled:false,addEventListener:(_:string,fn:any)=>{click=fn;}}),
 api:async(path:string,method='GET',body?:any)=>{calls.push({path,method,body});return path.endsWith('approval-preflight')?{purchaseCostsReady:ready}:{approvedAt:'today',approvedByName:'Manager'};},
 confirmBox:async(...args:any[])=>{confirmations.push(args);return true;},
 refreshPurchaseCosts:async(opts:any)=>{reviews.push(opts);if(reviewed){for(const r of editor.rows)if(missingPurchaseCost(r))r.costPrice=123;editor.revision++;}return reviewed;},
 saveQuote:async()=>{if(saveWorks){editor.dirty=false;editor.revision++;}},toast:(message:string)=>messages.push(message),updateQuoteActions(){},loadQuotes(){},refreshQuoteHold(){}};
 runInNewContext(approval,context);return {context,editor,calls,confirmations,reviews,messages,click:()=>click()};
}
test('Manager with complete costs confirms approval once without opening purchase review or changing costs',async()=>{
 const f=fixture({rows:[{name:'Direct',qty:1,costPrice:160000,costMode:'manual'},{name:'Free',qty:2,costPrice:0},{name:'Unused',qty:0}]});const before=JSON.stringify(f.editor.rows);
 await f.click();assert.equal(f.confirmations.length,1);assert.equal(f.reviews.length,0);assert.equal(JSON.stringify(f.editor.rows),before);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.calls.at(-1).body.revision,4);
});
test('Manager missing costs gets only the cost form, then approves the newly saved revision',async()=>{
 const f=fixture({ready:false,rows:[{name:'Known',qty:1,costPrice:400},{name:'Missing',qty:2}]});await f.click();
 assert.equal(f.confirmations.length,0);assert.equal(f.reviews.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.reviews[0])),{onlyMissing:true,approval:true});assert.equal(f.editor.rows[0].costPrice,400);assert.equal(f.calls.at(-1).body.revision,5);
});
test('cancelled cost review or failed save does not approve',async()=>{
 const cancelled=fixture({ready:false,rows:[{name:'Missing',qty:1}],reviewed:false});await cancelled.click();assert.ok(!cancelled.calls.some(c=>c.method==='POST'));
 const failed=fixture({saveWorks:false});failed.editor.dirty=true;await failed.click();assert.ok(!failed.calls.some(c=>c.method==='POST'));
});
test('delegated approver never opens private costs; missing costs still require Manager',async()=>{
 const good=fixture({manager:false});await good.click();assert.equal(good.reviews.length,0);assert.equal(good.confirmations.length,1);assert.equal(good.calls.filter(c=>c.method==='POST').length,1);
 const missing=fixture({manager:false,ready:false});await missing.click();assert.equal(missing.reviews.length,0);assert.equal(missing.confirmations.length,0);assert.ok(!missing.calls.some(c=>c.method==='POST'));assert.match(missing.messages.at(-1)!,/Manager cập nhật giá mua/);
});
test('navigating to another quote while confirmation is open never approves the new quote',async()=>{
 const f=fixture();f.context.confirmBox=async()=>{f.editor.id='other';return true;};await f.click();assert.ok(!f.calls.some(c=>c.method==='POST'));
});

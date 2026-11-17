import{test}from'node:test';import assert from'node:assert/strict';
// @ts-expect-error Native browser JS.
import{requestOrderApproval,submissionSummary}from'../../trial-ui/order-submit.js';
const esc=(v:any)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const values={deliveryDate:'2026-12-20',deliveryAddress:'Địa chỉ giao hàng',receiverName:'Người nhận',receiverPhone:'0901234567',shippingPayer:'sender',paymentMethod:'transfer',printMode:'bulk',printInstructions:'Logo ABC 1 màu',sampleDate:'',bulkConfirmed:'true'};
const pre={revision:4,quoteRevision:2,kind:'HĐKT',documentNo:'HD-TEST',printing:true,products:[{name:'<img onerror=alert(1)>',qty:2,unit:'cái'}],defaults:{}};
test('Staff form reads operational preflight only and submits validated checklist with both revisions',async()=>{
 const calls:any[]=[];
 assert.equal(await requestOrderApproval({id:'o',esc,api:async(p:string,m:string,b:any)=>{calls.push({p,m,b});return pre;},verifyBox:async(o:any)=>{
  assert.equal(o.requireValidFields,true);assert.ok(o.fields.includes('bulkConfirmed'));assert.ok(o.rows[0][1].includes('&lt;img'));assert.equal(o.checks.length,4);
  assert.ok(o.validate({...values,bulkConfirmed:'false'}));assert.ok(o.validate({...values,receiverPhone:''}));assert.equal(o.validate(values),'');return values;
 }}),true);
 assert.deepEqual(calls.map(c=>c.p),['/orders/o/submission-review','/orders/o/submit']);
 const b=calls[1].b;assert.equal(b.revision,4);assert.equal(b.quoteRevision,2);assert.equal(b.review.bulkConfirmed,true);assert.equal(b.review.confirmations.printing,true);assert.equal(b.review.costPrice,undefined);
});
test('Cancel writes nothing; ordinary order has no print section; submission summary escapes all user text',async()=>{
 let writes=0;
 assert.equal(await requestOrderApproval({id:'o',esc,api:async(_p:string,m:string)=>{if(m)writes++;return {...pre,printing:false};},verifyBox:async(o:any)=>{assert.ok(!o.fields.includes('bulkConfirmed'));assert.equal(o.checks.length,3);return null;}}),false);
 assert.equal(writes,0);
 const html=submissionSummary({...values,printing:true,deliveryAddress:'<img onerror=alert(1)>',paymentMethod:'other',paymentOther:'<script>'},esc);
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;script&gt;'));
});

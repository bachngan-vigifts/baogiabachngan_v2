import { contractTest as test, assert } from '../TEST_TEMPLATE.ts';
const {createAppsheetReview}:any=await import(new URL('../../trial-ui/appsheet-customers.js',import.meta.url).href);
const source=()=>({format:'appsheet-customers-v1',customers:[{rowId:'K1'}],contacts:[],resolutions:{customers:{},contacts:{}}});
test('AppSheet review requires preview, invalidates changed resolutions/file and does not reuse applied approval',async()=>{
  const calls:any[]=[],review=createAppsheetReview(async(...args:any[])=>{calls.push(args);return {planHash:'hash-1'};});
  review.load(source());assert.equal(review.canApply,false);await assert.rejects(()=>review.apply(),/xem trước/);
  await review.preview();assert.equal(review.canApply,true);review.resolve('customers','K1','crm-1');assert.equal(review.canApply,false);
  await review.preview();assert.equal(calls.at(-1)[2].input.resolutions.customers.K1,'crm-1');
  await review.apply();assert.equal(calls.at(-1)[2].planHash,'hash-1');assert.equal(review.canApply,false);
  await assert.rejects(()=>review.apply(),/xem trước/);assert.equal(calls.filter(c=>c[0].endsWith('/apply')).length,1);
  await review.preview();review.load(source());assert.equal(review.canApply,false);review.clear();assert.equal(review.hasInput,false);
});
test('AppSheet review blocks overlapping requests and requires a fresh preview after uncertain failures',async()=>{
  let finish:any;const calls:any[]=[];const review=createAppsheetReview((path:string)=>{calls.push(path);return new Promise(r=>finish=r);});
  review.load(source());const pending=review.preview();assert.throws(()=>review.load(source()),/Đang xử lý/);assert.throws(()=>review.resolve('customers','K1','x'),/Đang xử lý/);
  await assert.rejects(()=>review.preview(),/Đang xử lý/);finish({planHash:'approved'});await pending;
  const applying=review.apply();await assert.rejects(()=>review.apply(),/Đang xử lý/);finish({ok:true});await applying;assert.equal(review.canApply,false);
  let fail=false;const flaky=createAppsheetReview(async()=>{if(fail)throw new Error('mất kết nối');return {planHash:'hash'};});flaky.load(source());await flaky.preview();fail=true;
  await assert.rejects(()=>flaky.apply(),/mất kết nối/);assert.equal(flaky.canApply,false);await assert.rejects(()=>flaky.apply(),/xem trước/);
  await assert.rejects(()=>flaky.preview(),/mất kết nối/);assert.equal(flaky.canApply,false);
});
test('AppSheet review owns a copy of the selected file and handles unusual source keys safely',async()=>{
  const calls:any[]=[],review=createAppsheetReview(async(...args:any[])=>{calls.push(args);return {planHash:'hash'};});
  const original=source();review.load(original);original.customers[0]!.rowId='mutated';review.resolve('customers','__proto__','crm');await review.preview();
  assert.equal(calls[0][2].input.customers[0].rowId,'K1');assert.equal(Object.getPrototypeOf(calls[0][2].input.resolutions.customers),Object.prototype);
  assert.equal(calls[0][2].input.resolutions.customers.__proto__,'crm');
});

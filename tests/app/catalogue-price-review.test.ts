import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Browser module; queue operations do not require DOM.
import {createLibraryPriceReview} from '../../trial-ui/catalogue/library-price-review.js';
const row={id:'c'.repeat(64),revision:1,product:{name:'<img onerror=bad()>',regular:546000,priceOnRequest:false},priceConflict:{incoming:{regular:0,priceOnRequest:true,fromPrice:false}}};
test('price review persists conflicts separately and restores queue without invoking write API',async()=>{
 let saved:unknown[]=[],calls=0;
 const options={api:async()=>{calls++;},identity:()=> 'session-a',getMember:()=> 'employee-a',getPending:async()=>saved,putPending:async(_owner:string,items:unknown[])=>{saved=items;},refresh:async()=>{},toast:()=>{}};
 const review=createLibraryPriceReview(options);await review.load('employee-a');await review.record([row]);assert.equal(saved.length,1);assert.equal(calls,0);assert.match(review.html(),/1 sản phẩm/);
 const restored=createLibraryPriceReview(options);await restored.load('employee-a');assert.match(restored.html(),/Đối chiếu giá/);restored.reset();assert.equal(restored.html(),'');assert.equal(saved.length,1);
});
test('price review discards stale async responses after account switch',async()=>{
 let who='session-a',member='employee-a',release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const review=createLibraryPriceReview({api:async()=>{},identity:()=>who,getMember:()=>member,getPending:async()=>{await gate;return[{...row,incoming:row.priceConflict.incoming}];},putPending:async()=>{},refresh:async()=>{},toast:()=>{}});
 const pending=review.load(member);who='session-b';member='employee-b';review.reset();release();await pending;assert.equal(review.html(),'');await review.record([row]);assert.equal(review.html(),'');
});
test('concurrent initial queue loads cannot overwrite a newly persisted conflict',async()=>{
 let release!:()=>void,reads=0;const gate=new Promise<void>(r=>{release=r;});
 const review=createLibraryPriceReview({api:async()=>{},identity:()=> 'session',getMember:()=> 'employee',getPending:async()=>{if(++reads===1)await gate;return[];},putPending:async()=>{},refresh:async()=>{},toast:()=>{}});
 const slow=review.load('employee');await review.load('employee');await review.record([row]);release();await slow;assert.match(review.html(),/1 sản phẩm/);
});

test('concurrent price conflicts are serialized without dropping another product',async()=>{
 let saved:unknown[]=[];
 const review=createLibraryPriceReview({api:async()=>{},identity:()=> 'session',getMember:()=> 'employee',getPending:async()=>[],putPending:async(_owner:string,items:unknown[])=>{await new Promise(r=>setTimeout(r,5));saved=items;},refresh:async()=>{},toast:()=>{}});
 await review.load('employee');await Promise.all([review.record([row]),review.record([{...row,id:'d'.repeat(64)}])]);assert.equal(saved.length,2);assert.match(review.html(),/2 sản phẩm/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webOrderAttention} from './web-order-attention.ts';
const now=Date.parse('2026-11-17T03:00:00Z');
const order={status:'processing',ghnStatus:'',ghnOrderCode:'',orderedAt:'2026-11-17T02:30:00Z',crmEditSnapshot:'{}'};
test('30 minute threshold uses order creation, supports offsets/legacy UTC, and excludes invalid/future dates',()=>{
 assert.equal(webOrderAttention(order,now).eligible,true);
 assert.equal(webOrderAttention({...order,orderedAt:'2026-11-17T02:30:00.001Z'},now).eligible,false);
 assert.equal(webOrderAttention({...order,orderedAt:'2026-11-17T09:30:00+07:00'},now).eligible,true);
 assert.equal(webOrderAttention({...order,orderedAt:'2026-11-17 02:30:00'},now).eligible,true);
 for(const orderedAt of ['','not-a-date','2026-11-17','2026-11-18T00:00:00Z'])assert.equal(webOrderAttention({...order,orderedAt},now).eligible,false);
});
test('handled and terminal orders never enter untouched reminder, including uncertain confirmation attempts',()=>{
 for(const patch of [{status:'completed'},{status:'cancelled'},{status:'wc-refunded'},{status:'packing'},{status:'lnl-awaiting-pickup'},{ghnOrderCode:'G123'},{ghnStatus:'delivered'},{stockStatus:'issued'},{stockStatus:'returned'},{stockStatus:'blocked'},{crmEditSnapshot:'{"revision":1}'},{crmEditSnapshot:'{"confirmationStartedAt":"today"}'},{crmEditSnapshot:'{"ghnAttemptedAt":"today"}'}])
  assert.equal(webOrderAttention({...order,...patch},now).eligible,false,JSON.stringify(patch));
});
